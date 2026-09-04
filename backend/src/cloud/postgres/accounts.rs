//! Issuing a login for somebody who has none.
//!
//! Two questions the Directory's "give this person an account" form asks, and
//! nothing else. They are here rather than beside `employment` because they
//! reach outside employment entirely — into `sync_origin_credential` and
//! `edge_identity_assignment`, which are the till's vocabulary rather than
//! HR's — and because the transaction one of them takes part in belongs to
//! `postgres::users`, not to the employment record.
//!
//! Provisioning itself lives in `postgres::users::provision_account`; what is
//! here is the list of tills a place is served by, and the binding step that
//! transaction calls.

use crate::cloud::application::AppError;
use crate::cloud::domain::Authorization;
use serde::Serialize;
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// Which syncing nodes an employee's place is served by.
///
/// A place is a `site`, and a site may be registered as one or more Edge
/// origins — that is the row an `edge_identity_assignment` hangs off. Head
/// office needs the list to answer "which till does this person sign into",
/// and deriving it in a browser would mean the browser knowing that
/// `org_place.site_id` and `sync_origin_credential.site_id` are the same
/// vocabulary. They are; it is not the browser's business that they are.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EdgeTarget {
    pub origin_id: String,
    pub label: Option<String>,
    pub site_id: Option<String>,
    pub node_role: Option<String>,
    /// Whether this person already has a grant at this node — so the screen
    /// offers "rotate the PIN" rather than "grant access" for somebody who has
    /// one, and head office is not surprised by which of the two it did.
    pub granted: bool,
    pub granted_role: Option<String>,
    pub granted_active: Option<bool>,
}

pub async fn edge_targets(pool: &PgPool, employee_id: &str) -> Result<Vec<EdgeTarget>, AppError> {
    let rows = sqlx::query(
        "SELECT o.origin_id, o.label, o.site_id, o.node_role,
                a.user_id IS NOT NULL granted, a.edge_role granted_role, a.active granted_active
         FROM sync_origin_credential o
         JOIN org_place place ON place.site_id = o.site_id
         JOIN employee_assignment asg
           ON asg.place_id = place.id AND asg.valid_to IS NULL
         LEFT JOIN app_user u ON u.employee_id = asg.employee_id
         LEFT JOIN edge_identity_assignment a
           ON a.origin_id = o.origin_id AND a.user_id = u.id
         WHERE asg.employee_id = $1 AND o.inventory_enabled
         ORDER BY o.origin_id",
    )
    .bind(employee_id)
    .fetch_all(pool)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(EdgeTarget {
                origin_id: row.try_get("origin_id")?,
                label: row.try_get("label")?,
                site_id: row.try_get("site_id")?,
                node_role: row.try_get("node_role")?,
                granted: row.try_get("granted")?,
                granted_role: row.try_get("granted_role")?,
                granted_active: row.try_get("granted_active")?,
            })
        })
        .collect()
}

/// Bind a freshly created account to an employment record, inside a
/// transaction the caller owns.
///
/// The same three refusals `employment::link_account` makes, minus the ones
/// that cannot apply to an account created a statement ago. Kept here rather
/// than reused because that function opens its own transaction, and a
/// provisioning that created an account and then failed to bind it would leave
/// a live credential belonging to nobody.
pub async fn bind_new_account(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
    user_id: Uuid,
    authorization: &Authorization,
) -> Result<(), AppError> {
    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM employee WHERE id = $1 FOR UPDATE")
            .bind(employee_id)
            .fetch_optional(&mut **tx)
            .await?;
    let Some(status) = status else {
        return Err(AppError::NotFound(format!("employee {employee_id}")));
    };
    if status == crate::cloud::domain::EmploymentStatus::Terminated.code() {
        return Err(AppError::Conflict(format!(
            "employee {employee_id} has left; a login is not issued to somebody \
             whose employment is over"
        )));
    }
    let held_by: Option<String> =
        sqlx::query_scalar("SELECT username FROM app_user WHERE employee_id = $1")
            .bind(employee_id)
            .fetch_optional(&mut **tx)
            .await?;
    if let Some(held_by) = held_by {
        return Err(AppError::Conflict(format!(
            "employee {employee_id} already signs in as {held_by}; release that \
             login before issuing another"
        )));
    }
    sqlx::query("UPDATE app_user SET employee_id = $2, updated_at = now() WHERE id = $1")
        .bind(user_id)
        .bind(employee_id)
        .execute(&mut **tx)
        .await?;
    sqlx::query(
        "INSERT INTO employee_account_link (employee_id, user_id, act, actor, reason, at)
         VALUES ($1, $2, 'LINK', $3, $4, $5)",
    )
    .bind(employee_id)
    .bind(user_id)
    .bind(authorization.actor().to_string())
    .bind(authorization.reason().to_string())
    .bind(authorization.at())
    .execute(&mut **tx)
    .await?;
    Ok(())
}
