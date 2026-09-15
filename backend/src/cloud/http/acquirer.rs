//! Two surfaces for one card sale: the shop's evening, and head office's day.
//!
//! Every write goes through `postgres::acquirer`, and everything that touches
//! the books goes from there through `poster::post`. Nothing here decides what
//! a valid journal entry is.
//!
//! # Why the store routes carry the site in the path
//!
//! A reconciliation has a `recon_id`, and routing the shop's own screens at
//! `/tender-recon/{recon_id}` would be shorter. It would also mean the site is
//! a fact this layer has to go and look up before it can decide whether the
//! caller may see the row — and a route that forgot to look it up would work
//! perfectly, for everybody, including the manager of another shop.
//!
//! So the shop's site is in every path under `/finance/store/{site}/...`, the
//! reach check is the same three lines on every handler, and a reconciliation
//! reached with the wrong site in the path is refused before it is read. The id
//! still identifies the row; the site is what says who may ask.
//!
//! # About the role checks
//!
//! `domain::auth::required_role` already puts `/api/v1/finance` behind
//! SUPERVISOR to read and ADMIN to write, and the middleware runs before any
//! handler here. These are not redundant with it: they survive somebody moving
//! a route to another prefix, and they refuse by naming the person and the act
//! rather than a role.
//!
//! One rule is worth stating out loud. A shop closes its own evening — opening
//! the reconciliation, keying the slip, saying MATCHED or NO_SETTLEMENT or
//! OTHER_DAY or RETURNED, closing it — at SUPERVISOR, because those record what
//! the shop found and change nothing in the books. RETENDER is the exception
//! and needs ADMIN: it moves a receivable from one acquirer to another and,
//! when the day is already posted, writes a journal entry to do it. That is the
//! same bar `lane_a_routes` puts on the same act, reached from a different
//! screen, and the two must not disagree about who may perform it.

use super::auth::Principal;
use super::employment::reach_of;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{role_allows, Role},
    postgres::{
        self as infrastructure, AcquirerReceivableAging, AcquirerSettlementDetail,
        AcquirerSettlementRow, CloseTenderReconRequest, CreateAcquirerSettlementRequest,
        CurateSettlementRequest, ExplainSettlementRequest, MatchSettlementRequest,
        OpenTenderReconRequest, RecordTenderBatchRequest, RecordTenderDecisionRequest,
        SettlementReportOutcome, TenderDecisionOutcome, TenderReconDetail, TenderReconciliationRow,
        TenderSuggestionsView, UploadSettlementReportRequest,
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

/// May this caller act on this shop's evening?
///
/// The reach comes from the caller's own open posting, not from the session:
/// a place stamped into a credential is wrong from the day somebody transfers
/// until the day they next sign in, which is precisely the week it matters.
/// Head office and ADMIN reach everywhere; a store manager reaches their own
/// shop and nowhere else; somebody HR has not posted reaches nothing.
async fn at_store(
    state: &AppState,
    principal: &Principal,
    site_id: &str,
    act: &str,
) -> Result<(), AppError> {
    allowed(principal, Role::Supervisor, act)?;
    if reach_of(state, principal).await?.covers(Some(site_id)) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} is not posted at {site_id}, so may not {act} there",
        principal.username
    )))
}

// ---------------------------------------------------------------------------
// The shop's evening
// ---------------------------------------------------------------------------

/// Every reconciliation this shop has open or closed for one day.
pub async fn tender_recon_list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((site_id, business_date)): Path<(String, NaiveDate)>,
) -> Result<Json<Vec<TenderReconciliationRow>>, AppError> {
    at_store(&state, &principal, &site_id, "read a day's takings").await?;
    Ok(Json(
        infrastructure::tender_recon_list(&state.db, &site_id, business_date).await?,
    ))
}

/// Open one, or hand back the one that is already open.
///
/// Idempotent, because "open today's card reconciliation" is what the screen
/// does every time it loads and a refusal there would be a refusal to show a
/// shop its own evening.
pub async fn tender_recon_open(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((site_id, business_date)): Path<(String, NaiveDate)>,
    Json(request): Json<OpenTenderReconRequest>,
) -> Result<Json<TenderReconciliationRow>, AppError> {
    at_store(&state, &principal, &site_id, "open a reconciliation").await?;
    Ok(Json(
        infrastructure::tender_recon_open(
            &state.db,
            &site_id,
            business_date,
            &request,
            &principal.username,
        )
        .await?,
    ))
}

/// Both lists and every answer given so far.
pub async fn tender_recon_detail(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((site_id, _business_date, recon_id)): Path<(String, NaiveDate, Uuid)>,
) -> Result<Json<TenderReconDetail>, AppError> {
    at_store(&state, &principal, &site_id, "read a reconciliation").await?;
    Ok(Json(
        infrastructure::tender_recon_detail(&state.db, recon_id).await?,
    ))
}

/// Key in what the terminal printed.
pub async fn tender_recon_record_batch(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((site_id, _business_date, recon_id)): Path<(String, NaiveDate, Uuid)>,
    Json(request): Json<RecordTenderBatchRequest>,
) -> Result<Json<i64>, AppError> {
    at_store(&state, &principal, &site_id, "key in a batch slip").await?;
    Ok(Json(
        infrastructure::tender_recon_record_batch(
            &state.db,
            recon_id,
            &request,
            &principal.username,
        )
        .await?,
    ))
}

/// What the two lists suggest about each other.
pub async fn tender_recon_suggest(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((site_id, _business_date, recon_id)): Path<(String, NaiveDate, Uuid)>,
) -> Result<Json<TenderSuggestionsView>, AppError> {
    at_store(&state, &principal, &site_id, "read the suggestions").await?;
    Ok(Json(
        infrastructure::tender_recon_suggest(&state.db, recon_id).await?,
    ))
}

/// Record one answer.
pub async fn tender_recon_decide(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((site_id, _business_date, recon_id)): Path<(String, NaiveDate, Uuid)>,
    Json(request): Json<RecordTenderDecisionRequest>,
) -> Result<Json<TenderDecisionOutcome>, AppError> {
    at_store(&state, &principal, &site_id, "answer a reconciliation").await?;
    // The one answer of the five that moves money. See the module header: this
    // is the same bar `/finance/tenders/{id}/retender` puts on the same act,
    // and a shop that could reach it from here at SUPERVISOR would be a way
    // round that route rather than a second screen onto it.
    if request.decision.trim().eq_ignore_ascii_case("RETENDER") {
        allowed(
            &principal,
            Role::Admin,
            "move a receipt to another acquirer",
        )?;
    }
    Ok(Json(
        infrastructure::tender_recon_decide(&state.db, recon_id, &request, &principal.username)
            .await?,
    ))
}

/// Close it, if everything on both lists has an answer.
pub async fn tender_recon_close(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((site_id, _business_date, recon_id)): Path<(String, NaiveDate, Uuid)>,
    Json(request): Json<CloseTenderReconRequest>,
) -> Result<Json<TenderReconciliationRow>, AppError> {
    at_store(&state, &principal, &site_id, "close a reconciliation").await?;
    Ok(Json(
        infrastructure::tender_recon_close(&state.db, recon_id, &request, &principal.username)
            .await?,
    ))
}

// ---------------------------------------------------------------------------
// Head office's next day
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct AcqSettlementQuery {
    pub acquirer: Option<String>,
    /// `DRAFT`, `CURATED`, `MATCHED` or `EXCEPTION`.
    pub status: Option<String>,
    pub limit: Option<i64>,
}

fn some_text(value: &Option<String>) -> Option<&str> {
    value.as_deref().map(str::trim).filter(|v| !v.is_empty())
}

pub async fn acq_settlement_list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<AcqSettlementQuery>,
) -> Result<Json<Vec<AcquirerSettlementRow>>, AppError> {
    allowed(&principal, Role::Supervisor, "read acquirer settlements")?;
    Ok(Json(
        infrastructure::acq_settlement_list(
            &state.db,
            some_text(&query.acquirer),
            some_text(&query.status),
            query.limit.unwrap_or(200),
        )
        .await?,
    ))
}

pub async fn acq_settlement_detail(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(settlement_id): Path<Uuid>,
) -> Result<Json<AcquirerSettlementDetail>, AppError> {
    allowed(&principal, Role::Supervisor, "read an acquirer settlement")?;
    Ok(Json(
        infrastructure::acq_settlement_detail(&state.db, settlement_id).await?,
    ))
}

/// Key a settlement, or the shape of one, before anybody stands behind it.
pub async fn acq_settlement_create(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<CreateAcquirerSettlementRequest>,
) -> Result<Json<AcquirerSettlementRow>, AppError> {
    // A draft posts nothing, so keying one is SUPERVISOR. Standing behind it is
    // a different act with a different bar; see `acq_settlement_curate`.
    allowed(&principal, Role::Supervisor, "key an acquirer settlement")?;
    Ok(Json(
        infrastructure::acq_settlement_create(&state.db, &request, &principal.username).await?,
    ))
}

/// Take in the acquirer's own report and say what it contains.
///
/// The body carries the file's text rather than a multipart upload. A daily
/// settlement report is a few kilobytes of digits, the screen has to show what
/// was pasted anyway, and one shape for "pasted" and "uploaded" is one path to
/// get right rather than two.
pub async fn acq_settlement_upload_report(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(settlement_id): Path<Uuid>,
    Json(request): Json<UploadSettlementReportRequest>,
) -> Result<Json<SettlementReportOutcome>, AppError> {
    allowed(&principal, Role::Supervisor, "read in a settlement report")?;
    Ok(Json(
        infrastructure::acq_settlement_upload_report(
            &state.db,
            settlement_id,
            &request,
            &principal.username,
        )
        .await?,
    ))
}

/// Stand behind the reading, and post it.
pub async fn acq_settlement_curate(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(settlement_id): Path<Uuid>,
    Json(request): Json<CurateSettlementRequest>,
) -> Result<Json<AcquirerSettlementRow>, AppError> {
    allowed(
        &principal,
        Role::Admin,
        "curate an acquirer settlement into the ledger",
    )?;
    Ok(Json(
        infrastructure::acq_settlement_curate(
            &state.db,
            settlement_id,
            &request,
            &principal.username,
        )
        .await?,
    ))
}

/// Agree that the bank credit and this settlement are the same money.
pub async fn acq_settlement_match(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(settlement_id): Path<Uuid>,
    Json(request): Json<MatchSettlementRequest>,
) -> Result<Json<AcquirerSettlementRow>, AppError> {
    allowed(&principal, Role::Admin, "match a settlement to a bank line")?;
    Ok(Json(
        infrastructure::acq_settlement_match(
            &state.db,
            settlement_id,
            &request,
            &principal.username,
        )
        .await?,
    ))
}

/// Say why the bank paid something else, and book it when it is a cost.
pub async fn acq_settlement_explain(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(settlement_id): Path<Uuid>,
    Json(request): Json<ExplainSettlementRequest>,
) -> Result<Json<AcquirerSettlementRow>, AppError> {
    allowed(&principal, Role::Admin, "explain a settlement difference")?;
    Ok(Json(
        infrastructure::acq_settlement_explain(
            &state.db,
            settlement_id,
            &request,
            &principal.username,
        )
        .await?,
    ))
}

/// Which meanings this settlement would need mapped before it could post.
///
/// Offered so the screen can say "BCA has no fee account at C003" before
/// somebody curates and is refused by the poster with the same news.
pub async fn acq_settlement_unmapped_keys(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(settlement_id): Path<Uuid>,
) -> Result<Json<Vec<String>>, AppError> {
    allowed(&principal, Role::Supervisor, "read an acquirer settlement")?;
    Ok(Json(
        infrastructure::acq_settlement_unmapped_keys(&state.db, settlement_id).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AcqAgingQuery {
    /// The day the ages are measured against. Today, unless somebody is
    /// reproducing last month's report.
    pub as_of: Option<NaiveDate>,
    pub acquirer: Option<String>,
    pub site: Option<String>,
}

/// What each acquirer still owes each shop, by how long it has owed it.
pub async fn acq_receivable_aging(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<AcqAgingQuery>,
) -> Result<Json<AcquirerReceivableAging>, AppError> {
    allowed(&principal, Role::Supervisor, "read the acquirer ageing")?;
    let as_of = query
        .as_of
        .unwrap_or_else(|| infrastructure::acquirer_business_date(chrono::Utc::now()));
    Ok(Json(
        infrastructure::acq_receivable_aging(
            &state.db,
            as_of,
            some_text(&query.acquirer),
            some_text(&query.site),
        )
        .await?,
    ))
}

/// The lane's routes, added to the router in one line.
///
/// A function rather than a block inside `router()` because several modules are
/// being built against that function at once, and a block each is a merge
/// conflict each.
pub fn lane_h_routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route(
            "/api/v1/finance/store/{site}/tender-recon/{date}",
            get(tender_recon_list).post(tender_recon_open),
        )
        .route(
            "/api/v1/finance/store/{site}/tender-recon/{date}/{recon_id}",
            get(tender_recon_detail),
        )
        .route(
            "/api/v1/finance/store/{site}/tender-recon/{date}/{recon_id}/batch",
            post(tender_recon_record_batch),
        )
        .route(
            "/api/v1/finance/store/{site}/tender-recon/{date}/{recon_id}/suggestions",
            get(tender_recon_suggest),
        )
        .route(
            "/api/v1/finance/store/{site}/tender-recon/{date}/{recon_id}/decide",
            post(tender_recon_decide),
        )
        .route(
            "/api/v1/finance/store/{site}/tender-recon/{date}/{recon_id}/close",
            post(tender_recon_close),
        )
        .route(
            "/api/v1/finance/acquirer-settlements",
            get(acq_settlement_list).post(acq_settlement_create),
        )
        .route(
            "/api/v1/finance/acquirer-settlements/{id}",
            get(acq_settlement_detail),
        )
        .route(
            "/api/v1/finance/acquirer-settlements/{id}/report",
            post(acq_settlement_upload_report),
        )
        .route(
            "/api/v1/finance/acquirer-settlements/{id}/curate",
            post(acq_settlement_curate),
        )
        .route(
            "/api/v1/finance/acquirer-settlements/{id}/match",
            post(acq_settlement_match),
        )
        .route(
            "/api/v1/finance/acquirer-settlements/{id}/explain",
            post(acq_settlement_explain),
        )
        .route(
            "/api/v1/finance/acquirer-settlements/{id}/unmapped",
            get(acq_settlement_unmapped_keys),
        )
        .route(
            "/api/v1/finance/acquirer-receivable-aging",
            get(acq_receivable_aging),
        )
}
