//! Leave and the calendar it is counted against, over HTTP.
//!
//! The two halves arrive together because neither is usable alone: a request
//! spanning Idul Fitri has to know not to charge it, and a calendar nobody
//! counts leave against is a list of dates.
//!
//! Three tests here carry the file. **The approval and its deduction** — an
//! approved request comes back naming the ledger entry it made, and the balance
//! has moved by exactly the chargeable days. **The sick day that deducts
//! nothing** — approved, and the annual balance untouched, because UU 13/2003
//! art. 93 does not let an employer take those days from anywhere. And **the
//! bound** — a manager posted to one shop cannot decide another shop's leave,
//! which is the same reach that bounds the Directory, asked of a different row.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-leave-1";
const CASHIER_PASSWORD: &str = "cashier-password-leave-1";

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
        node_id: "cloud-leave-test".into(),
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

const SUPERVISOR_PASSWORD: &str = "supervisor-password-leave-1";

/// Register somebody, hire them, and post them to a place.
async fn staff_at(
    app: &axum::Router,
    cookies: &str,
    csrf: &str,
    code: &str,
    unit_id: &str,
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
            "unit_id": unit_id,
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

fn centidays(balances: &Value, code: &str) -> i64 {
    balances
        .as_array()
        .unwrap_or_else(|| panic!("balances: {balances:?}"))
        .iter()
        .find(|row| row["leave_type"] == code)
        .unwrap_or_else(|| panic!("no {code} balance in {balances:?}"))["centidays"]
        .as_i64()
        .unwrap_or_else(|| panic!("centidays"))
}

// ── the calendar ─────────────────────────────────────────────────────────

/// A rule kept from the people it governs is a trap rather than a rule, so a
/// cashier may read the calendar. Publishing it is head office's.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_calendar_is_readable_by_everybody_and_writable_by_head_office(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    publish_2026(&app, &cookies, &csrf).await;

    let created = send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        write_headers(&cookies, &csrf),
        Some(json!({
            "username": "siti",
            "display_name": "Siti",
            "password": CASHIER_PASSWORD,
            "role": "CASHIER",
        })),
    )
    .await;
    assert_eq!(created.status, StatusCode::OK, "{:?}", created.body);
    let (hers, her_csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;

    let read = send(
        app.clone(),
        "GET",
        "/api/v1/holiday-calendars/2026",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(read.status, StatusCode::OK, "read: {:?}", read.body);
    assert_eq!(read.body["holidays"].as_array().map(Vec::len), Some(3));
    // The one distinction the whole module exists for, sent rather than derived
    // in the browser.
    let cuti = read.body["holidays"]
        .as_array()
        .unwrap_or_else(|| panic!("holidays"))
        .iter()
        .find(|day| day["date"] == "2026-04-07")
        .unwrap_or_else(|| panic!("cuti bersama"));
    assert_eq!(cuti["consumes_annual_leave"], true);
    assert_eq!(read.body["holidays"][0]["consumes_annual_leave"], false);

    // Writing it is not hers.
    let refused = send(
        app.clone(),
        "POST",
        "/api/v1/holiday-calendars/2026/amendments",
        write_headers(&hers, &her_csrf),
        Some(json!({
            "change": "ADDED",
            "holiday": { "date": "2026-06-01", "name": "Hari Lahir Pancasila", "kind": "NATIONAL" },
            "reason": "iseng",
        })),
    )
    .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN, "{:?}", refused.body);
}

/// A year is published once. Republishing would replace the approved set
/// wholesale and take its history with it, so the second attempt is a conflict
/// and the way to change it is an amendment.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_year_is_published_once_and_amended_after(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    publish_2026(&app, &cookies, &csrf).await;

    let again = send(
        app.clone(),
        "POST",
        "/api/v1/holiday-calendars",
        write_headers(&cookies, &csrf),
        Some(json!({ "year": 2026, "holidays": [], "reason": "sekali lagi" })),
    )
    .await;
    assert_eq!(again.status, StatusCode::CONFLICT, "{:?}", again.body);

    // The government moves one by decree in the middle of the year.
    let amended = send(
        app.clone(),
        "POST",
        "/api/v1/holiday-calendars/2026/amendments",
        write_headers(&cookies, &csrf),
        Some(json!({
            "change": "ADDED",
            "holiday": { "date": "2026-04-08", "name": "Cuti Bersama", "kind": "CUTI_BERSAMA" },
            "reason": "SKB revisi",
        })),
    )
    .await;
    assert_eq!(amended.status, StatusCode::OK, "amend: {:?}", amended.body);
    assert_eq!(amended.body["holidays"].as_array().map(Vec::len), Some(4));
    assert_eq!(amended.body["amendments"][0]["change"], "ADDED");
    assert_eq!(amended.body["amendments"][0]["actor"], "admin");
    assert_eq!(amended.body["amendments"][0]["reason"], "SKB revisi");

    // Withdrawing a day the calendar does not hold is a conflict, not a bad
    // request: the payload is well formed and the calendar is the problem.
    let missing = send(
        app.clone(),
        "POST",
        "/api/v1/holiday-calendars/2026/amendments",
        write_headers(&cookies, &csrf),
        Some(json!({
            "change": "REMOVED",
            "holiday": { "date": "2026-12-25", "name": "Natal", "kind": "NATIONAL" },
            "reason": "salah",
        })),
    )
    .await;
    assert_eq!(missing.status, StatusCode::CONFLICT, "{:?}", missing.body);
}

/// A regional day is a holiday in some shops and a working day in others, so
/// there is no place-free answer to give.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_regional_day_is_a_holiday_only_where_it_is_observed(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let published = send(
        app.clone(),
        "POST",
        "/api/v1/holiday-calendars",
        write_headers(&cookies, &csrf),
        Some(json!({
            "year": 2026,
            "holidays": [{
                "date": "2026-03-19",
                "name": "Nyepi",
                "kind": "REGIONAL",
                "units": ["store-07"],
            }],
            "reason": "SKB 2026",
        })),
    )
    .await;
    assert_eq!(published.status, StatusCode::OK, "{:?}", published.body);

    for (unit, expected) in [("store-07", true), ("store-03", false)] {
        let asked = send(
            app.clone(),
            "GET",
            &format!("/api/v1/holiday-calendars/2026/on/2026-03-19?unit={unit}"),
            read_headers(&cookies),
            None,
        )
        .await;
        assert_eq!(asked.status, StatusCode::OK, "{unit}: {:?}", asked.body);
        assert_eq!(asked.body["holiday"], expected, "{unit}");
    }

    // And a regional day that names nowhere is not representable at all.
    let nowhere = send(
        app.clone(),
        "POST",
        "/api/v1/holiday-calendars/2026/amendments",
        write_headers(&cookies, &csrf),
        Some(json!({
            "change": "ADDED",
            "holiday": { "date": "2026-03-25", "name": "Lokal", "kind": "REGIONAL" },
            "reason": "coba",
        })),
    )
    .await;
    assert_eq!(
        nowhere.status,
        StatusCode::BAD_REQUEST,
        "{:?}",
        nowhere.body
    );
}

// ── leave ────────────────────────────────────────────────────────────────

/// The code path the whole design exists for: an approval and its deduction are
/// produced together, the request comes back naming the entry it made, and the
/// balance has moved by exactly the chargeable days.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_approval_deducts_exactly_the_days_it_charged(pool: PgPool) {
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

    let allocated = allocate(&app, &cookies, &csrf, &siti, 12).await;
    assert_eq!(centidays(&allocated, "CUTI_TAHUNAN"), 1200);

    // Siti asks for her own, through the employee app's route.
    let (hers, her_csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;
    let filed = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/leave-requests",
        write_headers(&hers, &her_csrf),
        Some(json!({
            "request_id": "LV-0001",
            "leave_type": "CUTI_TAHUNAN",
            "from_date": "2026-04-06",
            "to_date": "2026-04-08",
            "reason": "acara keluarga",
        })),
    )
    .await;
    assert_eq!(filed.status, StatusCode::OK, "file: {:?}", filed.body);
    assert_eq!(filed.body["state"], "PENDING");
    // Three days asked for, two charged: 7 April is a cuti bersama, and the
    // calendar has already taken that day out of her twelve.
    assert_eq!(filed.body["chargeable_days"], 2);
    assert_eq!(filed.body["unit_id"], "store-07");

    // It is waiting on her manager, and on nobody else's desk.
    let (his, his_csrf) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;
    let queue = send(
        app.clone(),
        "GET",
        "/api/v1/leave-requests/pending",
        read_headers(&his),
        None,
    )
    .await;
    assert_eq!(queue.status, StatusCode::OK, "queue: {:?}", queue.body);
    assert_eq!(queue.body.as_array().map(Vec::len), Some(1));
    assert_eq!(queue.body[0]["id"], "LV-0001");

    let approved = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/leave-requests/LV-0001/approve",
        write_headers(&his, &his_csrf),
        Some(json!({ "reason": "toko cukup orang" })),
    )
    .await;
    assert_eq!(
        approved.status,
        StatusCode::OK,
        "approve: {:?}",
        approved.body
    );
    assert_eq!(approved.body["state"], "APPROVED");
    assert_eq!(approved.body["decided_by"], "rina");
    // The deduction is named on the request. This is the pairing that a crash
    // between two writes used to break silently.
    assert_eq!(approved.body["ledger_entry"], "LV-0001:CUTI_TAHUNAN");

    let after = send(
        app.clone(),
        "GET",
        "/api/v1/employees/me/leave-balances",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(after.status, StatusCode::OK, "balances: {:?}", after.body);
    assert_eq!(centidays(&after.body, "CUTI_TAHUNAN"), 1000);

    // And the queue is empty, because an answered request is not in anybody's
    // way.
    let queue = send(
        app.clone(),
        "GET",
        "/api/v1/leave-requests/pending",
        read_headers(&his),
        None,
    )
    .await;
    assert_eq!(queue.body.as_array().map(Vec::len), Some(0));
}

/// UU 13/2003 art. 93: sick leave is approved and nothing is deducted. A system
/// that took those days out of the twelve would be taking something the law
/// does not allow it to take.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_sick_day_is_approved_and_deducts_from_nothing(pool: PgPool) {
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
    allocate(&app, &cookies, &csrf, &siti, 12).await;

    let (hers, her_csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;

    // Certified leave without its certificate is unbounded leave nobody granted.
    let without = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/leave-requests",
        write_headers(&hers, &her_csrf),
        Some(json!({
            "request_id": "LV-0002",
            "leave_type": "CUTI_SAKIT",
            "from_date": "2026-04-13",
            "to_date": "2026-04-15",
            "reason": "demam",
        })),
    )
    .await;
    assert_eq!(
        without.status,
        StatusCode::BAD_REQUEST,
        "{:?}",
        without.body
    );

    let filed = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/leave-requests",
        write_headers(&hers, &her_csrf),
        Some(json!({
            "request_id": "LV-0003",
            "leave_type": "CUTI_SAKIT",
            "from_date": "2026-04-13",
            "to_date": "2026-04-15",
            "evidence": "surat dokter 118/IV/2026",
            "reason": "demam berdarah",
        })),
    )
    .await;
    assert_eq!(filed.status, StatusCode::OK, "file: {:?}", filed.body);

    let (his, his_csrf) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;
    let approved = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/leave-requests/LV-0003/approve",
        write_headers(&his, &his_csrf),
        Some(json!({ "reason": "surat dokter diterima" })),
    )
    .await;
    assert_eq!(
        approved.status,
        StatusCode::OK,
        "approve: {:?}",
        approved.body
    );
    assert_eq!(approved.body["state"], "APPROVED");
    // Approved, and nothing deducted. `null` here is the correct outcome and
    // not a missing field.
    assert_eq!(approved.body["ledger_entry"], Value::Null);

    let after = send(
        app.clone(),
        "GET",
        "/api/v1/employees/me/leave-balances",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(
        centidays(&after.body, "CUTI_TAHUNAN"),
        1200,
        "the twelve are untouched"
    );
    // And sick leave does not appear as a balance at all: asking how many are
    // left is a malformed question, not one whose answer is zero.
    assert!(
        after
            .body
            .as_array()
            .unwrap_or_else(|| panic!("balances"))
            .iter()
            .all(|row| row["leave_type"] != "CUTI_SAKIT"),
        "{:?}",
        after.body
    );
}

/// The reach bound, asked of a different row: a manager posted to one shop
/// cannot see or decide another shop's leave. Same rule as the Directory, so a
/// manager who cannot read somebody's record cannot approve their holiday
/// either.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_manager_cannot_decide_another_shops_leave(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    publish_2026(&app, &cookies, &csrf).await;
    ratify_leave(&app, &cookies, &csrf).await;

    // Somebody at store-03, and a manager at store-07.
    let budi = staff_at(&app, &cookies, &csrf, "K0301", "store-03").await;
    login_for(
        &app,
        &cookies,
        &csrf,
        &budi,
        "budi",
        "CASHIER",
        CASHIER_PASSWORD,
    )
    .await;
    allocate(&app, &cookies, &csrf, &budi, 12).await;

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

    let (his, his_csrf) = sign_in(&app, "budi", CASHIER_PASSWORD).await;
    let filed = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/leave-requests",
        write_headers(&his, &his_csrf),
        Some(json!({
            "request_id": "LV-0004",
            "leave_type": "CUTI_TAHUNAN",
            "from_date": "2026-04-13",
            "to_date": "2026-04-14",
            "reason": "urusan keluarga",
        })),
    )
    .await;
    assert_eq!(filed.status, StatusCode::OK, "file: {:?}", filed.body);

    let (hers, her_csrf) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;

    // Not on her queue.
    let queue = send(
        app.clone(),
        "GET",
        "/api/v1/leave-requests/pending",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(queue.status, StatusCode::OK, "queue: {:?}", queue.body);
    assert_eq!(
        queue.body.as_array().map(Vec::len),
        Some(0),
        "{:?}",
        queue.body
    );

    // And refused when she reaches for it by id anyway. Hiding a row is a
    // convenience; this is the control.
    let refused = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{budi}/leave-requests/LV-0004/approve"),
        write_headers(&hers, &her_csrf),
        Some(json!({ "reason": "iseng" })),
    )
    .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN, "{:?}", refused.body);

    // Head office sees it, because head office is the employer.
    let all = send(
        app.clone(),
        "GET",
        "/api/v1/leave-requests/pending",
        read_headers(&cookies),
        None,
    )
    .await;
    assert_eq!(all.body.as_array().map(Vec::len), Some(1), "{:?}", all.body);
}

/// Not enough days is a conflict, not a bad request: the dates are well formed
/// and the ledger simply does not have them. And the request is untouched —
/// nothing half-approved.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn asking_for_more_days_than_are_left_leaves_the_request_pending(pool: PgPool) {
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
    allocate(&app, &cookies, &csrf, &siti, 1).await;

    let (hers, her_csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;
    let filed = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/leave-requests",
        write_headers(&hers, &her_csrf),
        Some(json!({
            "request_id": "LV-0005",
            "leave_type": "CUTI_TAHUNAN",
            "from_date": "2026-04-13",
            "to_date": "2026-04-17",
            "reason": "liburan",
        })),
    )
    .await;
    assert_eq!(filed.status, StatusCode::OK, "file: {:?}", filed.body);

    let (his, his_csrf) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;
    let refused = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/leave-requests/LV-0005/approve",
        write_headers(&his, &his_csrf),
        Some(json!({ "reason": "coba" })),
    )
    .await;
    assert_eq!(refused.status, StatusCode::CONFLICT, "{:?}", refused.body);

    let still = send(
        app.clone(),
        "GET",
        "/api/v1/employees/me/leave-requests",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(still.body[0]["state"], "PENDING", "{:?}", still.body);
    // The balance did not move either.
    let after = send(
        app.clone(),
        "GET",
        "/api/v1/employees/me/leave-balances",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(centidays(&after.body, "CUTI_TAHUNAN"), 100);
}

/// Only the person who asked may take it back. Anyone else who wants a pending
/// request gone must reject it, which records their name and their reason —
/// a third-party withdrawal would dispose of it while looking like the employee
/// changed their own mind.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn only_the_person_who_asked_may_withdraw(pool: PgPool) {
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
    allocate(&app, &cookies, &csrf, &siti, 12).await;

    let (hers, her_csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;
    send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/leave-requests",
        write_headers(&hers, &her_csrf),
        Some(json!({
            "request_id": "LV-0006",
            "leave_type": "CUTI_TAHUNAN",
            "from_date": "2026-04-13",
            "to_date": "2026-04-14",
            "reason": "urusan keluarga",
        })),
    )
    .await;

    // Her manager may not withdraw it on her behalf.
    let (his, his_csrf) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;
    let refused = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/leave-requests/LV-0006/withdraw"),
        write_headers(&his, &his_csrf),
        Some(json!({ "reason": "dibatalkan" })),
    )
    .await;
    assert_eq!(refused.status, StatusCode::CONFLICT, "{:?}", refused.body);

    // He may reject it, under his own name.
    let rejected = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/leave-requests/LV-0006/reject"),
        write_headers(&his, &his_csrf),
        Some(json!({ "reason": "toko kekurangan orang" })),
    )
    .await;
    assert_eq!(rejected.status, StatusCode::OK, "{:?}", rejected.body);
    assert_eq!(rejected.body["state"], "REJECTED");
    assert_eq!(rejected.body["decided_by"], "rina");
    assert_eq!(rejected.body["decision_reason"], "toko kekurangan orang");

    // A decided request is decided. There is no second opinion.
    let again = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/leave-requests/LV-0006/approve"),
        write_headers(&his, &his_csrf),
        Some(json!({ "reason": "berubah pikiran" })),
    )
    .await;
    assert_eq!(again.status, StatusCode::CONFLICT, "{:?}", again.body);
}

/// There is no route that spends a balance. Days leave one only through an
/// approval, which mints the deduction and stores it in the same transaction —
/// a "just adjust the balance" path would put the halfway state back within
/// reach of one careless caller.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn no_route_can_spend_a_balance(pool: PgPool) {
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
    allocate(&app, &cookies, &csrf, &siti, 12).await;

    let spent = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/leave-balances"),
        write_headers(&cookies, &csrf),
        Some(json!({
            "entry_id": "sneaky-1",
            "leave_type": "CUTI_TAHUNAN",
            "on": "2026-05-04",
            "event": "USAGE",
            "days": 3,
        })),
    )
    .await;
    assert_eq!(spent.status, StatusCode::BAD_REQUEST, "{:?}", spent.body);

    // Granting days is head office's, and a shop manager cannot hand them out.
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
    let refused = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/leave-balances"),
        write_headers(&hers, &her_csrf),
        Some(json!({
            "entry_id": "gift-1",
            "leave_type": "CUTI_TAHUNAN",
            "on": "2026-05-04",
            "event": "COMPENSATORY",
            "days": 5,
        })),
    )
    .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN, "{:?}", refused.body);
}

/// Which days a request charges is settled against a calendar, so a span in a
/// year nobody has published is refused rather than charged against nothing.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn leave_in_a_year_with_no_calendar_is_refused(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
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
    allocate(&app, &cookies, &csrf, &siti, 12).await;

    let (hers, her_csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;
    let refused = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/leave-requests",
        write_headers(&hers, &her_csrf),
        Some(json!({
            "request_id": "LV-0007",
            "leave_type": "CUTI_TAHUNAN",
            "from_date": "2026-04-13",
            "to_date": "2026-04-14",
            "reason": "liburan",
        })),
    )
    .await;
    assert_eq!(refused.status, StatusCode::CONFLICT, "{:?}", refused.body);
}

/// Head office employs people too, and their leave is decided the way a
/// shop's is — by somebody posted there — but never by the person it is for.
///
/// Two supervisors at `ho`. Rina files from her phone: her own queue does not
/// offer it back to her, and reaching for it by id is refused. HR files a
/// second request on her behalf, so she is not its requester: still refused,
/// because it is her leave. Dewi, beside her, decides both.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn nobody_decides_their_own_leave_head_office_included(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    publish_2026(&app, &cookies, &csrf).await;
    ratify_leave(&app, &cookies, &csrf).await;

    let rina = staff_at(&app, &cookies, &csrf, "HO0101", "ho").await;
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
    allocate(&app, &cookies, &csrf, &rina, 12).await;
    let dewi = staff_at(&app, &cookies, &csrf, "HO0102", "ho").await;
    login_for(
        &app,
        &cookies,
        &csrf,
        &dewi,
        "dewi",
        "SUPERVISOR",
        SUPERVISOR_PASSWORD,
    )
    .await;

    let (hers, her_csrf) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;
    let filed = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/leave-requests",
        write_headers(&hers, &her_csrf),
        Some(json!({
            "request_id": "LV-HO-1",
            "leave_type": "CUTI_TAHUNAN",
            "from_date": "2026-04-13",
            "to_date": "2026-04-14",
            "reason": "urusan keluarga",
        })),
    )
    .await;
    assert_eq!(filed.status, StatusCode::OK, "file: {:?}", filed.body);
    let on_behalf = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{rina}/leave-requests"),
        write_headers(&cookies, &csrf),
        Some(json!({
            "request_id": "LV-HO-2",
            "leave_type": "CUTI_TAHUNAN",
            "from_date": "2026-06-08",
            "to_date": "2026-06-08",
            "reason": "diajukan HR atas permintaan lisan",
        })),
    )
    .await;
    assert_eq!(
        on_behalf.status,
        StatusCode::OK,
        "file on behalf: {:?}",
        on_behalf.body
    );

    let own_queue = send(
        app.clone(),
        "GET",
        "/api/v1/leave-requests/pending",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(own_queue.status, StatusCode::OK, "{:?}", own_queue.body);
    assert_eq!(
        own_queue.body.as_array().map(Vec::len),
        Some(0),
        "her own leave is not waiting on her: {:?}",
        own_queue.body
    );

    for request in ["LV-HO-1", "LV-HO-2"] {
        for verb in ["approve", "reject"] {
            let refused = send(
                app.clone(),
                "POST",
                &format!("/api/v1/employees/{rina}/leave-requests/{request}/{verb}"),
                write_headers(&hers, &her_csrf),
                Some(json!({ "reason": "saya sendiri" })),
            )
            .await;
            assert_eq!(
                refused.status,
                StatusCode::FORBIDDEN,
                "{request} {verb}: {:?}",
                refused.body
            );
        }
    }

    let (his, his_csrf) = sign_in(&app, "dewi", SUPERVISOR_PASSWORD).await;
    let queue = send(
        app.clone(),
        "GET",
        "/api/v1/leave-requests/pending",
        read_headers(&his),
        None,
    )
    .await;
    assert_eq!(
        queue.body.as_array().map(Vec::len),
        Some(2),
        "both wait on her colleague: {:?}",
        queue.body
    );
    for request in ["LV-HO-1", "LV-HO-2"] {
        let approved = send(
            app.clone(),
            "POST",
            &format!("/api/v1/employees/{rina}/leave-requests/{request}/approve"),
            write_headers(&his, &his_csrf),
            Some(json!({ "reason": "disetujui" })),
        )
        .await;
        assert_eq!(
            approved.status,
            StatusCode::OK,
            "{request}: {:?}",
            approved.body
        );
        assert_eq!(approved.body["state"], "APPROVED", "{:?}", approved.body);
    }
}
