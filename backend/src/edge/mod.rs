//! Independent SQLite edge runtime and its domain contracts.

pub mod auth;
pub mod contracts;
pub mod domain;
pub mod http;
pub mod outbound;
pub mod pricing;
pub mod printing;
pub mod rfid;
pub mod sqlite;
pub mod sync;
pub mod zpl;

pub use auth::{EdgeAuth, EdgeAuthConfig, EdgePermission, EdgePrincipal, IssuedEdgeSession};
pub use contracts::*;
pub use domain::*;
pub use http::{dc_router, dc_router_with_auth, store_router, store_router_with_auth};
pub use rfid::{
    derive_rfid_signing_key, sign_rfid_request, DeviceProof, EdgeRfid, EdgeRfidObservationRequest,
    RFID_OBSERVATION_PATH, RFID_SIGNATURE_MAX_SKEW_SECONDS,
};
pub use sqlite::SqliteEdge;
pub use sync::SqliteSyncStore;
