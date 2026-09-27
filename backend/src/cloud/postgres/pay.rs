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
    PayrollRun, PayrollRunWire, PlaceId, RunEvent, RunState, SlipComputation, SlipFacts, SlipLine,
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
}

const SLIP_LINE_COLUMNS: &str = "l.run_id, l.employee_id, l.line_no, l.kind, l.component_code, \
     l.label, l.basis, l.base_ref, l.base_of_minor, l.rate_bp, l.cap_minor, l.hours_divisor, \
     l.multiplier_bp, l.unit, l.units, l.rate_minor, l.amount_minor";

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
    let mut remaining = Vec::with_capacity(lines.len());
    for (line_run, line_employee, line) in lines.drain(..) {
        if line_run == run_id && line_employee == employee_id {
            if line.kind == "DEDUCTION" {
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
     s.net_minor, s.components_incomplete_because, i.bank_account";

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
async fn overtime_bands(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
    place: &PlaceId,
    first_day: NaiveDate,
) -> Result<(i64, i64, i64, i64), AppError> {
    let row = sqlx::query(
        "WITH agreed AS (
             SELECT on_date, day_kind, sum(planned_minutes)::bigint AS minutes
               FROM overtime_order
              WHERE employee_id = $1 AND state = 'AGREED'
                AND place_id = $3
                AND on_date >= $2::date AND on_date < ($2::date + interval '1 month')
              GROUP BY on_date, day_kind
         )
         SELECT
             COALESCE(sum(CASE WHEN day_kind = 'WORKING'
                               THEN least(minutes, 60) ELSE 0 END), 0)::bigint AS first_hour,
             COALESCE(sum(CASE WHEN day_kind = 'WORKING'
                               THEN greatest(minutes - 60, 0) ELSE 0 END), 0)::bigint AS later,
             COALESCE(sum(CASE WHEN day_kind = 'REST'
                               THEN minutes ELSE 0 END), 0)::bigint AS rest_day,
             COALESCE(sum(CASE WHEN day_kind = 'HOLIDAY'
                               THEN minutes ELSE 0 END), 0)::bigint AS holiday
           FROM agreed",
    )
    .bind(employee_id)
    .bind(first_day)
    .bind(place.as_str())
    .fetch_one(&mut **tx)
    .await?;

    Ok((
        row.try_get("first_hour")?,
        row.try_get("later")?,
        row.try_get("rest_day")?,
        row.try_get("holiday")?,
    ))
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
            _ => (None, None, None, None),
        };
        sqlx::query(
            "INSERT INTO payroll_slip_line
                 (run_id, employee_id, line_no, kind, component_code, label, basis,
                  base_ref, base_of_minor, rate_bp, cap_minor, hours_divisor,
                  multiplier_bp, unit, units, rate_minor, amount_minor)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)",
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
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
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
          WHERE a.place_id = $1
            AND a.valid_from < ($2::date + interval '1 month')
            AND (a.valid_to IS NULL OR a.valid_to >= $2::date)
            AND e.status IN ('ACTIVE', 'TERMINATED')
          ORDER BY a.employee_id",
    )
    .bind(run.place().as_str())
    .bind(first_day)
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
                    AND lr.place_id = $3
                    AND (day)::date >= $2::date
                    AND (day)::date < ($2::date + interval '1 month')
             ) counted",
        )
        .bind(&employee_id)
        .bind(first_day)
        .bind(run.place().as_str())
        .fetch_one(&mut **tx)
        .await?;

        // Banded, because the statutory table is banded — and the total is the
        // sum of the bands rather than a second query, so `overtime_minutes`
        // and the lines that value it cannot disagree.
        let (first_hour, later, rest_day, holiday) =
            overtime_bands(tx, &employee_id, run.place(), first_day).await?;
        let overtime = first_hour + later + rest_day + holiday;

        let rostered: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM roster_day
              WHERE employee_id = $1
                AND place_id = $3
                AND on_date >= $2::date AND on_date < ($2::date + interval '1 month')",
        )
        .bind(&employee_id)
        .bind(first_day)
        .bind(run.place().as_str())
        .fetch_one(&mut **tx)
        .await?;

        let leave_days = leave_days.unwrap_or(0);
        let facts = SlipFacts {
            base: Money::new(base),
            statutory_base: Money::new(statutory_base),
            overtime_workday_first_hour: first_hour,
            overtime_workday_later: later,
            overtime_rest_day: rest_day,
            overtime_holiday: holiday,
            rostered_days: rostered,
            leave_days_taken: leave_days,
        };
        let adjustments =
            super::components::adjustments_for_run(tx, run.place(), first_day, &employee_id)
                .await?;
        let computed =
            SlipComputation::compute(Money::new(statutory_base), &facts, &catalogue, &adjustments)
                .map_err(super::components::component_error)?;

        sqlx::query(
            "INSERT INTO payroll_slip
                 (run_id, employee_id, base_minor, fixed_allowances, statutory_base_minor,
                  leave_days_taken, overtime_minutes, rostered_days,
                  gross_minor, deduction_total_minor, net_minor,
                  components_incomplete_because)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
                components_incomplete_because = EXCLUDED.components_incomplete_because",
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
    place: &str,
    first_day: NaiveDate,
) -> Result<(), AppError> {
    let Some(run_id) = sqlx::query_scalar::<_, String>(
        "SELECT id FROM payroll_run WHERE place_id = $1 AND period = $2",
    )
    .bind(place)
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
            AND a.place_id = $1 AND a.period = $2",
    )
    .bind(run.place().as_str())
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
          WHERE a.place_id = $1 AND a.period = $2 AND a.advance_id IS NOT NULL
          ORDER BY a.id",
    )
    .bind(run.place().as_str())
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
                                   WHERE a.place_id = $1 AND a.period = $2
                                     AND a.advance_id IS NOT NULL)
          GROUP BY ad.advance_id
          ORDER BY ad.advance_number",
    )
    .bind(run.place().as_str())
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

    // The signed handover IS the accrual. Gross, one line each way, on the day
    // the approved run reaches Finance: the wages became owed when both sides
    // agreed on them, so the source event posts the journal in this transaction.
    // The store later paying staff out of its fund debits the same payable
    // (`store_money.rs`), which is the loop closing -- before this posting
    // existed, that debit answered a credit nobody had ever written.
    //
    // The place pays, but the SITE the ledger knows is the place's own: `ho`
    // is a place that works at site `dc` (0236), so the site comes from
    // `org_place` and falls back to the place's own id.
    let site_id: String =
        sqlx::query_scalar("SELECT COALESCE(site_id, id) FROM org_place WHERE id = $1")
            .bind(handover.place().as_str())
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| {
                AppError::NotFound(format!("the payroll handover's place {}", handover.place()))
            })?;
    let lines = payroll_accrual_lines(&mut tx, handover.run_id(), &site_id, handover.gross_minor())
        .await?;
    let intent = PostingIntent {
        posting_date: Utc::now().date_naive(),
        source_kind: "PAYROLL_RUN".into(),
        source_id: Some(handover.run_id().to_string()),
        rule_version: "payroll_run/2".into(),
        currency: "IDR".into(),
        memo: Some(format!(
            "Payroll {} {} handed to Finance",
            handover.place(),
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

/// The accrual a payroll run posts when HR hands it to Finance.
///
/// Every earning debits its component's `payroll_expense` link and every
/// deduction credits its component's `payroll_deduction` link (0466) — the
/// component says where it lands, nothing is read off its code. Base pay, which
/// no component explains, is the company's `payroll_expense` / SALARY link, by
/// the kind of site (6012 at a shop, 6026 at head office). What the employee is
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
    site_id: &str,
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
                COALESCE(c.employer_borne, false) AS employer_borne,
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
                if line.try_get::<bool, _>("paid_from_accrual")? {
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
            PostingLine::debit("payroll_expense", site_id, *amount)
        } else {
            PostingLine::credit("payroll_expense", site_id, -amount)
        };
        lines.extend(signed(*amount, line.from_source("PAY_COMPONENT", code)));
    }
    if base_pay > 0 {
        lines.push(PostingLine::debit("payroll_expense", site_id, base_pay).with_qualifier("SALARY"));
    } else if base_pay < 0 {
        lines.push(PostingLine::credit("payroll_expense", site_id, -base_pay).with_qualifier("SALARY"));
    }
    if from_accrual > 0 {
        lines.push(PostingLine::debit("thr_payable", site_id, from_accrual));
    }
    let mut withheld = 0i64;
    for (code, amount) in &deductions {
        if *amount > 0 {
            withheld += amount;
            lines.push(
                PostingLine::credit("payroll_deduction", site_id, *amount)
                    .from_source("PAY_COMPONENT", code),
            );
        }
    }
    let net = gross_total - withheld;
    if net > 0 {
        lines.push(PostingLine::credit("payroll_payable", site_id, net));
    } else if net < 0 {
        lines.push(PostingLine::debit("payroll_payable", site_id, -net));
    }
    if thr_accrual > 0 {
        lines.push(PostingLine::debit("payroll_expense", site_id, thr_accrual).with_qualifier("THR"));
        lines.push(PostingLine::credit("thr_payable", site_id, thr_accrual));
    }
    for (code, amount) in &borne {
        if *amount > 0 {
            lines.push(
                PostingLine::debit("payroll_expense", site_id, *amount)
                    .from_source("PAY_COMPONENT", code),
            );
            lines.push(
                PostingLine::credit("payroll_deduction", site_id, *amount)
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
    place_id: &str,
    actor: &str,
) -> Result<Uuid, AppError> {
    let mut tx = pool.begin().await?;
    let site_id: String =
        sqlx::query_scalar("SELECT COALESCE(site_id, id) FROM org_place WHERE id = $1")
            .bind(place_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("the payroll place {place_id}")))?;
    let gross: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(gross_minor), 0)::bigint FROM payroll_slip WHERE run_id = $1",
    )
    .bind(run_id)
    .fetch_one(&mut *tx)
    .await?;
    let lines = payroll_accrual_lines(&mut tx, run_id, &site_id, gross).await?;
    let posted = post(
        &mut tx,
        &PostingIntent {
            posting_date: Utc::now().date_naive(),
            source_kind: "PAYROLL_RUN".into(),
            source_id: Some(run_id.to_string()),
            rule_version: "payroll_run/2".into(),
            currency: "IDR".into(),
            memo: Some(format!("Payroll {place_id} accrued")),
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
    let (site_id, site_kind): (String, String) = sqlx::query_as(
        "SELECT s.id, s.kind FROM org_place p JOIN site s ON s.id = COALESCE(p.site_id, p.id)
          WHERE p.id = $1",
    )
    .bind(handover.place().as_str())
    .fetch_one(pool)
    .await?;
    let mut tx = pool.begin().await?;
    if site_kind != "STORE" {
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
                AND e.purpose IN ('ACCRUAL', 'MAIN') AND l.site_id = $2
                AND l.account_code = (SELECT account_code FROM account_resolution
                                       WHERE role = 'payroll_payable'
                                         AND site_id = $2 AND source_type = 'COMPANY'
                                         AND source_id = '')",
        )
        .bind(handover.run_id().to_string())
        .bind(&site_id)
        .fetch_one(&mut *tx)
        .await?;
        if owed > 0 {
            // The bank that pays is head office's, found by its kind (0474).
            let head_office = super::sites::head_office_site_id(&mut *tx).await?;
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
                        handover.place(),
                        handover.period()
                    )),
                    lines: vec![
                        PostingLine::debit("payroll_payable", &site_id, owed),
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
