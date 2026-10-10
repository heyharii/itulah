//! The one summary every Sales screen reads (0930).
//!
//! `sales_sku_day` is a store's day per SKU, under the division and tags the
//! article carried when it sold. It is never added to: a store day is
//! recomputed whole from the raw lines by `sales_rollup_refresh`, so a late
//! offline sale, a void or a return simply makes its day dirty again and the
//! next pass sums it afresh. The triggers in 0930 mark the days; this module
//! drains the marks, checks the summary against the raw lines, and says how
//! fresh each store's figures are.

use crate::cloud::AppError;
use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::PgPool;
use std::time::{Duration, Instant};


/// Sum again every store month whose days changed (0932 and 0937, marked by
/// 0933), newest first, optionally only within `from..=to`. A month written
/// to while it is being summed keeps its mark.
async fn refresh_months(
    pool: &PgPool,
    window: Option<(NaiveDate, NaiveDate)>,
) -> Result<u64, AppError> {
    let due: Vec<(NaiveDate, String, i64)> = sqlx::query_as(
        "SELECT month, site_id, mark FROM sales_month_dirty
          WHERE $1::date IS NULL
             OR month BETWEEN date_trunc('month', $1::date)::date AND $2::date
          ORDER BY month DESC, site_id",
    )
    .bind(window.map(|(from, _)| from))
    .bind(window.map(|(_, to)| to))
    .fetch_all(pool)
    .await?;
    // A screen catching up does a store's month or two, not a backfill.
    if window.is_some() && due.len() > 26 {
        return Ok(0);
    }
    let mut done = 0;
    for (month, site, mark) in due {
        sqlx::query("SELECT sales_month_refresh($1, $2)")
            .bind(month)
            .bind(&site)
            .execute(pool)
            .await?;
        sqlx::query("SELECT sales_sku_month_refresh($1, $2)")
            .bind(month)
            .bind(&site)
            .execute(pool)
            .await?;
        sqlx::query(
            "DELETE FROM sales_month_dirty WHERE month = $1 AND site_id = $2 AND mark = $3",
        )
        .bind(month)
        .bind(&site)
        .bind(mark)
        .execute(pool)
        .await?;
        done += 1;
    }
    Ok(done)
}

/// What one drain did.
#[derive(Debug, Default, Serialize)]
pub struct SalesRollupDrain {
    /// Store days recomputed.
    pub days: u64,
    /// Summary rows they wrote.
    pub rows: u64,
    /// Store months summed again from their days.
    pub months: u64,
    /// Store days still waiting when the time ran out.
    pub waiting: i64,
}

/// Recompute dirty store days, newest first, until none are left or `budget`
/// is spent. A day that is written to again while it is being summed keeps its
/// mark and is summed again on the next pass.
pub async fn sales_rollup_drain(pool: &PgPool, budget: Duration) -> Result<SalesRollupDrain, AppError> {
    let started = Instant::now();
    let mut drained = SalesRollupDrain::default();
    while started.elapsed() < budget {
        let batch: Vec<(NaiveDate, String, i64)> = sqlx::query_as(
            "SELECT business_date, site_id, mark FROM sales_rollup_dirty
              ORDER BY business_date DESC, site_id
              LIMIT 50",
        )
        .fetch_all(pool)
        .await?;
        if batch.is_empty() {
            break;
        }
        for (day, site, mark) in batch {
            let written: i32 = sqlx::query_scalar("SELECT sales_rollup_refresh($1, $2)")
                .bind(day)
                .bind(&site)
                .fetch_one(pool)
                .await?;
            sqlx::query("SELECT sales_store_day_refresh($1, $2)")
                .bind(day)
                .bind(&site)
                .execute(pool)
                .await?;
            sqlx::query(
                "DELETE FROM sales_rollup_dirty
                  WHERE business_date = $1 AND site_id = $2 AND mark = $3",
            )
            .bind(day)
            .bind(&site)
            .bind(mark)
            .execute(pool)
            .await?;
            drained.days += 1;
            drained.rows += u64::try_from(written).unwrap_or(0);
            if started.elapsed() >= budget {
                break;
            }
        }
    }
    drained.months = refresh_months(pool, None).await?;
    drained.waiting = sqlx::query_scalar("SELECT count(*) FROM sales_rollup_dirty")
        .fetch_one(pool)
        .await?;
    Ok(drained)
}

/// Before a screen reads `from..=to`, sum the store days in it that are
/// still marked, so what was just rung up is on the screen without waiting
/// for the job — as long as there are at most `cap` of them and they sum
/// within a moment; a backfill or a busy sync waits for the job instead,
/// and the read says how many days are pending.
pub async fn sales_rollup_catch_up(
    pool: &PgPool,
    from: NaiveDate,
    to: NaiveDate,
    cap: i64,
) -> Result<(), AppError> {
    let pending: Vec<(NaiveDate, String, i64)> = sqlx::query_as(
        "SELECT business_date, site_id, mark FROM sales_rollup_dirty
          WHERE business_date BETWEEN $1 AND $2
          ORDER BY business_date DESC, site_id
          LIMIT $3",
    )
    .bind(from)
    .bind(to)
    .bind(cap + 1)
    .fetch_all(pool)
    .await?;
    if i64::try_from(pending.len()).unwrap_or(i64::MAX) > cap {
        return Ok(());
    }
    let started = Instant::now();
    for (day, site, mark) in pending {
        if started.elapsed() >= Duration::from_millis(800) {
            break;
        }
        sqlx::query("SELECT sales_rollup_refresh($1, $2)")
            .bind(day)
            .bind(&site)
            .execute(pool)
            .await?;
        sqlx::query("SELECT sales_store_day_refresh($1, $2)")
            .bind(day)
            .bind(&site)
            .execute(pool)
            .await?;
        sqlx::query(
            "DELETE FROM sales_rollup_dirty
              WHERE business_date = $1 AND site_id = $2 AND mark = $3",
        )
        .bind(day)
        .bind(&site)
        .bind(mark)
        .execute(pool)
        .await?;
    }
    refresh_months(pool, Some((from, to))).await?;
    Ok(())
}

/// A store day where the summary and the raw lines disagree.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SalesRollupDrift {
    pub business_date: NaiveDate,
    pub site_id: String,
    pub raw_qty: i64,
    pub raw_net: i64,
    pub summary_qty: i64,
    pub summary_net: i64,
}

/// Compare the summary with the raw lines over `from..=to` and mark every
/// store day that disagrees for recomputation. Zero is the expected answer;
/// anything else is a path into the ledger that did not mark its day.
pub async fn sales_rollup_reconcile(
    pool: &PgPool,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<SalesRollupDrift>, AppError> {
    let drift: Vec<SalesRollupDrift> = sqlx::query_as(
        "SELECT business_date, site_id, raw_qty, raw_net, summary_qty, summary_net
           FROM sales_rollup_drift($1, $2)
          ORDER BY business_date, site_id",
    )
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;
    // A month out of step with its days is marked to be summed again.
    sqlx::query(
        "INSERT INTO sales_month_dirty (month, site_id)
         SELECT month, site_id FROM sales_month_drift($1, $2)
         ON CONFLICT (month, site_id)
             DO UPDATE SET mark = nextval('sales_rollup_mark_seq'), marked_at = now()",
    )
    .bind(from)
    .bind(to)
    .execute(pool)
    .await?;
    if !drift.is_empty() {
        let days: Vec<NaiveDate> = drift.iter().map(|d| d.business_date).collect();
        let sites: Vec<String> = drift.iter().map(|d| d.site_id.clone()).collect();
        sqlx::query(
            "INSERT INTO sales_rollup_dirty (business_date, site_id)
             SELECT * FROM unnest($1::date[], $2::text[])
             ON CONFLICT (business_date, site_id)
                 DO UPDATE SET mark = nextval('sales_rollup_mark_seq'), marked_at = now()",
        )
        .bind(&days)
        .bind(&sites)
        .execute(pool)
        .await?;
    }
    Ok(drift)
}

/// How current one store's sales figures are.
#[derive(Debug, Serialize, sqlx::FromRow)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SalesFreshness {
    pub site_id: String,
    /// The latest sale the centre holds from this store's till.
    pub last_sale_at: Option<DateTime<Utc>>,
    /// When that sale reached the centre.
    pub last_received_at: Option<DateTime<Utc>>,
    /// Store days whose summary is still being recomputed.
    pub days_pending: i64,
}

/// Per store: the last sale held and how many of its days are still being summed.
pub async fn sales_freshness(pool: &PgPool) -> Result<Vec<SalesFreshness>, AppError> {
    Ok(sqlx::query_as(
        "SELECT s.id AS site_id, last.occurred_at AS last_sale_at,
                last.received_at AS last_received_at,
                (SELECT count(*) FROM sales_rollup_dirty d WHERE d.site_id = s.id) AS days_pending
           FROM site s
           LEFT JOIN LATERAL (
               SELECT e.occurred_at, e.received_at FROM edge_sale e
                WHERE e.site_id = s.id
                ORDER BY e.business_date DESC, e.occurred_at DESC
                LIMIT 1
           ) last ON true
          WHERE last.occurred_at IS NOT NULL
             OR EXISTS (SELECT 1 FROM sales_rollup_dirty d WHERE d.site_id = s.id)
          ORDER BY s.id",
    )
    .fetch_all(pool)
    .await?)
}
