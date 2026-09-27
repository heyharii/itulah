//! Recurring bills: the promise, and the sweep that keeps it.

use super::payables::{record_bill_draft, RecordBillLine, RecordBillRequest};
use super::{assert_category_for_account, assert_postable};
use crate::cloud::application::AppError;
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// One recurring charge: who invoices, where it lands, what to expect.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BillTemplate {
    pub template_id: Uuid,
    pub supplier_id: String,
    pub supplier_name: Option<String>,
    pub site_id: String,
    pub expense_account_code: String,
    pub expense_category_code: Option<String>,
    pub expense_site_id: String,
    pub expected_subtotal_minor: i64,
    pub expected_tax_minor: i64,
    pub tolerance_bps: i32,
    pub due_day: i32,
    pub label: String,
    pub note: Option<String>,
    pub active: bool,
    /// The GA contract this recurring bill serves (0362), when there is one —
    /// the FINANCE side of a deal GA holds. The monthly figure stays the
    /// template's own; this only says whose promise raises it.
    pub contract_id: Option<Uuid>,
    pub created_by: String,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordBillTemplateRequest {
    pub supplier_id: String,
    pub supplier_name: Option<String>,
    pub site_id: String,
    pub expense_account_code: String,
    pub expense_category_code: Option<String>,
    pub expense_site_id: Option<String>,
    pub expected_subtotal_minor: i64,
    #[serde(default)]
    pub expected_tax_minor: i64,
    #[serde(default = "default_tolerance")]
    pub tolerance_bps: i32,
    pub due_day: i32,
    pub label: String,
    pub note: Option<String>,
    /// The GA contract this promise belongs to. Optional — plenty of
    /// recurring bills answer to nobody's contract — but a named one must
    /// EXIST and not be archived: a promise filed under a deal the register
    /// has put away is a bill nobody can explain.
    pub contract_id: Option<Uuid>,
}

fn default_tolerance() -> i32 {
    500
}

/// What the sweep did in one period, for the log and for the screen.
#[derive(Clone, Debug, Serialize, Default)]
pub struct BillTemplateSweep {
    pub raised: i64,
    pub already_raised: i64,
}

/// Write the promise. The same two checks a typed expense-bill line goes
/// through, run on the promise instead of the paper — a template whose
/// account is a heading or whose category does not belong is refused here,
/// in words, rather than by the first draft's posting three weeks later.
pub async fn record_bill_template(
    pool: &PgPool,
    request: &RecordBillTemplateRequest,
    actor: &str,
) -> Result<BillTemplate, AppError> {
    let supplier = request.supplier_id.trim();
    if supplier.is_empty() {
        return Err(AppError::Validation(
            "a recurring bill names the supplier that sends it".into(),
        ));
    }
    let label = request.label.trim();
    if label.is_empty() {
        return Err(AppError::Validation(
            "a recurring bill carries a label; the list is read by people".into(),
        ));
    }
    if request.expected_subtotal_minor <= 0 {
        return Err(AppError::Validation(
            "a recurring bill expects a figure above zero".into(),
        ));
    }
    if !(1..=31).contains(&request.due_day) {
        return Err(AppError::Validation(
            "the arrival day is a day of the month, 1 to 31".into(),
        ));
    }
    let expense_site = request
        .expense_site_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&request.site_id);
    let account = request.expense_account_code.trim();
    assert_postable(pool, account, super::Intent::Post).await?;
    let category = request
        .expense_category_code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    assert_category_for_account(pool, account, category, super::Intent::Post).await?;

    // The contract, when named, must be one the register still holds — and
    // not an archived one. The refusals are in words because "foreign key"
    // names a constraint, not the mistake.
    if let Some(contract_id) = request.contract_id {
        let live: Option<bool> = sqlx::query_scalar(
            "SELECT NOT archived FROM ga_contract WHERE contract_id = $1",
        )
        .bind(contract_id)
        .fetch_optional(pool)
        .await?;
        match live {
            None => {
                return Err(AppError::Validation(
                    "the contract this recurring bill names is not in the GA register".into(),
                ))
            }
            Some(false) => {
                return Err(AppError::Validation(
                    "that GA contract is archived; a recurring bill is not filed under an \
                     archived deal"
                        .into(),
                ))
            }
            Some(true) => {}
        }
    }

    let template_id = Uuid::new_v4();
    let row = sqlx::query(
        "INSERT INTO bill_template
           (template_id, supplier_id, supplier_name, site_id, expense_account_code,
            expense_category_code, expense_site_id, expected_subtotal_minor,
            expected_tax_minor, tolerance_bps, due_day, label, note, contract_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING template_id, supplier_id, supplier_name, site_id,
                   expense_account_code, expense_category_code, expense_site_id,
                   expected_subtotal_minor, expected_tax_minor, tolerance_bps,
                   due_day, label, note, active, contract_id, created_by",
    )
    .bind(template_id)
    .bind(supplier)
    .bind(request.supplier_name.as_deref())
    .bind(&request.site_id)
    .bind(account)
    .bind(category)
    .bind(expense_site)
    .bind(request.expected_subtotal_minor)
    .bind(request.expected_tax_minor)
    .bind(request.tolerance_bps)
    .bind(request.due_day)
    .bind(label)
    .bind(request.note.as_deref())
    .bind(request.contract_id)
    .bind(actor)
    .fetch_one(pool)
    .await?;
    Ok(to_template(&row))
}

/// The promises, active ones first.
pub async fn bill_templates(pool: &PgPool) -> Result<Vec<BillTemplate>, AppError> {
    let rows = sqlx::query(
        "SELECT template_id, supplier_id, supplier_name, site_id, expense_account_code,
                expense_category_code, expense_site_id, expected_subtotal_minor,
                expected_tax_minor, tolerance_bps, due_day, label, note, active,
                contract_id, created_by
           FROM bill_template
          ORDER BY active DESC, label",
    )
    .fetch_all(pool)
    .await?;
    rows.iter().map(|row| Ok(to_template(row))).collect()
}

/// Retire a promise. The drafts it already raised stay — they are bills that
/// existed, raised by a promise that existed; history does not follow the
/// template into retirement.
pub async fn retire_bill_template(
    pool: &PgPool,
    template_id: Uuid,
    actor: &str,
) -> Result<(), AppError> {
    let done = sqlx::query(
        "UPDATE bill_template
            SET active = false, retired_by = $2, retired_at = now()
          WHERE template_id = $1 AND active",
    )
    .bind(template_id)
    .bind(actor)
    .execute(pool)
    .await?
    .rows_affected();
    if done == 0 {
        return Err(AppError::Conflict(
            "that recurring bill is already retired".into(),
        ));
    }
    Ok(())
}

/// Raise the drafts that are due, once each.
///
/// Called hourly by the agent and safe to call by hand: `bill_template_run`
/// is the once-guard, so a restart or a manual sweep raises exactly what the
/// hour before did not. A template is due when its arrival day has come in
/// the current month; the 29th, 30th and 31st are clamped to the month's own
/// end, because February is nobody's to promise about.
///
/// The draft carries the EXPECTED figure and a note naming the template, and
/// nothing else pretends to be the real invoice: matching the paper that
/// arrives, adjusting the figure and posting remain a person's acts, exactly
/// as they are for a bill typed by hand.
pub async fn bill_template_sweep(
    pool: &PgPool,
    today: NaiveDate,
    actor: &str,
) -> Result<BillTemplateSweep, AppError> {
    let mut out = BillTemplateSweep::default();
    let due = sqlx::query(
        "SELECT template_id, supplier_id, supplier_name, site_id, expense_account_code,
                expense_category_code, expense_site_id, expected_subtotal_minor,
                expected_tax_minor, due_day, label, contract_id
           FROM bill_template
          WHERE active",
    )
    .fetch_all(pool)
    .await?;
    let period = last_day_of_month(today);
    let first_day = NaiveDate::from_ymd_opt(today.year(), today.month(), 1).unwrap_or(today);
    for row in &due {
        let due_day: i32 = row.try_get("due_day")?;
        let clamp = period.day() as i32;
        // The 29th–31st fall on the month's own last day when the month is
        // shorter: a promise of "the 31st" in February is a promise of the
        // 28th (or 29th), NOT a month skipped. Clamping was what 0316's
        // comment always said; the first spelling of it skipped short months
        // entirely, which is why this line carries its history with it.
        let effective = due_day.min(clamp);
        if (today.day() as i32) < effective {
            continue;
        }
        let template_id: Uuid = row.try_get("template_id")?;
        let label: String = row.try_get("label")?;
        let invoice_number = format!("RUTIN {} {}", label, today.format("%Y-%m"));
        let request = RecordBillRequest {
            invoice_number: invoice_number.clone(),
            supplier_id: row.try_get("supplier_id")?,
            supplier_name: row.try_get("supplier_name")?,
            site_id: row.try_get("site_id")?,
            invoice_date: today,
            due_date: Some(period),
            subtotal_minor: row.try_get("expected_subtotal_minor")?,
            tax_minor: row.try_get("expected_tax_minor")?,
            discount_minor: 0,
            note: Some(format!(
                "Raised from the recurring-bill promise “{label}”; a placeholder at the \
                 expected figure, waiting for the real invoice to be matched against it."
            )),
            kind: Some("EXPENSE".into()),
            lines: Some(vec![RecordBillLine {
                account_code: row.try_get("expense_account_code")?,
                site_id: row.try_get("expense_site_id")?,
                amount_minor: row.try_get("expected_subtotal_minor")?,
                category_code: row.try_get("expense_category_code")?,
                asset_class_code: None,
                draws_reserve: false,
                // The contract goes on the LINE, not only on the template
                // (brief §8.1: the line is the source of truth). This is what
                // lets "ditagih untuk kontrak ini" be summed from the rows.
                contract_id: row.try_get("contract_id")?,
                repair_id: None,
                replacement_id: None,
                supply_request_id: None,
                asset_id: None,
                // A recurring month is exactly the month it is raised for,
                // which is the period a prepaid schedule would read.
                service_period_start: Some(first_day),
                service_period_end: Some(period),
                account_overridden: false,
                memo: None,
            }]),
            matching: None,
            withholding_code: None,
            receipt_ids: None,
            submitted_by_domain: None,
            document_ref: None,
        };

        // # One draft, even when two sweeps run at once
        //
        // The once-guard is `bill_template_run`, and it CANNOT be inserted
        // before the bill it names — `invoice_id` is NOT NULL and a foreign
        // key — so the check-then-raise was two steps that two sweeps could
        // both pass. A transaction-scoped advisory lock on (template, period)
        // serialises them: the second sweep waits at the lock until the first
        // has committed its run row, then sees it and skips. The lock is held
        // until COMMIT, which is what closes the window the old code left open.
        let mut tx = pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!("bill_template:{template_id}:{period}"))
            .execute(&mut *tx)
            .await?;
        let already: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM bill_template_run
                             WHERE template_id = $1
                               AND period = date_trunc('month', $2::date)::date)",
        )
        .bind(template_id)
        .bind(today)
        .fetch_one(&mut *tx)
        .await?;
        if already {
            tx.commit().await?;
            out.already_raised += 1;
            continue;
        }
        let bill = record_bill_draft(pool, &request, actor).await?;
        let inserted = sqlx::query(
            "INSERT INTO bill_template_run (template_id, period, invoice_id, raised_by)
             VALUES ($1, date_trunc('month', $2::date)::date, $3, $4)
             ON CONFLICT (template_id, period) DO NOTHING",
        )
        .bind(template_id)
        .bind(today)
        .bind(bill.invoice_id)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
        if inserted.rows_affected() == 0 {
            // A sweep that got past the lock some other way — an operator
            // running the old code, a restored row. Our draft is the duplicate
            // and goes, so the guard stays one-draft-per-period whatever
            // happens.
            sqlx::query(
                "DELETE FROM supplier_invoice WHERE invoice_id = $1 AND status = 'DRAFT'",
            )
            .bind(bill.invoice_id)
            .execute(&mut *tx)
            .await?;
            out.already_raised += 1;
        } else {
            out.raised += 1;
        }
        tx.commit().await?;
    }
    Ok(out)
}

fn last_day_of_month(today: NaiveDate) -> NaiveDate {
    let (year, month) = (today.year(), today.month());
    let next = NaiveDate::from_ymd_opt(year, month, 1)
        .expect("the current month's first day exists")
        .checked_add_months(chrono::Months::new(1))
        .expect("the next month exists");
    next.pred_opt().expect("the last day exists")
}

fn to_template(row: &sqlx::postgres::PgRow) -> BillTemplate {
    BillTemplate {
        template_id: row.get("template_id"),
        supplier_id: row.get("supplier_id"),
        supplier_name: row.get("supplier_name"),
        site_id: row.get("site_id"),
        expense_account_code: row.get("expense_account_code"),
        expense_category_code: row.get("expense_category_code"),
        expense_site_id: row.get("expense_site_id"),
        expected_subtotal_minor: row.get("expected_subtotal_minor"),
        expected_tax_minor: row.get("expected_tax_minor"),
        tolerance_bps: row.get("tolerance_bps"),
        due_day: row.get("due_day"),
        label: row.get("label"),
        note: row.get("note"),
        active: row.get("active"),
        contract_id: row.get("contract_id"),
        created_by: row.get("created_by"),
    }
}
