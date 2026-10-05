//! Finance's one-time code for a big shop expense (0822).
//!
//! A shop records petty cash expenses on its own. Above
//! `store_expense.code_above_minor` it needs a code Finance issued for that
//! shop, up to a ceiling, good until a time. The shop's node uses it up here.

use crate::cloud::application::AppError;
use chrono::{DateTime, Duration, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// Until Finance has said otherwise.
pub const DEFAULT_EXPENSE_CODE_ABOVE_MINOR: i64 = 500_000;

/// Head office's wall clock, for "end of today".
const HEAD_OFFICE_UTC_OFFSET_HOURS: i64 = 7;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExpenseCodeView {
    pub id: String,
    pub code: String,
    pub unit_id: String,
    pub ceiling_minor: i64,
    pub expires_at: DateTime<Utc>,
    pub note: Option<String>,
    pub issued_by: String,
    pub issued_at: DateTime<Utc>,
    /// `OPEN`, `USED`, `EXPIRED` or `CANCELLED`.
    pub status: String,
    pub used_at: Option<DateTime<Utc>>,
    pub used_amount_minor: Option<i64>,
    pub used_by: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct IssueExpenseCodeRequest {
    pub unit_id: String,
    /// The most the shop may spend with it, whole rupiah.
    pub ceiling_minor: i64,
    /// When it stops working. Absent: the end of today, head office time.
    #[serde(default)]
    pub expires_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub note: Option<String>,
}

/// What the centre answers a node that used a code.
#[derive(Clone, Debug, Serialize)]
pub struct ExpenseCodeUsed {
    pub code: String,
    pub ceiling_minor: i64,
    pub issued_by: String,
    pub code_above_minor: i64,
}

/// Finance's line: above this a shop expense needs a code.
pub async fn expense_code_above(pool: &PgPool) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE((SELECT round(value_numeric)::bigint FROM finance_setting
                           WHERE setting_key = 'store_expense.code_above_minor'), $1)",
    )
    .bind(DEFAULT_EXPENSE_CODE_ABOVE_MINOR)
    .fetch_one(pool)
    .await?)
}

fn end_of_today() -> DateTime<Utc> {
    let offset = Duration::hours(HEAD_OFFICE_UTC_OFFSET_HOURS);
    let local_day = (Utc::now() + offset).date_naive();
    let local_end = local_day.and_time(NaiveTime::from_hms_opt(23, 59, 59).unwrap_or_default());
    DateTime::<Utc>::from_naive_utc_and_offset(local_end, Utc) - offset
}

fn six_digits() -> String {
    let bytes = *Uuid::new_v4().as_bytes();
    format!(
        "{:06}",
        u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) % 1_000_000
    )
}

const VIEW: &str = "SELECT id, code, unit_id, ceiling_minor, expires_at, note, issued_by,
        issued_at, used_at, used_amount_minor, used_by,
        CASE WHEN used_at IS NOT NULL THEN 'USED'
             WHEN cancelled_at IS NOT NULL THEN 'CANCELLED'
             WHEN expires_at < now() THEN 'EXPIRED'
             ELSE 'OPEN' END AS status
   FROM store_expense_code";

fn view_of(row: &sqlx::postgres::PgRow) -> Result<ExpenseCodeView, AppError> {
    Ok(ExpenseCodeView {
        id: row.try_get::<Uuid, _>("id")?.to_string(),
        code: row.try_get("code")?,
        unit_id: row.try_get("unit_id")?,
        ceiling_minor: row.try_get("ceiling_minor")?,
        expires_at: row.try_get("expires_at")?,
        note: row.try_get("note")?,
        issued_by: row.try_get("issued_by")?,
        issued_at: row.try_get("issued_at")?,
        status: row.try_get("status")?,
        used_at: row.try_get("used_at")?,
        used_amount_minor: row.try_get("used_amount_minor")?,
        used_by: row.try_get("used_by")?,
    })
}

/// The codes issued for one shop, newest first.
pub async fn expense_codes(
    pool: &PgPool,
    unit_id: &str,
    limit: i64,
) -> Result<Vec<ExpenseCodeView>, AppError> {
    let rows = sqlx::query(&format!(
        "{VIEW} WHERE unit_id = $1 ORDER BY issued_at DESC LIMIT $2"
    ))
    .bind(unit_id)
    .bind(limit.clamp(1, 200))
    .fetch_all(pool)
    .await?;
    rows.iter().map(view_of).collect()
}

/// Finance issues a code for one shop.
pub async fn issue_expense_code(
    pool: &PgPool,
    request: &IssueExpenseCodeRequest,
    actor: &str,
) -> Result<ExpenseCodeView, AppError> {
    if request.ceiling_minor <= 0 {
        return Err(AppError::Validation("Enter the most the shop may spend.".into()));
    }
    if !super::sites::unit_exists(pool, request.unit_id.trim()).await? {
        return Err(AppError::NotFound(format!("shop {}", request.unit_id)));
    }
    let expires_at = request.expires_at.unwrap_or_else(end_of_today);
    if expires_at <= Utc::now() {
        return Err(AppError::Validation("That time has already passed.".into()));
    }
    let note = request
        .note
        .as_deref()
        .map(str::trim)
        .filter(|note| !note.is_empty());
    // Six digits; another draw on the rare clash with a live code.
    for _ in 0..10 {
        let id = Uuid::new_v4();
        let inserted = sqlx::query(
            "INSERT INTO store_expense_code
                 (id, code, unit_id, ceiling_minor, expires_at, note, issued_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT DO NOTHING",
        )
        .bind(id)
        .bind(six_digits())
        .bind(request.unit_id.trim())
        .bind(request.ceiling_minor)
        .bind(expires_at)
        .bind(note)
        .bind(actor)
        .execute(pool)
        .await?;
        if inserted.rows_affected() == 1 {
            let row = sqlx::query(&format!("{VIEW} WHERE id = $1"))
                .bind(id)
                .fetch_one(pool)
                .await?;
            return view_of(&row);
        }
    }
    Err(AppError::Conflict("No free code right now; try again.".into()))
}

/// Finance withdraws a code the shop has not used.
pub async fn cancel_expense_code(
    pool: &PgPool,
    id: Uuid,
    actor: &str,
) -> Result<ExpenseCodeView, AppError> {
    let done = sqlx::query(
        "UPDATE store_expense_code SET cancelled_at = now(), cancelled_by = $2
          WHERE id = $1 AND used_at IS NULL AND cancelled_at IS NULL",
    )
    .bind(id)
    .bind(actor)
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict("That code is already used or cancelled.".into()));
    }
    let row = sqlx::query(&format!("{VIEW} WHERE id = $1"))
        .bind(id)
        .fetch_one(pool)
        .await?;
    view_of(&row)
}

/// The shop's node uses a code for one expense.
///
/// Single use, this shop only, not expired, amount within the ceiling. The
/// same expense asking again (a retry) is answered as already used by it.
pub async fn use_expense_code(
    pool: &PgPool,
    unit_id: &str,
    code: &str,
    amount_minor: i64,
    expense_key: &str,
    actor: &str,
) -> Result<ExpenseCodeUsed, AppError> {
    let code = code.trim();
    let expense_key = expense_key.trim();
    if expense_key.is_empty() {
        return Err(AppError::Validation("the expense has no key".into()));
    }
    if amount_minor <= 0 {
        return Err(AppError::Validation("Enter an amount.".into()));
    }
    let code_above_minor = expense_code_above(pool).await?;
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "SELECT id, ceiling_minor, expires_at, issued_by, used_for
           FROM store_expense_code
          WHERE code = $1 AND unit_id = $2
            AND (used_for = $3 OR (used_at IS NULL AND cancelled_at IS NULL))
          ORDER BY (used_for = $3) DESC NULLS LAST, issued_at DESC
          LIMIT 1
          FOR UPDATE",
    )
    .bind(code)
    .bind(unit_id)
    .bind(expense_key)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        AppError::NotFound("That code is wrong for this shop, or already used.".into())
    })?;

    let id: Uuid = row.try_get("id")?;
    let ceiling_minor: i64 = row.try_get("ceiling_minor")?;
    let issued_by: String = row.try_get("issued_by")?;
    let used_for: Option<String> = row.try_get("used_for")?;
    let answer = ExpenseCodeUsed {
        code: code.to_owned(),
        ceiling_minor,
        issued_by,
        code_above_minor,
    };
    if used_for.as_deref() == Some(expense_key) {
        tx.commit().await?;
        return Ok(answer);
    }
    let expires_at: DateTime<Utc> = row.try_get("expires_at")?;
    if expires_at < Utc::now() {
        return Err(AppError::Conflict(
            "That code has expired. Ask Finance for a new one.".into(),
        ));
    }
    if amount_minor > ceiling_minor {
        return Err(AppError::Conflict(format!(
            "That code covers up to Rp {}.",
            grouped(ceiling_minor)
        )));
    }
    sqlx::query(
        "UPDATE store_expense_code
            SET used_at = now(), used_amount_minor = $2, used_by = $3, used_for = $4
          WHERE id = $1",
    )
    .bind(id)
    .bind(amount_minor)
    .bind(actor)
    .bind(expense_key)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(answer)
}

/// 1500000 as 1.500.000.
fn grouped(minor: i64) -> String {
    let digits = minor.unsigned_abs().to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push('.');
        }
        out.push(digit);
    }
    out
}
