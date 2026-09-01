//! Offline-capable human authentication for DC and Store Edge.
//!
//! Cloud-projected users and Edge-local break-glass users share the same
//! verifier/session path.  Sessions are opaque database records, so a policy
//! replacement, deactivation, password change, lease expiry, or logout takes
//! effect locally without calling Cloud.

use crate::{
    edge::{domain::Role, EdgeError, NodeContext},
    security,
};
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    env,
    str::FromStr,
    sync::{Arc, Mutex, MutexGuard},
};
use uuid::Uuid;

const DUMMY_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const LOGIN_FAILURE_LIMIT: i64 = 5;
const MIN_PASSWORD_LENGTH: usize = 8;

#[derive(Clone, Debug)]
pub struct EdgeAuthConfig {
    pub enabled: bool,
    pub session_ttl_minutes: i64,
    pub session_idle_minutes: i64,
    pub cookie_secure: bool,
    pub bootstrap_admin_password: Option<String>,
}

impl EdgeAuthConfig {
    pub fn from_env() -> Result<Self, EdgeError> {
        let mode = env::var("INVENTORY_AUTH_MODE").unwrap_or_else(|_| "required".into());
        let enabled = match mode.to_ascii_lowercase().as_str() {
            "required" | "enabled" => true,
            "disabled" => false,
            _ => {
                return Err(EdgeError::Configuration(
                    "INVENTORY_AUTH_MODE must be required or disabled".into(),
                ))
            }
        };
        Ok(Self {
            enabled,
            session_ttl_minutes: env_i64(
                "INVENTORY_AUTH_TOKEN_TTL_MINUTES",
                12 * 60,
                1,
                7 * 24 * 60,
            )?,
            session_idle_minutes: env_i64("INVENTORY_AUTH_SESSION_IDLE_MINUTES", 30, 1, 24 * 60)?,
            cookie_secure: env::var("INVENTORY_AUTH_COOKIE_SECURE")
                .map(|value| value.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            bootstrap_admin_password: env::var("INVENTORY_BOOTSTRAP_ADMIN_PASSWORD")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
        })
    }

    pub const fn disabled() -> Self {
        Self {
            enabled: false,
            session_ttl_minutes: 720,
            session_idle_minutes: 30,
            cookie_secure: false,
            bootstrap_admin_password: None,
        }
    }
}

fn env_i64(name: &str, default: i64, minimum: i64, maximum: i64) -> Result<i64, EdgeError> {
    let value = env::var(name)
        .ok()
        .map(|raw| {
            raw.parse::<i64>()
                .map_err(|error| EdgeError::Configuration(format!("invalid {name}: {error}")))
        })
        .transpose()?
        .unwrap_or(default);
    if !(minimum..=maximum).contains(&value) {
        return Err(EdgeError::Configuration(format!(
            "{name} must be between {minimum} and {maximum}"
        )));
    }
    Ok(value)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EdgePermission {
    InventoryRead,
    DcOperate,
    StoreSale,
    StoreReceive,
    InventoryMove,
    RfidObserve,
    AuthAdmin,
}

impl EdgePermission {
    const fn minimum_role(self) -> Role {
        match self {
            Self::InventoryRead | Self::DcOperate | Self::StoreSale | Self::RfidObserve => {
                Role::Cashier
            }
            Self::StoreReceive | Self::InventoryMove => Role::Supervisor,
            Self::AuthAdmin => Role::Admin,
        }
    }
}

#[derive(Clone, Debug)]
pub struct EdgePrincipal {
    pub session_id: Uuid,
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: Role,
    pub source: String,
    pub authenticated_with_cookie: bool,
}

impl EdgePrincipal {
    pub fn require(&self, permission: EdgePermission) -> Result<(), EdgeError> {
        let required = permission.minimum_role();
        if self.role < required {
            return Err(EdgeError::Forbidden(format!(
                "this action requires the {required} role"
            )));
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct IssuedEdgeSession {
    pub token: String,
    pub csrf_token: String,
    pub expires_at: DateTime<Utc>,
    pub principal: EdgePrincipal,
}

#[derive(Clone)]
pub struct EdgeAuth {
    connection: Arc<Mutex<Connection>>,
    node: NodeContext,
    config: EdgeAuthConfig,
}

struct LoginRow {
    id: String,
    username: String,
    display_name: String,
    password_hash: String,
    role: String,
    active: i64,
    auth_version: i64,
    source: String,
    valid_until: Option<String>,
    failed_login_count: i64,
    failed_login_window_started_at: Option<String>,
    login_blocked_until: Option<String>,
}

struct SessionRow {
    session_id: String,
    user_id: String,
    username: String,
    display_name: String,
    role: String,
    source: String,
    csrf_hash: String,
    last_seen: String,
    valid_until: Option<String>,
}

impl EdgeAuth {
    pub fn new(
        connection: Arc<Mutex<Connection>>,
        node: NodeContext,
        config: EdgeAuthConfig,
    ) -> Result<Self, EdgeError> {
        let auth = Self {
            connection,
            node,
            config,
        };
        auth.bootstrap_admin()?;
        Ok(auth)
    }

    pub fn config(&self) -> &EdgeAuthConfig {
        &self.config
    }

    pub fn node(&self) -> &NodeContext {
        &self.node
    }

    pub(crate) fn connection(&self) -> Arc<Mutex<Connection>> {
        self.connection.clone()
    }

    pub fn enabled(&self) -> bool {
        self.config.enabled
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, EdgeError> {
        self.connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge auth connection is poisoned".into()))
    }

    fn bootstrap_admin(&self) -> Result<(), EdgeError> {
        if !self.config.enabled {
            tracing::warn!("Edge authentication is explicitly DISABLED");
            return Ok(());
        }
        let connection = self.lock()?;
        let users: i64 = connection
            .query_row("SELECT count(*) FROM edge_user", [], |row| row.get(0))
            .map_err(db)?;
        if users > 0 {
            return Ok(());
        }
        let Some(password) = self.config.bootstrap_admin_password.as_deref() else {
            tracing::warn!(
                "Edge auth is required but no identities exist and INVENTORY_BOOTSTRAP_ADMIN_PASSWORD is unset"
            );
            return Ok(());
        };
        let password_hash = security::hash_password(password, MIN_PASSWORD_LENGTH)
            .map_err(EdgeError::Configuration)?;
        let now = now_text();
        connection
            .execute(
                "INSERT INTO edge_user
                     (id,username,display_name,password_hash,role,active,auth_version,source,
                      policy_version,valid_until,created_at,updated_at)
                 VALUES(?1,'admin','Administrator',?2,'ADMIN',1,1,'LOCAL',NULL,NULL,?3,?3)",
                params![Uuid::new_v4().to_string(), password_hash, now],
            )
            .map_err(db)?;
        tracing::info!("Edge bootstrap admin user created");
        Ok(())
    }

    pub fn login(&self, username: &str, password: &str) -> Result<IssuedEdgeSession, EdgeError> {
        if !self.config.enabled {
            return Err(EdgeError::Conflict(
                "authentication is disabled on this Edge".into(),
            ));
        }
        let username = username.trim().to_ascii_lowercase();
        let mut connection = self.lock()?;
        let row: Option<LoginRow> = connection
            .query_row(
                "SELECT id,username,display_name,password_hash,role,active,auth_version,
                        source,valid_until,failed_login_count,
                        failed_login_window_started_at,login_blocked_until
                 FROM edge_user WHERE username=?1",
                params![username],
                |row| {
                    Ok(LoginRow {
                        id: row.get(0)?,
                        username: row.get(1)?,
                        display_name: row.get(2)?,
                        password_hash: row.get(3)?,
                        role: row.get(4)?,
                        active: row.get(5)?,
                        auth_version: row.get(6)?,
                        source: row.get(7)?,
                        valid_until: row.get(8)?,
                        failed_login_count: row.get(9)?,
                        failed_login_window_started_at: row.get(10)?,
                        login_blocked_until: row.get(11)?,
                    })
                },
            )
            .optional()
            .map_err(db)?;
        let denied = || EdgeError::Unauthorized("invalid username or password".into());
        let Some(LoginRow {
            id,
            username,
            display_name,
            password_hash,
            role,
            active,
            auth_version,
            source,
            valid_until,
            failed_login_count,
            failed_login_window_started_at,
            login_blocked_until,
        }) = row
        else {
            let _ = security::password_matches(DUMMY_HASH, password);
            return Err(denied());
        };
        let now = Utc::now();
        let valid = valid_until
            .as_deref()
            .map(parse_time)
            .transpose()?
            .is_none_or(|expiry| expiry > now);
        let password_valid = security::password_matches(&password_hash, password);
        let blocked = login_blocked_until
            .as_deref()
            .map(parse_time)
            .transpose()?
            .is_some_and(|until| until > now);
        if blocked {
            return Err(denied());
        }
        if active != 1 || !valid || !password_valid {
            if active == 1 && valid {
                let existing_window = failed_login_window_started_at
                    .as_deref()
                    .map(parse_time)
                    .transpose()?;
                let within_window =
                    existing_window.is_some_and(|started| started > now - Duration::minutes(15));
                let failures = if within_window {
                    failed_login_count.saturating_add(1)
                } else {
                    1
                };
                let window_started_at = existing_window.filter(|_| within_window).unwrap_or(now);
                let blocked_until = (failures >= LOGIN_FAILURE_LIMIT)
                    .then(|| time_text(now + Duration::minutes(15)));
                connection
                    .execute(
                        "UPDATE edge_user
                         SET failed_login_count=?2,failed_login_window_started_at=?3,
                             login_blocked_until=?4,updated_at=?5
                         WHERE id=?1",
                        params![
                            id,
                            failures,
                            time_text(window_started_at),
                            blocked_until,
                            time_text(now),
                        ],
                    )
                    .map_err(db)?;
            }
            return Err(denied());
        }
        let user_id = Uuid::parse_str(&id)
            .map_err(|error| EdgeError::Persistence(format!("invalid edge user id: {error}")))?;
        let role =
            Role::from_str(&role).map_err(|error| EdgeError::Persistence(error.to_string()))?;
        let token = security::random_token();
        let csrf_token = security::random_token();
        let session_id = Uuid::new_v4();
        let expires_at = now + Duration::minutes(self.config.session_ttl_minutes);
        let transaction = connection.transaction().map_err(db)?;
        transaction
            .execute(
                "INSERT INTO edge_auth_session
                     (session_id,token_sha256,csrf_token_sha256,user_id,auth_version,
                      created_at,last_seen_at,expires_at)
                 VALUES(?1,?2,?3,?4,?5,?6,?6,?7)",
                params![
                    session_id.to_string(),
                    security::sha256_hex(&token),
                    security::sha256_hex(&csrf_token),
                    id,
                    auth_version,
                    time_text(now),
                    time_text(expires_at)
                ],
            )
            .map_err(db)?;
        transaction
            .execute(
                "UPDATE edge_user
                 SET last_login_at=?2,failed_login_count=0,
                     failed_login_window_started_at=NULL,login_blocked_until=NULL
                 WHERE id=?1",
                params![user_id.to_string(), time_text(now)],
            )
            .map_err(db)?;
        transaction.commit().map_err(db)?;
        Ok(IssuedEdgeSession {
            token,
            csrf_token,
            expires_at,
            principal: EdgePrincipal {
                session_id,
                user_id,
                username,
                display_name,
                role,
                source,
                authenticated_with_cookie: false,
            },
        })
    }

    pub fn authenticate(
        &self,
        token: &str,
        authenticated_with_cookie: bool,
    ) -> Result<(EdgePrincipal, String), EdgeError> {
        let connection = self.lock()?;
        let row: Option<SessionRow> = connection
            .query_row(
                "SELECT s.session_id,u.id,u.username,u.display_name,u.role,u.source,
                        u.auth_version,s.csrf_token_sha256,s.last_seen_at,u.valid_until
                 FROM edge_auth_session s JOIN edge_user u ON u.id=s.user_id
                 WHERE s.token_sha256=?1 AND s.revoked_at IS NULL AND s.expires_at>?2
                   AND u.active=1 AND u.auth_version=s.auth_version",
                params![security::sha256_hex(token), now_text()],
                |row| {
                    let _auth_version: i64 = row.get(6)?;
                    Ok(SessionRow {
                        session_id: row.get(0)?,
                        user_id: row.get(1)?,
                        username: row.get(2)?,
                        display_name: row.get(3)?,
                        role: row.get(4)?,
                        source: row.get(5)?,
                        csrf_hash: row.get(7)?,
                        last_seen: row.get(8)?,
                        valid_until: row.get(9)?,
                    })
                },
            )
            .optional()
            .map_err(db)?;
        let Some(SessionRow {
            session_id,
            user_id,
            username,
            display_name,
            role,
            source,
            csrf_hash,
            last_seen,
            valid_until,
        }) = row
        else {
            return Err(EdgeError::Unauthorized("invalid or expired session".into()));
        };
        let idle_cutoff = Utc::now() - Duration::minutes(self.config.session_idle_minutes);
        if parse_time(&last_seen)? <= idle_cutoff
            || valid_until
                .as_deref()
                .map(parse_time)
                .transpose()?
                .is_some_and(|expiry| expiry <= Utc::now())
        {
            return Err(EdgeError::Unauthorized("invalid or expired session".into()));
        }
        connection
            .execute(
                "UPDATE edge_auth_session SET last_seen_at=?2 WHERE session_id=?1",
                params![session_id, now_text()],
            )
            .map_err(db)?;
        Ok((
            EdgePrincipal {
                session_id: parse_uuid(&session_id, "session")?,
                user_id: parse_uuid(&user_id, "user")?,
                username,
                display_name,
                role: Role::from_str(&role)
                    .map_err(|error| EdgeError::Persistence(error.to_string()))?,
                source,
                authenticated_with_cookie,
            },
            csrf_hash,
        ))
    }

    pub fn logout(&self, session_id: Uuid) -> Result<(), EdgeError> {
        self.lock()?
            .execute(
                "UPDATE edge_auth_session SET revoked_at=COALESCE(revoked_at,?2) WHERE session_id=?1",
                params![session_id.to_string(), now_text()],
            )
            .map_err(db)?;
        Ok(())
    }

    /// Rotate an Edge-local break-glass password and revoke every session for
    /// that identity. Cloud-projected credentials are deliberately immutable
    /// here: changing one locally would fork the signed Cloud policy and the
    /// next projection would silently replace it.
    pub fn change_local_password(
        &self,
        user_id: Uuid,
        current_password: &str,
        new_password: &str,
    ) -> Result<(), EdgeError> {
        let new_hash = security::hash_password(new_password, MIN_PASSWORD_LENGTH)
            .map_err(EdgeError::Validation)?;
        let mut connection = self.lock()?;
        let row: Option<(String, String, i64)> = connection
            .query_row(
                "SELECT password_hash,source,active FROM edge_user WHERE id=?1",
                params![user_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(db)?;
        let Some((stored_hash, source, active)) = row else {
            return Err(EdgeError::NotFound("Edge user".into()));
        };
        if source != "LOCAL" {
            return Err(EdgeError::Forbidden(
                "Cloud-projected Edge credentials must be changed at Cloud".into(),
            ));
        }
        if active != 1 || !security::password_matches(&stored_hash, current_password) {
            return Err(EdgeError::Unauthorized("current password is wrong".into()));
        }
        let now = now_text();
        let transaction = connection.transaction().map_err(db)?;
        transaction
            .execute(
                "UPDATE edge_user
                 SET password_hash=?2,auth_version=auth_version+1,updated_at=?3,
                     failed_login_count=0,failed_login_window_started_at=NULL,
                     login_blocked_until=NULL
                 WHERE id=?1",
                params![user_id.to_string(), new_hash, now],
            )
            .map_err(db)?;
        transaction
            .execute(
                "UPDATE edge_auth_session
                 SET revoked_at=COALESCE(revoked_at,?2) WHERE user_id=?1",
                params![user_id.to_string(), now],
            )
            .map_err(db)?;
        transaction.commit().map_err(db)?;
        Ok(())
    }

    pub fn policy_version(&self) -> Result<Option<(i64, DateTime<Utc>)>, EdgeError> {
        let row: Option<(i64, String)> = self
            .lock()?
            .query_row(
                "SELECT version,valid_until FROM edge_auth_policy_state WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(db)?;
        row.map(|(version, expiry)| Ok((version, parse_time(&expiry)?)))
            .transpose()
    }
}

fn parse_uuid(value: &str, label: &str) -> Result<Uuid, EdgeError> {
    Uuid::parse_str(value)
        .map_err(|error| EdgeError::Persistence(format!("invalid {label} id: {error}")))
}

fn now_text() -> String {
    time_text(Utc::now())
}

fn time_text(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn parse_time(value: &str) -> Result<DateTime<Utc>, EdgeError> {
    DateTime::parse_from_rfc3339(value)
        .map(|parsed| parsed.with_timezone(&Utc))
        .map_err(|error| EdgeError::Persistence(format!("invalid timestamp: {error}")))
}

fn db(error: rusqlite::Error) -> EdgeError {
    EdgeError::Persistence(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edge::{EdgeRole, SiteId, SqliteEdge};

    fn auth() -> EdgeAuth {
        let node = NodeContext::new(
            "store-07-edge",
            EdgeRole::Store,
            SiteId::new("store-07").unwrap_or_else(|error| panic!("site: {error}")),
        )
        .unwrap_or_else(|error| panic!("node: {error}"));
        let edge = SqliteEdge::open_in_memory(node.clone())
            .unwrap_or_else(|error| panic!("edge: {error}"));
        EdgeAuth::new(
            edge.connection(),
            node,
            EdgeAuthConfig {
                enabled: true,
                session_ttl_minutes: 60,
                session_idle_minutes: 30,
                cookie_secure: false,
                bootstrap_admin_password: Some("admin-password-1".into()),
            },
        )
        .unwrap_or_else(|error| panic!("auth: {error}"))
    }

    #[test]
    fn edge_session_is_local_revocable_and_role_checked() {
        let auth = auth();
        let issued = auth
            .login("admin", "admin-password-1")
            .unwrap_or_else(|error| panic!("login: {error}"));
        let (principal, _) = auth
            .authenticate(&issued.token, false)
            .unwrap_or_else(|error| panic!("authenticate: {error}"));
        assert_eq!(principal.role, Role::Admin);
        assert!(principal.require(EdgePermission::AuthAdmin).is_ok());
        auth.logout(principal.session_id)
            .unwrap_or_else(|error| panic!("logout: {error}"));
        assert!(auth.authenticate(&issued.token, false).is_err());
    }

    #[test]
    fn edge_login_throttles_repeated_password_failures() {
        let auth = auth();
        for _ in 0..LOGIN_FAILURE_LIMIT {
            assert!(matches!(
                auth.login("admin", "incorrect-password"),
                Err(EdgeError::Unauthorized(_))
            ));
        }
        assert!(matches!(
            auth.login("admin", "admin-password-1"),
            Err(EdgeError::Unauthorized(_))
        ));
        auth.lock()
            .unwrap_or_else(|error| panic!("connection: {error}"))
            .execute(
                "UPDATE edge_user SET login_blocked_until=?1 WHERE username='admin'",
                params![time_text(Utc::now() - Duration::seconds(1))],
            )
            .unwrap_or_else(|error| panic!("expire block: {error}"));
        auth.login("admin", "admin-password-1")
            .unwrap_or_else(|error| panic!("login after cooldown: {error}"));
        let failures: i64 = auth
            .lock()
            .unwrap_or_else(|error| panic!("connection: {error}"))
            .query_row(
                "SELECT failed_login_count FROM edge_user WHERE username='admin'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|error| panic!("failure count: {error}"));
        assert_eq!(failures, 0);
    }

    #[test]
    fn local_password_rotation_revokes_sessions_and_rejects_the_old_password() {
        let auth = auth();
        let issued = auth
            .login("admin", "admin-password-1")
            .unwrap_or_else(|error| panic!("login: {error}"));
        auth.change_local_password(
            issued.principal.user_id,
            "admin-password-1",
            "admin-password-2",
        )
        .unwrap_or_else(|error| panic!("rotate: {error}"));
        assert!(auth.authenticate(&issued.token, false).is_err());
        assert!(auth.login("admin", "admin-password-1").is_err());
        auth.login("admin", "admin-password-2")
            .unwrap_or_else(|error| panic!("new password login: {error}"));
    }
}
