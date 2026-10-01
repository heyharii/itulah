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

use super::{post, PostingIntent, PostingLine};
use crate::cloud::application::AppError;
use crate::cloud::domain::{
    AllowanceCode, AttendanceMonth, Authorization, BankAccount, ComponentBase, ComponentBasis,
    CountedUnit, FixedAllowance, HandoverState, IdentityAmendment, PayError, PayRecord,
    PayTimeline, PayrollHandover, PayrollHandoverLine, PayrollHandoverWire, PayrollIdentity,
    PayrollRun, PayrollRunWire, UnitId, RunEvent, RunState, SlipComputation, SlipFacts, SlipLine,
    statutory, BpjsRates, ComponentInForce, PtkpStatus, TaxMethod, TerCategory,
};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use pricing_engine::Money;
use serde::Serialize;
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

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
              bpjs_kesehatan, bpjs_ketenagakerjaan, amendments, tax_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (employee_id) DO UPDATE SET
            bank_name = EXCLUDED.bank_name,
            bank_account = EXCLUDED.bank_account,
            bank_holder = EXCLUDED.bank_holder,
            npwp = EXCLUDED.npwp,
            ptkp = EXCLUDED.ptkp,
            bpjs_kesehatan = EXCLUDED.bpjs_kesehatan,
            bpjs_ketenagakerjaan = EXCLUDED.bpjs_ketenagakerjaan,
            amendments = EXCLUDED.amendments,
            tax_method = EXCLUDED.tax_method,
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
    .bind(identity.tax_method().as_str())
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
        unit: UnitId::try_new(&row.try_get::<String, _>("unit_id")?)
            .map_err(|error| corrupt("unit id", error.to_string()))?,
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
    "id, unit_id, period, state, complete, incomplete_because, history, created_at";

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
pub async fn list_runs(pool: &PgPool, unit_id: Option<&str>) -> Result<Vec<PayrollRun>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {RUN_COLUMNS} FROM payroll_run
          WHERE ($1::text IS NULL OR unit_id = $1)
          ORDER BY period DESC, unit_id"
    ))
    .bind(unit_id)
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
    /// Every agreed minute in the month. The sum of the overtime bands on
    /// `earnings`, when anything values them — the two are computed from one
    /// query, so they cannot disagree.
    pub overtime_minutes: i32,
    pub rostered_days: i32,
    /// What was added on top of the agreement, and what came off. Two lists
    /// because a payslip has two columns, and each line carries every input it
    /// was computed from.
    pub earnings: Vec<SlipLineRow>,
    pub deductions: Vec<SlipLineRow>,
    /// What the company pays on the employee's behalf and does not take from
    /// net pay: its share of BPJS, and PPh 21 when the company bears it
    /// (`NETTO`). A third column, because it is on the slip and in no total the
    /// employee is paid from (0800).
    pub company_contributions: Vec<SlipLineRow>,
    /// The sum of `company_contributions`. `null` on a slip built before 0800.
    pub company_borne_minor: Option<i64>,
    /// Calendar days of the month this person was posted here on an agreement;
    /// base and fixed allowances are prorated by `days_paid / days_in_month`.
    /// `null` on a slip built before 0800.
    pub days_paid: Option<i32>,
    pub days_in_month: Option<i32>,
    /// Who bore PPh 21 on this slip: `GROSS`, `GROSS_UP` or `NETTO`.
    pub tax_method: Option<String>,
    /// The PTKP status applied, and the TER table it selected (`A`/`B`/`C`).
    pub ptkp: Option<String>,
    pub ter_category: Option<String>,
    /// The gross PPh 21 was levied on: cash earnings plus the company's BPJS
    /// Kesehatan, JKK and JKM (they are the employee's income for tax).
    pub taxable_gross_minor: Option<i64>,
    /// PPh 21 of the month, withheld or borne. Negative in a last month that
    /// gave back what the year over-withheld. `null` when it could not be
    /// worked out — the reason is in `components_incomplete_because`.
    pub pph21_minor: Option<i64>,
    /// The employee's own JHT + JP, deductible in the year's tax.
    pub pension_contribution_minor: Option<i64>,
    /// Head office is holding this person's pay on this run (0803): still
    /// owed, not to be paid until released.
    pub withheld: bool,
    /// True in the month the year was settled (December, or the last month of
    /// employment): PPh 21 is the year's Pasal 17 tax less what was withheld.
    pub final_tax_month: Option<bool>,
    /// Rostered working days absent in the attendance month (0807); `null` on
    /// a slip built before it.
    pub absent_days: Option<i32>,
    /// The statutory base plus every earning line. Never a guess: every figure
    /// in it is on this slip.
    pub gross_minor: i64,
    /// `null` when a deduction was not assessed — **not nought**. Nought is
    /// what a system reports after somebody has looked.
    pub deduction_total_minor: Option<i64>,
    /// `gross - deductions`, and `null` whenever anything on this slip could
    /// not be worked out.
    pub net_minor: Option<i64>,
    /// The sentence to show instead of a net. Naming the components nobody has
    /// ratified a rate for, so the screen says which decision is missing.
    pub components_incomplete_because: Option<String>,
    /// Whether the person can be paid at all — an account number that is
    /// missing fails the whole payment file, not just their line.
    pub payable: bool,
    /// The last four digits, behind dots. Never the number.
    pub bank_account_masked: Option<String>,
}

/// One computed line of a slip, with every input behind it.
///
/// The inputs travel with the amount so a line can be reproduced from itself:
/// `base_of_minor × rate_bp / 10000` for a capped share, `rate_minor × units /
/// 60` for an hour of overtime, `rate_minor × units` for a day of anything.
/// A screen that could only show the amount would be a screen that cannot
/// answer the one question somebody disputing a payslip asks.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SlipLineRow {
    /// `EARNING` or `DEDUCTION`. Amounts are positive on both; this says which
    /// way the line points.
    pub kind: String,
    pub component_code: String,
    /// As the component was called when the slip was built, copied.
    pub label: String,
    /// One of the five shapes. `PER_OCCASION` is a one-off the place filed.
    pub basis: String,
    pub base_ref: Option<String>,
    /// The figure the share was taken of — after any cap.
    pub base_of_minor: Option<i64>,
    pub rate_bp: Option<i32>,
    pub cap_minor: Option<i64>,
    pub hours_divisor: Option<i32>,
    pub multiplier_bp: Option<i32>,
    pub unit: Option<String>,
    /// Minutes for the overtime bands, days for the rest. Nought is a real
    /// count and is shown rather than hidden.
    pub units: Option<i32>,
    /// Money per hour for overtime, per day otherwise.
    pub rate_minor: Option<i64>,
    pub amount_minor: i64,
    /// Paid by the company, not taken from net pay.
    pub employer_borne: bool,
}

const SLIP_LINE_COLUMNS: &str = "l.run_id, l.employee_id, l.line_no, l.kind, l.component_code, \
     l.label, l.basis, l.base_ref, l.base_of_minor, l.rate_bp, l.cap_minor, l.hours_divisor, \
     l.multiplier_bp, l.unit, l.units, l.rate_minor, l.amount_minor, l.employer_borne";

/// `(run_id, employee_id, line)`, so one query's rows can be attached to the
/// slips they belong to without a query per slip.
fn slip_line_row(row: &sqlx::postgres::PgRow) -> Result<(String, String, SlipLineRow), AppError> {
    Ok((
        row.try_get("run_id")?,
        row.try_get("employee_id")?,
        SlipLineRow {
            kind: row.try_get("kind")?,
            component_code: row.try_get("component_code")?,
            label: row.try_get("label")?,
            basis: row.try_get("basis")?,
            base_ref: row.try_get("base_ref")?,
            base_of_minor: row.try_get("base_of_minor")?,
            rate_bp: row.try_get("rate_bp")?,
            cap_minor: row.try_get("cap_minor")?,
            hours_divisor: row.try_get("hours_divisor")?,
            multiplier_bp: row.try_get("multiplier_bp")?,
            unit: row.try_get("unit")?,
            units: row.try_get("units")?,
            rate_minor: row.try_get("rate_minor")?,
            amount_minor: row.try_get("amount_minor")?,
            employer_borne: row.try_get("employer_borne")?,
        },
    ))
}

/// The lines of a set of slips, keyed so each slip can pick out its own.
type SlipLines = Vec<(String, String, SlipLineRow)>;

/// Build one slip row, taking its lines out of the batch read beside it.
///
/// The lines are *drained* rather than copied, so a line can only ever belong
/// to one slip — a line attached twice would double a total somebody reads.
fn slip_row(
    row: &sqlx::postgres::PgRow,
    lines: &mut SlipLines,
) -> Result<PayrollSlipRow, AppError> {
    let account: Option<String> = row.try_get("bank_account")?;
    let allowances = decode_allowances(row.try_get("fixed_allowances")?)?;
    let run_id: String = row.try_get("run_id")?;
    let employee_id: String = row.try_get("employee_id")?;

    let mut earnings = Vec::new();
    let mut deductions = Vec::new();
    let mut company_contributions = Vec::new();
    let mut remaining = Vec::with_capacity(lines.len());
    for (line_run, line_employee, line) in lines.drain(..) {
        if line_run == run_id && line_employee == employee_id {
            if line.employer_borne {
                company_contributions.push(line);
            } else if line.kind == "DEDUCTION" {
                deductions.push(line);
            } else {
                earnings.push(line);
            }
        } else {
            remaining.push((line_run, line_employee, line));
        }
    }
    *lines = remaining;

    Ok(PayrollSlipRow {
        run_id,
        employee_id,
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
        earnings,
        deductions,
        company_contributions,
        company_borne_minor: row.try_get("company_borne_minor")?,
        days_paid: row.try_get("days_paid")?,
        days_in_month: row.try_get("days_in_month")?,
        tax_method: row.try_get("tax_method")?,
        ptkp: row.try_get("ptkp")?,
        ter_category: row.try_get("ter_category")?,
        taxable_gross_minor: row.try_get("taxable_gross_minor")?,
        pph21_minor: row.try_get("pph21_minor")?,
        pension_contribution_minor: row.try_get("pension_contribution_minor")?,
        final_tax_month: row.try_get("final_tax_month")?,
        absent_days: row.try_get("absent_days")?,
        withheld: row.try_get("withheld")?,
        gross_minor: row.try_get("gross_minor")?,
        deduction_total_minor: row.try_get("deduction_total_minor")?,
        net_minor: row.try_get("net_minor")?,
        components_incomplete_because: row.try_get("components_incomplete_because")?,
        payable: account.is_some(),
        // Masked here rather than in the view, so no caller can reach the whole
        // number by asking a different layer.
        bank_account_masked: account.as_deref().map(mask),
    })
}

const SLIP_COLUMNS: &str = "s.run_id, s.employee_id, e.code AS employee_code, p.full_name, \
     s.base_minor, s.fixed_allowances, s.statutory_base_minor, s.leave_days_taken, \
     s.overtime_minutes, s.rostered_days, s.gross_minor, s.deduction_total_minor, \
     s.net_minor, s.components_incomplete_because, i.bank_account, \
     s.days_paid, s.days_in_month, s.tax_method, s.ptkp, s.ter_category, \
     s.taxable_gross_minor, s.pph21_minor, s.pension_contribution_minor, \
     s.final_tax_month, s.company_borne_minor, s.absent_days, \
     EXISTS (SELECT 1 FROM payroll_withholding w WHERE w.run_id = s.run_id \
             AND w.employee_id = s.employee_id AND w.released_at IS NULL) AS withheld";

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AllowanceLine {
    pub code: String,
    pub minor: i64,
}

/// The month's agreed overtime, banded the way the statutory table bands it.
///
/// PP 35/2021 art. 31 pays the first hour of an ordinary working day at one
/// multiplier and the hours after it at another, and a rest day and a public
/// holiday at their own. `overtime_order.day_kind` already records which table
/// applies — it is the operator's statement, cross-checked against the holiday
/// calendar when the order was placed — so the banding is a group-by rather
/// than a derivation.
///
/// The first-hour band is per **day**, not per order: two orders on one evening
/// are one evening, and paying the first hour twice would be paying it twice.
/// So minutes are summed per day before `least(…, 60)` splits them.
///
/// What is deliberately not banded is the ladder *within* a rest day — art.
/// 31's 2× for the first eight hours, 3× for the ninth, 4× beyond. Every
/// rest-day minute lands in one band, so an operator with a single rest-day
/// multiplier understates a very long holiday shift. `0250` names the limit
/// where somebody will read it.
/// Agreed overtime minutes in the attendance month, per band and tier.
struct OvertimeBands {
    first_hour: i64,
    later: i64,
    rest_day: i64,
    holiday: i64,
    rest_day_next_hour: i64,
    rest_day_beyond: i64,
    holiday_next_hour: i64,
    holiday_beyond: i64,
}

impl OvertimeBands {
    const fn total(&self) -> i64 {
        self.first_hour + self.later + self.rest_day + self.holiday
    }
}

async fn overtime_bands(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
    unit: &UnitId,
    window: (NaiveDate, NaiveDate),
) -> Result<OvertimeBands, AppError> {
    // Per day, because a rest day's tiers are counted within the day (0808):
    // the first `tier` minutes, the next sixty, and the rest.
    let row = sqlx::query(
        "WITH agreed AS (
             SELECT on_date, day_kind, sum(planned_minutes)::bigint AS minutes
               FROM overtime_order
              WHERE employee_id = $1 AND state = 'AGREED'
                AND unit_id = $3
                AND on_date >= $2::date AND on_date < $4::date
              GROUP BY on_date, day_kind
         ), tier AS (
             SELECT COALESCE((SELECT rest_day_first_tier_minutes FROM overtime_tier_rule), 420)::bigint AS minutes
         )
         SELECT
             COALESCE(sum(CASE WHEN day_kind = 'WORKING'
                               THEN least(a.minutes, 60) ELSE 0 END), 0)::bigint AS first_hour,
             COALESCE(sum(CASE WHEN day_kind = 'WORKING'
                               THEN greatest(a.minutes - 60, 0) ELSE 0 END), 0)::bigint AS later,
             COALESCE(sum(CASE WHEN day_kind = 'REST'
                               THEN a.minutes ELSE 0 END), 0)::bigint AS rest_day,
             COALESCE(sum(CASE WHEN day_kind = 'HOLIDAY'
                               THEN a.minutes ELSE 0 END), 0)::bigint AS holiday,
             COALESCE(sum(CASE WHEN day_kind = 'REST'
                               THEN least(greatest(a.minutes - t.minutes, 0), 60) ELSE 0 END), 0)::bigint
                 AS rest_day_next_hour,
             COALESCE(sum(CASE WHEN day_kind = 'REST'
                               THEN greatest(a.minutes - t.minutes - 60, 0) ELSE 0 END), 0)::bigint
                 AS rest_day_beyond,
             COALESCE(sum(CASE WHEN day_kind = 'HOLIDAY'
                               THEN least(greatest(a.minutes - t.minutes, 0), 60) ELSE 0 END), 0)::bigint
                 AS holiday_next_hour,
             COALESCE(sum(CASE WHEN day_kind = 'HOLIDAY'
                               THEN greatest(a.minutes - t.minutes - 60, 0) ELSE 0 END), 0)::bigint
                 AS holiday_beyond
           FROM agreed a CROSS JOIN tier t",
    )
    .bind(employee_id)
    .bind(window.0)
    .bind(unit.as_str())
    .bind(window.1)
    .fetch_one(&mut **tx)
    .await?;

    Ok(OvertimeBands {
        first_hour: row.try_get("first_hour")?,
        later: row.try_get("later")?,
        rest_day: row.try_get("rest_day")?,
        holiday: row.try_get("holiday")?,
        rest_day_next_hour: row.try_get("rest_day_next_hour")?,
        rest_day_beyond: row.try_get("rest_day_beyond")?,
        holiday_next_hour: row.try_get("holiday_next_hour")?,
        holiday_beyond: row.try_get("holiday_beyond")?,
    })
}

/// Write one slip's component lines, replacing whatever was there.
///
/// Deleted and re-inserted rather than upserted: a rebuild of a draft run may
/// produce *fewer* lines than last time — a component retired, an adjustment
/// withdrawn — and an upsert would leave the old ones behind, so the slip would
/// carry a line its own totals do not include.
async fn write_slip_lines(
    tx: &mut Transaction<'_, Postgres>,
    run_id: &str,
    employee_id: &str,
    lines: &[SlipLine],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM payroll_slip_line WHERE run_id = $1 AND employee_id = $2")
        .bind(run_id)
        .bind(employee_id)
        .execute(&mut **tx)
        .await?;

    for (index, line) in lines.iter().enumerate() {
        let (rate_bp, cap, divisor, multiplier) = match line.basis() {
            Some(ComponentBasis::ShareOfBase { rate_bp, cap, .. }) => (
                i32::try_from(rate_bp).ok(),
                cap.map(|cap| cap.minor),
                None,
                None,
            ),
            Some(ComponentBasis::FractionOfBasePerUnit {
                hours_divisor,
                multiplier_bp,
                ..
            }) => (
                None,
                None,
                i32::try_from(hours_divisor).ok(),
                i32::try_from(multiplier_bp).ok(),
            ),
            // A statutory line carries the rate it was levied at (a TER rate,
            // a BPJS share) and nothing else; every other shape without a
            // basis carries none.
            _ => (
                line.statutory_rate_bp().and_then(|bp| i32::try_from(bp).ok()),
                None,
                None,
                None,
            ),
        };
        sqlx::query(
            "INSERT INTO payroll_slip_line
                 (run_id, employee_id, line_no, kind, component_code, label, basis,
                  base_ref, base_of_minor, rate_bp, cap_minor, hours_divisor,
                  multiplier_bp, unit, units, rate_minor, amount_minor, employer_borne)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                     $18)",
        )
        .bind(run_id)
        .bind(employee_id)
        .bind(i32::try_from(index + 1).unwrap_or(i32::MAX))
        .bind(line.kind().code())
        .bind(line.code().as_str())
        .bind(line.label())
        .bind(line.shape().code())
        .bind(
            line.basis()
                .and_then(|basis| basis.base())
                .map(ComponentBase::code),
        )
        .bind(line.base_of().map(|base| base.minor))
        .bind(rate_bp)
        .bind(cap)
        .bind(divisor)
        .bind(multiplier)
        .bind(line.unit().map(CountedUnit::code))
        .bind(
            line.units()
                .map(|units| i32::try_from(units).unwrap_or(i32::MAX)),
        )
        .bind(line.unit_rate().map(|rate| rate.minor))
        .bind(line.amount().minor)
        .bind(line.employer_borne())
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

// ── prorata and the statutory inputs ────────────────────────────────────────

/// A month's pay for one person at one unit, prorated by calendar days.
struct PaidMonth {
    /// Calendar days posted here with an agreement in force.
    days_paid: i64,
    days_in_month: i64,
    /// Base and fixed allowances, prorated: each agreement in force during
    /// the month contributes `amount × its days / days_in_month`.
    base: i64,
    allowances: Vec<FixedAllowance>,
    /// The full monthly wage (base plus fixed allowances) of the agreement in
    /// force on the last day paid: what BPJS is levied on. BPJS is a monthly
    /// contribution on the reported wage, not on the days worked.
    wage: i64,
    /// The full monthly base of that same agreement — what a day's absence is
    /// a share of (0807).
    monthly_base: i64,
}

/// Prorate a month by calendar days (Talenta's default).
///
/// A posting's `valid_to` is **exclusive** (`AssignmentSpan`), so somebody
/// transferred on the 15th is paid the 1st–14th by the old unit and the
/// 15th onward by the new one, and no day is paid twice. A raise that takes
/// effect on the 10th pays the old agreement for nine days and the new one for
/// the rest. A month with every day posted on one agreement is exactly that
/// agreement — the arithmetic reduces to it, no rounding.
async fn paid_month(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
    unit: &UnitId,
    first_day: NaiveDate,
    next_month: NaiveDate,
    prorate_basis: &str,
) -> Result<Option<PaidMonth>, AppError> {
    // Which days of the month a share is counted in (0814): every calendar
    // day, or the working days of a six- or five-day week less the public
    // holidays on the published calendar.
    let holidays: Vec<NaiveDate> = if prorate_basis == "CALENDAR" {
        Vec::new()
    } else {
        sqlx::query_scalar(
            "SELECT DISTINCT (x->>'date')::date
               FROM holiday_calendar h, jsonb_array_elements(h.holidays) x
              WHERE (x->>'date')::date >= $1 AND (x->>'date')::date < $2",
        )
        .bind(first_day)
        .bind(next_month)
        .fetch_all(&mut **tx)
        .await?
    };
    let counts = |day: &NaiveDate| -> bool {
        let weekday = day.weekday().num_days_from_monday();
        match prorate_basis {
            "WORKDAYS_6" => weekday < 6 && !holidays.contains(day),
            "WORKDAYS_5" => weekday < 5 && !holidays.contains(day),
            _ => true,
        }
    };
    let days: Vec<NaiveDate> = sqlx::query_scalar(
        "SELECT DISTINCT d::date AS day
           FROM employee_assignment a,
                generate_series(greatest(a.valid_from, $2::date),
                                least(COALESCE(a.valid_to, $3::date), $3::date) - 1,
                                interval '1 day') d
          WHERE a.employee_id = $1 AND a.unit_id = $4
            AND a.valid_from < $3::date
            AND (a.valid_to IS NULL OR a.valid_to > $2::date)
          ORDER BY day",
    )
    .bind(employee_id)
    .bind(first_day)
    .bind(next_month)
    .bind(unit.as_str())
    .fetch_all(&mut **tx)
    .await?;

    let agreements = sqlx::query(
        "SELECT effective_from, base_minor, fixed_allowances FROM employee_pay
          WHERE employee_id = $1 AND effective_from < $2
          ORDER BY effective_from",
    )
    .bind(employee_id)
    .bind(next_month)
    .fetch_all(&mut **tx)
    .await?;
    let mut in_force: Vec<(NaiveDate, i64, Vec<FixedAllowance>)> = Vec::new();
    for agreement in &agreements {
        in_force.push((
            agreement.try_get("effective_from")?,
            agreement.try_get("base_minor")?,
            decode_allowances(agreement.try_get("fixed_allowances")?)?,
        ));
    }

    let days_in_month = first_day
        .iter_days()
        .take_while(|day| *day < next_month)
        .filter(|day| counts(day))
        .count() as i64;
    let days: Vec<NaiveDate> = days.into_iter().filter(|day| counts(day)).collect();
    if days_in_month == 0 {
        return Ok(None);
    }
    // Days per agreement (by index), in order.
    let mut per_agreement: Vec<i64> = vec![0; in_force.len()];
    let mut last_paid: Option<usize> = None;
    for day in &days {
        if let Some(index) = in_force.iter().rposition(|(from, _, _)| from <= day) {
            per_agreement[index] += 1;
            last_paid = Some(index);
        }
    }
    let Some(last) = last_paid else {
        return Ok(None);
    };
    let days_paid: i64 = per_agreement.iter().sum();

    let prorate = |amount: i64, days: i64| -> i128 { i128::from(amount) * i128::from(days) };
    let mut base_sum: i128 = 0;
    let mut allowance_sums: Vec<(AllowanceCode, i128)> = Vec::new();
    for ((_, base, allowances), days) in in_force.iter().zip(&per_agreement) {
        if *days == 0 {
            continue;
        }
        base_sum += prorate(*base, *days);
        for allowance in allowances {
            let weighted = prorate(allowance.amount().minor, *days);
            match allowance_sums.iter_mut().find(|(code, _)| code == allowance.code()) {
                Some((_, sum)) => *sum += weighted,
                None => allowance_sums.push((allowance.code().clone(), weighted)),
            }
        }
    }
    let whole = i128::from(days_in_month);
    let base = (base_sum / whole) as i64;
    let mut allowances = Vec::with_capacity(allowance_sums.len());
    for (code, sum) in allowance_sums {
        let minor = (sum / whole) as i64;
        if minor > 0 {
            allowances.push(
                FixedAllowance::try_new(code, Money::new(minor))
                    .map_err(|error| corrupt("prorated allowance", error.to_string()))?,
            );
        }
    }
    let (_, last_base, last_allowances) = &in_force[last];
    let wage = last_allowances
        .iter()
        .fold(*last_base, |sum, allowance| sum.saturating_add(allowance.amount().minor));

    Ok(Some(PaidMonth {
        days_paid,
        days_in_month,
        base,
        allowances,
        wage,
        monthly_base: *last_base,
    }))
}

/// When the attendance month closes and when pay goes out (0801).
pub struct PayrollSchedule {
    pub effective_from: NaiveDate,
    pub cutoff_day: Option<u32>,
    pub pay_day: Option<u32>,
    /// `CALENDAR`, `WORKDAYS_6` or `WORKDAYS_5` (0814).
    pub prorate_basis: String,
}

impl PayrollSchedule {
    /// The days a month's leave, overtime and roster are counted over:
    /// `[start, end)`. With a cut-off of 20, September is 21 August to 20
    /// September inclusive.
    pub fn attendance_window(
        &self,
        first_day: NaiveDate,
        next_month: NaiveDate,
    ) -> (NaiveDate, NaiveDate) {
        match self.cutoff_day {
            None => (first_day, next_month),
            Some(day) => {
                let end = first_day.with_day(day).unwrap_or(first_day) + chrono::Days::new(1);
                let start = first_day
                    .checked_sub_months(chrono::Months::new(1))
                    .and_then(|previous| previous.with_day(day))
                    .map_or(first_day, |cut| cut + chrono::Days::new(1));
                (start, end)
            }
        }
    }

    /// The day pay goes out for the month starting `first_day`.
    pub fn pay_on(&self, first_day: NaiveDate, next_month: NaiveDate) -> NaiveDate {
        let last = next_month - chrono::Days::new(1);
        match self.pay_day {
            None => last,
            Some(day) => first_day.with_day(day).unwrap_or(last),
        }
    }
}

pub async fn schedule_in_force(
    tx: &mut Transaction<'_, Postgres>,
    first_day: NaiveDate,
) -> Result<PayrollSchedule, AppError> {
    let row = sqlx::query(
        "SELECT effective_from, cutoff_day, pay_day, prorate_basis FROM payroll_schedule
          WHERE effective_from <= $1 ORDER BY effective_from DESC LIMIT 1",
    )
    .bind(first_day)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(match row {
        Some(row) => PayrollSchedule {
            effective_from: row.try_get("effective_from")?,
            cutoff_day: row
                .try_get::<Option<i32>, _>("cutoff_day")?
                .and_then(|day| u32::try_from(day).ok()),
            pay_day: row
                .try_get::<Option<i32>, _>("pay_day")?
                .and_then(|day| u32::try_from(day).ok()),
            prorate_basis: row.try_get("prorate_basis")?,
        },
        None => PayrollSchedule {
            effective_from: first_day,
            cutoff_day: None,
            pay_day: None,
            prorate_basis: "CALENDAR".to_owned(),
        },
    })
}

/// The day somebody was (last) hired: the latest HIRE on their record.
async fn hired_on(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
) -> Result<Option<NaiveDate>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT max((event->>'effective_on')::date)
           FROM employee e, jsonb_array_elements(e.history) event
          WHERE e.id = $1 AND event->>'transition' = 'HIRE'",
    )
    .bind(employee_id)
    .fetch_one(&mut **tx)
    .await?)
}

/// The BPJS rates in force on the first of the month (0800).
async fn bpjs_rates_in_force(
    tx: &mut Transaction<'_, Postgres>,
    first_day: NaiveDate,
) -> Result<BpjsRates, AppError> {
    let row = sqlx::query(
        "SELECT kesehatan_company_bp, kesehatan_employee_bp, kesehatan_cap_minor,
                jht_company_bp, jht_employee_bp, jp_company_bp, jp_employee_bp,
                jp_cap_minor, jkk_bp, jkm_bp
           FROM statutory_rate WHERE effective_from <= $1
          ORDER BY effective_from DESC LIMIT 1",
    )
    .bind(first_day)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(row) = row else {
        // Before the earliest seeded row: the rates 0800 seeded are the best
        // statement this system has.
        return Ok(BpjsRates::default());
    };
    let bp = |column: &str| -> Result<i64, AppError> { Ok(i64::from(row.try_get::<i32, _>(column)?)) };
    Ok(BpjsRates {
        kesehatan_company_bp: bp("kesehatan_company_bp")?,
        kesehatan_employee_bp: bp("kesehatan_employee_bp")?,
        kesehatan_cap_minor: row.try_get("kesehatan_cap_minor")?,
        jht_company_bp: bp("jht_company_bp")?,
        jht_employee_bp: bp("jht_employee_bp")?,
        jp_company_bp: bp("jp_company_bp")?,
        jp_employee_bp: bp("jp_employee_bp")?,
        jp_cap_minor: row.try_get("jp_cap_minor")?,
        jkk_bp: bp("jkk_bp")?,
        jkm_bp: bp("jkm_bp")?,
    })
}

/// What PPh 21 and BPJS need to know about a person.
struct StatutoryIdentity {
    ptkp: Option<PtkpStatus>,
    method: TaxMethod,
    enrolment: statutory::Enrolment,
}

async fn statutory_identity(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
) -> Result<StatutoryIdentity, AppError> {
    let row = sqlx::query(
        "SELECT ptkp, tax_method, bpjs_kesehatan, bpjs_ketenagakerjaan
           FROM payroll_identity WHERE employee_id = $1",
    )
    .bind(employee_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(row) = row else {
        return Ok(StatutoryIdentity {
            ptkp: None,
            method: TaxMethod::Gross,
            enrolment: statutory::Enrolment::default(),
        });
    };
    let ptkp: Option<String> = row.try_get("ptkp")?;
    let method: String = row.try_get("tax_method")?;
    let enrolled = |column: &str| -> Result<bool, AppError> {
        Ok(row
            .try_get::<Option<String>, _>(column)?
            .is_some_and(|number| !number.trim().is_empty()))
    };
    Ok(StatutoryIdentity {
        ptkp: ptkp
            .as_deref()
            .map(PtkpStatus::parse)
            .transpose()
            .map_err(|error| corrupt("PTKP status", error.to_string()))?,
        method: TaxMethod::parse(&method).ok_or_else(|| corrupt("tax method", method.clone()))?,
        enrolment: statutory::Enrolment {
            kesehatan: enrolled("bpjs_kesehatan")?,
            ketenagakerjaan: enrolled("bpjs_ketenagakerjaan")?,
        },
    })
}

/// Whether this month settles the tax year for this person: December, or the
/// month their employment ends (PMK 168/2023 — *masa pajak terakhir*).
///
/// Employment ends when the person is terminated and none of their postings
/// reaches into next month. A transfer between units in the month is not an
/// end: the new posting carries on.
async fn is_final_tax_month(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
    first_day: NaiveDate,
    next_month: NaiveDate,
) -> Result<bool, AppError> {
    if first_day.month() == 12 {
        return Ok(true);
    }
    let ends_here: bool = sqlx::query_scalar(
        "SELECT e.status = 'TERMINATED'
                AND NOT EXISTS (SELECT 1 FROM employee_assignment a
                                 WHERE a.employee_id = e.id
                                   AND (a.valid_to IS NULL OR a.valid_to > $3::date))
                AND EXISTS (SELECT 1 FROM employee_assignment a
                             WHERE a.employee_id = e.id
                               AND a.valid_to > $2::date)
           FROM employee e WHERE e.id = $1",
    )
    .bind(employee_id)
    .bind(first_day)
    .bind(next_month)
    .fetch_optional(&mut **tx)
    .await?
    .unwrap_or(false);
    Ok(ends_here)
}

/// What the earlier months of this tax year came to for this person, across
/// every unit they were paid at, from the slips built since 0800.
async fn year_to_date(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
    first_day: NaiveDate,
    run_id: &str,
) -> Result<statutory::YearToDate, AppError> {
    let row = sqlx::query(
        "SELECT COALESCE(sum(s.taxable_gross_minor), 0)::bigint AS taxable,
                COALESCE(sum(s.pension_contribution_minor), 0)::bigint AS pension,
                COALESCE(sum(s.pph21_minor), 0)::bigint AS tax,
                count(DISTINCT r.period)::bigint AS months
           FROM payroll_slip s
           JOIN payroll_run r ON r.id = s.run_id
          WHERE s.employee_id = $1
            AND r.id <> $3
            AND r.period >= date_trunc('year', $2::date)::date
            AND r.period < $2::date
            AND s.taxable_gross_minor IS NOT NULL",
    )
    .bind(employee_id)
    .bind(first_day)
    .bind(run_id)
    .fetch_one(&mut **tx)
    .await?;
    Ok(statutory::YearToDate {
        taxable_gross: Money::new(row.try_get("taxable")?),
        pension_contribution: Money::new(row.try_get("pension")?),
        tax: Money::new(row.try_get("tax")?),
        months: u8::try_from(row.try_get::<i64, _>("months")?).unwrap_or(u8::MAX),
    })
}

/// The slip lines PPh 21 and BPJS produce, on the system components 0800
/// seeded. A system component somebody retired cannot carry its figure, and
/// says so rather than dropping it.
fn statutory_lines(
    catalogue: &[ComponentInForce],
    rates: &BpjsRates,
    contribution: &statutory::BpjsContribution,
    tax: Option<&statutory::MonthTax>,
    method: TaxMethod,
    thr: Option<(Money, i64, Money)>,
) -> (Vec<SlipLine>, Vec<String>) {
    let mut lines = Vec::new();
    let mut blocked = Vec::new();
    let mut push = |code: &str, amount: Money, base_of: Option<Money>, rate: Option<i64>| {
        let found = catalogue.iter().find(|in_force| {
            in_force.component.code().as_str() == code && !in_force.component.is_retired()
        });
        match found {
            Some(in_force) => lines.push(SlipLine::statutory(&in_force.component, amount, base_of, rate)),
            None => blocked.push(format!(
                "the statutory component {code} is missing or retired, so its figure was not \
                 put on the slip"
            )),
        }
    };
    // BPJS, only for the programmes the person is enrolled in.
    if contribution.kesehatan_base.minor > 0 {
        let base = Some(contribution.kesehatan_base);
        push("BPJS_KES", contribution.kesehatan_employee, base, Some(rates.kesehatan_employee_bp));
        push("BPJS_KES_CO", contribution.kesehatan_company, base, Some(rates.kesehatan_company_bp));
    }
    if contribution.jp_base.minor > 0 {
        let wage = Some(contribution.wage);
        let jp = Some(contribution.jp_base);
        push("BPJS_JHT", contribution.jht_employee, wage, Some(rates.jht_employee_bp));
        push("BPJS_JHT_CO", contribution.jht_company, wage, Some(rates.jht_company_bp));
        push("BPJS_JP", contribution.jp_employee, jp, Some(rates.jp_employee_bp));
        push("BPJS_JP_CO", contribution.jp_company, jp, Some(rates.jp_company_bp));
        push("BPJS_JKK_CO", contribution.jkk_company, wage, Some(rates.jkk_bp));
        push("BPJS_JKM_CO", contribution.jkm_company, wage, Some(rates.jkm_bp));
    }

    // THR: base_of is the month's wage and the rate is the months counted out
    // of twelve, so a slip can say "7/12 × Rp5.000.000".
    if let Some((amount, months, wage)) = thr {
        if amount.minor > 0 {
            push("THR", amount, Some(wage), Some(months * 10_000 / 12));
        }
    }

    let Some(tax) = tax else {
        return (lines, blocked);
    };
    if tax.allowance.minor > 0 {
        push("TUNJ_PPH21", tax.allowance, None, None);
    }
    if tax.tax.minor < 0 {
        // The year withheld more than it owed: the excess goes back to the
        // employee, on the slip as an earning.
        push("PPH21_RETURN", Money::new(-tax.tax.minor), Some(tax.taxable_gross), None);
    } else {
        let code = match method {
            TaxMethod::Netto => "PPH21_CO",
            TaxMethod::Gross | TaxMethod::GrossUp => "PPH21",
        };
        push(code, tax.tax, Some(tax.taxable_gross), tax.ter_rate_bp);
    }
    (lines, blocked)
}

/// Build the slips for a run from what the month actually holds.
///
/// Everything here is copied rather than joined, because a slip is what was
/// true when the run was built. The facts are the ones this system records:
/// approved leave, agreed overtime banded as the statutory table bands it, and
/// rostered days.
///
/// # What the component engine adds, and what it still refuses
///
/// The catalogue is read **once** for the whole run, and every figure on a slip
/// resolves from that catalogue plus the facts above — never from another
/// component, and never from an expression. See `domain::component`.
///
/// Nothing statutory is invented: PPh 21 is nowhere near this function, and no
/// rate is seeded anywhere. A component nobody has priced leaves
/// `deduction_total_minor` and `net_minor` NULL with a sentence naming it, so a
/// slip cannot quietly acquire a nought that reads as "nothing was owed" — the
/// guarantee `0105` held by having no columns at all.
pub async fn build_slips(
    tx: &mut Transaction<'_, Postgres>,
    run: &PayrollRun,
    first_day: NaiveDate,
) -> Result<usize, AppError> {
    // Once for the run, not once per person: the catalogue is the company's.
    let catalogue = super::components::catalogue_for_run(tx, first_day).await?;

    // Everybody whose posting overlapped this month, not only whoever is
    // posted there the moment the run is built. Somebody transferred or
    // terminated on the 20th worked here for twenty days and belongs on this
    // shop's run; somebody hired on the 18th belongs on it too. Candidates are
    // excluded because they are not working yet — "accepted" is not "started".
    let people = sqlx::query(
        "SELECT DISTINCT a.employee_id FROM employee_assignment a
           JOIN employee e ON e.id = a.employee_id
          WHERE a.unit_id = $1
            AND a.valid_from < ($2::date + interval '1 month')
            AND (a.valid_to IS NULL OR a.valid_to >= $2::date)
            AND e.status IN ('ACTIVE', 'TERMINATED')
          ORDER BY a.employee_id",
    )
    .bind(run.unit().as_str())
    .bind(first_day)
    .fetch_all(&mut **tx)
    .await?;

    let rates = bpjs_rates_in_force(tx, first_day).await?;
    let next_month = first_day
        .checked_add_months(chrono::Months::new(1))
        .ok_or_else(|| corrupt("run period", first_day.to_string()))?;
    // The attendance month the facts are counted over (0801): the calendar
    // month, or the days after last month's cut-off up to this one's.
    let schedule = schedule_in_force(tx, first_day).await?;
    let absence_rule = absence_rule_in_force(tx, first_day).await?;
    let window = schedule.attendance_window(first_day, next_month);
    let thr_on: Option<NaiveDate> =
        sqlx::query_scalar("SELECT thr_on FROM payroll_run WHERE id = $1")
            .bind(run.id())
            .fetch_optional(&mut **tx)
            .await?
            .flatten();

    let mut written = 0;
    for row in &people {
        let employee_id: String = row.try_get("employee_id")?;

        // The days this person was posted here on an agreement, and what those
        // days were worth. Somebody with no agreement on any of them gets no
        // slip: a zero-pay line reads as "owed nothing", which is a claim.
        let Some(paid) =
            paid_month(tx, &employee_id, run.unit(), first_day, next_month, &schedule.prorate_basis)
                .await?
        else {
            continue;
        };
        let base = paid.base;
        let allowances = paid.allowances.clone();
        let statutory_base = allowances
            .iter()
            .try_fold(base, |sum, allowance| {
                sum.checked_add(allowance.amount().minor)
            })
            .ok_or_else(|| corrupt("pay total", "the agreement overflows".to_owned()))?;

        // Only the days this run's own month and place are about. A leave
        // request that overlaps the boundary contributes its chargeable days
        // inside the month, not its whole stored list — and facts belonging to
        // another place never enter this shop's slip.
        // COALESCE, because an employee with no approved leave counts zero days
        // and an empty set sums to NULL — which a typed scalar cannot decode.
        let leave_days: Option<i64> = sqlx::query_scalar(
            "SELECT COALESCE(sum(days), 0)::bigint FROM (
                 SELECT count(*)::bigint AS days
                   FROM leave_request lr,
                        jsonb_array_elements_text(lr.chargeable) AS day
                  WHERE lr.employee_id = $1
                    AND lr.state = 'APPROVED'
                    AND lr.unit_id = $3
                    AND (day)::date >= $2::date
                    AND (day)::date < $4::date
             ) counted",
        )
        .bind(&employee_id)
        .bind(window.0)
        .bind(run.unit().as_str())
        .bind(window.1)
        .fetch_one(&mut **tx)
        .await?;

        // Banded, because the statutory table is banded — and the total is the
        // sum of the bands rather than a second query, so `overtime_minutes`
        // and the lines that value it cannot disagree.
        let bands = overtime_bands(tx, &employee_id, run.unit(), window).await?;
        let overtime = bands.total();

        let rostered: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM roster_day
              WHERE employee_id = $1
                AND unit_id = $3
                AND on_date >= $2::date AND on_date < $4::date",
        )
        .bind(&employee_id)
        .bind(window.0)
        .bind(run.unit().as_str())
        .bind(window.1)
        .fetch_one(&mut **tx)
        .await?;

        // Absences (0807): rostered working days already past with no punch,
        // no approved leave and no approved correction. The plan in force is
        // the last amendment, or the plan as first written.
        let absent: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM roster_day r
              WHERE r.employee_id = $1 AND r.unit_id = $3
                AND r.on_date >= $2::date AND r.on_date < $4::date
                AND r.on_date < current_date
                AND COALESCE(r.amendments->-1->'plan'->>'plan',
                             r.planned->'plan'->>'plan') = 'SCHEDULED'
                AND NOT EXISTS (SELECT 1 FROM attendance_punch p
                                 WHERE p.employee_id = r.employee_id
                                   AND p.business_date = r.on_date)
                AND NOT EXISTS (SELECT 1 FROM leave_request lr
                                 WHERE lr.employee_id = r.employee_id
                                   AND lr.state = 'APPROVED'
                                   AND r.on_date BETWEEN lr.from_date AND lr.to_date)
                AND NOT EXISTS (SELECT 1 FROM attendance_correction c
                                 WHERE c.employee_id = r.employee_id
                                   AND c.business_date = r.on_date
                                   AND c.state = 'APPROVED')",
        )
        .bind(&employee_id)
        .bind(window.0)
        .bind(run.unit().as_str())
        .bind(window.1)
        .fetch_one(&mut **tx)
        .await?;
        let absence = match &absence_rule {
            Some(rule) if rule.enabled && absent > 0 => {
                let of = if rule.basis == "WAGE" { paid.wage } else { paid.monthly_base };
                let divisor = rule.divisor_days.map_or(paid.days_in_month, i64::from).max(1);
                Some((Money::new(of * absent / divisor), Money::new(of), absent, divisor))
            }
            _ => None,
        };

        let leave_days = leave_days.unwrap_or(0);
        let facts = SlipFacts {
            base: Money::new(base),
            statutory_base: Money::new(statutory_base),
            overtime_workday_first_hour: bands.first_hour,
            overtime_workday_later: bands.later,
            overtime_rest_day: bands.rest_day,
            overtime_holiday: bands.holiday,
            overtime_rest_day_next_hour: bands.rest_day_next_hour,
            overtime_rest_day_beyond: bands.rest_day_beyond,
            overtime_holiday_next_hour: bands.holiday_next_hour,
            overtime_holiday_beyond: bands.holiday_beyond,
            rostered_days: rostered,
            leave_days_taken: leave_days,
        };
        // A loan's instalment is filed before the adjustments are read, so it
        // rides the slip the way a hand-filed kasbon recovery does (0804).
        file_loan_instalment(tx, run.unit().as_str(), first_day, &employee_id).await?;
        let adjustments =
            super::components::adjustments_for_run(tx, run.unit(), first_day, &employee_id)
                .await?;

        // Twice through the engine: once for the cash gross the tax is levied
        // on, then again with the statutory lines that gross decided.
        let cash = SlipComputation::compute(Money::new(statutory_base), &facts, &catalogue, &adjustments)
            .map_err(super::components::component_error)?;
        let identity = statutory_identity(tx, &employee_id).await?;
        let contribution = statutory::bpjs(Money::new(paid.wage), &rates, identity.enrolment);
        // THR, when this run carries it (0801): the wage of the agreement in
        // force, times the months of service to the holiday out of twelve.
        let thr = match thr_on {
            Some(holiday) => match hired_on(tx, &employee_id).await? {
                Some(hired) => statutory::thr(
                    Money::new(paid.wage),
                    statutory::service_months(hired, holiday),
                )
                .map(|(amount, months)| (amount, months, Money::new(paid.wage))),
                None => None,
            },
            None => None,
        };
        let thr_amount = thr.map_or(0, |(amount, _, _)| amount.minor);
        // An absence is pay never earned, so it comes off the taxable gross.
        let absence_amount = absence.map_or(0, |(amount, _, _, _)| amount.minor);
        let taxable = Money::new(
            cash.gross().minor + thr_amount + contribution.taxable_benefit().minor
                - absence_amount,
        );
        let final_month = is_final_tax_month(tx, &employee_id, first_day, next_month).await?;
        let tax = match identity.ptkp {
            Some(ptkp) if final_month => {
                let earlier = year_to_date(tx, &employee_id, first_day, run.id()).await?;
                Some(statutory::final_tax(
                    ptkp,
                    earlier,
                    taxable,
                    contribution.pension_contribution(),
                    identity.method,
                ))
            }
            Some(ptkp) => Some(statutory::monthly_tax(
                TerCategory::of(ptkp),
                taxable,
                identity.method,
            )),
            None => None,
        };
        let (mut lines, blocked) =
            statutory_lines(&catalogue, &rates, &contribution, tax.as_ref(), identity.method, thr);
        let mut blocked = blocked;
        if let Some((amount, of, days, divisor)) = absence {
            if amount.minor > 0 {
                match catalogue.iter().find(|in_force| {
                    in_force.component.code().as_str() == ABSENCE_DEDUCTION
                        && !in_force.component.is_retired()
                }) {
                    // base_of is the month's base (or wage) and the rate is the
                    // days absent over the divisor, in basis points, so a slip
                    // can say "2/25 × Rp5.000.000".
                    Some(in_force) => lines.push(SlipLine::statutory(
                        &in_force.component,
                        amount,
                        Some(of),
                        Some(days * 10_000 / divisor),
                    )),
                    None => blocked.push(format!(
                        "the component {ABSENCE_DEDUCTION} is missing or retired, so {days} \
                         absent days were not deducted"
                    )),
                }
            }
        }
        if identity.ptkp.is_none() {
            blocked.push(
                "no PTKP status is recorded for this person, so PPh 21 was not worked out"
                    .to_owned(),
            );
        }
        let computed = SlipComputation::compute_with(
            Money::new(statutory_base),
            &facts,
            &catalogue,
            &adjustments,
            lines,
            blocked,
        )
        .map_err(super::components::component_error)?;

        sqlx::query(
            "INSERT INTO payroll_slip
                 (run_id, employee_id, base_minor, fixed_allowances, statutory_base_minor,
                  leave_days_taken, overtime_minutes, rostered_days,
                  gross_minor, deduction_total_minor, net_minor,
                  components_incomplete_because,
                  days_paid, days_in_month, tax_method, ptkp, ter_category,
                  taxable_gross_minor, pph21_minor, pension_contribution_minor,
                  final_tax_month, company_borne_minor, absent_days)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                     $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
             ON CONFLICT (run_id, employee_id) DO UPDATE SET
                base_minor = EXCLUDED.base_minor,
                fixed_allowances = EXCLUDED.fixed_allowances,
                statutory_base_minor = EXCLUDED.statutory_base_minor,
                leave_days_taken = EXCLUDED.leave_days_taken,
                overtime_minutes = EXCLUDED.overtime_minutes,
                rostered_days = EXCLUDED.rostered_days,
                gross_minor = EXCLUDED.gross_minor,
                deduction_total_minor = EXCLUDED.deduction_total_minor,
                net_minor = EXCLUDED.net_minor,
                components_incomplete_because = EXCLUDED.components_incomplete_because,
                days_paid = EXCLUDED.days_paid,
                days_in_month = EXCLUDED.days_in_month,
                tax_method = EXCLUDED.tax_method,
                ptkp = EXCLUDED.ptkp,
                ter_category = EXCLUDED.ter_category,
                taxable_gross_minor = EXCLUDED.taxable_gross_minor,
                pph21_minor = EXCLUDED.pph21_minor,
                pension_contribution_minor = EXCLUDED.pension_contribution_minor,
                final_tax_month = EXCLUDED.final_tax_month,
                company_borne_minor = EXCLUDED.company_borne_minor,
                absent_days = EXCLUDED.absent_days",
        )
        .bind(run.id())
        .bind(&employee_id)
        .bind(base)
        .bind(serde_json::to_value(&allowances)?)
        .bind(statutory_base)
        .bind(i32::try_from(leave_days).unwrap_or(i32::MAX))
        .bind(i32::try_from(overtime).unwrap_or(i32::MAX))
        .bind(i32::try_from(rostered).unwrap_or(i32::MAX))
        .bind(computed.gross().minor)
        .bind(computed.deduction_total().map(|total| total.minor))
        .bind(computed.net().map(|net| net.minor))
        .bind(computed.incomplete_because())
        .bind(i32::try_from(paid.days_paid).unwrap_or(i32::MAX))
        .bind(i32::try_from(paid.days_in_month).unwrap_or(i32::MAX))
        .bind(identity.method.as_str())
        .bind(identity.ptkp.map(|ptkp| ptkp.to_string()))
        .bind(identity.ptkp.map(|ptkp| TerCategory::of(ptkp).as_str()))
        .bind(tax.map(|tax| tax.taxable_gross.minor))
        .bind(tax.map(|tax| tax.tax.minor))
        .bind(contribution.pension_contribution().minor)
        .bind(final_month)
        .bind(computed.company_borne().minor)
        .bind(i32::try_from(absent).unwrap_or(i32::MAX))
        .execute(&mut **tx)
        .await?;

        // After the slip, because the lines point at it.
        write_slip_lines(tx, run.id(), &employee_id, computed.lines()).await?;
        written += 1;
    }
    Ok(written)
}

/// Rebuild a draft run's slips after something the run reads has moved.
///
/// A slip is a snapshot of what was true when the run was built, which is the
/// right shape for an approved run and the wrong one for a draft: a one-off a
/// place files while the batch is still working, or a reopen that takes a
/// signed batch back to the place, changes what the month holds. Without this
/// the run would keep the earlier arithmetic and the approval would be of a
/// figure nobody recomputed.
///
/// A no-op when there is no run for `(place, period)` or it is no longer a
/// draft. The `FOR UPDATE` re-check inside the transaction is what makes a
/// concurrent submit win: if the state moved after the read, nothing is
/// rebuilt and the caller's next view shows the submitted run.
pub async fn rebuild_draft_run(
    pool: &PgPool,
    unit: &str,
    first_day: NaiveDate,
) -> Result<(), AppError> {
    let Some(run_id) = sqlx::query_scalar::<_, String>(
        "SELECT id FROM payroll_run WHERE unit_id = $1 AND period = $2",
    )
    .bind(unit)
    .bind(first_day)
    .fetch_optional(pool)
    .await?
    else {
        return Ok(());
    };
    let Some(run) = load_run(pool, &run_id).await? else {
        return Ok(());
    };

    let mut tx = pool.begin().await?;
    let state: Option<String> =
        sqlx::query_scalar("SELECT state FROM payroll_run WHERE id = $1 FOR UPDATE")
            .bind(&run_id)
            .fetch_one(&mut *tx)
            .await?;
    if state.as_deref() != Some("DRAFT") {
        return Ok(());
    }
    build_slips(&mut tx, &run, first_day).await?;
    tx.commit().await?;
    Ok(())
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
             (id, unit_id, period, state, complete, incomplete_because, history)
         VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb)
         ON CONFLICT (unit_id, period) DO NOTHING",
    )
    .bind(run.id())
    .bind(run.unit().as_str())
    .bind(first_day)
    .bind(run.state().code())
    .bind(run.complete())
    .bind(run.incomplete_because())
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "{} already has a payroll run for {}",
            run.unit(),
            run.period()
        )));
    }
    let written = build_slips(&mut tx, run, first_day).await?;
    tx.commit().await?;
    Ok(written)
}

/// Record a step. Only the state and the history move.
pub async fn save_run(pool: &PgPool, run: &PayrollRun) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    set_run_state(&mut tx, run).await?;
    tx.commit().await?;
    Ok(())
}

/// The state and the history, as every step leaves them — the part of a step
/// that makes no facts beside itself.
async fn set_run_state(
    tx: &mut Transaction<'_, Postgres>,
    run: &PayrollRun,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE payroll_run SET state = $2, history = $3, updated_at = now() WHERE id = $1",
    )
    .bind(run.id())
    .bind(run.state().code())
    .bind(serde_json::to_value(run.history())?)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Record the approval and settle what the batch's adjustments repay, in one
/// transaction.
///
/// A run is approved all-or-nothing, and its settlements are facts of the same
/// class as the decision itself — so they are made in the decision's own
/// transaction, or not at all. Before anything is inserted, every advance the
/// batch's adjustments repay is re-checked: filings sit while months move, and
/// an outstanding that was enough at filing may not be by the time head office
/// answers. One short advance refuses the whole approval, naming the advance
/// and the overshoot.
pub async fn save_approval(
    pool: &PgPool,
    run: &PayrollRun,
    approver: &str,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    set_run_state(&mut tx, run).await?;
    settle_adjusted_advances(&mut tx, run, approver).await?;
    tx.commit().await?;
    Ok(())
}

/// Record the reopen and take the settlements the run's approval made back
/// out, in one transaction.
///
/// The owner accepted that a reopen may undo an approval Finance has already
/// been handed (see `http::pay::reopen_run`); the settlement is the same class
/// of fact as the approval that made it, and it follows the same way back.
pub async fn save_reopen(pool: &PgPool, run: &PayrollRun) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    set_run_state(&mut tx, run).await?;
    sqlx::query(
        "DELETE FROM advance_settlement s
           USING payroll_adjustment a
          WHERE s.payroll_adjustment_id = a.id
            AND s.kind = 'PAYROLL'
            AND a.unit_id = $1 AND a.period = $2",
    )
    .bind(run.unit().as_str())
    .bind(period_first_day(run.period())?)
    .execute(&mut *tx)
    .await?;
    // A reopen hands the batch back to the place, and the month's facts may
    // have moved while it was signed. Rebuilding in the same transaction means
    // the draft the place sees is the month it is actually working.
    build_slips(&mut tx, run, period_first_day(run.period())?).await?;
    tx.commit().await?;
    Ok(())
}

/// The settlements the batch's adjustments repay, inserted after the
/// outstanding has been re-checked per advance.
///
/// The re-check is the filing check over again — what has come back before
/// this batch, plus what this batch repays, against what was paid out —
/// computed per advance over the batch's own sum, because two components may
/// repay one advance in one month and the refusal must see the total it would
/// make. The advances are read in `advance_number` order, so the refusal names
/// the same advance every time.
///
/// The settlement rides the adjustment (`payroll_adjustment_id`), carries no
/// entry of its own — the deduction moves inside the payout envelope and the
/// handover — and notes the run's period, which is the answer to "which month
/// took this back".
async fn settle_adjusted_advances(
    tx: &mut Transaction<'_, Postgres>,
    run: &PayrollRun,
    approver: &str,
) -> Result<(), AppError> {
    use std::collections::BTreeMap;

    // The repayments the batch makes, one row per adjustment that names an
    // advance — the settlement is per adjustment, so a reopen can take back
    // exactly what this run's approval made.
    let repayments = sqlx::query(
        "SELECT a.id, a.amount_minor, ad.advance_id
           FROM payroll_adjustment a
           JOIN advance ad ON ad.advance_id = a.advance_id
          WHERE a.unit_id = $1 AND a.period = $2 AND a.advance_id IS NOT NULL
          ORDER BY a.id",
    )
    .bind(run.unit().as_str())
    .bind(period_first_day(run.period())?)
    .fetch_all(&mut **tx)
    .await?;
    if repayments.is_empty() {
        return Ok(());
    }

    let mut batch_repays: BTreeMap<Uuid, i64> = BTreeMap::new();
    for row in &repayments {
        *batch_repays.entry(row.try_get("advance_id")?).or_insert(0) +=
            row.try_get::<i64, _>("amount_minor")?;
    }

    // The advances themselves, with everything that came back before this
    // batch — the same fold the Directory reads, computed inside this
    // transaction so it cannot move under the check.
    let advances = sqlx::query(
        "SELECT ad.advance_id, ad.advance_number, ad.amount_minor AS paid_out_minor,
                COALESCE(SUM(s.amount_minor), 0)::bigint AS settled_minor
           FROM advance ad
           LEFT JOIN advance_settlement s ON s.advance_id = ad.advance_id
          WHERE ad.advance_id IN (SELECT a.advance_id FROM payroll_adjustment a
                                   WHERE a.unit_id = $1 AND a.period = $2
                                     AND a.advance_id IS NOT NULL)
          GROUP BY ad.advance_id
          ORDER BY ad.advance_number",
    )
    .bind(run.unit().as_str())
    .bind(period_first_day(run.period())?)
    .fetch_all(&mut **tx)
    .await?;
    for row in &advances {
        let advance_id: Uuid = row.try_get("advance_id")?;
        let number: String = row.try_get("advance_number")?;
        let paid_out: i64 = row.try_get("paid_out_minor")?;
        let settled: i64 = row.try_get("settled_minor")?;
        let repays = batch_repays.get(&advance_id).copied().unwrap_or(0);
        let over = settled + repays - paid_out;
        if over > 0 {
            return Err(AppError::Conflict(format!(
                "advance {number} has {paid_out} out and {settled} back, so this batch's \
                 {repays} overshoots it by {over} — a run is approved all-or-nothing"
            )));
        }
    }

    for row in &repayments {
        sqlx::query(
            "INSERT INTO advance_settlement
                 (settlement_id, advance_id, kind, amount_minor, entry_id,
                  payroll_adjustment_id, settled_by, note)
               VALUES ($1, $2, 'PAYROLL', $3, NULL, $4, $5, $6)",
        )
        .bind(Uuid::new_v4())
        .bind(row.try_get::<Uuid, _>("advance_id")?)
        .bind(row.try_get::<i64, _>("amount_minor")?)
        .bind(row.try_get::<String, _>("id")?)
        .bind(approver)
        .bind(run.period())
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

pub async fn run_slips(pool: &PgPool, run_id: &str) -> Result<Vec<PayrollSlipRow>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {SLIP_COLUMNS}
           FROM payroll_slip s
           JOIN employee e ON e.id = s.employee_id
           LEFT JOIN employee_profile p ON p.employee_id = s.employee_id
           LEFT JOIN payroll_identity i ON i.employee_id = s.employee_id
          WHERE s.run_id = $1
          ORDER BY e.code"
    ))
    .bind(run_id)
    .fetch_all(pool)
    .await?;

    // One query for every line on the run rather than one per slip: a batch
    // screen shows a whole shop at once, and a query per person is the shape
    // that makes a payroll page slow enough that nobody checks it.
    let line_rows = sqlx::query(&format!(
        "SELECT {SLIP_LINE_COLUMNS} FROM payroll_slip_line l
          WHERE l.run_id = $1 ORDER BY l.employee_id, l.line_no"
    ))
    .bind(run_id)
    .fetch_all(pool)
    .await?;
    let mut lines: SlipLines = line_rows
        .iter()
        .map(slip_line_row)
        .collect::<Result<_, AppError>>()?;

    rows.iter().map(|row| slip_row(row, &mut lines)).collect()
}

/// One person's own slips, across runs — the payslip route.
pub async fn slips_of(pool: &PgPool, employee_id: &str) -> Result<Vec<PayrollSlipRow>, AppError> {
    // Only what head office has actually decided. A draft is a working figure
    // and a submitted run is a request nobody has answered; showing either to
    // the person it is about invites them to plan around a number that is
    // still moving.
    let rows = sqlx::query(&format!(
        "SELECT {SLIP_COLUMNS}, r.period
           FROM payroll_slip s
           JOIN payroll_run r ON r.id = s.run_id
           JOIN employee e ON e.id = s.employee_id
           LEFT JOIN employee_profile p ON p.employee_id = s.employee_id
           LEFT JOIN payroll_identity i ON i.employee_id = s.employee_id
          WHERE s.employee_id = $1 AND r.state = 'APPROVED'
          ORDER BY r.period DESC"
    ))
    .bind(employee_id)
    .fetch_all(pool)
    .await?;

    // The same state bound as above, restated on the lines. Reading them
    // without it would serve the breakdown of a draft slip to the person it is
    // about — the leak the bound exists to close, one join further down.
    let line_rows = sqlx::query(&format!(
        "SELECT {SLIP_LINE_COLUMNS} FROM payroll_slip_line l
           JOIN payroll_run r ON r.id = l.run_id
          WHERE l.employee_id = $1 AND r.state = 'APPROVED'
          ORDER BY l.run_id, l.line_no"
    ))
    .bind(employee_id)
    .fetch_all(pool)
    .await?;
    let mut lines: SlipLines = line_rows
        .iter()
        .map(slip_line_row)
        .collect::<Result<_, AppError>>()?;

    rows.iter().map(|row| slip_row(row, &mut lines)).collect()
}

/// The gross on the latest slip head office has approved for somebody.
///
/// Used by F&F when the caller leaves `final_pay_minor` out: "the last run's
/// gross" is a figure that already exists in this system, so copying it is not
/// inventing a wage. It deliberately returns `None` rather than zero when there
/// has never been an approved run — a settlement over no payroll is a decision
/// somebody has to state, not a nought to assume.
pub async fn last_approved_gross_minor(
    pool: &PgPool,
    employee_id: &str,
) -> Result<Option<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT s.gross_minor
           FROM payroll_slip s
           JOIN payroll_run r ON r.id = s.run_id
          WHERE s.employee_id = $1 AND r.state = 'APPROVED'
          ORDER BY r.period DESC, r.id DESC
          LIMIT 1",
    )
    .bind(employee_id)
    .fetch_optional(pool)
    .await?)
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
    /// Base, standing allowances, valued overtime and the one-offs the place
    /// filed. Always a real sum of what is on the slips.
    pub gross_total_minor: i64,
    /// `null` if **any** slip could not assess its deductions. Not a partial
    /// total: a figure that quietly omits the people it could not compute is
    /// worse than an absent one, because it looks like an answer.
    pub deduction_total_minor: Option<i64>,
    /// `null` if any slip has no net, for the same reason.
    pub net_total_minor: Option<i64>,
    /// Slips whose deductions or net could not be worked out, because a
    /// component in force has no ratified rate — or because nobody has defined
    /// a deduction at all. **The thing to fix before approving**, and the
    /// reason it is a count here and a sentence on each slip.
    pub slips_with_unworkable_components: usize,
    /// Slips where the deductions came to more than the month earned. Real
    /// rather than impossible — a *kasbon* instalment set too high does it —
    /// and head office should see it before approving rather than after
    /// somebody is paid a negative wage.
    pub slips_with_negative_net: usize,
    /// Lines that counted nothing: a per-day allowance for somebody nobody
    /// rostered. Not an error and not silence — the line is on the slip saying
    /// "nil days" — but worth a number on the screen, because it is usually a
    /// missing roster rather than a genuine nought.
    pub lines_that_counted_nothing: usize,
    /// People on the run with no bank account recorded. **A blocker**: a
    /// payment file that fails at the bank fails for everybody in it.
    pub unpayable: usize,
    /// Staff at the place with no pay agreement, and therefore no slip. Not a
    /// blocker and not silence: they are simply not being paid from here yet.
    pub without_agreement: usize,
    /// What the company pays on top of gross: its BPJS share and any PPh 21
    /// it bears (0800).
    pub company_borne_total_minor: i64,
    /// PPh 21 of the month across the run, withheld or borne; `null` when any
    /// slip's could not be worked out.
    pub pph21_total_minor: Option<i64>,
    /// Slips whose pay head office is holding (0803).
    pub withheld: usize,
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
          WHERE a.unit_id = $1 AND a.valid_to IS NULL AND e.status = 'ACTIVE'
            AND NOT EXISTS (
                SELECT 1 FROM employee_pay pay
                 WHERE pay.employee_id = a.employee_id
                   AND pay.effective_from < ($2::date + interval '1 month')
            )",
    )
    .bind(run.unit().as_str())
    .bind(first_day)
    .fetch_one(pool)
    .await?;

    // All-or-nothing rather than a sum over the slips that happen to have a
    // figure. `Iterator::sum` over `Option` is exactly that rule, and it is
    // the rule `CloseReadiness` follows: a total that silently leaves people
    // out looks like an answer.
    let deduction_total_minor: Option<i64> =
        slips.iter().map(|slip| slip.deduction_total_minor).sum();
    let net_total_minor: Option<i64> = slips.iter().map(|slip| slip.net_minor).sum();

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
        gross_total_minor: slips.iter().map(|slip| slip.gross_minor).sum(),
        deduction_total_minor,
        net_total_minor,
        slips_with_unworkable_components: slips
            .iter()
            .filter(|slip| slip.components_incomplete_because.is_some())
            .count(),
        slips_with_negative_net: slips
            .iter()
            .filter(|slip| slip.net_minor.is_some_and(|net| net < 0))
            .count(),
        lines_that_counted_nothing: slips
            .iter()
            .flat_map(|slip| slip.earnings.iter().chain(slip.deductions.iter()))
            .filter(|line| line.units == Some(0))
            .count(),
        unpayable: slips.iter().filter(|slip| !slip.payable).count(),
        without_agreement: usize::try_from(without_agreement).unwrap_or(0),
        company_borne_total_minor: slips
            .iter()
            .map(|slip| slip.company_borne_minor.unwrap_or(0))
            .sum(),
        pph21_total_minor: slips.iter().map(|slip| slip.pph21_minor).sum(),
        withheld: slips.iter().filter(|slip| slip.withheld).count(),
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
/// One query for the whole list rather than one per run, and `unit_id IS NULL`
/// reads every place — which only an unbounded caller ever asks for.
pub async fn handover_standings(
    pool: &PgPool,
    unit_id: Option<&str>,
) -> Result<Vec<HandoverStanding>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {STANDING_COLUMNS} FROM payroll_handover h
          WHERE ($1::text IS NULL OR h.unit_id = $1)
          ORDER BY h.period DESC, h.unit_id"
    ))
    .bind(unit_id)
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
        "SELECT run_id, unit_id, period, gross_minor, state, handed_over, settled
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
        unit: UnitId::try_new(&header.try_get::<String, _>("unit_id")?)
            .map_err(|error| corrupt("unit id", error.to_string()))?,
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
/// Gross is `payroll_slip.gross_minor`: base, the standing allowances, valued
/// overtime, and the one-off earnings the place filed. `0231` read
/// `statutory_base_minor` here and said why — *"no rate for either exists
/// anywhere in this estate"* — and `0250` lets an operator ratify the rate that
/// values a minute of overtime, so the crossing follows.
///
/// It is still **gross**. Nothing statutory is netted off, because nothing here
/// computes PPh 21 or BPJS for the authorities and a figure this backend
/// invented is a figure somebody would file with them. Crossing the *net*
/// would also cross a column that is `NULL` whenever a deduction was not
/// assessed, and a liability of unknown is not a liability Finance can book.
///
/// A slip whose figure is not positive is **refused rather than skipped**:
/// leaving somebody out of a liability quietly is worse than stopping and
/// saying which slip cannot be crossed.
pub async fn handover_lines_of(
    pool: &PgPool,
    run_id: &str,
) -> Result<Vec<PayrollHandoverLine>, AppError> {
    let rows = sqlx::query(
        "SELECT employee_id, gross_minor FROM payroll_slip
          WHERE run_id = $1 ORDER BY employee_id",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            PayrollHandoverLine::try_new(
                row.try_get::<String, _>("employee_id")?,
                row.try_get::<i64, _>("gross_minor")?,
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
             (run_id, unit_id, period, gross_minor, state, handed_over, settled)
         VALUES ($1, $2, $3, $4, $5, $6, NULL)
         ON CONFLICT (run_id) DO NOTHING",
    )
    .bind(handover.run_id())
    .bind(handover.unit().as_str())
    .bind(first_day)
    .bind(handover.gross_minor())
    .bind(handover.state().code())
    .bind(serde_json::to_value(handover.handed_over())?)
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "{} for {} is already with Finance",
            handover.unit(),
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

    // The signed handover IS the accrual. Gross, one line each way, on the day
    // the approved run reaches Finance: the wages became owed when both sides
    // agreed on them, so the source event posts the journal in this transaction.
    // The store later paying staff out of its fund debits the same payable
    // (`store_money.rs`), which is the loop closing -- before this posting
    // existed, that debit answered a credit nobody had ever written.
    //
    // The unit's payroll, in the unit's books (0605): no premises is looked
    // up on the way.
    let lines = payroll_accrual_lines(
        &mut tx,
        handover.run_id(),
        handover.unit().as_str(),
        handover.gross_minor(),
    )
    .await?;
    let intent = PostingIntent {
        posting_date: Utc::now().date_naive(),
        source_kind: "PAYROLL_RUN".into(),
        source_id: Some(handover.run_id().to_string()),
        rule_version: "payroll_run/2".into(),
        currency: "IDR".into(),
        memo: Some(format!(
            "Payroll {} {} handed to Finance",
            handover.unit(),
            handover.period()
        )),
        lines,
    };
    post(
        &mut tx,
        &intent,
        Some("ACCRUAL"),
        &handover.handed_over().actor().to_string(),
    )
    .await?;

    tx.commit().await?;
    Ok(())
}

/// The deduction an absence costs (0807). Pay never earned rather than money
/// owed to anybody: the accrual credits it back to salary expense.
pub const ABSENCE_DEDUCTION: &str = "POTONGAN_ABSEN";

/// The absence rule in force for a run's month (0807).
struct AbsenceRule {
    enabled: bool,
    basis: String,
    divisor_days: Option<i32>,
}

async fn absence_rule_in_force(
    tx: &mut Transaction<'_, Postgres>,
    first_day: NaiveDate,
) -> Result<Option<AbsenceRule>, AppError> {
    let row = sqlx::query(
        "SELECT enabled, basis, divisor_days FROM absence_deduction_rule
          WHERE effective_from <= $1 ORDER BY effective_from DESC LIMIT 1",
    )
    .bind(first_day)
    .fetch_optional(&mut **tx)
    .await?;
    row.map(|row| {
        Ok(AbsenceRule {
            enabled: row.try_get("enabled")?,
            basis: row.try_get("basis")?,
            divisor_days: row.try_get("divisor_days")?,
        })
    })
    .transpose()
}

/// The earning a last month pays back when the year over-withheld PPh 21
/// (0800). The accrual debits it to `pph21_payable` rather than an expense.
pub const RETURNED_TAX: &str = "PPH21_RETURN";

/// The accrual a payroll run posts when HR hands it to Finance.
///
/// Every earning debits its component's `payroll_expense` link and every
/// deduction credits its component's `payroll_deduction` link (0466) — the
/// component says where it lands, nothing is read off its code. Base pay, which
/// no component explains, is the company's `payroll_expense` / SALARY link, by
/// the kind of unit (6012 at a store, 6026 at head office). What the employee is
/// owed net is `payroll_payable` (2017); stage two (payment) clears it.
///
/// A deduction the company bears (`employer_borne`, PPh 21 by owner decision)
/// is the company's cost on top of gross: its expense link against its
/// deduction link, not taken from net pay. An earning paid from the accrual
/// (`paid_from_accrual`, THR) debits `thr_payable` instead of an expense. The
/// monthly THR accrual is base pay / `payroll.thr_accrual_months`, the
/// company's `payroll_expense` / THR link against `thr_payable`.
///
/// Balanced by construction: the debits are gross (plus what the company
/// bears), the credits are the deductions, net pay and what the company bears.
async fn payroll_accrual_lines(
    tx: &mut Transaction<'_, Postgres>,
    run_id: &str,
    unit_id: &str,
    handed_gross: i64,
) -> Result<Vec<PostingLine>, AppError> {
    use std::collections::BTreeMap;
    let slips = sqlx::query(
        "SELECT employee_id, base_minor, fixed_allowances, gross_minor
           FROM payroll_slip WHERE run_id = $1 ORDER BY employee_id",
    )
    .bind(run_id)
    .fetch_all(&mut **tx)
    .await?;
    let slip_lines = sqlx::query(
        "SELECT l.employee_id, l.kind, l.component_code, l.amount_minor,
                (l.employer_borne OR COALESCE(c.employer_borne, false)) AS employer_borne,
                COALESCE(c.paid_from_accrual, false) AS paid_from_accrual
           FROM payroll_slip_line l
           LEFT JOIN pay_component c ON c.code = l.component_code
          WHERE l.run_id = $1",
    )
    .bind(run_id)
    .fetch_all(&mut **tx)
    .await?;
    let accrual_months: i64 = sqlx::query_scalar(
        "SELECT COALESCE((SELECT round(value_numeric)::bigint FROM finance_setting
                           WHERE setting_key = 'payroll.thr_accrual_months'), 12)",
    )
    .fetch_one(&mut **tx)
    .await?;

    let mut earnings: BTreeMap<String, i64> = BTreeMap::new();
    let mut from_accrual = 0i64;
    let mut returned_tax = 0i64;
    let mut deductions: BTreeMap<String, i64> = BTreeMap::new();
    let mut borne: BTreeMap<String, i64> = BTreeMap::new();
    let mut base_pay = 0i64;
    let mut thr_accrual = 0i64;
    let mut gross_total = 0i64;
    for slip in &slips {
        let employee: String = slip.try_get("employee_id")?;
        let base: i64 = slip.try_get("base_minor")?;
        let gross: i64 = slip.try_get("gross_minor")?;
        gross_total += gross;
        let mut explained = 0i64;
        for allowance in decode_allowances(slip.try_get("fixed_allowances")?)? {
            let minor = allowance.amount().minor;
            *earnings.entry(allowance.code().to_string()).or_default() += minor;
            explained += minor;
        }
        for line in slip_lines
            .iter()
            .filter(|l| l.try_get::<String, _>("employee_id").ok().as_deref() == Some(&employee))
        {
            let kind: String = line.try_get("kind")?;
            let code: String = line.try_get("component_code")?;
            let amount: i64 = line.try_get("amount_minor")?;
            if kind == "DEDUCTION" {
                if line.try_get::<bool, _>("employer_borne")? {
                    *borne.entry(code).or_default() += amount;
                } else {
                    *deductions.entry(code).or_default() += amount;
                }
            } else {
                if code == RETURNED_TAX {
                    returned_tax += amount;
                } else if line.try_get::<bool, _>("paid_from_accrual")? {
                    from_accrual += amount;
                } else {
                    *earnings.entry(code).or_default() += amount;
                }
                explained += amount;
            }
        }
        // Whatever no component explains is base pay, so the debits are
        // always the slip's own gross.
        base_pay += gross - explained;
        if accrual_months > 0 {
            thr_accrual += base / accrual_months;
        }
    }
    if slips.is_empty() || gross_total != handed_gross {
        return Err(AppError::Conflict(format!(
            "the run's slips come to {gross_total} and the handover says {handed_gross}; \
             the accrual would not be the liability HR signed"
        )));
    }

    let mut lines = Vec::new();
    let signed = |amount: i64, line: PostingLine| -> Option<PostingLine> {
        (amount != 0).then_some(line)
    };
    for (code, amount) in &earnings {
        let line = if *amount > 0 {
            PostingLine::debit("payroll_expense", unit_id, *amount)
        } else {
            PostingLine::credit("payroll_expense", unit_id, -amount)
        };
        lines.extend(signed(*amount, line.from_source("PAY_COMPONENT", code)));
    }
    if base_pay > 0 {
        lines.push(PostingLine::debit("payroll_expense", unit_id, base_pay).with_qualifier("SALARY"));
    } else if base_pay < 0 {
        lines.push(PostingLine::credit("payroll_expense", unit_id, -base_pay).with_qualifier("SALARY"));
    }
    if from_accrual > 0 {
        lines.push(PostingLine::debit("thr_payable", unit_id, from_accrual));
    }
    // PPh 21 the year over-withheld and a last month gave back: it reduces
    // what is owed to the tax office rather than costing the company anything.
    if returned_tax > 0 {
        lines.push(PostingLine::debit("pph21_payable", unit_id, returned_tax));
    }
    let mut withheld = 0i64;
    for (code, amount) in &deductions {
        if *amount > 0 {
            withheld += amount;
            // An absence was never earned: it comes back off salary expense
            // rather than being owed to anybody (0807).
            let line = if code == ABSENCE_DEDUCTION {
                PostingLine::credit("payroll_expense", unit_id, *amount).with_qualifier("SALARY")
            } else {
                PostingLine::credit("payroll_deduction", unit_id, *amount)
                    .from_source("PAY_COMPONENT", code)
            };
            lines.push(line);
        }
    }
    let net = gross_total - withheld;
    if net > 0 {
        lines.push(PostingLine::credit("payroll_payable", unit_id, net));
    } else if net < 0 {
        lines.push(PostingLine::debit("payroll_payable", unit_id, -net));
    }
    if thr_accrual > 0 {
        lines.push(PostingLine::debit("payroll_expense", unit_id, thr_accrual).with_qualifier("THR"));
        lines.push(PostingLine::credit("thr_payable", unit_id, thr_accrual));
    }
    for (code, amount) in &borne {
        if *amount > 0 {
            lines.push(
                PostingLine::debit("payroll_expense", unit_id, *amount)
                    .from_source("PAY_COMPONENT", code),
            );
            lines.push(
                PostingLine::credit("payroll_deduction", unit_id, *amount)
                    .from_source("PAY_COMPONENT", code),
            );
        }
    }
    Ok(lines)
}

/// Post the accrual of a run straight from its slips, without a handover
/// document around it: the same lines `hand_over` posts. For a run whose
/// handover was recorded before the accrual existed, and for tests of the rule.
pub async fn payroll_accrual_post(
    pool: &PgPool,
    run_id: &str,
    unit_id: &str,
    actor: &str,
) -> Result<Uuid, AppError> {
    let mut tx = pool.begin().await?;
    let gross: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(gross_minor), 0)::bigint FROM payroll_slip WHERE run_id = $1",
    )
    .bind(run_id)
    .fetch_one(&mut *tx)
    .await?;
    let lines = payroll_accrual_lines(&mut tx, run_id, unit_id, gross).await?;
    let posted = post(
        &mut tx,
        &PostingIntent {
            posting_date: Utc::now().date_naive(),
            source_kind: "PAYROLL_RUN".into(),
            source_id: Some(run_id.to_string()),
            rule_version: "payroll_run/2".into(),
            currency: "IDR".into(),
            memo: Some(format!("Payroll {unit_id} accrued")),
            lines,
        },
        Some("ACCRUAL"),
        actor,
    )
    .await?;
    tx.commit().await?;
    Ok(posted.entry_id)
}

/// Record that Finance has paid it.
///
/// A **guarded** update: `WHERE state = 'RECEIVED'`, so two people pressing at
/// once produce one settlement and the second is told the money has already
/// gone out. The unguarded form — pre-check the state, then update by id — has
/// a window between the two, and this is the shape `cash_count::post_variance`
/// settled on for the same reason.
pub async fn settle_handover(
    pool: &PgPool,
    handover: &PayrollHandover,
    paid_from: Option<(&str, &str)>,
) -> Result<(), AppError> {
    let accrual_posted: bool = sqlx::query_scalar(
        "SELECT EXISTS (
             SELECT 1 FROM journal_entry
              WHERE source_kind = 'PAYROLL_RUN'
                AND source_id = $1 AND purpose IN ('ACCRUAL', 'MAIN')
         )",
    )
    .bind(handover.run_id().to_string())
    .fetch_one(pool)
    .await?;
    if !accrual_posted {
        return Err(AppError::Conflict(
            "the payroll handover has no posted accrual journal, so it cannot be settled".into(),
        ));
    }
    // Client accountant, 25 Sep (payroll stage two): head office and DC staff
    // are paid from head office's bank — Dr 2017 Biaya Gaji dan Upah YMHD /
    // Cr bank — in the same act that records the run as paid. A store's staff
    // are paid out of the store's petty cash (Dr 2017 / Cr 1003), funded by
    // head office's transfer, through the store payout tasks; recording the
    // run as settled posts nothing more for a store.
    // Which is which is the unit's kind, read from its row (0600).
    let unit_id = handover.unit().as_str();
    let unit_kind: String = sqlx::query_scalar("SELECT kind FROM unit WHERE id = $1")
        .bind(unit_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("unit {unit_id}")))?;
    let mut tx = pool.begin().await?;
    if unit_kind != "STORE" {
        let (bank_key, bank_qualifier) = paid_from.ok_or_else(|| {
            AppError::Validation(
                "a head-office payroll is paid from a bank: say which (bank_key and \
                 bank_qualifier)"
                    .into(),
            )
        })?;
        if !matches!(bank_key, "bank_giro" | "bank_savings") {
            return Err(AppError::Validation(
                "head-office wages leave a giro or a savings account".into(),
            ));
        }
        let owed: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(l.credit_minor - l.debit_minor), 0)::bigint
               FROM journal_line l
               JOIN journal_entry e ON e.entry_id = l.entry_id
              WHERE e.source_kind = 'PAYROLL_RUN' AND e.source_id = $1
                AND e.purpose IN ('ACCRUAL', 'MAIN') AND l.unit_id = $2
                AND l.account_code = (SELECT account_code FROM account_resolution
                                       WHERE role = 'payroll_payable'
                                         AND unit_id = $2 AND source_type = 'COMPANY'
                                         AND source_id = '')",
        )
        .bind(handover.run_id().to_string())
        .bind(unit_id)
        .fetch_one(&mut *tx)
        .await?;
        if owed > 0 {
            // The bank that pays is head office's, found by its kind (0605).
            let head_office = super::sites::head_office_unit_id(&mut *tx).await?;
            post(
                &mut tx,
                &PostingIntent {
                    posting_date: Utc::now().date_naive(),
                    source_kind: "PAYROLL_RUN".into(),
                    source_id: Some(handover.run_id().to_string()),
                    rule_version: "payroll_payment/1".into(),
                    currency: "IDR".into(),
                    memo: Some(format!(
                        "Payroll {} {} paid",
                        handover.unit(),
                        handover.period()
                    )),
                    lines: vec![
                        PostingLine::debit("payroll_payable", unit_id, owed),
                        PostingLine::credit(bank_key, &head_office, owed)
                            .with_qualifier(bank_qualifier),
                    ],
                },
                Some("PAYMENT"),
                &handover
                    .settled()
                    .map(|signature| signature.actor().to_string())
                    .unwrap_or_else(|| "finance".to_string()),
            )
            .await?;
        }
    }
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
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "the liability for {} is already recorded as paid",
            handover.period()
        )));
    }
    tx.commit().await?;
    Ok(())
}

/// `YYYY-MM` as the first of that month, which is how both period columns
/// store it.
fn period_first_day(period: &str) -> Result<NaiveDate, AppError> {
    let month = AttendanceMonth::parse(period).map_err(crate::cloud::postgres::attendance_error)?;
    month_first_day(month)
}

// ── run options: THR and the schedule (0801) ────────────────────────────────

/// Every payroll schedule stated, newest first, with who stated it.
pub async fn payroll_schedules(
    pool: &PgPool,
) -> Result<Vec<(PayrollSchedule, Authorization)>, AppError> {
    let rows = sqlx::query(
        "SELECT effective_from, cutoff_day, pay_day, prorate_basis, ratified FROM payroll_schedule
          ORDER BY effective_from DESC",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok((
                PayrollSchedule {
                    effective_from: row.try_get("effective_from")?,
                    cutoff_day: row
                        .try_get::<Option<i32>, _>("cutoff_day")?
                        .and_then(|day| u32::try_from(day).ok()),
                    pay_day: row
                        .try_get::<Option<i32>, _>("pay_day")?
                        .and_then(|day| u32::try_from(day).ok()),
                    prorate_basis: row.try_get("prorate_basis")?,
                },
                serde_json::from_value(row.try_get("ratified")?)
                    .map_err(|error| corrupt("schedule authority", error.to_string()))?,
            ))
        })
        .collect()
}

/// State a payroll schedule from a date — forward only, as every payroll rule.
pub async fn state_payroll_schedule(
    pool: &PgPool,
    effective_from: NaiveDate,
    cutoff_day: Option<u32>,
    pay_day: Option<u32>,
    prorate_basis: &str,
    authorization: &Authorization,
) -> Result<(), AppError> {
    if !["CALENDAR", "WORKDAYS_6", "WORKDAYS_5"].contains(&prorate_basis) {
        return Err(AppError::Validation(
            "a month is prorated by CALENDAR days, WORKDAYS_6 or WORKDAYS_5".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    sqlx::query("LOCK TABLE payroll_schedule IN SHARE ROW EXCLUSIVE MODE")
        .execute(&mut *tx)
        .await?;
    let latest: Option<NaiveDate> =
        sqlx::query_scalar("SELECT max(effective_from) FROM payroll_schedule")
            .fetch_one(&mut *tx)
            .await?;
    if let Some(latest) = latest {
        if effective_from <= latest {
            return Err(AppError::Conflict(format!(
                "a payroll schedule is already stated from {latest}; a new one takes effect after it"
            )));
        }
    }
    sqlx::query(
        "INSERT INTO payroll_schedule (effective_from, cutoff_day, pay_day, ratified, prorate_basis)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(effective_from)
    .bind(cutoff_day.and_then(|day| i32::try_from(day).ok()))
    .bind(pay_day.and_then(|day| i32::try_from(day).ok()))
    .bind(serde_json::to_value(authorization)?)
    .bind(prorate_basis)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// The THR holiday each run carries, by run id.
pub async fn run_thr_dates(
    pool: &PgPool,
) -> Result<std::collections::HashMap<String, NaiveDate>, AppError> {
    let rows: Vec<(String, NaiveDate)> =
        sqlx::query_as("SELECT id, thr_on FROM payroll_run WHERE thr_on IS NOT NULL")
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().collect())
}

/// Set (or clear) the THR holiday on a draft run, and rebuild its slips.
pub async fn set_run_thr(
    pool: &PgPool,
    run: &PayrollRun,
    first_day: NaiveDate,
    thr_on: Option<NaiveDate>,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let state: Option<String> =
        sqlx::query_scalar("SELECT state FROM payroll_run WHERE id = $1 FOR UPDATE")
            .bind(run.id())
            .fetch_optional(&mut *tx)
            .await?;
    if state.as_deref() != Some("DRAFT") {
        return Err(AppError::Conflict(format!(
            "{} has been submitted; send it back to change its THR",
            run.id()
        )));
    }
    sqlx::query("UPDATE payroll_run SET thr_on = $2, updated_at = now() WHERE id = $1")
        .bind(run.id())
        .bind(thr_on)
        .execute(&mut *tx)
        .await?;
    build_slips(&mut tx, run, first_day).await?;
    tx.commit().await?;
    Ok(())
}

// ── tax reports: the month and the year (1721-A1) ───────────────────────────

/// One person's PPh 21 and BPJS in one month, for the tax report.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TaxReportRow {
    pub run_id: String,
    pub unit_id: String,
    pub period: String,
    pub employee_id: String,
    pub employee_code: String,
    pub full_name: Option<String>,
    pub npwp: Option<String>,
    pub ptkp: Option<String>,
    pub ter_category: Option<String>,
    pub tax_method: Option<String>,
    pub taxable_gross_minor: Option<i64>,
    pub pph21_minor: Option<i64>,
    pub final_tax_month: Option<bool>,
    /// The employee's own BPJS (Kesehatan, JHT, JP) taken from pay.
    pub bpjs_employee_minor: i64,
    /// The company's BPJS share (Kesehatan, JHT, JP, JKK, JKM).
    pub bpjs_company_minor: i64,
}

/// Every slip of a month, optionally one unit's, with its tax and BPJS.
pub async fn tax_report(
    pool: &PgPool,
    first_day: NaiveDate,
    unit: Option<&str>,
) -> Result<Vec<TaxReportRow>, AppError> {
    let rows = sqlx::query(
        "SELECT s.run_id, r.unit_id, r.period, s.employee_id, e.code AS employee_code,
                p.full_name, i.npwp, s.ptkp, s.ter_category, s.tax_method,
                s.taxable_gross_minor, s.pph21_minor, s.final_tax_month,
                COALESCE((SELECT sum(l.amount_minor) FROM payroll_slip_line l
                           WHERE l.run_id = s.run_id AND l.employee_id = s.employee_id
                             AND l.component_code IN ('BPJS_KES', 'BPJS_JHT', 'BPJS_JP')), 0)::bigint
                    AS bpjs_employee,
                COALESCE((SELECT sum(l.amount_minor) FROM payroll_slip_line l
                           WHERE l.run_id = s.run_id AND l.employee_id = s.employee_id
                             AND l.component_code IN ('BPJS_KES_CO', 'BPJS_JHT_CO', 'BPJS_JP_CO',
                                                      'BPJS_JKK_CO', 'BPJS_JKM_CO')), 0)::bigint
                    AS bpjs_company
           FROM payroll_slip s
           JOIN payroll_run r ON r.id = s.run_id
           JOIN employee e ON e.id = s.employee_id
           LEFT JOIN employee_profile p ON p.employee_id = s.employee_id
           LEFT JOIN payroll_identity i ON i.employee_id = s.employee_id
          WHERE r.period = $1 AND ($2::text IS NULL OR r.unit_id = $2)
          ORDER BY r.unit_id, e.code",
    )
    .bind(first_day)
    .bind(unit)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            let period: NaiveDate = row.try_get("period")?;
            Ok(TaxReportRow {
                run_id: row.try_get("run_id")?,
                unit_id: row.try_get("unit_id")?,
                period: format!("{:04}-{:02}", period.year(), period.month()),
                employee_id: row.try_get("employee_id")?,
                employee_code: row.try_get("employee_code")?,
                full_name: row.try_get("full_name")?,
                npwp: row.try_get("npwp")?,
                ptkp: row.try_get("ptkp")?,
                ter_category: row.try_get("ter_category")?,
                tax_method: row.try_get("tax_method")?,
                taxable_gross_minor: row.try_get("taxable_gross_minor")?,
                pph21_minor: row.try_get("pph21_minor")?,
                final_tax_month: row.try_get("final_tax_month")?,
                bpjs_employee_minor: row.try_get("bpjs_employee")?,
                bpjs_company_minor: row.try_get("bpjs_company")?,
            })
        })
        .collect()
}

/// Bukti potong 1721-A1: one employee's year, line by line as the form lays
/// it out, worked out from the slips built since 0800.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AnnualTaxSlip {
    pub year: i32,
    pub employee_id: String,
    pub employee_code: String,
    pub full_name: Option<String>,
    pub nik: Option<String>,
    pub npwp: Option<String>,
    pub ptkp: Option<String>,
    /// First and last month with a slip: the *masa perolehan*.
    pub from_month: u32,
    pub to_month: u32,
    /// 1. Gaji / pensiun.
    pub salary_minor: i64,
    /// 2. Tunjangan PPh.
    pub tax_allowance_minor: i64,
    /// 3. Tunjangan lainnya, uang lembur dan sebagainya.
    pub other_allowances_minor: i64,
    /// 5. Premi asuransi yang dibayar pemberi kerja (BPJS Kesehatan, JKK, JKM).
    pub insurance_minor: i64,
    /// 7. Tantiem, bonus, gratifikasi, jasa produksi dan THR.
    pub bonus_thr_minor: i64,
    /// 8. Penghasilan bruto.
    pub gross_minor: i64,
    /// 9. Biaya jabatan.
    pub biaya_jabatan_minor: i64,
    /// 10. Iuran pensiun / JHT / JP dibayar pegawai.
    pub pension_minor: i64,
    /// 12. Penghasilan neto.
    pub net_minor: i64,
    /// 15. PTKP.
    pub ptkp_minor: i64,
    /// 16. PKP setahun, rounded down to the thousand.
    pub taxable_income_minor: i64,
    /// 17. PPh 21 atas PKP setahun (Pasal 17).
    pub tax_due_minor: i64,
    /// 20. PPh 21 yang telah dipotong.
    pub tax_withheld_minor: i64,
    /// The year is settled when a last-month slip exists (December, or the
    /// month employment ended); until then the form is a draft.
    pub settled: bool,
}

/// Every employee's 1721-A1 for a year, optionally one person's.
pub async fn annual_tax_slips(
    pool: &PgPool,
    year: i32,
    employee: Option<&str>,
) -> Result<Vec<AnnualTaxSlip>, AppError> {
    use crate::cloud::domain::statutory as law;
    let start = NaiveDate::from_ymd_opt(year, 1, 1)
        .ok_or_else(|| AppError::Validation(format!("{year} is not a year")))?;
    let end = NaiveDate::from_ymd_opt(year + 1, 1, 1)
        .ok_or_else(|| AppError::Validation(format!("{year} is not a year")))?;
    let rows = sqlx::query(
        "WITH slips AS (
             SELECT s.* , r.period FROM payroll_slip s JOIN payroll_run r ON r.id = s.run_id
              WHERE r.period >= $1 AND r.period < $2 AND s.taxable_gross_minor IS NOT NULL
                AND ($3::text IS NULL OR s.employee_id = $3)
         ),
         lines AS (
             SELECT l.employee_id,
                    sum(l.amount_minor) FILTER (WHERE l.component_code = 'TUNJ_PPH21') AS tax_allowance,
                    sum(l.amount_minor) FILTER (WHERE l.component_code = 'THR') AS thr,
                    sum(l.amount_minor) FILTER (WHERE l.kind = 'EARNING'
                        AND l.component_code NOT IN ('TUNJ_PPH21', 'THR', 'PPH21_RETURN')) AS other_earnings,
                    sum(l.amount_minor) FILTER (WHERE l.component_code IN
                        ('BPJS_KES_CO', 'BPJS_JKK_CO', 'BPJS_JKM_CO')) AS insurance
               FROM payroll_slip_line l JOIN slips s ON s.run_id = l.run_id AND s.employee_id = l.employee_id
              GROUP BY l.employee_id
         )
         SELECT s.employee_id, e.code AS employee_code, p.full_name, p.nik, i.npwp,
                (array_agg(s.ptkp ORDER BY s.period DESC))[1] AS ptkp,
                min(extract(month FROM s.period))::int AS from_month,
                max(extract(month FROM s.period))::int AS to_month,
                count(DISTINCT s.period)::int AS months,
                sum(s.base_minor)::bigint AS salary,
                sum(s.statutory_base_minor - s.base_minor)::bigint AS fixed_allowances,
                sum(s.taxable_gross_minor)::bigint AS gross,
                sum(s.pension_contribution_minor)::bigint AS pension,
                sum(s.pph21_minor)::bigint AS withheld,
                bool_or(COALESCE(s.final_tax_month, false)) AS settled,
                COALESCE(max(x.tax_allowance), 0)::bigint AS tax_allowance,
                COALESCE(max(x.thr), 0)::bigint AS thr,
                COALESCE(max(x.other_earnings), 0)::bigint AS other_earnings,
                COALESCE(max(x.insurance), 0)::bigint AS insurance
           FROM slips s
           JOIN employee e ON e.id = s.employee_id
           LEFT JOIN employee_profile p ON p.employee_id = s.employee_id
           LEFT JOIN payroll_identity i ON i.employee_id = s.employee_id
           LEFT JOIN lines x ON x.employee_id = s.employee_id
          GROUP BY s.employee_id, e.code, p.full_name, p.nik, i.npwp
          ORDER BY e.code",
    )
    .bind(start)
    .bind(end)
    .bind(employee)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let ptkp: Option<String> = row.try_get("ptkp")?;
            let status = ptkp.as_deref().and_then(|raw| PtkpStatus::parse(raw).ok());
            let gross = Money::new(row.try_get("gross")?);
            let pension = Money::new(row.try_get("pension")?);
            let months = u8::try_from(row.try_get::<i32, _>("months")?).unwrap_or(12);
            let biaya = law::biaya_jabatan(gross, months);
            let net = gross.minor - biaya.minor - pension.minor;
            let ptkp_minor = status.map_or(0, |s| law::ptkp_amount(s).minor);
            let taxable = status.map_or(0, |s| law::taxable_income(Money::new(net), s).minor);
            let due = law::pasal_17(Money::new(taxable)).minor;
            let other_earnings: i64 = row.try_get("other_earnings")?;
            let fixed: i64 = row.try_get("fixed_allowances")?;
            Ok(AnnualTaxSlip {
                year,
                employee_id: row.try_get("employee_id")?,
                employee_code: row.try_get("employee_code")?,
                full_name: row.try_get("full_name")?,
                nik: row.try_get("nik")?,
                npwp: row.try_get("npwp")?,
                ptkp,
                from_month: u32::try_from(row.try_get::<i32, _>("from_month")?).unwrap_or(1),
                to_month: u32::try_from(row.try_get::<i32, _>("to_month")?).unwrap_or(12),
                salary_minor: row.try_get("salary")?,
                tax_allowance_minor: row.try_get("tax_allowance")?,
                other_allowances_minor: fixed + other_earnings,
                insurance_minor: row.try_get("insurance")?,
                bonus_thr_minor: row.try_get("thr")?,
                gross_minor: gross.minor,
                biaya_jabatan_minor: biaya.minor,
                pension_minor: pension.minor,
                net_minor: net,
                ptkp_minor,
                taxable_income_minor: taxable,
                tax_due_minor: due,
                tax_withheld_minor: row.try_get("withheld")?,
                settled: row.try_get("settled")?,
            })
        })
        .collect()
}

// ── holding pay (0803) ──────────────────────────────────────────────────────

/// One hold on one person's pay on a run.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct WithholdingView {
    pub run_id: String,
    pub employee_id: String,
    pub held_by: String,
    pub held_at: DateTime<Utc>,
    pub reason: String,
    pub released_by: Option<String>,
    pub released_at: Option<DateTime<Utc>>,
    pub release_reason: Option<String>,
}

pub async fn withholdings(pool: &PgPool, run_id: &str) -> Result<Vec<WithholdingView>, AppError> {
    let rows = sqlx::query(
        "SELECT run_id, employee_id, withheld, released FROM payroll_withholding
          WHERE run_id = $1 ORDER BY created_at",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            let held: Authorization = serde_json::from_value(row.try_get("withheld")?)
                .map_err(|error| corrupt("hold authority", error.to_string()))?;
            let released: Option<Authorization> = row
                .try_get::<Option<serde_json::Value>, _>("released")?
                .map(serde_json::from_value)
                .transpose()
                .map_err(|error| corrupt("release authority", error.to_string()))?;
            Ok(WithholdingView {
                run_id: row.try_get("run_id")?,
                employee_id: row.try_get("employee_id")?,
                held_by: held.actor().to_string(),
                held_at: held.at(),
                reason: held.reason().to_string(),
                released_by: released.as_ref().map(|a| a.actor().to_string()),
                released_at: released.as_ref().map(Authorization::at),
                release_reason: released.as_ref().map(|a| a.reason().to_string()),
            })
        })
        .collect()
}

/// Hold one person's pay on a run. They must be on it; a hold released
/// earlier can be placed again.
pub async fn hold_pay(
    pool: &PgPool,
    run_id: &str,
    employee_id: &str,
    authorization: &Authorization,
) -> Result<(), AppError> {
    let on_run: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM payroll_slip WHERE run_id = $1 AND employee_id = $2)",
    )
    .bind(run_id)
    .bind(employee_id)
    .fetch_one(pool)
    .await?;
    if !on_run {
        return Err(AppError::NotFound(format!("{employee_id} has no slip on {run_id}")));
    }
    let written = sqlx::query(
        "INSERT INTO payroll_withholding (run_id, employee_id, withheld)
         VALUES ($1, $2, $3)
         ON CONFLICT (run_id, employee_id) DO UPDATE SET
            withheld = EXCLUDED.withheld, released = NULL, released_at = NULL
          WHERE payroll_withholding.released_at IS NOT NULL",
    )
    .bind(run_id)
    .bind(employee_id)
    .bind(serde_json::to_value(authorization)?)
    .execute(pool)
    .await?;
    if written.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "{employee_id}'s pay on {run_id} is already held"
        )));
    }
    Ok(())
}

pub async fn release_pay(
    pool: &PgPool,
    run_id: &str,
    employee_id: &str,
    authorization: &Authorization,
) -> Result<(), AppError> {
    let updated = sqlx::query(
        "UPDATE payroll_withholding SET released = $3, released_at = now()
          WHERE run_id = $1 AND employee_id = $2 AND released_at IS NULL",
    )
    .bind(run_id)
    .bind(employee_id)
    .bind(serde_json::to_value(authorization)?)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "no hold on {employee_id}'s pay on {run_id}"
        )));
    }
    Ok(())
}

// ── the payslip template and password (0803) ────────────────────────────────

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PayslipTemplate {
    pub company_name: Option<String>,
    pub company_address: Option<String>,
    pub footer: Option<String>,
    pub show_company_contributions: bool,
    pub password_required: bool,
}

pub async fn payslip_template(pool: &PgPool) -> Result<PayslipTemplate, AppError> {
    let row = sqlx::query(
        "SELECT company_name, company_address, footer, show_company_contributions,
                password_required FROM payslip_template WHERE singleton",
    )
    .fetch_optional(pool)
    .await?;
    Ok(match row {
        Some(row) => PayslipTemplate {
            company_name: row.try_get("company_name")?,
            company_address: row.try_get("company_address")?,
            footer: row.try_get("footer")?,
            show_company_contributions: row.try_get("show_company_contributions")?,
            password_required: row.try_get("password_required")?,
        },
        None => PayslipTemplate {
            company_name: None,
            company_address: None,
            footer: None,
            show_company_contributions: true,
            password_required: false,
        },
    })
}

pub async fn save_payslip_template(
    pool: &PgPool,
    template: &PayslipTemplate,
    authorization: &Authorization,
) -> Result<(), AppError> {
    let blank = |value: &Option<String>| {
        value
            .as_deref()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(ToOwned::to_owned)
    };
    sqlx::query(
        "INSERT INTO payslip_template
             (singleton, company_name, company_address, footer, show_company_contributions,
              password_required, updated)
         VALUES (true, $1, $2, $3, $4, $5, $6)
         ON CONFLICT (singleton) DO UPDATE SET
            company_name = EXCLUDED.company_name,
            company_address = EXCLUDED.company_address,
            footer = EXCLUDED.footer,
            show_company_contributions = EXCLUDED.show_company_contributions,
            password_required = EXCLUDED.password_required,
            updated = EXCLUDED.updated,
            updated_at = now()",
    )
    .bind(blank(&template.company_name))
    .bind(blank(&template.company_address))
    .bind(blank(&template.footer))
    .bind(template.show_company_contributions)
    .bind(template.password_required)
    .bind(serde_json::to_value(authorization)?)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_payslip_password(
    pool: &PgPool,
    employee_id: &str,
    hash: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO payslip_password (employee_id, hash) VALUES ($1, $2)
         ON CONFLICT (employee_id) DO UPDATE SET hash = EXCLUDED.hash, set_at = now()",
    )
    .bind(employee_id)
    .bind(hash)
    .execute(pool)
    .await?;
    Ok(())
}

/// Forget an employee's payslip password, so they choose a new one the next
/// time they open their payslips. `false` when none was set.
pub async fn clear_payslip_password(pool: &PgPool, employee_id: &str) -> Result<bool, AppError> {
    let gone = sqlx::query("DELETE FROM payslip_password WHERE employee_id = $1")
        .bind(employee_id)
        .execute(pool)
        .await?;
    Ok(gone.rows_affected() > 0)
}

pub async fn payslip_password_hash(
    pool: &PgPool,
    employee_id: &str,
) -> Result<Option<String>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT hash FROM payslip_password WHERE employee_id = $1")
            .bind(employee_id)
            .fetch_optional(pool)
            .await?,
    )
}

// ── loans (0804) ────────────────────────────────────────────────────────────

/// The component a loan's instalment is filed under, and the authority it is
/// filed with — the system, on the plan head office granted.
pub const LOAN_COMPONENT: &str = "CICILAN_PINJAMAN";
/// Filed under the ordinary filing key — the domain re-checks it on every
/// read — and told apart from a hand filing by its actor, the system, and the
/// advance it names.
const LOAN_INSTALMENT_KEY: &str = crate::cloud::domain::actions::PAYROLL_ADJUSTMENT_FILE;

/// File this month's loan instalment for one person on one draft run.
///
/// Refiled on every build: the instalment this run filed last time is taken
/// back first (unless an approval already settled it), so a rebuild after a
/// cash repayment or a stopped plan files what is owed now. A
/// `CICILAN_PINJAMAN` somebody filed by hand for the month wins — the place
/// said what comes off, and the system does not file a second.
///
/// One loan at a time, the oldest paid first: a second loan's instalments
/// start when the first is repaid. One run per month: somebody transferred
/// mid-month pays the instalment on the run that filed it first.
async fn file_loan_instalment(
    tx: &mut Transaction<'_, Postgres>,
    unit_id: &str,
    first_day: NaiveDate,
    employee_id: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "DELETE FROM payroll_adjustment a
          WHERE a.unit_id = $1 AND a.period = $2 AND a.employee_id = $3
            AND a.component_code = $4
            AND a.filed->>'actor' = 'system' AND a.advance_id IS NOT NULL
            AND a.filed->>'action_key' = $5
            AND NOT EXISTS (SELECT 1 FROM advance_settlement s
                             WHERE s.payroll_adjustment_id = a.id)",
    )
    .bind(unit_id)
    .bind(first_day)
    .bind(employee_id)
    .bind(LOAN_COMPONENT)
    .bind(LOAN_INSTALMENT_KEY)
    .execute(&mut **tx)
    .await?;

    let filed_by_hand: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM payroll_adjustment
                         WHERE unit_id = $1 AND period = $2 AND employee_id = $3
                           AND component_code = $4)",
    )
    .bind(unit_id)
    .bind(first_day)
    .bind(employee_id)
    .bind(LOAN_COMPONENT)
    .fetch_one(&mut **tx)
    .await?;
    if filed_by_hand {
        return Ok(());
    }

    let plans = sqlx::query(
        "SELECT p.advance_id, p.instalment_minor, ad.advance_number,
                (ad.amount_minor
                  - COALESCE((SELECT sum(s.amount_minor) FROM advance_settlement s
                               WHERE s.advance_id = ad.advance_id), 0)
                  - COALESCE((SELECT sum(a.amount_minor) FROM payroll_adjustment a
                               WHERE a.advance_id = ad.advance_id
                                 AND NOT (a.unit_id = $2 AND a.period = $3)
                                 AND NOT EXISTS (SELECT 1 FROM advance_settlement s
                                                  WHERE s.payroll_adjustment_id = a.id)), 0))::bigint
                  AS left_minor,
                EXISTS (SELECT 1 FROM payroll_adjustment a
                         WHERE a.advance_id = ad.advance_id AND a.period = $3
                           AND a.unit_id <> $2) AS elsewhere
           FROM employee_loan_plan p
           JOIN advance ad ON ad.advance_id = p.advance_id
          WHERE p.employee_id = $1 AND p.stopped_at IS NULL AND p.first_period <= $3
            AND ad.status IN ('PAID', 'PARTIALLY_SETTLED')
          ORDER BY ad.paid_at, ad.advance_number",
    )
    .bind(employee_id)
    .bind(unit_id)
    .bind(first_day)
    .fetch_all(&mut **tx)
    .await?;

    for plan in &plans {
        let left: i64 = plan.try_get("left_minor")?;
        if left <= 0 {
            continue;
        }
        if plan.try_get::<bool, _>("elsewhere")? {
            return Ok(());
        }
        let instalment: i64 = plan.try_get("instalment_minor")?;
        let number: String = plan.try_get("advance_number")?;
        let filed = serde_json::json!({
            "actor": "system",
            "action_key": LOAN_INSTALMENT_KEY,
            "at": Utc::now(),
            "reason": format!("cicilan pinjaman {number}"),
        });
        sqlx::query(
            "INSERT INTO payroll_adjustment
                 (id, unit_id, period, employee_id, component_code, basis, amount_minor,
                  advance_id, filed)
             VALUES ($1, $2, $3, $4, $5, 'PER_OCCASION', $6, $7, $8)
             ON CONFLICT (unit_id, period, employee_id, component_code) DO NOTHING",
        )
        .bind(format!("adj-{}", Uuid::new_v4()))
        .bind(unit_id)
        .bind(first_day)
        .bind(employee_id)
        .bind(LOAN_COMPONENT)
        .bind(instalment.min(left))
        .bind(plan.try_get::<Uuid, _>("advance_id")?)
        .bind(filed)
        .execute(&mut **tx)
        .await?;
        return Ok(());
    }
    Ok(())
}

/// One repayment of a loan: a month's instalment, or money Finance received.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LoanRepayment {
    /// `PAYROLL` for an instalment from pay, `REFUND` for cash returned,
    /// `EXPENSE` for receipts.
    pub kind: String,
    pub amount_minor: i64,
    /// The month of the run, for an instalment.
    pub period: Option<String>,
    pub at: DateTime<Utc>,
}

/// A loan: the advance, its plan, and what is left.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LoanView {
    pub advance_id: String,
    pub advance_number: String,
    pub employee_id: String,
    pub employee_code: String,
    pub full_name: Option<String>,
    pub purpose: String,
    pub amount_minor: i64,
    /// The advance's state: `APPROVED` is lent and waiting on Finance to pay
    /// it out; nothing comes off pay until it is `PAID`.
    pub status: String,
    pub paid_at: Option<DateTime<Utc>>,
    pub instalment_minor: i64,
    /// `YYYY-MM`.
    pub first_period: String,
    /// What has come back, settled.
    pub repaid_minor: i64,
    /// Instalments on runs not yet approved.
    pub pending_minor: i64,
    pub outstanding_minor: i64,
    /// Months still to go at the instalment, counting what is pending.
    pub instalments_left: i64,
    pub stopped: bool,
    pub granted_by: String,
    pub repayments: Vec<LoanRepayment>,
}

const LOAN_SELECT: &str = "
    SELECT ad.advance_id, ad.advance_number, p.employee_id, e.code AS employee_code,
           pr.full_name, ad.purpose, ad.amount_minor, ad.status, ad.paid_at,
           p.instalment_minor, p.first_period, p.stopped_at IS NOT NULL AS stopped,
           p.granted->>'actor' AS granted_by,
           COALESCE((SELECT sum(s.amount_minor) FROM advance_settlement s
                      WHERE s.advance_id = ad.advance_id), 0)::bigint AS repaid_minor,
           COALESCE((SELECT sum(a.amount_minor) FROM payroll_adjustment a
                      WHERE a.advance_id = ad.advance_id
                        AND NOT EXISTS (SELECT 1 FROM advance_settlement s
                                         WHERE s.payroll_adjustment_id = a.id)), 0)::bigint
             AS pending_minor
      FROM employee_loan_plan p
      JOIN advance ad ON ad.advance_id = p.advance_id
      JOIN employee e ON e.id = p.employee_id
      LEFT JOIN employee_profile pr ON pr.employee_id = p.employee_id";

async fn loan_rows(pool: &PgPool, rows: Vec<sqlx::postgres::PgRow>) -> Result<Vec<LoanView>, AppError> {
    let mut loans = Vec::with_capacity(rows.len());
    for row in rows {
        let advance_id: Uuid = row.try_get("advance_id")?;
        let amount: i64 = row.try_get("amount_minor")?;
        let repaid: i64 = row.try_get("repaid_minor")?;
        let pending: i64 = row.try_get("pending_minor")?;
        let instalment: i64 = row.try_get("instalment_minor")?;
        let first: NaiveDate = row.try_get("first_period")?;
        let outstanding = (amount - repaid).max(0);
        let to_go = (outstanding - pending).max(0);
        let repayments = sqlx::query(
            "SELECT s.kind, s.amount_minor, s.settled_at, s.note
               FROM advance_settlement s WHERE s.advance_id = $1
              ORDER BY s.settled_at",
        )
        .bind(advance_id)
        .fetch_all(pool)
        .await?
        .iter()
        .map(|r| {
            let kind: String = r.try_get("kind")?;
            Ok(LoanRepayment {
                period: if kind == "PAYROLL" { r.try_get("note")? } else { None },
                kind,
                amount_minor: r.try_get("amount_minor")?,
                at: r.try_get("settled_at")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
        loans.push(LoanView {
            advance_id: advance_id.to_string(),
            advance_number: row.try_get("advance_number")?,
            employee_id: row.try_get("employee_id")?,
            employee_code: row.try_get("employee_code")?,
            full_name: row.try_get("full_name")?,
            purpose: row.try_get("purpose")?,
            amount_minor: amount,
            status: row.try_get("status")?,
            paid_at: row.try_get("paid_at")?,
            instalment_minor: instalment,
            first_period: first.format("%Y-%m").to_string(),
            repaid_minor: repaid,
            pending_minor: pending,
            outstanding_minor: outstanding,
            instalments_left: (to_go + instalment - 1) / instalment,
            stopped: row.try_get("stopped")?,
            granted_by: row.try_get::<Option<String>, _>("granted_by")?.unwrap_or_default(),
            repayments,
        });
    }
    Ok(loans)
}

/// One person's loans, newest first.
pub async fn loans_of(pool: &PgPool, employee_id: &str) -> Result<Vec<LoanView>, AppError> {
    let rows = sqlx::query(&format!(
        "{LOAN_SELECT} WHERE p.employee_id = $1 ORDER BY p.created_at DESC"
    ))
    .bind(employee_id)
    .fetch_all(pool)
    .await?;
    loan_rows(pool, rows).await
}

/// Every loan in the company, newest first.
pub async fn all_loans(pool: &PgPool) -> Result<Vec<LoanView>, AppError> {
    let rows = sqlx::query(&format!("{LOAN_SELECT} ORDER BY p.created_at DESC"))
        .fetch_all(pool)
        .await?;
    loan_rows(pool, rows).await
}

/// Grant a loan: an EMPLOYEE advance, approved by the granting authority and
/// left for Finance to pay out, and the plan that repays it. One transaction:
/// an advance without its plan would be a kasbon nobody meant.
pub async fn grant_loan(
    pool: &PgPool,
    employee_id: &str,
    amount_minor: i64,
    instalment_minor: i64,
    first_period: NaiveDate,
    purpose: &str,
    granted: &Authorization,
) -> Result<Uuid, AppError> {
    if amount_minor <= 0 || instalment_minor <= 0 {
        return Err(AppError::Validation(
            "a loan and its instalment are positive amounts".into(),
        ));
    }
    if instalment_minor > amount_minor {
        return Err(AppError::Validation(
            "the instalment is more than the loan; lend it as one month's kasbon instead".into(),
        ));
    }
    let site_id = super::sites::head_office_site_id(pool).await?;
    let mut tx = pool.begin().await?;
    let advance_id = Uuid::new_v4();
    let number: String =
        sqlx::query_scalar("SELECT 'ADV-' || to_char(nextval('advance_number_seq'), 'FM000000')")
            .fetch_one(&mut *tx)
            .await?;
    let actor = granted.actor().as_str().to_owned();
    sqlx::query(
        "INSERT INTO advance
           (advance_id, advance_number, site_id, party_type, employee_id,
            advance_qualifier, purpose, amount_minor, requested_by, note,
            status, approved_by, approved_at)
         VALUES ($1, $2, $3, 'EMPLOYEE', $4, 'OTHERS', $5, $6, $7, $8,
                 'APPROVED', $7, now())",
    )
    .bind(advance_id)
    .bind(&number)
    .bind(&site_id)
    .bind(employee_id)
    .bind(format!("Pinjaman karyawan: {}", purpose.trim()))
    .bind(amount_minor)
    .bind(&actor)
    .bind(granted.reason().as_str())
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO employee_loan_plan
             (advance_id, employee_id, instalment_minor, first_period, granted)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(advance_id)
    .bind(employee_id)
    .bind(instalment_minor)
    .bind(first_period)
    .bind(serde_json::to_value(granted)?)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(advance_id)
}

/// Stop a loan's instalments. What came back stays settled; what is still
/// out is Finance's to collect or write off on the advance.
pub async fn stop_loan(
    pool: &PgPool,
    advance_id: Uuid,
    stopped: &Authorization,
) -> Result<String, AppError> {
    let employee: Option<String> = sqlx::query_scalar(
        "UPDATE employee_loan_plan SET stopped_at = now(), stopped = $2
          WHERE advance_id = $1 AND stopped_at IS NULL
      RETURNING employee_id",
    )
    .bind(advance_id)
    .bind(serde_json::to_value(stopped)?)
    .fetch_optional(pool)
    .await?;
    employee.ok_or_else(|| {
        AppError::Conflict("no running loan by that id: it does not exist or is already stopped".into())
    })
}

/// Whose loan it is, so a caller's reach can be checked first.
pub async fn loan_employee(pool: &PgPool, advance_id: Uuid) -> Result<Option<String>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT employee_id FROM employee_loan_plan WHERE advance_id = $1")
            .bind(advance_id)
            .fetch_optional(pool)
            .await?,
    )
}
