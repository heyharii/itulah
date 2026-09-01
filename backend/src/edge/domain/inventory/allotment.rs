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
    Open,
    InProgress,
    DcCompleted,
    Cancelled,
    Rejected,
}

impl AllotmentStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Open => "OPEN",
            Self::InProgress => "IN_PROGRESS",
            Self::DcCompleted => "DC_COMPLETED",
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
            "OPEN" => Ok(Self::Open),
            "IN_PROGRESS" => Ok(Self::InProgress),
            "DC_COMPLETED" => Ok(Self::DcCompleted),
            "CANCELLED" => Ok(Self::Cancelled),
            "REJECTED" => Ok(Self::Rejected),
            _ => Err(AllotmentError::UnknownStatus(value.to_owned())),
        }
    }
}

/// Reservation remaining in the source pool. Picking releases Allotted;
/// packing, shipment, dispatch, and receipt are separate lifecycle stages.
pub fn remaining_allotted(
    accepted_quantity: i64,
    picked_quantity: i64,
    cancelled_quantity: i64,
) -> Result<i64, AllotmentError> {
    if accepted_quantity < 0 {
        return Err(AllotmentError::NegativeAcceptedQuantity);
    }
    if picked_quantity < 0
        || cancelled_quantity < 0
        || picked_quantity + cancelled_quantity > accepted_quantity
    {
        return Err(AllotmentError::InvalidReservationConsumption);
    }
    Ok(accepted_quantity - picked_quantity - cancelled_quantity)
}

pub fn derive_allotment_status(
    accepted_quantity: i64,
    picked_quantity: i64,
    dispatched_quantity: i64,
    cancelled_quantity: i64,
    rejected: bool,
) -> Result<AllotmentStatus, AllotmentError> {
    if rejected {
        if accepted_quantity == 0
            && picked_quantity == 0
            && dispatched_quantity == 0
            && cancelled_quantity == 0
        {
            return Ok(AllotmentStatus::Rejected);
        }
        return Err(AllotmentError::RejectedWithInventoryProgress);
    }
    if dispatched_quantity < 0 || dispatched_quantity > picked_quantity {
        return Err(AllotmentError::InvalidDispatchQuantity);
    }
    let remaining = remaining_allotted(accepted_quantity, picked_quantity, cancelled_quantity)?;
    let dc_consumed = dispatched_quantity
        .checked_add(cancelled_quantity)
        .ok_or(AllotmentError::InvalidCompletionQuantity)?;
    Ok(
        if accepted_quantity > 0 && remaining == 0 && picked_quantity == 0 {
            AllotmentStatus::Cancelled
        } else if accepted_quantity > 0 && dc_consumed == accepted_quantity {
            AllotmentStatus::DcCompleted
        } else if picked_quantity > 0 || dispatched_quantity > 0 {
            AllotmentStatus::InProgress
        } else {
            AllotmentStatus::Open
        },
    )
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum AllotmentError {
    #[error("accepted quantity cannot be negative")]
    NegativeAcceptedQuantity,
    #[error(
        "picked and cancelled quantities must be non-negative and cannot exceed accepted quantity"
    )]
    InvalidReservationConsumption,
    #[error("dispatched quantity must be non-negative and cannot exceed picked quantity")]
    InvalidDispatchQuantity,
    #[error("dispatched plus cancelled quantity overflowed")]
    InvalidCompletionQuantity,
    #[error("a rejected allotment cannot have accepted or fulfillment quantities")]
    RejectedWithInventoryProgress,
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
    fn remaining_reservation_is_accepted_less_picked_and_cancelled() {
        assert_eq!(remaining_allotted(100, 40, 15), Ok(45));
    }

    #[test]
    fn status_separates_pick_from_dc_completion() {
        assert_eq!(
            derive_allotment_status(100, 0, 0, 0, false),
            Ok(AllotmentStatus::Open)
        );
        assert_eq!(
            derive_allotment_status(100, 100, 0, 0, false),
            Ok(AllotmentStatus::InProgress)
        );
        assert_eq!(
            derive_allotment_status(100, 100, 100, 0, false),
            Ok(AllotmentStatus::DcCompleted)
        );
        assert_eq!(
            derive_allotment_status(100, 0, 0, 100, false),
            Ok(AllotmentStatus::Cancelled)
        );
        assert_eq!(
            derive_allotment_status(0, 0, 0, 0, true),
            Ok(AllotmentStatus::Rejected)
        );
    }
}
