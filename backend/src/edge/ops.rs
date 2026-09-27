//! Carrying out what head office asked for (`sync::node_ops`).
//!
//! The command lane applies each command inside a database transaction, and
//! none of these belongs inside one: a restart would kill the transaction that
//! records it, a backup would wait on the very lock the transaction holds. So
//! applying the command only queues the operation here, and a runner does it
//! after the commit — the command is acknowledged as received, and what then
//! happened is written to the log and, for a diagnosis, sent to head office.

use crate::edge::console::StopReason;
use crate::edge::status::StatusSource;
use crate::sync::node_ops::{NodeOpPayload, UpdatePayload, NODE_BACKUP, NODE_DIAGNOSE, NODE_RESTART};
use std::{
    path::PathBuf,
    sync::{Arc, OnceLock},
    time::Duration,
};
use tokio::sync::{mpsc, watch};

#[derive(Debug)]
pub enum NodeOp {
    Plain { kind: String, payload: NodeOpPayload },
    Update(UpdatePayload),
}

static QUEUE: OnceLock<mpsc::UnboundedSender<NodeOp>> = OnceLock::new();

/// Queue an operation for after the command's transaction commits. A node
/// with no runner (a DC, a developer's run without a data directory) logs it
/// and carries on: the instruction is received, there is simply nothing here
/// that carries it out.
pub fn enqueue(kind: &str, payload: NodeOpPayload) {
    send(NodeOp::Plain {
        kind: kind.to_owned(),
        payload,
    });
}

/// Queue a signed update (`edge/update.rs`).
pub fn enqueue_update(update: UpdatePayload) {
    send(NodeOp::Update(update));
}

fn send(op: NodeOp) {
    match QUEUE.get() {
        Some(queue) => {
            let _ = queue.send(op);
        }
        None => tracing::warn!(?op, "head office asked for an operation this node does not run"),
    }
}

/// How long a restart waits for open drawers before it goes ahead anyway.
const RESTART_PATIENCE: Duration = Duration::from_secs(12 * 3600);
const RESTART_RECHECK: Duration = Duration::from_secs(5 * 60);

/// Run operations from now on.
pub fn spawn_runner(
    source: Arc<StatusSource>,
    data_dir: Option<PathBuf>,
    stop: Arc<watch::Sender<StopReason>>,
) {
    let (sender, mut receiver) = mpsc::unbounded_channel::<NodeOp>();
    if QUEUE.set(sender).is_err() {
        return;
    }
    tokio::spawn(async move {
        while let Some(op) = receiver.recv().await {
            let (kind, payload) = match op {
                NodeOp::Update(update) => {
                    tracing::info!(version = %update.version, reason = %update.reason, "update from head office");
                    tokio::spawn(crate::edge::update::install(
                        update,
                        source.clone(),
                        data_dir.clone(),
                        stop.clone(),
                    ));
                    continue;
                }
                NodeOp::Plain { kind, payload } => (kind, payload),
            };
            tracing::info!(kind = %kind, reason = %payload.reason, "operation from head office");
            match kind.as_str() {
                NODE_RESTART => {
                    let source = source.clone();
                    let stop = stop.clone();
                    let force = payload.force;
                    tokio::spawn(async move {
                        let started = tokio::time::Instant::now();
                        loop {
                            let collecting = source.clone();
                            let open = tokio::task::spawn_blocking(move || collecting.collect().till.open_shifts)
                                .await
                                .unwrap_or(0);
                            if force || open == 0 || started.elapsed() >= RESTART_PATIENCE {
                                tracing::warn!("restarting at head office's request");
                                let _ = stop.send(StopReason::Restart);
                                return;
                            }
                            tracing::info!(open, "restart from head office waits for open drawers");
                            tokio::time::sleep(RESTART_RECHECK).await;
                        }
                    });
                }
                NODE_BACKUP => {
                    if let Some(dir) = data_dir.clone() {
                        let connection = source.connection.clone();
                        match tokio::task::spawn_blocking(move || crate::edge::backup::take(&connection, &dir)).await {
                            Ok(Ok(path)) => tracing::info!(path = %path.display(), "backup taken at head office's request"),
                            Ok(Err(error)) => tracing::warn!(%error, "backup requested by head office failed"),
                            Err(error) => tracing::warn!(%error, "backup task failed"),
                        }
                    }
                }
                NODE_DIAGNOSE => {
                    let report = crate::edge::diagnose::diagnose(data_dir.as_deref()).await;
                    crate::edge::diagnose::save(&report);
                    if let Err(error) = upload_diagnosis(&source, &report).await {
                        tracing::warn!(%error, "diagnosis could not be sent to head office");
                    }
                }
                other => tracing::warn!(kind = other, "unknown operation"),
            }
        }
    });
}

async fn upload_diagnosis(
    source: &Arc<StatusSource>,
    report: &crate::edge::diagnose::Report,
) -> Result<(), String> {
    let sync = source.sync.as_ref().ok_or("no cloud configured")?;
    let (base, key) = sync.cloud().ok_or("no cloud configured")?;
    let origin = std::env::var("INVENTORY_NODE_ID").unwrap_or_default();
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?
        .post(format!("{base}/api/v1/sync/diagnostics"))
        .header("x-sync-key", key)
        .json(&serde_json::json!({ "origin_id": origin, "report": report }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("head office answered {}", response.status()))
    }
}
