//! Supplier bills: recording one, and posting it to the ledger.
//!
//! # What posting a bill actually does
//!
//! Debit inventory and input VAT, credit the supplier payable. That is the
//! whole entry, and it is worth saying what is NOT in it: nothing was posted
//! when the goods arrived. The client has no goods-received-not-invoiced
//! account, so a delivery moves stock in the warehouse and moves nothing in the
//! books, and both inventory and payables enter together here.
//!
//! The consequence is stated in 0052 and repeated because it matters at a month
//! end: stock that has arrived and not been billed is not on the balance sheet.
//! `unbilled_receipts` below is how somebody sees that exposure anyway.
//!
//! # Why the bill is a row before it is a journal
//!
//! Because a bill arrives, gets queried, gets held, and only then gets posted —
//! and during all of that it is a real document somebody has to be able to find.
//! Posting is a separate act with its own actor, and once done the amounts are
//! frozen by a trigger: the journal that quotes them cannot move, so neither can
//! they.

use super::poster::{post, PostingIntent, PostingLine};
use crate::cloud::application::AppError;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierBill {
    pub invoice_id: Uuid,
    pub invoice_number: String,
    pub supplier_id: String,
    pub supplier_name: Option<String>,
    pub site_id: String,
    pub invoice_date: NaiveDate,
    pub due_date: Option<NaiveDate>,
    pub currency: String,
    pub subtotal_minor: i64,
    pub tax_minor: i64,
    pub discount_minor: i64,
    pub total_minor: i64,
    pub status: String,
    pub journal_entry_id: Option<Uuid>,
    /// The entry number, so a list can name the journal without a second fetch.
    pub entry_number: Option<String>,
    pub recorded_by: String,
    pub recorded_at: DateTime<Utc>,
    pub posted_by: Option<String>,
    pub note: Option<String>,
    /// Days past due, negative when it is not due yet. Derived on read: a
    /// stored age would be wrong by morning.
    pub days_overdue: i32,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordBillRequest {
    pub invoice_number: String,
    pub supplier_id: String,
    pub supplier_name: Option<String>,
    pub site_id: String,
    pub invoice_date: NaiveDate,
    pub due_date: Option<NaiveDate>,
    pub subtotal_minor: i64,
    #[serde(default)]
    pub tax_minor: i64,
    #[serde(default)]
    pub discount_minor: i64,
    pub note: Option<String>,
}

/// A delivery nobody has billed for.
///
/// Not a journal and not a balance — there is no account for it. This is the
/// operational answer to "what is sitting in the warehouse that the books do
/// not know about", and it is the reason that gap is visible at all.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnbilledReceipt {
    pub receipt_id: Uuid,
    pub receipt_number: String,
    pub supplier_id: String,
    pub site_id: String,
    pub arrived_at: DateTime<Utc>,
    /// What the DC recorded off the paper that came with the goods, when it
    /// came with any. Evidence, not a bookable figure.
    pub invoice_number: Option<String>,
    pub invoice_total_minor: Option<i64>,
    /// Accepted quantity times the ordered price. What the delivery is worth if
    /// the supplier bills what was agreed.
    pub value_at_order_price_minor: i64,
    pub line_count: i64,
    pub days_waiting: i32,
}

const BILL_COLUMNS: &str = "i.invoice_id, i.invoice_number, i.supplier_id, i.supplier_name,
     i.site_id, i.invoice_date, i.due_date, i.currency, i.subtotal_minor, i.tax_minor,
     i.discount_minor, i.total_minor, i.status, i.journal_entry_id, i.recorded_by,
     i.recorded_at, i.posted_by, i.note,
     (SELECT e.entry_number FROM journal_entry e WHERE e.entry_id = i.journal_entry_id) AS entry_number,
     COALESCE((CURRENT_DATE - i.due_date), 0)::int AS days_overdue";

fn to_bill(row: &sqlx::postgres::PgRow) -> Result<SupplierBill, AppError> {
    Ok(SupplierBill {
        invoice_id: row.try_get("invoice_id")?,
        invoice_number: row.try_get("invoice_number")?,
        supplier_id: row.try_get("supplier_id")?,
        supplier_name: row.try_get("supplier_name")?,
        site_id: row.try_get("site_id")?,
        invoice_date: row.try_get("invoice_date")?,
        due_date: row.try_get("due_date")?,
        currency: row.try_get("currency")?,
        subtotal_minor: row.try_get("subtotal_minor")?,
        tax_minor: row.try_get("tax_minor")?,
        discount_minor: row.try_get("discount_minor")?,
        total_minor: row.try_get("total_minor")?,
        status: row.try_get("status")?,
        journal_entry_id: row.try_get("journal_entry_id")?,
        entry_number: row.try_get("entry_number")?,
        recorded_by: row.try_get("recorded_by")?,
        recorded_at: row.try_get("recorded_at")?,
        posted_by: row.try_get("posted_by")?,
        note: row.try_get("note")?,
        days_overdue: row.try_get("days_overdue")?,
    })
}

pub async fn list_bills(
    pool: &PgPool,
    status: Option<&str>,
    supplier_id: Option<&str>,
    limit: i64,
) -> Result<Vec<SupplierBill>, AppError> {
    let sql = format!(
        "SELECT {BILL_COLUMNS} FROM supplier_invoice i
          WHERE ($1::text IS NULL OR i.status = $1)
            AND ($2::text IS NULL OR i.supplier_id = $2)
          ORDER BY i.invoice_date DESC, i.invoice_number DESC
          LIMIT $3"
    );
    let rows = sqlx::query(&sql)
        .bind(status)
        .bind(supplier_id)
        .bind(limit.clamp(1, 500))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_bill).collect()
}

pub async fn bill(pool: &PgPool, invoice_id: Uuid) -> Result<SupplierBill, AppError> {
    let sql = format!("SELECT {BILL_COLUMNS} FROM supplier_invoice i WHERE i.invoice_id = $1");
    let row = sqlx::query(&sql)
        .bind(invoice_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("supplier bill".into()))?;
    to_bill(&row)
}

/// Record a bill. It is not in the books yet — posting is a separate act.
pub async fn record_bill(
    pool: &PgPool,
    request: &RecordBillRequest,
    actor: &str,
) -> Result<SupplierBill, AppError> {
    if request.invoice_number.trim().is_empty() {
        return Err(AppError::Validation("invoice_number is required".into()));
    }
    if request.subtotal_minor < 0 || request.tax_minor < 0 || request.discount_minor < 0 {
        return Err(AppError::Validation(
            "amounts cannot be negative; a credit is a separate document".into(),
        ));
    }
    let total = request.subtotal_minor + request.tax_minor - request.discount_minor;
    if total < 0 {
        return Err(AppError::Validation(
            "the discount is larger than the bill".into(),
        ));
    }

    let invoice_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO supplier_invoice
           (invoice_id, invoice_number, supplier_id, supplier_name, site_id, invoice_date,
            due_date, currency, subtotal_minor, tax_minor, discount_minor, total_minor,
            recorded_by, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'IDR',$8,$9,$10,$11,$12,$13)",
    )
    .bind(invoice_id)
    .bind(request.invoice_number.trim())
    .bind(request.supplier_id.trim())
    .bind(request.supplier_name.as_deref())
    .bind(&request.site_id)
    .bind(request.invoice_date)
    .bind(request.due_date)
    .bind(request.subtotal_minor)
    .bind(request.tax_minor)
    .bind(request.discount_minor)
    .bind(total)
    .bind(actor)
    .bind(request.note.as_deref())
    .execute(pool)
    .await?;

    bill(pool, invoice_id).await
}

/// Post a recorded bill to the ledger.
///
/// The bill row and the journal are written in one transaction, which is why
/// the poster takes a transaction it did not open. A bill marked posted with no
/// entry behind it, or an entry with no bill, are both states nobody could
/// explain afterwards.
pub async fn post_bill(
    pool: &PgPool,
    invoice_id: Uuid,
    posting_date: Option<NaiveDate>,
    actor: &str,
) -> Result<SupplierBill, AppError> {
    let existing = bill(pool, invoice_id).await?;
    if existing.status != "DRAFT" && existing.status != "MATCHED" {
        return Err(AppError::Conflict(format!(
            "bill {} is {}, not waiting to be posted",
            existing.invoice_number,
            existing.status.to_lowercase()
        )));
    }

    // Dr inventory (gross) + Dr input VAT / Cr payable (net of discount) +
    // Cr purchase discount.
    //
    // The discount is a CREDIT to `8010110003 Potongan Pembelian`, not a
    // smaller inventory figure. That is where the client keeps it: the account
    // sits under root 8, PENDAPATAN DAN (BIAYA) LAIN - LAIN, so they treat a
    // purchase discount as other income rather than as a cheaper cost of goods.
    // Netting it off inventory instead would balance just as well, report the
    // same profit, and quietly empty an account their own statements have a
    // line for.
    //
    // Debits are subtotal + tax; credits are (subtotal + tax - discount) +
    // discount. The same total, arrived at from both sides.
    let mut lines = vec![PostingLine::debit(
        "inventory",
        &existing.site_id,
        existing.subtotal_minor,
    )];
    if existing.tax_minor > 0 {
        lines.push(PostingLine::debit(
            "vat_in",
            &existing.site_id,
            existing.tax_minor,
        ));
    }
    lines.push(
        PostingLine::credit("trade_payable", &existing.site_id, existing.total_minor)
            .for_supplier(&existing.supplier_id),
    );
    if existing.discount_minor > 0 {
        lines.push(PostingLine::credit(
            "purchase_discount",
            &existing.site_id,
            existing.discount_minor,
        ));
    }

    let intent = PostingIntent {
        posting_date: posting_date.unwrap_or(existing.invoice_date),
        source_kind: "SUPPLIER_INVOICE".into(),
        source_id: Some(existing.invoice_id.to_string()),
        rule_version: "supplier_invoice/1".into(),
        currency: existing.currency.clone(),
        memo: Some(format!(
            "{} {}",
            existing.invoice_number,
            existing
                .supplier_name
                .as_deref()
                .unwrap_or(&existing.supplier_id)
        )),
        lines,
    };

    let mut tx = pool.begin().await?;
    let posted = post(&mut tx, &intent, actor).await?;
    sqlx::query(
        "UPDATE supplier_invoice
            SET status='POSTED', journal_entry_id=$2, posted_by=$3, posted_at=now()
          WHERE invoice_id=$1",
    )
    .bind(invoice_id)
    .bind(posted.entry_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    bill(pool, invoice_id).await
}

/// Deliveries with no bill against them, and what they are worth.
///
/// Valued at the ordered price times the accepted quantity, because that is
/// what the supplier has agreed to charge. It is an estimate of an exposure,
/// not a balance, and it is labelled as one wherever it is shown.
pub async fn unbilled_receipts(
    pool: &PgPool,
    limit: i64,
) -> Result<Vec<UnbilledReceipt>, AppError> {
    let rows = sqlx::query(
        "SELECT r.receipt_id, r.receipt_number, r.supplier_id, r.site_id, r.arrived_at,
                r.invoice_number, r.invoice_total_minor,
                COALESCE(SUM(rl.quantity * pl.unit_price_minor), 0)::bigint AS value_at_order_price,
                COUNT(rl.receipt_line_id)::bigint AS line_count,
                (CURRENT_DATE - r.arrived_at::date)::int AS days_waiting
           FROM goods_receipt r
           LEFT JOIN goods_receipt_line rl ON rl.receipt_id = r.receipt_id
           LEFT JOIN purchase_order_line pl ON pl.po_line_id = rl.po_line_id
          WHERE NOT EXISTS (
                    SELECT 1 FROM supplier_invoice_receipt sir
                     WHERE sir.receipt_id = r.receipt_id)
          GROUP BY r.receipt_id
          ORDER BY r.arrived_at
          LIMIT $1",
    )
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(UnbilledReceipt {
                receipt_id: row.try_get("receipt_id")?,
                receipt_number: row.try_get("receipt_number")?,
                supplier_id: row.try_get("supplier_id")?,
                site_id: row.try_get("site_id")?,
                arrived_at: row.try_get("arrived_at")?,
                invoice_number: row.try_get("invoice_number")?,
                invoice_total_minor: row.try_get("invoice_total_minor")?,
                value_at_order_price_minor: row.try_get("value_at_order_price")?,
                line_count: row.try_get("line_count")?,
                days_waiting: row.try_get("days_waiting")?,
            })
        })
        .collect()
}
