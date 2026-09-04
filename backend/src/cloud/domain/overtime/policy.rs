//! The caps an operator has ratified.
//!
//! # There is no default policy
//!
//! Four hours a day and eighteen a week are the figures in PP 35/2021 art.
//! 26(1). The figures before it were three and fourteen. That change is exactly
//! why neither pair is compiled in here: a constant in this file would have
//! been silently wrong for every deployment that upgraded across it, and the
//! wrongness would have shown up as overtime refused or allowed that should not
//! have been.
//!
//! So [`OvertimePolicy::try_new`] takes both caps and there is no other
//! constructor. An operator who has not decided cannot build one, and the
//! caller gets a refusal naming the open question rather than a limit somebody
//! typed once in 2019.

use super::error::OvertimeError;
use crate::cloud::domain::attendance::Minutes;
use serde::{Deserialize, Serialize};

/// The daily and weekly ceilings on ordered overtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "OvertimePolicyWire")]
pub struct OvertimePolicy {
    version: u32,
    max_per_day: Minutes,
    max_per_week: Minutes,
}

/// Deserialization shim, so a stored policy re-runs its constructor.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OvertimePolicyWire {
    pub version: u32,
    pub max_per_day: Minutes,
    pub max_per_week: Minutes,
}

impl TryFrom<OvertimePolicyWire> for OvertimePolicy {
    type Error = OvertimeError;
    fn try_from(wire: OvertimePolicyWire) -> Result<Self, Self::Error> {
        Self::try_new(wire.version, wire.max_per_day, wire.max_per_week)
    }
}

impl OvertimePolicy {
    /// Ratify the caps.
    ///
    /// Refuses a zero cap — which forbids overtime by arithmetic rather than by
    /// decision, and if an operator means to forbid it that is a policy of its
    /// own and not a limit of nought — a weekly cap below the daily one, which
    /// makes the daily cap unreachable and one of the two figures a typo, and a
    /// version of zero, because zero means "unversioned" and no recorded
    /// decision may be that.
    pub fn try_new(
        version: u32,
        max_per_day: Minutes,
        max_per_week: Minutes,
    ) -> Result<Self, OvertimeError> {
        if version == 0 {
            return Err(OvertimeError::ZeroPolicyVersion);
        }
        if max_per_day.is_zero() {
            return Err(OvertimeError::PolicyNotRatified {
                question: "the daily overtime cap",
            });
        }
        if max_per_week.is_zero() {
            return Err(OvertimeError::PolicyNotRatified {
                question: "the weekly overtime cap",
            });
        }
        if max_per_week < max_per_day {
            return Err(OvertimeError::WeeklyCapBelowDaily {
                max_per_day: max_per_day.get(),
                max_per_week: max_per_week.get(),
            });
        }
        Ok(Self {
            version,
            max_per_day,
            max_per_week,
        })
    }

    /// Which generation of the rules this is.
    ///
    /// Recorded on every decision downstream, so a later reader can tell which
    /// caps applied without inferring it from dates.
    pub const fn version(&self) -> u32 {
        self.version
    }
    pub const fn max_per_day(&self) -> Minutes {
        self.max_per_day
    }
    pub const fn max_per_week(&self) -> Minutes {
        self.max_per_week
    }

    /// Fail closed unless `minutes` is within the daily cap.
    ///
    /// Exactly at the cap is within it: four hours is four hours, not more
    /// than four.
    pub fn check_daily(&self, minutes: Minutes) -> Result<(), OvertimeError> {
        if minutes > self.max_per_day {
            return Err(OvertimeError::ExceedsDailyCap {
                requested: minutes.get(),
                cap: self.max_per_day.get(),
            });
        }
        Ok(())
    }

    /// Fail closed unless `minutes` is within the weekly cap.
    pub fn check_weekly(&self, minutes: Minutes) -> Result<(), OvertimeError> {
        if minutes > self.max_per_week {
            return Err(OvertimeError::ExceedsWeeklyCap {
                requested: minutes.get(),
                cap: self.max_per_week.get(),
            });
        }
        Ok(())
    }
}
