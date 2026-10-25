//! A cashier asks to spend a member's points (owner, 25 Oct 2026: the cashier
//! says how many), and the shopper's yes — the code WhatsApp brought them,
//! read back at the till, or Approve in the member app — is what turns the ask
//! into a voucher.
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
//! 1. **A till can ask, and the shopper's code turns that into a voucher**,
//!    at the fixed 1-point-to-Rp-1 rate — nowhere else in the request decides
//!    it. **Or the shopper approves it in the app**, and the till waiting on
//!    it finds the voucher.
//! 2. **At most one live request per member.** Asking again replaces the one
//!    before, so a cashier reading a member's current ask never chooses
//!    between two.
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
        assistant_vertex: false,
        assistant_price_per_mtok: None,
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

/// The six digits the shopper "reads back". The real code went to WhatsApp
/// and is stored only as a hash, so a test sets the hash to one it knows.
const SHOPPERS_CODE: &str = "424242";

/// The till asks to spend `points` of the member's, and the test plays the
/// shopper's WhatsApp: the answer carries the code they would read back.
async fn create_request(app: &axum::Router, pool: &PgPool, points: i64) -> Answer {
    let mut asked = send(
        app.clone(),
        "POST",
        "/api/v1/sync/points/redeem-requests",
        sync_headers(),
        Some(json!({
            "origin_id": ORIGIN_ID,
            "actor_id": CASHIER,
            "member_id": CARD,
            "points": points,
        })),
    )
    .await;
    if asked.status == StatusCode::OK {
        assert!(
            asked.body.get("code").is_none(),
            "the till was told the shopper's code: {:?}",
            asked.body
        );
        let request_id = asked.body["request_id"].as_str().unwrap_or_default().to_owned();
        sqlx::query("UPDATE member_redeem_request SET code_sha256 = $2 WHERE request_id::text = $1")
            .bind(&request_id)
            .bind(inventory_backend::security::sha256_hex(SHOPPERS_CODE))
            .execute(pool)
            .await
            .unwrap_or_else(|e| panic!("set the shopper's code: {e}"));
        asked.body["code"] = json!(SHOPPERS_CODE);
    }
    asked
}

async fn progress(app: &axum::Router, request_id: &str) -> Answer {
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/sync/points/redeem-requests/{request_id}/progress"),
        sync_headers(),
        Some(json!({ "origin_id": ORIGIN_ID, "actor_id": CASHIER })),
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

/// The whole feature in one test: a till asks, the shopper's code confirms
/// it, and the numbers land where they should on both sides.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_till_asks_and_the_shoppers_code_confirms_a_redemption(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let phone = paired_member(&app, &counter, CARD).await;
    seed_balance(&pool, CARD, 500).await;

    let asked = create_request(&app, &pool, 300).await;
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
    // The code is never on a read: it went to the shopper's WhatsApp.
    assert!(history.body[0].get("code").is_none());
    assert_eq!(history.body[0]["asked_by"], json!(CASHIER));
    assert_eq!(history.body[0]["value_minor"], json!(300));

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

/// Asking again replaces the live request — the shopper changed their mind
/// about how much, or the message never came — so there is never a second
/// live one for a cashier to choose between.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn asking_again_replaces_the_live_request(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let phone = paired_member(&app, &counter, CARD).await;
    seed_balance(&pool, CARD, 1000).await;

    let first = create_request(&app, &pool, 100).await;
    assert_eq!(first.status, StatusCode::OK, "{:?}", first.body);
    let second = create_request(&app, &pool, 50).await;
    assert_eq!(second.status, StatusCode::OK, "{:?}", second.body);

    let history = send(
        app.clone(),
        "GET",
        "/api/v1/member/points/redeem-requests",
        phone.read(),
        None,
    )
    .await;
    assert_eq!(history.body[0]["points"], json!(50));
    assert_eq!(history.body[0]["status"], json!("PENDING"));
    assert_eq!(history.body[1]["status"], json!("CANCELLED"));
}

/// The shopper's other way to say yes: Approve in the member app. The points
/// are spent at once and the till that is waiting finds the voucher.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_shopper_approves_in_the_app_and_the_till_finds_the_voucher(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let phone = paired_member(&app, &counter, CARD).await;
    seed_balance(&pool, CARD, 500).await;

    let asked = create_request(&app, &pool, 200).await;
    assert_eq!(asked.status, StatusCode::OK, "{:?}", asked.body);
    let request_id = asked.body["request_id"].as_str().unwrap_or_default().to_owned();

    let waiting = progress(&app, &request_id).await;
    assert_eq!(waiting.status, StatusCode::OK, "{:?}", waiting.body);
    assert_eq!(waiting.body["request"]["status"], json!("PENDING"));
    assert!(waiting.body["voucher"].is_null());

    let approved = send(
        app.clone(),
        "POST",
        &format!("/api/v1/member/points/redeem-requests/{request_id}/approve"),
        phone.write(),
        Some(json!({})),
    )
    .await;
    assert_eq!(approved.status, StatusCode::OK, "approve: {:?}", approved.body);
    assert_eq!(approved.body["status"], json!("CONFIRMED"));
    assert_eq!(approved.body["approved_in_app"], json!(true));

    let found = progress(&app, &request_id).await;
    assert_eq!(found.status, StatusCode::OK, "{:?}", found.body);
    assert_eq!(found.body["request"]["status"], json!("CONFIRMED"));
    assert_eq!(found.body["voucher"]["points_spent"], json!(200));
    assert!(found.body["voucher"]["voucher_code"].is_string(), "{:?}", found.body);
    // Asked twice, still one voucher and one debit.
    let again = progress(&app, &request_id).await;
    assert_eq!(found.body["voucher"]["voucher_id"], again.body["voucher"]["voucher_id"]);
    let balance: i64 =
        sqlx::query_scalar("SELECT balance_points FROM points_account WHERE customer_id = $1")
            .bind(CARD)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("balance: {e}"));
    assert_eq!(balance, 300);
}

/// Declined in the app, the till hears so and nothing is spent; taken back
/// at the till, the code no longer works.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_declined_or_withdrawn_ask_spends_nothing(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let phone = paired_member(&app, &counter, CARD).await;
    seed_balance(&pool, CARD, 500).await;

    let asked = create_request(&app, &pool, 100).await;
    let request_id = asked.body["request_id"].as_str().unwrap_or_default().to_owned();
    let declined = send(
        app.clone(),
        "POST",
        &format!("/api/v1/member/points/redeem-requests/{request_id}/decline"),
        phone.write(),
        Some(json!({})),
    )
    .await;
    assert_eq!(declined.status, StatusCode::OK, "{:?}", declined.body);
    let heard = progress(&app, &request_id).await;
    assert_eq!(heard.body["request"]["status"], json!("CANCELLED"));

    let asked = create_request(&app, &pool, 100).await;
    let request_id = asked.body["request_id"].as_str().unwrap_or_default().to_owned();
    let withdrawn = send(
        app.clone(),
        "POST",
        &format!("/api/v1/sync/points/redeem-requests/{request_id}/cancel"),
        sync_headers(),
        Some(json!({ "origin_id": ORIGIN_ID, "actor_id": CASHIER })),
    )
    .await;
    assert_eq!(withdrawn.status, StatusCode::OK, "{:?}", withdrawn.body);
    let too_late = lookup(&app, CARD, SHOPPERS_CODE).await;
    assert_eq!(too_late.status, StatusCode::UNAUTHORIZED, "{:?}", too_late.body);

    let balance: i64 =
        sqlx::query_scalar("SELECT balance_points FROM points_account WHERE customer_id = $1")
            .bind(CARD)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("balance: {e}"));
    assert_eq!(balance, 500);
}

/// A request for more than the balance holds is refused at the door, before
/// a shopper is ever sent a code.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn insufficient_balance_refuses_the_request(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let _phone = paired_member(&app, &counter, CARD).await;
    seed_balance(&pool, CARD, 40).await;

    let asked = create_request(&app, &pool, 41).await;
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
    let _phone = paired_member(&app, &counter, CARD).await;
    seed_balance(&pool, CARD, 500).await;

    let asked = create_request(&app, &pool, 100).await;
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
    let _phone = paired_member(&app, &counter, CARD).await;
    seed_balance(&pool, CARD, 500).await;

    let asked = create_request(&app, &pool, 300).await;
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
    let _phone = paired_member(&app, &counter, CARD).await;
    seed_balance(&pool, CARD, 500).await;
    let asked = create_request(&app, &pool, 100).await;
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

/// The direct staff endpoint follows the same loyalty scheme as confirmation:
/// a caller cannot turn one point into an arbitrary amount of voucher money.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn direct_redemption_cannot_choose_its_own_exchange_rate(pool: PgPool) {
    let (app, _) = shop(&pool).await;
    const OPERATOR: &str = "points.supervisor";
    const PASSWORD: &str = "points-supervisor-password-1";
    cloud::create_user(
        &pool,
        CreateUserRequest {
            username: OPERATOR.into(),
            display_name: "Points Supervisor".into(),
            password: PASSWORD.into(),
            role: Role::Supervisor.into(),
        },
        "test",
    )
    .await
    .unwrap_or_else(|error| panic!("create supervisor: {error}"));
    let login = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        vec![],
        Some(json!({"username": OPERATOR, "password": PASSWORD})),
    )
    .await;
    assert_eq!(login.status, StatusCode::OK, "login: {:?}", login.body);
    let session = cookie(&login.set_cookies, "inventory_session");
    let csrf = cookie(&login.set_cookies, "inventory_csrf");
    let operator = Counter {
        csrf: value_of(&csrf),
        cookies: format!("{session}; {csrf}"),
    };
    cloud::enrol_member(&pool, "M-RATE", None)
        .await
        .unwrap_or_else(|error| panic!("enrol: {error}"));
    seed_balance(&pool, "M-RATE", 100).await;
    let path = "/api/v1/customers/M-RATE/points/redeem";
    let body = |points, value, key: &str| {
        json!({
            "points": points, "voucher_value_minor": value,
            "actor_id": OPERATOR, "idempotency_key": key,
        })
    };
    let denied = send(
        app.clone(),
        "POST",
        path,
        operator.write(),
        Some(body(1, 100_000_000, "rate-forged")),
    )
    .await;
    assert_eq!(
        denied.status,
        StatusCode::BAD_REQUEST,
        "forged rate: {:?}",
        denied.body
    );
    let balance: i64 = sqlx::query_scalar(
        "SELECT balance_points FROM points_account WHERE customer_id = 'M-RATE'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("balance: {error}"));
    assert_eq!(balance, 100, "a rejected rate must not debit points");
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM loyalty_redemption WHERE customer_id = 'M-RATE'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("redemptions: {error}"));
    assert_eq!(count, 0);
    let accepted = send(
        app.clone(),
        "POST",
        path,
        operator.write(),
        Some(body(30, 30, "rate-valid")),
    )
    .await;
    assert_eq!(
        accepted.status,
        StatusCode::OK,
        "valid rate: {:?}",
        accepted.body
    );
    assert_eq!(accepted.body["voucher_value_minor"], json!(30));
    assert_eq!(accepted.body["balance_points"], json!(70));
    let issued_value: i64 = sqlx::query_scalar(
        "SELECT v.issued_minor FROM voucher v JOIN loyalty_redemption r
           ON r.voucher_id = v.voucher_id
          WHERE r.customer_id = 'M-RATE' AND r.idempotency_key = 'rate-valid'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("issued value: {error}"));
    assert_eq!(
        issued_value, 30,
        "the stored voucher follows the server rate"
    );
    let replay = send(
        app.clone(),
        "POST",
        path,
        operator.write(),
        Some(body(30, 30, "rate-valid")),
    )
    .await;
    assert_eq!(replay.status, StatusCode::OK, "replay: {:?}", replay.body);
    assert_eq!(replay.body["voucher_id"], accepted.body["voucher_id"]);
    assert_eq!(replay.body["replayed"], json!(true));
    assert_eq!(replay.body["balance_points"], json!(70));
    let changed = send(
        app,
        "POST",
        path,
        operator.write(),
        Some(body(31, 31, "rate-valid")),
    )
    .await;
    assert_eq!(
        changed.status,
        StatusCode::CONFLICT,
        "changed retry: {:?}",
        changed.body
    );
    let from_ledger: i64 = sqlx::query_scalar(
        "SELECT SUM(points)::bigint FROM points_ledger WHERE customer_id = 'M-RATE'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("ledger: {error}"));
    assert_eq!(from_ledger, 70);
}

/// Recorded conversions from before the new rate guard still replay exactly;
/// replaying history never issues a second voucher or debits points again.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn historical_redemption_replays_its_recorded_value_without_new_issuance(pool: PgPool) {
    use cloud::{IssueVoucherRequest, RedeemPointsRequest};
    cloud::enrol_member(&pool, "M-HISTORY", None)
        .await
        .unwrap_or_else(|error| panic!("enrol: {error}"));
    seed_balance(&pool, "M-HISTORY", 100).await;
    let card = cloud::issue_voucher(
        &pool,
        IssueVoucherRequest {
            code: Some("LEGACY-RATE".into()),
            kind: "GOODWILL".into(),
            currency: Some("IDR".into()),
            value_minor: 5_000,
            member_id: Some("M-HISTORY".into()),
            expires_at: None,
            site_id: None,
            note: Some("Historical conversion".into()),
        },
        "test",
        "historical-voucher",
        "historical-voucher-digest",
    )
    .await
    .unwrap_or_else(|error| panic!("legacy voucher: {error}"));
    let redemption_id = uuid::Uuid::new_v4();
    sqlx::query("INSERT INTO loyalty_redemption (redemption_id, customer_id, points_spent, voucher_value_minor, voucher_id, idempotency_key, actor)
        VALUES ($1, 'M-HISTORY', 50, 5000, $2, 'historical-key', 'test')")
        .bind(redemption_id).bind(card.voucher_id).execute(&pool).await
        .unwrap_or_else(|error| panic!("historical redemption: {error}"));
    // The member earned 100, spent 50 under the old scheme and has 50 left.
    sqlx::query("INSERT INTO points_ledger (entry_id, customer_id, entry_type, points, redemption_id, actor)
        VALUES (gen_random_uuid(), 'M-HISTORY', 'REDEEM_TO_VOUCHER', -50, $1, 'test')")
        .bind(redemption_id).execute(&pool).await
        .unwrap_or_else(|error| panic!("historical debit: {error}"));
    sqlx::query("UPDATE points_account SET balance_points = 50 WHERE customer_id = 'M-HISTORY'")
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("historical balance: {error}"));
    let request = || RedeemPointsRequest {
        customer_id: "M-HISTORY".into(),
        points: 50,
        voucher_value_minor: 5_000,
        actor_id: "test".into(),
        idempotency_key: "historical-key".into(),
        expires_at: None,
    };
    let replay = cloud::redeem_points_to_voucher(&pool, request())
        .await
        .unwrap_or_else(|error| panic!("historical replay: {error}"));
    assert_eq!(replay["voucher_id"], json!(card.voucher_id));
    assert_eq!(replay["voucher_value_minor"], json!(5_000));
    assert_eq!(replay["balance_points"], json!(50));
    assert_eq!(replay["replayed"], json!(true));
    let mut changed = request();
    changed.voucher_value_minor = 50;
    assert!(cloud::redeem_points_to_voucher(&pool, changed)
        .await
        .is_err());
    let issued: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM voucher WHERE member_id = 'M-HISTORY'")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("voucher count: {error}"));
    assert_eq!(issued, 1);
    let debits: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM points_ledger WHERE customer_id = 'M-HISTORY' AND entry_type = 'REDEEM_TO_VOUCHER'")
        .fetch_one(&pool).await.unwrap_or_else(|error| panic!("debits: {error}"));
    assert_eq!(debits, 1);
}
