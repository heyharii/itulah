//! Who acted, under what authority, when, and why.
//!
//! # Why an action key and not a role
//!
//! The reference this is ported from carries its own role vocabulary
//! (`HR_OFFICER`, `HEAD_OFFICE`, `EMPLOYEE_SELF_SERVICE`) sourced from a second
//! directory of actors. We already have one ladder — `CASHIER < SUPERVISOR <
//! ADMIN` — and a second would be two answers to "may they".
//!
//! So a recorded decision names the **action key** the actor exercised, and
//! [`required_role`] is the single place that says which rung of our ladder
//! that key needs. The property the reference cared about survives exactly: an
//! employment change is not representable without naming its actor, its
//! authority and its reason, and the gate is re-checked when a stored record is
//! decoded.
//!
//! The keys are finer than the ladder can currently express — `PROFILE_READ` is
//! separate from `EMPLOYEE_READ` even though both map to a rung today. That is
//! deliberate: the distinction is real, it is recorded from the first day, and
//! the day we grow per-place grants only [`required_role`] changes. Nothing
//! stored has to be migrated, because the stored value was never the rung.

use super::error::EmployeeError;
use super::ids::{ActorId, ReasonText};
use crate::cloud::domain::Role;
use chrono::{DateTime, Utc};

/// Action keys this module understands.
///
/// Kept beside the state machine rather than in the HTTP layer because
/// [`Authorization::authorizes_employment_change`] is a *domain* rule: which
/// authority may end someone's employment is not a routing question.
pub mod actions {
    pub const EMPLOYEE_READ: &str = "people.employee.read";
    pub const EMPLOYEE_CREATE: &str = "people.employee.create";
    /// Hire, suspend, reinstate, terminate.
    pub const EMPLOYMENT_CHANGE: &str = "people.employment.change";
    /// Correct a badge/NIP without touching identity.
    pub const EMPLOYEE_CODE_CORRECT: &str = "people.employee.code_correct";
    pub const ASSIGNMENT_MANAGE: &str = "people.assignment.manage";
    /// Bind an employment record to a login account.
    pub const ACCOUNT_LINK: &str = "people.account.link";
    /// Read personal data — name, NIK, address, contact, date of birth.
    ///
    /// Separate from [`EMPLOYEE_READ`] on purpose. "Who is on shift" and "what
    /// is this person's NIK and home address" are different questions with
    /// different audiences, and one grant answering both is how a rota screen
    /// ends up exposing a national identity number.
    pub const PROFILE_READ: &str = "people.profile.read";
    /// Change personal data.
    pub const PROFILE_CHANGE: &str = "people.profile.change";
    /// Sign, renew or amend an employment contract.
    pub const CONTRACT_CHANGE: &str = "people.contract.change";

    /// The keys that may move the employment state machine.
    pub const EMPLOYMENT_CHANGING: &[&str] = &[EMPLOYMENT_CHANGE];
    /// The keys that may change personal data.
    pub const PROFILE_CHANGING: &[&str] = &[PROFILE_CHANGE];
    /// The keys that may write a contract.
    pub const CONTRACT_CHANGING: &[&str] = &[CONTRACT_CHANGE];
}

/// Which rung of the ladder an action key needs.
///
/// Reading the roster is supervisor work — a shop's manager has to know who is
/// on today. Everything else is head office: hiring, ending employment, moving
/// somebody between shops, and reading a NIK are all things a shift supervisor
/// has no business doing from a till.
///
/// The unknown key maps to `Admin` rather than to a permissive default. A key
/// this function has not been taught about is a bug, and the safe reading of a
/// bug is "nobody", not "everybody".
pub fn required_role(action_key: &str) -> Role {
    match action_key {
        actions::EMPLOYEE_READ => Role::Supervisor,
        _ => Role::Admin,
    }
}

/// One authorized decision, as recorded.
///
/// Of its parts only the reason is the caller's to supply: the actor comes from
/// the session, the action key from the authorization decision, and the instant
/// from the server clock. The constructors take them separately so a handler
/// cannot accept an authority from a request body.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Authorization {
    actor: ActorId,
    action_key: String,
    at: DateTime<Utc>,
    reason: ReasonText,
}

impl Authorization {
    pub fn new(
        actor: ActorId,
        action_key: impl Into<String>,
        at: DateTime<Utc>,
        reason: ReasonText,
    ) -> Self {
        Self {
            actor,
            action_key: action_key.into(),
            at,
            reason,
        }
    }

    pub fn try_new(
        actor: &str,
        action_key: &str,
        at: DateTime<Utc>,
        reason: &str,
    ) -> Result<Self, EmployeeError> {
        Ok(Self::new(
            ActorId::try_new(actor)?,
            action_key,
            at,
            ReasonText::try_new(reason)?,
        ))
    }

    pub fn actor(&self) -> &ActorId {
        &self.actor
    }

    pub fn action_key(&self) -> &str {
        &self.action_key
    }

    pub fn at(&self) -> DateTime<Utc> {
        self.at
    }

    pub fn reason(&self) -> &ReasonText {
        &self.reason
    }

    /// May this authority move the employment state machine?
    ///
    /// Re-checked on decode as well as on the live path. A rule only the live
    /// path enforces is a rule that a round trip through storage removes.
    pub fn authorizes_employment_change(&self) -> bool {
        actions::EMPLOYMENT_CHANGING.contains(&self.action_key.as_str())
    }

    /// May this authority change personal data?
    ///
    /// Re-checked on decode, like the employment gate: an amendment that no
    /// grant covers must not become history by way of a stored row.
    pub fn authorizes_profile_change(&self) -> bool {
        actions::PROFILE_CHANGING.contains(&self.action_key.as_str())
    }

    /// May this authority write a contract?
    pub fn authorizes_contract_change(&self) -> bool {
        actions::CONTRACT_CHANGING.contains(&self.action_key.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reading_the_roster_is_supervisor_work_and_everything_else_is_head_office() {
        assert_eq!(required_role(actions::EMPLOYEE_READ), Role::Supervisor);
        assert_eq!(required_role(actions::PROFILE_READ), Role::Admin);
        assert_eq!(required_role(actions::EMPLOYMENT_CHANGE), Role::Admin);
        assert_eq!(required_role(actions::CONTRACT_CHANGE), Role::Admin);
    }

    /// A key nobody taught this function about must not be a way in.
    #[test]
    fn an_unknown_action_key_admits_nobody_below_admin() {
        assert_eq!(required_role("people.payroll.release"), Role::Admin);
        assert_eq!(required_role(""), Role::Admin);
    }

    #[test]
    fn only_the_employment_key_moves_employment() {
        let at = DateTime::from_timestamp(1_780_000_000, 0).expect("instant");
        let change =
            Authorization::try_new("hr.dewi", actions::EMPLOYMENT_CHANGE, at, "mulai kerja")
                .expect("authorization");
        assert!(change.authorizes_employment_change());
        assert!(!change.authorizes_profile_change());

        let read = Authorization::try_new("hr.dewi", actions::EMPLOYEE_READ, at, "melihat")
            .expect("authorization");
        assert!(!read.authorizes_employment_change());
    }

    /// The reason is the caller's to state, and a blank one is not a reason.
    #[test]
    fn a_decision_without_a_reason_is_not_representable() {
        let at = DateTime::from_timestamp(1_780_000_000, 0).expect("instant");
        assert!(Authorization::try_new("hr.dewi", actions::EMPLOYMENT_CHANGE, at, "   ").is_err());
        assert!(Authorization::try_new("", actions::EMPLOYMENT_CHANGE, at, "alasan").is_err());
    }
}
