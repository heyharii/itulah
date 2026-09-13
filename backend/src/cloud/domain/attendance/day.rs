//! The derived attendance day: what the punches, the plan and the policy add
//! up to.
//!
//! # An outcome is a function, never a stored fact
//!
//! The implementation the reference replaced wrote a `status` string onto the
//! attendance row at punch time (`"present"`), rewrote it from a nightly sweep,
//! and rewrote it again when a correction was approved. The string and the
//! facts drifted apart and nothing could say which was right.
//!
//! Here an outcome is a **function** of `(roster day, punches, effective policy
//! version, approvals, effective correction)`. Given the same inputs it is the
//! same value on any machine, and there is no column it could be stored in —
//! migration `0234` has none. A later wave may cache it; the cache will not be
//! the authority.
//!
//! # The seven outcomes
//!
//! | Outcome | Meaning |
//! |---|---|
//! | `ON_TIME` | arrived within the policy's lateness grace |
//! | `LATE` | arrived later than the grace allows, carrying the **raw** minutes late |
//! | `EARLY_LEAVE` | left more than the grace before the planned end |
//! | `ABSENT` | scheduled, no punch at all, no approved leave |
//! | `MISSING_PUNCH` | the pairing is incomplete or ambiguous — a question, not a verdict |
//! | `APPROVED_LEAVE` | the day is covered by an approved leave record |
//! | `AGREED_OVERTIME` | worked past the planned end under an agreed order, by at least the policy minimum |
//!
//! A day may carry several — late arrival *and* agreed overtime — but never
//! contradictory ones. [`OutcomeSet`] is where that is enforced.
//!
//! # What is deliberately impossible here
//!
//! * **`ABSENT` is only "no punch at all".** The Go policy this lineage came
//!   from had an `absent_threshold_minutes` that relabelled a real,
//!   biometrically attested arrival as absence once the person was late enough.
//!   Nothing here contradicts a device observation with a punitive relabelling.
//! * **A day with no punch on a day nobody planned is not a day of absence.**
//!   [`evaluate_day`] returns `Ok(None)` for it: there is nothing to say, and
//!   inventing an eighth outcome to say it would weaken the other seven.
//! * **Unagreed work past the planned end produces no outcome.** Overtime
//!   exists only where an agreement exists; the kernel never invents an
//!   entitlement — and never discards the minutes either. They stay in
//!   [`DayMeasures::overtime_minutes_unagreed`], counted and unpayable.
//! * **No money.** There is no `Money` in this file and no arithmetic that
//!   could produce one. Lateness is a count that can justify a conversation;
//!   turning it into a deduction needs rates this module has never seen.

use super::correction::{Correction, CorrectionEffect};
use super::error::AttendanceError;
use super::ids::{CorrectionId, LeaveRef, OvertimeRef};
use super::policy::{AttendancePolicy, Minutes, PolicyVersion};
use super::punch::{canonical_order, Punch, PunchDirection, PunchTime};
use super::roster::{DayPlan, RosterDay, Shift};
use crate::cloud::domain::employment::{Authorization, EmployeeId, PlaceId};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::fmt;

/// One derived statement about one attendance day.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AttendanceOutcome {
    /// Arrived within the lateness grace.
    OnTime,
    /// Arrived beyond it.
    Late {
        /// Raw minutes after the planned start, **not** reduced by the grace,
        /// so the number means the same thing under every policy version. A
        /// grace-adjusted figure would be unreadable next to a month derived
        /// under a different tolerance.
        minutes: Minutes,
    },
    /// Left more than the grace before the planned end.
    EarlyLeave { minutes: Minutes },
    /// Scheduled, no punch, no approved leave.
    Absent,
    /// The pairing of the day's punches is incomplete or ambiguous.
    MissingPunch,
    /// Covered by an approved leave record.
    ApprovedLeave,
    /// Worked past the planned end under an agreed overtime order.
    AgreedOvertime { minutes: Minutes },
}

impl AttendanceOutcome {
    pub const fn code(self) -> &'static str {
        match self {
            Self::OnTime => "ON_TIME",
            Self::Late { .. } => "LATE",
            Self::EarlyLeave { .. } => "EARLY_LEAVE",
            Self::Absent => "ABSENT",
            Self::MissingPunch => "MISSING_PUNCH",
            Self::ApprovedLeave => "APPROVED_LEAVE",
            Self::AgreedOvertime { .. } => "AGREED_OVERTIME",
        }
    }

    /// Canonical ordering rank, so a set has one deterministic serialization.
    const fn rank(self) -> u8 {
        match self {
            Self::Absent => 0,
            Self::ApprovedLeave => 1,
            Self::OnTime => 2,
            Self::Late { .. } => 3,
            Self::EarlyLeave { .. } => 4,
            Self::AgreedOvertime { .. } => 5,
            Self::MissingPunch => 6,
        }
    }

    pub const fn minutes(self) -> Option<Minutes> {
        match self {
            Self::Late { minutes } | Self::EarlyLeave { minutes } | Self::AgreedOvertime {
                minutes,
            } => Some(minutes),
            _ => None,
        }
    }

    /// `true` when the outcome is the *only* thing that can be said about a day.
    pub const fn is_exclusive(self) -> bool {
        matches!(self, Self::Absent | Self::ApprovedLeave)
    }
}

impl fmt::Display for AttendanceOutcome {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.minutes() {
            Some(minutes) => write!(f, "{}({minutes})", self.code()),
            None => f.write_str(self.code()),
        }
    }
}

/// A non-empty, canonically ordered, internally consistent set of outcomes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "Vec<AttendanceOutcome>", into = "Vec<AttendanceOutcome>")]
pub struct OutcomeSet {
    outcomes: Vec<AttendanceOutcome>,
}

impl From<OutcomeSet> for Vec<AttendanceOutcome> {
    fn from(value: OutcomeSet) -> Self {
        value.outcomes
    }
}

impl TryFrom<Vec<AttendanceOutcome>> for OutcomeSet {
    type Error = AttendanceError;
    fn try_from(value: Vec<AttendanceOutcome>) -> Result<Self, Self::Error> {
        Self::try_new(value)
    }
}

impl OutcomeSet {
    /// Validate and canonicalize.
    ///
    /// Refused: an empty set; the same outcome kind twice; a zero-minute
    /// `LATE`/`EARLY_LEAVE`/`AGREED_OVERTIME`; and every contradictory pair —
    /// `ABSENT` or `APPROVED_LEAVE` with anything at all, `ON_TIME` with
    /// `LATE`, `MISSING_PUNCH` with a departure-derived outcome (the departure
    /// is precisely what is unknown), and `EARLY_LEAVE` with `AGREED_OVERTIME`.
    pub fn try_new(mut outcomes: Vec<AttendanceOutcome>) -> Result<Self, AttendanceError> {
        if outcomes.is_empty() {
            return Err(AttendanceError::EmptyOutcomeSet);
        }
        outcomes.sort_by_key(|outcome| outcome.rank());
        for window in outcomes.windows(2) {
            if window[0].rank() == window[1].rank() {
                return Err(AttendanceError::DuplicateOutcome {
                    code: window[1].code(),
                });
            }
        }
        for outcome in &outcomes {
            if outcome.minutes().is_some_and(Minutes::is_zero) {
                return Err(AttendanceError::ZeroMinuteOutcome {
                    code: outcome.code(),
                });
            }
        }
        if outcomes.len() > 1 {
            if let Some(exclusive) = outcomes.iter().find(|outcome| outcome.is_exclusive()) {
                let other = outcomes
                    .iter()
                    .find(|outcome| outcome.rank() != exclusive.rank())
                    .map_or("?", |outcome| outcome.code());
                return Err(AttendanceError::ContradictoryOutcomes {
                    first: exclusive.code(),
                    second: other,
                });
            }
        }
        let has = |code: &str| outcomes.iter().any(|outcome| outcome.code() == code);
        for (first, second) in [
            ("ON_TIME", "LATE"),
            ("MISSING_PUNCH", "EARLY_LEAVE"),
            ("MISSING_PUNCH", "AGREED_OVERTIME"),
            ("EARLY_LEAVE", "AGREED_OVERTIME"),
        ] {
            if has(first) && has(second) {
                return Err(AttendanceError::ContradictoryOutcomes { first, second });
            }
        }
        Ok(Self { outcomes })
    }

    pub fn single(outcome: AttendanceOutcome) -> Result<Self, AttendanceError> {
        Self::try_new(vec![outcome])
    }

    pub fn outcomes(&self) -> &[AttendanceOutcome] {
        &self.outcomes
    }

    pub fn contains_code(&self, code: &str) -> bool {
        self.outcomes.iter().any(|outcome| outcome.code() == code)
    }

    pub fn find(&self, code: &str) -> Option<AttendanceOutcome> {
        self.outcomes
            .iter()
            .copied()
            .find(|outcome| outcome.code() == code)
    }
}

impl fmt::Display for OutcomeSet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (index, outcome) in self.outcomes.iter().enumerate() {
            if index > 0 {
                f.write_str("+")?;
            }
            write!(f, "{outcome}")?;
        }
        Ok(())
    }
}

/// An approved leave covering one day, with the evidence that it was approved.
///
/// This module does **not** adjudicate leave: entitlement, balances and the
/// approval workflow are `domain::leave`'s. What it needs is the approval as
/// evidence, so an absence is not punished for a reason HR already accepted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LeaveApproval {
    leave: LeaveRef,
    authorization: Authorization,
}

impl LeaveApproval {
    pub const fn new(leave: LeaveRef, authorization: Authorization) -> Self {
        Self {
            leave,
            authorization,
        }
    }
    pub const fn leave(&self) -> &LeaveRef {
        &self.leave
    }
    pub const fn authorization(&self) -> &Authorization {
        &self.authorization
    }
}

/// An agreed overtime order for one day, with the evidence of the agreement.
///
/// *Agreed*, never merely ordered. `domain::overtime` authorizes minutes only
/// in `AGREED`, which is the half of PP 35/2021 art. 26(2) a single manager
/// approval leaves out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OvertimeAgreement {
    overtime: OvertimeRef,
    authorization: Authorization,
}

impl OvertimeAgreement {
    pub const fn new(overtime: OvertimeRef, authorization: Authorization) -> Self {
        Self {
            overtime,
            authorization,
        }
    }
    pub const fn overtime(&self) -> &OvertimeRef {
        &self.overtime
    }
    pub const fn authorization(&self) -> &Authorization {
        &self.authorization
    }
}

/// The approvals in force for one day.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DayApprovals {
    leave: Option<LeaveApproval>,
    overtime: Option<OvertimeAgreement>,
}

impl DayApprovals {
    pub fn none() -> Self {
        Self::default()
    }

    pub fn with_leave(leave: LeaveApproval) -> Self {
        Self {
            leave: Some(leave),
            overtime: None,
        }
    }

    pub fn with_overtime(overtime: OvertimeAgreement) -> Self {
        Self {
            leave: None,
            overtime: Some(overtime),
        }
    }

    #[must_use]
    pub fn and_leave(mut self, leave: LeaveApproval) -> Self {
        self.leave = Some(leave);
        self
    }

    #[must_use]
    pub fn and_overtime(mut self, overtime: OvertimeAgreement) -> Self {
        self.overtime = Some(overtime);
        self
    }

    pub const fn leave(&self) -> Option<&LeaveApproval> {
        self.leave.as_ref()
    }
    pub const fn overtime(&self) -> Option<&OvertimeAgreement> {
        self.overtime.as_ref()
    }
}

/// The measured quantities behind a day's outcomes.
///
/// Kept beside the outcomes because a payroll consequence has to be justified
/// by numbers a person can audit, not by a label.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DayMeasures {
    /// Raw minutes after the planned start, before the grace is applied.
    pub late_minutes: Minutes,
    /// Minutes before the planned end.
    pub early_leave_minutes: Minutes,
    /// Minutes past the planned end that an agreement covers and the policy
    /// recognises. **The only overtime figure a payment may be computed from.**
    pub overtime_minutes_agreed: Minutes,
    /// Minutes past the planned end with **no** agreement. Recorded, never
    /// converted into an entitlement — and never discarded either, so the
    /// question "how much unpaid extra work is there?" has a number rather than
    /// a silence.
    pub overtime_minutes_unagreed: Minutes,
    /// Minutes an agreement covers that fall below the policy's overtime
    /// minimum. Its own counter, because neither label is true: treating it as
    /// unagreed understates what was authorized, and treating it as agreed
    /// overtime overstates what the policy recognises.
    pub overtime_minutes_agreed_below_minimum: Minutes,
    /// Arrival-to-departure span, when both ends are known.
    pub attendance_span: Minutes,
    /// The same, less the shift's unpaid break.
    pub net_worked: Minutes,
}

/// The full derived evaluation of one attendance day.
///
/// Serialize-only on purpose. An evaluation is *derived* data: rebuilding one
/// from the wire would let a payload claim outcomes its measures do not
/// support. Anything that needs one recomputes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DayEvaluation {
    employee: EmployeeId,
    place: PlaceId,
    date: NaiveDate,
    outcomes: OutcomeSet,
    measures: DayMeasures,
    policy_version: PolicyVersion,
    arrival: Option<PunchTime>,
    departure: Option<PunchTime>,
    applied_correction: Option<CorrectionId>,
    punches_considered: usize,
}

impl DayEvaluation {
    pub fn employee(&self) -> &EmployeeId {
        &self.employee
    }
    pub fn place(&self) -> &PlaceId {
        &self.place
    }
    pub const fn date(&self) -> NaiveDate {
        self.date
    }
    pub const fn outcomes(&self) -> &OutcomeSet {
        &self.outcomes
    }
    pub const fn measures(&self) -> DayMeasures {
        self.measures
    }
    /// The policy generation the derivation ran under. Recorded because a month
    /// derived under two tolerances is normal, and a reader has to be able to
    /// tell which part came from which.
    pub const fn policy_version(&self) -> PolicyVersion {
        self.policy_version
    }
    /// Effective arrival — observed, or corrected.
    pub const fn arrival(&self) -> Option<PunchTime> {
        self.arrival
    }
    pub const fn departure(&self) -> Option<PunchTime> {
        self.departure
    }
    pub const fn applied_correction(&self) -> Option<&CorrectionId> {
        self.applied_correction.as_ref()
    }
    /// How many punches were considered. Evidence that the evaluation read the
    /// log rather than a stored status.
    pub const fn punches_considered(&self) -> usize {
        self.punches_considered
    }
}

/// The result of pairing a day's punches.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Pairing {
    arrival: Option<PunchTime>,
    departure: Option<PunchTime>,
    complete: bool,
}

/// Collapse double-taps, then pair the day's punches.
///
/// A *run* is a maximal sequence of same-direction punches whose consecutive
/// gaps are all within the policy's duplicate window: one physical event
/// scanned twice, which on a fingerprint reader is the common case rather than
/// the exception. A run collapses to its earliest `IN` or latest `OUT`.
///
/// Anything that is not exactly one `IN` run followed by one `OUT` run is
/// **ambiguous**, and ambiguity is reported rather than guessed at. A lone
/// `OUT`, or `IN OUT IN`, becomes `MISSING_PUNCH` — a question for a person,
/// not a verdict the kernel invents.
fn pair_punches(punches: &[&Punch], window: Minutes) -> Pairing {
    let mut runs: Vec<(PunchDirection, PunchTime, PunchTime)> = Vec::new();
    for punch in punches {
        let continues_run = runs.last().is_some_and(|(direction, _first, last)| {
            *direction == punch.direction()
                && last
                    .position()
                    .minutes_until(punch.at().position())
                    .is_some_and(|gap| u32::from(gap) <= window.get())
        });
        match (continues_run, runs.last_mut()) {
            (true, Some((_, _, last))) => *last = punch.at(),
            _ => runs.push((punch.direction(), punch.at(), punch.at())),
        }
    }

    let arrival = match runs.first() {
        Some((PunchDirection::In, first, _)) => Some(*first),
        _ => None,
    };
    let complete =
        runs.len() == 2 && runs[0].0 == PunchDirection::In && runs[1].0 == PunchDirection::Out;
    let departure = if complete { Some(runs[1].2) } else { None };
    Pairing {
        arrival,
        departure,
        complete,
    }
}

/// Derive the outcomes of one rostered day.
///
/// `Ok(None)` when the day carries no attendance obligation and no work was
/// observed — a rest day or a public holiday with no punches. There is nothing
/// to say about it, and a day nobody planned and nobody worked is **not** an
/// absence.
///
/// The punches may arrive in any order: the slice is canonicalized into the
/// same total order [`super::PunchLog::day`] uses before pairing, so the answer
/// never depends on delivery order — which matters when a week of buffered
/// punches arrives from a node that was offline.
///
/// Fails closed rather than guessing when the inputs disagree with each other:
/// punches from another employee, place or day; a policy that does not cover
/// the date; work punched on an approved-leave day; work punched on a
/// non-working day with no agreed overtime.
pub fn evaluate_day(
    day: &RosterDay,
    punches: &[&Punch],
    policy: &AttendancePolicy,
    approvals: &DayApprovals,
    correction: Option<&Correction>,
) -> Result<Option<DayEvaluation>, AttendanceError> {
    if !policy.covers(day.date()) {
        return Err(AttendanceError::NoPolicyEffective { date: day.date() });
    }
    for punch in punches {
        if punch.employee() != day.employee()
            || punch.business_date() != day.date()
            || punch.place() != day.place()
        {
            return Err(AttendanceError::PunchDoesNotMatchRosterDay);
        }
    }
    let mut canonical: Vec<&Punch> = punches.to_vec();
    canonical.sort_by(|a, b| canonical_order(a, b));

    let effect = match correction {
        None => None,
        Some(correction) => {
            if correction.employee() != day.employee()
                || correction.place() != day.place()
                || correction.date() != day.date()
            {
                return Err(AttendanceError::CorrectionTargetMismatch);
            }
            correction.approved_effect()
        }
    };
    // No `expect`: an effect exists only when a correction was supplied, and
    // the match carries that pairing instead of a panic path.
    let applied_correction = match (effect, correction) {
        (Some(_), Some(correction)) => Some(correction.id().clone()),
        _ => None,
    };

    let observed = pair_punches(&canonical, policy.limits().duplicate_punch_window);
    let arrival = effect
        .and_then(CorrectionEffect::arrival)
        .or(observed.arrival);
    let departure = effect
        .and_then(CorrectionEffect::departure)
        .or(observed.departure);
    let facts = DayFacts {
        arrival,
        departure,
        complete: arrival.is_some() && departure.is_some(),
        on_leave: approvals.leave().is_some()
            || effect.and_then(CorrectionEffect::approved_leave).is_some(),
        has_punches: !punches.is_empty(),
    };

    let (outcomes, measures) = match day.plan() {
        DayPlan::Scheduled { shift } => evaluate_scheduled(shift, facts, approvals, policy)?,
        DayPlan::RestDay | DayPlan::PublicHoliday => match evaluate_non_working(facts, approvals)? {
            None => return Ok(None),
            Some(pair) => pair,
        },
    };

    Ok(Some(DayEvaluation {
        employee: day.employee().clone(),
        place: day.place().clone(),
        date: day.date(),
        outcomes,
        measures,
        policy_version: policy.version(),
        arrival,
        departure,
        applied_correction,
        punches_considered: punches.len(),
    }))
}

/// The observed-and-corrected facts of a day, resolved before classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DayFacts {
    arrival: Option<PunchTime>,
    departure: Option<PunchTime>,
    complete: bool,
    on_leave: bool,
    has_punches: bool,
}

fn evaluate_scheduled(
    shift: &Shift,
    facts: DayFacts,
    approvals: &DayApprovals,
    policy: &AttendancePolicy,
) -> Result<(OutcomeSet, DayMeasures), AttendanceError> {
    let DayFacts {
        arrival,
        departure,
        complete,
        on_leave,
        has_punches,
    } = facts;
    let limits = policy.limits();

    if on_leave {
        // Work on an approved-leave day is a contradiction the kernel refuses
        // to resolve silently: either the leave is cancelled or a correction
        // states what actually happened. Both belong to a person, with
        // evidence.
        if has_punches {
            return Err(AttendanceError::PunchesOnApprovedLeaveDay);
        }
        return Ok((
            OutcomeSet::single(AttendanceOutcome::ApprovedLeave)?,
            DayMeasures::default(),
        ));
    }

    if arrival.is_none() && departure.is_none() {
        if has_punches {
            // Punches exist but neither end resolved — a lone `OUT`, or an
            // ambiguous run. That is an open question, not an absence:
            // `ABSENT` is reserved for "no punch at all".
            return Ok((
                OutcomeSet::single(AttendanceOutcome::MissingPunch)?,
                DayMeasures::default(),
            ));
        }
        if approvals.overtime().is_some() {
            return Err(AttendanceError::OvertimeAgreedWithoutWork);
        }
        return Ok((
            OutcomeSet::single(AttendanceOutcome::Absent)?,
            DayMeasures::default(),
        ));
    }

    let mut outcomes = Vec::new();
    let mut measures = DayMeasures::default();

    if let Some(arrival) = arrival {
        let late = Minutes::new(u32::from(
            shift
                .start_position()
                .minutes_until(arrival.position())
                .unwrap_or(0),
        ));
        measures.late_minutes = late;
        if late.get() > limits.late_grace.get() {
            outcomes.push(AttendanceOutcome::Late { minutes: late });
        } else {
            outcomes.push(AttendanceOutcome::OnTime);
        }
    }

    let (Some(arrival), Some(departure)) = (arrival, departure) else {
        // One end known and the other not. Whatever was said about the arrival
        // stands; the departure is the open question.
        debug_assert!(!complete, "an incomplete day cannot have both ends");
        outcomes.push(AttendanceOutcome::MissingPunch);
        return Ok((OutcomeSet::try_new(outcomes)?, measures));
    };

    let span = Minutes::new(u32::from(
        arrival
            .position()
            .minutes_until(departure.position())
            .unwrap_or(0),
    ));
    measures.attendance_span = span;
    measures.net_worked = Minutes::new(span.get().saturating_sub(shift.unpaid_break().get()));

    if let Some(early) = departure.position().minutes_until(shift.end_position()) {
        let early = Minutes::new(u32::from(early));
        measures.early_leave_minutes = early;
        if early.get() > limits.early_leave_grace.get() {
            outcomes.push(AttendanceOutcome::EarlyLeave { minutes: early });
        }
    }

    if let Some(extra) = shift.end_position().minutes_until(departure.position()) {
        let extra = Minutes::new(u32::from(extra));
        if !extra.is_zero() && approvals.overtime().is_some() {
            if extra.get() >= limits.overtime_minimum.get() {
                measures.overtime_minutes_agreed = extra;
                outcomes.push(AttendanceOutcome::AgreedOvertime { minutes: extra });
            } else {
                // Agreed, but below the policy minimum: neither agreed overtime
                // nor unagreed work. Its own counter so the two never pollute
                // each other.
                measures.overtime_minutes_agreed_below_minimum = extra;
            }
        } else {
            measures.overtime_minutes_unagreed = extra;
        }
    }

    Ok((OutcomeSet::try_new(outcomes)?, measures))
}

fn evaluate_non_working(
    facts: DayFacts,
    approvals: &DayApprovals,
) -> Result<Option<(OutcomeSet, DayMeasures)>, AttendanceError> {
    let DayFacts {
        arrival,
        departure,
        complete,
        on_leave,
        ..
    } = facts;

    if arrival.is_none() && departure.is_none() {
        if on_leave {
            return Ok(Some((
                OutcomeSet::single(AttendanceOutcome::ApprovedLeave)?,
                DayMeasures::default(),
            )));
        }
        // Nothing was planned and nothing happened. **Not an absence.**
        return Ok(None);
    }
    if on_leave {
        return Err(AttendanceError::PunchesOnApprovedLeaveDay);
    }
    if approvals.overtime().is_none() {
        // Somebody worked on a rest day or a public holiday with nothing
        // agreed. The kernel will not classify it: the punches stand as facts,
        // and an overtime order or a correction must decide what they mean.
        // Silently calling it overtime would invent an entitlement; silently
        // discarding it would lose a day somebody worked.
        return Err(AttendanceError::UnagreedNonWorkingDayWork);
    }
    if !complete {
        return Ok(Some((
            OutcomeSet::single(AttendanceOutcome::MissingPunch)?,
            DayMeasures::default(),
        )));
    }
    let (Some(arrival), Some(departure)) = (arrival, departure) else {
        return Err(AttendanceError::EmptyOutcomeSet);
    };
    let worked = Minutes::new(u32::from(
        arrival
            .position()
            .minutes_until(departure.position())
            .unwrap_or(0),
    ));
    if worked.is_zero() {
        return Err(AttendanceError::UnagreedNonWorkingDayWork);
    }
    Ok(Some((
        OutcomeSet::single(AttendanceOutcome::AgreedOvertime { minutes: worked })?,
        DayMeasures {
            overtime_minutes_agreed: worked,
            attendance_span: worked,
            net_worked: worked,
            ..DayMeasures::default()
        },
    )))
}
