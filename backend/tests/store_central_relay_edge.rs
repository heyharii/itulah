//! The store node's side of the HR relay: `/api/v1/store/central/{path}`.
//!
//! The first test is the node alone, and holds it to what it must refuse
//! before anything leaves the shop: nobody signed in, a node with sign-in off,
//! a LOCAL break-glass account, a path off the relay list. The second is the
//! whole trip — a till's session in, a real cloud behind the node's upload URL
//! — so the headers the node sends are the headers the cloud checks.

use axum::body::{to_bytes, Body};
use chrono::{Duration, SecondsFormat, Utc};
use http::{header, Request, StatusCode};
use inventory_backend::{
    cloud::{
        application::{CreateUserRequest, UpsertEdgeAssignmentRequest},
        domain::{BreakerPolicy, Role},
        http as cloud_http, postgres as cloud, AppConfig, AppState,
    },
    edge::{
        store_router, store_router_with_auth, store_router_with_sync,
        sync::{spawn_agent, EdgeSyncConfig},
        EdgeAuth, EdgeAuthConfig, EdgeRole, NodeContext, SiteId, SqliteEdge,
    },
    security,
};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tower::ServiceExt;
use uuid::Uuid;

const ORIGIN_07: &str = "store-07-edge";
const KEY_07: &str = "store-07-central-relay-key-000000000001";
const LOCAL_ADMIN_PASSWORD: &str = "edge-admin-password-central-1";
const CLOUD_USER_PASSWORD: &str = "edge-relay-password-central-1";

struct Response {
    status: StatusCode,
    body: Value,
}

async fn send(
    app: &axum::Router,
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
        .clone()
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
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap_or_else(|error| panic!("read body: {error}"));
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| json!({ "raw": String::from_utf8_lossy(&bytes).to_string() }))
    };
    Response { status, body }
}

fn frontend_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend")
}

fn store_node() -> NodeContext {
    NodeContext::new(
        ORIGIN_07,
        EdgeRole::Store,
        SiteId::new("store-07").unwrap_or_else(|error| panic!("site: {error}")),
    )
    .unwrap_or_else(|error| panic!("node: {error}"))
}

/// A store node with sign-in on, holding its LOCAL break-glass admin.
fn store_edge() -> (Arc<SqliteEdge>, Arc<EdgeAuth>) {
    let edge = Arc::new(
        SqliteEdge::open_in_memory(store_node())
            .unwrap_or_else(|error| panic!("store edge: {error}")),
    );
    let auth = Arc::new(
        EdgeAuth::new(
            edge.connection(),
            store_node(),
            EdgeAuthConfig {
                enabled: true,
                session_ttl_minutes: 60,
                session_idle_minutes: 30,
                cookie_secure: false,
                bootstrap_admin_password: Some(LOCAL_ADMIN_PASSWORD.into()),
            },
        )
        .unwrap_or_else(|error| panic!("store auth: {error}")),
    );
    (edge, auth)
}

/// Project a head-office account onto the node, as `auth.policy.replace` does:
/// the node's user id IS the cloud's `app_user.id`, and the source says so.
fn project_cloud_user(edge: &SqliteEdge, user_id: Uuid, username: &str) {
    let now = Utc::now();
    let text = |at: chrono::DateTime<Utc>| at.to_rfc3339_opts(SecondsFormat::Micros, true);
    let hash = security::hash_password(CLOUD_USER_PASSWORD, 8)
        .unwrap_or_else(|error| panic!("hash: {error}"));
    let shared = edge.connection();
    let connection = shared
        .lock()
        .unwrap_or_else(|error| panic!("edge connection: {error}"));
    connection
        .execute(
            "INSERT INTO edge_user
                 (id,username,display_name,password_hash,role,active,auth_version,source,
                  policy_version,valid_until,created_at,updated_at)
             VALUES(?1,?2,?3,?4,'SUPERVISOR',1,1,'CLOUD',1,?5,?6,?6)",
            rusqlite::params![
                user_id.to_string(),
                username,
                format!("{username} (projected)"),
                hash,
                text(now + Duration::hours(12)),
                text(now),
            ],
        )
        .unwrap_or_else(|error| panic!("project {username}: {error}"));
}

async fn bearer(app: &axum::Router, username: &str, password: &str) -> Vec<(String, String)> {
    let login = send(
        app,
        "POST",
        "/api/v1/auth/login",
        vec![],
        Some(json!({ "username": username, "password": password })),
    )
    .await;
    assert_eq!(
        login.status,
        StatusCode::OK,
        "{username} login: {:?}",
        login.body
    );
    let token = login.body["token"]
        .as_str()
        .unwrap_or_else(|| panic!("token: {:?}", login.body));
    vec![(header::AUTHORIZATION.to_string(), format!("Bearer {token}"))]
}

#[tokio::test]
async fn the_node_refuses_before_anything_leaves_the_shop() {
    let (edge, auth) = store_edge();
    project_cloud_user(&edge, Uuid::new_v4(), "mgr.seven");
    let app = store_router_with_auth(edge.clone(), auth, frontend_dir())
        .unwrap_or_else(|error| panic!("store router: {error}"));

    // Nobody signed in.
    let anonymous = send(
        &app,
        "GET",
        "/api/v1/store/central/employees/me/reach",
        vec![],
        None,
    )
    .await;
    assert_eq!(
        anonymous.status,
        StatusCode::UNAUTHORIZED,
        "{:?}",
        anonymous.body
    );

    // A LOCAL break-glass account has nobody behind it at head office.
    let local = bearer(&app, "admin", LOCAL_ADMIN_PASSWORD).await;
    let refused = send(
        &app,
        "GET",
        "/api/v1/store/central/employees/me/reach",
        local,
        None,
    )
    .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN, "{:?}", refused.body);
    assert!(
        refused.body["error"]
            .as_str()
            .is_some_and(|said| said.contains("head office does not know it")),
        "{:?}",
        refused.body
    );

    // A head-office account, asking for a path off the list — or one that
    // would change meaning once a URL library had normalised it.
    let manager = bearer(&app, "mgr.seven", CLOUD_USER_PASSWORD).await;
    for (method, path) in [
        ("GET", "/api/v1/store/central/auth/users"),
        ("GET", "/api/v1/store/central/employees/emp_x/personal-data"),
        ("GET", "/api/v1/store/central/payroll/runs"),
        ("GET", "/api/v1/store/central/ga/overview"),
        ("DELETE", "/api/v1/store/central/employees/emp_x"),
        ("GET", "/api/v1/store/central/employees/%2e%2e"),
        ("GET", "/api/v1/store/central/employees/..%2Fauth%2Fusers"),
        ("GET", "/api/v1/store/central/employees/me/reach/"),
    ] {
        let refused = send(&app, method, path, manager.clone(), None).await;
        assert_eq!(
            refused.status,
            StatusCode::FORBIDDEN,
            "{method} {path}: {:?}",
            refused.body
        );
    }

    // On the list, from the right account — and this node has no upload URL,
    // so the answer is that head office cannot be reached, not an invention.
    let unreachable = send(
        &app,
        "GET",
        "/api/v1/store/central/employees/me/reach",
        manager,
        None,
    )
    .await;
    assert_eq!(
        unreachable.status,
        StatusCode::SERVICE_UNAVAILABLE,
        "{:?}",
        unreachable.body
    );

    // A node with sign-in switched off relays for nobody.
    let (open_edge, _) = store_edge();
    let open = store_router(open_edge, frontend_dir())
        .unwrap_or_else(|error| panic!("open store router: {error}"));
    let refused = send(
        &open,
        "GET",
        "/api/v1/store/central/employees/me/reach",
        vec![],
        None,
    )
    .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN, "{:?}", refused.body);
}

fn cloud_config() -> AppConfig {
    AppConfig {
        po_import: inventory_backend::cloud::intake::po::PoImportConfig::from_env(),
        clock: None,
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|error| panic!("bind: {error}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "cloud-central-relay-test".into(),
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

/// The whole trip: a till's session in at the node, the node's key and the
/// manager's id out to a real cloud, and the cloud's answer back verbatim.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_managers_call_reaches_head_office_through_the_node(pool: PgPool) {
    cloud::register_origin_credential_binding(
        &pool,
        ORIGIN_07,
        KEY_07,
        Some("Store 07"),
        Some("store-07"),
        Some("STORE"),
        Some(1),
        Some(true),
    )
    .await
    .unwrap_or_else(|error| panic!("register origin: {error}"));
    let user = cloud::create_user(
        &pool,
        CreateUserRequest {
            username: "mgr.seven".into(),
            display_name: "Manager Seven".into(),
            password: "cloud-password-central-1".into(),
            role: Role::Supervisor.into(),
        },
        "admin",
    )
    .await
    .unwrap_or_else(|error| panic!("create user: {error}"));
    let user_id = user["id"]
        .as_str()
        .and_then(|value| Uuid::parse_str(value).ok())
        .unwrap_or_else(|| panic!("user id: {user:?}"));
    cloud::upsert_edge_assignment(
        &pool,
        UpsertEdgeAssignmentRequest {
            origin_id: ORIGIN_07.into(),
            user_id,
            role: Role::Supervisor.into(),
            edge_password: Some(CLOUD_USER_PASSWORD.into()),
            offline_ttl_seconds: Some(12 * 60 * 60),
        },
        "admin",
    )
    .await
    .unwrap_or_else(|error| panic!("assign: {error}"));
    for site in ["store-07", "store-03"] {
        cloud::ga_supply_record(
            &pool,
            &cloud::RecordGaSupplyRequestRequest {
                site_id: site.into(),
                requested_by: "Rina".into(),
                category_code: "ATK".into(),
                item: format!("Kertas A4 untuk {site}"),
                quantity: None,
                needed_by: None,
                estimated_cost_minor: None,
                notes: None,
            },
            "ga.ho",
            None,
        )
        .await
        .unwrap_or_else(|error| panic!("supply at {site}: {error}"));
    }

    // Head office, listening on a real socket — the relay is an HTTP call.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .unwrap_or_else(|error| panic!("bind cloud: {error}"));
    let address = listener
        .local_addr()
        .unwrap_or_else(|error| panic!("cloud address: {error}"));
    let cloud_app = cloud_http::router(AppState::new(pool.clone(), cloud_config()));
    tokio::spawn(async move {
        let _ = axum::serve(listener, cloud_app).await;
    });

    let (edge, auth) = store_edge();
    project_cloud_user(&edge, user_id, "mgr.seven");
    let sync = spawn_agent(
        &edge,
        EdgeSyncConfig {
            upload_url: format!("http://{address}/api/v1/sync/ingest"),
            upload_key: KEY_07.into(),
            // Long enough that the sender never runs during the test: this is
            // about the relay, not the outbox.
            interval_seconds: 3600,
            batch_limit: 100,
            retention_days: 14,
            breaker: BreakerPolicy {
                threshold: 3,
                base_cooldown_seconds: 1,
                max_cooldown_seconds: 10,
            },
        },
    )
    .unwrap_or_else(|error| panic!("sync agent: {error}"));
    let app = store_router_with_sync(edge.clone(), auth, frontend_dir(), Some(sync))
        .unwrap_or_else(|error| panic!("store router: {error}"));
    let manager = bearer(&app, "mgr.seven", CLOUD_USER_PASSWORD).await;

    // The person, at the lower of their two rungs, as head office sees them.
    let reach = send(
        &app,
        "GET",
        "/api/v1/store/central/employees/me/reach",
        manager.clone(),
        None,
    )
    .await;
    assert_eq!(reach.status, StatusCode::OK, "{:?}", reach.body);
    assert_eq!(reach.body["role"], "SUPERVISOR");

    // The shop's own supply requests, and only its own.
    let supplies = send(
        &app,
        "GET",
        "/api/v1/store/central/ga/supplies",
        manager.clone(),
        None,
    )
    .await;
    assert_eq!(supplies.status, StatusCode::OK, "{:?}", supplies.body);
    let rows = supplies
        .body
        .as_array()
        .unwrap_or_else(|| panic!("supplies: {:?}", supplies.body));
    assert_eq!(rows.len(), 1, "{rows:?}");
    assert_eq!(rows[0]["site_id"], "store-07");

    // Head office's refusal comes back in its own status and words, query
    // string and all.
    let elsewhere = send(
        &app,
        "GET",
        "/api/v1/store/central/ga/supplies?site=store-03",
        manager.clone(),
        None,
    )
    .await;
    assert_eq!(
        elsewhere.status,
        StatusCode::FORBIDDEN,
        "{:?}",
        elsewhere.body
    );
    assert!(
        elsewhere.body["error"]
            .as_str()
            .is_some_and(|said| said.contains("store-07")),
        "{:?}",
        elsewhere.body
    );

    // A write carries its body up, under the manager's own name.
    let filed = send(
        &app,
        "POST",
        "/api/v1/store/central/ga/supplies",
        manager,
        Some(json!({
            "site_id": "store-07",
            "requested_by": "Rina",
            "category_code": "ATK",
            "item": "Tinta printer",
        })),
    )
    .await;
    assert_eq!(filed.status, StatusCode::OK, "{:?}", filed.body);
    assert_eq!(filed.body["site_id"], "store-07");
}
