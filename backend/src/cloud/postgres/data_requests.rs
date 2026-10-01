//! An employee's request to change their own details (0816).

use crate::cloud::application::AppError;
use crate::cloud::domain::Authorization;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PersonalDataRequestView {
    pub id: String,
    pub employee_id: String,
    pub employee_code: String,
    pub full_name: Option<String>,
    /// Where they work today, for the approver's reach.
    pub unit_id: Option<String>,
    /// `phone`, `email` or `address`.
    pub field: String,
    /// What is on record now.
    pub current: Option<String>,
    /// What they asked for. Empty clears a phone or an email.
    pub value: String,
    pub reason: String,
    /// `PENDING`, `APPROVED`, `REJECTED` or `WITHDRAWN`.
    pub state: String,
    pub filed_by: String,
    pub filed_at: DateTime<Utc>,
    pub decided_by: Option<String>,
    pub decision_reason: Option<String>,
}

const REQUEST_SELECT: &str = "
    SELECT r.id, r.employee_id, e.code AS employee_code, p.full_name,
           (SELECT a.unit_id FROM employee_assignment a
             WHERE a.employee_id = r.employee_id AND a.valid_from <= current_date
               AND (a.valid_to IS NULL OR a.valid_to >= current_date)
             ORDER BY a.valid_from DESC LIMIT 1) AS unit_id,
           r.field,
           CASE r.field WHEN 'phone' THEN p.phone WHEN 'email' THEN p.email
                        ELSE p.address END AS current,
           r.value, r.reason, r.state, r.filed->>'actor' AS filed_by, r.created_at,
           r.decided->>'actor' AS decided_by, r.decided->>'reason' AS decision_reason
      FROM personal_data_request r
      JOIN employee e ON e.id = r.employee_id
      LEFT JOIN employee_profile p ON p.employee_id = r.employee_id";

fn request(row: &sqlx::postgres::PgRow) -> Result<PersonalDataRequestView, AppError> {
    Ok(PersonalDataRequestView {
        id: row.try_get("id")?,
        employee_id: row.try_get("employee_id")?,
        employee_code: row.try_get("employee_code")?,
        full_name: row.try_get("full_name")?,
        unit_id: row.try_get("unit_id")?,
        field: row.try_get("field")?,
        current: row.try_get("current")?,
        value: row.try_get("value")?,
        reason: row.try_get("reason")?,
        state: row.try_get("state")?,
        filed_by: row.try_get::<Option<String>, _>("filed_by")?.unwrap_or_default(),
        filed_at: row.try_get("created_at")?,
        decided_by: row.try_get("decided_by")?,
        decision_reason: row.try_get("decision_reason")?,
    })
}

/// One person's requests, newest first.
pub async fn personal_data_requests_of(
    pool: &PgPool,
    employee_id: &str,
) -> Result<Vec<PersonalDataRequestView>, AppError> {
    let rows = sqlx::query(&format!(
        "{REQUEST_SELECT} WHERE r.employee_id = $1 ORDER BY r.created_at DESC"
    ))
    .bind(employee_id)
    .fetch_all(pool)
    .await?;
    rows.iter().map(request).collect()
}

/// Requests waiting on HR, oldest first; `all` adds the decided ones.
pub async fn personal_data_requests(
    pool: &PgPool,
    all: bool,
) -> Result<Vec<PersonalDataRequestView>, AppError> {
    let rows = sqlx::query(&format!(
        "{REQUEST_SELECT} WHERE $1 OR r.state = 'PENDING'
          ORDER BY (r.state = 'PENDING') DESC, r.created_at"
    ))
    .bind(all)
    .fetch_all(pool)
    .await?;
    rows.iter().map(request).collect()
}

pub async fn personal_data_request(
    pool: &PgPool,
    id: &str,
) -> Result<Option<PersonalDataRequestView>, AppError> {
    let row = sqlx::query(&format!("{REQUEST_SELECT} WHERE r.id = $1"))
        .bind(id)
        .fetch_optional(pool)
        .await?;
    row.as_ref().map(request).transpose()
}

/// File one. A second request for the same field while one is waiting is
/// refused: the approver would be choosing between two of the person's minds.
pub async fn file_personal_data_request(
    pool: &PgPool,
    employee_id: &str,
    field: &str,
    value: &str,
    filed: &Authorization,
) -> Result<String, AppError> {
    if !matches!(field, "phone" | "email" | "address") {
        return Err(AppError::Validation(format!(
            "{field:?} is not a detail an employee asks to change: expected phone, email or \
             address — name, NIK and date of birth change against a document, with HR"
        )));
    }
    let value = value.trim();
    if field == "address" && value.is_empty() {
        return Err(AppError::Validation("an address cannot be cleared".into()));
    }
    let waiting: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM personal_data_request
                         WHERE employee_id = $1 AND field = $2 AND state = 'PENDING')",
    )
    .bind(employee_id)
    .bind(field)
    .fetch_one(pool)
    .await?;
    if waiting {
        return Err(AppError::Conflict(format!(
            "a change to your {field} is already waiting on HR: withdraw it first"
        )));
    }
    let id = format!("pdr_{}", Uuid::new_v4().simple());
    sqlx::query(
        "INSERT INTO personal_data_request (id, employee_id, field, value, reason, filed)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&id)
    .bind(employee_id)
    .bind(field)
    .bind(value)
    .bind(filed.reason().as_str())
    .bind(serde_json::to_value(filed)?)
    .execute(pool)
    .await?;
    Ok(id)
}

/// Close a pending request as `state`, signed. Refused unless it is pending.
pub async fn close_personal_data_request(
    pool: &PgPool,
    id: &str,
    state: &str,
    by: &Authorization,
) -> Result<(), AppError> {
    let updated = sqlx::query(
        "UPDATE personal_data_request SET state = $2, decided = $3
          WHERE id = $1 AND state = 'PENDING'",
    )
    .bind(id)
    .bind(state)
    .bind(serde_json::to_value(by)?)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Conflict(format!("request {id} is no longer waiting")));
    }
    Ok(())
}
