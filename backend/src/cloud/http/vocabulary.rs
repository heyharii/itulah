//! The division, size and tag masters' handlers.
//!
//! One set of three handlers for all three lists, with the list named by a path
//! segment. The alternative is nine handlers that differ in one word, and the
//! ninth is where the auth check gets forgotten.
//!
//! Reads are open to anyone signed in — a picker cannot draw itself without the
//! list. The writes fall through `required_role` to Supervisor, the same rung
//! the colour master sits on.

use super::articles::{expected_version, idempotency_key, request_digest, versioned_response};
use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{self as infrastructure, CreateTermRequest, UpdateTermRequest, Vocabulary},
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    Extension, Json,
};
use serde_json::json;

/// Which list this request is against.
///
/// A 404 and not a 400: `/api/v1/colours` is a real route and `/api/v1/colors`
/// is not, and the thing a caller has got wrong is the address rather than the
/// body.
fn vocabulary(segment: &str) -> Result<Vocabulary, AppError> {
    Vocabulary::parse(segment).ok_or_else(|| {
        AppError::NotFound(format!(
            "Vocabulary {segment:?} — divisions, sizes and tags are the three"
        ))
    })
}

/// Every term in one list, and how many articles are filed under each.
///
/// Retired ones included, which is the difference between this and
/// `catalogue_vocabulary`: a picker hides them, but the screen that retired one
/// has to be able to find it again.
pub async fn list_terms(
    State(state): State<AppState>,
    Path(kind): Path<String>,
) -> Result<Json<infrastructure::MasterVocabulary>, AppError> {
    Ok(Json(
        infrastructure::vocabulary_terms(&state.db, vocabulary(&kind)?).await?,
    ))
}

pub async fn create_term(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(kind): Path<String>,
    headers: HeaderMap,
    Json(request): Json<CreateTermRequest>,
) -> Result<Response, AppError> {
    let kind = vocabulary(&kind)?;
    let key = idempotency_key(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "vocabulary": kind.table_name(),
        "request": &request,
    }))?;
    let term = infrastructure::create_term(&state.db, kind, request, &key, &digest).await?;
    let version = term.version;
    versioned_response(StatusCode::CREATED, term, version)
}

/// Rename, reorder or retire one term.
///
/// There is no delete, and that is the point of the module: a term with
/// articles behind it cannot be removed without leaving goods filed under
/// nothing, so retiring is the operation that means what people reach for
/// delete to do.
pub async fn update_term(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((kind, code)): Path<(String, String)>,
    headers: HeaderMap,
    Json(request): Json<UpdateTermRequest>,
) -> Result<Response, AppError> {
    let kind = vocabulary(&kind)?;
    let key = idempotency_key(&headers)?;
    let version = expected_version(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "vocabulary": kind.table_name(),
        "code": &code,
        "expected_version": version,
        "request": &request,
    }))?;
    let term = infrastructure::update_term(&state.db, kind, &code, version, request, &key, &digest)
        .await?;
    let version = term.version;
    versioned_response(StatusCode::OK, term, version)
}
