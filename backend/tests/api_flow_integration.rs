//! The whole chain over HTTP: a buyer raises an order, a warehouse counts it,
//! a second person accepts it, head office decides what it is, and the
//! warehouse tags it — every business action as a real request against a real
//! router.
//!
//! # What is and is not driven by API here
//!
//! Every action a PERSON takes goes over HTTP, against the same routers the
//! servers mount. So does the sync upload, which is genuinely an HTTP call in
//! production (`POST /api/v1/sync/ingest`).
//!
//! Two things are called directly, because in production they are background
//! workers rather than endpoints: the DC's sync cycle (a loop inside the edge
//! process) and the centre's apply agent (a loop inside the cloud process).
//! Driving them here is what a test does instead of waiting for a timer.
//!
//! # Why this exists beside `tagging_integration.rs`
//!
//! That one proves the domain is right. This one proves the domain is
//! REACHABLE: routes mounted, payloads shaped as the outside world will send
//! them, status codes meaning what they should. A rule enforced in a function
//! nobody can call is not enforced.

use axum::body::{to_bytes, Body};
use http::Request;
use inventory_backend::cloud::application::RegisterRfidDeviceRequest;
use inventory_backend::cloud::domain::{BreakerPolicy, IngestBatch, IngestResponse};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::edge::rfid::{derive_rfid_signing_key, sign_rfid_request};
use inventory_backend::edge::{
    dc_router_with_auth, EdgeAuth, EdgeAuthConfig, EdgeInventory, EdgeRole, NodeContext, SiteId,
    SqliteEdge, SqliteSyncStore,
};
use inventory_backend::security;
use inventory_backend::sync::port::{SyncConfig, SyncTransport};
use inventory_backend::sync::{run_cycle, CycleReport};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tower::ServiceExt;
use uuid::Uuid;

const DC_ORIGIN: &str = "dc-01-edge";
/// The DC the cloud actually knows about. `operational_pool` is seeded with
/// `dc.warehouse` on site `dc`, and `allotment` still carries
/// `CHECK (source_pool_id = 'dc.warehouse')` from migration 0004 — so this is
/// not a name the test may choose freely.
const DC_SITE: &str = "dc";
const KEY: &str = "dc-01-integration-sync-key-00000001";
const SUPPLIER_CODE: &str = "SANDANG-KMJ-LP-01";
const DELIVERED: i64 = 118;
/// The store this delivery is partly bound for, and how much of it goes.
const STORE_SITE: &str = "store-01";
const ALLOTTED: i64 = 40;
/// The second rack on the same walk, so the round covers more than one SKU.
const SECOND_RACK: i64 = 15;

fn frontend() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend")
}

fn cloud_config() -> AppConfig {
    AppConfig {
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
    }
}

/// One HTTP call against a freshly built router.
///
/// A router is consumed by `oneshot`, so each call gets its own — which also
/// means nothing leaks between requests, exactly as with a real server.
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

/// The same call, carrying headers — which the handheld needs, because it
/// proves itself with a signature rather than a session.
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

/// A call that must succeed. On failure the body is in the panic, because a
/// bare status code tells an operator nothing about what to fix.
async fn ok(router: axum::Router, method: &str, uri: &str, body: Option<Value>) -> Value {
    let (status, value) = call(router, method, uri, body).await;
    assert!(
        status.is_success(),
        "{method} {uri} returned {status}: {value}"
    );
    value
}

struct Fleet {
    cloud: AppState,
    dc: Arc<SqliteEdge>,
}

impl Fleet {
    fn cloud_router(&self) -> axum::Router {
        cloud_http::router(self.cloud.clone())
    }

    /// Built on the edge's own connection, not a throwaway one.
    ///
    /// The convenience `dc_router` opens a fresh in-memory database for auth
    /// and RFID, which is harmless while nothing authenticates — but a handheld
    /// proves itself against the device table, and a router that cannot see the
    /// real one rejects every sweep as coming from an unknown device.
    fn dc_router(&self) -> axum::Router {
        let inventory: Arc<dyn EdgeInventory> = self.dc.clone();
        let auth = Arc::new(
            EdgeAuth::new(
                self.dc.connection(),
                self.dc.node().clone(),
                EdgeAuthConfig::disabled(),
            )
            .unwrap_or_else(|e| panic!("edge auth: {e}")),
        );
        dc_router_with_auth(inventory, auth, frontend())
            .unwrap_or_else(|e| panic!("dc router: {e}"))
    }

    async fn cloud_get(&self, uri: &str) -> Value {
        ok(self.cloud_router(), "GET", uri, None).await
    }

    async fn cloud_post(&self, uri: &str, body: Value) -> Value {
        ok(self.cloud_router(), "POST", uri, Some(body)).await
    }

    async fn dc_get(&self, uri: &str) -> Value {
        ok(self.dc_router(), "GET", uri, None).await
    }

    async fn dc_post(&self, uri: &str, body: Value) -> Value {
        ok(self.dc_router(), "POST", uri, Some(body)).await
    }

    /// One pool's on-hand, by id.
    async fn pool_on_hand(&self, pool_id: &str) -> i64 {
        let body = self.dc_get("/api/v1/inventory/pools").await;
        body["items"]
            .as_array()
            .unwrap_or_else(|| panic!("no items in {body}"))
            .iter()
            .find(|item| item["id"] == json!(pool_id))
            .and_then(|item| item["on_hand"].as_i64())
            .unwrap_or_else(|| panic!("no pool {pool_id} in {body}"))
    }

    /// What the DC currently holds, read the way a screen would read it:
    /// `(warehouse, untagged, unidentified)`.
    ///
    /// Rollup rows are skipped — they restate their children's totals for
    /// display, and counting both would double every outbound figure.
    async fn pools(&self) -> (i64, i64, i64) {
        let body = self.dc_get("/api/v1/inventory/pools").await;
        let items: Vec<&Value> = body["items"]
            .as_array()
            .unwrap_or_else(|| panic!("no items in {body}"))
            .iter()
            .filter(|item| item["is_rollup"] != json!(true))
            .collect();
        let total = |matches: &dyn Fn(&str) -> bool| -> i64 {
            items
                .iter()
                .filter(|item| item["id"].as_str().is_some_and(matches))
                .filter_map(|item| item["on_hand"].as_i64())
                .sum()
        };
        (
            total(&|id: &str| id.ends_with(".warehouse")),
            total(&|id: &str| id.contains("untagged")),
            total(&|id: &str| id.contains("unidentified")),
        )
    }

    /// A delivery document to count into, opened once and reused. A lorry
    /// arrives, a document is opened, and everything counted from it belongs
    /// to that document.
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

    /// Drive the two background workers: the DC uploads over HTTP, then the
    /// centre applies what it received.
    async fn sync(&self) {
        let store = SqliteSyncStore::new(self.dc.connection());
        let transport = IngestOverHttp {
            state: self.cloud.clone(),
        };
        let config = SyncConfig {
            batch_limit: 100,
            breaker: BreakerPolicy {
                threshold: 5,
                base_cooldown_seconds: 30,
                max_cooldown_seconds: 900,
            },
            command_key: Some(cloud::command_signing_key(KEY)),
        };
        for _ in 0..20 {
            let outcome = run_cycle(&store, &config, &transport)
                .await
                .unwrap_or_else(|e| panic!("cycle: {e}"));
            if let Some(blocked) = outcome.commands_blocked {
                panic!("the DC could not apply a command: {blocked:?}");
            }
            if matches!(outcome.upstream, CycleReport::Idle) && outcome.commands_applied == 0 {
                break;
            }
        }
        let report = cloud::apply_pending(&self.cloud.db, 500)
            .await
            .unwrap_or_else(|e| panic!("apply: {e}"));
        assert!(report.blocked.is_empty(), "blocked: {:?}", report.blocked);
    }
}

/// The DC's upload, as it really travels: a POST to the cloud's ingest route.
struct IngestOverHttp {
    state: AppState,
}

#[async_trait::async_trait]
impl SyncTransport for IngestOverHttp {
    async fn send(&self, batch: &IngestBatch) -> Result<IngestResponse, String> {
        let body = serde_json::to_vec(batch).map_err(|e| e.to_string())?;
        let request = Request::builder()
            .method("POST")
            .uri("/api/v1/sync/ingest")
            .header("content-type", "application/json")
            .header("x-sync-key", KEY)
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

async fn fleet(pool: PgPool) -> Fleet {
    // Provisioning, not a business action: registering a node's credential is
    // how it comes to exist at all.
    cloud::register_origin_credential(&pool, DC_ORIGIN, KEY, Some("DC 01"))
        .await
        .unwrap_or_else(|e| panic!("register: {e}"));
    sqlx::query(
        "UPDATE sync_origin_credential
         SET site_id = $2, node_role = 'DC', active_generation = 1, inventory_enabled = true
         WHERE origin_id = $1",
    )
    .bind(DC_ORIGIN)
    .bind(DC_SITE)
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("bind: {e}"));

    let site = SiteId::new(DC_SITE).unwrap_or_else(|e| panic!("site: {e}"));
    let node =
        NodeContext::new(DC_ORIGIN, EdgeRole::Dc, site).unwrap_or_else(|e| panic!("node: {e}"));
    Fleet {
        cloud: AppState::new(pool, cloud_config()),
        dc: Arc::new(SqliteEdge::open_in_memory(node).unwrap_or_else(|e| panic!("edge: {e}"))),
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
            // The SUPPLIER's code. Useful on the loading bay, never an identity.
            "article_code": SUPPLIER_CODE,
            "article_name": "Kemeja Lengan Panjang",
            "image_url": "https://cdn.itulah.co.id/kemeja.jpg",
            // Presets for the setup form later, from the same vocabulary the
            // master article will use.
            "division_code": "MENSWEAR",
            "tags": ["KEMEJA", "LENGAN_PANJANG"],
            "ordered_quantity": 120,
            "unit_price_minor": 300_000
        }]
    })
}

fn setup_body(receipt_line_id: &Value) -> Value {
    json!({
        "receipt_line_id": receipt_line_id,
        // No article_code: this product is new to the company, so one is
        // minted during setup.
        "article_name": "Kemeja Lengan Panjang Merah",
        "division_code": "MENSWEAR",
        "tags": ["KEMEJA", "LENGAN_PANJANG"],
        "image_url": "https://cdn.itulah.co.id/kemeja-merah.jpg",
        "currency": "IDR",
        "created_by": "merchandiser-1",
        "colours": [{ "colour_digit": "1", "label": "Merah", "hex_code": "#C0392B" }],
        "variants": [
            { "colour_digit": "1", "size_code": "03", "quantity": 60, "base_price_minor": 450_000 },
            { "colour_digit": "1", "size_code": "04", "quantity": 58, "base_price_minor": 450_000 }
        ]
    })
}

// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_purchase_order_leaves_the_dc_on_a_truck_entirely_over_http(pool: PgPool) {
    let fleet = fleet(pool).await;

    // --- 01 · A buyer raises the order ------------------------------------
    let raised = fleet
        .cloud_post("/api/v1/purchase-orders", order_body())
        .await;
    assert_eq!(raised["sent_to_origin"], DC_ORIGIN);
    assert!(raised["activation_command_id"].is_string());

    fleet.sync().await;

    // --- 02 · The checker's list ------------------------------------------
    let work = fleet.dc_get("/api/v1/dc/purchase-orders").await;
    let lines = work["items"]
        .as_array()
        .unwrap_or_else(|| panic!("no items: {work}"));
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0]["article_name"], "Kemeja Lengan Panjang");
    // The whole point of a blind count: the checker is not shown the number
    // they are meant to produce.
    assert!(
        lines[0]["expected_stock_units"].is_null(),
        "the checker must not be shown the expected quantity: {}",
        lines[0]
    );
    let po_line_id = lines[0]["po_line_id"].clone();

    // --- 03 · The blind count ---------------------------------------------
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
    let count_id = count["count_id"].clone();
    assert_eq!(count["counted_quantity"], DELIVERED);

    // Counting is a document, not a movement. Nothing is stock yet.
    assert_eq!(fleet.pools().await, (0, 0, 0), "a count creates no stock");

    // --- 04 · The verifier's queue ----------------------------------------
    let queue = fleet.dc_get("/api/v1/dc/purchase-counts").await;
    let awaiting = queue["items"]
        .as_array()
        .unwrap_or_else(|| panic!("no items: {queue}"));
    assert_eq!(awaiting.len(), 1);
    // The verifier, unlike the checker, IS shown what to compare against —
    // including the agreed price, because they hold the supplier's invoice.
    assert_eq!(awaiting[0]["expected_stock_units"], 120);
    assert_eq!(awaiting[0]["counted_quantity"], DELIVERED);
    assert_eq!(awaiting[0]["unit_price_minor"], 300_000);

    let verified = fleet
        .dc_post(
            "/api/v1/dc/purchase-verifications",
            json!({
                "count_id": count_id,
                "decision": "Accept",
                "verifier_actor_id": "verifier-1",
                "idempotency_key": "verify-1"
            }),
        )
        .await;
    assert!(verified["movement_group_id"].is_string());

    // NOW the goods exist — unidentified, and nowhere else.
    assert_eq!(fleet.pools().await, (0, 0, DELIVERED));
    fleet.sync().await;

    // --- 05 · Head office's queue and decision ----------------------------
    let waiting = fleet.cloud_get("/api/v1/article-setups/unidentified").await;
    let items = waiting["items"]
        .as_array()
        .unwrap_or_else(|| panic!("no items: {waiting}"));
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["quantity"], DELIVERED);
    assert_eq!(items[0]["supplier_article_code"], SUPPLIER_CODE);
    let receipt_line_id = items[0]["receipt_line_id"].clone();

    let session = fleet
        .cloud_post("/api/v1/article-setups", setup_body(&receipt_line_id))
        .await;
    let session_id = session["session_id"]
        .as_str()
        .unwrap_or_else(|| panic!("no session id: {session}"))
        .to_string();
    assert_eq!(session["status"], "OPEN");

    // The code minted for us is ours, and nothing like the supplier's.
    let article = session["article_code"]
        .as_str()
        .unwrap_or_else(|| panic!("no article code: {session}"))
        .to_string();
    assert_eq!(article.len(), 8);
    assert!(article.chars().all(|c| c.is_ascii_digit()), "{article}");
    assert_ne!(article, SUPPLIER_CODE);

    let issued = fleet
        .cloud_post(
            &format!("/api/v1/article-setups/{session_id}/issue"),
            json!({ "issued_by": "merchandiser-1" }),
        )
        .await;
    assert_eq!(issued["status"], "ISSUED");
    let variants = issued["variants"]
        .as_array()
        .unwrap_or_else(|| panic!("no variants: {issued}"));
    assert_eq!(variants.len(), 2);
    assert_eq!(variants[0]["sku_code"], format!("{article}103"));
    assert_eq!(variants[0]["qr_payload"], format!("R1:{article}103"));
    assert_eq!(variants[1]["sku_code"], format!("{article}104"));

    fleet.sync().await;

    // --- 06 · The warehouse's print queue ---------------------------------
    // Identity assigned means untagged: the pile has not moved an inch, but
    // the system now knows what it has been holding.
    assert_eq!(fleet.pools().await, (0, DELIVERED, 0));

    let jobs = fleet.dc_get("/api/v1/dc/tagging-jobs").await;
    let job_list = jobs["items"]
        .as_array()
        .unwrap_or_else(|| panic!("no items: {jobs}"));
    assert_eq!(job_list.len(), 1);
    let job = &job_list[0];
    assert_eq!(job["total_quantity"], DELIVERED);
    let job_id = job["job_id"].clone();

    // Every label is here, finished, one per unit — computed at the centre
    // and merely carried by the warehouse.
    let mut labels = std::collections::HashSet::new();
    // Kept per SKU as well: picking works on one SKU at a time, so packing a
    // box needs the labels of that SKU and not a handful from the pile.
    let mut labels_by_sku: std::collections::BTreeMap<String, Vec<String>> =
        std::collections::BTreeMap::new();
    for line in job["lines"]
        .as_array()
        .unwrap_or_else(|| panic!("no lines: {job}"))
    {
        let epcs = line["epcs"]
            .as_array()
            .unwrap_or_else(|| panic!("no epcs: {line}"));
        assert_eq!(
            epcs.len() as i64,
            line["quantity"].as_i64().unwrap_or(0),
            "one label per unit on {}",
            line["sku_code"]
        );
        for epc in epcs {
            let hex = epc.as_str().unwrap_or_else(|| panic!("epc not a string"));
            assert_eq!(hex.len(), 24, "an EPC is 96 bits: {hex}");
            assert!(labels.insert(hex.to_string()), "duplicate EPC {hex}");
            labels_by_sku
                .entry(
                    line["sku_code"]
                        .as_str()
                        .unwrap_or_else(|| panic!("no sku_code: {line}"))
                        .to_string(),
                )
                .or_default()
                .push(hex.to_string());
        }
    }
    assert_eq!(labels.len(), DELIVERED as usize);

    // --- 07 · Tags on the goods -------------------------------------------
    let confirmed = fleet
        .dc_post(
            "/api/v1/dc/tagging-confirmations",
            json!({
                "job_id": job_id,
                "actor_id": "petugas-tag",
                "idempotency_key": "tag-1"
            }),
        )
        .await;
    assert_eq!(confirmed["tagged_units"], DELIVERED);

    assert_eq!(
        fleet.pools().await,
        (DELIVERED, 0, 0),
        "tagged goods are pickable stock"
    );

    // The job is gone from the print queue, because it is done.
    let remaining = fleet.dc_get("/api/v1/dc/tagging-jobs").await;
    assert_eq!(
        remaining["items"].as_array().map(Vec::len),
        Some(0),
        "a finished job must leave the queue"
    );

    // --- The centre hears -------------------------------------------------
    fleet.sync().await;
    let final_status = fleet
        .cloud_get(&format!("/api/v1/article-setups/{session_id}"))
        .await;
    assert_eq!(final_status["status"], "TAGGED");
    assert_eq!(final_status["job"]["status"], "TAGGED");
    assert_eq!(final_status["job"]["confirmed_by"], "petugas-tag");

    // And the order it all started from now reads as fully received.
    let orders = fleet.cloud_get("/api/v1/purchase-orders").await;
    let po_id = orders["items"][0]["purchase_order_id"]
        .as_str()
        .unwrap_or_else(|| panic!("no order: {orders}"))
        .to_string();
    let detail = fleet
        .cloud_get(&format!("/api/v1/purchase-orders/{po_id}"))
        .await;
    assert_eq!(detail["lines"][0]["received_quantity"], DELIVERED);

    // =====================================================================
    // The goods are now stock. What follows is the journey out again.
    // =====================================================================

    // --- 08 · The centre allots some of it to a store ---------------------
    //
    // The SKU id comes from availability rather than the database, because
    // that is the list a planner actually chooses from.
    let available = fleet.cloud_get("/api/v1/inventory/availability").await;
    let row = available["items"]
        .as_array()
        .and_then(|items| items.first())
        .unwrap_or_else(|| panic!("nothing available to allot: {available}"))
        .clone();
    let sku_id = row["sku_id"].clone();
    let sku_code = row["sku_code"]
        .as_str()
        .unwrap_or_else(|| panic!("no sku_code: {row}"))
        .to_string();

    // Availability is a keyset-paginated catalogue. A warehouse with a large
    // range must not serialize every SKU merely because the planner opened the
    // screen.
    let first_page = fleet
        .cloud_get("/api/v1/inventory/availability?limit=1")
        .await;
    assert_eq!(first_page["limit"], 1);
    assert_eq!(first_page["items"].as_array().map(Vec::len), Some(1));
    if let Some(cursor) = first_page["next_cursor"].as_str() {
        let second_page = fleet
            .cloud_get(&format!(
                "/api/v1/inventory/availability?limit=1&cursor={cursor}"
            ))
            .await;
        assert_ne!(
            first_page["items"][0]["sku_code"],
            second_page["items"][0]["sku_code"]
        );
    }

    let allotment = fleet
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
    assert_eq!(allotment["status"], "ACTIVE");

    // The order to move goods rides down the same command path the purchase
    // order and the tagging job took.
    fleet.sync().await;

    // --- 09 · Picking -----------------------------------------------------
    //
    // One picker, one walk down the aisles, several racks. The sheet says a SKU
    // and a number and no store at all: which piece serves which shop is
    // settled when it goes into a box.
    let round = fleet
        .dc_post(
            "/api/v1/dc/pick-sessions",
            json!({ "actor_id": "picker-1", "note": "ronde pagi" }),
        )
        .await;
    let round_id = round["session_id"]
        .as_str()
        .unwrap_or_else(|| panic!("no session_id: {round}"))
        .to_string();

    // The sheet the picker carries lists everything still owed, by SKU.
    let sheet = fleet.dc_get("/api/v1/dc/picklist").await;
    assert!(
        sheet["lines"]
            .as_array()
            .is_some_and(|lines| !lines.is_empty()),
        "a picker walks out with a list, not a single line: {sheet}"
    );

    let picked = fleet
        .dc_post(
            "/api/v1/dc/picks",
            json!({
                "source_pool_id": format!("{DC_SITE}.warehouse"),
                "sku_code": sku_code,
                "quantity": ALLOTTED,
                "actor_id": "picker-1",
                "idempotency_key": "pick-1",
                "pick_session_id": round_id
            }),
        )
        .await;
    assert_eq!(picked["quantity"], ALLOTTED);

    // Picking is a physical move, and the ledger says so: the garments are in
    // the outbound area now, not on the racks.
    //
    // Checked against the picking pool rather than the warehouse, because the
    // warehouse figure a screen shows is physical stock MINUS what is already
    // allotted — a display convention that would make this assertion say two
    // things at once.
    assert_eq!(
        fleet
            .pool_on_hand(&format!("{DC_SITE}.outbound.picking"))
            .await,
        ALLOTTED,
        "the picked garments are off the racks and in the outbound area"
    );
    // A second rack on the same walk. Two allotments are open — one per size —
    // so the other SKU is fetched in the same round.
    let other_sku = available["items"]
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|item| item["sku_code"] != json!(sku_code))
        })
        .map(|item| item["sku_code"].clone());

    if let Some(other) = other_sku.as_ref().and_then(|value| value.as_str()) {
        let second = fleet
            .cloud_post(
                "/api/v1/inventory/allotments",
                json!({
                    "type": "TO_STORE",
                    "lines": [{
                        "source_site_id": DC_SITE,
                        "source_pool_id": format!("{DC_SITE}.warehouse"),
                        "destination_type": "STORE",
                        "destination_id": STORE_SITE,
                        "sku_id": available["items"]
                            .as_array()
                            .and_then(|items| items.iter()
                                .find(|item| item["sku_code"] == json!(other)))
                            .map(|item| item["sku_id"].clone())
                            .unwrap_or(Value::Null),
                        "quantity": SECOND_RACK
                    }],
                    "actor_id": "perencana-1",
                    "idempotency_key": "allot-2"
                }),
            )
            .await;
        assert_eq!(second["status"], "ACTIVE");
        fleet.sync().await;

        fleet
            .dc_post(
                "/api/v1/dc/picks",
                json!({
                    "source_pool_id": format!("{DC_SITE}.warehouse"),
                    "sku_code": other,
                    "quantity": SECOND_RACK,
                    "actor_id": "picker-1",
                    "idempotency_key": "pick-2",
                    "pick_session_id": round_id
                }),
            )
            .await;
    }

    // And nothing was promised to anyone by fetching it. The allotment still
    // wants its full 40: what a picker carries is not yet anybody's.
    let untouched = fleet
        .dc_get(&format!("/api/v1/dc/destinations/{STORE_SITE}/outstanding"))
        .await;
    let for_our_sku = untouched["lines"]
        .as_array()
        .and_then(|lines| {
            lines
                .iter()
                .find(|line| line["sku_code"] == json!(sku_code))
        })
        .unwrap_or_else(|| panic!("nothing outstanding: {untouched}"));
    assert_eq!(
        for_our_sku["wanted"], ALLOTTED,
        "picking commits to no destination: {for_our_sku}"
    );
    assert_eq!(
        for_our_sku["available"], ALLOTTED,
        "and the goods are off the racks, waiting for whoever needs them"
    );

    // One round, several racks — which is the whole reason a round exists.
    let walk = fleet
        .dc_get(&format!("/api/v1/dc/pick-sessions/{round_id}"))
        .await;
    assert_eq!(
        walk["sku_count"], 2,
        "a picker does not walk out for one SKU: {walk}"
    );
    assert_eq!(walk["total_picked"], ALLOTTED + SECOND_RACK);
    assert_eq!(walk["session"]["actor_id"], "picker-1");

    // --- 10 · The handheld: a box, its target, and the sweep that closes it
    //
    // Provisioning, not a business action — the same category as registering
    // the node's credential above, and called the same way. Handing a handheld
    // its key is something an administrator does once, long before any of this.
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
    // Registering a device does not, on its own, tell the DC about it. The
    // policy has to be published, which is what puts it on the command path.
    cloud::publish_auth_policy(&fleet.cloud.db, DC_ORIGIN, "admin")
        .await
        .unwrap_or_else(|e| panic!("publish policy: {e}"));
    let device_key = device["device_key"]
        .as_str()
        .unwrap_or_else(|| panic!("no one-time device key: {device}"))
        .to_string();
    fleet.sync().await;

    // What is still picked and unpacked for this store — the sheet the packer
    // is offered when they start a box.
    let waiting = fleet
        .dc_get(&format!("/api/v1/dc/destinations/{STORE_SITE}/outstanding"))
        .await;
    assert!(
        waiting["lines"]
            .as_array()
            .is_some_and(|lines| lines.iter().any(|line| line["sku_code"] == json!(sku_code))),
        "the picked goods should be waiting for a box: {waiting}"
    );

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
        .unwrap_or_else(|| panic!("no session_id: {opened}"))
        .to_string();
    assert_eq!(opened["ready"], json!(false), "nothing is packed yet");

    let epcs: Vec<String> = labels_by_sku
        .get(&sku_code)
        .unwrap_or_else(|| panic!("no labels for {sku_code}: {labels_by_sku:?}"))
        .iter()
        .take(ALLOTTED as usize)
        .cloned()
        .collect();
    assert_eq!(epcs.len(), ALLOTTED as usize);

    // The sweep, as the handheld sends it: observations tagged with a reader
    // session, signed by the device.
    let sweep = |reader_session: &str, seen: &[String]| {
        serde_json::to_vec(&json!({
            "site_id": DC_SITE,
            "pool": format!("{DC_SITE}.warehouse"),
            "reader_session_id": reader_session,
            "observed_at": chrono::Utc::now(),
            "idempotency_key": format!("sweep-{reader_session}"),
            "observations": seen.iter()
                .map(|epc| json!({"epc": epc, "antenna": "A1", "rssi": -47.0, "read_count": 4}))
                .collect::<Vec<_>>()
        }))
        .unwrap_or_else(|e| panic!("sweep body: {e}"))
    };
    let proof = |sequence: i64, body: &[u8]| {
        let timestamp = chrono::Utc::now().timestamp();
        let signing_key = derive_rfid_signing_key(&device_key);
        vec![
            ("x-device-id".to_string(), "RFID-DC-PACK".to_string()),
            ("x-device-timestamp".to_string(), timestamp.to_string()),
            ("x-device-sequence".to_string(), sequence.to_string()),
            (
                "x-device-signature".to_string(),
                sign_rfid_request(
                    &signing_key,
                    "RFID-DC-PACK",
                    timestamp,
                    sequence,
                    &security::sha256_hex(body),
                ),
            ),
        ]
    };

    // First a short sweep: the packer has not finished filling the box.
    let short = sweep("sweep-short", &epcs[..epcs.len() - 1]);
    let (status, sweep_body) = call_signed(
        fleet.dc_router(),
        "POST",
        "/api/v1/rfid/observations",
        proof(1, &short),
        short.clone(),
    )
    .await;
    assert!(
        status.is_success(),
        "the sweep should be accepted: {status} {sweep_body}"
    );

    let short_capture = fleet
        .dc_post(
            &format!("/api/v1/dc/packing-boxes/{box_id}/capture"),
            json!({ "reader_session_id": "sweep-short" }),
        )
        .await;
    assert_eq!(
        short_capture["matched"],
        json!(false),
        "a box one garment short must not close: {short_capture}"
    );
    assert_eq!(short_capture["lines"][0]["target_qty"], ALLOTTED);
    assert_eq!(short_capture["lines"][0]["scanned_qty"], ALLOTTED - 1);
    assert_eq!(
        fleet
            .dc_get(&format!("/api/v1/dc/packing-boxes/{box_id}"))
            .await["ready"],
        json!(false),
        "and nothing may be printed from it"
    );

    // The packer finds the missing piece and sweeps again.
    let full = sweep("sweep-full", &epcs);
    let (status, _) = call_signed(
        fleet.dc_router(),
        "POST",
        "/api/v1/rfid/observations",
        proof(2, &full),
        full.clone(),
    )
    .await;
    assert!(status.is_success(), "second sweep: {status}");

    let agreed = fleet
        .dc_post(
            &format!("/api/v1/dc/packing-boxes/{box_id}/capture"),
            json!({ "reader_session_id": "sweep-full" }),
        )
        .await;
    assert_eq!(agreed["matched"], json!(true), "{agreed}");
    assert!(agreed["unexpected"].as_array().is_some_and(Vec::is_empty));
    assert!(agreed["unknown_epcs"].as_array().is_some_and(Vec::is_empty));

    // --- 11 · Agreement is the seal --------------------------------------
    //
    // No verify button and no seal button: a box whose sweep matches its target
    // has nothing left to decide, so it froze the moment the two agreed.
    let ready = fleet
        .dc_get(&format!("/api/v1/dc/packing-boxes/{box_id}"))
        .await;
    assert_eq!(ready["ready"], json!(true), "{ready}");
    let koli_id = ready["koli_id"]
        .as_str()
        .unwrap_or_else(|| panic!("no koli behind the box: {ready}"))
        .to_string();

    let manifest = fleet.dc_get(&format!("/api/v1/dc/koli/{koli_id}")).await;
    assert!(
        manifest["koli"]["sealed_at"].as_str().is_some(),
        "the box froze when the sweep agreed: {manifest}"
    );
    let koli_number = manifest["koli"]["koli_number"]
        .as_str()
        .unwrap_or_else(|| panic!("no koli_number: {manifest}"))
        .to_string();
    assert!(
        koli_number.starts_with(&format!("KOLI-{DC_SITE}-")),
        "a koli number carries the DC that minted it: {koli_number}"
    );
    assert_eq!(manifest["qr_payload"], json!(format!("K1:{koli_number}")));
    assert!(
        manifest["qr_svg"]
            .as_str()
            .is_some_and(|svg| svg.contains("<svg")),
        "the packing list needs a scannable code, generated here and not in a browser"
    );
    assert_eq!(manifest["koli"]["unit_count"], ALLOTTED);
    assert_eq!(manifest["koli"]["position"], "PACKED");

    // --- 12 · The surat jalan --------------------------------------------
    let shipment = fleet
        .dc_post(
            "/api/v1/dc/shipments",
            json!({ "koli_ids": [koli_id], "actor_id": "supervisor-1" }),
        )
        .await;
    let shipment_id = shipment["shipment_id"]
        .as_str()
        .unwrap_or_else(|| panic!("no shipment_id: {shipment}"))
        .to_string();
    assert!(
        shipment["shipment_number"]
            .as_str()
            .is_some_and(|number| number.starts_with(&format!("SJ-{DC_SITE}-"))),
        "the consignment number is what a store signs against: {shipment}"
    );
    assert_eq!(shipment["koli_count"], 1);
    assert_eq!(shipment["unit_count"], ALLOTTED);
    assert_eq!(
        shipment["position"], "SHIPMENT",
        "gathered, not yet loaded — and nothing said so but containment"
    );

    // --- 13 · The truck ---------------------------------------------------
    let dispatch = fleet
        .dc_post(
            "/api/v1/dc/dispatches",
            json!({
                "shipment_ids": [shipment_id],
                "carrier": "Kilat Ekspres",
                "vehicle_plate": "B 1234 XY",
                "driver_name": "Pak Slamet",
                "actor_id": "supervisor-1"
            }),
        )
        .await;
    let dispatch_id = dispatch["dispatch_id"]
        .as_str()
        .unwrap_or_else(|| panic!("no dispatch_id: {dispatch}"))
        .to_string();
    assert_eq!(dispatch["shipment_count"], 1);
    assert_eq!(dispatch["koli_count"], 1);

    // Loaded but still on the yard.
    let loaded = fleet.dc_get(&format!("/api/v1/dc/koli/{koli_id}")).await;
    assert_eq!(
        loaded["koli"]["position"], "LOADED",
        "on the truck, not yet gone"
    );

    let gone = fleet
        .dc_post(
            &format!("/api/v1/dc/dispatches/{dispatch_id}/depart"),
            json!({}),
        )
        .await;
    assert!(
        gone["departed_at"].as_str().is_some(),
        "departure is the one stage change that moves goods in the world: {gone}"
    );

    // --- The whole chain, read back from containment alone ----------------
    let after = fleet.dc_get(&format!("/api/v1/dc/koli/{koli_id}")).await;
    assert_eq!(after["koli"]["position"], "IN_TRANSIT");

    // And a departed truck takes no more cargo.
    let (status, refused) = call(
        fleet.dc_router(),
        "POST",
        &format!("/api/v1/dc/dispatches/{dispatch_id}/depart"),
        Some(json!({})),
    )
    .await;
    assert!(
        status.is_client_error(),
        "a second departure must be refused, got {status}: {refused}"
    );

    // The centre hears the whole journey, and nothing is stuck: a pick that
    // allots nothing, a pack that allots, and a truck that left.
    fleet.sync().await;
    let picks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM edge_allotment_pick_fact")
        .fetch_one(&fleet.cloud.db)
        .await
        .unwrap_or_else(|e| panic!("count pick facts: {e}"));
    assert_eq!(picks, 2, "both racks on the walk reached the centre");
    let dead: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_dead_letter")
        .fetch_one(&fleet.cloud.db)
        .await
        .unwrap_or_else(|e| panic!("count dead letters: {e}"));
    assert_eq!(dead, 0, "nothing was rejected on the way up");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_api_refuses_variants_that_do_not_account_for_the_delivery(pool: PgPool) {
    // The rule that stops stock being invented, checked at the edge of the
    // system rather than only in a function nobody can reach.
    let fleet = fleet(pool).await;
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
                "verifier_actor_id": "verifier-1",
                "idempotency_key": "verify-1"
            }),
        )
        .await;
    fleet.sync().await;

    let waiting = fleet.cloud_get("/api/v1/article-setups/unidentified").await;
    let receipt_line_id = waiting["items"][0]["receipt_line_id"].clone();

    // 60 + 50 = 110, but 118 arrived. Eight garments would be stranded in
    // `unidentified` with no job that will ever rescue them.
    let mut short = setup_body(&receipt_line_id);
    short["variants"][1]["quantity"] = json!(50);
    let (status, body) = call(
        fleet.cloud_router(),
        "POST",
        "/api/v1/article-setups",
        Some(short),
    )
    .await;
    assert_eq!(status, http::StatusCode::BAD_REQUEST, "{body}");
    assert!(
        body.to_string().contains("118"),
        "the refusal must say what did not add up: {body}"
    );

    // And the sound one still works, so the refusal was about the arithmetic.
    let sound = fleet
        .cloud_post("/api/v1/article-setups", setup_body(&receipt_line_id))
        .await;
    assert_eq!(sound["status"], "OPEN");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_tagging_job_cannot_be_confirmed_twice_over_http(pool: PgPool) {
    let fleet = fleet(pool).await;
    fleet
        .cloud_post("/api/v1/purchase-orders", order_body())
        .await;
    fleet.sync().await;

    let work = fleet.dc_get("/api/v1/dc/purchase-orders").await;
    let count = fleet
        .dc_post(
            "/api/v1/dc/purchase-counts",
            json!({
                "receipt_id": fleet.delivery().await,
                "po_line_id": work["items"][0]["po_line_id"],
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
                "verifier_actor_id": "verifier-1",
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
        .unwrap_or_else(|| panic!("no session id"))
        .to_string();
    fleet
        .cloud_post(
            &format!("/api/v1/article-setups/{session_id}/issue"),
            json!({ "issued_by": "merchandiser-1" }),
        )
        .await;
    fleet.sync().await;

    let jobs = fleet.dc_get("/api/v1/dc/tagging-jobs").await;
    let job_id = jobs["items"][0]["job_id"].clone();
    let confirm = json!({
        "job_id": job_id,
        "actor_id": "petugas-tag",
        "idempotency_key": "tag-1"
    });

    // A retry of the same request — how a flaky connection ordinarily ends —
    // must return the same answer, not tag the goods a second time.
    let first = fleet
        .dc_post("/api/v1/dc/tagging-confirmations", confirm.clone())
        .await;
    let again = fleet
        .dc_post("/api/v1/dc/tagging-confirmations", confirm)
        .await;
    assert_eq!(first["movement_group_id"], again["movement_group_id"]);
    assert_eq!(fleet.pools().await, (DELIVERED, 0, 0));

    // A genuinely new attempt on a finished job is a conflict, not a silent
    // second tagging run.
    let (status, body) = call(
        fleet.dc_router(),
        "POST",
        "/api/v1/dc/tagging-confirmations",
        Some(json!({
            "job_id": job_id,
            "actor_id": "petugas-tag",
            "idempotency_key": "tag-2"
        })),
    )
    .await;
    assert_eq!(status, http::StatusCode::CONFLICT, "{body}");
}

/// The picker a price book is written with.
///
/// A book names products by `sku_id`, and until this route existed nothing gave
/// one out: the prices screen answers by style and carries no id at all. So the
/// authoring form had no way to turn "that white shirt" into a row the server
/// would accept, and the gap was invisible — every screen looked complete.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_products_a_price_book_can_name_come_back_with_what_they_cost(pool: PgPool) {
    let article = Uuid::new_v4();
    sqlx::query("INSERT INTO article (id, article_code, name) VALUES ($1,'KEMEJA','Kemeja Putih')")
        .bind(article)
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("article: {e}"));
    let sku = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO sku (id, article_id, sku_code, color, size)
         VALUES ($1,$2,'KEMEJA-PUTIH-M','PUTIH','M')",
    )
    .bind(sku)
    .bind(article)
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("sku: {e}"));

    // Before any book names it: present, and honestly priceless.
    let found = cloud::commercial_products(&pool, Some("kemeja"), 20)
        .await
        .unwrap_or_else(|e| panic!("products: {e}"));
    assert_eq!(found["items"][0]["sku_code"], "KEMEJA-PUTIH-M");
    assert!(
        found["items"][0]["unit_price_minor"].is_null(),
        "a product no book has priced must not read as costing zero: {found}"
    );

    // Two books name it. The newer one is what it costs.
    // Numbers nobody else in this fixture has taken: the schema seeds a book at
    // v1, and a version is unique across the whole table.
    for (version, price) in [(901_i64, 200_000_i64), (902, 180_000)] {
        let publication = Uuid::new_v4();
        // Written as a DRAFT and published afterwards, which is the order the
        // real thing uses and the only order migration 0073 permits: a
        // published book is frozen, so a price cannot be added to one.
        sqlx::query(
            "INSERT INTO commercial_publication
                 (id, version, name, status, effective_from, created_by)
             VALUES ($1,$2,$3,'DRAFT',now(),'test')",
        )
        .bind(publication)
        .bind(version)
        .bind(format!("Harga v{version}"))
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("publication: {e}"));
        sqlx::query(
            "INSERT INTO commercial_price_rule
                 (id, publication_id, sku_id, site_id, channel, currency,
                  unit_price_minor, tax_category)
             VALUES ($1,$2,$3,NULL,'STORE','IDR',$4,'STANDARD')",
        )
        .bind(Uuid::new_v4())
        .bind(publication)
        .bind(sku)
        .bind(price)
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("price rule: {e}"));
        sqlx::query(
            "UPDATE commercial_publication
                SET status='PUBLISHED', published_by='test', published_at=now()
              WHERE id=$1",
        )
        .bind(publication)
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("publish: {e}"));
    }

    let found = cloud::commercial_products(&pool, Some("KEMEJA-PUTIH"), 20)
        .await
        .unwrap_or_else(|e| panic!("products: {e}"));
    assert_eq!(
        found["items"][0]["unit_price_minor"], 180_000,
        "the newest published book that names it wins, which is the same rule \
         the engine applies: {found}"
    );

    // Searchable by description as well as by code, because those are the two
    // things somebody has in front of them.
    let by_name = cloud::commercial_products(&pool, Some("putih"), 20)
        .await
        .unwrap_or_else(|e| panic!("by name: {e}"));
    assert_eq!(by_name["items"].as_array().map(Vec::len), Some(1));
}
