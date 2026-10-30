//! The return promise: the fleet's window, the exceptions, and the sentence a
//! receipt prints.
//!
//! # One setting, many exceptions
//!
//! `return_policy_setting` is the fallback. `return_policy` is an exception
//! with one scope kind — GLOBAL, DIVISION, TAG or ARTICLE — and
//! `return_policy_target` names the codes. Resolution lives in
//! `domain::return_policy`, not here: the same function answers head office's
//! publication and a till's sale, and a database round trip per garment would
//! make the two impossible to keep in step.
//!
//! # Why the edge is told, not asked
//!
//! A till prints the last day on paper and must refuse a return after it
//! while the line is down. So the whole promise rides the auth policy to every
//! store (`AuthPolicySnapshot.return_policy`) and the shop resolves locally.
//! Saving here marks every store due and publishes at once; the lease agent
//! would pick up a failure on its next tick, which is why the marker is
//! written before the publication rather than after it.

use super::auth_policy::publish_node_access;
use crate::cloud::{
    application::AppError,
    domain::{
        ReturnPolicyRule, ReturnPolicySetting, ReturnPolicySnapshot, ReturnScopeKind,
        MAX_RETURN_DAYS,
    },
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReturnPolicySettingsRow {
    pub max_days: u32,
    pub require_hang_tag: bool,
    pub require_receipt: bool,
    pub same_item_exchange: bool,
    pub same_item_same_cost: bool,
    pub same_item_same_supplier: bool,
    pub one_return_per_receipt: bool,
    pub return_receipt_returnable: bool,
    pub updated_at: DateTime<Utc>,
    pub updated_by: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReturnPolicyRow {
    pub policy_id: Uuid,
    pub name: String,
    pub scope_kind: ReturnScopeKind,
    pub max_days: u32,
    /// False: the goods it covers are never taken back at a till (1006).
    pub exchangeable: bool,
    pub active: bool,
    pub note: Option<String>,
    pub targets: Vec<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Who changed it last (1007); none on a policy not touched since.
    pub updated_by: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReturnPolicyCatalogue {
    pub settings: ReturnPolicySettingsRow,
    pub policies: Vec<ReturnPolicyRow>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveReturnPolicySettings {
    pub max_days: u32,
    #[serde(default = "yes")]
    pub require_hang_tag: bool,
    #[serde(default = "yes")]
    pub require_receipt: bool,
    #[serde(default = "yes")]
    pub same_item_exchange: bool,
    #[serde(default = "yes")]
    pub same_item_same_cost: bool,
    #[serde(default = "yes")]
    pub same_item_same_supplier: bool,
    #[serde(default = "yes")]
    pub one_return_per_receipt: bool,
    #[serde(default)]
    pub return_receipt_returnable: bool,
}

fn yes() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveReturnPolicyRequest {
    /// Absent creates; present replaces the policy it names.
    #[serde(default)]
    pub policy_id: Option<Uuid>,
    pub name: String,
    pub scope_kind: ReturnScopeKind,
    pub max_days: u32,
    /// False makes this a "tidak bisa ditukar" policy — an article, or a
    /// category such as underwear (1006).
    #[serde(default = "yes")]
    pub exchangeable: bool,
    #[serde(default = "yes")]
    pub active: bool,
    #[serde(default)]
    pub note: Option<String>,
    /// Division, tag or article codes. Required for every kind but GLOBAL.
    #[serde(default)]
    pub targets: Vec<String>,
}

fn validate_days(days: u32) -> Result<(), AppError> {
    if !(1..=MAX_RETURN_DAYS).contains(&days) {
        return Err(AppError::Validation(format!(
            "a return window is between 1 and {MAX_RETURN_DAYS} days, not {days}"
        )));
    }
    Ok(())
}

fn normalize_targets(kind: ReturnScopeKind, targets: &[String]) -> Result<Vec<String>, AppError> {
    let mut clean: Vec<String> = targets
        .iter()
        .map(|target| target.trim().to_string())
        .filter(|target| !target.is_empty())
        .collect();
    clean.sort();
    clean.dedup();
    match kind {
        ReturnScopeKind::Global if !clean.is_empty() => Err(AppError::Validation(
            "a global policy applies to every article and names no target".into(),
        )),
        ReturnScopeKind::Global => Ok(clean),
        _ if clean.is_empty() => Err(AppError::Validation(
            "choose at least one division, tag or article for this policy".into(),
        )),
        _ => Ok(clean),
    }
}

/// A policy that names a division, tag or article nobody has would match
/// nothing and say so to no one: a typo, or a tag renamed since. Refused by
/// name (Hari, 29 Oct 2026).
async fn assert_targets_exist(
    pool: &PgPool,
    kind: ReturnScopeKind,
    targets: &[String],
) -> Result<(), AppError> {
    let sql = match kind {
        ReturnScopeKind::Global => return Ok(()),
        ReturnScopeKind::Division => "SELECT code FROM division WHERE code = ANY($1)",
        ReturnScopeKind::Tag => "SELECT code FROM tag WHERE code = ANY($1)",
        ReturnScopeKind::Article => "SELECT article_code FROM article WHERE article_code = ANY($1)",
    };
    let known: Vec<String> = sqlx::query_scalar(sql)
        .bind(targets)
        .fetch_all(pool)
        .await?;
    let unknown: Vec<&str> = targets
        .iter()
        .filter(|target| !known.iter().any(|one| one == *target))
        .map(String::as_str)
        .collect();
    if unknown.is_empty() {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "no {} called {}",
            kind.as_str().to_ascii_lowercase(),
            unknown.join(", ")
        )))
    }
}

/// The setting, and every policy, for the Marketing screen.
pub async fn return_policy_catalogue(pool: &PgPool) -> Result<ReturnPolicyCatalogue, AppError> {
    let settings = read_settings(pool).await?;
    let rows = sqlx::query(
        "SELECT policy_id,name,scope_kind,max_days,exchangeable,active,note,created_by,
                created_at,updated_at,updated_by
           FROM return_policy ORDER BY scope_kind, name",
    )
    .fetch_all(pool)
    .await?;
    let target_rows =
        sqlx::query("SELECT policy_id,scope_code FROM return_policy_target ORDER BY scope_code")
            .fetch_all(pool)
            .await?;
    let mut targets: std::collections::BTreeMap<Uuid, Vec<String>> =
        std::collections::BTreeMap::new();
    for row in target_rows {
        targets
            .entry(row.get("policy_id"))
            .or_default()
            .push(row.get("scope_code"));
    }
    let mut policies = Vec::with_capacity(rows.len());
    for row in rows {
        let policy_id: Uuid = row.get("policy_id");
        policies.push(ReturnPolicyRow {
            policy_id,
            name: row.get("name"),
            scope_kind: scope_kind_of(row.get::<String, _>("scope_kind").as_str())?,
            max_days: row.get::<i32, _>("max_days") as u32,
            exchangeable: row.get("exchangeable"),
            active: row.get("active"),
            note: row.get("note"),
            targets: targets.remove(&policy_id).unwrap_or_default(),
            created_by: row.get("created_by"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
            updated_by: row.get("updated_by"),
        });
    }
    Ok(ReturnPolicyCatalogue { settings, policies })
}

fn scope_kind_of(raw: &str) -> Result<ReturnScopeKind, AppError> {
    match raw.trim().to_ascii_uppercase().as_str() {
        "GLOBAL" => Ok(ReturnScopeKind::Global),
        "DIVISION" => Ok(ReturnScopeKind::Division),
        "TAG" => Ok(ReturnScopeKind::Tag),
        "ARTICLE" => Ok(ReturnScopeKind::Article),
        other => Err(AppError::Validation(format!(
            "{other:?} is not a return-policy scope"
        ))),
    }
}

pub async fn read_settings(pool: &PgPool) -> Result<ReturnPolicySettingsRow, AppError> {
    let row = sqlx::query(
        "SELECT max_days,require_hang_tag,require_receipt,same_item_exchange,
                same_item_same_cost,same_item_same_supplier,one_return_per_receipt,
                return_receipt_returnable,updated_at,updated_by
           FROM return_policy_setting WHERE singleton=1",
    )
    .fetch_one(pool)
    .await?;
    Ok(ReturnPolicySettingsRow {
        max_days: row.get::<i32, _>("max_days") as u32,
        require_hang_tag: row.get("require_hang_tag"),
        require_receipt: row.get("require_receipt"),
        same_item_exchange: row.get("same_item_exchange"),
        same_item_same_cost: row.get("same_item_same_cost"),
        same_item_same_supplier: row.get("same_item_same_supplier"),
        one_return_per_receipt: row.get("one_return_per_receipt"),
        return_receipt_returnable: row.get("return_receipt_returnable"),
        updated_at: row.get("updated_at"),
        updated_by: row.get("updated_by"),
    })
}

pub async fn save_settings(
    pool: &PgPool,
    request: &SaveReturnPolicySettings,
    actor: &str,
) -> Result<ReturnPolicySettingsRow, AppError> {
    validate_days(request.max_days)?;
    sqlx::query(
        "UPDATE return_policy_setting
            SET max_days=$1,require_hang_tag=$2,require_receipt=$3,
                same_item_exchange=$4,same_item_same_cost=$5,same_item_same_supplier=$6,
                updated_at=now(),updated_by=$7,
                one_return_per_receipt=$8,return_receipt_returnable=$9
          WHERE singleton=1",
    )
    .bind(request.max_days as i32)
    .bind(request.require_hang_tag)
    .bind(request.require_receipt)
    .bind(request.same_item_exchange)
    .bind(request.same_item_same_cost)
    .bind(request.same_item_same_supplier)
    .bind(actor)
    .bind(request.one_return_per_receipt)
    .bind(request.return_receipt_returnable)
    .execute(pool)
    .await?;
    let settings = read_settings(pool).await?;
    tell_every_store(pool, actor).await;
    Ok(settings)
}

/// Create or replace one policy.
pub async fn save_policy(
    pool: &PgPool,
    request: &SaveReturnPolicyRequest,
    actor: &str,
) -> Result<ReturnPolicyRow, AppError> {
    validate_days(request.max_days)?;
    let name = request.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("a return policy needs a name".into()));
    }
    if name.chars().count() > 120 {
        return Err(AppError::Validation(
            "a return policy name is at most 120 characters".into(),
        ));
    }
    let targets = normalize_targets(request.scope_kind, &request.targets)?;
    assert_targets_exist(pool, request.scope_kind, &targets).await?;
    let mut tx = pool.begin().await?;
    let policy_id = match request.policy_id {
        Some(policy_id) => {
            let updated = sqlx::query(
                "UPDATE return_policy
                    SET name=$2,scope_kind=$3,max_days=$4,active=$5,note=$6,exchangeable=$7,
                        updated_at=now(),updated_by=$8
                  WHERE policy_id=$1",
            )
            .bind(policy_id)
            .bind(name)
            .bind(request.scope_kind.as_str())
            .bind(request.max_days as i32)
            .bind(request.active)
            .bind(
                request
                    .note
                    .as_deref()
                    .map(str::trim)
                    .filter(|note| !note.is_empty()),
            )
            .bind(request.exchangeable)
            .bind(actor)
            .execute(&mut *tx)
            .await
            .map_err(|error| {
                if matches!(
                    &error,
                    sqlx::Error::Database(database)
                        if database.constraint() == Some("ux_return_policy_global")
                ) {
                    AppError::Conflict(
                        "there is already a policy that applies to every article".into(),
                    )
                } else {
                    error.into()
                }
            })?;
            if updated.rows_affected() == 0 {
                return Err(AppError::NotFound(format!("return policy {policy_id}")));
            }
            sqlx::query("DELETE FROM return_policy_target WHERE policy_id=$1")
                .bind(policy_id)
                .execute(&mut *tx)
                .await?;
            policy_id
        }
        None => {
            let row = sqlx::query(
                "INSERT INTO return_policy (name,scope_kind,max_days,active,note,created_by,
                                            exchangeable)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING policy_id",
            )
            .bind(name)
            .bind(request.scope_kind.as_str())
            .bind(request.max_days as i32)
            .bind(request.active)
            .bind(
                request
                    .note
                    .as_deref()
                    .map(str::trim)
                    .filter(|note| !note.is_empty()),
            )
            .bind(actor)
            .bind(request.exchangeable)
            .fetch_one(&mut *tx)
            .await;
            match row {
                Ok(row) => row.get("policy_id"),
                Err(sqlx::Error::Database(error))
                    if error.constraint() == Some("ux_return_policy_global") =>
                {
                    return Err(AppError::Conflict(
                        "there is already a policy that applies to every article".into(),
                    ))
                }
                Err(error) => return Err(error.into()),
            }
        }
    };
    for target in &targets {
        let taken: Option<String> = sqlx::query_scalar(
            "SELECT p.name FROM return_policy_target t
               JOIN return_policy p ON p.policy_id=t.policy_id
              WHERE t.scope_kind=$1 AND t.scope_code=$2 AND t.policy_id<>$3",
        )
        .bind(request.scope_kind.as_str())
        .bind(target)
        .bind(policy_id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(other) = taken {
            return Err(AppError::Conflict(format!(
                "{target} already belongs to the policy “{other}”"
            )));
        }
        sqlx::query(
            "INSERT INTO return_policy_target (policy_id,scope_kind,scope_code)
             VALUES ($1,$2,$3)",
        )
        .bind(policy_id)
        .bind(request.scope_kind.as_str())
        .bind(target)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    let row = policy_by_id(pool, policy_id).await?;
    tell_every_store(pool, actor).await;
    Ok(row)
}

pub async fn policy_by_id(pool: &PgPool, policy_id: Uuid) -> Result<ReturnPolicyRow, AppError> {
    let row = sqlx::query(
        "SELECT policy_id,name,scope_kind,max_days,exchangeable,active,note,created_by,
                created_at,updated_at,updated_by
           FROM return_policy WHERE policy_id=$1",
    )
    .bind(policy_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("return policy {policy_id}")))?;
    let targets: Vec<String> = sqlx::query_scalar(
        "SELECT scope_code FROM return_policy_target WHERE policy_id=$1 ORDER BY scope_code",
    )
    .bind(policy_id)
    .fetch_all(pool)
    .await?;
    Ok(ReturnPolicyRow {
        policy_id,
        name: row.get("name"),
        scope_kind: scope_kind_of(row.get::<String, _>("scope_kind").as_str())?,
        max_days: row.get::<i32, _>("max_days") as u32,
        exchangeable: row.get("exchangeable"),
        active: row.get("active"),
        note: row.get("note"),
        targets,
        created_by: row.get("created_by"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        updated_by: row.get("updated_by"),
    })
}

pub async fn delete_policy(pool: &PgPool, policy_id: Uuid, actor: &str) -> Result<(), AppError> {
    let deleted = sqlx::query("DELETE FROM return_policy WHERE policy_id=$1")
        .bind(policy_id)
        .execute(pool)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("return policy {policy_id}")));
    }
    tell_every_store(pool, actor).await;
    Ok(())
}

/// The promise as a store receives it. Only active policies travel: a paused
/// policy must stop shortening a window the moment it is paused, and the
/// setting is the fallback everybody already has.
pub async fn snapshot(pool: &PgPool) -> Result<ReturnPolicySnapshot, AppError> {
    let settings = read_settings(pool).await?;
    let rows = sqlx::query(
        "SELECT p.policy_id,p.name,p.scope_kind,p.max_days,p.exchangeable,t.scope_code
           FROM return_policy p
      LEFT JOIN return_policy_target t ON t.policy_id=p.policy_id
          WHERE p.active
          ORDER BY p.name,t.scope_code",
    )
    .fetch_all(pool)
    .await?;
    let mut rules: Vec<ReturnPolicyRule> = Vec::new();
    let mut at: std::collections::BTreeMap<Uuid, usize> = std::collections::BTreeMap::new();
    for row in rows {
        let policy_id: Uuid = row.get("policy_id");
        let name: String = row.get("name");
        let kind = scope_kind_of(row.get::<String, _>("scope_kind").as_str())?;
        let max_days = row.get::<i32, _>("max_days") as u32;
        let exchangeable: bool = row.get("exchangeable");
        let target: Option<String> = row.get("scope_code");
        let index = match at.get(&policy_id).copied() {
            Some(index) => index,
            None => {
                let index = rules.len();
                rules.push(ReturnPolicyRule {
                    name,
                    scope_kind: kind,
                    targets: Vec::new(),
                    max_days,
                    exchangeable,
                });
                at.insert(policy_id, index);
                index
            }
        };
        if let Some(target) = target {
            rules[index].targets.push(target);
        }
    }
    Ok(ReturnPolicySnapshot {
        setting: ReturnPolicySetting {
            max_days: settings.max_days,
            require_hang_tag: settings.require_hang_tag,
            require_receipt: settings.require_receipt,
            same_item_exchange: settings.same_item_exchange,
            same_item_same_cost: settings.same_item_same_cost,
            same_item_same_supplier: settings.same_item_same_supplier,
            one_return_per_receipt: settings.one_return_per_receipt,
            return_receipt_returnable: settings.return_receipt_returnable,
        },
        rules,
    })
}

/// Every store server is due a policy, and is told now rather than on the
/// lease agent's next tick. Marking first is what makes a failure retryable.
pub(super) async fn tell_every_store(pool: &PgPool, actor: &str) {
    let origins: Result<Vec<String>, sqlx::Error> = sqlx::query_scalar(
        "INSERT INTO edge_auth_policy_due (origin_id)
         SELECT origin_id FROM sync_origin_credential
          WHERE node_role = 'STORE' AND revoked_at IS NULL
         ON CONFLICT (origin_id) DO UPDATE SET since = edge_auth_policy_due.since
         RETURNING origin_id",
    )
    .fetch_all(pool)
    .await;
    match origins {
        Ok(origins) => publish_node_access(pool, &origins, actor).await,
        Err(error) => {
            tracing::warn!(%error, "could not mark the stores for a policy publication");
        }
    }
}
