//! The generic record surface, driven the way a sheet drives it.
//!
//! Three things are proved here and they are three different kinds of thing.
//!
//! **That a record now has a first line of history.** Creating a purchase
//! order used to write an audit row with no subject, because the path cannot
//! name a record that did not exist when the request was written. So the order
//! sheet's Activity panel was empty and would have stayed empty however long
//! anybody waited. This raises a real order over HTTP and then asks the order
//! what happened to it.
//!
//! **That permission is borrowed and not invented.** `/api/v1/records/…`
//! serves every kind through one shape, so the only interesting question about
//! it is whether a cashier can read a supplier bill's comments. She can read a
//! sale's. This drives both as a real cashier with a real session.
//!
//! **That a comment belongs to whoever wrote it.** Editing and deleting are
//! author-only, and the rule lives in the `WHERE` of the statement rather than
//! in a check beside it — which is the sort of thing that is easy to write and
//! easy to write wrongly, so it is driven over HTTP by two different people.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-records-1";
const CASHIER_PASSWORD: &str = "cashier-password-records-1";
/// The warehouse that owns site `ho`. An order has to be sent somewhere, and
/// `create_purchase_order` resolves the destination to the ONE origin that
/// owns that site rather than guessing.
const DC_ORIGIN: &str = "dc-records-edge";
const SYNC_KEY: &str = "records-integration-sync-key-00000001";

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
        po_import: inventory_backend::cloud::intake::po::PoImportConfig::from_env(),
        clock: None,
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|error| panic!("bind: {error}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "cloud-records-test".into(),
        node_role: "CLOUD".into(),
        rfid_burst_window_seconds: 10,
        observed_window_hours: 24,
        lost_risk_window_days: 30,
        enable_test_controls: false,
        finance_automation_enabled: false,
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
        assistant_api_key: None,
        assistant_base_url: "https://openrouter.ai/api/v1".into(),
        assistant_model: "anthropic/claude-opus-5".into(),
        assistant_vertex: false,
        assistant_price_per_mtok: None,
    }
}

async fn sign_in(app: &axum::Router, username: &str, password: &str) -> (String, String) {
    let login = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        vec![],
        Some(json!({"username": username, "password": password})),
    )
    .await;
    assert_eq!(login.status, StatusCode::OK, "sign in as {username}");
    browser(&login.set_cookies)
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_record_carries_what_was_done_to_it_and_what_was_said_about_it(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    cloud::register_origin_credential_binding(
        &pool,
        DC_ORIGIN,
        SYNC_KEY,
        Some("DC Uji"),
        Some("ho"),
        Some("DC"),
        Some(1),
        Some(true),
    )
    .await
    .unwrap_or_else(|error| panic!("register origin: {error}"));
    let state = AppState::new(pool.clone(), config());
    let app = cloud_http::router(state);

    let (admin, admin_csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    let as_admin = || {
        vec![
            ("cookie".to_string(), admin.clone()),
            ("x-csrf-token".to_string(), admin_csrf.clone()),
        ]
    };

    // ── an order is raised, and says so ──────────────────────────────────
    let raised = send(
        app.clone(),
        "POST",
        "/api/v1/purchase-orders",
        as_admin(),
        Some(json!({
            "po_number": "PO-RECORDS-0001",
            "supplier_id": "RECORDS01",
            "supplier_name": "Pemasok Uji",
            "destination_site_id": "ho",
            "origin_kind": "DIRECT",
            "currency": "IDR",
            "created_by": "admin",
            "lines": [{
                "line_number": 1,
                "article_code": "SUP-KMJ-01",
                "article_name": "Kemeja lengan panjang",
                "ordered_quantity": 40,
                "unit_price_minor": 215000
            }]
        })),
    )
    .await;
    assert_eq!(raised.status, StatusCode::CREATED, "{:?}", raised.body);
    let order_id = raised.body["purchase_order_id"]
        .as_str()
        .unwrap_or_else(|| panic!("no purchase_order_id in {:?}", raised.body))
        .to_string();

    let info = send(
        app.clone(),
        "GET",
        &format!("/api/v1/records/purchase_order/{order_id}/info"),
        vec![("cookie".into(), admin.clone())],
        None,
    )
    .await;
    assert_eq!(info.status, StatusCode::OK, "{:?}", info.body);
    assert_eq!(info.body["label"], "Purchase order");

    // The line that did not exist before the handler could speak. Until then
    // this panel was empty for every order ever raised.
    let activity = info.body["activity"]
        .as_array()
        .unwrap_or_else(|| panic!("no activity in {:?}", info.body));
    assert_eq!(
        activity.len(),
        1,
        "an order that has just been raised has exactly one line of history: {activity:?}"
    );
    assert_eq!(activity[0]["method"], "POST");
    assert_eq!(activity[0]["path"], "/api/v1/purchase-orders");
    assert_eq!(activity[0]["subject_kind"], "purchase_order");
    assert_eq!(activity[0]["subject_id"], order_id);

    // ── somebody says something about it ─────────────────────────────────
    let said = send(
        app.clone(),
        "POST",
        &format!("/api/v1/records/purchase_order/{order_id}/comments"),
        as_admin(),
        Some(json!({"body": "Supplier says the fabric is two weeks late."})),
    )
    .await;
    assert_eq!(said.status, StatusCode::CREATED, "{:?}", said.body);
    assert_eq!(said.body["mine"], true);
    assert!(said.body["edited_at"].is_null());
    let comment_id = said.body["comment_id"]
        .as_str()
        .unwrap_or_else(|| panic!("no comment_id"))
        .to_string();

    // Saying something is itself an act against the order, and the order's own
    // history is where somebody will look for it.
    let info = send(
        app.clone(),
        "GET",
        &format!("/api/v1/records/purchase_order/{order_id}/info"),
        vec![("cookie".into(), admin.clone())],
        None,
    )
    .await;
    assert_eq!(info.body["comments"].as_array().map(Vec::len), Some(1));
    assert_eq!(
        info.body["activity"].as_array().map(Vec::len),
        Some(2),
        "the comment is filed against the order, not against itself"
    );

    // ── and files it under a word ────────────────────────────────────────
    let tagged = send(
        app.clone(),
        "PUT",
        &format!("/api/v1/records/purchase_order/{order_id}/tags/BASIC"),
        as_admin(),
        None,
    )
    .await;
    assert_eq!(tagged.status, StatusCode::NO_CONTENT);
    // Twice is not an error: the screen's control is a toggle.
    let again = send(
        app.clone(),
        "PUT",
        &format!("/api/v1/records/purchase_order/{order_id}/tags/BASIC"),
        as_admin(),
        None,
    )
    .await;
    assert_eq!(again.status, StatusCode::NO_CONTENT);

    let refused = send(
        app.clone(),
        "PUT",
        &format!("/api/v1/records/purchase_order/{order_id}/tags/NOT-A-TAG"),
        as_admin(),
        None,
    )
    .await;
    assert_eq!(refused.status, StatusCode::BAD_REQUEST);

    let info = send(
        app.clone(),
        "GET",
        &format!("/api/v1/records/purchase_order/{order_id}/info"),
        vec![("cookie".into(), admin.clone())],
        None,
    )
    .await;
    let tags = info.body["tags"]
        .as_array()
        .unwrap_or_else(|| panic!("tags"));
    assert_eq!(tags.len(), 1, "{tags:?}");
    assert_eq!(tags[0]["tag_code"], "BASIC");
    assert_eq!(tags[0]["label"], "Basic", "the label comes from the master");

    // ── a kind that is not a record is not a way in ──────────────────────
    let nonsense = send(
        app.clone(),
        "GET",
        "/api/v1/records/general/anything/info",
        vec![("cookie".into(), admin.clone())],
        None,
    )
    .await;
    assert_ne!(
        nonsense.status,
        StatusCode::OK,
        "`general` is a category, and a category is not a record"
    );

    // ── a comment belongs to whoever wrote it ────────────────────────────
    let created = send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        as_admin(),
        Some(json!({
            "username": "cashier.records",
            "display_name": "Kasir Uji",
            "password": CASHIER_PASSWORD,
            "role": "CASHIER"
        })),
    )
    .await;
    assert_eq!(created.status, StatusCode::OK, "{:?}", created.body);
    let (cashier, cashier_csrf) = sign_in(&app, "cashier.records", CASHIER_PASSWORD).await;

    let stolen = send(
        app.clone(),
        "PATCH",
        &format!("/api/v1/comments/{comment_id}"),
        vec![
            ("cookie".into(), cashier.clone()),
            ("x-csrf-token".into(), cashier_csrf.clone()),
        ],
        Some(json!({"body": "not mine to change"})),
    )
    .await;
    assert_eq!(
        stolen.status,
        StatusCode::NOT_FOUND,
        "one answer for `no such comment` and `not yours`: the alternative \
         tells anybody who can guess a uuid who did not write it"
    );

    let edited = send(
        app.clone(),
        "PATCH",
        &format!("/api/v1/comments/{comment_id}"),
        as_admin(),
        Some(json!({"body": "Supplier says the fabric is three weeks late."})),
    )
    .await;
    assert_eq!(edited.status, StatusCode::OK, "{:?}", edited.body);
    assert!(
        !edited.body["edited_at"].is_null(),
        "a comment that quietly became a different comment is worse than one \
         that admits it was edited"
    );

    let removed = send(
        app.clone(),
        "DELETE",
        &format!("/api/v1/comments/{comment_id}"),
        as_admin(),
        None,
    )
    .await;
    assert_eq!(removed.status, StatusCode::NO_CONTENT);
}

/// One route, fifty-seven gates.
///
/// A store manager may read a sale and may not read what the company owes —
/// the rule `/api/v1/finance/…` enforces (since 0633 by the job role's hub
/// sections as well as the rung), and which a single generic route would have
/// quietly dropped. A cashier holds no hub section at all, so the delegation
/// is shown with the store manager: same route, one record allowed and one
/// refused.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_records_surface_borrows_the_gate_of_the_record_it_names(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let state = AppState::new(pool.clone(), config());
    let app = cloud_http::router(state);

    let (admin, admin_csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    let created = send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        vec![
            ("cookie".into(), admin.clone()),
            ("x-csrf-token".into(), admin_csrf.clone()),
        ],
        Some(json!({
            "username": "cashier.gate",
            "display_name": "Kepala Toko Gerbang",
            "password": CASHIER_PASSWORD,
            // A rung only: the default job role for it, STORE_MANAGER, which
            // holds `sales` and not `finance`.
            "role": "SUPERVISOR"
        })),
    )
    .await;
    assert_eq!(created.status, StatusCode::OK, "{:?}", created.body);
    let (cashier, cashier_csrf) = sign_in(&app, "cashier.gate", CASHIER_PASSWORD).await;

    let sale = send(
        app.clone(),
        "GET",
        "/api/v1/records/sale/any-sale-id/info",
        vec![("cookie".into(), cashier.clone())],
        None,
    )
    .await;
    assert_eq!(
        sale.status,
        StatusCode::OK,
        "a store manager may read her store's sale: {:?}",
        sale.body
    );

    let bill = send(
        app.clone(),
        "GET",
        "/api/v1/records/bill/any-bill-id/info",
        vec![("cookie".into(), cashier.clone())],
        None,
    )
    .await;
    assert_eq!(
        bill.status,
        StatusCode::FORBIDDEN,
        "running a store is not a reason to read what the company owes"
    );

    let note = send(
        app.clone(),
        "POST",
        "/api/v1/records/bill/any-bill-id/comments",
        vec![
            ("cookie".into(), cashier.clone()),
            ("x-csrf-token".into(), cashier_csrf.clone()),
        ],
        Some(json!({"body": "…"})),
    )
    .await;
    assert_eq!(
        note.status,
        StatusCode::FORBIDDEN,
        "nor to write on it: the write borrows the read's gate, and the read \
         refused"
    );
}
