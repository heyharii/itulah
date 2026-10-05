//! Independent SQLite edge runtime and its domain contracts.

/// The unit's punch station: the employee and roster slice head office
/// publishes, and this box's own durable punch log. A different thing from
/// `fingerprint` beside it, which is about signing in to a till.
pub mod attendance;
pub mod auth;
/// The one command line both node roles share: run, enroll, stage-code,
/// diagnose, the Windows service commands. `bin/store.rs` and `bin/dc.rs` are
/// three-line wrappers that name their role.
pub mod cli;
pub mod contracts;
/// The machines enrolled to this node: a till joining by code and a
/// supervisor's yes, printers recorded once, and all of it reported upward.
pub mod devices;
pub mod diagnose;
/// The node's advertisement on the shop's LAN (`_itulah-store._tcp`), so a
/// till finds it without an address typed.
pub mod discovery;
pub mod domain;
pub mod enrolment;
pub mod escpos;
pub mod fingerprint;
/// Goods flows at this node: what head office's flows said about its site,
/// and the Gudang's return inspection.
pub mod flows;
pub mod http;
/// Deliveries head office announced to this shop, counted blind on arrival.
pub mod inbound;
pub mod node;
pub mod pace;
pub mod backup;
pub mod ops;
pub mod power;
pub mod update;
pub mod secret;
pub mod console;
pub mod heartbeat;
pub mod status;
#[cfg(windows)]
pub mod winservice;
pub mod outbound;
pub mod payment_methods;
/// The shop's small money: the petty cash float head office hands over, and
/// what it buys. Never the drawer — see the module note for the three pots.
pub mod petty;
pub mod pin;
pub mod pricing;
pub mod printing;
pub mod reports;
pub mod rfid;
/// What head office says about this node's site and the others — kind,
/// display code, clock — so nothing here reads them off an id.
pub mod site_profile;
pub mod sqlite;
pub mod store_returns;
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
    derive_rfid_signing_key, sign_rfid_request, sign_rfid_request_at, DeviceProof, EdgeRfid,
    EdgeRfidObservationRequest, RfidDeviceReport, RFID_OBSERVATION_PATH, RFID_PING_PATH,
    RFID_SIGNATURE_MAX_SKEW_SECONDS,
};
pub use sqlite::SqliteEdge;
pub use sync::SqliteSyncStore;
