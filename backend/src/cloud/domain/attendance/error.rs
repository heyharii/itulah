//! Every way the attendance policy can refuse.
//!
//! Trimmed hard from the reference, which covers punches, rosters, corrections,
//! kiosks and payroll periods as well. A variant is here only if code in this
//! module raises it; the rest arrive with the slices that need them.

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
}
