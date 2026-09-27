//! The payroll component engine, end to end.
//!
//! Five tests, and the first is the one this file exists for: **a slip with no
//! ratified rates says so rather than reporting zeros.** `0105` held that
//! guarantee by having no deduction column at all; `0251` gives it the columns
//! and keeps the guarantee by making them nullable, with a sentence naming the
//! component nobody has priced. If that ever regresses, a shop reads a net
//! somebody could be paid from.
//!
//! The rest: a fully ratified catalogue values a minute of overtime by the
//! rules an operator stated and produces a net; a rate is effective-dated, so
//! ratifying one in May does not change what April was deducted; a place files
//! a one-off and loses the ability to change it the moment it submits the batch
//! carrying it; and the rules are readable by the people they govern while the
//! figures about named people are not.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-components-1";
const SUPERVISOR_PASSWORD: &str = "supervisor-password-components-1";
const CASHIER_PASSWORD: &str = "cashier-password-components-1";

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
        node_id: "cloud-components-test".into(),
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

async fn agree_pay(app: &axum::Router, cookies: &str, csrf: &str, employee_id: &str, base: i64) {
    let agreed = send(
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
    .await;
    assert_eq!(agreed.status, StatusCode::OK, "pay: {:?}", agreed.body);
}

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

async fn define(app: &axum::Router, cookies: &str, csrf: &str, body: Value) -> Response {
    send(
        app.clone(),
        "POST",
        "/api/v1/payroll/components",
        write_headers(cookies, csrf),
        Some(body),
    )
    .await
}

async fn ratify(
    app: &axum::Router,
    cookies: &str,
    csrf: &str,
    code: &str,
    body: Value,
) -> Response {
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/components/{code}/rates"),
        write_headers(cookies, csrf),
        Some(body),
    )
    .await
}

async fn slips(app: &axum::Router, cookies: &str, run_id: &str) -> Response {
    send(
        app.clone(),
        "GET",
        &format!("/api/v1/payroll/runs/{run_id}/slips"),
        read_headers(cookies),
        None,
    )
    .await
}

async fn reconciliation(app: &axum::Router, cookies: &str, run_id: &str) -> Response {
    send(
        app.clone(),
        "GET",
        &format!("/api/v1/payroll/runs/{run_id}/reconciliation"),
        read_headers(cookies),
        None,
    )
    .await
}

/// A shop, a person on 5.500.000 of *upah*, and April signed off.
async fn a_shop_with_one_person(app: &axum::Router, cookies: &str, csrf: &str) -> String {
    let siti = staff_at(app, cookies, csrf, "K0701", "store-07").await;
    agree_pay(app, cookies, csrf, &siti, 5_000_000).await;
    siti
}

fn line<'a>(slip: &'a Value, side: &str, code: &str) -> &'a Value {
    slip[side]
        .as_array()
        .unwrap_or_else(|| panic!("{side} is a list: {slip:?}"))
        .iter()
        .find(|line| line["component_code"] == code)
        .unwrap_or_else(|| panic!("no {code} in {side}: {slip:?}"))
}

/// **The test this file exists for.**
///
/// BPJS is *expressible* here — a capped share of the statutory base — and no
/// rate for it is written anywhere in this repository. So a slip built while
/// nobody has ratified one must refuse to report a deduction total, naming the
/// component, rather than report nought as though somebody had looked.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_slip_with_no_ratified_rates_says_so_rather_than_reporting_zeros(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    a_shop_with_one_person(&app, &cookies, &csrf).await;

    // Before anything is defined at all: a slip cannot say a deduction total,
    // because nobody has configured payroll.
    close_april(&app, &cookies, &csrf).await;
    let opened = open_run(&app, &cookies, &csrf).await;
    assert_eq!(opened.status, StatusCode::OK, "{:?}", opened.body);
    let run_id = opened.body["id"].as_str().unwrap_or_default().to_owned();

    let empty = slips(&app, &cookies, &run_id).await;
    assert_eq!(empty.status, StatusCode::OK, "{:?}", empty.body);
    let slip = &empty.body[0];
    assert_eq!(slip["gross_minor"], 5_500_000, "gross is a real sum");
    assert_eq!(slip["deduction_total_minor"], Value::Null);
    assert_eq!(slip["net_minor"], Value::Null);
    let because = slip["components_incomplete_because"]
        .as_str()
        .unwrap_or_else(|| panic!("a sentence: {slip:?}"));
    assert!(
        because.contains("no payroll deduction has been defined"),
        "{because}"
    );

    // Now define BPJS and leave it unpriced. The sentence names it.
    let defined = define(
        &app,
        &cookies,
        &csrf,
        json!({
            "code": "BPJS_KESEHATAN",
            "label": "BPJS Kesehatan",
            "kind": "DEDUCTION",
            "basis": "SHARE_OF_BASE",
            "base_ref": "STATUTORY_BASE",
            "reason": "iuran wajib Perpres 64/2020",
        }),
    )
    .await;
    assert_eq!(defined.status, StatusCode::OK, "{:?}", defined.body);
    // Defined and unpriced is a state the catalogue names on the wire, so a
    // settings screen can show the open decision rather than a blank.
    assert_eq!(defined.body["awaiting_rate"], true);
    assert_eq!(defined.body["rate"], Value::Null);

    // Rebuild the run's slips by reopening it — the draft is a working
    // document, and the place's own reopen is how it is rebuilt.
    let reopened = send(
        app.clone(),
        "POST",
        "/api/v1/payroll/runs",
        write_headers(&cookies, &csrf),
        Some(json!({
            "place_id": "store-07",
            "period": "2026-04",
            "reason": "ulang",
        })),
    )
    .await;
    // One run per place per month: the second ask is refused, which is why the
    // check below reads the run that exists rather than a new one.
    assert_eq!(reopened.status, StatusCode::CONFLICT, "{:?}", reopened.body);

    let after = reconciliation(&app, &cookies, &run_id).await;
    assert_eq!(after.status, StatusCode::OK, "{:?}", after.body);
    // The totals are absent rather than partial, and the count says how many
    // slips are in that state — which is what head office reads before
    // approving.
    assert_eq!(after.body["deduction_total_minor"], Value::Null);
    assert_eq!(after.body["net_total_minor"], Value::Null);
    assert_eq!(after.body["gross_total_minor"], 5_500_000);
    assert_eq!(after.body["slips_with_unworkable_components"], 1);
}

/// Everything an operator has to state, stated — and then a slip that carries
/// valued overtime, a capped BPJS deduction, and a net.
///
/// Every figure below arrives as ratified configuration: 173, 1.5×, 2×, 1%, the
/// cap. None of them is written anywhere in the Rust or the schema.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_ratified_catalogue_values_overtime_and_produces_a_net(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    let siti = a_shop_with_one_person(&app, &cookies, &csrf).await;
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

    // The overtime caps, so an order can be placed at all (0103).
    let caps = send(
        app.clone(),
        "POST",
        "/api/v1/overtime-policy",
        write_headers(&cookies, &csrf),
        Some(json!({
            "version": 1,
            "max_per_day_minutes": 240,
            "max_per_week_minutes": 1080,
            "reason": "PP 35/2021 pasal 26 ayat 1",
        })),
    )
    .await;
    assert_eq!(caps.status, StatusCode::OK, "caps: {:?}", caps.body);

    // Two hours ordered on an ordinary working day in April, and agreed.
    let ordered = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{siti}/overtime-orders"),
        write_headers(&cookies, &csrf),
        Some(json!({
            "order_id": "OT-C1",
            "on_date": "2026-04-20",
            "day_kind": "WORKING",
            "planned_minutes": 120,
            "reason": "stok opname",
        })),
    )
    .await;
    assert_eq!(ordered.status, StatusCode::OK, "order: {:?}", ordered.body);
    let (hers, her_csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;
    let agreed = send(
        app.clone(),
        "POST",
        "/api/v1/employees/me/overtime-orders/OT-C1/consent",
        write_headers(&hers, &her_csrf),
        Some(json!({ "agreed": true, "reason": "setuju" })),
    )
    .await;
    assert_eq!(agreed.status, StatusCode::OK, "consent: {:?}", agreed.body);

    for (body, rate) in [
        (
            json!({
                "code": "LEMBUR_JAM_1",
                "label": "Lembur jam pertama",
                "kind": "EARNING",
                "basis": "FRACTION_OF_BASE_PER_UNIT",
                "base_ref": "STATUTORY_BASE",
                "unit": "OVERTIME_WORKDAY_FIRST_HOUR",
                "reason": "PP 35/2021 pasal 31",
            }),
            json!({
                "effective_from": "2026-01-01",
                "hours_divisor": 173,
                "multiplier_bp": 15_000,
                "reason": "1,5 kali upah sejam, Kepmenaker 102/2004 pasal 8",
            }),
        ),
        (
            json!({
                "code": "LEMBUR_JAM_LANJUT",
                "label": "Lembur jam berikutnya",
                "kind": "EARNING",
                "basis": "FRACTION_OF_BASE_PER_UNIT",
                "base_ref": "STATUTORY_BASE",
                "unit": "OVERTIME_WORKDAY_LATER",
                "reason": "PP 35/2021 pasal 31",
            }),
            json!({
                "effective_from": "2026-01-01",
                "hours_divisor": 173,
                "multiplier_bp": 20_000,
                "reason": "2 kali upah sejam",
            }),
        ),
        (
            json!({
                "code": "BPJS_KESEHATAN",
                "label": "BPJS Kesehatan",
                "kind": "DEDUCTION",
                "basis": "SHARE_OF_BASE",
                "base_ref": "STATUTORY_BASE",
                "reason": "Perpres 64/2020",
            }),
            json!({
                "effective_from": "2026-01-01",
                "rate_bp": 100,
                "cap_minor": 4_000_000,
                "reason": "1% dari upah, batas upah 4 juta",
            }),
        ),
    ] {
        let code = body["code"].as_str().unwrap_or_default().to_owned();
        let defined = define(&app, &cookies, &csrf, body).await;
        assert_eq!(defined.status, StatusCode::OK, "define: {:?}", defined.body);
        let ratified = ratify(&app, &cookies, &csrf, &code, rate).await;
        assert_eq!(
            ratified.status,
            StatusCode::OK,
            "ratify {code}: {:?}",
            ratified.body
        );
    }

    close_april(&app, &cookies, &csrf).await;
    let opened = open_run(&app, &cookies, &csrf).await;
    assert_eq!(opened.status, StatusCode::OK, "{:?}", opened.body);
    let run_id = opened.body["id"].as_str().unwrap_or_default().to_owned();

    let built = slips(&app, &cookies, &run_id).await;
    assert_eq!(built.status, StatusCode::OK, "{:?}", built.body);
    let slip = &built.body[0];
    assert_eq!(
        slip["components_incomplete_because"],
        Value::Null,
        "everything is priced: {slip:?}"
    );

    // The first hour: 5.500.000 / 173 = 31.792, x1.5 = 47.688 an hour, and
    // sixty of the hundred and twenty minutes fall in this band.
    let first = line(slip, "earnings", "LEMBUR_JAM_1");
    assert_eq!(first["units"], 60);
    assert_eq!(first["rate_minor"], 47_688);
    assert_eq!(first["amount_minor"], 47_688);
    assert_eq!(first["hours_divisor"], 173);
    assert_eq!(first["multiplier_bp"], 15_000);

    // The hour after it, at twice rather than one and a half.
    let later = line(slip, "earnings", "LEMBUR_JAM_LANJUT");
    assert_eq!(later["units"], 60);
    assert_eq!(later["rate_minor"], 63_584);
    assert_eq!(later["amount_minor"], 63_584);

    // The cap bounds the WAGE, not the contribution: 1% of 4.000.000.
    let bpjs = line(slip, "deductions", "BPJS_KESEHATAN");
    assert_eq!(bpjs["base_of_minor"], 4_000_000);
    assert_eq!(bpjs["cap_minor"], 4_000_000);
    assert_eq!(bpjs["rate_bp"], 100);
    assert_eq!(bpjs["amount_minor"], 40_000);

    assert_eq!(slip["overtime_minutes"], 120);
    assert_eq!(slip["gross_minor"], 5_500_000 + 47_688 + 63_584);
    assert_eq!(slip["deduction_total_minor"], 40_000);
    assert_eq!(slip["net_minor"], 5_500_000 + 47_688 + 63_584 - 40_000);

    let totals = reconciliation(&app, &cookies, &run_id).await;
    assert_eq!(totals.body["slips_with_unworkable_components"], 0);
    assert_eq!(totals.body["net_total_minor"], slip["net_minor"]);
    assert_eq!(totals.body["slips_with_negative_net"], 0);

    // The crossing to Finance is the slips' own gross — still gross, now
    // including the overtime a ratified rate valued (0251 corrects 0231's
    // comment).
    let submitted = send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/runs/{run_id}/submission"),
        write_headers(&cookies, &csrf),
        Some(json!({ "reason": "angka sudah dicek" })),
    )
    .await;
    assert_eq!(submitted.status, StatusCode::OK, "{:?}", submitted.body);
}

/// A rate is effective-dated, so ratifying one in May does not change what
/// April was deducted — and April, having no rate in force, says so.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_rate_ratified_for_may_does_not_price_april(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    a_shop_with_one_person(&app, &cookies, &csrf).await;

    let defined = define(
        &app,
        &cookies,
        &csrf,
        json!({
            "code": "BPJS_JHT",
            "label": "BPJS JHT",
            "kind": "DEDUCTION",
            "basis": "SHARE_OF_BASE",
            "base_ref": "STATUTORY_BASE",
            "reason": "PP 46/2015",
        }),
    )
    .await;
    assert_eq!(defined.status, StatusCode::OK, "{:?}", defined.body);
    let ratified = ratify(
        &app,
        &cookies,
        &csrf,
        "BPJS_JHT",
        json!({
            "effective_from": "2026-05-01",
            "rate_bp": 200,
            "reason": "2% dari upah, berlaku Mei",
        }),
    )
    .await;
    assert_eq!(ratified.status, StatusCode::OK, "{:?}", ratified.body);

    // A rate behind the latest is refused: it would change what an already
    // closed month was deducted.
    let backdated = ratify(
        &app,
        &cookies,
        &csrf,
        "BPJS_JHT",
        json!({
            "effective_from": "2026-03-01",
            "rate_bp": 100,
            "reason": "koreksi",
        }),
    )
    .await;
    assert_eq!(
        backdated.status,
        StatusCode::CONFLICT,
        "{:?}",
        backdated.body
    );

    close_april(&app, &cookies, &csrf).await;
    let opened = open_run(&app, &cookies, &csrf).await;
    let run_id = opened.body["id"].as_str().unwrap_or_default().to_owned();
    let built = slips(&app, &cookies, &run_id).await;
    let slip = &built.body[0];
    assert_eq!(slip["deduction_total_minor"], Value::Null);
    assert!(
        slip["components_incomplete_because"]
            .as_str()
            .unwrap_or_default()
            .contains("BPJS_JHT"),
        "{slip:?}"
    );
    assert!(
        slip["deductions"].as_array().map(Vec::is_empty) == Some(true),
        "no line was invented: {slip:?}"
    );
}

/// The place files a one-off, the run picks it up, and the submission freezes
/// it. There is no second approval chain: the figure rides the batch.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_place_files_a_one_off_and_the_submission_freezes_it(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    let siti = a_shop_with_one_person(&app, &cookies, &csrf).await;

    // The shop's manager, posted to store-07.
    let rina = staff_at(&app, &cookies, &csrf, "K0700", "store-07").await;
    login_for(
        &app,
        &cookies,
        &csrf,
        &rina,
        "bu.rina",
        "SUPERVISOR",
        SUPERVISOR_PASSWORD,
    )
    .await;
    let (theirs, their_csrf) = sign_in(&app, "bu.rina", SUPERVISOR_PASSWORD).await;

    // Head office defines the vocabulary; the place fills in the figure.
    for body in [
        json!({
            "code": "INSENTIF",
            "label": "Insentif toko",
            "kind": "EARNING",
            "basis": "PER_OCCASION",
            "reason": "insentif bulanan yang diusulkan toko",
        }),
        json!({
            "code": "KASBON",
            "label": "Angsuran kasbon",
            "kind": "DEDUCTION",
            "basis": "PER_OCCASION",
            "reason": "potongan kasbon per bulan",
        }),
    ] {
        let defined = define(&app, &cookies, &csrf, body).await;
        assert_eq!(defined.status, StatusCode::OK, "{:?}", defined.body);
    }

    // A place manager may not define one: what a payslip may say is head
    // office's.
    let refused = define(
        &app,
        &theirs,
        &their_csrf,
        json!({
            "code": "BONUS_SENDIRI",
            "label": "Bonus",
            "kind": "EARNING",
            "basis": "PER_OCCASION",
            "reason": "coba",
        }),
    )
    .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN, "{:?}", refused.body);

    // A one-off may not name a component that already has a standing figure —
    // that would be two answers to one question.
    let standing = define(
        &app,
        &cookies,
        &csrf,
        json!({
            "code": "TRANSPORT",
            "label": "Transport",
            "kind": "EARNING",
            "basis": "RATE_PER_UNIT",
            "unit": "ROSTERED_DAY",
            "reason": "uang transport harian",
        }),
    )
    .await;
    assert_eq!(standing.status, StatusCode::OK, "{:?}", standing.body);
    let wrong = send(
        app.clone(),
        "POST",
        "/api/v1/payroll/adjustments",
        write_headers(&theirs, &their_csrf),
        Some(json!({
            "place_id": "store-07",
            "period": "2026-04",
            "employee_id": siti,
            "component_code": "TRANSPORT",
            "amount_minor": 100_000,
            "reason": "tambahan transport",
        })),
    )
    .await;
    // A bad request rather than a conflict: nothing about the moment is wrong,
    // the component simply is not the kind of thing a one-off can name.
    assert_eq!(wrong.status, StatusCode::BAD_REQUEST, "{:?}", wrong.body);

    for (code, amount) in [("INSENTIF", 300_000), ("KASBON", 500_000)] {
        let filed = send(
            app.clone(),
            "POST",
            "/api/v1/payroll/adjustments",
            write_headers(&theirs, &their_csrf),
            Some(json!({
                "place_id": "store-07",
                "period": "2026-04",
                "employee_id": siti,
                "component_code": code,
                "amount_minor": amount,
                "reason": "diputuskan kepala toko April",
            })),
        )
        .await;
        assert_eq!(
            filed.status,
            StatusCode::OK,
            "file {code}: {:?}",
            filed.body
        );
    }

    // The same component twice in one month is refused: two incentives are one
    // incentive of the sum, or two components, and somebody has to say which.
    let twice = send(
        app.clone(),
        "POST",
        "/api/v1/payroll/adjustments",
        write_headers(&theirs, &their_csrf),
        Some(json!({
            "place_id": "store-07",
            "period": "2026-04",
            "employee_id": siti,
            "component_code": "INSENTIF",
            "amount_minor": 50_000,
            "reason": "tambahan lagi",
        })),
    )
    .await;
    assert_eq!(twice.status, StatusCode::CONFLICT, "{:?}", twice.body);

    // A shop may not reach another shop's batch.
    let elsewhere = send(
        app.clone(),
        "POST",
        "/api/v1/payroll/adjustments",
        write_headers(&theirs, &their_csrf),
        Some(json!({
            "place_id": "store-03",
            "period": "2026-04",
            "employee_id": siti,
            "component_code": "INSENTIF",
            "amount_minor": 10_000,
            "reason": "coba toko lain",
        })),
    )
    .await;
    assert_eq!(
        elsewhere.status,
        StatusCode::FORBIDDEN,
        "{:?}",
        elsewhere.body
    );

    close_april(&app, &cookies, &csrf).await;
    let opened = open_run(&app, &theirs, &their_csrf).await;
    assert_eq!(opened.status, StatusCode::OK, "{:?}", opened.body);
    let run_id = opened.body["id"].as_str().unwrap_or_default().to_owned();

    let built = slips(&app, &theirs, &run_id).await;
    let slip = &built.body[0];
    assert_eq!(line(slip, "earnings", "INSENTIF")["amount_minor"], 300_000);
    assert_eq!(line(slip, "deductions", "KASBON")["amount_minor"], 500_000);
    // TRANSPORT has no ratified rate, so the slip says so rather than paying
    // nothing for it — and the net is absent even though the deductions are
    // knowable, because the gross it would come off is short.
    assert!(
        slip["components_incomplete_because"]
            .as_str()
            .unwrap_or_default()
            .contains("TRANSPORT"),
        "{slip:?}"
    );
    assert_eq!(slip["deduction_total_minor"], 500_000);
    assert_eq!(slip["net_minor"], Value::Null);

    // While the batch is a draft, the place may take a figure back.
    let listed = send(
        app.clone(),
        "GET",
        "/api/v1/payroll/adjustments?place=store-07&period=2026-04",
        read_headers(&theirs),
        None,
    )
    .await;
    assert_eq!(listed.status, StatusCode::OK, "{:?}", listed.body);
    let insentif = listed
        .body
        .as_array()
        .unwrap_or_else(|| panic!("a list: {:?}", listed.body))
        .iter()
        .find(|row| row["component_code"] == "INSENTIF")
        .unwrap_or_else(|| panic!("insentif: {:?}", listed.body))
        .clone();
    assert_eq!(insentif["withdrawable"], true);
    assert_eq!(insentif["kind"], "EARNING");
    assert_eq!(insentif["reason"], "diputuskan kepala toko April");

    // Submit, and the figure stops being the place's to change. There is no
    // route that decides an adjustment: head office's approval of this run is
    // the decision, and the way back is its reopen.
    let submitted = send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/runs/{run_id}/submission"),
        write_headers(&theirs, &their_csrf),
        Some(json!({ "reason": "angka sudah dicek di toko" })),
    )
    .await;
    assert_eq!(submitted.status, StatusCode::OK, "{:?}", submitted.body);

    let id = insentif["id"].as_str().unwrap_or_default().to_owned();
    let too_late = send(
        app.clone(),
        "POST",
        &format!("/api/v1/payroll/adjustments/{id}/withdrawal"),
        write_headers(&theirs, &their_csrf),
        Some(json!({ "reason": "berubah pikiran" })),
    )
    .await;
    assert_eq!(too_late.status, StatusCode::CONFLICT, "{:?}", too_late.body);
    assert!(
        too_late.body["error"]
            .as_str()
            .unwrap_or_default()
            .contains("submitted"),
        "the refusal names the state: {:?}",
        too_late.body
    );

    let frozen = send(
        app.clone(),
        "POST",
        "/api/v1/payroll/adjustments",
        write_headers(&theirs, &their_csrf),
        Some(json!({
            "place_id": "store-07",
            "period": "2026-04",
            "employee_id": siti,
            "component_code": "KASBON",
            "amount_minor": 1_000,
            "reason": "sesudah kirim",
        })),
    )
    .await;
    assert_eq!(frozen.status, StatusCode::CONFLICT, "{:?}", frozen.body);
}

/// A deduction rate is a rule the person paying it is entitled to read. A
/// figure about a named person is not.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_rules_are_readable_by_everyone_and_the_figures_are_not(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    let siti = a_shop_with_one_person(&app, &cookies, &csrf).await;
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

    let defined = define(
        &app,
        &cookies,
        &csrf,
        json!({
            "code": "BPJS_JP",
            "label": "BPJS Jaminan Pensiun",
            "kind": "DEDUCTION",
            "basis": "SHARE_OF_BASE",
            "base_ref": "STATUTORY_BASE",
            "reason": "PP 45/2015",
        }),
    )
    .await;
    assert_eq!(defined.status, StatusCode::OK, "{:?}", defined.body);
    let ratified = ratify(
        &app,
        &cookies,
        &csrf,
        "BPJS_JP",
        json!({
            "effective_from": "2026-01-01",
            "rate_bp": 100,
            "cap_minor": 9_559_600,
            "reason": "1% dari upah, batas upah tahun ini",
        }),
    )
    .await;
    assert_eq!(ratified.status, StatusCode::OK, "{:?}", ratified.body);

    // A cashier reads the catalogue and the rate history: this is what comes
    // out of their own wage, and a rule kept from the people it governs is a
    // trap.
    let (hers, _her_csrf) = sign_in(&app, "siti", CASHIER_PASSWORD).await;
    let catalogue = send(
        app.clone(),
        "GET",
        "/api/v1/payroll/components",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(
        catalogue.status,
        StatusCode::OK,
        "catalogue: {:?}",
        catalogue.body
    );
    assert_eq!(catalogue.body[0]["code"], "BPJS_JP");
    assert_eq!(catalogue.body[0]["rate"]["rate_bp"], 100);
    assert_eq!(catalogue.body[0]["rate"]["ratified_by"], "admin");

    let history = send(
        app.clone(),
        "GET",
        "/api/v1/payroll/components/BPJS_JP/rates",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(history.status, StatusCode::OK, "{:?}", history.body);
    assert_eq!(history.body.as_array().map(Vec::len), Some(1));

    // The one-offs are not rules. They are figures about named people, so they
    // sit behind the payroll read key and the caller's reach.
    let refused = send(
        app.clone(),
        "GET",
        "/api/v1/payroll/adjustments",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN, "{:?}", refused.body);
}
