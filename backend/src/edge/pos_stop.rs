//! What head office stopped on this node's POS, and the refusals that follow
//! (postgres 0990, sqlite 0087; the client's review of 23 Oct 2026).
//!
//! Three things can be stopped, all from head office only:
//!
//! * **The store**, or removed for good: `edge_pos_stop` scope `STORE`, from
//!   the auth policy's `pos_stops` ([`replace`]).
//! * **One person**, at every store: scope `PERSON`, same source.
//! * **A till**: a device, `edge_terminal.status` SUSPENDED (stopped) or
//!   REVOKED (removed), set by head office's `device.status.set.v1`. A
//!   stopped till's signature is refused already (`edge/fingerprint.rs`), so a
//!   finger cannot sign anybody in at that machine. Its *seat* is what a drawer
//!   and a sale are kept by (`KASIR-n`, `till::seat_label`), so the seat is
//!   stopped too — unless another, active till has taken its name.
//!
//! # One rule
//!
//! Stopped means no selling and no new shift ([`refuse_opening`],
//! [`refuse_selling`]). A drawer already open can still be counted and
//! closed: nothing here is called on the way to a count. A sale is compared
//! with the moment of the stop, not with now, so a sale rung before the stop
//! and waiting in a till's outbox while the line was down still lands.
//!
//! # The till asks before anybody signs in
//!
//! [`standing`] answers `GET /api/v1/till/standing`, which needs no session:
//! the POS shows "Kasir 3 dihentikan" or "Toko dihentikan" on its door, and
//! a door is what a till shows before anybody has signed in.
//!
//! The refusals are in Indonesian: the POS is the only place they are read.
//!
//! A database without `edge_pos_stop` — an auth-only connection, a test
//! fixture — is a node that has not heard of a stop, never a failure.

use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;

use crate::cloud::domain::PosStops;
use crate::edge::contracts::EdgeError;
use crate::edge::till::{seat_label, SEAT_PREFIX};
use crate::sync::device::{KIND_TILL, KIND_WAREHOUSE, STATUS_ACTIVE, STATUS_SUSPENDED};

fn stamp(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn parse(at: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(at)
        .ok()
        .map(|at| at.with_timezone(&Utc))
}

/// Replace what this node holds with what one auth policy says. Called only
/// for a policy newer than the one applied, and only when it said anything
/// about stops (`edge::sync::apply_auth_policy`).
pub fn replace(
    tx: &Transaction<'_>,
    stops: &PosStops,
    policy_version: i64,
) -> rusqlite::Result<()> {
    tx.execute("DELETE FROM edge_pos_stop", [])?;
    if let Some(store) = &stops.store {
        tx.execute(
            "INSERT INTO edge_pos_stop
                 (scope, subject, stopped_at, stopped_by, reason, removed_at, policy_version)
             VALUES ('STORE', '', ?1, ?2, ?3, ?4, ?5)",
            params![
                stamp(store.at),
                store.by,
                store.reason,
                store.removed_at.map(stamp),
                policy_version
            ],
        )?;
    }
    for person in &stops.people {
        tx.execute(
            "INSERT INTO edge_pos_stop
                 (scope, subject, stopped_at, stopped_by, reason, removed_at, policy_version)
             VALUES ('PERSON', ?1, ?2, ?3, ?4, NULL, ?5)
             ON CONFLICT (scope, subject) DO NOTHING",
            params![
                person.user_id.to_string(),
                stamp(person.stop.at),
                person.stop.by,
                person.stop.reason,
                policy_version
            ],
        )?;
    }
    Ok(())
}

/// A stop as the till shows it.
#[derive(Clone, Debug, Serialize)]
pub struct StopNote {
    pub at: DateTime<Utc>,
    pub by: String,
    pub reason: String,
    /// A store only: when head office removed it for good.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed_at: Option<DateTime<Utc>>,
}

/// A till head office stopped (SUSPENDED) or removed (REVOKED).
#[derive(Clone, Debug, Serialize)]
pub struct TillStop {
    /// `Kasir 3`.
    pub label: String,
    /// `SUSPENDED` or `REVOKED`.
    pub status: String,
    pub at: Option<DateTime<Utc>>,
    pub reason: Option<String>,
}

/// A drawer still open at a till's seat: it may be counted and closed.
#[derive(Clone, Debug, Serialize)]
pub struct OpenDrawer {
    pub shift_id: String,
    /// The login that holds it.
    pub opened_by: String,
    /// Their name, or the login when the node has none.
    pub name: String,
}

/// `GET /api/v1/till/standing?terminal_id=…`: what head office has stopped
/// that this till must show on its door.
#[derive(Clone, Debug, Serialize)]
pub struct TillStanding {
    /// The store, stopped or removed.
    pub store: Option<StopNote>,
    /// This till, or the seat it sits at.
    pub till: Option<TillStop>,
    /// The drawer still open at this till's seat.
    pub open_shift: Option<OpenDrawer>,
    /// Whether this node holds the pairing the till asked about: `false` for
    /// a till joined to the server this one replaced. Absent when not asked.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paired: Option<bool>,
}

/// Whether `pairing_id` is a terminal this node knows and has not let go.
pub fn is_paired(connection: &Connection, pairing_id: &str) -> bool {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM edge_terminal WHERE terminal_id = ?1 AND status = ?2)",
            params![pairing_id.trim(), STATUS_ACTIVE],
            |row| row.get::<_, bool>(0),
        )
        .unwrap_or(true)
}

/// The store's stop, when head office has stopped or removed it.
pub fn store_stop(connection: &Connection) -> Option<StopNote> {
    connection
        .query_row(
            "SELECT stopped_at, stopped_by, reason, removed_at
               FROM edge_pos_stop WHERE scope = 'STORE' AND subject = ''",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()
        .ok()
        .flatten()
        .and_then(|(at, by, reason, removed_at)| {
            Some(StopNote {
                at: parse(&at)?,
                by,
                reason,
                removed_at: removed_at.as_deref().and_then(parse),
            })
        })
}

/// One person's stop on the POS, by their login.
pub fn person_stop(connection: &Connection, username: &str) -> Option<StopNote> {
    connection
        .query_row(
            "SELECT s.stopped_at, s.stopped_by, s.reason
               FROM edge_pos_stop s
               JOIN edge_user u ON u.id = s.subject
              WHERE s.scope = 'PERSON' AND u.username = ?1",
            params![username.trim()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .ok()
        .flatten()
        .and_then(|(at, by, reason)| {
            Some(StopNote {
                at: parse(&at)?,
                by,
                reason,
                removed_at: None,
            })
        })
}

/// Whether this person holds an open drawer anywhere at this node. A person
/// stopped on the POS may still sign in to close it.
pub fn holds_open_drawer(connection: &Connection, username: &str) -> bool {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM cash_shift WHERE opened_by = ?1 AND status = 'OPEN')",
            params![username.trim()],
            |row| row.get::<_, bool>(0),
        )
        .unwrap_or(false)
}

fn till_stop_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TillStop> {
    Ok(TillStop {
        label: row.get(0)?,
        status: row.get(1)?,
        at: row.get::<_, Option<String>>(2)?.as_deref().and_then(parse),
        reason: row.get(3)?,
    })
}

/// The seat a till sits at: a seat id as it is, a joined till's `Kasir n` as
/// `KASIR-n`, anything else (a till from before seats) as its own id.
fn seat_of(connection: &Connection, terminal_id: &str) -> String {
    let terminal_id = terminal_id.trim();
    if terminal_id.starts_with(SEAT_PREFIX) {
        return terminal_id.to_string();
    }
    let label: Option<String> = connection
        .query_row(
            "SELECT label FROM edge_terminal WHERE terminal_id = ?1",
            params![terminal_id],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();
    label
        .as_deref()
        .and_then(|label| label.strip_prefix("Kasir "))
        .filter(|number| !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()))
        .map(|number| format!("{SEAT_PREFIX}{number}"))
        .unwrap_or_else(|| terminal_id.to_string())
}

/// The seat's stop: a stopped till carries its name and no active till has
/// taken the name since. A removed till frees its seat for a new PC, so only
/// a stopped one (SUSPENDED) stops the seat.
pub fn seat_stop(connection: &Connection, seat: &str) -> Option<TillStop> {
    let label = seat_label(seat.trim());
    connection
        .query_row(
            "SELECT label, status, status_changed_at, status_reason
               FROM edge_terminal t
              WHERE t.kind = ?3 AND t.status = ?4
                AND (t.label = ?1 OR t.terminal_id = ?2)
                AND NOT EXISTS (SELECT 1 FROM edge_terminal a
                                 WHERE a.kind = ?3 AND a.status = ?5
                                   AND (a.label = ?1 OR a.terminal_id = ?2))
              ORDER BY t.status_changed_at DESC
              LIMIT 1",
            params![
                label,
                seat.trim(),
                KIND_TILL,
                STATUS_SUSPENDED,
                STATUS_ACTIVE
            ],
            till_stop_row,
        )
        .optional()
        .ok()
        .flatten()
}

/// This machine's own stop: a joined till head office stopped or removed.
fn machine_stop(connection: &Connection, terminal_id: &str) -> Option<TillStop> {
    connection
        .query_row(
            "SELECT label, status, status_changed_at, status_reason
               FROM edge_terminal
              WHERE terminal_id = ?1 AND kind = ?2 AND status <> ?3",
            params![terminal_id.trim(), KIND_TILL, STATUS_ACTIVE],
            till_stop_row,
        )
        .optional()
        .ok()
        .flatten()
        .or_else(|| warehouse_stop(connection, terminal_id))
}

/// A warehouse PC's own stop (Central Gudang, 25 Oct 2026), by the name it
/// asks with — its label, "Gudang 1" — since it has no seat to be found by.
/// A removed one whose name a new PC has taken is not this machine's stop.
fn warehouse_stop(connection: &Connection, name: &str) -> Option<TillStop> {
    connection
        .query_row(
            "SELECT label, status, status_changed_at, status_reason
               FROM edge_terminal t
              WHERE t.kind = ?2 AND t.status <> ?3
                AND (t.terminal_id = ?1 OR t.label = ?1)
                AND NOT EXISTS (SELECT 1 FROM edge_terminal a
                                 WHERE a.kind = ?2 AND a.status = ?3
                                   AND (a.terminal_id = ?1 OR a.label = ?1))
              ORDER BY t.status_changed_at DESC
              LIMIT 1",
            params![name.trim(), KIND_WAREHOUSE, STATUS_ACTIVE],
            till_stop_row,
        )
        .optional()
        .ok()
        .flatten()
}

fn store_refusal(stop: &StopNote) -> EdgeError {
    EdgeError::Conflict(if stop.removed_at.is_some() {
        "Toko ini sudah dihapus kantor pusat.".into()
    } else if stop.reason.is_empty() {
        "Toko dihentikan kantor pusat. Tidak bisa berjualan.".into()
    } else {
        format!(
            "Toko dihentikan kantor pusat · {}. Tidak bisa berjualan.",
            stop.reason
        )
    })
}

/// A supervisor head office stopped says yes to nothing at a till
/// (`till::verify_supervisor`): stopping a person takes away their counter,
/// and their signature on somebody else's void with it.
pub fn refuse_approving(connection: &Connection, approver: &str) -> Result<(), EdgeError> {
    if person_stop(connection, approver).is_some() {
        return Err(EdgeError::Conflict(
            "Akses POS supervisor ini dihentikan kantor pusat; minta supervisor lain.".into(),
        ));
    }
    Ok(())
}

fn person_refusal() -> EdgeError {
    EdgeError::Conflict("Akses POS Anda dihentikan kantor pusat.".into())
}

fn till_refusal(stop: &TillStop) -> EdgeError {
    EdgeError::Conflict(match stop.reason.as_deref() {
        Some(reason) if !reason.trim().is_empty() => format!(
            "{} dihentikan kantor pusat · {}. Tidak bisa berjualan.",
            stop.label, reason
        ),
        _ => format!(
            "{} dihentikan kantor pusat. Tidak bisa berjualan.",
            stop.label
        ),
    })
}

/// Refuse opening a shift at `seat` for `actor` while the store, the person or
/// the seat is stopped.
pub fn refuse_opening(connection: &Connection, actor: &str, seat: &str) -> Result<(), EdgeError> {
    if let Some(stop) = store_stop(connection) {
        return Err(store_refusal(&stop));
    }
    if person_stop(connection, actor).is_some() {
        return Err(person_refusal());
    }
    if let Some(stop) = seat_stop(connection, seat) {
        return Err(till_refusal(&stop));
    }
    Ok(())
}

/// Refuse a sale `actor` rang at `at` on `shift` when, at that moment, the
/// store, the person or the shift's seat had been stopped. A sale from before
/// the stop passes: it was rung while selling was allowed.
pub fn refuse_selling(
    connection: &Connection,
    actor: &str,
    shift: Option<&str>,
    at: DateTime<Utc>,
) -> Result<(), EdgeError> {
    if let Some(stop) = store_stop(connection) {
        if stop.at <= at || stop.removed_at.is_some_and(|removed| removed <= at) {
            return Err(store_refusal(&stop));
        }
    }
    if let Some(stop) = person_stop(connection, actor) {
        if stop.at <= at {
            return Err(person_refusal());
        }
    }
    let Some(shift) = shift else {
        return Ok(());
    };
    let seat: Option<String> = connection
        .query_row(
            "SELECT terminal_id FROM cash_shift WHERE id = ?1",
            params![shift],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();
    if let Some(stop) = seat.as_deref().and_then(|seat| seat_stop(connection, seat)) {
        // A stop the node holds with no time is read as already in force.
        if stop.at.is_none_or(|stopped| stopped <= at) {
            return Err(till_refusal(&stop));
        }
    }
    Ok(())
}

/// What the till at `terminal_id` must show on its door.
pub fn standing(connection: &Connection, terminal_id: &str) -> TillStanding {
    let seat = seat_of(connection, terminal_id);
    let till = machine_stop(connection, terminal_id).or_else(|| seat_stop(connection, &seat));
    let open_shift = connection
        .query_row(
            "SELECT c.id, c.opened_by,
                    COALESCE(NULLIF(trim(u.display_name), ''), c.opened_by)
               FROM cash_shift c
               LEFT JOIN edge_user u ON u.username = c.opened_by
              WHERE c.terminal_id = ?1 AND c.status = 'OPEN'
              ORDER BY c.opened_at DESC
              LIMIT 1",
            params![seat],
            |row| {
                Ok(OpenDrawer {
                    shift_id: row.get(0)?,
                    opened_by: row.get(1)?,
                    name: row.get(2)?,
                })
            },
        )
        .optional()
        .ok()
        .flatten();
    TillStanding {
        store: store_stop(connection),
        till,
        open_shift,
        paired: None,
    }
}
