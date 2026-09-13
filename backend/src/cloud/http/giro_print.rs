//! Giro print templates: the handlers.
//!
//! Under `/api/v1/finance`, so reading one is SUPERVISOR and writing one is
//! ADMIN by the finance arm of `required_role`. ADMIN for a set of coordinates
//! looks heavy until you say what a wrong one does: a giro whose amount lands
//! across a pre-printed rule is refused at the counter, and the supplier is
//! still owed.

use super::articles::{expected_version, idempotency_key, request_digest, versioned_response};
use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, CreateGiroPrintTemplateRequest, UpdateGiroPrintTemplateRequest,
    },
};
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    Extension, Json,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

#[derive(Clone, Debug, Default, Deserialize)]
pub struct TemplateScope {
    #[serde(default)]
    pub include_retired: Option<bool>,
}

pub async fn list_giro_print_templates(
    State(state): State<AppState>,
    Query(scope): Query<TemplateScope>,
) -> Result<Json<Vec<infrastructure::GiroPrintTemplate>>, AppError> {
    Ok(Json(
        infrastructure::giro_print_templates(&state.db, scope.include_retired.unwrap_or(false))
            .await?,
    ))
}

pub async fn giro_print_template(
    State(state): State<AppState>,
    Path(template_id): Path<Uuid>,
) -> Result<Json<infrastructure::GiroPrintTemplate>, AppError> {
    Ok(Json(
        infrastructure::giro_print_template(&state.db, template_id).await?,
    ))
}

pub async fn create_giro_print_template(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    headers: HeaderMap,
    Json(request): Json<CreateGiroPrintTemplateRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "request": &request,
    }))?;
    let template = infrastructure::create_giro_print_template(
        &state.db,
        request,
        &principal.username,
        &key,
        &digest,
    )
    .await?;
    let version = template.version;
    versioned_response(StatusCode::CREATED, template, version)
}

/// Save a calibration.
///
/// The whole layout arrives at once — see `UpdateGiroPrintTemplateRequest`. A
/// half-saved layout is one that prints.
pub async fn update_giro_print_template(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(template_id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<UpdateGiroPrintTemplateRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let version = expected_version(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "template_id": template_id,
        "expected_version": version,
        "request": &request,
    }))?;
    let template = infrastructure::update_giro_print_template(
        &state.db,
        template_id,
        version,
        request,
        &principal.username,
        &key,
        &digest,
    )
    .await?;
    let version = template.version;
    versioned_response(StatusCode::OK, template, version)
}
