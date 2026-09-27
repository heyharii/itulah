//! Income tax kept back from a supplier at the moment of payment.
//!
//! An Indonesian company paying a domestic vendor for services, hire or
//! royalties does not pay the whole invoice. It keeps back the vendor's income
//! tax, remits it to the tax office in the vendor's name, and gives the vendor a
//! `bukti potong` — the certificate the vendor uses to claim it against their
//! own liability. The vendor is credited with the full amount and receives less.
//!
//! Pure, and on `kernel_purity`'s list, for a reason sharper than the
//! depreciation kernel's: this arithmetic decides a figure that is remitted to
//! a tax authority under somebody's name. A number that came out differently
//! depending on when it was computed, or on what else was in the database, would
//! be indefensible to the person whose certificate quotes it.
//!
//! # What the rate applies to
//!
//! The taxable base is the fee, NOT the fee plus VAT. A bill of 10,000,000 plus
//! 1,100,000 VAT withheld at 2% keeps back 200,000 and not 222,000. This is
//! `subtotal_minor`, which the bill already carries apart from `tax_minor`
//! precisely because they post to different accounts.
//!
//! # Why partial payments true up rather than round separately
//!
//! A bill may be paid in instalments, and 2% of a third of a bill, three times,
//! does not always equal 2% of the bill. Withholding each instalment
//! independently would leave the certificate a rupiah or two off the sum of the
//! payments, which is exactly the kind of difference that costs an afternoon.
//!
//! So each payment withholds the difference between what SHOULD have been
//! withheld on everything paid so far and what already has been. Every
//! intermediate figure is a floor of a cumulative total, so the final payment
//! trues the whole bill up on its own, with no special case for "the last one".

// What can be withheld, at what rate and onto which payable, is master data
// since 0469 (`tax_template`, ERPNext Tax Withholding Category). What stays
// here is the arithmetic, which must not depend on the database.

/// The tax on a base, floored.
///
/// Floored rather than rounded because the base is rupiah and the difference is
/// at most one of them, and because a consistent direction is worth more than
/// a marginally fairer one: the same base always gives the same figure, and the
/// cumulative rule below then cannot drift.
pub fn withheld_minor(rate_bp: i64, taxable_base_minor: i64) -> i64 {
    if rate_bp <= 0 || taxable_base_minor <= 0 {
        return 0;
    }
    ((taxable_base_minor as i128 * rate_bp as i128) / 10_000) as i64
}

/// How much of a bill's fee has been reached by paying `paid_minor` of it.
///
/// A payment settles the bill proportionally: part fee, part VAT. Nothing says
/// a supplier applies a part payment fee-first, and assuming they did would
/// withhold too much too early.
pub fn taxable_base_paid(subtotal_minor: i64, total_minor: i64, paid_minor: i64) -> i64 {
    if total_minor <= 0 || paid_minor <= 0 || subtotal_minor <= 0 {
        return 0;
    }
    let paid = paid_minor.min(total_minor);
    ((subtotal_minor as i128 * paid as i128) / total_minor as i128) as i64
}

/// What this payment keeps back.
///
/// `paid_before_minor` and `withheld_before_minor` are what earlier posted
/// payments against the same bill already did; both are zero for the first one.
/// The answer is never negative — a payment cannot un-withhold — and it is
/// never more than the payment itself.
pub fn withholding_on_payment(
    rate_bp: i64,
    subtotal_minor: i64,
    total_minor: i64,
    paid_before_minor: i64,
    paying_minor: i64,
    withheld_before_minor: i64,
) -> i64 {
    let base_now = taxable_base_paid(
        subtotal_minor,
        total_minor,
        paid_before_minor.saturating_add(paying_minor),
    );
    let target = withheld_minor(rate_bp, base_now);
    (target - withheld_before_minor).clamp(0, paying_minor)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SERVICE: i64 = 200;

    #[test]
    fn the_base_is_the_fee_and_not_the_fee_plus_vat() {
        // 10,000,000 fee + 1,100,000 VAT, paid in full.
        let withheld = withholding_on_payment(SERVICE, 10_000_000, 11_100_000, 0, 11_100_000, 0);
        assert_eq!(withheld, 200_000, "2% of the fee, not of the invoice");
    }

    #[test]
    fn three_instalments_withhold_exactly_what_one_payment_would() {
        // A fee of 10,000,001 makes every third an inexact number, which is the
        // case the cumulative rule exists for.
        let (subtotal, total) = (10_000_001, 11_100_001);
        let thirds = [3_700_000, 3_700_000, 3_700_001];
        let mut paid = 0;
        let mut withheld = 0;
        for part in thirds {
            withheld += withholding_on_payment(SERVICE, subtotal, total, paid, part, withheld);
            paid += part;
        }
        assert_eq!(paid, total);
        let in_one_go = withholding_on_payment(SERVICE, subtotal, total, 0, total, 0);
        assert_eq!(
            withheld, in_one_go,
            "instalments must reach the figure on the certificate"
        );
    }

    #[test]
    fn a_payment_never_withholds_more_than_it_pays_or_less_than_nothing() {
        // An earlier payment that somehow withheld too much cannot make this
        // one negative.
        assert_eq!(
            withholding_on_payment(SERVICE, 10_000_000, 10_000_000, 0, 1_000, 999_999),
            0
        );
        // A 100% rate on a payment smaller than the tax is capped at what left.
        assert_eq!(
            withholding_on_payment(10_000, 10_000_000, 10_000_000, 0, 1_000, 0),
            1_000
        );
    }

    #[test]
    fn nothing_is_withheld_from_nothing() {
        assert_eq!(withheld_minor(SERVICE, 0), 0);
        assert_eq!(withheld_minor(0, 10_000_000), 0);
        assert_eq!(taxable_base_paid(10_000_000, 0, 500), 0);
    }
}
