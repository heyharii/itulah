//! Shift patterns, the roster, and signing off a month.
//!
//! # Who does what, and why the keys differ
//!
//! Shift *patterns* are head office's: a shop that could invent its own idea of
//! a shift is a shop whose rota means nothing next to the shop beside it.
//! Building the rota out of them is the place manager's, bounded by their
//! posting. Closing a month is theirs too — it is their sign-off — and
//! **reopening one is head office's**, because a place that could reopen its
//! own close has not closed anything.
//!
//! # The period is loaded, never taken from the body
//!
//! Every guard in the roster kernel asks the period it is handed, so a caller
//! who supplies the period supplies the answer. Nothing here accepts one: the
//! period for the date being written is loaded, and the guard is asked of that.

use super::auth::Principal;
use super::employment::{current_place, reach_of, resolve, Access};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, required_role_for_action, role_allows, AttendanceMonth, Authorization,
        CloseReadiness, DayOffset, DayPlan, EmployeeId, MinuteOfDay, Minutes, PeriodEvent, PlaceId,
        RosterDay, Shift, ShiftId,
    },
    postgres::{self as infrastructure, RosterDayRow},
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

fn invalid(error: impl std::fmt::Display) -> AppError {
    AppError::Validation(error.to_string())
}

fn require(principal: &Principal, action_key: &str) -> Result<(), AppError> {
    if role_allows(required_role_for_action(action_key), principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {action_key}",
        principal.username
    )))
}

// ── views ────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ShiftView {
    pub id: String,
    pub name: String,
    /// `HH:MM`, because a rota is read off a wall rather than divided.
    pub starts_at: String,
    pub ends_at: String,
    pub crosses_midnight: bool,
    pub unpaid_break_minutes: u32,
    /// The span less the break — what the day is worth in paid time.
    pub planned_work_minutes: u32,
}

fn shift_view(shift: &Shift) -> ShiftView {
    ShiftView {
        id: shift.id().to_string(),
        name: shift.name().to_owned(),
        starts_at: shift.start().to_string(),
        ends_at: shift.end().to_string(),
        crosses_midnight: shift.crosses_midnight(),
        unpaid_break_minutes: shift.unpaid_break().get(),
        planned_work_minutes: shift.planned_work().get(),
    }
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RosterRevisionView {
    /// `SCHEDULED`, `REST_DAY` or `PUBLIC_HOLIDAY`.
    pub plan: String,
    pub shift_id: Option<String>,
    pub actor: String,
    pub at: DateTime<Utc>,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RosterDayView {
    #[serde(flatten)]
    pub row: RosterDayRow,
    /// Every statement of what this day is, oldest first. The plan in force is
    /// the last; the earlier ones are what makes a settled month reproducible.
    pub revisions: Vec<RosterRevisionView>,
}

fn revision_views(day: &RosterDay) -> Vec<RosterRevisionView> {
    day.revisions()
        .map(|revision| RosterRevisionView {
            plan: revision.plan().code().to_owned(),
            shift_id: revision.plan().shift().map(|shift| shift.id().to_string()),
            actor: revision.authorization().actor().to_string(),
            at: revision.authorization().at(),
            reason: revision.authorization().reason().to_string(),
        })
        .collect()
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CloseReadinessView {
    pub unresolved_leave: u32,
    pub unanswered_overtime: u32,
    /// `null` means **not assessed**, not zero. There is no punch source, so
    /// there is nothing to count — and a zero would be a claim that somebody
    /// looked and found none.
    pub open_corrections: Option<u32>,
    pub unrostered_punch_days: Option<u32>,
    /// Informational. A place may legitimately have staff nobody scheduled.
    pub employees_without_roster: u32,
    pub can_close: bool,
    /// Whether anything about punches was assessed at all, so the screen can
    /// say so plainly instead of drawing a row of zeros.
    pub punches_assessed: bool,
}

fn readiness_view(readiness: CloseReadiness) -> CloseReadinessView {
    CloseReadinessView {
        unresolved_leave: readiness.unresolved_leave,
        unanswered_overtime: readiness.unanswered_overtime,
        open_corrections: readiness.open_corrections,
        unrostered_punch_days: readiness.unrostered_punch_days,
        employees_without_roster: readiness.employees_without_roster,
        can_close: readiness.can_close(),
        punches_assessed: readiness.punches_assessed(),
    }
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PeriodEventView {
    /// `CLOSED` or `REOPENED`.
    pub event: String,
    pub actor: String,
    pub at: DateTime<Utc>,
    pub reason: String,
    /// Absent on a reopen, which is not taken under an assessment.
    pub readiness: Option<CloseReadinessView>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PeriodView {
    pub place_id: String,
    /// `YYYY-MM`.
    pub period: String,
    /// `OPEN` or `CLOSED`.
    pub status: String,
    /// A frequently reopened period is a governance signal, so the count is a
    /// field rather than something to derive from the history.
    pub reopen_count: usize,
    pub history: Vec<PeriodEventView>,
    /// What stands between this period and a close, as it stands now. Absent
    /// for a period that is already closed — the question no longer applies.
    pub readiness: Option<CloseReadinessView>,
}

fn event_view(event: &PeriodEvent) -> PeriodEventView {
    PeriodEventView {
        event: event.kind().code().to_owned(),
        actor: event.authorization().actor().to_string(),
        at: event.authorization().at(),
        reason: event.authorization().reason().to_string(),
        readiness: event.readiness().map(readiness_view),
    }
}

// ── request bodies ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShiftBody {
    pub id: String,
    pub name: String,
    /// `HH:MM`.
    pub starts_at: String,
    pub ends_at: String,
    /// Whether the shift ends on the next calendar day. Stated rather than
    /// inferred from `ends_at < starts_at`: a shift from 09:00 to 09:00 is
    /// either nothing or twenty-four hours, and guessing which is worse than
    /// asking.
    #[serde(default)]
    pub crosses_midnight: bool,
    #[serde(default)]
    pub unpaid_break_minutes: u32,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanBody {
    pub on_date: NaiveDate,
    /// `SCHEDULED`, `REST_DAY` or `PUBLIC_HOLIDAY`.
    pub plan: String,
    /// Required for `SCHEDULED`, refused for the other two.
    #[serde(default)]
    pub shift_id: Option<String>,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RangeQuery {
    pub from: NaiveDate,
    pub to: NaiveDate,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlaceRangeQuery {
    pub place: String,
    pub from: NaiveDate,
    pub to: NaiveDate,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReasonBody {
    pub reason: String,
}

// ── shift patterns ───────────────────────────────────────────────────────

/// The shifts a roster may be built from.
///
/// Readable by anybody signed in: somebody whose week is built out of these is
/// entitled to know what they are. Defining them is head office's.
pub async fn list_shifts(State(state): State<AppState>) -> Result<Json<Vec<ShiftView>>, AppError> {
    let shifts = infrastructure::list_shifts(&state.db, false).await?;
    Ok(Json(shifts.iter().map(shift_view).collect()))
}

pub async fn define_shift(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<ShiftBody>,
) -> Result<Json<Vec<ShiftView>>, AppError> {
    require(&principal, actions::SHIFT_PATTERN_SET)?;
    let shift = Shift::try_new(
        ShiftId::try_new(&body.id).map_err(infrastructure::attendance_error)?,
        &body.name,
        MinuteOfDay::parse(&body.starts_at).map_err(infrastructure::attendance_error)?,
        MinuteOfDay::parse(&body.ends_at).map_err(infrastructure::attendance_error)?,
        if body.crosses_midnight {
            DayOffset::NEXT_DAY
        } else {
            DayOffset::SAME_DAY
        },
        Minutes::new(body.unpaid_break_minutes),
    )
    .map_err(infrastructure::attendance_error)?;

    infrastructure::define_shift(&state.db, &shift).await?;
    let shifts = infrastructure::list_shifts(&state.db, false).await?;
    Ok(Json(shifts.iter().map(shift_view).collect()))
}

/// Retire a shift. There is no delete: a roster day already naming it would be
/// left pointing at nothing, and the plans it produced are still the record of
/// what was planned.
pub async fn retire_shift(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
) -> Result<Json<Vec<ShiftView>>, AppError> {
    require(&principal, actions::SHIFT_PATTERN_SET)?;
    infrastructure::retire_shift(&state.db, &id).await?;
    let shifts = infrastructure::list_shifts(&state.db, false).await?;
    Ok(Json(shifts.iter().map(shift_view).collect()))
}

// ── the roster ───────────────────────────────────────────────────────────

/// The subject's place, for the reach check.
async fn subject_place(state: &AppState, access: &Access) -> Result<String, AppError> {
    let record = infrastructure::load_employee(&state.db, &access.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", access.employee_id)))?;
    let place = current_place(&record).map(ToOwned::to_owned);
    access.reaches(place.as_deref())?;
    place.ok_or_else(|| {
        AppError::Conflict(format!(
            "{} is not posted anywhere, so there is nowhere to roster them",
            access.employee_id
        ))
    })
}

/// One person's roster over a span.
///
/// Readable by the person themselves — their own week is not a privilege — and
/// by anybody who may read the workforce at their place.
pub async fn read_roster(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Query(query): Query<RangeQuery>,
) -> Result<Json<Vec<RosterDayView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    if !access.own {
        subject_place(&state, &access).await?;
    }
    let roster =
        infrastructure::roster_of(&state.db, &access.employee_id, query.from, query.to).await?;
    Ok(Json(
        roster
            .days()
            .iter()
            .map(|day| RosterDayView {
                row: infrastructure::roster_row(day),
                revisions: revision_views(day),
            })
            .collect(),
    ))
}

/// A whole place's week — the grid a manager builds.
pub async fn place_roster(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<PlaceRangeQuery>,
) -> Result<Json<Vec<RosterDayView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    let reach = reach_of(&state, &principal).await?;
    if !reach.covers(Some(&query.place)) {
        return Err(AppError::Forbidden(format!(
            "{} is not posted anywhere that reaches {}",
            principal.username, query.place
        )));
    }
    let days =
        infrastructure::roster_at_place(&state.db, &query.place, query.from, query.to).await?;
    Ok(Json(
        days.iter()
            .map(|day| RosterDayView {
                row: infrastructure::roster_row(day),
                revisions: revision_views(day),
            })
            .collect(),
    ))
}

/// Build the plan for a day, or revise it.
///
/// One route for both, because they are one act with two spellings: a day is
/// planned, and planning it again is a revision. Splitting them would make the
/// caller decide which they were doing, and the answer is a fact about the
/// database rather than about their intent.
pub async fn plan_day(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<PlanBody>,
) -> Result<Json<RosterDayView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::ROSTER_MANAGE)?;
    let place_id = subject_place(&state, &access).await?;
    let place = PlaceId::try_new(&place_id).map_err(invalid)?;

    let plan = match (body.plan.as_str(), body.shift_id.as_deref()) {
        ("SCHEDULED", Some(shift_id)) => {
            let shift = infrastructure::load_shift(&state.db, shift_id)
                .await?
                .ok_or_else(|| {
                    AppError::Validation(format!("{shift_id} is not a shift anybody may be put on"))
                })?;
            DayPlan::Scheduled { shift }
        }
        ("SCHEDULED", None) => {
            return Err(AppError::Validation(
                "a scheduled day must name the shift it is scheduled for".to_owned(),
            ));
        }
        ("REST_DAY", None) => DayPlan::RestDay,
        ("PUBLIC_HOLIDAY", None) => DayPlan::PublicHoliday,
        ("REST_DAY" | "PUBLIC_HOLIDAY", Some(_)) => {
            return Err(AppError::Validation(
                "a rest day and a public holiday are not worked, so neither names a shift"
                    .to_owned(),
            ));
        }
        (other, _) => {
            return Err(AppError::Validation(format!(
                "{other:?} is not a plan: expected SCHEDULED, REST_DAY or PUBLIC_HOLIDAY"
            )));
        }
    };

    // Loaded, never taken from the body: a caller who supplied the period would
    // be supplying the answer to "is this month still open?".
    let period = infrastructure::period_for(&state.db, &place, body.on_date).await?;
    let authorization = access.authorize(actions::ROSTER_MANAGE, &body.reason)?;

    let mut roster =
        infrastructure::roster_of(&state.db, &access.employee_id, body.on_date, body.on_date)
            .await?;
    if roster.on(body.on_date).is_some() {
        roster
            .revise(body.on_date, plan, authorization, &period)
            .map_err(infrastructure::attendance_error)?;
    } else {
        let day = RosterDay::new(
            EmployeeId::try_new(&access.employee_id).map_err(invalid)?,
            place,
            body.on_date,
            plan,
            authorization,
        )
        .map_err(infrastructure::attendance_error)?;
        roster
            .insert(day, &period)
            .map_err(infrastructure::attendance_error)?;
    }

    let day = roster.on(body.on_date).ok_or_else(|| {
        AppError::Configuration("the roster lost the day it just planned".to_owned())
    })?;
    infrastructure::save_roster_day(&state.db, day).await?;
    Ok(Json(RosterDayView {
        row: infrastructure::roster_row(day),
        revisions: revision_views(day),
    }))
}

// ── the close boundary ───────────────────────────────────────────────────

async fn period_view(
    state: &AppState,
    place: &PlaceId,
    period: &crate::cloud::domain::AttendancePeriod,
) -> Result<PeriodView, AppError> {
    // Only for an open period: what stands between a closed one and a close is
    // not a question anybody is asking.
    let readiness = if period.is_closed() {
        None
    } else {
        Some(readiness_view(
            infrastructure::close_readiness(&state.db, place, period.period()).await?,
        ))
    };
    Ok(PeriodView {
        place_id: period.place().to_string(),
        period: period.period().to_string(),
        status: period.status().code().to_owned(),
        reopen_count: period.reopen_count(),
        history: period.history().iter().map(event_view).collect(),
        readiness,
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeriodQuery {
    pub place: String,
    /// `YYYY-MM`. Absent reads every period the place has a record for.
    #[serde(default)]
    pub period: Option<String>,
}

pub async fn read_periods(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<PeriodQuery>,
) -> Result<Json<Vec<PeriodView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    let reach = reach_of(&state, &principal).await?;
    if !reach.covers(Some(&query.place)) {
        return Err(AppError::Forbidden(format!(
            "{} is not posted anywhere that reaches {}",
            principal.username, query.place
        )));
    }
    let place = PlaceId::try_new(&query.place).map_err(invalid)?;

    match query.period.as_deref() {
        Some(raw) => {
            let month = AttendanceMonth::parse(raw).map_err(infrastructure::attendance_error)?;
            let first = month.first_day().ok_or_else(|| {
                AppError::Validation(format!("{raw} is not a month with a first day"))
            })?;
            let period = infrastructure::period_for(&state.db, &place, first).await?;
            Ok(Json(vec![period_view(&state, &place, &period).await?]))
        }
        None => {
            let periods = infrastructure::periods_of(&state.db, &place).await?;
            let mut views = Vec::with_capacity(periods.len());
            for period in &periods {
                views.push(period_view(&state, &place, period).await?);
            }
            Ok(Json(views))
        }
    }
}

/// Sign the month off.
///
/// The readiness is computed here from stored facts, never taken from the body:
/// a client supplying its own zeros would close a month over anything it liked
/// while the recorded evidence claimed it was clean.
pub async fn close_period(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((raw_place, raw_period)): Path<(String, String)>,
    Json(body): Json<ReasonBody>,
) -> Result<Json<PeriodView>, AppError> {
    require(&principal, actions::ATTENDANCE_PERIOD_CLOSE)?;
    let reach = reach_of(&state, &principal).await?;
    if !reach.covers(Some(&raw_place)) {
        return Err(AppError::Forbidden(format!(
            "{} is not posted anywhere that reaches {raw_place}",
            principal.username
        )));
    }
    let place = PlaceId::try_new(&raw_place).map_err(invalid)?;
    let month = AttendanceMonth::parse(&raw_period).map_err(infrastructure::attendance_error)?;
    let first = month
        .first_day()
        .ok_or_else(|| AppError::Validation(format!("{raw_period} has no first day")))?;

    let mut period = infrastructure::period_for(&state.db, &place, first).await?;
    let readiness = infrastructure::close_readiness(&state.db, &place, month).await?;
    let authorization = Authorization::try_new(
        &principal.username,
        actions::ATTENDANCE_PERIOD_CLOSE,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;
    period
        .close(readiness, authorization)
        .map_err(infrastructure::attendance_error)?;
    infrastructure::save_period(&state.db, &period).await?;
    Ok(Json(period_view(&state, &place, &period).await?))
}

/// Undo a sign-off. Head office's.
pub async fn reopen_period(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((raw_place, raw_period)): Path<(String, String)>,
    Json(body): Json<ReasonBody>,
) -> Result<Json<PeriodView>, AppError> {
    require(&principal, actions::ATTENDANCE_PERIOD_REOPEN)?;
    let place = PlaceId::try_new(&raw_place).map_err(invalid)?;
    let month = AttendanceMonth::parse(&raw_period).map_err(infrastructure::attendance_error)?;
    let first = month
        .first_day()
        .ok_or_else(|| AppError::Validation(format!("{raw_period} has no first day")))?;

    let mut period = infrastructure::period_for(&state.db, &place, first).await?;
    let authorization = Authorization::try_new(
        &principal.username,
        actions::ATTENDANCE_PERIOD_REOPEN,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;
    period
        .reopen(authorization)
        .map_err(infrastructure::attendance_error)?;
    infrastructure::save_period(&state.db, &period).await?;
    Ok(Json(period_view(&state, &place, &period).await?))
}
