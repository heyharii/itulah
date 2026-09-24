//! The one way this terminal reaches its shop's node.
//!
//! The window cannot call the edge itself. A WebView served from `tauri://`
//! is a different origin to `http://till-01.local:8082`, and the edge sends no
//! CORS headers — deliberately: it serves its own SPA same-origin, and
//! `backend/src/cloud/http/mod.rs` is the only place in the estate that opens
//! an allow-list. Adding one to the edge so a desktop shell could skip this
//! file would widen the shop node's door for the convenience of one client.
//!
//! So every request goes through here instead, which also puts three things in
//! one place rather than thirty call sites: the node's address, the device
//! credential, and the timeout. None of them belong in JavaScript.
//!
//! # What this is not
//!
//! It is not a cache, and it is not a cart. It forwards and it returns. The
//! basket lives in the window — a tag scanned must be drawn before any wire is
//! touched — and everything the shop is the authority on (stock, price, the
//! sale, its sequence number, the cash session) stays at the node and is asked
//! for by name.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Manager;

/// Where the node is, and who we are to it.
///
/// Held in the shell rather than the page so that a terminal cannot be pointed
/// at another shop's node by anything the window loads.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NodeConfig {
    /// `http://127.0.0.1:8082` in development; the counter's own node on a
    /// shop LAN otherwise.
    pub base_url: String,
    /// Bearer token for the edge session. Both of our backends name their
    /// cookie the same thing, so a shell that used cookies would send the
    /// wrong one the moment a terminal also talked to the centre.
    pub token: Option<String>,
    /// Which till this is. Printed on receipts and carried on every sale.
    pub terminal_id: String,
    /// The receipt printer on this counter, as the NODE will reach it — not as
    /// this machine would. The node does the printing because it is the party
    /// on the printer's LAN, so this address is resolved there, and a printer
    /// that only this terminal can see is a printer the node cannot use.
    #[serde(default)]
    pub printer_host: Option<String>,
    #[serde(default = "default_printer_port")]
    pub printer_port: u16,
    /// `NARROW` (58mm) or `WIDE` (80mm).
    #[serde(default = "default_paper")]
    pub paper: String,
    /// What this terminal was called when it was paired with the node, and the
    /// secret it proves that with.
    ///
    /// Separate from `terminal_id` above, which is the name a person reads off
    /// the machine and that gets printed on a receipt. This pair is a
    /// credential: it is what lets the till ask for the fingerprint roster and
    /// say whose finger matched, and it is the reason a claim is worth
    /// anything. Absent until somebody pairs the terminal.
    #[serde(default)]
    pub pairing_id: Option<String>,
    #[serde(default)]
    pub pairing_secret: Option<String>,
    /// Strictly increasing, one per signed call. Persisted with the rest,
    /// because a counter that restarted and began again at one would be a
    /// counter whose every claim looks like a replay.
    #[serde(default)]
    pub pairing_sequence: i64,
    /// Whose finger to pretend matched, while there is no scanner to press.
    ///
    /// **Honoured only in a debug build** — the code that reads it is compiled
    /// out of a release, so a till in a shop cannot be talked into simulating a
    /// supervisor by editing a config file. It exists because the interesting
    /// half of this feature is not the sensor: it is the roster coming down,
    /// the claim being signed, the sequence being burned, the grant being spent
    /// once and expiring. All of that is testable on a machine with no scanner,
    /// and testing it was worth more than waiting for hardware.
    #[serde(default)]
    pub simulate_fingerprint: Option<String>,
}

fn default_printer_port() -> u16 {
    9100
}

fn default_paper() -> String {
    "NARROW".into()
}

impl Default for NodeConfig {
    fn default() -> Self {
        Self {
            base_url: "http://127.0.0.1:8082".into(),
            token: None,
            terminal_id: "POS-01".into(),
            printer_host: None,
            printer_port: default_printer_port(),
            paper: default_paper(),
            pairing_id: None,
            pairing_secret: None,
            pairing_sequence: 0,
            simulate_fingerprint: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::NodeConfig;

    #[test]
    fn new_till_points_at_the_store_edge_port() {
        assert_eq!(NodeConfig::default().base_url, "http://127.0.0.1:8082");
    }
}

#[derive(Default)]
pub struct Node(pub Mutex<NodeConfig>);

/// Where the terminal's own settings live between runs.
///
/// A till is set up once, by whoever installs it, and then used by people who
/// were never told what a node address is. Keeping this in memory would mean a
/// terminal that forgot which shop it belonged to every time it was closed —
/// and the person who finds it in the morning is a cashier, not the installer.
///
/// The token is written here too. That is a deliberate trade: it is a session
/// for one shop's node, held in the user's own config directory on the machine
/// that is allowed to use it, and the alternative — a sign-in before the first
/// customer every morning — is the kind of friction that gets solved at the
/// counter by writing the password on the monitor.
fn config_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("node.json"))
}

/// Read what was saved, if anything. A missing or unreadable file is not an
/// error: it is a terminal that has not been set up yet, which is exactly the
/// state the setup screen exists for.
pub fn load(app: &tauri::AppHandle) -> NodeConfig {
    config_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save(app: &tauri::AppHandle, config: &NodeConfig) {
    // A failure to write is reported and not fought over: the terminal keeps
    // working with what is in memory, and the next start asks again. Refusing
    // to sign somebody in because a config directory is read-only would stop a
    // till that is otherwise perfectly able to sell.
    if let Some(path) = config_path(app) {
        if let Ok(text) = serde_json::to_string_pretty(config) {
            if let Err(error) = std::fs::write(&path, text) {
                eprintln!("terminal settings could not be saved to {path:?}: {error}");
            }
        }
    }
}

/// What the window gets back, whatever happened.
///
/// A refusal is not an exception here. "Stock is short" and "the node is not
/// answering" are both ordinary at a counter and both have to be *shown* to a
/// cashier, so they come back as a value with a status rather than as a thrown
/// string the page has to parse.
#[derive(Serialize)]
pub struct EdgeReply {
    pub ok: bool,
    /// HTTP status, or 0 when nothing was reached at all.
    pub status: u16,
    /// Parsed JSON when the node sent JSON; otherwise null.
    pub body: serde_json::Value,
    /// Plain text for the cashier when `ok` is false.
    pub problem: Option<String>,
}

impl EdgeReply {
    fn unreachable(detail: String) -> Self {
        Self {
            ok: false,
            status: 0,
            body: serde_json::Value::Null,
            problem: Some(detail),
        }
    }
}

/// A till waits in front of a person. Ten seconds is already long enough that
/// a cashier has started apologising; beyond it the honest answer is that the
/// node is not there.
const PATIENCE: Duration = Duration::from_secs(10);

#[tauri::command]
pub fn node_config(node: tauri::State<'_, Node>) -> NodeConfig {
    node.0.lock().expect("node config").clone()
}

#[tauri::command]
pub fn set_node_config(
    app: tauri::AppHandle,
    node: tauri::State<'_, Node>,
    next: NodeConfig,
) -> NodeConfig {
    let mut held = node.0.lock().expect("node config");
    *held = next;
    save(&app, &held);
    held.clone()
}

/// The construction the node checks, written here once.
///
/// Deliberately identical to `sign_terminal_request` in
/// `backend/src/edge/fingerprint.rs`, which is itself the RFID lane's. The path
/// is inside the signature because a signature that did not name its endpoint
/// could be lifted off the roster call and spent on the claim call.
fn sign(
    secret: &str,
    terminal: &str,
    method: &str,
    path: &str,
    timestamp: i64,
    sequence: i64,
    body_sha256: &str,
) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    // The node keeps the SHA-256 of the secret and signs with that, not with
    // the secret itself — so this end has to hash first or nothing will verify.
    let key = hex(&{
        use sha2::Digest;
        sha2::Sha256::digest(secret.as_bytes())
    });
    let canonical = format!("{method}\n{path}\n{terminal}\n{timestamp}\n{sequence}\n{body_sha256}");
    let mut mac = <Hmac<Sha256>>::new_from_slice(key.as_bytes()).expect("hmac takes any key");
    mac.update(canonical.as_bytes());
    hex(&mac.finalize().into_bytes())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn digest_of(body: &[u8]) -> String {
    use sha2::Digest;
    hex(&sha2::Sha256::digest(body))
}

/// Call the node as this terminal, rather than as the person signed into it.
///
/// Two calls need this and no others: asking for the fingerprint roster, and
/// saying whose finger matched. Both happen when nobody is signed in yet, which
/// is exactly why a bearer token cannot be what carries them.
#[tauri::command]
pub fn edge_signed_call(
    app: tauri::AppHandle,
    node: tauri::State<'_, Node>,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
) -> EdgeReply {
    let (config, sequence) = {
        let mut held = node.0.lock().expect("node config");
        held.pairing_sequence += 1;
        (held.clone(), held.pairing_sequence)
    };
    // Persisted immediately, and before the call. A sequence spent on a request
    // that never arrived is a gap, which the node accepts; a sequence reused
    // because the terminal restarted is a replay, which it must not.
    save(&app, &config);

    let (Some(terminal), Some(secret)) = (
        config.pairing_id.as_deref(),
        config.pairing_secret.as_deref(),
    ) else {
        return EdgeReply::unreachable(
            "Terminal ini belum dipasangkan dengan node toko, jadi belum boleh              bicara atas namanya sendiri. Pasangkan dulu di Setelan terminal."
                .into(),
        );
    };

    if !path.starts_with('/') {
        return EdgeReply::unreachable(format!("“{path}” is not a path on the shop node."));
    }

    let payload = body
        .as_ref()
        .map(|value| serde_json::to_vec(value).unwrap_or_default())
        .unwrap_or_default();
    let body_sha256 = digest_of(&payload);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_secs() as i64)
        .unwrap_or_default();
    let signature = sign(
        secret,
        terminal,
        &method,
        &path,
        timestamp,
        sequence,
        &body_sha256,
    );

    let url = format!("{}{}", config.base_url.trim_end_matches('/'), path);
    let request = ureq::request(&method, &url)
        .timeout(PATIENCE)
        .set("Accept", "application/json")
        .set("X-Terminal-Id", terminal)
        .set("X-Terminal-Timestamp", &timestamp.to_string())
        .set("X-Terminal-Sequence", &sequence.to_string())
        .set("X-Terminal-Signature", &signature);

    let outcome = if payload.is_empty() {
        request.call()
    } else {
        request
            .set("Content-Type", "application/json")
            .send_bytes(&payload)
    };

    match outcome {
        Ok(response) => reply_from(
            response.status(),
            response.into_string().unwrap_or_default(),
        ),
        Err(ureq::Error::Status(status, response)) => {
            reply_from(status, response.into_string().unwrap_or_default())
        }
        Err(transport) => EdgeReply::unreachable(format!(
            "This till cannot reach its shop node at {}. {transport}",
            config.base_url
        )),
    }
}

/// Call the shop's node.
///
/// `path` is a path, never a URL: the window names the endpoint it wants and
/// the shell decides which machine that is. A window that could pass an
/// absolute URL here is a window that could post the day's takings anywhere.
#[tauri::command]
pub fn edge_call(
    node: tauri::State<'_, Node>,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
) -> EdgeReply {
    let config = node.0.lock().expect("node config").clone();

    if !path.starts_with('/') {
        return EdgeReply::unreachable(format!(
            "“{path}” is not a path on the shop node. The window names an endpoint; \
             the shell decides which machine that is."
        ));
    }

    let url = format!("{}{}", config.base_url.trim_end_matches('/'), path);
    let mut request = ureq::request(&method, &url)
        .timeout(PATIENCE)
        .set("Accept", "application/json")
        .set("X-Terminal-Id", &config.terminal_id);
    if let Some(token) = config.token.as_deref() {
        request = request.set("Authorization", &format!("Bearer {token}"));
    }

    let outcome = match body {
        Some(payload) => request.send_json(payload),
        None => request.call(),
    };

    match outcome {
        Ok(response) => reply_from(
            response.status(),
            response.into_string().unwrap_or_default(),
        ),
        // A 4xx or 5xx is an answer, not a failure to reach: the node said no,
        // and what it said is the thing the cashier needs to read.
        Err(ureq::Error::Status(status, response)) => {
            reply_from(status, response.into_string().unwrap_or_default())
        }
        Err(transport) => EdgeReply::unreachable(format!(
            "This till cannot reach its shop node at {}. {transport}",
            config.base_url
        )),
    }
}

fn reply_from(status: u16, text: String) -> EdgeReply {
    let body = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    let ok = (200..300).contains(&status);
    let problem = if ok {
        None
    } else {
        // The node's own wording when it gave one — it knows why it refused,
        // and a message invented here could only ever disagree with it.
        Some(
            body.get("message")
                .or_else(|| body.get("error"))
                .and_then(|value| value.as_str())
                .map(str::to_owned)
                .unwrap_or_else(|| {
                    if text.trim().is_empty() {
                        format!("The shop node refused this with a {status} and said nothing.")
                    } else {
                        text.clone()
                    }
                }),
        )
    };
    EdgeReply {
        ok,
        status,
        body,
        problem,
    }
}
