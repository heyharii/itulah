//! Leave, counted in hundredths of a day.
//!
//! # Why not a float
//!
//! For the same reason money is not one: `0.1 + 0.2 != 0.3`, and a balance that
//! is off by 2⁻⁵² is a balance that fails an equality check nobody can explain.
//! Worse, it fails it only *sometimes* — the half-day that rounds correctly for
//! eleven months and not the twelfth.
//!
//! A half day is `50`, a day is `100`. Every arithmetic path that can overflow
//! returns a `Result`; the `Add` and `Sub` operators saturate and exist only for
//! folds over figures that are already known to be valid.

use super::error::LeaveError;
use serde::{Deserialize, Serialize};
use std::ops::{Add, Neg, Sub};

/// An amount of leave, in centidays.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct LeaveDays(i32);

/// A hundred years either way. Wide enough for any real entitlement and narrow
/// enough that a multiplication overflowing is a bug rather than a big number.
const MAX_CENTIDAYS: i32 = 100 * 365 * 100;

impl LeaveDays {
    pub const ZERO: Self = Self(0);
    pub const DAY: Self = Self(100);
    pub const HALF_DAY: Self = Self(50);

    pub fn from_days(days: i32) -> Result<Self, LeaveError> {
        days.checked_mul(100)
            .filter(|value| value.abs() <= MAX_CENTIDAYS)
            .map(Self)
            .ok_or(LeaveError::AmountOutOfRange { centidays: None })
    }

    pub fn from_centidays(centidays: i32) -> Result<Self, LeaveError> {
        if centidays.abs() > MAX_CENTIDAYS {
            return Err(LeaveError::AmountOutOfRange {
                centidays: Some(centidays),
            });
        }
        Ok(Self(centidays))
    }

    pub const fn centidays(self) -> i32 {
        self.0
    }

    /// For display only, never for arithmetic: truncating and then adding loses
    /// the remainder, and a screen that showed 9 where the ledger holds 9.50 is
    /// a screen somebody plans a week around.
    pub const fn whole_days(self) -> i32 {
        self.0 / 100
    }

    pub const fn is_zero(self) -> bool {
        self.0 == 0
    }
    pub const fn is_negative(self) -> bool {
        self.0 < 0
    }
    pub const fn is_positive(self) -> bool {
        self.0 > 0
    }

    pub fn checked_add(self, other: Self) -> Result<Self, LeaveError> {
        self.0
            .checked_add(other.0)
            .filter(|value| value.abs() <= MAX_CENTIDAYS)
            .map(Self)
            .ok_or(LeaveError::AmountOutOfRange { centidays: None })
    }

    pub fn checked_sub(self, other: Self) -> Result<Self, LeaveError> {
        self.0
            .checked_sub(other.0)
            .filter(|value| value.abs() <= MAX_CENTIDAYS)
            .map(Self)
            .ok_or(LeaveError::AmountOutOfRange { centidays: None })
    }

    pub fn min(self, other: Self) -> Self {
        Self(self.0.min(other.0))
    }

    /// A *quantity* of leave taken cannot be negative; only a balance can.
    pub fn clamp_non_negative(self) -> Self {
        Self(self.0.max(0))
    }
}

impl Add for LeaveDays {
    type Output = Self;
    fn add(self, other: Self) -> Self {
        Self(self.0.saturating_add(other.0))
    }
}

impl Sub for LeaveDays {
    type Output = Self;
    fn sub(self, other: Self) -> Self {
        Self(self.0.saturating_sub(other.0))
    }
}

impl Neg for LeaveDays {
    type Output = Self;
    fn neg(self) -> Self {
        Self(-self.0)
    }
}

impl std::fmt::Display for LeaveDays {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let whole = self.0 / 100;
        let fraction = (self.0 % 100).abs();
        if fraction == 0 {
            write!(f, "{whole} hari")
        } else {
            write!(f, "{whole}.{fraction:02} hari")
        }
    }
}
