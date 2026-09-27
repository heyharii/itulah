//! The rest of the payables flow: valuing a delivery, agreeing a bill against
//! it, taking part of it back, paying before it arrives, and keeping tax back
//! when it is paid for.
//!
//! # Why this is one module and not five
//!
//! Because it is one loop, and the accounts only make sense as a loop. A
//! delivery credits `trade_payable` as soon as accepted goods are received; the
//! supplier bill completes that debt with tax and invoice terms; a credit note
//! debits it back; an advance sits in `advance_purchase` until a bill exists to
//! set it against; and the payment that finally settles the bill splits between
//! the bank and the tax office. Split across five files, the property that ties
//! them — that every account this lane opens is emptied again by the next
//! document — would be five people's business and nobody's.
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

use super::payment_ledger::{
    ple_delink, ple_open, ple_settle_claim, PaymentLedgerClaim, PaymentLedgerItem,
    PaymentLedgerPartyType, PaymentLedgerSide,
};
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

/// Where a bill that disagrees with the order puts the difference.
const VARIANCE: &str = "purchase_price_variance";
/// Money paid to a supplier before there is anything to owe them for.
const ADVANCE: &str = "advance_purchase";
/// The bank's own charge for making the transfer.
const BANK_CHARGE: &str = "bank_admin_fee";

// ---------------------------------------------------------------------------
// The two ledgers this one has to meet
// ---------------------------------------------------------------------------
//
// Both were written in parallel by somebody else, and both would have been
// half-built and wrong if this lane had guessed at them. So each is one
// function here, called at the exact point it belongs, taking exactly the
// arguments its owner asked for. The Payment Ledger has since landed and the
// three below are its own calls; the Stock Ledger's is still a stub with its
// reason under it.
//
// Deliberately not traits, not events and not a table: a hook that had a shape
// of its own would be a shape the real ledger then has to agree with.

/// What a bill's payable is filed under in the Payment Ledger.
const BILL_VOUCHER: &str = "SUPPLIER_INVOICE";

/// The claim a document makes on one bill's payable.
///
/// Every settling document in this lane — a payment, a credit note, an advance
/// being set against a bill — answers a NAMED invoice, so the claim always
/// carries one. That is the argument the old hook could not: it had a party and
/// an amount, and any allocation it chose on its own would have been oldest
/// first, quietly settling a different bill from the one the document says it
/// settles.
fn against_bill<'a>(
    account_key: &'a str,
    site_id: &'a str,
    supplier_id: &'a str,
    bill: &'a str,
) -> PaymentLedgerClaim<'a> {
    PaymentLedgerClaim {
        account_key,
        qualifier: "",
        site_id,
        party_type: PaymentLedgerPartyType::Supplier,
        party_id: supplier_id,
        voucher_kind: Some(BILL_VOUCHER),
        voucher_id: Some(bill),
    }
}

/// Which payable a document of this kind credited.
///
/// One place, because four call sites were each spelling the same conditional
/// and a fifth would have spelled it slightly differently.
pub(super) const fn payable_key(kind_is_expense: bool) -> &'static str {
    if kind_is_expense {
        "non_merchandise_payable"
    } else {
        "trade_payable"
    }
}

/// Open the payable a posted bill raised.
///
/// The `CREDIT` half of the hook this replaces, plus the two things `ple_open`
/// needs and that signature could not carry: the date the entry was posted on,
/// and who posted it. The item's posting date is the ENTRY's, not the bill's,
/// because `payment_ledger_integrity` winds both sides back to the same day and
/// a ledger dated differently from its own journal entry would disagree with
/// the books between the two dates.
///
/// One accommodation, stated because it is one. `ple_open` refuses an item that
/// falls due before it was posted, which is right for a document somebody is
/// keying today and wrong for a bill keyed a fortnight after its terms ran out
/// — an ordinary thing here. Such a bill is opened as due on the day it entered
/// the books: the closest true sentence the constraint allows, and it ages from
/// that day rather than from a date the ledger never knew it was open on.
#[allow(clippy::too_many_arguments)]
pub(super) async fn payable_opened(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    account_key: &str,
    voucher_kind: &str,
    site_id: &str,
    supplier_id: &str,
    supplier_name: Option<&str>,
    voucher_id: Uuid,
    amount_minor: i64,
    due_date: Option<NaiveDate>,
    posting_date: NaiveDate,
    journal_entry_id: Uuid,
    actor: &str,
) -> Result<(), AppError> {
    // A bill for nothing raises no debt. It cannot post either — the poster
    // refuses an entry with no amount — but saying so here keeps the ledger's
    // own refusal for the case it is about.
    if amount_minor <= 0 {
        return Ok(());
    }
    ple_open(
        tx,
        &PaymentLedgerItem {
            account_key: account_key.to_string(),
            qualifier: String::new(),
            site_id: site_id.to_string(),
            party_type: PaymentLedgerPartyType::Supplier,
            party_id: supplier_id.to_string(),
            party_name: supplier_name.map(str::to_string),
            voucher_kind: voucher_kind.to_string(),
            voucher_id: voucher_id.to_string(),
            journal_entry_id,
            side: PaymentLedgerSide::Payable,
            amount_minor,
            currency: "IDR".to_string(),
            due_date: due_date.map(|due| due.max(posting_date)),
            posting_date,
        },
        actor,
    )
    .await?;
    Ok(())
}

/// Put a settling document against one named bill's payable.
///
/// The `DEBIT` half, and the reason the pair had to be redesigned rather than
/// wired: this carries the bill. A payment allocates per invoice, a credit note
/// is written against one, and an advance is set against one — so in every case
/// the document already knows which debt it answers, and the ledger is told
/// rather than left to guess.
///
/// A bill the ledger holds nothing open for settles nothing and says so by
/// doing nothing: either it is already answered, or it was posted before this
/// ledger followed it. Settling more than is open is refused, because a
/// document that answers a debt nobody raised is the difference
/// `payment_ledger_integrity` would otherwise report for ever.
#[allow(clippy::too_many_arguments)]
pub(super) async fn payable_settled(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    account_key: &str,
    site_id: &str,
    supplier_id: &str,
    bill_id: Uuid,
    against_voucher_kind: &str,
    against_voucher_id: Uuid,
    amount_minor: i64,
    posting_date: NaiveDate,
    journal_entry_id: Uuid,
    actor: &str,
) -> Result<(), AppError> {
    let bill = bill_id.to_string();
    ple_settle_claim(
        tx,
        &against_bill(account_key, site_id, supplier_id, &bill),
        against_voucher_kind,
        &against_voucher_id.to_string(),
        journal_entry_id,
        posting_date,
        amount_minor,
        actor,
    )
    .await?;
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
///
/// Open the cost layer for a receipt line that was valued before its article
/// existed — the usual order: the receipt posts within a minute of being
/// accepted, merchandising sets the article up later. Called in the setup's
/// own transaction, right after the article is minted. A line not valued yet
/// is left to the receipt posting, which will find the article through this
/// setup; `cost_layer_create` is idempotent, so the two can never both open it.
pub(super) async fn cost_layer_on_setup(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    receipt_line_id: Uuid,
) -> Result<(), AppError> {
    let Some(line) = sqlx::query(
        "SELECT l.receipt_id, pl.article_code, l.quantity, pl.unit_price_minor,
                site_local_date(l.verified_at, (SELECT gr.site_id FROM goods_receipt gr WHERE gr.receipt_id = l.receipt_id)) AS accepted_on
           FROM goods_receipt_line l
           JOIN purchase_order_line pl ON pl.po_line_id = l.po_line_id
          WHERE l.receipt_line_id = $1 AND l.posting_id IS NOT NULL",
    )
    .bind(receipt_line_id)
    .fetch_optional(&mut **tx)
    .await?
    else {
        return Ok(());
    };
    lane_i_cost_layer(
        tx,
        line.try_get("article_code")?,
        line.try_get("quantity")?,
        line.try_get("unit_price_minor")?,
        line.try_get("accepted_on")?,
        line.try_get("receipt_id")?,
        receipt_line_id,
    )
    .await
}

/// Finance Connect stage 5 (owner decision): the receipt creates the layer at
/// qty x PO price, and any sale that was posted while this SKU had no layer
/// ("cost pending") is trued up against it in the same transaction.
pub(super) async fn lane_i_cost_layer(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    article_code: &str,
    quantity: i64,
    unit_cost_minor: i64,
    economic_date: NaiveDate,
    receipt_id: Uuid,
    receipt_line_id: Uuid,
) -> Result<(), AppError> {
    if quantity <= 0 {
        return Ok(());
    }
    // A sourced line carries the SUPPLIER's code; merchandising mints the
    // article under a new 8-digit code at setup, and the setup session is the
    // only thing that knows the two are the same goods. So: the code itself
    // first (a re-order of an existing article), then the article the setup of
    // this very receipt line minted.
    let Some(article_id) = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM (
             SELECT id, 0 AS rank FROM article WHERE article_code = $1
             UNION ALL
             SELECT a.id, 1 AS rank
               FROM article_setup_session s
               JOIN article a ON a.article_code = s.article_code
              WHERE s.receipt_line_id = $2
         ) found ORDER BY rank LIMIT 1",
    )
    .bind(article_code)
    .bind(receipt_line_id)
    .fetch_optional(&mut **tx)
    .await?
    else {
        // Not set up yet. The valuation entry beside it still stands, and the
        // layer is opened when the setup is issued (`cost_layer_on_setup`).
        tracing::info!(article = article_code, receipt = %receipt_id, "receipt line not set up yet; its cost layer opens at setup");
        return Ok(());
    };
    let (site_id, supplier_id): (String, Option<String>) = sqlx::query_as(
        "SELECT site_id, supplier_id::text FROM goods_receipt WHERE receipt_id = $1",
    )
    .bind(receipt_id)
    .fetch_one(&mut **tx)
    .await?;
    let pool_id: String = sqlx::query_scalar(
        "SELECT id FROM operational_pool
          WHERE site_id = $1 AND group_code IN ('WAREHOUSE', 'STORE_INVENTORY')
          ORDER BY (group_code = 'WAREHOUSE') DESC, display_order
          LIMIT 1",
    )
    .bind(&site_id)
    .fetch_optional(&mut **tx)
    .await?
    .unwrap_or_else(|| format!("{site_id}.warehouse"));
    super::stock_ledger::cost_layer_create(
        tx,
        &super::stock_ledger::NewCostLayer {
            article_id,
            quantity,
            gross_cost_minor: quantity.saturating_mul(unit_cost_minor),
            discount_minor: 0,
            economic_date,
            site_id,
            to_pool_id: pool_id,
            receipt_id: Some(receipt_id),
            receipt_line_id: Some(receipt_line_id),
            source_reference: None,
            supplier_id,
            source_kind: "GOODS_RECEIPT".into(),
            // Per LINE, not per article: the DC keeps a supplier's receipt open
            // across deliveries, and the same shirt in the same quantity twice
            // on one receipt is two layers — keyed by article, the second would
            // have been handed the first one back and never costed (0390).
            source_id: receipt_line_id.to_string(),
        },
        "system:goods-receipt",
    )
    .await?;
    super::stock_ledger::cost_pending_true_up(tx, article_id, economic_date).await
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

/// The receipt as one answer across its tranches (0390).
///
/// A receipt is valued once per tranche of lines, so "what has this delivery
/// done in the ledger" is a sum. The entry, date and reversal quoted are the
/// latest tranche still standing — or, when every tranche has been reversed,
/// the latest one, so a fully un-valued delivery still says so.
const POSTING_SQL: &str = "SELECT p.receipt_id, r.receipt_number, r.supplier_id, r.site_id,
     s.value_minor, p.posting_date, p.currency, p.journal_entry_id, p.posted_by, p.posted_at,
     p.reversal_entry_id, p.reversal_reason, p.reversed_by, p.reversed_at,
     (SELECT e.entry_number FROM journal_entry e WHERE e.entry_id = p.journal_entry_id)
         AS entry_number,
     (SELECT e.entry_number FROM journal_entry e WHERE e.entry_id = p.reversal_entry_id)
         AS reversal_entry_number
   FROM goods_receipt_posting p
   JOIN goods_receipt r USING (receipt_id)
   CROSS JOIN LATERAL (
       SELECT (CASE WHEN bool_or(q.reversal_entry_id IS NULL)
                    THEN SUM(q.value_minor) FILTER (WHERE q.reversal_entry_id IS NULL)
                    ELSE SUM(q.value_minor) END)::bigint AS value_minor
         FROM goods_receipt_posting q
        WHERE q.receipt_id = p.receipt_id
   ) s
  WHERE p.receipt_id = $1
  ORDER BY (p.reversal_entry_id IS NULL) DESC, p.posted_at DESC, p.posting_id DESC
  LIMIT 1";

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
    let row = sqlx::query(POSTING_SQL)
        .bind(receipt_id)
        .fetch_optional(pool)
        .await?;
    row.as_ref().map(to_posting).transpose()
}

/// When a delivery's debt falls due, before any bill says so.
///
/// Payment terms count from the bill, and a delivery has none yet. Until it
/// does, the delivery stands in for it: the supplier's standing terms are
/// counted from the day the goods were accepted, to the LAST instalment — the
/// balance this delivery leaves owing. A supplier with no terms is owed on
/// delivery. The bill, when it posts, replaces this with its own schedule.
async fn receipt_due_date(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    supplier_code: &str,
    accepted_on: NaiveDate,
) -> Result<NaiveDate, AppError> {
    let due: Option<NaiveDate> = sqlx::query_scalar(
        "SELECT CASE t.basis
                    WHEN 'DAYS_AFTER_BILL' THEN $2::date + t.offset_value
                    WHEN 'DAYS_AFTER_BILL_MONTH_END'
                        THEN (date_trunc('month', $2::date) + interval '1 month - 1 day')::date
                             + t.offset_value
                    WHEN 'MONTHS_AFTER_BILL_MONTH_END'
                        THEN (date_trunc('month', $2::date)
                              + make_interval(months => t.offset_value + 1)
                              - interval '1 day')::date
                END
           FROM supplier s
           JOIN payment_terms_template_line tl
             ON tl.template_code = COALESCE(s.payment_terms_template_code,
                                            s.default_payment_terms_code)
           JOIN payment_term t ON t.code = tl.term_code
          WHERE s.supplier_code = $1
          ORDER BY tl.seq DESC
          LIMIT 1",
    )
    .bind(supplier_code)
    .bind(accepted_on)
    .fetch_optional(&mut **tx)
    .await?
    .flatten();
    Ok(due.unwrap_or(accepted_on).max(accepted_on))
}

/// Value a delivery's accepted lines into the ledger.
///
///     Dr inventory        at the receiving location
///     Cr trade_payable at head office, carrying the supplier
///
/// The supplier is a dimension on the LINE rather than a qualifier on the
/// account, exactly as `trade_payable` does it. A qualifier would mean a row in
/// `account_map` per supplier and a posting that refuses the first time somebody
/// buys from a new one; `journal_line.party_type`/`party_id` already carry the
/// sub-ledger, and every ageing projection already reads it.
///
/// Values exactly the lines no tranche has valued yet (0390), one tranche per
/// day the goods were accepted — the DC keeps a supplier's receipt open across
/// deliveries, so a receipt that is already in the books can gain lines, and
/// those are owed too. With nothing left to value it answers with what the
/// delivery already stands at, so the sweep, the applier and a person can all
/// call it without stepping on each other.
///
/// `posting_date`, when given, is finance saying which open period carries the
/// lot, and they go as one tranche on that date.
pub async fn receipt_post(
    pool: &PgPool,
    receipt_id: Uuid,
    posting_date: Option<NaiveDate>,
    actor: &str,
) -> Result<ReceiptPosting, AppError> {
    // The days still to value, in the receiving site's own calendar
    // (`site.timezone`, 0603): a lorry accepted at half past six in the
    // morning was accepted that day, not the day before, whatever UTC says.
    let days: Vec<NaiveDate> = sqlx::query_scalar(
        "SELECT DISTINCT site_local_date(l.verified_at, (SELECT gr.site_id FROM goods_receipt gr WHERE gr.receipt_id = l.receipt_id))
           FROM goods_receipt_line l
          WHERE l.receipt_id = $1 AND l.posting_id IS NULL
          ORDER BY 1",
    )
    .bind(receipt_id)
    .fetch_all(pool)
    .await?;

    if days.is_empty() {
        return match receipt_posting(pool, receipt_id).await? {
            Some(existing) => Ok(existing),
            None => {
                let number: Option<String> = sqlx::query_scalar(
                    "SELECT receipt_number FROM goods_receipt WHERE receipt_id = $1",
                )
                .bind(receipt_id)
                .fetch_optional(pool)
                .await?;
                let number = number.ok_or_else(|| AppError::NotFound("goods receipt".into()))?;
                Err(AppError::Validation(format!(
                    "delivery {number} has no accepted lines; there is no entry to make until \
                     goods on it are accepted against an order line"
                )))
            }
        };
    }

    match posting_date {
        Some(date) => receipt_post_tranche(pool, receipt_id, None, date, actor).await?,
        None => {
            for day in days {
                receipt_post_tranche(pool, receipt_id, Some(day), day, actor).await?;
            }
        }
    }

    receipt_posting(pool, receipt_id)
        .await?
        .ok_or_else(|| AppError::NotFound("goods receipt posting".into()))
}

/// One tranche: the unvalued lines accepted on `accepted_on` (all of them when
/// `None`), valued in one entry on `date`.
async fn receipt_post_tranche(
    pool: &PgPool,
    receipt_id: Uuid,
    accepted_on: Option<NaiveDate>,
    date: NaiveDate,
    actor: &str,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    // The receipt row is the lock. Two posters — the applier and the sweep, or
    // a person — would otherwise both read the same unvalued lines and value
    // them twice.
    let header = sqlx::query(
        "SELECT r.receipt_number, r.supplier_id, r.site_id, r.arrived_at,
                (SELECT s.name FROM supplier s WHERE s.supplier_code = r.supplier_id) AS supplier_name,
                (SELECT COUNT(*) FROM goods_receipt_posting p
                  WHERE p.receipt_id = r.receipt_id)::bigint AS tranches
           FROM goods_receipt r
          WHERE r.receipt_id = $1
          FOR UPDATE OF r",
    )
    .bind(receipt_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("goods receipt".into()))?;
    let number: String = header.try_get("receipt_number")?;
    let supplier_id: String = header.try_get("supplier_id")?;
    let site_id: String = header.try_get("site_id")?;
    let supplier_name: Option<String> = header.try_get("supplier_name")?;
    let tranches: i64 = header.try_get("tranches")?;

    let lines = sqlx::query(
        "SELECT l.receipt_line_id, pl.article_code, l.quantity, pl.unit_price_minor,
                site_local_date(l.verified_at, (SELECT gr.site_id FROM goods_receipt gr WHERE gr.receipt_id = l.receipt_id)) AS accepted_on
           FROM goods_receipt_line l
           JOIN purchase_order_line pl ON pl.po_line_id = l.po_line_id
          WHERE l.receipt_id = $1
            AND l.posting_id IS NULL
            AND ($2::date IS NULL OR site_local_date(l.verified_at, (SELECT gr.site_id FROM goods_receipt gr WHERE gr.receipt_id = l.receipt_id)) = $2)
          ORDER BY pl.line_number, l.receipt_line_id",
    )
    .bind(receipt_id)
    .bind(accepted_on)
    .fetch_all(&mut *tx)
    .await?;
    if lines.is_empty() {
        // Somebody else valued them between the read and the lock.
        return Ok(());
    }

    let mut value: i64 = 0;
    let mut line_ids = Vec::with_capacity(lines.len());
    for line in &lines {
        let quantity: i64 = line.try_get("quantity")?;
        let price: i64 = line.try_get("unit_price_minor")?;
        value = value.saturating_add(quantity.saturating_mul(price));
        line_ids.push(line.try_get::<Uuid, _>("receipt_line_id")?);
    }
    if value <= 0 {
        return Err(AppError::Validation(format!(
            "delivery {number} is worth nothing at the ordered price; there is no entry to make \
             until it has lines against an order line that carries one"
        )));
    }

    // The first tranche is the receipt itself — the voucher id and purpose
    // every receipt posted before 0390 already carries. Later ones are named.
    let (posting_id, purpose) = if tranches == 0 {
        (receipt_id, super::poster::MAIN.to_string())
    } else {
        (Uuid::new_v4(), format!("TRANCHE_{}", tranches + 1))
    };

    let head_office = super::sites::head_office_site_id(&mut *tx).await?;
    let intent = PostingIntent {
        posting_date: date,
        source_kind: "GOODS_RECEIPT".into(),
        source_id: Some(receipt_id.to_string()),
        rule_version: "goods_receipt/2".into(),
        currency: "IDR".into(),
        memo: Some(format!("{number} {supplier_id}")),
        // The goods land where they were delivered; the supplier payable is
        // head office's and only head office's (owner rule, 25 Sep). A delivery
        // straight to a shop therefore posts inventory at the shop and the
        // payable at dc, and the poster's balancer adds the affiliate legs:
        // shop Dr inventory / Cr 2029 Atas Barang, head office Dr 1058 / Cr 2002.
        lines: vec![
            PostingLine::debit("inventory", &site_id, value),
            PostingLine::credit("trade_payable", &head_office, value).for_supplier(&supplier_id),
        ],
    };

    // Asked before the poster, which numbers the entry before the journal's
    // own period check refuses it: a delivery waiting for its month to open is
    // retried every minute, and each refusal would otherwise spend a JV number.
    super::stock_ledger::assert_period_open(&mut tx, date, "a goods receipt").await?;
    let posted = post(&mut tx, &intent, Some(&purpose), actor).await?;
    sqlx::query(
        "INSERT INTO goods_receipt_posting
           (posting_id, receipt_id, journal_entry_id, value_minor, posting_date, currency,
            posted_by)
         VALUES ($1,$2,$3,$4,$5,'IDR',$6)",
    )
    .bind(posting_id)
    .bind(receipt_id)
    .bind(posted.entry_id)
    .bind(value)
    .bind(date)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE goods_receipt_line SET posting_id = $1 WHERE receipt_line_id = ANY($2)")
        .bind(posting_id)
        .bind(&line_ids)
        .execute(&mut *tx)
        .await?;

    let due = receipt_due_date(&mut tx, &supplier_id, date).await?;
    payable_opened(
        &mut tx,
        "trade_payable",
        "GOODS_RECEIPT",
        &head_office,
        &supplier_id,
        supplier_name.as_deref(),
        posting_id,
        value,
        Some(due),
        date,
        posted.entry_id,
        actor,
    )
    .await?;

    // The layers, one per accepted line, in the same transaction as the entry
    // that values them. Inside rather than after, so a ledger that says the
    // stock is worth something and layers that say it is worth nothing cannot
    // both be committed. Dated the day each line was accepted: a layer is
    // consumed in the order the goods turned up.
    for line in &lines {
        lane_i_cost_layer(
            &mut tx,
            line.try_get("article_code")?,
            line.try_get("quantity")?,
            line.try_get("unit_price_minor")?,
            line.try_get("accepted_on")?,
            receipt_id,
            line.try_get("receipt_line_id")?,
        )
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

/// Value every accepted line that is not owed yet.
///
/// Called by the sync applier the moment receipt lines land (`fresh_only`:
/// lines that arrived in the last few minutes), and by a one-minute sweep over
/// everything as the net under it. A receipt that cannot post — a period that
/// is not open, an account the map cannot resolve — stays on the list and is
/// tried again; one delivery's problem never stops the others.
pub async fn receipts_post_pending(
    pool: &PgPool,
    fresh_only: bool,
    actor: &str,
) -> Result<ReceiptSweep, AppError> {
    let pending: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT r.receipt_id, r.receipt_number
           FROM goods_receipt r
          WHERE EXISTS (SELECT 1 FROM goods_receipt_line l
                         WHERE l.receipt_id = r.receipt_id AND l.posting_id IS NULL
                           AND (NOT $1 OR l.received_at > now() - interval '5 minutes'))
          ORDER BY r.arrived_at
          LIMIT 200",
    )
    .bind(fresh_only)
    .fetch_all(pool)
    .await?;
    let mut sweep = ReceiptSweep::default();
    for (receipt_id, receipt_number) in pending {
        match receipt_post(pool, receipt_id, None, actor).await {
            Ok(posting) => sweep.posted.push(posting),
            Err(error) => sweep.waiting.push((receipt_number, error.to_string())),
        }
    }
    Ok(sweep)
}

/// What one pass of [`receipts_post_pending`] did.
#[derive(Debug, Default)]
pub struct ReceiptSweep {
    pub posted: Vec<ReceiptPosting>,
    /// Receipt number and why it could not post yet.
    pub waiting: Vec<(String, String)>,
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

    // Every tranche still standing, each mirrored on its own entry and its own
    // payable delinked: a delivery valued in three tranches is un-valued in
    // three, all or none.
    let mut tx = pool.begin().await?;
    let standing: Vec<(Uuid, Uuid, NaiveDate)> = sqlx::query_as(
        "SELECT posting_id, journal_entry_id, posting_date
           FROM goods_receipt_posting
          WHERE receipt_id = $1 AND reversal_entry_id IS NULL
          ORDER BY posted_at
          FOR UPDATE",
    )
    .bind(receipt_id)
    .fetch_all(&mut *tx)
    .await?;
    for (posting_id, entry_id, posted_on) in standing {
        let date = posting_date.unwrap_or(posted_on);
        let mirror = reverse(&mut tx, entry_id, date, reason, actor).await?;
        ple_delink(
            &mut tx,
            "GOODS_RECEIPT",
            &posting_id.to_string(),
            reason,
            actor,
        )
        .await?;
        sqlx::query(
            "UPDATE goods_receipt_posting
                SET reversal_entry_id=$2, reversal_reason=$3, reversed_by=$4, reversed_at=now()
              WHERE posting_id=$1",
        )
        .bind(posting_id)
        .bind(mirror.entry_id)
        .bind(reason)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
    }
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
        // The lines not owed yet, not the receipts never posted: a receipt the
        // DC keeps open can be in the books and still gain lines (0390).
        "SELECT r.receipt_id, r.receipt_number, r.supplier_id, r.site_id, r.arrived_at,
                COUNT(l.receipt_line_id)::bigint AS line_count,
                COALESCE(SUM(l.quantity * pl.unit_price_minor), 0)::bigint AS value_minor,
                (CURRENT_DATE - MIN(l.verified_at)::date)::int AS days_waiting
           FROM goods_receipt r
           JOIN goods_receipt_line l
             ON l.receipt_id = r.receipt_id AND l.posting_id IS NULL
           LEFT JOIN purchase_order_line pl ON pl.po_line_id = l.po_line_id
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
    pub receipt_value_minor: i64,
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
/// DRAFT -> MATCHED -> POSTED. Matching checks the delivery, quantities, price,
/// and variance. Once those checks pass, the bill journal posts in the same
/// request; unresolved account or period problems leave the matched bill for
/// correction.
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

    // The accepted delivery is the first accounting fact in the procurement
    // chain. Ensure it is valued before matching its invoice, so a user does
    // not have to run a separate Finance posting action between receipt and
    // three-way match.
    //
    // Every line, not only a receipt that was never posted: a receipt already
    // in the books can have gained lines since (0390), and a bill matched
    // against half a delivery's value would post a variance that is not one.
    for receipt_id in &request.receipt_ids {
        receipt_post(pool, *receipt_id, None, actor).await?;
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
    let mut receipt_value: i64 = 0;
    for receipt_id in &request.receipt_ids {
        let row = sqlx::query(
            "SELECT r.receipt_number, r.supplier_id, r.site_id,
                    (SELECT SUM(p.value_minor) FROM goods_receipt_posting p
                      WHERE p.receipt_id = r.receipt_id AND p.reversal_entry_id IS NULL)::bigint
                        AS value_minor,
                    (SELECT MAX(p.reversal_entry_id::text) FROM goods_receipt_posting p
                      WHERE p.receipt_id = r.receipt_id)::uuid AS reversal_entry_id,
                    (SELECT i.invoice_number FROM supplier_invoice_receipt sir
                       JOIN supplier_invoice i USING (invoice_id)
                      WHERE sir.receipt_id = r.receipt_id AND sir.invoice_id <> $2)
                        AS other_bill
               FROM goods_receipt r
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
        // `value` is what its standing tranches are worth; a tranche reversed
        // beside them takes nothing away from those.
        match (value, reversed) {
            (Some(value), _) => receipt_value += value,
            (None, Some(_)) => {
                return Err(AppError::Conflict(format!(
                    "delivery {number} was un-valued; there is no receipt liability for this bill to clear"
                )))
            }
            (None, None) => {
                return Err(AppError::Conflict(format!(
                    "delivery {number} is not in the ledger yet; value it before matching the bill"
                )))
            }
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

    let variance = outcome.billed_value_minor - receipt_value;

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

    let mut matched = BillMatch {
        invoice_id,
        invoice_number,
        status: "MATCHED".into(),
        receipt_numbers,
        line_count: request.lines.len() as i64,
        billed_value_minor: outcome.billed_value_minor,
        ordered_value_minor: outcome.ordered_value_minor,
        receipt_value_minor: receipt_value,
        price_variance_minor: variance,
        disagreements: outcome.faults.iter().map(fault_sentence).collect(),
        matched_by: actor.to_string(),
    };

    // A successful three-way match is the procurement approval boundary:
    // quantity, price variance, supplier, site, receipt valuation, and invoice
    // totals have all been checked above. Post its journal immediately. If
    // account resolution or a period check refuses, the matched bill remains
    // visible for correction and this request reports the refusal.
    let posted = super::payables::post_bill(pool, invoice_id, None, actor).await?;
    matched.status = posted.status;
    Ok(matched)
}

/// What a merchandise bill debits when it posts.
///
/// The one place `payables::post_bill` reaches into this module. Two answers,
/// and which one applies is a fact about the bill rather than a setting:
///
///   * matched to deliveries — the goods are already in inventory and the
///     receipt has raised the supplier payable. The bill debits that payable for
///     the receipt value, re-credits the invoice value, adds input VAT, and
///     records any price difference. Historical receipts that credited the old
///     suspended account are cleared against the exact account their journal
///     used; new receipts always clear `trade_payable`.
///   * matched to nothing — the delivery was never valued, or there was none.
///     The bill debits `inventory` as it always did, which is 0052's rule and
///     the only honest answer when nothing else has posted.
///
/// The receipt's payable item is transferred to the invoice's payable item in
/// the Payment Ledger when the bill posts. An uninvoiced delivery therefore
/// remains visible as an open supplier debt without a suspense account.
pub async fn merchandise_debit_lines(
    pool: &PgPool,
    invoice_id: Uuid,
    site_id: &str,
    supplier_id: &str,
    subtotal_minor: i64,
    price_variance_minor: i64,
) -> Result<Vec<PostingLine>, AppError> {
    let row = sqlx::query(
        // DISTINCT: a receipt valued in several tranches (0390) is one
        // receipt, and joining its tranches must not count it several times.
        "SELECT COUNT(DISTINCT sir.receipt_id)::bigint AS receipts,
                COUNT(DISTINCT p.receipt_id)::bigint AS valued,
                COALESCE(SUM(p.value_minor), 0)::bigint AS receipt_value
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
    let receipt_value: i64 = row.try_get("receipt_value")?;

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
             or the bill will clear a supplier payable that was never made"
                .into(),
        ));
    }
    // The variance was decided at matching and frozen once the bill posts. If
    // the deliveries have moved since — a receipt re-posted, a price amended —
    // recomputing it here would post one figure and record another.
    if subtotal_minor - receipt_value != price_variance_minor {
        return Err(AppError::Conflict(format!(
            "the deliveries were valued at {receipt_value} and the bill was matched against a \
             variance of {price_variance_minor}; match it again before posting"
        )));
    }

    let trade_payable_code = super::ledger::resolve_account_code(pool, "trade_payable", site_id, "").await?;
    let head_office = super::sites::head_office_site_id(pool).await?;
    let receipt_rows = sqlx::query(
        "SELECT p.journal_entry_id, p.value_minor,
                (SELECT jl.account_code
                   FROM journal_line jl
                  WHERE jl.entry_id = p.journal_entry_id
                    AND jl.party_type = 'SUPPLIER'
                    AND jl.party_id = $2
                    AND jl.credit_minor > 0
                  ORDER BY jl.line_number
                  LIMIT 1) AS payable_account_code
           FROM supplier_invoice_receipt sir
           JOIN goods_receipt_posting p ON p.receipt_id = sir.receipt_id
          WHERE sir.invoice_id = $1 AND p.reversal_entry_id IS NULL
          ORDER BY p.posting_date, p.receipt_id",
    )
    .bind(invoice_id)
    .bind(supplier_id)
    .fetch_all(pool)
    .await?;
    let mut lines = Vec::with_capacity(receipt_rows.len() + 2);
    for receipt in &receipt_rows {
        let account_code: Option<String> = receipt.try_get("payable_account_code")?;
        let account_code = account_code.ok_or_else(|| {
            AppError::Conflict(
                "a received delivery has no supplier-payable credit in its journal; review the \
                 receipt entry before posting this invoice"
                    .into(),
            )
        })?;
        let value: i64 = receipt.try_get("value_minor")?;
        let line = if account_code == trade_payable_code {
            // The receipt credited the payable at dc (owner rule, 25 Sep), so
            // the invoice clears it there. The goods may be at a shop; the debt
            // never was.
            PostingLine::debit("trade_payable", &head_office, value).for_supplier(supplier_id)
        } else {
            // Clear historical receipts using the exact account code their
            // original journal credited. New receipts never take this branch.
            PostingLine::debit(
                LineAccount::Account {
                    account_code,
                    category_code: None,
                },
                site_id,
                value,
            )
            .for_supplier(supplier_id)
        };
        lines.push(line);
    }
    // The variance itself is NOT a line here. Owner decision (stage 5): a
    // supplier billing a different price adjusts the goods' provenance cost —
    // inventory while they are on hand, cost of sales once they are gone — and
    // `payables::post_bill` folds that split into this same entry. Landing it in
    // `8004 Potongan Pembelian` instead, as it used to, would leave the sold
    // portion of the difference sitting in the profit and loss as income and the
    // unsold portion out of the stock's value.
    let _ = price_variance_minor;
    Ok(lines)
}

/// Fold a matched invoice's price variance into the layer it belongs to.
///
/// The variance is allocated across the layers behind the matched receipts by
/// what each layer originally cost, and each layer is corrected without a
/// journal of its own: this bill already credits the payable for the invoice,
/// so the correction contributes only the two halves of the split — inventory
/// for what is still on hand, cost of sales for what has gone — and the Atas
/// Barang legs that keep a shop's books balanced against head office.
pub(super) async fn append_price_correction(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lines: &mut Vec<PostingLine>,
    invoice_id: Uuid,
    effective_date: NaiveDate,
    variance_minor: i64,
    actor: &str,
) -> Result<(), AppError> {
    let rows = sqlx::query(
        "SELECT l.layer_id, l.site_id, l.opening_cost_minor
           FROM cost_layer l
           JOIN supplier_invoice_receipt sir ON sir.receipt_id = l.receipt_id
          WHERE sir.invoice_id = $1
          ORDER BY l.economic_date, l.recorded_at, l.layer_id",
    )
    .bind(invoice_id)
    .fetch_all(&mut **tx)
    .await?;
    // An unmatched invoice has no layer behind it; it debits inventory at the
    // billed price directly, so there is nothing to correct.
    if rows.is_empty() {
        return Ok(());
    }
    let total: i64 = rows
        .iter()
        .map(|row| row.try_get::<i64, _>("opening_cost_minor").unwrap_or(0).max(0))
        .sum();
    let mut allocated = 0i64;
    let last = rows.len() - 1;
    for (index, row) in rows.iter().enumerate() {
        let layer_id: Uuid = row.try_get("layer_id")?;
        let site: String = row.try_get("site_id")?;
        let opening: i64 = row.try_get("opening_cost_minor")?;
        let share = if index == last {
            // The remainder, so independent roundings still sum to the variance.
            variance_minor - allocated
        } else if total > 0 {
            ((i128::from(variance_minor) * i128::from(opening.max(0))) / i128::from(total)) as i64
        } else {
            0
        };
        allocated += share;
        if share == 0 {
            continue;
        }
        let outcome = super::stock_ledger::cost_layer_correct_price_without_journal(
            tx,
            &super::stock_ledger::LayerPriceCorrection {
                layer_id,
                amount_minor: share,
                effective_date,
                reason: format!("Harga faktur beda PO: {invoice_id}"),
                source_id: format!("{invoice_id}:{layer_id}"),
            },
            actor,
        )
        .await?;
        if outcome.inventory_minor != 0 {
            lines.push(if outcome.inventory_minor > 0 {
                PostingLine::debit("inventory", &site, outcome.inventory_minor)
            } else {
                PostingLine::credit("inventory", &site, -outcome.inventory_minor)
            });
        }
        if outcome.cogs_minor != 0 {
            lines.push(if outcome.cogs_minor > 0 {
                PostingLine::debit("cogs", &site, outcome.cogs_minor)
            } else {
                PostingLine::credit("cogs", &site, -outcome.cogs_minor)
            });
        }
        lines.extend(outcome.affiliate_lines);
    }
    Ok(())
}

/// Replace receipt-level open items with the supplier invoice's open item.
///
/// The invoice journal has already debited the receipt liability and credited
/// the invoice's actual amount. Settling each receipt item and opening the bill
/// item in this same transaction makes the Payment Ledger move by the same net
/// amount as the general ledger. Old receipts posted before this rule changed
/// have no Payment Ledger item, so `ple_settle_claim` correctly treats those as
/// pre-ledger balances and the invoice item still opens for the amount now in AP.
#[allow(clippy::too_many_arguments)]
pub(super) async fn invoice_payable_replaces_receipts(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    invoice_id: Uuid,
    site_id: &str,
    supplier_id: &str,
    supplier_name: Option<&str>,
    amount_minor: i64,
    due_date: Option<NaiveDate>,
    posting_date: NaiveDate,
    journal_entry_id: Uuid,
    actor: &str,
) -> Result<(), AppError> {
    let receipts = sqlx::query(
        // One claim per tranche: each tranche's payable is filed under its own
        // voucher (0390), the first under the receipt id itself.
        "SELECT p.posting_id, p.value_minor
           FROM supplier_invoice_receipt sir
           JOIN goods_receipt_posting p USING (receipt_id)
          WHERE sir.invoice_id = $1 AND p.reversal_entry_id IS NULL
          ORDER BY p.posting_date, p.posted_at, p.posting_id",
    )
    .bind(invoice_id)
    .fetch_all(&mut **tx)
    .await?;
    for receipt in &receipts {
        let posting_id: Uuid = receipt.try_get("posting_id")?;
        let value: i64 = receipt.try_get("value_minor")?;
        let receipt_voucher = posting_id.to_string();
        ple_settle_claim(
            tx,
            &PaymentLedgerClaim {
                account_key: "trade_payable",
                qualifier: "",
                site_id,
                party_type: PaymentLedgerPartyType::Supplier,
                party_id: supplier_id,
                voucher_kind: Some("GOODS_RECEIPT"),
                voucher_id: Some(&receipt_voucher),
            },
            BILL_VOUCHER,
            &invoice_id.to_string(),
            journal_entry_id,
            posting_date,
            value,
            actor,
        )
        .await?;
    }
    payable_opened(
        tx,
        "trade_payable",
        BILL_VOUCHER,
        site_id,
        supplier_id,
        supplier_name,
        invoice_id,
        amount_minor,
        due_date,
        posting_date,
        journal_entry_id,
        actor,
    )
    .await
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
    /// What kind of thing the value goes back as, on the accounts that are kept
    /// by kind. Stored on the note, so the entry it posts files the credit
    /// exactly where the bill line filed the charge.
    pub credit_category_code: Option<String>,
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
    /// And which kind of thing it goes back as, required when that account
    /// declares a family. A credit note reverses a charge, so it has to name
    /// the same kind the charge named: `6301` credited without a category would
    /// take the money out of general and administrative expenses in general,
    /// and the line it was meant to offset would stay where it was.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub credit_category_code: Option<String>,
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
     n.credit_category_code,
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
        credit_category_code: row.try_get("credit_category_code")?,
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
    let category = request
        .credit_category_code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let (account, category) =
        match (kind.as_str(), account) {
            ("MERCHANDISE", Some(code)) if !code.is_empty() => {
                return Err(AppError::Validation(format!(
                "bill {} is for goods, so a credit note against it goes back to inventory by rule; \
                 naming {code} would be choosing where stock lives",
                bill.try_get::<String, _>("invoice_number")?
            )))
            }
            // The rule's own leg, so the map chooses its category with its
            // account and the note stores neither.
            ("MERCHANDISE", _) => (None, None),
            (_, Some(code)) if !code.is_empty() => {
                super::ledger::assert_postable(pool, code, super::ledger::Intent::Post).await?;
                super::ledger::assert_category_for_account(
                    pool,
                    code,
                    category,
                    super::ledger::Intent::Post,
                )
                .await?;
                (Some(code.to_string()), category.map(str::to_string))
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
            credit_account_code, credit_category_code, note, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
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
    .bind(category)
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
                dimensions: Vec::new(),
                account: LineAccount::Account {
                    account_code: code.to_string(),
                    category_code: note.credit_category_code.clone(),
                },
                site_id: note.site_id.clone(),
                counter_site_id: None,
                debit_minor: 0,
                credit_minor: note.subtotal_minor,
                party_type: None,
                party_id: None,
                asset_id: None,
                bank_account_id: None,
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
    payable_settled(
        &mut tx,
        payable_key(expense),
        &note.site_id,
        &note.supplier_id,
        note.invoice_id,
        "CREDIT_NOTE",
        credit_note_id,
        note.total_minor,
        intent.posting_date,
        posted.entry_id,
        actor,
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
    super::ledger::resolve_account_code(pool, &key, &note.site_id, qualifier).await?;

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
    // The money came back, so the debt this note had answered is a debt again.
    // The entry above credits the payable; delinking the note's allocation is
    // the same fact on the ledger side, and the two commit together or the
    // ageing would show a bill somebody paid twice.
    ple_delink(
        &mut tx,
        "CREDIT_NOTE",
        &credit_note_id.to_string(),
        &format!("{} was refunded in cash", note.credit_number),
        actor,
    )
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
    super::ledger::resolve_account_code(pool, &key, &request.site_id, qualifier).await?;

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
    payable_settled(
        &mut tx,
        payable_key(kind == "EXPENSE"),
        &advance.site_id,
        &advance.supplier_id,
        request.invoice_id,
        "SUPPLIER_ADVANCE",
        advance_id,
        request.amount_minor,
        intent.posting_date,
        posted.entry_id,
        actor,
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
        let template = sqlx::query(
            "SELECT name, rate_bps FROM tax_template WHERE code = $1 AND is_active",
        )
        .bind(&code)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| {
            AppError::Validation(format!(
                "bill {invoice_number} names withholding {code}, which Finance no longer keeps"
            ))
        })?;
        let label: String = template.try_get("name")?;
        let rate_bp: i32 = template.try_get("rate_bps")?;
        let withheld = withholding::withholding_on_payment(
            i64::from(rate_bp),
            row.try_get("subtotal_minor")?,
            row.try_get("total_minor")?,
            row.try_get("paid_before")?,
            row.try_get("amount_minor")?,
            row.try_get("withheld_before")?,
        );
        if withheld == 0 {
            continue;
        }
        // One payment, one withholding: the certificate the supplier receives
        // names one tax object, and 0133 gives the payment one column for it.
        match &key {
            Some(existing) if *existing != code => {
                return Err(AppError::Validation(format!(
                    "this payment settles bills withheld under two different templates ({existing} \
                     and {code}); pay them separately so each certificate names one"
                )))
            }
            _ => key = Some(code.clone()),
        }
        withheld_total += withheld;
        explanation.push(format!("{invoice_number}: {withheld} at {label}"));
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
        lines.push(
            PostingLine::credit("withholding_payable", site_id, deductions.withholding_minor)
                .from_source("TAX_TEMPLATE", &key),
        );
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
    /// Posted value of delivered merchandise for which no supplier invoice is
    /// matched yet; this remains open in trade payables.
    pub unbilled_receipt_payable_minor: i64,
}

pub async fn three_way_report(pool: &PgPool, limit: i64) -> Result<ThreeWayReport, AppError> {
    let limit = limit.clamp(1, 500);
    let receipt_rows = sqlx::query(
        "SELECT r.receipt_id, r.receipt_number, r.supplier_id, r.site_id, r.arrived_at,
                (CURRENT_DATE - r.arrived_at::date)::int AS days_waiting,
                COALESCE(SUM(l.quantity * pl.unit_price_minor), 0)::bigint AS value_minor,
                -- A sub-select, not a join: a receipt valued in tranches (0390)
                -- would otherwise multiply its own lines.
                (SELECT SUM(p.value_minor) FROM goods_receipt_posting p
                  WHERE p.receipt_id = r.receipt_id
                    AND p.reversal_entry_id IS NULL)::bigint AS posted_value
           FROM goods_receipt r
           LEFT JOIN goods_receipt_line l ON l.receipt_id = r.receipt_id
           LEFT JOIN purchase_order_line pl ON pl.po_line_id = l.po_line_id
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

    // The whole open receipt payable, not only the page above.
    let unbilled_receipt_payable_minor: i64 = sqlx::query(
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
        unbilled_receipt_payable_minor,
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
