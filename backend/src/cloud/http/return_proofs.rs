//! The photo that proves a return reached its supplier (0972).
//!
//! * `PUT /api/v1/purchase-returns/{id}/proof` — `{ "photo_url": "…" }`, the
//!   link of a photograph already in the image bucket. Written before the
//!   hand-over is confirmed; a second one replaces the first.
//! * `GET /api/v1/purchase-returns/{id}/proof` — `{ photo_url, taken_by,
//!   taken_at }`, or 404 when the return has none.

use super::auth::Principal;
use crate::cloud::application::{AppError, AppState};
use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct ProofRequest {
    pub photo_url: String,
}

/// `PUT /api/v1/purchase-returns/{id}/proof`.
pub async fn put(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<ProofRequest>,
) -> Result<Json<Value>, AppError> {
    let url = request.photo_url.trim();
    if url.len() < 10
        || url.len() > 2000
        || !(url.starts_with("https://") || url.starts_with("http://"))
    {
        return Err(AppError::Validation(
            "the photo is a link of at most 2000 characters".into(),
        ));
    }
    let known: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM purchase_return WHERE return_id = $1)",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;
    if !known {
        return Err(AppError::NotFound("purchase return".into()));
    }
    sqlx::query(
        "INSERT INTO purchase_return_proof (return_id, photo_url, taken_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (return_id) DO UPDATE
            SET photo_url = EXCLUDED.photo_url,
                taken_by = EXCLUDED.taken_by,
                taken_at = now()",
    )
    .bind(id)
    .bind(url)
    .bind(&principal.username)
    .execute(&state.db)
    .await?;
    get(State(state), Path(id)).await
}

/// `GET /api/v1/purchase-returns/{id}/proof`.
pub async fn get(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let row: Option<(String, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT photo_url, taken_by, taken_at FROM purchase_return_proof WHERE return_id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;
    let Some((photo_url, taken_by, taken_at)) = row else {
        return Err(AppError::NotFound("a photo for that return".into()));
    };
    Ok(Json(json!({
        "photo_url": photo_url,
        "taken_by": taken_by,
        "taken_at": taken_at,
    })))
}
