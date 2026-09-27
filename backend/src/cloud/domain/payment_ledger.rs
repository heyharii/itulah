//! Splitting a settlement across open items, and putting an age in a bucket.
//!
//! Both are arithmetic, and both are the arithmetic somebody argues about at a
//! month end — so they are here, where they can be checked exhaustively in
//! microseconds, rather than inside a SQL string or a handler.
//!
//! Everything arrives as an argument. No date is named: an age reaches
//! `bucket_for` as a whole number of days that the caller worked out from the
//! calendar, for the same reason `depreciation::Basis` takes a period index. A
//! kernel that could ask what today is would put a September figure at the
//! mercy of when September was read.
//!
//! # Why over-settlement is refused here and not only by the database
//!
//! The CHECK on `payment_ledger_entry` and the trigger in 0144 are the
//! guarantee; this is the explanation, and it is a better one because it can
//! see all the allocations at once. A caller told "line 2 asks 3,000,000
//! against an item with 1,200,000 open" can fix that line. The same failure
//! arriving from the database names a whole settlement and a constraint.

use thiserror::Error;

// ---------------------------------------------------------------------------
// Ageing
// ---------------------------------------------------------------------------

/// The five buckets every ageing report in this system uses.
///
/// Named rather than a `Vec<(low, high)>` because the boundaries are not a
/// setting. Finance reads 1–30 / 31–60 / 61–90 / 90+ and a screen that could be
/// configured to something else would be a screen whose totals cannot be
/// compared with last month's.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum AgingBucket {
    /// Not yet due as at the reporting date. Zero days is due today, which is
    /// not late.
    Current,
    Days1To30,
    Days31To60,
    Days61To90,
    Over90,
}

/// Which bucket an age falls in.
///
/// `age_days` is the reporting date minus the date the balance became due,
/// so it is negative for something not due yet and zero on the day it falls
/// due. Both are Current: a bill due today is not overdue today.
pub const fn bucket_for(age_days: i64) -> AgingBucket {
    if age_days <= 0 {
        AgingBucket::Current
    } else if age_days <= 30 {
        AgingBucket::Days1To30
    } else if age_days <= 60 {
        AgingBucket::Days31To60
    } else if age_days <= 90 {
        AgingBucket::Days61To90
    } else {
        AgingBucket::Over90
    }
}

/// A running total per bucket.
///
/// Saturating rather than checked on purpose. A total is a report, and a report
/// that refused to draw because one number was implausibly large would hide the
/// other thirteen locations; the ledger's own amounts are already bounded by
/// the constraints that let them in.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct AgingTotals {
    pub current_minor: i64,
    pub days_1_30_minor: i64,
    pub days_31_60_minor: i64,
    pub days_61_90_minor: i64,
    pub over_90_minor: i64,
    pub total_minor: i64,
    /// How many items are behind these figures. The difference between one
    /// disputed invoice and a supplier nobody has paid for a quarter.
    pub items: i64,
    /// The age of the oldest thing still open. `None` when nothing is.
    pub oldest_days: Option<i64>,
}

impl AgingTotals {
    /// Put one open balance in its bucket.
    pub fn add(&mut self, age_days: i64, amount_minor: i64) {
        let slot = match bucket_for(age_days) {
            AgingBucket::Current => &mut self.current_minor,
            AgingBucket::Days1To30 => &mut self.days_1_30_minor,
            AgingBucket::Days31To60 => &mut self.days_31_60_minor,
            AgingBucket::Days61To90 => &mut self.days_61_90_minor,
            AgingBucket::Over90 => &mut self.over_90_minor,
        };
        *slot = slot.saturating_add(amount_minor);
        self.total_minor = self.total_minor.saturating_add(amount_minor);
        self.items = self.items.saturating_add(1);
        self.oldest_days = Some(match self.oldest_days {
            Some(oldest) if oldest >= age_days => oldest,
            _ => age_days,
        });
    }

    /// Fold another set of totals in, for rolling a party up into a unit or a
    /// unit up into a control account.
    pub fn absorb(&mut self, other: &Self) {
        self.current_minor = self.current_minor.saturating_add(other.current_minor);
        self.days_1_30_minor = self.days_1_30_minor.saturating_add(other.days_1_30_minor);
        self.days_31_60_minor = self.days_31_60_minor.saturating_add(other.days_31_60_minor);
        self.days_61_90_minor = self.days_61_90_minor.saturating_add(other.days_61_90_minor);
        self.over_90_minor = self.over_90_minor.saturating_add(other.over_90_minor);
        self.total_minor = self.total_minor.saturating_add(other.total_minor);
        self.items = self.items.saturating_add(other.items);
        self.oldest_days = match (self.oldest_days, other.oldest_days) {
            (Some(mine), Some(theirs)) => Some(mine.max(theirs)),
            (mine, None) => mine,
            (None, theirs) => theirs,
        };
    }
}

// ---------------------------------------------------------------------------
// Allocating a settlement
// ---------------------------------------------------------------------------

/// Why a proposed settlement cannot be applied.
///
/// Every variant names the position and both numbers, because the fix is
/// always to change one line of the settlement and the person doing it needs to
/// know which line and by how much.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum AllocationRefusal {
    #[error("a settlement has to allocate something; this one allocates nothing")]
    NothingToAllocate,
    #[error("{asked} allocations were offered against {open} open items")]
    Mismatched { asked: usize, open: usize },
    #[error("allocation {} is {amount_minor}; an allocation has to be a positive amount, and money coming back is a separate document", .index + 1)]
    NotPositive { index: usize, amount_minor: i64 },
    #[error("allocation {} asks {asked_minor} against an item with {open_minor} still open", .index + 1)]
    OverSettles {
        index: usize,
        asked_minor: i64,
        open_minor: i64,
    },
    #[error("{asked_minor} is more than the {open_minor} these items have open between them")]
    MoreThanIsOpen { asked_minor: i64, open_minor: i64 },
    #[error("the allocations total more than can be counted")]
    Overflow,
}

/// A settlement that has been checked against what is open.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Allocated {
    /// What this settlement applies in total.
    pub total_minor: i64,
    /// What each item is left with afterwards, in the order it was offered.
    /// This is the "what remains" a caller reports back.
    pub remaining_minor: Vec<i64>,
}

/// Check a settlement somebody has already apportioned.
///
/// `open` and `asked` are parallel: `asked[i]` is what this settlement puts
/// against the item with `open[i]` still on it. An item nothing is put against
/// is offered as zero and left alone.
pub fn check_allocations(open: &[i64], asked: &[i64]) -> Result<Allocated, AllocationRefusal> {
    if open.len() != asked.len() {
        return Err(AllocationRefusal::Mismatched {
            asked: asked.len(),
            open: open.len(),
        });
    }
    let mut total: i64 = 0;
    let mut remaining = Vec::with_capacity(open.len());
    for (index, (&want, &have)) in asked.iter().zip(open.iter()).enumerate() {
        if want < 0 {
            return Err(AllocationRefusal::NotPositive {
                index,
                amount_minor: want,
            });
        }
        if want > have {
            return Err(AllocationRefusal::OverSettles {
                index,
                asked_minor: want,
                open_minor: have,
            });
        }
        total = total.checked_add(want).ok_or(AllocationRefusal::Overflow)?;
        remaining.push(have - want);
    }
    if total == 0 {
        return Err(AllocationRefusal::NothingToAllocate);
    }
    Ok(Allocated {
        total_minor: total,
        remaining_minor: remaining,
    })
}

/// Apportion one amount across open items in the order they are given.
///
/// Oldest first is the caller's business, not this function's: it fills the
/// items in the order it receives them, and a caller that wants oldest-first
/// sorts them that way. Which is the honest arrangement — "oldest" needs a
/// calendar, and this module has none.
///
/// Refuses rather than leaving a remainder. A settlement with money left over
/// is a settlement against an item nobody has raised yet, and quietly dropping
/// the difference is how a bank balance and a sub-ledger part company.
pub fn spread(open: &[i64], amount_minor: i64) -> Result<Vec<i64>, AllocationRefusal> {
    if amount_minor <= 0 {
        return Err(AllocationRefusal::NotPositive {
            index: 0,
            amount_minor,
        });
    }
    let mut left = amount_minor;
    let mut spread = Vec::with_capacity(open.len());
    let mut available: i64 = 0;
    for &have in open {
        available = available.saturating_add(have.max(0));
        let take = left.min(have.max(0));
        spread.push(take);
        left -= take;
    }
    if left > 0 {
        return Err(AllocationRefusal::MoreThanIsOpen {
            asked_minor: amount_minor,
            open_minor: available,
        });
    }
    Ok(spread)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_day_a_balance_falls_due_is_not_a_late_day() {
        assert_eq!(bucket_for(-40), AgingBucket::Current);
        assert_eq!(bucket_for(0), AgingBucket::Current);
        assert_eq!(bucket_for(1), AgingBucket::Days1To30);
        assert_eq!(bucket_for(30), AgingBucket::Days1To30);
        assert_eq!(bucket_for(31), AgingBucket::Days31To60);
        assert_eq!(bucket_for(60), AgingBucket::Days31To60);
        assert_eq!(bucket_for(61), AgingBucket::Days61To90);
        assert_eq!(bucket_for(90), AgingBucket::Days61To90);
        assert_eq!(bucket_for(91), AgingBucket::Over90);
    }

    #[test]
    fn the_buckets_add_up_to_the_total_and_remember_the_oldest() {
        let mut totals = AgingTotals::default();
        totals.add(-5, 1_000);
        totals.add(15, 2_000);
        totals.add(200, 4_000);
        assert_eq!(totals.current_minor, 1_000);
        assert_eq!(totals.days_1_30_minor, 2_000);
        assert_eq!(totals.over_90_minor, 4_000);
        assert_eq!(totals.total_minor, 7_000);
        assert_eq!(totals.items, 3);
        assert_eq!(totals.oldest_days, Some(200));
    }

    #[test]
    fn absorbing_keeps_the_oldest_of_the_two() {
        let mut left = AgingTotals::default();
        left.add(10, 500);
        let mut right = AgingTotals::default();
        right.add(95, 700);
        left.absorb(&right);
        assert_eq!(left.total_minor, 1_200);
        assert_eq!(left.items, 2);
        assert_eq!(left.oldest_days, Some(95));
    }

    #[test]
    fn a_partial_settlement_leaves_the_remainder() {
        let applied = check_allocations(&[10_000, 4_000], &[6_000, 0])
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(applied.total_minor, 6_000);
        assert_eq!(applied.remaining_minor, vec![4_000, 4_000]);
    }

    #[test]
    fn settling_more_than_is_open_is_refused_and_says_which_line() {
        let refusal = check_allocations(&[10_000, 4_000], &[6_000, 9_000]);
        assert_eq!(
            refusal,
            Err(AllocationRefusal::OverSettles {
                index: 1,
                asked_minor: 9_000,
                open_minor: 4_000,
            })
        );
    }

    #[test]
    fn a_settlement_that_allocates_nothing_is_refused() {
        assert_eq!(
            check_allocations(&[10_000], &[0]),
            Err(AllocationRefusal::NothingToAllocate)
        );
    }

    #[test]
    fn spreading_fills_the_items_in_the_order_it_is_given_them() {
        assert_eq!(
            spread(&[3_000, 5_000, 2_000], 7_000),
            Ok(vec![3_000, 4_000, 0])
        );
    }

    #[test]
    fn spreading_more_than_is_open_is_refused_rather_than_left_over() {
        assert_eq!(
            spread(&[3_000, 2_000], 9_000),
            Err(AllocationRefusal::MoreThanIsOpen {
                asked_minor: 9_000,
                open_minor: 5_000,
            })
        );
    }

    #[test]
    fn what_spread_produces_is_what_check_accepts() {
        let open = [4_000_i64, 1_500, 9_000];
        let plan = spread(&open, 12_000).unwrap_or_else(|error| panic!("{error}"));
        let applied = check_allocations(&open, &plan).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(applied.total_minor, 12_000);
        assert_eq!(applied.remaining_minor, vec![0, 0, 2_500]);
    }
}
