//! Pay, and the run that pays it.
//!
//! Three tests carry this file. **The place submits and head office decides** —
//! the owner's decision of 2026-09-13, which moved the first signature out of
//! head office; **the submitter may not also approve** — a control one person
//! can complete alone is a record of a signature rather than a control, and
//! this rule survives the rework in the shape the work actually has; and **a
//! run says it is incomplete and why**, because there is no punch source and a
//! run that presented what it does know as a finished payroll would be a run
//! somebody paid from.
//!
//! A fourth covers the crossing to Finance: gross only, idempotent per
//! (place, period), and a status that comes back.

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
        po_import: inventory_backend::cloud::intake::po::PoImportConfig::from_env(),
        clock: None,
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
    assert_eq!(
        registered.status,
        StatusCode::OK,
        "register: {:?}",
        registered.body
    );
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
    assert_eq!(
        assigned.status,
        StatusCode::OK,
        "assign: {:?}",
        assigned.body
    );
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
    assert_eq!(
        created.status,
        StatusCode::OK,
        "create user: {:?}",
        created.body
    );
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
    assert_eq!(
        published.status,
        StatusCode::OK,
        "publish: {:?}",
        published.body
    );
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
    assert_eq!(
        ratified.status,
        StatusCode::OK,
        "policy: {:?}",
        ratified.body
    );
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
    close_april_at(app, cookies, csrf, "store-07").await;
}

async fn close_april_at(app: &axum::Router, cookies: &str, csrf: &str, place: &str) {
    let closed = send(
        app.clone(),
        "POST",
        &format!("/api/v1/attendance-periods/{place}/2026-04/closure"),
        write_headers(cookies, csrf),
        Some(json!({ "reason": "absensi April sudah dicek" })),
    )
    .await;
    assert_eq!(closed.status, StatusCode::OK, "close: {:?}", closed.body);
}

async fn open_run(app: &axum::Router, cookies: &str, csrf: &str) -> Response {
    open_run_at(app, cookies, csrf, "store-07").await
}

async fn open_run_at(app: &axum::Router, cookies: &str, csrf: &str, place: &str) -> Response {
    send(
        app.clone(),
        "POST",
        "/api/v1/payroll/runs",
        write_headers(cookies, csrf),
        Some(json!({
            "place_id": place,
            "period": "2026-04",
            "reason": "penggajian April",
        })),
    )
    .await
}

/// The place's signature on the batch.
async fn submit(app: &axum::Router, cookies: &str, csrf: &str, run_id: &str) -> Response {
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/runs/{run_id}/submission"),
        write_headers(cookies, csrf),
        Some(json!({ "reason": "angka sudah dicek di toko" })),
    )
    .await
}

async fn approve(app: &axum::Router, cookies: &str, csrf: &str, run_id: &str) -> Response {
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/runs/{run_id}/approve"),
        write_headers(cookies, csrf),
        Some(json!({ "reason": "disetujui" })),
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
    assert_eq!(
        backdated.status,
        StatusCode::CONFLICT,
        "{:?}",
        backdated.body
    );

    // The shop manager DOES read her own staff's salaries, since 2026-09-13.
    // The owner took that side twice: a store that submits its own payroll
    // batch has to be able to check it, and a batch checked blind is not
    // checked. What replaces the bound being given up is the reach.
    let rina = staff_at(&app, &cookies, &csrf, "K0700", "store-07").await;
    login_for(
        &app,
        &cookies,
        &csrf,
        &rina,
        "rina",
        "SUPERVISOR",
        SUPERVISOR_PASSWORD,
    )
    .await;
    let (hers, her_csrf) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;
    let hers_to_read = send(
        app.clone(),
        "GET",
        &format!("/api/v1/employees/{siti}/pay"),
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(
        hers_to_read.status,
        StatusCode::OK,
        "her own shop: {:?}",
        hers_to_read.body
    );
    assert_eq!(hers_to_read.body[0]["base_minor"], 5_000_000);

    // Another shop's is not hers. This is the bound doing the work the rung
    // cannot: every store manager holds SUPERVISOR.
    let elsewhere = staff_at(&app, &cookies, &csrf, "K0301", "store-03").await;
    agree_pay(&app, &cookies, &csrf, &elsewhere, 4_000_000).await;
    let refused = send(
        app.clone(),
        "GET",
        &format!("/api/v1/employees/{elsewhere}/pay"),
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(
        refused.status,
        StatusCode::FORBIDDEN,
        "another shop's pay: {:?}",
        refused.body
    );

    // Reading the figures is not reading where the money is sent. A bank
    // account and an NPWP live in their own table so that a read of one is not
    // a read of the other, and that stays head office's.
    let identity = send(
        app.clone(),
        "GET",
        &format!("/api/v1/employees/{siti}/payroll-identity"),
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(
        identity.status,
        StatusCode::FORBIDDEN,
        "payroll identity: {:?}",
        identity.body
    );

    // And she may not WRITE pay anywhere, her own shop included.
    let written = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/pay"),
        write_headers(&hers, &her_csrf),
        Some(json!({
            "effective_from": "2026-07-01",
            "base_minor": 9_000_000,
            "reason": "naik sendiri",
        })),
    )
    .await;
    assert_eq!(written.status, StatusCode::FORBIDDEN, "{:?}", written.body);
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
    assert_eq!(
        too_many.status,
        StatusCode::BAD_REQUEST,
        "{:?}",
        too_many.body
    );
}

/// The test this file exists for: the place submits, head office decides, and
/// the two signatures cannot be one person's.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_place_submits_and_head_office_approves(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let siti = staff_at(&app, &cookies, &csrf, "K0701", "store-07").await;
    agree_pay(&app, &cookies, &csrf, &siti, 5_000_000).await;
    set_account(&app, &cookies, &csrf, &siti, "1234567890").await;

    // The shop's own manager, posted to store-07.
    let rina = staff_at(&app, &cookies, &csrf, "K0700", "store-07").await;
    login_for(
        &app,
        &cookies,
        &csrf,
        &rina,
        "rina",
        "SUPERVISOR",
        SUPERVISOR_PASSWORD,
    )
    .await;
    let (hers, her_csrf) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;

    // The place closes its own month, and then opens its own run. Both are
    // hers now; opening used to be head office's.
    close_april(&app, &hers, &her_csrf).await;
    let opened = open_run_at(&app, &hers, &her_csrf, "store-07").await;
    assert_eq!(opened.status, StatusCode::OK, "open: {:?}", opened.body);
    assert_eq!(opened.body["state"], "DRAFT");
    // The claim the whole design turns on: this is not a finished payroll, and
    // it says so rather than looking settled.
    assert_eq!(opened.body["complete"], false);
    assert!(opened.body["incomplete_because"]
        .as_str()
        .is_some_and(|reason| reason.contains("punch source")));
    // Nothing has crossed to Finance, and the field says so rather than
    // carrying a hopeful zero.
    assert_eq!(opened.body["handover"], Value::Null);
    let run_id = opened.body["id"]
        .as_str()
        .unwrap_or_else(|| panic!("run id"))
        .to_owned();

    // She sees the figures she is submitting — the owner's decision, taken
    // twice. A signature on a batch somebody cannot see is not a signature.
    let slips = send(
        app.clone(),
        "GET",
        &format!("/api/v1/payroll/runs/{run_id}/slips"),
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(slips.status, StatusCode::OK, "her slips: {:?}", slips.body);
    assert_eq!(slips.body[0]["base_minor"], 5_000_000);

    let submitted = submit(&app, &hers, &her_csrf, &run_id).await;
    assert_eq!(
        submitted.status,
        StatusCode::OK,
        "submit: {:?}",
        submitted.body
    );
    assert_eq!(submitted.body["state"], "SUBMITTED");
    assert_eq!(submitted.body["submitted_by"], "rina");
    assert_eq!(submitted.body["approved_by"], Value::Null);

    // She cannot approve her own submission — and not because of the rung
    // this time: she does not hold the key at all.
    let refused = approve(&app, &hers, &her_csrf, &run_id).await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN, "{:?}", refused.body);

    // Head office may.
    let approved = approve(&app, &cookies, &csrf, &run_id).await;
    assert_eq!(
        approved.status,
        StatusCode::OK,
        "approve: {:?}",
        approved.body
    );
    assert_eq!(approved.body["state"], "APPROVED");
    assert_eq!(approved.body["approved_by"], "admin");

    // Approved is final: there is no seal, and the route that used to add one
    // is gone rather than aliased.
    let sealed = send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/runs/{run_id}/seal"),
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "dikunci" })),
    )
    .await;
    // 405 rather than 404 because the estate's fallback serves the console on
    // GET, so an unrouted POST is a method that does not exist at that path.
    // Either way the point holds: nothing answers here.
    assert_eq!(
        sealed.status,
        StatusCode::METHOD_NOT_ALLOWED,
        "{:?}",
        sealed.body
    );
    // And so is the route the first signature used to be made at. It is gone
    // rather than aliased to `/submission`: a caller still posting to
    // `/verify` is a caller whose screen has not been updated, and should hear
    // so rather than have its request quietly re-interpreted.
    let verified = send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/runs/{run_id}/verify"),
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "dicek" })),
    )
    .await;
    assert_eq!(
        verified.status,
        StatusCode::METHOD_NOT_ALLOWED,
        "{:?}",
        verified.body
    );

    // Head office may reopen an approved run, and the reopen clears both
    // signatures — so the next approval is a fresh pair.
    let reopened = send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/runs/{run_id}/reopen"),
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "ada koreksi" })),
    )
    .await;
    assert_eq!(
        reopened.status,
        StatusCode::OK,
        "reopen: {:?}",
        reopened.body
    );
    assert_eq!(reopened.body["state"], "DRAFT");
    assert_eq!(reopened.body["submitted_by"], Value::Null);
    assert_eq!(reopened.body["approved_by"], Value::Null);
    // Nothing is lost: the history still says what happened, in order.
    let steps: Vec<&str> = reopened.body["history"]
        .as_array()
        .unwrap_or_else(|| panic!("history"))
        .iter()
        .filter_map(|event| event["step"].as_str())
        .collect();
    assert_eq!(steps, vec!["SUBMITTED", "APPROVED", "REOPENED"]);

    // The place manager may not reopen, which is the half of this that keeps
    // the sign-off meaning something.
    submit(&app, &hers, &her_csrf, &run_id).await;
    let hers_to_reopen = send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/runs/{run_id}/reopen"),
        write_headers(&hers, &her_csrf),
        Some(json!({ "reason": "saya buka lagi" })),
    )
    .await;
    assert_eq!(
        hers_to_reopen.status,
        StatusCode::FORBIDDEN,
        "{:?}",
        hers_to_reopen.body
    );
}

/// One person cannot hold both signatures, even holding both keys. The rung
/// split makes this hard to reach in practice and the rule is enforced on the
/// actor anyway — because a rung cannot say it, and because a future grant
/// might put both keys in one pair of hands.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn one_person_cannot_submit_and_approve_the_same_run(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let siti = staff_at(&app, &cookies, &csrf, "K0701", "store-07").await;
    agree_pay(&app, &cookies, &csrf, &siti, 5_000_000).await;
    close_april(&app, &cookies, &csrf).await;

    // Head office holds every key, submit included — Admin outranks
    // Supervisor — so it can reach the state the two-person rule guards.
    let opened = open_run(&app, &cookies, &csrf).await;
    assert_eq!(opened.status, StatusCode::OK, "open: {:?}", opened.body);
    let run_id = opened.body["id"].as_str().unwrap_or_default().to_owned();

    let submitted = submit(&app, &cookies, &csrf, &run_id).await;
    assert_eq!(submitted.status, StatusCode::OK, "{:?}", submitted.body);
    assert_eq!(submitted.body["submitted_by"], "admin");

    let refused = approve(&app, &cookies, &csrf, &run_id).await;
    assert_eq!(
        refused.status,
        StatusCode::CONFLICT,
        "the payload is fine; who sent it is not: {:?}",
        refused.body
    );

    let (theirs, their_csrf) = second_officer(&app, &cookies, &csrf).await;
    let approved = approve(&app, &theirs, &their_csrf, &run_id).await;
    assert_eq!(
        approved.status,
        StatusCode::OK,
        "approve: {:?}",
        approved.body
    );
    assert_eq!(approved.body["state"], "APPROVED");
}

/// A store must not reach another store's payroll. Every store manager holds
/// the same rung, so this is the bound doing what a rung cannot.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_store_cannot_touch_another_stores_payroll(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let siti = staff_at(&app, &cookies, &csrf, "K0301", "store-03").await;
    agree_pay(&app, &cookies, &csrf, &siti, 4_000_000).await;
    close_april_at(&app, &cookies, &csrf, "store-03").await;
    let theirs = open_run_at(&app, &cookies, &csrf, "store-03").await;
    assert_eq!(theirs.status, StatusCode::OK, "{:?}", theirs.body);
    let their_run = theirs.body["id"].as_str().unwrap_or_default().to_owned();

    // store-07's manager.
    let rina = staff_at(&app, &cookies, &csrf, "K0700", "store-07").await;
    login_for(
        &app,
        &cookies,
        &csrf,
        &rina,
        "rina",
        "SUPERVISOR",
        SUPERVISOR_PASSWORD,
    )
    .await;
    let (hers, her_csrf) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;

    // She may not open one there.
    let opened = open_run_at(&app, &hers, &her_csrf, "store-03").await;
    assert_eq!(opened.status, StatusCode::FORBIDDEN, "{:?}", opened.body);
    // Nor submit theirs, read their slips, or read their reconciliation.
    assert_eq!(
        submit(&app, &hers, &her_csrf, &their_run).await.status,
        StatusCode::FORBIDDEN
    );
    for path in [
        format!("/api/v1/payroll/runs/{their_run}/slips"),
        format!("/api/v1/payroll/runs/{their_run}/reconciliation"),
    ] {
        let refused = send(app.clone(), "GET", &path, read_headers(&hers), None).await;
        assert_eq!(refused.status, StatusCode::FORBIDDEN, "{path}");
    }

    // And the list is bounded rather than filtered by what she asked for: she
    // has no run of her own, so she sees none — not store-03's.
    let listed = send(
        app.clone(),
        "GET",
        "/api/v1/payroll/runs",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(listed.status, StatusCode::OK, "{:?}", listed.body);
    assert_eq!(
        listed.body.as_array().map(Vec::len),
        Some(0),
        "an unfiltered list must not be the whole company: {:?}",
        listed.body
    );

    // Head office sees it.
    let all = send(
        app.clone(),
        "GET",
        "/api/v1/payroll/runs",
        read_headers(&cookies),
        None,
    )
    .await;
    assert_eq!(all.body.as_array().map(Vec::len), Some(1), "{:?}", all.body);
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
async fn a_slip_carries_the_agreement_and_the_facts_and_no_invented_deductions(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    publish_2026(&app, &cookies, &csrf).await;
    ratify_leave(&app, &cookies, &csrf).await;

    let siti = staff_at(&app, &cookies, &csrf, "K0701", "store-07").await;
    login_for(
        &app,
        &cookies,
        &csrf,
        &siti,
        "siti",
        "CASHIER",
        CASHIER_PASSWORD,
    )
    .await;
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
    // No deduction anywhere, and — since 0251 — that is said rather than
    // implied. The columns exist now; what does not exist is a nought in them.
    // A slip on a deployment where nobody has defined a payroll component
    // carries `null` and a sentence, because nought is what a system reports
    // after somebody has looked.
    assert_eq!(slip["gross_minor"], 5_500_000);
    assert_eq!(slip["deduction_total_minor"], Value::Null);
    assert_eq!(slip["net_minor"], Value::Null);
    assert!(
        slip["components_incomplete_because"]
            .as_str()
            .unwrap_or_default()
            .contains("no payroll deduction has been defined"),
        "the slip says what it could not work out: {slip:?}"
    );
    assert!(
        slip["earnings"].as_array().map(Vec::is_empty) == Some(true)
            && slip["deductions"].as_array().map(Vec::is_empty) == Some(true),
        "nothing was invented: {slip:?}"
    );

    let reconciliation = send(
        app.clone(),
        "GET",
        &format!("/api/v1/payroll/runs/{run_id}/reconciliation"),
        read_headers(&cookies),
        None,
    )
    .await;
    assert_eq!(
        reconciliation.status,
        StatusCode::OK,
        "{:?}",
        reconciliation.body
    );
    assert_eq!(reconciliation.body["slips"], 1);
    assert_eq!(reconciliation.body["base_total_minor"], 5_000_000);
    assert_eq!(reconciliation.body["leave_days_total"], 2);
    assert_eq!(reconciliation.body["unpayable"], 0);
    // Budi is counted rather than silently absent.
    assert_eq!(reconciliation.body["without_agreement"], 1);
    // And the run's own totals refuse the same way the slip does.
    assert_eq!(reconciliation.body["gross_total_minor"], 5_500_000);
    assert_eq!(reconciliation.body["deduction_total_minor"], Value::Null);
    assert_eq!(reconciliation.body["net_total_minor"], Value::Null);
    assert_eq!(reconciliation.body["slips_with_unworkable_components"], 1);
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
    login_for(
        &app,
        &cookies,
        &csrf,
        &siti,
        "siti",
        "CASHIER",
        CASHIER_PASSWORD,
    )
    .await;
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
    assert_eq!(
        early.body.as_array().map(Vec::len),
        Some(0),
        "a draft is not a payslip"
    );

    submit(&app, &cookies, &csrf, &run_id).await;
    // A submitted run is still not a payslip: it is a request nobody has
    // answered, and the number can still move.
    let submitted = send(
        app.clone(),
        "GET",
        "/api/v1/employees/me/payslips",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(
        submitted.body.as_array().map(Vec::len),
        Some(0),
        "a submitted run is not a payslip either: {:?}",
        submitted.body
    );

    let (theirs, their_csrf) = second_officer(&app, &cookies, &csrf).await;
    approve(&app, &theirs, &their_csrf, &run_id).await;

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

/// The crossing to Finance: gross only, idempotent per (place, period), and a
/// status that comes back.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_approved_run_crosses_to_finance_once_and_answers_back(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let siti = staff_at(&app, &cookies, &csrf, "K0701", "store-07").await;
    agree_pay(&app, &cookies, &csrf, &siti, 5_000_000).await;
    set_account(&app, &cookies, &csrf, &siti, "1234567890").await;
    let budi = staff_at(&app, &cookies, &csrf, "K0702", "store-07").await;
    agree_pay(&app, &cookies, &csrf, &budi, 4_000_000).await;
    // Approval refuses a run with somebody who has no account to be paid into,
    // so the handover test's second person needs one too.
    set_account(&app, &cookies, &csrf, &budi, "0987654321").await;
    close_april(&app, &cookies, &csrf).await;

    let opened = open_run(&app, &cookies, &csrf).await;
    let run_id = opened.body["id"].as_str().unwrap_or_default().to_owned();
    let handover_path = format!("/api/v1/payroll/runs/{run_id}/finance-handover");

    // A run nobody has decided does not cross. A draft is a working figure.
    let early = send(
        app.clone(),
        "POST",
        &handover_path,
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "buru-buru" })),
    )
    .await;
    assert_eq!(early.status, StatusCode::CONFLICT, "{:?}", early.body);

    submit(&app, &cookies, &csrf, &run_id).await;
    let (theirs, their_csrf) = second_officer(&app, &cookies, &csrf).await;
    approve(&app, &theirs, &their_csrf, &run_id).await;

    let crossed = send(
        app.clone(),
        "POST",
        &handover_path,
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "gaji April diserahkan ke keuangan" })),
    )
    .await;
    assert_eq!(
        crossed.status,
        StatusCode::OK,
        "hand over: {:?}",
        crossed.body
    );
    assert_eq!(crossed.body["state"], "RECEIVED");
    // Gross is base plus the standing allowance, for both people, and nothing
    // else: 5.500.000 + 4.500.000.
    assert_eq!(crossed.body["gross_minor"], 10_000_000);
    assert_eq!(crossed.body["lines"].as_array().map(Vec::len), Some(2));
    assert_eq!(crossed.body["settled_by"], Value::Null);
    // Nothing statutory crossed with it. There is no field for either, which
    // is the point.
    for absent in ["deductions_minor", "net_minor", "pph21_minor", "bpjs_minor"] {
        assert!(
            crossed.body.get(absent).is_none(),
            "{absent} appeared: {:?}",
            crossed.body
        );
    }
    // The lines add up to the header, which the database checks at COMMIT too.
    let summed: i64 = crossed.body["lines"]
        .as_array()
        .unwrap_or_else(|| panic!("lines"))
        .iter()
        .filter_map(|line| line["gross_minor"].as_i64())
        .sum();
    assert_eq!(summed, 10_000_000);

    // Sending it twice cannot double what the company owes.
    let again = send(
        app.clone(),
        "POST",
        &handover_path,
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "kirim lagi" })),
    )
    .await;
    assert_eq!(again.status, StatusCode::CONFLICT, "{:?}", again.body);

    // The status comes back, and it is on the run as well — so a list of runs
    // says which months have crossed without loading every line.
    let read = send(
        app.clone(),
        "GET",
        &handover_path,
        read_headers(&cookies),
        None,
    )
    .await;
    assert_eq!(read.status, StatusCode::OK, "{:?}", read.body);
    assert_eq!(read.body["state"], "RECEIVED");
    let listed = send(
        app.clone(),
        "GET",
        "/api/v1/payroll/runs",
        read_headers(&cookies),
        None,
    )
    .await;
    assert_eq!(listed.body[0]["handover"]["state"], "RECEIVED");
    assert_eq!(listed.body[0]["handover"]["gross_minor"], 10_000_000);
    assert_eq!(listed.body[0]["handover"]["people"], 2);

    // Finance Connect stage 3: the handover IS the accrual, per component on
    // the store's selling-expense leaves (6012-6024) against 2017, with the
    // month's THR accrued to 2018 (client accountant and owner, 25 Sep).
    let leaf = |code: &'static str| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(
                "SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint
                   FROM journal_line l JOIN journal_entry e ON e.entry_id = l.entry_id
                  WHERE l.account_code = $1 AND l.site_id = 'store-07'",
            )
            .bind(code)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("{code}: {error}"))
        }
    };
    let expense: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint
           FROM journal_line l JOIN journal_entry e ON e.entry_id = l.entry_id
          WHERE e.source_kind = 'PAYROLL_RUN' AND l.site_id = 'store-07'
            AND l.account_code BETWEEN '6012' AND '6024'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("expense: {error}"));
    let thr = 5_000_000 / 12 + 4_000_000 / 12;
    assert_eq!(expense, 10_000_000 + thr, "gross plus the month's THR, on store leaves");
    assert_eq!(leaf("2017").await, -10_000_000, "net pay owed on 2017");
    assert_eq!(leaf("2018").await, -thr, "THR accrued on 2018");
    assert_eq!(leaf("6018").await, thr, "THR expense on the store THR leaf");
    assert_eq!(leaf("6026").await, 0, "no head-office leaf for a store's staff");

    // Stage two, the store way: head office sends the money (its half), the
    // store confirms it into petty cash (its half), and pays out of petty
    // cash — 2017 comes back to nothing, and the affiliate pair nets to zero.
    cloud::describe_account(
        &pool,
        &cloud::DescribeBankAccountRequest {
            ledger_account_code: "1005".into(),
            site_id: "dc".into(),
            bank_code: Some("BCA".into()),
            bank_name: String::new(),
            account_no: "8880012345".into(),
            account_holder: "PT Contoh".into(),
            branch: None,
            kind: "GIRO".into(),
            is_primary: Some(true),
            note: None,
        },
        "admin",
    )
    .await
    .unwrap_or_else(|error| panic!("bank account: {error}"));
    let day = chrono::Utc::now().date_naive();
    let sent = cloud::operating_fund_send(
        &pool,
        &cloud::SendFundRequest {
            site_id: "store-07".into(),
            custodian_employee_id: siti.clone(),
            amount_minor: 10_000_000,
            value_date: day,
            due_date: None,
            bank_key: "bank_giro".into(),
            bank_qualifier: "BCA".into(),
            payout_bank_name: "BCA".into(),
            payout_account_no: "7712345678".into(),
            payout_account_name: "Siti".into(),
            note: None,
        },
        "admin",
    )
    .await
    .unwrap_or_else(|error| panic!("send: {error}"));
    let fund_id: uuid::Uuid = serde_json::from_value(sent["fund_id"].clone())
        .unwrap_or_else(|error| panic!("fund id: {error}"));
    assert!(
        cloud::fund_settlement_record(
            &pool,
            &cloud::SettleFundRequest {
                fund_id,
                allocation_id: None,
                kind: "PAYROLL".into(),
                reference_id: None,
                expense_key: None,
                amount_minor: 10_000_000,
                settled_on: day,
                proof_file_id: None,
                note: None,
            },
            "admin",
        )
        .await
        .is_err(),
        "the store spends the money only after confirming it into petty cash"
    );
    cloud::operating_fund_receive(&pool, fund_id, &cloud::ReceiveFundRequest { received_on: day }, "admin")
        .await
        .unwrap_or_else(|error| panic!("receive: {error}"));
    cloud::fund_settlement_record(
        &pool,
        &cloud::SettleFundRequest {
            fund_id,
            allocation_id: None,
            kind: "PAYROLL".into(),
            reference_id: None,
            expense_key: None,
            amount_minor: 10_000_000,
            settled_on: day,
            proof_file_id: None,
            note: None,
        },
        "admin",
    )
    .await
    .unwrap_or_else(|error| panic!("pay out: {error}"));
    assert_eq!(leaf("2017").await, 0, "payroll payable is cleared by the payout");
    assert_eq!(leaf("1003").await, 0, "petty cash received and paid out");
    assert_eq!(leaf("2028").await, -10_000_000, "the store owes head office the funding");
    let (ho_1057, company): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(debit_minor - credit_minor) FILTER (WHERE account_code = '1057'
                                                               AND site_id = 'dc'), 0)::bigint,
                COALESCE(SUM(debit_minor - credit_minor) FILTER (WHERE account_code IN
                    ('1057','1058','1059','2028','2029')), 0)::bigint
           FROM journal_line",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("affiliate: {error}"));
    assert_eq!(ho_1057, 10_000_000, "head office is owed the funding");
    assert_eq!(company, 0, "the affiliate pair nets to zero company-wide");

    // Finance answers under its own key: the officer who handed it over cannot
    // also declare it paid.
    let settlement = format!("{handover_path}/settlement");
    let paid = send(
        app.clone(),
        "POST",
        &settlement,
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "transfer 2026-05-02" })),
    )
    .await;
    assert_eq!(paid.status, StatusCode::OK, "settle: {:?}", paid.body);
    assert_eq!(paid.body["state"], "PAID");
    assert_eq!(paid.body["settled_by"], "admin");

    // Twice would be a second payment of the same liability.
    let twice = send(
        app.clone(),
        "POST",
        &settlement,
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "sekali lagi" })),
    )
    .await;
    assert_eq!(twice.status, StatusCode::CONFLICT, "{:?}", twice.body);

    // And head office may still reopen the run afterwards. The owner accepted
    // that explicitly: nothing refuses it, and what Finance was handed does
    // not move when the run does.
    let reopened = send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/runs/{run_id}/reopen"),
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "gaji Budi salah, dikoreksi" })),
    )
    .await;
    assert_eq!(
        reopened.status,
        StatusCode::OK,
        "a booked month is still reopenable: {:?}",
        reopened.body
    );
    assert_eq!(reopened.body["state"], "DRAFT");
    // The snapshot is untouched — still two people and still ten million.
    assert_eq!(reopened.body["handover"]["state"], "PAID");
    assert_eq!(reopened.body["handover"]["gross_minor"], 10_000_000);
    let after = send(
        app.clone(),
        "GET",
        &handover_path,
        read_headers(&cookies),
        None,
    )
    .await;
    assert_eq!(after.body["gross_minor"], 10_000_000);
    assert_eq!(after.body["lines"].as_array().map(Vec::len), Some(2));
}
