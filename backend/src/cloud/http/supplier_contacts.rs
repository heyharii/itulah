//! A supplier's contacts: the handlers.
//!
//! Nested under the supplier on purpose, for the reason `supplier_banks` gives
//! at the top of its own file: a contact is not a record anybody looks up on
//! its own, and the nesting is what lets the activity log file every one of
//! these acts against the supplier without a line in `DECLARED_BY_HANDLER` —
//! the id is in the path.
//!
//! Everything under `/api/v1/suppliers` is SUPERVISOR, reads included, by the
//! purchasing arm of `required_role`.

use super::articles::{expected_version, idempotency_key, request_digest, versioned_response};
use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, CreateSupplierContactRequest, UpdateSupplierContactRequest,
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
pub struct ContactScope {
    /// Absent means live contacts only, which is what a form choosing who to
    /// send a PO to wants. The screen that retired somebody asks for them back.
    #[serde(default)]
    pub include_retired: Option<bool>,
}

pub async fn list_supplier_contacts(
    State(state): State<AppState>,
    Path(supplier_id): Path<Uuid>,
    Query(scope): Query<ContactScope>,
) -> Result<Json<Vec<infrastructure::SupplierContact>>, AppError> {
    Ok(Json(
        infrastructure::supplier_contacts(
            &state.db,
            supplier_id,
            scope.include_retired.unwrap_or(false),
        )
        .await?,
    ))
}

/// Every live contact across the book — what the supplier export reads.
pub async fn list_all_supplier_contacts(
    State(state): State<AppState>,
) -> Result<Json<Vec<infrastructure::SupplierContact>>, AppError> {
    Ok(Json(
        infrastructure::all_live_supplier_contacts(&state.db).await?,
    ))
}

pub async fn create_supplier_contact(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(supplier_id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<CreateSupplierContactRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "supplier_id": supplier_id,
        "request": &request,
    }))?;
    let contact = infrastructure::create_supplier_contact(
        &state.db,
        supplier_id,
        request,
        &principal.username,
        &key,
        &digest,
    )
    .await?;
    let version = contact.version;
    versioned_response(StatusCode::CREATED, contact, version)
}

/// Correct a contact, make them primary, retire them or bring them back.
///
/// What the contact belongs to is read from the row rather than trusted from
/// the URL, so a caller who quotes one supplier and another's contact edits
/// nothing.
pub async fn update_supplier_contact(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((supplier_id, contact_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    Json(request): Json<UpdateSupplierContactRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let version = expected_version(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "supplier_id": supplier_id,
        "contact_id": contact_id,
        "expected_version": version,
        "request": &request,
    }))?;

    let existing = infrastructure::get_supplier_contact(&state.db, contact_id).await?;
    if existing.supplier_id != supplier_id {
        // Not a 403: from the caller's side this contact is not under this
        // supplier, and saying so is the same answer as it not existing.
        return Err(AppError::NotFound("Supplier contact".to_owned()));
    }

    let contact = infrastructure::update_supplier_contact(
        &state.db,
        contact_id,
        version,
        request,
        &principal.username,
        &key,
        &digest,
    )
    .await?;
    let version = contact.version;
    versioned_response(StatusCode::OK, contact, version)
}
