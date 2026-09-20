//! What an asset may be filed as.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{role_allows, Role},
    postgres::{self as infrastructure, AssetClassList},
};
use axum::{
    extract::{Query, State},
    routing::get,
    Extension, Json, Router,
};
use serde::Deserialize;

fn allowed(principal: &Principal, needed: Role, act: &str) -> Result<(), AppError> {
    if role_allows(needed, principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {act}",
        principal.username
    )))
}

#[derive(Debug, Deserialize)]
pub struct AssetClassQuery {
    /// `PPE`, `OE`, `INTANGIBLE` or `DEFERRED`.
    pub kind: Option<String>,
}

pub async fn classes(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<AssetClassQuery>,
) -> Result<Json<AssetClassList>, AppError> {
    allowed(&principal, Role::Supervisor, "read the asset classes")?;
    Ok(Json(
        infrastructure::asset_classes(&state.db, query.kind.as_deref()).await?,
    ))
}

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router.route("/api/v1/finance/asset-classes", get(classes))
}
