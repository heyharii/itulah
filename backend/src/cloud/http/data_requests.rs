//! An employee asks for their own phone, email or address to be changed, and
//! HR decides (0816). Approving writes through the same kernel HR's own edit
//! uses, signed by the approver.

use super::auth::Principal;
use super::employment::{amend_contact, reach_of, resolve};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{actions, required_role_for_action, role_allows, Authorization},
    postgres::{self as infrastructure, PersonalDataRequestView},
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::Utc;
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

fn sign(principal: &Principal, action_key: &str, reason: &str) -> Result<Authorization, AppError> {
    Authorization::try_new(&principal.username, action_key, Utc::now(), reason)
        .map_err(|error| AppError::Validation(error.to_string()))
}

/// One person's requests. `me` reads one's own.
pub async fn of_employee(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<PersonalDataRequestView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    Ok(Json(
        infrastructure::personal_data_requests_of(&state.db, &access.employee_id).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FileDataRequestBody {
    /// `phone`, `email` or `address`.
    pub field: String,
    /// The value it should become. Empty clears a phone or an email.
    pub value: String,
    pub reason: String,
}

/// File one's own request. Only through `me`: HR changes somebody else's
/// details directly, from their sheet.
pub async fn file(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<FileDataRequestBody>,
) -> Result<Json<Vec<PersonalDataRequestView>>, AppError> {
    if raw != "me" {
        return Err(AppError::Forbidden(
            "a change request is filed by the person it is about; HR edits the record directly"
                .into(),
        ));
    }
    require(&principal, actions::PROFILE_REQUEST_OWN)?;
    let access = resolve(&state, &principal, &raw).await?;
    let filed = sign(&principal, actions::PROFILE_REQUEST_OWN, &body.reason)?;
    infrastructure::file_personal_data_request(
        &state.db,
        &access.employee_id,
        body.field.trim(),
        &body.value,
        &filed,
    )
    .await?;
    Ok(Json(
        infrastructure::personal_data_requests_of(&state.db, &access.employee_id).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QueueQuery {
    /// Decided requests too, not only those waiting.
    #[serde(default)]
    pub all: bool,
}

/// HR's queue: what is waiting, within the caller's reach.
pub async fn queue(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<QueueQuery>,
) -> Result<Json<Vec<PersonalDataRequestView>>, AppError> {
    require(&principal, actions::PROFILE_CHANGE)?;
    let reach = reach_of(&state, &principal).await?;
    let rows = infrastructure::personal_data_requests(&state.db, query.all).await?;
    Ok(Json(
        rows.into_iter()
            .filter(|row| reach.covers(row.unit_id.as_deref()))
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DecideDataRequestBody {
    pub approve: bool,
    pub reason: String,
}

/// Approve — the record changes, signed by the approver — or reject. Nobody
/// decides their own request.
pub async fn decide(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<DecideDataRequestBody>,
) -> Result<Json<PersonalDataRequestView>, AppError> {
    require(&principal, actions::PROFILE_CHANGE)?;
    let request = infrastructure::personal_data_request(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("request {id}")))?;
    if request.filed_by == principal.username {
        return Err(AppError::Forbidden(
            "your own request is somebody else's to decide".into(),
        ));
    }
    let reach = reach_of(&state, &principal).await?;
    if !reach.covers(request.unit_id.as_deref()) {
        return Err(AppError::Forbidden(format!(
            "{} does not reach where {} works",
            principal.username, request.employee_code
        )));
    }
    if request.state != "PENDING" {
        return Err(AppError::Conflict(format!(
            "request {id} is already {}",
            request.state
        )));
    }
    let by = sign(&principal, actions::PROFILE_CHANGE, &body.reason)?;
    if body.approve {
        amend_contact(
            &state,
            &request.employee_id,
            &request.field,
            &request.value,
            sign(
                &principal,
                actions::PROFILE_CHANGE,
                &format!("on {}'s request: {}", request.employee_code, request.reason),
            )?,
        )
        .await?;
    }
    infrastructure::close_personal_data_request(
        &state.db,
        &id,
        if body.approve { "APPROVED" } else { "REJECTED" },
        &by,
    )
    .await?;
    infrastructure::personal_data_request(&state.db, &id)
        .await?
        .map(Json)
        .ok_or_else(|| AppError::NotFound(format!("request {id}")))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WithdrawBody {
    pub reason: String,
}

/// The person takes their own request back while it waits.
pub async fn withdraw(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<WithdrawBody>,
) -> Result<Json<Vec<PersonalDataRequestView>>, AppError> {
    let request = infrastructure::personal_data_request(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("request {id}")))?;
    let access = resolve(&state, &principal, "me").await?;
    if access.employee_id != request.employee_id {
        return Err(AppError::Forbidden(
            "only the person who asked takes a request back".into(),
        ));
    }
    let by = sign(&principal, actions::PROFILE_REQUEST_OWN, &body.reason)?;
    infrastructure::close_personal_data_request(&state.db, &id, "WITHDRAWN", &by).await?;
    Ok(Json(
        infrastructure::personal_data_requests_of(&state.db, &request.employee_id).await?,
    ))
}
