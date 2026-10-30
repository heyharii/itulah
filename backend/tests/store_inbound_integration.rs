//! A shop knows what is on its way to it — what was packed, koli by koli —
//! and receives it against that (no longer blind, owner 23 Oct 2026).
//!
//! Two tests, one per half of the loop:
//!
//! * `an_announced_delivery_is_blind_until_received_and_then_compared` stands a
//!   Store Edge up on its own and feeds it signed announcements the way the
//!   command lane does. It pins the contract the handheld and the web read:
//!   nothing expected is shown while a delivery is in transit, the receipt
//!   books what it should and refuses what it must, and the comparison that
//!   comes back is exact per EPC.
//! * `an_in_transit_koli_is_announced_to_its_shop_and_received_blind` is the
//!   whole chain on three nodes: a DC ships a koli, the centre applies its
//!   IN_TRANSIT fact and announces it to the destination shop — and only that
//!   shop — the shop receives a subset plus one garment that was never on the
//!   manifest, and head office sees the difference EPC by EPC.
//!
//! The announcement is gated at the centre (`INVENTORY_STORE_INBOUND_COMMANDS`,
//! default off — an edge that does not know a command type blocks its whole
//! command stream). The chain test switches it on for its own process.

use axum::body::{to_bytes, Body};
use http::Request;
use inventory_backend::cloud::application::RegisterRfidDeviceRequest;
use inventory_backend::cloud::domain::{
    encode_epc, sign_command, BreakerPolicy, IngestBatch, IngestResponse, PushedCommand,
};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::edge::rfid::{derive_rfid_signing_key, sign_rfid_request};
use inventory_backend::edge::{
    dc_router_with_auth, store_router_with_auth, EdgeAuth, EdgeAuthConfig, EdgeInventory, EdgeRole,
    NodeContext, SiteId, SqliteEdge, SqliteSyncStore,
};
use inventory_backend::security;
use inventory_backend::sync::port::{SyncConfig, SyncStore, SyncTransport};
use inventory_backend::sync::workflow::INVENTORY_STORE_INBOUND_ANNOUNCE_V1;
use inventory_backend::sync::{run_cycle, CycleReport};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::{collections::BTreeMap, net::SocketAddr, path::PathBuf, sync::Arc};
use tower::ServiceExt;
use uuid::Uuid;

const DC_ORIGIN: &str = "dc-01-edge";
const DC_SITE: &str = "dc";
const DC_KEY: &str = "dc-01-store-inbound-sync-key-0001";

const STORE_ORIGIN: &str = "store-01-edge";
const STORE_SITE: &str = "store-01";
const STORE_KEY: &str = "store-01-store-inbound-sync-key-01";

/// A second shop, registered at the centre, that must hear nothing.
const OTHER_STORE_ORIGIN: &str = "store-02-edge";
const OTHER_STORE_SITE: &str = "store-02";
const OTHER_STORE_KEY: &str = "store-02-store-inbound-sync-key-01";

const SUPPLIER_CODE: &str = "SANDANG-KMJ-LP-01";
const DELIVERED: i64 = 60;
const ALLOTTED: i64 = 12;
const INTAKE_PRICE: i64 = 300_000;

fn frontend() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend")
}

fn cloud_config() -> AppConfig {
    AppConfig {
        po_import: inventory_backend::cloud::intake::po::PoImportConfig::from_env(),
        clock: None,
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|e| panic!("socket address: {e}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "cloud".into(),
        node_role: "STORE".into(),
        rfid_burst_window_seconds: 10,
        observed_window_hours: 24,
        lost_risk_window_days: 30,
        enable_test_controls: false,
        finance_automation_enabled: false,
        frontend_dir: frontend(),
        sync_upload_url: None,
        sync_upload_key: None,
        sync_ingest_key: None,
        sync_generation: 1,
        sync_enqueue_enabled: false,
        sync_interval_seconds: 5,
        sync_batch_limit: 100,
        sync_breaker_threshold: 3,
        sync_breaker_base_cooldown_seconds: 30,
        sync_breaker_max_cooldown_seconds: 900,
        sync_retention_days: 14,
        sync_degraded_after_seconds: 900,
        sync_apply_enabled: false,
        jwt_secret: None,
        auth_token_ttl_minutes: 60,
        auth_session_idle_minutes: 30,
        auth_cookie_secure: false,
        bootstrap_admin_password: None,
        cors_allowed_origins: None,
        media: None,
        attachments: None,
        default_destination_site_id: "dc".into(),
        assistant_api_key: None,
        assistant_base_url: "https://openrouter.ai/api/v1".into(),
        assistant_model: "anthropic/claude-opus-5".into(),
        assistant_vertex: false,
        assistant_price_per_mtok: None,
    }
}

// ---------------------------------------------------------------------------
// Talking to a router the way the outside world does
// ---------------------------------------------------------------------------

async fn call(
    router: axum::Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
) -> (http::StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    let request = match body {
        Some(value) => request.body(Body::from(
            serde_json::to_vec(&value).unwrap_or_else(|e| panic!("encode body: {e}")),
        )),
        None => request.body(Body::empty()),
    }
    .unwrap_or_else(|e| panic!("build {method} {uri}: {e}"));
    let response = router
        .oneshot(request)
        .await
        .unwrap_or_else(|e| panic!("{method} {uri}: {e}"));
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap_or_else(|e| panic!("read body of {method} {uri}: {e}"));
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| json!({ "raw": String::from_utf8_lossy(&bytes).to_string() }))
    };
    (status, value)
}

async fn call_signed(
    router: axum::Router,
    method: &str,
    uri: &str,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
) -> (http::StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    for (name, value) in headers {
        request = request.header(name, value);
    }
    let request = request
        .body(Body::from(body))
        .unwrap_or_else(|e| panic!("build {method} {uri}: {e}"));
    let response = router
        .oneshot(request)
        .await
        .unwrap_or_else(|e| panic!("{method} {uri}: {e}"));
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap_or_else(|e| panic!("read body of {method} {uri}: {e}"));
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| json!({ "raw": String::from_utf8_lossy(&bytes).to_string() }))
    };
    (status, value)
}

async fn ok(router: axum::Router, method: &str, uri: &str, body: Option<Value>) -> Value {
    let (status, value) = call(router, method, uri, body).await;
    assert!(
        status.is_success(),
        "{method} {uri} returned {status}: {value}"
    );
    value
}

fn edge_router(edge: &Arc<SqliteEdge>) -> axum::Router {
    let inventory: Arc<dyn EdgeInventory> = edge.clone();
    let auth = Arc::new(
        EdgeAuth::new(
            edge.connection(),
            edge.node().clone(),
            EdgeAuthConfig::disabled(),
        )
        .unwrap_or_else(|e| panic!("edge auth: {e}")),
    );
    match edge.node().role {
        EdgeRole::Store => store_router_with_auth(inventory, auth, frontend())
            .unwrap_or_else(|e| panic!("store router: {e}")),
        EdgeRole::Dc => dc_router_with_auth(inventory, auth, frontend())
            .unwrap_or_else(|e| panic!("dc router: {e}")),
    }
}

fn open_edge(origin: &str, role: EdgeRole, site: &str) -> Arc<SqliteEdge> {
    let site = SiteId::new(site).unwrap_or_else(|e| panic!("site: {e}"));
    let node = NodeContext::new(origin, role, site).unwrap_or_else(|e| panic!("node: {e}"));
    Arc::new(SqliteEdge::open_in_memory(node).unwrap_or_else(|e| panic!("edge: {e}")))
}

async fn pool_on_hand(router: axum::Router, pool_id: &str) -> i64 {
    let body = ok(router, "GET", "/api/v1/inventory/pools", None).await;
    body["items"]
        .as_array()
        .unwrap_or_else(|| panic!("no items in {body}"))
        .iter()
        .find(|item| item["id"] == json!(pool_id))
        .and_then(|item| item["on_hand"].as_i64())
        .unwrap_or(0)
}

/// Every RECEIVED transfer claim this edge has queued for the centre.
fn received_claims(edge: &Arc<SqliteEdge>) -> Vec<Value> {
    let connection = edge.connection();
    let connection = connection
        .lock()
        .unwrap_or_else(|e| panic!("edge lock: {e}"));
    let mut statement = connection
        .prepare(
            "SELECT payload FROM sync_fact_log WHERE event_type='inventory.transfer_claim.v1'
             ORDER BY seq",
        )
        .unwrap_or_else(|e| panic!("prepare: {e}"));
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap_or_else(|e| panic!("query: {e}"));
    rows.map(|row| {
        let text = row.unwrap_or_else(|e| panic!("row: {e}"));
        serde_json::from_str::<Value>(&text).unwrap_or_else(|e| panic!("claim json: {e}"))
    })
    .filter(|claim| claim["claim_kind"] == json!("RECEIVED"))
    .collect()
}

// ===========================================================================
// The shop on its own
// ===========================================================================

const SKU_A: &str = "10000001103";
const SKU_B: &str = "10000001104";
const SJ: &str = "SJ/DC/2026/0001";

fn epc(sku: &str, serial: u64) -> String {
    encode_epc(sku, serial).unwrap_or_else(|e| panic!("epc: {e}"))
}

fn announcement(koli_id: Uuid, destination: &str, units: &[(&str, String)]) -> Value {
    json!({
        "koli_id": koli_id,
        "source_site_id": DC_SITE,
        "destination_store_id": destination,
        "shipment_reference": SJ,
        "departed_at": "2026-09-26T03:00:00Z",
        "units": units.iter().map(|(sku, epc)| json!({
            "epc": epc,
            "sku_code": sku,
            "allotment_line_id": Uuid::new_v4(),
        })).collect::<Vec<_>>(),
    })
}

/// Apply one command exactly as the command lane does: signed under the
/// node's key, at the next position.
async fn push(edge: &Arc<SqliteEdge>, seq: i64, payload: Value) {
    let key = cloud::command_signing_key(STORE_KEY);
    let command_id = Uuid::new_v4();
    let signature = sign_command(
        key.as_bytes(),
        seq,
        &command_id,
        INVENTORY_STORE_INBOUND_ANNOUNCE_V1,
        &payload,
        None,
        false,
    );
    let command = PushedCommand {
        seq,
        command_id,
        command_type: INVENTORY_STORE_INBOUND_ANNOUNCE_V1.to_string(),
        payload,
        expires_at: None,
        revoked: false,
        signature,
    };
    let store = SqliteSyncStore::new(edge.connection());
    let report = store
        .apply_commands(key.as_bytes(), &[command])
        .await
        .unwrap_or_else(|e| panic!("apply command {seq}: {e}"));
    assert!(
        report.blocked.is_none(),
        "the announcement blocked the command stream: {:?}",
        report.blocked
    );
    assert_eq!(report.applied, 1, "command {seq} was not applied");
}

#[tokio::test]
async fn an_announced_delivery_shows_what_was_packed_and_then_compares() {
    let shop = open_edge(STORE_ORIGIN, EdgeRole::Store, STORE_SITE);
    let router = || edge_router(&shop);

    let (a1, a2, a3, a4, a5) = (
        epc(SKU_A, 1),
        epc(SKU_A, 2),
        epc(SKU_A, 3),
        epc(SKU_A, 4),
        epc(SKU_A, 5),
    );
    let (b1, b2, b99) = (epc(SKU_B, 1), epc(SKU_B, 2), epc(SKU_B, 99));

    // Two koli under one surat jalan are one delivery. The first names its
    // label, the second comes from a centre that does not.
    let first_koli = Uuid::new_v4();
    let mut labelled = announcement(
        first_koli,
        STORE_SITE,
        &[
            (SKU_A, a1.clone()),
            (SKU_A, a2.clone()),
            (SKU_A, a3.clone()),
        ],
    );
    labelled["koli_number"] = json!("KL-DC01-000123");
    push(&shop, 1, labelled).await;
    push(
        &shop,
        2,
        announcement(
            Uuid::new_v4(),
            STORE_SITE,
            &[
                (SKU_A, a4.clone()),
                (SKU_B, b1.clone()),
                (SKU_B, b2.clone()),
            ],
        ),
    )
    .await;
    // Another shop's koli, misdirected here: ignored, and it does not block.
    push(
        &shop,
        3,
        announcement(Uuid::new_v4(), "store-09", &[(SKU_A, epc(SKU_A, 700))]),
    )
    .await;

    // --- What was packed, while in transit ---------------------------------
    let list = ok(router(), "GET", "/api/v1/store/inbound", None).await;
    let deliveries = list["deliveries"]
        .as_array()
        .unwrap_or_else(|| panic!("no deliveries: {list}"));
    assert_eq!(
        deliveries.len(),
        1,
        "one surat jalan is one delivery: {list}"
    );
    let delivery = &deliveries[0];
    let delivery_id = delivery["delivery_id"]
        .as_str()
        .unwrap_or_else(|| panic!("no delivery_id: {delivery}"))
        .to_string();
    assert_eq!(delivery["status"], "IN_TRANSIT");
    assert_eq!(delivery["shipment_reference"], SJ);
    assert_eq!(delivery["source_site_id"], DC_SITE);
    assert_eq!(delivery["koli_count"], 2);
    assert!(
        delivery["result"].is_null(),
        "nothing counted yet: {delivery}"
    );
    assert!(delivery["received_at"].is_null());

    let detail = ok(
        router(),
        "GET",
        &format!("/api/v1/store/inbound/{delivery_id}"),
        None,
    )
    .await;
    let packed: Vec<(String, i64, i64)> = detail["lines"]
        .as_array()
        .unwrap_or_else(|| panic!("no lines: {detail}"))
        .iter()
        .map(|line| {
            (
                line["sku_code"].as_str().unwrap_or_default().to_string(),
                line["expected"].as_i64().unwrap_or(-1),
                line["received"].as_i64().unwrap_or(-1),
            )
        })
        .collect();
    assert_eq!(
        packed,
        vec![(SKU_A.to_string(), 4, 0), (SKU_B.to_string(), 2, 0)],
        "what was packed, nothing received yet: {detail}"
    );
    assert_eq!(detail["skipped_epcs"], json!([]));
    let koli = detail["koli"]
        .as_array()
        .unwrap_or_else(|| panic!("no koli: {detail}"));
    assert_eq!(koli.len(), 2, "{detail}");
    assert_eq!(koli[0]["koli_number"], "KL-DC01-000123");
    assert_eq!(
        koli[0]["lines"],
        json!([{ "sku_code": SKU_A, "name": null, "quantity": 3 }])
    );
    assert!(koli[1]["koli_number"].is_null());

    // A scanned label (as printed, or its QR) opens its koli; the surat
    // jalan opens the delivery.
    for code in ["KL-DC01-000123", "k1:kl-dc01-000123"] {
        let scan = ok(
            router(),
            "GET",
            &format!("/api/v1/store/inbound/scan?code={code}"),
            None,
        )
        .await;
        assert_eq!(scan["delivery_id"], json!(delivery_id), "{code}: {scan}");
        assert_eq!(scan["koli_id"], json!(first_koli.to_string()), "{code}");
    }
    for code in [SJ.to_string(), format!("s1:{SJ}")] {
        let scan = ok(
            router(),
            "GET",
            &format!("/api/v1/store/inbound/scan?code={code}"),
            None,
        )
        .await;
        assert_eq!(scan["delivery_id"], json!(delivery_id), "{code}: {scan}");
        assert!(scan["koli_id"].is_null(), "{code}");
    }
    let (status, _) = call(
        router(),
        "GET",
        "/api/v1/store/inbound/scan?code=KL-NOPE",
        None,
    )
    .await;
    assert_eq!(status, http::StatusCode::NOT_FOUND);
    let received_only = ok(
        router(),
        "GET",
        "/api/v1/store/inbound?status=RECEIVED",
        None,
    )
    .await;
    assert_eq!(received_only["deliveries"], json!([]));
    let (status, _) = call(router(), "GET", "/api/v1/store/inbound?status=LOST", None).await;
    assert_eq!(status, http::StatusCode::BAD_REQUEST);
    let (status, _) = call(router(), "GET", "/api/v1/store/inbound/inb-nope", None).await;
    assert_eq!(status, http::StatusCode::NOT_FOUND);

    // A3 is already on this shop's books — received unannounced earlier.
    ok(
        router(),
        "POST",
        "/api/v1/store/receive-batch",
        Some(json!({
            "lines": [{ "epc": a3, "sku_code": SKU_A, "unit_price_minor": 0 }],
            "actor_id": "gudang-toko",
            "idempotency_key": "early-a3"
        })),
    )
    .await;

    // --- The sweep --------------------------------------------------------
    // Read: A1, A2 (twice, once in lower case), A3 (already booked), A4, B1,
    // B99 (never announced) and a tag that is not ours. Not read: B2.
    let junk = "E2801160600002086F4A1234".to_string();
    let sweep = json!({
        "epcs": [a1, a2, a2.to_ascii_lowercase(), a3, a4, b1, b99, junk],
        "actor_id": "gudang-toko",
        "idempotency_key": "inbound-1"
    });
    let receive_uri = format!("/api/v1/store/inbound/{delivery_id}/receive");
    let received = ok(router(), "POST", &receive_uri, Some(sweep.clone())).await;

    assert_eq!(received["delivery"]["status"], "RECEIVED");
    assert_eq!(received["delivery"]["received_by"], "gudang-toko");
    assert!(received["delivery"]["received_at"].as_str().is_some());
    assert_eq!(
        received["delivery"]["result"],
        json!({
            "expected_units": 6,
            "received_units": 4,
            "missing_units": 2,
            "extra_units": 1
        }),
        "{received}"
    );
    let mut skipped = vec![a3.clone(), junk.clone()];
    skipped.sort();
    assert_eq!(received["skipped_epcs"], json!(skipped));
    assert_eq!(
        received["lines"],
        json!([
            {
                "sku_code": SKU_A, "name": null,
                "expected": 4, "received": 3, "missing": 1, "extra": 0,
                "missing_epcs": [a3], "extra_epcs": []
            },
            {
                "sku_code": SKU_B, "name": null,
                "expected": 2, "received": 1, "missing": 1, "extra": 1,
                "missing_epcs": [b2], "extra_epcs": [b99]
            }
        ]),
        "{received}"
    );

    // The answer is the record: reading it back says the same thing.
    let reread = ok(
        router(),
        "GET",
        &format!("/api/v1/store/inbound/{delivery_id}"),
        None,
    )
    .await;
    assert_eq!(reread, received);

    // Stock: A3 from before, plus A1, A2, A4, B1 and the extra B99.
    assert_eq!(
        pool_on_hand(router(), &format!("{STORE_SITE}.warehouse")).await,
        6
    );

    // Every unit booked by the receipt claims its surat jalan, so the centre
    // pairs it with the DC's IN_TRANSIT claim (and shows B99 STORE_ONLY).
    let claims: Vec<Value> = received_claims(&shop)
        .into_iter()
        .filter(|claim| claim["shipment_reference"] == json!(SJ))
        .collect();
    let mut claimed: Vec<String> = claims
        .iter()
        .map(|claim| claim["epc"].as_str().unwrap_or_default().to_string())
        .collect();
    claimed.sort();
    let mut booked = vec![a1.clone(), a2.clone(), a4.clone(), b1.clone(), b99.clone()];
    booked.sort();
    assert_eq!(claimed, booked);
    assert!(claims
        .iter()
        .all(|claim| claim["source_dc_id"] == json!(DC_SITE)
            && claim["destination_store_id"] == json!(STORE_SITE)));

    // --- Resends and second receipts ---------------------------------------
    let again = ok(router(), "POST", &receive_uri, Some(sweep.clone())).await;
    assert_eq!(again, received, "same key, same answer");
    let mut same_tags = sweep.clone();
    same_tags["idempotency_key"] = json!("inbound-1-resent");
    let resent = ok(router(), "POST", &receive_uri, Some(same_tags)).await;
    assert_eq!(
        resent, received,
        "the same sweep under a new key is a resend"
    );
    let (status, body) = call(
        router(),
        "POST",
        &receive_uri,
        Some(json!({
            "epcs": [b2],
            "actor_id": "gudang-toko",
            "idempotency_key": "inbound-2"
        })),
    )
    .await;
    assert_eq!(status, http::StatusCode::CONFLICT, "{body}");
    assert_eq!(
        pool_on_hand(router(), &format!("{STORE_SITE}.warehouse")).await,
        6,
        "a refused second receipt books nothing"
    );

    // A koli announced after the receipt is written down, never counted.
    push(
        &shop,
        4,
        announcement(Uuid::new_v4(), STORE_SITE, &[(SKU_A, a5.clone())]),
    )
    .await;
    let after_late = ok(
        router(),
        "GET",
        &format!("/api/v1/store/inbound/{delivery_id}"),
        None,
    )
    .await;
    assert_eq!(after_late, received);

    // A DC that is handed an announcement ignores it rather than blocking.
    let dc = open_edge(DC_ORIGIN, EdgeRole::Dc, DC_SITE);
    push(
        &dc,
        1,
        announcement(Uuid::new_v4(), STORE_SITE, &[(SKU_A, a1.clone())]),
    )
    .await;
    let health = ok(edge_router(&shop), "GET", "/api/v1/health", None).await;
    assert!(
        health["capabilities"]
            .as_array()
            .is_some_and(|caps| caps.contains(&json!("store.inbound"))),
        "a shop running this build says it understands announcements: {health}"
    );
}

// ===========================================================================
// The whole chain
// ===========================================================================

struct Fleet {
    cloud: AppState,
    dc: Arc<SqliteEdge>,
    store: Arc<SqliteEdge>,
    other_store: Arc<SqliteEdge>,
}

impl Fleet {
    fn cloud_router(&self) -> axum::Router {
        cloud_http::router(self.cloud.clone())
    }
    async fn cloud_get(&self, uri: &str) -> Value {
        ok(self.cloud_router(), "GET", uri, None).await
    }
    async fn cloud_post(&self, uri: &str, body: Value) -> Value {
        ok(self.cloud_router(), "POST", uri, Some(body)).await
    }
    async fn dc_get(&self, uri: &str) -> Value {
        ok(edge_router(&self.dc), "GET", uri, None).await
    }
    async fn dc_post(&self, uri: &str, body: Value) -> Value {
        ok(edge_router(&self.dc), "POST", uri, Some(body)).await
    }
    async fn store_get(&self, uri: &str) -> Value {
        ok(edge_router(&self.store), "GET", uri, None).await
    }
    async fn store_post(&self, uri: &str, body: Value) -> Value {
        ok(edge_router(&self.store), "POST", uri, Some(body)).await
    }

    async fn delivery(&self) -> Value {
        let open = self.dc_get("/api/v1/dc/goods-receipts").await;
        if let Some(first) = open["items"].as_array().and_then(|items| items.first()) {
            return first["receipt_id"].clone();
        }
        let opened = self
            .dc_post(
                "/api/v1/dc/goods-receipts",
                json!({
                    "supplier_id": "SUP-01",
                    "actor_id": "penerima-1",
                    "idempotency_key": "grn-1"
                }),
            )
            .await;
        opened["receipt_id"].clone()
    }

    async fn sync(&self) {
        self.cycle(&self.dc, DC_KEY).await;
        self.cycle(&self.store, STORE_KEY).await;
        self.cycle(&self.other_store, OTHER_STORE_KEY).await;
        let report = cloud::apply_pending(&self.cloud.db, 500)
            .await
            .unwrap_or_else(|e| panic!("apply: {e}"));
        assert!(report.blocked.is_empty(), "blocked: {:?}", report.blocked);
    }

    async fn cycle(&self, edge: &Arc<SqliteEdge>, key: &str) {
        let store = SqliteSyncStore::new(edge.connection());
        let transport = IngestOverHttp {
            state: self.cloud.clone(),
            key: key.to_string(),
        };
        let config = SyncConfig {
            batch_limit: 100,
            breaker: BreakerPolicy {
                threshold: 5,
                base_cooldown_seconds: 30,
                max_cooldown_seconds: 900,
            },
            command_key: Some(cloud::command_signing_key(key)),
        };
        for _ in 0..40 {
            let outcome = run_cycle(&store, &config, &transport)
                .await
                .unwrap_or_else(|e| panic!("cycle for {key}: {e}"));
            if let Some(blocked) = outcome.commands_blocked {
                panic!(
                    "{} could not apply a command: {blocked:?}",
                    edge.node().node_id
                );
            }
            if matches!(outcome.upstream, CycleReport::Idle) && outcome.commands_applied == 0 {
                break;
            }
        }
    }
}

struct IngestOverHttp {
    state: AppState,
    key: String,
}

#[async_trait::async_trait]
impl SyncTransport for IngestOverHttp {
    async fn send(&self, batch: &IngestBatch) -> Result<IngestResponse, String> {
        let body = serde_json::to_vec(batch).map_err(|e| e.to_string())?;
        let request = Request::builder()
            .method("POST")
            .uri("/api/v1/sync/ingest")
            .header("content-type", "application/json")
            .header("x-sync-key", self.key.as_str())
            .body(Body::from(body))
            .map_err(|e| e.to_string())?;
        let response = cloud_http::router(self.state.clone())
            .oneshot(request)
            .await
            .map_err(|e| e.to_string())?;
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(format!(
                "ingest returned {status}: {}",
                String::from_utf8_lossy(&bytes)
            ));
        }
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
    }
}

async fn provision(pool: &PgPool, origin: &str, key: &str, site: &str, role: &str, label: &str) {
    cloud::register_origin_credential(pool, origin, key, Some(label))
        .await
        .unwrap_or_else(|e| panic!("register {origin}: {e}"));
    sqlx::query(
        "UPDATE sync_origin_credential
         SET site_id = $2, node_role = $3, active_generation = 1, inventory_enabled = true
         WHERE origin_id = $1",
    )
    .bind(origin)
    .bind(site)
    .bind(role)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("bind {origin}: {e}"));
}

async fn fleet(pool: PgPool) -> Fleet {
    provision(&pool, DC_ORIGIN, DC_KEY, DC_SITE, "DC", "DC 01").await;
    provision(
        &pool,
        STORE_ORIGIN,
        STORE_KEY,
        STORE_SITE,
        "STORE",
        "Toko 01",
    )
    .await;
    provision(
        &pool,
        OTHER_STORE_ORIGIN,
        OTHER_STORE_KEY,
        OTHER_STORE_SITE,
        "STORE",
        "Toko 02",
    )
    .await;
    Fleet {
        cloud: AppState::new(pool, cloud_config()),
        dc: open_edge(DC_ORIGIN, EdgeRole::Dc, DC_SITE),
        store: open_edge(STORE_ORIGIN, EdgeRole::Store, STORE_SITE),
        other_store: open_edge(OTHER_STORE_ORIGIN, EdgeRole::Store, OTHER_STORE_SITE),
    }
}

fn order_body() -> Value {
    json!({
        "po_number": format!("PO-{}", &Uuid::new_v4().to_string()[..8]),
        "supplier_id": "SUP-01",
        "supplier_name": "PT Sandang Jaya",
        "destination_site_id": DC_SITE,
        "origin_kind": "DIRECT",
        "currency": "IDR",
        "created_by": "buyer-1",
        "lines": [{
            "article_code": SUPPLIER_CODE,
            "article_name": "Kemeja Lengan Panjang",
            "image_url": "https://cdn.itulah.co.id/kemeja.jpg",
            "division_code": "PRIA",
            "tags": ["KEMEJA", "LENGAN_PANJANG"],
            "ordered_quantity": DELIVERED,
            "unit_price_minor": INTAKE_PRICE
        }]
    })
}

fn setup_body(receipt_line_id: &Value) -> Value {
    json!({
        "receipt_line_id": receipt_line_id,
        "article_name": "Kemeja Lengan Panjang Merah",
        "division_code": "PRIA",
        "tags": ["KEMEJA", "LENGAN_PANJANG"],
        "image_url": "https://cdn.itulah.co.id/kemeja-merah.jpg",
        "currency": "IDR",
        "created_by": "merchandiser-1",
        "colours": [{ "colour_digit": "1", "colour_code": "RED" }],
        "variants": [
            { "colour_digit": "1", "size_code": "03", "quantity": 30, "base_price_minor": INTAKE_PRICE },
            { "colour_digit": "1", "size_code": "04", "quantity": 30, "base_price_minor": INTAKE_PRICE }
        ]
    })
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_in_transit_koli_is_announced_to_its_shop_and_received_blind(pool: PgPool) {
    // The deploy gate, on for this process only (see the module note).
    std::env::set_var(cloud::STORE_INBOUND_COMMANDS_ENV, "1");
    let fleet = fleet(pool).await;

    // --- Goods into the DC: order, blind count, accept, identify, tag -------
    fleet
        .cloud_post("/api/v1/purchase-orders", order_body())
        .await;
    fleet.sync().await;
    let work = fleet.dc_get("/api/v1/dc/purchase-orders").await;
    let po_line_id = work["items"][0]["po_line_id"].clone();
    let count = fleet
        .dc_post(
            "/api/v1/dc/purchase-counts",
            json!({
                "receipt_id": fleet.delivery().await,
                "po_line_id": po_line_id,
                "counted_quantity": DELIVERED,
                "actor_id": "checker-1",
                "idempotency_key": "count-1"
            }),
        )
        .await;
    fleet
        .dc_post(
            "/api/v1/dc/purchase-verifications",
            json!({
                "count_id": count["count_id"],
                "decision": "Accept",
                // The person who RAISED the order verifies its counts (owner, 2026-09-26),
                // and `checker-1` counted it: the two pairs of hands the rule
                // wants are the checker and the buyer. This used to verify as
                // somebody called `verifier-1`, which that rule refuses.
                "verifier_actor_id": "buyer-1",
                "idempotency_key": "verify-1"
            }),
        )
        .await;
    fleet.sync().await;
    let waiting = fleet.cloud_get("/api/v1/article-setups/unidentified").await;
    let session = fleet
        .cloud_post(
            "/api/v1/article-setups",
            setup_body(&waiting["items"][0]["receipt_line_id"]),
        )
        .await;
    let session_id = session["session_id"]
        .as_str()
        .unwrap_or_else(|| panic!("no session id: {session}"))
        .to_string();
    let issued = fleet
        .cloud_post(
            &format!("/api/v1/article-setups/{session_id}/issue"),
            json!({ "issued_by": "merchandiser-1" }),
        )
        .await;
    let mut minted: Vec<String> = issued["variants"]
        .as_array()
        .unwrap_or_else(|| panic!("no variants: {issued}"))
        .iter()
        .map(|variant| variant["sku_code"].as_str().unwrap_or_default().to_string())
        .collect();
    minted.sort();
    let (sku_code, other_sku_code) = (minted[0].clone(), minted[1].clone());
    fleet.sync().await;

    let jobs = fleet.dc_get("/api/v1/dc/tagging-jobs").await;
    let job = &jobs["items"][0];
    let mut labels_by_sku: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for line in job["lines"]
        .as_array()
        .unwrap_or_else(|| panic!("no lines: {job}"))
    {
        let sku = line["sku_code"].as_str().unwrap_or_default().to_string();
        for epc in line["epcs"]
            .as_array()
            .unwrap_or_else(|| panic!("no epcs: {line}"))
        {
            labels_by_sku
                .entry(sku.clone())
                .or_default()
                .push(epc.as_str().unwrap_or_default().to_string());
        }
    }
    fleet
        .dc_post(
            "/api/v1/dc/tagging-confirmations",
            json!({
                "job_id": job["job_id"],
                "actor_id": "petugas-tag",
                "idempotency_key": "tag-1"
            }),
        )
        .await;
    fleet.sync().await;

    // The shop's catalogue, so its comparison can name what it counted.
    cloud::publish_catalog_if_changed(&fleet.cloud.db, "system:catalog-publisher")
        .await
        .unwrap_or_else(|e| panic!("publish catalogue: {e}"));

    // --- Allot, pick, pack, ship --------------------------------------------
    let availability = fleet.cloud_get("/api/v1/inventory/availability").await;
    let sku_id = availability["items"]
        .as_array()
        .unwrap_or_else(|| panic!("nothing available: {availability}"))
        .iter()
        .find(|item| item["sku_code"] == json!(sku_code))
        .unwrap_or_else(|| panic!("{sku_code} is not available: {availability}"))["sku_id"]
        .clone();
    fleet
        .cloud_post(
            "/api/v1/inventory/allotments",
            json!({
                "type": "TO_STORE",
                "lines": [{
                    "source_site_id": DC_SITE,
                    "source_pool_id": format!("{DC_SITE}.warehouse"),
                    "destination_type": "STORE",
                    "destination_id": STORE_SITE,
                    "sku_id": sku_id,
                    "quantity": ALLOTTED
                }],
                "notes": "kiriman perdana",
                "actor_id": "perencana-1",
                "idempotency_key": "allot-1"
            }),
        )
        .await;
    fleet.sync().await;

    let round = fleet
        .dc_post(
            "/api/v1/dc/pick-sessions",
            json!({ "actor_id": "picker-1", "note": "ronde pagi" }),
        )
        .await;
    fleet
        .dc_post(
            "/api/v1/dc/picks",
            json!({
                "source_pool_id": format!("{DC_SITE}.warehouse"),
                "sku_code": sku_code,
                "quantity": ALLOTTED,
                "actor_id": "picker-1",
                "idempotency_key": "pick-1",
                "pick_session_id": round["session_id"]
            }),
        )
        .await;

    let device = cloud::register_rfid_device(
        &fleet.cloud.db,
        RegisterRfidDeviceRequest {
            device_id: "RFID-DC-PACK".into(),
            origin_id: DC_ORIGIN.into(),
            label: "DC packing handheld".into(),
            pools: vec![format!("{DC_SITE}.warehouse")],
            offline_ttl_seconds: Some(604_800),
        },
        "admin",
    )
    .await
    .unwrap_or_else(|e| panic!("register handheld: {e}"));
    cloud::publish_auth_policy(&fleet.cloud.db, DC_ORIGIN, "admin")
        .await
        .unwrap_or_else(|e| panic!("publish policy: {e}"));
    let device_key = device["device_key"]
        .as_str()
        .unwrap_or_else(|| panic!("no device key: {device}"))
        .to_string();
    fleet.sync().await;

    let opened = fleet
        .dc_post(
            "/api/v1/dc/packing-boxes",
            json!({
                "destination_store_id": STORE_SITE,
                "target": [{ "sku_code": sku_code, "target_qty": ALLOTTED }],
                "actor_id": "packer-1"
            }),
        )
        .await;
    let box_id = opened["session"]["session_id"]
        .as_str()
        .unwrap_or_else(|| panic!("no box: {opened}"))
        .to_string();
    let epcs: Vec<String> = labels_by_sku
        .get(&sku_code)
        .unwrap_or_else(|| panic!("no labels for {sku_code}"))
        .iter()
        .take(ALLOTTED as usize)
        .cloned()
        .collect();
    let body = serde_json::to_vec(&json!({
        "site_id": DC_SITE,
        "pool": format!("{DC_SITE}.warehouse"),
        "reader_session_id": "sweep-pack",
        "observed_at": chrono::Utc::now(),
        "idempotency_key": "sweep-pack",
        "observations": epcs.iter()
            .map(|epc| json!({"epc": epc, "antenna": "A1", "rssi": -47.0, "read_count": 4}))
            .collect::<Vec<_>>()
    }))
    .unwrap_or_else(|e| panic!("sweep body: {e}"));
    let timestamp = chrono::Utc::now().timestamp();
    let signing_key = derive_rfid_signing_key(&device_key);
    let proof = vec![
        ("x-device-id".to_string(), "RFID-DC-PACK".to_string()),
        ("x-device-timestamp".to_string(), timestamp.to_string()),
        ("x-device-sequence".to_string(), "1".to_string()),
        (
            "x-device-signature".to_string(),
            sign_rfid_request(
                &signing_key,
                "RFID-DC-PACK",
                timestamp,
                1,
                &security::sha256_hex(&body),
            ),
        ),
    ];
    let (status, swept) = call_signed(
        edge_router(&fleet.dc),
        "POST",
        "/api/v1/rfid/observations",
        proof,
        body,
    )
    .await;
    assert!(status.is_success(), "sweep returned {status}: {swept}");
    let agreed = fleet
        .dc_post(
            &format!("/api/v1/dc/packing-boxes/{box_id}/capture"),
            json!({ "reader_session_id": "sweep-pack" }),
        )
        .await;
    assert_eq!(agreed["matched"], json!(true), "{agreed}");
    let ready = fleet
        .dc_get(&format!("/api/v1/dc/packing-boxes/{box_id}"))
        .await;
    let koli_id = ready["koli_id"]
        .as_str()
        .unwrap_or_else(|| panic!("no koli: {ready}"))
        .to_string();

    let shipment = fleet
        .dc_post(
            "/api/v1/dc/shipments",
            json!({ "koli_ids": [koli_id], "actor_id": "supervisor-1" }),
        )
        .await;
    let shipment_reference = shipment["shipment_number"]
        .as_str()
        .unwrap_or_else(|| panic!("no shipment number: {shipment}"))
        .to_string();
    // A shipment document does not move a koli; the koli's own stage does.
    fleet
        .dc_post(
            &format!("/api/v1/dc/koli/{koli_id}/shipment"),
            json!({
                "shipment_reference": shipment_reference,
                "actor_id": "supervisor-1",
                "idempotency_key": "koli-shipment-1"
            }),
        )
        .await;
    let dispatch = fleet
        .dc_post(
            "/api/v1/dc/dispatches",
            json!({
                "shipment_ids": [shipment["shipment_id"]],
                "carrier": "Kilat Ekspres",
                "vehicle_plate": "B 1234 XY",
                "driver_name": "Pak Slamet",
                "actor_id": "supervisor-1"
            }),
        )
        .await;
    let dispatch_id = dispatch["dispatch_id"]
        .as_str()
        .unwrap_or_else(|| panic!("no dispatch: {dispatch}"))
        .to_string();
    // Likewise a dispatch document loads nothing; `Loaded` on the koli does.
    fleet
        .dc_post(
            &format!("/api/v1/dc/koli/{koli_id}/dispatch"),
            json!({ "actor_id": "supervisor-1", "idempotency_key": "koli-dispatch-1" }),
        )
        .await;

    // Nothing is announced before the lorry leaves.
    let announced_before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sync_command WHERE command_type=$1")
            .bind(INVENTORY_STORE_INBOUND_ANNOUNCE_V1)
            .fetch_one(&fleet.cloud.db)
            .await
            .unwrap_or_else(|e| panic!("count commands: {e}"));
    fleet.sync().await;
    assert_eq!(announced_before, 0);

    fleet
        .dc_post(
            &format!("/api/v1/dc/dispatches/{dispatch_id}/depart"),
            json!({}),
        )
        .await;
    // The lorry has left. A dispatch departing is not the koli being on the
    // road: the stages are explicit, and it is the koli's own IN_TRANSIT —
    // confirmed here, on this koli, after the departure — that the centre
    // applies and announces.
    fleet
        .dc_post(
            &format!("/api/v1/dc/koli/{koli_id}/in-transit"),
            json!({ "actor_id": "supervisor-1", "idempotency_key": "in-transit-1" }),
        )
        .await;
    // The DC uploads IN_TRANSIT; the centre applies it and announces it.
    fleet.sync().await;

    // --- (a) The centre announced it to that shop, and only that shop -------
    let issued = sqlx::query(
        "SELECT d.origin_id, c.payload, c.issued_by
         FROM sync_command c JOIN sync_command_delivery d ON d.command_id = c.command_id
         WHERE c.command_type = $1",
    )
    .bind(INVENTORY_STORE_INBOUND_ANNOUNCE_V1)
    .fetch_all(&fleet.cloud.db)
    .await
    .unwrap_or_else(|e| panic!("read commands: {e}"));
    assert_eq!(issued.len(), 1, "one koli, one announcement, one target");
    assert_eq!(issued[0].get::<String, _>("origin_id"), STORE_ORIGIN);
    let payload: Value = issued[0].get("payload");
    assert_eq!(payload["koli_id"], json!(koli_id));
    assert_eq!(payload["source_site_id"], DC_SITE);
    assert_eq!(payload["destination_store_id"], STORE_SITE);
    assert_eq!(payload["shipment_reference"], json!(shipment_reference));
    assert!(payload["departed_at"].as_str().is_some(), "{payload}");
    let mut announced: Vec<String> = payload["units"]
        .as_array()
        .unwrap_or_else(|| panic!("no units: {payload}"))
        .iter()
        .map(|unit| {
            assert_eq!(unit["sku_code"], json!(sku_code));
            assert!(unit["allotment_line_id"].as_str().is_some());
            unit["epc"].as_str().unwrap_or_default().to_string()
        })
        .collect();
    announced.sort();
    let mut shipped = epcs.clone();
    shipped.sort();
    assert_eq!(announced, shipped);

    // --- (b) The shop hears it, with what was packed --------------------------
    fleet.sync().await;
    let list = fleet.store_get("/api/v1/store/inbound").await;
    let deliveries = list["deliveries"]
        .as_array()
        .unwrap_or_else(|| panic!("no deliveries: {list}"));
    assert_eq!(deliveries.len(), 1, "{list}");
    let delivery = &deliveries[0];
    assert_eq!(delivery["status"], "IN_TRANSIT");
    assert_eq!(delivery["koli_count"], 1);
    assert_eq!(delivery["shipment_reference"], json!(shipment_reference));
    assert_eq!(delivery["source_site_id"], DC_SITE);
    assert!(
        delivery["result"].is_null(),
        "nothing counted yet: {delivery}"
    );
    let delivery_id = delivery["delivery_id"]
        .as_str()
        .unwrap_or_else(|| panic!("no id: {delivery}"))
        .to_string();
    let packed = fleet
        .store_get(&format!("/api/v1/store/inbound/{delivery_id}"))
        .await;
    assert_eq!(packed["lines"][0]["sku_code"], json!(sku_code), "{packed}");
    assert_eq!(packed["lines"][0]["received"], 0, "{packed}");
    assert!(
        packed["koli"][0]["koli_number"].is_string(),
        "the koli's label travelled to the shop: {packed}"
    );
    let elsewhere = ok(
        edge_router(&fleet.other_store),
        "GET",
        "/api/v1/store/inbound",
        None,
    )
    .await;
    assert_eq!(
        elsewhere["deliveries"],
        json!([]),
        "another shop hears nothing"
    );

    // Two garments never made it; one from another rack did.
    let stray = labels_by_sku
        .get(&other_sku_code)
        .and_then(|labels| labels.first())
        .unwrap_or_else(|| panic!("no labels for {other_sku_code}"))
        .clone();
    let read: Vec<String> = epcs[..(ALLOTTED as usize - 2)]
        .iter()
        .cloned()
        .chain(std::iter::once(stray.clone()))
        .collect();
    let received = fleet
        .store_post(
            &format!("/api/v1/store/inbound/{delivery_id}/receive"),
            json!({
                "epcs": read,
                "actor_id": "gudang-toko",
                "idempotency_key": "inbound-chain-1"
            }),
        )
        .await;
    assert_eq!(received["delivery"]["status"], "RECEIVED");
    assert_eq!(
        received["delivery"]["result"],
        json!({
            "expected_units": ALLOTTED,
            "received_units": ALLOTTED - 2,
            "missing_units": 2,
            "extra_units": 1
        }),
        "{received}"
    );
    let lines = received["lines"]
        .as_array()
        .unwrap_or_else(|| panic!("no lines: {received}"));
    assert_eq!(lines.len(), 2, "{received}");
    let shipped_line = lines
        .iter()
        .find(|line| line["sku_code"] == json!(sku_code))
        .unwrap_or_else(|| panic!("no line for {sku_code}: {received}"));
    assert_eq!(shipped_line["expected"], ALLOTTED);
    assert_eq!(shipped_line["received"], ALLOTTED - 2);
    assert_eq!(shipped_line["missing"], 2);
    assert_eq!(shipped_line["extra"], 0);
    let mut missing = epcs[(ALLOTTED as usize - 2)..].to_vec();
    missing.sort();
    assert_eq!(shipped_line["missing_epcs"], json!(missing));
    assert!(
        shipped_line["name"].as_str().is_some(),
        "the resident catalogue names it: {shipped_line}"
    );
    let stray_line = lines
        .iter()
        .find(|line| line["sku_code"] == json!(other_sku_code))
        .unwrap_or_else(|| panic!("no line for {other_sku_code}: {received}"));
    assert_eq!(stray_line["expected"], 0);
    assert_eq!(stray_line["extra"], 1);
    assert_eq!(stray_line["extra_epcs"], json!([stray]));
    assert_eq!(received["skipped_epcs"], json!([]));

    // Booked stock: what was on the manifest and read, and the stray.
    assert_eq!(
        pool_on_hand(
            edge_router(&fleet.store),
            &format!("{STORE_SITE}.warehouse")
        )
        .await,
        ALLOTTED - 1
    );

    // --- Head office sees it EPC by EPC ---------------------------------------
    fleet.sync().await;
    let claims = sqlx::query(
        "SELECT epc, source_dc_id, shipment_reference FROM edge_transfer_claim
         WHERE origin_id = $1 AND claim_kind = 'RECEIVED'",
    )
    .bind(STORE_ORIGIN)
    .fetch_all(&fleet.cloud.db)
    .await
    .unwrap_or_else(|e| panic!("read claims: {e}"));
    assert_eq!(claims.len() as i64, ALLOTTED - 1);
    for claim in &claims {
        assert_eq!(
            claim.get::<Option<String>, _>("source_dc_id").as_deref(),
            Some(DC_SITE)
        );
        assert_eq!(
            claim
                .get::<Option<String>, _>("shipment_reference")
                .as_deref(),
            Some(shipment_reference.as_str())
        );
    }
    let report = fleet
        .cloud_get("/api/v1/inventory/reconciliations?limit=200")
        .await;
    assert_eq!(
        report["summary"]["matched"],
        ALLOTTED - 2,
        "{}",
        report["summary"]
    );
    assert_eq!(report["summary"]["dc_only"], 2, "{}", report["summary"]);
    assert_eq!(report["summary"]["store_only"], 1, "{}", report["summary"]);

    // The operations board's Received lane: the surat jalan, as the shop
    // counted it at the door, still two short.
    let received = fleet
        .cloud_get("/api/v1/inventory/shipments/received?limit=50")
        .await;
    let items = received["items"]
        .as_array()
        .unwrap_or_else(|| panic!("no items: {received}"));
    let row = items
        .iter()
        .find(|row| row["shipment_number"] == json!(shipment_reference))
        .unwrap_or_else(|| panic!("the surat jalan is not listed: {received}"));
    assert_eq!(row["sent_qty"], ALLOTTED, "{row}");
    assert_eq!(row["received_qty"], ALLOTTED - 2, "{row}");
    assert_eq!(row["found_qty"], 0, "{row}");
    assert_eq!(row["open_gap_qty"], 2, "{row}");
    assert_eq!(row["extra_qty"], 1, "{row}");
    assert_eq!(row["delivery_id"], json!(delivery_id), "{row}");
    // Short, so it is listed first, and still listed however old.
    assert_eq!(items[0]["shipment_number"], json!(shipment_reference));
    let later = fleet
        .cloud_get("/api/v1/inventory/shipments/received?since=2999-01-01T00:00:00Z")
        .await;
    assert!(
        later["items"].as_array().is_some_and(|rows| rows
            .iter()
            .any(|r| r["shipment_number"] == json!(shipment_reference))),
        "a surat jalan still short drops off the board: {later}"
    );
}
