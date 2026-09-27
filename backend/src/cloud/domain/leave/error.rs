use chrono::NaiveDate;
use thiserror::Error;

/// What the leave kernel refuses.
///
/// Two of these are worth reading twice. [`LeaveError::NotBalanceBacked`]
/// answers "how many sick days are left" with a refusal rather than with `0`,
/// because `0` is a number somebody can decline leave with and the law does not
/// allow it to be declined on those grounds. [`LeaveError::PolicyNotRatified`]
/// names the question nobody has answered rather than falling back on a default
/// somebody typed once — a balance folded under rules nobody wrote down is a
/// number with no author.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[non_exhaustive]
pub enum LeaveError {
    #[error("a leave amount of {centidays:?} centidays is out of range")]
    AmountOutOfRange { centidays: Option<i32> },
    #[error("{field} is not a usable identifier")]
    InvalidId { field: &'static str },
    #[error("{to} is before {from}")]
    BackwardsRange { from: NaiveDate, to: NaiveDate },
    #[error("{field} must be positive")]
    NotPositive { field: &'static str },
    #[error("a ledger entry on {next} cannot follow one on {previous}")]
    OutOfOrder {
        previous: NaiveDate,
        next: NaiveDate,
    },
    #[error("the ledger already holds an entry {id}")]
    DuplicateEntry { id: String },
    #[error(
        "no ratified policy answers: {question} — head office must decide before this can be \
         computed"
    )]
    PolicyNotRatified { question: &'static str },
    #[error("requested {requested_centidays} centidays against {available_centidays} available")]
    InsufficientBalance {
        requested_centidays: i32,
        available_centidays: i32,
    },
    #[error("{leave_type} draws on no balance, so it has none to report")]
    NotBalanceBacked { leave_type: String },
    #[error("{leave_type} is already defined")]
    DuplicateLeaveType { leave_type: String },
    #[error("{leave_type} is not a kind of leave anybody has defined")]
    UnknownLeaveType { leave_type: String },
    #[error("{leave_type} is bounded by a certificate and must require one")]
    CertifiedLeaveWithoutEvidence { leave_type: String },
    #[error("action `{action_key}` does not authorize a leave request")]
    ActionForbidsRequest { action_key: String },
    #[error("action `{action_key}` does not authorize a leave decision")]
    ActionForbidsDecision { action_key: String },
    #[error("{leave_type} requires supporting evidence")]
    EvidenceRequired { leave_type: String },
    #[error("every day from {from} to {to} is a holiday or a rest day")]
    NoChargeableDays { from: NaiveDate, to: NaiveDate },
    #[error(
        "{leave_type} allows {max_days} centidays per occurrence, and {requested_days} days were \
         asked for"
    )]
    ExceedsPerOccurrenceLimit {
        leave_type: String,
        requested_days: usize,
        max_days: i32,
    },
    #[error("{date} is charged but is outside the period asked for")]
    ChargeableDayOutsidePeriod { date: NaiveDate },
    #[error("the request is {state} and only a pending request can be decided")]
    RequestNotPending { state: &'static str },
    #[error("only the person who filed a request may withdraw it")]
    WithdrawalNotByRequester,
    #[error("a request is decided by somebody other than the person who filed it")]
    DecisionByRequester,
    #[error("{leave_type} draws on a balance, so approving it needs one")]
    BalanceContextRequired { leave_type: String },
    #[error("{leave_type} draws on a balance and this approval deducted nothing")]
    ApprovalWithoutDeduction { leave_type: String },
    #[error("{leave_type} draws on no balance and this approval deducted from one")]
    DeductionWithoutBalance { leave_type: String },
}

impl LeaveError {
    /// A stable code for the wire, so a client can branch on the refusal
    /// without matching on a sentence somebody will improve next month.
    pub const fn code(&self) -> &'static str {
        match self {
            Self::AmountOutOfRange { .. } => "leave_amount_out_of_range",
            Self::InvalidId { .. } => "leave_invalid_id",
            Self::BackwardsRange { .. } => "leave_backwards_range",
            Self::NotPositive { .. } => "leave_not_positive",
            Self::OutOfOrder { .. } => "leave_ledger_out_of_order",
            Self::DuplicateEntry { .. } => "leave_duplicate_entry",
            Self::PolicyNotRatified { .. } => "leave_policy_not_ratified",
            Self::InsufficientBalance { .. } => "leave_insufficient_balance",
            Self::NotBalanceBacked { .. } => "leave_not_balance_backed",
            Self::DuplicateLeaveType { .. } => "leave_duplicate_type",
            Self::UnknownLeaveType { .. } => "leave_unknown_type",
            Self::CertifiedLeaveWithoutEvidence { .. } => "leave_certified_without_evidence",
            Self::ActionForbidsRequest { .. } => "leave_action_forbids_request",
            Self::ActionForbidsDecision { .. } => "leave_action_forbids_decision",
            Self::EvidenceRequired { .. } => "leave_evidence_required",
            Self::NoChargeableDays { .. } => "leave_no_chargeable_days",
            Self::ExceedsPerOccurrenceLimit { .. } => "leave_exceeds_per_occurrence_limit",
            Self::ChargeableDayOutsidePeriod { .. } => "leave_day_outside_period",
            Self::RequestNotPending { .. } => "leave_request_not_pending",
            Self::WithdrawalNotByRequester => "leave_withdrawal_not_by_requester",
            Self::DecisionByRequester => "leave_decision_by_requester",
            Self::BalanceContextRequired { .. } => "leave_balance_context_required",
            Self::ApprovalWithoutDeduction { .. } => "leave_approval_without_deduction",
            Self::DeductionWithoutBalance { .. } => "leave_deduction_without_balance",
        }
    }

    /// Whether the *record* is in the wrong state rather than the request being
    /// malformed.
    ///
    /// An insufficient balance is a conflict, not a bad request: the days asked
    /// for are a well-formed number, and what is wrong is that the ledger does
    /// not have them. Telling the caller to fix their request would suggest they
    /// typed something invalid, when what they need to know is how many days are
    /// actually left.
    pub const fn is_conflict(&self) -> bool {
        matches!(
            self,
            Self::InsufficientBalance { .. }
                | Self::RequestNotPending { .. }
                | Self::DuplicateLeaveType { .. }
                | Self::DuplicateEntry { .. }
                | Self::WithdrawalNotByRequester
                | Self::PolicyNotRatified { .. }
        )
    }

    /// Whether the caller is reaching outside their grant, which needs a
    /// refusal rather than a correction: telling somebody to fix their payload
    /// invites them to look for the field that makes it work.
    pub const fn is_forbidden(&self) -> bool {
        matches!(
            self,
            Self::ActionForbidsRequest { .. }
                | Self::ActionForbidsDecision { .. }
                | Self::DecisionByRequester
        )
    }
}
