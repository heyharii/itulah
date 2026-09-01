//! Notifications, from the thing that happened to the person who reads it.
//!
//! The point of this test is the JOIN between two halves that are easy to get
//! separately right and together wrong: a notification is RAISED by business
//! code inside that code's own transaction, and it is READ per person over
//! HTTP with a session. A test that only called the store would not prove the
//! routes are mounted; one that only called the routes would not prove that
//! accepting a delivery actually tells anybody.
//!
//! So this drives a real sync ingest — the same `POST /api/v1/sync/ingest` a
//! warehouse uploads to — and then reads the buyer's list as the buyer.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;
use uuid::Uuid;

const ORIGIN: &str = "dc-notify-edge";
const SYNC_KEY: &str = "notification-integration-sync-key-0001";
const ADMIN_PASSWORD: &str = "admin-password-notify-1";

struct Response {
    status: StatusCode,
    body: Value,
    set_cookies: Vec<String>,
}

async fn send(
    app: axum::Router,
    method: &str,
    path: &str,
    headers: Vec<(String, String)>,
    body: Option<Value>,
) -> Response {
    let mut builder = Request::builder().method(method).uri(path);
    for (name, value) in headers {
        builder = builder.header(name, value);
    }
    if body.is_some() {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
    }
    let response = app
        .oneshot(
            builder
                .body(body.map_or_else(Body::empty, |value| {
                    Body::from(
                        serde_json::to_vec(&value)
                            .unwrap_or_else(|error| panic!("encode body: {error}")),
                    )
                }))
                .unwrap_or_else(|error| panic!("build {method} {path}: {error}")),
        )
        .await
        .unwrap_or_else(|error| panic!("{method} {path}: {error}"));
    let status = response.status();
    let set_cookies = response
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|value| value.to_str().unwrap_or_default().to_string())
        .collect();
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap_or_else(|error| panic!("read body: {error}"));
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| json!({ "raw": String::from_utf8_lossy(&bytes).to_string() }))
    };
    Response {
        status,
        body,
        set_cookies,
    }
}

fn cookie_pair(set_cookies: &[String], name: &str) -> String {
    set_cookies
        .iter()
        .find_map(|cookie| {
            let pair = cookie.split(';').next()?;
            pair.strip_prefix(&format!("{name}="))
                .map(|value| format!("{name}={value}"))
        })
        .unwrap_or_else(|| panic!("missing cookie {name}"))
}

/// The two headers a browser sends on a write: the session cookie, and the
/// CSRF token echoed out of its own cookie.
fn browser(set_cookies: &[String]) -> (String, String) {
    let session = cookie_pair(set_cookies, security::SESSION_COOKIE);
    let csrf = cookie_pair(set_cookies, security::CSRF_COOKIE);
    let token = csrf
        .split_once('=')
        .map(|(_, value)| value.to_string())
        .unwrap_or_else(|| panic!("invalid csrf cookie"));
    (format!("{session}; {csrf}"), token)
}

fn config() -> AppConfig {
    AppConfig {
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|error| panic!("bind: {error}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "cloud-notify-test".into(),
        node_role: "CLOUD".into(),
        rfid_burst_window_seconds: 10,
        observed_window_hours: 24,
        lost_risk_window_days: 30,
        enable_test_controls: false,
        frontend_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend"),
        sync_upload_url: None,
        sync_upload_key: None,
        sync_ingest_key: Some("test-master-key-at-least-thirty-two-characters".into()),
        sync_generation: 1,
        sync_enqueue_enabled: false,
        sync_interval_seconds: 5,
        sync_batch_limit: 100,
        sync_breaker_threshold: 5,
        sync_breaker_base_cooldown_seconds: 1,
        sync_breaker_max_cooldown_seconds: 10,
        sync_retention_days: 14,
        sync_degraded_after_seconds: 900,
        sync_apply_enabled: true,
        jwt_secret: Some("opaque-auth-enabled".into()),
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

/// A purchase order with one line, raised the way the buying screen raises it,
/// so the delivery below has something real to arrive against.
async fn purchase_order_line(pool: &PgPool) -> Uuid {
    let order_id = Uuid::new_v4();
    let line_id = Uuid::new_v4();
    // DIRECT, not SOURCING: `origin_kind` says a buyer raised this without a
    // sourcing round, which the schema treats as ordinary rather than as a
    // gap to be back-filled with an invented decision.
    sqlx::query(
        "INSERT INTO purchase_order (purchase_order_id, po_number, supplier_id, supplier_name,
                                     destination_site_id, origin_kind, order_status, currency,
                                     created_by, issued_at)
         VALUES ($1, 'PO-NOTIFY-0001', 'NOTIFY01', 'Pemasok Uji', 'dc', 'DIRECT', 'ISSUED',
                 'IDR', 'admin', now())",
    )
    .bind(order_id)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("purchase order: {error}"));
    sqlx::query(
        "INSERT INTO purchase_order_line (po_line_id, purchase_order_id, line_number,
                                          article_code, article_name, ordered_quantity,
                                          unit_price_minor, line_amount_minor)
         VALUES ($1, $2, 1, 'SUP-KMJ-01', 'Kemeja lengan panjang', 40, 215000, 8600000)",
    )
    .bind(line_id)
    .bind(order_id)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("purchase order line: {error}"));
    line_id
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_delivery_accepted_at_a_warehouse_tells_head_office(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    // Bound to a site and a role, because a delivery has to have arrived
    // somewhere: the receipt takes its `site_id` from this registration.
    cloud::register_origin_credential_binding(
        &pool,
        ORIGIN,
        SYNC_KEY,
        Some("DC Uji"),
        Some("dc"),
        Some("DC"),
        Some(1),
        Some(true),
    )
    .await
    .unwrap_or_else(|error| panic!("register origin: {error}"));
    let po_line_id = purchase_order_line(&pool).await;
    let app = cloud_http::router(AppState::new(pool.clone(), config()));

    // Nothing has happened yet, so there is nothing to be told.
    let signed_in = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        vec![],
        Some(json!({ "username": "admin", "password": ADMIN_PASSWORD })),
    )
    .await;
    assert_eq!(signed_in.status, StatusCode::OK);
    let (cookie, csrf) = browser(&signed_in.set_cookies);

    let empty = send(
        app.clone(),
        "GET",
        "/api/v1/notifications",
        vec![(header::COOKIE.to_string(), cookie.clone())],
        None,
    )
    .await;
    assert_eq!(empty.status, StatusCode::OK);
    assert_eq!(empty.body["unread"], json!(0));
    assert_eq!(
        empty.body["items"]
            .as_array()
            .unwrap_or_else(|| panic!("items"))
            .len(),
        0
    );

    // The warehouse uploads what it did: a line counted, verified by a second
    // person, and accepted. This is the real ingest endpoint with the real
    // origin key, not a function call.
    let receipt_line_id = Uuid::new_v4();
    let ingested = send(
        app.clone(),
        "POST",
        "/api/v1/sync/ingest",
        vec![("x-sync-key".to_string(), SYNC_KEY.to_string())],
        Some(json!({
            "origin_id": ORIGIN,
            "generation": 1,
            "facts": [{
                "seq": 1,
                "event_id": Uuid::new_v4(),
                "event_type": "goods_receipt.line",
                "created_at": "2026-09-01T02:00:00Z",
                "payload": {
                    "receipt_id": Uuid::new_v4(),
                    "receipt_number": "GRN-uji-000001",
                    "receipt_line_id": receipt_line_id,
                    "po_line_id": po_line_id,
                    "supplier_id": "NOTIFY01",
                    "arrived_at": "2026-09-01T01:00:00Z",
                    "opened_by": "checker",
                    "opened_at": "2026-09-01T01:05:00Z",
                    "quantity": 40,
                    "counted_by": "checker",
                    "verified_by": "verifier",
                    "counted_at": "2026-09-01T01:30:00Z",
                    "verified_at": "2026-09-01T01:45:00Z",
                    "movement_group_id": Uuid::new_v4()
                }
            }]
        })),
    )
    .await;
    assert_eq!(
        ingested.status,
        StatusCode::OK,
        "ingest rejected: {}",
        ingested.body
    );
    // Ingest durably accepts; APPLYING is a loop inside the cloud process.
    // Driving it here is what a test does instead of waiting for a timer.
    let report = cloud::apply_pending(&pool, 500)
        .await
        .unwrap_or_else(|error| panic!("apply: {error}"));
    assert!(
        report.blocked.is_empty(),
        "the centre could not apply the delivery: {:?}",
        report.blocked
    );

    // The buyer is told, without having gone looking.
    let told = send(
        app.clone(),
        "GET",
        "/api/v1/notifications",
        vec![(header::COOKIE.to_string(), cookie.clone())],
        None,
    )
    .await;
    assert_eq!(told.status, StatusCode::OK);
    assert_eq!(told.body["unread"], json!(1), "list was {}", told.body);
    let first = &told.body["items"][0];
    assert_eq!(first["kind"], json!("receipt.awaiting_identity"));
    assert_eq!(first["origin_id"], json!(ORIGIN));
    assert_eq!(first["subject_kind"], json!("goods_receipt_line"));
    assert_eq!(first["subject_id"], json!(receipt_line_id.to_string()));
    assert_eq!(first["read_at"], Value::Null);
    // The sentence carries the facts a person needs to decide whether to act
    // now, rather than ids they would have to look up.
    let body = first["body"].as_str().unwrap_or_default();
    assert!(body.contains("40 pieces"), "body was {body:?}");
    assert!(body.contains("Kemeja lengan panjang"), "body was {body:?}");
    assert!(body.contains("PO-NOTIFY-0001"), "body was {body:?}");

    // Announced on the same stream chat and discussions use, addressed to
    // exactly the people who can act on it.
    let announced: (String, Vec<String>) = sqlx::query_as(
        "SELECT kind, audience FROM collaboration_event ORDER BY event_id DESC LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("event: {error}"));
    assert_eq!(announced.0, "notification");
    assert_eq!(announced.1, vec!["admin".to_string()]);

    // Reading it is per person, and it stays read.
    let notification_id = first["notification_id"]
        .as_str()
        .unwrap_or_else(|| panic!("notification id"));
    let marked = send(
        app.clone(),
        "POST",
        &format!("/api/v1/notifications/{notification_id}/read"),
        vec![
            (header::COOKIE.to_string(), cookie.clone()),
            ("x-csrf-token".to_string(), csrf.clone()),
        ],
        Some(json!({})),
    )
    .await;
    assert_eq!(marked.status, StatusCode::OK, "mark read: {}", marked.body);
    assert_eq!(marked.body["unread"], json!(0));

    let after = send(
        app.clone(),
        "GET",
        "/api/v1/notifications",
        vec![(header::COOKIE.to_string(), cookie.clone())],
        None,
    )
    .await;
    assert_eq!(after.body["unread"], json!(0));
    // Read, not deleted: the list still shows what happened.
    assert_ne!(after.body["items"][0]["read_at"], Value::Null);

    // The same fact arriving twice is one delivery, so it is one notification.
    // A replayed batch is ordinary — an edge retries whenever an ack is lost.
    let replayed = send(
        app.clone(),
        "POST",
        "/api/v1/sync/ingest",
        vec![("x-sync-key".to_string(), SYNC_KEY.to_string())],
        Some(json!({
            "origin_id": ORIGIN,
            "generation": 1,
            "facts": [{
                "seq": 1,
                "event_id": Uuid::new_v4(),
                "event_type": "goods_receipt.line",
                "created_at": "2026-09-01T02:00:00Z",
                "payload": {
                    "receipt_id": Uuid::new_v4(),
                    "receipt_number": "GRN-uji-000001",
                    "receipt_line_id": receipt_line_id,
                    "po_line_id": po_line_id,
                    "supplier_id": "NOTIFY01",
                    "arrived_at": "2026-09-01T01:00:00Z",
                    "opened_by": "checker",
                    "opened_at": "2026-09-01T01:05:00Z",
                    "quantity": 40,
                    "counted_by": "checker",
                    "verified_by": "verifier",
                    "counted_at": "2026-09-01T01:30:00Z",
                    "verified_at": "2026-09-01T01:45:00Z",
                    "movement_group_id": Uuid::new_v4()
                }
            }]
        })),
    )
    .await;
    assert_eq!(replayed.status, StatusCode::OK);
    cloud::apply_pending(&pool, 500)
        .await
        .unwrap_or_else(|error| panic!("apply replay: {error}"));
    let still = send(
        app.clone(),
        "GET",
        "/api/v1/notifications",
        vec![(header::COOKIE.to_string(), cookie)],
        None,
    )
    .await;
    assert_eq!(
        still.body["items"]
            .as_array()
            .unwrap_or_else(|| panic!("items"))
            .len(),
        1,
        "a replayed fact raised a second notification: {}",
        still.body
    );
    assert_eq!(still.body["unread"], json!(0));
}
