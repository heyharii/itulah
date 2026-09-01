use super::{SiteId, SiteKind};
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

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OperationalPool {
    DcPendingUnidentified {
        dc_id: SiteId,
    },
    DcPendingUntagged {
        dc_id: SiteId,
    },
    DcWarehouse {
        dc_id: SiteId,
    },
    /// Off the racks and on the floor of the outbound area, not yet in a box.
    ///
    /// Deliberately not scoped to a destination: picking fetches a SKU and a
    /// number, and which piece serves which shop is settled when it goes into a
    /// carton. A place that claimed to know the store would be asserting a
    /// decision nobody has made.
    DcOutboundPicking {
        dc_id: SiteId,
    },
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
    DcRejectDc {
        dc_id: SiteId,
    },
    DcRejectStore {
        dc_id: SiteId,
        store_id: SiteId,
    },
    StoreWarehouse {
        store_id: SiteId,
    },
    StoreFloor {
        store_id: SiteId,
    },
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
}

fn dc(value: &str) -> Result<SiteId, PlaceError> {
    let site = SiteId::new(value).map_err(|_| PlaceError::ExpectedDc(value.to_owned()))?;
    if site.kind() != SiteKind::Dc {
        return Err(PlaceError::ExpectedDc(value.to_owned()));
    }
    Ok(site)
}

fn store(value: &str) -> Result<SiteId, PlaceError> {
    let site = SiteId::new(value).map_err(|_| PlaceError::ExpectedStore(value.to_owned()))?;
    if site.kind() != SiteKind::Store {
        return Err(PlaceError::ExpectedStore(value.to_owned()));
    }
    Ok(site)
}

impl OperationalPool {
    pub fn id(&self) -> String {
        match self {
            Self::DcPendingUnidentified { dc_id } => format!("{dc_id}.pending.unidentified"),
            Self::DcPendingUntagged { dc_id } => format!("{dc_id}.pending.untagged"),
            Self::DcWarehouse { dc_id } => format!("{dc_id}.warehouse"),
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
            Self::DcRejectDc { dc_id } => format!("{dc_id}.reject.dc"),
            Self::DcRejectStore { dc_id, store_id } => format!("{dc_id}.reject.{store_id}"),
            Self::StoreWarehouse { store_id } => format!("{store_id}.warehouse"),
            Self::StoreFloor { store_id } => format!("{store_id}.floor"),
            Self::StoreReject { store_id } => format!("{store_id}.reject"),
        }
    }

    pub fn site_id(&self) -> &SiteId {
        match self {
            Self::DcPendingUnidentified { dc_id }
            | Self::DcPendingUntagged { dc_id }
            | Self::DcWarehouse { dc_id }
            | Self::DcOutboundPicking { dc_id }
            | Self::DcOutboundPicked { dc_id, .. }
            | Self::DcOutboundPacked { dc_id, .. }
            | Self::DcOutboundShipment { dc_id, .. }
            | Self::DcOutboundLoaded { dc_id, .. }
            | Self::DcOutboundInTransit { dc_id, .. }
            | Self::DcRejectDc { dc_id }
            | Self::DcRejectStore { dc_id, .. } => dc_id,
            Self::StoreWarehouse { store_id }
            | Self::StoreFloor { store_id }
            | Self::StoreReject { store_id } => store_id,
        }
    }

    pub fn is_dc_fulfillment_source_for(&self, dc_id: &SiteId) -> bool {
        matches!(
            self,
            Self::DcPendingUnidentified { dc_id: owner }
                | Self::DcPendingUntagged { dc_id: owner }
                | Self::DcWarehouse { dc_id: owner }
                // Goods already off the racks are the ordinary source for a
                // carton; that is the whole point of having fetched them.
                | Self::DcOutboundPicking { dc_id: owner }
                | Self::DcRejectDc { dc_id: owner }
                | Self::DcRejectStore { dc_id: owner, .. }
                if owner == dc_id
        )
    }

    pub const fn group(&self) -> GroupCode {
        match self {
            Self::DcPendingUnidentified { .. } | Self::DcPendingUntagged { .. } => {
                GroupCode::Pending
            }
            Self::DcWarehouse { .. } => GroupCode::Warehouse,
            Self::DcOutboundPicking { .. }
            | Self::DcOutboundPicked { .. }
            | Self::DcOutboundPacked { .. }
            | Self::DcOutboundShipment { .. }
            | Self::DcOutboundLoaded { .. }
            | Self::DcOutboundInTransit { .. } => GroupCode::Outbound,
            Self::DcRejectDc { .. } | Self::DcRejectStore { .. } | Self::StoreReject { .. } => {
                GroupCode::Reject
            }
            Self::StoreWarehouse { .. } | Self::StoreFloor { .. } => GroupCode::StoreInventory,
        }
    }

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
}

impl FromStr for OperationalPool {
    type Err = PlaceError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if let Some(site_id) = value.strip_suffix(".pending.unidentified") {
            return Ok(Self::DcPendingUnidentified {
                dc_id: dc(site_id)?,
            });
        }
        if let Some(site_id) = value.strip_suffix(".pending.untagged") {
            return Ok(Self::DcPendingUntagged {
                dc_id: dc(site_id)?,
            });
        }
        if let Some(site_id) = value.strip_suffix(".warehouse") {
            return if site_id == "dc" || site_id.starts_with("dc-") {
                Ok(Self::DcWarehouse {
                    dc_id: dc(site_id)?,
                })
            } else {
                Ok(Self::StoreWarehouse {
                    store_id: store(site_id)?,
                })
            };
        }
        if let Some(site_id) = value.strip_suffix(".outbound.picking") {
            return Ok(Self::DcOutboundPicking {
                dc_id: dc(site_id)?,
            });
        }
        if let Some(site_id) = value.strip_suffix(".floor") {
            return Ok(Self::StoreFloor {
                store_id: store(site_id)?,
            });
        }
        if let Some(site_id) = value.strip_suffix(".reject") {
            if site_id.starts_with("store-") {
                return Ok(Self::StoreReject {
                    store_id: store(site_id)?,
                });
            }
        }
        if let Some(site_id) = value.strip_suffix(".reject.dc") {
            return Ok(Self::DcRejectDc {
                dc_id: dc(site_id)?,
            });
        }
        for (marker, stage) in [
            (".outbound.picked.", 0_u8),
            (".outbound.packed.", 1_u8),
            (".outbound.shipment.", 2_u8),
            (".outbound.loaded.", 3_u8),
            (".outbound.in-transit.", 4_u8),
            (".reject.", 5_u8),
        ] {
            if let Some((dc_id, store_id)) = value.split_once(marker) {
                let dc_id = dc(dc_id)?;
                let store_id = store(store_id)?;
                return Ok(match stage {
                    0 => Self::DcOutboundPicked { dc_id, store_id },
                    1 => Self::DcOutboundPacked { dc_id, store_id },
                    2 => Self::DcOutboundShipment { dc_id, store_id },
                    3 => Self::DcOutboundLoaded { dc_id, store_id },
                    4 => Self::DcOutboundInTransit { dc_id, store_id },
                    _ => Self::DcRejectStore { dc_id, store_id },
                });
            }
        }
        Err(PlaceError::UnknownPool(value.to_owned()))
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
