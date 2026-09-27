//! What this shop sold, read from its own SQLite.
//!
//! The centre answers the same questions across every shop
//! (`cloud/postgres/reports.rs`). This one answers them about the shop it runs
//! in, and it answers them with the link to the centre down — which is the
//! whole reason an edge node exists. A manager closing up does not stop
//! needing today's takings because a tunnel dropped.
//!
//! Deliberately thinner than the centre's, because the edge records less and
//! pretending otherwise would be worse than saying so:
//!
//!   - **No tax split.** The edge `sale` row has `total_minor`, `paid_minor`
//!     and `change_minor`; there is no `net_minor` or `tax_minor` to divide.
//!   - **Voided sales are excluded, refunds are not deducted.** Migration
//!     0024 opened `sale.status`, so a shop can now hold a `VOIDED` sale and
//!     a `sale_return` against a completed one. Every query below asks for
//!     `status='COMPLETED'`, the same question `till::report` asks of the
//!     drawer — without it a void stayed in the day's takings while the shift
//!     report had already dropped it, and the two numbers on one screen
//!     disagreed. Refunds are a separate fact and are NOT netted off here:
//!     these are takings, not revenue, and deducting a return without also
//!     saying which day it belonged to would be a third number nobody asked
//!     for.
//!
//! The calendar is `crate::reporting`, shared with the centre so a week does
//! not start on a different day in the two places.

use super::contracts::EdgeError;
use super::sqlite::db;
use crate::reporting::{buckets_between, offset_of, window_of, Bucket};
use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Deserialize)]
pub struct SalesSeriesQuery {
    pub from: NaiveDate,
    /// Inclusive: a reader asking for the first to the thirtieth means the
    /// thirtieth to be in it.
    pub to: NaiveDate,
    /// `day` (default) · `week` (ISO, Monday) · `month`.
    pub bucket: Option<String>,
    pub utc_offset_minutes: Option<i32>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SalesWindowQuery {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub utc_offset_minutes: Option<i32>,
    /// How many receipts to list. The totals above them are computed over the
    /// whole span regardless, so a truncated list never makes the summary lie.
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SalesCell {
    /// The local date the bucket starts on. A week is named by its Monday.
    pub bucket_start: NaiveDate,
    pub sales_count: i64,
    pub units_sold: i64,
    pub gross_minor: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct SalesSeries {
    pub site_id: String,
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub bucket: String,
    pub utc_offset_minutes: i32,
    /// Every bucket in the span, including the ones nobody sold anything in.
    pub buckets: Vec<NaiveDate>,
    pub cells: Vec<SalesCell>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SalesReceipt {
    pub id: String,
    pub total_minor: i64,
    pub paid_minor: i64,
    pub change_minor: i64,
    pub line_count: i64,
    pub units: i64,
    pub actor_id: String,
    pub completed_at: String,
}

/// What was taken in one form of payment.
///
/// This used to be a line in the module docs saying the edge could not answer
/// the question: the till took cash and nothing else, so a split would have
/// been an invention. It takes cards now, and the split stopped being an
/// invention and started being the point — a drawer is counted in cash, and a
/// card settlement is chased through an acquirer.
#[derive(Clone, Debug, Serialize)]
pub struct TenderTotal {
    /// `CASH` · `CARD` · `QRIS` · `OTHER`, as the schema constrains it.
    pub method: String,
    pub amount_minor: i64,
    /// How many tenders, not how many sales: one split payment is two.
    pub count: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct SalesTotals {
    pub count: i64,
    pub units_sold: i64,
    pub gross_minor: i64,
    pub paid_minor: i64,
    pub change_minor: i64,
    /// Takings divided by completed sales, computed here so a caller cannot
    /// divide by a different count.
    pub average_minor: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct SalesWindow {
    pub site_id: String,
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub utc_offset_minutes: i32,
    pub sales: SalesTotals,
    /// What each form of payment took, in descending order, so the largest is
    /// first and a manager reading it at close does not have to scan.
    pub tenders: Vec<TenderTotal>,
    /// What is expected in the drawer: cash taken, less the change given out
    /// of it.
    ///
    /// Only cash. `paid_minor - change_minor` was this figure while the till
    /// was cash-only and became wrong the moment it was not — it would count a
    /// card settlement as banknotes and report a drawer short by exactly the
    /// day's card takings, every day, with the arithmetic looking perfect.
    pub cash_expected_minor: i64,
    pub receipts: Vec<SalesReceipt>,
    /// Said plainly rather than left to be inferred from a length: a list that
    /// stops at the limit and a shop that made exactly that many sales look
    /// identical, and only one of them means "there is more".
    pub receipts_truncated: bool,
    pub receipts_limit: i64,
}

/// The SQL that names a sale's bucket.
///
/// SQLite has no `date_trunc`, so a week is found by walking back to Monday:
/// `strftime('%w')` counts from Sunday, and `(w + 6) % 7` is how many days
/// have passed since Monday. This must agree with `Bucket::start_of`, which
/// the axis is built from — see `crate::reporting`.
fn bucket_sql(bucket: Bucket) -> &'static str {
    match bucket {
        Bucket::Day => "date(local)",
        Bucket::Week => {
            "date(local, '-' || ((CAST(strftime('%w', local) AS INTEGER) + 6) % 7) || ' days')"
        }
        Bucket::Month => "date(local, 'start of month')",
    }
}

fn stamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn parse_day(text: &str) -> Result<NaiveDate, EdgeError> {
    text.parse()
        .map_err(|_| EdgeError::Persistence(format!("the database returned {text:?} as a date")))
}

pub fn sales_series(
    connection: &Connection,
    site_id: &str,
    query: SalesSeriesQuery,
) -> Result<SalesSeries, EdgeError> {
    let bucket = Bucket::parse(query.bucket.as_deref()).map_err(EdgeError::Validation)?;
    // The caller's offset, else this shop's own clock as head office told it.
    let offset_minutes = offset_of(
        query
            .utc_offset_minutes
            .or_else(|| crate::edge::site_profile::own_utc_offset_minutes(connection)),
    );
    let (start, end) =
        window_of(query.from, query.to, offset_minutes).map_err(EdgeError::Validation)?;
    // `completed_at` is RFC3339 in UTC with a `Z` (see `sqlite.rs`), so the
    // range compares as text and `datetime()` parses it. Shifting by the
    // offset gives the shop's own wall clock, which is the only reading of
    // "which day was this sale on" that a shop agrees with.
    let shift = format!("{offset_minutes} minutes");
    let expression = bucket_sql(bucket);

    let mut totals = HashMap::<String, (i64, i64)>::new();
    {
        let sql = format!(
            "WITH s AS (SELECT id,total_minor,datetime(completed_at, ?3) AS local FROM sale \
             WHERE status='COMPLETED' AND completed_at >= ?1 AND completed_at < ?2) \
             SELECT {expression} AS bucket_start, COUNT(*) AS sales_count, \
             COALESCE(SUM(total_minor),0) AS gross_minor FROM s GROUP BY 1"
        );
        let mut statement = connection.prepare(&sql).map_err(db)?;
        let rows = statement
            .query_map(
                rusqlite::params![stamp(start), stamp(end), format!("+{shift}")],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .map_err(db)?;
        for row in rows {
            let (day, count, gross) = row.map_err(db)?;
            totals.insert(day, (count, gross));
        }
    }

    // Units are counted separately rather than joined in: `sale_line` has a
    // row per garment, and joining it would multiply the sale rows and inflate
    // both the count and the money.
    let mut units = HashMap::<String, i64>::new();
    {
        let sql = format!(
            "WITH s AS (SELECT id,datetime(completed_at, ?3) AS local FROM sale \
             WHERE status='COMPLETED' AND completed_at >= ?1 AND completed_at < ?2) \
             SELECT {expression} AS bucket_start, COALESCE(SUM(l.quantity),0) AS units \
             FROM s JOIN sale_line l ON l.sale_id = s.id GROUP BY 1"
        );
        let mut statement = connection.prepare(&sql).map_err(db)?;
        let rows = statement
            .query_map(
                rusqlite::params![stamp(start), stamp(end), format!("+{shift}")],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .map_err(db)?;
        for row in rows {
            let (day, sold) = row.map_err(db)?;
            units.insert(day, sold);
        }
    }

    let mut cells = Vec::with_capacity(totals.len());
    for (day, (count, gross)) in totals {
        cells.push(SalesCell {
            bucket_start: parse_day(&day)?,
            sales_count: count,
            units_sold: units.get(&day).copied().unwrap_or(0),
            gross_minor: gross,
        });
    }
    cells.sort_by_key(|cell| cell.bucket_start);

    Ok(SalesSeries {
        site_id: site_id.to_string(),
        from: query.from,
        to: query.to,
        bucket: bucket.label().to_string(),
        utc_offset_minutes: offset_minutes,
        buckets: buckets_between(bucket, query.from, query.to),
        cells,
    })
}

pub fn sales_window(
    connection: &Connection,
    site_id: &str,
    query: SalesWindowQuery,
) -> Result<SalesWindow, EdgeError> {
    let offset_minutes = offset_of(
        query
            .utc_offset_minutes
            .or_else(|| crate::edge::site_profile::own_utc_offset_minutes(connection)),
    );
    let (start, end) =
        window_of(query.from, query.to, offset_minutes).map_err(EdgeError::Validation)?;
    let limit = query.limit.unwrap_or(200).clamp(1, 1000);

    let (count, gross, paid, change) = connection
        .query_row(
            "SELECT COUNT(*),COALESCE(SUM(total_minor),0),COALESCE(SUM(paid_minor),0),\
             COALESCE(SUM(change_minor),0) FROM sale \
             WHERE status='COMPLETED' AND completed_at >= ?1 AND completed_at < ?2",
            rusqlite::params![stamp(start), stamp(end)],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(db)?;

    let units: i64 = connection
        .query_row(
            "SELECT COALESCE(SUM(l.quantity),0) FROM sale_line l JOIN sale s ON s.id=l.sale_id \
             WHERE s.status='COMPLETED' AND s.completed_at >= ?1 AND s.completed_at < ?2",
            rusqlite::params![stamp(start), stamp(end)],
            |row| row.get(0),
        )
        .map_err(db)?;

    // Keyed by method rather than summed into columns, so adding a tender to
    // the schema's CHECK constraint is the only edit a new one needs.
    let tenders = {
        let mut statement = connection
            .prepare(
                "SELECT t.method,SUM(t.amount_minor),COUNT(*) FROM sale_tender t \
                 JOIN sale s ON s.id=t.sale_id \
                 WHERE s.status='COMPLETED' AND s.completed_at >= ?1 AND s.completed_at < ?2 \
                 GROUP BY t.method ORDER BY SUM(t.amount_minor) DESC",
            )
            .map_err(db)?;
        let rows = statement
            .query_map(rusqlite::params![stamp(start), stamp(end)], |row| {
                Ok(TenderTotal {
                    method: row.get(0)?,
                    amount_minor: row.get(1)?,
                    count: row.get(2)?,
                })
            })
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    let cash_taken: i64 = tenders
        .iter()
        .filter(|tender| tender.method == "CASH")
        .map(|tender| tender.amount_minor)
        .sum();

    let receipts = {
        let mut statement = connection
            .prepare(
                "SELECT s.id,s.total_minor,s.paid_minor,s.change_minor,s.actor_id,s.completed_at,\
                 (SELECT COUNT(*) FROM sale_line l WHERE l.sale_id=s.id),\
                 (SELECT COALESCE(SUM(l.quantity),0) FROM sale_line l WHERE l.sale_id=s.id) \
                 FROM sale s WHERE s.status='COMPLETED' \
                 AND s.completed_at >= ?1 AND s.completed_at < ?2 \
                 ORDER BY s.completed_at DESC LIMIT ?3",
            )
            .map_err(db)?;
        let rows = statement
            .query_map(rusqlite::params![stamp(start), stamp(end), limit], |row| {
                Ok(SalesReceipt {
                    id: row.get(0)?,
                    total_minor: row.get(1)?,
                    paid_minor: row.get(2)?,
                    change_minor: row.get(3)?,
                    actor_id: row.get(4)?,
                    completed_at: row.get(5)?,
                    line_count: row.get(6)?,
                    units: row.get(7)?,
                })
            })
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };

    Ok(SalesWindow {
        site_id: site_id.to_string(),
        from: query.from,
        to: query.to,
        utc_offset_minutes: offset_minutes,
        sales: SalesTotals {
            count,
            units_sold: units,
            gross_minor: gross,
            paid_minor: paid,
            change_minor: change,
            // Integer money stays integer money: rounded once, here.
            average_minor: if count == 0 { 0 } else { gross / count },
        },
        // Cash taken, less change given. Change comes out of the drawer
        // whatever paid for the sale — the domain refuses a non-cash tender
        // above the total precisely so that this subtraction is safe.
        cash_expected_minor: cash_taken - change,
        tenders,
        receipts_truncated: (receipts.len() as i64) >= limit && count > limit,
        receipts,
        receipts_limit: limit,
    })
}
