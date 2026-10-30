//! Unmatched sales over HTTP (see `postgres::unmatched_sales`).
//!
//! - `GET /api/v1/sales/unmatched?status=open|matched|found` — the hub's list.
//! - `GET /api/v1/sales/unmatched/places` — where a piece can come from.
//! - `GET /api/v1/sales/unmatched/stock?site_id=` — what a place holds.
//! - `POST /api/v1/sales/unmatched/{id}/match` — take one piece for a line.
//! - `GET /api/v1/sync/unmatched?origin_id=&site_id=&status=` — the store
//!   app's read of its own lines, relayed by its node and proved by the
//!   node's `x-sync-key` (public to the session gate, like `/sync/benefit/`).
//!
//! The `/sales/unmatched` paths are static, so the router answers them before
//! `/api/v1/sales/{id}`.

use super::auth::Principal;
use crate::cloud::postgres as infrastructure;
use crate::cloud::{AppError, AppState};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/sales/unmatched", get(list))
        .route("/api/v1/sales/unmatched/places", get(places))
        .route("/api/v1/sales/unmatched/stock", get(stock))
        .route("/api/v1/sales/unmatched/{id}/match", post(match_line))
        .route("/api/v1/sync/unmatched", get(sync_list))
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    #[serde(default)]
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StockQuery {
    site_id: String,
}

#[derive(Debug, Deserialize)]
struct SyncQuery {
    /// The node asking. Proved against its own key, never trusted.
    origin_id: String,
    #[serde(default)]
    site_id: Option<String>,
    #[serde(default)]
    status: Option<String>,
}

async fn list(
    State(s): State<AppState>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>, AppError> {
    let status = infrastructure::unmatched_status(q.status.as_deref())?;
    let rows = infrastructure::list_unmatched_sales(&s.db, status.as_deref(), None).await?;
    Ok(Json(json!({ "rows": rows })))
}

async fn places(
    State(s): State<AppState>,
) -> Result<Json<Vec<infrastructure::UnmatchedPlace>>, AppError> {
    Ok(Json(infrastructure::unmatched_places(&s.db).await?))
}

async fn stock(
    State(s): State<AppState>,
    Query(q): Query<StockQuery>,
) -> Result<Json<Vec<infrastructure::UnmatchedStockRow>>, AppError> {
    Ok(Json(
        infrastructure::unmatched_stock(&s.db, &q.site_id).await?,
    ))
}

async fn match_line(
    State(s): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<infrastructure::MatchUnmatchedRequest>,
) -> Result<Json<Value>, AppError> {
    if principal.relayed.is_some() {
        return Err(AppError::Forbidden(
            "head office matches an unmatched sale, not a till".into(),
        ));
    }
    Ok(Json(
        infrastructure::match_unmatched_sale(
            &s.db,
            id,
            request,
            &principal.username,
            s.clock.now(),
        )
        .await?,
    ))
}

/// The store app's own lines: the site is the one the node is registered
/// for, never one the query names.
async fn sync_list(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<SyncQuery>,
) -> Result<Json<Value>, AppError> {
    let origin = super::authenticate_origin(&s, &headers, q.origin_id.trim()).await?;
    let claimed = q
        .site_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let site = match (origin.site_id, claimed) {
        (Some(registered), Some(claimed)) if registered != claimed => {
            return Err(AppError::Forbidden(format!(
                "origin {} speaks for {registered}, not {claimed}",
                origin.origin_id
            )))
        }
        (Some(registered), _) => registered,
        (None, Some(claimed)) => claimed.to_owned(),
        (None, None) => {
            return Err(AppError::Validation(
                "say which store's unmatched sales".into(),
            ))
        }
    };
    let status = infrastructure::unmatched_status(q.status.as_deref())?;
    let rows = infrastructure::list_unmatched_sales(&s.db, status.as_deref(), Some(&site)).await?;
    Ok(Json(json!({ "rows": rows })))
}
