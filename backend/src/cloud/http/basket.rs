//! The buyer's basket, over HTTP.
//!
//! Every route here is scoped to the caller by the session and nothing else:
//! the owner comes from `Principal`, never from the request, so there is no
//! shape of request that reads or empties somebody else's basket. That is why
//! none of these paths carry a user id.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{self as infrastructure, AddToBasketRequest, BasketLine, SetBasketQuantityRequest},
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use uuid::Uuid;

/// What this buyer has picked out.
pub async fn read_basket(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<BasketLine>>, AppError> {
    Ok(Json(
        infrastructure::read_basket(&state.db, &principal.username).await?,
    ))
}

/// Put something in it, or more of something already in it.
pub async fn add_to_basket(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<AddToBasketRequest>,
) -> Result<(StatusCode, Json<BasketLine>), AppError> {
    let line = infrastructure::add_to_basket(&state.db, &principal.username, &request).await?;
    Ok((StatusCode::CREATED, Json(line)))
}

/// Say exactly how many. Zero takes the line out, and answers 204 because
/// there is no line left to describe.
pub async fn set_basket_quantity(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(supplier_item_id): Path<Uuid>,
    Json(request): Json<SetBasketQuantityRequest>,
) -> Result<Response, AppError> {
    let line = infrastructure::set_basket_quantity(
        &state.db,
        &principal.username,
        supplier_item_id,
        request.quantity,
    )
    .await?;
    // Two different answers, not one answer with a null in it: the line still
    // exists and here it is, or it does not and there is nothing to describe.
    Ok(match line {
        Some(line) => (StatusCode::OK, Json(line)).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    })
}

/// Take one thing out. A POST rather than a DELETE because the CORS layer
/// permits GET, POST and PATCH, and widening it for one route would loosen
/// every route.
pub async fn remove_from_basket(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(supplier_item_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    infrastructure::remove_from_basket(&state.db, &principal.username, supplier_item_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Empty it.
pub async fn clear_basket(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<StatusCode, AppError> {
    infrastructure::clear_basket(&state.db, &principal.username).await?;
    Ok(StatusCode::NO_CONTENT)
}
