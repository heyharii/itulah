//! Attendance settings (0807): the employee app's punch rules and the units'
//! fences, a shift's break, and what an absence costs.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-attendance-1";

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

async fn shift_and_days(hub: &Hub, employee: &str, days: &[String]) {
    hub.ok(
        "/api/v1/attendance-shifts",
        json!({ "id": "PAGI", "name": "Pagi", "starts_at": "07:00", "ends_at": "15:00",
                "unpaid_break_minutes": 60 }),
    )
    .await;
    for day in days {
        hub.ok(
            &format!("/api/v1/employees/{employee}/roster"),
            json!({ "on_date": day, "plan": "SCHEDULED", "shift_id": "PAGI", "reason": "jadwal" }),
        )
        .await;
    }
}

async fn cashier(hub: &Hub, employee: &str, username: &str) -> (String, String) {
    hub.ok(
        "/api/v1/auth/users",
        json!({ "username": username, "display_name": username, "password": "cashier-pass-attend-1", "role": "CASHIER" }),
    )
    .await;
    hub.ok(
        &format!("/api/v1/employees/{employee}/account"),
        json!({ "username": username, "reason": "akun staf" }),
    )
    .await;
    sign_in(&hub.app, username, "cashier-pass-attend-1").await
}

/// A phone punch follows the company's rules: refused when the app is off,
/// refused without a location when one is required, refused outside the
/// unit's fence when the fence is required — and when it lands, it keeps
/// where it was and how far from the fence.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_phone_punch_keeps_to_the_fence(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let siti = hub.staff("K0901", "store-07", "2026-01-05").await;
    let today = chrono::Utc::now().date_naive().to_string();
    shift_and_days(&hub, &siti, &[today]).await;
    let (cookies, csrf) = cashier(&hub, &siti, "siti.fence").await;
    let punch = |body: Value| {
        send(
            hub.app.clone(),
            "POST",
            "/api/v1/employees/me/punches",
            write_headers(&cookies, &csrf),
            Some(body),
        )
    };

    let unfenceable = hub
        .post(
            "/api/v1/attendance/mobile-setting",
            json!({ "mobile_enabled": true, "require_location": false, "require_geofence": true, "reason": "salah" }),
        )
        .await;
    assert_eq!(
        unfenceable.status,
        StatusCode::BAD_REQUEST,
        "{:?}",
        unfenceable.body
    );

    hub.ok(
        "/api/v1/attendance/mobile-setting",
        json!({ "mobile_enabled": true, "require_location": true, "require_geofence": true, "reason": "absen di toko" }),
    )
    .await;
    hub.ok(
        "/api/v1/attendance/geofences/store-07",
        json!({ "latitude": -6.2, "longitude": 106.8, "radius_m": 100, "reason": "titik toko" }),
    )
    .await;

    let own = send(
        hub.app.clone(),
        "GET",
        "/api/v1/employees/me/attendance-setting",
        read_headers(&cookies),
        None,
    )
    .await;
    assert_eq!(own.status, StatusCode::OK, "{:?}", own.body);
    assert_eq!(own.body["fence"]["radius_m"], 100);
    assert_eq!(own.body["setting"]["require_location"], true);

    let blind = punch(json!({ "direction": "IN" })).await;
    assert_eq!(blind.status, StatusCode::BAD_REQUEST, "{:?}", blind.body);
    let away = punch(json!({ "direction": "IN", "latitude": -6.3, "longitude": 106.8 })).await;
    assert_eq!(away.status, StatusCode::FORBIDDEN, "{:?}", away.body);
    assert!(away.body["error"]
        .as_str()
        .unwrap_or_default()
        .contains("outside"));

    let inside = punch(json!({ "direction": "IN", "latitude": -6.2003, "longitude": 106.8 })).await;
    assert_eq!(inside.status, StatusCode::OK, "{:?}", inside.body);
    let kept: (f64, i32) =
        sqlx::query_as("SELECT latitude, distance_m FROM attendance_punch WHERE id = $1")
            .bind(inside.body["punch_id"].as_str().unwrap_or_default())
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("punch row: {error}"));
    assert!((kept.0 - -6.2003).abs() < 1e-9);
    assert!((30..=36).contains(&kept.1), "about 33 m: {}", kept.1);

    hub.ok(
        "/api/v1/attendance/mobile-setting",
        json!({ "mobile_enabled": false, "require_location": false, "require_geofence": false, "reason": "pakai mesin" }),
    )
    .await;
    let off = punch(json!({ "direction": "OUT" })).await;
    assert_eq!(off.status, StatusCode::FORBIDDEN, "{:?}", off.body);
}

/// An absence — a rostered day gone by with no punch, no leave and no
/// correction — is counted on the slip, and once head office states the rule
/// it costs a share of the base and comes off the taxable gross.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_absence_costs_a_day_once_the_rule_is_stated(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let siti = hub.staff("K0902", "store-07", "2026-01-05").await;
    hub.pay(&siti, "2026-01-01", 5_000_000, json!([])).await;
    hub.identity(&siti, "ptkp", "TK/0").await;
    let days: Vec<String> = ["2026-04-06", "2026-04-07", "2026-04-08"]
        .iter()
        .map(|d| (*d).to_owned())
        .collect();
    shift_and_days(&hub, &siti, &days).await;

    let (april, slips) = hub.run("store-07", "2026-04").await;
    let slip = slip_of(&slips, &siti);
    assert_eq!(slip["absent_days"], 3);
    assert!(
        !slip["deductions"].as_array().is_some_and(|lines| lines
            .iter()
            .any(|l| l["component_code"] == "POTONGAN_ABSEN")),
        "no rule, no deduction: {slip:?}"
    );

    let stated = hub
        .ok(
            "/api/v1/payroll/absence-rules",
            json!({ "effective_from": "2026-04-01", "enabled": true, "basis": "BASE",
                    "divisor_days": 25, "reason": "potongan absen" }),
        )
        .await;
    assert_eq!(stated[0]["divisor_days"], 25);
    hub.ok(&format!("/api/v1/payroll/runs/{april}/rebuild"), json!({}))
        .await;
    let slips = hub
        .get(&format!("/api/v1/payroll/runs/{april}/slips"))
        .await;
    let slips = slips.body.as_array().cloned().unwrap_or_default();
    let slip = slip_of(&slips, &siti);
    let line = slip["deductions"]
        .as_array()
        .and_then(|lines| {
            lines
                .iter()
                .find(|l| l["component_code"] == "POTONGAN_ABSEN")
        })
        .cloned()
        .unwrap_or_else(|| panic!("no absence line: {slip:?}"));
    assert_eq!(line["amount_minor"], 600_000);
    assert_eq!(line["base_of_minor"], 5_000_000);
    assert_eq!(slip["taxable_gross_minor"], 4_400_000);

    let bad = hub
        .post(
            "/api/v1/payroll/absence-rules",
            json!({ "effective_from": "2026-05-01", "enabled": true, "basis": "BONUS", "reason": "salah" }),
        )
        .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST, "{:?}", bad.body);
}

/// A shift's break has a start, and it must sit inside the shift — across
/// midnight too.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_break_starts_inside_its_shift(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let shifts = hub
        .ok(
            "/api/v1/attendance-shifts",
            json!({ "id": "PAGI", "name": "Pagi", "starts_at": "08:00", "ends_at": "17:00",
                    "unpaid_break_minutes": 60, "break_starts_at": "12:00" }),
        )
        .await;
    assert_eq!(shifts[0]["break_starts_at"], "12:00");
    let night = hub
        .ok(
            "/api/v1/attendance-shifts",
            json!({ "id": "MALAM", "name": "Malam", "starts_at": "22:00", "ends_at": "06:00",
                    "crosses_midnight": true, "unpaid_break_minutes": 30, "break_starts_at": "02:00" }),
        )
        .await;
    let malam = night
        .as_array()
        .and_then(|rows| rows.iter().find(|s| s["id"] == "MALAM"))
        .cloned();
    assert_eq!(
        malam.map(|s| s["break_starts_at"].clone()),
        Some(json!("02:00"))
    );

    let outside = hub
        .post(
            "/api/v1/attendance-shifts",
            json!({ "id": "SORE", "name": "Sore", "starts_at": "08:00", "ends_at": "17:00",
                    "unpaid_break_minutes": 60, "break_starts_at": "16:30" }),
        )
        .await;
    assert_eq!(
        outside.status,
        StatusCode::BAD_REQUEST,
        "{:?}",
        outside.body
    );
}

/// A long rest day is paid by the hour it falls in (Kepmenaker 102/2004):
/// seven hours at 2×, the eighth at 3×, the ninth at 4× on a six-day week —
/// the tiers carried by components paying the *extra* over the 2× band.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_long_rest_day_is_paid_by_the_hour_it_falls_in(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let siti = hub.staff("K0903", "store-07", "2026-01-05").await;
    // 5,190,000 / 173 = 30,000 an hour.
    hub.pay(&siti, "2026-01-01", 5_190_000, json!([])).await;
    hub.identity(&siti, "ptkp", "TK/0").await;
    let (cookies, csrf) = cashier(&hub, &siti, "siti.lembur").await;

    let tier = hub.get("/api/v1/payroll/overtime-tier").await;
    assert_eq!(tier.body["rest_day_first_tier_minutes"], 420);
    let refused = hub
        .post(
            "/api/v1/payroll/overtime-tier",
            json!({ "rest_day_first_tier_minutes": 400, "reason": "salah" }),
        )
        .await;
    assert_eq!(
        refused.status,
        StatusCode::BAD_REQUEST,
        "{:?}",
        refused.body
    );

    hub.ok(
        "/api/v1/overtime-policy",
        json!({ "version": 1, "max_per_day_minutes": 720, "max_per_week_minutes": 1440, "reason": "batas lembur" }),
    )
    .await;
    hub.ok(
        &format!("/api/v1/employees/{siti}/overtime-orders"),
        json!({ "order_id": "OT-R1", "on_date": "2026-04-19", "day_kind": "REST",
                "planned_minutes": 540, "reason": "stok opname" }),
    )
    .await;
    let agreed = send(
        hub.app.clone(),
        "POST",
        "/api/v1/employees/me/overtime-orders/OT-R1/consent",
        write_headers(&cookies, &csrf),
        Some(json!({ "agreed": true, "reason": "setuju" })),
    )
    .await;
    assert_eq!(agreed.status, StatusCode::OK, "{:?}", agreed.body);

    for (code, unit, multiplier) in [
        ("LEMBUR_LIBUR", "OVERTIME_REST_DAY", 20_000),
        ("LEMBUR_LIBUR_JAM_8", "OVERTIME_REST_DAY_NEXT_HOUR", 10_000),
        ("LEMBUR_LIBUR_JAM_9", "OVERTIME_REST_DAY_BEYOND", 20_000),
    ] {
        hub.ok(
            "/api/v1/payroll/components",
            json!({ "code": code, "label": code, "kind": "EARNING",
                    "basis": "FRACTION_OF_BASE_PER_UNIT", "base_ref": "STATUTORY_BASE",
                    "unit": unit, "reason": "Kepmenaker 102/2004 pasal 11" }),
        )
        .await;
        hub.ok(
            &format!("/api/v1/payroll/components/{code}/rates"),
            json!({ "effective_from": "2026-01-01", "hours_divisor": 173,
                    "multiplier_bp": multiplier, "reason": "pengali lembur" }),
        )
        .await;
    }

    let (_, slips) = hub.run("store-07", "2026-04").await;
    let slip = slip_of(&slips, &siti);
    let earned = |code: &str| {
        slip["earnings"]
            .as_array()
            .and_then(|lines| lines.iter().find(|l| l["component_code"] == code))
            .and_then(|l| l["amount_minor"].as_i64())
    };
    assert_eq!(earned("LEMBUR_LIBUR"), Some(540_000), "9 h × 2: {slip:?}");
    assert_eq!(
        earned("LEMBUR_LIBUR_JAM_8"),
        Some(30_000),
        "the 8th hour, +1×"
    );
    assert_eq!(
        earned("LEMBUR_LIBUR_JAM_9"),
        Some(60_000),
        "the 9th hour, +2×"
    );
    assert_eq!(slip["overtime_minutes"], 540);
}
