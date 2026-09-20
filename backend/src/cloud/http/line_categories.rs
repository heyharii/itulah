//! The categories a journal line may carry, and which accounts admit them.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{role_allows, Role},
    postgres::{self as infrastructure, LineCategoryDirectory},
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
pub struct CategoryQuery {
    pub family: Option<String>,
}

/// The whole directory: the categories, and the families accounts declare.
///
/// Read by anybody who may read the chart. A category is a list of words a
/// cost can be filed under — there is nothing in it to keep from a supervisor
/// who is about to file one, and the picker is on every account field.
pub async fn categories(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<CategoryQuery>,
) -> Result<Json<LineCategoryDirectory>, AppError> {
    allowed(&principal, Role::Supervisor, "read the line categories")?;
    Ok(Json(
        infrastructure::line_categories(&state.db, query.family.as_deref()).await?,
    ))
}

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router.route("/api/v1/finance/line-categories", get(categories))
}
