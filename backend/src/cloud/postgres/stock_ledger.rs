//! The Stock Ledger: layers in, basis out, and the journal that follows.
//!
//! The kernel in `domain::costing` decides the arithmetic. This module decides
//! what may be asked of it, holds the lock while it is asked, records what it
//! answered, and posts the entry — all in the caller's own transaction, so that
//! a sale and the cost of that sale either both exist or neither does.
//!
//! # The three rules that matter, and where each is enforced
//!
//! **Only economic outflows consume.** A sale, a confirmed loss, a write-off, a
//! disposal. A DC-to-store transfer is not one: `stock_ledger_record_transfer`
//! writes a movement with `qty_delta = 0` and no layer, and the CHECK on
//! `stock_ledger_entry` refuses a transfer that names one at all.
//!
//! **A supplier return is targeted.** It goes back to the receipt those goods
//! came from, never to the head of the queue, and it does not spill onto a
//! second layer when the first is short. FIFO here would release the basis of
//! the OLDEST receipt while the goods physically leaving came from a named one:
//! a receipt would be credited that kept nothing back, and the real one would
//! hold quantity that is no longer in the building. Every row still balances,
//! which is why the refusal has to be explicit.
//!
//! **A closed period is closed to writes.** Checked here, inside the caller's
//! transaction, and again by the trigger on `journal_entry` when there is a
//! journal. The check here exists so the refusal names the consumption and the
//! date, rather than arriving from a trigger about a table the caller never
//! mentioned.
//!
//! # Why an advisory lock as well as `FOR UPDATE`
//!
//! Two consumers of the same article are already safe without it, and it is
//! worth being exact about that rather than claiming more for the lock than it
//! does. `read_queue` takes `FOR UPDATE` over the layers before reading their
//! residuals; the second consumer blocks there, and because this runs at READ
//! COMMITTED its next statement takes a fresh snapshot once the lock is granted
//! — so it reads `cost_layer_remaining` AFTER the first has committed and sees
//! what that one took. Removing the advisory lock does not make two concurrent
//! sales spend the same basis, and a test that says otherwise is passing for
//! the wrong reason.
//!
//! The race row locks cannot reach is a delivery and an outflow of one article
//! at the same moment. A receipt INSERTS a layer, so there is no row for the
//! two to collide on: `FOR UPDATE` can only lock rows that already exist. Both
//! transactions then read the article's running position from its last stock
//! ledger entry, both get the same answer, and both append an entry whose
//! `qty_after` and `stock_value_after_minor` were computed from a position that
//! stopped being true when the other committed.
//!
//! Nothing complains about that. Both entries balance, both layers are right,
//! the queue is right — and the running totals, which are what say what an
//! article is worth without summing its whole history, are quietly wrong from
//! there on. A transaction-scoped advisory lock on the article is released at
//! commit or rollback and serialises every writer of that article's history,
//! whether or not there is a row in common to lock.

use super::ledger::resolve_account_code;
use super::poster::{post, PostingIntent, PostingLine};
use crate::cloud::application::AppError;
use crate::cloud::domain::{
    consume_fifo, split_price_correction, ConsumeError, CostLayerSlice, CostingRefusal,
    PriceCorrection,
};
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// The one costing method this system has, named once.
///
/// Every stock ledger entry records it, so the day a second method exists the
/// history already says which one valued each row.
pub const STOCK_LEDGER_METHOD: &str = "FIFO";

/// Which entry a posting is, when one document produces more than one.
///
/// A day's sales produce a revenue entry from the sales rule and a cost entry
/// from this one, against the same document. `source_kind` already keeps them
/// apart — `SALE_DAY` against `COGS_DAY` — and this is the belt to that
/// braces: the separation stops depending on two rules remembering to choose
/// different kinds.
pub const COGS_POSTING_PURPOSE: &str = "COGS";

/// Name this posting's step within its document, and say which thing it is for.
///
/// 0140 makes `(source_kind, source_id, purpose)` unique, which is exactly the
/// guard a cost posting wants and exactly one grain coarser than it needs. One
/// document consumes basis for as many articles as it touched, and every one of
/// those is a separate queue, a separate lock and a separate entry — so the
/// step alone would refuse the second article of a day's sales as a double
/// post. The thing consumed is what makes one of them different from the next.
///
/// Uppercase hex with no separators because 0140 constrains a purpose to
/// `^[A-Z][A-Z0-9_]*$`, which a UUID's own spelling does not satisfy.
///
/// The consequence is worth stating: a caller must aggregate one document's
/// consumption per article before calling. Two calls naming the same document,
/// the same kind and the same article are refused by the unique index — which
/// is the right answer, because they would be two costs for one article on one
/// document and only one of them can be the cost.
fn posting_purpose(step: &str, of: Uuid) -> String {
    format!("{step}_{}", of.simple().to_string().to_uppercase())
}

// ---------------------------------------------------------------------------
// What goes in
// ---------------------------------------------------------------------------

/// A receipt line, as a cost.
///
/// The door Lane G calls when a goods receipt is verified. Deliberately not
/// called by anything else: a layer that did not come from a delivery has no
/// quantity anybody counted.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct NewCostLayer {
    pub article_id: Uuid,
    /// Pieces, already converted out of the purchase unit of measure.
    pub quantity: i64,
    /// What the supplier charged for the goods, before any discount.
    pub gross_cost_minor: i64,
    /// What came off on the invoice. Positive; it is subtracted here, from the
    /// cost of the goods, and it is never booked as a separate credit.
    ///
    /// The client's chart filed `8010110003 Potongan Pembelian` under other
    /// income, and booking a purchase discount there overstates inventory and
    /// income by the same amount. 0289 moved it to `5101 Harga pokok
    /// penjualan` carrying `PURCHASE_DISCOUNT`, so it now reduces cost where it
    /// belongs — but that is about where a discount somebody DID book belongs,
    /// not a licence to book one here. A discount on a receipt is a smaller
    /// cost, not a separate event.
    #[serde(default)]
    pub discount_minor: i64,
    /// When the goods were economically accepted. Not when this was recorded.
    pub economic_date: NaiveDate,
    /// Where they landed, and which pool they went into.
    pub site_id: String,
    pub to_pool_id: String,
    pub receipt_id: Option<Uuid>,
    pub receipt_line_id: Option<Uuid>,
    /// The delivery note number a person would quote, when the reference above
    /// is not there to be had.
    pub source_reference: Option<String>,
    pub supplier_id: Option<String>,
    /// The document this came from, for the stock ledger entry.
    pub source_kind: String,
    pub source_id: String,
}

/// A layer, as it was written.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CostLayer {
    pub layer_id: Uuid,
    pub article_id: Uuid,
    pub quantity: i64,
    pub opening_cost_minor: i64,
    pub unit_cost_minor: i64,
    pub economic_date: NaiveDate,
    pub site_id: String,
    pub entry_id: Uuid,
}

/// One layer, and what is left of it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CostLayerView {
    pub layer_id: Uuid,
    pub economic_date: NaiveDate,
    pub site_id: String,
    pub received_quantity: i64,
    pub remaining_quantity: i64,
    pub remaining_value_minor: i64,
    /// What the goods cost in total with corrections folded in, ignoring what
    /// has already gone out. What a person means by "what did we pay for these".
    pub effective_cost_minor: i64,
    pub unit_cost_minor: i64,
    pub source_reference: Option<String>,
    pub supplier_id: Option<String>,
    /// Position in the queue, oldest first. Sent so a screen does not have to
    /// re-derive the order it was already given in.
    pub position: i32,
}

/// An economic outflow: goods leaving the company.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StockOutflow {
    pub article_id: Uuid,
    /// What actually left, when the caller knows. Costing does not use it.
    pub sku_id: Option<Uuid>,
    /// Physical identity, for tracing a sold unit back to its delivery. It does
    /// not choose the layer and must not start.
    pub epc: Option<String>,
    pub lot_reference: Option<String>,
    pub quantity: i64,
    /// `SALE`, `LOSS`, `WRITE_OFF` or `DISPOSAL`.
    pub event_kind: String,
    /// What this outflow is, in the caller's own identifiers. Half of the
    /// idempotency key: the same sale delivered twice consumes once.
    pub event_id: String,
    pub from_pool_id: String,
    /// Whose books this belongs to — the site of the sale, the site holding the
    /// goods that were lost.
    pub site_id: String,
    pub economic_date: NaiveDate,
    /// The document the journal entry hangs off. For a sale this is the sales
    /// posting document from the sales rule, which deliberately posts no cost.
    pub source_id: String,
    pub memo: Option<String>,
}

/// Goods going back to the supplier they came from.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierReturn {
    /// The layer the goods arrived on. Required, and there is no fallback: see
    /// the module header.
    pub layer_id: Uuid,
    pub quantity: i64,
    pub event_id: String,
    pub from_pool_id: String,
    pub site_id: String,
    pub economic_date: NaiveDate,
    pub source_id: String,
    pub memo: Option<String>,
}

/// Custody moving between two of our own places.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StockTransfer {
    pub article_id: Uuid,
    pub sku_id: Option<Uuid>,
    pub epc: Option<String>,
    pub quantity: i64,
    pub event_id: String,
    pub from_pool_id: String,
    pub to_pool_id: String,
    /// Where the goods are going. The entry is filed under the receiving site,
    /// because that is who holds them afterwards.
    pub site_id: String,
    pub economic_date: NaiveDate,
    pub source_id: String,
}

/// A supplier billing a different price than the goods were received at.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LayerPriceCorrection {
    pub layer_id: Uuid,
    /// Signed. Positive when the supplier billed more than the goods were
    /// received at.
    pub amount_minor: i64,
    pub effective_date: NaiveDate,
    pub reason: String,
    /// The credit or debit note. Half of the idempotency key.
    pub source_id: String,
}

/// What one event did, and which layers it did it with.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StockLedgerPosting {
    pub posting_group_id: Uuid,
    pub article_id: Uuid,
    pub event_kind: String,
    pub quantity: i64,
    /// What it cost, all in. The number that reached the general ledger.
    pub value_minor: i64,
    pub economic_date: NaiveDate,
    pub journal_entry_id: Option<Uuid>,
    pub journal_entry_number: Option<String>,
    pub allocations: Vec<StockLedgerAllocation>,
}

/// One layer's share of one event.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StockLedgerAllocation {
    pub entry_id: Uuid,
    pub cost_layer_id: Option<Uuid>,
    pub layer_economic_date: Option<NaiveDate>,
    pub quantity: i64,
    pub valuation_rate_minor: Option<i64>,
    pub value_minor: i64,
    pub qty_after: i64,
    pub stock_value_after_minor: i64,
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/// Refuse a fact dated inside a settled month.
///
/// The economic date, never the recording time. A fact arriving late is not the
/// problem — that happens constantly. The problem is a fact CLAIMING to belong
/// to a period somebody has already signed off.
///
/// `FOR SHARE`, and inside the caller's transaction, so a close running at the
/// same moment either waits for this or makes this wait for it. The same device
/// `assert_period_open` in 0051 uses, for the same reason: without the lock
/// there is an interleaving where the period closes and a late consumption
/// slips in behind it.
pub(super) async fn assert_period_open(
    tx: &mut Transaction<'_, Postgres>,
    when: NaiveDate,
    what: &str,
) -> Result<(), AppError> {
    let period =
        sqlx::query("SELECT status FROM fiscal_period WHERE year = $1 AND month = $2 FOR SHARE")
            .bind(when.year() as i16)
            .bind(when.month() as i16)
            .fetch_optional(&mut **tx)
            .await?;

    let status: String = match period {
        Some(row) => row.try_get("status")?,
        None => {
            return Err(AppError::Conflict(format!(
                "no accounting period exists for {}; open it before recording {what}",
                when.format("%Y-%m")
            )))
        }
    };
    if status == "CLOSED" {
        return Err(AppError::Conflict(format!(
            "{what} is dated {when}, which falls inside accounting period {}, and that period is \
             closed. Closed history is never rewritten — record this in the first open period, \
             keeping its own economic date on the correction",
            when.format("%Y-%m")
        )));
    }
    Ok(())
}

/// Serialise everyone about to consume the same article's basis, for the length
/// of the caller's transaction. See the module header for why this is not
/// optional.
async fn lock_article_basis(
    tx: &mut Transaction<'_, Postgres>,
    article_id: Uuid,
) -> Result<(), AppError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1))")
        .bind(format!("cost_layer/{article_id}"))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Where the article stands right now, company-wide: pieces and money.
///
/// Read under the lock, and read from the last entry rather than summed, so that
/// two thousand entries do not cost two thousand rows to append the two thousand
/// and first.
async fn running_position(
    tx: &mut Transaction<'_, Postgres>,
    article_id: Uuid,
) -> Result<(i64, i64), AppError> {
    let row = sqlx::query(
        "SELECT qty_after, stock_value_after_minor FROM stock_ledger_entry
          WHERE article_id = $1 ORDER BY fact_sequence DESC LIMIT 1",
    )
    .bind(article_id)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(match row {
        Some(row) => (
            row.try_get("qty_after")?,
            row.try_get("stock_value_after_minor")?,
        ),
        None => (0, 0),
    })
}

/// The rows one event already wrote, if it has been delivered before.
///
/// Replay is the ordinary case, not an edge one: dispatch is at-least-once, and
/// a sale that reached this twice must consume once.
async fn replay(
    tx: &mut Transaction<'_, Postgres>,
    key: &str,
) -> Result<Option<StockLedgerPosting>, AppError> {
    let rows = sqlx::query(
        "SELECT e.entry_id, e.posting_group_id, e.article_id, e.event_kind, e.quantity,
                e.cost_layer_id, e.valuation_rate_minor, e.stock_value_difference_minor,
                e.qty_after, e.stock_value_after_minor, e.economic_date, e.journal_entry_id,
                j.entry_number, l.economic_date AS layer_date
           FROM stock_ledger_entry e
           LEFT JOIN journal_entry j ON j.entry_id = e.journal_entry_id
           LEFT JOIN cost_layer l ON l.layer_id = e.cost_layer_id
          WHERE e.idempotency_key = $1
          ORDER BY e.line_number",
    )
    .bind(key)
    .fetch_all(&mut **tx)
    .await?;
    if rows.is_empty() {
        return Ok(None);
    }
    Ok(Some(collect_posting(&rows)?))
}

fn collect_posting(rows: &[sqlx::postgres::PgRow]) -> Result<StockLedgerPosting, AppError> {
    let first = &rows[0];
    let mut posting = StockLedgerPosting {
        posting_group_id: first.try_get("posting_group_id")?,
        article_id: first.try_get("article_id")?,
        event_kind: first.try_get("event_kind")?,
        quantity: 0,
        value_minor: 0,
        economic_date: first.try_get("economic_date")?,
        journal_entry_id: first.try_get("journal_entry_id")?,
        journal_entry_number: first.try_get("entry_number")?,
        allocations: Vec::with_capacity(rows.len()),
    };
    for row in rows {
        let quantity: i64 = row.try_get("quantity")?;
        let difference: i64 = row.try_get("stock_value_difference_minor")?;
        posting.quantity += quantity;
        posting.value_minor += difference.abs();
        posting.allocations.push(StockLedgerAllocation {
            entry_id: row.try_get("entry_id")?,
            cost_layer_id: row.try_get("cost_layer_id")?,
            layer_economic_date: row.try_get("layer_date")?,
            quantity,
            valuation_rate_minor: row.try_get("valuation_rate_minor")?,
            value_minor: difference,
            qty_after: row.try_get("qty_after")?,
            stock_value_after_minor: row.try_get("stock_value_after_minor")?,
        });
    }
    Ok(posting)
}

/// Turn a kernel refusal into something a person can act on.
///
/// `first_layer_after` is the earliest layer this article has that the queue
/// could NOT see, because it is dated after the outflow claims to have happened.
/// The kernel cannot know about it — the caller filters by date before handing
/// the queue over, so from inside the kernel "we have never bought this" and "we
/// bought it the week after this sale" look identical. They are very different
/// conversations: the first is a missing receipt, the second is a wrong date on
/// one of the two documents, and naming the layer sitting just out of reach is
/// what lets somebody find which.
fn refused(
    error: ConsumeError,
    article: Uuid,
    when: NaiveDate,
    first_layer_after: Option<NaiveDate>,
) -> AppError {
    match error {
        ConsumeError::Refused(refusal) => AppError::Validation(refusal.message().to_string()),
        ConsumeError::Insufficient(short) => AppError::Conflict(format!(
            "article {article} has {} piece(s) of unconsumed basis on or before {when}, and {} \
             was asked for.{} Consuming basis that is not there posts a cost with nothing behind \
             it, and the shortfall surfaces later as a variance nobody can explain",
            short.available_quantity,
            short.wanted_quantity,
            match (short.newest_layer_day, first_layer_after) {
                (None, None) => " Nothing has ever been received for it.".to_string(),
                (_, Some(later)) => format!(
                    " There is basis for it dated {later}, which the queue could not reach \
                     because that is after {when}. Either the receipt is dated late or this is."
                ),
                (Some(_), None) => String::new(),
            }
        )),
    }
}

/// The earliest layer for an article that is dated after a given day.
///
/// Asked only on the way to refusing, so the ordinary path pays nothing for it.
async fn first_layer_after(
    tx: &mut Transaction<'_, Postgres>,
    article_id: Uuid,
    when: NaiveDate,
) -> Result<Option<NaiveDate>, AppError> {
    Ok(sqlx::query(
        "SELECT MIN(economic_date) AS first FROM cost_layer
          WHERE article_id = $1 AND economic_date > $2",
    )
    .bind(article_id)
    .bind(when)
    .fetch_one(&mut **tx)
    .await?
    .try_get("first")?)
}

/// The kernel wants a day number and must not be given a calendar type.
fn day_number(date: NaiveDate) -> i32 {
    date.num_days_from_ce()
}

// ---------------------------------------------------------------------------
// Writing a layer
// ---------------------------------------------------------------------------

/// Record what a delivery cost. **This is the door Lane G calls.**
///
/// Writes the layer, its purchase and discount components, and the stock ledger
/// entry that brings the value in. Posts NO journal, deliberately: the debit to
/// `1011201001 Persediaan Barang Dagangan` already has an owner in the
/// supplier's bill, and a second debit here would put the same money into
/// inventory twice with both entries balancing.
///
/// Idempotent on `(source_kind, source_id, article, quantity)`. Call it again
/// with the same receipt and it hands back the layer it already made.
pub async fn cost_layer_create(
    tx: &mut Transaction<'_, Postgres>,
    request: &NewCostLayer,
    actor: &str,
) -> Result<CostLayer, AppError> {
    if request.quantity <= 0 {
        return Err(AppError::Validation(
            "a cost layer needs a positive quantity; a delivery of nothing is not a delivery"
                .into(),
        ));
    }
    if request.gross_cost_minor < 0 || request.discount_minor < 0 {
        return Err(AppError::Validation(
            "a purchase price and a discount are both positive figures; the discount is \
             subtracted here"
                .into(),
        ));
    }
    let net = request.gross_cost_minor - request.discount_minor;
    if net < 0 {
        return Err(AppError::Validation(format!(
            "the discount of {} is larger than the price of {}, which would make the goods worth \
             less than nothing; a supplier crediting more than they charged is a credit note, not \
             a line discount",
            request.discount_minor, request.gross_cost_minor
        )));
    }

    let key = format!(
        "layer|{}|{}|{}|{}",
        request.source_kind, request.source_id, request.article_id, request.quantity
    );
    if let Some(existing) = sqlx::query(
        "SELECT layer_id, article_id, quantity, opening_cost_minor, unit_cost_minor,
                economic_date, site_id,
                (SELECT entry_id FROM stock_ledger_entry e WHERE e.cost_layer_id = l.layer_id
                   AND e.event_kind = 'RECEIPT') AS entry_id
           FROM cost_layer l WHERE idempotency_key = $1",
    )
    .bind(&key)
    .fetch_optional(&mut **tx)
    .await?
    {
        return Ok(CostLayer {
            layer_id: existing.try_get("layer_id")?,
            article_id: existing.try_get("article_id")?,
            quantity: existing.try_get("quantity")?,
            opening_cost_minor: existing.try_get("opening_cost_minor")?,
            unit_cost_minor: existing.try_get("unit_cost_minor")?,
            economic_date: existing.try_get("economic_date")?,
            site_id: existing.try_get("site_id")?,
            entry_id: existing.try_get("entry_id")?,
        });
    }

    assert_period_open(tx, request.economic_date, "a goods receipt").await?;
    lock_article_basis(tx, request.article_id).await?;

    let layer_id = Uuid::new_v4();
    let unit = net / request.quantity;
    sqlx::query(
        "INSERT INTO cost_layer
           (layer_id, article_id, quantity, opening_cost_minor, unit_cost_minor, economic_date,
            receipt_id, receipt_line_id, source_reference, supplier_id, site_id,
            idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    )
    .bind(layer_id)
    .bind(request.article_id)
    .bind(request.quantity)
    .bind(net)
    .bind(unit)
    .bind(request.economic_date)
    .bind(request.receipt_id)
    .bind(request.receipt_line_id)
    .bind(request.source_reference.as_deref())
    .bind(request.supplier_id.as_deref())
    .bind(&request.site_id)
    .bind(&key)
    .bind(actor)
    .execute(&mut **tx)
    .await?;

    // The components the opening figure is made of. Written as rows and not
    // only as a total, so "the discount reduced the cost of the goods" is
    // something a person can point at rather than something this module claims.
    sqlx::query(
        "INSERT INTO cost_layer_adjustment
           (adjustment_id, layer_id, component_type, amount_minor, effective_date, reason,
            actor, idempotency_key)
         VALUES ($1,$2,'PURCHASE',$3,$4,$5,$6,$7)",
    )
    .bind(Uuid::new_v4())
    .bind(layer_id)
    .bind(request.gross_cost_minor)
    .bind(request.economic_date)
    .bind("What the supplier charged for the goods")
    .bind(actor)
    .bind(format!("{key}|PURCHASE"))
    .execute(&mut **tx)
    .await?;
    if request.discount_minor != 0 {
        sqlx::query(
            "INSERT INTO cost_layer_adjustment
               (adjustment_id, layer_id, component_type, amount_minor, effective_date, reason,
                actor, idempotency_key)
             VALUES ($1,$2,'DISCOUNT',$3,$4,$5,$6,$7)",
        )
        .bind(Uuid::new_v4())
        .bind(layer_id)
        .bind(-request.discount_minor)
        .bind(request.economic_date)
        .bind("Discount on the supplier's invoice, taken off what the goods cost")
        .bind(actor)
        .bind(format!("{key}|DISCOUNT"))
        .execute(&mut **tx)
        .await?;
    }

    let (quantity_before, value_before) = running_position(tx, request.article_id).await?;
    let entry_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO stock_ledger_entry
           (entry_id, posting_group_id, line_number, article_id, to_pool_id, site_id,
            quantity, qty_delta, qty_after, cost_layer_id, incoming_rate_minor,
            valuation_rate_minor, stock_value_difference_minor, stock_value_after_minor,
            costing_method, event_kind, source_kind, source_id, economic_date,
            idempotency_key, actor)
         VALUES ($1,$2,1,$3,$4,$5,$6,$6,$7,$8,$9,$9,$10,$11,$12,'RECEIPT',$13,$14,$15,$16,$17)",
    )
    .bind(entry_id)
    .bind(Uuid::new_v4())
    .bind(request.article_id)
    .bind(&request.to_pool_id)
    .bind(&request.site_id)
    .bind(request.quantity)
    .bind(quantity_before + request.quantity)
    .bind(layer_id)
    .bind(unit)
    .bind(net)
    .bind(value_before + net)
    .bind(STOCK_LEDGER_METHOD)
    .bind(&request.source_kind)
    .bind(&request.source_id)
    .bind(request.economic_date)
    .bind(&key)
    .bind(actor)
    .execute(&mut **tx)
    .await?;

    Ok(CostLayer {
        layer_id,
        article_id: request.article_id,
        quantity: request.quantity,
        opening_cost_minor: net,
        unit_cost_minor: unit,
        economic_date: request.economic_date,
        site_id: request.site_id.clone(),
        entry_id,
    })
}

// ---------------------------------------------------------------------------
// Taking basis out
// ---------------------------------------------------------------------------

/// What a kind of outflow means to the books.
///
/// One place decides this, so the sale path and any repair sweep cannot drift
/// into disagreeing about what a write-off is — which is exactly how supplier
/// returns spent their whole life being posted as sales in the system this was
/// ported from.
/// The kind of entry, the account the other side lands in, and the name of the
/// step within the document.
fn outflow_posting(event_kind: &str) -> Option<(&'static str, &'static str, &'static str)> {
    match event_kind {
        // The cost of a day's sales. A different `source_kind` from the sales
        // rule's `SALE_DAY` on purpose: the two entries have different rules,
        // different lines, and different reasons to be reposted.
        "SALE" => Some(("COGS_DAY", "cogs", COGS_POSTING_PURPOSE)),
        // A stock count difference. `STOCK_COUNT`, not `ADJUSTMENT`: the
        // policy keeps `5102 + SHRINKAGE` rule-only, and an ADJUSTMENT is a
        // hand-keyed kind -- a count's difference has a document of its own,
        // which is exactly what rule-only demands.
        "LOSS" => Some(("STOCK_COUNT", "stock_loss", "STOCK_LOSS")),
        // Damage and disposal land in the same account. The reference
        // implementation keeps loss and damage apart; this client's chart does
        // not, and inventing a second account puts a line in their books their
        // own accountant cannot explain.
        // Keep Inventory's write-off distinct from Finance correction
        // journals, which also use the generic WRITE_OFF source kind.
        // Damage and disposal are an expense of the goods themselves (owner
        // decision 8, stage 5): Dr 6011 Biaya Kerusakan Persediaan / Cr 1029.
        // A stock-count shortfall (LOSS) stays on 8007.
        "WRITE_OFF" | "DISPOSAL" => {
            Some(("INVENTORY_WRITE_OFF", "inventory_damage", "WRITE_OFF"))
        }
        // Goods going BACK to the vendor are not a cost of goods sold. The
        // debit belongs on the payable, whichever of the three ways the return
        // settles: a refund pays that debit off with cash, a debt reduction IS
        // the debit, and replacement goods clear it with stock. None is a cost.
        "SUPPLIER_RETURN" => Some(("CREDIT_NOTE", "trade_payable", "SUPPLIER_RETURN")),
        _ => None,
    }
}

/// The entry a supplier return makes.
///
/// The payable is head office's (owner rule, 25 Sep) and the stock is wherever
/// the goods were returned from. When those are the same place the entry is the
/// two lines it always was; when the goods sat in a shop, the shop's side goes
/// through Atas Barang — Dr 2029 / Cr 1029 — and head office's side is
/// Dr 2002 / Cr 1058. The balancer cannot be left to add these itself: a credit
/// at the shop reads as value it GAVE head office (a receivable), where the
/// whole point of a return is that the shop owes head office LESS.
fn supplier_return_lines(site_id: &str, value: i64) -> Vec<PostingLine> {
    let ho = super::poster::HEAD_OFFICE_SITE;
    let mut lines = vec![
        PostingLine::debit("trade_payable", ho, value),
        PostingLine::credit("inventory", site_id, value),
    ];
    if site_id != ho {
        lines.push(
            PostingLine::debit("affiliate_payable", site_id, value)
                .with_qualifier("BARANG")
                .with_counter_site(ho),
        );
        lines.push(
            PostingLine::credit("affiliate_receivable", ho, value)
                .with_qualifier("BARANG")
                .with_counter_site(site_id),
        );
    }
    lines
}

/// Take basis for an economic outflow, record what it took, and post it.
///
/// A sale takes from the head of the queue, because one interchangeable shirt is
/// as good as another and the tax treatment does not allow otherwise. A supplier
/// return does not come through here; it names its own layer.
pub async fn stock_ledger_consume(
    tx: &mut Transaction<'_, Postgres>,
    request: &StockOutflow,
    actor: &str,
) -> Result<StockLedgerPosting, AppError> {
    let (source_kind, expense_key, purpose_step) = match outflow_posting(&request.event_kind) {
        Some(triple) if request.event_kind != "SUPPLIER_RETURN" => triple,
        Some(_) => {
            return Err(AppError::Validation(
                "a supplier return goes back to the receipt those goods came from, not to the \
                 oldest layer in the queue. Name the cost layer being sent back"
                    .into(),
            ))
        }
        None => {
            return Err(AppError::Validation(format!(
                "{} is not an economic outflow. Only SALE, LOSS, WRITE_OFF and DISPOSAL consume \
                 basis: moving goods between our own places changes custody and not cost, and a \
                 return is targeted rather than queued",
                request.event_kind
            )))
        }
    };
    if request.quantity <= 0 {
        return Err(AppError::Validation(
            CostingRefusal::QuantityNotPositive.message().into(),
        ));
    }

    let key = format!(
        "{}|{}|{}|{}",
        request.event_kind, request.event_id, request.article_id, request.quantity
    );
    if let Some(existing) = replay(tx, &key).await? {
        return Ok(existing);
    }

    assert_period_open(tx, request.economic_date, "this consumption").await?;
    lock_article_basis(tx, request.article_id).await?;

    let queue = read_queue(tx, request.article_id, Some(request.economic_date)).await?;
    let slices: Vec<CostLayerSlice> = queue
        .iter()
        .map(|layer| CostLayerSlice {
            remaining_quantity: layer.remaining_quantity,
            remaining_value_minor: layer.remaining_value_minor,
            economic_day: day_number(layer.economic_date),
        })
        .collect();
    let taken = match consume_fifo(&slices, request.quantity, day_number(request.economic_date)) {
        Ok(taken) => taken,
        Err(error) => {
            let later = first_layer_after(tx, request.article_id, request.economic_date).await?;
            return Err(refused(
                error,
                request.article_id,
                request.economic_date,
                later,
            ));
        }
    };

    let total: i64 = taken.iter().map(|a| a.value_minor).sum();

    // Provenance, not a queue (owner decision 1, stage 5): every new item gets
    // its own SKU, so an article normally has ONE receipt cost and the layers
    // it is taken from all carry it. Two different costs on one SKU should not
    // happen; when it does it is flagged for Finance instead of being averaged
    // silently, and the layers still answer the value.
    flag_multiple_costs(tx, request.article_id, &request.source_id).await?;

    // Shopping bags are customer supplies (owner decision 11): at the till
    // they are Dr 6004 / Cr 1030, not cost of sales against merchandise.
    let supply = article_is_supply(tx, request.article_id).await?;
    let (expense_key, stock_key) = match (supply, request.event_kind.as_str()) {
        (true, "SALE") => ("customer_supplies", "bag_inventory"),
        (true, _) => (expense_key, "bag_inventory"),
        (false, _) => (expense_key, "inventory"),
    };

    // Posted BEFORE the entries are written, and its identifier carried onto
    // them. The stock ledger is append-only, so an entry cannot be told about
    // its journal afterwards — which is the right way round anyway: an entry
    // that exists without its posting is the state this ordering makes
    // impossible.
    let posted = if total > 0 {
        Some(
            post(
                tx,
                &PostingIntent {
                    posting_date: request.economic_date,
                    source_kind: source_kind.into(),
                    source_id: Some(request.source_id.clone()),
                    rule_version: format!("{}/1", source_kind.to_lowercase()),
                    currency: "IDR".into(),
                    memo: request.memo.clone(),
                    lines: vec![
                        // No `counter_site_id` on either line. A cost of sales
                        // and the stock it came out of are both the selling
                        // site's, so there is no other unit in this entry — and
                        // where there is one, Lane D's balancer adds the
                        // affiliate legs itself. A rule that wrote them by hand
                        // would be a second author of the same fact.
                        PostingLine::debit(expense_key, &request.site_id, total),
                        PostingLine::credit(stock_key, &request.site_id, total),
                    ],
                },
                Some(&posting_purpose(purpose_step, request.article_id)),
                actor,
            )
            .await?,
        )
    } else {
        // Goods that cost nothing produce no entry. There is no amount to post
        // and a zero-value journal would not balance in any useful sense.
        None
    };

    let (mut quantity_after, mut value_after) = running_position(tx, request.article_id).await?;
    let group = Uuid::new_v4();
    let mut posting = StockLedgerPosting {
        posting_group_id: group,
        article_id: request.article_id,
        event_kind: request.event_kind.clone(),
        quantity: request.quantity,
        value_minor: total,
        economic_date: request.economic_date,
        journal_entry_id: posted.as_ref().map(|p| p.entry_id),
        journal_entry_number: posted.as_ref().map(|p| p.entry_number.clone()),
        allocations: Vec::with_capacity(taken.len()),
    };

    for (index, allocation) in taken.iter().enumerate() {
        let layer = &queue[allocation.layer];
        quantity_after -= allocation.quantity;
        value_after -= allocation.value_minor;
        let entry_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO stock_ledger_entry
               (entry_id, posting_group_id, line_number, article_id, sku_id, epc, lot_reference,
                from_pool_id, site_id, quantity, qty_delta, qty_after, cost_layer_id,
                valuation_rate_minor, stock_value_difference_minor, stock_value_after_minor,
                costing_method, event_kind, source_kind, source_id, economic_date,
                journal_entry_id, idempotency_key, actor)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,-$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                     $20,$21,$22,$23)",
        )
        .bind(entry_id)
        .bind(group)
        .bind(index as i32 + 1)
        .bind(request.article_id)
        .bind(request.sku_id)
        .bind(request.epc.as_deref())
        .bind(request.lot_reference.as_deref())
        .bind(&request.from_pool_id)
        .bind(&request.site_id)
        .bind(allocation.quantity)
        .bind(quantity_after)
        .bind(layer.layer_id)
        // What a piece of THIS layer was worth, truncated. The money is the
        // allocation's own figure; this is for reading.
        .bind(allocation.value_minor / allocation.quantity)
        .bind(-allocation.value_minor)
        .bind(value_after)
        .bind(STOCK_LEDGER_METHOD)
        .bind(&request.event_kind)
        .bind(source_kind)
        .bind(&request.source_id)
        .bind(request.economic_date)
        .bind(posting.journal_entry_id)
        .bind(&key)
        .bind(actor)
        .execute(&mut **tx)
        .await?;

        posting.allocations.push(StockLedgerAllocation {
            entry_id,
            cost_layer_id: Some(layer.layer_id),
            layer_economic_date: Some(layer.economic_date),
            quantity: allocation.quantity,
            valuation_rate_minor: Some(allocation.value_minor / allocation.quantity),
            value_minor: -allocation.value_minor,
            qty_after: quantity_after,
            stock_value_after_minor: value_after,
        });
    }

    Ok(posting)
}

/// The cost of goods leaving the company on an operational movement.
///
/// The movement ledger records custody; this records the money. It is called
/// from the one place every movement group is applied, so an official count's
/// shortfall, a confirmed loss and a disposal each reach the general ledger at
/// the moment they happen, in the same transaction as the movement itself — the
/// stock ledger and the journal commit together or not at all.
///
/// Causes that are not an economic outflow return `None` and post nothing: a
/// move between our own places changes custody, a sale is already costed by the
/// sales day, and a gain has no known cost (see the note on gains below).
///
/// A subject with no SKU has no cost layer to draw on, so it posts nothing
/// either; the operational event still stands.
pub async fn post_operational_outflow(
    tx: &mut Transaction<'_, Postgres>,
    cause: &str,
    subject_id: Uuid,
    quantity: i64,
    economic_date: NaiveDate,
    from_pool_id: &str,
    site_id: &str,
    event_id: &str,
    memo: &str,
    actor: &str,
) -> Result<Option<StockLedgerPosting>, AppError> {
    let event_kind = match cause {
        // An official count's shortfall: Dr 8007 Selisih Stock Opname / Cr 1029.
        "COUNT_SHORTAGE" => "LOSS",
        // Damage, theft or a confirmed loss: Dr 6011 Biaya Kerusakan Persediaan
        // / Cr 1029.
        "CONFIRMED_LOST" => "WRITE_OFF",
        "DISPOSAL" => "DISPOSAL",
        // Everything else: a move, a sale (costed by the sales day), a
        // customer return (the goods come back), or a gain with no known cost.
        _ => return Ok(None),
    };
    if quantity <= 0 {
        return Ok(None);
    }
    let sku: Option<Uuid> =
        sqlx::query_scalar("SELECT sku_id FROM inventory_subject WHERE id = $1")
            .bind(subject_id)
            .fetch_one(&mut **tx)
            .await?;
    let Some(sku) = sku else {
        return Ok(None);
    };
    let article: Uuid = sqlx::query_scalar("SELECT article_id FROM sku WHERE id = $1")
        .bind(sku)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("sku {sku}")))?;
    let posting = stock_ledger_consume(
        tx,
        &StockOutflow {
            article_id: article,
            sku_id: Some(sku),
            epc: None,
            lot_reference: None,
            quantity,
            event_kind: event_kind.into(),
            event_id: event_id.to_string(),
            from_pool_id: from_pool_id.to_string(),
            site_id: site_id.to_string(),
            economic_date,
            source_id: event_id.to_string(),
            memo: Some(memo.to_string()),
        },
        actor,
    )
    .await?;
    Ok(Some(posting))
}

/// Send goods back to the receipt they arrived on.
///
/// That layer and only that layer. There is no fallback to the next one,
/// deliberately: a partial fill that quietly took the remainder from somewhere
/// else would credit a receipt the goods never touched, and the person who asked
/// for it would have no way to see that happened. A shortfall means the caller
/// has the wrong receipt or the wrong quantity, and both are worth stopping for.
pub async fn stock_ledger_return_to_supplier(
    tx: &mut Transaction<'_, Postgres>,
    request: &SupplierReturn,
    actor: &str,
) -> Result<StockLedgerPosting, AppError> {
    if request.quantity <= 0 {
        return Err(AppError::Validation(
            CostingRefusal::QuantityNotPositive.message().into(),
        ));
    }
    let key = format!(
        "SUPPLIER_RETURN|{}|{}|{}",
        request.event_id, request.layer_id, request.quantity
    );
    if let Some(existing) = replay(tx, &key).await? {
        return Ok(existing);
    }

    assert_period_open(tx, request.economic_date, "this supplier return").await?;

    let article: Uuid = sqlx::query("SELECT article_id FROM cost_layer WHERE layer_id = $1")
        .bind(request.layer_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "cost layer {}. A supplier return names the layer the goods arrived on, not the \
                 article",
                request.layer_id
            ))
        })?
        .try_get("article_id")?;
    lock_article_basis(tx, article).await?;

    // Locked and then read, in that order, for the reason in the module header.
    sqlx::query("SELECT layer_id FROM cost_layer WHERE layer_id = $1 FOR UPDATE")
        .bind(request.layer_id)
        .execute(&mut **tx)
        .await?;
    let row = sqlx::query(
        "SELECT received_quantity, remaining_quantity, remaining_value_minor, economic_date
           FROM cost_layer_remaining WHERE layer_id = $1",
    )
    .bind(request.layer_id)
    .fetch_one(&mut **tx)
    .await?;
    let received: i64 = row.try_get("received_quantity")?;
    let remaining: i64 = row.try_get("remaining_quantity")?;
    let remaining_value: i64 = row.try_get("remaining_value_minor")?;
    let layer_date: NaiveDate = row.try_get("economic_date")?;

    if remaining < request.quantity {
        return Err(AppError::Conflict(format!(
            "layer {} received {received} and has {remaining} unconsumed, but {} was asked to go \
             back to the supplier. A supplier return does not spill onto another receipt: return \
             at most {remaining} against this one, or name the layer holding the rest",
            request.layer_id, request.quantity
        )));
    }

    // The same rule the queue uses: emptying a layer takes what is on it, so
    // corrections that arrived after the goods go back with them rather than
    // stranding on a layer with nothing left to carry them.
    let value = if request.quantity == remaining {
        remaining_value
    } else {
        ((i128::from(remaining_value) * i128::from(request.quantity)) / i128::from(remaining))
            as i64
    };

    let posted = if value > 0 {
        Some(
            post(
                tx,
                &PostingIntent {
                    posting_date: request.economic_date,
                    source_kind: "CREDIT_NOTE".into(),
                    source_id: Some(request.source_id.clone()),
                    rule_version: "supplier_return/1".into(),
                    currency: "IDR".into(),
                    memo: request.memo.clone(),
                    lines: supplier_return_lines(&request.site_id, value),
                },
                // Keyed on the layer and not the article: one credit note can
                // send back goods from two receipts of the same article, and
                // each of those is its own basis going out.
                Some(&posting_purpose("SUPPLIER_RETURN", request.layer_id)),
                actor,
            )
            .await?,
        )
    } else {
        None
    };

    let (quantity_before, value_before) = running_position(tx, article).await?;
    let group = Uuid::new_v4();
    let entry_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO stock_ledger_entry
           (entry_id, posting_group_id, line_number, article_id, from_pool_id, site_id,
            quantity, qty_delta, qty_after, cost_layer_id, valuation_rate_minor,
            stock_value_difference_minor, stock_value_after_minor, costing_method, event_kind,
            source_kind, source_id, economic_date, journal_entry_id, idempotency_key, actor)
         VALUES ($1,$2,1,$3,$4,$5,$6,-$6,$7,$8,$9,$10,$11,$12,'SUPPLIER_RETURN','CREDIT_NOTE',
                 $13,$14,$15,$16,$17)",
    )
    .bind(entry_id)
    .bind(group)
    .bind(article)
    .bind(&request.from_pool_id)
    .bind(&request.site_id)
    .bind(request.quantity)
    .bind(quantity_before - request.quantity)
    .bind(request.layer_id)
    .bind(value / request.quantity)
    .bind(-value)
    .bind(value_before - value)
    .bind(STOCK_LEDGER_METHOD)
    .bind(&request.source_id)
    .bind(request.economic_date)
    .bind(posted.as_ref().map(|p| p.entry_id))
    .bind(&key)
    .bind(actor)
    .execute(&mut **tx)
    .await?;

    Ok(StockLedgerPosting {
        posting_group_id: group,
        article_id: article,
        event_kind: "SUPPLIER_RETURN".into(),
        quantity: request.quantity,
        value_minor: value,
        economic_date: request.economic_date,
        journal_entry_id: posted.as_ref().map(|p| p.entry_id),
        journal_entry_number: posted.as_ref().map(|p| p.entry_number.clone()),
        allocations: vec![StockLedgerAllocation {
            entry_id,
            cost_layer_id: Some(request.layer_id),
            layer_economic_date: Some(layer_date),
            quantity: request.quantity,
            valuation_rate_minor: Some(value / request.quantity),
            value_minor: -value,
            qty_after: quantity_before - request.quantity,
            stock_value_after_minor: value_before - value,
        }],
    })
}

/// Move custody between two of our own places.
///
/// Consumes no basis, names no layer, posts no cost of goods. The goods are
/// still ours and still on our books; what changed is who is holding them. The
/// entry exists so the stock ledger can answer "where did it go", and the CHECK
/// on the table refuses one that names a layer at all — the rule is in the
/// schema and not only in this function.
pub async fn stock_ledger_record_transfer(
    tx: &mut Transaction<'_, Postgres>,
    request: &StockTransfer,
    actor: &str,
) -> Result<StockLedgerPosting, AppError> {
    if request.quantity <= 0 {
        return Err(AppError::Validation(
            CostingRefusal::QuantityNotPositive.message().into(),
        ));
    }
    if request.from_pool_id == request.to_pool_id {
        return Err(AppError::Validation(
            "a transfer needs two different pools; goods that did not move are not a movement"
                .into(),
        ));
    }
    let key = format!(
        "TRANSFER|{}|{}|{}",
        request.event_id, request.article_id, request.quantity
    );
    if let Some(existing) = replay(tx, &key).await? {
        return Ok(existing);
    }

    assert_period_open(tx, request.economic_date, "this transfer").await?;
    lock_article_basis(tx, request.article_id).await?;
    let (quantity_after, value_after) = running_position(tx, request.article_id).await?;

    let group = Uuid::new_v4();
    let entry_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO stock_ledger_entry
           (entry_id, posting_group_id, line_number, article_id, sku_id, epc, from_pool_id,
            to_pool_id, site_id, quantity, qty_delta, qty_after, stock_value_difference_minor,
            stock_value_after_minor, costing_method, event_kind, source_kind, source_id,
            economic_date, idempotency_key, actor)
         VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,0,$10,0,$11,$12,'TRANSFER','TRANSFER',$13,$14,
                 $15,$16)",
    )
    .bind(entry_id)
    .bind(group)
    .bind(request.article_id)
    .bind(request.sku_id)
    .bind(request.epc.as_deref())
    .bind(&request.from_pool_id)
    .bind(&request.to_pool_id)
    .bind(&request.site_id)
    .bind(request.quantity)
    .bind(quantity_after)
    .bind(value_after)
    .bind(STOCK_LEDGER_METHOD)
    .bind(&request.source_id)
    .bind(request.economic_date)
    .bind(&key)
    .bind(actor)
    .execute(&mut **tx)
    .await?;

    Ok(StockLedgerPosting {
        posting_group_id: group,
        article_id: request.article_id,
        event_kind: "TRANSFER".into(),
        quantity: request.quantity,
        value_minor: 0,
        economic_date: request.economic_date,
        journal_entry_id: None,
        journal_entry_number: None,
        allocations: vec![StockLedgerAllocation {
            entry_id,
            cost_layer_id: None,
            layer_economic_date: None,
            quantity: request.quantity,
            valuation_rate_minor: None,
            value_minor: 0,
            qty_after: quantity_after,
            stock_value_after_minor: value_after,
        }],
    })
}

/// A supplier billing a different price than the goods were received at.
///
/// Split once, when it arrives: the part belonging to goods still on hand raises
/// what they are worth, and the part belonging to goods already gone lands
/// straight in cost of sales. Debiting inventory in full — which is what the
/// implementation this was ported from does — leaves the sold portion sitting in
/// the asset forever, because the pieces that would have carried it out are
/// already gone.
///
/// A full repost is not this. Rewriting the cost of sales that have already been
/// reported is a restatement somebody signs for, or a change of costing method,
/// and neither is the normal path.
/// What a price correction did, and how it was split.
pub struct PriceCorrectionOutcome {
    pub inventory_minor: i64,
    pub cogs_minor: i64,
    /// The Atas Barang pair, when the goods are in a shop and the caller is
    /// making its own journal. Empty at head office.
    pub affiliate_lines: Vec<PostingLine>,
    pub posting: StockLedgerPosting,
}

/// The Atas Barang pair a price correction makes when the goods are in a shop.
///
/// Built for the credit-note direction (shop owes less): Dr 2029 at the shop,
/// Cr 1058 at head office. A debit note (shop owes more) is the same pair with
/// the sides swapped.
fn price_correction_affiliate_lines(site: &str, amount_minor: i64, ho: &str) -> Vec<PostingLine> {
    if site == ho {
        return Vec::new();
    }
    let magnitude = amount_minor.abs();
    let mut store_leg = PostingLine::debit("affiliate_payable", site, magnitude)
        .with_qualifier("BARANG")
        .with_counter_site(ho);
    let mut ho_leg = PostingLine::credit("affiliate_receivable", ho, magnitude)
        .with_qualifier("BARANG")
        .with_counter_site(site);
    if amount_minor > 0 {
        store_leg.debit_minor = 0;
        store_leg.credit_minor = magnitude;
        ho_leg.debit_minor = magnitude;
        ho_leg.credit_minor = 0;
    }
    vec![store_leg, ho_leg]
}

/// A supplier billing a different price than the goods were received at, and the
/// journal made optional.
///
/// `post_journal` is FALSE when the caller's own document already carries the
/// stock half — a supplier bill whose price variance adjusts the provenance cost
/// rather than landing in `8004 Potongan Pembelian`. The layer and the stock
/// ledger still move; only the journal is the caller's, because it and the
/// payable the bill already credits are one entry, and writing a second would
/// put the variance into inventory twice.
pub async fn cost_layer_correct_price(
    tx: &mut Transaction<'_, Postgres>,
    request: &LayerPriceCorrection,
    actor: &str,
) -> Result<StockLedgerPosting, AppError> {
    Ok(price_correction(tx, request, actor, true).await?.posting)
}

/// The same correction with no journal of its own, for a caller that is making
/// one. Returns the split so the caller can put the inventory and cost-of-sales
/// halves on its own lines.
pub async fn cost_layer_correct_price_without_journal(
    tx: &mut Transaction<'_, Postgres>,
    request: &LayerPriceCorrection,
    actor: &str,
) -> Result<PriceCorrectionOutcome, AppError> {
    price_correction(tx, request, actor, false).await
}

async fn price_correction(
    tx: &mut Transaction<'_, Postgres>,
    request: &LayerPriceCorrection,
    actor: &str,
    post_journal: bool,
) -> Result<PriceCorrectionOutcome, AppError> {
    if request.amount_minor == 0 {
        return Err(AppError::Validation(
            "a price correction of nothing corrects nothing; if the supplier billed what was \
             agreed there is no correction to record"
                .into(),
        ));
    }
    let key = format!(
        "PRICE_CORRECTION|{}|{}|{}",
        request.source_id, request.layer_id, request.amount_minor
    );
    if let Some(existing) = replay(tx, &key).await? {
        let row = sqlx::query(
            "SELECT inventory_portion_minor, cogs_portion_minor
               FROM cost_layer_adjustment WHERE idempotency_key = $1",
        )
        .bind(&key)
        .fetch_optional(&mut **tx)
        .await?;
        let (inventory_minor, cogs_minor) = match row {
            Some(row) => (
                row.try_get::<Option<i64>, _>("inventory_portion_minor")?
                    .unwrap_or(0),
                row.try_get::<Option<i64>, _>("cogs_portion_minor")?
                    .unwrap_or(0),
            ),
            None => (0, 0),
        };
        let site: Option<String> =
            sqlx::query_scalar("SELECT site_id FROM cost_layer WHERE layer_id = $1")
                .bind(request.layer_id)
                .fetch_optional(&mut **tx)
                .await?;
        let affiliate_lines = price_correction_affiliate_lines(
            site.as_deref().unwrap_or_default(),
            request.amount_minor,
            super::poster::HEAD_OFFICE_SITE,
        );
        return Ok(PriceCorrectionOutcome {
            inventory_minor,
            cogs_minor,
            affiliate_lines,
            posting: existing,
        });
    }

    assert_period_open(tx, request.effective_date, "this price correction").await?;

    let article: Uuid = sqlx::query("SELECT article_id FROM cost_layer WHERE layer_id = $1")
        .bind(request.layer_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("cost layer {}", request.layer_id)))?
        .try_get("article_id")?;
    lock_article_basis(tx, article).await?;

    sqlx::query("SELECT layer_id FROM cost_layer WHERE layer_id = $1 FOR UPDATE")
        .bind(request.layer_id)
        .execute(&mut **tx)
        .await?;
    let row = sqlx::query(
        "SELECT received_quantity, remaining_quantity, site_id, economic_date
           FROM cost_layer_remaining WHERE layer_id = $1",
    )
    .bind(request.layer_id)
    .fetch_one(&mut **tx)
    .await?;
    let received: i64 = row.try_get("received_quantity")?;
    let remaining: i64 = row.try_get("remaining_quantity")?;
    let site: String = row.try_get("site_id")?;
    let layer_date: NaiveDate = row.try_get("economic_date")?;

    let split = split_price_correction(PriceCorrection {
        layer_quantity: received,
        consumed_quantity: received - remaining,
        amount_minor: request.amount_minor,
    })
    .map_err(|refusal| AppError::Validation(refusal.message().to_string()))?;

    // Every line sits at the layer's own location, which is where the goods
    // arrived and where the bill is. Splitting the cost-of-sales half across the
    // sites those particular pieces were sold at would need a per-site
    // consumption breakdown the company-wide queue deliberately does not keep —
    // and 0098 refuses a cross-location line anyway, because the honest credit
    // is an inter-unit balance no rule writes yet.
    let ho = super::poster::HEAD_OFFICE_SITE;
    // The stock adjustment stays where the goods are: on hand → inventory,
    // already sold → cost of sales (the split `split_price_correction` made).
    let mut stock_lines = Vec::with_capacity(2);
    let mut push_stock = |key: &str, amount: i64| {
        if amount > 0 {
            stock_lines.push(PostingLine::debit(key, &site, amount));
        } else if amount < 0 {
            stock_lines.push(PostingLine::credit(key, &site, -amount));
        }
    };
    push_stock("inventory", split.inventory_minor);
    push_stock("cogs", split.cogs_minor);
    // The supplier is head office's counterparty (owner rule, 25 Sep), so the
    // payable sits at dc. When the goods are in a shop the two are joined
    // through Atas Barang explicitly: the shop's debt to head office moves by
    // the correction, and head office's receivable from the shop moves with it.
    // The balancer cannot do this — it reads a credit at the shop as a
    // receivable, and a correction changes what the shop already owes.
    let payable_line = if request.amount_minor > 0 {
        // The supplier billed more: head office owes more.
        PostingLine::credit("trade_payable", ho, request.amount_minor)
    } else {
        PostingLine::debit("trade_payable", ho, -request.amount_minor)
    };
    let affiliate_lines = price_correction_affiliate_lines(&site, request.amount_minor, ho);

    // When this makes its own journal it posts the payable and the legs; when it
    // is journal-less the caller's document already credits the payable, so it
    // takes the stock half AND the Atas Barang legs and nothing else.
    let mut lines = stock_lines;
    if post_journal {
        lines.push(payable_line);
        lines.extend(affiliate_lines.iter().cloned());
    }

    let posted = if post_journal {
        Some(
            post(
                tx,
                &PostingIntent {
                    posting_date: request.effective_date,
                    source_kind: "LANDED_COST".into(),
                    source_id: Some(request.source_id.clone()),
                    rule_version: "price_correction/1".into(),
                    currency: "IDR".into(),
                    memo: Some(request.reason.clone()),
                    lines,
                },
                // The layer, again: one debit note can correct the price of two
                // receipts, and the split is a different sum on each of them.
                Some(&posting_purpose("PRICE_CORRECTION", request.layer_id)),
                actor,
            )
            .await?,
        )
    } else {
        None
    };

    sqlx::query(
        "INSERT INTO cost_layer_adjustment
           (adjustment_id, layer_id, component_type, amount_minor, effective_date, reason,
            actor, inventory_portion_minor, cogs_portion_minor, journal_entry_id,
            idempotency_key)
         VALUES ($1,$2,'PRICE_CORRECTION',$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(Uuid::new_v4())
    .bind(request.layer_id)
    .bind(request.amount_minor)
    .bind(request.effective_date)
    .bind(&request.reason)
    .bind(actor)
    .bind(split.inventory_minor)
    .bind(split.cogs_minor)
    .bind(posted.as_ref().map(|p| p.entry_id))
    .bind(&key)
    .execute(&mut **tx)
    .await?;

    // Only the inventory half reaches the stock ledger. The other half is a cost
    // of goods already sold: it is not in the stock, so putting it in the stock
    // ledger would make the ledger disagree with the account it is reconciled
    // against by exactly the amount that was already expensed.
    let (quantity_after, value_before) = running_position(tx, article).await?;
    let group = Uuid::new_v4();
    let entry_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO stock_ledger_entry
           (entry_id, posting_group_id, line_number, article_id, site_id, quantity, qty_delta,
            qty_after, cost_layer_id, valuation_rate_minor, stock_value_difference_minor,
            stock_value_after_minor, costing_method, event_kind, source_kind, source_id,
            economic_date, journal_entry_id, idempotency_key, actor)
         VALUES ($1,$2,1,$3,$4,0,0,$5,$6,$7,$8,$9,$10,'PRICE_CORRECTION','LANDED_COST',$11,$12,
                 $13,$14,$15)",
    )
    .bind(entry_id)
    .bind(group)
    .bind(article)
    .bind(&site)
    .bind(quantity_after)
    .bind(request.layer_id)
    // What the correction was worth per remaining piece, for reading. Zero when
    // the goods have all gone, which is the honest answer.
    .bind(if remaining > 0 {
        (split.inventory_minor / remaining).abs()
    } else {
        0
    })
    .bind(split.inventory_minor)
    .bind(value_before + split.inventory_minor)
    .bind(STOCK_LEDGER_METHOD)
    .bind(&request.source_id)
    .bind(request.effective_date)
    .bind(posted.as_ref().map(|p| p.entry_id))
    .bind(&key)
    .bind(actor)
    .execute(&mut **tx)
    .await?;

    Ok(PriceCorrectionOutcome {
        inventory_minor: split.inventory_minor,
        cogs_minor: split.cogs_minor,
        affiliate_lines,
        posting: StockLedgerPosting {
            posting_group_id: group,
            article_id: article,
            event_kind: "PRICE_CORRECTION".into(),
            quantity: 0,
            value_minor: request.amount_minor,
            economic_date: request.effective_date,
            journal_entry_id: posted.as_ref().map(|p| p.entry_id),
            journal_entry_number: posted.as_ref().map(|p| p.entry_number.clone()),
            allocations: vec![StockLedgerAllocation {
                entry_id,
                cost_layer_id: Some(request.layer_id),
                layer_economic_date: Some(layer_date),
                quantity: 0,
                valuation_rate_minor: None,
                value_minor: split.inventory_minor,
                qty_after: quantity_after,
                stock_value_after_minor: value_before + split.inventory_minor,
            }],
        },
    })
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/// One layer of the queue, as this module carries it internally.
struct QueuedLayer {
    layer_id: Uuid,
    economic_date: NaiveDate,
    remaining_quantity: i64,
    remaining_value_minor: i64,
}

/// The queue for one article, oldest first, with the layers locked.
///
/// Ordered by economic date, then recorded time, then id. The tie-breakers
/// matter: two deliveries accepted in the same second must consume in a fixed
/// order, or a rebuild produces a different allocation from the original run and
/// the two are indistinguishable from a bug.
/// Post the cost of goods sold while their SKU had no layer to take them from
/// (owner decision 2, stage 5): at the SKU's last known receipt cost, flagged
/// "cost pending", so the sales day still posts. `cost_pending_true_up` puts
/// it right when the receipt lands.
#[allow(clippy::too_many_arguments)]
pub async fn cost_pending_post(
    tx: &mut Transaction<'_, Postgres>,
    article_id: Uuid,
    quantity: i64,
    site_id: &str,
    economic_date: NaiveDate,
    source_id: &str,
    reason: &str,
    actor: &str,
) -> Result<(), AppError> {
    let unit = last_known_unit_cost(tx, article_id).await?;
    let provisional = unit.saturating_mul(quantity);
    let supply = article_is_supply(tx, article_id).await?;
    let (expense_key, stock_key) = if supply {
        ("customer_supplies", "bag_inventory")
    } else {
        ("cogs", "inventory")
    };
    let flag_id = Uuid::new_v4();
    let entry_id = if provisional > 0 {
        Some(
            post(
                tx,
                &PostingIntent {
                    posting_date: economic_date,
                    source_kind: "COGS_DAY".into(),
                    source_id: Some(source_id.to_string()),
                    rule_version: "cogs_day_pending/1".into(),
                    currency: "IDR".into(),
                    memo: Some(format!("HPP menunggu biaya: {quantity} x {unit}")),
                    lines: vec![
                        PostingLine::debit(expense_key, site_id, provisional),
                        PostingLine::credit(stock_key, site_id, provisional),
                    ],
                },
                Some(&format!("PENDING_{}", article_id.simple())),
                actor,
            )
            .await?
            .entry_id,
        )
    } else {
        None
    };
    sqlx::query(
        "INSERT INTO inventory_cost_flag
           (flag_id, article_id, kind, site_id, quantity, unit_cost_minor, provisional_minor,
            source_id, journal_entry_id, detail)
         VALUES ($1, $2, 'COST_PENDING', $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(flag_id)
    .bind(article_id)
    .bind(site_id)
    .bind(quantity)
    .bind(unit)
    .bind(provisional)
    .bind(source_id)
    .bind(entry_id)
    .bind(format!("biaya menunggu: {reason}"))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// When a layer lands for an article with sales still "cost pending", take
/// those units from the layers at their real cost and reverse the provisional
/// cost, so cost of sales ends at the provenance cost and 1029 equals the
/// layers again. A pending sale the layers still cannot cover stays open.
pub async fn cost_pending_true_up(
    tx: &mut Transaction<'_, Postgres>,
    article_id: Uuid,
    economic_date: NaiveDate,
) -> Result<(), AppError> {
    let pending = sqlx::query(
        "SELECT flag_id, site_id, quantity, provisional_minor, journal_entry_id
           FROM inventory_cost_flag
          WHERE article_id = $1 AND kind = 'COST_PENDING' AND status = 'OPEN'
          ORDER BY created_at",
    )
    .bind(article_id)
    .fetch_all(&mut **tx)
    .await?;
    let supply = article_is_supply(tx, article_id).await?;
    let (expense_key, stock_key) = if supply {
        ("customer_supplies", "bag_inventory")
    } else {
        ("cogs", "inventory")
    };
    for row in &pending {
        let flag_id: Uuid = row.try_get("flag_id")?;
        let site_id: String = row.try_get::<Option<String>, _>("site_id")?.unwrap_or_default();
        let quantity: i64 = row.try_get("quantity")?;
        let provisional: i64 = row.try_get("provisional_minor")?;
        let pool_id: String = sqlx::query_scalar(
            "SELECT id FROM operational_pool
              WHERE site_id = $1 AND group_code IN ('STORE_INVENTORY', 'WAREHOUSE')
              ORDER BY (group_code = 'STORE_INVENTORY') DESC, display_order LIMIT 1",
        )
        .bind(&site_id)
        .fetch_optional(&mut **tx)
        .await?
        .unwrap_or_else(|| format!("{site_id}.warehouse"));
        let source = format!("pending:{flag_id}");
        let consumed = stock_ledger_consume(
            tx,
            &StockOutflow {
                article_id,
                sku_id: None,
                epc: None,
                lot_reference: None,
                quantity,
                event_kind: "SALE".into(),
                event_id: source.clone(),
                from_pool_id: pool_id,
                site_id: site_id.clone(),
                economic_date,
                source_id: source.clone(),
                memo: Some("HPP diluruskan: biaya dari penerimaan".into()),
            },
            "system:cost-true-up",
        )
        .await;
        let Ok(consumed) = consumed else { break };
        let reversal = if provisional > 0 {
            Some(
                post(
                    tx,
                    &PostingIntent {
                        posting_date: economic_date,
                        source_kind: "COGS_DAY".into(),
                        source_id: Some(source.clone()),
                        rule_version: "cogs_day_true_up/1".into(),
                        currency: "IDR".into(),
                        memo: Some("HPP sementara dibalik".into()),
                        lines: vec![
                            PostingLine::debit(stock_key, &site_id, provisional),
                            PostingLine::credit(expense_key, &site_id, provisional),
                        ],
                    },
                    Some("TRUE_UP"),
                    "system:cost-true-up",
                )
                .await?
                .entry_id,
            )
        } else {
            None
        };
        sqlx::query(
            "UPDATE inventory_cost_flag
                SET status = 'RESOLVED', resolved_at = now(),
                    resolved_entry_id = COALESCE($2, $3)
              WHERE flag_id = $1",
        )
        .bind(flag_id)
        .bind(consumed.journal_entry_id)
        .bind(reversal)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// Book what allotments have dispatched and received since the last sweep,
/// per the client accountant's SJD rule (25 Sep), in both books:
///
/// * dispatch (SJD): sender Dr 1031 BDP / Cr 1029; receiver Dr 1031 BDP /
///   Cr 2029 Hutang Affiliasi Atas Barang (counter = head office);
/// * receipt: head office Dr 1058 Piutang Affiliasi Atas Barang (counter =
///   the unit) / Cr 1031; the unit Dr 1029 / Cr 1031.
///
/// Values at the article's provenance cost (its remaining layers; the last
/// receipt cost when none remain). Bags use 1030/1032 the same way. Each
/// site's lines balance on their own, so the poster adds no legs. A move
/// between two units (which the accountant routes through head office) is not
/// booked here yet and is left for Finance.
pub async fn stock_transfer_post_pending(pool: &PgPool, actor: &str) -> Result<i64, AppError> {
    let lines = sqlx::query(
        "SELECT l.id, l.source_site_id, l.destination_id, sk.article_id,
                a.created_at::date AS allotted_on,
                COALESCE(p.dispatched_quantity, l.dispatched_quantity)::bigint AS dispatched,
                COALESCE(p.received_quantity, l.received_quantity)::bigint AS received,
                COALESCE((SELECT SUM(t.quantity) FROM stock_transfer_posting t
                           WHERE t.allotment_line_id = l.id AND t.stage = 'DISPATCH'), 0)::bigint
                    AS booked_dispatch,
                COALESCE((SELECT SUM(t.quantity) FROM stock_transfer_posting t
                           WHERE t.allotment_line_id = l.id AND t.stage = 'RECEIPT'), 0)::bigint
                    AS booked_receipt
           FROM allotment_line l
           JOIN allotment a ON a.id = l.allotment_id
           JOIN sku sk ON sk.id = l.sku_id
           LEFT JOIN edge_allotment_line_progress p ON p.allotment_line_id = l.id
          WHERE l.destination_type = 'STORE' AND l.source_site_id IS NOT NULL
            AND l.source_site_id <> l.destination_id",
    )
    .fetch_all(pool)
    .await?;
    let mut booked = 0i64;
    let today = chrono::Utc::now().date_naive();
    for row in &lines {
        let line_id: Uuid = row.try_get("id")?;
        let source: String = row.try_get("source_site_id")?;
        let destination: String = row.try_get("destination_id")?;
        let article_id: Uuid = row.try_get("article_id")?;
        if source != super::poster::HEAD_OFFICE_SITE && destination != super::poster::HEAD_OFFICE_SITE {
            continue;
        }
        for (stage, done, already) in [
            ("DISPATCH", row.try_get::<i64, _>("dispatched")?, row.try_get::<i64, _>("booked_dispatch")?),
            ("RECEIPT", row.try_get::<i64, _>("received")?, row.try_get::<i64, _>("booked_receipt")?),
        ] {
            let delta = done - already;
            if delta <= 0 {
                continue;
            }
            let mut tx = pool.begin().await?;
            let supply = article_is_supply(&mut tx, article_id).await?;
            let (stock, transit, transit_q) = if supply {
                ("bag_inventory", "goods_in_transit", "BAG")
            } else {
                ("inventory", "goods_in_transit", "MERCHANDISE")
            };
            let unit: i64 = sqlx::query_scalar::<_, Option<i64>>(
                "SELECT (SUM(remaining_value_minor) / NULLIF(SUM(remaining_quantity), 0))::bigint
                   FROM cost_layer_remaining WHERE article_id = $1 AND remaining_quantity > 0",
            )
            .bind(article_id)
            .fetch_one(&mut *tx)
            .await?
            .unwrap_or(last_known_unit_cost(&mut tx, article_id).await?);
            let value = unit.saturating_mul(delta);
            let affiliate = |key: &str, site: &str, counter: &str, debit: bool| {
                let mut leg = if debit {
                    PostingLine::debit(key, site, value)
                } else {
                    PostingLine::credit(key, site, value)
                }
                .with_qualifier("BARANG");
                leg.counter_site_id = Some(counter.to_string());
                leg
            };
            // Goods in transit (1031) is a balance between two units, so each
            // leg names the unit on the other side of the journey — the poster
            // refuses a line on it that names only its own site.
            let in_transit = |site: &str, counter: &str, debit: bool| {
                let mut leg = if debit {
                    PostingLine::debit(transit, site, value)
                } else {
                    PostingLine::credit(transit, site, value)
                }
                .with_qualifier(transit_q);
                leg.counter_site_id = Some(counter.to_string());
                leg
            };
            let entry = if value > 0 {
                let lines = match stage {
                    "DISPATCH" => vec![
                        in_transit(&source, &destination, true),
                        PostingLine::credit(stock, &source, value),
                        in_transit(&destination, &source, true),
                        affiliate("affiliate_payable", &destination, &source, false),
                    ],
                    _ => vec![
                        affiliate("affiliate_receivable", &source, &destination, true),
                        in_transit(&source, &destination, false),
                        PostingLine::debit(stock, &destination, value),
                        in_transit(&destination, &source, false),
                    ],
                };
                Some(
                    post(
                        &mut tx,
                        &PostingIntent {
                            posting_date: today,
                            source_kind: "TRANSFER".into(),
                            source_id: Some(line_id.to_string()),
                            rule_version: "sjd_transfer/1".into(),
                            currency: "IDR".into(),
                            memo: Some(format!("{stage} {delta} unit {source} -> {destination}")),
                            lines,
                        },
                        Some(&format!("{stage}_{}_{}", already, done)),
                        actor,
                    )
                    .await?
                    .entry_id,
                )
            } else {
                None
            };
            sqlx::query(
                "INSERT INTO stock_transfer_posting
                   (allotment_line_id, stage, quantity, value_minor, journal_entry_id)
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(line_id)
            .bind(stage)
            .bind(delta)
            .bind(value)
            .bind(entry)
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            booked += 1;
        }
    }
    Ok(booked)
}

/// Whether an article is a customer supply (shopping bags), held on 1030.
pub async fn article_is_supply(
    tx: &mut Transaction<'_, Postgres>,
    article_id: Uuid,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar::<_, bool>(
        "SELECT is_customer_supply FROM article WHERE id = $1",
    )
    .bind(article_id)
    .fetch_optional(&mut **tx)
    .await?
    .unwrap_or(false))
}

/// Raise a MULTI_COST flag once for an article whose remaining layers carry
/// more than one unit cost.
async fn flag_multiple_costs(
    tx: &mut Transaction<'_, Postgres>,
    article_id: Uuid,
    source_id: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO inventory_cost_flag (flag_id, article_id, kind, source_id, detail)
         SELECT $1, $2, 'MULTI_COST', $3,
                'this SKU was received at ' || COUNT(DISTINCT r.unit_cost_minor)::text ||
                ' different unit costs; provenance expects one: review the receipts'
           FROM cost_layer_remaining r
          WHERE r.article_id = $2 AND r.remaining_quantity > 0
         HAVING COUNT(DISTINCT r.unit_cost_minor) > 1
            AND NOT EXISTS (SELECT 1 FROM inventory_cost_flag f
                             WHERE f.article_id = $2 AND f.kind = 'MULTI_COST'
                               AND f.status = 'OPEN')",
    )
    .bind(Uuid::new_v4())
    .bind(article_id)
    .bind(source_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// The last unit cost an article was received at, for a sale whose layers are
/// short (owner decision 2, stage 5). Zero when it has never been received.
pub async fn last_known_unit_cost(
    tx: &mut Transaction<'_, Postgres>,
    article_id: Uuid,
) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar::<_, i64>(
        "SELECT unit_cost_minor FROM cost_layer WHERE article_id = $1
          ORDER BY economic_date DESC, recorded_at DESC LIMIT 1",
    )
    .bind(article_id)
    .fetch_optional(&mut **tx)
    .await?
    .unwrap_or(0))
}

async fn read_queue(
    tx: &mut Transaction<'_, Postgres>,
    article_id: Uuid,
    as_of: Option<NaiveDate>,
) -> Result<Vec<QueuedLayer>, AppError> {
    // Locked in one statement, read in the next. `FOR UPDATE` cannot be applied
    // to the view that derives the residuals, and it would not be enough on its
    // own even if it could — the advisory lock above is what serialises this.
    sqlx::query(
        "SELECT layer_id FROM cost_layer
          WHERE article_id = $1 AND ($2::date IS NULL OR economic_date <= $2)
          ORDER BY economic_date, recorded_at, layer_id
          FOR UPDATE",
    )
    .bind(article_id)
    .bind(as_of)
    .execute(&mut **tx)
    .await?;

    let rows = sqlx::query(
        "SELECT layer_id, economic_date, remaining_quantity, remaining_value_minor
           FROM cost_layer_remaining
          WHERE article_id = $1 AND ($2::date IS NULL OR economic_date <= $2)
          ORDER BY economic_date, recorded_at, layer_id",
    )
    .bind(article_id)
    .bind(as_of)
    .fetch_all(&mut **tx)
    .await?;

    rows.iter()
        .map(|row| {
            Ok(QueuedLayer {
                layer_id: row.try_get("layer_id")?,
                economic_date: row.try_get("economic_date")?,
                remaining_quantity: row.try_get("remaining_quantity")?,
                remaining_value_minor: row.try_get("remaining_value_minor")?,
            })
        })
        .collect()
}

/// What one article is worth, and the queue behind that number.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ArticleValuation {
    pub article_id: Uuid,
    pub article_code: String,
    pub article_name: String,
    pub quantity: i64,
    pub value_minor: i64,
    /// Value over quantity, truncated. What the next piece out will cost only if
    /// every layer carries the same rate; the layers are the real answer.
    pub average_rate_minor: i64,
    pub layer_count: i64,
}

/// What one article is worth at one place.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SiteValuation {
    pub site_id: String,
    pub site_name: String,
    pub article_id: Uuid,
    pub article_code: String,
    pub quantity: i64,
    /// Quantity at this place times the article's company-wide average rate.
    ///
    /// A presentation figure, and it is worth being blunt about that. The FIFO
    /// queue is the company's, so there is no honest per-place split of it: the
    /// same shirt costs what it cost regardless of which shop is holding it.
    /// This answers "roughly how much stock is sitting there", which is a real
    /// question, and it is not what the inventory account is reconciled against.
    pub value_minor: i64,
}

/// Stock at cost, per article.
pub async fn stock_ledger_valuation(
    pool: &PgPool,
    article_code: Option<&str>,
    limit: i64,
) -> Result<Vec<ArticleValuation>, AppError> {
    let rows = sqlx::query(
        "SELECT r.article_id, a.article_code, a.name AS article_name,
                SUM(r.remaining_quantity)::bigint AS quantity,
                SUM(r.remaining_value_minor)::bigint AS value_minor,
                COUNT(*) FILTER (WHERE r.remaining_quantity > 0)::bigint AS layer_count
           FROM cost_layer_remaining r
           JOIN article a ON a.id = r.article_id
          WHERE ($1::text IS NULL OR a.article_code = $1)
          GROUP BY r.article_id, a.article_code, a.name
         HAVING SUM(r.remaining_quantity) > 0
          ORDER BY a.article_code
          LIMIT $2",
    )
    .bind(article_code)
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let quantity: i64 = row.try_get("quantity")?;
            let value: i64 = row.try_get("value_minor")?;
            Ok(ArticleValuation {
                article_id: row.try_get("article_id")?,
                article_code: row.try_get("article_code")?,
                article_name: row.try_get("article_name")?,
                quantity,
                value_minor: value,
                average_rate_minor: if quantity > 0 { value / quantity } else { 0 },
                layer_count: row.try_get("layer_count")?,
            })
        })
        .collect()
}

/// Stock at cost, per place. See `SiteValuation` for what that figure is and is
/// not.
pub async fn stock_ledger_valuation_by_site(
    pool: &PgPool,
    site_id: Option<&str>,
    limit: i64,
) -> Result<Vec<SiteValuation>, AppError> {
    let rows = sqlx::query(
        "WITH moved AS (
             SELECT e.article_id, p.site_id, SUM(e.quantity)::bigint AS quantity
               FROM stock_ledger_entry e JOIN operational_pool p ON p.id = e.to_pool_id
              GROUP BY 1, 2
             UNION ALL
             SELECT e.article_id, p.site_id, -SUM(e.quantity)::bigint
               FROM stock_ledger_entry e JOIN operational_pool p ON p.id = e.from_pool_id
              GROUP BY 1, 2
         ), position AS (
             SELECT article_id, site_id, SUM(quantity)::bigint AS quantity
               FROM moved GROUP BY 1, 2 HAVING SUM(quantity) > 0
         ), rate AS (
             SELECT article_id,
                    CASE WHEN SUM(remaining_quantity) > 0
                         THEN SUM(remaining_value_minor) / SUM(remaining_quantity)
                         ELSE 0 END AS average_rate
               FROM cost_layer_remaining GROUP BY 1
         )
         SELECT p.site_id, s.name AS site_name, p.article_id, a.article_code, p.quantity,
                (p.quantity * COALESCE(r.average_rate, 0))::bigint AS value_minor
           FROM position p
           JOIN site s ON s.id = p.site_id
           JOIN article a ON a.id = p.article_id
           LEFT JOIN rate r ON r.article_id = p.article_id
          WHERE ($1::text IS NULL OR p.site_id = $1)
          ORDER BY p.site_id, a.article_code
          LIMIT $2",
    )
    .bind(site_id)
    .bind(limit.clamp(1, 2_000))
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            Ok(SiteValuation {
                site_id: row.try_get("site_id")?,
                site_name: row.try_get("site_name")?,
                article_id: row.try_get("article_id")?,
                article_code: row.try_get("article_code")?,
                quantity: row.try_get("quantity")?,
                value_minor: row.try_get("value_minor")?,
            })
        })
        .collect()
}

/// The FIFO queue for one article, oldest first.
///
/// The layers are the answer, not decoration. "140 pieces worth 18.2m" cannot
/// tell you what the next sale will cost; "40 at 125k then 100 at 130k" can.
pub async fn cost_layer_queue(
    pool: &PgPool,
    article_code: &str,
) -> Result<Vec<CostLayerView>, AppError> {
    let rows = sqlx::query(
        "SELECT r.layer_id, r.economic_date, r.site_id, r.received_quantity,
                r.remaining_quantity, r.remaining_value_minor, r.effective_cost_minor,
                r.unit_cost_minor, l.source_reference, l.supplier_id
           FROM cost_layer_remaining r
           JOIN cost_layer l ON l.layer_id = r.layer_id
           JOIN article a ON a.id = r.article_id
          WHERE a.article_code = $1
          ORDER BY r.economic_date, r.recorded_at, r.layer_id",
    )
    .bind(article_code)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .enumerate()
        .map(|(index, row)| {
            Ok(CostLayerView {
                layer_id: row.try_get("layer_id")?,
                economic_date: row.try_get("economic_date")?,
                site_id: row.try_get("site_id")?,
                received_quantity: row.try_get("received_quantity")?,
                remaining_quantity: row.try_get("remaining_quantity")?,
                remaining_value_minor: row.try_get("remaining_value_minor")?,
                effective_cost_minor: row.try_get("effective_cost_minor")?,
                unit_cost_minor: row.try_get("unit_cost_minor")?,
                source_reference: row.try_get("source_reference")?,
                supplier_id: row.try_get("supplier_id")?,
                position: index as i32 + 1,
            })
        })
        .collect()
}

/// Why one journal entry cost what it did.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StockLedgerExplanation {
    pub journal_entry_id: Uuid,
    pub entry_number: String,
    pub source_kind: String,
    pub source_id: Option<String>,
    pub posting_date: NaiveDate,
    pub total_minor: i64,
    /// Every stock ledger entry behind it, in the order the queue was read.
    pub postings: Vec<StockLedgerPosting>,
}

/// Reconstruct which layers a posting took and why it cost what it did.
pub async fn stock_ledger_explain(
    pool: &PgPool,
    journal_entry_id: Uuid,
) -> Result<StockLedgerExplanation, AppError> {
    let header = sqlx::query(
        "SELECT entry_number, source_kind, source_id, posting_date, total_minor
           FROM journal_entry WHERE entry_id = $1",
    )
    .bind(journal_entry_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("journal entry {journal_entry_id}")))?;

    let rows = sqlx::query(
        "SELECT e.entry_id, e.posting_group_id, e.article_id, e.event_kind, e.quantity,
                e.cost_layer_id, e.valuation_rate_minor, e.stock_value_difference_minor,
                e.qty_after, e.stock_value_after_minor, e.economic_date, e.journal_entry_id,
                j.entry_number, l.economic_date AS layer_date
           FROM stock_ledger_entry e
           LEFT JOIN journal_entry j ON j.entry_id = e.journal_entry_id
           LEFT JOIN cost_layer l ON l.layer_id = e.cost_layer_id
          WHERE e.journal_entry_id = $1
          ORDER BY e.posting_group_id, e.line_number",
    )
    .bind(journal_entry_id)
    .fetch_all(pool)
    .await?;

    let mut postings: Vec<StockLedgerPosting> = Vec::new();
    let mut group: Vec<sqlx::postgres::PgRow> = Vec::new();
    let mut current: Option<Uuid> = None;
    for row in rows {
        let id: Uuid = row.try_get("posting_group_id")?;
        if current != Some(id) && !group.is_empty() {
            postings.push(collect_posting(&group)?);
            group.clear();
        }
        current = Some(id);
        group.push(row);
    }
    if !group.is_empty() {
        postings.push(collect_posting(&group)?);
    }

    Ok(StockLedgerExplanation {
        journal_entry_id,
        entry_number: header.try_get("entry_number")?,
        source_kind: header.try_get("source_kind")?,
        source_id: header.try_get("source_id")?,
        posting_date: header.try_get("posting_date")?,
        total_minor: header.try_get("total_minor")?,
        postings,
    })
}

/// The stock ledger against the account it is supposed to be describing.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StockLedgerIntegrity {
    pub as_of: NaiveDate,
    /// Summed from `stock_ledger_entry`. What the goods on hand cost.
    pub stock_ledger_value_minor: i64,
    /// Summed from `journal_line` over every account the `inventory` meaning
    /// resolves to. What the books say the goods on hand cost.
    pub ledger_balance_minor: i64,
    /// Ledger minus stock ledger. Zero is the only good answer.
    pub difference_minor: i64,
    /// The accounts that were summed, so a difference can be chased without
    /// guessing which codes the meaning resolves to today.
    pub control_accounts: Vec<String>,
    /// What the difference most likely is, when there is one. A sentence rather
    /// than a number, because the number is already above and what a person
    /// needs is where to look.
    pub note: String,
}

/// Compare the stock ledger with the general ledger's inventory control
/// balance.
///
/// Company-wide on both sides, and that is not laziness. The FIFO queue is the
/// company's, so the stock ledger has no per-place value to compare against a
/// per-place account — see `SiteValuation`. A site-by-site comparison would
/// also be wrong for a second reason today: nothing yet moves value between the
/// locations' inventory leaves when goods are transferred, so a store's own
/// account has never been debited for the goods it is selling.
pub async fn stock_ledger_integrity(
    pool: &PgPool,
    as_of: NaiveDate,
) -> Result<StockLedgerIntegrity, AppError> {
    let stock: i64 = sqlx::query(
        "SELECT COALESCE(SUM(stock_value_difference_minor), 0)::bigint AS value
           FROM stock_ledger_entry WHERE economic_date <= $1",
    )
    .bind(as_of)
    .fetch_one(pool)
    .await?
    .try_get("value")?;

    // Resolved through the map, never named here. A module that spelled
    // `1011201001` would be a module the client cannot renumber their own chart
    // without recompiling.
    let accounts: Vec<String> = sqlx::query(
        "SELECT DISTINCT account_code FROM account_resolution WHERE role = 'inventory'
          ORDER BY account_code",
    )
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| row.try_get::<String, _>("account_code"))
    .collect::<Result<_, _>>()?;

    let ledger: i64 = if accounts.is_empty() {
        0
    } else {
        sqlx::query(
            "SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint AS balance
               FROM journal_line l
               JOIN journal_entry e ON e.entry_id = l.entry_id
              WHERE e.posting_date <= $1 AND l.account_code = ANY($2)",
        )
        .bind(as_of)
        .bind(&accounts)
        .fetch_one(pool)
        .await?
        .try_get("balance")?
    };

    let difference = ledger - stock;
    let note = if accounts.is_empty() {
        "The `inventory` meaning is not mapped to any account, so there is nothing to compare \
         the stock ledger against. Link it on the Account Links screen."
            .to_string()
    } else if difference == 0 {
        "The stock ledger and the inventory control account agree.".to_string()
    } else if difference > 0 {
        format!(
            "The books carry {difference} more than the goods on hand cost. The usual reason is \
             a supplier bill that debited inventory for goods no cost layer was opened for — \
             goods receipts have not been wired through to the stock ledger yet."
        )
    } else {
        format!(
            "The goods on hand cost {} more than the books carry. The usual reason is a cost \
             layer opened for a delivery whose bill has not arrived: the stock is real and the \
             liability has not been recorded.",
            -difference
        )
    };

    Ok(StockLedgerIntegrity {
        as_of,
        stock_ledger_value_minor: stock,
        ledger_balance_minor: ledger,
        difference_minor: difference,
        control_accounts: accounts,
        note,
    })
}

/// Which article a SKU belongs to.
///
/// Here rather than at each caller because the FIFO scope is the article and
/// most callers hold a SKU: a sale line names one, a movement names one. Doing
/// the lookup in one place is what stops somebody deciding the queue is the
/// SKU's.
pub async fn cost_layer_article_for_sku(pool: &PgPool, sku_id: Uuid) -> Result<Uuid, AppError> {
    sqlx::query("SELECT article_id FROM sku WHERE id = $1")
        .bind(sku_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("sku {sku_id}")))?
        .try_get("article_id")
        .map_err(AppError::from)
}

/// Which client account a meaning resolves to at a location.
///
/// Re-exported for the integrity screen, which shows the codes it summed so a
/// difference can be chased without guessing.
pub async fn stock_ledger_control_account(
    pool: &PgPool,
    site_id: &str,
) -> Result<String, AppError> {
    resolve_account_code(pool, "inventory", site_id, "").await
}
