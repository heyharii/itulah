//! Revocable opaque-session authentication and the /api/v1/auth/* handlers.
//!
//! Design constraints this module owns:
//! - Verification is fully local to this node's user/session tables.
//! - Authentication is required by default. Explicit
//!   INVENTORY_AUTH_MODE=disabled is development-only and is reported by the
//!   health endpoint plus a boot warning.
//! - `actor_id` in any request body must match the authenticated principal:
//!   the audit trail is only worth keeping when nobody can write someone
//!   else's name into it.

use crate::cloud::{
    application::{
        AppError, AppState, ChangePasswordRequest, CreateUserRequest, RegisterRfidDeviceRequest,
        ResetPasswordRequest, SetEdgeAssignmentActiveRequest, SetRfidDeviceActiveRequest,
        SetUserActiveRequest, SetUserRoleRequest, UpsertEdgeAssignmentRequest,
    },
    domain::{required_role, role_allows, Role},
    postgres as infrastructure,
};
use crate::contract::{CloudMe, LoginRequest, LoginResponse, SessionUser};
use crate::security::{self, CSRF_COOKIE, SESSION_COOKIE};
use axum::{
    body::{to_bytes, Body},
    extract::{Path, Request, State},
    http::{header, HeaderValue},
    middleware::Next,
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

/// Request bodies are already capped by the router's `DefaultBodyLimit`; this
/// is the middleware's own ceiling when buffering a body to check actor_id.
const MAX_BUFFERED_BODY_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct Principal {
    pub session_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: Role,
    pub authenticated_with_cookie: bool,
}

/// Paths that must stay reachable without a token: liveness, login itself,
/// the machine-to-machine sync ingest (guarded by x-sync-key), and metrics
/// scraping.
fn is_public(path: &str) -> bool {
    matches!(
        path,
        "/api/v1/health" | "/api/v1/auth/login" | "/api/v1/sync/ingest" | "/metrics"
    )
}

pub async fn require_auth(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, AppError> {
    if state.config.jwt_secret.is_none() {
        // Auth disabled is development-only, but handlers must still receive a
        // truthful server-owned actor rather than accepting actor_id from a
        // request body.
        request.extensions_mut().insert(Principal {
            session_id: Uuid::nil(),
            username: "development".to_owned(),
            display_name: "Development".to_owned(),
            role: Role::Admin,
            authenticated_with_cookie: false,
        });
        return Ok(next.run(request).await);
    }
    let path = request.uri().path().to_owned();
    if !path.starts_with("/api/") || is_public(&path) {
        return Ok(next.run(request).await);
    }

    let bearer = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let cookie = request
        .headers()
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| security::cookie_value(value, SESSION_COOKIE));
    let (token, authenticated_with_cookie) = match (bearer, cookie) {
        (Some(token), _) if !token.is_empty() => (token.to_string(), false),
        (_, Some(token)) if !token.is_empty() => (token, true),
        _ => return Err(AppError::Unauthorized("missing session".into())),
    };
    let session = infrastructure::authenticate_session(
        &state.db,
        &token,
        state.config.auth_session_idle_minutes,
    )
    .await?;
    let role = session.role;

    let method = request.method().as_str().to_owned();
    let needed = required_role(&method, &path);
    if !role_allows(needed, role) {
        return Err(AppError::Forbidden(format!(
            "this action requires the {needed} role"
        )));
    }

    if authenticated_with_cookie && !matches!(request.method().as_str(), "GET" | "HEAD" | "OPTIONS")
    {
        let header_token = request
            .headers()
            .get("x-csrf-token")
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| AppError::Forbidden("missing CSRF token".into()))?;
        let cookie_token = request
            .headers()
            .get(header::COOKIE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| security::cookie_value(value, CSRF_COOKIE))
            .ok_or_else(|| AppError::Forbidden("missing CSRF cookie".into()))?;
        if !security::constant_time_eq(header_token, &cookie_token)
            || !security::constant_time_eq(
                &security::sha256_hex(header_token),
                &session.csrf_token_sha256,
            )
        {
            return Err(AppError::Forbidden("invalid CSRF token".into()));
        }
    }

    let principal = Principal {
        session_id: session.session_id,
        username: session.username,
        display_name: session.display_name,
        role,
        authenticated_with_cookie,
    };

    // Enforce a truthful audit trail: a JSON body carrying actor_id must name
    // the authenticated principal. The body is buffered and re-attached
    // unchanged so idempotency digests still cover the exact bytes sent.
    let request = if method != "GET" && method != "HEAD" {
        let (parts, body) = request.into_parts();
        let bytes = to_bytes(body, MAX_BUFFERED_BODY_BYTES)
            .await
            .map_err(|_| AppError::Validation("request body too large".into()))?;
        if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
            if let Some(actor) = value.get("actor_id").and_then(Value::as_str) {
                if actor != principal.username {
                    return Err(AppError::Forbidden(format!(
                        "actor_id '{actor}' must match the authenticated user '{}'",
                        principal.username
                    )));
                }
            }
        }
        let mut request = Request::from_parts(parts, Body::from(bytes));
        request.extensions_mut().insert(principal);
        request
    } else {
        let mut request = request;
        request.extensions_mut().insert(principal);
        request
    };
    Ok(next.run(request).await)
}

pub async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Response, AppError> {
    if state.config.jwt_secret.is_none() {
        return Err(AppError::Conflict(
            "authentication is not enabled on this node".into(),
        ));
    }
    let user =
        infrastructure::authenticate_user(&state.db, &request.username, &request.password).await?;
    let issued =
        infrastructure::create_session(&state.db, &user, state.config.auth_token_ttl_minutes)
            .await?;
    let max_age = state.config.auth_token_ttl_minutes.max(1) * 60;
    // Both cookies are formatted before the body takes ownership of the token.
    let session_cookie = security::set_cookie(
        SESSION_COOKIE,
        &issued.token,
        max_age,
        state.config.auth_cookie_secure,
        true,
    );
    let csrf_cookie = security::set_cookie(
        CSRF_COOKIE,
        &issued.csrf_token,
        max_age,
        state.config.auth_cookie_secure,
        false,
    );
    let mut response = Json(LoginResponse {
        // Native/CLI clients may use the same opaque value as a Bearer token.
        // The browser ignores it and relies on the HttpOnly cookie below.
        token: issued.token,
        token_type: "Bearer".to_owned(),
        expires_at_epoch: issued.expires_at.timestamp(),
        user: SessionUser {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            role: user.role.into(),
            // Cloud has one identity store, so there is nothing to name.
            source: None,
        },
    })
    .into_response();
    prevent_auth_caching(&mut response);
    append_cookie(&mut response, session_cookie)?;
    append_cookie(&mut response, csrf_cookie)?;
    Ok(response)
}

pub async fn me(Extension(principal): Extension<Principal>) -> Json<CloudMe> {
    Json(CloudMe {
        username: principal.username,
        display_name: principal.display_name,
        role: principal.role.into(),
    })
}

pub async fn logout(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Response, AppError> {
    infrastructure::revoke_session_id(&state.db, principal.session_id).await?;
    cleared_session_response(&state, json!({"signed_out":true}))
}

pub async fn change_password(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<ChangePasswordRequest>,
) -> Result<Response, AppError> {
    let value = infrastructure::change_password(&state.db, &principal.username, request).await?;
    cleared_session_response(&state, value)
}

/// Administrator-only: set a password for a user who cannot supply their old
/// one. Reachable only by an Admin — `required_role` puts every
/// `/api/v1/auth/users` path behind that role.
pub async fn reset_password(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<ResetPasswordRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::admin_reset_password(&state.db, id, request, &principal.username).await?,
    ))
}

/// Administrator-only: promote or demote somebody at Cloud. Does not touch
/// their role at any Edge — that lives on the Edge assignment.
pub async fn set_user_role(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<SetUserRoleRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::set_user_role(&state.db, id, request, &principal.username).await?,
    ))
}

pub async fn list_users(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::list_users(&state.db).await?))
}

pub async fn create_user(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<CreateUserRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::create_user(&state.db, request, &principal.username).await?,
    ))
}

pub async fn set_user_active(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(user_id): Path<Uuid>,
    Json(request): Json<SetUserActiveRequest>,
) -> Result<Json<Value>, AppError> {
    let user =
        infrastructure::set_user_active(&state.db, user_id, request.active, &principal.username)
            .await?;
    let policies =
        infrastructure::publish_auth_policies_for_user(&state.db, user_id, &principal.username)
            .await?;
    Ok(Json(json!({"user":user,"policies":policies})))
}

pub async fn edge_assignments(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::list_edge_assignments(&state.db).await?,
    ))
}

pub async fn upsert_edge_assignment(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<UpsertEdgeAssignmentRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::upsert_edge_assignment(&state.db, request, &principal.username).await?,
    ))
}

pub async fn set_edge_assignment_active(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((origin_id, user_id)): Path<(String, Uuid)>,
    Json(request): Json<SetEdgeAssignmentActiveRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::set_edge_assignment_active(
            &state.db,
            &origin_id,
            user_id,
            request,
            &principal.username,
        )
        .await?,
    ))
}

pub async fn rfid_devices(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::list_rfid_devices(&state.db).await?))
}

pub async fn register_rfid_device(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RegisterRfidDeviceRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::register_rfid_device(&state.db, request, &principal.username).await?,
    ))
}

pub async fn set_rfid_device_active(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(device_id): Path<String>,
    Json(request): Json<SetRfidDeviceActiveRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::set_rfid_device_active(&state.db, &device_id, request, &principal.username)
            .await?,
    ))
}

pub async fn rotate_rfid_device_key(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(device_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::rotate_rfid_device_key(&state.db, &device_id, &principal.username).await?,
    ))
}

pub async fn publish_edge_policy(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(origin_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::publish_auth_policy(&state.db, &origin_id, &principal.username).await?,
    ))
}

fn append_cookie(response: &mut Response, cookie: String) -> Result<(), AppError> {
    let value = HeaderValue::from_str(&cookie)
        .map_err(|error| AppError::Configuration(format!("invalid auth cookie: {error}")))?;
    response.headers_mut().append(header::SET_COOKIE, value);
    Ok(())
}

fn prevent_auth_caching(response: &mut Response) {
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, max-age=0"),
    );
    response
        .headers_mut()
        .insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
}

fn cleared_session_response(state: &AppState, value: Value) -> Result<Response, AppError> {
    let mut response = Json(value).into_response();
    prevent_auth_caching(&mut response);
    append_cookie(
        &mut response,
        security::clear_cookie(SESSION_COOKIE, state.config.auth_cookie_secure, true),
    )?;
    append_cookie(
        &mut response,
        security::clear_cookie(CSRF_COOKIE, state.config.auth_cookie_secure, false),
    )?;
    Ok(response)
}
