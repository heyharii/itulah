//! What a line comes to, once tax has had its say.
//!
//! One implementation, because it was two. `cloud::domain::commercial` and
//! `edge::domain::commercial` each carried this function and its tests,
//! character for character — the centre's copy and a shop's copy of one
//! rounding rule.
//!
//! Two copies of a rounding rule agree on every ordinary day. They part company
//! the day somebody fixes one of them, and the symptom is a receipt printed at
//! a counter that does not match the same sale read back at head office, over a
//! rupiah nobody can find.
//!
//! Tax is not the pricing engine's job — it says so itself, and the
//! architecture keeps Tax a domain of its own — so this does not live there.
//! It lives here, above both nodes, because both nodes need exactly it.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// What can go wrong turning a price into a line.
#[derive(Debug, Error, Eq, PartialEq)]
pub enum TaxError {
    #[error("unit price cannot be negative")]
    NegativePrice,
    #[error("quantity must be positive")]
    NonPositiveQuantity,
    #[error("tax rate basis points are outside the supported range")]
    InvalidTaxRate,
    #[error("money arithmetic overflow")]
    MoneyOverflow,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LineTotals {
    pub net_minor: i64,
    pub tax_minor: i64,
    pub total_minor: i64,
}

pub fn calculate_line_totals(
    unit_price_minor: i64,
    quantity: i64,
    tax_rate_bps: i32,
    tax_inclusive: bool,
) -> Result<LineTotals, TaxError> {
    if unit_price_minor < 0 {
        return Err(TaxError::NegativePrice);
    }
    if quantity <= 0 {
        return Err(TaxError::NonPositiveQuantity);
    }
    if !(0..=100_000).contains(&tax_rate_bps) {
        return Err(TaxError::InvalidTaxRate);
    }
    let base = i128::from(unit_price_minor)
        .checked_mul(i128::from(quantity))
        .ok_or(TaxError::MoneyOverflow)?;
    let rate = i128::from(tax_rate_bps);
    let (net, tax, total) = if tax_inclusive {
        let tax = base
            .checked_mul(rate)
            .ok_or(TaxError::MoneyOverflow)?
            / (10_000 + rate);
        (base - tax, tax, base)
    } else {
        let tax = base
            .checked_mul(rate)
            .ok_or(TaxError::MoneyOverflow)?
            / 10_000;
        (base, tax, base + tax)
    };
    Ok(LineTotals {
        net_minor: i64::try_from(net).map_err(|_| TaxError::MoneyOverflow)?,
        tax_minor: i64::try_from(tax).map_err(|_| TaxError::MoneyOverflow)?,
        total_minor: i64::try_from(total).map_err(|_| TaxError::MoneyOverflow)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inclusive_tax_is_deterministic_integer_math() {
        let totals = calculate_line_totals(111_000, 2, 1_100, true)
            .unwrap_or_else(|e| panic!("totals: {e}"));
        assert_eq!(totals.total_minor, 222_000);
        assert_eq!(totals.tax_minor, 22_000);
        assert_eq!(totals.net_minor, 200_000);
    }

    #[test]
    fn exclusive_tax_adds_to_payable_total() {
        let totals = calculate_line_totals(100_000, 2, 1_100, false)
            .unwrap_or_else(|e| panic!("totals: {e}"));
        assert_eq!(
            totals,
            LineTotals {
                net_minor: 200_000,
                tax_minor: 22_000,
                total_minor: 222_000
            }
        );
    }
}
