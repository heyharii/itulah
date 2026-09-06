//! The payment surface: destinations, batches, the context and the allocation.
//!
//! # One function adds all of it to the router
//!
//! [`lane_m_routes`] is called once from `router()`. Adding twenty `.route(…)`
//! lines to a function that is already a thousand of them is how that function
//! became a thousand lines, and it is how two sessions working the same
//! repository at the same time collide on one hunk.
//!
//! # RBAC comes from the path and is checked before any of this runs
//!
//! Everything here is under `/api/v1/finance`, and `domain::auth::required_role`
//! already answers SUPERVISOR for a GET there and ADMIN for anything else. A
//! till operator has no business reading who the company pays; moving money is
//! an ADMIN act. Nothing in this module re-implements that ladder, because a
//! second copy of an authorisation rule is a second answer to it.
//!
//! What this module does add is the one rule the path cannot express: Finance
//! reads an employee's bank account and never writes it. That is about which
//! row is being touched rather than which URL, so it lives in the repository
//! where the row is, and reaches the browser as a 403 with a sentence.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, CreatePaymentBatchRequest, CreatePaymentDestinationRequest,
        ExecutePaymentBatchItemRequest, PaymentAllocationRequest, PaymentAllocationSurface,
        PaymentBatchDetail, PaymentBatchRow, PaymentBatchRunOutcome, PaymentContext,
        PaymentDestinationRow, VerifyPaymentDestinationRequest,
    },
};
use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct DestinationQuery {
    /// `SUPPLIER`, `EMPLOYEE` or `OTHER`.
    pub party_type: Option<String>,
    pub party_id: Option<String>,
    /// Deactivated accounts are history and are hidden unless asked for.
    #[serde(default)]
    pub inactive: bool,
    pub limit: Option<i64>,
}

pub async fn destinations(
    State(state): State<AppState>,
    Query(query): Query<DestinationQuery>,
) -> Result<Json<Vec<PaymentDestinationRow>>, AppError> {
    Ok(Json(
        infrastructure::payment_destination_list(
            &state.db,
            query.party_type.as_deref(),
            query.party_id.as_deref(),
            query.inactive,
            query.limit.unwrap_or(100),
        )
        .await?,
    ))
}

pub async fn create_destination(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<CreatePaymentDestinationRequest>,
) -> Result<Json<PaymentDestinationRow>, AppError> {
    Ok(Json(
        infrastructure::payment_destination_create(&state.db, &request, &principal.username)
            .await?,
    ))
}

pub async fn verify_destination(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<VerifyPaymentDestinationRequest>,
) -> Result<Json<PaymentDestinationRow>, AppError> {
    Ok(Json(
        infrastructure::payment_destination_verify(&state.db, id, &request, &principal.username)
            .await?,
    ))
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DeactivateDestinationRequest {
    pub reason: String,
}

pub async fn deactivate_destination(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<DeactivateDestinationRequest>,
) -> Result<Json<PaymentDestinationRow>, AppError> {
    Ok(Json(
        infrastructure::payment_destination_deactivate(
            &state.db,
            id,
            &request.reason,
            &principal.username,
        )
        .await?,
    ))
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct BatchQuery {
    pub status: Option<String>,
    pub source_kind: Option<String>,
    pub limit: Option<i64>,
}

pub async fn batches(
    State(state): State<AppState>,
    Query(query): Query<BatchQuery>,
) -> Result<Json<Vec<PaymentBatchRow>>, AppError> {
    Ok(Json(
        infrastructure::payment_batch_list(
            &state.db,
            query.status.as_deref(),
            query.source_kind.as_deref(),
            query.limit.unwrap_or(100),
        )
        .await?,
    ))
}

pub async fn create_batch(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<CreatePaymentBatchRequest>,
) -> Result<Json<PaymentBatchDetail>, AppError> {
    Ok(Json(
        infrastructure::payment_batch_create(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn batch(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<PaymentBatchDetail>, AppError> {
    Ok(Json(
        infrastructure::payment_batch_read(&state.db, id).await?,
    ))
}

pub async fn execute_batch_item(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((batch_id, item_id)): Path<(Uuid, Uuid)>,
    Json(request): Json<ExecutePaymentBatchItemRequest>,
) -> Result<Json<PaymentBatchDetail>, AppError> {
    Ok(Json(
        infrastructure::payment_batch_execute_item(
            &state.db,
            batch_id,
            item_id,
            &request,
            &principal.username,
        )
        .await?,
    ))
}

pub async fn execute_batch_remaining(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
) -> Result<Json<PaymentBatchRunOutcome>, AppError> {
    Ok(Json(
        infrastructure::payment_batch_execute_remaining(&state.db, id, &principal.username).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CancelBatchRequest {
    pub reason: String,
}

pub async fn cancel_batch(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<CancelBatchRequest>,
) -> Result<Json<PaymentBatchDetail>, AppError> {
    Ok(Json(
        infrastructure::payment_batch_cancel(&state.db, id, &request.reason, &principal.username)
            .await?,
    ))
}

// ---------------------------------------------------------------------------
// The context, and the allocation
// ---------------------------------------------------------------------------

/// The one endpoint the frontend calls to find out what to render.
pub async fn payment_context(
    State(state): State<AppState>,
    Path((source_kind, source_id)): Path<(String, String)>,
) -> Result<Json<PaymentContext>, AppError> {
    Ok(Json(
        infrastructure::payment_context_resolve(&state.db, &source_kind, &source_id).await?,
    ))
}

pub async fn allocation(
    State(state): State<AppState>,
    Path((payment_kind, payment_id)): Path<(String, String)>,
) -> Result<Json<PaymentAllocationSurface>, AppError> {
    Ok(Json(
        infrastructure::payment_allocation_surface(&state.db, &payment_kind, &payment_id).await?,
    ))
}

pub async fn allocate(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((payment_kind, payment_id)): Path<(String, String)>,
    Json(request): Json<PaymentAllocationRequest>,
) -> Result<Json<PaymentAllocationSurface>, AppError> {
    Ok(Json(
        infrastructure::payment_allocation_apply(
            &state.db,
            &payment_kind,
            &payment_id,
            &request,
            &principal.username,
        )
        .await?,
    ))
}

/// Everything this lane serves, in one call from `router()`.
pub fn lane_m_routes(r: Router<AppState>) -> Router<AppState> {
    r.route(
        "/api/v1/finance/payment-destinations",
        get(destinations).post(create_destination),
    )
    .route(
        "/api/v1/finance/payment-destinations/{id}/verify",
        post(verify_destination),
    )
    .route(
        "/api/v1/finance/payment-destinations/{id}/deactivate",
        post(deactivate_destination),
    )
    .route(
        "/api/v1/finance/payment-batches",
        get(batches).post(create_batch),
    )
    .route("/api/v1/finance/payment-batches/{id}", get(batch))
    .route(
        "/api/v1/finance/payment-batches/{id}/items/{item_id}/execute",
        post(execute_batch_item),
    )
    .route(
        "/api/v1/finance/payment-batches/{id}/execute-remaining",
        post(execute_batch_remaining),
    )
    .route(
        "/api/v1/finance/payment-batches/{id}/cancel",
        post(cancel_batch),
    )
    .route(
        "/api/v1/finance/payment-context/{source_kind}/{source_id}",
        get(payment_context),
    )
    .route(
        "/api/v1/finance/payments/{payment_kind}/{payment_id}/allocation",
        get(allocation).post(allocate),
    )
}
