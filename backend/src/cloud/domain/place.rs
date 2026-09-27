use super::SiteId;
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

/// One pool grammar for both nodes.
///
/// The centre used to keep its own: exactly one warehouse, spelled `dc` into
/// the ids (`dc.warehouse`, `dc.outbound.packed.store-07`), and a shop told
/// apart by the `store-` in front of its id. The edge parameterised the same
/// grammar by its site, so one warehouse had two spellings and every new site
/// was a code change (inventory-fleet G1). Since 0610 a pool's ROLE is its
/// role path and the site half is a label, so both nodes read one grammar —
/// the edge's — and every pool the centre already holds reads in it unchanged:
/// `dc.warehouse` is the stockroom of site `dc`, which is what its
/// `operational_pool` row has always said.
pub use crate::edge::{GroupCode, OperationalPool};
pub use crate::pool_role::{OutboundStage, PoolRole};

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
                pool,
                state: InventoryState::Normal
            } if pool.role().is_saleable()
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
                    pool: pool
                        .parse::<OperationalPool>()
                        .map_err(|error| PlaceError::UnknownPool(error.to_string()))?,
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
        assert_eq!(seven.return_origin().map(SiteId::as_str), Some("store-07"));
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
