//! What MD changed that the Gudang has not acknowledged yet (owner, 10 Oct
//! 2026): an allotment cancelled or edited while the warehouse works on it
//! never leaves the board unseen. One item per allotment × shop, built from
//! MD's own amendments (`allotment_amendment`, 0938) that have no
//! acknowledgement (`allotment_amendment_ack`, 0964).
//!
//! The board tags the shop's card with it ("Added +30", "300 → 250",
//! "Cancelled"), the picklist sheet raises a banner, and one tap — "Got it",
//! or "Remove" for a picklist cancelled before anything was taken —
//! acknowledges every change of that allotment × shop at once. MD's History
//! then says who did and when.

use super::common;
use crate::cloud::http::auth::Principal;
use crate::cloud::{AppError, AppState};
use axum::{
    extract::State,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::BTreeMap;
use uuid::Uuid;

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/dc/changes", get(changes))
        .route("/api/v1/dc/changes/acknowledge", post(acknowledge))
}

// ---------------------------------------------------------------------------
// The wire (frontend-hub/src/lib/operations/changes.ts)
// ---------------------------------------------------------------------------

/// One line MD changed, from what it was before the first change the
/// warehouse has not seen to what it is now.
#[derive(Clone, Debug, Serialize)]
pub struct DcChangeLine {
    pub allotment_line_id: Uuid,
    pub sku_code: String,
    /// The latest change's kind: ADD, REDUCE or CANCEL.
    pub kind: String,
    pub was: i64,
    pub now: i64,
}

/// Everything MD changed on one allotment for one shop, not yet seen.
#[derive(Clone, Debug, Serialize)]
pub struct DcChange {
    pub allotment_id: Uuid,
    pub allotment_number: String,
    pub destination_id: String,
    /// MD cancelled the whole allotment.
    pub cancelled: bool,
    pub was_total: i64,
    pub now_total: i64,
    pub lines: Vec<DcChangeLine>,
    /// Who made the latest change, and when.
    pub by: String,
    pub at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AcknowledgeRequest {
    pub allotment_id: Uuid,
    pub destination_id: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub idempotency_key: Option<String>,
}

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

async fn changes(State(state): State<AppState>) -> Result<Json<serde_json::Value>, AppError> {
    common::require_hosted()?;
    // Oldest first, so a line's `was` is the first unseen change's `before`
    // and its `now` the last one's `after`.
    let rows = sqlx::query(
        "SELECT allotment.id AS allotment_id, allotment.allotment_number,
                allotment.cancelled_at IS NOT NULL AS cancelled,
                line.destination_id, amendment.allotment_line_id, sku.sku_code,
                amendment.kind, amendment.target_before, amendment.target_after,
                amendment.actor_id, amendment.created_at
           FROM allotment_amendment amendment
           JOIN allotment ON allotment.id = amendment.allotment_id
                         AND allotment.activation_target_origin_id IS NULL
           JOIN allotment_line line ON line.id = amendment.allotment_line_id
           JOIN sku ON sku.id = line.sku_id
           LEFT JOIN allotment_amendment_ack ack ON ack.amendment_id = amendment.id
          WHERE ack.amendment_id IS NULL
          ORDER BY amendment.created_at, amendment.id",
    )
    .fetch_all(&state.db)
    .await?;

    let mut items: BTreeMap<(Uuid, String), DcChange> = BTreeMap::new();
    for row in rows {
        let allotment_id: Uuid = row.try_get("allotment_id")?;
        let destination_id: String = row.try_get("destination_id")?;
        let line_id: Uuid = row.try_get("allotment_line_id")?;
        let kind: String = row.try_get("kind")?;
        let before: i64 = row.try_get("target_before")?;
        let after: i64 = row.try_get("target_after")?;
        let by: String = row.try_get("actor_id")?;
        let at: DateTime<Utc> = row.try_get("created_at")?;
        let item = items
            .entry((allotment_id, destination_id.clone()))
            .or_insert_with(|| DcChange {
                allotment_id,
                allotment_number: row.get("allotment_number"),
                destination_id,
                cancelled: row.get("cancelled"),
                was_total: 0,
                now_total: 0,
                lines: Vec::new(),
                by: by.clone(),
                at,
            });
        item.by = by;
        item.at = at;
        match item
            .lines
            .iter_mut()
            .find(|line| line.allotment_line_id == line_id)
        {
            Some(line) => {
                line.now = after;
                line.kind = kind;
            }
            None => item.lines.push(DcChangeLine {
                allotment_line_id: line_id,
                sku_code: row.get("sku_code"),
                kind,
                was: before,
                now: after,
            }),
        }
    }
    let items: Vec<DcChange> = items
        .into_values()
        .map(|mut item| {
            item.was_total = item.lines.iter().map(|line| line.was).sum();
            item.now_total = item.lines.iter().map(|line| line.now).sum();
            item
        })
        .collect();
    Ok(Json(serde_json::json!({ "items": items })))
}

async fn acknowledge(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<AcknowledgeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    common::require_hosted()?;
    let actor = principal.username.trim().to_owned();
    if actor.is_empty() {
        return Err(AppError::Validation("actor is required".into()));
    }
    let destination = request.destination_id.trim();
    if destination.is_empty() {
        return Err(AppError::Validation("destination_id is required".into()));
    }
    // Every unseen change of this allotment for this shop at once; a second
    // tap finds nothing left and answers 0, so a retry is harmless.
    let acknowledged = sqlx::query(
        "INSERT INTO allotment_amendment_ack (amendment_id, actor_id, acknowledged_at)
         SELECT amendment.id, $3, $4
           FROM allotment_amendment amendment
           JOIN allotment_line line ON line.id = amendment.allotment_line_id
          WHERE amendment.allotment_id = $1 AND line.destination_id = $2
         ON CONFLICT (amendment_id) DO NOTHING",
    )
    .bind(request.allotment_id)
    .bind(destination)
    .bind(&actor)
    .bind(state.clock.now())
    .execute(&state.db)
    .await?
    .rows_affected();
    Ok(Json(serde_json::json!({ "acknowledged": acknowledged })))
}
