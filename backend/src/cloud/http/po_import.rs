//! PO import over HTTP: the pipe between a buyer's picked files and the
//! drafts the Procurement screen edits in browser memory.
//!
//! Three routes, none of which writes to the books:
//!
//! * `GET /health` — which extraction doors this node can open.
//! * `POST /` — multipart, field `file`, any mix of xlsx/xls/csv/pdf/foto.
//!   Answers `{ reports, drafts }`; drafts are grouped (same supplier + same
//!   printed PO number) and carry their open questions.
//! * `POST /validate` — a draft plus the wizard's answers, answered and
//!   re-asked. Still nothing persisted: the review summary's button is the
//!   only maker of purchase orders, and it calls the order route, not here.
//!
//! The multipart convention follows `POST /api/v1/files` (raw bytes through
//! the node), not the documents drawer's presigned PUT: these bytes must be
//! read before a draft exists, so the node has to see them anyway.

use std::collections::BTreeMap;

use axum::{
    extract::{Multipart, State},
    Extension, Json,
};
use serde::Deserialize;

use super::auth::Principal;
use crate::cloud::application::{AppError, AppState};
use crate::cloud::intake::po::{
    self,
    draft::{apply_answers, PoImportAnswer, PoImportDraft},
    IngestFile,
};

/// What the import route will buffer: a packet of scans is a real thing a
/// buyer uploads, and the Node service this replaces had no cap at all. The
/// per-file attachment cap stays the attachment route's business.
pub const MAX_IMPORT_BYTES: usize = 32 * 1024 * 1024;

/// Which extraction doors this node can open, so the screen can say honestly
/// what an upload will and will not get.
pub async fn health(State(state): State<AppState>) -> Json<po::PoImportHealth> {
    Json(po::health(&state.config.po_import))
}

pub async fn import_files(
    State(state): State<AppState>,
    Extension(_principal): Extension<Principal>,
    mut multipart: Multipart,
) -> Result<Json<po::PoImportIngestResponse>, AppError> {
    let mut files: Vec<IngestFile> = Vec::new();
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| AppError::Validation(error.to_string()))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let file_name = field.file_name().unwrap_or("upload").to_string();
        let content_type = field.content_type().unwrap_or_default().to_string();
        let bytes = field
            .bytes()
            .await
            .map_err(|error| AppError::Validation(error.to_string()))?
            .to_vec();
        files.push(IngestFile {
            file_name,
            content_type,
            bytes,
        });
    }
    if files.is_empty() {
        return Err(AppError::Validation(
            "Tidak ada file yang dikirim.".to_string(),
        ));
    }
    let (reports, drafts) = po::ingest(&state.config.po_import, files).await;
    Ok(Json(po::PoImportIngestResponse { reports, drafts }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateRequest {
    pub draft: PoImportDraft,
    pub answers: BTreeMap<String, PoImportAnswer>,
}

/// Merge the wizard's answers into one draft, then re-ask what is left.
pub async fn validate(
    Extension(_principal): Extension<Principal>,
    Json(request): Json<ValidateRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let draft = apply_answers(request.draft, &request.answers);
    Ok(Json(serde_json::json!({ "draft": draft })))
}
