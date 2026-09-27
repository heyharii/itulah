//! Web Push: waking the browser that asked, when work finds its person.
//!
//! # What this is for
//!
//! A notification (`postgres::notifications`) is raised inside the transaction
//! of the thing that caused it and then waits in a list. That is right for the
//! record and wrong for the person: a buyer with the tab closed learns about a
//! price query when they next sit down. Web Push (RFC 8030) lets the browser
//! that said yes be woken through its vendor's push service — FCM for Chrome
//! and Android, Mozilla's for Firefox, Apple's for Safari and an installed
//! iPhone app — so the sentence lands on a locked phone.
//!
//! # The shape, and why each part is where it is
//!
//! - **An outbox, not a send.** The code that raised a notification is inside
//!   its own transaction, often accepting a delivery or posting a bill. A push
//!   service answering slowly must never make that wait, so a trigger on
//!   `notification_recipient` writes one `push_delivery` row per device and
//!   this module's worker sends them after commit (migration 0462).
//! - **One worker per process, polling.** Every two seconds it claims what is
//!   due with `FOR UPDATE SKIP LOCKED` and a lease, so two cloud processes do
//!   not send the same row and a process that died mid-send leaves a row that
//!   comes due again by itself. Polling rather than `LISTEN` for the reason
//!   `http::chat` gives: a held-open connection per listener is a pool
//!   connection gone, and a query over an index that is almost always empty
//!   costs nothing.
//! - **The payload is the sentence and nothing else.** Title and body as they
//!   were written for this reader, the kind, the id, and where to go
//!   (`PushMessage`). No `payload` jsonb, no amounts the sentence did not
//!   already say. It passes through a third party's servers — encrypted to
//!   the browser (RFC 8291), but still: the less it carries, the less there is
//!   to have leaked.
//! - **Encryption and VAPID are done here, sent through `reqwest`.**
//!   `web-push-native` encrypts; the VAPID token (RFC 8292) is one ES256
//!   signature made with `p256`; the request goes out on the rustls client the
//!   rest of the cloud uses. No OpenSSL.
//!
//! # Configuration, and its absence
//!
//! `WEB_PUSH_VAPID_PRIVATE_KEY` (the raw 32-byte P-256 key, base64url — the
//! format `npx web-push generate-vapid-keys` prints) and `WEB_PUSH_SUBJECT`
//! (`mailto:` or `https:`, which push services use to reach whoever runs this
//! server). `WEB_PUSH_VAPID_PUBLIC_KEY` is optional: the public key is derived,
//! and when it is also given it must match, because a pasted pair that does
//! not belong together subscribes every browser to a key nothing signs with.
//!
//! Absent or unreadable configuration is **push switched off**, said once at
//! startup and on `GET /api/v1/push/public-key`, never a refusal to boot: a
//! node that cannot reach phones still has every notification in the list.
//!
//! # What is never logged
//!
//! Titles, bodies, the endpoint's path, and the browser's keys. The endpoint
//! is a capability URL — anybody holding it and our VAPID key can wake that
//! phone — so logs carry the subscription id and the push service's host.

use crate::cloud::application::AppError;
use crate::cloud::postgres as infrastructure;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use serde::Serialize;
use sqlx::PgPool;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tracing::{info, warn};
use uuid::Uuid;

/// The server's VAPID identity: the key that signs every push, and who to
/// write to about it.
pub struct VapidKeys {
    signing: SigningKey,
    /// Uncompressed SEC1 point, base64url — exactly what the browser wants as
    /// `applicationServerKey`.
    public_key: String,
    subject: String,
}

impl std::fmt::Debug for VapidKeys {
    // The private half never reaches a log line, even by `{:?}`.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VapidKeys")
            .field("public_key", &self.public_key)
            .field("subject", &self.subject)
            .finish_non_exhaustive()
    }
}

/// Base64url in, bytes out, forgiving about padding and the standard alphabet.
///
/// Keys are pasted into dashboards by people; a trailing `=` or a `+` from a
/// tool that used the other alphabet should not be the reason push is off.
pub fn decode_base64url(value: &str) -> Result<Vec<u8>, String> {
    let cleaned: String = value
        .trim()
        .trim_end_matches('=')
        .chars()
        .map(|c| match c {
            '+' => '-',
            '/' => '_',
            other => other,
        })
        .collect();
    URL_SAFE_NO_PAD
        .decode(cleaned.as_bytes())
        .map_err(|_| "not base64url".to_owned())
}

impl VapidKeys {
    /// Build from configuration values. The error is a sentence for the
    /// startup log and never contains the key.
    pub fn from_config(
        private_key: &str,
        subject: &str,
        expected_public: Option<&str>,
    ) -> Result<Self, String> {
        let subject = subject.trim();
        if !(subject.starts_with("mailto:") || subject.starts_with("https://")) {
            return Err(
                "WEB_PUSH_SUBJECT must be a mailto: or https: address push services can reach \
                 the operator at"
                    .into(),
            );
        }
        let bytes = decode_base64url(private_key)
            .map_err(|_| "WEB_PUSH_VAPID_PRIVATE_KEY is not base64url".to_owned())?;
        let signing = SigningKey::from_slice(&bytes).map_err(|_| {
            "WEB_PUSH_VAPID_PRIVATE_KEY is not a 32-byte P-256 private key".to_owned()
        })?;
        let keys = Self::from_signing_key(signing, subject.to_owned());
        if let Some(expected) = expected_public.map(str::trim).filter(|v| !v.is_empty()) {
            let expected = decode_base64url(expected)
                .map_err(|_| "WEB_PUSH_VAPID_PUBLIC_KEY is not base64url".to_owned())?;
            if URL_SAFE_NO_PAD.encode(expected) != keys.public_key {
                return Err(
                    "WEB_PUSH_VAPID_PUBLIC_KEY does not belong to WEB_PUSH_VAPID_PRIVATE_KEY"
                        .into(),
                );
            }
        }
        Ok(keys)
    }

    fn from_signing_key(signing: SigningKey, subject: String) -> Self {
        let point = signing.verifying_key().to_encoded_point(false);
        let public_key = URL_SAFE_NO_PAD.encode(point.as_bytes());
        Self {
            signing,
            public_key,
            subject,
        }
    }

    /// A fresh pair. For tests, and for a person setting a server up who
    /// would rather not install a Node tool to get one.
    pub fn generate(subject: &str) -> Self {
        Self::from_signing_key(
            SigningKey::from(random_secret_key()),
            subject.trim().to_owned(),
        )
    }

    /// The private key in the format `from_config` reads.
    pub fn private_key_base64url(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.signing.to_bytes())
    }

    pub fn public_key(&self) -> &str {
        &self.public_key
    }

    pub fn subject(&self) -> &str {
        &self.subject
    }

    /// The `Authorization` header for one push (RFC 8292 §3).
    ///
    /// The audience is the push service's ORIGIN, not the endpoint: the token
    /// says "this server may push to your service", and a token bound to one
    /// endpoint would be refused by every service that checks. Twelve hours,
    /// inside the twenty-four RFC 8292 allows, so a clock a few minutes off
    /// does not make every push a 403.
    pub fn authorization(&self, endpoint: &reqwest::Url, now_unix: i64) -> Result<String, String> {
        let audience = endpoint.origin().ascii_serialization();
        if audience == "null" {
            return Err("the endpoint has no origin".into());
        }
        let header = URL_SAFE_NO_PAD.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
        let claims = serde_json::json!({
            "aud": audience,
            "exp": now_unix + 12 * 60 * 60,
            "sub": self.subject,
        });
        let claims = URL_SAFE_NO_PAD.encode(claims.to_string());
        let signing_input = format!("{header}.{claims}");
        // Raw r||s, 64 bytes — the JWS form of ES256, not DER.
        let signature: Signature = self.signing.sign(signing_input.as_bytes());
        let signature = URL_SAFE_NO_PAD.encode(signature.to_bytes());
        Ok(format!(
            "vapid t={signing_input}.{signature}, k={}",
            self.public_key
        ))
    }
}

/// A uniformly random P-256 scalar from the operating system.
///
/// `ring`'s generator rather than a second RNG crate: it is already the one
/// sealing fingerprint templates in this binary. A 32-byte draw is outside the
/// curve order with probability about 2^-32; that draw is simply thrown away.
pub fn random_secret_key() -> p256::SecretKey {
    use ring::rand::SecureRandom;
    let rng = ring::rand::SystemRandom::new();
    loop {
        let mut bytes = [0u8; 32];
        if rng.fill(&mut bytes).is_err() {
            continue;
        }
        if let Ok(key) = p256::SecretKey::from_slice(&bytes) {
            return key;
        }
    }
}

/// Whether this process can push, and if not, the sentence that says why.
pub struct PushSettings {
    pub vapid: Option<Arc<VapidKeys>>,
    pub disabled_reason: Option<String>,
}

impl PushSettings {
    /// Pure, so the rules can be tested without touching the environment.
    pub fn from_values(
        private_key: Option<&str>,
        public_key: Option<&str>,
        subject: Option<&str>,
    ) -> Self {
        let private_key = private_key.map(str::trim).filter(|v| !v.is_empty());
        let subject = subject.map(str::trim).filter(|v| !v.is_empty());
        let disabled = |reason: &str| Self {
            vapid: None,
            disabled_reason: Some(reason.to_owned()),
        };
        match (private_key, subject) {
            (None, None) => disabled(
                "Web Push is not configured on this server: set WEB_PUSH_VAPID_PRIVATE_KEY and \
                 WEB_PUSH_SUBJECT to turn it on.",
            ),
            (None, Some(_)) => disabled(
                "Web Push is off: WEB_PUSH_SUBJECT is set but WEB_PUSH_VAPID_PRIVATE_KEY is not.",
            ),
            (Some(_), None) => disabled(
                "Web Push is off: WEB_PUSH_VAPID_PRIVATE_KEY is set but WEB_PUSH_SUBJECT is not. \
                 Push services refuse a server that gives them no way to reach its operator.",
            ),
            (Some(private_key), Some(subject)) => {
                match VapidKeys::from_config(private_key, subject, public_key) {
                    Ok(keys) => Self {
                        vapid: Some(Arc::new(keys)),
                        disabled_reason: None,
                    },
                    Err(reason) => disabled(&format!("Web Push is off: {reason}.")),
                }
            }
        }
    }

    pub fn from_env() -> Self {
        let read = |name: &str| std::env::var(name).ok();
        Self::from_values(
            read("WEB_PUSH_VAPID_PRIVATE_KEY").as_deref(),
            read("WEB_PUSH_VAPID_PUBLIC_KEY").as_deref(),
            read("WEB_PUSH_SUBJECT").as_deref(),
        )
    }
}

/// This process's push settings, read from the environment once.
///
/// A process-wide value rather than a field on `AppState`: the settings are a
/// fact about the process, the same for every request, and `AppState` is built
/// in forty places by tests that have no reason to know push exists.
pub fn settings() -> &'static PushSettings {
    static SETTINGS: OnceLock<PushSettings> = OnceLock::new();
    SETTINGS.get_or_init(PushSettings::from_env)
}

// ── Endpoints ──────────────────────────────────────────────────────────────

/// The push services a browser can hand us an endpoint on.
///
/// An allow-list, because the server POSTs to whatever URL is stored, and a
/// signed-in user who could register `http://10.0.0.5/admin` would have made
/// the cloud a proxy into its own network. Every browser that implements Web
/// Push uses one of these; a new one is a line here and a deliberate act.
const PUSH_SERVICE_HOSTS: &[&str] = &[
    // Chrome, Android, Opera, Brave, Samsung Internet.
    "fcm.googleapis.com",
    "android.googleapis.com",
    // Firefox.
    "updates.push.services.mozilla.com",
    // Safari on macOS and an installed web app on iOS/iPadOS 16.4+.
    "web.push.apple.com",
];

/// And the ones whose host carries a per-region prefix.
const PUSH_SERVICE_SUFFIXES: &[&str] = &[
    // Edge: `wns2-sg2p.notify.windows.com` and friends.
    ".notify.windows.com",
    ".push.apple.com",
];

/// Refuse anything that is not an https URL on a known push service.
///
/// The message is for the person whose browser sent it, which in practice is
/// a developer: an ordinary browser only ever produces good ones.
pub fn validate_endpoint(endpoint: &str) -> Result<reqwest::Url, String> {
    if endpoint.len() > 2048 {
        return Err("that push endpoint is too long to be one a browser made".into());
    }
    let url = reqwest::Url::parse(endpoint)
        .map_err(|_| "that push endpoint is not a URL".to_owned())?;
    if url.scheme() != "https" {
        return Err("a push endpoint must be https".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("a push endpoint does not carry credentials".into());
    }
    if url.port().is_some_and(|port| port != 443) {
        return Err("a push endpoint is on the standard https port".into());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "a push endpoint names a host".to_owned())?
        .to_ascii_lowercase();
    let known = PUSH_SERVICE_HOSTS.contains(&host.as_str())
        || PUSH_SERVICE_SUFFIXES
            .iter()
            .any(|suffix| host.ends_with(suffix) && host.len() > suffix.len());
    if !known {
        return Err(format!(
            "{host} is not a push service this server sends to (Chrome, Edge, Firefox and Safari \
             are supported)"
        ));
    }
    Ok(url)
}

/// The push service's host, for a log line. Never the path: that is the
/// capability.
pub fn endpoint_host(endpoint: &str) -> String {
    reqwest::Url::parse(endpoint)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_else(|| "unparseable".into())
}

// ── The message ────────────────────────────────────────────────────────────

/// What a phone is told. The whole of it.
///
/// `subject_kind`/`subject_id` are the record the notification is about, as
/// the list already carries them; the service worker turns that into a screen
/// with the same table the bell uses (`lib/record-route.ts`), because the
/// server deliberately does not know the hub's routes — 0046 stores a record
/// rather than a URL so a route rename cannot strand old notifications, and a
/// push is the same notification. `url` is where to land when there is no
/// such screen: the list itself.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct PushMessage {
    /// Payload version, so a service worker cached from last month can tell a
    /// shape it does not understand from a broken one.
    pub v: u8,
    pub notification_id: Uuid,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub url: String,
    pub subject_kind: Option<String>,
    pub subject_id: Option<String>,
}

/// Where a notification with nowhere better to go lands.
pub const NOTIFICATION_LIST_URL: &str = "/system/notifications";

/// Longest title and body carried, in characters.
///
/// A lock screen shows two lines of a body; the rest is on the list. The caps
/// keep the encrypted record well inside the 4 KB every push service accepts
/// (`PAYLOAD_BUDGET` below) even when every character is four bytes.
const TITLE_CHARS: usize = 120;
const BODY_CHARS: usize = 400;

/// The bytes a payload may take before encryption. Push services accept 4096
/// after encryption, which adds 86 bytes of header and 17 of tag and padding;
/// three kilobytes leaves room for every id and route this could ever carry.
pub const PAYLOAD_BUDGET: usize = 3 * 1024;

/// Cut at a character boundary, and say it was cut.
pub fn clip(text: &str, max_chars: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max_chars {
        return text.to_owned();
    }
    let kept: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{}…", kept.trim_end())
}

impl PushMessage {
    pub fn new(
        notification_id: Uuid,
        kind: &str,
        title: &str,
        body: &str,
        subject_kind: Option<String>,
        subject_id: Option<String>,
    ) -> Self {
        // An id longer than any record id in this estate is not a record id;
        // drop the pair rather than carry an arbitrary string to a phone.
        let (subject_kind, subject_id) = match (subject_kind, subject_id) {
            (Some(kind), Some(id)) if kind.len() <= 64 && id.len() <= 128 => {
                (Some(kind), Some(id))
            }
            _ => (None, None),
        };
        Self {
            v: 1,
            notification_id,
            kind: clip(kind, 80),
            title: clip(title, TITLE_CHARS),
            body: clip(body, BODY_CHARS),
            url: NOTIFICATION_LIST_URL.to_owned(),
            subject_kind,
            subject_id,
        }
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>, AppError> {
        let bytes = serde_json::to_vec(self)?;
        if bytes.len() > PAYLOAD_BUDGET {
            // Unreachable with the caps above; a guard rather than a promise,
            // because a push service answers an oversized payload with 413 and
            // the notification would silently never arrive.
            return Err(AppError::Validation(format!(
                "push payload of {} bytes exceeds the {PAYLOAD_BUDGET}-byte budget",
                bytes.len()
            )));
        }
        Ok(bytes)
    }
}

// ── Retries ────────────────────────────────────────────────────────────────

/// Attempts at one delivery before it is given up.
pub const MAX_ATTEMPTS: i32 = 6;

/// Consecutive messages a device may fail before its subscription is dropped.
pub const MAX_SUBSCRIPTION_FAILURES: i32 = 10;

/// A notification older than this is not pushed at all. A phone that was off
/// for a weekend should open onto its list, not buzz forty times on Monday.
pub const DELIVERY_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// How long to wait after the `attempts`-th failure, or `None` to give up.
///
/// 30 s, 2 min, 10 min, 30 min, 2 h: quick enough that a push service's brief
/// hiccup costs a minute, spread enough that one having a bad hour is not
/// hammered, and finished well inside `DELIVERY_TTL`.
pub fn retry_delay(attempts: i32) -> Option<Duration> {
    let seconds = match attempts {
        i32::MIN..=1 => 30,
        2 => 120,
        3 => 600,
        4 => 1_800,
        5 => 7_200,
        _ => return None,
    };
    if attempts >= MAX_ATTEMPTS {
        return None;
    }
    Some(Duration::from_secs(seconds))
}

/// What a push service's answer means for this delivery.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// 2xx. The service has it.
    Delivered,
    /// 404 or 410: the subscription no longer exists. Delete it.
    Gone,
    /// 408, 425, 429, 5xx, or no answer: try again later. `Retry-After`, when
    /// the service gave one, is honoured up to an hour.
    Retry {
        reason: String,
        after: Option<Duration>,
    },
    /// Any other 4xx: this message will never be accepted (bad VAPID, too
    /// large). Retrying sends the same refusal, so the message is dropped and
    /// the device's failure count goes up.
    Rejected { reason: String },
}

pub fn classify(status: u16, retry_after: Option<Duration>) -> Outcome {
    match status {
        200..=299 => Outcome::Delivered,
        404 | 410 => Outcome::Gone,
        408 | 425 | 429 | 500..=599 => Outcome::Retry {
            reason: format!("push service answered {status}"),
            after: retry_after.map(|after| after.min(Duration::from_secs(60 * 60))),
        },
        _ => Outcome::Rejected {
            reason: format!("push service refused with {status}"),
        },
    }
}

/// `Retry-After` as seconds. The HTTP-date form is ignored — no push service
/// sends it, and a parser for it would be more code than the feature is worth.
pub fn parse_retry_after(value: Option<&str>) -> Option<Duration> {
    value?.trim().parse::<u64>().ok().map(Duration::from_secs)
}

// ── Sending ────────────────────────────────────────────────────────────────

/// What came back from a push service: enough to classify, nothing more.
#[derive(Clone, Debug)]
pub struct TransportResponse {
    pub status: u16,
    pub retry_after: Option<Duration>,
}

/// The seam between building a push and putting it on the wire.
///
/// Production is `ReqwestTransport`. The integration test uses the same one
/// against a local server playing the push service, so the encryption is
/// proven by something decrypting it; the trait is here so a test can also
/// stand in a transport that answers without a socket.
#[async_trait::async_trait]
pub trait PushTransport: Send + Sync {
    async fn send(&self, request: http::Request<Vec<u8>>) -> Result<TransportResponse, String>;
}

pub struct ReqwestTransport {
    client: reqwest::Client,
}

impl ReqwestTransport {
    pub fn new() -> Result<Self, AppError> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(5))
            // A push service answers; it does not send us elsewhere. Following
            // a redirect would undo the host allow-list above.
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| AppError::Configuration(format!("push http client: {error}")))?;
        Ok(Self { client })
    }
}

#[async_trait::async_trait]
impl PushTransport for ReqwestTransport {
    async fn send(&self, request: http::Request<Vec<u8>>) -> Result<TransportResponse, String> {
        let request = reqwest::Request::try_from(request)
            .map_err(|error| format!("could not build the request: {error}"))?;
        let response = self.client.execute(request).await.map_err(|error| {
            // Without the URL: reqwest's Display includes it, and it is the
            // capability.
            let error = error.without_url();
            if error.is_timeout() {
                "push service did not answer in time".to_owned()
            } else if error.is_connect() {
                "could not connect to the push service".to_owned()
            } else {
                format!("push request failed: {error}")
            }
        })?;
        let retry_after = parse_retry_after(
            response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok()),
        );
        Ok(TransportResponse {
            status: response.status().as_u16(),
            retry_after,
        })
    }
}

/// Encrypt one message to one browser and sign it: the request a push
/// service is sent.
pub fn build_request(
    vapid: &VapidKeys,
    endpoint: &str,
    p256dh: &str,
    auth: &str,
    message: &PushMessage,
    now_unix: i64,
) -> Result<http::Request<Vec<u8>>, String> {
    let url = reqwest::Url::parse(endpoint).map_err(|_| "endpoint is not a URL".to_owned())?;
    let uri: http::Uri = endpoint
        .parse()
        .map_err(|_| "endpoint is not a URI".to_owned())?;
    let ua_public = p256::PublicKey::from_sec1_bytes(
        &decode_base64url(p256dh).map_err(|_| "subscription key is not base64url".to_owned())?,
    )
    .map_err(|_| "subscription key is not a P-256 point".to_owned())?;
    let auth = decode_base64url(auth).map_err(|_| "auth secret is not base64url".to_owned())?;
    if auth.len() != 16 {
        return Err("auth secret is not 16 bytes".into());
    }
    let payload = message.to_bytes().map_err(|error| error.to_string())?;
    let mut request = web_push_native::WebPushBuilder::new(
        uri,
        ua_public,
        web_push_native::Auth::clone_from_slice(&auth),
    )
    .with_valid_duration(DELIVERY_TTL)
    .build(payload)
    .map_err(|error| format!("could not encrypt: {error}"))?;
    let headers = request.headers_mut();
    let authorization = vapid.authorization(&url, now_unix)?;
    headers.insert(
        http::header::AUTHORIZATION,
        http::HeaderValue::from_str(&authorization)
            .map_err(|_| "authorization header is not valid".to_owned())?,
    );
    // Somebody must decide or do something: that is what 0046 says a
    // notification is. `high` is what lets Android deliver it to a phone in
    // Doze rather than at the next maintenance window.
    headers.insert("urgency", http::HeaderValue::from_static("high"));
    // A retry replaces an undelivered earlier copy of the same notification
    // at the push service rather than queueing a second one. The simple form
    // of a UUID is 32 characters of the base64url alphabet, which is exactly
    // what RFC 8030 §5.4 allows.
    if let Ok(topic) = http::HeaderValue::from_str(&message.notification_id.simple().to_string())
    {
        headers.insert("topic", topic);
    }
    Ok(request)
}

// ── The worker ─────────────────────────────────────────────────────────────

/// What one pass did, for the log and for tests.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DrainReport {
    pub delivered: u32,
    pub gone: u32,
    pub retried: u32,
    pub dropped: u32,
    pub skipped: u32,
}

impl DrainReport {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// Deliveries claimed per pass, and how many are in flight at once. A batch
/// is a burst of one notification to a department; eight at a time keeps one
/// slow push service from holding the rest.
const BATCH: i64 = 64;
const CONCURRENCY: usize = 8;

pub struct PushAgent {
    pool: PgPool,
    vapid: Option<Arc<VapidKeys>>,
    transport: Arc<dyn PushTransport>,
}

impl PushAgent {
    pub fn new(
        pool: PgPool,
        vapid: Option<Arc<VapidKeys>>,
        transport: Arc<dyn PushTransport>,
    ) -> Self {
        Self {
            pool,
            vapid,
            transport,
        }
    }

    /// Send everything that is due, once.
    ///
    /// With push switched off this only forgets what has gone stale: the
    /// trigger still queues for subscriptions made while it was on, and a
    /// queue nobody drains must not grow for ever.
    pub async fn drain_once(&self) -> Result<DrainReport, AppError> {
        let mut report = DrainReport::default();
        report.skipped += infrastructure::prune_push_deliveries(&self.pool, DELIVERY_TTL).await?;
        let Some(vapid) = self.vapid.clone() else {
            return Ok(report);
        };
        let due = infrastructure::claim_push_deliveries(&self.pool, BATCH).await?;
        if due.is_empty() {
            return Ok(report);
        }
        let now_unix = chrono::Utc::now().timestamp();
        use futures_util::StreamExt as _;
        let results: Vec<Result<Step, AppError>> = futures_util::stream::iter(due)
            .map(|delivery| {
                let vapid = vapid.clone();
                async move { self.deliver(&vapid, delivery, now_unix).await }
            })
            .buffer_unordered(CONCURRENCY)
            .collect()
            .await;
        for result in results {
            match result? {
                Step::Delivered => report.delivered += 1,
                Step::Gone => report.gone += 1,
                Step::Retried => report.retried += 1,
                Step::Dropped => report.dropped += 1,
                Step::Skipped => report.skipped += 1,
            }
        }
        Ok(report)
    }

    async fn deliver(
        &self,
        vapid: &VapidKeys,
        delivery: infrastructure::DuePushDelivery,
        now_unix: i64,
    ) -> Result<Step, AppError> {
        // Dealt with on another device, the person has left, or the recipient
        // row is gone: nothing to wake a phone for.
        if delivery.read || !delivery.recipient_active || !delivery.still_a_recipient {
            infrastructure::push_delivery_done(&self.pool, delivery.delivery_id).await?;
            return Ok(Step::Skipped);
        }
        let host = endpoint_host(&delivery.endpoint);
        let message = PushMessage::new(
            delivery.notification_id,
            &delivery.kind,
            &delivery.title,
            &delivery.body,
            delivery.subject_kind.clone(),
            delivery.subject_id.clone(),
        );
        let request = match build_request(
            vapid,
            &delivery.endpoint,
            &delivery.p256dh,
            &delivery.auth,
            &message,
            now_unix,
        ) {
            Ok(request) => request,
            Err(reason) => {
                // The stored keys cannot be used: no retry will change that.
                warn!(subscription = %delivery.subscription_id, %host, %reason, "push not built");
                infrastructure::push_delivery_failed(
                    &self.pool,
                    &delivery,
                    &reason,
                    MAX_SUBSCRIPTION_FAILURES,
                )
                .await?;
                return Ok(Step::Dropped);
            }
        };
        let outcome = match self.transport.send(request).await {
            Ok(response) => classify(response.status, response.retry_after),
            Err(reason) => Outcome::Retry {
                reason,
                after: None,
            },
        };
        match outcome {
            Outcome::Delivered => {
                infrastructure::push_delivered(&self.pool, &delivery).await?;
                Ok(Step::Delivered)
            }
            Outcome::Gone => {
                info!(subscription = %delivery.subscription_id, %host, "push subscription expired; removed");
                infrastructure::push_subscription_gone(&self.pool, delivery.subscription_id)
                    .await?;
                Ok(Step::Gone)
            }
            Outcome::Retry { reason, after } => {
                match after.or_else(|| retry_delay(delivery.attempts)) {
                    Some(wait) if delivery.attempts < MAX_ATTEMPTS => {
                        warn!(
                            subscription = %delivery.subscription_id,
                            %host,
                            attempt = delivery.attempts,
                            seconds = wait.as_secs(),
                            %reason,
                            "push will be retried"
                        );
                        infrastructure::push_delivery_retry(
                            &self.pool,
                            delivery.delivery_id,
                            wait,
                            &reason,
                        )
                        .await?;
                        Ok(Step::Retried)
                    }
                    _ => {
                        warn!(subscription = %delivery.subscription_id, %host, %reason, "push given up");
                        infrastructure::push_delivery_failed(
                            &self.pool,
                            &delivery,
                            &reason,
                            MAX_SUBSCRIPTION_FAILURES,
                        )
                        .await?;
                        Ok(Step::Dropped)
                    }
                }
            }
            Outcome::Rejected { reason } => {
                warn!(subscription = %delivery.subscription_id, %host, %reason, "push refused");
                infrastructure::push_delivery_failed(
                    &self.pool,
                    &delivery,
                    &reason,
                    MAX_SUBSCRIPTION_FAILURES,
                )
                .await?;
                Ok(Step::Dropped)
            }
        }
    }

    /// Drain every `interval`, for as long as the process lives.
    pub async fn run(self, interval: Duration) {
        let mut ticker = tokio::time::interval(interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut last_beat: Option<std::time::Instant> = None;
        loop {
            ticker.tick().await;
            let drained = self.drain_once().await;
            // The fleet page's "notifications & push" (`fleet_job_beat`): a
            // beat a minute is plenty for a loop that runs every two seconds.
            if drained.is_err() || last_beat.is_none_or(|at| at.elapsed() >= Duration::from_secs(60)) {
                infrastructure::fleet_job_beat(
                    &self.pool,
                    infrastructure::JOB_PUSH,
                    drained.as_ref().err().map(ToString::to_string).as_deref(),
                )
                .await;
                last_beat = Some(std::time::Instant::now());
            }
            match drained {
                Ok(report) if report.is_empty() => {}
                Ok(report) => info!(
                    delivered = report.delivered,
                    gone = report.gone,
                    retried = report.retried,
                    dropped = report.dropped,
                    skipped = report.skipped,
                    "web push pass"
                ),
                Err(error) => tracing::error!(%error, "web push pass failed"),
            }
        }
    }
}

enum Step {
    Delivered,
    Gone,
    Retried,
    Dropped,
    Skipped,
}

/// Say at startup whether this process pushes, and start the worker.
///
/// The worker runs either way — see `drain_once` for what it does when off.
pub fn spawn_agent(pool: PgPool) {
    let settings = settings();
    match (&settings.vapid, &settings.disabled_reason) {
        (Some(vapid), _) => info!(subject = %vapid.subject(), "web push enabled"),
        (None, Some(reason)) => info!("{reason}"),
        (None, None) => {}
    }
    let transport: Arc<dyn PushTransport> = match ReqwestTransport::new() {
        Ok(transport) => Arc::new(transport),
        Err(error) => {
            tracing::error!(%error, "web push disabled: no http client");
            return;
        }
    };
    let agent = PushAgent::new(pool, settings.vapid.clone(), transport);
    tokio::spawn(agent.run(Duration::from_secs(2)));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys() -> VapidKeys {
        VapidKeys::generate("mailto:ops@example.com")
    }

    #[test]
    fn a_generated_key_reads_back_to_the_same_public_key() {
        let original = keys();
        let again = VapidKeys::from_config(
            &original.private_key_base64url(),
            "mailto:ops@example.com",
            Some(original.public_key()),
        )
        .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(again.public_key(), original.public_key());
        // 65-byte uncompressed point: 87 characters unpadded, starting 0x04.
        assert_eq!(original.public_key().len(), 87);
        assert!(original.public_key().starts_with('B'));
    }

    #[test]
    fn a_public_key_from_another_pair_is_refused() {
        let one = keys();
        let other = keys();
        let error = VapidKeys::from_config(
            &one.private_key_base64url(),
            "mailto:ops@example.com",
            Some(other.public_key()),
        )
        .err()
        .unwrap_or_default();
        assert!(error.contains("does not belong"), "{error}");
    }

    #[test]
    fn padding_and_the_standard_alphabet_are_forgiven() {
        let one = keys();
        let padded = format!("{}=", one.private_key_base64url())
            .replace('-', "+")
            .replace('_', "/");
        assert!(VapidKeys::from_config(&padded, "mailto:ops@example.com", None).is_ok());
    }

    #[test]
    fn missing_or_broken_configuration_switches_push_off_and_says_why() {
        let none = PushSettings::from_values(None, None, None);
        assert!(none.vapid.is_none());
        assert!(none
            .disabled_reason
            .as_deref()
            .unwrap_or_default()
            .contains("not configured"));

        let no_subject = PushSettings::from_values(Some("abc"), None, Some("  "));
        assert!(no_subject.vapid.is_none());
        assert!(no_subject
            .disabled_reason
            .as_deref()
            .unwrap_or_default()
            .contains("WEB_PUSH_SUBJECT is not"));

        let garbage = PushSettings::from_values(Some("!!!"), None, Some("mailto:a@b.c"));
        let reason = garbage.disabled_reason.unwrap_or_default();
        assert!(reason.contains("not base64url"), "{reason}");
        // The key itself is never repeated back.
        assert!(!reason.contains("!!!"));

        let bad_subject =
            PushSettings::from_values(Some(&keys().private_key_base64url()), None, Some("ops"));
        assert!(bad_subject.vapid.is_none());

        let good = PushSettings::from_values(
            Some(&keys().private_key_base64url()),
            None,
            Some("mailto:ops@example.com"),
        );
        assert!(good.vapid.is_some() && good.disabled_reason.is_none());
    }

    #[test]
    fn the_debug_form_of_a_key_does_not_carry_the_private_half() {
        let one = keys();
        let printed = format!("{one:?}");
        assert!(!printed.contains(&one.private_key_base64url()));
    }

    #[test]
    fn the_vapid_token_is_an_es256_jwt_for_the_services_origin() {
        let one = keys();
        let endpoint = reqwest::Url::parse("https://fcm.googleapis.com/fcm/send/abc:def")
            .unwrap_or_else(|error| panic!("{error}"));
        let header = one
            .authorization(&endpoint, 1_700_000_000)
            .unwrap_or_else(|error| panic!("{error}"));
        let (token, key) = header
            .strip_prefix("vapid t=")
            .and_then(|rest| rest.split_once(", k="))
            .unwrap_or_else(|| panic!("shape: {header}"));
        assert_eq!(key, one.public_key());
        let parts: Vec<&str> = token.split('.').collect();
        assert_eq!(parts.len(), 3);
        let claims: serde_json::Value = serde_json::from_slice(
            &decode_base64url(parts[1]).unwrap_or_else(|error| panic!("{error}")),
        )
        .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(claims["aud"], "https://fcm.googleapis.com");
        assert_eq!(claims["sub"], "mailto:ops@example.com");
        assert_eq!(claims["exp"], 1_700_000_000i64 + 12 * 3600);

        // And the signature verifies against the public key it names.
        use p256::ecdsa::{signature::Verifier, VerifyingKey};
        let verifying = VerifyingKey::from_sec1_bytes(
            &decode_base64url(key).unwrap_or_else(|error| panic!("{error}")),
        )
        .unwrap_or_else(|error| panic!("{error}"));
        let signature = Signature::from_slice(
            &decode_base64url(parts[2]).unwrap_or_else(|error| panic!("{error}")),
        )
        .unwrap_or_else(|error| panic!("{error}"));
        assert!(verifying
            .verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &signature)
            .is_ok());
    }

    #[test]
    fn only_https_endpoints_on_known_push_services_are_accepted() {
        for good in [
            "https://fcm.googleapis.com/fcm/send/eXampLe:APA91b",
            "https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB",
            "https://web.push.apple.com/QGuQyavXutnMH",
            "https://wns2-sg2p.notify.windows.com/w/?token=BQYAAA",
        ] {
            assert!(validate_endpoint(good).is_ok(), "{good}");
        }
        for bad in [
            "http://fcm.googleapis.com/fcm/send/x",
            "https://10.0.0.5/admin",
            "https://localhost/push",
            "https://fcm.googleapis.com.evil.example/x",
            "https://notify.windows.com/x",
            "https://user:pw@fcm.googleapis.com/x",
            "https://fcm.googleapis.com:8443/x",
            "not a url",
        ] {
            assert!(validate_endpoint(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_log_line_gets_the_host_and_never_the_path() {
        assert_eq!(
            endpoint_host("https://fcm.googleapis.com/fcm/send/secret-token"),
            "fcm.googleapis.com"
        );
    }

    #[test]
    fn long_sentences_are_clipped_at_a_character_and_the_payload_stays_small() {
        assert_eq!(clip("  pendek  ", 10), "pendek");
        let clipped = clip(&"é".repeat(50), 10);
        assert_eq!(clipped.chars().count(), 10);
        assert!(clipped.ends_with('…'));

        // The worst case: every character four bytes, every field at its cap.
        let wide = "𝄞".repeat(5_000);
        let message = PushMessage::new(
            Uuid::new_v4(),
            &wide,
            &wide,
            &wide,
            Some("purchase_order".into()),
            Some(Uuid::new_v4().to_string()),
        );
        let bytes = message.to_bytes().unwrap_or_else(|error| panic!("{error}"));
        assert!(bytes.len() <= PAYLOAD_BUDGET, "{}", bytes.len());
    }

    #[test]
    fn the_payload_is_the_sentence_and_where_to_go_and_nothing_else() {
        let id = Uuid::new_v4();
        let message = PushMessage::new(
            id,
            "purchase.price_amendment.requested",
            "Harga PO-1183 diminta berubah",
            "Pemasok meminta Rp 215.000 per potong.",
            Some("purchase_price_amendment".into()),
            Some("abc".into()),
        );
        let value: serde_json::Value = serde_json::from_slice(
            &message.to_bytes().unwrap_or_else(|error| panic!("{error}")),
        )
        .unwrap_or_else(|error| panic!("{error}"));
        let mut keys: Vec<&str> = value
            .as_object()
            .map(|object| object.keys().map(String::as_str).collect())
            .unwrap_or_default();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "body",
                "kind",
                "notification_id",
                "subject_id",
                "subject_kind",
                "title",
                "url",
                "v"
            ]
        );
        assert_eq!(value["url"], NOTIFICATION_LIST_URL);
    }

    #[test]
    fn a_subject_that_is_not_a_record_id_is_left_out() {
        let message = PushMessage::new(
            Uuid::new_v4(),
            "activity",
            "t",
            "b",
            Some("bill".into()),
            Some("x".repeat(500)),
        );
        assert_eq!(message.subject_kind, None);
        assert_eq!(message.subject_id, None);
    }

    #[test]
    fn retries_back_off_and_then_stop() {
        let delays: Vec<Option<u64>> = (1..=7)
            .map(|attempt| retry_delay(attempt).map(|delay| delay.as_secs()))
            .collect();
        assert_eq!(
            delays,
            [
                Some(30),
                Some(120),
                Some(600),
                Some(1_800),
                Some(7_200),
                None,
                None
            ]
        );
        // Every retry lands inside the window in which the push is still worth
        // sending.
        let total: u64 = (1..MAX_ATTEMPTS)
            .filter_map(retry_delay)
            .map(|d| d.as_secs())
            .sum();
        assert!(total < DELIVERY_TTL.as_secs());
    }

    #[test]
    fn a_push_services_answer_is_read_the_way_rfc_8030_means_it() {
        assert_eq!(classify(201, None), Outcome::Delivered);
        assert_eq!(classify(404, None), Outcome::Gone);
        assert_eq!(classify(410, None), Outcome::Gone);
        assert!(matches!(classify(429, None), Outcome::Retry { .. }));
        assert!(matches!(classify(503, None), Outcome::Retry { .. }));
        assert!(matches!(classify(400, None), Outcome::Rejected { .. }));
        assert!(matches!(classify(403, None), Outcome::Rejected { .. }));
        assert!(matches!(classify(413, None), Outcome::Rejected { .. }));
        // A service asking for a day is held to an hour.
        assert_eq!(
            classify(429, Some(Duration::from_secs(86_400))),
            Outcome::Retry {
                reason: "push service answered 429".into(),
                after: Some(Duration::from_secs(3_600)),
            }
        );
        assert_eq!(parse_retry_after(Some(" 120 ")), Some(Duration::from_secs(120)));
        assert_eq!(
            parse_retry_after(Some("Wed, 21 Oct 2015 07:28:00 GMT")),
            None
        );
    }

    #[test]
    fn a_built_request_decrypts_to_the_message_for_the_browser_it_was_for() {
        let vapid = keys();
        let browser = random_secret_key();
        let p256dh = {
            use p256::elliptic_curve::sec1::ToEncodedPoint;
            URL_SAFE_NO_PAD.encode(browser.public_key().to_encoded_point(false).as_bytes())
        };
        let auth = URL_SAFE_NO_PAD.encode([7u8; 16]);
        let message = PushMessage::new(Uuid::new_v4(), "activity", "Judul", "Isi", None, None);
        let request = build_request(
            &vapid,
            "https://fcm.googleapis.com/fcm/send/abc",
            &p256dh,
            &auth,
            &message,
            1_700_000_000,
        )
        .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(request.headers()["content-encoding"], "aes128gcm");
        assert_eq!(request.headers()["ttl"], "86400");
        assert_eq!(request.headers()["urgency"], "high");
        assert_eq!(
            request.headers()["topic"],
            message.notification_id.simple().to_string().as_str()
        );
        let clear = web_push_native::decrypt(
            request.body().clone(),
            &browser,
            &web_push_native::Auth::clone_from_slice(&[7u8; 16]),
        )
        .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(
            clear,
            message.to_bytes().unwrap_or_else(|error| panic!("{error}"))
        );
        assert!(request.body().len() < 4096);
    }
}
