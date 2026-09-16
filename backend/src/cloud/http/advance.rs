//! Advances: asked for, approved, paid, settled.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{role_allows, Role},
    postgres::{
        self as infrastructure, Advance, AdvanceDocument, AdvanceReconciliationRow,
        CreateAdvanceRequest, PayAdvanceRequest, SettleAdvanceRequest,
    },
};
use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

fn allowed(principal: &Principal, needed: Role, act: &str) -> Result<(), AppError> {
    if role_allows(needed, principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {act}",
        principal.username
    )))
}

#[derive(Debug, Deserialize)]
pub struct AdvanceQuery {
    pub site: Option<String>,
    pub status: Option<String>,
    pub limit: Option<i64>,
}

pub async fn list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<AdvanceQuery>,
) -> Result<Json<Vec<Advance>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the advances")?;
    Ok(Json(
        infrastructure::advances(
            &state.db,
            query.site.as_deref(),
            query.status.as_deref(),
            query.limit.unwrap_or(100),
        )
        .await?,
    ))
}

pub async fn detail(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(advance_id): Path<Uuid>,
) -> Result<Json<AdvanceDocument>, AppError> {
    allowed(&principal, Role::Supervisor, "read an advance")?;
    Ok(Json(
        infrastructure::advance_detail(&state.db, advance_id).await?,
    ))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<CreateAdvanceRequest>,
) -> Result<Json<AdvanceDocument>, AppError> {
    allowed(&principal, Role::Supervisor, "ask for an advance")?;
    Ok(Json(
        infrastructure::advance_create(&state.db, &request, &principal.username).await?,
    ))
}

/// Approving is a separate act from asking, and from paying.
pub async fn approve(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(advance_id): Path<Uuid>,
) -> Result<Json<AdvanceDocument>, AppError> {
    allowed(&principal, Role::Admin, "approve an advance")?;
    Ok(Json(
        infrastructure::advance_approve(&state.db, advance_id, &principal.username).await?,
    ))
}

pub async fn pay(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(advance_id): Path<Uuid>,
    Json(request): Json<PayAdvanceRequest>,
) -> Result<Json<AdvanceDocument>, AppError> {
    allowed(&principal, Role::Admin, "pay an advance")?;
    Ok(Json(
        infrastructure::advance_pay(&state.db, advance_id, &request, &principal.username).await?,
    ))
}

pub async fn settle(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(advance_id): Path<Uuid>,
    Json(request): Json<SettleAdvanceRequest>,
) -> Result<Json<AdvanceDocument>, AppError> {
    allowed(&principal, Role::Admin, "settle an advance")?;
    Ok(Json(
        infrastructure::advance_settle(&state.db, advance_id, &request, &principal.username)
            .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct CancelRequest {
    pub reason: String,
}

pub async fn cancel(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(advance_id): Path<Uuid>,
    Json(request): Json<CancelRequest>,
) -> Result<Json<AdvanceDocument>, AppError> {
    allowed(&principal, Role::Admin, "cancel an advance")?;
    Ok(Json(
        infrastructure::advance_cancel(
            &state.db,
            advance_id,
            &request.reason,
            &principal.username,
        )
        .await?,
    ))
}

pub async fn reconciliation(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<AdvanceReconciliationRow>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the advance control")?;
    Ok(Json(infrastructure::advance_reconciliation(&state.db).await?))
}

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/finance/advances", get(list).post(create))
        .route("/api/v1/finance/advances/{id}", get(detail))
        .route("/api/v1/finance/advances/{id}/approve", post(approve))
        .route("/api/v1/finance/advances/{id}/pay", post(pay))
        .route("/api/v1/finance/advances/{id}/settle", post(settle))
        .route("/api/v1/finance/advances/{id}/cancel", post(cancel))
        .route(
            "/api/v1/finance/advances/reconciliation",
            get(reconciliation),
        )
}
