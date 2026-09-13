//! Pay agreements, payroll identity, and payroll runs, as rows.
//!
//! # A slip copies what it was computed from
//!
//! `payroll_slip` carries the base and the allowances rather than joining to
//! `employee_pay` at read time. That is the whole point of the table: a raise
//! next month must not change what this month's slip says, and a join would
//! make every slip re-derive itself from whatever the agreement says today.
//!
//! # A run refuses to be built over an open month
//!
//! The attendance period is the payroll gate. `attendance_period` is asked
//! before a run is created, and an open month is a conflict — the facts are
//! still moving.
//!
//! # The handover to Finance is written once and never doubled
//!
//! `payroll_handover` is keyed by the run and unique per (place, period), so
//! the two ways of reaching it agree: sending the same month twice inserts
//! nothing and is told so. Settling it is a **guarded update** — `WHERE state =
//! 'RECEIVED'` — so two people pressing at once produce one payment and the
//! second is told the money has already gone out. The unguarded form, which
//! pre-checks and then updates by id, has a window between the two; the cash
//! count's form does not, and this follows the cash count's.

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    AllowanceCode, AttendanceMonth, Authorization, BankAccount, FixedAllowance, HandoverState,
    IdentityAmendment, PayError, PayRecord, PayTimeline, PayrollHandover, PayrollHandoverLine,
    PayrollHandoverWire, PayrollIdentity, PayrollRun, PayrollRunWire, PlaceId, RunEvent, RunState,
};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use pricing_engine::Money;
use serde::Serialize;
use sqlx::{PgPool, Postgres, Row, Transaction};

fn corrupt(what: &str, detail: String) -> AppError {
    AppError::Configuration(format!(
        "stored {what} does not hydrate: {detail}. The rows disagree with the rules they encode."
    ))
}

/// Turn a domain refusal into the right HTTP answer.
pub fn pay_error(error: PayError) -> AppError {
    if error.is_forbidden() {
        AppError::Forbidden(error.to_string())
    } else if error.is_conflict() {
        AppError::Conflict(error.to_string())
    } else {
        AppError::Validation(error.to_string())
    }
}

// ── the pay agreement ────────────────────────────────────────────────────

fn decode_allowances(value: serde_json::Value) -> Result<Vec<FixedAllowance>, AppError> {
    serde_json::from_value(value).map_err(|error| corrupt("fixed allowances", error.to_string()))
}

/// One person's pay, over time.
pub async fn pay_timeline(pool: &PgPool, employee_id: &str) -> Result<PayTimeline, AppError> {
    let rows = sqlx::query(
        "SELECT effective_from, base_minor, fixed_allowances, authorized
           FROM employee_pay WHERE employee_id = $1 ORDER BY effective_from",
    )
    .bind(employee_id)
    .fetch_all(pool)
    .await?;

    let mut timeline = PayTimeline::new();
    for row in &rows {
        let record = PayRecord::try_new(
            row.try_get::<NaiveDate, _>("effective_from")?,
            Money::new(row.try_get::<i64, _>("base_minor")?),
            decode_allowances(row.try_get("fixed_allowances")?)?,
            serde_json::from_value::<Authorization>(row.try_get("authorized")?)
                .map_err(|error| corrupt("pay authority", error.to_string()))?,
        )
        .map_err(|error| corrupt("pay record", error.to_string()))?;
        timeline
            .append(record)
            .map_err(|error| corrupt("pay timeline", error.to_string()))?;
    }
    Ok(timeline)
}

/// File a new agreement.
///
/// The primary key is what refuses two records on one day; the domain refuses
/// backdating before we get here.
pub async fn agree_pay(
    pool: &PgPool,
    employee_id: &str,
    record: &PayRecord,
) -> Result<(), AppError> {
    let allowances: Vec<FixedAllowance> = record
        .allowances()
        .map(|(code, amount)| FixedAllowance::try_new(code.clone(), amount).map_err(pay_error))
        .collect::<Result<_, AppError>>()?;
    let inserted = sqlx::query(
        "INSERT INTO employee_pay
             (employee_id, effective_from, base_minor, fixed_allowances, authorized)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (employee_id, effective_from) DO NOTHING",
    )
    .bind(employee_id)
    .bind(record.effective_from())
    .bind(record.base().minor)
    .bind(serde_json::to_value(&allowances)?)
    .bind(serde_json::to_value(record.authorization())?)
    .execute(pool)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "a pay record effective {} already exists",
            record.effective_from()
        )));
    }
    Ok(())
}

// ── payroll identity ─────────────────────────────────────────────────────

/// One person's payroll identity, replayed from its amendments.
pub async fn payroll_identity(
    pool: &PgPool,
    employee_id: &str,
) -> Result<Option<PayrollIdentity>, AppError> {
    let row = sqlx::query("SELECT amendments FROM payroll_identity WHERE employee_id = $1")
        .bind(employee_id)
        .fetch_optional(pool)
        .await?;
    let Some(row) = row else { return Ok(None) };
    let amendments: Vec<IdentityAmendment> = serde_json::from_value(row.try_get("amendments")?)
        .map_err(|error| corrupt("identity amendments", error.to_string()))?;
    PayrollIdentity::replay(amendments)
        .map(Some)
        .map_err(|error| corrupt("payroll identity", error.to_string()))
}

/// Store the identity, flattening the current values beside the amendments.
///
/// The columns are a projection of the fold, kept so a payment file is one
/// query rather than a replay per employee — and they are only ever written
/// from a folded record, exactly as `employee.status` is.
pub async fn save_payroll_identity(
    pool: &PgPool,
    employee_id: &str,
    identity: &PayrollIdentity,
) -> Result<(), AppError> {
    let account = identity.bank_account();
    sqlx::query(
        "INSERT INTO payroll_identity
             (employee_id, bank_name, bank_account, bank_holder, npwp, ptkp,
              bpjs_kesehatan, bpjs_ketenagakerjaan, amendments)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (employee_id) DO UPDATE SET
            bank_name = EXCLUDED.bank_name,
            bank_account = EXCLUDED.bank_account,
            bank_holder = EXCLUDED.bank_holder,
            npwp = EXCLUDED.npwp,
            ptkp = EXCLUDED.ptkp,
            bpjs_kesehatan = EXCLUDED.bpjs_kesehatan,
            bpjs_ketenagakerjaan = EXCLUDED.bpjs_ketenagakerjaan,
            amendments = EXCLUDED.amendments,
            updated_at = now()",
    )
    .bind(employee_id)
    .bind(account.map(BankAccount::bank))
    .bind(account.map(BankAccount::number))
    .bind(account.map(BankAccount::holder))
    .bind(identity.npwp())
    .bind(identity.ptkp().map(|ptkp| ptkp.to_string()))
    .bind(identity.bpjs_kesehatan())
    .bind(identity.bpjs_ketenagakerjaan())
    .bind(serde_json::to_value(identity.amendments())?)
    .execute(pool)
    .await?;
    Ok(())
}

// ── payroll runs ─────────────────────────────────────────────────────────

fn decode_run(row: &sqlx::postgres::PgRow) -> Result<PayrollRun, AppError> {
    let period: NaiveDate = row.try_get("period")?;
    let state: String = row.try_get("state")?;
    let history: serde_json::Value = row.try_get("history")?;
    PayrollRun::try_new(PayrollRunWire {
        id: row.try_get("id")?,
        place: PlaceId::try_new(&row.try_get::<String, _>("place_id")?)
            .map_err(|error| corrupt("place id", error.to_string()))?,
        period: format!("{:04}-{:02}", period.year(), period.month()),
        state: RunState::parse(&state).ok_or_else(|| corrupt("run state", state.clone()))?,
        complete: row.try_get("complete")?,
        incomplete_because: row.try_get("incomplete_because")?,
        history: serde_json::from_value::<Vec<RunEvent>>(history)
            .map_err(|error| corrupt("run history", error.to_string()))?,
    })
    .map_err(|error| corrupt("payroll run", error.to_string()))
}

const RUN_COLUMNS: &str =
    "id, place_id, period, state, complete, incomplete_because, history, created_at";

pub async fn load_run(pool: &PgPool, id: &str) -> Result<Option<PayrollRun>, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {RUN_COLUMNS} FROM payroll_run WHERE id = $1"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.as_ref().map(decode_run).transpose()
}

/// Every run at a place, newest first. `None` reads every place — head
/// office's.
pub async fn list_runs(pool: &PgPool, place_id: Option<&str>) -> Result<Vec<PayrollRun>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {RUN_COLUMNS} FROM payroll_run
          WHERE ($1::text IS NULL OR place_id = $1)
          ORDER BY period DESC, place_id"
    ))
    .bind(place_id)
    .fetch_all(pool)
    .await?;
    rows.iter().map(decode_run).collect()
}

/// What one person's line says.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PayrollSlipRow {
    pub run_id: String,
    pub employee_id: String,
    pub employee_code: String,
    pub full_name: Option<String>,
    pub base_minor: i64,
    pub fixed_allowances: Vec<AllowanceLine>,
    /// Base plus fixed allowances. The figure statutory rules are computed
    /// *against*; which rule multiplies it by what is not recorded here.
    pub statutory_base_minor: i64,
    /// Facts, not money. What this system actually recorded.
    pub leave_days_taken: i32,
    pub overtime_minutes: i32,
    pub rostered_days: i32,
    /// Whether the person can be paid at all — an account number that is
    /// missing fails the whole payment file, not just their line.
    pub payable: bool,
    /// The last four digits, behind dots. Never the number.
    pub bank_account_masked: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AllowanceLine {
    pub code: String,
    pub minor: i64,
}

/// Build the slips for a run from what the month actually holds.
///
/// Everything here is copied rather than joined, because a slip is what was
/// true when the run was built. The facts are the ones this system records:
/// approved leave, agreed overtime, and rostered days. Nothing statutory is
/// computed, and there is no column for it to land in.
pub async fn build_slips(
    tx: &mut Transaction<'_, Postgres>,
    run: &PayrollRun,
    first_day: NaiveDate,
) -> Result<usize, AppError> {
    let people = sqlx::query(
        "SELECT a.employee_id FROM employee_assignment a
           JOIN employee e ON e.id = a.employee_id
          WHERE a.place_id = $1 AND a.valid_to IS NULL AND e.status = 'ACTIVE'
          ORDER BY a.employee_id",
    )
    .bind(run.place().as_str())
    .fetch_all(&mut **tx)
    .await?;

    let mut written = 0;
    for row in &people {
        let employee_id: String = row.try_get("employee_id")?;

        // The agreement in force on the first of the month. Somebody with no
        // agreement gets no slip: a zero-pay line reads as "owed nothing",
        // which is a claim, and the honest answer is that there is nothing to
        // pay them from yet.
        let agreement = sqlx::query(
            "SELECT base_minor, fixed_allowances FROM employee_pay
              WHERE employee_id = $1 AND effective_from <= $2
              ORDER BY effective_from DESC LIMIT 1",
        )
        .bind(&employee_id)
        .bind(first_day)
        .fetch_optional(&mut **tx)
        .await?;
        let Some(agreement) = agreement else { continue };

        let base: i64 = agreement.try_get("base_minor")?;
        let allowances = decode_allowances(agreement.try_get("fixed_allowances")?)?;
        let statutory_base = allowances
            .iter()
            .try_fold(base, |sum, allowance| {
                sum.checked_add(allowance.amount().minor)
            })
            .ok_or_else(|| corrupt("pay total", "the agreement overflows".to_owned()))?;

        let leave_days: Option<i64> = sqlx::query_scalar(
            "SELECT sum(jsonb_array_length(chargeable)) FROM leave_request
              WHERE employee_id = $1 AND state = 'APPROVED'
                AND from_date < ($2::date + interval '1 month') AND to_date >= $2::date",
        )
        .bind(&employee_id)
        .bind(first_day)
        .fetch_one(&mut **tx)
        .await?;

        let overtime: Option<i64> = sqlx::query_scalar(
            "SELECT sum(planned_minutes) FROM overtime_order
              WHERE employee_id = $1 AND state = 'AGREED'
                AND on_date >= $2::date AND on_date < ($2::date + interval '1 month')",
        )
        .bind(&employee_id)
        .bind(first_day)
        .fetch_one(&mut **tx)
        .await?;

        let rostered: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM roster_day
              WHERE employee_id = $1
                AND on_date >= $2::date AND on_date < ($2::date + interval '1 month')",
        )
        .bind(&employee_id)
        .bind(first_day)
        .fetch_one(&mut **tx)
        .await?;

        sqlx::query(
            "INSERT INTO payroll_slip
                 (run_id, employee_id, base_minor, fixed_allowances, statutory_base_minor,
                  leave_days_taken, overtime_minutes, rostered_days)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (run_id, employee_id) DO UPDATE SET
                base_minor = EXCLUDED.base_minor,
                fixed_allowances = EXCLUDED.fixed_allowances,
                statutory_base_minor = EXCLUDED.statutory_base_minor,
                leave_days_taken = EXCLUDED.leave_days_taken,
                overtime_minutes = EXCLUDED.overtime_minutes,
                rostered_days = EXCLUDED.rostered_days",
        )
        .bind(run.id())
        .bind(&employee_id)
        .bind(base)
        .bind(serde_json::to_value(&allowances)?)
        .bind(statutory_base)
        .bind(i32::try_from(leave_days.unwrap_or(0)).unwrap_or(i32::MAX))
        .bind(i32::try_from(overtime.unwrap_or(0)).unwrap_or(i32::MAX))
        .bind(i32::try_from(rostered).unwrap_or(i32::MAX))
        .execute(&mut **tx)
        .await?;
        written += 1;
    }
    Ok(written)
}

/// Open a run and build its slips in one transaction.
///
/// Together, because a run with no slips is a run that looks built and is not,
/// and a caller that crashed between the two would leave one.
pub async fn open_run(
    pool: &PgPool,
    run: &PayrollRun,
    first_day: NaiveDate,
) -> Result<usize, AppError> {
    let mut tx = pool.begin().await?;
    let inserted = sqlx::query(
        "INSERT INTO payroll_run
             (id, place_id, period, state, complete, incomplete_because, history)
         VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb)
         ON CONFLICT (place_id, period) DO NOTHING",
    )
    .bind(run.id())
    .bind(run.place().as_str())
    .bind(first_day)
    .bind(run.state().code())
    .bind(run.complete())
    .bind(run.incomplete_because())
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "{} already has a payroll run for {}",
            run.place(),
            run.period()
        )));
    }
    let written = build_slips(&mut tx, run, first_day).await?;
    tx.commit().await?;
    Ok(written)
}

/// Record a step. Only the state and the history move.
pub async fn save_run(pool: &PgPool, run: &PayrollRun) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE payroll_run SET state = $2, history = $3, updated_at = now() WHERE id = $1",
    )
    .bind(run.id())
    .bind(run.state().code())
    .bind(serde_json::to_value(run.history())?)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn run_slips(pool: &PgPool, run_id: &str) -> Result<Vec<PayrollSlipRow>, AppError> {
    let rows = sqlx::query(
        "SELECT s.run_id, s.employee_id, e.code AS employee_code, p.full_name,
                s.base_minor, s.fixed_allowances, s.statutory_base_minor,
                s.leave_days_taken, s.overtime_minutes, s.rostered_days,
                i.bank_account
           FROM payroll_slip s
           JOIN employee e ON e.id = s.employee_id
           LEFT JOIN employee_profile p ON p.employee_id = s.employee_id
           LEFT JOIN payroll_identity i ON i.employee_id = s.employee_id
          WHERE s.run_id = $1
          ORDER BY e.code",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let account: Option<String> = row.try_get("bank_account")?;
            let allowances = decode_allowances(row.try_get("fixed_allowances")?)?;
            Ok(PayrollSlipRow {
                run_id: row.try_get("run_id")?,
                employee_id: row.try_get("employee_id")?,
                employee_code: row.try_get("employee_code")?,
                full_name: row.try_get("full_name")?,
                base_minor: row.try_get("base_minor")?,
                fixed_allowances: allowances
                    .iter()
                    .map(|allowance| AllowanceLine {
                        code: allowance.code().to_string(),
                        minor: allowance.amount().minor,
                    })
                    .collect(),
                statutory_base_minor: row.try_get("statutory_base_minor")?,
                leave_days_taken: row.try_get("leave_days_taken")?,
                overtime_minutes: row.try_get("overtime_minutes")?,
                rostered_days: row.try_get("rostered_days")?,
                payable: account.is_some(),
                // Masked here rather than in the view, so no caller can reach
                // the whole number by asking a different layer.
                bank_account_masked: account.as_deref().map(mask),
            })
        })
        .collect()
}

/// One person's own slips, across runs — the payslip route.
pub async fn slips_of(pool: &PgPool, employee_id: &str) -> Result<Vec<PayrollSlipRow>, AppError> {
    let rows = sqlx::query(
        "SELECT s.run_id, s.employee_id, e.code AS employee_code, p.full_name,
                s.base_minor, s.fixed_allowances, s.statutory_base_minor,
                s.leave_days_taken, s.overtime_minutes, s.rostered_days,
                i.bank_account, r.period
           FROM payroll_slip s
           JOIN payroll_run r ON r.id = s.run_id
           JOIN employee e ON e.id = s.employee_id
           LEFT JOIN employee_profile p ON p.employee_id = s.employee_id
           LEFT JOIN payroll_identity i ON i.employee_id = s.employee_id
          WHERE s.employee_id = $1
            -- Only what head office has actually decided. A draft is a working
            -- figure and a submitted run is a request nobody has answered;
            -- showing either to the person it is about invites them to plan
            -- around a number that is still moving.
            AND r.state = 'APPROVED'
          ORDER BY r.period DESC",
    )
    .bind(employee_id)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let account: Option<String> = row.try_get("bank_account")?;
            let allowances = decode_allowances(row.try_get("fixed_allowances")?)?;
            Ok(PayrollSlipRow {
                run_id: row.try_get("run_id")?,
                employee_id: row.try_get("employee_id")?,
                employee_code: row.try_get("employee_code")?,
                full_name: row.try_get("full_name")?,
                base_minor: row.try_get("base_minor")?,
                fixed_allowances: allowances
                    .iter()
                    .map(|allowance| AllowanceLine {
                        code: allowance.code().to_string(),
                        minor: allowance.amount().minor,
                    })
                    .collect(),
                statutory_base_minor: row.try_get("statutory_base_minor")?,
                leave_days_taken: row.try_get("leave_days_taken")?,
                overtime_minutes: row.try_get("overtime_minutes")?,
                rostered_days: row.try_get("rostered_days")?,
                payable: account.is_some(),
                bank_account_masked: account.as_deref().map(mask),
            })
        })
        .collect()
}

/// What a run adds up to, and what stands in its way.
///
/// The reconciliation the donor computes over its component engine; here it is
/// the honest subset — the totals of what is on the slips, and a count of the
/// people who cannot be paid because nobody has recorded an account for them.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RunReconciliation {
    pub slips: usize,
    pub base_total_minor: i64,
    pub statutory_base_total_minor: i64,
    pub overtime_minutes_total: i64,
    pub leave_days_total: i64,
    /// People on the run with no bank account recorded. **A blocker**: a
    /// payment file that fails at the bank fails for everybody in it.
    pub unpayable: usize,
    /// Staff at the place with no pay agreement, and therefore no slip. Not a
    /// blocker and not silence: they are simply not being paid from here yet.
    pub without_agreement: usize,
}

pub async fn reconcile(
    pool: &PgPool,
    run: &PayrollRun,
    first_day: NaiveDate,
) -> Result<RunReconciliation, AppError> {
    let slips = run_slips(pool, run.id()).await?;
    let without_agreement: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM employee_assignment a
           JOIN employee e ON e.id = a.employee_id
          WHERE a.place_id = $1 AND a.valid_to IS NULL AND e.status = 'ACTIVE'
            AND NOT EXISTS (
                SELECT 1 FROM employee_pay pay
                 WHERE pay.employee_id = a.employee_id AND pay.effective_from <= $2
            )",
    )
    .bind(run.place().as_str())
    .bind(first_day)
    .fetch_one(pool)
    .await?;

    Ok(RunReconciliation {
        slips: slips.len(),
        base_total_minor: slips.iter().map(|slip| slip.base_minor).sum(),
        statutory_base_total_minor: slips.iter().map(|slip| slip.statutory_base_minor).sum(),
        overtime_minutes_total: slips
            .iter()
            .map(|slip| i64::from(slip.overtime_minutes))
            .sum(),
        leave_days_total: slips
            .iter()
            .map(|slip| i64::from(slip.leave_days_taken))
            .sum(),
        unpayable: slips.iter().filter(|slip| !slip.payable).count(),
        without_agreement: usize::try_from(without_agreement).unwrap_or(0),
    })
}

/// The last four digits, behind dots.
fn mask(number: &str) -> String {
    let digits: Vec<char> = number.chars().collect();
    if digits.len() <= 4 {
        return "•".repeat(digits.len());
    }
    let tail: String = digits[digits.len() - 4..].iter().collect();
    format!("{}{tail}", "•".repeat(digits.len() - 4))
}

/// The month a run covers, as the period column stores it.
pub fn month_first_day(month: AttendanceMonth) -> Result<NaiveDate, AppError> {
    month
        .first_day()
        .ok_or_else(|| AppError::Validation(format!("{month} has no first day")))
}

/// The allowance code type, re-exported so a handler need not reach into the
/// domain for one name.
pub type PayAllowanceCode = AllowanceCode;

// ── the handover to Finance ──────────────────────────────────────────────

/// A run's crossing to Finance as a list needs it: the state, the figure, and
/// the two signatures.
///
/// Deliberately **without the breakdown**. A list of runs wants to know which
/// months have gone to Finance and which of those have been paid; loading every
/// employee line to answer that would be a query per row. The breakdown has its
/// own route, and this type never claims to carry it — which is the difference
/// between a summary and a lie by omission.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct HandoverStanding {
    pub run_id: String,
    /// `RECEIVED` or `PAID`.
    pub state: String,
    pub gross_minor: i64,
    pub people: i64,
    pub handed_over_by: String,
    pub handed_over_at: DateTime<Utc>,
    pub handed_over_reason: String,
    /// `null` while the money has not gone out. Absence is the state, not a
    /// missing value.
    pub settled_by: Option<String>,
    pub settled_at: Option<DateTime<Utc>>,
    pub settled_reason: Option<String>,
}

fn standing(row: &sqlx::postgres::PgRow) -> Result<HandoverStanding, AppError> {
    let handed: Authorization = serde_json::from_value(row.try_get("handed_over")?)
        .map_err(|error| corrupt("handover authority", error.to_string()))?;
    let settled: Option<Authorization> = row
        .try_get::<Option<serde_json::Value>, _>("settled")?
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| corrupt("settlement authority", error.to_string()))?;
    Ok(HandoverStanding {
        run_id: row.try_get("run_id")?,
        state: row.try_get("state")?,
        gross_minor: row.try_get("gross_minor")?,
        people: row.try_get("people")?,
        handed_over_by: handed.actor().to_string(),
        handed_over_at: handed.at(),
        handed_over_reason: handed.reason().to_string(),
        settled_by: settled.as_ref().map(|a| a.actor().to_string()),
        settled_at: settled.as_ref().map(Authorization::at),
        settled_reason: settled.as_ref().map(|a| a.reason().to_string()),
    })
}

const STANDING_COLUMNS: &str = "h.run_id, h.state, h.gross_minor, h.handed_over, h.settled,
        (SELECT count(*) FROM payroll_handover_line l WHERE l.run_id = h.run_id) AS people";

/// Where every run at a place stands with Finance, in one query.
///
/// One query for the whole list rather than one per run, and `place_id IS NULL`
/// reads every place — which only an unbounded caller ever asks for.
pub async fn handover_standings(
    pool: &PgPool,
    place_id: Option<&str>,
) -> Result<Vec<HandoverStanding>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {STANDING_COLUMNS} FROM payroll_handover h
          WHERE ($1::text IS NULL OR h.place_id = $1)
          ORDER BY h.period DESC, h.place_id"
    ))
    .bind(place_id)
    .fetch_all(pool)
    .await?;
    rows.iter().map(standing).collect()
}

/// Where one run stands with Finance.
pub async fn handover_standing(
    pool: &PgPool,
    run_id: &str,
) -> Result<Option<HandoverStanding>, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {STANDING_COLUMNS} FROM payroll_handover h WHERE h.run_id = $1"
    ))
    .bind(run_id)
    .fetch_optional(pool)
    .await?;
    row.as_ref().map(standing).transpose()
}

/// One handover, breakdown and all, re-hydrated through its own rules.
///
/// The header-agrees-with-its-lines check fires on the way in as well as on the
/// way out — which is the point of loading this through the kernel rather than
/// serving the rows. A row somebody edited in psql fails to load rather than
/// becoming a figure a payment is reconciled against.
pub async fn load_handover(
    pool: &PgPool,
    run_id: &str,
) -> Result<Option<PayrollHandover>, AppError> {
    let header = sqlx::query(
        "SELECT run_id, place_id, period, gross_minor, state, handed_over, settled
           FROM payroll_handover WHERE run_id = $1",
    )
    .bind(run_id)
    .fetch_optional(pool)
    .await?;
    let Some(header) = header else {
        return Ok(None);
    };

    let lines = sqlx::query(
        "SELECT employee_id, gross_minor FROM payroll_handover_line
          WHERE run_id = $1 ORDER BY employee_id",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;
    let lines = lines
        .iter()
        .map(|row| {
            PayrollHandoverLine::try_new(
                row.try_get::<String, _>("employee_id")?,
                row.try_get::<i64, _>("gross_minor")?,
            )
            .map_err(|error| corrupt("handover line", error.to_string()))
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    let period: NaiveDate = header.try_get("period")?;
    let state: String = header.try_get("state")?;
    PayrollHandover::try_new(PayrollHandoverWire {
        run_id: header.try_get("run_id")?,
        place: PlaceId::try_new(&header.try_get::<String, _>("place_id")?)
            .map_err(|error| corrupt("place id", error.to_string()))?,
        period: format!("{:04}-{:02}", period.year(), period.month()),
        gross_minor: header.try_get("gross_minor")?,
        state: HandoverState::parse(&state)
            .ok_or_else(|| corrupt("handover state", state.clone()))?,
        handed_over: serde_json::from_value(header.try_get("handed_over")?)
            .map_err(|error| corrupt("handover authority", error.to_string()))?,
        settled: header
            .try_get::<Option<serde_json::Value>, _>("settled")?
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| corrupt("settlement authority", error.to_string()))?,
        lines,
    })
    .map(Some)
    .map_err(|error| corrupt("payroll handover", error.to_string()))
}

/// The breakdown a run would cross with, read off its slips.
///
/// Gross is `statutory_base_minor` — base plus the standing allowances — and
/// nothing else on a slip is money. Overtime is minutes and leave is days, and
/// no rate for either exists anywhere in this estate, so neither is turned into
/// rupiah here. A slip whose figure is not positive is **refused rather than
/// skipped**: leaving somebody out of a liability quietly is worse than
/// stopping and saying which slip cannot be crossed.
pub async fn handover_lines_of(
    pool: &PgPool,
    run_id: &str,
) -> Result<Vec<PayrollHandoverLine>, AppError> {
    let rows = sqlx::query(
        "SELECT employee_id, statutory_base_minor FROM payroll_slip
          WHERE run_id = $1 ORDER BY employee_id",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            PayrollHandoverLine::try_new(
                row.try_get::<String, _>("employee_id")?,
                row.try_get::<i64, _>("statutory_base_minor")?,
            )
            .map_err(pay_error)
        })
        .collect()
}

/// Write the crossing: the header and its breakdown, together.
///
/// Together, because the deferred trigger refuses a header without lines at
/// COMMIT — and a caller that crashed between the two would have left exactly
/// the shape that trigger exists to make impossible.
///
/// `ON CONFLICT DO NOTHING` on the header is the idempotency: the primary key
/// is the run and there is a unique on (place, period), so a second send
/// inserts nothing and is told the liability is already with Finance. Sending
/// twice cannot double what the company owes.
pub async fn hand_over(pool: &PgPool, handover: &PayrollHandover) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let first_day = period_first_day(handover.period())?;
    let inserted = sqlx::query(
        "INSERT INTO payroll_handover
             (run_id, place_id, period, gross_minor, state, handed_over, settled)
         VALUES ($1, $2, $3, $4, $5, $6, NULL)
         ON CONFLICT (run_id) DO NOTHING",
    )
    .bind(handover.run_id())
    .bind(handover.place().as_str())
    .bind(first_day)
    .bind(handover.gross_minor())
    .bind(handover.state().code())
    .bind(serde_json::to_value(handover.handed_over())?)
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "{} for {} is already with Finance",
            handover.place(),
            handover.period()
        )));
    }

    for line in handover.lines() {
        sqlx::query(
            "INSERT INTO payroll_handover_line (run_id, employee_id, gross_minor)
             VALUES ($1, $2, $3)",
        )
        .bind(handover.run_id())
        .bind(line.employee_id())
        .bind(line.gross_minor())
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Record that Finance has paid it.
///
/// A **guarded** update: `WHERE state = 'RECEIVED'`, so two people pressing at
/// once produce one settlement and the second is told the money has already
/// gone out. The unguarded form — pre-check the state, then update by id — has
/// a window between the two, and this is the shape `cash_count::post_variance`
/// settled on for the same reason.
pub async fn settle_handover(pool: &PgPool, handover: &PayrollHandover) -> Result<(), AppError> {
    let updated = sqlx::query(
        "UPDATE payroll_handover
            SET state = $2, settled = $3, updated_at = now()
          WHERE run_id = $1 AND state = 'RECEIVED'",
    )
    .bind(handover.run_id())
    .bind(handover.state().code())
    .bind(
        handover
            .settled()
            .map(serde_json::to_value)
            .transpose()?
            .ok_or_else(|| {
                AppError::Validation("a settled handover carries the signature that paid it".into())
            })?,
    )
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "the liability for {} is already recorded as paid",
            handover.period()
        )));
    }
    Ok(())
}

/// `YYYY-MM` as the first of that month, which is how both period columns
/// store it.
fn period_first_day(period: &str) -> Result<NaiveDate, AppError> {
    let month = AttendanceMonth::parse(period).map_err(crate::cloud::postgres::attendance_error)?;
    month_first_day(month)
}
