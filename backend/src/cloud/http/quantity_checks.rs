//! Quantity checks: a count of a delivery line by colour and size, asked of the
//! warehouse and kept as a reference.
//!
//! Head office asks from New articles; the warehouse answers in Operations with
//! a flat list of colour, size and quantity. The answer is only to look at: it
//! is not compared with the delivery's count and nothing waits for it. Asking
//! again is a new check; the earlier ones stay as they were said.

use super::auth::Principal;
use crate::cloud::application::{AppError, AppState};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

/// A line may be at most this many colour × size rows.
const MAX_LINES: usize = 500;

#[derive(Debug, Serialize)]
pub struct QuantityCheck {
    pub check_id: Uuid,
    pub receipt_line_id: Uuid,
    pub status: String,
    pub article_name: String,
    pub requested_by: String,
    pub requested_at: chrono::DateTime<chrono::Utc>,
    pub counted_by: Option<String>,
    pub counted_at: Option<chrono::DateTime<chrono::Utc>>,
    pub lines: Value,
    /// What the delivery was counted at, and where it came from — context for
    /// whoever is counting, not a figure to match.
    pub po_number: String,
    pub receipt_quantity: i64,
    pub image_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    /// `REQUESTED` or `COUNTED`.
    pub status: Option<String>,
    pub receipt_line_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct AskRequest {
    pub receipt_line_id: Uuid,
    pub article_name: String,
}

#[derive(Debug, Deserialize)]
pub struct CountLine {
    pub colour: String,
    pub size: String,
    pub quantity: i64,
}

#[derive(Debug, Deserialize)]
pub struct CountRequest {
    pub lines: Vec<CountLine>,
}

const SELECT: &str = "SELECT q.check_id, q.receipt_line_id, q.status, q.article_name,
        q.requested_by, q.requested_at, q.counted_by, q.counted_at, q.lines,
        o.po_number, r.matched_quantity AS receipt_quantity, l.image_url
   FROM quantity_check q
   JOIN goods_receipt_line r ON r.receipt_line_id = q.receipt_line_id
   JOIN purchase_order_line l ON l.po_line_id = r.po_line_id
   JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id";

fn from_row(row: &sqlx::postgres::PgRow) -> Result<QuantityCheck, AppError> {
    Ok(QuantityCheck {
        check_id: row.try_get("check_id")?,
        receipt_line_id: row.try_get("receipt_line_id")?,
        status: row.try_get("status")?,
        article_name: row.try_get("article_name")?,
        requested_by: row.try_get("requested_by")?,
        requested_at: row.try_get("requested_at")?,
        counted_by: row.try_get("counted_by")?,
        counted_at: row.try_get("counted_at")?,
        lines: row.try_get("lines")?,
        po_number: row.try_get("po_number")?,
        receipt_quantity: row.try_get("receipt_quantity")?,
        image_url: row.try_get("image_url")?,
    })
}

fn word(raw: &str, what: &str) -> Result<String, AppError> {
    let text = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err(AppError::Validation(format!("{what} cannot be empty")));
    }
    if text.chars().count() > 60 {
        return Err(AppError::Validation(format!(
            "{what} is at most 60 characters"
        )));
    }
    Ok(text)
}

/// Newest first; the open ones, the counted ones, or one delivery line's.
pub async fn list(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<QuantityCheck>>, AppError> {
    if let Some(status) = query.status.as_deref() {
        if status != "REQUESTED" && status != "COUNTED" {
            return Err(AppError::Validation(
                "status is REQUESTED or COUNTED".into(),
            ));
        }
    }
    let rows = sqlx::query(&format!(
        "{SELECT}
          WHERE ($1::text IS NULL OR q.status = $1)
            AND ($2::uuid IS NULL OR q.receipt_line_id = $2)
          ORDER BY q.requested_at DESC
          LIMIT 500"
    ))
    .bind(query.status)
    .bind(query.receipt_line_id)
    .fetch_all(&state.db)
    .await?;
    rows.iter()
        .map(from_row)
        .collect::<Result<Vec<_>, _>>()
        .map(Json)
}

/// Ask the warehouse to count a delivery line. One open ask per line: asking
/// while one is still open answers with that one.
pub async fn ask(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<AskRequest>,
) -> Result<(StatusCode, Json<QuantityCheck>), AppError> {
    let name = word(&request.article_name, "the article name")?;
    let mut tx = state.db.begin().await?;
    let known = sqlx::query("SELECT 1 FROM goods_receipt_line WHERE receipt_line_id = $1 FOR SHARE")
        .bind(request.receipt_line_id)
        .fetch_optional(&mut *tx)
        .await?;
    if known.is_none() {
        return Err(AppError::NotFound("that delivery line".into()));
    }
    let open: Option<Uuid> = sqlx::query_scalar(
        "SELECT check_id FROM quantity_check
          WHERE receipt_line_id = $1 AND status = 'REQUESTED'
          ORDER BY requested_at DESC LIMIT 1",
    )
    .bind(request.receipt_line_id)
    .fetch_optional(&mut *tx)
    .await?;
    let check_id = match open {
        Some(id) => id,
        None => {
            sqlx::query_scalar(
                "INSERT INTO quantity_check (receipt_line_id, article_name, requested_by)
                 VALUES ($1, $2, $3) RETURNING check_id",
            )
            .bind(request.receipt_line_id)
            .bind(&name)
            .bind(&principal.username)
            .fetch_one(&mut *tx)
            .await?
        }
    };
    tx.commit().await?;
    let row = sqlx::query(&format!("{SELECT} WHERE q.check_id = $1"))
        .bind(check_id)
        .fetch_one(&state.db)
        .await?;
    Ok((StatusCode::CREATED, Json(from_row(&row)?)))
}

/// The warehouse's answer: a colour, a size and a quantity per row. The name is
/// not theirs to change and is not in the request.
pub async fn count(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<CountRequest>,
) -> Result<Json<QuantityCheck>, AppError> {
    if request.lines.is_empty() {
        return Err(AppError::Validation("count at least one row".into()));
    }
    if request.lines.len() > MAX_LINES {
        return Err(AppError::Validation(format!(
            "a check has at most {MAX_LINES} rows"
        )));
    }
    let mut lines = Vec::with_capacity(request.lines.len());
    for line in &request.lines {
        if line.quantity < 1 || line.quantity > 1_000_000 {
            return Err(AppError::Validation(
                "a quantity is a whole number from 1".into(),
            ));
        }
        lines.push(serde_json::json!({
            "colour": word(&line.colour, "a colour")?,
            "size": word(&line.size, "a size")?,
            "quantity": line.quantity,
        }));
    }
    let done = sqlx::query(
        "UPDATE quantity_check
            SET status = 'COUNTED', counted_by = $2, counted_at = now(), lines = $3
          WHERE check_id = $1 AND status = 'REQUESTED'",
    )
    .bind(id)
    .bind(&principal.username)
    .bind(Value::Array(lines))
    .execute(&state.db)
    .await?;
    if done.rows_affected() == 0 {
        let known: Option<String> =
            sqlx::query_scalar("SELECT status FROM quantity_check WHERE check_id = $1")
                .bind(id)
                .fetch_optional(&state.db)
                .await?;
        return Err(match known {
            None => AppError::NotFound("that quantity check".into()),
            Some(_) => AppError::Conflict("that quantity check is already counted".into()),
        });
    }
    let row = sqlx::query(&format!("{SELECT} WHERE q.check_id = $1"))
        .bind(id)
        .fetch_one(&state.db)
        .await?;
    Ok(Json(from_row(&row)?))
}
