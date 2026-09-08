//! The screen behind the mail gateway: the rules, the log, and a button.
//!
//! Five endpoints, and the interesting one is the last. `run` polls the source
//! once, on demand, and returns what happened — because the alternative for
//! somebody setting a rule up is to save it, wait five minutes, reload a log,
//! and guess. A mapping is got right by trying it, and this is what makes
//! trying it cost a second.
//!
//! It is deliberately the same code path the timer takes. A "test" button that
//! ran a different pass would be a second implementation of the thing it is
//! meant to give confidence in.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    intake::{self, Gateway},
    postgres::{
        self as infrastructure, BankStatementSourceRow, SaveStatementSourceRequest,
        StatementIntakeRow,
    },
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

pub async fn statement_sources(
    State(state): State<AppState>,
) -> Result<Json<Vec<BankStatementSourceRow>>, AppError> {
    Ok(Json(
        infrastructure::list_statement_sources(&state.db).await?,
    ))
}

pub async fn create_statement_source(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<SaveStatementSourceRequest>,
) -> Result<Json<Value>, AppError> {
    let source_id =
        infrastructure::save_statement_source(&state.db, None, &request, &principal.username)
            .await?;
    Ok(Json(json!({ "source_id": source_id })))
}

pub async fn update_statement_source(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(source_id): Path<Uuid>,
    Json(request): Json<SaveStatementSourceRequest>,
) -> Result<Json<Value>, AppError> {
    let source_id = infrastructure::save_statement_source(
        &state.db,
        Some(source_id),
        &request,
        &principal.username,
    )
    .await?;
    Ok(Json(json!({ "source_id": source_id })))
}

pub async fn delete_statement_source(
    State(state): State<AppState>,
    Path(source_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    infrastructure::delete_statement_source(&state.db, source_id).await?;
    Ok(Json(json!({ "deleted": true })))
}

#[derive(Debug, Deserialize)]
pub struct IntakeQuery {
    pub limit: Option<i64>,
}

pub async fn statement_intake_log(
    State(state): State<AppState>,
    Query(query): Query<IntakeQuery>,
) -> Result<Json<Vec<StatementIntakeRow>>, AppError> {
    Ok(Json(
        infrastructure::recent_statement_intake(&state.db, query.limit.unwrap_or(100)).await?,
    ))
}

/// What one pass did, in the shape a screen can render without arithmetic.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct IntakeRunOutcome {
    /// Which mailbox or folder was polled. Named in the answer because the
    /// commonest cause of "it imported nothing" is that this node is polling
    /// somewhere other than where the operator thinks.
    pub source: String,
    pub messages: i64,
    pub attachments: i64,
    pub already_seen: i64,
    pub ingested: i64,
    pub lines: i64,
    pub skipped: i64,
    pub failed: i64,
}

/// Poll now.
///
/// A configuration error — not a silent success — when this node has no source
/// configured: "nothing happened" and "nothing could have happened" are
/// different answers, and only one of them means somebody should go and look at
/// the environment.
pub async fn run_statement_intake(
    State(state): State<AppState>,
) -> Result<Json<IntakeRunOutcome>, AppError> {
    let Some(source) = intake::source_from_env() else {
        return Err(AppError::Configuration(
            "this node polls no mailbox and watches no folder; set STATEMENT_IMAP_USER or \
             STATEMENT_INTAKE_DIR"
                .into(),
        ));
    };
    let gateway = Gateway::new(state.db.clone(), source).with_archive(state.attachments.clone());
    let describes = gateway.describe();
    let stats = gateway.run_once().await?;
    Ok(Json(IntakeRunOutcome {
        source: describes,
        messages: stats.messages as i64,
        attachments: stats.attachments as i64,
        already_seen: stats.already_seen as i64,
        ingested: stats.ingested as i64,
        lines: stats.lines as i64,
        skipped: stats.skipped as i64,
        failed: stats.failed as i64,
    }))
}
