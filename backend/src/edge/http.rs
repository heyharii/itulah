use crate::clock::{ClockError, ClockMode, ClockStatus};
use crate::cloud::domain::relay;
use crate::cloud::http::clock::ClockControlRequest;
use crate::contract::{
    ChangePasswordRequest, EdgeMe, EdgeSyncStatus, EdgeSyncTriggered, LoginRequest, LoginResponse,
    SessionUser,
};
use crate::edge::{
    sync::EdgeSyncHandle, AdvanceKoliRequest, CreateKoliShipmentRequest, DeviceProof, EdgeAuth,
    EdgeAuthConfig, EdgeError, EdgeInventory, EdgeOfficialCountDetail, EdgeOfficialCountSummary,
    EdgePermission, EdgePrincipal, EdgeRfid, EdgeRole, IntakeRequest, MoveBySkuRequest,
    MoveRequest, NodeContext, OfficialCountEntriesRequest, OfficialCountSubmitRequest,
    OpenGoodsReceiptRequest, OperationalPool, PackKoliRequest, PickRequest, PoolBalance,
    PurchaseCountBatchRequest, PurchaseCountRequest, PurchaseReturnHandoverRequest,
    PurchaseVerifyRequest, ReceiveBatchRequest, ReceiveRequest, RecordInvoiceRequest,
    RejectDeliveryRequest, SaleRequest, StoreInvoiceDocumentRequest, TaggingConfirmRequest,
    RFID_OBSERVATION_PATH, RFID_PING_PATH,
};
use crate::security::{self, CSRF_COOKIE, SESSION_COOKIE};
use crate::sync::device::{SELF_REQUESTS_PATH, SELF_TEST_PRINT_RESULT_PATH};
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::PathBuf, str::FromStr, sync::Arc};
use tower_http::{
    compression::CompressionLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use uuid::Uuid;

#[derive(Clone)]
struct EdgeState {
    inventory: Arc<dyn EdgeInventory>,
    auth: Arc<EdgeAuth>,
    rfid: Arc<EdgeRfid>,
    /// The running sync agent, when this node has one. `None` means
    /// SYNC_UPLOAD_URL was unset: capture still runs and the backlog is still
    /// durable, but nothing is being uploaded — and the status endpoint says
    /// exactly that rather than reporting a healthy idle sender.
    sync: Option<Arc<EdgeSyncHandle>>,
    /// The node's business clock — the SAME handle the inventory stamps with,
    /// so the control endpoint below moves the one clock every sale reads.
    clock: Arc<crate::clock::ClockHandle>,
    /// Whether the test-control surface answers. Read once at boot from
    /// INVENTORY_ENABLE_TEST_CONTROLS: fail-closed, so a node that was never
    /// told its database is disposable refuses to move time.
    test_controls: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct MovementQuery {
    limit: Option<usize>,
}

pub fn dc_router(
    inventory: Arc<dyn EdgeInventory>,
    frontend_dir: PathBuf,
) -> Result<Router, EdgeError> {
    let auth = Arc::new(EdgeAuth::new(
        sqlite_connection_unavailable(),
        inventory.node().clone(),
        EdgeAuthConfig::disabled(),
    )?);
    dc_router_with_auth(inventory, auth, frontend_dir)
}

pub fn dc_router_with_auth(
    inventory: Arc<dyn EdgeInventory>,
    auth: Arc<EdgeAuth>,
    frontend_dir: PathBuf,
) -> Result<Router, EdgeError> {
    dc_router_with_sync(inventory, auth, frontend_dir, None)
}

/// As above, plus the running sync agent, so the warehouse screen can see its
/// own outbox and ask for it to be sent now.
pub fn dc_router_with_sync(
    inventory: Arc<dyn EdgeInventory>,
    auth: Arc<EdgeAuth>,
    frontend_dir: PathBuf,
    sync: Option<Arc<EdgeSyncHandle>>,
) -> Result<Router, EdgeError> {
    if inventory.node().role != EdgeRole::Dc {
        return Err(EdgeError::Configuration(
            "DC router requires a DC Edge inventory adapter".into(),
        ));
    }
    validate_auth_node(inventory.as_ref(), &auth)?;
    let clock = inventory.clock();
    let rfid = Arc::new(EdgeRfid::new(
        auth.connection(),
        auth.node().clone(),
        clock.clone(),
    ));
    let state = EdgeState {
        inventory,
        auth,
        rfid,
        sync,
        test_controls: test_controls_enabled(),
        clock,
    };
    Ok(common_router()
        .route("/api/v1/dc/intake", post(dc_intake))
        .route("/api/v1/dc/picks", post(dc_pick))
        .route(
            "/api/v1/dc/koli/{koli_id}/shipment",
            post(dc_create_fulfillment_shipment),
        )
        .route("/api/v1/dc/koli/{koli_id}/dispatch", post(dc_dispatch_koli))
        .route(
            "/api/v1/dc/koli/{koli_id}/in-transit",
            post(dc_mark_fulfillment_in_transit),
        )
        .route(
            "/api/v1/dc/pick-sessions",
            post(dc_open_pick_session).get(dc_list_pick_sessions),
        )
        .route(
            "/api/v1/dc/pick-sessions/{session_id}",
            get(dc_pick_session),
        )
        .route(
            "/api/v1/dc/pick-sessions/{session_id}/close",
            post(dc_close_pick_session),
        )
        .route(
            "/api/v1/dc/packing-sessions",
            post(dc_open_packing_session).get(dc_list_packing_sessions),
        )
        .route(
            "/api/v1/dc/packing-sessions/{session_id}",
            get(dc_packing_session),
        )
        .route(
            "/api/v1/dc/packing-sessions/{session_id}/close",
            post(dc_close_packing_session),
        )
        .route("/api/v1/dc/koli/{koli_id}", get(dc_koli_manifest))
        .route("/api/v1/dc/koli/{koli_id}/session", post(dc_assign_koli))
        .route("/api/v1/dc/koli/{koli_id}/seal", post(dc_seal_koli))
        .route("/api/v1/dc/koli/{koli_id}/label", post(dc_print_koli_label))
        .route("/api/v1/dc/picklist", get(dc_picklist))
        .route("/api/v1/dc/picklist/allotments", get(dc_picklists_to_pick))
        .route("/api/v1/dc/move-back", post(dc_move_back))
        .route("/api/v1/dc/owed", get(dc_owed))
        .route(
            "/api/v1/dc/short-picks",
            get(dc_short_picks).post(dc_report_short_pick),
        )
        .route("/api/v1/dc/changes", get(dc_changes))
        .route(
            "/api/v1/dc/changes/acknowledge",
            post(dc_acknowledge_change),
        )
        .route("/api/v1/dc/dispatch-trips", post(dc_dispatch_trip))
        .route(
            "/api/v1/dc/picklists",
            get(dc_picklists).post(dc_create_picklist),
        )
        .route("/api/v1/dc/packs", post(dc_pack_by_quantity))
        .route(
            "/api/v1/dc/shipments",
            post(dc_create_shipment).get(dc_list_shipments),
        )
        .route("/api/v1/dc/koli", get(dc_list_koli).post(dc_pack_koli))
        .route(
            "/api/v1/dc/packing-boxes",
            get(dc_open_packing_boxes).post(dc_open_packing_box),
        )
        .route("/api/v1/dc/packing-boxes/{session_id}", get(dc_packing_box))
        .route(
            "/api/v1/dc/packing-boxes/{session_id}/candidates",
            get(dc_box_candidates),
        )
        .route(
            "/api/v1/dc/packing-boxes/{session_id}/capture",
            post(dc_capture_packing_box),
        )
        .route("/api/v1/dc/destinations", get(dc_destinations))
        .route(
            "/api/v1/dc/destinations/{store_id}/outstanding",
            get(dc_outstanding),
        )
        .route(
            "/api/v1/dc/shipments/{shipment_id}",
            get(dc_shipment_detail),
        )
        .route(
            "/api/v1/dc/dispatches/{dispatch_id}",
            get(dc_dispatch_detail),
        )
        .route(
            "/api/v1/dc/dispatches",
            post(dc_create_dispatch).get(dc_list_dispatches),
        )
        .route(
            "/api/v1/dc/dispatches/{dispatch_id}/depart",
            post(dc_depart_dispatch),
        )
        .route(
            "/api/v1/dc/allotment-lines/{allotment_line_id}/position",
            get(dc_allotment_line_position),
        )
        .route("/api/v1/dc/printer/test", post(dc_test_printer))
        // First sign-in from the Cloud hub. The request is unauthenticated at
        // this node by design, but its body contains a short-lived Cloud
        // signature that this DC verifies and consumes exactly once.
        .route("/api/v1/auth/sso/exchange", post(edge_sso_exchange))
        .route("/api/v1/dc/print-sessions", post(dc_open_print_session))
        .route(
            "/api/v1/dc/print-sessions/{session_id}",
            get(dc_print_session),
        )
        .route(
            "/api/v1/dc/print-sessions/{session_id}/run",
            post(dc_run_print_chunk),
        )
        .route(
            "/api/v1/dc/tagging-jobs/{job_id}/label-preview",
            post(dc_preview_job_label),
        )
        .route(
            "/api/v1/dc/print-sessions/{session_id}/printer",
            post(dc_repoint_print_session),
        )
        .route(
            "/api/v1/dc/print-sessions/{session_id}/reprint",
            post(dc_reprint_labels),
        )
        .route(
            "/api/v1/dc/tagging-jobs/{job_id}/print-session",
            get(dc_job_print_session),
        )
        .route("/api/v1/dc/movements", post(move_stock))
        // A shop's return, announced by head office and counted blind on
        // arrival into that store's return pool — the same receipt a shop
        // makes of an allotment (`edge::inbound`). Inspection afterwards is an
        // ordinary move out of the return pool: good goods to the racks,
        // damaged goods to reject.
        .route("/api/v1/dc/inbound", get(store_inbound_list))
        .route(
            "/api/v1/dc/inbound/{delivery_id}",
            get(store_inbound_detail),
        )
        .route(
            "/api/v1/dc/inbound/{delivery_id}/receive",
            post(store_inbound_receive),
        )
        .route(
            "/api/v1/dc/inbound/{delivery_id}/receive-count",
            post(store_inbound_receive_count),
        )
        // Inspecting a store's return once it is received into that store's
        // return pool: good goods to the racks, damaged goods to reject — the
        // goods flow's Inspect stage (`edge::flows`).
        .route("/api/v1/dc/inspections", get(dc_return_inspections))
        .route(
            "/api/v1/dc/inbound/{delivery_id}/inspection",
            get(dc_return_inspection).post(dc_inspect_return),
        )
        .route("/api/v1/dc/official-counts", get(dc_official_counts))
        .route(
            "/api/v1/dc/official-counts/{count_id}",
            get(dc_official_count),
        )
        .route(
            "/api/v1/dc/official-counts/{count_id}/entries",
            post(dc_official_count_entries),
        )
        .route(
            "/api/v1/dc/official-counts/{count_id}/submit",
            post(dc_submit_official_count),
        )
        .route("/api/v1/dc/purchase-orders", get(dc_purchase_lines))
        .route(
            "/api/v1/dc/purchase-orders/summary",
            get(dc_purchase_summary),
        )
        .route(
            "/api/v1/dc/goods-receipts",
            get(dc_goods_receipts).post(dc_open_goods_receipt),
        )
        .route(
            "/api/v1/dc/goods-receipts/{receipt_id}/invoice",
            post(dc_record_receipt_invoice),
        )
        .route(
            "/api/v1/dc/goods-receipts/{receipt_id}/reject",
            post(dc_reject_delivery),
        )
        .route(
            "/api/v1/dc/goods-receipts/{receipt_id}/invoice-document",
            get(dc_invoice_document).post(dc_store_invoice_document),
        )
        .route(
            "/api/v1/dc/purchase-counts",
            get(dc_counts_awaiting_verification).post(dc_count_purchase),
        )
        .route(
            "/api/v1/dc/purchase-counts/batch",
            post(dc_count_purchase_batch),
        )
        .route(
            "/api/v1/dc/purchase-verifications",
            post(dc_verify_purchase),
        )
        .route("/api/v1/dc/purchase-returns", get(dc_purchase_returns))
        .route(
            "/api/v1/dc/purchase-returns/{return_id}/hand-over",
            post(dc_hand_over_purchase_return),
        )
        .route("/api/v1/dc/tagging-jobs", get(dc_tagging_jobs))
        .route("/api/v1/dc/tagging-confirmations", post(dc_confirm_tagging))
        .fallback_service(
            // A single-page app owns its own routes, so the node has to hand
            // `index.html` to any path it has no file for and let the router
            // decide. Without this, `/terima/hitung?po=…` is a 404 the moment
            // somebody reloads it or opens it from a message — the app works
            // perfectly until the first refresh, which is the worst way for it
            // to break because it looks like the node has died.
            ServeDir::new(&frontend_dir)
                .append_index_html_on_directories(true)
                .fallback(ServeFile::new(frontend_dir.join("index.html"))),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            require_auth,
        ))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state))
}

pub fn store_router(
    inventory: Arc<dyn EdgeInventory>,
    frontend_dir: PathBuf,
) -> Result<Router, EdgeError> {
    let auth = Arc::new(EdgeAuth::new(
        sqlite_connection_unavailable(),
        inventory.node().clone(),
        EdgeAuthConfig::disabled(),
    )?);
    store_router_with_auth(inventory, auth, frontend_dir)
}

pub fn store_router_with_auth(
    inventory: Arc<dyn EdgeInventory>,
    auth: Arc<EdgeAuth>,
    frontend_dir: PathBuf,
) -> Result<Router, EdgeError> {
    store_router_with_sync(inventory, auth, frontend_dir, None)
}

/// As above, plus the running sync agent, so the till can see whether today's
/// sales have actually reached head office.
pub fn store_router_with_sync(
    inventory: Arc<dyn EdgeInventory>,
    auth: Arc<EdgeAuth>,
    frontend_dir: PathBuf,
    sync: Option<Arc<EdgeSyncHandle>>,
) -> Result<Router, EdgeError> {
    if inventory.node().role != EdgeRole::Store {
        return Err(EdgeError::Configuration(
            "Store router requires a Store Edge inventory adapter".into(),
        ));
    }
    validate_auth_node(inventory.as_ref(), &auth)?;
    let clock = inventory.clock();
    let rfid = Arc::new(EdgeRfid::new(
        auth.connection(),
        auth.node().clone(),
        clock.clone(),
    ));
    let state = EdgeState {
        inventory,
        auth,
        rfid,
        sync,
        test_controls: test_controls_enabled(),
        clock,
    };
    Ok(common_router()
        .route("/api/v1/store/receive", post(store_receive))
        .route("/api/v1/store/receive-batch", post(store_receive_batch))
        // Deliveries head office announced as on their way here, counted
        // blind on arrival — see `edge::inbound`. The two routes above stay
        // for goods that arrive unannounced.
        .route("/api/v1/store/inbound", get(store_inbound_list))
        // What the shop counted and could not book, until MD answers.
        .route("/api/v1/store/inbound/on-hold", get(store_on_hold))
        // A scanned koli label or surat jalan → the delivery (and koli) it is.
        .route("/api/v1/store/inbound/scan", get(store_inbound_scan))
        .route(
            "/api/v1/store/inbound/{delivery_id}",
            get(store_inbound_detail),
        )
        .route(
            "/api/v1/store/inbound/{delivery_id}/receive",
            post(store_inbound_receive),
        )
        .route(
            "/api/v1/store/inbound/{delivery_id}/receive-count",
            post(store_inbound_receive_count),
        )
        .route("/api/v1/store/movements", post(move_stock))
        // The Move stock screen: an SKU and a count, no scanning. The node
        // chooses which pieces go.
        .route("/api/v1/store/movements/by-sku", post(move_stock_by_sku))
        // The shop counts its own stock when head office asks (owner, 2 Oct
        // 2026): the same Official Count the Gudang walks, served blind — what
        // the book expects never leaves this node for a count in progress.
        .route("/api/v1/store/counts", get(store_counts))
        .route("/api/v1/store/counts/{count_id}", get(store_count))
        .route(
            "/api/v1/store/counts/{count_id}/entries",
            post(store_count_entries),
        )
        .route(
            "/api/v1/store/counts/{count_id}/submit",
            post(store_count_submit),
        )
        // Sending goods out: a shop's return to the Gudang (head office
        // raises it; postgres `0611`, and `0628` closed store→store). The same
        // pick, koli, surat jalan and lorry the Gudang uses — one outbound
        // path for every site, served by the same handlers.
        //
        // Those handlers ask `outbound_permission`, which is the node's own
        // answer: `DcOperate` (a cashier's) at the Gudang, where picking is a
        // picker's work, and `InventoryMove` (a supervisor's) at a shop, where
        // sending goods out is a stock mutation by hand — the same rung its
        // `/store/movements` and `/store/receive` already require.
        .route("/api/v1/store/outbound/picks", post(dc_pick))
        .route("/api/v1/store/outbound/destinations", get(dc_destinations))
        .route(
            "/api/v1/store/outbound/destinations/{store_id}/outstanding",
            get(dc_outstanding),
        )
        .route(
            "/api/v1/store/outbound/koli",
            get(dc_list_koli).post(dc_pack_koli),
        )
        .route("/api/v1/store/outbound/packs", post(dc_pack_by_quantity))
        // What Merchandise asked this shop to send back, and the one tap that
        // sends it (owner, 1 Oct 2026: no pick flow at a shop).
        .route("/api/v1/store/return-requests", get(store_return_asks))
        .route(
            "/api/v1/store/return-requests/{allotment_id}/send",
            post(store_return_send),
        )
        .route(
            "/api/v1/store/outbound/koli/{koli_id}",
            get(dc_koli_manifest),
        )
        .route(
            "/api/v1/store/outbound/koli/{koli_id}/seal",
            post(dc_seal_koli),
        )
        .route(
            "/api/v1/store/outbound/koli/{koli_id}/shipment",
            post(dc_create_fulfillment_shipment),
        )
        .route(
            "/api/v1/store/outbound/koli/{koli_id}/dispatch",
            post(dc_dispatch_koli),
        )
        .route(
            "/api/v1/store/outbound/koli/{koli_id}/in-transit",
            post(dc_mark_fulfillment_in_transit),
        )
        .route(
            "/api/v1/store/outbound/shipments",
            post(dc_create_shipment).get(dc_list_shipments),
        )
        .route(
            "/api/v1/store/outbound/shipments/{shipment_id}",
            get(dc_shipment_detail),
        )
        .route(
            "/api/v1/store/outbound/dispatches",
            post(dc_create_dispatch).get(dc_list_dispatches),
        )
        .route(
            "/api/v1/store/outbound/dispatches/{dispatch_id}",
            get(dc_dispatch_detail),
        )
        .route(
            "/api/v1/store/outbound/dispatches/{dispatch_id}/depart",
            post(dc_depart_dispatch),
        )
        .route("/api/v1/store/sales", post(store_sale))
        // The attempt, declared before the terminal is asked for money. Four
        // routes rather than one because the till drives a card reader between
        // them, and every step in that conversation has to be able to fail
        // without losing what came before it.
        .route("/api/v1/store/checkouts", post(begin_checkout))
        .route(
            "/api/v1/store/checkouts/tender",
            post(record_tender_outcome),
        )
        .route("/api/v1/store/checkouts/resolve", post(resolve_checkout))
        .route(
            "/api/v1/store/checkouts/unresolved",
            get(unresolved_checkouts),
        )
        // Price a basket without selling it. POST because a basket is a body,
        // not because anything is written: no sale, no movement, no usage.
        .route("/api/v1/store/quote", post(store_quote))
        .route("/api/v1/store/catalog", get(store_catalog))
        .route("/api/v1/store/payment-methods", get(store_payment_methods))
        // What is on, and what is about to be. Read-only, resident, and it
        // stays answerable with the line to the centre down — the shopper
        // asking whether the promo is still on is standing in the shop.
        .route("/api/v1/store/offers", get(store_offers))
        .route("/api/v1/store/final-prices", get(store_final_prices))
        // A voucher hold: the one thing at this counter that CANNOT be answered
        // out of the shop's own SQLite. A card is a bearer instrument and one
        // card can be presented in two shops at once, so the lock that stops
        // the same 200,000 being spent twice lives at the centre, where both
        // shops can see it. These three relay to head office and say so when
        // the line is down, rather than minting a hold the centre has never
        // seen — see `relay_voucher`.
        .route(
            "/api/v1/store/vouchers/{code}/authorize",
            post(relay_voucher_authorize),
        )
        .route(
            "/api/v1/store/vouchers/{code}/commit",
            post(relay_voucher_commit),
        )
        .route(
            "/api/v1/store/vouchers/{code}/release",
            post(relay_voucher_release),
        )
        // F2 on a voucher, F5 and Shift+F5 on a member: asked of head office
        // without touching money — see `relay_voucher_check` / `relay_member`.
        .route(
            "/api/v1/store/vouchers/{code}/check",
            post(relay_voucher_check),
        )
        .route("/api/v1/store/members/lookup", post(relay_member_lookup))
        .route("/api/v1/store/members", post(relay_member_enrol))
        // F5 "Daftar member" with a struk number (client, 24 Oct 2026): the
        // sale on it becomes the member's, with its points.
        .route("/api/v1/store/sales/member", post(store_attach_member))
        // A limited coupon's hold — HEMAT50, "kuota 100 transaksi" — for the
        // voucher's reason: the count that keeps the cap is one number shared by
        // every shop, so the use is reserved at the centre, where both shops can
        // see it. No commit here: the hold rides on the sale fact and the centre
        // commits it when the sale lands. See `relay_coupon`.
        .route(
            "/api/v1/store/coupons/{code}/authorize",
            post(relay_coupon_authorize),
        )
        .route(
            "/api/v1/store/coupons/{code}/release",
            post(relay_coupon_release),
        )
        // An employee's benefit balance (cloud 0818) lives at the centre too:
        // she can show her code at any shop, so the balance it spends is held
        // where every shop can see it. Online only — when the line is down
        // these say so and the cashier takes another tender.
        .route("/api/v1/store/benefit/lookup", post(relay_benefit_lookup))
        .route("/api/v1/store/benefit/spend", post(relay_benefit_spend))
        .route("/api/v1/store/benefit/return", post(relay_benefit_return))
        // What a till sold that this shop's stock could not give it (owner,
        // 23 Oct 2026): the Kepala toko's approval of an unknown item, and the
        // store app's read of where head office's matching stands.
        .route(
            "/api/v1/store/unmatched/approve",
            post(approve_unknown_item),
        )
        .route("/api/v1/store/unmatched", get(relay_unmatched_sales))
        // A member's points balance, like a voucher's, lives at the centre —
        // one shopper can be handed a code in store-01 and stand at store-07's
        // counter with it. These two relay to head office and say so when the
        // line is down, exactly as the voucher trio above does.
        .route(
            "/api/v1/store/points/redeem-requests/lookup",
            post(relay_redeem_request_lookup),
        )
        .route(
            "/api/v1/store/points/redeem-requests/{request_id}/confirm",
            post(relay_redeem_request_confirm),
        )
        // The manager's HR — and the shop's own General Affairs — which live at
        // head office and nowhere else. One route rather than one per screen:
        // it relays `/api/v1/{path}` for the signed-in head-office account,
        // held to one allowlist at both ends — see `relay_central`. Everything
        // else in this router still answers out of the shop's own SQLite.
        .route(
            "/api/v1/store/central/{*path}",
            get(relay_central)
                .post(relay_central)
                .put(relay_central)
                .patch(relay_central)
                .delete(relay_central),
        )
        // ── The till's day ──────────────────────────────────────────────
        //
        // A drawer that opens and closes, and a sale the shop can take back.
        // Grouped here rather than under a `/pos` prefix because everything a
        // shop does is already `/store`, and a second word for the same node
        // is a second thing to remember at four in the afternoon.
        .route(
            "/api/v1/store/shifts",
            post(store_open_shift).get(store_shifts_on),
        )
        // Held sales — Tunda (client, 23 Oct 2026): kept on this node so any
        // till of the store resumes them; they expire with the business day.
        .route("/api/v1/store/held", get(store_held_sales).post(store_hold_sale))
        .route(
            "/api/v1/store/held/{held_id}/resume",
            post(store_resume_held),
        )
        .route(
            "/api/v1/store/held/{held_id}",
            axum::routing::delete(store_drop_held),
        )
        // A supervisor's yes to a basket edit, spent on a row of its own —
        // the unsold basket has no sale to carry the signature.
        .route("/api/v1/store/approvals", post(store_record_approval))
        // Declared BEFORE `{shift_id}` and as its own path, not as a GET on the
        // collection. Axum prefers a literal segment, but a reader should not
        // have to know that: `/shifts/active` and `/shifts/{id}` sitting one
        // line apart is where a router silently starts treating the word
        // "active" as a shift id.
        .route("/api/v1/store/shifts/active", get(store_active_shift))
        // Seats and who holds them, one person's own drawers, every drawer
        // open now, and taking a seat over. Literal segments, declared before
        // `{shift_id}` for the reason above.
        .route("/api/v1/store/tills", get(store_till_seats))
        .route("/api/v1/store/shifts/mine", get(store_my_shifts))
        .route("/api/v1/store/shifts/open", get(store_open_shifts))
        .route("/api/v1/store/shifts/take-over", post(store_take_over_seat))
        .route("/api/v1/store/shifts/{shift_id}", get(store_shift_report))
        .route(
            "/api/v1/store/shifts/{shift_id}/sales",
            get(store_shift_sales),
        )
        .route(
            "/api/v1/store/shifts/{shift_id}/movements",
            post(store_cash_movement),
        )
        .route(
            "/api/v1/store/shifts/{shift_id}/close",
            post(store_close_shift),
        )
        .route(
            "/api/v1/store/shifts/{shift_id}/count",
            post(store_count_shift),
        )
        // ── The shop's small money ──────────────────────────────────────
        //
        // Petty cash, and nothing that can reach the drawer. Under `/store`
        // like everything else a shop does, and named after the two things
        // they are — what was spent, and what is in the tin.
        .route(
            "/api/v1/store/expenses",
            get(store_expenses).post(store_record_expense),
        )
        .route("/api/v1/store/petty-cash", get(store_petty_cash))
        .route(
            "/api/v1/store/petty-cash/top-ups",
            post(store_petty_cash_top_up),
        )
        .route("/api/v1/store/sales/{sale_id}/void", post(store_void_sale))
        .route("/api/v1/store/returns", post(store_return))
        .route("/api/v1/store/exchanges", post(store_exchange))
        .route(
            "/api/v1/store/sales/{sale_id}/receipt",
            get(store_receipt).post(store_print_receipt),
        )
        // The same receipt as bytes, for a USB printer on the till: the node
        // cannot reach that cable, so the till sends them itself.
        .route(
            "/api/v1/store/sales/{sale_id}/receipt/escpos",
            post(store_render_receipt),
        )
        .route(
            "/api/v1/store/reports/sales/series",
            get(store_sales_series),
        )
        .route(
            "/api/v1/store/reports/sales/window",
            get(store_sales_window),
        )
        .fallback_service(
            // A single-page app owns its own routes, so the node has to hand
            // `index.html` to any path it has no file for and let the router
            // decide. Without this, `/terima/hitung?po=…` is a 404 the moment
            // somebody reloads it or opens it from a message — the app works
            // perfectly until the first refresh, which is the worst way for it
            // to break because it looks like the node has died.
            ServeDir::new(&frontend_dir)
                .append_index_html_on_directories(true)
                .fallback(ServeFile::new(frontend_dir.join("index.html"))),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            require_auth,
        ))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        // Compressed on the way out, as the DC router already was — the store
        // router was the one that had none, which is backwards: the till is
        // the node on the worst line in the fleet and its catalogue is the
        // biggest answer it sends (5,000 SKUs, ~10:1 under gzip and smaller
        // again under Brotli). The default predicate leaves SSE and small
        // bodies alone.
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state))
}

fn common_router() -> Router<EdgeState> {
    Router::new()
        .route("/api/v1/health", get(health))
        // Identity, not pricing — see EdgeInventory::catalog_identities. Lives
        // in the common router because a DC needs to name what it is holding
        // even though it has no price book.
        .route("/api/v1/catalog/identities", get(catalog_identities))
        // Which catalogue this node holds, and the catalogue itself in pages.
        // A handheld keeps its own copy in local SQLite; the first of these is
        // how it learns the copy is stale, and the second is how it replaces
        // it. Common router for the same reason identities are: a DC holds the
        // snapshot too.
        .route("/api/v1/catalog/snapshot", get(catalog_snapshot))
        .route(
            "/api/v1/catalog/snapshot/items",
            get(catalog_snapshot_items),
        )
        // Product photographs, fetched BY the node rather than by the handheld.
        .route("/api/v1/catalog/image", get(catalog_image))
        .route("/api/v1/catalog/campaign-image", get(campaign_image))
        // A shared reading session, readable by every handheld in it.
        .route("/api/v1/rfid/sessions", get(rfid_sessions))
        .route("/api/v1/rfid/sessions/{session_id}", get(rfid_session))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/me", get(me))
        .route("/api/v1/auth/logout", post(logout))
        // "Buka atas nama": a Kepala toko signed in at a till opens it for a
        // cashier, whose session the till then holds (owner, 23 Oct 2026).
        .route(
            "/api/v1/auth/on-behalf",
            get(till_people).post(open_on_behalf),
        )
        .route("/api/v1/auth/change-password", post(change_password))
        // A finger opens a till and authorises a void. Three of these are
        // people-facing and signed in normally; two are spoken by a paired
        // terminal and signed with its own credential, because the matching
        // happens on the counter and a claim is only worth what stands behind
        // it. See `edge/fingerprint.rs`.
        .route("/api/v1/auth/terminals", post(pair_terminal))
        .route("/api/v1/auth/fingerprints", post(enrol_fingerprint))
        .route(
            "/api/v1/auth/fingerprints/{finger_id}/retire",
            post(retire_fingerprint),
        )
        .route("/api/v1/auth/fingerprints/roster", get(fingerprint_roster))
        .route("/api/v1/auth/fingerprints/claim", post(fingerprint_claim))
        // An employee's finger opens their benefit balance (client, 24 Oct
        // 2026): signed by the terminal like a claim, answered with a grant
        // the till puts on `/store/benefit/*` instead of a code.
        .route(
            "/api/v1/auth/fingerprints/benefit",
            post(fingerprint_benefit),
        )
        // A PIN is what a staging shop uses while there is no scanner to press.
        // Which of the two a node accepts is the node's decision, and it is
        // enforced here rather than trusted to the tills — see `edge/pin.rs`.
        .route(
            "/api/v1/auth/methods",
            get(auth_methods).post(set_auth_method),
        )
        .route("/api/v1/auth/pins", post(set_user_pin))
        .route("/api/v1/auth/pins/{username}/clear", post(clear_user_pin))
        .route("/api/v1/auth/pin/claim", post(pin_claim))
        // ── the machines enrolled to this node ──────────────────────────
        //
        // See `edge/devices.rs`. `identity`, `join` and `join/status` are
        // spoken by a till that has no credential yet and are open; the
        // peripherals report is signed by the till itself; everything else is
        // a person signed in here.
        .route("/api/v1/node/identity", get(node_identity))
        .route("/api/v1/devices", get(list_devices))
        .route("/api/v1/devices/join", post(join_node))
        .route("/api/v1/devices/join/status", post(join_status))
        .route("/api/v1/devices/joins", get(pending_joins))
        .route(
            "/api/v1/devices/joins/{join_id}/approve",
            post(approve_join),
        )
        .route("/api/v1/devices/joins/{join_id}/refuse", post(refuse_join))
        .route("/api/v1/devices/status", post(set_device_status))
        // What head office stopped that a till shows on its door — the store,
        // the till or its seat, and the drawer still open there (0990). Open:
        // a door shows it before anybody signs in.
        .route("/api/v1/till/standing", get(till_standing))
        .route("/api/v1/devices/printers", post(record_printer))
        .route(
            "/api/v1/devices/printers/{printer_id}",
            post(change_printer),
        )
        .route(
            "/api/v1/devices/self/peripherals",
            post(set_till_peripherals),
        )
        // What head office left for a till (a test page, today), and how the
        // page came out: both signed by the till itself.
        .route(SELF_REQUESTS_PATH, get(till_requests))
        .route(SELF_TEST_PRINT_RESULT_PATH, post(till_test_print_result))
        .route(RFID_OBSERVATION_PATH, post(rfid_observations))
        .route(RFID_PING_PATH, post(rfid_ping))
        .route("/api/v1/inventory/pools", get(pools))
        .route("/api/v1/inventory/sku-stock", get(sku_stock))
        // What the goods flows touching this site did, as head office relayed
        // it (`edge::flows`): which document a piece of work belongs to.
        .route("/api/v1/flow-notices", get(flow_notices))
        .route("/api/v1/inventory/movements", get(movements))
        .route("/api/v1/sync/status", get(sync_status))
        .route("/api/v1/sync/trigger", post(sync_trigger))
        // The virtual business clock's control surface, the same path the
        // cloud serves — one wire contract so a rig script speaks to both
        // ends identically (VIRTUAL-TIME-PLAN.md §8). Gated in the handler,
        // not here: a production node must ROUTE the request far enough to
        // answer 403 saying why it refused.
        .route(
            "/api/v1/inventory/control/clock",
            get(clock_status).post(clock_control),
        )
        // ── the unit's punch station ────────────────────────────────────
        //
        // Common to both node roles: a DC has staff and a door like every shop
        // does. `/punches` is the durable write — a row plus a sync fact in one
        // transaction, which is where the offline property comes from —
        // `/today` is the screen the reader draws after it recognises somebody,
        // and `/book` is the status line that says how fresh the centre's
        // published roster is.
        .route("/api/v1/attendance/punches", post(attendance_punch))
        .route("/api/v1/attendance/today", get(attendance_today))
        .route("/api/v1/attendance/book", get(attendance_book))
}

async fn health(State(state): State<EdgeState>) -> Json<Value> {
    let node = state.inventory.node();
    let local_operations = match node.role {
        EdgeRole::Dc => json!([
            "dc.intake",
            "dc.allotment.pick",
            "dc.fulfillment.pack",
            "dc.fulfillment.shipment",
            "dc.fulfillment.dispatch",
            "dc.fulfillment.in_transit",
            "dc.official_count.execute",
            "dc.move"
        ]),
        EdgeRole::Store => json!(["store.receive", "store.move", "store.sale"]),
    };
    // What this build understands, so an operator (and one day the centre)
    // can tell whether it is safe to send it a command type. `store.inbound`
    // = this shop applies `inventory.store_inbound.announce.v1`.
    // One list with the heartbeat (`edge::status::node_capabilities`), so the
    // two answers a node gives about itself cannot disagree.
    let capabilities = crate::edge::status::node_capabilities(node.role);
    let policy = state.auth.policy_version().ok().flatten();
    Json(json!({
        "status":"ok",
        "node_id":node.node_id,
        "node_role":node.role,
        "site_id":node.site_id,
        "database":"sqlite",
        "operation_mode":"independent",
        "ledger_authority":"local movement ledger",
        "auth":if state.auth.enabled() { "enabled" } else { "DISABLED" },
        "auth_policy":policy.map(|(version,valid_until)| json!({"version":version,"valid_until":valid_until})),
        // The UPS, when one is watched (`edge/power.rs`): the tills read this
        // to warn a cashier before the server goes down on a flat battery.
        "power":crate::edge::power::latest(),
        "capabilities":capabilities,
        "local_operations":local_operations,
        "inventory_endpoints":{
            "owned":"/api/v1/inventory/pools"
        }
    }))
}

async fn pools(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let node = state.inventory.node().clone();
    // What head office says this site is, so a row can carry the site's own
    // name and kind instead of the node's role. Read before the balances
    // because `list_pools` moves the connection onto a blocking thread.
    let own_site = state
        .auth
        .connection()
        .lock()
        .ok()
        .and_then(|connection| crate::edge::site_profile::own(&connection));
    let balances = run_blocking(move || state.inventory.list_pools()).await?;
    let items = present_pools(&node, own_site.as_ref(), balances)?;
    Ok(Json(json!({
        "as_of":chrono::Utc::now(),
        "read_only":false,
        "observed_window_hours":Value::Null,
        "lost_risk_window_days":Value::Null,
        "inventory_equation":crate::cloud::domain::INVENTORY_EQUATION,
        "aggregation_policy":"This Edge displays only its locally owned pools",
        "items":items
    })))
}

/// Spendable units per SKU, floor and warehouse apart, for an article page's
/// colour × size grid. The pool list answers per room; this answers per SKU.
async fn sku_stock(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<crate::edge::SkuStock>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let items = run_blocking(move || state.inventory.sku_stock()).await?;
    Ok(Json(crate::edge::SkuStock {
        as_of: chrono::Utc::now(),
        items,
    }))
}

/// How a pool is shown. `at_a_shop` says which room a stockroom is: the
/// Gudang's racks group as WAREHOUSE, a shop's back room as STORE_INVENTORY.
/// One role, one spelling, two rooms — told apart by the node's own role,
/// never by the pool id.
fn edge_pool_metadata(
    pool: &OperationalPool,
    at_a_shop: bool,
) -> (
    &'static str,
    &'static str,
    &'static str,
    i32,
    Option<&'static str>,
) {
    use crate::pool_role::OutboundStage;
    use OperationalPool::*;
    match pool {
        DcPendingUnidentified { .. } => ("PENDING", "UNIDENTIFIED", "Unidentified", 10, None),
        DcPendingUntagged { .. } => ("PENDING", "UNTAGGED", "Untagged", 20, None),
        Stockroom { .. } if at_a_shop => ("STORE_INVENTORY", "WAREHOUSE", "Warehouse", 10, None),
        Stockroom { .. } => ("WAREHOUSE", "WAREHOUSE", "Warehouse", 30, None),
        // Off the racks, not yet in a box, and not yet anyone's. It sorts
        // before the destination-scoped leaves because that is the order the
        // goods actually pass through.
        DcOutboundPicking { .. } => ("OUTBOUND", "PICKING", "Pick Area", 40, None),
        DcOutboundPicked { .. } => ("OUTBOUND", "PICKED", "Picked", 41, Some("PICKED")),
        DcOutboundPacked { .. } => ("OUTBOUND", "PACKED", "Packed", 51, Some("PACKED")),
        DcOutboundShipment { .. } => ("OUTBOUND", "SHIPMENT", "Shipment", 61, Some("SHIPMENT")),
        DcOutboundLoaded { .. } => ("OUTBOUND", "LOADED", "Loaded", 71, Some("LOADED")),
        DcOutboundInTransit { .. } => (
            "OUTBOUND",
            "IN_TRANSIT",
            "In Transit",
            81,
            Some("IN_TRANSIT"),
        ),
        // The stage at its origin is the stage itself: it is what the rollup
        // row below stands for, so its own balance is folded into that row.
        Outbound {
            stage: OutboundStage::Packed,
            ..
        } => ("OUTBOUND", "PACKED", "Packed", 50, Some("PACKED")),
        Outbound {
            stage: OutboundStage::Shipment,
            ..
        } => ("OUTBOUND", "SHIPMENT", "Shipment", 60, Some("SHIPMENT")),
        Outbound {
            stage: OutboundStage::Loaded,
            ..
        } => ("OUTBOUND", "LOADED", "Loaded", 70, Some("LOADED")),
        Outbound {
            stage: OutboundStage::InTransit,
            ..
        } => (
            "OUTBOUND",
            "IN_TRANSIT",
            "In Transit",
            80,
            Some("IN_TRANSIT"),
        ),
        DcRejectDc { .. } => ("REJECT", "DC_REJECT", "DC Reject", 90, None),
        DcRejectStore { .. } | Return { .. } => {
            ("REJECT", "STORE_REJECT", "Store Return", 100, None)
        }
        StoreFloor { .. } => ("STORE_INVENTORY", "FLOOR", "Floor", 20, None),
        Reject { .. } if at_a_shop => ("REJECT", "REJECT", "Reject", 30, None),
        Reject { .. } => ("REJECT", "DC_REJECT", "Reject", 90, None),
        // A shop's To be returned, beside its reject (owner, 23 Oct 2026).
        ToReturn {
            pocket: crate::edge::ToReturnPocket::OverDelivery,
            ..
        } => ("REJECT", "OVER_DELIVERY", "Over delivery", 31, None),
        ToReturn {
            pocket: crate::edge::ToReturnPocket::ReturnHo,
            ..
        } => ("REJECT", "RETURN_HO", "Return HO", 32, None),
    }
}

/// How a node's own site is named on a pool row.
///
/// `site_kind` and `site_name` are the SITE's — `HO`/`STORE` and the name head
/// office gave it (`Gudang`, `Bumiarya`) — because that is what a reader
/// compares against and what a screen prints. They used to carry the node's
/// ROLE and an interpolation of it (`"DC dc-01"`), so the same field meant two
/// different things depending on which node answered: a hub screen asking
/// `site_kind === "HO"` saw `"DC"`. When head office has not said (a node that
/// has never heard its directory), the role is the honest fallback.
fn present_pools(
    node: &NodeContext,
    own_site: Option<&crate::edge::site_profile::KnownSite>,
    balances: Vec<PoolBalance>,
) -> Result<Vec<Value>, ApiError> {
    let site_name = own_site
        .map(|site| site.name.clone())
        .unwrap_or_else(|| node.site_id.to_string());
    let site_kind = own_site
        .and_then(|site| site.kind)
        .map(|kind| kind.code().to_string())
        .unwrap_or_else(|| node.role.to_string());
    let mut items = Vec::with_capacity(balances.len() + 5);
    let mut rollups: BTreeMap<&'static str, (i64, i64, i64)> = [
        ("PICKED", (0, 0, 0)),
        ("PACKED", (0, 0, 0)),
        ("SHIPMENT", (0, 0, 0)),
        ("LOADED", (0, 0, 0)),
        ("IN_TRANSIT", (0, 0, 0)),
    ]
    .into_iter()
    .collect();

    for balance in balances {
        let pool = OperationalPool::from_str(&balance.pool_id).map_err(|error| {
            ApiError(EdgeError::Persistence(format!(
                "invalid owned pool {}: {error}",
                balance.pool_id
            )))
        })?;
        if !node.owns_pool(&pool) {
            return Err(ApiError(EdgeError::Forbidden(format!(
                "pool {} is not owned by {}",
                balance.pool_id, node.site_id
            ))));
        }
        let (group, pool_code, base_label, display_order, outbound_stage) =
            edge_pool_metadata(&pool, node.role == EdgeRole::Store);
        let destination_store_id = pool.outbound_destination().map(ToString::to_string);
        if let Some(stage) = outbound_stage {
            if let Some(total) = rollups.get_mut(stage) {
                total.0 += balance.stock;
                total.1 += balance.on_hand;
                total.2 += balance.missing;
            }
        }
        let store_origin_site_id = pool.return_origin().map(ToString::to_string);
        let label = destination_store_id
            .as_ref()
            .map(|destination| format!("{base_label} · {destination}"))
            .unwrap_or_else(|| base_label.to_string());
        items.push(json!({
            "id":balance.pool_id,
            "site_id":node.site_id,
            "site_name":site_name,
            "site_kind":site_kind,
            "group":group,
            "pool_code":pool_code,
            "label":label,
            "store_origin_site_id":store_origin_site_id,
            "display_order":display_order,
            "is_rollup":false,
            "is_outbound_leaf":outbound_stage.is_some(),
            "outbound_stage":outbound_stage,
            "destination_store_id":destination_store_id,
            "stock":balance.stock,
            "allotted":balance.allotted,
            "on_hand":balance.on_hand,
            "shortfall":balance.shortfall,
            "missing":balance.missing,
            "observed":Value::Null,
            "lost_rate":Value::Null,
            "lost_quantity":Value::Null,
            "exposure":Value::Null,
            "origin_id":node.node_id,
            "origin_role":node.role,
            "owner_label":site_name,
            "source_type":"EDGE_LOCAL",
            "sync_captured_at":Value::Null,
            "sync_applied_at":Value::Null,
            "sync_age_seconds":Value::Null,
            "source_capture_age_seconds":Value::Null,
            "sync_status":"LOCAL"
        }));
    }

    // A derived row per stage, for a node whose stage stands only in legacy
    // per-destination leaves. Since 0610 the stage at the origin is a pool of
    // its own with this very id, listed above as a leaf and counted; a second
    // row with its id would be one too many. A shop shows a derived row only
    // while something stands in it.
    {
        for (stage, label, slug, display_order) in [
            ("PICKED", "Picked", "picked", 40),
            ("PACKED", "Packed", "packed", 50),
            ("SHIPMENT", "Shipment", "shipment", 60),
            ("LOADED", "Loaded", "loaded", 70),
            ("IN_TRANSIT", "In Transit", "in-transit", 80),
        ] {
            let (stock, on_hand, missing) = rollups.get(stage).copied().unwrap_or_default();
            if node.role == EdgeRole::Store && stock == 0 {
                continue;
            }
            let stage_id = format!("{}.outbound.{slug}", node.site_id);
            if items
                .iter()
                .any(|item| item.get("id").and_then(Value::as_str) == Some(stage_id.as_str()))
            {
                continue;
            }
            items.push(json!({
                "id":format!("{}.outbound.{slug}", node.site_id),
                "site_id":node.site_id,
                "site_name":site_name,
                "site_kind":site_kind,
                "group":"OUTBOUND",
                "pool_code":stage,
                "label":label,
                "store_origin_site_id":Value::Null,
                "display_order":display_order,
                "is_rollup":true,
                "is_outbound_leaf":false,
                "outbound_stage":stage,
                "destination_store_id":Value::Null,
                "stock":stock,
                "allotted":Value::Null,
                "on_hand":on_hand,
                "missing":missing,
                "observed":Value::Null,
                "lost_rate":Value::Null,
                "lost_quantity":Value::Null,
                "exposure":Value::Null,
                "origin_id":node.node_id,
                "origin_role":node.role,
                "owner_label":site_name,
                "source_type":"EDGE_LOCAL",
                "sync_captured_at":Value::Null,
                "sync_applied_at":Value::Null,
                "sync_age_seconds":Value::Null,
                "sync_status":"LOCAL"
            }));
        }
    }
    items.sort_by(|left, right| {
        let left_key = (
            left.get("display_order")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            !left
                .get("is_rollup")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            left.get("id").and_then(Value::as_str).unwrap_or(""),
        );
        let right_key = (
            right
                .get("display_order")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            !right
                .get("is_rollup")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            right.get("id").and_then(Value::as_str).unwrap_or(""),
        );
        left_key.cmp(&right_key)
    });
    Ok(items)
}

async fn movements(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(query): Query<MovementQuery>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let items = run_blocking(move || {
        state
            .inventory
            .list_movements(query.limit.unwrap_or(100).clamp(1, 500))
    })
    .await?;
    Ok(Json(json!({"items":items})))
}

async fn dc_intake(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<IntakeRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.intake_dc(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

async fn dc_pick(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<PickRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, outbound_permission(&state))? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.pick_stock(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// Outbound rows record who did the work, and an empty name is never a valid
/// answer to that. Authentication fills it in when it is on; a node running
/// with auth disabled — a bench, a demo, a recovery — still writes rows, and
/// they say plainly that no person was attached rather than failing on a field
/// the caller was never asked for.
fn name_the_actor(actor_id: &mut String) {
    if actor_id.trim().is_empty() {
        *actor_id = "api".to_string();
    }
}

/// Where to look for a printer. The same two fields the bench already holds,
/// so a test and a run can never be asking about different machines.
#[derive(Deserialize)]
struct TestPrinterRequest {
    printer_host: String,
    #[serde(default = "default_printer_port")]
    printer_port: u16,
}

fn default_printer_port() -> u16 {
    9100
}

#[derive(Deserialize)]
struct CaptureBoxRequest {
    reader_session_id: String,
}

/// Every shop this DC still owes something to. The packer's queue.
async fn dc_destinations(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.destinations_owed()).await?;
    Ok(Json(serde_json::json!({ "items": result })))
}

/// What is still picked and unpacked for a store — the list a packer is offered
/// when opening a box.
async fn dc_outstanding(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(store_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result =
        run_blocking(move || state.inventory.outstanding_for_destination(&store_id)).await?;
    Ok(Json(serde_json::json!({ "lines": result })))
}

/// Open one box with a target. The target is fixed here: a target edited to
/// match the sweep is not a target.
async fn dc_open_packing_box(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::outbound::OpenPackingBoxRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
        request.actor_id = principal.username;
    }
    name_the_actor(&mut request.actor_id);
    let result = run_blocking(move || state.inventory.open_packing_box(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// The boxes still waiting for their sweep, so a packer who walked away from
/// one finds it again.
async fn dc_open_packing_boxes(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.open_packing_boxes()).await?;
    Ok(Json(serde_json::json!({ "items": result })))
}

/// The garments a correct sweep of this box would find. See
/// `outbound::box_candidates`: it feeds the handheld simulator.
async fn dc_box_candidates(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.box_candidates(&session_id)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

async fn dc_packing_box(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.packing_box(&session_id)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// The sweep. A mismatch comes back 200 with the detail, because a box that
/// does not add up is an ordinary answer the packer acts on, not a failure of
/// the request.
async fn dc_capture_packing_box(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(session_id): Path<String>,
    Json(request): Json<CaptureBoxRequest>,
) -> Result<Json<Value>, ApiError> {
    let mut actor = require_permission(&state, principal, EdgePermission::DcOperate)?
        .map(|principal| principal.username)
        .unwrap_or_default();
    name_the_actor(&mut actor);
    let result = run_blocking(move || {
        state
            .inventory
            .capture_packing_box(&session_id, &request.reader_session_id, &actor)
    })
    .await?;
    Ok(Json(serde_json::to_value(result)?))
}

#[derive(Deserialize)]
struct AssignKoliRequest {
    session_id: String,
}

async fn dc_open_pick_session(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::outbound::OpenSessionRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
        request.actor_id = principal.username;
    }
    name_the_actor(&mut request.actor_id);
    let result = run_blocking(move || {
        state
            .inventory
            .open_outbound_session(crate::edge::outbound::SessionKind::Pick, request)
    })
    .await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// "This trip round the racks, what came back?" — many SKUs, one round.
async fn dc_pick_session(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.pick_session_summary(&session_id)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

async fn dc_list_pick_sessions(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(filter): Query<crate::edge::outbound::ListFilter>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || {
        state
            .inventory
            .list_outbound_sessions(crate::edge::outbound::SessionKind::Pick, filter)
    })
    .await?;
    Ok(Json(serde_json::json!({ "items": result })))
}

async fn dc_close_pick_session(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let result = run_blocking(move || {
        state
            .inventory
            .close_outbound_session(crate::edge::outbound::SessionKind::Pick, &session_id)
    })
    .await?;
    Ok(Json(serde_json::to_value(result)?))
}

async fn dc_open_packing_session(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::outbound::OpenSessionRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
        request.actor_id = principal.username;
    }
    name_the_actor(&mut request.actor_id);
    let result = run_blocking(move || {
        state
            .inventory
            .open_outbound_session(crate::edge::outbound::SessionKind::Packing, request)
    })
    .await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

async fn dc_close_packing_session(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let result = run_blocking(move || {
        state
            .inventory
            .close_outbound_session(crate::edge::outbound::SessionKind::Packing, &session_id)
    })
    .await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// "These 200 pieces became how many boxes, and what is in each?"
async fn dc_packing_session(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.packing_session_summary(&session_id)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// The packing list: what is in this box, and the QR that opens it again on
/// arrival.
async fn dc_koli_manifest(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(koli_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.koli_manifest(&koli_id)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

async fn dc_assign_koli(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(koli_id): Path<String>,
    Json(request): Json<AssignKoliRequest>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let result = run_blocking(move || {
        state
            .inventory
            .assign_koli_to_session(&koli_id, &request.session_id)
    })
    .await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// Close the box. Its contents become final here, which is what makes the
/// packing list worth printing.
async fn dc_seal_koli(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(koli_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let sealed_by = require_permission(&state, principal, outbound_permission(&state))?
        .map(|principal| principal.username)
        .unwrap_or_else(|| "api".to_string());
    let result = run_blocking(move || state.inventory.seal_koli(&koli_id, &sealed_by)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// Put the box's sticker on the label printer.
async fn dc_print_koli_label(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(koli_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let connection = state.auth.connection();
    let result = run_blocking(move || {
        let request: crate::edge::outbound::PrintKoliLabelRequest =
            print_request(with_recorded_printer(&connection, body)?)?;
        state.inventory.print_koli_label(&koli_id, request)
    })
    .await?;
    Ok(Json(serde_json::to_value(result)?))
}

async fn dc_list_koli(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(filter): Query<crate::edge::outbound::ListFilter>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.list_koli(filter)).await?;
    Ok(Json(serde_json::json!({ "items": result })))
}

async fn dc_list_shipments(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(filter): Query<crate::edge::outbound::ListFilter>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.list_shipments(filter)).await?;
    Ok(Json(serde_json::json!({ "items": result })))
}

async fn dc_list_dispatches(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(filter): Query<crate::edge::outbound::ListFilter>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.list_dispatches(filter)).await?;
    Ok(Json(serde_json::json!({ "items": result })))
}

async fn dc_list_packing_sessions(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(filter): Query<crate::edge::outbound::ListFilter>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || {
        state
            .inventory
            .list_outbound_sessions(crate::edge::outbound::SessionKind::Packing, filter)
    })
    .await?;
    Ok(Json(serde_json::json!({ "items": result })))
}

/// Every picklist this DC has raised. The rounds themselves, not what is owed.
async fn dc_picklists(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.list_picklists()).await?;
    Ok(Json(serde_json::json!({ "items": result })))
}

/// Raise a picklist: a round opened, walked and closed in one act.
async fn dc_create_picklist(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::contracts::CreatePicklistRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
        request.actor_id = principal.username;
    }
    name_the_actor(&mut request.actor_id);
    let result = run_blocking(move || state.inventory.create_picklist(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// Pack a carton by saying how much, and let the server name the pieces.
async fn dc_pack_by_quantity(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::contracts::PackRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, outbound_permission(&state))? {
        request.actor_id = principal.username;
    }
    name_the_actor(&mut request.actor_id);
    let result = run_blocking(move || state.inventory.pack_by_quantity(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// What is still owed, added up by SKU. The picker's sheet.
async fn dc_picklist(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.picklist()).await?;
    Ok(Json(serde_json::json!({ "lines": result })))
}

/// Every picklist still to pick: one per allotment × shop, there as soon as
/// the allotment is (owner, 29 Sep 2026).
async fn dc_picklists_to_pick(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.picklists_to_pick()).await?;
    Ok(Json(serde_json::json!({ "items": result })))
}

/// The Gudang takes its own work back: out of an unsent carton, out of the
/// pick area. See `EdgeInventory::move_back`.
async fn dc_move_back(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::outbound::MoveBackRequest>,
) -> Result<Json<Value>, ApiError> {
    if let Some(principal) = require_permission(&state, principal, outbound_permission(&state))? {
        request.actor_id = principal.username;
    }
    name_the_actor(&mut request.actor_id);
    let result = run_blocking(move || state.inventory.move_back(request)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// What MD took out that the Gudang still has to move back. MD's edit and
/// cancel of an allotment run at head office and do not reach this node as
/// owed work yet, so there is nothing to list: the board draws no strip.
async fn dc_owed(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    Ok(Json(serde_json::json!({ "items": [] })))
}

/// MD's changes the Gudang has not acknowledged: none reach this node yet
/// (see `dc_owed`).
async fn dc_changes(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    Ok(Json(serde_json::json!({ "items": [] })))
}

async fn dc_acknowledge_change(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(_request): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    Ok(Json(serde_json::json!({ "acknowledged": 0 })))
}

async fn dc_short_picks(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.short_picks()).await?;
    Ok(Json(serde_json::json!({ "items": result })))
}

async fn dc_report_short_pick(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::outbound::ReportShortPickRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, outbound_permission(&state))? {
        request.actor_id = principal.username;
    }
    name_the_actor(&mut request.actor_id);
    let result = run_blocking(move || state.inventory.report_short_pick(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// Dispatch: sealed cartons onto one trip. Makes the surat jalan per shop and
/// sends the goods in transit, in one act.
/// What Merchandise asked this shop to send back.
async fn store_return_asks(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.store_return_asks()).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// The shop taps Sent: the whole request is picked off its return pool,
/// packed into one sealed carton and put on a trip. Each step carries a key
/// derived from the request's, so a retried tap finishes rather than repeats.
async fn store_return_send(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(allotment_id): Path<String>,
    Json(request): Json<crate::edge::store_returns::SendReturnRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let mut actor_id = require_permission(&state, principal, outbound_permission(&state))?
        .map(|principal| principal.username)
        .unwrap_or_default();
    name_the_actor(&mut actor_id);
    let result = run_blocking(move || {
        let key = request.idempotency_key.trim().to_owned();
        if key.is_empty() {
            return Err(EdgeError::Validation("idempotency_key is required".into()));
        }
        let ask = state
            .inventory
            .store_return_asks()?
            .items
            .into_iter()
            .find(|ask| ask.allotment_id == allotment_id)
            .ok_or_else(|| {
                EdgeError::Conflict(format!("nothing is left to send on return {allotment_id}"))
            })?;
        for line in &ask.lines {
            state.inventory.pick_stock(PickRequest {
                source_pool_id: line.source_pool_id.clone(),
                sku_code: line.sku_code.clone(),
                quantity: line.quantity,
                actor_id: actor_id.clone(),
                idempotency_key: format!("{key}:pick:{}", line.sku_code),
                pick_session_id: None,
                destination_id: Some(ask.destination_id.clone()),
                allotment_id: Some(ask.allotment_id.clone()),
            })?;
        }
        let koli = state
            .inventory
            .pack_by_quantity(crate::edge::contracts::PackRequest {
                destination_store_id: ask.destination_id.clone(),
                lines: ask
                    .lines
                    .iter()
                    .map(|line| crate::edge::contracts::PackLine {
                        sku_code: line.sku_code.clone(),
                        quantity: line.quantity,
                    })
                    .collect(),
                actor_id: actor_id.clone(),
                idempotency_key: format!("{key}:pack"),
                seal: true,
                pick_session_ids: Vec::new(),
            })?;
        let trip = state
            .inventory
            .dispatch_trip(crate::edge::contracts::DispatchTripRequest {
                koli_ids: vec![koli.koli.koli_id.clone()],
                trip_note: Some(match request.trip_note.as_deref().map(str::trim) {
                    Some(note) if !note.is_empty() => {
                        format!("Return {} · {note}", ask.allotment_number)
                    }
                    _ => format!("Return {}", ask.allotment_number),
                }),
                actor_id,
                idempotency_key: format!("{key}:trip"),
            })?;
        Ok(crate::edge::store_returns::SendReturnResult {
            shipment_number: trip
                .shipments
                .first()
                .map(|shipment| shipment.shipment_number.clone())
                .unwrap_or_default(),
            quantity: ask.quantity,
        })
    })
    .await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

async fn dc_dispatch_trip(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::contracts::DispatchTripRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, outbound_permission(&state))? {
        request.actor_id = principal.username;
    }
    name_the_actor(&mut request.actor_id);
    let result = run_blocking(move || state.inventory.dispatch_trip(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// The surat jalan: one consignment, its boxes, and their contents.
async fn dc_shipment_detail(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(shipment_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.shipment_detail(&shipment_id)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// The loading manifest: one truck run and everything on it.
async fn dc_dispatch_detail(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(dispatch_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.dispatch_detail(&dispatch_id)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

async fn dc_create_shipment(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::outbound::CreateShipmentRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, outbound_permission(&state))? {
        request.actor_id = principal.username;
    }
    name_the_actor(&mut request.actor_id);
    let result = run_blocking(move || state.inventory.create_shipment(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

async fn dc_create_dispatch(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::outbound::CreateDispatchRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, outbound_permission(&state))? {
        request.actor_id = principal.username;
    }
    name_the_actor(&mut request.actor_id);
    let result = run_blocking(move || state.inventory.create_dispatch(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// The truck leaves — the one stage change that moves goods in the world.
async fn dc_depart_dispatch(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(dispatch_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, outbound_permission(&state))?;
    let result = run_blocking(move || state.inventory.depart_dispatch(&dispatch_id)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// "Has the stock for this allotment line reached the store, or is it still on
/// the road?" — counted from containment, not from a tally kept beside it.
async fn dc_allotment_line_position(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(allotment_line_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result =
        run_blocking(move || state.inventory.allotment_line_position(&allotment_line_id)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// Ask whether the machine the bench is pointed at is actually there.
///
/// A GET would be the obvious shape, but the address is the request body
/// rather than the URL deliberately: a printer's host and port would otherwise
/// sit in a query string, in the node's access log, in a browser's history and
/// in whatever proxies the hub is behind. POST also keeps this from being a
/// link anything can prefetch, and this handler opens a socket.
///
/// Prints nothing. See `printing::probe_printer`.
async fn dc_test_printer(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let connection = state.auth.connection();
    let result = run_blocking(move || {
        let request: TestPrinterRequest = print_request(with_recorded_printer(&connection, body)?)?;
        crate::edge::printing::probe_printer(&request.printer_host, request.printer_port)
    })
    .await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// Queue the labels for a tagging job that has landed at this DC.
async fn dc_open_print_session(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::DcOperate)?;
    let connection = state.auth.connection();
    let result = run_blocking(move || {
        let mut request: crate::edge::printing::OpenPrintSessionRequest =
            print_request(with_recorded_printer(&connection, body)?)?;
        if let Some(principal) = principal {
            request.actor_id = principal.username;
        }
        state.inventory.open_print_session(request)
    })
    .await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// Print the next chunk. Called again until nothing is pending; a chunk that
/// the printer refused comes back around on a later call.
async fn dc_run_print_chunk(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(session_id): Path<String>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let result = run_blocking(move || state.inventory.run_print_chunk(&session_id)).await?;
    Ok((StatusCode::OK, Json(serde_json::to_value(result)?)))
}

async fn dc_print_session(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.print_session(&session_id)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// The run this job already has, or `null` if nobody has queued it yet.
///
/// The screen asks this rather than remembering a session id of its own: a
/// handheld that slept, a tab that reloaded and a colleague at another bench
/// must all arrive at the same run, because the job is only ever given one.
async fn dc_job_print_session(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(job_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.job_print_session(&job_id)).await?;
    Ok(Json(json!({ "session": result })))
}

/// Draw one of a job's labels without printing it.
///
/// A POST because it carries a body — the stock in the machine and which line
/// of the job to draw — and not because it changes anything. Nothing is
/// claimed, no socket is opened, and it reads with `InventoryRead`: looking at
/// a label is not operating a printer.
async fn dc_preview_job_label(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(job_id): Path<String>,
    Json(request): Json<crate::edge::printing::LabelPreviewRequest>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.preview_job_label(&job_id, &request)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// Move a run to the printer in front of whoever picked it up.
async fn dc_repoint_print_session(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(session_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let connection = state.auth.connection();
    let result = run_blocking(move || {
        let request: crate::edge::printing::RepointPrinterRequest =
            print_request(with_recorded_printer(&connection, body)?)?;
        state.inventory.repoint_print_session(&session_id, request)
    })
    .await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// Put labels that already printed back in the queue.
///
/// The same EPCs, never fresh ones: the units are already in the ledger and
/// already on the floor, and a second EPC for one garment reads downstream as
/// a second garment.
async fn dc_reprint_labels(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(session_id): Path<String>,
    Json(request): Json<crate::edge::printing::ReprintRequest>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let result = run_blocking(move || state.inventory.reprint_labels(&session_id, request)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

async fn dc_pack_koli(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<PackKoliRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, outbound_permission(&state))? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.pack_koli(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

async fn dc_create_fulfillment_shipment(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(koli_id): Path<Uuid>,
    Json(mut request): Json<CreateKoliShipmentRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, outbound_permission(&state))? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || {
        state
            .inventory
            .create_fulfillment_shipment(koli_id, request)
    })
    .await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

async fn dc_dispatch_koli(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(koli_id): Path<Uuid>,
    Json(mut request): Json<AdvanceKoliRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, outbound_permission(&state))? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.dispatch_koli(koli_id, request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

async fn dc_mark_fulfillment_in_transit(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(koli_id): Path<Uuid>,
    Json(mut request): Json<AdvanceKoliRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, outbound_permission(&state))? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || {
        state
            .inventory
            .mark_fulfillment_in_transit(koli_id, request)
    })
    .await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

async fn store_receive(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<ReceiveRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreReceive)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.receive_store(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// Receive a whole sweep at once — see `ReceiveBatchRequest`.
async fn store_receive_batch(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<ReceiveBatchRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreReceive)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.receive_store_batch(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

#[derive(serde::Deserialize)]
struct StoreInboundQuery {
    #[serde(default)]
    status: Option<String>,
}

/// What is on its way to this shop. Blind: an in-transit delivery shows its
/// koli count and nothing of what is inside them.
async fn store_on_hold(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.store_on_hold()).await?;
    Ok(Json(serde_json::to_value(result)?))
}

async fn store_inbound_list(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(query): Query<StoreInboundQuery>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result =
        run_blocking(move || state.inventory.store_inbound_list(query.status.as_deref())).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// What a shop is told about a count: what was asked and what it has counted
/// so far, never what the book expects, the matches or the gap. The comparison
/// is head office's to make once the count is in.
fn blind_count(summary: &EdgeOfficialCountSummary) -> Value {
    json!({
        "count_id": summary.count_id,
        "site_id": summary.site_id,
        "pool_id": summary.pool_id,
        "kind": summary.kind,
        "status": summary.status,
        "reason": summary.reason,
        "created_at": summary.created_at,
        "activated_at": summary.activated_at,
        "submitted_at": summary.submitted_at,
        "closed_at": summary.closed_at,
        "scope": summary.scope,
        "counted": summary.found,
        "adjustment_status": summary.adjustment_status,
    })
}

/// The counts asked of this shop, newest first.
async fn store_counts(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let items = run_blocking(move || state.inventory.list_official_counts()).await?;
    let items: Vec<Value> = items.iter().map(blind_count).collect();
    Ok(Json(json!({ "items": items })))
}

/// One count, with only the pieces this shop has scanned into it.
async fn store_count(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(count_id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let detail = run_blocking(move || state.inventory.official_count(count_id)).await?;
    Ok(Json(blind_count_detail(&detail)))
}

fn blind_count_detail(detail: &EdgeOfficialCountDetail) -> Value {
    let mut out = blind_count(&detail.summary);
    let scanned: Vec<Value> = detail
        .lines
        .iter()
        .filter(|line| line.found_quantity > 0)
        .map(|line| {
            json!({
                "epc": line.epc,
                "sku_code": line.sku_code,
                "found_quantity": line.found_quantity,
            })
        })
        .collect();
    out["scanned"] = Value::Array(scanned);
    out
}

/// Scan pieces into a count. A supervisor's, like the shop's other stock work.
async fn store_count_entries(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(count_id): Path<Uuid>,
    Json(mut request): Json<OfficialCountEntriesRequest>,
) -> Result<Json<Value>, ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::InventoryMove)? {
        request.actor_id = principal.username;
    }
    let detail = run_blocking(move || {
        state
            .inventory
            .record_official_count_entries(count_id, request)
    })
    .await?;
    Ok(Json(blind_count_detail(&detail)))
}

/// Hand the count in. The answer is only that it was received.
async fn store_count_submit(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(count_id): Path<Uuid>,
    Json(mut request): Json<OfficialCountSubmitRequest>,
) -> Result<Json<Value>, ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::InventoryMove)? {
        request.actor_id = principal.username;
    }
    let result =
        run_blocking(move || state.inventory.submit_official_count(count_id, request)).await?;
    Ok(Json(json!({
        "count_id": result.count_id,
        "status": result.status,
        "submitted_at": result.submitted_at,
    })))
}

/// The delivery a scanned koli label or surat jalan number opens.
async fn store_inbound_scan(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(query): Query<StoreInboundScanQuery>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.store_inbound_scan(&query.code)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

#[derive(Deserialize)]
struct StoreInboundScanQuery {
    code: String,
}

/// One delivery: what was packed per SKU and per koli, and once received what
/// was counted against it.
async fn store_inbound_detail(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(delivery_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.store_inbound_detail(&delivery_id)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// Receive an announced delivery from what the handheld swept.
async fn store_inbound_receive(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(delivery_id): Path<String>,
    Json(mut request): Json<crate::edge::inbound::StoreInboundReceiveRequest>,
) -> Result<Json<Value>, ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreReceive)? {
        request.actor_id = principal.username;
    }
    let result =
        run_blocking(move || state.inventory.receive_store_inbound(&delivery_id, request)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// Receive without a reader: a blind count per SKU.
async fn store_inbound_receive_count(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(delivery_id): Path<String>,
    Json(mut request): Json<crate::edge::inbound::StoreInboundCountRequest>,
) -> Result<Json<Value>, ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreReceive)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || {
        state
            .inventory
            .receive_store_inbound_by_count(&delivery_id, request)
    })
    .await?;
    Ok(Json(serde_json::to_value(result)?))
}

async fn move_stock(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<MoveRequest>,
) -> Result<Json<Value>, ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::InventoryMove)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.move_stock(request)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

async fn move_stock_by_sku(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<MoveBySkuRequest>,
) -> Result<Json<Value>, ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::InventoryMove)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.move_stock_by_sku(request)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

#[derive(serde::Deserialize)]
struct FlowNoticeQuery {
    /// Only the documents still running. The default: a screen asks what is
    /// still to do.
    #[serde(default)]
    open: Option<bool>,
}

/// The goods flows touching this site, as head office last described them.
async fn flow_notices(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(query): Query<FlowNoticeQuery>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let open = query.open.unwrap_or(true);
    let result = run_blocking(move || state.inventory.flow_notices(open)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// A store's returns received here with units still waiting to be inspected.
async fn dc_return_inspections(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.return_inspections()).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// One received return and the units still waiting in its return pool.
async fn dc_return_inspection(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(delivery_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let result = run_blocking(move || state.inventory.return_inspection(&delivery_id)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// Inspect a received return. A supervisor's, because it decides what is fit
/// to sell and moves stock out of a store's return pool.
async fn dc_inspect_return(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(delivery_id): Path<String>,
    Json(mut request): Json<crate::edge::flows::InspectReturnRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::InventoryMove)? {
        request.actor_id = principal.username;
    }
    name_the_actor(&mut request.actor_id);
    let result =
        run_blocking(move || state.inventory.inspect_return(&delivery_id, request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// What this basket would come to, and why.
///
/// The engine has always produced the sentence a cashier needs — "that coupon
/// expired on Friday", "this promotion needs a coupon code" — and until now it
/// was reachable only in the response to a completed sale, which is to say
/// after the money had been taken. That is why every coupon-gated and
/// members-only promotion in this system was unreachable in practice: there was
/// nowhere to try a code, so nobody typed one.
///
/// `InventoryRead` rather than `StoreSale`: asking what something costs is not
/// selling it, and a shop assistant on the floor should be able to answer a
/// customer without holding the till's permission.
async fn store_quote(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::contracts::QuoteRequest>,
) -> Result<Json<Value>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::InventoryRead)?;
    request.actor_id = principal.map(|principal| principal.username).unwrap_or_default();
    let quote = run_blocking(move || state.inventory.quote_basket(request)).await?;
    Ok(Json(quote))
}

/// Declare a checkout before asking anybody for money.
///
/// `StoreSale` and not a new permission: whoever may take money may say they
/// are about to. A separate permission would let a shop be configured so that
/// selling is allowed and recording the attempt is not, which is the worst of
/// the two states.
async fn begin_checkout(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::contracts::BeginCheckoutRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreSale)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.begin_checkout(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// Record what an acquirer said about one tender.
async fn record_tender_outcome(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(request): Json<crate::edge::contracts::TenderOutcomeRequest>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::StoreSale)?;
    let result = run_blocking(move || state.inventory.record_tender_outcome(request)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// Close a checkout that did not become a sale.
async fn resolve_checkout(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::contracts::ResolveCheckoutRequest>,
) -> Result<Json<Value>, ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreSale)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.resolve_checkout(request)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// Checkouts that never finished — the query a till runs when it starts.
///
/// `InventoryRead`, because reading the list changes nothing and a manager who
/// can see the shop's trade should be able to see money it may be holding
/// against no sale. Acting on one needs `StoreSale`.
async fn unresolved_checkouts(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let rows = run_blocking(move || state.inventory.unresolved_checkouts()).await?;
    Ok(Json(serde_json::json!({ "rows": rows })))
}

async fn store_sale(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<SaleRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreSale)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.complete_sale(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// The three voucher calls a counter cannot answer on its own.
///
/// Everything else in this router is served out of the shop's SQLite and keeps
/// working with the line to head office down. A voucher hold is the exception,
/// and a real one: the value belongs to a card that can be presented in another
/// shop in the same minute, so the only place the answer can be true is the
/// centre, against its own row for that code.
///
/// So the node **relays** rather than mints. It signs the call with its own
/// machine credential — the same `SYNC_UPLOAD_KEY` its outbox uploads under,
/// which proves WHICH SHOP is asking — names the cashier who is asking, and
/// stamps the shop's own site id, so a till cannot hold a card against another
/// shop's counter. When the line is down the answer is 503 and a sentence, not
/// a locally-invented authorisation: a hold nobody else can see is a hold that
/// lets the same card be spent twice, which is the failure this design exists
/// to prevent.
#[derive(Debug, Deserialize)]
struct RelayVoucherCall {
    /// The basket this hold belongs to — the till's own id for the sale it is
    /// building, which has no server-side row yet at either node.
    checkout_id: String,
    /// How much of the card this basket takes. Absent on commit and release.
    #[serde(default)]
    amount_minor: Option<i64>,
    #[serde(default)]
    sale_id: Option<Uuid>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    hold_seconds: Option<i64>,
}

/// One client, built once. A relay per basket is a connection setup per basket
/// otherwise, and the timeout is short on purpose: a cashier standing at a
/// counter with a customer is not going to wait thirty seconds to be told the
/// line is down.
static RELAY: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();

fn relay_client() -> Result<&'static reqwest::Client, EdgeError> {
    if let Some(client) = RELAY.get() {
        return Ok(client);
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|error| EdgeError::Configuration(format!("relay client: {error}")))?;
    Ok(RELAY.get_or_init(|| client))
}

/// A voucher code as a path segment, or a refusal.
///
/// A code is minted from an alphabet that drops the characters people misread,
/// so the safe set is the whole alphabet and a hyphen for a pre-printed card.
/// Checked rather than percent-encoded: this build has no encoder for a path
/// segment, and pulling one in to encode a string that may not contain anything
/// needing encoding would be the tail wagging the dog.
fn voucher_code_segment(code: &str) -> Result<&str, EdgeError> {
    let trimmed = code.trim();
    if trimmed.is_empty()
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(EdgeError::Validation(
            "a voucher code is letters, digits and hyphens".into(),
        ));
    }
    Ok(trimmed)
}

async fn relay_voucher(
    state: &EdgeState,
    code: &str,
    verb: &str,
    actor: &str,
    call: RelayVoucherCall,
) -> Result<Value, EdgeError> {
    let Some(sync) = state.sync.as_ref() else {
        return Err(EdgeError::Upstream(
            "this node has no upload URL configured, so it cannot reach head office".into(),
        ));
    };
    let Some((base, key)) = sync.cloud() else {
        return Err(EdgeError::Configuration(
            "SYNC_UPLOAD_URL is empty, so the relay cannot work out where head office is".into(),
        ));
    };
    let url = format!(
        "{base}/api/v1/sync/vouchers/{}/{}",
        voucher_code_segment(code)?,
        verb
    );
    let node = state.inventory.node();
    let body = json!({
        // The credential proves this, and the centre checks it against its own
        // register rather than taking the field's word.
        "origin_id": &node.node_id,
        "checkout_id": call.checkout_id,
        "amount_minor": call.amount_minor,
        "sale_id": call.sale_id,
        "reason": call.reason,
        "hold_seconds": call.hold_seconds,
        // Stamped, never taken from the client: a till in store-01 must not be
        // able to hold a card against store-07.
        "site_id": node.site_id.as_str(),
        "actor_id": actor,
    });
    let (status, parsed) = relay_exchange(
        relay_client()?
            .post(&url)
            .header(relay::SYNC_KEY_HEADER, key)
            .json(&body),
    )
    .await?;
    if status.is_success() {
        return Ok(parsed);
    }
    // The centre's own refusal, relayed in its own words. A card that has
    // expired or is held by another basket is the cashier's problem to solve,
    // and "that voucher expired on Friday" is the sentence that solves it.
    Err(relay_refusal(
        status,
        &parsed,
        "head office refused the voucher call",
    ))
}

/// What a till sends to hold, or let go of, one use of a limited coupon.
///
/// The voucher relay's shape without an amount — a coupon hold reserves a USE,
/// not money; what it took off travels on the sale. The shopper rides along
/// because a coupon set may cap uses per shopper, and head office measures that
/// cap against whoever the hold names.
#[derive(Debug, Deserialize)]
struct RelayCouponCall {
    /// The basket this hold belongs to — the till's own id for it.
    checkout_id: String,
    #[serde(default)]
    customer_id: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

/// Relay one coupon call to head office, signed with this node's machine
/// credential, exactly as [`relay_voucher`] does for a card.
///
/// When the line is down the answer is 503 and a sentence — never a hold this
/// node made up. A hold only this shop can see is a hundredth use given away
/// twice, which is the failure the limit exists to prevent; a coupon that
/// simply does not apply while head office is unreachable is the honest
/// alternative, and the cashier can tell the shopper why.
async fn relay_coupon(
    state: &EdgeState,
    code: &str,
    verb: &str,
    actor: &str,
    call: &RelayCouponCall,
) -> Result<Value, EdgeError> {
    let Some(sync) = state.sync.as_ref() else {
        return Err(EdgeError::Upstream(
            "this node has no upload URL configured, so it cannot reach head office \
             to hold a limited coupon"
                .into(),
        ));
    };
    let Some((base, key)) = sync.cloud() else {
        return Err(EdgeError::Configuration(
            "SYNC_UPLOAD_URL is empty, so the relay cannot work out where head office is".into(),
        ));
    };
    // The voucher's path-segment check fits a coupon code too: letters,
    // digits and a hyphen are all a printed code is made of.
    let segment = voucher_code_segment(code).map_err(|_| {
        EdgeError::Validation("a coupon code is letters, digits and hyphens".into())
    })?;
    let url = format!("{base}/api/v1/sync/coupons/{segment}/{verb}");
    let node = state.inventory.node();
    let body = json!({
        "origin_id": &node.node_id,
        "checkout_id": call.checkout_id,
        "customer_id": call.customer_id,
        "reason": call.reason,
        // Stamped, never taken from the client — see `relay_voucher`.
        "site_id": node.site_id.as_str(),
        "actor_id": actor,
    });
    let sent = relay_client()?
        .post(&url)
        .header(relay::SYNC_KEY_HEADER, key)
        .json(&body);
    let (status, parsed) = relay_exchange(sent).await.map_err(|error| {
        // The line is down. Said as a sentence a cashier can repeat to the
        // shopper, with the transport's own words kept for whoever reads logs.
        tracing::warn!(%error, code, verb, "coupon relay could not reach head office");
        EdgeError::Upstream(
            "head office cannot be reached, so this limited coupon cannot be held \
             right now — it does not apply until the line is back"
                .into(),
        )
    })?;
    if status.is_success() {
        return Ok(parsed);
    }
    // The centre's own refusal in its own words: "that offer has been used as
    // often as it allows" is the sentence that ends the conversation.
    Err(relay_refusal(
        status,
        &parsed,
        "head office refused the coupon call",
    ))
}

async fn relay_coupon_authorize(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(code): Path<String>,
    Json(call): Json<RelayCouponCall>,
) -> Result<Json<Value>, ApiError> {
    let actor = relay_actor(&state, principal, "holding a coupon")?;
    if call.checkout_id.trim().is_empty() {
        return Err(ApiError(EdgeError::Validation(
            "a coupon hold has to name the basket it is for".into(),
        )));
    }
    let held = relay_coupon(&state, &code, "authorize", &actor, &call)
        .await
        .map_err(ApiError)?;
    // Written down before the till hears yes: a quote or sale leans only on a
    // hold recorded here (`vouched_coupon_holds`), so a hold the till was told
    // about but this node never recorded cannot exist.
    let authorization_id = held
        .get("authorization_id")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            ApiError(EdgeError::Upstream(
                "head office granted a coupon hold without naming it".into(),
            ))
        })?;
    let expires_at = held
        .get("expires_at")
        .and_then(Value::as_str)
        .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
        .map(|at| at.with_timezone(&chrono::Utc));
    let record = crate::edge::CouponHoldRecord {
        authorization_id,
        code: code.trim().to_owned(),
        checkout_id: call.checkout_id.clone(),
        expires_at,
    };
    let inventory = state.inventory.clone();
    run_blocking(move || inventory.record_coupon_hold(record)).await?;
    Ok(Json(held))
}

async fn relay_coupon_release(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(code): Path<String>,
    Json(call): Json<RelayCouponCall>,
) -> Result<Json<Value>, ApiError> {
    let actor = relay_actor(&state, principal, "releasing a coupon")?;
    // Closed here FIRST, and whatever head office says: the basket was
    // abandoned at this till, so no sale here may lean on the hold again. If
    // the line is down the hold lapses at the centre on its own in minutes.
    let inventory = state.inventory.clone();
    let code_owned = code.clone();
    let checkout_id = call.checkout_id.clone();
    run_blocking(move || inventory.close_coupon_hold(&code_owned, &checkout_id)).await?;
    let released = relay_coupon(&state, &code, "release", &actor, &call)
        .await
        .map_err(ApiError)?;
    Ok(Json(released))
}

/// What a till sends for an employee benefit call. The shop and the cashier
/// are stamped by this node, never taken from here.
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct RelayBenefitCall {
    #[serde(default)]
    code: Option<String>,
    /// The till's own id for the basket (its checkout id).
    #[serde(default)]
    sale_ref: Option<String>,
    #[serde(default)]
    amount_minor: Option<i64>,
    #[serde(default)]
    basket_has_promotion: bool,
    #[serde(default)]
    reason: Option<String>,
    /// Instead of a code: the grant an employee's finger on this shop's
    /// scanner earned (`/api/v1/auth/fingerprints/benefit`). Whose balance it
    /// opens is read off the grant here, never taken from the till.
    #[serde(default)]
    finger: Option<String>,
}

impl RelayBenefitCall {
    /// The finger's grant, when the call carries one rather than a code.
    fn finger_grant(&self) -> Result<Option<String>, EdgeError> {
        let Some(grant) = self
            .finger
            .as_deref()
            .map(str::trim)
            .filter(|grant| !grant.is_empty())
        else {
            return Ok(None);
        };
        if self
            .code
            .as_deref()
            .is_some_and(|code| !code.trim().is_empty())
        {
            return Err(EdgeError::Validation(
                "a benefit call names a code or a finger, not both".into(),
            ));
        }
        Ok(Some(grant.to_owned()))
    }
}

/// `holder` is the login a finger's grant named, sent instead of a code. Only
/// when there is one: a head office from before fingers refuses a field it
/// does not know, and the code path must keep working against it.
async fn relay_benefit(
    state: &EdgeState,
    verb: &str,
    actor: &str,
    call: RelayBenefitCall,
    holder: Option<&str>,
) -> Result<Value, EdgeError> {
    let Some(sync) = state.sync.as_ref() else {
        return Err(EdgeError::Upstream(
            "this node has no upload URL configured, so it cannot reach head office".into(),
        ));
    };
    let Some((base, key)) = sync.cloud() else {
        return Err(EdgeError::Configuration(
            "SYNC_UPLOAD_URL is empty, so the relay cannot work out where head office is".into(),
        ));
    };
    let url = format!("{base}/api/v1/sync/benefit/{verb}");
    let node = state.inventory.node();
    let mut body = json!({
        "origin_id": &node.node_id,
        "site_id": node.site_id.as_str(),
        "actor_id": actor,
        "code": call.code,
        "sale_ref": call.sale_ref,
        "amount_minor": call.amount_minor,
        "basket_has_promotion": call.basket_has_promotion,
        "reason": call.reason,
    });
    if let (Some(holder), Some(fields)) = (holder, body.as_object_mut()) {
        fields.insert("holder".into(), Value::from(holder));
    }
    let (status, parsed) = relay_exchange(
        relay_client()?
            .post(&url)
            .header(relay::SYNC_KEY_HEADER, key)
            .json(&body),
    )
    .await?;
    if status.is_success() {
        return Ok(parsed);
    }
    Err(relay_refusal(
        status,
        &parsed,
        "head office refused the benefit call",
    ))
}

async fn relay_benefit_lookup(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(call): Json<RelayBenefitCall>,
) -> Result<Json<Value>, ApiError> {
    let actor = relay_actor(&state, principal, "finding a benefit")?;
    let holder = match call.finger_grant().map_err(ApiError)? {
        None => None,
        Some(grant) => {
            let connection = state.auth.connection();
            let holder = run_blocking(move || {
                let guard = connection
                    .lock()
                    .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
                crate::edge::fingerprint::benefit_grant_holder(&guard, &grant)
            })
            .await?;
            // Said now rather than at the spend, while the employee is still
            // at the counter: head office refuses it then anyway.
            if holder == actor {
                return Err(ApiError(EdgeError::Forbidden(
                    "a cashier does not ring up their own benefit; ask a colleague".into(),
                )));
            }
            Some(holder)
        }
    };
    Ok(Json(
        relay_benefit(&state, "lookup", &actor, call, holder.as_deref())
            .await
            .map_err(ApiError)?,
    ))
}

async fn relay_benefit_spend(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(call): Json<RelayBenefitCall>,
) -> Result<Json<Value>, ApiError> {
    let actor = relay_actor(&state, principal, "spending a benefit")?;
    if call.amount_minor.unwrap_or(0) <= 0 {
        return Err(ApiError(EdgeError::Validation(
            "a benefit spend says how much of the basket it pays".into(),
        )));
    }
    let Some(grant) = call.finger_grant().map_err(ApiError)? else {
        return Ok(Json(
            relay_benefit(&state, "spend", &actor, call, None)
                .await
                .map_err(ApiError)?,
        ));
    };
    let sale_ref = call
        .sale_ref
        .as_deref()
        .map(str::trim)
        .filter(|sale_ref| !sale_ref.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| {
            ApiError(EdgeError::Validation(
                "a benefit spend names the basket it pays".into(),
            ))
        })?;
    // The grant is spent here first, on this basket, so one finger pays one
    // basket however often the till asks; given back below if head office
    // never took the spend.
    let connection = state.auth.connection();
    let (token, basket) = (grant.clone(), sale_ref.clone());
    let holder = run_blocking(move || {
        let mut guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        crate::edge::fingerprint::spend_benefit_grant(&mut guard, &token, &basket)
    })
    .await?;
    match relay_benefit(&state, "spend", &actor, call, Some(&holder)).await {
        Ok(spent) => Ok(Json(spent)),
        Err(error) => {
            let connection = state.auth.connection();
            let undone = run_blocking(move || {
                let guard = connection
                    .lock()
                    .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
                crate::edge::fingerprint::unspend_benefit_grant(&guard, &grant, &sale_ref)
            })
            .await;
            if undone.is_err() {
                tracing::warn!("a benefit finger could not be given back after its spend failed");
            }
            Err(ApiError(error))
        }
    }
}

async fn relay_benefit_return(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(call): Json<RelayBenefitCall>,
) -> Result<Json<Value>, ApiError> {
    let actor = relay_actor(&state, principal, "giving a benefit back")?;
    Ok(Json(
        relay_benefit(&state, "return", &actor, call, None)
            .await
            .map_err(ApiError)?,
    ))
}

/// The Kepala toko approves an unknown item: its name and price, verified with
/// a finger or a password now, once. The till's sale spends the approval; a
/// quote never verifies anything for the line (a finger's grant is single-use
/// and short-lived, and the till quotes every couple of seconds).
async fn approve_unknown_item(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::UnknownItemApprovalRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreSale)? {
        request.actor_id = principal.username;
    }
    let approval = run_blocking(move || state.inventory.approve_unknown_item(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(approval)?)))
}

#[derive(Debug, Deserialize)]
struct UnmatchedSalesQuery {
    /// `open`, `matched` or `found`.
    #[serde(default)]
    status: Option<String>,
}

/// This shop's unmatched sales, as head office has them: what is still to
/// match, what was matched and with what. Read-only and kept centrally, so
/// relayed with this node's machine credential, like the benefit calls.
async fn relay_unmatched_sales(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(query): Query<UnmatchedSalesQuery>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let status = query
        .status
        .as_deref()
        .map(str::trim)
        .filter(|status| !status.is_empty())
        .unwrap_or("open")
        .to_ascii_lowercase();
    if !matches!(status.as_str(), "open" | "matched" | "found") {
        return Err(ApiError(EdgeError::Validation(format!(
            "status is open, matched or found, not {status}"
        ))));
    }
    let Some(sync) = state.sync.as_ref() else {
        return Err(ApiError(EdgeError::Upstream(
            "this node has no upload URL configured, so it cannot reach head office".into(),
        )));
    };
    let Some((base, key)) = sync.cloud() else {
        return Err(ApiError(EdgeError::Configuration(
            "SYNC_UPLOAD_URL is empty, so the relay cannot work out where head office is".into(),
        )));
    };
    let node = state.inventory.node();
    let url = reqwest::Url::parse_with_params(
        &format!("{base}/api/v1/sync/unmatched"),
        &[
            ("origin_id", node.node_id.as_str()),
            ("site_id", node.site_id.as_str()),
            ("status", status.as_str()),
        ],
    )
    .map_err(|error| ApiError(EdgeError::Configuration(format!("head office URL: {error}"))))?;
    let (code, parsed) = relay_exchange(
        relay_client()
            .map_err(ApiError)?
            .get(url)
            .header(relay::SYNC_KEY_HEADER, key),
    )
    .await
    .map_err(ApiError)?;
    if code.is_success() {
        return Ok(Json(parsed));
    }
    Err(ApiError(relay_refusal(
        code,
        &parsed,
        "head office refused to list unmatched sales",
    )))
}

/// Send one relay call to head office and hand back what it answered.
///
/// The half every relay shares: the call went, and here is the status and the
/// body — parsed when it is JSON, and wrapped as `{"detail": …}` when it is
/// not, so a proxy's HTML error page still reaches the caller as a sentence.
/// Failing to get an answer at all is `Upstream` — the line is down, which is
/// the one thing this node can say for certain.
async fn relay_exchange(
    request: reqwest::RequestBuilder,
) -> Result<(StatusCode, Value), EdgeError> {
    let response = request
        .send()
        .await
        .map_err(|error| EdgeError::Upstream(error.to_string()))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| EdgeError::Upstream(error.to_string()))?;
    let parsed: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({ "detail": text }));
    Ok((status, parsed))
}

/// Head office's refusal, as this node's own error, in head office's words.
fn relay_refusal(status: StatusCode, parsed: &Value, fallback: &str) -> EdgeError {
    let said = parsed
        .get("error")
        .or_else(|| parsed.get("detail"))
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .to_string();
    match status {
        StatusCode::BAD_REQUEST => EdgeError::Validation(said),
        StatusCode::NOT_FOUND => EdgeError::NotFound(said),
        StatusCode::CONFLICT => EdgeError::Conflict(said),
        StatusCode::UNAUTHORIZED => EdgeError::Unauthorized(said),
        StatusCode::FORBIDDEN => EdgeError::Forbidden(said),
        other => EdgeError::Upstream(format!("{other}: {said}")),
    }
}

/// The cashier's name is the only thing that comes from the request body's
/// neighbourhood, and even that is taken from the session rather than trusted:
/// `require_permission` has already refused anybody without the StoreSale rung.
fn relay_actor(
    state: &EdgeState,
    principal: Option<Extension<EdgePrincipal>>,
    what: &str,
) -> Result<String, ApiError> {
    match require_permission(state, principal, EdgePermission::StoreSale)? {
        Some(principal) => Ok(principal.username),
        None => Err(ApiError(EdgeError::Unauthorized(format!(
            "{what} has to be attributable to somebody"
        )))),
    }
}

async fn relay_voucher_authorize(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(code): Path<String>,
    Json(call): Json<RelayVoucherCall>,
) -> Result<Json<Value>, ApiError> {
    let actor = relay_actor(&state, principal, "holding a voucher")?;
    if call.amount_minor.unwrap_or(0) <= 0 {
        return Err(ApiError(EdgeError::Validation(
            "a hold has to say how much of the card the basket takes".into(),
        )));
    }
    let checkout_id = call.checkout_id.clone();
    let held = relay_voucher(&state, &code, "authorize", &actor, call)
        .await
        .map_err(ApiError)?;
    // Written down before the till hears yes: the sale that spends this hold
    // is checked against this record (`spend_voucher_holds`), so a hold the
    // till was told about but this node never recorded cannot exist.
    let record = voucher_hold_record(&held, &code, checkout_id)?;
    let inventory = state.inventory.clone();
    run_blocking(move || inventory.record_voucher_hold(record)).await?;
    Ok(Json(held))
}

/// Head office's answer to an authorize, as the till's own record of it.
/// An answer without an id or an amount is not a hold anything can spend, and
/// is refused rather than recorded half-way.
fn voucher_hold_record(
    held: &Value,
    code: &str,
    checkout_id: String,
) -> Result<crate::edge::VoucherHoldRecord, ApiError> {
    let authorization_id = held
        .get("authorization_id")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            ApiError(EdgeError::Upstream(
                "head office granted a hold without naming it".into(),
            ))
        })?;
    let amount_minor = held
        .get("amount_minor")
        .and_then(Value::as_i64)
        .filter(|amount| *amount > 0)
        .ok_or_else(|| {
            ApiError(EdgeError::Upstream(
                "head office granted a hold without an amount".into(),
            ))
        })?;
    let expires_at = held
        .get("expires_at")
        .and_then(Value::as_str)
        .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
        .map(|at| at.with_timezone(&chrono::Utc));
    Ok(crate::edge::VoucherHoldRecord {
        authorization_id,
        code: code.to_owned(),
        checkout_id,
        amount_minor,
        expires_at,
    })
}

/// F2 on a voucher: its kind and what is left on it, read-only. No hold is
/// made and nothing is recorded here — a balance asked is not a balance spent.
async fn relay_voucher_check(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(code): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let actor = relay_actor(&state, principal, "checking a voucher")?;
    let call = RelayVoucherCall {
        checkout_id: "check".into(),
        amount_minor: None,
        sale_id: None,
        reason: None,
        hold_seconds: None,
    };
    Ok(Json(
        relay_voucher(&state, &code, "check", &actor, call)
            .await
            .map_err(ApiError)?,
    ))
}

/// What a till sends to find a member, or register one.
#[derive(Debug, Deserialize)]
struct RelayMemberCall {
    /// The number the cashier read out or scanned — a phone, or a card number.
    member_id: String,
    #[serde(default)]
    display_name: Option<String>,
    /// Registration only (client, 23 Oct 2026): `L` or `P`.
    #[serde(default)]
    gender: Option<String>,
    #[serde(default)]
    birth_place: Option<String>,
    /// `YYYY-MM-DD`.
    #[serde(default)]
    birth_date: Option<String>,
    #[serde(default)]
    address: Option<String>,
    #[serde(default)]
    email: Option<String>,
}

/// Relay one member call to head office, signed with this node's machine
/// credential, exactly as [`relay_benefit`] does: members are kept centrally,
/// so a shopper registered at one shop is known at the next.
async fn relay_member(
    state: &EdgeState,
    verb: &str,
    actor: &str,
    call: RelayMemberCall,
) -> Result<Value, EdgeError> {
    let Some(sync) = state.sync.as_ref() else {
        return Err(EdgeError::Upstream(
            "this node has no upload URL configured, so it cannot reach head office".into(),
        ));
    };
    let Some((base, key)) = sync.cloud() else {
        return Err(EdgeError::Configuration(
            "SYNC_UPLOAD_URL is empty, so the relay cannot work out where head office is".into(),
        ));
    };
    let url = format!("{base}/api/v1/sync/members/{verb}");
    let node = state.inventory.node();
    let body = json!({
        "origin_id": &node.node_id,
        "site_id": node.site_id.as_str(),
        "actor_id": actor,
        "member_id": call.member_id,
        "display_name": call.display_name,
        "gender": call.gender,
        "birth_place": call.birth_place,
        "birth_date": call.birth_date,
        "address": call.address,
        "email": call.email,
    });
    let (status, parsed) = relay_exchange(
        relay_client()?
            .post(&url)
            .header(relay::SYNC_KEY_HEADER, key)
            .json(&body),
    )
    .await?;
    if status.is_success() {
        return Ok(parsed);
    }
    Err(relay_refusal(status, &parsed, "head office refused the member call"))
}

/// F5: who is this number, and their points.
async fn relay_member_lookup(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(call): Json<RelayMemberCall>,
) -> Result<Json<Value>, ApiError> {
    let actor = relay_actor(&state, principal, "finding a member")?;
    Ok(Json(
        relay_member(&state, "lookup", &actor, call)
            .await
            .map_err(ApiError)?,
    ))
}

/// Shift+F5: register a new member by their phone and name.
async fn relay_member_enrol(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(call): Json<RelayMemberCall>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let actor = relay_actor(&state, principal, "registering a member")?;
    Ok((
        StatusCode::CREATED,
        Json(
            relay_member(&state, "enrol", &actor, call)
                .await
                .map_err(ApiError)?,
        ),
    ))
}

/// A lookup of one member by number, and nothing else.
fn member_number(member_id: &str) -> RelayMemberCall {
    RelayMemberCall {
        member_id: member_id.trim().to_string(),
        display_name: None,
        gender: None,
        birth_place: None,
        birth_date: None,
        address: None,
        email: None,
    }
}

/// Head office's name for a member, from a lookup's answer.
fn member_display_name(found: &Value) -> Option<String> {
    found
        .get("display_name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
}

/// F5 "Daftar member" with a struk number (client, 24 Oct 2026): the member
/// just registered takes a sale already rung, and earns its points as if they
/// had been on it (`till::attach_member`).
///
/// Head office is asked who the number is first: its answer names them, and a
/// number it has never heard of is refused before the sale is touched. With
/// the line down the sale is still tied on — by number, the name left to head
/// office — and the award travels with this node's next push, behind the sale
/// it belongs to.
async fn store_attach_member(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::till::AttachMemberRequest>,
) -> Result<Json<Value>, ApiError> {
    let actor = relay_actor(&state, principal, "tying a member to a sale")?;
    let member_name =
        match relay_member(&state, "lookup", &actor, member_number(&request.member_id)).await {
            Ok(found) => {
                if let Some(member_id) = found.get("member_id").and_then(Value::as_str) {
                    request.member_id = member_id.to_string();
                }
                member_display_name(&found)
            }
            Err(EdgeError::NotFound(_)) => {
                return Err(ApiError(EdgeError::NotFound(format!(
                    "Member {} tidak ada",
                    request.member_id.trim()
                ))));
            }
            // The line is down, or this node has no head office to ask.
            Err(EdgeError::Upstream(_) | EdgeError::Configuration(_)) => None,
            Err(other) => return Err(ApiError(other)),
        };
    let site_id = state.inventory.node().site_id.as_str().to_string();
    let attaching = actor.clone();
    let attached = held_step(&state, move |tx, now| {
        crate::edge::till::attach_member(
            tx,
            &site_id,
            &request,
            member_name.as_deref(),
            &attaching,
            now,
        )
    })
    .await?;
    match attached {
        crate::edge::till::MemberAttach::Attached(result) => {
            Ok(Json(serde_json::to_value(result)?))
        }
        crate::edge::till::MemberAttach::Taken {
            receipt_no,
            member_id,
            member_name,
        } => {
            let name = match member_name {
                Some(name) => name,
                None => relay_member(&state, "lookup", &actor, member_number(&member_id))
                    .await
                    .ok()
                    .as_ref()
                    .and_then(member_display_name)
                    .unwrap_or(member_id),
            };
            Err(ApiError(EdgeError::Conflict(format!(
                "{receipt_no} sudah atas nama {name}"
            ))))
        }
    }
}

async fn relay_voucher_commit(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(code): Path<String>,
    Json(call): Json<RelayVoucherCall>,
) -> Result<Json<Value>, ApiError> {
    let actor = relay_actor(&state, principal, "settling a voucher")?;
    let checkout_id = call.checkout_id.clone();
    let committed = relay_voucher(&state, &code, "commit", &actor, call)
        .await
        .map_err(ApiError)?;
    // Settled at the centre directly: no sale at this till may spend it again.
    let inventory = state.inventory.clone();
    let code_owned = code.clone();
    run_blocking(move || inventory.close_voucher_hold(&code_owned, &checkout_id)).await?;
    Ok(Json(committed))
}

async fn relay_voucher_release(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(code): Path<String>,
    Json(call): Json<RelayVoucherCall>,
) -> Result<Json<Value>, ApiError> {
    let actor = relay_actor(&state, principal, "releasing a voucher")?;
    let checkout_id = call.checkout_id.clone();
    let released = relay_voucher(&state, &code, "release", &actor, call)
        .await
        .map_err(ApiError)?;
    // Given back at the centre, so it is given back here too.
    let inventory = state.inventory.clone();
    let code_owned = code.clone();
    run_blocking(move || inventory.close_voucher_hold(&code_owned, &checkout_id)).await?;
    Ok(Json(released))
}

/// POST a relay call to head office and translate its answer.
///
/// The voucher relay's tail (`relay_exchange` + `relay_refusal`) under its own
/// name rather than `relay_voucher` itself generalised to cover it: the
/// voucher relay builds its URL from a code and a verb, and points redemption
/// has neither — a shared parameter list wide enough for both would fit
/// neither call as clearly as this reads on its own.
async fn relay_points_call(url: &str, key: &str, body: &Value) -> Result<Value, EdgeError> {
    let (status, parsed) = relay_exchange(
        relay_client()?
            .post(url)
            .header(relay::SYNC_KEY_HEADER, key)
            .json(body),
    )
    .await?;
    if status.is_success() {
        return Ok(parsed);
    }
    // Head office's own refusal, relayed in its own words — a request that
    // has expired or was already confirmed is the cashier's problem to solve,
    // and "that code has expired" is the sentence that solves it.
    Err(relay_refusal(
        status,
        &parsed,
        "head office refused the points call",
    ))
}

#[derive(Debug, Deserialize)]
struct RelayRedeemLookupCall {
    member_id: String,
    code: String,
}

/// A cashier's guess at a shopper's redemption code, relayed to head office —
/// the only place a member's live request and its balance can both be seen.
async fn relay_redeem_request_lookup(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(call): Json<RelayRedeemLookupCall>,
) -> Result<Json<Value>, ApiError> {
    let actor = relay_actor(&state, principal, "looking up a points redemption")?;
    let Some(sync) = state.sync.as_ref() else {
        return Err(ApiError(EdgeError::Upstream(
            "this node has no upload URL configured, so it cannot reach head office".into(),
        )));
    };
    let Some((base, key)) = sync.cloud() else {
        return Err(ApiError(EdgeError::Configuration(
            "SYNC_UPLOAD_URL is empty, so the relay cannot work out where head office is".into(),
        )));
    };
    let url = format!("{base}/api/v1/sync/points/redeem-requests/lookup");
    let node = state.inventory.node();
    let body = json!({
        "origin_id": &node.node_id,
        "member_id": call.member_id,
        "code": call.code,
        "actor_id": actor,
    });
    let found = relay_points_call(&url, key, &body)
        .await
        .map_err(ApiError)?;
    Ok(Json(found))
}

/// Confirm the request a lookup just found: the debit and the voucher it
/// becomes, both at once, at the centre's own idea of the rate. This
/// terminal never sees or decides a rate — see `postgres/loyalty.rs`'s
/// `confirm_redeem_request`, the one place that is settled.
async fn relay_redeem_request_confirm(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(request_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let actor = relay_actor(&state, principal, "confirming a points redemption")?;
    let Some(sync) = state.sync.as_ref() else {
        return Err(ApiError(EdgeError::Upstream(
            "this node has no upload URL configured, so it cannot reach head office".into(),
        )));
    };
    let Some((base, key)) = sync.cloud() else {
        return Err(ApiError(EdgeError::Configuration(
            "SYNC_UPLOAD_URL is empty, so the relay cannot work out where head office is".into(),
        )));
    };
    let url = format!(
        "{base}/api/v1/sync/points/redeem-requests/{}/confirm",
        request_id.trim()
    );
    let node = state.inventory.node();
    let body = json!({
        "origin_id": &node.node_id,
        "actor_id": actor,
    });
    let confirmed = relay_points_call(&url, key, &body)
        .await
        .map_err(ApiError)?;
    Ok(Json(confirmed))
}

/// How long a manager's HR call may take to come back. Longer than a counter's
/// voucher hold (the client's 10 s): a roster week or a month's attendance is a
/// heavier read than one card, and nobody is standing at the counter waiting
/// on it — but short enough that a dead line is still said in seconds.
const CENTRAL_RELAY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// The largest body a manager's HR call may carry up. Every allowlisted act is
/// a small JSON form — a decision and a reason, a day's plan, a claim's lines —
/// and the router's 2 MiB is for receipts and photographs this relay never
/// carries.
const CENTRAL_RELAY_MAX_BODY: usize = 256 * 1024;

/// The shop's window onto head office's people — and its own General Affairs.
///
/// `/api/v1/store/central/{path}` is `/api/v1/{path}` at the cloud, relayed on
/// behalf of whoever is signed in at this till, so the till keeps ONE server
/// and ONE sign-in (Hari, 2026-09-25) while HR data stays where it lives. The
/// shape is the voucher relay's: the node signs the call with its own machine
/// credential (`x-sync-key`, proving WHICH SHOP), names itself
/// (`x-relay-origin`) and the person (`x-relay-user`), and head office decides
/// — see `cloud::http::auth::relayed_principal` for the chain it checks.
///
/// What this node refuses before anything leaves the shop:
///
/// - **Nobody signed in, or a node with sign-in off.** There is no person to
///   relay for, and "the node" is not somebody head office has heard of.
/// - **A LOCAL account.** A break-glass login exists only in this SQLite; it
///   has no identity at the cloud, so there is nobody for the cloud to check
///   the assignment of, and a relay that forwarded it would be asking the
///   cloud to trust the node's word for a person it cannot name.
/// - **A path off the list** (`domain::relay`). The same list the cloud holds
///   the call to on arrival: one list, two walls.
///
/// What it forwards: the method, the path, the query string exactly as sent,
/// and the JSON body. What it never forwards: the browser's cookie, bearer,
/// or CSRF token — those are this node's session, and the cloud has no use
/// for a credential it did not issue. The answer comes back as the cloud gave
/// it, status and body, so a refusal reads in head office's own words; a line
/// that is down is 503 and a sentence, never a locally-invented answer.
///
/// Nothing here is cached or kept. With the line down, HR is unavailable at
/// the till — and the till's own work (sales, the drawer, stock) is untouched,
/// because none of it comes through here.
async fn relay_central(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    request: Request,
) -> Result<Response, ApiError> {
    if !state.auth.enabled() {
        return Err(ApiError(EdgeError::Forbidden(
            "this node signs nobody in, so there is nobody head office could answer for".into(),
        )));
    }
    let principal = principal
        .map(|Extension(principal)| principal)
        .ok_or_else(|| ApiError(EdgeError::Unauthorized("missing session principal".into())))?;
    if principal.source != "CLOUD" {
        return Err(ApiError(EdgeError::Forbidden(format!(
            "{} is an account of this shop only; head office does not know it, so its HR \
             cannot be reached with it — sign in with your head-office account",
            principal.username
        ))));
    }
    let method = request.method().as_str().to_owned();
    let cloud_path = central_cloud_path(request.uri().path()).ok_or_else(|| {
        ApiError(EdgeError::NotFound(
            "that is not a head-office path this till can ask".into(),
        ))
    })?;
    if !relay::is_relayable(&method, &cloud_path) {
        return Err(ApiError(EdgeError::Forbidden(format!(
            "{method} {cloud_path} is not something this till may ask head office"
        ))));
    }
    let query = request.uri().query().map(str::to_owned);
    let Some(sync) = state.sync.as_ref() else {
        return Err(ApiError(EdgeError::Upstream(
            "this node has no upload URL configured, so it cannot reach head office".into(),
        )));
    };
    let Some((base, key)) = sync.cloud() else {
        return Err(ApiError(EdgeError::Configuration(
            "SYNC_UPLOAD_URL is empty, so the relay cannot work out where head office is".into(),
        )));
    };
    let body = axum::body::to_bytes(request.into_body(), CENTRAL_RELAY_MAX_BODY)
        .await
        .map_err(|_| {
            ApiError(EdgeError::Validation(format!(
                "a head-office call carries at most {} KiB",
                CENTRAL_RELAY_MAX_BODY / 1024
            )))
        })?;
    let url = match query.as_deref().filter(|query| !query.is_empty()) {
        Some(query) => format!("{base}{cloud_path}?{query}"),
        None => format!("{base}{cloud_path}"),
    };
    let verb = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|error| ApiError(EdgeError::Validation(error.to_string())))?;
    let mut call = relay_client()
        .map_err(ApiError)?
        .request(verb, &url)
        .timeout(CENTRAL_RELAY_TIMEOUT)
        .header(relay::SYNC_KEY_HEADER, key)
        .header(
            relay::RELAY_ORIGIN_HEADER,
            state.inventory.node().node_id.as_str(),
        )
        .header(relay::RELAY_USER_HEADER, principal.user_id.to_string())
        .header(header::ACCEPT, "application/json");
    if !body.is_empty() {
        call = call
            .header(header::CONTENT_TYPE, "application/json")
            .body(body);
    }
    let (status, answer) = relay_exchange(call).await.map_err(ApiError)?;
    Ok((status, Json(answer)).into_response())
}

/// The cloud path a central-relay request names, or `None` when it names none.
///
/// Read from the raw request path rather than a decoded `Path` extractor, so
/// what is checked against the relay list is byte for byte what is sent on —
/// a `%2F` stays three characters, and the list's segment rule refuses it.
fn central_cloud_path(raw: &str) -> Option<String> {
    let rest = raw.strip_prefix(relay::STORE_RELAY_PREFIX)?;
    rest.starts_with('/')
        .then(|| format!("/api/v1{rest}"))
        .filter(|path| path.len() > "/api/v1/".len())
}

/// What this shop took, bucketed by day, week or month.
///
/// Read from the shop's own SQLite, so it still answers when the link to the
/// centre is down. `InventoryRead` rather than a new permission: this is the
/// shop's own trade, and anybody trusted to see its stock is trusted to see
/// what it sold.
async fn store_sales_series(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(query): Query<crate::edge::reports::SalesSeriesQuery>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let series = run_blocking(move || state.inventory.sales_series(query)).await?;
    Ok(Json(serde_json::to_value(series)?))
}

/// One span of this shop's trade, down to the receipts.
async fn store_sales_window(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(query): Query<crate::edge::reports::SalesWindowQuery>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let window = run_blocking(move || state.inventory.sales_window(query)).await?;
    Ok(Json(serde_json::to_value(window)?))
}

/// This shop's sellable range, at this shop's prices.
///
/// Priced through the same evaluator the till runs, so what a customer is
/// quoted from a screen is what the counter will charge.
///
/// An empty list has two very different causes and the response distinguishes
/// them: `has_price_book: false` means no publication has ever reached this
/// shop, which is a sync problem; `true` with no items means the price book is
/// here and lists nothing this shop stocks, which is a merchandising one.
async fn store_catalog(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(query): Query<crate::edge::pricing::CatalogQuery>,
    headers: axum::http::HeaderMap,
) -> Result<Response, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    // Whole-book revalidation (POS-PERFORMANCE-PLAN Phase 2.2): the desk
    // pulls the book whole at open and then refetches it — on focus, on the
    // price-drop poll, after a sale — and the book changes only when the
    // centre publishes a new generation. So the FIRST page carries the
    // catalogue generation as a strong ETag, and a desk that already holds
    // that exact book gets a body-less 304 instead of ten JSON pages. Search
    // and cursor pages never revalidate: they are answers about a query, not
    // about the book.
    let revalidating = query.cursor.is_none() && query.q.is_none();
    let etag: Option<String> = if revalidating {
        state
            .inventory
            .catalog_snapshot_state()
            .ok()
            .map(|snapshot| format!("\"{}\"", snapshot.generation))
    } else {
        None
    };
    if let Some(etag) = &etag {
        let matches = headers
            .get(axum::http::header::IF_NONE_MATCH)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|sent| sent.split(',').any(|c| c.trim() == etag));
        if matches {
            return Ok((
                axum::http::StatusCode::NOT_MODIFIED,
                [(axum::http::header::ETAG, etag.as_str())],
            )
                .into_response());
        }
    }
    let node = state.inventory.node().clone();
    let page = run_blocking(move || state.inventory.store_catalog_page(query)).await?;
    let items = page.items;
    let publication_version = items.iter().map(|item| item.publication_version).max();
    let currency = items
        .first()
        .map(|item| item.currency.clone())
        .unwrap_or_else(|| "IDR".to_string());
    let mut response = Json(json!({
        "site_id": node.site_id.as_str(),
        "channel": crate::edge::pricing::STORE_CHANNEL,
        "as_of": chrono::Utc::now(),
        "has_price_book": publication_version.is_some(),
        "publication_version": publication_version,
        "currency": currency,
        "item_count": items.len(),
        "limit": page.limit,
        "next_cursor": page.next_cursor,
        "items": items,
    }))
    .into_response();
    if let Some(etag) = etag {
        if let Ok(value) = axum::http::HeaderValue::from_str(&etag) {
            response
                .headers_mut()
                .insert(axum::http::header::ETAG, value);
        }
    }
    Ok(response)
}

/// The payment methods head office set this shop up to take, in its order
/// (cloud 0474). Empty until the first list arrives; a till then keeps its own.
async fn store_payment_methods(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Vec<crate::cloud::domain::TillPaymentMethod>>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let connection = state.auth.connection();
    let methods = run_blocking(move || {
        let connection = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("store database lock poisoned".into()))?;
        crate::edge::payment_methods::list(&connection)
    })
    .await?;
    Ok(Json(methods))
}

/// Which till is asking. Absent means "whatever shift this node has open",
/// which is the right answer in a shop with one counter — and every shop in
/// this fleet has one counter.
#[derive(Debug, Deserialize)]
struct ActiveShiftQuery {
    #[serde(default)]
    terminal_id: Option<String>,
}

/// Which business day's drawers to list.
#[derive(Debug, Deserialize)]
struct ShiftsOnQuery {
    /// `YYYY-MM-DD`, the store's own date.
    business_date: String,
}

async fn store_open_shift(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::till::OpenShiftRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::StoreSale)?;
    if let Some(principal) = principal.as_ref() {
        request.actor_id = principal.username.clone();
    }
    let report = run_blocking(move || state.inventory.open_shift(request)).await?;
    Ok((
        StatusCode::CREATED,
        Json(blind_for_cashier(
            principal.as_ref(),
            serde_json::to_value(report)?,
        )),
    ))
}

/// The drawer's figures, withheld from the person who counts it.
///
/// A blind close is only blind if the expectation cannot be read anywhere a
/// cashier can reach, and every shift route answers with the whole Z report.
/// So for a CASHIER the report goes out with `blind: true` and every figure the
/// expected cash can be rebuilt from set to null: the takings by kind, the
/// change, the refunds, the per-tender totals, the expectation and the
/// variance. What the cashier did themselves — the float, the movements, the
/// count sheet — stays. Supervisors and admins get it whole, and so does a
/// node running with auth off, which has no roles to tell apart.
fn blind_for_cashier(principal: Option<&EdgePrincipal>, mut report: Value) -> Value {
    let cashier =
        principal.is_some_and(|principal| principal.role == crate::edge::domain::Role::Cashier);
    if !cashier {
        return report;
    }
    if let Some(fields) = report.as_object_mut() {
        for key in [
            "sales_total_minor",
            "cash_sales_minor",
            "non_cash_minor",
            "change_given_minor",
            "cash_refunds_minor",
            "non_cash_refunds_minor",
            "expected_cash_minor",
            "variance_minor",
        ] {
            if fields.contains_key(key) {
                fields.insert(key.into(), Value::Null);
            }
        }
        if fields.contains_key("tenders") {
            fields.insert("tenders".into(), json!([]));
        }
        fields.insert("blind".into(), Value::Bool(true));
    }
    report
}

/// Run one held-sale step on the node's connection, in its own transaction.
async fn held_step<T, F>(state: &EdgeState, step: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce(&rusqlite::Transaction<'_>, chrono::DateTime<chrono::Utc>) -> Result<T, EdgeError>
        + Send
        + 'static,
{
    if state.inventory.node().role != EdgeRole::Store {
        return Err(ApiError(EdgeError::Forbidden(
            "a held sale is a shop's, and a DC does not sell".into(),
        )));
    }
    let connection = state.auth.connection();
    let now = state.inventory.clock().now();
    run_blocking(move || {
        let mut guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        let tx = guard
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(crate::edge::sqlite::db)?;
        let answer = step(&tx, now)?;
        tx.commit().map_err(crate::edge::sqlite::db)?;
        Ok(answer)
    })
    .await
}

/// Today's held sales, every cashier's.
async fn store_held_sales(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::StoreSale)?;
    let items = held_step(&state, |tx, now| crate::edge::till::held_sales(tx, now)).await?;
    Ok(Json(json!({ "items": items })))
}

/// Put a basket aside.
async fn store_hold_sale(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::till::HoldSaleRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreSale)? {
        request.actor_id = principal.username;
    }
    name_the_actor(&mut request.actor_id);
    let created =
        held_step(&state, move |tx, now| crate::edge::till::hold_sale(tx, &request, now)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(created)?)))
}

/// Take a held basket back: it leaves the list, and the basket comes back.
async fn store_resume_held(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(held_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let actor = require_permission(&state, principal, EdgePermission::StoreSale)?
        .map(|principal| principal.username)
        .unwrap_or_else(|| "system:till".to_string());
    let held = held_step(&state, move |tx, now| {
        crate::edge::till::resume_held(tx, &held_id, &actor, now)
    })
    .await?;
    Ok(Json(serde_json::to_value(held)?))
}

/// Throw a held basket away, with the Kepala toko's finger or password.
async fn store_drop_held(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(held_id): Path<String>,
    Json(mut request): Json<crate::edge::till::DropHeldRequest>,
) -> Result<Json<Value>, ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreSale)? {
        request.actor_id = principal.username;
    }
    let held = held_step(&state, move |tx, now| {
        crate::edge::till::drop_held(tx, &held_id, &request, now)
    })
    .await?;
    Ok(Json(serde_json::to_value(held)?))
}

/// Record a supervisor's yes to a basket edit.
///
/// `StoreSale`, like a void: the cashier sends it with the supervisor's grant
/// in the body, and the grant — not the cashier's role — is what is checked.
async fn store_record_approval(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::till::TillApprovalRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreSale)? {
        request.actor_id = principal.username;
    }
    let approval = run_blocking(move || state.inventory.record_till_approval(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(approval)?)))
}

/// The shift currently running, or `null`.
///
/// `null` rather than a 404: "no shift is open" is an ordinary state of a shop
/// at nine in the morning, and a till that had to treat it as an error would
/// log one every day before it opened.
async fn store_active_shift(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(query): Query<ActiveShiftQuery>,
) -> Result<Json<Value>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let report =
        run_blocking(move || state.inventory.active_shift(query.terminal_id.as_deref())).await?;
    let report = serde_json::to_value(report)?;
    if report.is_null() {
        return Ok(Json(report));
    }
    Ok(Json(blind_for_cashier(principal.as_ref(), report)))
}

async fn store_shift_report(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(shift_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let report = run_blocking(move || state.inventory.shift_report(&shift_id)).await?;
    Ok(Json(blind_for_cashier(
        principal.as_ref(),
        serde_json::to_value(report)?,
    )))
}

async fn store_cash_movement(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(shift_id): Path<String>,
    Json(mut request): Json<crate::edge::till::CashMovementRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::StoreSale)?;
    if let Some(principal) = principal.as_ref() {
        request.actor_id = principal.username.clone();
    }
    request.supervising = supervising(principal.as_ref());
    let report =
        run_blocking(move || state.inventory.record_cash_movement(&shift_id, request)).await?;
    Ok((
        StatusCode::CREATED,
        Json(blind_for_cashier(
            principal.as_ref(),
            serde_json::to_value(report)?,
        )),
    ))
}

/// What the shop spent out of petty cash, over a span.
///
/// `InventoryRead` rather than a permission of its own: this is the shop's own
/// book, and anybody trusted to see its stock is trusted to see that it bought
/// a ream of paper. Writing one is a different question, below.
async fn store_expenses(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(query): Query<crate::edge::petty::ExpenseWindowQuery>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let window = run_blocking(move || state.inventory.expense_window(query)).await?;
    Ok(Json(serde_json::to_value(window)?))
}

/// Record what the shop spent.
///
/// `StoreSale`: whoever is at the counter records it, and nobody else signs
/// (owner, 2026-10-02). Above the line Finance sets, the shop types Finance's
/// one-time code; it is checked and used up at the centre here, before the row
/// is written, and the domain refuses a big expense that arrives without it.
async fn store_record_expense(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::petty::RecordExpenseRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreSale)? {
        request.actor_id = principal.username.clone();
    }
    let code = request
        .approval_code
        .as_deref()
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .map(str::to_owned);
    let approval = match code {
        Some(code) => {
            let reader = state.clone();
            let line = run_blocking(move || reader.inventory.petty_cash_position())
                .await?
                .code_above_minor;
            if request.amount_minor > line {
                Some(
                    use_expense_code(&state, &code, &request)
                        .await
                        .map_err(ApiError)?,
                )
            } else {
                None
            }
        }
        None => None,
    };
    let recorded = run_blocking(move || state.inventory.record_expense(request, approval)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(recorded)?)))
}

/// Where head office is, for a call that has to reach it now.
fn head_office(state: &EdgeState) -> Result<(String, String), EdgeError> {
    let Some(sync) = state.sync.as_ref() else {
        return Err(EdgeError::Upstream(
            "This shop cannot reach head office to check the code.".into(),
        ));
    };
    let Some((base, key)) = sync.cloud() else {
        return Err(EdgeError::Configuration(
            "SYNC_UPLOAD_URL is empty, so head office cannot be reached".into(),
        ));
    };
    Ok((base.to_string(), key.to_string()))
}

/// Check Finance's code at the centre and use it up for this expense.
///
/// The expense's idempotency key travels with it, so a retry of the same
/// expense is answered as already used by it rather than refused.
async fn use_expense_code(
    state: &EdgeState,
    code: &str,
    request: &crate::edge::petty::RecordExpenseRequest,
) -> Result<crate::edge::petty::ExpenseApproval, EdgeError> {
    let (base, key) = head_office(state)?;
    let node = state.inventory.node();
    let body = json!({
        "origin_id": &node.node_id,
        "site_id": node.site_id.as_str(),
        "actor_id": &request.actor_id,
        "code": code,
        "amount_minor": request.amount_minor,
        "expense_key": &request.idempotency_key,
    });
    let (status, parsed) = relay_exchange(
        relay_client()?
            .post(format!("{base}/api/v1/sync/expense-codes/use"))
            .header(relay::SYNC_KEY_HEADER, key)
            .json(&body),
    )
    .await?;
    if !status.is_success() {
        return Err(relay_refusal(
            status,
            &parsed,
            "Head office refused the code.",
        ));
    }
    if let Some(line) = parsed.get("code_above_minor").and_then(Value::as_i64) {
        let learner = state.inventory.clone();
        // Best effort: the code is already used, and the line is a cache.
        let _ = tokio::task::spawn_blocking(move || learner.learn_expense_code_line(line)).await;
    }
    Ok(crate::edge::petty::ExpenseApproval {
        code: code.to_owned(),
        issued_by: parsed
            .get("issued_by")
            .and_then(Value::as_str)
            .unwrap_or("finance")
            .to_owned(),
    })
}

/// Ask the centre for the expense-code line and keep it. Quietly does nothing
/// when head office cannot be reached: the node keeps the last line it knew.
async fn learn_expense_code_line(state: EdgeState) {
    let Ok((base, key)) = head_office(&state) else {
        return;
    };
    let Ok(client) = relay_client() else {
        return;
    };
    let node = state.inventory.node();
    let body = json!({
        "origin_id": &node.node_id,
        "site_id": node.site_id.as_str(),
    });
    let Ok((status, parsed)) = relay_exchange(
        client
            .post(format!("{base}/api/v1/sync/expense-codes/line"))
            .header(relay::SYNC_KEY_HEADER, key)
            .json(&body),
    )
    .await
    else {
        return;
    };
    if !status.is_success() {
        return;
    }
    if let Some(line) = parsed.get("code_above_minor").and_then(Value::as_i64) {
        let learner = state.inventory.clone();
        let _ = tokio::task::spawn_blocking(move || learner.learn_expense_code_line(line)).await;
    }
}

// ── the unit's punch station ────────────────────────────────────────────────
//
// On `common_router` rather than the store's, because a DC has staff, shifts
// and a door like every shop does. A warehouse whose people could not clock in
// would be a warehouse whose payroll had no basis.
//
// Nothing here talks to a reader. The hardware agent owns the device boundary
// and exposes local HTTP plus a bounded event cursor; the shell polls that
// cursor and calls these routes with an employee the agent says it identified.
// That split is unchanged from the donor so the shell is a separate port — and
// it is why matching is fail-closed without this file knowing anything about
// it: in mock mode the agent identifies nobody, so nothing arrives here to be
// admitted.

/// Record a punch the reader produced.
///
/// `StoreSale` is the gate — the cashier rung, which is what somebody opening
/// a shop holds — and it is about the *station*, not about whose day it is: the
/// employee comes from the agent's identification, never from a person typing.
/// The actor is overwritten from the principal like every other write on this
/// node, because an actor from a request body is an actor anybody can claim.
async fn attendance_punch(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::attendance::PunchRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreSale)? {
        request.actor_id = principal.username;
    }
    let punched = run_blocking(move || state.inventory.record_punch(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(punched)?)))
}

/// What one person is on today, and what they have punched.
///
/// Answerable with no uplink, which is the whole reason the employee slice is
/// on this box.
async fn attendance_today(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(query): Query<AttendanceTodayQuery>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::StoreSale)?;
    let day = run_blocking(move || {
        state
            .inventory
            .attendance_today(&query.employee_id, query.date)
    })
    .await?;
    Ok(Json(serde_json::to_value(day)?))
}

/// How fresh this box's published book is.
///
/// `InventoryRead` rather than `StoreSale`: it is the station's status line and
/// a manager checking why the reader is refusing people should not need the
/// till's grant to read it.
async fn attendance_book(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let status = run_blocking(move || state.inventory.attendance_book_status()).await?;
    Ok(Json(serde_json::to_value(status)?))
}

#[derive(Debug, Deserialize)]
struct AttendanceTodayQuery {
    employee_id: String,
    /// `YYYY-MM-DD`. Defaults to today, and is explicit for the one case that
    /// needs it: an overnight shift's clock-out belongs to the day the shift
    /// started.
    #[serde(default)]
    date: Option<chrono::NaiveDate>,
}

/// What is in the tin: handed over, spent, left.
async fn store_petty_cash(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    // Refresh the expense-code line in the background; this answer uses the
    // last one known.
    tokio::spawn(learn_expense_code_line(state.clone()));
    let position = run_blocking(move || state.inventory.petty_cash_position()).await?;
    Ok(Json(serde_json::to_value(position)?))
}

/// Record the float head office handed over.
async fn store_petty_cash_top_up(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::petty::PettyCashTopUpRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreSale)? {
        request.actor_id = principal.username;
    }
    let recorded = run_blocking(move || state.inventory.record_petty_cash_top_up(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(recorded)?)))
}

async fn store_close_shift(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(shift_id): Path<String>,
    Json(mut request): Json<crate::edge::till::CloseShiftRequest>,
) -> Result<Json<Value>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::StoreSale)?;
    if let Some(principal) = principal.as_ref() {
        request.actor_id = principal.username.clone();
    }
    request.supervising = supervising(principal.as_ref());
    let report = run_blocking(move || state.inventory.close_shift(&shift_id, request)).await?;
    Ok(Json(blind_for_cashier(
        principal.as_ref(),
        serde_json::to_value(report)?,
    )))
}

/// Count a drawer somebody took the seat from. Its holder counts what they
/// took out; a supervisor may count it for them. Blind like a close.
async fn store_count_shift(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(shift_id): Path<String>,
    Json(mut request): Json<crate::edge::till::CloseShiftRequest>,
) -> Result<Json<Value>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::StoreSale)?;
    if let Some(principal) = principal.as_ref() {
        request.actor_id = principal.username.clone();
    }
    request.supervising = supervising(principal.as_ref());
    let report = run_blocking(move || state.inventory.count_shift(&shift_id, request)).await?;
    Ok(Json(blind_for_cashier(
        principal.as_ref(),
        serde_json::to_value(report)?,
    )))
}

/// Whether the person signed in may act on a drawer that is not theirs: a
/// supervisor or an admin — or a node running with auth off, which has no
/// roles to tell apart.
fn supervising(principal: Option<&EdgePrincipal>) -> bool {
    principal.is_none_or(|principal| principal.role != crate::edge::domain::Role::Cashier)
}

/// The store's till seats and who holds each. Readable by anyone who can see
/// the shop: which seat is free is what a person signing in needs first.
async fn store_till_seats(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let seats = run_blocking(move || state.inventory.till_seats()).await?;
    Ok(Json(serde_json::to_value(seats)?))
}

/// Take a seat — free or held — and open one's own drawer there. No approval:
/// the shift it ends is counted by its own holder (`/shifts/{id}/count`).
async fn store_take_over_seat(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::till::TakeOverRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::StoreSale)?;
    if let Some(principal) = principal.as_ref() {
        request.actor_id = principal.username.clone();
    }
    let outcome = run_blocking(move || state.inventory.take_over_seat(request)).await?;
    let mut outcome = serde_json::to_value(outcome)?;
    // The shift that ended is somebody else's drawer: a cashier arriving
    // reads that it ended, never what it should have held.
    if let Some(fields) = outcome.as_object_mut() {
        for key in ["ended", "shift"] {
            if let Some(report) = fields.remove(key) {
                let report = if report.is_null() {
                    report
                } else {
                    blind_for_cashier(principal.as_ref(), report)
                };
                fields.insert(key.to_string(), report);
            }
        }
    }
    Ok((StatusCode::CREATED, Json(outcome)))
}

#[derive(Debug, Deserialize)]
struct MyShiftsQuery {
    /// Only read with auth off, where there is no principal to name the person.
    #[serde(default)]
    actor_id: Option<String>,
}

/// The drawer the person signed in holds, and the ones taken over from them
/// that they have not counted yet — what a till asks right after sign-in.
async fn store_my_shifts(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(query): Query<MyShiftsQuery>,
) -> Result<Json<Value>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::StoreSale)?;
    let actor = match principal.as_ref() {
        Some(principal) => principal.username.clone(),
        None => query.actor_id.unwrap_or_default(),
    };
    if actor.trim().is_empty() {
        return Err(ApiError(EdgeError::Validation(
            "actor_id is required".into(),
        )));
    }
    let mine = run_blocking(move || state.inventory.my_shifts(&actor)).await?;
    let mut mine = serde_json::to_value(mine)?;
    if let Some(fields) = mine.as_object_mut() {
        if let Some(open) = fields.remove("open") {
            let open = if open.is_null() {
                open
            } else {
                blind_for_cashier(principal.as_ref(), open)
            };
            fields.insert("open".into(), open);
        }
        if let Some(Value::Array(uncounted)) = fields.remove("uncounted") {
            let uncounted = uncounted
                .into_iter()
                .map(|report| blind_for_cashier(principal.as_ref(), report))
                .collect();
            fields.insert("uncounted".into(), Value::Array(uncounted));
        }
    }
    Ok(Json(mine))
}

/// Every drawer open in the store now — the reconciliation screen's question
/// with more than one counter, where "the" open shift no longer exists.
async fn store_open_shifts(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let shifts = run_blocking(move || state.inventory.open_shifts()).await?;
    let shifts = shifts
        .into_iter()
        .map(|report| {
            serde_json::to_value(report).map(|report| blind_for_cashier(principal.as_ref(), report))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(shifts)))
}

/// Every drawer that traded on one business day, open and closed — the sales
/// screen's sessions. The same blind report as the other shift routes: a
/// cashier gets the day's drawers with the expectation withheld.
async fn store_shifts_on(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(query): Query<ShiftsOnQuery>,
) -> Result<Json<Value>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let business_date = chrono::NaiveDate::parse_from_str(query.business_date.trim(), "%Y-%m-%d")
        .map_err(|_| {
            ApiError(EdgeError::Validation(
                "business_date must be a date as YYYY-MM-DD".into(),
            ))
        })?
        .format("%Y-%m-%d")
        .to_string();
    let shifts = run_blocking(move || state.inventory.shifts_on(&business_date)).await?;
    let shifts = shifts
        .into_iter()
        .map(|report| {
            serde_json::to_value(report).map(|report| blind_for_cashier(principal.as_ref(), report))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(shifts)))
}

/// The sales rung on one drawer, with how each was paid.
///
/// Refused to a cashier: a receipt list with its totals and tenders is the
/// expectation written out, which is what a blind close keeps from them.
async fn store_shift_sales(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(shift_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let cashier = principal
        .as_ref()
        .filter(|principal| principal.role == crate::edge::domain::Role::Cashier)
        .map(|principal| principal.username.clone());
    if let Some(username) = cashier {
        // A cashier sees the last three receipts of their OWN drawer — enough to
        // reprint the one just handed over, or return or void it — and never
        // the day's book (client's 7Soft habit, 23 Oct 2026).
        let inventory = state.inventory.clone();
        let id = shift_id.clone();
        let report = run_blocking(move || inventory.shift_report(&id)).await?;
        if report.opened_by != username {
            return Err(ApiError(EdgeError::Forbidden(
                "a cashier sees only the last receipts of their own drawer".into(),
            )));
        }
        let mut sales = run_blocking(move || state.inventory.shift_sales(&shift_id)).await?;
        sales.reverse();
        sales.truncate(3);
        return Ok(Json(serde_json::to_value(sales)?));
    }
    let sales = run_blocking(move || state.inventory.shift_sales(&shift_id)).await?;
    Ok(Json(serde_json::to_value(sales)?))
}

/// Undo a whole sale.
///
/// `StoreSale` rather than a supervisor-only permission: the cashier presses
/// the button with the customer in front of them, and a supervisor walks over
/// to authorise it in the body. Gating the route on a supervisor's role would
/// mean signing the cashier out, which is a queue watching two people type
/// passwords.
async fn store_void_sale(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(sale_id): Path<String>,
    Json(mut request): Json<crate::edge::till::VoidSaleRequest>,
) -> Result<Json<Value>, ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreSale)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.void_sale(&sale_id, request)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// Take back part of a basket. Each unit is scanned, so the shop knows WHICH
/// garment came home rather than merely that one did.
async fn store_return(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::till::ReturnRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreSale)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.return_sale(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// Exchange, no money back (owner, 23 Oct 2026): pieces from one receipt come
/// back and replacement pieces go out, in one transaction. `StoreSale`, like a
/// return: the cashier sends it, the Kepala toko's grant in the body is what
/// authorises it.
async fn store_exchange(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::till::ExchangeRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreSale)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.exchange_sale(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// What the customer walks out with, as data.
///
/// Readable without the till's permission on purpose: anybody trusted to see
/// what the shop sold can be asked "what was on receipt 000123".
async fn store_receipt(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(sale_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let document = run_blocking(move || state.inventory.sale_receipt(&sale_id)).await?;
    Ok(Json(serde_json::to_value(document)?))
}

/// A receipt for the USB printer on a till: rendered here, where every receipt
/// is rendered, and sent by the till, the one party on that printer's cable.
/// The node prints nothing. The bytes come back as hex, which a till decodes
/// without a library.
async fn store_render_receipt(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(sale_id): Path<String>,
    Json(request): Json<crate::edge::till::RenderReceiptRequest>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::StoreSale)?;
    let rendered = run_blocking(move || {
        let document = state.inventory.sale_receipt(&sale_id)?;
        let bytes = crate::edge::till::render_receipt(
            &document,
            request.paper.as_deref(),
            request.drawer.as_deref(),
            request.copy,
        );
        Ok(json!({
            "sale_id": sale_id,
            "receipt_no": document.receipt_no,
            "bytes": bytes.len(),
            "escpos_hex": hex::encode(&bytes),
        }))
    })
    .await?;
    Ok(Json(rendered))
}

async fn store_print_receipt(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(sale_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::StoreSale)?;
    let connection = state.auth.connection();
    let result = run_blocking(move || {
        let request: crate::edge::till::PrintReceiptRequest =
            print_request(with_recorded_printer(&connection, body)?)?;
        state.inventory.print_sale_receipt(&sale_id, request)
    })
    .await?;
    Ok(Json(result))
}

async fn store_offers(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<crate::edge::pricing::StoreOffers>, ApiError> {
    // The same permission the catalogue asks for. Reading what the shop is
    // offering is reading the shop's own book; it takes nothing and changes
    // nothing.
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    Ok(Json(
        run_blocking(move || state.inventory.store_offers()).await?,
    ))
}

/// What one piece of each SKU costs a walk-in shopper this minute.
///
/// Never cached: unlike the catalogue, the answer moves when a promotion's
/// hour starts, with no new publication to say so.
async fn store_final_prices(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<crate::edge::pricing::FinalUnitPrices>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    Ok(Json(
        run_blocking(move || state.inventory.store_final_prices()).await?,
    ))
}

async fn run_blocking<T, F>(operation: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, EdgeError> + Send + 'static,
{
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|error| ApiError(EdgeError::Persistence(error.to_string())))?
        .map_err(ApiError)
}

struct ApiError(EdgeError);

impl From<serde_json::Error> for ApiError {
    fn from(error: serde_json::Error) -> Self {
        Self(EdgeError::Persistence(error.to_string()))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            EdgeError::Validation(_) => StatusCode::BAD_REQUEST,
            EdgeError::NotFound(_) => StatusCode::NOT_FOUND,
            EdgeError::Conflict(_) => StatusCode::CONFLICT,
            EdgeError::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            EdgeError::Forbidden(_) => StatusCode::FORBIDDEN,
            // A relay that cannot reach head office is not this node's fault and
            // not the request's: 503 is what tells a client to try the same
            // thing again when the line comes back.
            EdgeError::Upstream(_) => StatusCode::SERVICE_UNAVAILABLE,
            EdgeError::Configuration(_) | EdgeError::Persistence(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        (status, Json(json!({"error":self.0.to_string()}))).into_response()
    }
}

/// A cashier who closed a till today does not sign in at it again (client,
/// 23 Oct 2026): "{name} sudah tutup kasir hari ini"; nor does somebody head
/// office stopped on the POS (0990). Only when the till names its seat, and
/// only at a store.
async fn refuse_closed_at_till(
    state: &EdgeState,
    username: &str,
    terminal: Option<String>,
) -> Result<(), ApiError> {
    let Some(terminal) = terminal
        .map(|terminal| terminal.trim().to_string())
        .filter(|terminal| !terminal.is_empty())
    else {
        return Ok(());
    };
    if state.inventory.node().role != EdgeRole::Store {
        return Ok(());
    }
    let connection = state.auth.connection();
    let now = state.inventory.clock().now();
    let username = username.to_string();
    run_blocking(move || {
        let guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        crate::edge::till::refuse_closed_today(&guard, &username, &terminal, now)?;
        // Head office stopped this person on the POS (0990): no sign-in at a
        // till, unless they still hold a drawer to count and close.
        if crate::edge::pos_stop::person_stop(&guard, &username).is_some()
            && !crate::edge::pos_stop::holds_open_drawer(&guard, &username)
        {
            return Err(EdgeError::Forbidden(
                "Akses POS Anda dihentikan kantor pusat.".into(),
            ));
        }
        Ok(())
    })
    .await
}

async fn login(
    State(state): State<EdgeState>,
    Json(request): Json<LoginRequest>,
) -> Result<Response, ApiError> {
    let auth = state.auth.clone();
    let terminal = request.terminal_id.clone();
    let issued = run_blocking(move || auth.login(&request.username, &request.password)).await?;
    // Checked after the password, so the refusal tells a stranger nothing.
    if let Err(refused) =
        refuse_closed_at_till(&state, &issued.principal.username, terminal).await
    {
        let auth = state.auth.clone();
        let session_id = issued.principal.session_id;
        let _ = run_blocking(move || auth.logout(session_id)).await;
        return Err(refused);
    }
    let max_age = state.auth.config().session_ttl_minutes * 60;
    // Both cookies are formatted before the body takes ownership of the token.
    let session_cookie = security::set_cookie(
        SESSION_COOKIE,
        &issued.token,
        max_age,
        state.auth.config().cookie_secure,
        true,
    );
    let csrf_cookie = security::set_cookie(
        CSRF_COOKIE,
        &issued.csrf_token,
        max_age,
        state.auth.config().cookie_secure,
        false,
    );
    let mut response = Json(LoginResponse {
        token: issued.token,
        token_type: "Bearer".to_owned(),
        expires_at_epoch: issued.expires_at.timestamp(),
        user: SessionUser {
            id: issued.principal.user_id,
            username: issued.principal.username,
            display_name: issued.principal.display_name,
            role: issued.principal.role.into(),
            // Which identity store this session came from: an Edge-local
            // break-glass account, or a Cloud projection.
            source: Some(issued.principal.source),
            role_code: None,
            role_name: None,
            sections: None,
            read_only: None,
        },
    })
    .into_response();
    prevent_auth_caching(&mut response);
    append_cookie(&mut response, session_cookie)?;
    append_cookie(&mut response, csrf_cookie)?;
    Ok(response)
}

#[derive(Debug, Deserialize)]
struct EdgeSsoExchangeRequest {
    ticket: String,
}

/// Redeem a signed Cloud ticket without setting either colliding auth cookie.
/// The hub posts with `credentials: omit` and keeps the returned bearer token
/// in its tab-scoped Edge session store.
async fn edge_sso_exchange(
    State(state): State<EdgeState>,
    Json(request): Json<EdgeSsoExchangeRequest>,
) -> Result<Response, ApiError> {
    let auth = state.auth.clone();
    let issued = run_blocking(move || auth.exchange_cloud_ticket(&request.ticket)).await?;
    let mut response = Json(LoginResponse {
        token: issued.token,
        token_type: "Bearer".to_owned(),
        expires_at_epoch: issued.expires_at.timestamp(),
        user: SessionUser {
            id: issued.principal.user_id,
            username: issued.principal.username,
            display_name: issued.principal.display_name,
            role: issued.principal.role.into(),
            source: Some(issued.principal.source),
            role_code: None,
            role_name: None,
            sections: None,
            read_only: None,
        },
    })
    .into_response();
    prevent_auth_caching(&mut response);
    Ok(response)
}

/// What this node's outbox is doing.
///
/// Readable by any signed-in operator rather than a supervisor only: the
/// person who most needs to know whether today's takings have left the
/// building is the one standing at the till when the line goes down.
async fn sync_status(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<EdgeSyncStatus>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    if let Some(handle) = state.sync.clone() {
        return Ok(Json(run_blocking(move || handle.status()).await?));
    }
    // No sender configured. Capture still runs and the backlog is still
    // durable, so the counts are real and worth showing — what is missing is
    // anywhere for them to go, and saying "0 failures" here would read as
    // healthy.
    let connection = state.auth.connection();
    let status = run_blocking(move || {
        let connection = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        let (durable_through, pending_facts, dead_lettered) =
            crate::edge::sync::backlog(&connection)
                .map_err(|error| EdgeError::Persistence(error.to_string()))?;
        // The origin is read even here. A node with no sender still captures
        // under a generation and a seq, and those two numbers are what a
        // person compares against the cloud's own list when they suspect the
        // two ends are describing different streams.
        let stream: Option<(i64, i64)> =
            rusqlite::OptionalExtension::optional(connection.query_row(
                "SELECT generation, next_seq FROM sync_origin WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ))
            .map_err(|error| EdgeError::Persistence(error.to_string()))?;
        Ok(EdgeSyncStatus {
            origin_id: None,
            generation: stream.map_or(0, |(generation, _)| generation),
            next_seq: stream.map_or(0, |(_, next_seq)| next_seq),
            // Nothing to agree with: there is no receiver configured.
            handshake_settled: false,
            handshake_at: None,
            handshake_note: None,
            pending_facts,
            durable_through,
            dead_lettered,
            consecutive_failures: 0,
            breaker_open_until: None,
            last_success_at: None,
            last_error: None,
            last_error_at: None,
            sender_enabled: false,
            upload_url: None,
            interval_seconds: None,
        })
    })
    .await?;
    Ok(Json(status))
}

/// Send the backlog now instead of waiting out the interval.
///
/// Answers whether it did anything rather than always reporting success: on a
/// node with no sender there is nothing to wake, and a button that silently
/// does nothing is worse than one that says so.
async fn sync_trigger(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<EdgeSyncTriggered>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    Ok(Json(match state.sync.as_ref() {
        Some(handle) => {
            handle.trigger();
            EdgeSyncTriggered {
                triggered: true,
                reason: None,
            }
        }
        None => EdgeSyncTriggered {
            triggered: false,
            reason: Some(
                "this node has no sync sender: SYNC_UPLOAD_URL is unset, so capture \
                 continues locally and nothing is uploaded"
                    .into(),
            ),
        },
    }))
}

// ════════════════════════════════════════════════════════════════════════════
// The virtual business clock (VIRTUAL-TIME-PLAN.md §8)
// ════════════════════════════════════════════════════════════════════════════

/// Whether the test-control surface answers. Read from the environment at
/// boot, fail-closed: a node that was never told its database is disposable
/// refuses to move time, in production and by accident alike. The same gate
/// `cloud/http/control.rs` keeps for the cloud's own corruption probes.
fn test_controls_enabled() -> bool {
    std::env::var("INVENTORY_ENABLE_TEST_CONTROLS")
        .map(|value| value.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn require_test_controls(state: &EdgeState) -> Result<(), ApiError> {
    if state.test_controls {
        Ok(())
    } else {
        Err(ApiError(EdgeError::Forbidden(
            "test controls are disabled; set INVENTORY_ENABLE_TEST_CONTROLS=true only in a \
             disposable environment"
                .into(),
        )))
    }
}

/// Where the business clock now stands: mode, anchors, factor, and the real
/// and virtual instants. The question a rig asks most is "what date is it".
async fn clock_status(State(state): State<EdgeState>) -> Result<Json<ClockStatus>, ApiError> {
    require_test_controls(&state)?;
    Ok(Json(state.clock.status()))
}

/// One named operation on this node's clock. The request shape and the
/// backward rule are the cloud's (`cloud/http/clock.rs`) — one wire contract,
/// so a rig script re-anchors every node with the same body. A backward move
/// is permitted ONLY under the `controlled` mode, where the database is
/// disposable by definition; the rule reads the clock's own mode, never the
/// caller's enthusiasm (plan §7.2).
async fn clock_control(
    State(state): State<EdgeState>,
    Json(request): Json<ClockControlRequest>,
) -> Result<Json<ClockStatus>, ApiError> {
    require_test_controls(&state)?;
    let before = state.clock.status();
    let backward_permitted = |source: &ClockMode, prospective: &ClockMode| {
        matches!(source, ClockMode::Controlled { .. })
            || matches!(prospective, ClockMode::Controlled { .. })
    };
    let map_clock_error = |error: ClockError| match error {
        ClockError::Validation(message) => ApiError(EdgeError::Validation(message)),
        // A backward move conflicts with what the clock already said and with
        // the date-keyed documents already on disk (plan §7.2).
        ClockError::BackwardJump { current, attempted } => ApiError(EdgeError::Conflict(format!(
            "the business clock cannot move backwards from {current} to {attempted}; re-anchor \
             forward, rescale, or use the controlled mode on a disposable database"
        ))),
    };
    let status = match &request {
        ClockControlRequest::SetMode { mode } => state
            .clock
            .set_mode(mode.clone(), backward_permitted(&before.source, mode))
            .map_err(map_clock_error)?,
        ClockControlRequest::Rescale { factor } => {
            state.clock.rescale(*factor).map_err(map_clock_error)?
        }
        ClockControlRequest::Pause => state.clock.pause().map_err(map_clock_error)?,
        ClockControlRequest::Resume => state.clock.resume().map_err(map_clock_error)?,
        ClockControlRequest::AdvanceTo { at } => state
            .clock
            .advance_to(*at, backward_permitted(&before.source, &before.source))
            .map_err(map_clock_error)?,
    };
    Ok(Json(status))
}

/// Who is signed in.
///
/// The principal is optional here because the middleware does not insert one
/// when authentication is switched off — a bench, a demo, a recovery. Every
/// other handler already copes with that through `require_permission`, and
/// this one answering 500 meant the whole warehouse surface was unusable in
/// the one mode that exists so a person can run it without an account.
///
/// The development identity is named as such rather than borrowing somebody's
/// login: a screen showing "Development" is telling the truth about a node
/// that is not checking anything.
async fn me(principal: Option<Extension<EdgePrincipal>>) -> Json<EdgeMe> {
    match principal {
        Some(Extension(principal)) => Json(EdgeMe {
            id: principal.user_id,
            username: principal.username,
            display_name: principal.display_name,
            role: principal.role.into(),
            source: principal.source,
            site_id: None,
        }),
        None => Json(EdgeMe {
            id: Uuid::nil(),
            username: "development".to_owned(),
            display_name: "Development".to_owned(),
            role: crate::contract::Role::Admin,
            source: "DEVELOPMENT".to_owned(),
            site_id: None,
        }),
    }
}

async fn logout(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Response, ApiError> {
    // Signing out of a node that never signed anybody in is not an error: the
    // browser still wants its cookies cleared and its screen returned to the
    // sign-in box.
    if let Some(Extension(principal)) = principal {
        let auth = state.auth.clone();
        run_blocking(move || auth.logout(principal.session_id)).await?;
    }
    cleared_auth_response(&state, json!({"signed_out":true}))
}

/// Refused before anything is read: only a Kepala toko — a supervisor or
/// above — may see whom she could open a till for.
fn store_head(
    state: &EdgeState,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<EdgePrincipal, ApiError> {
    let head = require_permission(state, principal, EdgePermission::InventoryRead)?.ok_or_else(
        || {
            ApiError(EdgeError::Conflict(
                "authentication is disabled on this Edge".into(),
            ))
        },
    )?;
    if head.role < crate::edge::domain::Role::Supervisor {
        return Err(ApiError(EdgeError::Forbidden(
            "only a store head may open a till for somebody else".into(),
        )));
    }
    Ok(head)
}

/// The people a signed-in Kepala toko may open this till for.
async fn till_people(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    store_head(&state, principal)?;
    let auth = state.auth.clone();
    let people = run_blocking(move || auth.till_people()).await?;
    Ok(Json(json!({ "items": people })))
}

#[derive(Debug, Deserialize)]
struct OnBehalfRequest {
    username: String,
    /// The seat, so a cashier who closed it today is refused.
    #[serde(default)]
    terminal_id: Option<String>,
}

/// Open this till for `username`: the answer is that person's session, the
/// same token a password or a finger would have issued, and the head's own
/// session is over.
async fn open_on_behalf(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(request): Json<OnBehalfRequest>,
) -> Result<Response, ApiError> {
    let head = store_head(&state, principal)?;
    let opened_by = head.username.clone();
    refuse_closed_at_till(
        &state,
        &request.username.trim().to_ascii_lowercase(),
        request.terminal_id.clone(),
    )
    .await?;
    let auth = state.auth.clone();
    let issued = run_blocking(move || auth.open_on_behalf(&head, &request.username)).await?;
    tracing::info!(
        opened_by = %opened_by,
        cashier = %issued.principal.username,
        "till opened on behalf of a cashier"
    );
    let mut response = Json(json!({
        "token": issued.token,
        "token_type": "Bearer",
        "expires_at_epoch": issued.expires_at.timestamp(),
        "username": issued.principal.username,
        "display_name": issued.principal.display_name,
        "opened_by": opened_by,
    }))
    .into_response();
    prevent_auth_caching(&mut response);
    Ok(response)
}

async fn change_password(
    State(state): State<EdgeState>,
    Extension(principal): Extension<EdgePrincipal>,
    Json(request): Json<ChangePasswordRequest>,
) -> Result<Response, ApiError> {
    let auth = state.auth.clone();
    let user_id = principal.user_id;
    run_blocking(move || {
        auth.change_local_password(user_id, &request.current_password, &request.new_password)
    })
    .await?;
    cleared_auth_response(&state, json!({"changed":true,"signed_out":true}))
}

fn cleared_auth_response(state: &EdgeState, value: Value) -> Result<Response, ApiError> {
    let mut response = Json(value).into_response();
    prevent_auth_caching(&mut response);
    append_cookie(
        &mut response,
        security::clear_cookie(SESSION_COOKIE, state.auth.config().cookie_secure, true),
    )?;
    append_cookie(
        &mut response,
        security::clear_cookie(CSRF_COOKIE, state.auth.config().cookie_secure, false),
    )?;
    Ok(response)
}

/// Name a batch of SKUs in one call.
///
/// `?skus=a,b,c`. The handheld decodes SKUs out of the EPCs locally and asks
/// here once per sweep for the distinct ones, so a rack of fifty tags costs one
/// request rather than fifty.
async fn catalog_identities(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(query): Query<CatalogIdentityQuery>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let codes: Vec<String> = query
        .skus
        .split(',')
        .map(|code| code.trim().to_string())
        .filter(|code| !code.is_empty())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let items = run_blocking(move || state.inventory.catalog_identities(&codes)).await?;
    Ok(Json(json!({ "items": items })))
}

#[derive(serde::Deserialize)]
struct CatalogIdentityQuery {
    #[serde(default)]
    skus: String,
}

/// What generation of the catalogue this node is holding.
///
/// The one request a handheld makes on waking. It compares the generation with
/// what its own SQLite holds and, nine mornings out of ten, does nothing more.
/// A node with no catalogue answers generation 0 and an empty hash rather than
/// 404 — see `EdgeInventory::catalog_snapshot_state` for why the difference
/// matters to the device.
async fn catalog_snapshot(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let snapshot = run_blocking(move || state.inventory.catalog_snapshot_state()).await?;
    Ok(Json(json!({
        "generation": snapshot.generation,
        "item_count": snapshot.item_count,
        "content_hash": snapshot.content_hash,
        "activated_at": snapshot.activated_at,
    })))
}

/// The catalogue itself, keyset-paged, for a handheld to store locally.
///
/// `generation` is on every page and not only on the first. A device that
/// starts its walk at generation 7 and reads 8 on page four has been handed
/// halves of two different catalogues — the swap is a whole-table replace, so
/// the pages after it may silently skip SKUs the earlier ones would have
/// carried, and nothing in the rows themselves says which publication they came
/// out of. Repeating the
/// generation is what lets the device notice and start the walk again, instead
/// of committing a spliced catalogue that looks complete and prices a range
/// nobody published.
async fn catalog_snapshot_items(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(query): Query<crate::edge::CatalogSnapshotQuery>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let page = run_blocking(move || state.inventory.catalog_snapshot_items(query)).await?;
    Ok(Json(json!({
        "items": page.items,
        "next_cursor": page.next_cursor,
        "generation": page.generation,
    })))
}

/// One HTTP client for image fetches, kept for its connection pool.
///
/// Building a client per request throws away the pooled TLS connection every
/// time, which on a node serving a floor of handhelds is the whole cost.
fn image_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
}

type CachedImage = (String, axum::body::Bytes);

fn image_cache() -> &'static std::sync::Mutex<BTreeMap<String, CachedImage>> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<BTreeMap<String, CachedImage>>> =
        std::sync::OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(BTreeMap::new()))
}

fn image_cache_get(url: &str) -> Option<CachedImage> {
    image_cache().lock().ok()?.get(url).cloned()
}

fn image_cache_put(url: &str, content_type: &str, bytes: &axum::body::Bytes) {
    // Bounded so a node cannot be walked into swapping by asking for one
    // photograph after another. Catalogue imagery is small and repeats hard;
    // when the ceiling is hit the map is dropped rather than evicted one by
    // one, because a cold cache costs one fetch and a clever eviction policy
    // costs a bug.
    const MAX_ENTRIES: usize = 256;
    if let Ok(mut cache) = image_cache().lock() {
        if cache.len() >= MAX_ENTRIES {
            cache.clear();
        }
        cache.insert(url.to_string(), (content_type.to_string(), bytes.clone()));
    }
}

/// Serve a catalogue photograph through the node.
///
/// # Why the Edge fetches it and the handheld does not
///
/// The imagery lives on an object-store subdomain that Indonesian ISPs
/// redirect to a content-block page: the same URL that returns a JPEG from one
/// network returns a block notice from another, so a handheld on shop wifi
/// shows empty tiles while nothing is wrong with the app. The Edge is not on
/// that network, and the handheld is already talking to the Edge, so the
/// picture arrives over a connection that is known to work.
///
/// It also stops fifty handhelds each pulling the same photograph over a
/// shop's uplink: one node fetches, and the answer is cacheable.
async fn catalog_image(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(query): Query<CatalogImageQuery>,
) -> Result<Response, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let sku = query.sku.trim().to_string();
    if sku.is_empty() {
        return Err(ApiError(EdgeError::Validation("sku is required".into())));
    }
    let inventory = state.inventory.clone();
    let codes = vec![sku.clone()];
    let items = run_blocking(move || inventory.catalog_identities(&codes)).await?;
    let url = items
        .first()
        .and_then(|item| item.image_url.clone())
        .ok_or_else(|| ApiError(EdgeError::NotFound(format!("no image for {sku}"))))?;
    proxy_image(&url).await
}

/// A campaign's banner, through the same proxy as a garment's photograph.
///
/// A campaign's picture is one image shown to everyone in the shop, so it is
/// the single most worthwhile thing in this cache: every tablet on the floor
/// draws the same Lebaran poster, and without the proxy every one of them would
/// pull it over the shop's uplink separately.
///
/// Read from the resident row, so it keeps working with the line to the centre
/// down for as long as the process has held it.
async fn campaign_image(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Query(query): Query<CampaignImageQuery>,
) -> Result<Response, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let campaign = query.campaign.trim().to_string();
    if campaign.is_empty() {
        return Err(ApiError(EdgeError::Validation(
            "campaign is required".into(),
        )));
    }
    let inventory = state.inventory.clone();
    let wanted = campaign.clone();
    let url = run_blocking(move || inventory.campaign_image_url(&wanted))
        .await?
        .ok_or_else(|| ApiError(EdgeError::NotFound(format!("no banner for {campaign}"))))?;
    proxy_image(&url).await
}

#[derive(serde::Deserialize)]
struct CampaignImageQuery {
    #[serde(default)]
    campaign: String,
}

/// Fetch a picture once for the whole shop, and hold it.
///
/// Shared by the garment photographs and the campaign banners because it is
/// the same job: the URL points at the centre, the shop's uplink is the scarce
/// thing, and every screen on the floor wants the same bytes.
async fn proxy_image(url: &str) -> Result<Response, ApiError> {
    // Fetched once per URL for the life of the process. A colourway shares one
    // photograph across every size, so a shop's whole catalogue is a handful of
    // pictures — and without this every handheld on the floor would pull each
    // one again over the same uplink.
    let (content_type, bytes) = if let Some(hit) = image_cache_get(url) {
        hit
    } else {
        let response = image_client()
            .get(url)
            .timeout(std::time::Duration::from_secs(20))
            .send()
            .await
            .map_err(|error| ApiError(EdgeError::Persistence(format!("image fetch: {error}"))))?;
        if !response.status().is_success() {
            return Err(ApiError(EdgeError::NotFound(format!(
                "image source answered {}",
                response.status()
            ))));
        }
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("image/jpeg")
            .to_string();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| ApiError(EdgeError::Persistence(format!("image body: {error}"))))?;
        image_cache_put(url, &content_type, &bytes);
        (content_type, bytes)
    };
    let mut headers = HeaderMap::new();
    if let Ok(value) = HeaderValue::from_str(&content_type) {
        headers.insert(header::CONTENT_TYPE, value);
    }
    // A photograph is re-shot only when the garment is, which is rare enough to
    // be worth a cache purge rather than a short lifetime.
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=86400"),
    );
    Ok((StatusCode::OK, headers, bytes).into_response())
}

#[derive(serde::Deserialize)]
struct CatalogImageQuery {
    #[serde(default)]
    sku: String,
}

/// What is being worked on right now, so somebody arriving can choose.
async fn rfid_sessions(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let rfid = state.rfid.clone();
    let items = run_blocking(move || rfid.recent_sessions(50)).await?;
    Ok(Json(json!({ "items": items })))
}

/// What one shared session has found so far, across every reader in it.
///
/// Open to any signed-in operator with inventory read: the people helping with
/// a count need to see the same number, and a session is not a secret.
async fn rfid_session(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let rfid = state.rfid.clone();
    let summary = run_blocking(move || rfid.session(&session_id)).await?;
    Ok(Json(serde_json::to_value(summary).map_err(|error| {
        ApiError(EdgeError::Persistence(error.to_string()))
    })?))
}

async fn rfid_observations(
    State(state): State<EdgeState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let device_id = required_header(&headers, "x-device-id")?;
    let timestamp = required_header(&headers, "x-device-timestamp")?
        .parse::<i64>()
        .map_err(|_| ApiError(EdgeError::Unauthorized("invalid RFID timestamp".into())))?;
    let sequence = required_header(&headers, "x-device-sequence")?
        .parse::<i64>()
        .map_err(|_| ApiError(EdgeError::Unauthorized("invalid RFID sequence".into())))?;
    let signature = required_header(&headers, "x-device-signature")?;

    // Device proof is mandatory. A human bearer session is optional evidence
    // for audit attribution and never replaces the device credential — and
    // never refuses it either. A session that expired, was revoked, or lacks
    // RfidObserve is attribution that could not be made, not a reason to
    // turn away reads the device itself signed: refusing them stopped a
    // handheld's evidence until somebody signed in again, while the device's
    // own credential was valid the whole time. The batch is filed with no
    // operator, and the reason is logged.
    let operator_id = if let Some(token) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.is_empty())
    {
        let auth = state.auth.clone();
        let token = token.to_string();
        let attributed = run_blocking(move || {
            let (principal, _) = auth.authenticate(&token, false)?;
            principal.require(EdgePermission::RfidObserve)?;
            Ok(principal.user_id.to_string())
        })
        .await;
        match attributed {
            Ok(operator_id) => Some(operator_id),
            Err(ApiError(error)) => {
                tracing::warn!(
                    device_id = %device_id,
                    %error,
                    "RFID batch bearer not accepted for attribution; filed with no operator"
                );
                None
            }
        }
    } else {
        None
    };
    let rfid = state.rfid.clone();
    let raw_body = body.to_vec();
    let response = run_blocking(move || {
        rfid.ingest(
            DeviceProof {
                device_id,
                timestamp,
                sequence,
                signature,
            },
            &raw_body,
            operator_id,
        )
    })
    .await?;
    Ok((StatusCode::CREATED, Json(response)))
}

/// A reader saying it is alive, with its battery and app version when it
/// knows them (`EdgeRfid::ping`). Proven by the device's own signature, like a
/// batch; no session.
async fn rfid_ping(
    State(state): State<EdgeState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let device_id = required_header(&headers, "x-device-id")?;
    let timestamp = required_header(&headers, "x-device-timestamp")?
        .parse::<i64>()
        .map_err(|_| ApiError(EdgeError::Unauthorized("invalid RFID timestamp".into())))?;
    let sequence = required_header(&headers, "x-device-sequence")?
        .parse::<i64>()
        .map_err(|_| ApiError(EdgeError::Unauthorized("invalid RFID sequence".into())))?;
    let signature = required_header(&headers, "x-device-signature")?;
    let rfid = state.rfid.clone();
    let raw_body = body.to_vec();
    let response = run_blocking(move || {
        rfid.ping(
            DeviceProof {
                device_id,
                timestamp,
                sequence,
                signature,
            },
            &raw_body,
        )
    })
    .await?;
    Ok(Json(response))
}

async fn require_auth(
    State(state): State<EdgeState>,
    mut request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    if !state.auth.enabled() {
        return Ok(next.run(request).await);
    }
    let path = request.uri().path();
    // Routes a till speaks before anybody has signed in, or with no bearer at
    // all. The claim and roster routes carry their own credential — the
    // handlers verify the terminal's signature over the method, path, clock,
    // sequence and body themselves — so demanding a session here would be a
    // door with no key the till is allowed to hold: the sign-in these routes
    // exist to perform is the thing that mints one. `auth_methods` is the one
    // split case: its GET is open by design (one word of shop configuration,
    // asked before anybody is signed in), while its POST — which changes what
    // the whole shop accepts — stays behind this middleware and behind the
    // `AuthAdmin` check inside the handler.
    //
    // A till that has not joined yet is in the same position: it asks who
    // this node is, asks to join, and asks whether it was let in, all before
    // it holds anything to authenticate with. Its status poll carries a proof
    // made with the key it minted; its later peripherals report is signed
    // like a claim. See `edge/devices.rs`.
    let open = matches!(
        path,
        "/api/v1/health"
            | "/api/v1/auth/login"
            | "/api/v1/auth/sso/exchange"
            | "/api/v1/node/identity"
            | RFID_OBSERVATION_PATH
            | RFID_PING_PATH
    ) || matches!(
        (request.method().as_str(), path),
        (
            "GET",
            "/api/v1/auth/methods"
                | "/api/v1/auth/fingerprints/roster"
                | "/api/v1/till/standing"
                | SELF_REQUESTS_PATH
        ) | (
            "POST",
            "/api/v1/auth/fingerprints/claim"
                | "/api/v1/auth/fingerprints/benefit"
                | "/api/v1/auth/pin/claim"
                | "/api/v1/devices/join"
                | "/api/v1/devices/join/status"
                | "/api/v1/devices/self/peripherals"
                | SELF_TEST_PRINT_RESULT_PATH
        )
    );
    if !path.starts_with("/api/") || open {
        return Ok(next.run(request).await);
    }
    let bearer = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let cookie = request
        .headers()
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| security::cookie_value(value, SESSION_COOKIE));
    let (token, cookie_auth) = match (bearer, cookie) {
        (Some(token), _) if !token.is_empty() => (token.to_string(), false),
        (_, Some(token)) if !token.is_empty() => (token, true),
        _ => return Err(ApiError(EdgeError::Unauthorized("missing session".into()))),
    };
    let auth = state.auth.clone();
    let (principal, csrf_hash) =
        run_blocking(move || auth.authenticate(&token, cookie_auth)).await?;
    if cookie_auth && !matches!(request.method().as_str(), "GET" | "HEAD" | "OPTIONS") {
        let header_token = request
            .headers()
            .get("x-csrf-token")
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| ApiError(EdgeError::Forbidden("missing CSRF token".into())))?;
        let cookie_token = request
            .headers()
            .get(header::COOKIE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| security::cookie_value(value, CSRF_COOKIE))
            .ok_or_else(|| ApiError(EdgeError::Forbidden("missing CSRF cookie".into())))?;
        if !security::constant_time_eq(header_token, &cookie_token)
            || !security::constant_time_eq(&security::sha256_hex(header_token), &csrf_hash)
        {
            return Err(ApiError(EdgeError::Forbidden("invalid CSRF token".into())));
        }
    }
    request.extensions_mut().insert(principal);
    Ok(next.run(request).await)
}

// ════════════════════════════════════════════════════════════════════════════
// A finger opens a till, and authorises a void
// ════════════════════════════════════════════════════════════════════════════

/// Read a terminal's proof off the headers.
///
/// Header-borne rather than in the body, for the same reason the RFID lane does
/// it: the signature covers the body, so it cannot live inside what it signs.
fn terminal_proof(
    headers: &HeaderMap,
) -> Result<crate::edge::fingerprint::TerminalProof, ApiError> {
    let bad = |what: &str| ApiError(EdgeError::Unauthorized(format!("invalid terminal {what}")));
    Ok(crate::edge::fingerprint::TerminalProof {
        terminal_id: required_header(headers, "x-terminal-id")?,
        timestamp: required_header(headers, "x-terminal-timestamp")?
            .parse::<i64>()
            .map_err(|_| bad("timestamp"))?,
        sequence: required_header(headers, "x-terminal-sequence")?
            .parse::<i64>()
            .map_err(|_| bad("sequence"))?,
        signature: required_header(headers, "x-terminal-signature")?,
    })
}

/// Pair a counter terminal with this node.
///
/// `AuthAdmin`, and nothing less: pairing grants a machine the standing to say
/// who is pressing a finger on it. That is the same weight as creating a user,
/// and it is done once, by whoever installs the till.
async fn pair_terminal(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(request): Json<serde_json::Value>,
) -> Result<Json<Value>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::AuthAdmin)?;
    let actor = principal.map(|who| who.username).unwrap_or_default();
    let label = request
        .get("label")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let connection = state.auth.connection();
    let paired = run_blocking(move || {
        let guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        crate::edge::fingerprint::pair_terminal(&guard, &label, &actor)
    })
    .await?;
    Ok(Json(serde_json::to_value(paired).map_err(|error| {
        ApiError(EdgeError::Persistence(error.to_string()))
    })?))
}

/// Record a finger against a user.
///
/// An enrolment is an authorisation to open a till, and a shop where a cashier
/// can enrol their own supervisor's finger is a shop with no supervisor. So a
/// cashier never enrols. An admin enrols anybody. A store head (`SUPERVISOR`)
/// enrols at the till itself (Till devices → Fingerprint), and only a cashier
/// or her own finger: a cashier's finger opens nothing she cannot already open
/// for that cashier ("Buka kasir atas nama"), while another supervisor's finger
/// would be a second supervisor's approvals in her hand.
async fn enrol_fingerprint(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(request): Json<crate::edge::fingerprint::EnrolRequest>,
) -> Result<Json<Value>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::DeviceAdmin)?;
    let head_only = principal
        .as_ref()
        .is_some_and(|who| who.role < crate::edge::domain::Role::Admin);
    let actor = principal.map(|who| who.username).unwrap_or_default();
    let connection = state.auth.connection();
    let enrolled = run_blocking(move || {
        let guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        // HR enrols a person's fingers when it registers them, and they
        // arrive here from head office (owner, 24 Oct 2026;
        // `fingerprint::spawn_head_office_pull`). An admin — IT at the shop —
        // may still enrol one here when HR could not.
        if head_only {
            return Err(EdgeError::Forbidden(
                "Sidik jari didaftarkan HR saat mendaftarkan karyawan.".into(),
            ));
        }
        crate::edge::fingerprint::enrol(&guard, request, &actor)
    })
    .await?;
    Ok(Json(serde_json::to_value(enrolled).map_err(|error| {
        ApiError(EdgeError::Persistence(error.to_string()))
    })?))
}

async fn retire_fingerprint(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(finger_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    require_permission(&state, principal, EdgePermission::AuthAdmin)?;
    let connection = state.auth.connection();
    run_blocking(move || {
        let guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        crate::edge::fingerprint::retire(&guard, &finger_id)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The fingers that may open this shop's tills.
///
/// Answered to a terminal's own credential and to nothing else — not to a
/// signed-in person. That is the point: this is the call a till makes *before*
/// anybody has signed in, and a bearer session is exactly what it does not have.
async fn fingerprint_roster(
    State(state): State<EdgeState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let proof = terminal_proof(&headers)?;
    let connection = state.auth.connection();
    // A GET signs the empty body, so both ends agree on what "no body" hashes
    // to rather than one of them inventing a placeholder.
    let digest = crate::security::sha256_hex(b"");
    let entries = run_blocking(move || {
        let mut guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        crate::edge::fingerprint::roster(
            &mut guard,
            &proof,
            "/api/v1/auth/fingerprints/roster",
            &digest,
        )
    })
    .await?;
    Ok(Json(serde_json::json!({ "items": entries })))
}

/// What a till says it found on the scanner, and what the node makes of it.
///
/// `SESSION` opens a till and comes back as the same bearer token a password
/// login issues — one kind of session, so everything downstream is already
/// right about it. `SUPERVISOR` comes back as a single-use authorisation
/// instead, because a supervisor walking over is a step-up and not a login.
async fn fingerprint_claim(
    State(state): State<EdgeState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let proof = terminal_proof(&headers)?;
    let digest = crate::security::sha256_hex(&body);
    let request: crate::edge::fingerprint::ClaimRequest = serde_json::from_slice(&body)
        .map_err(|error| ApiError(EdgeError::Validation(format!("invalid claim: {error}"))))?;
    // The seat, when the till names it — read beside the claim, not part of it.
    let claim_terminal = serde_json::from_slice::<Value>(&body)
        .ok()
        .and_then(|body| body.get("terminal_id").and_then(Value::as_str).map(str::to_string));
    let purpose = request.purpose.trim().to_ascii_uppercase();

    let connection = state.auth.connection();
    let accepted = run_blocking(move || {
        let mut guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        crate::edge::fingerprint::claim(
            &mut guard,
            &proof,
            request,
            "/api/v1/auth/fingerprints/claim",
            &digest,
        )
    })
    .await?;

    if purpose != "SESSION" {
        return Ok(Json(serde_json::to_value(accepted).map_err(|error| {
            ApiError(EdgeError::Persistence(error.to_string()))
        })?));
    }

    refuse_closed_at_till(&state, &accepted.username, claim_terminal).await?;
    let auth = state.auth.clone();
    let username = accepted.username.clone();
    let issued = run_blocking(move || auth.issue_for_fingerprint(&username)).await?;
    Ok(Json(serde_json::json!({
        "username": accepted.username,
        "purpose": accepted.purpose,
        "token": issued.token,
        "token_type": "Bearer",
        "expires_at_epoch": issued.expires_at.timestamp(),
    })))
}

/// An employee lays a finger on the till's scanner to pay from their benefit
/// balance (client, 24 Oct 2026). Signed by the terminal, exactly as a
/// supervisor's finger is: the till matched it, this node decides what that is
/// worth — one grant for that person's balance, which the till then puts on
/// the lookup and the spend instead of a code. The till never names a person
/// on those calls; this node reads the person off its own grant.
async fn fingerprint_benefit(
    State(state): State<EdgeState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let proof = terminal_proof(&headers)?;
    let digest = crate::security::sha256_hex(&body);
    let request: crate::edge::fingerprint::BenefitClaimRequest = serde_json::from_slice(&body)
        .map_err(|error| ApiError(EdgeError::Validation(format!("invalid claim: {error}"))))?;
    let connection = state.auth.connection();
    let granted = run_blocking(move || {
        let mut guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        crate::edge::fingerprint::benefit_claim(
            &mut guard,
            &proof,
            request,
            "/api/v1/auth/fingerprints/benefit",
            &digest,
        )
    })
    .await?;
    Ok(Json(serde_json::to_value(granted).map_err(|error| {
        ApiError(EdgeError::Persistence(error.to_string()))
    })?))
}

// ════════════════════════════════════════════════════════════════════════════
// The machines enrolled to this node
// ════════════════════════════════════════════════════════════════════════════

fn lock_devices(
    connection: &Arc<std::sync::Mutex<rusqlite::Connection>>,
) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, EdgeError> {
    crate::edge::devices::lock(connection)
}

#[derive(Debug, serde::Deserialize)]
struct TillStandingQuery {
    terminal_id: String,
}

/// `GET /api/v1/till/standing?terminal_id=…`: what head office has stopped
/// that this till must show on its door (`edge::pos_stop::standing`, 0990).
/// Open: it carries a store's or a till's stop and the name on a drawer
/// still open at that till — what the counter itself would show anybody.
async fn till_standing(
    State(state): State<EdgeState>,
    Query(query): Query<TillStandingQuery>,
) -> Result<Json<crate::edge::pos_stop::TillStanding>, ApiError> {
    let connection = state.auth.connection();
    let standing = run_blocking(move || {
        let guard = lock_devices(&connection)?;
        Ok(crate::edge::pos_stop::standing(&guard, &query.terminal_id))
    })
    .await?;
    Ok(Json(standing))
}

/// Who this node is, for a till looking for its shop's server. Open, and
/// carries nothing that is not printed on the shop's receipts — the site's
/// display code and name included, from the site directory.
async fn node_identity(State(state): State<EdgeState>) -> Result<Json<Value>, ApiError> {
    let connection = state.auth.connection();
    let node = state.inventory.node().clone();
    let identity = run_blocking(move || {
        let guard = lock_devices(&connection)?;
        Ok(crate::edge::devices::node_identity(&guard, &node))
    })
    .await?;
    Ok(Json(json!(identity)))
}

/// Every device this node holds, as head office will see it.
async fn list_devices(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let connection = state.auth.connection();
    let items = run_blocking(move || {
        let guard = lock_devices(&connection)?;
        crate::edge::devices::list_devices(&guard)
    })
    .await?;
    Ok(Json(json!({ "items": items })))
}

/// A till asks to join. Answered with the code and number it shows while a
/// supervisor decides.
async fn join_node(
    State(state): State<EdgeState>,
    Json(request): Json<crate::sync::device::JoinRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let connection = state.auth.connection();
    let node = state.inventory.node().clone();
    let answer = run_blocking(move || {
        let mut guard = lock_devices(&connection)?;
        crate::edge::devices::begin_join(&mut guard, &node, request)
    })
    .await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(answer)?)))
}

async fn join_status(
    State(state): State<EdgeState>,
    Json(request): Json<crate::sync::device::JoinStatusRequest>,
) -> Result<Json<Value>, ApiError> {
    let connection = state.auth.connection();
    let node = state.inventory.node().clone();
    let status = run_blocking(move || {
        let mut guard = lock_devices(&connection)?;
        crate::edge::devices::join_status(&mut guard, &node, &request)
    })
    .await?;
    Ok(Json(serde_json::to_value(status)?))
}

/// The tills waiting for a supervisor. Readable by anybody signed in here,
/// because the till that shows the prompt is usually a cashier's.
async fn pending_joins(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let connection = state.auth.connection();
    let items = run_blocking(move || {
        let guard = lock_devices(&connection)?;
        crate::edge::devices::pending_joins(&guard)
    })
    .await?;
    Ok(Json(json!({ "items": items })))
}

/// Let a waiting till in. Who may is decided inside `approve_join`: a
/// supervisor's finger (the grant in the body), or a supervisor session for a
/// shop's first till, or an Admin.
async fn approve_join(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(join_id): Path<String>,
    Json(request): Json<crate::edge::devices::ApproveJoinRequest>,
) -> Result<Json<Value>, ApiError> {
    let session = require_permission(&state, principal, EdgePermission::InventoryRead)?
        .map(|who| (who.username, who.role));
    let connection = state.auth.connection();
    let approved = run_blocking(move || {
        let mut guard = lock_devices(&connection)?;
        crate::edge::devices::approve_join(
            &mut guard,
            &join_id,
            request,
            session.as_ref().map(|(name, role)| (name.as_str(), *role)),
        )
    })
    .await?;
    Ok(Json(serde_json::to_value(approved)?))
}

async fn refuse_join(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(join_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let actor = require_permission(&state, principal, EdgePermission::DeviceAdmin)?
        .map(|who| who.username)
        .unwrap_or_else(|| "api".into());
    let connection = state.auth.connection();
    run_blocking(move || {
        let guard = lock_devices(&connection)?;
        crate::edge::devices::refuse_join(&guard, &join_id, &actor)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct DeviceStatusRequest {
    device_id: String,
    status: String,
    #[serde(default)]
    reason: Option<String>,
}

/// Suspend, reactivate or revoke a printer, here at the shop. A till is head
/// office's alone (`devices::set_status` refuses it).
async fn set_device_status(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(request): Json<DeviceStatusRequest>,
) -> Result<Json<Value>, ApiError> {
    let actor = require_permission(&state, principal, EdgePermission::DeviceAdmin)?
        .map(|who| who.username)
        .unwrap_or_else(|| "api".into());
    let connection = state.auth.connection();
    let device = run_blocking(move || {
        let mut guard = lock_devices(&connection)?;
        crate::edge::devices::set_status(
            &mut guard,
            request.device_id.trim(),
            &request.status,
            request.reason.as_deref(),
            &actor,
        )
    })
    .await?;
    Ok(Json(serde_json::to_value(device)?))
}

async fn record_printer(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(request): Json<crate::edge::devices::RecordPrinterRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let actor = require_permission(&state, principal, EdgePermission::DeviceAdmin)?
        .map(|who| who.username)
        .unwrap_or_else(|| "api".into());
    let connection = state.auth.connection();
    let printer = run_blocking(move || {
        let mut guard = lock_devices(&connection)?;
        crate::edge::devices::record_printer(&mut guard, request, &actor)
    })
    .await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(printer)?)))
}

async fn change_printer(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(printer_id): Path<String>,
    Json(request): Json<crate::edge::devices::ChangePrinterRequest>,
) -> Result<Json<Value>, ApiError> {
    let actor = require_permission(&state, principal, EdgePermission::DeviceAdmin)?
        .map(|who| who.username)
        .unwrap_or_else(|| "api".into());
    let connection = state.auth.connection();
    let printer = run_blocking(move || {
        let mut guard = lock_devices(&connection)?;
        crate::edge::devices::change_printer(&mut guard, &printer_id, request, &actor)
    })
    .await?;
    Ok(Json(serde_json::to_value(printer)?))
}

/// A till says what is plugged into it. Signed like a fingerprint claim, so a
/// till can only ever describe itself.
async fn set_till_peripherals(
    State(state): State<EdgeState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let proof = terminal_proof(&headers)?;
    let digest = crate::security::sha256_hex(&body);
    let request: crate::edge::devices::PeripheralsRequest =
        serde_json::from_slice(&body).map_err(|error| {
            ApiError(EdgeError::Validation(format!(
                "invalid peripherals report: {error}"
            )))
        })?;
    let connection = state.auth.connection();
    let device = run_blocking(move || {
        let mut guard = lock_devices(&connection)?;
        crate::edge::devices::set_peripherals(
            &mut guard,
            &proof,
            "/api/v1/devices/self/peripherals",
            &digest,
            request.peripherals,
        )
    })
    .await?;
    Ok(Json(serde_json::to_value(device)?))
}

/// What head office left for this till — a test page, today. Signed like the
/// peripherals report, so a till only ever reads its own.
async fn till_requests(
    State(state): State<EdgeState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let proof = terminal_proof(&headers)?;
    // A GET signs the empty body, as the fingerprint roster does.
    let digest = crate::security::sha256_hex(b"");
    let connection = state.auth.connection();
    let requests = run_blocking(move || {
        let mut guard = lock_devices(&connection)?;
        crate::edge::devices::till_requests(&mut guard, &proof, SELF_REQUESTS_PATH, &digest)
    })
    .await?;
    Ok(Json(serde_json::to_value(requests)?))
}

/// How a till's test page came out, whether head office asked for it or
/// somebody pressed "test print" at the till.
async fn till_test_print_result(
    State(state): State<EdgeState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let proof = terminal_proof(&headers)?;
    let digest = crate::security::sha256_hex(&body);
    let result: crate::sync::device::TestPrintResult =
        serde_json::from_slice(&body).map_err(|error| {
            ApiError(EdgeError::Validation(format!(
                "invalid test print result: {error}"
            )))
        })?;
    let connection = state.auth.connection();
    let device = run_blocking(move || {
        let mut guard = lock_devices(&connection)?;
        crate::edge::devices::record_till_test_print(
            &mut guard,
            &proof,
            SELF_TEST_PRINT_RESULT_PATH,
            &digest,
            result,
        )
    })
    .await?;
    Ok(Json(serde_json::to_value(device)?))
}

/// When a print request names a recorded printer by `printer_id`, write the
/// printer's address into it; otherwise leave the request exactly as sent, so
/// every screen that still sends a host and port keeps working.
///
/// Blocking: call it inside `run_blocking`. Takes and releases the lock
/// itself, before the print path takes it again.
fn with_recorded_printer(
    connection: &Arc<std::sync::Mutex<rusqlite::Connection>>,
    mut body: Value,
) -> Result<Value, EdgeError> {
    let printer_id = body
        .get("printer_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string);
    let Some(printer_id) = printer_id else {
        return Ok(body);
    };
    let (host, port) = {
        let guard = lock_devices(connection)?;
        crate::edge::devices::resolve_printer(&guard, &printer_id)?
    };
    if let Value::Object(fields) = &mut body {
        fields.insert("printer_host".into(), Value::String(host));
        fields.insert("printer_port".into(), Value::from(port));
    }
    Ok(body)
}

/// A print request, after [`with_recorded_printer`], as the type its handler
/// expects. A body that still does not fit is the caller's mistake, said so.
fn print_request<T: serde::de::DeserializeOwned>(body: Value) -> Result<T, EdgeError> {
    serde_json::from_value(body)
        .map_err(|error| EdgeError::Validation(format!("invalid print request: {error}")))
}

/// What this shop's node accepts besides a password.
///
/// Deliberately unauthenticated: a till has to know what to draw on its own
/// sign-in screen, and that is precisely the moment nobody has signed in. It
/// leaks one word about the shop's configuration, which is worth less than a
/// till that guesses and shows a PIN box a production node would refuse.
async fn auth_methods(State(state): State<EdgeState>) -> Result<Json<Value>, ApiError> {
    let connection = state.auth.connection();
    let method = run_blocking(move || {
        let guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        crate::edge::pin::step_up(&guard)
    })
    .await?;
    Ok(Json(serde_json::json!({ "till_step_up": method })))
}

/// Change it. One row, and every till in the shop follows on its next look.
async fn set_auth_method(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(request): Json<serde_json::Value>,
) -> Result<Json<Value>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::AuthAdmin)?;
    let actor = principal.map(|who| who.username).unwrap_or_default();
    let method = request
        .get("till_step_up")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let connection = state.auth.connection();
    let saved = run_blocking(move || {
        let guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        crate::edge::pin::set_step_up(&guard, &method, &actor)
    })
    .await?;
    Ok(Json(serde_json::json!({ "till_step_up": saved })))
}

/// Give somebody a PIN. `AuthAdmin`, because a PIN is a way into a till.
async fn set_user_pin(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(request): Json<serde_json::Value>,
) -> Result<StatusCode, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::AuthAdmin)?;
    let actor = principal.map(|who| who.username).unwrap_or_default();
    let username = request
        .get("username")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let pin = request
        .get("pin")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let connection = state.auth.connection();
    run_blocking(move || {
        let guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        crate::edge::pin::set_pin(&guard, &username, &pin, &actor)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Take one away — one cashier at a time, or every one of them on the day a
/// shop stops being staging.
async fn clear_user_pin(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(username): Path<String>,
) -> Result<StatusCode, ApiError> {
    require_permission(&state, principal, EdgePermission::AuthAdmin)?;
    let connection = state.auth.connection();
    run_blocking(move || {
        let guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        crate::edge::pin::clear_pin(&guard, &username)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// A PIN claim, signed by the terminal and checked by the node.
///
/// The signature binds a supervisor's grant to the till the supervisor walked
/// up to; the checking is the node's own, so unlike a fingerprint claim there
/// is nothing here a terminal can assert its way past.
async fn pin_claim(
    State(state): State<EdgeState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let proof = terminal_proof(&headers)?;
    let digest = crate::security::sha256_hex(&body);
    let request: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|error| ApiError(EdgeError::Validation(format!("invalid claim: {error}"))))?;
    let username = request
        .get("username")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let pin = request
        .get("pin")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let purpose = request
        .get("purpose")
        .and_then(|value| value.as_str())
        .unwrap_or("SESSION")
        .to_string();
    let pin_terminal = request
        .get("terminal_id")
        .and_then(|value| value.as_str())
        .map(str::to_string);

    let connection = state.auth.connection();
    let wanted = purpose.trim().to_ascii_uppercase();
    let accepted = run_blocking(move || {
        let mut guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        crate::edge::fingerprint::pin_claim(
            &mut guard,
            &proof,
            &username,
            &pin,
            &purpose,
            "/api/v1/auth/pin/claim",
            &digest,
        )
    })
    .await?;

    if wanted != "SESSION" {
        return Ok(Json(serde_json::to_value(accepted).map_err(|error| {
            ApiError(EdgeError::Persistence(error.to_string()))
        })?));
    }

    refuse_closed_at_till(&state, &accepted.username, pin_terminal).await?;
    let auth = state.auth.clone();
    let who = accepted.username.clone();
    // The same session a password login issues. One kind of session, so
    // everything downstream is already right about it.
    let issued = run_blocking(move || auth.issue_for_fingerprint(&who)).await?;
    Ok(Json(serde_json::json!({
        "username": accepted.username,
        "purpose": accepted.purpose,
        "token": issued.token,
        "token_type": "Bearer",
        "expires_at_epoch": issued.expires_at.timestamp(),
    })))
}

fn required_header(headers: &HeaderMap, name: &'static str) -> Result<String, ApiError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| ApiError(EdgeError::Unauthorized(format!("missing {name} header"))))
}

fn require_permission(
    state: &EdgeState,
    principal: Option<Extension<EdgePrincipal>>,
    permission: EdgePermission,
) -> Result<Option<EdgePrincipal>, ApiError> {
    if !state.auth.enabled() {
        return Ok(None);
    }
    let principal = principal
        .map(|Extension(principal)| principal)
        .ok_or_else(|| ApiError(EdgeError::Unauthorized("missing session principal".into())))?;
    principal.require(permission).map_err(ApiError)?;
    Ok(Some(principal))
}

/// The rung an outbound mutation needs AT THIS NODE.
///
/// The same ten handlers serve both routers — a Gudang picks, packs, seals,
/// ships and dispatches an allotment; a shop does the same to send a return
/// back — so the permission is asked of the node's own role rather than fixed
/// in the handler.
///
/// * At the **Gudang** these stages are a picker's work, and a picker stands at
///   the till rung: `DcOperate`, a CASHIER's.
/// * At a **shop** the same stages are a stock mutation by hand — the store's
///   return — and every other one of those (`/store/receive`,
///   `/store/movements`) is a SUPERVISOR's: `InventoryMove`.
///
/// The asymmetry this closes: a shop's pick needed only a cashier while its
/// `/store/movements` and `/store/receive` needed a supervisor, so the two
/// halves of "stock moved by hand at a shop" disagreed about who may do it.
fn outbound_permission(state: &EdgeState) -> EdgePermission {
    match state.inventory.node().role {
        EdgeRole::Dc => EdgePermission::DcOperate,
        EdgeRole::Store => EdgePermission::InventoryMove,
    }
}

fn validate_auth_node(inventory: &dyn EdgeInventory, auth: &EdgeAuth) -> Result<(), EdgeError> {
    if inventory.node() != auth.node() {
        return Err(EdgeError::Configuration(
            "auth service and inventory adapter belong to different Edge nodes".into(),
        ));
    }
    Ok(())
}

fn sqlite_connection_unavailable() -> Arc<std::sync::Mutex<rusqlite::Connection>> {
    // Compatibility routers are used by existing in-process tests with auth
    // disabled. They still need a schema-bearing connection for EdgeAuth.
    let connection = rusqlite::Connection::open_in_memory()
        .unwrap_or_else(|error| panic!("open disabled auth database: {error}"));
    connection
        .execute_batch(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/migrations/sqlite/0004_edge_auth.sql"
        )))
        .unwrap_or_else(|error| panic!("initialize disabled auth database: {error}"));
    Arc::new(std::sync::Mutex::new(connection))
}

fn append_cookie(response: &mut Response, cookie: String) -> Result<(), ApiError> {
    let value = HeaderValue::from_str(&cookie).map_err(|error| {
        ApiError(EdgeError::Configuration(format!(
            "invalid auth cookie: {error}"
        )))
    })?;
    response.headers_mut().append(header::SET_COOKIE, value);
    Ok(())
}

fn prevent_auth_caching(response: &mut Response) {
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, max-age=0"),
    );
    response
        .headers_mut()
        .insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
}

/// Edge-owned Official Counts authored and activated by Cloud.
async fn dc_official_counts(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let items = run_blocking(move || state.inventory.list_official_counts()).await?;
    Ok(Json(
        json!({ "items": items, "execution_authority": "EDGE_DC" }),
    ))
}

async fn dc_official_count(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(count_id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let item = run_blocking(move || state.inventory.official_count(count_id)).await?;
    Ok(Json(serde_json::to_value(item)?))
}

async fn dc_official_count_entries(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(count_id): Path<Uuid>,
    Json(mut request): Json<OfficialCountEntriesRequest>,
) -> Result<Json<Value>, ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
        request.actor_id = principal.username;
    }
    let item = run_blocking(move || {
        state
            .inventory
            .record_official_count_entries(count_id, request)
    })
    .await?;
    Ok(Json(serde_json::to_value(item)?))
}

async fn dc_submit_official_count(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(count_id): Path<Uuid>,
    Json(mut request): Json<OfficialCountSubmitRequest>,
) -> Result<Json<Value>, ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
        request.actor_id = principal.username;
    }
    let item =
        run_blocking(move || state.inventory.submit_official_count(count_id, request)).await?;
    Ok(Json(serde_json::to_value(item)?))
}

/// The purchase order lines this DC still owes a supplier delivery against —
/// a receiving clerk's work list.
async fn dc_purchase_lines(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let lines = run_blocking(move || state.inventory.open_purchase_lines()).await?;
    Ok(Json(json!({ "items": lines })))
}

/// How many orders this DC is still owed a delivery against, and which were
/// sent back to be counted again — the badge and the order book's recount
/// marks, worked out here so neither carries the whole work list across the
/// network to read two facts off it.
async fn dc_purchase_summary(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let mut lines = run_blocking(move || state.inventory.open_purchase_lines()).await?;
    let orders = lines
        .iter()
        .map(|line| line.po_number.as_str())
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    // An order's reason is its first recounted line's.
    lines.sort_by(|a, b| {
        a.po_number
            .cmp(&b.po_number)
            .then(a.line_number.cmp(&b.line_number))
    });
    let mut recounts: Vec<Value> = Vec::new();
    let mut last: Option<String> = None;
    for line in &lines {
        let Some(reason) = &line.recount_reason else {
            continue;
        };
        if last.as_deref() == Some(line.po_number.as_str()) {
            continue;
        }
        last = Some(line.po_number.clone());
        recounts.push(json!({ "po_number": line.po_number, "reason": reason }));
    }
    Ok(Json(json!({ "orders": orders, "recounts": recounts })))
}

/// Record a blind count of what arrived. A document, not a movement: nothing
/// becomes stock here.
async fn dc_count_purchase(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<PurchaseCountRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.count_purchase(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// A whole count sheet in one command: every counted line of one order, one
/// delivery document, one transaction.
async fn dc_count_purchase_batch(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<PurchaseCountBatchRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.count_purchase_batch(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// Counts waiting for a decision — the verifier's queue, carrying the order's
/// expected quantity and agreed price beside each count. The checker's list
/// (`GET /api/v1/dc/purchase-orders`) deliberately carries neither.
async fn dc_counts_awaiting_verification(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let items = run_blocking(move || state.inventory.counts_awaiting_verification()).await?;
    Ok(Json(json!({ "items": items })))
}

/// Accept a count, or send it back to be counted again.
///
/// Accepting is the moment the goods first exist as stock, and the moment the
/// centre is told anything at all. Who may accept is `DcOperate` — the
/// permission ladder, not a name comparison (owner, 2026-10-04).
async fn dc_verify_purchase(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<PurchaseVerifyRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
        request.verifier_actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.verify_purchase(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// Goods beyond an order that the buyer is sending back (`0068`): open
/// returns first, then the last fortnight's handed over.
async fn dc_purchase_returns(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let items = run_blocking(move || state.inventory.purchase_returns()).await?;
    Ok(Json(json!({ "items": items })))
}

/// Hand a purchase return to the supplier: its pieces leave the Unidentified
/// pool, and the movement going up closes the return at the centre.
async fn dc_hand_over_purchase_return(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(return_id): Path<Uuid>,
    Json(mut request): Json<PurchaseReturnHandoverRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || {
        state
            .inventory
            .hand_over_purchase_return(return_id, request)
    })
    .await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// Deliveries still being worked through on the loading bay.
async fn dc_goods_receipts(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let items = run_blocking(move || state.inventory.open_goods_receipts()).await?;
    Ok(Json(json!({ "items": items })))
}

/// Open a delivery document when a lorry arrives, before anything is counted.
/// The number is minted at this DC, so receiving works with the network down.
async fn dc_open_goods_receipt(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<OpenGoodsReceiptRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.open_goods_receipt(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// Turn a whole delivery away: wet cartons, goods nobody ordered, the wrong
/// supplier's lorry. The arrival stays on the record with the reason on it —
/// three refused deliveries is the most useful thing anyone will ever know
/// about a supplier, and deleting the document is how that gets lost.
async fn dc_reject_delivery(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(receipt_id): Path<Uuid>,
    Json(mut request): Json<RejectDeliveryRequest>,
) -> Result<Json<Value>, ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
        request.actor_id = principal.username;
    }
    request.receipt_id = receipt_id;
    let result = run_blocking(move || state.inventory.reject_delivery(request)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// Record the supplier's invoice against a delivery. The verifier is holding
/// the paper; nothing else in the estate can see it.
async fn dc_record_receipt_invoice(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(receipt_id): Path<Uuid>,
    Json(mut request): Json<RecordInvoiceRequest>,
) -> Result<Json<Value>, ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
        request.actor_id = principal.username;
    }
    request.receipt_id = receipt_id;
    let result = run_blocking(move || state.inventory.record_receipt_invoice(request)).await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// The name and type of the page being uploaded.
///
/// Query parameters rather than a header, and rather than multipart, for the
/// reasons `cloud/http/files.rs` gives: no cross-origin preflight has to be
/// widened for them, and the browser hands the `File` straight to `fetch` as
/// the body without re-encoding a scan.
#[derive(Debug, Deserialize)]
struct InvoiceUploadQuery {
    name: String,
    #[serde(rename = "type")]
    content_type: Option<String>,
    /// Who is uploading, when the node is running without authentication. A
    /// node that knows who is signed in ignores this and uses that.
    #[serde(default)]
    actor: Option<String>,
}

/// Keep the supplier's invoice as the paper it is.
///
/// The numbers off it are recorded separately, through the route above, and
/// they are what the system compares against the order. This is the page
/// behind them, and it is what settles an argument about a total six weeks
/// later when nobody can find the folder.
async fn dc_store_invoice_document(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(receipt_id): Path<Uuid>,
    Query(query): Query<InvoiceUploadQuery>,
    bytes: Bytes,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let signed_in = require_permission(&state, principal, EdgePermission::DcOperate)?;
    let actor = match signed_in {
        Some(principal) => principal.username,
        None => query.actor.unwrap_or_default(),
    };
    let request = StoreInvoiceDocumentRequest {
        receipt_id,
        filename: query.name,
        content_type: query.content_type.unwrap_or_default(),
        bytes: bytes.to_vec(),
        actor_id: actor,
    };
    let stored = run_blocking(move || state.inventory.store_invoice_document(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(stored)?)))
}

/// The page back. Served inline so a verifier can read it in the browser
/// rather than fishing it out of a downloads folder.
async fn dc_invoice_document(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(receipt_id): Path<Uuid>,
) -> Result<Response, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let document = run_blocking(move || state.inventory.invoice_document(receipt_id)).await?;
    let mut headers = HeaderMap::new();
    // The stored type is whatever the browser said when it uploaded, so it is
    // operator-supplied and cannot be trusted into a header unparsed. An
    // unusable value falls back to bytes rather than failing the read.
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&document.content_type)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    // `inline`, and the filename deliberately left off: a stored name is
    // operator text and a header is the wrong place to find out.
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("inline"),
    );
    Ok((headers, document.bytes).into_response())
}

/// The print queue: jobs head office has sent and the warehouse has not
/// finished. Each line carries its labels — finished EPC strings, minted at
/// the centre. Nothing here computes one.
async fn dc_tagging_jobs(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let jobs = run_blocking(move || state.inventory.open_tagging_jobs()).await?;
    Ok(Json(json!({ "items": jobs })))
}

/// The tags are on the goods. One confirmation for the whole job, given by
/// the person who attached them: at this moment a counted quantity becomes
/// that many individually tracked units and enters the warehouse.
async fn dc_confirm_tagging(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<TaggingConfirmRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.confirm_tagging(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

#[cfg(test)]
mod blind_tests {
    use super::*;

    fn principal(role: crate::edge::domain::Role) -> EdgePrincipal {
        EdgePrincipal {
            session_id: Uuid::nil(),
            user_id: Uuid::nil(),
            username: "siti".into(),
            display_name: "Siti".into(),
            role,
            source: "LOCAL".into(),
            authenticated_with_cookie: false,
        }
    }

    fn report() -> Value {
        json!({
            "shift_id": "s-1",
            "opening_float_minor": 500_000,
            "sales_total_minor": 2_000_000,
            "cash_sales_minor": 1_200_000,
            "non_cash_minor": 800_000,
            "change_given_minor": 30_000,
            "cash_refunds_minor": 0,
            "non_cash_refunds_minor": 0,
            "expected_cash_minor": 1_670_000,
            "declared_cash_minor": 1_660_000,
            "variance_minor": -10_000,
            "tenders": [{"method": "CASH", "count": 9, "amount_minor": 1_200_000}],
            "movements": [],
            "counted": [],
            "blind": false
        })
    }

    #[test]
    fn a_cashier_never_reads_what_the_drawer_should_hold() {
        let seen = blind_for_cashier(
            Some(&principal(crate::edge::domain::Role::Cashier)),
            report(),
        );
        for key in [
            "sales_total_minor",
            "cash_sales_minor",
            "non_cash_minor",
            "change_given_minor",
            "expected_cash_minor",
            "variance_minor",
        ] {
            assert!(seen[key].is_null(), "{key} reached a cashier");
        }
        assert_eq!(seen["tenders"], json!([]));
        assert_eq!(seen["blind"], json!(true));
        // What the cashier did themselves stays.
        assert_eq!(seen["opening_float_minor"], json!(500_000));
        assert_eq!(seen["declared_cash_minor"], json!(1_660_000));
    }

    #[test]
    fn a_supervisor_reads_the_whole_report() {
        let seen = blind_for_cashier(
            Some(&principal(crate::edge::domain::Role::Supervisor)),
            report(),
        );
        assert_eq!(seen, report());
    }
}
