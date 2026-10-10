//! The master of names a new article is suggested as it is typed.
//!
//! Reads are open to anyone signed in — the Name box cannot draw its list
//! without them. The writes fall through `required_role` to Supervisor, the
//! same rung the division, size and tag masters sit on. Nothing references a
//! suggestion, so it can be renamed, retired or deleted freely.

use super::auth::Principal;
use crate::cloud::application::{AppError, AppState};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct NameSuggestion {
    pub suggestion_id: Uuid,
    pub name: String,
    pub active: bool,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    /// Names containing this, case-insensitively.
    pub q: Option<String>,
    /// Retired ones too — the master screen needs to find them again; the Name
    /// box never asks.
    #[serde(default)]
    pub all: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRequest {
    pub name: Option<String>,
    pub active: Option<bool>,
}

fn tidy(raw: &str) -> Result<String, AppError> {
    let name = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(AppError::Validation("a name cannot be empty".into()));
    }
    if name.chars().count() > 120 {
        return Err(AppError::Validation(
            "a name is at most 120 characters".into(),
        ));
    }
    Ok(name)
}

fn from_row(row: &sqlx::postgres::PgRow) -> Result<NameSuggestion, AppError> {
    Ok(NameSuggestion {
        suggestion_id: row.try_get("suggestion_id")?,
        name: row.try_get("name")?,
        active: row.try_get("active")?,
    })
}

fn duplicate(error: sqlx::Error) -> AppError {
    match &error {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::Conflict("that name is already in the list".into())
        }
        _ => AppError::Database(error),
    }
}

/// The suggestions, alphabetically; the ones containing `q` when it is given.
pub async fn list(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<NameSuggestion>>, AppError> {
    let needle = query.q.as_deref().map(str::trim).filter(|q| !q.is_empty());
    let rows = sqlx::query(
        "SELECT suggestion_id, name, active
           FROM article_name_suggestion
          WHERE ($1 OR active)
            AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%')
          ORDER BY lower(name)
          LIMIT 200",
    )
    .bind(query.all)
    .bind(needle)
    .fetch_all(&state.db)
    .await?;
    rows.iter()
        .map(from_row)
        .collect::<Result<Vec<_>, _>>()
        .map(Json)
}

pub async fn create(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<CreateRequest>,
) -> Result<(StatusCode, Json<NameSuggestion>), AppError> {
    let name = tidy(&request.name)?;
    let row = sqlx::query(
        "INSERT INTO article_name_suggestion (name, created_by)
         VALUES ($1, $2)
         RETURNING suggestion_id, name, active",
    )
    .bind(&name)
    .bind(&principal.username)
    .fetch_one(&state.db)
    .await
    .map_err(duplicate)?;
    Ok((StatusCode::CREATED, Json(from_row(&row)?)))
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdateRequest>,
) -> Result<Json<NameSuggestion>, AppError> {
    let name = request.name.as_deref().map(tidy).transpose()?;
    let row = sqlx::query(
        "UPDATE article_name_suggestion
            SET name = COALESCE($2, name),
                active = COALESCE($3, active),
                updated_at = now()
          WHERE suggestion_id = $1
        RETURNING suggestion_id, name, active",
    )
    .bind(id)
    .bind(name)
    .bind(request.active)
    .fetch_optional(&state.db)
    .await
    .map_err(duplicate)?
    .ok_or_else(|| AppError::NotFound("that suggestion".into()))?;
    Ok(Json(from_row(&row)?))
}

pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let done = sqlx::query("DELETE FROM article_name_suggestion WHERE suggestion_id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound("that suggestion".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}
