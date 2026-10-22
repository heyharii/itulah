//! A till joins its shop's node: it asks, shows a code, and waits for a
//! supervisor's yes.
//!
//! The node's half is `backend/src/edge/devices.rs`; the wire is
//! `backend/src/sync/device.rs`. This is the till's half, and it keeps one
//! promise above the others: **the key never leaves this machine.**
//!
//! # The steps
//!
//! 1. Mint a key here — 32 bytes from the operating system's generator.
//! 2. Send only its SHA-256 to `POST /api/v1/devices/join`. The node answers
//!    with a six-character code and a six-digit number derived from the code
//!    *and the digest*.
//! 3. Show both. A supervisor finds the same code in the list of waiting tills
//!    and checks the number matches the one on this screen: a request made by
//!    some other machine on the shop's wifi shows a different number, because
//!    it carries a different digest.
//! 4. Ask `POST /api/v1/devices/join/status` with an HMAC proof made from the
//!    digest, until the node says approved, refused or expired. Asking does
//!    not put anything on the wire a listener could replay into a credential.
//! 5. On approval, keep the node's `terminal_id` beside the key exactly as a
//!    till paired the old way keeps its pairing (`edge.rs`: `pairing_id`,
//!    `pairing_secret`), so every signed call after this is the same call it
//!    always was. The node keeps the digest and nothing else, as it always has.
//!
//! # Where the key is kept
//!
//! Where this terminal already keeps its pairing secret: the app's own config
//! directory, in the user profile of the machine allowed to use it (`edge.rs`
//! says why that trade was made). While a request is waiting, the key sits in
//! `join.json` beside `node.json` — so a till restarted mid-wait shows the
//! same code (the node answers the same key with the same request) instead of
//! leaving a second request in the supervisor's list. It is never sent to the
//! window: what the window gets is [`JoinView`], which has no key in it.
//!
//! # A supervisor at this till
//!
//! The node lets a waiting till in on a supervisor's finger or PIN pressed at a
//! till that has *already* joined — this one has not, so it cannot earn that
//! grant itself. What this till can offer is a supervisor's **sign-in**: the
//! node accepts a supervisor's session alone for a shop's first till, and an
//! Admin's always. So a supervisor standing here may sign in on the node this
//! till is joining, approve, and be signed out again; the token is held in
//! this process only, and dropped the moment they approve or step away. For
//! every till after the first, the node says (in its own words) to approve
//! from a till that has joined, and this screen shows that.

use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Manager;

use crate::discovery::{self, NodeIdentity};
use crate::edge::{self, EdgeReply, JoinedNode, Node};

const JOIN_PATH: &str = "/api/v1/devices/join";
const STATUS_PATH: &str = "/api/v1/devices/join/status";
const PENDING_FILE: &str = "join.json";

/// A status poll is repeated every few seconds; one that has not answered in
/// five is a node that is not there right now, and the next poll will ask
/// again.
const POLL_PATIENCE: Duration = Duration::from_secs(5);
/// Signing a supervisor out is a courtesy to the node. Not worth a wait.
const LEAVE_PATIENCE: Duration = Duration::from_secs(3);

/// A request this till has made and not heard the end of. `key` is the till's
/// secret; this struct never crosses to the window.
#[derive(Clone, Serialize, Deserialize)]
struct Pending {
    base_url: String,
    join_id: String,
    key: String,
    code: String,
    verification: String,
    expires_at: String,
    node: NodeIdentity,
    /// The node's DNS-SD instance and host, when it was found on the LAN
    /// rather than typed: kept by the till once it is let in, so it can find
    /// the node again when its address changes (`edge.rs`).
    #[serde(default)]
    instance: Option<String>,
    #[serde(default)]
    host: Option<String>,
}

/// A supervisor signed in at this till on the node it is joining.
struct Approver {
    base_url: String,
    token: String,
    username: String,
}

#[derive(Default)]
struct Held {
    pending: Option<Pending>,
    approver: Option<Approver>,
}

/// This till's join, while there is one.
#[derive(Default)]
pub struct Joining(Mutex<Held>);

impl Joining {
    /// Read a request left waiting when the app last closed.
    pub fn load(app: &tauri::AppHandle) -> Self {
        let pending = edge::settings_file(app, PENDING_FILE)
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<Pending>(&text).ok());
        Self(Mutex::new(Held {
            pending,
            approver: None,
        }))
    }
}

fn keep_pending(app: &tauri::AppHandle, pending: Option<&Pending>) {
    let Some(path) = edge::settings_file(app, PENDING_FILE) else {
        return;
    };
    match pending {
        Some(pending) => {
            if let Ok(text) = serde_json::to_string_pretty(pending) {
                if let Err(error) = std::fs::write(&path, text) {
                    eprintln!("the join request could not be kept at {path:?}: {error}");
                }
            }
        }
        // Forgotten means gone from the disk too: a key for a request nobody
        // will approve is a secret with no purpose, and a secret with no
        // purpose is the kind that gets copied off a machine.
        None => {
            let _ = std::fs::remove_file(&path);
        }
    }
}

/// What the window is shown. No key, no token.
#[derive(Serialize)]
pub struct JoinView {
    /// `PENDING`, `APPROVED` or `REFUSED`.
    pub status: String,
    pub base_url: String,
    /// `7K4-P9Q`, as the supervisor's screen prints it.
    pub code: Option<String>,
    /// The six digits read across the counter.
    pub verification: Option<String>,
    pub expires_at: Option<String>,
    pub node: Option<NodeIdentity>,
    /// For `APPROVED`: "Kasir 3".
    pub label: Option<String>,
    /// For `REFUSED`: `REJECTED`, `EXPIRED`, or `UNKNOWN` when the node no
    /// longer knows the request at all.
    pub reason: Option<String>,
    /// Who is signed in at this till to approve it, if anybody.
    pub approver: Option<String>,
}

fn waiting(pending: &Pending, approver: Option<&Approver>) -> JoinView {
    JoinView {
        status: "PENDING".into(),
        base_url: pending.base_url.clone(),
        code: Some(pending.code.clone()),
        verification: Some(pending.verification.clone()),
        expires_at: Some(pending.expires_at.clone()),
        node: Some(pending.node.clone()),
        label: None,
        reason: None,
        approver: approver.map(|who| who.username.clone()),
    }
}

fn finished(
    pending: &Pending,
    status: &str,
    label: Option<String>,
    reason: Option<String>,
) -> JoinView {
    JoinView {
        status: status.into(),
        base_url: pending.base_url.clone(),
        code: Some(pending.code.clone()),
        verification: Some(pending.verification.clone()),
        expires_at: Some(pending.expires_at.clone()),
        node: Some(pending.node.clone()),
        label,
        reason,
        approver: None,
    }
}

/// The node's `JoinAnswer`.
#[derive(Deserialize)]
struct Answer {
    join_id: String,
    code: String,
    verification: String,
    expires_at: String,
    #[serde(default)]
    node: NodeIdentity,
}

/// The node's `JoinStatus`.
#[derive(Deserialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
enum Status {
    Pending {
        code: String,
        verification: String,
        expires_at: String,
    },
    Approved {
        terminal_id: String,
        label: String,
        site_id: String,
        origin_id: String,
    },
    Refused {
        reason: String,
    },
}

/// 32 bytes from the operating system, as 64 hex characters. The same length
/// and alphabet a node's own random token has, so the digest the node keeps
/// looks like every other digest it keeps.
fn mint_key() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|error| format!("Kunci kasir tidak bisa dibuat di komputer ini: {error}"))?;
    Ok(edge::hex(&bytes))
}

/// What the node keeps: SHA-256 of the key, lowercase hex. The same digest
/// `edge.rs::sign` hashes the pairing secret to before signing with it.
fn key_digest(key: &str) -> String {
    edge::digest_of(key.as_bytes())
}

/// `join_status_proof` in `backend/src/sync/device.rs`.
fn status_proof(key: &str, join_id: &str) -> String {
    edge::hmac_hex(
        key_digest(key).as_bytes(),
        format!("join-status\n{join_id}").as_bytes(),
    )
}

/// What this machine says about itself: shown to the supervisor so they can
/// tell the PC in front of them from somebody else's, and trusted for nothing.
/// `MachineFacts` on the node.
fn machine() -> Value {
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|name| !name.trim().is_empty())
        .or_else(|| {
            // Windows always exports COMPUTERNAME, so this only runs on a Mac
            // or Linux till, where it opens no console window.
            std::process::Command::new("hostname")
                .output()
                .ok()
                .and_then(|output| String::from_utf8(output.stdout).ok())
                .map(|name| name.trim().to_string())
        })
        .unwrap_or_default();
    json!({
        "hostname": hostname,
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "version": env!("CARGO_PKG_VERSION"),
    })
}

/// Call a node that is not (yet) this till's node. `edge_call` always goes to
/// the configured node; a till joining another one has to name it.
fn call(
    base_url: &str,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<&Value>,
    patience: Duration,
) -> EdgeReply {
    let url = format!("{}{}", base_url.trim_end_matches('/'), path);
    let mut request = edge::http(patience)
        .request(method, &url)
        .set("Accept", "application/json");
    if let Some(token) = token {
        request = request.set("Authorization", &format!("Bearer {token}"));
    }
    let outcome = match body {
        Some(payload) => request.send_json(payload),
        None => request.call(),
    };
    match outcome {
        Ok(response) => edge::reply_from(
            response.status(),
            response.into_string().unwrap_or_default(),
        ),
        Err(ureq::Error::Status(status, response)) => {
            edge::reply_from(status, response.into_string().unwrap_or_default())
        }
        Err(transport) => EdgeReply::unreachable(format!(
            "Node toko di {base_url} tidak menjawab. {transport}"
        )),
    }
}

fn refusal(reply: EdgeReply, fallback: &str) -> String {
    reply.problem.unwrap_or_else(|| fallback.to_string())
}

/// Sign a supervisor out of the node and forget their token. Best effort: a
/// node that does not answer expires the session on its own.
fn leave(approver: Option<Approver>) {
    if let Some(approver) = approver {
        let _ = call(
            &approver.base_url,
            "POST",
            "/api/v1/auth/logout",
            Some(&approver.token),
            None,
            LEAVE_PATIENCE,
        );
    }
}

/// Forget the request and its key, here and on disk, and whoever was signed in
/// to approve it.
fn forget(app: &tauri::AppHandle) {
    let approver = {
        let joining = app.state::<Joining>();
        let mut held = joining.0.lock().expect("join state");
        held.pending = None;
        held.approver.take()
    };
    keep_pending(app, None);
    leave(approver);
}

/// The node said yes: this till is now the node's `terminal_id`, called
/// `label`, and signs with the key it minted.
fn adopt(
    app: &tauri::AppHandle,
    pending: &Pending,
    terminal_id: String,
    label: String,
    site_id: String,
    origin_id: String,
) {
    let node = app.state::<Node>();
    let mut held = node.0.lock().expect("node config");
    let moved = held.base_url.trim_end_matches('/') != pending.base_url.trim_end_matches('/');
    held.base_url = pending.base_url.clone();
    // A session another node issued means nothing at this one, and sending it
    // there would hand a machine in another building a credential that sells.
    if moved {
        held.token = None;
    }
    // The names the node answers to on the LAN, whatever its address: what
    // this till looks for when that address stops answering.
    held.node_instance = pending.instance.clone();
    held.node_host = pending.host.clone();
    held.moved_from = None;
    // The label is what a person reads off this counter and what a receipt
    // and a cash shift carry — and it is the one thing a replacement inherits,
    // so a till that took over "Kasir 2" picks up where Kasir 2 left off.
    held.terminal_id = label.clone();
    held.pairing_id = Some(terminal_id);
    held.pairing_secret = Some(pending.key.clone());
    // A new credential at the node starts with no sequence seen; the count the
    // old pairing burned means nothing to it.
    held.pairing_sequence = 0;
    held.joined = Some(JoinedNode {
        origin_id,
        site_id,
        // What the node said about its shop when this till asked: the code
        // and name a person reads, kept beside the ids nobody does.
        site_code: pending.node.site_code.clone(),
        site_name: pending.node.site_name.clone(),
        label,
        joined_at: edge::now_seconds(),
    });
    // What is plugged into this till has not been told to this identity yet.
    held.peripherals.unsent = true;
    edge::save(app, &held);
}

fn pending_of(app: &tauri::AppHandle) -> Result<Pending, String> {
    let joining = app.state::<Joining>();
    let held = joining.0.lock().expect("join state");
    let pending = held.pending.clone();
    pending.ok_or_else(|| "Tidak ada permintaan bergabung yang sedang menunggu.".to_string())
}

// ── commands ────────────────────────────────────────────────────────────

/// A request left waiting, so the window can pick it up after a restart.
/// Asks the node nothing.
#[tauri::command]
pub fn join_current(joining: tauri::State<'_, Joining>) -> Option<JoinView> {
    let held = joining.0.lock().expect("join state");
    let view = held
        .pending
        .as_ref()
        .map(|pending| waiting(pending, held.approver.as_ref()));
    view
}

/// Ask `base_url` to let this till join. `instance` and `host` are the
/// node's names on the LAN when it was found there, kept for finding it again.
#[tauri::command]
pub async fn join_begin(
    app: tauri::AppHandle,
    base_url: String,
    instance: Option<String>,
    host: Option<String>,
) -> Result<JoinView, String> {
    edge::off_the_window(move || {
        let tidy = |value: Option<String>| {
            value
                .map(|text| text.trim().to_string())
                .filter(|text| !text.is_empty())
        };
        let (instance, host) = (tidy(instance), tidy(host));
        let base = discovery::normalise_base(&base_url)?;
        // A request already open at this node keeps its key: the node answers
        // the same digest with the same code, and a new key would be a second
        // request sitting in the supervisor's list beside the first.
        let (key, stale_approver) = {
            let joining = app.state::<Joining>();
            let mut held = joining.0.lock().expect("join state");
            let reused = held
                .pending
                .as_ref()
                .filter(|pending| pending.base_url == base)
                .map(|pending| pending.key.clone());
            match reused {
                Some(key) => (key, None),
                None => (mint_key()?, held.approver.take()),
            }
        };
        leave(stale_approver);

        let body = json!({
            "key_sha256": key_digest(&key),
            "kind": "TILL",
            "machine": machine(),
        });
        let reply = call(&base, "POST", JOIN_PATH, None, Some(&body), edge::PATIENCE);
        if !reply.ok {
            if reply.status == 404 {
                return Err(format!(
                    "Node di {base} belum mengenal pendaftaran kasir — kemungkinan versi \
                     lama. Perbarui node, atau pasangkan terminal lewat Setelan."
                ));
            }
            return Err(refusal(reply, "Node menolak permintaan bergabung."));
        }
        let answer: Answer = serde_json::from_value(reply.body).map_err(|error| {
            format!("Node menjawab permintaan bergabung dalam bentuk yang tidak dikenal: {error}")
        })?;
        let pending = Pending {
            base_url: base,
            join_id: answer.join_id,
            key,
            code: answer.code,
            verification: answer.verification,
            expires_at: answer.expires_at,
            node: answer.node,
            instance,
            host,
        };
        keep_pending(&app, Some(&pending));
        let joining = app.state::<Joining>();
        let mut held = joining.0.lock().expect("join state");
        held.pending = Some(pending.clone());
        let view = waiting(&pending, held.approver.as_ref());
        Ok(view)
    })
    .await
}

/// Ask the node whether this till has been let in.
///
/// `Err` only when the node could not be asked — the window keeps polling. A
/// refusal is an answer (`REFUSED`), and so is approval, which this call also
/// acts on: the credential is kept and the request forgotten before the
/// window hears "yes".
#[tauri::command]
pub async fn join_poll(app: tauri::AppHandle) -> Result<JoinView, String> {
    edge::off_the_window(move || {
        let pending = pending_of(&app)?;
        let body = json!({
            "join_id": pending.join_id,
            "proof": status_proof(&pending.key, &pending.join_id),
        });
        let reply = call(
            &pending.base_url,
            "POST",
            STATUS_PATH,
            None,
            Some(&body),
            POLL_PATIENCE,
        );
        // The node refuses every proof it cannot match, in one wording, so the
        // endpoint cannot list requests. For this till that means the node no
        // longer holds the request — a node restored from a backup, say — and
        // asking again is the only way forward.
        if reply.status == 401 {
            forget(&app);
            return Ok(finished(&pending, "REFUSED", None, Some("UNKNOWN".into())));
        }
        if !reply.ok {
            return Err(refusal(reply, "Node tidak menjawab status permintaan."));
        }
        let status: Status = serde_json::from_value(reply.body).map_err(|error| {
            format!("Node menjawab status permintaan dalam bentuk yang tidak dikenal: {error}")
        })?;
        match status {
            Status::Pending {
                code,
                verification,
                expires_at,
            } => {
                let joining = app.state::<Joining>();
                let mut guard = joining.0.lock().expect("join state");
                // Through the guard once, so the request and the approver are
                // two fields of one struct rather than two borrows of a lock.
                let held: &mut Held = &mut guard;
                let Some(current) = held.pending.as_mut() else {
                    return Err("Permintaan bergabung dibatalkan.".into());
                };
                current.code = code;
                current.verification = verification;
                current.expires_at = expires_at;
                let view = waiting(current, held.approver.as_ref());
                Ok(view)
            }
            Status::Approved {
                terminal_id,
                label,
                site_id,
                origin_id,
            } => {
                adopt(
                    &app,
                    &pending,
                    terminal_id,
                    label.clone(),
                    site_id,
                    origin_id,
                );
                forget(&app);
                // Tell the node what is plugged into this till, now that it can
                // be told as this till. Not waited for: the window has better
                // news to show, and an unsent description goes again later.
                let handle = app.clone();
                std::thread::spawn(move || {
                    if let Err(problem) = crate::peripherals::report(&handle) {
                        eprintln!("peripherals not reported after joining: {problem}");
                    }
                });
                Ok(finished(&pending, "APPROVED", Some(label), None))
            }
            Status::Refused { reason } => {
                forget(&app);
                Ok(finished(&pending, "REFUSED", None, Some(reason)))
            }
        }
    })
    .await
}

/// Stop waiting. The request stays in the node's list until its quarter of an
/// hour is up — the node has no way to withdraw one — but this till forgets
/// the key, so nothing can come of it.
#[tauri::command]
pub async fn join_cancel(app: tauri::AppHandle) -> Result<(), String> {
    edge::off_the_window(move || {
        forget(&app);
        Ok(())
    })
    .await
}

/// A till at the node, as the replacement choice lists it.
#[derive(Serialize)]
pub struct TillRow {
    pub device_id: String,
    pub label: String,
    pub status: String,
    pub last_seen_at: Option<String>,
}

#[derive(Serialize)]
pub struct SupervisorHere {
    pub username: String,
    /// The tills this one could be replacing. Empty when the node would not
    /// list them to this person — `problem` says why.
    pub tills: Vec<TillRow>,
    pub problem: Option<String>,
}

/// A supervisor signs in, here, on the node this till is joining.
///
/// The password goes to the node and nowhere else; the token that comes back
/// is held in this process until [`join_approve_here`] spends it or
/// [`join_supervisor_leave`] drops it. Signing in at a node signs the same
/// person out of their other sessions there (one person, one device) — the
/// window says so before they type.
#[tauri::command]
pub async fn join_supervisor_sign_in(
    app: tauri::AppHandle,
    username: String,
    password: String,
) -> Result<SupervisorHere, String> {
    edge::off_the_window(move || {
        let pending = pending_of(&app)?;
        let username = username.trim().to_string();
        if username.is_empty() || password.is_empty() {
            return Err("Isi nama pengguna dan kata sandi supervisor.".into());
        }
        let reply = call(
            &pending.base_url,
            "POST",
            "/api/v1/auth/login",
            None,
            Some(&json!({ "username": username, "password": password })),
            edge::PATIENCE,
        );
        if !reply.ok {
            return Err(refusal(reply, "Node menolak nama dan kata sandi itu."));
        }
        let token = reply
            .body
            .get("token")
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
            .map(str::to_string)
            .ok_or_else(|| {
                "Node menerima kata sandi itu tetapi tidak mengirim sesi.".to_string()
            })?;

        // The tills already at this node, so a replacement can be named.
        let listed = call(
            &pending.base_url,
            "GET",
            "/api/v1/devices",
            Some(&token),
            None,
            edge::PATIENCE,
        );
        let (tills, problem) = if listed.ok {
            let tills = listed
                .body
                .get("items")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter(|item| item.get("kind").and_then(Value::as_str) == Some("TILL"))
                        .filter(|item| {
                            item.get("status").and_then(Value::as_str) != Some("REVOKED")
                        })
                        .filter_map(|item| {
                            Some(TillRow {
                                device_id: item.get("device_id")?.as_str()?.to_string(),
                                label: item
                                    .get("label")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default()
                                    .to_string(),
                                status: item
                                    .get("status")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default()
                                    .to_string(),
                                last_seen_at: item
                                    .get("last_seen_at")
                                    .and_then(Value::as_str)
                                    .map(str::to_string),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            (tills, None)
        } else {
            (Vec::new(), listed.problem)
        };

        let previous = {
            let joining = app.state::<Joining>();
            let mut held = joining.0.lock().expect("join state");
            held.approver.replace(Approver {
                base_url: pending.base_url.clone(),
                token,
                username: username.clone(),
            })
        };
        leave(previous);
        Ok(SupervisorHere {
            username,
            tills,
            problem,
        })
    })
    .await
}

/// The node's `ApprovedTill`, the parts the window shows.
#[derive(Serialize, Deserialize)]
pub struct ApprovedHere {
    pub label: String,
    #[serde(default)]
    pub approved_by: String,
    #[serde(default)]
    pub replaced_terminal_id: Option<String>,
}

/// The supervisor signed in here approves this till, as a new till or as the
/// replacement for one already at the node (which then keeps its label).
///
/// On a refusal the session is kept, so they can change the choice and try
/// again; on success it is signed out at once.
#[tauri::command]
pub async fn join_approve_here(
    app: tauri::AppHandle,
    replaces_terminal_id: Option<String>,
    label: Option<String>,
) -> Result<ApprovedHere, String> {
    edge::off_the_window(move || {
        let pending = pending_of(&app)?;
        let token = {
            let joining = app.state::<Joining>();
            let held = joining.0.lock().expect("join state");
            held.approver
                .as_ref()
                .filter(|approver| approver.base_url == pending.base_url)
                .map(|approver| approver.token.clone())
        }
        .ok_or_else(|| "Supervisor belum masuk di kasir ini.".to_string())?;
        let tidy = |value: Option<String>| {
            value
                .map(|text| text.trim().to_string())
                .filter(|text| !text.is_empty())
        };
        let body = json!({
            "replaces_terminal_id": tidy(replaces_terminal_id),
            "label": tidy(label),
        });
        let reply = call(
            &pending.base_url,
            "POST",
            &format!("/api/v1/devices/joins/{}/approve", pending.join_id),
            Some(&token),
            Some(&body),
            edge::PATIENCE,
        );
        if !reply.ok {
            return Err(refusal(reply, "Node menolak persetujuan ini."));
        }
        let approved: ApprovedHere = serde_json::from_value(reply.body).map_err(|error| {
            format!("Node menyetujui, tetapi jawabannya tidak dikenal: {error}")
        })?;
        let approver = {
            let joining = app.state::<Joining>();
            let mut held = joining.0.lock().expect("join state");
            held.approver.take()
        };
        leave(approver);
        Ok(approved)
    })
    .await
}

/// The supervisor steps away without approving: signed out, token dropped.
#[tauri::command]
pub async fn join_supervisor_leave(app: tauri::AppHandle) -> Result<(), String> {
    edge::off_the_window(move || {
        let approver = {
            let joining = app.state::<Joining>();
            let mut held = joining.0.lock().expect("join state");
            held.approver.take()
        };
        leave(approver);
        Ok(())
    })
    .await
}
