//! The money-document surface: cash documents, bank rules, giros.
//!
//! # RBAC comes from the path, not from a guard here
//!
//! `domain::auth::required_role` makes every `/api/v1/finance/…` GET a
//! SUPERVISOR read and every mutation under it ADMIN, and it says why: a till
//! operator has no business reading the ledger or the supplier balances, and
//! the acts that move money are the ones the company's owner signs for. Every
//! route below sits under that prefix on purpose, so approving a cash document
//! and posting a journal entry are gated by the same rule rather than by two
//! rules somebody has to keep in agreement.
//!
//! The one thing that gate cannot express is maker-and-checker — a document
//! approved by whoever keyed it. `cash_document` records `created_by` and
//! `approved_by` separately and the slip prints three signature lines, so the
//! paper asks the question. Enforcing it in code would need a fourth role, and
//! `Role` is on the wire that Edge and Store speak.

use super::auth::Principal;
use super::scope::Scope;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, BankRuleProposalRow, BankRuleRow, BankRuleRunOutcome,
        CashDocumentRepeat, CashDocumentRepeatSweep, CashDocumentRow,
        SaveCashDocumentRepeatRequest, CashDocumentSlip, GiroBoard, GiroRow, RecordBankRuleRequest,
        RecordCashDocumentRequest, RecordVoucherRequest, ReplaceGiroRequest, SettleGiroRequest, UnclearGiroRequest,
    },
};
use axum::{
    extract::{Path, Query, State},
    routing::{get, patch, post},
    Extension, Json, Router,
};
use chrono::{NaiveDate, Utc};
use serde::Deserialize;
use uuid::Uuid;

fn limit_of(limit: Option<i64>) -> i64 {
    limit.unwrap_or(100)
}

// ── cash documents ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CashDocumentQuery {
    pub status: Option<String>,
    /// `PAY`, `RECEIVE` or `TRANSFER`.
    pub kind: Option<String>,
    /// Either side. A unit's screen wants the documents that touched its
    /// books, whichever direction the money went.
    pub unit_id: Option<String>,
    pub limit: Option<i64>,
}

pub async fn cash_documents(
    State(state): State<AppState>,
    scope: Scope,
    Query(query): Query<CashDocumentQuery>,
) -> Result<Json<Vec<CashDocumentRow>>, AppError> {
    // Either side: a bounded caller sees the documents that touched their own
    // unit's books, whichever way the money went.
    let unit_id = scope.unit(query.unit_id.clone())?;
    Ok(Json(
        infrastructure::cash_document_list(
            &state.db,
            query.status.as_deref(),
            query.kind.as_deref(),
            unit_id.as_deref(),
            limit_of(query.limit),
        )
        .await?,
    ))
}

pub async fn cash_document(
    State(state): State<AppState>,
    scope: Scope,
    Path(document_id): Path<Uuid>,
) -> Result<Json<CashDocumentRow>, AppError> {
    let document = infrastructure::cash_document_read(&state.db, document_id).await?;
    // Readable from either side it touched.
    if scope.require_unit(&document.from_unit).is_err() {
        scope.require_unit(&document.to_unit)?;
    }
    Ok(Json(
        document,
    ))
}

/// Key one. It is not numbered and it is not in the books.
pub async fn record_cash_document(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordCashDocumentRequest>,
) -> Result<Json<CashDocumentRow>, AppError> {
    Ok(Json(
        infrastructure::cash_document_record(&state.db, &request, &principal.username).await?,
    ))
}

/// Key a BKK or BKM with lines (0711): bills settled, other accounts paid or
/// received, advances netted off. Not numbered, not in the books yet.
pub async fn record_voucher(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordVoucherRequest>,
) -> Result<Json<CashDocumentRow>, AppError> {
    Ok(Json(
        infrastructure::voucher_record(&state.db, &request, &principal.username).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct RepeatsQuery {
    /// `OUT` for the BKK register, `IN` for the BKM one; absent for both.
    pub direction: Option<String>,
}

/// The BKKs and BKMs that repeat (0716).
pub async fn cash_document_repeats(
    State(state): State<AppState>,
    Query(query): Query<RepeatsQuery>,
) -> Result<Json<Vec<CashDocumentRepeat>>, AppError> {
    Ok(Json(
        infrastructure::cash_document_repeats(&state.db, query.direction.as_deref()).await?,
    ))
}

/// Start a repeat, or change one. The voucher is checked as if it ran on its
/// next date, so one that would be refused then is refused now.
pub async fn save_cash_document_repeat(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<SaveCashDocumentRepeatRequest>,
) -> Result<Json<CashDocumentRepeat>, AppError> {
    Ok(Json(
        infrastructure::save_cash_document_repeat(&state.db, &request, &principal.username)
            .await?,
    ))
}

/// Raise every repeat due today now, instead of waiting for the hourly sweep.
/// Drafts only: each still needs approving and posting.
pub async fn run_cash_document_repeats(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<CashDocumentRepeatSweep>, AppError> {
    Ok(Json(
        infrastructure::run_cash_document_repeats(
            &state.db,
            Utc::now().date_naive(),
            &principal.username,
        )
        .await?,
    ))
}

/// Approve it, which is where the number comes from.
pub async fn approve_cash_document(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(document_id): Path<Uuid>,
) -> Result<Json<CashDocumentRow>, AppError> {
    Ok(Json(
        infrastructure::cash_document_approve(&state.db, document_id, &principal.username).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct PostOn {
    /// Which day it lands in the ledger. Defaults to the document's own date;
    /// present because a slip written on the 30th and approved on the 2nd
    /// belongs in the month it was written, and only a person knows which.
    pub posting_date: Option<NaiveDate>,
}

pub async fn post_cash_document(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(document_id): Path<Uuid>,
    Json(request): Json<PostOn>,
) -> Result<Json<CashDocumentRow>, AppError> {
    Ok(Json(
        infrastructure::cash_document_post(
            &state.db,
            document_id,
            request.posting_date,
            &principal.username,
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct ReverseRequest {
    pub posting_date: Option<NaiveDate>,
    pub reason: String,
}

pub async fn reverse_cash_document(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(document_id): Path<Uuid>,
    Json(request): Json<ReverseRequest>,
) -> Result<Json<CashDocumentRow>, AppError> {
    Ok(Json(
        infrastructure::cash_document_reverse(
            &state.db,
            document_id,
            request.posting_date,
            &request.reason,
            &principal.username,
        )
        .await?,
    ))
}

/// Everything printed on the Bukti Kas Keluar / Masuk.
///
/// A payload and not a PDF. What the client's paper looks like is their
/// business — they have a pre-printed pad — and a server that rendered it would
/// be a server that has to be redeployed when the pad changes.
pub async fn cash_document_slip(
    State(state): State<AppState>,
    Path(document_id): Path<Uuid>,
) -> Result<Json<CashDocumentSlip>, AppError> {
    Ok(Json(
        infrastructure::cash_document_slip(&state.db, document_id).await?,
    ))
}

// ── bank rules ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RuleQuery {
    /// Retired rules are hidden by default and askable for: a proposal names
    /// the rule that made it, and a rule somebody turned off is still the
    /// answer to "why was this booked there".
    pub include_retired: Option<bool>,
}

pub async fn bank_rules(
    State(state): State<AppState>,
    Query(query): Query<RuleQuery>,
) -> Result<Json<Vec<BankRuleRow>>, AppError> {
    Ok(Json(
        infrastructure::bank_rule_list(&state.db, query.include_retired.unwrap_or(false)).await?,
    ))
}

pub async fn record_bank_rule(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordBankRuleRequest>,
) -> Result<Json<BankRuleRow>, AppError> {
    Ok(Json(
        infrastructure::bank_rule_record(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn update_bank_rule(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(rule_id): Path<Uuid>,
    Json(request): Json<RecordBankRuleRequest>,
) -> Result<Json<BankRuleRow>, AppError> {
    Ok(Json(
        infrastructure::bank_rule_update(&state.db, rule_id, &request, &principal.username).await?,
    ))
}

/// Retire it. Never delete: a proposal names the rule that made it.
pub async fn retire_bank_rule(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(rule_id): Path<Uuid>,
) -> Result<Json<BankRuleRow>, AppError> {
    Ok(Json(
        infrastructure::bank_rule_retire(&state.db, rule_id, &principal.username).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct EvaluateRequest {
    /// One statement, or every open line when absent.
    pub statement_id: Option<Uuid>,
}

/// Run the rules. This posts nothing, and that is the design.
pub async fn evaluate_bank_rules(
    State(state): State<AppState>,
    Json(request): Json<EvaluateRequest>,
) -> Result<Json<BankRuleRunOutcome>, AppError> {
    Ok(Json(
        infrastructure::bank_rule_evaluate(&state.db, request.statement_id).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct ProposalQuery {
    pub status: Option<String>,
    pub statement_id: Option<Uuid>,
    pub limit: Option<i64>,
}

pub async fn bank_proposals(
    State(state): State<AppState>,
    Query(query): Query<ProposalQuery>,
) -> Result<Json<Vec<BankRuleProposalRow>>, AppError> {
    Ok(Json(
        infrastructure::bank_proposal_list(
            &state.db,
            query.status.as_deref(),
            query.statement_id,
            limit_of(query.limit),
        )
        .await?,
    ))
}

/// A person agrees, and only now does a document exist.
pub async fn accept_bank_proposal(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(proposal_id): Path<Uuid>,
) -> Result<Json<CashDocumentRow>, AppError> {
    Ok(Json(
        infrastructure::bank_proposal_accept(&state.db, proposal_id, &principal.username).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct IgnoreRequest {
    pub reason: Option<String>,
}

pub async fn ignore_bank_proposal(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(proposal_id): Path<Uuid>,
    Json(request): Json<IgnoreRequest>,
) -> Result<Json<BankRuleProposalRow>, AppError> {
    Ok(Json(
        infrastructure::bank_proposal_ignore(
            &state.db,
            proposal_id,
            request.reason.as_deref(),
            &principal.username,
        )
        .await?,
    ))
}

// ── giros ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct GiroQuery {
    pub status: Option<String>,
    pub bank: Option<String>,
    /// `OUT` we wrote it, `IN` somebody gave us one.
    pub direction: Option<String>,
    /// What "overdue by" is counted from. Today when absent.
    pub as_of: Option<NaiveDate>,
    pub limit: Option<i64>,
}

pub async fn giros(
    State(state): State<AppState>,
    Query(query): Query<GiroQuery>,
) -> Result<Json<Vec<GiroRow>>, AppError> {
    Ok(Json(
        infrastructure::giro_list(
            &state.db,
            query.status.as_deref(),
            query.bank.as_deref(),
            query.direction.as_deref(),
            query.as_of,
            limit_of(query.limit),
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct BoardQuery {
    /// The day the board is drawn for. Defaults to today; askable so a Monday
    /// morning can be reviewed as it looked on Friday.
    pub as_of: Option<NaiveDate>,
}

/// Outstanding per bank, due this week, overdue.
pub async fn giro_board(
    State(state): State<AppState>,
    Query(query): Query<BoardQuery>,
) -> Result<Json<GiroBoard>, AppError> {
    let as_of = query.as_of.unwrap_or_else(|| Utc::now().date_naive());
    Ok(Json(infrastructure::giro_board(&state.db, as_of).await?))
}

pub async fn giro(
    State(state): State<AppState>,
    Path(giro_id): Path<Uuid>,
) -> Result<Json<GiroRow>, AppError> {
    Ok(Json(infrastructure::giro_read(&state.db, giro_id).await?))
}

/// Handed over. No posting; it is where the paper is.
pub async fn deliver_giro(
    State(state): State<AppState>,
    Path(giro_id): Path<Uuid>,
) -> Result<Json<GiroRow>, AppError> {
    Ok(Json(
        infrastructure::giro_deliver(&state.db, giro_id).await?,
    ))
}

/// The date arrived and the bank has not taken it. Also no posting.
pub async fn mark_giro_due(
    State(state): State<AppState>,
    Path(giro_id): Path<Uuid>,
) -> Result<Json<GiroRow>, AppError> {
    Ok(Json(
        infrastructure::giro_mark_due(&state.db, giro_id).await?,
    ))
}

/// The bank took it. The only act that moves the bank balance.
pub async fn clear_giro(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(giro_id): Path<Uuid>,
    Json(request): Json<SettleGiroRequest>,
) -> Result<Json<GiroRow>, AppError> {
    Ok(Json(
        infrastructure::giro_clear(
            &state.db,
            giro_id,
            request.on,
            request.statement_line_id,
            &principal.username,
        )
        .await?,
    ))
}

/// It bounced. The issue is reversed and the debt comes back.
pub async fn reject_giro(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(giro_id): Path<Uuid>,
    Json(request): Json<SettleGiroRequest>,
) -> Result<Json<GiroRow>, AppError> {
    Ok(Json(
        infrastructure::giro_reject(
            &state.db,
            giro_id,
            request.on,
            request.reason.as_deref().unwrap_or(""),
            &principal.username,
        )
        .await?,
    ))
}

/// Batal Cair: the clearing was wrong and is taken back (0705). The clearing
/// entry is reversed into an open month and the giro is outstanding again.
pub async fn unclear_giro(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(giro_id): Path<Uuid>,
    Json(request): Json<UnclearGiroRequest>,
) -> Result<Json<GiroRow>, AppError> {
    Ok(Json(
        infrastructure::giro_unclear(
            &state.db,
            giro_id,
            request.on,
            &request.reason,
            &principal.username,
        )
        .await?,
    ))
}

/// Say which payment or cash document replaced a bounced giro (0705).
pub async fn replace_giro(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(giro_id): Path<Uuid>,
    Json(request): Json<ReplaceGiroRequest>,
) -> Result<Json<GiroRow>, AppError> {
    Ok(Json(
        infrastructure::giro_replace(&state.db, giro_id, &request, &principal.username).await?,
    ))
}

// ── routes ───────────────────────────────────────────────────────────────

/// Every route this lane adds, in one function called once from `router()`.
///
/// Gathered rather than spliced into the big builder because the surface is one
/// subject — money moving, and the paper behind it — and because four lanes
/// editing one four-hundred-line chain is four conflicts in the same hunk.
///
/// All under `/api/v1/finance`, which is where the role gate lives: GET is
/// SUPERVISOR, everything else ADMIN. See the module header.
pub fn lane_c_routes(router: Router<AppState>) -> Router<AppState> {
    router
        // The documents themselves. Keyed, approved, posted, reversed — four
        // acts and not one, because the number is taken at approval and a
        // draft somebody abandons should burn none.
        .route(
            "/api/v1/finance/cash-documents",
            get(cash_documents).post(record_cash_document),
        )
        .route(
            "/api/v1/finance/cash-documents/voucher",
            post(record_voucher),
        )
        .route("/api/v1/finance/cash-documents/{id}", get(cash_document))
        .route(
            "/api/v1/finance/cash-documents/{id}/approve",
            post(approve_cash_document),
        )
        .route(
            "/api/v1/finance/cash-documents/{id}/post",
            post(post_cash_document),
        )
        .route(
            "/api/v1/finance/cash-documents/{id}/reverse",
            post(reverse_cash_document),
        )
        // What goes on the pad.
        .route(
            "/api/v1/finance/cash-documents/{id}/slip",
            get(cash_document_slip),
        )
        // BKKs and BKMs that repeat (0716): drafts on a schedule, never posted.
        .route(
            "/api/v1/finance/cash-document-repeats",
            get(cash_document_repeats).post(save_cash_document_repeat),
        )
        .route(
            "/api/v1/finance/cash-document-repeats/run",
            post(run_cash_document_repeats),
        )
        // The rules that recognise a bank line, and the proposals they make.
        // `evaluate` is a POST and writes proposal rows; it posts no money, and
        // the split between it and `accept` is the whole design.
        .route(
            "/api/v1/finance/bank-rules",
            get(bank_rules).post(record_bank_rule),
        )
        .route(
            "/api/v1/finance/bank-rules/{id}",
            patch(update_bank_rule).delete(retire_bank_rule),
        )
        .route(
            "/api/v1/finance/bank-rules/evaluate",
            post(evaluate_bank_rules),
        )
        .route("/api/v1/finance/bank-proposals", get(bank_proposals))
        .route(
            "/api/v1/finance/bank-proposals/{id}/accept",
            post(accept_bank_proposal),
        )
        .route(
            "/api/v1/finance/bank-proposals/{id}/ignore",
            post(ignore_bank_proposal),
        )
        // Giros. The board first, because it is the screen somebody opens.
        .route("/api/v1/finance/giros", get(giros))
        .route("/api/v1/finance/giros/board", get(giro_board))
        .route("/api/v1/finance/giros/{id}", get(giro))
        .route("/api/v1/finance/giros/{id}/deliver", post(deliver_giro))
        .route("/api/v1/finance/giros/{id}/due", post(mark_giro_due))
        .route("/api/v1/finance/giros/{id}/clear", post(clear_giro))
        .route("/api/v1/finance/giros/{id}/reject", post(reject_giro))
        .route("/api/v1/finance/giros/{id}/unclear", post(unclear_giro))
        .route("/api/v1/finance/giros/{id}/replace", post(replace_giro))
}
