//! The hard cap over HTTP: read a promotion's split, and switch it on or off.
//!
//! Two routes, both under the promotion or campaign they split. The PUT sends
//! the shops their allowances (or tells them to drop them) in the same call —
//! see `postgres::cap_allocation::set_cap_allocation`.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{self as infrastructure, CapAllocationRequest, CapAllocationView},
};
use axum::{
    extract::{Path, State},
    Extension, Json,
};

pub async fn cap_allocation(
    State(state): State<AppState>,
    Path((kind, key)): Path<(String, String)>,
) -> Result<Json<CapAllocationView>, AppError> {
    Ok(Json(
        infrastructure::cap_allocation(&state.db, &kind, &key).await?,
    ))
}

/// Who switched it is the signed-in person, never a field in the body: the
/// split decides where money may be given away, and the record of who decided
/// it cannot be something the caller types.
pub async fn set_cap_allocation(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((kind, key)): Path<(String, String)>,
    Json(request): Json<CapAllocationRequest>,
) -> Result<Json<CapAllocationView>, AppError> {
    Ok(Json(
        infrastructure::set_cap_allocation(&state.db, &kind, &key, request, &principal.username)
            .await?,
    ))
}
