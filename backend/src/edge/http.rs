use crate::contract::{
    ChangePasswordRequest, EdgeMe, EdgeSyncStatus, EdgeSyncTriggered, LoginRequest, LoginResponse,
    SessionUser,
};
use crate::edge::{
    sync::EdgeSyncHandle, AdvanceKoliRequest, CreateKoliShipmentRequest, DeviceProof, EdgeAuth,
    EdgeAuthConfig, EdgeError, EdgeInventory, EdgePermission, EdgePrincipal, EdgeRfid, EdgeRole,
    IntakeRequest, MoveRequest, NodeContext, OfficialCountEntriesRequest,
    OfficialCountSubmitRequest, OpenGoodsReceiptRequest, OperationalPool, PackKoliRequest,
    PickRequest, PoolBalance, PurchaseCountRequest, PurchaseVerifyRequest, ReceiveRequest,
    RecordInvoiceRequest, SaleRequest, TaggingConfirmRequest, RFID_OBSERVATION_PATH,
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
use tower_http::{services::ServeDir, trace::TraceLayer};
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
            "/api/v1/dc/purchase-counts",
            get(dc_counts_awaiting_verification).post(dc_count_purchase),
        )
        .route(
            "/api/v1/dc/purchase-verifications",
            post(dc_verify_purchase),
        )
        .route("/api/v1/dc/tagging-jobs", get(dc_tagging_jobs))
        .route("/api/v1/dc/tagging-confirmations", post(dc_confirm_tagging))
        .fallback_service(ServeDir::new(frontend_dir).append_index_html_on_directories(true))
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
        .route("/api/v1/store/movements", post(move_stock))
        .route("/api/v1/store/sales", post(store_sale))
        .route("/api/v1/store/catalog", get(store_catalog))
        .route("/api/v1/store/reports/sales/series", get(store_sales_series))
        .route("/api/v1/store/reports/sales/window", get(store_sales_window))
        .fallback_service(ServeDir::new(frontend_dir).append_index_html_on_directories(true))
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
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/me", get(me))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/auth/change-password", post(change_password))
        .route(RFID_OBSERVATION_PATH, post(rfid_observations))
        .route("/api/v1/inventory/pools", get(pools))
        .route("/api/v1/inventory/movements", get(movements))
        .route("/api/v1/sync/status", get(sync_status))
        .route("/api/v1/sync/trigger", post(sync_trigger))
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
        DcOutboundPicking { .. } => ("OUTBOUND", "PICKING", "Picking", 40, None),
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

#[derive(Deserialize)]
struct CaptureBoxRequest {
    reader_session_id: String,
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
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let node = state.inventory.node().clone();
    let items = run_blocking(move || state.inventory.store_catalog()).await?;
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
        "items": items,
    })))
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
        Ok(EdgeSyncStatus {
            origin_id: None,
            generation: 0,
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
