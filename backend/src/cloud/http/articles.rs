//! The Articles module's handlers.
//!
//! Reads are open to anyone signed in, like every other GET here. The PATCH
//! falls through `required_role` to Supervisor, which is where every other
//! non-sales mutation lands — editing what a garment is called is catalogue
//! work, not administration.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{self as infrastructure, UpdateArticleRequest},
};
use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::Serialize;
use serde_json::json;

/// The write guards, in one place for this module and `colours`.
///
/// Deliberately the same rules as the supplier catalogue's — the same header
/// names, the same messages, the same strong-ETag shape — because a browser
/// helper (`guarded()` in the hub) sends all of them the same way, and a
/// second dialect of If-Match would be a difference nothing announces until a
/// save silently stops being guarded. They are re-declared rather than reused
/// only because `http::suppliers` keeps its copies private to itself; the
/// three of them belong in one shared place, which is a tidy-up in a file this
/// change does not own.
pub(super) fn idempotency_key(headers: &HeaderMap) -> Result<String, AppError> {
    let value = headers
        .get("idempotency-key")
        .ok_or_else(|| AppError::Validation("Idempotency-Key header is required".into()))?
        .to_str()
        .map_err(|_| AppError::Validation("Idempotency-Key header is not valid text".into()))?
        .trim();
    if value.is_empty() {
        return Err(AppError::Validation(
            "Idempotency-Key header cannot be blank".into(),
        ));
    }
    Ok(value.to_owned())
}

pub(super) fn expected_version(headers: &HeaderMap) -> Result<i32, AppError> {
    let raw = headers
        .get(header::IF_MATCH)
        .ok_or_else(|| AppError::Validation("If-Match header is required".into()))?
        .to_str()
        .map_err(|_| AppError::Validation("If-Match header is not valid text".into()))?
        .trim();
    let version_text = raw
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        .ok_or_else(|| {
            AppError::Validation(
                "If-Match must be one strong quoted numeric ETag, for example \"3\"".into(),
            )
        })?;
    let version = version_text.parse::<i32>().map_err(|_| {
        AppError::Validation("If-Match version is outside the supported range".into())
    })?;
    if version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    Ok(version)
}

pub(super) fn request_digest<T: Serialize>(value: &T) -> Result<String, AppError> {
    infrastructure::payload_digest(value)
}

pub(super) fn versioned_response<T: Serialize>(
    status: StatusCode,
    value: T,
    version: i32,
) -> Result<Response, AppError> {
    let mut response = (status, Json(value)).into_response();
    let etag = HeaderValue::from_str(&format!("\"{version}\""))
        .map_err(|_| AppError::Configuration("cannot encode Article ETag".into()))?;
    response.headers_mut().insert(header::ETAG, etag);
    Ok(response)
}

/// Every value given for one query key.
///
/// Repeated keys AND comma-separated values, both, because the two halves of
/// this repository already disagree: `supplier-items` reads
/// `division=KIDS,DIVIDED` while the shared spec for this module says to
/// repeat the key. Accepting one and rejecting the other would work perfectly
/// in a browser and fail for whoever wrote the other form by hand, with an
/// empty list rather than an error — a filter that silently matches everything
/// is worse than one that refuses.
fn facet_values(params: &[(String, String)], key: &str) -> Vec<String> {
    params
        .iter()
        .filter(|(name, _)| name == key)
        .flat_map(|(_, value)| value.split(','))
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_owned)
        .collect()
}

fn single_value(params: &[(String, String)], key: &str) -> Option<String> {
    params
        .iter()
        .rev()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

const DEFAULT_ARTICLE_LIMIT: i64 = 60;

/// One page of the master, with what the rest of it contains.
pub async fn search_articles(
    State(state): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<infrastructure::ArticlePage>, AppError> {
    let active = match single_value(&params, "active").as_deref() {
        None => None,
        Some("true") => Some(true),
        Some("false") => Some(false),
        Some(other) => {
            return Err(AppError::Validation(format!(
                "active must be true or false, not {other:?}"
            )));
        }
    };
    let limit = match single_value(&params, "limit") {
        Some(raw) => raw
            .parse::<i64>()
            .map_err(|_| AppError::Validation(format!("limit {raw:?} is not a number")))?,
        None => DEFAULT_ARTICLE_LIMIT,
    };
    Ok(Json(
        infrastructure::search_articles(
            &state.db,
            infrastructure::ArticleScope {
                needle: single_value(&params, "q"),
                division_codes: facet_values(&params, "division_code"),
                tag_codes: facet_values(&params, "tag_code"),
                size_codes: facet_values(&params, "size_code"),
                colour_codes: facet_values(&params, "colour_code"),
                active,
                cursor: single_value(&params, "cursor"),
                limit,
            },
        )
        .await?,
    ))
}

/// One article, whole: its SKUs, its colourways and who sells it to us.
///
/// Addressed by `article_code` rather than by the row's uuid, because the code
/// is what everything outside this database — a spreadsheet, a picking list, a
/// person on the phone — actually has.
pub async fn article_detail(
    State(state): State<AppState>,
    Path(article_code): Path<String>,
) -> Result<Response, AppError> {
    let detail = infrastructure::article_detail(&state.db, &article_code).await?;
    let version = detail.article.version;
    versioned_response(StatusCode::OK, detail, version)
}

/// Edit an article's attributes. Never its identity.
pub async fn update_article(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(article_code): Path<String>,
    headers: HeaderMap,
    Json(request): Json<UpdateArticleRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let version = expected_version(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "article_code": &article_code,
        "expected_version": version,
        "request": &request,
    }))?;
    let detail = infrastructure::update_article(
        &state.db,
        &article_code,
        version,
        request,
        &principal.username,
        &key,
        &digest,
    )
    .await?;
    let version = detail.article.version;
    versioned_response(StatusCode::OK, detail, version)
}
