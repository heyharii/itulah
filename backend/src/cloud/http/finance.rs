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
        self as infrastructure, AccountBalance, AcquisitionGap, AssessAssetRequest, AssetRow,
        AssetSchedule, BalanceMatrix, BankStatementLineRow, BankStatementRow, BookBankLineRequest,
        ConfirmMatchRequest, DepreciationRun, DisposeAssetRequest, FiscalPeriod, GeneralLedger,
        ImportOutcome, ImportStatementRequest, JournalEntryDetail, JournalEntryRow, LedgerAccount,
        LineSuggestions, MoneyOverview, PayablesAging, PostingIntent, PostingLine,
        RecordBillRequest, RecordPaymentRequest, RegisterAssetRequest, SetAccountMappingRequest,
        Statement, SupplierBill, SupplierPayment, TransferAssetRequest, TrialBalance,
        UnbilledReceipt,
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
    Query(query): Query<JournalQuery>,
) -> Result<Json<Vec<JournalEntryRow>>, AppError> {
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
    let posted = infrastructure::post(&mut tx, &intent, None, &principal.username).await?;
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
    Query(query): Query<MatrixQuery>,
) -> Result<Json<BalanceMatrix>, AppError> {
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
    Query(query): Query<StatementQuery>,
) -> Result<Json<Statement>, AppError> {
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
    Query(query): Query<BillQuery>,
) -> Result<Json<Vec<SupplierBill>>, AppError> {
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
    Path(invoice_id): Path<Uuid>,
) -> Result<Json<SupplierBill>, AppError> {
    Ok(Json(infrastructure::bill(&state.db, invoice_id).await?))
}

pub async fn record_bill(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordBillRequest>,
) -> Result<Json<SupplierBill>, AppError> {
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
) -> Result<Json<Vec<UnbilledReceipt>>, AppError> {
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
    Query(query): Query<AgingQuery>,
) -> Result<Json<PayablesAging>, AppError> {
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
    Query(query): Query<PaymentQuery>,
) -> Result<Json<Vec<SupplierPayment>>, AppError> {
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
    Path(payment_id): Path<Uuid>,
) -> Result<Json<SupplierPayment>, AppError> {
    Ok(Json(infrastructure::payment(&state.db, payment_id).await?))
}

/// Record a payment. It is not in the books yet — posting is a separate act.
pub async fn record_payment(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordPaymentRequest>,
) -> Result<Json<SupplierPayment>, AppError> {
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
    Query(query): Query<AssetQuery>,
) -> Result<Json<Vec<AssetRow>>, AppError> {
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
) -> Result<Json<AcquisitionGap>, AppError> {
    Ok(Json(infrastructure::acquisition_gap(&state.db).await?))
}

/// What was charged against one asset, month by month, and what is left.
pub async fn asset_schedule(
    State(state): State<AppState>,
    Path(asset_id): Path<Uuid>,
) -> Result<Json<AssetSchedule>, AppError> {
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
    Query(query): Query<BalanceQuery>,
) -> Result<Json<MoneyOverview>, AppError> {
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
) -> Result<Json<Vec<BankStatementRow>>, AppError> {
    Ok(Json(infrastructure::list_statements(&state.db).await?))
}

pub async fn import_bank_statement(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<ImportStatementRequest>,
) -> Result<Json<ImportOutcome>, AppError> {
    Ok(Json(
        infrastructure::import_statement(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn bank_statement_lines(
    State(state): State<AppState>,
    Path(statement_id): Path<Uuid>,
) -> Result<Json<Vec<BankStatementLineRow>>, AppError> {
    Ok(Json(
        infrastructure::statement_lines(&state.db, statement_id).await?,
    ))
}

/// Score every unmatched line against our own ledger.
pub async fn bank_suggestions(
    State(state): State<AppState>,
    Path(statement_id): Path<Uuid>,
) -> Result<Json<Vec<LineSuggestions>>, AppError> {
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
    infrastructure::confirm_match(&state.db, line_id, &request, &principal.username).await?;
    Ok(Json(json!({ "matched": true })))
}

pub async fn unmatch_bank_line(
    State(state): State<AppState>,
    Path(line_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
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
