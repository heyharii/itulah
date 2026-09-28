//! Finance over HTTP, against the real routers and the real migrations.
//!
//! The brief's Phase B: every business action as a request the outside world
//! would make, and the books read back through Finance's own endpoints. No
//! fixture account maps — the 267-leaf map the migrations install IS the
//! deliverable, so a test that seeded its own map would prove nothing.
//!
//! This file starts with the negative and authorization scenarios (35–39): the
//! rules that must REFUSE. The positive flows (sales, inventory, procurement,
//! GA, HR) follow in the same style.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-finance-api-1";
const CASHIER_PASSWORD: &str = "cashier-password-finance-api-1";
const SITE: &str = "store-01";

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
        node_id: "cloud-finance-api-test".into(),
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

/// Admin is bootstrapped, September is open, and the router is ready.
async fn app_with_admin(pool: &PgPool) -> axum::Router {
    cloud::bootstrap_admin(pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
    cloud_http::router(AppState::new(pool.clone(), config()))
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

/// Create a user of the given role, then sign in as them.
async fn a_user(
    app: &axum::Router,
    admin: &(String, String),
    username: &str,
    role: &str,
    password: &str,
) -> (String, String) {
    let created = send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        write_headers(&admin.0, &admin.1),
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
        "create {role} user: {:?}",
        created.body
    );
    sign_in(app, username, password).await
}

/// One manual-journal line naming a client account by code.
fn line(account: &str, site: &str, debit: i64, credit: i64) -> Value {
    json!({
        "account": { "kind": "account", "account_code": account },
        "unit_id": site,
        "debit_minor": debit,
        "credit_minor": credit,
    })
}

async fn post_manual_journal(
    app: &axum::Router,
    who: &(String, String),
    lines: Vec<Value>,
) -> Response {
    send(
        app.clone(),
        "POST",
        "/api/v1/finance/journal",
        write_headers(&who.0, &who.1),
        Some(json!({
            "posting_date": "2026-09-15",
            "memo": "finance api test",
            "lines": lines,
        })),
    )
    .await
}

// 35 -------------------------------------------------------------------------

/// Only Finance HO writes a manual journal. A shop's role is refused.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_shop_role_cannot_post_a_manual_journal(pool: PgPool) {
    let app = app_with_admin(&pool).await;
    let admin = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    let cashier = a_user(&app, &admin, "till-one", "CASHIER", CASHIER_PASSWORD).await;

    let refused = post_manual_journal(
        &app,
        &cashier,
        vec![line("1002", SITE, 10_000, 0), line("4002", SITE, 0, 10_000)],
    )
    .await;
    assert_eq!(
        refused.status,
        StatusCode::FORBIDDEN,
        "a cashier must not journal: {:?}",
        refused.body
    );

    // And Finance HO can, so the refusal is the role and not the entry.
    let posted = post_manual_journal(
        &app,
        &admin,
        vec![line("1002", SITE, 10_000, 0), line("4002", SITE, 0, 10_000)],
    )
    .await;
    assert_eq!(posted.status, StatusCode::OK, "admin: {:?}", posted.body);
    let entry_id = posted.body["entry_id"]
        .as_str()
        .unwrap_or_else(|| panic!("entry_id: {:?}", posted.body))
        .to_owned();

    // A cash document is the same kind of act and carries the same gate.
    let cash_doc = send(
        app.clone(),
        "POST",
        "/api/v1/finance/cash-documents",
        write_headers(&cashier.0, &cashier.1),
        Some(json!({ "kind": "KK", "amount_minor": 1_000 })),
    )
    .await;
    assert_eq!(
        cash_doc.status,
        StatusCode::FORBIDDEN,
        "a cashier must not raise a cash document: {:?}",
        cash_doc.body
    );

    // And a reversal is Finance HO's too.
    let reversed = send(
        app.clone(),
        "POST",
        &format!("/api/v1/finance/journal/{entry_id}/reverse"),
        write_headers(&cashier.0, &cashier.1),
        Some(json!({ "reason": "coba" })),
    )
    .await;
    assert_eq!(
        reversed.status,
        StatusCode::FORBIDDEN,
        "a cashier must not reverse: {:?}",
        reversed.body
    );
}

// 36 -------------------------------------------------------------------------

/// An external supplier payable cannot be opened in a shop's books.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_external_payable_cannot_be_opened_at_a_shop(pool: PgPool) {
    let app = app_with_admin(&pool).await;
    let admin = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    for payable in ["2002", "2004"] {
        let refused = post_manual_journal(
            &app,
            &admin,
            vec![line("1002", SITE, 0, 5_000), line(payable, SITE, 5_000, 0)],
        )
        .await;
        assert!(
            refused.status.is_client_error(),
            "{payable} at a shop must be refused: {:?}",
            refused.body
        );
        let text = refused.body.to_string();
        assert!(
            text.contains(payable),
            "the refusal names {payable}: {text}"
        );
    }
}

// 38 -------------------------------------------------------------------------

/// The accounts the owner retired are not reachable.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn retired_accounts_cannot_be_posted(pool: PgPool) {
    let app = app_with_admin(&pool).await;
    let admin = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    // 1110 Disposed Inventory is NOT here: 0380 reopened it (the client carries
    // 2.73B on it) as a manual-only, opening-balance account.
    for retired in ["2003", "4009", "4010", "2032"] {
        let refused = post_manual_journal(
            &app,
            &admin,
            vec![line("1002", SITE, 0, 5_000), line(retired, SITE, 5_000, 0)],
        )
        .await;
        assert!(
            refused.status.is_client_error(),
            "{retired} is retired and must be refused: {:?}",
            refused.body
        );
    }
}

/// A signed-in read against Finance.
async fn get(app: &axum::Router, who: &(String, String), path: &str) -> Response {
    send(
        app.clone(),
        "GET",
        path,
        vec![(header::COOKIE.to_string(), who.0.clone())],
        None,
    )
    .await
}

// 25 -------------------------------------------------------------------------

/// Rent income is a unit's income, recorded by a Finance HO manual journal.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn rental_income_lands_on_8005(pool: PgPool) {
    let app = app_with_admin(&pool).await;
    let admin = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let posted = post_manual_journal(
        &app,
        &admin,
        vec![
            line("1002", SITE, 500_000, 0),
            line("8005", SITE, 0, 500_000),
        ],
    )
    .await;
    assert_eq!(posted.status, StatusCode::OK, "post: {:?}", posted.body);

    let trial = get(
        &app,
        &admin,
        "/api/v1/finance/trial-balance?unit=store-01&as_of=2026-09-30",
    )
    .await;
    assert_eq!(trial.status, StatusCode::OK, "trial: {:?}", trial.body);
    assert!(
        trial.body.to_string().contains("8005"),
        "Pendapatan Sewa Gedung: {}",
        trial.body
    );
}

// 33 -------------------------------------------------------------------------

/// Head office charges a unit a management fee: the unit's cost, head office's
/// income, crossing on Lain-lain (1059 at head office, 2030 at the unit).
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_management_fee_crosses_on_lain_lain(pool: PgPool) {
    let app = app_with_admin(&pool).await;
    let admin = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let posted = send(
        app.clone(),
        "POST",
        "/api/v1/finance/management-fees",
        write_headers(&admin.0, &admin.1),
        Some(json!({
            "unit_id": SITE,
            "amount_minor": 250_000,
            "effective_date": "2026-09-15",
            "memo": "management fee September",
        })),
    )
    .await;
    assert_eq!(posted.status, StatusCode::OK, "post: {:?}", posted.body);

    let store = get(
        &app,
        &admin,
        "/api/v1/finance/trial-balance?unit=store-01&as_of=2026-09-30",
    )
    .await;
    assert_eq!(
        store.status,
        StatusCode::OK,
        "store trial: {:?}",
        store.body
    );
    assert!(
        store.body.to_string().contains("7032"),
        "the unit carries Biaya Management Fee: {}",
        store.body
    );

    let ho = get(
        &app,
        &admin,
        "/api/v1/finance/trial-balance?unit=ho&as_of=2026-09-30",
    )
    .await;
    assert_eq!(ho.status, StatusCode::OK, "HO trial: {:?}", ho.body);
    assert!(
        ho.body.to_string().contains("4016"),
        "head office books Management Fee income: {}",
        ho.body
    );

    let (ho_1059, unit_2030, affiliate): (i64, i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(debit_minor - credit_minor)
                    FILTER (WHERE account_code = '1059' AND unit_id = 'ho'), 0)::bigint,
                COALESCE(SUM(debit_minor - credit_minor)
                    FILTER (WHERE account_code = '2030' AND unit_id = 'store-01'), 0)::bigint,
                COALESCE(SUM(debit_minor - credit_minor)
                    FILTER (WHERE account_code IN ('1059', '2030')), 0)::bigint
           FROM journal_line",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("affiliate: {error}"));
    assert_eq!(
        ho_1059, 250_000,
        "head office Dr 1059 Piutang Affiliasi Lain-lain"
    );
    assert_eq!(
        unit_2030, -250_000,
        "the unit Cr 2030 Hutang Lain-lain Principal"
    );
    assert_eq!(
        affiliate, 0,
        "Lain-lain (1059/2030) nets to zero company-wide"
    );
}

// 34 -------------------------------------------------------------------------

/// Closing a month seals and validates; it never posts the period's profit to
/// retained earnings (that is derived). The books are read back through Finance.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn closing_a_month_posts_nothing_to_retained_earnings(pool: PgPool) {
    let app = app_with_admin(&pool).await;
    let admin = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    // Something to close: a manual journal so the month is not empty.
    let posted = post_manual_journal(
        &app,
        &admin,
        vec![line("1002", SITE, 10_000, 0), line("4002", SITE, 0, 10_000)],
    )
    .await;
    assert_eq!(posted.status, StatusCode::OK, "seed: {:?}", posted.body);

    let closed = send(
        app.clone(),
        "POST",
        "/api/v1/finance/periods/close",
        write_headers(&admin.0, &admin.1),
        Some(json!({ "year": 2026, "month": 9, "reason": "tutup buku September" })),
    )
    .await;
    assert!(
        !closed.status.is_server_error(),
        "closing must not fail: {:?}",
        closed.body
    );

    // Retained earnings is not in the trial balance: nothing closed into it.
    let trial = send(
        app.clone(),
        "GET",
        "/api/v1/finance/trial-balance?unit=ho&as_of=2026-09-30",
        vec![(header::COOKIE.to_string(), admin.0.clone())],
        None,
    )
    .await;
    assert_eq!(trial.status, StatusCode::OK, "trial: {:?}", trial.body);
    assert!(
        !trial.body.to_string().contains("3003"),
        "no line closed into 3003 Laba Ditahan: {}",
        trial.body
    );
}

// 39 -------------------------------------------------------------------------

/// 6002 Pendapatan lain-lain is reachable by a Finance HO manual journal and by
/// nothing automatic. This proves the manual half; the coverage test proves no
/// meaning maps to it.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn manual_income_6002_is_a_finance_journal(pool: PgPool) {
    let app = app_with_admin(&pool).await;
    let admin = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    // 6002 is a company account, so head office's journal is where it posts.
    let posted = post_manual_journal(
        &app,
        &admin,
        vec![line("1002", "ho", 10_000, 0), line("6002", "ho", 0, 10_000)],
    )
    .await;
    assert_eq!(posted.status, StatusCode::OK, "admin: {:?}", posted.body);
}
