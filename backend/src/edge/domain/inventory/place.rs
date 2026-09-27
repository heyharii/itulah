use super::SiteId;
pub use crate::pool_role::{OutboundStage, PoolRole};
use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InventoryState {
    Normal,
    Missing,
}

impl InventoryState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "on_hand",
            Self::Missing => "missing",
        }
    }
}

/// A pool as a pool id spells it: `{site}.{role path}`.
///
/// The SITE half is a label and says nothing (owner, 2026-09-27). The ROLE
/// path is the pool grammar, and it alone says what the pool is for
/// ([`PoolRole`]). Which of these pools a site actually has is data — the
/// centre's `operational_pool`, made from a template (postgres `0610`).
///
/// Several variants keep the names they were given when only the Gudang sent
/// goods (`Dc…`, `Store…`). The names are history; the site in them is any
/// site. Legacy spellings are read for ever because movement history names
/// them, and are never written by new code:
///
/// * `{site}.outbound.{stage}.{destination}` — the per-destination stage leaves
///   (`0009`). A stage now stands at its origin ([`Self::Outbound`]) and the
///   destination travels on the koli.
/// * `{site}.reject.dc` — the first Gudang's own reject; a newer site's is
///   `{site}.reject`.
/// * `{site}.reject.{store}` — a store's return pool at the Gudang; a newer one
///   is `{site}.return.{unit}`.
#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OperationalPool {
    /// RECEIVING: `{site}.pending.unidentified`.
    DcPendingUnidentified {
        dc_id: SiteId,
    },
    /// RECEIVING: `{site}.pending.untagged`.
    DcPendingUntagged {
        dc_id: SiteId,
    },
    /// STOCKROOM: `{site}.warehouse` — the Gudang's racks or a shop's back
    /// room. One role, one spelling, whatever the site is.
    Stockroom {
        site_id: SiteId,
    },
    /// PICKING: `{site}.outbound.picking`. Off the racks and on the floor of
    /// the outbound area, not yet in a box.
    ///
    /// Deliberately not scoped to a destination: picking fetches a SKU and a
    /// number, and which piece serves which site is settled when it goes into
    /// a carton. A place that claimed to know the destination would be
    /// asserting a decision nobody has made.
    DcOutboundPicking {
        dc_id: SiteId,
    },
    /// Legacy per-destination leaves (`0009`, `0252`).
    DcOutboundPicked {
        dc_id: SiteId,
        store_id: SiteId,
    },
    DcOutboundPacked {
        dc_id: SiteId,
        store_id: SiteId,
    },
    DcOutboundShipment {
        dc_id: SiteId,
        store_id: SiteId,
    },
    DcOutboundLoaded {
        dc_id: SiteId,
        store_id: SiteId,
    },
    DcOutboundInTransit {
        dc_id: SiteId,
        store_id: SiteId,
    },
    /// An outbound stage at its ORIGIN: `{site}.outbound.{stage}`. Where the
    /// koli is going is the koli's to say, not the pool's.
    Outbound {
        site_id: SiteId,
        stage: OutboundStage,
    },
    /// REJECT, legacy spelling: `{site}.reject.dc`.
    DcRejectDc {
        dc_id: SiteId,
    },
    /// RETURN, legacy spelling: `{site}.reject.{store}`.
    DcRejectStore {
        dc_id: SiteId,
        store_id: SiteId,
    },
    /// RETURN: `{site}.return.{unit}` — one store unit's returned goods at a
    /// warehouse, waiting to be inspected.
    Return {
        site_id: SiteId,
        origin_id: SiteId,
    },
    /// FLOOR: `{site}.floor`.
    StoreFloor {
        store_id: SiteId,
    },
    /// REJECT: `{site}.reject`.
    StoreReject {
        store_id: SiteId,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GroupCode {
    Pending,
    Warehouse,
    Outbound,
    Reject,
    StoreInventory,
}

#[derive(Debug, Error, PartialEq)]
pub enum PlaceError {
    #[error("unknown operational pool: {0}")]
    UnknownPool(String),
    #[error("unknown inventory place: {0}")]
    UnknownPlace(String),
    #[error("expected a DC site identifier: {0}")]
    ExpectedDc(String),
    #[error("expected a Store site identifier: {0}")]
    ExpectedStore(String),
    #[error("not a site identifier: {0}")]
    ExpectedSite(String),
}

// The site half of a pool id. Its SHAPE is checked and nothing else: whether
// it names a warehouse or a shop is data, and the role path says what the
// pool is for.
fn site(value: &str) -> Result<SiteId, PlaceError> {
    SiteId::new(value).map_err(|_| PlaceError::ExpectedSite(value.to_owned()))
}

/// `{site}.outbound.{stage}.{destination}`: a legacy per-destination leaf.
fn legacy_leaf(
    value: &str,
    dc_id: SiteId,
    stage: &str,
    destination: &str,
) -> Result<OperationalPool, PlaceError> {
    let store_id = site(destination)?;
    Ok(match stage {
        "picked" => OperationalPool::DcOutboundPicked { dc_id, store_id },
        "packed" => OperationalPool::DcOutboundPacked { dc_id, store_id },
        "shipment" => OperationalPool::DcOutboundShipment { dc_id, store_id },
        "loaded" => OperationalPool::DcOutboundLoaded { dc_id, store_id },
        "in-transit" => OperationalPool::DcOutboundInTransit { dc_id, store_id },
        _ => return Err(PlaceError::UnknownPool(value.to_owned())),
    })
}

impl OperationalPool {
    pub fn id(&self) -> String {
        match self {
            Self::DcPendingUnidentified { dc_id } => format!("{dc_id}.pending.unidentified"),
            Self::DcPendingUntagged { dc_id } => format!("{dc_id}.pending.untagged"),
            Self::Stockroom { site_id } => format!("{site_id}.warehouse"),
            Self::DcOutboundPicking { dc_id } => format!("{dc_id}.outbound.picking"),
            Self::DcOutboundPicked { dc_id, store_id } => {
                format!("{dc_id}.outbound.picked.{store_id}")
            }
            Self::DcOutboundPacked { dc_id, store_id } => {
                format!("{dc_id}.outbound.packed.{store_id}")
            }
            Self::DcOutboundShipment { dc_id, store_id } => {
                format!("{dc_id}.outbound.shipment.{store_id}")
            }
            Self::DcOutboundLoaded { dc_id, store_id } => {
                format!("{dc_id}.outbound.loaded.{store_id}")
            }
            Self::DcOutboundInTransit { dc_id, store_id } => {
                format!("{dc_id}.outbound.in-transit.{store_id}")
            }
            Self::Outbound { site_id, stage } => format!("{site_id}.outbound.{}", stage.slug()),
            Self::DcRejectDc { dc_id } => format!("{dc_id}.reject.dc"),
            Self::DcRejectStore { dc_id, store_id } => format!("{dc_id}.reject.{store_id}"),
            Self::Return { site_id, origin_id } => format!("{site_id}.return.{origin_id}"),
            Self::StoreFloor { store_id } => format!("{store_id}.floor"),
            Self::StoreReject { store_id } => format!("{store_id}.reject"),
        }
    }

    pub fn site_id(&self) -> &SiteId {
        match self {
            Self::DcPendingUnidentified { dc_id }
            | Self::DcPendingUntagged { dc_id }
            | Self::DcOutboundPicking { dc_id }
            | Self::DcOutboundPicked { dc_id, .. }
            | Self::DcOutboundPacked { dc_id, .. }
            | Self::DcOutboundShipment { dc_id, .. }
            | Self::DcOutboundLoaded { dc_id, .. }
            | Self::DcOutboundInTransit { dc_id, .. }
            | Self::DcRejectDc { dc_id }
            | Self::DcRejectStore { dc_id, .. } => dc_id,
            Self::Stockroom { site_id }
            | Self::Outbound { site_id, .. }
            | Self::Return { site_id, .. } => site_id,
            Self::StoreFloor { store_id } | Self::StoreReject { store_id } => store_id,
        }
    }

    /// What the pool is for. Read from the role path, never from the site.
    pub const fn role(&self) -> PoolRole {
        match self {
            Self::DcPendingUnidentified { .. } | Self::DcPendingUntagged { .. } => {
                PoolRole::Receiving
            }
            Self::Stockroom { .. } => PoolRole::Stockroom,
            Self::DcOutboundPicking { .. } | Self::DcOutboundPicked { .. } => PoolRole::Picking,
            Self::DcOutboundPacked { .. } => PoolRole::Packed,
            Self::DcOutboundShipment { .. } => PoolRole::Shipment,
            Self::DcOutboundLoaded { .. } => PoolRole::Loaded,
            Self::DcOutboundInTransit { .. } => PoolRole::InTransit,
            Self::Outbound { stage, .. } => stage.role(),
            Self::DcRejectDc { .. } | Self::StoreReject { .. } => PoolRole::Reject,
            Self::DcRejectStore { .. } | Self::Return { .. } => PoolRole::Return,
            Self::StoreFloor { .. } => PoolRole::Floor,
        }
    }

    /// Spelled the way nothing new is written: a per-destination leaf.
    pub const fn is_legacy_leaf(&self) -> bool {
        matches!(
            self,
            Self::DcOutboundPicked { .. }
                | Self::DcOutboundPacked { .. }
                | Self::DcOutboundShipment { .. }
                | Self::DcOutboundLoaded { .. }
                | Self::DcOutboundInTransit { .. }
        )
    }

    /// Goods at rest at `site`, from which a carton may be filled — for any
    /// route, from any site. The legacy per-destination pick leaves are not
    /// one: they were never written by a node and take no new writes.
    pub fn is_fulfillment_source_for(&self, site: &SiteId) -> bool {
        self.site_id() == site && self.role().is_fulfillment_source() && !self.is_legacy_leaf()
    }

    pub const fn group(&self) -> GroupCode {
        match self.role() {
            PoolRole::Receiving => GroupCode::Pending,
            PoolRole::Stockroom => GroupCode::Warehouse,
            PoolRole::Floor => GroupCode::StoreInventory,
            PoolRole::Reject | PoolRole::Return => GroupCode::Reject,
            PoolRole::Picking
            | PoolRole::Packed
            | PoolRole::Shipment
            | PoolRole::Loaded
            | PoolRole::InTransit => GroupCode::Outbound,
        }
    }

    /// The destination a LEGACY leaf spells. A stage at its origin names none.
    pub fn outbound_destination(&self) -> Option<&SiteId> {
        match self {
            Self::DcOutboundPicked { store_id, .. }
            | Self::DcOutboundPacked { store_id, .. }
            | Self::DcOutboundShipment { store_id, .. }
            | Self::DcOutboundLoaded { store_id, .. }
            | Self::DcOutboundInTransit { store_id, .. } => Some(store_id),
            _ => None,
        }
    }

    /// The outbound stage the pool is, legacy leaf or stage at its origin.
    pub const fn outbound_stage(&self) -> Option<OutboundStage> {
        match self {
            Self::DcOutboundPacked { .. } => Some(OutboundStage::Packed),
            Self::DcOutboundShipment { .. } => Some(OutboundStage::Shipment),
            Self::DcOutboundLoaded { .. } => Some(OutboundStage::Loaded),
            Self::DcOutboundInTransit { .. } => Some(OutboundStage::InTransit),
            Self::Outbound { stage, .. } => Some(*stage),
            _ => None,
        }
    }

    /// The store unit whose returned goods a return pool holds.
    pub fn return_origin(&self) -> Option<&SiteId> {
        match self {
            Self::DcRejectStore { store_id, .. } => Some(store_id),
            Self::Return { origin_id, .. } => Some(origin_id),
            _ => None,
        }
    }
}

impl FromStr for OperationalPool {
    type Err = PlaceError;

    /// The role path decides; the site half is only checked for shape.
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let (site_part, path) = value
            .split_once('.')
            .ok_or_else(|| PlaceError::UnknownPool(value.to_owned()))?;
        let site_id = site(site_part)?;
        let segments: Vec<&str> = path.split('.').collect();
        match segments.as_slice() {
            ["pending", "unidentified"] => Ok(Self::DcPendingUnidentified { dc_id: site_id }),
            ["pending", "untagged"] => Ok(Self::DcPendingUntagged { dc_id: site_id }),
            ["warehouse"] => Ok(Self::Stockroom { site_id }),
            ["floor"] => Ok(Self::StoreFloor { store_id: site_id }),
            ["reject"] => Ok(Self::StoreReject { store_id: site_id }),
            // A fixed token of the pool grammar, not a site id: the first
            // Gudang's own reject was spelled this way.
            ["reject", "dc"] => Ok(Self::DcRejectDc { dc_id: site_id }),
            ["reject", origin] => Ok(Self::DcRejectStore {
                dc_id: site_id,
                store_id: site(origin)?,
            }),
            ["return", origin] => Ok(Self::Return {
                site_id,
                origin_id: site(origin)?,
            }),
            ["outbound", "picking"] => Ok(Self::DcOutboundPicking { dc_id: site_id }),
            ["outbound", stage] => OutboundStage::from_slug(stage)
                .map(|stage| Self::Outbound { site_id, stage })
                .ok_or_else(|| PlaceError::UnknownPool(value.to_owned())),
            ["outbound", stage, destination] => legacy_leaf(value, site_id, stage, destination),
            _ => Err(PlaceError::UnknownPool(value.to_owned())),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExternalPlace {
    Supplier,
    Customer,
    Disposal,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SystemPlace {
    Opening,
    CountGain,
    Lost,
    /// Where goods stand while their identity is being reassigned.
    ///
    /// A delivery arrives as one anonymous quantity — "118 pieces of the
    /// article we ordered" — and leaves as several identified ones. The two
    /// sides name different subjects, so they cannot be one movement; this is
    /// the balancing point between them. Nothing ever rests here: every
    /// movement group that touches it leaves it at zero, and a non-zero
    /// balance means a transformation was recorded by halves.
    Identification,
    /// Goods another site of ours has counted in, let go of by the site they
    /// left (inventory-fleet G3). No movement crosses a node boundary: the
    /// destination books them in from `system/opening`, and the origin, told
    /// by head office once the two claims pair, moves them out of its
    /// in-transit pool to here. The two ledgers meet in the claims, and each
    /// closes its own side.
    HandedOver,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Place {
    Operational {
        pool: OperationalPool,
        state: InventoryState,
    },
    External {
        place: ExternalPlace,
    },
    System {
        place: SystemPlace,
    },
}

impl Place {
    pub fn id(&self) -> String {
        match self {
            Self::Operational { pool, state } => format!("{}:{}", pool.id(), state.as_str()),
            Self::External {
                place: ExternalPlace::Supplier,
            } => "external/supplier".into(),
            Self::External {
                place: ExternalPlace::Customer,
            } => "external/customer".into(),
            Self::External {
                place: ExternalPlace::Disposal,
            } => "external/disposal".into(),
            Self::System {
                place: SystemPlace::Opening,
            } => "system/opening".into(),
            Self::System {
                place: SystemPlace::CountGain,
            } => "system/count_gain".into(),
            Self::System {
                place: SystemPlace::Lost,
            } => "system/lost".into(),
            Self::System {
                place: SystemPlace::Identification,
            } => "system/identification".into(),
            Self::System {
                place: SystemPlace::HandedOver,
            } => "system/handed_over".into(),
        }
    }

    pub fn is_company(&self) -> bool {
        matches!(self, Self::Operational { .. })
    }

    pub fn is_saleable(&self) -> bool {
        matches!(
            self,
            Self::Operational {
                pool: OperationalPool::StoreFloor { .. },
                state: InventoryState::Normal
            }
        )
    }

    pub fn pool(&self) -> Option<&OperationalPool> {
        match self {
            Self::Operational { pool, .. } => Some(pool),
            _ => None,
        }
    }

    pub fn state(&self) -> Option<InventoryState> {
        match self {
            Self::Operational { state, .. } => Some(*state),
            _ => None,
        }
    }
}

impl FromStr for Place {
    type Err = PlaceError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "external/supplier" => Ok(Self::External {
                place: ExternalPlace::Supplier,
            }),
            "external/customer" => Ok(Self::External {
                place: ExternalPlace::Customer,
            }),
            "external/disposal" => Ok(Self::External {
                place: ExternalPlace::Disposal,
            }),
            "system/opening" => Ok(Self::System {
                place: SystemPlace::Opening,
            }),
            "system/count_gain" => Ok(Self::System {
                place: SystemPlace::CountGain,
            }),
            "system/lost" => Ok(Self::System {
                place: SystemPlace::Lost,
            }),
            "system/identification" => Ok(Self::System {
                place: SystemPlace::Identification,
            }),
            "system/handed_over" => Ok(Self::System {
                place: SystemPlace::HandedOver,
            }),
            _ => {
                let (pool, state) = value
                    .split_once(':')
                    .ok_or_else(|| PlaceError::UnknownPlace(value.to_owned()))?;
                let state = match state {
                    "on_hand" => InventoryState::Normal,
                    "missing" => InventoryState::Missing,
                    _ => return Err(PlaceError::UnknownPlace(value.to_owned())),
                };
                Ok(Self::Operational {
                    pool: pool.parse()?,
                    state,
                })
            }
        }
    }
}

impl fmt::Display for Place {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.id())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InventoryGroup {
    pub site_id: SiteId,
    pub code: GroupCode,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dc_and_destination_are_both_part_of_outbound_identity() {
        let first: OperationalPool = "dc-01.outbound.loaded.store-07"
            .parse()
            .unwrap_or_else(|error| panic!("{error}"));
        let second: OperationalPool = "dc-02.outbound.loaded.store-07"
            .parse()
            .unwrap_or_else(|error| panic!("{error}"));
        assert_ne!(first, second);
        assert_eq!(first.site_id().as_str(), "dc-01");
        assert_eq!(
            first.outbound_destination().map(SiteId::as_str),
            Some("store-07")
        );
    }

    #[test]
    fn dispatch_precedes_in_transit() {
        let dispatched: OperationalPool = "dc-01.outbound.loaded.store-07"
            .parse()
            .unwrap_or_else(|error| panic!("{error}"));
        let in_transit: OperationalPool = "dc-01.outbound.in-transit.store-07"
            .parse()
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(dispatched.site_id(), in_transit.site_id());
        assert_eq!(
            dispatched.outbound_destination(),
            in_transit.outbound_destination()
        );
    }

    #[test]
    fn only_store_floor_on_hand_is_saleable() {
        assert!("store-03.floor:on_hand"
            .parse::<Place>()
            .is_ok_and(|place| place.is_saleable()));
        assert!(!"store-03.warehouse:on_hand"
            .parse::<Place>()
            .is_ok_and(|place| place.is_saleable()));
    }
}
