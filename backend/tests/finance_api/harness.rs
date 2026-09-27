//! The shared rig: a router with authentication on, the people who use it,
//! and a reader for the books that goes through Finance's own endpoints.

#![allow(dead_code)]

use axum::body::{to_bytes, Body};
use chrono::{Datelike, NaiveDate, Utc};
use http::{Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Once;
use tower::ServiceExt;
use uuid::Uuid;

pub const HO: &str = "dc";
pub const STORE: &str = "store-01";
pub const STORE_B: &str = "store-02";
pub const PASSWORD: &str = "Rahasia-Finance-2026!";

/// Who does what. Roles ride the three-rung ladder the router knows: Finance
/// head office is ADMIN; a shop manager, HR, Inventory and GA are SUPERVISOR
/// (the store ones posted to their shop); a till is CASHIER.
pub const FINANCE: &str = "finance.ho";
pub const KEPALA_TOKO: &str = "kepala.toko";
pub const HR: &str = "hr.toko";
pub const INVENTORY: &str = "inventory";
pub const GA: &str = "ga.officer";
pub const KASIR: &str = "kasir.toko";

/// Accounts the owner retired (brief §1 and §0.3). Nothing may land on them;
/// 2013 and 1048 join them while PPN is ignored (`vat_enabled = 0`).
pub const NOT_USED: [&str; 5] = ["2003", "4009", "4010", "1110", "2032"];
pub const VAT_ACCOUNTS: [&str; 2] = ["2013", "1048"];
pub const AFFILIATE: [&str; 6] = ["1057", "1058", "1059", "2028", "2029", "2030"];

static TRACING: Once = Once::new();

fn config() -> AppConfig {
    AppConfig {
        po_import: inventory_backend::cloud::intake::po::PoImportConfig::from_env(),
        clock: None,
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|e| panic!("socket address: {e}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "cloud".into(),
        node_role: "CLOUD".into(),
        rfid_burst_window_seconds: 10,
        observed_window_hours: 24,
        lost_risk_window_days: 30,
        enable_test_controls: false,
        finance_automation_enabled: true,
        frontend_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend"),
        sync_upload_url: None,
        sync_upload_key: None,
        sync_ingest_key: None,
        sync_generation: 1,
        sync_enqueue_enabled: false,
        sync_interval_seconds: 5,
        sync_batch_limit: 100,
        sync_breaker_threshold: 3,
        sync_breaker_base_cooldown_seconds: 30,
        sync_breaker_max_cooldown_seconds: 900,
        sync_retention_days: 14,
        sync_degraded_after_seconds: 900,
        sync_apply_enabled: false,
        jwt_secret: Some("finance-api-tests".into()),
        auth_token_ttl_minutes: 600,
        auth_session_idle_minutes: 600,
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

/// The answer to one request.
#[derive(Debug)]
pub struct Reply {
    pub status: StatusCode,
    pub body: Value,
}

impl Reply {
    pub fn ok(self, what: &str) -> Value {
        assert!(
            self.status.is_success(),
            "{what}: {} {}",
            self.status,
            self.body
        );
        self.body
    }

    pub fn refused(&self) -> bool {
        self.status.is_client_error()
    }

    pub fn text(&self) -> String {
        self.body.to_string()
    }
}

pub struct Api {
    pub state: AppState,
    pub pool: PgPool,
    tokens: HashMap<String, String>,
    sync_keys: std::sync::Mutex<HashMap<String, (String, i64)>>,
}

pub fn today() -> NaiveDate {
    Utc::now().date_naive()
}

pub fn month_start() -> NaiveDate {
    let t = today();
    NaiveDate::from_ymd_opt(t.year(), t.month(), 1).unwrap_or(t)
}

pub fn month_end() -> NaiveDate {
    let t = today();
    let (y, m) = if t.month() == 12 { (t.year() + 1, 1) } else { (t.year(), t.month() + 1) };
    NaiveDate::from_ymd_opt(y, m, 1)
        .and_then(|d| d.pred_opt())
        .unwrap_or(t)
}

impl Api {
    /// A fresh estate: the migration chain, an administrator, the six people
    /// the scenarios need, and this month (and the next) open for posting.
    pub async fn new(pool: PgPool) -> Api {
        TRACING.call_once(|| {
            let _ = tracing_subscriber::fmt()
                .with_env_filter(
                    std::env::var("RUST_LOG").unwrap_or_else(|_| "error".to_string()),
                )
                .with_test_writer()
                .try_init();
        });
        cloud::bootstrap_admin(&pool, Some(PASSWORD), true)
            .await
            .unwrap_or_else(|e| panic!("bootstrap admin: {e}"));
        let mut api = Api {
            state: AppState::new(pool.clone(), config()),
            pool,
            tokens: HashMap::new(),
            sync_keys: std::sync::Mutex::new(HashMap::new()),
        };
        let admin = api.login("admin").await;
        api.tokens.insert("admin".into(), admin);
        for (user, role) in [
            (FINANCE, "ADMIN"),
            (KEPALA_TOKO, "SUPERVISOR"),
            (HR, "SUPERVISOR"),
            (INVENTORY, "SUPERVISOR"),
            (GA, "SUPERVISOR"),
            (KASIR, "CASHIER"),
        ] {
            api.call(
                "admin",
                "POST",
                "/api/v1/auth/users",
                Some(json!({
                    "username": user,
                    "display_name": user,
                    "password": PASSWORD,
                    "role": role,
                })),
            )
            .await
            .ok(&format!("create user {user}"));
            let token = api.login(user).await;
            api.tokens.insert(user.into(), token);
        }
        for date in [month_start(), month_end().succ_opt().unwrap_or(month_end())] {
            let reply = api
                .call(
                    FINANCE,
                    "POST",
                    "/api/v1/finance/periods",
                    Some(json!({ "year": date.year(), "month": date.month() })),
                )
                .await;
            assert!(
                reply.status.is_success() || reply.status == StatusCode::CONFLICT,
                "open period: {reply:?}"
            );
        }
        api
    }

    async fn login(&self, user: &str) -> String {
        let reply = self
            .raw(
                None,
                "POST",
                "/api/v1/auth/login",
                Some(json!({ "username": user, "password": PASSWORD })),
                &[],
            )
            .await;
        reply.body["token"]
            .as_str()
            .unwrap_or_else(|| panic!("login {user}: {reply:?}"))
            .to_string()
    }

    pub fn router(&self) -> axum::Router {
        cloud_http::router(self.state.clone())
    }

    async fn raw(
        &self,
        token: Option<&str>,
        method: &str,
        uri: &str,
        body: Option<Value>,
        headers: &[(&str, &str)],
    ) -> Reply {
        let mut request = Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", "application/json");
        if method != "GET" {
            request = request.header("idempotency-key", Uuid::new_v4().to_string());
        }
        if let Some(token) = token {
            request = request.header("authorization", format!("Bearer {token}"));
        }
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let request = match body {
            Some(value) => request.body(Body::from(
                serde_json::to_vec(&value).unwrap_or_else(|e| panic!("encode: {e}")),
            )),
            None => request.body(Body::empty()),
        }
        .unwrap_or_else(|e| panic!("build {method} {uri}: {e}"));
        let response = self
            .router()
            .oneshot(request)
            .await
            .unwrap_or_else(|e| panic!("{method} {uri}: {e}"));
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap_or_else(|e| panic!("read {method} {uri}: {e}"));
        let body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes)
                .unwrap_or_else(|_| json!({ "raw": String::from_utf8_lossy(&bytes).to_string() }))
        };
        Reply { status, body }
    }

    /// One request as `who`.
    pub async fn call(&self, who: &str, method: &str, uri: &str, body: Option<Value>) -> Reply {
        let token = self
            .tokens
            .get(who)
            .unwrap_or_else(|| panic!("nobody signed in as {who}"))
            .clone();
        self.raw(Some(&token), method, uri, body, &[]).await
    }

    pub async fn get(&self, who: &str, uri: &str) -> Value {
        self.call(who, "GET", uri, None)
            .await
            .ok(&format!("GET {uri} as {who}"))
    }

    pub async fn post(&self, who: &str, uri: &str, body: Value) -> Value {
        self.call(who, "POST", uri, Some(body))
            .await
            .ok(&format!("POST {uri} as {who}"))
    }

    pub async fn put(&self, who: &str, uri: &str, body: Value) -> Value {
        self.call(who, "PUT", uri, Some(body))
            .await
            .ok(&format!("PUT {uri} as {who}"))
    }

    // ── nodes: a till or a floor app that proves itself with a sync key ─────

    /// Provision a node (a shop's POS, a warehouse floor app). Provisioning is
    /// how a node comes to exist, not a business act — the same step
    /// `api_flow_integration` takes.
    pub async fn node(&self, origin_id: &str, site_id: &str, role: &str) {
        let key = format!("{origin_id}-finance-api-sync-key-0001");
        cloud::register_origin_credential(&self.pool, origin_id, &key, Some(origin_id))
            .await
            .unwrap_or_else(|e| panic!("register {origin_id}: {e}"));
        sqlx::query(
            "UPDATE sync_origin_credential
                SET site_id = $2, node_role = $3, active_generation = 1,
                    inventory_enabled = ($3 = 'DC')
              WHERE origin_id = $1",
        )
        .bind(origin_id)
        .bind(site_id)
        .bind(role)
        .execute(&self.pool)
        .await
        .unwrap_or_else(|e| panic!("bind {origin_id}: {e}"));
        self.sync_keys
            .lock()
            .unwrap_or_else(|e| panic!("lock: {e}"))
            .insert(origin_id.into(), (key, 0));
    }

    /// Facts a node sends up, over `POST /api/v1/sync/ingest`, then the centre's
    /// apply agent. Refusals are returned rather than asserted, because some
    /// scenarios are about a refusal.
    pub async fn ingest(&self, origin_id: &str, facts: Vec<(&str, Value)>) -> Reply {
        let (key, first) = {
            let mut keys = self.sync_keys.lock().unwrap_or_else(|e| panic!("lock: {e}"));
            let slot = keys
                .get_mut(origin_id)
                .unwrap_or_else(|| panic!("node {origin_id} is not provisioned"));
            let first = slot.1 + 1;
            slot.1 += facts.len() as i64;
            (slot.0.clone(), first)
        };
        let batch = json!({
            "origin_id": origin_id,
            "generation": 1,
            "command_watermark": 0,
            "facts": facts.iter().enumerate().map(|(i, (kind, payload))| json!({
                "seq": first + i as i64,
                "event_id": Uuid::new_v4(),
                "event_type": kind,
                "payload": payload,
                "created_at": Utc::now(),
            })).collect::<Vec<_>>(),
        });
        let reply = self
            .raw(
                None,
                "POST",
                "/api/v1/sync/ingest",
                Some(batch),
                &[("x-sync-key", key.as_str())],
            )
            .await;
        if reply.status.is_success() {
            let report = cloud::apply_pending(&self.pool, 1000)
                .await
                .unwrap_or_else(|e| panic!("apply: {e}"));
            assert!(report.blocked.is_empty(), "apply blocked: {:?}", report.blocked);
        }
        reply
    }

    // ── people: an employee record with a login bound to it ────────────────

    /// Register, hire and post somebody to a place, returning the employee id.
    pub async fn employee(&self, code: &str, place_id: &str) -> String {
        let registered = self
            .post("admin", "/api/v1/employees", json!({ "employee_code": code }))
            .await;
        let employee_id = registered["employee_id"]
            .as_str()
            .unwrap_or_else(|| panic!("employee_id: {registered}"))
            .to_owned();
        self.post(
            "admin",
            &format!("/api/v1/employees/{employee_id}/employment"),
            json!({ "transition": "HIRE", "effective_on": "2026-01-05", "reason": "mulai bekerja" }),
        )
        .await;
        self.post(
            "admin",
            &format!("/api/v1/employees/{employee_id}/assignments"),
            json!({ "place_id": place_id, "valid_from": "2026-01-05", "reason": "penempatan awal" }),
        )
        .await;
        employee_id
    }

    /// Post a login to a shop, so its reach is that shop and nothing else.
    pub async fn post_login_to(&self, user: &str, code: &str, place_id: &str) -> String {
        let employee_id = self.employee(code, place_id).await;
        self.post(
            "admin",
            &format!("/api/v1/employees/{employee_id}/account"),
            json!({ "username": user, "reason": "akun untuk staf" }),
        )
        .await;
        employee_id
    }

    // ── Finance setup, through Finance's own screens ───────────────────────

    /// Describe one of our real bank accounts against its ledger leaf.
    pub async fn bank_account(&self, ledger: &str, site: &str, bank: &str, number: &str) -> Value {
        self.post(
            FINANCE,
            "/api/v1/finance/bank-accounts",
            json!({
                "ledger_account_code": ledger,
                "site_id": site,
                "bank_code": bank,
                "bank_name": "",
                "account_no": number,
                "account_holder": "PT Contoh Retail",
                "kind": "GIRO",
                "is_primary": true,
            }),
        )
        .await
    }

    // ── the books, read through Finance ─────────────────────────────────────

    pub async fn books(&self) -> Books {
        let mut entries = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let uri = match &cursor {
                Some(c) => format!("/api/v1/finance/journal?limit=200&cursor={c}"),
                None => "/api/v1/finance/journal?limit=200".to_string(),
            };
            let page = self.get(FINANCE, &uri).await;
            for row in page["rows"].as_array().cloned().unwrap_or_default() {
                entries.push(row);
            }
            match page["next_cursor"].as_str() {
                Some(next) if !next.is_empty() => cursor = Some(next.to_string()),
                _ => break,
            }
        }
        let mut lines = Vec::new();
        for entry in &entries {
            let id = entry["entry_id"].as_str().unwrap_or_default();
            let detail = self.get(FINANCE, &format!("/api/v1/finance/journal/{id}")).await;
            for line in detail["lines"].as_array().cloned().unwrap_or_default() {
                lines.push(Line {
                    entry_id: id.to_string(),
                    entry_number: entry["entry_number"].as_str().unwrap_or_default().into(),
                    source_kind: entry["source_kind"].as_str().unwrap_or_default().into(),
                    source_id: entry["source_id"].as_str().unwrap_or_default().into(),
                    account: line["account_code"].as_str().unwrap_or_default().into(),
                    site: line["site_id"].as_str().unwrap_or_default().into(),
                    counter: line["counter_site_id"].as_str().map(str::to_string),
                    dr: line["debit_minor"].as_i64().unwrap_or(0),
                    cr: line["credit_minor"].as_i64().unwrap_or(0),
                    party: line["party_id"].as_str().map(str::to_string),
                    memo: line["memo"].as_str().unwrap_or_default().into(),
                });
            }
        }
        Books { lines }
    }
}

#[derive(Clone, Debug)]
pub struct Line {
    pub entry_id: String,
    pub entry_number: String,
    pub source_kind: String,
    pub source_id: String,
    pub account: String,
    pub site: String,
    pub counter: Option<String>,
    pub dr: i64,
    pub cr: i64,
    pub party: Option<String>,
    pub memo: String,
}

#[derive(Clone, Debug, Default)]
pub struct Books {
    pub lines: Vec<Line>,
}

impl Books {
    pub fn kind(&self, source_kind: &str) -> Books {
        Books {
            lines: self
                .lines
                .iter()
                .filter(|l| l.source_kind == source_kind)
                .cloned()
                .collect(),
        }
    }

    pub fn entry(&self, entry_id: &str) -> Books {
        Books {
            lines: self
                .lines
                .iter()
                .filter(|l| l.entry_id == entry_id)
                .cloned()
                .collect(),
        }
    }

    pub fn entries(&self) -> BTreeSet<String> {
        self.lines.iter().map(|l| l.entry_id.clone()).collect()
    }

    pub fn dr(&self, account: &str, site: &str) -> i64 {
        self.lines
            .iter()
            .filter(|l| l.account == account && l.site == site)
            .map(|l| l.dr)
            .sum()
    }

    pub fn cr(&self, account: &str, site: &str) -> i64 {
        self.lines
            .iter()
            .filter(|l| l.account == account && l.site == site)
            .map(|l| l.cr)
            .sum()
    }

    /// Debit less credit on one account at one site.
    pub fn net(&self, account: &str, site: &str) -> i64 {
        self.dr(account, site) - self.cr(account, site)
    }

    /// Debit less credit on one account across the company.
    pub fn net_all(&self, account: &str) -> i64 {
        self.lines
            .iter()
            .filter(|l| l.account == account)
            .map(|l| l.dr - l.cr)
            .sum()
    }

    pub fn has(&self, account: &str) -> bool {
        self.lines.iter().any(|l| l.account == account)
    }

    pub fn has_at(&self, account: &str, site: &str) -> bool {
        self.lines.iter().any(|l| l.account == account && l.site == site)
    }

    /// Whether an affiliate line at `site` names `counter` as the other side.
    pub fn affiliate(&self, account: &str, site: &str, counter: &str) -> i64 {
        self.lines
            .iter()
            .filter(|l| l.account == account && l.site == site && l.counter.as_deref() == Some(counter))
            .map(|l| l.dr - l.cr)
            .sum()
    }

    pub fn accounts(&self) -> BTreeSet<String> {
        self.lines.iter().map(|l| l.account.clone()).collect()
    }

    pub fn dump(&self) -> String {
        let mut out = String::new();
        for l in &self.lines {
            out.push_str(&format!(
                "{} {:<14} {:<8} {:<9} {:<9} dr {:>12} cr {:>12}  {}\n",
                l.entry_number,
                l.source_kind,
                l.account,
                l.site,
                l.counter.clone().unwrap_or_default(),
                l.dr,
                l.cr,
                l.memo
            ));
        }
        out
    }

    /// The four structural checks every scenario makes. The fifth — the
    /// right accounts — is each scenario's own.
    pub fn assert_sound(&self, affiliates_settled: bool) {
        let mut per_entry: BTreeMap<&str, (i64, i64)> = BTreeMap::new();
        let mut per_site: BTreeMap<(&str, &str), i64> = BTreeMap::new();
        for l in &self.lines {
            let e = per_entry.entry(&l.entry_id).or_default();
            e.0 += l.dr;
            e.1 += l.cr;
            *per_site.entry((&l.entry_id, &l.site)).or_default() += l.dr - l.cr;
        }
        for (entry, (dr, cr)) in &per_entry {
            assert_eq!(dr, cr, "entry {entry} does not balance\n{}", self.dump());
        }
        for ((entry, site), net) in &per_site {
            assert_eq!(
                *net, 0,
                "entry {entry} leaves {site} out by {net} in its own books\n{}",
                self.dump()
            );
        }
        if affiliates_settled {
            let net: i64 = AFFILIATE.iter().map(|a| self.net_all(a)).sum();
            assert_eq!(net, 0, "affiliate accounts do not net to zero\n{}", self.dump());
        }
        for account in NOT_USED.iter().chain(VAT_ACCOUNTS.iter()) {
            assert!(
                !self.has(account),
                "account {account} is not used, and a line landed on it\n{}",
                self.dump()
            );
        }
        // Every affiliate line names the other unit, and a unit's other side is
        // always head office.
        for l in &self.lines {
            if AFFILIATE.contains(&l.account.as_str()) {
                let counter = l.counter.as_deref().unwrap_or_else(|| {
                    panic!("affiliate line without a counter site: {l:?}\n{}", self.dump())
                });
                if l.site != HO {
                    assert_eq!(counter, HO, "a unit's affiliate is always with HO: {l:?}");
                }
                // Owner, 25 Sep (0380): a unit is always on the hutang side,
                // head office always on the piutang side.
                let hutang = matches!(l.account.as_str(), "2028" | "2029" | "2030");
                assert_eq!(
                    hutang,
                    l.site != HO,
                    "a unit line must be on 2028/2029/2030 and an HO line on 1057/1058/1059: {l:?}\n{}",
                    self.dump()
                );
            }
        }
    }
}

// ── coverage: what each scenario posted, collected for test 40 ─────────────

pub fn coverage_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/finance-api-coverage")
        .join(std::process::id().to_string())
}

/// Record what a scenario posted, by account and source kind.
pub fn record(scenario: &str, books: &Books) {
    let dir = coverage_dir();
    std::fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("coverage dir: {e}"));
    let mut rows: BTreeSet<String> = BTreeSet::new();
    for l in &books.lines {
        rows.insert(format!("{}|{}", l.account, l.source_kind));
    }
    let body: Vec<String> = rows.into_iter().collect();
    std::fs::write(dir.join(format!("{scenario}.txt")), body.join("\n"))
        .unwrap_or_else(|e| panic!("coverage write: {e}"));
}

/// Record a scenario that was refused on purpose (posted nothing, or only the
/// setup), so the coverage test knows it ran.
pub fn record_ran(scenario: &str) {
    record(scenario, &Books::default());
}
