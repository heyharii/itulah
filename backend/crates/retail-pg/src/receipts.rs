//! Receipt reconstruction. A receipt is never cached as rendered text: it is
//! rebuilt from the durable sale rows every time, so a reprint five weeks
//! later is exactly as faithful as the original and works offline. All values
//! come from the database row, not from any idempotency response cache, so
//! timestamps and totals are the committed ones.

use retail_app::AppError;
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::collections::BTreeMap;
use uuid::Uuid;

pub async fn build_receipt(pool: &PgPool, sale_id: Uuid) -> Result<Value, AppError> {
    let sale = sqlx::query(
        "SELECT s.id,s.sale_number,s.site_id,site.name site_name,s.channel,s.status,\
         trim(s.currency::text) currency,s.net_minor,s.tax_minor,s.total_minor,s.paid_minor,\
         s.change_minor,s.actor_id,s.created_at,s.completed_at \
         FROM sale s JOIN site ON site.id=s.site_id WHERE s.id=$1",
    )
    .bind(sale_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("sale".into()))?;
    let status: String = sale.get("status");
    if status != "COMPLETED" {
        return Err(AppError::Conflict(format!(
            "receipts exist only for COMPLETED sales, this sale is {status}"
        )));
    }

    let lines = sqlx::query(
        "SELECT l.id,sk.sku_code,ar.name article_name,subject.epc,l.quantity,\
         l.unit_price_minor,l.net_minor,l.tax_minor,l.total_minor,l.tax_category,\
         l.tax_rate_bps,l.tax_inclusive,\
         EXISTS(SELECT 1 FROM sale_return_line rl WHERE rl.sale_line_id=l.id) returned \
         FROM sale_line l \
         JOIN sku sk ON sk.id=l.sku_id \
         JOIN article ar ON ar.id=sk.article_id \
         JOIN inventory_subject subject ON subject.id=l.subject_id \
         WHERE l.sale_id=$1 ORDER BY l.added_at,l.id",
    )
    .bind(sale_id)
    .fetch_all(pool)
    .await?;

    let payments = sqlx::query(
        "SELECT method,amount_minor,reference,recorded_at FROM sale_payment \
         WHERE sale_id=$1 ORDER BY recorded_at,id",
    )
    .bind(sale_id)
    .fetch_all(pool)
    .await?;

    let returns = sqlx::query(
        "SELECT return_number,refund_total_minor,reason,created_at FROM sale_return \
         WHERE sale_id=$1 ORDER BY created_at",
    )
    .bind(sale_id)
    .fetch_all(pool)
    .await?;

    // Tax summary grouped by (category, rate, inclusive). The tax shown is
    // the sum of the per-line stored tax — the amount actually charged — not
    // a recomputation over the subtotal, which can differ by a few minor
    // units due to per-line rounding.
    let mut tax_groups: BTreeMap<(String, i32, bool), (i64, i64)> = BTreeMap::new();
    for row in &lines {
        let key = (
            row.get::<String, _>("tax_category"),
            row.get::<i32, _>("tax_rate_bps"),
            row.get::<bool, _>("tax_inclusive"),
        );
        let entry = tax_groups.entry(key).or_insert((0, 0));
        entry.0 += row.get::<i64, _>("net_minor");
        entry.1 += row.get::<i64, _>("tax_minor");
    }

    let refunded_minor: i64 = returns
        .iter()
        .map(|row| row.get::<i64, _>("refund_total_minor"))
        .sum();

    Ok(json!({
        "sale_id": sale.get::<Uuid,_>("id"),
        "sale_number": sale.get::<String,_>("sale_number"),
        "site": {
            "id": sale.get::<String,_>("site_id"),
            "name": sale.get::<String,_>("site_name"),
        },
        "channel": sale.get::<String,_>("channel"),
        "currency": sale.get::<String,_>("currency"),
        "cashier": sale.get::<String,_>("actor_id"),
        "created_at": sale.get::<DateTime<Utc>,_>("created_at"),
        "completed_at": sale.get::<Option<DateTime<Utc>>,_>("completed_at"),
        "lines": lines.iter().map(|row| json!({
            "sale_line_id": row.get::<Uuid,_>("id"),
            "sku_code": row.get::<String,_>("sku_code"),
            "article_name": row.get::<String,_>("article_name"),
            "epc": row.get::<Option<String>,_>("epc"),
            "quantity": row.get::<i64,_>("quantity"),
            "unit_price_minor": row.get::<i64,_>("unit_price_minor"),
            "total_minor": row.get::<i64,_>("total_minor"),
            "returned": row.get::<bool,_>("returned"),
        })).collect::<Vec<_>>(),
        "totals": {
            "net_minor": sale.get::<i64,_>("net_minor"),
            "tax_minor": sale.get::<i64,_>("tax_minor"),
            "total_minor": sale.get::<i64,_>("total_minor"),
            "paid_minor": sale.get::<i64,_>("paid_minor"),
            "change_minor": sale.get::<i64,_>("change_minor"),
            "refunded_minor": refunded_minor,
        },
        "tax_summary": tax_groups.into_iter().map(|((category, rate_bps, inclusive), (net, tax))| json!({
            "category": category,
            "rate_bps": rate_bps,
            "inclusive": inclusive,
            "net_minor": net,
            "tax_minor": tax,
        })).collect::<Vec<_>>(),
        "tax_note": "tax is summed per line (rounded down per line), not recomputed on the subtotal",
        "payments": payments.iter().map(|row| json!({
            "method": row.get::<String,_>("method"),
            "amount_minor": row.get::<i64,_>("amount_minor"),
            "reference": row.get::<Option<String>,_>("reference"),
        })).collect::<Vec<_>>(),
        "returns": returns.iter().map(|row| json!({
            "return_number": row.get::<String,_>("return_number"),
            "refund_total_minor": row.get::<i64,_>("refund_total_minor"),
            "reason": row.get::<String,_>("reason"),
            "created_at": row.get::<DateTime<Utc>,_>("created_at"),
        })).collect::<Vec<_>>(),
    }))
}
