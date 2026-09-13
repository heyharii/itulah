//! The document drawer, over HTTP.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::RecordKind,
    http::audit::DeclaredSubject,
    postgres::{self as infrastructure, DocumentUploadRequest, FileDocumentRequest},
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

/// Somewhere to put the bytes. No row is written until the upload finishes and
/// [`file`] confirms the object is really in the bucket.
pub async fn upload_url(
    State(state): State<AppState>,
    Json(request): Json<DocumentUploadRequest>,
) -> Result<Json<infrastructure::DocumentUpload>, AppError> {
    Ok(Json(infrastructure::reserve_upload(&state, &request)?))
}

/// File an uploaded object as a document.
pub async fn file(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<FileDocumentRequest>,
) -> Result<Json<infrastructure::Document>, AppError> {
    let document = infrastructure::file_document(&state, request, &principal.username).await?;
    acted_on.set(RecordKind::Document, document.document_id.to_string());
    Ok(Json(document))
}

/// What a drawer screen asks for. Comma-separated for the same reason the
/// sourcing facets are: it is what the browser's own filter state already
/// serialises to, and a second encoding for one idea is a second thing to get
/// wrong.
#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    #[serde(default)]
    q: Option<String>,
    #[serde(default)]
    tags: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    subject_kind: Option<String>,
    #[serde(default)]
    subject_id: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
}

const fn default_limit() -> i64 {
    60
}

fn parts(raw: Option<&str>) -> Vec<String> {
    raw.map(|value| {
        value
            .split(',')
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .map(str::to_string)
            .collect()
    })
    .unwrap_or_default()
}

pub async fn search(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<infrastructure::Document>>, AppError> {
    Ok(Json(
        infrastructure::search_documents(
            &state.db,
            infrastructure::DocumentQuery {
                q: query.q,
                tags: parts(query.tags.as_deref()),
                path: parts(query.path.as_deref()),
                subject_kind: query.subject_kind,
                subject_id: query.subject_id,
                limit: query.limit,
            },
        )
        .await?,
    ))
}

pub async fn detail(
    State(state): State<AppState>,
    Path(document_id): Path<Uuid>,
) -> Result<Json<infrastructure::Document>, AppError> {
    Ok(Json(
        infrastructure::read_document(&state.db, document_id).await?,
    ))
}

/// A short-lived URL for the bytes.
///
/// Issued rather than proxied: the permission check happens here, and then the
/// browser talks to the bucket directly instead of pulling a 20MB contract
/// through a 512MB node.
pub async fn download_url(
    State(state): State<AppState>,
    Path(document_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let url = infrastructure::download_url(&state, document_id).await?;
    Ok(Json(json!({ "url": url, "expires_in_seconds": 300 })))
}

/// The bytes themselves, through the node.
///
/// The sibling of [`download_url`], and both are needed for the same reason
/// `postgres::read_file` has two arms. A document filed against an object
/// store gets a presigned URL and the bytes never touch this process; a
/// document whose bytes sit in `stored_file.bytes` — every seeded one, and
/// every one filed on a node with no bucket configured — has no key to presign,
/// so `download_url` answers 404 and the drawer has no way to open its own
/// files at all.
///
/// This route is also what makes a preview possible. A tile draws through an
/// `<img>` or an `<object>`, and neither can carry a signed URL fetched later:
/// by the time the fetch answers the tile has painted, and a presigned link
/// held for the life of a screen has expired before anybody clicks it. So the
/// tile points here, at a stable same-origin path, and `download_response`
/// decides — from the same inert allow-list the attachment routes use — whether
/// the browser may draw it or must save it.
pub async fn content(
    State(state): State<AppState>,
    Path(document_id): Path<Uuid>,
) -> Result<axum::response::Response, AppError> {
    let document = infrastructure::read_document(&state.db, document_id).await?;
    Ok(super::files::download_response(
        infrastructure::read_file(&state, document.file_id).await?,
    ))
}
