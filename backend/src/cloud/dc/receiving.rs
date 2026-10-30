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
    GoodsReceiptView, InvoiceDocumentView, OpenGoodsReceiptRequest,
    PurchaseCountAwaitingVerification, PurchaseCountBatchRequest, PurchaseCountBatchResult,
    PurchaseCountRecallRequest, PurchaseCountRecallResult, PurchaseCountRequest,
    PurchaseCountResult, PurchaseCountUnit, PurchaseCountVariant, PurchaseReviewVariant,
    PurchaseVerifyDecision, PurchaseVerifyRequest, PurchaseVerifyResult, PurchaseWorkLine,
    PurchaseWorkVariant, RecalledCount, RecordInvoiceRequest, RejectDeliveryRequest,
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
        .route("/api/v1/dc/purchase-orders/summary", get(purchase_summary))
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
        .route(
            "/api/v1/dc/purchase-counts/batch",
            post(count_purchase_batch),
        )
        // Under the counting path on purpose: whoever may count may take their
        // count back (0950), and the path gate reads the prefix.
        .route("/api/v1/dc/purchase-counts/recall", post(recall_counts))
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

/// What the screens outside Receiving need from its work list, without the
/// list: how many orders the Gudang is still owed a delivery against (the
/// badge on every page) and which of them were sent back to be counted again,
/// with the reason (the order book). The same lines as [`purchase_lines`] —
/// the list itself is a line per article with its units, megabytes once the
/// open book is large, and a badge polled from every screen must not fetch it
/// to count it.
async fn purchase_summary(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let site = common::gudang_site(&state.db).await?;
    let row = sqlx::query(
        "WITH unsettled AS MATERIALIZED (
             -- Only an order that is not yet settled can owe anything: the
             -- summary says which (0826), and an order it has no row for is
             -- still looked at. Without this every line of every order ever
             -- placed was asked how much of it had arrived (36 s at 92 000
             -- lines and 2.2 million receipt lines).
             SELECT purchase_order_id FROM purchase_order_summary
              WHERE lifecycle IN ('ACTIVE', 'PARTIALLY_RECEIVED')
             UNION ALL
             SELECT o.purchase_order_id FROM purchase_order o
              WHERE NOT EXISTS (SELECT 1 FROM purchase_order_summary s
                                 WHERE s.purchase_order_id = o.purchase_order_id)
         ),
         owed AS MATERIALIZED (
             SELECT o.purchase_order_id, o.po_number, l.po_line_id, l.line_number
               FROM purchase_order_line l
               JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
              WHERE o.purchase_order_id IN (SELECT purchase_order_id FROM unsettled)
                AND o.destination_site_id = $1
                AND o.order_status <> 'CANCELLED'
                AND l.line_status <> 'CANCELLED'
                AND l.closed_short_at IS NULL
                AND l.ordered_quantity > COALESCE(
                        (SELECT sum(g.matched_quantity) FROM goods_receipt_line g
                          WHERE g.po_line_id = l.po_line_id), 0)
         ),
         -- A line is being counted again when its latest count was sent back
         -- by the buyer, or recalled by the bay (0950). An order's reason is
         -- its first such line's, as the order sheet reads it; a recall also
         -- says who took it back, when, and what the recalled counts said.
         latest AS (
             SELECT owed.po_number, owed.line_number, c.status, c.reason,
                    c.recalled_by, c.recalled_at, c.counted_quantity
               FROM owed
               JOIN LATERAL (
                    SELECT x.status, x.recalled_by, x.recalled_at, x.counted_quantity,
                           CASE WHEN x.status = 'RECOUNT_REQUESTED'
                                THEN COALESCE(x.verifier_note, '')
                                ELSE COALESCE(x.recall_reason, '') END AS reason
                      FROM dc_receiving_count x
                     WHERE x.po_line_id = owed.po_line_id
                     ORDER BY x.counted_at DESC LIMIT 1
               ) c ON c.status IN ('RECOUNT_REQUESTED', 'RECALLED')
         ),
         recount AS (
             SELECT po_number,
                    (array_agg(reason ORDER BY line_number))[1] AS reason,
                    (array_agg(recalled_by ORDER BY recalled_at DESC)
                        FILTER (WHERE status = 'RECALLED'))[1] AS recalled_by,
                    max(recalled_at) AS recalled_at,
                    sum(counted_quantity) FILTER (WHERE status = 'RECALLED')::bigint AS was
               FROM latest
              GROUP BY po_number
         )
         SELECT (SELECT count(DISTINCT purchase_order_id) FROM owed) AS orders,
                COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                     'po_number', po_number, 'reason', reason,
                                     'recalled_by', recalled_by, 'recalled_at', recalled_at,
                                     'was', was)
                                   ORDER BY po_number)
                            FROM recount), '[]'::jsonb) AS recounts",
    )
    .bind(&site)
    .fetch_one(&state.db)
    .await?;
    let orders: i64 = row.try_get("orders")?;
    let recounts: Value = row.try_get("recounts")?;
    Ok(Json(json!({ "orders": orders, "recounts": recounts })))
}

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
        "WITH unsettled AS MATERIALIZED (
            -- Only an order that is not yet settled can owe anything (see the
            -- summary above, which must agree with this list).
            SELECT purchase_order_id FROM purchase_order_summary
             WHERE lifecycle IN ('ACTIVE', 'PARTIALLY_RECEIVED')
            UNION ALL
            SELECT o.purchase_order_id FROM purchase_order o
             WHERE NOT EXISTS (SELECT 1 FROM purchase_order_summary s
                                WHERE s.purchase_order_id = o.purchase_order_id)
        ),
        owed AS MATERIALIZED (
            SELECT l.po_line_id, o.po_number, o.supplier_id, o.supplier_name,
                   l.line_number::bigint AS line_number, l.article_code, l.article_name,
                   l.image_url, COALESCE(r.matched, 0)::bigint AS received,
                   COALESCE(o.issued_at, o.created_at) AS activated_at,
                   l.order_unit_code,
                   -- Units depend on the ARTICLE, and only an article that exists has
                   -- any of its own. Every code that is not one (a supplier's item
                   -- before Article Setup) is answered by the global chain alone, so
                   -- they all share one key: NULL.
                   CASE WHEN EXISTS (SELECT 1 FROM article a
                                      WHERE a.article_code = btrim(l.article_code))
                        THEN l.article_code END AS unit_key
              FROM purchase_order_line l
              JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
              LEFT JOIN LATERAL (SELECT sum(g.matched_quantity) AS matched
                                   FROM goods_receipt_line g
                                  WHERE g.po_line_id = l.po_line_id) r ON TRUE
             WHERE o.purchase_order_id IN (SELECT purchase_order_id FROM unsettled)
               AND o.destination_site_id = $1
               AND o.order_status <> 'CANCELLED'
               AND l.line_status <> 'CANCELLED'
               AND l.closed_short_at IS NULL
               AND l.ordered_quantity > COALESCE(r.matched, 0)
        ),
        units AS MATERIALIZED (
            SELECT d.unit_key,
                   COALESCE((
                       SELECT jsonb_agg(jsonb_build_object(
                                  'code', u.code,
                                  'label', u.label,
                                  'factor', trim_scale(u.factor)::text,
                                  'is_stock', u.code = d.stock_unit)
                              ORDER BY u.factor, u.code)
                         FROM (SELECT m.code, m.label,
                                      article_unit_factor(d.unit_key, m.code) AS factor
                                 FROM unit_of_measure m WHERE m.active) u
                        WHERE u.factor IS NOT NULL), '[]'::jsonb) AS count_units
              FROM (SELECT x.unit_key,
                           COALESCE(
                               (SELECT a.stock_unit_code FROM article a
                                 WHERE a.article_code = btrim(x.unit_key)),
                               (SELECT b.code FROM unit_of_measure b WHERE b.is_base)) AS stock_unit
                      FROM (SELECT DISTINCT unit_key FROM owed) x) d
        )
        SELECT owed.po_line_id, owed.po_number, owed.supplier_id, owed.supplier_name,
               owed.line_number, owed.article_code, owed.article_name,
               owed.image_url, owed.received, owed.activated_at, owed.order_unit_code,
               (SELECT CASE WHEN c.status = 'RECOUNT_REQUESTED'
                            THEN COALESCE(c.verifier_note, '') END
                  FROM dc_receiving_count c WHERE c.po_line_id = owed.po_line_id
                 ORDER BY c.counted_at DESC LIMIT 1) AS recount_reason,
               -- The bay took its last count back (0950): what it said, so the
               -- sheet opens with the checker's own numbers.
               (SELECT CASE WHEN c.status = 'RECALLED' THEN jsonb_build_object(
                           'count_id', c.count_id, 'po_line_id', c.po_line_id,
                           'receipt_id', c.receipt_id,
                           'counted_quantity', c.counted_quantity,
                           'wrong_quantity', c.wrong_quantity,
                           'counted_unit_code', c.counted_unit_code,
                           'counted_unit_quantity', c.counted_unit_quantity,
                           'counted_by', c.counted_by, 'counted_at', c.counted_at,
                           'recalled_by', c.recalled_by, 'recalled_at', c.recalled_at,
                           'reason', c.recall_reason,
                           -- And what it said per variant (0963).
                           'variants', COALESCE((
                               SELECT jsonb_agg(jsonb_build_object(
                                          'colour_code', x.colour_code,
                                          'size_code', x.size_code::text,
                                          'counted_quantity', x.counted_quantity))
                                 FROM dc_receiving_count_variant x
                                WHERE x.count_id = c.count_id), '[]'::jsonb)) END
                  FROM dc_receiving_count c WHERE c.po_line_id = owed.po_line_id
                 ORDER BY c.counted_at DESC LIMIT 1) AS recalled,
               -- The colours × sizes the line was ordered in, each counted on
               -- its own (owner, 2026-10-10): what they are and what they look
               -- like, never how many of each — the count is blind.
               COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                    'colour_code', v.colour_code,
                                    'colour_label', col.label,
                                    'size_code', v.size_code::text,
                                    'size_label', sz.label,
                                    'image_urls', to_jsonb(v.image_urls))
                                ORDER BY col.display_order, v.colour_code,
                                         sz.display_order, v.size_code)
                           FROM purchase_order_line_variant v
                           LEFT JOIN colour col ON col.code = v.colour_code
                           LEFT JOIN size_code sz ON sz.code = v.size_code
                          WHERE v.po_line_id = owed.po_line_id), '[]'::jsonb) AS variants,
               units.count_units
          FROM owed
          JOIN units ON units.unit_key IS NOT DISTINCT FROM owed.unit_key
         ORDER BY owed.activated_at DESC, owed.po_number, owed.line_number",
    )
    .bind(&site)
    .fetch_all(&state.db)
    .await?;
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let units: Value = row.try_get("count_units")?;
        let recalled: Option<Value> = row.try_get("recalled")?;
        let variants: Value = row.try_get("variants")?;
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
            recalled: recalled
                .map(serde_json::from_value::<RecalledCount>)
                .transpose()?,
            variants: serde_json::from_value::<Vec<PurchaseWorkVariant>>(variants)?,
        });
    }
    Ok(Json(json!({ "items": items })))
}

/// Deliveries still being worked through on the loading bay.
///
/// One statement: the counted/accepted tallies ride the same read as grouped
/// counts instead of a `receipt_view` per delivery — this endpoint is polled,
/// and an open bay with K deliveries used to answer K+1 queries for it.
async fn goods_receipts(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let site = common::gudang_site(&state.db).await?;
    let rows = sqlx::query(
        "SELECT r.receipt_id, r.receipt_number, r.supplier_id, r.arrived_at, r.status,
                r.opened_by, r.invoice_number, r.invoice_total_minor,
                -- A recalled count was taken back (0950); its recount is the line's.
                count(c.count_id) FILTER (WHERE c.status <> 'RECALLED')::bigint AS counted_lines,
                count(c.count_id) FILTER (WHERE c.status = 'ACCEPTED')::bigint
                    AS accepted_lines
           FROM dc_goods_receipt r
           LEFT JOIN dc_receiving_count c ON c.receipt_id = r.receipt_id
          WHERE r.site_id = $1 AND r.status = 'OPEN'
          GROUP BY r.receipt_id
          ORDER BY r.arrived_at",
    )
    .bind(&site)
    .fetch_all(&state.db)
    .await?;
    let items = rows
        .into_iter()
        .map(|row| {
            Ok(GoodsReceiptView {
                receipt_id: row.try_get("receipt_id")?,
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
        })
        .collect::<Result<Vec<_>, AppError>>()?;
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
    if let Some(answer) = replay(
        &mut tx,
        &request.idempotency_key,
        "DC_GOODS_RECEIPT_OPEN",
        &request,
    )
    .await?
    {
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
    let receipt_id = mint_goods_receipt(
        &mut tx,
        &site,
        &supplier_id,
        arrived_at,
        &request.actor_id,
        now,
    )
    .await?;
    let view = receipt_view(&mut tx, receipt_id).await?;
    remember(
        &mut tx,
        &request.idempotency_key,
        &serde_json::to_value(&view)?,
    )
    .await?;
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
    if let Some(answer) = replay(
        &mut tx,
        &request.idempotency_key,
        "DC_PURCHASE_COUNT",
        &request,
    )
    .await?
    {
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
    remember(
        &mut tx,
        &request.idempotency_key,
        &serde_json::to_value(&response)?,
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(response)))
}

/// A whole count sheet in one command: every counted line of ONE order
/// against one delivery document.
///
/// The sheet the checker submits used to be N per-line requests, each
/// repeating the delivery, the order and every check. One transaction answers
/// them all: the lines, their order, the unit factors and the delivery are
/// read once, the counts are written in one statement, and the auto-receive
/// probe runs once instead of once per line.
async fn count_purchase_batch(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(mut request): Json<PurchaseCountBatchRequest>,
) -> Result<(StatusCode, Json<PurchaseCountBatchResult>), AppError> {
    common::require_hosted()?;
    request.actor_id = principal.username;
    // A sheet is one order's lines. A purchase order carries at most a few
    // hundred lines; anything larger is a caller's bug, not a sheet.
    if request.counts.is_empty() {
        return Err(AppError::Validation(
            "a count sheet carries at least one counted line".into(),
        ));
    }
    if request.counts.len() > 500 {
        return Err(AppError::Validation(
            "a count sheet carries at most 500 lines".into(),
        ));
    }
    for entry in &request.counts {
        // A count of 0 is a statement (owner, 2026-10-05): this line did not
        // come. It puts nothing in the Gudang, and it lets the buyer see the
        // shortage.
        if entry.counted_quantity < 0 {
            return Err(AppError::Validation(
                "a count cannot be less than nothing".into(),
            ));
        }
        if entry.wrong_quantity < 0 || entry.wrong_quantity > entry.counted_quantity {
            return Err(AppError::Validation(format!(
                "{} pieces cannot be not as ordered out of a count of {}",
                entry.wrong_quantity, entry.counted_quantity
            )));
        }
        // A line counted per variant (owner, 2026-10-10): its rows break the
        // line's own pieces down, so they add up to them exactly — the
        // receipt is still the line's, and nothing is counted twice.
        if !entry.variants.is_empty() {
            let mut seen = std::collections::HashSet::with_capacity(entry.variants.len());
            let mut sum: i64 = 0;
            for variant in &entry.variants {
                if variant.counted_quantity < 0 {
                    return Err(AppError::Validation(
                        "a count cannot be less than nothing".into(),
                    ));
                }
                let key = variant_key(variant);
                if key.0.is_none() && key.1.is_none() {
                    return Err(AppError::Validation(
                        "a variant is a colour, a size or both; this one names neither".into(),
                    ));
                }
                if !seen.insert(key) {
                    return Err(AppError::Validation(
                        "a variant is counted once on a sheet; add its pieces into one figure"
                            .into(),
                    ));
                }
                sum = sum.checked_add(variant.counted_quantity).ok_or_else(|| {
                    AppError::Validation("that is more pieces than a count can hold".into())
                })?;
            }
            let right = entry.counted_quantity - entry.wrong_quantity;
            if sum != right {
                return Err(AppError::Validation(format!(
                    "the variants come to {sum} pieces and the line to {right}; a line counted \
                     per variant is the sum of its variants"
                )));
            }
        }
    }
    let mut tx = state.db.begin().await?;
    if let Some(answer) = replay(
        &mut tx,
        &request.idempotency_key,
        "DC_PURCHASE_COUNT_BATCH",
        &request,
    )
    .await?
    {
        tx.commit().await?;
        return Ok((StatusCode::CREATED, Json(serde_json::from_value(answer)?)));
    }
    let site = common::gudang_site_tx(&mut tx).await?;
    // Every line's order, in one read. All of them must be one order: a sheet
    // for a second order would land on that order's own receipt, which is the
    // single-line path's work.
    let line_ids: Vec<Uuid> = request
        .counts
        .iter()
        .map(|entry| entry.po_line_id)
        .collect();
    let rows = sqlx::query(
        "SELECT l.po_line_id, o.purchase_order_id, o.supplier_id, o.order_status,
                o.destination_site_id
           FROM purchase_order_line l
           JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
          WHERE l.po_line_id = ANY($1)",
    )
    .bind(&line_ids)
    .fetch_all(&mut *tx)
    .await?;
    let mut orders: std::collections::HashMap<Uuid, (Uuid, String)> =
        std::collections::HashMap::with_capacity(rows.len());
    for row in rows {
        let po_line_id: Uuid = row.try_get("po_line_id")?;
        let purchase_order_id: Uuid = row.try_get("purchase_order_id")?;
        let supplier_id: String = row.try_get("supplier_id")?;
        let order_status: String = row.try_get("order_status")?;
        let destination: String = row.try_get("destination_site_id")?;
        if destination != site {
            return Err(AppError::NotFound(format!(
                "purchase order line {po_line_id} is delivered to {destination}, not to the \
                 Gudang"
            )));
        }
        // Head office called the order off: nothing is counted against it.
        if order_status == "CANCELLED" {
            return Err(AppError::Conflict(
                "this purchase order was cancelled by head office; refuse the delivery".into(),
            ));
        }
        orders.insert(po_line_id, (purchase_order_id, supplier_id));
    }
    let mut purchase_order_id: Option<Uuid> = None;
    let mut ordered_from: Option<String> = None;
    for entry in &request.counts {
        let Some((order, supplier)) = orders.get(&entry.po_line_id) else {
            return Err(AppError::NotFound(format!(
                "the Gudang holds no purchase order line {}; it cannot count against one it \
                 was never given",
                entry.po_line_id
            )));
        };
        match (&purchase_order_id, &ordered_from) {
            (Some(order_id), Some(supplier_id)) => {
                if order != order_id {
                    return Err(AppError::Validation(
                        "a count sheet carries one order's lines; send each order's sheet as \
                         its own command"
                            .into(),
                    ));
                }
                if supplier.trim() != supplier_id.trim() {
                    return Err(AppError::Conflict(format!(
                        "order {order} names two suppliers: {supplier_id} and {supplier}"
                    )));
                }
            }
            _ => {
                purchase_order_id = Some(*order);
                ordered_from = Some(supplier.clone());
            }
        }
    }
    let purchase_order_id = purchase_order_id.expect("at least one line was checked");
    let ordered_from = ordered_from.expect("at least one line was checked");
    // A variant row is one the line was ordered in. Pieces of any other
    // colour or size are not a variant of this order: they are the
    // delivery's Not as Ordered, as they always were (0963).
    let split_lines: Vec<Uuid> = request
        .counts
        .iter()
        .filter(|entry| !entry.variants.is_empty())
        .map(|entry| entry.po_line_id)
        .collect();
    if !split_lines.is_empty() {
        let mut ordered_variants: std::collections::HashSet<(
            Uuid,
            Option<String>,
            Option<String>,
        )> = std::collections::HashSet::new();
        for row in sqlx::query(
            "SELECT po_line_id, colour_code, size_code::text AS size_code
               FROM purchase_order_line_variant
              WHERE po_line_id = ANY($1)",
        )
        .bind(&split_lines)
        .fetch_all(&mut *tx)
        .await?
        {
            let colour: Option<String> = row.try_get("colour_code")?;
            let size: Option<String> = row.try_get("size_code")?;
            ordered_variants.insert((
                row.try_get("po_line_id")?,
                colour.map(|code| code.trim().to_owned()),
                size.map(|code| code.trim().to_owned()),
            ));
        }
        for entry in request
            .counts
            .iter()
            .filter(|entry| !entry.variants.is_empty())
        {
            for variant in &entry.variants {
                let (colour, size) = variant_key(variant);
                if !ordered_variants.contains(&(entry.po_line_id, colour.clone(), size.clone())) {
                    return Err(AppError::Validation(format!(
                        "{} was not ordered on this line; count those pieces as Not as Ordered",
                        [colour, size]
                            .into_iter()
                            .flatten()
                            .collect::<Vec<_>>()
                            .join(" ")
                    )));
                }
            }
        }
    }
    // A count typed in a unit other than pieces: converted with the line's
    // own factor, exactly, and checked against the pieces sent. One read
    // covers every distinct line-and-unit pair on the sheet.
    let mut wanted_units: std::collections::BTreeSet<(Uuid, String)> =
        std::collections::BTreeSet::new();
    for entry in &request.counts {
        if let Some(code) = entry
            .counted_unit_code
            .as_deref()
            .map(str::trim)
            .filter(|code| !code.is_empty())
        {
            wanted_units.insert((entry.po_line_id, code.to_uppercase()));
        }
    }
    let mut factors: std::collections::HashMap<(Uuid, String), Decimal> =
        std::collections::HashMap::with_capacity(wanted_units.len());
    if !wanted_units.is_empty() {
        let ids: Vec<Uuid> = wanted_units.iter().map(|(line, _)| *line).collect();
        let codes: Vec<String> = wanted_units.iter().map(|(_, code)| code.clone()).collect();
        let rows = sqlx::query(
            "SELECT requested.po_line_id, requested.unit_code,
                    article_unit_factor(l.article_code, requested.unit_code) AS factor
               FROM unnest($1::uuid[], $2::text[]) AS requested(po_line_id, unit_code)
               JOIN purchase_order_line l ON l.po_line_id = requested.po_line_id",
        )
        .bind(&ids)
        .bind(&codes)
        .fetch_all(&mut *tx)
        .await?;
        for row in rows {
            let po_line_id: Uuid = row.try_get("po_line_id")?;
            let code: String = row.try_get("unit_code")?;
            let factor: Option<Decimal> = row.try_get("factor")?;
            let Some(factor) = factor else {
                return Err(AppError::Validation(format!(
                    "this line cannot be counted in {code}; count it in pieces"
                )));
            };
            factors.insert((po_line_id, code), factor);
        }
    }
    let mut counted_units: Vec<Option<(String, String)>> = Vec::with_capacity(request.counts.len());
    for entry in &request.counts {
        let counted_unit = match entry
            .counted_unit_code
            .as_deref()
            .map(str::trim)
            .filter(|code| !code.is_empty())
        {
            None => None,
            Some(code) => {
                let code = code.to_uppercase();
                let factor = factors
                    .get(&(entry.po_line_id, code.clone()))
                    .copied()
                    .ok_or_else(|| {
                        AppError::Validation(format!(
                            "this line cannot be counted in {code}; count it in pieces"
                        ))
                    })?;
                let typed = entry
                    .counted_unit_quantity
                    .as_deref()
                    .unwrap_or_default()
                    .trim()
                    .replace(',', ".");
                let pieces = pieces_of(&typed, factor).ok_or_else(|| {
                    AppError::Validation(format!("{typed} {code} is not a whole number of pieces"))
                })?;
                if pieces != entry.counted_quantity {
                    return Err(AppError::Validation(format!(
                        "{typed} {code} is {pieces} pieces, not the {} sent",
                        entry.counted_quantity
                    )));
                }
                Some((code, typed))
            }
        };
        counted_units.push(counted_unit);
    }
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
    let receipt_id = receipt_for_order(
        &mut tx,
        &site,
        request.receipt_id,
        purchase_order_id,
        delivered_by.trim(),
        &request.actor_id,
        state.clock.now(),
    )
    .await?;
    let now = state.clock.now();
    let count_ids: Vec<Uuid> = request.counts.iter().map(|_| Uuid::new_v4()).collect();
    let counted_quantities: Vec<i64> = request
        .counts
        .iter()
        .map(|entry| entry.counted_quantity)
        .collect();
    let wrong_quantities: Vec<i64> = request
        .counts
        .iter()
        .map(|entry| entry.wrong_quantity)
        .collect();
    let unit_codes: Vec<Option<String>> = counted_units
        .iter()
        .map(|unit| unit.as_ref().map(|(code, _)| code.clone()))
        .collect();
    let unit_quantities: Vec<Option<String>> = counted_units
        .iter()
        .map(|unit| unit.as_ref().map(|(_, quantity)| quantity.clone()))
        .collect();
    sqlx::query(
        "INSERT INTO dc_receiving_count
             (count_id, receipt_id, po_line_id, counted_quantity, wrong_quantity,
              counted_unit_code, counted_unit_quantity, counted_by, counted_at, status)
         SELECT line.count_id, $2, line.po_line_id, line.counted, line.wrong,
                line.unit_code, line.unit_quantity, $3, $4, 'AWAITING_VERIFICATION'
           FROM unnest($1::uuid[], $5::uuid[], $6::bigint[], $7::bigint[], $8::text[], $9::text[])
                AS line(count_id, po_line_id, counted, wrong, unit_code, unit_quantity)",
    )
    .bind(&count_ids)
    .bind(receipt_id)
    .bind(&request.actor_id)
    .bind(now)
    .bind(&line_ids)
    .bind(&counted_quantities)
    .bind(&wrong_quantities)
    .bind(&unit_codes)
    .bind(&unit_quantities)
    .execute(&mut *tx)
    .await?;
    // Each line's breakdown, beside its count, in the same transaction: a
    // sheet is accepted whole or not at all (0963).
    let mut variant_count_ids: Vec<Uuid> = Vec::new();
    let mut variant_colours: Vec<Option<String>> = Vec::new();
    let mut variant_sizes: Vec<Option<String>> = Vec::new();
    let mut variant_quantities: Vec<i64> = Vec::new();
    for (count_id, entry) in count_ids.iter().zip(&request.counts) {
        for variant in &entry.variants {
            let (colour, size) = variant_key(variant);
            variant_count_ids.push(*count_id);
            variant_colours.push(colour);
            variant_sizes.push(size);
            variant_quantities.push(variant.counted_quantity);
        }
    }
    if !variant_count_ids.is_empty() {
        sqlx::query(
            "INSERT INTO dc_receiving_count_variant
                 (count_id, colour_code, size_code, counted_quantity)
             SELECT v.count_id, v.colour_code, v.size_code, v.counted
               FROM unnest($1::uuid[], $2::text[], $3::text[], $4::bigint[])
                    AS v(count_id, colour_code, size_code, counted)",
        )
        .bind(&variant_count_ids)
        .bind(&variant_colours)
        .bind(&variant_sizes)
        .bind(&variant_quantities)
        .execute(&mut *tx)
        .await?;
    }
    let items = count_ids
        .iter()
        .zip(&request.counts)
        .map(|(count_id, entry)| PurchaseCountResult {
            count_id: *count_id,
            po_line_id: entry.po_line_id,
            counted_quantity: entry.counted_quantity,
            wrong_quantity: entry.wrong_quantity,
            counted_by: request.actor_id.clone(),
            counted_at: now,
        })
        .collect();
    let response = PurchaseCountBatchResult { receipt_id, items };
    remember(
        &mut tx,
        &request.idempotency_key,
        &serde_json::to_value(&response)?,
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(response)))
}

/// The bay takes its own count back, before anybody decided on it (0950).
///
/// A count sheet is one order's lines, so the counts named must all be of one
/// order, and every one of them still waiting for review: the sheet is
/// recalled whole or not at all. Nothing is deleted — each count stays as
/// RECALLED in the order's history, and its line is owed a count again, into
/// the same delivery document (the arrival did not change). Stock is not
/// touched: a count waiting for review never put anything in the Gudang.
///
/// Refused once the buyer has decided. An accepted count is goods that exist;
/// a count sent back is already the bay's to count again. The row lock is the
/// one [`verify`] takes, so a recall and an acceptance of the same count can
/// not both win: whichever commits second finds the status changed.
async fn recall_counts(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(mut request): Json<PurchaseCountRecallRequest>,
) -> Result<(StatusCode, Json<PurchaseCountRecallResult>), AppError> {
    common::require_hosted()?;
    request.actor_id = principal.username;
    request.reason = request
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|reason| !reason.is_empty())
        .map(str::to_owned);
    if request.count_ids.is_empty() {
        return Err(AppError::Validation(
            "name the counts to recall: a recall takes back at least one".into(),
        ));
    }
    // A sheet carries at most a few hundred lines (see the batch count).
    if request.count_ids.len() > 1000 {
        return Err(AppError::Validation(
            "a recall takes back one order's count sheet, not more".into(),
        ));
    }
    let mut ids = request.count_ids.clone();
    ids.sort();
    ids.dedup();
    let mut tx = state.db.begin().await?;
    if let Some(answer) = replay(
        &mut tx,
        &request.idempotency_key,
        "DC_PURCHASE_RECALL",
        &request,
    )
    .await?
    {
        tx.commit().await?;
        return Ok((StatusCode::CREATED, Json(serde_json::from_value(answer)?)));
    }
    let site = common::gudang_site_tx(&mut tx).await?;
    let rows = sqlx::query(
        "SELECT c.count_id, c.po_line_id, c.receipt_id, c.counted_quantity, c.wrong_quantity,
                c.counted_unit_code, c.counted_unit_quantity, c.counted_by, c.counted_at,
                c.status, c.verified_by, o.po_number, o.order_status, r.site_id
           FROM dc_receiving_count c
           JOIN dc_goods_receipt r ON r.receipt_id = c.receipt_id
           JOIN purchase_order_line l ON l.po_line_id = c.po_line_id
           JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
          WHERE c.count_id = ANY($1)
          ORDER BY l.line_number
          FOR UPDATE OF c",
    )
    .bind(&ids)
    .fetch_all(&mut *tx)
    .await?;
    if rows.len() != ids.len() {
        return Err(AppError::NotFound(format!(
            "{} of the {} counts named are not counts at this Gudang",
            ids.len() - rows.len(),
            ids.len()
        )));
    }
    let mut po_number: Option<String> = None;
    for row in &rows {
        let order: String = row.try_get("po_number")?;
        let at: String = row.try_get("site_id")?;
        if at != site {
            return Err(AppError::NotFound(format!(
                "a count on {order} was taken at {at}, not at the Gudang"
            )));
        }
        match &po_number {
            None => po_number = Some(order.clone()),
            Some(first) if *first != order => {
                return Err(AppError::Validation(format!(
                    "a recall takes back one order's count; these are counts of {first} and \
                     {order}"
                )))
            }
            Some(_) => {}
        }
        let order_status: String = row.try_get("order_status")?;
        if order_status == "CANCELLED" {
            return Err(AppError::Conflict(format!(
                "{order} was cancelled by head office; its count is void and is not recalled"
            )));
        }
        let status: String = row.try_get("status")?;
        match status.as_str() {
            "AWAITING_VERIFICATION" => {}
            "ACCEPTED" => {
                let by: Option<String> = row.try_get("verified_by")?;
                return Err(AppError::Conflict(format!(
                    "{} already accepted this count of {order}; the goods are received and \
                     the count can no longer be recalled",
                    by.as_deref().unwrap_or("the buyer")
                )));
            }
            "RECOUNT_REQUESTED" => {
                let by: Option<String> = row.try_get("verified_by")?;
                return Err(AppError::Conflict(format!(
                    "{} already sent this count of {order} back to be counted again; count it \
                     again",
                    by.as_deref().unwrap_or("the buyer")
                )));
            }
            "RECALLED" => {
                return Err(AppError::Conflict(format!(
                    "this count of {order} was already recalled; count it again"
                )));
            }
            other => {
                return Err(AppError::Conflict(format!(
                    "this count of {order} is {}",
                    other.to_lowercase().replace('_', " ")
                )));
            }
        }
    }
    let now = state.clock.now();
    sqlx::query(
        "UPDATE dc_receiving_count
            SET status = 'RECALLED', recalled_by = $2, recalled_at = $3, recall_reason = $4
          WHERE count_id = ANY($1)",
    )
    .bind(&ids)
    .bind(&request.actor_id)
    .bind(now)
    .bind(&request.reason)
    .execute(&mut *tx)
    .await?;
    // What each count said per variant (0963): the sheet opens with them.
    let mut recalled_variants: std::collections::HashMap<Uuid, Vec<PurchaseCountVariant>> =
        std::collections::HashMap::new();
    for row in sqlx::query(
        "SELECT count_id, colour_code, size_code::text AS size_code, counted_quantity
           FROM dc_receiving_count_variant
          WHERE count_id = ANY($1)",
    )
    .bind(&ids)
    .fetch_all(&mut *tx)
    .await?
    {
        let count_id: Uuid = row.try_get("count_id")?;
        recalled_variants
            .entry(count_id)
            .or_default()
            .push(PurchaseCountVariant {
                colour_code: row.try_get("colour_code")?,
                size_code: row.try_get("size_code")?,
                counted_quantity: row.try_get("counted_quantity")?,
            });
    }
    let items = rows
        .iter()
        .map(|row| {
            let count_id: Uuid = row.try_get("count_id")?;
            Ok(RecalledCount {
                count_id,
                po_line_id: row.try_get("po_line_id")?,
                receipt_id: row.try_get("receipt_id")?,
                counted_quantity: row.try_get("counted_quantity")?,
                wrong_quantity: row.try_get("wrong_quantity")?,
                counted_unit_code: row.try_get("counted_unit_code")?,
                counted_unit_quantity: row.try_get("counted_unit_quantity")?,
                counted_by: row.try_get("counted_by")?,
                counted_at: row.try_get("counted_at")?,
                recalled_by: request.actor_id.clone(),
                recalled_at: now,
                reason: request.reason.clone(),
                variants: recalled_variants.remove(&count_id).unwrap_or_default(),
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let response = PurchaseCountRecallResult {
        po_number: po_number.unwrap_or_default(),
        items,
    };
    remember(
        &mut tx,
        &request.idempotency_key,
        &serde_json::to_value(&response)?,
    )
    .await?;
    tx.commit().await?;
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
                         (SELECT b.code FROM unit_of_measure b WHERE b.is_base)) AS stock_unit_code,
                -- The count variant by variant beside what was ordered of each
                -- (owner, 2026-10-10); none for a count taken as a whole.
                COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                     'colour_code', v.colour_code,
                                     'colour_label', col.label,
                                     'size_code', v.size_code,
                                     'size_label', sz.label,
                                     'image_urls', to_jsonb(v.image_urls),
                                     'ordered_quantity', v.ordered_quantity,
                                     'outstanding_quantity', v.outstanding_quantity,
                                     'counted_quantity', v.counted_quantity)
                                 ORDER BY col.display_order, v.colour_code,
                                          sz.display_order, v.size_code)
                            FROM dc_receiving_count_breakdown(c.count_id) v
                            LEFT JOIN colour col ON col.code = v.colour_code
                            LEFT JOIN size_code sz ON sz.code::text = v.size_code),
                         '[]'::jsonb) AS variants,
                -- After a recount: the count it replaced (its matching pieces),
                -- why it was sent back, and when the first count was taken.
                (SELECT (p.counted_quantity - p.wrong_quantity)::bigint
                   FROM dc_receiving_count p
                  WHERE p.po_line_id = c.po_line_id AND p.status = 'RECOUNT_REQUESTED'
                    AND p.counted_at < c.counted_at
                  ORDER BY p.counted_at DESC LIMIT 1) AS previous_counted_quantity,
                (SELECT NULLIF(btrim(p.verifier_note), '')
                   FROM dc_receiving_count p
                  WHERE p.po_line_id = c.po_line_id AND p.status = 'RECOUNT_REQUESTED'
                    AND p.counted_at < c.counted_at
                  ORDER BY p.counted_at DESC LIMIT 1) AS recount_reason,
                (SELECT min(p.counted_at)
                   FROM dc_receiving_count p
                  WHERE p.po_line_id = c.po_line_id AND p.status = 'RECOUNT_REQUESTED'
                    AND p.counted_at < c.counted_at) AS first_counted_at
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
        let variants: Value = row.try_get("variants")?;
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
            variants: serde_json::from_value::<Vec<PurchaseReviewVariant>>(variants)?,
            previous_counted_quantity: row.try_get("previous_counted_quantity")?,
            recount_reason: row.try_get("recount_reason")?,
            first_counted_at: row.try_get("first_counted_at")?,
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
    if let Some(answer) = replay(
        &mut tx,
        &request.idempotency_key,
        "DC_GOODS_RECEIPT_REJECT",
        &request,
    )
    .await?
    {
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
    remember(
        &mut tx,
        &request.idempotency_key,
        &serde_json::to_value(&view)?,
    )
    .await?;
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
    if let Some(answer) = replay(
        &mut tx,
        &request.idempotency_key,
        "DC_GOODS_RECEIPT_INVOICE",
        &request,
    )
    .await?
    {
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
    remember(
        &mut tx,
        &request.idempotency_key,
        &serde_json::to_value(&view)?,
    )
    .await?;
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
        return Err(AppError::Validation(
            "an empty file is not an invoice".into(),
        ));
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
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("inline"),
    );
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
    if let Some(answer) = replay(
        &mut tx,
        &request.idempotency_key,
        "DC_PURCHASE_VERIFY",
        &request,
    )
    .await?
    {
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
        remember(
            &mut tx,
            &request.idempotency_key,
            &serde_json::to_value(&response)?,
        )
        .await?;
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
        remember(
            &mut tx,
            &request.idempotency_key,
            &serde_json::to_value(&response)?,
        )
        .await?;
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
    remember(
        &mut tx,
        &request.idempotency_key,
        &serde_json::to_value(&response)?,
    )
    .await?;
    tx.commit().await?;
    Ok(response)
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
                  WHERE c.receipt_id = r.receipt_id
                    AND c.status <> 'RECALLED')::bigint AS counted_lines,
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

/// A counted variant's colour and size as the order line's variant spells
/// them: trimmed, and an empty one is no colour (or no size) at all.
fn variant_key(variant: &PurchaseCountVariant) -> (Option<String>, Option<String>) {
    let clean = |code: &Option<String>| {
        code.as_deref()
            .map(str::trim)
            .filter(|code| !code.is_empty())
            .map(str::to_owned)
    };
    (clean(&variant.colour_code), clean(&variant.size_code))
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
