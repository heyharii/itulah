//! Daily sales reporting: the numbers a store needs to close a day — gross,
//! net, tax, tenders by method, change given, refunds, and the expected cash
//! in the drawer. Everything is derived from durable rows (sale, sale_payment,
//! sale_return*) for one business day at a configurable UTC offset; nothing
//! here writes.

use retail_app::{AppError, DailyReportQuery};
use chrono::{DateTime, Duration, NaiveTime, TimeZone, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};

const DEFAULT_UTC_OFFSET_MINUTES: i32 = 7 * 60; // WIB

pub async fn daily_sales_report(
    pool: &PgPool,
    query: DailyReportQuery,
) -> Result<Value, AppError> {
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
    let midnight = query
        .date
        .and_time(NaiveTime::MIN);
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
