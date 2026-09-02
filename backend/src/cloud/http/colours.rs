//! The colour master's handlers.
//!
//! The list is readable by anyone signed in — a picker cannot draw itself
//! without it. The writes fall through `required_role` to Supervisor, the same
//! rung every other vocabulary edit sits on.

use super::articles::{expected_version, idempotency_key, request_digest, versioned_response};
use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{self as infrastructure, CreateColourRequest, UpdateColourRequest},
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    Extension, Json,
};
use serde_json::json;

/// Every colour the company has, and how many articles wear each.
///
/// Retired ones included, which is the difference between this and
/// `catalogue_vocabulary` next door: a picker hides them, but the screen that
/// retired one has to be able to find it again.
pub async fn list_colours(
    State(state): State<AppState>,
) -> Result<Json<infrastructure::ColourVocabulary>, AppError> {
    Ok(Json(infrastructure::colour_vocabulary(&state.db).await?))
}

pub async fn create_colour(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    headers: HeaderMap,
    Json(request): Json<CreateColourRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "request": &request,
    }))?;
    let colour = infrastructure::create_colour(&state.db, request, &key, &digest).await?;
    let version = colour.version;
    versioned_response(StatusCode::CREATED, colour, version)
}

/// Rename, recolour, reorder or retire one colour.
///
/// There is no delete, and that is the point of the module: a colour with
/// articles behind it cannot be removed without leaving goods filed under
/// nothing, so retiring is the operation that means what people reach for
/// delete to do.
pub async fn update_colour(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
    headers: HeaderMap,
    Json(request): Json<UpdateColourRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let version = expected_version(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "code": &code,
        "expected_version": version,
        "request": &request,
    }))?;
    let colour =
        infrastructure::update_colour(&state.db, &code, version, request, &key, &digest).await?;
    let version = colour.version;
    versioned_response(StatusCode::OK, colour, version)
}
