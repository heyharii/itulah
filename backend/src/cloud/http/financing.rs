//! Facilities and their instalments.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{role_allows, Role},
    postgres::{
        self as infrastructure, CreateFacilityRequest, FinancingFacility,
        FinancingFacilityDocument, PayInstallmentRequest,
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
pub struct FacilityQuery {
    pub status: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<FacilityQuery>,
) -> Result<Json<Vec<FinancingFacility>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the facilities")?;
    Ok(Json(
        infrastructure::financing_facilities(&state.db, query.status.as_deref()).await?,
    ))
}

pub async fn detail(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(facility_id): Path<Uuid>,
) -> Result<Json<FinancingFacilityDocument>, AppError> {
    allowed(&principal, Role::Supervisor, "read a facility")?;
    Ok(Json(
        infrastructure::financing_facility_detail(&state.db, facility_id).await?,
    ))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<CreateFacilityRequest>,
) -> Result<Json<FinancingFacilityDocument>, AppError> {
    allowed(&principal, Role::Admin, "record a facility")?;
    Ok(Json(
        infrastructure::financing_facility_create(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn pay(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(installment_id): Path<Uuid>,
    Json(request): Json<PayInstallmentRequest>,
) -> Result<Json<FinancingFacilityDocument>, AppError> {
    allowed(&principal, Role::Admin, "pay an instalment")?;
    Ok(Json(
        infrastructure::financing_installment_pay(
            &state.db,
            installment_id,
            &request,
            &principal.username,
        )
        .await?,
    ))
}

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/finance/facilities", get(list).post(create))
        .route("/api/v1/finance/facilities/{id}", get(detail))
        .route(
            "/api/v1/finance/facilities/installments/{id}/pay",
            post(pay),
        )
}
