//! Employment identity and the employment-status state machine.
//!
//! ```text
//!        ┌───────────┐
//!        │ Candidate │
//!        └─────┬─────┘
//!         hire │      terminate (offer withdrawn)
//!              ▼            └──────────┐
//!        ┌───────────┐                 │
//!    ┌──▶│  Active   │──terminate──┐   │
//!    │   └─────┬─────┘             │   │
//!    │ suspend │                   ▼   ▼
//!    │         ▼             ┌────────────┐
//!    └─┬─ ┌───────────┐      │ Terminated │  terminal
//! reinstate│ Suspended │─term─▶└────────────┘
//!          └───────────┘
//! ```
//!
//! Identity ([`EmployeeId`]) is opaque and never recycled. The human-facing
//! [`EmployeeCode`] is a *code* and may be corrected without changing identity,
//! which is why nothing keys on it.

use super::audit::Authorization;
use super::error::EmployeeError;
use super::ids::{EmployeeCode, EmployeeId};
use chrono::NaiveDate;
use core::fmt;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EmploymentStatus {
    /// Accepted but not yet started. Exists so onboarding can be recorded
    /// before there is an employee who can act.
    Candidate,
    /// Employed and working.
    Active,
    /// Employment paused (investigation, unpaid suspension). The record and its
    /// history survive; the person is not currently working.
    Suspended,
    /// Employment ended, for any reason. Terminal.
    Terminated,
}

impl EmploymentStatus {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Candidate => "CANDIDATE",
            Self::Active => "ACTIVE",
            Self::Suspended => "SUSPENDED",
            Self::Terminated => "TERMINATED",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "CANDIDATE" => Some(Self::Candidate),
            "ACTIVE" => Some(Self::Active),
            "SUSPENDED" => Some(Self::Suspended),
            "TERMINATED" => Some(Self::Terminated),
            _ => None,
        }
    }

    /// May this person be selected for new work — a new assignment, a mention,
    /// a shift? Only `Active`.
    ///
    /// This is the question the rest of the system should ask, and it is why it
    /// must ask employment rather than account status: an account is usually
    /// disabled some days *after* somebody leaves, and that gap is the hole.
    pub const fn is_selectable(self) -> bool {
        matches!(self, Self::Active)
    }

    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Terminated)
    }
}

impl fmt::Display for EmploymentStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EmploymentTransition {
    Hire,
    Suspend,
    Reinstate,
    Terminate,
}

impl EmploymentTransition {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Hire => "HIRE",
            Self::Suspend => "SUSPEND",
            Self::Reinstate => "REINSTATE",
            Self::Terminate => "TERMINATE",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "HIRE" => Some(Self::Hire),
            "SUSPEND" => Some(Self::Suspend),
            "REINSTATE" => Some(Self::Reinstate),
            "TERMINATE" => Some(Self::Terminate),
            _ => None,
        }
    }
}

impl fmt::Display for EmploymentTransition {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

/// The transition table. The single place the machine is defined.
fn transition_target(
    from: EmploymentStatus,
    transition: EmploymentTransition,
) -> Result<EmploymentStatus, EmployeeError> {
    use EmploymentStatus::*;
    use EmploymentTransition::*;
    let target = match (from, transition) {
        (Candidate, Hire) => Active,
        (Active, Suspend) => Suspended,
        (Suspended, Reinstate) => Active,
        // Terminating from Candidate is a withdrawn offer; from Active or
        // Suspended it is a departure. All three are the same terminal state.
        (Candidate | Active | Suspended, Terminate) => Terminated,
        _ => {
            return Err(EmployeeError::IllegalTransition {
                from: from.code(),
                transition: transition.code(),
            })
        }
    };
    Ok(target)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmploymentEvent {
    transition: EmploymentTransition,
    from: EmploymentStatus,
    to: EmploymentStatus,
    effective_on: NaiveDate,
    authorization: Authorization,
}

impl EmploymentEvent {
    pub fn transition(&self) -> EmploymentTransition {
        self.transition
    }
    pub fn from(&self) -> EmploymentStatus {
        self.from
    }
    pub fn to(&self) -> EmploymentStatus {
        self.to
    }
    pub fn effective_on(&self) -> NaiveDate {
        self.effective_on
    }
    pub fn authorization(&self) -> &Authorization {
        &self.authorization
    }
}

/// A badge/NIP correction. Identity does not move; only the code does.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmployeeCodeCorrection {
    from: EmployeeCode,
    to: EmployeeCode,
    authorization: Authorization,
}

impl EmployeeCodeCorrection {
    pub fn from(&self) -> &EmployeeCode {
        &self.from
    }
    pub fn to(&self) -> &EmployeeCode {
        &self.to
    }
    pub fn authorization(&self) -> &Authorization {
        &self.authorization
    }
}

/// One person's employment record.
///
/// `status` is not independent data: it is the fold of `history`, and
/// [`Employee::try_new`] re-runs that fold. A payload — or a database row —
/// cannot claim a status its history does not produce.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "EmployeeWire")]
pub struct Employee {
    id: EmployeeId,
    code: EmployeeCode,
    status: EmploymentStatus,
    history: Vec<EmploymentEvent>,
    code_history: Vec<EmployeeCodeCorrection>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmployeeWire {
    id: EmployeeId,
    code: EmployeeCode,
    status: EmploymentStatus,
    history: Vec<EmploymentEvent>,
    #[serde(default)]
    code_history: Vec<EmployeeCodeCorrection>,
}

impl TryFrom<EmployeeWire> for Employee {
    type Error = EmployeeError;
    fn try_from(value: EmployeeWire) -> Result<Self, Self::Error> {
        Employee::try_new(
            value.id,
            value.code,
            value.status,
            value.history,
            value.code_history,
        )
    }
}

impl Employee {
    /// Register a person as a [`EmploymentStatus::Candidate`].
    ///
    /// Registration takes no authorization: nothing has happened to the
    /// person's employment yet. Every *transition* from here does.
    pub fn register(id: EmployeeId, code: EmployeeCode) -> Self {
        Self {
            id,
            code,
            status: EmploymentStatus::Candidate,
            history: Vec::new(),
            code_history: Vec::new(),
        }
    }

    pub fn try_register(id: &str, code: &str) -> Result<Self, EmployeeError> {
        Ok(Self::register(
            EmployeeId::try_new(id)?,
            EmployeeCode::try_new(code)?,
        ))
    }

    /// Rebuild from stored parts, re-running the machine over the history.
    ///
    /// Rejects: an event whose `from` disagrees with the fold, a transition the
    /// table forbids, an event whose `to` is not the table's target, an event
    /// effective before the one preceding it, an event authorized by an action
    /// key that may not change employment, a claimed status the history does
    /// not produce, and a code history that does not chain into the claimed
    /// code.
    ///
    /// What decode *cannot* re-check is that the recorded actor genuinely held
    /// that action key: a recorded authorization is history, not authority.
    pub fn try_new(
        id: EmployeeId,
        code: EmployeeCode,
        status: EmploymentStatus,
        history: Vec<EmploymentEvent>,
        code_history: Vec<EmployeeCodeCorrection>,
    ) -> Result<Self, EmployeeError> {
        let mut folded = EmploymentStatus::Candidate;
        let mut previous: Option<NaiveDate> = None;
        for event in &history {
            if !event.authorization.authorizes_employment_change() {
                return Err(EmployeeError::ActionForbidsEmploymentChange {
                    action_key: event.authorization.action_key().to_string(),
                });
            }
            if event.from != folded {
                return Err(EmployeeError::IllegalTransition {
                    from: folded.code(),
                    transition: event.transition.code(),
                });
            }
            let target = transition_target(folded, event.transition)?;
            if event.to != target {
                return Err(EmployeeError::IllegalTransition {
                    from: folded.code(),
                    transition: event.transition.code(),
                });
            }
            // Monotonicity is what makes `status_on` well defined: the fold up
            // to a date is the same prefix however it is traversed.
            if previous.is_some_and(|previous| event.effective_on < previous) {
                return Err(EmployeeError::EventNotForward {
                    effective_on: event.effective_on,
                });
            }
            previous = Some(event.effective_on);
            folded = target;
        }
        if folded != status {
            return Err(EmployeeError::StatusDoesNotFollowHistory {
                claimed: status.code(),
                folded: folded.code(),
            });
        }
        for correction in &code_history {
            if !correction.authorization.authorizes_employment_change()
                && correction.authorization.action_key()
                    != super::audit::actions::EMPLOYEE_CODE_CORRECT
            {
                return Err(EmployeeError::ActionForbidsEmploymentChange {
                    action_key: correction.authorization.action_key().to_string(),
                });
            }
        }
        for window in code_history.windows(2) {
            if window[0].to != window[1].from {
                return Err(EmployeeError::CodeHistoryBroken);
            }
        }
        if let Some(last) = code_history.last() {
            if last.to != code {
                return Err(EmployeeError::CodeHistoryBroken);
            }
        }
        Ok(Self {
            id,
            code,
            status,
            history,
            code_history,
        })
    }

    pub fn id(&self) -> &EmployeeId {
        &self.id
    }
    pub fn code(&self) -> &EmployeeCode {
        &self.code
    }
    pub fn status(&self) -> EmploymentStatus {
        self.status
    }
    pub fn history(&self) -> &[EmploymentEvent] {
        &self.history
    }
    pub fn code_history(&self) -> &[EmployeeCodeCorrection] {
        &self.code_history
    }

    /// Apply a transition. The only way the status moves.
    ///
    /// Returns nothing: the event it appended is the last of [`Self::history`],
    /// and handing back a reference meant proving to the compiler that a vector
    /// just pushed to is non-empty — a panic sitting in the type for the sake of
    /// a value no caller uses.
    pub fn apply(
        &mut self,
        transition: EmploymentTransition,
        effective_on: NaiveDate,
        authorization: Authorization,
    ) -> Result<(), EmployeeError> {
        if !authorization.authorizes_employment_change() {
            return Err(EmployeeError::ActionForbidsEmploymentChange {
                action_key: authorization.action_key().to_string(),
            });
        }
        if let Some(last) = self.history.last() {
            if effective_on < last.effective_on {
                return Err(EmployeeError::EventNotForward { effective_on });
            }
        }
        let target = transition_target(self.status, transition)?;
        self.history.push(EmploymentEvent {
            transition,
            from: self.status,
            to: target,
            effective_on,
            authorization,
        });
        self.status = target;
        Ok(())
    }

    /// Correct the badge/NIP. Identity is untouched.
    pub fn correct_code(
        &mut self,
        to: EmployeeCode,
        authorization: Authorization,
    ) -> Result<(), EmployeeError> {
        if authorization.action_key() != super::audit::actions::EMPLOYEE_CODE_CORRECT
            && !authorization.authorizes_employment_change()
        {
            return Err(EmployeeError::ActionForbidsEmploymentChange {
                action_key: authorization.action_key().to_string(),
            });
        }
        self.code_history.push(EmployeeCodeCorrection {
            from: self.code.clone(),
            to: to.clone(),
            authorization,
        });
        self.code = to;
        Ok(())
    }

    /// Status as of a date: the fold of every event effective on or before it.
    pub fn status_on(&self, date: NaiveDate) -> EmploymentStatus {
        self.history
            .iter()
            .take_while(|event| event.effective_on <= date)
            .fold(EmploymentStatus::Candidate, |_, event| event.to)
    }
}
