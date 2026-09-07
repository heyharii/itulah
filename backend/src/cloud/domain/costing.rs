//! What an outflow took, and how a late price correction splits.
//!
//! Two decisions, both arithmetic, both kept away from the database so they can
//! be checked exhaustively. Ported from `~/newton/backend/internal/costing`,
//! whose `fifoQueue`/`Consume` pair is the agreed model — the port keeps its
//! rules and changes its numbers: Newton works in a four-place decimal, this
//! crate works in whole minor units like every other amount in it.
//!
//! # Why money is carried and not recomputed
//!
//! A layer arrives here as a remaining quantity AND a remaining value, not as a
//! quantity and a unit price. Seven pieces for 100,000 have no exact unit price,
//! and a queue that stored one would lose a rupiah on every partial take and
//! leave the last piece carrying a number nobody can reconcile. Carrying the
//! value means a partial take is a share of what is actually there, and the
//! pieces left behind keep exactly the money left behind.
//!
//! The consequence, stated as an invariant the property tests hold us to:
//!
//! > consuming a layer to zero pieces takes exactly the money that was on it,
//! > whatever order it was taken in and however many takes it needed.
//!
//! # Why the caller supplies the order
//!
//! The queue arrives already sorted — economic date, then recorded time, then
//! id. Doing it here would need a clock or a calendar type, and a kernel that
//! can name a date is one line from asking for today's. Dates reach this module
//! as plain day numbers, and only so a refusal can say when the basis it was
//! looking at ran out.

use serde::{Deserialize, Serialize};

/// One layer, as the queue sees it: what is left of it, in pieces and in money.
///
/// Both derived by the caller from the stock ledger. Neither is stored anywhere:
/// a residual column IS the authority the moment somebody updates it.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CostLayerSlice {
    /// Pieces still on this layer. Zero is allowed and simply contributes
    /// nothing; the caller does not have to filter before asking.
    pub remaining_quantity: i64,
    /// The money still on this layer, corrections already folded in.
    pub remaining_value_minor: i64,
    /// The layer's economic date as a day number, for the refusal message only.
    /// Nothing here compares it: the caller decided which layers were eligible
    /// before it built the queue.
    pub economic_day: i32,
}

/// What one outflow took from one layer.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FifoAllocation {
    /// Index into the queue that was handed in. An index rather than an id
    /// because the kernel has never seen an id and should not start.
    pub layer: usize,
    pub quantity: i64,
    pub value_minor: i64,
}

/// The queue could not cover the outflow, and what it could cover instead.
///
/// A refusal rather than a short fill. Consuming basis that is not there posts
/// a cost with nothing behind it, and the shortfall surfaces months later as a
/// variance nobody can explain.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FifoShortfall {
    pub wanted_quantity: i64,
    pub available_quantity: i64,
    /// The day the caller was asking as of.
    pub as_of_day: i32,
    /// The newest layer the queue could see, so a refusal can distinguish
    /// "we never received these" from "the ones we received are dated after
    /// the sale claims to have happened".
    pub newest_layer_day: Option<i32>,
}

/// Something the caller asked that has no arithmetic answer.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CostingRefusal {
    /// A quantity of zero or less. An outflow of nothing is not an outflow.
    QuantityNotPositive,
    /// A layer with negative pieces or negative money on it. The ledger would
    /// have to be corrupt for this to arrive, and continuing would spread it.
    LayerIsNegative,
    /// Money left on a layer with no pieces left to carry it out.
    LayerMoneyWithoutPieces,
    /// A correction against a layer that received nothing.
    LayerQuantityNotPositive,
    /// More consumed than the layer ever held.
    ConsumedMoreThanReceived,
}

impl CostingRefusal {
    /// What to tell whoever asked. Sentences, because these reach a person
    /// through the API and "invalid input" sends somebody to read source code.
    pub const fn message(self) -> &'static str {
        match self {
            Self::QuantityNotPositive => {
                "a quantity has to be positive: an outflow of nothing is not an outflow, and a \
                 negative one is the other direction, which is a different event"
            }
            Self::LayerIsNegative => {
                "a cost layer is carrying a negative quantity or a negative amount, which means \
                 the stock ledger behind it is wrong; consuming from it would spread the error \
                 into cost of goods"
            }
            Self::LayerMoneyWithoutPieces => {
                "a cost layer has money left on it and no pieces left to carry that money out, \
                 so the stock ledger behind it does not add up; goods that genuinely cost \
                 nothing are the other way round and are fine"
            }
            Self::LayerQuantityNotPositive => {
                "a price correction has to name a layer that actually received goods; there is \
                 nothing to spread the correction over"
            }
            Self::ConsumedMoreThanReceived => {
                "more has been consumed from this layer than it ever received, so the split \
                 between what is on hand and what was sold has no honest answer"
            }
        }
    }
}

/// Take `wanted` pieces from the head of the queue.
///
/// Only economic outflows reach here — a sale, a confirmed loss, a write-off, a
/// disposal. A DC-to-store transfer is not one of them: the goods are still
/// ours, still on our books, and consuming basis for them would post cost of
/// goods for a sale that has not happened. A supplier return is not one either;
/// those goods came from one particular receipt and go back to it, which is a
/// different function with a different signature and no fallback.
///
/// A layer that is taken to exactly zero pieces gives up everything left on it,
/// including whatever a partial take rounded away. That is what makes the queue
/// close at zero rather than at a residue nobody can spend.
pub fn consume_fifo(
    queue: &[CostLayerSlice],
    wanted: i64,
    as_of_day: i32,
) -> Result<Vec<FifoAllocation>, ConsumeError> {
    if wanted <= 0 {
        return Err(ConsumeError::Refused(CostingRefusal::QuantityNotPositive));
    }

    let mut available: i64 = 0;
    let mut newest: Option<i32> = None;
    for layer in queue {
        if layer.remaining_quantity < 0 || layer.remaining_value_minor < 0 {
            return Err(ConsumeError::Refused(CostingRefusal::LayerIsNegative));
        }
        // Only one direction is wrong. Pieces with no money on them are free
        // goods — a supplier bonus, a replacement — and they consume perfectly
        // well at nothing. Money with no pieces is a layer that cannot spend
        // what it is holding, which is the residue this whole design exists to
        // make impossible.
        if layer.remaining_quantity == 0 && layer.remaining_value_minor != 0 {
            return Err(ConsumeError::Refused(
                CostingRefusal::LayerMoneyWithoutPieces,
            ));
        }
        available = available.saturating_add(layer.remaining_quantity);
        newest = Some(match newest {
            Some(day) if day >= layer.economic_day => day,
            _ => layer.economic_day,
        });
    }
    if available < wanted {
        return Err(ConsumeError::Insufficient(FifoShortfall {
            wanted_quantity: wanted,
            available_quantity: available,
            as_of_day,
            newest_layer_day: newest,
        }));
    }

    let mut allocations = Vec::new();
    let mut left = wanted;
    for (index, layer) in queue.iter().enumerate() {
        if left == 0 {
            break;
        }
        if layer.remaining_quantity == 0 {
            continue;
        }
        let take = layer.remaining_quantity.min(left);
        // Emptying the layer takes what is on it. A share of the money would be
        // the same number in almost every case and one rupiah short in the ones
        // that matter, and the stranded rupiah would sit on a layer with no
        // pieces left to carry it out.
        let value = if take == layer.remaining_quantity {
            layer.remaining_value_minor
        } else {
            // i128 because a layer at this client can hold hundreds of millions
            // of rupiah and the multiply comes before the divide. Truncating
            // down leaves the remainder with the pieces that stay.
            let numerator = i128::from(layer.remaining_value_minor) * i128::from(take);
            (numerator / i128::from(layer.remaining_quantity)) as i64
        };
        allocations.push(FifoAllocation {
            layer: index,
            quantity: take,
            value_minor: value,
        });
        left -= take;
    }

    Ok(allocations)
}

/// Why a consumption could not be answered.
///
/// Two variants rather than one, because they are two different conversations:
/// a refusal is a caller mistake, and an insufficiency is a real business fact
/// with numbers a person will want to see.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConsumeError {
    Refused(CostingRefusal),
    Insufficient(FifoShortfall),
}

/// A price correction arriving after the goods, and what has happened to them.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PriceCorrection {
    /// Pieces the layer received.
    pub layer_quantity: i64,
    /// Pieces of it that have already gone out — sold, lost, written off, sent
    /// back. Not the pieces at any particular place: custody is not
    /// consumption.
    pub consumed_quantity: i64,
    /// Signed. The supplier billed more, or billed less.
    pub amount_minor: i64,
}

/// Where a correction lands: partly on the goods still held, partly on the cost
/// of the ones already gone.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CorrectionSplit {
    pub inventory_minor: i64,
    pub cogs_minor: i64,
}

/// Split a price correction between what is still on hand and what has sold.
///
/// This is the one place this implementation improves on the one it was ported
/// from. Newton debits inventory for the whole correction, which is right only
/// while none of the goods have moved. On a half-sold layer it leaves the sold
/// portion sitting in inventory forever: the asset is overstated by it, the
/// margin on those sales is overstated by it, and nothing ever clears it —
/// because the pieces that would have carried it out are already gone.
///
/// Splitting once, when the correction arrives, is deliberately not a full
/// repost. A repost would rewrite the cost of sales that have already been
/// reported, and is reserved for a restatement somebody signs for or a change of
/// costing method.
///
/// The two halves always sum to the amount, in both directions, with no rupiah
/// lost to rounding: the on-hand share is floored and the remainder goes to cost
/// of goods, which is the side that can absorb it without changing what the
/// stock is worth.
pub fn split_price_correction(
    correction: PriceCorrection,
) -> Result<CorrectionSplit, CostingRefusal> {
    if correction.layer_quantity <= 0 {
        return Err(CostingRefusal::LayerQuantityNotPositive);
    }
    if correction.consumed_quantity < 0 {
        return Err(CostingRefusal::LayerIsNegative);
    }
    if correction.consumed_quantity > correction.layer_quantity {
        return Err(CostingRefusal::ConsumedMoreThanReceived);
    }

    let on_hand = correction.layer_quantity - correction.consumed_quantity;
    // Truncation toward zero, which is what `/` does here, and it is the
    // rounding the reversal has to have. Flooring would round a debit note down
    // and round the credit note undoing it down as well, so the pair would leave
    // a rupiah behind on the layer — for the same goods, at the same moment, in
    // opposite directions. Truncation is symmetric about zero, and cancels.
    //
    // i128 because the multiply comes before the divide, and a correction on a
    // large layer overflows an i64 well inside this client's own numbers.
    let inventory = ((i128::from(correction.amount_minor) * i128::from(on_hand))
        / i128::from(correction.layer_quantity)) as i64;
    Ok(CorrectionSplit {
        inventory_minor: inventory,
        // Subtraction, never a second division. Two independent roundings are
        // how a split stops summing to the thing it split.
        cogs_minor: correction.amount_minor - inventory,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layer(quantity: i64, value: i64) -> CostLayerSlice {
        CostLayerSlice {
            remaining_quantity: quantity,
            remaining_value_minor: value,
            economic_day: 20_000,
        }
    }

    #[test]
    fn a_sale_takes_from_the_head_of_the_queue() {
        let queue = [layer(10, 1_250_000), layer(10, 1_300_000)];
        let taken = consume_fifo(&queue, 4, 20_010).unwrap_or_else(|error| panic!("{error:?}"));
        assert_eq!(taken.len(), 1);
        assert_eq!(taken[0].layer, 0);
        assert_eq!(taken[0].quantity, 4);
        assert_eq!(taken[0].value_minor, 500_000);
    }

    #[test]
    fn a_sale_that_outruns_one_layer_walks_on_to_the_next() {
        let queue = [layer(10, 1_250_000), layer(10, 1_300_000)];
        let taken = consume_fifo(&queue, 14, 20_010).unwrap_or_else(|error| panic!("{error:?}"));
        assert_eq!(taken.len(), 2);
        assert_eq!(taken[0].value_minor, 1_250_000);
        assert_eq!(taken[1].quantity, 4);
        assert_eq!(taken[1].value_minor, 520_000);
    }

    /// The rounding case that motivates carrying money on the layer. Seven
    /// pieces for 100,000 is 14,285.71 each; taking them one at a time must not
    /// leave the seventh carrying a different number from the other six's
    /// residue.
    #[test]
    fn taking_a_layer_one_piece_at_a_time_spends_all_of_it() {
        let mut quantity = 7i64;
        let mut value = 100_000i64;
        let mut spent = 0i64;
        while quantity > 0 {
            let queue = [layer(quantity, value)];
            let taken = consume_fifo(&queue, 1, 20_010).unwrap_or_else(|error| panic!("{error:?}"));
            spent += taken[0].value_minor;
            quantity -= 1;
            value -= taken[0].value_minor;
        }
        assert_eq!(spent, 100_000, "every rupiah left with a piece");
        assert_eq!(value, 0, "the layer closed at zero");
    }

    #[test]
    fn a_queue_that_cannot_cover_the_sale_says_what_it_has() {
        let queue = [layer(3, 300_000)];
        match consume_fifo(&queue, 5, 20_010) {
            Err(ConsumeError::Insufficient(short)) => {
                assert_eq!(short.available_quantity, 3);
                assert_eq!(short.wanted_quantity, 5);
                assert_eq!(short.as_of_day, 20_010);
                assert_eq!(short.newest_layer_day, Some(20_000));
            }
            other => panic!("expected a shortfall, got {other:?}"),
        }
    }

    #[test]
    fn an_empty_queue_refuses_and_says_it_has_nothing() {
        match consume_fifo(&[], 1, 20_010) {
            Err(ConsumeError::Insufficient(short)) => {
                assert_eq!(short.available_quantity, 0);
                assert_eq!(short.newest_layer_day, None);
            }
            other => panic!("expected a shortfall, got {other:?}"),
        }
    }

    #[test]
    fn a_correction_on_a_half_sold_layer_lands_on_both_sides() {
        let split = split_price_correction(PriceCorrection {
            layer_quantity: 10,
            consumed_quantity: 4,
            amount_minor: 50_000,
        })
        .unwrap_or_else(|error| panic!("{error:?}"));
        assert_eq!(split.inventory_minor, 30_000);
        assert_eq!(split.cogs_minor, 20_000);
    }

    #[test]
    fn a_correction_on_untouched_goods_is_all_inventory() {
        let split = split_price_correction(PriceCorrection {
            layer_quantity: 10,
            consumed_quantity: 0,
            amount_minor: -7_777,
        })
        .unwrap_or_else(|error| panic!("{error:?}"));
        assert_eq!(split.inventory_minor, -7_777);
        assert_eq!(split.cogs_minor, 0);
    }

    #[test]
    fn a_correction_on_goods_that_have_all_gone_is_all_cost_of_sales() {
        let split = split_price_correction(PriceCorrection {
            layer_quantity: 6,
            consumed_quantity: 6,
            amount_minor: 12_345,
        })
        .unwrap_or_else(|error| panic!("{error:?}"));
        assert_eq!(split.inventory_minor, 0);
        assert_eq!(split.cogs_minor, 12_345);
    }

    #[test]
    fn a_correction_against_nothing_is_refused() {
        assert_eq!(
            split_price_correction(PriceCorrection {
                layer_quantity: 0,
                consumed_quantity: 0,
                amount_minor: 1,
            }),
            Err(CostingRefusal::LayerQuantityNotPositive)
        );
    }
}
