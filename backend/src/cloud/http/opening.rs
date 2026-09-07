//! The cutover surface: three imports, each rehearsed by default, and the page
//! somebody signs it off from.
//!
//! # The role, and why it is the strictest one there is
//!
//! Every handler asks for [`actions::FINANCE_OPENING_IMPORT`], which is not in
//! the supervisor list and therefore resolves to `Admin`. That is the same
//! answer `required_role` gives a POST under `/api/v1/finance/` from the path
//! alone, and the key is asked for anyway, for the reason `finance.rs` gives:
//! a path cannot say that importing a beginning and reading a trial balance are
//! different acts. The key exists so that this one can be withheld from
//! somebody who legitimately holds every other finance grant.
//!
//! It deserves its own key more than most. A cutover is the only act in the
//! system that writes the beginning of every balance at once, and the opening
//! stock in particular is priced exactly once — after the first sale on the
//! first morning the FIFO queue is already being consumed and there is no
//! second chance at the layer it started from.
//!
//! # `commit` defaults to false
//!
//! Leaving it out rehearses: the import runs in full, inside a transaction, and
//! rolls back. The answer is the same shape either way, with `committed` saying
//! which it was. See `postgres::opening` for why the rehearsal is the run
//! rather than a prediction of it.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{actions, required_role_for_action, role_allows},
    postgres::{
        self as infrastructure, OpeningBalanceOutcome, OpeningCutoverReport, OpeningImportRequest,
        OpeningStockOutcome, OpeningSubledgerOutcome,
    },
};
use axum::{
    extract::{Query, State},
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::NaiveDate;
use serde::Deserialize;

/// The gate every handler here opens first.
///
/// Copied rather than shared, exactly as `finance`, `pay`, `roster`, `overtime`
/// and `leave` each carry their own.
fn require(principal: &Principal, action_key: &str) -> Result<(), AppError> {
    if role_allows(required_role_for_action(action_key), principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {action_key}",
        principal.username
    )))
}

pub fn lane_l_routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/finance/opening/balances", post(import_balances))
        .route("/api/v1/finance/opening/stock", post(import_stock))
        .route("/api/v1/finance/opening/subledger", post(import_subledger))
        .route("/api/v1/finance/opening/report", get(cutover_report))
}

/// Bring the client's closing trial balance in as this ledger's opening one.
///
/// One balanced entry per site, dated the cutover, `source_kind = 'OPENING'`.
pub async fn import_balances(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<OpeningImportRequest>,
) -> Result<Json<OpeningBalanceOutcome>, AppError> {
    require(&principal, actions::FINANCE_OPENING_IMPORT)?;
    Ok(Json(
        infrastructure::opening_import_balances(&state.db, &request, &principal.username).await?,
    ))
}

/// Price the shelf and give the FIFO queue a beginning.
pub async fn import_stock(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<OpeningImportRequest>,
) -> Result<Json<OpeningStockOutcome>, AppError> {
    require(&principal, actions::FINANCE_OPENING_IMPORT)?;
    Ok(Json(
        infrastructure::opening_import_stock(&state.db, &request, &principal.username).await?,
    ))
}

/// Open the unpaid bills and the outstanding acquirer receivables.
pub async fn import_subledger(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<OpeningImportRequest>,
) -> Result<Json<OpeningSubledgerOutcome>, AppError> {
    require(&principal, actions::FINANCE_OPENING_IMPORT)?;
    Ok(Json(
        infrastructure::opening_import_subledger(&state.db, &request, &principal.username).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct ReportQuery {
    /// The cutover the report is about. Required: there is no "the" cutover to
    /// default to, and a phased move has one per wave.
    pub cutover_date: NaiveDate,
}

/// One page: is every equation balanced, what did not map, and what stock was
/// valued by fallback.
///
/// A read, and asked for under the import's own key rather than
/// [`actions::FINANCE_LEDGER_READ`]. The list of fallback-priced stock is the
/// list of figures somebody made up, and it is not an operational read.
pub async fn cutover_report(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ReportQuery>,
) -> Result<Json<OpeningCutoverReport>, AppError> {
    require(&principal, actions::FINANCE_OPENING_IMPORT)?;
    Ok(Json(
        infrastructure::opening_cutover_report(&state.db, query.cutover_date).await?,
    ))
}
