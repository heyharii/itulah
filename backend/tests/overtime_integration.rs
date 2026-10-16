//! Overtime, over HTTP: the employer orders and the worker answers.
//!
//! One test carries this file — `a_supervisor_cannot_answer_for_the_worker`.
//! PP 35/2021 art. 26(2) wants two written acts from two people, and almost
//! every system models it as a single manager approval. That shape produces
//! exactly the outcome the rule exists to prevent: hours worked because a
//! supervisor said so, with no record that anyone asked. The two keys are
//! disjoint, the two routes never accept each other's key, and the kernel
//! refuses again on the way in and on the way back out of storage.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-overtime-1";
const CASHIER_PASSWORD: &str = "cashier-password-overtime-1";

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
        node_id: "cloud-overtime-test".into(),
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

const SUPERVISOR_PASSWORD: &str = "supervisor-password-overtime-1";

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

/// Four hours a day, eighteen a week — PP 35/2021 art. 26(1), stated by the
/// operator because nothing in the code supplies it.
async fn ratify_caps(app: &axum::Router, cookies: &str, csrf: &str) {
    let ratified = send(
        app.clone(),
        "POST",
        "/api/v1/overtime-policy",
        write_headers(cookies, csrf),
        Some(json!({
            "version": 1,
            "max_per_day_minutes": 240,
            "max_per_week_minutes": 1080,
            "reason": "PP 35/2021 pasal 26 ayat 1",
        })),
    )
    .await;
    assert_eq!(
        ratified.status,
        StatusCode::OK,
        "ratify: {:?}",
        ratified.body
    );
}

async fn order_overtime(
    app: &axum::Router,
    cookies: &str,
    csrf: &str,
    employee_id: &str,
    order_id: &str,
    on: &str,
    minutes: u32,
) -> Response {
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/overtime-orders"),
        write_headers(cookies, csrf),
        Some(json!({
            "order_id": order_id,
            "on_date": on,
            "day_kind": "WORKING",
            "planned_minutes": minutes,
            "reason": "stok opname akhir bulan",
        })),
    )
    .await
}

/// The test this file exists for.
///
/// A supervisor holds the ordering key. They reach the consent route and are
/// refused — and if that gate were ever loosened, the kernel would refuse the
/// `WorkerConsent` and the loader would refuse the row. Three enforcements.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_supervisor_cannot_answer_for_the_worker(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    ratify_caps(&app, &cookies, &csrf).await;

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

    let (hers, her_csrf) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;
    let ordered = order_overtime(&app, &hers, &her_csrf, &siti, "OT-0001", "2026-04-06", 120).await;
    assert_eq!(ordered.status, StatusCode::OK, "order: {:?}", ordered.body);
    assert_eq!(ordered.body["state"], "AWAITING_CONSENT");
    // The whole point: nothing is authorized yet.
    assert_eq!(ordered.body["authorized_minutes"], Value::Null);
    assert_eq!(ordered.body["planned_minutes"], 120);
    assert_eq!(ordered.body["ordered_by"], "rina");

    // She may not answer her own instruction.
    let refused = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/overtime-orders/OT-0001/consent"),
        write_headers(&hers, &her_csrf),
        Some(json!({ "agreed": true, "reason": "saya setujui sendiri" })),
    )
    .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN, "{:?}", refused.body);

    // Siti can, and only then is anything authorized.
    let (his, his_csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;
    let agreed = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/overtime-orders/OT-0001/consent",
        write_headers(&his, &his_csrf),
        Some(json!({ "agreed": true, "reason": "bersedia" })),
    )
    .await;
    assert_eq!(agreed.status, StatusCode::OK, "consent: {:?}", agreed.body);
    assert_eq!(agreed.body["state"], "AGREED");
    assert_eq!(agreed.body["authorized_minutes"], 120);
    assert_eq!(agreed.body["answered_by"], "siti");
    assert_eq!(agreed.body["answered_reason"], "bersedia");

    // Nor may she order her own evening, by id or as `me`: she would then be
    // the one to agree to it, and the two written acts would be one person's.
    for subject in [rina.as_str(), "me"] {
        let own =
            order_overtime(&app, &hers, &her_csrf, subject, "OT-0009", "2026-04-07", 60).await;
        assert_eq!(
            own.status,
            StatusCode::FORBIDDEN,
            "{subject}: {:?}",
            own.body
        );
    }
}

/// A refusal a sufficiently senior person can reverse is not a refusal.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_declined_order_is_terminal(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    ratify_caps(&app, &cookies, &csrf).await;

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

    let (hers, her_csrf) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;
    order_overtime(&app, &hers, &her_csrf, &siti, "OT-0002", "2026-04-06", 120).await;

    let (his, his_csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;
    let declined = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/overtime-orders/OT-0002/consent",
        write_headers(&his, &his_csrf),
        Some(json!({ "agreed": false, "reason": "ada urusan keluarga" })),
    )
    .await;
    assert_eq!(declined.status, StatusCode::OK, "{:?}", declined.body);
    assert_eq!(declined.body["state"], "DECLINED");
    assert_eq!(declined.body["authorized_minutes"], Value::Null);
    // The refusal keeps her words.
    assert_eq!(declined.body["answered_reason"], "ada urusan keluarga");

    // She cannot change her mind into it, and her manager cannot change it for
    // her.
    let again = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/overtime-orders/OT-0002/consent",
        write_headers(&his, &his_csrf),
        Some(json!({ "agreed": true, "reason": "berubah pikiran" })),
    )
    .await;
    assert_eq!(again.status, StatusCode::CONFLICT, "{:?}", again.body);

    let erased = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/overtime-orders/OT-0002/withdrawal"),
        write_headers(&hers, &her_csrf),
        Some(json!({ "reason": "dihapus saja" })),
    )
    .await;
    assert_eq!(erased.status, StatusCode::CONFLICT, "{:?}", erased.body);
}

/// An order the worker has agreed to is a commitment they may have arranged
/// their life around. An unanswered one is not.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn only_an_unanswered_order_can_be_withdrawn(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    ratify_caps(&app, &cookies, &csrf).await;

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

    let (hers, her_csrf) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;
    order_overtime(&app, &hers, &her_csrf, &siti, "OT-0003", "2026-04-06", 120).await;
    order_overtime(&app, &hers, &her_csrf, &siti, "OT-0004", "2026-04-07", 120).await;

    let withdrawn = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/overtime-orders/OT-0003/withdrawal"),
        write_headers(&hers, &her_csrf),
        Some(json!({ "reason": "stok sudah selesai" })),
    )
    .await;
    assert_eq!(withdrawn.status, StatusCode::OK, "{:?}", withdrawn.body);
    assert_eq!(withdrawn.body["state"], "WITHDRAWN");
    assert_eq!(withdrawn.body["withdrawn_by"], "rina");
    assert_eq!(withdrawn.body["authorized_minutes"], Value::Null);

    // The other one is agreed, and then cannot be taken back.
    let (his, his_csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;
    send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/overtime-orders/OT-0004/consent",
        write_headers(&his, &his_csrf),
        Some(json!({ "agreed": true, "reason": "bersedia" })),
    )
    .await;
    let refused = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/overtime-orders/OT-0004/withdrawal"),
        write_headers(&hers, &her_csrf),
        Some(json!({ "reason": "berubah rencana" })),
    )
    .await;
    assert_eq!(refused.status, StatusCode::CONFLICT, "{:?}", refused.body);
}

/// No default, and the refusal names the missing decision rather than falling
/// back on a figure somebody typed once.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn overtime_cannot_be_ordered_before_the_caps_are_ratified(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

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

    let refused = order_overtime(&app, &hers, &her_csrf, &siti, "OT-0005", "2026-04-06", 120).await;
    assert_eq!(refused.status, StatusCode::CONFLICT, "{:?}", refused.body);

    // And the read says plainly that there is none, rather than inventing four
    // hours because that is the figure today.
    let policy = send(
        app.clone(),
        "GET",
        "/api/v1/overtime-policy",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(policy.status, StatusCode::OK, "{:?}", policy.body);
    assert_eq!(policy.body, Value::Null);

    // A shop manager may not ratify them either: the person who orders overtime
    // is not the person who decides how much of it is lawful.
    let theirs = send(
        app.clone(),
        "POST",
        "/api/v1/overtime-policy",
        write_headers(&hers, &her_csrf),
        Some(json!({
            "version": 1,
            "max_per_day_minutes": 600,
            "max_per_week_minutes": 3000,
            "reason": "biar longgar",
        })),
    )
    .await;
    assert_eq!(theirs.status, StatusCode::FORBIDDEN, "{:?}", theirs.body);
}

/// The daily cap is a bad request — the number in the body is the thing to
/// change. The weekly one is a conflict: nothing about the request needs
/// fixing, the week is full. And only agreed orders fill it.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_caps_bite_and_only_agreed_orders_fill_the_week(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    ratify_caps(&app, &cookies, &csrf).await;

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
    let (hers, her_csrf) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;
    let (his, his_csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;

    // Exactly at the daily cap is within it.
    let ok = order_overtime(&app, &hers, &her_csrf, &siti, "OT-D1", "2026-04-06", 240).await;
    assert_eq!(ok.status, StatusCode::OK, "at the cap: {:?}", ok.body);
    // One minute more is not.
    let over = order_overtime(&app, &hers, &her_csrf, &siti, "OT-D2", "2026-04-07", 241).await;
    assert_eq!(over.status, StatusCode::BAD_REQUEST, "{:?}", over.body);

    // Four more days at the cap: unanswered, they consume nothing.
    for (index, day) in ["2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10"]
        .iter()
        .enumerate()
    {
        let queued = order_overtime(
            &app,
            &hers,
            &her_csrf,
            &siti,
            &format!("OT-U{index}"),
            day,
            240,
        )
        .await;
        assert_eq!(queued.status, StatusCode::OK, "{day}: {:?}", queued.body);
    }
    // 5 × 4h ordered, none agreed but the first. Agreeing to them all would be
    // 20h against a cap of 18, but agreement is not what the cap is checked at
    // — issue is. So a sixth order in the same week is where it bites.
    for index in 0..4 {
        let agreed = send(
            app.clone(),
            "POST",
            &format!("/api/v1/employees/me/overtime-orders/OT-U{index}/consent"),
            write_headers(&his, &his_csrf),
            Some(json!({ "agreed": true, "reason": "bersedia" })),
        )
        .await;
        assert_eq!(
            agreed.status,
            StatusCode::OK,
            "consent {index}: {:?}",
            agreed.body
        );
    }
    // Now 16h are agreed. A fifth 4h order would make 20h.
    let full = order_overtime(&app, &hers, &her_csrf, &siti, "OT-U9", "2026-04-11", 240).await;
    assert_eq!(
        full.status,
        StatusCode::CONFLICT,
        "the week is full: {:?}",
        full.body
    );

    // A shorter one still fits: 16h + 2h = 18h, exactly the cap.
    let fits = order_overtime(&app, &hers, &her_csrf, &siti, "OT-U8", "2026-04-11", 120).await;
    assert_eq!(
        fits.status,
        StatusCode::OK,
        "exactly at the cap: {:?}",
        fits.body
    );
}

/// The bound the Requests queue reads, and the same reach the Directory has.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_manager_sees_only_their_own_shops_unanswered_orders(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    ratify_caps(&app, &cookies, &csrf).await;

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

    // Head office orders one at each shop.
    order_overtime(&app, &cookies, &csrf, &siti, "OT-S7", "2026-04-06", 120).await;
    order_overtime(&app, &cookies, &csrf, &budi, "OT-S3", "2026-04-06", 120).await;

    let (hers, her_csrf) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;
    let queue = send(
        app.clone(),
        "GET",
        "/api/v1/overtime-orders/awaiting",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(queue.status, StatusCode::OK, "{:?}", queue.body);
    let ids: Vec<&str> = queue
        .body
        .as_array()
        .unwrap_or_else(|| panic!("a list"))
        .iter()
        .filter_map(|row| row["id"].as_str())
        .collect();
    assert_eq!(ids, vec!["OT-S7"], "{:?}", queue.body);

    // And she cannot order at a shop she is not posted to.
    let elsewhere = order_overtime(&app, &hers, &her_csrf, &budi, "OT-X", "2026-04-06", 120).await;
    assert_eq!(
        elsewhere.status,
        StatusCode::FORBIDDEN,
        "{:?}",
        elsewhere.body
    );

    // Head office sees both.
    let all = send(
        app.clone(),
        "GET",
        "/api/v1/overtime-orders/awaiting",
        read_headers(&cookies),
        None,
    )
    .await;
    assert_eq!(all.body.as_array().map(Vec::len), Some(2), "{:?}", all.body);
}

/// A holiday ordered as an ordinary day would put the wrong statutory table on
/// the row, and Kepmenaker 102/2004 has a different schedule for each.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_holiday_must_be_ordered_as_one(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    ratify_caps(&app, &cookies, &csrf).await;
    publish_2026(&app, &cookies, &csrf).await;

    let siti = staff_at(&app, &cookies, &csrf, "K0701", "store-07").await;

    // 1 May 2026 is Hari Buruh in the calendar published above.
    let wrong = order_overtime(&app, &cookies, &csrf, &siti, "OT-H1", "2026-05-01", 120).await;
    assert_eq!(wrong.status, StatusCode::BAD_REQUEST, "{:?}", wrong.body);

    let right = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/overtime-orders"),
        write_headers(&cookies, &csrf),
        Some(json!({
            "order_id": "OT-H2",
            "on_date": "2026-05-01",
            "day_kind": "HOLIDAY",
            "planned_minutes": 120,
            "reason": "toko tetap buka",
        })),
    )
    .await;
    assert_eq!(right.status, StatusCode::OK, "{:?}", right.body);
    assert_eq!(right.body["day_kind"], "HOLIDAY");
}
