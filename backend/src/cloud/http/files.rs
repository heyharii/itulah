//! Uploading bytes, listing what you can reach, and handing them back.
//!
//! Upload is its own step, deliberately. A photograph finishes uploading while
//! the message is still being typed, and the message then names a `file_id` it
//! already has — so a slow attachment never blocks a send, and a send that
//! fails does not lose the upload.
//!
//! Download is NOT its own step. There is no `GET /files/{id}` in this module
//! and there must not be one: the bytes come out through the conversation or
//! the discussion that carries them, which is where permission actually lives.
//! This module only provides the shared response shape those two routes use.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{self as infrastructure, FileContent, FileInContext, StoredFile},
};
use axum::{
    body::Bytes,
    extract::{Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct UploadQuery {
    /// The file's own name, as the person picking it sees it. A query
    /// parameter rather than a header so no cross-origin preflight has to be
    /// widened for it, and rather than multipart so the browser can hand the
    /// `File` straight to `fetch` as the body.
    pub name: String,
    /// Optional; the server narrows whatever arrives to a known list anyway.
    #[serde(rename = "type")]
    pub content_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub limit: Option<i64>,
}

/// Take in the bytes and answer with the id a message can attach.
pub async fn upload(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<UploadQuery>,
    bytes: Bytes,
) -> Result<(StatusCode, Json<StoredFile>), AppError> {
    let file = infrastructure::store_file(
        &state,
        &principal.username,
        &query.name,
        query.content_type.as_deref().unwrap_or(""),
        bytes.to_vec(),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(file)))
}

/// Every file the caller can actually reach, newest first.
///
/// Not a file system. The rows come from conversations this person is in and
/// from discussions, which everybody signed in may read — and each row carries
/// the room it belongs to, because that room's route is the only way to open
/// it.
pub async fn list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<FileInContext>>, AppError> {
    Ok(Json(
        infrastructure::list_files(&state.db, &principal.username, query.limit.unwrap_or(200))
            .await?,
    ))
}

/// The shared shape of a file coming back out.
///
/// Always `attachment`, never inline. The stored content type is already
/// narrowed to a known list, and `nosniff` stops a browser from second-
/// guessing that: between them, an uploaded file cannot execute as a page on
/// our own origin.
pub fn download_response(content: FileContent) -> Response {
    // Quotes and control characters are stripped rather than escaped: a
    // filename that ends the quoted string early rewrites the header.
    let safe_name: String = content
        .file_name
        .chars()
        .filter(|c| !c.is_control() && *c != '"' && *c != '\\')
        .collect();
    (
        [
            (header::CONTENT_TYPE, content.content_type),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{safe_name}\""),
            ),
            (
                header::HeaderName::from_static("x-content-type-options"),
                "nosniff".to_string(),
            ),
        ],
        content.bytes,
    )
        .into_response()
}
