//! Leave beyond requests (0809): blocked dates, paying days out, days earned
//! back for a holiday worked, the roster's own rest days, and the team's
//! calendar.

use crate::cloud::application::AppError;
use crate::cloud::domain::Authorization;
use chrono::{Datelike, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

// ── blocked dates ───────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LeaveBlackoutView {
    pub id: String,
    pub from_date: NaiveDate,
    pub to_date: NaiveDate,
    /// `null`: every unit.
    pub unit_id: Option<String>,
    pub reason: String,
    pub defined_by: String,
    pub lifted: bool,
}

pub async fn leave_blackouts(pool: &PgPool) -> Result<Vec<LeaveBlackoutView>, AppError> {
    let rows = sqlx::query(
        "SELECT id, from_date, to_date, unit_id, reason, defined->>'actor' AS defined_by,
                lifted_at IS NOT NULL AS lifted
           FROM leave_blackout
          ORDER BY lifted_at IS NOT NULL, from_date DESC",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(LeaveBlackoutView {
                id: row.try_get("id")?,
                from_date: row.try_get("from_date")?,
                to_date: row.try_get("to_date")?,
                unit_id: row.try_get("unit_id")?,
                reason: row.try_get("reason")?,
                defined_by: row
                    .try_get::<Option<String>, _>("defined_by")?
                    .unwrap_or_default(),
                lifted: row.try_get("lifted")?,
            })
        })
        .collect()
}

pub async fn block_leave(
    pool: &PgPool,
    from_date: NaiveDate,
    to_date: NaiveDate,
    unit_id: Option<&str>,
    reason: &str,
    defined: &Authorization,
) -> Result<(), AppError> {
    if to_date < from_date {
        return Err(AppError::Validation("a block ends before it starts".into()));
    }
    if reason.trim().is_empty() {
        return Err(AppError::Validation(
            "say why these dates are closed".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO leave_blackout (id, from_date, to_date, unit_id, reason, defined)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(format!("blk-{}", Uuid::new_v4()))
    .bind(from_date)
    .bind(to_date)
    .bind(unit_id.map(str::trim).filter(|u| !u.is_empty()))
    .bind(reason.trim())
    .bind(serde_json::to_value(defined)?)
    .execute(pool)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.is_foreign_key_violation() => {
            AppError::Validation(format!("{} is not a unit", unit_id.unwrap_or_default()))
        }
        _ => AppError::from(error),
    })?;
    Ok(())
}

pub async fn lift_leave_block(
    pool: &PgPool,
    id: &str,
    lifted: &Authorization,
) -> Result<(), AppError> {
    let done = sqlx::query(
        "UPDATE leave_blackout SET lifted_at = now(), lifted = $2
          WHERE id = $1 AND lifted_at IS NULL",
    )
    .bind(id)
    .bind(serde_json::to_value(lifted)?)
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "{id} does not exist or is already lifted"
        )));
    }
    Ok(())
}

/// The first block a span of days touches at a unit, if any.
pub async fn blocking_leave(
    pool: &PgPool,
    unit_id: &str,
    days: &[NaiveDate],
) -> Result<Option<(NaiveDate, String)>, AppError> {
    if days.is_empty() {
        return Ok(None);
    }
    let row = sqlx::query(
        "SELECT d::date AS day, b.reason
           FROM unnest($2::date[]) AS d
           JOIN leave_blackout b
             ON d BETWEEN b.from_date AND b.to_date
            AND b.lifted_at IS NULL
            AND (b.unit_id IS NULL OR b.unit_id = $1)
          ORDER BY d LIMIT 1",
    )
    .bind(unit_id)
    .bind(days)
    .fetch_optional(pool)
    .await?;
    row.map(|row| Ok((row.try_get("day")?, row.try_get("reason")?)))
        .transpose()
}

// ── the roster's rest days (cuti pekerja roster) ────────────────────────────

/// The days in a span a rostered person is not scheduled to work. `None` when
/// nobody has rostered them in the span at all: then the caller's own rest
/// days stand, as they always have.
pub async fn roster_rest_days(
    pool: &PgPool,
    employee_id: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Option<Vec<NaiveDate>>, AppError> {
    let scheduled: Vec<(NaiveDate, bool)> = sqlx::query_as(
        "SELECT on_date,
                COALESCE(amendments->-1->'plan'->>'plan', planned->'plan'->>'plan') = 'SCHEDULED'
           FROM roster_day
          WHERE employee_id = $1 AND on_date BETWEEN $2 AND $3",
    )
    .bind(employee_id)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;
    if scheduled.is_empty() {
        return Ok(None);
    }
    let working: std::collections::HashSet<NaiveDate> = scheduled
        .into_iter()
        .filter_map(|(day, working)| working.then_some(day))
        .collect();
    Ok(Some(
        from.iter_days()
            .take_while(|day| *day <= to)
            .filter(|day| !working.contains(day))
            .collect(),
    ))
}

// ── paying days out ─────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LeaveEncashmentView {
    pub id: String,
    pub leave_type: String,
    pub centidays: i32,
    pub wage_minor: i64,
    pub divisor_days: i32,
    pub amount_minor: i64,
    pub unit_id: String,
    /// `YYYY-MM`: the payroll month it is paid in.
    pub period: String,
    pub encashed_by: String,
    pub reason: String,
}

pub async fn encashments_of(
    pool: &PgPool,
    employee_id: &str,
) -> Result<Vec<LeaveEncashmentView>, AppError> {
    let rows = sqlx::query(
        "SELECT id, leave_type, centidays, wage_minor, divisor_days, amount_minor, unit_id,
                period, encashed->>'actor' AS encashed_by, encashed->>'reason' AS reason
           FROM leave_encashment WHERE employee_id = $1 ORDER BY created_at DESC",
    )
    .bind(employee_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            let period: NaiveDate = row.try_get("period")?;
            Ok(LeaveEncashmentView {
                id: row.try_get("id")?,
                leave_type: row.try_get("leave_type")?,
                centidays: row.try_get("centidays")?,
                wage_minor: row.try_get("wage_minor")?,
                divisor_days: row.try_get("divisor_days")?,
                amount_minor: row.try_get("amount_minor")?,
                unit_id: row.try_get("unit_id")?,
                period: period.format("%Y-%m").to_string(),
                encashed_by: row
                    .try_get::<Option<String>, _>("encashed_by")?
                    .unwrap_or_default(),
                reason: row
                    .try_get::<Option<String>, _>("reason")?
                    .unwrap_or_default(),
            })
        })
        .collect()
}

/// Pay days out. Checked here, in one transaction with the two writes: the
/// policy allows it and the year's cap holds; the balance has the days; the
/// month's run is still a draft (or not opened). `available_centidays` is the
/// balance less what is pending, read by the caller from the ledger fold.
#[allow(clippy::too_many_arguments)]
pub async fn encash_leave(
    pool: &PgPool,
    employee_id: &str,
    unit_id: &str,
    leave_type: &str,
    centidays: i32,
    available_centidays: i32,
    period: NaiveDate,
    divisor_days: i32,
    encashed: &Authorization,
    filed: &Authorization,
) -> Result<String, AppError> {
    if centidays <= 0 {
        return Err(AppError::Validation(
            "pay out at least part of a day".into(),
        ));
    }
    if !(1..=31).contains(&divisor_days) {
        return Err(AppError::Validation(
            "a day is the month's wage over 1 to 31 days".into(),
        ));
    }
    if centidays > available_centidays {
        return Err(AppError::Conflict(format!(
            "{} days are free to pay out; {} were asked for",
            f64::from(available_centidays) / 100.0,
            f64::from(centidays) / 100.0
        )));
    }

    let mut tx = pool.begin().await?;
    let policy: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT policy FROM leave_policy WHERE effective_from <= $1
          ORDER BY effective_from DESC, version DESC LIMIT 1",
    )
    .bind(period)
    .fetch_optional(&mut *tx)
    .await?;
    let rule = policy.as_ref().and_then(|p| p.get("encashment"));
    if rule.and_then(|r| r.get("kind")).and_then(|k| k.as_str()) != Some("ALLOWED") {
        return Err(AppError::Conflict(
            "the leave policy does not allow paying days out".into(),
        ));
    }
    let cap = rule
        .and_then(|r| r.get("max_per_year"))
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    let year_start = NaiveDate::from_ymd_opt(period.year(), 1, 1)
        .ok_or_else(|| AppError::Validation("unreadable year".into()))?;
    let this_year: i64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(centidays), 0)::bigint FROM leave_encashment
          WHERE employee_id = $1 AND period >= $2 AND period < $2 + interval '1 year'",
    )
    .bind(employee_id)
    .bind(year_start)
    .fetch_one(&mut *tx)
    .await?;
    if this_year + i64::from(centidays) > cap {
        return Err(AppError::Conflict(format!(
            "the policy pays out at most {} days a year; {} already have been",
            cap as f64 / 100.0,
            this_year as f64 / 100.0
        )));
    }
    let state: Option<String> =
        sqlx::query_scalar("SELECT state FROM payroll_run WHERE unit_id = $1 AND period = $2")
            .bind(unit_id)
            .bind(period)
            .fetch_optional(&mut *tx)
            .await?;
    if state.as_deref().is_some_and(|s| s != "DRAFT") {
        return Err(AppError::Conflict(format!(
            "{}'s payroll for {} has been sent; pay it out in a later month",
            unit_id,
            period.format("%Y-%m")
        )));
    }
    let wage: Option<(i64, serde_json::Value)> = sqlx::query_as(
        "SELECT base_minor, fixed_allowances FROM employee_pay
          WHERE employee_id = $1 AND effective_from <= ($2::date + interval '1 month' - interval '1 day')
          ORDER BY effective_from DESC LIMIT 1",
    )
    .bind(employee_id)
    .bind(period)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((base, allowances)) = wage else {
        return Err(AppError::Conflict(
            "no pay agreement is in force, so a day cannot be valued".into(),
        ));
    };
    let wage = base
        + allowances
            .as_array()
            .map(|lines| {
                lines
                    .iter()
                    .filter_map(|line| line.get("minor").and_then(serde_json::Value::as_i64))
                    .sum::<i64>()
            })
            .unwrap_or(0);
    let amount = wage * i64::from(centidays) / (i64::from(divisor_days) * 100);
    if amount <= 0 {
        return Err(AppError::Validation("that comes to nothing".into()));
    }

    let entry_id = format!("enc-{}", Uuid::new_v4());
    sqlx::query(
        "INSERT INTO leave_ledger_entry (id, employee_id, leave_type, on_date, event, centidays, by_actor)
         VALUES ($1, $2, $3, $4, 'ENCASHMENT', $5, $6)",
    )
    .bind(&entry_id)
    .bind(employee_id)
    .bind(leave_type)
    .bind(period)
    .bind(centidays)
    .bind(encashed.actor().as_str())
    .execute(&mut *tx)
    .await?;
    let adjustment_id = format!("adj-{}", Uuid::new_v4());
    let inserted = sqlx::query(
        "INSERT INTO payroll_adjustment
             (id, unit_id, period, employee_id, component_code, basis, amount_minor, filed)
         VALUES ($1, $2, $3, $4, 'UANG_CUTI', 'PER_OCCASION', $5, $6)
         ON CONFLICT (unit_id, period, employee_id, component_code) DO NOTHING",
    )
    .bind(&adjustment_id)
    .bind(unit_id)
    .bind(period)
    .bind(employee_id)
    .bind(amount)
    .bind(serde_json::to_value(filed)?)
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "leave has already been paid out for {}; one payout a month",
            period.format("%Y-%m")
        )));
    }
    let id = format!("lenc-{}", Uuid::new_v4());
    sqlx::query(
        "INSERT INTO leave_encashment
             (id, employee_id, leave_type, centidays, wage_minor, divisor_days, amount_minor,
              unit_id, period, ledger_entry_id, adjustment_id, encashed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    )
    .bind(&id)
    .bind(employee_id)
    .bind(leave_type)
    .bind(centidays)
    .bind(wage)
    .bind(divisor_days)
    .bind(amount)
    .bind(unit_id)
    .bind(period)
    .bind(&entry_id)
    .bind(&adjustment_id)
    .bind(serde_json::to_value(encashed)?)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(id)
}

// ── holidays worked ─────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct HolidayWorkView {
    pub id: String,
    pub employee_id: String,
    pub employee_code: String,
    pub full_name: Option<String>,
    pub on_date: NaiveDate,
    /// `PUBLIC_HOLIDAY` or `REST_DAY`.
    pub day_kind: String,
    pub leave_type: String,
    pub centidays: i32,
    pub recorded_by: String,
    pub reason: String,
}

const HOLIDAY_WORK_SELECT: &str = "
    SELECT w.id, w.employee_id, e.code AS employee_code, p.full_name, w.on_date, w.day_kind,
           w.leave_type, w.centidays, w.recorded->>'actor' AS recorded_by,
           w.recorded->>'reason' AS reason
      FROM holiday_work w
      JOIN employee e ON e.id = w.employee_id
      LEFT JOIN employee_profile p ON p.employee_id = w.employee_id";

fn holiday_work_row(row: &sqlx::postgres::PgRow) -> Result<HolidayWorkView, AppError> {
    Ok(HolidayWorkView {
        id: row.try_get("id")?,
        employee_id: row.try_get("employee_id")?,
        employee_code: row.try_get("employee_code")?,
        full_name: row.try_get("full_name")?,
        on_date: row.try_get("on_date")?,
        day_kind: row.try_get("day_kind")?,
        leave_type: row.try_get("leave_type")?,
        centidays: row.try_get("centidays")?,
        recorded_by: row
            .try_get::<Option<String>, _>("recorded_by")?
            .unwrap_or_default(),
        reason: row
            .try_get::<Option<String>, _>("reason")?
            .unwrap_or_default(),
    })
}

/// Every holiday worked in a span, for the report.
pub async fn holiday_work_between(
    pool: &PgPool,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<HolidayWorkView>, AppError> {
    let rows = sqlx::query(&format!(
        "{HOLIDAY_WORK_SELECT} WHERE w.on_date BETWEEN $1 AND $2 ORDER BY w.on_date, e.code"
    ))
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;
    rows.iter().map(holiday_work_row).collect()
}

/// Record that somebody worked a public holiday or their rest day, and give
/// them the day back. The day must be one: on the published holiday
/// calendar, or a rest day or holiday on their roster.
pub async fn record_holiday_work(
    pool: &PgPool,
    employee_id: &str,
    on_date: NaiveDate,
    leave_type: &str,
    centidays: i32,
    recorded: &Authorization,
) -> Result<(), AppError> {
    if centidays <= 0 || centidays > 100 {
        return Err(AppError::Validation(
            "a day worked earns up to one day back".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    // Only a day they could have worked: posted somewhere on it, and not yet
    // to come. A day before they joined earned nothing.
    if on_date > Utc::now().date_naive() {
        return Err(AppError::Validation(format!(
            "{on_date} has not happened yet; record it once it is worked"
        )));
    }
    let posted: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM employee_assignment
                         WHERE employee_id = $1 AND valid_from <= $2
                           AND (valid_to IS NULL OR valid_to >= $2))",
    )
    .bind(employee_id)
    .bind(on_date)
    .fetch_one(&mut *tx)
    .await?;
    if !posted {
        return Err(AppError::Validation(format!(
            "{on_date} is outside their employment: they were not posted anywhere that day"
        )));
    }
    let holiday: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM holiday_calendar h, jsonb_array_elements(h.holidays) x
                         WHERE h.year = $1 AND (x->>'date')::date = $2)",
    )
    .bind(on_date.year())
    .bind(on_date)
    .fetch_one(&mut *tx)
    .await?;
    let planned: Option<String> = sqlx::query_scalar(
        "SELECT COALESCE(amendments->-1->'plan'->>'plan', planned->'plan'->>'plan')
           FROM roster_day WHERE employee_id = $1 AND on_date = $2",
    )
    .bind(employee_id)
    .bind(on_date)
    .fetch_optional(&mut *tx)
    .await?;
    let kind = match (holiday, planned.as_deref()) {
        (true, _) | (_, Some("PUBLIC_HOLIDAY")) => "PUBLIC_HOLIDAY",
        (_, Some("REST_DAY")) => "REST_DAY",
        _ => {
            return Err(AppError::Validation(format!(
                "{on_date} is neither a public holiday nor a rest day on their roster"
            )))
        }
    };
    let entry_id = format!("cmp-{}", Uuid::new_v4());
    sqlx::query(
        "INSERT INTO leave_ledger_entry (id, employee_id, leave_type, on_date, event, centidays, by_actor)
         VALUES ($1, $2, $3, $4, 'COMPENSATORY', $5, $6)",
    )
    .bind(&entry_id)
    .bind(employee_id)
    .bind(leave_type)
    .bind(on_date)
    .bind(centidays)
    .bind(recorded.actor().as_str())
    .execute(&mut *tx)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.is_foreign_key_violation() => {
            AppError::Validation(format!("{leave_type} is not a kind of leave"))
        }
        _ => AppError::from(error),
    })?;
    let inserted = sqlx::query(
        "INSERT INTO holiday_work
             (id, employee_id, on_date, day_kind, leave_type, centidays, ledger_entry_id, recorded)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (employee_id, on_date) DO NOTHING",
    )
    .bind(format!("hw-{}", Uuid::new_v4()))
    .bind(employee_id)
    .bind(on_date)
    .bind(kind)
    .bind(leave_type)
    .bind(centidays)
    .bind(&entry_id)
    .bind(serde_json::to_value(recorded)?)
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "{on_date} is already recorded as worked"
        )));
    }
    tx.commit().await?;
    Ok(())
}

// ── the team's calendar ─────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TeamLeaveSpan {
    pub employee_id: String,
    pub employee_code: String,
    pub full_name: Option<String>,
    pub unit_id: String,
    pub leave_type: String,
    pub leave_name: String,
    pub from_date: NaiveDate,
    pub to_date: NaiveDate,
    /// `PENDING` or `APPROVED`.
    pub state: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TeamCalendarView {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub leave: Vec<TeamLeaveSpan>,
    /// Public holidays in the span: date and name.
    pub holidays: Vec<(NaiveDate, String)>,
    /// Blocked dates in force in the span.
    pub blocked: Vec<LeaveBlackoutView>,
}

/// Who is away when, at the units given (all of them when `units` is `None`).
pub async fn team_calendar(
    pool: &PgPool,
    from: NaiveDate,
    to: NaiveDate,
    units: Option<&[String]>,
) -> Result<TeamCalendarView, AppError> {
    let leave = sqlx::query(
        "SELECT r.employee_id, e.code AS employee_code, p.full_name, r.unit_id,
                r.leave_type, t.name AS leave_name, r.from_date, r.to_date, r.state
           FROM leave_request r
           JOIN employee e ON e.id = r.employee_id
           JOIN leave_type t ON t.code = r.leave_type
           LEFT JOIN employee_profile p ON p.employee_id = r.employee_id
          WHERE r.state IN ('PENDING', 'APPROVED')
            AND r.from_date <= $2 AND r.to_date >= $1
            AND ($3::text[] IS NULL OR r.unit_id = ANY($3))
          ORDER BY r.from_date, e.code",
    )
    .bind(from)
    .bind(to)
    .bind(units)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| {
        Ok(TeamLeaveSpan {
            employee_id: row.try_get("employee_id")?,
            employee_code: row.try_get("employee_code")?,
            full_name: row.try_get("full_name")?,
            unit_id: row.try_get("unit_id")?,
            leave_type: row.try_get("leave_type")?,
            leave_name: row.try_get("leave_name")?,
            from_date: row.try_get("from_date")?,
            to_date: row.try_get("to_date")?,
            state: row.try_get("state")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;
    let holidays: Vec<(NaiveDate, String)> = sqlx::query_as(
        "SELECT (x->>'date')::date, x->>'name'
           FROM holiday_calendar h, jsonb_array_elements(h.holidays) x
          WHERE (x->>'date')::date BETWEEN $1 AND $2
          ORDER BY 1",
    )
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;
    let blocked = leave_blackouts(pool)
        .await?
        .into_iter()
        .filter(|b| !b.lifted && b.from_date <= to && b.to_date >= from)
        .filter(|b| match (units, &b.unit_id) {
            (Some(units), Some(unit)) => units.contains(unit),
            _ => true,
        })
        .collect();
    Ok(TeamCalendarView {
        from,
        to,
        leave,
        holidays,
        blocked,
    })
}
