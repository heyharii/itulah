//! The colour master's handlers.
//!
//! The list is readable by anyone signed in — a picker cannot draw itself
//! without it. The writes fall through `required_role` to Supervisor, the same
//! rung every other vocabulary edit sits on.

use super::articles::{expected_version, idempotency_key, request_digest, versioned_response};
use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::RecordKind,
    http::audit::DeclaredSubject,
    postgres::{self as infrastructure, CreateColourRequest, UpdateColourRequest},
};
use axum::{
    extract::{Path, Query, State},
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
    Query(scope): Query<infrastructure::ColourScope>,
) -> Result<Json<infrastructure::ColourVocabulary>, AppError> {
    Ok(Json(
        infrastructure::colour_vocabulary(&state.db, scope).await?,
    ))
}

pub async fn create_colour(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    headers: HeaderMap,
    Json(request): Json<CreateColourRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "request": &request,
    }))?;
    let colour = infrastructure::create_colour(&state.db, request, &key, &digest).await?;
    acted_on.set(RecordKind::Colour, colour.code.clone());
    let version = colour.version;
    versioned_response(StatusCode::CREATED, colour, version)
}

/// Rename, recolour, reorder or retire one colour.
///
/// The code is never among the fields: it is what `article_colour` rows hold,
/// so a code that moved would be a rename that lost the goods. A colour whose
/// code is wrong and which has never been worn can be deleted and written
/// again — see `delete_colour`.
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

/// What speaks for one colour, and whether it may be deleted.
///
/// Read by the sheet before it decides which buttons to draw. A read of its
/// own rather than fields on the list row, because the answer costs three
/// counting queries and the list is forty rows nobody is asking this of.
pub async fn colour_usage(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<infrastructure::MasterUsage>, AppError> {
    Ok(Json(infrastructure::colour_usage(&state.db, &code).await?))
}

/// Remove a colour that has never been worn.
///
/// `If-Match` is required, exactly as it is for a rename: the version the
/// caller saw is the version being deleted, and a colour that was used between
/// the screen drawing its button and the click arriving must not vanish.
///
/// The rule this enforces is in `postgres::delete_colour`, and it is enforced
/// there rather than here so that the screen and the server cannot disagree
/// about what "never used" means.
pub async fn delete_colour(
    State(state): State<AppState>,
    Path(code): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let version = expected_version(&headers)?;
    infrastructure::delete_colour(&state.db, &code, version).await?;
    Ok(StatusCode::NO_CONTENT)
}
