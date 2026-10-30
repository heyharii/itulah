//! The point-policy routes, the return policy's shape.
//!
//! Reading is the Marketing screen; writing falls through `required_role` to
//! Supervisor, where Commercial's authoring lives. The till does not call
//! these — it receives the policy on its auth policy and earns offline.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, PointPolicyCatalogue, SavePointPolicyRequest,
        SavePointPolicySettings,
    },
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use uuid::Uuid;

pub async fn read_catalogue(
    State(state): State<AppState>,
) -> Result<Json<PointPolicyCatalogue>, AppError> {
    Ok(Json(
        infrastructure::point_policy_catalogue(&state.db).await?,
    ))
}

pub async fn save_settings(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<SavePointPolicySettings>,
) -> Result<Json<infrastructure::PointPolicySettingsRow>, AppError> {
    Ok(Json(
        infrastructure::save_point_settings(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn save_policy(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<SavePointPolicyRequest>,
) -> Result<Json<infrastructure::PointPolicyRow>, AppError> {
    Ok(Json(
        infrastructure::save_point_policy(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn delete_policy(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(policy_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    infrastructure::delete_point_policy(&state.db, policy_id, &principal.username).await?;
    Ok(StatusCode::NO_CONTENT)
}
