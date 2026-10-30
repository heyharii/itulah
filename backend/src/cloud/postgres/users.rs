//! Local node user store: argon2id password hashes, role assignment, and the
//! one-time admin bootstrap. Identity is local to this node's database on
//! purpose — a store keeps authenticating cashiers with the network down.
//! When a cloud identity downlink exists, this table becomes its projection
//! target; nothing here assumes the credentials were minted locally.

use crate::cloud::application::{
    AppError, ChangePasswordRequest, CreateUserRequest, ProvisionAccountRequest,
    ProvisionedAccount, ResetPasswordRequest, SetUserRoleRequest,
};
use crate::cloud::domain::job_role::JobGrant;
use crate::cloud::domain::Role;
use crate::security;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
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
    /// The job role (0633), so signing in answers what `me` answers.
    pub job: JobGrant,
}

async fn hash_password(password: &str) -> Result<String, AppError> {
    let password = password.to_owned();
    tokio::task::spawn_blocking(move || security::hash_password(&password, MIN_PASSWORD_LENGTH))
        .await
        .map_err(|error| AppError::Configuration(format!("password worker failed: {error}")))?
        .map_err(AppError::Validation)
}

/// Hash a password somebody has just chosen, with the house minimum length.
pub async fn hash_new_password(password: &str) -> Result<String, AppError> {
    hash_password(password).await
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

/// Hash the password of a hand-made Edge grant (`source = 'MANUAL'`) before
/// placing its verifier in a signed policy projection. A grant derived from
/// the job role (0635) has none: its server is sent the login's own hub
/// password hash instead (`auth_policy.rs`, "The password a server checks").
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
                // The first account on an empty database owns the company
                // (0633): somebody has to hold OWNER, and nobody else exists.
                "INSERT INTO app_user(id,username,display_name,password_hash,role,role_code,created_by) \
                 VALUES($1,'admin','Administrator',$2,'ADMIN','OWNER','bootstrap') \
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
        "SELECT u.id,u.username,u.display_name,u.password_hash,u.role,u.active,
                u.auth_version,u.login_blocked_until,
                u.role_code,r.name AS role_name,r.flow_roles,r.sections,r.read_only,r.unit_reach
         FROM app_user u LEFT JOIN job_role r ON r.code=u.role_code
         WHERE u.username=$1",
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
        job: job_grant_of(&row)?,
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
    /// The job role (0633), read with the session on every request: a role
    /// edited or changed holds from the next click, not the next sign-in.
    pub job: JobGrant,
    pub csrf_token_sha256: String,
}

/// The job role on a row that selected `role_code`, `role_name`,
/// `flow_roles`, `sections`, `read_only` and `unit_reach` (a `LEFT JOIN
/// job_role`). A row with no role behind it — which the foreign key forbids —
/// grants nothing, and reaches only its own posting.
pub fn job_grant_of(row: &sqlx::postgres::PgRow) -> Result<JobGrant, AppError> {
    let code: Option<String> = row.try_get("role_code")?;
    let name: Option<String> = row.try_get("role_name")?;
    let flow_roles: Option<Vec<String>> = row.try_get("flow_roles")?;
    let sections: Option<Vec<String>> = row.try_get("sections")?;
    let read_only: Option<bool> = row.try_get("read_only")?;
    let unit_reach: Option<String> = row.try_get("unit_reach")?;
    Ok(JobGrant::from_stored(
        code.unwrap_or_default(),
        name.unwrap_or_default(),
        &flow_roles.unwrap_or_default(),
        sections.unwrap_or_default(),
        read_only.unwrap_or(true),
        unit_reach.as_deref().unwrap_or("OWN"),
    ))
}

pub async fn create_session(
    pool: &PgPool,
    user: &AuthenticatedUser,
    ttl_minutes: i64,
) -> Result<IssuedSession, AppError> {
    let mut transaction = pool.begin().await?;
    let issued =
        create_session_tx(&mut transaction, user.id, user.auth_version, ttl_minutes).await?;
    transaction.commit().await?;
    Ok(issued)
}

/// Open a session inside the caller's transaction — the same session a
/// sign-in opens, for a caller that has just made the account in that
/// transaction (accepting an invitation, 0634).
pub async fn create_session_tx(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    auth_version: i64,
    ttl_minutes: i64,
) -> Result<IssuedSession, AppError> {
    let token = security::random_token();
    let csrf_token = security::random_token();
    let expires_at = Utc::now() + Duration::minutes(ttl_minutes.max(1));
    // One user, one device (migration 0395), when switched on: this sign-in
    // ends every other live session of the account, in the same transaction
    // that opens it, so two sign-ins racing each other cannot both survive.
    // Off for now — see `security::one_device_sign_in`.
    if security::one_device_sign_in() {
        sqlx::query(
            "UPDATE auth_session
                SET revoked_at = now(), revoked_reason = 'SIGNED_IN_ELSEWHERE'
              WHERE user_id = $1 AND revoked_at IS NULL",
        )
        .bind(user_id)
        .execute(&mut **transaction)
        .await?;
    }
    sqlx::query(
        "INSERT INTO auth_session
             (session_id,token_sha256,csrf_token_sha256,user_id,auth_version,expires_at)
         VALUES($1,$2,$3,$4,$5,$6)",
    )
    .bind(Uuid::new_v4())
    .bind(security::sha256_hex(&token))
    .bind(security::sha256_hex(&csrf_token))
    .bind(user_id)
    .bind(auth_version)
    .bind(expires_at)
    .execute(&mut **transaction)
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
        "SELECT s.session_id,s.csrf_token_sha256,u.username,u.display_name,u.role,
                u.role_code,r.name AS role_name,r.flow_roles,r.sections,r.read_only,r.unit_reach
         FROM auth_session s
         JOIN app_user u ON u.id=s.user_id
         LEFT JOIN job_role r ON r.code=u.role_code
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
    .await?;
    let Some(row) = row else {
        // Say why, when the reason is one the person can act on: a device
        // pushed out by a sign-in elsewhere should say so, not "expired".
        let superseded: Option<bool> = sqlx::query_scalar(
            "SELECT revoked_reason = 'SIGNED_IN_ELSEWHERE'
               FROM auth_session WHERE token_sha256 = $1",
        )
        .bind(security::sha256_hex(token))
        .fetch_optional(pool)
        .await?
        .flatten();
        return Err(AppError::Unauthorized(if superseded == Some(true) {
            "this account was signed in on another device".into()
        } else {
            "invalid or expired session".into()
        }));
    };
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
        job: job_grant_of(&row)?,
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
    // A rung only: the trigger gives it that rung's default job role (0633).
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
    let (role, role_code): (String, String) =
        sqlx::query_as("SELECT role, role_code FROM app_user WHERE id = $1")
            .bind(id)
            .fetch_one(pool)
            .await?;
    super::follow_login(pool, id, created_by).await;
    Ok(json!({
        "id": id,
        "username": username,
        "display_name": display_name,
        "role": role,
        "role_code": role_code,
        "active": true
    }))
}

/// A job role code a caller named, checked against `job_role`, or `None`.
async fn known_role_code(pool: &PgPool, asked: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(asked) = asked.map(str::trim).filter(|code| !code.is_empty()) else {
        return Ok(None);
    };
    let code = asked.to_ascii_uppercase();
    let exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM job_role WHERE code = $1)")
        .bind(&code)
        .fetch_one(pool)
        .await?;
    if !exists {
        return Err(AppError::Validation(format!("there is no job role {code}")));
    }
    Ok(Some(code))
}

/// Every account at the centre, and who each one belongs to.
///
/// The join is the point. An account list that shows only usernames cannot
/// answer the two questions an administrator actually opens it with: which of
/// these are people and which are machines, and which of them belong to
/// somebody who no longer works here. Both are one `LEFT JOIN` away, and
/// without it the console was a list of credentials with nobody behind them.
///
/// `employee_status` is the employment record's, not the account's: an account
/// that is `active` while its employee reads TERMINATED is a live credential
/// for somebody who has left, and it is the row worth putting at the top.
/// One login, as the account console lists it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UserRow {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub active: bool,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    /// Null for an account nobody has ever signed in to.
    pub last_login_at: Option<DateTime<Utc>>,
    /// Set while too many wrong passwords keep this login locked out; the
    /// console shows it and offers Unlock ([`unlock_user`]).
    pub login_blocked_until: Option<DateTime<Utc>>,
    /// Null in all five together: a machine account, or a login HR has not
    /// finished the paperwork for. The console says which rather than leaving a
    /// blank column to be read as a bug.
    pub employee_id: Option<String>,
    pub employee_code: Option<String>,
    /// The employment record's status, not the account's. An account that is
    /// `active` while its employee reads TERMINATED is a live credential for
    /// somebody who has left, which is the row worth putting at the top.
    pub employee_status: Option<String>,
    pub employee_name: Option<String>,
    pub unit_id: Option<String>,
    pub unit_name: Option<String>,
    /// The job role (0633): its code and its name.
    pub role_code: String,
    pub role_name: String,
    /// The role's server reach: `NONE`, `UNIT` or `EVERY` (0635). With the
    /// posting above it is the reason for every derived server below.
    pub node_reach: String,
    /// Every store or gudang server this login may sign in at.
    pub nodes: Vec<UserNode>,
}

/// One server a login may sign in at, and whether its role put it there.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UserNode {
    pub origin_id: String,
    pub label: Option<String>,
    pub site_id: Option<String>,
    pub site_name: Option<String>,
    /// `STORE` or `DC`.
    pub node_role: Option<String>,
    /// The rung this login holds there.
    pub edge_role: String,
    /// False when this one server, or the login, is switched off.
    pub active: bool,
    /// True when the job role and the posting put it here (0635); false for
    /// a grant made by hand in System > Access, which keeps its own password.
    pub derived: bool,
}

/// One value a filter can take, and how many logins would still be there.
///
/// Exact, always. This is an access surface in the same sense
/// `system/access` is: it answers "who can sign in", and a rough count of that
/// reads as a fact without being one.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UserFacet {
    pub value: String,
    /// A place's name beside its id. Absent for a role or a state, whose words
    /// belong to the screen.
    pub label: Option<String>,
    pub count: i64,
}

/// The three things the account list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UserFacets {
    pub roles: Vec<UserFacet>,
    /// `ACTIVE`, `LEFT_OPEN` (open, but its employee has left) and
    /// `DISABLED`. A disabled account is kept rather than deleted
    /// — usernames are never released — so the count is the only way to see how
    /// many of them there are.
    pub states: Vec<UserFacet>,
    /// Where the person behind each login is posted. Silent about accounts
    /// posted nowhere: machine accounts and unfinished paperwork are both real,
    /// but the filter has no spelling for "nowhere" and a count nobody can
    /// click is worse than no count.
    pub units: Vec<UserFacet>,
}

/// A page of logins, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UserList {
    pub rows: Vec<UserRow>,
    pub next_cursor: Option<String>,
    /// Exact. Every login the search and the filters match.
    pub total: i64,
    pub facets: UserFacets,
}

/// What a caller is asking the account list for.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UserScope {
    /// Free text over the login, the display name, the employee number and the
    /// colleague's name.
    ///
    /// Four columns, and every one of them names a COLLEAGUE rather than a
    /// customer — the same rule `EmployeeScope::needle` states. The join
    /// reaches `employee_profile`, which also holds a NIK, a birth date, an
    /// address and a phone; none of them is searchable here, and `UserRow`
    /// carries none of them. A search that reached into the profile would let
    /// somebody confirm a national identity number they already hold without
    /// ever being granted `people.profile.read`.
    #[serde(default)]
    pub q: Option<String>,
    /// `CASHIER`, `SUPERVISOR` or `ADMIN`.
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub active: Option<bool>,
    /// Where the person behind the login is posted.
    #[serde(default)]
    pub unit_id: Option<String>,
    /// `ACTIVE`, `LEFT_OPEN` or `DISABLED` — the three-way state the facet
    /// counts. `LEFT_OPEN` is an open login whose employee has been
    /// terminated. Composes with `active`, which it refines.
    #[serde(default)]
    pub state: Option<String>,
    /// `username`, `role`, `created` or `last_login`. Anything else is
    /// `username` rather than a 400, so a stale bookmark still opens.
    #[serde(default)]
    pub sort: Option<String>,
    /// `desc` and nothing else. Absent means ascending — the console is read
    /// alphabetically.
    #[serde(default)]
    pub dir: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// Where the previous page stopped — as a ROW, not a position.
#[derive(serde::Serialize, serde::Deserialize)]
struct UserCursor {
    id: Uuid,
}

impl UserCursor {
    fn encode(&self) -> Result<String, AppError> {
        Ok(hex::encode(serde_json::to_vec(self)?))
    }

    fn decode(raw: &str) -> Result<Self, AppError> {
        let bytes = hex::decode(raw).map_err(|_| {
            AppError::Validation("cursor is not a cursor this server issued".into())
        })?;
        serde_json::from_slice(&bytes)
            .map_err(|_| AppError::Validation("cursor is not a cursor this server issued".into()))
    }
}

const USER_DEFAULT_LIMIT: i64 = 200;
const USER_MAX_LIMIT: i64 = 1_000;

/// One account row, defined once.
///
/// Used by the page query and by the facet counts, which is the whole reason it
/// is a constant: the facets are only honest if they count exactly what the
/// page can show.
///
/// It stops at the SEARCH; the role, state and place filters are applied
/// outside by each caller, so one definition answers two questions.
///
/// `login_key` is the trap this list carries: `last_login_at` is NULL for an
/// account nobody has ever signed in to, a row comparison against NULL is NULL
/// rather than true, and paging by it would therefore stop dead at the first
/// never-used login — which on a console whose job is spotting stale
/// credentials is exactly the row you were looking for. `-infinity` is the
/// sentinel, and it also sorts never-used accounts last under a descending
/// read, where somebody asking "who signed in recently" expects them.
///
/// Binds: `$1` the search pattern or NULL.
const USER_ROWS: &str = "
    SELECT u.id, u.username, u.display_name, u.role, u.active, u.created_by,
           u.created_at, u.last_login_at,
           CASE WHEN u.login_blocked_until > now() THEN u.login_blocked_until
           END AS login_blocked_until,
           u.employee_id, e.code AS employee_code, e.status AS employee_status,
           p.full_name AS employee_name,
           a.unit_id, unit.name AS unit_name,
           u.role_code, jr.name AS role_name, jr.node_reach,
           -- Three states, not two: an open login for somebody whose
           -- employment has ended is a working credential for a person who
           -- has gone, and it is the row the console is opened to find.
           CASE WHEN u.active AND e.status = 'TERMINATED' THEN 'LEFT_OPEN'
                WHEN u.active THEN 'ACTIVE'
                ELSE 'DISABLED' END AS state,
           COALESCE(u.last_login_at, TIMESTAMPTZ '-infinity') AS login_key
      FROM app_user u
      LEFT JOIN employee e ON e.id = u.employee_id
      LEFT JOIN employee_profile p ON p.employee_id = e.id
      LEFT JOIN employee_assignment a
             ON a.employee_id = e.id AND a.valid_to IS NULL
      LEFT JOIN unit unit ON unit.id = a.unit_id
      LEFT JOIN job_role jr ON jr.code = u.role_code
     -- A login, a name, a badge number and the name on the badge. Not the
     -- personal data the profile join happens to reach — see `UserScope::q`.
     WHERE ($1::text IS NULL
            OR u.username ILIKE $1
            OR u.display_name ILIKE $1
            OR COALESCE(e.code, '') ILIKE $1
            OR COALESCE(p.full_name, '') ILIKE $1)
";

/// Every filter, in one place, so the page and the total cannot drift.
const USER_FILTERS: &str = "
    WHERE ($2::text IS NULL OR role = $2)
      AND ($3::bool IS NULL OR active = $3)
      AND ($4::text IS NULL OR unit_id = $4)
      AND ($5::text IS NULL OR state = $5)
";

/// Every login, one page at a time, beside exactly how many there are.
///
/// The employment join is what makes this a console rather than a list of
/// credentials with nobody behind them: it answers the two questions an
/// administrator actually opens it with — which of these are people and which
/// are machines, and which belong to somebody who no longer works here.
pub async fn list_users(pool: &PgPool, scope: UserScope) -> Result<UserList, AppError> {
    // A blank search is not a search: `Some("")` compiles to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = scope
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{value}%"));

    // The sort, and the tie-break that makes it total. Every order ends in the
    // account id, which is the primary key, so no two rows can compare equal.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not.
    let lead = match scope.sort.as_deref() {
        Some("role") => "role",
        Some("created") => "created_at",
        Some("last_login") => "login_key",
        _ => "username",
    };
    let descending = scope.dir.as_deref() == Some("desc");
    let cols = format!("{lead}, id");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!("{lead} {dir}, id {dir}");
    let seek = if descending { "<" } else { ">" };

    let cursor = scope
        .cursor
        .as_deref()
        .map(UserCursor::decode)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(USER_DEFAULT_LIMIT)
        .clamp(1, USER_MAX_LIMIT);

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    // The servers are read for the page only, after the limit: the facet
    // counts below share `USER_ROWS` and have no use for them.
    let rows = sqlx::query(&format!(
        "WITH searched AS NOT MATERIALIZED ({USER_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched {USER_FILTERS}
         ),
              page AS (
             SELECT * FROM kept
              WHERE $6::uuid IS NULL
                 OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE id = $6)
              ORDER BY {order}
              LIMIT $7
         )
         SELECT page.*,
                (SELECT COALESCE(json_agg(json_build_object(
                            'origin_id', ea.origin_id, 'label', o.label,
                            'site_id', o.site_id, 'site_name', st.name,
                            'node_role', o.node_role, 'edge_role', ea.edge_role,
                            'active', ea.active AND page.active,
                            'derived', ea.source = 'ROLE')
                          ORDER BY ea.origin_id), '[]'::json)
                   FROM edge_identity_assignment ea
                   JOIN sync_origin_credential o ON o.origin_id = ea.origin_id
                   LEFT JOIN site st ON st.id = o.site_id
                  WHERE ea.user_id = page.id) AS nodes
           FROM page
          ORDER BY {order}"
    ))
    .bind(&needle)
    .bind(&scope.role)
    .bind(scope.active)
    .bind(&scope.unit_id)
    .bind(&scope.state)
    .bind(cursor.as_ref().map(|one| one.id))
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            UserCursor {
                id: row.try_get("id")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let out = rows
        .iter()
        .map(|row| {
            Ok(UserRow {
                id: row.try_get("id")?,
                username: row.try_get("username")?,
                display_name: row.try_get("display_name")?,
                role: row.try_get("role")?,
                active: row.try_get("active")?,
                created_by: row.try_get("created_by")?,
                created_at: row.try_get("created_at")?,
                last_login_at: row.try_get("last_login_at")?,
                login_blocked_until: row.try_get("login_blocked_until")?,
                employee_id: row.try_get("employee_id")?,
                employee_code: row.try_get("employee_code")?,
                employee_status: row.try_get("employee_status")?,
                employee_name: row.try_get("employee_name")?,
                unit_id: row.try_get("unit_id")?,
                unit_name: row.try_get("unit_name")?,
                role_code: row.try_get("role_code")?,
                role_name: row
                    .try_get::<Option<String>, _>("role_name")?
                    .unwrap_or_default(),
                node_reach: row
                    .try_get::<Option<String>, _>("node_reach")?
                    .unwrap_or_else(|| "NONE".to_owned()),
                nodes: serde_json::from_value(row.try_get::<Value, _>("nodes")?)?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    let counted = sqlx::query(&format!(
        "WITH searched AS ({USER_ROWS}), kept AS (
             SELECT * FROM searched {USER_FILTERS}
         )
         SELECT 'role' AS facet, role AS value, NULL::text AS label,
                COUNT(*)::bigint AS n
           FROM searched GROUP BY role
          UNION ALL
         SELECT 'state', state, NULL::text, COUNT(*)::bigint
           FROM searched GROUP BY state
          UNION ALL
         SELECT 'unit', unit_id, unit_name, COUNT(*)::bigint
           FROM searched WHERE unit_id IS NOT NULL
          GROUP BY unit_id, unit_name
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM kept"
    ))
    .bind(&needle)
    .bind(&scope.role)
    .bind(scope.active)
    .bind(&scope.unit_id)
    .bind(&scope.state)
    .fetch_all(pool)
    .await?;

    let mut total = 0i64;
    let (mut roles, mut states, mut units) = (Vec::new(), Vec::new(), Vec::new());
    for row in &counted {
        let facet: String = row.try_get("facet")?;
        let one = UserFacet {
            value: row.try_get("value")?,
            label: row.try_get("label")?,
            count: row.try_get("n")?,
        };
        match facet.as_str() {
            "role" => roles.push(one),
            "state" => states.push(one),
            "unit" => units.push(one),
            _ => total = one.count,
        }
    }
    for list in [&mut roles, &mut states, &mut units] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }

    Ok(UserList {
        rows: out,
        next_cursor,
        total,
        facets: UserFacets {
            roles,
            states,
            units,
        },
    })
}

/// Promote or demote somebody at Cloud.
///
/// Without this a promotion meant abandoning the account and making a new one,
/// which — since usernames are never released and there is no delete — spent
/// the person's name permanently and split their history in two.
///
/// The role change revokes their live sessions rather than letting them run on.
/// A session is the thing that carries authority around, and one issued before
/// a demotion would otherwise keep the authority the demotion just removed.
pub async fn set_user_role(
    pool: &PgPool,
    user_id: Uuid,
    request: SetUserRoleRequest,
    actor_username: &str,
) -> Result<Value, AppError> {
    let row = sqlx::query("SELECT username,role,role_code FROM app_user WHERE id=$1")
        .bind(user_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("user".into()))?;
    let username: String = row.get("username");
    // Same reason an administrator cannot deactivate themselves: the node must
    // always keep at least one usable administrator, and demoting yourself is
    // the other way to end up with none.
    if username == actor_username {
        return Err(AppError::Conflict("cannot change your own role".into()));
    }
    // The job role when one is named (0633) — the rung follows it; a bare
    // rung, from a screen that predates job roles, gives that rung's default
    // role. The last owner is kept by the database either way.
    let role_code = known_role_code(pool, request.role_code.as_deref()).await?;
    let was_owner = row.get::<String, _>("role_code") == OWNER_ROLE;
    owner_only(
        pool,
        actor_username,
        was_owner || role_code.as_deref() == Some(OWNER_ROLE),
    )
    .await?;
    if role_code.is_none() && request.role.is_none() {
        return Err(AppError::Validation("name the job role (role_code)".into()));
    }
    let previous: String = row.get("role");
    let previous_code: String = row.get("role_code");
    let mut tx = pool.begin().await?;
    match &role_code {
        Some(code) => {
            sqlx::query(
                "UPDATE app_user SET role_code=$2,auth_version=auth_version+1,updated_at=now()
                  WHERE id=$1",
            )
            .bind(user_id)
            .bind(code)
            .execute(&mut *tx)
            .await?;
        }
        None => {
            sqlx::query(
                "UPDATE app_user SET role=$2,auth_version=auth_version+1,updated_at=now()
                  WHERE id=$1",
            )
            .bind(user_id)
            .bind(request.role.map(|role| role.as_str()))
            .execute(&mut *tx)
            .await?;
        }
    }
    sqlx::query("UPDATE auth_session SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    // Which servers they sign in at follows the role (0635).
    let origins = super::reconcile_node_access_tx(&mut tx, Some(user_id), actor_username).await?;
    let (role, now_code): (String, String) =
        sqlx::query_as("SELECT role, role_code FROM app_user WHERE id=$1")
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await?;
    tx.commit().await?;
    super::publish_node_access(pool, &origins, actor_username).await;
    tracing::info!(
        actor = actor_username,
        subject = username.as_str(),
        from = previous_code.as_str(),
        to = now_code.as_str(),
        "administrator changed a role"
    );
    Ok(json!({
        "username": username,
        "role": role,
        "role_code": now_code,
        "previous_role": previous,
        "previous_role_code": previous_code,
        // The servers whose sign-in list this changed, now told (0635). A
        // hand grant made in System > Access is not touched by a role change.
        "servers_changed": origins,
    }))
}

pub async fn set_user_active(
    pool: &PgPool,
    user_id: Uuid,
    active: bool,
    actor_username: &str,
) -> Result<Value, AppError> {
    // An admin cannot deactivate their own account: the node must always
    // retain at least one usable administrator.
    let row = sqlx::query("SELECT username,role_code FROM app_user WHERE id=$1")
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
    owner_only(
        pool,
        actor_username,
        row.get::<String, _>("role_code") == OWNER_ROLE,
    )
    .await?;
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

/// Lift a lockout that wrong passwords put on a login, before it runs out on
/// its own. The counters go with it, so the next wrong password starts a
/// fresh count rather than locking again at once.
pub async fn unlock_user(pool: &PgPool, user_id: Uuid) -> Result<Value, AppError> {
    let row = sqlx::query(
        "UPDATE app_user
            SET failed_login_count=0,failed_login_window_started_at=NULL,
                login_blocked_until=NULL,updated_at=now()
          WHERE id=$1
      RETURNING username",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("user".into()))?;
    let username: String = row.get("username");
    Ok(json!({ "id": user_id, "username": username, "unlocked": true }))
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
             login_blocked_until=NULL,must_change_password=false
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
    // A server this login signs in at by role checks this very password
    // (0635), so it is told now rather than at the next lease renewal.
    super::tell_derived_servers(pool, user_id, username).await;
    Ok(json!({ "username": username, "changed": true }))
}

/// The job role that owns the company (0633).
pub const OWNER_ROLE: &str = "OWNER";

/// Only an Owner acts on an Owner (24 Oct 2026): sets their password, suspends
/// them, moves them to another role, or makes somebody an Owner — invited, or
/// promoted. An Admin could do all four before, which made the Owner whoever
/// last reset the Owner's password. `touches_owner` says whether the act is
/// one of those; a clock or a sync acting by itself names no account
/// (`system:…`) and is held by the rule that started it.
pub async fn owner_only(
    pool: &PgPool,
    actor_username: &str,
    touches_owner: bool,
) -> Result<(), AppError> {
    if !touches_owner {
        return Ok(());
    }
    let actor: Option<String> =
        sqlx::query_scalar("SELECT role_code FROM app_user WHERE username = $1")
            .bind(actor_username)
            .fetch_optional(pool)
            .await?;
    match actor.as_deref() {
        None | Some(OWNER_ROLE) => Ok(()),
        Some(_) => Err(AppError::Forbidden(
            "only an Owner may change an Owner's account, or make somebody an Owner".into(),
        )),
    }
}

/// An administrator sets a new password for somebody who cannot supply the old
/// one. This is the only way out of a forgotten password: usernames are never
/// released and there is no delete, so without it a forgotten password retires
/// the account and burns its name permanently.
///
/// Everything a self-service change does, this does too — the auth_version
/// bump, the lockout reset, and the revocation of every live session for that
/// user. A password nobody knew is a password that may have been learned, so
/// the sessions standing on it do not survive the reset.
pub async fn admin_reset_password(
    pool: &PgPool,
    user_id: Uuid,
    request: ResetPasswordRequest,
    actor_username: &str,
) -> Result<Value, AppError> {
    let row = sqlx::query("SELECT username,active,role_code FROM app_user WHERE id=$1")
        .bind(user_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("user".into()))?;
    let username: String = row.get("username");
    owner_only(
        pool,
        actor_username,
        row.get::<String, _>("role_code") == OWNER_ROLE,
    )
    .await?;
    let new_hash = hash_password(&request.new_password).await?;
    let mut tx = pool.begin().await?;
    sqlx::query(
        // A password an administrator set is a temporary one: the person
        // chooses their own at the next sign-in (0980, owner 2026-10-18).
        "UPDATE app_user
         SET password_hash=$2,auth_version=auth_version+1,updated_at=now(),
             failed_login_count=0,failed_login_window_started_at=NULL,
             login_blocked_until=NULL,must_change_password=true
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
    super::tell_derived_servers(pool, user_id, actor_username).await;
    tracing::info!(
        actor = actor_username,
        subject = username.as_str(),
        "administrator reset a password"
    );
    Ok(json!({
        "username": username,
        "reset": true,
        // Says plainly that the account is still suspended, so an administrator
        // who resets a password and expects the person to get back in is told
        // that a second decision is outstanding.
        "active": row.get::<bool, _>("active"),
    }))
}

/// Issue a login to somebody who has none: create the account, set its rung,
/// bind it to their employment record, and — when they work at a node — grant
/// them a till.
///
/// # Why this is one call and not four
///
/// It used to be four, spread over two modules of the console: create the
/// account under System › Accounts, find the person again under People, bind
/// the two, then go back to System › Access to grant the till and publish the
/// policy. Every join between those steps is a place the sequence stops, and
/// each way of stopping leaves a different mess: an account belonging to
/// nobody, a person with a credential that opens no door, a grant at a node
/// whose policy was never published — which looks exactly like a working setup
/// until the person tries to sign in, days later, in front of a queue.
///
/// The account and the binding are one transaction, because those two are the
/// pair that must never come apart: a credential that exists and belongs to
/// nobody is the one failure that cannot be seen from any screen.
///
/// The till grant is deliberately *not* in that transaction. It reaches a
/// different node and ends by publishing a policy, and a failure there is both
/// visible (the person has an account and no till) and repairable from System ›
/// Access. What it must not do is fail quietly, so it does not: the error names
/// what was created and what was not.
///
/// # The two roles are two decisions
///
/// `role` is the rung at the centre, on `app_user`; `edge_role` is the rung at
/// the till, on `edge_identity_assignment`. They are separate columns because
/// they are separate facts — a supervisor at head office may be a cashier at a
/// shop she is covering — and this call keeps them separate rather than
/// helpfully copying one into the other.
pub async fn provision_account(
    pool: &PgPool,
    employee_id: &str,
    request: ProvisionAccountRequest,
    authorization: &crate::cloud::domain::Authorization,
) -> Result<ProvisionedAccount, AppError> {
    let username = normalize_username(&request.username)?;
    let display_name = request.display_name.trim().to_owned();
    if display_name.is_empty() || display_name.len() > 128 {
        return Err(AppError::Validation(
            "display_name must be 1-128 characters".into(),
        ));
    }
    // Hashed before the transaction opens: argon2id is deliberately slow, and
    // holding a row lock across it would make issuing one account contend with
    // every other write to that employee.
    let role_code = known_role_code(pool, request.role_code.as_deref()).await?;
    let hash = hash_password(&request.password).await?;
    let actor = authorization.actor().to_string();

    let mut tx = pool.begin().await?;
    let user_id = Uuid::new_v4();
    let created = sqlx::query(
        "INSERT INTO app_user(id,username,display_name,password_hash,role,role_code,created_by) \
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (username) DO NOTHING",
    )
    .bind(user_id)
    .bind(&username)
    .bind(&display_name)
    .bind(hash)
    .bind(request.role.as_str())
    .bind(role_code.as_deref())
    .bind(&actor)
    .execute(&mut *tx)
    .await?;
    if created.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "username '{username}' already exists"
        )));
    }
    super::bind_new_account(&mut tx, employee_id, user_id, authorization).await?;
    // The servers their role and posting reach (0635), in the same
    // transaction as the account: a login that exists and cannot sign in
    // where it works is the gap this closes.
    let origins = super::reconcile_node_access_tx(&mut tx, Some(user_id), &actor).await?;
    tx.commit().await?;
    super::publish_node_access(pool, &origins, &actor).await;

    let Some(edge) = request.edge else {
        return Ok(ProvisionedAccount {
            user_id,
            username,
            display_name,
            role: request.role.as_str().to_owned(),
            employee_id: employee_id.to_owned(),
            edge_origin_id: None,
            edge_role: None,
            policy_version: None,
        });
    };

    let granted = super::upsert_edge_assignment(
        pool,
        crate::cloud::application::UpsertEdgeAssignmentRequest {
            origin_id: edge.origin_id.clone(),
            user_id,
            role: edge.role,
            edge_password: edge.edge_password,
            offline_ttl_seconds: edge.offline_ttl_seconds,
        },
        &actor,
    )
    .await
    .map_err(|error| {
        // Never swallowed. The account is committed; a bare 500 here would
        // leave an administrator believing nothing happened and creating the
        // same username again.
        AppError::Configuration(format!(
            "the account {username} was created and bound to {employee_id}, but access to \
             {} could not be granted: {error}. Grant it in System > Access.",
            edge.origin_id
        ))
    })?;

    Ok(ProvisionedAccount {
        user_id,
        username,
        display_name,
        role: request.role.as_str().to_owned(),
        employee_id: employee_id.to_owned(),
        edge_origin_id: Some(edge.origin_id),
        edge_role: Some(edge.role.as_str().to_owned()),
        policy_version: granted
            .get("policy")
            .and_then(|policy| policy.get("version"))
            .and_then(Value::as_i64),
    })
}

/// Whether the signed-in person must choose a new password before using the
/// hub: true after an administrator set a temporary one (0980).
pub async fn must_change_password(pool: &PgPool, username: &str) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar("SELECT must_change_password FROM app_user WHERE username = $1")
            .bind(username)
            .fetch_optional(pool)
            .await?
            .unwrap_or(false),
    )
}
