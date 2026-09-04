//! What "late" means, and the fact that it never means anything by default.
//!
//! The test that carries this file is the first one: an operator who has not
//! decided yet gets an empty schedule and a flag saying no version is in force.
//! Not a thirty-minute grace, not an error a screen has to special-case — the
//! honest answer that nobody has said, which is the state the implementation
//! this replaces could not represent.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-attendance-1";
const CASHIER_PASSWORD: &str = "cashier-password-attendance-1";

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
        node_id: "cloud-attendance-test".into(),
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
        assistant_api_key: None,
        assistant_base_url: "https://openrouter.ai/api/v1".into(),
        assistant_model: "anthropic/claude-opus-5".into(),
    }
}

async fn sign_in(app: &axum::Router, username: &str, password: &str) -> (String, String) {
    let response = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        vec![],
        Some(json!({ "username": username, "password": password })),
    )
    .await;
    assert_eq!(
        response.status,
        StatusCode::OK,
        "sign in as {username}: {:?}",
        response.body
    );
    browser(&response.set_cookies)
}

fn write_headers(cookies: &str, csrf: &str) -> Vec<(String, String)> {
    vec![
        (header::COOKIE.to_string(), cookies.to_owned()),
        ("x-csrf-token".to_string(), csrf.to_owned()),
    ]
}

fn read_headers(cookies: &str) -> Vec<(String, String)> {
    vec![(header::COOKIE.to_string(), cookies.to_owned())]
}

fn version(effective_from: &str, late_grace: u32, reason: &str) -> Value {
    json!({
        "effective_from": effective_from,
        "late_grace_minutes": late_grace,
        "early_leave_grace_minutes": 10,
        "overtime_minimum_minutes": 30,
        "duplicate_punch_window_minutes": 2,
        "reason": reason,
    })
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_operator_who_has_not_decided_has_no_policy_rather_than_a_default(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, _) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let empty = send(
        app.clone(),
        "GET",
        "/api/v1/attendance-policy",
        read_headers(&cookies),
        None,
    )
    .await;
    // Not a 404, and not an invented grace period.
    assert_eq!(empty.status, StatusCode::OK, "empty: {:?}", empty.body);
    assert_eq!(empty.body["versions"].as_array().map(Vec::len), Some(0));
    assert_eq!(
        empty.body["uncovered"], true,
        "an unwritten policy claimed to cover today: {:?}",
        empty.body
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_new_version_supersedes_the_one_before_it(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let first = send(
        app.clone(),
        "POST",
        "/api/v1/attendance-policy",
        write_headers(&cookies, &csrf),
        Some(version("2020-01-01", 15, "kebijakan awal")),
    )
    .await;
    assert_eq!(first.status, StatusCode::OK, "first: {:?}", first.body);
    assert_eq!(first.body["versions"][0]["late_grace_minutes"], 15);
    assert_eq!(first.body["versions"][0]["in_force"], true);
    assert_eq!(first.body["uncovered"], false);

    let second = send(
        app.clone(),
        "POST",
        "/api/v1/attendance-policy",
        write_headers(&cookies, &csrf),
        Some(version("2020-07-01", 10, "toleransi diperketat")),
    )
    .await;
    assert_eq!(second.status, StatusCode::OK, "second: {:?}", second.body);

    let versions = second.body["versions"]
        .as_array()
        .unwrap_or_else(|| panic!("versions: {:?}", second.body));
    assert_eq!(versions.len(), 2);
    // The first was closed the day before the second starts, rather than left
    // open to overlap it. Two open versions would not load back at all.
    assert_eq!(versions[0]["effective_to"], "2020-06-30");
    assert_eq!(versions[0]["in_force"], false);
    assert_eq!(versions[1]["effective_to"], Value::Null);
    assert_eq!(versions[1]["in_force"], true);
    assert_eq!(versions[1]["version"], 2);

    // And the history is still readable as of a past date: last year's
    // timesheet folds under last year's rules.
    let historic = send(
        app.clone(),
        "GET",
        "/api/v1/attendance-policy?as_of=2020-03-01",
        read_headers(&cookies),
        None,
    )
    .await;
    assert_eq!(historic.status, StatusCode::OK);
    assert_eq!(historic.body["versions"][0]["in_force"], true);
    assert_eq!(historic.body["versions"][1]["in_force"], false);
}

/// A version cannot be slipped in behind the current one.
///
/// Accepting it would write a schedule that refuses to load — the rules would
/// be unreadable until somebody edited SQL — so it is refused at the door with
/// a sentence saying why.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_version_cannot_be_backdated_behind_the_open_one(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    send(
        app.clone(),
        "POST",
        "/api/v1/attendance-policy",
        write_headers(&cookies, &csrf),
        Some(version("2020-06-01", 15, "kebijakan awal")),
    )
    .await;

    let backdated = send(
        app.clone(),
        "POST",
        "/api/v1/attendance-policy",
        write_headers(&cookies, &csrf),
        Some(version(
            "2020-01-01",
            45,
            "diam-diam melonggarkan bulan lalu",
        )),
    )
    .await;
    assert_eq!(
        backdated.status,
        StatusCode::CONFLICT,
        "a backdated version was accepted: {:?}",
        backdated.body
    );
}

/// A tolerance that covers a whole shift is not a policy choice.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_grace_that_would_disable_lateness_is_refused(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let absurd = send(
        app.clone(),
        "POST",
        "/api/v1/attendance-policy",
        write_headers(&cookies, &csrf),
        Some(version("2020-01-01", 481, "sembilan jam toleransi")),
    )
    .await;
    assert_eq!(
        absurd.status,
        StatusCode::BAD_REQUEST,
        "an eight-hour-plus grace was accepted: {:?}",
        absurd.body
    );
}

/// Everybody may read the rule they are measured against; only head office
/// writes it.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_rule_is_readable_by_the_people_it_governs(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (admin_cookies, admin_csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    send(
        app.clone(),
        "POST",
        "/api/v1/attendance-policy",
        write_headers(&admin_cookies, &admin_csrf),
        Some(version("2020-01-01", 15, "kebijakan awal")),
    )
    .await;

    send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        write_headers(&admin_cookies, &admin_csrf),
        Some(json!({
            "username": "siti",
            "display_name": "Siti Rahayu",
            "password": CASHIER_PASSWORD,
            "role": "CASHIER",
        })),
    )
    .await;
    let (her_cookies, her_csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;

    let read = send(
        app.clone(),
        "GET",
        "/api/v1/attendance-policy",
        read_headers(&her_cookies),
        None,
    )
    .await;
    assert_eq!(
        read.status,
        StatusCode::OK,
        "a cashier could not read the tolerance she is judged by: {:?}",
        read.body
    );
    assert_eq!(read.body["versions"][0]["late_grace_minutes"], 15);

    let write = send(
        app.clone(),
        "POST",
        "/api/v1/attendance-policy",
        write_headers(&her_cookies, &her_csrf),
        Some(version(
            "2021-01-01",
            120,
            "dua jam toleransi untuk saya sendiri",
        )),
    )
    .await;
    assert_eq!(
        write.status,
        StatusCode::FORBIDDEN,
        "a cashier rewrote the lateness rule: {:?}",
        write.body
    );
}
