//! Local node user store: argon2id password hashes, role assignment, and the
//! one-time admin bootstrap. Identity is local to this node's database on
//! purpose — a store keeps authenticating cashiers with the network down.
//! When a cloud identity downlink exists, this table becomes its projection
//! target; nothing here assumes the credentials were minted locally.

use crate::cloud::application::{AppError, ChangePasswordRequest, CreateUserRequest};
use crate::cloud::domain::Role;
use crate::security;
use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::str::FromStr;
use uuid::Uuid;

const MIN_PASSWORD_LENGTH: usize = 8;
const LOGIN_FAILURE_LIMIT: i32 = 5;

#[derive(Clone, Debug)]
pub struct AuthenticatedUser {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: Role,
    pub auth_version: i64,
}

async fn hash_password(password: &str) -> Result<String, AppError> {
    let password = password.to_owned();
    tokio::task::spawn_blocking(move || security::hash_password(&password, MIN_PASSWORD_LENGTH))
        .await
        .map_err(|error| AppError::Configuration(format!("password worker failed: {error}")))?
        .map_err(AppError::Validation)
}

async fn password_matches(stored_hash: &str, password: &str) -> Result<bool, AppError> {
    let stored_hash = stored_hash.to_owned();
    let password = password.to_owned();
    tokio::task::spawn_blocking(move || security::password_matches(&stored_hash, &password))
        .await
        .map_err(|error| AppError::Configuration(format!("password worker failed: {error}")))
}

fn normalize_username(username: &str) -> Result<String, AppError> {
    security::normalize_username(username).map_err(AppError::Validation)
}

/// Hash an Edge-only PIN/password before placing its verifier in a signed
/// policy projection.  It is deliberately distinct from the Cloud password.
pub fn hash_edge_credential(password: &str) -> Result<String, AppError> {
    security::hash_password(password, MIN_PASSWORD_LENGTH).map_err(AppError::Validation)
}

/// Create the first ADMIN account on an empty user table. Runs at boot:
/// - table has users → no-op;
/// - INVENTORY_BOOTSTRAP_ADMIN_PASSWORD set → create `admin` with it;
/// - otherwise → loud warning explaining whether the node is locked or open.
pub async fn bootstrap_admin(
    pool: &PgPool,
    bootstrap_password: Option<&str>,
    auth_enabled: bool,
) -> Result<(), AppError> {
    let user_count: i64 = sqlx::query("SELECT count(*)::bigint count FROM app_user")
        .fetch_one(pool)
        .await?
        .get("count");
    if user_count > 0 {
        return Ok(());
    }
    match bootstrap_password {
        Some(password) => {
            let hash = hash_password(password).await?;
            sqlx::query(
                "INSERT INTO app_user(id,username,display_name,password_hash,role,created_by) \
                 VALUES($1,'admin','Administrator',$2,'ADMIN','bootstrap') \
                 ON CONFLICT (username) DO NOTHING",
            )
            .bind(Uuid::new_v4())
            .bind(hash)
            .execute(pool)
            .await?;
            tracing::info!("bootstrap admin user 'admin' created");
        }
        None if auth_enabled => {
            tracing::warn!(
                "auth is enabled but no users exist and INVENTORY_BOOTSTRAP_ADMIN_PASSWORD \
                 is unset — nobody can log in to this node"
            );
        }
        None => {
            tracing::warn!(
                "INVENTORY_AUTH_MODE=disabled — the API is running WITHOUT authentication"
            );
        }
    }
    Ok(())
}

/// Verify credentials against the local store. Failures are deliberately
/// indistinguishable (unknown user, wrong password, deactivated account) so
/// the login endpoint cannot be used to enumerate usernames.
pub async fn authenticate_user(
    pool: &PgPool,
    username: &str,
    password: &str,
) -> Result<AuthenticatedUser, AppError> {
    let denied = || AppError::Unauthorized("invalid username or password".into());
    let username = username.trim().to_ascii_lowercase();
    let row = sqlx::query(
        "SELECT id,username,display_name,password_hash,role,active,auth_version,
                login_blocked_until
         FROM app_user WHERE username=$1",
    )
    .bind(&username)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else {
        // Burn comparable time so a missing user is not observably faster.
        let _ = password_matches(
            "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            password,
        )
        .await?;
        return Err(denied());
    };
    let id: Uuid = row.get("id");
    let active: bool = row.get("active");
    let stored_hash: String = row.get("password_hash");
    let password_valid = password_matches(&stored_hash, password).await?;
    let blocked = row
        .get::<Option<DateTime<Utc>>, _>("login_blocked_until")
        .is_some_and(|until| until > Utc::now());
    if blocked {
        return Err(denied());
    }
    if !password_valid || !active {
        if active {
            sqlx::query(
                "UPDATE app_user SET
                     failed_login_count=CASE
                         WHEN failed_login_window_started_at>now()-interval '15 minutes'
                         THEN failed_login_count+1 ELSE 1 END,
                     failed_login_window_started_at=CASE
                         WHEN failed_login_window_started_at>now()-interval '15 minutes'
                         THEN failed_login_window_started_at ELSE now() END,
                     login_blocked_until=CASE
                         WHEN (CASE
                             WHEN failed_login_window_started_at>now()-interval '15 minutes'
                             THEN failed_login_count+1 ELSE 1 END)>=$2
                         THEN now()+interval '15 minutes' ELSE NULL END,
                     updated_at=now()
                 WHERE id=$1",
            )
            .bind(id)
            .bind(LOGIN_FAILURE_LIMIT)
            .execute(pool)
            .await?;
        }
        return Err(denied());
    }
    let role = Role::from_str(&row.get::<String, _>("role"))
        .map_err(|e| AppError::Configuration(e.to_string()))?;
    sqlx::query(
        "UPDATE app_user SET last_login_at=now(),failed_login_count=0,
                failed_login_window_started_at=NULL,login_blocked_until=NULL
         WHERE id=$1",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(AuthenticatedUser {
        id,
        username: row.get("username"),
        display_name: row.get("display_name"),
        role,
        auth_version: row.get("auth_version"),
    })
}

#[derive(Clone, Debug)]
pub struct IssuedSession {
    pub token: String,
    pub csrf_token: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone, Debug)]
pub struct SessionUser {
    pub session_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: Role,
    pub csrf_token_sha256: String,
}

pub async fn create_session(
    pool: &PgPool,
    user: &AuthenticatedUser,
    ttl_minutes: i64,
) -> Result<IssuedSession, AppError> {
    let token = security::random_token();
    let csrf_token = security::random_token();
    let expires_at = Utc::now() + Duration::minutes(ttl_minutes.max(1));
    sqlx::query(
        "INSERT INTO auth_session
             (session_id,token_sha256,csrf_token_sha256,user_id,auth_version,expires_at)
         VALUES($1,$2,$3,$4,$5,$6)",
    )
    .bind(Uuid::new_v4())
    .bind(security::sha256_hex(&token))
    .bind(security::sha256_hex(&csrf_token))
    .bind(user.id)
    .bind(user.auth_version)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok(IssuedSession {
        token,
        csrf_token,
        expires_at,
    })
}

/// Resolve an opaque session against current user state.  Deactivation,
/// password changes, role-version changes, absolute expiry, and idle expiry
/// all invalidate it without waiting for a self-contained token to expire.
pub async fn authenticate_session(
    pool: &PgPool,
    token: &str,
    idle_minutes: i64,
) -> Result<SessionUser, AppError> {
    let row = sqlx::query(
        "SELECT s.session_id,s.csrf_token_sha256,u.username,u.display_name,u.role
         FROM auth_session s
         JOIN app_user u ON u.id=s.user_id
         WHERE s.token_sha256=$1
           AND s.revoked_at IS NULL
           AND s.expires_at>now()
           AND s.last_seen_at>now()-make_interval(mins => $2::int)
           AND u.active
           AND u.auth_version=s.auth_version",
    )
    .bind(security::sha256_hex(token))
    .bind(idle_minutes.clamp(1, 24 * 60) as i32)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::Unauthorized("invalid or expired session".into()))?;
    let session_id: Uuid = row.get("session_id");
    sqlx::query("UPDATE auth_session SET last_seen_at=now() WHERE session_id=$1")
        .bind(session_id)
        .execute(pool)
        .await?;
    let role = Role::from_str(&row.get::<String, _>("role"))
        .map_err(|error| AppError::Configuration(error.to_string()))?;
    Ok(SessionUser {
        session_id,
        username: row.get("username"),
        display_name: row.get("display_name"),
        role,
        csrf_token_sha256: row.get("csrf_token_sha256"),
    })
}

pub async fn revoke_session(pool: &PgPool, token: &str) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE auth_session SET revoked_at=COALESCE(revoked_at,now()) WHERE token_sha256=$1",
    )
    .bind(security::sha256_hex(token))
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn revoke_session_id(pool: &PgPool, session_id: Uuid) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE auth_session SET revoked_at=COALESCE(revoked_at,now()) WHERE session_id=$1",
    )
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn create_user(
    pool: &PgPool,
    request: CreateUserRequest,
    created_by: &str,
) -> Result<Value, AppError> {
    let username = normalize_username(&request.username)?;
    let display_name = request.display_name.trim();
    if display_name.is_empty() || display_name.len() > 128 {
        return Err(AppError::Validation(
            "display_name must be 1-128 characters".into(),
        ));
    }
    let hash = hash_password(&request.password).await?;
    let id = Uuid::new_v4();
    let result = sqlx::query(
        "INSERT INTO app_user(id,username,display_name,password_hash,role,created_by) \
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (username) DO NOTHING",
    )
    .bind(id)
    .bind(&username)
    .bind(display_name)
    .bind(hash)
    .bind(request.role.as_str())
    .bind(created_by)
    .execute(pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "username '{username}' already exists"
        )));
    }
    Ok(json!({
        "id": id,
        "username": username,
        "display_name": display_name,
        "role": request.role.as_str(),
        "active": true
    }))
}

pub async fn list_users(pool: &PgPool) -> Result<Value, AppError> {
    let rows = sqlx::query(
        "SELECT id,username,display_name,role,active,created_by,created_at,last_login_at \
         FROM app_user ORDER BY username",
    )
    .fetch_all(pool)
    .await?;
    let items: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid,_>("id"),
                "username": row.get::<String,_>("username"),
                "display_name": row.get::<String,_>("display_name"),
                "role": row.get::<String,_>("role"),
                "active": row.get::<bool,_>("active"),
                "created_by": row.get::<String,_>("created_by"),
                "created_at": row.get::<DateTime<Utc>,_>("created_at"),
                "last_login_at": row.get::<Option<DateTime<Utc>>,_>("last_login_at"),
            })
        })
        .collect();
    Ok(json!({ "items": items }))
}

pub async fn set_user_active(
    pool: &PgPool,
    user_id: Uuid,
    active: bool,
    actor_username: &str,
) -> Result<Value, AppError> {
    // An admin cannot deactivate their own account: the node must always
    // retain at least one usable administrator.
    let row = sqlx::query("SELECT username FROM app_user WHERE id=$1")
        .bind(user_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("user".into()))?;
    let username: String = row.get("username");
    if !active && username == actor_username {
        return Err(AppError::Conflict(
            "cannot deactivate your own account".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE app_user SET active=$2,auth_version=auth_version+1,updated_at=now() WHERE id=$1",
    )
    .bind(user_id)
    .bind(active)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE auth_session SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(json!({ "id": user_id, "username": username, "active": active }))
}

pub async fn change_password(
    pool: &PgPool,
    username: &str,
    request: ChangePasswordRequest,
) -> Result<Value, AppError> {
    let row = sqlx::query("SELECT id,password_hash FROM app_user WHERE username=$1 AND active")
        .bind(username)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("user".into()))?;
    let stored_hash: String = row.get("password_hash");
    if !password_matches(&stored_hash, &request.current_password).await? {
        return Err(AppError::Unauthorized("current password is wrong".into()));
    }
    let new_hash = hash_password(&request.new_password).await?;
    let user_id = row.get::<Uuid, _>("id");
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE app_user
         SET password_hash=$2,auth_version=auth_version+1,updated_at=now(),
             failed_login_count=0,failed_login_window_started_at=NULL,
             login_blocked_until=NULL
         WHERE id=$1",
    )
    .bind(user_id)
    .bind(new_hash)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE auth_session SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(json!({ "username": username, "changed": true }))
}
