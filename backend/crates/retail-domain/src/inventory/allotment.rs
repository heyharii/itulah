use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AllotmentType {
    ToStore,
    ReturnToDc,
    ReturnToSupplier,
}

impl AllotmentType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ToStore => "TO_STORE",
            Self::ReturnToDc => "RETURN_TO_DC",
            Self::ReturnToSupplier => "RETURN_TO_SUPPLIER",
        }
    }
}

impl fmt::Display for AllotmentType {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for AllotmentType {
    type Err = AllotmentError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "TO_STORE" => Ok(Self::ToStore),
            "RETURN_TO_DC" => Ok(Self::ReturnToDc),
            "RETURN_TO_SUPPLIER" => Ok(Self::ReturnToSupplier),
            _ => Err(AllotmentError::UnknownType(value.to_owned())),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DestinationType {
    Store,
    Dc,
    Supplier,
}

impl DestinationType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Store => "STORE",
            Self::Dc => "DC",
            Self::Supplier => "SUPPLIER",
        }
    }
}

impl fmt::Display for DestinationType {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for DestinationType {
    type Err = AllotmentError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "STORE" => Ok(Self::Store),
            "DC" => Ok(Self::Dc),
            "SUPPLIER" => Ok(Self::Supplier),
            _ => Err(AllotmentError::UnknownDestinationType(value.to_owned())),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AllotmentStatus {
    Active,
    PartiallyExecuted,
    Executed,
    Cancelled,
}

impl AllotmentStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "ACTIVE",
            Self::PartiallyExecuted => "PARTIALLY_EXECUTED",
            Self::Executed => "EXECUTED",
            Self::Cancelled => "CANCELLED",
        }
    }
}

impl fmt::Display for AllotmentStatus {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for AllotmentStatus {
    type Err = AllotmentError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "ACTIVE" => Ok(Self::Active),
            "PARTIALLY_EXECUTED" => Ok(Self::PartiallyExecuted),
            "EXECUTED" => Ok(Self::Executed),
            "CANCELLED" => Ok(Self::Cancelled),
            _ => Err(AllotmentError::UnknownStatus(value.to_owned())),
        }
    }
}

pub fn remaining_qty(
    quantity: i64,
    executed_quantity: i64,
    cancelled_quantity: i64,
) -> Result<i64, AllotmentError> {
    if quantity <= 0 {
        return Err(AllotmentError::NonPositiveQuantity);
    }
    if executed_quantity < 0
        || cancelled_quantity < 0
        || executed_quantity + cancelled_quantity > quantity
    {
        return Err(AllotmentError::InvalidConsumedQuantities);
    }
    Ok(quantity - executed_quantity - cancelled_quantity)
}

pub fn derive_allotment_status(
    quantity: i64,
    executed_quantity: i64,
    cancelled_quantity: i64,
) -> Result<AllotmentStatus, AllotmentError> {
    let remaining = remaining_qty(quantity, executed_quantity, cancelled_quantity)?;
    Ok(if remaining == 0 && executed_quantity == quantity {
        AllotmentStatus::Executed
    } else if remaining == 0 {
        AllotmentStatus::Cancelled
    } else if executed_quantity > 0 {
        AllotmentStatus::PartiallyExecuted
    } else {
        AllotmentStatus::Active
    })
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum AllotmentError {
    #[error("allotment quantity must be positive")]
    NonPositiveQuantity,
    #[error("executed and cancelled quantities must be non-negative and cannot exceed quantity")]
    InvalidConsumedQuantities,
    #[error("unknown allotment type: {0}")]
    UnknownType(String),
    #[error("unknown destination type: {0}")]
    UnknownDestinationType(String),
    #[error("unknown allotment status: {0}")]
    UnknownStatus(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remaining_is_quantity_less_executed_and_cancelled() {
        assert_eq!(remaining_qty(100, 40, 15), Ok(45));
    }

    #[test]
    fn status_is_derived_from_generic_counters() {
        assert_eq!(
            derive_allotment_status(100, 0, 0),
            Ok(AllotmentStatus::Active)
        );
        assert_eq!(
            derive_allotment_status(100, 40, 0),
            Ok(AllotmentStatus::PartiallyExecuted)
        );
        assert_eq!(
            derive_allotment_status(100, 100, 0),
            Ok(AllotmentStatus::Executed)
        );
        assert_eq!(
            derive_allotment_status(100, 40, 60),
            Ok(AllotmentStatus::Cancelled)
        );
    }
}
