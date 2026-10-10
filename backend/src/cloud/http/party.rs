//! Party links — ERPNext's *Link with Customer/Supplier*.
//!
//! A party's own account (ERPNext Party Account) is an account link with
//! source `PARTY` since 0465, resolved by the poster before the company's
//! default.
//!
//! # Who may call it
//!
//! Under `/api/v1/finance`, so `domain::auth` already requires SUPERVISOR to
//! read and ADMIN to write. Nothing added here, for the reason
//! `http/payment_ledger.rs` gives: a second RBAC rule beside the central one
//! is two policies that agree until somebody edits one.

use crate::cloud::{
    application::{AppError, AppState},
    http::auth::Principal,
    postgres::{self as infrastructure},
};
use axum::{extract::State, routing::get, Extension, Json, Router};
use serde::Deserialize;

/// A party's own account for a role is an account link with source `PARTY`
/// (0465), set on the Account Links screen; what is left here is the link
/// between a party's roles.
pub fn lane_routes(r: Router<AppState>) -> Router<AppState> {
    r.route(
        "/api/v1/finance/party-links",
        get(list_links).post(create_link),
    )
}

#[derive(Debug, Deserialize)]
pub struct SetPartyLinkRequest {
    pub primary_role: String,
    pub primary_party: String,
    pub secondary_party: String,
}

/// ERPNext's *Link with Customer*, narrowed to one act: name the primary and
/// the other register's party; the secondary register derives (Supplier ⇄
/// Customer), and one-link-per-party is the database's rule, not this file's.
pub async fn create_link(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<SetPartyLinkRequest>,
) -> Result<Json<infrastructure::PartyLinkRow>, AppError> {
    let row = infrastructure::create_party_link(
        &state.db,
        request.primary_role.trim(),
        request.primary_party.trim(),
        request.secondary_party.trim(),
        &principal.username,
    )
    .await?;
    Ok(Json(row))
}

pub async fn list_links(
    State(state): State<AppState>,
) -> Result<Json<Vec<infrastructure::PartyLinkRow>>, AppError> {
    Ok(Json(infrastructure::list_party_links(&state.db).await?))
}
