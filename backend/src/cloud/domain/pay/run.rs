//! The payroll run, and the chain of people who sign it.
//!
//! # Two people, not one
//!
//! A run is verified and then approved, and **the same person may not do both**.
//! A control one person can complete alone is a record of a signature rather
//! than a control, and the whole reason a payroll run has states at all is that
//! somebody other than its author looked at it.
//!
//! The reference this is adapted from lets one actor do both; the rule is added
//! here rather than ported, and it is enforced on the transition *and* on the
//! way in from storage — a stored run whose verifier and approver are the same
//! name fails to hydrate rather than becoming an approved payroll.
//!
//! # What a run does not do
//!
//! Compute anything statutory. The retail backend this borrows its lifecycle
//! from carries a component engine that applies PPh 21 brackets and BPJS rates;
//! none of it is here. A slip carries the pay agreement in force and the facts
//! this system actually recorded, and the columns for computed deductions do
//! not exist — so nothing can quietly acquire a zero that reads as "nothing was
//! owed".
//!
//! # Why a run knows it is incomplete
//!
//! There is no punch source, so nothing here knows what was *worked* — only
//! what was planned, and what leave and overtime were decided. A run that
//! presented that as a finished payroll would be a run somebody paid from. So
//! [`PayrollRun::complete`] is false and [`PayrollRun::incomplete_because`]
//! says why, in a sentence a person reads on the screen.

use super::error::PayError;
use crate::cloud::domain::employment::{ActorId, Authorization, PlaceId};
use serde::{Deserialize, Serialize};

/// Where a run has got to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunState {
    /// Built, and nobody has checked it.
    Draft,
    /// Somebody has checked the figures against what they were computed from.
    Verified,
    /// Somebody *else* has approved them.
    Approved,
    /// Sealed. The figures do not move again.
    Sealed,
}

impl RunState {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Draft => "DRAFT",
            Self::Verified => "VERIFIED",
            Self::Approved => "APPROVED",
            Self::Sealed => "SEALED",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "DRAFT" => Some(Self::Draft),
            "VERIFIED" => Some(Self::Verified),
            "APPROVED" => Some(Self::Approved),
            "SEALED" => Some(Self::Sealed),
            _ => None,
        }
    }
}

/// One step of the chain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunStep {
    Verified,
    Approved,
    Sealed,
    Reopened,
}

impl RunStep {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Verified => "VERIFIED",
            Self::Approved => "APPROVED",
            Self::Sealed => "SEALED",
            Self::Reopened => "REOPENED",
        }
    }

    /// The word the refusal uses, so "a run that is APPROVED cannot be
    /// approved" reads as a sentence.
    const fn verb(self) -> &'static str {
        match self {
            Self::Verified => "verified",
            Self::Approved => "approved",
            Self::Sealed => "sealed",
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
    pub place: PlaceId,
    /// `YYYY-MM`.
    pub period: String,
    pub state: RunState,
    pub complete: bool,
    #[serde(default)]
    pub incomplete_because: Option<String>,
    #[serde(default)]
    pub history: Vec<RunEvent>,
}

/// One payroll run: one place, one month, and its chain of signatures.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PayrollRun {
    id: String,
    place: PlaceId,
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
    /// Open a run in draft.
    ///
    /// `incomplete_because` is `Some` while anything about the month is
    /// unknowable — today, always, because there is no punch source.
    pub fn draft(
        id: impl Into<String>,
        place: PlaceId,
        period: impl Into<String>,
        incomplete_because: Option<String>,
    ) -> Result<Self, PayError> {
        let id = id.into();
        if id.trim().is_empty() {
            return Err(PayError::InvalidId { field: "run id" });
        }
        Ok(Self {
            id,
            place,
            period: period.into(),
            state: RunState::Draft,
            complete: incomplete_because.is_none(),
            incomplete_because,
            history: Vec::new(),
        })
    }

    /// Rebuild from storage, re-running the machine and the two-person rule.
    ///
    /// A stored run whose verifier and approver are the same name fails to
    /// hydrate rather than becoming an approved payroll — because a rule only
    /// the live path enforces is a rule a round trip through storage removes.
    pub fn try_new(wire: PayrollRunWire) -> Result<Self, PayError> {
        let mut folded = RunState::Draft;
        let mut verifier: Option<ActorId> = None;
        for event in &wire.history {
            match (folded, event.step) {
                (RunState::Draft, RunStep::Verified) => {
                    verifier = Some(event.authorization.actor().clone());
                    folded = RunState::Verified;
                }
                (RunState::Verified, RunStep::Approved) => {
                    if verifier.as_ref() == Some(event.authorization.actor()) {
                        return Err(PayError::SameActorVerifiedAndApproved {
                            actor: event.authorization.actor().to_string(),
                        });
                    }
                    folded = RunState::Approved;
                }
                (RunState::Approved, RunStep::Sealed) => folded = RunState::Sealed,
                // A reopen returns the run to draft and clears the chain: the
                // next approval is a fresh pair of signatures, not a
                // continuation of the old one. Without clearing the verifier,
                // the person who verified before a reopen could never approve
                // afterwards — which is a rule nobody stated.
                (RunState::Verified | RunState::Approved, RunStep::Reopened) => {
                    verifier = None;
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
            place: wire.place,
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
    pub fn place(&self) -> &PlaceId {
        &self.place
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

    /// Who verified the run as it currently stands, if anybody has.
    ///
    /// Cleared by a reopen, because the next approval is a fresh pair of
    /// signatures.
    pub fn verifier(&self) -> Option<&ActorId> {
        let mut verifier = None;
        for event in &self.history {
            match event.step {
                RunStep::Verified => verifier = Some(event.authorization.actor()),
                RunStep::Reopened => verifier = None,
                _ => {}
            }
        }
        verifier
    }

    fn step(
        &mut self,
        from: RunState,
        to: RunState,
        step: RunStep,
        authorization: Authorization,
    ) -> Result<(), PayError> {
        if self.state == RunState::Sealed {
            return Err(PayError::RunSealed);
        }
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

    /// Check the figures against what they were computed from.
    pub fn verify(&mut self, authorization: Authorization) -> Result<(), PayError> {
        if !authorization.authorizes_payroll_verify() {
            return Err(PayError::ActionForbidsPayrollStep {
                action_key: authorization.action_key().to_owned(),
                step: "verification",
            });
        }
        self.step(
            RunState::Draft,
            RunState::Verified,
            RunStep::Verified,
            authorization,
        )
    }

    /// Approve a verified run.
    ///
    /// **Not the person who verified it.** The refusal is a conflict rather
    /// than a bad request: the payload is fine, and what is wrong is who is
    /// sending it.
    pub fn approve(&mut self, authorization: Authorization) -> Result<(), PayError> {
        if !authorization.authorizes_payroll_approve() {
            return Err(PayError::ActionForbidsPayrollStep {
                action_key: authorization.action_key().to_owned(),
                step: "approval",
            });
        }
        if self.verifier() == Some(authorization.actor()) {
            return Err(PayError::SameActorVerifiedAndApproved {
                actor: authorization.actor().to_string(),
            });
        }
        self.step(
            RunState::Verified,
            RunState::Approved,
            RunStep::Approved,
            authorization,
        )
    }

    /// Seal it. After this the figures do not move.
    pub fn seal(&mut self, authorization: Authorization) -> Result<(), PayError> {
        if !authorization.authorizes_payroll_seal() {
            return Err(PayError::ActionForbidsPayrollStep {
                action_key: authorization.action_key().to_owned(),
                step: "seal",
            });
        }
        self.step(
            RunState::Approved,
            RunState::Sealed,
            RunStep::Sealed,
            authorization,
        )
    }

    /// Send a run back to draft.
    ///
    /// Its own key, because it undoes work somebody has signed for. A sealed
    /// run is not reopenable at all: sealing is the point past which the
    /// figures are the figures, and a seal that could be undone would not be
    /// one.
    pub fn reopen(&mut self, authorization: Authorization) -> Result<(), PayError> {
        if !authorization.authorizes_payroll_reopen() {
            return Err(PayError::ActionForbidsPayrollStep {
                action_key: authorization.action_key().to_owned(),
                step: "reopening",
            });
        }
        if self.state == RunState::Sealed {
            return Err(PayError::RunSealed);
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
