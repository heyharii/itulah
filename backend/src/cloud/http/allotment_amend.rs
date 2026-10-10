//! MD changes an allotment in place, and sees what a cancel would cost
//! (docs/research/2026-10-09-outbound-cancel-edit-build.md, A1 and A3). The
//! cancel itself stays on `/cancel` (`postgres::cancel_allotment`). See
//! `postgres::allotment_amend` for the arithmetic.

use super::auth::Principal;
use crate::cloud::postgres as infrastructure;
use crate::cloud::{AppError, AppState};
use axum::{
    extract::{Path, State},
    routing::{get, post},
    Extension, Json, Router,
};
use uuid::Uuid;

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/inventory/allotments/{id}/amend", post(amend))
        .route("/api/v1/inventory/allotments/{id}/work", get(work))
}

/// Each named line to its new net target; never below what is sent.
async fn amend(
    State(s): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<infrastructure::AmendAllotmentRequest>,
) -> Result<Json<infrastructure::AmendAllotmentResult>, AppError> {
    Ok(Json(
        infrastructure::amend_allotment(&s.db, id, request, &principal.flow_actor()).await?,
    ))
}

/// Where the allotment's pieces stand, by stage.
async fn work(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<infrastructure::AllotmentWork>, AppError> {
    Ok(Json(infrastructure::allotment_work(&s.db, id).await?))
}
