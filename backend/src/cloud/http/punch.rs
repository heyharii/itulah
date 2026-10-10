//! What a day amounted to, and the corrections that sit on top of it.
//!
//! # Nothing here is stored
//!
//! Every outcome on every screen this module serves is derived on the request:
//! the plan, the punches, the policy version in force on that date, the
//! approvals, and the effective correction. There is no `status` column to
//! read and no cache to go stale. A month re-read in June answers exactly what
//! it answered in March unless one of those five inputs changed — and if one
//! did, the answer *should* change.
//!
//! # The two silences this module refuses to fill
//!
//! **A day with no punch is not a day of absence.** It is an absence only
//! against a *scheduled* day, under a policy that covers that date. A day
//! nobody planned derives to nothing at all, and `Today` says so rather than
//! drawing a row.
//!
//! **"Not assessed" is not zero.** A unit with no registered station has no
//! punches, and every screen here says that in a sentence instead of reporting
//! a shop where nobody turned up. The close's readiness does the same thing
//! one layer down.

use super::auth::Principal;
use super::employment::{caller_and_reach, current_unit, reach_of, resolve};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, evaluate_day, required_role_for_action, role_allows, AttendanceMonth, Correction,
        CorrectionEffect, CorrectionId, DayApprovals, DayEvaluation, DayOffset, EmployeeId,
        LeaveApproval, LeaveRef, MinuteOfDay, PunchDirection, PunchTime, Reach, UnitId,
    },
    postgres::{self as infrastructure, CorrectionRow, PunchRow},
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Timelike, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

fn invalid(error: impl std::fmt::Display) -> AppError {
    AppError::Validation(error.to_string())
}

// ── the derived day ──────────────────────────────────────────────────────

/// One derived day, as a screen reads it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AttendanceDayView {
    pub employee_id: String,
    pub date: NaiveDate,
    /// `SCHEDULED`, `REST_DAY` or `PUBLIC_HOLIDAY`.
    pub plan: String,
    pub shift_id: Option<String>,
    /// The outcome codes, canonically ordered: `ON_TIME`, `LATE`,
    /// `EARLY_LEAVE`, `ABSENT`, `MISSING_PUNCH`, `APPROVED_LEAVE`,
    /// `AGREED_OVERTIME`. More than one is normal; contradictory ones are not
    /// representable.
    pub outcomes: Vec<String>,
    pub arrival: Option<String>,
    pub departure: Option<String>,
    pub late_minutes: u32,
    pub early_leave_minutes: u32,
    pub overtime_minutes_agreed: u32,
    pub overtime_minutes_unagreed: u32,
    pub attendance_span_minutes: u32,
    pub net_worked_minutes: u32,
    /// Which generation of the tolerances produced this. Sent because a month
    /// that spans a policy change is normal and a reader has to be able to tell
    /// which half came from which.
    pub policy_version: u32,
    pub punches_considered: usize,
    /// Which kinds of thing produced this day's readings — `TERMINAL`,
    /// `EMPLOYEE_APP`, or both — de-duplicated and in code order. Empty when
    /// nothing was observed.
    ///
    /// # Why a screen is told this rather than left to assume
    ///
    /// There are two punch sources since 2026-09-13, and they are not the same
    /// evidence: a reading was witnessed by a registered device, and a phone tap
    /// was witnessed by nothing. A screen that showed an arrival time without
    /// saying which produced it would be presenting a person's own claim as a
    /// measurement — which is exactly what the readers' arrival will make
    /// somebody want to audit.
    ///
    /// Sent per day rather than per punch because that is the grain the
    /// question is asked at ("where did Tuesday come from?"), and both can be
    /// true of one day: a reader that failed at lunchtime leaves a morning
    /// reading and an afternoon tap.
    pub punch_sources: Vec<String>,
    pub applied_correction: Option<String>,
}

fn day_view(
    evaluation: &DayEvaluation,
    plan: &str,
    shift_id: Option<String>,
    punch_sources: Vec<String>,
) -> AttendanceDayView {
    let measures = evaluation.measures();
    AttendanceDayView {
        employee_id: evaluation.employee().to_string(),
        date: evaluation.date(),
        plan: plan.to_owned(),
        shift_id,
        outcomes: evaluation
            .outcomes()
            .outcomes()
            .iter()
            .map(|outcome| outcome.code().to_owned())
            .collect(),
        arrival: evaluation.arrival().map(|at| at.to_string()),
        departure: evaluation.departure().map(|at| at.to_string()),
        late_minutes: measures.late_minutes.get(),
        early_leave_minutes: measures.early_leave_minutes.get(),
        overtime_minutes_agreed: measures.overtime_minutes_agreed.get(),
        overtime_minutes_unagreed: measures.overtime_minutes_unagreed.get(),
        attendance_span_minutes: measures.attendance_span.get(),
        net_worked_minutes: measures.net_worked.get(),
        policy_version: evaluation.policy_version().get(),
        punches_considered: evaluation.punches_considered(),
        punch_sources,
        applied_correction: evaluation.applied_correction().map(ToString::to_string),
    }
}

/// A day the derivation would not classify, and the reason.
///
/// Its own list rather than an outcome code, because these are not statements
/// about the person: they are statements about the *inputs*. "No policy covers
/// this date" is head office's to fix, and putting it in the outcome set would
/// make it look like something the employee did.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnderivableDay {
    pub employee_id: String,
    pub date: NaiveDate,
    pub reason: String,
}

/// A person's derived attendance over a range, plus what could not be derived.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AttendanceRangeView {
    pub employee_id: String,
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub days: Vec<AttendanceDayView>,
    /// Days whose inputs disagree with each other. Never silently dropped.
    pub underivable: Vec<UnderivableDay>,
    /// `false` when this person's unit has no registered **station**.
    ///
    /// The screen says so rather than drawing a month of absences, which is the
    /// difference between an empty screen and a lie somebody would act on.
    ///
    /// It is about readers specifically, and since 2026-09-13 that is no longer
    /// the same question as "is there any punch source": a unit with no reader
    /// can still have a fortnight of phone taps. So a screen must not read this
    /// as "nothing can be recorded here" — what it means is that every reading
    /// on this range came from somewhere other than a device, which
    /// [`AttendanceDayView::punch_sources`] says per day.
    pub punch_source_connected: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RangeQuery {
    pub from: NaiveDate,
    pub to: NaiveDate,
}

/// Derive one person's attendance across a range.
///
/// Bounded by the caller's reach, and self-reads are always allowed: somebody
/// measured against a month of arrivals is entitled to read the month.
pub async fn read_attendance(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Query(query): Query<RangeQuery>,
) -> Result<Json<AttendanceRangeView>, AppError> {
    if query.to < query.from {
        return Err(AppError::Validation(
            "the range ends before it starts".to_owned(),
        ));
    }
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    let record = infrastructure::load_employee(&state.db, &access.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", access.employee_id)))?;
    access.reaches(current_unit(&record))?;

    let unit = current_unit(&record).map(ToOwned::to_owned);
    let punch_source_connected = match &unit {
        Some(unit) => {
            infrastructure::unit_has_terminal(&state.db, &UnitId::try_new(unit).map_err(invalid)?)
                .await?
        }
        None => false,
    };

    let (days, underivable) = derive_range(&state, &record, query.from, query.to).await?;
    Ok(Json(AttendanceRangeView {
        employee_id: access.employee_id,
        from: query.from,
        to: query.to,
        days,
        underivable,
        punch_source_connected,
    }))
}

/// Derive every rostered day in a range for one person.
///
/// Reads the punches once for the whole range and the roster once, rather than
/// per day: a month is two queries plus one policy load, not ninety.
async fn derive_range(
    state: &AppState,
    record: &infrastructure::EmployeeRecord,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<(Vec<AttendanceDayView>, Vec<UnderivableDay>), AppError> {
    let employee_id = record.employee.id().as_str();
    let roster = infrastructure::roster_of(&state.db, employee_id, from, to).await?;
    let punches = infrastructure::punches_between(&state.db, record, from, to).await?;
    let leave_catalogue = infrastructure::load_catalogue(&state.db).await?;
    let approved_leave = infrastructure::approved_requests_overlapping(
        &state.db,
        employee_id,
        from,
        to,
        &leave_catalogue,
    )
    .await?;
    // No schedule is not an empty schedule: a date no version covers has no
    // policy, and every day in the range says so individually rather than the
    // request failing as a whole. A month whose first half is covered is still
    // worth reading.
    let schedule = infrastructure::load_attendance_policy(&state.db).await?;

    let mut days = Vec::new();
    let mut underivable = Vec::new();
    for day in roster.days() {
        let Some(schedule) = schedule.as_ref() else {
            underivable.push(UnderivableDay {
                employee_id: employee_id.to_owned(),
                date: day.date(),
                reason: "no attendance policy has been written, so nothing can be \
                         measured against a tolerance"
                    .to_owned(),
            });
            continue;
        };
        let policy = match schedule.effective_on(day.date()) {
            Ok(policy) => policy,
            Err(error) => {
                underivable.push(UnderivableDay {
                    employee_id: employee_id.to_owned(),
                    date: day.date(),
                    reason: error.to_string(),
                });
                continue;
            }
        };
        let chain = infrastructure::load_correction_chain(
            &state.db,
            record.employee.id(),
            day.unit(),
            day.date(),
        )
        .await?;
        let on_day: Vec<_> = punches
            .iter()
            .filter(|punch| punch.business_date() == day.date())
            .collect();
        // Read off the punches themselves rather than off the unit's device
        // list: "this shop has a reader" and "this reading came from it" are
        // different facts, and a day assembled from the first would say a
        // finger was seen on a day nobody's was.
        let mut sources: Vec<String> = on_day
            .iter()
            .map(|punch| punch.source().code().to_owned())
            .collect();
        sources.sort();
        sources.dedup();
        // The leave request is employee- and date-scoped, and its decision was
        // decoded through the leave domain before it reaches this derivation.
        // Overtime remains separate because it needs its own agreement join.
        let approvals = leave_approvals_for_day(&approved_leave, day.unit().as_str(), day.date())?;
        match evaluate_day(day, &on_day, policy, &approvals, chain.effective()) {
            Ok(Some(evaluation)) => days.push(day_view(
                &evaluation,
                day.plan().code(),
                day.plan().shift().map(|shift| shift.id().to_string()),
                sources,
            )),
            // A rest day nobody worked. Nothing to say, and an eighth outcome
            // to say it would weaken the seven.
            Ok(None) => {}
            Err(error) => underivable.push(UnderivableDay {
                employee_id: employee_id.to_owned(),
                date: day.date(),
                reason: error.to_string(),
            }),
        }
    }
    Ok((days, underivable))
}

fn leave_approvals_for_day(
    requests: &[infrastructure::LeaveRequestRecord],
    unit_id: &str,
    date: NaiveDate,
) -> Result<DayApprovals, AppError> {
    let Some(request) = requests.iter().find(|record| {
        record.request.state().code() == "APPROVED"
            && record.request.unit().as_str() == unit_id
            && record.request.period().covers(date)
    }) else {
        return Ok(DayApprovals::none());
    };
    let authorization = request.request.state().decision().ok_or_else(|| {
        AppError::Configuration(format!(
            "approved leave {} has no decision",
            request.request.id()
        ))
    })?;
    let leave = LeaveRef::try_new(&request.request.id().to_string()).map_err(invalid)?;
    Ok(DayApprovals::with_leave(LeaveApproval::new(
        leave,
        authorization.clone(),
    )))
}

/// The **Today** screen: who is scheduled, who is in, who is late, who has not
/// arrived.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TodayView {
    pub unit_id: String,
    pub date: NaiveDate,
    /// Everybody with a plan for the day, derived.
    pub days: Vec<AttendanceDayView>,
    /// Days whose inputs disagree. Shown, never dropped.
    pub underivable: Vec<UnderivableDay>,
    /// The raw observations, for the column that answers "what did the device
    /// actually see?" — which is a different question from "was he late".
    pub punches: Vec<PunchRow>,
    /// `false` when this unit has no registered station, in which case the
    /// screen says so instead of reporting that nobody came to work.
    pub punch_source_connected: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TodayQuery {
    pub unit: String,
    #[serde(default)]
    pub date: Option<NaiveDate>,
}

/// One unit's day.
pub async fn read_today(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<TodayQuery>,
) -> Result<Json<TodayView>, AppError> {
    let reach = reach_of(&state, &principal).await?;
    if !reach.covers(Some(&query.unit)) {
        return Err(AppError::Forbidden(format!(
            "{} is not posted anywhere that reaches {}",
            principal.username, query.unit
        )));
    }
    let unit = UnitId::try_new(&query.unit).map_err(invalid)?;
    let date = query.date.unwrap_or_else(crate::reporting::local_today);

    let mut days = Vec::new();
    let mut underivable = Vec::new();
    for employee_id in infrastructure::rostered_at_unit_on(&state.db, &unit, date).await? {
        let Some(record) = infrastructure::load_employee(&state.db, &employee_id).await? else {
            continue;
        };
        let (mut derived, mut refused) = derive_range(&state, &record, date, date).await?;
        days.append(&mut derived);
        underivable.append(&mut refused);
    }

    Ok(Json(TodayView {
        unit_id: query.unit,
        date,
        days,
        underivable,
        punches: infrastructure::punches_at_unit_on(&state.db, &unit, date).await?,
        punch_source_connected: infrastructure::unit_has_terminal(&state.db, &unit).await?,
    }))
}

// ── the second punch source ──────────────────────────────────────────────

/// What the employee app sends to record its own arrival or departure.
///
/// # One field, and everything else the server establishes
///
/// No instant, no business date, no place, no terminal, no punch id. Each of
/// those is either something the server knows better or something a client
/// could choose wrongly on purpose:
///
/// * **the instant** is stamped here. A client-supplied one is a client that
///   can choose when it arrived, which is why `IncomingPunch::recorded_at`
///   already carries the note that no rule reads it. There is no field to lie
///   in;
/// * **the business date** is resolved from the caller's own roster, because
///   only the plan knows that last night's shift runs to 06:00 — see
///   `DatedRoster::business_position`;
/// * **the place** is the caller's open posting. A caller who could name their
///   own place could file a day's work at a shop they have never worked in;
/// * **the id** is derived from the punch's content, which is what makes a
///   double tap land once — see `SelfPunchClaim::punch_id`.
///
/// # There is no `reason`, and that is a decision rather than an omission
///
/// Every write in this module that changes somebody's record carries a
/// non-blank reason, because each of them is a *decision about a record*: a
/// correction says a reading was wrong, a decision says a request is refused,
/// and a reason is what the next reader needs. Arriving at work is not a
/// decision about anything — the act is its whole content, and there is nothing
/// for a person to justify.
///
/// Asking anyway would make it worse, in two ways. A required reason on the one
/// button somebody presses twice a day is a field that fills up with "." and
/// "masuk", which teaches everybody that the reason field is a formality to be
/// got past — including on the routes where it is not. And a *terminal* punch
/// carries no reason at all, because `Punch::record` takes none; demanding one
/// from the person while the device is exempt would be exactly backwards.
///
/// The authority is still recorded in full — actor, key, instant — because
/// `SelfPunchClaim` needs an [`crate::cloud::domain::Authorization`] and that
/// type cannot be built without a reason. So the handler writes the sentence
/// itself, naming the act rather than excusing it, and it is not persisted with
/// the row: `0239` adds a source column and no actor column, because on this
/// route the actor is the person the row is already about.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnPunchBody {
    /// `IN` or `OUT`.
    pub direction: String,
    /// Where the phone was, when it could say (0807). Required when the
    /// company requires a location; checked against the unit's fence when it
    /// requires one.
    #[serde(default)]
    pub latitude: Option<f64>,
    #[serde(default)]
    pub longitude: Option<f64>,
}

/// What was recorded, in the words the person who tapped needs.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PunchRecorded {
    pub punch_id: String,
    pub employee_id: String,
    pub unit_id: String,
    /// Always `EMPLOYEE_APP` on this route, and sent anyway: the screen that
    /// renders the confirmation is the screen that must not imply a reader saw
    /// this, and a value it reads is harder to get wrong than a value it
    /// assumes.
    pub source: String,
    pub direction: String,
    /// The roster day this punch answers — yesterday's date, for a clock-out
    /// after midnight on an overnight shift.
    pub business_date: NaiveDate,
    /// Place-local `HH:MM`, with `+1` when the reading falls after midnight on
    /// the same shift.
    pub at: String,
    /// The server's own clock, which is the only clock in this exchange.
    pub recorded_at: DateTime<Utc>,
    /// `false` when this punch was already recorded — a double tap, a retry on
    /// a dropped connection, or a thumb resting on the button. **Not an
    /// error**: the identity collided, exactly as a node's redelivery does, and
    /// the day holds one punch either way.
    pub newly_recorded: bool,
}

/// Record your own arrival or departure, from the employee app.
///
/// # Why this route exists beside a decision that said it should not
///
/// The owner chose a fingerprint station per unit with no PIN and no card, and
/// reaffirmed it twice. Nothing has been bought, so today nobody can clock in
/// anywhere and the whole HR month — roster, derivation, corrections, close,
/// payroll — has no input to be exercised against. He asked for attendance in
/// the employee app so the flow can be walked end to end before the readers
/// arrive.
///
/// This is therefore a **second punch source**, which that decision did not
/// contemplate, and the whole design of it is aimed at keeping the two
/// distinguishable for ever: its own action key, its own capability type
/// (`SelfPunchClaim`, a claim and not an attestation), and `source` on every row
/// it writes. When the readers arrive, nobody has to guess which readings came
/// from a finger; and retiring this source later means refusing this key, with
/// no history to unpick.
///
/// # Why it is a route of its own and not a widening of `/attendance/punches`
///
/// That route is authenticated by a **node's** `x-sync-key` rather than by a
/// session, and its comment says nothing a browser holds opens it. That is the
/// enforcement of the owner's privacy decision — the same gate is what keeps
/// fingerprint templates out of every session in the system — so it is not
/// widened here. A second source gets a second door.
///
/// # Bounded to the caller's own record
///
/// `Access::own` decides, the way `file_correction` chooses between the own and
/// the on-behalf-of correction keys. There is deliberately **no on-behalf-of
/// punch**: a manager who knows somebody was at work states it as an attendance
/// *correction*, which is a request somebody else decides, and that asymmetry is
/// the point. A supervisor's grant over a shop must not become a way to clock
/// its staff in.
///
/// # One thing left open, on purpose
///
/// Nothing here refuses a phone punch at a unit that has a working station. It
/// would be a reasonable rule — the app is a stopgap — but the owner has not
/// been asked, a reader can be broken without being suspended, and a rule
/// invented here would be a policy nobody chose. What the estate has instead is
/// the honest record: every row says which source produced it, so the question
/// can be answered with a query rather than a guess.
pub async fn record_own_punch(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<OwnPunchBody>,
) -> Result<Json<PunchRecorded>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    if !access.own {
        // Named rather than left to the rung. Every signed-in caller holds the
        // self-service key, so the rung alone would let a cashier punch for a
        // colleague; and the refusal has to say what the caller should do
        // instead, because wanting to record somebody else's day is a real and
        // legitimate wish.
        return Err(AppError::Forbidden(format!(
            "{} may only record their own punch. Somebody else's day is changed \
             by an attendance correction, under `{}`, which another person then \
             decides — never by a punch.",
            principal.username,
            actions::CORRECTION_REQUEST
        )));
    }
    access.may(actions::ATTENDANCE_PUNCH_RECORD_OWN)?;
    let direction = PunchDirection::parse(&body.direction).map_err(invalid)?;

    let record = infrastructure::load_employee(&state.db, &access.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", access.employee_id)))?;
    let unit = current_unit(&record).ok_or_else(|| {
        // Not a 404 and not a silent success. Somebody with no open posting has
        // no unit whose day this would be, and the fix is HR's paperwork rather
        // than a retry.
        AppError::Conflict(format!(
            "{} is not posted anywhere, so there is no unit whose day this punch \
             would belong to",
            access.employee_id
        ))
    })?;
    let unit = UnitId::try_new(unit).map_err(invalid)?;

    // The company's rules for a phone punch (0807): allowed at all, with a
    // location, inside the unit's fence. Checked before anything is written.
    let setting = infrastructure::mobile_setting(&state.db).await?;
    if !setting.mobile_enabled {
        return Err(AppError::Forbidden(
            "punching from the employee app is turned off; punch at the station".to_owned(),
        ));
    }
    let location = match (body.latitude, body.longitude) {
        (Some(latitude), Some(longitude)) => Some((latitude, longitude)),
        (None, None) => None,
        _ => return Err(invalid("a location is a latitude and a longitude together")),
    };
    if setting.require_location && location.is_none() {
        return Err(AppError::Validation(
            "your location is needed to punch from the app; allow it and try again".to_owned(),
        ));
    }
    let fence = infrastructure::geofence_of(&state.db, unit.as_str()).await?;
    let distance = match (location, &fence) {
        (Some(at), Some(fence)) => Some(infrastructure::distance_m(
            at,
            (fence.latitude, fence.longitude),
        )),
        _ => None,
    };
    if setting.require_geofence {
        if let (Some(distance), Some(fence)) = (distance, &fence) {
            if distance > f64::from(fence.radius_m) {
                return Err(AppError::Forbidden(format!(
                    "you are {} m from {}, outside its {} m radius; punch from inside it",
                    distance.round(),
                    unit,
                    fence.radius_m
                )));
            }
        }
    }

    // The server's clock, converted to the unit's own day: the zone of the
    // site the unit keeps its day at (`unit_business_timezone`), read through
    // the same SQL function the sales reports cut their days with, because a
    // shop's business day turning over at a different hour here than there is
    // the kind of disagreement nothing catches.
    let now = Utc::now();
    let offset =
        infrastructure::sites::unit_utc_offset_minutes(&state.db, unit.as_str(), now).await?;
    let local = now + chrono::Duration::minutes(i64::from(offset));
    let local_minute = MinuteOfDay::try_new(
        u16::try_from(local.time().num_seconds_from_midnight() / 60).unwrap_or(u16::MAX),
    )
    .map_err(invalid)?;
    // Yesterday as well as today, because that is the window
    // `business_position` needs: only last night's plan can say whether a
    // reading at 02:00 belongs to the shift that is still running.
    let roster = infrastructure::roster_of(
        &state.db,
        record.employee.id().as_str(),
        local.date_naive() - chrono::Duration::days(1),
        local.date_naive(),
    )
    .await?;
    let at = roster.business_position(local.date_naive(), local_minute);

    let authorization = access.authorize(
        actions::ATTENDANCE_PUNCH_RECORD_OWN,
        // Written here rather than asked of the caller — see `OwnPunchBody`.
        &format!("clocked {} in the employee app", direction.code()),
    )?;
    let claim = crate::cloud::domain::SelfPunchClaim::make(
        record.employee.id().clone(),
        unit.clone(),
        authorization,
    )
    .map_err(infrastructure::attendance_error)?;
    let period = infrastructure::period_for(&state.db, &unit, at.business_date()).await?;
    let punch = crate::cloud::domain::Punch::claim_own(
        &claim,
        direction,
        at,
        now,
        crate::cloud::domain::PunchContext {
            employee: &record.employee,
            assignment: &record.assignments,
            period: &period,
        },
    )
    .map_err(infrastructure::attendance_error)?;

    let newly_recorded = infrastructure::insert_punch(&state.db, &punch).await?;
    if let (true, Some((latitude, longitude))) = (newly_recorded, location) {
        infrastructure::locate_punch(
            &state.db,
            &punch.id().to_string(),
            latitude,
            longitude,
            distance.map(|d| d.round() as i32),
        )
        .await?;
    }
    Ok(Json(PunchRecorded {
        punch_id: punch.id().to_string(),
        employee_id: punch.employee().to_string(),
        unit_id: punch.unit().to_string(),
        source: punch.source().code().to_owned(),
        direction: punch.direction().code().to_owned(),
        business_date: punch.business_date(),
        at: punch.at().to_string(),
        recorded_at: punch.recorded_at(),
        newly_recorded,
    }))
}

// ── corrections ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CorrectionQueueQuery {
    #[serde(default)]
    pub unit: Option<String>,
    /// Default `true`: the queue is what is waiting, and a manager with five
    /// minutes wants the list of things waiting on them rather than the
    /// history.
    #[serde(default = "yes")]
    pub pending: bool,
}

const fn yes() -> bool {
    true
}

/// The corrections waiting on this caller, or a place's whole history.
///
/// A place's queue is the deciders'. Anybody below that rung is served their
/// own filings and nothing else: the rows carry a colleague's name and their
/// reason in their own words, and being posted to the same shop is not a
/// reason to read them. The phone asks this route for "my pending fixes", and
/// narrowing in the browser would have been narrowing after the leak.
pub async fn list_corrections(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<CorrectionQueueQuery>,
) -> Result<Json<Vec<CorrectionRow>>, AppError> {
    let (own_record, reach) = caller_and_reach(&state, &principal).await?;
    if !role_allows(
        required_role_for_action(actions::CORRECTION_DECIDE),
        principal.role,
    ) {
        let Some(mine) = own_record else {
            return Ok(Json(Vec::new()));
        };
        return Ok(Json(
            infrastructure::corrections_of_employee(&state.db, &mine, query.pending).await?,
        ));
    }
    if reach.is_nowhere() {
        return Err(AppError::Forbidden(format!(
            "{} is not posted anywhere, so no queue is theirs",
            principal.username
        )));
    }
    let units = match (&query.unit, &reach) {
        (Some(asked), _) if !reach.covers(Some(asked)) => {
            return Err(AppError::Forbidden(format!(
                "{} is not posted anywhere that reaches {asked}",
                principal.username
            )));
        }
        (Some(asked), _) => vec![asked.clone()],
        (None, Reach::Only(mine)) => vec![mine.as_str().to_owned()],
        // Everywhere: an empty slice means no filter, which is what a
        // head-office caller wants and what `Reach::Nowhere` must never reach —
        // refused above.
        (None, _) => Vec::new(),
    };
    Ok(Json(
        infrastructure::corrections_at_units(&state.db, &units, query.pending).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileCorrectionBody {
    pub business_date: NaiveDate,
    /// `ARRIVAL`, `DEPARTURE`, `ARRIVAL_AND_DEPARTURE` or `APPROVED_LEAVE`.
    pub effect: String,
    /// `HH:MM`, place-local, for the corrected arrival.
    #[serde(default)]
    pub arrival: Option<String>,
    #[serde(default)]
    pub departure: Option<String>,
    /// `1` when the corrected reading falls after midnight on the same shift.
    #[serde(default)]
    pub arrival_day_offset: u8,
    #[serde(default)]
    pub departure_day_offset: u8,
    /// The approved leave record, for an `APPROVED_LEAVE` effect.
    #[serde(default)]
    pub leave_id: Option<String>,
    /// The approved correction this one replaces. Omitted when it is the first
    /// for the day; **required** when one is already in force, and refused if
    /// it names the wrong one, so two people correcting one day cannot clobber
    /// each other silently.
    #[serde(default)]
    pub supersedes: Option<String>,
    pub reason: String,
}

fn punch_time(date: NaiveDate, clock: &str, offset: u8) -> Result<PunchTime, AppError> {
    Ok(PunchTime::new(
        date,
        DayOffset::try_new(offset).map_err(invalid)?,
        MinuteOfDay::parse(clock).map_err(invalid)?,
    ))
}

fn effect_of(body: &FileCorrectionBody) -> Result<CorrectionEffect, AppError> {
    let date = body.business_date;
    match body.effect.as_str() {
        "ARRIVAL" => {
            let at = body.arrival.as_deref().ok_or_else(|| {
                AppError::Validation("an ARRIVAL correction needs an arrival time".to_owned())
            })?;
            Ok(CorrectionEffect::Arrival {
                at: punch_time(date, at, body.arrival_day_offset)?,
            })
        }
        "DEPARTURE" => {
            let at = body.departure.as_deref().ok_or_else(|| {
                AppError::Validation("a DEPARTURE correction needs a departure time".to_owned())
            })?;
            Ok(CorrectionEffect::Departure {
                at: punch_time(date, at, body.departure_day_offset)?,
            })
        }
        "ARRIVAL_AND_DEPARTURE" => {
            let arrival = body.arrival.as_deref().ok_or_else(|| {
                AppError::Validation("this correction needs both times".to_owned())
            })?;
            let departure = body.departure.as_deref().ok_or_else(|| {
                AppError::Validation("this correction needs both times".to_owned())
            })?;
            Ok(CorrectionEffect::ArrivalAndDeparture {
                arrival: punch_time(date, arrival, body.arrival_day_offset)?,
                departure: punch_time(date, departure, body.departure_day_offset)?,
            })
        }
        "APPROVED_LEAVE" => {
            let leave = body.leave_id.as_deref().ok_or_else(|| {
                AppError::Validation(
                    "an APPROVED_LEAVE correction must name the leave record".to_owned(),
                )
            })?;
            Ok(CorrectionEffect::ApprovedLeave {
                leave: crate::cloud::domain::LeaveRef::try_new(leave).map_err(invalid)?,
            })
        }
        other => Err(AppError::Validation(format!(
            "`{other}` is not a correction effect; a correction states times or an \
             approved leave, and deliberately cannot state an outcome"
        ))),
    }
}

/// File a correction against a day.
///
/// Two keys, and which one applies is decided by whose day it is:
/// `people.correction.request_own` for your own (the cashier rung, bounded by
/// the record) and `people.correction.request` for somebody else's (the
/// supervisor rung, bounded by reach). Reading it as one key would let every
/// cashier file against a colleague.
pub async fn file_correction(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<FileCorrectionBody>,
) -> Result<Json<Vec<CorrectionRow>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    let action_key = if access.own {
        actions::CORRECTION_REQUEST_OWN
    } else {
        actions::CORRECTION_REQUEST
    };
    access.may(action_key)?;

    let record = infrastructure::load_employee(&state.db, &access.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", access.employee_id)))?;
    let unit = current_unit(&record).ok_or_else(|| {
        AppError::Conflict(format!(
            "{} is not posted anywhere, so there is no unit whose day this would correct",
            access.employee_id
        ))
    })?;
    access.reaches(Some(unit))?;
    let unit = UnitId::try_new(unit).map_err(invalid)?;

    let effect = effect_of(&body)?;
    let authorization = access.authorize(action_key, &body.reason)?;
    let correction = Correction::request(
        // Minted here, not by the caller: a correction is not something a
        // device observes, so there is no offline path that has to invent one,
        // and a caller-supplied id is a caller-supplied collision.
        CorrectionId::try_new(&Uuid::new_v4().to_string()).map_err(invalid)?,
        record.employee.id().clone(),
        unit.clone(),
        body.business_date,
        effect,
        body.supersedes
            .as_deref()
            .map(CorrectionId::try_new)
            .transpose()
            .map_err(invalid)?,
        authorization,
    )
    .map_err(infrastructure::attendance_error)?;

    let period = infrastructure::period_for(&state.db, &unit, body.business_date).await?;
    let mut chain = infrastructure::load_correction_chain(
        &state.db,
        record.employee.id(),
        &unit,
        body.business_date,
    )
    .await?;
    chain
        .submit(correction, &period)
        .map_err(infrastructure::attendance_error)?;
    infrastructure::save_correction_chain(&state.db, &chain).await?;
    day_chain_rows(&state, &record, &unit, body.business_date).await
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DecisionBody {
    /// `true` to approve, `false` to refuse. A refusal is kept: a day whose
    /// correction was refused is a day somebody looked at.
    pub approve: bool,
    pub reason: String,
}

/// The day a correction is about, so a decision route can find its chain
/// without the caller restating it.
#[derive(Debug)]
struct CorrectionTarget {
    employee: EmployeeId,
    unit: UnitId,
    date: NaiveDate,
}

async fn target_of(state: &AppState, id: &str) -> Result<CorrectionTarget, AppError> {
    let (employee, unit, date) = infrastructure::correction_target(&state.db, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("correction {id}")))?;
    Ok(CorrectionTarget {
        employee: EmployeeId::try_new(&employee).map_err(invalid)?,
        unit: UnitId::try_new(&unit).map_err(invalid)?,
        date,
    })
}

/// Approve or refuse a correction.
///
/// Bounded three ways: the rung (`people.correction.decide` is supervisor's),
/// the reach (this caller's own unit), and the **actor** — the requester and the
/// decider must differ, which the kernel enforces on the transition and again
/// on the way in from storage.
pub async fn decide_correction(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<DecisionBody>,
) -> Result<Json<Vec<CorrectionRow>>, AppError> {
    let target = target_of(&state, &id).await?;
    let reach = reach_of(&state, &principal).await?;
    if !reach.covers(Some(target.unit.as_str())) {
        return Err(AppError::Forbidden(format!(
            "{} is not posted anywhere that reaches {}",
            principal.username, target.unit
        )));
    }
    if !crate::cloud::domain::role_allows(
        crate::cloud::domain::required_role_for_action(actions::CORRECTION_DECIDE),
        principal.role,
    ) {
        return Err(AppError::Forbidden(format!(
            "{} may not {}",
            principal.username,
            actions::CORRECTION_DECIDE
        )));
    }
    let decision = crate::cloud::domain::Authorization::try_new(
        &principal.username,
        actions::CORRECTION_DECIDE,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;

    let period = infrastructure::period_for(&state.db, &target.unit, target.date).await?;
    let mut chain = infrastructure::load_correction_chain(
        &state.db,
        &target.employee,
        &target.unit,
        target.date,
    )
    .await?;
    let outcome = if body.approve {
        chain.approve(decision, &period)
    } else {
        chain.reject(decision, &period)
    };
    outcome.map_err(infrastructure::attendance_error)?;
    infrastructure::save_correction_chain(&state.db, &chain).await?;

    let record = infrastructure::load_employee(&state.db, target.employee.as_str())
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", target.employee)))?;
    day_chain_rows(&state, &record, &target.unit, target.date).await
}

/// Withdraw your own pending correction.
///
/// Only the requester may. Anybody else who wants it gone rejects it under
/// their own name — a third party "withdrawing" it would dispose of the request
/// while making the record say the requester changed their mind.
pub async fn withdraw_correction(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<DecisionBody>,
) -> Result<Json<Vec<CorrectionRow>>, AppError> {
    let target = target_of(&state, &id).await?;
    // No rung and no reach check, deliberately. The bound here is the *actor*,
    // which the kernel applies: withdrawal is refused unless the caller is the
    // one who filed it, and somebody withdrawing their own statement needs no
    // grant over the place it was about.
    let decision = crate::cloud::domain::Authorization::try_new(
        &principal.username,
        actions::CORRECTION_REQUEST_OWN,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;
    let mut chain = infrastructure::load_correction_chain(
        &state.db,
        &target.employee,
        &target.unit,
        target.date,
    )
    .await?;
    chain
        .withdraw(decision)
        .map_err(infrastructure::attendance_error)?;
    infrastructure::save_correction_chain(&state.db, &chain).await?;

    let record = infrastructure::load_employee(&state.db, target.employee.as_str())
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", target.employee)))?;
    day_chain_rows(&state, &record, &target.unit, target.date).await
}

/// The whole chain for one day, which is what every write above answers with:
/// a screen that just filed a correction needs to see where it sits in the
/// lineage, not only that the write succeeded.
async fn day_chain_rows(
    state: &AppState,
    record: &infrastructure::EmployeeRecord,
    unit: &UnitId,
    date: NaiveDate,
) -> Result<Json<Vec<CorrectionRow>>, AppError> {
    let display_name = record.profile.as_ref().map_or_else(
        || record.employee.code().to_string(),
        |profile| profile.name().as_str().to_owned(),
    );
    Ok(Json(
        infrastructure::correction_rows_for_day(
            &state.db,
            record.employee.id(),
            unit,
            date,
            &record.employee.code().to_string(),
            &display_name,
        )
        .await?,
    ))
}

/// One month's readiness, recomputed — what a Period close screen reads before
/// anybody signs anything.
///
/// Its own route rather than a field on the close, because a manager wants to
/// see what is outstanding *before* deciding, and the close itself recomputes
/// the readiness rather than trusting whatever the screen was shown.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PunchReadinessView {
    pub unit_id: String,
    pub period: String,
    /// `null` means **not assessed**: this unit has no registered station, so
    /// there was nothing to count. Not zero.
    pub open_corrections: Option<u32>,
    pub unrostered_punch_days: Option<u32>,
    pub punch_source_connected: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeriodQuery {
    pub unit: String,
    /// `YYYY-MM`.
    pub period: String,
}

/// The two punch-derived counts for one `(place, month)`.
pub async fn read_punch_readiness(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<PeriodQuery>,
) -> Result<Json<PunchReadinessView>, AppError> {
    let reach = reach_of(&state, &principal).await?;
    if !reach.covers(Some(&query.unit)) {
        return Err(AppError::Forbidden(format!(
            "{} is not posted anywhere that reaches {}",
            principal.username, query.unit
        )));
    }
    let unit = UnitId::try_new(&query.unit).map_err(invalid)?;
    let month = AttendanceMonth::parse(&query.period).map_err(invalid)?;
    let connected = infrastructure::unit_has_terminal(&state.db, &unit).await?;
    let (open_corrections, unrostered_punch_days) = if connected {
        (
            Some(infrastructure::open_corrections_in(&state.db, &unit, month).await?),
            Some(infrastructure::unrostered_punch_days_in(&state.db, &unit, month).await?),
        )
    } else {
        (None, None)
    };
    Ok(Json(PunchReadinessView {
        unit_id: query.unit,
        period: month.to_string(),
        open_corrections,
        unrostered_punch_days,
        punch_source_connected: connected,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::domain::{
        actions, AttendancePolicy, DayPlan, LeaveBacking, LeavePayment, LeavePeriod, LeaveRequest,
        LeaveRequestId, LeaveRequestState, LeaveRequestWire, LeaveType, LeaveTypeCode, Minutes,
        PolicyId, PolicyLimits, PolicyVersion, RosterDay, Shift, ShiftId,
    };
    use chrono::TimeZone;

    const DATE: &str = "2026-09-14";

    fn approved_leave() -> infrastructure::LeaveRequestRecord {
        let date = DATE.parse::<NaiveDate>().expect("date");
        let leave_type = LeaveType::try_new(
            LeaveTypeCode::try_new("SICK").expect("leave type code"),
            "Sick leave",
            LeaveBacking::AsCertified,
            LeavePayment::StatutoryScale,
            true,
        )
        .expect("leave type");
        let authorization = |actor: &str, action: &str| {
            crate::cloud::domain::Authorization::try_new(
                actor,
                action,
                Utc.with_ymd_and_hms(2026, 9, 1, 8, 0, 0)
                    .single()
                    .expect("timestamp"),
                "approved for the test",
            )
            .expect("authorization")
        };
        let request = LeaveRequest::try_new(
            LeaveRequestWire {
                id: LeaveRequestId::try_new("LV-001").expect("request id"),
                employee: EmployeeId::try_new("emp-1").expect("employee id"),
                unit: UnitId::try_new("store-07").expect("unit id"),
                leave_type: LeaveTypeCode::try_new("SICK").expect("leave type code"),
                period: LeavePeriod::try_new(date, date).expect("period"),
                chargeable: vec![date],
                evidence: Some("medical note".to_owned()),
                requested: authorization("emp-1", actions::LEAVE_REQUEST),
                state: LeaveRequestState::Approved {
                    decision: authorization("manager", actions::LEAVE_DECIDE),
                    ledger_entry: None,
                },
            },
            &leave_type,
        )
        .expect("approved request");
        infrastructure::LeaveRequestRecord {
            request,
            created_at: Utc
                .with_ymd_and_hms(2026, 9, 1, 8, 0, 0)
                .single()
                .expect("timestamp"),
            updated_at: Utc
                .with_ymd_and_hms(2026, 9, 1, 8, 0, 0)
                .single()
                .expect("timestamp"),
        }
    }

    fn scheduled_day() -> (RosterDay, AttendancePolicy) {
        let date = DATE.parse::<NaiveDate>().expect("date");
        let authorization = crate::cloud::domain::Authorization::try_new(
            "manager",
            actions::ROSTER_MANAGE,
            Utc.with_ymd_and_hms(2026, 9, 1, 8, 0, 0)
                .single()
                .expect("timestamp"),
            "rostered for the test",
        )
        .expect("authorization");
        let shift = Shift::try_new(
            ShiftId::try_new("morning").expect("shift id"),
            "Morning",
            MinuteOfDay::try_new(8 * 60).expect("start"),
            MinuteOfDay::try_new(16 * 60).expect("end"),
            DayOffset::SAME_DAY,
            Minutes::new(60),
        );
        let shift = shift.expect("shift");
        let day = RosterDay::new(
            EmployeeId::try_new("emp-1").expect("employee id"),
            UnitId::try_new("store-07").expect("unit id"),
            date,
            DayPlan::Scheduled { shift },
            authorization,
        )
        .expect("roster day");
        let policy = AttendancePolicy::try_new(
            PolicyId::try_new("standard").expect("policy id"),
            PolicyVersion::try_new(1).expect("policy version"),
            "2026-01-01".parse().expect("effective date"),
            None,
            PolicyLimits {
                late_grace: Minutes::new(10),
                early_leave_grace: Minutes::new(10),
                overtime_minimum: Minutes::new(30),
                duplicate_punch_window: Minutes::new(2),
            },
        )
        .expect("attendance policy");
        (day, policy)
    }

    #[test]
    fn approved_leave_join_turns_an_absent_day_into_approved_leave() {
        let request = approved_leave();
        let requests = [request];
        let (day, policy) = scheduled_day();
        let without_leave = evaluate_day(&day, &[], &policy, &DayApprovals::none(), None)
            .expect("unapproved day")
            .expect("scheduled day");
        assert_eq!(without_leave.outcomes().outcomes()[0].code(), "ABSENT");

        let approval =
            leave_approvals_for_day(&requests, "store-07", day.date()).expect("approval join");
        let with_leave = evaluate_day(&day, &[], &policy, &approval, None)
            .expect("approved day")
            .expect("scheduled day");
        assert_eq!(with_leave.outcomes().outcomes()[0].code(), "APPROVED_LEAVE");

        assert!(leave_approvals_for_day(&requests, "store-08", day.date())
            .expect("unit mismatch")
            .leave()
            .is_none());
        assert!(leave_approvals_for_day(
            &requests,
            "store-07",
            day.date() + chrono::Duration::days(1)
        )
        .expect("date mismatch")
        .leave()
        .is_none());
    }
}
