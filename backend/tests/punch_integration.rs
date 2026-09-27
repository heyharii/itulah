//! Recording your own punch from the phone, and the four things that stops.
//!
//! # Why this exists at all
//!
//! The owner chose a fingerprint station per unit, with no PIN and no card, and
//! reaffirmed it twice. Nothing has been bought, so on 2026-09-13 nobody could
//! clock in anywhere — which means the roster, the derivation, the corrections,
//! the period close and the payroll run had no input to be exercised against.
//! He asked for attendance in the employee app so the HR month can be walked
//! end to end before the readers arrive.
//!
//! So this is a **second punch source**, and every test here is about keeping
//! the two apart rather than about making the second one work. A phone tap must
//! never be able to look like something a reader saw; a cashier must never be
//! able to tap for a colleague; and a double tap must land once.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-punch-1";

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
        node_id: "cloud-punch-test".into(),
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

const SUPERVISOR_PASSWORD: &str = "supervisor-password-punch-1";

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

/// The place-local day, by the same offset the server stamps with.
///
/// WIB, from `reporting::DEFAULT_UTC_OFFSET_MINUTES`, because the handler
/// resolves "which day is it" that way and a test computing it from UTC would
/// disagree with the server for seven hours out of every twenty-four — and only
/// when run in the evening, which is the worst kind of flake.
fn local_today() -> chrono::NaiveDate {
    (chrono::Utc::now()
        + chrono::Duration::minutes(i64::from(
            inventory_backend::reporting::DEFAULT_UTC_OFFSET_MINUTES,
        )))
    .date_naive()
}

/// A lateness policy covering everything, so the fortnight read can derive.
///
/// The punch route itself needs none — a punch is an observation and the policy
/// is what a day is measured against — and that separation is worth stating:
/// somebody can clock in at a company that has not decided what "late" means.
async fn set_policy(app: &axum::Router, cookies: &str, csrf: &str) {
    let written = send(
        app.clone(),
        "POST",
        "/api/v1/attendance-policy",
        write_headers(cookies, csrf),
        Some(json!({
            "effective_from": "2020-01-01",
            "late_grace_minutes": 10,
            "early_leave_grace_minutes": 10,
            "overtime_minimum_minutes": 30,
            "duplicate_punch_window_minutes": 2,
            "reason": "kebijakan awal",
        })),
    )
    .await;
    assert_eq!(written.status, StatusCode::OK, "policy: {:?}", written.body);
}

/// One shift, and today planned against it, so the day has a plan to derive.
async fn roster_today(app: &axum::Router, cookies: &str, csrf: &str, employee_id: &str) {
    let defined = send(
        app.clone(),
        "POST",
        "/api/v1/attendance-shifts",
        write_headers(cookies, csrf),
        Some(json!({
            "id": "PAGI",
            "name": "Pagi",
            "starts_at": "07:00",
            "ends_at": "15:00",
            "unpaid_break_minutes": 60,
        })),
    )
    .await;
    assert_eq!(defined.status, StatusCode::OK, "shift: {:?}", defined.body);

    let planned = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/roster"),
        write_headers(cookies, csrf),
        Some(json!({
            "on_date": local_today().to_string(),
            "plan": "SCHEDULED",
            "shift_id": "PAGI",
            "reason": "jadwal hari ini",
        })),
    )
    .await;
    assert_eq!(planned.status, StatusCode::OK, "roster: {:?}", planned.body);
}

const CASHIER_PASSWORD: &str = "cashier-password-punch-1";

/// A cashier records her own day, and the record says a phone did it.
///
/// The three assertions that matter are `source`, the absent terminal, and the
/// business date resolved by the server rather than sent by the client. A row
/// that said `TERMINAL`, or that named a station, would be the defect this
/// whole source was designed around — the implementation this schema replaced
/// took `source` as free text and defaulted it to `fingerprint`.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_phone_punch_is_recorded_and_never_looks_like_a_reading(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (admin, admin_csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let siti = staff_at(&app, &admin, &admin_csrf, "K0701", "store-07").await;
    login_for(
        &app,
        &admin,
        &admin_csrf,
        &siti,
        "siti",
        "CASHIER",
        CASHIER_PASSWORD,
    )
    .await;
    set_policy(&app, &admin, &admin_csrf).await;
    roster_today(&app, &admin, &admin_csrf, &siti).await;

    let (cookies, csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;
    let punched = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/punches",
        write_headers(&cookies, &csrf),
        // The whole body. No instant, no date, no place, no id.
        Some(json!({ "direction": "IN" })),
    )
    .await;
    assert_eq!(punched.status, StatusCode::OK, "punch: {:?}", punched.body);
    assert_eq!(punched.body["source"], "EMPLOYEE_APP");
    assert_eq!(punched.body["direction"], "IN");
    assert_eq!(punched.body["newly_recorded"], true);
    assert_eq!(
        punched.body["business_date"],
        local_today().to_string(),
        "the server resolves the roster day: {:?}",
        punched.body
    );
    assert_eq!(
        punched.body["place_id"], "store-07",
        "the place comes from the posting, not the body: {:?}",
        punched.body
    );

    // The unit's own day, as a manager reads it. This is the read that would
    // betray a blurred source: the raw observation carries no station at all.
    let today = send(
        app.clone(),
        "GET",
        "/api/v1/attendance/today?place=store-07",
        read_headers(&admin),
        None,
    )
    .await;
    assert_eq!(today.status, StatusCode::OK, "today: {:?}", today.body);
    let raw = &today.body["punches"][0];
    assert_eq!(raw["source"], "EMPLOYEE_APP", "raw: {:?}", today.body);
    assert_eq!(
        raw["terminal_id"],
        Value::Null,
        "a phone punch named a station: {:?}",
        today.body
    );
    // And the unit still says it has no reader, which stays true however many
    // people clock in on their phones.
    assert_eq!(today.body["punch_source_connected"], false);

    // The person's own fortnight says where their day came from.
    let from = local_today() - chrono::Duration::days(13);
    let fortnight = send(
        app.clone(),
        "GET",
        &format!(
            "/api/v1/employees/me/attendance?from={from}&to={}",
            local_today()
        ),
        read_headers(&cookies),
        None,
    )
    .await;
    assert_eq!(
        fortnight.status,
        StatusCode::OK,
        "fortnight: {:?}",
        fortnight.body
    );
    let day = &fortnight.body["days"][0];
    assert_eq!(
        day["date"],
        local_today().to_string(),
        "{:?}",
        fortnight.body
    );
    assert_eq!(
        day["punch_sources"],
        json!(["EMPLOYEE_APP"]),
        "the derived day did not say what produced it: {:?}",
        fortnight.body
    );
    assert_eq!(day["punches_considered"], 1);
}

/// A double tap lands once.
///
/// The mechanism is the terminal path's own: the identity collides and the
/// insert does nothing. `newly_recorded: false` is the honest answer — not an
/// error, because pressing twice is not a mistake anybody should be scolded
/// for, and not a silent success, because the person deserves to know the
/// second press changed nothing.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_double_tap_lands_once(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (admin, admin_csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    let siti = staff_at(&app, &admin, &admin_csrf, "K0701", "store-07").await;
    login_for(
        &app,
        &admin,
        &admin_csrf,
        &siti,
        "siti",
        "CASHIER",
        CASHIER_PASSWORD,
    )
    .await;
    let (cookies, csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;

    let first = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/punches",
        write_headers(&cookies, &csrf),
        Some(json!({ "direction": "IN" })),
    )
    .await;
    assert_eq!(first.status, StatusCode::OK, "first: {:?}", first.body);
    assert_eq!(first.body["newly_recorded"], true);

    let again = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/punches",
        write_headers(&cookies, &csrf),
        Some(json!({ "direction": "IN" })),
    )
    .await;
    assert_eq!(again.status, StatusCode::OK, "again: {:?}", again.body);
    assert_eq!(again.body["newly_recorded"], false);
    assert_eq!(
        again.body["punch_id"], first.body["punch_id"],
        "a second tap in the same minute minted a second identity: {:?}",
        again.body
    );

    let stored: i64 = sqlx::query_scalar("SELECT count(*) FROM attendance_punch")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(stored, 1, "the double tap became two punches");
}

/// Nobody punches for anybody else, at either rung.
///
/// Two refusals, and they come from two different places on purpose. A cashier
/// naming a colleague is stopped by the **path gate** — `/employees/{id}/…` is
/// Supervisor work unless the id is `me` — and a supervisor, who passes that
/// gate, is stopped by the **handler**, because the bound on this key is the
/// record and not the rung.
///
/// The second one is the load-bearing test. Every signed-in person holds
/// `people.attendance_punch.record_own`, so without `Access::own` a shop
/// manager could clock their whole floor in from the back office — which is the
/// shape the two-key split in `domain::employment::audit` exists to refuse.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_punch_for_somebody_else_is_refused(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (admin, admin_csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let siti = staff_at(&app, &admin, &admin_csrf, "K0701", "store-07").await;
    let rina = staff_at(&app, &admin, &admin_csrf, "K0700", "store-07").await;
    login_for(
        &app,
        &admin,
        &admin_csrf,
        &siti,
        "siti",
        "CASHIER",
        CASHIER_PASSWORD,
    )
    .await;
    login_for(
        &app,
        &admin,
        &admin_csrf,
        &rina,
        "rina",
        "SUPERVISOR",
        SUPERVISOR_PASSWORD,
    )
    .await;

    let (cashier, cashier_csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;
    let by_cashier = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{rina}/punches"),
        write_headers(&cashier, &cashier_csrf),
        Some(json!({ "direction": "IN" })),
    )
    .await;
    assert_eq!(
        by_cashier.status,
        StatusCode::FORBIDDEN,
        "a cashier punched for a colleague: {:?}",
        by_cashier.body
    );

    let (supervisor, supervisor_csrf) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;
    let by_supervisor = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/punches"),
        write_headers(&supervisor, &supervisor_csrf),
        Some(json!({ "direction": "IN" })),
    )
    .await;
    assert_eq!(
        by_supervisor.status,
        StatusCode::FORBIDDEN,
        "a supervisor punched for their staff: {:?}",
        by_supervisor.body
    );
    // The refusal says what to do instead, because wanting to record somebody
    // else's day is a legitimate wish with a legitimate route: a correction,
    // which another person decides.
    let said = by_supervisor.body["error"]
        .as_str()
        .or_else(|| by_supervisor.body["message"].as_str())
        .unwrap_or_default()
        .to_owned();
    assert!(
        said.contains("correction"),
        "the refusal did not point at the correction route: {:?}",
        by_supervisor.body
    );

    // And nothing landed either way.
    let stored: i64 = sqlx::query_scalar("SELECT count(*) FROM attendance_punch")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(stored, 0, "a refused punch was stored anyway");
}

/// Somebody with no posting cannot punch, and is told why.
///
/// A conflict rather than a 403 or a silent success: the request is well formed
/// and the caller is entitled to make it, but there is no unit whose day this
/// would belong to — and the fix is HR's paperwork rather than a retry. The
/// same refusal `enrol_finger` gives, for the same reason.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_punch_needs_somewhere_to_belong(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (admin, admin_csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    // Registered and hired, and never posted anywhere.
    let registered = send(
        app.clone(),
        "POST",
        "/api/v1/employees",
        write_headers(&admin, &admin_csrf),
        Some(json!({ "employee_code": "K9999" })),
    )
    .await;
    assert_eq!(
        registered.status,
        StatusCode::OK,
        "register: {:?}",
        registered.body
    );
    let nobody = registered.body["employee_id"]
        .as_str()
        .unwrap_or_else(|| panic!("employee_id: {:?}", registered.body))
        .to_owned();
    login_for(
        &app,
        &admin,
        &admin_csrf,
        &nobody,
        "baru",
        "CASHIER",
        CASHIER_PASSWORD,
    )
    .await;

    let (cookies, csrf) = sign_in(&app, "baru", CASHIER_PASSWORD).await;
    let refused = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/punches",
        write_headers(&cookies, &csrf),
        Some(json!({ "direction": "IN" })),
    )
    .await;
    assert_eq!(
        refused.status,
        StatusCode::CONFLICT,
        "an unposted punch: {:?}",
        refused.body
    );
}
