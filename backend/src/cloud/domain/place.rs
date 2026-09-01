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
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "on_hand",
            Self::Missing => "missing",
        }
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "store_id",
    rename_all = "SCREAMING_SNAKE_CASE"
)]
pub enum OperationalPool {
    DcPendingUnidentified,
    DcPendingUntagged,
    DcWarehouse,
    /// Off the racks, in the outbound area, and committed to nobody.
    ///
    /// Carries no store because picking commits to none: a picker fetches a
    /// SKU and a number, and which piece serves which shop is settled when it
    /// goes into a carton. The edge has modelled it this way since picking
    /// became a real movement; the centre has to agree, or the two hold
    /// different pictures of one warehouse floor.
    DcOutboundPicking,
    DcOutboundPicked(SiteId),
    DcOutboundPacked(SiteId),
    DcOutboundShipment(SiteId),
    DcOutboundInTransit(SiteId),
    DcRejectDc,
    DcRejectStore(SiteId),
    StoreWarehouse(SiteId),
    StoreFloor(SiteId),
    StoreReject(SiteId),
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
    #[error("DC cannot be used as a store identifier")]
    DcIsNotStore,
    #[error("missing is only valid below an operational pool")]
    MissingRequiresOperationalPool,
}

impl OperationalPool {
    pub fn id(&self) -> String {
        match self {
            Self::DcPendingUnidentified => "dc.pending.unidentified".into(),
            Self::DcPendingUntagged => "dc.pending.untagged".into(),
            Self::DcWarehouse => "dc.warehouse".into(),
            Self::DcOutboundPicking => "dc.outbound.picking".to_string(),
            Self::DcOutboundPicked(store) => format!("dc.outbound.picked.{store}"),
            Self::DcOutboundPacked(store) => format!("dc.outbound.packed.{store}"),
            Self::DcOutboundShipment(store) => format!("dc.outbound.shipment.{store}"),
            Self::DcOutboundInTransit(store) => format!("dc.outbound.in-transit.{store}"),
            Self::DcRejectDc => "dc.reject.dc".into(),
            Self::DcRejectStore(site) => format!("dc.reject.{site}"),
            Self::StoreWarehouse(site) => format!("{site}.warehouse"),
            Self::StoreFloor(site) => format!("{site}.floor"),
            Self::StoreReject(site) => format!("{site}.reject"),
        }
    }

    pub fn site_id(&self) -> SiteId {
        match self {
            Self::DcPendingUnidentified
            | Self::DcPendingUntagged
            | Self::DcWarehouse
            | Self::DcOutboundPicking
            | Self::DcOutboundPicked(_)
            | Self::DcOutboundPacked(_)
            | Self::DcOutboundShipment(_)
            | Self::DcOutboundInTransit(_)
            | Self::DcRejectDc
            | Self::DcRejectStore(_) => SiteId::dc(),
            Self::StoreWarehouse(site) | Self::StoreFloor(site) | Self::StoreReject(site) => {
                site.clone()
            }
        }
    }

    pub fn group(&self) -> GroupCode {
        match self {
            Self::DcPendingUnidentified | Self::DcPendingUntagged => GroupCode::Pending,
            Self::DcWarehouse => GroupCode::Warehouse,
            Self::DcOutboundPicking
            | Self::DcOutboundPicked(_)
            | Self::DcOutboundPacked(_)
            | Self::DcOutboundShipment(_)
            | Self::DcOutboundInTransit(_) => GroupCode::Outbound,
            Self::DcRejectDc | Self::DcRejectStore(_) | Self::StoreReject(_) => GroupCode::Reject,
            Self::StoreWarehouse(_) | Self::StoreFloor(_) => GroupCode::StoreInventory,
        }
    }

    pub fn store_origin(&self) -> Option<&SiteId> {
        match self {
            Self::DcRejectStore(site) => Some(site),
            _ => None,
        }
    }

    pub fn outbound_destination(&self) -> Option<&SiteId> {
        match self {
            Self::DcOutboundPicked(store)
            | Self::DcOutboundPacked(store)
            | Self::DcOutboundShipment(store)
            | Self::DcOutboundInTransit(store) => Some(store),
            _ => None,
        }
    }
}

fn store(value: &str) -> Result<SiteId, PlaceError> {
    let site = SiteId::new(value).map_err(|_| PlaceError::UnknownPool(value.to_owned()))?;
    if site.kind() != SiteKind::Store {
        return Err(PlaceError::DcIsNotStore);
    }
    Ok(site)
}

impl FromStr for OperationalPool {
    type Err = PlaceError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "dc.pending.unidentified" => Ok(Self::DcPendingUnidentified),
            "dc.pending.untagged" => Ok(Self::DcPendingUntagged),
            "dc.warehouse" => Ok(Self::DcWarehouse),
            "dc.outbound.picking" => Ok(Self::DcOutboundPicking),
            _ if value.starts_with("dc.outbound.picked.store-") => Ok(Self::DcOutboundPicked(
                store(value.trim_start_matches("dc.outbound.picked."))?,
            )),
            _ if value.starts_with("dc.outbound.packed.store-") => Ok(Self::DcOutboundPacked(
                store(value.trim_start_matches("dc.outbound.packed."))?,
            )),
            _ if value.starts_with("dc.outbound.shipment.store-") => Ok(Self::DcOutboundShipment(
                store(value.trim_start_matches("dc.outbound.shipment."))?,
            )),
            _ if value.starts_with("dc.outbound.in-transit.store-") => {
                Ok(Self::DcOutboundInTransit(store(
                    value.trim_start_matches("dc.outbound.in-transit."),
                )?))
            }
            "dc.reject.dc" => Ok(Self::DcRejectDc),
            _ if value.starts_with("dc.reject.store-") => Ok(Self::DcRejectStore(store(
                value.trim_start_matches("dc.reject."),
            )?)),
            _ if value.starts_with("store-") && value.ends_with(".warehouse") => Ok(
                Self::StoreWarehouse(store(value.trim_end_matches(".warehouse"))?),
            ),
            _ if value.starts_with("store-") && value.ends_with(".floor") => {
                Ok(Self::StoreFloor(store(value.trim_end_matches(".floor"))?))
            }
            _ if value.starts_with("store-") && value.ends_with(".reject") => {
                Ok(Self::StoreReject(store(value.trim_end_matches(".reject"))?))
            }
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
        }
    }

    pub fn is_company(&self) -> bool {
        matches!(self, Self::Operational { .. })
    }
    pub fn is_saleable(&self) -> bool {
        matches!(
            self,
            Self::Operational {
                pool: OperationalPool::StoreFloor(_),
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
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.id())
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
    fn store_reject_origin_is_preserved() {
        let seven: OperationalPool = "dc.reject.store-07"
            .parse()
            .unwrap_or_else(|e| panic!("{e}"));
        let eight: OperationalPool = "dc.reject.store-08"
            .parse()
            .unwrap_or_else(|e| panic!("{e}"));
        assert_ne!(seven, eight);
        assert_eq!(seven.store_origin().map(SiteId::as_str), Some("store-07"));
    }

    #[test]
    fn only_store_floor_on_hand_is_saleable() {
        let floor: Place = "store-03.floor:on_hand"
            .parse()
            .unwrap_or_else(|e| panic!("{e}"));
        let missing: Place = "store-03.floor:missing"
            .parse()
            .unwrap_or_else(|e| panic!("{e}"));
        let warehouse: Place = "store-03.warehouse:on_hand"
            .parse()
            .unwrap_or_else(|e| panic!("{e}"));
        assert!(floor.is_saleable());
        assert!(!missing.is_saleable());
        assert!(!warehouse.is_saleable());
    }

    #[test]
    fn group_is_not_a_place() {
        assert!("dc.outbound".parse::<Place>().is_err());
    }
}
