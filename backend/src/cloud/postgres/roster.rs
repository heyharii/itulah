//! Shift templates, the dated roster, and the close boundary, as rows.
//!
//! # The period is loaded, never accepted
//!
//! Every "may this land?" check in the roster kernel asks the
//! [`AttendancePeriod`] it is handed, so a caller who *supplies* the period
//! supplies the answer. A client that shipped its own open period would write
//! freely into a month that was closed and paid, and every guard would return
//! `Ok` while it happened. So the period is loaded here from the `(place,
//! month)` the date falls in — [`period_for`] — and there is no path that takes
//! one from a request body.
//!
//! # A roster day is rewritten whole, and that is not laziness
//!
//! The revisions are validated as a *chain*: each must be authorized by a key
//! that may plan, and none may be dated before the one it follows. The domain
//! is what enforces that, so a write loads the day, pushes into it — which is
//! where the refusal happens — and stores the result.

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    AttendanceError, AttendanceMonth, AttendancePeriod, CloseReadiness, DatedRoster, DayOffset,
    DayPlan, EmployeeId, MinuteOfDay, Minutes, PeriodEvent, PeriodStatus, RosterDay,
    RosterRevision, Shift, ShiftId, UnitId,
};
use chrono::{Datelike, NaiveDate};
use serde::Serialize;
use sqlx::{PgPool, Row};

fn corrupt(what: &str, detail: String) -> AppError {
    AppError::Configuration(format!(
        "stored {what} does not hydrate: {detail}. The rows disagree with the rules they encode."
    ))
}

/// Turn a domain refusal into the right HTTP answer.
pub fn attendance_error(error: AttendanceError) -> AppError {
    if error.is_forbidden() {
        AppError::Forbidden(error.to_string())
    } else if error.is_conflict() {
        AppError::Conflict(error.to_string())
    } else {
        AppError::Validation(error.to_string())
    }
}

// ── shift templates ──────────────────────────────────────────────────────

fn decode_shift(row: &sqlx::postgres::PgRow) -> Result<Shift, AppError> {
    let id: String = row.try_get("id")?;
    let name: String = row.try_get("name")?;
    let start: i32 = row.try_get("start_minute")?;
    let end: i32 = row.try_get("end_minute")?;
    let offset: i32 = row.try_get("end_day_offset")?;
    let unpaid: i32 = row.try_get("unpaid_break_min")?;

    let minute = |value: i32, what: &str| -> Result<MinuteOfDay, AppError> {
        u16::try_from(value)
            .map_err(|_| corrupt(what, format!("{value}")))
            .and_then(|raw| {
                MinuteOfDay::try_new(raw).map_err(|error| corrupt(what, error.to_string()))
            })
    };

    Shift::try_new(
        ShiftId::try_new(&id).map_err(|error| corrupt("shift id", error.to_string()))?,
        &name,
        minute(start, "shift start")?,
        minute(end, "shift end")?,
        u8::try_from(offset)
            .map_err(|_| corrupt("day offset", format!("{offset}")))
            .and_then(|raw| {
                DayOffset::try_new(raw).map_err(|error| corrupt("day offset", error.to_string()))
            })?,
        Minutes::new(u32::try_from(unpaid).unwrap_or(0)),
    )
    .map_err(|error| corrupt("shift", error.to_string()))
}

/// Every shift a roster may be built from.
///
/// `include_retired` is what separates the Setup screen — which shows what was
/// ever defined, because a roster day may still name a retired shift — from the
/// picker, which offers only what may still be chosen.
pub async fn list_shifts(pool: &PgPool, include_retired: bool) -> Result<Vec<Shift>, AppError> {
    let rows = sqlx::query(
        "SELECT id, name, start_minute, end_minute, end_day_offset, unpaid_break_min
           FROM attendance_shift
          WHERE ($1::bool OR retired_at IS NULL)
          ORDER BY start_minute, id",
    )
    .bind(include_retired)
    .fetch_all(pool)
    .await?;
    rows.iter().map(decode_shift).collect()
}

pub async fn load_shift(pool: &PgPool, id: &str) -> Result<Option<Shift>, AppError> {
    let row = sqlx::query(
        "SELECT id, name, start_minute, end_minute, end_day_offset, unpaid_break_min
           FROM attendance_shift WHERE id = $1 AND retired_at IS NULL",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.as_ref().map(decode_shift).transpose()
}

/// Define a shift. Refuses a code that already exists rather than replacing it:
/// redefining a shift changes what every roster day already naming it meant.
pub async fn define_shift(pool: &PgPool, shift: &Shift) -> Result<(), AppError> {
    let inserted = sqlx::query(
        "INSERT INTO attendance_shift
             (id, name, start_minute, end_minute, end_day_offset, unpaid_break_min)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(shift.id().as_str())
    .bind(shift.name())
    .bind(i32::from(shift.start().minutes()))
    .bind(i32::from(shift.end().minutes()))
    .bind(i32::from(shift.end_day_offset().days()))
    .bind(i32::try_from(shift.unpaid_break().get()).unwrap_or(0))
    .execute(pool)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "a shift {} is already defined",
            shift.id()
        )));
    }
    Ok(())
}

/// Retire a shift. Never delete: a roster day already naming it would be left
/// pointing at nothing, and the plans it produced are still the record of what
/// was planned.
pub async fn retire_shift(pool: &PgPool, id: &str) -> Result<(), AppError> {
    let updated = sqlx::query(
        "UPDATE attendance_shift SET retired_at = now()
          WHERE id = $1 AND retired_at IS NULL",
    )
    .bind(id)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("shift {id}")));
    }
    Ok(())
}

// ── the close boundary ───────────────────────────────────────────────────

fn decode_period(row: &sqlx::postgres::PgRow) -> Result<AttendancePeriod, AppError> {
    let unit: String = row.try_get("unit_id")?;
    let period: NaiveDate = row.try_get("period")?;
    let status: String = row.try_get("status")?;
    let history: serde_json::Value = row.try_get("history")?;

    AttendancePeriod::try_new(
        UnitId::try_new(&unit).map_err(|error| corrupt("unit id", error.to_string()))?,
        AttendanceMonth::try_new(period.year(), u8::try_from(period.month()).unwrap_or(1))
            .map_err(|error| corrupt("period", error.to_string()))?,
        PeriodStatus::parse(&status).ok_or_else(|| corrupt("period status", status.clone()))?,
        serde_json::from_value::<Vec<PeriodEvent>>(history)
            .map_err(|error| corrupt("period history", error.to_string()))?,
    )
    .map_err(|error| corrupt("attendance period", error.to_string()))
}

/// The period a `(place, date)` falls in — the one the roster kernel must be
/// handed.
///
/// An absent row is an **open** period rather than an error: an unclosed month
/// is the resting state, and a place that has never closed anything has no
/// rows. Materialising it only on the first close keeps the table a record of
/// decisions rather than a grid of every month since the shop opened.
pub async fn period_for(
    pool: &PgPool,
    unit: &UnitId,
    date: NaiveDate,
) -> Result<AttendancePeriod, AppError> {
    let month = AttendanceMonth::of(date);
    let first = month
        .first_day()
        .ok_or_else(|| corrupt("period", format!("{month} has no first day")))?;
    let row = sqlx::query(
        "SELECT unit_id, period, status, history
           FROM attendance_period WHERE unit_id = $1 AND period = $2",
    )
    .bind(unit.as_str())
    .bind(first)
    .fetch_optional(pool)
    .await?;
    match row.as_ref() {
        Some(row) => decode_period(row),
        None => Ok(AttendancePeriod::open(unit.clone(), month)),
    }
}

/// Every period a place has ever closed or reopened, newest first.
pub async fn periods_of(pool: &PgPool, unit: &UnitId) -> Result<Vec<AttendancePeriod>, AppError> {
    let rows = sqlx::query(
        "SELECT unit_id, period, status, history
           FROM attendance_period WHERE unit_id = $1 ORDER BY period DESC",
    )
    .bind(unit.as_str())
    .fetch_all(pool)
    .await?;
    rows.iter().map(decode_period).collect()
}

pub async fn save_period(pool: &PgPool, period: &AttendancePeriod) -> Result<(), AppError> {
    let first = period
        .period()
        .first_day()
        .ok_or_else(|| corrupt("period", "no first day".to_owned()))?;
    let history = serde_json::to_value(period.history())?;
    sqlx::query(
        "INSERT INTO attendance_period (unit_id, period, status, history)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (unit_id, period) DO UPDATE SET
            status = EXCLUDED.status,
            history = EXCLUDED.history,
            updated_at = now()",
    )
    .bind(period.unit().as_str())
    .bind(first)
    .bind(period.status().code())
    .bind(&history)
    .execute(pool)
    .await?;
    Ok(())
}

/// What a place must clear before its month can close.
///
/// Computed here from stored facts, never taken from a request body: every
/// field is an assertion about the data, and a client supplying its own zeros
/// would close a month over anything it liked while the recorded evidence said
/// it was clean.
///
/// # The punch-derived counts, and when they are still `None`
///
/// They used to be `None` always, because there was no punch source: open
/// corrections and unrostered punch days could not be counted, and sending
/// zeros would have been a claim nobody made and nobody verified.
///
/// A fingerprint terminal per unit is that source, so they are now **numbers
/// wherever a unit has one** — `place_has_terminal` is what decides. A unit
/// with no terminal still gets `None`, because the distinction the original
/// design protected is exactly the one that still matters: "the punch checks
/// were made and passed" and "there was nothing here to check" are different
/// facts, and only one of them is a zero.
///
/// A unit with no terminal still closes. It must, or its payroll could never
/// run — and the recorded evidence says the checks were not assessed rather
/// than that they were clean.
pub async fn close_readiness(
    pool: &PgPool,
    unit: &UnitId,
    month: AttendanceMonth,
) -> Result<CloseReadiness, AppError> {
    let first = month
        .first_day()
        .ok_or_else(|| corrupt("period", "no first day".to_owned()))?;

    let unresolved_leave: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM leave_request
          WHERE unit_id = $1 AND state = 'PENDING'
            AND from_date < ($2::date + interval '1 month')
            AND to_date >= $2::date",
    )
    .bind(unit.as_str())
    .bind(first)
    .fetch_one(pool)
    .await?;

    let unanswered_overtime: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM overtime_order
          WHERE unit_id = $1 AND state = 'AWAITING_CONSENT'
            AND on_date >= $2::date
            AND on_date < ($2::date + interval '1 month')",
    )
    .bind(unit.as_str())
    .bind(first)
    .fetch_one(pool)
    .await?;

    // Informational: a place may legitimately have staff who were not
    // scheduled — somebody on long leave, somebody who joined at the month's
    // end — so this never blocks.
    let without_roster: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM employee_assignment a
           JOIN employee e ON e.id = a.employee_id
          WHERE a.unit_id = $1 AND a.valid_to IS NULL AND e.status = 'ACTIVE'
            AND NOT EXISTS (
                SELECT 1 FROM roster_day r
                 WHERE r.employee_id = a.employee_id
                   AND r.on_date >= $2::date
                   AND r.on_date < ($2::date + interval '1 month')
            )",
    )
    .bind(unit.as_str())
    .bind(first)
    .fetch_one(pool)
    .await?;

    // Assessed only where there is something to assess. A unit with no
    // terminal has no punches and no corrections, and reporting two zeros for
    // it would say the checks passed.
    let (open_corrections, unrostered_punch_days) = if super::unit_has_terminal(pool, unit).await? {
        (
            Some(super::open_corrections_in(pool, unit, month).await?),
            Some(super::unrostered_punch_days_in(pool, unit, month).await?),
        )
    } else {
        (None, None)
    };

    Ok(CloseReadiness {
        unresolved_leave: u32::try_from(unresolved_leave).unwrap_or(u32::MAX),
        unanswered_overtime: u32::try_from(unanswered_overtime).unwrap_or(u32::MAX),
        open_corrections,
        unrostered_punch_days,
        employees_without_roster: u32::try_from(without_roster).unwrap_or(u32::MAX),
    })
}

// ── the roster ───────────────────────────────────────────────────────────

fn decode_roster_day(row: &sqlx::postgres::PgRow) -> Result<RosterDay, AppError> {
    let employee: String = row.try_get("employee_id")?;
    let unit: String = row.try_get("unit_id")?;
    let date: NaiveDate = row.try_get("on_date")?;
    let planned: serde_json::Value = row.try_get("planned")?;
    let amendments: serde_json::Value = row.try_get("amendments")?;

    RosterDay::try_new(
        EmployeeId::try_new(&employee)
            .map_err(|error| corrupt("employee id", error.to_string()))?,
        UnitId::try_new(&unit).map_err(|error| corrupt("unit id", error.to_string()))?,
        date,
        serde_json::from_value::<RosterRevision>(planned)
            .map_err(|error| corrupt("roster plan", error.to_string()))?,
        serde_json::from_value::<Vec<RosterRevision>>(amendments)
            .map_err(|error| corrupt("roster amendments", error.to_string()))?,
    )
    .map_err(|error| corrupt("roster day", error.to_string()))
}

const ROSTER_COLUMNS: &str = "employee_id, on_date, unit_id, planned, amendments";

/// One person's roster over a span.
pub async fn roster_of(
    pool: &PgPool,
    employee_id: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<DatedRoster, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {ROSTER_COLUMNS} FROM roster_day
          WHERE employee_id = $1 AND on_date >= $2 AND on_date <= $3
          ORDER BY on_date"
    ))
    .bind(employee_id)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;

    let days = rows
        .iter()
        .map(decode_roster_day)
        .collect::<Result<Vec<_>, AppError>>()?;
    DatedRoster::try_new(
        EmployeeId::try_new(employee_id)
            .map_err(|error| corrupt("employee id", error.to_string()))?,
        days,
    )
    .map_err(|error| corrupt("roster", error.to_string()))
}

/// A whole place's week, for the grid a manager builds.
pub async fn roster_at_unit(
    pool: &PgPool,
    unit_id: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<RosterDay>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {ROSTER_COLUMNS} FROM roster_day
          WHERE unit_id = $1 AND on_date >= $2 AND on_date <= $3
          ORDER BY employee_id, on_date"
    ))
    .bind(unit_id)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;
    rows.iter().map(decode_roster_day).collect()
}

pub async fn load_roster_day(
    pool: &PgPool,
    employee_id: &str,
    date: NaiveDate,
) -> Result<Option<RosterDay>, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {ROSTER_COLUMNS} FROM roster_day WHERE employee_id = $1 AND on_date = $2"
    ))
    .bind(employee_id)
    .bind(date)
    .fetch_optional(pool)
    .await?;
    row.as_ref().map(decode_roster_day).transpose()
}

/// Write one day, plan and amendments together.
///
/// The whole row rather than an append, because the amendment chain is
/// validated as a chain and the domain is what validated it. Appending by SQL
/// would move the rule into a statement that cannot express it.
pub async fn save_roster_day(pool: &PgPool, day: &RosterDay) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO roster_day (employee_id, on_date, unit_id, planned, amendments)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (employee_id, on_date) DO UPDATE SET
            unit_id = EXCLUDED.unit_id,
            planned = EXCLUDED.planned,
            amendments = EXCLUDED.amendments,
            updated_at = now()",
    )
    .bind(day.employee().as_str())
    .bind(day.date())
    .bind(day.unit().as_str())
    .bind(serde_json::to_value(day.original_revision())?)
    .bind(serde_json::to_value(day.amendments())?)
    .execute(pool)
    .await?;
    Ok(())
}

/// A rostered day flattened for a screen.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RosterDayRow {
    pub employee_id: String,
    pub unit_id: String,
    pub on_date: NaiveDate,
    /// `SCHEDULED`, `REST_DAY` or `PUBLIC_HOLIDAY`.
    pub plan: String,
    pub shift_id: Option<String>,
    pub shift_name: Option<String>,
    /// `HH:MM`, as a rota is read off a wall.
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    /// Whether the shift ends on the following calendar day.
    pub crosses_midnight: bool,
    /// Paid minutes: the span less the unpaid break.
    pub planned_work_minutes: Option<u32>,
    /// How many times this day has been planned. More than one is a governance
    /// signal, which is why it is a column rather than something to open a
    /// sheet for.
    pub revision_count: usize,
    pub planned_by: String,
    pub reason: String,
}

pub fn roster_row(day: &RosterDay) -> RosterDayRow {
    let plan = day.plan();
    let shift = plan.shift();
    RosterDayRow {
        employee_id: day.employee().to_string(),
        unit_id: day.unit().to_string(),
        on_date: day.date(),
        plan: plan.code().to_owned(),
        shift_id: shift.map(|shift| shift.id().to_string()),
        shift_name: shift.map(|shift| shift.name().to_owned()),
        starts_at: shift.map(|shift| shift.start().to_string()),
        ends_at: shift.map(|shift| shift.end().to_string()),
        crosses_midnight: shift.is_some_and(Shift::crosses_midnight),
        planned_work_minutes: shift.map(|shift| shift.planned_work().get()),
        revision_count: day.revision_count(),
        planned_by: day.authorization().actor().to_string(),
        reason: day.authorization().reason().to_string(),
    }
}

/// Which plan a day carried at an instant — what makes a settled month
/// reproducible.
pub fn plan_as_of(day: &RosterDay, at: chrono::DateTime<chrono::Utc>) -> Option<&DayPlan> {
    day.plan_as_of(at)
}
