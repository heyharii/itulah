//! Inviting people by a link (0634): the handlers.
//!
//! Four are head office's (Admin, `required_role`'s `/api/v1/invitations`
//! prefix): inviting, listing, withdrawing and renewing. Two are public —
//! opening a join link and accepting it — because the person has no account
//! until they do; the token in the path is the credential (`auth::is_public`).
//!
//! # A link, and nothing sent
//!
//! No email, no WhatsApp: head office copies the link and hands it over
//! however it already talks to the person. The link is
//! `{origin}/join/{token}` — the origin from `INVENTORY_PUBLIC_ORIGIN` when
//! the deployment sets it, else the browser's own `Origin`, else its `Host`
//! — so it opens the hub the administrator is using.
//!
//! # Guessing
//!
//! A token is 32 random bytes, so guessing one is not a plan. What is guarded
//! is the shape of the answer and the rate: every unknown token gets the same
//! sentence, and a client that keeps presenting unknown tokens is told to
//! wait — the same posture `/auth/login` takes towards passwords.

use super::auth::{cloud_me, with_session_cookies, Principal};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{RecordKind, Role},
    postgres::{
        self as infrastructure, AcceptInvitationRequest, InvitationScope, InviteRequest,
        IssuedInvitation, IssuedInvitationList,
    },
};
use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use uuid::Uuid;

/// Where a join link points: the setting, else the browser's origin.
pub fn link_origin(headers: &HeaderMap, secure: bool) -> Result<String, AppError> {
    fn origin_shaped(value: &str) -> Option<String> {
        let value = value.trim().trim_end_matches('/');
        let rest = value
            .strip_prefix("https://")
            .or_else(|| value.strip_prefix("http://"))?;
        let host_ok = !rest.is_empty()
            && rest
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']'));
        host_ok.then(|| value.to_owned())
    }
    if let Some(origin) = std::env::var("INVENTORY_PUBLIC_ORIGIN")
        .ok()
        .as_deref()
        .and_then(origin_shaped)
    {
        return Ok(origin);
    }
    let header_value = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(',').next())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    if let Some(origin) = header_value(header::ORIGIN.as_str()).as_deref().and_then(origin_shaped) {
        return Ok(origin);
    }
    let host = header_value("x-forwarded-host").or_else(|| header_value(header::HOST.as_str()));
    let scheme = header_value("x-forwarded-proto")
        .filter(|proto| proto == "https" || proto == "http")
        .unwrap_or_else(|| if secure { "https" } else { "http" }.to_owned());
    host.and_then(|host| origin_shaped(&format!("{scheme}://{host}")))
        .ok_or_else(|| {
            AppError::Configuration(
                "cannot tell where the hub is served from to build the link; set \
                 INVENTORY_PUBLIC_ORIGIN"
                    .into(),
            )
        })
}

/// Invitations are head office's. Checked here as well as at the path, so a
/// `role_permission` override that lowered the path's rung (0472) cannot
/// hand inviting to a shop.
fn require_admin(principal: &Principal) -> Result<(), AppError> {
    if principal.role >= Role::Admin {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not invite people: that is head office's administrator's",
        principal.username
    )))
}

/// `POST /api/v1/invitations`.
pub async fn invite(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    headers: HeaderMap,
    Json(request): Json<InviteRequest>,
) -> Result<Response, AppError> {
    require_admin(&principal)?;
    let origin = link_origin(&headers, state.config.auth_cookie_secure)?;
    let minted = infrastructure::invite_people(&state.db, request, &principal.username).await?;
    let items: Vec<IssuedInvitation> = minted
        .into_iter()
        .map(|minted| minted.issued(&origin))
        .collect();
    let mut response = (StatusCode::CREATED, Json(IssuedInvitationList { items })).into_response();
    // A link is a credential until it is used: never cached.
    no_store(&mut response);
    Ok(response)
}

/// `GET /api/v1/invitations?status=&unit_id=`. Never a token.
pub async fn list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(scope): Query<InvitationScope>,
) -> Result<Json<infrastructure::InvitationList>, AppError> {
    require_admin(&principal)?;
    Ok(Json(infrastructure::list_invitations(&state.db, scope).await?))
}

/// `POST /api/v1/invitations/{id}/revoke`.
pub async fn revoke(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
) -> Result<Json<infrastructure::InvitationRow>, AppError> {
    require_admin(&principal)?;
    Ok(Json(
        infrastructure::revoke_invitation(&state.db, id, &principal.username).await?,
    ))
}

/// `POST /api/v1/invitations/{id}/renew`: a new link; the old one stops.
pub async fn renew(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, AppError> {
    require_admin(&principal)?;
    let origin = link_origin(&headers, state.config.auth_cookie_secure)?;
    let minted = infrastructure::renew_invitation(&state.db, id, &principal.username).await?;
    let mut response = Json(minted.issued(&origin)).into_response();
    no_store(&mut response);
    Ok(response)
}

// ── the public half ───────────────────────────────────────────────────────

/// Unknown tokens a client may present in a window before it is told to wait.
const MISSES_ALLOWED: usize = 20;
const MISS_WINDOW: Duration = Duration::from_secs(10 * 60);

/// Unknown tokens presented, by client, in the last window.
static MISSES: Mutex<Option<HashMap<String, Vec<Instant>>>> = Mutex::new(None);

/// Who is asking, as far as the proxy in front of us says; everybody who
/// comes without a proxy header shares one bucket.
fn client_of(headers: &HeaderMap) -> String {
    ["x-forwarded-for", "x-real-ip"]
        .iter()
        .find_map(|name| {
            headers
                .get(*name)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.split(',').next())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "direct".to_owned())
}

/// Has this client presented too many unknown tokens lately?
fn held_back(client: &str) -> bool {
    let Ok(mut guard) = MISSES.lock() else {
        return false;
    };
    let now = Instant::now();
    let map = guard.get_or_insert_with(HashMap::new);
    map.retain(|_, misses| {
        misses.retain(|at| now.duration_since(*at) < MISS_WINDOW);
        !misses.is_empty()
    });
    map.get(client)
        .is_some_and(|misses| misses.len() >= MISSES_ALLOWED)
}

fn missed(client: &str) {
    if let Ok(mut guard) = MISSES.lock() {
        guard
            .get_or_insert_with(HashMap::new)
            .entry(client.to_owned())
            .or_default()
            .push(Instant::now());
    }
}

fn wait_a_while() -> Response {
    let mut response = (
        StatusCode::TOO_MANY_REQUESTS,
        Json(json!({
            "error": "too many invitation links were tried from here; wait a few minutes and open the link you were given"
        })),
    )
        .into_response();
    no_store(&mut response);
    response
}

fn no_store(response: &mut Response) {
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-store, max-age=0"),
    );
}

/// Before answering for a token: refuse a client that has been guessing, and
/// count an unknown token against the client that sent it.
async fn screened(state: &AppState, headers: &HeaderMap, token: &str) -> Result<Option<Response>, AppError> {
    let client = client_of(headers);
    if held_back(&client) {
        return Ok(Some(wait_a_while()));
    }
    if !infrastructure::token_exists(&state.db, token).await? {
        missed(&client);
    }
    Ok(None)
}

/// `GET /api/v1/invitations/accept/{token}` — public. What the join page
/// shows: who is invited, as what, where, and by which company.
pub async fn preview(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Result<Response, AppError> {
    if let Some(refused) = screened(&state, &headers, &token).await? {
        return Ok(refused);
    }
    let preview = infrastructure::preview_invitation(&state.db, &token).await?;
    let mut response = Json(preview).into_response();
    no_store(&mut response);
    Ok(response)
}

/// `POST /api/v1/invitations/accept/{token}` — public. Choose a username, set
/// a password, and be signed in: the answer is `me`, with the session's
/// cookies, exactly as signing in answers.
pub async fn accept(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Json(request): Json<AcceptInvitationRequest>,
) -> Result<Response, AppError> {
    if state.config.jwt_secret.is_none() {
        return Err(AppError::Conflict(
            "authentication is not enabled on this node".into(),
        ));
    }
    if let Some(refused) = screened(&state, &headers, &token).await? {
        return Ok(refused);
    }
    let accepted = infrastructure::accept_invitation(
        &state.db,
        &token,
        request,
        state.config.auth_token_ttl_minutes,
    )
    .await?;

    // The activity log's line for it. The audit layer records nothing for a
    // call with no session behind it, and the path here carries the token,
    // so this is written by hand, without it.
    let entry = infrastructure::NewAudit {
        username: &accepted.username,
        display_name: &accepted.display_name,
        role: accepted.role.as_str(),
        method: "POST",
        path: "/api/v1/invitations/accept",
        status: 200,
        subject: Some((RecordKind::AppUser, accepted.user_id.to_string())),
        payload: json!({}),
    };
    if let Err(error) = infrastructure::record_audit(&state.db, entry).await {
        tracing::warn!(%error, "could not record an accepted invitation in the audit log");
    }

    let me = cloud_me(
        accepted.username.clone(),
        accepted.display_name.clone(),
        accepted.role,
        &accepted.job,
    );
    with_session_cookies(&state, Json(me).into_response(), &accepted.session)
}
