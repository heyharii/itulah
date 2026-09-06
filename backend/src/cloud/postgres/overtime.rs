//! Overtime orders, as rows.
//!
//! # What this layer is responsible for that the kernel cannot be
//!
//! **The weekly cap needs the rest of the week, and only storage has it.**
//! [`OvertimeOrder::check_weekly_limit`] takes the week's other orders as an
//! argument, because which seven days count as one week is a rostering question
//! the kernel does not own. Assembling that week is this module's job, and it is
//! the half a caller gets wrong: counting *every* order in the window rather
//! than only the agreed ones. So the whole Monday–Sunday window is handed to the
//! kernel unfiltered — the kernel already counts only what carries an
//! authorization, and pre-filtering here would state the rule twice and let the
//! two copies drift.
//!
//! # There is no default policy, here either
//!
//! No row in `overtime_policy` means no policy, and every issue refuses by name
//! until an operator ratifies the caps. Inventing four hours a day because that
//! is the figure today is how a cap nobody ratified becomes the cap in force —
//! and the figures before PP 35/2021 were three and fourteen.

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    week_of, Authorization, DayKind, EmployeeId, Minutes, OvertimeError, OvertimeId,
    OvertimeOrder, OvertimeOrderWire, OvertimePolicy, OvertimeState, PlaceId,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};

/// A stored row that cannot be true. See `postgres::employment` for why this is
/// not a validation error.
fn corrupt(what: &str, detail: String) -> AppError {
    AppError::Configuration(format!(
        "stored {what} does not hydrate: {detail}. The row disagrees with the rules it encodes."
    ))
}

/// Turn a domain refusal into the right HTTP answer.
pub fn overtime_error(error: OvertimeError) -> AppError {
    if error.is_forbidden() {
        AppError::Forbidden(error.to_string())
    } else if error.is_conflict() {
        AppError::Conflict(error.to_string())
    } else {
        AppError::Validation(error.to_string())
    }
}

// ── the policy ───────────────────────────────────────────────────────────

/// The ratified caps, or `None` when nobody has ratified any.
///
/// `None` is a real answer and a refusable one: it is why an issue fails by
/// name rather than against a limit somebody typed once.
pub async fn load_overtime_policy(pool: &PgPool) -> Result<Option<OvertimePolicy>, AppError> {
    let row = sqlx::query(
        "SELECT version, max_per_day_minutes, max_per_week_minutes
           FROM overtime_policy ORDER BY version DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else { return Ok(None) };

    let version: i32 = row.try_get("version")?;
    let day: i32 = row.try_get("max_per_day_minutes")?;
    let week: i32 = row.try_get("max_per_week_minutes")?;
    let minutes = |value: i32, what: &str| -> Result<Minutes, AppError> {
        u32::try_from(value)
            .map(Minutes::new)
            .map_err(|_| corrupt(what, format!("{value} is not a minute count")))
    };
    OvertimePolicy::try_new(
        u32::try_from(version).map_err(|_| corrupt("policy version", format!("{version}")))?,
        minutes(day, "daily cap")?,
        minutes(week, "weekly cap")?,
    )
    .map(Some)
    .map_err(|error| corrupt("overtime policy", error.to_string()))
}

/// Ratify the caps. A new generation, never an edit: what each order was
/// checked against is the policy that was in force when it was issued.
pub async fn ratify_overtime_policy(
    pool: &PgPool,
    policy: &OvertimePolicy,
    ratified: &Authorization,
) -> Result<(), AppError> {
    let authority = serde_json::to_value(ratified)?;
    let inserted = sqlx::query(
        "INSERT INTO overtime_policy
             (version, max_per_day_minutes, max_per_week_minutes, ratified)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (version) DO NOTHING",
    )
    .bind(i32::try_from(policy.version()).unwrap_or(i32::MAX))
    .bind(i32::try_from(policy.max_per_day().get()).unwrap_or(i32::MAX))
    .bind(i32::try_from(policy.max_per_week().get()).unwrap_or(i32::MAX))
    .bind(&authority)
    .execute(pool)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "an overtime policy version {} already exists",
            policy.version()
        )));
    }
    Ok(())
}

// ── orders ───────────────────────────────────────────────────────────────

/// One order, with the two timestamps a screen shows.
pub struct OvertimeRecord {
    pub order: OvertimeOrder,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

const ORDER_COLUMNS: &str = "id, employee_id, place_id, on_date, day_kind, planned_minutes, \
                             ordered, state, consent, withdrawal, created_at, updated_at";

/// Rebuild the state from the three columns that carry it.
///
/// The same pairing the CHECK constraints enforce, restated where the decoding
/// happens: an answered order has a consent and nothing else, a withdrawn one
/// has a withdrawal and nothing else. A row satisfying neither shape is refused
/// rather than resolved to the nearest state — resolving it is how `AGREED`
/// with no consent becomes authorized overtime nobody agreed to.
fn build_state(
    state: &str,
    consent: Option<serde_json::Value>,
    withdrawal: Option<serde_json::Value>,
) -> Result<serde_json::Value, AppError> {
    // The column holds a bare authority; `WorkerConsent` is a struct with one
    // field, so the wrapper is added here and stripped on the way out.
    match (state, consent, withdrawal) {
        ("AWAITING_CONSENT", None, None) => Ok(serde_json::json!({ "state": "AWAITING_CONSENT" })),
        ("AGREED", Some(consent), None) => Ok(serde_json::json!({
            "state": "AGREED",
            "consent": { "authorization": consent },
        })),
        ("DECLINED", Some(consent), None) => Ok(serde_json::json!({
            "state": "DECLINED",
            "consent": { "authorization": consent },
        })),
        ("WITHDRAWN", None, Some(withdrawal)) => Ok(serde_json::json!({
            "state": "WITHDRAWN",
            "withdrawal": withdrawal,
        })),
        (state, _, _) => Err(corrupt(
            "overtime order state",
            format!("{state} does not match its consent and withdrawal columns"),
        )),
    }
}

/// The inverse of [`build_state`].
fn split_state(
    state: &OvertimeState,
) -> Result<(&'static str, Option<serde_json::Value>, Option<serde_json::Value>), AppError> {
    Ok(match state {
        OvertimeState::AwaitingConsent => ("AWAITING_CONSENT", None, None),
        OvertimeState::Agreed { consent } => (
            "AGREED",
            Some(serde_json::to_value(consent.authorization())?),
            None,
        ),
        OvertimeState::Declined { consent } => (
            "DECLINED",
            Some(serde_json::to_value(consent.authorization())?),
            None,
        ),
        OvertimeState::Withdrawn { withdrawal } => {
            ("WITHDRAWN", None, Some(serde_json::to_value(withdrawal)?))
        }
    })
}

fn decode(row: &sqlx::postgres::PgRow) -> Result<OvertimeRecord, AppError> {
    let planned: i32 = row.try_get("planned_minutes")?;
    let state: String = row.try_get("state")?;
    let wire = serde_json::json!({
        // The column names and the wire names differ, and the rename is here
        // rather than in the type: a column called `employee` would read as the
        // person rather than as the key.
        "id": row.try_get::<String, _>("id")?,
        "employee": row.try_get::<String, _>("employee_id")?,
        "place": row.try_get::<String, _>("place_id")?,
        "date": row.try_get::<NaiveDate, _>("on_date")?,
        "day_kind": row.try_get::<String, _>("day_kind")?,
        "planned": u32::try_from(planned)
            .map_err(|_| corrupt("planned minutes", format!("{planned} is negative")))?,
        "ordered": row.try_get::<serde_json::Value, _>("ordered")?,
        "state": build_state(
            &state,
            row.try_get("consent")?,
            row.try_get("withdrawal")?,
        )?,
    });

    let wire: OvertimeOrderWire =
        serde_json::from_value(wire).map_err(|error| corrupt("overtime order", error.to_string()))?;
    Ok(OvertimeRecord {
        // Both authority gates again. This is the line that keeps a
        // supervisor's key from becoming the worker's answer by way of the
        // database.
        order: OvertimeOrder::try_new(wire)
            .map_err(|error| corrupt("overtime order", error.to_string()))?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub async fn load_overtime_order(
    pool: &PgPool,
    id: &str,
) -> Result<Option<OvertimeRecord>, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {ORDER_COLUMNS} FROM overtime_order WHERE id = $1"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.as_ref().map(decode).transpose()
}

/// One person's orders, newest first.
pub async fn overtime_orders_of(
    pool: &PgPool,
    employee_id: &str,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
) -> Result<Vec<OvertimeRecord>, AppError> {
    // The window is inclusive at both ends, because a caller asking for one day
    // passes the same date twice and expects that day's orders back.
    let rows = sqlx::query(&format!(
        "SELECT {ORDER_COLUMNS} FROM overtime_order
          WHERE employee_id = $1
            AND ($2::date IS NULL OR on_date >= $2)
            AND ($3::date IS NULL OR on_date <= $3)
          ORDER BY on_date DESC, id"
    ))
    .bind(employee_id)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;
    rows.iter().map(decode).collect()
}

/// The week an order falls in, for the cap.
async fn week_around(
    pool: &PgPool,
    employee_id: &str,
    date: NaiveDate,
) -> Result<Vec<OvertimeOrder>, AppError> {
    let (monday, sunday) = week_of(date);
    Ok(
        overtime_orders_of(pool, employee_id, Some(monday), Some(sunday))
            .await?
            .into_iter()
            .map(|record| record.order)
            .collect(),
    )
}

/// The orders still waiting on an answer, bounded to a place.
///
/// `None` reads every place, which is head office's. The partial index in 0103
/// is exactly this query.
pub async fn awaiting_consent(
    pool: &PgPool,
    place_id: Option<&str>,
) -> Result<Vec<OvertimeRecord>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {ORDER_COLUMNS} FROM overtime_order
          WHERE state = 'AWAITING_CONSENT'
            AND ($1::text IS NULL OR place_id = $1)
          ORDER BY on_date, id"
    ))
    .bind(place_id)
    .fetch_all(pool)
    .await?;
    rows.iter().map(decode).collect()
}

/// Issue an order, having checked the week it lands in.
///
/// The weekly check runs against the employee's other orders in the same
/// Monday–Sunday window, because only storage knows what else is in the week.
/// The order is admitted before it is inserted, so a refusal leaves nothing
/// behind.
pub async fn issue_overtime_order(
    pool: &PgPool,
    order: &OvertimeOrder,
    policy: &OvertimePolicy,
) -> Result<(), AppError> {
    let week = week_around(pool, order.employee().as_str(), order.date()).await?;
    order
        .check_weekly_limit(&week, policy)
        .map_err(overtime_error)?;

    let (state, consent, withdrawal) = split_state(order.state())?;
    let inserted = sqlx::query(
        "INSERT INTO overtime_order
             (id, employee_id, place_id, on_date, day_kind, planned_minutes,
              ordered, state, consent, withdrawal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(order.id().as_str())
    .bind(order.employee().as_str())
    .bind(order.place().as_str())
    .bind(order.date())
    .bind(order.day_kind().code())
    .bind(i32::try_from(order.planned().get()).unwrap_or(i32::MAX))
    .bind(serde_json::to_value(order.ordered())?)
    .bind(state)
    .bind(&consent)
    .bind(&withdrawal)
    .execute(pool)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "an overtime order {} already exists",
            order.id()
        )));
    }
    Ok(())
}

/// Record an answer, or a withdrawal.
///
/// Only the answer columns and `updated_at` move: what was ordered, by whom, for
/// whom, on which day and for how many minutes are write-once. A re-sync cannot
/// change the instruction, only what became of it. The `state =
/// 'AWAITING_CONSENT'` guard makes the update a no-op against a row somebody
/// else answered first, which the caller reads back as a conflict.
pub async fn answer_overtime_order(
    pool: &PgPool,
    order: &OvertimeOrder,
) -> Result<(), AppError> {
    let (state, consent, withdrawal) = split_state(order.state())?;
    let updated = sqlx::query(
        "UPDATE overtime_order
            SET state = $2, consent = $3, withdrawal = $4, updated_at = now()
          WHERE id = $1 AND state = 'AWAITING_CONSENT'",
    )
    .bind(order.id().as_str())
    .bind(state)
    .bind(&consent)
    .bind(&withdrawal)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "overtime order {} is no longer awaiting an answer",
            order.id()
        )));
    }
    Ok(())
}

/// What one person's agreed overtime totals on a date.
///
/// The read anything downstream would use to pay overtime — and it counts only
/// agreed orders, because an order in any other state is not an approval.
/// Nothing consumes it yet: there is no punch source, so no day can be closed
/// against it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AgreedOvertime {
    pub employee_id: String,
    pub on_date: NaiveDate,
    pub authorized_minutes: u32,
}

pub async fn agreed_overtime_on(
    pool: &PgPool,
    employee: &EmployeeId,
    date: NaiveDate,
    place: &PlaceId,
) -> Result<AgreedOvertime, AppError> {
    let orders = overtime_orders_of(pool, employee.as_str(), Some(date), Some(date)).await?;
    let authorized = orders
        .into_iter()
        .filter(|record| record.order.place() == place)
        .filter_map(|record| record.order.authorized_minutes())
        .fold(0_u32, |total, minutes| total.saturating_add(minutes.get()));
    Ok(AgreedOvertime {
        employee_id: employee.to_string(),
        on_date: date,
        authorized_minutes: authorized,
    })
}

/// Which day kind an order should carry, as far as the calendar can say.
///
/// A holiday is a fact the calendar holds; a rest day is a fact the roster
/// holds, and there is no roster. So this answers `Holiday` or `None` — never
/// `Working`, because "not a holiday" is not the same as "a working day" for
/// somebody whose rest day it is, and guessing would put the wrong statutory
/// table on the row.
pub async fn day_kind_hint(
    pool: &PgPool,
    date: NaiveDate,
    place: &PlaceId,
) -> Result<Option<DayKind>, AppError> {
    use chrono::Datelike;
    let Some(calendar) = super::load_calendar(pool, date.year()).await? else {
        return Ok(None);
    };
    Ok(calendar.on(date, place).map(|_| DayKind::Holiday))
}

/// The id an order carries, for a caller that has only the string.
pub fn overtime_id(raw: &str) -> Result<OvertimeId, AppError> {
    OvertimeId::try_new(raw).map_err(overtime_error)
}
