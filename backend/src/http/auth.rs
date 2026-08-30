//! JWT authentication middleware and the /api/v1/auth/* handlers.
//!
//! Design constraints this module owns:
//! - Verification is fully local (secret + user table live on this node), so
//!   a store keeps logging cashiers in with the network down.
//! - When no INVENTORY_JWT_SECRET is configured the API runs open — existing
//!   dev setups keep working — and the health endpoint plus a boot warning
//!   say so loudly.
//! - `actor_id` in any request body must match the authenticated principal:
//!   the audit trail is only worth keeping when nobody can write someone
//!   else's name into it.

use crate::{
    application::{
        AppError, AppState, ChangePasswordRequest, CreateUserRequest, LoginRequest,
        SetUserActiveRequest,
    },
    domain::{required_role, role_allows, Role},
    infrastructure,
};
use axum::{
    body::{to_bytes, Body},
    extract::{Path, Request, State},
    http::header,
    middleware::Next,
    response::Response,
    Extension, Json,
};
use chrono::Utc;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::str::FromStr;
use uuid::Uuid;

/// Request bodies are already capped by the router's `DefaultBodyLimit`; this
/// is the middleware's own ceiling when buffering a body to check actor_id.
const MAX_BUFFERED_BODY_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Claims {
    /// Username of the authenticated user.
    pub sub: String,
    pub role: String,
    pub exp: i64,
    pub iat: i64,
}

#[derive(Clone, Debug)]
pub struct Principal {
    pub username: String,
    pub role: Role,
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
    request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let Some(secret) = state.config.jwt_secret.clone() else {
        // Auth disabled: run open (dev mode). bootstrap_admin warned at boot.
        return Ok(next.run(request).await);
    };
    let path = request.uri().path().to_owned();
    if !path.starts_with("/api/") || is_public(&path) {
        return Ok(next.run(request).await);
    }

    let token = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::Unauthorized("missing bearer token".into()))?;
    let claims = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| AppError::Unauthorized("invalid or expired token".into()))?
    .claims;
    let role =
        Role::from_str(&claims.role).map_err(|_| AppError::Unauthorized("invalid role".into()))?;

    let method = request.method().as_str().to_owned();
    let needed = required_role(&method, &path);
    if !role_allows(needed, role) {
        return Err(AppError::Forbidden(format!(
            "this action requires the {needed} role"
        )));
    }

    let principal = Principal {
        username: claims.sub.clone(),
        role,
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

fn issue_token(state: &AppState, username: &str, role: Role) -> Result<(String, i64), AppError> {
    let secret = state
        .config
        .jwt_secret
        .as_deref()
        .ok_or_else(|| AppError::Conflict("authentication is not enabled on this node".into()))?;
    let now = Utc::now().timestamp();
    let exp = now + state.config.auth_token_ttl_minutes.max(1) * 60;
    let claims = Claims {
        sub: username.to_owned(),
        role: role.as_str().to_owned(),
        exp,
        iat: now,
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| AppError::Configuration(format!("token signing failed: {e}")))?;
    Ok((token, exp))
}

pub async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<Value>, AppError> {
    let user =
        infrastructure::authenticate_user(&state.db, &request.username, &request.password).await?;
    let (token, exp) = issue_token(&state, &user.username, user.role)?;
    Ok(Json(json!({
        "token": token,
        "token_type": "Bearer",
        "expires_at_epoch": exp,
        "user": {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "role": user.role.as_str(),
        }
    })))
}

pub async fn me(Extension(principal): Extension<Principal>) -> Json<Value> {
    Json(json!({
        "username": principal.username,
        "role": principal.role.as_str(),
    }))
}

pub async fn change_password(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<ChangePasswordRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::change_password(&state.db, &principal.username, request).await?,
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
    Ok(Json(
        infrastructure::set_user_active(&state.db, user_id, request.active, &principal.username)
            .await?,
    ))
}
