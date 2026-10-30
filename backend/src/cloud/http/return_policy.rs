//! The return-policy routes.
//!
//! Reading is open to anyone Commerce already lets read a price book; writing
//! falls through `required_role` to Supervisor, which is where Commercial's
//! authoring lives. The till does not call these — it receives the same
//! promise through its auth policy and resolves locally, offline.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, ReturnPolicyCatalogue, SaveReturnPolicyRequest,
        SaveReturnPolicySettings,
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
) -> Result<Json<ReturnPolicyCatalogue>, AppError> {
    Ok(Json(
        infrastructure::return_policy_catalogue(&state.db).await?,
    ))
}

pub async fn save_settings(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<SaveReturnPolicySettings>,
) -> Result<Json<infrastructure::ReturnPolicySettingsRow>, AppError> {
    Ok(Json(
        infrastructure::save_settings(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn save_policy(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<SaveReturnPolicyRequest>,
) -> Result<Json<infrastructure::ReturnPolicyRow>, AppError> {
    Ok(Json(
        infrastructure::save_policy(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn delete_policy(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(policy_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    infrastructure::delete_policy(&state.db, policy_id, &principal.username).await?;
    Ok(StatusCode::NO_CONTENT)
}
