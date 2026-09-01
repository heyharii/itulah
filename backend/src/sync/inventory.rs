//! Neutral inventory observability facts shared by sync producers and consumers.
//!
//! Pool snapshots are owner-scoped read-model facts. They intentionally carry
//! no subject identifiers and are not movement-ledger commands.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use thiserror::Error;

pub const INVENTORY_POOL_SNAPSHOT_V1: &str = "inventory.pool_snapshot.v1";
pub const POOL_SNAPSHOT_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PoolSnapshotBalance {
    pub pool_id: String,
    pub stock: i64,
    pub allotted: Option<i64>,
    pub on_hand: i64,
    pub missing: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PoolSnapshotPayload {
    pub schema_version: u32,
    pub node_id: String,
    pub node_role: String,
    pub site_id: String,
    pub captured_at: DateTime<Utc>,
    pub pools: Vec<PoolSnapshotBalance>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PoolSnapshotValidationError {
    #[error("pool snapshot schema_version must be {POOL_SNAPSHOT_SCHEMA_VERSION}")]
    UnsupportedSchemaVersion,
    #[error("pool snapshot {0} is required")]
    MissingIdentity(&'static str),
    #[error("pool_id is required")]
    MissingPoolId,
    #[error("pool snapshot contains duplicate pool_id {0}")]
    DuplicatePool(String),
    #[error("pool {0} contains a negative balance component")]
    NegativeBalance(String),
    #[error("pool {0} balance arithmetic overflow")]
    BalanceOverflow(String),
    #[error("pool {pool_id} violates stock = on_hand + allotted + missing")]
    BalanceEquation { pool_id: String },
}

impl PoolSnapshotPayload {
    pub fn new(
        node_id: impl Into<String>,
        node_role: impl Into<String>,
        site_id: impl Into<String>,
        captured_at: DateTime<Utc>,
        pools: Vec<PoolSnapshotBalance>,
    ) -> Result<Self, PoolSnapshotValidationError> {
        let payload = Self {
            schema_version: POOL_SNAPSHOT_SCHEMA_VERSION,
            node_id: node_id.into(),
            node_role: node_role.into(),
            site_id: site_id.into(),
            captured_at,
            pools,
        };
        payload.validate()?;
        Ok(payload)
    }

    pub fn validate(&self) -> Result<(), PoolSnapshotValidationError> {
        if self.schema_version != POOL_SNAPSHOT_SCHEMA_VERSION {
            return Err(PoolSnapshotValidationError::UnsupportedSchemaVersion);
        }
        for (name, value) in [
            ("node_id", self.node_id.as_str()),
            ("node_role", self.node_role.as_str()),
            ("site_id", self.site_id.as_str()),
        ] {
            if value.trim().is_empty() {
                return Err(PoolSnapshotValidationError::MissingIdentity(name));
            }
        }

        let mut pool_ids = HashSet::with_capacity(self.pools.len());
        for pool in &self.pools {
            if pool.pool_id.trim().is_empty() {
                return Err(PoolSnapshotValidationError::MissingPoolId);
            }
            if !pool_ids.insert(pool.pool_id.as_str()) {
                return Err(PoolSnapshotValidationError::DuplicatePool(
                    pool.pool_id.clone(),
                ));
            }
            let allotted = pool.allotted.unwrap_or_default();
            if pool.stock < 0 || allotted < 0 || pool.on_hand < 0 || pool.missing < 0 {
                return Err(PoolSnapshotValidationError::NegativeBalance(
                    pool.pool_id.clone(),
                ));
            }
            let projected_stock = pool
                .on_hand
                .checked_add(allotted)
                .and_then(|value| value.checked_add(pool.missing))
                .ok_or_else(|| {
                    PoolSnapshotValidationError::BalanceOverflow(pool.pool_id.clone())
                })?;
            if pool.stock != projected_stock {
                return Err(PoolSnapshotValidationError::BalanceEquation {
                    pool_id: pool.pool_id.clone(),
                });
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn balance(pool_id: &str) -> PoolSnapshotBalance {
        PoolSnapshotBalance {
            pool_id: pool_id.into(),
            stock: 10,
            allotted: Some(2),
            on_hand: 7,
            missing: 1,
        }
    }

    #[test]
    fn valid_snapshot_round_trips() {
        let payload = PoolSnapshotPayload::new(
            "store-07-edge",
            "STORE",
            "store-07",
            Utc::now(),
            vec![balance("store-07.floor")],
        )
        .unwrap_or_else(|error| panic!("snapshot: {error}"));
        let json = serde_json::to_string(&payload)
            .unwrap_or_else(|error| panic!("serialize snapshot: {error}"));
        let decoded: PoolSnapshotPayload = serde_json::from_str(&json)
            .unwrap_or_else(|error| panic!("deserialize snapshot: {error}"));
        assert_eq!(decoded, payload);
        assert_eq!(INVENTORY_POOL_SNAPSHOT_V1, "inventory.pool_snapshot.v1");
    }

    #[test]
    fn invalid_equation_and_duplicate_pool_are_rejected() {
        let mut invalid = balance("store-07.floor");
        invalid.stock = 11;
        let equation =
            PoolSnapshotPayload::new("node", "STORE", "store-07", Utc::now(), vec![invalid]);
        assert!(matches!(
            equation,
            Err(PoolSnapshotValidationError::BalanceEquation { .. })
        ));

        let duplicate = PoolSnapshotPayload::new(
            "node",
            "STORE",
            "store-07",
            Utc::now(),
            vec![balance("store-07.floor"), balance("store-07.floor")],
        );
        assert!(matches!(
            duplicate,
            Err(PoolSnapshotValidationError::DuplicatePool(_))
        ));
    }
}
