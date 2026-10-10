//! Attendance settings (0807): the handlers.

use super::auth::Principal;
use super::employment::{current_unit, resolve};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{actions, required_role_for_action, role_allows, Authorization},
    postgres::{self as infrastructure, AbsenceRuleView, GeofenceView, MobileAttendanceSetting},
};
use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};

fn require(principal: &Principal, action_key: &str) -> Result<(), AppError> {
    if role_allows(required_role_for_action(action_key), principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {action_key}",
        principal.username
    )))
}

fn authority(principal: &Principal, key: &str, reason: &str) -> Result<Authorization, AppError> {
    Authorization::try_new(&principal.username, key, Utc::now(), reason)
        .map_err(|error| AppError::Validation(error.to_string()))
}

pub async fn mobile_setting(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<MobileAttendanceSetting>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    Ok(Json(infrastructure::mobile_setting(&state.db).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveMobileSettingBody {
    pub mobile_enabled: bool,
    pub require_location: bool,
    pub require_geofence: bool,
    pub reason: String,
}

pub async fn save_mobile_setting(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<SaveMobileSettingBody>,
) -> Result<Json<MobileAttendanceSetting>, AppError> {
    require(&principal, actions::ATTENDANCE_POLICY_SET)?;
    let by = authority(&principal, actions::ATTENDANCE_POLICY_SET, &body.reason)?;
    infrastructure::save_mobile_setting(
        &state.db,
        &MobileAttendanceSetting {
            mobile_enabled: body.mobile_enabled,
            require_location: body.require_location,
            require_geofence: body.require_geofence,
        },
        &by,
    )
    .await?;
    Ok(Json(infrastructure::mobile_setting(&state.db).await?))
}

pub async fn geofences(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<GeofenceView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    Ok(Json(infrastructure::geofences(&state.db).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetGeofenceBody {
    pub latitude: f64,
    pub longitude: f64,
    pub radius_m: i32,
    pub reason: String,
}

pub async fn set_geofence(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
    Json(body): Json<SetGeofenceBody>,
) -> Result<Json<Vec<GeofenceView>>, AppError> {
    require(&principal, actions::ATTENDANCE_POLICY_SET)?;
    let by = authority(&principal, actions::ATTENDANCE_POLICY_SET, &body.reason)?;
    infrastructure::set_geofence(
        &state.db,
        &unit,
        body.latitude,
        body.longitude,
        body.radius_m,
        &by,
    )
    .await?;
    Ok(Json(infrastructure::geofences(&state.db).await?))
}

pub async fn remove_geofence(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
) -> Result<Json<Vec<GeofenceView>>, AppError> {
    require(&principal, actions::ATTENDANCE_POLICY_SET)?;
    infrastructure::remove_geofence(&state.db, &unit).await?;
    Ok(Json(infrastructure::geofences(&state.db).await?))
}

/// What the employee app needs before a punch: whether it may punch, whether
/// it must send where it is, and the fence of the unit it is posted to.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OwnAttendanceSetting {
    pub setting: MobileAttendanceSetting,
    pub unit_id: Option<String>,
    pub fence: Option<GeofenceView>,
}

pub async fn own_attendance_setting(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<OwnAttendanceSetting>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    let record = infrastructure::load_employee(&state.db, &access.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", access.employee_id)))?;
    let unit_id = current_unit(&record).map(ToOwned::to_owned);
    let fence = match &unit_id {
        Some(unit) => infrastructure::geofence_of(&state.db, unit).await?,
        None => None,
    };
    Ok(Json(OwnAttendanceSetting {
        setting: infrastructure::mobile_setting(&state.db).await?,
        unit_id,
        fence,
    }))
}

pub async fn absence_rules(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<AbsenceRuleView>>, AppError> {
    require(&principal, actions::PAY_READ)?;
    Ok(Json(infrastructure::absence_rules(&state.db).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StateAbsenceRuleBody {
    pub effective_from: NaiveDate,
    pub enabled: bool,
    pub basis: String,
    #[serde(default)]
    pub divisor_days: Option<i32>,
    pub reason: String,
}

pub async fn state_absence_rule(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<StateAbsenceRuleBody>,
) -> Result<Json<Vec<AbsenceRuleView>>, AppError> {
    require(&principal, actions::PAY_CHANGE)?;
    let by = authority(&principal, actions::PAY_CHANGE, &body.reason)?;
    infrastructure::state_absence_rule(
        &state.db,
        body.effective_from,
        body.enabled,
        &body.basis,
        body.divisor_days,
        &by,
    )
    .await?;
    Ok(Json(infrastructure::absence_rules(&state.db).await?))
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OvertimeTierView {
    pub rest_day_first_tier_minutes: i32,
}

pub async fn overtime_tier(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<OvertimeTierView>, AppError> {
    require(&principal, actions::PAY_READ)?;
    Ok(Json(OvertimeTierView {
        rest_day_first_tier_minutes: infrastructure::overtime_tier_minutes(&state.db).await?,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetOvertimeTierBody {
    pub rest_day_first_tier_minutes: i32,
    pub reason: String,
}

pub async fn set_overtime_tier(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<SetOvertimeTierBody>,
) -> Result<Json<OvertimeTierView>, AppError> {
    require(&principal, actions::PAY_CHANGE)?;
    let by = authority(&principal, actions::PAY_CHANGE, &body.reason)?;
    infrastructure::set_overtime_tier_minutes(&state.db, body.rest_day_first_tier_minutes, &by)
        .await?;
    Ok(Json(OvertimeTierView {
        rest_day_first_tier_minutes: infrastructure::overtime_tier_minutes(&state.db).await?,
    }))
}
