//! Owners and investors: who they are, and what they have moved.

use super::auth::Principal as Caller;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{role_allows, Role},
    postgres::{
        self as infrastructure, CreatePrincipalRequest, Principal, PrincipalDocument,
        PrincipalMovementRequest,
    },
};
use axum::{
    extract::{Path, State},
    routing::{get, post},
    Extension, Json, Router,
};
use uuid::Uuid;

fn allowed(caller: &Caller, needed: Role, act: &str) -> Result<(), AppError> {
    if role_allows(needed, caller.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {act}",
        caller.username
    )))
}

pub async fn list(
    State(state): State<AppState>,
    Extension(caller): Extension<Caller>,
) -> Result<Json<Vec<Principal>>, AppError> {
    allowed(&caller, Role::Supervisor, "read the owners")?;
    Ok(Json(infrastructure::principals(&state.db).await?))
}

pub async fn detail(
    State(state): State<AppState>,
    Extension(caller): Extension<Caller>,
    Path(principal_id): Path<Uuid>,
) -> Result<Json<PrincipalDocument>, AppError> {
    allowed(&caller, Role::Supervisor, "read an owner")?;
    Ok(Json(
        infrastructure::principal_detail(&state.db, principal_id).await?,
    ))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(caller): Extension<Caller>,
    Json(request): Json<CreatePrincipalRequest>,
) -> Result<Json<PrincipalDocument>, AppError> {
    allowed(&caller, Role::Admin, "add an owner")?;
    Ok(Json(
        infrastructure::principal_create(&state.db, &request, &caller.username).await?,
    ))
}

/// Capital in, drawings out, a loan from an owner, or its repayment.
pub async fn movement(
    State(state): State<AppState>,
    Extension(caller): Extension<Caller>,
    Json(request): Json<PrincipalMovementRequest>,
) -> Result<Json<PrincipalDocument>, AppError> {
    allowed(&caller, Role::Admin, "record an owner's movement")?;
    Ok(Json(
        infrastructure::principal_movement(&state.db, &request, &caller.username).await?,
    ))
}

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/finance/principals", get(list).post(create))
        .route("/api/v1/finance/principals/{id}", get(detail))
        .route("/api/v1/finance/principal-movements", post(movement))
}
