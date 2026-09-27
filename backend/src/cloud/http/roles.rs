//! Job roles (0633): the handlers.
//!
//! Reading the list is everybody's — a screen names a colleague's role, and
//! the invite form offers the list. Changing a role is the administrator's
//! (`required_role`), and checked here as well so that a `role_permission`
//! override lowering the path (0472) cannot hand it to anybody else: a role
//! decides what everybody holding it may do.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::Role,
    postgres::{self as infrastructure, JobRole, JobRoleList, JobRolePatch},
};
use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde_json::{json, Value};

fn require_admin(principal: &Principal) -> Result<(), AppError> {
    if principal.role >= Role::Admin {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not change job roles: that is head office's administrator's",
        principal.username
    )))
}

/// `GET /api/v1/roles`.
pub async fn list(State(state): State<AppState>) -> Result<Json<JobRoleList>, AppError> {
    Ok(Json(infrastructure::list_job_roles(&state.db).await?))
}

/// `PUT /api/v1/roles/{code}`: edit a role, or create one nobody seeded.
pub async fn put(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
    Json(patch): Json<JobRolePatch>,
) -> Result<Json<JobRole>, AppError> {
    require_admin(&principal)?;
    Ok(Json(
        infrastructure::put_job_role(&state.db, &code, patch, &principal.username).await?,
    ))
}

/// `DELETE /api/v1/roles/{code}`: only a role somebody created, and nobody
/// holds.
pub async fn delete(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
) -> Result<Json<Value>, AppError> {
    require_admin(&principal)?;
    infrastructure::delete_job_role(&state.db, &code).await?;
    Ok(Json(json!({ "code": code.trim().to_ascii_uppercase(), "deleted": true })))
}
