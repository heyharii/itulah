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
        Some(json!({ "username": "siti" })),
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
        Some(json!({ "username": "siti" })),
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
