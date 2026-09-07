//! The rest of the payables flow: valuing a delivery, agreeing a bill against
//! it, taking part of it back, paying before it arrives, and keeping tax back
//! when it is paid for.
//!
//! # Why this is one module and not five
//!
//! Because it is one loop, and the accounts only make sense as a loop. A
//! delivery credits `supplier_suspend`; the bill that answers it debits the same
//! account and credits `trade_payable`; a credit note debits that back; an
//! advance sits in `advance_purchase` until a bill exists to set it against; and
//! the payment that finally settles the bill splits between the bank and the tax
//! office. Split across five files, the property that ties them — that every
//! account this lane opens is emptied again by the next document — would be five
//! people's business and nobody's.
//!
//! `payables.rs` still owns the bill itself and `payments.rs` the payment. This
//! module owns what happens around them, and each of those calls into it at
//! exactly one point: `post_bill` asks what a merchandise bill debits, and
//! `post_payment` asks what actually left the bank.
//!
//! # The valuation, stated as a limitation
//!
//! A receipt is valued at accepted quantity times the ORDERED unit price,
//! because nothing in this system records a cost. There is no landed cost, no
//! freight apportionment and no weighted average — so an inventory balance built
//! here is at order price, not at cost. When a cost exists, the source of the
//! figure changes in `receipt_post` and the difference goes where a price
//! variance already goes; no table and no rule below has to move.

use super::poster::{post, reverse, LineAccount, PostingIntent, PostingLine};
use crate::cloud::application::AppError;
use crate::cloud::domain::three_way::{
    match_bill_to_deliveries, LineFault, MatchLine, MatchTolerance,
};
use crate::cloud::domain::withholding;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// The liability a delivery raises before anybody has agreed a bill:
/// `2012001002 Hutang Supplier Barang Dagang - Suspend`.
const SUSPEND: &str = "supplier_suspend";
/// Where a bill that disagrees with the order puts the difference.
const VARIANCE: &str = "purchase_price_variance";
/// Money paid to a supplier before there is anything to owe them for.
const ADVANCE: &str = "advance_purchase";
/// The bank's own charge for making the transfer.
const BANK_CHARGE: &str = "bank_admin_fee";

// ---------------------------------------------------------------------------
// Two lanes this one has to meet, and does not build
// ---------------------------------------------------------------------------
//
// Both are being written in parallel by somebody else, and both would be
// half-built and wrong if this lane guessed at them. So each is one function
// here, called at the exact point it belongs, taking exactly the arguments its
// owner asked for, and returning `Ok(())`. When the lane lands, its author
// replaces one body and every call site is already correct and already in a
// transaction that will roll the whole document back if the call fails.
//
// Deliberately not traits, not events and not a table: a hook that had a shape
// of its own would be a shape the real lane then has to agree with.

/// Open or settle one line of the payment ledger.
///
/// TODO(lane-P): body. The Payment Ledger tracks what is owed to and by each
/// party, per account, so that "what do we owe this supplier" is a query
/// against one place rather than a sum over bills minus a sum over payments
/// minus a sum over credit notes minus a sum over advances.
///
/// The field shape, as its author specified it:
///
/// * `account_key`      — the meaning, e.g. `trade_payable`
/// * `qualifier`        — narrowing, empty when the meaning needs none
/// * `site_id`          — the location the item belongs to
/// * `party_type`       — `SUPPLIER` throughout this lane
/// * `party_id`         — the supplier
/// * `voucher_kind`     — the `source_kind` of the entry that caused it
/// * `voucher_id`       — that document's id
/// * `side`             — `CREDIT` opens a payable, `DEBIT` settles one
/// * `amount_minor`     — always positive; the side carries the direction
/// * `due_date`         — the bill's, and `None` on a document that has none
/// * `journal_entry_id` — the entry this item was raised by
///
/// A bill paid by a store manager out of their own pocket settles against
/// `store_manager_receivable` rather than a bank account. That is lane-P's
/// rule and not this lane's: the argument this module passes is what the
/// document says, and lane-P decides what the settlement faces.
#[allow(clippy::too_many_arguments)]
pub(super) async fn lane_p_payable_item(
    _tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    _account_key: &str,
    _qualifier: &str,
    _site_id: &str,
    _party_type: &str,
    _party_id: &str,
    _voucher_kind: &str,
    _voucher_id: Uuid,
    _side: &str,
    _amount_minor: i64,
    _due_date: Option<NaiveDate>,
    _journal_entry_id: Uuid,
) -> Result<(), AppError> {
    Ok(())
}

/// Open a cost layer for goods that have arrived.
///
/// TODO(lane-I): body. The Stock Ledger owns cost layers and valuation, and
/// this is the only place in this lane where one would be created.
///
/// The field shape, as its author specified it:
///
/// * `article_code`     — what arrived
/// * `quantity`         — stock units, the count the bay accepted
/// * `unit_cost_minor`  — the NET purchase price of one of them
/// * `economic_date`    — when the goods arrived, not when finance posted them
/// * `receipt_id`       — the delivery this layer came from
///
/// # The frozen policy, so this hook matches it
///
/// The layer carries the net purchase price: the purchase price less any
/// invoice discount, plus any later price correction. Freight and handling are
/// expensed and never enter a layer, and an invoice discount reduces the layer
/// rather than becoming other income.
///
/// At the moment this is called there is no bill yet, so `unit_cost_minor` is
/// the ordered unit price — which is also what the journal entry beside it
/// values the delivery at, so the ledger and the layers agree by construction.
/// The discount and any price correction arrive later, when the bill is matched
/// and posted, and adjusting a layer that already exists is lane-I's business:
/// it owns whether that is a revaluation of the remaining quantity or a
/// difference straight to cost of sales, and this lane must not pre-empt it.
pub(super) async fn lane_i_cost_layer(
    _tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    _article_code: &str,
    _quantity: i64,
    _unit_cost_minor: i64,
    _economic_date: NaiveDate,
    _receipt_id: Uuid,
) -> Result<(), AppError> {
    Ok(())
}

// ---------------------------------------------------------------------------
// Valuing a delivery
// ---------------------------------------------------------------------------

/// A delivery that has been valued into the ledger, or reversed out of it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReceiptPosting {
    pub receipt_id: Uuid,
    pub receipt_number: String,
    pub supplier_id: String,
    pub site_id: String,
    pub value_minor: i64,
    pub posting_date: NaiveDate,
    pub currency: String,
    pub journal_entry_id: Uuid,
    pub entry_number: String,
    pub posted_by: String,
    pub posted_at: DateTime<Utc>,
    pub reversal_entry_id: Option<Uuid>,
    pub reversal_entry_number: Option<String>,
    pub reversal_reason: Option<String>,
    pub reversed_by: Option<String>,
    pub reversed_at: Option<DateTime<Utc>>,
}

/// A delivery finance has not valued yet.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReceiptAwaitingPosting {
    pub receipt_id: Uuid,
    pub receipt_number: String,
    pub supplier_id: String,
    pub site_id: String,
    pub arrived_at: DateTime<Utc>,
    pub line_count: i64,
    /// Accepted quantity times the ordered price. What it will post for.
    pub value_at_order_price_minor: i64,
    pub days_waiting: i32,
}

const POSTING_COLUMNS: &str = "p.receipt_id, r.receipt_number, r.supplier_id, r.site_id,
     p.value_minor, p.posting_date, p.currency, p.journal_entry_id, p.posted_by, p.posted_at,
     p.reversal_entry_id, p.reversal_reason, p.reversed_by, p.reversed_at,
     (SELECT e.entry_number FROM journal_entry e WHERE e.entry_id = p.journal_entry_id)
         AS entry_number,
     (SELECT e.entry_number FROM journal_entry e WHERE e.entry_id = p.reversal_entry_id)
         AS reversal_entry_number";

fn to_posting(row: &sqlx::postgres::PgRow) -> Result<ReceiptPosting, AppError> {
    Ok(ReceiptPosting {
        receipt_id: row.try_get("receipt_id")?,
        receipt_number: row.try_get("receipt_number")?,
        supplier_id: row.try_get("supplier_id")?,
        site_id: row.try_get("site_id")?,
        value_minor: row.try_get("value_minor")?,
        posting_date: row.try_get("posting_date")?,
        currency: row.try_get("currency")?,
        journal_entry_id: row.try_get("journal_entry_id")?,
        entry_number: row.try_get("entry_number")?,
        posted_by: row.try_get("posted_by")?,
        posted_at: row.try_get("posted_at")?,
        reversal_entry_id: row.try_get("reversal_entry_id")?,
        reversal_entry_number: row.try_get("reversal_entry_number")?,
        reversal_reason: row.try_get("reversal_reason")?,
        reversed_by: row.try_get("reversed_by")?,
        reversed_at: row.try_get("reversed_at")?,
    })
}

/// What one delivery has done in the ledger, if anything.
pub async fn receipt_posting(
    pool: &PgPool,
    receipt_id: Uuid,
) -> Result<Option<ReceiptPosting>, AppError> {
    let sql = format!(
        "SELECT {POSTING_COLUMNS} FROM goods_receipt_posting p
           JOIN goods_receipt r USING (receipt_id)
          WHERE p.receipt_id = $1"
    );
    let row = sqlx::query(&sql)
        .bind(receipt_id)
        .fetch_optional(pool)
        .await?;
    row.as_ref().map(to_posting).transpose()
}

/// What a delivery is worth at the price that was ordered, and where it landed.
async fn receipt_value(
    pool: &PgPool,
    receipt_id: Uuid,
) -> Result<(String, String, String, i64), AppError> {
    let row = sqlx::query(
        "SELECT r.receipt_number, r.supplier_id, r.site_id,
                COALESCE(SUM(l.quantity * pl.unit_price_minor), 0)::bigint AS value_minor
           FROM goods_receipt r
           LEFT JOIN goods_receipt_line l ON l.receipt_id = r.receipt_id
           LEFT JOIN purchase_order_line pl ON pl.po_line_id = l.po_line_id
          WHERE r.receipt_id = $1
          GROUP BY r.receipt_id",
    )
    .bind(receipt_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("goods receipt".into()))?;
    Ok((
        row.try_get("receipt_number")?,
        row.try_get("supplier_id")?,
        row.try_get("site_id")?,
        row.try_get("value_minor")?,
    ))
}

/// Value a delivery into the ledger.
///
///     Dr inventory        at the receiving location
///     Cr supplier_suspend at the same location, carrying the supplier
///
/// The supplier is a dimension on the LINE rather than a qualifier on the
/// account, exactly as `trade_payable` does it. A qualifier would mean a row in
/// `account_map` per supplier and a posting that refuses the first time somebody
/// buys from a new one; `journal_line.supplier_id` already carries the
/// sub-ledger, and every ageing projection already reads it.
///
/// Idempotent because `goods_receipt_posting.receipt_id` is a primary key. The
/// read below exists so the refusal is a sentence rather than a unique
/// violation arriving as "database operation failed".
pub async fn receipt_post(
    pool: &PgPool,
    receipt_id: Uuid,
    posting_date: Option<NaiveDate>,
    actor: &str,
) -> Result<ReceiptPosting, AppError> {
    if let Some(existing) = receipt_posting(pool, receipt_id).await? {
        return Err(AppError::Conflict(format!(
            "delivery {} is already valued in the ledger by {}",
            existing.receipt_number, existing.entry_number
        )));
    }

    let (number, supplier_id, site_id, value) = receipt_value(pool, receipt_id).await?;
    if value <= 0 {
        return Err(AppError::Validation(format!(
            "delivery {number} is worth nothing at the ordered price; there is no entry to make \
             until it has lines against an order line that carries one"
        )));
    }

    let arrived: DateTime<Utc> =
        sqlx::query("SELECT arrived_at FROM goods_receipt WHERE receipt_id = $1")
            .bind(receipt_id)
            .fetch_one(pool)
            .await?
            .try_get("arrived_at")?;
    let date = posting_date.unwrap_or_else(|| arrived.date_naive());

    let intent = PostingIntent {
        posting_date: date,
        source_kind: "GOODS_RECEIPT".into(),
        source_id: Some(receipt_id.to_string()),
        rule_version: "goods_receipt/1".into(),
        currency: "IDR".into(),
        memo: Some(format!("{number} {supplier_id}")),
        lines: vec![
            PostingLine::debit("inventory", &site_id, value),
            PostingLine::credit(SUSPEND, &site_id, value).for_supplier(&supplier_id),
        ],
    };

    let mut tx = pool.begin().await?;
    // A delivery is valued once; re-valuing it is a reversal and a new entry.
    let posted = post(&mut tx, &intent, None, actor).await?;
    sqlx::query(
        "INSERT INTO goods_receipt_posting
           (receipt_id, journal_entry_id, value_minor, posting_date, currency, posted_by)
         VALUES ($1,$2,$3,$4,'IDR',$5)",
    )
    .bind(receipt_id)
    .bind(posted.entry_id)
    .bind(value)
    .bind(date)
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    // The layers, one per accepted line, in the same transaction as the entry
    // that values them. Inside rather than after, so a ledger that says the
    // stock is worth something and layers that say it is worth nothing cannot
    // both be committed.
    //
    // `arrived_at` and not `date`: a layer is consumed in the order the goods
    // turned up, and finance posting a September delivery in October must not
    // put it behind October's arrivals.
    let layers = sqlx::query(
        "SELECT pl.article_code, l.quantity, pl.unit_price_minor
           FROM goods_receipt_line l
           JOIN purchase_order_line pl ON pl.po_line_id = l.po_line_id
          WHERE l.receipt_id = $1
          ORDER BY pl.line_number",
    )
    .bind(receipt_id)
    .fetch_all(&mut *tx)
    .await?;
    for layer in &layers {
        lane_i_cost_layer(
            &mut tx,
            layer.try_get("article_code")?,
            layer.try_get("quantity")?,
            layer.try_get("unit_price_minor")?,
            arrived.date_naive(),
            receipt_id,
        )
        .await?;
    }

    tx.commit().await?;

    receipt_posting(pool, receipt_id)
        .await?
        .ok_or_else(|| AppError::NotFound("goods receipt posting".into()))
}

/// Undo the valuation, because the delivery was cancelled or posted in error.
///
/// A reversing entry rather than a deletion, for 0051's reason: the journal is
/// append-only, and a valuation that vanished would leave stock in the books
/// with nothing to explain how it got there. `poster::reverse` copies the
/// original lines' account codes rather than resolving their meanings afresh, so
/// a remapped account cannot send the mirror somewhere the original never went.
pub async fn receipt_reverse(
    pool: &PgPool,
    receipt_id: Uuid,
    posting_date: Option<NaiveDate>,
    reason: &str,
    actor: &str,
) -> Result<ReceiptPosting, AppError> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "say why the delivery is being un-valued; the reversal carries the reason into the \
             ledger"
                .into(),
        ));
    }
    let existing = receipt_posting(pool, receipt_id)
        .await?
        .ok_or_else(|| AppError::NotFound("goods receipt posting".into()))?;
    if existing.reversal_entry_id.is_some() {
        return Err(AppError::Conflict(format!(
            "delivery {} has already been un-valued",
            existing.receipt_number
        )));
    }
    if receipt_is_billed(pool, receipt_id).await? {
        return Err(AppError::Conflict(format!(
            "delivery {} is matched to a bill; unmatch the bill before un-valuing the delivery",
            existing.receipt_number
        )));
    }

    let date = posting_date.unwrap_or(existing.posting_date);
    let mut tx = pool.begin().await?;
    let mirror = reverse(&mut tx, existing.journal_entry_id, date, reason, actor).await?;
    sqlx::query(
        "UPDATE goods_receipt_posting
            SET reversal_entry_id=$2, reversal_reason=$3, reversed_by=$4, reversed_at=now()
          WHERE receipt_id=$1",
    )
    .bind(receipt_id)
    .bind(mirror.entry_id)
    .bind(reason)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    receipt_posting(pool, receipt_id)
        .await?
        .ok_or_else(|| AppError::NotFound("goods receipt posting".into()))
}

async fn receipt_is_billed(pool: &PgPool, receipt_id: Uuid) -> Result<bool, AppError> {
    let row = sqlx::query(
        "SELECT EXISTS (SELECT 1 FROM supplier_invoice_receipt WHERE receipt_id = $1) AS billed",
    )
    .bind(receipt_id)
    .fetch_one(pool)
    .await?;
    Ok(row.try_get("billed")?)
}

/// Deliveries that have arrived and are not in the books yet.
///
/// The queue finance works from and, until they work it, the measure of how much
/// stock the balance sheet is missing.
pub async fn receipts_awaiting_posting(
    pool: &PgPool,
    limit: i64,
) -> Result<Vec<ReceiptAwaitingPosting>, AppError> {
    let rows = sqlx::query(
        "SELECT r.receipt_id, r.receipt_number, r.supplier_id, r.site_id, r.arrived_at,
                COUNT(l.receipt_line_id)::bigint AS line_count,
                COALESCE(SUM(l.quantity * pl.unit_price_minor), 0)::bigint AS value_minor,
                (CURRENT_DATE - r.arrived_at::date)::int AS days_waiting
           FROM goods_receipt r
           LEFT JOIN goods_receipt_line l ON l.receipt_id = r.receipt_id
           LEFT JOIN purchase_order_line pl ON pl.po_line_id = l.po_line_id
          WHERE NOT EXISTS (SELECT 1 FROM goods_receipt_posting p
                             WHERE p.receipt_id = r.receipt_id)
          GROUP BY r.receipt_id
          ORDER BY r.arrived_at
          LIMIT $1",
    )
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(ReceiptAwaitingPosting {
                receipt_id: row.try_get("receipt_id")?,
                receipt_number: row.try_get("receipt_number")?,
                supplier_id: row.try_get("supplier_id")?,
                site_id: row.try_get("site_id")?,
                arrived_at: row.try_get("arrived_at")?,
                line_count: row.try_get("line_count")?,
                value_at_order_price_minor: row.try_get("value_minor")?,
                days_waiting: row.try_get("days_waiting")?,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Agreeing a bill against the deliveries it covers
// ---------------------------------------------------------------------------

/// One line of the supplier's bill, as somebody keys it off the paper.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BillMatchLine {
    /// The accepted delivery line this charge answers.
    pub receipt_line_id: Uuid,
    pub description: String,
    /// In stock units, the same unit the delivery counted in.
    pub quantity: i64,
    pub unit_price_minor: i64,
    #[serde(default)]
    pub tax_minor: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BillMatchRequest {
    /// The deliveries this bill covers. Every line must belong to one of them.
    pub receipt_ids: Vec<Uuid>,
    pub lines: Vec<BillMatchLine>,
    /// Whether the person matching accepts a price that is outside tolerance.
    /// It does nothing for a quantity above what was accepted, which is a fact
    /// rather than a decision.
    #[serde(default)]
    pub accept_variance: bool,
    /// Overrides the default tolerance, in basis points of the ordered price.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub tolerance_bp: Option<i64>,
}

/// What laying the bill beside the deliveries showed.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BillMatch {
    pub invoice_id: Uuid,
    pub invoice_number: String,
    pub status: String,
    pub receipt_numbers: Vec<String>,
    pub line_count: i64,
    /// What the bill charges for the deliveries.
    pub billed_value_minor: i64,
    /// What the same quantities are worth at the price that was ordered.
    pub ordered_value_minor: i64,
    /// What the deliveries were actually posted at. Equal to the ordered value
    /// unless a delivery was posted and then had lines added to it.
    pub suspend_value_minor: i64,
    /// Billed minus posted. Positive is a debit to purchase price variance.
    pub price_variance_minor: i64,
    /// Everything that disagreed, in the words somebody has to act on.
    pub disagreements: Vec<String>,
    pub matched_by: String,
}

fn fault_sentence(fault: &LineFault) -> String {
    match fault {
        LineFault::OverBilled {
            line_number,
            billed_quantity,
            accepted_quantity,
        } => format!(
            "line {line_number} bills {billed_quantity} and {accepted_quantity} were accepted; \
             the count at the bay was made by one person and verified by another, and it is what \
             the supplier is paid against"
        ),
        LineFault::PriceOutsideTolerance {
            line_number,
            billed_unit_price_minor,
            ordered_unit_price_minor,
            difference_bp,
        } => format!(
            "line {line_number} is billed at {billed_unit_price_minor} and was ordered at \
             {ordered_unit_price_minor} — {}%, outside tolerance",
            *difference_bp as f64 / 100.0
        ),
    }
}

/// Tie a bill to the deliveries it covers, line by line.
///
/// DRAFT -> MATCHED. The bill is not in the ledger yet: matching decides what
/// posting will do, and posting is still a separate act with its own actor, in
/// the same way a bill is recorded before it is posted.
///
/// Everything is written in one transaction. A bill marked MATCHED whose lines
/// did not survive, or lines against a bill that never changed status, are both
/// states nobody could explain afterwards.
pub async fn bill_match(
    pool: &PgPool,
    invoice_id: Uuid,
    request: &BillMatchRequest,
    actor: &str,
) -> Result<BillMatch, AppError> {
    if request.receipt_ids.is_empty() {
        return Err(AppError::Validation(
            "say which deliveries this bill covers; a bill that answers no delivery is a service \
             bill, and those post by their own path"
                .into(),
        ));
    }
    if request.lines.is_empty() {
        return Err(AppError::Validation(
            "say what the bill charges for, line by line; there is nothing to check otherwise"
                .into(),
        ));
    }

    let header = sqlx::query(
        "SELECT invoice_number, supplier_id, site_id, status, kind, subtotal_minor, currency
           FROM supplier_invoice WHERE invoice_id = $1",
    )
    .bind(invoice_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("supplier bill".into()))?;
    let invoice_number: String = header.try_get("invoice_number")?;
    let supplier_id: String = header.try_get("supplier_id")?;
    let site_id: String = header.try_get("site_id")?;
    let status: String = header.try_get("status")?;
    let kind: String = header.try_get("kind")?;
    let subtotal_minor: i64 = header.try_get("subtotal_minor")?;

    if kind != "MERCHANDISE" {
        return Err(AppError::Validation(format!(
            "bill {invoice_number} is an expense bill; what it debits is on its own lines, and \
             there is no delivery to match it to"
        )));
    }
    if status != "DRAFT" && status != "MATCHED" {
        return Err(AppError::Conflict(format!(
            "bill {invoice_number} is {}, and matching decides what posting will do",
            status.to_lowercase()
        )));
    }

    // Every delivery must be one this supplier made to this location, must be
    // valued, and must not already answer another bill. The unique index in
    // 0131 is the guarantee for the last of those; this is the sentence.
    let mut receipt_numbers = Vec::with_capacity(request.receipt_ids.len());
    let mut suspend_value: i64 = 0;
    for receipt_id in &request.receipt_ids {
        let row = sqlx::query(
            "SELECT r.receipt_number, r.supplier_id, r.site_id,
                    p.value_minor, p.reversal_entry_id,
                    (SELECT i.invoice_number FROM supplier_invoice_receipt sir
                       JOIN supplier_invoice i USING (invoice_id)
                      WHERE sir.receipt_id = r.receipt_id AND sir.invoice_id <> $2)
                        AS other_bill
               FROM goods_receipt r
               LEFT JOIN goods_receipt_posting p ON p.receipt_id = r.receipt_id
              WHERE r.receipt_id = $1",
        )
        .bind(receipt_id)
        .bind(invoice_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("goods receipt {receipt_id}")))?;

        let number: String = row.try_get("receipt_number")?;
        let their_supplier: String = row.try_get("supplier_id")?;
        let their_site: String = row.try_get("site_id")?;
        let value: Option<i64> = row.try_get("value_minor")?;
        let reversed: Option<Uuid> = row.try_get("reversal_entry_id")?;
        let other_bill: Option<String> = row.try_get("other_bill")?;

        if their_supplier != supplier_id {
            return Err(AppError::Validation(format!(
                "delivery {number} came from {their_supplier} and bill {invoice_number} is from \
                 {supplier_id}"
            )));
        }
        if their_site != site_id {
            return Err(AppError::Validation(format!(
                "delivery {number} arrived at {their_site} and bill {invoice_number} belongs to \
                 {site_id}"
            )));
        }
        if let Some(other) = other_bill {
            return Err(AppError::Conflict(format!(
                "delivery {number} is already billed by {other}"
            )));
        }
        match (value, reversed) {
            (None, _) => {
                return Err(AppError::Conflict(format!(
                    "delivery {number} is not in the ledger yet; value it first, or the bill will \
                     clear a suspense credit that was never made"
                )))
            }
            (Some(_), Some(_)) => {
                return Err(AppError::Conflict(format!(
                    "delivery {number} was un-valued; there is nothing on the suspend account for \
                     this bill to clear"
                )))
            }
            (Some(value), None) => suspend_value += value,
        }
        receipt_numbers.push(number);
    }

    // The join is the database's and the arithmetic is the kernel's.
    let mut match_lines = Vec::with_capacity(request.lines.len());
    for (index, line) in request.lines.iter().enumerate() {
        let number = index as i32 + 1;
        if line.quantity <= 0 || line.unit_price_minor < 0 || line.tax_minor < 0 {
            return Err(AppError::Validation(format!(
                "line {number} must be a positive quantity at a price that is not negative; a \
                 credit is its own document"
            )));
        }
        let row = sqlx::query(
            "SELECT l.quantity, l.po_line_id, pl.unit_price_minor, l.receipt_id
               FROM goods_receipt_line l
               JOIN purchase_order_line pl ON pl.po_line_id = l.po_line_id
              WHERE l.receipt_line_id = $1",
        )
        .bind(line.receipt_line_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| {
            AppError::Validation(format!(
                "line {number} names a delivery line that does not exist"
            ))
        })?;
        let receipt_id: Uuid = row.try_get("receipt_id")?;
        if !request.receipt_ids.contains(&receipt_id) {
            return Err(AppError::Validation(format!(
                "line {number} is against a delivery this bill does not say it covers"
            )));
        }
        match_lines.push((
            line,
            row.try_get::<Uuid, _>("po_line_id")?,
            MatchLine {
                line_number: number,
                billed_quantity: line.quantity,
                billed_unit_price_minor: line.unit_price_minor,
                accepted_quantity: row.try_get("quantity")?,
                ordered_unit_price_minor: row.try_get("unit_price_minor")?,
            },
        ));
    }

    let tolerance = match request.tolerance_bp {
        Some(bp) if bp >= 0 => MatchTolerance {
            unit_price_bp: bp,
            ..MatchTolerance::default()
        },
        Some(_) => {
            return Err(AppError::Validation(
                "a tolerance cannot be negative".into(),
            ))
        }
        None => MatchTolerance::default(),
    };
    let outcome = match_bill_to_deliveries(
        &match_lines.iter().map(|(_, _, m)| *m).collect::<Vec<_>>(),
        tolerance,
    );

    let refusals: Vec<&LineFault> = outcome
        .faults
        .iter()
        .filter(|fault| !(request.accept_variance && fault.is_acceptable()))
        .collect();
    if !refusals.is_empty() {
        let sentences: Vec<String> = refusals.iter().map(|f| fault_sentence(f)).collect();
        return Err(AppError::Validation(format!(
            "the bill does not agree with what arrived: {}{}",
            sentences.join("; "),
            if refusals.iter().all(|f| f.is_acceptable()) {
                ". Match again saying the variance is accepted if that is the price now agreed."
            } else {
                ""
            }
        )));
    }

    // A merchandise bill's whole goods value has to be against a delivery. A
    // freight charge or a pallet fee is not a delivery of stock and belongs on
    // an expense bill, where the person keying it names the account.
    if outcome.billed_value_minor != subtotal_minor {
        return Err(AppError::Validation(format!(
            "bill {invoice_number} says {subtotal_minor} before tax and its lines against the \
             deliveries total {}; record anything else — freight, a pallet charge — as an expense \
             bill, where the account is named",
            outcome.billed_value_minor
        )));
    }

    let variance = outcome.billed_value_minor - suspend_value;

    let mut tx = pool.begin().await?;
    // Written afresh each time, so re-matching after a correction is the same
    // act rather than an append nobody asked for.
    sqlx::query("DELETE FROM supplier_invoice_line WHERE invoice_id = $1")
        .bind(invoice_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM supplier_invoice_receipt WHERE invoice_id = $1")
        .bind(invoice_id)
        .execute(&mut *tx)
        .await?;
    for receipt_id in &request.receipt_ids {
        sqlx::query(
            "INSERT INTO supplier_invoice_receipt (invoice_id, receipt_id, matched_by)
             VALUES ($1,$2,$3)",
        )
        .bind(invoice_id)
        .bind(receipt_id)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
    }
    for (index, (line, po_line_id, matched)) in match_lines.iter().enumerate() {
        sqlx::query(
            "INSERT INTO supplier_invoice_line
               (invoice_line_id, invoice_id, line_number, po_line_id, receipt_line_id,
                description, quantity, unit_price_minor, line_amount_minor, tax_minor)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(Uuid::new_v4())
        .bind(invoice_id)
        .bind(index as i32 + 1)
        .bind(po_line_id)
        .bind(line.receipt_line_id)
        .bind(if line.description.trim().is_empty() {
            format!("line {}", index + 1)
        } else {
            line.description.trim().to_string()
        })
        .bind(matched.billed_quantity)
        .bind(matched.billed_unit_price_minor)
        .bind(matched.billed_quantity * matched.billed_unit_price_minor)
        .bind(line.tax_minor)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "UPDATE supplier_invoice
            SET status='MATCHED', matched_by=$2, matched_at=now(), price_variance_minor=$3
          WHERE invoice_id=$1",
    )
    .bind(invoice_id)
    .bind(actor)
    .bind(variance)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(BillMatch {
        invoice_id,
        invoice_number,
        status: "MATCHED".into(),
        receipt_numbers,
        line_count: request.lines.len() as i64,
        billed_value_minor: outcome.billed_value_minor,
        ordered_value_minor: outcome.ordered_value_minor,
        suspend_value_minor: suspend_value,
        price_variance_minor: variance,
        disagreements: outcome.faults.iter().map(fault_sentence).collect(),
        matched_by: actor.to_string(),
    })
}

/// What a merchandise bill debits when it posts.
///
/// The one place `payables::post_bill` reaches into this module. Two answers,
/// and which one applies is a fact about the bill rather than a setting:
///
///   * matched to deliveries — the goods are already in inventory, put there
///     when the delivery was valued, and the credit that paid for them is
///     sitting on `supplier_suspend`. So the bill DEBITS the suspend account,
///     emptying exactly what the deliveries filled, and the difference between
///     what was billed and what was posted goes to `purchase_price_variance`.
///   * matched to nothing — the delivery was never valued, or there was none.
///     The bill debits `inventory` as it always did, which is 0052's rule and
///     the only honest answer when nothing else has posted.
///
/// A bill and its deliveries therefore leave `2012001002` at zero, which is the
/// property that makes the account worth keeping: a balance on it at a month end
/// is deliveries nobody has billed, on the balance sheet, rather than a list
/// somebody has to remember to run.
pub async fn merchandise_debit_lines(
    pool: &PgPool,
    invoice_id: Uuid,
    site_id: &str,
    supplier_id: &str,
    subtotal_minor: i64,
    price_variance_minor: i64,
) -> Result<Vec<PostingLine>, AppError> {
    let row = sqlx::query(
        "SELECT COUNT(*)::bigint AS receipts,
                COUNT(p.receipt_id)::bigint AS valued,
                COALESCE(SUM(p.value_minor), 0)::bigint AS suspend_value
           FROM supplier_invoice_receipt sir
           LEFT JOIN goods_receipt_posting p
                  ON p.receipt_id = sir.receipt_id AND p.reversal_entry_id IS NULL
          WHERE sir.invoice_id = $1",
    )
    .bind(invoice_id)
    .fetch_one(pool)
    .await?;
    let receipts: i64 = row.try_get("receipts")?;
    let valued: i64 = row.try_get("valued")?;
    let suspend_value: i64 = row.try_get("suspend_value")?;

    if receipts == 0 {
        return Ok(vec![PostingLine::debit(
            "inventory",
            site_id,
            subtotal_minor,
        )]);
    }
    if valued != receipts {
        return Err(AppError::Conflict(
            "a delivery this bill covers is not in the ledger; value it before posting the bill, \
             or the bill will clear a suspense credit that was never made"
                .into(),
        ));
    }
    // The variance was decided at matching and frozen once the bill posts. If
    // the deliveries have moved since — a receipt re-posted, a price amended —
    // recomputing it here would post one figure and record another.
    if subtotal_minor - suspend_value != price_variance_minor {
        return Err(AppError::Conflict(format!(
            "the deliveries were valued at {suspend_value} and the bill was matched against a \
             variance of {price_variance_minor}; match it again before posting"
        )));
    }

    let mut lines =
        vec![PostingLine::debit(SUSPEND, site_id, suspend_value).for_supplier(supplier_id)];
    if price_variance_minor > 0 {
        lines.push(PostingLine::debit(VARIANCE, site_id, price_variance_minor));
    } else if price_variance_minor < 0 {
        lines.push(PostingLine::credit(
            VARIANCE,
            site_id,
            -price_variance_minor,
        ));
    }
    Ok(lines)
}

// ---------------------------------------------------------------------------
// Taking part of it back
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreditNote {
    pub credit_note_id: Uuid,
    pub credit_number: String,
    pub their_number: Option<String>,
    pub invoice_id: Uuid,
    pub invoice_number: String,
    pub supplier_id: String,
    pub site_id: String,
    pub credit_date: NaiveDate,
    pub reason: String,
    pub currency: String,
    pub subtotal_minor: i64,
    pub tax_minor: i64,
    pub total_minor: i64,
    pub credit_account_code: Option<String>,
    pub status: String,
    pub journal_entry_id: Option<Uuid>,
    pub entry_number: Option<String>,
    pub refund_entry_id: Option<Uuid>,
    pub refund_entry_number: Option<String>,
    pub refund_date: Option<NaiveDate>,
    pub note: Option<String>,
    pub recorded_by: String,
    pub recorded_at: DateTime<Utc>,
    pub posted_by: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreditNoteRequest {
    pub invoice_id: Uuid,
    pub credit_date: NaiveDate,
    /// `RETURN` or `PRICE_CORRECTION`.
    pub reason: String,
    pub subtotal_minor: i64,
    #[serde(default)]
    pub tax_minor: i64,
    /// The supplier's own number for the note, when they gave one.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub their_number: Option<String>,
    /// Which account the value goes back to, on a note against an expense bill.
    /// Refused on a merchandise note, where the answer is `inventory` by rule.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub credit_account_code: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreditNoteRefundRequest {
    /// One of `bank_giro`, `bank_savings`, `cash`, `petty_cash`.
    pub account_key: String,
    #[serde(default)]
    pub account_qualifier: String,
    pub refund_date: NaiveDate,
}

const CREDIT_NOTE_COLUMNS: &str = "n.credit_note_id, n.credit_number, n.their_number,
     n.invoice_id, i.invoice_number, n.supplier_id, n.site_id, n.credit_date, n.reason,
     n.currency, n.subtotal_minor, n.tax_minor, n.total_minor, n.credit_account_code,
     n.status, n.journal_entry_id, n.refund_entry_id, n.refund_date, n.note,
     n.recorded_by, n.recorded_at, n.posted_by,
     (SELECT e.entry_number FROM journal_entry e WHERE e.entry_id = n.journal_entry_id)
         AS entry_number,
     (SELECT e.entry_number FROM journal_entry e WHERE e.entry_id = n.refund_entry_id)
         AS refund_entry_number";

fn to_credit_note(row: &sqlx::postgres::PgRow) -> Result<CreditNote, AppError> {
    Ok(CreditNote {
        credit_note_id: row.try_get("credit_note_id")?,
        credit_number: row.try_get("credit_number")?,
        their_number: row.try_get("their_number")?,
        invoice_id: row.try_get("invoice_id")?,
        invoice_number: row.try_get("invoice_number")?,
        supplier_id: row.try_get("supplier_id")?,
        site_id: row.try_get("site_id")?,
        credit_date: row.try_get("credit_date")?,
        reason: row.try_get("reason")?,
        currency: row.try_get("currency")?,
        subtotal_minor: row.try_get("subtotal_minor")?,
        tax_minor: row.try_get("tax_minor")?,
        total_minor: row.try_get("total_minor")?,
        credit_account_code: row.try_get("credit_account_code")?,
        status: row.try_get("status")?,
        journal_entry_id: row.try_get("journal_entry_id")?,
        entry_number: row.try_get("entry_number")?,
        refund_entry_id: row.try_get("refund_entry_id")?,
        refund_entry_number: row.try_get("refund_entry_number")?,
        refund_date: row.try_get("refund_date")?,
        note: row.try_get("note")?,
        recorded_by: row.try_get("recorded_by")?,
        recorded_at: row.try_get("recorded_at")?,
        posted_by: row.try_get("posted_by")?,
    })
}

pub async fn credit_note(pool: &PgPool, credit_note_id: Uuid) -> Result<CreditNote, AppError> {
    let sql = format!(
        "SELECT {CREDIT_NOTE_COLUMNS} FROM supplier_credit_note n
           JOIN supplier_invoice i USING (invoice_id)
          WHERE n.credit_note_id = $1"
    );
    let row = sqlx::query(&sql)
        .bind(credit_note_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("credit note".into()))?;
    to_credit_note(&row)
}

pub async fn credit_notes(
    pool: &PgPool,
    invoice_id: Option<Uuid>,
    supplier_id: Option<&str>,
    status: Option<&str>,
    limit: i64,
) -> Result<Vec<CreditNote>, AppError> {
    let sql = format!(
        "SELECT {CREDIT_NOTE_COLUMNS} FROM supplier_credit_note n
           JOIN supplier_invoice i USING (invoice_id)
          WHERE ($1::uuid IS NULL OR n.invoice_id = $1)
            AND ($2::text IS NULL OR n.supplier_id = $2)
            AND ($3::text IS NULL OR n.status = $3)
          ORDER BY n.credit_date DESC, n.credit_number DESC
          LIMIT $4"
    );
    let rows = sqlx::query(&sql)
        .bind(invoice_id)
        .bind(supplier_id)
        .bind(status)
        .bind(limit.clamp(1, 500))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_credit_note).collect()
}

/// Record a credit note against a posted bill. Not in the books yet.
pub async fn credit_note_create(
    pool: &PgPool,
    request: &CreditNoteRequest,
    actor: &str,
) -> Result<CreditNote, AppError> {
    if request.subtotal_minor < 0 || request.tax_minor < 0 {
        return Err(AppError::Validation(
            "a credit note is written as positive money that moves the other way".into(),
        ));
    }
    let total = request.subtotal_minor + request.tax_minor;
    if total <= 0 {
        return Err(AppError::Validation(
            "a credit note for nothing is not a document".into(),
        ));
    }
    let reason = request.reason.trim().to_ascii_uppercase();
    if reason != "RETURN" && reason != "PRICE_CORRECTION" {
        return Err(AppError::Validation(format!(
            "'{reason}' is not a reason for a credit note; it is either RETURN — the goods went \
             back — or PRICE_CORRECTION"
        )));
    }

    let bill = sqlx::query(
        "SELECT invoice_number, supplier_id, site_id, currency, status, kind
           FROM supplier_invoice WHERE invoice_id = $1",
    )
    .bind(request.invoice_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("supplier bill".into()))?;
    let kind: String = bill.try_get("kind")?;

    // Which account the value goes back to. On a merchandise note the rule
    // knows — the goods came out of inventory — and on an expense note only the
    // person holding the paper does, exactly as when the bill was keyed.
    let account = request.credit_account_code.as_deref().map(str::trim);
    let account =
        match (kind.as_str(), account) {
            ("MERCHANDISE", Some(code)) if !code.is_empty() => {
                return Err(AppError::Validation(format!(
                "bill {} is for goods, so a credit note against it goes back to inventory by rule; \
                 naming {code} would be choosing where stock lives",
                bill.try_get::<String, _>("invoice_number")?
            )))
            }
            ("MERCHANDISE", _) => None,
            (_, Some(code)) if !code.is_empty() => {
                super::ledger::assert_postable(pool, code, super::ledger::Intent::Post).await?;
                Some(code.to_string())
            }
            _ => return Err(AppError::Validation(
                "say which account the credit goes back to; on an expense bill only the person \
                 holding the paper knows"
                    .into(),
            )),
        };

    let credit_note_id = Uuid::new_v4();
    let number: i64 = sqlx::query("SELECT nextval('supplier_credit_note_number_seq') AS n")
        .fetch_one(pool)
        .await?
        .try_get("n")?;

    sqlx::query(
        "INSERT INTO supplier_credit_note
           (credit_note_id, credit_number, their_number, invoice_id, supplier_id, site_id,
            credit_date, reason, currency, subtotal_minor, tax_minor, total_minor,
            credit_account_code, note, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
    )
    .bind(credit_note_id)
    .bind(format!("CN-{number:08}"))
    .bind(request.their_number.as_deref().map(str::trim))
    .bind(request.invoice_id)
    .bind(bill.try_get::<String, _>("supplier_id")?)
    .bind(bill.try_get::<String, _>("site_id")?)
    .bind(request.credit_date)
    .bind(&reason)
    .bind(bill.try_get::<String, _>("currency")?)
    .bind(request.subtotal_minor)
    .bind(request.tax_minor)
    .bind(total)
    .bind(account)
    .bind(request.note.as_deref())
    .bind(actor)
    .execute(pool)
    .await?;

    credit_note(pool, credit_note_id).await
}

/// Put the credit note in the ledger.
///
///     Dr trade_payable / non_merchandise_payable   the note's total
///     Cr inventory, or the account the note names  the goods or the cost
///     Cr vat_in                                    the tax that comes back
pub async fn credit_note_post(
    pool: &PgPool,
    credit_note_id: Uuid,
    posting_date: Option<NaiveDate>,
    actor: &str,
) -> Result<CreditNote, AppError> {
    let note = credit_note(pool, credit_note_id).await?;
    if note.status != "DRAFT" {
        return Err(AppError::Conflict(format!(
            "credit note {} is {}, not waiting to be posted",
            note.credit_number,
            note.status.to_lowercase()
        )));
    }
    let kind: String = sqlx::query("SELECT kind FROM supplier_invoice WHERE invoice_id = $1")
        .bind(note.invoice_id)
        .fetch_one(pool)
        .await?
        .try_get("kind")?;
    let expense = kind == "EXPENSE";

    let mut lines = vec![PostingLine::debit(
        if expense {
            "non_merchandise_payable"
        } else {
            "trade_payable"
        },
        &note.site_id,
        note.total_minor,
    )
    .for_supplier(&note.supplier_id)];
    if note.subtotal_minor > 0 {
        lines.push(match note.credit_account_code.as_deref() {
            Some(code) => PostingLine {
                account: LineAccount::Account {
                    account_code: code.to_string(),
                },
                site_id: note.site_id.clone(),
                counter_site_id: None,
                debit_minor: 0,
                credit_minor: note.subtotal_minor,
                supplier_id: None,
                memo: None,
            },
            None => PostingLine::credit("inventory", &note.site_id, note.subtotal_minor),
        });
    }
    if note.tax_minor > 0 {
        lines.push(PostingLine::credit("vat_in", &note.site_id, note.tax_minor));
    }

    let intent = PostingIntent {
        posting_date: posting_date.unwrap_or(note.credit_date),
        source_kind: "CREDIT_NOTE".into(),
        source_id: Some(credit_note_id.to_string()),
        rule_version: "credit_note/1".into(),
        currency: note.currency.clone(),
        memo: Some(format!(
            "{} against {}",
            note.credit_number, note.invoice_number
        )),
        lines,
    };

    let mut tx = pool.begin().await?;
    // The note itself. Refunding it posts again under the same document, which
    // is why that one names its step and this one is the main entry.
    let posted = post(&mut tx, &intent, None, actor).await?;
    sqlx::query(
        "UPDATE supplier_credit_note
            SET status='POSTED', journal_entry_id=$2, posted_by=$3, posted_at=now()
          WHERE credit_note_id=$1",
    )
    .bind(credit_note_id)
    .bind(posted.entry_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    // Part of what the bill opened is answered without any money moving.
    lane_p_payable_item(
        &mut tx,
        if expense {
            "non_merchandise_payable"
        } else {
            "trade_payable"
        },
        "",
        &note.site_id,
        "SUPPLIER",
        &note.supplier_id,
        "CREDIT_NOTE",
        credit_note_id,
        "DEBIT",
        note.total_minor,
        None,
        posted.entry_id,
    )
    .await?;
    tx.commit().await?;

    credit_note(pool, credit_note_id).await
}

/// The supplier sends the money back instead of letting the next bill absorb it.
///
///     Dr bank / Cr trade_payable
///
/// Its own act on its own date, because that is when the money moved. Folding it
/// into the note would be recording two events on one date and would leave the
/// bank reconciliation with a line that has no document.
pub async fn credit_note_refund(
    pool: &PgPool,
    credit_note_id: Uuid,
    request: &CreditNoteRefundRequest,
    actor: &str,
) -> Result<CreditNote, AppError> {
    let note = credit_note(pool, credit_note_id).await?;
    if note.status != "POSTED" {
        return Err(AppError::Conflict(format!(
            "credit note {} is {}; a note that is not in the ledger has nothing to refund",
            note.credit_number,
            note.status.to_lowercase()
        )));
    }
    let key = request.account_key.trim().to_ascii_lowercase();
    if !MONEY_KEYS.contains(&key.as_str()) {
        return Err(AppError::Validation(format!(
            "'{key}' is not an account money arrives in; expected one of {}",
            MONEY_KEYS.join(", ")
        )));
    }
    let qualifier = request.account_qualifier.trim();
    super::ledger::resolve_account(pool, &key, &note.site_id, qualifier).await?;

    let kind: String = sqlx::query("SELECT kind FROM supplier_invoice WHERE invoice_id = $1")
        .bind(note.invoice_id)
        .fetch_one(pool)
        .await?
        .try_get("kind")?;

    let intent = PostingIntent {
        posting_date: request.refund_date,
        source_kind: "CREDIT_NOTE".into(),
        source_id: Some(credit_note_id.to_string()),
        rule_version: "credit_note_refund/1".into(),
        currency: note.currency.clone(),
        memo: Some(format!("{} refunded", note.credit_number)),
        lines: vec![
            PostingLine::debit(&key, &note.site_id, note.total_minor).with_qualifier(qualifier),
            PostingLine::credit(
                if kind == "EXPENSE" {
                    "non_merchandise_payable"
                } else {
                    "trade_payable"
                },
                &note.site_id,
                note.total_minor,
            )
            .for_supplier(&note.supplier_id),
        ],
    };

    let mut tx = pool.begin().await?;
    // The second moment of one document: the note was posted, and now the money
    // comes back. See 0140 for why each moment names itself.
    let posted = post(&mut tx, &intent, Some("REFUNDED"), actor).await?;
    sqlx::query(
        "UPDATE supplier_credit_note
            SET status='REFUNDED', refund_entry_id=$2, refund_date=$3, refunded_by=$4,
                refunded_at=now(), refund_account_key=$5, refund_account_qualifier=$6
          WHERE credit_note_id=$1",
    )
    .bind(credit_note_id)
    .bind(posted.entry_id)
    .bind(request.refund_date)
    .bind(actor)
    .bind(&key)
    .bind(qualifier)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    credit_note(pool, credit_note_id).await
}

// ---------------------------------------------------------------------------
// Money paid before the goods
// ---------------------------------------------------------------------------

const MONEY_KEYS: [&str; 4] = ["bank_giro", "bank_savings", "cash", "petty_cash"];

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierAdvance {
    pub advance_id: Uuid,
    pub advance_number: String,
    pub supplier_id: String,
    pub site_id: String,
    pub purchase_order_id: Uuid,
    pub po_number: String,
    pub advance_date: NaiveDate,
    pub currency: String,
    pub amount_minor: i64,
    /// What has been set against bills so far.
    pub applied_minor: i64,
    /// Still sitting in `1011303002 Advanced - Purchase`.
    pub outstanding_minor: i64,
    pub account_key: String,
    pub account_qualifier: String,
    pub status: String,
    pub journal_entry_id: Option<Uuid>,
    pub entry_number: Option<String>,
    pub reference: Option<String>,
    pub note: Option<String>,
    pub recorded_by: String,
    pub recorded_at: DateTime<Utc>,
    pub posted_by: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierAdvanceRequest {
    pub purchase_order_id: Uuid,
    pub site_id: String,
    pub advance_date: NaiveDate,
    pub amount_minor: i64,
    /// One of `bank_giro`, `bank_savings`, `cash`, `petty_cash`.
    pub account_key: String,
    #[serde(default)]
    pub account_qualifier: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub reference: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierAdvanceApplyRequest {
    pub invoice_id: Uuid,
    pub amount_minor: i64,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub posting_date: Option<NaiveDate>,
}

const ADVANCE_COLUMNS: &str = "a.advance_id, a.advance_number, a.supplier_id, a.site_id,
     a.purchase_order_id, o.po_number, a.advance_date, a.currency, a.amount_minor,
     a.account_key, a.account_qualifier, a.status, a.journal_entry_id, a.reference, a.note,
     a.recorded_by, a.recorded_at, a.posted_by,
     (SELECT e.entry_number FROM journal_entry e WHERE e.entry_id = a.journal_entry_id)
         AS entry_number,
     COALESCE((SELECT SUM(ap.amount_minor) FROM supplier_advance_application ap
                WHERE ap.advance_id = a.advance_id), 0)::bigint AS applied_minor";

fn to_advance(row: &sqlx::postgres::PgRow) -> Result<SupplierAdvance, AppError> {
    let amount_minor: i64 = row.try_get("amount_minor")?;
    let applied_minor: i64 = row.try_get("applied_minor")?;
    Ok(SupplierAdvance {
        advance_id: row.try_get("advance_id")?,
        advance_number: row.try_get("advance_number")?,
        supplier_id: row.try_get("supplier_id")?,
        site_id: row.try_get("site_id")?,
        purchase_order_id: row.try_get("purchase_order_id")?,
        po_number: row.try_get("po_number")?,
        advance_date: row.try_get("advance_date")?,
        currency: row.try_get("currency")?,
        amount_minor,
        applied_minor,
        outstanding_minor: amount_minor - applied_minor,
        account_key: row.try_get("account_key")?,
        account_qualifier: row.try_get("account_qualifier")?,
        status: row.try_get("status")?,
        journal_entry_id: row.try_get("journal_entry_id")?,
        entry_number: row.try_get("entry_number")?,
        reference: row.try_get("reference")?,
        note: row.try_get("note")?,
        recorded_by: row.try_get("recorded_by")?,
        recorded_at: row.try_get("recorded_at")?,
        posted_by: row.try_get("posted_by")?,
    })
}

pub async fn supplier_advance(
    pool: &PgPool,
    advance_id: Uuid,
) -> Result<SupplierAdvance, AppError> {
    let sql = format!(
        "SELECT {ADVANCE_COLUMNS} FROM supplier_advance a
           JOIN purchase_order o USING (purchase_order_id)
          WHERE a.advance_id = $1"
    );
    let row = sqlx::query(&sql)
        .bind(advance_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("supplier advance".into()))?;
    to_advance(&row)
}

/// Advances with money still in them, oldest first. What the `1011303002`
/// balance is made of.
pub async fn supplier_advances_outstanding(
    pool: &PgPool,
    supplier_id: Option<&str>,
    limit: i64,
) -> Result<Vec<SupplierAdvance>, AppError> {
    let sql = format!(
        "SELECT {ADVANCE_COLUMNS} FROM supplier_advance a
           JOIN purchase_order o USING (purchase_order_id)
          WHERE a.status = 'POSTED'
            AND ($1::text IS NULL OR a.supplier_id = $1)
            AND a.amount_minor > COALESCE((SELECT SUM(ap.amount_minor)
                                             FROM supplier_advance_application ap
                                            WHERE ap.advance_id = a.advance_id), 0)
          ORDER BY a.advance_date, a.advance_number
          LIMIT $2"
    );
    let rows = sqlx::query(&sql)
        .bind(supplier_id)
        .bind(limit.clamp(1, 500))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_advance).collect()
}

/// Record an advance against an order. Not in the books yet.
pub async fn supplier_advance_issue(
    pool: &PgPool,
    request: &SupplierAdvanceRequest,
    actor: &str,
) -> Result<SupplierAdvance, AppError> {
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "an advance is money that leaves; it cannot be zero or negative".into(),
        ));
    }
    let key = request.account_key.trim().to_ascii_lowercase();
    if !MONEY_KEYS.contains(&key.as_str()) {
        return Err(AppError::Validation(format!(
            "'{key}' is not an account money leaves from; expected one of {}",
            MONEY_KEYS.join(", ")
        )));
    }
    let supplier_id: String =
        sqlx::query("SELECT supplier_id FROM purchase_order WHERE purchase_order_id = $1")
            .bind(request.purchase_order_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound("purchase order".into()))?
            .try_get("supplier_id")?;

    let qualifier = request.account_qualifier.trim();
    // Checked here as well as by the composite foreign key, for the reason
    // `record_payment` gives: a foreign-key violation reaches a person as
    // "database operation failed" and names neither the key nor the location.
    super::ledger::resolve_account(pool, &key, &request.site_id, qualifier).await?;

    let advance_id = Uuid::new_v4();
    let number: i64 = sqlx::query("SELECT nextval('supplier_advance_number_seq') AS n")
        .fetch_one(pool)
        .await?
        .try_get("n")?;
    sqlx::query(
        "INSERT INTO supplier_advance
           (advance_id, advance_number, supplier_id, site_id, purchase_order_id, advance_date,
            currency, amount_minor, account_key, account_qualifier, reference, note, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,'IDR',$7,$8,$9,$10,$11,$12)",
    )
    .bind(advance_id)
    .bind(format!("AV-{number:08}"))
    .bind(&supplier_id)
    .bind(&request.site_id)
    .bind(request.purchase_order_id)
    .bind(request.advance_date)
    .bind(request.amount_minor)
    .bind(&key)
    .bind(qualifier)
    .bind(request.reference.as_deref())
    .bind(request.note.as_deref())
    .bind(actor)
    .execute(pool)
    .await?;

    supplier_advance(pool, advance_id).await
}

/// Put the advance in the ledger: `Dr advance_purchase / Cr bank`.
pub async fn supplier_advance_post(
    pool: &PgPool,
    advance_id: Uuid,
    posting_date: Option<NaiveDate>,
    actor: &str,
) -> Result<SupplierAdvance, AppError> {
    let advance = supplier_advance(pool, advance_id).await?;
    if advance.status != "DRAFT" {
        return Err(AppError::Conflict(format!(
            "advance {} is {}, not waiting to be posted",
            advance.advance_number,
            advance.status.to_lowercase()
        )));
    }

    let intent = PostingIntent {
        posting_date: posting_date.unwrap_or(advance.advance_date),
        source_kind: "SUPPLIER_ADVANCE".into(),
        source_id: Some(advance_id.to_string()),
        rule_version: "supplier_advance/1".into(),
        currency: advance.currency.clone(),
        memo: Some(format!(
            "{} {} against {}",
            advance.advance_number, advance.supplier_id, advance.po_number
        )),
        lines: vec![
            PostingLine::debit(ADVANCE, &advance.site_id, advance.amount_minor)
                .for_supplier(&advance.supplier_id),
            PostingLine::credit(&advance.account_key, &advance.site_id, advance.amount_minor)
                .with_qualifier(&advance.account_qualifier),
        ],
    };

    let mut tx = pool.begin().await?;
    // Paying the advance. Setting it against a bill posts again under the same
    // document, so this one is the main entry and that one names its bill.
    let posted = post(&mut tx, &intent, None, actor).await?;
    sqlx::query(
        "UPDATE supplier_advance
            SET status='POSTED', journal_entry_id=$2, posted_by=$3, posted_at=now()
          WHERE advance_id=$1",
    )
    .bind(advance_id)
    .bind(posted.entry_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    supplier_advance(pool, advance_id).await
}

/// Set an advance against a bill: `Dr trade_payable / Cr advance_purchase`.
///
/// Its own act on its own date because that is when the debt it answers came
/// into existence. An advance consumed at the moment a bill posted could not be
/// split across the two bills a large order arrives on.
pub async fn supplier_advance_apply(
    pool: &PgPool,
    advance_id: Uuid,
    request: &SupplierAdvanceApplyRequest,
    actor: &str,
) -> Result<SupplierAdvance, AppError> {
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "set a positive amount against the bill".into(),
        ));
    }
    let advance = supplier_advance(pool, advance_id).await?;
    let bill = sqlx::query(
        "SELECT invoice_number, kind, invoice_date FROM supplier_invoice WHERE invoice_id = $1",
    )
    .bind(request.invoice_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("supplier bill".into()))?;
    let invoice_number: String = bill.try_get("invoice_number")?;
    let kind: String = bill.try_get("kind")?;
    let invoice_date: NaiveDate = bill.try_get("invoice_date")?;

    let intent = PostingIntent {
        posting_date: request.posting_date.unwrap_or(invoice_date),
        source_kind: "SUPPLIER_ADVANCE".into(),
        source_id: Some(advance_id.to_string()),
        rule_version: "supplier_advance_applied/1".into(),
        currency: advance.currency.clone(),
        memo: Some(format!(
            "{} set against {}",
            advance.advance_number, invoice_number
        )),
        lines: vec![
            PostingLine::debit(
                if kind == "EXPENSE" {
                    "non_merchandise_payable"
                } else {
                    "trade_payable"
                },
                &advance.site_id,
                request.amount_minor,
            )
            .for_supplier(&advance.supplier_id),
            PostingLine::credit(ADVANCE, &advance.site_id, request.amount_minor)
                .for_supplier(&advance.supplier_id),
        ],
    };

    let mut tx = pool.begin().await?;
    // One advance, one bill, one entry. The advance itself posted as MAIN and
    // an advance may answer several bills, so the step is named for the bill it
    // answers — which is also the key of `supplier_advance_application`.
    let posted = post(
        &mut tx,
        &intent,
        Some(&format!(
            "APPLIED_{}",
            request.invoice_id.simple().to_string().to_uppercase()
        )),
        actor,
    )
    .await?;
    // The trigger in 0133 decides whether this fits — the advance, the bill,
    // the supplier, the location and the currency all have to agree, and the
    // refusal it raises names which of them did not.
    sqlx::query(
        "INSERT INTO supplier_advance_application
           (advance_id, invoice_id, amount_minor, journal_entry_id, applied_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (advance_id, invoice_id) DO UPDATE
            SET amount_minor = supplier_advance_application.amount_minor + EXCLUDED.amount_minor",
    )
    .bind(advance_id)
    .bind(request.invoice_id)
    .bind(request.amount_minor)
    .bind(posted.entry_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    // Money that left the bank weeks ago answers part of a debt that exists
    // today. The item settles against the bill, not against the bank: the bank
    // was answered when the advance was posted.
    lane_p_payable_item(
        &mut tx,
        if kind == "EXPENSE" {
            "non_merchandise_payable"
        } else {
            "trade_payable"
        },
        "",
        &advance.site_id,
        "SUPPLIER",
        &advance.supplier_id,
        "SUPPLIER_ADVANCE",
        advance_id,
        "DEBIT",
        request.amount_minor,
        None,
        posted.entry_id,
    )
    .await?;
    tx.commit().await?;

    supplier_advance(pool, advance_id).await
}

// ---------------------------------------------------------------------------
// Tax kept back at the bank
// ---------------------------------------------------------------------------

/// What a payment will actually move, once the tax office has had its share.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentDeductions {
    pub payment_id: Uuid,
    pub payment_number: String,
    /// The debt being settled: the sum of the allocations, unchanged.
    pub total_minor: i64,
    pub withholding_minor: i64,
    /// `pph23_payable` or `pph_final_payable`, or nothing when none was kept.
    pub withholding_key: Option<String>,
    pub bank_charge_minor: i64,
    /// `total_minor - withholding_minor + bank_charge_minor`.
    pub leaving_the_bank_minor: i64,
    /// One sentence per bill that was withheld from, for the certificate.
    pub explanation: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentWithholdRequest {
    /// The bank's own charge for the transfer, when it comes out of the same
    /// movement. Zero by default, which is 0084's case unchanged.
    #[serde(default)]
    pub bank_charge_minor: i64,
}

/// Work out what this payment keeps back, and record it.
///
/// A separate act on a DRAFT payment rather than a change to `record_payment`:
/// the person keying what left the bank and the person who knows the vendor is
/// a PPh 23 vendor are not always the same, and the second one should not have
/// to re-key the first one's work.
///
/// The rate comes off the BILL — it follows what was bought — and the
/// arithmetic is `domain::withholding`, which is on `kernel_purity`'s list
/// because the figure is remitted to a tax authority in somebody's name.
pub async fn payment_withhold(
    pool: &PgPool,
    payment_id: Uuid,
    request: &PaymentWithholdRequest,
    actor: &str,
) -> Result<PaymentDeductions, AppError> {
    if request.bank_charge_minor < 0 {
        return Err(AppError::Validation(
            "a bank charge is money that leaves; it cannot be negative".into(),
        ));
    }
    let header = sqlx::query(
        "SELECT payment_number, status, total_minor FROM supplier_payment WHERE payment_id = $1",
    )
    .bind(payment_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("supplier payment".into()))?;
    let payment_number: String = header.try_get("payment_number")?;
    let status: String = header.try_get("status")?;
    let total_minor: i64 = header.try_get("total_minor")?;
    if status != "DRAFT" {
        return Err(AppError::Conflict(format!(
            "payment {payment_number} is posted; what was withheld is in the ledger and cannot be \
             re-decided"
        )));
    }

    // Every bill this payment answers, with what it is for, what has already
    // been paid against it and what has already been withheld from it.
    let rows = sqlx::query(
        "SELECT i.invoice_number, i.withholding_code, i.subtotal_minor, i.total_minor,
                al.amount_minor,
                COALESCE((SELECT SUM(o.amount_minor)
                            FROM supplier_payment_allocation o
                            JOIN supplier_payment p USING (payment_id)
                           WHERE o.invoice_id = al.invoice_id AND p.status = 'POSTED'), 0)::bigint
                    AS paid_before,
                COALESCE((SELECT SUM(p.withholding_minor)
                            FROM supplier_payment_allocation o
                            JOIN supplier_payment p USING (payment_id)
                           WHERE o.invoice_id = al.invoice_id AND p.status = 'POSTED'), 0)::bigint
                    AS withheld_before
           FROM supplier_payment_allocation al
           JOIN supplier_invoice i USING (invoice_id)
          WHERE al.payment_id = $1
          ORDER BY i.invoice_number",
    )
    .bind(payment_id)
    .fetch_all(pool)
    .await?;

    let mut withheld_total: i64 = 0;
    let mut key: Option<String> = None;
    let mut explanation = Vec::new();
    for row in &rows {
        let code: Option<String> = row.try_get("withholding_code")?;
        let Some(code) = code else { continue };
        let invoice_number: String = row.try_get("invoice_number")?;
        let category = withholding::category(&code).ok_or_else(|| {
            AppError::Validation(format!(
                "bill {invoice_number} names withholding {code}, which this system does not compute"
            ))
        })?;
        let withheld = withholding::withholding_on_payment(
            category.rate_bp,
            row.try_get("subtotal_minor")?,
            row.try_get("total_minor")?,
            row.try_get("paid_before")?,
            row.try_get("amount_minor")?,
            row.try_get("withheld_before")?,
        );
        if withheld == 0 {
            continue;
        }
        // One payment, one tax account. A transfer settling a rent bill and a
        // security bill at once would need two credits to two different
        // payables, and 0133 gives the payment one column to name them with.
        // Refusing is honest; splitting them silently would put a final tax in
        // a creditable account, where it would be claimed back a year later.
        match &key {
            Some(existing) if existing != category.payable_key => {
                return Err(AppError::Validation(format!(
                    "this payment settles bills withheld under two different taxes ({existing} and \
                     {}); pay them separately so each certificate names one",
                    category.payable_key
                )))
            }
            _ => key = Some(category.payable_key.to_string()),
        }
        withheld_total += withheld;
        explanation.push(format!(
            "{invoice_number}: {withheld} at {}",
            category.label
        ));
    }

    if withheld_total >= total_minor {
        return Err(AppError::Validation(format!(
            "the tax on payment {payment_number} comes to {withheld_total} and the payment is \
             {total_minor}; nothing would reach the supplier"
        )));
    }

    sqlx::query(
        "UPDATE supplier_payment
            SET withholding_minor=$2, withholding_key=$3, bank_charge_minor=$4,
                note = COALESCE(note, '') ||
                       CASE WHEN $2 > 0
                            THEN E'\\nwithholding decided by ' || $5 ELSE '' END
          WHERE payment_id=$1",
    )
    .bind(payment_id)
    .bind(withheld_total)
    .bind(if withheld_total > 0 {
        key.clone()
    } else {
        None
    })
    .bind(request.bank_charge_minor)
    .bind(actor)
    .execute(pool)
    .await?;

    payment_deductions(pool, payment_id).await
}

/// What a payment will move, read back.
pub async fn payment_deductions(
    pool: &PgPool,
    payment_id: Uuid,
) -> Result<PaymentDeductions, AppError> {
    let row = sqlx::query(
        "SELECT payment_number, total_minor, withholding_minor, withholding_key,
                bank_charge_minor
           FROM supplier_payment WHERE payment_id = $1",
    )
    .bind(payment_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("supplier payment".into()))?;
    let total_minor: i64 = row.try_get("total_minor")?;
    let withholding_minor: i64 = row.try_get("withholding_minor")?;
    let bank_charge_minor: i64 = row.try_get("bank_charge_minor")?;
    Ok(PaymentDeductions {
        payment_id,
        payment_number: row.try_get("payment_number")?,
        total_minor,
        withholding_minor,
        withholding_key: row.try_get("withholding_key")?,
        bank_charge_minor,
        leaving_the_bank_minor: total_minor - withholding_minor + bank_charge_minor,
        explanation: Vec::new(),
    })
}

/// The credit side of a payment: what left the bank, what the tax office is
/// owed, and what the bank charged for the transfer.
///
/// The one place `payments::post_payment` reaches into this module. The DEBIT
/// side is that function's own — one line per allocation, against the payable
/// the bill credited — and is untouched.
///
///     Dr bank_admin_fee  the bank's charge, when there is one
///     Cr bank            total - withheld + charge
///     Cr pph_payable     what was kept back
///
/// The payable is debited for the whole allocation, not the net, because the
/// whole debt is settled: a vendor who has been withheld from is not still owed
/// the difference, and debiting the net would leave every service vendor
/// permanently in arrears on the ageing report.
pub async fn payment_money_lines(
    pool: &PgPool,
    payment_id: Uuid,
    site_id: &str,
    account_key: &str,
    account_qualifier: &str,
    total_minor: i64,
) -> Result<Vec<PostingLine>, AppError> {
    let deductions = payment_deductions(pool, payment_id).await?;
    let mut lines = Vec::with_capacity(3);
    if deductions.bank_charge_minor > 0 {
        lines.push(PostingLine::debit(
            BANK_CHARGE,
            site_id,
            deductions.bank_charge_minor,
        ));
    }
    lines.push(
        PostingLine::credit(account_key, site_id, deductions.leaving_the_bank_minor)
            .with_qualifier(account_qualifier),
    );
    if deductions.withholding_minor > 0 {
        let key = deductions.withholding_key.ok_or_else(|| {
            AppError::Validation(
                "the payment withholds tax without saying which; 0133 requires both together"
                    .into(),
            )
        })?;
        lines.push(PostingLine::credit(
            &key,
            site_id,
            deductions.withholding_minor,
        ));
    }
    debug_assert_eq!(
        total_minor + deductions.bank_charge_minor,
        lines.iter().map(|l| l.credit_minor).sum::<i64>()
            + lines.iter().map(|l| l.debit_minor).sum::<i64>()
            - deductions.bank_charge_minor
    );
    Ok(lines)
}

// ---------------------------------------------------------------------------
// The three-way report
// ---------------------------------------------------------------------------

/// A delivery that has arrived and has no bill against it, and how long it has
/// been waiting.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReceiptAging {
    pub receipt_id: Uuid,
    pub receipt_number: String,
    pub supplier_id: String,
    pub site_id: String,
    pub arrived_at: DateTime<Utc>,
    pub days_waiting: i32,
    /// `0-30`, `31-60`, `61-90`, `over 90`.
    pub bucket: String,
    pub value_at_order_price_minor: i64,
    /// What it was actually posted at, or nothing when finance has not valued
    /// it. The gap between the two columns is the balance sheet's exposure.
    pub posted_value_minor: Option<i64>,
}

/// A bill nobody has tied to a delivery.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnmatchedBill {
    pub invoice_id: Uuid,
    pub invoice_number: String,
    pub supplier_id: String,
    pub site_id: String,
    pub invoice_date: NaiveDate,
    pub total_minor: i64,
    pub status: String,
    pub days_since: i32,
}

/// Order, delivery, bill — and what is missing from each side.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ThreeWayReport {
    pub receipts_not_billed: Vec<ReceiptAging>,
    pub bills_not_matched: Vec<UnmatchedBill>,
    /// What the suspend account should be carrying: the posted value of every
    /// delivery nobody has billed. A figure to check `2012001002` against.
    pub suspense_expected_minor: i64,
}

pub async fn three_way_report(pool: &PgPool, limit: i64) -> Result<ThreeWayReport, AppError> {
    let limit = limit.clamp(1, 500);
    let receipt_rows = sqlx::query(
        "SELECT r.receipt_id, r.receipt_number, r.supplier_id, r.site_id, r.arrived_at,
                (CURRENT_DATE - r.arrived_at::date)::int AS days_waiting,
                COALESCE(SUM(l.quantity * pl.unit_price_minor), 0)::bigint AS value_minor,
                MAX(p.value_minor) AS posted_value
           FROM goods_receipt r
           LEFT JOIN goods_receipt_line l ON l.receipt_id = r.receipt_id
           LEFT JOIN purchase_order_line pl ON pl.po_line_id = l.po_line_id
           LEFT JOIN goods_receipt_posting p
                  ON p.receipt_id = r.receipt_id AND p.reversal_entry_id IS NULL
          WHERE NOT EXISTS (SELECT 1 FROM supplier_invoice_receipt sir
                             WHERE sir.receipt_id = r.receipt_id)
          GROUP BY r.receipt_id
          ORDER BY r.arrived_at
          LIMIT $1",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let receipts_not_billed: Vec<ReceiptAging> = receipt_rows
        .iter()
        .map(|row| {
            let days: i32 = row.try_get("days_waiting")?;
            Ok(ReceiptAging {
                receipt_id: row.try_get("receipt_id")?,
                receipt_number: row.try_get("receipt_number")?,
                supplier_id: row.try_get("supplier_id")?,
                site_id: row.try_get("site_id")?,
                arrived_at: row.try_get("arrived_at")?,
                days_waiting: days,
                bucket: bucket(days).to_string(),
                value_at_order_price_minor: row.try_get("value_minor")?,
                posted_value_minor: row.try_get("posted_value")?,
            })
        })
        .collect::<Result<_, AppError>>()?;

    // The whole suspense balance, not only the page above, because it is a
    // figure somebody checks an account against and a page of it would be
    // wrong without looking wrong.
    let suspense_expected_minor: i64 = sqlx::query(
        "SELECT COALESCE(SUM(p.value_minor), 0)::bigint AS expected
           FROM goods_receipt_posting p
          WHERE p.reversal_entry_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM supplier_invoice_receipt sir
                             WHERE sir.receipt_id = p.receipt_id)",
    )
    .fetch_one(pool)
    .await?
    .try_get("expected")?;

    let bill_rows = sqlx::query(
        "SELECT i.invoice_id, i.invoice_number, i.supplier_id, i.site_id, i.invoice_date,
                i.total_minor, i.status,
                (CURRENT_DATE - i.invoice_date)::int AS days_since
           FROM supplier_invoice i
          WHERE i.kind = 'MERCHANDISE'
            AND i.status IN ('DRAFT', 'POSTED')
            AND NOT EXISTS (SELECT 1 FROM supplier_invoice_receipt sir
                             WHERE sir.invoice_id = i.invoice_id)
          ORDER BY i.invoice_date
          LIMIT $1",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let bills_not_matched: Vec<UnmatchedBill> = bill_rows
        .iter()
        .map(|row| {
            Ok(UnmatchedBill {
                invoice_id: row.try_get("invoice_id")?,
                invoice_number: row.try_get("invoice_number")?,
                supplier_id: row.try_get("supplier_id")?,
                site_id: row.try_get("site_id")?,
                invoice_date: row.try_get("invoice_date")?,
                total_minor: row.try_get("total_minor")?,
                status: row.try_get("status")?,
                days_since: row.try_get("days_since")?,
            })
        })
        .collect::<Result<_, AppError>>()?;

    Ok(ThreeWayReport {
        receipts_not_billed,
        bills_not_matched,
        suspense_expected_minor,
    })
}

fn bucket(days: i32) -> &'static str {
    match days {
        i32::MIN..=30 => "0-30",
        31..=60 => "31-60",
        61..=90 => "61-90",
        _ => "over 90",
    }
}
