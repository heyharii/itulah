//! The costing kernel, checked as rules rather than as examples.
//!
//! The unit tests beside `domain/costing.rs` pin down cases somebody chose.
//! These state what has to hold for queues nobody chose, which is the
//! difference that matters here: the cases in that file were written knowing
//! where the arithmetic is delicate, so they are exactly the cases that would
//! not catch a mistake somewhere else.
//!
//! Three properties, one per thing that can go wrong with money in a queue:
//!
//!   * a posting is worth the sum of what it took — nothing appears between the
//!     allocations and the total;
//!   * a queue consumed to zero pieces has zero money left — no rupiah is
//!     stranded on a layer with nothing on it to carry it out;
//!   * a split always sums to the correction — the halves are two views of one
//!     amount, never two roundings of it.

use inventory_backend::cloud::domain::{
    consume_fifo, split_price_correction, ConsumeError, CostLayerSlice, PriceCorrection,
};
use proptest::prelude::*;

/// A layer with a plausible shape: pieces and money that run out together.
fn a_layer() -> impl Strategy<Value = CostLayerSlice> {
    (1i64..500i64, 0i64..900_000_000i64, 19_000i32..21_000i32).prop_map(|(quantity, value, day)| {
        CostLayerSlice {
            remaining_quantity: quantity,
            remaining_value_minor: value,
            economic_day: day,
        }
    })
}

/// The queue as the caller builds it: oldest first.
fn a_queue() -> impl Strategy<Value = Vec<CostLayerSlice>> {
    prop::collection::vec(a_layer(), 1..8).prop_map(|mut layers| {
        layers.sort_by_key(|layer| layer.economic_day);
        layers
    })
}

proptest! {
    /// What a posting cost is exactly what its allocations came to.
    ///
    /// Stated because the number that reaches the general ledger is the total,
    /// and the numbers that explain it later are the allocations. If they can
    /// differ by a rupiah, then "which layers did this take" and "what did it
    /// cost" are two answers to one question, and the reconciliation that finds
    /// it will be a year old by then.
    #[test]
    fn a_posting_is_worth_the_sum_of_what_it_took(
        queue in a_queue(),
        wanted in 1i64..4_000i64,
    ) {
        let available: i64 = queue.iter().map(|l| l.remaining_quantity).sum();
        prop_assume!(wanted <= available);

        let taken = consume_fifo(&queue, wanted, 21_000)
            .unwrap_or_else(|error| panic!("{error:?}"));

        let pieces: i64 = taken.iter().map(|a| a.quantity).sum();
        prop_assert_eq!(pieces, wanted, "the allocations did not add up to the quantity");

        // Every allocation is inside the layer it names, and none of them is
        // negative money. A negative allocation would balance a total and be
        // nonsense on its own line.
        for allocation in &taken {
            let layer = queue[allocation.layer];
            prop_assert!(allocation.quantity > 0);
            prop_assert!(allocation.quantity <= layer.remaining_quantity);
            prop_assert!(allocation.value_minor >= 0);
            prop_assert!(allocation.value_minor <= layer.remaining_value_minor);
        }

        // Only the last layer touched may be partly taken. Anything else means
        // the queue was not read in order.
        for allocation in taken.iter().take(taken.len().saturating_sub(1)) {
            prop_assert_eq!(
                allocation.quantity,
                queue[allocation.layer].remaining_quantity,
                "a layer was skipped over while it still had pieces"
            );
        }
    }

    /// Consuming everything empties the queue: no pieces left, and no money.
    ///
    /// This is the property the whole design of `CostLayerSlice` exists for. A
    /// queue that carried a unit price instead of a value would fail this by a
    /// few rupiah on most inputs, and the residue would sit on layers with no
    /// quantity left — invisible in every report, and permanently in the
    /// difference between the stock ledger and the inventory account.
    #[test]
    fn consuming_everything_empties_the_queue(queue in a_queue()) {
        let available: i64 = queue.iter().map(|l| l.remaining_quantity).sum();
        let held: i64 = queue.iter().map(|l| l.remaining_value_minor).sum();

        let taken = consume_fifo(&queue, available, 21_000)
            .unwrap_or_else(|error| panic!("{error:?}"));
        let spent: i64 = taken.iter().map(|a| a.value_minor).sum();

        prop_assert_eq!(spent, held, "the queue closed holding money it could not spend");
    }

    /// Taking a queue apart one piece at a time spends exactly what it held.
    ///
    /// The same invariant under the access pattern that actually breaks it. One
    /// take of everything can round correctly by accident; a hundred takes of
    /// one cannot.
    #[test]
    fn a_queue_taken_a_piece_at_a_time_spends_all_of_it(queue in a_queue()) {
        let held: i64 = queue.iter().map(|l| l.remaining_value_minor).sum();
        let mut remaining = queue.clone();
        let mut spent = 0i64;

        loop {
            let left: i64 = remaining.iter().map(|l| l.remaining_quantity).sum();
            if left == 0 {
                break;
            }
            let taken = consume_fifo(&remaining, 1, 21_000)
                .unwrap_or_else(|error| panic!("{error:?}"));
            for allocation in &taken {
                spent += allocation.value_minor;
                remaining[allocation.layer].remaining_quantity -= allocation.quantity;
                remaining[allocation.layer].remaining_value_minor -= allocation.value_minor;
            }
        }

        prop_assert_eq!(spent, held);
        for layer in &remaining {
            prop_assert_eq!(layer.remaining_value_minor, 0, "a rupiah was stranded");
        }
    }

    /// Asking for more than the queue holds is refused, and the refusal carries
    /// the numbers a person needs.
    #[test]
    fn a_short_queue_refuses_and_says_what_it_has(
        queue in a_queue(),
        extra in 1i64..1_000i64,
    ) {
        let available: i64 = queue.iter().map(|l| l.remaining_quantity).sum();
        match consume_fifo(&queue, available + extra, 21_500) {
            Err(ConsumeError::Insufficient(short)) => {
                prop_assert_eq!(short.available_quantity, available);
                prop_assert_eq!(short.wanted_quantity, available + extra);
                prop_assert_eq!(short.as_of_day, 21_500);
                prop_assert_eq!(
                    short.newest_layer_day,
                    queue.iter().map(|l| l.economic_day).max()
                );
            }
            other => prop_assert!(false, "expected a shortfall, got {:?}", other),
        }
    }

    /// The split always sums to the correction, in both directions.
    ///
    /// A correction that does not add up to itself puts the difference nowhere:
    /// the inventory account and the cost of sales account are each wrong by a
    /// part of it, and the entry still balances because the credit to the
    /// supplier is the amount either way.
    #[test]
    fn a_split_always_sums_to_the_correction(
        layer_quantity in 1i64..5_000i64,
        consumed_fraction in 0.0f64..=1.0f64,
        amount in -500_000_000i64..500_000_000i64,
    ) {
        let consumed = ((layer_quantity as f64) * consumed_fraction) as i64;
        let split = split_price_correction(PriceCorrection {
            layer_quantity,
            consumed_quantity: consumed.min(layer_quantity),
            amount_minor: amount,
        })
        .unwrap_or_else(|error| panic!("{error:?}"));

        prop_assert_eq!(
            split.inventory_minor + split.cogs_minor,
            amount,
            "the split lost or invented money"
        );
    }

    /// A correction on goods nobody has touched is entirely inventory, and one
    /// on goods that have all gone is entirely cost of sales.
    ///
    /// The two ends, stated separately because they are the two cases somebody
    /// reading a posting will check by hand, and because a proportional
    /// formula that is off by one at the boundary passes the sum property.
    #[test]
    fn the_two_ends_of_a_split_are_whole(
        layer_quantity in 1i64..5_000i64,
        amount in -500_000_000i64..500_000_000i64,
    ) {
        let untouched = split_price_correction(PriceCorrection {
            layer_quantity,
            consumed_quantity: 0,
            amount_minor: amount,
        })
        .unwrap_or_else(|error| panic!("{error:?}"));
        prop_assert_eq!(untouched.inventory_minor, amount);
        prop_assert_eq!(untouched.cogs_minor, 0);

        let gone = split_price_correction(PriceCorrection {
            layer_quantity,
            consumed_quantity: layer_quantity,
            amount_minor: amount,
        })
        .unwrap_or_else(|error| panic!("{error:?}"));
        prop_assert_eq!(gone.inventory_minor, 0);
        prop_assert_eq!(gone.cogs_minor, amount);
    }

    /// A correction and its reversal come back to nothing.
    ///
    /// The reason `div_euclid` is in the kernel rather than a plain divide.
    /// Truncation toward zero rounds a debit note down and the credit note that
    /// undoes it down as well, so the pair leaves a rupiah behind on the layer
    /// — for the same goods, at the same moment, in opposite directions.
    #[test]
    fn a_correction_and_its_reversal_cancel(
        layer_quantity in 1i64..5_000i64,
        consumed_fraction in 0.0f64..=1.0f64,
        amount in -500_000_000i64..500_000_000i64,
    ) {
        let consumed = (((layer_quantity as f64) * consumed_fraction) as i64).min(layer_quantity);
        let forward = split_price_correction(PriceCorrection {
            layer_quantity,
            consumed_quantity: consumed,
            amount_minor: amount,
        })
        .unwrap_or_else(|error| panic!("{error:?}"));
        let back = split_price_correction(PriceCorrection {
            layer_quantity,
            consumed_quantity: consumed,
            amount_minor: -amount,
        })
        .unwrap_or_else(|error| panic!("{error:?}"));

        prop_assert_eq!(forward.inventory_minor + back.inventory_minor, 0);
        prop_assert_eq!(forward.cogs_minor + back.cogs_minor, 0);
    }
}
