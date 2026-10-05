//! Finance's one-time code for a big shop expense (0822): issued at the hub,
//! used up by the shop's node.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::Role,
    postgres::{self as infrastructure, ExpenseCodeView, IssueExpenseCodeRequest},
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

fn finance_only(principal: &Principal) -> Result<(), AppError> {
    if principal.role == Role::Admin {
        return Ok(());
    }
    Err(AppError::Forbidden(
        "approval codes are issued by Finance at head office".into(),
    ))
}

#[derive(Debug, Deserialize)]
pub struct CodesQuery {
    pub unit: String,
    pub limit: Option<i64>,
}

/// `GET /api/v1/store-money/expense-codes?unit=…`
pub async fn list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<CodesQuery>,
) -> Result<Json<Vec<ExpenseCodeView>>, AppError> {
    finance_only(&principal)?;
    Ok(Json(
        infrastructure::expense_codes(&state.db, query.unit.trim(), query.limit.unwrap_or(50))
            .await?,
    ))
}

/// `POST /api/v1/store-money/expense-codes`
pub async fn issue(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<IssueExpenseCodeRequest>,
) -> Result<Json<ExpenseCodeView>, AppError> {
    finance_only(&principal)?;
    Ok(Json(
        infrastructure::issue_expense_code(&state.db, &request, &principal.username).await?,
    ))
}

/// `POST /api/v1/store-money/expense-codes/{id}/cancel`
pub async fn cancel(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
) -> Result<Json<ExpenseCodeView>, AppError> {
    finance_only(&principal)?;
    Ok(Json(
        infrastructure::cancel_expense_code(&state.db, id, &principal.username).await?,
    ))
}

// ── the shop's node ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RelayExpenseCodeRequest {
    pub origin_id: String,
    #[serde(default)]
    pub site_id: Option<String>,
    #[serde(default)]
    pub actor_id: Option<String>,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub amount_minor: Option<i64>,
    #[serde(default)]
    pub expense_key: Option<String>,
}

/// The shop the calling node speaks for: its registered site, never the
/// body's word when the two differ.
async fn origin_site(
    state: &AppState,
    headers: &axum::http::HeaderMap,
    request: &RelayExpenseCodeRequest,
) -> Result<String, AppError> {
    let origin = super::authenticate_origin(state, headers, &request.origin_id).await?;
    let stamped = request
        .site_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match (origin.site_id, stamped) {
        (Some(registered), Some(claimed)) if registered != claimed => Err(AppError::Forbidden(
            format!("origin {} speaks for {registered}, not {claimed}", origin.origin_id),
        )),
        (Some(registered), _) => Ok(registered),
        (None, Some(claimed)) => Ok(claimed.to_owned()),
        (None, None) => Err(AppError::Validation(
            "an expense code call has to say which shop it is for".into(),
        )),
    }
}

/// `POST /api/v1/sync/expense-codes/line` — the line above which a shop
/// expense needs a code.
pub async fn sync_line(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(request): Json<RelayExpenseCodeRequest>,
) -> Result<Json<Value>, AppError> {
    origin_site(&state, &headers, &request).await?;
    Ok(Json(json!({
        "code_above_minor": infrastructure::expense_code_above(&state.db).await?,
    })))
}

/// `POST /api/v1/sync/expense-codes/use` — check a code and use it up.
pub async fn sync_use(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(request): Json<RelayExpenseCodeRequest>,
) -> Result<Json<Value>, AppError> {
    let site = origin_site(&state, &headers, &request).await?;
    let unit = infrastructure::sites::unit_of_site(&state.db, &site).await?;
    let code = request
        .code
        .as_deref()
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .ok_or_else(|| AppError::Validation("Enter the code from Finance.".into()))?;
    let actor = request.actor_id.as_deref().unwrap_or("").trim();
    let used = infrastructure::use_expense_code(
        &state.db,
        &unit,
        code,
        request.amount_minor.unwrap_or(0),
        request.expense_key.as_deref().unwrap_or(""),
        if actor.is_empty() { "shop" } else { actor },
    )
    .await?;
    Ok(Json(serde_json::to_value(used).map_err(|error| {
        AppError::Validation(error.to_string())
    })?))
}
