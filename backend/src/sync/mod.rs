//! The one sync engine, shared by the cloud node and both edges.
//!
//! # Why this module exists
//!
//! There are three nodes that send facts upward and apply commands downward:
//! the cloud (PostgreSQL), the DC edge and the store edge (SQLite). The
//! temptation is to give the edges their own copy of the cycle, because their
//! storage is different. That is exactly how the reference implementation we
//! studied ended up with two settlement algorithms that had quietly drifted —
//! different backoff, different handling of an unintelligible response — and
//! only one of them could be the behaviour the cloud was actually tested
//! against. Two implementations of a settlement protocol are two protocols.
//!
//! So the algorithm lives here once, and storage lives behind
//! [`SyncStore`]. PostgreSQL keeps its row locks, SQLite keeps its single
//! writer and `BEGIN IMMEDIATE`; neither keeps an opinion about settlement.
//!
//! # What stays outside
//!
//! The wire types and the decisions — `plan_settlement`, `decide_command`,
//! the signing canonical — live in the domain and are called from here. If a
//! settlement rule ever appears in this file, the split has failed.

pub mod inventory;
pub mod port;
pub mod rfid;
pub mod transfer;
pub mod workflow;

pub use inventory::{
    PoolSnapshotBalance, PoolSnapshotPayload, PoolSnapshotValidationError,
    INVENTORY_POOL_SNAPSHOT_V1, POOL_SNAPSHOT_SCHEMA_VERSION,
};
pub use port::{run_cycle, CycleOutcome, CycleReport, SyncConfig, SyncError, SyncStore};
pub use rfid::{
    RfidObservationBatchPayload, RfidObservationSighting, RfidObservationValidationError,
    INVENTORY_RFID_OBSERVATION_BATCH_V1, MAX_RFID_SIGHTINGS_PER_BATCH,
    RFID_OBSERVATION_SCHEMA_VERSION,
};
pub use transfer::{
    TransferClaimKind, TransferClaimPayload, TransferClaimValidationError,
    INVENTORY_TRANSFER_CLAIM_V1, TRANSFER_CLAIM_SCHEMA_VERSION,
};
