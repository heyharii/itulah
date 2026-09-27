//! Store money over HTTP: the drawer, the deposit, the order, the float, the
//! receipt.
//!
//! # Who may do what
//!
//! Two questions, asked separately, because they have different answers.
//!
//! **Which places** — `Reach`, the same rule the People module uses. An Admin
//! reaches everywhere, somebody posted to head office reaches everywhere, a
//! store manager reaches their own shop, and a session with no open posting
//! reaches nothing. A store route that took a `site` and did not check it would
//! be a store route that reads every other shop's cash.
//!
//! **Which acts** — the rung. Deciding what a shop does with its takings, and
//! sending it money, are head office's; recording what a shop spent, banking
//! the day, and handing over an envelope are the shop's. The split is stated
//! per route below rather than in a table, because each one has a reason and a
//! table loses the reasons.
//!
//! # One `merge` and one line in `router()`
//!
//! Everything here is attached by `lane_b_routes`, so this lane adds exactly
//! one line to `http/mod.rs`. Several lanes are building at once and a shared
//! file with thirty new routes in it is a merge that somebody resolves by hand
//! at the wrong hour.

use super::auth::Principal;
use super::employment::reach_of;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{Reach, Role},
    postgres as infrastructure,
};
use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

/// Attach the whole lane.
pub fn lane_b_routes(router: Router<AppState>) -> Router<AppState> {
    router
        // The drawer.
        .route("/api/v1/store-money/shifts", get(shifts))
        .route(
            "/api/v1/store-money/shifts/{id}/equation",
            get(shift_equation),
        )
        .route("/api/v1/store-money/shifts/{id}/float", post(shift_float))
        .route(
            "/api/v1/store-money/shifts/{id}/approve-variance",
            post(shift_approve_variance),
        )
        // The deposit.
        .route(
            "/api/v1/store-money/deposits",
            get(deposits).post(deposit_prepare),
        )
        .route(
            "/api/v1/store-money/deposits/{id}/hand-over",
            post(deposit_hand_over),
        )
        .route(
            "/api/v1/store-money/deposits/{id}/confirm",
            post(deposit_confirm),
        )
        // The order.
        .route(
            "/api/v1/store-money/remittance-orders",
            get(orders).post(order_issue),
        )
        .route("/api/v1/store-money/remittance-orders/{id}", get(order))
        .route(
            "/api/v1/store-money/remittance-orders/{id}/cancel",
            post(order_cancel),
        )
        .route(
            "/api/v1/store-money/remittance-orders/executions",
            post(order_link_execution),
        )
        .route("/api/v1/store-money/remittance-authority", get(authority))
        .route(
            "/api/v1/store-money/sites/{site}/remittance-default",
            post(remittance_default),
        )
        // The float.
        .route("/api/v1/store-money/funds", get(funds).post(fund_send))
        .route("/api/v1/store-money/funds/{id}/receive", post(fund_receive))
        .route(
            "/api/v1/store-money/funds/{id}/accountability",
            get(fund_accountability),
        )
        .route(
            "/api/v1/store-money/fund-allocations",
            post(allocation_open),
        )
        .route("/api/v1/store-money/fund-settlements", post(fund_settle))
        // Wages the manager hands over.
        .route("/api/v1/store-money/payouts", post(payout_build))
        .route("/api/v1/store-money/payouts/{allocation}", get(payout_list))
        .route(
            "/api/v1/store-money/payouts/tasks/{id}/pay",
            post(payout_pay),
        )
        // The float changing hands.
        .route(
            "/api/v1/store-money/handovers",
            get(handovers).post(handover_prepare),
        )
        .route(
            "/api/v1/store-money/handovers/{id}/sign",
            post(handover_sign),
        )
        // What the shop spends.
        .route(
            "/api/v1/store-money/expenses",
            get(expenses).post(expense_claim),
        )
        .route(
            "/api/v1/store-money/expenses/{id}/approve",
            post(expense_approve),
        )
        .route(
            "/api/v1/store-money/expenses/{id}/reject",
            post(expense_reject),
        )
        .route("/api/v1/store-money/petty-cash", post(petty_replenish))
        // Where the money is.
        .route("/api/v1/store-money/sites/{site}/position", get(position))
}

// ---------------------------------------------------------------------------
// Who may act, and where
// ---------------------------------------------------------------------------

/// Refuse a session that may not act on this shop.
///
/// The message names the shop rather than saying "forbidden", because the
/// person reading it is usually somebody who picked the wrong row from a list.
async fn allow_site(
    state: &AppState,
    principal: &Principal,
    site_id: &str,
) -> Result<(), AppError> {
    let reach = reach_of(state, principal).await?;
    if reach.covers(Some(site_id)) {
        return Ok(());
    }
    Err(AppError::Forbidden(match reach {
        Reach::Nowhere => format!(
            "this login has no open posting, so it cannot act on {site_id}'s money. Ask HR to \
             post you to a unit."
        ),
        _ => format!("this login does not cover {site_id}"),
    }))
}

/// The shop a list is bounded to, or `None` for a caller who reaches
/// everywhere.
///
/// The distinction matters: `None` from a `Nowhere` reach would return the
/// whole fleet's cash to exactly the caller who should see none of it, which is
/// why `Reach` is an enum and this function refuses rather than returning
/// `None`.
async fn list_scope(
    state: &AppState,
    principal: &Principal,
    asked: Option<&str>,
) -> Result<Option<String>, AppError> {
    let reach = reach_of(state, principal).await?;
    if reach.is_nowhere() {
        return Err(AppError::Forbidden(
            "this login has no open posting, so there is no shop whose money it may read".into(),
        ));
    }
    match (reach.sole_unit(), asked) {
        (Some(mine), Some(asked)) if mine.as_str() != asked => Err(AppError::Forbidden(format!(
            "this login covers {} and not {asked}",
            mine.as_str()
        ))),
        (Some(mine), _) => Ok(Some(mine.as_str().to_owned())),
        (None, asked) => Ok(asked.map(str::to_owned)),
    }
}

/// Head office only.
///
/// Deciding what a shop does with its takings, sending it money, confirming a
/// deposit against a bank statement, topping up an imprest. All of them are the
/// centre instructing or believing the edge, and a shop that could do any of
/// them could fund itself.
fn head_office_only(principal: &Principal, act: &str) -> Result<(), AppError> {
    if principal.role == Role::Admin {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{act} is head office's decision, not the shop's"
    )))
}

/// At least a supervisor. A cashier records; a supervisor decides.
fn at_least_supervisor(principal: &Principal, act: &str) -> Result<(), AppError> {
    if matches!(principal.role, Role::Supervisor | Role::Admin) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{act} needs a supervisor or head office"
    )))
}

// ---------------------------------------------------------------------------
// The drawer
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ShiftQuery {
    pub site: Option<String>,
    #[serde(default)]
    pub unapproved: bool,
    pub limit: Option<i64>,
}

pub async fn shifts(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ShiftQuery>,
) -> Result<Json<Vec<Value>>, AppError> {
    let site = list_scope(&state, &principal, query.site.as_deref()).await?;
    Ok(Json(
        infrastructure::cash_shift_list(
            &state.db,
            site.as_deref(),
            query.unapproved,
            query.limit.unwrap_or(100),
        )
        .await?,
    ))
}

/// What the drawer should have held, worked out here from the synced facts.
///
/// The shop's own figures come back beside it on the list, so a till running an
/// old build is visible as a disagreement rather than silently authoritative.
pub async fn shift_equation(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let site = shift_site(&state, id).await?;
    allow_site(&state, &principal, &site).await?;
    let equation = infrastructure::cash_shift_equation(&state.db, id).await?;
    Ok(Json(
        json!({ "shift_id": id, "site_id": site, "equation": equation }),
    ))
}

async fn shift_site(state: &AppState, shift_id: Uuid) -> Result<String, AppError> {
    sqlx::query_scalar::<_, String>("SELECT site_id FROM cash_shift WHERE shift_id = $1")
        .bind(shift_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("there is no cash shift {shift_id}")))
}

pub async fn shift_float(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let site = shift_site(&state, id).await?;
    allow_site(&state, &principal, &site).await?;
    at_least_supervisor(&principal, "putting a cashier float in the books")?;
    Ok(Json(
        infrastructure::cash_shift_post_float(&state.db, id, &principal.username).await?,
    ))
}

/// Accept a difference. Never automatic — see the rule in `store_money.rs`.
pub async fn shift_approve_variance(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<infrastructure::ApproveVarianceRequest>,
) -> Result<Json<Value>, AppError> {
    let site = shift_site(&state, id).await?;
    allow_site(&state, &principal, &site).await?;
    at_least_supervisor(&principal, "accepting a drawer's difference")?;
    Ok(Json(
        infrastructure::cash_shift_approve_variance(&state.db, id, &request, &principal.username)
            .await?,
    ))
}

// ---------------------------------------------------------------------------
// The deposit
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct DepositQuery {
    pub site: Option<String>,
    pub status: Option<String>,
    pub limit: Option<i64>,
}

pub async fn deposits(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<DepositQuery>,
) -> Result<Json<Vec<Value>>, AppError> {
    let site = list_scope(&state, &principal, query.site.as_deref()).await?;
    Ok(Json(
        infrastructure::store_deposit_list(
            &state.db,
            site.as_deref(),
            query.status.as_deref(),
            query.limit.unwrap_or(100),
        )
        .await?,
    ))
}

pub async fn deposit_prepare(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<infrastructure::PrepareDepositRequest>,
) -> Result<Json<Value>, AppError> {
    allow_site(&state, &principal, &request.site_id).await?;
    Ok(Json(
        infrastructure::store_deposit_prepare(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn deposit_hand_over(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<infrastructure::HandOverDepositRequest>,
) -> Result<Json<Value>, AppError> {
    let site = deposit_site(&state, id).await?;
    allow_site(&state, &principal, &site).await?;
    Ok(Json(
        infrastructure::store_deposit_hand_over(&state.db, id, &request, &principal.username)
            .await?,
    ))
}

async fn deposit_site(state: &AppState, deposit_id: Uuid) -> Result<String, AppError> {
    sqlx::query_scalar::<_, String>("SELECT site_id FROM store_deposit WHERE deposit_id = $1")
        .bind(deposit_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("there is no deposit {deposit_id}")))
}

/// The bank agrees.
///
/// One endpoint, two callers: the bank matcher passes the statement line it
/// found, a person reading a statement passes theirs or none. Head office only
/// — a shop confirming its own deposit would be a shop marking its own bag as
/// arrived.
pub async fn deposit_confirm(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<infrastructure::ConfirmDepositRequest>,
) -> Result<Json<Value>, AppError> {
    head_office_only(&principal, "confirming that a deposit reached the bank")?;
    Ok(Json(
        infrastructure::store_deposit_confirm(&state.db, id, &request, &principal.username).await?,
    ))
}

// ---------------------------------------------------------------------------
// The order
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct OrderQuery {
    pub site: Option<String>,
    pub limit: Option<i64>,
}

pub async fn orders(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<OrderQuery>,
) -> Result<Json<Vec<Value>>, AppError> {
    let site = list_scope(&state, &principal, query.site.as_deref()).await?;
    Ok(Json(
        infrastructure::remittance_order_list(
            &state.db,
            site.as_deref(),
            query.limit.unwrap_or(50),
        )
        .await?,
    ))
}

pub async fn order(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let view = infrastructure::remittance_order_view(&state.db, id).await?;
    let site = view
        .get("site_id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    allow_site(&state, &principal, &site).await?;
    Ok(Json(view))
}

/// Head office decides. **This posts nothing.**
pub async fn order_issue(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<infrastructure::IssueRemittanceRequest>,
) -> Result<Json<Value>, AppError> {
    head_office_only(&principal, "ordering a shop to dispose of its takings")?;
    Ok(Json(
        infrastructure::remittance_order_issue(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn order_cancel(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<infrastructure::CancelRemittanceRequest>,
) -> Result<Json<Value>, AppError> {
    head_office_only(&principal, "withdrawing a remittance order")?;
    Ok(Json(
        infrastructure::remittance_order_cancel(&state.db, id, &request, &principal.username)
            .await?,
    ))
}

/// Say that a money document carried out part of an order.
///
/// The shop links its own deposit; head office links a transfer or a payment.
/// Either way this posts nothing — the document being linked has already posted
/// under its own rule.
pub async fn order_link_execution(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<infrastructure::LinkExecutionRequest>,
) -> Result<Json<Value>, AppError> {
    at_least_supervisor(&principal, "linking a payment to a remittance order")?;
    Ok(Json(
        infrastructure::remittance_order_link_execution(&state.db, &request, &principal.username)
            .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AuthorityQuery {
    pub site: String,
    pub destination_kind: String,
    pub destination_ref: String,
    pub amount_minor: i64,
}

/// May this shop pay this destination out of its takings, and under which
/// order?
///
/// What the money documents ask before they credit a shop's cash. The answer
/// carries the refusal already written, so a caller that cannot pay does not
/// have to compose the explanation itself and get it subtly wrong.
pub async fn authority(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<AuthorityQuery>,
) -> Result<Json<Value>, AppError> {
    allow_site(&state, &principal, &query.site).await?;
    Ok(Json(
        infrastructure::remittance_authority(
            &state.db,
            &query.site,
            &query.destination_kind,
            &query.destination_ref,
            query.amount_minor,
        )
        .await?,
    ))
}

pub async fn remittance_default(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(site): Path<String>,
    Json(request): Json<infrastructure::SetRemittanceDefaultRequest>,
) -> Result<Json<Value>, AppError> {
    head_office_only(&principal, "setting where a shop's takings go by default")?;
    Ok(Json(
        infrastructure::remittance_default_set(&state.db, &site, &request, &principal.username)
            .await?,
    ))
}

// ---------------------------------------------------------------------------
// The float
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct FundQuery {
    pub site: Option<String>,
    #[serde(default)]
    pub open: bool,
    pub limit: Option<i64>,
}

pub async fn funds(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<FundQuery>,
) -> Result<Json<Vec<Value>>, AppError> {
    let site = list_scope(&state, &principal, query.site.as_deref()).await?;
    Ok(Json(
        infrastructure::operating_fund_list(
            &state.db,
            site.as_deref(),
            query.open,
            query.limit.unwrap_or(100),
        )
        .await?,
    ))
}

pub async fn fund_send(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<infrastructure::SendFundRequest>,
) -> Result<Json<Value>, AppError> {
    head_office_only(&principal, "sending a shop money")?;
    Ok(Json(
        infrastructure::operating_fund_send(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn fund_accountability(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let site =
        sqlx::query_scalar::<_, String>("SELECT site_id FROM operating_fund WHERE fund_id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("there is no operating fund {id}")))?;
    allow_site(&state, &principal, &site).await?;
    Ok(Json(json!({
        "fund_id": id,
        "site_id": site,
        "accountability": infrastructure::operating_fund_accountability(&state.db, id).await?,
    })))
}

pub async fn allocation_open(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<infrastructure::OpenAllocationRequest>,
) -> Result<Json<Value>, AppError> {
    head_office_only(&principal, "earmarking a shop's funds")?;
    Ok(Json(
        infrastructure::fund_allocation_open(&state.db, &request, &principal.username).await?,
    ))
}

/// The shop confirms head office's transfer into its petty cash: the unit's
/// half of the pair (client accountant, rule B).
pub async fn fund_receive(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<infrastructure::ReceiveFundRequest>,
) -> Result<Json<Value>, AppError> {
    let site =
        sqlx::query_scalar::<_, String>("SELECT site_id FROM operating_fund WHERE fund_id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("there is no operating fund {id}")))?;
    allow_site(&state, &principal, &site).await?;
    at_least_supervisor(&principal, "confirming a fund into petty cash")?;
    Ok(Json(
        infrastructure::operating_fund_receive(&state.db, id, &request, &principal.username)
            .await?,
    ))
}

/// Account for money the custodian spent, or handed back.
pub async fn fund_settle(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<infrastructure::SettleFundRequest>,
) -> Result<Json<Value>, AppError> {
    let site =
        sqlx::query_scalar::<_, String>("SELECT site_id FROM operating_fund WHERE fund_id = $1")
            .bind(request.fund_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| {
                AppError::NotFound(format!("there is no operating fund {}", request.fund_id))
            })?;
    allow_site(&state, &principal, &site).await?;
    at_least_supervisor(&principal, "accounting for an operating fund")?;
    Ok(Json(
        infrastructure::fund_settlement_record(&state.db, &request, &principal.username).await?,
    ))
}

// ---------------------------------------------------------------------------
// Wages the manager hands over
// ---------------------------------------------------------------------------

/// Head office states each net figure and hands the shop a list.
pub async fn payout_build(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<infrastructure::BuildPayoutListRequest>,
) -> Result<Json<Value>, AppError> {
    head_office_only(&principal, "deciding what each person is paid")?;
    Ok(Json(
        infrastructure::payroll_payout_build(&state.db, &request, &principal.username).await?,
    ))
}

/// The manager's list: name, amount, done or not.
///
/// There is nothing else to return. `payroll_payout_task` has no gross, no tax,
/// no BPJS and no deduction column, so this endpoint cannot leak one however it
/// is called.
pub async fn payout_list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(allocation): Path<Uuid>,
) -> Result<Json<Vec<Value>>, AppError> {
    let site = sqlx::query_scalar::<_, String>(
        "SELECT f.site_id FROM fund_allocation a
           JOIN operating_fund f ON f.fund_id = a.fund_id
          WHERE a.allocation_id = $1",
    )
    .bind(allocation)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("there is no allocation {allocation}")))?;
    allow_site(&state, &principal, &site).await?;
    Ok(Json(
        infrastructure::payroll_payout_list(&state.db, allocation).await?,
    ))
}

pub async fn payout_pay(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<infrastructure::PayEmployeeRequest>,
) -> Result<Json<Value>, AppError> {
    let site = sqlx::query_scalar::<_, String>(
        "SELECT f.site_id FROM payroll_payout_task t
           JOIN fund_allocation a ON a.allocation_id = t.allocation_id
           JOIN operating_fund f ON f.fund_id = a.fund_id
          WHERE t.task_id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("there is no payout task {id}")))?;
    allow_site(&state, &principal, &site).await?;
    at_least_supervisor(&principal, "handing over wages")?;
    Ok(Json(
        infrastructure::payroll_payout_pay(&state.db, id, &request, &principal.username).await?,
    ))
}

// ---------------------------------------------------------------------------
// The float changing hands
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct HandoverQuery {
    pub site: Option<String>,
    pub limit: Option<i64>,
}

pub async fn handovers(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<HandoverQuery>,
) -> Result<Json<Vec<Value>>, AppError> {
    let site = list_scope(&state, &principal, query.site.as_deref()).await?;
    Ok(Json(
        infrastructure::custodian_handover_list(
            &state.db,
            site.as_deref(),
            query.limit.unwrap_or(50),
        )
        .await?,
    ))
}

pub async fn handover_prepare(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<infrastructure::PrepareHandoverRequest>,
) -> Result<Json<Value>, AppError> {
    head_office_only(&principal, "drawing up a custodian handover")?;
    Ok(Json(
        infrastructure::custodian_handover_prepare(&state.db, &request, &principal.username)
            .await?,
    ))
}

/// One of the two signs. Both signatures, and the float changes hands.
pub async fn handover_sign(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<infrastructure::SignHandoverRequest>,
) -> Result<Json<Value>, AppError> {
    let site = sqlx::query_scalar::<_, String>(
        "SELECT site_id FROM custodian_handover WHERE handover_id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("there is no handover {id}")))?;
    allow_site(&state, &principal, &site).await?;
    at_least_supervisor(&principal, "signing for a store float")?;
    Ok(Json(
        infrastructure::custodian_handover_sign(&state.db, id, &request, &principal.username)
            .await?,
    ))
}

// ---------------------------------------------------------------------------
// What the shop spends
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ExpenseQuery {
    pub site: Option<String>,
    pub status: Option<String>,
    pub limit: Option<i64>,
}

pub async fn expenses(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ExpenseQuery>,
) -> Result<Json<Vec<Value>>, AppError> {
    let site = list_scope(&state, &principal, query.site.as_deref()).await?;
    Ok(Json(
        infrastructure::store_expense_list(
            &state.db,
            site.as_deref(),
            query.status.as_deref(),
            query.limit.unwrap_or(100),
        )
        .await?,
    ))
}

/// A shop records what it spent. The receipt is uploaded first, through
/// `/api/v1/files`, and its id comes in here.
pub async fn expense_claim(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<infrastructure::ClaimExpenseRequest>,
) -> Result<Json<Value>, AppError> {
    allow_site(&state, &principal, &request.site_id).await?;
    Ok(Json(
        infrastructure::store_expense_claim(&state.db, &request, &principal.username).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct ApproveExpenseBody {
    #[serde(default)]
    pub posting_date: Option<NaiveDate>,
}

/// Approve and post.
///
/// The rung is the caller's own, taken from the session and never from the
/// body: an approval that believed a level somebody typed would be an approval
/// limit anybody could raise. Whether that rung is high enough for this amount
/// is the domain's decision, and it refuses by name.
pub async fn expense_approve(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(body): Json<ApproveExpenseBody>,
) -> Result<Json<Value>, AppError> {
    let site =
        sqlx::query_scalar::<_, String>("SELECT site_id FROM store_expense WHERE expense_id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("there is no expense {id}")))?;
    allow_site(&state, &principal, &site).await?;
    at_least_supervisor(&principal, "approving a store expense")?;
    let request = infrastructure::ApproveExpenseRequest {
        approver_level: match principal.role {
            Role::Admin => "ADMIN".into(),
            _ => "SUPERVISOR".into(),
        },
        posting_date: body.posting_date,
    };
    Ok(Json(
        infrastructure::store_expense_approve(&state.db, id, &request, &principal.username).await?,
    ))
}

pub async fn expense_reject(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<infrastructure::RejectExpenseRequest>,
) -> Result<Json<Value>, AppError> {
    let site =
        sqlx::query_scalar::<_, String>("SELECT site_id FROM store_expense WHERE expense_id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("there is no expense {id}")))?;
    allow_site(&state, &principal, &site).await?;
    at_least_supervisor(&principal, "refusing a store expense")?;
    Ok(Json(
        infrastructure::store_expense_reject(&state.db, id, &request, &principal.username).await?,
    ))
}

pub async fn petty_replenish(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<infrastructure::ReplenishRequest>,
) -> Result<Json<Value>, AppError> {
    head_office_only(&principal, "topping up a shop's petty cash")?;
    Ok(Json(
        infrastructure::petty_cash_replenish(&state.db, &request, &principal.username).await?,
    ))
}

// ---------------------------------------------------------------------------
// Where the money is
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct PositionQuery {
    pub as_of: Option<NaiveDate>,
}

/// A shop's money, in two groups that are never added together.
pub async fn position(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(site): Path<String>,
    Query(query): Query<PositionQuery>,
) -> Result<Json<Value>, AppError> {
    allow_site(&state, &principal, &site).await?;
    Ok(Json(
        infrastructure::store_cash_position(&state.db, &site, query.as_of).await?,
    ))
}
