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
    domain::{actions, required_role_for_action, role_allows},
    postgres::{
        self as infrastructure, AccountBalance, AcquisitionGap, AdjustmentRequest,
        AssessAssetRequest, AssetRow, AssetSchedule, BalanceMatrix, BankStatementLineRow,
        BankStatementRow, BookBankLineRequest, ConfirmMatchRequest, CorrectionDocument,
        DepreciationRun, DisposeAssetRequest, FiscalPeriod, GeneralLedger, ImportOutcome,
        ImportStatementRequest, JournalEntryDetail, JournalEntryRow, LedgerAccount,
        LineSuggestions, MoneyOverview, PayablesAging, PostingIntent, PostingLine, ReclassRequest,
        RecordBillRequest, RecordPaymentRequest, RegisterAssetRequest, SetAccountMappingRequest,
        Statement, SupplierBill, SupplierPayment, TransferAssetRequest, TrialBalance,
        UnbilledReceipt, WriteOffRequest,
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

/// The gate every handler in this file opens before it does anything.
///
/// Copied rather than shared, exactly as `pay`, `roster`, `overtime` and
/// `leave` each carry their own. One line, and the alternative — a `super::`
/// helper — would make the four modules that already have it import a fifth.
///
/// This is the SECOND gate. `auth::require_auth` already answers a coarse
/// question from the path alone: GET under `/api/v1/finance/` needs Supervisor,
/// anything else needs Admin. What a path cannot say is that sealing a month
/// and unsealing one are different acts, or that a shop's payables and the
/// company's trial balance have different audiences. That is what the action
/// key says, and it is why every handler asks again.
fn require(principal: &Principal, action_key: &str) -> Result<(), AppError> {
    if role_allows(required_role_for_action(action_key), principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {action_key}",
        principal.username
    )))
}

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
    Extension(principal): Extension<Principal>,
    Query(query): Query<AccountQuery>,
) -> Result<Json<Vec<LedgerAccount>>, AppError> {
    require(&principal, actions::FINANCE_LEDGER_READ)?;
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
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
    Query(query): Query<BalanceQuery>,
) -> Result<Json<AccountDetail>, AppError> {
    require(&principal, actions::FINANCE_LEDGER_READ)?;
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
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
    Query(query): Query<LedgerQuery>,
) -> Result<Json<GeneralLedger>, AppError> {
    require(&principal, actions::FINANCE_LEDGER_READ)?;
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
    Extension(principal): Extension<Principal>,
    Query(query): Query<BalanceQuery>,
) -> Result<Json<TrialBalance>, AppError> {
    require(&principal, actions::FINANCE_LEDGER_READ)?;
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
    Extension(principal): Extension<Principal>,
    Query(query): Query<MapQuery>,
) -> Result<Json<Value>, AppError> {
    require(&principal, actions::FINANCE_LEDGER_READ)?;
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
    require(&principal, actions::FINANCE_MAP_SET)?;
    let mapping =
        infrastructure::set_account_mapping(&state.db, &request, &principal.username).await?;
    Ok(Json(json!(mapping)))
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

pub async fn periods(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<FiscalPeriod>>, AppError> {
    require(&principal, actions::FINANCE_READ)?;
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
    Extension(principal): Extension<Principal>,
    Json(request): Json<PeriodRequest>,
) -> Result<Json<Vec<FiscalPeriod>>, AppError> {
    require(&principal, actions::FINANCE_PERIOD_OPEN)?;
    if !(1..=12).contains(&request.month) {
        return Err(AppError::Validation("month must be 1..12".into()));
    }
    infrastructure::open_period(&state.db, request.year, request.month).await?;
    Ok(Json(infrastructure::fiscal_periods(&state.db).await?))
}

/// A period named the way a person names one: `2026-09`.
///
/// A month has no surrogate key — its identity is the two numbers — so the
/// path segment is the label, parsed here rather than split into two path
/// parameters. `/periods/2026-09/reopen` is a URL somebody can read in a log.
fn parse_period(raw: &str) -> Result<(i32, i32), AppError> {
    let bad = || AppError::Validation(format!("{raw:?} is not a period; a period reads 2026-09"));
    let (year, month) = raw.split_once('-').ok_or_else(bad)?;
    let year: i32 = year.parse().map_err(|_| bad())?;
    let month: i32 = month.parse().map_err(|_| bad())?;
    if !(1..=12).contains(&month) {
        return Err(bad());
    }
    Ok((year, month))
}

/// What a close would refuse on, without closing anything.
///
/// The same computation the close runs, exposed on its own so the screen can
/// show the month's readiness while people are still working on it. It is the
/// only honest way to build that screen: a checklist assembled separately from
/// the one the close consults would eventually disagree with it, and the
/// disagreement would be discovered on the last day of the month.
pub async fn period_checklist(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(period): Path<String>,
) -> Result<Json<crate::cloud::domain::CloseVerdict>, AppError> {
    require(&principal, actions::FINANCE_PERIOD_CLOSE)?;
    let (year, month) = parse_period(&period)?;
    Ok(Json(
        infrastructure::period_checklist(&state.db, year, month).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ClosePeriodRequest {
    pub year: i32,
    pub month: i32,
    /// Optional on a close. A month that closes because everything passed
    /// needs no explanation; the checklist snapshot is the explanation.
    pub reason: Option<String>,
}

/// Seal a month, if its checklist lets you.
///
/// The refusal is a 409 carrying the keys that stood in the way, and the
/// checklist that produced it is stored against the close that succeeds. Both
/// halves matter: the first so somebody knows what to go and fix, the second so
/// that in six months "was the bank reconciled when September closed?" has an
/// answer that is not somebody's memory of a screen.
pub async fn close_period(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<ClosePeriodRequest>,
) -> Result<Json<infrastructure::PeriodCloseOutcome>, AppError> {
    require(&principal, actions::FINANCE_PERIOD_CLOSE)?;
    Ok(Json(
        infrastructure::period_close(
            &state.db,
            request.year,
            request.month,
            &principal.username,
            request.reason.as_deref(),
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReopenRequest {
    /// Required, and the route refuses without it. See the handler.
    pub reason: String,
}

/// Unseal a month.
///
/// Two things guard it, and neither is redundant. The reason is mandatory
/// because a reopen is the one act in finance that lets somebody write into a
/// month that has already been reported, and the reason is the only record of
/// why that was allowed. The key is `finance.period.reopen` and not
/// `finance.period.close`, because whoever can undo their own close has not
/// closed anything.
pub async fn reopen_period(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(period): Path<String>,
    Json(request): Json<ReopenRequest>,
) -> Result<Json<Vec<FiscalPeriod>>, AppError> {
    require(&principal, actions::FINANCE_PERIOD_REOPEN)?;
    let (year, month) = parse_period(&period)?;
    infrastructure::period_reopen(&state.db, year, month, &principal.username, &request.reason)
        .await?;
    Ok(Json(infrastructure::fiscal_periods(&state.db).await?))
}

/// Every close and reopen this month has had, newest first.
pub async fn period_events(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(period): Path<String>,
) -> Result<Json<Vec<infrastructure::PeriodEvent>>, AppError> {
    require(&principal, actions::FINANCE_READ)?;
    let (year, month) = parse_period(&period)?;
    Ok(Json(
        infrastructure::period_events(&state.db, year, month).await?,
    ))
}

// ---------------------------------------------------------------------------
// The journal
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct JournalQuery {
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    /// A `source_kind`. `MANUAL` is the one worth asking for on its own: it is
    /// the only kind that means a person typed the entry from nothing.
    pub kind: Option<String>,
    /// Entries with any line at this location. An entry has no location of its
    /// own — its lines do, and a payment can settle two shops' bills at once.
    pub site: Option<String>,
    pub limit: Option<i64>,
}

pub async fn journal(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<JournalQuery>,
) -> Result<Json<Vec<JournalEntryRow>>, AppError> {
    require(&principal, actions::FINANCE_LEDGER_READ)?;
    Ok(Json(
        infrastructure::journal_register(
            &state.db,
            query.from,
            query.to,
            query.kind.as_deref(),
            query.site.as_deref(),
            query.limit.unwrap_or(200),
        )
        .await?,
    ))
}

pub async fn journal_entry(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(entry_id): Path<Uuid>,
) -> Result<Json<JournalEntryDetail>, AppError> {
    require(&principal, actions::FINANCE_LEDGER_READ)?;
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
    require(&principal, actions::FINANCE_JOURNAL_MANUAL)?;
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
    require(&principal, actions::FINANCE_REVERSE)?;
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

// ---------------------------------------------------------------------------
// Positions and statements
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct MatrixQuery {
    /// Any code in the chart. The tree is in the codes, so the caller picks the
    /// altitude: `1011001` is cash on hand, `10110` is the whole of KAS.
    pub family: String,
    pub as_of: Option<NaiveDate>,
}

/// One account family, by location. The shape behind every position screen —
/// cash, banks, card receivables, inter-unit, inventory, assets, loans.
pub async fn balances(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<MatrixQuery>,
) -> Result<Json<BalanceMatrix>, AppError> {
    require(&principal, actions::FINANCE_LEDGER_READ)?;
    let as_of = query.as_of.unwrap_or_else(|| Utc::now().date_naive());
    Ok(Json(
        infrastructure::balance_matrix(&state.db, query.family.trim(), as_of).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct StatementQuery {
    /// `BALANCE_SHEET` or `PROFIT_LOSS`.
    pub kind: Option<String>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub site: Option<String>,
}

pub async fn statement(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<StatementQuery>,
) -> Result<Json<Statement>, AppError> {
    require(&principal, actions::FINANCE_LEDGER_READ)?;
    let to = query.to.unwrap_or_else(|| Utc::now().date_naive());
    let kind = query.kind.unwrap_or_else(|| "BALANCE_SHEET".into());
    // A profit and loss with no start is the year so far, which is what
    // somebody opening it without choosing a window almost always means.
    let from = query.from.or_else(|| {
        (kind == "PROFIT_LOSS")
            .then(|| NaiveDate::from_ymd_opt(to.year(), 1, 1))
            .flatten()
    });
    Ok(Json(
        infrastructure::statement(&state.db, &kind, from, to, query.site.as_deref()).await?,
    ))
}

// ---------------------------------------------------------------------------
// Supplier bills
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct BillQuery {
    pub status: Option<String>,
    pub supplier: Option<String>,
    pub limit: Option<i64>,
}

pub async fn bills(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<BillQuery>,
) -> Result<Json<Vec<SupplierBill>>, AppError> {
    require(&principal, actions::FINANCE_READ)?;
    Ok(Json(
        infrastructure::list_bills(
            &state.db,
            query.status.as_deref(),
            query.supplier.as_deref(),
            query.limit.unwrap_or(200),
        )
        .await?,
    ))
}

/// One bill, with what it was for.
///
/// The detail read, and the only one that fills `lines`: an EXPENSE bill comes
/// back with the accounts it named, a MERCHANDISE bill with an empty array —
/// it genuinely has none, and that is different from the `null` the list
/// returns, which means "not fetched". `list_bills` leaves it null so drawing a
/// hundred rows stays one query.
///
/// Settlement is already on the row as `paid_minor`, `outstanding_minor` and
/// `allocated_minor`, summed from the payment allocations on every read. There
/// is no payments array here on purpose: a bill is a document, and which bank
/// lines settled it is `GET /payments?supplier=`.
pub async fn bill(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(invoice_id): Path<Uuid>,
) -> Result<Json<SupplierBill>, AppError> {
    require(&principal, actions::FINANCE_READ)?;
    Ok(Json(infrastructure::bill(&state.db, invoice_id).await?))
}

pub async fn record_bill(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordBillRequest>,
) -> Result<Json<SupplierBill>, AppError> {
    require(&principal, actions::FINANCE_DOCUMENT_RECORD)?;
    Ok(Json(
        infrastructure::record_bill(&state.db, &request, &principal.username).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct PostBillRequest {
    pub posting_date: Option<NaiveDate>,
}

pub async fn post_bill(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(invoice_id): Path<Uuid>,
    Json(request): Json<PostBillRequest>,
) -> Result<Json<SupplierBill>, AppError> {
    require(&principal, actions::FINANCE_POST)?;
    Ok(Json(
        infrastructure::post_bill(
            &state.db,
            invoice_id,
            request.posting_date,
            &principal.username,
        )
        .await?,
    ))
}

/// Deliveries with no bill against them.
///
/// The books cannot carry this — the client has no goods-received-not-invoiced
/// account — so it is reported as an operational exposure and labelled as one.
pub async fn unbilled(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<UnbilledReceipt>>, AppError> {
    require(&principal, actions::FINANCE_READ)?;
    Ok(Json(
        infrastructure::unbilled_receipts(&state.db, 200).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AgingQuery {
    /// The reporting date. Both sides are wound back to it: a bill invoiced
    /// after it is not yet a debt, and a payment made after it has not yet
    /// happened.
    pub as_of: Option<NaiveDate>,
    pub site: Option<String>,
}

/// What is owed, to whom, and how late.
///
/// It belongs beside the Supplier bills screen rather than in Reports: it is
/// the list somebody works from when deciding who to pay this week, not a
/// statement of the books. The books already answer the same total under
/// `trade_payable`, and the two agree — both move only when a bill or a payment
/// posts.
pub async fn payables_aging(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<AgingQuery>,
) -> Result<Json<PayablesAging>, AppError> {
    require(&principal, actions::FINANCE_READ)?;
    let as_of = query.as_of.unwrap_or_else(|| Utc::now().date_naive());
    Ok(Json(
        infrastructure::payables_aging(&state.db, as_of, query.site.as_deref()).await?,
    ))
}

// ---------------------------------------------------------------------------
// Supplier payments
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct PaymentQuery {
    pub status: Option<String>,
    pub site: Option<String>,
    /// Who was paid. It lives on the allocations, not on the payment: one bank
    /// line settling two suppliers is a thing that happens.
    pub supplier: Option<String>,
    pub limit: Option<i64>,
}

pub async fn payments(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<PaymentQuery>,
) -> Result<Json<Vec<SupplierPayment>>, AppError> {
    require(&principal, actions::FINANCE_READ)?;
    Ok(Json(
        infrastructure::list_payments(
            &state.db,
            query.status.as_deref(),
            query.site.as_deref(),
            query.supplier.as_deref(),
            query.limit.unwrap_or(200),
        )
        .await?,
    ))
}

pub async fn payment(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(payment_id): Path<Uuid>,
) -> Result<Json<SupplierPayment>, AppError> {
    require(&principal, actions::FINANCE_READ)?;
    Ok(Json(infrastructure::payment(&state.db, payment_id).await?))
}

/// Record a payment. It is not in the books yet — posting is a separate act.
pub async fn record_payment(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordPaymentRequest>,
) -> Result<Json<SupplierPayment>, AppError> {
    require(&principal, actions::FINANCE_DOCUMENT_RECORD)?;
    Ok(Json(
        infrastructure::record_payment(&state.db, &request, &principal.username).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct PostPaymentRequest {
    /// Defaults to the payment date. Separate because a payment made on the
    /// 31st and keyed on the 2nd belongs to the month the money moved, and
    /// somebody may have to say so when that month has closed.
    pub posting_date: Option<NaiveDate>,
}

pub async fn post_payment(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(payment_id): Path<Uuid>,
    Json(request): Json<PostPaymentRequest>,
) -> Result<Json<SupplierPayment>, AppError> {
    require(&principal, actions::FINANCE_POST)?;
    Ok(Json(
        infrastructure::post_payment(
            &state.db,
            payment_id,
            request.posting_date,
            &principal.username,
        )
        .await?,
    ))
}

// ---------------------------------------------------------------------------
// Fixed assets
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct AssetQuery {
    pub site: Option<String>,
    pub category: Option<String>,
    /// Only assets nobody has assessed. The open control gap, asked for
    /// directly — it is the list Finance works from.
    #[serde(default)]
    pub unassessed: bool,
    pub limit: Option<i64>,
}

pub async fn assets(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<AssetQuery>,
) -> Result<Json<Vec<AssetRow>>, AppError> {
    require(&principal, actions::FINANCE_READ)?;
    Ok(Json(
        infrastructure::list_assets(
            &state.db,
            query.site.as_deref(),
            query.category.as_deref(),
            query.unassessed,
            query.limit.unwrap_or(500),
        )
        .await?,
    ))
}

pub async fn register_asset(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RegisterAssetRequest>,
) -> Result<Json<AssetRow>, AppError> {
    require(&principal, actions::FINANCE_ASSET_MANAGE)?;
    Ok(Json(
        infrastructure::register_asset(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn assess_asset(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(asset_id): Path<Uuid>,
    Json(request): Json<AssessAssetRequest>,
) -> Result<Json<AssetRow>, AppError> {
    require(&principal, actions::FINANCE_ASSET_MANAGE)?;
    Ok(Json(
        infrastructure::assess_asset(&state.db, asset_id, &request, &principal.username).await?,
    ))
}

/// Take an asset off the books: cost out, accumulated depreciation out,
/// proceeds in, and the difference to the gain-or-loss account.
///
/// Refuses an asset that is not capitalised, one already disposed of, and one
/// the depreciation run still owes a charge for the month it left in — the last
/// because otherwise the loss is overstated by exactly one month's charge and
/// the expense understated by it.
pub async fn dispose_asset(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(asset_id): Path<Uuid>,
    Json(request): Json<DisposeAssetRequest>,
) -> Result<Json<AssetRow>, AppError> {
    require(&principal, actions::FINANCE_ASSET_MANAGE)?;
    Ok(Json(
        infrastructure::dispose_asset(&state.db, asset_id, &request, &principal.username).await?,
    ))
}

/// Move an asset, and move its cost and accumulated depreciation with it.
///
/// Both halves, because the client keeps a profit and loss per location: moving
/// the cost alone leaves two locations wrong by the same amount in opposite
/// directions, which a trial balance cannot see.
pub async fn transfer_asset(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(asset_id): Path<Uuid>,
    Json(request): Json<TransferAssetRequest>,
) -> Result<Json<AssetRow>, AppError> {
    require(&principal, actions::FINANCE_ASSET_MANAGE)?;
    Ok(Json(
        infrastructure::transfer_asset(&state.db, asset_id, &request, &principal.username).await?,
    ))
}

/// Assets the books never bought, and capital purchases nobody registered.
///
/// Two lists rather than one number, because they are different faults with
/// different fixes: an unbacked asset needs the bill line that paid for it
/// found (or the bill raised); an unclaimed line needs the thing put on the
/// register. Overview shows the two totals as one exception; the Assets screen
/// warns per row from `AssetRow.acquired_via` being null.
pub async fn unbacked_assets(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<AcquisitionGap>, AppError> {
    require(&principal, actions::FINANCE_READ)?;
    Ok(Json(infrastructure::acquisition_gap(&state.db).await?))
}

/// What was charged against one asset, month by month, and what is left.
pub async fn asset_schedule(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(asset_id): Path<Uuid>,
) -> Result<Json<AssetSchedule>, AppError> {
    require(&principal, actions::FINANCE_READ)?;
    Ok(Json(
        infrastructure::asset_schedule(&state.db, asset_id).await?,
    ))
}

/// Charge one month across every capitalised asset.
///
/// Safe to run twice: the unique index on (asset, period) refuses a second
/// entry, so a repeat reports every asset as already done rather than doubling
/// the charge.
pub async fn run_depreciation(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<PeriodRequest>,
) -> Result<Json<DepreciationRun>, AppError> {
    require(&principal, actions::FINANCE_ASSET_MANAGE)?;
    if !(1..=12).contains(&request.month) {
        return Err(AppError::Validation("month must be 1..12".into()));
    }
    let missing = infrastructure::unmapped_categories(&state.db).await?;
    if !missing.is_empty() {
        return Err(AppError::Validation(format!(
            "map these before running depreciation, or the run refuses asset by asset: {}",
            missing.join("; ")
        )));
    }
    Ok(Json(
        infrastructure::run_depreciation(
            &state.db,
            request.year,
            request.month as u32,
            &principal.username,
        )
        .await?,
    ))
}

// ---------------------------------------------------------------------------
// Cash and bank
// ---------------------------------------------------------------------------

/// Where the money is, and whether the bank agrees.
///
/// One row per mapped money account per location, so the screen is a list of
/// accounts rather than a list of statements. `GET /bank-statements` stays as
/// the drill-in: this answers "what do we hold and does it reconcile", and that
/// one answers "which upload said so".
///
/// Driven off `account_map`, so a meaning nobody has mapped produces no row.
/// That is the honest answer and it is visible: the Account Map screen is where
/// it gets fixed.
pub async fn money(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<BalanceQuery>,
) -> Result<Json<MoneyOverview>, AppError> {
    require(&principal, actions::FINANCE_READ)?;
    let as_of = query.as_of.unwrap_or_else(|| Utc::now().date_naive());
    Ok(Json(
        infrastructure::money_overview(&state.db, as_of, query.site.as_deref()).await?,
    ))
}

// ---------------------------------------------------------------------------
// Bank reconciliation
// ---------------------------------------------------------------------------

pub async fn bank_statements(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<BankStatementRow>>, AppError> {
    require(&principal, actions::FINANCE_READ)?;
    Ok(Json(infrastructure::list_statements(&state.db).await?))
}

pub async fn import_bank_statement(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<ImportStatementRequest>,
) -> Result<Json<ImportOutcome>, AppError> {
    require(&principal, actions::FINANCE_BANK_RECONCILE)?;
    Ok(Json(
        infrastructure::import_statement(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn bank_statement_lines(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(statement_id): Path<Uuid>,
) -> Result<Json<Vec<BankStatementLineRow>>, AppError> {
    require(&principal, actions::FINANCE_READ)?;
    Ok(Json(
        infrastructure::statement_lines(&state.db, statement_id).await?,
    ))
}

/// Score every unmatched line against our own ledger.
pub async fn bank_suggestions(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(statement_id): Path<Uuid>,
) -> Result<Json<Vec<LineSuggestions>>, AppError> {
    require(&principal, actions::FINANCE_READ)?;
    Ok(Json(
        infrastructure::suggest_matches(&state.db, statement_id).await?,
    ))
}

/// Agree that a bank line and a journal line are the same event. Posts nothing.
pub async fn confirm_bank_match(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(line_id): Path<Uuid>,
    Json(request): Json<ConfirmMatchRequest>,
) -> Result<Json<Value>, AppError> {
    require(&principal, actions::FINANCE_BANK_RECONCILE)?;
    infrastructure::confirm_match(&state.db, line_id, &request, &principal.username).await?;
    Ok(Json(json!({ "matched": true })))
}

pub async fn unmatch_bank_line(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(line_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    require(&principal, actions::FINANCE_BANK_RECONCILE)?;
    infrastructure::unmatch(&state.db, line_id).await?;
    Ok(Json(json!({ "matched": false })))
}

/// Book a line nobody booked, and agree it in the same breath.
///
/// The other half of reconciliation. Matching says the bank has confirmed
/// something we already recorded; this says the bank did something we never
/// recorded, and puts it in the ledger — a monthly charge, interest credited, a
/// transfer that arrived without a document. One entry, one match, one
/// transaction, so the line never exists in the state where it has been booked
/// and nothing points at what booked it.
pub async fn book_bank_line(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(line_id): Path<Uuid>,
    Json(request): Json<BookBankLineRequest>,
) -> Result<Json<Value>, AppError> {
    require(&principal, actions::FINANCE_POST)?;
    let booked =
        infrastructure::book_bank_line(&state.db, line_id, &request, &principal.username).await?;
    Ok(Json(json!({
        "entry_id": booked.entry_id,
        "entry_number": booked.entry_number,
        "journal_line_id": booked.journal_line_id,
        "total_minor": booked.total_minor,
        "matched": true,
    })))
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------
//
// Three documents, one lifecycle, and the lifecycle is the point. A
// reclassification, an adjustment and a write-off all go DRAFT → APPROVED →
// POSTED, all carry a reason, all name two people, and all reverse. What they
// replaced was a MANUAL journal entry with a memo, which recorded the debit and
// the credit and none of that.
//
// The approve step is a separate route and a separate action key rather than a
// flag on the create. Two keys is what lets the rule "not the person who drafted
// it" be stated at all: `finance.post` and `finance.approve` map to the same
// rung today and always will while the ladder has three, and the rule is
// enforced on the actor, by the handler's caller and by a CHECK on the row.

#[derive(Debug, Deserialize)]
pub struct CorrectionQuery {
    /// `RECLASS`, `ADJUSTMENT` or `WRITE_OFF`.
    pub kind: Option<String>,
    pub status: Option<String>,
    pub site: Option<String>,
    pub limit: Option<i64>,
}

pub async fn corrections(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<CorrectionQuery>,
) -> Result<Json<Vec<CorrectionDocument>>, AppError> {
    require(&principal, actions::FINANCE_READ)?;
    Ok(Json(
        infrastructure::correction_list(
            &state.db,
            query.kind.as_deref(),
            query.status.as_deref(),
            query.site.as_deref(),
            query.limit.unwrap_or(200).clamp(1, 500),
        )
        .await?,
    ))
}

pub async fn correction(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(correction_id): Path<Uuid>,
) -> Result<Json<CorrectionDocument>, AppError> {
    require(&principal, actions::FINANCE_READ)?;
    Ok(Json(
        infrastructure::correction(&state.db, correction_id).await?,
    ))
}

/// Draft a reclassification.
///
/// Refused if either side is money. That refusal is in the infrastructure
/// rather than here because it reads `account_map` — the client's cash and bank
/// codes are theirs to move, and a list of prefixes in Rust would stop being
/// true the day Finance opened a second bank.
pub async fn create_reclass(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<ReclassRequest>,
) -> Result<Json<CorrectionDocument>, AppError> {
    require(&principal, actions::FINANCE_DOCUMENT_RECORD)?;
    Ok(Json(
        infrastructure::reclass_create(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn create_adjustment(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<AdjustmentRequest>,
) -> Result<Json<CorrectionDocument>, AppError> {
    require(&principal, actions::FINANCE_DOCUMENT_RECORD)?;
    Ok(Json(
        infrastructure::adjustment_create(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn create_write_off(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<WriteOffRequest>,
) -> Result<Json<CorrectionDocument>, AppError> {
    require(&principal, actions::FINANCE_DOCUMENT_RECORD)?;
    Ok(Json(
        infrastructure::write_off_create(&state.db, &request, &principal.username).await?,
    ))
}

/// Agree a correction somebody else drafted.
///
/// `finance.approve`, never `finance.post`. The two keys exist so that the
/// second person is a different person, and the check that they are is made
/// against `created_by` in the infrastructure and again by a CHECK on the row —
/// a rule enforced in one place is a rule with one place to go wrong.
pub async fn approve_correction(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(correction_id): Path<Uuid>,
) -> Result<Json<CorrectionDocument>, AppError> {
    require(&principal, actions::FINANCE_APPROVE)?;
    Ok(Json(
        infrastructure::correction_approve(&state.db, correction_id, &principal.username).await?,
    ))
}

#[derive(Debug, Default, Deserialize)]
pub struct PostCorrectionRequest {
    /// Where in time the entry lands. Absent means the document's own date,
    /// which is what it means nearly always; a period lock refuses either way.
    pub posting_date: Option<NaiveDate>,
}

pub async fn post_correction(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(correction_id): Path<Uuid>,
    Json(request): Json<PostCorrectionRequest>,
) -> Result<Json<CorrectionDocument>, AppError> {
    require(&principal, actions::FINANCE_POST)?;
    Ok(Json(
        infrastructure::correction_post(
            &state.db,
            correction_id,
            request.posting_date,
            &principal.username,
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct ReverseCorrectionRequest {
    pub reason: String,
    pub posting_date: Option<NaiveDate>,
}

/// Undo a posted correction, by posting its mirror.
///
/// Never by deleting anything. A correction that could be erased would make the
/// document trail worth less than the memo it replaced.
pub async fn reverse_correction(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(correction_id): Path<Uuid>,
    Json(request): Json<ReverseCorrectionRequest>,
) -> Result<Json<CorrectionDocument>, AppError> {
    require(&principal, actions::FINANCE_REVERSE)?;
    Ok(Json(
        infrastructure::correction_reverse(
            &state.db,
            correction_id,
            request.posting_date,
            &request.reason,
            &principal.username,
        )
        .await?,
    ))
}
