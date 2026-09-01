//! Sales reporting, asked two ways. `daily_sales_report` gives one store the
//! numbers it needs to close a day — gross, net, tax, tenders by method,
//! change given, refunds, and the expected cash in the drawer.
//! `sales_series` and `sales_window` ask the same of the whole fleet over a
//! span, bucketed by day, week or month, which is the head-office question and
//! not one that can be assembled from the daily report without a request per
//! shop per day.
//!
//! Everything is derived from durable rows (sale, sale_payment, sale_return*)
//! at a configurable UTC offset; nothing here writes.

use crate::cloud::application::{AppError, DailyReportQuery, SalesSeriesQuery, SalesWindowQuery};
use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, TimeZone, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const DEFAULT_UTC_OFFSET_MINUTES: i32 = 7 * 60; // WIB

pub async fn daily_sales_report(pool: &PgPool, query: DailyReportQuery) -> Result<Value, AppError> {
    let site_id = query.site_id.trim().to_ascii_lowercase();
    sqlx::query("SELECT id FROM site WHERE id=$1")
        .bind(&site_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("site".into()))?;

    let offset_minutes = query
        .utc_offset_minutes
        .unwrap_or(DEFAULT_UTC_OFFSET_MINUTES)
        .clamp(-14 * 60, 14 * 60);
    let midnight = query.date.and_time(NaiveTime::MIN);
    let start: DateTime<Utc> =
        Utc.from_utc_datetime(&(midnight - Duration::minutes(i64::from(offset_minutes))));
    let end = start + Duration::hours(24);

    let sales = sqlx::query(
        "SELECT COALESCE(COUNT(*),0)::bigint sales_count,\
         COALESCE(SUM(net_minor),0)::bigint net_minor,\
         COALESCE(SUM(tax_minor),0)::bigint tax_minor,\
         COALESCE(SUM(total_minor),0)::bigint gross_minor,\
         COALESCE(SUM(paid_minor),0)::bigint paid_minor,\
         COALESCE(SUM(change_minor),0)::bigint change_minor \
         FROM sale WHERE site_id=$1 AND status='COMPLETED' \
         AND completed_at >= $2 AND completed_at < $3",
    )
    .bind(&site_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?;

    let items = sqlx::query(
        "SELECT COALESCE(SUM(l.quantity),0)::bigint units \
         FROM sale_line l JOIN sale s ON s.id=l.sale_id \
         WHERE s.site_id=$1 AND s.status='COMPLETED' \
         AND s.completed_at >= $2 AND s.completed_at < $3",
    )
    .bind(&site_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?;

    let tenders = sqlx::query(
        "SELECT p.method,COALESCE(SUM(p.amount_minor),0)::bigint amount_minor,COUNT(*)::bigint tender_count \
         FROM sale_payment p JOIN sale s ON s.id=p.sale_id \
         WHERE s.site_id=$1 AND s.status='COMPLETED' \
         AND s.completed_at >= $2 AND s.completed_at < $3 \
         GROUP BY p.method ORDER BY p.method",
    )
    .bind(&site_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?;

    let voids: i64 = sqlx::query(
        "SELECT COALESCE(COUNT(*),0)::bigint count FROM sale \
         WHERE site_id=$1 AND status='VOIDED' AND voided_at >= $2 AND voided_at < $3",
    )
    .bind(&site_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?
    .get("count");

    let returns = sqlx::query(
        "SELECT COALESCE(COUNT(*),0)::bigint return_count,\
         COALESCE(SUM(refund_total_minor),0)::bigint refund_total_minor \
         FROM sale_return WHERE site_id=$1 AND created_at >= $2 AND created_at < $3",
    )
    .bind(&site_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?;

    let refunds_by_method = sqlx::query(
        "SELECT p.method,COALESCE(SUM(p.amount_minor),0)::bigint amount_minor \
         FROM sale_return_payment p JOIN sale_return r ON r.id=p.return_id \
         WHERE r.site_id=$1 AND r.created_at >= $2 AND r.created_at < $3 \
         GROUP BY p.method ORDER BY p.method",
    )
    .bind(&site_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?;

    let tender_of = |method: &str, rows: &[sqlx::postgres::PgRow]| -> i64 {
        rows.iter()
            .find(|row| row.get::<String, _>("method") == method)
            .map(|row| row.get::<i64, _>("amount_minor"))
            .unwrap_or(0)
    };
    let cash_in = tender_of("CASH", &tenders);
    let cash_refunds = tender_of("CASH", &refunds_by_method);
    let change_out: i64 = sales.get("change_minor");
    // What should physically be in the drawer from today's trade.
    let cash_expected_minor = cash_in - change_out - cash_refunds;

    Ok(json!({
        "site_id": site_id,
        "date": query.date,
        "utc_offset_minutes": offset_minutes,
        "window": { "from": start, "to": end },
        "sales": {
            "count": sales.get::<i64,_>("sales_count"),
            "units_sold": items.get::<i64,_>("units"),
            "net_minor": sales.get::<i64,_>("net_minor"),
            "tax_minor": sales.get::<i64,_>("tax_minor"),
            "gross_minor": sales.get::<i64,_>("gross_minor"),
            "paid_minor": sales.get::<i64,_>("paid_minor"),
            "change_minor": change_out,
            "voided_count": voids,
        },
        "tenders": tenders.iter().map(|row| json!({
            "method": row.get::<String,_>("method"),
            "amount_minor": row.get::<i64,_>("amount_minor"),
            "count": row.get::<i64,_>("tender_count"),
        })).collect::<Vec<_>>(),
        "returns": {
            "count": returns.get::<i64,_>("return_count"),
            "refund_total_minor": returns.get::<i64,_>("refund_total_minor"),
            "by_method": refunds_by_method.iter().map(|row| json!({
                "method": row.get::<String,_>("method"),
                "amount_minor": row.get::<i64,_>("amount_minor"),
            })).collect::<Vec<_>>(),
        },
        "cash": {
            "cash_tendered_minor": cash_in,
            "change_given_minor": change_out,
            "cash_refunded_minor": cash_refunds,
            "cash_expected_minor": cash_expected_minor,
        },
        "identity": "gross = net + tax; cash_expected = cash_tendered - change - cash_refunds",
    }))
}

// ---- The fleet, over a span --------------------------------------------

/// Which bucket a day falls into, and how to name the buckets of a span.
///
/// A closed set rather than a string passed to `date_trunc`: the parameter
/// arrives from a query string, and `date_trunc` accepts field names —
/// `century`, `microseconds` — that would produce a technically valid report
/// nobody asked for and an axis the caller cannot label.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Bucket {
    Day,
    Week,
    Month,
}

impl Bucket {
    fn parse(raw: Option<&str>) -> Result<Self, AppError> {
        match raw.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            None | Some("") | Some("day") => Ok(Self::Day),
            Some("week") => Ok(Self::Week),
            Some("month") => Ok(Self::Month),
            Some(other) => Err(AppError::Validation(format!(
                "bucket must be day, week or month, not {other:?}"
            ))),
        }
    }

    /// The `date_trunc` field this bucket is. `week` is ISO, so a week is
    /// named by its Monday.
    fn field(self) -> &'static str {
        match self {
            Self::Day => "day",
            Self::Week => "week",
            Self::Month => "month",
        }
    }

    fn label(self) -> &'static str {
        self.field()
    }

    /// The bucket a local date belongs to, named by the date the bucket starts.
    fn start_of(self, date: NaiveDate) -> NaiveDate {
        match self {
            Self::Day => date,
            // ISO weeks start on Monday, which is what `date_trunc('week')`
            // does; the two have to agree or the axis would not line up with
            // the cells.
            Self::Week => date - Duration::days(i64::from(date.weekday().num_days_from_monday())),
            Self::Month => NaiveDate::from_ymd_opt(date.year(), date.month(), 1).unwrap_or(date),
        }
    }

    fn next(self, start: NaiveDate) -> NaiveDate {
        match self {
            Self::Day => start + Duration::days(1),
            Self::Week => start + Duration::days(7),
            Self::Month => {
                let (year, month) = if start.month() == 12 {
                    (start.year() + 1, 1)
                } else {
                    (start.year(), start.month() + 1)
                };
                NaiveDate::from_ymd_opt(year, month, 1).unwrap_or(start + Duration::days(31))
            }
        }
    }
}

/// The span's local dates, as the UTC instants they begin and end at.
///
/// `to` is inclusive — a reader asking for the first to the thirtieth means
/// the thirtieth — so the exclusive end is midnight after it.
fn window_of(
    from: NaiveDate,
    to: NaiveDate,
    offset_minutes: i32,
) -> Result<(DateTime<Utc>, DateTime<Utc>), AppError> {
    if to < from {
        return Err(AppError::Validation(format!(
            "the span ends before it starts: {from} to {to}"
        )));
    }
    let shift = Duration::minutes(i64::from(offset_minutes));
    let start = Utc.from_utc_datetime(&(from.and_time(NaiveTime::MIN) - shift));
    let end = Utc.from_utc_datetime(&((to + Duration::days(1)).and_time(NaiveTime::MIN) - shift));
    Ok((start, end))
}

fn offset_of(minutes: Option<i32>) -> i32 {
    minutes
        .unwrap_or(DEFAULT_UTC_OFFSET_MINUTES)
        .clamp(-14 * 60, 14 * 60)
}

/// Every shop's takings across a span, bucketed.
///
/// Two things are returned that a caller could in principle derive and would
/// get wrong: the full list of buckets, and the full list of shops. A shop
/// that sold nothing all month has no rows here, and a Sunday everyone was
/// closed has none either — but both belong on the chart, because "nobody
/// sold anything" is the answer somebody came to read. Deriving the axis from
/// the rows would silently drop exactly those days.
///
/// Only COMPLETED sales count. An open sale is a till mid-transaction and a
/// voided one is a sale that did not happen; neither is takings.
pub async fn sales_series(pool: &PgPool, query: SalesSeriesQuery) -> Result<Value, AppError> {
    let bucket = Bucket::parse(query.bucket.as_deref())?;
    let offset_minutes = offset_of(query.utc_offset_minutes);
    let (start, end) = window_of(query.from, query.to, offset_minutes)?;

    // The shops the chart has rows for: every store, plus anything that
    // actually sold in the span. The second half is not paranoia — a site
    // whose kind was changed after it traded would otherwise take its history
    // off the report with it.
    let sites = sqlx::query(
        "SELECT id,name,kind FROM site \
         WHERE kind='STORE' OR id IN (\
           SELECT site_id FROM sale \
           WHERE status='COMPLETED' AND completed_at >= $1 AND completed_at < $2) \
         ORDER BY name",
    )
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?;

    // `completed_at AT TIME ZONE 'UTC'` drops the instant to a naive UTC
    // wall clock; adding the offset makes it the shop's own wall clock, which
    // is the only reading of "which day was this sale on" a shop agrees with.
    // Truncating a `timestamptz` directly would use the server's timezone —
    // whatever that happens to be set to today.
    let cells = sqlx::query(&format!(
        "SELECT s.site_id,\
         date_trunc('{field}', (s.completed_at AT TIME ZONE 'UTC') + make_interval(mins => $3))::date AS bucket_start,\
         COUNT(*)::bigint sales_count,\
         COALESCE(SUM(s.net_minor),0)::bigint net_minor,\
         COALESCE(SUM(s.tax_minor),0)::bigint tax_minor,\
         COALESCE(SUM(s.total_minor),0)::bigint gross_minor,\
         COALESCE(SUM((SELECT COALESCE(SUM(l.quantity),0) FROM sale_line l WHERE l.sale_id=s.id)),0)::bigint units \
         FROM sale s \
         WHERE s.status='COMPLETED' AND s.completed_at >= $1 AND s.completed_at < $2 \
         GROUP BY 1,2 ORDER BY 2,1",
        field = bucket.field(),
    ))
    .bind(start)
    .bind(end)
    .bind(offset_minutes)
    .fetch_all(pool)
    .await?;

    // The axis, built from the span rather than from the rows, so an empty
    // bucket is a gap in the chart and not a missing column.
    let mut buckets: Vec<NaiveDate> = Vec::new();
    let mut cursor = bucket.start_of(query.from);
    while cursor <= query.to {
        buckets.push(cursor);
        cursor = bucket.next(cursor);
    }

    Ok(json!({
        "from": query.from,
        "to": query.to,
        "bucket": bucket.label(),
        "utc_offset_minutes": offset_minutes,
        "window": { "from": start, "to": end },
        "buckets": buckets,
        "sites": sites.iter().map(|row| json!({
            "site_id": row.get::<String,_>("id"),
            "site_name": row.get::<String,_>("name"),
            "site_kind": row.get::<String,_>("kind"),
        })).collect::<Vec<_>>(),
        "cells": cells.iter().map(|row| json!({
            "site_id": row.get::<String,_>("site_id"),
            "bucket_start": row.get::<NaiveDate,_>("bucket_start"),
            "sales_count": row.get::<i64,_>("sales_count"),
            "units_sold": row.get::<i64,_>("units"),
            "net_minor": row.get::<i64,_>("net_minor"),
            "tax_minor": row.get::<i64,_>("tax_minor"),
            "gross_minor": row.get::<i64,_>("gross_minor"),
        })).collect::<Vec<_>>(),
    }))
}

/// One shop over one span: the totals, the tenders, and the receipts.
///
/// Deliberately the same shape as the daily report's `sales`, `tenders`,
/// `returns` and `cash` blocks. A day is a span of one, and a screen that
/// showed one set of words for a day and another for a week would be teaching
/// two vocabularies for one thing.
///
/// `average_minor` is here rather than left to the caller because there is one
/// wrong way to compute it — dividing by a count that includes voided sales —
/// and a caller reading `count` from a different block would take it.
pub async fn sales_window(pool: &PgPool, query: SalesWindowQuery) -> Result<Value, AppError> {
    let site_id = query.site_id.trim().to_ascii_lowercase();
    let site = sqlx::query("SELECT id,name FROM site WHERE id=$1")
        .bind(&site_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("site".into()))?;

    let offset_minutes = offset_of(query.utc_offset_minutes);
    let (start, end) = window_of(query.from, query.to, offset_minutes)?;
    let limit = query.limit.unwrap_or(200).clamp(1, 1000);

    let sales = sqlx::query(
        "SELECT COALESCE(COUNT(*),0)::bigint sales_count,\
         COALESCE(SUM(net_minor),0)::bigint net_minor,\
         COALESCE(SUM(tax_minor),0)::bigint tax_minor,\
         COALESCE(SUM(total_minor),0)::bigint gross_minor,\
         COALESCE(SUM(paid_minor),0)::bigint paid_minor,\
         COALESCE(SUM(change_minor),0)::bigint change_minor \
         FROM sale WHERE site_id=$1 AND status='COMPLETED' \
         AND completed_at >= $2 AND completed_at < $3",
    )
    .bind(&site_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?;

    let units: i64 = sqlx::query(
        "SELECT COALESCE(SUM(l.quantity),0)::bigint units \
         FROM sale_line l JOIN sale s ON s.id=l.sale_id \
         WHERE s.site_id=$1 AND s.status='COMPLETED' \
         AND s.completed_at >= $2 AND s.completed_at < $3",
    )
    .bind(&site_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?
    .get("units");

    let tenders = sqlx::query(
        "SELECT p.method,COALESCE(SUM(p.amount_minor),0)::bigint amount_minor,COUNT(*)::bigint tender_count \
         FROM sale_payment p JOIN sale s ON s.id=p.sale_id \
         WHERE s.site_id=$1 AND s.status='COMPLETED' \
         AND s.completed_at >= $2 AND s.completed_at < $3 \
         GROUP BY p.method ORDER BY p.method",
    )
    .bind(&site_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?;

    let voided: i64 = sqlx::query(
        "SELECT COALESCE(COUNT(*),0)::bigint count FROM sale \
         WHERE site_id=$1 AND status='VOIDED' AND voided_at >= $2 AND voided_at < $3",
    )
    .bind(&site_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?
    .get("count");

    let returns = sqlx::query(
        "SELECT COALESCE(COUNT(*),0)::bigint return_count,\
         COALESCE(SUM(refund_total_minor),0)::bigint refund_total_minor \
         FROM sale_return WHERE site_id=$1 AND created_at >= $2 AND created_at < $3",
    )
    .bind(&site_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?;

    let refunds_by_method = sqlx::query(
        "SELECT p.method,COALESCE(SUM(p.amount_minor),0)::bigint amount_minor \
         FROM sale_return_payment p JOIN sale_return r ON r.id=p.return_id \
         WHERE r.site_id=$1 AND r.created_at >= $2 AND r.created_at < $3 \
         GROUP BY p.method ORDER BY p.method",
    )
    .bind(&site_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?;

    // The receipts themselves. `methods` is aggregated here rather than in a
    // second round trip because a split tender is the case that matters — a
    // sale half in cash and half on a card is exactly the row a supervisor
    // opens this list to find.
    let transactions = sqlx::query(
        "SELECT s.id,s.sale_number,s.channel,s.currency::text currency,\
         s.net_minor,s.tax_minor,s.total_minor,s.paid_minor,s.change_minor,\
         s.actor_id,s.completed_at,\
         (SELECT COUNT(*)::bigint FROM sale_line l WHERE l.sale_id=s.id) line_count,\
         (SELECT COALESCE(SUM(l.quantity),0)::bigint FROM sale_line l WHERE l.sale_id=s.id) units,\
         COALESCE((SELECT array_agg(DISTINCT p.method ORDER BY p.method) \
                   FROM sale_payment p WHERE p.sale_id=s.id), ARRAY[]::text[]) methods \
         FROM sale s \
         WHERE s.site_id=$1 AND s.status='COMPLETED' \
         AND s.completed_at >= $2 AND s.completed_at < $3 \
         ORDER BY s.completed_at DESC LIMIT $4",
    )
    .bind(&site_id)
    .bind(start)
    .bind(end)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let tender_of = |method: &str, rows: &[sqlx::postgres::PgRow]| -> i64 {
        rows.iter()
            .find(|row| row.get::<String, _>("method") == method)
            .map(|row| row.get::<i64, _>("amount_minor"))
            .unwrap_or(0)
    };
    let cash_in = tender_of("CASH", &tenders);
    let cash_refunds = tender_of("CASH", &refunds_by_method);
    let change_out: i64 = sales.get("change_minor");
    let count: i64 = sales.get("sales_count");
    let gross: i64 = sales.get("gross_minor");
    // Integer money stays integer money: the average basket is quoted in the
    // same minor units as everything else, rounded once, here.
    let average_minor = if count == 0 { 0 } else { gross / count };

    Ok(json!({
        "site_id": site_id,
        "site_name": site.get::<String,_>("name"),
        "from": query.from,
        "to": query.to,
        "utc_offset_minutes": offset_minutes,
        "window": { "from": start, "to": end },
        "sales": {
            "count": count,
            "units_sold": units,
            "net_minor": sales.get::<i64,_>("net_minor"),
            "tax_minor": sales.get::<i64,_>("tax_minor"),
            "gross_minor": gross,
            "paid_minor": sales.get::<i64,_>("paid_minor"),
            "change_minor": change_out,
            "average_minor": average_minor,
            "voided_count": voided,
        },
        "tenders": tenders.iter().map(|row| json!({
            "method": row.get::<String,_>("method"),
            "amount_minor": row.get::<i64,_>("amount_minor"),
            "count": row.get::<i64,_>("tender_count"),
        })).collect::<Vec<_>>(),
        "returns": {
            "count": returns.get::<i64,_>("return_count"),
            "refund_total_minor": returns.get::<i64,_>("refund_total_minor"),
            "by_method": refunds_by_method.iter().map(|row| json!({
                "method": row.get::<String,_>("method"),
                "amount_minor": row.get::<i64,_>("amount_minor"),
            })).collect::<Vec<_>>(),
        },
        "cash": {
            "cash_tendered_minor": cash_in,
            "change_given_minor": change_out,
            "cash_refunded_minor": cash_refunds,
            "cash_expected_minor": cash_in - change_out - cash_refunds,
        },
        "transactions": transactions.iter().map(|row| json!({
            "id": row.get::<Uuid,_>("id"),
            "sale_number": row.get::<String,_>("sale_number"),
            "channel": row.get::<String,_>("channel"),
            "currency": row.get::<String,_>("currency").trim(),
            "net_minor": row.get::<i64,_>("net_minor"),
            "tax_minor": row.get::<i64,_>("tax_minor"),
            "total_minor": row.get::<i64,_>("total_minor"),
            "paid_minor": row.get::<i64,_>("paid_minor"),
            "change_minor": row.get::<i64,_>("change_minor"),
            "line_count": row.get::<i64,_>("line_count"),
            "units": row.get::<i64,_>("units"),
            "methods": row.get::<Vec<String>,_>("methods"),
            "actor_id": row.get::<String,_>("actor_id"),
            "completed_at": row.get::<Option<DateTime<Utc>>,_>("completed_at"),
        })).collect::<Vec<_>>(),
        // Said plainly rather than left to be inferred from a length: a list
        // that stops at the limit and a shop that made exactly that many sales
        // look identical, and only one of them means "there is more".
        "transactions_truncated": (transactions.len() as i64) >= limit && count > limit,
        "transactions_limit": limit,
    }))
}
