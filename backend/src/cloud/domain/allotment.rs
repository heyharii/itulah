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

// `remaining_allotted` and `derive_allotment_status` were here, and both
// subtracted at pick: one allotment's commitment released the moment a picker
// touched the goods, and the status went IN_PROGRESS because somebody had
// started rather than because a shop had received anything.
//
// Picking is destination-less and commits to nobody, so neither answer was
// about the shop. Both now come from `commitment::Fulfillment` and the view
// built on it — `allotment_line_commitment` / `allotment_commitment` — which
// is the only place the arithmetic exists. A caller that wants a status reads
// the fold; a caller that wants what is still owed reads `to_receive_qty`, and
// what still has to leave the shelf is `to_pack_qty`.
//
// `AllotmentStatus` below is the legacy spelling of the column. It is still
// written while the old routes live, and is mapped through
// `FulfillmentStatus::from_legacy` on the way out.

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
    use crate::cloud::domain::FulfillmentStatus;

    #[test]
    fn every_legacy_status_maps_onto_one_of_the_three() {
        // The four that said something about the DC's progress rather than
        // about whether the shop got its goods are all live work again; only
        // a real ending stays an ending.
        for (stored, expected) in [
            ("ACTIVE", FulfillmentStatus::Active),
            ("IN_PROGRESS", FulfillmentStatus::Active),
            ("DC_COMPLETED", FulfillmentStatus::Active),
            ("COMPLETED", FulfillmentStatus::Completed),
            ("CANCELLED", FulfillmentStatus::Closed),
            ("REJECTED", FulfillmentStatus::Closed),
        ] {
            assert_eq!(
                FulfillmentStatus::from_legacy(stored),
                expected,
                "{stored} reads wrongly"
            );
            assert!(AllotmentStatus::from_str(stored).is_ok());
        }
    }
}
