//! The node client: every actor action is an HTTP call against the real API
//! of a node — never SQL, never a backdoor (SIMULATION-PLAN P1).
//!
//! Each call is recorded as one intent line before the outcome is judged:
//! a non-2xx answer to a mutation intent is a failure with the request and the
//! response preserved, never swallowed (P3). Intent lines carry the VIRTUAL
//! instant and natural keys only — no wall-clock noise — so two runs with the
//! same seed produce byte-identical logs (P2).

use crate::clock::SimClock;
use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::PathBuf;

#[derive(Debug)]
pub struct SimError(pub String);

impl std::fmt::Display for SimError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for SimError {}

impl From<reqwest::Error> for SimError {
    fn from(e: reqwest::Error) -> Self {
        Self(format!("http: {e}"))
    }
}
impl From<serde_json::Error> for SimError {
    fn from(e: serde_json::Error) -> Self {
        Self(format!("json: {e}"))
    }
}
impl From<std::io::Error> for SimError {
    fn from(e: std::io::Error) -> Self {
        Self(format!("io: {e}"))
    }
}

pub type SimResult<T> = Result<T, SimError>;

/// Which node an intent is aimed at.
#[derive(Debug, Clone, Copy)]
pub enum Node {
    Cloud,
    Dc,
    /// The rig runs a store node; a store-lane scenario will aim intents at it.
    #[allow(dead_code)]
    Store,
}

/// What an actor expects back. Anything else is a failure (P3: rejections are
/// declared, never tolerated).
#[derive(Debug, Clone, Copy)]
pub enum Expect {
    /// Any 2xx.
    Success,
    /// One exact status — the declared rejection. For scenarios that assert a
    /// specific refusal rather than a success.
    #[allow(dead_code)]
    Status(u16),
}

/// The three nodes of a run, addressed by the URLs the rig froze into its env
/// file.
pub struct Nodes {
    pub cloud: String,
    pub dc: String,
    pub store: String,
    http: reqwest::Client,
    run_id: String,
}

impl Nodes {
    pub fn new(cloud: String, dc: String, store: String, run_id: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            cloud,
            dc,
            store,
            http,
            run_id,
        }
    }

    pub fn base(&self, node: Node) -> &str {
        match node {
            Node::Cloud => &self.cloud,
            Node::Dc => &self.dc,
            Node::Store => &self.store,
        }
    }

    fn node_name(&self, node: Node) -> &'static str {
        match node {
            Node::Cloud => "cloud",
            Node::Dc => "dc",
            Node::Store => "store",
        }
    }
}

/// A read used while polling a sync-fed read model. How many attempts a poll
/// takes is the sync agent's business — wall-clock noise — so poll attempts
/// stay out of the intent journal (P2: same seed, byte-identical journal).
/// The caller interprets the body; nothing is judged, nothing is recorded.
pub async fn peek(nodes: &Nodes, actor: &str, node: Node, path: &str) -> SimResult<Value> {
    let url = format!("{}{}", nodes.base(node), path);
    let response = nodes
        .http
        .get(&url)
        .header("x-sim-run", &nodes.run_id)
        .header("x-sim-actor", actor)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await?;
    let text = response.text().await.unwrap_or_default();
    Ok(if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(Value::Null)
    })
}

/// The append-only intent journal of a run.
pub struct Recorder {
    writer: BufWriter<File>,
    failures_dir: PathBuf,
    pub seq: u64,
    pub total: u64,
    pub failures: u64,
}

impl Recorder {
    pub fn open(out_dir: &std::path::Path) -> SimResult<Self> {
        let failures_dir = out_dir.join("failures");
        fs::create_dir_all(&failures_dir)?;
        let file = File::create(out_dir.join("intents.jsonl"))?;
        Ok(Self {
            writer: BufWriter::new(file),
            failures_dir,
            seq: 0,
            total: 0,
            failures: 0,
        })
    }

    // One intent line carries the whole act; naming a struct for its eight
    // fields would move the ceremony, not remove it.
    #[allow(clippy::too_many_arguments)]
    fn record_intent(
        &mut self,
        clock: &SimClock,
        actor: &str,
        node_name: &str,
        method: &str,
        path: &str,
        body: &Value,
        status: u16,
    ) -> SimResult<()> {
        self.seq += 1;
        self.total += 1;
        let line = json!({
            "t": clock.now().to_rfc3339(),
            "seq": self.seq,
            "actor": actor,
            "node": node_name,
            "method": method,
            "path": path,
            "body": body,
            "status": status,
        });
        self.writer.write_all(line.to_string().as_bytes())?;
        self.writer.write_all(b"\n")?;
        self.writer.flush()?;
        Ok(())
    }

    fn record_failure(&mut self, intent: &Value, response_text: &str) -> SimResult<()> {
        self.failures += 1;
        let file = self.failures_dir.join(format!("{}.json", self.failures));
        let payload = json!({ "intent": intent, "response": response_text });
        fs::write(file, payload.to_string())?;
        Ok(())
    }
}

/// One actor action against one node. Returns the parsed JSON body (or Null
/// for an empty body).
// The wire call is one verb with its whole context spelled out; a context
// struct would move the words without removing any.
#[allow(clippy::too_many_arguments)]
pub async fn call(
    nodes: &Nodes,
    rec: &mut Recorder,
    clock: &SimClock,
    actor: &str,
    node: Node,
    method: &str,
    path: &str,
    body: Value,
    expect: Expect,
) -> SimResult<Value> {
    request_with(
        nodes,
        rec,
        clock,
        actor,
        node,
        method,
        path,
        body,
        &[],
        expect,
    )
    .await
}

/// The same call carrying an `Idempotency-Key` header — the wire contract of
/// the sourcing catalogue endpoints.
#[allow(clippy::too_many_arguments)]
pub async fn call_idem(
    nodes: &Nodes,
    rec: &mut Recorder,
    clock: &SimClock,
    actor: &str,
    node: Node,
    method: &str,
    path: &str,
    body: Value,
    key: &str,
    expect: Expect,
) -> SimResult<Value> {
    request_with(
        nodes,
        rec,
        clock,
        actor,
        node,
        method,
        path,
        body,
        &[("Idempotency-Key", key.to_string())],
        expect,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn request_with(
    nodes: &Nodes,
    rec: &mut Recorder,
    clock: &SimClock,
    actor: &str,
    node: Node,
    method: &str,
    path: &str,
    body: Value,
    extra_headers: &[(&'static str, String)],
    expect: Expect,
) -> SimResult<Value> {
    let url = format!("{}{}", nodes.base(node), path);
    let request_id = format!("{}-{}", nodes.run_id, rec.seq + 1);

    let mut request = match method {
        "GET" => nodes.http.get(&url),
        "POST" => nodes.http.post(&url),
        other => return Err(SimError(format!("unsupported method {other}"))),
    };
    request = request
        .header("x-sim-run", &nodes.run_id)
        .header("x-sim-actor", actor)
        .header("x-request-id", &request_id);
    for (name, value) in extra_headers {
        request = request.header(*name, value);
    }
    if !body.is_null() {
        request = request.json(&body);
    }

    let response = request.send().await?;
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    let parsed: Value = if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(Value::Null)
    };

    let node_name = nodes.node_name(node);
    rec.record_intent(clock, actor, node_name, method, path, &body, status)?;

    let ok = match expect {
        Expect::Success => (200..300).contains(&status),
        Expect::Status(want) => status == want,
    };
    if !ok {
        rec.record_failure(
            &json!({
                "t": clock.now().to_rfc3339(),
                "actor": actor,
                "method": method,
                "url": url,
                "body": body,
                "expect": format!("{expect:?}"),
            }),
            &text,
        )?;
        return Err(SimError(format!(
            "{actor} {method} {path} on {node_name}: expected {expect:?}, got {status}: {}",
            truncate(&text, 400)
        )));
    }
    Ok(parsed)
}

fn truncate(text: &str, max: usize) -> String {
    if text.len() <= max {
        text.to_string()
    } else {
        let cut = text
            .char_indices()
            .nth(max)
            .map(|(i, _)| i)
            .unwrap_or(text.len());
        format!("{}…", &text[..cut])
    }
}
