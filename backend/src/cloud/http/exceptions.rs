//! The store exceptions list over HTTP (0646-0648). See
//! `postgres/store_exceptions.rs`.
//!
//! # Who
//!
//! Reading follows reach, as the stores pages do: head office, the owner, an
//! Admin and IT read every unit; a store's manager or supervisor reads the
//! unit they are posted to (`postgres::store_reach`). Within that, a person
//! sees the kinds their job's sections are about (`domain::store_exception`):
//! a store's people hold `stores` and see every kind at their store; Finance
//! sees the money kinds, Inventory and Operations the goods kinds. The
//! section gate has already asked that the job holds one of `stores`,
//! `finance`, `inventory` or `operations` for `/api/v1/exceptions`, and
//! `stores` for `/api/v1/stores/{unit}/exceptions`.
//!
//! Acknowledging is for whoever may see the item. Changing the thresholds is
//! the Admin's (`domain::auth::required_role`). A call a store's node relays
//! is refused: these are the hub's pages.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{store_exception::kinds_visible_to, store_exception::ExceptionKind, Role},
    postgres::{
        self as infrastructure, AcknowledgeExceptionRequest, ExceptionList, ExceptionQuery,
        ExceptionScope, ExceptionSettings, ExceptionSettingsView, StoreReach,
    },
};
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    Extension, Json,
};
use uuid::Uuid;

/// What this caller may see.
async fn scope_of(state: &AppState, principal: &Principal) -> Result<ExceptionScope, AppError> {
    if principal.relayed.is_some() {
        return Err(AppError::Forbidden(
            "the exceptions list is the hub's; a store's till cannot read it".into(),
        ));
    }
    if principal.role >= Role::Admin || principal.job.holds_everything() {
        return Ok(ExceptionScope {
            reach: StoreReach::Every,
            kinds: ExceptionKind::ALL.to_vec(),
        });
    }
    Ok(ExceptionScope {
        reach: infrastructure::store_reach(&state.db, &principal.username).await?,
        kinds: kinds_visible_to(&principal.job),
    })
}

/// `GET /api/v1/exceptions?unit=&kind=&state=open&limit=`.
pub async fn list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ExceptionQuery>,
) -> Result<Json<ExceptionList>, AppError> {
    let scope = scope_of(&state, &principal).await?;
    Ok(Json(
        infrastructure::exceptions_list(&state.db, &scope, &query).await?,
    ))
}

/// `GET /api/v1/stores/{unit}/exceptions?kind=&state=&limit=`: the same list
/// for one store, by its id or its code.
pub async fn for_store(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
    Query(mut query): Query<ExceptionQuery>,
) -> Result<Json<ExceptionList>, AppError> {
    let scope = scope_of(&state, &principal).await?;
    let unit_id = infrastructure::exception_unit_id(&state.db, &unit).await?;
    if !scope.reach.covers(&unit_id) {
        return Err(AppError::Forbidden(format!(
            "{} may read only the store they are posted to",
            principal.username
        )));
    }
    query.unit = Some(unit_id);
    Ok(Json(
        infrastructure::exceptions_list(&state.db, &scope, &query).await?,
    ))
}

/// `POST /api/v1/exceptions/{id}/acknowledge`, with `{note}` or no body.
pub async fn acknowledge(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(exception_id): Path<Uuid>,
    body: Bytes,
) -> Result<Json<infrastructure::ExceptionItem>, AppError> {
    let scope = scope_of(&state, &principal).await?;
    let request: AcknowledgeExceptionRequest = if body.iter().all(u8::is_ascii_whitespace) {
        AcknowledgeExceptionRequest::default()
    } else {
        serde_json::from_slice(&body)
            .map_err(|error| AppError::Validation(format!("invalid request: {error}")))?
    };
    Ok(Json(
        infrastructure::exception_acknowledge(
            &state.db,
            &scope,
            exception_id,
            &principal.username,
            request.note.as_deref(),
        )
        .await?,
    ))
}

/// `GET /api/v1/exceptions/settings`.
pub async fn settings(
    State(state): State<AppState>,
) -> Result<Json<ExceptionSettingsView>, AppError> {
    Ok(Json(infrastructure::exception_settings(&state.db).await?))
}

/// `PUT /api/v1/exceptions/settings`: the whole set. Admin's.
pub async fn update_settings(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(settings): Json<ExceptionSettings>,
) -> Result<Json<ExceptionSettingsView>, AppError> {
    if principal.role < Role::Admin {
        return Err(AppError::Forbidden(
            "only an Admin sets when a store's exceptions are raised".into(),
        ));
    }
    Ok(Json(
        infrastructure::exception_update_settings(&state.db, &settings, &principal.username)
            .await?,
    ))
}
