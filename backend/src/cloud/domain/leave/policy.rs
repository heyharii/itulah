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

/// What somebody who starts part-way through a year is given for that year,
/// under an up-front accrual (service rule, 1 Oct 2026). A monthly accrual counts only the months
/// from the start either way.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Joiner {
    /// The whole year's entitlement on the first day they are eligible — the
    /// behaviour before the service rule, so a stored generation that never said keeps it.
    #[default]
    Full,
    /// The months left in that year, counting the month they start, in
    /// twelfths of the entitlement.
    Prorate,
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
    /// Months of service before annual leave is earned at all (service rule, 1 Oct 2026). UU
    /// 13/2003 art. 79 gives it after twelve months of continuous work; a
    /// company may be more generous. A generation stored before the service rule never
    /// said, and keeps what it did: from the first day.
    #[serde(default)]
    eligibility_months: u32,
    #[serde(default)]
    joiner: Joiner,
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
            eligibility_months: 0,
            joiner: Joiner::Full,
        })
    }

    /// The service rule (service rule, 1 Oct 2026): months before leave is earned, and what a
    /// part-year starter is given. Refuses more than five years, which is a
    /// typo rather than a policy.
    pub fn with_service_rule(
        mut self,
        eligibility_months: u32,
        joiner: Joiner,
    ) -> Result<Self, LeaveError> {
        if eligibility_months > 60 {
            return Err(LeaveError::NotPositive {
                field: "eligibility_months (at most 60)",
            });
        }
        self.eligibility_months = eligibility_months;
        self.joiner = joiner;
        Ok(self)
    }

    pub const fn eligibility_months(&self) -> u32 {
        self.eligibility_months
    }
    pub const fn joiner(&self) -> Joiner {
        self.joiner
    }

    /// How much one person has earned of `as_of`'s year by the end of
    /// `as_of`'s month, given when their service began.
    ///
    /// Nothing before they are eligible (service start plus the waiting
    /// months). In the year they become eligible, a monthly accrual counts
    /// the months from that month on, and an up-front one gives the whole
    /// entitlement or the twelfths left in the year, as `joiner` says. Every
    /// later year is [`Self::accrued_by_month`]. Without a known start, the
    /// whole of [`Self::accrued_by_month`].
    pub fn earned_by(
        &self,
        as_of: NaiveDate,
        service_start: Option<NaiveDate>,
    ) -> Result<LeaveDays, LeaveError> {
        use chrono::Datelike;
        let whole = self.accrued_by_month(as_of.month())?;
        let Some(start) = service_start else {
            return Ok(whole);
        };
        let eligible = start
            .checked_add_months(chrono::Months::new(self.eligibility_months))
            .unwrap_or(start);
        if as_of < eligible {
            return LeaveDays::from_centidays(0);
        }
        if eligible.year() < as_of.year() {
            return Ok(whole);
        }
        // Eligible this year: count from the month eligibility begins.
        let from_month = eligible.month() as i32;
        let months_left = 13 - from_month;
        let entitlement = self.annual_entitlement.centidays();
        match self.accrual {
            Accrual::Monthly => {
                if as_of.month() == 12 {
                    // The remainder of the twelfths, as the whole-year rule gives it.
                    return LeaveDays::from_centidays(
                        entitlement * months_left / 12 + if from_month == 1 { entitlement % 12 } else { 0 },
                    );
                }
                let counted = as_of.month() as i32 - from_month + 1;
                LeaveDays::from_centidays((entitlement / 12) * counted.max(0))
            }
            Accrual::UpFront => match self.joiner {
                Joiner::Full => Ok(self.annual_entitlement),
                Joiner::Prorate => LeaveDays::from_centidays(entitlement * months_left / 12),
            },
        }
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
