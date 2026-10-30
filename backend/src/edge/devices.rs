//! The devices enrolled to this node: a till joining, a printer recorded, and
//! every one of them reported to head office.
//!
//! # A till joins by asking, and head office says yes
//!
//! The till mints its own secret, sends only the SHA-256 of it, and shows the
//! short code and six-digit number it gets back ([`begin_join`]). The node
//! reports every waiting till in its heartbeat ([`waiting_joins`]); head
//! office sees the same code and number on the store's POS tab in the hub and
//! approves or refuses it, into a free seat, with a signed
//! `device.join.decide.v1` ([`apply_join_decision`]). The till learns it has
//! been let in by asking with a proof only the key's holder can make
//! ([`join_status`]), and from then on signs every request exactly as a till
//! paired the old way does (`edge/fingerprint.rs`, [`TerminalProof`]) — the
//! node keeps the digest and nothing else, as it always has.
//!
//! **Who may say yes.** Head office (owner, 24 Oct 2026: the store opens and
//! closes its day and sets nothing up). An Admin signed in at the shop is head
//! office there and may still approve or refuse ([`approve_join`],
//! [`refuse_join`]); a supervisor may not, with a finger or without one.
//!
//! The till is labelled "Kasir N", the lowest number no live till at this node
//! is using, unless the approver names it or it replaces a till — then it takes
//! the old one's name, and the old one is revoked and kept. Not while the old
//! till's drawer is open: a shift is kept by the till's name, and a replacement
//! let in then would take the old shift's money as its own
//! ([`refuse_while_shift_open`]).
//!
//! A warehouse PC (Central Gudang, `WAREHOUSE`, 25 Oct 2026) joins the same way
//! and is labelled "Gudang N" by the same rule. It is never a till seat, it
//! replaces only another warehouse PC, and it does not sell
//! ([`warehouse_refusal`]).
//!
//! # Printers are recorded once
//!
//! A network printer is written down with its address ([`record_printer`]) and
//! chosen by id from then on ([`resolve_printer`]); a request that still sends
//! a host and port is untouched. A USB printer on a till is a peripheral of
//! that till, not a device: see [`set_peripherals`].
//!
//! # Head office sees all of it
//!
//! [`list_devices`] is what the heartbeat carries (`edge/status.rs`) and what
//! the cloud's registry is fed from. Head office's suspend and revoke arrive as
//! a `device.status.set.v1` command ([`apply_status_command`]).
//!
//! # A test page, asked for from head office
//!
//! `device.test_print.v1` ([`apply_test_print_command`]) is kept in
//! `edge_device_request` until it is carried out. A network printer's page
//! this node prints itself ([`spawn_test_printer`]); a till's the till prints
//! on its own receipt printer, picking the ask up with its signed poll
//! ([`till_requests`]) and reporting back ([`record_till_test_print`]). The
//! outcome is kept on the device's row and reported in the heartbeat.

use chrono::{DateTime, Duration, FixedOffset, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::edge::contracts::{EdgeError, NodeContext};
use crate::edge::domain::Role;
use crate::edge::fingerprint::{self, TerminalProof};
use crate::security;
use crate::sync::device::{
    self as wire, DeviceReport, DeviceStatusCommand, DeviceTestPrintCommand, JoinAnswer,
    JoinRequest, JoinStatus, JoinStatusRequest, NodeIdentity, TestPrintResult, TillRequest,
    TillRequests, KIND_PRINTER, KIND_RFID_READER, KIND_TILL, KIND_WAREHOUSE, STATUS_ACTIVE,
    STATUS_REVOKED, STATUS_SUSPENDED,
};
use crate::sync::enrolment::is_key_digest;

fn db(error: rusqlite::Error) -> EdgeError {
    EdgeError::Persistence(error.to_string())
}

/// One fixed-width spelling for every time this module writes, so the text
/// comparisons in its SQL (`expires_at > ?now`) are comparisons of times.
fn stamp(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn parse_stamp(value: &str) -> Result<DateTime<Utc>, EdgeError> {
    DateTime::parse_from_rfc3339(value)
        .map(|at| at.with_timezone(&Utc))
        .map_err(|error| EdgeError::Persistence(format!("invalid timestamp {value}: {error}")))
}

/// A stored time read back for a report: anything unreadable is "not known",
/// never a failed heartbeat.
fn parse_time(value: Option<String>) -> Option<DateTime<Utc>> {
    value
        .and_then(|text| DateTime::parse_from_rfc3339(&text).ok())
        .map(|at| at.with_timezone(&Utc))
}

fn parse_uuid(value: Option<String>) -> Option<Uuid> {
    value.and_then(|text| Uuid::parse_str(&text).ok())
}

fn parse_json(value: Option<String>) -> Value {
    value
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(Value::Null)
}

fn poisoned() -> EdgeError {
    EdgeError::Persistence("edge connection is poisoned".into())
}

/// Lock a node connection, for callers holding the shared handle.
pub fn lock(
    connection: &std::sync::Mutex<Connection>,
) -> Result<std::sync::MutexGuard<'_, Connection>, EdgeError> {
    connection.lock().map_err(|_| poisoned())
}

fn record_event(
    connection: &Connection,
    device_id: &str,
    kind: &str,
    event: &str,
    actor: &str,
    reason: Option<&str>,
    at: DateTime<Utc>,
) -> Result<(), EdgeError> {
    connection
        .execute(
            "INSERT INTO edge_device_event (event_id,device_id,kind,event,actor,reason,at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![
                Uuid::new_v4().to_string(),
                device_id,
                kind,
                event,
                actor,
                reason,
                stamp(at)
            ],
        )
        .map_err(db)?;
    Ok(())
}

// ════════════════════════════════════════════════════════════════════════════
// Who this node is
// ════════════════════════════════════════════════════════════════════════════

/// What `GET /api/v1/node/identity` answers to anybody on the shop's LAN.
///
/// The site's display code and name come from what head office last said
/// about this node's own site (`edge::site_profile`), never from the site id:
/// a till shows "C004-TOKO · Bumiayu", and only falls back to the id while the
/// node has not heard. Both are printed on the shop's receipts already, so
/// they are no more secret than the rest of the answer.
pub fn node_identity(connection: &Connection, node: &NodeContext) -> NodeIdentity {
    let site = crate::edge::site_profile::own(connection);
    NodeIdentity {
        service: wire::NODE_SERVICE.to_string(),
        origin_id: node.node_id.clone(),
        site_id: node.site_id.to_string(),
        site_code: site
            .as_ref()
            .and_then(|site| site.code.clone())
            .filter(|code| !code.trim().is_empty()),
        site_name: site
            .map(|site| site.name)
            .filter(|name| !name.trim().is_empty()),
        node_role: node.role.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        join_path: wire::JOIN_PATH.to_string(),
    }
}

// ════════════════════════════════════════════════════════════════════════════
// A till joining
// ════════════════════════════════════════════════════════════════════════════

/// Close every undecided request whose quarter of an hour is up. Run at the
/// top of each join transaction, so the list a supervisor reads and the codes
/// a new till can be given never include a request nobody can approve.
fn expire_stale_joins(connection: &Connection, now: DateTime<Utc>) -> Result<(), EdgeError> {
    connection
        .execute(
            "UPDATE edge_device_join
                SET outcome='EXPIRED', decided_by='system', decided_via='SYSTEM', decided_at=?1
              WHERE outcome IS NULL AND expires_at <= ?1",
            params![stamp(now)],
        )
        .map_err(db)?;
    Ok(())
}

/// A till asks to join. Unauthenticated by necessity — the till has nothing
/// to authenticate with yet — and bounded instead: a well-formed digest, at
/// most [`wire::MAX_OPEN_JOINS`] waiting at once, fifteen minutes each, and
/// nothing happens until a supervisor who can see the till says yes.
///
/// Asking twice with the same key is the same request: a till that lost the
/// answer to a timeout is shown the code it already has.
pub fn begin_join(
    connection: &mut Connection,
    node: &NodeContext,
    request: JoinRequest,
) -> Result<JoinAnswer, EdgeError> {
    let key_sha256 = request.key_sha256.trim().to_ascii_lowercase();
    if !is_key_digest(&key_sha256) {
        return Err(EdgeError::Validation(
            "key_sha256 must be the SHA-256 of the key this till minted, in lowercase hex".into(),
        ));
    }
    let kind = request
        .kind
        .as_deref()
        .map(str::trim)
        .filter(|kind| !kind.is_empty())
        .unwrap_or(KIND_TILL)
        .to_ascii_uppercase();
    if !wire::joins_by_code(&kind) {
        return Err(EdgeError::Validation(format!(
            "a {kind} does not join a node this way; only a till or a warehouse PC does"
        )));
    }
    let machine_json = serde_json::to_string(&request.machine.clamped())
        .map_err(|error| EdgeError::Persistence(error.to_string()))?;

    let now = Utc::now();
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    expire_stale_joins(&tx, now)?;
    // Read inside the transaction, before it is spent: the site's code and
    // name come from this node's own tables.
    let identity = node_identity(&tx, node);

    let existing: Option<(String, String, String, String)> = tx
        .query_row(
            "SELECT join_id, code, verification, expires_at FROM edge_device_join
              WHERE key_sha256=?1 AND outcome IS NULL",
            params![key_sha256],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(db)?;
    if let Some((join_id, code, verification, expires_at)) = existing {
        tx.commit().map_err(db)?;
        return Ok(JoinAnswer {
            join_id: Uuid::parse_str(&join_id)
                .map_err(|error| EdgeError::Persistence(error.to_string()))?,
            code: wire::display_join_code(&code),
            verification,
            expires_at: parse_stamp(&expires_at)?,
            node: identity,
        });
    }

    let open: i64 = tx
        .query_row(
            "SELECT count(*) FROM edge_device_join WHERE outcome IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(db)?;
    if open >= wire::MAX_OPEN_JOINS {
        return Err(EdgeError::Conflict(
            "too many tills are already waiting for a supervisor at this shop; \
             approve or refuse those first"
                .into(),
        ));
    }
    // A key that already signs for a live till is not a new till. Refused
    // rather than quietly accepted, because two rows answering to one key
    // would make "which till said this" unanswerable.
    let in_use: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM edge_terminal
                            WHERE auth_key_sha256=?1 AND status<>'REVOKED')",
            params![key_sha256],
            |row| row.get(0),
        )
        .map_err(db)?;
    if in_use {
        return Err(EdgeError::Conflict(
            "that key already belongs to a till at this node; mint a new one".into(),
        ));
    }

    let mut code = None;
    for _ in 0..8 {
        let candidate = wire::random_join_code();
        let taken: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM edge_device_join WHERE code=?1 AND outcome IS NULL)",
                params![candidate],
                |row| row.get(0),
            )
            .map_err(db)?;
        if !taken {
            code = Some(candidate);
            break;
        }
    }
    let code =
        code.ok_or_else(|| EdgeError::Conflict("no free join code right now; try again".into()))?;
    let verification = wire::join_verification(&code, &key_sha256);
    let join_id = Uuid::new_v4();
    let expires_at = now + Duration::minutes(wire::JOIN_TTL_MINUTES);
    tx.execute(
        "INSERT INTO edge_device_join
           (join_id,kind,code,key_sha256,verification,machine_json,issued_at,expires_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            join_id.to_string(),
            kind,
            code,
            key_sha256,
            verification,
            machine_json,
            stamp(now),
            stamp(expires_at)
        ],
    )
    .map_err(db)?;
    tx.commit().map_err(db)?;
    Ok(JoinAnswer {
        join_id,
        code: wire::display_join_code(&code),
        verification,
        expires_at,
        node: identity,
    })
}

/// Where a till's request stands. Answered only to a proof made with the key
/// the request carried ([`wire::join_status_proof`]); every other caller gets
/// the same refusal, so the endpoint cannot be used to list join ids.
pub fn join_status(
    connection: &mut Connection,
    node: &NodeContext,
    request: &JoinStatusRequest,
) -> Result<JoinStatus, EdgeError> {
    let refuse = || EdgeError::Unauthorized("join status refused".into());
    let now = Utc::now();
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    expire_stale_joins(&tx, now)?;
    let row: Option<(
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
    )> = tx
        .query_row(
            "SELECT code, key_sha256, verification, expires_at, outcome, terminal_id
               FROM edge_device_join WHERE join_id=?1",
            params![request.join_id.to_string()],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()
        .map_err(db)?;
    let Some((code, key_sha256, verification, expires_at, outcome, terminal_id)) = row else {
        return Err(refuse());
    };
    let expected = wire::join_status_proof(&key_sha256, &request.join_id);
    if !security::constant_time_eq(&request.proof.trim().to_ascii_lowercase(), &expected) {
        return Err(refuse());
    }
    let status = match outcome.as_deref() {
        None => JoinStatus::Pending {
            code: wire::display_join_code(&code),
            verification,
            expires_at: parse_stamp(&expires_at)?,
        },
        Some("APPROVED") => {
            let terminal_id = terminal_id
                .ok_or_else(|| EdgeError::Persistence("an approved join names no till".into()))?;
            let label: String = tx
                .query_row(
                    "SELECT label FROM edge_terminal WHERE terminal_id=?1",
                    params![terminal_id],
                    |row| row.get(0),
                )
                .map_err(db)?;
            tx.execute(
                "UPDATE edge_device_join SET delivered_at=COALESCE(delivered_at, ?2)
                  WHERE join_id=?1",
                params![request.join_id.to_string(), stamp(now)],
            )
            .map_err(db)?;
            JoinStatus::Approved {
                terminal_id,
                label,
                site_id: node.site_id.to_string(),
                origin_id: node.node_id.clone(),
            }
        }
        Some(other) => JoinStatus::Refused {
            reason: other.to_string(),
        },
    };
    tx.commit().map_err(db)?;
    Ok(status)
}

/// One till waiting for a supervisor, as the approval screen shows it.
#[derive(Debug, Serialize)]
pub struct PendingJoin {
    pub join_id: String,
    pub kind: String,
    /// In its display form, as the till prints it.
    pub code: String,
    pub verification: String,
    /// What the till said about itself: hostname, OS, version.
    pub machine: Value,
    pub issued_at: String,
    pub expires_at: String,
}

/// The tills waiting at this node, oldest first. Nothing in a row is a
/// secret: the code and the number are on the till's own screen.
pub fn pending_joins(connection: &Connection) -> Result<Vec<PendingJoin>, EdgeError> {
    let now = stamp(Utc::now());
    let mut statement = connection
        .prepare(
            "SELECT join_id, kind, code, verification, machine_json, issued_at, expires_at
               FROM edge_device_join
              WHERE outcome IS NULL AND expires_at > ?1
              ORDER BY issued_at",
        )
        .map_err(db)?;
    let rows = statement
        .query_map(params![now], |row| {
            let code: String = row.get(2)?;
            Ok(PendingJoin {
                join_id: row.get(0)?,
                kind: row.get(1)?,
                code: wire::display_join_code(&code),
                verification: row.get(3)?,
                machine: parse_json(row.get(4)?),
                issued_at: row.get(5)?,
                expires_at: row.get(6)?,
            })
        })
        .map_err(db)?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(db)?);
    }
    Ok(items)
}

/// An Admin's choices at the shop. All optional: an empty body approves the
/// till under the next free "Kasir N".
#[derive(Debug, Default, Deserialize)]
pub struct ApproveJoinRequest {
    #[serde(default)]
    pub label: Option<String>,
    /// The till this one takes over from. It is revoked in the same
    /// transaction and its row kept; the new till takes its label.
    #[serde(default)]
    pub replaces_terminal_id: Option<String>,
    /// A supervisor's finger or PIN, from before head office decided (24 Oct
    /// 2026). Still read, so an older POS's body is not refused for carrying
    /// it, and never spent: a supervisor no longer lets a till in.
    #[serde(default)]
    pub authorization: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ApprovedTill {
    pub join_id: String,
    pub terminal_id: String,
    pub label: String,
    pub approved_by: String,
    /// `GRANT` (a finger or PIN) or `SESSION`.
    pub approved_via: String,
    pub replaced_terminal_id: Option<String>,
}

/// Let a waiting till in.
///
/// `session` is who is signed in on the device the approval came from, or
/// `None` on a node running with authentication disabled. See the module
/// note for who may approve and why.
pub fn approve_join(
    connection: &mut Connection,
    join_id: &str,
    request: ApproveJoinRequest,
    session: Option<(&str, Role)>,
) -> Result<ApprovedTill, EdgeError> {
    // Head office lets a POS in (owner, 24 Oct 2026). An Admin signed in here
    // is head office at the shop; nobody else at the shop says yes, by finger
    // or otherwise. A grant in the body is left unspent.
    let approver = match session {
        // Authentication is off on this node: nobody to ask.
        None => "api".to_string(),
        Some((username, role)) if role >= Role::Admin => username.to_string(),
        Some(_) => {
            return Err(EdgeError::Forbidden(
                "POS baru disetujui kantor pusat, di halaman toko di Central.".into(),
            ));
        }
    };
    let now = Utc::now();
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    expire_stale_joins(&tx, now)?;
    let approved = admit(
        &tx,
        join_id,
        request.label.as_deref(),
        request.replaces_terminal_id.as_deref(),
        &approver,
        "SESSION",
        now,
    )?;
    tx.commit().map_err(db)?;
    Ok(approved)
}

/// Let the waiting till `join_id` in, inside the caller's transaction: the
/// till it replaces revoked, its name chosen, its row written. Shared by an
/// Admin at the shop ([`approve_join`]) and head office's decision
/// ([`apply_join_decision`]).
fn admit(
    tx: &Connection,
    join_id: &str,
    label: Option<&str>,
    replaces_terminal_id: Option<&str>,
    approver: &str,
    via: &str,
    now: DateTime<Utc>,
) -> Result<ApprovedTill, EdgeError> {
    let approver = approver.to_string();
    let row: Option<(String, String, String, Option<String>, String)> = tx
        .query_row(
            "SELECT code, key_sha256, machine_json, outcome, kind
               FROM edge_device_join WHERE join_id=?1",
            params![join_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(db)?;
    let Some((code, key_sha256, machine_json, outcome, kind)) = row else {
        return Err(EdgeError::NotFound(format!("join request {join_id}")));
    };
    // A till or a warehouse PC, as it asked: each takes its own kind of name
    // and replaces only its own kind.
    let kind = terminal_kind(&kind);
    if let Some(outcome) = outcome {
        return Err(EdgeError::Conflict(format!(
            "that request is already {}",
            outcome.to_ascii_lowercase()
        )));
    }
    let shown_code = wire::display_join_code(&code);

    // The till it replaces, revoked first so its label is free to inherit.
    let replaced = match replaces_terminal_id
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        Some(old_id) => {
            let old: Option<(String, String, String)> = tx
                .query_row(
                    "SELECT label, status, kind FROM edge_terminal WHERE terminal_id=?1",
                    params![old_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()
                .map_err(db)?;
            let Some((old_label, old_status, old_kind)) = old else {
                return Err(EdgeError::NotFound(format!("till {old_id}")));
            };
            if old_status == STATUS_REVOKED {
                return Err(EdgeError::Conflict(format!(
                    "{old_label} is already revoked; approve without replacing it"
                )));
            }
            if terminal_kind(&old_kind) != kind {
                return Err(EdgeError::Conflict(format!(
                    "{old_label} is a {}, and this one is a {}; approve without replacing it",
                    kind_word(terminal_kind(&old_kind)),
                    kind_word(kind)
                )));
            }
            refuse_while_shift_open(&tx, old_id, &old_label)?;
            let reason = format!("replaced by the till that joined with code {shown_code}");
            tx.execute(
                "UPDATE edge_terminal
                    SET status='REVOKED', active=0, status_changed_at=?2, status_changed_by=?3,
                        status_reason=?4, updated_at=?2
                  WHERE terminal_id=?1",
                params![old_id, stamp(now), approver, reason],
            )
            .map_err(db)?;
            record_event(
                &tx,
                old_id,
                kind,
                "REPLACED",
                &approver,
                Some(reason.as_str()),
                now,
            )?;
            Some((old_id.to_string(), old_label))
        }
        None => None,
    };

    let label = match label.map(str::trim).filter(|label| !label.is_empty()) {
        Some(label) if label.chars().count() > 64 => {
            return Err(EdgeError::Validation(
                "a till's label is at most 64 characters".into(),
            ));
        }
        Some(label) => label.to_string(),
        None => match &replaced {
            Some((_, old_label)) => old_label.clone(),
            None => {
                let mut statement = tx
                    .prepare("SELECT label FROM edge_terminal WHERE status <> 'REVOKED'")
                    .map_err(db)?;
                let rows = statement
                    .query_map([], |row| row.get::<_, String>(0))
                    .map_err(db)?;
                let mut taken = Vec::new();
                for row in rows {
                    taken.push(row.map_err(db)?);
                }
                wire::next_label(wire::label_prefix(kind), taken.iter().map(String::as_str))
            }
        },
    };
    let clash: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM edge_terminal WHERE label=?1 AND status<>'REVOKED')",
            params![label],
            |row| row.get(0),
        )
        .map_err(db)?;
    if clash {
        return Err(EdgeError::Conflict(format!(
            "another till at this shop is already called {label}"
        )));
    }

    let terminal_id = format!("term-{}", Uuid::new_v4());
    let replaced_id = replaced.as_ref().map(|(id, _)| id.clone());
    tx.execute(
        "INSERT INTO edge_terminal
           (terminal_id,label,auth_key_sha256,active,last_sequence,paired_at,paired_by,updated_at,
            kind,status,join_id,replaces_terminal_id,machine_json,peripherals_json)
         VALUES (?1,?2,?3,1,0,?4,?5,?4,?9,'ACTIVE',?6,?7,?8,'{}')",
        params![
            terminal_id,
            label,
            key_sha256,
            stamp(now),
            approver,
            join_id,
            replaced_id,
            machine_json,
            kind
        ],
    )
    .map_err(db)?;
    tx.execute(
        "UPDATE edge_device_join
            SET outcome='APPROVED', decided_by=?2, decided_via=?3, decided_at=?4,
                terminal_id=?5, replaces_terminal_id=?6
          WHERE join_id=?1",
        params![join_id, approver, via, stamp(now), terminal_id, replaced_id],
    )
    .map_err(db)?;
    record_event(
        &tx,
        &terminal_id,
        kind,
        "JOINED",
        &approver,
        Some(format!("joined with code {shown_code}").as_str()),
        now,
    )?;
    Ok(ApprovedTill {
        join_id: join_id.to_string(),
        terminal_id,
        label,
        approved_by: approver,
        approved_via: via.to_string(),
        replaced_terminal_id: replaced_id,
    })
}

/// `edge_terminal.kind` and `edge_device_join.kind` as one of the two kinds
/// that join by code. Anything else is a till: every row before warehouse PCs
/// was one.
pub fn terminal_kind(kind: &str) -> &'static str {
    if kind == KIND_WAREHOUSE {
        KIND_WAREHOUSE
    } else {
        KIND_TILL
    }
}

fn kind_word(kind: &str) -> &'static str {
    if kind == KIND_WAREHOUSE {
        "warehouse PC"
    } else {
        "till"
    }
}

/// The till or warehouse PC a request names in its `X-Terminal-Id` — the id a
/// signed call carries, or the label ("Gudang 1") a session call carries — as
/// its kind and status. The live one first, when a replaced machine left its
/// label behind.
pub fn terminal_named(
    connection: &Connection,
    name: &str,
) -> Result<Option<(&'static str, String)>, EdgeError> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(None);
    }
    let row: Option<(String, String)> = connection
        .query_row(
            "SELECT kind, status FROM edge_terminal
              WHERE terminal_id=?1 OR label=?1
              ORDER BY (status='REVOKED'), paired_at DESC
              LIMIT 1",
            params![name],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db)?;
    Ok(row.map(|(kind, status)| (terminal_kind(&kind), status)))
}

/// `POST /api/v1/store/warehouse/session`: the session a warehouse PC holds,
/// tied to that PC.
#[derive(Debug, Serialize)]
pub struct BoundSession {
    pub terminal_id: String,
    /// "Gudang 1".
    pub label: String,
}

/// Tie the session a warehouse PC signed in to that PC (Hari, 25 Oct 2026: a
/// cashier at a warehouse PC receives and moves stock, which their rung alone
/// does not allow).
///
/// What this relies on: one request that carries both the session's bearer
/// token and the PC's signature over this path and body — the HMAC a claim
/// carries, made with the key the PC minted when it joined, with its clock and
/// its next sequence ([`fingerprint::verify_terminal`]). Only the machine
/// holding that key can make the signature, and only someone holding the
/// token can present the session, so a session tied here was in that
/// machine's hands. It stays tied to it for as long as it lives; a session is
/// never moved to another machine.
pub fn bind_session(
    connection: &mut Connection,
    proof: &TerminalProof,
    path: &str,
    body_sha256: &str,
    session_id: Uuid,
) -> Result<BoundSession, EdgeError> {
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    let terminal_id = fingerprint::verify_terminal(&tx, proof, "POST", path, body_sha256)?;
    let (kind, label): (String, String) = tx
        .query_row(
            "SELECT kind, label FROM edge_terminal WHERE terminal_id=?1",
            params![terminal_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(db)?;
    if terminal_kind(&kind) != KIND_WAREHOUSE {
        return Err(EdgeError::Forbidden(
            "only a warehouse PC ties its session to itself".into(),
        ));
    }
    let session_id = session_id.to_string();
    let already: Option<String> = tx
        .query_row(
            "SELECT terminal_id FROM edge_session_device WHERE session_id=?1",
            params![session_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?;
    match already {
        Some(other) if other != terminal_id => {
            return Err(EdgeError::Conflict(
                "this session belongs to another machine; sign in again here".into(),
            ));
        }
        Some(_) => {}
        None => {
            tx.execute(
                "INSERT INTO edge_session_device (session_id, terminal_id, bound_at)
                 VALUES (?1, ?2, ?3)",
                params![session_id, terminal_id, stamp(Utc::now())],
            )
            .map_err(db)?;
        }
    }
    tx.commit().map_err(db)?;
    Ok(BoundSession { terminal_id, label })
}

/// The live warehouse PC `session_id` is tied to ([`bind_session`]), by its
/// label — when the request also names that PC (`X-Terminal-Id`, its id or its
/// label), and the PC is still active. `None` for every other session.
pub fn warehouse_session(
    connection: &Connection,
    session_id: Uuid,
    named: Option<&str>,
) -> Result<Option<String>, EdgeError> {
    let row: Option<(String, String)> = connection
        .query_row(
            "SELECT t.terminal_id, t.label
               FROM edge_session_device s
               JOIN edge_terminal t ON t.terminal_id = s.terminal_id
              WHERE s.session_id=?1 AND t.kind=?2 AND t.status=?3 AND t.active=1",
            params![session_id.to_string(), KIND_WAREHOUSE, STATUS_ACTIVE],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db)?;
    Ok(row
        .filter(|(terminal_id, label)| {
            named
                .map(str::trim)
                .is_some_and(|named| named == terminal_id || named == label)
        })
        .map(|(_, label)| label))
}

/// What a warehouse PC is refused (Central Gudang, 25 Oct 2026): every selling
/// call — a sale, a checkout, a drawer, a held basket, a return — and, once
/// head office has stopped or removed it, its own stock moves too. `None` for
/// anything else, a till included.
///
/// Read off the name the request gives itself, not off a signature: the
/// answer only ever takes something away, so a machine that names itself a
/// warehouse PC can only refuse itself. The shell always names its machine
/// (`pos-desktop/src-tauri/src/edge.rs`), and the session it holds never
/// leaves it.
///
/// Said in Indonesian, as the counter's refusals are: it is read in Central
/// Gudang.
pub fn warehouse_refusal(
    connection: &Connection,
    name: &str,
    selling: bool,
) -> Result<Option<EdgeError>, EdgeError> {
    let Some((kind, status)) = terminal_named(connection, name)? else {
        return Ok(None);
    };
    if kind != KIND_WAREHOUSE {
        return Ok(None);
    }
    if selling {
        return Ok(Some(EdgeError::Forbidden(
            "Komputer gudang tidak berjualan. Penjualan, laci dan shift hanya di POS kasir.".into(),
        )));
    }
    Ok(match status.as_str() {
        STATUS_ACTIVE => None,
        STATUS_REVOKED => Some(EdgeError::Forbidden(
            "Komputer gudang ini sudah dihapus kantor pusat.".into(),
        )),
        _ => Some(EdgeError::Forbidden(
            "Komputer gudang ini dihentikan kantor pusat.".into(),
        )),
    })
}

/// A replacement is not let in while the till it replaces has a shift open.
///
/// The new till takes the old one's name, and a cash shift is kept by the
/// name a till gives when it opens one (`cash_shift.terminal_id`, the label
/// since joining; the node's id for a till paired before that). Let in while
/// the old drawer is still open, the new till would find that shift as its
/// own and sell into a float somebody else counted. So the old shift is
/// closed first — at the old till, or from the Shift screen of another till
/// when the old one cannot be used — and then the replacement is approved.
///
/// Said in Indonesian, unlike this module's other refusals: it is read at the
/// counter, on the till approving the replacement, in the till's language —
/// the way a punch station's refusals are (`edge/attendance.rs`).
fn refuse_while_shift_open(
    connection: &Connection,
    old_id: &str,
    old_label: &str,
) -> Result<(), EdgeError> {
    let open: Option<(String, String)> = connection
        .query_row(
            "SELECT opened_by, opened_at FROM cash_shift
              WHERE status='OPEN' AND terminal_id IN (?1, ?2)
              ORDER BY opened_at LIMIT 1",
            params![old_label, old_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db)?;
    let Some((opened_by, opened_at)) = open else {
        return Ok(());
    };
    // On the shop's clock, as its receipts are.
    let since = DateTime::parse_from_rfc3339(&opened_at)
        .ok()
        .and_then(|at| {
            let minutes = crate::edge::site_profile::utc_offset_minutes(connection);
            let offset = FixedOffset::east_opt(minutes * 60)?;
            Some(
                at.with_timezone(&offset)
                    .format("%d/%m/%Y %H:%M")
                    .to_string(),
            )
        })
        .unwrap_or(opened_at);
    Err(EdgeError::Conflict(format!(
        "{old_label} masih punya shift kas yang terbuka sejak {since} (dibuka oleh \
         {opened_by}). Tutup dulu shift itu — di {old_label}, atau dari menu Shift di \
         kasir lain bila {old_label} sudah tidak bisa dipakai — karena uang di lacinya \
         milik shift itu. Setelah itu setujui kasir ini sebagai pengganti {old_label}."
    )))
}

/// Say no to a waiting till. It is told `REJECTED` on its next look and
/// forgets the key it minted.
pub fn refuse_join(connection: &Connection, join_id: &str, actor: &str) -> Result<(), EdgeError> {
    let changed = connection
        .execute(
            "UPDATE edge_device_join
                SET outcome='REJECTED', decided_by=?2, decided_via='SESSION', decided_at=?3
              WHERE join_id=?1 AND outcome IS NULL",
            params![join_id, actor, stamp(Utc::now())],
        )
        .map_err(db)?;
    if changed == 0 {
        return Err(EdgeError::Conflict(
            "no till is waiting under that request".into(),
        ));
    }
    Ok(())
}

/// The tills waiting to join, for head office: what the heartbeat carries
/// (`DeviceFacts::joins_waiting`), oldest first.
pub fn waiting_joins(connection: &Connection) -> Result<Vec<wire::WaitingJoin>, EdgeError> {
    let now = stamp(Utc::now());
    let mut statement = connection
        .prepare(
            "SELECT join_id, code, verification, machine_json, issued_at, expires_at,
                    head_office_error, kind
               FROM edge_device_join
              WHERE outcome IS NULL AND expires_at > ?1
              ORDER BY issued_at",
        )
        .map_err(db)?;
    let rows = statement
        .query_map(params![now], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
            ))
        })
        .map_err(db)?;
    let mut items = Vec::new();
    for row in rows {
        let (join_id, code, verification, machine, issued_at, expires_at, error, kind) =
            row.map_err(db)?;
        let Ok(join_id) = Uuid::parse_str(&join_id) else {
            continue;
        };
        items.push(wire::WaitingJoin {
            join_id,
            kind: terminal_kind(&kind).to_string(),
            code: wire::display_join_code(&code),
            verification,
            machine: serde_json::from_str(&machine).unwrap_or_default(),
            issued_at: parse_stamp(&issued_at)?,
            expires_at: parse_stamp(&expires_at)?,
            head_office_error: error,
        });
    }
    Ok(items)
}

/// Head office's yes or no to a waiting till, inside the command's
/// transaction.
///
/// A decision this node cannot carry out — the till it was to replace has a
/// drawer open, the request was decided or ran out meanwhile — is written on
/// the request (`head_office_error`, reported back in the heartbeat) and the
/// command is done with: a refusal here would stall every command behind it,
/// and the till keeps waiting for head office to decide again.
pub fn apply_join_decision(
    connection: &Connection,
    command: &wire::JoinDecisionCommand,
) -> Result<(), EdgeError> {
    let now = Utc::now();
    expire_stale_joins(connection, now)?;
    let join_id = command.join_id.to_string();
    let decided_by = command.decided_by.trim();
    let outcome: Option<Option<String>> = connection
        .query_row(
            "SELECT outcome FROM edge_device_join WHERE join_id=?1",
            params![join_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?;
    match outcome {
        None => {
            tracing::warn!(join = %join_id, "head office decided a till this node never saw");
            return Ok(());
        }
        Some(Some(outcome)) => {
            tracing::info!(join = %join_id, %outcome, "head office decided a till already decided");
            return Ok(());
        }
        Some(None) => {}
    }
    if !command.approve {
        connection
            .execute(
                "UPDATE edge_device_join
                    SET outcome='REJECTED', decided_by=?2, decided_via='SESSION', decided_at=?3,
                        head_office_error=NULL
                  WHERE join_id=?1 AND outcome IS NULL",
                params![join_id, decided_by, stamp(now)],
            )
            .map_err(db)?;
        return Ok(());
    }
    // Savepointed, so a decision that cannot be carried out leaves nothing
    // half-written: the till it was to replace stays as it was.
    connection
        .execute_batch("SAVEPOINT head_office_admits")
        .map_err(db)?;
    match admit(
        connection,
        &join_id,
        None,
        command.replaces_terminal_id.as_deref(),
        decided_by,
        "SESSION",
        now,
    ) {
        Ok(_) => {
            connection
                .execute_batch("RELEASE head_office_admits")
                .map_err(db)?;
            Ok(())
        }
        Err(
            EdgeError::Conflict(reason)
            | EdgeError::Validation(reason)
            | EdgeError::NotFound(reason),
        ) => {
            connection
                .execute_batch("ROLLBACK TO head_office_admits; RELEASE head_office_admits")
                .map_err(db)?;
            tracing::warn!(join = %join_id, %reason, "head office's approval not carried out");
            connection
                .execute(
                    "UPDATE edge_device_join SET head_office_error=?2
                      WHERE join_id=?1 AND outcome IS NULL",
                    params![join_id, reason.chars().take(500).collect::<String>()],
                )
                .map_err(db)?;
            Ok(())
        }
        Err(other) => Err(other),
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Status: suspend, reactivate, revoke
// ════════════════════════════════════════════════════════════════════════════

/// Put a till or a printer into `status`, write it down, and say which kind
/// it was. `Ok(None)` when this node holds no such device.
fn apply_status(
    connection: &Connection,
    device_id: &str,
    status: &str,
    reason: Option<&str>,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<Option<&'static str>, EdgeError> {
    if !wire::is_status(status) {
        return Err(EdgeError::Validation(format!(
            "{status} is not a device status; say ACTIVE, SUSPENDED or REVOKED"
        )));
    }
    let till: Option<(String, String)> = connection
        .query_row(
            "SELECT status, kind FROM edge_terminal WHERE terminal_id=?1",
            params![device_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db)?;
    let (kind, current) = match till {
        Some((current, kind)) => (terminal_kind(&kind), current),
        None => {
            let printer: Option<String> = connection
                .query_row(
                    "SELECT status FROM edge_printer WHERE printer_id=?1",
                    params![device_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(db)?;
            match printer {
                Some(current) => (KIND_PRINTER, current),
                None => return Ok(None),
            }
        }
    };
    if current == status {
        return Ok(Some(kind));
    }
    if !wire::may_become(&current, status) {
        return Err(EdgeError::Conflict(format!(
            "a {} that is {} cannot become {}; a revoked device stays revoked",
            kind.to_ascii_lowercase(),
            current.to_ascii_lowercase(),
            status.to_ascii_lowercase()
        )));
    }
    let now = stamp(at);
    if kind != KIND_PRINTER {
        // `active` is what a till's signature is checked against, so it moves
        // with the status in the same statement.
        connection
            .execute(
                "UPDATE edge_terminal
                    SET status=?2, active=?3, status_changed_at=?4, status_changed_by=?5,
                        status_reason=?6, updated_at=?4
                  WHERE terminal_id=?1",
                params![
                    device_id,
                    status,
                    i64::from(status == STATUS_ACTIVE),
                    now,
                    actor,
                    reason
                ],
            )
            .map_err(db)?;
    } else {
        connection
            .execute(
                "UPDATE edge_printer
                    SET status=?2, status_changed_at=?3, status_changed_by=?4,
                        status_reason=?5, updated_at=?3
                  WHERE printer_id=?1",
                params![device_id, status, now, actor, reason],
            )
            .map_err(db)?;
    }
    record_event(connection, device_id, kind, status, actor, reason, at)?;
    Ok(Some(kind))
}

/// A supervisor at the shop suspends, reactivates or revokes a printer. A
/// till is refused here: only head office stops, resumes or removes one
/// (postgres 0990), and its decision arrives as [`apply_status_command`]. A
/// suspended till's signed requests are refused until it is reactivated; a
/// revoked one's for good.
pub fn set_status(
    connection: &mut Connection,
    device_id: &str,
    status: &str,
    reason: Option<&str>,
    actor: &str,
) -> Result<DeviceReport, EdgeError> {
    let status = status.trim().to_ascii_uppercase();
    let reason = reason.map(str::trim).filter(|reason| !reason.is_empty());
    if status != STATUS_ACTIVE && reason.is_none() {
        return Err(EdgeError::Validation(
            "say why: a till switched off with no reason is a question nobody can answer later"
                .into(),
        ));
    }
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    let reader: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM edge_rfid_device WHERE device_id=?1)",
            params![device_id],
            |row| row.get(0),
        )
        .map_err(db)?;
    if reader {
        return Err(EdgeError::Conflict(
            "an RFID reader or handheld is switched on and off at head office \
             (System → Access), where its key is kept"
                .into(),
        ));
    }
    // A till is head office's alone to stop, resume or remove (client, 23 Oct
    // 2026; postgres 0990): it arrives as `device.status.set.v1`.
    let till: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM edge_terminal WHERE terminal_id=?1)",
            params![device_id],
            |row| row.get(0),
        )
        .map_err(db)?;
    if till {
        return Err(EdgeError::Forbidden(
            "only head office stops, resumes or removes a till or a warehouse PC, from the \
             store's Tills tab in the hub"
                .into(),
        ));
    }
    if apply_status(&tx, device_id, &status, reason, actor, Utc::now())?.is_none() {
        return Err(EdgeError::NotFound(format!("device {device_id}")));
    }
    tx.commit().map_err(db)?;
    find_device(connection, device_id)
}

/// Head office's decision, arriving on the command channel.
///
/// A decision this node cannot carry out — a device it never had, a revoked
/// till asked back — is logged and passed over rather than refused: an
/// unapplied command blocks every command behind it, and a stale device
/// decision is not worth stopping the price book for. The next heartbeat
/// reports the device as it really is, which is what head office then shows.
pub fn apply_status_command(
    connection: &Connection,
    command: &DeviceStatusCommand,
) -> Result<(), EdgeError> {
    let actor = format!("head office: {}", command.decided_by.trim());
    match apply_status(
        connection,
        command.device_id.trim(),
        &command.status,
        command.reason.as_deref(),
        &actor,
        command.decided_at,
    ) {
        Ok(Some(_)) => Ok(()),
        Ok(None) => {
            tracing::warn!(device = %command.device_id, "head office decided about a device this node does not hold");
            Ok(())
        }
        Err(EdgeError::Conflict(message)) => {
            tracing::warn!(device = %command.device_id, %message, "head office's device decision not applied");
            Ok(())
        }
        Err(other) => Err(other),
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Printers
// ════════════════════════════════════════════════════════════════════════════

fn default_printer_port() -> u16 {
    9100
}

#[derive(Debug, Deserialize)]
pub struct RecordPrinterRequest {
    pub label: String,
    pub host: String,
    #[serde(default = "default_printer_port")]
    pub port: u16,
    /// `ZPL`, `TSPL` or `ESCPOS`.
    #[serde(default)]
    pub language: Option<String>,
    /// `LABEL` (the default) or `RECEIPT`.
    #[serde(default)]
    pub purpose: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct ChangePrinterRequest {
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub purpose: Option<String>,
}

fn check_language(value: Option<&str>) -> Result<Option<String>, EdgeError> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        None => Ok(None),
        Some(value) => {
            let value = value.to_ascii_uppercase();
            if matches!(value.as_str(), "ZPL" | "TSPL" | "ESCPOS") {
                Ok(Some(value))
            } else {
                Err(EdgeError::Validation(format!(
                    "{value} is not a printer language this node speaks; say ZPL, TSPL or ESCPOS"
                )))
            }
        }
    }
}

fn check_purpose(value: Option<&str>) -> Result<String, EdgeError> {
    let value = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("LABEL")
        .to_ascii_uppercase();
    if matches!(value.as_str(), "LABEL" | "RECEIPT") {
        Ok(value)
    } else {
        Err(EdgeError::Validation(
            "a printer is for LABEL or RECEIPT".into(),
        ))
    }
}

fn check_address(host: &str, port: u16) -> Result<(), EdgeError> {
    if host.is_empty() {
        return Err(EdgeError::Validation("a printer needs a host".into()));
    }
    if host.len() > 253 || host.chars().any(char::is_whitespace) {
        return Err(EdgeError::Validation(format!(
            "{host} is not an address a printer can have"
        )));
    }
    if port == 0 {
        return Err(EdgeError::Validation(
            "a printer's port is 1 to 65535".into(),
        ));
    }
    Ok(())
}

fn address_taken(
    connection: &Connection,
    host: &str,
    port: u16,
    except: Option<&str>,
) -> Result<Option<String>, EdgeError> {
    connection
        .query_row(
            "SELECT label FROM edge_printer
              WHERE host=?1 AND port=?2 AND status<>'REVOKED'
                AND (?3 IS NULL OR printer_id<>?3)",
            params![host, i64::from(port), except],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)
}

/// Write a network printer down once. From then on a print request can name
/// it by `printer_id` instead of carrying its address.
pub fn record_printer(
    connection: &mut Connection,
    request: RecordPrinterRequest,
    actor: &str,
) -> Result<DeviceReport, EdgeError> {
    let label = request.label.trim();
    if label.is_empty() {
        return Err(EdgeError::Validation(
            "a printer needs a name somebody can read off the bench".into(),
        ));
    }
    let host = request.host.trim();
    check_address(host, request.port)?;
    let language = check_language(request.language.as_deref())?;
    let purpose = check_purpose(request.purpose.as_deref())?;
    let now = Utc::now();
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    if let Some(existing) = address_taken(&tx, host, request.port, None)? {
        return Err(EdgeError::Conflict(format!(
            "{host}:{} is already recorded as {existing}",
            request.port
        )));
    }
    let printer_id = format!("prn-{}", Uuid::new_v4());
    tx.execute(
        "INSERT INTO edge_printer
           (printer_id,label,host,port,language,purpose,status,created_at,created_by,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,'ACTIVE',?7,?8,?7)",
        params![
            printer_id,
            label,
            host,
            i64::from(request.port),
            language,
            purpose,
            stamp(now),
            actor
        ],
    )
    .map_err(db)?;
    record_event(
        &tx,
        &printer_id,
        KIND_PRINTER,
        "RECORDED",
        actor,
        Some(format!("{host}:{}", request.port).as_str()),
        now,
    )?;
    tx.commit().map_err(db)?;
    find_device(connection, &printer_id)
}

/// A printer's name, address, language or purpose changed — usually its
/// address, the morning after the router handed it a new one.
pub fn change_printer(
    connection: &mut Connection,
    printer_id: &str,
    request: ChangePrinterRequest,
    actor: &str,
) -> Result<DeviceReport, EdgeError> {
    let now = Utc::now();
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    let row: Option<(String, String, i64, Option<String>, String, String)> = tx
        .query_row(
            "SELECT label, host, port, language, purpose, status FROM edge_printer
              WHERE printer_id=?1",
            params![printer_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()
        .map_err(db)?;
    let Some((label, host, port, language, purpose, status)) = row else {
        return Err(EdgeError::NotFound(format!("printer {printer_id}")));
    };
    if status == STATUS_REVOKED {
        return Err(EdgeError::Conflict(format!(
            "{label} has been revoked; record the printer again"
        )));
    }
    let label = match request.label.as_deref().map(str::trim) {
        Some("") => {
            return Err(EdgeError::Validation("a printer needs a name".into()));
        }
        Some(new) => new.to_string(),
        None => label,
    };
    let host = request
        .host
        .as_deref()
        .map(str::trim)
        .map(str::to_string)
        .unwrap_or(host);
    let port = request
        .port
        .unwrap_or_else(|| u16::try_from(port).unwrap_or(9100));
    check_address(&host, port)?;
    let language = match request.language.as_deref() {
        Some(value) => check_language(Some(value))?,
        None => language,
    };
    let purpose = match request.purpose.as_deref() {
        Some(value) => check_purpose(Some(value))?,
        None => purpose,
    };
    if let Some(existing) = address_taken(&tx, &host, port, Some(printer_id))? {
        return Err(EdgeError::Conflict(format!(
            "{host}:{port} is already recorded as {existing}"
        )));
    }
    tx.execute(
        "UPDATE edge_printer
            SET label=?2, host=?3, port=?4, language=?5, purpose=?6, updated_at=?7
          WHERE printer_id=?1",
        params![
            printer_id,
            label,
            host,
            i64::from(port),
            language,
            purpose,
            stamp(now)
        ],
    )
    .map_err(db)?;
    record_event(
        &tx,
        printer_id,
        KIND_PRINTER,
        "CHANGED",
        actor,
        Some(format!("{label} at {host}:{port}").as_str()),
        now,
    )?;
    tx.commit().map_err(db)?;
    find_device(connection, printer_id)
}

/// The address a recorded printer answers at, for a request that named it by
/// id. A suspended or revoked printer is refused by name rather than printed
/// to: labels coming out of a machine somebody switched off is how a bench
/// finds out the hard way.
pub fn resolve_printer(
    connection: &Connection,
    printer_id: &str,
) -> Result<(String, u16), EdgeError> {
    let row: Option<(String, i64, String, String)> = connection
        .query_row(
            "SELECT host, port, status, label FROM edge_printer WHERE printer_id=?1",
            params![printer_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(db)?;
    let Some((host, port, status, label)) = row else {
        return Err(EdgeError::NotFound(format!("printer {printer_id}")));
    };
    if status != STATUS_ACTIVE {
        return Err(EdgeError::Conflict(format!(
            "{label} is {} at this node; choose another printer",
            status.to_ascii_lowercase()
        )));
    }
    connection
        .execute(
            "UPDATE edge_printer SET last_used_at=?2 WHERE printer_id=?1",
            params![printer_id, stamp(Utc::now())],
        )
        .map_err(db)?;
    Ok((host, u16::try_from(port).unwrap_or(9100)))
}

// ════════════════════════════════════════════════════════════════════════════
// A till's peripherals
// ════════════════════════════════════════════════════════════════════════════

/// `POST /api/v1/devices/self/peripherals`, signed by the till.
#[derive(Debug, Deserialize)]
pub struct PeripheralsRequest {
    /// What hangs off this till, in the till's own words:
    /// `{"customer_display": {...}, "desk_reader": {"model": "Chainway R3"},
    /// "cash_drawer": {...}, "scanner": {...}, "usb_printer": {...}}`.
    /// Replaced whole on every report.
    pub peripherals: Value,
}

/// A till says what is plugged into it. Signed with its own credential, so a
/// till can only ever describe itself; stored as configuration of that till
/// and carried to head office in the registry, never as devices of their own.
pub fn set_peripherals(
    connection: &mut Connection,
    proof: &TerminalProof,
    path: &str,
    body_sha256: &str,
    peripherals: Value,
) -> Result<DeviceReport, EdgeError> {
    let Value::Object(map) = &peripherals else {
        return Err(EdgeError::Validation(
            "peripherals are an object, one entry per thing plugged in".into(),
        ));
    };
    if map.len() > 32 {
        return Err(EdgeError::Validation(
            "more than 32 peripherals on one till is not a till".into(),
        ));
    }
    let text = serde_json::to_string(&peripherals)
        .map_err(|error| EdgeError::Persistence(error.to_string()))?;
    if text.len() > 8 * 1024 {
        return Err(EdgeError::Validation(
            "the peripherals description is too long".into(),
        ));
    }
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    let terminal_id = fingerprint::verify_terminal(&tx, proof, "POST", path, body_sha256)?;
    tx.execute(
        "UPDATE edge_terminal SET peripherals_json=?2, updated_at=?3 WHERE terminal_id=?1",
        params![terminal_id, text, stamp(Utc::now())],
    )
    .map_err(db)?;
    tx.commit().map_err(db)?;
    find_device(connection, &terminal_id)
}

// ════════════════════════════════════════════════════════════════════════════
// Test pages head office asks for
// ════════════════════════════════════════════════════════════════════════════

/// How often this node looks for test pages its network printers owe.
const TEST_PAGE_ROUND: std::time::Duration = std::time::Duration::from_secs(5);

/// How long an ask waits to be carried out before it is given up on: a till
/// switched off for the night must not print last week's pages at dawn.
const TEST_PAGE_PATIENCE_MINUTES: i64 = 60;

/// The longest reason for a failed page this node keeps.
const TEST_PRINT_ERROR_CHARS: usize = 500;

/// Which kind of device this node holds under an id, if it prints.
fn printing_kind_of(
    connection: &Connection,
    device_id: &str,
) -> Result<Option<&'static str>, EdgeError> {
    let till: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM edge_terminal WHERE terminal_id=?1)",
            params![device_id],
            |row| row.get(0),
        )
        .map_err(db)?;
    if till {
        return Ok(Some(KIND_TILL));
    }
    let printer: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM edge_printer WHERE printer_id=?1)",
            params![device_id],
            |row| row.get(0),
        )
        .map_err(db)?;
    Ok(printer.then_some(KIND_PRINTER))
}

/// Head office asked for a test page (`device.test_print.v1`). Kept until it
/// is carried out: by this node for a network printer
/// ([`print_waiting_test_pages`]), by the till itself for a till
/// ([`till_requests`]).
///
/// Like a status decision, an ask this node cannot carry out — a device it
/// never had — is logged and passed over rather than refused: a blocked
/// command stream would hold the price book back for a test page.
pub fn apply_test_print_command(
    connection: &Connection,
    command: &DeviceTestPrintCommand,
) -> Result<(), EdgeError> {
    let device_id = command.device_id.trim();
    let Some(kind) = printing_kind_of(connection, device_id)? else {
        tracing::warn!(device = %device_id, "head office asked for a test page from a device this node does not hold");
        return Ok(());
    };
    connection
        .execute(
            "INSERT INTO edge_device_request
               (request_id,device_id,kind,request,requested_by,requested_at,received_at)
             VALUES (?1,?2,?3,'TEST_PRINT',?4,?5,?6)
             ON CONFLICT(request_id) DO NOTHING",
            params![
                command.request_id.to_string(),
                device_id,
                kind,
                command.requested_by.trim(),
                stamp(command.requested_at),
                stamp(Utc::now())
            ],
        )
        .map_err(db)?;
    Ok(())
}

/// Give up on asks nobody carried out in time. They reach head office as
/// finished (`last_test_print_request_id`), with no page to show for them.
fn expire_stale_requests(connection: &Connection, now: DateTime<Utc>) -> Result<(), EdgeError> {
    connection
        .execute(
            "UPDATE edge_device_request SET status='EXPIRED', completed_at=?1
              WHERE status='PENDING' AND received_at <= ?2",
            params![
                stamp(now),
                stamp(now - Duration::minutes(TEST_PAGE_PATIENCE_MINUTES))
            ],
        )
        .map_err(db)?;
    Ok(())
}

fn clamp_error(error: Option<String>) -> Option<String> {
    error
        .map(|text| {
            text.trim()
                .chars()
                .take(TEST_PRINT_ERROR_CHARS)
                .collect::<String>()
        })
        .filter(|text| !text.is_empty())
}

/// `GET /api/v1/devices/self/requests`, signed by the till: what head office
/// left for it, oldest first. The till prints each and reports it with
/// [`record_till_test_print`]; until then an ask stays here.
pub fn till_requests(
    connection: &mut Connection,
    proof: &TerminalProof,
    path: &str,
    body_sha256: &str,
) -> Result<TillRequests, EdgeError> {
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    let terminal_id = fingerprint::verify_terminal(&tx, proof, "GET", path, body_sha256)?;
    expire_stale_requests(&tx, Utc::now())?;
    // The recorded printer this till's receipts go to, by the id its own
    // peripherals report named — a till keeps the id, the node the address.
    // Anything unreadable is "none": the till then prints where it can.
    let printer: Option<(String, i64)> = tx
        .query_row(
            "SELECT p.host, p.port
               FROM edge_terminal t
               JOIN edge_printer p
                 ON p.printer_id = json_extract(t.peripherals_json, '$.receipt_printer.printer_id')
              WHERE t.terminal_id=?1 AND p.status='ACTIVE'",
            params![terminal_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .ok()
        .flatten();
    let items = {
        let mut statement = tx
            .prepare(
                "SELECT request_id, request, requested_by, requested_at
                   FROM edge_device_request
                  WHERE device_id=?1 AND kind='TILL' AND status='PENDING'
                  ORDER BY requested_at
                  LIMIT 10",
            )
            .map_err(db)?;
        let rows = statement
            .query_map(params![terminal_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(db)?;
        let mut items = Vec::new();
        for row in rows {
            let (request_id, request, requested_by, requested_at) = row.map_err(db)?;
            let Ok(request_id) = Uuid::parse_str(&request_id) else {
                continue;
            };
            items.push(TillRequest {
                request_id,
                request,
                requested_by,
                requested_at: parse_stamp(&requested_at)?,
                printer_host: printer.as_ref().map(|(host, _)| host.clone()),
                printer_port: printer
                    .as_ref()
                    .map(|(_, port)| u16::try_from(*port).unwrap_or(9100)),
            });
        }
        items
    };
    tx.commit().map_err(db)?;
    Ok(TillRequests { items })
}

/// `POST /api/v1/devices/self/test-print-result`, signed by the till: how a
/// test page came out, whether head office asked for it or somebody pressed
/// "test print" at the till. Kept on the till's row and carried to head
/// office in the next heartbeat.
pub fn record_till_test_print(
    connection: &mut Connection,
    proof: &TerminalProof,
    path: &str,
    body_sha256: &str,
    result: TestPrintResult,
) -> Result<DeviceReport, EdgeError> {
    let error = if result.ok {
        None
    } else {
        Some(
            clamp_error(result.error)
                .unwrap_or_else(|| "the till could not print the test page".to_string()),
        )
    };
    let now = stamp(Utc::now());
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    let terminal_id = fingerprint::verify_terminal(&tx, proof, "POST", path, body_sha256)?;
    if let Some(request_id) = result.request_id {
        // Only this till's own ask, and only once.
        tx.execute(
            "UPDATE edge_device_request SET status='DONE', ok=?3, error=?4, completed_at=?5
              WHERE request_id=?1 AND device_id=?2 AND status='PENDING'",
            params![
                request_id.to_string(),
                terminal_id,
                i64::from(result.ok),
                error,
                now
            ],
        )
        .map_err(db)?;
    }
    tx.execute(
        "UPDATE edge_terminal
            SET last_test_print_at=?2, last_test_print_ok=?3, last_test_print_error=?4
          WHERE terminal_id=?1",
        params![terminal_id, now, i64::from(result.ok), error],
    )
    .map_err(db)?;
    tx.commit().map_err(db)?;
    find_device(connection, &terminal_id)
}

/// A test page this node owes one of its network printers.
struct PrinterTestPage {
    request_id: String,
    printer_id: String,
    label: String,
    host: String,
    port: u16,
    language: Option<String>,
    purpose: String,
    status: String,
    requested_by: String,
}

fn waiting_printer_pages(connection: &Connection) -> Result<Vec<PrinterTestPage>, EdgeError> {
    let mut statement = connection
        .prepare(
            "SELECT r.request_id, p.printer_id, p.label, p.host, p.port, p.language, p.purpose,
                    p.status, r.requested_by
               FROM edge_device_request r
               JOIN edge_printer p ON p.printer_id = r.device_id
              WHERE r.kind='PRINTER' AND r.status='PENDING'
              ORDER BY r.requested_at
              LIMIT 10",
        )
        .map_err(db)?;
    let rows = statement
        .query_map([], |row| {
            Ok(PrinterTestPage {
                request_id: row.get(0)?,
                printer_id: row.get(1)?,
                label: row.get(2)?,
                host: row.get(3)?,
                port: u16::try_from(row.get::<_, i64>(4)?).unwrap_or(9100),
                language: row.get(5)?,
                purpose: row.get(6)?,
                status: row.get(7)?,
                requested_by: row.get(8)?,
            })
        })
        .map_err(db)?;
    let mut pages = Vec::new();
    for row in rows {
        pages.push(row.map_err(db)?);
    }
    Ok(pages)
}

/// Text that is safe inside a ZPL field or a TSPL string.
fn printable(text: &str) -> String {
    text.chars()
        .map(|character| match character {
            '^' | '~' | '"' | '\\' => ' ',
            character if character.is_control() => ' ',
            character => character,
        })
        .collect()
}

/// The page itself, in the printer's own language: on a receipt printer
/// ESC/POS, on a label printer ZPL or TSPL. Printed in Indonesian, like every
/// paper the shop reads.
fn test_page_bytes(page: &PrinterTestPage, shop: &str, printed_at: &str) -> Vec<u8> {
    let language = page
        .language
        .as_deref()
        .map(str::to_ascii_uppercase)
        .unwrap_or_else(|| {
            if page.purpose == "RECEIPT" {
                "ESCPOS".to_string()
            } else {
                crate::edge::zpl::PrinterLanguage::from_env()
                    .as_str()
                    .to_string()
            }
        });
    let label = printable(&page.label);
    let shop = printable(shop);
    let asked_by = printable(&page.requested_by);
    match language.as_str() {
        "ESCPOS" => {
            // Reset, centre, bold on; the title; bold off.
            let mut bytes: Vec<u8> = vec![0x1b, b'@', 0x1b, b'a', 1, 0x1b, b'E', 1];
            bytes.extend_from_slice(b"HALAMAN UJI\n");
            bytes.extend_from_slice(&[0x1b, b'E', 0]);
            bytes.extend_from_slice(
                format!("{label}\n{shop}\n{printed_at}\nDiminta oleh {asked_by}\n\n\n\n")
                    .as_bytes(),
            );
            // Feed and cut.
            bytes.extend_from_slice(&[0x1d, b'V', 66, 0x50]);
            bytes
        }
        "TSPL" => format!(
            "SIZE 50 mm,30 mm\r\nGAP 2 mm,0 mm\r\nCLS\r\n\
             TEXT 20,20,\"3\",0,1,1,\"HALAMAN UJI\"\r\n\
             TEXT 20,70,\"2\",0,1,1,\"{label}\"\r\n\
             TEXT 20,105,\"2\",0,1,1,\"{shop}\"\r\n\
             TEXT 20,140,\"2\",0,1,1,\"{printed_at}\"\r\n\
             PRINT 1\r\n"
        )
        .into_bytes(),
        _ => format!(
            "^XA^CI28\
             ^FO30,30^A0N,40,40^FDHALAMAN UJI^FS\
             ^FO30,85^A0N,26,26^FD{label}^FS\
             ^FO30,120^A0N,26,26^FD{shop}^FS\
             ^FO30,155^A0N,26,26^FD{printed_at}^FS\
             ^XZ"
        )
        .into_bytes(),
    }
}

fn record_printer_test_print(
    connection: &Connection,
    page: &PrinterTestPage,
    outcome: Result<(), String>,
    at: DateTime<Utc>,
) -> Result<(), EdgeError> {
    let ok = outcome.is_ok();
    let error = clamp_error(outcome.err());
    let at = stamp(at);
    connection
        .execute(
            "UPDATE edge_device_request SET status='DONE', ok=?2, error=?3, completed_at=?4
              WHERE request_id=?1 AND status='PENDING'",
            params![page.request_id, i64::from(ok), error, at],
        )
        .map_err(db)?;
    connection
        .execute(
            "UPDATE edge_printer
                SET last_test_print_at=?2, last_test_print_ok=?3, last_test_print_error=?4,
                    last_used_at=CASE WHEN ?3 = 1 THEN ?2 ELSE last_used_at END
              WHERE printer_id=?1",
            params![page.printer_id, at, i64::from(ok), error],
        )
        .map_err(db)?;
    Ok(())
}

/// Print every test page this node owes its network printers, and write down
/// how each came out. Blocking: the socket to a printer is opened here, with
/// the lock released while it is.
pub fn print_waiting_test_pages(
    connection: &std::sync::Mutex<Connection>,
) -> Result<usize, EdgeError> {
    let (pages, shop, offset) = {
        let guard = lock(connection)?;
        expire_stale_requests(&guard, Utc::now())?;
        let shop = crate::edge::site_profile::own(&guard)
            .map(|site| format!("{} {}", site.display_code(), site.name))
            .unwrap_or_default();
        (
            waiting_printer_pages(&guard)?,
            shop,
            crate::edge::site_profile::utc_offset_minutes(&guard),
        )
    };
    for page in &pages {
        let now = Utc::now();
        let printed_at = FixedOffset::east_opt(offset * 60)
            .map(|zone| {
                now.with_timezone(&zone)
                    .format("%d/%m/%Y %H:%M")
                    .to_string()
            })
            .unwrap_or_else(|| now.format("%d/%m/%Y %H:%M UTC").to_string());
        let outcome = if page.status == STATUS_ACTIVE {
            crate::edge::printing::send_bytes(
                &page.host,
                page.port,
                &test_page_bytes(page, &shop, &printed_at),
            )
            .map_err(|error| error.to_string())
        } else {
            Err(format!(
                "{} is {} at this node",
                page.label,
                page.status.to_ascii_lowercase()
            ))
        };
        let guard = lock(connection)?;
        record_printer_test_print(&guard, page, outcome, Utc::now())?;
    }
    Ok(pages.len())
}

/// Look for owed test pages every few seconds, for as long as the node runs.
pub fn spawn_test_printer(connection: std::sync::Arc<std::sync::Mutex<Connection>>) {
    tokio::spawn(async move {
        loop {
            let shared = connection.clone();
            match tokio::task::spawn_blocking(move || print_waiting_test_pages(&shared)).await {
                Ok(Ok(_)) => {}
                Ok(Err(error)) => tracing::warn!(%error, "test pages were not printed this round"),
                Err(error) => tracing::warn!(%error, "the test-page round did not run"),
            }
            tokio::time::sleep(TEST_PAGE_ROUND).await;
        }
    });
}

// ════════════════════════════════════════════════════════════════════════════
// Everything, as head office will see it
// ════════════════════════════════════════════════════════════════════════════

fn find_device(connection: &Connection, device_id: &str) -> Result<DeviceReport, EdgeError> {
    list_devices(connection)?
        .into_iter()
        .find(|device| device.device_id == device_id)
        .ok_or_else(|| EdgeError::NotFound(format!("device {device_id}")))
}

/// Every device this node holds: tills (`edge_terminal`), printers
/// (`edge_printer`) and RFID keys (`edge_rfid_device`, whose authority is head
/// office's policy — reported so the registry shows where each one is and when
/// it was last heard), each a `HANDHELD` or an `RFID_READER` as head office
/// registered it. Secrets never leave: no key, no digest.
pub fn list_devices(connection: &Connection) -> Result<Vec<DeviceReport>, EdgeError> {
    let mut devices = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT terminal_id, label, status, last_seen_at, paired_at, paired_by,
                        replaces_terminal_id, status_changed_at, status_changed_by,
                        status_reason, peripherals_json, machine_json,
                        last_test_print_at, last_test_print_ok, last_test_print_error,
                        (SELECT r.request_id FROM edge_device_request r
                          WHERE r.device_id = edge_terminal.terminal_id AND r.status <> 'PENDING'
                          ORDER BY r.completed_at DESC LIMIT 1),
                        kind
                   FROM edge_terminal
                  ORDER BY paired_at",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([], |row| {
                let peripherals = parse_json(row.get(10)?);
                let machine = parse_json(row.get(11)?);
                let kind: String = row.get(16)?;
                Ok(DeviceReport {
                    device_id: row.get(0)?,
                    kind: terminal_kind(&kind).to_string(),
                    label: row.get(1)?,
                    status: row.get(2)?,
                    last_seen_at: parse_time(row.get(3)?),
                    registered_at: parse_time(row.get(4)?),
                    registered_by: row.get(5)?,
                    replaces: row.get(6)?,
                    status_changed_at: parse_time(row.get(7)?),
                    status_changed_by: row.get(8)?,
                    status_reason: row.get(9)?,
                    health: till_health(&peripherals),
                    config: json!({ "peripherals": peripherals, "machine": machine }),
                    last_test_print_at: parse_time(row.get(12)?),
                    last_test_print_ok: row.get::<_, Option<i64>>(13)?.map(|ok| ok == 1),
                    last_test_print_error: row.get(14)?,
                    last_test_print_request_id: parse_uuid(row.get(15)?),
                })
            })
            .map_err(db)?;
        for row in rows {
            devices.push(row.map_err(db)?);
        }
    }
    {
        let mut statement = connection
            .prepare(
                "SELECT printer_id, label, status, last_used_at, created_at, created_by,
                        status_changed_at, status_changed_by, status_reason,
                        host, port, language, purpose,
                        last_test_print_at, last_test_print_ok, last_test_print_error,
                        (SELECT r.request_id FROM edge_device_request r
                          WHERE r.device_id = edge_printer.printer_id AND r.status <> 'PENDING'
                          ORDER BY r.completed_at DESC LIMIT 1)
                   FROM edge_printer
                  ORDER BY created_at",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([], |row| {
                let host: String = row.get(9)?;
                let port: i64 = row.get(10)?;
                let language: Option<String> = row.get(11)?;
                let purpose: String = row.get(12)?;
                Ok(DeviceReport {
                    device_id: row.get(0)?,
                    kind: KIND_PRINTER.to_string(),
                    label: row.get(1)?,
                    status: row.get(2)?,
                    last_seen_at: parse_time(row.get(3)?),
                    registered_at: parse_time(row.get(4)?),
                    registered_by: row.get(5)?,
                    replaces: None,
                    status_changed_at: parse_time(row.get(6)?),
                    status_changed_by: row.get(7)?,
                    status_reason: row.get(8)?,
                    config: json!({
                        "host": host,
                        "port": port,
                        "language": language,
                        "purpose": purpose,
                    }),
                    last_test_print_at: parse_time(row.get(13)?),
                    last_test_print_ok: row.get::<_, Option<i64>>(14)?.map(|ok| ok == 1),
                    last_test_print_error: row.get(15)?,
                    last_test_print_request_id: parse_uuid(row.get(16)?),
                    // Filled below from the print queue.
                    health: None,
                })
            })
            .map_err(db)?;
        for row in rows {
            devices.push(row.map_err(db)?);
        }
    }
    {
        // Carried or fixed, as head office registered each key (`0056`).
        let mut statement = connection
            .prepare(
                "SELECT device_id, label, active, last_seen_at, valid_until, kind
                   FROM edge_rfid_device
                  ORDER BY device_id",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([], |row| {
                let active: i64 = row.get(2)?;
                let valid_until: Option<String> = row.get(4)?;
                let kind: String = row.get(5)?;
                Ok(DeviceReport {
                    device_id: row.get(0)?,
                    kind: if wire::is_rfid_kind(&kind) {
                        kind
                    } else {
                        KIND_RFID_READER.to_string()
                    },
                    label: row.get(1)?,
                    status: (if active == 1 {
                        STATUS_ACTIVE
                    } else {
                        STATUS_SUSPENDED
                    })
                    .to_string(),
                    last_seen_at: parse_time(row.get(3)?),
                    registered_at: None,
                    registered_by: None,
                    replaces: None,
                    status_changed_at: None,
                    status_changed_by: None,
                    status_reason: None,
                    config: json!({ "valid_until": valid_until }),
                    last_test_print_at: None,
                    last_test_print_ok: None,
                    last_test_print_error: None,
                    last_test_print_request_id: None,
                    // Filled below from the pings and the observations.
                    health: None,
                })
            })
            .map_err(db)?;
        let mut readers = Vec::new();
        for row in rows {
            readers.push(row.map_err(db)?);
        }
        let mut pools = connection
            .prepare(
                "SELECT pool_id FROM edge_rfid_device_pool WHERE device_id=?1 ORDER BY pool_id",
            )
            .map_err(db)?;
        for mut reader in readers {
            let names = pools
                .query_map(params![reader.device_id], |row| row.get::<_, String>(0))
                .map_err(db)?;
            let mut held = Vec::new();
            for name in names {
                held.push(name.map_err(db)?);
            }
            if let Value::Object(config) = &mut reader.config {
                config.insert("pools".into(), json!(held));
            }
            devices.push(reader);
        }
    }
    let now = Utc::now();
    for device in &mut devices {
        match device.kind.as_str() {
            KIND_PRINTER => device.health = printer_health(connection, &device.config, now),
            kind if wire::is_rfid_kind(kind) => {
                device.health = reader_health(connection, &device.device_id, now)
            }
            _ => {}
        }
    }
    Ok(devices)
}

// ════════════════════════════════════════════════════════════════════════════
// How each device is doing, for head office's fleet status page
// ════════════════════════════════════════════════════════════════════════════

/// How long the reads-per-minute figure looks back.
const READS_WINDOW_MINUTES: i64 = 15;

/// A till's desk reader (the USB R3), from what the till last said is plugged
/// in. The till reports `desk_reader` as the model it has configured (a
/// string, or null for none); a till app that checks the USB bus also sends
/// `desk_reader_attached` and, optionally, `reported_at`. No desk reader
/// configured is no health to report.
fn till_health(peripherals: &Value) -> Option<wire::DeviceHealth> {
    let configured = peripherals.get("desk_reader")?;
    let (model, attached_inline) = match configured {
        Value::Null => return None,
        Value::String(model) => (Some(model.clone()), None),
        Value::Object(reader) => (
            reader
                .get("model")
                .and_then(Value::as_str)
                .map(str::to_owned),
            reader.get("attached").and_then(Value::as_bool),
        ),
        Value::Bool(false) => return None,
        _ => (None, None),
    };
    let attached = peripherals
        .get("desk_reader_attached")
        .and_then(Value::as_bool)
        .or(attached_inline);
    let reported_at = peripherals
        .get("reported_at")
        .and_then(Value::as_str)
        .and_then(|text| DateTime::parse_from_rfc3339(text).ok())
        .map(|at| at.with_timezone(&Utc));
    Some(wire::DeviceHealth {
        desk_reader: Some(wire::DeskReaderHealth {
            model,
            attached,
            reported_at,
        }),
        ..wire::DeviceHealth::default()
    })
}

/// A label printer's last day, from the print queue: what it printed, what
/// it could not encode, the tags thrown away on failed attempts, and whether
/// its most recent attempt failed — its fault. A receipt printer has no queue
/// here and reports only its last use.
fn printer_health(
    connection: &Connection,
    config: &Value,
    now: DateTime<Utc>,
) -> Option<wire::DeviceHealth> {
    let host = config.get("host").and_then(Value::as_str)?;
    let port = config.get("port").and_then(Value::as_i64)?;
    let since = stamp(now - Duration::hours(24));
    let figures = connection
        .query_row(
            "SELECT max(i.printed_at),
                    COALESCE(SUM(i.status = 'PRINTED' AND i.printed_at >= ?3), 0),
                    COALESCE(SUM(i.status = 'FAILED' AND i.claimed_at >= ?3), 0),
                    COALESCE(SUM(CASE WHEN i.claimed_at < ?3 OR i.claimed_at IS NULL THEN 0
                                      WHEN i.status = 'FAILED' THEN i.attempts
                                      WHEN i.attempts > 1 THEN i.attempts - 1
                                      ELSE 0 END), 0)
               FROM print_item i
               JOIN print_session s ON s.session_id = i.session_id
              WHERE s.printer_host = ?1 AND s.printer_port = ?2",
            params![host, port, since],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()
        .ok()
        .flatten();
    let latest = connection
        .query_row(
            "SELECT i.status, i.last_error, i.claimed_at
               FROM print_item i
               JOIN print_session s ON s.session_id = i.session_id
              WHERE s.printer_host = ?1 AND s.printer_port = ?2
                AND i.status IN ('PRINTED', 'FAILED')
              ORDER BY COALESCE(i.printed_at, i.claimed_at) DESC
              LIMIT 1",
            params![host, port],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .ok()
        .flatten();
    let (fault, fault_at) = match latest {
        Some((status, error, at)) if status == "FAILED" => (
            Some(error.unwrap_or_else(|| "the printer failed the last label".to_owned())),
            parse_time(at),
        ),
        _ => (None, None),
    };
    let (last_print_at, printed, failed, void) = figures.unwrap_or((None, 0, 0, 0));
    Some(wire::DeviceHealth {
        last_print_at: parse_time(last_print_at),
        labels_printed_24h: Some(printed),
        encode_failures_24h: Some(failed),
        void_tags_24h: Some(void),
        fault,
        fault_at,
        ..wire::DeviceHealth::default()
    })
}

/// A handheld's or fixed reader's activity: its last ping and what it said
/// about itself (`edge_rfid_device_health`, sqlite 0064), the newest tag it
/// filed and its reads per minute over the last quarter hour.
fn reader_health(
    connection: &Connection,
    device_id: &str,
    now: DateTime<Utc>,
) -> Option<wire::DeviceHealth> {
    let ping = connection
        .query_row(
            "SELECT pinged_at, battery_percent, app_version, last_scan_at
               FROM edge_rfid_device_health WHERE device_id = ?1",
            params![device_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()
        .ok()
        .flatten();
    let last_tag_at: Option<String> = connection
        .query_row(
            "SELECT max(last_seen_at) FROM edge_observation_sighting WHERE device_id = ?1",
            params![device_id],
            |row| row.get(0),
        )
        .ok()
        .flatten();
    let reads: i64 = connection
        .query_row(
            "SELECT COALESCE(SUM(read_count), 0) FROM edge_observation_sighting
              WHERE device_id = ?1 AND last_seen_at >= ?2",
            params![
                device_id,
                stamp(now - Duration::minutes(READS_WINDOW_MINUTES))
            ],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let (pinged_at, battery, app_version, last_scan_at) = ping.unwrap_or((None, None, None, None));
    Some(wire::DeviceHealth {
        pinged_at: parse_time(pinged_at),
        battery_percent: battery.and_then(|value| u8::try_from(value).ok()),
        app_version,
        last_scan_at: parse_time(last_scan_at),
        last_tag_at: parse_time(last_tag_at),
        reads_per_minute: Some(reads as f64 / READS_WINDOW_MINUTES as f64),
        reads_window_minutes: Some(READS_WINDOW_MINUTES),
        ..wire::DeviceHealth::default()
    })
}
