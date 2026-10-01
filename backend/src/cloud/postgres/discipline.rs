//! Warning letters (0811).

use crate::cloud::application::AppError;
use crate::cloud::domain::Authorization;
use chrono::{DateTime, Months, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct WarningLetterView {
    pub id: String,
    pub employee_id: String,
    pub employee_code: String,
    pub full_name: Option<String>,
    /// `TEGURAN`, `SP1`, `SP2` or `SP3`.
    pub level: String,
    pub issued_on: NaiveDate,
    pub valid_until: NaiveDate,
    pub violation: String,
    pub issued_by: String,
    pub acknowledged_at: Option<DateTime<Utc>>,
    pub revoked: bool,
    /// In force today: issued, not lapsed, not revoked.
    pub active: bool,
}

const LETTER_SELECT: &str = "
    SELECT w.id, w.employee_id, e.code AS employee_code, p.full_name, w.level, w.issued_on,
           w.valid_until, w.violation, w.issued->>'actor' AS issued_by, w.acknowledged_at,
           w.revoked_at IS NOT NULL AS revoked,
           (w.revoked_at IS NULL AND current_date BETWEEN w.issued_on AND w.valid_until) AS active
      FROM warning_letter w
      JOIN employee e ON e.id = w.employee_id
      LEFT JOIN employee_profile p ON p.employee_id = w.employee_id";

fn letter(row: &sqlx::postgres::PgRow) -> Result<WarningLetterView, AppError> {
    Ok(WarningLetterView {
        id: row.try_get("id")?,
        employee_id: row.try_get("employee_id")?,
        employee_code: row.try_get("employee_code")?,
        full_name: row.try_get("full_name")?,
        level: row.try_get("level")?,
        issued_on: row.try_get("issued_on")?,
        valid_until: row.try_get("valid_until")?,
        violation: row.try_get("violation")?,
        issued_by: row.try_get::<Option<String>, _>("issued_by")?.unwrap_or_default(),
        acknowledged_at: row.try_get("acknowledged_at")?,
        revoked: row.try_get("revoked")?,
        active: row.try_get("active")?,
    })
}

pub async fn warning_letters_of(pool: &PgPool, employee_id: &str) -> Result<Vec<WarningLetterView>, AppError> {
    let rows = sqlx::query(&format!(
        "{LETTER_SELECT} WHERE w.employee_id = $1 ORDER BY w.issued_on DESC, w.created_at DESC"
    ))
    .bind(employee_id)
    .fetch_all(pool)
    .await?;
    rows.iter().map(letter).collect()
}

/// Every letter in force today, for head office's list.
pub async fn active_warning_letters(pool: &PgPool) -> Result<Vec<WarningLetterView>, AppError> {
    let rows = sqlx::query(&format!(
        "{LETTER_SELECT}
          WHERE w.revoked_at IS NULL AND current_date BETWEEN w.issued_on AND w.valid_until
          ORDER BY w.level DESC, w.issued_on DESC"
    ))
    .fetch_all(pool)
    .await?;
    rows.iter().map(letter).collect()
}

/// Issue a letter. Six months in force unless a shorter or longer span is
/// stated (the company's rules may say either).
pub async fn issue_warning_letter(
    pool: &PgPool,
    employee_id: &str,
    level: &str,
    issued_on: NaiveDate,
    valid_months: Option<u32>,
    violation: &str,
    issued: &Authorization,
) -> Result<String, AppError> {
    let level = level.trim().to_ascii_uppercase();
    if !["TEGURAN", "SP1", "SP2", "SP3"].contains(&level.as_str()) {
        return Err(AppError::Validation("a letter is TEGURAN, SP1, SP2 or SP3".into()));
    }
    if violation.trim().is_empty() {
        return Err(AppError::Validation("say what was done".into()));
    }
    let months = valid_months.unwrap_or(6);
    if !(1..=12).contains(&months) {
        return Err(AppError::Validation("a letter is in force 1 to 12 months".into()));
    }
    let valid_until = issued_on
        .checked_add_months(Months::new(months))
        .and_then(|day| day.pred_opt())
        .ok_or_else(|| AppError::Validation("unreadable date".into()))?;
    let id = format!("sp-{}", Uuid::new_v4());
    sqlx::query(
        "INSERT INTO warning_letter (id, employee_id, level, issued_on, valid_until, violation, issued)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(&id)
    .bind(employee_id)
    .bind(&level)
    .bind(issued_on)
    .bind(valid_until)
    .bind(violation.trim())
    .bind(serde_json::to_value(issued)?)
    .execute(pool)
    .await?;
    Ok(id)
}

/// Whose letter it is.
pub async fn warning_letter_employee(pool: &PgPool, id: &str) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar("SELECT employee_id FROM warning_letter WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?)
}

pub async fn acknowledge_warning_letter(pool: &PgPool, id: &str, employee_id: &str) -> Result<(), AppError> {
    let done = sqlx::query(
        "UPDATE warning_letter SET acknowledged_at = now()
          WHERE id = $1 AND employee_id = $2 AND acknowledged_at IS NULL AND revoked_at IS NULL",
    )
    .bind(id)
    .bind(employee_id)
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "that letter is not yours, is already acknowledged, or was revoked".into(),
        ));
    }
    Ok(())
}

pub async fn revoke_warning_letter(pool: &PgPool, id: &str, revoked: &Authorization) -> Result<(), AppError> {
    let done = sqlx::query(
        "UPDATE warning_letter SET revoked_at = now(), revoked = $2
          WHERE id = $1 AND revoked_at IS NULL",
    )
    .bind(id)
    .bind(serde_json::to_value(revoked)?)
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "{id} does not exist or is already revoked"
        )));
    }
    Ok(())
}
