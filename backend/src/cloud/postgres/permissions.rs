//! Role permissions Finance and the owner edit (0472) — ERPNext's Role
//! Permission Manager over this estate's three roles.
//!
//! `domain::auth::required_role` stays the default answer; a row here
//! overrides it for a method and a path prefix. The HTTP gate reads the rows
//! through a short cache, and a change here clears it.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};

use crate::cloud::application::AppError;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RolePermission {
    /// `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, or `*` for every method.
    pub method: String,
    /// Applies to every path that starts with this, e.g. `/api/v1/finance/journal`.
    pub path_prefix: String,
    /// `CASHIER`, `SUPERVISOR` or `ADMIN`.
    pub min_role: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub set_by: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub set_at: Option<DateTime<Utc>>,
}

pub async fn role_permissions(pool: &PgPool) -> Result<Vec<RolePermission>, AppError> {
    let rows = sqlx::query(
        "SELECT method, path_prefix, min_role, note, set_by, set_at FROM role_permission
          ORDER BY path_prefix, method",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(RolePermission {
                method: row.try_get("method")?,
                path_prefix: row.try_get("path_prefix")?,
                min_role: row.try_get("min_role")?,
                note: row.try_get("note")?,
                set_by: Some(row.try_get("set_by")?),
                set_at: Some(row.try_get("set_at")?),
            })
        })
        .collect()
}

pub async fn set_role_permission(
    pool: &PgPool,
    permission: &RolePermission,
    actor: &str,
) -> Result<Vec<RolePermission>, AppError> {
    let method = permission.method.trim().to_ascii_uppercase();
    let role = permission.min_role.trim().to_ascii_uppercase();
    let prefix = permission.path_prefix.trim();
    if !prefix.starts_with("/api/") {
        return Err(AppError::Validation(
            "a permission covers a path under /api/".into(),
        ));
    }
    // Nobody locks themselves out of the screen that gives access back.
    if prefix.starts_with("/api/v1/finance/permissions") && role != "ADMIN" {
        return Err(AppError::Validation(
            "the permissions themselves stay ADMIN's".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO role_permission (method, path_prefix, min_role, note, set_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (method, path_prefix) DO UPDATE
            SET min_role = EXCLUDED.min_role, note = EXCLUDED.note,
                set_by = EXCLUDED.set_by, set_at = now()",
    )
    .bind(&method)
    .bind(prefix)
    .bind(&role)
    .bind(permission.note.as_deref())
    .bind(actor)
    .execute(pool)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23514") => AppError::Validation(
            "a permission names a method (GET, POST, PUT, PATCH, DELETE or *) and a role \
             (CASHIER, SUPERVISOR or ADMIN)"
                .into(),
        ),
        _ => error.into(),
    })?;
    role_permissions(pool).await
}

pub async fn remove_role_permission(
    pool: &PgPool,
    method: &str,
    path_prefix: &str,
) -> Result<Vec<RolePermission>, AppError> {
    sqlx::query("DELETE FROM role_permission WHERE method = $1 AND path_prefix = $2")
        .bind(method.to_ascii_uppercase())
        .bind(path_prefix)
        .execute(pool)
        .await?;
    role_permissions(pool).await
}
