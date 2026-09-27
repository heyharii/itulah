//! What a pool is for — fixed in code. Which pools exist — data.
//!
//! Owner's ruling, 2026-09-27 (`CONTEXT.md`, "The stock" → Pool): a pool's
//! ROLE is one of a closed list the code understands — receiving, stockroom,
//! floor, reject, return, and the outbound stages. Pool INSTANCES are rows a
//! site is given from its template when it is created (postgres `0610`), and
//! nothing may learn a pool's role from how its site is spelled.
//!
//! Both nodes share this list. The centre stores it on `operational_pool.role`;
//! an edge node, which keeps no pool table, reads it from the pool id's role
//! path (`{site}.{path}`), never from the site half.

use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PoolRole {
    /// A delivery counted but not yet told apart or tagged (the Gudang's
    /// unidentified and untagged pools).
    Receiving,
    /// Goods at rest at the back: the Gudang's racks, a shop's stockroom.
    Stockroom,
    /// The shop floor. The only saleable role.
    Floor,
    /// Unsaleable goods at a site.
    Reject,
    /// One store's returned goods at a warehouse, waiting to be inspected.
    Return,
    /// Off the racks, in the outbound area, committed to nobody.
    Picking,
    Packed,
    Shipment,
    /// On the vehicle, still on the yard.
    Loaded,
    InTransit,
}

impl PoolRole {
    pub const ALL: [Self; 10] = [
        Self::Receiving,
        Self::Stockroom,
        Self::Floor,
        Self::Reject,
        Self::Return,
        Self::Picking,
        Self::Packed,
        Self::Shipment,
        Self::Loaded,
        Self::InTransit,
    ];

    /// The spelling `operational_pool.role` and `pool_template.role` store.
    pub const fn code(self) -> &'static str {
        match self {
            Self::Receiving => "RECEIVING",
            Self::Stockroom => "STOCKROOM",
            Self::Floor => "FLOOR",
            Self::Reject => "REJECT",
            Self::Return => "RETURN",
            Self::Picking => "PICKING",
            Self::Packed => "PACKED",
            Self::Shipment => "SHIPMENT",
            Self::Loaded => "LOADED",
            Self::InTransit => "IN_TRANSIT",
        }
    }

    pub fn from_code(code: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|role| role.code().eq_ignore_ascii_case(code.trim()))
    }

    /// Only the floor sells.
    pub const fn is_saleable(self) -> bool {
        matches!(self, Self::Floor)
    }

    /// A stage a koli passes through on its way out. Picking is not one: it
    /// binds nothing to a destination.
    pub const fn is_outbound_stage(self) -> bool {
        matches!(
            self,
            Self::Packed | Self::Shipment | Self::Loaded | Self::InTransit
        )
    }

    /// Anywhere in the outbound area, picking included.
    pub const fn is_outbound(self) -> bool {
        matches!(self, Self::Picking) || self.is_outbound_stage()
    }

    /// Goods at rest at their own site, from which a carton may be filled.
    pub const fn is_fulfillment_source(self) -> bool {
        matches!(
            self,
            Self::Receiving
                | Self::Stockroom
                | Self::Floor
                | Self::Reject
                | Self::Return
                | Self::Picking
        )
    }

    /// Where goods may land when they arrive from another of our sites: a
    /// shop's stockroom, or a store's return pool at the Gudang.
    pub const fn is_arrival(self) -> bool {
        matches!(self, Self::Stockroom | Self::Return)
    }
}

impl fmt::Display for PoolRole {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

/// An outbound stage, as a pool at its origin is spelled:
/// `{site}.outbound.{slug}`.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OutboundStage {
    Packed,
    Shipment,
    Loaded,
    InTransit,
}

impl OutboundStage {
    pub const ALL: [Self; 4] = [Self::Packed, Self::Shipment, Self::Loaded, Self::InTransit];

    /// The last segment of the pool id.
    pub const fn slug(self) -> &'static str {
        match self {
            Self::Packed => "packed",
            Self::Shipment => "shipment",
            Self::Loaded => "loaded",
            Self::InTransit => "in-transit",
        }
    }

    pub fn from_slug(slug: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|stage| stage.slug() == slug)
    }

    pub const fn role(self) -> PoolRole {
        match self {
            Self::Packed => PoolRole::Packed,
            Self::Shipment => PoolRole::Shipment,
            Self::Loaded => PoolRole::Loaded,
            Self::InTransit => PoolRole::InTransit,
        }
    }

    /// The stage a koli must stand at before this one, if any.
    pub const fn previous(self) -> Option<Self> {
        match self {
            Self::Packed => None,
            Self::Shipment => Some(Self::Packed),
            Self::Loaded => Some(Self::Shipment),
            Self::InTransit => Some(Self::Loaded),
        }
    }
}

impl From<OutboundStage> for PoolRole {
    fn from(stage: OutboundStage) -> Self {
        stage.role()
    }
}
