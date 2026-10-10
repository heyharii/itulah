//! Approval delegation (0812): the handlers.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::Role,
    postgres::{self as infrastructure, DelegationView},
};
use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::NaiveDate;
use serde::Deserialize;

/// The delegations the caller gave or was given; an administrator sees all.
pub async fn list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<DelegationView>>, AppError> {
    Ok(Json(
        infrastructure::delegations(
            &state.db,
            &principal.username,
            principal.role >= Role::Admin,
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DelegateBody {
    /// Whose decisions are handed over. The caller's own when absent; only an
    /// administrator names somebody else's.
    #[serde(default)]
    pub delegator: Option<String>,
    pub delegate: String,
    pub from_date: NaiveDate,
    pub to_date: NaiveDate,
    pub reason: String,
}

/// Hand one's decisions to somebody for a span. A manager (or above) hands
/// their own; an administrator may set one up for anybody.
pub async fn create(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<DelegateBody>,
) -> Result<Json<Vec<DelegationView>>, AppError> {
    if principal.role < Role::Supervisor {
        return Err(AppError::Forbidden(
            "only somebody who decides things has decisions to hand over".into(),
        ));
    }
    let delegator = match body
        .delegator
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
    {
        Some(other) if other != principal.username => {
            if principal.role < Role::Admin {
                return Err(AppError::Forbidden(
                    "only an administrator hands over somebody else's decisions".into(),
                ));
            }
            other.to_owned()
        }
        _ => principal.username.clone(),
    };
    infrastructure::create_delegation(
        &state.db,
        &delegator,
        body.delegate.trim(),
        body.from_date,
        body.to_date,
        &body.reason,
        &principal.username,
    )
    .await?;
    Ok(Json(
        infrastructure::delegations(
            &state.db,
            &principal.username,
            principal.role >= Role::Admin,
        )
        .await?,
    ))
}

pub async fn revoke(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
) -> Result<Json<Vec<DelegationView>>, AppError> {
    infrastructure::revoke_delegation(
        &state.db,
        &id,
        &principal.username,
        principal.role >= Role::Admin,
    )
    .await?;
    Ok(Json(
        infrastructure::delegations(
            &state.db,
            &principal.username,
            principal.role >= Role::Admin,
        )
        .await?,
    ))
}

/// The paths a delegation opens: deciding leave, expense claims and
/// attendance corrections, and reading the queues they are decided from.
/// Nothing else of the delegator's travels.
pub fn is_delegable(method: &str, path: &str) -> bool {
    match method {
        "GET" => {
            path == "/api/v1/leave-requests/pending"
                || path == "/api/v1/expense-claims"
                || path == "/api/v1/attendance-corrections"
        }
        "POST" => {
            (path.starts_with("/api/v1/employees/")
                && path.contains("/leave-requests/")
                && (path.ends_with("/approve") || path.ends_with("/reject")))
                || (path.starts_with("/api/v1/expense-claims/")
                    && (path.ends_with("/decision") || path.ends_with("/returnal")))
                || (path.starts_with("/api/v1/attendance-corrections/")
                    && path.ends_with("/decision"))
        }
        _ => false,
    }
}

// ── the employee app's modules (0813) ───────────────────────────────────────

#[derive(Debug, serde::Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EssModulesView {
    pub modules: Vec<String>,
}

/// Which modules the employee app offers. Anybody signed in may read it —
/// through `me`, which every employee reaches.
pub async fn ess_modules(State(state): State<AppState>) -> Result<Json<EssModulesView>, AppError> {
    Ok(Json(EssModulesView {
        modules: infrastructure::ess_modules(&state.db).await?,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetEssModulesBody {
    pub modules: Vec<String>,
    pub reason: String,
}

pub async fn set_ess_modules(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<SetEssModulesBody>,
) -> Result<Json<EssModulesView>, AppError> {
    if principal.role < Role::Admin {
        return Err(AppError::Forbidden(
            "the employee app is head office's to shape".into(),
        ));
    }
    let by = crate::cloud::domain::Authorization::try_new(
        &principal.username,
        crate::cloud::domain::actions::EMPLOYMENT_CHANGE,
        chrono::Utc::now(),
        &body.reason,
    )
    .map_err(|error| AppError::Validation(error.to_string()))?;
    infrastructure::set_ess_modules(&state.db, &body.modules, &by).await?;
    Ok(Json(EssModulesView {
        modules: infrastructure::ess_modules(&state.db).await?,
    }))
}
