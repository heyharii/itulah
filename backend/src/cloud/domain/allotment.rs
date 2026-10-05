use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use thiserror::Error;

/// The route an allotment takes (owner, 2026-09-27; postgres `0611`).
///
/// Goods are not tied to "Gudang → store". Any site may be an origin or a
/// destination, subject to the route:
///
/// * [`Self::ToSite`] — our goods to a site of ours that sells them: from the
///   Gudang (REPLENISH) or from another shop (TRANSFER, which head office
///   starts; the books cross through head office).
/// * [`Self::ReturnToWarehouse`] — a shop's goods back to the Gudang, into that
///   store's own return pool, then inspected. Head office starts it.
/// * [`Self::ReturnToSupplier`] — goods back to a supplier, only ever from a
///   site of the head-office unit. Stores never deal with suppliers.
///
/// Whether a line's source and destination fit is read from the sites' rows —
/// their kind, their unit and that unit's kind — never from their ids.
///
/// `TO_STORE` and `RETURN_TO_DC`, the words before 0611, still read. They are
/// also what [`Self::wire_code`] sends to a node: builds in the field accept
/// only those.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AllotmentType {
    #[serde(alias = "TO_STORE")]
    ToSite,
    #[serde(alias = "RETURN_TO_DC")]
    ReturnToWarehouse,
    ReturnToSupplier,
}

#[allow(non_upper_case_globals)]
impl AllotmentType {
    /// The route's name before 0611, kept so code written against it reads.
    pub const ToStore: Self = Self::ToSite;
    /// The route's name before 0611, kept so code written against it reads.
    pub const ReturnToDc: Self = Self::ReturnToWarehouse;

    /// What `allotment.type` stores from 0611 on.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ToSite => "TO_SITE",
            Self::ReturnToWarehouse => "RETURN_TO_WAREHOUSE",
            Self::ReturnToSupplier => "RETURN_TO_SUPPLIER",
        }
    }

    /// What an activation command carries to a node. Builds in the field
    /// check `allotment_type` against these three and keep it under a CHECK
    /// of the same three (`dc_allotment_work`); an unreadable command blocks
    /// a node's whole stream.
    pub const fn wire_code(self) -> &'static str {
        match self {
            Self::ToSite => "TO_STORE",
            Self::ReturnToWarehouse => "RETURN_TO_DC",
            Self::ReturnToSupplier => "RETURN_TO_SUPPLIER",
        }
    }

    /// Every spelling a stored row of this route may carry: its own, and the
    /// one it had before 0611. A filter on the type matches both.
    pub const fn spellings(self) -> &'static [&'static str] {
        match self {
            Self::ToSite => &["TO_SITE", "TO_STORE"],
            Self::ReturnToWarehouse => &["RETURN_TO_WAREHOUSE", "RETURN_TO_DC"],
            Self::ReturnToSupplier => &["RETURN_TO_SUPPLIER"],
        }
    }

    /// Whether the goods go to a site of ours, where somebody receives them.
    pub const fn goes_to_a_site(self) -> bool {
        matches!(self, Self::ToSite | Self::ReturnToWarehouse)
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
            "TO_SITE" | "TO_STORE" => Ok(Self::ToSite),
            "RETURN_TO_WAREHOUSE" | "RETURN_TO_DC" => Ok(Self::ReturnToWarehouse),
            "RETURN_TO_SUPPLIER" => Ok(Self::ReturnToSupplier),
            _ => Err(AllotmentError::UnknownType(value.to_owned())),
        }
    }
}

/// Why a TO_SITE allotment is raised. Derived from the source site's unit —
/// head office REPLENISHes, a shop TRANSFERs — and written once (0611).
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AllotmentPurpose {
    Replenish,
    Transfer,
}

impl AllotmentPurpose {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Replenish => "REPLENISH",
            Self::Transfer => "TRANSFER",
        }
    }

    /// NULL on a row written before 0611 is REPLENISH: every TO_STORE was the
    /// Gudang's.
    pub fn from_stored(value: Option<&str>) -> Option<Self> {
        match value {
            Some("TRANSFER") => Some(Self::Transfer),
            Some("REPLENISH") | None => Some(Self::Replenish),
            Some(_) => None,
        }
    }
}

/// Where a line's goods go, in the words nodes read.
///
/// `STORE` is a site of ours that sells, `DC` a warehouse, `SUPPLIER` the
/// supplier counterparty. For a site the word is DERIVED from the site's kind
/// (0611); a request may name a site as `SITE` and leave the word to the
/// centre.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DestinationType {
    Store,
    /// A warehouse site. Spelled `DC` on the wire and in the tables, because
    /// that is what nodes in the field read.
    #[serde(rename = "DC", alias = "WAREHOUSE")]
    Warehouse,
    Supplier,
    /// A site of ours, its kind still to be read from its row. Accepted in a
    /// request and never stored.
    Site,
}

#[allow(non_upper_case_globals)]
impl DestinationType {
    /// The name before 0611.
    pub const Dc: Self = Self::Warehouse;

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Store => "STORE",
            Self::Warehouse => "DC",
            Self::Supplier => "SUPPLIER",
            Self::Site => "SITE",
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
            "DC" | "WAREHOUSE" => Ok(Self::Warehouse),
            "SUPPLIER" => Ok(Self::Supplier),
            "SITE" => Ok(Self::Site),
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
    /// `CLOSED` is accepted as a spelling of this on the way in, so a list
    /// can be asked for by the three statuses MD reads (allotment V1 §8).
    /// It is never written: `FulfillmentStatus::Closed` maps here.
    #[serde(alias = "CLOSED")]
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
