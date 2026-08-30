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
quantity_type!(MissingQty);
quantity_type!(ObservedQty);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct InventoryBalance {
    pub stock: StockQty,
    pub allotted: Option<AllottedQty>,
    pub on_hand: OnHandQty,
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
    /// The constructor owns the equation, so callers cannot provide an
    /// inconsistent Stock or On Hand value.
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
        let on_hand = normal
            .checked_sub(allotted_value)
            .ok_or(InventoryBalanceError::ArithmeticOverflow)?;
        let result = Self {
            stock: StockQty(stock),
            allotted: allotted.map(AllottedQty),
            on_hand: OnHandQty(on_hand),
            missing: MissingQty(missing),
            observed: ObservedQty(observed),
        };
        debug_assert_eq!(
            result.stock.value(),
            result.on_hand.value() + allotted_value + result.missing.value()
        );
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projection_guarantees_the_inventory_equation() {
        let balance = InventoryBalance::project(990, Some(200), 10, 850)
            .unwrap_or_else(|error| panic!("projection: {error}"));
        assert_eq!(balance.stock.value(), 1_000);
        assert_eq!(balance.on_hand.value(), 790);
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
