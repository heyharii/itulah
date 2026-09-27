//! The register of units and who is in charge of each: the hub's Units screen.
//!
//! Under `/api/v1/organisation/units` rather than `/api/v1/units`, which is the
//! older units-of-measure surface (PCS, LUSIN) and keeps its path. Here a unit
//! is head office or a store — the organisation that owns books and people.
//!
//! Reading is a session's, like every GET: which units exist and who answers
//! for each is the company's org chart, not a secret. Appointing a PIC is head
//! office's, behind [`actions::UNIT_PIC_SET`] at the Admin rung, because the
//! PIC gets the unit's reach and approvals and a shop that could appoint its
//! own would be granting itself authority.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{actions, required_role_for_action, role_allows, UnitId},
    postgres::{self as infrastructure, UnitPic, UnitView},
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{NaiveDate, Utc};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterQuery {
    /// The day the PICs and headcounts are read for. Today when absent.
    #[serde(default)]
    pub on: Option<NaiveDate>,
}

/// Every unit, head office first: code, name, kind, status, sites, headcount
/// and the PIC in charge on the day asked about.
pub async fn list_units(
    State(state): State<AppState>,
    Query(query): Query<RegisterQuery>,
) -> Result<Json<Vec<UnitView>>, AppError> {
    // Today where head office is: the register is the company's, not one
    // shop's (`sites::business_utc_offset_minutes`, 0603).
    let on = match query.on {
        Some(on) => on,
        None => crate::reporting::local_today_at(
            infrastructure::sites::business_utc_offset_minutes(&state.db, None, Utc::now())
                .await?,
        ),
    };
    Ok(Json(
        infrastructure::list_unit_register(&state.db, on).await?,
    ))
}

/// Everybody who has been in charge of one unit, newest first.
pub async fn pic_history(
    State(state): State<AppState>,
    Path(unit): Path<String>,
) -> Result<Json<Vec<UnitPic>>, AppError> {
    if infrastructure::unit_kind_of(&state.db, &unit)
        .await?
        .is_none()
    {
        return Err(AppError::NotFound(format!("unit {unit}")));
    }
    Ok(Json(
        infrastructure::unit_pic_history(&state.db, &unit).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppointPicBody {
    pub employee_id: String,
    /// The first day they are in charge. Today when absent.
    #[serde(default)]
    pub valid_from: Option<NaiveDate>,
    pub reason: String,
}

/// Put somebody in charge of a unit. Answers with the unit's PIC history, so
/// the screen shows the closed predecessor and the new appointment together.
pub async fn appoint_pic(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
    Json(body): Json<AppointPicBody>,
) -> Result<Json<Vec<UnitPic>>, AppError> {
    if !role_allows(
        required_role_for_action(actions::UNIT_PIC_SET),
        principal.role,
    ) {
        return Err(AppError::Forbidden(format!(
            "{} may not {}",
            principal.username,
            actions::UNIT_PIC_SET
        )));
    }
    let unit = UnitId::try_new(&unit).map_err(|error| AppError::Validation(error.to_string()))?;
    // Today at the unit, by its site's clock (0603): an appointment made at
    // half past midnight in the shop starts that day, not the UTC one before.
    let valid_from = match body.valid_from {
        Some(day) => day,
        None => crate::reporting::local_today_at(
            infrastructure::sites::unit_utc_offset_minutes(&state.db, unit.as_str(), Utc::now())
                .await?,
        ),
    };
    infrastructure::appoint_unit_pic(
        &state.db,
        &unit,
        body.employee_id.trim(),
        valid_from,
        &principal.username,
        &body.reason,
    )
    .await?;
    Ok(Json(
        infrastructure::unit_pic_history(&state.db, unit.as_str()).await?,
    ))
}
