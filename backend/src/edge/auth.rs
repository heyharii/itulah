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
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use std::{
    env,
    str::FromStr,
    sync::{Arc, Mutex, MutexGuard},
};
use uuid::Uuid;

const DUMMY_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const LOGIN_FAILURE_LIMIT: i64 = 5;
const MIN_PASSWORD_LENGTH: usize = 8;
const EDGE_SSO_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0042_cloud_to_dc_sso.sql"
));
/// Written on every session a new sign-in pushed out. The cloud's word
/// (`cloud/postgres/users.rs`, migration 0395), so a device that talks to both
/// reads one reason.
pub const SIGNED_IN_ELSEWHERE: &str = "SIGNED_IN_ELSEWHERE";

/// Add `edge_auth_session.revoked_reason` once, and do nothing when it is
/// there. Called from both places a node's auth tables are opened — the full
/// node schema in `edge/sqlite.rs` and [`EdgeAuth::new`], whose connection in
/// the auth-disabled routers carries only `0004` — because an `ADD COLUMN`
/// cannot be written to replay.
pub(crate) fn ensure_session_reason(connection: &Connection) -> Result<(), EdgeError> {
    let present: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('edge_auth_session')
              WHERE name='revoked_reason'",
            [],
            |row| row.get(0),
        )
        .map_err(db)?;
    if present == 0 {
        connection
            .execute_batch(crate::edge::sqlite::SESSION_REASON_SCHEMA)
            .map_err(db)?;
    }
    Ok(())
}

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
    /// Record a printer, refuse a waiting till, suspend or revoke a device.
    /// A supervisor's, because a till switched off at nine in the evening
    /// cannot wait for head office. Letting a till *in* is decided inside
    /// `edge::devices::approve_join`, which also accepts a supervisor's finger.
    DeviceAdmin,
    AuthAdmin,
}

impl EdgePermission {
    const fn minimum_role(self) -> Role {
        match self {
            Self::InventoryRead | Self::DcOperate | Self::StoreSale | Self::RfidObserve => {
                Role::Cashier
            }
            Self::StoreReceive | Self::InventoryMove | Self::DeviceAdmin => Role::Supervisor,
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
        {
            let connection = auth.lock()?;
            connection.execute_batch(EDGE_SSO_SCHEMA).map_err(db)?;
            ensure_session_reason(&connection)?;
        }
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
        // A password sign-in is a sign-in: it ends this person's other
        // sessions at this node (one user, one device — migration 0053).
        self.start_session(
            &mut connection,
            id,
            username,
            display_name,
            role,
            auth_version,
            source,
            true,
        )
    }

    /// Open a session for somebody a finger identified.
    ///
    /// No password is checked here because none was offered: the proof is the
    /// enrolled template that matched on the terminal, and the terminal's own
    /// signed claim that it matched (`edge/fingerprint.rs`). What this still
    /// checks is everything about the *account* that a password login checks —
    /// active, not expired, and **not currently locked out**. An account shut
    /// after five wrong passwords must not be openable by pressing a thumb; the
    /// lockout is about the account, not about the keyboard.
    pub fn issue_for_fingerprint(&self, username: &str) -> Result<IssuedEdgeSession, EdgeError> {
        if !self.config.enabled {
            return Err(EdgeError::Conflict(
                "authentication is disabled on this Edge".into(),
            ));
        }
        let username = username.trim().to_ascii_lowercase();
        let mut connection = self.lock()?;
        let denied = || EdgeError::Unauthorized("fingerprint sign-in refused".into());
        let row: Option<(
            String,
            String,
            String,
            String,
            i64,
            i64,
            String,
            Option<String>,
            Option<String>,
        )> = connection
            .query_row(
                "SELECT id,username,display_name,role,active,auth_version,source,
                            valid_until,login_blocked_until
                     FROM edge_user WHERE username=?1",
                params![username],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                    ))
                },
            )
            .optional()
            .map_err(db)?;
        let Some((
            id,
            username,
            display_name,
            role,
            active,
            auth_version,
            source,
            valid_until,
            login_blocked_until,
        )) = row
        else {
            return Err(denied());
        };
        let now = Utc::now();
        if active != 1 {
            return Err(denied());
        }
        if valid_until
            .as_deref()
            .map(parse_time)
            .transpose()?
            .is_some_and(|expiry| expiry <= now)
        {
            return Err(denied());
        }
        if login_blocked_until
            .as_deref()
            .map(parse_time)
            .transpose()?
            .is_some_and(|until| until > now)
        {
            return Err(denied());
        }
        // Not a sign-in in the one-device sense, by the owner's ruling: a
        // finger at a till asserts who is standing there, and pushing the
        // same person out of a handheld because they pressed a scanner is not
        // what the rule is for. A later password sign-in still ends this
        // session like any other.
        self.start_session(
            &mut connection,
            id,
            username,
            display_name,
            role,
            auth_version,
            source,
            false,
        )
    }

    /// Exchange a Cloud-signed, single-use ticket for a normal local session.
    ///
    /// The ticket proves only the Cloud user id and target DC. The authority
    /// and role come from the latest locally applied Cloud policy, and the
    /// user's local lease must still be current. Ticket consumption and
    /// session creation share a SQLite transaction so parallel replays cannot
    /// both open sessions.
    pub fn exchange_cloud_ticket(&self, ticket: &str) -> Result<IssuedEdgeSession, EdgeError> {
        if !self.config.enabled {
            return Err(EdgeError::Conflict(
                "authentication is disabled on this Edge".into(),
            ));
        }
        if self.node.role != crate::edge::EdgeRole::Dc {
            return Err(EdgeError::Forbidden(
                "Cloud session exchange is available only on a DC".into(),
            ));
        }

        let mut connection = self.lock()?;
        let trust: Option<(String, String, Option<String>, i64)> = connection
            .query_row(
                "SELECT origin_id,node_role,public_key_hex,policy_version
                 FROM edge_sso_trust WHERE singleton=1 AND valid_until>?1",
                params![now_text()],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                    ))
                },
            )
            .optional()
            .map_err(db)?;
        let Some((trusted_origin, trusted_role, public_key, policy_version)) = trust else {
            return Err(EdgeError::Unauthorized(
                "the DC has no current Cloud sign-in policy".into(),
            ));
        };
        let Some(public_key) = public_key else {
            return Err(EdgeError::Unauthorized(
                "Cloud sign-in is not enabled for this DC".into(),
            ));
        };
        if trusted_origin != self.node.node_id || trusted_role != "DC" {
            return Err(EdgeError::Unauthorized(
                "Cloud sign-in policy belongs to another node".into(),
            ));
        }

        let claims = crate::security::sso::verify_ticket(ticket, &public_key)
            .map_err(EdgeError::Unauthorized)?;
        let user_id = Uuid::parse_str(&claims.sub)
            .map_err(|_| EdgeError::Unauthorized("invalid Cloud SSO subject".into()))?;
        let jti = Uuid::parse_str(&claims.jti)
            .map_err(|_| EdgeError::Unauthorized("invalid Cloud SSO ticket id".into()))?;
        let now = Utc::now();
        let now_epoch = now.timestamp();
        if claims.aud != self.node.node_id
            || claims.origin_id != self.node.node_id
            || claims.exp <= now_epoch
            || claims.iat > now_epoch + 5
            || claims.exp <= claims.iat
            || claims.exp - claims.iat > 60
        {
            return Err(EdgeError::Unauthorized(
                "Cloud SSO ticket is expired or intended for another DC".into(),
            ));
        }

        let user: Option<(String, String, String, String, i64)> = connection
            .query_row(
                "SELECT id,username,display_name,role,auth_version
                 FROM edge_user
                 WHERE id=?1 AND source='CLOUD' AND active=1
                   AND policy_version=?2 AND valid_until>?3",
                params![user_id.to_string(), policy_version, time_text(now)],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .optional()
            .map_err(db)?;
        let Some((id, username, display_name, role, auth_version)) = user else {
            return Err(EdgeError::Unauthorized(
                "the Cloud user is inactive or has no current DC lease".into(),
            ));
        };

        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        transaction
            .execute(
                "DELETE FROM edge_sso_ticket_replay WHERE expires_at_epoch<=?1",
                params![now_epoch],
            )
            .map_err(db)?;
        let inserted = transaction.execute(
            "INSERT OR IGNORE INTO edge_sso_ticket_replay(jti,expires_at_epoch)
             VALUES(?1,?2)",
            params![jti.to_string(), claims.exp],
        )
        .map_err(db)?;
        if inserted != 1 {
            return Err(EdgeError::Unauthorized(
                "Cloud SSO ticket has already been used".into(),
            ));
        }
        let issued = self.write_session(
            &transaction,
            id,
            username,
            display_name,
            role,
            auth_version,
            "CLOUD".into(),
            true,
        )?;
        transaction.commit().map_err(db)?;
        Ok(issued)
    }

    /// Turn an already-decided identity into a session.
    ///
    /// Split out of [`Self::login`] rather than copied, because a second
    /// implementation of "what a session is" is how one door ends up issuing a
    /// token the other door's rules never applied to. **It decides nothing** —
    /// the caller has already established who this is and that they are allowed
    /// in; this only writes the row and mints the pair of tokens.
    ///
    /// The other caller is a fingerprint claim, which proves identity with a
    /// finger and a terminal's credential instead of a password.
    ///
    /// `supersede` is the one-device rule: see [`Self::write_session`].
    #[allow(clippy::too_many_arguments)]
    fn start_session(
        &self,
        connection: &mut Connection,
        id: String,
        username: String,
        display_name: String,
        role: String,
        auth_version: i64,
        source: String,
        supersede: bool,
    ) -> Result<IssuedEdgeSession, EdgeError> {
        let transaction = connection.transaction().map_err(db)?;
        let issued = self.write_session(
            &transaction,
            id,
            username,
            display_name,
            role,
            auth_version,
            source,
            supersede,
        )?;
        transaction.commit().map_err(db)?;
        Ok(issued)
    }

    /// Write the session row and mint its tokens.
    ///
    /// With `supersede`, first revoke every other live session this person
    /// has at this node, as `SIGNED_IN_ELSEWHERE` — one user, one device
    /// (migration 0053), the node's half of what head office does in
    /// `cloud/postgres/users.rs::create_session`. In the caller's transaction,
    /// so two sign-ins racing each other cannot both survive: SQLite has one
    /// writer, and whichever commits second revokes the first.
    #[allow(clippy::too_many_arguments)]
    fn write_session(
        &self,
        transaction: &Transaction<'_>,
        id: String,
        username: String,
        display_name: String,
        role: String,
        auth_version: i64,
        source: String,
        supersede: bool,
    ) -> Result<IssuedEdgeSession, EdgeError> {
        let now = Utc::now();
        let user_id = Uuid::parse_str(&id)
            .map_err(|error| EdgeError::Persistence(format!("invalid edge user id: {error}")))?;
        let role =
            Role::from_str(&role).map_err(|error| EdgeError::Persistence(error.to_string()))?;
        if supersede {
            transaction
                .execute(
                    "UPDATE edge_auth_session
                        SET revoked_at=?2, revoked_reason=?3
                      WHERE user_id=?1 AND revoked_at IS NULL",
                    params![id, time_text(now), SIGNED_IN_ELSEWHERE],
                )
                .map_err(db)?;
        }
        let token = security::random_token();
        let csrf_token = security::random_token();
        let session_id = Uuid::new_v4();
        let expires_at = now + Duration::minutes(self.config.session_ttl_minutes);
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
            // Say why when the reason is one the person can act on: a device
            // pushed out by a sign-in elsewhere should say so, not "expired".
            let reason: Option<String> = connection
                .query_row(
                    "SELECT revoked_reason FROM edge_auth_session WHERE token_sha256=?1",
                    params![security::sha256_hex(token)],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()
                .map_err(db)?
                .flatten();
            return Err(EdgeError::Unauthorized(
                if reason.as_deref() == Some(SIGNED_IN_ELSEWHERE) {
                    "this account was signed in on another device".into()
                } else {
                    "invalid or expired session".into()
                },
            ));
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

    fn dc_auth_with_cloud_user() -> (EdgeAuth, [u8; 32], Uuid) {
        let node = NodeContext::new(
            "dc-01-edge",
            EdgeRole::Dc,
            SiteId::new("dc-01").unwrap_or_else(|error| panic!("site: {error}")),
        )
        .unwrap_or_else(|error| panic!("node: {error}"));
        let edge = SqliteEdge::open_in_memory(node.clone())
            .unwrap_or_else(|error| panic!("edge: {error}"));
        let auth = EdgeAuth::new(
            edge.connection(),
            node,
            EdgeAuthConfig {
                enabled: true,
                session_ttl_minutes: 60,
                session_idle_minutes: 30,
                cookie_secure: false,
                bootstrap_admin_password: None,
            },
        )
        .unwrap_or_else(|error| panic!("auth: {error}"));
        let seed = [29u8; 32];
        let public_key = crate::security::sso::public_key_from_seed(&seed)
            .unwrap_or_else(|error| panic!("public key: {error}"));
        let user_id = Uuid::new_v4();
        let now = Utc::now();
        let connection = auth
            .lock()
            .unwrap_or_else(|error| panic!("connection: {error}"));
        connection
            .execute(
                "INSERT INTO edge_user
                     (id,username,display_name,password_hash,role,active,auth_version,source,
                      policy_version,valid_until,created_at,updated_at)
                 VALUES(?1,'dc.operator','DC Operator',?4,'SUPERVISOR',1,3,'CLOUD',
                        4,?2,?3,?3)",
                params![
                    user_id.to_string(),
                    time_text(now + Duration::hours(12)),
                    time_text(now),
                    crate::security::SSO_ONLY_VERIFIER,
                ],
            )
            .unwrap_or_else(|error| panic!("Cloud user: {error}"));
        connection
            .execute(
                "INSERT INTO edge_sso_trust
                     (singleton,origin_id,node_role,policy_version,public_key_hex,valid_until,updated_at)
                 VALUES(1,'dc-01-edge','DC',4,?1,?2,?3)",
                params![public_key, time_text(now + Duration::hours(24)), time_text(now)],
            )
            .unwrap_or_else(|error| panic!("SSO trust: {error}"));
        drop(connection);
        (auth, seed, user_id)
    }

    fn cloud_ticket(seed: &[u8; 32], user_id: Uuid, origin_id: &str) -> String {
        let issued_at = Utc::now().timestamp();
        crate::security::sso::issue_ticket(
            &crate::security::sso::TicketClaims {
                sub: user_id.to_string(),
                aud: origin_id.to_owned(),
                origin_id: origin_id.to_owned(),
                iat: issued_at,
                exp: issued_at + 60,
                jti: Uuid::new_v4().to_string(),
            },
            seed,
        )
        .unwrap_or_else(|error| panic!("ticket: {error}"))
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

    #[test]
    fn cloud_ticket_uses_local_role_and_is_consumed_once() {
        let (auth, seed, user_id) = dc_auth_with_cloud_user();
        let ticket = cloud_ticket(&seed, user_id, "dc-01-edge");

        let issued = auth
            .exchange_cloud_ticket(&ticket)
            .unwrap_or_else(|error| panic!("Cloud exchange: {error}"));
        assert_eq!(issued.principal.user_id, user_id);
        assert_eq!(issued.principal.username, "dc.operator");
        assert_eq!(issued.principal.role, Role::Supervisor);
        assert_eq!(issued.principal.source, "CLOUD");
        let (authenticated, _) = auth
            .authenticate(&issued.token, false)
            .unwrap_or_else(|error| panic!("local session: {error}"));
        assert_eq!(authenticated.role, Role::Supervisor);

        assert!(matches!(
            auth.exchange_cloud_ticket(&ticket),
            Err(EdgeError::Unauthorized(_))
        ));
    }

    #[test]
    fn a_cloud_user_without_a_dc_password_signs_in_only_through_cloud() {
        let (auth, seed, user_id) = dc_auth_with_cloud_user();
        // Not even the verifier itself, typed as a password, opens it.
        for attempt in ["", crate::security::SSO_ONLY_VERIFIER, "any-password-1"] {
            assert!(matches!(
                auth.login("dc.operator", attempt),
                Err(EdgeError::Unauthorized(_))
            ));
        }
        auth.exchange_cloud_ticket(&cloud_ticket(&seed, user_id, "dc-01-edge"))
            .unwrap_or_else(|error| panic!("Cloud exchange: {error}"));
    }

    #[test]
    fn cloud_ticket_rejects_wrong_destination_and_expired_user_lease() {
        let (auth, seed, user_id) = dc_auth_with_cloud_user();
        let wrong_destination = cloud_ticket(&seed, user_id, "another-dc");
        assert!(matches!(
            auth.exchange_cloud_ticket(&wrong_destination),
            Err(EdgeError::Unauthorized(_))
        ));

        auth.lock()
            .unwrap_or_else(|error| panic!("connection: {error}"))
            .execute(
                "UPDATE edge_user SET valid_until=?2 WHERE id=?1",
                params![user_id.to_string(), time_text(Utc::now() - Duration::seconds(1))],
            )
            .unwrap_or_else(|error| panic!("expire lease: {error}"));
        let ticket = cloud_ticket(&seed, user_id, "dc-01-edge");
        assert!(matches!(
            auth.exchange_cloud_ticket(&ticket),
            Err(EdgeError::Unauthorized(_))
        ));
    }
}
