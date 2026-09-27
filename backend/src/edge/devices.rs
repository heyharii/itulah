//! The devices enrolled to this node: a till joining, a printer recorded, and
//! every one of them reported to head office.
//!
//! # A till joins by asking, and a supervisor says yes
//!
//! The till mints its own secret, sends only the SHA-256 of it, and shows the
//! short code and six-digit number it gets back ([`begin_join`]). A supervisor
//! at the shop sees the same code and number in the list of waiting tills
//! ([`pending_joins`]) and approves the one standing in front of them
//! ([`approve_join`]). The till learns it has been let in by asking with a
//! proof only the key's holder can make ([`join_status`]), and from then on
//! signs every request exactly as a till paired the old way does
//! (`edge/fingerprint.rs`, [`TerminalProof`]) — the node keeps the digest and
//! nothing else, as it always has.
//!
//! **Who may say yes.** A supervisor's finger or PIN pressed at a till that
//! has already joined, which leaves a one-shot authorisation
//! (`edge_supervisor_grant`) the approval spends — the "one tap and a finger"
//! the owner asked for. A shop's *first* till has no till to press a finger on,
//! so a signed-in supervisor session approves it alone; after that, a
//! supervisor session without a finger is refused. An Admin session is always
//! enough, as it was for the old pairing route, which stays.
//!
//! The till is labelled "Kasir N", the lowest number no live till at this node
//! is using, unless the approver names it or it replaces a till — then it takes
//! the old one's name, and the old one is revoked and kept. Not while the old
//! till's drawer is open: a shift is kept by the till's name, and a replacement
//! let in then would take the old shift's money as its own
//! ([`refuse_while_shift_open`]).
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
    self as wire, DeviceReport, DeviceStatusCommand, JoinAnswer, JoinRequest, JoinStatus,
    JoinStatusRequest, NodeIdentity, KIND_PRINTER, KIND_RFID_READER, KIND_TILL, STATUS_ACTIVE,
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
    if kind != KIND_TILL {
        return Err(EdgeError::Validation(format!(
            "a {kind} does not join a node this way; only a till does"
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

/// The approver's choices. All optional: an empty body approves the till
/// under the next free "Kasir N".
#[derive(Debug, Default, Deserialize)]
pub struct ApproveJoinRequest {
    #[serde(default)]
    pub label: Option<String>,
    /// The till this one takes over from. It is revoked in the same
    /// transaction and its row kept; the new till takes its label.
    #[serde(default)]
    pub replaces_terminal_id: Option<String>,
    /// A supervisor's one-shot authorisation, from a finger or a PIN pressed
    /// at a till that has already joined (`POST /api/v1/auth/fingerprints/claim`
    /// or `/api/v1/auth/pin/claim` with purpose `SUPERVISOR`). Spent here.
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
    let now = Utc::now();
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    expire_stale_joins(&tx, now)?;
    let row: Option<(String, String, String, Option<String>)> = tx
        .query_row(
            "SELECT code, key_sha256, machine_json, outcome FROM edge_device_join WHERE join_id=?1",
            params![join_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(db)?;
    let Some((code, key_sha256, machine_json, outcome)) = row else {
        return Err(EdgeError::NotFound(format!("join request {join_id}")));
    };
    if let Some(outcome) = outcome {
        return Err(EdgeError::Conflict(format!(
            "that request is already {}",
            outcome.to_ascii_lowercase()
        )));
    }
    let shown_code = wire::display_join_code(&code);

    // Who says yes, and how they proved it.
    let active_tills: i64 = tx
        .query_row(
            "SELECT count(*) FROM edge_terminal WHERE active=1",
            [],
            |row| row.get(0),
        )
        .map_err(db)?;
    let grant = request
        .authorization
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty());
    let (approver, via) = match (grant, session) {
        (Some(token), _) => (fingerprint::spend_grant(&tx, token)?, "GRANT"),
        // Authentication is off on this node: nobody to ask.
        (None, None) => ("api".to_string(), "SESSION"),
        (None, Some((username, role))) if role >= Role::Admin => (username.to_string(), "SESSION"),
        (None, Some((username, role))) if role >= Role::Supervisor && active_tills == 0 => {
            (username.to_string(), "SESSION")
        }
        (None, Some((_, role))) if role >= Role::Supervisor => {
            return Err(EdgeError::Forbidden(
                "confirm with a supervisor's finger (or PIN) at a till that has already \
                 joined this shop, then approve with that authorisation"
                    .into(),
            ));
        }
        (None, Some(_)) => {
            return Err(EdgeError::Forbidden(
                "only a supervisor can let a till join this shop".into(),
            ));
        }
    };

    // The till it replaces, revoked first so its label is free to inherit.
    let replaced = match request
        .replaces_terminal_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        Some(old_id) => {
            let old: Option<(String, String)> = tx
                .query_row(
                    "SELECT label, status FROM edge_terminal WHERE terminal_id=?1",
                    params![old_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(db)?;
            let Some((old_label, old_status)) = old else {
                return Err(EdgeError::NotFound(format!("till {old_id}")));
            };
            if old_status == STATUS_REVOKED {
                return Err(EdgeError::Conflict(format!(
                    "{old_label} is already revoked; approve without replacing it"
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
                KIND_TILL,
                "REPLACED",
                &approver,
                Some(reason.as_str()),
                now,
            )?;
            Some((old_id.to_string(), old_label))
        }
        None => None,
    };

    let label = match request
        .label
        .as_deref()
        .map(str::trim)
        .filter(|label| !label.is_empty())
    {
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
                wire::next_till_label(taken.iter().map(String::as_str))
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
         VALUES (?1,?2,?3,1,0,?4,?5,?4,'TILL','ACTIVE',?6,?7,?8,'{}')",
        params![
            terminal_id,
            label,
            key_sha256,
            stamp(now),
            approver,
            join_id,
            replaced_id,
            machine_json
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
        KIND_TILL,
        "JOINED",
        &approver,
        Some(format!("joined with code {shown_code}").as_str()),
        now,
    )?;
    tx.commit().map_err(db)?;
    Ok(ApprovedTill {
        join_id: join_id.to_string(),
        terminal_id,
        label,
        approved_by: approver,
        approved_via: via.to_string(),
        replaced_terminal_id: replaced_id,
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
    let till: Option<String> = connection
        .query_row(
            "SELECT status FROM edge_terminal WHERE terminal_id=?1",
            params![device_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?;
    let (kind, current) = match till {
        Some(current) => (KIND_TILL, current),
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
    if kind == KIND_TILL {
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

/// A supervisor at the shop suspends, reactivates or revokes a till or a
/// printer. A suspended till's signed requests are refused until it is
/// reactivated; a revoked one's for good.
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
                        status_reason, peripherals_json, machine_json
                   FROM edge_terminal
                  ORDER BY paired_at",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([], |row| {
                let peripherals = parse_json(row.get(10)?);
                let machine = parse_json(row.get(11)?);
                Ok(DeviceReport {
                    device_id: row.get(0)?,
                    kind: KIND_TILL.to_string(),
                    label: row.get(1)?,
                    status: row.get(2)?,
                    last_seen_at: parse_time(row.get(3)?),
                    registered_at: parse_time(row.get(4)?),
                    registered_by: row.get(5)?,
                    replaces: row.get(6)?,
                    status_changed_at: parse_time(row.get(7)?),
                    status_changed_by: row.get(8)?,
                    status_reason: row.get(9)?,
                    config: json!({ "peripherals": peripherals, "machine": machine }),
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
                        host, port, language, purpose
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
    Ok(devices)
}
