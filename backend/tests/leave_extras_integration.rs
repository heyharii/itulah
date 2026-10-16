//! Leave beyond requests (0809): blocked dates, a roster's rest days, paying
//! days out, a holiday worked earning a day back, and the team's calendar.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-leave-extras-1";

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

async fn leave_setup(hub: &Hub, encashable: Option<i32>) {
    hub.ok(
        "/api/v1/holiday-calendars",
        json!({
            "year": 2026,
            "holidays": [
                { "date": "2026-04-07", "name": "Cuti Bersama", "kind": "CUTI_BERSAMA" },
                { "date": "2026-05-01", "name": "Hari Buruh", "kind": "NATIONAL" },
            ],
            "reason": "SKB tiga menteri 2026",
        }),
    )
    .await;
    hub.ok(
        "/api/v1/leave-types",
        json!({ "code": "CUTI_TAHUNAN", "name": "Cuti Tahunan", "backing": "BALANCE", "payment": "FULL" }),
    )
    .await;
    let mut policy = json!({
        "version": 1, "effective_from": "2026-01-01", "annual_days": 12, "accrual": "UP_FRONT",
        "protected_leave": "CONTINUES",
    });
    if let Some(days) = encashable {
        policy["encashment_max_days"] = json!(days);
    }
    hub.ok("/api/v1/leave-policy", policy).await;
}

async fn allocate(hub: &Hub, employee: &str, days: i32) {
    hub.ok(
        &format!("/api/v1/employees/{employee}/leave-balances"),
        json!({ "entry_id": format!("alloc-{employee}"), "leave_type": "CUTI_TAHUNAN",
                "on": "2026-01-01", "event": "ALLOCATION", "days": days }),
    )
    .await;
}

async fn annual_balance(hub: &Hub, employee: &str) -> i64 {
    let rows = hub
        .get(&format!(
            "/api/v1/employees/{employee}/leave-balances?on=2026-06-30"
        ))
        .await;
    rows.body
        .as_array()
        .and_then(|rows| rows.iter().find(|r| r["leave_type"] == "CUTI_TAHUNAN"))
        .and_then(|r| r["centidays"].as_i64())
        .unwrap_or_else(|| panic!("balance: {:?}", rows.body))
}

fn leave(id: &str, from: &str, to: &str) -> Value {
    json!({ "request_id": id, "leave_type": "CUTI_TAHUNAN", "from_date": from, "to_date": to,
            "reason": "keperluan keluarga" })
}

/// Dates closed to leave refuse a request that would charge them; lifted,
/// they do not. A roster's rest day inside a span is not charged.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn blocked_dates_refuse_leave_and_a_roster_rest_day_is_free(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    leave_setup(&hub, None).await;
    let siti = hub.staff("K0951", "store-07", "2026-01-05").await;
    allocate(&hub, &siti, 12).await;

    let blocks = hub
        .ok(
            "/api/v1/leave-blackouts",
            json!({ "from_date": "2026-04-13", "to_date": "2026-04-17", "unit_id": "store-07",
                    "reason": "stock opname" }),
        )
        .await;
    let block = blocks[0]["id"].as_str().unwrap_or_default().to_owned();
    let refused = hub
        .post(
            &format!("/api/v1/employees/{siti}/leave-requests"),
            leave("LV-B1", "2026-04-14", "2026-04-15"),
        )
        .await;
    assert_eq!(refused.status, StatusCode::CONFLICT, "{:?}", refused.body);
    assert!(refused.body["error"]
        .as_str()
        .unwrap_or_default()
        .contains("stock opname"));

    hub.ok(
        &format!("/api/v1/leave-blackouts/{block}/lift"),
        json!({ "reason": "selesai" }),
    )
    .await;
    let filed = hub
        .post(
            &format!("/api/v1/employees/{siti}/leave-requests"),
            leave("LV-B2", "2026-04-14", "2026-04-15"),
        )
        .await;
    assert_eq!(filed.status, StatusCode::OK, "{:?}", filed.body);

    // Rostered Mon and Wed, resting Tue: three days asked, two charged.
    hub.ok(
        "/api/v1/attendance-shifts",
        json!({ "id": "PAGI", "name": "Pagi", "starts_at": "07:00", "ends_at": "15:00", "unpaid_break_minutes": 60 }),
    )
    .await;
    for (day, plan) in [
        ("2026-04-20", "SCHEDULED"),
        ("2026-04-21", "REST_DAY"),
        ("2026-04-22", "SCHEDULED"),
    ] {
        let mut body = json!({ "on_date": day, "plan": plan, "reason": "jadwal" });
        if plan == "SCHEDULED" {
            body["shift_id"] = json!("PAGI");
        }
        hub.ok(&format!("/api/v1/employees/{siti}/roster"), body)
            .await;
    }
    let rostered = hub
        .ok(
            &format!("/api/v1/employees/{siti}/leave-requests"),
            leave("LV-R1", "2026-04-20", "2026-04-22"),
        )
        .await;
    assert_eq!(rostered["chargeable_days"], 2, "{rostered:?}");
}

/// Days paid out leave the balance and join that month's payroll at the
/// month's wage over 25, within the policy's yearly cap.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn leave_paid_out_leaves_the_balance_and_joins_the_payroll(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    leave_setup(&hub, Some(5)).await;
    let siti = hub.staff("K0952", "store-07", "2026-01-05").await;
    hub.pay(&siti, "2026-01-01", 5_000_000, json!([])).await;
    hub.identity(&siti, "ptkp", "TK/0").await;
    allocate(&hub, &siti, 12).await;
    let (april, _) = hub.run("store-07", "2026-04").await;

    let paid = hub
        .ok(
            &format!("/api/v1/employees/{siti}/leave-encashments"),
            json!({ "leave_type": "CUTI_TAHUNAN", "days": 2, "period": "2026-04", "reason": "sisa cuti" }),
        )
        .await;
    assert_eq!(paid[0]["amount_minor"], 400_000);
    assert_eq!(annual_balance(&hub, &siti).await, 1_000);

    let slips = hub
        .get(&format!("/api/v1/payroll/runs/{april}/slips"))
        .await;
    let slips = slips.body.as_array().cloned().unwrap_or_default();
    let line = slip_of(&slips, &siti)["earnings"]
        .as_array()
        .and_then(|lines| lines.iter().find(|l| l["component_code"] == "UANG_CUTI"))
        .cloned()
        .unwrap_or_else(|| panic!("no paid-out leave on the slip: {slips:?}"));
    assert_eq!(line["amount_minor"], 400_000);

    let over = hub
        .post(
            &format!("/api/v1/employees/{siti}/leave-encashments"),
            json!({ "leave_type": "CUTI_TAHUNAN", "days": 4, "period": "2026-05", "reason": "lagi" }),
        )
        .await;
    assert_eq!(over.status, StatusCode::CONFLICT, "{:?}", over.body);
}

/// A holiday worked earns a day back, once, and only on a holiday or a rest
/// day; the report reads it back.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_holiday_worked_earns_a_day_back(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    leave_setup(&hub, None).await;
    let siti = hub.staff("K0953", "store-07", "2026-01-05").await;
    allocate(&hub, &siti, 12).await;

    let worked = hub
        .ok(
            &format!("/api/v1/employees/{siti}/holiday-work"),
            json!({ "on_date": "2026-05-01", "leave_type": "CUTI_TAHUNAN", "reason": "jaga toko" }),
        )
        .await;
    assert_eq!(worked[0]["day_kind"], "PUBLIC_HOLIDAY");
    assert_eq!(annual_balance(&hub, &siti).await, 1_300);

    let twice = hub
        .post(
            &format!("/api/v1/employees/{siti}/holiday-work"),
            json!({ "on_date": "2026-05-01", "leave_type": "CUTI_TAHUNAN", "reason": "lagi" }),
        )
        .await;
    assert_eq!(twice.status, StatusCode::CONFLICT, "{:?}", twice.body);
    let ordinary = hub
        .post(
            &format!("/api/v1/employees/{siti}/holiday-work"),
            json!({ "on_date": "2026-05-04", "leave_type": "CUTI_TAHUNAN", "reason": "salah" }),
        )
        .await;
    assert_eq!(
        ordinary.status,
        StatusCode::BAD_REQUEST,
        "{:?}",
        ordinary.body
    );
    // Before they joined (hired 5 January), a holiday earned them nothing.
    let before = hub
        .post(
            &format!("/api/v1/employees/{siti}/holiday-work"),
            json!({ "on_date": "2026-01-01", "leave_type": "CUTI_TAHUNAN", "reason": "salah" }),
        )
        .await;
    assert_eq!(before.status, StatusCode::BAD_REQUEST, "{:?}", before.body);
    assert!(
        before.body["error"]
            .as_str()
            .unwrap_or_default()
            .contains("outside their employment"),
        "{:?}",
        before.body
    );

    let report = hub
        .get("/api/v1/holiday-work?from=2026-05-01&to=2026-05-31")
        .await;
    assert_eq!(report.status, StatusCode::OK, "{:?}", report.body);
    assert_eq!(report.body.as_array().map(Vec::len), Some(1));
}

/// The team calendar shows who is away, the holidays and the closed dates.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_team_calendar_shows_who_is_away(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    leave_setup(&hub, None).await;
    let siti = hub.staff("K0954", "store-07", "2026-01-05").await;
    allocate(&hub, &siti, 12).await;
    hub.ok(
        &format!("/api/v1/employees/{siti}/leave-requests"),
        leave("LV-T1", "2026-04-20", "2026-04-21"),
    )
    .await;
    hub.ok(
        "/api/v1/leave-blackouts",
        json!({ "from_date": "2026-04-27", "to_date": "2026-04-30", "reason": "akhir bulan" }),
    )
    .await;

    let calendar = hub
        .get("/api/v1/team-calendar?from=2026-04-01&to=2026-04-30")
        .await;
    assert_eq!(calendar.status, StatusCode::OK, "{:?}", calendar.body);
    assert_eq!(calendar.body["leave"][0]["employee_id"], siti);
    assert_eq!(calendar.body["leave"][0]["state"], "PENDING");
    assert_eq!(calendar.body["holidays"][0][0], "2026-04-07");
    assert_eq!(calendar.body["blocked"][0]["reason"], "akhir bulan");

    let too_long = hub
        .get("/api/v1/team-calendar?from=2026-01-01&to=2026-12-31")
        .await;
    assert_eq!(
        too_long.status,
        StatusCode::BAD_REQUEST,
        "{:?}",
        too_long.body
    );
}

async fn approve_as(
    hub: &Hub,
    cookies: &str,
    csrf: &str,
    employee: &str,
    request: &str,
) -> Response {
    send(
        hub.app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee}/leave-requests/{request}/approve"),
        write_headers(cookies, csrf),
        Some(json!({ "reason": "disetujui" })),
    )
    .await
}

async fn login_for(hub: &Hub, employee: &str, username: &str, role: &str) -> (String, String) {
    hub.ok(
        "/api/v1/auth/users",
        json!({ "username": username, "display_name": username, "password": "delegate-pass-0812", "role": role }),
    )
    .await;
    hub.ok(
        &format!("/api/v1/employees/{employee}/account"),
        json!({ "username": username, "reason": "akun staf" }),
    )
    .await;
    sign_in(&hub.app, username, "delegate-pass-0812").await
}

/// A manager away hands their approvals to a colleague: while it runs the
/// colleague decides leave at the manager's rung — and nothing else of the
/// manager's; revoked, the door closes again.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_delegation_lends_approvals_and_nothing_else(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    leave_setup(&hub, None).await;
    let budi = hub.staff("K0971", "store-07", "2026-01-05").await;
    let siti = hub.staff("K0972", "store-07", "2026-01-05").await;
    let dewi = hub.staff("K0973", "store-07", "2026-01-05").await;
    allocate(&hub, &dewi, 12).await;
    let (manager, manager_csrf) = login_for(&hub, &budi, "budi.spv", "SUPERVISOR").await;
    let (stand_in, stand_in_csrf) = login_for(&hub, &siti, "siti.kasir", "CASHIER").await;
    hub.ok(
        &format!("/api/v1/employees/{dewi}/leave-requests"),
        leave("LV-D1", "2026-06-15", "2026-06-16"),
    )
    .await;

    let before = approve_as(&hub, &stand_in, &stand_in_csrf, &dewi, "LV-D1").await;
    assert_eq!(before.status, StatusCode::FORBIDDEN, "{:?}", before.body);

    let today = chrono::Utc::now().date_naive();
    let delegated = send(
        hub.app.clone(),
        "POST",
        "/api/v1/approval-delegations",
        write_headers(&manager, &manager_csrf),
        Some(
            json!({ "delegate": "siti.kasir", "from_date": today.to_string(),
                     "to_date": (today + chrono::Duration::days(7)).to_string(),
                     "reason": "cuti tahunan" }),
        ),
    )
    .await;
    assert_eq!(delegated.status, StatusCode::OK, "{:?}", delegated.body);
    assert_eq!(delegated.body[0]["active"], true);
    let id = delegated.body[0]["id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();

    // Not the manager's other powers: rostering stays out of reach.
    let roster = send(
        hub.app.clone(),
        "POST",
        &format!("/api/v1/employees/{dewi}/roster"),
        write_headers(&stand_in, &stand_in_csrf),
        Some(json!({ "on_date": "2026-06-20", "plan": "REST_DAY", "reason": "jadwal" })),
    )
    .await;
    assert_eq!(roster.status, StatusCode::FORBIDDEN, "{:?}", roster.body);

    let approved = approve_as(&hub, &stand_in, &stand_in_csrf, &dewi, "LV-D1").await;
    assert_eq!(approved.status, StatusCode::OK, "{:?}", approved.body);
    assert_eq!(approved.body["state"], "APPROVED");

    let revoked = send(
        hub.app.clone(),
        "POST",
        &format!("/api/v1/approval-delegations/{id}/revocation"),
        write_headers(&manager, &manager_csrf),
        None,
    )
    .await;
    assert_eq!(revoked.status, StatusCode::OK, "{:?}", revoked.body);
    hub.ok(
        &format!("/api/v1/employees/{dewi}/leave-requests"),
        leave("LV-D2", "2026-07-15", "2026-07-15"),
    )
    .await;
    let after = send(
        hub.app.clone(),
        "POST",
        &format!("/api/v1/employees/{dewi}/leave-requests/LV-D2/approve"),
        write_headers(&stand_in, &stand_in_csrf),
        Some(json!({ "reason": "disetujui" })),
    )
    .await;
    assert_eq!(after.status, StatusCode::FORBIDDEN, "{:?}", after.body);
}

/// The service rule (service rule, 1 Oct 2026): with an up-front accrual and PRORATE, somebody
/// who starts in October is given the three months left of twelve days; a
/// year-long employee the whole year. With twelve months' eligibility (UU
/// 13/2003 art. 79), somebody who has not served a year earns nothing yet.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn annual_leave_waits_for_eligibility_and_prorates_a_late_starter(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    hub.ok(
        "/api/v1/leave-types",
        json!({ "code": "CUTI_TAHUNAN", "name": "Cuti Tahunan", "backing": "BALANCE", "payment": "FULL" }),
    )
    .await;
    let stated = hub
        .ok(
            "/api/v1/leave-policy",
            json!({ "version": 1, "effective_from": "2026-01-01", "annual_days": 12,
                    "accrual": "UP_FRONT", "protected_leave": "CONTINUES",
                    "eligibility_months": 0, "joiner": "PRORATE" }),
        )
        .await;
    assert_eq!(stated[0]["joiner"], "PRORATE");
    let dewi = hub.staff("K0971", "store-07", "2026-10-01").await;
    let budi = hub.staff("K0972", "store-07", "2025-01-01").await;
    let accrued = |who: String, year: i32| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(
                "SELECT COALESCE(SUM(centidays), 0)::bigint FROM leave_ledger_entry
                  WHERE employee_id = $1 AND event = 'ACCRUAL'
                    AND extract(year FROM on_date) = $2",
            )
            .bind(who)
            .bind(f64::from(year))
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("accrued: {error}"))
        }
    };

    hub.ok(
        "/api/v1/hr-scheduler/run-now",
        json!({ "as_of": "2026-10-15", "reason": "uji" }),
    )
    .await;
    assert_eq!(
        accrued(dewi.clone(), 2026).await,
        300,
        "three months of twelve days"
    );
    assert_eq!(accrued(budi.clone(), 2026).await, 1_200, "the whole year");

    // From 2027 the company follows UU 13/2003: a year's service first.
    hub.ok(
        "/api/v1/leave-policy",
        json!({ "version": 2, "effective_from": "2027-01-01", "annual_days": 12,
                "accrual": "UP_FRONT", "protected_leave": "CONTINUES",
                "eligibility_months": 12, "joiner": "PRORATE" }),
    )
    .await;
    hub.ok(
        "/api/v1/hr-scheduler/run-now",
        json!({ "as_of": "2027-01-15", "reason": "uji" }),
    )
    .await;
    assert_eq!(
        accrued(dewi.clone(), 2027).await,
        0,
        "not a year's service yet"
    );
    assert_eq!(accrued(budi.clone(), 2027).await, 1_200);
    hub.ok(
        "/api/v1/hr-scheduler/run-now",
        json!({ "as_of": "2027-10-02", "reason": "uji" }),
    )
    .await;
    assert_eq!(
        accrued(dewi, 2027).await,
        300,
        "eligible in October: the three months left"
    );
}
