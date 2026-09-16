//! The tax surface: types, periods, what was recorded, what was settled.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{role_allows, Role},
    postgres::{
        self as infrastructure, FileTaxPeriodRequest, RecordTaxItemRequest, SettleTaxRequest,
        TaxPeriod, TaxPeriodDocument, TaxReconciliationRow, TaxType,
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

pub async fn types(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<TaxType>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the tax types")?;
    Ok(Json(infrastructure::tax_types(&state.db).await?))
}

#[derive(Debug, Deserialize)]
pub struct PeriodQuery {
    pub tax_type: Option<String>,
    pub year: Option<i32>,
    pub limit: Option<i64>,
}

pub async fn periods(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<PeriodQuery>,
) -> Result<Json<Vec<TaxPeriod>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the tax periods")?;
    Ok(Json(
        infrastructure::tax_periods(
            &state.db,
            query.tax_type.as_deref(),
            query.year,
            query.limit.unwrap_or(120),
        )
        .await?,
    ))
}

pub async fn period(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(period_id): Path<Uuid>,
) -> Result<Json<TaxPeriodDocument>, AppError> {
    allowed(&principal, Role::Supervisor, "read a tax period")?;
    Ok(Json(
        infrastructure::tax_period_detail(&state.db, period_id).await?,
    ))
}

/// Record what a document already posted against the period it belongs to.
pub async fn record_item(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordTaxItemRequest>,
) -> Result<Json<TaxPeriodDocument>, AppError> {
    allowed(&principal, Role::Admin, "record a tax item")?;
    Ok(Json(
        infrastructure::tax_item_record(&state.db, &request, &principal.username).await?,
    ))
}

/// Pay a tax, or buy a credit.
pub async fn settle(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<SettleTaxRequest>,
) -> Result<Json<TaxPeriodDocument>, AppError> {
    allowed(&principal, Role::Admin, "settle a tax period")?;
    Ok(Json(
        infrastructure::tax_settle(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn file_period(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<FileTaxPeriodRequest>,
) -> Result<Json<TaxPeriodDocument>, AppError> {
    allowed(&principal, Role::Admin, "file a tax return")?;
    Ok(Json(
        infrastructure::tax_period_file(&state.db, &request, &principal.username).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct ReconciliationQuery {
    pub year: Option<i32>,
}

pub async fn reconciliation(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ReconciliationQuery>,
) -> Result<Json<Vec<TaxReconciliationRow>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the tax control")?;
    Ok(Json(
        infrastructure::tax_reconciliation(&state.db, query.year).await?,
    ))
}

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/finance/tax/types", get(types))
        .route("/api/v1/finance/tax/periods", get(periods))
        .route("/api/v1/finance/tax/periods/{id}", get(period))
        .route("/api/v1/finance/tax/items", post(record_item))
        .route("/api/v1/finance/tax/settlements", post(settle))
        .route("/api/v1/finance/tax/filings", post(file_period))
        .route("/api/v1/finance/tax/reconciliation", get(reconciliation))
}
