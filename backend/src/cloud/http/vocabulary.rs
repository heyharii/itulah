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
    domain::RecordKind,
    http::audit::DeclaredSubject,
    postgres::{self as infrastructure, CreateTermRequest, UpdateTermRequest, Vocabulary},
};
use axum::{
    extract::{Path, Query, State},
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

/// Which record a term of this list is.
///
/// Three lists, three kinds. The route cannot say it — `/vocabulary/{kind}` is
/// one path serving three masters — so the handler does. The old derivation
/// got this right by luck: it singularised the path segment, and `divisions`
/// happens to singularise to the word the hub already passes.
const fn record_kind(kind: Vocabulary) -> RecordKind {
    match kind {
        Vocabulary::Divisions => RecordKind::Division,
        Vocabulary::Sizes => RecordKind::Size,
        Vocabulary::Tags => RecordKind::Tag,
    }
}

/// Every term in one list, and how many articles are filed under each.
///
/// Retired ones included, which is the difference between this and
/// `catalogue_vocabulary`: a picker hides them, but the screen that retired one
/// has to be able to find it again.
pub async fn list_terms(
    State(state): State<AppState>,
    Path(kind): Path<String>,
    Query(scope): Query<infrastructure::MasterScope>,
) -> Result<Json<infrastructure::MasterVocabulary>, AppError> {
    Ok(Json(
        infrastructure::vocabulary_terms(&state.db, vocabulary(&kind)?, scope).await?,
    ))
}

pub async fn create_term(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
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
    acted_on.set(record_kind(kind), term.code.clone());
    let version = term.version;
    versioned_response(StatusCode::CREATED, term, version)
}

/// Rename, reorder or retire one term.
///
/// The code is never among the fields: it is what `article.division_code`,
/// `sku.size_code` and `article_tag.tag_code` hold, so a code that moved would
/// be a rename that lost the goods. A term whose code is wrong and which has
/// never been used can be deleted and written again — see `delete_term`.
pub async fn update_term(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
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
    acted_on.set(record_kind(kind), term.code.clone());
    let version = term.version;
    versioned_response(StatusCode::OK, term, version)
}

/// What speaks for one term, and whether it may be deleted.
///
/// Every place at once, including the ones that count zero: "Articles 0" is
/// the number somebody reaches for delete on, and the four lines under it are
/// why they may not.
pub async fn term_usage(
    State(state): State<AppState>,
    Path((kind, code)): Path<(String, String)>,
) -> Result<Json<infrastructure::MasterUsage>, AppError> {
    Ok(Json(
        infrastructure::term_usage(&state.db, vocabulary(&kind)?, &code).await?,
    ))
}

/// Remove a term that has never meant anything.
///
/// `If-Match` is required for the same reason a rename needs it: the version
/// the caller saw is the version being deleted, and a term that was used
/// between the screen drawing its button and the click arriving must not
/// vanish underneath the article that just took it.
///
/// The rule is enforced in `postgres::delete_term`, not here, so that the
/// screen and the server cannot disagree about what "never used" means.
pub async fn delete_term(
    State(state): State<AppState>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Path((kind, code)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let version = expected_version(&headers)?;
    let kind = vocabulary(&kind)?;
    infrastructure::delete_term(&state.db, kind, &code, version).await?;
    // Recorded against the term that is now gone. A deletion is the one act
    // whose subject cannot be read back from the database afterwards, so if
    // the log does not name it here nothing ever will.
    acted_on.set(record_kind(kind), code);
    Ok(StatusCode::NO_CONTENT)
}
