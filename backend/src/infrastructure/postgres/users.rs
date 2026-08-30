//! Local node user store: argon2id password hashes, role assignment, and the
//! one-time admin bootstrap. Identity is local to this node's database on
//! purpose — a store keeps authenticating cashiers with the network down.
//! When a cloud identity downlink exists, this table becomes its projection
//! target; nothing here assumes the credentials were minted locally.

use crate::application::{AppError, ChangePasswordRequest, CreateUserRequest};
use crate::domain::Role;
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::str::FromStr;
use uuid::Uuid;

const MIN_PASSWORD_LENGTH: usize = 8;

#[derive(Clone, Debug)]
pub struct AuthenticatedUser {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: Role,
}

fn hash_password(password: &str) -> Result<String, AppError> {
    if password.len() < MIN_PASSWORD_LENGTH {
        return Err(AppError::Validation(format!(
            "password must be at least {MIN_PASSWORD_LENGTH} characters"
        )));
    }
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| AppError::Configuration(format!("password hashing failed: {e}")))
}

fn password_matches(stored_hash: &str, password: &str) -> bool {
    PasswordHash::new(stored_hash)
        .map(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        })
        .unwrap_or(false)
}

fn normalize_username(username: &str) -> Result<String, AppError> {
    let username = username.trim().to_ascii_lowercase();
    let valid_chars = username
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if username.len() < 3 || username.len() > 32 || !valid_chars {
        return Err(AppError::Validation(
            "username must be 3-32 characters of a-z, 0-9, '.', '_' or '-'".into(),
        ));
    }
    Ok(username)
}

/// Create the first ADMIN account on an empty user table. Runs at boot:
/// - table has users → no-op;
/// - INVENTORY_BOOTSTRAP_ADMIN_PASSWORD set → create `admin` with it;
/// - otherwise → loud warning so an open node is never silent about it.
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
            let hash = hash_password(password)?;
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
                "INVENTORY_JWT_SECRET is unset — the API is running WITHOUT authentication"
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
        "SELECT id,username,display_name,password_hash,role,active FROM app_user WHERE username=$1",
    )
    .bind(&username)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else {
        // Burn comparable time so a missing user is not observably faster.
        let _ = password_matches(
            "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            password,
        );
        return Err(denied());
    };
    let active: bool = row.get("active");
    let stored_hash: String = row.get("password_hash");
    if !password_matches(&stored_hash, password) || !active {
        return Err(denied());
    }
    let role = Role::from_str(&row.get::<String, _>("role"))
        .map_err(|e| AppError::Configuration(e.to_string()))?;
    let id: Uuid = row.get("id");
    sqlx::query("UPDATE app_user SET last_login_at=now() WHERE id=$1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(AuthenticatedUser {
        id,
        username: row.get("username"),
        display_name: row.get("display_name"),
        role,
    })
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
    let hash = hash_password(&request.password)?;
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
    sqlx::query("UPDATE app_user SET active=$2,updated_at=now() WHERE id=$1")
        .bind(user_id)
        .bind(active)
        .execute(pool)
        .await?;
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
    if !password_matches(&stored_hash, &request.current_password) {
        return Err(AppError::Unauthorized("current password is wrong".into()));
    }
    let new_hash = hash_password(&request.new_password)?;
    sqlx::query("UPDATE app_user SET password_hash=$2,updated_at=now() WHERE id=$1")
        .bind(row.get::<Uuid, _>("id"))
        .bind(new_hash)
        .execute(pool)
        .await?;
    Ok(json!({ "username": username, "changed": true }))
}
