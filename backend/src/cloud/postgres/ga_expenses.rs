//! Operating expenses GA records: what a car, a genset or a shop burns (0974).
//!
//! # GA writes the event; Finance owns the money (owner, 17 Oct 2026)
//!
//! A fill-up is an event at a place, often for one asset: the date, the
//! odometer, the litres, the amount, who sold it, the receipt. GA writes that
//! down and hands it to Finance in one of two ways, never both:
//!
//! - **Submit**: GA files a DRAFT bill through `record_bill_draft`, the same
//!   writer every GA bill request uses. Finance posts and pays it.
//! - **Link**: Finance already made the transaction (a bill, or the BKK that
//!   paid it), so GA names it instead of drafting a second one.
//!
//! The row then reads Finance's status back. A cost that comes from a repair
//! or a service is billed from that work, not entered here a second time.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::cloud::application::AppError;

use super::{record_bill_draft, RecordBillLine, RecordBillRequest};

/// The kinds, each with the Finance role its account resolves through and the
/// word a screen shows.
pub const OPERATING_EXPENSE_KINDS: [(&str, &str, &str); 7] = [
    ("FUEL", "expense_fuel", "Fuel"),
    ("OIL", "expense_fuel", "Oil & lubricant"),
    ("TYRES_PARTS", "expense_tires", "Tyres & parts"),
    ("GENSET_FUEL", "expense_genset_fuel", "Genset fuel"),
    ("COMPUTER", "expense_computer", "Computer"),
    ("TOOLS", "expense_tools", "Tools"),
    ("OTHER", "miscellaneous_expense", "Other"),
];

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaOperatingExpenseRow {
    pub expense_id: Uuid,
    pub site_id: String,
    pub site_name: Option<String>,
    pub asset_id: Option<Uuid>,
    pub asset_name: Option<String>,
    /// `FUEL`, `OIL`, `TYRES_PARTS`, `GENSET_FUEL`, `COMPUTER`, `TOOLS`, `OTHER`.
    pub kind: String,
    pub spent_on: NaiveDate,
    pub description: String,
    /// "40" — litres, pieces; as text so a decimal survives the trip.
    pub quantity: Option<String>,
    pub unit: Option<String>,
    pub odometer_km: Option<i32>,
    pub amount_minor: i64,
    pub supplier_id: Option<Uuid>,
    pub supplier_name: Option<String>,
    pub receipt_number: Option<String>,
    /// `RECORDED`, `SUBMITTED` or `CANCELLED`.
    pub status: String,
    pub cancel_reason: Option<String>,
    /// The Finance side once submitted or linked — one of the two.
    pub invoice_id: Option<Uuid>,
    pub invoice_number: Option<String>,
    pub cash_document_id: Option<Uuid>,
    pub cash_document_number: Option<String>,
    /// Finance's own status of that transaction, read back: `DRAFT`, `POSTED`,
    /// `MATCHED` for a bill; the BKK's status for a cash document.
    pub finance_status: Option<String>,
    pub created_by: String,
    pub version: i32,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaOperatingExpensePage {
    pub rows: Vec<GaOperatingExpenseRow>,
    pub total: i64,
    /// Σ of the rows not cancelled, over the whole scope.
    pub amount_total_minor: i64,
}

#[derive(Clone, Debug, Default)]
pub struct GaOperatingExpenseScope {
    pub site_id: Option<String>,
    pub asset_id: Option<Uuid>,
    pub limit: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct RecordGaOperatingExpenseRequest {
    pub site_id: String,
    #[serde(default)]
    pub asset_id: Option<Uuid>,
    pub kind: String,
    pub spent_on: NaiveDate,
    pub description: String,
    /// "40" or "40,5" — Indonesian decimal comma accepted.
    #[serde(default)]
    pub quantity: Option<String>,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub odometer_km: Option<i32>,
    pub amount_minor: i64,
    #[serde(default)]
    pub supplier_id: Option<Uuid>,
    #[serde(default)]
    pub receipt_number: Option<String>,
}

/// Hand a recorded expense to Finance as a DRAFT bill.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct SubmitGaOperatingExpenseRequest {
    /// The seller's invoice/receipt number; the expense's own receipt number,
    /// or a GA reference, when left out.
    #[serde(default)]
    pub invoice_number: Option<String>,
    #[serde(default)]
    pub due_date: Option<NaiveDate>,
    /// Who sold it, for an expense recorded before anybody knew: a bill needs
    /// a seller, and this is the moment somebody says. Kept on the expense.
    /// Ignored when the expense already names one.
    #[serde(default)]
    pub supplier_id: Option<Uuid>,
}

/// Point a recorded expense at the bill or BKK Finance already made.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct LinkGaOperatingExpenseRequest {
    #[serde(default)]
    pub invoice_id: Option<Uuid>,
    #[serde(default)]
    pub cash_document_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CancelGaOperatingExpenseRequest {
    pub reason: String,
}

pub const DEFAULT_GA_EXPENSE_LIMIT: i64 = 200;
const MAX_GA_EXPENSE_LIMIT: i64 = 1000;

fn trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

const EXPENSE_SELECT: &str = "SELECT e.expense_id, e.site_id, st.name AS site_name, e.asset_id,
        a.name AS asset_name, e.kind, e.spent_on, e.description, e.quantity::text AS quantity,
        e.unit, e.odometer_km, e.amount_minor, e.supplier_id, sup.name AS supplier_name,
        e.receipt_number, e.status, e.cancel_reason, e.invoice_id, si.invoice_number,
        e.cash_document_id, cd.number AS cash_document_number,
        COALESCE(si.status, cd.status) AS finance_status, e.created_by, e.version
   FROM ga_operating_expense e
   LEFT JOIN site st ON st.id = e.site_id
   LEFT JOIN fixed_asset a ON a.asset_id = e.asset_id
   LEFT JOIN supplier sup ON sup.supplier_id = e.supplier_id
   LEFT JOIN supplier_invoice si ON si.invoice_id = e.invoice_id
   LEFT JOIN cash_document cd ON cd.document_id = e.cash_document_id";

fn to_expense(row: &sqlx::postgres::PgRow) -> Result<GaOperatingExpenseRow, AppError> {
    Ok(GaOperatingExpenseRow {
        expense_id: row.try_get("expense_id")?,
        site_id: row.try_get("site_id")?,
        site_name: row.try_get("site_name")?,
        asset_id: row.try_get("asset_id")?,
        asset_name: row.try_get("asset_name")?,
        kind: row.try_get("kind")?,
        spent_on: row.try_get("spent_on")?,
        description: row.try_get("description")?,
        quantity: row.try_get("quantity")?,
        unit: row.try_get("unit")?,
        odometer_km: row.try_get("odometer_km")?,
        amount_minor: row.try_get("amount_minor")?,
        supplier_id: row.try_get("supplier_id")?,
        supplier_name: row.try_get("supplier_name")?,
        receipt_number: row.try_get("receipt_number")?,
        status: row.try_get("status")?,
        cancel_reason: row.try_get("cancel_reason")?,
        invoice_id: row.try_get("invoice_id")?,
        invoice_number: row.try_get("invoice_number")?,
        cash_document_id: row.try_get("cash_document_id")?,
        cash_document_number: row.try_get("cash_document_number")?,
        finance_status: row.try_get("finance_status")?,
        created_by: row.try_get("created_by")?,
        version: row.try_get("version")?,
    })
}

/// The expenses of a site or an asset, newest first.
pub async fn ga_operating_expenses(
    pool: &PgPool,
    scope: &GaOperatingExpenseScope,
) -> Result<GaOperatingExpensePage, AppError> {
    let sql = format!(
        "{EXPENSE_SELECT}
          WHERE ($1::text IS NULL OR e.site_id = $1)
            AND ($2::uuid IS NULL OR e.asset_id = $2)
          ORDER BY e.spent_on DESC, e.created_at DESC, e.expense_id
          LIMIT $3"
    );
    let rows = sqlx::query(&sql)
        .bind(&scope.site_id)
        .bind(scope.asset_id)
        .bind(scope.limit.clamp(1, MAX_GA_EXPENSE_LIMIT))
        .fetch_all(pool)
        .await?;
    let out = rows.iter().map(to_expense).collect::<Result<Vec<_>, _>>()?;
    let totals = sqlx::query(
        "SELECT COUNT(*)::bigint AS n,
                COALESCE(SUM(amount_minor) FILTER (WHERE status <> 'CANCELLED'), 0)::bigint AS amount
           FROM ga_operating_expense
          WHERE ($1::text IS NULL OR site_id = $1)
            AND ($2::uuid IS NULL OR asset_id = $2)",
    )
    .bind(&scope.site_id)
    .bind(scope.asset_id)
    .fetch_one(pool)
    .await?;
    Ok(GaOperatingExpensePage {
        rows: out,
        total: totals.try_get("n")?,
        amount_total_minor: totals.try_get("amount")?,
    })
}

pub async fn ga_operating_expense(
    pool: &PgPool,
    expense_id: Uuid,
) -> Result<GaOperatingExpenseRow, AppError> {
    let sql = format!("{EXPENSE_SELECT} WHERE e.expense_id = $1");
    let row = sqlx::query(&sql)
        .bind(expense_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("operating expense".into()))?;
    to_expense(&row)
}

/// "40,5" or "40.5" or "40" → a decimal string Postgres reads; `None` for
/// blank. Thousands are not expected in a litre count.
fn quantity_of(raw: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(text) = trimmed(raw) else {
        return Ok(None);
    };
    let normal = text.replace(',', ".");
    match normal.parse::<f64>() {
        Ok(value) if value > 0.0 => Ok(Some(normal)),
        _ => Err(AppError::Validation(format!(
            "{text:?} is not a quantity; write it as a number, like 40 or 40,5"
        ))),
    }
}

pub async fn ga_operating_expense_record(
    pool: &PgPool,
    request: &RecordGaOperatingExpenseRequest,
    actor: &str,
) -> Result<GaOperatingExpenseRow, AppError> {
    let kind = request.kind.trim().to_ascii_uppercase();
    if !OPERATING_EXPENSE_KINDS
        .iter()
        .any(|(code, _, _)| *code == kind)
    {
        return Err(AppError::Validation(format!(
            "{kind} is not an operating expense kind; one of: {}",
            OPERATING_EXPENSE_KINDS
                .iter()
                .map(|(code, _, _)| *code)
                .collect::<Vec<_>>()
                .join(", ")
        )));
    }
    let description = trimmed(Some(&request.description))
        .ok_or_else(|| AppError::Validation("say what was bought".into()))?;
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "an expense has an amount above zero".into(),
        ));
    }
    let site_id = request.site_id.trim().to_string();
    if let Some(asset_id) = request.asset_id {
        // The asset must stand at the site the cost is booked to: fuel for the
        // DC's van is the DC's cost.
        let asset_site: Option<String> =
            sqlx::query_scalar("SELECT site_id FROM fixed_asset WHERE asset_id = $1")
                .bind(asset_id)
                .fetch_optional(pool)
                .await?;
        match asset_site {
            None => return Err(AppError::Validation("the asset does not exist".into())),
            Some(at) if at != site_id => {
                return Err(AppError::Validation(format!(
                    "the asset stands at {at}; book its cost there, not at {site_id}"
                )))
            }
            Some(_) => {}
        }
    }
    let quantity = quantity_of(request.quantity.as_deref())?;
    // A receipt that carries the odometer writes the car's reading with it
    // (0975), in one transaction: the reading belongs to the receipt.
    let reads_odometer = match (request.asset_id, request.odometer_km) {
        (Some(asset_id), Some(_)) => super::ga_odometer::asset_is_vehicle(pool, asset_id).await?,
        _ => false,
    };
    let mut tx = pool.begin().await?;
    let expense_id: Uuid = sqlx::query_scalar(
        "INSERT INTO ga_operating_expense
           (site_id, asset_id, kind, spent_on, description, quantity, unit, odometer_km,
            amount_minor, supplier_id, receipt_number, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10, $11, $12)
         RETURNING expense_id",
    )
    .bind(&site_id)
    .bind(request.asset_id)
    .bind(&kind)
    .bind(request.spent_on)
    .bind(&description)
    .bind(quantity)
    .bind(trimmed(request.unit.as_deref()))
    .bind(request.odometer_km)
    .bind(request.amount_minor)
    .bind(request.supplier_id)
    .bind(trimmed(request.receipt_number.as_deref()))
    .bind(actor)
    .fetch_one(&mut *tx)
    .await?;
    if let (true, Some(asset_id), Some(km)) =
        (reads_odometer, request.asset_id, request.odometer_km)
    {
        super::ga_odometer::write_odometer_reading(
            &mut tx,
            asset_id,
            request.spent_on,
            km,
            "EXPENSE",
            Some(expense_id),
            None,
            None,
            actor,
        )
        .await?;
    }
    tx.commit().await?;
    ga_operating_expense(pool, expense_id).await
}

/// File the expense as a DRAFT bill for Finance and point the row at it.
pub async fn ga_operating_expense_submit(
    pool: &PgPool,
    expense_id: Uuid,
    request: &SubmitGaOperatingExpenseRequest,
    actor: &str,
) -> Result<GaOperatingExpenseRow, AppError> {
    let row = ga_operating_expense(pool, expense_id).await?;
    if row.status != "RECORDED" {
        return Err(AppError::Conflict(format!(
            "the expense is {}; only a recorded one is handed to Finance",
            row.status
        )));
    }
    let supplier_id = row.supplier_id.or(request.supplier_id).ok_or_else(|| {
        AppError::Validation("say who sold it before handing the expense to Finance".into())
    })?;
    let role = OPERATING_EXPENSE_KINDS
        .iter()
        .find(|(code, _, _)| *code == row.kind)
        .map(|(_, role, _)| *role)
        .unwrap_or("miscellaneous_expense");
    let unit = super::sites::unit_of_site(pool, &row.site_id).await?;
    let account = super::resolve_account(pool, role, &unit, "")
        .await
        .map_err(|_| {
            AppError::Validation(format!(
                "Finance has not linked an account for {role} in the books of {unit}"
            ))
        })?;
    let invoice_number = trimmed(request.invoice_number.as_deref())
        .or_else(|| row.receipt_number.clone())
        .unwrap_or_else(|| {
            format!(
                "GA-OPX-{}-{}",
                row.spent_on.format("%y%m%d"),
                &expense_id.simple().to_string()[..6]
            )
        });
    let memo = match (&row.asset_name, row.odometer_km) {
        (Some(asset), Some(km)) => format!("{} · {asset} · {km} km", row.description),
        (Some(asset), None) => format!("{} · {asset}", row.description),
        _ => row.description.clone(),
    };
    let bill = RecordBillRequest {
        invoice_number,
        supplier_id: supplier_id.to_string(),
        supplier_name: row.supplier_name.clone(),
        site_id: row.site_id.clone(),
        invoice_date: row.spent_on,
        due_date: request.due_date,
        subtotal_minor: row.amount_minor,
        tax_minor: 0,
        discount_minor: 0,
        note: Some(format!("GA operating expense {expense_id}")),
        kind: Some("EXPENSE".into()),
        lines: Some(vec![RecordBillLine {
            account_code: account.account_code,
            site_id: row.site_id.clone(),
            amount_minor: row.amount_minor,
            category_code: None,
            asset_class_code: None,
            draws_reserve: false,
            // Never the asset: Finance reads a line's `asset_id` as the line
            // that BOUGHT it (0160, `check_acquisition_total`), so a tank of
            // fuel would count toward the van's cost. The expense row points
            // at the bill instead, and the memo names the asset.
            asset_id: None,
            contract_id: None,
            repair_id: None,
            replacement_id: None,
            supply_request_id: None,
            service_period_start: None,
            service_period_end: None,
            account_overridden: false,
            memo: Some(memo),
        }]),
        receipt_ids: None,
        matching: None,
        withholding_code: None,
        submitted_by_domain: Some("GA".into()),
        document_ref: None,
    };
    let drafted = record_bill_draft(pool, &bill, actor).await?;
    // Guarded on RECORDED with no Finance side: a second submit in the same
    // moment finds nothing to update and says so, rather than pointing the row
    // at a second draft.
    let updated = sqlx::query(
        "UPDATE ga_operating_expense
            SET status = 'SUBMITTED', invoice_id = $2, updated_by = $3, updated_at = now(),
                supplier_id = COALESCE(supplier_id, $4), version = version + 1
          WHERE expense_id = $1 AND status = 'RECORDED'
            AND invoice_id IS NULL AND cash_document_id IS NULL",
    )
    .bind(expense_id)
    .bind(drafted.invoice_id)
    .bind(actor)
    .bind(supplier_id)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "the expense was handed to Finance a moment ago; draft {} was not linked and can be returned in Finance",
            drafted.invoice_number
        )));
    }
    ga_operating_expense(pool, expense_id).await
}

/// Point the expense at the bill or BKK Finance already made.
pub async fn ga_operating_expense_link(
    pool: &PgPool,
    expense_id: Uuid,
    request: &LinkGaOperatingExpenseRequest,
    actor: &str,
) -> Result<GaOperatingExpenseRow, AppError> {
    match (request.invoice_id, request.cash_document_id) {
        (Some(_), Some(_)) | (None, None) => {
            return Err(AppError::Validation(
                "name either the bill or the BKK that paid it, one of the two".into(),
            ))
        }
        _ => {}
    }
    if let Some(invoice_id) = request.invoice_id {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM supplier_invoice WHERE invoice_id = $1)",
        )
        .bind(invoice_id)
        .fetch_one(pool)
        .await?;
        if !exists {
            return Err(AppError::Validation("there is no such bill".into()));
        }
    }
    if let Some(cash_document_id) = request.cash_document_id {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM cash_document WHERE document_id = $1)",
        )
        .bind(cash_document_id)
        .fetch_one(pool)
        .await?;
        if !exists {
            return Err(AppError::Validation(
                "there is no such cash document".into(),
            ));
        }
    }
    let updated = sqlx::query(
        "UPDATE ga_operating_expense
            SET status = 'SUBMITTED', invoice_id = $2, cash_document_id = $3,
                updated_by = $4, updated_at = now(), version = version + 1
          WHERE expense_id = $1 AND status = 'RECORDED'",
    )
    .bind(expense_id)
    .bind(request.invoice_id)
    .bind(request.cash_document_id)
    .bind(actor)
    .execute(pool)
    .await
    .map_err(|error| match error {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::Conflict("that Finance transaction already answers another GA expense".into())
        }
        other => AppError::from(other),
    })?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "only a recorded expense is linked; this one is already with Finance or cancelled"
                .into(),
        ));
    }
    ga_operating_expense(pool, expense_id).await
}

pub async fn ga_operating_expense_cancel(
    pool: &PgPool,
    expense_id: Uuid,
    request: &CancelGaOperatingExpenseRequest,
    actor: &str,
) -> Result<GaOperatingExpenseRow, AppError> {
    let reason = trimmed(Some(&request.reason))
        .ok_or_else(|| AppError::Validation("say why the expense is cancelled".into()))?;
    let mut tx = pool.begin().await?;
    let updated = sqlx::query(
        "UPDATE ga_operating_expense
            SET status = 'CANCELLED', cancel_reason = $2, updated_by = $3, updated_at = now(),
                version = version + 1
          WHERE expense_id = $1 AND status = 'RECORDED'",
    )
    .bind(expense_id)
    .bind(&reason)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "only an expense not yet with Finance can be cancelled; return the draft in Finance instead"
                .into(),
        ));
    }
    // The odometer reading the receipt carried goes with it (0975).
    sqlx::query("DELETE FROM ga_odometer_reading WHERE expense_id = $1")
        .bind(expense_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    ga_operating_expense(pool, expense_id).await
}
