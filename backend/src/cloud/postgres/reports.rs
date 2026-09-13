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
use crate::reporting::{buckets_between, offset_of, Bucket, DEFAULT_UTC_OFFSET_MINUTES};
use chrono::{DateTime, Duration, NaiveDate, NaiveTime, TimeZone, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

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
    let bucket = Bucket::parse(query.bucket.as_deref()).map_err(AppError::Validation)?;
    let offset_minutes = offset_of(query.utc_offset_minutes);
    let (start, end) = crate::reporting::window_of(query.from, query.to, offset_minutes)
        .map_err(AppError::Validation)?;

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
         COALESCE(SUM(lines.units),0)::bigint units \
         FROM sale s \
         LEFT JOIN (SELECT sale_id,SUM(quantity)::bigint units FROM sale_line GROUP BY sale_id) lines \
           ON lines.sale_id=s.id \
         WHERE s.status='COMPLETED' AND s.completed_at >= $1 AND s.completed_at < $2 \
         GROUP BY 1,2 ORDER BY 2,1",
        field = bucket.label(),
    ))
    .bind(start)
    .bind(end)
    .bind(offset_minutes)
    .fetch_all(pool)
    .await?;

    let buckets = buckets_between(bucket, query.from, query.to);

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

/// One shop over one span: the totals, the tenders, and the receipts — or the
/// whole chain, when no shop is named.
///
/// Deliberately the same shape as the daily report's `sales`, `tenders`,
/// `returns` and `cash` blocks. A day is a span of one, and a screen that
/// showed one set of words for a day and another for a week would be teaching
/// two vocabularies for one thing.
///
/// # Why the unit is a filter and not an argument
///
/// It used to be required, and it was the only read in finance where the unit
/// was not optional — so the Sales Register could draw one shop and could not
/// draw the chain, which is the first question head office asks. Absent now
/// means every unit: the totals, the tenders and the returns are summed across
/// the fleet, `site_id` and `site_name` come back null, and every receipt in
/// `transactions` names the shop it rang at so a mixed list is still readable.
///
/// The name is the unit's own — head office is `HO` in the books and `dc` in
/// this system's site table — so it is read through `org_place`, which is the
/// finance unit domain, and falls back to the site's when no place is bridged
/// to it.
///
/// `average_minor` is here rather than left to the caller because there is one
/// wrong way to compute it — dividing by a count that includes voided sales —
/// and a caller reading `count` from a different block would take it.
pub async fn sales_window(pool: &PgPool, query: SalesWindowQuery) -> Result<Value, AppError> {
    // `None` is the fleet. Bound as NULL into every `$1::text IS NULL OR …`
    // below, so one set of queries answers both questions rather than two sets
    // that can drift apart.
    let site_id = match query.site_id.as_deref().map(str::trim) {
        Some(raw) if !raw.is_empty() => Some(raw.to_ascii_lowercase()),
        _ => None,
    };
    let site_name: Option<String> = match site_id.as_deref() {
        Some(id) => Some(
            sqlx::query(
                "SELECT COALESCE(p.name, s.name) AS name
                   FROM site s LEFT JOIN org_place p ON p.site_id = s.id
                  WHERE s.id = $1",
            )
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound("site".into()))?
            .get("name"),
        ),
        None => None,
    };

    let offset_minutes = offset_of(query.utc_offset_minutes);
    let (start, end) = crate::reporting::window_of(query.from, query.to, offset_minutes)
        .map_err(AppError::Validation)?;
    let limit = query.limit.unwrap_or(200).clamp(1, 1000);

    let sales = sqlx::query(
        "SELECT COALESCE(COUNT(*),0)::bigint sales_count,\
         COALESCE(SUM(net_minor),0)::bigint net_minor,\
         COALESCE(SUM(tax_minor),0)::bigint tax_minor,\
         COALESCE(SUM(total_minor),0)::bigint gross_minor,\
         COALESCE(SUM(paid_minor),0)::bigint paid_minor,\
         COALESCE(SUM(change_minor),0)::bigint change_minor \
         FROM sale WHERE ($1::text IS NULL OR site_id=$1) AND status='COMPLETED' \
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
         WHERE ($1::text IS NULL OR s.site_id=$1) AND s.status='COMPLETED' \
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
         WHERE ($1::text IS NULL OR s.site_id=$1) AND s.status='COMPLETED' \
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
         WHERE ($1::text IS NULL OR site_id=$1) AND status='VOIDED' \
         AND voided_at >= $2 AND voided_at < $3",
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
         FROM sale_return WHERE ($1::text IS NULL OR site_id=$1) \
         AND created_at >= $2 AND created_at < $3",
    )
    .bind(&site_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?;

    let refunds_by_method = sqlx::query(
        "SELECT p.method,COALESCE(SUM(p.amount_minor),0)::bigint amount_minor \
         FROM sale_return_payment p JOIN sale_return r ON r.id=p.return_id \
         WHERE ($1::text IS NULL OR r.site_id=$1) \
         AND r.created_at >= $2 AND r.created_at < $3 \
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
        "WITH selected_sales AS (\
             SELECT * FROM sale WHERE ($1::text IS NULL OR site_id=$1) AND status='COMPLETED' \
              AND completed_at >= $2 AND completed_at < $3 \
             ORDER BY completed_at DESC LIMIT $4\
         ), line_totals AS (\
             SELECT line.sale_id,COUNT(*)::bigint line_count,COALESCE(SUM(line.quantity),0)::bigint units \
             FROM sale_line line JOIN selected_sales sale ON sale.id=line.sale_id GROUP BY line.sale_id\
         ), payment_methods AS (\
             SELECT payment.sale_id,array_agg(DISTINCT payment.method ORDER BY payment.method) methods \
             FROM sale_payment payment JOIN selected_sales sale ON sale.id=payment.sale_id \
             GROUP BY payment.sale_id\
         ) \
         SELECT s.id,s.sale_number,s.site_id,s.channel,s.currency::text currency,\
         s.net_minor,s.tax_minor,s.total_minor,s.paid_minor,s.change_minor,\
         s.actor_id,s.customer_id,s.completed_at,\
         COALESCE(lines.line_count,0)::bigint line_count,\
         COALESCE(lines.units,0)::bigint units,\
         COALESCE(payments.methods,ARRAY[]::text[]) methods \
         FROM selected_sales s \
         LEFT JOIN line_totals lines ON lines.sale_id=s.id \
         LEFT JOIN payment_methods payments ON payments.sale_id=s.id \
         ORDER BY s.completed_at DESC",
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
        // Null on a fleet-wide read, and the two are different answers: a null
        // means "every unit", never "a unit we could not name".
        "site_id": site_id,
        "site_name": site_name,
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
            // On every row, not only on the fleet-wide read. A receipt that
            // says which shop rang it is readable in both lists; one that says
            // so only sometimes is a column a screen has to guess about.
            "site_id": row.get::<String,_>("site_id"),
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
            // The column has always been on `sale` and the detail read has
            // always selected it; it was simply never put on this wire, so a
            // register could not say which receipts were a member's.
            "customer_id": row.get::<Option<String>,_>("customer_id"),
            "completed_at": row.get::<Option<DateTime<Utc>>,_>("completed_at"),
        })).collect::<Vec<_>>(),
        // Said plainly rather than left to be inferred from a length: a list
        // that stops at the limit and a shop that made exactly that many sales
        // look identical, and only one of them means "there is more".
        "transactions_truncated": (transactions.len() as i64) >= limit && count > limit,
        "transactions_limit": limit,
    }))
}
