//! The public link of a printed purchase order.
//!
//! The QR on a PO opens `/p/{token}` in the hub: a read-only page of that order
//! for whoever holds the paper, with no login, that says whether the order is
//! still active (owner, 2026-10-16).
//!
//! * `POST /api/v1/purchase-orders/{id}/link` — a signed-in person's. Makes the
//!   order's link the first time and finds it every time after: `{ "token" }`.
//! * `GET /api/v1/public/purchase-orders/{token}` — public
//!   (`auth::is_public`). The order as it stands now, cut down to what the
//!   paper already shows a supplier: number, supplier, dates, status and the
//!   items with what was ordered and what came. No prices, no people, no
//!   history. An unknown token is a plain 404.

use super::auth::Principal;
use crate::cloud::application::{AppError, AppState};
use crate::cloud::postgres as infrastructure;
use axum::{
    extract::{Path, State},
    http::{header, HeaderName, HeaderValue},
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde_json::{json, Map, Value};
use uuid::Uuid;

/// `POST /api/v1/purchase-orders/{id}/link`.
pub async fn create(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let known: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM purchase_order WHERE purchase_order_id = $1)",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;
    if !known {
        return Err(AppError::NotFound("purchase order".into()));
    }
    // One link per order; two printers at once end up with the same token.
    sqlx::query(
        "INSERT INTO purchase_order_link (token, purchase_order_id, created_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (purchase_order_id) DO NOTHING",
    )
    .bind(crate::security::random_url_token())
    .bind(id)
    .bind(&principal.username)
    .execute(&state.db)
    .await?;
    let token: String =
        sqlx::query_scalar("SELECT token FROM purchase_order_link WHERE purchase_order_id = $1")
            .bind(id)
            .fetch_one(&state.db)
            .await?;
    Ok(Json(json!({ "token": token })))
}

/// `GET /api/v1/public/purchase-orders/{token}` — public and read-only.
pub async fn show(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Response, AppError> {
    // Tokens are base64url; anything else cannot be one, and is not looked up.
    let shaped = !token.is_empty()
        && token.len() <= 128
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    let id: Option<Uuid> = if shaped {
        sqlx::query_scalar("SELECT purchase_order_id FROM purchase_order_link WHERE token = $1")
            .bind(&token)
            .fetch_optional(&state.db)
            .await?
    } else {
        None
    };
    let Some(id) = id else {
        return Err(AppError::NotFound("that purchase order".into()));
    };
    let order = infrastructure::purchase_order_status(&state.db, id).await?;
    let mut response = Json(json!({ "order": public_view(&order) })).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        HeaderName::from_static("x-robots-tag"),
        HeaderValue::from_static("noindex"),
    );
    Ok(response)
}

/// The order cut down to what the printed paper already says.
fn public_view(order: &Value) -> Value {
    const ORDER_KEYS: &[&str] = &[
        "po_number",
        "supplier_name",
        "lifecycle",
        "issued_at",
        "created_at",
        "expected_arrival",
    ];
    const LINE_KEYS: &[&str] = &[
        "line_number",
        "article_name",
        "tags",
        "ordered_quantity",
        "cancelled_quantity",
        "received_quantity",
        "closed_short_units",
    ];
    let pick = |from: &Value, keys: &[&str]| -> Value {
        let mut out = Map::new();
        for key in keys {
            if let Some(value) = from.get(*key) {
                out.insert((*key).to_string(), value.clone());
            }
        }
        Value::Object(out)
    };
    let mut view = pick(order, ORDER_KEYS);
    let lines: Vec<Value> = order
        .get("lines")
        .and_then(Value::as_array)
        .map(|lines| lines.iter().map(|line| pick(line, LINE_KEYS)).collect())
        .unwrap_or_default();
    if let Value::Object(map) = &mut view {
        map.insert("lines".into(), Value::Array(lines));
    }
    view
}
