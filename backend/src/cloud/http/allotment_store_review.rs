//! MD's review of what the stores of a trip counted (owner, 17–18 Oct 2026).
//! See `postgres::allotment_store_review` for how a trip comes to be in it,
//! and what each answer does.

use super::auth::Principal;
use crate::cloud::postgres as infrastructure;
use crate::cloud::{AppError, AppState};
use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route(
            "/api/v1/inventory/allotments/store-reviews",
            get(store_reviews),
        )
        .route(
            "/api/v1/inventory/allotments/store-reviews/{dispatch_id}/plan",
            get(plan),
        )
        .route(
            "/api/v1/inventory/allotments/store-reviews/{dispatch_id}/decide",
            post(decide),
        )
}

/// Every trip whose stores counted something else than was sent, not yet
/// answered, newest first.
async fn store_reviews(
    State(s): State<AppState>,
) -> Result<Json<infrastructure::StoreReviewList>, AppError> {
    Ok(Json(
        infrastructure::list_store_reviews(&s.db, s.clock.now()).await?,
    ))
}

#[derive(Deserialize)]
struct PlanQuery {
    decision: String,
    /// One store of the trip; none plans the trip whole.
    #[serde(default)]
    store: Option<String>,
}

/// What an answer would do, for the dialog that asks for it.
async fn plan(
    State(s): State<AppState>,
    Path(dispatch_id): Path<Uuid>,
    Query(query): Query<PlanQuery>,
) -> Result<Json<infrastructure::StoreReviewPlan>, AppError> {
    Ok(Json(
        infrastructure::plan_store_review(
            &s.db,
            dispatch_id,
            &query.decision,
            query
                .store
                .as_deref()
                .map(str::trim)
                .filter(|one| !one.is_empty()),
            s.clock.now(),
        )
        .await?,
    ))
}

/// MD answers: Accept as delivered, or Return & reallot.
async fn decide(
    State(s): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(dispatch_id): Path<Uuid>,
    Json(request): Json<infrastructure::DecideStoreReviewRequest>,
) -> Result<Json<infrastructure::StoreReviewDecision>, AppError> {
    Ok(Json(
        infrastructure::decide_store_review(
            &s.db,
            dispatch_id,
            request,
            &principal.flow_actor(),
            s.clock.now(),
        )
        .await?,
    ))
}
