//! Pay, and the run that pays it.
//!
//! Two tests carry this file. **The person who verified a run may not approve
//! it** — a control one person can complete alone is a record of a signature
//! rather than a control, and this is the rule added to the donor rather than
//! ported from it. And **a run says it is incomplete and why**: there is no
//! punch source, so nothing here knows what was worked, and a run that
//! presented what it does know as a finished payroll would be a run somebody
//! paid from.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-payroll-1";
const CASHIER_PASSWORD: &str = "cashier-password-payroll-1";

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
        node_id: "cloud-payroll-test".into(),
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

const SUPERVISOR_PASSWORD: &str = "supervisor-password-payroll-1";

/// Register somebody, hire them, and post them to a place.
async fn staff_at(
    app: &axum::Router,
    cookies: &str,
    csrf: &str,
    code: &str,
    place_id: &str,
) -> String {
    let registered = send(
        app.clone(),
        "POST",
        "/api/v1/employees",
        write_headers(cookies, csrf),
        Some(json!({ "employee_code": code })),
    )
    .await;
    assert_eq!(registered.status, StatusCode::OK, "register: {:?}", registered.body);
    let employee_id = registered.body["employee_id"]
        .as_str()
        .unwrap_or_else(|| panic!("employee_id: {:?}", registered.body))
        .to_owned();

    let hired = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/employment"),
        write_headers(cookies, csrf),
        Some(json!({
            "transition": "HIRE",
            "effective_on": "2026-01-05",
            "reason": "mulai bekerja",
        })),
    )
    .await;
    assert_eq!(hired.status, StatusCode::OK, "hire: {:?}", hired.body);

    let assigned = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/assignments"),
        write_headers(cookies, csrf),
        Some(json!({
            "place_id": place_id,
            "valid_from": "2026-01-05",
            "reason": "penempatan awal",
        })),
    )
    .await;
    assert_eq!(assigned.status, StatusCode::OK, "assign: {:?}", assigned.body);
    employee_id
}

/// Give somebody a login at a rung and bind it to their record.
async fn login_for(
    app: &axum::Router,
    cookies: &str,
    csrf: &str,
    employee_id: &str,
    username: &str,
    role: &str,
    password: &str,
) {
    let created = send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        write_headers(cookies, csrf),
        Some(json!({
            "username": username,
            "display_name": username,
            "password": password,
            "role": role,
        })),
    )
    .await;
    assert_eq!(created.status, StatusCode::OK, "create user: {:?}", created.body);
    let linked = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/account"),
        write_headers(cookies, csrf),
        Some(json!({ "username": username, "reason": "akun untuk staf" })),
    )
    .await;
    assert_eq!(linked.status, StatusCode::OK, "link: {:?}", linked.body);
}

/// The 2026 calendar, with one national day and two cuti bersama.
async fn publish_2026(app: &axum::Router, cookies: &str, csrf: &str) {
    let published = send(
        app.clone(),
        "POST",
        "/api/v1/holiday-calendars",
        write_headers(cookies, csrf),
        Some(json!({
            "year": 2026,
            "holidays": [
                { "date": "2026-03-20", "name": "Idul Fitri", "kind": "NATIONAL" },
                { "date": "2026-04-07", "name": "Cuti Bersama", "kind": "CUTI_BERSAMA" },
                { "date": "2026-05-01", "name": "Hari Buruh", "kind": "NATIONAL" },
            ],
            "reason": "SKB tiga menteri 2026",
        })),
    )
    .await;
    assert_eq!(published.status, StatusCode::OK, "publish: {:?}", published.body);
}

/// Annual leave, sick leave, and the policy a balance folds under.
async fn ratify_leave(app: &axum::Router, cookies: &str, csrf: &str) {
    for body in [
        json!({
            "code": "CUTI_TAHUNAN",
            "name": "Cuti Tahunan",
            "backing": "BALANCE",
            "payment": "FULL",
        }),
        json!({
            "code": "CUTI_SAKIT",
            "name": "Cuti Sakit",
            "backing": "AS_CERTIFIED",
            "payment": "STATUTORY_SCALE",
            "requires_evidence": true,
        }),
    ] {
        let defined = send(
            app.clone(),
            "POST",
            "/api/v1/leave-types",
            write_headers(cookies, csrf),
            Some(body),
        )
        .await;
        assert_eq!(defined.status, StatusCode::OK, "define: {:?}", defined.body);
    }

    let ratified = send(
        app.clone(),
        "POST",
        "/api/v1/leave-policy",
        write_headers(cookies, csrf),
        Some(json!({
            "version": 1,
            "effective_from": "2026-01-01",
            "annual_days": 12,
            "accrual": "UP_FRONT",
            "carry_forward_days": 6,
            "carry_forward_expires_on": "03-31",
            "protected_leave": "CONTINUES",
        })),
    )
    .await;
    assert_eq!(ratified.status, StatusCode::OK, "policy: {:?}", ratified.body);
}

/// Put this year's entitlement into somebody's balance.
async fn allocate(
    app: &axum::Router,
    cookies: &str,
    csrf: &str,
    employee_id: &str,
    days: i32,
) -> Value {
    let moved = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/leave-balances"),
        write_headers(cookies, csrf),
        Some(json!({
            "entry_id": format!("alloc-2026-{employee_id}"),
            "leave_type": "CUTI_TAHUNAN",
            "on": "2026-01-01",
            "event": "ALLOCATION",
            "days": days,
        })),
    )
    .await;
    assert_eq!(moved.status, StatusCode::OK, "allocate: {:?}", moved.body);
    moved.body
}

/// Agree somebody's pay, from the first of the year.
async fn agree_pay(
    app: &axum::Router,
    cookies: &str,
    csrf: &str,
    employee_id: &str,
    base: i64,
) -> Response {
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/pay"),
        write_headers(cookies, csrf),
        Some(json!({
            "effective_from": "2026-01-01",
            "base_minor": base,
            "fixed_allowances": [{ "code": "JABATAN", "minor": 500_000 }],
            "reason": "kesepakatan kerja",
        })),
    )
    .await
}

/// Record where the money goes.
async fn set_account(
    app: &axum::Router,
    cookies: &str,
    csrf: &str,
    employee_id: &str,
    number: &str,
) -> Response {
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/payroll-identity"),
        write_headers(cookies, csrf),
        Some(json!({
            "field": "bank_account",
            "bank_name": "BCA",
            "bank_account": number,
            "bank_holder": "Siti Rahayu",
            "effective_from": "2026-01-01",
            "reason": "rekening gaji",
        })),
    )
    .await
}

/// Sign April off, so a run can be built over it.
async fn close_april(app: &axum::Router, cookies: &str, csrf: &str) {
    let closed = send(
        app.clone(),
        "POST",
        "/api/v1/attendance-periods/store-07/2026-04/closure",
        write_headers(cookies, csrf),
        Some(json!({ "reason": "absensi April sudah dicek" })),
    )
    .await;
    assert_eq!(closed.status, StatusCode::OK, "close: {:?}", closed.body);
}

async fn open_run(app: &axum::Router, cookies: &str, csrf: &str) -> Response {
    send(
        app.clone(),
        "POST",
        "/api/v1/payroll/runs",
        write_headers(cookies, csrf),
        Some(json!({
            "place_id": "store-07",
            "period": "2026-04",
            "reason": "penggajian April",
        })),
    )
    .await
}

/// A second head-office login, because one person cannot sign twice.
async fn second_officer(app: &axum::Router, cookies: &str, csrf: &str) -> (String, String) {
    let created = send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        write_headers(cookies, csrf),
        Some(json!({
            "username": "hr.budi",
            "display_name": "Budi",
            "password": ADMIN_PASSWORD,
            "role": "ADMIN",
        })),
    )
    .await;
    assert_eq!(created.status, StatusCode::OK, "{:?}", created.body);
    sign_in(app, "hr.budi", ADMIN_PASSWORD).await
}

/// A raise must not change what an earlier month was paid from.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn pay_is_a_history_and_cannot_be_backdated(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let siti = staff_at(&app, &cookies, &csrf, "K0701", "store-07").await;
    let first = agree_pay(&app, &cookies, &csrf, &siti, 5_000_000).await;
    assert_eq!(first.status, StatusCode::OK, "agree: {:?}", first.body);
    assert_eq!(first.body[0]["base_minor"], 5_000_000);
    // Base plus the fixed allowance — the figure statutory rules are computed
    // against, and nothing here applies one.
    assert_eq!(first.body[0]["statutory_base_minor"], 5_500_000);

    let raise = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/pay"),
        write_headers(&cookies, &csrf),
        Some(json!({
            "effective_from": "2026-04-01",
            "base_minor": 6_000_000,
            "reason": "kenaikan tahunan",
        })),
    )
    .await;
    assert_eq!(raise.status, StatusCode::OK, "raise: {:?}", raise.body);
    // Both records survive. January's figure is still January's.
    assert_eq!(raise.body.as_array().map(Vec::len), Some(2));
    assert_eq!(raise.body[0]["base_minor"], 5_000_000);
    assert_eq!(raise.body[1]["base_minor"], 6_000_000);

    // Backdating would change what an already-closed month was owed.
    let backdated = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/pay"),
        write_headers(&cookies, &csrf),
        Some(json!({
            "effective_from": "2026-02-01",
            "base_minor": 5_500_000,
            "reason": "lupa",
        })),
    )
    .await;
    assert_eq!(backdated.status, StatusCode::CONFLICT, "{:?}", backdated.body);

    // And a shop manager may not read salaries at all: what everybody earns is
    // not a rota question.
    let rina = staff_at(&app, &cookies, &csrf, "K0700", "store-07").await;
    login_for(&app, &cookies, &csrf, &rina, "rina", "SUPERVISOR", SUPERVISOR_PASSWORD).await;
    let (hers, _) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;
    let refused = send(
        app.clone(),
        "GET",
        &format!("/api/v1/employees/{siti}/pay"),
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN, "{:?}", refused.body);
}

/// Somebody checking their own account confirms four digits; nobody else needs
/// the rest, and no route serves the whole number.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_account_number_never_leaves_the_server_whole(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let siti = staff_at(&app, &cookies, &csrf, "K0701", "store-07").await;
    let set = set_account(&app, &cookies, &csrf, &siti, "1234567890").await;
    assert_eq!(set.status, StatusCode::OK, "identity: {:?}", set.body);
    assert_eq!(set.body["bank_account_masked"], "••••••7890");
    assert_eq!(set.body["bank_holder"], "Siti Rahayu");
    assert_eq!(set.body["payable"], true);
    // The whole number is nowhere in the answer.
    assert!(
        !set.body.to_string().contains("1234567890"),
        "the number leaked: {:?}",
        set.body
    );

    // Each amendment names the one field it changed.
    let ptkp = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/payroll-identity"),
        write_headers(&cookies, &csrf),
        Some(json!({
            "field": "ptkp",
            "value": "K/2",
            "effective_from": "2026-01-01",
            "reason": "menikah, dua tanggungan",
        })),
    )
    .await;
    assert_eq!(ptkp.status, StatusCode::OK, "{:?}", ptkp.body);
    assert_eq!(ptkp.body["ptkp"], "K/2");
    assert_eq!(ptkp.body["amendments"].as_array().map(Vec::len), Some(2));
    assert_eq!(ptkp.body["amendments"][1]["field"], "ptkp");

    // Three dependants is the statutory ceiling.
    let too_many = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/payroll-identity"),
        write_headers(&cookies, &csrf),
        Some(json!({
            "field": "ptkp",
            "value": "K/4",
            "effective_from": "2026-01-01",
            "reason": "empat anak",
        })),
    )
    .await;
    assert_eq!(too_many.status, StatusCode::BAD_REQUEST, "{:?}", too_many.body);
}

/// The test this file exists for.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn one_person_cannot_verify_and_approve_the_same_run(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let siti = staff_at(&app, &cookies, &csrf, "K0701", "store-07").await;
    agree_pay(&app, &cookies, &csrf, &siti, 5_000_000).await;
    set_account(&app, &cookies, &csrf, &siti, "1234567890").await;
    close_april(&app, &cookies, &csrf).await;

    let opened = open_run(&app, &cookies, &csrf).await;
    assert_eq!(opened.status, StatusCode::OK, "open: {:?}", opened.body);
    assert_eq!(opened.body["state"], "DRAFT");
    // The claim the whole design turns on: this is not a finished payroll, and
    // it says so rather than looking settled.
    assert_eq!(opened.body["complete"], false);
    assert!(opened.body["incomplete_because"]
        .as_str()
        .is_some_and(|reason| reason.contains("punch source")));
    let run_id = opened.body["id"]
        .as_str()
        .unwrap_or_else(|| panic!("run id"))
        .to_owned();

    let verified = send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/runs/{run_id}/verify"),
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "angka sudah dicek" })),
    )
    .await;
    assert_eq!(verified.status, StatusCode::OK, "verify: {:?}", verified.body);
    assert_eq!(verified.body["state"], "VERIFIED");
    assert_eq!(verified.body["verified_by"], "admin");

    // The same officer may not approve it.
    let refused = send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/runs/{run_id}/approve"),
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "saya setujui sendiri" })),
    )
    .await;
    assert_eq!(refused.status, StatusCode::CONFLICT, "{:?}", refused.body);

    // A second officer may.
    let (theirs, their_csrf) = second_officer(&app, &cookies, &csrf).await;
    let approved = send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/runs/{run_id}/approve"),
        write_headers(&theirs, &their_csrf),
        Some(json!({ "reason": "disetujui" })),
    )
    .await;
    assert_eq!(approved.status, StatusCode::OK, "approve: {:?}", approved.body);
    assert_eq!(approved.body["state"], "APPROVED");

    let sealed = send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/runs/{run_id}/seal"),
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "dikunci" })),
    )
    .await;
    assert_eq!(sealed.status, StatusCode::OK, "seal: {:?}", sealed.body);
    assert_eq!(sealed.body["state"], "SEALED");

    // Sealing is the point past which the figures are the figures.
    let reopened = send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/runs/{run_id}/reopen"),
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "ada koreksi" })),
    )
    .await;
    assert_eq!(reopened.status, StatusCode::CONFLICT, "{:?}", reopened.body);
}

/// The attendance period is the payroll gate: while it is open the facts are
/// still moving, and a run built over moving facts disagrees with itself an
/// hour later.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_run_cannot_be_opened_over_a_month_that_is_still_open(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let siti = staff_at(&app, &cookies, &csrf, "K0701", "store-07").await;
    agree_pay(&app, &cookies, &csrf, &siti, 5_000_000).await;

    let refused = open_run(&app, &cookies, &csrf).await;
    assert_eq!(refused.status, StatusCode::CONFLICT, "{:?}", refused.body);

    close_april(&app, &cookies, &csrf).await;
    let opened = open_run(&app, &cookies, &csrf).await;
    assert_eq!(opened.status, StatusCode::OK, "{:?}", opened.body);

    // One run per place per month. A second is a correction, and a correction
    // is a new period's business.
    let again = open_run(&app, &cookies, &csrf).await;
    assert_eq!(again.status, StatusCode::CONFLICT, "{:?}", again.body);
}

/// A slip carries the agreement and the facts, and nothing statutory. What
/// stands in the run's way is counted rather than assumed away.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_slip_carries_the_agreement_and_the_facts_and_no_deductions(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    publish_2026(&app, &cookies, &csrf).await;
    ratify_leave(&app, &cookies, &csrf).await;

    let siti = staff_at(&app, &cookies, &csrf, "K0701", "store-07").await;
    login_for(&app, &cookies, &csrf, &siti, "siti", "CASHIER", CASHIER_PASSWORD).await;
    agree_pay(&app, &cookies, &csrf, &siti, 5_000_000).await;
    set_account(&app, &cookies, &csrf, &siti, "1234567890").await;
    allocate(&app, &cookies, &csrf, &siti, 12).await;

    // Somebody with no pay agreement at all: they get no slip, because a
    // zero-pay line reads as "owed nothing" and that is a claim.
    let budi = staff_at(&app, &cookies, &csrf, "K0702", "store-07").await;
    let _ = budi;

    // Two days of approved leave in April.
    let (hers, her_csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;
    send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/leave-requests",
        write_headers(&hers, &her_csrf),
        Some(json!({
            "request_id": "LV-P1",
            "leave_type": "CUTI_TAHUNAN",
            "from_date": "2026-04-13",
            "to_date": "2026-04-14",
            "reason": "urusan keluarga",
        })),
    )
    .await;
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/leave-requests/LV-P1/approve"),
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "toko cukup orang" })),
    )
    .await;

    close_april(&app, &cookies, &csrf).await;
    let opened = open_run(&app, &cookies, &csrf).await;
    assert_eq!(opened.status, StatusCode::OK, "{:?}", opened.body);
    let run_id = opened.body["id"].as_str().unwrap_or_default().to_owned();

    let slips = send(
        app.clone(),
        "GET",
        &format!("/api/v1/payroll/runs/{run_id}/slips"),
        read_headers(&cookies),
        None,
    )
    .await;
    assert_eq!(slips.status, StatusCode::OK, "slips: {:?}", slips.body);
    // One slip: Siti has an agreement, Budi does not.
    assert_eq!(slips.body.as_array().map(Vec::len), Some(1));
    let slip = &slips.body[0];
    assert_eq!(slip["employee_code"], "K0701");
    assert_eq!(slip["base_minor"], 5_000_000);
    assert_eq!(slip["statutory_base_minor"], 5_500_000);
    assert_eq!(slip["leave_days_taken"], 2);
    assert_eq!(slip["payable"], true);
    assert_eq!(slip["bank_account_masked"], "••••••7890");
    // No deduction anywhere. There is no field for one, which is the point.
    assert!(
        slip.get("deductions_minor").is_none() && slip.get("net_minor").is_none(),
        "a computed deduction appeared: {slip:?}"
    );

    let reconciliation = send(
        app.clone(),
        "GET",
        &format!("/api/v1/payroll/runs/{run_id}/reconciliation"),
        read_headers(&cookies),
        None,
    )
    .await;
    assert_eq!(reconciliation.status, StatusCode::OK, "{:?}", reconciliation.body);
    assert_eq!(reconciliation.body["slips"], 1);
    assert_eq!(reconciliation.body["base_total_minor"], 5_000_000);
    assert_eq!(reconciliation.body["leave_days_total"], 2);
    assert_eq!(reconciliation.body["unpayable"], 0);
    // Budi is counted rather than silently absent.
    assert_eq!(reconciliation.body["without_agreement"], 1);
}

/// A draft is a working figure. Showing it to the person it is about invites
/// them to plan around a number that is still moving.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_payslip_appears_only_once_somebody_has_signed_for_it(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let siti = staff_at(&app, &cookies, &csrf, "K0701", "store-07").await;
    login_for(&app, &cookies, &csrf, &siti, "siti", "CASHIER", CASHIER_PASSWORD).await;
    agree_pay(&app, &cookies, &csrf, &siti, 5_000_000).await;
    set_account(&app, &cookies, &csrf, &siti, "1234567890").await;
    close_april(&app, &cookies, &csrf).await;
    let opened = open_run(&app, &cookies, &csrf).await;
    let run_id = opened.body["id"].as_str().unwrap_or_default().to_owned();

    let (hers, _) = sign_in(&app, "siti", CASHIER_PASSWORD).await;
    let early = send(
        app.clone(),
        "GET",
        "/api/v1/employees/me/payslips",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(early.status, StatusCode::OK, "{:?}", early.body);
    assert_eq!(early.body.as_array().map(Vec::len), Some(0), "a draft is not a payslip");

    send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/runs/{run_id}/verify"),
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "dicek" })),
    )
    .await;
    let (theirs, their_csrf) = second_officer(&app, &cookies, &csrf).await;
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/runs/{run_id}/approve"),
        write_headers(&theirs, &their_csrf),
        Some(json!({ "reason": "disetujui" })),
    )
    .await;

    let now = send(
        app.clone(),
        "GET",
        "/api/v1/employees/me/payslips",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(now.body.as_array().map(Vec::len), Some(1), "{:?}", now.body);
    assert_eq!(now.body[0]["base_minor"], 5_000_000);
    // Her own slip shows her own account, masked like everywhere else.
    assert_eq!(now.body[0]["bank_account_masked"], "••••••7890");
}
