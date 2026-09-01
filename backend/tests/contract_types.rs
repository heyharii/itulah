//! The browser's types come from Rust, not from a person copying them.
//!
//! Everything the till and the consoles receive is declared once, in the
//! structs the server actually serialises. Hand-written TypeScript mirroring
//! those structs is the same disease this system has had three times already —
//! two implementations of one truth, agreeing on every ordinary day and parting
//! company on the day somebody adds a field.
//!
//! Running this test writes the bindings. It is a test rather than a build
//! script so that generating them is a deliberate act (`make contract`) and so
//! that CI fails when the committed files no longer match the structs: run it,
//! and if `git status` is dirty, somebody changed the wire and did not
//! regenerate.

#![cfg(feature = "ts")]

use ts_rs::TS;

#[test]
fn the_wire_types_are_written_for_the_browser() {
    // Where the browser's package expects them.
    let config = ts_rs::Config::new()
        .with_out_dir("../frontend-contract/src")
        // 64-bit integers as `number`, not `bigint`.
        //
        // `bigint` is the technically faithful mapping and it would be a lie
        // here: `JSON.parse` produces a `number`, so a type saying `bigint`
        // describes a value the browser never actually receives, and every
        // comparison against it would be wrong in a way TypeScript would call
        // correct.
        //
        // `number` is safe for what these fields hold. They are money in the
        // smallest unit, quantities, and version counters; the largest exactly
        // representable integer in JavaScript is about nine quadrillion, which
        // is more rupiah than exists. Anything that could genuinely exceed it
        // would have to be modelled as a string on the wire, deliberately.
        .with_large_int("number");

    // Signing in. Every node speaks this, and it is the one exchange whose
    // types being wrong is invisible until nobody can log in.
    inventory_backend::contract::LoginRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("LoginRequest: {e}"));
    inventory_backend::contract::LoginResponse::export_all(&config)
        .unwrap_or_else(|e| panic!("LoginResponse: {e}"));
    inventory_backend::contract::SessionUser::export_all(&config)
        .unwrap_or_else(|e| panic!("SessionUser: {e}"));
    inventory_backend::contract::CloudMe::export_all(&config)
        .unwrap_or_else(|e| panic!("CloudMe: {e}"));
    inventory_backend::contract::EdgeMe::export_all(&config)
        .unwrap_or_else(|e| panic!("EdgeMe: {e}"));
    inventory_backend::contract::Role::export_all(&config).unwrap_or_else(|e| panic!("Role: {e}"));

    // Each of these is something a browser is handed by an HTTP route. The
    // list is the contract; anything not on it is server-side only.
    inventory_backend::edge::SaleRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SaleRequest: {e}"));
    inventory_backend::edge::SaleResult::export_all(&config)
        .unwrap_or_else(|e| panic!("SaleResult: {e}"));
    inventory_backend::edge::ReceiveRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ReceiveRequest: {e}"));
    inventory_backend::edge::MoveRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("MoveRequest: {e}"));
    inventory_backend::edge::PoolBalance::export_all(&config)
        .unwrap_or_else(|e| panic!("PoolBalance: {e}"));
    inventory_backend::edge::pricing::CatalogRow::export_all(&config)
        .unwrap_or_else(|e| panic!("CatalogRow: {e}"));
    inventory_backend::edge::pricing::Quote::export_all(&config)
        .unwrap_or_else(|e| panic!("Quote: {e}"));

    // What a warehouse screen is handed.
    inventory_backend::edge::PurchaseWorkLine::export_all(&config)
        .unwrap_or_else(|e| panic!("PurchaseWorkLine: {e}"));
    inventory_backend::edge::PurchaseCountRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PurchaseCountRequest: {e}"));
    inventory_backend::edge::PurchaseVerifyRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PurchaseVerifyRequest: {e}"));
    inventory_backend::edge::GoodsReceiptView::export_all(&config)
        .unwrap_or_else(|e| panic!("GoodsReceiptView: {e}"));
    inventory_backend::edge::OpenGoodsReceiptRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("OpenGoodsReceiptRequest: {e}"));
    inventory_backend::edge::TaggingWorkJob::export_all(&config)
        .unwrap_or_else(|e| panic!("TaggingWorkJob: {e}"));
    inventory_backend::edge::TaggingConfirmRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("TaggingConfirmRequest: {e}"));
    inventory_backend::edge::TaggingConfirmResult::export_all(&config)
        .unwrap_or_else(|e| panic!("TaggingConfirmResult: {e}"));
    inventory_backend::edge::PickRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PickRequest: {e}"));
    inventory_backend::edge::PickResult::export_all(&config)
        .unwrap_or_else(|e| panic!("PickResult: {e}"));
    inventory_backend::edge::PackKoliRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PackKoliRequest: {e}"));
    inventory_backend::edge::MovementView::export_all(&config)
        .unwrap_or_else(|e| panic!("MovementView: {e}"));
    inventory_backend::edge::EdgeOfficialCountSummary::export_all(&config)
        .unwrap_or_else(|e| panic!("EdgeOfficialCountSummary: {e}"));

    // Sourcing and suppliers: the first screens the centre gets.
    inventory_backend::cloud::domain::Supplier::export_all(&config)
        .unwrap_or_else(|e| panic!("Supplier: {e}"));
    inventory_backend::cloud::domain::SupplierItem::export_all(&config)
        .unwrap_or_else(|e| panic!("SupplierItem: {e}"));
    inventory_backend::cloud::postgres::CreateSupplierRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CreateSupplierRequest: {e}"));
    inventory_backend::cloud::postgres::UpdateSupplierRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("UpdateSupplierRequest: {e}"));
    inventory_backend::cloud::postgres::CreateSupplierItemRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CreateSupplierItemRequest: {e}"));
    inventory_backend::cloud::postgres::CatalogPurchaseOrderRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CatalogPurchaseOrderRequest: {e}"));
    inventory_backend::cloud::postgres::SourcedItem::export_all(&config)
        .unwrap_or_else(|e| panic!("SourcedItem: {e}"));
}
