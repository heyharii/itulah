//! Independent SQLite edge runtime and its domain contracts.

pub mod auth;
pub mod contracts;
pub mod domain;
pub mod escpos;
pub mod fingerprint;
pub mod http;
pub mod outbound;
/// The shop's small money: the petty cash float head office hands over, and
/// what it buys. Never the drawer — see the module note for the three pots.
pub mod petty;
pub mod pricing;
pub mod printing;
pub mod reports;
pub mod rfid;
pub mod sqlite;
pub mod sync;
pub mod till;
pub mod zpl;

pub use auth::{EdgeAuth, EdgeAuthConfig, EdgePermission, EdgePrincipal, IssuedEdgeSession};
pub use contracts::*;
pub use domain::*;
pub use http::{
    dc_router, dc_router_with_auth, dc_router_with_sync, store_router, store_router_with_auth,
    store_router_with_sync,
};
pub use rfid::{
    derive_rfid_signing_key, sign_rfid_request, DeviceProof, EdgeRfid, EdgeRfidObservationRequest,
    RFID_OBSERVATION_PATH, RFID_SIGNATURE_MAX_SKEW_SECONDS,
};
pub use sqlite::SqliteEdge;
pub use sync::SqliteSyncStore;
