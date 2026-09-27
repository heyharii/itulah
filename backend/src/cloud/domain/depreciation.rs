//! Monthly depreciation, in exact integers.
//!
//! Ported from `~/Documents/fresh/crates/finance-domain/src/depreciation.rs`,
//! which is itself the third attempt at this arithmetic. Two of its scars are
//! worth carrying forward verbatim.
//!
//! **The ×100 bug is not carried over.** The original Go query multiplied cost,
//! salvage and accumulated depreciation by 100 before dividing, so the second
//! month compounded the error of the first. Nothing here scales anything: every
//! amount in and out is a plain count of minor units.
//!
//! **No floating point.** Declining balance in Go was
//! `int64(float64(nbv) * (2.0/months) / 12.0)`. Here it is
//! `2 × nbv / (12 × months)` in `i128`, which agrees with the float form
//! wherever the float form is exact and is right where it is not. An `f64` has
//! 53 bits of mantissa; rupiah balances at this client exceed that within a
//! year of trading.
//!
//! **Every refusal is named.** A degenerate asset returns a `Skip` carrying a
//! reason, never a silent zero. A run report that says "no entry" without
//! saying why is a report somebody has to re-derive by hand.

use serde::{Deserialize, Serialize};

/// How an asset loses value, in the client's own terms.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum DepreciationMethod {
    /// Garis Lurus — `(cost − salvage) / months`, truncated.
    StraightLine,
    /// Saldo Menurun — `2 × book value / (12 × months)`, truncated.
    Declining,
    /// Tidak Disusutkan. Land is the ordinary case, and it is a method rather
    /// than an absent value so that no caller has to filter before asking.
    None,
}

impl DepreciationMethod {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "STRAIGHT_LINE" => Some(Self::StraightLine),
            "DECLINING" => Some(Self::Declining),
            "NONE" => Some(Self::None),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::StraightLine => "STRAIGHT_LINE",
            Self::Declining => "DECLINING",
            Self::None => "NONE",
        }
    }

    /// What the client calls it. Shown on the screen beside the account, so an
    /// accountant recognises the policy rather than translating it.
    pub const fn label(self) -> &'static str {
        match self {
            Self::StraightLine => "Garis Lurus",
            Self::Declining => "Saldo Menurun",
            Self::None => "Tidak Disusutkan",
        }
    }
}

/// What a monthly charge against an asset is CALLED, which is a different
/// question from how it is worked out.
///
/// Six of the client's seven asset families depreciate. The seventh does not,
/// and their chart says so in its own words: `1021607` is *Reserve
/// Replacement - Operating Equipment*, and its expense side is `7010215 BIAYA
/// REPLACEMENT`. Racks and hangers are not written down over a useful life,
/// they are replaced, and the cost of replacing them is accrued. One family
/// further on, `10217 INTANGIBLE ASSET` is amortised through `1021702` and
/// `7010216`.
///
/// The arithmetic is identical in all three cases — that is why this is not a
/// `DepreciationMethod` variant. `method` answers "how is the value spread";
/// this answers "what is the charge, and therefore which pair of accounts does
/// it land in". Keeping them apart is what stops the client's own register
/// from switching an accrual off: it writes `NON DEPRECIABLE` against 200
/// operating-equipment rows that it charges every single month.
///
/// The accounts themselves are still never named here. Each variant names
/// three MEANINGS, and `account_resolution` turns a meaning plus a unit plus a
/// qualifier into the client's account — exactly as every other posting rule
/// resolves one. The unit is the one that owns the asset's site.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum ChargeKind {
    /// Penyusutan. Six families, and the ordinary case.
    Depreciation,
    /// Cadangan Penggantian. Operating equipment: accrued to be replaced, and
    /// credited to a reserve rather than to accumulated depreciation.
    ReplacementReserve,
    /// Amortisasi. Intangibles.
    Amortisation,
}

impl ChargeKind {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "DEPRECIATION" => Some(Self::Depreciation),
            "REPLACEMENT_RESERVE" => Some(Self::ReplacementReserve),
            "AMORTISATION" => Some(Self::Amortisation),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Depreciation => "DEPRECIATION",
            Self::ReplacementReserve => "REPLACEMENT_RESERVE",
            Self::Amortisation => "AMORTISATION",
        }
    }

    /// What the client calls it, for the same reason `DepreciationMethod` has
    /// one: an accountant should recognise their own policy on the screen
    /// rather than translate it.
    pub const fn label(self) -> &'static str {
        match self {
            Self::Depreciation => "Penyusutan",
            Self::ReplacementReserve => "Cadangan Penggantian",
            Self::Amortisation => "Amortisasi",
        }
    }

    /// Where the asset's COST sits. Operating equipment is still a fixed asset
    /// — `1021507` is a family under `10215` — so only an intangible differs.
    pub const fn cost_key(self) -> &'static str {
        match self {
            Self::Depreciation | Self::ReplacementReserve => "fixed_asset",
            Self::Amortisation => "intangible_asset",
        }
    }

    /// The contra account the monthly charge credits, and disposal debits back.
    pub const fn contra_key(self) -> &'static str {
        match self {
            Self::Depreciation => "accumulated_depreciation",
            Self::ReplacementReserve => "replacement_reserve",
            Self::Amortisation => "accumulated_amortisation",
        }
    }

    /// The expense account the monthly charge debits.
    pub const fn expense_key(self) -> &'static str {
        match self {
            Self::Depreciation => "depreciation_expense",
            Self::ReplacementReserve => "replacement_expense",
            Self::Amortisation => "amortisation_expense",
        }
    }

    /// Both accounts a run needs, in the order a reader expects them.
    pub const fn charge_keys(self) -> [&'static str; 2] {
        [self.expense_key(), self.contra_key()]
    }

    /// Which `depreciation_kind` the charge is, on the one account all three
    /// expenses now share.
    ///
    /// `7010212 BIAYA DEPRESIASI` and `7010215 BIAYA REPLACEMENT OPERATING
    /// EQUIPMENT` both became `7101`, and on the balance sheet the difference
    /// survives — accumulated depreciation is `1609`, the reserve is `1610` —
    /// but on the profit and loss the two had become one number. This whole
    /// module exists because the client does NOT depreciate operating
    /// equipment: a rack is charged against a reserve and replaced. A P&L that
    /// cannot show that has lost the distinction 0159 was written for, so 0294
    /// gave `7101` a category and this is where the three kinds say which.
    pub const fn expense_category(self) -> &'static str {
        match self {
            Self::Depreciation => "DEPRECIATION",
            Self::ReplacementReserve => "REPLACEMENT",
            Self::Amortisation => "AMORTISATION",
        }
    }

    /// Where a capitalised asset's cost sits, when its account keeps stages
    /// apart.
    ///
    /// `1601 Aset tetap` does — finished work and work in progress are one
    /// account now — and `1602`, which takes the intangibles, does not. `None`
    /// is therefore a real answer and not a gap: an account that declares no
    /// family refuses a category, so returning one for an intangible would
    /// refuse every amortised asset's capitalisation.
    pub const fn cost_category(self) -> Option<&'static str> {
        match self {
            Self::Depreciation | Self::ReplacementReserve => Some(ASSET_IN_SERVICE),
            Self::Amortisation => None,
        }
    }
}

/// An asset whose cost is finished work, carried on `1601`.
pub const ASSET_IN_SERVICE: &str = "IN_SERVICE";

/// And one that is still being built. The client's `1031803 Contract In
/// Progress` became this: a category on `1601` rather than an account, which is
/// what makes capitalisation a real move again instead of `Dr 1601 / Cr 1601`
/// for the same asset — a journal that says nothing and a balance sheet on
/// which unfinished work cannot be separated from finished.
pub const ASSET_IN_PROGRESS: &str = "IN_PROGRESS";

/// One asset's depreciable state for one month.
#[derive(Clone, Copy, Debug)]
pub struct Basis {
    pub method: DepreciationMethod,
    pub capitalized_cost_minor: i64,
    pub salvage_value_minor: i64,
    pub useful_life_months: i32,
    /// What has already been posted against this asset, summed from the entries
    /// that exist. Passed in rather than stored on the asset: it is a sum over
    /// facts, and the caller reads it from the ledger.
    pub accumulated_minor: i64,
    /// Which instalment this is, counted from the month the asset went into
    /// service: 0 for the first, `useful_life_months - 1` for the last.
    ///
    /// Derived from the CALENDAR — months between `in_service_on` and the month
    /// being run — and deliberately not from a count of entries already
    /// written. A small asset with a long life charges zero for months at a
    /// time, and an index that only advanced when something was posted would
    /// leave such an asset permanently one instalment short of its last, so it
    /// would never sweep its remainder and never come off the register.
    ///
    /// The index is also what lets a schedule end at all. Declining balance
    /// takes a shrinking share of a shrinking book value, so it approaches
    /// salvage asymptotically; only naming the final instalment terminates it.
    pub period_index: i32,
}

/// What a run decided about one asset.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Outcome {
    /// Post this much this month.
    Post(i64),
    /// Nothing to post, and exactly why.
    Skip(SkipReason),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum SkipReason {
    /// The category does not depreciate. Land.
    NotDepreciated,
    /// Already down to salvage, or past the end of the schedule. Not an error:
    /// the asset stays on the books at its residual value.
    FullyDepreciated,
    /// This month's share rounds to nothing — a small asset spread over a long
    /// life. A real answer, and distinct from being finished: the remainder is
    /// still owed and the final instalment will sweep it.
    BelowSmallestUnit,
    /// Cost at or below salvage: there was never anything to depreciate.
    NothingAboveSalvage,
    /// A depreciable method with no months to spread over. The schema forbids
    /// it; this is the belt to that pair of braces.
    NoUsefulLife,
}

/// This month's charge, or the reason there is none.
///
/// The cap is the whole of the correctness argument: an asset may never
/// depreciate below its salvage value, so the last month is a remainder rather
/// than a full instalment. Without it, an asset whose life does not divide its
/// depreciable amount evenly walks past salvage by the accumulated truncation.
pub fn monthly_charge(basis: Basis) -> Outcome {
    if basis.method == DepreciationMethod::None {
        return Outcome::Skip(SkipReason::NotDepreciated);
    }
    if basis.useful_life_months <= 0 {
        return Outcome::Skip(SkipReason::NoUsefulLife);
    }
    let depreciable = basis
        .capitalized_cost_minor
        .saturating_sub(basis.salvage_value_minor);
    if depreciable <= 0 {
        return Outcome::Skip(SkipReason::NothingAboveSalvage);
    }
    let remaining = depreciable.saturating_sub(basis.accumulated_minor);
    if remaining <= 0 || basis.period_index >= basis.useful_life_months {
        return Outcome::Skip(SkipReason::FullyDepreciated);
    }

    // The last instalment takes whatever is left.
    //
    // Both methods need this and for different reasons. Straight line truncates
    // every month, so 1,000,000 over three months charges 333,333 three times
    // and stops one short — the asset then sits a rupiah above salvage forever
    // and appears on every reconciliation after that. Declining balance is
    // worse: it takes a shrinking share of a shrinking book value, so it
    // approaches salvage asymptotically and would never arrive at all.
    //
    // Naming the final period rather than guessing from the amounts is what
    // makes both schedules end exactly on salvage, which is the property the
    // tests below check across awkward divisions.
    if basis.period_index == basis.useful_life_months - 1 {
        return Outcome::Post(remaining);
    }

    // i128 throughout: `2 × book value × …` overflows i64 for a large enough
    // asset, and an overflow here would be a negative depreciation charge.
    let raw: i128 = match basis.method {
        DepreciationMethod::StraightLine => {
            i128::from(depreciable) / i128::from(basis.useful_life_months)
        }
        DepreciationMethod::Declining => {
            let book =
                i128::from(basis.capitalized_cost_minor) - i128::from(basis.accumulated_minor);
            2 * book / (12 * i128::from(basis.useful_life_months))
        }
        DepreciationMethod::None => 0,
    };

    // Truncation can produce zero on a small asset with a long life. That is a
    // real answer — the asset charges nothing this month — but posting a
    // journal of zero would put an empty entry in the books every month for
    // years. It is NOT "fully depreciated": the remainder is still owed, and
    // the final instalment above sweeps it, which is why the period index has
    // to come from the calendar rather than from the entries written.
    if raw <= 0 {
        return Outcome::Skip(SkipReason::BelowSmallestUnit);
    }
    Outcome::Post(i64::try_from(raw).unwrap_or(i64::MAX).min(remaining))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn basis(method: DepreciationMethod, cost: i64, salvage: i64, months: i32, acc: i64) -> Basis {
        at(method, cost, salvage, months, acc, 0)
    }

    fn at(
        method: DepreciationMethod,
        cost: i64,
        salvage: i64,
        months: i32,
        acc: i64,
        periods: i32,
    ) -> Basis {
        Basis {
            method,
            capitalized_cost_minor: cost,
            salvage_value_minor: salvage,
            useful_life_months: months,
            accumulated_minor: acc,
            period_index: periods,
        }
    }

    #[test]
    fn straight_line_spreads_the_depreciable_amount() {
        let outcome = monthly_charge(basis(
            DepreciationMethod::StraightLine,
            12_000_000,
            0,
            12,
            0,
        ));
        assert_eq!(outcome, Outcome::Post(1_000_000));
    }

    #[test]
    fn straight_line_never_depreciates_past_salvage() {
        // 10,000,000 cost, 1,000,000 salvage, 4 months: 2,250,000 a month. After
        // three months 6,750,000 is posted and only 2,250,000 remains — the
        // fourth instalment is exactly the remainder, not a fourth full charge.
        let last = monthly_charge(at(
            DepreciationMethod::StraightLine,
            10_000_000,
            1_000_000,
            4,
            6_750_000,
            3,
        ));
        assert_eq!(last, Outcome::Post(2_250_000));
        let after = monthly_charge(at(
            DepreciationMethod::StraightLine,
            10_000_000,
            1_000_000,
            4,
            9_000_000,
            4,
        ));
        assert_eq!(after, Outcome::Skip(SkipReason::FullyDepreciated));
    }

    #[test]
    fn truncation_never_walks_past_salvage() {
        // 1,000,000 over 3 months truncates to 333,333 a month. Two months give
        // 666,666; the third must be 333,334 and not 333,333, or the asset ends
        // one unit above salvage forever.
        let mut accumulated = 0;
        let mut charges = Vec::new();
        for period in 0..3 {
            match monthly_charge(at(
                DepreciationMethod::StraightLine,
                1_000_000,
                0,
                3,
                accumulated,
                period,
            )) {
                Outcome::Post(amount) => {
                    accumulated += amount;
                    charges.push(amount);
                }
                Outcome::Skip(reason) => panic!("unexpected skip: {reason:?}"),
            }
        }
        assert_eq!(charges, vec![333_333, 333_333, 333_334]);
        assert_eq!(accumulated, 1_000_000);
    }

    #[test]
    fn declining_balance_uses_the_book_value_and_no_float() {
        // 2 × 10,000,000 / (12 × 5) = 333,333.33… → 333,333.
        let first = monthly_charge(basis(
            DepreciationMethod::Declining,
            10_000_000,
            1_000_000,
            5,
            0,
        ));
        assert_eq!(first, Outcome::Post(333_333));
        // The charge shrinks as the book value does — that is the method.
        let second = monthly_charge(at(
            DepreciationMethod::Declining,
            10_000_000,
            1_000_000,
            5,
            333_333,
            1,
        ));
        assert_eq!(second, Outcome::Post(322_222));
    }

    #[test]
    fn a_large_asset_does_not_overflow() {
        // Two hundred billion rupiah in minor units. `2 × book` in i64 would
        // wrap; in i128 it does not.
        let outcome = monthly_charge(basis(
            DepreciationMethod::Declining,
            200_000_000_000_000,
            0,
            120,
            0,
        ));
        assert_eq!(outcome, Outcome::Post(277_777_777_777));
    }

    /// Whatever the numbers, a schedule ends — and it ends exactly on salvage.
    ///
    /// This is the property the truncation sweep exists for, checked across
    /// awkward divisions rather than the one that happened to be written by
    /// hand. An asset that stops a rupiah short never leaves the register, and
    /// one that overshoots understates the books.
    #[test]
    fn every_schedule_lands_exactly_on_salvage() {
        for method in [
            DepreciationMethod::StraightLine,
            DepreciationMethod::Declining,
        ] {
            for &(cost, salvage, months) in &[
                (1_000_000_i64, 0_i64, 3_i32),
                (1_000_000, 1, 7),
                (999_999, 333, 11),
                (12_345_678, 1_234_567, 13),
                (100, 1, 97),
                (7, 0, 3),
                (500_000_000, 12_345, 60),
            ] {
                let depreciable = cost - salvage;
                let mut accumulated = 0_i64;
                // Run the calendar, not the entries: a quiet month is a skip
                // and the schedule carries on to its last instalment.
                for period in 0..months {
                    match monthly_charge(at(method, cost, salvage, months, accumulated, period)) {
                        Outcome::Post(amount) => {
                            assert!(amount > 0, "a posted charge is never zero");
                            accumulated += amount;
                            assert!(
                                accumulated <= depreciable,
                                "{method:?} {cost}/{salvage}/{months} went past salvage"
                            );
                        }
                        Outcome::Skip(SkipReason::BelowSmallestUnit) => {}
                        Outcome::Skip(reason) => {
                            panic!("{method:?} {cost}/{salvage}/{months} stopped: {reason:?}")
                        }
                    }
                }
                // And nothing more is owed after the last one.
                assert!(matches!(
                    monthly_charge(at(method, cost, salvage, months, accumulated, months)),
                    Outcome::Skip(SkipReason::FullyDepreciated)
                ));
                assert_eq!(
                    accumulated, depreciable,
                    "{method:?} {cost}/{salvage}/{months} stopped short of salvage"
                );
            }
        }
    }

    #[test]
    fn every_refusal_is_named() {
        assert_eq!(
            monthly_charge(basis(DepreciationMethod::None, 100, 0, 0, 0)),
            Outcome::Skip(SkipReason::NotDepreciated)
        );
        assert_eq!(
            monthly_charge(basis(DepreciationMethod::StraightLine, 100, 100, 12, 0)),
            Outcome::Skip(SkipReason::NothingAboveSalvage)
        );
        assert_eq!(
            monthly_charge(basis(DepreciationMethod::StraightLine, 100, 0, 0, 0)),
            Outcome::Skip(SkipReason::NoUsefulLife)
        );
    }
}
