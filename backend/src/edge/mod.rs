//! Independent SQLite edge runtime and its domain contracts.

/// Which of a till's sales head office holds yet, asked by idempotency key.
pub mod at_head_office;
/// The unit's punch station: the employee and roster slice head office
/// publishes, and this box's own durable punch log. A different thing from
/// `fingerprint` beside it, which is about signing in to a till.
pub mod attendance;
pub mod auth;
pub mod backup;
/// The one command line both node roles share: run, enroll, stage-code,
/// diagnose, the Windows service commands. `bin/store.rs` and `bin/dc.rs` are
/// three-line wrappers that name their role.
pub mod cli;
pub mod console;
pub mod contracts;
pub mod dc_allotment;
pub mod dc_outbound;
pub mod dc_receiving;
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
pub mod heartbeat;
pub mod http;
/// Deliveries head office announced to this shop, counted blind on arrival.
pub mod inbound;
pub mod laptop;
pub mod node;
pub mod notice;
pub mod ops;
pub mod outbound;
pub mod pace;
pub mod payment_methods;
/// The shop's small money: the petty cash float head office hands over, and
/// what it buys. Never the drawer — see the module note for the three pots.
pub mod petty;
pub mod pin;
/// What head office stopped on this node's POS: the store, one person, or
/// a till (postgres 0990, sqlite 0087).
pub mod pos_stop;
pub mod power;
pub mod pricing;
pub mod printing;
/// A server leaving its PC: head office's release, and nothing lost (24 Oct 2026).
pub mod removal;
pub mod reports;
pub mod rfid;
/// The return promise a shop prints and enforces, kept locally (`0101`).
pub mod point_policy;
pub mod receipt_header;
pub mod return_policy;
pub mod secret;
pub mod sign_ins;
/// What head office says about this node's site and the others — kind,
/// display code, clock — so nothing here reads them off an id.
pub mod site_profile;
pub mod sqlite;
pub mod status;
pub mod store_returns;
pub mod sync;
pub mod till;
pub mod unmatched;
pub mod update;
/// Central Gudang: what a warehouse PC moves, as numbered moves with a surat
/// jalan (sqlite 0094).
pub mod warehouse;
#[cfg(windows)]
pub mod winservice;
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
