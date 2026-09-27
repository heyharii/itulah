//! Every way the employment kernel can refuse.

use chrono::NaiveDate;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum EmployeeError {
    #[error("{field} is required")]
    Required { field: &'static str },
    #[error("{field} must be at most {max} characters")]
    TooLong { field: &'static str, max: usize },
    #[error("{field} must be printable text without control characters")]
    NotPrintable { field: &'static str },
    #[error("employment cannot go from {from} via {transition}")]
    IllegalTransition {
        from: &'static str,
        transition: &'static str,
    },
    #[error("recorded status {claimed} is not what the history produces ({folded})")]
    StatusDoesNotFollowHistory {
        claimed: &'static str,
        folded: &'static str,
    },
    #[error("employment event effective {effective_on} precedes the one before it")]
    EventNotForward { effective_on: NaiveDate },
    #[error("action `{action_key}` does not authorize an employment change")]
    ActionForbidsEmploymentChange { action_key: String },
    #[error("the employee-code history does not chain into the current code")]
    CodeHistoryBroken,
    #[error("assignment from {from} to {to} ends before it starts")]
    AssignmentEndsBeforeStart { from: NaiveDate, to: NaiveDate },
    #[error("assignment overlaps an existing one on {on}")]
    AssignmentOverlaps { on: NaiveDate },

    // ── person in charge ─────────────────────────────────────────────────
    #[error("only an active employee can be put in charge of a unit; this one is {status}")]
    PicNotEmployed { status: &'static str },
    #[error("a unit's person in charge must be posted there, and this one is not posted at {unit} on {on}")]
    PicNotPostedAtUnit { unit: String, on: NaiveDate },

    // ── personal data ────────────────────────────────────────────────────
    #[error("a NIK is exactly 16 digits")]
    MalformedNik,
    #[error("action `{action_key}` does not authorize a change to personal data")]
    ActionForbidsProfileChange { action_key: String },
    /// A recorded amendment whose `from` is not what the chain held, or whose
    /// result is not the current value. The same guarantee `Employee` gives for
    /// status: a row edited by hand does not load.
    #[error("the recorded amendments for {field} do not produce the current value")]
    ProfileHistoryBroken { field: &'static str },
    #[error("the amendment to {field} changes nothing")]
    ProfileAmendmentChangesNothing { field: &'static str },

    // ── contract ─────────────────────────────────────────────────────────
    #[error("action `{action_key}` does not authorize a contract change")]
    ActionForbidsContractChange { action_key: String },
    #[error("fixed term from {from} to {to} ends before it starts")]
    ContractEndsBeforeStart { from: NaiveDate, to: NaiveDate },
    #[error("a contract starting {on} overlaps the one before it")]
    ContractOverlaps { on: NaiveDate },
    /// PKWTT is open-ended, so there is no day after it for a successor to
    /// start on. Ending one is a termination, not a new contract.
    #[error("a permanent contract has no successor")]
    ContractFollowsPermanent,
}

impl EmployeeError {
    /// `(field, code)` for a validation response, when the refusal is about one
    /// input rather than about state.
    pub fn field_code(&self) -> Option<(&'static str, &'static str)> {
        match self {
            Self::Required { field } => Some((field, "required")),
            Self::TooLong { field, .. } => Some((field, "too_large")),
            Self::NotPrintable { field } => Some((field, "invalid")),
            Self::MalformedNik => Some(("nik", "invalid")),
            _ => None,
        }
    }
}
