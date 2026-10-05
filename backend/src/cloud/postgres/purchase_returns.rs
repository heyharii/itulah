//! Purchase returns: goods that came beyond an order, going back to the
//! supplier (0710).
//!
//! An order for 10 kodi that arrives as 10 kodi and 50 loose pieces is 200
//! pieces bought and 50 that were not. The DC accepted all 250 onto its floor
//! (the count is what it is) and the centre split the receipt line into
//! `matched_quantity` and `excess_quantity`. The 50 stay in the DC's
//! Unidentified pool as the untagged quantity the count put there: only the
//! matched part is ever set up and labelled.
//!
//! The buyer who raised the order sends them back from the order (the owner,
//! 2026-09-29). That is a document — RS-00000001, which lines, how many — and
//! a command to the DC holding the goods. The DC hands them to the supplier,
//! and the movement that records it comes up with this return as its
//! reference, which is what closes the return here. It is ERPNext's Purchase
//! Return against a Purchase Receipt: a quantity against the receipt line it
//! arrived on, never tagged units, because these pieces were never given an
//! identity and are not going to be.
//!
//! Nothing here touches Finance. The receipt is valued at its matched
//! quantity only (`payables_flow`), so the excess was never stock value or a
//! payable, and sending it back reverses nothing.

use super::{begin_idempotent, complete_idempotent, inventory_dc_owner_tx, issue_command_tx};
use crate::cloud::{
    application::AppError,
    domain::{PurchaseReturnLinePayload, PurchaseReturnPayload, COMMAND_PURCHASE_RETURN_RAISE},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// Sending an order's excess back. Every line's, unless the buyer names some.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct RaisePurchaseReturnRequest {
    /// The order lines whose excess goes back. Empty: all of it.
    #[serde(default)]
    pub po_line_ids: Vec<Uuid>,
    #[serde(default)]
    pub note: Option<String>,
}

/// One receipt line's excess on a return.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PurchaseReturnLineView {
    pub receipt_line_id: Uuid,
    pub po_line_id: Uuid,
    pub article_code: String,
    pub article_name: String,
    pub quantity: i64,
}

/// A purchase return as the hub shows it: on the order, and in the Return to
/// supplier book.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PurchaseReturnView {
    pub return_id: Uuid,
    pub return_number: String,
    pub purchase_order_id: Uuid,
    pub po_number: String,
    pub supplier_id: String,
    pub supplier_name: Option<String>,
    /// The DC holding the goods.
    pub site_id: String,
    /// `OPEN` while the goods are still at the DC; `HANDED_OVER` once the DC
    /// has given them to the supplier.
    pub status: String,
    pub note: Option<String>,
    pub raised_by: String,
    pub raised_at: DateTime<Utc>,
    pub handed_over_by: Option<String>,
    pub handed_over_at: Option<DateTime<Utc>>,
    /// The Gudang's person in charge, named when the surat jalan was generated
    /// (0917); `None` until it is.
    pub note_pic: Option<String>,
    /// When the surat jalan was generated; `None` until it is.
    pub note_generated_at: Option<DateTime<Utc>>,
    /// Pieces, over every line.
    pub quantity: i64,
    pub lines: Vec<PurchaseReturnLineView>,
}

/// Put an order's excess on a return to its supplier and tell the DC.
///
/// Only excess nobody has decided on yet: a receipt line goes back once,
/// whole. The decision is written beside it in the words 0178 gave Finance
/// (`purchase_excess_decision`, 'RETURNED'), in the buyer's name.
pub async fn raise_purchase_return(
    pool: &PgPool,
    purchase_order_id: Uuid,
    request: RaisePurchaseReturnRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<PurchaseReturnView, AppError> {
    let actor = actor.trim();
    if actor.is_empty() {
        return Err(AppError::Validation(
            "a purchase return names who raised it".into(),
        ));
    }
    let note = request
        .note
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned);

    let mut tx = pool.begin().await?;
    if let Some(response) =
        begin_idempotent(&mut tx, idempotency_key, "purchase-return.raise", digest).await?
    {
        return Ok(serde_json::from_value(response)?);
    }

    let header = sqlx::query(
        "SELECT po_number, supplier_id, supplier_name, destination_site_id
           FROM purchase_order WHERE purchase_order_id = $1 FOR UPDATE",
    )
    .bind(purchase_order_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("purchase order".into()))?;
    let po_number: String = header.try_get("po_number")?;
    let supplier_id: String = header.try_get("supplier_id")?;
    let supplier_name: Option<String> = header.try_get("supplier_name")?;
    let site_id: String = header.try_get("destination_site_id")?;

    // The excess still waiting, per receipt line, locked so two presses of
    // the button cannot put the same pieces on two returns.
    let rows = sqlx::query(
        "SELECT r.receipt_line_id, r.po_line_id, r.excess_quantity,
                l.article_code, l.article_name
           FROM goods_receipt_line r
           JOIN purchase_order_line l ON l.po_line_id = r.po_line_id
          WHERE l.purchase_order_id = $1
            AND r.excess_quantity > 0
            AND (cardinality($2::uuid[]) = 0 OR r.po_line_id = ANY($2))
            AND NOT EXISTS (SELECT 1 FROM purchase_excess_decision d
                             WHERE d.receipt_line_id = r.receipt_line_id)
          ORDER BY l.line_number, r.verified_at
          FOR UPDATE OF r",
    )
    .bind(purchase_order_id)
    .bind(&request.po_line_ids)
    .fetch_all(&mut *tx)
    .await?;
    if rows.is_empty() {
        return Err(AppError::Conflict(format!(
            "nothing on {po_number} arrived beyond the order that is still waiting to go back"
        )));
    }

    // When the cloud runs the Gudang (DC-CLOUD-NATIVE.md) there is no node to
    // tell: the Gudang reads `purchase_return` itself (`cloud::dc::returns`).
    let target = if crate::cloud::dc::common::hosted() {
        None
    } else {
        Some(inventory_dc_owner_tx(&mut tx, &site_id).await?.ok_or_else(|| {
            AppError::Validation(format!(
                "no registered DC owns site '{site_id}', so nobody can hand these goods back"
            ))
        })?)
    };

    let sequence: i64 = sqlx::query_scalar("SELECT nextval('purchase_return_number_sequence')")
        .fetch_one(&mut *tx)
        .await?;
    let return_number = format!("RS-{sequence:08}");
    let return_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO purchase_return
             (return_id, return_number, purchase_order_id, supplier_id, site_id, note, raised_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(return_id)
    .bind(&return_number)
    .bind(purchase_order_id)
    .bind(&supplier_id)
    .bind(&site_id)
    .bind(&note)
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    let mut lines = Vec::with_capacity(rows.len());
    for row in &rows {
        let line = PurchaseReturnLinePayload {
            receipt_line_id: row.try_get("receipt_line_id")?,
            po_line_id: row.try_get("po_line_id")?,
            article_code: row.try_get("article_code")?,
            article_name: row.try_get("article_name")?,
            quantity: row.try_get("excess_quantity")?,
        };
        sqlx::query(
            "INSERT INTO purchase_return_line (receipt_line_id, return_id, po_line_id, quantity)
             VALUES ($1, $2, $3, $4)",
        )
        .bind(line.receipt_line_id)
        .bind(return_id)
        .bind(line.po_line_id)
        .bind(line.quantity)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO purchase_excess_decision
                 (receipt_line_id, outcome, agreed_unit_price_minor, reason, decided_by)
             VALUES ($1, 'RETURNED', NULL, $2, $3)",
        )
        .bind(line.receipt_line_id)
        .bind(format!(
            "{} beyond the order, sent back on {return_number}",
            line.quantity
        ))
        .bind(actor)
        .execute(&mut *tx)
        .await?;
        lines.push(line);
    }

    let payload = PurchaseReturnPayload {
        return_id,
        return_number: return_number.clone(),
        purchase_order_id,
        po_number,
        supplier_id,
        supplier_name,
        note,
        raised_by: actor.to_owned(),
        lines,
    };
    if let Some(target) = target {
        let command_id = issue_command_tx(
            &mut tx,
            COMMAND_PURCHASE_RETURN_RAISE,
            &serde_json::to_value(&payload)?,
            actor,
            None,
            std::slice::from_ref(&target),
        )
        .await?;
        sqlx::query("UPDATE purchase_return SET command_id = $2 WHERE return_id = $1")
            .bind(return_id)
            .bind(command_id)
            .execute(&mut *tx)
            .await?;
    }

    let view = load_returns(&mut tx, Some(return_id), None, None)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("purchase return".into()))?;
    complete_idempotent(&mut tx, idempotency_key, &serde_json::to_value(&view)?).await?;
    tx.commit().await?;
    Ok(view)
}

/// The returns raised against one order, newest first.
pub async fn purchase_returns_of_order(
    pool: &PgPool,
    purchase_order_id: Uuid,
) -> Result<Vec<PurchaseReturnView>, AppError> {
    let mut tx = pool.begin().await?;
    let returns = load_returns(&mut tx, None, Some(purchase_order_id), None).await?;
    tx.commit().await?;
    Ok(returns)
}

/// The Return to supplier book's purchase returns, newest first; `OPEN` or
/// `HANDED_OVER` narrows it.
pub async fn list_purchase_returns(
    pool: &PgPool,
    status: Option<&str>,
) -> Result<Vec<PurchaseReturnView>, AppError> {
    let status = status.map(str::trim).filter(|text| !text.is_empty());
    if let Some(status) = status {
        if status != "OPEN" && status != "HANDED_OVER" {
            return Err(AppError::Validation(format!(
                "a purchase return is OPEN or HANDED_OVER, not '{status}'"
            )));
        }
    }
    let mut tx = pool.begin().await?;
    let returns = load_returns(&mut tx, None, None, status).await?;
    tx.commit().await?;
    Ok(returns)
}

/// Close a return when the DC's movement handing it over comes up.
///
/// Called from the movement applier with the movement's own reference. Quiet
/// about a return it cannot find or one already closed: a replayed movement
/// is the same handover, and a command stream must not stop over it.
/// `pub(crate)`: the cloud-run Gudang closes the return the same way when it
/// hands the goods over itself (`cloud::dc::returns`).
pub(crate) async fn purchase_return_handed_over(
    tx: &mut Transaction<'_, Postgres>,
    reference_id: &str,
    actor: &str,
    occurred_at: DateTime<Utc>,
    movement_group_id: Uuid,
) -> Result<(), AppError> {
    let Ok(return_id) = Uuid::parse_str(reference_id.trim()) else {
        return Ok(());
    };
    sqlx::query(
        "UPDATE purchase_return
            SET status = 'HANDED_OVER', handed_over_by = $2, handed_over_at = $3,
                movement_group_id = $4
          WHERE return_id = $1 AND status = 'OPEN'",
    )
    .bind(return_id)
    .bind(actor)
    .bind(occurred_at)
    .bind(movement_group_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn load_returns(
    tx: &mut Transaction<'_, Postgres>,
    return_id: Option<Uuid>,
    purchase_order_id: Option<Uuid>,
    status: Option<&str>,
) -> Result<Vec<PurchaseReturnView>, AppError> {
    let rows = sqlx::query(
        "SELECT pr.return_id, pr.return_number, pr.purchase_order_id, po.po_number,
                pr.supplier_id, po.supplier_name, pr.site_id, pr.status, pr.note,
                pr.raised_by, pr.raised_at, pr.handed_over_by, pr.handed_over_at,
                pr.note_pic, pr.note_generated_at,
                COALESCE((SELECT sum(x.quantity) FROM purchase_return_line x
                           WHERE x.return_id = pr.return_id), 0)::bigint AS quantity,
                COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                     'receipt_line_id', x.receipt_line_id,
                                     'po_line_id', x.po_line_id,
                                     'article_code', l.article_code,
                                     'article_name', l.article_name,
                                     'quantity', x.quantity)
                                 ORDER BY l.line_number, x.receipt_line_id)
                            FROM purchase_return_line x
                            JOIN purchase_order_line l ON l.po_line_id = x.po_line_id
                           WHERE x.return_id = pr.return_id), '[]'::jsonb) AS lines
           FROM purchase_return pr
           JOIN purchase_order po ON po.purchase_order_id = pr.purchase_order_id
          WHERE ($1::uuid IS NULL OR pr.return_id = $1)
            AND ($2::uuid IS NULL OR pr.purchase_order_id = $2)
            AND ($3::text IS NULL OR pr.status = $3)
          ORDER BY pr.raised_at DESC, pr.return_number DESC
          LIMIT 500",
    )
    .bind(return_id)
    .bind(purchase_order_id)
    .bind(status)
    .fetch_all(&mut **tx)
    .await?;
    rows.iter()
        .map(|row| -> Result<PurchaseReturnView, AppError> {
            Ok(PurchaseReturnView {
                return_id: row.try_get("return_id")?,
                return_number: row.try_get("return_number")?,
                purchase_order_id: row.try_get("purchase_order_id")?,
                po_number: row.try_get("po_number")?,
                supplier_id: row.try_get("supplier_id")?,
                supplier_name: row.try_get("supplier_name")?,
                site_id: row.try_get("site_id")?,
                status: row.try_get("status")?,
                note: row.try_get("note")?,
                raised_by: row.try_get("raised_by")?,
                raised_at: row.try_get("raised_at")?,
                handed_over_by: row.try_get("handed_over_by")?,
                handed_over_at: row.try_get("handed_over_at")?,
                note_pic: row.try_get("note_pic")?,
                note_generated_at: row.try_get("note_generated_at")?,
                quantity: row.try_get("quantity")?,
                lines: serde_json::from_value(row.try_get("lines")?)?,
            })
        })
        .collect()
}
