//! One article's whole life, from the order that bought it onward.
//!
//! An article is bought once — there are no repeat orders (owner, 1 Oct 2026)
//! — so its history is short enough to read in one answer: no paging, no
//! cursor. Four sources, merged newest first:
//!
//! - **Ordered** — the purchase order lines raised for its code.
//! - **Allotted / Allotment cancelled / Closed short** — `allotment_event`, which the ledger
//!   never sees because promising goods to a store moves nothing.
//! - **Movements** — every posting of its pieces, one row per movement group
//!   and leg, pieces summed. A goods receipt's postings carry the purchase
//!   order and receipt they were counted against, read off
//!   `goods_receipt_line.movement_group_id`; that is also how pieces received
//!   before they had a SKU are found at all.

use crate::cloud::application::AppError;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ArticleHistory {
    pub article_code: String,
    pub article_name: String,
    /// Newest first.
    pub events: Vec<ArticleHistoryEvent>,
}

/// One thing that happened to the article.
///
/// `kind` is `ORDERED`, `ALLOTTED`, `ALLOTMENT_CANCELLED`, `CLOSED_SHORT` or
/// `MOVEMENT`; a movement says what it was through `cause`, `from` and `to`
/// (place ids).
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ArticleHistoryEvent {
    pub kind: String,
    pub at: DateTime<Utc>,
    pub quantity: i64,
    pub cause: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub sku_codes: Vec<String>,
    pub epcs: Vec<String>,
    pub purchase_order_id: Option<Uuid>,
    pub po_number: Option<String>,
    pub receipt_number: Option<String>,
    pub allotment_id: Option<Uuid>,
    pub allotment_number: Option<String>,
    /// The store (or supplier) an allotment sends to.
    pub destination_id: Option<String>,
    pub reference_type: Option<String>,
    pub reference_id: Option<String>,
    pub actor_id: Option<String>,
}

/// A goods receipt, by the movement group that booked it.
struct Receipt {
    order: Uuid,
    po_number: String,
    receipt_number: String,
    verified_by: String,
    at: DateTime<Utc>,
    quantity: i64,
}

fn event(kind: &str, at: DateTime<Utc>, quantity: i64) -> ArticleHistoryEvent {
    ArticleHistoryEvent {
        kind: kind.to_owned(),
        at,
        quantity,
        cause: None,
        from: None,
        to: None,
        sku_codes: Vec::new(),
        epcs: Vec::new(),
        purchase_order_id: None,
        po_number: None,
        receipt_number: None,
        allotment_id: None,
        allotment_number: None,
        destination_id: None,
        reference_type: None,
        reference_id: None,
        actor_id: None,
    }
}

pub async fn article_history(
    pool: &PgPool,
    article_code: &str,
) -> Result<ArticleHistory, AppError> {
    // An article ordered but not yet set up has no master row: its order and
    // its receipts are all of its history, read by the code on the order.
    let article = sqlx::query("SELECT id, name FROM article WHERE article_code = $1")
        .bind(article_code)
        .fetch_optional(pool)
        .await?;
    let article_id: Option<Uuid> = article.as_ref().map(|row| row.try_get("id")).transpose()?;
    let article_name: String = match &article {
        Some(row) => row.try_get("name")?,
        None => sqlx::query_scalar(
            "SELECT article_name FROM purchase_order_line WHERE article_code = $1 LIMIT 1",
        )
        .bind(article_code)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Article".to_owned()))?,
    };
    let code = article_code.to_owned();
    let mut events = Vec::new();

    // Ordered: drafts were never sent and cancelled orders bought nothing.
    let ordered = sqlx::query(
        "SELECT po.purchase_order_id, po.po_number, po.created_by,
                COALESCE(po.issued_at, po.created_at) AS at,
                SUM(l.ordered_quantity - l.cancelled_quantity)::bigint AS quantity
           FROM purchase_order_line l
           JOIN purchase_order po ON po.purchase_order_id = l.purchase_order_id
          WHERE l.article_code = $1 AND po.order_status IN ('ISSUED', 'CLOSED')
          GROUP BY po.purchase_order_id, po.po_number, po.created_by, at",
    )
    .bind(&code)
    .fetch_all(pool)
    .await?;
    for row in ordered {
        let mut one = event("ORDERED", row.try_get("at")?, row.try_get("quantity")?);
        one.purchase_order_id = row.try_get("purchase_order_id")?;
        one.po_number = row.try_get("po_number")?;
        one.actor_id = row.try_get("created_by")?;
        events.push(one);
    }

    // The receipts counted against its order lines, by the movement group
    // that booked them — the bridge from a posting back to its order.
    let receipts = sqlx::query(
        "SELECT gl.movement_group_id, po.purchase_order_id, po.po_number, r.receipt_number,
                MAX(gl.verified_by) AS verified_by, MAX(gl.verified_at) AS at,
                SUM(gl.quantity)::bigint AS quantity
           FROM goods_receipt_line gl
           JOIN goods_receipt r ON r.receipt_id = gl.receipt_id
           JOIN purchase_order_line l ON l.po_line_id = gl.po_line_id
           JOIN purchase_order po ON po.purchase_order_id = l.purchase_order_id
          WHERE l.article_code = $1
          GROUP BY 1, 2, 3, 4",
    )
    .bind(&code)
    .fetch_all(pool)
    .await?;
    let mut receipt_of: HashMap<Uuid, Receipt> = HashMap::new();
    for row in receipts {
        receipt_of.insert(
            row.try_get("movement_group_id")?,
            Receipt {
                order: row.try_get("purchase_order_id")?,
                po_number: row.try_get("po_number")?,
                receipt_number: row.try_get("receipt_number")?,
                verified_by: row.try_get("verified_by")?,
                at: row.try_get("at")?,
                quantity: row.try_get("quantity")?,
            },
        );
    }
    let receipt_groups: Vec<Uuid> = receipt_of.keys().copied().collect();

    // Allotted and cancelled, one row per allotment and destination.
    let allotted = sqlx::query(
        "SELECT e.event_type, e.reference_type, e.allotment_id, a.allotment_number,
                COALESCE(e.destination_id, e.destination_store_id) AS destination_id,
                e.actor_id, MIN(e.occurred_at) AS at, SUM(e.quantity)::bigint AS quantity,
                array_agg(DISTINCT sk.sku_code ORDER BY sk.sku_code) AS sku_codes
           FROM allotment_event e
           JOIN sku sk ON sk.id = e.sku_id
           LEFT JOIN allotment a ON a.id = e.allotment_id
          WHERE sk.article_id = $1
            AND e.event_type IN ('ALLOTMENT_CREATED', 'ALLOTMENT_CANCELLED')
          GROUP BY e.event_type, e.reference_type, e.allotment_id, a.allotment_number,
                   COALESCE(e.destination_id, e.destination_store_id), e.actor_id",
    )
    .bind(article_id)
    .fetch_all(pool)
    .await?;
    for row in allotted {
        let reference: Option<String> = row.try_get("reference_type")?;
        let kind = match row.try_get::<String, _>("event_type")?.as_str() {
            "ALLOTMENT_CANCELLED" if reference.as_deref() == Some("CLOSE_SHORT") => "CLOSED_SHORT",
            "ALLOTMENT_CANCELLED" => "ALLOTMENT_CANCELLED",
            _ => "ALLOTTED",
        };
        let mut one = event(kind, row.try_get("at")?, row.try_get("quantity")?);
        one.allotment_id = row.try_get("allotment_id")?;
        one.allotment_number = row.try_get("allotment_number")?;
        one.destination_id = row.try_get("destination_id")?;
        one.actor_id = row.try_get("actor_id")?;
        one.sku_codes = row.try_get("sku_codes")?;
        events.push(one);
    }

    // Every posting of its pieces, one row per group and leg, from the
    // centre's own ledger and from the nodes' (`edge_movement`, which is
    // where everything the Gudang and the shops do lands). An allotment's
    // lines are one per SKU, so they are folded to the allotment rather than
    // split by line.
    let central = sqlx::query(
        "SELECT m.movement_group_id, m.cause, m.from_place_id, m.to_place_id,
                CASE WHEN m.reference_type = 'ALLOTMENT_LINE' THEN 'ALLOTMENT' ELSE m.reference_type END
                    AS reference_type,
                CASE WHEN m.reference_type = 'ALLOTMENT_LINE' THEN line.allotment_id::text ELSE m.reference_id END
                    AS reference_id,
                COALESCE(line.allotment_id, legacy.id) AS allotment_id,
                a.allotment_number, line.destination_id, m.actor_id,
                MIN(m.occurred_at) AS at, SUM(m.quantity)::bigint AS quantity,
                array_remove(array_agg(DISTINCT s.epc), NULL) AS epcs,
                array_remove(array_agg(DISTINCT sk.sku_code), NULL) AS sku_codes
           FROM movement m
           JOIN inventory_subject s ON s.id = m.subject_id
           LEFT JOIN sku sk ON sk.id = s.sku_id
           LEFT JOIN allotment_line line
                  ON m.reference_type = 'ALLOTMENT_LINE' AND m.reference_id = line.id::text
           LEFT JOIN allotment legacy
                  ON m.reference_type = 'ALLOTMENT' AND m.reference_id = legacy.id::text
           LEFT JOIN allotment a ON a.id = COALESCE(line.allotment_id, legacy.id)
          WHERE m.subject_id IN (
                    SELECT s2.id FROM inventory_subject s2
                      JOIN sku sk2 ON sk2.id = s2.sku_id
                     WHERE sk2.article_id = $1)
             OR m.movement_group_id = ANY($2)
          GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10",
    )
    .bind(article_id)
    .bind(&receipt_groups)
    .fetch_all(pool)
    .await?;
    // A piece received before it had a SKU is followed by its subject: the
    // receipt's own lines name it, and its later postings carry the SKU.
    let at_nodes = sqlx::query(
        "WITH skus AS (SELECT sku_code FROM sku WHERE article_id = $1),
              received AS (SELECT DISTINCT subject_id FROM edge_movement_line
                            WHERE movement_group_id = ANY($2))
         SELECT m.movement_group_id, m.cause, l.from_place_id, l.to_place_id,
                CASE WHEN m.reference_type = 'ALLOTMENT_LINE' THEN 'ALLOTMENT' ELSE m.reference_type END
                    AS reference_type,
                CASE WHEN m.reference_type = 'ALLOTMENT_LINE' THEN line.allotment_id::text ELSE m.reference_id END
                    AS reference_id,
                COALESCE(line.allotment_id, legacy.id) AS allotment_id,
                a.allotment_number, line.destination_id, m.actor_id,
                MIN(m.occurred_at) AS at, SUM(l.quantity)::bigint AS quantity,
                array_remove(array_agg(DISTINCT l.epc), NULL) AS epcs,
                array_remove(array_agg(DISTINCT l.sku_code), NULL) AS sku_codes
           FROM edge_movement_line l
           JOIN edge_movement m ON m.movement_group_id = l.movement_group_id
           LEFT JOIN allotment_line line
                  ON m.reference_type = 'ALLOTMENT_LINE' AND m.reference_id = line.id::text
           LEFT JOIN allotment legacy
                  ON m.reference_type = 'ALLOTMENT' AND m.reference_id = legacy.id::text
           LEFT JOIN allotment a ON a.id = COALESCE(line.allotment_id, legacy.id)
          WHERE l.sku_code IN (SELECT sku_code FROM skus)
             OR l.subject_id IN (SELECT subject_id FROM received)
          GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10",
    )
    .bind(article_id)
    .bind(&receipt_groups)
    .fetch_all(pool)
    .await?;
    let mut seen_receipts = std::collections::HashSet::new();
    for row in central.iter().chain(at_nodes.iter()) {
        let mut one = event("MOVEMENT", row.try_get("at")?, row.try_get("quantity")?);
        let group: Uuid = row.try_get("movement_group_id")?;
        one.cause = row.try_get("cause")?;
        one.from = row.try_get("from_place_id")?;
        one.to = row.try_get("to_place_id")?;
        one.reference_type = row.try_get("reference_type")?;
        one.reference_id = row.try_get("reference_id")?;
        one.allotment_id = row.try_get("allotment_id")?;
        one.allotment_number = row.try_get("allotment_number")?;
        one.destination_id = row.try_get("destination_id")?;
        one.actor_id = row.try_get("actor_id")?;
        one.epcs = row.try_get("epcs")?;
        one.sku_codes = row.try_get("sku_codes")?;
        if let Some(receipt) = receipt_of.get(&group) {
            seen_receipts.insert(group);
            one.purchase_order_id = Some(receipt.order);
            one.po_number = Some(receipt.po_number.clone());
            one.receipt_number = Some(receipt.receipt_number.clone());
        }
        events.push(one);
    }
    // A receipt whose postings have not reached the centre is still a receipt.
    for (group, receipt) in &receipt_of {
        if seen_receipts.contains(group) {
            continue;
        }
        let mut one = event("MOVEMENT", receipt.at, receipt.quantity);
        one.cause = Some("RECEIPT".to_owned());
        one.purchase_order_id = Some(receipt.order);
        one.po_number = Some(receipt.po_number.clone());
        one.receipt_number = Some(receipt.receipt_number.clone());
        one.actor_id = Some(receipt.verified_by.clone());
        events.push(one);
    }

    events.sort_by(|a, b| b.at.cmp(&a.at));
    Ok(ArticleHistory {
        article_code: code,
        article_name,
        events,
    })
}
