//! New articles drafts: the form for a delivery line, kept on the server so a
//! half-named delivery can be picked up at another desk.
//!
//! One shared draft per delivery line and the last save wins. The server never
//! reads the payload: it is the screen's own form, handed back as it was
//! saved. Giving the line its identity deletes the draft (see
//! `postgres/tagging.rs`).

use super::auth::Principal;
use crate::cloud::application::{AppError, AppState};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

/// A form is a few tabs of colours and sizes; anything near this is a mistake.
const MAX_PAYLOAD_BYTES: usize = 256 * 1024;

#[derive(Debug, Serialize)]
pub struct DraftMeta {
    pub receipt_line_id: Uuid,
    pub saved_by: String,
    pub saved_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
pub struct Draft {
    pub receipt_line_id: Uuid,
    pub payload: Value,
    pub saved_by: String,
    pub saved_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SaveRequest {
    pub payload: Value,
}

fn draft_from_row(row: &sqlx::postgres::PgRow) -> Result<Draft, AppError> {
    Ok(Draft {
        receipt_line_id: row.try_get("receipt_line_id")?,
        payload: row.try_get("payload")?,
        saved_by: row.try_get("saved_by")?,
        saved_at: row.try_get("saved_at")?,
    })
}

/// Which lines have a draft, newest first. The payloads stay out: the list
/// only marks the waiting rows.
pub async fn list(State(state): State<AppState>) -> Result<Json<Vec<DraftMeta>>, AppError> {
    let rows = sqlx::query(
        "SELECT receipt_line_id, saved_by, saved_at
           FROM article_setup_draft
          ORDER BY saved_at DESC
          LIMIT 2000",
    )
    .fetch_all(&state.db)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(DraftMeta {
                receipt_line_id: row.try_get("receipt_line_id")?,
                saved_by: row.try_get("saved_by")?,
                saved_at: row.try_get("saved_at")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()
        .map(Json)
}

pub async fn get_one(
    State(state): State<AppState>,
    Path(receipt_line_id): Path<Uuid>,
) -> Result<Json<Draft>, AppError> {
    let row = sqlx::query(
        "SELECT receipt_line_id, payload, saved_by, saved_at
           FROM article_setup_draft WHERE receipt_line_id = $1",
    )
    .bind(receipt_line_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("a draft for that delivery line".into()))?;
    Ok(Json(draft_from_row(&row)?))
}

/// Save, replacing whatever was there.
pub async fn save(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(receipt_line_id): Path<Uuid>,
    Json(request): Json<SaveRequest>,
) -> Result<Json<Draft>, AppError> {
    if !request.payload.is_object() {
        return Err(AppError::Validation("a draft is an object".into()));
    }
    let size = serde_json::to_vec(&request.payload)
        .map_err(|_| AppError::Validation("that draft cannot be read".into()))?
        .len();
    if size > MAX_PAYLOAD_BYTES {
        return Err(AppError::Validation(
            "that draft is too large to keep (256 KB at most)".into(),
        ));
    }
    let known = sqlx::query("SELECT 1 FROM goods_receipt_line WHERE receipt_line_id = $1")
        .bind(receipt_line_id)
        .fetch_optional(&state.db)
        .await?;
    if known.is_none() {
        return Err(AppError::NotFound("that delivery line".into()));
    }
    let row = sqlx::query(
        "INSERT INTO article_setup_draft (receipt_line_id, payload, saved_by, saved_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (receipt_line_id) DO UPDATE
            SET payload = EXCLUDED.payload,
                saved_by = EXCLUDED.saved_by,
                saved_at = EXCLUDED.saved_at
         RETURNING receipt_line_id, payload, saved_by, saved_at",
    )
    .bind(receipt_line_id)
    .bind(&request.payload)
    .bind(&principal.username)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(draft_from_row(&row)?))
}

/// Idempotent: deleting a draft that is not there is the same answer.
pub async fn remove(
    State(state): State<AppState>,
    Path(receipt_line_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    sqlx::query("DELETE FROM article_setup_draft WHERE receipt_line_id = $1")
        .bind(receipt_line_id)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
