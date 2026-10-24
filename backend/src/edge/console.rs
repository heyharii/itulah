//! The shop's console: `http://localhost:8082/console`.
//!
//! What the person at the server PC sees — the tray link and the Start-menu
//! shortcut open it. One page, live, answering the questions a support call
//! starts with: is it working, is it reaching head office, what happened to it
//! today, and are drawers open. Laid out after the mockups on the
//! "Store Server — UI Kondisi" canvas and `retail/server-electron`'s home.
//!
//! # Loopback only
//!
//! The console syncs, diagnoses and backs up the node, so it answers only to
//! the machine it runs on. It does not restart it: restarting, updating and
//! removing a store's server are head office's (owner, 24 Oct 2026), from the
//! store's Server tab. Anyone who can sit at the server PC can pull its plug anyway; a
//! till on the shop's Wi-Fi cannot. Head office sees the same facts through
//! the heartbeat instead (`edge/heartbeat.rs`).

use crate::edge::{diagnose, status::StatusSource};
use crate::sync::node_status::assess;
use axum::{
    extract::{ConnectInfo, State},
    http::StatusCode,
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde_json::json;
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tokio::sync::watch;

/// Why the node is being asked to stop. `Restart` makes the process exit
/// non-zero after a clean stop, so the supervisor starts it again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    Running,
    Stop,
    Restart,
}

#[derive(Clone)]
pub struct Console {
    pub source: Arc<StatusSource>,
    pub data_dir: Option<PathBuf>,
    pub stop: Arc<watch::Sender<StopReason>>,
}

fn not_here() -> Response {
    (
        StatusCode::FORBIDDEN,
        "The console answers only on the server machine itself (localhost).",
    )
        .into_response()
}

async fn page(ConnectInfo(from): ConnectInfo<SocketAddr>) -> Response {
    if !from.ip().is_loopback() {
        return not_here();
    }
    Html(include_str!("console.html")).into_response()
}

async fn status(
    ConnectInfo(from): ConnectInfo<SocketAddr>,
    State(console): State<Console>,
) -> Response {
    if !from.ip().is_loopback() {
        return not_here();
    }
    let source = console.source.clone();
    match tokio::task::spawn_blocking(move || source.collect()).await {
        Ok(status) => {
            let assessment = assess(&status, Utc::now());
            Json(json!({ "status": status, "assessment": assessment })).into_response()
        }
        Err(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn sync_now(
    ConnectInfo(from): ConnectInfo<SocketAddr>,
    State(console): State<Console>,
) -> Response {
    if !from.ip().is_loopback() {
        return not_here();
    }
    match &console.source.sync {
        Some(sync) => {
            sync.trigger();
            Json(json!({ "message": "Sync started." })).into_response()
        }
        None => (
            StatusCode::CONFLICT,
            Json(json!({ "error": "This server is not connected to head office yet." })),
        )
            .into_response(),
    }
}

async fn run_diagnose(
    ConnectInfo(from): ConnectInfo<SocketAddr>,
    State(console): State<Console>,
) -> Response {
    if !from.ip().is_loopback() {
        return not_here();
    }
    let role = console
        .source
        .connection
        .lock()
        .map(|guard| crate::edge::node::resident_role(&guard))
        .unwrap_or(crate::edge::EdgeRole::Store);
    let report = diagnose::diagnose(role, console.data_dir.as_deref()).await;
    let saved = diagnose::save(&report);
    Json(json!({ "report": report, "saved_to": saved })).into_response()
}

async fn backup_now(
    ConnectInfo(from): ConnectInfo<SocketAddr>,
    State(console): State<Console>,
) -> Response {
    if !from.ip().is_loopback() {
        return not_here();
    }
    let Some(dir) = console.data_dir.clone() else {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "This server has no data folder." })),
        )
            .into_response();
    };
    let connection = console.source.connection.clone();
    match tokio::task::spawn_blocking(move || crate::edge::backup::take(&connection, &dir)).await {
        Ok(Ok(path)) => {
            Json(json!({ "message": format!("Backup saved: {}", path.display()) })).into_response()
        }
        Ok(Err(error)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Backup failed: {error}") })),
        )
            .into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

/// The console's routes, to be merged beside the node's own.
pub fn router(console: Console) -> Router {
    Router::new()
        .route("/console", get(page))
        .route("/console/status", get(status))
        .route("/console/sync", post(sync_now))
        .route("/console/diagnose", post(run_diagnose))
        .route("/console/backup", post(backup_now))
        .with_state(console)
}
