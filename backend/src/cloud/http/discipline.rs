//! Warning letters (0811): the handlers.

use super::auth::Principal;
use super::employment::resolve;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{actions, required_role_for_action, role_allows, Authorization},
    postgres::{self as infrastructure, WarningLetterView},
};
use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{NaiveDate, Utc};
use serde::Deserialize;

fn require(principal: &Principal, action_key: &str) -> Result<(), AppError> {
    if role_allows(required_role_for_action(action_key), principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {action_key}",
        principal.username
    )))
}

fn authority(principal: &Principal, reason: &str) -> Result<Authorization, AppError> {
    Authorization::try_new(&principal.username, actions::EMPLOYMENT_CHANGE, Utc::now(), reason)
        .map_err(|error| AppError::Validation(error.to_string()))
}

/// One person's letters. `me` reads one's own.
pub async fn letters(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<WarningLetterView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    Ok(Json(infrastructure::warning_letters_of(&state.db, &access.employee_id).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct IssueLetterBody {
    pub level: String,
    pub issued_on: NaiveDate,
    /// Months in force; six when not said.
    #[serde(default)]
    pub valid_months: Option<u32>,
    pub violation: String,
    pub reason: String,
}

pub async fn issue(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<IssueLetterBody>,
) -> Result<Json<Vec<WarningLetterView>>, AppError> {
    require(&principal, actions::EMPLOYMENT_CHANGE)?;
    if raw == "me" {
        return Err(AppError::Forbidden("nobody warns themselves".into()));
    }
    let access = resolve(&state, &principal, &raw).await?;
    let by = authority(&principal, &body.reason)?;
    infrastructure::issue_warning_letter(
        &state.db,
        &access.employee_id,
        &body.level,
        body.issued_on,
        body.valid_months,
        &body.violation,
        &by,
    )
    .await?;
    Ok(Json(infrastructure::warning_letters_of(&state.db, &access.employee_id).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LettersQuery {
    /// Lapsed and revoked letters too, not only those in force.
    #[serde(default)]
    pub all: bool,
}

pub async fn active(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    axum::extract::Query(query): axum::extract::Query<LettersQuery>,
) -> Result<Json<Vec<WarningLetterView>>, AppError> {
    require(&principal, actions::EMPLOYMENT_CHANGE)?;
    Ok(Json(if query.all {
        infrastructure::all_warning_letters(&state.db).await?
    } else {
        infrastructure::active_warning_letters(&state.db).await?
    }))
}

/// The employee says they were given it — only their own, through `me`.
pub async fn acknowledge(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((raw, id)): Path<(String, String)>,
) -> Result<Json<Vec<WarningLetterView>>, AppError> {
    if raw != "me" {
        return Err(AppError::Forbidden(
            "a letter is acknowledged by the person it was given to".into(),
        ));
    }
    let access = resolve(&state, &principal, &raw).await?;
    infrastructure::acknowledge_warning_letter(&state.db, &id, &access.employee_id).await?;
    Ok(Json(infrastructure::warning_letters_of(&state.db, &access.employee_id).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReasonBody {
    pub reason: String,
}

pub async fn revoke(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<ReasonBody>,
) -> Result<Json<Vec<WarningLetterView>>, AppError> {
    require(&principal, actions::EMPLOYMENT_CHANGE)?;
    let employee = infrastructure::warning_letter_employee(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("letter {id}")))?;
    let by = authority(&principal, &body.reason)?;
    infrastructure::revoke_warning_letter(&state.db, &id, &by).await?;
    Ok(Json(infrastructure::warning_letters_of(&state.db, &employee).await?))
}
