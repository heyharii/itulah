//! Shop servers reporting in, and the hub's Fleet page reading them.
//!
//! `POST /api/v1/sync/heartbeat` is a machine route: the node proves itself
//! with its own `x-sync-key`, exactly as it does for `/sync/ingest`
//! (`authenticate_origin`), and can only ever report as itself. The two reads
//! are Admin routes under `/api/v1/sync/nodes`. See `postgres/node_health.rs`
//! and `sync/node_status.rs`.

use crate::cloud::{
    application::{AppError, AppState},
    postgres as infrastructure,
};
use crate::sync::node_status::NodeStatus;
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct Heartbeat {
    pub origin_id: String,
    pub status: NodeStatus,
}

pub async fn heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(beat): Json<Heartbeat>,
) -> Result<Json<Value>, AppError> {
    let origin = super::authenticate_origin(&state, &headers, &beat.origin_id).await?;
    // A registered origin only; an unregistered one (development without
    // auth) has nowhere to be filed on the Fleet page.
    if origin.site_id.is_none() {
        return Err(AppError::Forbidden(
            "heartbeats are accepted from registered shop servers only".into(),
        ));
    }
    let received = infrastructure::record_heartbeat(&state.db, &origin.origin_id, &beat.status).await?;
    Ok(Json(json!({ "server_time": received })))
}

pub async fn nodes(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(json!({ "items": infrastructure::fleet(&state.db).await? })))
}

pub async fn incidents(
    State(state): State<AppState>,
    Path(origin_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(json!({
        "items": infrastructure::node_incidents(&state.db, origin_id.trim()).await?
    })))
}
