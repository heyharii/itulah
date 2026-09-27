//! Web Push over HTTP: the key a browser subscribes with, and saying yes or
//! no on this device.
//!
//! Three routes, all the signed-in person's own. There is still no route that
//! SENDS anything: a push is a notification, and notifications are raised by
//! the code that caused the work (see `http::notifications`). What a client
//! can do here is choose whether its own browser is woken for them.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{self as infrastructure, NewPushSubscription, PushSubscriptionReceipt},
    push,
};
use axum::{extract::State, http::HeaderMap, Extension, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Whether this server pushes, and the key to subscribe with when it does.
///
/// Answered 200 either way, with the reason in words when it is off: the
/// screen offering "turn on notifications" needs to know whether to offer it,
/// and an administrator reading the network tab needs to know why not.
#[derive(Debug, Serialize)]
pub struct PublicKeyAnswer {
    pub enabled: bool,
    /// Base64url, uncompressed P-256 — the browser's `applicationServerKey`.
    pub public_key: Option<String>,
    pub reason: Option<String>,
}

pub async fn public_key() -> Json<PublicKeyAnswer> {
    let settings = push::settings();
    Json(PublicKeyAnswer {
        enabled: settings.vapid.is_some(),
        public_key: settings
            .vapid
            .as_ref()
            .map(|keys| keys.public_key().to_owned()),
        reason: settings.disabled_reason.clone(),
    })
}

/// `PushSubscription.toJSON()` as a browser produces it, plus a label.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubscribeRequest {
    pub endpoint: String,
    /// Sent by every browser and null in all of them today; accepted so the
    /// client can post what it was given without reshaping it.
    #[serde(default, rename = "expirationTime")]
    pub _expiration_time: Option<Value>,
    pub keys: SubscriptionKeys,
    /// "Chrome on Android", written by the client so a list of devices can be
    /// read by the person who owns them.
    #[serde(default)]
    pub device_label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubscriptionKeys {
    pub p256dh: String,
    pub auth: String,
}

/// Check what a browser handed over before it is stored.
///
/// The endpoint against the push-service allow-list (`push::validate_endpoint`
/// says why), and the keys by decoding them: a key that does not decode would
/// be stored, fail every push, and cost the device ten notifications before
/// it was dropped.
fn check(request: &SubscribeRequest) -> Result<(), AppError> {
    push::validate_endpoint(&request.endpoint).map_err(AppError::Validation)?;
    let p256dh = push::decode_base64url(&request.keys.p256dh)
        .map_err(|_| AppError::Validation("keys.p256dh is not base64url".into()))?;
    p256::PublicKey::from_sec1_bytes(&p256dh)
        .map_err(|_| AppError::Validation("keys.p256dh is not a P-256 public key".into()))?;
    let auth = push::decode_base64url(&request.keys.auth)
        .map_err(|_| AppError::Validation("keys.auth is not base64url".into()))?;
    if auth.len() != 16 {
        return Err(AppError::Validation("keys.auth is not 16 bytes".into()));
    }
    Ok(())
}

/// Wake this browser for my notifications. Idempotent: the app calls it on
/// every open, so a browser that rotated its subscription is caught up.
pub async fn subscribe(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    headers: HeaderMap,
    Json(request): Json<SubscribeRequest>,
) -> Result<Json<PushSubscriptionReceipt>, AppError> {
    if push::settings().vapid.is_none() {
        return Err(AppError::Conflict(
            push::settings()
                .disabled_reason
                .clone()
                .unwrap_or_else(|| "Web Push is not configured on this server".into()),
        ));
    }
    check(&request)?;
    let label = request
        .device_label
        .as_deref()
        .map(|label| push::clip(label, 120))
        .filter(|label| !label.is_empty());
    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(|agent| push::clip(agent, 512));
    let receipt = infrastructure::upsert_push_subscription(
        &state.db,
        &principal.username,
        &NewPushSubscription {
            endpoint: request.endpoint.trim(),
            p256dh: request.keys.p256dh.trim(),
            auth: request.keys.auth.trim(),
            device_label: label.as_deref(),
            user_agent: user_agent.as_deref(),
        },
    )
    .await?;
    tracing::info!(
        user = %principal.username,
        subscription = %receipt.subscription_id,
        host = %push::endpoint_host(&request.endpoint),
        "push subscription registered"
    );
    Ok(Json(receipt))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnsubscribeRequest {
    pub endpoint: String,
}

/// Stop waking this browser. Called on sign-out and when the person turns it
/// off; `removed: false` is not an error — signing out twice is fine.
pub async fn unsubscribe(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<UnsubscribeRequest>,
) -> Result<Json<Value>, AppError> {
    let removed = infrastructure::delete_push_subscription(
        &state.db,
        &principal.username,
        request.endpoint.trim(),
    )
    .await?;
    Ok(Json(json!({ "removed": removed })))
}
