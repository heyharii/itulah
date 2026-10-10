//! A sale at the till becomes points on the shopper's phone.
//!
//! The chain the member app depends on, driven end to end with nothing
//! stubbed between the links:
//!
//! ```text
//!   POS window ──POST /api/v1/store/sales (customer_id)──► shop node (SQLite)
//!        the node prices the basket from the published book, computes
//!        `points_earned`, and queues a SALES_COMPLETED fact in the SAME
//!        transaction as the sale
//!   shop sync worker ──POST /api/v1/sync/ingest──► centre (Postgres)
//!   centre apply agent ──► edge_sale + points_ledger EARN (once per sale)
//!   phone ──GET /api/v1/member/points, /summary, /transactions──► centre
//! ```
//!
//! The points are awarded by the CENTRE when it accepts the sale, not by the
//! till: a shop selling with the line down records what the basket earned,
//! and the shopper cannot spend it until the centre has taken the sale. This
//! test pins exactly that: before the sync the phone sees nothing, after it
//! the balance, the receipt and the ledger line naming the sale are all there
//! — and a second delivery of the same fact awards nothing more.
//!
//! As in `full_chain_integration.rs`, the only things called directly rather
//! than over HTTP are the background workers (each node's sync cycle, the
//! centre's apply agent, the catalogue publisher) and node provisioning.

use axum::body::{to_bytes, Body};
use http::Request;
use inventory_backend::cloud::domain::{BreakerPolicy, IngestBatch, IngestResponse};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::edge::{
    store_router_with_auth, EdgeAuth, EdgeAuthConfig, EdgeInventory, EdgeRole, NodeContext, SiteId,
    SqliteEdge, SqliteSyncStore,
};
use inventory_backend::sync::port::{SyncConfig, SyncTransport};
use inventory_backend::sync::{run_cycle, CycleReport};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tower::ServiceExt;

const STORE_ORIGIN: &str = "store-01-edge";
const STORE_SITE: &str = "store-01";
const STORE_KEY: &str = "store-01-points-chain-sync-key-01";
const CARD: &str = "M-CHAIN-01";
/// One of the demo seed's SKUs, so the test needs no purchase order to have
/// something to sell.
const SKU: &str = "SKU-01-M";
const PRICE: i64 = 150_000;

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
    }
}

struct Reply {
    status: http::StatusCode,
    body: Value,
    set_cookies: Vec<String>,
}

async fn send(
    router: axum::Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
    headers: &[(&str, String)],
) -> Reply {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    for (name, value) in headers {
        request = request.header(*name, value);
    }
    let request = match body {
        Some(value) => request.body(Body::from(
            serde_json::to_vec(&value).unwrap_or_else(|e| panic!("encode: {e}")),
        )),
        None => request.body(Body::empty()),
    }
    .unwrap_or_else(|e| panic!("build {method} {uri}: {e}"));
    let response = router
        .oneshot(request)
        .await
        .unwrap_or_else(|e| panic!("{method} {uri}: {e}"));
    let status = response.status();
    let set_cookies = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|value| value.to_str().ok().map(str::to_owned))
        .collect();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap_or_else(|e| panic!("read {method} {uri}: {e}"));
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| json!({ "raw": String::from_utf8_lossy(&bytes).to_string() }))
    };
    Reply {
        status,
        body,
        set_cookies,
    }
}

async fn ok(router: axum::Router, method: &str, uri: &str, body: Option<Value>) -> Value {
    let reply = send(router, method, uri, body, &[]).await;
    assert!(
        reply.status.is_success(),
        "{method} {uri} returned {}: {}",
        reply.status,
        reply.body
    );
    reply.body
}

/// A phone holding a member session: the two cookies pairing set.
struct Phone {
    cookies: String,
}

impl Phone {
    fn from(set_cookies: &[String]) -> Self {
        let pick = |name: &str| {
            set_cookies
                .iter()
                .find_map(|line| {
                    let pair = line.split(';').next()?;
                    pair.starts_with(&format!("{name}="))
                        .then(|| pair.to_owned())
                })
                .unwrap_or_else(|| panic!("no {name} cookie in {set_cookies:?}"))
        };
        Self {
            cookies: format!("{}; {}", pick("member_session"), pick("member_csrf")),
        }
    }

    async fn get(&self, fleet: &Fleet, uri: &str) -> Value {
        let reply = send(
            fleet.cloud_router(),
            "GET",
            uri,
            None,
            &[("cookie", self.cookies.clone())],
        )
        .await;
        assert!(
            reply.status.is_success(),
            "GET {uri}: {} {}",
            reply.status,
            reply.body
        );
        reply.body
    }
}

struct Fleet {
    cloud: AppState,
    store: Arc<SqliteEdge>,
}

impl Fleet {
    async fn new(pool: PgPool) -> Self {
        cloud::register_origin_credential(&pool, STORE_ORIGIN, STORE_KEY, Some("Toko 01"))
            .await
            .unwrap_or_else(|e| panic!("register: {e}"));
        sqlx::query(
            "UPDATE sync_origin_credential
             SET site_id = $2, node_role = 'STORE', active_generation = 1, inventory_enabled = true
             WHERE origin_id = $1",
        )
        .bind(STORE_ORIGIN)
        .bind(STORE_SITE)
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("bind origin: {e}"));

        let site = SiteId::new(STORE_SITE).unwrap_or_else(|e| panic!("site: {e}"));
        let node = NodeContext::new(STORE_ORIGIN, EdgeRole::Store, site)
            .unwrap_or_else(|e| panic!("node: {e}"));
        Self {
            cloud: AppState::new(pool, cloud_config()),
            store: Arc::new(
                SqliteEdge::open_in_memory(node).unwrap_or_else(|e| panic!("store edge: {e}")),
            ),
        }
    }

    fn cloud_router(&self) -> axum::Router {
        cloud_http::router(self.cloud.clone())
    }

    /// The till's node, as the POS window reaches it through the shell.
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

    /// One round of the background workers: the shop uploads its facts and
    /// takes its commands, then the centre applies what arrived.
    async fn sync(&self) {
        let store = SqliteSyncStore::new(self.store.connection());
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
            command_key: Some(cloud::command_signing_key(STORE_KEY)),
        };
        for _ in 0..20 {
            let outcome = run_cycle(&store, &config, &transport)
                .await
                .unwrap_or_else(|e| panic!("cycle: {e}"));
            if let Some(blocked) = outcome.commands_blocked {
                panic!("the shop could not apply a command: {blocked:?}");
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
            .header("x-sync-key", STORE_KEY)
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
                "ingest {status}: {}",
                String::from_utf8_lossy(&bytes)
            ));
        }
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
    }
}

/// Head office prices the SKU and runs a points offer: one point per
/// Rp 10.000 of goods (tax excluded), the same shape the live stack runs.
async fn publish_points_book(fleet: &Fleet) {
    let availability = ok(
        fleet.cloud_router(),
        "GET",
        "/api/v1/inventory/availability",
        None,
    )
    .await;
    let sku_id = availability["items"]
        .as_array()
        .unwrap_or_else(|| panic!("no availability: {availability}"))
        .iter()
        .find(|item| item["sku_code"] == json!(SKU))
        .unwrap_or_else(|| panic!("{SKU} missing from the demo seed: {availability}"))["sku_id"]
        .clone();

    cloud::publish_catalog_if_changed(&fleet.cloud.db, "system:catalog-publisher")
        .await
        .unwrap_or_else(|e| panic!("catalogue: {e}"));

    let draft = ok(
        fleet.cloud_router(),
        "POST",
        "/api/v1/commercial/publications",
        Some(json!({
            "version": 90,
            "name": "Poin member",
            "effective_from": "2020-01-01T00:00:00Z",
            "effective_to": null,
            "actor_id": "merchandiser-1",
            "idempotency_key": "points-book",
            "tax_rules": [{"tax_category": "STANDARD", "rate_bps": 1100, "tax_inclusive": true}],
            "offer_rules": [{
                "sku_id": sku_id, "site_id": null, "channel": "STORE", "sellable": true,
                "currency": "IDR", "unit_price_minor": PRICE, "tax_category": "STANDARD"
            }],
            "rules": [{
                "rule_id": "PTS-1", "name": "Poin belanja", "status": "ACTIVE",
                "effect": {"kind": "EARN_POINTS", "mode": "SPEND_RATE",
                           "spend_per_point": {"minor": 10_000}}
            }]
        })),
    )
    .await;
    let id = draft["id"]
        .as_str()
        .unwrap_or_else(|| panic!("no id: {draft}"))
        .to_owned();
    let published = ok(
        fleet.cloud_router(),
        "POST",
        &format!("/api/v1/commercial/publications/{id}/publish"),
        Some(json!({"actor_id": "merchandiser-1", "idempotency_key": "points-book-publish"})),
    )
    .await;
    assert_eq!(
        published["delivered_to"],
        json!([STORE_ORIGIN]),
        "{published}"
    );
}

async fn stock(fleet: &Fleet, epc: &str) {
    ok(
        fleet.store_router(),
        "POST",
        "/api/v1/store/receive",
        Some(json!({
            "epc": epc, "sku_code": SKU, "unit_price_minor": 90_000,
            "source_dc_id": null, "shipment_reference": null,
            "actor_id": "gudang", "idempotency_key": format!("recv-{epc}")
        })),
    )
    .await;
    ok(
        fleet.store_router(),
        "POST",
        "/api/v1/store/movements",
        Some(json!({
            "epc": epc, "from": format!("{STORE_SITE}.warehouse:on_hand"),
            "to": format!("{STORE_SITE}.floor:on_hand"), "reason": "Pindah ke lantai jual",
            "actor_id": "gudang", "idempotency_key": format!("move-{epc}"),
            "reference_type": null, "reference_id": null
        })),
    )
    .await;
}

/// Exactly the body `pos-desktop/ui/src/api.ts::sell` posts.
async fn sell(fleet: &Fleet, epcs: &[&str], key: &str) -> Value {
    ok(
        fleet.store_router(),
        "POST",
        "/api/v1/store/sales",
        Some(json!({
            "epcs": epcs,
            "tenders": [{"method": "CASH", "amount_minor": PRICE * epcs.len() as i64, "reference": null}],
            "actor_id": "kasir-1",
            "idempotency_key": key,
            "coupon_codes": [],
            "customer_id": CARD,
            "charges": []
        })),
    )
    .await
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_sale_at_the_till_becomes_points_on_the_members_phone(pool: PgPool) {
    let fleet = Fleet::new(pool).await;

    // The counter enrols the card and reads out six digits; the shopper pairs.
    ok(
        fleet.cloud_router(),
        "POST",
        "/api/v1/members",
        Some(json!({"member_id": CARD, "display_name": "Sari"})),
    )
    .await;
    let code = ok(
        fleet.cloud_router(),
        "POST",
        &format!("/api/v1/members/{CARD}/pairing-code"),
        Some(json!({})),
    )
    .await;
    let paired = send(
        fleet.cloud_router(),
        "POST",
        "/api/v1/member/session",
        Some(json!({"member_id": CARD, "code": code["code"]})),
        &[],
    )
    .await;
    assert!(
        paired.status.is_success(),
        "pairing: {} {}",
        paired.status,
        paired.body
    );
    let phone = Phone::from(&paired.set_cookies);

    publish_points_book(&fleet).await;
    fleet.sync().await;

    // ── the POS window rings up two shirts for the member ────────────────
    stock(&fleet, "EPC-CHAIN-1").await;
    stock(&fleet, "EPC-CHAIN-2").await;
    let sale = sell(&fleet, &["EPC-CHAIN-1", "EPC-CHAIN-2"], "chain-sale-1").await;
    assert_eq!(sale["total_minor"], json!(300_000), "{sale}");
    // 300.000 incl. 11% PPN is 270.270 of goods: 27 whole points.
    assert_eq!(
        sale["points_earned"],
        json!(27),
        "the till computed the award: {sale}"
    );
    let sale_id = sale["sale_id"]
        .as_str()
        .unwrap_or_else(|| panic!("{sale}"))
        .to_owned();

    // Before the shop has synced, the centre has not accepted anything, and
    // the phone must not show points nobody has validated yet.
    let before = phone.get(&fleet, "/api/v1/member/points").await;
    assert_ne!(
        before["balance_points"],
        json!(27),
        "points before the centre took the sale: {before}"
    );
    let summary = phone.get(&fleet, "/api/v1/member/summary").await;
    assert_eq!(summary["transaction_count"], json!(0), "{summary}");

    // ── the shop's sync worker runs ───────────────────────────────────────
    fleet.sync().await;

    let points = phone.get(&fleet, "/api/v1/member/points").await;
    assert_eq!(points["balance_points"], json!(27), "{points}");
    assert_eq!(points["reconciles"], json!(true), "{points}");
    let earn = points["entries"]
        .as_array()
        .unwrap_or_else(|| panic!("{points}"))
        .iter()
        .find(|entry| entry["entry_type"] == json!("EARN"))
        .unwrap_or_else(|| panic!("no EARN line: {points}"));
    assert_eq!(earn["points"], json!(27));
    assert_eq!(
        earn["sale_id"],
        json!(sale_id),
        "the notification must be able to open the receipt it came from"
    );

    let summary = phone.get(&fleet, "/api/v1/member/summary").await;
    assert_eq!(summary["transaction_count"], json!(1), "{summary}");
    assert_eq!(summary["spent_minor"], json!(300_000), "{summary}");
    assert_eq!(summary["points_earned_total"], json!(27), "{summary}");

    let history = phone
        .get(&fleet, "/api/v1/member/transactions?limit=5")
        .await;
    assert_eq!(
        history["transactions"][0]["sale_id"],
        json!(sale_id),
        "{history}"
    );
    assert_eq!(
        history["transactions"][0]["status"],
        json!("COMPLETED"),
        "{history}"
    );

    let receipt = phone
        .get(&fleet, &format!("/api/v1/member/transactions/{sale_id}"))
        .await;
    assert_eq!(
        receipt["lines"].as_array().map(Vec::len),
        Some(2),
        "{receipt}"
    );

    // ── a lost acknowledgement: the till retries, the worker runs again ──
    let replay = sell(&fleet, &["EPC-CHAIN-1", "EPC-CHAIN-2"], "chain-sale-1").await;
    assert_eq!(
        replay["sale_id"],
        json!(sale_id),
        "a retry is the same sale"
    );
    fleet.sync().await;
    let points = phone.get(&fleet, "/api/v1/member/points").await;
    assert_eq!(
        points["balance_points"],
        json!(27),
        "one sale earns once: {points}"
    );

    // ── the next purchase adds to the same balance ────────────────────────
    stock(&fleet, "EPC-CHAIN-3").await;
    let second = sell(&fleet, &["EPC-CHAIN-3"], "chain-sale-2").await;
    assert_eq!(second["points_earned"], json!(13), "{second}");
    fleet.sync().await;
    let points = phone.get(&fleet, "/api/v1/member/points").await;
    assert_eq!(points["balance_points"], json!(40), "{points}");
}
