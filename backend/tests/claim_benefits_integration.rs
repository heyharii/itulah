//! Yearly claim allowances (0810): a type's limit per person per year, one
//! person's own figure, and an approval refused past what is left.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-claim-benefit-1";

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
        node_id: "cloud-statutory-test".into(),
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

// ── helpers ─────────────────────────────────────────────────────────────────

struct Hub {
    app: axum::Router,
    cookies: String,
    csrf: String,
}

impl Hub {
    async fn open(pool: &PgPool) -> Self {
        let _ = tracing_subscriber::fmt().with_env_filter("error").try_init();
        cloud::bootstrap_admin(pool, Some(ADMIN_PASSWORD), true)
            .await
            .unwrap_or_else(|error| panic!("bootstrap: {error}"));
        let app = cloud_http::router(AppState::new(pool.clone(), config()));
        let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
        Self { app, cookies, csrf }
    }

    async fn post(&self, path: &str, body: Value) -> Response {
        send(
            self.app.clone(),
            "POST",
            path,
            write_headers(&self.cookies, &self.csrf),
            Some(body),
        )
        .await
    }

    async fn get(&self, path: &str) -> Response {
        send(self.app.clone(), "GET", path, read_headers(&self.cookies), None).await
    }

    async fn ok(&self, path: &str, body: Value) -> Value {
        let response = self.post(path, body).await;
        assert_eq!(response.status, StatusCode::OK, "POST {path}: {:?}", response.body);
        response.body
    }

    /// Register somebody, hire them and post them to `unit` from `from`.
    async fn staff(&self, code: &str, unit: &str, from: &str) -> String {
        let registered = self.ok("/api/v1/employees", json!({ "employee_code": code })).await;
        let id = registered["employee_id"]
            .as_str()
            .unwrap_or_else(|| panic!("employee_id: {registered:?}"))
            .to_owned();
        self.ok(
            &format!("/api/v1/employees/{id}/employment"),
            json!({ "transition": "HIRE", "effective_on": from, "reason": "mulai bekerja" }),
        )
        .await;
        self.ok(
            &format!("/api/v1/employees/{id}/assignments"),
            json!({ "unit_id": unit, "valid_from": from, "reason": "penempatan" }),
        )
        .await;
        id
    }

    async fn pay(&self, employee: &str, from: &str, base: i64, allowances: Value) {
        self.ok(
            &format!("/api/v1/employees/{employee}/pay"),
            json!({
                "effective_from": from,
                "base_minor": base,
                "fixed_allowances": allowances,
                "reason": "kesepakatan kerja",
            }),
        )
        .await;
    }

    async fn identity(&self, employee: &str, field: &str, value: &str) {
        self.ok(
            &format!("/api/v1/employees/{employee}/payroll-identity"),
            json!({
                "field": field,
                "value": value,
                "effective_from": "2026-01-01",
                "reason": "data payroll",
            }),
        )
        .await;
    }

    /// Close the month's attendance and open its run; the run's slips.
    async fn run(&self, unit: &str, period: &str) -> (String, Vec<Value>) {
        self.ok(
            &format!("/api/v1/attendance-periods/{unit}/{period}/closure"),
            json!({ "reason": "absensi sudah dicek" }),
        )
        .await;
        let opened = self
            .ok(
                "/api/v1/payroll/runs",
                json!({ "unit_id": unit, "period": period, "reason": "penggajian" }),
            )
            .await;
        let run_id = opened["id"].as_str().unwrap_or_default().to_owned();
        let slips = self.get(&format!("/api/v1/payroll/runs/{run_id}/slips")).await;
        assert_eq!(slips.status, StatusCode::OK, "{:?}", slips.body);
        let list = slips.body.as_array().cloned().unwrap_or_default();
        (run_id, list)
    }
}

fn slip_of<'a>(slips: &'a [Value], employee: &str) -> &'a Value {
    slips
        .iter()
        .find(|slip| slip["employee_id"] == employee)
        .unwrap_or_else(|| panic!("no slip for {employee}: {slips:?}"))
}

async fn decision(
    app: axum::Router,
    cookies: String,
    csrf: String,
    id: String,
    line: String,
    amount: i64,
) -> Response {
    send(
        app,
        "POST",
        &format!("/api/v1/expense-claims/{id}/decision"),
        write_headers(&cookies, &csrf),
        Some(json!({ "approve": true, "reason": "sesuai kwitansi",
                     "lines": [{ "line_id": line, "sanctioned_minor": amount }] })),
    )
    .await
}

async fn file_claim(hub: &Hub, employee: &str, day: &str, amount: i64) -> (String, String) {
    let filed = hub
        .ok(
            "/api/v1/expense-claims",
            json!({
                "employee_id": employee,
                "posted_on": day,
                "lines": [{ "type_code": "MEDIS", "description": "berobat", "spent_on": day,
                            "claimed_minor": amount }],
                "reason": "klaim berobat",
            }),
        )
        .await;
    let id = filed["claim_id"].as_str().unwrap_or_default().to_owned();
    let line = filed["lines"][0]["line_id"].as_str().unwrap_or_default().to_owned();
    hub.ok(&format!("/api/v1/expense-claims/{id}/submission"), json!({ "reason": "ajukan" })).await;
    (id, line)
}

/// Medical allows 3,000,000 a year: a claim that fits is approved, one that
/// would pass it is refused naming what is left, and one person given more
/// for the year may claim it.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_claim_type_allows_so_much_a_year(pool: PgPool) {
    cloud::open_period(&pool, 2026, 4)
        .await
        .unwrap_or_else(|error| panic!("open: {error}"));
    let hub = Hub::open(&pool).await;
    let siti = hub.staff("K0961", "store-07", "2026-01-05").await;
    hub.ok(
        "/api/v1/expense-claim-types",
        json!({ "code": "MEDIS", "name": "Medis", "expense_category": "MEDICAL" }),
    )
    .await;
    let rules = hub
        .ok(
            "/api/v1/claim-benefits",
            json!({ "type_code": "MEDIS", "effective_from": "2026-01-01",
                    "yearly_limit_minor": 3_000_000, "reason": "plafon medis" }),
        )
        .await;
    assert_eq!(rules[0]["yearly_limit_minor"], 3_000_000);

    hub.ok(
        "/api/v1/auth/users",
        json!({ "username": "hr.decider", "display_name": "Decider", "password": "decider-pass-claim-1", "role": "ADMIN" }),
    )
    .await;
    let (decider, decider_csrf) = sign_in(&hub.app, "hr.decider", "decider-pass-claim-1").await;
    let decide = |id: String, line: String, amount: i64| {
        decision(hub.app.clone(), decider.clone(), decider_csrf.clone(), id, line, amount)
    };

    let (first, first_line) = file_claim(&hub, &siti, "2026-04-06", 2_000_000).await;
    let balances = hub.get(&format!("/api/v1/employees/{siti}/claim-balances?year=2026")).await;
    let medis = balances.body.as_array().and_then(|r| r.iter().find(|b| b["type_code"] == "MEDIS")).cloned();
    assert_eq!(medis.as_ref().map(|b| b["pending_minor"].clone()), Some(json!(2_000_000)));
    let approved = decide(first, first_line, 2_000_000).await;
    assert_eq!(approved.status, StatusCode::OK, "{:?}", approved.body);

    let (second, second_line) = file_claim(&hub, &siti, "2026-04-20", 1_500_000).await;
    let refused = decide(second.clone(), second_line.clone(), 1_500_000).await;
    assert_eq!(refused.status, StatusCode::CONFLICT, "{:?}", refused.body);
    assert!(refused.body["error"].as_str().unwrap_or_default().contains("1000000 is"));

    let mine = hub
        .ok(
            &format!("/api/v1/employees/{siti}/claim-balances"),
            json!({ "type_code": "MEDIS", "year": 2026, "limit_minor": 4_000_000, "reason": "operasi" }),
        )
        .await;
    let medis = mine.as_array().and_then(|r| r.iter().find(|b| b["type_code"] == "MEDIS")).cloned();
    assert_eq!(medis.as_ref().map(|b| b["personal"].clone()), Some(json!(true)));
    assert_eq!(medis.as_ref().map(|b| b["left_minor"].clone()), Some(json!(2_000_000)));
    let now_fits = decide(second, second_line, 1_500_000).await;
    assert_eq!(now_fits.status, StatusCode::OK, "{:?}", now_fits.body);
}
