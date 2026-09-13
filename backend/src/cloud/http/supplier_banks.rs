//! A supplier's bank accounts: the handlers.
//!
//! Nested under the supplier on purpose. An account is not a record anybody
//! looks up on its own — it is read while looking at who to pay and written
//! while looking at the same screen — and the nesting is also what lets the
//! activity log file every one of these acts against the supplier without a
//! line in `DECLARED_BY_HANDLER`: the id is in the path.
//!
//! Everything under `/api/v1/suppliers` is SUPERVISOR, reads included, by the
//! purchasing arm of `required_role`. That is the right rung for this without
//! anything being added: an account number is where the company's money goes,
//! and holding a till token is not a reason to see it.

use super::articles::{expected_version, idempotency_key, request_digest, versioned_response};
use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, CreateSupplierBankAccountRequest, UpdateSupplierBankAccountRequest,
    },
};
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    Extension, Json,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

/// Whether the caller is drawing a picker or a master screen.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct AccountScope {
    /// Absent means live accounts only, which is what a form choosing where to
    /// send money wants. The screen that retired one asks for them back.
    #[serde(default)]
    pub include_retired: Option<bool>,
}

pub async fn list_supplier_bank_accounts(
    State(state): State<AppState>,
    Path(supplier_id): Path<Uuid>,
    Query(scope): Query<AccountScope>,
) -> Result<Json<Vec<infrastructure::SupplierBankAccount>>, AppError> {
    Ok(Json(
        infrastructure::supplier_bank_accounts(
            &state.db,
            supplier_id,
            scope.include_retired.unwrap_or(false),
        )
        .await?,
    ))
}

pub async fn create_supplier_bank_account(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(supplier_id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<CreateSupplierBankAccountRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "supplier_id": supplier_id,
        "request": &request,
    }))?;
    let account = infrastructure::create_supplier_bank_account(
        &state.db,
        supplier_id,
        request,
        &principal.username,
        &key,
        &digest,
    )
    .await?;
    let version = account.version;
    versioned_response(StatusCode::CREATED, account, version)
}

/// Correct an account, make it the default, retire it or bring it back.
///
/// The supplier is in the path and the account id is checked against it by the
/// row itself, so a caller who quotes one supplier and another's account edits
/// nothing: the account is found by its own id, and what it belongs to is read
/// from the row rather than trusted from the URL.
pub async fn update_supplier_bank_account(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((supplier_id, account_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    Json(request): Json<UpdateSupplierBankAccountRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let version = expected_version(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "supplier_id": supplier_id,
        "account_id": account_id,
        "expected_version": version,
        "request": &request,
    }))?;

    let existing = infrastructure::get_supplier_bank_account(&state.db, account_id).await?;
    if existing.supplier_id != supplier_id {
        // Not a 403: from the caller's side this account is not under this
        // supplier, and saying so is the same answer as it not existing.
        return Err(AppError::NotFound("Supplier bank account".to_owned()));
    }

    let account = infrastructure::update_supplier_bank_account(
        &state.db,
        account_id,
        version,
        request,
        &principal.username,
        &key,
        &digest,
    )
    .await?;
    let version = account.version;
    versioned_response(StatusCode::OK, account, version)
}
