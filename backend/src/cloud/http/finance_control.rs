//! The control panel, the close, and the two statements.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{role_allows, Role},
    postgres::{
        self as infrastructure, BalanceSheet, ControlRow, FinanceCloseReadiness, LedgerTrace,
        ProfitAndLoss, UnitResult,
    },
};
use axum::{
    extract::{Query, State},
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::NaiveDate;
use serde::Deserialize;

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
pub struct AsOfQuery {
    pub as_of: Option<NaiveDate>,
    /// Whose books: a unit id. Absent means the whole company.
    pub unit: Option<String>,
}

pub async fn controls(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<AsOfQuery>,
) -> Result<Json<Vec<ControlRow>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the finance controls")?;
    Ok(Json(
        infrastructure::finance_controls(&state.db, query.as_of).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct MonthQuery {
    pub year: i32,
    pub month: u32,
}

pub async fn close_readiness(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<MonthQuery>,
) -> Result<Json<FinanceCloseReadiness>, AppError> {
    allowed(&principal, Role::Supervisor, "read the month-end checks")?;
    Ok(Json(
        infrastructure::finance_close_readiness(&state.db, query.year, query.month).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct SoftCloseRequest {
    pub year: i32,
    pub month: u32,
}

/// Shut the month to the tills, leaving it open to the accountants.
pub async fn soft_close(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<SoftCloseRequest>,
) -> Result<Json<FinanceCloseReadiness>, AppError> {
    allowed(&principal, Role::Admin, "soft-close a month")?;
    Ok(Json(
        infrastructure::period_soft_close(
            &state.db,
            request.year,
            request.month,
            &principal.username,
        )
        .await?,
    ))
}

pub async fn balance_sheet(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<AsOfQuery>,
) -> Result<Json<BalanceSheet>, AppError> {
    allowed(&principal, Role::Supervisor, "read the balance sheet")?;
    let as_of = query
        .as_of
        .unwrap_or_else(|| chrono::Utc::now().date_naive());
    Ok(Json(
        infrastructure::balance_sheet(&state.db, as_of, query.unit.as_deref()).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct RangeQuery {
    pub from: NaiveDate,
    pub to: NaiveDate,
    /// Whose books: a unit id. Absent means the whole company.
    pub unit: Option<String>,
}

pub async fn profit_and_loss(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<RangeQuery>,
) -> Result<Json<ProfitAndLoss>, AppError> {
    allowed(&principal, Role::Supervisor, "read the profit and loss")?;
    Ok(Json(
        infrastructure::profit_and_loss(&state.db, query.from, query.to, query.unit.as_deref())
            .await?,
    ))
}

/// One row per unit. Their sum is the consolidated result, which is what makes
/// unit reporting and consolidated reporting reconcile by construction.
pub async fn unit_results(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<RangeQuery>,
) -> Result<Json<Vec<UnitResult>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the unit results")?;
    Ok(Json(
        infrastructure::unit_results(&state.db, query.from, query.to).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct DimensionQuery {
    pub dimension: String,
    pub from: chrono::NaiveDate,
    pub to: chrono::NaiveDate,
    /// Whose books: a unit id. Absent means the whole company.
    pub unit: Option<String>,
}

/// The profit and loss cut by one accounting dimension (0470): one row per
/// value, and one for the lines that carry none, so the rows add up.
pub async fn dimension_results(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<DimensionQuery>,
) -> Result<Json<Vec<infrastructure::DimensionResult>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the dimension results")?;
    Ok(Json(
        infrastructure::dimension_results(
            &state.db,
            &query.dimension,
            query.from,
            query.to,
            query.unit.as_deref(),
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct CloseRequest {
    pub year: i32,
    pub month: u32,
    /// Naming a reason is what lets a month close over its own blockers. It is
    /// kept on the period, because somebody will ask.
    #[serde(default)]
    pub reason: Option<String>,
}

/// Close the month, or refuse and name what stands in the way.
pub async fn close_month(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<CloseRequest>,
) -> Result<Json<FinanceCloseReadiness>, AppError> {
    allowed(&principal, Role::Admin, "close a month")?;
    Ok(Json(
        infrastructure::finance_close_month(
            &state.db,
            request.year,
            request.month,
            request.reason.as_deref(),
            &principal.username,
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct TraceQuery {
    pub account: String,
    pub from: NaiveDate,
    pub to: NaiveDate,
    /// Whose books: a unit id. Absent means the whole company.
    pub unit: Option<String>,
    pub limit: Option<i64>,
}

/// Report → GL line → journal → subledger → source document.
pub async fn trace(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<TraceQuery>,
) -> Result<Json<Vec<LedgerTrace>>, AppError> {
    allowed(
        &principal,
        Role::Supervisor,
        "follow a figure to its documents",
    )?;
    Ok(Json(
        infrastructure::ledger_trace(
            &state.db,
            &query.account,
            query.from,
            query.to,
            query.unit.as_deref(),
            query.limit.unwrap_or(200),
        )
        .await?,
    ))
}

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/finance/controls", get(controls))
        .route("/api/v1/finance/close/readiness", get(close_readiness))
        .route("/api/v1/finance/close/soft", post(soft_close))
        .route("/api/v1/finance/close/month", post(close_month))
        .route("/api/v1/finance/reports/trace", get(trace))
        .route("/api/v1/finance/reports/balance-sheet", get(balance_sheet))
        .route(
            "/api/v1/finance/reports/profit-and-loss",
            get(profit_and_loss),
        )
        .route("/api/v1/finance/reports/unit-results", get(unit_results))
        .route("/api/v1/finance/reports/dimension-results", get(dimension_results))
}
