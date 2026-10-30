//! The rest of the payables loop, over HTTP.
//!
//! Its own file rather than more of `finance.rs`, and the routes are added by
//! one call in `router()` rather than by twenty lines inside it. Several
//! sessions are editing both of those files this week, and a single call line
//! is the smallest hunk that can conflict.
//!
//! Every handler is the same shape as the ones in `finance.rs`: the actor comes
//! from the `Principal` the router-wide `require_auth` resolved, never from the
//! request body, so an audit row records what somebody did rather than what
//! they claimed. Refusals come from the database and from `payables_flow` as
//! sentences, and `AppError` already turns SQLSTATE P0001 into a 409 carrying
//! the trigger's own message — so "delivery GR-0007 accepted 120 of this line"
//! reaches the browser as written.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, BillMatch, BillMatchRequest, CreditNote, CreditNoteRefundRequest,
        CreditNoteRequest, PaymentDeductions, PaymentWithholdRequest, ReceiptAwaitingPosting,
        ReceiptPosting, SupplierAdvance, SupplierAdvanceApplyRequest, SupplierAdvanceRequest,
        ThreeWayReport,
    },
};
use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::NaiveDate;
use serde::Deserialize;
use uuid::Uuid;

/// Every route this lane adds, in one call.
pub fn lane_g_routes(router: Router<AppState>) -> Router<AppState> {
    router
        // Deliveries finance has not valued yet, and valuing one.
        //
        // A queue and not an automatic step. Receipts arrive from the DC
        // through sync, inside the batch transaction that ingests every other
        // fact, and posting there would put the accounting calendar in that
        // path: a delivery keyed on the 1st of a month whose predecessor is
        // closed would fail the whole sync batch and stop every other fact
        // behind it. A warehouse cannot be blocked by a period close.
        .route(
            "/api/v1/finance/receipts/awaiting-posting",
            get(receipts_awaiting_posting),
        )
        .route("/api/v1/finance/receipts/{id}/post", post(receipt_post))
        // Not a DELETE. Undoing a valuation writes a mirror entry and keeps
        // both facts — the delivery was valued and then un-valued, and a row
        // that vanished would leave a pair of journal entries nobody could tie
        // to a document.
        .route(
            "/api/v1/finance/receipts/{id}/reverse",
            post(receipt_reverse),
        )
        // Tying a bill to the deliveries it answers. DRAFT -> MATCHED, which
        // is a decision with an actor: a price outside tolerance may be
        // accepted here, and a quantity above what was accepted may not.
        .route("/api/v1/finance/bills/{id}/match", post(bill_match))
        // What the bill is made of, line by line. The screen 7Soft calls
        // Faktur Pembelian prints quantity × price for each delivery line;
        // the rows have been written since 0052 but never read back, so the
        // only way to see them was the database.
        .route("/api/v1/finance/bills/{id}/lines", get(bill_item_lines))
        // Order, delivery, bill — the three-way exception report. Deliveries
        // nobody has billed, with ageing, beside bills nobody has matched, and
        // the figure `2012001002` should be carrying.
        .route("/api/v1/finance/three-way", get(three_way_report))
        // Goods that went back, or a price corrected after the bill was
        // agreed. Recorded, posted, and — when the supplier sends the money
        // rather than letting the next bill absorb it — refunded, which is a
        // second act with its own date and its own bank line.
        .route(
            "/api/v1/finance/credit-notes",
            get(credit_notes).post(credit_note_create),
        )
        .route("/api/v1/finance/credit-notes/{id}", get(credit_note))
        .route(
            "/api/v1/finance/credit-notes/{id}/post",
            post(credit_note_post),
        )
        .route(
            "/api/v1/finance/credit-notes/{id}/refund",
            post(credit_note_refund),
        )
        // Money paid to a supplier before there is a bill to owe them for.
        // An asset while it is outstanding, and set against bills as they
        // arrive — its own act on its own date, because an advance that could
        // only be consumed as a bill posted could not be split across the two
        // bills a large order arrives on.
        .route(
            "/api/v1/finance/supplier-advances",
            get(supplier_advances_outstanding).post(supplier_advance_issue),
        )
        .route(
            "/api/v1/finance/supplier-advances/{id}",
            get(supplier_advance),
        )
        .route(
            "/api/v1/finance/supplier-advances/{id}/post",
            post(supplier_advance_post),
        )
        .route(
            "/api/v1/finance/supplier-advances/{id}/apply",
            post(supplier_advance_apply),
        )
        // What a payment will actually move: the debt it settles, the tax kept
        // back from the supplier, the bank's charge, and what reaches the
        // supplier's account. Decided before the payment posts, in the same
        // way allocations are.
        .route(
            "/api/v1/finance/payments/{id}/withholding",
            get(payment_deductions).post(payment_withhold),
        )
}

// ---------------------------------------------------------------------------
// Valuing a delivery
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct LimitQuery {
    pub limit: Option<i64>,
}

pub async fn receipts_awaiting_posting(
    State(state): State<AppState>,
    Query(query): Query<LimitQuery>,
) -> Result<Json<Vec<ReceiptAwaitingPosting>>, AppError> {
    Ok(Json(
        infrastructure::receipts_awaiting_posting(&state.db, query.limit.unwrap_or(200)).await?,
    ))
}

/// A posting date the caller may override, used by four handlers here.
///
/// Absent means the document's own date — a delivery posts on the day it
/// arrived, a bill on its invoice date. Present is for the ordinary case of a
/// period having closed since, where finance decides which open period carries
/// it and says so deliberately.
#[derive(Debug, Deserialize)]
pub struct PostingDateRequest {
    #[serde(default)]
    pub posting_date: Option<NaiveDate>,
}

pub async fn receipt_post(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(receipt_id): Path<Uuid>,
    Json(request): Json<PostingDateRequest>,
) -> Result<Json<ReceiptPosting>, AppError> {
    Ok(Json(
        infrastructure::receipt_post(
            &state.db,
            receipt_id,
            request.posting_date,
            &principal.username,
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct ReverseRequest {
    /// Why. Required, and stored: a reversal with no reason is a pair of
    /// entries nobody can explain a year later.
    pub reason: String,
    #[serde(default)]
    pub posting_date: Option<NaiveDate>,
}

pub async fn receipt_reverse(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(receipt_id): Path<Uuid>,
    Json(request): Json<ReverseRequest>,
) -> Result<Json<ReceiptPosting>, AppError> {
    Ok(Json(
        infrastructure::receipt_reverse(
            &state.db,
            receipt_id,
            request.posting_date,
            &request.reason,
            &principal.username,
        )
        .await?,
    ))
}

// ---------------------------------------------------------------------------
// Matching, and the report that shows what has not been matched
// ---------------------------------------------------------------------------

pub async fn bill_match(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(invoice_id): Path<Uuid>,
    Json(request): Json<BillMatchRequest>,
) -> Result<Json<BillMatch>, AppError> {
    Ok(Json(
        infrastructure::bill_match(&state.db, invoice_id, &request, &principal.username).await?,
    ))
}

/// One item line of a supplier invoice, as the paper states it.
#[derive(serde::Serialize, sqlx::FromRow)]
pub struct BillItemLine {
    pub line_number: i32,
    pub article_code: Option<String>,
    pub description: String,
    pub quantity: i64,
    pub unit_price_minor: i64,
    pub line_amount_minor: i64,
    pub tax_minor: i64,
    pub po_number: Option<String>,
    pub receipt_number: Option<String>,
}

pub async fn bill_item_lines(
    State(state): State<AppState>,
    Path(invoice_id): Path<Uuid>,
) -> Result<Json<Vec<BillItemLine>>, AppError> {
    let rows = sqlx::query_as::<_, BillItemLine>(
        "SELECT l.line_number,
                pol.article_code,
                l.description,
                l.quantity,
                l.unit_price_minor,
                l.line_amount_minor,
                l.tax_minor,
                po.po_number,
                gr.receipt_number
           FROM supplier_invoice_line l
           LEFT JOIN purchase_order_line pol ON pol.po_line_id = l.po_line_id
           LEFT JOIN purchase_order po ON po.purchase_order_id = pol.purchase_order_id
           LEFT JOIN goods_receipt_line grl ON grl.receipt_line_id = l.receipt_line_id
           LEFT JOIN goods_receipt gr ON gr.receipt_id = grl.receipt_id
          WHERE l.invoice_id = $1
          ORDER BY l.line_number",
    )
    .bind(invoice_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

pub async fn three_way_report(
    State(state): State<AppState>,
    Query(query): Query<LimitQuery>,
) -> Result<Json<ThreeWayReport>, AppError> {
    Ok(Json(
        infrastructure::three_way_report(&state.db, query.limit.unwrap_or(200)).await?,
    ))
}

// ---------------------------------------------------------------------------
// Credit notes
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreditNoteQuery {
    pub invoice: Option<Uuid>,
    pub supplier: Option<String>,
    pub status: Option<String>,
    pub limit: Option<i64>,
}

pub async fn credit_notes(
    State(state): State<AppState>,
    Query(query): Query<CreditNoteQuery>,
) -> Result<Json<Vec<CreditNote>>, AppError> {
    Ok(Json(
        infrastructure::credit_notes(
            &state.db,
            query.invoice,
            query.supplier.as_deref(),
            query.status.as_deref(),
            query.limit.unwrap_or(200),
        )
        .await?,
    ))
}

pub async fn credit_note(
    State(state): State<AppState>,
    Path(credit_note_id): Path<Uuid>,
) -> Result<Json<CreditNote>, AppError> {
    Ok(Json(
        infrastructure::credit_note(&state.db, credit_note_id).await?,
    ))
}

pub async fn credit_note_create(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<CreditNoteRequest>,
) -> Result<Json<CreditNote>, AppError> {
    Ok(Json(
        infrastructure::credit_note_create(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn credit_note_post(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(credit_note_id): Path<Uuid>,
    Json(request): Json<PostingDateRequest>,
) -> Result<Json<CreditNote>, AppError> {
    Ok(Json(
        infrastructure::credit_note_post(
            &state.db,
            credit_note_id,
            request.posting_date,
            &principal.username,
        )
        .await?,
    ))
}

pub async fn credit_note_refund(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(credit_note_id): Path<Uuid>,
    Json(request): Json<CreditNoteRefundRequest>,
) -> Result<Json<CreditNote>, AppError> {
    Ok(Json(
        infrastructure::credit_note_refund(
            &state.db,
            credit_note_id,
            &request,
            &principal.username,
        )
        .await?,
    ))
}

// ---------------------------------------------------------------------------
// Supplier advances
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct AdvanceQuery {
    pub supplier: Option<String>,
    pub limit: Option<i64>,
}

/// Advances with money still sitting in them.
///
/// Outstanding rather than all of them, because that is the question somebody
/// opens the list to ask: what has this company paid for and not received a
/// bill against. A fully applied advance is history, and history is the
/// document's own page.
pub async fn supplier_advances_outstanding(
    State(state): State<AppState>,
    Query(query): Query<AdvanceQuery>,
) -> Result<Json<Vec<SupplierAdvance>>, AppError> {
    Ok(Json(
        infrastructure::supplier_advances_outstanding(
            &state.db,
            query.supplier.as_deref(),
            query.limit.unwrap_or(200),
        )
        .await?,
    ))
}

pub async fn supplier_advance(
    State(state): State<AppState>,
    Path(advance_id): Path<Uuid>,
) -> Result<Json<SupplierAdvance>, AppError> {
    Ok(Json(
        infrastructure::supplier_advance(&state.db, advance_id).await?,
    ))
}

pub async fn supplier_advance_issue(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<SupplierAdvanceRequest>,
) -> Result<Json<SupplierAdvance>, AppError> {
    Ok(Json(
        infrastructure::supplier_advance_issue(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn supplier_advance_post(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(advance_id): Path<Uuid>,
    Json(request): Json<PostingDateRequest>,
) -> Result<Json<SupplierAdvance>, AppError> {
    Ok(Json(
        infrastructure::supplier_advance_post(
            &state.db,
            advance_id,
            request.posting_date,
            &principal.username,
        )
        .await?,
    ))
}

pub async fn supplier_advance_apply(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(advance_id): Path<Uuid>,
    Json(request): Json<SupplierAdvanceApplyRequest>,
) -> Result<Json<SupplierAdvance>, AppError> {
    Ok(Json(
        infrastructure::supplier_advance_apply(
            &state.db,
            advance_id,
            &request,
            &principal.username,
        )
        .await?,
    ))
}

// ---------------------------------------------------------------------------
// What a payment keeps back
// ---------------------------------------------------------------------------

pub async fn payment_deductions(
    State(state): State<AppState>,
    Path(payment_id): Path<Uuid>,
) -> Result<Json<PaymentDeductions>, AppError> {
    Ok(Json(
        infrastructure::payment_deductions(&state.db, payment_id).await?,
    ))
}

/// Work out the tax to keep back from this payment, and record it.
///
/// A POST and not a GET because it writes: the figure it computes is stored on
/// the payment, and the payment's journal entry then quotes what was stored
/// rather than recomputing it. A withholding that was recalculated at posting
/// time could disagree with the certificate the supplier has already been
/// given, and the certificate is the document that reaches a tax return.
///
/// The rate is not a parameter. It follows from the category on each bill this
/// payment settles, which follows from what was bought — `domain::withholding`
/// holds both, and this endpoint decides nothing except when to ask.
pub async fn payment_withhold(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(payment_id): Path<Uuid>,
    Json(request): Json<PaymentWithholdRequest>,
) -> Result<Json<PaymentDeductions>, AppError> {
    Ok(Json(
        infrastructure::payment_withhold(&state.db, payment_id, &request, &principal.username)
            .await?,
    ))
}
