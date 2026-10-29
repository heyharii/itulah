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
//!
//! # When the node's address changes
//!
//! A shop's router hands its server a new address after a power cut, and a
//! till that only knew the old one would be a till that stopped selling. So a
//! till that joined keeps its node's mDNS names beside the address
//! (`node_instance`, `node_host`, which do not move when the address does —
//! `backend/src/edge/discovery.rs`), and when a call cannot even connect it
//! looks for the node on the LAN again (`discovery::refind`), takes the new
//! address only from a machine that answers as the same origin, keeps it, and
//! tries the call once more. Only when the connection never opened: a call
//! that reached the node and lost its answer might have been carried out, and
//! is not sent twice. The window hears `moved_to` and follows.
//!
//! Every call runs off the window's thread (`in_the_background`), so the few
//! seconds a look takes never freeze the counter.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

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
    /// Which node this till joined, and what it is called there. Written when
    /// a supervisor let this till in (`join.rs`); absent for a till paired the
    /// old way, or not at all. Shown, never trusted: what the node believes
    /// about this till is at the node.
    #[serde(default)]
    pub joined: Option<JoinedNode>,
    /// What is plugged into this till — the customer display, a desk reader,
    /// the drawer, a scanner, the receipt printer. Configuration of this till,
    /// not devices of their own; see `peripherals.rs`.
    #[serde(default)]
    pub peripherals: crate::peripherals::Peripherals,
    /// The node's DNS-SD instance (`itulah store-07-edge._itulah-store._tcp.local.`)
    /// and host (`store-07-edge.local`), kept beside `base_url` when the node
    /// was found on the LAN. They do not change when its address does, and are
    /// what [`refind_node`] looks for first. Hints only: whatever answers to
    /// them is taken only if it says it is the node this till joined.
    #[serde(default)]
    pub node_instance: Option<String>,
    #[serde(default)]
    pub node_host: Option<String>,
    /// The address this till followed its node away from, so a copy of these
    /// settings the window read before the move is not taken for somebody
    /// pointing the till back at a dead address.
    #[serde(default)]
    pub moved_from: Option<String>,
}

/// The node a till joined, as the node said when it let the till in.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JoinedNode {
    pub origin_id: String,
    pub site_id: String,
    /// The shop in head office's words when the till joined — `C004-TOKO`,
    /// `Bumiayu` — so Setelan can say which shop this counter belongs to. Only
    /// shown; absent when the node had not heard from head office yet.
    #[serde(default)]
    pub site_code: Option<String>,
    #[serde(default)]
    pub site_name: Option<String>,
    /// "Kasir 3": the label the node gave this till, or the one it inherited
    /// from the till it replaced. Also this terminal's `terminal_id`.
    pub label: String,
    /// Unix seconds.
    pub joined_at: i64,
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
            joined: None,
            peripherals: crate::peripherals::Peripherals::default(),
            node_instance: None,
            node_host: None,
            moved_from: None,
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
    settings_file(app, "node.json")
}

/// A file in this terminal's own settings directory. `join.rs` keeps a
/// request it is waiting on beside `node.json`, for the reasons given above.
pub(crate) fn settings_file(app: &tauri::AppHandle, name: &str) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join(name))
}

/// Read what was saved, if anything. A missing or unreadable file is not an
/// error: it is a terminal that has not been set up yet, which is exactly the
/// state the setup screen exists for.
pub fn load(app: &tauri::AppHandle) -> NodeConfig {
    let mut config: NodeConfig = config_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    crate::peripherals::apply_reader_recipe(&mut config.peripherals);
    config
}

pub(crate) fn save(app: &tauri::AppHandle, config: &NodeConfig) {
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
    /// The node's new address, when this call found it there after the old
    /// one stopped answering. The window re-reads the settings; nobody is
    /// signed out, because it is the same node.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub moved_to: Option<String>,
}

impl EdgeReply {
    pub(crate) fn unreachable(detail: String) -> Self {
        Self {
            ok: false,
            status: 0,
            body: serde_json::Value::Null,
            problem: Some(detail),
            moved_to: None,
        }
    }
}

/// The node's settings, whoever last panicked holding them: they are a plain
/// struct, and a till that stopped over a poisoned lock would stop selling.
pub(crate) fn lock(node: &Node) -> MutexGuard<'_, NodeConfig> {
    node.0.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Two spellings of one base URL.
pub(crate) fn same_base(one: &str, other: &str) -> bool {
    one.trim_end_matches('/')
        .eq_ignore_ascii_case(other.trim_end_matches('/'))
}

/// One signed call at a time. Each takes the next sequence number, and the
/// node refuses a number lower than one it has already seen: two calls on two
/// threads could arrive the other way round, and the second would be refused
/// as a replay.
static SIGNING: Mutex<()> = Mutex::new(());

/// When the node was last looked for, and the lock that makes one look at a
/// time: a till whose node vanished fires several calls at once, and one look
/// answers them all.
static REFINDING: Mutex<Option<Instant>> = Mutex::new(None);

/// How soon after one look for the node another may be made. A node that is
/// switched off is not found by looking harder, and every call that fails in
/// the meantime would otherwise wait out a listen of its own.
const REFIND_EVERY: Duration = Duration::from_secs(30);

/// Whether a failed call never reached the node at all — refused, timed out
/// while connecting, or a name that did not resolve. Only then is it safe to
/// look for the node elsewhere and send the call again.
fn never_connected(transport: &ureq::Transport) -> bool {
    matches!(
        transport.kind(),
        ureq::ErrorKind::ConnectionFailed | ureq::ErrorKind::Dns
    )
}

/// Look for this till's node on the LAN again, because the address it was at
/// has stopped answering, and keep the new one if it is the same node.
///
/// Only a till that joined knows which node it is looking for (`joined`); a
/// till paired the old way keeps the address it was given. The look takes a
/// few seconds and is made at most once every [`REFIND_EVERY`]; a call that
/// failed while another was looking uses what that look found. Returns the
/// base URL to try once more, or `None`.
fn refind_node(app: &tauri::AppHandle, failed_base: &str) -> Option<String> {
    let mut last = REFINDING.lock().unwrap_or_else(PoisonError::into_inner);
    let node = app.state::<Node>();
    let (current, origin, instance, host) = {
        let held = lock(node.inner());
        (
            held.base_url.clone(),
            held.joined.as_ref().map(|joined| joined.origin_id.clone()),
            held.node_instance.clone(),
            held.node_host.clone(),
        )
    };
    if !same_base(&current, failed_base) {
        // Followed while this call waited for the look.
        return Some(current);
    }
    let origin = origin?;
    if last.is_some_and(|at| at.elapsed() < REFIND_EVERY) {
        return None;
    }
    *last = Some(Instant::now());
    let found = crate::discovery::refind(&origin, instance.as_deref(), host.as_deref())?;
    let mut held = lock(node.inner());
    if !same_base(&held.base_url, failed_base) {
        return Some(held.base_url.clone());
    }
    if !same_base(&found.base_url, failed_base) {
        eprintln!(
            "the shop node moved from {failed_base} to {}; following it",
            found.base_url
        );
        held.moved_from = Some(held.base_url.clone());
        held.base_url = found.base_url.clone();
    }
    held.node_instance = Some(found.instance);
    held.node_host = Some(found.host);
    save(app, &held);
    Some(found.base_url)
}

/// What one attempt at a call came to.
enum Attempt {
    /// The node answered, or refused in a way looking elsewhere cannot fix.
    Answered(EdgeReply),
    /// The connection never opened: `base` did not answer at all.
    Unreached { base: String, why: String },
}

fn unreached_reply(base: &str, why: &str) -> EdgeReply {
    EdgeReply::unreachable(format!(
        "This till cannot reach its shop node at {base}. {why}"
    ))
}

/// Make a call, and when its node did not answer at all, look for the node
/// and make it once more wherever it is now.
fn with_refind(app: &tauri::AppHandle, mut attempt: impl FnMut() -> Attempt) -> EdgeReply {
    let (base, why) = match attempt() {
        Attempt::Answered(reply) => return reply,
        Attempt::Unreached { base, why } => (base, why),
    };
    let Some(found) = refind_node(app, &base) else {
        return unreached_reply(&base, &why);
    };
    let mut reply = match attempt() {
        Attempt::Answered(reply) => reply,
        Attempt::Unreached { base, why } => unreached_reply(&base, &why),
    };
    if !same_base(&found, &base) {
        reply.moved_to = Some(found);
    }
    reply
}

/// Run a call to the node off the window's thread. A call that could not even
/// be run comes back as a refusal, like every other failure at the counter.
async fn in_the_background(work: impl FnOnce() -> EdgeReply + Send + 'static) -> EdgeReply {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .unwrap_or_else(|error| EdgeReply::unreachable(format!("The call did not run: {error}")))
}

/// A till waits in front of a person. Ten seconds is already long enough that
/// a cashier has started apologising; beyond it the honest answer is that the
/// node is not there.
pub(crate) const PATIENCE: Duration = Duration::from_secs(10);

/// How long opening the connection may take, inside the patience above. A node
/// on the shop's LAN answers a connect in milliseconds; four seconds leaves
/// room for one lost handshake and no more.
const CONNECT_PATIENCE: Duration = Duration::from_secs(4);

/// An HTTP client that gives up on time.
///
/// Built per call with both timeouts set: ureq's default agent waits up to
/// thirty seconds to connect whatever a request's own timeout says, which is a
/// quote, a sale or a poll left hanging three times as long as a till is
/// meant to wait. Per call, as `ureq::request` already built one, so nothing is
/// pooled that was not pooled before.
pub(crate) fn http(patience: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_PATIENCE.min(patience))
        .timeout(patience)
        .build()
}

/// Run a blocking piece of work — an HTTP call, a few seconds of listening on
/// the LAN — off the window's thread, and hand back its answer.
///
/// For the commands `join.rs`, `discovery.rs` and `peripherals.rs` add. A
/// command without `async` runs on the main thread, and a till whose window
/// froze for the three seconds it spent listening for its node would look
/// like a till that had crashed.
pub(crate) async fn off_the_window<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn node_config(node: tauri::State<'_, Node>) -> NodeConfig {
    lock(node.inner()).clone()
}

#[tauri::command]
pub fn set_node_config(
    app: tauri::AppHandle,
    node: tauri::State<'_, Node>,
    next: NodeConfig,
) -> NodeConfig {
    let mut held = lock(node.inner());
    let mut next = next;
    crate::peripherals::apply_reader_recipe(&mut next.peripherals);
    // A copy read before the shell followed its node to a new address still
    // names the old one. That is the stale copy, not a person pointing this
    // till back at an address nothing answers at any more.
    if held
        .moved_from
        .as_deref()
        .is_some_and(|old| same_base(old, &next.base_url))
    {
        next.base_url = held.base_url.clone();
    }
    // The window hands back a copy it read earlier, and three things in it
    // are the shell's to keep, not the window's to set:
    //
    // - the sequence, which every signed call moves on *here*. A copy read
    //   before the roster call and saved after the claim would wind it back,
    //   and the node refuses a sequence it has seen as a replay — so it only
    //   ever goes forward;
    // - the peripherals, which only `set_peripherals` changes;
    // - which node this till joined, true until the till is pointed at
    //   another node or given another credential.
    next.pairing_sequence = next.pairing_sequence.max(held.pairing_sequence);
    next.peripherals = held.peripherals.clone();
    let same_node = next.base_url.trim_end_matches('/') == held.base_url.trim_end_matches('/');
    next.joined = if same_node && next.pairing_id == held.pairing_id {
        held.joined.clone()
    } else {
        None
    };
    // The node's names and where it moved from are the shell's too, and
    // belong to the node they were learned from.
    if same_node {
        next.node_instance = held.node_instance.clone();
        next.node_host = held.node_host.clone();
        next.moved_from = held.moved_from.clone();
    } else {
        next.node_instance = None;
        next.node_host = None;
        next.moved_from = None;
    }
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
    // The node keeps the SHA-256 of the secret and signs with that, not with
    // the secret itself — so this end has to hash first or nothing will verify.
    let key = digest_of(secret.as_bytes());
    let canonical = format!("{method}\n{path}\n{terminal}\n{timestamp}\n{sequence}\n{body_sha256}");
    hmac_hex(key.as_bytes(), canonical.as_bytes())
}

/// HMAC-SHA256, lowercase hex: `security::hmac_sha256_hex` on the node.
pub(crate) fn hmac_hex(key: &[u8], message: &[u8]) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let mut mac = <Hmac<Sha256>>::new_from_slice(key).expect("hmac takes any key");
    mac.update(message);
    hex(&mac.finalize().into_bytes())
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// SHA-256, lowercase hex: `security::sha256_hex` on the node.
pub(crate) fn digest_of(body: &[u8]) -> String {
    use sha2::Digest;
    hex(&sha2::Sha256::digest(body))
}

/// Unix seconds by this machine's clock.
pub(crate) fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_secs() as i64)
        .unwrap_or_default()
}

/// Call the node as this terminal, rather than as the person signed into it.
///
/// Two calls need this and no others: asking for the fingerprint roster, and
/// saying whose finger matched. Both happen when nobody is signed in yet, which
/// is exactly why a bearer token cannot be what carries them.
#[tauri::command]
pub async fn edge_signed_call(
    app: tauri::AppHandle,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
) -> EdgeReply {
    in_the_background(move || {
        let node = app.state::<Node>();
        signed_call(&app, node.inner(), &method, &path, body.as_ref())
    })
    .await
}

/// The signed call itself, for the shell's own callers as well as the
/// window's: `peripherals.rs` reports what is plugged into this till the same
/// way the window asks for the fingerprint roster.
///
/// Takes the lock on `node` itself; a caller must not be holding it. One at a
/// time ([`SIGNING`]), and sent once more, with the next sequence, wherever
/// the node is now if it never connected.
pub(crate) fn signed_call(
    app: &tauri::AppHandle,
    node: &Node,
    method: &str,
    path: &str,
    body: Option<&serde_json::Value>,
) -> EdgeReply {
    let _one_at_a_time = SIGNING.lock().unwrap_or_else(PoisonError::into_inner);
    with_refind(app, || signed_attempt(app, node, method, path, body))
}

fn signed_attempt(
    app: &tauri::AppHandle,
    node: &Node,
    method: &str,
    path: &str,
    body: Option<&serde_json::Value>,
) -> Attempt {
    signed_attempt_as(app, node, method, path, body, false)
}

/// Where Central Gudang ties the session signed in here to this machine.
const BIND_SESSION_PATH: &str = "/api/v1/store/warehouse/session";

/// Central Gudang: tie the session signed in at this warehouse PC to it.
///
/// One request carrying both the session's bearer token and this terminal's
/// signature, which only this machine can make: the node then lets a cashier
/// signed in here receive and move stock (`edge::devices::bind_session`).
/// Asked once after every sign-in; the token never leaves the shell for it.
#[tauri::command]
pub async fn edge_bind_session(app: tauri::AppHandle) -> EdgeReply {
    in_the_background(move || {
        let node = app.state::<Node>();
        let _one_at_a_time = SIGNING.lock().unwrap_or_else(PoisonError::into_inner);
        let body = serde_json::json!({});
        with_refind(&app, || {
            signed_attempt_as(
                &app,
                node.inner(),
                "POST",
                BIND_SESSION_PATH,
                Some(&body),
                true,
            )
        })
    })
    .await
}

/// A signed call, with the session's bearer token beside the signature when
/// `with_session` — the one call that needs both is [`edge_bind_session`].
fn signed_attempt_as(
    app: &tauri::AppHandle,
    node: &Node,
    method: &str,
    path: &str,
    body: Option<&serde_json::Value>,
    with_session: bool,
) -> Attempt {
    let (config, sequence) = {
        let mut held = lock(node);
        held.pairing_sequence += 1;
        (held.clone(), held.pairing_sequence)
    };
    // Persisted immediately, and before the call. A sequence spent on a request
    // that never arrived is a gap, which the node accepts; a sequence reused
    // because the terminal restarted is a replay, which it must not.
    save(app, &config);

    let (Some(terminal), Some(secret)) = (
        config.pairing_id.as_deref(),
        config.pairing_secret.as_deref(),
    ) else {
        return Attempt::Answered(EdgeReply::unreachable(
            "Terminal ini belum tergabung ke node toko, jadi belum boleh bicara \
             atas namanya sendiri. Gabungkan dulu di Setelan terminal."
                .into(),
        ));
    };

    if !path.starts_with('/') {
        return Attempt::Answered(EdgeReply::unreachable(format!(
            "“{path}” is not a path on the shop node."
        )));
    }

    let payload = body
        .map(|value| serde_json::to_vec(value).unwrap_or_default())
        .unwrap_or_default();
    let body_sha256 = digest_of(&payload);
    let timestamp = now_seconds();
    let signature = sign(
        secret,
        terminal,
        method,
        path,
        timestamp,
        sequence,
        &body_sha256,
    );

    let url = format!("{}{}", config.base_url.trim_end_matches('/'), path);
    let request = http(PATIENCE)
        .request(method, &url)
        .set("Accept", "application/json")
        .set("X-Terminal-Id", terminal)
        .set("X-Terminal-Timestamp", &timestamp.to_string())
        .set("X-Terminal-Sequence", &sequence.to_string())
        .set("X-Terminal-Signature", &signature);
    let request = match config.token.as_deref().filter(|_| with_session) {
        Some(token) => request.set("Authorization", &format!("Bearer {token}")),
        None => request,
    };

    let outcome = if payload.is_empty() {
        request.call()
    } else {
        request
            .set("Content-Type", "application/json")
            .send_bytes(&payload)
    };

    outcome_of(outcome, &config.base_url)
}

/// What a request came to, as an [`Attempt`]: an answer, or — when the
/// connection never opened — the address that did not answer.
fn outcome_of(outcome: Result<ureq::Response, ureq::Error>, base: &str) -> Attempt {
    match outcome {
        Ok(response) => Attempt::Answered(reply_from(
            response.status(),
            response.into_string().unwrap_or_default(),
        )),
        Err(ureq::Error::Status(status, response)) => Attempt::Answered(reply_from(
            status,
            response.into_string().unwrap_or_default(),
        )),
        Err(ureq::Error::Transport(transport)) if never_connected(&transport) => {
            Attempt::Unreached {
                base: base.to_string(),
                why: transport.to_string(),
            }
        }
        Err(transport) => Attempt::Answered(unreached_reply(base, &transport.to_string())),
    }
}

/// Call the shop's node.
///
/// `path` is a path, never a URL: the window names the endpoint it wants and
/// the shell decides which machine that is. A window that could pass an
/// absolute URL here is a window that could post the day's takings anywhere.
#[tauri::command]
pub async fn edge_call(
    app: tauri::AppHandle,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
) -> EdgeReply {
    in_the_background(move || session_call(&app, &method, &path, body.as_ref())).await
}

/// A product photograph as a `data:` URL, for the sale grid and the item card.
///
/// `edge_call` answers JSON, and a picture is bytes; the page's CSP allows
/// `img-src 'self' data:` only, so the picture comes back already wrapped.
/// `None` is every way of not having one (no photo, node down, too large) —
/// the grid draws a plain square and never a broken image. The node proxies
/// and caches the picture itself (`/api/v1/catalog/image?sku=`).
#[tauri::command]
pub async fn edge_image(app: tauri::AppHandle, sku: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || image_call(&app, &sku))
        .await
        .ok()
        .flatten()
}

fn image_call(app: &tauri::AppHandle, sku: &str) -> Option<String> {
    use std::io::Read;

    if sku.is_empty() || !sku.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return None;
    }
    let node = app.state::<Node>();
    let config = lock(node.inner()).clone();
    let url = format!(
        "{}/api/v1/catalog/image?sku={}",
        config.base_url.trim_end_matches('/'),
        sku
    );
    let mut request = http(PATIENCE)
        .get(&url)
        .set("X-Terminal-Id", &config.terminal_id);
    if let Some(token) = config.token.as_deref() {
        request = request.set("Authorization", &format!("Bearer {token}"));
    }
    let response = request.call().ok()?;
    let kind = response
        .header("Content-Type")
        .filter(|kind| kind.starts_with("image/"))
        .unwrap_or("image/jpeg")
        .to_string();
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(4 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some(format!("data:{kind};base64,{}", base64_of(&bytes)))
}

fn base64_of(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { ALPHABET[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { ALPHABET[n as usize & 63] as char } else { '=' });
    }
    out
}

/// The call as the person signed in here, for the shell's own callers too:
/// `printer.rs` asks the node for a receipt's bytes this way.
pub(crate) fn session_call(
    app: &tauri::AppHandle,
    method: &str,
    path: &str,
    body: Option<&serde_json::Value>,
) -> EdgeReply {
    if !path.starts_with('/') {
        return EdgeReply::unreachable(format!(
            "“{path}” is not a path on the shop node. The window names an endpoint; \
             the shell decides which machine that is."
        ));
    }
    let node = app.state::<Node>();
    with_refind(app, || session_attempt(node.inner(), method, path, body))
}

fn session_attempt(
    node: &Node,
    method: &str,
    path: &str,
    body: Option<&serde_json::Value>,
) -> Attempt {
    let config = lock(node).clone();
    let url = format!("{}{}", config.base_url.trim_end_matches('/'), path);
    let mut request = http(PATIENCE)
        .request(method, &url)
        .set("Accept", "application/json")
        .set("X-Terminal-Id", &config.terminal_id);
    if let Some(token) = config.token.as_deref() {
        request = request.set("Authorization", &format!("Bearer {token}"));
    }

    let outcome = match body {
        Some(payload) => request.send_json(payload),
        None => request.call(),
    };

    // A 4xx or 5xx is an answer, not a failure to reach: the node said no, and
    // what it said is the thing the cashier needs to read.
    outcome_of(outcome, &config.base_url)
}

pub(crate) fn reply_from(status: u16, text: String) -> EdgeReply {
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
        moved_to: None,
    }
}
