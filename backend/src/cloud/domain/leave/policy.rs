//! The rules a balance folds under, as effective-dated generations.
//!
//! # Four questions nobody had answered
//!
//! The implementation this is ported from left four things to whatever the code
//! happened to do:
//!
//! 1. how much carry-forward may cross a year boundary,
//! 2. when unused carry-forward expires,
//! 3. whether encashment needs a second approver,
//! 4. whether protected leave keeps accruing annual leave.
//!
//! The tempting move is to copy the existing behaviour and call the port
//! faithful. That is how an accident becomes a rule: the behaviour is a default
//! somebody typed once, and copying it launders it into policy while leaving the
//! operator still unaware they ever decided.
//!
//! So [`LeavePolicy`] has **no `Default`, no builder with fallbacks, and no
//! optional field that quietly means "off"**. A deployment that has not decided
//! cannot build one, and the caller gets [`LeaveError::PolicyNotRatified`]
//! naming the open question instead of a number with no author.
//!
//! # Generations, not edits
//!
//! A policy change adds a generation, and last month's balance still folds
//! under last month's rules. Two generations effective on one day would make
//! "which rules applied" unanswerable, so they are refused here and refused
//! again by a unique key in the schema.

use super::error::LeaveError;
use super::units::LeaveDays;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

/// When the year's entitlement arrives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Accrual {
    /// The whole entitlement on day one. Simple, and generous to a leaver.
    UpFront,
    /// A twelfth each completed month. What most Indonesian retailers run, and
    /// what makes a mid-year joiner's balance sane.
    Monthly,
}

/// What may cross a year boundary.
///
/// Deliberately not `Option<LeaveDays>`: `None` there would be read as both "no
/// carry-forward allowed" and "not decided yet", and those are opposite
/// instructions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CarryForward {
    Forbidden,
    Capped {
        cap: LeaveDays,
        /// The month and day the carried days lapse. 31 March is the common
        /// Indonesian choice; nothing here assumes it.
        expires_on_month_day: (u32, u32),
    },
}

/// Whether days may be paid out instead of taken.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Encashment {
    Forbidden,
    Allowed {
        max_per_year: LeaveDays,
        /// Recorded rather than enforced here: this module does not route
        /// approvals, but carrying the answer means the layer that does cannot
        /// invent one.
        second_approver_required: bool,
    },
}

/// Whether annual leave keeps accruing during maternity or long sick leave.
///
/// A `bool` on its own would be readable in either polarity at the call site;
/// this is not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AccrualDuringProtectedLeave {
    Continues,
    Suspended,
}

/// One ratified generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LeavePolicy {
    version: u32,
    effective_from: NaiveDate,
    annual_entitlement: LeaveDays,
    accrual: Accrual,
    carry_forward: CarryForward,
    encashment: Encashment,
    protected_leave: AccrualDuringProtectedLeave,
}

impl LeavePolicy {
    pub fn try_new(
        version: u32,
        effective_from: NaiveDate,
        annual_entitlement: LeaveDays,
        accrual: Accrual,
        carry_forward: CarryForward,
        encashment: Encashment,
        protected_leave: AccrualDuringProtectedLeave,
    ) -> Result<Self, LeaveError> {
        if version == 0 {
            return Err(LeaveError::NotPositive { field: "version" });
        }
        if !annual_entitlement.is_positive() {
            return Err(LeaveError::NotPositive {
                field: "annual_entitlement",
            });
        }
        if let CarryForward::Capped {
            cap,
            expires_on_month_day: (month, day),
        } = carry_forward
        {
            if !cap.is_positive() {
                return Err(LeaveError::NotPositive {
                    field: "carry_forward.cap",
                });
            }
            // A date that does not exist would silently never arrive, so the
            // carried days would never expire — a cap that never bites. 2024 is
            // a leap year, so 29 February is accepted.
            if NaiveDate::from_ymd_opt(2024, month, day).is_none() {
                return Err(LeaveError::InvalidId {
                    field: "carry_forward.expires_on_month_day",
                });
            }
        }
        if let Encashment::Allowed { max_per_year, .. } = encashment {
            if !max_per_year.is_positive() {
                return Err(LeaveError::NotPositive {
                    field: "encashment.max_per_year",
                });
            }
        }
        Ok(Self {
            version,
            effective_from,
            annual_entitlement,
            accrual,
            carry_forward,
            encashment,
            protected_leave,
        })
    }

    pub const fn version(&self) -> u32 {
        self.version
    }
    pub const fn effective_from(&self) -> NaiveDate {
        self.effective_from
    }
    pub const fn annual_entitlement(&self) -> LeaveDays {
        self.annual_entitlement
    }
    pub const fn accrual(&self) -> Accrual {
        self.accrual
    }
    pub const fn carry_forward(&self) -> CarryForward {
        self.carry_forward
    }
    pub const fn encashment(&self) -> Encashment {
        self.encashment
    }
    pub const fn protected_leave(&self) -> AccrualDuringProtectedLeave {
        self.protected_leave
    }

    /// How much has been earned by the end of a month.
    ///
    /// Where the twelfths do not divide, the remainder is given in the final
    /// month rather than dropped — over a year the employee receives exactly the
    /// entitlement, never a rounding short.
    pub fn accrued_by_month(&self, month: u32) -> Result<LeaveDays, LeaveError> {
        if !(1..=12).contains(&month) {
            return Err(LeaveError::NotPositive { field: "month" });
        }
        match self.accrual {
            Accrual::UpFront => Ok(self.annual_entitlement),
            Accrual::Monthly if month == 12 => Ok(self.annual_entitlement),
            Accrual::Monthly => {
                let per_month = self.annual_entitlement.centidays() / 12;
                LeaveDays::from_centidays(per_month.saturating_mul(month as i32))
            }
        }
    }
}

/// Every generation, oldest first.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct PolicyTimeline {
    generations: Vec<LeavePolicy>,
}

impl<'de> Deserialize<'de> for PolicyTimeline {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let generations = Vec::<LeavePolicy>::deserialize(deserializer)?;
        let mut timeline = Self::default();
        for policy in generations {
            timeline.install(policy).map_err(serde::de::Error::custom)?;
        }
        Ok(timeline)
    }
}

impl PolicyTimeline {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn install(&mut self, policy: LeavePolicy) -> Result<(), LeaveError> {
        if let Some(last) = self.generations.last() {
            if policy.effective_from <= last.effective_from {
                return Err(LeaveError::OutOfOrder {
                    previous: last.effective_from,
                    next: policy.effective_from,
                });
            }
        }
        self.generations.push(policy);
        Ok(())
    }

    /// The rules in force on a date.
    ///
    /// A balance asked about before any policy existed is not zero; it is
    /// unanswerable, and saying so is the whole point of this module.
    pub fn in_force_on(&self, date: NaiveDate) -> Result<&LeavePolicy, LeaveError> {
        self.generations
            .iter()
            .rev()
            .find(|policy| policy.effective_from <= date)
            .ok_or(LeaveError::PolicyNotRatified {
                question: "which leave policy generation was in force on that date",
            })
    }

    pub fn generations(&self) -> &[LeavePolicy] {
        &self.generations
    }

    pub fn is_empty(&self) -> bool {
        self.generations.is_empty()
    }

    pub fn len(&self) -> usize {
        self.generations.len()
    }
}
