use chrono::NaiveDate;
use thiserror::Error;

/// What the pay and payroll kernels refuse.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[non_exhaustive]
pub enum PayError {
    #[error("{field} is required")]
    Required { field: &'static str },
    #[error("{field} is not a usable identifier")]
    InvalidId { field: &'static str },
    #[error("base pay must be more than nothing")]
    BaseNotPositive,
    #[error("the {code} allowance must be worth more than nothing")]
    AllowanceNotPositive { code: String },
    #[error("the {code} allowance is named twice")]
    DuplicateAllowance { code: String },
    #[error("the pay agreement does not fit an integer")]
    PayOverflow,
    #[error("a pay record effective {effective_from} cannot be filed behind the latest, {latest}")]
    PayNotForward {
        effective_from: NaiveDate,
        latest: NaiveDate,
    },
    #[error("action `{action_key}` does not authorize changing pay")]
    ActionForbidsPayChange { action_key: String },
    #[error("{value:?} is not a PTKP status")]
    UnknownPtkp { value: String },
    #[error("{field} does not look like a {field}")]
    MalformedIdentity { field: &'static str },

    // ── the run ──────────────────────────────────────────────────────────
    #[error("action `{action_key}` does not authorize a payroll {step}")]
    ActionForbidsPayrollStep {
        action_key: String,
        step: &'static str,
    },
    #[error("a run that is {state} cannot be {step}")]
    RunNotInState {
        state: &'static str,
        step: &'static str,
    },
    /// The two-person rule, in the shape the work actually has: the place
    /// submits and head office approves, and one name cannot be both.
    #[error("{actor} submitted this run and may not also approve it")]
    SameActorSubmittedAndApproved { actor: String },
    #[error("the attendance for {place} in {period} is not closed")]
    AttendanceNotClosed { place: String, period: String },
    #[error("recorded state {claimed} is not what the history produces ({folded})")]
    RunStateDoesNotFollowHistory {
        claimed: &'static str,
        folded: &'static str,
    },

    // ── the handover to Finance ──────────────────────────────────────────
    /// The header must agree with its lines — the rule the journal enforces on
    /// itself at COMMIT, for the reason 0051 gives: a total with no evidence
    /// behind it is what somebody has to explain from memory later.
    #[error("the liability is {header} but its breakdown adds up to {lines}")]
    HandoverDoesNotAddUp { header: i64, lines: i64 },
    #[error("{employee_id} is owed nothing, so there is no line to hand over")]
    HandoverLineNotPositive { employee_id: String },
    #[error("{employee_id} appears twice in the breakdown")]
    HandoverNamesSomebodyTwice { employee_id: String },
    /// Not a liability of nought. Nobody at the place has a pay agreement yet,
    /// and a row claiming the company owes nothing is a claim somebody looked.
    #[error("this run has nobody on it, so there is nothing to hand to Finance")]
    NothingToHandOver,
    #[error("this liability is already recorded as paid")]
    HandoverAlreadyPaid,
}

impl PayError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Required { .. } => "pay_required",
            Self::InvalidId { .. } => "pay_invalid_id",
            Self::BaseNotPositive => "pay_base_not_positive",
            Self::AllowanceNotPositive { .. } => "pay_allowance_not_positive",
            Self::DuplicateAllowance { .. } => "pay_duplicate_allowance",
            Self::PayOverflow => "pay_overflow",
            Self::PayNotForward { .. } => "pay_not_forward",
            Self::ActionForbidsPayChange { .. } => "pay_action_forbids_change",
            Self::UnknownPtkp { .. } => "pay_unknown_ptkp",
            Self::MalformedIdentity { .. } => "pay_malformed_identity",
            Self::ActionForbidsPayrollStep { .. } => "payroll_action_forbids_step",
            Self::RunNotInState { .. } => "payroll_run_not_in_state",
            Self::SameActorSubmittedAndApproved { .. } => "payroll_same_actor",
            Self::AttendanceNotClosed { .. } => "payroll_attendance_not_closed",
            Self::RunStateDoesNotFollowHistory { .. } => "payroll_state_not_from_history",
            Self::HandoverDoesNotAddUp { .. } => "payroll_handover_does_not_add_up",
            Self::HandoverLineNotPositive { .. } => "payroll_handover_line_not_positive",
            Self::HandoverNamesSomebodyTwice { .. } => "payroll_handover_duplicate_line",
            Self::NothingToHandOver => "payroll_nothing_to_hand_over",
            Self::HandoverAlreadyPaid => "payroll_handover_already_paid",
        }
    }

    /// Whether the *record* is in the wrong state rather than the request being
    /// malformed.
    ///
    /// The two-person rule is a conflict, not a bad request: the payload is
    /// fine and what is wrong is who is sending it. Telling them to fix their
    /// request would invite them to look for the field that makes it work.
    pub const fn is_conflict(&self) -> bool {
        matches!(
            self,
            Self::PayNotForward { .. }
                | Self::RunNotInState { .. }
                | Self::SameActorSubmittedAndApproved { .. }
                | Self::AttendanceNotClosed { .. }
                | Self::NothingToHandOver
                | Self::HandoverAlreadyPaid
        )
    }

    pub const fn is_forbidden(&self) -> bool {
        matches!(
            self,
            Self::ActionForbidsPayChange { .. } | Self::ActionForbidsPayrollStep { .. }
        )
    }
}
