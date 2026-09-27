//! Transaction categories, and what can be done with one line of a statement.
//!
//! # RBAC comes from the path, and that is deliberate
//!
//! Everything here sits under `/api/v1/finance`, where
//! `domain::auth::required_role` already makes every GET a SUPERVISOR read and
//! every mutation an ADMIN act. Categorising a bank line posts money, so it is
//! ADMIN by the same rule that makes approving a cash document ADMIN — one rule
//! rather than two that somebody has to keep in agreement.
//!
//! Reading the category list is a SUPERVISOR read and that is right rather than
//! merely convenient: the list is where a manager finds out that "Gaji" is not
//! something they may choose, and a list they cannot open teaches them nothing.
//! It names no balances and no amounts.
//!
//! # Why the options endpoint is a GET that computes
//!
//! It scores the whole statement to answer about one line, which looks like
//! work for a POST. It is a GET because it changes nothing and because a screen
//! opens it by navigating — and it scores the whole statement because scoring
//! one line alone would offer a candidate another line has a better claim on,
//! which `banking::suggest_matches` explains at length.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, BankLineOptions, CashDocumentRow, CategoriseBankLineRequest,
        RecordTransactionCategoryRequest, TransactionCategoryRow,
    },
};
use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct CategoryQuery {
    /// Which unit's books the resolved account is read for. A category means
    /// the same thing everywhere and lands on a different leaf in each of the
    /// client's fourteen, so this decides what `account_code` comes back as —
    /// never which categories exist. Head office's when absent.
    pub unit_id: Option<String>,
    /// `OUTFLOW` or `INFLOW`. Returns the categories that can explain money
    /// going that way, which always includes the ones that go both.
    pub direction: Option<String>,
    pub family: Option<String>,
    /// `BANK`, `CASH`, `PETTY_CASH` or `STORE`.
    pub domain: Option<String>,
    /// Retired categories are hidden by default and askable for: a posted
    /// document names the category it was explained by, and one somebody
    /// turned off is still the answer to "what did this mean".
    pub include_retired: Option<bool>,
}

pub async fn transaction_categories(
    State(state): State<AppState>,
    Query(query): Query<CategoryQuery>,
) -> Result<Json<Vec<TransactionCategoryRow>>, AppError> {
    Ok(Json(
        infrastructure::transaction_category_list(
            &state.db,
            query.unit_id.as_deref(),
            query.direction.as_deref(),
            query.family.as_deref(),
            query.domain.as_deref(),
            query.include_retired.unwrap_or(false),
        )
        .await?,
    ))
}

/// The categories whose meaning nobody has pointed at an account yet.
///
/// The list somebody works through on the Account Map screen before any of this
/// can be used. It exists as its own route because the alternative is a person
/// discovering the gap while reading a statement, one category at a time, each
/// time as a refusal.
pub async fn unmapped_transaction_categories(
    State(state): State<AppState>,
    Query(query): Query<CategoryQuery>,
) -> Result<Json<Vec<TransactionCategoryRow>>, AppError> {
    Ok(Json(
        infrastructure::transaction_category_unmapped(&state.db, query.unit_id.as_deref()).await?,
    ))
}

pub async fn transaction_category(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Query(query): Query<CategoryQuery>,
) -> Result<Json<TransactionCategoryRow>, AppError> {
    Ok(Json(
        infrastructure::transaction_category_read(&state.db, &code, query.unit_id.as_deref())
            .await?,
    ))
}

pub async fn record_transaction_category(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordTransactionCategoryRequest>,
) -> Result<Json<TransactionCategoryRow>, AppError> {
    Ok(Json(
        infrastructure::transaction_category_record(&state.db, &request, &principal.username)
            .await?,
    ))
}

/// Retire one. Never delete: a rule and a posted document both name it.
pub async fn deactivate_transaction_category(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
) -> Result<Json<TransactionCategoryRow>, AppError> {
    Ok(Json(
        infrastructure::transaction_category_deactivate(&state.db, &code, &principal.username)
            .await?,
    ))
}

/// The three doors out of one bank line, matches first.
pub async fn bank_line_options(
    State(state): State<AppState>,
    Path(line_id): Path<Uuid>,
) -> Result<Json<BankLineOptions>, AppError> {
    Ok(Json(
        infrastructure::bank_line_options(&state.db, line_id).await?,
    ))
}

/// Take the third door. Creates a cash document and posts it; never a journal.
pub async fn categorise_bank_line(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(line_id): Path<Uuid>,
    Json(request): Json<CategoriseBankLineRequest>,
) -> Result<Json<CashDocumentRow>, AppError> {
    Ok(Json(
        infrastructure::bank_line_categorise(&state.db, line_id, &request, &principal.username)
            .await?,
    ))
}

/// Every route this lane adds, in one function called once from `router()`.
///
/// Gathered the way `money::lane_c_routes` is and for the same reason: one
/// subject, and one call line rather than a dozen routes spliced into a
/// four-hundred-line builder several sessions are editing at once.
pub fn lane_n_routes(router: Router<AppState>) -> Router<AppState> {
    router
        // The master. `unmapped` before `{code}` reads better than it needs to:
        // matchit gives a static segment priority over a parameter, so the
        // order here is for whoever reads it rather than for the router.
        .route(
            "/api/v1/finance/transaction-categories",
            get(transaction_categories).post(record_transaction_category),
        )
        .route(
            "/api/v1/finance/transaction-categories/unmapped",
            get(unmapped_transaction_categories),
        )
        .route(
            "/api/v1/finance/transaction-categories/{code}",
            get(transaction_category).delete(deactivate_transaction_category),
        )
        // One line, and what may be done with it. `options` is the whole of
        // the design: matches, then documents to create, then categories.
        .route(
            "/api/v1/finance/bank-lines/{id}/options",
            get(bank_line_options),
        )
        .route(
            "/api/v1/finance/bank-lines/{id}/categorise",
            post(categorise_bank_line),
        )
}
