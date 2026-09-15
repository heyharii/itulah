use crate::contract::{
    ChangePasswordRequest, EdgeMe, EdgeSyncStatus, EdgeSyncTriggered, LoginRequest, LoginResponse,
    SessionUser,
};
use crate::edge::{
    sync::EdgeSyncHandle, AdvanceKoliRequest, CreateKoliShipmentRequest, DeviceProof, EdgeAuth,
    EdgeAuthConfig, EdgeError, EdgeInventory, EdgePermission, EdgePrincipal, EdgeRfid, EdgeRole,
    IntakeRequest, MoveRequest, NodeContext, OfficialCountEntriesRequest,
    OfficialCountSubmitRequest, OpenGoodsReceiptRequest, OperationalPool, PackKoliRequest,
    PickRequest, PoolBalance, PurchaseCountRequest, PurchaseVerifyRequest, ReceiveBatchRequest,
    ReceiveRequest, RecordInvoiceRequest, RejectDeliveryRequest, SaleRequest,
    StoreInvoiceDocumentRequest, TaggingConfirmRequest, RFID_OBSERVATION_PATH,
};
use crate::security::{self, CSRF_COOKIE, SESSION_COOKIE};
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
    let rfid = Arc::new(EdgeRfid::new(auth.connection(), auth.node().clone()));
    let state = EdgeState {
        inventory,
        auth,
        rfid,
        sync,
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
        .route("/api/v1/dc/packing-boxes", post(dc_open_packing_box))
        .route("/api/v1/dc/packing-boxes/{session_id}", get(dc_packing_box))
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
            "/api/v1/dc/purchase-verifications",
            post(dc_verify_purchase),
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
    let rfid = Arc::new(EdgeRfid::new(auth.connection(), auth.node().clone()));
    let state = EdgeState {
        inventory,
        auth,
        rfid,
        sync,
    };
    Ok(common_router()
        .route("/api/v1/store/receive", post(store_receive))
        .route("/api/v1/store/receive-batch", post(store_receive_batch))
        .route("/api/v1/store/movements", post(move_stock))
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
        // What is on, and what is about to be. Read-only, resident, and it
        // stays answerable with the line to the centre down — the shopper
        // asking whether the promo is still on is standing in the shop.
        .route("/api/v1/store/offers", get(store_offers))
        // ── The till's day ──────────────────────────────────────────────
        //
        // A drawer that opens and closes, and a sale the shop can take back.
        // Grouped here rather than under a `/pos` prefix because everything a
        // shop does is already `/store`, and a second word for the same node
        // is a second thing to remember at four in the afternoon.
        .route("/api/v1/store/shifts", post(store_open_shift))
        // Declared BEFORE `{shift_id}` and as its own path, not as a GET on the
        // collection. Axum prefers a literal segment, but a reader should not
        // have to know that: `/shifts/active` and `/shifts/{id}` sitting one
        // line apart is where a router silently starts treating the word
        // "active" as a shift id.
        .route("/api/v1/store/shifts/active", get(store_active_shift))
        .route("/api/v1/store/shifts/{shift_id}", get(store_shift_report))
        .route(
            "/api/v1/store/shifts/{shift_id}/movements",
            post(store_cash_movement),
        )
        .route(
            "/api/v1/store/shifts/{shift_id}/close",
            post(store_close_shift),
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
        .route(
            "/api/v1/store/sales/{sale_id}/receipt",
            get(store_receipt).post(store_print_receipt),
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
        .route(RFID_OBSERVATION_PATH, post(rfid_observations))
        .route("/api/v1/inventory/pools", get(pools))
        .route("/api/v1/inventory/movements", get(movements))
        .route("/api/v1/sync/status", get(sync_status))
        .route("/api/v1/sync/trigger", post(sync_trigger))
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
        "capabilities":["inventory.pools.owned", "inventory.movements.read"],
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
    let balances = run_blocking(move || state.inventory.list_pools()).await?;
    let items = present_pools(&node, balances)?;
    Ok(Json(json!({
        "as_of":chrono::Utc::now(),
        "read_only":false,
        "observed_window_hours":Value::Null,
        "lost_risk_window_days":Value::Null,
        "inventory_equation":"Stock = On Hand + Allotted + Missing",
        "aggregation_policy":"This Edge displays only its locally owned pools",
        "items":items
    })))
}

fn edge_pool_metadata(
    pool: &OperationalPool,
) -> (
    &'static str,
    &'static str,
    &'static str,
    i32,
    Option<&'static str>,
) {
    use OperationalPool::*;
    match pool {
        DcPendingUnidentified { .. } => ("PENDING", "UNIDENTIFIED", "Unidentified", 10, None),
        DcPendingUntagged { .. } => ("PENDING", "UNTAGGED", "Untagged", 20, None),
        DcWarehouse { .. } => ("WAREHOUSE", "WAREHOUSE", "Warehouse", 30, None),
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
        DcRejectDc { .. } => ("REJECT", "DC_REJECT", "DC Reject", 90, None),
        DcRejectStore { .. } => ("REJECT", "STORE_REJECT", "Store Reject", 100, None),
        StoreWarehouse { .. } => ("STORE_INVENTORY", "WAREHOUSE", "Warehouse", 10, None),
        StoreFloor { .. } => ("STORE_INVENTORY", "FLOOR", "Floor", 20, None),
        StoreReject { .. } => ("REJECT", "REJECT", "Reject", 30, None),
    }
}

fn present_pools(node: &NodeContext, balances: Vec<PoolBalance>) -> Result<Vec<Value>, ApiError> {
    let site_name = format!("{} {}", node.role, node.site_id);
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
            edge_pool_metadata(&pool);
        let destination_store_id = pool.outbound_destination().map(ToString::to_string);
        if let Some(stage) = outbound_stage {
            if let Some(total) = rollups.get_mut(stage) {
                total.0 += balance.stock;
                total.1 += balance.on_hand;
                total.2 += balance.missing;
            }
        }
        let store_origin_site_id = match &pool {
            OperationalPool::DcRejectStore { store_id, .. } => Some(store_id.to_string()),
            _ => None,
        };
        let label = destination_store_id
            .as_ref()
            .map(|destination| format!("{base_label} · {destination}"))
            .unwrap_or_else(|| base_label.to_string());
        items.push(json!({
            "id":balance.pool_id,
            "site_id":node.site_id,
            "site_name":site_name,
            "site_kind":node.role,
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

    if node.role == EdgeRole::Dc {
        for (stage, label, slug, display_order) in [
            ("PICKED", "Picked", "picked", 40),
            ("PACKED", "Packed", "packed", 50),
            ("SHIPMENT", "Shipment", "shipment", 60),
            ("LOADED", "Loaded", "loaded", 70),
            ("IN_TRANSIT", "In Transit", "in-transit", 80),
        ] {
            let (stock, on_hand, missing) = rollups.get(stage).copied().unwrap_or_default();
            items.push(json!({
                "id":format!("{}.outbound.{slug}", node.site_id),
                "site_id":node.site_id,
                "site_name":site_name,
                "site_kind":node.role,
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
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
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
    let sealed_by = require_permission(&state, principal, EdgePermission::DcOperate)?
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
    Json(request): Json<crate::edge::outbound::PrintKoliLabelRequest>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let result = run_blocking(move || state.inventory.print_koli_label(&koli_id, request)).await?;
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
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
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
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
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
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
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
    require_permission(&state, principal, EdgePermission::DcOperate)?;
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
    Json(request): Json<TestPrinterRequest>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let result = run_blocking(move || {
        crate::edge::printing::probe_printer(&request.printer_host, request.printer_port)
    })
    .await?;
    Ok(Json(serde_json::to_value(result)?))
}

/// Queue the labels for a tagging job that has landed at this DC.
async fn dc_open_print_session(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::printing::OpenPrintSessionRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
        request.actor_id = principal.username;
    }
    let result = run_blocking(move || state.inventory.open_print_session(request)).await?;
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
    Json(request): Json<crate::edge::printing::RepointPrinterRequest>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::DcOperate)?;
    let result =
        run_blocking(move || state.inventory.repoint_print_session(&session_id, request)).await?;
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
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
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
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
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
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
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
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
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
    Json(request): Json<crate::edge::contracts::QuoteRequest>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
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
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let node = state.inventory.node().clone();
    let page = run_blocking(move || state.inventory.store_catalog_page(query)).await?;
    let items = page.items;
    let publication_version = items.iter().map(|item| item.publication_version).max();
    let currency = items
        .first()
        .map(|item| item.currency.clone())
        .unwrap_or_else(|| "IDR".to_string());
    Ok(Json(json!({
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
    })))
}

/// Which till is asking. Absent means "whatever shift this node has open",
/// which is the right answer in a shop with one counter — and every shop in
/// this fleet has one counter.
#[derive(Debug, Deserialize)]
struct ActiveShiftQuery {
    #[serde(default)]
    terminal_id: Option<String>,
}

async fn store_open_shift(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::till::OpenShiftRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreSale)? {
        request.actor_id = principal.username;
    }
    let report = run_blocking(move || state.inventory.open_shift(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(report)?)))
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
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let report =
        run_blocking(move || state.inventory.active_shift(query.terminal_id.as_deref())).await?;
    Ok(Json(serde_json::to_value(report)?))
}

async fn store_shift_report(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(shift_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let report = run_blocking(move || state.inventory.shift_report(&shift_id)).await?;
    Ok(Json(serde_json::to_value(report)?))
}

async fn store_cash_movement(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(shift_id): Path<String>,
    Json(mut request): Json<crate::edge::till::CashMovementRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreSale)? {
        request.actor_id = principal.username;
    }
    let report =
        run_blocking(move || state.inventory.record_cash_movement(&shift_id, request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(report)?)))
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
/// `StoreSale` — the same permission a cash movement takes — because the person
/// who bought the thing is whoever was at the counter. The control is not the
/// session: it is the supervisor step-up the domain demands on every row, and
/// the rule that the supervisor is not the claimant. Gating this at supervisor
/// level as well would mean the manager keying in their own expenses and
/// approving them, which is exactly the arrangement the maker/checker rule
/// exists to prevent.
async fn store_record_expense(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<crate::edge::petty::RecordExpenseRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreSale)? {
        request.actor_id = principal.username;
    }
    let recorded = run_blocking(move || state.inventory.record_expense(request)).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(recorded)?)))
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
    if let Some(principal) = require_permission(&state, principal, EdgePermission::StoreSale)? {
        request.actor_id = principal.username;
    }
    let report = run_blocking(move || state.inventory.close_shift(&shift_id, request)).await?;
    Ok(Json(serde_json::to_value(report)?))
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

async fn store_print_receipt(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(sale_id): Path<String>,
    Json(request): Json<crate::edge::till::PrintReceiptRequest>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::StoreSale)?;
    let result =
        run_blocking(move || state.inventory.print_sale_receipt(&sale_id, request)).await?;
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
            EdgeError::Configuration(_) | EdgeError::Persistence(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        (status, Json(json!({"error":self.0.to_string()}))).into_response()
    }
}

async fn login(
    State(state): State<EdgeState>,
    Json(request): Json<LoginRequest>,
) -> Result<Response, ApiError> {
    let auth = state.auth.clone();
    let issued = run_blocking(move || auth.login(&request.username, &request.password)).await?;
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
        },
    })
    .into_response();
    prevent_auth_caching(&mut response);
    append_cookie(&mut response, session_cookie)?;
    append_cookie(&mut response, csrf_cookie)?;
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
    // for audit attribution and never replaces the device credential.
    let operator_id = if let Some(token) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.is_empty())
    {
        let auth = state.auth.clone();
        let token = token.to_string();
        let (principal, _) = run_blocking(move || auth.authenticate(&token, false)).await?;
        principal
            .require(EdgePermission::RfidObserve)
            .map_err(ApiError)?;
        Some(principal.user_id.to_string())
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

async fn require_auth(
    State(state): State<EdgeState>,
    mut request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    if !state.auth.enabled() {
        return Ok(next.run(request).await);
    }
    let path = request.uri().path();
    if !path.starts_with("/api/")
        || matches!(
            path,
            "/api/v1/health" | "/api/v1/auth/login" | RFID_OBSERVATION_PATH
        )
    {
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
/// `AuthAdmin` as well. An enrolment is an authorisation to open a till, and a
/// shop where a cashier can enrol their own supervisor's finger is a shop with
/// no supervisor.
async fn enrol_fingerprint(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(request): Json<crate::edge::fingerprint::EnrolRequest>,
) -> Result<Json<Value>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::AuthAdmin)?;
    let actor = principal.map(|who| who.username).unwrap_or_default();
    let connection = state.auth.connection();
    let enrolled = run_blocking(move || {
        let guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
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
/// centre is told anything at all. Both wait for a second person on purpose.
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
