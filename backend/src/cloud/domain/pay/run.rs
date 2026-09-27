//! The payroll run: the place asks for it, head office decides it.
//!
//! # Three states, because there were four and one of them was a ceremony
//!
//! `DRAFT` → `SUBMITTED` → `APPROVED`, and that is all. The run this replaced
//! had a `VERIFIED` step between the first two and a `SEALED` one after the
//! last, and both were head office's — so head office checked its own figures,
//! approved them, and then locked them, which is one person's opinion recorded
//! three times.
//!
//! Hari's decision, 2026-09-13: **the place that employs the staff submits the
//! batch, and head office decides it.** So the first signature moved to the
//! store, the middle step went with it, and `SEALED` went because approval is
//! already final — a state whose only content is "and we mean it" is a state
//! nobody can tell from the one before it. What sealing was reaching for is
//! held by [`PayrollRun::reopen`] being head office's and by the reopen being
//! written down.
//!
//! # Two people, not one — now in the shape the work actually has
//!
//! A run is submitted and then approved, and **the same person may not do
//! both**. That was the rule when the two signatures were verify and approve,
//! and it is the rule now that they are submit and approve; what changed is
//! that the two actors are no longer both at head office, which is the version
//! of this control that means something. A control one person can complete
//! alone is a record of a signature rather than a control.
//!
//! It is enforced on the transition *and* on the way in from storage — a
//! stored run whose submitter and approver carry one name fails to hydrate
//! rather than becoming an approved payroll. A rule only the live path enforces
//! is a rule a round trip through storage removes.
//!
//! # A reopen undoes an approval, and says so
//!
//! Head office may send an approved run back to draft. Hari accepted
//! explicitly that this can happen after Finance has booked the handoff, so
//! there is **no guard here that refuses it** — the honest design is to let it
//! happen and record it, because a company that needs to correct a paid month
//! needs to correct it, and a guard would only push the correction somewhere
//! nothing is written down. What Finance was handed is snapshotted at the
//! moment of the handoff (see `postgres::pay`), so the booked figure survives
//! the run moving underneath it.
//!
//! A reopen also clears the chain: the next approval is a fresh pair of
//! signatures, not a continuation of the old one. Without clearing the
//! submitter, the person who submitted before a reopen could never approve
//! afterwards — a rule nobody stated.
//!
//! # What a run does not do
//!
//! Compute anything statutory. The retail backend this borrows its lifecycle
//! from carries a component engine that applies PPh 21 brackets and BPJS
//! rates; none of it is here. A slip carries the pay agreement in force and the
//! facts this system actually recorded, and the columns for computed deductions
//! do not exist — so nothing can quietly acquire a zero that reads as "nothing
//! was owed". The handoff to Finance is **gross only** for the same reason.
//!
//! # Why a run knows it is incomplete
//!
//! There is no punch source, so nothing here knows what was *worked* — only
//! what was planned, and what leave and overtime were decided. A run that
//! presented that as a finished payroll would be a run somebody paid from. So
//! [`PayrollRun::complete`] is false and [`PayrollRun::incomplete_because`]
//! says why, in a sentence a person reads on the screen.

use super::error::PayError;
use crate::cloud::domain::employment::{ActorId, Authorization, UnitId};
use serde::{Deserialize, Serialize};

/// Where a run has got to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunState {
    /// The place is still building it.
    Draft,
    /// The place has sent it, figures and all, and stands behind them.
    Submitted,
    /// Head office has decided. **Final** — there is no state after this.
    Approved,
}

impl RunState {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Draft => "DRAFT",
            Self::Submitted => "SUBMITTED",
            Self::Approved => "APPROVED",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "DRAFT" => Some(Self::Draft),
            "SUBMITTED" => Some(Self::Submitted),
            "APPROVED" => Some(Self::Approved),
            _ => None,
        }
    }
}

/// One step of the chain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunStep {
    Submitted,
    Approved,
    Reopened,
}

impl RunStep {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Submitted => "SUBMITTED",
            Self::Approved => "APPROVED",
            Self::Reopened => "REOPENED",
        }
    }

    /// The word the refusal uses, so "a run that is APPROVED cannot be
    /// approved" reads as a sentence.
    const fn verb(self) -> &'static str {
        match self {
            Self::Submitted => "submitted",
            Self::Approved => "approved",
            Self::Reopened => "reopened",
        }
    }
}

/// One recorded step, with the authority behind it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunEvent {
    step: RunStep,
    authorization: Authorization,
}

impl RunEvent {
    pub const fn step(&self) -> RunStep {
        self.step
    }
    pub const fn authorization(&self) -> &Authorization {
        &self.authorization
    }
}

/// The stored shape, so a run re-runs its own machine.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PayrollRunWire {
    pub id: String,
    pub unit: UnitId,
    /// `YYYY-MM`.
    pub period: String,
    pub state: RunState,
    pub complete: bool,
    #[serde(default)]
    pub incomplete_because: Option<String>,
    #[serde(default)]
    pub history: Vec<RunEvent>,
}

/// One payroll run: one place, one month, and its two signatures.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PayrollRun {
    id: String,
    unit: UnitId,
    period: String,
    state: RunState,
    complete: bool,
    incomplete_because: Option<String>,
    history: Vec<RunEvent>,
}

impl<'de> Deserialize<'de> for PayrollRun {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = PayrollRunWire::deserialize(deserializer)?;
        Self::try_new(wire).map_err(serde::de::Error::custom)
    }
}

impl PayrollRun {
    /// Open a run in draft. The place's act, for its own unit.
    ///
    /// `incomplete_because` is `Some` while anything about the month is
    /// unknowable — today, always, because there is no punch source.
    pub fn draft(
        id: impl Into<String>,
        unit: UnitId,
        period: impl Into<String>,
        incomplete_because: Option<String>,
    ) -> Result<Self, PayError> {
        let id = id.into();
        if id.trim().is_empty() {
            return Err(PayError::InvalidId { field: "run id" });
        }
        Ok(Self {
            id,
            unit,
            period: period.into(),
            state: RunState::Draft,
            complete: incomplete_because.is_none(),
            incomplete_because,
            history: Vec::new(),
        })
    }

    /// Rebuild from storage, re-running the machine and the two-person rule.
    ///
    /// A stored run whose submitter and approver are the same name fails to
    /// hydrate rather than becoming an approved payroll — because a rule only
    /// the live path enforces is a rule a round trip through storage removes.
    pub fn try_new(wire: PayrollRunWire) -> Result<Self, PayError> {
        let mut folded = RunState::Draft;
        let mut submitter: Option<ActorId> = None;
        for event in &wire.history {
            match (folded, event.step) {
                (RunState::Draft, RunStep::Submitted) => {
                    submitter = Some(event.authorization.actor().clone());
                    folded = RunState::Submitted;
                }
                (RunState::Submitted, RunStep::Approved) => {
                    if submitter.as_ref() == Some(event.authorization.actor()) {
                        return Err(PayError::SameActorSubmittedAndApproved {
                            actor: event.authorization.actor().to_string(),
                        });
                    }
                    folded = RunState::Approved;
                }
                // A reopen returns the run to draft and clears the chain. From
                // `SUBMITTED` it is head office handing the batch back to the
                // place; from `APPROVED` it undoes a decision — including one
                // Finance has already booked, which Hari accepted explicitly.
                (RunState::Submitted | RunState::Approved, RunStep::Reopened) => {
                    submitter = None;
                    folded = RunState::Draft;
                }
                (state, step) => {
                    return Err(PayError::RunNotInState {
                        state: state.code(),
                        step: step.verb(),
                    });
                }
            }
        }
        if folded != wire.state {
            return Err(PayError::RunStateDoesNotFollowHistory {
                claimed: wire.state.code(),
                folded: folded.code(),
            });
        }
        if wire.complete != wire.incomplete_because.is_none() {
            return Err(PayError::Required {
                field: "incomplete_because",
            });
        }
        Ok(Self {
            id: wire.id,
            unit: wire.unit,
            period: wire.period,
            state: wire.state,
            complete: wire.complete,
            incomplete_because: wire.incomplete_because,
            history: wire.history,
        })
    }

    pub fn id(&self) -> &str {
        &self.id
    }
    pub fn unit(&self) -> &UnitId {
        &self.unit
    }
    pub fn period(&self) -> &str {
        &self.period
    }
    pub const fn state(&self) -> RunState {
        self.state
    }
    pub const fn complete(&self) -> bool {
        self.complete
    }
    pub fn incomplete_because(&self) -> Option<&str> {
        self.incomplete_because.as_deref()
    }
    pub fn history(&self) -> &[RunEvent] {
        &self.history
    }

    /// Who submitted the run as it currently stands, if anybody has.
    ///
    /// Cleared by a reopen, because the next approval is a fresh pair of
    /// signatures.
    pub fn submitter(&self) -> Option<&ActorId> {
        let mut submitter = None;
        for event in &self.history {
            match event.step {
                RunStep::Submitted => submitter = Some(event.authorization.actor()),
                RunStep::Reopened => submitter = None,
                _ => {}
            }
        }
        submitter
    }

    /// Who approved it, if anybody has and no reopen has undone it.
    ///
    /// Cleared by a reopen for the same reason the submitter is: an approval
    /// that has been undone is not an approval, and a screen that still showed
    /// the name would be showing a decision nobody is standing behind.
    pub fn approver(&self) -> Option<&ActorId> {
        let mut approver = None;
        for event in &self.history {
            match event.step {
                RunStep::Approved => approver = Some(event.authorization.actor()),
                RunStep::Reopened => approver = None,
                _ => {}
            }
        }
        approver
    }

    fn step(
        &mut self,
        from: RunState,
        to: RunState,
        step: RunStep,
        authorization: Authorization,
    ) -> Result<(), PayError> {
        if self.state != from {
            return Err(PayError::RunNotInState {
                state: self.state.code(),
                step: step.verb(),
            });
        }
        self.state = to;
        self.history.push(RunEvent {
            step,
            authorization,
        });
        Ok(())
    }

    /// Send the batch to head office.
    ///
    /// The place's act, and the first of the two signatures. The place sees the
    /// figures it is submitting — Hari's decision, taken twice — so this is a
    /// person saying "these are my staff and this is what they are owed",
    /// which is the only reading under which the second signature adds
    /// anything.
    pub fn submit(&mut self, authorization: Authorization) -> Result<(), PayError> {
        if !authorization.authorizes_payroll_submit() {
            return Err(PayError::ActionForbidsPayrollStep {
                action_key: authorization.action_key().to_owned(),
                step: "submission",
            });
        }
        self.step(
            RunState::Draft,
            RunState::Submitted,
            RunStep::Submitted,
            authorization,
        )
    }

    /// Approve a submitted run. Head office's, and **final**.
    ///
    /// **Not the person who submitted it.** The refusal is a conflict rather
    /// than a bad request: the payload is fine, and what is wrong is who is
    /// sending it.
    pub fn approve(&mut self, authorization: Authorization) -> Result<(), PayError> {
        if !authorization.authorizes_payroll_approve() {
            return Err(PayError::ActionForbidsPayrollStep {
                action_key: authorization.action_key().to_owned(),
                step: "approval",
            });
        }
        if self.submitter() == Some(authorization.actor()) {
            return Err(PayError::SameActorSubmittedAndApproved {
                actor: authorization.actor().to_string(),
            });
        }
        self.step(
            RunState::Submitted,
            RunState::Approved,
            RunStep::Approved,
            authorization,
        )
    }

    /// Send a run back to draft. Head office's.
    ///
    /// Its own key, because it undoes work somebody has signed for — and after
    /// an approval it may undo work **Finance has already booked**. Hari
    /// accepted that consequence explicitly, so there is deliberately no guard
    /// here that asks Finance first. The handoff keeps its own snapshot of what
    /// it handed over, so the booked figure does not move when this does; what
    /// this does instead is record, in the history, that somebody undid a
    /// decision the ledger had already acted on.
    pub fn reopen(&mut self, authorization: Authorization) -> Result<(), PayError> {
        if !authorization.authorizes_payroll_reopen() {
            return Err(PayError::ActionForbidsPayrollStep {
                action_key: authorization.action_key().to_owned(),
                step: "reopening",
            });
        }
        if matches!(self.state, RunState::Draft) {
            return Err(PayError::RunNotInState {
                state: self.state.code(),
                step: RunStep::Reopened.verb(),
            });
        }
        self.state = RunState::Draft;
        self.history.push(RunEvent {
            step: RunStep::Reopened,
            authorization,
        });
        Ok(())
    }
}
