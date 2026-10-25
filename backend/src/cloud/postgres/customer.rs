//! What a shopper is allowed to see about their own custom.
//!
//! Read-only, and deliberately narrow. Everything here is derived from
//! `edge_sale` — facts the shops already reported and the centre already
//! accepted — so there is no second place where a member's points could be
//! computed and disagree with the takings they came from. Nothing in this
//! module writes. The spendable balance is the points ledger's
//! (`loyalty.rs`); see `CustomerSummary::points_earned_total` for why the
//! number here is named what it is rather than "balance".
//!
//! Every query is scoped by `customer_id` in its WHERE clause, including the
//! one that fetches a single receipt by its id. That is not belt-and-braces: a
//! sale id is a uuid a member could hold from a previous receipt, and a detail
//! route that looked one up by id alone would hand out somebody else's basket
//! to anyone who guessed or kept an id.

use crate::cloud::application::AppError;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// A member's custom, added up.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CustomerSummary {
    pub customer_id: String,
    /// Points this member has earned, ever, on sales that still stand.
    ///
    /// NOT a balance: redemptions are debited in `points_ledger`, and
    /// `GET /api/v1/member/points` is the figure a member can spend. A voided
    /// sale is left out of this and of every other total here, because the
    /// ledger has already taken its points back and the takings no longer
    /// include it.
    pub points_earned_total: i64,
    pub transaction_count: i64,
    /// What they have spent, after promotions — the sum of what was charged.
    pub spent_minor: i64,
    /// What promotions took off, over the same set of sales.
    pub saved_minor: i64,
    /// The currency of their most recent sale. `None` when they have none.
    /// Not a constant: this is a fact about their history, and a member with no
    /// history has no currency rather than a default one.
    pub currency: Option<String>,
    pub first_purchase_at: Option<DateTime<Utc>>,
    pub last_purchase_at: Option<DateTime<Utc>>,
}

/// One purchase, as a member's history lists it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CustomerTransaction {
    pub sale_id: Uuid,
    pub occurred_at: DateTime<Utc>,
    pub site_id: String,
    /// The shop's own name, for a shopper who knows "Store 01" and not
    /// `store-01`. `None` for a site the centre has no row for.
    pub site_name: Option<String>,
    /// The number printed on the till's receipt (`edge_sale.receipt_no`, 0988)
    /// — what a shopper reads off the struk. `None` for a sale made before
    /// tills numbered them.
    pub receipt_no: Option<String>,
    /// `COMPLETED`, or `VOIDED` once the shop cancelled it. A voided sale stays
    /// in the history — the shopper was there and may ask about it — but it
    /// earned nothing and counts toward no total.
    pub status: String,
    pub currency: String,
    pub total_minor: i64,
    pub discount_total_minor: i64,
    pub points_earned: i64,
    /// Units bought, not lines: two of the same shirt reads as two items on a
    /// receipt and should read as two here.
    pub item_count: i64,
}

/// One line of a receipt.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CustomerTransactionLine {
    pub sku_code: String,
    /// What the garment is called, when the centre knows the SKU. A shopper
    /// reading a receipt recognises a name, not an eleven-digit code.
    pub name: Option<String>,
    pub quantity: i64,
    /// The shelf-edge price of one unit, before any promotion.
    pub unit_price_minor: i64,
    /// What the line actually came to. Reconstructed as price times quantity
    /// for sales from shops that predate line totals — the old meaning, stated
    /// rather than guessed at.
    pub line_total_minor: i64,
}

/// A receipt.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CustomerTransactionDetail {
    pub sale: CustomerTransaction,
    pub lines: Vec<CustomerTransactionLine>,
}

/// A page of history, and where the next one starts.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CustomerTransactionPage {
    pub transactions: Vec<CustomerTransaction>,
    /// Pass these back as `before_occurred_at` and `before_sale_id` to get the
    /// next page. `None` means the history ends here.
    ///
    /// A cursor rather than an offset because history grows at the newest end:
    /// a sale landing between two requests would shift every offset by one and
    /// the reader would see a purchase twice, or not at all.
    pub next_before_occurred_at: Option<DateTime<Utc>>,
    pub next_before_sale_id: Option<Uuid>,
}

/// Where a page of history starts, how long it is, and what narrows it.
///
/// The narrowing never changes the order — newest first — so the cursor pair
/// means the same thing with or without it.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct CustomerTransactionsQuery {
    pub limit: Option<i64>,
    pub before_occurred_at: Option<DateTime<Utc>>,
    pub before_sale_id: Option<Uuid>,
    /// The first local business day (WIB) to include.
    #[serde(default)]
    pub from: Option<NaiveDate>,
    /// The last local business day (WIB) to include — inclusive.
    #[serde(default)]
    pub to: Option<NaiveDate>,
    /// What was charged, at least / at most — whole rupiah, like the row.
    #[serde(default)]
    pub min_total: Option<i64>,
    #[serde(default)]
    pub max_total: Option<i64>,
    /// What promotions took off, at least / at most.
    #[serde(default)]
    pub min_saved: Option<i64>,
    #[serde(default)]
    pub max_saved: Option<i64>,
}

const DEFAULT_PAGE: i64 = 25;
const MAX_PAGE: i64 = 100;

/// A member id nobody could have meant.
///
/// Checked here rather than left to the query, so an empty path segment is
/// told what was wrong with it instead of quietly matching the anonymous sales
/// — which are the majority of every shop's takings and belong to no one.
fn member(customer_id: &str) -> Result<String, AppError> {
    let trimmed = customer_id.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("a member id is required".into()));
    }
    if trimmed.chars().count() > 128 {
        return Err(AppError::Validation(
            "that member id is longer than any real one".into(),
        ));
    }
    Ok(trimmed.to_string())
}

/// What this member has spent and earned, over all of it.
///
/// A member with no purchases is not an error: they are a person holding a card
/// who has not used it yet, and the screen that shows them zero is correct.
pub async fn customer_summary(
    pool: &PgPool,
    customer_id: &str,
) -> Result<CustomerSummary, AppError> {
    let customer_id = member(customer_id)?;
    let row = sqlx::query(
        "SELECT COUNT(*)::bigint                                 AS transaction_count,
                COALESCE(SUM(points_earned), 0)::bigint          AS points_earned_total,
                COALESCE(SUM(total_minor), 0)::bigint            AS spent_minor,
                COALESCE(SUM(discount_total_minor), 0)::bigint   AS saved_minor,
                MIN(occurred_at)                                 AS first_purchase_at,
                MAX(occurred_at)                                 AS last_purchase_at,
                (SELECT currency FROM edge_sale
                  WHERE customer_id = $1 AND status <> 'VOIDED'
                  ORDER BY occurred_at DESC, sale_id DESC
                  LIMIT 1)                                       AS currency
           FROM edge_sale
          WHERE customer_id = $1 AND status <> 'VOIDED'",
    )
    .bind(&customer_id)
    .fetch_one(pool)
    .await?;

    Ok(CustomerSummary {
        customer_id,
        points_earned_total: row.try_get("points_earned_total")?,
        transaction_count: row.try_get("transaction_count")?,
        spent_minor: row.try_get("spent_minor")?,
        saved_minor: row.try_get("saved_minor")?,
        currency: row.try_get("currency")?,
        first_purchase_at: row.try_get("first_purchase_at")?,
        last_purchase_at: row.try_get("last_purchase_at")?,
    })
}

fn transaction_from_row(row: &sqlx::postgres::PgRow) -> Result<CustomerTransaction, AppError> {
    Ok(CustomerTransaction {
        sale_id: row.try_get("sale_id")?,
        occurred_at: row.try_get("occurred_at")?,
        site_id: row.try_get("site_id")?,
        site_name: row.try_get("site_name")?,
        receipt_no: row.try_get("receipt_no")?,
        status: row.try_get("status")?,
        currency: row.try_get("currency")?,
        total_minor: row.try_get("total_minor")?,
        discount_total_minor: row.try_get("discount_total_minor")?,
        points_earned: row.try_get("points_earned")?,
        item_count: row.try_get("item_count")?,
    })
}

/// This member's purchases, newest first.
pub async fn customer_transactions(
    pool: &PgPool,
    customer_id: &str,
    query: CustomerTransactionsQuery,
) -> Result<CustomerTransactionPage, AppError> {
    let customer_id = member(customer_id)?;
    let limit = query.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
    // Half a cursor is not a cursor. Sending one of the pair would silently
    // fall back to "from the beginning" and repeat the first page forever.
    if query.before_occurred_at.is_some() != query.before_sale_id.is_some() {
        return Err(AppError::Validation(
            "before_occurred_at and before_sale_id go together".into(),
        ));
    }
    // Local business days, as the instants that bound them — the same
    // arithmetic the sales reports use, so a day here is the reports' day.
    let offset = crate::reporting::DEFAULT_UTC_OFFSET_MINUTES;
    let from_at = query
        .from
        .map(|day| crate::reporting::window_of(day, day, offset).map(|(start, _)| start))
        .transpose()
        .map_err(AppError::Validation)?;
    let to_at = query
        .to
        .map(|day| crate::reporting::window_of(day, day, offset).map(|(_, end)| end))
        .transpose()
        .map_err(AppError::Validation)?;
    let rows = sqlx::query(
        "SELECT s.sale_id,
                s.occurred_at,
                s.site_id,
                site.name AS site_name,
                s.receipt_no,
                s.status,
                s.currency,
                s.total_minor,
                s.discount_total_minor,
                s.points_earned,
                COALESCE((SELECT SUM(l.quantity) FROM edge_sale_line l
                           WHERE l.sale_id = s.sale_id), 0)::bigint AS item_count
           FROM edge_sale s
           LEFT JOIN site ON site.id = s.site_id
          WHERE s.customer_id = $1
            AND ($2::timestamptz IS NULL
                 OR (s.occurred_at, s.sale_id) < ($2::timestamptz, $3::uuid))
            AND ($5::timestamptz IS NULL OR s.occurred_at >= $5)
            AND ($6::timestamptz IS NULL OR s.occurred_at < $6)
            AND ($7::bigint IS NULL OR s.total_minor >= $7)
            AND ($8::bigint IS NULL OR s.total_minor <= $8)
            AND ($9::bigint IS NULL OR s.discount_total_minor >= $9)
            AND ($10::bigint IS NULL OR s.discount_total_minor <= $10)
          ORDER BY s.occurred_at DESC, s.sale_id DESC
          LIMIT $4",
    )
    .bind(&customer_id)
    .bind(query.before_occurred_at)
    .bind(query.before_sale_id)
    // One more than asked for, so "is there another page" is answered by the
    // database rather than guessed from a full page — a history whose length
    // is an exact multiple of the page size would otherwise always claim one
    // more page, and the last one would always be empty.
    .bind(limit + 1)
    .bind(from_at)
    .bind(to_at)
    .bind(query.min_total)
    .bind(query.max_total)
    .bind(query.min_saved)
    .bind(query.max_saved)
    .fetch_all(pool)
    .await?;

    let has_more = rows.len() as i64 > limit;
    let transactions = rows
        .iter()
        .take(limit as usize)
        .map(transaction_from_row)
        .collect::<Result<Vec<_>, _>>()?;
    let cursor = has_more.then(|| transactions.last()).flatten();

    Ok(CustomerTransactionPage {
        next_before_occurred_at: cursor.map(|last| last.occurred_at),
        next_before_sale_id: cursor.map(|last| last.sale_id),
        transactions,
    })
}

/// One receipt of this member's, with its lines.
///
/// Scoped by member as well as by id: a sale that is not theirs answers "not
/// found", which is the same answer as a sale that does not exist. Telling the
/// two apart would confirm that somebody else's receipt is real.
pub async fn customer_transaction(
    pool: &PgPool,
    customer_id: &str,
    sale_id: Uuid,
) -> Result<CustomerTransactionDetail, AppError> {
    let customer_id = member(customer_id)?;
    let row = sqlx::query(
        "SELECT s.sale_id,
                s.occurred_at,
                s.site_id,
                site.name AS site_name,
                s.receipt_no,
                s.status,
                s.currency,
                s.total_minor,
                s.discount_total_minor,
                s.points_earned,
                COALESCE((SELECT SUM(l.quantity) FROM edge_sale_line l
                           WHERE l.sale_id = s.sale_id), 0)::bigint AS item_count
           FROM edge_sale s
           LEFT JOIN site ON site.id = s.site_id
          WHERE s.customer_id = $1 AND s.sale_id = $2",
    )
    .bind(&customer_id)
    .bind(sale_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("transaction".into()))?;

    let lines = sqlx::query(
        "SELECT l.sku_code,
                a.name,
                l.quantity,
                l.unit_price_minor,
                COALESCE(l.line_total_minor, l.unit_price_minor * l.quantity)::bigint AS line_total_minor
           FROM edge_sale_line l
           LEFT JOIN sku ON sku.sku_code = l.sku_code
           LEFT JOIN article a ON a.id = sku.article_id
          WHERE l.sale_id = $1
          ORDER BY l.sku_code, l.subject_id",
    )
    .bind(sale_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|line| {
        Ok(CustomerTransactionLine {
            sku_code: line.try_get("sku_code")?,
            name: line.try_get("name")?,
            quantity: line.try_get("quantity")?,
            unit_price_minor: line.try_get("unit_price_minor")?,
            line_total_minor: line.try_get("line_total_minor")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;

    Ok(CustomerTransactionDetail {
        sale: transaction_from_row(&row)?,
        lines,
    })
}
