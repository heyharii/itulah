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

/// Types a browser may draw in the page instead of saving to disk.
///
/// An allow-list, and it has to be. `Content-Disposition: attachment` was the
/// blanket answer here because these bytes are somebody's upload served from
/// this app's own origin: an uploaded `.html` or `.svg` rendered inline is
/// stored XSS with a session attached, and `image/svg+xml` is a script vector
/// wearing an image's name. So nothing is inline unless it is named here.
///
/// What this buys is the preview on the Files screen. A vault whose tiles all
/// say "PDF" is a vault that has told you nothing you did not know from the
/// filename, and an `<object>` pointed at an `attachment` response does not
/// render — the browser fetches the bytes and then aborts.
fn may_render_inline(content_type: &str) -> bool {
    // The parameters after `;` are the charset and friends; the type is what
    // decides this, and a header of `text/html; charset=utf-8` must not slip
    // past a comparison against the whole string.
    let base = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    matches!(
        base.as_str(),
        "application/pdf"
            | "image/png"
            | "image/jpeg"
            | "image/gif"
            | "image/webp"
            | "image/avif"
            | "text/plain"
    )
}

/// The shared shape of a file coming back out.
///
/// `attachment` unless [`may_render_inline`] says otherwise, which it says for
/// nothing that can execute. The stored content type is already narrowed to a
/// known list and `nosniff` stops a browser second-guessing it; the allow-list
/// and the sandbox policy below are what let the two safe families be drawn on
/// a page without giving that guarantee up.
pub fn download_response(content: FileContent) -> Response {
    // Quotes and control characters are stripped rather than escaped: a
    // filename that ends the quoted string early rewrites the header.
    let safe_name: String = content
        .file_name
        .chars()
        .filter(|c| !c.is_control() && *c != '"' && *c != '\\')
        .collect();
    let inline = may_render_inline(&content.content_type);
    let disposition = if inline {
        format!("inline; filename=\"{safe_name}\"")
    } else {
        format!("attachment; filename=\"{safe_name}\"")
    };
    (
        [
            (header::CONTENT_TYPE, content.content_type),
            (header::CONTENT_DISPOSITION, disposition),
            (
                header::HeaderName::from_static("x-content-type-options"),
                "nosniff".to_string(),
            ),
            // Belt as well as braces on the inline path: `sandbox` with no
            // tokens denies scripts, plugins, forms and same-origin access to
            // whatever is being drawn, so even a PDF carrying JavaScript cannot
            // reach the session it was served with. Harmless on the attachment
            // path, where nothing renders at all.
            (
                header::CONTENT_SECURITY_POLICY,
                "sandbox; default-src 'none'; img-src 'self' data:; \
                 object-src 'self'; style-src 'unsafe-inline'"
                    .to_string(),
            ),
        ],
        content.bytes,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::may_render_inline;

    /// The two families that may be drawn on a page, and the ones that must
    /// never be. `image/svg+xml` and `text/html` are the whole reason this is
    /// an allow-list: both are documents that can run script, and both arrive
    /// here as somebody's upload served from this app's own origin.
    #[test]
    fn only_inert_types_render_inline() {
        assert!(may_render_inline("application/pdf"));
        assert!(may_render_inline("image/png"));
        assert!(may_render_inline("image/jpeg"));
        assert!(may_render_inline("text/plain"));

        assert!(!may_render_inline("image/svg+xml"));
        assert!(!may_render_inline("text/html"));
        assert!(!may_render_inline("application/xhtml+xml"));
        assert!(!may_render_inline("text/csv"));
        assert!(!may_render_inline("application/octet-stream"));
    }

    /// A header carries parameters, and a comparison against the whole string
    /// would let `text/html; charset=utf-8` past a check that refuses
    /// `text/html`. Case is not the sender's to choose either.
    #[test]
    fn the_parameters_and_the_case_do_not_decide_it() {
        assert!(may_render_inline("text/plain; charset=utf-8"));
        assert!(may_render_inline("APPLICATION/PDF"));
        assert!(!may_render_inline("text/html; charset=utf-8"));
        assert!(!may_render_inline(" image/svg+xml ; q=1"));
    }
}
