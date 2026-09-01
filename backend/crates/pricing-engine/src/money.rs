//! Amounts, and arithmetic that refuses to lie about them.

use serde::{Deserialize, Serialize};

use crate::PricingError;

/// An amount, in the currency's smallest unit.
///
/// Integer, never floating point. A price is a count of the smallest coin, and
/// binary fractions cannot represent a tenth — the error is small enough to
/// pass every test and large enough to make a day's takings not reconcile.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Money {
    pub minor: i64,
}

impl Money {
    pub const ZERO: Self = Self { minor: 0 };

    pub const fn new(minor: i64) -> Self {
        Self { minor }
    }

    /// Addition that refuses to wrap. An overflowed total is a wrong number
    /// that looks like a right one.
    pub fn try_add(self, other: Self) -> Result<Self, PricingError> {
        self.minor
            .checked_add(other.minor)
            .map(Self::new)
            .ok_or(PricingError::AmountOverflow)
    }

    pub fn try_sub(self, other: Self) -> Result<Self, PricingError> {
        self.minor
            .checked_sub(other.minor)
            .map(Self::new)
            .ok_or(PricingError::AmountOverflow)
    }

    pub fn times(self, quantity: i64) -> Result<Self, PricingError> {
        self.minor
            .checked_mul(quantity)
            .map(Self::new)
            .ok_or(PricingError::AmountOverflow)
    }

    /// Take a share expressed in basis points, rounded half-up.
    ///
    /// Half-up rather than banker's rounding because a shopper reading a
    /// receipt expects the arithmetic they were taught, and a discount that
    /// rounds down half the time reads as the shop shaving the difference.
    pub fn basis_points(self, bps: i64) -> Result<Self, PricingError> {
        let scaled = self
            .minor
            .checked_mul(bps)
            .ok_or(PricingError::AmountOverflow)?;
        let rounded = if scaled >= 0 {
            (scaled + 5_000) / 10_000
        } else {
            (scaled - 5_000) / 10_000
        };
        Ok(Self::new(rounded))
    }

    /// This amount's share of `total`, apportioned by `weight`.
    ///
    /// Used to spread a flat discount across the lines it matched. Rounding is
    /// downward here, deliberately: the remainder is handed to the last line by
    /// the caller so the parts sum to exactly the whole. A discount that
    /// apportions to more than itself is money given away by arithmetic.
    pub fn share_of(self, weight: Money, total: Money) -> Result<Self, PricingError> {
        if total.minor <= 0 {
            return Ok(Self::ZERO);
        }
        let scaled = self
            .minor
            .checked_mul(weight.minor)
            .ok_or(PricingError::AmountOverflow)?;
        Ok(Self::new(scaled / total.minor))
    }

    pub const fn is_positive(self) -> bool {
        self.minor > 0
    }

    pub const fn is_negative(self) -> bool {
        self.minor < 0
    }

    /// Clamp to zero. A discount may never turn a line into a payout.
    pub const fn floor_at_zero(self) -> Self {
        if self.minor < 0 {
            Self::ZERO
        } else {
            self
        }
    }

    /// The smaller of the two. Named `at_most` rather than `min` so it cannot
    /// be confused with — or silently shadowed by — the ordering trait's.
    pub fn at_most(self, ceiling: Self) -> Self {
        if self.minor <= ceiling.minor {
            self
        } else {
            ceiling
        }
    }
}

/// ISO 4217, upper case. Carried explicitly so a cart can never quietly mix
/// two currencies and total them as if they were one.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Currency(pub String);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounding_a_share_follows_the_arithmetic_people_were_taught() {
        // 12,345 at 15% is 1,851.75 — a shopper expects 1,852.
        assert_eq!(
            Money::new(12_345).basis_points(1_500),
            Ok(Money::new(1_852))
        );
    }

    #[test]
    fn apportioning_never_hands_out_more_than_there_is() {
        // 10,000 split across three lines of equal weight: each gets 3,333 and
        // the caller owes the last line the remaining 1.
        let total = Money::new(30_000);
        let each = Money::new(10_000);
        let shares: Vec<i64> = (0..3)
            .map(|_| {
                each.share_of(Money::new(10_000), total)
                    .unwrap_or_else(|e| panic!("{e}"))
                    .minor
            })
            .collect();
        assert_eq!(shares, vec![3_333, 3_333, 3_333]);
        assert!(
            shares.iter().sum::<i64>() <= each.minor,
            "apportioned parts must never exceed the whole"
        );
    }

    #[test]
    fn a_discount_cannot_turn_a_line_into_a_payout() {
        assert_eq!(Money::new(-500).floor_at_zero(), Money::ZERO);
    }
}
