//! The prepaid surface: a schedule, its months, and the control account.
//!
//! Every write goes through `postgres::prepaid`, which goes through
//! `poster::post`. Nothing here reaches the journal on its own.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{role_allows, Role},
    postgres::{
        self as infrastructure, CreatePrepaidScheduleRequest, PrepaidAllocationRequest,
        PrepaidAllocationRun, PrepaidReconciliationRow, PrepaidSchedule, PrepaidScheduleDocument,
    },
};
use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::NaiveDate;
use serde::Deserialize;
use uuid::Uuid;

fn allowed(principal: &Principal, needed: Role, act: &str) -> Result<(), AppError> {
    if role_allows(needed, principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {act}",
        principal.username
    )))
}

#[derive(Debug, Deserialize)]
pub struct PrepaidQuery {
    pub site: Option<String>,
    pub status: Option<String>,
    pub limit: Option<i64>,
    /// `true` answers a keyset page in an envelope (`PrepaidSchedulePage`)
    /// rather than the bare array. A `cursor` implies it.
    pub paged: Option<bool>,
    pub cursor: Option<String>,
    /// Paged only: the month (any day in it) whose due schedules are counted
    /// into `due_in_period`.
    pub period: Option<NaiveDate>,
}

/// Two answers from one route. Asked plainly it is the bare array it has
/// always been — the newest `limit`, 100 unless asked. `paged=true` (or a
/// `cursor`) answers `PrepaidSchedulePage`: a keyset page with `next_cursor`,
/// and the card figures over every schedule the filters match.
pub async fn schedules(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<PrepaidQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    allowed(&principal, Role::Supervisor, "read prepaid schedules")?;
    if query.paged == Some(true) || query.cursor.is_some() {
        let page = infrastructure::prepaid_schedule_page(
            &state.db,
            query.site.as_deref(),
            query.status.as_deref(),
            query.period,
            query.cursor.as_deref(),
            query.limit,
        )
        .await?;
        return Ok(Json(serde_json::to_value(page)?));
    }
    let rows: Vec<PrepaidSchedule> = infrastructure::prepaid_schedules(
        &state.db,
        query.site.as_deref(),
        query.status.as_deref(),
        query.limit.unwrap_or(100),
    )
    .await?;
    Ok(Json(serde_json::to_value(rows)?))
}

pub async fn schedule(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(schedule_id): Path<Uuid>,
) -> Result<Json<PrepaidScheduleDocument>, AppError> {
    allowed(&principal, Role::Supervisor, "read a prepaid schedule")?;
    Ok(Json(
        infrastructure::prepaid_schedule_detail(&state.db, schedule_id).await?,
    ))
}

/// Attach a schedule to a document whose debit has already posted.
pub async fn create_schedule(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<CreatePrepaidScheduleRequest>,
) -> Result<Json<PrepaidScheduleDocument>, AppError> {
    allowed(&principal, Role::Admin, "write a prepaid schedule")?;
    Ok(Json(
        infrastructure::prepaid_schedule_create(&state.db, &request, &principal.username).await?,
    ))
}

/// Post one month of every schedule that covers it. Repeatable.
pub async fn allocate(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<PrepaidAllocationRequest>,
) -> Result<Json<PrepaidAllocationRun>, AppError> {
    allowed(&principal, Role::Admin, "allocate a month of prepayments")?;
    Ok(Json(
        infrastructure::prepaid_allocate(&state.db, &request, &principal.username).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct CancelScheduleRequest {
    pub reason: String,
}

pub async fn cancel_schedule(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(schedule_id): Path<Uuid>,
    Json(request): Json<CancelScheduleRequest>,
) -> Result<Json<PrepaidScheduleDocument>, AppError> {
    allowed(&principal, Role::Admin, "stop a prepaid schedule")?;
    Ok(Json(
        infrastructure::prepaid_schedule_cancel(
            &state.db,
            schedule_id,
            &request.reason,
            &principal.username,
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct ReconciliationQuery {
    pub as_of: Option<NaiveDate>,
}

/// The control account: the ledger against the open schedules.
pub async fn reconciliation(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ReconciliationQuery>,
) -> Result<Json<Vec<PrepaidReconciliationRow>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the prepaid control")?;
    Ok(Json(
        infrastructure::prepaid_reconciliation(&state.db, query.as_of).await?,
    ))
}

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route(
            "/api/v1/finance/prepaid/schedules",
            get(schedules).post(create_schedule),
        )
        .route("/api/v1/finance/prepaid/schedules/{id}", get(schedule))
        .route(
            "/api/v1/finance/prepaid/schedules/{id}/cancel",
            post(cancel_schedule),
        )
        .route("/api/v1/finance/prepaid/allocate", post(allocate))
        .route(
            "/api/v1/finance/prepaid/reconciliation",
            get(reconciliation),
        )
}
