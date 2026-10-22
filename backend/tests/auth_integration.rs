//! Full authentication integration across Cloud, DC Edge, Store Edge, policy
//! sync, browser cookies/CSRF, opaque bearer sessions, and RFID device proof.

use async_trait::async_trait;
use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::{
    cloud::{
        application::{
            AppConfig, AppError, AppState, CreateUserRequest, RegisterRfidDeviceRequest,
            SetEdgeAssignmentActiveRequest, SetRfidDeviceActiveRequest,
            UpsertEdgeAssignmentRequest,
        },
        domain::{BreakerPolicy, IngestBatch, IngestResponse, Role},
        http as cloud_http, postgres as cloud,
    },
    edge::{
        dc_router_with_auth, derive_rfid_signing_key, sign_rfid_request, store_router_with_auth,
        EdgeAuth, EdgeAuthConfig, EdgeRole, NodeContext, SiteId, SqliteEdge, SqliteSyncStore,
    },
    security,
    sync::{port::SyncTransport, run_cycle, SyncConfig},
};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tower::ServiceExt;
use uuid::Uuid;

#[derive(Debug)]
struct TestResponse {
    status: StatusCode,
    body: Value,
    set_cookies: Vec<String>,
}

async fn send(
    app: axum::Router,
    method: &str,
    path: &str,
    headers: Vec<(String, String)>,
    body: Option<Vec<u8>>,
) -> TestResponse {
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
                .body(body.map_or_else(Body::empty, Body::from))
                .unwrap_or_else(|error| panic!("request {method} {path}: {error}")),
        )
        .await
        .unwrap_or_else(|error| panic!("response {method} {path}: {error}"));
    let status = response.status();
    let set_cookies = response
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|value| {
            value
                .to_str()
                .unwrap_or_else(|error| panic!("set-cookie: {error}"))
                .to_string()
        })
        .collect();
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap_or_else(|error| panic!("response body: {error}"));
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|error| panic!("JSON response {method} {path}: {error}"))
    };
    TestResponse {
        status,
        body,
        set_cookies,
    }
}

fn json_body(value: Value) -> Option<Vec<u8>> {
    Some(serde_json::to_vec(&value).unwrap_or_else(|error| panic!("request JSON: {error}")))
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

fn cookie_value(pair: &str) -> &str {
    pair.split_once('=')
        .map(|(_, value)| value)
        .unwrap_or_else(|| panic!("invalid cookie pair"))
}

fn browser_cookie_header(set_cookies: &[String]) -> (String, String) {
    let session = cookie_pair(set_cookies, security::SESSION_COOKIE);
    let csrf = cookie_pair(set_cookies, security::CSRF_COOKIE);
    let csrf_value = cookie_value(&csrf).to_string();
    (format!("{session}; {csrf}"), csrf_value)
}

fn cloud_config() -> AppConfig {
    AppConfig {
        po_import: inventory_backend::cloud::intake::po::PoImportConfig::from_env(),
        clock: None,
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|error| panic!("bind: {error}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "cloud-auth-test".into(),
        node_role: "CLOUD".into(),
        rfid_burst_window_seconds: 10,
        observed_window_hours: 24,
        lost_risk_window_days: 30,
        enable_test_controls: false,
        finance_automation_enabled: false,
        frontend_dir: frontend_dir(),
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
        // Compatibility marker; opaque sessions do not sign JWTs.
        jwt_secret: Some("opaque-auth-enabled".into()),
        auth_token_ttl_minutes: 60,
        auth_session_idle_minutes: 30,
        auth_cookie_secure: false,
        bootstrap_admin_password: None,
        cors_allowed_origins: Some("http://127.0.0.1:8080".into()),
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

fn frontend_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend")
}

fn node(role: EdgeRole, site: &str) -> NodeContext {
    NodeContext::new(
        format!("{site}-edge"),
        role,
        SiteId::new(site).unwrap_or_else(|error| panic!("site: {error}")),
    )
    .unwrap_or_else(|error| panic!("node: {error}"))
}

fn edge_auth_config(bootstrap_password: Option<&str>) -> EdgeAuthConfig {
    EdgeAuthConfig {
        enabled: true,
        session_ttl_minutes: 60,
        session_idle_minutes: 30,
        cookie_secure: false,
        bootstrap_admin_password: bootstrap_password.map(str::to_string),
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn cloud_cookie_bearer_rbac_revocation_lockout_and_csrf(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some("admin-password-1"), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    const REGISTERED_SYNC_KEY: &str = "registered-edge-sync-key-000000000001";
    cloud::register_origin_credential(
        &pool,
        "registered-edge",
        REGISTERED_SYNC_KEY,
        Some("Registered Edge"),
    )
    .await
    .unwrap_or_else(|error| panic!("register sync origin: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), cloud_config()));

    assert_eq!(
        send(app.clone(), "GET", "/api/v1/health", vec![], None)
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        send(app.clone(), "GET", "/api/v1/inventory/pools", vec![], None,)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/sync/ingest",
            vec![(
                "x-sync-key".into(),
                "test-master-key-at-least-thirty-two-characters".into(),
            )],
            json_body(json!({"origin_id":"unknown-edge","generation":1,"facts":[]})),
        )
        .await
        .status,
        StatusCode::FORBIDDEN,
        "the provisioning master key must never be an ingest identity"
    );
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/sync/ingest",
            vec![("x-sync-key".into(), REGISTERED_SYNC_KEY.into())],
            json_body(json!({"origin_id":"registered-edge","generation":1,"facts":[]})),
        )
        .await
        .status,
        StatusCode::OK,
        "a registered origin still ingests with only its own credential"
    );

    let login = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        vec![],
        json_body(json!({"username":"admin","password":"admin-password-1"})),
    )
    .await;
    assert_eq!(login.status, StatusCode::OK);
    let admin_token = login.body["token"]
        .as_str()
        .unwrap_or_else(|| panic!("admin bearer token"))
        .to_string();
    let (admin_cookie, admin_csrf) = browser_cookie_header(&login.set_cookies);
    assert!(login
        .set_cookies
        .iter()
        .any(|cookie| cookie.starts_with("inventory_session=")
            && cookie.contains("HttpOnly")
            && cookie.contains("SameSite=Strict")));
    assert!(login
        .set_cookies
        .iter()
        .any(|cookie| cookie.starts_with("inventory_csrf=") && !cookie.contains("HttpOnly")));

    assert_eq!(
        send(
            app.clone(),
            "GET",
            "/api/v1/auth/me",
            vec![("cookie".into(), admin_cookie.clone())],
            None,
        )
        .await
        .status,
        StatusCode::OK
    );
    let cashier = json!({
        "username":"cashier.01",
        "display_name":"Cashier One",
        "password":"cashier-password-1",
        "role":"CASHIER"
    });
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/auth/users",
            vec![("cookie".into(), admin_cookie.clone())],
            json_body(cashier.clone()),
        )
        .await
        .status,
        StatusCode::FORBIDDEN,
        "cookie mutations require CSRF"
    );
    let created = send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        vec![
            ("cookie".into(), admin_cookie.clone()),
            ("x-csrf-token".into(), admin_csrf.clone()),
        ],
        json_body(cashier),
    )
    .await;
    assert_eq!(created.status, StatusCode::OK);
    let cashier_id = created.body["id"]
        .as_str()
        .and_then(|value| Uuid::parse_str(value).ok())
        .unwrap_or_else(|| panic!("cashier id"));

    let cashier_login = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        vec![],
        json_body(json!({"username":"cashier.01","password":"cashier-password-1"})),
    )
    .await;
    let cashier_token = cashier_login.body["token"]
        .as_str()
        .unwrap_or_else(|| panic!("cashier token"))
        .to_string();
    assert_eq!(
        send(
            app.clone(),
            "GET",
            "/api/v1/auth/users",
            vec![("authorization".into(), format!("Bearer {cashier_token}"),)],
            None,
        )
        .await
        .status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/inventory/observations",
            vec![("authorization".into(), format!("Bearer {admin_token}"),)],
            json_body(json!({
                "site_id":"store-07","pool":"store-07.floor","device_id":"spoofed",
                "reader_session_id":"x","observed_at":chrono::Utc::now(),
                "idempotency_key":"cloud-direct-rfid","observations":[]
            })),
        )
        .await
        .status,
        StatusCode::FORBIDDEN,
        "production Cloud must not trust client-supplied RFID device_id"
    );

    let deactivated = send(
        app.clone(),
        "POST",
        &format!("/api/v1/auth/users/{cashier_id}/active"),
        vec![("authorization".into(), format!("Bearer {admin_token}"))],
        json_body(json!({"active":false})),
    )
    .await;
    assert_eq!(deactivated.status, StatusCode::OK);
    assert_eq!(
        send(
            app.clone(),
            "GET",
            "/api/v1/inventory/pools",
            vec![("authorization".into(), format!("Bearer {cashier_token}"),)],
            None,
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED,
        "deactivation must revoke existing sessions"
    );

    let changed = send(
        app.clone(),
        "POST",
        "/api/v1/auth/change-password",
        vec![
            ("cookie".into(), admin_cookie),
            ("x-csrf-token".into(), admin_csrf),
        ],
        json_body(json!({
            "current_password":"admin-password-1",
            "new_password":"admin-password-2"
        })),
    )
    .await;
    assert_eq!(changed.status, StatusCode::OK);
    assert!(changed
        .set_cookies
        .iter()
        .all(|cookie| cookie.contains("Max-Age=0")));
    assert_eq!(
        send(
            app.clone(),
            "GET",
            "/api/v1/auth/me",
            vec![("authorization".into(), format!("Bearer {admin_token}"),)],
            None,
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED,
        "password change must revoke all old sessions"
    );

    cloud::create_user(
        &pool,
        CreateUserRequest {
            username: "lockout.user".into(),
            display_name: "Lockout User".into(),
            password: "lockout-password".into(),
            role: Role::Cashier.into(),
        },
        "test",
    )
    .await
    .unwrap_or_else(|error| panic!("create lockout user: {error}"));
    for _ in 0..5 {
        assert_eq!(
            send(
                app.clone(),
                "POST",
                "/api/v1/auth/login",
                vec![],
                json_body(json!({"username":"lockout.user","password":"wrong-password"})),
            )
            .await
            .status,
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/auth/login",
            vec![],
            json_body(json!({"username":"lockout.user","password":"lockout-password"})),
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED
    );
    sqlx::query(
        "UPDATE app_user SET login_blocked_until=now()-interval '1 second'
         WHERE username='lockout.user'",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("expire Cloud lockout: {error}"));
    let lockout_login = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        vec![],
        json_body(json!({"username":"lockout.user","password":"lockout-password"})),
    )
    .await;
    assert_eq!(lockout_login.status, StatusCode::OK);
    let lockout_token = lockout_login.body["token"]
        .as_str()
        .unwrap_or_else(|| panic!("lockout user token"));
    sqlx::query(
        "UPDATE auth_session SET last_seen_at=now()-interval '31 minutes'
         WHERE token_sha256=$1",
    )
    .bind(security::sha256_hex(lockout_token))
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("age Cloud session: {error}"));
    assert_eq!(
        send(
            app.clone(),
            "GET",
            "/api/v1/auth/me",
            vec![("authorization".into(), format!("Bearer {lockout_token}"),)],
            None,
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED,
        "idle Cloud sessions expire locally"
    );
}

#[tokio::test]
async fn dc_edge_cookie_csrf_session_and_logout_work_offline() {
    let dc_node = node(EdgeRole::Dc, "dc-01");
    let edge = Arc::new(
        SqliteEdge::open_in_memory(dc_node.clone())
            .unwrap_or_else(|error| panic!("DC Edge: {error}")),
    );
    let auth = Arc::new(
        EdgeAuth::new(
            edge.connection(),
            dc_node,
            edge_auth_config(Some("edge-admin-password")),
        )
        .unwrap_or_else(|error| panic!("DC auth: {error}")),
    );
    let app = dc_router_with_auth(edge, auth, frontend_dir())
        .unwrap_or_else(|error| panic!("DC router: {error}"));
    assert_eq!(
        send(app.clone(), "GET", "/api/v1/inventory/pools", vec![], None,)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    let login = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        vec![],
        json_body(json!({"username":"admin","password":"edge-admin-password"})),
    )
    .await;
    assert_eq!(login.status, StatusCode::OK);
    let (cookie, csrf) = browser_cookie_header(&login.set_cookies);
    assert_eq!(
        send(
            app.clone(),
            "GET",
            "/api/v1/inventory/pools",
            vec![("cookie".into(), cookie.clone())],
            None,
        )
        .await
        .status,
        StatusCode::OK
    );
    let intake = json!({
        "epc":"EPC-DC-AUTH-1","sku_code":"SKU-AUTH","unit_price_minor":100000,
        "actor_id":"forged-actor","idempotency_key":"dc-auth-intake-1"
    });
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/dc/intake",
            vec![("cookie".into(), cookie.clone())],
            json_body(intake.clone()),
        )
        .await
        .status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/dc/intake",
            vec![
                ("cookie".into(), cookie.clone()),
                ("x-csrf-token".into(), csrf.clone()),
            ],
            json_body(intake),
        )
        .await
        .status,
        StatusCode::CREATED
    );
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/auth/change-password",
            vec![
                ("cookie".into(), cookie.clone()),
                ("x-csrf-token".into(), csrf),
            ],
            json_body(json!({
                "current_password":"edge-admin-password",
                "new_password":"edge-admin-password-rotated"
            })),
        )
        .await
        .status,
        StatusCode::OK
    );
    assert_eq!(
        send(
            app.clone(),
            "GET",
            "/api/v1/inventory/pools",
            vec![("cookie".into(), cookie.clone())],
            None,
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED,
        "password rotation revokes the current Edge session"
    );
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/auth/login",
            vec![],
            json_body(json!({"username":"admin","password":"edge-admin-password"})),
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED
    );
    let rotated_login = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        vec![],
        json_body(json!({
            "username":"admin",
            "password":"edge-admin-password-rotated"
        })),
    )
    .await;
    assert_eq!(rotated_login.status, StatusCode::OK);
    let (rotated_cookie, rotated_csrf) = browser_cookie_header(&rotated_login.set_cookies);
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/auth/logout",
            vec![
                ("cookie".into(), rotated_cookie.clone()),
                ("x-csrf-token".into(), rotated_csrf),
            ],
            json_body(json!({})),
        )
        .await
        .status,
        StatusCode::OK
    );
    assert_eq!(
        send(
            app,
            "GET",
            "/api/v1/inventory/pools",
            vec![("cookie".into(), rotated_cookie)],
            None,
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED,
        "logout revokes the rotated Edge session"
    );
}

#[derive(Clone)]
struct DirectCloud {
    pool: PgPool,
}

#[async_trait]
impl SyncTransport for DirectCloud {
    async fn send(&self, batch: &IngestBatch) -> Result<IngestResponse, String> {
        cloud::ingest_batch(&self.pool, batch)
            .await
            .map_err(|error| error.to_string())
    }
}

fn sync_config(sync_key: &str) -> SyncConfig {
    SyncConfig {
        batch_limit: 100,
        breaker: BreakerPolicy {
            threshold: 3,
            base_cooldown_seconds: 1,
            max_cooldown_seconds: 10,
        },
        command_key: Some(cloud::command_signing_key(sync_key)),
    }
}

async fn run_store_cycle(store: &SqliteSyncStore, pool: &PgPool, sync_key: &str) {
    run_cycle(
        store,
        &sync_config(sync_key),
        &DirectCloud { pool: pool.clone() },
    )
    .await
    .unwrap_or_else(|error| panic!("Store sync cycle: {error}"));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn cloud_policy_store_login_rfid_rotation_revocation_and_sync(pool: PgPool) {
    let origin_id = "store-07-edge";
    let sync_key = "store-07-integration-sync-key-00000001";
    cloud::register_origin_credential_binding(
        &pool,
        origin_id,
        sync_key,
        Some("Store 07"),
        Some("store-07"),
        Some("STORE"),
        Some(1),
        Some(true),
    )
    .await
    .unwrap_or_else(|error| panic!("register Store: {error}"));
    let user = cloud::create_user(
        &pool,
        CreateUserRequest {
            username: "store.cashier".into(),
            display_name: "Store Cashier".into(),
            password: "cloud-password-1".into(),
            role: Role::Cashier.into(),
        },
        "admin",
    )
    .await
    .unwrap_or_else(|error| panic!("create Store user: {error}"));
    let user_id = user["id"]
        .as_str()
        .and_then(|value| Uuid::parse_str(value).ok())
        .unwrap_or_else(|| panic!("Store user id"));
    // A DC grant can go without a password — the hub signs people in there
    // with their Cloud session. A store has no such exchange.
    let passwordless_store_grant = cloud::upsert_edge_assignment(
        &pool,
        UpsertEdgeAssignmentRequest {
            origin_id: origin_id.into(),
            user_id,
            role: Role::Cashier.into(),
            edge_password: None,
            offline_ttl_seconds: Some(7 * 24 * 60 * 60),
        },
        "admin",
    )
    .await;
    assert!(matches!(
        passwordless_store_grant,
        Err(AppError::Validation(_))
    ));
    let weak_edge_credential = cloud::upsert_edge_assignment(
        &pool,
        UpsertEdgeAssignmentRequest {
            origin_id: origin_id.into(),
            user_id,
            role: Role::Cashier.into(),
            edge_password: Some("1234567".into()),
            offline_ttl_seconds: Some(7 * 24 * 60 * 60),
        },
        "admin",
    )
    .await;
    assert!(matches!(weak_edge_credential, Err(AppError::Validation(_))));
    cloud::upsert_edge_assignment(
        &pool,
        UpsertEdgeAssignmentRequest {
            origin_id: origin_id.into(),
            user_id,
            role: Role::Cashier.into(),
            edge_password: Some("edge-cashier-pin".into()),
            offline_ttl_seconds: Some(7 * 24 * 60 * 60),
        },
        "admin",
    )
    .await
    .unwrap_or_else(|error| panic!("assign Store user: {error}"));
    let registered_device = cloud::register_rfid_device(
        &pool,
        RegisterRfidDeviceRequest {
            device_id: "RFID-STORE-07".into(),
            origin_id: origin_id.into(),
            label: "Store 07 handheld".into(),
            pools: vec!["store-07.floor".into()],
            offline_ttl_seconds: Some(7 * 24 * 60 * 60),
        },
        "admin",
    )
    .await
    .unwrap_or_else(|error| panic!("register RFID: {error}"));
    let raw_device_key = registered_device["device_key"]
        .as_str()
        .unwrap_or_else(|| panic!("one-time device key"))
        .to_string();

    let store_node = node(EdgeRole::Store, "store-07");
    let edge = Arc::new(
        SqliteEdge::open_in_memory(store_node.clone())
            .unwrap_or_else(|error| panic!("Store Edge: {error}")),
    );
    let auth = Arc::new(
        EdgeAuth::new(edge.connection(), store_node, edge_auth_config(None))
            .unwrap_or_else(|error| panic!("Store auth: {error}")),
    );
    let store_sync = SqliteSyncStore::new(edge.connection());
    run_store_cycle(&store_sync, &pool, sync_key).await;
    let policy = auth
        .policy_version()
        .unwrap_or_else(|error| panic!("policy: {error}"))
        .unwrap_or_else(|| panic!("policy projected"));
    assert_eq!(policy.0, 2);

    let app = store_router_with_auth(edge.clone(), auth.clone(), frontend_dir())
        .unwrap_or_else(|error| panic!("Store router: {error}"));
    let login = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        vec![],
        json_body(json!({"username":"store.cashier","password":"edge-cashier-pin"})),
    )
    .await;
    assert_eq!(login.status, StatusCode::OK);
    let cashier_token = login.body["token"]
        .as_str()
        .unwrap_or_else(|| panic!("Edge cashier token"))
        .to_string();
    {
        let shared = edge.connection();
        let connection = shared
            .lock()
            .unwrap_or_else(|error| panic!("Store connection: {error}"));
        connection
            .execute(
                "UPDATE edge_user SET valid_until=?2 WHERE id=?1",
                rusqlite::params![
                    user_id.to_string(),
                    (chrono::Utc::now() - chrono::Duration::seconds(1)).to_rfc3339(),
                ],
            )
            .unwrap_or_else(|error| panic!("expire user lease: {error}"));
    }
    assert!(auth.authenticate(&cashier_token, false).is_err());
    cloud::publish_auth_policy(&pool, origin_id, "lease-renewal-test")
        .await
        .unwrap_or_else(|error| panic!("renew auth policy: {error}"));
    run_store_cycle(&store_sync, &pool, sync_key).await;
    auth.authenticate(&cashier_token, false)
        .unwrap_or_else(|error| panic!("session after lease renewal: {error}"));
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/store/movements",
            vec![("authorization".into(), format!("Bearer {cashier_token}"),)],
            json_body(json!({
                "epc":"x","quantity":1,"from":"store-07.warehouse:on_hand",
                "to":"store-07.floor:on_hand","cause":"NORMAL_MOVE","reason":"x",
                "actor_id":"store.cashier","idempotency_key":"cashier-forbidden",
                "reference_type":null,"reference_id":null
            })),
        )
        .await
        .status,
        StatusCode::FORBIDDEN,
        "cashier cannot perform supervisor inventory moves"
    );

    let make_rfid_request = |idempotency: &str, pool_id: &str, epc: &str| {
        serde_json::to_vec(&json!({
            "site_id":"store-07",
            "pool":pool_id,
            "reader_session_id":"floor-walk-1",
            "observed_at":chrono::Utc::now(),
            "idempotency_key":idempotency,
            "observations":[
                {"epc":epc,"antenna":"A1","rssi":-48.0,"read_count":3},
                {"epc":epc,"antenna":"A1","rssi":-41.0,"read_count":5}
            ]
        }))
        .unwrap_or_else(|error| panic!("RFID body: {error}"))
    };
    let signed_headers = |raw_key: &str, sequence: i64, body: &[u8]| {
        let timestamp = chrono::Utc::now().timestamp();
        let signing_key = derive_rfid_signing_key(raw_key);
        vec![
            ("x-device-id".into(), "RFID-STORE-07".into()),
            ("x-device-timestamp".into(), timestamp.to_string()),
            ("x-device-sequence".into(), sequence.to_string()),
            (
                "x-device-signature".into(),
                sign_rfid_request(
                    &signing_key,
                    "RFID-STORE-07",
                    timestamp,
                    sequence,
                    &security::sha256_hex(body),
                ),
            ),
        ]
    };
    let operator_headers = |raw_key: &str, sequence: i64, body: &[u8]| {
        let mut headers = signed_headers(raw_key, sequence, body);
        headers.push(("authorization".into(), format!("Bearer {cashier_token}")));
        headers
    };

    let wrong_pool = make_rfid_request(
        "rfid-wrong-pool",
        "store-07.warehouse",
        "E28000000000000000000001",
    );
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/rfid/observations",
            operator_headers(&raw_device_key, 1, &wrong_pool),
            Some(wrong_pool),
        )
        .await
        .status,
        StatusCode::FORBIDDEN
    );
    let body = make_rfid_request("rfid-valid-1", "store-07.floor", "E28000000000000000000001");
    let accepted = send(
        app.clone(),
        "POST",
        "/api/v1/rfid/observations",
        operator_headers(&raw_device_key, 1, &body),
        Some(body.clone()),
    )
    .await;
    assert_eq!(accepted.status, StatusCode::CREATED);
    let replay = send(
        app.clone(),
        "POST",
        "/api/v1/rfid/observations",
        operator_headers(&raw_device_key, 1, &body),
        Some(body.clone()),
    )
    .await;
    assert_eq!(replay.status, StatusCode::CREATED);
    assert_eq!(replay.body, accepted.body);

    let movement_before: i64 = sqlx::query_scalar("SELECT count(*)::bigint FROM movement")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("movement before RFID sync: {error}"));
    run_store_cycle(&store_sync, &pool, sync_key).await;
    let report = cloud::apply_pending(&pool, 100)
        .await
        .unwrap_or_else(|error| panic!("apply RFID: {error}"));
    assert!(report.blocked.is_empty());
    let observation = sqlx::query(
        "SELECT edge_origin_id,operator_id,device_sequence,read_count
         FROM observation_sighting WHERE edge_origin_id=$1",
    )
    .bind(origin_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("Cloud RFID observation: {error}"));
    assert_eq!(observation.get::<String, _>("edge_origin_id"), origin_id);
    let expected_operator = user_id.to_string();
    assert_eq!(
        observation
            .get::<Option<String>, _>("operator_id")
            .as_deref(),
        Some(expected_operator.as_str())
    );
    assert_eq!(observation.get::<i64, _>("device_sequence"), 1);
    assert_eq!(observation.get::<i64, _>("read_count"), 8);
    let movement_after: i64 = sqlx::query_scalar("SELECT count(*)::bigint FROM movement")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("movement after RFID sync: {error}"));
    assert_eq!(movement_after, movement_before);

    cloud::set_edge_assignment_active(
        &pool,
        origin_id,
        user_id,
        SetEdgeAssignmentActiveRequest { active: false },
        "admin",
    )
    .await
    .unwrap_or_else(|error| panic!("revoke Edge assignment: {error}"));
    run_store_cycle(&store_sync, &pool, sync_key).await;
    assert!(auth.authenticate(&cashier_token, false).is_err());
    // A bearer that no longer authenticates is attribution that could not be
    // made, not a refusal: the reads the device signed are filed, with no
    // operator, instead of waiting for somebody to sign in again.
    let stale_bearer = make_rfid_request(
        "rfid-stale-bearer",
        "store-07.floor",
        "E28000000000000000000004",
    );
    let filed = send(
        app.clone(),
        "POST",
        "/api/v1/rfid/observations",
        operator_headers(&raw_device_key, 2, &stale_bearer),
        Some(stale_bearer),
    )
    .await;
    assert_eq!(
        filed.status,
        StatusCode::CREATED,
        "a revoked bearer must not refuse a signed batch: {}",
        filed.body
    );

    cloud::set_rfid_device_active(
        &pool,
        "RFID-STORE-07",
        SetRfidDeviceActiveRequest { active: false },
        "admin",
    )
    .await
    .unwrap_or_else(|error| panic!("disable RFID: {error}"));
    run_store_cycle(&store_sync, &pool, sync_key).await;
    let disabled_body = make_rfid_request(
        "rfid-disabled",
        "store-07.floor",
        "E28000000000000000000002",
    );
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/rfid/observations",
            signed_headers(&raw_device_key, 2, &disabled_body),
            Some(disabled_body),
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED
    );

    let rotated = cloud::rotate_rfid_device_key(&pool, "RFID-STORE-07", "admin")
        .await
        .unwrap_or_else(|error| panic!("rotate RFID: {error}"));
    let rotated_key = rotated["device_key"]
        .as_str()
        .unwrap_or_else(|| panic!("rotated RFID key"))
        .to_string();
    run_store_cycle(&store_sync, &pool, sync_key).await;
    let old_key_body =
        make_rfid_request("rfid-old-key", "store-07.floor", "E28000000000000000000002");
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/rfid/observations",
            signed_headers(&raw_device_key, 1, &old_key_body),
            Some(old_key_body),
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED
    );
    let new_key_body =
        make_rfid_request("rfid-new-key", "store-07.floor", "E28000000000000000000002");
    let new_key_headers = {
        let timestamp = chrono::Utc::now().timestamp();
        let signing_key = derive_rfid_signing_key(&rotated_key);
        vec![
            ("x-device-id".into(), "RFID-STORE-07".into()),
            ("x-device-timestamp".into(), timestamp.to_string()),
            ("x-device-sequence".into(), "1".into()),
            (
                "x-device-signature".into(),
                sign_rfid_request(
                    &signing_key,
                    "RFID-STORE-07",
                    timestamp,
                    1,
                    &security::sha256_hex(&new_key_body),
                ),
            ),
        ]
    };
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/rfid/observations",
            new_key_headers,
            Some(new_key_body),
        )
        .await
        .status,
        StatusCode::CREATED,
        "rotated key resets the monotonic sequence and old key no longer works"
    );
    // The receipt outlives the key (sqlite 0082): the batch filed under the
    // old key, sent again under the new one after its answer was lost, gets
    // the answer it was given — not a second filing under a new batch id with
    // new observation ids, which the cloud would keep twice.
    let refiled = send(
        app.clone(),
        "POST",
        "/api/v1/rfid/observations",
        signed_headers(&rotated_key, 2, &body),
        Some(body),
    )
    .await;
    assert_eq!(refiled.status, StatusCode::CREATED);
    assert_eq!(
        refiled.body, accepted.body,
        "answered from its receipt, not filed again"
    );
    {
        let shared = edge.connection();
        let connection = shared
            .lock()
            .unwrap_or_else(|error| panic!("Store connection: {error}"));
        connection
            .execute(
                "UPDATE edge_rfid_device SET valid_until=?2 WHERE device_id=?1",
                rusqlite::params![
                    "RFID-STORE-07",
                    (chrono::Utc::now() - chrono::Duration::seconds(1)).to_rfc3339(),
                ],
            )
            .unwrap_or_else(|error| panic!("expire RFID lease: {error}"));
    }
    let expired_body =
        make_rfid_request("rfid-expired", "store-07.floor", "E28000000000000000000003");
    assert_eq!(
        send(
            app,
            "POST",
            "/api/v1/rfid/observations",
            signed_headers(&rotated_key, 2, &expired_body),
            Some(expired_body),
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED,
        "expired offline device leases fail closed"
    );

    let fresh = cloud::due_auth_policy_origins(&pool)
        .await
        .unwrap_or_else(|error| panic!("fresh policy schedule: {error}"));
    assert!(
        !fresh.iter().any(|candidate| candidate == origin_id),
        "a freshly issued policy must not be republished immediately"
    );
    sqlx::query(
        "UPDATE edge_auth_snapshot_state
         SET last_issued_at=now()-interval '13 hours'
         WHERE origin_id=$1",
    )
    .bind(origin_id)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("age policy schedule: {error}"));
    let due = cloud::due_auth_policy_origins(&pool)
        .await
        .unwrap_or_else(|error| panic!("due policy schedule: {error}"));
    assert!(
        due.iter().any(|candidate| candidate == origin_id),
        "privileged 24-hour leases need a twelve-hour renewal safety margin"
    );
}

/// Two account-administration behaviours that had no way to be true before.
///
/// A forgotten password used to retire an account permanently: the self-service
/// change demands the old password, usernames are never released, and there is
/// no delete. And rotating somebody's Edge PIN used to readmit them if they had
/// been suspended, because the upsert forced `active=true` — so the fix for one
/// problem quietly undid an unrelated decision.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn admin_reset_recovers_a_forgotten_password_and_pin_rotation_keeps_a_suspension(
    pool: PgPool,
) {
    let origin_id = "store-11-edge";
    cloud::register_origin_credential_binding(
        &pool,
        origin_id,
        "store-11-integration-sync-key-00000001",
        Some("Store 11"),
        Some("store-11"),
        Some("STORE"),
        Some(1),
        Some(true),
    )
    .await
    .unwrap_or_else(|error| panic!("register Store: {error}"));
    cloud::bootstrap_admin(&pool, Some("admin-password-1"), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), cloud_config()));

    let bearer = |token: &str| vec![("authorization".to_owned(), format!("Bearer {token}"))];
    let sign_in = |username: &'static str, password: &'static str| {
        let app = app.clone();
        async move {
            send(
                app,
                "POST",
                "/api/v1/auth/login",
                vec![],
                json_body(json!({"username": username, "password": password})),
            )
            .await
        }
    };

    let admin_token = sign_in("admin", "admin-password-1").await.body["token"]
        .as_str()
        .unwrap_or_else(|| panic!("admin token"))
        .to_string();

    let created = send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        bearer(&admin_token),
        json_body(json!({
            "username": "forgetful.01",
            "display_name": "Forgetful Cashier",
            "password": "first-password-1",
            "role": "CASHIER"
        })),
    )
    .await;
    assert_eq!(created.status, StatusCode::OK);
    let user_id = created.body["id"]
        .as_str()
        .and_then(|value| Uuid::parse_str(value).ok())
        .unwrap_or_else(|| panic!("created user id"));

    // They sign in, and that session is live.
    let theirs = sign_in("forgetful.01", "first-password-1").await;
    assert_eq!(theirs.status, StatusCode::OK);
    let their_token = theirs.body["token"]
        .as_str()
        .unwrap_or_else(|| panic!("cashier token"))
        .to_string();
    assert_eq!(
        send(
            app.clone(),
            "GET",
            "/api/v1/auth/me",
            bearer(&their_token),
            None
        )
        .await
        .status,
        StatusCode::OK
    );

    // A cashier cannot reset anybody's password, including their own this way.
    assert_eq!(
        send(
            app.clone(),
            "POST",
            &format!("/api/v1/auth/users/{user_id}/password"),
            bearer(&their_token),
            json_body(json!({"new_password": "self-service-nope-1"})),
        )
        .await
        .status,
        StatusCode::FORBIDDEN
    );

    let reset = send(
        app.clone(),
        "POST",
        &format!("/api/v1/auth/users/{user_id}/password"),
        bearer(&admin_token),
        json_body(json!({"new_password": "second-password-2"})),
    )
    .await;
    assert_eq!(reset.status, StatusCode::OK);
    assert_eq!(reset.body["reset"], json!(true));

    assert_eq!(
        sign_in("forgetful.01", "first-password-1").await.status,
        StatusCode::UNAUTHORIZED,
        "the forgotten password must stop working"
    );
    assert_eq!(
        sign_in("forgetful.01", "second-password-2").await.status,
        StatusCode::OK,
        "the password the administrator set must work"
    );
    assert_eq!(
        send(
            app.clone(),
            "GET",
            "/api/v1/auth/me",
            bearer(&their_token),
            None
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED,
        "a session standing on a password that may have leaked must not survive"
    );

    // Now the Edge assignment: suspend, then rotate the PIN.
    let assign = |password: &'static str| {
        let app = app.clone();
        let token = admin_token.clone();
        async move {
            send(
                app,
                "POST",
                "/api/v1/auth/edge-assignments",
                vec![("authorization".to_owned(), format!("Bearer {token}"))],
                json_body(json!({
                    "origin_id": origin_id,
                    "user_id": user_id,
                    "role": "CASHIER",
                    "edge_password": password,
                    "offline_ttl_seconds": 7 * 24 * 60 * 60
                })),
            )
            .await
        }
    };
    assert_eq!(assign("edge-pin-00000001").await.status, StatusCode::OK);
    assert_eq!(
        send(
            app.clone(),
            "POST",
            &format!("/api/v1/auth/edge-assignments/{origin_id}/{user_id}/active"),
            bearer(&admin_token),
            json_body(json!({"active": false})),
        )
        .await
        .status,
        StatusCode::OK
    );
    assert_eq!(assign("edge-pin-00000002").await.status, StatusCode::OK);

    let still_suspended: bool = sqlx::query_scalar(
        "SELECT active FROM edge_identity_assignment WHERE origin_id=$1 AND user_id=$2",
    )
    .bind(origin_id)
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("read assignment: {error}"));
    assert!(
        !still_suspended,
        "rotating an Edge PIN must not readmit a suspended operator"
    );
}

/// Promotion without abandoning the account.
///
/// Before this there was no way to change a role: a cashier made supervisor
/// needed a second account, which spent their username forever and split their
/// history across two identities.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_administrator_can_promote_somebody_but_never_themselves(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some("admin-password-1"), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), cloud_config()));
    let bearer = |token: &str| vec![("authorization".to_owned(), format!("Bearer {token}"))];
    let sign_in = |username: &'static str, password: &'static str| {
        let app = app.clone();
        async move {
            send(
                app,
                "POST",
                "/api/v1/auth/login",
                vec![],
                json_body(json!({"username": username, "password": password})),
            )
            .await
        }
    };

    let admin_login = sign_in("admin", "admin-password-1").await;
    let admin_token = admin_login.body["token"]
        .as_str()
        .unwrap_or_else(|| panic!("admin token"))
        .to_string();
    let admin_id = send(
        app.clone(),
        "GET",
        "/api/v1/auth/users",
        bearer(&admin_token),
        None,
    )
    .await
    // `rows`, not `items`: the account list answers an envelope now — a page,
    // an exact total and facet counts.
    .body["rows"][0]["id"]
        .as_str()
        .unwrap_or_else(|| panic!("admin id"))
        .to_string();

    let created = send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        bearer(&admin_token),
        json_body(json!({
            "username": "rising.star",
            "display_name": "Rising Star",
            "password": "cashier-password-1",
            "role": "CASHIER"
        })),
    )
    .await;
    let user_id = created.body["id"]
        .as_str()
        .unwrap_or_else(|| panic!("user id"))
        .to_string();

    // A cashier holds a session and cannot reach an Admin-only route.
    let their_token = sign_in("rising.star", "cashier-password-1").await.body["token"]
        .as_str()
        .unwrap_or_else(|| panic!("cashier token"))
        .to_string();
    assert_eq!(
        send(
            app.clone(),
            "GET",
            "/api/v1/auth/users",
            bearer(&their_token),
            None
        )
        .await
        .status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        send(
            app.clone(),
            "POST",
            &format!("/api/v1/auth/users/{user_id}/role"),
            bearer(&their_token),
            json_body(json!({"role": "ADMIN"})),
        )
        .await
        .status,
        StatusCode::FORBIDDEN,
        "a cashier must not be able to promote themselves"
    );

    // An administrator must not be able to demote themselves into a node with
    // no administrator left.
    assert_eq!(
        send(
            app.clone(),
            "POST",
            &format!("/api/v1/auth/users/{admin_id}/role"),
            bearer(&admin_token),
            json_body(json!({"role": "CASHIER"})),
        )
        .await
        .status,
        StatusCode::CONFLICT
    );

    let promoted = send(
        app.clone(),
        "POST",
        &format!("/api/v1/auth/users/{user_id}/role"),
        bearer(&admin_token),
        json_body(json!({"role": "SUPERVISOR"})),
    )
    .await;
    assert_eq!(promoted.status, StatusCode::OK);
    assert_eq!(promoted.body["previous_role"], json!("CASHIER"));
    assert_eq!(promoted.body["role"], json!("SUPERVISOR"));

    // The session issued before the change does not carry the new authority,
    // and is not left running with the old one either.
    assert_eq!(
        send(
            app.clone(),
            "GET",
            "/api/v1/auth/me",
            bearer(&their_token),
            None
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED,
        "a role change must not leave an older session standing"
    );

    let after = sign_in("rising.star", "cashier-password-1").await;
    assert_eq!(after.status, StatusCode::OK);
    assert_eq!(after.body["user"]["role"], json!("SUPERVISOR"));
}

/// An Edge can be asked about its own outbox, and told to send it now.
///
/// Cloud has eleven /sync endpoints and an Edge had none, so a site could
/// trade all day with nothing leaving the building and no symptom anybody
/// would notice — the sync agent only logs a cycle that advanced, so a sender
/// failing for hours looked exactly like one with nothing to send.
///
/// This router is built without a sender, which is the honest shape of a node
/// whose SYNC_UPLOAD_URL is unset: capture still runs, the backlog is still
/// durable, and the status must say plainly that nothing is being uploaded
/// rather than reporting a healthy idle sender.
#[tokio::test]
async fn an_edge_reports_its_outbox_and_says_so_when_it_has_no_sender() {
    let dc_node = node(EdgeRole::Dc, "dc-01");
    let edge = Arc::new(
        SqliteEdge::open_in_memory(dc_node.clone())
            .unwrap_or_else(|error| panic!("DC Edge: {error}")),
    );
    let auth = Arc::new(
        EdgeAuth::new(
            edge.connection(),
            dc_node,
            edge_auth_config(Some("edge-admin-password")),
        )
        .unwrap_or_else(|error| panic!("DC auth: {error}")),
    );
    let app = dc_router_with_auth(edge, auth, frontend_dir())
        .unwrap_or_else(|error| panic!("DC router: {error}"));

    // The outbox is not public: it says how far behind this site is.
    assert_eq!(
        send(app.clone(), "GET", "/api/v1/sync/status", vec![], None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        send(app.clone(), "POST", "/api/v1/sync/trigger", vec![], None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );

    let login = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        vec![],
        json_body(json!({"username":"admin","password":"edge-admin-password"})),
    )
    .await;
    assert_eq!(login.status, StatusCode::OK);
    let (cookie, csrf) = browser_cookie_header(&login.set_cookies);

    let status = send(
        app.clone(),
        "GET",
        "/api/v1/sync/status",
        vec![("cookie".into(), cookie.clone())],
        None,
    )
    .await;
    assert_eq!(status.status, StatusCode::OK);
    assert_eq!(
        status.body["sender_enabled"],
        json!(false),
        "a node with no upload address must not look like a healthy idle sender"
    );
    // Not asserted as zero: a freshly opened Edge has already captured its
    // first fact by the time anyone can ask, so pinning the number here would
    // be testing the bootstrap rather than the reporting.
    assert!(
        status.body["pending_facts"]
            .as_i64()
            .is_some_and(|n| n >= 0),
        "pending_facts must be a real count, got {}",
        status.body["pending_facts"]
    );
    assert_eq!(status.body["dead_lettered"], json!(0));
    assert_eq!(status.body["upload_url"], json!(null));

    // A write still needs the CSRF header, outbox or not.
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/sync/trigger",
            vec![("cookie".into(), cookie.clone())],
            json_body(json!({})),
        )
        .await
        .status,
        StatusCode::FORBIDDEN
    );

    let triggered = send(
        app.clone(),
        "POST",
        "/api/v1/sync/trigger",
        vec![("cookie".into(), cookie), ("x-csrf-token".into(), csrf)],
        json_body(json!({})),
    )
    .await;
    assert_eq!(triggered.status, StatusCode::OK);
    assert_eq!(
        triggered.body["triggered"],
        json!(false),
        "a button that silently does nothing is worse than one that says so"
    );
    assert!(triggered.body["reason"].is_string());
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_dc_grant_needs_no_password_and_a_role_change_keeps_the_one_it_has(pool: PgPool) {
    let origin_id = "dc-edge";
    cloud::register_origin_credential_binding(
        &pool,
        origin_id,
        "dc-integration-sync-key-0000000000001",
        Some("DC"),
        Some("dc"),
        Some("DC"),
        Some(1),
        Some(true),
    )
    .await
    .unwrap_or_else(|error| panic!("register DC: {error}"));
    let user = cloud::create_user(
        &pool,
        CreateUserRequest {
            username: "dc.operator".into(),
            display_name: "DC Operator".into(),
            password: "cloud-password-1".into(),
            role: Role::Cashier.into(),
        },
        "admin",
    )
    .await
    .unwrap_or_else(|error| panic!("create DC user: {error}"));
    let user_id = user["id"]
        .as_str()
        .and_then(|value| Uuid::parse_str(value).ok())
        .unwrap_or_else(|| panic!("DC user id"));
    let grant = |role: Role, edge_password: Option<&str>| {
        cloud::upsert_edge_assignment(
            &pool,
            UpsertEdgeAssignmentRequest {
                origin_id: origin_id.into(),
                user_id,
                role: role.into(),
                edge_password: edge_password.map(Into::into),
                offline_ttl_seconds: None,
            },
            "admin",
        )
    };
    let verifier = || async {
        sqlx::query(
            "SELECT credential_hash,edge_role FROM edge_identity_assignment
             WHERE origin_id=$1 AND user_id=$2",
        )
        .bind(origin_id)
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .map(|row| (row.get::<String, _>(0), row.get::<String, _>(1)))
        .unwrap_or_else(|error| panic!("assignment: {error}"))
    };

    grant(Role::Cashier, None)
        .await
        .unwrap_or_else(|error| panic!("passwordless DC grant: {error}"));
    assert_eq!(verifier().await.0, security::SSO_ONLY_VERIFIER);

    grant(Role::Cashier, Some("dc-offline-pin-1"))
        .await
        .unwrap_or_else(|error| panic!("offline password: {error}"));
    let (with_password, _) = verifier().await;
    assert!(with_password.starts_with("$argon2"));

    grant(Role::Supervisor, None)
        .await
        .unwrap_or_else(|error| panic!("role change: {error}"));
    assert_eq!(verifier().await, (with_password, "SUPERVISOR".to_owned()));
}
