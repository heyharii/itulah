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

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    AllowanceCode, AttendanceMonth, Authorization, BankAccount, FixedAllowance, IdentityAmendment,
    PayError, PayRecord, PayTimeline, PayrollIdentity, PayrollRun, PayrollRunWire, PlaceId,
    RunEvent, RunState,
};
use chrono::{Datelike, NaiveDate};
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
            -- Only what somebody has actually signed for. A draft is a working
            -- figure, and showing it to the person it is about invites them to
            -- plan around a number that is still moving.
            AND r.state IN ('APPROVED', 'SEALED')
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
