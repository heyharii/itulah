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
    InProgress,
    DcCompleted,
    Completed,
    Cancelled,
    Rejected,
}

impl AllotmentStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "ACTIVE",
            Self::InProgress => "IN_PROGRESS",
            Self::DcCompleted => "DC_COMPLETED",
            Self::Completed => "COMPLETED",
            Self::Cancelled => "CANCELLED",
            Self::Rejected => "REJECTED",
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
            "IN_PROGRESS" => Ok(Self::InProgress),
            "DC_COMPLETED" => Ok(Self::DcCompleted),
            "COMPLETED" => Ok(Self::Completed),
            "CANCELLED" => Ok(Self::Cancelled),
            "REJECTED" => Ok(Self::Rejected),
            _ => Err(AllotmentError::UnknownStatus(value.to_owned())),
        }
    }
}

pub fn remaining_allotted(
    quantity: i64,
    picked_quantity: i64,
    cancelled_quantity: i64,
) -> Result<i64, AllotmentError> {
    if quantity <= 0 {
        return Err(AllotmentError::NonPositiveQuantity);
    }
    if picked_quantity < 0
        || cancelled_quantity < 0
        || picked_quantity + cancelled_quantity > quantity
    {
        return Err(AllotmentError::InvalidReservationConsumption);
    }
    Ok(quantity - picked_quantity - cancelled_quantity)
}

/// Cloud-native compatibility workflow has only reached Pick. It must not call
/// that DC completion; Dispatch and Store receipt are explicit later facts.
pub fn derive_allotment_status(
    quantity: i64,
    picked_quantity: i64,
    cancelled_quantity: i64,
) -> Result<AllotmentStatus, AllotmentError> {
    let remaining = remaining_allotted(quantity, picked_quantity, cancelled_quantity)?;
    Ok(if remaining == 0 && picked_quantity == 0 {
        AllotmentStatus::Cancelled
    } else if picked_quantity > 0 {
        AllotmentStatus::InProgress
    } else {
        AllotmentStatus::Active
    })
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum AllotmentError {
    #[error("allotment quantity must be positive")]
    NonPositiveQuantity,
    #[error("picked and cancelled quantities must be non-negative and cannot exceed quantity")]
    InvalidReservationConsumption,
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
    fn pick_releases_allotted_without_claiming_completion() {
        assert_eq!(remaining_allotted(100, 40, 15), Ok(45));
        assert_eq!(
            derive_allotment_status(100, 100, 0),
            Ok(AllotmentStatus::InProgress)
        );
    }
}
