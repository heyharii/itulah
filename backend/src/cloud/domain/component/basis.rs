//! The closed set: five shapes, four of them with numbers somebody ratified.
//!
//! # Why there is no expression here
//!
//! The reference this is adapted from stores a component's arithmetic as
//! `condition` and `formula` — Python source typed by an operator into a
//! database row and handed to `_safe_eval` when a payslip is built. That is a
//! language inside a language, reachable by anybody who can write to a table,
//! and the sandbox around it is a maintenance burden somebody has to keep
//! winning at.
//!
//! So there is no expression type in this module and no interpreter anywhere
//! near it. A component is one of five shapes, [`ComponentShape`], and the
//! arithmetic for each is a function in this file. A shape not in the enum is
//! not refused at runtime — it cannot be constructed, cannot be stored, and
//! cannot be sent over the wire.
//!
//! # No component may name another component
//!
//! [`ComponentBasis::compute`] takes [`SlipFacts`], which is the pay agreement
//! the slip already copied plus the counts the slip already carries — and
//! nothing else. There is no way to write "one per cent of the transport
//! allowance", because there is no variant that could refer to a component.
//!
//! That is worth more than it looks. With such a reference would come an
//! evaluation order, then a dependency graph, then a cycle check, and the
//! engine would be back. Without it every line is computable in any order and
//! a cycle is unrepresentable rather than detected.
//!
//! The one named base that would have broken this is `GROSS` — a deduction as
//! a share of the month's earnings. It is deliberately absent: no rule this
//! estate implements needs it, because an Indonesian statutory base is *upah*
//! rather than the month's takings. The day one does, it is a new variant and
//! a migration, which is a visible act.
//!
//! # Every number is an integer
//!
//! Money in the smallest unit, percentages in **basis points**, statutory
//! multipliers in basis points, overtime in whole minutes. No `f64` appears in
//! this file or in the schema behind it. 1.5 happens to be exactly representable in
//! binary floating point and 1.05 does not, which is the kind of luck that
//! hides a rounding fault for a year.

use super::error::ComponentError;
use pricing_engine::Money;
use serde::{Deserialize, Serialize};

/// Basis points in one whole. 4% is 400.
pub const BASIS_POINTS: i128 = 10_000;

/// The ceiling on a ratified share: ten thousand per cent.
///
/// Not a policy. A percentage is the one figure where a slipped decimal point
/// becomes everybody's deduction at once, and this refuses the figure that is
/// certainly a typo without pretending to know what the real one should be.
pub const MAX_RATE_BP: i64 = 1_000_000;

/// Whether a component adds to gross or comes off it.
///
/// The reference's third value, `Employer Contribution`, is not here: what the
/// employer pays on top of a wage changes neither gross nor net, and putting it
/// on a payslip is how a person comes to read a number that was never theirs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ComponentKind {
    Earning,
    Deduction,
}

impl ComponentKind {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Earning => "EARNING",
            Self::Deduction => "DEDUCTION",
        }
    }

    pub fn parse(code: &str) -> Result<Self, ComponentError> {
        match code {
            "EARNING" => Ok(Self::Earning),
            "DEDUCTION" => Ok(Self::Deduction),
            other => Err(ComponentError::UnknownKind {
                value: other.to_owned(),
            }),
        }
    }
}

/// Which figure from the pay agreement a share or an hourly wage is taken of.
///
/// Both are facts about the *agreement*, and both are already snapshotted on
/// the slip — which is what keeps a line reproducible from itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ComponentBase {
    /// *Gaji pokok* alone.
    Base,
    /// Base plus the standing (*tetap*) allowances — the sum Kepmenaker
    /// 102/2004 art. 8 and several BPJS bases are computed against.
    StatutoryBase,
}

impl ComponentBase {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Base => "BASE",
            Self::StatutoryBase => "STATUTORY_BASE",
        }
    }

    pub fn parse(code: &str) -> Result<Self, ComponentError> {
        match code {
            "BASE" => Ok(Self::Base),
            "STATUTORY_BASE" => Ok(Self::StatutoryBase),
            other => Err(ComponentError::UnknownBase {
                value: other.to_owned(),
            }),
        }
    }
}

/// What a per-unit component multiplies.
///
/// A closed list, because the counts a slip actually holds are a closed list.
/// Every one of these is either a column on `payroll_slip` or a band of
/// `overtime_order` rows; a unit naming anything else would be a unit nothing
/// could count, and a component whose count is always absent is a component
/// that silently pays nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CountedUnit {
    /// The first hour of each ordinary working day's agreed overtime — PP
    /// 35/2021 art. 31's first band. Counted in **minutes**.
    OvertimeWorkdayFirstHour,
    /// Every later minute of an ordinary working day's agreed overtime.
    OvertimeWorkdayLater,
    /// Every agreed minute on a weekly rest day.
    ///
    /// The regulation's own ladder within a rest day — 2× for the first eight
    /// hours, 3× for the ninth, 4× beyond — is **not** banded here. One
    /// multiplier covers the whole day, so a very long holiday shift is
    /// understated. Naming the limit is the point; closing it is three more
    /// variants and a migration.
    OvertimeRestDay,
    /// Every agreed minute on a published public holiday. Kept apart from the
    /// rest day because `overtime_order` already distinguishes them and
    /// merging them would throw a fact away.
    OvertimeHoliday,
    /// The hour after the first tier on a rest day (the 8th hour on a six-day
    /// week), counted **on top of** `OvertimeRestDay`, which counts every
    /// minute: Kepmenaker 102/2004 pays it 3× where the first tier is 2×, so
    /// its component carries the extra 1× (0808).
    OvertimeRestDayNextHour,
    /// Minutes beyond that hour on a rest day (4×; the extra 2×).
    OvertimeRestDayBeyond,
    /// The same two tiers on a public holiday.
    OvertimeHolidayNextHour,
    OvertimeHolidayBeyond,
    /// Days **planned** in the month. Whole days.
    ///
    /// Not days worked: there is no punch source in this estate, and a unit
    /// called `DayWorked` would be a claim the slip cannot support. Every run
    /// says so in its own `incomplete_because`.
    RosteredDay,
    /// Days of approved leave that fell in the month. Whole days — which is
    /// how a deduction for unpaid leave is expressed.
    LeaveDayTaken,
}

impl CountedUnit {
    pub const fn code(self) -> &'static str {
        match self {
            Self::OvertimeWorkdayFirstHour => "OVERTIME_WORKDAY_FIRST_HOUR",
            Self::OvertimeWorkdayLater => "OVERTIME_WORKDAY_LATER",
            Self::OvertimeRestDay => "OVERTIME_REST_DAY",
            Self::OvertimeHoliday => "OVERTIME_HOLIDAY",
            Self::OvertimeRestDayNextHour => "OVERTIME_REST_DAY_NEXT_HOUR",
            Self::OvertimeRestDayBeyond => "OVERTIME_REST_DAY_BEYOND",
            Self::OvertimeHolidayNextHour => "OVERTIME_HOLIDAY_NEXT_HOUR",
            Self::OvertimeHolidayBeyond => "OVERTIME_HOLIDAY_BEYOND",
            Self::RosteredDay => "ROSTERED_DAY",
            Self::LeaveDayTaken => "LEAVE_DAY_TAKEN",
        }
    }

    pub fn parse(code: &str) -> Result<Self, ComponentError> {
        match code {
            "OVERTIME_WORKDAY_FIRST_HOUR" => Ok(Self::OvertimeWorkdayFirstHour),
            "OVERTIME_WORKDAY_LATER" => Ok(Self::OvertimeWorkdayLater),
            "OVERTIME_REST_DAY" => Ok(Self::OvertimeRestDay),
            "OVERTIME_HOLIDAY" => Ok(Self::OvertimeHoliday),
            "OVERTIME_REST_DAY_NEXT_HOUR" => Ok(Self::OvertimeRestDayNextHour),
            "OVERTIME_REST_DAY_BEYOND" => Ok(Self::OvertimeRestDayBeyond),
            "OVERTIME_HOLIDAY_NEXT_HOUR" => Ok(Self::OvertimeHolidayNextHour),
            "OVERTIME_HOLIDAY_BEYOND" => Ok(Self::OvertimeHolidayBeyond),
            "ROSTERED_DAY" => Ok(Self::RosteredDay),
            "LEAVE_DAY_TAKEN" => Ok(Self::LeaveDayTaken),
            other => Err(ComponentError::UnknownUnit {
                value: other.to_owned(),
            }),
        }
    }

    /// How many of the counted things make one **priced** unit.
    ///
    /// The overtime bands are counted in minutes and priced by the hour, so
    /// sixty. That is deliberately not a conversion: the count stored on a slip
    /// line is the same integer `overtime_order.planned_minutes` holds, so the
    /// two can never disagree, and `rate x units / 60` is exact arithmetic on
    /// figures a person can check. Converting minutes to a decimal of an hour
    /// first would introduce a rounding nobody asked for, twenty minutes being
    /// the obvious case.
    ///
    /// The day counts are counted and priced in the same thing, so one.
    pub const fn per_whole(self) -> i128 {
        match self {
            Self::OvertimeWorkdayFirstHour
            | Self::OvertimeWorkdayLater
            | Self::OvertimeRestDay
            | Self::OvertimeHoliday
            | Self::OvertimeRestDayNextHour
            | Self::OvertimeRestDayBeyond
            | Self::OvertimeHolidayNextHour
            | Self::OvertimeHolidayBeyond => 60,
            Self::RosteredDay | Self::LeaveDayTaken => 1,
        }
    }

    /// Whether this unit is counted in hours, which is what an hourly wage may
    /// be multiplied by.
    pub const fn is_counted_in_hours(self) -> bool {
        matches!(
            self,
            Self::OvertimeWorkdayFirstHour
                | Self::OvertimeWorkdayLater
                | Self::OvertimeRestDay
                | Self::OvertimeHoliday
                | Self::OvertimeRestDayNextHour
                | Self::OvertimeRestDayBeyond
                | Self::OvertimeHolidayNextHour
                | Self::OvertimeHolidayBeyond
        )
    }

    /// What a payslip calls the count — `26 days`, `90 minutes` — and, next to
    /// it, what the rate is quoted per.
    pub const fn counted_in(self) -> &'static str {
        match self {
            Self::OvertimeWorkdayFirstHour
            | Self::OvertimeWorkdayLater
            | Self::OvertimeRestDay
            | Self::OvertimeHoliday
            | Self::OvertimeRestDayNextHour
            | Self::OvertimeRestDayBeyond
            | Self::OvertimeHolidayNextHour
            | Self::OvertimeHolidayBeyond => "minutes",
            Self::RosteredDay | Self::LeaveDayTaken => "days",
        }
    }

    /// What the ratified rate is quoted per: an hour of overtime, a day of
    /// anything else.
    pub const fn priced_per(self) -> &'static str {
        match self {
            Self::OvertimeWorkdayFirstHour
            | Self::OvertimeWorkdayLater
            | Self::OvertimeRestDay
            | Self::OvertimeHoliday
            | Self::OvertimeRestDayNextHour
            | Self::OvertimeRestDayBeyond
            | Self::OvertimeHolidayNextHour
            | Self::OvertimeHolidayBeyond => "hour",
            Self::RosteredDay | Self::LeaveDayTaken => "day",
        }
    }
}

/// What *kind of question* a component is — its structure, without its numbers.
///
/// Stored on the definition. The numbers live in an effective-dated rate, so
/// that a rate changing by regulation cannot rewrite a closed month, and so
/// that "this component exists and nobody has said what it costs" is a state
/// this system can name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ComponentShape {
    /// A flat figure every period.
    FixedAmount,
    /// Basis points of a named base, optionally capped. This is how BPJS
    /// works: a percentage of wage **up to a stated maximum wage**, not a
    /// percentage up to a maximum contribution.
    ShareOfBase,
    /// Money per counted unit — a transport allowance per day, a flat rate per
    /// hour of overtime.
    RatePerUnit,
    /// A named base divided by a ratified divisor of hours, times a ratified
    /// multiplier, times a count of hours. Kepmenaker 102/2004 art. 8 and PP
    /// 35/2021 art. 31.
    FractionOfBasePerUnit,
    /// No standing figure at all. The component exists so a place can file a
    /// one-off against it, one person and one month at a time. There is
    /// nothing to ratify and no rate row can be written.
    PerOccasion,
    /// Worked out by the statutory kernel (`domain::pay::statutory`): PPh 21
    /// and BPJS. Seeded by `0800` and never defined through the API; like a
    /// one-off it has no rate row, because the law and `statutory_rate` are
    /// its rate.
    Statutory,
}

impl ComponentShape {
    pub const fn code(self) -> &'static str {
        match self {
            Self::FixedAmount => "FIXED_AMOUNT",
            Self::ShareOfBase => "SHARE_OF_BASE",
            Self::RatePerUnit => "RATE_PER_UNIT",
            Self::FractionOfBasePerUnit => "FRACTION_OF_BASE_PER_UNIT",
            Self::PerOccasion => "PER_OCCASION",
            Self::Statutory => "STATUTORY",
        }
    }

    pub fn parse(code: &str) -> Result<Self, ComponentError> {
        match code {
            "FIXED_AMOUNT" => Ok(Self::FixedAmount),
            "SHARE_OF_BASE" => Ok(Self::ShareOfBase),
            "RATE_PER_UNIT" => Ok(Self::RatePerUnit),
            "FRACTION_OF_BASE_PER_UNIT" => Ok(Self::FractionOfBasePerUnit),
            "PER_OCCASION" => Ok(Self::PerOccasion),
            "STATUTORY" => Ok(Self::Statutory),
            other => Err(ComponentError::UnknownShape {
                value: other.to_owned(),
            }),
        }
    }

    /// Whether a standing rate can exist for this shape at all.
    ///
    /// `PER_OCCASION` answers `false`, and that is the shape's definition
    /// rather than a gap: a component with nothing standing has nothing to
    /// ratify, so it can never be the reason a slip is incomplete.
    pub const fn has_standing_rate(self) -> bool {
        !matches!(self, Self::PerOccasion | Self::Statutory)
    }

    /// Whether it names a base, and whether it names a unit.
    pub const fn needs_base(self) -> bool {
        matches!(self, Self::ShareOfBase | Self::FractionOfBasePerUnit)
    }
    pub const fn needs_unit(self) -> bool {
        matches!(self, Self::RatePerUnit | Self::FractionOfBasePerUnit)
    }
}

/// The shape, with the numbers somebody ratified. **The closed set.**
///
/// Four variants where [`ComponentShape`] has five, and the missing one is the
/// point: `PER_OCCASION` has no representation here, because there is no
/// standing figure it could hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "basis", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ComponentBasis {
    FixedAmount {
        amount: Money,
    },
    ShareOfBase {
        base: ComponentBase,
        rate_bp: i64,
        /// The ceiling the share is taken **of**. `None` means uncapped, which
        /// is a real and different statement from a very large cap.
        cap: Option<Money>,
    },
    RatePerUnit {
        unit: CountedUnit,
        /// Money per whole unit — per day, per hour.
        rate: Money,
    },
    FractionOfBasePerUnit {
        base: ComponentBase,
        unit: CountedUnit,
        /// The divisor that turns a monthly wage into an hourly one: 173 in
        /// Kepmenaker 102/2004 art. 8. Ratified, never compiled in.
        hours_divisor: i64,
        /// The statutory multiplier in basis points: 1.5× is 15000.
        multiplier_bp: i64,
    },
}

impl ComponentBasis {
    pub const fn shape(&self) -> ComponentShape {
        match self {
            Self::FixedAmount { .. } => ComponentShape::FixedAmount,
            Self::ShareOfBase { .. } => ComponentShape::ShareOfBase,
            Self::RatePerUnit { .. } => ComponentShape::RatePerUnit,
            Self::FractionOfBasePerUnit { .. } => ComponentShape::FractionOfBasePerUnit,
        }
    }

    pub const fn base(&self) -> Option<ComponentBase> {
        match self {
            Self::ShareOfBase { base, .. } | Self::FractionOfBasePerUnit { base, .. } => {
                Some(*base)
            }
            _ => None,
        }
    }

    pub const fn unit(&self) -> Option<CountedUnit> {
        match self {
            Self::RatePerUnit { unit, .. } | Self::FractionOfBasePerUnit { unit, .. } => {
                Some(*unit)
            }
            _ => None,
        }
    }

    /// Refuse the figures that are certainly wrong, before anything is stored.
    ///
    /// Zero as well as negative, everywhere. A rate of nought forbids something
    /// by arithmetic rather than by decision — the argument `OvertimePolicy`
    /// makes about a cap of nought — and if an operator means a component to be
    /// worth nothing, leaving it undefined or retiring it says so where
    /// somebody reads it.
    pub fn validated(self) -> Result<Self, ComponentError> {
        match self {
            Self::FixedAmount { amount } => {
                positive(amount.minor, "the amount")?;
            }
            Self::ShareOfBase { rate_bp, cap, .. } => {
                positive(rate_bp, "the rate")?;
                if rate_bp > MAX_RATE_BP {
                    return Err(ComponentError::RateAboveCeiling { rate_bp });
                }
                if let Some(cap) = cap {
                    positive(cap.minor, "the cap")?;
                }
            }
            Self::RatePerUnit { rate, .. } => {
                positive(rate.minor, "the rate per unit")?;
            }
            Self::FractionOfBasePerUnit {
                unit,
                hours_divisor,
                multiplier_bp,
                ..
            } => {
                positive(hours_divisor, "the divisor of hours")?;
                positive(multiplier_bp, "the multiplier")?;
                if !unit.is_counted_in_hours() {
                    return Err(ComponentError::UnitIsNotCountedInHours { unit: unit.code() });
                }
            }
        }
        Ok(self)
    }

    /// Work out what this component comes to on one slip.
    ///
    /// Every input arrives in `facts`, which is the agreement the slip copied
    /// plus the counts the slip carries. Nothing is read, nothing is asked, and
    /// no other component is consulted — so the same slip and the same rate are
    /// the same figure forever.
    ///
    /// # Rounding
    ///
    /// Half up, once per division, on non-negative values only (every figure
    /// here is non-negative, and which way a line points is its kind). Stated
    /// in one place because a payslip is checked by hand and "half up" is what
    /// the person checking does.
    pub fn compute(&self, code: &str, facts: &SlipFacts) -> Result<Computed, ComponentError> {
        let overflow = || ComponentError::Overflow {
            code: code.to_owned(),
        };
        match *self {
            Self::FixedAmount { amount } => Ok(Computed {
                amount,
                base_of: None,
                units: None,
                unit_rate: None,
            }),
            Self::ShareOfBase { base, rate_bp, cap } => {
                let whole = facts.base_of(base).minor;
                // The cap is on the base, not on the contribution. BPJS
                // Kesehatan caps the *wage* a percentage is taken of; capping
                // the result instead gives the same answer for one rate and a
                // different one for every other, which is the sort of bug that
                // is only wrong after a regulation changes.
                let capped = cap.map_or(whole, |cap| whole.min(cap.minor));
                let amount = scale(i128::from(capped), i128::from(rate_bp), BASIS_POINTS)
                    .ok_or_else(overflow)?;
                Ok(Computed {
                    amount: Money::new(amount),
                    base_of: Some(Money::new(capped)),
                    units: None,
                    unit_rate: None,
                })
            }
            Self::RatePerUnit { unit, rate } => {
                let units = facts.units(unit);
                let amount = scale(i128::from(rate.minor), i128::from(units), unit.per_whole())
                    .ok_or_else(overflow)?;
                Ok(Computed {
                    amount: Money::new(amount),
                    base_of: None,
                    units: Some(units),
                    unit_rate: Some(rate),
                })
            }
            Self::FractionOfBasePerUnit {
                base,
                unit,
                hours_divisor,
                multiplier_bp,
            } => {
                let whole = facts.base_of(base).minor;
                // The hourly wage, rounded to the smallest unit before it is
                // multiplied. Two roundings rather than one, deliberately: this
                // intermediate is *upah sejam*, the figure a payslip prints and
                // a person checks, so the line has to carry the same number
                // they would compute — and `unit_rate × units / per_whole`
                // must reproduce `amount` exactly from the row alone.
                let hourly = scale(
                    i128::from(whole),
                    i128::from(multiplier_bp),
                    i128::from(hours_divisor)
                        .checked_mul(BASIS_POINTS)
                        .ok_or_else(overflow)?,
                )
                .ok_or_else(overflow)?;
                let units = facts.units(unit);
                let amount = scale(i128::from(hourly), i128::from(units), unit.per_whole())
                    .ok_or_else(overflow)?;
                Ok(Computed {
                    amount: Money::new(amount),
                    base_of: Some(Money::new(whole)),
                    units: Some(units),
                    unit_rate: Some(Money::new(hourly)),
                })
            }
        }
    }
}

fn positive(value: i64, field: &'static str) -> Result<(), ComponentError> {
    if value <= 0 {
        return Err(ComponentError::NotPositive { field });
    }
    Ok(())
}

/// `value × numerator / denominator`, rounded half up, in `i128` so no
/// intermediate can wrap.
///
/// `None` rather than a wrapped figure: an overflowed total is a wrong number
/// that looks like a right one.
fn scale(value: i128, numerator: i128, denominator: i128) -> Option<i64> {
    debug_assert!(denominator > 0, "a denominator of nought is not a division");
    let product = value.checked_mul(numerator)?;
    let rounded = product.checked_add(denominator / 2)? / denominator;
    i64::try_from(rounded).ok()
}

/// What a component came to, and every intermediate it formed on the way.
///
/// The intermediates are returned rather than discarded because this estate has
/// already been bitten by the other choice: a computation that keeps less than
/// it derives leaves a figure nobody can explain, and the explanation is needed
/// exactly when somebody disputes their payslip.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Computed {
    pub amount: Money,
    /// The figure the share was actually taken of — after any cap.
    pub base_of: Option<Money>,
    /// The count, in the unit's own stored scale.
    pub units: Option<i64>,
    /// The per-whole-unit figure used: money per day, or the hourly wage.
    pub unit_rate: Option<Money>,
}

/// Everything a component may look at.
///
/// Deliberately a plain struct of copied figures rather than a handle on
/// anything: it is assembled from one `payroll_slip` row and the overtime bands
/// counted off that month's agreed orders, so a component cannot reach a
/// database, a clock, or another component even by accident.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SlipFacts {
    /// *Gaji pokok*, as the slip copied it.
    pub base: Money,
    /// Base plus standing allowances, as the slip copied it.
    pub statutory_base: Money,
    /// Agreed overtime **minutes**, per band, off that month's agreed orders.
    pub overtime_workday_first_hour: i64,
    pub overtime_workday_later: i64,
    pub overtime_rest_day: i64,
    pub overtime_holiday: i64,
    /// The rest-day and holiday tiers past the first (0808), each counting
    /// only the minutes in it.
    pub overtime_rest_day_next_hour: i64,
    pub overtime_rest_day_beyond: i64,
    pub overtime_holiday_next_hour: i64,
    pub overtime_holiday_beyond: i64,
    /// Whole days.
    pub rostered_days: i64,
    pub leave_days_taken: i64,
}

impl SlipFacts {
    pub const fn base_of(&self, base: ComponentBase) -> Money {
        match base {
            ComponentBase::Base => self.base,
            ComponentBase::StatutoryBase => self.statutory_base,
        }
    }

    pub const fn units(&self, unit: CountedUnit) -> i64 {
        match unit {
            CountedUnit::OvertimeWorkdayFirstHour => self.overtime_workday_first_hour,
            CountedUnit::OvertimeWorkdayLater => self.overtime_workday_later,
            CountedUnit::OvertimeRestDay => self.overtime_rest_day,
            CountedUnit::OvertimeHoliday => self.overtime_holiday,
            CountedUnit::OvertimeRestDayNextHour => self.overtime_rest_day_next_hour,
            CountedUnit::OvertimeRestDayBeyond => self.overtime_rest_day_beyond,
            CountedUnit::OvertimeHolidayNextHour => self.overtime_holiday_next_hour,
            CountedUnit::OvertimeHolidayBeyond => self.overtime_holiday_beyond,
            CountedUnit::RosteredDay => self.rostered_days,
            CountedUnit::LeaveDayTaken => self.leave_days_taken,
        }
    }
}
