use serde::{Deserialize, Serialize};
use thiserror::Error;

macro_rules! quantity_type {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(i64);

        impl $name {
            pub const fn value(self) -> i64 {
                self.0
            }
        }
    };
}

quantity_type!(StockQty);
quantity_type!(AllottedQty);
quantity_type!(OnHandQty);
quantity_type!(ShortfallQty);
quantity_type!(MissingQty);
quantity_type!(ObservedQty);

/// The identity a pool's six numbers satisfy, as every reader is told it.
///
/// One constant for both nodes, because it was five copies of a sentence that
/// stopped being true: `Stock = On Hand + Allotted + Missing` holds only while
/// a promise can never outrun the shelf it was made against, and a warehouse is
/// allowed to find out that it cannot keep one. See [`InventoryBalance::project`]
/// and `docs/inventory-ledger.md`.
pub const INVENTORY_EQUATION: &str = "Stock + Shortfall = On Hand + Allotted + Missing";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct InventoryBalance {
    pub stock: StockQty,
    /// What still has to leave this pool in a carton. `None` where the pool
    /// cannot be a source of a commitment.
    pub allotted: Option<AllottedQty>,
    /// What may still be spent. Never negative.
    pub on_hand: OnHandQty,
    /// By how much the promises outrun the goods. Nought unless they do.
    pub shortfall: ShortfallQty,
    pub missing: MissingQty,
    pub observed: ObservedQty,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum InventoryBalanceError {
    #[error("inventory balance components cannot be negative")]
    NegativeComponent,
    #[error("inventory balance arithmetic overflow")]
    ArithmeticOverflow,
}

impl InventoryBalance {
    /// Projects user-facing quantities from the neutral ledger balance.
    ///
    /// # `Stock = On Hand + Allotted + Missing` is no longer an invariant
    ///
    /// It held only while a promise could never outrun the shelf it was made
    /// against. `Allotted` is now what still has to go into a carton, and a
    /// warehouse is allowed to find out it cannot keep a promise — so the
    /// excess is reported as `shortfall` and On Hand stops at nought, rather
    /// than the screen showing a negative quantity of shirts.
    ///
    /// The clamp is also what keeps the fleet readable through the steps that
    /// follow: between retiring the pick that used to discharge a commitment
    /// and the routes that discharge it properly, a pool can carry more
    /// promise than stock for a while, and every list that reads it has to go
    /// on working.
    pub fn project(
        normal: i64,
        allotted: Option<i64>,
        missing: i64,
        observed: i64,
    ) -> Result<Self, InventoryBalanceError> {
        let allotted_value = allotted.unwrap_or_default();
        if normal < 0 || allotted_value < 0 || missing < 0 || observed < 0 {
            return Err(InventoryBalanceError::NegativeComponent);
        }
        let stock = normal
            .checked_add(missing)
            .ok_or(InventoryBalanceError::ArithmeticOverflow)?;
        let spendable = normal
            .checked_sub(allotted_value)
            .ok_or(InventoryBalanceError::ArithmeticOverflow)?;
        let result = Self {
            stock: StockQty(stock),
            allotted: allotted.map(AllottedQty),
            on_hand: OnHandQty(spendable.max(0)),
            shortfall: ShortfallQty((-spendable).max(0)),
            missing: MissingQty(missing),
            observed: ObservedQty(observed),
        };
        // What the old equation becomes once On Hand cannot go below nought.
        // Asserted rather than assumed, because every screen adds these up.
        debug_assert_eq!(
            result.stock.value() + result.shortfall.value(),
            result.on_hand.value() + allotted_value + result.missing.value()
        );
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_promise_past_the_shelf_is_a_shortfall_and_not_a_negative_shirt() {
        let balance = InventoryBalance::project(100, Some(250), 0, 0)
            .unwrap_or_else(|error| panic!("projection: {error}"));
        assert_eq!(balance.on_hand.value(), 0, "nothing left to spend");
        assert_eq!(balance.shortfall.value(), 150);
    }

    #[test]
    fn projection_guarantees_the_inventory_equation() {
        let balance = InventoryBalance::project(990, Some(200), 10, 850)
            .unwrap_or_else(|error| panic!("projection: {error}"));
        assert_eq!(balance.stock.value(), 1_000);
        assert_eq!(balance.on_hand.value(), 790);
        assert_eq!(balance.shortfall.value(), 0);
        assert_eq!(balance.allotted.map(AllottedQty::value), Some(200));
        assert_eq!(
            balance.stock.value(),
            balance.on_hand.value()
                + balance.allotted.map_or(0, AllottedQty::value)
                + balance.missing.value()
        );
    }

    #[test]
    fn irrelevant_allotted_is_renderable_as_absent_without_breaking_equation() {
        let balance = InventoryBalance::project(90, None, 10, 42)
            .unwrap_or_else(|error| panic!("projection: {error}"));
        assert_eq!(balance.allotted, None);
        assert_eq!(balance.stock.value(), 100);
        assert_eq!(balance.on_hand.value(), 90);
    }
}
