//! Splitting a refund back across the tenders that paid for the sale.
//!
//! A shopper who paid Rp100.000 with a voucher and Rp400.000 with a card and
//! then returns Rp200.000 of goods is owed Rp200.000 — but not in any shape the
//! shop chooses. Money has to go back where it came from: value that arrived as
//! stored value returns as stored value, and value that arrived on a card
//! returns to that card. Giving the whole Rp200.000 back to the card converts a
//! voucher liability into cash on the shopper's behalf.
//!
//! # Proportional, and CUMULATIVE
//!
//! Each refund is proportional to what each tender has LEFT to give back, not
//! to the original split recomputed from scratch:
//!
//! ```text
//! remaining capacity = original applied − every allocation already committed
//! ```
//!
//! Computing each partial return independently looks equivalent and is not. Two
//! partials of an odd total each round on their own, and the pair can come to
//! more or less than the whole — so a full return would not land exactly on the
//! original payment. Against remaining balances it always does: the last refund
//! is whatever is left, and what is left is exact by construction.
//!
//! An allocation already committed still counts even while its provider call is
//! pending or has failed-but-retriable. That is decision K04: a refund that has
//! been promised is capacity that has been spent, whatever the card network has
//! done about it yet. Subtracting only SUCCEEDED refunds would let a second
//! return promise the same rupiah twice.
//!
//! # Rounding
//!
//! Floor every share, then hand the remaining rupiah out by largest fractional
//! remainder, ties broken by tender order. Decision D11, and the reason the
//! older "last tender takes the residual" rule was dropped: with four tenders
//! and a two-rupiah refund it could hand a tender a NEGATIVE share to make the
//! total work.
//!
//! Nothing here is a float. The fractional part is kept as an exact
//! `(numerator, denominator)` pair of integers, compared by cross-multiplying,
//! so two shares that are genuinely equal compare equal rather than to within
//! an epsilon.

/// What one tender can still give back.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Capacity {
    /// What this tender originally paid toward the amount due. Cash handed
    /// over and given back as change is NOT part of it — see `PaymentSummary`.
    pub original_minor: i64,
    /// Every allocation already committed against it: succeeded, pending, or
    /// failed and still to be retried. See the note above on K04.
    pub committed_minor: i64,
}

impl Capacity {
    pub fn remaining(self) -> i64 {
        (self.original_minor - self.committed_minor).max(0)
    }
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum RefundError {
    #[error("a refund has to be for something")]
    NotPositive,
    #[error("the tenders can still give back {capacity}, and the refund asked for {asked}")]
    ExceedsCapacity { capacity: i64, asked: i64 },
}

/// Split `amount_minor` across `tenders`, proportional to what each has left.
///
/// The answer is in the order the tenders were given, one share each, and it
/// always satisfies all five invariants at once:
///
/// * every share is at least nought;
/// * no share exceeds that tender's remaining capacity;
/// * the shares sum to exactly `amount_minor`;
/// * committing the result never lowers a tender's cumulative refund; and
/// * refunding everything left comes to exactly the original payments.
pub fn allocate(tenders: &[Capacity], amount_minor: i64) -> Result<Vec<i64>, RefundError> {
    if amount_minor <= 0 {
        return Err(RefundError::NotPositive);
    }
    let capacity: i64 = tenders.iter().map(|one| one.remaining()).sum();
    if amount_minor > capacity {
        return Err(RefundError::ExceedsCapacity {
            capacity,
            asked: amount_minor,
        });
    }

    // Floor first. `remaining * amount / capacity` is computed as one product
    // before dividing, so the division happens once and on the exact numerator
    // rather than on an already-rounded share.
    let mut shares = vec![0i64; tenders.len()];
    let mut remainders: Vec<(usize, i128)> = Vec::with_capacity(tenders.len());
    let mut handed = 0i64;
    for (index, tender) in tenders.iter().enumerate() {
        let left = tender.remaining() as i128;
        let exact = left * amount_minor as i128;
        let whole = (exact / capacity as i128) as i64;
        shares[index] = whole;
        handed += whole;
        remainders.push((index, exact % capacity as i128));
    }

    // Then the leftover rupiah, largest fractional remainder first. Every
    // denominator here is the same `capacity`, so comparing the numerators
    // compares the fractions — no division, no float, no epsilon.
    //
    // Ties go to the earlier tender. Stable rather than arbitrary: the same
    // sale refunded twice must split the same way, and "whichever the sort
    // happened to put first" is not the same way twice.
    remainders.sort_by(|left, right| right.1.cmp(&left.1).then(left.0.cmp(&right.0)));
    let mut left_over = amount_minor - handed;
    for (index, _) in &remainders {
        if left_over == 0 {
            break;
        }
        // A tender already at its remaining capacity takes no more, or the
        // rounding would push it past what it ever paid.
        if shares[*index] < tenders[*index].remaining() {
            shares[*index] += 1;
            left_over -= 1;
        }
    }

    // Unreachable while `amount <= capacity`: there is always somewhere for a
    // spare rupiah to go. Asserted rather than assumed, because the failure it
    // would otherwise produce is a refund that quietly does not add up.
    debug_assert_eq!(left_over, 0, "every rupiah of a refund must land somewhere");

    Ok(shares)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh(originals: &[i64]) -> Vec<Capacity> {
        originals
            .iter()
            .map(|minor| Capacity {
                original_minor: *minor,
                committed_minor: 0,
            })
            .collect()
    }

    fn commit(tenders: &mut [Capacity], shares: &[i64]) {
        for (tender, share) in tenders.iter_mut().zip(shares) {
            tender.committed_minor += share;
        }
    }

    /// The plan's worked example: voucher 100k, card 400k, refund 200k.
    #[test]
    fn a_partial_refund_goes_back_in_the_shape_it_arrived() {
        let shares = allocate(&fresh(&[100_000, 400_000]), 200_000)
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(shares, vec![40_000, 160_000]);
    }

    /// Golden fixture G05. Four tenders at 26/26/26/22, refunding two rupiah.
    ///
    /// The old "last tender takes the residual" rule gave `[1, 1, 1, -1]` here:
    /// three tenders rounded up and the last was handed a NEGATIVE share to
    /// make the total come to two. Largest remainder gives the two rupiah to
    /// the two largest fractions and nothing to anybody else.
    #[test]
    fn g05_four_tenders_and_two_rupiah() {
        let shares = allocate(&fresh(&[26_000, 26_000, 26_000, 22_000]), 2)
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(shares, vec![1, 1, 0, 0]);
        assert_eq!(shares.iter().sum::<i64>(), 2);
        assert!(shares.iter().all(|share| *share >= 0));
    }

    /// The whole point of measuring against what is LEFT.
    #[test]
    fn refunding_everything_lands_exactly_on_what_was_paid() {
        // An awkward split that does not divide: 3 tenders, an odd total, and
        // partial returns of sizes that each round.
        let originals = [100_000i64, 400_000, 38_201];
        let mut tenders = fresh(&originals);
        let mut given = vec![0i64; originals.len()];

        for step in [319_333i64, 101_101, 61_234, 56_533] {
            let shares = allocate(&tenders, step).unwrap_or_else(|error| panic!("{error}"));
            assert_eq!(shares.iter().sum::<i64>(), step, "each step is exact");
            commit(&mut tenders, &shares);
            for (total, share) in given.iter_mut().zip(&shares) {
                *total += share;
            }
        }

        assert_eq!(
            given,
            originals.to_vec(),
            "a full return comes back to exactly the original payments"
        );
    }

    #[test]
    fn a_tender_never_gives_back_more_than_it_took() {
        let tenders = vec![
            Capacity {
                original_minor: 100_000,
                committed_minor: 99_999,
            },
            Capacity {
                original_minor: 400_000,
                committed_minor: 0,
            },
        ];
        let shares = allocate(&tenders, 200_000).unwrap_or_else(|error| panic!("{error}"));
        assert!(shares[0] <= 1, "only a rupiah left on the voucher");
        assert_eq!(shares.iter().sum::<i64>(), 200_000);
    }

    #[test]
    fn a_refund_beyond_what_is_left_is_refused_rather_than_rounded_away() {
        let tenders = vec![Capacity {
            original_minor: 100_000,
            committed_minor: 60_000,
        }];
        assert_eq!(
            allocate(&tenders, 40_001),
            Err(RefundError::ExceedsCapacity {
                capacity: 40_000,
                asked: 40_001
            })
        );
        assert_eq!(allocate(&tenders, 0), Err(RefundError::NotPositive));
    }

    /// Every invariant, over a deterministic sweep of awkward shapes.
    ///
    /// Deterministic rather than random: the plan asks for a stored seed on
    /// failure, and a fixed sweep is the same guarantee with nothing to store.
    #[test]
    fn the_invariants_hold_across_a_sweep_of_partial_returns() {
        let shapes: [&[i64]; 6] = [
            &[1],
            &[1, 1],
            &[26_000, 26_000, 26_000, 22_000],
            &[100_000, 400_000],
            &[3, 5, 7, 11, 13],
            &[1_000_000, 1, 1, 1],
        ];
        // Refund in `parts` roughly equal instalments, then whatever is left.
        for originals in shapes {
            for parts in 1..=7i64 {
                let mut tenders = fresh(originals);
                let mut given = vec![0i64; originals.len()];
                let total: i64 = originals.iter().sum();
                let step = (total / parts).max(1);

                loop {
                    let left: i64 = tenders.iter().map(|one| one.remaining()).sum();
                    if left == 0 {
                        break;
                    }
                    let asked = step.min(left);
                    let shares = allocate(&tenders, asked)
                        .unwrap_or_else(|error| panic!("{originals:?}/{parts}: {error}"));

                    assert_eq!(shares.iter().sum::<i64>(), asked, "{originals:?}/{parts}");
                    for (index, share) in shares.iter().enumerate() {
                        assert!(*share >= 0, "{originals:?}/{parts}: negative share");
                        assert!(
                            *share <= tenders[index].remaining(),
                            "{originals:?}/{parts}: over capacity"
                        );
                    }
                    commit(&mut tenders, &shares);
                    for (running, share) in given.iter_mut().zip(&shares) {
                        *running += share;
                    }
                    for (index, running) in given.iter().enumerate() {
                        assert!(
                            *running <= originals[index],
                            "{originals:?}/{parts}: cumulative past the original"
                        );
                    }
                }

                assert_eq!(
                    given,
                    originals.to_vec(),
                    "{originals:?}/{parts}: full refund is not the original payment"
                );
            }
        }
    }
}
