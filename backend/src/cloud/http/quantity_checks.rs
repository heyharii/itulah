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

/// A check carries at most this many tags.
const MAX_TAGS: usize = 20;

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
    /// The colour and size combinations head office had chosen in the form when
    /// it asked: the rows the warehouse sheet opens with, each waiting for a
    /// quantity. Head office does not know how many of each came.
    pub expected: Value,
    /// What the delivery was counted at, and where it came from — context for
    /// whoever is counting, not a figure to match.
    pub po_number: String,
    pub receipt_quantity: i64,
    pub image_url: Option<String>,
    /// The division and tags head office had in the form when it asked, as codes
    /// (the hub names them from the catalogue vocabulary).
    pub division_code: Option<String>,
    pub tags: Value,
    /// Who delivered it: the receipt's supplier code, as New articles shows it,
    /// and the name the order was raised with (a snapshot, may be absent).
    pub supplier_id: String,
    pub supplier_name: Option<String>,
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
    /// Every article's colour x size the form had chosen at the time of asking.
    #[serde(default)]
    pub expected: Vec<ExpectedCell>,
    /// The division code the form had chosen, if any.
    #[serde(default)]
    pub division: Option<String>,
    /// The tag codes the form had chosen.
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ExpectedCell {
    /// Which article of the form the combination belongs to; empty when the
    /// asker did not say.
    #[serde(default)]
    pub article: String,
    pub colour: String,
    pub size: String,
}

#[derive(Debug, Deserialize)]
pub struct CountLine {
    /// Which article the count belongs to, as the sheet showed it; empty for
    /// checks asked before articles were named on the sheet.
    #[serde(default)]
    pub article: String,
    pub colour: String,
    pub size: String,
    pub quantity: i64,
}

#[derive(Debug, Deserialize)]
pub struct CountRequest {
    pub lines: Vec<CountLine>,
}

const SELECT: &str = "SELECT q.check_id, q.receipt_line_id, q.status, q.article_name,
        q.requested_by, q.requested_at, q.counted_by, q.counted_at, q.lines, q.expected,
        q.division_code, q.tags, g.supplier_id, o.supplier_name,
        o.po_number, r.matched_quantity AS receipt_quantity, l.image_url
   FROM quantity_check q
   JOIN goods_receipt_line r ON r.receipt_line_id = q.receipt_line_id
   JOIN goods_receipt g ON g.receipt_id = r.receipt_id
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
        expected: row.try_get("expected")?,
        po_number: row.try_get("po_number")?,
        receipt_quantity: row.try_get("receipt_quantity")?,
        image_url: row.try_get("image_url")?,
        division_code: row.try_get("division_code")?,
        tags: row.try_get("tags")?,
        supplier_id: row.try_get("supplier_id")?,
        supplier_name: row.try_get("supplier_name")?,
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

/// The division as stored: its code, or nothing when the form had none.
fn tidy_division(raw: Option<&str>) -> Result<Option<String>, AppError> {
    match raw.map(str::trim).filter(|text| !text.is_empty()) {
        None => Ok(None),
        Some(text) => word(text, "the division").map(Some),
    }
}

/// The tags as stored: codes in words, each once, in the order given.
fn tidy_tags(tags: &[String]) -> Result<Value, AppError> {
    let mut out: Vec<String> = Vec::with_capacity(tags.len());
    for tag in tags {
        if tag.trim().is_empty() {
            continue;
        }
        let code = word(tag, "a tag")?;
        if !out.contains(&code) {
            out.push(code);
        }
    }
    if out.len() > MAX_TAGS {
        return Err(AppError::Validation(format!(
            "a check has at most {MAX_TAGS} tags"
        )));
    }
    Ok(Value::from(out))
}

/// One stored row: the article only when there is one, so an old check and a
/// new one without a name read the same.
fn stored(
    article: &str,
    colour: &str,
    size: &str,
    quantity: Option<i64>,
) -> Result<Value, AppError> {
    let mut row = serde_json::Map::new();
    if !article.trim().is_empty() {
        row.insert("article".into(), Value::from(word(article, "an article")?));
    }
    row.insert("colour".into(), Value::from(word(colour, "a colour")?));
    row.insert("size".into(), Value::from(word(size, "a size")?));
    if let Some(quantity) = quantity {
        row.insert("quantity".into(), Value::from(quantity));
    }
    Ok(Value::Object(row))
}

/// The combinations as stored: the article, colour and size in words, each once.
fn tidy_expected(cells: &[ExpectedCell]) -> Result<Value, AppError> {
    let mut out: Vec<Value> = Vec::with_capacity(cells.len());
    for cell in cells {
        let row = stored(&cell.article, &cell.colour, &cell.size, None)?;
        if !out.contains(&row) {
            out.push(row);
        }
    }
    if out.len() > MAX_LINES {
        return Err(AppError::Validation(format!(
            "a check has at most {MAX_LINES} rows"
        )));
    }
    Ok(Value::Array(out))
}

/// The rows of an answer as stored: words for colour and size, a quantity
/// within bounds.
fn tidy(lines: &[CountLine]) -> Result<Value, AppError> {
    if lines.len() > MAX_LINES {
        return Err(AppError::Validation(format!(
            "a check has at most {MAX_LINES} rows"
        )));
    }
    let mut out = Vec::with_capacity(lines.len());
    for line in lines {
        if line.quantity < 1 || line.quantity > 1_000_000 {
            return Err(AppError::Validation(
                "a quantity is a whole number from 1".into(),
            ));
        }
        out.push(stored(
            &line.article,
            &line.colour,
            &line.size,
            Some(line.quantity),
        )?);
    }
    Ok(Value::Array(out))
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
    let expected = tidy_expected(&request.expected)?;
    // The warehouse counts colour by size: with none picked there is nothing
    // to ask for, and the answer would have to invent the variants itself.
    if expected.as_array().is_some_and(Vec::is_empty) {
        return Err(AppError::Validation(
            "pick at least one colour and one size before asking for a count".into(),
        ));
    }
    let division = tidy_division(request.division.as_deref())?;
    let tags = tidy_tags(&request.tags)?;
    let mut tx = state.db.begin().await?;
    let known =
        sqlx::query("SELECT 1 FROM goods_receipt_line WHERE receipt_line_id = $1 FOR SHARE")
            .bind(request.receipt_line_id)
            .fetch_optional(&mut *tx)
            .await?;
    if known.is_none() {
        return Err(AppError::NotFound("that delivery line".into()));
    }
    // One open check per delivery line is the table's rule (0942): two askers
    // at the same moment end up with the same check, not two.
    let inserted: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO quantity_check
            (receipt_line_id, article_name, requested_by, expected, division_code, tags)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (receipt_line_id) WHERE status = 'REQUESTED' DO NOTHING
         RETURNING check_id",
    )
    .bind(request.receipt_line_id)
    .bind(&name)
    .bind(&principal.username)
    .bind(&expected)
    .bind(&division)
    .bind(&tags)
    .fetch_optional(&mut *tx)
    .await?;
    let check_id = match inserted {
        Some(id) => id,
        None => {
            sqlx::query_scalar(
                "SELECT check_id FROM quantity_check
                  WHERE receipt_line_id = $1 AND status = 'REQUESTED'",
            )
            .bind(request.receipt_line_id)
            .fetch_one(&mut *tx)
            .await?
        }
    };
    // Asking again while one is open refreshes it: the warehouse sees the
    // newest name, grid, division and tags, not the first ones asked.
    sqlx::query(
        "UPDATE quantity_check
            SET article_name = $2, expected = $3, division_code = $4, tags = $5
          WHERE check_id = $1 AND status = 'REQUESTED'",
    )
    .bind(check_id)
    .bind(&name)
    .bind(&expected)
    .bind(&division)
    .bind(&tags)
    .execute(&mut *tx)
    .await?;
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
    let lines = tidy(&request.lines)?;
    let done = sqlx::query(
        "UPDATE quantity_check
            SET status = 'COUNTED', counted_by = $2, counted_at = now(), lines = $3
          WHERE check_id = $1 AND status = 'REQUESTED'",
    )
    .bind(id)
    .bind(&principal.username)
    .bind(lines)
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
