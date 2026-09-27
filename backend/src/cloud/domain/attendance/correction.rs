//! The append-only correction chain.
//!
//! # A correction never overwrites an observation
//!
//! In the implementation this lineage replaced, approving a correction wrote
//! the corrected times into the attendance row, replacing what the device saw.
//! Here a correction is an **overlay**: the punches stay exactly as recorded,
//! the correction is a separate immutable request with its own decision
//! evidence, and [`super::evaluate_day`] recomputes the outcome from both. What
//! the terminal observed and what HR decided stay separately answerable for
//! ever.
//!
//! # Why this module matters more here than in the donor
//!
//! Fingerprint is the only way in. There is no PIN and no card, by the owner's
//! twice-reaffirmed decision, so a reader that will not take somebody's finger
//! produces a day with no punch — and a day with no punch on a scheduled day is
//! an absence. The correction chain is therefore not a tidy-up path; it is the
//! *only* route by which a real day of work that the device failed to see
//! becomes a real day of work again. That is the cost the owner accepted, and
//! this is where it is paid.
//!
//! # The chain
//!
//! Corrections for one `(employee, place, date)` form a chain:
//!
//! * at most **one pending** request at a time — a queue of contradictory
//!   pending edits to one day has no defined meaning, and whichever one an
//!   approver happened to see would become the answer;
//! * a new request must declare which approved correction it **supersedes**,
//!   and that link must be the currently effective one, so two people
//!   correcting the same day cannot silently clobber each other;
//! * decisions are appended, never rewritten: a rejected request stays in the
//!   chain as evidence that somebody looked;
//! * **withdrawal is the requester's alone.** Anybody else who wants a pending
//!   request gone must reject it, which records their name and reason. Letting
//!   a third party "withdraw" it would dispose of the request while making it
//!   look like the requester changed their own mind;
//! * the **effective** correction is the most recent approved one;
//! * a **closed period refuses a new one**, and refuses a decision on one.
//!
//! # Two people, not one
//!
//! The reference lets one actor both request and approve, behind a configurable
//! sole-actor policy. This backend does not, and the rule is added rather than
//! ported — it is the same rule the payroll run already carries: *a control one
//! person can complete alone is a record of a signature, not a control.* A
//! correction changes a derived outcome and therefore a payroll basis, so the
//! requester and the decider must be different actors.
//!
//! The practical consequence is deliberate. In a shop with one manager, that
//! manager files and HR decides — which is the honest arrangement, because the
//! alternative is a manager who can rewrite their own shop's month with nobody
//! else's name anywhere on it.

use super::error::AttendanceError;
use super::ids::{CorrectionId, LeaveRef};
use super::period::AttendancePeriod;
use super::punch::PunchTime;
use crate::cloud::domain::employment::{Authorization, EmployeeId, UnitId};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::fmt;

/// What an approved correction changes about a day.
///
/// Deliberately small. It states an arrival, a departure, both, or that the day
/// was approved leave. It **cannot** state an outcome (`LATE`, `ABSENT`):
/// outcomes are derived, so letting a decider write one directly would put back
/// the stored-status problem this design removes. It cannot state an amount
/// either — there is no money anywhere in this module.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "effect", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CorrectionEffect {
    /// The employee did arrive, at this place-local time.
    Arrival { at: PunchTime },
    /// The employee did leave, at this place-local time.
    Departure { at: PunchTime },
    /// Both ends of the day are corrected.
    ArrivalAndDeparture {
        arrival: PunchTime,
        departure: PunchTime,
    },
    /// The day was approved leave, not an attendance failure.
    ApprovedLeave { leave: LeaveRef },
}

impl CorrectionEffect {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Arrival { .. } => "ARRIVAL",
            Self::Departure { .. } => "DEPARTURE",
            Self::ArrivalAndDeparture { .. } => "ARRIVAL_AND_DEPARTURE",
            Self::ApprovedLeave { .. } => "APPROVED_LEAVE",
        }
    }

    pub const fn arrival(&self) -> Option<PunchTime> {
        match self {
            Self::Arrival { at } => Some(*at),
            Self::ArrivalAndDeparture { arrival, .. } => Some(*arrival),
            _ => None,
        }
    }

    pub const fn departure(&self) -> Option<PunchTime> {
        match self {
            Self::Departure { at } => Some(*at),
            Self::ArrivalAndDeparture { departure, .. } => Some(*departure),
            _ => None,
        }
    }

    pub const fn approved_leave(&self) -> Option<&LeaveRef> {
        match self {
            Self::ApprovedLeave { leave } => Some(leave),
            _ => None,
        }
    }

    /// Validate the effect against the day it targets.
    ///
    /// Both checks are about internal coherence rather than authority, which is
    /// why they run on every decode as well as on the live path: a corrected
    /// departure before its corrected arrival would make the span negative, and
    /// a corrected time filed under another day's business date would silently
    /// move work from one month to another.
    fn validate(&self, date: NaiveDate) -> Result<(), AttendanceError> {
        if let (Some(arrival), Some(departure)) = (self.arrival(), self.departure()) {
            if arrival.position() >= departure.position() {
                return Err(AttendanceError::CorrectionArrivalNotBeforeDeparture);
            }
        }
        for time in [self.arrival(), self.departure()].into_iter().flatten() {
            if time.business_date() != date {
                return Err(AttendanceError::CorrectionTargetMismatch);
            }
        }
        Ok(())
    }
}

impl fmt::Display for CorrectionEffect {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

/// Where a correction request stands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CorrectionState {
    /// Awaiting a decision.
    Pending,
    /// Approved: this correction may become the effective overlay.
    Approved { decision: Authorization },
    /// Rejected. Kept in the chain as evidence; changes nothing.
    Rejected { decision: Authorization },
    /// Withdrawn by the requester before a decision.
    Withdrawn { decision: Authorization },
}

impl CorrectionState {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Approved { .. } => "APPROVED",
            Self::Rejected { .. } => "REJECTED",
            Self::Withdrawn { .. } => "WITHDRAWN",
        }
    }

    pub const fn is_pending(&self) -> bool {
        matches!(self, Self::Pending)
    }

    pub const fn is_approved(&self) -> bool {
        matches!(self, Self::Approved { .. })
    }

    pub const fn decision(&self) -> Option<&Authorization> {
        match self {
            Self::Pending => None,
            Self::Approved { decision }
            | Self::Rejected { decision }
            | Self::Withdrawn { decision } => Some(decision),
        }
    }
}

impl fmt::Display for CorrectionState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

/// The stored shape, so a row re-runs every rule it carries.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CorrectionWire {
    pub id: CorrectionId,
    pub employee: EmployeeId,
    pub unit: UnitId,
    pub date: NaiveDate,
    pub effect: CorrectionEffect,
    #[serde(default)]
    pub supersedes: Option<CorrectionId>,
    pub requested: Authorization,
    pub state: CorrectionState,
}

/// One immutable correction request plus its append-only decision state.
///
/// # Decoding re-runs what a decode can re-run
///
/// Everything the live paths check about a *single* correction is re-checkable
/// from the value alone, so the `serde` shim runs through
/// [`Correction::try_new`]:
///
/// * the effect is well formed for the day it names — arrival before
///   departure, both on the correction's own business date;
/// * a request was filed under a key that may file one, and a decision taken
///   under one that may decide;
/// * an approved or rejected correction was decided by a **different actor**
///   from the requester — the two-person rule, re-checked on the way in from
///   storage so a round trip through the database cannot launder it;
/// * a withdrawn one was retracted by the actor who filed it.
///
/// One thing a decode deliberately does **not** claim to check: the close state
/// of the period. A correction decided in March must still load in June, when
/// March is closed — refusing it would make settled months unreadable, which is
/// the opposite of what closing means. Creating or deciding a *new* one there is
/// still refused, by [`CorrectionChain`], which is handed the period.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Correction {
    id: CorrectionId,
    employee: EmployeeId,
    unit: UnitId,
    date: NaiveDate,
    effect: CorrectionEffect,
    supersedes: Option<CorrectionId>,
    requested: Authorization,
    state: CorrectionState,
}

impl<'de> Deserialize<'de> for Correction {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = CorrectionWire::deserialize(deserializer)?;
        Self::try_new(
            wire.id,
            wire.employee,
            wire.unit,
            wire.date,
            wire.effect,
            wire.supersedes,
            wire.requested,
            wire.state,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl Correction {
    /// File a pending correction request.
    ///
    /// Whether the caller may file about *this* employee is the handler's
    /// question, not this one's: `people.correction.request_own` is bounded to
    /// the caller's own record by the same `Access::own` check leave and
    /// overtime use, and the binding that would let this kernel re-check it is
    /// session state that is never persisted. What is checked here is that the
    /// key permits filing at all.
    pub fn request(
        id: CorrectionId,
        employee: EmployeeId,
        unit: UnitId,
        date: NaiveDate,
        effect: CorrectionEffect,
        supersedes: Option<CorrectionId>,
        requested: Authorization,
    ) -> Result<Self, AttendanceError> {
        Self::try_new(
            id,
            employee,
            unit,
            date,
            effect,
            supersedes,
            requested,
            CorrectionState::Pending,
        )
    }

    /// Rebuild from storage, re-running every rule a single correction carries
    /// in itself. See the type documentation for what that is and what it
    /// cannot be.
    #[allow(clippy::too_many_arguments)]
    pub fn try_new(
        id: CorrectionId,
        employee: EmployeeId,
        unit: UnitId,
        date: NaiveDate,
        effect: CorrectionEffect,
        supersedes: Option<CorrectionId>,
        requested: Authorization,
        state: CorrectionState,
    ) -> Result<Self, AttendanceError> {
        let correction = Self {
            id,
            employee,
            unit,
            date,
            effect,
            supersedes,
            requested,
            state,
        };
        correction.revalidate()?;
        Ok(correction)
    }

    /// Re-run the rules a correction carries in itself.
    ///
    /// Shared by [`Correction::try_new`] and [`CorrectionChain::try_new`], so
    /// there is exactly one definition of what a stored correction must
    /// satisfy and the two decode paths cannot drift apart.
    fn revalidate(&self) -> Result<(), AttendanceError> {
        self.effect.validate(self.date)?;
        if !self.requested.authorizes_correction_request() {
            return Err(AttendanceError::ActionForbidsCorrectionRequest {
                action_key: self.requested.action_key().to_owned(),
            });
        }
        match &self.state {
            CorrectionState::Pending => {}
            CorrectionState::Approved { decision } | CorrectionState::Rejected { decision } => {
                if !decision.authorizes_correction_decision() {
                    return Err(AttendanceError::ActionForbidsCorrectionDecision {
                        action_key: decision.action_key().to_owned(),
                    });
                }
                // The two-person rule, on the way in from storage as well as on
                // the transition. A rule only the live path enforces is a rule
                // a round trip through the database removes.
                if decision.actor() == self.requested.actor() {
                    return Err(AttendanceError::ActionForbidsCorrectionDecision {
                        action_key: decision.action_key().to_owned(),
                    });
                }
            }
            CorrectionState::Withdrawn { decision } => {
                if decision.actor() != self.requested.actor() {
                    return Err(AttendanceError::CorrectionWithdrawalNotByRequester);
                }
            }
        }
        Ok(())
    }

    pub fn id(&self) -> &CorrectionId {
        &self.id
    }
    pub fn employee(&self) -> &EmployeeId {
        &self.employee
    }
    pub fn unit(&self) -> &UnitId {
        &self.unit
    }
    pub const fn date(&self) -> NaiveDate {
        self.date
    }
    pub const fn effect(&self) -> &CorrectionEffect {
        &self.effect
    }
    pub const fn supersedes(&self) -> Option<&CorrectionId> {
        self.supersedes.as_ref()
    }
    pub const fn requested(&self) -> &Authorization {
        &self.requested
    }
    pub const fn state(&self) -> &CorrectionState {
        &self.state
    }

    /// The effect this correction imposes, and `None` unless it was approved.
    ///
    /// The one accessor [`super::evaluate_day`] calls, so a pending or rejected
    /// request cannot change an outcome by being in the room.
    pub const fn approved_effect(&self) -> Option<&CorrectionEffect> {
        match self.state {
            CorrectionState::Approved { .. } => Some(&self.effect),
            _ => None,
        }
    }
}

/// Every correction ever filed for one `(employee, place, date)`, in submission
/// order.
///
/// The chain is the unit the rules are about: "at most one pending", "supersede
/// the one in force" and "the effective correction is the most recent approved
/// one" are all statements about a set of corrections rather than about one, so
/// none of them could be enforced by a type holding only one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CorrectionChain {
    employee: EmployeeId,
    unit: UnitId,
    date: NaiveDate,
    corrections: Vec<Correction>,
}

impl CorrectionChain {
    /// An empty chain for one day.
    pub const fn new(employee: EmployeeId, unit: UnitId, date: NaiveDate) -> Self {
        Self {
            employee,
            unit,
            date,
            corrections: Vec::new(),
        }
    }

    /// Rebuild from storage, in `chain_seq` order.
    ///
    /// Refuses a correction belonging to another day, and more than one pending
    /// request — the second because the unique partial index in `0234` is the
    /// second copy of that rule and this is the first.
    pub fn try_new(
        employee: EmployeeId,
        unit: UnitId,
        date: NaiveDate,
        corrections: Vec<Correction>,
    ) -> Result<Self, AttendanceError> {
        for correction in &corrections {
            if correction.employee != employee || correction.unit != unit || correction.date != date
            {
                return Err(AttendanceError::CorrectionChainMismatch);
            }
            correction.revalidate()?;
        }
        if corrections
            .iter()
            .filter(|correction| correction.state.is_pending())
            .count()
            > 1
        {
            return Err(AttendanceError::AnotherCorrectionIsPending);
        }
        Ok(Self {
            employee,
            unit,
            date,
            corrections,
        })
    }

    pub fn employee(&self) -> &EmployeeId {
        &self.employee
    }
    pub fn unit(&self) -> &UnitId {
        &self.unit
    }
    pub const fn date(&self) -> NaiveDate {
        self.date
    }
    pub fn corrections(&self) -> &[Correction] {
        &self.corrections
    }

    /// The request awaiting a decision, if there is one.
    pub fn pending(&self) -> Option<&Correction> {
        self.corrections
            .iter()
            .find(|correction| correction.state.is_pending())
    }

    /// The correction in force: the most recent approved one.
    pub fn effective(&self) -> Option<&Correction> {
        self.corrections
            .iter()
            .rev()
            .find(|correction| correction.state.is_approved())
    }

    /// The next `chain_seq`, so a caller never has to guess one.
    pub fn next_seq(&self) -> u32 {
        u32::try_from(self.corrections.len())
            .unwrap_or(u32::MAX)
            .saturating_add(1)
    }

    /// File a request onto the chain.
    ///
    /// Fails closed when the period is closed, when one is already pending, and
    /// when `supersedes` does not name the correction currently in force — the
    /// last being what stops two people correcting one day from clobbering each
    /// other silently.
    pub fn submit(
        &mut self,
        correction: Correction,
        period: &AttendancePeriod,
    ) -> Result<&Correction, AttendanceError> {
        if correction.employee != self.employee
            || correction.unit != self.unit
            || correction.date != self.date
        {
            return Err(AttendanceError::CorrectionChainMismatch);
        }
        self.require_open(period)?;
        if self.pending().is_some() {
            return Err(AttendanceError::AnotherCorrectionIsPending);
        }
        let in_force = self.effective().map(|held| held.id.clone());
        if correction.supersedes != in_force {
            return Err(AttendanceError::CorrectionSupersedesTheWrongLink {
                expected: in_force.map_or_else(|| "nothing".to_owned(), |id| id.to_string()),
            });
        }
        self.corrections.push(correction);
        self.corrections
            .last()
            .ok_or(AttendanceError::CorrectionChainMismatch)
    }

    /// Approve the pending request.
    pub fn approve(
        &mut self,
        decision: Authorization,
        period: &AttendancePeriod,
    ) -> Result<(), AttendanceError> {
        self.decide(period, decision, true)
    }

    /// Refuse it. The row stays in the chain, because a refusal is a decision
    /// somebody took and a day whose correction was refused is a day somebody
    /// looked at.
    pub fn reject(
        &mut self,
        decision: Authorization,
        period: &AttendancePeriod,
    ) -> Result<(), AttendanceError> {
        self.decide(period, decision, false)
    }

    fn decide(
        &mut self,
        period: &AttendancePeriod,
        decision: Authorization,
        approve: bool,
    ) -> Result<(), AttendanceError> {
        self.require_open(period)?;
        if !decision.authorizes_correction_decision() {
            return Err(AttendanceError::ActionForbidsCorrectionDecision {
                action_key: decision.action_key().to_owned(),
            });
        }
        let index = self
            .corrections
            .iter()
            .position(|correction| correction.state.is_pending())
            .ok_or(AttendanceError::CorrectionAlreadyDecided { state: "decided" })?;
        if self.corrections[index].requested.actor() == decision.actor() {
            // Two people, not one. The same actor on both halves is a signature
            // recorded twice, not a control.
            return Err(AttendanceError::ActionForbidsCorrectionDecision {
                action_key: decision.action_key().to_owned(),
            });
        }
        self.corrections[index].state = if approve {
            CorrectionState::Approved { decision }
        } else {
            CorrectionState::Rejected { decision }
        };
        Ok(())
    }

    /// Withdraw the pending request. **Only the requester may.**
    ///
    /// Anybody else who wants it gone rejects it under their own name. A third
    /// party "withdrawing" it would dispose of the request while making the
    /// record say the requester changed their own mind.
    ///
    /// No period check, deliberately: taking back your own unanswered statement
    /// changes no derived outcome — a pending correction has never affected one
    /// — so there is nothing for a closed month to protect. Refusing it would
    /// leave a request permanently stuck in a settled period's queue.
    pub fn withdraw(&mut self, decision: Authorization) -> Result<(), AttendanceError> {
        let index = self
            .corrections
            .iter()
            .position(|correction| correction.state.is_pending())
            .ok_or(AttendanceError::CorrectionAlreadyDecided { state: "decided" })?;
        if self.corrections[index].requested.actor() != decision.actor() {
            return Err(AttendanceError::CorrectionWithdrawalNotByRequester);
        }
        self.corrections[index].state = CorrectionState::Withdrawn { decision };
        Ok(())
    }

    fn require_open(&self, period: &AttendancePeriod) -> Result<(), AttendanceError> {
        period.require_covers(&self.unit, self.date)?;
        if period.is_closed() {
            return Err(AttendanceError::ClosedPeriodRejectsCorrection {
                period: period.period().to_string(),
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::domain::attendance::time::{AttendanceMonth, MinuteOfDay};
    use crate::cloud::domain::attendance::CloseReadiness;
    use crate::cloud::domain::employment::actions;
    use chrono::{TimeZone, Utc};

    const DAY: &str = "2026-09-14";

    fn date(iso: &str) -> NaiveDate {
        iso.parse().expect("date")
    }

    fn authority(actor: &str, action_key: &str) -> Authorization {
        Authorization::try_new(
            actor,
            action_key,
            Utc.with_ymd_and_hms(2026, 9, 15, 9, 0, 0).unwrap(),
            "the reader would not take her thumb on Monday",
        )
        .expect("authorization")
    }

    fn employee() -> EmployeeId {
        EmployeeId::try_new("emp-1").expect("employee id")
    }

    fn unit() -> UnitId {
        UnitId::try_new("store-07").expect("unit id")
    }

    fn open_period() -> AttendancePeriod {
        AttendancePeriod::open(unit(), AttendanceMonth::try_new(2026, 9).unwrap())
    }

    fn closed_period() -> AttendancePeriod {
        let mut period = open_period();
        period
            .close(
                CloseReadiness::CLEAR,
                authority("hr.officer", actions::ATTENDANCE_PERIOD_CLOSE),
            )
            .expect("close");
        period
    }

    fn arrival_at(minute: u16) -> CorrectionEffect {
        CorrectionEffect::Arrival {
            at: PunchTime::same_day(date(DAY), MinuteOfDay::try_new(minute).unwrap()),
        }
    }

    fn request(id: &str, actor: &str, supersedes: Option<&str>) -> Correction {
        Correction::request(
            CorrectionId::try_new(id).unwrap(),
            employee(),
            unit(),
            date(DAY),
            arrival_at(8 * 60),
            supersedes
                .map(CorrectionId::try_new)
                .transpose()
                .expect("lineage"),
            authority(actor, actions::CORRECTION_REQUEST),
        )
        .expect("request")
    }

    fn chain() -> CorrectionChain {
        CorrectionChain::new(employee(), unit(), date(DAY))
    }

    #[test]
    fn an_approved_correction_becomes_the_one_in_force() {
        let mut chain = chain();
        let period = open_period();
        chain
            .submit(request("cor-1", "manager", None), &period)
            .expect("submit");
        assert!(chain.pending().is_some());
        assert!(chain.effective().is_none(), "a request is not a decision");
        chain
            .approve(authority("hr.officer", actions::CORRECTION_DECIDE), &period)
            .expect("approve");
        assert!(chain.pending().is_none());
        assert_eq!(
            chain.effective().map(|held| held.id().to_string()),
            Some("cor-1".to_owned())
        );
    }

    /// Two people, not one. The rule is added rather than ported, and it is the
    /// same rule the payroll run carries: a control one person can complete
    /// alone is a record of a signature.
    #[test]
    fn the_requester_may_not_decide_their_own_correction() {
        let mut chain = chain();
        let period = open_period();
        chain
            .submit(request("cor-1", "manager", None), &period)
            .expect("submit");
        assert!(matches!(
            chain.approve(authority("manager", actions::CORRECTION_DECIDE), &period),
            Err(AttendanceError::ActionForbidsCorrectionDecision { .. })
        ));
        // Somebody else can.
        assert!(chain
            .approve(authority("hr.officer", actions::CORRECTION_DECIDE), &period)
            .is_ok());
    }

    /// And the rule survives a round trip through storage, which is where a
    /// rule only the live path enforces would be laundered away.
    #[test]
    fn a_stored_correction_signed_once_by_one_person_fails_to_load() {
        let forged = serde_json::json!({
            "id": "cor-1",
            "employee": "emp-1",
            "unit": "store-07",
            "date": DAY,
            "effect": { "effect": "ARRIVAL", "at": {
                "business_date": DAY, "day_offset": 0, "minute": "08:00" } },
            "supersedes": null,
            "requested": authority("manager", actions::CORRECTION_REQUEST),
            "state": { "state": "APPROVED",
                       "decision": authority("manager", actions::CORRECTION_DECIDE) },
        });
        assert!(
            serde_json::from_value::<Correction>(forged).is_err(),
            "one name on both halves is not a control"
        );
    }

    /// A decision recorded under the key somebody used to ask is the employee
    /// approving their own correction, wearing the shape of a decision.
    #[test]
    fn a_decision_under_the_requesting_key_is_refused() {
        let mut chain = chain();
        let period = open_period();
        chain
            .submit(request("cor-1", "manager", None), &period)
            .expect("submit");
        assert!(matches!(
            chain.approve(
                authority("hr.officer", actions::CORRECTION_REQUEST),
                &period
            ),
            Err(AttendanceError::ActionForbidsCorrectionDecision { .. })
        ));
    }

    /// A queue of contradictory pending edits to one day has no defined
    /// meaning, so there is only ever one.
    #[test]
    fn only_one_request_may_be_pending_on_a_day() {
        let mut chain = chain();
        let period = open_period();
        chain
            .submit(request("cor-1", "manager", None), &period)
            .expect("submit");
        assert!(matches!(
            chain.submit(request("cor-2", "manager", None), &period),
            Err(AttendanceError::AnotherCorrectionIsPending)
        ));
    }

    /// Two people correcting the same day cannot silently clobber each other:
    /// the second must name what the first established.
    #[test]
    fn a_second_correction_must_supersede_the_one_in_force() {
        let mut chain = chain();
        let period = open_period();
        chain
            .submit(request("cor-1", "manager", None), &period)
            .expect("submit");
        chain
            .approve(authority("hr.officer", actions::CORRECTION_DECIDE), &period)
            .expect("approve");
        match chain.submit(request("cor-2", "manager", None), &period) {
            Err(AttendanceError::CorrectionSupersedesTheWrongLink { expected }) => {
                assert_eq!(expected, "cor-1");
            }
            other => panic!("expected a named lineage refusal, got {other:?}"),
        }
        assert!(chain
            .submit(request("cor-2", "manager", Some("cor-1")), &period)
            .is_ok());
    }

    /// A refusal is kept. A day whose correction was refused is a day somebody
    /// looked at, and the chain is where that is answerable.
    #[test]
    fn a_rejection_stays_in_the_chain_and_changes_nothing() {
        let mut chain = chain();
        let period = open_period();
        chain
            .submit(request("cor-1", "manager", None), &period)
            .expect("submit");
        chain
            .reject(authority("hr.officer", actions::CORRECTION_DECIDE), &period)
            .expect("reject");
        assert_eq!(chain.corrections().len(), 1);
        assert!(chain.effective().is_none());
        assert!(chain.corrections()[0].approved_effect().is_none());
        // And its lineage is clear, so the next request supersedes nothing.
        assert!(chain
            .submit(request("cor-2", "manager", None), &period)
            .is_ok());
    }

    /// Withdrawal is the requester's alone. Anybody else rejects it under their
    /// own name; a third party "withdrawing" it would dispose of the request
    /// while making the record say the requester changed their mind.
    #[test]
    fn only_the_requester_withdraws() {
        let mut chain = chain();
        let period = open_period();
        chain
            .submit(request("cor-1", "manager", None), &period)
            .expect("submit");
        assert!(matches!(
            chain.withdraw(authority("hr.officer", actions::CORRECTION_REQUEST_OWN)),
            Err(AttendanceError::CorrectionWithdrawalNotByRequester)
        ));
        assert!(chain
            .withdraw(authority("manager", actions::CORRECTION_REQUEST_OWN))
            .is_ok());
        assert!(chain.pending().is_none());
        assert!(chain.effective().is_none());
    }

    /// A settled month takes neither a new correction nor a decision on one.
    #[test]
    fn a_closed_month_refuses_a_correction_and_a_decision() {
        let mut chain = chain();
        assert!(matches!(
            chain.submit(request("cor-1", "manager", None), &closed_period()),
            Err(AttendanceError::ClosedPeriodRejectsCorrection { .. })
        ));
        // A request filed while the month was open cannot be decided after it
        // closes either: the facts payroll read are frozen.
        chain
            .submit(request("cor-1", "manager", None), &open_period())
            .expect("submit");
        assert!(matches!(
            chain.approve(
                authority("hr.officer", actions::CORRECTION_DECIDE),
                &closed_period()
            ),
            Err(AttendanceError::ClosedPeriodRejectsCorrection { .. })
        ));
    }

    /// Withdrawal needs no open month, deliberately: a pending correction has
    /// never changed an outcome, so there is nothing for a closed month to
    /// protect — and refusing it would leave a request stuck in a settled
    /// period's queue for ever.
    #[test]
    fn withdrawal_survives_the_month_closing() {
        let mut chain = chain();
        chain
            .submit(request("cor-1", "manager", None), &open_period())
            .expect("submit");
        assert!(chain
            .withdraw(authority("manager", actions::CORRECTION_REQUEST_OWN))
            .is_ok());
    }

    /// The effect cannot state an outcome and cannot state a negative day.
    #[test]
    fn a_correction_cannot_state_a_day_that_runs_backwards() {
        let backwards = Correction::request(
            CorrectionId::try_new("cor-1").unwrap(),
            employee(),
            unit(),
            date(DAY),
            CorrectionEffect::ArrivalAndDeparture {
                arrival: PunchTime::same_day(date(DAY), MinuteOfDay::try_new(16 * 60).unwrap()),
                departure: PunchTime::same_day(date(DAY), MinuteOfDay::try_new(8 * 60).unwrap()),
            },
            None,
            authority("manager", actions::CORRECTION_REQUEST),
        );
        assert!(matches!(
            backwards,
            Err(AttendanceError::CorrectionArrivalNotBeforeDeparture)
        ));
    }

    /// A corrected time filed under another day's business date would silently
    /// move work from one month to another.
    #[test]
    fn a_corrected_time_must_be_on_the_day_it_corrects() {
        let elsewhere = Correction::request(
            CorrectionId::try_new("cor-1").unwrap(),
            employee(),
            unit(),
            date(DAY),
            CorrectionEffect::Arrival {
                at: PunchTime::same_day(date("2026-08-31"), MinuteOfDay::try_new(8 * 60).unwrap()),
            },
            None,
            authority("manager", actions::CORRECTION_REQUEST),
        );
        assert!(matches!(
            elsewhere,
            Err(AttendanceError::CorrectionTargetMismatch)
        ));
    }

    /// A request filed under a key that may not file one is not a request, and
    /// the check runs on the way in from storage too.
    #[test]
    fn a_request_needs_a_requesting_key() {
        assert!(matches!(
            Correction::request(
                CorrectionId::try_new("cor-1").unwrap(),
                employee(),
                unit(),
                date(DAY),
                arrival_at(8 * 60),
                None,
                authority("manager", actions::ROSTER_MANAGE),
            ),
            Err(AttendanceError::ActionForbidsCorrectionRequest { .. })
        ));
    }

    /// A chain holding somebody else's correction is refused rather than
    /// silently answering the wrong day's question.
    #[test]
    fn a_chain_will_not_hold_another_days_correction() {
        let stray = Correction::request(
            CorrectionId::try_new("cor-9").unwrap(),
            employee(),
            unit(),
            date("2026-09-15"),
            CorrectionEffect::Arrival {
                at: PunchTime::same_day(date("2026-09-15"), MinuteOfDay::try_new(8 * 60).unwrap()),
            },
            None,
            authority("manager", actions::CORRECTION_REQUEST),
        )
        .expect("request");
        assert!(matches!(
            CorrectionChain::try_new(employee(), unit(), date(DAY), vec![stray]),
            Err(AttendanceError::CorrectionChainMismatch)
        ));
    }

    /// A stored chain with two pending requests is refused — the unique partial
    /// index in `0234` says the same thing, and this is the first copy.
    #[test]
    fn a_stored_chain_with_two_pending_requests_is_refused() {
        let first = request("cor-1", "manager", None);
        let second = request("cor-2", "manager", None);
        assert!(matches!(
            CorrectionChain::try_new(employee(), unit(), date(DAY), vec![first, second]),
            Err(AttendanceError::AnotherCorrectionIsPending)
        ));
    }
}
