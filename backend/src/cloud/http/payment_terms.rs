//! The payment terms master's handlers.
//!
//! The book itself is read at `GET /api/v1/payment-terms` (`suppliers.rs`),
//! by anyone signed in. The writes here fall through `required_role` to
//! Supervisor, the rung every other master edit — colours, vocabulary — sits
//! on. There is no delete: a term or a template is retired, never removed —
//! see `postgres::payment_terms`.

use super::articles::{expected_version, idempotency_key, request_digest, versioned_response};
use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, CreatePaymentTermRequest, CreatePaymentTermsTemplateRequest,
        UpdatePaymentTermRequest, UpdatePaymentTermsTemplateRequest,
    },
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    Extension, Json,
};
use serde_json::json;

pub async fn create_payment_term(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    headers: HeaderMap,
    Json(request): Json<CreatePaymentTermRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "request": &request,
    }))?;
    let term = infrastructure::create_payment_term(&state.db, request, &key, &digest).await?;
    let version = term.version;
    versioned_response(StatusCode::CREATED, term, version)
}

/// Rename, re-time, reorder, retire or reactivate one term.
pub async fn update_payment_term(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
    headers: HeaderMap,
    Json(request): Json<UpdatePaymentTermRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let version = expected_version(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "code": &code,
        "expected_version": version,
        "request": &request,
    }))?;
    let term =
        infrastructure::update_payment_term(&state.db, &code, version, request, &key, &digest)
            .await?;
    let version = term.version;
    versioned_response(StatusCode::OK, term, version)
}

/// A new template with its instalments, in one transaction.
pub async fn create_payment_terms_template(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    headers: HeaderMap,
    Json(request): Json<CreatePaymentTermsTemplateRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "request": &request,
    }))?;
    let template =
        infrastructure::create_payment_terms_template(&state.db, request, &key, &digest).await?;
    let version = template.version;
    versioned_response(StatusCode::CREATED, template, version)
}

/// Rename, reorder, retire or reactivate a template, and optionally replace
/// its instalments whole.
pub async fn update_payment_terms_template(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
    headers: HeaderMap,
    Json(request): Json<UpdatePaymentTermsTemplateRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let version = expected_version(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "code": &code,
        "expected_version": version,
        "request": &request,
    }))?;
    let template = infrastructure::update_payment_terms_template(
        &state.db, &code, version, request, &key, &digest,
    )
    .await?;
    let version = template.version;
    versioned_response(StatusCode::OK, template, version)
}
