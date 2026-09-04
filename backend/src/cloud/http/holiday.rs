//! Which days are red, for a year.
//!
//! # Reading needs no key
//!
//! The same argument the attendance policy already makes: somebody planning
//! leave has to know which days are holidays before they can ask for any, and a
//! rule kept from the people it governs is a trap rather than a rule. So any
//! signed-in caller may read a calendar. Publishing one, and amending it, is
//! head office's.
//!
//! # One key for publishing and for amending
//!
//! Adding a *cuti bersama* in March is the same act with the same consequence as
//! publishing the year in January — it changes what people are owed. Splitting
//! the two keys would suggest the later change is the smaller one, and it is
//! usually the larger, because by then the year is running.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, required_role_for_action, role_allows, Authorization, CalendarChange, Holiday,
        HolidayCalendar, HolidayKind, HolidayName, HolidayScope, PlaceId,
    },
    postgres as infrastructure,
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

// ── views ────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct HolidayView {
    pub date: NaiveDate,
    pub name: String,
    /// `NATIONAL`, `CUTI_BERSAMA` or `REGIONAL`.
    pub kind: String,
    /// Sent rather than derived in the browser, so a leave form does not
    /// re-implement the rule and disagree with the kernel about what a *cuti
    /// bersama* costs.
    pub consumes_annual_leave: bool,
    /// `null` for a nationwide day. A list rather than an absence, because
    /// "everywhere" is a decision the operator stated.
    pub places: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CalendarAmendmentView {
    /// `ADDED` or `REMOVED`.
    pub change: String,
    pub holiday: HolidayView,
    pub actor: String,
    pub at: DateTime<Utc>,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CalendarView {
    pub year: i32,
    /// The set in force: what was published, with every amendment replayed.
    pub holidays: Vec<HolidayView>,
    pub amendments: Vec<CalendarAmendmentView>,
    pub published_by: String,
    pub published_at: DateTime<Utc>,
    pub published_reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CalendarYearsView {
    pub years: Vec<i32>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct HolidayOnDayView {
    pub date: NaiveDate,
    pub place_id: String,
    pub holiday: bool,
    /// Absent on an ordinary working day, which is the common answer and is not
    /// an error.
    pub detail: Option<HolidayView>,
}

fn holiday_view(holiday: &Holiday) -> HolidayView {
    HolidayView {
        date: holiday.date(),
        name: holiday.name().as_str().to_owned(),
        kind: holiday.kind().code().to_owned(),
        consumes_annual_leave: holiday.consumes_annual_leave(),
        places: holiday
            .scope()
            .named()
            .map(|places| places.iter().map(ToString::to_string).collect()),
    }
}

fn calendar_view(calendar: &HolidayCalendar) -> CalendarView {
    CalendarView {
        year: calendar.year(),
        holidays: calendar.holidays().map(holiday_view).collect(),
        amendments: calendar
            .amendments()
            .iter()
            .map(|amendment| {
                let (change, holiday) = match amendment.change() {
                    CalendarChange::Added { holiday } => ("ADDED", holiday),
                    CalendarChange::Removed { holiday } => ("REMOVED", holiday),
                };
                CalendarAmendmentView {
                    change: change.to_owned(),
                    holiday: holiday_view(holiday),
                    actor: amendment.authorization().actor().to_string(),
                    at: amendment.authorization().at(),
                    reason: amendment.authorization().reason().to_string(),
                }
            })
            .collect(),
        published_by: calendar.published().actor().to_string(),
        published_at: calendar.published().at(),
        published_reason: calendar.published().reason().to_string(),
    }
}

// ── request bodies ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HolidayBody {
    pub date: NaiveDate,
    pub name: String,
    /// `NATIONAL`, `CUTI_BERSAMA` or `REGIONAL`.
    pub kind: String,
    /// Empty for a nationwide day. Required for a regional one, and refused for
    /// the other two — the kernel says so, and the refusal names the date.
    #[serde(default)]
    pub places: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublishBody {
    pub year: i32,
    pub holidays: Vec<HolidayBody>,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AmendBody {
    /// `ADDED` or `REMOVED`.
    pub change: String,
    pub holiday: HolidayBody,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlaceQuery {
    /// Which place is asking. A regional day is a holiday in some shops and a
    /// working day in others, so there is no place-free answer to give.
    pub place: String,
}

fn invalid(error: impl std::fmt::Display) -> AppError {
    AppError::Validation(error.to_string())
}

fn build_holiday(body: HolidayBody) -> Result<Holiday, AppError> {
    let kind = HolidayKind::parse(&body.kind).ok_or_else(|| {
        AppError::Validation(format!(
            "{:?} is not a holiday kind: expected NATIONAL, CUTI_BERSAMA or REGIONAL",
            body.kind
        ))
    })?;
    let scope = if body.places.is_empty() {
        HolidayScope::Nationwide
    } else {
        HolidayScope::places(
            body.places
                .iter()
                .map(|place| PlaceId::try_new(place).map_err(invalid))
                .collect::<Result<Vec<_>, AppError>>()?,
        )
        .map_err(infrastructure::holiday_error)?
    };
    Holiday::try_new(
        body.date,
        HolidayName::try_new(&body.name).map_err(infrastructure::holiday_error)?,
        kind,
        scope,
    )
    .map_err(infrastructure::holiday_error)
}

/// The recorded authority for a calendar decision.
///
/// The actor and the instant come from the session and the server clock, never
/// from the body: a handler that accepted either would let a caller sign
/// somebody else's name to their own decision.
fn authorize(principal: &Principal, reason: &str) -> Result<Authorization, AppError> {
    if !role_allows(
        required_role_for_action(actions::HOLIDAY_SET),
        principal.role,
    ) {
        return Err(AppError::Forbidden(format!(
            "{} may not publish holidays",
            principal.username
        )));
    }
    Authorization::try_new(
        &principal.username,
        actions::HOLIDAY_SET,
        Utc::now(),
        reason,
    )
    .map_err(invalid)
}

// ── handlers ─────────────────────────────────────────────────────────────

pub async fn years(State(state): State<AppState>) -> Result<Json<CalendarYearsView>, AppError> {
    Ok(Json(CalendarYearsView {
        years: infrastructure::published_years(&state.db).await?,
    }))
}

pub async fn read_calendar(
    State(state): State<AppState>,
    Path(year): Path<i32>,
) -> Result<Json<CalendarView>, AppError> {
    let calendar = infrastructure::load_calendar(&state.db, year)
        .await?
        .ok_or_else(|| {
            // Not an empty calendar: a year nobody has entered and a year with
            // no holidays are different states, and only one of them is a
            // reason to refuse a leave request that spans it.
            AppError::NotFound(format!("no calendar has been published for {year}"))
        })?;
    Ok(Json(calendar_view(&calendar)))
}

pub async fn publish(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<PublishBody>,
) -> Result<Json<CalendarView>, AppError> {
    let authorization = authorize(&principal, &body.reason)?;
    let holidays = body
        .holidays
        .into_iter()
        .map(build_holiday)
        .collect::<Result<Vec<_>, AppError>>()?;
    let calendar = HolidayCalendar::publish(body.year, holidays, authorization)
        .map_err(infrastructure::holiday_error)?;
    infrastructure::publish_calendar(&state.db, &calendar).await?;
    Ok(Json(calendar_view(&calendar)))
}

pub async fn amend(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(year): Path<i32>,
    Json(body): Json<AmendBody>,
) -> Result<Json<CalendarView>, AppError> {
    let authorization = authorize(&principal, &body.reason)?;
    let holiday = build_holiday(body.holiday)?;
    let change = match body.change.as_str() {
        "ADDED" => CalendarChange::Added { holiday },
        "REMOVED" => CalendarChange::Removed { holiday },
        other => {
            return Err(AppError::Validation(format!(
                "{other:?} is not a change: expected ADDED or REMOVED"
            )));
        }
    };

    let mut calendar = infrastructure::load_calendar(&state.db, year)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("no calendar has been published for {year}")))?;
    // The refusal happens here, against the set the earlier amendments
    // produced — which is why the whole calendar is loaded rather than the one
    // row being amended by SQL.
    calendar
        .amend(change, authorization)
        .map_err(infrastructure::holiday_error)?;
    infrastructure::save_amendments(&state.db, &calendar).await?;
    Ok(Json(calendar_view(&calendar)))
}

pub async fn on_day(
    State(state): State<AppState>,
    Path((year, date)): Path<(i32, NaiveDate)>,
    Query(query): Query<PlaceQuery>,
) -> Result<Json<HolidayOnDayView>, AppError> {
    let place = PlaceId::try_new(&query.place).map_err(invalid)?;
    let calendar = infrastructure::load_calendar(&state.db, year)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("no calendar has been published for {year}")))?;
    let detail = calendar.on(date, &place);
    Ok(Json(HolidayOnDayView {
        date,
        place_id: place.to_string(),
        holiday: detail.is_some(),
        detail: detail.map(holiday_view),
    }))
}
