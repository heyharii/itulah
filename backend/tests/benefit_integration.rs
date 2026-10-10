//! The employee benefit balance (0818): HR fills, takes off and resets it;
//! the employee shows a code; the till spends and gives back.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-benefit-1";

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
        let _ = tracing_subscriber::fmt()
            .with_env_filter("error")
            .try_init();
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
        send(
            self.app.clone(),
            "GET",
            path,
            read_headers(&self.cookies),
            None,
        )
        .await
    }

    async fn ok(&self, path: &str, body: Value) -> Value {
        let response = self.post(path, body).await;
        assert_eq!(
            response.status,
            StatusCode::OK,
            "POST {path}: {:?}",
            response.body
        );
        response.body
    }

    /// Register somebody, hire them and post them to `unit` from `from`.
    async fn staff(&self, code: &str, unit: &str, from: &str) -> String {
        let registered = self
            .ok("/api/v1/employees", json!({ "employee_code": code }))
            .await;
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
        let slips = self
            .get(&format!("/api/v1/payroll/runs/{run_id}/slips"))
            .await;
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

async fn login_for(hub: &Hub, employee: &str, username: &str) -> (String, String) {
    hub.ok(
        "/api/v1/auth/users",
        json!({ "username": username, "display_name": username, "password": "benefit-pass-1234",
                "role": "CASHIER" }),
    )
    .await;
    hub.ok(
        &format!("/api/v1/employees/{employee}/account"),
        json!({ "username": username, "reason": "akun" }),
    )
    .await;
    sign_in(&hub.app, username, "benefit-pass-1234").await
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_benefit_balance_is_filled_shown_spent_and_given_back(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let siti = hub.staff("K0981", "store-07", "2026-01-05").await;
    let budi = hub.staff("K0982", "store-07", "2026-01-05").await;
    let (hers, her_csrf) = login_for(&hub, &siti, "siti.benefit").await;
    let (his, his_csrf) = login_for(&hub, &budi, "budi.benefit").await;
    let as_her = |path: &'static str| {
        send(
            hub.app.clone(),
            "POST",
            path,
            write_headers(&hers, &her_csrf),
            Some(json!({})),
        )
    };
    let till = |path: &'static str, body: Value| {
        send(
            hub.app.clone(),
            "POST",
            path,
            write_headers(&his, &his_csrf),
            Some(body),
        )
    };

    // Off until head office turns it on.
    let off = as_her("/api/v1/employees/me/benefit-code").await;
    assert_eq!(off.status, StatusCode::CONFLICT, "{:?}", off.body);
    hub.ok(
        "/api/v1/benefit/settings",
        json!({ "effective_from": "2026-01-01", "enabled": true, "code_minutes": 5,
                "reason": "diskon karyawan" }),
    )
    .await;

    // HR's hand: fill both, take some off one, reset the other.
    let filled = hub
        .ok(
            "/api/v1/benefit/adjustments",
            json!({ "action": "ADD", "amount_minor": 300_000, "employee_ids": [siti, budi],
                    "reason": "saldo Oktober" }),
        )
        .await;
    assert_eq!(filled.as_array().map(Vec::len), Some(2));
    hub.ok(
        "/api/v1/benefit/adjustments",
        json!({ "action": "REMOVE", "amount_minor": 50_000, "employee_ids": [siti], "reason": "koreksi" }),
    )
    .await;
    hub.ok(
        "/api/v1/benefit/adjustments",
        json!({ "action": "RESET", "amount_minor": 100_000, "employee_ids": [budi], "reason": "reset" }),
    )
    .await;
    let too_much = hub
        .post(
            "/api/v1/benefit/adjustments",
            json!({ "action": "REMOVE", "amount_minor": 999_000, "employee_ids": [budi], "reason": "x" }),
        )
        .await;
    assert_eq!(too_much.status, StatusCode::CONFLICT, "{:?}", too_much.body);
    let mine = send(
        hub.app.clone(),
        "GET",
        "/api/v1/employees/me/benefit",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(mine.status, StatusCode::OK, "{:?}", mine.body);
    assert_eq!(mine.body["balance_minor"], 250_000);
    assert_eq!(mine.body["entries"].as_array().map(Vec::len), Some(2));

    // Her code at his till.
    let code = as_her("/api/v1/employees/me/benefit-code").await;
    assert_eq!(code.status, StatusCode::OK, "{:?}", code.body);
    let code = code.body["code"].as_str().unwrap_or_default().to_owned();
    let found = till("/api/v1/benefit/lookup", json!({ "code": code })).await;
    assert_eq!(found.status, StatusCode::OK, "{:?}", found.body);
    assert_eq!(found.body["balance_minor"], 250_000);
    let promo = till(
        "/api/v1/benefit/spends",
        json!({ "code": code, "sale_ref": "S-1", "unit_id": "store-07", "amount_minor": 10_000,
                "basket_has_promotion": true }),
    )
    .await;
    assert_eq!(
        promo.status,
        StatusCode::CONFLICT,
        "no combining with a promotion: {:?}",
        promo.body
    );
    let over = till(
        "/api/v1/benefit/spends",
        json!({ "code": code, "sale_ref": "S-1", "unit_id": "store-07", "amount_minor": 260_000 }),
    )
    .await;
    assert_eq!(over.status, StatusCode::CONFLICT, "{:?}", over.body);
    let spent = till(
        "/api/v1/benefit/spends",
        json!({ "code": code, "sale_ref": "S-1", "unit_id": "store-07", "amount_minor": 200_000 }),
    )
    .await;
    assert_eq!(spent.status, StatusCode::OK, "{:?}", spent.body);
    assert_eq!(spent.body["balance_minor"], 50_000);
    let reused = till(
        "/api/v1/benefit/spends",
        json!({ "code": code, "sale_ref": "S-2", "unit_id": "store-07", "amount_minor": 1_000 }),
    )
    .await;
    assert_eq!(
        reused.status,
        StatusCode::NOT_FOUND,
        "a code is used once: {:?}",
        reused.body
    );
    let fresh = as_her("/api/v1/employees/me/benefit-code").await;
    let fresh = fresh.body["code"].as_str().unwrap_or_default().to_owned();
    let twice = till(
        "/api/v1/benefit/spends",
        json!({ "code": fresh, "sale_ref": "S-1", "unit_id": "store-07", "amount_minor": 1_000 }),
    )
    .await;
    assert_eq!(
        twice.status,
        StatusCode::CONFLICT,
        "one spend per sale: {:?}",
        twice.body
    );

    // Nobody rings up their own balance.
    let his_code = send(
        hub.app.clone(),
        "POST",
        "/api/v1/employees/me/benefit-code",
        write_headers(&his, &his_csrf),
        Some(json!({})),
    )
    .await;
    let his_code = his_code.body["code"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let own = till(
        "/api/v1/benefit/spends",
        json!({ "code": his_code, "sale_ref": "S-3", "unit_id": "store-07", "amount_minor": 1_000 }),
    )
    .await;
    assert_eq!(own.status, StatusCode::FORBIDDEN, "{:?}", own.body);

    // A return gives the spent part back, no more.
    let back = till(
        "/api/v1/benefit/returns",
        json!({ "sale_ref": "S-1", "amount_minor": 120_000, "reason": "retur 1 pcs" }),
    )
    .await;
    assert_eq!(back.status, StatusCode::OK, "{:?}", back.body);
    assert_eq!(back.body, 170_000);
    let beyond = till(
        "/api/v1/benefit/returns",
        json!({ "sale_ref": "S-1", "amount_minor": 90_000, "reason": "lagi" }),
    )
    .await;
    assert_eq!(beyond.status, StatusCode::CONFLICT, "{:?}", beyond.body);

    let list = hub.get("/api/v1/benefit/balances").await;
    let row = list
        .body
        .as_array()
        .and_then(|rows| rows.iter().find(|r| r["employee_id"] == siti.as_str()))
        .cloned()
        .unwrap_or_default();
    assert_eq!(row["balance_minor"], 170_000);
    let hr_reads_her = send(
        hub.app.clone(),
        "GET",
        &format!("/api/v1/employees/{budi}/benefit"),
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(
        hr_reads_her.status,
        StatusCode::FORBIDDEN,
        "a colleague's balance is HR's: {:?}",
        hr_reads_her.body
    );
}
