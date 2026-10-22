//! The Gudang, run by the cloud itself (DC-CLOUD-NATIVE.md).
//!
//! Two ways to run a warehouse, chosen per deployment:
//!
//! - **cloud** (`INVENTORY_DC_HOSTING=cloud`): this module. The Gudang's work
//!   — receiving, tagging, picking, packing, dispatch, returns — is done by the
//!   cloud against its own tables. No DC node, no SQLite, no sync: a receipt
//!   accepted here IS the cloud's goods receipt.
//! - **on-premise** (default): a DC server in the warehouse (`bin/dc.rs`,
//!   `edge::*`) with its own SQLite, syncing to the cloud. Unchanged.
//!
//! The routes answer the same paths and the same JSON as the DC server's
//! `/api/v1/dc/*` (the shapes are `edge::contracts`'), so the hub's
//! Operations screens run against either; the hub asks `/api/v1/health` which
//! one it has (`dc_hosting`).
//!
//! When the Gudang is hosted here, no origin owns the head-office site: the
//! cloud executes allotments and official counts itself (as it already does
//! for a site without a node), and purchase orders and tagging jobs are issued
//! without a command to anybody. What the downstream readers (payables,
//! letters, flows, valuation) read is written in the same shape the DC
//! server's facts produced, by the same appliers, under the pseudo-origin
//! [`common::CLOUD_DC_ORIGIN`].

use crate::cloud::AppState;
use axum::Router;

pub mod changes;
pub mod common;
pub mod move_back;
pub mod owed;
pub mod packing;
pub mod picking;
pub mod print_bridge;
pub mod receiving;
pub mod returns;
pub mod rfid_verify;
pub mod short_pick;
pub mod tagging;

/// Every Gudang route, added in one call (`cloud::http::router`). Each area
/// adds its own, so the areas are built side by side without touching each
/// other's files.
pub fn routes(router: Router<AppState>) -> Router<AppState> {
    let router = receiving::routes(router);
    let router = tagging::routes(router);
    let router = picking::routes(router);
    let router = short_pick::routes(router);
    let router = packing::routes(router);
    let router = move_back::routes(router);
    let router = owed::routes(router);
    let router = changes::routes(router);
    let router = returns::routes(router);
    let router = rfid_verify::routes(router);
    print_bridge::routes(router)
}
