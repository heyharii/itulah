//! Every way the attendance policy can refuse.
//!
//! Trimmed from the reference, which covers punches, corrections and kiosks as
//! well. A variant is here only if code in this module raises it; the punch
//! half arrives when there is a punch source to raise it.

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
    #[error("this period record belongs to another place")]
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
        )
    }

    /// Whether the caller is reaching outside their grant.
    pub const fn is_forbidden(&self) -> bool {
        matches!(
            self,
            Self::ActionForbidsRosterChange { .. } | Self::ActionForbidsPeriodOperation { .. }
        )
    }
}
