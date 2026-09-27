//! Setting a company up from the hub: the handlers.
//!
//! All four are Admin (`domain::auth::required_role`, the `/api/v1/setup`
//! prefix): describing the company, opening stores and starting the books are
//! the owner's acts. The read is Admin too — the hub asks it on every sign-in
//! to decide whether the wizard stands in front of the app, and anybody else
//! gets a 403 and simply the app.

use super::articles::{idempotency_key, request_digest};
use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, OpenStoresRequest, SaveSetupCompanyRequest, StartBooksRequest,
    },
};
use axum::{extract::State, http::HeaderMap, http::StatusCode, Extension, Json};
use serde_json::json;

/// What has been answered, what is still to do.
pub async fn status(
    State(state): State<AppState>,
) -> Result<Json<infrastructure::SetupStatus>, AppError> {
    Ok(Json(infrastructure::setup_status(&state.db).await?))
}

/// Step 1. A PUT: answering the question again after pressing Back is the
/// same company, described better.
pub async fn save_company(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<SaveSetupCompanyRequest>,
) -> Result<Json<infrastructure::SetupCompany>, AppError> {
    Ok(Json(
        infrastructure::save_setup_company(&state.db, request, &principal.username).await?,
    ))
}

/// Step 2, and Buka toko over Lokasi afterwards. Idempotent on the key: a
/// retry after a timeout that did land opens the stores once.
pub async fn open_stores(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    headers: HeaderMap,
    Json(request): Json<OpenStoresRequest>,
) -> Result<(StatusCode, Json<infrastructure::OpenStoresAnswer>), AppError> {
    let key = idempotency_key(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "request": &request,
    }))?;
    let answer =
        infrastructure::open_stores(&state.db, request, &principal.username, &key, &digest).await?;
    Ok((StatusCode::CREATED, Json(answer)))
}

/// Step 3.
pub async fn start_books(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<StartBooksRequest>,
) -> Result<(StatusCode, Json<infrastructure::SetupBooks>), AppError> {
    let books = infrastructure::start_books(&state.db, request, &principal.username).await?;
    Ok((StatusCode::CREATED, Json(books)))
}
