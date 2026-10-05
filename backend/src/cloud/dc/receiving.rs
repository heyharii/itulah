//! The Gudang in the cloud: receiving (DC-CLOUD-NATIVE.md).
//!
//! The same routes, and the same JSON, as the DC server's receiving
//! (`edge/http.rs` `dc_purchase_lines` … `dc_verify_purchase`, implemented in
//! `edge/sqlite.rs`), done against the cloud's own Postgres:
//!
//! - the bay opens a delivery (`dc_goods_receipt`, 0900) and counts blind
//!   against it (`dc_receiving_count`) — documents, not stock;
//! - accepting a count is the moment the goods exist: the pieces go into the
//!   Gudang's Unidentified pool in the cloud's movement ledger, and the
//!   cloud's `goods_receipt` / `goods_receipt_line` are written by the very
//!   applier a DC server's fact went through (`apply_goods_receipt_line`),
//!   under the pseudo-origin [`common::CLOUD_DC_ORIGIN`]. That applier splits
//!   matched / excess / wrong, raises the notifications and moves the order's
//!   flow; it books no stock (a DC server's stock arrived on its own movement
//!   fact), so the movement here is the only one;
//! - a refused lorry and a recorded invoice go through
//!   `apply_goods_receipt_rejected` / `apply_goods_receipt_invoice` the same
//!   way.
//!
//! The rules are the DC server's: the counter never sees the ordered quantity
//! or the price; a count on a cancelled order is refused; a line closed short
//! is owed nothing; an order whose counts come out exactly as owed receives
//! itself. Who may count and who may accept is the route's permission (the
//! cloud's path gate), not a name comparison (0828).

use super::common;
use crate::cloud::domain::{
    validate_command, GoodsReceiptInvoicePayload, GoodsReceiptLinePayload,
    GoodsReceiptRejectedPayload, MovementCause, MovementCommand, MovementGroupId, MovementLine,
    Place, PriceAmendmentRequestPayload, SubjectId, SystemPlace,
};
use crate::cloud::http::auth::Principal;
use crate::cloud::postgres::InvoiceApplication;
use crate::cloud::{AppError, AppState};
use crate::edge::contracts::{
    GoodsReceiptView, InvoiceDocumentView, OpenGoodsReceiptRequest, PurchaseCountAwaitingVerification,
    PurchaseCountRequest, PurchaseCountResult, PurchaseCountUnit, PurchaseVerifyDecision,
    PurchaseVerifyRequest, PurchaseVerifyResult, PurchaseWorkLine, RecordInvoiceRequest,
    RejectDeliveryRequest,
};
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// An invoice page over this is a scan setting, not a document (the DC
/// server's own cap).
const INVOICE_PAGE_LIMIT: usize = 8 * 1024 * 1024;

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/dc/purchase-orders", get(purchase_lines))
        .route(
            "/api/v1/dc/goods-receipts",
            get(goods_receipts).post(open_goods_receipt),
        )
        .route(
            "/api/v1/dc/goods-receipts/{receipt_id}/invoice",
            post(record_invoice),
        )
        .route(
            "/api/v1/dc/goods-receipts/{receipt_id}/reject",
            post(reject_delivery),
        )
        .route(
            "/api/v1/dc/goods-receipts/{receipt_id}/invoice-document",
            get(invoice_document)
                .post(store_invoice_document)
                // A page is megabytes on purpose; everything else is JSON.
                .layer(DefaultBodyLimit::max(INVOICE_PAGE_LIMIT + 64 * 1024)),
        )
        .route(
            "/api/v1/dc/purchase-counts",
            get(counts_awaiting_verification).post(count_purchase),
        )
        .route("/api/v1/dc/purchase-verifications", post(verify_purchase))
}

/// Where a purchase order goes when the cloud runs the Gudang, for the
/// issuing code (`create_purchase_order_as`, the catalog order and its
/// revision): the head-office site, and nobody to send it to. Answers the
/// origin the order is "sent to" — the cloud-run Gudang's own.
pub async fn hosted_order_target(
    tx: &mut Transaction<'_, Postgres>,
    destination_site_id: &str,
) -> Result<String, AppError> {
    let gudang = common::gudang_site_tx(tx).await?;
    if destination_site_id.trim() != gudang {
        return Err(AppError::Validation(format!(
            "the Gudang is run by the cloud at the head-office site '{gudang}'; a supplier's \
             delivery is ordered to it, not to '{destination_site_id}'"
        )));
    }
    Ok(common::CLOUD_DC_ORIGIN.to_string())
}

// ---- the routes -------------------------------------------------------------

/// The receiving clerk's work list: the lines the Gudang still owes a
/// delivery against. Blind — never the ordered quantity.
async fn purchase_lines(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let site = common::gudang_site(&state.db).await?;
    let rows = sqlx::query(
        // NOT ordered_quantity: a count taken while looking at the number it
        // is meant to produce is not evidence of anything. Received is what
        // the cloud's receipts matched — the same figure the applier splits
        // against, so the list and the split cannot disagree.
        "SELECT l.po_line_id, o.po_number, o.supplier_id, o.supplier_name,
                l.line_number::bigint AS line_number, l.article_code, l.article_name,
                l.image_url, COALESCE(r.matched, 0)::bigint AS received,
                COALESCE(o.issued_at, o.created_at) AS activated_at,
                l.order_unit_code,
                (SELECT CASE WHEN c.status = 'RECOUNT_REQUESTED'
                             THEN COALESCE(c.verifier_note, '') END
                   FROM dc_receiving_count c WHERE c.po_line_id = l.po_line_id
                  ORDER BY c.counted_at DESC LIMIT 1) AS recount_reason,
                COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                               'code', u.code,
                               'label', u.label,
                               'factor', trim_scale(u.factor)::text,
                               'is_stock', u.code = COALESCE(
                                   (SELECT a.stock_unit_code FROM article a
                                     WHERE a.article_code = btrim(l.article_code)),
                                   (SELECT b.code FROM unit_of_measure b WHERE b.is_base)))
                           ORDER BY u.factor, u.code)
                      FROM (SELECT m.code, m.label,
                                   article_unit_factor(l.article_code, m.code) AS factor
                              FROM unit_of_measure m WHERE m.active) u
                     WHERE u.factor IS NOT NULL), '[]'::jsonb) AS count_units
           FROM purchase_order_line l
           JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
           LEFT JOIN LATERAL (SELECT sum(g.matched_quantity) AS matched
                                FROM goods_receipt_line g
                               WHERE g.po_line_id = l.po_line_id) r ON TRUE
          WHERE o.destination_site_id = $1
            AND o.order_status <> 'CANCELLED'
            AND l.line_status <> 'CANCELLED'
            -- A line closed short is owed nothing more and invites no count.
            AND l.closed_short_at IS NULL
            AND l.ordered_quantity > COALESCE(r.matched, 0)
          ORDER BY activated_at DESC, o.po_number, l.line_number",
    )
    .bind(&site)
    .fetch_all(&state.db)
    .await?;
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let units: Value = row.try_get("count_units")?;
        items.push(PurchaseWorkLine {
            po_line_id: row.try_get("po_line_id")?,
            po_number: row.try_get("po_number")?,
            supplier_id: row.try_get("supplier_id")?,
            supplier_name: row.try_get("supplier_name")?,
            line_number: row.try_get("line_number")?,
            article_code: row.try_get("article_code")?,
            article_name: row.try_get("article_name")?,
            image_url: row.try_get("image_url")?,
            expected_stock_units: None,
            received_stock_units: row.try_get("received")?,
            order_unit_code: row.try_get("order_unit_code")?,
            count_units: serde_json::from_value::<Vec<PurchaseCountUnit>>(units)
                .unwrap_or_default(),
            activated_at: row.try_get("activated_at")?,
            recount_reason: row.try_get("recount_reason")?,
        });
    }
    Ok(Json(json!({ "items": items })))
}

/// Deliveries still being worked through on the loading bay.
async fn goods_receipts(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let site = common::gudang_site(&state.db).await?;
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT receipt_id FROM dc_goods_receipt
          WHERE site_id = $1 AND status = 'OPEN' ORDER BY arrived_at",
    )
    .bind(&site)
    .fetch_all(&state.db)
    .await?;
    let mut conn = state.db.acquire().await?;
    let mut items = Vec::with_capacity(ids.len());
    for id in ids {
        items.push(receipt_view(&mut conn, id).await?);
    }
    Ok(Json(json!({ "items": items })))
}

/// Open a delivery document when a lorry arrives, before anything is counted.
async fn open_goods_receipt(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(mut request): Json<OpenGoodsReceiptRequest>,
) -> Result<(StatusCode, Json<GoodsReceiptView>), AppError> {
    common::require_hosted()?;
    request.actor_id = principal.username;
    let supplier_id = request.supplier_id.trim().to_owned();
    if supplier_id.is_empty() {
        return Err(AppError::Validation(
            "a delivery must name the supplier it came from".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    if let Some(answer) = replay(&mut tx, &request.idempotency_key, "DC_GOODS_RECEIPT_OPEN", &request).await? {
        tx.commit().await?;
        return Ok((StatusCode::CREATED, Json(serde_json::from_value(answer)?)));
    }
    let site = common::gudang_site_tx(&mut tx).await?;
    // A delivery is opened against an order somebody raised, never against a
    // name typed at the bay: every later check compares the two.
    let expected_from: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM purchase_order
          WHERE supplier_id = $1 AND destination_site_id = $2",
    )
    .bind(&supplier_id)
    .bind(&site)
    .fetch_one(&mut *tx)
    .await?;
    if expected_from == 0 {
        return Err(AppError::Validation(format!(
            "the Gudang holds no purchase order with supplier {supplier_id}; a delivery is opened \
             against an order somebody raised, not against a name typed at the bay"
        )));
    }
    let now = state.clock.now();
    let arrived_at = request.arrived_at.unwrap_or(now);
    let receipt_id =
        mint_goods_receipt(&mut tx, &site, &supplier_id, arrived_at, &request.actor_id, now).await?;
    let view = receipt_view(&mut tx, receipt_id).await?;
    remember(&mut tx, &request.idempotency_key, &serde_json::to_value(&view)?).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(view)))
}

/// Record a blind count of what arrived. A document, not a movement.
async fn count_purchase(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(mut request): Json<PurchaseCountRequest>,
) -> Result<(StatusCode, Json<PurchaseCountResult>), AppError> {
    common::require_hosted()?;
    request.actor_id = principal.username;
    // A count of 0 is a statement (owner, 2026-10-05): this line did not come.
    // It puts nothing in the Gudang, and it lets the buyer see the shortage.
    if request.counted_quantity < 0 {
        return Err(AppError::Validation(
            "a count cannot be less than nothing".into(),
        ));
    }
    if request.wrong_quantity < 0 || request.wrong_quantity > request.counted_quantity {
        return Err(AppError::Validation(format!(
            "{} pieces cannot be not as ordered out of a count of {}",
            request.wrong_quantity, request.counted_quantity
        )));
    }
    let mut tx = state.db.begin().await?;
    if let Some(answer) = replay(&mut tx, &request.idempotency_key, "DC_PURCHASE_COUNT", &request).await? {
        tx.commit().await?;
        return Ok((StatusCode::CREATED, Json(serde_json::from_value(answer)?)));
    }
    let site = common::gudang_site_tx(&mut tx).await?;
    let ordered = sqlx::query(
        "SELECT o.purchase_order_id, o.supplier_id, o.order_status, o.destination_site_id
           FROM purchase_order_line l
           JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
          WHERE l.po_line_id = $1",
    )
    .bind(request.po_line_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(ordered) = ordered else {
        return Err(AppError::NotFound(format!(
            "the Gudang holds no purchase order line {}; it cannot count against one it was \
             never given",
            request.po_line_id
        )));
    };
    let purchase_order_id: Uuid = ordered.try_get("purchase_order_id")?;
    let ordered_from: String = ordered.try_get("supplier_id")?;
    let order_status: String = ordered.try_get("order_status")?;
    let destination: String = ordered.try_get("destination_site_id")?;
    if destination != site {
        return Err(AppError::NotFound(format!(
            "purchase order line {} is delivered to {destination}, not to the Gudang",
            request.po_line_id
        )));
    }
    // Head office called the order off: nothing is counted against it.
    if order_status == "CANCELLED" {
        return Err(AppError::Conflict(
            "this purchase order was cancelled by head office; refuse the delivery".into(),
        ));
    }
    // A count typed in a unit other than pieces: converted with the line's
    // own factor, exactly, and checked against the pieces sent.
    let counted_unit = match request
        .counted_unit_code
        .as_deref()
        .map(str::trim)
        .filter(|code| !code.is_empty())
    {
        None => None,
        Some(code) => {
            let code = code.to_uppercase();
            let factor: Option<Decimal> = sqlx::query_scalar(
                "SELECT article_unit_factor(l.article_code, u.code)
                   FROM purchase_order_line l, unit_of_measure u
                  WHERE l.po_line_id = $1 AND u.code = $2 AND u.active",
            )
            .bind(request.po_line_id)
            .bind(&code)
            .fetch_optional(&mut *tx)
            .await?
            .flatten();
            let factor = factor.ok_or_else(|| {
                AppError::Validation(format!(
                    "this line cannot be counted in {code}; count it in pieces"
                ))
            })?;
            let typed = request
                .counted_unit_quantity
                .as_deref()
                .unwrap_or_default()
                .trim()
                .replace(',', ".");
            let pieces = pieces_of(&typed, factor).ok_or_else(|| {
                AppError::Validation(format!("{typed} {code} is not a whole number of pieces"))
            })?;
            if pieces != request.counted_quantity {
                return Err(AppError::Validation(format!(
                    "{typed} {code} is {pieces} pieces, not the {} sent",
                    request.counted_quantity
                )));
            }
            Some((code, typed))
        }
    };
    // A count belongs to a delivery that is still open: counting into a
    // refused one would change a document somebody already acted on.
    let delivery = sqlx::query(
        "SELECT status, supplier_id FROM dc_goods_receipt WHERE receipt_id = $1 FOR UPDATE",
    )
    .bind(request.receipt_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(delivery) = delivery else {
        return Err(AppError::NotFound(format!(
            "no delivery {}: open the document when the lorry arrives, then count into it",
            request.receipt_id
        )));
    };
    let status: String = delivery.try_get("status")?;
    let delivered_by: String = delivery.try_get("supplier_id")?;
    if status != "OPEN" {
        return Err(AppError::Conflict(format!(
            "delivery {} is {}; open a new one for goods arriving now",
            request.receipt_id,
            status.to_lowercase()
        )));
    }
    // One supplier's lorry cannot answer another supplier's order.
    if delivered_by.trim() != ordered_from.trim() {
        return Err(AppError::Validation(format!(
            "this delivery came from {delivered_by} and that order is with {ordered_from}; a \
             supplier's goods cannot be received against another supplier's order"
        )));
    }
    let now = state.clock.now();
    let receipt_id = receipt_for_order(
        &mut tx,
        &site,
        request.receipt_id,
        purchase_order_id,
        delivered_by.trim(),
        &request.actor_id,
        now,
    )
    .await?;
    let count_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO dc_receiving_count
             (count_id, receipt_id, po_line_id, counted_quantity, wrong_quantity,
              counted_unit_code, counted_unit_quantity, counted_by, counted_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'AWAITING_VERIFICATION')",
    )
    .bind(count_id)
    .bind(receipt_id)
    .bind(request.po_line_id)
    .bind(request.counted_quantity)
    .bind(request.wrong_quantity)
    .bind(counted_unit.as_ref().map(|(code, _)| code.clone()))
    .bind(counted_unit.as_ref().map(|(_, quantity)| quantity.clone()))
    .bind(&request.actor_id)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    let response = PurchaseCountResult {
        count_id,
        po_line_id: request.po_line_id,
        counted_quantity: request.counted_quantity,
        wrong_quantity: request.wrong_quantity,
        counted_by: request.actor_id.clone(),
        counted_at: now,
    };
    remember(&mut tx, &request.idempotency_key, &serde_json::to_value(&response)?).await?;
    tx.commit().await?;
    // After the count is committed, and best effort: a failure here only
    // means the count waits for the manual review.
    auto_receive_exact_counts(&state, purchase_order_id).await;
    Ok((StatusCode::CREATED, Json(response)))
}

/// Counts waiting for a decision, with the order's own numbers beside each —
/// the reviewer compares; the checker's list carries neither.
async fn counts_awaiting_verification(
    State(state): State<AppState>,
) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let site = common::gudang_site(&state.db).await?;
    let rows = sqlx::query(
        "SELECT c.count_id, c.receipt_id, c.po_line_id, o.po_number, o.supplier_id,
                l.article_code, l.article_name, c.counted_quantity, c.wrong_quantity,
                c.counted_by, c.counted_at, l.ordered_quantity, l.unit_price_minor,
                COALESCE((SELECT sum(g.matched_quantity) FROM goods_receipt_line g
                           WHERE g.po_line_id = c.po_line_id), 0)::bigint AS already_matched,
                o.created_by, l.order_unit_code,
                trim_scale(l.order_unit_quantity)::text AS order_unit_quantity,
                trim_scale(l.unit_factor)::text AS unit_factor,
                c.counted_unit_code, c.counted_unit_quantity,
                COALESCE((SELECT a.stock_unit_code FROM article a
                           WHERE a.article_code = btrim(l.article_code)),
                         (SELECT b.code FROM unit_of_measure b WHERE b.is_base)) AS stock_unit_code
           FROM dc_receiving_count c
           JOIN dc_goods_receipt r ON r.receipt_id = c.receipt_id
           JOIN purchase_order_line l ON l.po_line_id = c.po_line_id
           JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
          WHERE c.status = 'AWAITING_VERIFICATION'
            AND r.site_id = $1
            -- A count on a cancelled order is void: nobody reviews it.
            AND o.order_status <> 'CANCELLED'
          ORDER BY c.counted_at",
    )
    .bind(&site)
    .fetch_all(&state.db)
    .await?;
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let ordered: i64 = row.try_get("ordered_quantity")?;
        let counted: i64 = row.try_get("counted_quantity")?;
        let already_matched: i64 = row.try_get("already_matched")?;
        items.push(PurchaseCountAwaitingVerification {
            count_id: row.try_get("count_id")?,
            receipt_id: row.try_get("receipt_id")?,
            po_line_id: row.try_get("po_line_id")?,
            po_number: row.try_get("po_number")?,
            supplier_id: row.try_get("supplier_id")?,
            article_code: row.try_get("article_code")?,
            article_name: row.try_get("article_name")?,
            counted_quantity: counted,
            wrong_quantity: row.try_get("wrong_quantity")?,
            counted_by: row.try_get("counted_by")?,
            counted_at: row.try_get("counted_at")?,
            // Both sides are pieces, so there is nothing to convert.
            expected_stock_units: ordered,
            variance: counted - row.try_get::<i64, _>("wrong_quantity")? - ordered,
            outstanding_stock_units: (ordered - already_matched).max(0),
            unit_price_minor: row.try_get("unit_price_minor")?,
            raised_by: row.try_get("created_by")?,
            order_unit_code: row.try_get("order_unit_code")?,
            order_unit_quantity: row.try_get("order_unit_quantity")?,
            unit_factor: row.try_get("unit_factor")?,
            counted_unit_code: row.try_get("counted_unit_code")?,
            counted_unit_quantity: row.try_get("counted_unit_quantity")?,
            stock_unit_code: row.try_get("stock_unit_code")?,
        });
    }
    Ok(Json(json!({ "items": items })))
}

/// Accept a count, or send it back to be counted again.
async fn verify_purchase(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(mut request): Json<PurchaseVerifyRequest>,
) -> Result<(StatusCode, Json<PurchaseVerifyResult>), AppError> {
    common::require_hosted()?;
    request.verifier_actor_id = principal.username;
    let result = verify(&state, request).await?;
    Ok((StatusCode::CREATED, Json(result)))
}

/// Turn a whole delivery away. The document stays, with the reason on it.
async fn reject_delivery(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(receipt_id): Path<Uuid>,
    Json(mut request): Json<RejectDeliveryRequest>,
) -> Result<Json<GoodsReceiptView>, AppError> {
    common::require_hosted()?;
    request.actor_id = principal.username;
    request.receipt_id = receipt_id;
    let reason = request.reason.trim().to_owned();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "refusing a delivery must say why it went back".into(),
        ));
    }
    common::ensure_origin(&state.db).await?;
    let mut tx = state.db.begin().await?;
    if let Some(answer) = replay(&mut tx, &request.idempotency_key, "DC_GOODS_RECEIPT_REJECT", &request).await? {
        tx.commit().await?;
        return Ok(Json(serde_json::from_value(answer)?));
    }
    let held = sqlx::query(
        "SELECT receipt_number, supplier_id, arrived_at, status, opened_by, opened_at
           FROM dc_goods_receipt WHERE receipt_id = $1 FOR UPDATE",
    )
    .bind(receipt_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("no delivery {receipt_id}")))?;
    let status: String = held.try_get("status")?;
    if status != "OPEN" {
        return Err(AppError::Conflict(format!(
            "delivery {receipt_id} is already {}",
            status.to_lowercase()
        )));
    }
    let accepted: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM dc_receiving_count
          WHERE receipt_id = $1 AND status = 'ACCEPTED'",
    )
    .bind(receipt_id)
    .fetch_one(&mut *tx)
    .await?;
    if accepted > 0 {
        return Err(AppError::Conflict(format!(
            "delivery {receipt_id} already has accepted goods on it; those are in the warehouse \
             and cannot be un-arrived"
        )));
    }
    let decided_at = state.clock.now();
    sqlx::query(
        "UPDATE dc_goods_receipt
            SET status = 'REJECTED', rejected_reason = $2, closed_by = $3, closed_at = $4
          WHERE receipt_id = $1",
    )
    .bind(receipt_id)
    .bind(&reason)
    .bind(&request.actor_id)
    .bind(decided_at)
    .execute(&mut *tx)
    .await?;
    // Supplier performance is asked at head office: the refusal is written
    // where the DC server's fact would have put it.
    let refused = GoodsReceiptRejectedPayload {
        receipt_id,
        receipt_number: held.try_get("receipt_number")?,
        supplier_id: held.try_get("supplier_id")?,
        arrived_at: held.try_get("arrived_at")?,
        opened_by: held.try_get("opened_by")?,
        opened_at: held.try_get("opened_at")?,
        reason,
        rejected_by: request.actor_id.clone(),
        rejected_at: decided_at,
    };
    let seq = common::next_seq(&mut tx).await?;
    crate::cloud::postgres::apply_goods_receipt_rejected(
        &mut tx,
        common::CLOUD_DC_ORIGIN,
        common::CLOUD_DC_GENERATION,
        seq,
        &refused,
    )
    .await?;
    let view = receipt_view(&mut tx, receipt_id).await?;
    remember(&mut tx, &request.idempotency_key, &serde_json::to_value(&view)?).await?;
    tx.commit().await?;
    Ok(Json(view))
}

/// Record the supplier's invoice against a delivery.
async fn record_invoice(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(receipt_id): Path<Uuid>,
    Json(mut request): Json<RecordInvoiceRequest>,
) -> Result<Json<GoodsReceiptView>, AppError> {
    common::require_hosted()?;
    request.actor_id = principal.username;
    request.receipt_id = receipt_id;
    if request.invoice_number.trim().is_empty() {
        return Err(AppError::Validation("an invoice must have a number".into()));
    }
    if request.invoice_total_minor < 0 {
        return Err(AppError::Validation(
            "an invoice total cannot be negative".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    if let Some(answer) = replay(&mut tx, &request.idempotency_key, "DC_GOODS_RECEIPT_INVOICE", &request).await? {
        tx.commit().await?;
        return Ok(Json(serde_json::from_value(answer)?));
    }
    let recorded_at = state.clock.now();
    let invoice_date = request
        .invoice_date
        .as_deref()
        .map(str::trim)
        .filter(|day| !day.is_empty())
        .map(str::to_owned);
    let updated = sqlx::query(
        "UPDATE dc_goods_receipt
            SET invoice_number = $2, invoice_date = $3, invoice_total_minor = $4,
                invoice_document_ref = $5, invoice_recorded_by = $6, invoice_recorded_at = $7
          WHERE receipt_id = $1",
    )
    .bind(receipt_id)
    .bind(request.invoice_number.trim())
    .bind(&invoice_date)
    .bind(request.invoice_total_minor)
    .bind(&request.invoice_document_ref)
    .bind(&request.actor_id)
    .bind(recorded_at)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::NotFound(format!("no delivery {receipt_id}")));
    }
    // An invoice is agreement about goods somebody checked, and the cloud's
    // receipt exists only from the first accepted line.
    let accepted: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM dc_receiving_count
          WHERE receipt_id = $1 AND status = 'ACCEPTED'",
    )
    .bind(receipt_id)
    .fetch_one(&mut *tx)
    .await?;
    if accepted == 0 {
        return Err(AppError::Conflict(format!(
            "delivery {receipt_id} has nothing accepted yet: check the goods in before recording \
             the supplier's invoice"
        )));
    }
    let invoice = GoodsReceiptInvoicePayload {
        receipt_id,
        invoice_number: request.invoice_number.trim().to_owned(),
        invoice_date,
        invoice_total_minor: request.invoice_total_minor,
        invoice_document_ref: request.invoice_document_ref.clone(),
        recorded_by: request.actor_id.clone(),
        recorded_at,
    };
    match crate::cloud::postgres::apply_goods_receipt_invoice(&mut tx, &invoice).await? {
        InvoiceApplication::Applied => {}
        InvoiceApplication::NoSuchReceipt => {
            return Err(AppError::Conflict(format!(
                "delivery {receipt_id} has no goods receipt at head office yet"
            )));
        }
    }
    let view = receipt_view(&mut tx, receipt_id).await?;
    remember(&mut tx, &request.idempotency_key, &serde_json::to_value(&view)?).await?;
    tx.commit().await?;
    Ok(Json(view))
}

/// The name and type of the page being uploaded, as the hub sends them.
#[derive(Debug, Deserialize)]
struct InvoiceUploadQuery {
    name: String,
    #[serde(rename = "type")]
    content_type: Option<String>,
    /// Sent by the hub for a node without sign-in; here the signed-in user is
    /// who uploads.
    #[serde(default)]
    #[allow(dead_code)]
    actor: Option<String>,
}

/// Keep the supplier's invoice page against its delivery. One per delivery:
/// a second upload replaces the first.
async fn store_invoice_document(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(receipt_id): Path<Uuid>,
    Query(query): Query<InvoiceUploadQuery>,
    bytes: Bytes,
) -> Result<(StatusCode, Json<InvoiceDocumentView>), AppError> {
    common::require_hosted()?;
    if bytes.is_empty() {
        return Err(AppError::Validation("an empty file is not an invoice".into()));
    }
    if bytes.len() > INVOICE_PAGE_LIMIT {
        return Err(AppError::Validation(format!(
            "an invoice page over {} MB is a scan setting, not a document",
            INVOICE_PAGE_LIMIT / (1024 * 1024)
        )));
    }
    let filename = query.name.trim().to_owned();
    if filename.is_empty() {
        return Err(AppError::Validation(
            "an uploaded file must arrive with a name".into(),
        ));
    }
    let content_type = query
        .content_type
        .as_deref()
        .map(str::trim)
        .filter(|kind| !kind.is_empty())
        .unwrap_or("application/octet-stream")
        .to_owned();
    let known: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM dc_goods_receipt WHERE receipt_id = $1)")
            .bind(receipt_id)
            .fetch_one(&state.db)
            .await?;
    if !known {
        return Err(AppError::NotFound(format!("no delivery {receipt_id}")));
    }
    let byte_count = bytes.len() as i64;
    // The bucket when there is one (never `media`, which is public); the
    // database when there is not.
    let (storage_key, stored_bytes) = match &state.attachments {
        Some(store) => {
            let key = format!("dc/invoice-documents/{receipt_id}/{}", Uuid::new_v4());
            store.put(&key, bytes.to_vec(), &content_type).await?;
            (Some(key), None)
        }
        None => (None, Some(bytes.to_vec())),
    };
    let uploaded_at = state.clock.now();
    sqlx::query(
        "INSERT INTO dc_invoice_document
             (receipt_id, filename, content_type, byte_count, storage_key, bytes,
              uploaded_by, uploaded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (receipt_id) DO UPDATE SET
             filename = EXCLUDED.filename,
             content_type = EXCLUDED.content_type,
             byte_count = EXCLUDED.byte_count,
             storage_key = EXCLUDED.storage_key,
             bytes = EXCLUDED.bytes,
             uploaded_by = EXCLUDED.uploaded_by,
             uploaded_at = EXCLUDED.uploaded_at",
    )
    .bind(receipt_id)
    .bind(&filename)
    .bind(&content_type)
    .bind(byte_count)
    .bind(&storage_key)
    .bind(&stored_bytes)
    .bind(&principal.username)
    .bind(uploaded_at)
    .execute(&state.db)
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(InvoiceDocumentView {
            receipt_id,
            filename,
            content_type,
            byte_count,
            uploaded_by: principal.username,
            uploaded_at,
        }),
    ))
}

/// The page back, inline, for a reviewer who wants to read it again.
async fn invoice_document(
    State(state): State<AppState>,
    Path(receipt_id): Path<Uuid>,
) -> Result<Response, AppError> {
    common::require_hosted()?;
    let row = sqlx::query(
        "SELECT content_type, storage_key, bytes FROM dc_invoice_document WHERE receipt_id = $1",
    )
    .bind(receipt_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| {
        AppError::NotFound(format!("no invoice page on file for delivery {receipt_id}"))
    })?;
    let content_type: String = row.try_get("content_type")?;
    let storage_key: Option<String> = row.try_get("storage_key")?;
    let stored: Option<Vec<u8>> = row.try_get("bytes")?;
    let body = match (stored, storage_key) {
        (Some(bytes), _) => bytes,
        (None, Some(key)) => {
            let store = state.attachments.as_ref().ok_or_else(|| {
                AppError::NotFound(
                    "the invoice page is in the attachment bucket, which this cloud no longer has"
                        .into(),
                )
            })?;
            store.get(&key).await?
        }
        (None, None) => {
            return Err(AppError::NotFound(format!(
                "no invoice page on file for delivery {receipt_id}"
            )))
        }
    };
    let mut headers = HeaderMap::new();
    // The stored type is what the browser said: operator text, so a value a
    // header cannot carry falls back to bytes rather than failing the read.
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(header::CONTENT_DISPOSITION, HeaderValue::from_static("inline"));
    Ok((headers, body).into_response())
}

// ---- accepting ----------------------------------------------------------------

/// Decide a counted delivery: accept it, or send it back to be counted again.
///
/// Accepting is the moment the goods first exist. The reviewer approves the
/// checker's number as it stands; there is no way to accept a different one.
async fn verify(
    state: &AppState,
    request: PurchaseVerifyRequest,
) -> Result<PurchaseVerifyResult, AppError> {
    if request.decision == PurchaseVerifyDecision::Recount
        && request
            .note
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
    {
        return Err(AppError::Validation(
            "a recount request must say what to look at again".into(),
        ));
    }
    if request.invoiced_price_minor.is_some_and(|price| price < 0) {
        return Err(AppError::Validation(
            "an invoiced price cannot be negative".into(),
        ));
    }
    if request.verifier_actor_id.trim().is_empty() {
        return Err(AppError::Validation("who is accepting is required".into()));
    }
    common::ensure_origin(&state.db).await?;
    let mut tx = state.db.begin().await?;
    if let Some(answer) = replay(&mut tx, &request.idempotency_key, "DC_PURCHASE_VERIFY", &request).await? {
        tx.commit().await?;
        return Ok(serde_json::from_value(answer)?);
    }
    let held = sqlx::query(
        "SELECT c.po_line_id, c.receipt_id, c.counted_by, c.counted_at, c.counted_quantity,
                c.wrong_quantity, c.status, l.article_code, l.unit_price_minor,
                o.order_status, o.destination_site_id,
                r.receipt_number, r.supplier_id, r.arrived_at, r.opened_by, r.opened_at
           FROM dc_receiving_count c
           JOIN dc_goods_receipt r ON r.receipt_id = c.receipt_id
           JOIN purchase_order_line l ON l.po_line_id = c.po_line_id
           JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
          WHERE c.count_id = $1
          FOR UPDATE OF c",
    )
    .bind(request.count_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("no count {}", request.count_id)))?;
    let status: String = held.try_get("status")?;
    if status != "AWAITING_VERIFICATION" {
        return Err(AppError::Conflict(format!(
            "count {} was already {}",
            request.count_id,
            status.to_lowercase().replace('_', " ")
        )));
    }
    // Head office called the order off: a count still waiting on it is void,
    // and neither decision may touch the order.
    let order_status: String = held.try_get("order_status")?;
    if order_status == "CANCELLED" {
        return Err(AppError::Conflict(
            "this order was cancelled; its count cannot be received or sent back to count".into(),
        ));
    }
    let po_line_id: Uuid = held.try_get("po_line_id")?;
    let counted_by: String = held.try_get("counted_by")?;
    let decided_at = state.clock.now();

    if request.decision == PurchaseVerifyDecision::Recount {
        sqlx::query(
            "UPDATE dc_receiving_count
                SET status = 'RECOUNT_REQUESTED', verified_by = $2, verified_at = $3,
                    verifier_note = $4
              WHERE count_id = $1",
        )
        .bind(request.count_id)
        .bind(&request.verifier_actor_id)
        .bind(decided_at)
        .bind(&request.note)
        .execute(&mut *tx)
        .await?;
        let response = PurchaseVerifyResult {
            count_id: request.count_id,
            po_line_id,
            decision: PurchaseVerifyDecision::Recount,
            counted_by,
            verified_by: request.verifier_actor_id.clone(),
            accepted_quantity: None,
            matched_quantity: None,
            excess_quantity: None,
            wrong_quantity: None,
            agreed_unit_price_minor: None,
            price_amendment_request_id: None,
            movement_group_id: None,
            decided_at,
        };
        remember(&mut tx, &request.idempotency_key, &serde_json::to_value(&response)?).await?;
        tx.commit().await?;
        return Ok(response);
    }

    // ---- accepted ------------------------------------------------------------
    let site: String = held.try_get("destination_site_id")?;
    let article_code: String = held.try_get("article_code")?;
    let counted_quantity: i64 = held.try_get("counted_quantity")?;
    let wrong_quantity: i64 = held.try_get("wrong_quantity")?;
    let counted_at: DateTime<Utc> = held.try_get("counted_at")?;

    // A count of 0 is settled by saying so: nothing arrived, so there is no
    // receipt line and no movement, and the line stays owed what it was.
    if counted_quantity == 0 {
        sqlx::query(
            "UPDATE dc_receiving_count
                SET status = 'ACCEPTED', verified_by = $2, verified_at = $3, verifier_note = $4,
                    matched_quantity = 0, excess_quantity = 0
              WHERE count_id = $1",
        )
        .bind(request.count_id)
        .bind(&request.verifier_actor_id)
        .bind(decided_at)
        .bind(&request.note)
        .execute(&mut *tx)
        .await?;
        let response = PurchaseVerifyResult {
            count_id: request.count_id,
            po_line_id,
            decision: PurchaseVerifyDecision::Accept,
            counted_by,
            verified_by: request.verifier_actor_id.clone(),
            accepted_quantity: Some(0),
            matched_quantity: Some(0),
            excess_quantity: Some(0),
            wrong_quantity: Some(0),
            agreed_unit_price_minor: None,
            price_amendment_request_id: None,
            movement_group_id: None,
            decided_at,
        };
        remember(&mut tx, &request.idempotency_key, &serde_json::to_value(&response)?).await?;
        tx.commit().await?;
        return Ok(response);
    }
    // The price as it stands right now, written onto the acceptance so a
    // later amendment cannot restate what this delivery was worth.
    let agreed_unit_price_minor: i64 = held.try_get("unit_price_minor")?;

    // The goods come into existence as a quantity of an article — no SKU, no
    // tag — in the Gudang's Unidentified pool. All the counted pieces: 105
    // arrived and 105 go in; the split below only says which of them the
    // company agreed to buy.
    let pool_id = unidentified_pool(&mut tx, &site).await?;
    let subject_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO inventory_subject (id, subject_type, sku_id, epc, barcode, quantity, uom, created_at)
         VALUES ($1, 'QUANTITY', NULL, NULL, NULL, $2, 'PCS', $3)",
    )
    .bind(subject_id)
    .bind(counted_quantity)
    .bind(decided_at)
    .execute(&mut *tx)
    .await?;
    let command = MovementCommand {
        movement_group_id: MovementGroupId::new(),
        lines: vec![MovementLine {
            subject_id: SubjectId(subject_id),
            quantity: counted_quantity,
            from: Place::System {
                place: SystemPlace::Opening,
            },
            to: format!("{pool_id}:on_hand").parse().map_err(
                |error: crate::cloud::domain::PlaceError| AppError::Validation(error.to_string()),
            )?,
        }],
        cause: MovementCause::Opening,
        reference_type: Some("PURCHASE_ORDER_LINE".into()),
        reference_id: Some(po_line_id.to_string()),
        reason: if wrong_quantity > 0 {
            format!(
                "Penerimaan {article_code} disetujui {} · {} pcs tidak sesuai pesanan",
                request.verifier_actor_id, wrong_quantity
            )
        } else {
            format!(
                "Penerimaan {article_code} disetujui {}",
                request.verifier_actor_id
            )
        },
        actor_id: request.verifier_actor_id.clone(),
        occurred_at: decided_at,
    };
    validate_command(&command).map_err(|error| AppError::Validation(error.to_string()))?;
    let movement_key = format!("dc-receive:{}", request.count_id);
    let digest = crate::cloud::postgres::payload_digest(&request)?;
    crate::cloud::postgres::insert_group(&mut tx, &command, &movement_key, &digest).await?;
    crate::cloud::postgres::apply_lines(&mut tx, &command, &movement_key, &digest).await?;
    let movement_group_id = command.movement_group_id.0;

    // A price that disagrees with the invoice is reported, not obeyed and not
    // waited on: the goods go in above either way.
    let mut price_amendment_request_id = None;
    if let Some(invoiced) = request.invoiced_price_minor {
        if invoiced != agreed_unit_price_minor {
            let request_id = Uuid::new_v4();
            let note = request
                .note
                .as_deref()
                .map(str::trim)
                .filter(|note| !note.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| {
                    format!("Invoice supplier {invoiced} per unit, PO {agreed_unit_price_minor}")
                });
            let amendment = PriceAmendmentRequestPayload {
                request_id,
                po_line_id,
                count_id: request.count_id,
                invoiced_price_minor: invoiced,
                note,
                requested_by: request.verifier_actor_id.clone(),
                requested_at: decided_at,
            };
            let seq = common::next_seq(&mut tx).await?;
            crate::cloud::postgres::apply_price_amendment_request(
                &mut tx,
                common::CLOUD_DC_ORIGIN,
                common::CLOUD_DC_GENERATION,
                seq,
                &amendment,
            )
            .await?;
            price_amendment_request_id = Some(request_id);
        }
    }

    // The cloud's receipt line, through the applier the DC server's fact went
    // through: it re-derives matched / excess / wrong from the order, writes
    // the document from its first line, raises the notifications and moves
    // the order's flow. It books no stock — that is the movement above.
    let receipt_line_id = Uuid::new_v4();
    let line = GoodsReceiptLinePayload {
        receipt_id: held.try_get("receipt_id")?,
        receipt_number: held.try_get("receipt_number")?,
        supplier_id: held.try_get("supplier_id")?,
        arrived_at: held.try_get("arrived_at")?,
        opened_by: held.try_get("opened_by")?,
        opened_at: held.try_get("opened_at")?,
        receipt_line_id,
        count_id: Some(request.count_id),
        po_line_id,
        movement_group_id,
        quantity: counted_quantity,
        matched_quantity: None,
        excess_quantity: None,
        wrong_quantity,
        agreed_unit_price_minor: Some(agreed_unit_price_minor),
        counted_by: counted_by.clone(),
        verified_by: request.verifier_actor_id.clone(),
        counted_at,
        verified_at: decided_at,
    };
    let seq = common::next_seq(&mut tx).await?;
    crate::cloud::postgres::apply_goods_receipt_line(
        &mut tx,
        common::CLOUD_DC_ORIGIN,
        common::CLOUD_DC_GENERATION,
        seq,
        &line,
    )
    .await?;
    // The split as the applier wrote it, so the answer and the books agree.
    let split = sqlx::query(
        "SELECT matched_quantity, excess_quantity FROM goods_receipt_line
          WHERE receipt_line_id = $1",
    )
    .bind(receipt_line_id)
    .fetch_one(&mut *tx)
    .await?;
    let matched_quantity: i64 = split.try_get("matched_quantity")?;
    let excess_quantity: i64 = split.try_get("excess_quantity")?;

    sqlx::query(
        "UPDATE dc_receiving_count
            SET status = 'ACCEPTED', verified_by = $2, verified_at = $3, verifier_note = $4,
                receipt_line_id = $5, movement_group_id = $6, matched_quantity = $7,
                excess_quantity = $8, agreed_unit_price_minor = $9
          WHERE count_id = $1",
    )
    .bind(request.count_id)
    .bind(&request.verifier_actor_id)
    .bind(decided_at)
    .bind(&request.note)
    .bind(receipt_line_id)
    .bind(movement_group_id)
    .bind(matched_quantity)
    .bind(excess_quantity)
    .bind(agreed_unit_price_minor)
    .execute(&mut *tx)
    .await?;

    let response = PurchaseVerifyResult {
        count_id: request.count_id,
        po_line_id,
        decision: PurchaseVerifyDecision::Accept,
        counted_by,
        verified_by: request.verifier_actor_id.clone(),
        accepted_quantity: Some(counted_quantity),
        matched_quantity: Some(matched_quantity),
        excess_quantity: Some(excess_quantity),
        wrong_quantity: Some(wrong_quantity),
        agreed_unit_price_minor: Some(agreed_unit_price_minor),
        price_amendment_request_id,
        movement_group_id: Some(movement_group_id),
        decided_at,
    };
    remember(&mut tx, &request.idempotency_key, &serde_json::to_value(&response)?).await?;
    tx.commit().await?;
    Ok(response)
}

/// Receive an order whose counts came out exactly as owed, without waiting
/// for anybody to press Accept (owner, 2026-10-02).
///
/// Every line still owed goods has exactly one count waiting, each exactly
/// what the line owes, none naming mismatched pieces, and no count waits on a
/// line that owes nothing. Then each is accepted through [`verify`] — the
/// path a manual Accept takes — in the name of whoever raised the order.
/// That person may have counted it themselves: counting and accepting are
/// permissions, not two people (0828). Anything else waits for review.
async fn auto_receive_exact_counts(state: &AppState, purchase_order_id: Uuid) {
    let candidates = match exact_counts_of_order(&state.db, purchase_order_id).await {
        Ok(candidates) => candidates,
        Err(error) => {
            tracing::warn!(%error, %purchase_order_id, "auto-receive check failed; the count waits for review");
            return;
        }
    };
    let Some((raised_by, count_ids)) = candidates else {
        return;
    };
    for count_id in count_ids {
        let request = PurchaseVerifyRequest {
            count_id,
            verifier_actor_id: raised_by.clone(),
            decision: PurchaseVerifyDecision::Accept,
            note: None,
            invoiced_price_minor: None,
            idempotency_key: format!("auto-receive:{count_id}"),
        };
        if let Err(error) = verify(state, request).await {
            tracing::warn!(%error, %count_id, %purchase_order_id, "auto-receive refused; the count waits for review");
            return;
        }
    }
}

/// The order's raiser and the counts to accept when its waiting counts match
/// what it still owes exactly; `None` when anything differs.
async fn exact_counts_of_order(
    db: &PgPool,
    purchase_order_id: Uuid,
) -> Result<Option<(String, Vec<Uuid>)>, AppError> {
    let header = sqlx::query(
        "SELECT created_by, order_status FROM purchase_order WHERE purchase_order_id = $1",
    )
    .bind(purchase_order_id)
    .fetch_optional(db)
    .await?;
    let Some(header) = header else {
        return Ok(None);
    };
    let status: String = header.try_get("order_status")?;
    if status == "CANCELLED" {
        return Ok(None);
    }
    let Some(raised_by) = header
        .try_get::<Option<String>, _>("created_by")?
        .map(|who| who.trim().to_owned())
        .filter(|who| !who.is_empty())
    else {
        return Ok(None);
    };
    // What each line still owes, the way the receipt applier reckons it.
    let mut owed = std::collections::HashMap::new();
    for row in sqlx::query(
        "SELECT l.po_line_id,
                CASE WHEN l.closed_short_at IS NOT NULL OR l.line_status = 'CANCELLED' THEN 0
                     ELSE GREATEST(l.ordered_quantity
                                   - COALESCE((SELECT sum(g.matched_quantity)
                                                 FROM goods_receipt_line g
                                                WHERE g.po_line_id = l.po_line_id), 0), 0)
                END::bigint AS owed
           FROM purchase_order_line l
          WHERE l.purchase_order_id = $1",
    )
    .bind(purchase_order_id)
    .fetch_all(db)
    .await?
    {
        let line: Uuid = row.try_get("po_line_id")?;
        let outstanding: i64 = row.try_get("owed")?;
        if outstanding > 0 {
            owed.insert(line, outstanding);
        }
    }
    if owed.is_empty() {
        return Ok(None);
    }
    let waiting = sqlx::query(
        "SELECT c.count_id, c.po_line_id, c.counted_quantity, c.wrong_quantity
           FROM dc_receiving_count c
           JOIN purchase_order_line l ON l.po_line_id = c.po_line_id
          WHERE l.purchase_order_id = $1 AND c.status = 'AWAITING_VERIFICATION'
          ORDER BY c.counted_at",
    )
    .bind(purchase_order_id)
    .fetch_all(db)
    .await?;
    // One count per owing line, each exactly what it owes, nothing else.
    if waiting.len() != owed.len() {
        return Ok(None);
    }
    let mut seen = std::collections::HashSet::with_capacity(waiting.len());
    let mut count_ids = Vec::with_capacity(waiting.len());
    for row in waiting {
        let line: Uuid = row.try_get("po_line_id")?;
        let counted: i64 = row.try_get("counted_quantity")?;
        let wrong: i64 = row.try_get("wrong_quantity")?;
        // Mismatched goods are exactly what a buyer has to see.
        if wrong > 0 || owed.get(&line) != Some(&counted) || !seen.insert(line) {
            return Ok(None);
        }
        count_ids.push(row.try_get("count_id")?);
    }
    Ok(Some((raised_by, count_ids)))
}

// ---- the delivery document ----------------------------------------------------

/// One delivery document as the bay sees it, with how far it has got.
async fn receipt_view(
    conn: &mut sqlx::PgConnection,
    receipt_id: Uuid,
) -> Result<GoodsReceiptView, AppError> {
    let row = sqlx::query(
        "SELECT r.receipt_number, r.supplier_id, r.arrived_at, r.status, r.opened_by,
                r.invoice_number, r.invoice_total_minor,
                (SELECT count(*) FROM dc_receiving_count c
                  WHERE c.receipt_id = r.receipt_id)::bigint AS counted_lines,
                (SELECT count(*) FROM dc_receiving_count c
                  WHERE c.receipt_id = r.receipt_id AND c.status = 'ACCEPTED')::bigint
                    AS accepted_lines
           FROM dc_goods_receipt r WHERE r.receipt_id = $1",
    )
    .bind(receipt_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("no delivery {receipt_id}")))?;
    Ok(GoodsReceiptView {
        receipt_id,
        receipt_number: row.try_get("receipt_number")?,
        supplier_id: row.try_get("supplier_id")?,
        arrived_at: row.try_get("arrived_at")?,
        status: row.try_get("status")?,
        opened_by: row.try_get("opened_by")?,
        invoice_number: row.try_get("invoice_number")?,
        invoice_total_minor: row.try_get("invoice_total_minor")?,
        counted_lines: row.try_get("counted_lines")?,
        accepted_lines: row.try_get("accepted_lines")?,
    })
}

/// Write a new, open delivery document and hand back its id. The number is
/// gap-free per site and year, and carries the year so it can never meet a
/// number a DC server once issued (`goods_receipt.receipt_number` is unique).
async fn mint_goods_receipt(
    tx: &mut Transaction<'_, Postgres>,
    site_id: &str,
    supplier_id: &str,
    arrived_at: DateTime<Utc>,
    opened_by: &str,
    opened_at: DateTime<Utc>,
) -> Result<Uuid, AppError> {
    // The year of the site's own day, not UTC's.
    let year: i32 = sqlx::query_scalar(
        "SELECT EXTRACT(YEAR FROM ($1::timestamptz AT TIME ZONE site_business_timezone($2)))::int",
    )
    .bind(opened_at)
    .bind(site_id)
    .fetch_one(&mut **tx)
    .await?;
    let number = common::next_number(tx, site_id, "GRN", year).await?;
    let code = common::site_code_tx(tx, site_id).await?;
    let receipt_number = format!("GRN-{code}-{year}-{number:06}");
    let receipt_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO dc_goods_receipt
             (receipt_id, site_id, receipt_number, supplier_id, arrived_at, status,
              opened_by, opened_at)
         VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $7)",
    )
    .bind(receipt_id)
    .bind(site_id)
    .bind(&receipt_number)
    .bind(supplier_id)
    .bind(arrived_at)
    .bind(opened_by)
    .bind(opened_at)
    .execute(&mut **tx)
    .await?;
    Ok(receipt_id)
}

/// The receipt a count of `purchase_order_id` goes on: one per order.
///
/// The bay opens one document per lorry and counts every order of that
/// supplier into it, but the buyer reviews and files the invoice per order.
/// So a count for a second order of the same lorry lands on that order's own
/// receipt: the one it already has (open, no invoice yet), or a new one with
/// the same arrival.
async fn receipt_for_order(
    tx: &mut Transaction<'_, Postgres>,
    site_id: &str,
    requested: Uuid,
    purchase_order_id: Uuid,
    supplier_id: &str,
    actor_id: &str,
    now: DateTime<Utc>,
) -> Result<Uuid, AppError> {
    let foreign: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM dc_receiving_count c
           JOIN purchase_order_line l ON l.po_line_id = c.po_line_id
          WHERE c.receipt_id = $1 AND l.purchase_order_id <> $2",
    )
    .bind(requested)
    .bind(purchase_order_id)
    .fetch_one(&mut **tx)
    .await?;
    if foreign == 0 {
        return Ok(requested);
    }
    let own: Option<Uuid> = sqlx::query_scalar(
        "SELECT r.receipt_id FROM dc_goods_receipt r
          WHERE r.status = 'OPEN' AND r.invoice_number IS NULL
            AND r.site_id = $3 AND r.supplier_id = $2
            AND EXISTS (SELECT 1 FROM dc_receiving_count c
                          JOIN purchase_order_line l ON l.po_line_id = c.po_line_id
                         WHERE c.receipt_id = r.receipt_id AND l.purchase_order_id = $1)
            AND NOT EXISTS (SELECT 1 FROM dc_receiving_count c
                              JOIN purchase_order_line l ON l.po_line_id = c.po_line_id
                             WHERE c.receipt_id = r.receipt_id AND l.purchase_order_id <> $1)
          ORDER BY r.opened_at DESC LIMIT 1",
    )
    .bind(purchase_order_id)
    .bind(supplier_id)
    .bind(site_id)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some(own) = own {
        return Ok(own);
    }
    let arrived_at: DateTime<Utc> =
        sqlx::query_scalar("SELECT arrived_at FROM dc_goods_receipt WHERE receipt_id = $1")
            .bind(requested)
            .fetch_one(&mut **tx)
            .await?;
    mint_goods_receipt(tx, site_id, supplier_id, arrived_at, actor_id, now).await
}

/// The Gudang's Unidentified pool: found by its role and code (0610), never
/// by how its id is spelled. The site is given its template pools first, so
/// a Gudang set up before them still has one.
async fn unidentified_pool(
    tx: &mut Transaction<'_, Postgres>,
    site_id: &str,
) -> Result<String, AppError> {
    sqlx::query("SELECT ensure_site_pools($1)")
        .bind(site_id)
        .execute(&mut **tx)
        .await?;
    let pool: Option<String> = sqlx::query_scalar(
        "SELECT id FROM operational_pool
          WHERE site_id = $1 AND role = 'RECEIVING' AND pool_code = 'UNIDENTIFIED' AND active
          ORDER BY display_order, id LIMIT 1",
    )
    .bind(site_id)
    .fetch_optional(&mut **tx)
    .await?;
    pool.ok_or_else(|| {
        AppError::Conflict(format!(
            "site {site_id} has no Unidentified pool to receive goods into"
        ))
    })
}

/// `quantity × factor` as a whole number of pieces, exactly, or `None` when
/// the quantity is not a number, the product is not whole, or not positive.
/// Decimal, not float: 9.5 KODI is 190 pieces, never 189.99999.
fn pieces_of(quantity: &str, factor: Decimal) -> Option<i64> {
    let quantity: Decimal = quantity.parse().ok()?;
    let exact = quantity.checked_mul(factor)?;
    if exact <= Decimal::ZERO || exact.fract() != Decimal::ZERO {
        return None;
    }
    rust_decimal::prelude::ToPrimitive::to_i64(&exact)
}

// ---- retries --------------------------------------------------------------------

/// A retried request gets the answer it already had; the same key with a
/// different body is refused. The cloud's own command log
/// (`command_deduplication`), inside the request's transaction, so a request
/// that rolls back leaves no claim on its key.
async fn replay<T: Serialize>(
    tx: &mut Transaction<'_, Postgres>,
    key: &str,
    command_type: &str,
    request: &T,
) -> Result<Option<Value>, AppError> {
    if key.trim().is_empty() {
        return Err(AppError::Validation("idempotency_key is required".into()));
    }
    let digest = crate::cloud::postgres::payload_digest(request)?;
    let inserted = sqlx::query(
        "INSERT INTO command_deduplication (idempotency_key, command_type, payload_digest)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    )
    .bind(key)
    .bind(command_type)
    .bind(&digest)
    .execute(&mut **tx)
    .await?
    .rows_affected()
        == 1;
    if inserted {
        return Ok(None);
    }
    let row = sqlx::query(
        "SELECT command_type, payload_digest, response_json
           FROM command_deduplication WHERE idempotency_key = $1",
    )
    .bind(key)
    .fetch_one(&mut **tx)
    .await?;
    let existing_type: String = row.try_get("command_type")?;
    let existing_digest: String = row.try_get("payload_digest")?;
    if existing_type != command_type || existing_digest != digest {
        return Err(AppError::Conflict(
            "idempotency key was already used with a different command or payload".into(),
        ));
    }
    let response: Option<Value> = row.try_get("response_json")?;
    response.map(Some).ok_or_else(|| {
        AppError::Conflict("matching command is still in progress; retry shortly".into())
    })
}

async fn remember(
    tx: &mut Transaction<'_, Postgres>,
    key: &str,
    response: &Value,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE command_deduplication SET response_json = $2
          WHERE idempotency_key = $1 AND response_json IS NULL",
    )
    .bind(key)
    .bind(response)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
