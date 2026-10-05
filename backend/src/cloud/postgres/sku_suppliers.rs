//! Which supplier a SKU came from.
//!
//! # Why this is asked of the centre
//!
//! A warehouse node carries a SKU code on every picklist, carton and surat
//! jalan and nothing about where the goods were bought: the supplier lives on
//! the purchase order, and the purchase order lives here. The operations
//! board's Spread view groups its cards by supplier, so it sends the SKU codes
//! it is showing and gets one supplier back for each.
//!
//! # Which supplier, when there could be several
//!
//! The goods' own history first: the article was set up from a receipt line,
//! the receipt line answers a purchase order line, the order names its
//! supplier — the same path the allotment list reads its `supplier_names`
//! from. The newest order wins when an article was bought more than once.
//! Failing that, the catalogue: a supplier that lists the article as one of
//! its items, when exactly one does. Two catalogue suppliers and no receipt is
//! a guess this function does not make; the SKU comes back without one.

use crate::cloud::application::AppError;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};

/// The most SKU codes one read accepts. A board shows what is on the floor
/// today, which is a few hundred SKUs, not the catalogue.
const MAX_SKUS: usize = 1000;

#[derive(Clone, Debug, Default, Deserialize)]
pub struct SkuSupplierQuery {
    /// Comma-separated SKU codes.
    #[serde(default)]
    pub sku: Option<String>,
}

/// One SKU and the supplier its goods came from, when that is known.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SkuSupplier {
    pub sku_code: String,
    /// As the purchase order spells it, or the catalogue's supplier id.
    pub supplier_id: Option<String>,
    pub supplier_name: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SkuSupplierList {
    /// One row per SKU asked for that the catalogue knows, in no order.
    pub items: Vec<SkuSupplier>,
}

pub async fn sku_suppliers(
    pool: &PgPool,
    query: SkuSupplierQuery,
) -> Result<SkuSupplierList, AppError> {
    let mut codes: Vec<String> = query
        .sku
        .as_deref()
        .unwrap_or_default()
        .split(',')
        .map(|code| code.trim().to_uppercase())
        .filter(|code| !code.is_empty())
        .collect();
    codes.sort();
    codes.dedup();
    if codes.is_empty() {
        return Ok(SkuSupplierList { items: Vec::new() });
    }
    if codes.len() > MAX_SKUS {
        return Err(AppError::Validation(format!(
            "at most {MAX_SKUS} SKU codes in one read; {} were sent",
            codes.len()
        )));
    }

    let rows = sqlx::query(
        "WITH asked AS (
             SELECT s.sku_code, a.article_code
             FROM sku s JOIN article a ON a.id = s.article_id
             WHERE s.sku_code = ANY($1)
         ),
         bought AS (
             SELECT DISTINCT ON (asked.sku_code)
                    asked.sku_code,
                    po.supplier_id,
                    COALESCE(po.supplier_name_snapshot, po.supplier_name) AS supplier_name
             FROM asked
             JOIN article_setup_session setup ON setup.article_code = asked.article_code
             JOIN goods_receipt_line receipt ON receipt.receipt_line_id = setup.receipt_line_id
             JOIN purchase_order_line order_line ON order_line.po_line_id = receipt.po_line_id
             JOIN purchase_order po ON po.purchase_order_id = order_line.purchase_order_id
             ORDER BY asked.sku_code, po.created_at DESC
         ),
         listed AS (
             SELECT asked.sku_code,
                    MIN(supplier.supplier_id::text) AS supplier_id,
                    MIN(supplier.name) AS supplier_name
             FROM asked
             JOIN supplier_item item
               ON item.internal_article_code = asked.article_code AND item.status = 'ACTIVE'
             JOIN supplier ON supplier.supplier_id = item.supplier_id
             GROUP BY asked.sku_code
             HAVING COUNT(DISTINCT supplier.supplier_id) = 1
         )
         SELECT asked.sku_code,
                COALESCE(bought.supplier_id, listed.supplier_id) AS supplier_id,
                COALESCE(bought.supplier_name, listed.supplier_name, bought.supplier_id) AS supplier_name
         FROM asked
         LEFT JOIN bought ON bought.sku_code = asked.sku_code
         LEFT JOIN listed ON listed.sku_code = asked.sku_code",
    )
    .bind(&codes)
    .fetch_all(pool)
    .await?;

    let items = rows
        .into_iter()
        .map(|row| SkuSupplier {
            sku_code: row.get("sku_code"),
            supplier_id: row.get("supplier_id"),
            supplier_name: row.get("supplier_name"),
        })
        .collect();
    Ok(SkuSupplierList { items })
}
