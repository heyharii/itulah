//! One garment, the whole way: ordered, delivered, counted, identified,
//! tagged, priced, allotted, picked, packed, shipped, driven to a shop,
//! received, put on the floor, and sold — with the takings reaching the centre
//! and reconciling.
//!
//! Three nodes, as in production: the centre on Postgres, a DC on SQLite, and
//! a shop on SQLite. Nothing here reaches across into another node's database.
//! What one node knows, it was told.
//!
//! # What is and is not driven by API
//!
//! Every action a PERSON takes goes over HTTP, against the same routers the
//! servers mount — including at the shop, which the older end-to-end test
//! never reached.
//!
//! Four things are called directly, because in production they are background
//! workers or administrative provisioning rather than endpoints: each edge's
//! sync cycle, the centre's apply agent, publishing the catalogue, and
//! registering a node's credentials. Driving them here is what a test does
//! instead of waiting for a timer.
//!
//! # Why this exists beside `api_flow_integration.rs`
//!
//! That one ends when the truck leaves the yard. This one follows the truck.
//! The half after the yard is where three separate silent failures lived —
//! prices that reached a shop and were never read, a sale fact carrying the
//! wrong prices, and a promotion whose campaign never arrived — and every one
//! of them was invisible to a test that stopped at dispatch.

use axum::body::{to_bytes, Body};
use http::Request;
use inventory_backend::cloud::application::RegisterRfidDeviceRequest;
use inventory_backend::cloud::domain::{BreakerPolicy, IngestBatch, IngestResponse};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::edge::rfid::{derive_rfid_signing_key, sign_rfid_request};
use inventory_backend::edge::{
    dc_router_with_auth, store_router_with_auth, EdgeAuth, EdgeAuthConfig, EdgeInventory, EdgeRole,
    NodeContext, SiteId, SqliteEdge, SqliteSyncStore,
};
use inventory_backend::security;
use inventory_backend::sync::port::{SyncConfig, SyncTransport};
use inventory_backend::sync::{run_cycle, CycleReport};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{collections::BTreeMap, net::SocketAddr, path::PathBuf, sync::Arc};
use tower::ServiceExt;
use uuid::Uuid;

const DC_ORIGIN: &str = "dc-01-edge";
/// The DC the cloud actually knows about. `operational_pool` is seeded with
/// `dc.warehouse` on site `dc`, and `allotment` still carries
/// `CHECK (source_pool_id = 'dc.warehouse')` — so this is not a name the test
/// may choose freely.
const DC_SITE: &str = "dc";
const DC_KEY: &str = "dc-01-full-chain-sync-key-000001";

const STORE_ORIGIN: &str = "store-01-edge";
const STORE_SITE: &str = "store-01";
const STORE_KEY: &str = "store-01-full-chain-sync-key-0001";

const SUPPLIER_CODE: &str = "SANDANG-KMJ-LP-01";
const DELIVERED: i64 = 60;
/// How much of the delivery this shop gets.
const ALLOTTED: i64 = 12;

/// What head office decides the shirt sells for, company-wide.
const COMPANY_PRICE: i64 = 450_000;
/// And what this one shop sells it for.
const SHOP_PRICE: i64 = 399_000;
/// The clearance that replaces the shop price for the colour that is not
/// moving. Deliberately unlike every other number in this file, so a wrong one
/// cannot pass by coincidence.
const CLEARANCE: i64 = 249_000;
/// What the goods were booked in at when they arrived. Never a selling price,
/// and different from all of the above so a fallback cannot hide here.
const INTAKE_PRICE: i64 = 300_000;

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

/// A call that must succeed. On failure the body is in the panic, because a
/// bare status code tells nobody what to fix.
async fn ok(router: axum::Router, method: &str, uri: &str, body: Option<Value>) -> Value {
    let (status, value) = call(router, method, uri, body).await;
    assert!(
        status.is_success(),
        "{method} {uri} returned {status}: {value}"
    );
    value
}

// ---------------------------------------------------------------------------
// The fleet
// ---------------------------------------------------------------------------

struct Fleet {
    cloud: AppState,
    dc: Arc<SqliteEdge>,
    store: Arc<SqliteEdge>,
}

impl Fleet {
    fn cloud_router(&self) -> axum::Router {
        cloud_http::router(self.cloud.clone())
    }

    /// Built on the edge's own connection, not a throwaway one — a handheld
    /// proves itself against the device table, and a router that cannot see
    /// the real one rejects every sweep as coming from an unknown device.
    fn dc_router(&self) -> axum::Router {
        let inventory: Arc<dyn EdgeInventory> = self.dc.clone();
        let auth = Arc::new(
            EdgeAuth::new(
                self.dc.connection(),
                self.dc.node().clone(),
                EdgeAuthConfig::disabled(),
            )
            .unwrap_or_else(|e| panic!("dc auth: {e}")),
        );
        dc_router_with_auth(inventory, auth, frontend())
            .unwrap_or_else(|e| panic!("dc router: {e}"))
    }

    fn store_router(&self) -> axum::Router {
        let inventory: Arc<dyn EdgeInventory> = self.store.clone();
        let auth = Arc::new(
            EdgeAuth::new(
                self.store.connection(),
                self.store.node().clone(),
                EdgeAuthConfig::disabled(),
            )
            .unwrap_or_else(|e| panic!("store auth: {e}")),
        );
        store_router_with_auth(inventory, auth, frontend())
            .unwrap_or_else(|e| panic!("store router: {e}"))
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
    async fn store_get(&self, uri: &str) -> Value {
        ok(self.store_router(), "GET", uri, None).await
    }
    async fn store_post(&self, uri: &str, body: Value) -> Value {
        ok(self.store_router(), "POST", uri, Some(body)).await
    }

    async fn dc_pools(&self) -> (i64, i64, i64) {
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

    async fn store_pool_on_hand(&self, pool_id: &str) -> i64 {
        let body = self.store_get("/api/v1/inventory/pools").await;
        body["items"]
            .as_array()
            .unwrap_or_else(|| panic!("no items in {body}"))
            .iter()
            .find(|item| item["id"] == json!(pool_id))
            .and_then(|item| item["on_hand"].as_i64())
            .unwrap_or_else(|| panic!("no pool {pool_id} in {body}"))
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

    /// Drive the background workers: both edges upload over HTTP and take
    /// their commands, then the centre applies what it received.
    async fn sync(&self) {
        self.cycle(&self.dc, DC_KEY).await;
        self.cycle(&self.store, STORE_KEY).await;
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
        for _ in 0..20 {
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

/// An edge's upload, as it really travels: a POST to the cloud's ingest route.
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

/// Provisioning: a node exists because somebody gave it a credential.
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

    let dc_site = SiteId::new(DC_SITE).unwrap_or_else(|e| panic!("dc site: {e}"));
    let dc_node =
        NodeContext::new(DC_ORIGIN, EdgeRole::Dc, dc_site).unwrap_or_else(|e| panic!("dc: {e}"));
    let store_site = SiteId::new(STORE_SITE).unwrap_or_else(|e| panic!("store site: {e}"));
    let store_node = NodeContext::new(STORE_ORIGIN, EdgeRole::Store, store_site)
        .unwrap_or_else(|e| panic!("store: {e}"));

    Fleet {
        cloud: AppState::new(pool, cloud_config()),
        dc: Arc::new(
            SqliteEdge::open_in_memory(dc_node).unwrap_or_else(|e| panic!("dc edge: {e}")),
        ),
        store: Arc::new(
            SqliteEdge::open_in_memory(store_node).unwrap_or_else(|e| panic!("store edge: {e}")),
        ),
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
            "division_code": "MENSWEAR",
            "tags": ["KEMEJA", "LENGAN_PANJANG"],
            "ordered_quantity": 60,
            "unit_price_minor": INTAKE_PRICE
        }]
    })
}

fn setup_body(receipt_line_id: &Value) -> Value {
    json!({
        "receipt_line_id": receipt_line_id,
        "article_name": "Kemeja Lengan Panjang Merah",
        "division_code": "MENSWEAR",
        "tags": ["KEMEJA", "LENGAN_PANJANG"],
        "image_url": "https://cdn.itulah.co.id/kemeja-merah.jpg",
        "currency": "IDR",
        "created_by": "merchandiser-1",
        "colours": [{ "colour_digit": "1", "label": "Merah", "hex_code": "#C0392B" }],
        "variants": [
            { "colour_digit": "1", "size_code": "03", "quantity": 30, "base_price_minor": INTAKE_PRICE },
            { "colour_digit": "1", "size_code": "04", "quantity": 30, "base_price_minor": INTAKE_PRICE }
        ]
    })
}

// ===========================================================================

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_shirt_travels_from_a_purchase_order_to_a_customer(pool: PgPool) {
    let fleet = fleet(pool).await;

    // --- 01 · A buyer raises the order ------------------------------------
    let raised = fleet
        .cloud_post("/api/v1/purchase-orders", order_body())
        .await;
    assert_eq!(raised["sent_to_origin"], DC_ORIGIN);
    fleet.sync().await;

    // --- 02 · The warehouse counts it, blind ------------------------------
    let work = fleet.dc_get("/api/v1/dc/purchase-orders").await;
    let po_line_id = work["items"][0]["po_line_id"].clone();
    assert!(
        work["items"][0]["expected_stock_units"].is_null(),
        "a blind count does not show the checker the number they must produce"
    );

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

    // --- 03 · A second person accepts it ----------------------------------
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
    assert_eq!(
        fleet.dc_pools().await,
        (0, 0, DELIVERED),
        "goods exist, and nobody has said what they are yet"
    );

    // --- 04 · Head office says what it is ---------------------------------
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
    let variants = issued["variants"]
        .as_array()
        .unwrap_or_else(|| panic!("no variants: {issued}"))
        .clone();
    assert_eq!(variants.len(), 2);

    // Setting up an article decides what it sells for, so setting it up
    // publishes that price. Nothing else has to happen for the goods to be
    // sellable — which is the point: a garment must not arrive at a shop
    // unsellable because a separate price book never mentioned it.
    fleet.sync().await;

    // --- 05 · The warehouse tags the goods --------------------------------
    let jobs = fleet.dc_get("/api/v1/dc/tagging-jobs").await;
    let job = &jobs["items"][0];
    let job_id = job["job_id"].clone();
    let mut labels_by_sku: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for line in job["lines"]
        .as_array()
        .unwrap_or_else(|| panic!("no lines: {job}"))
    {
        let sku = line["sku_code"]
            .as_str()
            .unwrap_or_else(|| panic!("no sku_code: {line}"))
            .to_string();
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
                "job_id": job_id,
                "actor_id": "petugas-tag",
                "idempotency_key": "tag-1"
            }),
        )
        .await;
    assert_eq!(
        fleet.dc_pools().await,
        (DELIVERED, 0, 0),
        "tagged goods are pickable stock"
    );
    fleet.sync().await;

    // =====================================================================
    // 06 · What it sells for
    //
    // Head office decides once, and every shop is told. This half of the
    // chain is the one that used to be missing: the prices arrived at a shop,
    // were stored faithfully, and were read by nothing.
    // =====================================================================
    let availability = fleet.cloud_get("/api/v1/inventory/availability").await;
    // The two SKUs are the ones this setup minted — taken from the setup's own
    // answer rather than fished out of availability, which also lists the
    // demo seed and would make this depend on how much else is in the shop.
    let mut minted: Vec<String> = variants
        .iter()
        .map(|variant| {
            variant["sku_code"]
                .as_str()
                .unwrap_or_else(|| panic!("no sku_code: {variant}"))
                .to_string()
        })
        .collect();
    minted.sort();
    let (sku_code, other_sku_code) = (minted[0].clone(), minted[1].clone());

    let sku_id_of = |code: &str| -> Value {
        availability["items"]
            .as_array()
            .unwrap_or_else(|| panic!("nothing available: {availability}"))
            .iter()
            .find(|item| item["sku_code"] == json!(code))
            .unwrap_or_else(|| panic!("{code} is not available: {availability}"))["sku_id"]
            .clone()
    };
    let sku_id = sku_id_of(&sku_code);

    // The shop's product list. Published by the agent that runs on a timer in
    // the server, driven here rather than waited for — the same thing this
    // test does with the sync cycles.
    //
    // Nothing tells it to run. It notices that the product list has changed,
    // which is the point: setting up an article mints SKUs, and nobody has to
    // remember to announce them.
    let generation = cloud::publish_catalog_if_changed(&fleet.cloud.db, "system:catalog-publisher")
        .await
        .unwrap_or_else(|e| panic!("publish catalogue: {e}"))
        .unwrap_or_else(|| panic!("new products must produce a new catalogue"));
    assert!(generation > 0);

    // And a second pass sends nothing, because nothing changed. Without this
    // the agent would flood every shop's command lane with a list it already
    // holds, every five minutes, forever.
    assert!(
        cloud::publish_catalog_if_changed(&fleet.cloud.db, "system:catalog-publisher")
            .await
            .unwrap_or_else(|e| panic!("second pass: {e}"))
            .is_none(),
        "an unchanged catalogue must not be republished"
    );

    // A price book is a list of CHANGES, not a full replacement.
    //
    // This used to have to name every active SKU in the company — including
    // the demo seed's — because publishing refused anything less. It names
    // three prices for two products now, and everything else keeps whatever
    // the last book gave it.
    let offer_rules: Vec<Value> = vec![
        json!({
            "sku_id": sku_id, "site_id": null, "channel": "STORE",
            "sellable": true, "currency": "IDR",
            "unit_price_minor": COMPANY_PRICE, "tax_category": "STANDARD"
        }),
        json!({
            "sku_id": sku_id, "site_id": STORE_SITE, "channel": "STORE",
            "sellable": true, "currency": "IDR",
            "unit_price_minor": SHOP_PRICE, "tax_category": "STANDARD"
        }),
        json!({
            "sku_id": sku_id_of(&other_sku_code), "site_id": null, "channel": "STORE",
            "sellable": true, "currency": "IDR",
            "unit_price_minor": COMPANY_PRICE, "tax_category": "STANDARD"
        }),
    ];

    // The price book: a company price for everything, one shop price for this
    // branch, and a clearance on the size that is not moving.
    let draft = fleet
        .cloud_post(
            "/api/v1/commercial/publications",
            json!({
                // The demo seed already holds version 1, and a version is
                // unique across the fleet.
                "version": 99,
                "name": "Harga Lebaran 2026",
                "effective_from": "2020-01-01T00:00:00Z",
                "effective_to": null,
                "actor_id": "merchandiser-1",
                "idempotency_key": "pub-1",
                "tax_rules": [
                    {"tax_category": "STANDARD", "rate_bps": 1100, "tax_inclusive": true}
                ],
                "offer_rules": offer_rules,
                "markdowns": [{
                    "markdown_id": "MD-SISA-SIZE",
                    "sku_code": other_sku_code,
                    "replacement_unit_price_minor": CLEARANCE,
                    "effective_from": "2020-01-01T00:00:00Z"
                }]
            }),
        )
        .await;
    let publication_id = draft["id"]
        .as_str()
        .unwrap_or_else(|| panic!("no publication id: {draft}"))
        .to_string();
    assert_eq!(
        draft["status"], "DRAFT",
        "nothing is live until it is published"
    );

    let published = fleet
        .cloud_post(
            &format!("/api/v1/commercial/publications/{publication_id}/publish"),
            json!({ "actor_id": "merchandiser-1", "idempotency_key": "publish-1" }),
        )
        .await;
    assert_eq!(published["status"], "PUBLISHED");
    assert_eq!(
        published["delivered_to"],
        json!([STORE_ORIGIN]),
        "publishing must actually send the book to the shops: {published}"
    );

    fleet.sync().await;

    // The shop's own screen, over its own API. The number here is the number
    // the counter will take — that is the property, and it is asserted against
    // a shop price that differs from the company price and from intake.
    let shelf = fleet.store_get("/api/v1/store/catalog").await;
    assert_eq!(shelf["has_price_book"], json!(true), "{shelf}");
    let listed = shelf["items"]
        .as_array()
        .unwrap_or_else(|| panic!("no catalogue items: {shelf}"));
    assert_eq!(listed.len(), 2, "both sizes are sellable here");

    let on_shelf = |code: &str| -> Value {
        listed
            .iter()
            .find(|item| item["sku_code"] == json!(code))
            .unwrap_or_else(|| panic!("{code} is not on the shelf: {shelf}"))
            .clone()
    };
    assert_eq!(on_shelf(&sku_code)["unit_price_minor"], SHOP_PRICE);
    assert_eq!(on_shelf(&sku_code)["price_source"], "SITE_PRICE");
    assert_eq!(on_shelf(&other_sku_code)["unit_price_minor"], CLEARANCE);
    assert_eq!(on_shelf(&other_sku_code)["price_source"], "MARKDOWN");
    assert_eq!(
        on_shelf(&other_sku_code)["base_unit_price_minor"],
        COMPANY_PRICE,
        "a shelf edge shows what it was as well as what it is"
    );

    // The shop says so, on its own, in the transaction that put the book into
    // service. Nobody ticks a list: until this existed the centre published
    // prices into silence, and a shop whose sync had stalled looked exactly
    // like one that was up to date.
    let (activated_site, activated_version, rule_count): (Option<String>, i64, i64) =
        sqlx::query_as(
            "SELECT site_id, version, price_rule_count
               FROM commercial_publication_activation WHERE publication_id = $1",
        )
        .bind(
            publication_id
                .parse::<Uuid>()
                .unwrap_or_else(|e| panic!("publication id: {e}")),
        )
        .fetch_one(&fleet.cloud.db)
        .await
        .unwrap_or_else(|e| panic!("nobody reported activating the price book: {e}"));
    assert_eq!(activated_site.as_deref(), Some(STORE_SITE));
    assert_eq!(activated_version, 99);
    assert!(
        rule_count > 0,
        "a truncated delivery must be visible as a number, not as a wrong price later"
    );

    // And head office's own price list agrees with the shop's.
    //
    // This is the screen a merchandiser opens to check what a branch is
    // selling for, so of all the places that could disagree with a till it is
    // the worst. It used to read price rules and nothing else — the cleared
    // size showed here at its list price while the counter charged the
    // clearance.
    let head_office = fleet
        .cloud_get(&format!(
            "/api/v1/commercial/offers?site_id={STORE_SITE}&channel=STORE"
        ))
        .await;
    let quoted = |code: &str| -> Value {
        head_office["items"]
            .as_array()
            .unwrap_or_else(|| panic!("no offers: {head_office}"))
            .iter()
            .find(|item| item["sku_code"] == json!(code))
            .unwrap_or_else(|| panic!("{code} missing from head office's list: {head_office}"))
            .clone()
    };
    assert_eq!(
        quoted(&sku_code)["unit_price_minor"],
        on_shelf(&sku_code)["unit_price_minor"],
        "head office and the shop must quote one number"
    );
    assert_eq!(
        quoted(&other_sku_code)["unit_price_minor"],
        json!(CLEARANCE),
        "the cleared size must not show at its list price to head office"
    );
    // One spelling, both ends. This read `"Markdown"` while the centre rendered
    // the enum with `Debug` and a shop rendered it `MARKDOWN` through a helper
    // of its own — so the assertion passed and the two nodes disagreed anyway.
    assert_eq!(quoted(&other_sku_code)["price_source"], "MARKDOWN");
    assert_eq!(
        quoted(&other_sku_code)["price_source"],
        on_shelf(&other_sku_code)["price_source"],
        "head office and the shop must say the same word for where a price came from"
    );

    // =====================================================================
    // 07 · The centre sends some of it to the shop
    // =====================================================================
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

    // --- 08 · Picking -----------------------------------------------------
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

    // --- 09 · Packing, and the sweep that seals the box -------------------
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
    assert_eq!(epcs.len(), ALLOTTED as usize);

    // The sweep, as the handheld sends it: observations tagged with the box's
    // reader session, signed by the device rather than carrying a session.
    let body = serde_json::to_vec(&json!({
        "site_id": DC_SITE,
        "pool": format!("{DC_SITE}.warehouse"),
        "reader_session_id": "sweep-full",
        "observed_at": chrono::Utc::now(),
        "idempotency_key": "sweep-full",
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
        fleet.dc_router(),
        "POST",
        "/api/v1/rfid/observations",
        proof,
        body,
    )
    .await;
    assert!(status.is_success(), "sweep returned {status}: {swept}");

    // The sweep only records what the reader saw. Matching it against the box's
    // target is a separate act, and it is the one that seals: a box whose sweep
    // agrees with its target has nothing left for anybody to decide.
    let agreed = fleet
        .dc_post(
            &format!("/api/v1/dc/packing-boxes/{box_id}/capture"),
            json!({ "reader_session_id": "sweep-full" }),
        )
        .await;
    assert_eq!(agreed["matched"], json!(true), "{agreed}");
    assert!(agreed["unexpected"].as_array().is_some_and(Vec::is_empty));

    let ready = fleet
        .dc_get(&format!("/api/v1/dc/packing-boxes/{box_id}"))
        .await;
    assert_eq!(ready["ready"], json!(true), "{ready}");
    let koli_id = ready["koli_id"]
        .as_str()
        .unwrap_or_else(|| panic!("no koli: {ready}"))
        .to_string();

    // --- 10 · Surat jalan, truck, departure -------------------------------
    let shipment = fleet
        .dc_post(
            "/api/v1/dc/shipments",
            json!({ "koli_ids": [koli_id], "actor_id": "supervisor-1" }),
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
    let gone = fleet
        .dc_post(
            &format!("/api/v1/dc/dispatches/{dispatch_id}/depart"),
            json!({}),
        )
        .await;
    assert!(gone["departed_at"].as_str().is_some(), "{gone}");
    fleet.sync().await;

    // =====================================================================
    // 11 · The goods arrive at the shop
    //
    // A second edge, a second database, its own HTTP API. Everything below
    // this line is the half the older end-to-end test never reached.
    // =====================================================================
    let shipment_reference = shipment["shipment_number"]
        .as_str()
        .unwrap_or_else(|| panic!("no shipment number: {shipment}"))
        .to_string();
    for (index, epc) in epcs.iter().enumerate() {
        fleet
            .store_post(
                "/api/v1/store/receive",
                json!({
                    "epc": epc,
                    "sku_code": sku_code,
                    // What the shop books it in at. Never a selling price —
                    // and deliberately not one, so a till falling back to it
                    // would be obvious.
                    "unit_price_minor": INTAKE_PRICE,
                    "source_dc_id": DC_SITE,
                    "shipment_reference": shipment_reference,
                    "actor_id": "gudang-toko",
                    "idempotency_key": format!("recv-{index}")
                }),
            )
            .await;
    }
    assert_eq!(
        fleet
            .store_pool_on_hand(&format!("{STORE_SITE}.warehouse"))
            .await,
        ALLOTTED,
        "everything on the truck is in the stockroom"
    );

    // --- 12 · Onto the shop floor -----------------------------------------
    for (index, epc) in epcs.iter().enumerate() {
        fleet
            .store_post(
                "/api/v1/store/movements",
                json!({
                    "epc": epc,
                    "quantity": 1,
                    "from": format!("{STORE_SITE}.warehouse:on_hand"),
                    "to": format!("{STORE_SITE}.floor:on_hand"),
                    "cause": "NORMAL_MOVE",
                    "reason": "Pindah ke lantai jual",
                    "actor_id": "pramuniaga-1",
                    "idempotency_key": format!("floor-{index}")
                }),
            )
            .await;
    }
    assert_eq!(
        fleet
            .store_pool_on_hand(&format!("{STORE_SITE}.floor"))
            .await,
        ALLOTTED
    );

    // --- 13 · A customer buys two -----------------------------------------
    let basket = vec![epcs[0].clone(), epcs[1].clone()];
    let expected = SHOP_PRICE * 2;
    let sale = fleet
        .store_post(
            "/api/v1/store/sales",
            json!({
                "epcs": basket,
                "cash_minor": expected,
                "actor_id": "kasir-1",
                "idempotency_key": "sale-1"
            }),
        )
        .await;
    assert_eq!(
        sale["total_minor"], expected,
        "the till charged the published shop price, not the {INTAKE_PRICE} it was booked in at: {sale}"
    );
    assert_eq!(sale["change_minor"], 0);
    assert_eq!(
        fleet
            .store_pool_on_hand(&format!("{STORE_SITE}.floor"))
            .await,
        ALLOTTED - 2,
        "two garments left the shop"
    );

    // =====================================================================
    // 14 · The takings reach the centre, and reconcile
    // =====================================================================
    fleet.sync().await;

    let dead: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_dead_letter")
        .fetch_one(&fleet.cloud.db)
        .await
        .unwrap_or_else(|e| panic!("count dead letters: {e}"));
    assert_eq!(dead, 0, "nothing was rejected on the way up");

    let (total, discount, trace): (i64, i64, Option<String>) = sqlx::query_as(
        "SELECT total_minor, discount_total_minor, pricing_trace_id
           FROM edge_sale WHERE site_id = $1",
    )
    .bind(STORE_SITE)
    .fetch_one(&fleet.cloud.db)
    .await
    .unwrap_or_else(|e| panic!("read the sale at the centre: {e}"));
    assert_eq!(total, expected, "the centre holds the takings");
    assert_eq!(discount, 0, "no promotion ran, so nothing was discounted");
    assert!(
        trace.is_some_and(|id| !id.is_empty()),
        "a disputed receipt must be reproducible, not arguable"
    );

    // The line-level figures are the only ones the centre ever sees, and they
    // must add up to the header. They did not, once: the lines carried the
    // intake price while the header carried the charged total, so every sale
    // from a shop with a price book was refused at ingest — invisible revenue
    // rather than a visible error.
    let (line_count, line_sum): (i64, i64) = sqlx::query_as(
        "SELECT count(*)::bigint, coalesce(sum(l.line_total_minor),0)::bigint
           FROM edge_sale_line l JOIN edge_sale s ON s.sale_id = l.sale_id
          WHERE s.site_id = $1",
    )
    .bind(STORE_SITE)
    .fetch_one(&fleet.cloud.db)
    .await
    .unwrap_or_else(|e| panic!("read the lines at the centre: {e}"));
    assert_eq!(line_count, 2);
    assert_eq!(line_sum, expected, "the lines add up to the total");

    let source: String = sqlx::query_scalar(
        "SELECT price_source FROM edge_sale_line l JOIN edge_sale s USING (sale_id)
          WHERE s.site_id = $1 LIMIT 1",
    )
    .bind(STORE_SITE)
    .fetch_one(&fleet.cloud.db)
    .await
    .unwrap_or_else(|e| panic!("read the price source: {e}"));
    assert_eq!(
        source, "SITE_PRICE",
        "the centre can tell which authority set the price it was paid"
    );

    // And the report the whole fleet exists to produce: takings per shop.
    //
    // Called rather than requested, because it has no route. The function is
    // written and correct and nothing can reach it — the same shape of gap as
    // the missing SKU list above, and worth naming: the last mile of this
    // chain is a report nobody can open.
    let takings = cloud::sales_by_site(
        &fleet.cloud.db,
        "2020-01-01T00:00:00Z"
            .parse()
            .unwrap_or_else(|e| panic!("from: {e}")),
        "2030-01-01T00:00:00Z"
            .parse()
            .unwrap_or_else(|e| panic!("to: {e}")),
    )
    .await
    .unwrap_or_else(|e| panic!("takings: {e}"));
    let row = takings["sites"]
        .as_array()
        .and_then(|sites| {
            sites
                .iter()
                .find(|site| site["site_id"] == json!(STORE_SITE))
        })
        .unwrap_or_else(|| panic!("this shop is missing from the takings: {takings}"));
    assert_eq!(row["sale_count"], 1);
    assert_eq!(
        row["gross_minor"], expected,
        "the fleet's takings are the shop prices head office published, \
         carried all the way from a purchase order"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_price_book_may_change_a_few_prices_but_not_open_a_channel_half_priced(pool: PgPool) {
    // The check that used to force whole-book authoring is now a safety net,
    // and it still catches the thing it exists for: a channel where some
    // products have a price and others have none is a channel that will refuse
    // half its own catalogue at the counter.
    let fleet = fleet(pool).await;
    let sku_id: Uuid = sqlx::query_scalar("SELECT id FROM sku WHERE active LIMIT 1")
        .fetch_one(&fleet.cloud.db)
        .await
        .unwrap_or_else(|e| panic!("no seeded sku: {e}"));

    let draft = fleet
        .cloud_post(
            "/api/v1/commercial/publications",
            json!({
                "version": 4242,
                "name": "Buka kanal online",
                "effective_from": "2020-01-01T00:00:00Z",
                "effective_to": null,
                "actor_id": "merchandiser-1",
                "idempotency_key": "online-1",
                "tax_rules": [
                    {"tax_category": "STANDARD", "rate_bps": 1100, "tax_inclusive": true}
                ],
                // One product, on a channel where nothing else has ever been
                // priced.
                "offer_rules": [{
                    "sku_id": sku_id, "site_id": null, "channel": "ONLINE",
                    "sellable": true, "currency": "IDR",
                    "unit_price_minor": 100_000, "tax_category": "STANDARD"
                }],
            }),
        )
        .await;
    let publication_id = draft["id"]
        .as_str()
        .unwrap_or_else(|| panic!("no publication: {draft}"))
        .to_string();

    let (status, refused) = call(
        fleet.cloud_router(),
        "POST",
        &format!("/api/v1/commercial/publications/{publication_id}/publish"),
        Some(json!({ "actor_id": "merchandiser-1", "idempotency_key": "online-publish" })),
    )
    .await;
    assert!(
        status.is_client_error(),
        "opening a channel with one product priced and the rest not must be \
         refused, got {status}: {refused}"
    );
}
