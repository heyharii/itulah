//! Cloud-owned Edge identity and RFID policy publication.
//!
//! Permanent assignments are single-writer Cloud state. A complete projection
//! is delivered to exactly one Edge through the existing signed command lane,
//! which gives ordering, retry, acknowledgement, and anti-replay without a
//! second synchronization protocol.

use crate::{
    cloud::{
        application::{
            AppError, RegisterRfidDeviceRequest, SetEdgeAssignmentActiveRequest,
            SetRfidDeviceActiveRequest, UpsertEdgeAssignmentRequest,
        },
        domain::{
            auth_policy_content_hash, AuthPolicyDevice, AuthPolicySnapshot, AuthPolicyUser, Role,
            COMMAND_AUTH_POLICY_REPLACE,
        },
    },
    edge::{EdgeRole, NodeContext, OperationalPool, SiteId},
    security,
};
use chrono::{DateTime, Duration, Utc};
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

pub async fn upsert_edge_assignment(
    pool: &PgPool,
    request: UpsertEdgeAssignmentRequest,
    actor: &str,
) -> Result<Value, AppError> {
    let origin_id = request.origin_id.trim().to_string();
    origin_node(pool, &origin_id).await?;
    let ttl = assignment_ttl(request.role, request.offline_ttl_seconds)?;
    let credential_hash = hash_edge_credential(&request.edge_password)?;
    let exists = sqlx::query("SELECT 1 FROM app_user WHERE id=$1")
        .bind(request.user_id)
        .fetch_optional(pool)
        .await?
        .is_some();
    if !exists {
        return Err(AppError::NotFound("user".into()));
    }
    sqlx::query(
        "INSERT INTO edge_identity_assignment
             (origin_id,user_id,edge_role,credential_hash,active,auth_version,
              offline_ttl_seconds,created_by)
         VALUES($1,$2,$3,$4,true,1,$5,$6)
         ON CONFLICT(origin_id,user_id) DO UPDATE SET
             edge_role=EXCLUDED.edge_role,credential_hash=EXCLUDED.credential_hash,
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
    .bind(request.role.as_str())
    .bind(credential_hash)
    .bind(ttl)
    .bind(actor)
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

pub async fn list_edge_assignments(pool: &PgPool) -> Result<Value, AppError> {
    let rows = sqlx::query(
        "SELECT a.origin_id,a.user_id,u.username,u.display_name,a.edge_role,a.active,
                a.offline_ttl_seconds,a.updated_at
         FROM edge_identity_assignment a JOIN app_user u ON u.id=a.user_id
         ORDER BY a.origin_id,u.username",
    )
    .fetch_all(pool)
    .await?;
    Ok(json!({"items":rows.into_iter().map(|row| json!({
        "origin_id":row.get::<String,_>("origin_id"),
        "user_id":row.get::<Uuid,_>("user_id"),
        "username":row.get::<String,_>("username"),
        "display_name":row.get::<String,_>("display_name"),
        "role":row.get::<String,_>("edge_role"),
        "active":row.get::<bool,_>("active"),
        "offline_ttl_seconds":row.get::<i32,_>("offline_ttl_seconds"),
        "updated_at":row.get::<DateTime<Utc>,_>("updated_at"),
    })).collect::<Vec<_>>() }))
}

pub async fn register_rfid_device(
    pool: &PgPool,
    request: RegisterRfidDeviceRequest,
    actor: &str,
) -> Result<Value, AppError> {
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
             (device_id,origin_id,label,auth_key_sha256,offline_ttl_seconds,created_by)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(device_id) DO NOTHING",
    )
    .bind(&device_id)
    .bind(&origin_id)
    .bind(label)
    .bind(&digest)
    .bind(ttl)
    .bind(actor)
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

pub async fn list_rfid_devices(pool: &PgPool) -> Result<Value, AppError> {
    let rows = sqlx::query(
        "SELECT d.device_id,d.origin_id,d.label,d.active,d.offline_ttl_seconds,
                d.created_at,d.updated_at,d.last_seen_at,
                COALESCE(array_agg(p.pool_id ORDER BY p.pool_id)
                    FILTER (WHERE p.pool_id IS NOT NULL),'{}') pools
         FROM rfid_device d LEFT JOIN rfid_device_pool p ON p.device_id=d.device_id
         GROUP BY d.device_id ORDER BY d.origin_id,d.device_id",
    )
    .fetch_all(pool)
    .await?;
    Ok(json!({"items":rows.into_iter().map(|row| json!({
        "device_id":row.get::<String,_>("device_id"),
        "origin_id":row.get::<String,_>("origin_id"),
        "label":row.get::<String,_>("label"),
        "active":row.get::<bool,_>("active"),
        "offline_ttl_seconds":row.get::<i32,_>("offline_ttl_seconds"),
        "pools":row.get::<Vec<String>,_>("pools"),
        "created_at":row.get::<DateTime<Utc>,_>("created_at"),
        "updated_at":row.get::<DateTime<Utc>,_>("updated_at"),
        "last_seen_at":row.get::<Option<DateTime<Utc>>,_>("last_seen_at"),
    })).collect::<Vec<_>>() }))
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
        "SELECT a.user_id,u.username,u.display_name,a.edge_role,a.credential_hash,
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
        "SELECT device_id,label,auth_key_sha256,active,offline_ttl_seconds
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
    for row in device_rows {
        let device_id: String = row.get("device_id");
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
        users,
        devices,
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
        "SELECT DISTINCT origin_id FROM (
             SELECT origin_id FROM edge_identity_assignment
             UNION SELECT origin_id FROM rfid_device
         ) assigned
         WHERE NOT EXISTS (
             SELECT 1 FROM edge_auth_snapshot_state state
             WHERE state.origin_id=assigned.origin_id
               AND state.last_issued_at>now()-interval '12 hours'
         ) ORDER BY origin_id",
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
