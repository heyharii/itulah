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
use crate::cloud::domain::employment::{Authorization, EmployeeId, UnitId};
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
            Self::Late { minutes }
            | Self::EarlyLeave { minutes }
            | Self::AgreedOvertime { minutes } => Some(minutes),
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
    unit: UnitId,
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
    pub fn unit(&self) -> &UnitId {
        &self.unit
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
            || punch.unit() != day.unit()
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
                || correction.unit() != day.unit()
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
        DayPlan::RestDay | DayPlan::PublicHoliday => {
            match evaluate_non_working(facts, approvals)? {
                None => return Ok(None),
                Some(pair) => pair,
            }
        }
    };

    Ok(Some(DayEvaluation {
        employee: day.employee().clone(),
        unit: day.unit().clone(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::domain::attendance::ids::{PunchId, TerminalId};
    use crate::cloud::domain::attendance::policy::{PolicyId, PolicyLimits};
    use crate::cloud::domain::attendance::punch::{ClockQuality, PunchDirection};
    use crate::cloud::domain::attendance::terminal::{AttendanceTerminal, IdentificationMethod};
    use crate::cloud::domain::attendance::time::{DayOffset, MinuteOfDay, ShiftId};
    use crate::cloud::domain::attendance::AttendanceMonth;
    use crate::cloud::domain::attendance::AttendancePeriod;
    use crate::cloud::domain::employment::{
        actions, AssignmentSpan, AssignmentTimeline, Employee, EmployeeCode, EmployeeId,
        EmploymentTransition, UnitId,
    };
    use chrono::{TimeZone, Utc};

    fn date(iso: &str) -> NaiveDate {
        iso.parse().expect("date")
    }

    const DAY: &str = "2026-09-14";

    fn authority(action_key: &str) -> Authorization {
        Authorization::try_new(
            "manager",
            action_key,
            Utc.with_ymd_and_hms(2026, 9, 1, 8, 0, 0).unwrap(),
            "because the shop opens at eight",
        )
        .expect("authorization")
    }

    fn other_authority(action_key: &str) -> Authorization {
        Authorization::try_new(
            "hr.officer",
            action_key,
            Utc.with_ymd_and_hms(2026, 9, 15, 9, 0, 0).unwrap(),
            "the reader was down on Monday",
        )
        .expect("authorization")
    }

    /// 08:00–16:00 with an hour unpaid.
    fn morning_shift() -> Shift {
        Shift::try_new(
            ShiftId::try_new("pagi").unwrap(),
            "Pagi",
            MinuteOfDay::try_new(8 * 60).unwrap(),
            MinuteOfDay::try_new(16 * 60).unwrap(),
            DayOffset::SAME_DAY,
            Minutes::new(60),
        )
        .expect("shift")
    }

    /// 22:00–06:00, the case the 0..2879 timeline exists for.
    fn night_shift() -> Shift {
        Shift::try_new(
            ShiftId::try_new("malam").unwrap(),
            "Malam",
            MinuteOfDay::try_new(22 * 60).unwrap(),
            MinuteOfDay::try_new(6 * 60).unwrap(),
            DayOffset::NEXT_DAY,
            Minutes::new(30),
        )
        .expect("shift")
    }

    fn scheduled(shift: Shift) -> RosterDay {
        RosterDay::new(
            EmployeeId::try_new("emp-1").unwrap(),
            UnitId::try_new("store-07").unwrap(),
            date(DAY),
            DayPlan::Scheduled { shift },
            authority(actions::ROSTER_MANAGE),
        )
        .expect("roster day")
    }

    fn rest_day() -> RosterDay {
        RosterDay::new(
            EmployeeId::try_new("emp-1").unwrap(),
            UnitId::try_new("store-07").unwrap(),
            date(DAY),
            DayPlan::RestDay,
            authority(actions::ROSTER_MANAGE),
        )
        .expect("roster day")
    }

    /// Ten minutes of lateness grace, ten of early-leave grace, thirty before
    /// overtime is recognised, and five minutes of double-tap window.
    fn policy() -> AttendancePolicy {
        AttendancePolicy::try_new(
            PolicyId::try_new("standard").unwrap(),
            PolicyVersion::try_new(3).unwrap(),
            date("2026-01-01"),
            None,
            PolicyLimits {
                late_grace: Minutes::new(10),
                early_leave_grace: Minutes::new(10),
                overtime_minimum: Minutes::new(30),
                duplicate_punch_window: Minutes::new(5),
            },
        )
        .expect("policy")
    }

    fn terminal() -> AttendanceTerminal {
        AttendanceTerminal::register(
            TerminalId::try_new("term-07").unwrap(),
            UnitId::try_new("store-07").unwrap(),
            "Pintu belakang",
            IdentificationMethod::Fingerprint,
            authority(actions::ATTENDANCE_TERMINAL_MANAGE),
        )
        .expect("terminal")
    }

    fn employee() -> Employee {
        let mut employee = Employee::register(
            EmployeeId::try_new("emp-1").unwrap(),
            EmployeeCode::try_new("0001").unwrap(),
        );
        employee
            .apply(
                EmploymentTransition::Hire,
                date("2026-01-01"),
                authority(actions::EMPLOYMENT_CHANGE),
            )
            .expect("hire");
        employee
    }

    fn timeline() -> AssignmentTimeline {
        let mut timeline = AssignmentTimeline::new();
        timeline
            .push(
                AssignmentSpan::try_new(
                    UnitId::try_new("store-07").unwrap(),
                    date("2026-01-01"),
                    None,
                    authority(actions::ASSIGNMENT_MANAGE),
                )
                .expect("span"),
            )
            .expect("push");
        timeline
    }

    /// One punch, positioned on the business date's timeline.
    fn punch(id: &str, direction: PunchDirection, offset: DayOffset, minute: u16) -> Punch {
        let terminal = terminal();
        let employee = employee();
        let assignment = timeline();
        let period = AttendancePeriod::open(
            UnitId::try_new("store-07").unwrap(),
            AttendanceMonth::try_new(2026, 9).unwrap(),
        );
        Punch::record(
            PunchId::try_new(id).unwrap(),
            &terminal.attest(employee.id().clone()).expect("attest"),
            direction,
            PunchTime::new(date(DAY), offset, MinuteOfDay::try_new(minute).unwrap()),
            Utc.with_ymd_and_hms(2026, 9, 14, 1, 0, 0).unwrap(),
            ClockQuality::Ok,
            crate::cloud::domain::attendance::punch::PunchContext {
                employee: &employee,
                assignment: &assignment,
                period: &period,
            },
        )
        .expect("punch")
    }

    fn evaluate(
        day: &RosterDay,
        punches: &[&Punch],
        approvals: &DayApprovals,
    ) -> Option<DayEvaluation> {
        evaluate_day(day, punches, &policy(), approvals, None).expect("evaluate")
    }

    fn codes(evaluation: &DayEvaluation) -> Vec<&'static str> {
        evaluation
            .outcomes()
            .outcomes()
            .iter()
            .map(|outcome| outcome.code())
            .collect()
    }

    #[test]
    fn arriving_inside_the_grace_is_on_time() {
        let day = scheduled(morning_shift());
        let arrive = punch("in", PunchDirection::In, DayOffset::SAME_DAY, 8 * 60 + 7);
        let leave = punch("out", PunchDirection::Out, DayOffset::SAME_DAY, 16 * 60);
        let evaluation = evaluate(&day, &[&arrive, &leave], &DayApprovals::none()).expect("day");
        assert_eq!(codes(&evaluation), ["ON_TIME"]);
        // The raw minutes are recorded even when the grace forgives them, so
        // the number means the same thing under every policy version.
        assert_eq!(evaluation.measures().late_minutes.get(), 7);
        assert_eq!(evaluation.measures().attendance_span.get(), 8 * 60 - 7);
        assert_eq!(evaluation.measures().net_worked.get(), 8 * 60 - 7 - 60);
    }

    /// `LATE` carries the **raw** minutes, not the minutes beyond the grace.
    #[test]
    fn arriving_past_the_grace_is_late_by_the_raw_minutes() {
        let day = scheduled(morning_shift());
        let arrive = punch("in", PunchDirection::In, DayOffset::SAME_DAY, 8 * 60 + 25);
        let leave = punch("out", PunchDirection::Out, DayOffset::SAME_DAY, 16 * 60);
        let evaluation = evaluate(&day, &[&arrive, &leave], &DayApprovals::none()).expect("day");
        assert_eq!(codes(&evaluation), ["LATE"]);
        assert_eq!(
            evaluation.outcomes().find("LATE").and_then(|o| o.minutes()),
            Some(Minutes::new(25)),
            "not 15: the grace forgives, it does not subtract"
        );
    }

    /// The rule this whole lane is emphatic about: no punch is an absence only
    /// against a scheduled day, and it is the *only* thing that makes one.
    #[test]
    fn a_scheduled_day_with_no_punch_at_all_is_absent() {
        let day = scheduled(morning_shift());
        let evaluation = evaluate(&day, &[], &DayApprovals::none()).expect("day");
        assert_eq!(codes(&evaluation), ["ABSENT"]);
    }

    /// And a day nobody scheduled is **not** an absence. It derives to nothing.
    #[test]
    fn a_rest_day_nobody_worked_derives_to_nothing() {
        assert!(
            evaluate(&rest_day(), &[], &DayApprovals::none()).is_none(),
            "a day nobody planned and nobody worked is not an absence"
        );
    }

    /// A real arrival is never relabelled as absence however late it is. The
    /// implementation this lineage replaced had an `absent_threshold_minutes`
    /// that did exactly that.
    #[test]
    fn a_very_late_arrival_is_still_not_an_absence() {
        let day = scheduled(morning_shift());
        let arrive = punch("in", PunchDirection::In, DayOffset::SAME_DAY, 15 * 60);
        let leave = punch("out", PunchDirection::Out, DayOffset::SAME_DAY, 16 * 60);
        let evaluation = evaluate(&day, &[&arrive, &leave], &DayApprovals::none()).expect("day");
        assert!(codes(&evaluation).contains(&"LATE"));
        assert!(
            !codes(&evaluation).contains(&"ABSENT"),
            "a biometrically attested arrival is not an absence"
        );
    }

    /// A lone `OUT` is a question, not a verdict.
    #[test]
    fn an_unpairable_punch_is_a_missing_punch_and_not_an_absence() {
        let day = scheduled(morning_shift());
        let leave = punch("out", PunchDirection::Out, DayOffset::SAME_DAY, 16 * 60);
        let evaluation = evaluate(&day, &[&leave], &DayApprovals::none()).expect("day");
        assert_eq!(codes(&evaluation), ["MISSING_PUNCH"]);
    }

    /// Two taps inside the duplicate window are one physical event. On a
    /// fingerprint reader this is the common case, not the exception.
    #[test]
    fn a_double_tap_collapses_into_one_arrival() {
        let day = scheduled(morning_shift());
        let first = punch("in-1", PunchDirection::In, DayOffset::SAME_DAY, 8 * 60 + 2);
        let again = punch("in-2", PunchDirection::In, DayOffset::SAME_DAY, 8 * 60 + 4);
        let leave = punch("out", PunchDirection::Out, DayOffset::SAME_DAY, 16 * 60);
        let evaluation =
            evaluate(&day, &[&first, &again, &leave], &DayApprovals::none()).expect("day");
        assert_eq!(codes(&evaluation), ["ON_TIME"]);
        // The earliest `IN` of the run is the arrival, so a second tap cannot
        // make somebody later than they were.
        assert_eq!(evaluation.measures().late_minutes.get(), 2);
        assert_eq!(evaluation.punches_considered(), 3, "all three were read");
    }

    /// Derivation must not depend on delivery order — which matters the day a
    /// week of buffered punches arrives from a node that was offline.
    #[test]
    fn the_answer_does_not_depend_on_the_order_the_punches_arrive_in() {
        let day = scheduled(morning_shift());
        let arrive = punch("in", PunchDirection::In, DayOffset::SAME_DAY, 8 * 60 + 25);
        let leave = punch("out", PunchDirection::Out, DayOffset::SAME_DAY, 15 * 60);
        let forwards = evaluate(&day, &[&arrive, &leave], &DayApprovals::none()).expect("day");
        let backwards = evaluate(&day, &[&leave, &arrive], &DayApprovals::none()).expect("day");
        assert_eq!(forwards, backwards);
    }

    /// The 0..2879 timeline, doing the job it exists for: an overnight shift
    /// needs no timezone machinery, and 06:00 the next morning is on time.
    #[test]
    fn an_overnight_shift_pairs_across_midnight() {
        let day = scheduled(night_shift());
        let arrive = punch("in", PunchDirection::In, DayOffset::SAME_DAY, 22 * 60);
        let leave = punch("out", PunchDirection::Out, DayOffset::NEXT_DAY, 6 * 60);
        let evaluation = evaluate(&day, &[&arrive, &leave], &DayApprovals::none()).expect("day");
        assert_eq!(codes(&evaluation), ["ON_TIME"]);
        assert_eq!(evaluation.measures().attendance_span.get(), 8 * 60);
        assert_eq!(evaluation.measures().net_worked.get(), 8 * 60 - 30);
    }

    /// Work past the planned end with nothing agreed produces **no outcome**
    /// and is **not discarded**.
    #[test]
    fn unagreed_extra_work_is_counted_and_grants_nothing() {
        let day = scheduled(morning_shift());
        let arrive = punch("in", PunchDirection::In, DayOffset::SAME_DAY, 8 * 60);
        let leave = punch("out", PunchDirection::Out, DayOffset::SAME_DAY, 18 * 60);
        let evaluation = evaluate(&day, &[&arrive, &leave], &DayApprovals::none()).expect("day");
        assert_eq!(codes(&evaluation), ["ON_TIME"]);
        assert_eq!(evaluation.measures().overtime_minutes_unagreed.get(), 120);
        assert_eq!(
            evaluation.measures().overtime_minutes_agreed.get(),
            0,
            "nothing here can be paid from"
        );
    }

    /// With an agreement, the same two hours become the one figure a payment
    /// may be computed from.
    #[test]
    fn agreed_extra_work_above_the_minimum_is_agreed_overtime() {
        let day = scheduled(morning_shift());
        let arrive = punch("in", PunchDirection::In, DayOffset::SAME_DAY, 8 * 60);
        let leave = punch("out", PunchDirection::Out, DayOffset::SAME_DAY, 18 * 60);
        let approvals = DayApprovals::with_overtime(OvertimeAgreement::new(
            OvertimeRef::try_new("ot-1").unwrap(),
            authority(actions::OVERTIME_ORDER),
        ));
        let evaluation = evaluate(&day, &[&arrive, &leave], &approvals).expect("day");
        assert!(codes(&evaluation).contains(&"AGREED_OVERTIME"));
        assert_eq!(evaluation.measures().overtime_minutes_agreed.get(), 120);
        assert_eq!(evaluation.measures().overtime_minutes_unagreed.get(), 0);
    }

    /// Agreed but below the policy minimum is neither of the two, so it has its
    /// own counter. Rounding it into either would misstate what somebody
    /// authorized or what the policy recognises.
    #[test]
    fn agreed_work_below_the_minimum_has_its_own_counter() {
        let day = scheduled(morning_shift());
        let arrive = punch("in", PunchDirection::In, DayOffset::SAME_DAY, 8 * 60);
        let leave = punch(
            "out",
            PunchDirection::Out,
            DayOffset::SAME_DAY,
            16 * 60 + 20,
        );
        let approvals = DayApprovals::with_overtime(OvertimeAgreement::new(
            OvertimeRef::try_new("ot-1").unwrap(),
            authority(actions::OVERTIME_ORDER),
        ));
        let evaluation = evaluate(&day, &[&arrive, &leave], &approvals).expect("day");
        assert!(!codes(&evaluation).contains(&"AGREED_OVERTIME"));
        let measures = evaluation.measures();
        assert_eq!(measures.overtime_minutes_agreed_below_minimum.get(), 20);
        assert_eq!(measures.overtime_minutes_agreed.get(), 0);
        assert_eq!(measures.overtime_minutes_unagreed.get(), 0);
    }

    /// Approved leave is exclusive: nothing else can be said about the day.
    #[test]
    fn an_approved_leave_day_says_only_that() {
        let day = scheduled(morning_shift());
        let approvals = DayApprovals::with_leave(LeaveApproval::new(
            LeaveRef::try_new("leave-1").unwrap(),
            authority(actions::LEAVE_DECIDE),
        ));
        let evaluation = evaluate(&day, &[], &approvals).expect("day");
        assert_eq!(codes(&evaluation), ["APPROVED_LEAVE"]);
    }

    /// Work on an approved-leave day is a contradiction the kernel will not
    /// resolve silently: somebody has to cancel the leave or state what
    /// happened, with evidence.
    #[test]
    fn punches_on_an_approved_leave_day_are_refused() {
        let day = scheduled(morning_shift());
        let arrive = punch("in", PunchDirection::In, DayOffset::SAME_DAY, 8 * 60);
        let approvals = DayApprovals::with_leave(LeaveApproval::new(
            LeaveRef::try_new("leave-1").unwrap(),
            authority(actions::LEAVE_DECIDE),
        ));
        assert!(matches!(
            evaluate_day(&day, &[&arrive], &policy(), &approvals, None),
            Err(AttendanceError::PunchesOnApprovedLeaveDay)
        ));
    }

    /// Somebody worked a rest day with nothing agreed. The punches stand; the
    /// kernel refuses to say what they meant rather than inventing overtime or
    /// throwing the day away.
    #[test]
    fn unagreed_work_on_a_rest_day_is_refused_rather_than_classified() {
        let arrive = punch("in", PunchDirection::In, DayOffset::SAME_DAY, 9 * 60);
        let leave = punch("out", PunchDirection::Out, DayOffset::SAME_DAY, 13 * 60);
        assert!(matches!(
            evaluate_day(
                &rest_day(),
                &[&arrive, &leave],
                &policy(),
                &DayApprovals::none(),
                None
            ),
            Err(AttendanceError::UnagreedNonWorkingDayWork)
        ));
    }

    /// A day with no policy covering it is a refusal naming the date, never a
    /// silently assumed tolerance.
    #[test]
    fn a_date_no_policy_covers_is_refused_by_name() {
        let day = RosterDay::new(
            EmployeeId::try_new("emp-1").unwrap(),
            UnitId::try_new("store-07").unwrap(),
            date("2025-06-01"),
            DayPlan::Scheduled {
                shift: morning_shift(),
            },
            authority(actions::ROSTER_MANAGE),
        )
        .expect("roster day");
        assert!(matches!(
            evaluate_day(&day, &[], &policy(), &DayApprovals::none(), None),
            Err(AttendanceError::NoPolicyEffective { .. })
        ));
    }

    /// Somebody else's punch cannot be derived into this person's day.
    #[test]
    fn a_punch_for_another_day_is_refused() {
        let day = scheduled(morning_shift());
        let elsewhere = punch("in", PunchDirection::In, DayOffset::SAME_DAY, 8 * 60);
        let other_day = RosterDay::new(
            EmployeeId::try_new("emp-1").unwrap(),
            UnitId::try_new("store-07").unwrap(),
            date("2026-09-15"),
            DayPlan::Scheduled {
                shift: morning_shift(),
            },
            authority(actions::ROSTER_MANAGE),
        )
        .expect("roster day");
        assert!(matches!(
            evaluate_day(
                &other_day,
                &[&elsewhere],
                &policy(),
                &DayApprovals::none(),
                None
            ),
            Err(AttendanceError::PunchDoesNotMatchRosterDay)
        ));
        // And the right day still derives.
        assert!(evaluate(&day, &[&elsewhere], &DayApprovals::none()).is_some());
    }

    /// The reason this module matters: a reader that would not take somebody's
    /// finger produces an absence, and an approved correction turns it back
    /// into the day they actually worked. **The punches are untouched.**
    #[test]
    fn an_approved_correction_rescues_a_day_the_reader_missed() {
        let day = scheduled(morning_shift());
        let absent = evaluate(&day, &[], &DayApprovals::none()).expect("day");
        assert_eq!(codes(&absent), ["ABSENT"]);

        let mut chain = crate::cloud::domain::attendance::correction::CorrectionChain::new(
            EmployeeId::try_new("emp-1").unwrap(),
            UnitId::try_new("store-07").unwrap(),
            date(DAY),
        );
        let period = AttendancePeriod::open(
            UnitId::try_new("store-07").unwrap(),
            AttendanceMonth::try_new(2026, 9).unwrap(),
        );
        let correction = Correction::request(
            CorrectionId::try_new("cor-1").unwrap(),
            EmployeeId::try_new("emp-1").unwrap(),
            UnitId::try_new("store-07").unwrap(),
            date(DAY),
            CorrectionEffect::ArrivalAndDeparture {
                arrival: PunchTime::same_day(date(DAY), MinuteOfDay::try_new(8 * 60).unwrap()),
                departure: PunchTime::same_day(date(DAY), MinuteOfDay::try_new(16 * 60).unwrap()),
            },
            None,
            authority(actions::CORRECTION_REQUEST),
        )
        .expect("request");
        chain.submit(correction, &period).expect("submit");
        chain
            .approve(other_authority(actions::CORRECTION_DECIDE), &period)
            .expect("approve");

        let rescued = evaluate_day(
            &day,
            &[],
            &policy(),
            &DayApprovals::none(),
            chain.effective(),
        )
        .expect("evaluate")
        .expect("day");
        assert_eq!(codes(&rescued), ["ON_TIME"]);
        assert_eq!(rescued.measures().net_worked.get(), 8 * 60 - 60);
        assert_eq!(
            rescued.applied_correction().map(ToString::to_string),
            Some("cor-1".to_owned()),
            "the evaluation names the correction that changed it"
        );
        assert_eq!(
            rescued.punches_considered(),
            0,
            "the correction is an overlay: there are still no punches"
        );
    }

    /// A pending correction changes nothing. Only an approved one is an
    /// overlay, which is what stops a request from being a decision.
    #[test]
    fn a_pending_correction_changes_no_outcome() {
        let day = scheduled(morning_shift());
        let mut chain = crate::cloud::domain::attendance::correction::CorrectionChain::new(
            EmployeeId::try_new("emp-1").unwrap(),
            UnitId::try_new("store-07").unwrap(),
            date(DAY),
        );
        let period = AttendancePeriod::open(
            UnitId::try_new("store-07").unwrap(),
            AttendanceMonth::try_new(2026, 9).unwrap(),
        );
        chain
            .submit(
                Correction::request(
                    CorrectionId::try_new("cor-1").unwrap(),
                    EmployeeId::try_new("emp-1").unwrap(),
                    UnitId::try_new("store-07").unwrap(),
                    date(DAY),
                    CorrectionEffect::Arrival {
                        at: PunchTime::same_day(date(DAY), MinuteOfDay::try_new(8 * 60).unwrap()),
                    },
                    None,
                    authority(actions::CORRECTION_REQUEST),
                )
                .expect("request"),
                &period,
            )
            .expect("submit");
        assert!(chain.effective().is_none());
        let evaluation = evaluate_day(&day, &[], &policy(), &DayApprovals::none(), chain.pending())
            .expect("evaluate")
            .expect("day");
        assert_eq!(codes(&evaluation), ["ABSENT"]);
    }

    /// An outcome set cannot say two contradictory things, and the refusals are
    /// what make "a day may carry several outcomes" safe.
    #[test]
    fn contradictory_outcomes_are_not_representable() {
        assert!(matches!(
            OutcomeSet::try_new(vec![AttendanceOutcome::Absent, AttendanceOutcome::OnTime]),
            Err(AttendanceError::ContradictoryOutcomes { .. })
        ));
        assert!(matches!(
            OutcomeSet::try_new(vec![
                AttendanceOutcome::OnTime,
                AttendanceOutcome::Late {
                    minutes: Minutes::new(5)
                }
            ]),
            Err(AttendanceError::ContradictoryOutcomes { .. })
        ));
        assert!(matches!(
            OutcomeSet::try_new(vec![
                AttendanceOutcome::MissingPunch,
                AttendanceOutcome::EarlyLeave {
                    minutes: Minutes::new(5)
                }
            ]),
            Err(AttendanceError::ContradictoryOutcomes { .. })
        ));
        assert!(matches!(
            OutcomeSet::try_new(Vec::new()),
            Err(AttendanceError::EmptyOutcomeSet)
        ));
        // A zero-minute LATE says nothing, so it is not a thing a day may say.
        assert!(matches!(
            OutcomeSet::single(AttendanceOutcome::Late {
                minutes: Minutes::ZERO
            }),
            Err(AttendanceError::ZeroMinuteOutcome { .. })
        ));
    }
}
