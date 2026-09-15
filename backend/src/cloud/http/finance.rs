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
use super::{facet_values, limit_value, refuse_unknown_parameters, single_value};
use crate::cloud::{
    application::{AppError, AppState},
    domain::RecordKind,
    http::audit::DeclaredSubject,
    postgres::{
        self as infrastructure, AccountBalance, AccountMapPage, AccountPage, AcquisitionGap,
        AdjustmentRequest, AssessAssetRequest, AssetPage, AssetRow, AssetSchedule, BalanceMatrix,
        BankInstitution, BankStatementLineRow, BankStatementPage, BillPage, BookBankLineRequest,
        CashCountRow, CompanyBankAccount, ConfirmMatchRequest, CorrectionDocument,
        DecideInstructionRequest, DepositPage, DepreciationRun, DescribeBankAccountRequest,
        DisposeAssetRequest, GeneralLedger, ImportOutcome, ImportStatementRequest, InstructionPage,
        JournalEntryDetail, JournalPage, LandDepositRequest, LedgerAccount, LineSuggestions,
        MoneyOverview, PayablesAging, PaymentInstruction, PaymentPage, PeriodPage,
        PostCountRequest, PostSaleDayRequest, PostingIntent, PostingLine, RaiseInstructionRequest,
        ReclassRequest, RecordBillRequest, RecordCountRequest, RecordDepositRequest,
        RecordPaymentRequest, RegisterAssetRequest, SaleDayPage, SaleDayRow,
        SetAccountMappingRequest, SettleInstructionRequest, Statement, StoreDeposit, SupplierBill,
        SupplierPayment, TransferAssetRequest, TrialBalance, UnbilledReceipt,
        UpdateBankLineRequest, WriteOffRequest,
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

/// What every one of these lists takes, beside its own filters.
///
/// Declared because these handlers read the query string as PAIRS rather than
/// into a struct — the filters are multi-select, and `?site=a&site=b` is how a
/// panel with two boxes ticked spells itself, which a struct's deserializer
/// silently reduces to the last one. The one thing a struct gives that pairs
/// do not is `deny_unknown_fields`, and it is worth having: a misspelled
/// filter narrows nothing and looks like it worked. So each handler declares
/// the names it takes and `refuse_unknown_parameters` turns anything else into
/// a 400.
const PAGING: [&str; 5] = ["q", "sort", "dir", "cursor", "limit"];

/// One level of the tree, or the results of a search: searched, filtered,
/// sorted and paged.
///
/// One endpoint rather than two because they answer the same question — "which
/// accounts am I looking at" — and a screen that switched endpoints when
/// somebody typed would have two loading states for one box.
///
/// # Why this answers in an envelope rather than in an array
///
/// Because a list of rows cannot say how many rows there are, and this is the
/// list where that matters most: the client's chart is 7,528 accounts. The
/// tree was never the problem — no heading here has more than 36 children —
/// but the search clamped at 500 and said nothing about the rest, so a needle
/// matching two thousand accounts looked exactly like one matching five
/// hundred. `total` says which, and `next_cursor` walks past it.
///
/// The shape is `GET /finance/money`'s, deliberately and not adapted.
///
/// # Query parameters
///
/// `parent` opens a heading and is read only when there is no search. `q`
/// searches the code by prefix and the name anywhere. `class` and `site`
/// filter, and each of them repeats or takes a comma list. `inactive=true`
/// includes retired accounts. `sort` is one of `code`, `name`, `children`,
/// with `dir=desc`; anything else is the house order — what you typed the code
/// of, first. `cursor` and `limit` page.
pub async fn accounts(
    State(state): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<AccountPage>, AppError> {
    refuse_unknown_parameters(
        &params,
        &[&PAGING[..], &["parent", "class", "site", "inactive"]].concat(),
    )?;
    Ok(Json(
        infrastructure::account_page(
            &state.db,
            infrastructure::AccountScope {
                parent: single_value(&params, "parent"),
                needle: single_value(&params, "q"),
                classes: facet_values(&params, "class"),
                // `site` stays the name it has always been, and now takes more
                // than one. An old caller sending exactly one is unaffected.
                sites: facet_values(&params, "site"),
                // `true` and nothing else. A retired account is hidden until
                // somebody says otherwise, which is what this has always done.
                include_inactive: single_value(&params, "inactive").as_deref() == Some("true"),
                sort: single_value(&params, "sort"),
                // `dir=desc` and nothing else. Absent, empty and anything
                // unrecognised all mean ascending, which is the direction a
                // list is in before anybody touches it.
                desc: single_value(&params, "dir").as_deref() == Some("desc"),
                cursor: single_value(&params, "cursor"),
                // Clamped where it is enforced, not here: one spelling of how
                // much of the chart one request may see.
                limit: limit_value(&params)?,
            },
        )
        .await?,
    ))
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

/// One account's movements over a window, with the balance walking down it.
///
/// # The totals do not move when somebody types
///
/// This is the one list here where the envelope's convention is deliberately
/// overridden. A general ledger is read to answer "what did this account do,
/// and does it still add up"; the second half is about the WHOLE window, and a
/// figure that shrank as somebody narrowed the rows would be a trial balance
/// that disagreed with itself on demand.
///
/// So `opening_minor`, `closing_minor`, `window_debit_minor`,
/// `window_credit_minor` and `window_rows` are computed before the search, and
/// `running_minor` on each row is still the balance after that movement in the
/// window's own order. Only `rows`, `total` and the facet counts narrow.
///
/// # Query parameters
///
/// `site`, `from` and `to` define the WINDOW — `site` narrows the opening
/// balance too, because "cash at Cikupa" is a different ledger and not a
/// filtered view of a wider one. `q` searches the entry number, the memo and
/// the source document's id; `kind` filters by what caused the entry and
/// repeats. Both narrow the ROWS alone. `sort` is one of `amount`, `entry`,
/// `reconciliation`, with `dir=desc`; anything else is the window's own
/// sequence. `cursor` and `limit` page.
pub async fn account_ledger(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<GeneralLedger>, AppError> {
    refuse_unknown_parameters(
        &params,
        &[&PAGING[..], &["site", "from", "to", "kind"]].concat(),
    )?;
    let to = match single_value(&params, "to") {
        Some(raw) => raw
            .parse::<NaiveDate>()
            .map_err(|_| AppError::Validation(format!("to {raw:?} is not a date")))?,
        None => Utc::now().date_naive(),
    };
    // A month, because that is the unit a ledger is read in and a default of
    // "everything" would make the first open of a busy account slow for no
    // reason anybody asked for.
    let from = match single_value(&params, "from") {
        Some(raw) => raw
            .parse::<NaiveDate>()
            .map_err(|_| AppError::Validation(format!("from {raw:?} is not a date")))?,
        None => to.with_day(1).unwrap_or(to),
    };
    if from > to {
        return Err(AppError::Validation("from is after to".into()));
    }
    Ok(Json(
        infrastructure::general_ledger(
            &state.db,
            &code,
            infrastructure::GeneralLedgerScope {
                site_id: single_value(&params, "site"),
                from,
                to,
                needle: single_value(&params, "q"),
                kinds: facet_values(&params, "kind"),
                sort: single_value(&params, "sort"),
                desc: single_value(&params, "dir").as_deref() == Some("desc"),
                cursor: single_value(&params, "cursor"),
                limit: limit_value(&params)?,
            },
        )
        .await?,
    ))
}

/// Every account that has been posted to, and the server's own proof that
/// debits equal credits.
///
/// # The proof does not move when somebody types
///
/// `as_of` and `site` define the LEDGER being proved. `q` and `class` narrow
/// only the rows: `total_debit_minor`, `total_credit_minor`, `balanced` and
/// `ledger_rows` are computed over everything, in SQL, before either is
/// applied. A trial balance narrowed to one class still says whether the books
/// balance, because that is the question it exists to answer.
///
/// # Why it pages at all
///
/// The cursor bounds the RESPONSE, not the scan: this is an aggregate over
/// every journal line on or before `as_of`, and the aggregate has to finish
/// before any row can be ordered. It is worth having anyway — the client's
/// chart is 7,528 accounts and a month where most of them move is 7,528 rows
/// of JSON into a screen that draws forty.
///
/// # Query parameters
///
/// `as_of` and `site` define the ledger. `q` searches the account code and the
/// client's own name for it; `class` filters and repeats. `sort` is one of
/// `name`, `debit`, `credit`, `net`, with `dir=desc`; anything else is the
/// chart's own order. `cursor` and `limit` page — 500 by default, because this
/// is a report somebody scrolls rather than a list they click through, and a
/// smaller page pays for the aggregate more times.
pub async fn trial_balance(
    State(state): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<TrialBalance>, AppError> {
    refuse_unknown_parameters(
        &params,
        &[&PAGING[..], &["as_of", "site", "class"]].concat(),
    )?;
    let as_of = match single_value(&params, "as_of") {
        Some(raw) => Some(
            raw.parse::<NaiveDate>()
                .map_err(|_| AppError::Validation(format!("as_of {raw:?} is not a date")))?,
        ),
        None => None,
    };
    Ok(Json(
        infrastructure::trial_balance(
            &state.db,
            infrastructure::TrialBalanceScope {
                as_of,
                site_id: single_value(&params, "site"),
                needle: single_value(&params, "q"),
                classes: facet_values(&params, "class"),
                sort: single_value(&params, "sort"),
                desc: single_value(&params, "dir").as_deref() == Some("desc"),
                cursor: single_value(&params, "cursor"),
                limit: limit_value(&params)?,
            },
        )
        .await?,
    ))
}

// ---------------------------------------------------------------------------
// The account map
// ---------------------------------------------------------------------------

/// The map: searched, filtered, sorted and paged, with the two lists it
/// cannot be read without.
///
/// `locations` and `required_keys` travel with the page rather than being
/// fetched separately because the screen's only real question — which pairs
/// are still unset — cannot be asked without all three parts. They are not
/// paged: both are small and closed.
///
/// `unmapped_pairs` is counted over EVERY location and EVERY required
/// meaning, never over the page and never narrowed by the search. A gap is a
/// gap whether or not you are currently looking at it, and a filtered view
/// reporting "0 unmapped" because the filter hid them would be the screen
/// reporting the problem solved.
///
/// # Query parameters
///
/// `q` searches the meaning, the qualifier, the account code and the client's
/// own name for that account. `site` and `key` filter, each repeatable.
/// `sort` is one of `account`, `site`, `set`, with `dir=desc`; anything else
/// is the house order, by meaning. `cursor` and `limit` page.
pub async fn account_map(
    State(state): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<AccountMapPage>, AppError> {
    refuse_unknown_parameters(&params, &[&PAGING[..], &["site", "key"]].concat())?;
    Ok(Json(
        infrastructure::account_map_page(
            &state.db,
            infrastructure::AccountMapScope {
                needle: single_value(&params, "q"),
                sites: facet_values(&params, "site"),
                keys: facet_values(&params, "key"),
                sort: single_value(&params, "sort"),
                desc: single_value(&params, "dir").as_deref() == Some("desc"),
                cursor: single_value(&params, "cursor"),
                limit: limit_value(&params)?,
            },
        )
        .await?,
    ))
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

/// What Finance is wearing on the sidebar, as three integers.
///
/// The month is the caller's: a browser in WIB and a node in UTC disagree
/// about which month it is for seven hours a day, and the badge is about the
/// operator's day. Absent, the node's own month is used.
#[derive(Debug, Deserialize)]
pub struct AttentionQuery {
    pub year: Option<i32>,
    pub month: Option<i32>,
}

pub async fn attention(
    State(state): State<AppState>,
    Query(query): Query<AttentionQuery>,
) -> Result<Json<Value>, AppError> {
    let today = chrono::Utc::now().date_naive();
    let year = query.year.unwrap_or_else(|| today.year());
    let month = query.month.unwrap_or_else(|| today.month() as i32);
    if !(1..=12).contains(&month) {
        return Err(AppError::Validation(
            "month must be between 1 and 12".into(),
        ));
    }
    Ok(Json(
        infrastructure::finance_attention_counts(&state.db, year, month).await?,
    ))
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/// The months the books are kept in: searched, filtered, sorted and paged.
///
/// Four rows today and twelve more a year, so the envelope is not about
/// length. It is about one shape: a screen should not have to know which
/// finance lists answer with an envelope and which answer with an array, and
/// "how many months are still open" is a number the server sends rather than
/// one the browser counts off a list it may have truncated.
///
/// # Query parameters
///
/// `q` searches the month's own name — `2026-09` — and whoever closed it.
/// `status` and `year` filter, each repeatable. `sort` is `entries` or
/// `closed`, with `dir=desc`; anything else is the house order, newest month
/// first. `cursor` and `limit` page.
pub async fn periods(
    State(state): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<PeriodPage>, AppError> {
    refuse_unknown_parameters(&params, &[&PAGING[..], &["status", "year"]].concat())?;
    Ok(Json(
        infrastructure::period_page(&state.db, period_scope(&params)?).await?,
    ))
}

/// The scope both period reads build, spelled once.
///
/// `open_period` answers with the whole list so the screen never has to guess
/// what changed, and it must answer in the same shape the GET does — two
/// spellings of one envelope is how a screen ends up reading `.rows` from one
/// and an array from the other.
fn period_scope(params: &[(String, String)]) -> Result<infrastructure::PeriodScope, AppError> {
    Ok(infrastructure::PeriodScope {
        needle: single_value(params, "q"),
        statuses: facet_values(params, "status"),
        years: facet_values(params, "year"),
        sort: single_value(params, "sort"),
        desc: single_value(params, "dir").as_deref() == Some("desc"),
        cursor: single_value(params, "cursor"),
        limit: limit_value(params)?,
    })
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
) -> Result<Json<PeriodPage>, AppError> {
    if !(1..=12).contains(&request.month) {
        return Err(AppError::Validation("month must be 1..12".into()));
    }
    infrastructure::open_period(&state.db, request.year, request.month).await?;
    // The whole list back, in the shape the GET answers in — see
    // [`period_scope`]. A write that answered differently from the read of the
    // same thing is a second shape for one list.
    Ok(Json(
        infrastructure::period_page(&state.db, Default::default()).await?,
    ))
}

/// Seal a month, if its checklist lets you.
///
/// The refusal is a 409 carrying the keys that stood in the way, and the
/// checklist that produced it is stored against the close that succeeds. Both
/// halves matter: the first so somebody knows what to go and fix, the second so
/// that in six months "was the bank reconciled when September closed?" has an
/// answer that is not somebody's memory of a screen.
///
/// This used to call `ledger::close_period`, which flipped the row and counted
/// the entries and asked nothing. 0126 and 0127 replaced it with a close that
/// runs the checklist FIRST, against the still-open month, and writes the
/// verdict in the same transaction as the flip. The old function is still there
/// and nothing routes to it.
///
/// `entries_sealed` survives on the outcome deliberately — it is the one figure
/// a person double-checks, and the screen already reads it — so the wire shape
/// grew rather than changed.
pub async fn close_period(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<ClosePeriodRequest>,
) -> Result<Json<infrastructure::PeriodCloseOutcome>, AppError> {
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

// ---------------------------------------------------------------------------
// The journal
// ---------------------------------------------------------------------------

/// The register: searched, filtered, sorted and paged.
///
/// The same envelope `GET /finance/money` established. `q` is the new half:
/// the search runs on the SERVER, over the entry number, the memo and the
/// source document's own id — which is what somebody has in their hand when
/// they come to the register asking "did this post". Before this they had to
/// know which month it landed in and read down the page.
///
/// # Query parameters
///
/// `from` and `to` bound the window, both inclusive. `q` searches. `kind` and
/// `site` filter and each repeats: `kind` is a `source_kind`, and `site` asks
/// whether ANY line of the entry touched that location — an entry has no
/// location of its own, and a payment can settle two shops' bills at once.
/// `sort` is one of `number`, `total`, `lines`, `kind`, with `dir=desc`;
/// anything else is the house order, newest first. `cursor` and `limit` page.
///
/// The four parameters this endpoint has always taken — `from`, `to`, `kind`,
/// `site` — mean exactly what they meant, and a caller sending one of each is
/// unaffected by the widening.
pub async fn journal(
    State(state): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<JournalPage>, AppError> {
    refuse_unknown_parameters(
        &params,
        &[&PAGING[..], &["from", "to", "kind", "site"]].concat(),
    )?;
    let date = |key: &str| -> Result<Option<NaiveDate>, AppError> {
        match single_value(&params, key) {
            Some(raw) => Ok(Some(raw.parse::<NaiveDate>().map_err(|_| {
                AppError::Validation(format!("{key} {raw:?} is not a date"))
            })?)),
            None => Ok(None),
        }
    };
    Ok(Json(
        infrastructure::journal_page(
            &state.db,
            infrastructure::JournalScope {
                from: date("from")?,
                to: date("to")?,
                needle: single_value(&params, "q"),
                kinds: facet_values(&params, "kind"),
                sites: facet_values(&params, "site"),
                sort: single_value(&params, "sort"),
                desc: single_value(&params, "dir").as_deref() == Some("desc"),
                cursor: single_value(&params, "cursor"),
                limit: limit_value(&params)?,
            },
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
    Extension(acted_on): Extension<DeclaredSubject>,
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
    acted_on.set(RecordKind::Journal, posted.entry_id.to_string());
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
    /// `BALANCE_SHEET`, `PROFIT_LOSS` or `CASH_FLOW`.
    pub kind: Option<String>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub site: Option<String>,
}

/// A statement of the books: the position, the result, or where the money went.
///
/// `CASH_FLOW` is the DIRECT method and says so — see
/// `postgres::statements::cash_flow_section` for why the indirect one is not
/// available to us. It is a window like a profit and loss, so it takes the same
/// default: the year so far.
pub async fn statement(
    State(state): State<AppState>,
    Query(query): Query<StatementQuery>,
) -> Result<Json<Statement>, AppError> {
    let to = query.to.unwrap_or_else(|| Utc::now().date_naive());
    let kind = query.kind.unwrap_or_else(|| "BALANCE_SHEET".into());
    // A profit and loss with no start is the year so far, which is what
    // somebody opening it without choosing a window almost always means. A
    // cash flow is a window too, and takes the same default for the same
    // reason — it is the one statement that REFUSES without a start rather
    // than quietly reporting since inception, because "all the cash that ever
    // moved" is not a question anybody came to ask.
    let from = query.from.or_else(|| {
        (kind == "PROFIT_LOSS" || kind == "CASH_FLOW")
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

/// The bill register: searched, filtered, sorted and paged.
///
/// # Why this answers in an envelope rather than in an array
///
/// Because a list of rows cannot say how many rows there are. A screen showing
/// fifty bills under a heading that says "50" is making a statement about the
/// page size, and the question somebody has is "50 of how many". The count has
/// to be the server's: only it has seen the other 1,234.
///
/// The shape is `GET /money`'s, deliberately and not adapted — same `rows`,
/// same `next_cursor`, same `total`, same facet counts — so that one hook in
/// the browser draws all three lists. A second list with its own spelling of
/// the same four ideas is how two tables end up disagreeing about what the
/// number beside the heading means.
///
/// # Query parameters
///
/// `q` searches the invoice number and the supplier's name. `status`,
/// `supplier` and `site` filter, and each of them repeats: two `status=`
/// parameters is how a panel with two boxes ticked spells itself, which is why
/// this reads the query string as pairs rather than into a struct — a struct's
/// deserializer keeps the last value and drops the rest, silently, so the
/// screen shows one filter's worth of rows and blames the server. `sort` is one
/// of `date`, `due`, `supplier`, `total`, `outstanding`, with `dir=desc`;
/// anything else is the house order, newest first. `cursor` and `limit` page.
///
/// The three parameters this endpoint has always taken — `status`, `supplier`,
/// `limit` — mean exactly what they meant, and a caller sending one of each is
/// unaffected by the widening.
pub async fn bills(
    State(state): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<BillPage>, AppError> {
    Ok(Json(
        infrastructure::bill_page(
            &state.db,
            infrastructure::BillScope {
                needle: single_value(&params, "q"),
                statuses: facet_values(&params, "status"),
                suppliers: facet_values(&params, "supplier"),
                sites: facet_values(&params, "site"),
                sort: single_value(&params, "sort"),
                // `dir=desc` and nothing else. Absent, empty and anything
                // unrecognised all mean ascending, which is the direction a
                // list is in before anybody touches it.
                desc: single_value(&params, "dir").as_deref() == Some("desc"),
                cursor: single_value(&params, "cursor"),
                limit: limit_value(&params)?,
            },
        )
        .await?,
    ))
}

/// One bill, with what it was for.
///
/// The detail read, and the only one that fills `lines`: an EXPENSE bill comes
/// back with the accounts it named, a MERCHANDISE bill with an empty array —
/// it genuinely has none, and that is different from the `null` the list
/// returns, which means "not fetched". `bill_page` leaves it null so drawing a
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
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<RecordBillRequest>,
) -> Result<Json<SupplierBill>, AppError> {
    let bill = infrastructure::record_bill(&state.db, &request, &principal.username).await?;
    acted_on.set(RecordKind::Bill, bill.invoice_id.to_string());
    Ok(Json(bill))
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

/// The payment register: searched, filtered, sorted and paged.
///
/// The same envelope `GET /bills` answers in, which is `GET /money`'s — see
/// the note on `bills` for why all three are one shape.
///
/// # Query parameters
///
/// `q` searches the payment number and the bank reference. `status`, `site`
/// and `supplier` filter, each repeatable. `sort` is one of `date`, `total`,
/// `number`, with `dir=desc`; anything else is the house order, most recent
/// first. `cursor` and `limit` page.
///
/// `supplier` still narrows on the ALLOCATIONS rather than on the payment: one
/// bank line settling two suppliers is an ordinary Friday, so a payment has no
/// supplier of its own. It now takes more than one, and a caller sending
/// exactly one — as every existing caller does — is unaffected.
pub async fn payments(
    State(state): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<PaymentPage>, AppError> {
    Ok(Json(
        infrastructure::payment_page(
            &state.db,
            infrastructure::PaymentScope {
                needle: single_value(&params, "q"),
                statuses: facet_values(&params, "status"),
                sites: facet_values(&params, "site"),
                suppliers: facet_values(&params, "supplier"),
                sort: single_value(&params, "sort"),
                desc: single_value(&params, "dir").as_deref() == Some("desc"),
                cursor: single_value(&params, "cursor"),
                limit: limit_value(&params)?,
            },
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
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<RecordPaymentRequest>,
) -> Result<Json<SupplierPayment>, AppError> {
    let payment = infrastructure::record_payment(&state.db, &request, &principal.username).await?;
    acted_on.set(RecordKind::Payment, payment.payment_id.to_string());
    Ok(Json(payment))
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

/// The asset register: searched, filtered, sorted and paged.
///
/// # Query parameters
///
/// `q` searches the asset number, its name and its serial — the last matters,
/// because somebody standing in front of a machine has the plate in their hand
/// and nothing else. `site`, `category`, `decision` and `status` filter, each
/// repeatable. `sort` is one of `name`, `acquired`, `cost`, `book`, with
/// `dir=desc`; anything else is the house order, by asset number. `cursor` and
/// `limit` page.
///
/// `unassessed=true` is kept because the sidebar sends it, and it is exactly
/// `decision=UNASSESSED` — "not assessed" is a state an asset is in rather
/// than a separate flag, and the boolean could only ever ask for it alone.
/// Sending both is the same request twice and narrows to the same rows.
pub async fn assets(
    State(state): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<AssetPage>, AppError> {
    refuse_unknown_parameters(
        &params,
        &[
            &PAGING[..],
            &["site", "category", "decision", "status", "unassessed"],
        ]
        .concat(),
    )?;
    let mut decisions = facet_values(&params, "decision");
    if single_value(&params, "unassessed").as_deref() == Some("true")
        && !decisions.iter().any(|value| value == "UNASSESSED")
    {
        decisions.push("UNASSESSED".into());
    }
    Ok(Json(
        infrastructure::asset_page(
            &state.db,
            infrastructure::AssetScope {
                needle: single_value(&params, "q"),
                sites: facet_values(&params, "site"),
                categories: facet_values(&params, "category"),
                decisions,
                statuses: facet_values(&params, "status"),
                sort: single_value(&params, "sort"),
                desc: single_value(&params, "dir").as_deref() == Some("desc"),
                cursor: single_value(&params, "cursor"),
                limit: limit_value(&params)?,
            },
        )
        .await?,
    ))
}

pub async fn register_asset(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<RegisterAssetRequest>,
) -> Result<Json<AssetRow>, AppError> {
    let asset = infrastructure::register_asset(&state.db, &request, &principal.username).await?;
    acted_on.set(RecordKind::Asset, asset.asset_id.to_string());
    Ok(Json(asset))
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

/// What that month would charge, asset by asset, without charging any of it.
///
/// Two differences from the run, and both are the point.
///
/// It writes nothing. The first real run on this client's register posts
/// against 683 capitalised assets at once, into their own books; looking first
/// is not a luxury there.
///
/// And it does NOT refuse when a category has no accounts mapped. The run does,
/// because it would otherwise stop halfway through and leave a month half
/// charged — but a preview that declines to answer until everything is mapped
/// is a preview of nothing. It reports the assets that have nowhere to charge,
/// on the line for each, which is the list somebody needs in order to fix them.
pub async fn preview_depreciation(
    State(state): State<AppState>,
    Json(request): Json<PeriodRequest>,
) -> Result<Json<DepreciationRun>, AppError> {
    if !(1..=12).contains(&request.month) {
        return Err(AppError::Validation("month must be 1..12".into()));
    }
    Ok(Json(
        infrastructure::preview_depreciation(&state.db, request.year, request.month as u32).await?,
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
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<MoneyOverview>, AppError> {
    // `Query<Vec<(String, String)>>` rather than a struct, for one reason:
    // `pot` and `site` repeat. `?pot=CASH&pot=BANK` is how a facet filter with
    // two boxes ticked spells itself, and a struct's deserializer keeps the
    // last value and drops the rest — silently, so the screen shows one
    // filter's worth of rows and blames the server.
    let as_of = match single_value(&params, "as_of") {
        Some(raw) => Some(
            raw.parse::<NaiveDate>()
                .map_err(|_| AppError::Validation(format!("as_of {raw:?} is not a date")))?,
        ),
        None => None,
    };
    let limit = match single_value(&params, "limit") {
        Some(raw) => Some(
            raw.parse::<i64>()
                .map_err(|_| AppError::Validation(format!("limit {raw:?} is not a number")))?,
        ),
        None => None,
    };
    Ok(Json(
        infrastructure::money_overview(
            &state.db,
            infrastructure::MoneyScope {
                as_of,
                needle: single_value(&params, "q"),
                pots: facet_values(&params, "pot"),
                // `site` stays the name it has always been, and now takes more
                // than one. An old caller sending exactly one is unaffected.
                sites: facet_values(&params, "site"),
                flags: facet_values(&params, "flag"),
                sort: single_value(&params, "sort"),
                // `dir=desc` and nothing else. Absent, empty and anything
                // unrecognised all mean ascending, which is the direction a
                // list is in before anybody touches it.
                desc: single_value(&params, "dir").as_deref() == Some("desc"),
                cursor: single_value(&params, "cursor"),
                limit,
            },
        )
        .await?,
    ))
}

// ---------------------------------------------------------------------------
// Bank reconciliation
// ---------------------------------------------------------------------------

/// What the bank has told us: searched, filtered, sorted and paged.
///
/// `total_unmatched` is the one number this screen exists for — how many lines
/// across the matched statements nobody has agreed yet. Added on the server,
/// because a browser summing a page would report reconciliation done while a
/// second page of unmatched lines waited below.
///
/// # Query parameters
///
/// `q` searches the account code, the client's name for it and whoever
/// uploaded the file. `site`, `account` and `state` filter, each repeatable;
/// `state` is `RECONCILED`, `PARTIAL` or `UNTOUCHED`, derived on read from the
/// lines and their matches rather than stored. `sort` is one of `imported`,
/// `account`, `unmatched`, with `dir=desc`; anything else is the house order,
/// most recent period first. `cursor` and `limit` page.
pub async fn bank_statements(
    State(state): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<BankStatementPage>, AppError> {
    refuse_unknown_parameters(
        &params,
        &[&PAGING[..], &["site", "account", "state"]].concat(),
    )?;
    Ok(Json(
        infrastructure::bank_statement_page(
            &state.db,
            infrastructure::BankStatementScope {
                needle: single_value(&params, "q"),
                sites: facet_values(&params, "site"),
                accounts: facet_values(&params, "account"),
                states: facet_values(&params, "state"),
                sort: single_value(&params, "sort"),
                desc: single_value(&params, "dir").as_deref() == Some("desc"),
                cursor: single_value(&params, "cursor"),
                limit: limit_value(&params)?,
            },
        )
        .await?,
    ))
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

/// Score every line with room left against our own ledger.
///
/// `?exact=0` widens the offer to everything on the account in the window,
/// still in score order — the switch ERPNext spells *exact match*, and the only
/// way to begin splitting one bank line across two vouchers. Absent means on,
/// which is what every existing caller expects.
pub async fn bank_suggestions(
    State(state): State<AppState>,
    Path(statement_id): Path<Uuid>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<Vec<LineSuggestions>>, AppError> {
    refuse_unknown_parameters(&params, &["exact"])?;
    let exact = !matches!(
        single_value(&params, "exact").as_deref(),
        Some("0") | Some("false")
    );
    Ok(Json(
        infrastructure::suggest_matches(&state.db, statement_id, exact).await?,
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

/// Take an agreement back.
///
/// `?journal_line=<uuid>` removes ONE voucher's claim; without it the line is
/// released entirely. Absent is what every existing caller sends and what it
/// has always meant, so a line settled by a single voucher is unaffected.
pub async fn unmatch_bank_line(
    State(state): State<AppState>,
    Path(line_id): Path<Uuid>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<Value>, AppError> {
    refuse_unknown_parameters(&params, &["journal_line"])?;
    let journal_line = match single_value(&params, "journal_line") {
        Some(raw) => Some(
            raw.parse::<Uuid>()
                .map_err(|_| AppError::Validation(format!("journal_line {raw:?} is not an id")))?,
        ),
        None => None,
    };
    infrastructure::unmatch(&state.db, line_id, journal_line).await?;
    Ok(Json(json!({ "matched": false })))
}

/// Say who the other side of a bank line was.
///
/// ERPNext's *Update Bank Transaction*, narrowed: the bank's own narration,
/// amount, date and reference are evidence and stay read-only. What a person
/// concluded about the line goes in its own columns beside them.
pub async fn update_bank_line(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(line_id): Path<Uuid>,
    Json(request): Json<UpdateBankLineRequest>,
) -> Result<Json<BankStatementLineRow>, AppError> {
    Ok(Json(
        infrastructure::update_line(&state.db, line_id, &request, &principal.username).await?,
    ))
}

// ---------------------------------------------------------------------------
// Our own bank accounts
// ---------------------------------------------------------------------------

/// What our accounts are, not where their postings land. `site` narrows it.
pub async fn company_bank_accounts(
    State(state): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<Vec<CompanyBankAccount>>, AppError> {
    refuse_unknown_parameters(&params, &["site"])?;
    Ok(Json(
        infrastructure::list_accounts(&state.db, single_value(&params, "site").as_deref()).await?,
    ))
}

/// Every bank anybody has named. Gathered, not maintained.
pub async fn bank_institutions(
    State(state): State<AppState>,
) -> Result<Json<Vec<BankInstitution>>, AppError> {
    Ok(Json(infrastructure::bank_institutions(&state.db).await?))
}

/// Describe an account, or correct what we said about it. One row per ledger
/// binding, so sending it twice is a correction rather than a second account.
pub async fn describe_bank_account(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<DescribeBankAccountRequest>,
) -> Result<Json<CompanyBankAccount>, AppError> {
    let account =
        infrastructure::describe_account(&state.db, &request, &principal.username).await?;
    // Filed against the ledger account, which is the record a person opens when
    // they ask what this account is and who last changed its number.
    acted_on.set(RecordKind::Account, account.ledger_account_code.clone());
    Ok(Json(account))
}

/// Stop offering an account without losing what it already paid.
pub async fn retire_bank_account(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Path(account_id): Path<Uuid>,
) -> Result<Json<CompanyBankAccount>, AppError> {
    let account =
        infrastructure::retire_account(&state.db, account_id, &principal.username).await?;
    acted_on.set(RecordKind::Account, account.ledger_account_code.clone());
    Ok(Json(account))
}

// ---------------------------------------------------------------------------
// Cash counts
// ---------------------------------------------------------------------------

/// Every count, newest first. `account` and `site` narrow it to one drawer.
pub async fn cash_counts(
    State(state): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<Vec<CashCountRow>>, AppError> {
    refuse_unknown_parameters(&params, &["account", "site"])?;
    Ok(Json(
        infrastructure::list_counts(
            &state.db,
            single_value(&params, "account").as_deref(),
            single_value(&params, "site").as_deref(),
        )
        .await?,
    ))
}

/// Write down what was in the drawer. Posts nothing — that is the next handler.
pub async fn record_cash_count(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<RecordCountRequest>,
) -> Result<Json<CashCountRow>, AppError> {
    let count = infrastructure::record_count(&state.db, &request, &principal.username).await?;
    // The drawer is the record. "This account was counted on the 13th and was
    // 25.000 short" belongs on the account's own history, not only in a list
    // somebody has to know to open.
    acted_on.set(RecordKind::Account, count.account_code.clone());
    Ok(Json(count))
}

/// Put a count's difference in the books.
///
/// Separate from recording it, and deliberately: a shortage is worth writing
/// down the moment it is found, and worth posting only once somebody has said
/// what caused it. A count with no reason is refused here.
pub async fn post_cash_count(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Path(count_id): Path<Uuid>,
    Json(request): Json<PostCountRequest>,
) -> Result<Json<CashCountRow>, AppError> {
    let count =
        infrastructure::post_variance(&state.db, count_id, &request, &principal.username).await?;
    acted_on.set(RecordKind::Account, count.account_code.clone());
    Ok(Json(count))
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

// ---------------------------------------------------------------------------
// Payment instructions
// ---------------------------------------------------------------------------

/// The instruction queue: searched, filtered, sorted and paged.
///
/// The envelope `GET /bills` and `GET /payments` answer in — see the note on
/// `bills` for why all three are one shape.
///
/// # Query parameters
///
/// `q` searches the instruction number, the payee and what it is for. `status`
/// and `site` filter, and each of them repeats or takes a comma list: two
/// `status=` parameters is how a panel with two boxes ticked spells itself,
/// which is why this reads the query string as pairs rather than into a struct.
/// `sort` is one of `needed`, `raised`, `amount`, with `dir=desc`; anything
/// else is the house order — what is needed soonest, first, with asks that
/// named no date behind those that did. `cursor` and `limit` page.
pub async fn payment_instructions(
    State(state): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<InstructionPage>, AppError> {
    refuse_unknown_parameters(&params, &[&PAGING[..], &["status", "site"]].concat())?;
    Ok(Json(
        infrastructure::instruction_page(
            &state.db,
            infrastructure::InstructionScope {
                needle: single_value(&params, "q"),
                statuses: facet_values(&params, "status"),
                sites: facet_values(&params, "site"),
                sort: single_value(&params, "sort"),
                desc: single_value(&params, "dir").as_deref() == Some("desc"),
                cursor: single_value(&params, "cursor"),
                limit: limit_value(&params)?,
            },
        )
        .await?,
    ))
}

pub async fn payment_instruction(
    State(state): State<AppState>,
    Path(instruction_id): Path<Uuid>,
) -> Result<Json<PaymentInstruction>, AppError> {
    Ok(Json(
        infrastructure::instruction(&state.db, instruction_id).await?,
    ))
}

/// Raise one. Nothing is posted, now or ever — see the note at the top of
/// `postgres::payment_instructions`.
pub async fn raise_payment_instruction(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<RaiseInstructionRequest>,
) -> Result<Json<PaymentInstruction>, AppError> {
    let raised =
        infrastructure::raise_instruction(&state.db, &request, &principal.username).await?;
    acted_on.set(
        RecordKind::PaymentInstruction,
        raised.instruction_id.to_string(),
    );
    Ok(Json(raised))
}

/// Send a draft. The ask becomes head office's to answer.
pub async fn submit_payment_instruction(
    State(state): State<AppState>,
    Path(instruction_id): Path<Uuid>,
) -> Result<Json<PaymentInstruction>, AppError> {
    Ok(Json(
        infrastructure::submit_instruction(&state.db, instruction_id).await?,
    ))
}

/// Head office's yes or no, with the vendor the payee turned out to be.
pub async fn decide_payment_instruction(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(instruction_id): Path<Uuid>,
    Json(request): Json<DecideInstructionRequest>,
) -> Result<Json<PaymentInstruction>, AppError> {
    Ok(Json(
        infrastructure::decide_instruction(
            &state.db,
            instruction_id,
            &request,
            &principal.username,
        )
        .await?,
    ))
}

/// The shop takes its own ask back.
pub async fn withdraw_payment_instruction(
    State(state): State<AppState>,
    Path(instruction_id): Path<Uuid>,
) -> Result<Json<PaymentInstruction>, AppError> {
    Ok(Json(
        infrastructure::withdraw_instruction(&state.db, instruction_id).await?,
    ))
}

/// Bind the bill and the payment the ask became. Posts nothing: the payment
/// was posted by `POST /finance/payments/{id}/post` before this was called,
/// which is why PAID is a fact rather than a click.
pub async fn settle_payment_instruction(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(instruction_id): Path<Uuid>,
    Json(request): Json<SettleInstructionRequest>,
) -> Result<Json<PaymentInstruction>, AppError> {
    Ok(Json(
        infrastructure::settle_instruction(
            &state.db,
            instruction_id,
            &request,
            &principal.username,
        )
        .await?,
    ))
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

/// The deposit register: searched, filtered, sorted and paged.
///
/// # Query parameters
///
/// `q` searches the deposit number, the slip reference and who carried it.
/// `status` and `site` filter, each repeatable. `sort` is one of `banked`,
/// `amount`, with `dir=desc`; anything else is the house order, most recently
/// banked first. `cursor` and `limit` page.
///
/// `in_transit_minor` on the envelope is the figure the Deposits screen used to
/// estimate by filtering ledger rows in the browser. It is the sum of the
/// documents, and it agrees with the `cash_in_transit` balance.
pub async fn deposits(
    State(state): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<DepositPage>, AppError> {
    refuse_unknown_parameters(&params, &[&PAGING[..], &["status", "site"]].concat())?;
    Ok(Json(
        infrastructure::deposit_page(
            &state.db,
            infrastructure::DepositScope {
                needle: single_value(&params, "q"),
                statuses: facet_values(&params, "status"),
                sites: facet_values(&params, "site"),
                sort: single_value(&params, "sort"),
                desc: single_value(&params, "dir").as_deref() == Some("desc"),
                cursor: single_value(&params, "cursor"),
                limit: limit_value(&params)?,
            },
        )
        .await?,
    ))
}

pub async fn deposit(
    State(state): State<AppState>,
    Path(deposit_id): Path<Uuid>,
) -> Result<Json<StoreDeposit>, AppError> {
    Ok(Json(infrastructure::deposit(&state.db, deposit_id).await?))
}

/// Write the slip down. Posts nothing unless `bank_now` says the bag has
/// already gone.
pub async fn record_deposit(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<RecordDepositRequest>,
) -> Result<Json<StoreDeposit>, AppError> {
    let recorded = infrastructure::record_deposit(&state.db, &request, &principal.username).await?;
    // The drawer is the record, the same choice a cash count makes: "this till
    // banked 12.000.000 on the 13th" belongs on the account's own history.
    acted_on.set(RecordKind::Account, recorded.drawer_account_code.clone());
    Ok(Json(recorded))
}

/// The bag leaves the till: credit the drawer, debit cash in transit, on the
/// day it was banked.
pub async fn bank_deposit(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Path(deposit_id): Path<Uuid>,
) -> Result<Json<StoreDeposit>, AppError> {
    let banked = infrastructure::bank_deposit(&state.db, deposit_id, &principal.username).await?;
    acted_on.set(RecordKind::Account, banked.drawer_account_code.clone());
    Ok(Json(banked))
}

/// The bank credited it: debit the bank, credit cash in transit, on the bank's
/// own date. This is the posting a statement line agrees with.
pub async fn land_deposit(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Path(deposit_id): Path<Uuid>,
    Json(request): Json<LandDepositRequest>,
) -> Result<Json<StoreDeposit>, AppError> {
    let landed =
        infrastructure::land_deposit(&state.db, deposit_id, &request, &principal.username).await?;
    acted_on.set(RecordKind::Account, landed.drawer_account_code.clone());
    Ok(Json(landed))
}

// ---------------------------------------------------------------------------
// A day's takings
// ---------------------------------------------------------------------------

/// Which days took money, and which of them are in the book.
///
/// Built from the SALES and not from the postings. A list of what has been
/// posted cannot answer the question this screen exists for, which is what has
/// NOT been — and that question had no answer at all until now: `SALE_DAY` was
/// a source kind the schema allowed and nothing ever wrote.
///
/// # Query parameters
///
/// `site` filters and repeats or takes a comma list, the way every other
/// filter in this module does. `from` and `to` are TRADING days, not instants.
/// `posted=true` or `posted=false` narrows to one side of the gap; leaving it
/// off shows both, which is what a person opening the screen wants to see.
/// `offset` is the day boundary in minutes east of UTC and defaults to WIB —
/// the same default every sales report uses, so a day here and a day there are
/// the same day.
pub async fn sale_days(
    State(state): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<SaleDayPage>, AppError> {
    refuse_unknown_parameters(
        &params,
        &["site", "from", "to", "posted", "offset", "cursor", "limit"],
    )?;
    let date = |name: &str| -> Result<Option<NaiveDate>, AppError> {
        single_value(&params, name)
            .map(|raw| {
                raw.parse::<NaiveDate>().map_err(|_| {
                    AppError::Validation(format!("{name} {raw:?} is not a date (YYYY-MM-DD)"))
                })
            })
            .transpose()
    };
    let posted = match single_value(&params, "posted").as_deref() {
        None => None,
        Some("true") => Some(true),
        Some("false") => Some(false),
        Some(other) => {
            return Err(AppError::Validation(format!(
                "posted is true or false, not {other:?}"
            )))
        }
    };
    let utc_offset_minutes = single_value(&params, "offset")
        .map(|raw| {
            raw.parse::<i32>()
                .map_err(|_| AppError::Validation(format!("offset {raw:?} is not a number")))
        })
        .transpose()?;
    Ok(Json(
        infrastructure::sale_days(
            &state.db,
            infrastructure::SaleDayScope {
                sites: facet_values(&params, "site"),
                from: date("from")?,
                to: date("to")?,
                posted,
                utc_offset_minutes,
                cursor: single_value(&params, "cursor"),
                limit: limit_value(&params)?,
            },
        )
        .await?,
    ))
}

/// Put one unit's day in the book.
///
/// The same two-step shape as `POST /finance/bills/{id}/post`: the fact is
/// already recorded — the till recorded it — and this is somebody deciding it
/// belongs in the ledger.
///
/// **Calling it twice books it once.** The second call answers with the first
/// call's entry rather than refusing, because re-posting a day is what a
/// retry, a double click and a script re-run all look like, and each of them
/// wants the same answer: here is the entry for that day. The guarantee is the
/// primary key of `sale_day_posting`, held inside the same transaction as the
/// entry — see `postgres::sale_day::post_sale_day`.
pub async fn post_sale_day(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Path((site_id, trading_day)): Path<(String, NaiveDate)>,
    Json(request): Json<PostSaleDayRequest>,
) -> Result<Json<SaleDayRow>, AppError> {
    let day = infrastructure::post_sale_day(
        &state.db,
        &site_id,
        trading_day,
        &request,
        &principal.username,
    )
    .await?;
    // Filed against the journal entry, which is the record somebody opens when
    // they ask what this day did to the books.
    if let Some(entry_id) = day.entry_id {
        acted_on.set(RecordKind::Journal, entry_id.to_string());
    }
    Ok(Json(day))
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
    Path(period): Path<String>,
) -> Result<Json<crate::cloud::domain::CloseVerdict>, AppError> {
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
    ///
    /// `serde(default)` because the screen has been sending `{year, month}`
    /// since before a reason existed, and a missing field is not the same as a
    /// refused close.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub reason: Option<String>,
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
) -> Result<Json<PeriodPage>, AppError> {
    let (year, month) = parse_period(&period)?;
    infrastructure::period_reopen(&state.db, year, month, &principal.username, &request.reason)
        .await?;
    // The whole list back, in the shape the GET answers in — see
    // [`period_scope`]. A write that answered differently from the read of the
    // same thing is a second shape for one list.
    Ok(Json(
        infrastructure::period_page(&state.db, Default::default()).await?,
    ))
}

/// Every close and reopen this month has had, newest first.
pub async fn period_events(
    State(state): State<AppState>,
    Path(period): Path<String>,
) -> Result<Json<Vec<infrastructure::PeriodEvent>>, AppError> {
    let (year, month) = parse_period(&period)?;
    Ok(Json(
        infrastructure::period_events(&state.db, year, month).await?,
    ))
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
    Query(query): Query<CorrectionQuery>,
) -> Result<Json<Vec<CorrectionDocument>>, AppError> {
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
    Path(correction_id): Path<Uuid>,
) -> Result<Json<CorrectionDocument>, AppError> {
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
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<ReclassRequest>,
) -> Result<Json<CorrectionDocument>, AppError> {
    let document = infrastructure::reclass_create(&state.db, &request, &principal.username).await?;
    acted_on.set(RecordKind::Correction, document.correction_id.to_string());
    Ok(Json(document))
}

pub async fn create_adjustment(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<AdjustmentRequest>,
) -> Result<Json<CorrectionDocument>, AppError> {
    let document =
        infrastructure::adjustment_create(&state.db, &request, &principal.username).await?;
    acted_on.set(RecordKind::Correction, document.correction_id.to_string());
    Ok(Json(document))
}

pub async fn create_write_off(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<WriteOffRequest>,
) -> Result<Json<CorrectionDocument>, AppError> {
    let document =
        infrastructure::write_off_create(&state.db, &request, &principal.username).await?;
    acted_on.set(RecordKind::Correction, document.correction_id.to_string());
    Ok(Json(document))
}

/// Agree a correction somebody else drafted.
///
/// `finance.approve`, never `finance.post`. The two keys exist so that the
/// second person is a different person, and the check that they are is made
/// against `created_by` in the infrastructure and again by a CHECK on the row —
/// a rule enforced in one place is a rule with one place to go wrong.
/// Agree a correction somebody else drafted.
///
/// The username here is load-bearing, and not for the audit trail alone: 0129
/// carries `CHECK (approved_by IS NULL OR approved_by <> created_by)`, so an
/// approver who is spelled the same as the author is REFUSED BY THE DATABASE.
/// While both sides said `"system"` no correction in the estate could be
/// approved, and therefore none could be posted — six routes with nothing
/// behind them.
pub async fn approve_correction(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(correction_id): Path<Uuid>,
) -> Result<Json<CorrectionDocument>, AppError> {
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
