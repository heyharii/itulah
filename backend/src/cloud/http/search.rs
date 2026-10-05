//! `GET /api/v1/search?q=` — find a record from anywhere.
//!
//! Each kind is offered only to a role the same path gate would let read that
//! kind's own list, so the palette cannot show a colleague a record whose
//! screen would answer 403.

use super::auth::{gate_allows, Principal};
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{self as infrastructure, SearchHit},
};
use axum::{
    extract::{Query, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchQuery {
    #[serde(default)]
    pub q: String,
    pub limit: Option<i32>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SearchResults {
    pub items: Vec<SearchHit>,
}

/// Kind → the list route whose gate decides who may see it.
const KINDS: &[(&str, &str)] = &[
    ("purchase_order", "/api/v1/purchase-orders"),
    ("supplier", "/api/v1/suppliers"),
];

pub async fn search(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<SearchResults>, AppError> {
    let mut kinds = Vec::new();
    for (kind, route) in KINDS {
        if gate_allows(&state, "GET", route, principal.role).await {
            kinds.push(*kind);
        }
    }
    let items = infrastructure::global_search(
        &state.db,
        query.q.trim(),
        &kinds,
        query.limit.unwrap_or(20).clamp(1, 50),
    )
    .await?;
    Ok(Json(SearchResults { items }))
}
