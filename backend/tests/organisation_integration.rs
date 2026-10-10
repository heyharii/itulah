//! The organisation (0805): departments, job levels, grades, where somebody
//! sits from a date and whom they report to, and the company's BPJS numbers.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-organisation-1";

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
}

/// Departments sit inside departments, never inside themselves; a level's
/// rank is its own; a grade sits on a level; and one in use cannot be retired.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_structure_is_departments_levels_and_grades(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    hub.ok(
        "/api/v1/org/departments",
        json!({ "code": "OPS", "name": "Operasional", "reason": "struktur" }),
    )
    .await;
    let saved = hub
        .ok(
            "/api/v1/org/departments",
            json!({ "code": "toko", "name": "Toko", "parent_code": "OPS", "reason": "struktur" }),
        )
        .await;
    let toko = saved
        .as_array()
        .and_then(|rows| rows.iter().find(|d| d["code"] == "TOKO"))
        .cloned();
    assert_eq!(toko.map(|d| d["parent_code"].clone()), Some(json!("OPS")));

    let looped = hub
        .post(
            "/api/v1/org/departments",
            json!({ "code": "OPS", "name": "Operasional", "parent_code": "TOKO", "reason": "salah" }),
        )
        .await;
    assert_eq!(looped.status, StatusCode::BAD_REQUEST, "{:?}", looped.body);

    hub.ok(
        "/api/v1/org/levels",
        json!({ "code": "MGR", "name": "Manager", "rank": 2, "reason": "level" }),
    )
    .await;
    hub.ok(
        "/api/v1/org/levels",
        json!({ "code": "STAFF", "name": "Staff", "rank": 4, "reason": "level" }),
    )
    .await;
    let same_rank = hub
        .post(
            "/api/v1/org/levels",
            json!({ "code": "SPV", "name": "Supervisor", "rank": 4, "reason": "level" }),
        )
        .await;
    assert_eq!(
        same_rank.status,
        StatusCode::CONFLICT,
        "{:?}",
        same_rank.body
    );

    let grades = hub
        .ok(
            "/api/v1/org/job-grades",
            json!({
                "code": "G3", "name": "Grade 3", "level_code": "STAFF", "grade_class": "3A",
                "min_minor": 5_000_000, "max_minor": 7_000_000, "reason": "grade",
            }),
        )
        .await;
    assert_eq!(grades[0]["level_code"], "STAFF");
    assert_eq!(grades[0]["grade_class"], "3A");
    let upside_down = hub
        .post(
            "/api/v1/org/job-grades",
            json!({ "code": "G4", "name": "Grade 4", "min_minor": 9_000_000, "max_minor": 7_000_000, "reason": "grade" }),
        )
        .await;
    assert_eq!(
        upside_down.status,
        StatusCode::BAD_REQUEST,
        "{:?}",
        upside_down.body
    );

    // In use: refused. Out of use: retired, and no longer offered to a placement.
    let siti = hub.staff("K0801", "store-07", "2026-01-05").await;
    hub.ok(
        &format!("/api/v1/employees/{siti}/placements"),
        json!({ "effective_from": "2026-01-05", "department_code": "TOKO", "level_code": "STAFF",
                "grade_code": "G3", "reason": "penempatan" }),
    )
    .await;
    let busy = hub
        .post(
            "/api/v1/org/levels/STAFF/retirement",
            json!({ "reason": "tidak dipakai" }),
        )
        .await;
    assert_eq!(busy.status, StatusCode::CONFLICT, "{:?}", busy.body);
    let retired = hub
        .ok(
            "/api/v1/org/levels/MGR/retirement",
            json!({ "reason": "tidak dipakai" }),
        )
        .await;
    let mgr = retired
        .as_array()
        .and_then(|rows| rows.iter().find(|l| l["code"] == "MGR"))
        .cloned();
    assert_eq!(mgr.map(|l| l["retired"].clone()), Some(json!(true)));
    let on_retired = hub
        .post(
            &format!("/api/v1/employees/{siti}/placements"),
            json!({ "effective_from": "2026-03-01", "level_code": "MGR", "reason": "promosi" }),
        )
        .await;
    assert_eq!(
        on_retired.status,
        StatusCode::BAD_REQUEST,
        "{:?}",
        on_retired.body
    );
}

/// A placement is dated and kept; the line of report cannot loop; the chart
/// is everybody working today, placed or not.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_placement_is_dated_and_the_line_of_report_has_a_top(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    hub.ok(
        "/api/v1/org/departments",
        json!({ "code": "TOKO", "name": "Toko", "reason": "struktur" }),
    )
    .await;
    let boss = hub.staff("K0811", "store-07", "2026-01-05").await;
    let siti = hub.staff("K0812", "store-07", "2026-01-05").await;
    let dewi = hub.staff("K0813", "store-07", "2026-01-05").await;

    hub.ok(
        &format!("/api/v1/employees/{siti}/placements"),
        json!({ "effective_from": "2026-01-05", "department_code": "TOKO", "reports_to": boss, "reason": "penempatan" }),
    )
    .await;
    let history = hub
        .ok(
            &format!("/api/v1/employees/{siti}/placements"),
            json!({ "effective_from": "2026-06-01", "department_code": "TOKO", "reports_to": dewi, "reason": "pindah atasan" }),
        )
        .await;
    assert_eq!(history.as_array().map(Vec::len), Some(2));
    assert_eq!(history[0]["effective_from"], "2026-06-01");
    assert_eq!(history[1]["reports_to"], boss);

    // Dewi reports to Siti, who reports to Dewi: refused.
    let looped = hub
        .post(
            &format!("/api/v1/employees/{dewi}/placements"),
            json!({ "effective_from": "2026-06-01", "reports_to": siti, "reason": "salah" }),
        )
        .await;
    assert_eq!(looped.status, StatusCode::BAD_REQUEST, "{:?}", looped.body);
    let own = hub
        .post(
            &format!("/api/v1/employees/{dewi}/placements"),
            json!({ "effective_from": "2026-06-01", "reports_to": dewi, "reason": "salah" }),
        )
        .await;
    assert_eq!(own.status, StatusCode::BAD_REQUEST, "{:?}", own.body);

    let chart = hub.get("/api/v1/org/chart").await;
    assert_eq!(chart.status, StatusCode::OK, "{:?}", chart.body);
    let nodes = chart.body.as_array().cloned().unwrap_or_default();
    let node = |id: &str| nodes.iter().find(|n| n["employee_id"] == id).cloned();
    assert_eq!(
        node(&siti).map(|n| n["department_code"].clone()),
        Some(json!("TOKO"))
    );
    assert_eq!(
        node(&boss).map(|n| n["department_code"].clone()),
        Some(Value::Null)
    );
    assert_eq!(
        node(&dewi).map(|n| n["unit_id"].clone()),
        Some(json!("store-07"))
    );
}

/// The company's BPJS numbers are a history: a new registration is a new
/// row from a date, and the same date twice is refused.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_company_bpjs_registration_is_a_history(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    hub.ok(
        "/api/v1/org/bpjs-registration",
        json!({ "effective_from": "2025-01-01", "npp": "NN000123", "kesehatan_code": "0001234",
                "jkk_risk_class": "i", "reason": "pendaftaran" }),
    )
    .await;
    let company = hub
        .ok(
            "/api/v1/org/bpjs-registration",
            json!({ "effective_from": "2026-01-01", "npp": "NN000999", "jkk_risk_class": "II",
                    "reason": "pindah kelas risiko" }),
        )
        .await;
    assert_eq!(company["bpjs"][0]["npp"], "NN000999");
    assert_eq!(company["bpjs"][1]["jkk_risk_class"], "I");
    let again = hub
        .post(
            "/api/v1/org/bpjs-registration",
            json!({ "effective_from": "2026-01-01", "npp": "X", "reason": "ulang" }),
        )
        .await;
    assert_eq!(again.status, StatusCode::CONFLICT, "{:?}", again.body);
    let bad = hub
        .post(
            "/api/v1/org/bpjs-registration",
            json!({ "effective_from": "2026-02-01", "jkk_risk_class": "VI", "reason": "salah" }),
        )
        .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST, "{:?}", bad.body);
    let read = hub.get("/api/v1/org/company").await;
    assert_eq!(read.status, StatusCode::OK, "{:?}", read.body);
}

/// A business unit groups units; naming a unit in a second one moves it. The
/// group has one holding.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn business_units_group_units_and_the_group_has_one_holding(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    hub.ok(
        "/api/v1/org/business-units",
        json!({ "code": "RETAIL", "name": "Retail", "units": ["store-07", "store-01"], "reason": "sbu" }),
    )
    .await;
    let moved = hub
        .ok(
            "/api/v1/org/business-units",
            json!({ "code": "FLAGSHIP", "name": "Flagship", "units": ["store-07"], "reason": "sbu" }),
        )
        .await;
    let units = |code: &str| {
        moved
            .as_array()
            .and_then(|rows| rows.iter().find(|b| b["code"] == code))
            .map(|b| b["units"].clone())
    };
    assert_eq!(units("FLAGSHIP"), Some(json!(["store-07"])));
    assert_eq!(units("RETAIL"), Some(json!(["store-01"])));
    let unknown = hub
        .post(
            "/api/v1/org/business-units",
            json!({ "code": "X", "name": "X", "units": ["nowhere"], "reason": "sbu" }),
        )
        .await;
    assert_eq!(
        unknown.status,
        StatusCode::BAD_REQUEST,
        "{:?}",
        unknown.body
    );

    hub.ok(
        "/api/v1/org/group",
        json!({ "code": "HOLD", "name": "PT Induk", "relation": "holding", "tax_id": "01.234.567.8-901.000", "reason": "grup" }),
    )
    .await;
    let second = hub
        .post(
            "/api/v1/org/group",
            json!({ "code": "HOLD2", "name": "PT Lain", "relation": "HOLDING", "reason": "grup" }),
        )
        .await;
    assert_eq!(second.status, StatusCode::CONFLICT, "{:?}", second.body);
    let group = hub
        .ok(
            "/api/v1/org/group",
            json!({ "code": "ANAK", "name": "PT Anak", "relation": "SUBSIDIARY", "reason": "grup" }),
        )
        .await;
    assert_eq!(group[0]["relation"], "HOLDING");
    assert_eq!(group[0]["tax_id"], "012345678901000");
    assert_eq!(group[1]["code"], "ANAK");
}

/// Head office shapes the onboarding checklist: a task it adds reaches the
/// next hire, a retired one (the uniform tasks, since 0806) does not.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_onboarding_checklist_is_head_offices_to_shape(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let templates = hub
        .ok(
            "/api/v1/lifecycle/templates",
            json!({ "id": "laptop", "label": "Laptop diserahkan", "owner": "IT",
                    "kind": "ONBOARDING", "position": 9, "reason": "checklist" }),
        )
        .await;
    let find = |id: &str| {
        templates
            .as_array()
            .and_then(|rows| rows.iter().find(|t| t["id"] == id))
            .cloned()
    };
    assert_eq!(
        find("seragam").map(|t| t["retired"].clone()),
        Some(json!(true))
    );
    // No uniform and no ID card comes back at separation either (0815).
    assert_eq!(
        find("seragam-kembali").map(|t| t["retired"].clone()),
        Some(json!(true))
    );
    assert_eq!(
        find("laptop").map(|t| t["owner"].clone()),
        Some(json!("IT"))
    );

    hub.ok(
        "/api/v1/lifecycle/templates/akun/retirement",
        json!({ "reason": "tidak dipakai" }),
    )
    .await;
    let wrong_kind = hub
        .post(
            "/api/v1/lifecycle/templates",
            json!({ "id": "laptop", "label": "Laptop", "owner": "IT", "kind": "SEPARATION",
                    "position": 9, "reason": "salah" }),
        )
        .await;
    assert_eq!(
        wrong_kind.status,
        StatusCode::CONFLICT,
        "{:?}",
        wrong_kind.body
    );

    let siti = hub.staff("K0821", "store-07", "2026-01-05").await;
    hub.post(
        &format!("/api/v1/employees/{siti}/lifecycle-tasks"),
        json!({ "kind": "ONBOARDING" }),
    )
    .await;
    let tasks = hub
        .get(&format!("/api/v1/employees/{siti}/lifecycle-tasks"))
        .await;
    assert_eq!(tasks.status, StatusCode::OK, "{:?}", tasks.body);
    let ids: Vec<String> = tasks
        .body
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|t| t["template_id"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    assert!(ids.contains(&"laptop".to_owned()), "{ids:?}");
    assert!(!ids.contains(&"seragam".to_owned()), "{ids:?}");
    assert!(!ids.contains(&"akun".to_owned()), "{ids:?}");
}

/// A warning letter is issued in force for six months, acknowledged by the
/// person from their own app, listed while active, and revocable.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_warning_letter_is_issued_acknowledged_and_revoked(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let siti = hub.staff("K0831", "store-07", "2026-01-05").await;
    let today = chrono::Utc::now().date_naive();
    let issued = hub
        .ok(
            &format!("/api/v1/employees/{siti}/warning-letters"),
            json!({ "level": "sp1", "issued_on": today.to_string(),
                    "violation": "terlambat 5 kali dalam sebulan", "reason": "pembinaan" }),
        )
        .await;
    assert_eq!(issued[0]["level"], "SP1");
    assert_eq!(issued[0]["active"], true);
    let lapses = today
        .checked_add_months(chrono::Months::new(6))
        .and_then(|d| d.pred_opt())
        .map(|d| d.to_string());
    assert_eq!(issued[0]["valid_until"].as_str().map(str::to_owned), lapses);
    let id = issued[0]["id"].as_str().unwrap_or_default().to_owned();

    let wrong = hub
        .post(
            &format!("/api/v1/employees/{siti}/warning-letters"),
            json!({ "level": "SP4", "issued_on": today.to_string(), "violation": "x", "reason": "salah" }),
        )
        .await;
    assert_eq!(wrong.status, StatusCode::BAD_REQUEST, "{:?}", wrong.body);

    hub.ok(
        "/api/v1/auth/users",
        json!({ "username": "siti.sp", "display_name": "Siti", "password": "siti-login-pass-sp1", "role": "CASHIER" }),
    )
    .await;
    hub.ok(
        &format!("/api/v1/employees/{siti}/account"),
        json!({ "username": "siti.sp", "reason": "akun staf" }),
    )
    .await;
    let (hers, her_csrf) = sign_in(&hub.app, "siti.sp", "siti-login-pass-sp1").await;
    let mine = send(
        hub.app.clone(),
        "GET",
        "/api/v1/employees/me/warning-letters",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(mine.status, StatusCode::OK, "{:?}", mine.body);
    let acked = send(
        hub.app.clone(),
        "POST",
        &format!("/api/v1/employees/me/warning-letters/{id}/acknowledgement"),
        write_headers(&hers, &her_csrf),
        None,
    )
    .await;
    assert_eq!(acked.status, StatusCode::OK, "{:?}", acked.body);
    assert!(acked.body[0]["acknowledged_at"].is_string());

    let active = hub.get("/api/v1/warning-letters").await;
    assert_eq!(active.body.as_array().map(Vec::len), Some(1));
    let revoked = hub
        .ok(
            &format!("/api/v1/warning-letters/{id}/revocation"),
            json!({ "reason": "salah orang" }),
        )
        .await;
    assert_eq!(revoked[0]["active"], false);
    let active = hub.get("/api/v1/warning-letters").await;
    assert_eq!(active.body.as_array().map(Vec::len), Some(0));
    let every = hub.get("/api/v1/warning-letters?all=true").await;
    assert_eq!(every.body.as_array().map(Vec::len), Some(1));
    assert_eq!(every.body[0]["revoked"], true);
}

/// Head office chooses the employee app's modules; an unknown one is refused,
/// and an employee reads the choice through `me`.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_employee_app_shows_the_modules_turned_on(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let all = hub.get("/api/v1/ess-modules").await;
    assert_eq!(all.body["modules"].as_array().map(Vec::len), Some(7));
    let set = hub
        .ok(
            "/api/v1/ess-modules",
            json!({ "modules": ["leave", "PAY", "ATTENDANCE"], "reason": "tahap awal" }),
        )
        .await;
    assert_eq!(set["modules"], json!(["ATTENDANCE", "LEAVE", "PAY"]));
    let unknown = hub
        .post(
            "/api/v1/ess-modules",
            json!({ "modules": ["PAYROLL"], "reason": "salah" }),
        )
        .await;
    assert_eq!(
        unknown.status,
        StatusCode::BAD_REQUEST,
        "{:?}",
        unknown.body
    );

    let siti = hub.staff("K0841", "store-07", "2026-01-05").await;
    hub.ok(
        "/api/v1/auth/users",
        json!({ "username": "siti.ess", "display_name": "Siti", "password": "siti-login-pass-ess", "role": "CASHIER" }),
    )
    .await;
    hub.ok(
        &format!("/api/v1/employees/{siti}/account"),
        json!({ "username": "siti.ess", "reason": "akun" }),
    )
    .await;
    let (hers, _) = sign_in(&hub.app, "siti.ess", "siti-login-pass-ess").await;
    let mine = send(
        hub.app.clone(),
        "GET",
        "/api/v1/employees/me/ess-modules",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(mine.status, StatusCode::OK, "{:?}", mine.body);
    assert_eq!(mine.body["modules"], json!(["ATTENDANCE", "LEAVE", "PAY"]));
}

/// An employee asks for a new phone and address from their own app; HR sees
/// it waiting, approves the phone (the record changes, signed by HR) and
/// rejects the address. Nobody files for somebody else, nobody decides their
/// own, and a decided request does not move again.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_employee_asks_for_a_detail_to_change_and_hr_decides(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let siti = hub.staff("K0970", "store-07", "2026-01-05").await;
    hub.ok(
        &format!("/api/v1/employees/{siti}/personal-data"),
        json!({ "full_name": "Siti Rahayu", "nik": "3174051234500012", "birth_date": "1998-05-12",
                "address": "Jl. Merdeka 17, Bandung" }),
    )
    .await;
    hub.ok(
        "/api/v1/auth/users",
        json!({ "username": "siti.pdr", "display_name": "Siti", "password": "siti-login-pass-pdr", "role": "CASHIER" }),
    )
    .await;
    hub.ok(
        &format!("/api/v1/employees/{siti}/account"),
        json!({ "username": "siti.pdr", "reason": "akun staf" }),
    )
    .await;
    let (hers, her_csrf) = sign_in(&hub.app, "siti.pdr", "siti-login-pass-pdr").await;
    let ask = |body: Value| {
        send(
            hub.app.clone(),
            "POST",
            "/api/v1/employees/me/personal-data-requests",
            write_headers(&hers, &her_csrf),
            Some(body),
        )
    };

    let phone =
        ask(json!({ "field": "phone", "value": "081234567890", "reason": "nomor baru" })).await;
    assert_eq!(phone.status, StatusCode::OK, "{:?}", phone.body);
    let again = ask(json!({ "field": "phone", "value": "0811", "reason": "lagi" })).await;
    assert_eq!(
        again.status,
        StatusCode::CONFLICT,
        "one waiting per field: {:?}",
        again.body
    );
    let nik = ask(json!({ "field": "nik", "value": "1", "reason": "x" })).await;
    assert_eq!(
        nik.status,
        StatusCode::BAD_REQUEST,
        "NIK changes with HR: {:?}",
        nik.body
    );
    let moved =
        ask(json!({ "field": "address", "value": "Jl. Sudirman 1, Jakarta", "reason": "pindah" }))
            .await;
    assert_eq!(moved.status, StatusCode::OK, "{:?}", moved.body);
    assert_eq!(moved.body.as_array().map(Vec::len), Some(2));

    let for_her = hub
        .post(
            &format!("/api/v1/employees/{siti}/personal-data-requests"),
            json!({ "field": "phone", "value": "0812", "reason": "x" }),
        )
        .await;
    assert_eq!(
        for_her.status,
        StatusCode::FORBIDDEN,
        "HR edits directly: {:?}",
        for_her.body
    );
    let her_queue = send(
        hub.app.clone(),
        "GET",
        "/api/v1/personal-data-requests",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(
        her_queue.status,
        StatusCode::FORBIDDEN,
        "{:?}",
        her_queue.body
    );

    let queue = hub.get("/api/v1/personal-data-requests").await;
    assert_eq!(queue.status, StatusCode::OK, "{:?}", queue.body);
    let waiting = queue.body.as_array().cloned().unwrap_or_default();
    assert_eq!(waiting.len(), 2);
    let id_of = |field: &str| {
        waiting
            .iter()
            .find(|row| row["field"] == field)
            .and_then(|row| row["id"].as_str())
            .unwrap_or_default()
            .to_owned()
    };
    let address_row = waiting
        .iter()
        .find(|row| row["field"] == "address")
        .cloned()
        .unwrap_or_default();
    assert_eq!(address_row["current"], "Jl. Merdeka 17, Bandung");

    let approved = hub
        .ok(
            &format!("/api/v1/personal-data-requests/{}/decision", id_of("phone")),
            json!({ "approve": true, "reason": "sesuai" }),
        )
        .await;
    assert_eq!(approved["state"], "APPROVED");
    assert_eq!(approved["decided_by"], "admin");
    let rejected = hub
        .ok(
            &format!(
                "/api/v1/personal-data-requests/{}/decision",
                id_of("address")
            ),
            json!({ "approve": false, "reason": "lampirkan KTP/domisili" }),
        )
        .await;
    assert_eq!(rejected["state"], "REJECTED");
    let twice = hub
        .post(
            &format!("/api/v1/personal-data-requests/{}/decision", id_of("phone")),
            json!({ "approve": true, "reason": "lagi" }),
        )
        .await;
    assert_eq!(twice.status, StatusCode::CONFLICT, "{:?}", twice.body);

    let record = hub
        .get(&format!("/api/v1/employees/{siti}/personal-data"))
        .await;
    assert_eq!(record.status, StatusCode::OK, "{:?}", record.body);
    assert_eq!(
        record.body["phone"], "081234567890",
        "approved: {:?}",
        record.body
    );
    assert_eq!(
        record.body["address"], "Jl. Merdeka 17, Bandung",
        "rejected leaves it"
    );
    let mine = send(
        hub.app.clone(),
        "GET",
        "/api/v1/employees/me/personal-data-requests",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(
        mine.body[0]["decision_reason"].as_str().is_some(),
        true,
        "{:?}",
        mine.body
    );

    // Withdrawn by her while it waits; HR's queue empties.
    let email =
        ask(json!({ "field": "email", "value": "siti@contoh.id", "reason": "email baru" })).await;
    let email_id = email.body[0]["id"].as_str().unwrap_or_default().to_owned();
    let withdrawn = send(
        hub.app.clone(),
        "POST",
        &format!("/api/v1/personal-data-requests/{email_id}/withdrawal"),
        write_headers(&hers, &her_csrf),
        Some(json!({ "reason": "tidak jadi" })),
    )
    .await;
    assert_eq!(withdrawn.status, StatusCode::OK, "{:?}", withdrawn.body);
    let left = hub.get("/api/v1/personal-data-requests").await;
    assert_eq!(
        left.body.as_array().map(Vec::len),
        Some(0),
        "{:?}",
        left.body
    );
}
