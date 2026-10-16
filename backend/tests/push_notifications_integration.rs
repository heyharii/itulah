//! Web Push, from a browser saying yes to a phone being woken.
//!
//! Three halves that are each easy to get right alone and wrong together:
//! the subscription routes (a signed-in person registering THIS browser), the
//! outbox (a trigger on `notification_recipient` queueing one delivery per
//! device inside the transaction that raised the notification), and the worker
//! (encrypting, signing and sending what is due, and reading the answer).
//!
//! The push service is played by a server on 127.0.0.1 that DECRYPTS what it
//! receives with the browser's private key, so the RFC 8291 encryption is
//! proven by something that did not write it, and the answer it gives — 201,
//! 410, 503 — is chosen per test. The real transport (`ReqwestTransport`) is
//! used, not a stand-in, so a request that reqwest could not send would fail
//! here too.
//!
//! Run: `DATABASE_URL=postgresql:///postgres cargo test --test push_notifications_integration`

use axum::body::{to_bytes, Body};
use axum::extract::State;
use axum::routing::post;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use futures_util::StreamExt as _;
use http::{header, HeaderMap, Request, StatusCode};
use inventory_backend::cloud::push::{PushAgent, ReqwestTransport, VapidKeys};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use p256::elliptic_curve::sec1::ToEncodedPoint as _;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex, Once};
use std::time::Duration;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;
use uuid::Uuid;

const ADMIN_PASSWORD: &str = "admin-password-push-1";
const SUBJECT: &str = "mailto:ops@itulah.test";

/// The process's push settings are read from the environment once
/// (`push::settings`), so every test in this binary sets the same key before
/// anything asks — once, so no thread reads the variable while another writes.
fn push_configured() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let keys = VapidKeys::generate(SUBJECT);
        std::env::set_var("WEB_PUSH_VAPID_PRIVATE_KEY", keys.private_key_base64url());
        std::env::set_var("WEB_PUSH_SUBJECT", SUBJECT);
        std::env::remove_var("WEB_PUSH_VAPID_PUBLIC_KEY");
    });
}

fn config() -> AppConfig {
    AppConfig {
        po_import: inventory_backend::cloud::intake::po::PoImportConfig::from_env(),
        clock: None,
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|error| panic!("bind: {error}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "cloud-push-test".into(),
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
        sync_apply_enabled: false,
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
    let bytes = to_bytes(response.into_body(), 1024 * 1024)
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

/// The headers a signed-in browser sends on a write: cookie and CSRF echo.
struct Browser {
    cookie: String,
    csrf: String,
}

impl Browser {
    fn read(&self) -> Vec<(String, String)> {
        vec![(header::COOKIE.to_string(), self.cookie.clone())]
    }
    fn write(&self) -> Vec<(String, String)> {
        vec![
            (header::COOKIE.to_string(), self.cookie.clone()),
            ("x-csrf-token".to_string(), self.csrf.clone()),
            (
                header::USER_AGENT.to_string(),
                "Mozilla/5.0 (Linux; Android 14) Chrome/140".to_string(),
            ),
        ]
    }
}

async fn signed_in(pool: &PgPool) -> (axum::Router, Browser) {
    push_configured();
    cloud::bootstrap_admin(pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let login = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        vec![],
        Some(json!({ "username": "admin", "password": ADMIN_PASSWORD })),
    )
    .await;
    assert_eq!(login.status, StatusCode::OK, "{}", login.body);
    let session = cookie_pair(&login.set_cookies, security::SESSION_COOKIE);
    let csrf = cookie_pair(&login.set_cookies, security::CSRF_COOKIE);
    let token = csrf
        .split_once('=')
        .map(|(_, value)| value.to_string())
        .unwrap_or_default();
    (
        app,
        Browser {
            cookie: format!("{session}; {csrf}"),
            csrf: token,
        },
    )
}

/// A browser's half of a subscription: the key pair a push is encrypted to,
/// and the auth secret.
struct FakeBrowser {
    secret: p256::SecretKey,
    auth: [u8; 16],
}

impl FakeBrowser {
    fn new() -> Self {
        let mut auth = [0u8; 16];
        auth.copy_from_slice(&Uuid::new_v4().as_bytes()[..]);
        Self {
            secret: inventory_backend::cloud::push::random_secret_key(),
            auth,
        }
    }
    fn p256dh(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.secret.public_key().to_encoded_point(false).as_bytes())
    }
    fn auth(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.auth)
    }
    fn open(&self, body: Vec<u8>) -> Value {
        let clear = web_push_native::decrypt(
            body,
            &self.secret,
            &web_push_native::Auth::clone_from_slice(&self.auth),
        )
        .unwrap_or_else(|error| panic!("decrypt: {error}"));
        serde_json::from_slice(&clear).unwrap_or_else(|error| panic!("payload json: {error}"))
    }
}

// ── A push service on this machine ───────────────────────────────────────────

#[derive(Clone)]
struct Captured {
    headers: HeaderMap,
    body: Vec<u8>,
}

#[derive(Clone)]
struct PushService {
    answer: Arc<AtomicU16>,
    received: Arc<Mutex<Vec<Captured>>>,
    base: String,
}

impl PushService {
    async fn start() -> Self {
        let answer = Arc::new(AtomicU16::new(201));
        let received = Arc::new(Mutex::new(Vec::new()));
        async fn accept(
            State((answer, received)): State<(Arc<AtomicU16>, Arc<Mutex<Vec<Captured>>>)>,
            headers: HeaderMap,
            body: axum::body::Bytes,
        ) -> StatusCode {
            received
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(Captured {
                    headers,
                    body: body.to_vec(),
                });
            StatusCode::from_u16(answer.load(Ordering::SeqCst))
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
        }
        let app = axum::Router::new()
            .route("/push/{id}", post(accept))
            .with_state((answer.clone(), received.clone()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .unwrap_or_else(|error| panic!("bind push service: {error}"));
        let address = listener
            .local_addr()
            .unwrap_or_else(|error| panic!("address: {error}"));
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Self {
            answer,
            received,
            base: format!("http://{address}"),
        }
    }
    fn answer_with(&self, status: u16) {
        self.answer.store(status, Ordering::SeqCst);
    }
    fn received(&self) -> Vec<Captured> {
        self.received
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
    fn endpoint(&self) -> String {
        format!("{}/push/{}", self.base, Uuid::new_v4())
    }
}

/// Registered straight into the table: the HTTP route refuses an endpoint on
/// 127.0.0.1, which is right, and is tested on its own below.
async fn subscribe_directly(pool: &PgPool, username: &str, endpoint: &str, browser: &FakeBrowser) {
    cloud::upsert_push_subscription(
        pool,
        username,
        &cloud::NewPushSubscription {
            endpoint,
            p256dh: &browser.p256dh(),
            auth: &browser.auth(),
            device_label: Some("Test browser"),
            user_agent: None,
        },
    )
    .await
    .unwrap_or_else(|error| panic!("subscribe: {error}"));
}

async fn raise(pool: &PgPool, recipients: &[&str], commit: bool) -> Uuid {
    let mut tx = pool.begin().await.unwrap_or_else(|error| panic!("{error}"));
    let recipients: Vec<String> = recipients.iter().map(|one| (*one).to_owned()).collect();
    let id = cloud::raise_notification(
        &mut tx,
        cloud::NewNotification {
            kind: "activity",
            title: "Harga PO-1183 diminta berubah".into(),
            body: "Pemasok meminta harga baru untuk 40 potong kemeja.".into(),
            subject: Some(("purchase_order", Uuid::new_v4().to_string())),
            origin_id: None,
            payload: json!({ "secret_amount_minor": 8_600_000 }),
        },
        &recipients,
    )
    .await
    .unwrap_or_else(|error| panic!("raise: {error}"))
    .unwrap_or_else(|| panic!("nobody was told"));
    if commit {
        tx.commit().await.unwrap_or_else(|error| panic!("{error}"));
    } else {
        tx.rollback()
            .await
            .unwrap_or_else(|error| panic!("{error}"));
    }
    id
}

async fn queued(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM push_delivery")
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("{error}"))
}

fn agent(pool: &PgPool) -> PushAgent {
    push_configured();
    let vapid = inventory_backend::cloud::push::settings()
        .vapid
        .clone()
        .unwrap_or_else(|| panic!("push is configured for this test binary"));
    PushAgent::new(
        pool.clone(),
        Some(vapid),
        Arc::new(ReqwestTransport::new().unwrap_or_else(|error| panic!("{error}"))),
    )
}

// ── The routes ───────────────────────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_browser_subscribes_and_unsubscribes_itself(pool: PgPool) {
    let (app, browser) = signed_in(&pool).await;

    // Nobody signed in is told nothing, not even the key.
    let anonymous = send(app.clone(), "GET", "/api/v1/push/public-key", vec![], None).await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);

    let key = send(
        app.clone(),
        "GET",
        "/api/v1/push/public-key",
        browser.read(),
        None,
    )
    .await;
    assert_eq!(key.status, StatusCode::OK);
    assert_eq!(key.body["enabled"], json!(true));
    let public_key = key.body["public_key"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    assert_eq!(public_key.len(), 87);

    let device = FakeBrowser::new();
    let endpoint = format!("https://fcm.googleapis.com/fcm/send/{}", Uuid::new_v4());
    let subscription = json!({
        "endpoint": endpoint,
        "expirationTime": null,
        "keys": { "p256dh": device.p256dh(), "auth": device.auth() },
        "device_label": "Chrome on Android",
    });
    let first = send(
        app.clone(),
        "POST",
        "/api/v1/push/subscriptions",
        browser.write(),
        Some(subscription.clone()),
    )
    .await;
    assert_eq!(first.status, StatusCode::OK, "{}", first.body);
    assert_eq!(first.body["devices"], json!(1));
    // Nothing the browser gave is echoed back.
    assert!(first.body.get("endpoint").is_none() && first.body.get("keys").is_none());

    // Every open of the app re-registers; it is still one device.
    let again = send(
        app.clone(),
        "POST",
        "/api/v1/push/subscriptions",
        browser.write(),
        Some(subscription.clone()),
    )
    .await;
    assert_eq!(again.status, StatusCode::OK);
    assert_eq!(again.body["devices"], json!(1));
    assert_eq!(again.body["subscription_id"], first.body["subscription_id"]);
    let stored: (String, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT username, device_label, user_agent FROM push_subscription WHERE endpoint = $1",
    )
    .bind(&endpoint)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(stored.0, "admin");
    assert_eq!(stored.1.as_deref(), Some("Chrome on Android"));
    assert!(stored.2.unwrap_or_default().contains("Android"));

    // A write without the CSRF echo is refused like every other write.
    let forged = send(
        app.clone(),
        "POST",
        "/api/v1/push/subscriptions",
        browser.read(),
        Some(subscription.clone()),
    )
    .await;
    assert_eq!(forged.status, StatusCode::FORBIDDEN);

    // An endpoint that is not a push service would make the cloud a proxy.
    for bad in [
        "http://fcm.googleapis.com/fcm/send/x",
        "https://127.0.0.1/push/x",
        "https://internal.example/admin",
    ] {
        let refused = send(
            app.clone(),
            "POST",
            "/api/v1/push/subscriptions",
            browser.write(),
            Some(json!({
                "endpoint": bad,
                "keys": { "p256dh": device.p256dh(), "auth": device.auth() },
            })),
        )
        .await;
        assert_eq!(refused.status, StatusCode::BAD_REQUEST, "{bad}");
    }
    // Keys that do not decode would fail every push; refused up front.
    let broken = send(
        app.clone(),
        "POST",
        "/api/v1/push/subscriptions",
        browser.write(),
        Some(json!({
            "endpoint": format!("https://fcm.googleapis.com/fcm/send/{}", Uuid::new_v4()),
            "keys": { "p256dh": "B".repeat(87), "auth": device.auth() },
        })),
    )
    .await;
    assert_eq!(broken.status, StatusCode::BAD_REQUEST);

    // Signing out on this browser: gone, and saying so twice is not an error.
    let removed = send(
        app.clone(),
        "DELETE",
        "/api/v1/push/subscriptions",
        browser.write(),
        Some(json!({ "endpoint": endpoint })),
    )
    .await;
    assert_eq!(removed.status, StatusCode::OK, "{}", removed.body);
    assert_eq!(removed.body["removed"], json!(true));
    let twice = send(
        app.clone(),
        "DELETE",
        "/api/v1/push/subscriptions",
        browser.write(),
        Some(json!({ "endpoint": endpoint })),
    )
    .await;
    assert_eq!(twice.body["removed"], json!(false));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn only_your_own_subscription_can_be_removed(pool: PgPool) {
    let (app, browser) = signed_in(&pool).await;
    let device = FakeBrowser::new();
    let endpoint = format!("https://fcm.googleapis.com/fcm/send/{}", Uuid::new_v4());
    subscribe_directly(&pool, "someone-else", &endpoint, &device).await;
    let attempt = send(
        app,
        "DELETE",
        "/api/v1/push/subscriptions",
        browser.write(),
        Some(json!({ "endpoint": endpoint })),
    )
    .await;
    assert_eq!(attempt.body["removed"], json!(false));
    let still: i64 = sqlx::query_scalar("SELECT count(*) FROM push_subscription")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(still, 1);
}

// ── The outbox ───────────────────────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_notification_queues_one_delivery_per_device_of_each_person_told(pool: PgPool) {
    let phone = FakeBrowser::new();
    let laptop = FakeBrowser::new();
    subscribe_directly(
        &pool,
        "buyer",
        "https://fcm.googleapis.com/fcm/send/phone",
        &phone,
    )
    .await;
    subscribe_directly(&pool, "buyer", "https://web.push.apple.com/laptop", &laptop).await;

    // Told: the buyer (two devices) and somebody with none.
    let told = raise(&pool, &["buyer", "no-devices"], true).await;
    let rows: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT notification_id, username FROM push_delivery ORDER BY delivery_id")
            .fetch_all(&pool)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|(id, who)| *id == told && who == "buyer"));

    // A notification whose transaction rolled back was never raised, and was
    // never queued.
    raise(&pool, &["buyer"], false).await;
    assert_eq!(queued(&pool).await, 2);
}

// ── The worker ───────────────────────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_worker_sends_the_sentence_encrypted_and_signed(pool: PgPool) {
    let service = PushService::start().await;
    let device = FakeBrowser::new();
    subscribe_directly(&pool, "buyer", &service.endpoint(), &device).await;
    let told = raise(&pool, &["buyer"], true).await;

    let report = agent(&pool)
        .drain_once()
        .await
        .unwrap_or_else(|error| panic!("drain: {error}"));
    assert_eq!(report.delivered, 1, "{report:?}");
    assert_eq!(queued(&pool).await, 0);

    let received = service.received();
    assert_eq!(received.len(), 1);
    let push = &received[0];
    assert_eq!(push.headers["content-encoding"], "aes128gcm");
    assert_eq!(push.headers["ttl"], "86400");
    assert_eq!(push.headers["urgency"], "high");
    let authorization = push.headers["authorization"].to_str().unwrap_or_default();
    assert!(authorization.starts_with("vapid t="), "{authorization}");
    assert!(push.body.len() < 4096);

    // Opened with the browser's key: the sentence, where to go, nothing else.
    let message = device.open(push.body.clone());
    assert_eq!(message["notification_id"], json!(told));
    assert_eq!(message["title"], "Harga PO-1183 diminta berubah");
    assert_eq!(message["kind"], "activity");
    assert_eq!(message["subject_kind"], "purchase_order");
    assert_eq!(message["url"], "/system/notifications");
    assert!(
        !message.to_string().contains("secret_amount_minor"),
        "the notification's payload column must not travel: {message}"
    );

    let healthy: (Option<chrono::DateTime<chrono::Utc>>, i32) =
        sqlx::query_as("SELECT last_success_at, failure_count FROM push_subscription")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
    assert!(healthy.0.is_some());
    assert_eq!(healthy.1, 0);

    // Nothing left: a second pass sends nothing.
    let idle = agent(&pool)
        .drain_once()
        .await
        .unwrap_or_else(|error| panic!("drain: {error}"));
    assert!(idle.is_empty(), "{idle:?}");
    assert_eq!(service.received().len(), 1);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_subscription_the_service_calls_gone_is_deleted(pool: PgPool) {
    let service = PushService::start().await;
    service.answer_with(410);
    let device = FakeBrowser::new();
    subscribe_directly(&pool, "buyer", &service.endpoint(), &device).await;
    raise(&pool, &["buyer"], true).await;
    raise(&pool, &["buyer"], true).await;
    assert_eq!(queued(&pool).await, 2);

    let report = agent(&pool)
        .drain_once()
        .await
        .unwrap_or_else(|error| panic!("drain: {error}"));
    assert!(report.gone >= 1, "{report:?}");
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM push_subscription")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(left, 0);
    // What was still queued for it went with it.
    assert_eq!(queued(&pool).await, 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_service_that_is_down_is_tried_again_later_not_now(pool: PgPool) {
    let service = PushService::start().await;
    service.answer_with(503);
    let device = FakeBrowser::new();
    subscribe_directly(&pool, "buyer", &service.endpoint(), &device).await;
    raise(&pool, &["buyer"], true).await;

    let report = agent(&pool)
        .drain_once()
        .await
        .unwrap_or_else(|error| panic!("drain: {error}"));
    assert_eq!(report.retried, 1, "{report:?}");
    let (attempts, waits, error): (i32, bool, Option<String>) = sqlx::query_as(
        "SELECT attempts, next_attempt_at > now() + interval '20 seconds', last_error
           FROM push_delivery",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(attempts, 1);
    assert!(waits, "the retry is backed off, not immediate");
    assert_eq!(error.as_deref(), Some("push service answered 503"));

    // Not due yet: an immediate second pass leaves it alone.
    let again = agent(&pool)
        .drain_once()
        .await
        .unwrap_or_else(|error| panic!("drain: {error}"));
    assert!(again.is_empty(), "{again:?}");
    assert_eq!(service.received().len(), 1);

    // Once due and the service is back, it goes.
    service.answer_with(201);
    sqlx::query("UPDATE push_delivery SET next_attempt_at = now()")
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("{error}"));
    let delivered = agent(&pool)
        .drain_once()
        .await
        .unwrap_or_else(|error| panic!("drain: {error}"));
    assert_eq!(delivered.delivered, 1, "{delivered:?}");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_last_attempt_gives_up_and_counts_against_the_device(pool: PgPool) {
    let service = PushService::start().await;
    service.answer_with(503);
    let device = FakeBrowser::new();
    subscribe_directly(&pool, "buyer", &service.endpoint(), &device).await;
    raise(&pool, &["buyer"], true).await;
    sqlx::query("UPDATE push_delivery SET attempts = $1 - 1")
        .bind(inventory_backend::cloud::push::MAX_ATTEMPTS)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("{error}"));

    let report = agent(&pool)
        .drain_once()
        .await
        .unwrap_or_else(|error| panic!("drain: {error}"));
    assert_eq!(report.dropped, 1, "{report:?}");
    assert_eq!(queued(&pool).await, 0);
    let failures: i32 = sqlx::query_scalar("SELECT failure_count FROM push_subscription")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(failures, 1);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn something_already_read_elsewhere_is_not_pushed(pool: PgPool) {
    let service = PushService::start().await;
    let device = FakeBrowser::new();
    subscribe_directly(&pool, "buyer", &service.endpoint(), &device).await;
    let told = raise(&pool, &["buyer"], true).await;
    cloud::mark_notification_read(&pool, "buyer", told)
        .await
        .unwrap_or_else(|error| panic!("{error}"));

    let report = agent(&pool)
        .drain_once()
        .await
        .unwrap_or_else(|error| panic!("drain: {error}"));
    assert_eq!(report.skipped, 1, "{report:?}");
    assert!(service.received().is_empty());
    assert_eq!(queued(&pool).await, 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_phone_that_changes_hands_is_not_sent_the_previous_persons_queue(pool: PgPool) {
    let device = FakeBrowser::new();
    let endpoint = "https://fcm.googleapis.com/fcm/send/shared-tablet";
    subscribe_directly(&pool, "first", endpoint, &device).await;
    raise(&pool, &["first"], true).await;
    assert_eq!(queued(&pool).await, 1);

    subscribe_directly(&pool, "second", endpoint, &device).await;
    assert_eq!(queued(&pool).await, 0);
    let owner: String = sqlx::query_scalar("SELECT username FROM push_subscription")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(owner, "second");
}

// ── The stream ───────────────────────────────────────────────────────────────

/// Read frames until one names `event`, or give up after `within`.
async fn next_event(
    stream: &mut (impl futures_util::Stream<Item = Result<axum::body::Bytes, axum::Error>> + Unpin),
    buffer: &mut String,
    event: &str,
    within: Duration,
) -> Option<Value> {
    let deadline = tokio::time::Instant::now() + within;
    loop {
        while let Some(end) = buffer.find("\n\n") {
            let frame: String = buffer.drain(..end + 2).collect();
            let name = frame
                .lines()
                .find_map(|line| line.strip_prefix("event: ").or(line.strip_prefix("event:")));
            let data = frame
                .lines()
                .find_map(|line| line.strip_prefix("data: ").or(line.strip_prefix("data:")));
            if name.map(str::trim) == Some(event) {
                return data.and_then(|data| serde_json::from_str(data).ok());
            }
        }
        let chunk = tokio::time::timeout_at(deadline, stream.next())
            .await
            .ok()??;
        buffer.push_str(&String::from_utf8_lossy(&chunk.ok()?));
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_stream_says_where_the_reader_stands_and_what_arrives(pool: PgPool) {
    let (app, browser) = signed_in(&pool).await;
    let mut request = Request::builder()
        .method("GET")
        .uri("/api/v1/notifications/stream");
    for (name, value) in browser.read() {
        request = request.header(name, value);
    }
    let response = app
        .oneshot(
            request
                .body(Body::empty())
                .unwrap_or_else(|error| panic!("{error}")),
        )
        .await
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers()[header::CONTENT_TYPE]
        .to_str()
        .unwrap_or_default()
        .starts_with("text/event-stream"));
    let mut stream = response.into_body().into_data_stream();
    let mut buffer = String::new();

    let ready = next_event(&mut stream, &mut buffer, "ready", Duration::from_secs(5))
        .await
        .unwrap_or_else(|| panic!("no ready event"));
    assert_eq!(ready["unread"], json!(0));

    let told = raise(&pool, &["admin"], true).await;
    let arrived = next_event(
        &mut stream,
        &mut buffer,
        "notification",
        Duration::from_secs(10),
    )
    .await
    .unwrap_or_else(|| panic!("no notification event"));
    assert_eq!(arrived["notification_id"], json!(told));
    assert_eq!(arrived["title"], "Harga PO-1183 diminta berubah");
    assert!(!arrived.to_string().contains("secret_amount_minor"));
    let count = next_event(&mut stream, &mut buffer, "unread", Duration::from_secs(5))
        .await
        .unwrap_or_else(|| panic!("no unread event"));
    assert_eq!(count["unread"], json!(1));

    // Read on another device: this one's badge is told too.
    cloud::mark_notification_read(&pool, "admin", told)
        .await
        .unwrap_or_else(|error| panic!("{error}"));
    let cleared = next_event(&mut stream, &mut buffer, "unread", Duration::from_secs(10))
        .await
        .unwrap_or_else(|| panic!("no unread event after reading"));
    assert_eq!(cleared["unread"], json!(0));
}
