//! Three lists of what is on offer, across every published book.
//!
//! Thin by design — the whole of the thinking is the `DISTINCT ON` in
//! `postgres/catalogue.rs`, which mirrors how a shop resolves the same three
//! things. These take no parameters: "which promotions exist" has one answer,
//! and a window or a shop filter would invite the caller to believe the list
//! narrows the way the Performa reads do, which it does not.

use crate::cloud::{
    application::{AppError, AppState},
    postgres as infrastructure,
};
use axum::{extract::State, Json};
use serde_json::Value;

pub async fn commercial_rules(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::commercial_rules(&s.db).await?))
}

pub async fn commercial_coupons(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::commercial_coupons(&s.db).await?))
}

pub async fn commercial_campaigns(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::commercial_campaigns(&s.db).await?))
}
