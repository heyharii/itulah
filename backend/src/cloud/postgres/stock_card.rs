//! The stock card (kartu stok): how each place's stock got from where it stood
//! at the start of a period to where it stands at the end of it.
//!
//! Two reads, the pair ERPNext calls Stock Balance and Stock Ledger (not this
//! crate's `stock_ledger`, which is the costing ledger — layers and COGS):
//!
//! - [`stock_card_page`] — one row per site (or per article) for the period:
//!   Opening · Received · Sent out · Sold · Missing · Closing, with
//!   `opening + received − sent_out − sold − missing = closing` on every row.
//! - [`stock_card_lines`] — one place (or one article, or both) over the period:
//!   every posting that crossed the place's edge with the balance after it,
//!   sales folded into one line a day.
//!
//! # What "the place's stock" is
//!
//! The pieces **on hand** in the pools a site holds (`…:on_hand`). A count
//! shortage moves a piece to the pool's missing side, so on the card it leaves
//! the stock as **Missing**; a move between two pools of the same site
//! (Warehouse → Floor) never crosses the edge and is not on the card at all.
//! Every posting that does cross is filed by where it went:
//!
//! - into the site, from anywhere → **Received** (a delivery, a customer
//!   return, a piece found);
//! - out to `external/customer` → **Sold**;
//! - out to a missing side, `system/lost` or `external/disposal` → **Missing**;
//! - out anywhere else (another site, the road, a supplier) → **Sent out**.
//!
//! Company-wide the rows add up as they are: a delivery from head office to a
//! store is head office's Sent out and the store's Received.
//!
//! Days are the business's days (Asia/Jakarta); `to` is inclusive.

use crate::cloud::application::AppError;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// The longest period one read may cover.
const MAX_PERIOD_DAYS: i64 = 400;
/// Articles a page holds at most.
const MAX_ARTICLE_ROWS: i64 = 200;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StockCardQuery {
    pub from: NaiveDate,
    pub to: NaiveDate,
    /// `site` (the default) or `article`.
    #[serde(default)]
    pub by: Option<String>,
    /// One site's rows only (by article) — or, by site, nothing.
    #[serde(default)]
    pub site_id: Option<String>,
    /// One article's rows only (by site: where that article is).
    #[serde(default)]
    pub article_id: Option<Uuid>,
    /// Article name or code, by article.
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StockCardFigures {
    pub opening: i64,
    pub received: i64,
    pub sent_out: i64,
    pub sold: i64,
    pub missing: i64,
    pub closing: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StockCardRow {
    /// The site id, or the article id.
    pub key: String,
    /// The site's name, or the article's.
    pub label: String,
    /// The site's kind (`HO`, `STORE`), or the article's code.
    pub sub: Option<String>,
    pub figures: StockCardFigures,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StockCardPage {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub by: String,
    pub rows: Vec<StockCardRow>,
    /// Every row the read matches, summed — not only the page in hand.
    pub total: StockCardFigures,
    /// How many rows the read matches (articles page; sites never do).
    pub row_count: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StockCardLinesQuery {
    pub from: NaiveDate,
    pub to: NaiveDate,
    #[serde(default)]
    pub site_id: Option<String>,
    #[serde(default)]
    pub article_id: Option<Uuid>,
}

/// One line of the card.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StockCardLine {
    pub at: DateTime<Utc>,
    pub cause: String,
    /// The document the posting names. Null on a day's folded sales.
    pub reference_type: Option<String>,
    pub reference_id: Option<String>,
    /// Signed: into the place is positive.
    pub pieces: i64,
    /// Movement groups behind the line — a day's receipts, for folded sales.
    pub groups: i64,
    /// The pieces went to a missing side (a count shortage).
    pub to_missing: bool,
    /// The place's stock after this line.
    pub balance: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StockCardLines {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub site_id: Option<String>,
    pub article_id: Option<Uuid>,
    pub figures: StockCardFigures,
    pub lines: Vec<StockCardLine>,
}

fn check_period(from: NaiveDate, to: NaiveDate) -> Result<(), AppError> {
    if to < from {
        return Err(AppError::Validation("`to` is before `from`".into()));
    }
    if (to - from).num_days() > MAX_PERIOD_DAYS {
        return Err(AppError::Validation(format!(
            "a stock card covers at most {MAX_PERIOD_DAYS} days"
        )));
    }
    Ok(())
}

/// Every posting up to the end of the period, each leg that crosses a site's
/// edge as a signed delta of that site. `$1` from, `$2` to (dates), `$3` site
/// (or null), `$4` article (or null).
const DELTAS: &str = r#"
WITH bounds AS (
  SELECT ($1::date::timestamp AT TIME ZONE 'Asia/Jakarta') AS from_at,
         (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta') AS to_at
), m AS (
  SELECT mv.movement_group_id g, mv.cause, mv.reference_type ref_type, mv.reference_id ref,
         mv.quantity q, mv.occurred_at at, mv.to_place_id to_id,
         tp.site_id to_site, fp.site_id from_site, a.id article_id
  FROM movement mv
  JOIN inventory_subject s ON s.id = mv.subject_id
  LEFT JOIN sku k ON k.id = s.sku_id
  LEFT JOIN article a ON a.id = k.article_id
  LEFT JOIN inventory_place ti
    ON ti.id = mv.to_place_id AND ti.kind = 'OPERATIONAL' AND ti.id LIKE '%:on_hand'
  LEFT JOIN operational_pool tp ON tp.id = ti.pool_id
  LEFT JOIN inventory_place fi
    ON fi.id = mv.from_place_id AND fi.kind = 'OPERATIONAL' AND fi.id LIKE '%:on_hand'
  LEFT JOIN operational_pool fp ON fp.id = fi.pool_id
  WHERE mv.occurred_at < (SELECT to_at FROM bounds)
    AND ($3::text IS NULL OR tp.site_id = $3 OR fp.site_id = $3)
    AND ($4::uuid IS NULL OR a.id = $4)
), d AS (
  SELECT g, cause, ref_type, ref, to_site site, article_id, q delta, at, true incoming, to_id FROM m
   WHERE to_site IS NOT NULL AND ($3::text IS NULL OR to_site = $3)
     AND to_site IS DISTINCT FROM from_site
  UNION ALL
  SELECT g, cause, ref_type, ref, from_site, article_id, -q, at, false, to_id FROM m
   WHERE from_site IS NOT NULL AND ($3::text IS NULL OR from_site = $3)
     AND from_site IS DISTINCT FROM to_site
)"#;

/// The six figures of a grouped `d`, as select columns.
const FIGURES: &str = r#"
  COALESCE(SUM(d.delta) FILTER (WHERE d.at < b.from_at), 0)::bigint AS opening,
  COALESCE(SUM(d.delta) FILTER (WHERE d.at >= b.from_at AND d.incoming), 0)::bigint AS received,
  COALESCE(-SUM(d.delta) FILTER (WHERE d.at >= b.from_at AND NOT d.incoming
      AND d.to_id <> 'external/customer' AND d.to_id NOT LIKE '%:missing'
      AND d.to_id NOT IN ('system/lost', 'external/disposal')), 0)::bigint AS sent_out,
  COALESCE(-SUM(d.delta) FILTER (WHERE d.at >= b.from_at AND NOT d.incoming
      AND d.to_id = 'external/customer'), 0)::bigint AS sold,
  COALESCE(-SUM(d.delta) FILTER (WHERE d.at >= b.from_at AND NOT d.incoming
      AND (d.to_id LIKE '%:missing' OR d.to_id IN ('system/lost', 'external/disposal'))), 0)::bigint AS missing,
  COALESCE(SUM(d.delta), 0)::bigint AS closing"#;

fn figures_of(row: &sqlx::postgres::PgRow) -> Result<StockCardFigures, AppError> {
    Ok(StockCardFigures {
        opening: row.try_get("opening")?,
        received: row.try_get("received")?,
        sent_out: row.try_get("sent_out")?,
        sold: row.try_get("sold")?,
        missing: row.try_get("missing")?,
        closing: row.try_get("closing")?,
    })
}

fn add(left: StockCardFigures, right: StockCardFigures) -> StockCardFigures {
    StockCardFigures {
        opening: left.opening + right.opening,
        received: left.received + right.received,
        sent_out: left.sent_out + right.sent_out,
        sold: left.sold + right.sold,
        missing: left.missing + right.missing,
        closing: left.closing + right.closing,
    }
}

/// The period's equation, one row per site (head office first, then the
/// stores) or one row per article.
pub async fn stock_card_page(
    pool: &PgPool,
    query: StockCardQuery,
) -> Result<StockCardPage, AppError> {
    check_period(query.from, query.to)?;
    let by = query.by.as_deref().unwrap_or("site");
    match by {
        "site" => sites_page(pool, query).await,
        "article" => articles_page(pool, query).await,
        other => Err(AppError::Validation(format!(
            "`by` is `site` or `article`, not `{other}`"
        ))),
    }
}

async fn sites_page(pool: &PgPool, query: StockCardQuery) -> Result<StockCardPage, AppError> {
    // Every head office and store, the silent ones too: a store with nothing
    // posted in the period still has an opening and a closing.
    let sql = format!(
        r#"{DELTAS}, sums AS (
  SELECT d.site, {FIGURES}
  FROM d CROSS JOIN bounds b GROUP BY d.site
)
SELECT st.id AS key, st.name AS label, st.kind AS sub,
       COALESCE(x.opening, 0)::bigint AS opening, COALESCE(x.received, 0)::bigint AS received,
       COALESCE(x.sent_out, 0)::bigint AS sent_out, COALESCE(x.sold, 0)::bigint AS sold,
       COALESCE(x.missing, 0)::bigint AS missing, COALESCE(x.closing, 0)::bigint AS closing
FROM site st LEFT JOIN sums x ON x.site = st.id
WHERE st.kind IN ('HO', 'STORE')
ORDER BY CASE st.kind WHEN 'HO' THEN 0 ELSE 1 END, st.id"#
    );
    let rows = sqlx::query(&sql)
        .bind(query.from)
        .bind(query.to)
        .bind(None::<String>)
        .bind(query.article_id)
        .fetch_all(pool)
        .await?;
    let mut out = Vec::with_capacity(rows.len());
    let mut total = StockCardFigures::default();
    for row in &rows {
        let figures = figures_of(row)?;
        total = add(total, figures);
        out.push(StockCardRow {
            key: row.try_get("key")?,
            label: row.try_get("label")?,
            sub: row.try_get("sub")?,
            figures,
        });
    }
    let count = i64::try_from(out.len()).unwrap_or(i64::MAX);
    Ok(StockCardPage {
        from: query.from,
        to: query.to,
        by: "site".into(),
        rows: out,
        total,
        row_count: count,
    })
}

async fn articles_page(pool: &PgPool, query: StockCardQuery) -> Result<StockCardPage, AppError> {
    let limit = query.limit.unwrap_or(50).clamp(1, MAX_ARTICLE_ROWS);
    let offset = query.offset.unwrap_or(0).max(0);
    let needle = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    // The busiest first: what sold most in the period, then what moved most.
    let sql = format!(
        r#"{DELTAS}, sums AS (
  SELECT d.article_id, {FIGURES}
  FROM d CROSS JOIN bounds b
  WHERE d.article_id IS NOT NULL
  GROUP BY d.article_id
), named AS (
  SELECT a.id::text AS key, a.name AS label, a.article_code AS sub, x.*
  FROM sums x JOIN article a ON a.id = x.article_id
  WHERE $5::text IS NULL OR a.name ILIKE $5 OR a.article_code ILIKE $5
)
SELECT n.*,
       COUNT(*) OVER () AS row_count,
       SUM(n.opening) OVER ()::bigint AS t_opening, SUM(n.received) OVER ()::bigint AS t_received,
       SUM(n.sent_out) OVER ()::bigint AS t_sent_out, SUM(n.sold) OVER ()::bigint AS t_sold,
       SUM(n.missing) OVER ()::bigint AS t_missing, SUM(n.closing) OVER ()::bigint AS t_closing
FROM named n
ORDER BY n.sold DESC, (n.received + n.sent_out + n.missing) DESC, n.label
LIMIT $6 OFFSET $7"#
    );
    let rows = sqlx::query(&sql)
        .bind(query.from)
        .bind(query.to)
        .bind(query.site_id.as_deref())
        .bind(query.article_id)
        .bind(needle.as_deref())
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;
    let mut out = Vec::with_capacity(rows.len());
    let mut total = StockCardFigures::default();
    let mut row_count = 0_i64;
    for (index, row) in rows.iter().enumerate() {
        if index == 0 {
            row_count = row.try_get("row_count")?;
            total = StockCardFigures {
                opening: row.try_get("t_opening")?,
                received: row.try_get("t_received")?,
                sent_out: row.try_get("t_sent_out")?,
                sold: row.try_get("t_sold")?,
                missing: row.try_get("t_missing")?,
                closing: row.try_get("t_closing")?,
            };
        }
        out.push(StockCardRow {
            key: row.try_get("key")?,
            label: row.try_get("label")?,
            sub: row.try_get("sub")?,
            figures: figures_of(row)?,
        });
    }
    Ok(StockCardPage {
        from: query.from,
        to: query.to,
        by: "article".into(),
        rows: out,
        total,
        row_count,
    })
}

/// One place's card (and/or one article's) over the period: the opening, every
/// posting across the edge with the balance after it, and the closing.
pub async fn stock_card_lines(
    pool: &PgPool,
    query: StockCardLinesQuery,
) -> Result<StockCardLines, AppError> {
    check_period(query.from, query.to)?;
    if query.site_id.is_none() && query.article_id.is_none() {
        return Err(AppError::Validation(
            "a stock card is of one site, one article, or both".into(),
        ));
    }
    let figures_sql = format!(
        r#"{DELTAS}
SELECT {FIGURES} FROM d CROSS JOIN bounds b"#
    );
    let figures_row = sqlx::query(&figures_sql)
        .bind(query.from)
        .bind(query.to)
        .bind(query.site_id.as_deref())
        .bind(query.article_id)
        .fetch_one(pool)
        .await?;
    let figures = figures_of(&figures_row)?;

    // A day's sales are one line; every other posting is one line per group
    // and direction. The balance runs from the opening.
    let lines_sql = format!(
        r#"{DELTAS}, lines AS (
  SELECT CASE WHEN d.cause = 'SALE'
              THEN 'SALE|' || (d.at AT TIME ZONE 'Asia/Jakarta')::date
              ELSE d.g::text || '|' || d.incoming END AS k,
         MIN(d.at) AS at, MIN(d.cause) AS cause,
         CASE WHEN MIN(d.cause) = 'SALE' THEN NULL ELSE MIN(d.ref_type) END AS reference_type,
         CASE WHEN MIN(d.cause) = 'SALE' THEN NULL ELSE MIN(d.ref) END AS reference_id,
         SUM(d.delta)::bigint AS pieces, COUNT(DISTINCT d.g)::bigint AS groups,
         bool_or(d.to_id LIKE '%:missing') AS to_missing
  FROM d WHERE d.at >= (SELECT from_at FROM bounds)
  GROUP BY 1
)
SELECT l.at, l.cause, l.reference_type, l.reference_id, l.pieces, l.groups, l.to_missing,
       ($5::bigint + SUM(l.pieces) OVER (ORDER BY l.at, l.k))::bigint AS balance
FROM lines l
ORDER BY l.at, l.k"#
    );
    let rows = sqlx::query(&lines_sql)
        .bind(query.from)
        .bind(query.to)
        .bind(query.site_id.as_deref())
        .bind(query.article_id)
        .bind(figures.opening)
        .fetch_all(pool)
        .await?;
    let mut lines = Vec::with_capacity(rows.len());
    for row in &rows {
        lines.push(StockCardLine {
            at: row.try_get("at")?,
            cause: row.try_get("cause")?,
            reference_type: row.try_get("reference_type")?,
            reference_id: row.try_get("reference_id")?,
            pieces: row.try_get("pieces")?,
            groups: row.try_get("groups")?,
            to_missing: row.try_get("to_missing")?,
            balance: row.try_get("balance")?,
        });
    }
    Ok(StockCardLines {
        from: query.from,
        to: query.to,
        site_id: query.site_id,
        article_id: query.article_id,
        figures,
        lines,
    })
}
