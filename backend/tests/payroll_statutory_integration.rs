//! PPh 21 and BPJS on a payslip, end to end (0800).
//!
//! Every case goes through the HTTP surface and a real Postgres, as the rest
//! of payroll's tests do: pay agreed, identity recorded, the month's
//! attendance closed, a run opened, and the slips read back.
//!
//! The first case is the regulation's own worked example — PMK 168/2023's
//! "Tuan R", K/0 on Rp10.000.000 a month with Rp100.000 of pension — run as
//! twelve real payroll runs. If this system and DJP disagree about Tuan R,
//! nothing else here matters.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-statutory-1";

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

/// The amount of a component on one side of a slip, or `None`.
fn amount(slip: &Value, side: &str, code: &str) -> Option<i64> {
    slip[side]
        .as_array()
        .unwrap_or_else(|| panic!("{side} is a list: {slip:?}"))
        .iter()
        .find(|line| line["component_code"] == code)
        .map(|line| line["amount_minor"].as_i64().unwrap_or_default())
}

// ── the regulation's own example ────────────────────────────────────────────

/// PMK 168/2023, "Tuan R": K/0, Rp10.000.000 a month, pension Rp100.000 a
/// month. January to November withhold 2 % (TER A, row 9) = Rp200.000;
/// December settles the year's Pasal 17 tax of Rp2.715.000, Rp515.000.
///
/// Tuan R's only deduction besides tax is Rp100.000 of pension, and nothing
/// the company pays is his income. So the BPJS rates for 2027 are stated as
/// exactly that — JP 1 % from the employee on an uncapped wage and nothing
/// else — which also exercises head office stating rates from a date.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn tuan_r_is_withheld_200_000_a_month_and_515_000_in_december(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let stated = hub
        .post(
            "/api/v1/payroll/statutory-rates",
            json!({
                "effective_from": "2027-01-01",
                "rates": {
                    "kesehatan_company_bp": 0, "kesehatan_employee_bp": 0,
                    "kesehatan_cap_minor": 12_000_000,
                    "jht_company_bp": 0, "jht_employee_bp": 0,
                    "jp_company_bp": 0, "jp_employee_bp": 100,
                    "jp_cap_minor": 100_000_000,
                    "jkk_bp": 0, "jkm_bp": 0,
                },
                "reason": "tarif contoh PMK 168",
            }),
        )
        .await;
    assert_eq!(stated.status, StatusCode::OK, "{:?}", stated.body);
    assert_eq!(
        stated.body[0]["effective_from"], "2027-01-01",
        "newest first"
    );

    let r = hub.staff("R0001", "store-07", "2026-01-05").await;
    hub.pay(&r, "2026-01-01", 10_000_000, json!([])).await;
    hub.identity(&r, "ptkp", "K/0").await;
    hub.identity(&r, "bpjs_ketenagakerjaan", "11000000001")
        .await;
    hub.ok(
        &format!("/api/v1/employees/{r}/payroll-identity"),
        json!({ "field": "bank_account", "bank_name": "BCA", "bank_account": "1234567890",
                "bank_holder": "R", "effective_from": "2026-01-01", "reason": "rekening gaji" }),
    )
    .await;

    let mut withheld = 0;
    let mut runs = Vec::new();
    for month in 1..=12 {
        let (run_id, slips) = hub.run("store-07", &format!("2027-{month:02}")).await;
        runs.push(run_id);
        let slip = slip_of(&slips, &r);
        assert_eq!(slip["ter_category"], "A");
        assert_eq!(slip["pension_contribution_minor"], 100_000, "month {month}");
        let tax = amount(slip, "deductions", "PPH21")
            .unwrap_or_else(|| panic!("month {month} has no PPh 21: {slip:?}"));
        if month < 12 {
            assert_eq!(tax, 200_000, "month {month}");
            assert_eq!(slip["final_tax_month"], false);
            let line = slip["deductions"]
                .as_array()
                .and_then(|lines| lines.iter().find(|l| l["component_code"] == "PPH21"))
                .cloned()
                .unwrap_or_default();
            assert_eq!(line["rate_bp"], 200, "TER A row 9 is 2 %");
        } else {
            assert_eq!(tax, 515_000, "December settles the year");
            assert_eq!(slip["final_tax_month"], true);
        }
        withheld += tax;
        assert_eq!(
            slip["net_minor"],
            10_000_000 - 100_000 - tax,
            "month {month}"
        );
    }
    assert_eq!(withheld, 2_715_000, "the year's Pasal 17 tax");

    // The form and the return read approved months only: the place signs
    // each month, a second officer approves it.
    hub.ok(
        "/api/v1/auth/users",
        json!({ "username": "hr.budi", "display_name": "Budi", "password": ADMIN_PASSWORD,
                "role": "ADMIN" }),
    )
    .await;
    let (theirs, their_csrf) = sign_in(&hub.app, "hr.budi", ADMIN_PASSWORD).await;
    for run_id in &runs {
        hub.ok(
            &format!("/api/v1/payroll/runs/{run_id}/submission"),
            json!({ "reason": "dicek" }),
        )
        .await;
        let approved = send(
            hub.app.clone(),
            "POST",
            &format!("/api/v1/payroll/runs/{run_id}/approve"),
            write_headers(&theirs, &their_csrf),
            Some(json!({ "reason": "disetujui" })),
        )
        .await;
        assert_eq!(
            approved.status,
            StatusCode::OK,
            "approve {run_id}: {:?}",
            approved.body
        );
    }

    // The year's 1721-A1, line by line as PMK 168's example states it.
    let a1 = hub
        .get(&format!("/api/v1/employees/{r}/annual-tax?year=2027"))
        .await;
    assert_eq!(a1.status, StatusCode::OK, "{:?}", a1.body);
    let a1 = a1.body;
    assert_eq!(a1["gross_minor"], 120_000_000);
    assert_eq!(a1["salary_minor"], 120_000_000);
    assert_eq!(a1["biaya_jabatan_minor"], 6_000_000);
    assert_eq!(a1["pension_minor"], 1_200_000);
    assert_eq!(a1["net_minor"], 112_800_000);
    assert_eq!(a1["ptkp_minor"], 58_500_000);
    assert_eq!(a1["taxable_income_minor"], 54_300_000);
    assert_eq!(a1["tax_due_minor"], 2_715_000);
    assert_eq!(a1["tax_withheld_minor"], 2_715_000);
    assert_eq!(a1["settled"], true);
    assert_eq!(
        (a1["from_month"].clone(), a1["to_month"].clone()),
        (json!(1), json!(12))
    );

    let all = hub.get("/api/v1/payroll/annual-tax?year=2027").await;
    assert_eq!(all.body.as_array().map(Vec::len), Some(1), "{:?}", all.body);

    let december = hub.get("/api/v1/payroll/tax-report?period=2027-12").await;
    assert_eq!(december.status, StatusCode::OK, "{:?}", december.body);
    assert_eq!(december.body[0]["pph21_minor"], 515_000);
    assert_eq!(december.body[0]["final_tax_month"], true);
    assert_eq!(december.body[0]["bpjs_employee_minor"], 100_000);
}

// ── BPJS ────────────────────────────────────────────────────────────────────

/// Rp15.000.000 of wage in April 2026 under the seeded rates: Kesehatan on at
/// most Rp12.000.000, JP on at most Rp11.086.300 (from March 2026), JHT, JKK
/// and JKM on the whole wage. The company's Kesehatan, JKK and JKM are the
/// employee's income for PPh 21, so TER A is applied to Rp15.561.000 — 7 %.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn bpjs_follows_its_rates_and_caps_and_the_companys_share_is_taxable(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let siti = hub.staff("K0701", "store-07", "2026-01-05").await;
    hub.pay(
        &siti,
        "2026-01-01",
        14_500_000,
        json!([{ "code": "JABATAN", "minor": 500_000 }]),
    )
    .await;
    hub.identity(&siti, "ptkp", "TK/0").await;
    hub.identity(&siti, "bpjs_kesehatan", "0001234567890").await;
    hub.identity(&siti, "bpjs_ketenagakerjaan", "11000000002")
        .await;

    let (_, slips) = hub.run("store-07", "2026-04").await;
    let slip = slip_of(&slips, &siti);

    assert_eq!(amount(slip, "deductions", "BPJS_KES"), Some(120_000));
    assert_eq!(amount(slip, "deductions", "BPJS_JHT"), Some(300_000));
    assert_eq!(
        amount(slip, "deductions", "BPJS_JP"),
        Some(110_863),
        "1 % of the JP cap"
    );
    assert_eq!(
        amount(slip, "company_contributions", "BPJS_KES_CO"),
        Some(480_000)
    );
    assert_eq!(
        amount(slip, "company_contributions", "BPJS_JHT_CO"),
        Some(555_000)
    );
    assert_eq!(
        amount(slip, "company_contributions", "BPJS_JP_CO"),
        Some(221_726)
    );
    assert_eq!(
        amount(slip, "company_contributions", "BPJS_JKK_CO"),
        Some(36_000),
        "0,24 %"
    );
    assert_eq!(
        amount(slip, "company_contributions", "BPJS_JKM_CO"),
        Some(45_000)
    );
    assert_eq!(
        amount(slip, "deductions", "BPJS_KES_CO"),
        None,
        "the company's share is not a deduction from pay"
    );

    assert_eq!(slip["taxable_gross_minor"], 15_561_000);
    assert_eq!(
        amount(slip, "deductions", "PPH21"),
        Some(1_089_270),
        "7 % of 15.561.000"
    );
    assert_eq!(slip["gross_minor"], 15_000_000);
    assert_eq!(
        slip["deduction_total_minor"],
        120_000 + 300_000 + 110_863 + 1_089_270
    );
    assert_eq!(
        slip["net_minor"],
        15_000_000 - 120_000 - 300_000 - 110_863 - 1_089_270
    );
    assert_eq!(
        slip["company_borne_minor"],
        480_000 + 555_000 + 221_726 + 36_000 + 45_000
    );
    assert_eq!(slip["components_incomplete_because"], Value::Null);
}

/// Nobody is charged for a programme payroll cannot show they belong to: no
/// BPJS number, no BPJS line.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn nobody_pays_bpjs_without_being_enrolled(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let budi = hub.staff("K0702", "store-07", "2026-01-05").await;
    hub.pay(&budi, "2026-01-01", 5_000_000, json!([])).await;
    hub.identity(&budi, "ptkp", "TK/0").await;

    let (_, slips) = hub.run("store-07", "2026-04").await;
    let slip = slip_of(&slips, &budi);
    assert_eq!(amount(slip, "deductions", "BPJS_KES"), None);
    assert_eq!(amount(slip, "deductions", "BPJS_JHT"), None);
    assert_eq!(slip["company_borne_minor"], 0);
    assert_eq!(
        amount(slip, "deductions", "PPH21"),
        Some(0),
        "TER A row 1 is 0 %"
    );
    assert_eq!(slip["net_minor"], 5_000_000);
}

// ── who bears the tax ───────────────────────────────────────────────────────

/// Three people on the same Rp10.000.000: withheld, grossed up, borne.
///
/// A gross-up tunjangan is the fixed point of `T = TER(10.000.000 + T) × …`:
/// 10.230.179 falls in TER A's 2,25 % row, and 2,25 % of it is 230.179 — so
/// the allowance pays exactly its own tax and net pay is the whole salary.
/// Netto puts the 2 % on the company and on nobody's pay.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_gross_up_pays_its_own_tax_and_netto_is_the_companys(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let gross = hub.staff("K0710", "store-07", "2026-01-05").await;
    let up = hub.staff("K0711", "store-07", "2026-01-05").await;
    let netto = hub.staff("K0712", "store-07", "2026-01-05").await;
    for who in [&gross, &up, &netto] {
        hub.pay(who, "2026-01-01", 10_000_000, json!([])).await;
        hub.identity(who, "ptkp", "TK/0").await;
    }
    hub.identity(&up, "tax_method", "GROSS_UP").await;
    hub.identity(&netto, "tax_method", "NETTO").await;

    let (_, slips) = hub.run("store-07", "2026-04").await;

    let g = slip_of(&slips, &gross);
    assert_eq!(g["tax_method"], "GROSS");
    assert_eq!(amount(g, "deductions", "PPH21"), Some(200_000));
    assert_eq!(g["net_minor"], 9_800_000);

    let u = slip_of(&slips, &up);
    assert_eq!(u["tax_method"], "GROSS_UP");
    assert_eq!(amount(u, "earnings", "TUNJ_PPH21"), Some(230_179));
    assert_eq!(amount(u, "deductions", "PPH21"), Some(230_179));
    assert_eq!(u["gross_minor"], 10_230_179);
    assert_eq!(
        u["net_minor"], 10_000_000,
        "the allowance pays exactly the tax"
    );

    let n = slip_of(&slips, &netto);
    assert_eq!(n["tax_method"], "NETTO");
    assert_eq!(amount(n, "deductions", "PPH21"), None);
    assert_eq!(
        amount(n, "company_contributions", "PPH21_CO"),
        Some(200_000)
    );
    assert_eq!(n["net_minor"], 10_000_000);
    assert_eq!(n["company_borne_minor"], 200_000);
}

/// Without a PTKP status there is no TER table and no PTKP amount: the slip
/// says so instead of a net, and says which fact is missing.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn without_a_ptkp_the_net_is_unknown_and_the_slip_says_why(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let ani = hub.staff("K0720", "store-07", "2026-01-05").await;
    hub.pay(&ani, "2026-01-01", 6_000_000, json!([])).await;

    let (_, slips) = hub.run("store-07", "2026-04").await;
    let slip = slip_of(&slips, &ani);
    assert_eq!(
        slip["gross_minor"], 6_000_000,
        "the gross is still a real sum"
    );
    assert_eq!(slip["net_minor"], Value::Null);
    assert_eq!(slip["deduction_total_minor"], Value::Null);
    assert_eq!(slip["pph21_minor"], Value::Null);
    let because = slip["components_incomplete_because"]
        .as_str()
        .unwrap_or_default();
    assert!(because.contains("PTKP"), "{because}");
}

// ── prorata ─────────────────────────────────────────────────────────────────

/// April has 30 days. Somebody posted from the 16th is paid 15 of them; a
/// raise from Rp4.000.000 to Rp7.000.000 on the 11th pays ten days of the old
/// agreement and twenty of the new — Rp6.000.000.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_month_is_paid_by_the_days_posted_and_the_agreement_on_each(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let late = hub.staff("K0730", "store-07", "2026-04-16").await;
    hub.pay(
        &late,
        "2026-04-16",
        6_000_000,
        json!([{ "code": "MAKAN", "minor": 600_000 }]),
    )
    .await;
    hub.identity(&late, "ptkp", "TK/0").await;

    let raised = hub.staff("K0731", "store-07", "2026-01-05").await;
    hub.pay(&raised, "2026-01-01", 4_000_000, json!([])).await;
    hub.pay(&raised, "2026-04-11", 7_000_000, json!([])).await;
    hub.identity(&raised, "ptkp", "TK/0").await;

    let (_, slips) = hub.run("store-07", "2026-04").await;

    let l = slip_of(&slips, &late);
    assert_eq!(l["days_paid"], 15);
    assert_eq!(l["days_in_month"], 30);
    assert_eq!(l["base_minor"], 3_000_000);
    assert_eq!(l["fixed_allowances"][0]["minor"], 300_000);
    assert_eq!(l["gross_minor"], 3_300_000);

    let r = slip_of(&slips, &raised);
    assert_eq!(r["days_paid"], 30);
    assert_eq!(r["base_minor"], 6_000_000, "(4 jt × 10 + 7 jt × 20) / 30");
}

// ── the law, as served ──────────────────────────────────────────────────────

/// The tables PPh 21 is worked out from, read back through the API and held
/// against PP 58/2023's Lampiran: 44, 40 and 41 rows; the bounds and rates at
/// each table's edges; which PTKP selects which table; and the PTKP amounts.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_tax_tables_are_the_regulations(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let tables = hub.get("/api/v1/payroll/tax-tables").await;
    assert_eq!(tables.status, StatusCode::OK, "{:?}", tables.body);
    let ter = tables.body["ter"].as_array().cloned().unwrap_or_default();

    let expect = [
        (
            "A",
            44,
            vec!["TK/0", "TK/1", "K/0"],
            (5_400_000, 0),
            (1_400_000_000, 3_300),
        ),
        (
            "B",
            40,
            vec!["TK/2", "TK/3", "K/1", "K/2"],
            (6_200_000, 0),
            (1_405_000_000, 3_300),
        ),
        ("C", 41, vec!["K/3"], (6_600_000, 0), (1_419_000_000, 3_300)),
    ];
    for (category, rows, ptkp, first, last_bounded) in expect {
        let table = ter
            .iter()
            .find(|t| t["category"] == category)
            .unwrap_or_else(|| panic!("no table {category}"));
        let list = table["rows"].as_array().cloned().unwrap_or_default();
        assert_eq!(list.len(), rows, "table {category}");
        assert_eq!(table["ptkp"], json!(ptkp), "table {category}");
        assert_eq!(list[0]["upto_minor"], first.0);
        assert_eq!(list[0]["rate_bp"], first.1);
        assert_eq!(list[rows - 2]["upto_minor"], last_bounded.0);
        assert_eq!(list[rows - 2]["rate_bp"], last_bounded.1);
        assert_eq!(
            list[rows - 1]["upto_minor"],
            Value::Null,
            "the last row is open"
        );
        assert_eq!(list[rows - 1]["rate_bp"], 3_400);
        let climbs = list
            .windows(2)
            .all(|w| w[0]["rate_bp"].as_i64() < w[1]["rate_bp"].as_i64());
        assert!(climbs, "table {category} rates climb");
    }
    // Spot rows that decide common Indonesian wages.
    let a = ter
        .iter()
        .find(|t| t["category"] == "A")
        .cloned()
        .unwrap_or_default();
    assert_eq!(
        a["rows"][8],
        json!({ "upto_minor": 10_050_000, "rate_bp": 200 })
    );
    assert_eq!(
        a["rows"][15],
        json!({ "upto_minor": 15_100_000, "rate_bp": 600 })
    );
    let b = ter
        .iter()
        .find(|t| t["category"] == "B")
        .cloned()
        .unwrap_or_default();
    assert_eq!(
        b["rows"][4],
        json!({ "upto_minor": 9_200_000, "rate_bp": 100 })
    );
    let c = ter
        .iter()
        .find(|t| t["category"] == "C")
        .cloned()
        .unwrap_or_default();
    assert_eq!(
        c["rows"][32],
        json!({ "upto_minor": 169_000_000, "rate_bp": 2_600 })
    );

    assert_eq!(
        tables.body["pasal_17"][0],
        json!({ "upto_minor": 60_000_000, "rate_bp": 500 })
    );
    assert_eq!(
        tables.body["pasal_17"][4],
        json!({ "upto_minor": null, "rate_bp": 3_500 })
    );
    let ptkp = tables.body["ptkp"].as_array().cloned().unwrap_or_default();
    let of = |status: &str| {
        ptkp.iter()
            .find(|p| p["status"] == status)
            .map(|p| p["amount_minor"].as_i64().unwrap_or_default())
    };
    assert_eq!(of("TK/0"), Some(54_000_000));
    assert_eq!(of("K/0"), Some(58_500_000));
    assert_eq!(of("K/3"), Some(72_000_000));
}

/// PPh 21 and BPJS are the system's own components. Defining another by hand
/// would be a second figure for the same tax, and is refused.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_statutory_component_cannot_be_defined_by_hand(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let refused = hub
        .post(
            "/api/v1/payroll/components",
            json!({
                "code": "PPH21_KEDUA",
                "label": "PPh 21 lagi",
                "kind": "DEDUCTION",
                "basis": "STATUTORY",
                "reason": "coba",
            }),
        )
        .await;
    assert_eq!(
        refused.status,
        StatusCode::BAD_REQUEST,
        "{:?}",
        refused.body
    );

    let stale = hub
        .post(
            "/api/v1/payroll/statutory-rates",
            json!({
                "effective_from": "2026-01-01",
                "rates": {
                    "kesehatan_company_bp": 400, "kesehatan_employee_bp": 100,
                    "kesehatan_cap_minor": 12_000_000,
                    "jht_company_bp": 370, "jht_employee_bp": 200,
                    "jp_company_bp": 200, "jp_employee_bp": 100,
                    "jp_cap_minor": 11_086_300, "jkk_bp": 24, "jkm_bp": 30,
                },
                "reason": "mundur",
            }),
        )
        .await;
    assert_eq!(
        stale.status,
        StatusCode::CONFLICT,
        "a month already paid keeps its rates: {:?}",
        stale.body
    );
}

// ── Finance ─────────────────────────────────────────────────────────────────

async fn balance(pool: &PgPool, code: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::bigint FROM journal_line
          WHERE account_code = $1",
    )
    .bind(code)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("balance {code}: {error}"))
}

/// The accrual lands every statutory figure where 0800 linked it: PPh 21
/// owed on 2011, BPJS (both shares) owed on 2021, the company's BPJS on the
/// shop's insurance expense 6017 — and only net pay on 2017.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_accrual_owes_the_tax_office_and_bpjs_and_pays_net(pool: PgPool) {
    let today = chrono::Utc::now().date_naive();
    cloud::open_period(
        &pool,
        chrono::Datelike::year(&today),
        i32::try_from(chrono::Datelike::month(&today)).unwrap_or(1),
    )
    .await
    .unwrap_or_else(|error| panic!("open: {error}"));
    let hub = Hub::open(&pool).await;
    // Base only: a fixed allowance is a pay component of its own that Finance
    // links, and this case is about where the statutory lines land.
    let siti = hub.staff("K0740", "store-07", "2026-01-05").await;
    hub.pay(&siti, "2026-01-01", 15_000_000, json!([])).await;
    hub.identity(&siti, "ptkp", "TK/0").await;
    hub.identity(&siti, "bpjs_kesehatan", "0001234567891").await;
    hub.identity(&siti, "bpjs_ketenagakerjaan", "11000000003")
        .await;
    let (run_id, _) = hub.run("store-07", "2026-04").await;

    cloud::payroll_accrual_post(&pool, &run_id, "store-07", "admin")
        .await
        .unwrap_or_else(|error| panic!("accrual: {error}"));

    assert_eq!(balance(&pool, "2011").await, -1_089_270, "PPh 21 owed");
    let employee_bpjs = 120_000 + 300_000 + 110_863;
    let company_bpjs = 480_000 + 555_000 + 221_726 + 36_000 + 45_000;
    assert_eq!(
        balance(&pool, "2021").await,
        -(employee_bpjs + company_bpjs),
        "BPJS owed"
    );
    assert_eq!(
        balance(&pool, "6017").await,
        company_bpjs,
        "the company's BPJS is its cost"
    );
    assert_eq!(
        balance(&pool, "2017").await,
        -(15_000_000 - employee_bpjs - 1_089_270),
        "only net pay is owed to the employee"
    );
}

// ── THR and the payroll schedule (0801) ─────────────────────────────────────

/// THR on the March 2026 run, for a holiday on the 20th. Ani has served more
/// than twelve months, so her THR is a whole month's wage (Rp5.500.000); Budi
/// started on 5 January, two full months before the holiday, so his is 2/12
/// of his (Rp916.666). THR is income of the month: Ani's March is taxed on
/// Rp11.000.000, TER A 3 % — Rp330.000.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn thr_is_a_months_wage_after_a_year_and_a_share_before_and_is_taxed(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let ani = hub.staff("K0750", "store-07", "2025-01-01").await;
    let budi = hub.staff("K0751", "store-07", "2026-01-05").await;
    for who in [&ani, &budi] {
        hub.pay(
            who,
            "2025-01-01",
            5_000_000,
            json!([{ "code": "JABATAN", "minor": 500_000 }]),
        )
        .await;
        hub.identity(who, "ptkp", "TK/0").await;
    }
    let (run_id, before) = hub.run("store-07", "2026-03").await;
    assert_eq!(
        amount(slip_of(&before, &ani), "earnings", "THR"),
        None,
        "no THR until it is put on"
    );

    let set = hub
        .post(
            &format!("/api/v1/payroll/runs/{run_id}/thr"),
            json!({ "holiday_on": "2026-03-20", "reason": "THR Idul Fitri" }),
        )
        .await;
    assert_eq!(set.status, StatusCode::OK, "{:?}", set.body);
    assert_eq!(set.body["thr_on"], "2026-03-20");
    let slips = hub
        .get(&format!("/api/v1/payroll/runs/{run_id}/slips"))
        .await;
    let slips = slips.body.as_array().cloned().unwrap_or_default();

    let a = slip_of(&slips, &ani);
    assert_eq!(amount(a, "earnings", "THR"), Some(5_500_000));
    assert_eq!(a["gross_minor"], 11_000_000);
    assert_eq!(a["taxable_gross_minor"], 11_000_000);
    assert_eq!(
        amount(a, "deductions", "PPH21"),
        Some(330_000),
        "3 % of 11.000.000"
    );

    let b = slip_of(&slips, &budi);
    assert_eq!(
        amount(b, "earnings", "THR"),
        Some(916_666),
        "2/12 of 5.500.000"
    );

    // Taken off again, the slips go back.
    let off = hub
        .post(
            &format!("/api/v1/payroll/runs/{run_id}/thr"),
            json!({ "holiday_on": null, "reason": "salah bulan" }),
        )
        .await;
    assert_eq!(off.status, StatusCode::OK, "{:?}", off.body);
    let again = hub
        .get(&format!("/api/v1/payroll/runs/{run_id}/slips"))
        .await;
    let again = again.body.as_array().cloned().unwrap_or_default();
    assert_eq!(amount(slip_of(&again, &ani), "earnings", "THR"), None);
}

/// A cut-off of 20 and pay on the 25th, from April 2026: May's run counts the
/// attendance month 21 April – 20 May and pays on 25 May. Stated forward only.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_payroll_schedule_sets_the_attendance_month_and_the_pay_day(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let stated = hub
        .post(
            "/api/v1/payroll/schedule",
            json!({ "effective_from": "2026-04-01", "cutoff_day": 20, "pay_day": 25, "reason": "cut-off tanggal 20" }),
        )
        .await;
    assert_eq!(stated.status, StatusCode::OK, "{:?}", stated.body);
    assert_eq!(stated.body[0]["cutoff_day"], 20);

    let siti = hub.staff("K0760", "store-07", "2026-01-05").await;
    hub.pay(&siti, "2026-01-01", 5_000_000, json!([])).await;
    let (run_id, _) = hub.run("store-07", "2026-05").await;
    let runs = hub.get("/api/v1/payroll/runs").await;
    let run = runs
        .body
        .as_array()
        .and_then(|all| all.iter().find(|r| r["id"] == run_id.as_str()))
        .cloned()
        .unwrap_or_default();
    assert_eq!(run["attendance_from"], "2026-04-21");
    assert_eq!(run["attendance_to"], "2026-05-20");
    assert_eq!(run["pay_on"], "2026-05-25");

    let stale = hub
        .post(
            "/api/v1/payroll/schedule",
            json!({ "effective_from": "2026-03-01", "cutoff_day": 25, "pay_day": null, "reason": "mundur" }),
        )
        .await;
    assert_eq!(stale.status, StatusCode::CONFLICT, "{:?}", stale.body);
}

// ── salary structures (0802) ────────────────────────────────────────────────

/// A structure is a named base and fixed allowances; restating a live one
/// replaces it, a retired one stays retired, and an allowance listed twice or
/// worth nothing is refused.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_salary_structure_names_a_base_and_its_fixed_allowances(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let saved = hub
        .post(
            "/api/v1/payroll/structures",
            json!({
                "code": "kasir", "name": "Kasir toko", "base_minor": 4_800_000,
                "allowances": [
                    { "code": "MAKAN", "minor": 400_000 },
                    { "code": "TRANSPORT", "minor": 300_000 }
                ],
                "reason": "struktur kasir 2026",
            }),
        )
        .await;
    assert_eq!(saved.status, StatusCode::OK, "{:?}", saved.body);
    let kasir = saved.body[0].clone();
    assert_eq!(kasir["code"], "KASIR", "codes are upper case");
    assert_eq!(kasir["total_minor"], 5_500_000);

    let restated = hub
        .post(
            "/api/v1/payroll/structures",
            json!({
                "code": "KASIR", "name": "Kasir toko", "base_minor": 5_000_000,
                "allowances": [{ "code": "MAKAN", "minor": 450_000 }],
                "reason": "naik 2027",
            }),
        )
        .await;
    assert_eq!(restated.status, StatusCode::OK, "{:?}", restated.body);
    assert_eq!(restated.body[0]["total_minor"], 5_450_000);

    let twice = hub
        .post(
            "/api/v1/payroll/structures",
            json!({
                "code": "SPV", "name": "Supervisor", "base_minor": null,
                "allowances": [{ "code": "MAKAN", "minor": 1 }, { "code": "MAKAN", "minor": 2 }],
                "reason": "x",
            }),
        )
        .await;
    assert_eq!(twice.status, StatusCode::BAD_REQUEST, "{:?}", twice.body);

    let retired = hub
        .post(
            "/api/v1/payroll/structures/KASIR/retirement",
            json!({ "reason": "tidak dipakai" }),
        )
        .await;
    assert_eq!(retired.status, StatusCode::OK, "{:?}", retired.body);
    assert_eq!(retired.body[0]["retired"], true);
    let back = hub
        .post(
            "/api/v1/payroll/structures",
            json!({ "code": "KASIR", "name": "Kasir", "base_minor": 1, "allowances": [], "reason": "x" }),
        )
        .await;
    assert_eq!(back.status, StatusCode::CONFLICT, "{:?}", back.body);
}

// ── holding pay and locking payslips (0803) ─────────────────────────────────

/// Head office holds one person's pay on a run: the slip is still worked out
/// and counted, it says it is held, and a second hold is refused until the
/// first is released.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn pay_can_be_held_on_a_run_and_released(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let siti = hub.staff("K0770", "store-07", "2026-01-05").await;
    hub.pay(&siti, "2026-01-01", 5_000_000, json!([])).await;
    hub.identity(&siti, "ptkp", "TK/0").await;
    let (run_id, _) = hub.run("store-07", "2026-04").await;

    let held = hub
        .post(
            &format!("/api/v1/payroll/runs/{run_id}/withholdings"),
            json!({ "employee_id": siti, "reason": "dokumen belum lengkap" }),
        )
        .await;
    assert_eq!(held.status, StatusCode::OK, "{:?}", held.body);
    assert_eq!(held.body[0]["reason"], "dokumen belum lengkap");
    let slips = hub
        .get(&format!("/api/v1/payroll/runs/{run_id}/slips"))
        .await;
    assert_eq!(slips.body[0]["withheld"], true);
    assert_eq!(slips.body[0]["net_minor"], 5_000_000, "still worked out");
    let totals = hub
        .get(&format!("/api/v1/payroll/runs/{run_id}/reconciliation"))
        .await;
    assert_eq!(totals.body["withheld"], 1);

    let again = hub
        .post(
            &format!("/api/v1/payroll/runs/{run_id}/withholdings"),
            json!({ "employee_id": siti, "reason": "lagi" }),
        )
        .await;
    assert_eq!(again.status, StatusCode::CONFLICT, "{:?}", again.body);

    let released = hub
        .post(
            &format!("/api/v1/payroll/runs/{run_id}/withholdings/{siti}/release"),
            json!({ "reason": "dokumen lengkap" }),
        )
        .await;
    assert_eq!(released.status, StatusCode::OK, "{:?}", released.body);
    let slips = hub
        .get(&format!("/api/v1/payroll/runs/{run_id}/slips"))
        .await;
    assert_eq!(slips.body[0]["withheld"], false);
}

/// With the payslip password on, an employee opens their own payslips only
/// with the password they set — and head office is not asked for it.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_payslip_password_locks_an_employees_own_payslips(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let siti = hub.staff("K0780", "store-07", "2026-01-05").await;
    hub.ok(
        "/api/v1/auth/users",
        json!({ "username": "siti.slip", "display_name": "Siti", "password": "siti-login-pass-1", "role": "CASHIER" }),
    )
    .await;
    hub.ok(
        &format!("/api/v1/employees/{siti}/account"),
        json!({ "username": "siti.slip", "reason": "akun staf" }),
    )
    .await;
    let template = hub
        .post(
            "/api/v1/payroll/payslip-template",
            json!({
                "company_name": "PT Contoh", "company_address": "Jakarta", "footer": null,
                "show_company_contributions": true, "password_required": true,
                "reason": "slip dikunci",
            }),
        )
        .await;
    assert_eq!(template.status, StatusCode::OK, "{:?}", template.body);
    assert_eq!(template.body["password_required"], true);

    let (hers, her_csrf) = sign_in(&hub.app, "siti.slip", "siti-login-pass-1").await;
    let own = |headers: Vec<(String, String)>| {
        send(
            hub.app.clone(),
            "GET",
            "/api/v1/employees/me/payslips",
            headers,
            None,
        )
    };
    let unset = own(read_headers(&hers)).await;
    assert_eq!(unset.status, StatusCode::FORBIDDEN, "{:?}", unset.body);
    assert!(unset.body["error"]
        .as_str()
        .unwrap_or_default()
        .contains("not set"));

    let set = send(
        hub.app.clone(),
        "POST",
        "/api/v1/employees/me/payslip-password",
        write_headers(&hers, &her_csrf),
        Some(json!({ "password": "slip-rahasia" })),
    )
    .await;
    assert_eq!(set.status, StatusCode::OK, "{:?}", set.body);

    let locked = own(read_headers(&hers)).await;
    assert_eq!(locked.status, StatusCode::FORBIDDEN, "{:?}", locked.body);
    assert!(locked.body["error"]
        .as_str()
        .unwrap_or_default()
        .contains("required"));
    let mut with = read_headers(&hers);
    with.push(("x-payslip-password".to_owned(), "slip-rahasia".to_owned()));
    let open = own(with).await;
    assert_eq!(open.status, StatusCode::OK, "{:?}", open.body);
    let hers_template = send(
        hub.app.clone(),
        "GET",
        "/api/v1/employees/me/payslip-template",
        read_headers(&hers),
        None,
    )
    .await;
    assert_eq!(
        hers_template.status,
        StatusCode::OK,
        "{:?}",
        hers_template.body
    );
    assert_eq!(hers_template.body["company_name"], "PT Contoh");

    let head_office = hub.get(&format!("/api/v1/employees/{siti}/payslips")).await;
    assert_eq!(head_office.status, StatusCode::OK, "{:?}", head_office.body);

    // Forgotten: head office resets it, and she chooses a new one.
    let reset = send(
        hub.app.clone(),
        "DELETE",
        &format!("/api/v1/employees/{siti}/payslip-password"),
        write_headers(&hub.cookies, &hub.csrf),
        None,
    )
    .await;
    assert_eq!(reset.status, StatusCode::OK, "{:?}", reset.body);
    assert_eq!(reset.body["reset"], true);
    let unset_again = own(read_headers(&hers)).await;
    assert!(unset_again.body["error"]
        .as_str()
        .unwrap_or_default()
        .contains("not set"));
}

// ── loans (0804) ────────────────────────────────────────────────────────────

fn loan_line(slip: &Value) -> Option<i64> {
    slip["deductions"]
        .as_array()
        .and_then(|lines| {
            lines
                .iter()
                .find(|line| line["component_code"] == "CICILAN_PINJAMAN")
        })
        .and_then(|line| line["amount_minor"].as_i64())
}

/// A loan is lent, paid out by Finance, and comes off pay a fixed instalment
/// a month until nothing is owed — the last instalment only what is left.
/// Nothing comes off before Finance has paid it out, and approval settles
/// each month's instalment against the advance.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_loan_comes_off_pay_until_it_is_repaid(pool: PgPool) {
    cloud::open_period(&pool, 2026, 4)
        .await
        .unwrap_or_else(|error| panic!("open: {error}"));
    let hub = Hub::open(&pool).await;
    let siti = hub.staff("K0790", "store-07", "2026-01-05").await;
    hub.pay(&siti, "2026-01-01", 5_000_000, json!([])).await;
    hub.identity(&siti, "ptkp", "TK/0").await;

    let granted = hub
        .post(
            &format!("/api/v1/employees/{siti}/loans"),
            json!({
                "amount_minor": 2_500_000, "instalment_minor": 1_000_000,
                "first_period": "2026-04", "purpose": "biaya sekolah",
                "reason": "disetujui HR",
            }),
        )
        .await;
    assert_eq!(granted.status, StatusCode::OK, "{:?}", granted.body);
    let loan = granted.body[0].clone();
    assert_eq!(loan["status"], "APPROVED");
    assert_eq!(loan["instalments_left"], 3);
    let advance = loan["advance_id"].as_str().unwrap_or_default().to_owned();

    // Lent but not paid out: nothing to take back yet.
    let (april, slips) = hub.run("store-07", "2026-04").await;
    assert_eq!(loan_line(slip_of(&slips, &siti)), None);

    let paid = hub
        .post(
            &format!("/api/v1/finance/advances/{advance}/pay"),
            json!({ "posting_date": "2026-04-02", "cash_key": "petty_cash", "cash_qualifier": "" }),
        )
        .await;
    assert_eq!(paid.status, StatusCode::OK, "{:?}", paid.body);

    hub.ok(&format!("/api/v1/payroll/runs/{april}/rebuild"), json!({}))
        .await;
    let slips = hub
        .get(&format!("/api/v1/payroll/runs/{april}/slips"))
        .await;
    let slips = slips.body.as_array().cloned().unwrap_or_default();
    assert_eq!(loan_line(slip_of(&slips, &siti)), Some(1_000_000));
    assert_eq!(slip_of(&slips, &siti)["net_minor"].as_i64().is_some(), true);

    let loans = hub.get(&format!("/api/v1/employees/{siti}/loans")).await;
    assert_eq!(loans.body[0]["pending_minor"], 1_000_000);
    assert_eq!(loans.body[0]["instalments_left"], 2);

    // Submitted by one officer, approved by another: the instalment settles.
    hub.ok(
        &format!("/api/v1/employees/{siti}/payroll-identity"),
        json!({
            "field": "bank_account", "bank_name": "BCA", "bank_account": "1234567890",
            "bank_holder": "Siti", "effective_from": "2026-01-01", "reason": "rekening gaji",
        }),
    )
    .await;
    hub.ok(&format!("/api/v1/payroll/runs/{april}/rebuild"), json!({}))
        .await;
    hub.ok(
        &format!("/api/v1/payroll/runs/{april}/submission"),
        json!({ "reason": "angka sudah dicek" }),
    )
    .await;
    hub.ok(
        "/api/v1/auth/users",
        json!({ "username": "hr.budi", "display_name": "Budi", "password": "budi-login-pass-1", "role": "ADMIN" }),
    )
    .await;
    let (budi, budi_csrf) = sign_in(&hub.app, "hr.budi", "budi-login-pass-1").await;
    let approved = send(
        hub.app.clone(),
        "POST",
        &format!("/api/v1/payroll/runs/{april}/approve"),
        write_headers(&budi, &budi_csrf),
        Some(json!({ "reason": "disetujui" })),
    )
    .await;
    assert_eq!(approved.status, StatusCode::OK, "{:?}", approved.body);

    let loans = hub.get(&format!("/api/v1/employees/{siti}/loans")).await;
    assert_eq!(loans.body[0]["repaid_minor"], 1_000_000);
    assert_eq!(loans.body[0]["pending_minor"], 0);
    assert_eq!(loans.body[0]["repayments"][0]["kind"], "PAYROLL");
    assert_eq!(loans.body[0]["repayments"][0]["period"], "2026-04");

    let (_, may) = hub.run("store-07", "2026-05").await;
    assert_eq!(loan_line(slip_of(&may, &siti)), Some(1_000_000));
    // What is left after April settled and May pending: the last instalment.
    let (_, june) = hub.run("store-07", "2026-06").await;
    assert_eq!(loan_line(slip_of(&june, &siti)), Some(500_000));
    let (_, july) = hub.run("store-07", "2026-07").await;
    assert_eq!(loan_line(slip_of(&july, &siti)), None);

    // Stopped: no further instalments are filed on a rebuild.
    let stopped = hub
        .post(
            &format!("/api/v1/payroll/loans/{advance}/stop"),
            json!({ "reason": "dilunasi tunai" }),
        )
        .await;
    assert_eq!(stopped.status, StatusCode::OK, "{:?}", stopped.body);
    assert_eq!(stopped.body[0]["stopped"], true);
    let all = hub.get("/api/v1/payroll/loans").await;
    assert_eq!(all.status, StatusCode::OK, "{:?}", all.body);
    assert_eq!(all.body.as_array().map(Vec::len), Some(1));
}

/// A month can be prorated by working days (0814): somebody who starts on
/// Monday 13 April 2026 is paid 16 of April's 26 Monday-to-Saturday days —
/// not 18 of its 30 calendar days.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_month_can_be_prorated_by_working_days(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    let siti = hub.staff("K0791", "store-07", "2026-04-13").await;
    hub.pay(&siti, "2026-04-13", 2_600_000, json!([])).await;
    hub.identity(&siti, "ptkp", "TK/0").await;

    let refused = hub
        .post(
            "/api/v1/payroll/schedule",
            json!({ "effective_from": "2026-01-01", "cutoff_day": null, "pay_day": null,
                    "prorate_basis": "WEEKDAYS", "reason": "salah" }),
        )
        .await;
    assert_eq!(
        refused.status,
        StatusCode::BAD_REQUEST,
        "{:?}",
        refused.body
    );
    let stated = hub
        .ok(
            "/api/v1/payroll/schedule",
            json!({ "effective_from": "2026-01-01", "cutoff_day": null, "pay_day": null,
                    "prorate_basis": "WORKDAYS_6", "reason": "prorata hari kerja" }),
        )
        .await;
    assert_eq!(stated[0]["prorate_basis"], "WORKDAYS_6");

    let (_, slips) = hub.run("store-07", "2026-04").await;
    let slip = slip_of(&slips, &siti);
    assert_eq!(slip["days_paid"], 16);
    assert_eq!(slip["days_in_month"], 26);
    assert_eq!(slip["base_minor"], 1_600_000);
}
