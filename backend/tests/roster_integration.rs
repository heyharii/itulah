//! The plan, its revisions, and the close that freezes them.
//!
//! Two tests carry this file. **A closed month refuses a roster change** — the
//! dangerous edit is not tomorrow's plan but a scheduled day quietly added to a
//! month already counted, which turns a day nobody worked into an absence and
//! an absence into a deduction basis. And **a close records what it did not
//! check**: there is no punch source, so the punch-derived blockers come back
//! `null` rather than `0`, because zero is a claim that somebody looked.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-roster-1";
const CASHIER_PASSWORD: &str = "cashier-password-roster-1";

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
        node_id: "cloud-roster-test".into(),
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

const SUPERVISOR_PASSWORD: &str = "supervisor-password-roster-1";

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

/// The two shifts a small shop runs.
async fn define_shifts(app: &axum::Router, cookies: &str, csrf: &str) {
    for body in [
        json!({
            "id": "PAGI",
            "name": "Pagi",
            "starts_at": "07:00",
            "ends_at": "15:00",
            "unpaid_break_minutes": 60,
        }),
        // The one that needs the 0..2879 timeline: 22:00 to 06:00 the next day.
        json!({
            "id": "MALAM",
            "name": "Malam",
            "starts_at": "22:00",
            "ends_at": "06:00",
            "crosses_midnight": true,
            "unpaid_break_minutes": 60,
        }),
    ] {
        let defined = send(
            app.clone(),
            "POST",
            "/api/v1/attendance-shifts",
            write_headers(cookies, csrf),
            Some(body),
        )
        .await;
        assert_eq!(defined.status, StatusCode::OK, "define: {:?}", defined.body);
    }
}

async fn plan(
    app: &axum::Router,
    cookies: &str,
    csrf: &str,
    employee_id: &str,
    body: Value,
) -> Response {
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/roster"),
        write_headers(cookies, csrf),
        Some(body),
    )
    .await
}

fn scheduled(on: &str, shift: &str, reason: &str) -> Value {
    json!({ "on_date": on, "plan": "SCHEDULED", "shift_id": shift, "reason": reason })
}

fn rest(on: &str, reason: &str) -> Value {
    json!({ "on_date": on, "plan": "REST_DAY", "reason": reason })
}

/// Shift patterns are head office's, and readable by everybody they schedule.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn shifts_are_set_at_head_office_and_read_by_everybody(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    define_shifts(&app, &cookies, &csrf).await;

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
    let (hers, her_csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;

    let listed = send(
        app.clone(),
        "GET",
        "/api/v1/attendance-shifts",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(listed.status, StatusCode::OK, "{:?}", listed.body);
    assert_eq!(listed.body.as_array().map(Vec::len), Some(2));

    // The overnight shift is eight hours less its break, and says it crosses
    // midnight rather than leaving the reader to compare two clock readings.
    let malam = listed
        .body
        .as_array()
        .unwrap_or_else(|| panic!("a list"))
        .iter()
        .find(|row| row["id"] == "MALAM")
        .unwrap_or_else(|| panic!("the night shift"));
    assert_eq!(malam["crosses_midnight"], true);
    assert_eq!(malam["planned_work_minutes"], 7 * 60);
    assert_eq!(malam["starts_at"], "22:00");
    assert_eq!(malam["ends_at"], "06:00");

    // She may not define one.
    let refused = send(
        app.clone(),
        "POST",
        "/api/v1/attendance-shifts",
        write_headers(&hers, &her_csrf),
        Some(json!({ "id": "SIANG", "name": "Siang", "starts_at": "15:00", "ends_at": "22:00" })),
    )
    .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN, "{:?}", refused.body);

    // A shift that ends before it starts, without saying it crosses midnight,
    // is a bad request rather than a twenty-four-hour shift.
    let backwards = send(
        app.clone(),
        "POST",
        "/api/v1/attendance-shifts",
        write_headers(&cookies, &csrf),
        Some(json!({ "id": "X", "name": "X", "starts_at": "22:00", "ends_at": "06:00" })),
    )
    .await;
    assert_eq!(
        backwards.status,
        StatusCode::BAD_REQUEST,
        "{:?}",
        backwards.body
    );

    // And a break as long as the shift is paid time nobody is being paid for.
    let all_break = send(
        app.clone(),
        "POST",
        "/api/v1/attendance-shifts",
        write_headers(&cookies, &csrf),
        Some(json!({
            "id": "Y", "name": "Y", "starts_at": "09:00", "ends_at": "17:00",
            "unpaid_break_minutes": 480,
        })),
    )
    .await;
    assert_eq!(
        all_break.status,
        StatusCode::BAD_REQUEST,
        "{:?}",
        all_break.body
    );
}

/// A day is planned, and planning it again is a revision — the earlier plan
/// survives, which is what makes a settled month reproducible.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_revision_keeps_the_plan_it_replaced(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    define_shifts(&app, &cookies, &csrf).await;

    let siti = staff_at(&app, &cookies, &csrf, "K0701", "store-07").await;
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

    let first = plan(
        &app,
        &hers,
        &her_csrf,
        &siti,
        scheduled("2026-04-06", "PAGI", "jadwal minggu ini"),
    )
    .await;
    assert_eq!(first.status, StatusCode::OK, "plan: {:?}", first.body);
    assert_eq!(first.body["plan"], "SCHEDULED");
    assert_eq!(first.body["shift_id"], "PAGI");
    assert_eq!(first.body["revision_count"], 1);
    assert_eq!(first.body["planned_by"], "rina");
    assert_eq!(first.body["planned_work_minutes"], 7 * 60);

    let revised = plan(
        &app,
        &hers,
        &her_csrf,
        &siti,
        scheduled("2026-04-06", "MALAM", "tukar shift dengan Budi"),
    )
    .await;
    assert_eq!(revised.status, StatusCode::OK, "revise: {:?}", revised.body);
    assert_eq!(revised.body["shift_id"], "MALAM");
    assert_eq!(revised.body["revision_count"], 2);
    // Both statements survive, oldest first. The plan in force is the last.
    let revisions = revised.body["revisions"]
        .as_array()
        .unwrap_or_else(|| panic!("revisions"));
    assert_eq!(revisions.len(), 2);
    assert_eq!(revisions[0]["shift_id"], "PAGI");
    assert_eq!(revisions[0]["reason"], "jadwal minggu ini");
    assert_eq!(revisions[1]["shift_id"], "MALAM");

    // A rest day names no shift, and a scheduled day must name one.
    let rested = plan(
        &app,
        &hers,
        &her_csrf,
        &siti,
        rest("2026-04-07", "libur mingguan"),
    )
    .await;
    assert_eq!(rested.status, StatusCode::OK, "{:?}", rested.body);
    assert_eq!(rested.body["plan"], "REST_DAY");
    assert_eq!(rested.body["shift_id"], Value::Null);

    let shiftless = plan(
        &app,
        &hers,
        &her_csrf,
        &siti,
        json!({ "on_date": "2026-04-08", "plan": "SCHEDULED", "reason": "lupa shift" }),
    )
    .await;
    assert_eq!(
        shiftless.status,
        StatusCode::BAD_REQUEST,
        "{:?}",
        shiftless.body
    );
}

/// The bound the Roster screen reads: a manager builds their own shop's week.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_manager_can_only_roster_their_own_shop(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    define_shifts(&app, &cookies, &csrf).await;

    let siti = staff_at(&app, &cookies, &csrf, "K0701", "store-07").await;
    let budi = staff_at(&app, &cookies, &csrf, "K0301", "store-03").await;
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

    let ours = plan(
        &app,
        &hers,
        &her_csrf,
        &siti,
        scheduled("2026-04-06", "PAGI", "jadwal"),
    )
    .await;
    assert_eq!(ours.status, StatusCode::OK, "{:?}", ours.body);

    let theirs = plan(
        &app,
        &hers,
        &her_csrf,
        &budi,
        scheduled("2026-04-06", "PAGI", "jadwal"),
    )
    .await;
    assert_eq!(theirs.status, StatusCode::FORBIDDEN, "{:?}", theirs.body);

    // The grid, bounded the same way.
    let grid = send(
        app.clone(),
        "GET",
        "/api/v1/roster?place=store-07&from=2026-04-06&to=2026-04-12",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(grid.status, StatusCode::OK, "{:?}", grid.body);
    assert_eq!(grid.body.as_array().map(Vec::len), Some(1));

    let elsewhere = send(
        app.clone(),
        "GET",
        "/api/v1/roster?place=store-03&from=2026-04-06&to=2026-04-12",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(
        elsewhere.status,
        StatusCode::FORBIDDEN,
        "{:?}",
        elsewhere.body
    );

    // Siti reads her own week without any grant at all: it is her week.
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
    let (his, _) = sign_in(&app, "siti", CASHIER_PASSWORD).await;
    let mine = send(
        app.clone(),
        "GET",
        "/api/v1/employees/me/roster?from=2026-04-06&to=2026-04-12",
        read_headers(&his),
        None,
    )
    .await;
    assert_eq!(mine.status, StatusCode::OK, "{:?}", mine.body);
    assert_eq!(mine.body[0]["shift_name"], "Pagi");
}

/// The test this file exists for.
///
/// A scheduled day quietly added to a month already counted turns a day nobody
/// worked into an absence, and an absence into a deduction basis. The close
/// freezes the plan, not only the facts.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_closed_month_refuses_a_roster_change(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    define_shifts(&app, &cookies, &csrf).await;

    let siti = staff_at(&app, &cookies, &csrf, "K0701", "store-07").await;
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

    plan(
        &app,
        &hers,
        &her_csrf,
        &siti,
        scheduled("2026-04-06", "PAGI", "jadwal"),
    )
    .await;

    // What stands between the month and a close, before anything is closed.
    let before = send(
        app.clone(),
        "GET",
        "/api/v1/attendance-periods?place=store-07&period=2026-04",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(before.status, StatusCode::OK, "{:?}", before.body);
    assert_eq!(before.body[0]["status"], "OPEN");
    assert_eq!(before.body[0]["readiness"]["can_close"], true);
    // The claim this whole design turns on: the punch checks were not made, and
    // the answer says so rather than saying zero.
    assert_eq!(before.body[0]["readiness"]["punches_assessed"], false);
    assert_eq!(before.body[0]["readiness"]["open_corrections"], Value::Null);
    assert_eq!(
        before.body[0]["readiness"]["unrostered_punch_days"],
        Value::Null
    );

    let closed = send(
        app.clone(),
        "POST",
        "/api/v1/attendance-periods/store-07/2026-04/closure",
        write_headers(&hers, &her_csrf),
        Some(json!({ "reason": "absensi April sudah dicek" })),
    )
    .await;
    assert_eq!(closed.status, StatusCode::OK, "close: {:?}", closed.body);
    assert_eq!(closed.body["status"], "CLOSED");
    assert_eq!(closed.body["history"][0]["event"], "CLOSED");
    assert_eq!(closed.body["history"][0]["actor"], "rina");
    // The evidence keeps the "not assessed" honestly, so a later reader knows
    // exactly what was and was not checked.
    assert_eq!(
        closed.body["history"][0]["readiness"]["open_corrections"],
        Value::Null
    );

    // And now the plan is frozen — both a new day and a revision to an existing
    // one are refused, as a conflict rather than a bad request.
    let added = plan(
        &app,
        &hers,
        &her_csrf,
        &siti,
        scheduled("2026-04-20", "PAGI", "tambahan"),
    )
    .await;
    assert_eq!(added.status, StatusCode::CONFLICT, "{:?}", added.body);

    let revised = plan(
        &app,
        &hers,
        &her_csrf,
        &siti,
        rest("2026-04-06", "ganti jadi libur"),
    )
    .await;
    assert_eq!(revised.status, StatusCode::CONFLICT, "{:?}", revised.body);

    // A day in the *next* month is untouched by April's close.
    let may = plan(
        &app,
        &hers,
        &her_csrf,
        &siti,
        scheduled("2026-05-04", "PAGI", "jadwal Mei"),
    )
    .await;
    assert_eq!(may.status, StatusCode::OK, "{:?}", may.body);
}

/// A place that could reopen its own sign-off has not signed anything off.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn only_head_office_reopens_a_month(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    define_shifts(&app, &cookies, &csrf).await;

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

    send(
        app.clone(),
        "POST",
        "/api/v1/attendance-periods/store-07/2026-04/closure",
        write_headers(&hers, &her_csrf),
        Some(json!({ "reason": "absensi April sudah dicek" })),
    )
    .await;

    let hers_again = send(
        app.clone(),
        "POST",
        "/api/v1/attendance-periods/store-07/2026-04/reopening",
        write_headers(&hers, &her_csrf),
        Some(json!({ "reason": "ada yang terlewat" })),
    )
    .await;
    assert_eq!(
        hers_again.status,
        StatusCode::FORBIDDEN,
        "{:?}",
        hers_again.body
    );

    let reopened = send(
        app.clone(),
        "POST",
        "/api/v1/attendance-periods/store-07/2026-04/reopening",
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "koreksi jadwal Siti" })),
    )
    .await;
    assert_eq!(
        reopened.status,
        StatusCode::OK,
        "reopen: {:?}",
        reopened.body
    );
    assert_eq!(reopened.body["status"], "OPEN");
    assert_eq!(reopened.body["reopen_count"], 1);
    assert_eq!(reopened.body["history"][1]["event"], "REOPENED");
    // A reopen is not taken under an assessment, so it records none — rather
    // than recording a clean bill of health nobody gave.
    assert_eq!(reopened.body["history"][1]["readiness"], Value::Null);

    // Closing twice is a conflict, and so is reopening an open month.
    let again = send(
        app.clone(),
        "POST",
        "/api/v1/attendance-periods/store-07/2026-04/reopening",
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "lagi" })),
    )
    .await;
    assert_eq!(again.status, StatusCode::CONFLICT, "{:?}", again.body);
}

/// A month cannot close over work nobody has answered for.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn undecided_leave_and_unanswered_overtime_block_the_close(pool: PgPool) {
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

    let (his, his_csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;
    send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/leave-requests",
        write_headers(&his, &his_csrf),
        Some(json!({
            "request_id": "LV-A1",
            "leave_type": "CUTI_TAHUNAN",
            "from_date": "2026-04-13",
            "to_date": "2026-04-14",
            "reason": "urusan keluarga",
        })),
    )
    .await;

    let (hers, her_csrf) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;
    let readiness = send(
        app.clone(),
        "GET",
        "/api/v1/attendance-periods?place=store-07&period=2026-04",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(readiness.body[0]["readiness"]["unresolved_leave"], 1);
    assert_eq!(readiness.body[0]["readiness"]["can_close"], false);

    let blocked = send(
        app.clone(),
        "POST",
        "/api/v1/attendance-periods/store-07/2026-04/closure",
        write_headers(&hers, &her_csrf),
        Some(json!({ "reason": "tutup saja" })),
    )
    .await;
    assert_eq!(blocked.status, StatusCode::CONFLICT, "{:?}", blocked.body);

    // Decide it, and the month closes.
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/leave-requests/LV-A1/approve"),
        write_headers(&hers, &her_csrf),
        Some(json!({ "reason": "toko cukup orang" })),
    )
    .await;
    let closed = send(
        app.clone(),
        "POST",
        "/api/v1/attendance-periods/store-07/2026-04/closure",
        write_headers(&hers, &her_csrf),
        Some(json!({ "reason": "semua sudah diputuskan" })),
    )
    .await;
    assert_eq!(closed.status, StatusCode::OK, "{:?}", closed.body);
}
