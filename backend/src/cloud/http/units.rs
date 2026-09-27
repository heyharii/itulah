//! Units of measure and their conversions: the handlers.
//!
//! The read is open to anyone signed in — a purchase order composer cannot
//! offer LUSIN without knowing it is twelve. The writes fall through
//! `required_role` to Supervisor, the rung the colour and vocabulary masters
//! sit on.

use super::articles::{expected_version, idempotency_key, request_digest, versioned_response};
use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, CreateUnitConversionRequest, CreateUnitRequest,
        UpdateUnitConversionRequest, UpdateUnitRequest,
    },
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    Extension, Json,
};
use serde_json::json;
use uuid::Uuid;

/// Every unit and every conversion, retired ones included.
pub async fn list_units(
    State(state): State<AppState>,
) -> Result<Json<infrastructure::UnitsBook>, AppError> {
    Ok(Json(infrastructure::units_book(&state.db).await?))
}

pub async fn create_unit(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    headers: HeaderMap,
    Json(request): Json<CreateUnitRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "request": &request,
    }))?;
    let unit =
        infrastructure::create_unit(&state.db, request, &principal.username, &key, &digest).await?;
    let version = unit.version;
    versioned_response(StatusCode::CREATED, unit, version)
}

/// Relabel a unit, make it the base, retire it or bring it back.
pub async fn update_unit(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
    headers: HeaderMap,
    Json(request): Json<UpdateUnitRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let version = expected_version(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "code": &code,
        "expected_version": version,
        "request": &request,
    }))?;
    let unit = infrastructure::update_unit(
        &state.db,
        &code,
        version,
        request,
        &principal.username,
        &key,
        &digest,
    )
    .await?;
    let version = unit.version;
    versioned_response(StatusCode::OK, unit, version)
}

pub async fn create_unit_conversion(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    headers: HeaderMap,
    Json(request): Json<CreateUnitConversionRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "request": &request,
    }))?;
    let conversion = infrastructure::create_unit_conversion(
        &state.db,
        request,
        &principal.username,
        &key,
        &digest,
    )
    .await?;
    let version = conversion.version;
    versioned_response(StatusCode::CREATED, conversion, version)
}

/// Correct a conversion's factor or note, retire it or bring it back.
pub async fn update_unit_conversion(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(conversion_id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<UpdateUnitConversionRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let version = expected_version(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "conversion_id": conversion_id,
        "expected_version": version,
        "request": &request,
    }))?;
    let conversion = infrastructure::update_unit_conversion(
        &state.db,
        conversion_id,
        version,
        request,
        &principal.username,
        &key,
        &digest,
    )
    .await?;
    let version = conversion.version;
    versioned_response(StatusCode::OK, conversion, version)
}
