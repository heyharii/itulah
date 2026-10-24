//! Cloud-owned Edge identity and RFID policy publication.
//!
//! Permanent assignments are single-writer Cloud state. A complete projection
//! is delivered to exactly one Edge through the existing signed command lane,
//! which gives ordering, retry, acknowledgement, and anti-replay without a
//! second synchronization protocol.
//!
//! # The password a server checks
//!
//! A store server signs a person in offline with the same password as the
//! hub: the server holds the cloud password hash (owner's decision, 28 Sep
//! 2026). A store must sign people in with the line to head office down, so
//! an exchange with the cloud at sign-in cannot work there, and nobody types
//! a per-server password. So for every grant derived from the job role and
//! posting (`source = 'ROLE'`, 0635) the policy carries the login's own
//! argon2id verifier, `app_user.password_hash`, read at publication time: a
//! password changed at the hub reaches the servers with the next publication
//! ([`tell_derived_servers`]).
//!
//! This replaces the older rule that the edge never receives the cloud
//! password. What bounds it: a server is sent verifiers only for the people
//! whose role and posting put them there; argon2id makes each guess
//! expensive; the lockout counts at the server as it does at the centre; and
//! suspending the login closes every server at once. A grant made by hand
//! (`source = 'MANUAL'`) still carries its own separate credential.

use crate::{
    cloud::{
        application::{
            AppError, RegisterRfidDeviceRequest, SetEdgeAssignmentActiveRequest,
            SetRfidDeviceActiveRequest, SetRfidDeviceKindRequest, UpsertEdgeAssignmentRequest,
        },
        domain::{
            auth_policy_content_hash, AuthPolicyDevice, AuthPolicySnapshot, AuthPolicyUser, Role,
            SiteProfile, COMMAND_AUTH_POLICY_REPLACE,
        },
    },
    edge::{EdgeRole, NodeContext, OperationalPool, SiteId},
    security,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::{collections::BTreeMap, str::FromStr};
use uuid::Uuid;

use super::{hash_edge_credential, issue_command};

const DEFAULT_OPERATOR_TTL_SECONDS: i32 = 7 * 24 * 60 * 60;
const DEFAULT_PRIVILEGED_TTL_SECONDS: i32 = 24 * 60 * 60;
const MIN_TTL_SECONDS: i32 = 15 * 60;
const MAX_TTL_SECONDS: i32 = 30 * 24 * 60 * 60;

fn assignment_ttl(role: Role, offered: Option<i32>) -> Result<i32, AppError> {
    let default = match role {
        Role::Cashier => DEFAULT_OPERATOR_TTL_SECONDS,
        Role::Supervisor | Role::Admin => DEFAULT_PRIVILEGED_TTL_SECONDS,
    };
    let ttl = offered.unwrap_or(default);
    if !(MIN_TTL_SECONDS..=MAX_TTL_SECONDS).contains(&ttl) {
        return Err(AppError::Validation(format!(
            "offline_ttl_seconds must be between {MIN_TTL_SECONDS} and {MAX_TTL_SECONDS}"
        )));
    }
    if role != Role::Cashier && ttl > DEFAULT_PRIVILEGED_TTL_SECONDS {
        return Err(AppError::Validation(
            "SUPERVISOR and ADMIN Edge leases cannot exceed 24 hours".into(),
        ));
    }
    Ok(ttl)
}

async fn origin_node(pool: &PgPool, origin_id: &str) -> Result<NodeContext, AppError> {
    let row = sqlx::query(
        "SELECT site_id,node_role,inventory_enabled FROM sync_origin_credential WHERE origin_id=$1",
    )
    .bind(origin_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("registered Edge origin".into()))?;
    let site_id: Option<String> = row.get("site_id");
    let node_role: Option<String> = row.get("node_role");
    let enabled: bool = row.get("inventory_enabled");
    if !enabled {
        return Err(AppError::Validation(
            "auth policy requires an inventory-enabled Edge origin".into(),
        ));
    }
    let site_id = SiteId::new(
        site_id.ok_or_else(|| AppError::Configuration("Edge origin has no site binding".into()))?,
    )
    .map_err(|error| AppError::Configuration(error.to_string()))?;
    let role = EdgeRole::from_str(
        &node_role
            .ok_or_else(|| AppError::Configuration("Edge origin has no role binding".into()))?,
    )
    .map_err(|error| AppError::Configuration(error.to_string()))?;
    NodeContext::new(origin_id, role, site_id)
        .map_err(|error| AppError::Configuration(error.to_string()))
}

/// Resolve the Cloud identity only when it has an active assignment at a
/// registered DC. The signed ticket carries the user id and destination; the
/// receiving DC still decides the role from its local policy projection.
pub async fn edge_sso_subject(
    pool: &PgPool,
    origin_id: &str,
    username: &str,
) -> Result<Uuid, AppError> {
    let origin = origin_node(pool, origin_id).await?;
    if origin.role != EdgeRole::Dc {
        return Err(AppError::Forbidden(
            "Cloud sign-in exchange is available only for DC nodes".into(),
        ));
    }
    sqlx::query_scalar(
        "SELECT u.id
         FROM app_user u
         JOIN edge_identity_assignment a ON a.user_id=u.id
         WHERE a.origin_id=$1 AND u.username=$2 AND a.active AND u.active",
    )
    .bind(origin_id)
    .bind(username)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::Forbidden("no active Cloud access assignment for this DC".into()))
}

/// Who a node is relaying for, as the cloud knows them.
#[derive(Clone, Debug)]
pub struct RelaySubject {
    pub username: String,
    pub display_name: String,
    /// Their rung at the cloud.
    pub role: Role,
    /// The rung their assignment grants at the relaying node. A relayed call
    /// acts with the lower of the two.
    pub edge_role: Role,
    /// Their job role (0633).
    pub job: crate::cloud::domain::job_role::JobGrant,
}

/// The person a node says it is relaying for — only if they may sign in there.
///
/// The node proves which node it is with its key; it cannot prove which person
/// is standing at its till, so the cloud believes the person only as far as
/// its own register agrees: an active login, with an active assignment at THIS
/// origin. A login the cloud has switched off, or an assignment it has revoked,
/// stops relaying on the next call — not at the next policy sync, which is the
/// gap a relayed call must not inherit from the offline lease.
pub async fn relay_subject(
    pool: &PgPool,
    origin_id: &str,
    user_id: Uuid,
) -> Result<RelaySubject, AppError> {
    let row = sqlx::query(
        "SELECT u.username, u.display_name, u.role, a.edge_role,
                u.role_code, r.name AS role_name, r.flow_roles, r.sections, r.read_only, r.unit_reach
           FROM app_user u
           JOIN edge_identity_assignment a ON a.user_id = u.id
           LEFT JOIN job_role r ON r.code = u.role_code
          WHERE a.origin_id = $1 AND u.id = $2 AND a.active AND u.active",
    )
    .bind(origin_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        AppError::Forbidden(format!(
            "nobody with an active assignment at {origin_id} has that id, so there is nobody \
             this node may relay for"
        ))
    })?;
    let rung = |column: &str| -> Result<Role, AppError> {
        Role::from_str(&row.get::<String, _>(column))
            .map_err(|error| AppError::Configuration(error.to_string()))
    };
    Ok(RelaySubject {
        username: row.get("username"),
        display_name: row.get("display_name"),
        role: rung("role")?,
        edge_role: rung("edge_role")?,
        job: super::job_grant_of(&row)?,
    })
}

/// What kind of site a relaying node stands in — `STORE` or `DC`.
///
/// Carried on a relayed call because a company-wide row names a kind rather
/// than a site: a contract covering `ALL_STORES` is store-07's contract too,
/// and a DC's never.
pub async fn relay_site_kind(pool: &PgPool, site_id: &str) -> Result<String, AppError> {
    sqlx::query_scalar("SELECT kind FROM site WHERE id = $1")
        .bind(site_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Forbidden(format!("{site_id} is not a site this cloud knows")))
}

pub async fn upsert_edge_assignment(
    pool: &PgPool,
    request: UpsertEdgeAssignmentRequest,
    actor: &str,
) -> Result<Value, AppError> {
    let origin_id = request.origin_id.trim().to_string();
    let origin = origin_node(pool, &origin_id).await?;
    // The wire role becomes Cloud's own at the boundary: the policy decisions
    // below (the TTL ceiling, the role ladder) belong to `cloud::domain::Role`,
    // not to the shape a browser posted.
    let role: Role = request.role.into();
    let ttl = assignment_ttl(role, request.offline_ttl_seconds)?;
    let credential_hash = request
        .edge_password
        .as_deref()
        .filter(|password| !password.is_empty())
        .map(hash_edge_credential)
        .transpose()?;
    let exists = sqlx::query("SELECT 1 FROM app_user WHERE id=$1")
        .bind(request.user_id)
        .fetch_optional(pool)
        .await?
        .is_some();
    if !exists {
        return Err(AppError::NotFound("user".into()));
    }
    // A DC signs people in with their Cloud session, so a DC grant needs no
    // password of its own. A store has no such exchange: a new store grant
    // without one is a grant nobody can use.
    if credential_hash.is_none() && origin.role != EdgeRole::Dc {
        let granted =
            sqlx::query("SELECT 1 FROM edge_identity_assignment WHERE origin_id=$1 AND user_id=$2")
                .bind(&origin_id)
                .bind(request.user_id)
                .fetch_optional(pool)
                .await?
                .is_some();
        if !granted {
            return Err(AppError::Validation(
                "a store grant needs a password at that node: stores have no Cloud sign-in".into(),
            ));
        }
    }
    sqlx::query(
        "INSERT INTO edge_identity_assignment
             (origin_id,user_id,edge_role,credential_hash,active,auth_version,
              offline_ttl_seconds,created_by)
         VALUES($1,$2,$3,COALESCE($4,$7),true,1,$5,$6)
         ON CONFLICT(origin_id,user_id) DO UPDATE SET
             edge_role=EXCLUDED.edge_role,
             -- No password on an existing grant means keep the one it has:
             -- changing somebody's role is not taking their password away.
             credential_hash=COALESCE($4,edge_identity_assignment.credential_hash),
             -- A password typed here makes the grant a hand grant (0635): the
             -- derivation leaves it alone from now on. Without one, a derived
             -- grant stays derived — its credential is the login's own.
             source=CASE WHEN $4 IS NULL THEN edge_identity_assignment.source
                         ELSE 'MANUAL' END,
             -- Deliberately NOT active=true. Rotating somebody's Edge PIN and
             -- restoring their access are two different decisions, and this
             -- upsert is how a PIN gets rotated. Forcing active here meant an
             -- administrator handing out a new PIN silently readmitted a
             -- suspended operator. Restoring access is
             -- POST /auth/edge-assignments/{origin}/{user}/active, which says
             -- so out loud. A brand-new row still starts active, from VALUES.
             auth_version=edge_identity_assignment.auth_version+1,
             offline_ttl_seconds=EXCLUDED.offline_ttl_seconds,updated_at=now()",
    )
    .bind(&origin_id)
    .bind(request.user_id)
    .bind(role.as_str())
    .bind(credential_hash)
    .bind(ttl)
    .bind(actor)
    .bind(crate::security::SSO_ONLY_VERIFIER)
    .execute(pool)
    .await?;
    let policy = publish_auth_policy(pool, &origin_id, actor).await?;
    Ok(json!({
        "origin_id":origin_id,
        "user_id":request.user_id,
        "role":request.role.as_str(),
        "active":true,
        "offline_ttl_seconds":ttl,
        "policy":policy,
    }))
}

pub async fn set_edge_assignment_active(
    pool: &PgPool,
    origin_id: &str,
    user_id: Uuid,
    request: SetEdgeAssignmentActiveRequest,
    actor: &str,
) -> Result<Value, AppError> {
    let result = sqlx::query(
        "UPDATE edge_identity_assignment
         SET active=$3,auth_version=auth_version+1,updated_at=now()
         WHERE origin_id=$1 AND user_id=$2",
    )
    .bind(origin_id)
    .bind(user_id)
    .bind(request.active)
    .execute(pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Edge user assignment".into()));
    }
    let policy = publish_auth_policy(pool, origin_id, actor).await?;
    Ok(json!({
        "origin_id":origin_id,
        "user_id":user_id,
        "active":request.active,
        "policy":policy,
    }))
}

// ── who may sign in at which node ────────────────────────────────────────
//
// `system/access` is an AUDIT SURFACE, and that changes one thing about the
// shape below: every number it reports is an exact `COUNT(*)`, never an
// estimate. "Roughly nine people can sign in at store-03" reads as a fact and
// is not one, and on a screen whose whole job is answering "who has access
// where" a rough count is worse than no count.

/// One grant, as the access list shows it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EdgeAssignmentRow {
    pub origin_id: String,
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    /// Spelled `role` on the wire where the column is `edge_role`, because that
    /// is what this route has always answered and three screens read it.
    pub role: String,
    pub active: bool,
    pub offline_ttl_seconds: i32,
    pub updated_at: DateTime<Utc>,
}

/// One value a filter can take, and how many grants would still be there.
/// Exact — see the note above. Counted over what the SEARCH leaves, ignoring
/// the filters currently applied.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccessFacet {
    pub value: String,
    /// A person's display name beside their username, where the value is a
    /// username. Absent for a node or a role, whose words belong to the screen.
    pub label: Option<String>,
    pub count: i64,
}

/// The three things the access list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EdgeAssignmentFacets {
    pub origins: Vec<AccessFacet>,
    pub roles: Vec<AccessFacet>,
    /// `ACTIVE` and `SUSPENDED`. A suspended grant is kept rather than deleted,
    /// which is the whole reason it has to be countable: "nobody is suspended"
    /// and "we deleted the evidence" must not look the same.
    pub states: Vec<AccessFacet>,
}

/// A page of grants, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EdgeAssignmentList {
    pub rows: Vec<EdgeAssignmentRow>,
    pub next_cursor: Option<String>,
    /// Exact, always. Every grant the search and the filters match.
    pub total: i64,
    pub facets: EdgeAssignmentFacets,
}

/// What a caller is asking the access list for.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EdgeAssignmentScope {
    /// Free text over the node, the login and the colleague's name. All three
    /// name a node or a colleague; none of them is a customer's anything.
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub origin_id: Option<String>,
    /// `CASHIER`, `SUPERVISOR` or `ADMIN`, as the edge spells them.
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub active: Option<bool>,
    /// `origin`, `username`, `updated` or `lease` (the offline lease, the
    /// access screen's decision metric). Anything else is `origin` rather than
    /// a 400, so a stale bookmark still opens.
    #[serde(default)]
    pub sort: Option<String>,
    /// `desc` and nothing else. Absent means ascending — the access list is
    /// read node by node, from the first.
    #[serde(default)]
    pub dir: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// Where the previous page stopped — as a ROW, not a position.
///
/// Two fields because the table's key is two: one node and one person. A cursor
/// carrying only the user id would stop at the first person granted access at
/// two shops, which is most supervisors.
#[derive(Serialize, Deserialize)]
struct AssignmentCursor {
    origin_id: String,
    user_id: Uuid,
}

impl AssignmentCursor {
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

const ACCESS_DEFAULT_LIMIT: i64 = 200;
const ACCESS_MAX_LIMIT: i64 = 1_000;

/// One grant row, defined once.
///
/// Used by the page query and by the facet counts, which is the whole reason it
/// is a constant: the facets are only honest if they count exactly what the
/// page can show.
///
/// It stops at the SEARCH; the node, role and state filters are applied outside
/// by each caller, so one definition answers two questions.
///
/// Every column a sort can name is NOT NULL — `origin_id`, `username`,
/// `updated_at` — so no `COALESCE` sentinel is needed. Worth stating rather
/// than rediscovering: a row comparison against NULL is NULL rather than true,
/// so a nullable sort key added here would end paging at the first NULL, in
/// silence.
///
/// Binds: `$1` the search pattern or NULL.
const ASSIGNMENT_ROWS: &str = "
    SELECT a.origin_id, a.user_id, u.username, u.display_name,
           a.edge_role AS role, a.active, a.offline_ttl_seconds, a.updated_at,
           CASE WHEN a.active THEN 'ACTIVE' ELSE 'SUSPENDED' END AS state
      FROM edge_identity_assignment a
      JOIN app_user u ON u.id = a.user_id
     WHERE ($1::text IS NULL
            OR a.origin_id ILIKE $1
            OR u.username ILIKE $1
            OR u.display_name ILIKE $1)
";

/// Every filter, in one place, so the page and the total cannot drift.
const ASSIGNMENT_FILTERS: &str = "
    WHERE ($2::text IS NULL OR origin_id = $2)
      AND ($3::text IS NULL OR role = $3)
      AND ($4::bool IS NULL OR active = $4)
";

/// Who may sign in where, one page at a time, beside exactly how many there
/// are.
pub async fn list_edge_assignments(
    pool: &PgPool,
    scope: EdgeAssignmentScope,
) -> Result<EdgeAssignmentList, AppError> {
    // A blank search is not a search: `Some("")` compiles to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = scope
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{value}%"));

    // The sort, and the tie-break that makes it total: every order ends in the
    // table's own two-column key, so no two rows can compare equal — which is
    // what stops a keyset repeating or losing the rows that tie.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not.
    let lead = match scope.sort.as_deref() {
        Some("username") => "username",
        Some("updated") => "updated_at",
        // NOT NULL in the table, so no sentinel is needed — see above.
        Some("lease") => "offline_ttl_seconds",
        _ => "origin_id",
    };
    let descending = scope.dir.as_deref() == Some("desc");
    let cols = format!("{lead}, origin_id, user_id");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!("{lead} {dir}, origin_id {dir}, user_id {dir}");
    let seek = if descending { "<" } else { ">" };

    let cursor = scope
        .cursor
        .as_deref()
        .map(AssignmentCursor::decode)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(ACCESS_DEFAULT_LIMIT)
        .clamp(1, ACCESS_MAX_LIMIT);

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let rows = sqlx::query(&format!(
        "WITH searched AS NOT MATERIALIZED ({ASSIGNMENT_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched {ASSIGNMENT_FILTERS}
         )
         SELECT * FROM kept
          WHERE $5::text IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept
                                  WHERE origin_id = $5 AND user_id = $6)
          ORDER BY {order}
          LIMIT $7"
    ))
    .bind(&needle)
    .bind(&scope.origin_id)
    .bind(&scope.role)
    .bind(scope.active)
    .bind(cursor.as_ref().map(|one| one.origin_id.clone()))
    .bind(cursor.as_ref().map(|one| one.user_id))
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            AssignmentCursor {
                origin_id: row.try_get("origin_id")?,
                user_id: row.try_get("user_id")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let out = rows
        .iter()
        .map(|row| {
            Ok(EdgeAssignmentRow {
                origin_id: row.try_get("origin_id")?,
                user_id: row.try_get("user_id")?,
                username: row.try_get("username")?,
                display_name: row.try_get("display_name")?,
                role: row.try_get("role")?,
                active: row.try_get("active")?,
                offline_ttl_seconds: row.try_get("offline_ttl_seconds")?,
                updated_at: row.try_get("updated_at")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let counted = sqlx::query(&format!(
        "WITH searched AS NOT MATERIALIZED ({ASSIGNMENT_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched {ASSIGNMENT_FILTERS}
         )
         SELECT 'origin' AS facet, origin_id AS value, NULL::text AS label,
                COUNT(*)::bigint AS n
           FROM searched GROUP BY origin_id
          UNION ALL
         SELECT 'role', role, NULL::text, COUNT(*)::bigint
           FROM searched GROUP BY role
          UNION ALL
         SELECT 'state', state, NULL::text, COUNT(*)::bigint
           FROM searched GROUP BY state
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM kept"
    ))
    .bind(&needle)
    .bind(&scope.origin_id)
    .bind(&scope.role)
    .bind(scope.active)
    .fetch_all(pool)
    .await?;

    let mut total = 0i64;
    let (mut origins, mut roles, mut states) = (Vec::new(), Vec::new(), Vec::new());
    for row in &counted {
        let facet: String = row.try_get("facet")?;
        let one = AccessFacet {
            value: row.try_get("value")?,
            label: row.try_get("label")?,
            count: row.try_get("n")?,
        };
        match facet.as_str() {
            "origin" => origins.push(one),
            "role" => roles.push(one),
            "state" => states.push(one),
            _ => total = one.count,
        }
    }
    for list in [&mut origins, &mut roles, &mut states] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }

    Ok(EdgeAssignmentList {
        rows: out,
        next_cursor,
        total,
        facets: EdgeAssignmentFacets {
            origins,
            roles,
            states,
        },
    })
}

/// What an RFID key's machine is, checked: `RFID_READER` when nobody said.
fn rfid_kind(offered: Option<&str>) -> Result<&'static str, AppError> {
    let offered = offered
        .map(str::trim)
        .filter(|kind| !kind.is_empty())
        .map(str::to_ascii_uppercase);
    match offered.as_deref() {
        None | Some(crate::sync::device::KIND_RFID_READER) => {
            Ok(crate::sync::device::KIND_RFID_READER)
        }
        Some(crate::sync::device::KIND_HANDHELD) => Ok(crate::sync::device::KIND_HANDHELD),
        Some(other) => Err(AppError::Validation(format!(
            "{other} is not a kind of RFID reader; say RFID_READER (fixed) or HANDHELD (carried)"
        ))),
    }
}

/// Register a key for a fixed reader. [`register_rfid_device_as`] names the
/// kind; this is the registration every caller made before there was one.
pub async fn register_rfid_device(
    pool: &PgPool,
    request: RegisterRfidDeviceRequest,
    actor: &str,
) -> Result<Value, AppError> {
    register_rfid_device_as(pool, request, None, actor).await
}

/// Register a key, and say whether the machine that holds it is carried
/// (`HANDHELD`) or fixed (`RFID_READER`, when `kind` is `None`). The node is
/// told in the policy published here and reports the device under that kind.
pub async fn register_rfid_device_as(
    pool: &PgPool,
    request: RegisterRfidDeviceRequest,
    kind: Option<&str>,
    actor: &str,
) -> Result<Value, AppError> {
    let kind = rfid_kind(kind)?;
    let device_id = request.device_id.trim().to_ascii_uppercase();
    if device_id.len() < 3
        || device_id.len() > 96
        || !device_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return Err(AppError::Validation(
            "device_id must be 3-96 characters of A-Z, 0-9, '-', '_' or '.'".into(),
        ));
    }
    let label = request.label.trim();
    if label.is_empty() || label.len() > 128 {
        return Err(AppError::Validation(
            "RFID device label must be 1-128 characters".into(),
        ));
    }
    if request.pools.is_empty() {
        return Err(AppError::Validation(
            "RFID device needs at least one pool".into(),
        ));
    }
    let origin_id = request.origin_id.trim().to_string();
    let node = origin_node(pool, &origin_id).await?;
    let mut pools = request
        .pools
        .iter()
        .map(|pool| pool.trim().to_string())
        .collect::<Vec<_>>();
    pools.sort();
    pools.dedup();
    for pool_id in &pools {
        let pool = OperationalPool::from_str(pool_id)
            .map_err(|error| AppError::Validation(error.to_string()))?;
        if !node.owns_pool(&pool) {
            return Err(AppError::Validation(format!(
                "pool {pool_id} is not owned by {}",
                node.site_id
            )));
        }
    }
    let ttl = request
        .offline_ttl_seconds
        .unwrap_or(DEFAULT_OPERATOR_TTL_SECONDS);
    if !(MIN_TTL_SECONDS..=MAX_TTL_SECONDS).contains(&ttl) {
        return Err(AppError::Validation(format!(
            "offline_ttl_seconds must be between {MIN_TTL_SECONDS} and {MAX_TTL_SECONDS}"
        )));
    }
    let device_key = security::random_token();
    let digest = security::sha256_hex(&device_key);
    let mut tx = pool.begin().await?;
    let result = sqlx::query(
        "INSERT INTO rfid_device
             (device_id,origin_id,label,auth_key_sha256,offline_ttl_seconds,created_by,kind)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(device_id) DO NOTHING",
    )
    .bind(&device_id)
    .bind(&origin_id)
    .bind(label)
    .bind(&digest)
    .bind(ttl)
    .bind(actor)
    .bind(kind)
    .execute(&mut *tx)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "RFID device '{device_id}' already exists"
        )));
    }
    for pool_id in &pools {
        sqlx::query("INSERT INTO rfid_device_pool(device_id,pool_id) VALUES($1,$2)")
            .bind(&device_id)
            .bind(pool_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    let policy = publish_auth_policy(pool, &origin_id, actor).await?;
    Ok(json!({
        "device_id":device_id,
        "origin_id":origin_id,
        "label":label,
        "kind":kind,
        "pools":pools,
        "active":true,
        "offline_ttl_seconds":ttl,
        // Deliberately returned once. Neither list APIs nor policy status expose it.
        "device_key":device_key,
        "policy":policy,
    }))
}

pub async fn set_rfid_device_active(
    pool: &PgPool,
    device_id: &str,
    request: SetRfidDeviceActiveRequest,
    actor: &str,
) -> Result<Value, AppError> {
    let row = sqlx::query(
        "UPDATE rfid_device SET active=$2,updated_at=now() WHERE device_id=$1
         RETURNING origin_id",
    )
    .bind(device_id)
    .bind(request.active)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("RFID device".into()))?;
    let origin_id: String = row.get("origin_id");
    let policy = publish_auth_policy(pool, &origin_id, actor).await?;
    Ok(json!({
        "device_id":device_id,
        "origin_id":origin_id,
        "active":request.active,
        "policy":policy,
    }))
}

/// Say whether an RFID key's machine is carried or fixed.
///
/// A key registered before head office asked is a fixed reader until somebody
/// says otherwise, and this is where they say it. The node learns it with the
/// policy published here; the register row, if the node has reported the
/// device already, is corrected in the same transaction rather than waiting a
/// heartbeat to repeat what head office itself just decided.
pub async fn set_rfid_device_kind(
    pool: &PgPool,
    device_id: &str,
    request: SetRfidDeviceKindRequest,
    actor: &str,
) -> Result<Value, AppError> {
    let kind = rfid_kind(Some(request.kind.as_str()))?;
    let device_id = device_id.trim().to_ascii_uppercase();
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "UPDATE rfid_device SET kind=$2,updated_at=now() WHERE device_id=$1
         RETURNING origin_id",
    )
    .bind(&device_id)
    .bind(kind)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("RFID device".into()))?;
    let origin_id: String = row.get("origin_id");
    sqlx::query("UPDATE device SET kind=$2,updated_at=now() WHERE rfid_device_id=$1")
        .bind(&device_id)
        .bind(kind)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    let policy = publish_auth_policy(pool, &origin_id, actor).await?;
    Ok(json!({
        "device_id":device_id,
        "origin_id":origin_id,
        "kind":kind,
        "policy":policy,
    }))
}

pub async fn rotate_rfid_device_key(
    pool: &PgPool,
    device_id: &str,
    actor: &str,
) -> Result<Value, AppError> {
    let device_key = security::random_token();
    let digest = security::sha256_hex(&device_key);
    let row = sqlx::query(
        "UPDATE rfid_device
         SET auth_key_sha256=$2,active=true,updated_at=now()
         WHERE device_id=$1 RETURNING origin_id",
    )
    .bind(device_id.trim().to_ascii_uppercase())
    .bind(digest)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("RFID device".into()))?;
    let origin_id: String = row.get("origin_id");
    let policy = publish_auth_policy(pool, &origin_id, actor).await?;
    Ok(json!({
        "device_id":device_id.trim().to_ascii_uppercase(),
        "origin_id":origin_id,
        "active":true,
        // The old key stops working once this policy reaches the Edge.
        "device_key":device_key,
        "policy":policy,
    }))
}

/// One reader, as the device list shows it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RfidDeviceRow {
    pub device_id: String,
    pub origin_id: String,
    pub label: String,
    pub active: bool,
    pub offline_ttl_seconds: i32,
    pub pools: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Null for a reader that has never checked in. Not the same as a very old
    /// date, and a screen that sorted them together would file the two most
    /// different cases side by side.
    pub last_seen_at: Option<DateTime<Utc>>,
    /// `HANDHELD` (carried) or `RFID_READER` (fixed), as head office
    /// registered the key.
    pub kind: String,
}

/// The two things the device list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RfidDeviceFacets {
    pub origins: Vec<AccessFacet>,
    /// `ACTIVE` and `SUSPENDED`.
    pub states: Vec<AccessFacet>,
}

/// A page of readers, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RfidDeviceList {
    pub rows: Vec<RfidDeviceRow>,
    pub next_cursor: Option<String>,
    /// Exact, always — this is an access surface. Every reader the search and
    /// the filters match.
    pub total: i64,
    pub facets: RfidDeviceFacets,
}

/// What a caller is asking the device list for.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RfidDeviceScope {
    /// Free text over the device id, its label and the node it belongs to.
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub origin_id: Option<String>,
    #[serde(default)]
    pub active: Option<bool>,
    /// `origin`, `device`, `label`, `last_seen` or `lease`. Anything else is
    /// `origin` rather than a 400, so a stale bookmark still opens.
    #[serde(default)]
    pub sort: Option<String>,
    /// `desc` and nothing else. Absent means ascending.
    #[serde(default)]
    pub dir: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// Where the previous page stopped — as a ROW, not a position.
#[derive(Serialize, Deserialize)]
struct DeviceCursor {
    device_id: String,
}

impl DeviceCursor {
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

/// One reader row, defined once.
///
/// Used by the page query and by the facet counts, which is the whole reason it
/// is a constant: the facets are only honest if they count exactly what the
/// page can show.
///
/// `last_key` is the trap this list carries and the reason it is spelled out:
/// `last_seen_at` is NULL for a reader that has never checked in, a row
/// comparison against NULL is NULL rather than true, and paging by it would
/// therefore stop dead at the first never-seen device with the rest of the
/// fleet below the fold. `-infinity` is the sentinel, which also sorts
/// never-seen readers last under the default descending read — where somebody
/// asking "what has checked in recently" expects them. A sentinel VALUE rather
/// than a `NULLS LAST` decoration, because `NULLS LAST` orders a result and
/// says nothing a keyset can seek against.
///
/// Binds: `$1` the search pattern or NULL.
const DEVICE_ROWS: &str = "
    SELECT d.device_id, d.origin_id, d.label, d.active, d.offline_ttl_seconds,
           d.created_at, d.updated_at, d.last_seen_at, d.kind,
           COALESCE(array_agg(p.pool_id ORDER BY p.pool_id)
                    FILTER (WHERE p.pool_id IS NOT NULL), '{}') AS pools,
           CASE WHEN d.active THEN 'ACTIVE' ELSE 'SUSPENDED' END AS state,
           COALESCE(d.last_seen_at, TIMESTAMPTZ '-infinity') AS last_key
      FROM rfid_device d
      LEFT JOIN rfid_device_pool p ON p.device_id = d.device_id
     WHERE ($1::text IS NULL
            OR d.device_id ILIKE $1
            OR d.label ILIKE $1
            OR d.origin_id ILIKE $1)
     GROUP BY d.device_id
";

/// Every filter, in one place, so the page and the total cannot drift.
const DEVICE_FILTERS: &str = "
    WHERE ($2::text IS NULL OR origin_id = $2)
      AND ($3::bool IS NULL OR active = $3)
";

/// The readers, one page at a time, beside exactly how many there are.
pub async fn list_rfid_devices(
    pool: &PgPool,
    scope: RfidDeviceScope,
) -> Result<RfidDeviceList, AppError> {
    // A blank search is not a search: `Some("")` compiles to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = scope
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{value}%"));

    // The sort, and the tie-break that makes it total. Every order ends in the
    // device id, which is the primary key, so no two rows can compare equal.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not.
    let lead = match scope.sort.as_deref() {
        Some("device") => "device_id",
        Some("label") => "label",
        Some("last_seen") => "last_key",
        // NOT NULL in the table (`0015`), so no sentinel is needed.
        Some("lease") => "offline_ttl_seconds",
        _ => "origin_id",
    };
    let descending = scope.dir.as_deref() == Some("desc");
    let cols = if lead == "device_id" {
        "device_id".to_owned()
    } else {
        format!("{lead}, device_id")
    };
    let dir = if descending { "DESC" } else { "ASC" };
    let order = if lead == "device_id" {
        format!("device_id {dir}")
    } else {
        format!("{lead} {dir}, device_id {dir}")
    };
    let seek = if descending { "<" } else { ">" };

    let cursor = scope
        .cursor
        .as_deref()
        .map(DeviceCursor::decode)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(ACCESS_DEFAULT_LIMIT)
        .clamp(1, ACCESS_MAX_LIMIT);

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let rows = sqlx::query(&format!(
        "WITH searched AS NOT MATERIALIZED ({DEVICE_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched {DEVICE_FILTERS}
         )
         SELECT * FROM kept
          WHERE $4::text IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE device_id = $4)
          ORDER BY {order}
          LIMIT $5"
    ))
    .bind(&needle)
    .bind(&scope.origin_id)
    .bind(scope.active)
    .bind(cursor.as_ref().map(|one| one.device_id.clone()))
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            DeviceCursor {
                device_id: row.try_get("device_id")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let out = rows
        .iter()
        .map(|row| {
            Ok(RfidDeviceRow {
                device_id: row.try_get("device_id")?,
                origin_id: row.try_get("origin_id")?,
                label: row.try_get("label")?,
                active: row.try_get("active")?,
                offline_ttl_seconds: row.try_get("offline_ttl_seconds")?,
                pools: row.try_get("pools")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
                last_seen_at: row.try_get("last_seen_at")?,
                kind: row.try_get("kind")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    let counted = sqlx::query(&format!(
        "WITH searched AS ({DEVICE_ROWS}), kept AS (
             SELECT * FROM searched {DEVICE_FILTERS}
         )
         SELECT 'origin' AS facet, origin_id AS value, COUNT(*)::bigint AS n
           FROM searched GROUP BY origin_id
          UNION ALL
         SELECT 'state', state, COUNT(*)::bigint FROM searched GROUP BY state
          UNION ALL
         SELECT 'all', '', COUNT(*)::bigint FROM kept"
    ))
    .bind(&needle)
    .bind(&scope.origin_id)
    .bind(scope.active)
    .fetch_all(pool)
    .await?;

    let mut total = 0i64;
    let (mut origins, mut states) = (Vec::new(), Vec::new());
    for row in &counted {
        let facet: String = row.try_get("facet")?;
        let one = AccessFacet {
            value: row.try_get("value")?,
            label: None,
            count: row.try_get("n")?,
        };
        match facet.as_str() {
            "origin" => origins.push(one),
            "state" => states.push(one),
            _ => total = one.count,
        }
    }
    for list in [&mut origins, &mut states] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }

    Ok(RfidDeviceList {
        rows: out,
        next_cursor,
        total,
        facets: RfidDeviceFacets { origins, states },
    })
}

/// What a node is told about its own site and every other, from `site` (0603).
///
/// Its own is the row it was enrolled at. A warehouse node may be enrolled
/// under a site id the centre does not hold as a row (`dc-01` beside the
/// centre's `dc`); its site is then head office's, because the Gudang is head
/// office's — decided by the ROLE it was enrolled with, never by the spelling
/// of its id, and only while it is the one warehouse node. A shop node with no
/// row is told nothing, and keeps its defaults.
async fn site_profiles(
    tx: &mut Transaction<'_, Postgres>,
    node: &NodeContext,
    at: DateTime<Utc>,
) -> Result<(Option<SiteProfile>, Vec<SiteProfile>), AppError> {
    let rows = sqlx::query(
        // `site_business_timezone`, not the column: it is the one reader that
        // turns a zone written as WIB/WITA/WIT (0520's spelling) into a name
        // a node can use, and it is what the centre cuts the same day with.
        //
        // `opened` is the unit's (0630): a site's tills trade once head
        // office has opened the unit that owns it. `till_count` is the
        // site's (0714): how many seats its counter has.
        "SELECT s.id, s.kind, s.code, s.name, site_business_timezone(s.id) AS timezone,
                (EXTRACT(EPOCH FROM ($1::timestamptz AT TIME ZONE site_business_timezone(s.id))
                                  - ($1::timestamptz AT TIME ZONE 'UTC')) / 60)::int
                    AS utc_offset_minutes,
                s.id IS NOT DISTINCT FROM head_office_site_id() AS is_head_office,
                u.opened_at IS NOT NULL AS opened,
                s.till_count, s.one_device_sign_in
           FROM site s
           LEFT JOIN unit u ON u.id = s.unit_id
          ORDER BY s.id",
    )
    .bind(at)
    .fetch_all(&mut **tx)
    .await?;
    let mut own = None;
    let mut head_office = None;
    let mut sites = Vec::with_capacity(rows.len());
    for row in rows {
        let profile = SiteProfile {
            site_id: row.try_get("id")?,
            kind: row.try_get("kind")?,
            code: row.try_get("code")?,
            name: row.try_get("name")?,
            timezone: row.try_get("timezone")?,
            utc_offset_minutes: row.try_get("utc_offset_minutes")?,
            opened: Some(row.try_get("opened")?),
            till_count: u32::try_from(row.try_get::<i32, _>("till_count")?).ok(),
            one_device: Some(row.try_get("one_device_sign_in")?),
        };
        if profile.site_id == node.site_id.as_str() {
            own = Some(profile.clone());
        }
        if row.try_get::<bool, _>("is_head_office")? {
            head_office = Some(profile.clone());
        }
        sites.push(profile);
    }
    let own = match (own, node.role) {
        (Some(own), _) => Some(own),
        (None, EdgeRole::Dc) => {
            // Only the sole warehouse node stands in for head office's site.
            // Two nodes told one code would print the same koli number twice;
            // with several, each keeps printing under its own id until it is
            // enrolled at a site of its own — the same refusal to guess
            // `sole_dc_origin_tx` makes.
            let warehouses: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sync_origin_credential
                  WHERE inventory_enabled AND node_role = 'DC'",
            )
            .fetch_one(&mut **tx)
            .await?;
            if warehouses == 1 {
                head_office
            } else {
                None
            }
        }
        (None, EdgeRole::Store) => None,
    };
    Ok((own, sites))
}

async fn allocate_policy_version(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
) -> Result<i64, AppError> {
    Ok(sqlx::query(
        "INSERT INTO edge_auth_snapshot_state(origin_id,next_version,last_issued_at)
         VALUES($1,1,now())
         ON CONFLICT(origin_id) DO UPDATE SET
             next_version=edge_auth_snapshot_state.next_version+1,last_issued_at=now()
         RETURNING next_version",
    )
    .bind(origin_id)
    .fetch_one(&mut **tx)
    .await?
    .get("next_version"))
}

pub async fn publish_auth_policy(
    pool: &PgPool,
    origin_id: &str,
    actor: &str,
) -> Result<Value, AppError> {
    let node = origin_node(pool, origin_id).await?;
    let issued_at = Utc::now();
    let mut tx = pool.begin().await?;
    let version = allocate_policy_version(&mut tx, origin_id).await?;
    let user_rows = sqlx::query(
        // A derived grant (0635) carries no credential of its own: the server
        // is sent the login's own verifier, read now, so a password changed
        // since the last publication is the one it checks from this one on.
        "SELECT a.user_id,u.username,u.display_name,a.edge_role,
                CASE WHEN a.source='ROLE' THEN u.password_hash
                     ELSE a.credential_hash END credential_hash,
                (a.active AND u.active) active,
                (a.auth_version+u.auth_version) auth_version,a.offline_ttl_seconds
         FROM edge_identity_assignment a JOIN app_user u ON u.id=a.user_id
         WHERE a.origin_id=$1 ORDER BY u.username",
    )
    .bind(origin_id)
    .fetch_all(&mut *tx)
    .await?;
    let mut users = Vec::with_capacity(user_rows.len());
    let mut valid_until = issued_at + Duration::minutes(15);
    for row in user_rows {
        let expiry =
            issued_at + Duration::seconds(i64::from(row.get::<i32, _>("offline_ttl_seconds")));
        valid_until = valid_until.max(expiry);
        users.push(AuthPolicyUser {
            user_id: row.get("user_id"),
            username: row.get("username"),
            display_name: row.get("display_name"),
            role: row.get("edge_role"),
            credential_hash: row.get("credential_hash"),
            active: row.get("active"),
            auth_version: row.get("auth_version"),
            valid_until: expiry,
        });
    }
    let device_rows = sqlx::query(
        "SELECT device_id,label,auth_key_sha256,active,offline_ttl_seconds,kind
         FROM rfid_device WHERE origin_id=$1 ORDER BY device_id",
    )
    .bind(origin_id)
    .fetch_all(&mut *tx)
    .await?;
    let pool_rows = sqlx::query(
        "SELECT p.device_id,p.pool_id FROM rfid_device_pool p
         JOIN rfid_device d ON d.device_id=p.device_id
         WHERE d.origin_id=$1 ORDER BY p.device_id,p.pool_id",
    )
    .bind(origin_id)
    .fetch_all(&mut *tx)
    .await?;
    let mut pools: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for row in pool_rows {
        pools
            .entry(row.get("device_id"))
            .or_default()
            .push(row.get("pool_id"));
    }
    let mut devices = Vec::with_capacity(device_rows.len());
    // Handheld or fixed, beside the keys rather than inside them: an older node
    // hashes `devices` field by field (see `device_kinds`).
    let mut device_kinds = BTreeMap::new();
    for row in device_rows {
        let device_id: String = row.get("device_id");
        device_kinds.insert(device_id.clone(), row.get::<String, _>("kind"));
        let expiry =
            issued_at + Duration::seconds(i64::from(row.get::<i32, _>("offline_ttl_seconds")));
        valid_until = valid_until.max(expiry);
        devices.push(AuthPolicyDevice {
            device_id: device_id.clone(),
            label: row.get("label"),
            auth_key_sha256: row.get("auth_key_sha256"),
            active: row.get("active"),
            pools: pools.remove(&device_id).unwrap_or_default(),
            valid_until: expiry,
        });
    }
    let (site, sites) = site_profiles(&mut tx, &node, issued_at).await?;
    // Stops on the POS here (0990): always sent, even empty, so the node
    // drops a stop head office has lifted.
    let pos_stops =
        super::pos_access::pos_stops_for(&mut tx, origin_id, node.site_id.as_str()).await?;
    tx.commit().await?;

    let mut snapshot = AuthPolicySnapshot {
        snapshot_id: Uuid::new_v4(),
        version,
        origin_id: origin_id.to_string(),
        site_id: node.site_id.to_string(),
        node_role: node.role.to_string(),
        issued_at,
        valid_until,
        content_hash: String::new(),
        sso_public_key: if node.role == EdgeRole::Dc {
            crate::security::sso::public_key_from_env().map_err(AppError::Configuration)?
        } else {
            None
        },
        users,
        devices,
        site,
        sites,
        device_kinds,
        pos_stops: Some(pos_stops),
    };
    snapshot.content_hash = auth_policy_content_hash(&snapshot);
    let payload = serde_json::to_value(&snapshot)?;
    let (command_id, _) = issue_command(
        pool,
        COMMAND_AUTH_POLICY_REPLACE,
        &payload,
        actor,
        None,
        &[origin_id.to_string()],
    )
    .await?;
    sqlx::query("UPDATE edge_auth_snapshot_state SET last_command_id=$2 WHERE origin_id=$1")
        .bind(origin_id)
        .bind(command_id)
        .execute(pool)
        .await?;
    // Told. A change that lands after this snapshot was read marks it due
    // again, so clearing only a marker older than the snapshot keeps it.
    sqlx::query("DELETE FROM edge_auth_policy_due WHERE origin_id=$1 AND since<=$2")
        .bind(origin_id)
        .bind(issued_at)
        .execute(pool)
        .await?;
    Ok(json!({
        "snapshot_id":snapshot.snapshot_id,
        "version":version,
        "origin_id":origin_id,
        "valid_until":valid_until,
        "user_count":snapshot.users.len(),
        "device_count":snapshot.devices.len(),
        "command_id":command_id,
    }))
}

/// Refresh leases after twelve hours. Privileged Edge assignments deliberately
/// have a maximum 24-hour offline lease, so waiting a full day would renew at
/// (or just after) their expiry and create a lockout gap during ordinary sync
/// delay. Errors are returned per origin so the caller can log and continue.
pub async fn due_auth_policy_origins(pool: &PgPool) -> Result<Vec<String>, AppError> {
    let rows = sqlx::query(
        // Due by age (the lease), or because its sign-in list changed and the
        // publication that would have told it failed or never ran (0635).
        "SELECT origin_id FROM (
             SELECT DISTINCT origin_id FROM (
                 SELECT origin_id FROM edge_identity_assignment
                 UNION SELECT origin_id FROM rfid_device
             ) assigned
             WHERE NOT EXISTS (
                 SELECT 1 FROM edge_auth_snapshot_state state
                 WHERE state.origin_id=assigned.origin_id
                   AND state.last_issued_at>now()-interval '12 hours'
             )
             UNION
             SELECT due.origin_id FROM edge_auth_policy_due due
               JOIN sync_origin_credential o
                 ON o.origin_id=due.origin_id AND o.inventory_enabled
         ) due ORDER BY origin_id",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|row| row.get("origin_id")).collect())
}

pub async fn publish_auth_policies_for_user(
    pool: &PgPool,
    user_id: Uuid,
    actor: &str,
) -> Result<Vec<Value>, AppError> {
    let rows = sqlx::query(
        "SELECT origin_id FROM edge_identity_assignment WHERE user_id=$1 ORDER BY origin_id",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    let mut published = Vec::with_capacity(rows.len());
    for row in rows {
        let origin_id: String = row.get("origin_id");
        published.push(publish_auth_policy(pool, &origin_id, actor).await?);
    }
    Ok(published)
}

// ── who signs in where, derived from role and posting (0635) ─────────────

/// Bring the derived grants of one login — or of everybody, for `None` — in
/// line with their job role and their posting, inside the caller's
/// transaction. Answers the servers whose sign-in list changed; each is also
/// marked due, so a publication that fails later is retried by the lease
/// agent rather than forgotten.
///
/// The rule itself is SQL (`node_access_reconcile`, 0635), so the migration
/// that first applied it and every later call apply the same one.
pub async fn reconcile_node_access_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Option<Uuid>,
    actor: &str,
) -> Result<Vec<String>, AppError> {
    Ok(
        sqlx::query_scalar(
            "SELECT origin_id FROM node_access_reconcile($1::uuid, $2) AS origin_id",
        )
        .bind(user_id)
        .bind(actor)
        .fetch_all(&mut **tx)
        .await?,
    )
}

/// [`reconcile_node_access_tx`] in a transaction of its own.
pub async fn reconcile_node_access(
    pool: &PgPool,
    user_id: Option<Uuid>,
    actor: &str,
) -> Result<Vec<String>, AppError> {
    let mut tx = pool.begin().await?;
    let origins = reconcile_node_access_tx(&mut tx, user_id, actor).await?;
    tx.commit().await?;
    Ok(origins)
}

/// Re-derive the grants of one login and tell the servers whose list
/// changed. Never fails the write that called it: that change is recorded,
/// and a server not told now is told by the lease agent (it stays due).
pub async fn follow_login(pool: &PgPool, user_id: Uuid, actor: &str) {
    match reconcile_node_access(pool, Some(user_id), actor).await {
        Ok(origins) => publish_node_access(pool, &origins, actor).await,
        Err(error) => {
            tracing::warn!(%user_id, %error, "could not re-derive who signs in where");
        }
    }
}

/// A server has just been let in — an enrolment approved, a new machine
/// replacing an old one, an origin registered by hand. Derive who signs in
/// there now instead of on the sweep's next tick: somebody whose role and
/// posting reach this server (a store manager who joined before it existed)
/// must be able to sign in the moment it is up.
///
/// Answers the servers whose sign-in list changed, for the caller to tell —
/// the approval sends the new server its whole bootstrap, policy included,
/// right after. Never fails the approval: a derivation that fails here is
/// logged and the sweep makes it.
pub async fn follow_new_server(pool: &PgPool, origin_id: &str, actor: &str) -> Vec<String> {
    match reconcile_node_access(pool, None, actor).await {
        Ok(origins) => origins,
        Err(error) => {
            tracing::warn!(
                %origin_id,
                %error,
                "a server was let in and who signs in there could not be derived yet"
            );
            Vec::new()
        }
    }
}

/// [`follow_login`] for the login bound to an employment record, when one is
/// — for a posting or a binding that has just changed.
pub async fn follow_posting(pool: &PgPool, employee_id: &str, actor: &str) {
    let user_id: Result<Option<Uuid>, sqlx::Error> =
        sqlx::query_scalar("SELECT id FROM app_user WHERE employee_id = $1")
            .bind(employee_id)
            .fetch_optional(pool)
            .await;
    match user_id {
        Ok(Some(user_id)) => follow_login(pool, user_id, actor).await,
        Ok(None) => {}
        Err(error) => {
            tracing::warn!(%employee_id, %error, "could not re-derive who signs in where");
        }
    }
}

/// Tell every server this login signs in at by role (0635) — after its
/// password changed, since those servers check the login's own verifier.
pub async fn tell_derived_servers(pool: &PgPool, user_id: Uuid, actor: &str) {
    // Marked due first, so a publication that fails here is retried by the
    // lease agent instead of leaving the old verifier at the server.
    let origins: Result<Vec<String>, sqlx::Error> = sqlx::query_scalar(
        "INSERT INTO edge_auth_policy_due (origin_id)
         SELECT DISTINCT origin_id FROM edge_identity_assignment
          WHERE user_id = $1 AND source = 'ROLE'
         ON CONFLICT (origin_id) DO UPDATE SET since = edge_auth_policy_due.since
         RETURNING origin_id",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await;
    match origins {
        Ok(origins) => publish_node_access(pool, &origins, actor).await,
        Err(error) => {
            tracing::warn!(%user_id, %error, "could not list the servers a login signs in at");
        }
    }
}

/// Publish the policy of every server named, logging rather than failing: the
/// servers stay marked due until a publication lands.
pub async fn publish_node_access(pool: &PgPool, origins: &[String], actor: &str) {
    for origin_id in origins {
        if let Err(error) = publish_auth_policy(pool, origin_id, actor).await {
            tracing::warn!(
                %origin_id,
                %error,
                "a server's sign-in list changed and it could not be told yet"
            );
        }
    }
}
