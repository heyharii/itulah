//! `GET /api/v1/sync/health` end to end, over a migrated Postgres.
//!
//! The classification rule already has unit tests beside it in
//! `cloud/postgres/sync_health.rs`. What those cannot show is whether the SQL
//! underneath it actually puts a real node into the state the rule names, so
//! everything here drives the fleet through its own public doors — an origin
//! registered the way the operator registers one, a command issued through
//! `issue_command`, a batch posted at `/api/v1/sync/ingest` with that origin's
//! key — and then reads the endpoint's JSON.

use axum::body::{to_bytes, Body};
use http::{Request, StatusCode};
use inventory_backend::cloud::{
    application::{AppConfig, AppState, CreateUserRequest},
    domain::{required_role, IngestBatch, Role, SyncFact},
    http as api_http, postgres as infrastructure,
};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

/// The same shape `sync_integration.rs` uses: auth off, so the endpoint can be
/// read without minting a session, and nothing else about the node changed.
fn test_config() -> AppConfig {
    AppConfig {
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|e| panic!("socket address: {e}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "cloud-sync-health-test".into(),
        node_role: "CLOUD".into(),
        rfid_burst_window_seconds: 10,
        observed_window_hours: 24,
        lost_risk_window_days: 30,
        enable_test_controls: false,
        frontend_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend"),
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

/// The same node with sign-in switched on, for the authorization test.
fn authenticated_config() -> AppConfig {
    AppConfig {
        // Compatibility marker; opaque sessions do not sign JWTs.
        jwt_secret: Some("opaque-auth-enabled".into()),
        ..test_config()
    }
}

struct Answer {
    status: StatusCode,
    body: Value,
}

async fn send(
    app: axum::Router,
    method: &str,
    path: &str,
    headers: Vec<(&str, String)>,
    body: Option<Value>,
) -> Answer {
    let mut builder = Request::builder().method(method).uri(path);
    for (name, value) in headers {
        builder = builder.header(name, value);
    }
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    let request = builder
        .body(body.map_or_else(Body::empty, |value| {
            Body::from(serde_json::to_vec(&value).unwrap_or_else(|e| panic!("request body: {e}")))
        }))
        .unwrap_or_else(|e| panic!("request {method} {path}: {e}"));
    let response = app
        .oneshot(request)
        .await
        .unwrap_or_else(|e| panic!("response {method} {path}: {e}"));
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap_or_else(|e| panic!("body {method} {path}: {e}"));
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or_else(|e| {
            panic!(
                "JSON {method} {path}: {e} in {:?}",
                String::from_utf8_lossy(&bytes)
            )
        })
    };
    Answer { status, body }
}

async fn health(app: axum::Router) -> Value {
    let answer = send(app, "GET", "/api/v1/sync/health", vec![], None).await;
    assert_eq!(answer.status, StatusCode::OK, "{:?}", answer.body);
    answer.body
}

fn origin<'a>(health: &'a Value, origin_id: &str) -> &'a Value {
    health["origins"]
        .as_array()
        .unwrap_or_else(|| panic!("origins is not an array"))
        .iter()
        .find(|o| o["origin_id"] == origin_id)
        .unwrap_or_else(|| panic!("origin {origin_id} missing from {:?}", health["origins"]))
}

fn reasons(health: &Value) -> Vec<String> {
    health["reasons"]
        .as_array()
        .unwrap_or_else(|| panic!("reasons is not an array"))
        .iter()
        .map(|r| r.as_str().unwrap_or_default().to_string())
        .collect()
}

/// Nothing registered at all. The shape must still be whole — a console that
/// draws 24 bars cannot be handed 0 of them on the first morning.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_empty_fleet_still_answers_with_a_whole_shape(pool: PgPool) {
    let app = api_http::router(AppState::new(pool.clone(), test_config()));
    let health = health(app).await;

    assert_eq!(health["fleet"]["origins"], 0);
    assert_eq!(health["fleet"]["never"], 0);
    assert_eq!(health["fleet"]["healthy"], 0);
    assert_eq!(
        health["origins"].as_array().map(Vec::len),
        Some(0),
        "no origins registered, so no rows"
    );
    assert_eq!(
        health["hourly"].as_array().map(Vec::len),
        Some(24),
        "the hourly series is gap-filled, so a silent day is 24 zeroes and not an empty array"
    );
    assert!(health["hourly"]
        .as_array()
        .unwrap_or_else(|| panic!("hourly"))
        .iter()
        .all(|h| h["facts_accepted"] == 0
            && h["facts_rejected"] == 0
            && h["commands_issued"] == 0));
    assert_eq!(health["sync_state"], "OK");
    assert_eq!(health["downstream"]["pending_total"], 0);
    assert_eq!(health["upstream"]["accepted_total"], 0);
    assert_eq!(health["silent_after_seconds"], 900);
    assert_eq!(health["checkpoint_stale_after_seconds"], 300);

    // NOT "HEALTHY". An empty fleet is quiet, but this test node runs with
    // sign-in disabled and no accounts, and both of those are BAD security
    // checks, which `verdict_of` folds into the verdict as reasons of their
    // own. The verdict is about the whole installation, not only the lanes.
    assert_eq!(
        health["verdict"],
        "ATTENTION",
        "auth off + zero admins are two BAD checks: {:?}",
        reasons(&health)
    );
    let reasons = reasons(&health);
    assert!(
        reasons
            .iter()
            .any(|r| r.contains("Sign-in is switched off")),
        "{reasons:?}"
    );
    assert!(
        reasons.iter().any(|r| r.contains("Administrators")),
        "{reasons:?}"
    );
    assert_eq!(health["security"]["auth_enabled"], false);
    assert_eq!(health["security"]["accounts_total"], 0);

    // The exposures are read from the code, not measured, so they are present
    // even here where every measured check that can pass has passed.
    let exposures = health["security"]["exposures"]
        .as_array()
        .unwrap_or_else(|| panic!("exposures"));
    assert!(exposures.iter().any(|e| e["id"] == "assistant_sql_reach"));
    assert!(exposures.iter().any(|e| e["id"] == "metrics_public"));
}

const QUIET_KEY: &str = "sync-health-quiet-origin-key-00000001";
const LIVE_KEY: &str = "sync-health-live-origin-key-000000001";

/// Two registered nodes, one command waiting for each. Neither has ever
/// spoken; then one of them uploads and acknowledges, and only that one moves.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_registered_origin_is_never_until_it_speaks_and_then_lags_until_the_centre_applies(
    pool: PgPool,
) {
    infrastructure::register_origin_credential(&pool, "store-quiet", QUIET_KEY, Some("Toko Diam"))
        .await
        .unwrap_or_else(|e| panic!("register store-quiet: {e}"));
    infrastructure::register_origin_credential(&pool, "store-live", LIVE_KEY, Some("Toko Hidup"))
        .await
        .unwrap_or_else(|e| panic!("register store-live: {e}"));

    // The centre-to-node lane, opened by the same call `POST
    // /api/v1/sync/commands` makes. Empty targets means the whole fleet.
    let (_command_id, targets) = infrastructure::issue_command(
        &pool,
        "test.sync_health.ping",
        &json!({"note": "a command nobody has collected"}),
        "sync-health-test",
        None,
        &[],
    )
    .await
    .unwrap_or_else(|e| panic!("issue: {e}"));
    assert_eq!(
        targets,
        vec!["store-live".to_string(), "store-quiet".to_string()],
        "an untargeted command is delivered to every registered origin"
    );

    let state = AppState::new(pool.clone(), test_config());
    let before = health(api_http::router(state.clone())).await;

    assert_eq!(before["fleet"]["origins"], 2);
    assert_eq!(before["fleet"]["never"], 2);
    for id in ["store-quiet", "store-live"] {
        let node = origin(&before, id);
        assert_eq!(node["status"], "NEVER", "{id} has never contacted us");
        assert!(
            node["pending_commands"].as_i64().unwrap_or_default() >= 1,
            "{id} pending_commands: {:?}",
            node["pending_commands"]
        );
        assert_eq!(node["last_received_at"], Value::Null);
        assert_eq!(node["last_contact_at"], Value::Null);
        assert_eq!(node["issued_seq"], 1);
        assert_eq!(node["acked_seq"], 0);
    }
    assert_eq!(before["downstream"]["pending_total"], 2);
    assert_eq!(before["downstream"]["origins_behind"], 2);
    assert_eq!(before["upstream"]["origins_reporting"], 0);
    assert_eq!(before["verdict"], "ATTENTION", "{:?}", reasons(&before));
    assert!(
        reasons(&before)
            .iter()
            .any(|r| r.contains("never contacted the centre")),
        "{:?}",
        reasons(&before)
    );
    // The hour the command was issued is the only non-zero bar downstream.
    let issued: i64 = before["hourly"]
        .as_array()
        .unwrap_or_else(|| panic!("hourly"))
        .iter()
        .map(|h| h["commands_issued"].as_i64().unwrap_or_default())
        .sum();
    assert_eq!(issued, 1);

    // ---- one node now speaks, through the real ingest route ----
    let batch = IngestBatch {
        origin_id: "store-live".into(),
        generation: 1,
        // It collected the command and applied it, so it acknowledges seq 1.
        command_watermark: 1,
        command_blocked: None,
        facts: vec![SyncFact {
            seq: 1,
            event_id: uuid::Uuid::new_v4(),
            event_type: "test.performance".into(),
            payload: json!({"seq": 1}),
            created_at: chrono::Utc::now(),
        }],
    };
    let ingested = send(
        api_http::router(state.clone()),
        "POST",
        "/api/v1/sync/ingest",
        vec![("x-sync-key", LIVE_KEY.into())],
        Some(serde_json::to_value(&batch).unwrap_or_else(|e| panic!("batch: {e}"))),
    )
    .await;
    assert_eq!(ingested.status, StatusCode::OK, "{:?}", ingested.body);
    assert_eq!(ingested.body["durable_through"], 1);

    let after = health(api_http::router(state)).await;

    assert_eq!(
        after["fleet"]["never"], 1,
        "the node that spoke left NEVER; the silent one stayed"
    );
    assert_eq!(origin(&after, "store-quiet")["status"], "NEVER");

    let live = origin(&after, "store-live");
    assert_ne!(
        live["last_received_at"],
        Value::Null,
        "the ingest bumped the heartbeat"
    );
    assert_ne!(live["last_contact_at"], Value::Null);
    assert_eq!(live["acked_seq"], 1, "the command watermark rode the batch");
    assert_eq!(live["pending_commands"], 0, "nothing owed downstream now");
    // LAGGING, not HEALTHY: the fact is durable at the centre (durable_seq 1)
    // but the apply pass is a separate job — `sync_apply_enabled` is off on
    // this node — so `sync_applied_watermark` is still empty and apply_lag is
    // 1. `classify_lane` calls any owed work while talking LAGGING.
    assert_eq!(live["durable_seq"], 1);
    assert_eq!(live["applied_seq"], Value::Null);
    assert_eq!(live["apply_lag"], 1);
    assert_eq!(
        live["status"], "LAGGING",
        "received but not yet applied is lag, not health: durable {:?} applied {:?} pending {:?}",
        live["durable_seq"], live["applied_seq"], live["pending_commands"]
    );
    assert_eq!(after["fleet"]["lagging"], 1);
    assert_eq!(after["upstream"]["origins_reporting"], 1);
    assert_eq!(after["upstream"]["accepted_total"], 1);
    assert_eq!(after["upstream"]["accepted_24h"], 1);
    assert_eq!(after["upstream"]["apply_lag_total"], 1);
    assert_eq!(after["downstream"]["pending_total"], 1);
    assert_eq!(
        after["verdict"],
        "ATTENTION",
        "one node still never spoke: {:?}",
        reasons(&after)
    );
    let accepted: i64 = after["hourly"]
        .as_array()
        .unwrap_or_else(|| panic!("hourly"))
        .iter()
        .map(|h| h["facts_accepted"].as_i64().unwrap_or_default())
        .sum();
    assert_eq!(accepted, 1);
    assert_eq!(
        after["hourly"].as_array().map(Vec::len),
        Some(24),
        "still 24 buckets once there is traffic in one of them"
    );
}

/// The gate. `/sync/fleet` and `/sync/status` fall through to Cashier; this one
/// carries blocked-command reasons and the open exposures, so it is Admin.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn only_an_admin_may_read_the_health_of_the_fleet(pool: PgPool) {
    assert_eq!(
        required_role("GET", "/api/v1/sync/health"),
        Role::Admin,
        "the route table itself must say Admin"
    );

    infrastructure::bootstrap_admin(&pool, Some("admin-password-1"), true)
        .await
        .unwrap_or_else(|e| panic!("bootstrap: {e}"));
    infrastructure::create_user(
        &pool,
        CreateUserRequest {
            username: "kasir.01".into(),
            display_name: "Kasir Satu".into(),
            password: "cashier-password-1".into(),
            role: Role::Cashier,
        },
        "sync-health-test",
    )
    .await
    .unwrap_or_else(|e| panic!("create cashier: {e}"));

    let state = AppState::new(pool.clone(), authenticated_config());
    let login = |username: &'static str, password: &'static str| {
        let state = state.clone();
        async move {
            let answer = send(
                api_http::router(state),
                "POST",
                "/api/v1/auth/login",
                vec![],
                Some(json!({"username": username, "password": password})),
            )
            .await;
            assert_eq!(answer.status, StatusCode::OK, "{:?}", answer.body);
            answer.body["token"]
                .as_str()
                .unwrap_or_else(|| panic!("{username} token"))
                .to_string()
        }
    };
    let admin_token = login("admin", "admin-password-1").await;
    let cashier_token = login("kasir.01", "cashier-password-1").await;

    assert_eq!(
        send(
            api_http::router(state.clone()),
            "GET",
            "/api/v1/sync/health",
            vec![],
            None
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED,
        "no session at all"
    );
    assert_eq!(
        send(
            api_http::router(state.clone()),
            "GET",
            "/api/v1/sync/health",
            vec![("authorization", format!("Bearer {cashier_token}"))],
            None,
        )
        .await
        .status,
        StatusCode::FORBIDDEN,
        "a till may read /sync/status, never this"
    );

    let answer = send(
        api_http::router(state),
        "GET",
        "/api/v1/sync/health",
        vec![("authorization", format!("Bearer {admin_token}"))],
        None,
    )
    .await;
    assert_eq!(answer.status, StatusCode::OK, "{:?}", answer.body);
    assert_eq!(answer.body["security"]["auth_enabled"], true);
    assert_eq!(answer.body["security"]["admins_active"], 1);
    assert_eq!(answer.body["security"]["accounts_active"], 2);
    assert!(
        answer.body["security"]["live_sessions"]
            .as_i64()
            .unwrap_or_default()
            >= 2,
        "both logins are live: {:?}",
        answer.body["security"]["live_sessions"]
    );
    // With sign-in on and one administrator, an empty fleet finally reaches
    // the verdict the first test could not: nothing to say.
    assert_eq!(
        answer.body["verdict"],
        "HEALTHY",
        "{:?}",
        reasons(&answer.body)
    );
    assert_eq!(reasons(&answer.body), Vec::<String>::new());
    assert_eq!(answer.body["hourly"].as_array().map(Vec::len), Some(24));
}
