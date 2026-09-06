//! The handshake a node performs before its first upload, and what the cloud
//! noticed about the streams it is receiving.
//!
//! # Why the handshake is not authenticated like an operator screen
//!
//! It carries the same per-origin `x-sync-key` `/sync/ingest` carries, and for
//! the same reason: the caller is a shop's own process, not a person with a
//! session, and the answer decides which seqs that shop may write. A node able
//! to negotiate another origin's generation could rotate a healthy shop's
//! stream out from under it — a denial of service against the one shop least
//! able to notice. So the key is checked against the origin being asked about,
//! never against a master credential.
//!
//! # Why the alerts have a screen at all
//!
//! Until now a receiver that spotted a divergence could only log it. A log
//! line on the cloud is not a place a district manager looks, and the fault it
//! reports — a till's database replaced, its new sales landing in seqs the
//! cloud already holds — is invisible from every other angle: the shop's
//! dashboard is green, the backlog is empty, the cycle reports success.

use crate::cloud::{
    application::{AppConfig, AppError, AppState},
    domain::HandshakeRequest,
    postgres as infrastructure,
};
use crate::security;
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

/// Lane S's routes. One call line in `router()` keeps this out of the way of
/// the six thousand lines of route table it would otherwise be threaded
/// through.
///
/// `/sync/origins` is deliberately NOT here: it already exists, and answering
/// the same question from two paths is how two answers start disagreeing. The
/// existing handler was widened instead.
pub fn lane_s_routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/sync/handshake", post(sync_handshake))
        .route("/api/v1/sync/integrity-alerts", get(sync_alerts))
        .route(
            "/api/v1/sync/integrity-alerts/{id}/acknowledge",
            post(sync_acknowledge_alert),
        )
}

/// The same credential check `/sync/ingest` makes, against the origin named in
/// the body rather than a master key.
///
/// A registered origin is accepted ONLY with its own key. An authenticated
/// cloud refuses an unregistered origin outright — the master key provisions,
/// it is not an identity. A cloud with auth disabled keeps the explicit
/// master-key fallback so development rigs still work.
async fn authorize_origin(
    state: &AppState,
    config: &AppConfig,
    headers: &HeaderMap,
    origin_id: &str,
) -> Result<(), AppError> {
    let presented = headers.get("x-sync-key").and_then(|v| v.to_str().ok());
    match infrastructure::origin_credential_digest(&state.db, origin_id).await? {
        Some(digest) => {
            if presented.is_some_and(|key| infrastructure::ingest_key_matches(&digest, key)) {
                Ok(())
            } else {
                Err(AppError::Forbidden(
                    "invalid or missing x-sync-key for this origin".into(),
                ))
            }
        }
        None => {
            if config.jwt_secret.is_some() {
                return Err(AppError::Forbidden(
                    "invalid or missing x-sync-key for this origin".into(),
                ));
            }
            match &config.sync_ingest_key {
                Some(expected)
                    if !presented
                        .is_some_and(|value| security::constant_time_eq(value, expected)) =>
                {
                    Err(AppError::Forbidden("invalid or missing x-sync-key".into()))
                }
                _ => Ok(()),
            }
        }
    }
}

/// "Here is where I think I am." — "Then write into this generation."
async fn sync_handshake(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<HandshakeRequest>,
) -> Result<Json<Value>, AppError> {
    authorize_origin(&s, &s.config, &headers, &request.origin_id).await?;
    let agreement = infrastructure::sync_negotiate_generation(&s.db, &request).await?;
    Ok(Json(serde_json::to_value(&agreement)?))
}

#[derive(Deserialize)]
struct AlertQuery {
    limit: Option<i64>,
}

async fn sync_alerts(
    State(s): State<AppState>,
    Query(q): Query<AlertQuery>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::sync_integrity_alerts(&s.db, q.limit.unwrap_or(100)).await?,
    ))
}

#[derive(Deserialize)]
struct AcknowledgeRequest {
    acknowledged_by: String,
}

async fn sync_acknowledge_alert(
    State(s): State<AppState>,
    Path(id): Path<i64>,
    Json(request): Json<AcknowledgeRequest>,
) -> Result<Json<Value>, AppError> {
    infrastructure::sync_acknowledge_integrity_alert(&s.db, id, &request.acknowledged_by).await?;
    Ok(Json(json!({ "status": "acknowledged", "id": id })))
}
