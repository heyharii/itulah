//! The sales-posting surface: a day of takings, generated, posted, corrected.
//!
//! Every write goes through `postgres::sales_posting`, which goes through
//! `poster::post`, so there is still exactly one thing that decides what a
//! valid journal entry is.
//!
//! # About the role checks
//!
//! `domain::auth::required_role` already puts the whole of `/api/v1/finance`
//! behind SUPERVISOR to read and ADMIN to write, and the middleware enforces
//! it before a handler runs. The checks below are deliberately not redundant
//! with that: they are here so that this module's rules survive somebody
//! adding a route under a different prefix, and so the refusal names the
//! person and the act rather than a role — "budi may not post a day's
//! takings" is a sentence somebody can act on, where "this action requires the
//! ADMIN role" sends them to ask who has it.
//!
//! The three levels this system has are a compromise and `domain::auth` says
//! so at length. Posting a day of revenue is exactly the act that wants a
//! maker/checker split; it does not have one yet, and generate/post being two
//! separate acts by two possible people is as close as this gets.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{role_allows, Role},
    postgres::{
        self as infrastructure, GenerateSalesDaysRequest, GenerateSalesPostingRequest,
        GeneratedDay, RetenderOutcome, RetenderRequest, ReverseSalesPostingRequest, SalesPosting,
        SalesPostingDocument,
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

/// Refuse, and say who and what rather than which role.
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
pub struct SalesPostingQuery {
    pub site: Option<String>,
    /// `2026-09` or `2026-09-01`; both mean September.
    pub month: Option<String>,
    pub limit: Option<i64>,
}

/// `2026-09` is what a month picker sends; `2026-09-01` is what a date input
/// sends. Both name the same month, and refusing one of them would be a
/// distinction only the server can see.
fn month_of(raw: &str) -> Result<NaiveDate, AppError> {
    let trimmed = raw.trim();
    if let Ok(date) = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        return Ok(date);
    }
    NaiveDate::parse_from_str(&format!("{trimmed}-01"), "%Y-%m-%d").map_err(|_| {
        AppError::Validation(format!(
            "{trimmed:?} is not a month; write it as 2026-09 or 2026-09-01"
        ))
    })
}

pub async fn sales_postings(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<SalesPostingQuery>,
) -> Result<Json<Vec<SalesPosting>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the day's takings")?;
    let month = query.month.as_deref().map(month_of).transpose()?;
    Ok(Json(
        infrastructure::sales_postings(
            &state.db,
            query
                .site
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty()),
            month,
            query.limit.unwrap_or(200),
        )
        .await?,
    ))
}

pub async fn sales_posting_detail(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(posting_id): Path<Uuid>,
) -> Result<Json<SalesPostingDocument>, AppError> {
    allowed(&principal, Role::Supervisor, "read the day's takings")?;
    Ok(Json(
        infrastructure::sales_posting_detail(&state.db, posting_id).await?,
    ))
}

/// Derive one shop's day. Repeatable: it replaces a draft in place.
pub async fn sales_posting_generate(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<GenerateSalesPostingRequest>,
) -> Result<Json<SalesPostingDocument>, AppError> {
    allowed(&principal, Role::Supervisor, "generate a day's takings")?;
    Ok(Json(
        infrastructure::sales_posting_generate(&state.db, &request, &principal.username).await?,
    ))
}

/// Derive every shop and day that traded and has no posted document.
///
/// Named for closed shifts in the brief and swept over trading days instead,
/// because shifts live in each shop's SQLite and nothing syncs them here yet.
/// The two sets are the same for a shop that closes properly.
pub async fn sales_posting_generate_days(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<GenerateSalesDaysRequest>,
) -> Result<Json<Vec<GeneratedDay>>, AppError> {
    allowed(
        &principal,
        Role::Supervisor,
        "generate the estate's takings",
    )?;
    Ok(Json(
        infrastructure::sales_posting_generate_days(&state.db, &request, &principal.username)
            .await?,
    ))
}

/// Commit a generated day to the books. Once.
pub async fn sales_posting_post(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(posting_id): Path<Uuid>,
) -> Result<Json<SalesPostingDocument>, AppError> {
    allowed(
        &principal,
        Role::Admin,
        "post a day's takings to the ledger",
    )?;
    Ok(Json(
        infrastructure::sales_posting_post(&state.db, posting_id, &principal.username).await?,
    ))
}

/// Unwind a posted day, so it can be generated afresh.
pub async fn sales_posting_reverse(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(posting_id): Path<Uuid>,
    Json(request): Json<ReverseSalesPostingRequest>,
) -> Result<Json<SalesPostingDocument>, AppError> {
    allowed(&principal, Role::Admin, "reverse a posted day")?;
    Ok(Json(
        infrastructure::sales_posting_reverse(&state.db, posting_id, &request, &principal.username)
            .await?,
    ))
}

/// Move a settled tender to the acquirer or method that actually took it.
pub async fn retender_tender(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(tender_id): Path<Uuid>,
    Json(request): Json<RetenderRequest>,
) -> Result<Json<RetenderOutcome>, AppError> {
    // ADMIN even before the day is posted. It is not an edit to a sale — the
    // sale's total does not move — but it decides which of two of the client's
    // receivables carries the money, and after the day is posted it writes a
    // journal entry on its own.
    allowed(&principal, Role::Admin, "move a settled tender")?;
    Ok(Json(
        infrastructure::retender_tender(&state.db, tender_id, &request, &principal.username)
            .await?,
    ))
}

/// The lane's routes, added to the router in one line.
///
/// A function rather than a block inside `router()` because several modules
/// are being built against that function at once, and a block each is a merge
/// conflict each.
///
/// `generate` and `generate-closed-days` sit above `{id}` deliberately —
/// axum's router already ranks a static segment over a dynamic one, so this is
/// ordering for a reader rather than for the matcher.
pub fn lane_a_routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/finance/sales-postings", get(sales_postings))
        .route(
            "/api/v1/finance/sales-postings/generate",
            post(sales_posting_generate),
        )
        .route(
            "/api/v1/finance/sales-postings/generate-closed-days",
            post(sales_posting_generate_days),
        )
        .route(
            "/api/v1/finance/sales-postings/{id}",
            get(sales_posting_detail),
        )
        .route(
            "/api/v1/finance/sales-postings/{id}/post",
            post(sales_posting_post),
        )
        .route(
            "/api/v1/finance/sales-postings/{id}/reverse",
            post(sales_posting_reverse),
        )
        .route(
            "/api/v1/finance/tenders/{id}/retender",
            post(retender_tender),
        )
}
