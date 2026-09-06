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

/// One thing that can be withheld from, and at what rate.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WithholdingCategory {
    /// What `supplier_invoice.withholding_code` stores.
    pub code: &'static str,
    pub label: &'static str,
    /// Basis points of the taxable base. 200 = 2%.
    pub rate_bp: i64,
    /// The meaning the credit posts to. Two, because PPh 23 is creditable
    /// against the vendor's annual liability and PPh 4(2) is final, and a
    /// creditable tax sitting in the same account as a final one is claimed
    /// back a year later by somebody reading the balance.
    ///
    /// The client's chart keeps only one of the two: `2012101002 Hutang Pajak
    /// PPH Pasal 23 (withold)` exists and nothing under `20121 HUTANG PAJAK`
    /// answers to PPh 4(2). `pph_final_payable` therefore has no account to be
    /// seeded to, and a rent payment refuses until the client opens one. That
    /// refusal is the point: the alternative is posting a final tax where a
    /// creditable one is expected, which nothing downstream would catch.
    pub payable_key: &'static str,
    /// Whether the tax is final for the vendor.
    pub is_final: bool,
}

/// The categories this system will compute.
///
/// Short on purpose. Every member is a rate that follows from what was bought
/// and from nothing else; the ones left out — construction services, most of
/// all — have rates that depend on whether the vendor holds a qualification
/// certificate, which is a fact about the vendor that nothing here records. A
/// code whose rate is a guess would be a guess that reaches a tax return.
pub const CATEGORIES: [WithholdingCategory; 4] = [
    WithholdingCategory {
        code: "PPH23_SERVICE",
        label: "PPh 23 — services (2%)",
        rate_bp: 200,
        payable_key: "pph23_payable",
        is_final: false,
    },
    WithholdingCategory {
        code: "PPH23_RENT_EQUIPMENT",
        label: "PPh 23 — hire of vehicles and equipment (2%)",
        rate_bp: 200,
        payable_key: "pph23_payable",
        is_final: false,
    },
    WithholdingCategory {
        code: "PPH23_ROYALTY",
        label: "PPh 23 — royalties and licences (15%)",
        rate_bp: 1_500,
        payable_key: "pph23_payable",
        is_final: false,
    },
    WithholdingCategory {
        code: "PPH42_RENT_PROPERTY",
        label: "PPh 4(2) — rent of land and buildings (10%, final)",
        rate_bp: 1_000,
        payable_key: "pph_final_payable",
        is_final: true,
    },
];

/// The category a bill names, or nothing when it names one this system does not
/// know. The database CHECK holds the same list; this is the lookup, not a
/// second opinion.
pub fn category(code: &str) -> Option<&'static WithholdingCategory> {
    CATEGORIES.iter().find(|entry| entry.code == code)
}

/// Every code, for a screen that has to offer a choice.
pub fn category_codes() -> [&'static str; 4] {
    [
        CATEGORIES[0].code,
        CATEGORIES[1].code,
        CATEGORIES[2].code,
        CATEGORIES[3].code,
    ]
}

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
    fn rent_of_a_building_is_final_and_ten_per_cent() {
        let rent = category("PPH42_RENT_PROPERTY").unwrap_or_else(|| panic!("no category"));
        assert!(rent.is_final);
        assert_eq!(withheld_minor(rent.rate_bp, 25_000_000), 2_500_000);
        assert_eq!(rent.payable_key, "pph_final_payable");
    }

    #[test]
    fn an_unknown_code_is_not_guessed_at() {
        assert!(category("PPH42_CONSTRUCTION").is_none());
        assert!(category("").is_none());
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
