//! The recurring-bill surface: the promises, and the drafts they raised.
//!
//! Under `/api/v1/finance`, so reading is SUPERVISOR and writing is ADMIN by
//! the finance arm of `required_role` — no second rule here, for the reason
//! `http/party.rs` gives: a second RBAC rule beside the central one is two
//! policies that agree until somebody edits one. Writing a template is not
//! posting a bill — the drafts the sweep raises are DRAFTs, and posting
//! stays a person's act — but a promise about spending is not a shop-floor
//! act either.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{self as infrastructure},
};
use axum::{
    extract::{Path, State},
    routing::{get, post},
    Extension, Json, Router,
};
use uuid::Uuid;

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/finance/bill-templates", get(list).post(record))
        .route("/api/v1/finance/bill-templates/{id}/retire", post(retire))
}

async fn list(
    State(state): State<AppState>,
    Extension(_principal): Extension<Principal>,
) -> Result<Json<Vec<infrastructure::BillTemplate>>, AppError> {
    Ok(Json(infrastructure::bill_templates(&state.db).await?))
}

async fn record(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<infrastructure::RecordBillTemplateRequest>,
) -> Result<Json<infrastructure::BillTemplate>, AppError> {
    Ok(Json(
        infrastructure::record_bill_template(&state.db, &request, &principal.username).await?,
    ))
}

async fn retire(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    infrastructure::retire_bill_template(&state.db, id, &principal.username).await?;
    Ok(Json(serde_json::json!({ "retired": id })))
}
