//! What People hands Finance, end to end over HTTP: a head-office month with
//! a position allowance, PPh 21 and BPJS, a loan instalment, leave paid out
//! and an absence — submitted, approved by a second officer, handed over as
//! the accrual, and paid from head office's bank — and a claim approved and
//! paid out of petty cash. Every journal balances and every liability the
//! month created is cleared by what pays it.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-payroll-finance-1";

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

fn sum_of(lines: &Value, codes: &[&str]) -> i64 {
    lines
        .as_array()
        .map(|all| {
            all.iter()
                .filter(|line| codes.iter().any(|code| line["component_code"] == *code))
                .filter_map(|line| line["amount_minor"].as_i64())
                .sum()
        })
        .unwrap_or_default()
}

/// The balance of one account at one unit, debit positive.
async fn balance(pool: &PgPool, code: &str, unit: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::bigint FROM journal_line
          WHERE account_code = $1 AND unit_id = $2",
    )
    .bind(code)
    .bind(unit)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("balance {code}: {error}"))
}

/// Entries that do not balance — there should be none.
async fn lopsided(pool: &PgPool) -> Vec<(String, i64)> {
    sqlx::query_as(
        "SELECT e.source_kind, SUM(l.debit_minor - l.credit_minor)::bigint
           FROM journal_entry e JOIN journal_line l ON l.entry_id = e.entry_id
          GROUP BY e.entry_id, e.source_kind
         HAVING SUM(l.debit_minor - l.credit_minor) <> 0",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("lopsided: {error}"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_head_office_month_reaches_the_books_and_is_paid(pool: PgPool) {
    let today = chrono::Utc::now().date_naive();
    for (year, month) in [
        (2026, 4),
        (
            chrono::Datelike::year(&today),
            chrono::Datelike::month(&today),
        ),
    ] {
        cloud::open_period(&pool, year, i32::try_from(month).unwrap_or(1))
            .await
            .unwrap_or_else(|error| panic!("open: {error}"));
    }
    let hub = Hub::open(&pool).await;

    // The month's ingredients, as HR sets them up from the People screens.
    hub.ok(
        "/api/v1/payroll/components",
        json!({ "code": "JABATAN", "label": "Tunjangan jabatan", "kind": "EARNING",
                "basis": "FIXED_AMOUNT", "reason": "tunjangan tetap" }),
    )
    .await;
    // Finance says where it lands: a head-office allowance is salary on the
    // head-office leaf (0466). Until it does, the handover refuses to post.
    hub.ok(
        "/api/v1/finance/account-links",
        json!({ "role": "payroll_expense", "source_type": "PAY_COMPONENT", "source_id": "JABATAN",
                "scope_type": "UNIT_KIND", "scope_key": "HO", "account_code": "6026" }),
    )
    .await;
    leave_setup(&hub, Some(5)).await;
    let ani = hub.staff("K0001", "ho", "2026-01-05").await;
    hub.pay(
        &ani,
        "2026-01-01",
        10_000_000,
        json!([{ "code": "JABATAN", "minor": 1_000_000 }]),
    )
    .await;
    hub.identity(&ani, "ptkp", "K/1").await;
    hub.identity(&ani, "bpjs_kesehatan", "0001234567891").await;
    hub.identity(&ani, "bpjs_ketenagakerjaan", "11000000003")
        .await;
    hub.ok(
        &format!("/api/v1/employees/{ani}/payroll-identity"),
        json!({ "field": "bank_account", "bank_name": "BCA", "bank_account": "1234567890",
                "bank_holder": "Ani", "effective_from": "2026-01-01", "reason": "rekening gaji" }),
    )
    .await;
    allocate(&hub, &ani, 12).await;

    // A loan, paid out by Finance, comes back a million a month.
    let granted = hub
        .ok(
            &format!("/api/v1/employees/{ani}/loans"),
            json!({ "amount_minor": 2_500_000, "instalment_minor": 1_000_000,
                    "first_period": "2026-04", "purpose": "biaya sekolah", "reason": "disetujui HR" }),
        )
        .await;
    let advance = granted[0]["advance_id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    hub.ok(
        &format!("/api/v1/finance/advances/{advance}/pay"),
        json!({ "posting_date": "2026-04-02", "cash_key": "petty_cash", "cash_qualifier": "" }),
    )
    .await;
    assert_eq!(
        balance(&pool, "1054", "ho").await,
        2_500_000,
        "the loan is an advance on 1054"
    );

    // Two rostered days with no punch, and the rule that makes them cost.
    hub.ok(
        "/api/v1/attendance-shifts",
        json!({ "id": "KANTOR", "name": "Kantor", "starts_at": "08:00", "ends_at": "17:00",
                "unpaid_break_minutes": 60 }),
    )
    .await;
    for day in ["2026-04-13", "2026-04-14"] {
        hub.ok(
            &format!("/api/v1/employees/{ani}/roster"),
            json!({ "on_date": day, "plan": "SCHEDULED", "shift_id": "KANTOR", "reason": "jadwal" }),
        )
        .await;
    }
    hub.ok(
        "/api/v1/payroll/absence-rules",
        json!({ "effective_from": "2026-04-01", "enabled": true, "basis": "BASE",
                "divisor_days": 25, "reason": "potongan absen" }),
    )
    .await;
    // Two days of leave paid out with the month.
    hub.ok(
        &format!("/api/v1/employees/{ani}/leave-encashments"),
        json!({ "leave_type": "CUTI_TAHUNAN", "days": 2, "period": "2026-04", "reason": "sisa cuti" }),
    )
    .await;

    let (run_id, slips) = hub.run("ho", "2026-04").await;
    let slip = slip_of(&slips, &ani).clone();
    // The allowance is the agreement's figure, in the statutory base, and a
    // defined JABATAN component does not leave the slip waiting on a rate.
    assert_eq!(slip["statutory_base_minor"], 11_000_000, "{slip:?}");
    assert_eq!(
        slip["components_incomplete_because"],
        Value::Null,
        "{slip:?}"
    );
    assert!(
        sum_of(&slip["earnings"], &["UANG_CUTI"]) > 0,
        "leave paid out: {slip:?}"
    );
    assert_eq!(
        sum_of(&slip["deductions"], &["POTONGAN_ABSEN"]),
        800_000,
        "{slip:?}"
    );
    assert_eq!(
        sum_of(&slip["deductions"], &["CICILAN_PINJAMAN"]),
        1_000_000,
        "{slip:?}"
    );
    let pph21 = sum_of(&slip["deductions"], &["PPH21"]);
    assert!(pph21 > 0, "PPh 21 withheld: {slip:?}");
    let employee_bpjs = sum_of(&slip["deductions"], &["BPJS_KES", "BPJS_JHT", "BPJS_JP"]);
    let company_bpjs = sum_of(
        &slip["company_contributions"],
        &[
            "BPJS_KES_CO",
            "BPJS_JHT_CO",
            "BPJS_JP_CO",
            "BPJS_JKK_CO",
            "BPJS_JKM_CO",
        ],
    );
    assert!(
        employee_bpjs > 0 && company_bpjs > 0,
        "BPJS both shares: {slip:?}"
    );
    let net = slip["net_minor"].as_i64().unwrap_or_default();

    // The place signs, a second officer approves, and HR hands it over.
    hub.ok(
        &format!("/api/v1/payroll/runs/{run_id}/submission"),
        json!({ "reason": "dicek" }),
    )
    .await;
    hub.ok(
        "/api/v1/auth/users",
        json!({ "username": "hr.budi", "display_name": "Budi", "password": ADMIN_PASSWORD,
                "role": "ADMIN" }),
    )
    .await;
    let (theirs, their_csrf) = sign_in(&hub.app, "hr.budi", ADMIN_PASSWORD).await;
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
        "approve: {:?}",
        approved.body
    );
    let crossed = hub
        .ok(
            &format!("/api/v1/payroll/runs/{run_id}/finance-handover"),
            json!({ "reason": "gaji April ke keuangan" }),
        )
        .await;
    assert_eq!(crossed["state"], "RECEIVED");

    // The accrual: the tax office, BPJS, the advance and the employee are
    // each owed exactly what the slip says.
    assert_eq!(balance(&pool, "2011", "ho").await, -pph21, "PPh 21 owed");
    assert_eq!(
        balance(&pool, "2021", "ho").await,
        -(employee_bpjs + company_bpjs),
        "BPJS owed, both shares"
    );
    assert_eq!(
        balance(&pool, "1054", "ho").await,
        1_500_000,
        "one instalment back"
    );
    assert_eq!(balance(&pool, "2017", "ho").await, -net, "net pay owed");
    let expense: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint
           FROM journal_line l JOIN journal_entry e ON e.entry_id = l.entry_id
          WHERE e.source_kind = 'PAYROLL_RUN' AND l.account_code LIKE '6%'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("expense: {error}"));
    let gross = slip["gross_minor"].as_i64().unwrap_or_default();
    let thr: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(credit_minor - debit_minor), 0)::bigint FROM journal_line
          WHERE account_code = '2018' AND unit_id = 'ho'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("thr: {error}"));
    assert_eq!(
        expense,
        gross - 800_000 + company_bpjs + thr,
        "cost = gross, less the absence, plus the company's BPJS and the THR accrual"
    );

    // Finance pays head office's staff from the bank, and 2017 is cleared.
    cloud::describe_account(
        &pool,
        &cloud::DescribeBankAccountRequest {
            ledger_account_code: "1005".into(),
            unit_id: "ho".into(),
            bank_code: Some("BCA".into()),
            bank_name: String::new(),
            account_no: "8880012345".into(),
            account_holder: "PT Contoh".into(),
            branch: None,
            kind: "GIRO".into(),
            is_primary: Some(true),
            note: None,
        },
        "admin",
    )
    .await
    .unwrap_or_else(|error| panic!("bank account: {error}"));
    let settle = format!("/api/v1/payroll/runs/{run_id}/finance-handover/settlement");
    let unsaid = hub.post(&settle, json!({ "reason": "transfer" })).await;
    assert_eq!(
        unsaid.status,
        StatusCode::BAD_REQUEST,
        "which bank: {:?}",
        unsaid.body
    );
    let paid = hub
        .ok(
            &settle,
            json!({ "reason": "transfer", "bank_key": "bank_giro", "bank_qualifier": "BCA" }),
        )
        .await;
    assert_eq!(paid["state"], "PAID");
    assert_eq!(
        balance(&pool, "2017", "ho").await,
        0,
        "payroll payable cleared"
    );
    assert_eq!(
        balance(&pool, "1005", "ho").await,
        -net,
        "the bank paid net"
    );

    // A claim: approval books the cost against what is owed to the person,
    // the payout clears it from petty cash.
    hub.ok(
        "/api/v1/expense-claim-types",
        json!({ "code": "MEDIS", "name": "Medis", "expense_category": "MEDICAL" }),
    )
    .await;
    let filed = hub
        .ok(
            "/api/v1/expense-claims",
            json!({ "employee_id": ani, "posted_on": "2026-04-10",
                    "lines": [{ "type_code": "MEDIS", "description": "berobat",
                                "spent_on": "2026-04-10", "claimed_minor": 350_000 }],
                    "reason": "klaim berobat" }),
        )
        .await;
    let claim = filed["claim_id"].as_str().unwrap_or_default().to_owned();
    let line = filed["lines"][0]["line_id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    hub.ok(
        &format!("/api/v1/expense-claims/{claim}/submission"),
        json!({ "reason": "ajukan" }),
    )
    .await;
    let decided = send(
        hub.app.clone(),
        "POST",
        &format!("/api/v1/expense-claims/{claim}/decision"),
        write_headers(&theirs, &their_csrf),
        Some(json!({ "approve": true, "reason": "sesuai kwitansi",
                     "lines": [{ "line_id": line, "sanctioned_minor": 350_000 }] })),
    )
    .await;
    assert_eq!(
        decided.status,
        StatusCode::OK,
        "approve claim: {:?}",
        decided.body
    );
    hub.ok(
        &format!("/api/v1/expense-claims/{claim}/payout"),
        json!({ "paid_on": "2026-04-15" }),
    )
    .await;
    let claim_books: Vec<(String, i64)> = sqlx::query_as(
        "SELECT l.account_code, SUM(l.debit_minor - l.credit_minor)::bigint
           FROM journal_entry e JOIN journal_line l ON l.entry_id = e.entry_id
          WHERE e.source_kind IN ('EXPENSE_CLAIM', 'EXPENSE_CLAIM_PAYOUT') AND e.source_id = $1
          GROUP BY l.account_code
         HAVING SUM(l.debit_minor - l.credit_minor) <> 0
          ORDER BY 1",
    )
    .bind(&claim)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("claim books: {error}"));
    assert_eq!(
        claim_books.len(),
        2,
        "cost and cash, payable cleared: {claim_books:?}"
    );
    assert!(
        claim_books
            .iter()
            .any(|(code, amount)| code.starts_with('6') && *amount == 350_000),
        "the claim is a cost: {claim_books:?}"
    );
    assert!(
        claim_books.iter().any(|(_, amount)| *amount == -350_000),
        "and left petty cash: {claim_books:?}"
    );

    assert_eq!(lopsided(&pool).await, vec![], "every journal balances");
}

/// A store cashier's loan is the store's receivable: paid out of the
/// store's petty cash and taken back by the store's payroll, so 1054 meets
/// itself in the store's books and head office's never moves.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_store_loan_is_lent_and_repaid_in_the_stores_books(pool: PgPool) {
    let today = chrono::Utc::now().date_naive();
    for (year, month) in [
        (2026, 4),
        (
            chrono::Datelike::year(&today),
            chrono::Datelike::month(&today),
        ),
    ] {
        cloud::open_period(&pool, year, i32::try_from(month).unwrap_or(1))
            .await
            .unwrap_or_else(|error| panic!("open: {error}"));
    }
    let hub = Hub::open(&pool).await;
    let siti = hub.staff("K0702", "store-07", "2026-01-05").await;
    hub.pay(&siti, "2026-01-01", 5_000_000, json!([])).await;
    hub.identity(&siti, "ptkp", "TK/0").await;
    hub.ok(
        &format!("/api/v1/employees/{siti}/payroll-identity"),
        json!({ "field": "bank_account", "bank_name": "BCA", "bank_account": "7712345678",
                "bank_holder": "Siti", "effective_from": "2026-01-01", "reason": "rekening gaji" }),
    )
    .await;
    let granted = hub
        .ok(
            &format!("/api/v1/employees/{siti}/loans"),
            json!({ "amount_minor": 1_500_000, "instalment_minor": 500_000,
                    "first_period": "2026-04", "purpose": "kebutuhan keluarga", "reason": "disetujui HR" }),
        )
        .await;
    let advance = granted[0]["advance_id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    hub.ok(
        &format!("/api/v1/finance/advances/{advance}/pay"),
        json!({ "posting_date": "2026-04-02", "cash_key": "petty_cash", "cash_qualifier": "" }),
    )
    .await;
    assert_eq!(
        balance(&pool, "1054", "store-07").await,
        1_500_000,
        "lent by the store"
    );

    let (run_id, _) = hub.run("store-07", "2026-04").await;
    hub.ok(
        &format!("/api/v1/payroll/runs/{run_id}/submission"),
        json!({ "reason": "dicek" }),
    )
    .await;
    hub.ok(
        "/api/v1/auth/users",
        json!({ "username": "hr.budi", "display_name": "Budi", "password": ADMIN_PASSWORD,
                "role": "ADMIN" }),
    )
    .await;
    let (theirs, their_csrf) = sign_in(&hub.app, "hr.budi", ADMIN_PASSWORD).await;
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
        "approve: {:?}",
        approved.body
    );
    hub.ok(
        &format!("/api/v1/payroll/runs/{run_id}/finance-handover"),
        json!({ "reason": "gaji April ke keuangan" }),
    )
    .await;

    assert_eq!(
        balance(&pool, "1054", "store-07").await,
        1_000_000,
        "one instalment back"
    );
    assert_eq!(
        balance(&pool, "1054", "ho").await,
        0,
        "head office lent nothing"
    );
    assert_eq!(lopsided(&pool).await, vec![], "every journal balances");
}

/// Two fixes found by hand in the hub (1 Oct): a transfer approved for the
/// 16th pays the old place the 1st–15th — the 15th included — and the new
/// place the rest; and a component defined for a per-person allowance
/// (JABATAN, no rate) does not leave the slip of somebody without that
/// allowance waiting on a rate.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_transfer_pays_every_day_once_and_an_allowance_code_blocks_nobody(pool: PgPool) {
    let hub = Hub::open(&pool).await;
    hub.ok(
        "/api/v1/payroll/components",
        json!({ "code": "JABATAN", "label": "Tunjangan jabatan", "kind": "EARNING",
                "basis": "FIXED_AMOUNT", "reason": "tunjangan tetap" }),
    )
    .await;
    let siti = hub.staff("K0801", "store-07", "2026-01-05").await;
    hub.pay(
        &siti,
        "2026-01-01",
        5_000_000,
        json!([{ "code": "JABATAN", "minor": 500_000 }]),
    )
    .await;
    hub.identity(&siti, "ptkp", "TK/0").await;
    let budi = hub.staff("K0802", "store-07", "2026-01-05").await;
    hub.pay(&budi, "2026-01-01", 3_000_000, json!([])).await;
    hub.identity(&budi, "ptkp", "TK/0").await;

    let filed = hub
        .ok(
            &format!("/api/v1/employees/{budi}/change-proposals"),
            json!({ "kind": "TRANSFER", "props": [{ "field": "unit_id", "to_text": "store-08" }],
                    "effective_on": "2026-04-16", "reason": "mutasi" }),
        )
        .await;
    let proposal = filed["id"].as_str().unwrap_or_default().to_owned();
    assert_eq!(
        filed["props"][0]["from"], "store-07",
        "where they are now: {filed:?}"
    );
    hub.ok(
        "/api/v1/auth/users",
        json!({ "username": "hr.budi", "display_name": "Budi", "password": ADMIN_PASSWORD,
                "role": "ADMIN" }),
    )
    .await;
    let (theirs, their_csrf) = sign_in(&hub.app, "hr.budi", ADMIN_PASSWORD).await;
    let decided = send(
        hub.app.clone(),
        "POST",
        &format!("/api/v1/change-proposals/{proposal}/decision"),
        write_headers(&theirs, &their_csrf),
        Some(json!({ "approved": true, "reason": "disetujui" })),
    )
    .await;
    assert_eq!(decided.status, StatusCode::OK, "{:?}", decided.body);

    let (_, before) = hub.run("store-07", "2026-04").await;
    let (_, after) = hub.run("store-08", "2026-04").await;
    let old_days = slip_of(&before, &budi)["days_paid"]
        .as_i64()
        .unwrap_or_default();
    let new_days = slip_of(&after, &budi)["days_paid"]
        .as_i64()
        .unwrap_or_default();
    assert_eq!(old_days, 15, "the old place pays the 1st to the 15th");
    assert_eq!(old_days + new_days, 30, "every day of April paid once");

    assert_eq!(
        slip_of(&before, &budi)["components_incomplete_because"],
        Value::Null,
        "JABATAN is Siti's allowance, not a rate Budi waits on"
    );
    assert_eq!(
        slip_of(&before, &siti)["components_incomplete_because"],
        Value::Null
    );
}

/// THR paid in a month before a year's accrual has been built up (a company
/// that starts mid-year) comes out of what was accrued and the rest is the
/// month's THR expense — the THR liability never goes into a debit balance.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn thr_beyond_the_accrual_is_expense_not_a_debit_liability(pool: PgPool) {
    let today = chrono::Utc::now().date_naive();
    for (year, month) in [
        (2026, 3),
        (
            chrono::Datelike::year(&today),
            chrono::Datelike::month(&today),
        ),
    ] {
        cloud::open_period(&pool, year, i32::try_from(month).unwrap_or(1))
            .await
            .unwrap_or_else(|error| panic!("open: {error}"));
    }
    let hub = Hub::open(&pool).await;
    let siti = hub.staff("K0811", "store-07", "2025-01-01").await;
    hub.pay(&siti, "2025-01-01", 6_000_000, json!([])).await;
    hub.identity(&siti, "ptkp", "TK/0").await;
    hub.ok(
        &format!("/api/v1/employees/{siti}/payroll-identity"),
        json!({ "field": "bank_account", "bank_name": "BCA", "bank_account": "7712345678",
                "bank_holder": "Siti", "effective_from": "2025-01-01", "reason": "rekening gaji" }),
    )
    .await;
    let (run_id, _) = hub.run("store-07", "2026-03").await;
    hub.ok(
        &format!("/api/v1/payroll/runs/{run_id}/thr"),
        json!({ "holiday_on": "2026-03-20", "reason": "THR Idul Fitri" }),
    )
    .await;
    hub.ok(
        &format!("/api/v1/payroll/runs/{run_id}/submission"),
        json!({ "reason": "dicek" }),
    )
    .await;
    hub.ok(
        "/api/v1/auth/users",
        json!({ "username": "hr.budi", "display_name": "Budi", "password": ADMIN_PASSWORD,
                "role": "ADMIN" }),
    )
    .await;
    let (theirs, their_csrf) = sign_in(&hub.app, "hr.budi", ADMIN_PASSWORD).await;
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
        "approve: {:?}",
        approved.body
    );
    hub.ok(
        &format!("/api/v1/payroll/runs/{run_id}/finance-handover"),
        json!({ "reason": "gaji Maret" }),
    )
    .await;

    assert_eq!(
        balance(&pool, "2018", "store-07").await,
        0,
        "THR owed never goes negative"
    );
    assert_eq!(
        balance(&pool, "6018", "store-07").await,
        6_000_000,
        "the whole THR is this month's THR expense"
    );
    assert_eq!(lopsided(&pool).await, vec![], "every journal balances");
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
