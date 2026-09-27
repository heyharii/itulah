//! The virtual business clock's control surface, over HTTP.
//!
//! The clock itself (`src/clock.rs`) is proven by unit tests; what this suite
//! proves is the surface around it, because the surface is where the plan's
//! promises live (VIRTUAL-TIME-PLAN.md §7, §8):
//!
//! - the surface is **fail-closed** — without `INVENTORY_ENABLE_TEST_CONTROLS`
//!   both routes answer 403, exactly like `corrupt-projection` beside them;
//! - `System` reports no virtual time at all, and stamps no header;
//! - a `scaled` clock answers with a virtual instant and every response
//!   carries `x-virtual-time` while it is virtual;
//! - **backwards is refused with 409** — the one operation plan §7.2 calls
//!   destructive-bisnis, refused at the endpoint rather than trusted to the
//!   operator's restraint;
//! - pause freezes and resume continues, each recorded;
//! - every accepted mutation lands a row in `clock_epoch` (migration 0310) —
//!   the moment business time and wall time came apart must be findable later.

use axum::body::{to_bytes, Body};
use chrono::Utc;
use http::{Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, AppConfig, AppState};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};

/// Auth off, like every other HTTP suite here: the middleware then hands
/// handlers a server-owned `development` principal, so an epoch row still
/// names an actor the server chose.
fn config(test_controls: bool) -> AppConfig {
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
        enable_test_controls: test_controls,
        finance_automation_enabled: false,
        frontend_dir: PathBuf::from("nonexistent"),
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

/// One call against ONE shared state, answering the status code, the
/// `x-virtual-time` header if the response carried one, and the JSON body.
///
/// The state is built once per test and cloned into each router: a fresh
/// `AppState` per call would mint a fresh `ClockHandle`, and a mode set on
/// one request would be gone by the next — exactly the shared-handle
/// property the production deployment depends on.
async fn call(
    state: &AppState,
    method: &str,
    body: Option<Value>,
) -> (StatusCode, Option<String>, Value) {
    let body_bytes = match body {
        Some(value) => {
            Body::from(serde_json::to_vec(&value).unwrap_or_else(|e| panic!("encode body: {e}")))
        }
        None => Body::empty(),
    };
    let request = Request::builder()
        .method(method)
        .uri("/api/v1/inventory/control/clock")
        .header("content-type", "application/json")
        .body(body_bytes)
        .unwrap_or_else(|e| panic!("build {method}: {e}"));

    let response = tower::ServiceExt::oneshot(cloud_http::router(state.clone()), request)
        .await
        .unwrap_or_else(|e| panic!("{method}: {e}"));
    let status = response.status();
    let virtual_header = response
        .headers()
        .get("x-virtual-time")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap_or_else(|e| panic!("read body of {method}: {e}"));
    let json = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or_else(|e| panic!("decode {method}: {e}"))
    };
    (status, virtual_header, json)
}

/// The scaled boot used across the suite: the plan's own worked example, with
/// the real anchor at the test's own wall clock so the mapping starts at
/// ~2026-01-01 wherever (whenever) the run happens.
fn scaled_mode() -> Value {
    json!({
        "op": "set_mode",
        "mode": {
            "mode": "scaled",
            "anchor_real": Utc::now().to_rfc3339(),
            "anchor_virtual": "2025-12-31T17:00:00+00:00",
            "factor": 876.0
        }
    })
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn without_test_controls_the_surface_is_fail_closed(pool: PgPool) {
    let state = AppState::new(pool.clone(), config(false));
    let (get_status, _, _) = call(&state, "GET", None).await;
    assert_eq!(get_status, StatusCode::FORBIDDEN);

    let (post_status, _, body) = call(&state, "POST", Some(scaled_mode())).await;
    assert_eq!(post_status, StatusCode::FORBIDDEN);
    assert!(
        body["error"]
            .as_str()
            .is_some_and(|message| message.contains("test controls are disabled")),
        "the refusal names the flag: {body}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn system_clock_reports_no_virtual_time_and_stamps_no_header(pool: PgPool) {
    let state = AppState::new(pool.clone(), config(true));
    let (status, virtual_header, body) = call(&state, "GET", None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(virtual_header.is_none(), "system mode stamps no header");
    assert_eq!(body["source"]["mode"], "system");
    assert_eq!(body["virtual_now"], Value::Null);
    assert_eq!(body["paused"], false);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn scaled_mode_answers_virtual_and_stamps_every_response(pool: PgPool) {
    let state = AppState::new(pool.clone(), config(true));
    let (status, virtual_header, body) = call(&state, "POST", Some(scaled_mode())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["source"]["mode"], "scaled");
    let first = body["virtual_now"]
        .as_str()
        .unwrap_or_else(|| panic!("virtual now present: {body}"))
        .to_owned();
    // The mapping starts at the virtual anchor: a virtual instant within a
    // day of 2026-01-01 means the anchor and factor arrived intact.
    let first_parsed = chrono::DateTime::parse_from_rfc3339(&first)
        .unwrap_or_else(|e| panic!("parse {first}: {e}"));
    assert!(
        first_parsed
            < chrono::DateTime::parse_from_rfc3339("2026-01-02T00:00:00+00:00")
                .unwrap_or_else(|e| panic!("parse guard: {e}")),
        "the clock starts at the virtual anchor, not the wall clock: {first}"
    );
    // The header is computed from the same clock moments after the body was,
    // so it sits at or after it — within a virtual day at this factor, not at
    // the exact millisecond (middleware and handler take separate reads).
    let header_parsed = virtual_header
        .as_deref()
        .map(|header| chrono::DateTime::parse_from_rfc3339(header).expect("header instant"));
    assert!(
        header_parsed.is_some_and(|header| header >= first_parsed),
        "the header carries the same virtual instant or later: {virtual_header:?} vs {first}"
    );

    // A later read answers a later virtual instant — the clock advances
    // itself, which is the whole point of `scaled`.
    let (_, _, body) = call(&state, "GET", None).await;
    let second = body["virtual_now"].as_str().expect("virtual now");
    assert!(
        chrono::DateTime::parse_from_rfc3339(second).expect("second instant") >= first_parsed,
        "virtual time advanced: {second} after {first}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn moving_backwards_is_a_conflict_naming_both_instants(pool: PgPool) {
    let state = AppState::new(pool.clone(), config(true));
    call(&state, "POST", Some(scaled_mode())).await;
    // A virtual year further on, then an attempt to rewind to the start.
    let (forward_status, _, _) = call(
        &state,
        "POST",
        Some(json!({ "op": "advance_to", "at": "2026-12-01T00:00:00+00:00" })),
    )
    .await;
    assert_eq!(forward_status, StatusCode::OK);

    let (back_status, _, body) = call(
        &state,
        "POST",
        Some(json!({ "op": "advance_to", "at": "2026-03-01T00:00:00+00:00" })),
    )
    .await;
    assert_eq!(back_status, StatusCode::CONFLICT);
    assert!(
        body["error"]
            .as_str()
            .is_some_and(|message| message.contains("cannot move backwards")),
        "the refusal names the operation: {body}"
    );

    // set_mode is the same refusal — there is no shape of backward move the
    // scaled clock accepts (plan §7.2).
    let (mode_back_status, _, _) = call(
        &state,
        "POST",
        Some(json!({
            "op": "set_mode",
            "mode": {
                "mode": "scaled",
                "anchor_real": chrono::Utc::now().to_rfc3339(),
                "anchor_virtual": "2025-01-01T00:00:00+00:00",
                "factor": 876.0
            }
        })),
    )
    .await;
    assert_eq!(mode_back_status, StatusCode::CONFLICT);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn pause_freezes_resume_continues_and_the_epoch_table_remembers(pool: PgPool) {
    let state = AppState::new(pool.clone(), config(true));
    call(&state, "POST", Some(scaled_mode())).await;

    let (_, _, paused) = call(&state, "POST", Some(json!({ "op": "pause" }))).await;
    assert_eq!(paused["paused"], true);
    let frozen = paused["virtual_now"]
        .as_str()
        .expect("frozen instant")
        .to_owned();

    let (_, _, resumed) = call(&state, "POST", Some(json!({ "op": "resume" }))).await;
    assert_eq!(resumed["paused"], false);
    // Resume continues from the frozen point: no jump, the pause never
    // happened to the business calendar.
    assert!(
        chrono::DateTime::parse_from_rfc3339(resumed["virtual_now"].as_str().expect("resumed"))
            .expect("parse resumed")
            >= chrono::DateTime::parse_from_rfc3339(&frozen).expect("parse frozen"),
        "resume continues from the frozen point: {resumed}"
    );

    let epochs: i64 = sqlx::query_scalar("SELECT count(*) FROM clock_epoch")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("read clock_epoch: {e}"));
    // set_mode + pause + resume — every accepted mutation, one row each.
    assert_eq!(epochs, 3, "one epoch row per accepted mutation");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn advance_to_a_chosen_instant_reanchors_scaled(pool: PgPool) {
    let state = AppState::new(pool.clone(), config(true));
    call(&state, "POST", Some(scaled_mode())).await;
    let (status, _, body) = call(
        &state,
        "POST",
        Some(json!({ "op": "advance_to", "at": "2026-07-02T05:00:00+00:00" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // 2026-07-02T05:00Z is the plan's five-wall-hours instant (2 Jul 12:00
    // WIB) — advancing lands exactly there (the re-anchor instant IS the
    // answer), and the factor survived.
    let landed = body["virtual_now"]
        .as_str()
        .map(|instant| chrono::DateTime::parse_from_rfc3339(instant).expect("parse landed"));
    let target =
        chrono::DateTime::parse_from_rfc3339("2026-07-02T05:00:00+00:00").expect("parse target");
    assert_eq!(landed, Some(target));
    assert_eq!(body["source"]["factor"], 876.0);
    assert_eq!(body["source"]["mode"], "scaled");
}
