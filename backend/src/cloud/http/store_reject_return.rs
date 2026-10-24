//! A shop's To be returned, over HTTP (see `postgres::store_reject_return`).
//!
//! - `POST /api/v1/inventory/store-returns/reject`: a shop raises the return
//!   one of its pockets — Reject item, Over delivery, Return HO — travels on.
//!   Only through a call the shop's node relays: the site is the one that
//!   node is registered for and proves with its key, never one the body
//!   names, so a shop sends back its own goods and nobody else's.
//! - `POST /api/v1/inventory/store-returns/mark`: Merchandise moves a shop's
//!   goods to its Return HO pocket (the hub's New Return).

use super::auth::Principal;
use crate::cloud::postgres as infrastructure;
use crate::cloud::{AppError, AppState};
use axum::{extract::State, routing::post, Extension, Json, Router};
use serde_json::Value;

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/inventory/store-returns/reject", post(raise))
        .route("/api/v1/inventory/store-returns/mark", post(mark))
}

async fn mark(
    State(s): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<infrastructure::MarkStoreReturnRequest>,
) -> Result<Json<infrastructure::MarkedStoreReturn>, AppError> {
    if principal.relayed.is_some() {
        return Err(AppError::Forbidden(
            "head office moves a store's goods to Return HO, not a till".into(),
        ));
    }
    Ok(Json(
        infrastructure::mark_store_return(&s.db, request, &principal.username, s.clock.now())
            .await?,
    ))
}

async fn raise(
    State(s): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<infrastructure::RaiseRejectReturnRequest>,
) -> Result<Json<Value>, AppError> {
    let Some(relay) = principal.relayed.as_ref() else {
        return Err(AppError::Forbidden(
            "a store sends its reject from its own till".into(),
        ));
    };
    if !relay.site_kind.eq_ignore_ascii_case("STORE") {
        return Err(AppError::Forbidden(
            "only a store sends its reject back to head office".into(),
        ));
    }
    Ok(Json(
        infrastructure::raise_store_reject_return(
            &s.db,
            &relay.site_id,
            request,
            &principal.username,
        )
        .await?,
    ))
}
