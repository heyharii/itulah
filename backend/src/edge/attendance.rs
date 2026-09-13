//! The unit's punch station: who is posted here, what they are on today, and
//! what the reader saw.
//!
//! # What this box is allowed to decide
//!
//! Almost nothing, and that is the design. The cloud owns employment, the
//! roster, the attendance policy, the corrections and the templates. This
//! module holds the line by computing exactly three things:
//!
//! 1. **is this person posted here** — refused against the published book,
//!    offline, so a stranger at the reader is turned away without an uplink;
//! 2. **is this station still trusted** — refused against the published
//!    terminal list, offline, so head office suspending a device is an
//!    effective act after the router reboots;
//! 3. **what does the plan say for today** — read out and shown, never judged.
//!
//! It does **not** decide whether somebody was late. Lateness needs the policy
//! version in force on that date and the correction chain, neither of which is
//! here, and a box that guessed would produce a second answer to a question the
//! centre already answers. The station shows the planned start beside the punch
//! and lets a person draw their own conclusion.
//!
//! # Offline is a property of this table, not of a browser
//!
//! A punch is a row in `attendance_punch` plus a `sync_fact_log` entry written
//! in the **same transaction**. So an acknowledged punch is always queued for
//! upload, and the retries, the circuit breaker and the dead letters are the
//! ones the sync engine already has. The donor's README is explicit that a
//! `localStorage` queue is not the mechanism and never was; this is why.
//!
//! # The device boundary is somewhere else
//!
//! Nothing here talks to a reader. The hardware agent owns the device and
//! exposes local HTTP plus a bounded event cursor; the shell polls that cursor
//! and calls [`punch`] with an employee the agent says it identified. That
//! boundary is deliberately unchanged from the donor so the shell can be ported
//! separately, and it is why matching is fail-closed without this file knowing
//! anything about it: in mock mode the agent identifies nobody, so nothing
//! reaches here to be admitted.

use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use super::contracts::EdgeError;
// The book's wire types live beside `COMMAND_ATTENDANCE_BOOK_REPLACE` in
// `cloud::domain::sync`, exactly as `AuthPolicySnapshot` lives beside
// `auth.policy.replace`: one definition, shared by the side that publishes
// it and the side that applies it, so the two cannot drift.
pub use crate::cloud::domain::{
    parse_attendance_book, AttendanceBook, BookEmployee, BookRosterDay, BookTerminal,
};

fn db(error: rusqlite::Error) -> EdgeError {
    super::sqlite::db(error)
}

fn stamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}

/// What travels up when somebody clocks in or out.
///
/// The cloud's `POST /api/v1/attendance/punches` takes the same field names, so
/// the applier that reads this fact and the route a station could call directly
/// are looking at one shape rather than two that drift.
pub const FACT_ATTENDANCE_PUNCH_RECORDED: &str = "attendance.punch.recorded";

/// How long a published book stays usable.
///
/// Fourteen days. A book older than that is refused, and the refusal is the
/// point: a station running on a three-week-old roster greets people warmly
/// while recording their days against shifts nobody scheduled, and the damage
/// is invisible until payroll. Long enough that a fortnight's outage does not
/// stop a shop; short enough that it cannot quietly become the permanent state.
///
/// It is not a grace period on *punching*. A punch with no readable book is
/// refused outright, because the two things a station must do before admitting
/// anybody — check the posting and check the device — both read the book.
pub const BOOK_STALE_AFTER_DAYS: i64 = 14;

// ── the published book ───────────────────────────────────────────────────

/// Replace the published book wholesale, inside the caller's transaction.
///
/// Deletes before it inserts, and the delete is the feature: a person who left
/// the company, a shift that was cancelled and a station that was revoked all
/// disappear because nothing carried them forward, rather than because somebody
/// remembered to remove them.
pub fn replace_book(tx: &Transaction<'_>, book: &AttendanceBook) -> Result<(), EdgeError> {
    let now = stamp(Utc::now());
    tx.execute("DELETE FROM attendance_roster_day", [])
        .map_err(db)?;
    tx.execute("DELETE FROM attendance_employee", [])
        .map_err(db)?;
    tx.execute("DELETE FROM attendance_terminal", [])
        .map_err(db)?;
    tx.execute(
        "INSERT INTO attendance_book (id, place_id, published_at, received_at)
         VALUES (1, ?1, ?2, ?3)
         ON CONFLICT (id) DO UPDATE SET
            place_id = excluded.place_id,
            published_at = excluded.published_at,
            received_at = excluded.received_at",
        params![book.place_id, stamp(book.published_at), now],
    )
    .map_err(db)?;

    for employee in &book.employees {
        tx.execute(
            "INSERT INTO attendance_employee
                (employee_id, code, display_name, place_id, status, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'ACTIVE', ?5)",
            params![
                employee.employee_id,
                employee.code,
                employee.display_name,
                book.place_id,
                now
            ],
        )
        .map_err(db)?;
    }
    for day in &book.roster {
        tx.execute(
            "INSERT INTO attendance_roster_day
                (employee_id, on_date, place_id, plan, shift_id, shift_name,
                 start_minute, end_minute, end_day_offset, unpaid_break_min)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                day.employee_id,
                day.on_date.to_string(),
                book.place_id,
                day.plan,
                day.shift_id,
                day.shift_name,
                day.start_minute,
                day.end_minute,
                day.end_day_offset,
                day.unpaid_break_min,
            ],
        )
        .map_err(db)?;
    }
    for terminal in &book.terminals {
        tx.execute(
            "INSERT INTO attendance_terminal (terminal_id, place_id, name, status, method)
             VALUES (?1, ?2, ?3, ?4, 'FINGERPRINT')",
            params![
                terminal.terminal_id,
                book.place_id,
                terminal.name,
                terminal.status
            ],
        )
        .map_err(db)?;
    }
    Ok(())
}

/// What this box knows about its own book — the station's status line.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BookStatus {
    /// `null` until the centre has published one. A station with no book admits
    /// nobody, and saying so is more useful than an empty staff list.
    pub place_id: Option<String>,
    pub published_at: Option<DateTime<Utc>>,
    pub received_at: Option<DateTime<Utc>>,
    pub employees: i64,
    pub rostered_days: i64,
    pub active_terminals: i64,
    /// How old the book is, in days, so a screen can say "from Tuesday" rather
    /// than show a timestamp nobody subtracts in their head.
    pub age_days: Option<i64>,
    /// `true` once the book is too old to punch against.
    pub stale: bool,
}

/// Read the status line. A box with no book answers, rather than erroring: the
/// station has to be able to draw "waiting for head office" on its own screen.
pub fn book_status(conn: &Connection) -> Result<BookStatus, EdgeError> {
    let row: Option<(String, String, String)> = conn
        .query_row(
            "SELECT place_id, published_at, received_at FROM attendance_book WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(db)?;
    let count = |sql: &str| -> Result<i64, EdgeError> {
        conn.query_row(sql, [], |row| row.get(0)).map_err(db)
    };
    let employees = count("SELECT count(*) FROM attendance_employee")?;
    let rostered_days = count("SELECT count(*) FROM attendance_roster_day")?;
    let active_terminals =
        count("SELECT count(*) FROM attendance_terminal WHERE status = 'ACTIVE'")?;

    let Some((place_id, published_at, received_at)) = row else {
        return Ok(BookStatus {
            place_id: None,
            published_at: None,
            received_at: None,
            employees,
            rostered_days,
            active_terminals,
            age_days: None,
            stale: true,
        });
    };
    let published = DateTime::parse_from_rfc3339(&published_at)
        .map(|value| value.with_timezone(&Utc))
        .ok();
    let age_days = published.map(|at| (Utc::now() - at).num_days());
    Ok(BookStatus {
        place_id: Some(place_id),
        published_at: published,
        received_at: DateTime::parse_from_rfc3339(&received_at)
            .map(|value| value.with_timezone(&Utc))
            .ok(),
        employees,
        rostered_days,
        active_terminals,
        // No book date is stale by the same reading as an absent book: we
        // cannot say how old it is, so we cannot say it is current.
        stale: age_days.is_none_or(|days| days > BOOK_STALE_AFTER_DAYS),
        age_days,
    })
}

// ── the station's own screen ─────────────────────────────────────────────

/// What a station shows one person after the reader recognises them.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TodayForEmployee {
    pub employee_id: String,
    pub code: String,
    /// The greeting. This is the whole reason the employee slice is on this box.
    pub display_name: String,
    pub business_date: NaiveDate,
    /// `SCHEDULED`, `REST_DAY`, `PUBLIC_HOLIDAY`, or `null` when nobody
    /// scheduled this day.
    ///
    /// `null` is **not** a rest day and not an error. It means the plan says
    /// nothing, and a station that rendered it as "hari libur" would be
    /// inventing a decision head office never took.
    pub plan: Option<String>,
    pub shift_name: Option<String>,
    /// `HH:MM`, place-local.
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    /// This box's own punches for the day, oldest first.
    pub punches: Vec<PunchedRow>,
    /// What the reader should offer next, from what has been punched so far.
    ///
    /// Advisory, not authority: it is `OUT` after an odd number of punches and
    /// `IN` otherwise. The centre pairs the day properly — collapsing
    /// double-taps under a policy this box is not told — so this is a button
    /// label rather than a claim about the day.
    pub suggested_direction: String,
}

/// One punch this box holds.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PunchedRow {
    pub punch_id: String,
    pub direction: String,
    /// `HH:MM`, and the offset separately, because a rota is read off a wall.
    pub at: String,
    pub day_offset: u8,
    pub recorded_at: DateTime<Utc>,
    pub clock_quality: String,
}

fn clock(minute: u16) -> String {
    format!("{:02}:{:02}", minute / 60, minute % 60)
}

/// The day, for one person the reader identified.
///
/// Refuses somebody the book does not have. That refusal is one of the three
/// things this box is entitled to decide, and it works with the line down,
/// which is the whole point of holding the slice.
pub fn today(
    conn: &Connection,
    employee_id: &str,
    business_date: NaiveDate,
) -> Result<TodayForEmployee, EdgeError> {
    let person: Option<(String, String)> = conn
        .query_row(
            "SELECT code, display_name FROM attendance_employee WHERE employee_id = ?1",
            [employee_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db)?;
    let Some((code, display_name)) = person else {
        return Err(EdgeError::NotFound(format!(
            "{employee_id} tidak terdaftar di unit ini"
        )));
    };

    let plan: Option<(
        String,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<i64>,
    )> = conn
        .query_row(
            "SELECT plan, shift_name, start_minute, end_minute, end_day_offset
               FROM attendance_roster_day
              WHERE employee_id = ?1 AND on_date = ?2",
            params![employee_id, business_date.to_string()],
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

    let punches = punches_on(conn, employee_id, business_date)?;
    let (plan_code, shift_name, starts_at, ends_at) = match plan {
        None => (None, None, None, None),
        Some((plan, shift_name, start, end, offset)) => {
            let starts_at = start.map(|minute| clock(minute as u16));
            let ends_at = end.map(|minute| {
                let text = clock(minute as u16);
                // `+1` spelled out, because "06:00" against a 22:00 start is
                // the one place a station's screen can be read as eight hours
                // early instead of eight hours later.
                if offset == Some(1) {
                    format!("{text} (+1)")
                } else {
                    text
                }
            });
            (Some(plan), shift_name, starts_at, ends_at)
        }
    };

    Ok(TodayForEmployee {
        employee_id: employee_id.to_owned(),
        code,
        display_name,
        business_date,
        plan: plan_code,
        shift_name,
        starts_at,
        ends_at,
        suggested_direction: if punches.len() % 2 == 1 { "OUT" } else { "IN" }.to_owned(),
        punches,
    })
}

/// One person's punches on one business date, oldest first.
pub fn punches_on(
    conn: &Connection,
    employee_id: &str,
    business_date: NaiveDate,
) -> Result<Vec<PunchedRow>, EdgeError> {
    let mut statement = conn
        .prepare(
            "SELECT punch_id, direction, day_offset, minute, recorded_at, clock_quality
               FROM attendance_punch
              WHERE employee_id = ?1 AND business_date = ?2
              ORDER BY day_offset, minute, recorded_at, punch_id",
        )
        .map_err(db)?;
    let rows = statement
        .query_map(params![employee_id, business_date.to_string()], |row| {
            let day_offset: i64 = row.get(2)?;
            let minute: i64 = row.get(3)?;
            let recorded_at: String = row.get(4)?;
            Ok(PunchedRow {
                punch_id: row.get(0)?,
                direction: row.get(1)?,
                at: clock(minute as u16),
                day_offset: day_offset as u8,
                recorded_at: DateTime::parse_from_rfc3339(&recorded_at)
                    .map(|value| value.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                clock_quality: row.get(5)?,
            })
        })
        .map_err(db)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db)?;
    Ok(rows)
}

// ── the punch ────────────────────────────────────────────────────────────

/// What a station asks for when the reader has identified somebody.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PunchRequest {
    /// Minted by the caller, so a retry over a flaky LAN is free.
    pub idempotency_key: String,
    /// The shell overwrites this from the signed-in principal, like every other
    /// write on this node: an actor from a request body is an actor anybody can
    /// claim.
    #[serde(default)]
    pub actor_id: String,
    /// Whom the reader identified. The agent's answer, never a person's typing
    /// — there is no keypad on this station by decision.
    pub employee_id: String,
    /// Which station. Checked against the published list, so a suspended device
    /// is refused offline.
    pub terminal_id: String,
    /// `IN` or `OUT`.
    pub direction: String,
    /// Which roster day this answers. Defaults to the local date, and is
    /// explicit for the one case that needs it: an overnight shift's 02:00
    /// clock-out belongs to the day the shift started.
    #[serde(default)]
    pub business_date: Option<NaiveDate>,
    /// What the box knows about its own clock: `OK`, `DRIFT` or `UNKNOWN`.
    /// Defaults to `UNKNOWN`, which is the honest answer when nobody said.
    #[serde(default)]
    pub clock_quality: Option<String>,
}

/// What the station shows after a punch lands.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Punched {
    pub punch_id: String,
    pub direction: String,
    pub business_date: NaiveDate,
    pub at: String,
    /// The greeting and the plan, so the screen needs one round trip rather
    /// than two while somebody is standing at the reader.
    pub today: TodayForEmployee,
}

/// Record a punch.
///
/// # The order of the refusals is deliberate
///
/// The book first, then the station, then the person. Each is cheaper than the
/// next and each explains itself differently, and somebody standing at a reader
/// at six in the morning should be told *which* of the three is wrong rather
/// than "tidak dikenal". A station with a stale book is head office's problem,
/// a suspended reader is the manager's, and an unknown person is HR's — and
/// those are three different people to go and find.
///
/// # What is NOT refused here
///
/// A closed month. This box is not told which months are closed, and inventing
/// a guess would mean a unit whose uplink is down starts refusing punches for a
/// reason it cannot check. The cloud refuses them on ingest, by name, and the
/// node stops retrying those — which is the honest split: the edge buffers what
/// it saw, and the centre decides what it can still accept.
pub fn punch(
    tx: &Transaction<'_>,
    request: &PunchRequest,
    now: DateTime<Utc>,
) -> Result<Punched, EdgeError> {
    let place: Option<String> = tx
        .query_row(
            "SELECT place_id FROM attendance_book WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?;
    let Some(place) = place else {
        return Err(EdgeError::Conflict(
            "buku absensi belum dikirim ke kotak ini, jadi tidak ada yang bisa dicatat".to_owned(),
        ));
    };

    let terminal: Option<String> = tx
        .query_row(
            "SELECT status FROM attendance_terminal WHERE terminal_id = ?1 AND place_id = ?2",
            params![request.terminal_id, place],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?;
    match terminal.as_deref() {
        None => {
            return Err(EdgeError::Forbidden(format!(
                "terminal {} tidak terdaftar di unit ini",
                request.terminal_id
            )))
        }
        Some("ACTIVE") => {}
        Some(status) => {
            // Fail closed, offline. Head office suspending a device is only a
            // real act if it survives the uplink going down.
            return Err(EdgeError::Forbidden(format!(
                "terminal {} berstatus {status} dan tidak boleh mencatat absensi",
                request.terminal_id
            )));
        }
    }

    let known: Option<i64> = tx
        .query_row(
            "SELECT 1 FROM attendance_employee WHERE employee_id = ?1 AND place_id = ?2",
            params![request.employee_id, place],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?;
    if known.is_none() {
        return Err(EdgeError::Forbidden(format!(
            "{} tidak ditugaskan di unit ini",
            request.employee_id
        )));
    }

    let direction = match request.direction.as_str() {
        "IN" | "OUT" => request.direction.clone(),
        other => {
            return Err(EdgeError::Validation(format!(
                "`{other}` bukan arah absensi; IN atau OUT"
            )))
        }
    };
    let clock_quality = match request.clock_quality.as_deref().unwrap_or("UNKNOWN") {
        quality @ ("OK" | "DRIFT" | "UNKNOWN") => quality.to_owned(),
        other => {
            return Err(EdgeError::Validation(format!(
                "`{other}` bukan kualitas jam; OK, DRIFT atau UNKNOWN"
            )))
        }
    };

    let local = now.date_naive();
    let business_date = request.business_date.unwrap_or(local);
    let minute = i64::from(
        now.time()
            .signed_duration_since(chrono::NaiveTime::MIN)
            .num_minutes() as i32,
    );
    // 0 when the reading is on the business date itself, 1 when it has run past
    // midnight into the next day and still belongs to the shift that started.
    // Anything further apart is not an overnight shift; it is a caller filing a
    // punch against a day it cannot be on, and it is refused rather than
    // clamped.
    let day_offset = match (local - business_date).num_days() {
        0 => 0i64,
        1 => 1i64,
        other => {
            return Err(EdgeError::Validation(format!(
                "absensi hari ini tidak bisa dicatat untuk {business_date} \
                 (selisih {other} hari)"
            )))
        }
    };

    let punch_id = request.idempotency_key.trim().to_owned();
    if punch_id.is_empty() {
        return Err(EdgeError::Validation(
            "idempotency_key wajib: itu yang membuat kiriman ulang aman".to_owned(),
        ));
    }

    let existing: Option<i64> = tx
        .query_row(
            "SELECT 1 FROM attendance_punch WHERE punch_id = ?1",
            [&punch_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?;
    if existing.is_none() {
        tx.execute(
            "INSERT INTO attendance_punch
                (punch_id, employee_id, terminal_id, direction, business_date,
                 day_offset, minute, recorded_at, clock_quality, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                punch_id,
                request.employee_id,
                request.terminal_id,
                direction,
                business_date.to_string(),
                day_offset,
                minute,
                stamp(now),
                clock_quality,
                stamp(now),
            ],
        )
        .map_err(db)?;
    }

    Ok(Punched {
        punch_id,
        direction,
        business_date,
        at: clock(u16::try_from(minute).unwrap_or(0)),
        today: today(tx, &request.employee_id, business_date)?,
    })
}

/// The fact one punch sends up.
///
/// Built here rather than in `sqlite.rs` so the field names live beside the
/// table they come from and beside the cloud route that reads them.
pub fn punch_fact(
    place_id: &str,
    punched: &Punched,
    request: &PunchRequest,
    now: DateTime<Utc>,
) -> serde_json::Value {
    serde_json::json!({
        "punch_id": punched.punch_id,
        "place_id": place_id,
        "employee_id": request.employee_id,
        "terminal_id": request.terminal_id,
        "direction": punched.direction,
        "business_date": punched.business_date.to_string(),
        "day_offset": punched
            .today
            .punches
            .iter()
            .find(|row| row.punch_id == punched.punch_id)
            .map_or(0, |row| row.day_offset),
        "minute": punched
            .today
            .punches
            .iter()
            .find(|row| row.punch_id == punched.punch_id)
            .map_or(0, |row| {
                row.at
                    .split_once(':')
                    .and_then(|(hour, minute)| {
                        Some(hour.parse::<u16>().ok()? * 60 + minute.parse::<u16>().ok()?)
                    })
                    .unwrap_or(0)
            }),
        "recorded_at": stamp(now),
        "clock_quality": request.clock_quality.clone().unwrap_or_else(|| "UNKNOWN".to_owned()),
    })
}

#[cfg(test)]
mod unit {
    use super::*;

    fn date(iso: &str) -> NaiveDate {
        iso.parse().expect("date")
    }

    fn book() -> AttendanceBook {
        AttendanceBook {
            place_id: "store-07".to_owned(),
            published_at: Utc::now(),
            employees: vec![BookEmployee {
                employee_id: "emp-1".to_owned(),
                code: "0001".to_owned(),
                display_name: "Andi".to_owned(),
            }],
            roster: vec![BookRosterDay {
                employee_id: "emp-1".to_owned(),
                on_date: date("2026-09-14"),
                plan: "SCHEDULED".to_owned(),
                shift_id: Some("pagi".to_owned()),
                shift_name: Some("Pagi".to_owned()),
                start_minute: Some(8 * 60),
                end_minute: Some(16 * 60),
                end_day_offset: Some(0),
                unpaid_break_min: Some(60),
            }],
            terminals: vec![BookTerminal {
                terminal_id: "term-07".to_owned(),
                name: "Pintu belakang".to_owned(),
                status: "ACTIVE".to_owned(),
            }],
        }
    }

    fn request(key: &str) -> PunchRequest {
        PunchRequest {
            idempotency_key: key.to_owned(),
            actor_id: "kasir".to_owned(),
            employee_id: "emp-1".to_owned(),
            terminal_id: "term-07".to_owned(),
            direction: "IN".to_owned(),
            business_date: None,
            clock_quality: Some("OK".to_owned()),
        }
    }

    /// A bare connection with only the attendance tables on it.
    ///
    /// Deliberately not a whole node: these functions take a connection and
    /// nothing else — the same shape `till.rs` and `petty.rs` use — so the
    /// tests need four tables rather than eighty-seven, and stay out of the
    /// way of every other lane editing `sqlite.rs`.
    fn store() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        crate::edge::sqlite::apply_attendance_schema(&conn).expect("attendance schema");
        conn
    }

    /// The book is a replacement, and the delete is the feature: a person who
    /// left the company disappears because nothing carried them forward.
    #[test]
    fn replacing_the_book_forgets_whoever_is_not_in_it() {
        let mut conn = store();
        let tx = conn.transaction().expect("tx");
        replace_book(&tx, &book()).expect("first");
        tx.commit().expect("commit");

        let mut second = book();
        second.employees.clear();
        second.roster.clear();
        let tx = conn.transaction().expect("tx");
        replace_book(&tx, &second).expect("second");
        tx.commit().expect("commit");

        let status = book_status(&conn).expect("status");
        assert_eq!(status.employees, 0, "a departed person is not carried over");
        assert_eq!(status.rostered_days, 0);
        assert_eq!(status.active_terminals, 1);
    }

    /// The greeting, which is the whole reason the slice is on this box.
    #[test]
    fn a_punch_greets_by_name_and_shows_the_shift() {
        let mut conn = store();
        let tx = conn.transaction().expect("tx");
        replace_book(&tx, &book()).expect("book");
        let now = "2026-09-14T01:07:00Z"
            .parse::<DateTime<Utc>>()
            .expect("now");
        let punched = punch(&tx, &request("p-1"), now).expect("punch");
        tx.commit().expect("commit");

        assert_eq!(punched.today.display_name, "Andi");
        assert_eq!(punched.today.plan.as_deref(), Some("SCHEDULED"));
        assert_eq!(punched.today.starts_at.as_deref(), Some("08:00"));
        assert_eq!(punched.today.suggested_direction, "OUT");
    }

    /// Redelivery over a flaky LAN is free.
    #[test]
    fn punching_twice_with_one_key_lands_once() {
        let mut conn = store();
        let tx = conn.transaction().expect("tx");
        replace_book(&tx, &book()).expect("book");
        let now = "2026-09-14T01:07:00Z"
            .parse::<DateTime<Utc>>()
            .expect("now");
        punch(&tx, &request("p-1"), now).expect("first");
        punch(&tx, &request("p-1"), now).expect("second");
        tx.commit().expect("commit");
        let held = punches_on(&conn, "emp-1", date("2026-09-14")).expect("read");
        assert_eq!(held.len(), 1);
    }

    /// Fail closed with the line down: a suspended station admits nobody.
    #[test]
    fn a_suspended_station_is_refused_offline() {
        let mut conn = store();
        let mut suspended = book();
        suspended.terminals[0].status = "SUSPENDED".to_owned();
        let tx = conn.transaction().expect("tx");
        replace_book(&tx, &suspended).expect("book");
        let now = "2026-09-14T01:07:00Z"
            .parse::<DateTime<Utc>>()
            .expect("now");
        let refused = punch(&tx, &request("p-1"), now);
        assert!(matches!(refused, Err(EdgeError::Forbidden(_))));
    }

    /// A person not posted here is turned away, offline, and the refusal names
    /// which of the three things is wrong.
    #[test]
    fn a_stranger_is_refused_offline() {
        let mut conn = store();
        let tx = conn.transaction().expect("tx");
        replace_book(&tx, &book()).expect("book");
        let now = "2026-09-14T01:07:00Z"
            .parse::<DateTime<Utc>>()
            .expect("now");
        let mut stranger = request("p-1");
        stranger.employee_id = "emp-99".to_owned();
        match punch(&tx, &stranger, now) {
            Err(EdgeError::Forbidden(message)) => {
                assert!(message.contains("tidak ditugaskan"), "{message}");
            }
            other => panic!("expected a named refusal, got {other:?}"),
        }
    }

    /// No book, no punching — and the refusal points at head office rather
    /// than at the person standing there.
    #[test]
    fn without_a_book_nothing_is_recorded() {
        let mut conn = store();
        let tx = conn.transaction().expect("tx");
        let now = "2026-09-14T01:07:00Z"
            .parse::<DateTime<Utc>>()
            .expect("now");
        match punch(&tx, &request("p-1"), now) {
            Err(EdgeError::Conflict(message)) => {
                assert!(message.contains("buku absensi belum dikirim"), "{message}");
            }
            other => panic!("expected a named refusal, got {other:?}"),
        }
    }

    /// A day nobody scheduled reads as nothing, never as a rest day. A station
    /// that rendered `null` as "hari libur" would be inventing a decision head
    /// office never took.
    #[test]
    fn an_unplanned_day_says_nothing_rather_than_rest_day() {
        let mut conn = store();
        let tx = conn.transaction().expect("tx");
        replace_book(&tx, &book()).expect("book");
        tx.commit().expect("commit");
        let day = today(&conn, "emp-1", date("2026-09-15")).expect("today");
        assert_eq!(day.plan, None);
        assert_eq!(day.shift_name, None);
        assert_eq!(day.display_name, "Andi", "still greeted by name");
    }

    /// An unreadable book blocks the command stream, so it is refused at the
    /// edge of the applier with a sentence rather than written and wondered
    /// about later.
    #[test]
    fn a_book_whose_shift_columns_disagree_is_refused() {
        let mut broken = book();
        broken.roster[0].shift_id = None;
        let payload = serde_json::to_value(&broken).expect("json");
        let refused = parse_attendance_book(&payload);
        assert!(refused.is_err(), "{refused:?}");
    }
}
