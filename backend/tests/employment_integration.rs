//! Employment, from HR hiring somebody to that person reading their own record.
//!
//! The point of this file is the two halves that are easy to get separately
//! right and together wrong. HR writes an employment record over HTTP with a
//! session and an authority; the employee app then reads *the same record*
//! through `me`, as a cashier, on a route whose officer-facing form is
//! admin-only. A test that only drove the HR side would not prove the employee
//! app can see anything; one that only drove the reads would not prove that
//! hiring somebody records who decided it.
//!
//! The last test is the one that matters most and looks the least like a
//! feature: it edits `employee.status` in the database, the way somebody would
//! in `psql`, and asserts the record then refuses to load. Status is a fold
//! over history, and a fold nobody re-runs is just a column.

use axum::body::{to_bytes, Body};
use chrono::{Duration, Utc};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-employment-1";
const CASHIER_PASSWORD: &str = "cashier-password-employment-1";

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

/// The two headers a browser sends on a write: the session cookie, and the
/// CSRF token echoed out of its own cookie.
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
        node_id: "cloud-employment-test".into(),
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

/// Sign in and return the pair of headers every write below needs.
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

/// Register a candidate and hire them, which is the shortest path to an
/// employment record anything else can hang off.
async fn hire(app: &axum::Router, cookies: &str, csrf: &str, code: &str) -> String {
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
    assert_eq!(registered.body["status"], "CANDIDATE");

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
            "effective_on": "2026-01-06",
            "reason": "mulai bekerja sebagai kasir",
        })),
    )
    .await;
    assert_eq!(hired.status, StatusCode::OK, "hire: {:?}", hired.body);
    assert_eq!(hired.body["status"], "ACTIVE");
    // The decision is recorded, not just its effect.
    assert_eq!(hired.body["history"][0]["transition"], "HIRE");
    assert_eq!(hired.body["history"][0]["actor"], "admin");
    assert_eq!(
        hired.body["history"][0]["reason"],
        "mulai bekerja sebagai kasir"
    );

    employee_id
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn hr_hires_somebody_and_that_person_can_read_their_own_record(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let employee_id = hire(&app, &cookies, &csrf, "K0001").await;

    // Posted to a shop. `store-01` is an `org_place` because migration 0060
    // seeded one per site.
    let assigned = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/assignments"),
        write_headers(&cookies, &csrf),
        Some(json!({
            "place_id": "store-01",
            "valid_from": "2026-01-06",
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
    assert_eq!(assigned.body["current_place_id"], "store-01");

    // Personal data, on its own route.
    let enrolled = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/personal-data"),
        write_headers(&cookies, &csrf),
        Some(json!({
            "full_name": "Siti Rahayu",
            "nik": "3174051234500012",
            "birth_date": "1998-05-12",
            "address": "Jl. Merdeka 17, Bandung",
        })),
    )
    .await;
    assert_eq!(
        enrolled.status,
        StatusCode::OK,
        "enrol profile: {:?}",
        enrolled.body
    );

    // A fixed term, which must say when it ends.
    //
    // Dated relative to today rather than written down, because `in_force`
    // below is asked as of now: a hard-coded term would stop being in force at
    // some point after this test was written and fail for a reason that has
    // nothing to do with the code.
    let today = Utc::now().date_naive();
    let started = today - Duration::days(60);
    let ends = today + Duration::days(120);
    let contract = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/contracts"),
        write_headers(&cookies, &csrf),
        Some(json!({
            "kind": "PKWT",
            "starts_on": started.to_string(),
            "ends_on": ends.to_string(),
            "position": "Kasir",
            "grade": "G1",
            "reason": "kontrak pertama",
        })),
    )
    .await;
    assert_eq!(
        contract.status,
        StatusCode::OK,
        "contract: {:?}",
        contract.body
    );
    assert_eq!(contract.body["contracts"][0]["kind"], "PKWT");
    assert_eq!(contract.body["pkwt_run"]["terms"], 1);

    // A login for her, and the binding between the two identities.
    let created = send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        write_headers(&cookies, &csrf),
        Some(json!({
            "username": "siti",
            "display_name": "Siti Rahayu",
            "password": CASHIER_PASSWORD,
            "role": "CASHIER",
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
        write_headers(&cookies, &csrf),
        Some(json!({ "username": "siti", "reason": "akun kasir untuk Siti" })),
    )
    .await;
    assert_eq!(linked.status, StatusCode::OK, "link: {:?}", linked.body);

    // ── and now as Siti, through the employee app ───────────────────────
    let (her_cookies, _) = sign_in(&app, "siti", CASHIER_PASSWORD).await;

    // `me` resolves from her session. She is a cashier, and reading a NIK is
    // otherwise an admin privilege — but it is her own NIK.
    // The screen that shows job title and place. No NIK on it, by design.
    let profile = send(
        app.clone(),
        "GET",
        "/api/v1/employees/me/profile",
        read_headers(&her_cookies),
        None,
    )
    .await;
    assert_eq!(
        profile.status,
        StatusCode::OK,
        "her employment profile: {:?}",
        profile.body
    );
    assert_eq!(profile.body["employee_code"], "K0001");
    assert_eq!(profile.body["job_title"], "Kasir");
    assert_eq!(profile.body["place_name"], "Store 01");
    // Derived from the first HIRE, not stored beside it.
    assert_eq!(profile.body["joined_on"], "2026-01-06");
    // The whole reason these are two routes: a work profile carries no
    // national identity number, even for its own holder.
    assert!(
        profile.body.get("nik").is_none(),
        "a NIK reached the work profile: {:?}",
        profile.body
    );

    // Her own personal data, on the route that is meant to carry it.
    let own = send(
        app.clone(),
        "GET",
        "/api/v1/employees/me/personal-data",
        read_headers(&her_cookies),
        None,
    )
    .await;
    assert_eq!(
        own.status,
        StatusCode::OK,
        "her own personal data: {:?}",
        own.body
    );
    assert_eq!(own.body["full_name"], "Siti Rahayu");
    assert_eq!(own.body["nik"], "3174051234500012");

    let own_contracts = send(
        app.clone(),
        "GET",
        "/api/v1/employees/me/contracts",
        read_headers(&her_cookies),
        None,
    )
    .await;
    assert_eq!(own_contracts.status, StatusCode::OK);
    assert_eq!(own_contracts.body["contracts"][0]["position"], "Kasir");
    assert_eq!(own_contracts.body["contracts"][0]["in_force"], true);

    // The workforce list is not hers to read, though.
    let list = send(
        app.clone(),
        "GET",
        "/api/v1/employees",
        read_headers(&her_cookies),
        None,
    )
    .await;
    assert_eq!(
        list.status,
        StatusCode::FORBIDDEN,
        "a cashier reading the workforce: {:?}",
        list.body
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn one_persons_own_record_does_not_open_anybody_elses(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let hers = hire(&app, &cookies, &csrf, "K0001").await;
    let his = hire(&app, &cookies, &csrf, "K0002").await;

    for id in [&hers, &his] {
        let enrolled = send(
            app.clone(),
            "POST",
            &format!("/api/v1/employees/{id}/personal-data"),
            write_headers(&cookies, &csrf),
            Some(json!({
                "full_name": "Orang Uji",
                "nik": "3174051234500012",
                "birth_date": "1998-05-12",
                "address": "Jl. Merdeka 17, Bandung",
            })),
        )
        .await;
        assert_eq!(
            enrolled.status,
            StatusCode::OK,
            "enrol: {:?}",
            enrolled.body
        );
    }

    send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        write_headers(&cookies, &csrf),
        Some(json!({
            "username": "siti",
            "display_name": "Siti Rahayu",
            "password": CASHIER_PASSWORD,
            "role": "CASHIER",
        })),
    )
    .await;
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{hers}/account"),
        write_headers(&cookies, &csrf),
        Some(json!({ "username": "siti", "reason": "akun kasir untuk Siti" })),
    )
    .await;

    let (her_cookies, _) = sign_in(&app, "siti", CASHIER_PASSWORD).await;

    // Her own: fine.
    let own = send(
        app.clone(),
        "GET",
        &format!("/api/v1/employees/{hers}/personal-data"),
        read_headers(&her_cookies),
        None,
    )
    .await;
    assert_eq!(own.status, StatusCode::OK, "her own by id: {:?}", own.body);

    // Somebody else's, by id, on the same route: refused. This is the whole
    // reason personal data has its own key — a rota screen must not become a
    // way to read sixteen digits of national identity number.
    let his_profile = send(
        app.clone(),
        "GET",
        &format!("/api/v1/employees/{his}/personal-data"),
        read_headers(&her_cookies),
        None,
    )
    .await;
    assert_eq!(
        his_profile.status,
        StatusCode::FORBIDDEN,
        "somebody else's NIK: {:?}",
        his_profile.body
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_fixed_term_that_does_not_say_when_it_ends_is_refused(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    let employee_id = hire(&app, &cookies, &csrf, "K0001").await;

    // UU 13/2003 art. 59: a PKWT is a fixed term and must carry its end date.
    let open_ended_pkwt = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/contracts"),
        write_headers(&cookies, &csrf),
        Some(json!({
            "kind": "PKWT",
            "starts_on": "2026-01-06",
            "position": "Kasir",
            "grade": "G1",
            "reason": "kontrak pertama",
        })),
    )
    .await;
    assert_eq!(
        open_ended_pkwt.status,
        StatusCode::BAD_REQUEST,
        "PKWT without an end date: {:?}",
        open_ended_pkwt.body
    );

    // And the mirror: a permanent contract has nowhere to put one.
    let bounded_pkwtt = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/contracts"),
        write_headers(&cookies, &csrf),
        Some(json!({
            "kind": "PKWTT",
            "starts_on": "2026-01-06",
            "ends_on": "2027-01-05",
            "position": "Kasir",
            "grade": "G1",
            "reason": "kontrak tetap",
        })),
    )
    .await;
    assert_eq!(
        bounded_pkwtt.status,
        StatusCode::BAD_REQUEST,
        "PKWTT with an end date: {:?}",
        bounded_pkwtt.body
    );
}

/// The test the whole design exists for.
///
/// `employee.status` is a column, and a column can be edited. If nothing
/// re-runs the fold, the edit becomes the answer and the history beside it
/// becomes decoration. So: hire somebody, set their status to TERMINATED
/// behind the application's back, and read them back.
///
/// The right outcome is a refusal. A record whose history does not produce its
/// claimed status is not a record with a wrong field — it is not a record.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_status_the_history_does_not_produce_refuses_to_load(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    let employee_id = hire(&app, &cookies, &csrf, "K0001").await;

    // She loads fine while the two agree.
    let before = send(
        app.clone(),
        "GET",
        &format!("/api/v1/employees/{employee_id}"),
        read_headers(&cookies),
        None,
    )
    .await;
    assert_eq!(before.status, StatusCode::OK);
    assert_eq!(before.body["status"], "ACTIVE");

    // What somebody would type in psql to "fix" a record.
    sqlx::query("UPDATE employee SET status = 'TERMINATED' WHERE id = $1")
        .bind(&employee_id)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("tamper: {error}"));

    let after = send(
        app.clone(),
        "GET",
        &format!("/api/v1/employees/{employee_id}"),
        read_headers(&cookies),
        None,
    )
    .await;
    assert_ne!(
        after.status,
        StatusCode::OK,
        "a tampered row loaded anyway, and served: {:?}",
        after.body
    );
    // And it must not have served the tampered value as if it were true.
    assert_ne!(after.body["status"], "TERMINATED");

    // And here is the honest limit of the guard, asserted rather than hidden.
    //
    // The workforce list reads `employee.status` straight out of the column,
    // because that is the entire reason the column exists — "who is employed"
    // has to be an index scan, not a fold over every person's history. So the
    // list DOES show the tampered value while the detail route refuses it.
    //
    // That is the accepted cost of the denormalisation, and it is safe only
    // because nothing but the fold writes that column through the application.
    // It is written down here so that nobody later reads this test as a promise
    // the design does not make: the guard catches a tampered row when the
    // record is loaded, not when it is counted.
    let listed = send(
        app.clone(),
        "GET",
        "/api/v1/employees",
        read_headers(&cookies),
        None,
    )
    .await;
    assert_eq!(listed.status, StatusCode::OK, "list: {:?}", listed.body);
    assert_eq!(
        listed.body[0]["status"], "TERMINATED",
        "the projection reads the column, and the column was tampered with"
    );
}

// ── reach: which places a caller may act in ───────────────────────────────
//
// A rung answers *what* somebody may do; it cannot answer *where*, because
// every shop manager holds the same rung. Until this bound arrived, a
// supervisor at any store could page through the whole company's workforce and
// read any rota in it — a gap nobody had noticed only because head office was
// the only caller of the route.
//
// These three mirror the domain tests in `employment::reach`, at the level that
// actually matters: over HTTP, with a real session, against a real posting.

/// Post somebody, give them a login at a rung, and bind the two.
///
/// Returns the cookies for that person's own session, which is what every
/// assertion below is made through: the point is what a supervisor sees when
/// they sign in, not what the admin who set them up can see.
async fn supervisor_at(
    app: &axum::Router,
    cookies: &str,
    csrf: &str,
    username: &str,
    code: &str,
    place_id: Option<&str>,
    role: &str,
) -> String {
    let employee_id = hire(app, cookies, csrf, code).await;
    if let Some(place_id) = place_id {
        let assigned = send(
            app.clone(),
            "POST",
            &format!("/api/v1/employees/{employee_id}/assignments"),
            write_headers(cookies, csrf),
            Some(json!({
                "place_id": place_id,
                "valid_from": "2026-01-06",
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
    }
    let created = send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        write_headers(cookies, csrf),
        Some(json!({
            "username": username,
            "display_name": username,
            "password": SUPERVISOR_PASSWORD,
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
        Some(json!({ "username": username, "reason": "akun untuk manajer toko" })),
    )
    .await;
    assert_eq!(linked.status, StatusCode::OK, "link: {:?}", linked.body);
    employee_id
}

const SUPERVISOR_PASSWORD: &str = "supervisor-password-employment-1";

/// Somebody to be found in a shop, so a bounded list has something to omit.
async fn staff_at(
    app: &axum::Router,
    cookies: &str,
    csrf: &str,
    code: &str,
    place_id: &str,
) -> String {
    let employee_id = hire(app, cookies, csrf, code).await;
    let assigned = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/assignments"),
        write_headers(cookies, csrf),
        Some(json!({
            "place_id": place_id,
            "valid_from": "2026-01-06",
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

fn codes(body: &Value) -> Vec<String> {
    body.as_array()
        .unwrap_or_else(|| panic!("a list: {body:?}"))
        .iter()
        .map(|row| row["employee_code"].as_str().unwrap_or_default().to_owned())
        .collect()
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_supervisor_reaches_only_the_shop_they_are_posted_to(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let mine = staff_at(&app, &cookies, &csrf, "K0701", "store-07").await;
    let theirs = staff_at(&app, &cookies, &csrf, "K0301", "store-03").await;
    supervisor_at(
        &app,
        &cookies,
        &csrf,
        "rina",
        "K0700",
        Some("store-07"),
        "SUPERVISOR",
    )
    .await;

    let (hers, _) = sign_in(&app, "rina", SUPERVISOR_PASSWORD).await;

    // What the sidebar reads to decide which face of People to draw.
    let reach = send(
        app.clone(),
        "GET",
        "/api/v1/employees/me/reach",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(reach.status, StatusCode::OK, "reach: {:?}", reach.body);
    assert_eq!(reach.body["scope"], "ONE_PLACE");
    assert_eq!(reach.body["place_id"], "store-07");
    assert_eq!(reach.body["place_kind"], "STORE");
    assert_eq!(reach.body["role"], "SUPERVISOR");

    // The list is her shop, and only her shop.
    let listed = send(
        app.clone(),
        "GET",
        "/api/v1/employees",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(listed.status, StatusCode::OK, "list: {:?}", listed.body);
    let seen = codes(&listed.body);
    assert!(seen.contains(&"K0701".to_owned()), "her own shop: {seen:?}");
    assert!(seen.contains(&"K0700".to_owned()), "herself: {seen:?}");
    assert!(
        !seen.contains(&"K0301".to_owned()),
        "store-03 must not be in a store-07 manager's list: {seen:?}"
    );

    // And asking for somebody else's shop is refused rather than quietly
    // re-filtered: answering a different question than the one asked is how
    // somebody concludes two shops have the same staff.
    let elsewhere = send(
        app.clone(),
        "GET",
        "/api/v1/employees?place_id=store-03",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(
        elsewhere.status,
        StatusCode::FORBIDDEN,
        "store-03: {:?}",
        elsewhere.body
    );

    // One record at a time, the same bound.
    let ours = send(
        app.clone(),
        "GET",
        &format!("/api/v1/employees/{mine}"),
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(ours.status, StatusCode::OK, "own shop: {:?}", ours.body);

    for route in ["", "/profile", "/contracts"] {
        let refused = send(
            app.clone(),
            "GET",
            &format!("/api/v1/employees/{theirs}{route}"),
            read_headers(&hers),
            None,
        )
        .await;
        assert_eq!(
            refused.status,
            StatusCode::FORBIDDEN,
            "another shop's {route:?}: {:?}",
            refused.body
        );
    }

    // Head office still sees everybody. The bound is on the rung below it, not
    // on the employer.
    let all = send(
        app.clone(),
        "GET",
        "/api/v1/employees",
        read_headers(&cookies),
        None,
    )
    .await;
    let seen = codes(&all.body);
    assert!(
        seen.contains(&"K0301".to_owned()),
        "admin sees all: {seen:?}"
    );
    assert!(
        seen.contains(&"K0701".to_owned()),
        "admin sees all: {seen:?}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_supervisor_with_no_posting_reaches_nothing(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let somebody = staff_at(&app, &cookies, &csrf, "K0701", "store-07").await;

    // A login with an employment record and no posting: hired, paperwork not
    // finished. The safe reading of "we do not know where this person works"
    // is not "everywhere".
    supervisor_at(&app, &cookies, &csrf, "budi", "K9000", None, "SUPERVISOR").await;
    let (his, _) = sign_in(&app, "budi", SUPERVISOR_PASSWORD).await;

    let reach = send(
        app.clone(),
        "GET",
        "/api/v1/employees/me/reach",
        read_headers(&his),
        None,
    )
    .await;
    assert_eq!(reach.status, StatusCode::OK, "reach: {:?}", reach.body);
    assert_eq!(reach.body["scope"], "NOWHERE");
    assert_eq!(reach.body["place_id"], Value::Null);
    // The record exists; it is the posting that does not.
    assert!(reach.body["employee_id"].is_string());

    for route in ["/api/v1/employees", "/api/v1/employees/contracts/expiring"] {
        let refused = send(app.clone(), "GET", route, read_headers(&his), None).await;
        assert_eq!(
            refused.status,
            StatusCode::FORBIDDEN,
            "{route}: {:?}",
            refused.body
        );
    }

    let refused = send(
        app.clone(),
        "GET",
        &format!("/api/v1/employees/{somebody}"),
        read_headers(&his),
        None,
    )
    .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN, "{:?}", refused.body);

    // But his own record is still his. A new joiner whose posting has not been
    // filed must not be locked out of the app that shows it to them.
    let own = send(
        app.clone(),
        "GET",
        "/api/v1/employees/me/profile",
        read_headers(&his),
        None,
    )
    .await;
    assert_eq!(own.status, StatusCode::OK, "own profile: {:?}", own.body);
    assert_eq!(own.body["employee_code"], "K9000");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn head_office_reaches_every_place_without_being_admin(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    staff_at(&app, &cookies, &csrf, "K0701", "store-07").await;
    staff_at(&app, &cookies, &csrf, "K0301", "store-03").await;
    // An HR assistant: supervisor rung, posted to head office. Head office is
    // the employer in this model rather than a fourteenth shop, so the whole
    // workforce is what they administer.
    supervisor_at(
        &app,
        &cookies,
        &csrf,
        "dewi",
        "K0001",
        Some("ho"),
        "SUPERVISOR",
    )
    .await;

    let (hers, _) = sign_in(&app, "dewi", SUPERVISOR_PASSWORD).await;

    let reach = send(
        app.clone(),
        "GET",
        "/api/v1/employees/me/reach",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(reach.status, StatusCode::OK, "reach: {:?}", reach.body);
    assert_eq!(reach.body["scope"], "EVERYWHERE");
    assert_eq!(reach.body["place_id"], "ho");
    assert_eq!(reach.body["place_kind"], "HO");
    assert_eq!(reach.body["place_name"], "Head Office");
    assert_eq!(reach.body["role"], "SUPERVISOR");

    let listed = send(
        app.clone(),
        "GET",
        "/api/v1/employees",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(listed.status, StatusCode::OK, "list: {:?}", listed.body);
    let seen = codes(&listed.body);
    assert!(seen.contains(&"K0701".to_owned()), "{seen:?}");
    assert!(seen.contains(&"K0301".to_owned()), "{seen:?}");

    // Including one shop at a time, which a bounded caller cannot do.
    let one = send(
        app.clone(),
        "GET",
        "/api/v1/employees?place_id=store-03",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(one.status, StatusCode::OK, "one place: {:?}", one.body);
    assert_eq!(codes(&one.body), vec!["K0301".to_owned()]);

    // Reading is not deciding. The rung is still what stops her ending
    // somebody's employment, and head office's reach does not touch it.
    let refused = send(
        app.clone(),
        "POST",
        &format!(
            "/api/v1/employees/{}/employment",
            listed.body[0]["employee_id"].as_str().unwrap_or_default()
        ),
        read_headers(&hers),
        Some(json!({
            "transition": "TERMINATE",
            "effective_on": "2026-06-30",
            "reason": "percobaan",
        })),
    )
    .await;
    assert_ne!(
        refused.status,
        StatusCode::OK,
        "a supervisor may not terminate: {:?}",
        refused.body
    );
}

// ── the login and the employment record are one person ──────────────────────
//
// 0060 joined `app_user` to `employee` and left the join inert: HR could bind a
// login to a record and nothing else in the system cared. The four tests below
// are the four ways that mattered.

/// Create a login and bind it to an employment record, returning the username.
async fn login_for(
    app: &axum::Router,
    cookies: &str,
    csrf: &str,
    employee_id: &str,
    username: &str,
    password: &str,
) -> String {
    let created = send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        write_headers(cookies, csrf),
        Some(json!({
            "username": username,
            "display_name": username,
            "password": password,
            "role": "CASHIER",
        })),
    )
    .await;
    assert_eq!(
        created.status,
        StatusCode::OK,
        "create {username}: {:?}",
        created.body
    );

    let linked = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/account"),
        write_headers(cookies, csrf),
        Some(json!({ "username": username, "reason": "akun untuk pegawai baru" })),
    )
    .await;
    assert_eq!(linked.status, StatusCode::OK, "link: {:?}", linked.body);
    assert_eq!(linked.body["account"]["username"], username);
    assert_eq!(linked.body["account"]["active"], true);
    // The binding says who decided it. Nothing else records this: the activity
    // log keeps request bodies out, and the username being bound is in one.
    assert_eq!(linked.body["account"]["linked_by"], "admin");
    assert_eq!(
        linked.body["account"]["link_reason"],
        "akun untuk pegawai baru"
    );
    username.to_owned()
}

/// The test 0060 wrote a comment about and nobody wrote the code for.
///
/// *"The account is disabled by the code that handles leaving, in daylight."*
/// There was no such code: terminating somebody recorded an employment event
/// and left their credential working. This walks the whole distance — she signs
/// in, she is terminated, the session she already held stops working and a new
/// one cannot be had.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn leaving_closes_the_login_it_was_bound_to(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let employee_id = hire(&app, &cookies, &csrf, "K0001").await;
    login_for(
        &app,
        &cookies,
        &csrf,
        &employee_id,
        "siti",
        CASHIER_PASSWORD,
    )
    .await;

    // She has a working session before any of this.
    let (her_cookies, _) = sign_in(&app, "siti", CASHIER_PASSWORD).await;
    let before = send(
        app.clone(),
        "GET",
        "/api/v1/employees/me/profile",
        read_headers(&her_cookies),
        None,
    )
    .await;
    assert_eq!(before.status, StatusCode::OK, "before: {:?}", before.body);

    let left = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/employment"),
        write_headers(&cookies, &csrf),
        Some(json!({
            "transition": "TERMINATE",
            "effective_on": "2026-03-31",
            "reason": "mengundurkan diri",
        })),
    )
    .await;
    assert_eq!(left.status, StatusCode::OK, "terminate: {:?}", left.body);
    assert_eq!(left.body["status"], "TERMINATED");
    // The answer says the door is shut, in the same breath as saying she left.
    assert_eq!(left.body["account"]["username"], "siti");
    assert_eq!(left.body["account"]["active"], false);

    // The session she was already holding is gone, not merely un-renewable.
    let after = send(
        app.clone(),
        "GET",
        "/api/v1/employees/me/profile",
        read_headers(&her_cookies),
        None,
    )
    .await;
    assert_eq!(
        after.status,
        StatusCode::UNAUTHORIZED,
        "her old session after leaving: {:?}",
        after.body
    );

    // And she cannot get a new one.
    let again = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        vec![],
        Some(json!({ "username": "siti", "password": CASHIER_PASSWORD })),
    )
    .await;
    assert_eq!(
        again.status,
        StatusCode::UNAUTHORIZED,
        "signing in after leaving: {:?}",
        again.body
    );

    // The accounts console knows whose credential this was. Before the join it
    // listed a username and nothing else, so "which of these belong to somebody
    // who has left" was a question the screen could not answer at all.
    let accounts = send(
        app.clone(),
        "GET",
        "/api/v1/auth/users",
        read_headers(&cookies),
        None,
    )
    .await;
    assert_eq!(
        accounts.status,
        StatusCode::OK,
        "list users: {:?}",
        accounts.body
    );
    let hers = accounts.body["items"]
        .as_array()
        .unwrap_or_else(|| panic!("items: {:?}", accounts.body))
        .iter()
        .find(|row| row["username"] == "siti")
        .unwrap_or_else(|| panic!("siti is listed: {:?}", accounts.body))
        .clone();
    assert_eq!(hers["employee_id"], employee_id);
    assert_eq!(hers["employee_code"], "K0001");
    assert_eq!(hers["employee_status"], "TERMINATED");
    assert_eq!(hers["active"], false);

    // And the admin account beside hers belongs to nobody, which is a fact
    // about it rather than a gap in the answer.
    let machine = accounts.body["items"]
        .as_array()
        .unwrap_or_else(|| panic!("items: {:?}", accounts.body))
        .iter()
        .find(|row| row["username"] == "admin")
        .unwrap_or_else(|| panic!("admin is listed: {:?}", accounts.body))
        .clone();
    assert!(machine["employee_id"].is_null(), "admin: {machine:?}");
}

/// Suspension closes the door too, and coming back does not reopen it.
///
/// Somebody stood down pending an investigation who can still sign into a till
/// has been sent home from the shop and not from the system. Reinstating them
/// restores their employment and deliberately not their credential: handing a
/// credential back is its own decision, with its own actor, in System >
/// Accounts. The view says so rather than leaving anyone to guess.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn suspension_closes_the_login_and_reinstatement_does_not_reopen_it(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let employee_id = hire(&app, &cookies, &csrf, "K0001").await;
    login_for(
        &app,
        &cookies,
        &csrf,
        &employee_id,
        "siti",
        CASHIER_PASSWORD,
    )
    .await;

    let stood_down = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/employment"),
        write_headers(&cookies, &csrf),
        Some(json!({
            "transition": "SUSPEND",
            "effective_on": "2026-02-01",
            "reason": "pemeriksaan selisih kas",
        })),
    )
    .await;
    assert_eq!(
        stood_down.status,
        StatusCode::OK,
        "suspend: {:?}",
        stood_down.body
    );
    assert_eq!(stood_down.body["account"]["active"], false);

    let back = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/employment"),
        write_headers(&cookies, &csrf),
        Some(json!({
            "transition": "REINSTATE",
            "effective_on": "2026-02-14",
            "reason": "pemeriksaan selesai, tidak terbukti",
        })),
    )
    .await;
    assert_eq!(back.status, StatusCode::OK, "reinstate: {:?}", back.body);
    assert_eq!(back.body["status"], "ACTIVE");
    assert_eq!(
        back.body["account"]["active"], false,
        "employment came back; the credential is somebody's decision to return"
    );
}

/// The silent identity swap the old implementation allowed.
///
/// `UPDATE app_user SET employee_id = $2 WHERE username = $1` moved an account
/// from one person to another with nothing anywhere recording that the first
/// person had lost it — and the unique index could not catch it, because it
/// guards one login per employee and this is one employee per login.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_login_is_not_taken_from_the_person_it_already_belongs_to(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let hers = hire(&app, &cookies, &csrf, "K0001").await;
    let his = hire(&app, &cookies, &csrf, "K0002").await;
    login_for(&app, &cookies, &csrf, &hers, "siti", CASHIER_PASSWORD).await;

    let stolen = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{his}/account"),
        write_headers(&cookies, &csrf),
        Some(json!({ "username": "siti", "reason": "salah orang" })),
    )
    .await;
    assert_eq!(
        stolen.status,
        StatusCode::CONFLICT,
        "binding somebody else's login: {:?}",
        stolen.body
    );

    // Hers, still.
    let still = send(
        app.clone(),
        "GET",
        &format!("/api/v1/employees/{hers}"),
        read_headers(&cookies),
        None,
    )
    .await;
    assert_eq!(still.body["account"]["username"], "siti");
    let nothing = send(
        app.clone(),
        "GET",
        &format!("/api/v1/employees/{his}"),
        read_headers(&cookies),
        None,
    )
    .await;
    assert!(
        nothing.body["account"].is_null(),
        "he has no login: {:?}",
        nothing.body
    );
}

/// A binding is releasable, and a released login can be given to the right
/// person. Without this the refusal above would turn every typo permanent.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_login_bound_to_the_wrong_person_can_be_released_and_rebound(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let wrong = hire(&app, &cookies, &csrf, "K0001").await;
    let right = hire(&app, &cookies, &csrf, "K0002").await;
    login_for(&app, &cookies, &csrf, &wrong, "siti", CASHIER_PASSWORD).await;

    let released = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{wrong}/account/release"),
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "akun ini milik pegawai lain" })),
    )
    .await;
    assert_eq!(
        released.status,
        StatusCode::OK,
        "release: {:?}",
        released.body
    );
    assert!(released.body["account"].is_null());

    let rebound = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{right}/account"),
        write_headers(&cookies, &csrf),
        Some(json!({ "username": "siti", "reason": "pemilik akun yang sebenarnya" })),
    )
    .await;
    assert_eq!(rebound.status, StatusCode::OK, "rebind: {:?}", rebound.body);
    assert_eq!(rebound.body["account"]["username"], "siti");

    // Releasing does not close the account: it says the credential is not this
    // person's, which is usually because it never was.
    let (_, _) = sign_in(&app, "siti", CASHIER_PASSWORD).await;
}

/// A credential is not issued to somebody whose employment is over — the state
/// the rest of this file is busy taking one away from.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_login_is_not_bound_to_somebody_who_has_left(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let employee_id = hire(&app, &cookies, &csrf, "K0001").await;
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/employment"),
        write_headers(&cookies, &csrf),
        Some(json!({
            "transition": "TERMINATE",
            "effective_on": "2026-03-31",
            "reason": "mengundurkan diri",
        })),
    )
    .await;
    send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        write_headers(&cookies, &csrf),
        Some(json!({
            "username": "siti",
            "display_name": "Siti Rahayu",
            "password": CASHIER_PASSWORD,
            "role": "CASHIER",
        })),
    )
    .await;

    let refused = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/account"),
        write_headers(&cookies, &csrf),
        Some(json!({ "username": "siti", "reason": "akun untuk mantan pegawai" })),
    )
    .await;
    assert_eq!(
        refused.status,
        StatusCode::CONFLICT,
        "binding a login to somebody who has left: {:?}",
        refused.body
    );
}
