//! The other half of the pairing code's conversation: a shopper asks to turn
//! points into a voucher, and a cashier's confirm is what a request becomes.
//!
//! Driven over HTTP, the same reasoning `member_identity.rs` gives for doing
//! the same: everything this feature promises is a promise about
//! *credentials and locks* — which session can ask, which machine can
//! confirm, how many guesses a code survives, whether two live requests can
//! ever coexist — and none of it is visible from a function signature.
//!
//! The properties held down here, roughly in the order they would hurt if
//! they broke:
//!
//! 1. **A shopper can ask, and a till can turn that into a voucher**, at the
//!    fixed 1-point-to-Rp-1 rate — nowhere else in the request decides it.
//! 2. **At most one live request per member.** A cashier reading a member's
//!    current ask must never have to choose between two.
//! 3. **A request cannot be confirmed for more than the balance can pay, and
//!    a retried confirm is answered from what was already written rather than
//!    spending twice.**
//! 4. **A code is worth five guesses**, exactly like a pairing code.
//! 5. **Only a registered shop node's own key can look up or confirm** — a
//!    person is never the caller here, a node proving which shop it is is.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{
    application::{AppConfig, AppState, CreateUserRequest},
    domain::Role,
    http as cloud_http, postgres as cloud,
};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const CARD: &str = "M-777001";
const CASHIER: &str = "kasir.tukar";
const CASHIER_PASSWORD: &str = "kasir-password-1";
const ORIGIN_ID: &str = "store-09-edge";
const ORIGIN_KEY: &str = "store-09-integration-sync-key-00000001";

// ── the harness — trimmed from `member_identity.rs` ─────────────────────────

struct Answer {
    status: StatusCode,
    body: Value,
    set_cookies: Vec<String>,
}

async fn send(
    app: axum::Router,
    method: &str,
    path: &str,
    headers: Vec<(&str, String)>,
    body: Option<Value>,
) -> Answer {
    let mut builder = Request::builder().method(method).uri(path);
    for (name, value) in headers {
        builder = builder.header(name, value);
    }
    if body.is_some() {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
    }
    let request = builder
        .body(body.map_or_else(Body::empty, |value| {
            Body::from(serde_json::to_vec(&value).unwrap_or_else(|e| panic!("request json: {e}")))
        }))
        .unwrap_or_else(|e| panic!("request {method} {path}: {e}"));
    let response = app
        .oneshot(request)
        .await
        .unwrap_or_else(|e| panic!("response {method} {path}: {e}"));
    let status = response.status();
    let set_cookies = response
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|value| {
            value
                .to_str()
                .unwrap_or_else(|e| panic!("set-cookie: {e}"))
                .to_owned()
        })
        .collect();
    let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap_or_else(|e| panic!("body {method} {path}: {e}"));
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or_else(|e| {
            panic!(
                "json {method} {path}: {e} — {:?}",
                String::from_utf8_lossy(&bytes)
            )
        })
    };
    Answer {
        status,
        body,
        set_cookies,
    }
}

fn cookie(set_cookies: &[String], name: &str) -> String {
    set_cookies
        .iter()
        .find_map(|line| {
            let pair = line.split(';').next()?;
            let value = pair.strip_prefix(&format!("{name}="))?;
            Some(format!("{name}={value}"))
        })
        .unwrap_or_else(|| panic!("no {name} cookie in {set_cookies:?}"))
}

fn value_of(pair: &str) -> String {
    pair.split_once('=')
        .map(|(_, value)| value.to_owned())
        .unwrap_or_else(|| panic!("malformed cookie pair {pair}"))
}

struct Phone {
    cookies: String,
    csrf: String,
}

impl Phone {
    fn read(&self) -> Vec<(&str, String)> {
        vec![("cookie", self.cookies.clone())]
    }

    fn write(&self) -> Vec<(&str, String)> {
        vec![
            ("cookie", self.cookies.clone()),
            ("x-csrf-token", self.csrf.clone()),
        ]
    }
}

fn phone_from(set_cookies: &[String]) -> Phone {
    let session = cookie(set_cookies, "member_session");
    let csrf = cookie(set_cookies, "member_csrf");
    let csrf_value = value_of(&csrf);
    Phone {
        cookies: format!("{session}; {csrf}"),
        csrf: csrf_value,
    }
}

struct Counter {
    cookies: String,
    csrf: String,
}

impl Counter {
    fn write(&self) -> Vec<(&str, String)> {
        vec![
            ("cookie", self.cookies.clone()),
            ("x-csrf-token", self.csrf.clone()),
        ]
    }
}

fn config() -> AppConfig {
    AppConfig {
        po_import: inventory_backend::cloud::intake::po::PoImportConfig::from_env(),
        clock: None,
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|e| panic!("bind: {e}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "cloud-redeem-test".into(),
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

/// A cloud router, one cashier signed in, and one shop node registered to
/// relay through `x-sync-key` — everything `redeem_request_lookup`/`confirm`
/// need on the machine side.
async fn shop(pool: &PgPool) -> (axum::Router, Counter) {
    cloud::bootstrap_admin(pool, Some("admin-password-1"), true)
        .await
        .unwrap_or_else(|e| panic!("bootstrap: {e}"));
    cloud::create_user(
        pool,
        CreateUserRequest {
            username: CASHIER.into(),
            display_name: "Kasir Tukar".into(),
            password: CASHIER_PASSWORD.into(),
            role: Role::Cashier.into(),
        },
        "test",
    )
    .await
    .unwrap_or_else(|e| panic!("create cashier: {e}"));
    cloud::register_origin_credential_binding(
        pool,
        ORIGIN_ID,
        ORIGIN_KEY,
        Some(ORIGIN_ID),
        Some("store-09"),
        Some("STORE"),
        Some(1),
        Some(true),
    )
    .await
    .unwrap_or_else(|e| panic!("register origin: {e}"));

    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let login = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        vec![],
        Some(json!({ "username": CASHIER, "password": CASHIER_PASSWORD })),
    )
    .await;
    assert_eq!(
        login.status,
        StatusCode::OK,
        "cashier login: {:?}",
        login.body
    );
    let session = cookie(&login.set_cookies, "inventory_session");
    let csrf = cookie(&login.set_cookies, "inventory_csrf");
    let counter = Counter {
        csrf: value_of(&csrf),
        cookies: format!("{session}; {csrf}"),
    };
    (app, counter)
}

/// Enrol a card, pair it, and hand back the shopper's own cookies — the same
/// three steps `member_identity.rs` drives, folded into one call since every
/// test here needs a paired phone before it can ask for anything.
async fn paired_member(app: &axum::Router, counter: &Counter, card: &str) -> Phone {
    let enrolled = send(
        app.clone(),
        "POST",
        "/api/v1/members",
        counter.write(),
        Some(json!({ "member_id": card })),
    )
    .await;
    assert_eq!(
        enrolled.status,
        StatusCode::OK,
        "enrol: {:?}",
        enrolled.body
    );

    let issued = send(
        app.clone(),
        "POST",
        &format!("/api/v1/members/{card}/pairing-code"),
        counter.write(),
        Some(json!({})),
    )
    .await;
    assert_eq!(
        issued.status,
        StatusCode::OK,
        "issue code: {:?}",
        issued.body
    );
    let code = issued.body["code"]
        .as_str()
        .unwrap_or_else(|| panic!("no code in {:?}", issued.body))
        .to_owned();

    let paired = send(
        app.clone(),
        "POST",
        "/api/v1/member/session",
        vec![],
        Some(json!({ "member_id": card, "code": code })),
    )
    .await;
    assert_eq!(paired.status, StatusCode::OK, "pair: {:?}", paired.body);
    phone_from(&paired.set_cookies)
}

/// Give a member a balance directly, bypassing the sale/earn path entirely —
/// what is under test here is redemption, not earning, and the ledger
/// already has its own coverage in `loyalty.rs`'s unit tests.
async fn seed_balance(pool: &PgPool, member_id: &str, points: i64) {
    sqlx::query("INSERT INTO points_account (customer_id, balance_points) VALUES ($1, $2)")
        .bind(member_id)
        .bind(points)
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("seed points_account: {e}"));
    sqlx::query(
        "INSERT INTO points_ledger (entry_id, customer_id, entry_type, points, actor)
         VALUES (gen_random_uuid(), $1, 'OPENING', $2, 'test-seed')",
    )
    .bind(member_id)
    .bind(points)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("seed points_ledger: {e}"));
}

async fn create_request(app: &axum::Router, phone: &Phone, points: i64) -> Answer {
    send(
        app.clone(),
        "POST",
        "/api/v1/member/points/redeem-requests",
        phone.write(),
        Some(json!({ "points": points })),
    )
    .await
}

fn sync_headers() -> Vec<(&'static str, String)> {
    vec![("x-sync-key", ORIGIN_KEY.to_owned())]
}

async fn lookup(app: &axum::Router, member_id: &str, code: &str) -> Answer {
    send(
        app.clone(),
        "POST",
        "/api/v1/sync/points/redeem-requests/lookup",
        sync_headers(),
        Some(json!({
            "origin_id": ORIGIN_ID,
            "member_id": member_id,
            "code": code,
            "actor_id": CASHIER,
        })),
    )
    .await
}

async fn confirm(app: &axum::Router, request_id: &str) -> Answer {
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/sync/points/redeem-requests/{request_id}/confirm"),
        sync_headers(),
        Some(json!({ "origin_id": ORIGIN_ID, "actor_id": CASHIER })),
    )
    .await
}

// ── the flow ────────────────────────────────────────────────────────────────

/// The whole feature in one test: a shopper asks, a till confirms, and the
/// numbers land where they should on both sides.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_shopper_asks_and_a_till_confirms_a_redemption(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let phone = paired_member(&app, &counter, CARD).await;
    seed_balance(&pool, CARD, 500).await;

    let asked = create_request(&app, &phone, 300).await;
    assert_eq!(
        asked.status,
        StatusCode::OK,
        "create request: {:?}",
        asked.body
    );
    let request_id = asked.body["request_id"]
        .as_str()
        .unwrap_or_else(|| panic!("no request_id in {:?}", asked.body))
        .to_owned();
    let code = asked.body["code"]
        .as_str()
        .unwrap_or_else(|| panic!("no code in {:?}", asked.body))
        .to_owned();
    assert_eq!(code.len(), 6, "the code a shopper reads out is six digits");

    // The shopper's own history already shows it, pending.
    let history = send(
        app.clone(),
        "GET",
        "/api/v1/member/points/redeem-requests",
        phone.read(),
        None,
    )
    .await;
    assert_eq!(history.status, StatusCode::OK);
    assert_eq!(history.body[0]["status"], json!("PENDING"));
    // The code itself is never repeated back on a read — only the response
    // that minted it carries it.
    assert!(history.body[0].get("code").is_none());

    let found = lookup(&app, CARD, &code).await;
    assert_eq!(found.status, StatusCode::OK, "lookup: {:?}", found.body);
    assert_eq!(found.body["points"], json!(300));
    assert_eq!(found.body["request_id"], json!(request_id));

    let confirmed = confirm(&app, &request_id).await;
    assert_eq!(
        confirmed.status,
        StatusCode::OK,
        "confirm: {:?}",
        confirmed.body
    );
    assert_eq!(confirmed.body["points_spent"], json!(300));
    assert_eq!(confirmed.body["voucher_value_minor"], json!(300));
    assert_eq!(confirmed.body["balance_points"], json!(200));
    assert!(
        confirmed.body["voucher_code"].is_string(),
        "no voucher code in {:?}",
        confirmed.body
    );

    let after = send(
        app.clone(),
        "GET",
        "/api/v1/member/points/redeem-requests",
        phone.read(),
        None,
    )
    .await;
    assert_eq!(after.body[0]["status"], json!("CONFIRMED"));
    assert!(after.body[0]["redemption_id"].is_string());
}

/// Two live requests for one member would leave a cashier reading a card
/// choosing between them — refused before it can happen.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_second_live_request_is_refused(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let phone = paired_member(&app, &counter, CARD).await;
    seed_balance(&pool, CARD, 1000).await;

    let first = create_request(&app, &phone, 100).await;
    assert_eq!(first.status, StatusCode::OK, "{:?}", first.body);

    let second = create_request(&app, &phone, 50).await;
    assert_eq!(
        second.status,
        StatusCode::CONFLICT,
        "a member asked twice while the first request was still live: {:?}",
        second.body
    );
}

/// A request for more than the balance holds is refused at the door, before
/// a shopper is ever shown a code to carry to a till.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn insufficient_balance_refuses_the_request(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let phone = paired_member(&app, &counter, CARD).await;
    seed_balance(&pool, CARD, 40).await;

    let asked = create_request(&app, &phone, 41).await;
    assert_eq!(
        asked.status,
        StatusCode::CONFLICT,
        "a request for more points than the balance holds was accepted: {:?}",
        asked.body
    );
}

/// Five guesses against six digits, then the request is unreachable by code
/// even though it has not expired by the clock — the same rule a pairing
/// code holds.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn five_wrong_guesses_lock_the_request(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let phone = paired_member(&app, &counter, CARD).await;
    seed_balance(&pool, CARD, 500).await;

    let asked = create_request(&app, &phone, 100).await;
    let good = asked.body["code"].as_str().unwrap_or_default().to_owned();
    let bad = {
        let mut digits: Vec<u8> = good.bytes().collect();
        digits[0] = if digits[0] == b'9' {
            b'0'
        } else {
            digits[0] + 1
        };
        String::from_utf8(digits).unwrap_or_else(|e| panic!("wrong code: {e}"))
    };

    for attempt in 1..=5 {
        let answer = lookup(&app, CARD, &bad).await;
        assert_eq!(
            answer.status,
            StatusCode::UNAUTHORIZED,
            "guess {attempt} should be refused"
        );
    }

    let with_the_right_code = lookup(&app, CARD, &good).await;
    assert_eq!(
        with_the_right_code.status,
        StatusCode::UNAUTHORIZED,
        "the right code still worked after five wrong ones, so the counter is \
         a suggestion: {:?}",
        with_the_right_code.body
    );
}

/// A retried confirm — the shop's line dropping between the tap and the till
/// hearing back — must answer with the voucher already issued, not spend the
/// points a second time.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_retried_confirm_replays_rather_than_spending_twice(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let phone = paired_member(&app, &counter, CARD).await;
    seed_balance(&pool, CARD, 500).await;

    let asked = create_request(&app, &phone, 300).await;
    let request_id = asked.body["request_id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();

    let first = confirm(&app, &request_id).await;
    assert_eq!(first.status, StatusCode::OK, "{:?}", first.body);
    let second = confirm(&app, &request_id).await;
    assert_eq!(second.status, StatusCode::OK, "{:?}", second.body);

    assert_eq!(
        first.body["voucher_id"], second.body["voucher_id"],
        "a retried confirm minted a second voucher"
    );
    assert_eq!(second.body["replayed"], json!(true));

    let balance: i64 =
        sqlx::query_scalar("SELECT balance_points FROM points_account WHERE customer_id = $1")
            .bind(CARD)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("balance: {e}"));
    assert_eq!(balance, 200, "the points were debited twice");
}

/// Only a node holding its own registered key can look up or confirm — a
/// wrong or missing key is refused, exactly like the voucher relay.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn only_the_registered_origins_own_key_may_relay(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let phone = paired_member(&app, &counter, CARD).await;
    seed_balance(&pool, CARD, 500).await;
    let asked = create_request(&app, &phone, 100).await;
    let code = asked.body["code"].as_str().unwrap_or_default().to_owned();

    let no_key = send(
        app.clone(),
        "POST",
        "/api/v1/sync/points/redeem-requests/lookup",
        vec![],
        Some(json!({
            "origin_id": ORIGIN_ID,
            "member_id": CARD,
            "code": code,
            "actor_id": CASHIER,
        })),
    )
    .await;
    assert_eq!(no_key.status, StatusCode::FORBIDDEN, "{:?}", no_key.body);

    let wrong_key = send(
        app.clone(),
        "POST",
        "/api/v1/sync/points/redeem-requests/lookup",
        vec![("x-sync-key", "not-the-registered-key".to_owned())],
        Some(json!({
            "origin_id": ORIGIN_ID,
            "member_id": CARD,
            "code": code,
            "actor_id": CASHIER,
        })),
    )
    .await;
    assert_eq!(
        wrong_key.status,
        StatusCode::FORBIDDEN,
        "{:?}",
        wrong_key.body
    );
}
