//! The point policy: the everyday rate, the exceptions, and the snapshot a
//! store earns by.
//!
//! The return policy's shape (postgres 1005, `return_policy.rs`): one setting,
//! exceptions with one scope kind and a list of codes. Resolution lives in
//! `domain::point_policy`. The whole policy rides the auth policy to every
//! store (`AuthPolicySnapshot.point_policy`) so a till earns offline, and the
//! points it adds sit beside a promotion's, never instead of them (1008).

use super::return_policy::tell_every_store;
use crate::cloud::{
    application::AppError,
    domain::{
        PointPolicyRule, PointPolicySetting, PointPolicySnapshot, PointScopeKind,
        MAX_SPEND_PER_POINT,
    },
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgRow, PgPool, Row};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PointPolicySettingsRow {
    pub enabled: bool,
    pub spend_per_point: i64,
    pub updated_at: DateTime<Utc>,
    pub updated_by: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PointPolicyRow {
    pub policy_id: Uuid,
    pub name: String,
    pub scope_kind: PointScopeKind,
    pub spend_per_point: i64,
    pub earns: bool,
    pub site_ids: Vec<String>,
    pub starts_on: Option<NaiveDate>,
    pub ends_on: Option<NaiveDate>,
    pub active: bool,
    pub note: Option<String>,
    pub targets: Vec<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub updated_by: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PointPolicyCatalogue {
    pub settings: PointPolicySettingsRow,
    pub policies: Vec<PointPolicyRow>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SavePointPolicySettings {
    pub enabled: bool,
    pub spend_per_point: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SavePointPolicyRequest {
    /// Absent creates; present replaces the policy it names.
    #[serde(default)]
    pub policy_id: Option<Uuid>,
    pub name: String,
    pub scope_kind: PointScopeKind,
    pub spend_per_point: i64,
    #[serde(default = "yes")]
    pub earns: bool,
    #[serde(default)]
    pub site_ids: Vec<String>,
    #[serde(default)]
    pub starts_on: Option<NaiveDate>,
    #[serde(default)]
    pub ends_on: Option<NaiveDate>,
    #[serde(default = "yes")]
    pub active: bool,
    #[serde(default)]
    pub note: Option<String>,
    pub targets: Vec<String>,
}

fn yes() -> bool {
    true
}

fn validate_rate(rate: i64) -> Result<(), AppError> {
    if !(1..=MAX_SPEND_PER_POINT).contains(&rate) {
        return Err(AppError::Validation(format!(
            "one point is earned per Rp 1 to Rp {MAX_SPEND_PER_POINT}, not Rp {rate}"
        )));
    }
    Ok(())
}

fn clean_list(values: &[String]) -> Vec<String> {
    let mut clean: Vec<String> = values
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
    clean.sort();
    clean.dedup();
    clean
}

/// A target nobody has would match nothing and say so to no one.
async fn assert_targets_exist(
    pool: &PgPool,
    kind: PointScopeKind,
    targets: &[String],
) -> Result<(), AppError> {
    let sql = match kind {
        PointScopeKind::Division => "SELECT code FROM division WHERE code = ANY($1)",
        PointScopeKind::Tag => "SELECT code FROM tag WHERE code = ANY($1)",
        PointScopeKind::Article => "SELECT article_code FROM article WHERE article_code = ANY($1)",
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

fn scope_kind_of(raw: &str) -> Result<PointScopeKind, AppError> {
    match raw.trim().to_ascii_uppercase().as_str() {
        "DIVISION" => Ok(PointScopeKind::Division),
        "TAG" => Ok(PointScopeKind::Tag),
        "ARTICLE" => Ok(PointScopeKind::Article),
        other => Err(AppError::Validation(format!(
            "{other:?} is not a point-policy scope"
        ))),
    }
}

const POLICY_COLUMNS: &str = "policy_id,name,scope_kind,spend_per_point,earns,site_ids,starts_on,
     ends_on,active,note,created_by,created_at,updated_at,updated_by";

fn policy_of(row: &PgRow, targets: Vec<String>) -> Result<PointPolicyRow, AppError> {
    Ok(PointPolicyRow {
        policy_id: row.get("policy_id"),
        name: row.get("name"),
        scope_kind: scope_kind_of(row.get::<String, _>("scope_kind").as_str())?,
        spend_per_point: row.get("spend_per_point"),
        earns: row.get("earns"),
        site_ids: row.get("site_ids"),
        starts_on: row.get("starts_on"),
        ends_on: row.get("ends_on"),
        active: row.get("active"),
        note: row.get("note"),
        targets,
        created_by: row.get("created_by"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        updated_by: row.get("updated_by"),
    })
}

/// The setting, and every policy, for the Marketing screen.
pub async fn point_policy_catalogue(pool: &PgPool) -> Result<PointPolicyCatalogue, AppError> {
    let settings = read_point_settings(pool).await?;
    let rows = sqlx::query(&format!(
        "SELECT {POLICY_COLUMNS} FROM point_policy ORDER BY scope_kind, name"
    ))
    .fetch_all(pool)
    .await?;
    let target_rows =
        sqlx::query("SELECT policy_id,scope_code FROM point_policy_target ORDER BY scope_code")
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
        policies.push(policy_of(
            &row,
            targets.remove(&policy_id).unwrap_or_default(),
        )?);
    }
    Ok(PointPolicyCatalogue { settings, policies })
}

pub async fn read_point_settings(pool: &PgPool) -> Result<PointPolicySettingsRow, AppError> {
    let row = sqlx::query(
        "SELECT enabled,spend_per_point,updated_at,updated_by
           FROM point_policy_setting WHERE singleton=1",
    )
    .fetch_one(pool)
    .await?;
    Ok(PointPolicySettingsRow {
        enabled: row.get("enabled"),
        spend_per_point: row.get("spend_per_point"),
        updated_at: row.get("updated_at"),
        updated_by: row.get("updated_by"),
    })
}

pub async fn save_point_settings(
    pool: &PgPool,
    request: &SavePointPolicySettings,
    actor: &str,
) -> Result<PointPolicySettingsRow, AppError> {
    validate_rate(request.spend_per_point)?;
    sqlx::query(
        "UPDATE point_policy_setting
            SET enabled=$1,spend_per_point=$2,updated_at=now(),updated_by=$3
          WHERE singleton=1",
    )
    .bind(request.enabled)
    .bind(request.spend_per_point)
    .bind(actor)
    .execute(pool)
    .await?;
    let settings = read_point_settings(pool).await?;
    tell_every_store(pool, actor).await;
    Ok(settings)
}

/// Create or replace one policy.
pub async fn save_point_policy(
    pool: &PgPool,
    request: &SavePointPolicyRequest,
    actor: &str,
) -> Result<PointPolicyRow, AppError> {
    validate_rate(request.spend_per_point)?;
    let name = request.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("a point policy needs a name".into()));
    }
    if name.chars().count() > 120 {
        return Err(AppError::Validation(
            "a point policy name is at most 120 characters".into(),
        ));
    }
    if let (Some(start), Some(end)) = (request.starts_on, request.ends_on) {
        if end < start {
            return Err(AppError::Validation(
                "a point policy cannot end before it starts".into(),
            ));
        }
    }
    let targets = clean_list(&request.targets);
    if targets.is_empty() {
        return Err(AppError::Validation(
            "choose at least one division, tag or article for this policy".into(),
        ));
    }
    assert_targets_exist(pool, request.scope_kind, &targets).await?;
    let site_ids = clean_list(&request.site_ids);
    let note = request
        .note
        .as_deref()
        .map(str::trim)
        .filter(|note| !note.is_empty());
    let mut tx = pool.begin().await?;
    let policy_id = match request.policy_id {
        Some(policy_id) => {
            let updated = sqlx::query(
                "UPDATE point_policy
                    SET name=$2,scope_kind=$3,spend_per_point=$4,earns=$5,site_ids=$6,
                        starts_on=$7,ends_on=$8,active=$9,note=$10,
                        updated_at=now(),updated_by=$11
                  WHERE policy_id=$1",
            )
            .bind(policy_id)
            .bind(name)
            .bind(request.scope_kind.as_str())
            .bind(request.spend_per_point)
            .bind(request.earns)
            .bind(&site_ids)
            .bind(request.starts_on)
            .bind(request.ends_on)
            .bind(request.active)
            .bind(note)
            .bind(actor)
            .execute(&mut *tx)
            .await?;
            if updated.rows_affected() == 0 {
                return Err(AppError::NotFound(format!("point policy {policy_id}")));
            }
            sqlx::query("DELETE FROM point_policy_target WHERE policy_id=$1")
                .bind(policy_id)
                .execute(&mut *tx)
                .await?;
            policy_id
        }
        None => {
            sqlx::query_scalar(
                "INSERT INTO point_policy (name,scope_kind,spend_per_point,earns,site_ids,
                                       starts_on,ends_on,active,note,created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING policy_id",
            )
            .bind(name)
            .bind(request.scope_kind.as_str())
            .bind(request.spend_per_point)
            .bind(request.earns)
            .bind(&site_ids)
            .bind(request.starts_on)
            .bind(request.ends_on)
            .bind(request.active)
            .bind(note)
            .bind(actor)
            .fetch_one(&mut *tx)
            .await?
        }
    };
    for target in &targets {
        sqlx::query(
            "INSERT INTO point_policy_target (policy_id,scope_kind,scope_code)
             VALUES ($1,$2,$3)",
        )
        .bind(policy_id)
        .bind(request.scope_kind.as_str())
        .bind(target)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    let row = point_policy_by_id(pool, policy_id).await?;
    tell_every_store(pool, actor).await;
    Ok(row)
}

pub async fn point_policy_by_id(
    pool: &PgPool,
    policy_id: Uuid,
) -> Result<PointPolicyRow, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {POLICY_COLUMNS} FROM point_policy WHERE policy_id=$1"
    ))
    .bind(policy_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("point policy {policy_id}")))?;
    let targets: Vec<String> = sqlx::query_scalar(
        "SELECT scope_code FROM point_policy_target WHERE policy_id=$1 ORDER BY scope_code",
    )
    .bind(policy_id)
    .fetch_all(pool)
    .await?;
    policy_of(&row, targets)
}

pub async fn delete_point_policy(
    pool: &PgPool,
    policy_id: Uuid,
    actor: &str,
) -> Result<(), AppError> {
    let deleted = sqlx::query("DELETE FROM point_policy WHERE policy_id=$1")
        .bind(policy_id)
        .execute(pool)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("point policy {policy_id}")));
    }
    tell_every_store(pool, actor).await;
    Ok(())
}

/// The policy as a store receives it. Only active policies travel; stores and
/// dates travel too, because a till offline across midnight must still stop a
/// policy on its last day.
pub async fn point_policy_snapshot(pool: &PgPool) -> Result<PointPolicySnapshot, AppError> {
    let settings = read_point_settings(pool).await?;
    let catalogue = point_policy_catalogue(pool).await?;
    Ok(PointPolicySnapshot {
        setting: PointPolicySetting {
            enabled: settings.enabled,
            spend_per_point: settings.spend_per_point,
        },
        rules: catalogue
            .policies
            .into_iter()
            .filter(|policy| policy.active)
            .map(|policy| PointPolicyRule {
                name: policy.name,
                scope_kind: policy.scope_kind,
                targets: policy.targets,
                spend_per_point: policy.spend_per_point,
                earns: policy.earns,
                site_ids: policy.site_ids,
                starts_on: policy.starts_on,
                ends_on: policy.ends_on,
            })
            .collect(),
    })
}
