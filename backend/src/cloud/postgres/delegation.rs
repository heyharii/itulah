//! Approval delegation (0812).

use crate::cloud::application::AppError;
use crate::cloud::domain::job_role::JobGrant;
use crate::cloud::domain::Role;
use chrono::NaiveDate;
use serde::Serialize;
use sqlx::{PgPool, Row};
use std::str::FromStr;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DelegationView {
    pub id: String,
    pub delegator: String,
    pub delegator_name: String,
    pub delegate: String,
    pub delegate_name: String,
    pub from_date: NaiveDate,
    pub to_date: NaiveDate,
    pub reason: String,
    pub created_by: String,
    pub revoked: bool,
    /// Running today.
    pub active: bool,
}

/// Delegations the user gave or was given; everybody's when `all`.
pub async fn delegations(
    pool: &PgPool,
    username: &str,
    all: bool,
) -> Result<Vec<DelegationView>, AppError> {
    let rows = sqlx::query(
        "SELECT d.id, d.delegator, a.display_name AS delegator_name, d.delegate,
                b.display_name AS delegate_name, d.from_date, d.to_date, d.reason, d.created_by,
                d.revoked_at IS NOT NULL AS revoked,
                (d.revoked_at IS NULL AND current_date BETWEEN d.from_date AND d.to_date) AS active
           FROM approval_delegation d
           JOIN app_user a ON a.username = d.delegator
           JOIN app_user b ON b.username = d.delegate
          WHERE $2 OR d.delegator = $1 OR d.delegate = $1
          ORDER BY d.revoked_at IS NOT NULL, d.from_date DESC",
    )
    .bind(username)
    .bind(all)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(DelegationView {
                id: row.try_get("id")?,
                delegator: row.try_get("delegator")?,
                delegator_name: row.try_get("delegator_name")?,
                delegate: row.try_get("delegate")?,
                delegate_name: row.try_get("delegate_name")?,
                from_date: row.try_get("from_date")?,
                to_date: row.try_get("to_date")?,
                reason: row.try_get("reason")?,
                created_by: row.try_get("created_by")?,
                revoked: row.try_get("revoked")?,
                active: row.try_get("active")?,
            })
        })
        .collect()
}

pub async fn create_delegation(
    pool: &PgPool,
    delegator: &str,
    delegate: &str,
    from_date: NaiveDate,
    to_date: NaiveDate,
    reason: &str,
    created_by: &str,
) -> Result<(), AppError> {
    if delegator == delegate {
        return Err(AppError::Validation("nobody delegates to themselves".into()));
    }
    if to_date < from_date {
        return Err(AppError::Validation("a delegation ends before it starts".into()));
    }
    if reason.trim().is_empty() {
        return Err(AppError::Validation("say why".into()));
    }
    sqlx::query(
        "INSERT INTO approval_delegation (id, delegator, delegate, from_date, to_date, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(format!("dlg-{}", Uuid::new_v4()))
    .bind(delegator)
    .bind(delegate)
    .bind(from_date)
    .bind(to_date)
    .bind(reason.trim())
    .bind(created_by)
    .execute(pool)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.is_foreign_key_violation() => {
            AppError::Validation(format!("{delegate} is not a login"))
        }
        _ => AppError::from(error),
    })?;
    Ok(())
}

/// Revoke one — by the person who gave it, or by an administrator.
pub async fn revoke_delegation(
    pool: &PgPool,
    id: &str,
    by: &str,
    administrator: bool,
) -> Result<(), AppError> {
    let done = sqlx::query(
        "UPDATE approval_delegation SET revoked_at = now(), revoked_by = $2
          WHERE id = $1 AND revoked_at IS NULL AND ($3 OR delegator = $2)",
    )
    .bind(id)
    .bind(by)
    .bind(administrator)
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "no running delegation of yours by that id".into(),
        ));
    }
    Ok(())
}

/// The highest rung, and its job, handed to `delegate` by a delegation
/// running today — `None` when nobody has handed them anything.
pub async fn delegated_authority(
    pool: &PgPool,
    delegate: &str,
) -> Result<Option<(Role, JobGrant)>, AppError> {
    let rows = sqlx::query(
        "SELECT u.role, u.role_code, r.name AS role_name, r.flow_roles, r.sections, r.read_only
           FROM approval_delegation d
           JOIN app_user u ON u.username = d.delegator AND u.active
           LEFT JOIN job_role r ON r.code = u.role_code
          WHERE d.delegate = $1 AND d.revoked_at IS NULL
            AND current_date BETWEEN d.from_date AND d.to_date",
    )
    .bind(delegate)
    .fetch_all(pool)
    .await?;
    let mut best: Option<(Role, JobGrant)> = None;
    for row in &rows {
        let role = Role::from_str(&row.try_get::<String, _>("role")?)
            .map_err(|error| AppError::Configuration(error.to_string()))?;
        if best.as_ref().is_none_or(|(held, _)| role > *held) {
            best = Some((role, super::job_grant_of(row)?));
        }
    }
    Ok(best)
}

// ── the employee app's modules (0813) ───────────────────────────────────────

pub const ESS_MODULES: [&str; 7] = [
    "ATTENDANCE", "LEAVE", "OVERTIME", "PAY", "CLAIMS", "CORRECTION", "SWAP",
];

pub async fn ess_modules(pool: &PgPool) -> Result<Vec<String>, AppError> {
    Ok(sqlx::query_scalar::<_, Vec<String>>("SELECT modules FROM ess_setting")
        .fetch_optional(pool)
        .await?
        .unwrap_or_else(|| ESS_MODULES.iter().map(|m| (*m).to_owned()).collect()))
}

pub async fn set_ess_modules(
    pool: &PgPool,
    modules: &[String],
    updated: &crate::cloud::domain::Authorization,
) -> Result<(), AppError> {
    let mut clean: Vec<String> = modules.iter().map(|m| m.trim().to_ascii_uppercase()).collect();
    if let Some(unknown) = clean.iter().find(|m| !ESS_MODULES.contains(&m.as_str())) {
        return Err(AppError::Validation(format!("{unknown} is not a module of the app")));
    }
    clean.sort();
    clean.dedup();
    sqlx::query(
        "INSERT INTO ess_setting (singleton, modules, updated, updated_at)
         VALUES (true, $1, $2, now())
         ON CONFLICT (singleton) DO UPDATE
            SET modules = EXCLUDED.modules, updated = EXCLUDED.updated, updated_at = now()",
    )
    .bind(&clean)
    .bind(serde_json::to_value(updated)?)
    .execute(pool)
    .await?;
    Ok(())
}
