//! A member's own points and purchases, over HTTP.
//!
//! Read-only, all three of them. The customer surface shows what a shop has
//! already reported and offers no way to change it — points are earned at a
//! till by buying something, and no screen a shopper holds should be able to
//! mint them.
//!
//! The member is named in the path rather than taken from the session, and
//! that is the honest description of where this stands: there is no customer
//! identity in this system yet, so there is nothing on a session to read. Until
//! there is, these routes sit behind the ordinary node session like every other
//! route here — a member id in the path is an argument, not a credential, and
//! must never be treated as one.

use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, CustomerSummary, CustomerTransactionDetail,
        CustomerTransactionPage, CustomerTransactionsQuery,
    },
};
use axum::{
    extract::{Path, Query, State},
    Json,
};
use uuid::Uuid;

/// What this member has earned and spent, all told.
pub async fn summary(
    State(state): State<AppState>,
    Path(customer_id): Path<String>,
) -> Result<Json<CustomerSummary>, AppError> {
    Ok(Json(
        infrastructure::customer_summary(&state.db, &customer_id).await?,
    ))
}

/// Their purchases, newest first, a page at a time.
pub async fn transactions(
    State(state): State<AppState>,
    Path(customer_id): Path<String>,
    Query(query): Query<CustomerTransactionsQuery>,
) -> Result<Json<CustomerTransactionPage>, AppError> {
    Ok(Json(
        infrastructure::customer_transactions(&state.db, &customer_id, query).await?,
    ))
}

/// One receipt of theirs.
pub async fn transaction(
    State(state): State<AppState>,
    Path((customer_id, sale_id)): Path<(String, Uuid)>,
) -> Result<Json<CustomerTransactionDetail>, AppError> {
    Ok(Json(
        infrastructure::customer_transaction(&state.db, &customer_id, sale_id).await?,
    ))
}
