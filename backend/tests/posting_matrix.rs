//! The posting matrix: every account in the client chart, every way into it.
//!
//! `tests/fixtures/posting_matrix_expected.csv` says, for every one of the 263
//! active posting leaves (and a sample of retired and heading accounts), what
//! the WRITTEN rules expect — `FINANCE-HARD-RULES.md` of 25 Sep 2026, the
//! owner's rules as restated for this run, and `ACCOUNT-DECISIONS.md` for which
//! meaning lands where. It is deliberately not generated from the database's
//! own policy columns (`posting_mode`, `manual_je_policy`, `dimension`,
//! `requires_counter_site`, `account_source_rule`, `account_resolution`): a test that
//! read its expectations off the thing it tests would prove nothing.
//!
//! Against a fresh database with every migration, this test drives:
//!
//! * a balanced Finance HO manual journal on every account at head office and
//!   at `store-01`, through the real HTTP router as an ADMIN (the role the
//!   router demands for `POST /api/v1/finance/journal`), and the same request
//!   as a store CASHIER and a store SUPERVISOR, which must be refused;
//! * an automatic (rule-kind) posting naming every account directly, at both
//!   sites, through the poster — the path a supplier bill's hand-chosen
//!   expense line takes;
//! * every `account_resolution` row (role × unit × source): it resolves to an
//!   active leaf, and a minimal balanced entry through that meaning posts —
//!   or is refused where the rules say the target may not sit there;
//! * the affiliate convention: no unit line on 1057/1058/1059, no head-office
//!   line on 2028/2029/2030, unit ↔ unit refused, counter always HO ↔ unit.
//!
//! Every result is written to
//! `runs/finance-posting-matrix/2026-09-25/matrix-actual.csv`; every mismatch
//! is collected and the test fails once, at the end, with the whole list.
//! `UNSPECIFIED` expectations are recorded and never fail.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::postgres::{self as cloud, LineAccount, PostingIntent, PostingLine};
use inventory_backend::cloud::{http as cloud_http, AppConfig, AppState};
use inventory_backend::security;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::collections::{BTreeMap, BTreeSet};
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;
use uuid::Uuid;

const ADMIN_PASSWORD: &str = "admin-password-posting-matrix-1";
const CASHIER_PASSWORD: &str = "cashier-password-posting-matrix-1";
const SUPERVISOR_PASSWORD: &str = "supervisor-password-posting-matrix-1";
/// Head office's UNIT id — books are keyed by unit since 0605, and 0600 creates
/// exactly this one everywhere. `dc` is a *site* (a premises), which is a
/// different thing and is why nothing here spells it.
const HO: &str = "ho";
const UNIT: &str = "store-01";
const ACTOR: &str = "posting-matrix";
const AMOUNT: i64 = 1_000;

const PIUTANG: [&str; 3] = ["1057", "1058", "1059"];
const HUTANG: [&str; 3] = ["2028", "2029", "2030"];
const FAMILIES: [(&str, &str, &str, &str); 3] = [
    // (family, source kind the balancer maps to it, HO piutang, unit hutang)
    ("PEMBIAYAAN", "PAYMENT", "1057", "2028"),
    ("BARANG", "TRANSFER", "1058", "2029"),
    ("LAIN", "MANAGEMENT_FEE", "1059", "2030"),
];

// ---------------------------------------------------------------------------
// The expectation table
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct Expected {
    account_code: String,
    name: String,
    manual_at_ho: String,
    manual_at_unit_by_ho: String,
    manual_by_store_user: String,
    auto_meanings: String,
    auto_at_ho: String,
    auto_at_unit: String,
    needs_counter_site: String,
    rule_source: String,
}

impl Expected {
    fn auto_at(&self, site: &str) -> &str {
        if site == HO {
            &self.auto_at_ho
        } else {
            &self.auto_at_unit
        }
    }

    fn wants_counter(&self) -> bool {
        self.needs_counter_site != "NO"
    }
}

fn expectations() -> Vec<Expected> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/posting_matrix_expected.csv");
    let mut reader = csv::Reader::from_path(&path)
        .unwrap_or_else(|error| panic!("open {}: {error}", path.display()));
    reader
        .deserialize()
        .map(|row| row.unwrap_or_else(|error| panic!("expectation row: {error}")))
        .collect()
}

/// What happened, and whether it is what the rules say.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Outcome {
    Allow,
    Refuse,
}

impl Outcome {
    fn as_str(self) -> &'static str {
        match self {
            Self::Allow => "ALLOW",
            Self::Refuse => "REFUSE",
        }
    }
}

/// One line of `matrix-actual.csv`.
struct Actual {
    path: String,
    account: String,
    site: String,
    detail: String,
    expected: String,
    actual: String,
    verdict: String,
    message: String,
}

#[derive(Default)]
struct Matrix {
    rows: Vec<Actual>,
    mismatches: Vec<String>,
    passes: usize,
    unspecified: usize,
}

impl Matrix {
    /// Record a result against an expectation of ALLOW / REFUSE / UNSPECIFIED.
    #[allow(clippy::too_many_arguments)]
    fn check(
        &mut self,
        path: &str,
        account: &str,
        site: &str,
        detail: &str,
        expected: &str,
        actual: Outcome,
        message: &str,
        why: &str,
    ) {
        let verdict = match expected {
            "ALLOW" | "REFUSE" if expected == actual.as_str() => {
                self.passes += 1;
                "PASS"
            }
            "ALLOW" | "REFUSE" => {
                self.mismatches.push(format!(
                    "{path} {account} @{site} [{detail}]: expected {expected}, got {} — {} (rule: {why})",
                    actual.as_str(),
                    short(message)
                ));
                "MISMATCH"
            }
            _ => {
                self.unspecified += 1;
                "UNSPECIFIED"
            }
        };
        self.rows.push(Actual {
            path: path.into(),
            account: account.into(),
            site: site.into(),
            detail: detail.into(),
            expected: expected.into(),
            actual: actual.as_str().into(),
            verdict: verdict.into(),
            message: short(message),
        });
    }

    /// A structural assertion that is not an ALLOW/REFUSE probe.
    fn assert(
        &mut self,
        path: &str,
        account: &str,
        site: &str,
        detail: &str,
        ok: bool,
        message: &str,
    ) {
        if ok {
            self.passes += 1;
        } else {
            self.mismatches
                .push(format!("{path} {account} @{site} [{detail}]: {message}"));
        }
        self.rows.push(Actual {
            path: path.into(),
            account: account.into(),
            site: site.into(),
            detail: detail.into(),
            expected: "HOLDS".into(),
            actual: if ok { "HOLDS" } else { "BROKEN" }.into(),
            verdict: if ok { "PASS" } else { "MISMATCH" }.into(),
            message: short(message),
        });
    }

    fn note(&mut self, path: &str, account: &str, site: &str, detail: &str, message: &str) {
        self.rows.push(Actual {
            path: path.into(),
            account: account.into(),
            site: site.into(),
            detail: detail.into(),
            expected: "-".into(),
            actual: "-".into(),
            verdict: "INFO".into(),
            message: short(message),
        });
    }

    fn write(&self) -> PathBuf {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../runs/finance-posting-matrix/2026-09-25");
        std::fs::create_dir_all(&dir)
            .unwrap_or_else(|error| panic!("mkdir {}: {error}", dir.display()));
        let path = dir.join("matrix-actual.csv");
        let mut writer = csv::Writer::from_path(&path)
            .unwrap_or_else(|error| panic!("write {}: {error}", path.display()));
        writer
            .write_record([
                "path", "account", "site", "detail", "expected", "actual", "verdict", "message",
            ])
            .unwrap_or_else(|error| panic!("header: {error}"));
        for row in &self.rows {
            writer
                .write_record([
                    &row.path,
                    &row.account,
                    &row.site,
                    &row.detail,
                    &row.expected,
                    &row.actual,
                    &row.verdict,
                    &row.message,
                ])
                .unwrap_or_else(|error| panic!("row: {error}"));
        }
        writer
            .flush()
            .unwrap_or_else(|error| panic!("flush: {error}"));
        path
    }
}

fn short(message: &str) -> String {
    let flat = message.replace('\n', " ");
    if flat.chars().count() > 240 {
        let cut: String = flat.chars().take(240).collect();
        format!("{cut}…")
    } else {
        flat
    }
}

// ---------------------------------------------------------------------------
// HTTP, as the outside world reaches the manual journal
// ---------------------------------------------------------------------------

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
        node_id: "cloud-posting-matrix-test".into(),
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
        default_destination_site_id: String::new(),
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

fn write_headers(who: &(String, String)) -> Vec<(String, String)> {
    vec![
        (header::COOKIE.to_string(), who.0.clone()),
        ("x-csrf-token".to_string(), who.1.clone()),
    ]
}

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
        write_headers(admin),
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

fn json_line(account: &str, unit: &str, counter: Option<&str>, debit: i64, credit: i64) -> Value {
    json!({
        "account": { "kind": "account", "account_code": account },
        "unit_id": unit,
        "counter_unit_id": counter,
        "debit_minor": debit,
        "credit_minor": credit,
    })
}

/// A balanced manual journal: the account under test against a neutral one at
/// the same site, so no inter-unit leg is involved.
async fn manual_journal(
    app: &axum::Router,
    who: &(String, String),
    account: &str,
    site: &str,
    counter: Option<&str>,
) -> (Outcome, String) {
    let balancing = neutral_for(account);
    let response = send(
        app.clone(),
        "POST",
        "/api/v1/finance/journal",
        write_headers(who),
        Some(json!({
            "posting_date": "2026-09-15",
            "memo": format!("posting matrix: {account} at {site}"),
            "lines": [
                json_line(account, site, counter, AMOUNT, 0),
                json_line(balancing, site, None, 0, AMOUNT),
            ],
        })),
    )
    .await;
    let outcome = if response.status == StatusCode::OK {
        Outcome::Allow
    } else {
        Outcome::Refuse
    };
    let message = if response.status == StatusCode::OK {
        String::new()
    } else {
        format!("HTTP {}: {}", response.status.as_u16(), response.body)
    };
    (outcome, message)
}

/// The balancing account: 8008 is a unit-dimension leaf with no source rule,
/// no category and no counter-site, which every site may post; 6064 stands in
/// when 8008 itself is the account under test.
fn neutral_for(account: &str) -> &'static str {
    if account == "8008" {
        "6064"
    } else {
        "8008"
    }
}

fn the_other_side(site: &str) -> &'static str {
    if site == HO {
        UNIT
    } else {
        HO
    }
}

// ---------------------------------------------------------------------------
// The poster, as a posting rule reaches it
// ---------------------------------------------------------------------------

fn day() -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(2026, 9, 15).unwrap_or_else(|| panic!("bad date"))
}

async fn try_post(
    pool: &PgPool,
    kind: &str,
    lines: Vec<PostingLine>,
) -> (Outcome, String, Option<Uuid>) {
    post_as(pool, kind, lines, "posting_matrix/1").await
}

/// Direct probes name an account code on an automatic kind; they carry their
/// own rule version so the ledger-direction sweep can tell them from the
/// meaning and balancer paths (their result is already judged per probe).
const DIRECT: &str = "posting_matrix/direct";

async fn post_as(
    pool: &PgPool,
    kind: &str,
    lines: Vec<PostingLine>,
    rule_version: &str,
) -> (Outcome, String, Option<Uuid>) {
    let intent = PostingIntent {
        posting_date: day(),
        source_kind: kind.into(),
        source_id: Some(Uuid::new_v4().to_string()),
        rule_version: rule_version.into(),
        currency: "IDR".into(),
        memo: Some(format!("posting matrix {kind}")),
        lines,
    };
    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(error) => return (Outcome::Refuse, error.to_string(), None),
    };
    match cloud::post(&mut tx, &intent, None, ACTOR).await {
        Ok(posted) => match tx.commit().await {
            Ok(()) => (Outcome::Allow, String::new(), Some(posted.entry_id)),
            Err(error) => (Outcome::Refuse, format!("at commit: {error}"), None),
        },
        Err(error) => (Outcome::Refuse, error.to_string(), None),
    }
}

fn code(account: &str) -> LineAccount {
    LineAccount::Account {
        account_code: account.into(),
        category_code: None,
    }
}

/// The source kind an automatic probe uses: the one the rule names when the
/// account is `ONLY:<kind>`, otherwise a plain money document.
fn probe_kind(expectation: &str) -> &str {
    expectation.strip_prefix("ONLY:").unwrap_or("PAYMENT")
}

/// ALLOW / REFUSE / UNSPECIFIED for a probe with the probe kind.
fn probe_expectation(expectation: &str) -> &str {
    if expectation.starts_with("ONLY:") {
        "ALLOW"
    } else {
        expectation
    }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/// Describe one real bank account for every bank meaning at every site, so a
/// bank leg is judged on policy rather than refused as "banking setup is
/// incomplete". Returns what could not be described, as data.
async fn describe_bank_accounts(pool: &PgPool) -> Vec<(String, String, String)> {
    let rows = sqlx::query(
        "SELECT DISTINCT account_code, unit_id, source_id,
                CASE role WHEN 'bank_giro' THEN 'GIRO'
                          WHEN 'bank_savings' THEN 'SAVINGS'
                          ELSE 'TIME_DEPOSIT' END AS kind
           FROM account_resolution
          WHERE role IN ('bank_giro', 'bank_savings', 'time_deposit')
          ORDER BY account_code, unit_id",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("bank meanings: {error}"));
    let mut refused = Vec::new();
    for (n, row) in rows.iter().enumerate() {
        let ledger: String = row.get("account_code");
        let unit: String = row.get("unit_id");
        let bank: String = row.get("source_id");
        let kind: String = row.get("kind");
        let described = cloud::describe_account(
            pool,
            &cloud::DescribeBankAccountRequest {
                ledger_account_code: ledger.clone(),
                unit_id: unit.clone(),
                bank_code: Some(bank.clone()),
                bank_name: String::new(),
                account_no: format!("77{:08}", n + 1),
                account_holder: "PT Contoh".into(),
                branch: None,
                kind,
                is_primary: Some(false),
                note: None,
            },
            ACTOR,
        )
        .await;
        if let Err(error) = described {
            refused.push((ledger, unit, format!("{bank}: {error}")));
        }
    }
    refused
}

// ---------------------------------------------------------------------------
// Meaning specs from the expectation table
// ---------------------------------------------------------------------------

/// `key`, `key(Q)`, `key(PREFIX*)`, each optionally `@HO` / `@UNIT`.
struct MeaningSpec {
    key: String,
    qualifier: String,
    glob: bool,
    scope: Option<&'static str>,
}

fn parse_spec(spec: &str) -> MeaningSpec {
    let (body, scope) = match spec.rsplit_once('@') {
        Some((body, "HO")) => (body, Some("HO")),
        Some((body, "UNIT")) => (body, Some("UNIT")),
        _ => (spec, None),
    };
    let (key, qualifier) = match body.split_once('(') {
        Some((key, rest)) => (key, rest.trim_end_matches(')')),
        None => (body, ""),
    };
    let glob = qualifier.ends_with('*');
    MeaningSpec {
        key: key.into(),
        qualifier: qualifier.trim_end_matches('*').into(),
        glob,
        scope,
    }
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_account_every_path_matches_the_written_rules(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    cloud::open_period(&pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let admin = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    let cashier = a_user(&app, &admin, "matrix-cashier", "CASHIER", CASHIER_PASSWORD).await;
    let supervisor = a_user(
        &app,
        &admin,
        "matrix-supervisor",
        "SUPERVISOR",
        SUPERVISOR_PASSWORD,
    )
    .await;

    let mut m = Matrix::default();
    for (ledger, site, why) in describe_bank_accounts(&pool).await {
        m.note(
            "setup:bank_account",
            &ledger,
            &site,
            "describe_account",
            &why,
        );
    }

    let expected = expectations();
    let by_code: BTreeMap<&str, &Expected> = expected
        .iter()
        .map(|row| (row.account_code.as_str(), row))
        .collect();

    // The table must cover the whole active chart.
    let active: Vec<String> = sqlx::query_scalar(
        "SELECT account_code FROM ledger_account WHERE is_active AND NOT is_group ORDER BY 1",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("active chart: {error}"));
    m.assert(
        "chart",
        "*",
        "*",
        "active leaves",
        active.len() == 263,
        &format!(
            "FINANCE-HARD-RULES P1: 263 active posting leaves, the chart has {}",
            active.len()
        ),
    );
    for account in &active {
        m.assert(
            "chart",
            account,
            "*",
            "in expectation table",
            by_code.contains_key(account.as_str()),
            "active leaf missing from posting_matrix_expected.csv",
        );
    }

    let mut accounts_tested = 0usize;
    let mut manual_paths = 0usize;
    for row in &expected {
        accounts_tested += 1;
        let account = row.account_code.as_str();

        // ── 1. Finance HO manual journal, at head office and at a store ─────
        for (site, want) in [(HO, &row.manual_at_ho), (UNIT, &row.manual_at_unit_by_ho)] {
            let counter = row.wants_counter().then(|| the_other_side(site));
            let (got, message) = manual_journal(&app, &admin, account, site, counter).await;
            manual_paths += 1;
            m.check(
                "manual:finance_ho",
                account,
                site,
                &format!("{} counter={}", row.name, counter.unwrap_or("-")),
                want,
                got,
                &message,
                &row.rule_source,
            );
        }

        // ── 2. A store user may not write a journal at all, anywhere ────────
        for (who, name) in [(&cashier, "CASHIER"), (&supervisor, "SUPERVISOR")] {
            for site in [UNIT, HO] {
                let counter = row.wants_counter().then(|| the_other_side(site));
                let (got, message) = manual_journal(&app, who, account, site, counter).await;
                manual_paths += 1;
                let forbidden = message.starts_with("HTTP 403");
                m.check(
                    "manual:store_user",
                    account,
                    site,
                    name,
                    &row.manual_by_store_user,
                    if got == Outcome::Refuse && !forbidden {
                        // Refused, but by the entry and not by the role gate:
                        // that is not the refusal I2 asks for.
                        Outcome::Allow
                    } else {
                        got
                    },
                    &message,
                    "I2 (stores have no manual-journal access; refusal must be the role gate, 403)",
                );
            }
        }

        // ── 3. Counter-site: an affiliate line naming only its own site ─────
        if row.needs_counter_site != "NO" {
            let site = if HUTANG.contains(&account) || row.needs_counter_site == "UNSPECIFIED" {
                UNIT
            } else {
                HO
            };
            let (got, message) = manual_journal(&app, &admin, account, site, None).await;
            manual_paths += 1;
            let want = if row.needs_counter_site == "YES" {
                "REFUSE"
            } else {
                "UNSPECIFIED"
            };
            m.check(
                "manual:no_counter_site",
                account,
                site,
                "counter=-",
                want,
                got,
                &message,
                &row.rule_source,
            );
        }

        // ── 4. An automatic document naming the account directly ────────────
        for site in [HO, UNIT] {
            let expectation = row.auto_at(site);
            let kind = probe_kind(expectation);
            let counter = row.wants_counter().then(|| the_other_side(site));
            let mut line = PostingLine::debit(code(account), site, AMOUNT);
            if let Some(counter) = counter {
                line = line.with_counter_unit(counter);
            }
            let (got, message, _) = post_as(
                &pool,
                kind,
                vec![
                    line,
                    PostingLine::credit(code(neutral_for(account)), site, AMOUNT),
                ],
                DIRECT,
            )
            .await;
            m.check(
                "auto:direct",
                account,
                site,
                kind,
                probe_expectation(expectation),
                got,
                &message,
                &row.rule_source,
            );
            // `ONLY:<kind>` also means every other automatic kind is refused.
            if expectation.starts_with("ONLY:") {
                let mut line = PostingLine::debit(code(account), site, AMOUNT);
                if let Some(counter) = counter {
                    line = line.with_counter_unit(counter);
                }
                let (got, message, _) = post_as(
                    &pool,
                    "STORE_EXPENSE",
                    vec![
                        line,
                        PostingLine::credit(code(neutral_for(account)), site, AMOUNT),
                    ],
                    DIRECT,
                )
                .await;
                m.check(
                    "auto:direct",
                    account,
                    site,
                    "STORE_EXPENSE",
                    "REFUSE",
                    got,
                    &message,
                    &row.rule_source,
                );
            }
        }

        // ── 5. Which meanings land here, against what the documents say ─────
        let mapped: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT role, unit_id, source_id FROM account_resolution
              WHERE account_code = $1 ORDER BY 1, 2, 3",
        )
        .bind(account)
        .fetch_all(&pool)
        .await
        .unwrap_or_else(|error| panic!("map of {account}: {error}"));
        let keys: BTreeSet<&str> = mapped.iter().map(|(key, _, _)| key.as_str()).collect();
        let keys = keys.into_iter().collect::<Vec<_>>().join(";");
        match row.auto_meanings.as_str() {
            "NONE" => m.assert(
                "meaning:expected_none",
                account,
                "*",
                "account_resolution",
                mapped.is_empty(),
                &format!(
                    "no meaning may map here; the map has {} rows: {keys}",
                    mapped.len()
                ),
            ),
            "UNSPECIFIED" => m.note(
                "meaning:mapped",
                account,
                "*",
                "documents name no meaning",
                &format!("{} rows: {keys}", mapped.len()),
            ),
            specs => {
                for spec in specs.split(';') {
                    let spec = parse_spec(spec);
                    let rows: Vec<(String, String, String)> = sqlx::query_as(
                        "SELECT r.unit_id, r.source_id, r.account_code
                           FROM account_resolution r JOIN unit u ON u.id = r.unit_id
                          WHERE r.role = $1
                            AND (CASE WHEN $3 THEN r.source_id LIKE $2 || '%'
                                      ELSE r.source_id = $2 END)
                            AND ($4::text IS NULL
                                 OR ($4 = 'HO' AND u.kind = 'HO')
                                 OR ($4 = 'UNIT' AND u.kind <> 'HO'))
                          ORDER BY 1, 2",
                    )
                    .bind(&spec.key)
                    .bind(&spec.qualifier)
                    .bind(spec.glob)
                    .bind(spec.scope)
                    .fetch_all(&pool)
                    .await
                    .unwrap_or_else(|error| panic!("spec {}: {error}", spec.key));
                    let elsewhere: Vec<String> = rows
                        .iter()
                        .filter(|(_, _, target)| target != account)
                        .map(|(site, qualifier, target)| format!("{site}({qualifier})→{target}"))
                        .collect();
                    let detail = format!(
                        "{}({}{}){}",
                        spec.key,
                        spec.qualifier,
                        if spec.glob { "*" } else { "" },
                        spec.scope.map(|s| format!("@{s}")).unwrap_or_default()
                    );
                    m.assert(
                        "meaning:documented",
                        account,
                        "*",
                        &detail,
                        !rows.is_empty() && elsewhere.is_empty(),
                        &if rows.is_empty() {
                            "the documents name this meaning for the account; the map has no such row".to_string()
                        } else {
                            format!(
                                "{} of {} rows resolve elsewhere: {}",
                                elsewhere.len(),
                                rows.len(),
                                elsewhere.iter().take(6).cloned().collect::<Vec<_>>().join(", ")
                            )
                        },
                    );
                }
                m.note(
                    "meaning:mapped",
                    account,
                    "*",
                    "all mapped keys",
                    &format!("{} rows: {keys}", mapped.len()),
                );
            }
        }
    }

    // ── 6. Every account_resolution row resolves and posts ──────────────────
    // `source_type` travels with each row: a meaning linked to a master record
    // (an expense category, a supplier, an asset class) resolves THROUGH that
    // source, and looking it up as the company's default finds nothing. The
    // column is read here and passed on, rather than assumed to be COMPANY.
    let map_rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT role, unit_id, source_type, source_id, account_code FROM account_resolution ORDER BY 1, 2, 3, 4",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("map rows: {error}"));
    let meanings_tested = map_rows.len();
    let mut dead_rows: BTreeMap<String, usize> = BTreeMap::new();
    for (key, site, source_type, qualifier, _) in &map_rows {
        let detail = format!("{key}({qualifier})");
        let resolved =
            match cloud::resolve_account_from(&pool, key, site, source_type, qualifier).await {
                Ok(resolved) => resolved.account_code,
                Err(error) => {
                    m.assert(
                        "meaning:resolve",
                        "?",
                        site,
                        &detail,
                        false,
                        &error.to_string(),
                    );
                    continue;
                }
            };
        let leaf: Option<(bool, bool)> = sqlx::query_as(
            "SELECT is_active, is_group FROM ledger_account WHERE account_code = $1",
        )
        .bind(&resolved)
        .fetch_optional(&pool)
        .await
        .unwrap_or_else(|error| panic!("leaf {resolved}: {error}"));
        let leaf_ok = matches!(leaf, Some((true, false)));
        m.assert(
            "meaning:resolve",
            &resolved,
            site,
            &detail,
            leaf_ok,
            &format!("resolves to an active non-group leaf: {leaf:?}"),
        );

        let row = by_code.get(resolved.as_str());
        let (expectation, why): (String, String) = match row {
            None => (
                "REFUSE".into(),
                "not a leaf in the expectation table".into(),
            ),
            Some(row) => (row.auto_at(site).to_string(), row.rule_source.clone()),
        };
        // The affiliate qualifier names the other side, `<FAMILY>:<site>`.
        let affiliate_counter = key
            .starts_with("affiliate_")
            .then(|| {
                qualifier
                    .split_once(':')
                    .map(|(_, other)| other.to_string())
            })
            .flatten();
        let family = qualifier
            .split_once(':')
            .map(|(family, _)| family)
            .unwrap_or("");
        let (want, why) = match affiliate_counter.as_deref() {
            Some(other) if site != HO && other != HO => (
                "REFUSE".to_string(),
                "I8 (unit ↔ unit is forbidden; a unit line's counter is always head office)"
                    .to_string(),
            ),
            Some(other) if site == HO && other == HO => (
                "REFUSE".to_string(),
                "I8 (an HO line's counter is a unit)".to_string(),
            ),
            _ => (probe_expectation(&expectation).to_string(), why),
        };
        let kind = if expectation.starts_with("ONLY:") {
            probe_kind(&expectation).to_string()
        } else if key.starts_with("affiliate_") {
            FAMILIES
                .iter()
                .find(|(f, _, _, _)| *f == family)
                .map(|(_, kind, _, _)| kind.to_string())
                .unwrap_or_else(|| "PAYMENT".into())
        } else if key.contains("in_transit") {
            "TRANSFER".into()
        } else {
            "PAYMENT".into()
        };
        let counter = affiliate_counter.or_else(|| {
            row.filter(|row| row.wants_counter())
                .map(|_| the_other_side(site).to_string())
        });
        // Resolved the way the row is linked: a meaning tied to a master record
        // (`EXPENSE_CATEGORY`, an asset class, a supplier) is reached through
        // that source, and a plain qualifier would look for the company's
        // default link, which a per-category chart does not keep.
        let mut line =
            PostingLine::debit(key.as_str(), site, AMOUNT).from_source(source_type, qualifier);
        if let Some(counter) = &counter {
            line = line.with_counter_unit(counter);
        }
        let (got, message, _) = try_post(
            &pool,
            &kind,
            vec![
                line,
                PostingLine::credit(code(neutral_for(&resolved)), site, AMOUNT),
            ],
        )
        .await;
        if want == "REFUSE" && got == Outcome::Refuse && !key.starts_with("affiliate_") {
            *dead_rows.entry(format!("{key}→{resolved}")).or_default() += 1;
        }
        m.check(
            "auto:meaning",
            &resolved,
            site,
            &format!(
                "{detail} kind={kind} counter={}",
                counter.as_deref().unwrap_or("-")
            ),
            &want,
            got,
            &message,
            &why,
        );
    }
    for (row, count) in &dead_rows {
        m.note(
            "meaning:dead_rows",
            row,
            "units",
            "map rows the rules forbid from posting",
            &format!("{count} map rows resolve to an account the rules refuse at that site"),
        );
    }

    // ── 7. The affiliate convention through the balancer ────────────────────
    let units: Vec<String> =
        sqlx::query_scalar("SELECT id FROM unit WHERE kind <> 'HO' ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap_or_else(|error| panic!("units: {error}"));
    for unit in &units {
        for (family, kind, piutang, hutang) in FAMILIES {
            for (debit_site, credit_site) in [(unit.as_str(), HO), (HO, unit.as_str())] {
                let (got, message, entry) = try_post(
                    &pool,
                    kind,
                    vec![
                        PostingLine::debit(code("8008"), debit_site, AMOUNT),
                        PostingLine::credit(code("8008"), credit_site, AMOUNT),
                    ],
                )
                .await;
                let detail = format!("{family} Dr@{debit_site} Cr@{credit_site}");
                m.check(
                    "affiliate:balancer",
                    "8008",
                    unit,
                    &detail,
                    "ALLOW",
                    got,
                    &message,
                    "I3/I7",
                );
                let Some(entry) = entry else { continue };
                let legs: Vec<(String, String, Option<String>)> = sqlx::query_as(
                    "SELECT unit_id, account_code, counter_unit_id FROM journal_line
                      WHERE entry_id = $1 AND account_code <> '8008' ORDER BY line_number",
                )
                .bind(entry)
                .fetch_all(&pool)
                .await
                .unwrap_or_else(|error| panic!("legs: {error}"));
                let right = legs.len() == 2
                    && legs.iter().all(|(site, account, counter)| {
                        if site == HO {
                            account == piutang && counter.as_deref() == Some(unit.as_str())
                        } else {
                            site == unit && account == hutang && counter.as_deref() == Some(HO)
                        }
                    });
                m.assert(
                    "affiliate:balancer",
                    if debit_site == HO { piutang } else { hutang },
                    unit,
                    &detail,
                    right,
                    &format!("unit {hutang} counter head office, HO {piutang} counter {unit}; got {legs:?}"),
                );
            }
        }
    }
    // Unit to unit through the balancer: two pairs, each HO ↔ unit.
    for (family, kind, _, _) in FAMILIES {
        let (got, message, entry) = try_post(
            &pool,
            kind,
            vec![
                PostingLine::debit(code("8008"), "store-02", AMOUNT),
                PostingLine::credit(code("8008"), UNIT, AMOUNT),
            ],
        )
        .await;
        m.check(
            "affiliate:unit_to_unit_via_ho",
            "8008",
            UNIT,
            family,
            "ALLOW",
            got,
            &message,
            "I8",
        );
        if let Some(entry) = entry {
            let bad: i64 = sqlx::query_scalar(
                "SELECT COUNT(*)::bigint FROM journal_line
                  WHERE entry_id = $1 AND account_code <> '8008'
                    AND (counter_unit_id IS NULL
                         OR (unit_id <> head_office_unit_id()
                             AND counter_unit_id <> head_office_unit_id())
                         OR (unit_id = head_office_unit_id()
                             AND counter_unit_id = head_office_unit_id()))",
            )
            .bind(entry)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("unit to unit: {error}"));
            m.assert(
                "affiliate:unit_to_unit_via_ho",
                "*",
                UNIT,
                family,
                bad == 0,
                &format!("{bad} affiliate legs are not HO ↔ unit"),
            );
        }
    }
    // Unit to unit named directly, by a manual journal and by a rule.
    for hutang in HUTANG {
        let (got, message) = manual_journal(&app, &admin, hutang, UNIT, Some("store-02")).await;
        manual_paths += 1;
        m.check(
            "affiliate:unit_to_unit_direct",
            hutang,
            UNIT,
            "manual counter=store-02",
            "REFUSE",
            got,
            &message,
            "I8 (a unit line's counter is always head office)",
        );
        let (got, message, _) = post_as(
            &pool,
            "PAYMENT",
            vec![
                PostingLine::debit(code(hutang), UNIT, AMOUNT).with_counter_unit("store-02"),
                PostingLine::credit(code("8008"), UNIT, AMOUNT),
            ],
            DIRECT,
        )
        .await;
        m.check(
            "affiliate:unit_to_unit_direct",
            hutang,
            UNIT,
            "auto counter=store-02",
            "REFUSE",
            got,
            &message,
            "I8 (a unit line's counter is always head office)",
        );
    }
    for piutang in PIUTANG {
        let (got, message) = manual_journal(&app, &admin, piutang, HO, Some(HO)).await;
        manual_paths += 1;
        m.check(
            "affiliate:self_counter",
            piutang,
            HO,
            "manual counter=ho",
            "REFUSE",
            got,
            &message,
            "I8 (HO ↔ unit only; an HO line's counter is a unit)",
        );
    }
    // Every affiliate meaning, at every site: unit → hutang, HO → piutang.
    let wrong_map: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT r.role, r.unit_id, r.source_id, r.account_code
           FROM account_resolution r JOIN unit u ON u.id = r.unit_id
          WHERE r.role IN ('affiliate_payable', 'affiliate_receivable')
            AND ((u.kind <> 'HO' AND r.account_code NOT IN ('2028', '2029', '2030'))
              OR (u.kind = 'HO' AND r.account_code NOT IN ('1057', '1058', '1059')))",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("affiliate map: {error}"));
    m.assert(
        "affiliate:map_direction",
        "1057-1059/2028-2030",
        "*",
        "affiliate_payable/receivable",
        wrong_map.is_empty(),
        &format!("affiliate meanings on the wrong side: {wrong_map:?}"),
    );
    // And nothing automatic landed on the wrong side, whatever the path.
    let wrong_side: Vec<(String, String, String, i64)> = sqlx::query_as(
        "SELECT e.source_kind, l.unit_id, l.account_code, COUNT(*)::bigint
           FROM journal_line l JOIN journal_entry e USING (entry_id)
          WHERE e.source_kind <> 'MANUAL' AND e.rule_version <> $1
            AND ((l.unit_id <> head_office_unit_id()
                  AND l.account_code IN ('1057', '1058', '1059'))
              OR (l.unit_id = head_office_unit_id()
                  AND l.account_code IN ('2028', '2029', '2030')))
          GROUP BY 1, 2, 3 ORDER BY 1, 2, 3",
    )
    .bind(DIRECT)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("wrong side: {error}"));
    m.assert(
        "affiliate:ledger_direction",
        "1057-1059/2028-2030",
        "*",
        "every automatic line posted by this test",
        wrong_side.is_empty(),
        &format!("unit line on piutang or HO line on hutang: {wrong_side:?}"),
    );

    let written = m.write();
    let summary = format!(
        "posting matrix: {accounts_tested} accounts, {manual_paths} manual paths, \
         {meanings_tested} map rows; {} pass, {} mismatch, {} unspecified — {}",
        m.passes,
        m.mismatches.len(),
        m.unspecified,
        written.display()
    );
    println!("{summary}");
    assert!(
        m.mismatches.is_empty(),
        "{summary}\n{} mismatches:\n{}",
        m.mismatches.len(),
        m.mismatches.join("\n")
    );
}
