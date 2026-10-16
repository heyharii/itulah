//! The sign-in that opens the shopper's own surface: a card enrolled at a
//! counter, six digits a cashier reads out, and the session that follows.
//!
//! Driven over HTTP rather than at the query layer, unlike
//! `customer_integration.rs`. That is deliberate and it is where the risk
//! actually lives: everything this feature promises is a promise about
//! *credentials* — which cookie authorises what, which failures are
//! distinguishable, how many guesses a code survives — and none of it is
//! visible from a function signature. A pairing flow whose rules are enforced
//! in a middleware nobody routes through is not enforced.
//!
//! The four properties these tests exist to hold down, in the order they would
//! hurt if they broke:
//!
//! 1. **A member session is not an operator session, and the reverse.** The
//!    whole reason this feature was built is that the shopper's app used to
//!    borrow an operator's authority. Two cookies, two middlewares, no bridge.
//! 2. **Every pairing failure answers identically.** Unknown card, no code,
//!    wrong code, expired, spent, blocked — one status and one sentence. A
//!    form that distinguished them is a service for discovering which numbers
//!    are members.
//! 3. **A code is worth one device and five guesses.** Six digits is a million,
//!    which is only a defence if the guessing stops.
//! 4. **Stopping a membership stops the phone already in the pocket**, not
//!    merely the next pairing.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{
    application::{AppConfig, AppState, CreateUserRequest},
    domain::Role,
    http as cloud_http, postgres as cloud,
};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const CARD: &str = "M-000123";
const CASHIER: &str = "kasir.satu";
const CASHIER_PASSWORD: &str = "kasir-password-1";

/// The member's own cookies, named apart from `inventory_*` on purpose: two
/// cookies that could be mistaken for one another is how proof of holding a
/// loyalty card becomes an operator's authority.
const MEMBER_SESSION_COOKIE: &str = "member_session";
const MEMBER_CSRF_COOKIE: &str = "member_csrf";

// ── the harness ─────────────────────────────────────────────────────────────

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

/// What a browser holding a member session sends back.
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
    let session = cookie(set_cookies, MEMBER_SESSION_COOKIE);
    let csrf = cookie(set_cookies, MEMBER_CSRF_COOKIE);
    let csrf_value = value_of(&csrf);
    Phone {
        cookies: format!("{session}; {csrf}"),
        csrf: csrf_value,
    }
}

/// What a browser holding an operator session sends back.
struct Counter {
    cookies: String,
    csrf: String,
}

impl Counter {
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

fn config() -> AppConfig {
    AppConfig {
        po_import: inventory_backend::cloud::intake::po::PoImportConfig::from_env(),
        clock: None,
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|e| panic!("bind: {e}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "cloud-member-test".into(),
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
        // Auth ON. With it off, `require_auth` hands every request a
        // development Admin and the separation these tests are about would be
        // untestable — every assertion below would pass for the wrong reason.
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

/// A cloud router with one cashier on it, signed in.
async fn shop(pool: &PgPool) -> (axum::Router, Counter) {
    cloud::bootstrap_admin(pool, Some("admin-password-1"), true)
        .await
        .unwrap_or_else(|e| panic!("bootstrap: {e}"));
    cloud::create_user(
        pool,
        CreateUserRequest {
            username: CASHIER.into(),
            display_name: "Kasir Satu".into(),
            password: CASHIER_PASSWORD.into(),
            role: Role::Cashier.into(),
        },
        "test",
    )
    .await
    .unwrap_or_else(|e| panic!("create cashier: {e}"));

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
    let session = cookie(&login.set_cookies, security::SESSION_COOKIE);
    let csrf = cookie(&login.set_cookies, security::CSRF_COOKIE);
    let counter = Counter {
        csrf: value_of(&csrf),
        cookies: format!("{session}; {csrf}"),
    };
    (app, counter)
}

/// Enrol a card and issue its code, the way a counter does.
async fn card_and_code(app: &axum::Router, counter: &Counter, card: &str) -> String {
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
        "enrol {card}: {:?}",
        enrolled.body
    );
    issue(app, counter, card).await
}

async fn issue(app: &axum::Router, counter: &Counter, card: &str) -> String {
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
        "issue code for {card}: {:?}",
        issued.body
    );
    issued.body["code"]
        .as_str()
        .unwrap_or_else(|| panic!("no code in {:?}", issued.body))
        .to_owned()
}

async fn pair(app: &axum::Router, card: &str, code: &str) -> Answer {
    send(
        app.clone(),
        "POST",
        "/api/v1/member/session",
        vec![],
        Some(json!({ "member_id": card, "code": code })),
    )
    .await
}

// ── the flow ────────────────────────────────────────────────────────────────

/// The whole feature in one test: a card enrolled at a counter, six digits read
/// out, and a phone that can then read its own points and nothing else.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_cashier_enrols_a_card_and_the_phone_pairs_with_the_code(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let code = card_and_code(&app, &counter, CARD).await;
    assert_eq!(code.len(), 6, "the code a cashier reads out is six digits");
    assert!(
        code.bytes().all(|b| b.is_ascii_digit()),
        "digits, because they are read aloud: {code}"
    );

    let paired = pair(&app, CARD, &code).await;
    assert_eq!(paired.status, StatusCode::OK, "pair: {:?}", paired.body);
    assert_eq!(paired.body["member"]["member_id"], json!(CARD));
    assert!(
        paired.body.get("token").is_none(),
        "the session token must not be in the body — it is a cookie, or it is \
         something a phone will decide to keep: {:?}",
        paired.body
    );

    let phone = phone_from(&paired.set_cookies);
    let me = send(app.clone(), "GET", "/api/v1/member/me", phone.read(), None).await;
    assert_eq!(me.status, StatusCode::OK, "me: {:?}", me.body);
    assert_eq!(me.body["member_id"], json!(CARD));

    let summary = send(
        app.clone(),
        "GET",
        "/api/v1/member/summary",
        phone.read(),
        None,
    )
    .await;
    assert_eq!(
        summary.status,
        StatusCode::OK,
        "summary: {:?}",
        summary.body
    );

    // Who issued it is the only defence this scheme has against its one attack
    // — a dishonest cashier pairing their own phone to somebody else's card —
    // so the name has to reach the session, not just the code.
    let paired_by: String =
        sqlx::query("SELECT paired_by FROM member_session WHERE member_id = $1")
            .bind(CARD)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("read session: {e}"))
            .get("paired_by");
    assert_eq!(
        paired_by, CASHIER,
        "the session must name the cashier who issued the code"
    );
}

/// Nothing about a pairing failure says which card numbers exist.
///
/// Six different wrong states, one answer. All three reference implementations
/// distinguish "customer not found" from "invalid or expired code", which turns
/// the sign-in form into a lookup service for whether a number is a member.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_pairing_failure_answers_the_same(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let good = card_and_code(&app, &counter, CARD).await;

    // A card that was never enrolled.
    let unknown = pair(&app, "M-999999", "123456").await;
    // A card with no code ever issued against it.
    send(
        app.clone(),
        "POST",
        "/api/v1/members",
        counter.write(),
        Some(json!({ "member_id": "M-000456" })),
    )
    .await;
    let no_code = pair(&app, "M-000456", "123456").await;
    // The right card, the wrong six digits.
    let wrong = pair(&app, CARD, &wrong_code(&good)).await;
    // A code that is not six digits at all.
    let malformed = pair(&app, CARD, "12345").await;
    // A blocked membership, holding a live code.
    send(
        app.clone(),
        "POST",
        "/api/v1/members",
        counter.write(),
        Some(json!({ "member_id": "M-000789" })),
    )
    .await;
    let blocked_code = issue(&app, &counter, "M-000789").await;
    sqlx::query("UPDATE member SET blocked_at = now() WHERE member_id = $1")
        .bind("M-000789")
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("block: {e}"));
    let blocked = pair(&app, "M-000789", &blocked_code).await;
    // An expired code. Backdated rather than waited for.
    sqlx::query(
        "UPDATE member_pairing_code SET expires_at = now() - interval '1 minute'
          WHERE member_id = $1",
    )
    .bind(CARD)
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("expire: {e}"));
    let expired = pair(&app, CARD, &good).await;

    for (name, answer) in [
        ("unknown card", &unknown),
        ("no code issued", &no_code),
        ("wrong code", &wrong),
        ("malformed code", &malformed),
        ("blocked membership", &blocked),
        ("expired code", &expired),
    ] {
        assert_eq!(
            answer.status,
            StatusCode::UNAUTHORIZED,
            "{name} should be refused: {:?}",
            answer.body
        );
        assert_eq!(
            answer.body, unknown.body,
            "{name} answers differently from an unknown card, which makes this \
             form a way of finding out which numbers are members"
        );
        assert!(
            answer.set_cookies.is_empty(),
            "{name} set a cookie on a refusal"
        );
    }
}

/// Five guesses against six digits, and then the code is gone rather than
/// merely wrong.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn five_wrong_guesses_burn_the_code(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let good = card_and_code(&app, &counter, CARD).await;
    let bad = wrong_code(&good);

    for attempt in 1..=5 {
        let answer = pair(&app, CARD, &bad).await;
        assert_eq!(
            answer.status,
            StatusCode::UNAUTHORIZED,
            "guess {attempt} should be refused"
        );
    }

    let with_the_right_code = pair(&app, CARD, &good).await;
    assert_eq!(
        with_the_right_code.status,
        StatusCode::UNAUTHORIZED,
        "the right code still worked after five wrong ones, so the counter is \
         a suggestion: {:?}",
        with_the_right_code.body
    );

    // And the way out is another code, not a lookup.
    let fresh = issue(&app, &counter, CARD).await;
    assert_eq!(
        pair(&app, CARD, &fresh).await.status,
        StatusCode::OK,
        "reissuing must clear the burnt attempts, or a shopper who mistyped \
         five times could never pair again"
    );
}

/// A pairing code is worth exactly one device.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_code_pairs_one_phone_and_not_a_second(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let code = card_and_code(&app, &counter, CARD).await;

    assert_eq!(pair(&app, CARD, &code).await.status, StatusCode::OK);
    let second = pair(&app, CARD, &code).await;
    assert_eq!(
        second.status,
        StatusCode::UNAUTHORIZED,
        "the same six digits paired a second phone: {:?}",
        second.body
    );
}

/// Asking again replaces the code rather than adding one.
///
/// Two live codes for one card is the state where "I asked again and the old
/// one still worked" is true, which is the state a short-lived code exists to
/// avoid.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn issuing_again_retires_the_code_before_it(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let first = card_and_code(&app, &counter, CARD).await;
    let second = issue(&app, &counter, CARD).await;
    assert_ne!(first, second, "reissuing handed back the same six digits");

    assert_eq!(
        pair(&app, CARD, &first).await.status,
        StatusCode::UNAUTHORIZED,
        "the superseded code still paired a phone"
    );
    assert_eq!(pair(&app, CARD, &second).await.status, StatusCode::OK);
}

/// Enrolling the same card twice is not a mistake worth an error.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn enrolment_is_idempotent_on_the_card_number(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let first = send(
        app.clone(),
        "POST",
        "/api/v1/members",
        counter.write(),
        Some(json!({ "member_id": CARD, "display_name": "Ibu Sri" })),
    )
    .await;
    assert_eq!(first.status, StatusCode::OK, "{:?}", first.body);

    // Without a name the second time: a card re-presented at a till where
    // nobody re-asks for the name must not erase the name already held.
    let again = send(
        app.clone(),
        "POST",
        "/api/v1/members",
        counter.write(),
        Some(json!({ "member_id": CARD })),
    )
    .await;
    assert_eq!(again.status, StatusCode::OK, "{:?}", again.body);
    assert_eq!(
        again.body["display_name"],
        json!("Ibu Sri"),
        "re-enrolling forgot the name the shop already had"
    );
    assert_eq!(
        again.body["joined_on"], first.body["joined_on"],
        "re-enrolling moved the joining date"
    );
}

/// Whitespace around a card number is not a different card.
///
/// A number typed at a counter arrives with a trailing space often enough that
/// this is worth a test: two `member` rows for one physical card splits a
/// shopper's history in half.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_card_number_is_trimmed_before_it_becomes_a_member(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let padded = send(
        app.clone(),
        "POST",
        "/api/v1/members",
        counter.write(),
        Some(json!({ "member_id": format!("  {CARD}  ") })),
    )
    .await;
    assert_eq!(padded.status, StatusCode::OK, "{:?}", padded.body);
    assert_eq!(padded.body["member_id"], json!(CARD));

    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM member")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("count: {e}"));
    assert_eq!(rows, 1, "a padded number made a second card");

    let blank = send(
        app.clone(),
        "POST",
        "/api/v1/members",
        counter.write(),
        Some(json!({ "member_id": "   " })),
    )
    .await;
    assert_eq!(
        blank.status,
        StatusCode::BAD_REQUEST,
        "a blank card number was enrolled: {:?}",
        blank.body
    );
}

// ── the boundary between the two audiences ──────────────────────────────────

/// A member session cannot become an operator's.
///
/// This is the hole the whole feature exists to close, from the other side:
/// having proved they hold a loyalty card, a shopper must not be able to read
/// the directory, enrol cards, or look up anybody else's receipts.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_member_session_is_not_an_operator_session(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let code = card_and_code(&app, &counter, CARD).await;
    let phone = phone_from(&pair(&app, CARD, &code).await.set_cookies);

    for (method, path) in [
        ("GET", "/api/v1/members"),
        ("GET", "/api/v1/members/segments"),
        ("GET", &format!("/api/v1/customer/{CARD}/summary")[..]),
        ("GET", "/api/v1/inventory/pools"),
    ] {
        let answer = send(app.clone(), method, path, phone.read(), None).await;
        assert_eq!(
            answer.status,
            StatusCode::UNAUTHORIZED,
            "a phone holding only a member cookie reached {method} {path}: {:?}",
            answer.body
        );
    }

    let enrol = send(
        app.clone(),
        "POST",
        "/api/v1/members",
        phone.write(),
        Some(json!({ "member_id": "M-000456" })),
    )
    .await;
    assert_eq!(
        enrol.status,
        StatusCode::UNAUTHORIZED,
        "a shopper enrolled a card: {:?}",
        enrol.body
    );
}

/// An operator session cannot read a member's own surface.
///
/// Not a privilege question — an Admin can read anybody's history through
/// `/api/v1/customer/{id}/…`, which is the counter's legitimate lookup. It is
/// that `/api/v1/member/…` means "whoever this session belongs to", and an
/// operator session belongs to no member. Answering it for them would make the
/// route's meaning depend on who asked.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_operator_session_is_not_a_member_session(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    card_and_code(&app, &counter, CARD).await;

    for path in [
        "/api/v1/member/me",
        "/api/v1/member/summary",
        "/api/v1/member/transactions",
    ] {
        let answer = send(app.clone(), "GET", path, counter.read(), None).await;
        assert_eq!(
            answer.status,
            StatusCode::UNAUTHORIZED,
            "an operator cookie was accepted as a member at {path}: {:?}",
            answer.body
        );
    }

    // And the counter's own lookup still works, so the test above is about the
    // route's meaning rather than about the cashier being short of a right.
    let lookup = send(
        app.clone(),
        "GET",
        &format!("/api/v1/customer/{CARD}/summary"),
        counter.read(),
        None,
    )
    .await;
    assert_eq!(
        lookup.status,
        StatusCode::OK,
        "the counter lost its own lookup: {:?}",
        lookup.body
    );
}

/// A cookie the browser attaches on its own is not consent.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_member_write_needs_the_csrf_header(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let code = card_and_code(&app, &counter, CARD).await;
    let phone = phone_from(&pair(&app, CARD, &code).await.set_cookies);

    let without = send(
        app.clone(),
        "POST",
        "/api/v1/member/logout",
        phone.read(),
        Some(json!({})),
    )
    .await;
    assert_eq!(
        without.status,
        StatusCode::FORBIDDEN,
        "a cross-site page signed a member out: {:?}",
        without.body
    );

    let wrong = send(
        app.clone(),
        "POST",
        "/api/v1/member/logout",
        vec![
            ("cookie", phone.cookies.clone()),
            ("x-csrf-token", "not-the-token".to_owned()),
        ],
        Some(json!({})),
    )
    .await;
    assert_eq!(wrong.status, StatusCode::FORBIDDEN, "{:?}", wrong.body);

    // The header must match the cookie the pairing handed out, not merely be
    // present.
    let right = send(
        app.clone(),
        "POST",
        "/api/v1/member/logout",
        phone.write(),
        Some(json!({})),
    )
    .await;
    assert_eq!(right.status, StatusCode::OK, "{:?}", right.body);
}

/// Signing out has to stop the cookie, not merely forget it here.
///
/// A phone that is handed on, sold or lost must stop being able to read the
/// points; a client that only cleared its own cache would leave the session
/// working for whoever holds the device.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn signing_out_revokes_the_session_at_the_server(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let code = card_and_code(&app, &counter, CARD).await;
    let phone = phone_from(&pair(&app, CARD, &code).await.set_cookies);

    let out = send(
        app.clone(),
        "POST",
        "/api/v1/member/logout",
        phone.write(),
        Some(json!({})),
    )
    .await;
    assert_eq!(out.status, StatusCode::OK, "{:?}", out.body);

    let after = send(app.clone(), "GET", "/api/v1/member/me", phone.read(), None).await;
    assert_eq!(
        after.status,
        StatusCode::UNAUTHORIZED,
        "the old cookie still read the member's points after sign-out: {:?}",
        after.body
    );
}

/// Stopping a membership stops the phone already in the pocket.
///
/// If it only stopped the next pairing, blocking somebody at the counter would
/// leave their existing device reading their points until the session expired
/// ninety days later.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn blocking_a_membership_stops_a_phone_already_paired(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let code = card_and_code(&app, &counter, CARD).await;
    let phone = phone_from(&pair(&app, CARD, &code).await.set_cookies);
    assert_eq!(
        send(app.clone(), "GET", "/api/v1/member/me", phone.read(), None)
            .await
            .status,
        StatusCode::OK
    );

    sqlx::query("UPDATE member SET blocked_at = now() WHERE member_id = $1")
        .bind(CARD)
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("block: {e}"));

    let after = send(app.clone(), "GET", "/api/v1/member/me", phone.read(), None).await;
    assert_eq!(
        after.status,
        StatusCode::UNAUTHORIZED,
        "a blocked member's phone kept reading: {:?}",
        after.body
    );

    // And no new one can be paired either.
    let refused = issue_expecting_conflict(&app, &counter, CARD).await;
    assert_eq!(
        refused,
        StatusCode::CONFLICT,
        "a code was issued against a blocked membership"
    );
}

async fn issue_expecting_conflict(app: &axum::Router, counter: &Counter, card: &str) -> StatusCode {
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/members/{card}/pairing-code"),
        counter.write(),
        Some(json!({})),
    )
    .await
    .status
}

/// A code cannot be issued against a card nobody enrolled.
///
/// Otherwise the counter's own screen becomes the enrolment nobody did: six
/// digits handed out for a number that will never join a sale to a member.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_code_needs_a_card_that_exists(pool: PgPool) {
    let (app, counter) = shop(&pool).await;
    let answer = send(
        app.clone(),
        "POST",
        "/api/v1/members/M-000999/pairing-code",
        counter.write(),
        Some(json!({})),
    )
    .await;
    assert_eq!(
        answer.status,
        StatusCode::NOT_FOUND,
        "a code was issued for a card that was never enrolled: {:?}",
        answer.body
    );
}

/// Six digits that are not the ones issued.
fn wrong_code(good: &str) -> String {
    let mut digits: Vec<u8> = good.bytes().collect();
    // Move the first digit on by one, wrapping, so the result is always six
    // digits and never the code itself.
    digits[0] = if digits[0] == b'9' {
        b'0'
    } else {
        digits[0] + 1
    };
    String::from_utf8(digits).unwrap_or_else(|e| panic!("wrong code: {e}"))
}
