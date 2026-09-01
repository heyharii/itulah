//! The finance surface: the chart, the map, the journal, and the balances.
//!
//! Every write here goes through `poster::post`, so there is one place that
//! decides what a valid entry is. The reads are projections; none of them can
//! be stale, because none of them is stored.
//!
//! Errors are worth a note. The database raises its refusals with
//! `RAISE EXCEPTION`, and `AppError` already turns SQLSTATE P0001 into a 409
//! carrying the trigger's own message — so "accounting period 2026-09 is
//! closed" reaches the browser as written, and the screen does not have to
//! keep its own copy of a rule the database is already enforcing.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, AccountBalance, FiscalPeriod, GeneralLedger, JournalEntryDetail,
        JournalEntryRow, LedgerAccount, PostingIntent, PostingLine, SetAccountMappingRequest,
        TrialBalance,
    },
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct AccountQuery {
    /// The heading to open. Absent means the eight roots.
    pub parent: Option<String>,
    /// Free text, matched against both code and name.
    pub q: Option<String>,
    pub site: Option<String>,
    #[serde(default)]
    pub inactive: bool,
    pub limit: Option<i64>,
}

/// One level of the tree, or the results of a search.
///
/// One endpoint rather than two because they answer the same question — "which
/// accounts am I looking at" — and a screen that switched endpoints when
/// somebody typed would have two loading states for one box.
pub async fn accounts(
    State(state): State<AppState>,
    Query(query): Query<AccountQuery>,
) -> Result<Json<Vec<LedgerAccount>>, AppError> {
    let needle = query.q.as_deref().map(str::trim).unwrap_or("");
    if needle.is_empty() {
        Ok(Json(
            infrastructure::account_children(&state.db, query.parent.as_deref(), query.inactive)
                .await?,
        ))
    } else {
        Ok(Json(
            infrastructure::search_accounts(
                &state.db,
                needle,
                query.site.as_deref(),
                query.inactive,
                query.limit.unwrap_or(100),
            )
            .await?,
        ))
    }
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccountDetail {
    pub account: LedgerAccount,
    /// The headings above it, outermost first. What makes a twelve-digit code
    /// readable.
    pub path: Vec<LedgerAccount>,
    pub balance: AccountBalance,
}

#[derive(Debug, Deserialize)]
pub struct BalanceQuery {
    pub site: Option<String>,
    pub as_of: Option<NaiveDate>,
}

pub async fn account_detail(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Query(query): Query<BalanceQuery>,
) -> Result<Json<AccountDetail>, AppError> {
    let (account, path) = infrastructure::account_with_path(&state.db, &code).await?;
    let balance =
        infrastructure::account_balance(&state.db, &code, query.site.as_deref(), query.as_of)
            .await?;
    Ok(Json(AccountDetail {
        account,
        path,
        balance,
    }))
}

#[derive(Debug, Deserialize)]
pub struct LedgerQuery {
    pub site: Option<String>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
}

pub async fn account_ledger(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Query(query): Query<LedgerQuery>,
) -> Result<Json<GeneralLedger>, AppError> {
    let to = query.to.unwrap_or_else(|| Utc::now().date_naive());
    // A month, because that is the unit a ledger is read in and a default of
    // "everything" would make the first open of a busy account slow for no
    // reason anybody asked for.
    let from = query.from.unwrap_or_else(|| to.with_day(1).unwrap_or(to));
    if from > to {
        return Err(AppError::Validation("from is after to".into()));
    }
    Ok(Json(
        infrastructure::general_ledger(&state.db, &code, query.site.as_deref(), from, to).await?,
    ))
}

pub async fn trial_balance(
    State(state): State<AppState>,
    Query(query): Query<BalanceQuery>,
) -> Result<Json<TrialBalance>, AppError> {
    let as_of = query.as_of.unwrap_or_else(|| Utc::now().date_naive());
    Ok(Json(
        infrastructure::trial_balance(&state.db, as_of, query.site.as_deref()).await?,
    ))
}

// ---------------------------------------------------------------------------
// The account map
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct MapQuery {
    pub site: Option<String>,
}

pub async fn account_map(
    State(state): State<AppState>,
    Query(query): Query<MapQuery>,
) -> Result<Json<Value>, AppError> {
    let mappings = infrastructure::account_mappings(&state.db, query.site.as_deref()).await?;
    // The locations the books are kept for, and the meanings the posting rules
    // will ask for. Sent with the map because the screen's only real question —
    // which of these is still unset — cannot be asked without all three parts.
    let locations = infrastructure::book_locations(&state.db).await?;
    Ok(Json(json!({
        "mappings": mappings,
        "locations": locations,
        "required_keys": infrastructure::required_semantic_keys(),
    })))
}

pub async fn set_account_map(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<SetAccountMappingRequest>,
) -> Result<Json<Value>, AppError> {
    let mapping =
        infrastructure::set_account_mapping(&state.db, &request, &principal.username).await?;
    Ok(Json(json!(mapping)))
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

pub async fn periods(State(state): State<AppState>) -> Result<Json<Vec<FiscalPeriod>>, AppError> {
    Ok(Json(infrastructure::fiscal_periods(&state.db).await?))
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PeriodRequest {
    pub year: i32,
    pub month: i32,
}

pub async fn open_period(
    State(state): State<AppState>,
    Json(request): Json<PeriodRequest>,
) -> Result<Json<Vec<FiscalPeriod>>, AppError> {
    if !(1..=12).contains(&request.month) {
        return Err(AppError::Validation("month must be 1..12".into()));
    }
    infrastructure::open_period(&state.db, request.year, request.month).await?;
    Ok(Json(infrastructure::fiscal_periods(&state.db).await?))
}

pub async fn close_period(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<PeriodRequest>,
) -> Result<Json<Value>, AppError> {
    let sealed =
        infrastructure::close_period(&state.db, request.year, request.month, &principal.username)
            .await?;
    Ok(Json(json!({
        "year": request.year,
        "month": request.month,
        "entries_sealed": sealed,
    })))
}

// ---------------------------------------------------------------------------
// The journal
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct JournalQuery {
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub kind: Option<String>,
    pub limit: Option<i64>,
}

pub async fn journal(
    State(state): State<AppState>,
    Query(query): Query<JournalQuery>,
) -> Result<Json<Vec<JournalEntryRow>>, AppError> {
    Ok(Json(
        infrastructure::journal_register(
            &state.db,
            query.from,
            query.to,
            query.kind.as_deref(),
            query.limit.unwrap_or(200),
        )
        .await?,
    ))
}

pub async fn journal_entry(
    State(state): State<AppState>,
    Path(entry_id): Path<Uuid>,
) -> Result<Json<JournalEntryDetail>, AppError> {
    Ok(Json(
        infrastructure::journal_entry(&state.db, entry_id).await?,
    ))
}

/// A journal entry somebody wrote by hand.
///
/// Lines name accounts directly rather than meanings: choosing the account IS
/// the entry, and routing a manual correction through `account_map` would mean
/// an accountant could only post to the handful of accounts a posting rule
/// happens to know about.
#[derive(Debug, Deserialize)]
pub struct ManualEntryRequest {
    pub posting_date: NaiveDate,
    pub currency: Option<String>,
    pub memo: Option<String>,
    pub lines: Vec<PostingLine>,
}

pub async fn post_manual_entry(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<ManualEntryRequest>,
) -> Result<Json<Value>, AppError> {
    let intent = PostingIntent {
        posting_date: request.posting_date,
        source_kind: "MANUAL".into(),
        source_id: None,
        rule_version: "manual/1".into(),
        currency: request.currency.unwrap_or_else(|| "IDR".into()),
        memo: request.memo,
        lines: request.lines,
    };
    let mut tx = state.db.begin().await?;
    let posted = infrastructure::post(&mut tx, &intent, &principal.username).await?;
    tx.commit().await?;
    Ok(Json(json!({
        "entry_id": posted.entry_id,
        "entry_number": posted.entry_number,
        "total_minor": posted.total_minor,
    })))
}

#[derive(Debug, Deserialize)]
pub struct ReverseRequest {
    pub posting_date: Option<NaiveDate>,
    pub reason: String,
}

/// Undo an entry by writing its mirror. The original stays exactly as posted.
pub async fn reverse_entry(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(entry_id): Path<Uuid>,
    Json(request): Json<ReverseRequest>,
) -> Result<Json<Value>, AppError> {
    if request.reason.trim().is_empty() {
        return Err(AppError::Validation(
            "a reversal needs a reason; it is the only record of why".into(),
        ));
    }
    let date = request
        .posting_date
        .unwrap_or_else(|| Utc::now().date_naive());
    let mut tx = state.db.begin().await?;
    let posted = infrastructure::reverse(
        &mut tx,
        entry_id,
        date,
        request.reason.trim(),
        &principal.username,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({
        "entry_id": posted.entry_id,
        "entry_number": posted.entry_number,
    })))
}
