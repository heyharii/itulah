//! Leave beyond requests (0809): the handlers.

use super::auth::Principal;
use super::employment::{current_unit, reach_of, resolve};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{actions, required_role_for_action, role_allows, Authorization, Reach},
    postgres::{
        self as infrastructure, HolidayWorkView, LeaveBlackoutView, LeaveEncashmentView,
        TeamCalendarView,
    },
};
use axum::{
    extract::{Path, Query, State},
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

fn authority(principal: &Principal, key: &str, reason: &str) -> Result<Authorization, AppError> {
    Authorization::try_new(&principal.username, key, Utc::now(), reason)
        .map_err(|error| AppError::Validation(error.to_string()))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReasonBody {
    pub reason: String,
}

// ── blocked dates ───────────────────────────────────────────────────────────

pub async fn blackouts(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<LeaveBlackoutView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    Ok(Json(infrastructure::leave_blackouts(&state.db).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BlockLeaveBody {
    pub from_date: NaiveDate,
    pub to_date: NaiveDate,
    #[serde(default)]
    pub unit_id: Option<String>,
    pub reason: String,
}

pub async fn block_leave(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<BlockLeaveBody>,
) -> Result<Json<Vec<LeaveBlackoutView>>, AppError> {
    require(&principal, actions::LEAVE_TYPE_SET)?;
    let by = authority(&principal, actions::LEAVE_TYPE_SET, &body.reason)?;
    infrastructure::block_leave(
        &state.db,
        body.from_date,
        body.to_date,
        body.unit_id.as_deref(),
        &body.reason,
        &by,
    )
    .await?;
    Ok(Json(infrastructure::leave_blackouts(&state.db).await?))
}

pub async fn lift_block(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<ReasonBody>,
) -> Result<Json<Vec<LeaveBlackoutView>>, AppError> {
    require(&principal, actions::LEAVE_TYPE_SET)?;
    let by = authority(&principal, actions::LEAVE_TYPE_SET, &body.reason)?;
    infrastructure::lift_leave_block(&state.db, &id, &by).await?;
    Ok(Json(infrastructure::leave_blackouts(&state.db).await?))
}

// ── paying days out ─────────────────────────────────────────────────────────

pub async fn encashments(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<LeaveEncashmentView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    Ok(Json(
        infrastructure::encashments_of(&state.db, &access.employee_id).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EncashLeaveBody {
    pub leave_type: String,
    /// Days, to two decimals.
    pub days: f64,
    /// `YYYY-MM`: the payroll month it is paid in.
    pub period: String,
    /// The days a month's wage is divided by to value one; 25 when not said.
    #[serde(default)]
    pub divisor_days: Option<i32>,
    pub reason: String,
}

/// Pay days out (Uangkan cuti). Head office's: it is both a balance and a
/// wage. The days leave the balance and the money joins that month's run in
/// one transaction, and a draft run is recalculated at once.
pub async fn encash(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<EncashLeaveBody>,
) -> Result<Json<Vec<LeaveEncashmentView>>, AppError> {
    require(&principal, actions::PAY_CHANGE)?;
    require(&principal, actions::LEAVE_GRANT)?;
    if raw == "me" {
        return Err(AppError::Forbidden(
            "leave is paid out by head office".into(),
        ));
    }
    let access = resolve(&state, &principal, &raw).await?;
    let record = infrastructure::load_employee(&state.db, &access.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", access.employee_id)))?;
    let unit = current_unit(&record)
        .ok_or_else(|| {
            AppError::Conflict(format!("{} is not posted anywhere", access.employee_id))
        })?
        .to_owned();
    let period = NaiveDate::parse_from_str(&format!("{}-01", body.period), "%Y-%m-%d")
        .map_err(|_| AppError::Validation("period is a month, YYYY-MM".into()))?;
    let centidays = (body.days * 100.0).round() as i32;

    let catalogue = infrastructure::load_catalogue(&state.db).await?;
    let balance = infrastructure::balances_of(
        &state.db,
        &access.employee_id,
        &catalogue,
        crate::reporting::local_today(),
    )
    .await?
    .into_iter()
    .find(|row| row.leave_type == body.leave_type)
    .ok_or_else(|| {
        AppError::Validation(format!(
            "{} is not a kind of leave with a balance",
            body.leave_type
        ))
    })?;
    let available = balance.centidays - balance.pending_centidays;

    let encashed = authority(&principal, actions::LEAVE_GRANT, &body.reason)?;
    let filed = authority(
        &principal,
        actions::PAYROLL_ADJUSTMENT_FILE,
        &format!("uang pengganti cuti: {}", body.reason),
    )?;
    infrastructure::encash_leave(
        &state.db,
        &access.employee_id,
        &unit,
        &body.leave_type,
        centidays,
        available,
        period,
        body.divisor_days.unwrap_or(25),
        &encashed,
        &filed,
    )
    .await?;
    infrastructure::rebuild_draft_run(&state.db, &unit, period).await?;
    Ok(Json(
        infrastructure::encashments_of(&state.db, &access.employee_id).await?,
    ))
}

// ── holidays worked ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpanQuery {
    pub from: NaiveDate,
    pub to: NaiveDate,
}

pub async fn holiday_work(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<SpanQuery>,
) -> Result<Json<Vec<HolidayWorkView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    let rows = infrastructure::holiday_work_between(&state.db, query.from, query.to).await?;
    let reach = reach_of(&state, &principal).await?;
    if matches!(reach, Reach::Everywhere) {
        return Ok(Json(rows));
    }
    // A manager reads their own unit's people.
    let mut kept = Vec::new();
    for row in rows {
        let record = infrastructure::load_employee(&state.db, &row.employee_id).await?;
        let unit = record
            .as_ref()
            .and_then(|r| current_unit(r).map(ToOwned::to_owned));
        if reach.covers(unit.as_deref()) {
            kept.push(row);
        }
    }
    Ok(Json(kept))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordHolidayWorkBody {
    pub on_date: NaiveDate,
    pub leave_type: String,
    /// Days earned back, to two decimals; one when not said.
    #[serde(default)]
    pub days: Option<f64>,
    pub reason: String,
}

pub async fn record_holiday_work(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<RecordHolidayWorkBody>,
) -> Result<Json<Vec<HolidayWorkView>>, AppError> {
    require(&principal, actions::LEAVE_GRANT)?;
    if raw == "me" {
        return Err(AppError::Forbidden(
            "a holiday worked is recorded by HR".into(),
        ));
    }
    let access = resolve(&state, &principal, &raw).await?;
    let by = authority(&principal, actions::LEAVE_GRANT, &body.reason)?;
    let centidays = (body.days.unwrap_or(1.0) * 100.0).round() as i32;
    infrastructure::record_holiday_work(
        &state.db,
        &access.employee_id,
        body.on_date,
        &body.leave_type,
        centidays,
        &by,
    )
    .await?;
    let rows = infrastructure::holiday_work_between(&state.db, body.on_date, body.on_date).await?;
    Ok(Json(rows))
}

// ── the team's calendar ─────────────────────────────────────────────────────

/// Who is away when. Head office sees every unit; a manager their own; an
/// employee (`me`-scoped readers) the unit they are posted to.
pub async fn team_calendar(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<SpanQuery>,
) -> Result<Json<TeamCalendarView>, AppError> {
    if query.to < query.from || (query.to - query.from).num_days() > 92 {
        return Err(AppError::Validation(
            "a calendar span runs forward and is at most three months".into(),
        ));
    }
    let reach = reach_of(&state, &principal).await?;
    let units = match reach {
        Reach::Everywhere => None,
        Reach::Only(unit) => Some(vec![unit.to_string()]),
        Reach::Nowhere => {
            // An employee: their own unit, from their record.
            let caller = infrastructure::caller_record(&state.db, &principal.username).await?;
            let unit = match caller.employee_id {
                Some(id) => infrastructure::load_employee(&state.db, &id)
                    .await?
                    .and_then(|r| current_unit(&r).map(ToOwned::to_owned)),
                None => None,
            };
            Some(unit.into_iter().collect())
        }
    };
    Ok(Json(
        infrastructure::team_calendar(&state.db, query.from, query.to, units.as_deref()).await?,
    ))
}
