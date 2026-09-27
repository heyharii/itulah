//! Every way attendance can refuse.
//!
//! A variant is here only if code in this module raises it. The punch,
//! terminal, derivation and correction variants arrived with the fingerprint
//! terminal — until there was a punch source there was nothing to raise them,
//! and a refusal nothing can produce is a refusal nobody maintains.

use chrono::NaiveDate;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum AttendanceError {
    #[error("{field} is required")]
    Required { field: &'static str },
    #[error("{field} must be at most {max} characters")]
    TooLong { field: &'static str, max: usize },
    #[error("{field} must be printable text without control characters")]
    NotPrintable { field: &'static str },
    /// Zero means "unversioned", which no recorded decision may be.
    #[error("policy version must not be zero")]
    ZeroPolicyVersion,
    #[error("policy ends before it starts")]
    PolicyEndsBeforeStart,
    #[error("policy spans overlap")]
    OverlappingPolicy,
    #[error("policy schedule is empty")]
    EmptyPolicySchedule,
    #[error("policy {field} exceeds the maximum of {max} minutes")]
    PolicyLimitOutOfRange { field: &'static str, max: u32 },
    /// No policy is effective on the date.
    ///
    /// There is **no default policy**. An absent policy is an error, never a
    /// silently assumed grace period — see [`super::policy`] for why that
    /// distinction is the whole point of the module.
    #[error("no attendance policy is effective on {date}")]
    NoPolicyEffective { date: NaiveDate },

    // ── the roster half ──────────────────────────────────────────────────
    #[error("{minute} is not a minute of the day")]
    InvalidMinuteOfDay { minute: u16 },
    #[error("a clock reading must read HH:MM")]
    UnreadableClockTime,
    #[error("a period must read YYYY-MM")]
    UnreadablePeriod,
    #[error("a shift cannot span {days} days")]
    ShiftSpansMoreThanADay { days: u8 },
    #[error("a shift must end after it starts")]
    ShiftEndNotAfterStart,
    #[error("the unpaid break is at least as long as the shift")]
    ShiftBreakTooLong,
    #[error("action `{action_key}` does not authorize planning a roster")]
    ActionForbidsRosterChange { action_key: String },
    #[error("a roster revision cannot be dated before the one it follows")]
    RosterRevisionNotForward,
    #[error("this roster belongs to another employee")]
    RosterEmployeeMismatch,
    #[error("{date} is already on the roster")]
    DuplicateRosterEntry { date: NaiveDate },
    #[error("{date} is not on the roster")]
    NoRosterEntry { date: NaiveDate },

    // ── the close boundary ───────────────────────────────────────────────
    #[error("action `{action_key}` does not authorize a period {operation}")]
    ActionForbidsPeriodOperation {
        action_key: String,
        operation: &'static str,
    },
    #[error("the period is already closed")]
    PeriodAlreadyClosed,
    #[error("the period is not closed")]
    PeriodNotClosed,
    #[error("a close must record the readiness it was taken under")]
    CloseEventWithoutReadiness,
    #[error("a reopen is not taken under a readiness assessment")]
    ReopenEventWithReadiness,
    #[error("this period record belongs to another unit")]
    PeriodIdentityMismatch,
    #[error("{date} is outside the period")]
    DateOutsidePeriod { date: NaiveDate },
    #[error("the period is closed and will not take a roster change")]
    ClosedPeriodRejectsRosterChange { period: String },
    #[error(
        "the period cannot close: {open_corrections} corrections are still open and \
         {unresolved_leave} leave requests are still undecided"
    )]
    PeriodHasBlockers {
        open_corrections: u32,
        unresolved_leave: u32,
    },

    // ── the terminal, which is the attendance authority ──────────────────
    #[error("action `{action_key}` does not authorize administering a terminal")]
    ActionForbidsTerminalAdministration { action_key: String },
    #[error("a terminal that is {status} cannot identify anybody")]
    TerminalNotActive { status: &'static str },
    #[error("a terminal cannot go from {from} to {to}")]
    IllegalTerminalTransition {
        from: &'static str,
        to: &'static str,
    },
    #[error("the stored terminal status is not the one its own history produces")]
    TerminalStatusContradictsHistory,

    // ── punches ──────────────────────────────────────────────────────────
    #[error("the terminal attested somebody other than this employee")]
    AttestationEmployeeMismatch,
    /// The self-service claim names somebody other than the record being
    /// written. Its own variant rather than
    /// [`Self::AttestationEmployeeMismatch`] because the two say different
    /// things about what went wrong: a terminal identifying the wrong person is
    /// a device problem, and a claim about somebody else is a caller reaching
    /// past their own record.
    #[error("this claim is about somebody other than the employee being recorded")]
    ClaimEmployeeMismatch,
    #[error("action `{action_key}` does not authorize recording your own punch")]
    ActionForbidsOwnPunch { action_key: String },
    #[error("`{code}` is not a punch source")]
    UnreadablePunchSource { code: String },
    #[error("this punch belongs to another unit")]
    PunchUnitMismatch,
    #[error("a punch with this identity is already recorded")]
    DuplicatePunchIdentity,
    #[error("the stored punch no longer matches its terminal: {field}")]
    PunchProvenanceMismatch { field: &'static str },
    #[error("the period is closed and will not take a punch: {period}")]
    ClosedPeriodRejectsPunch { period: String },
    #[error("employment is {status} on {date}, which does not permit attendance")]
    EmploymentForbidsAttendance {
        status: &'static str,
        date: NaiveDate,
    },
    #[error("this person was not posted to the terminal's unit on {date}")]
    NotPostedToUnitOnDate { date: NaiveDate },
    #[error("`{code}` is not a clock quality")]
    UnreadableClockQuality { code: String },

    // ── the derived day ──────────────────────────────────────────────────
    #[error("a day must say at least one thing about itself")]
    EmptyOutcomeSet,
    #[error("a day cannot say {code} twice")]
    DuplicateOutcome { code: &'static str },
    #[error("{code} carrying zero minutes says nothing")]
    ZeroMinuteOutcome { code: &'static str },
    #[error("a day cannot be both {first} and {second}")]
    ContradictoryOutcomes {
        first: &'static str,
        second: &'static str,
    },
    #[error("this punch is not for the rostered day being derived")]
    PunchDoesNotMatchRosterDay,
    #[error("there are punches on a day recorded as approved leave")]
    PunchesOnApprovedLeaveDay,
    #[error("overtime is agreed for a day with no work observed")]
    OvertimeAgreedWithoutWork,
    #[error("work was punched on a non-working day that no overtime order covers")]
    UnagreedNonWorkingDayWork,

    // ── corrections ──────────────────────────────────────────────────────
    #[error("action `{action_key}` does not authorize requesting a correction")]
    ActionForbidsCorrectionRequest { action_key: String },
    #[error("action `{action_key}` does not authorize deciding a correction")]
    ActionForbidsCorrectionDecision { action_key: String },
    #[error("a corrected arrival must come before the corrected departure")]
    CorrectionArrivalNotBeforeDeparture,
    #[error("this correction is about another employee, unit or day")]
    CorrectionTargetMismatch,
    #[error("only the requester may withdraw a correction; anybody else rejects it")]
    CorrectionWithdrawalNotByRequester,
    #[error("this correction is already {state}")]
    CorrectionAlreadyDecided { state: &'static str },
    #[error("a correction is already awaiting a decision on this day")]
    AnotherCorrectionIsPending,
    #[error("a new correction must supersede the one in force, which is {expected}")]
    CorrectionSupersedesTheWrongLink { expected: String },
    #[error("the period is closed and will not take a correction: {period}")]
    ClosedPeriodRejectsCorrection { period: String },
    #[error("this chain holds a correction belonging to another employee, unit or day")]
    CorrectionChainMismatch,

    // ── enrolment ────────────────────────────────────────────────────────
    #[error("`{code}` is not a finger")]
    UnknownFinger { code: String },
    #[error("action `{action_key}` does not authorize enrolling a fingerprint")]
    ActionForbidsEnrolment { action_key: String },
}

impl AttendanceError {
    /// A stable code for the wire, so a client can branch on the refusal
    /// without matching on a sentence somebody will improve next month.
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Required { .. } => "attendance_required",
            Self::TooLong { .. } => "attendance_too_long",
            Self::NotPrintable { .. } => "attendance_not_printable",
            Self::ZeroPolicyVersion => "attendance_zero_policy_version",
            Self::PolicyEndsBeforeStart => "attendance_policy_ends_before_start",
            Self::OverlappingPolicy => "attendance_overlapping_policy",
            Self::EmptyPolicySchedule => "attendance_empty_policy_schedule",
            Self::PolicyLimitOutOfRange { .. } => "attendance_policy_limit_out_of_range",
            Self::NoPolicyEffective { .. } => "attendance_no_policy_effective",
            Self::InvalidMinuteOfDay { .. } => "attendance_invalid_minute",
            Self::UnreadableClockTime => "attendance_unreadable_clock_time",
            Self::UnreadablePeriod => "attendance_unreadable_period",
            Self::ShiftSpansMoreThanADay { .. } => "attendance_shift_spans_more_than_a_day",
            Self::ShiftEndNotAfterStart => "attendance_shift_end_not_after_start",
            Self::ShiftBreakTooLong => "attendance_shift_break_too_long",
            Self::ActionForbidsRosterChange { .. } => "attendance_action_forbids_roster_change",
            Self::RosterRevisionNotForward => "attendance_roster_revision_not_forward",
            Self::RosterEmployeeMismatch => "attendance_roster_employee_mismatch",
            Self::DuplicateRosterEntry { .. } => "attendance_duplicate_roster_entry",
            Self::NoRosterEntry { .. } => "attendance_no_roster_entry",
            Self::ActionForbidsPeriodOperation { .. } => "attendance_action_forbids_period_op",
            Self::PeriodAlreadyClosed => "attendance_period_already_closed",
            Self::PeriodNotClosed => "attendance_period_not_closed",
            Self::CloseEventWithoutReadiness => "attendance_close_without_readiness",
            Self::ReopenEventWithReadiness => "attendance_reopen_with_readiness",
            Self::PeriodIdentityMismatch => "attendance_period_identity_mismatch",
            Self::DateOutsidePeriod { .. } => "attendance_date_outside_period",
            Self::ClosedPeriodRejectsRosterChange { .. } => "attendance_closed_rejects_roster",
            Self::PeriodHasBlockers { .. } => "attendance_period_has_blockers",
            Self::ActionForbidsTerminalAdministration { .. } => {
                "attendance_action_forbids_terminal_admin"
            }
            Self::TerminalNotActive { .. } => "attendance_terminal_not_active",
            Self::IllegalTerminalTransition { .. } => "attendance_illegal_terminal_transition",
            Self::TerminalStatusContradictsHistory => "attendance_terminal_status_contradicts",
            Self::AttestationEmployeeMismatch => "attendance_attestation_employee_mismatch",
            Self::ClaimEmployeeMismatch => "attendance_claim_employee_mismatch",
            Self::ActionForbidsOwnPunch { .. } => "attendance_action_forbids_own_punch",
            Self::UnreadablePunchSource { .. } => "attendance_unreadable_punch_source",
            Self::PunchUnitMismatch => "attendance_punch_unit_mismatch",
            Self::DuplicatePunchIdentity => "attendance_duplicate_punch_identity",
            Self::PunchProvenanceMismatch { .. } => "attendance_punch_provenance_mismatch",
            Self::ClosedPeriodRejectsPunch { .. } => "attendance_closed_rejects_punch",
            Self::EmploymentForbidsAttendance { .. } => "attendance_employment_forbids",
            Self::NotPostedToUnitOnDate { .. } => "attendance_not_posted_to_unit",
            Self::UnreadableClockQuality { .. } => "attendance_unreadable_clock_quality",
            Self::EmptyOutcomeSet => "attendance_empty_outcome_set",
            Self::DuplicateOutcome { .. } => "attendance_duplicate_outcome",
            Self::ZeroMinuteOutcome { .. } => "attendance_zero_minute_outcome",
            Self::ContradictoryOutcomes { .. } => "attendance_contradictory_outcomes",
            Self::PunchDoesNotMatchRosterDay => "attendance_punch_not_for_roster_day",
            Self::PunchesOnApprovedLeaveDay => "attendance_punches_on_leave_day",
            Self::OvertimeAgreedWithoutWork => "attendance_overtime_agreed_without_work",
            Self::UnagreedNonWorkingDayWork => "attendance_unagreed_non_working_work",
            Self::ActionForbidsCorrectionRequest { .. } => "attendance_action_forbids_correction",
            Self::ActionForbidsCorrectionDecision { .. } => {
                "attendance_action_forbids_correction_decision"
            }
            Self::CorrectionArrivalNotBeforeDeparture => "attendance_correction_times_backwards",
            Self::CorrectionTargetMismatch => "attendance_correction_target_mismatch",
            Self::CorrectionWithdrawalNotByRequester => "attendance_correction_withdrawal_foreign",
            Self::CorrectionAlreadyDecided { .. } => "attendance_correction_already_decided",
            Self::AnotherCorrectionIsPending => "attendance_correction_already_pending",
            Self::CorrectionSupersedesTheWrongLink { .. } => "attendance_correction_wrong_lineage",
            Self::ClosedPeriodRejectsCorrection { .. } => "attendance_closed_rejects_correction",
            Self::CorrectionChainMismatch => "attendance_correction_chain_mismatch",
            Self::UnknownFinger { .. } => "attendance_unknown_finger",
            Self::ActionForbidsEnrolment { .. } => "attendance_action_forbids_enrolment",
        }
    }

    /// Whether the *record* is in the wrong state rather than the request being
    /// malformed.
    ///
    /// A closed period refusing a roster change is a conflict: the request is
    /// well formed and the month is settled. A shift that ends before it starts
    /// is a bad request — the numbers in the body are the thing to fix.
    pub const fn is_conflict(&self) -> bool {
        matches!(
            self,
            Self::PeriodAlreadyClosed
                | Self::PeriodNotClosed
                | Self::ClosedPeriodRejectsRosterChange { .. }
                | Self::PeriodHasBlockers { .. }
                | Self::DuplicateRosterEntry { .. }
                | Self::RosterRevisionNotForward
                | Self::NoPolicyEffective { .. }
                // The record is in the wrong state, not the request in the
                // wrong shape: the month is settled, the device is untrusted,
                // the day already has a request waiting.
                | Self::ClosedPeriodRejectsPunch { .. }
                | Self::ClosedPeriodRejectsCorrection { .. }
                | Self::DuplicatePunchIdentity
                | Self::TerminalNotActive { .. }
                | Self::IllegalTerminalTransition { .. }
                | Self::AnotherCorrectionIsPending
                | Self::CorrectionAlreadyDecided { .. }
                | Self::CorrectionSupersedesTheWrongLink { .. }
                | Self::EmploymentForbidsAttendance { .. }
                | Self::NotPostedToUnitOnDate { .. }
                | Self::PunchesOnApprovedLeaveDay
        )
    }

    /// Whether the caller is reaching outside their grant.
    pub const fn is_forbidden(&self) -> bool {
        matches!(
            self,
            Self::ActionForbidsRosterChange { .. }
                | Self::ActionForbidsPeriodOperation { .. }
                | Self::ActionForbidsTerminalAdministration { .. }
                | Self::ActionForbidsCorrectionRequest { .. }
                | Self::ActionForbidsCorrectionDecision { .. }
                | Self::ActionForbidsEnrolment { .. }
                | Self::ActionForbidsOwnPunch { .. }
                // Reaching past your own record is a refusal about the grant,
                // not about the shape of the request.
                | Self::ClaimEmployeeMismatch
                | Self::CorrectionWithdrawalNotByRequester
        )
    }
}
