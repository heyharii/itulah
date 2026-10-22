//! The employee benefit balance (0818): HR fills it, the till spends it.

use crate::cloud::application::AppError;
use crate::cloud::domain::Authorization;
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BenefitBalanceRow {
    pub employee_id: String,
    pub employee_code: String,
    pub full_name: Option<String>,
    pub unit_id: Option<String>,
    pub balance_minor: i64,
    pub last_moved_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BenefitEntryView {
    pub id: String,
    /// `ADD`, `REMOVE`, `RESET`, `SPEND` or `RETURN`.
    pub kind: String,
    pub delta_minor: i64,
    pub balance_after: i64,
    pub reason: String,
    pub unit_id: Option<String>,
    pub sale_ref: Option<String>,
    pub by: String,
    pub at: DateTime<Utc>,
}

/// One movement in the company-wide history: the entry, and whose balance
/// it moved.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BenefitMovementRow {
    pub id: String,
    pub employee_id: String,
    pub employee_code: String,
    pub full_name: Option<String>,
    /// Where the person is posted now — what the unit filter reads.
    pub employee_unit_id: Option<String>,
    /// `ADD`, `REMOVE`, `RESET`, `SPEND` or `RETURN`.
    pub kind: String,
    pub delta_minor: i64,
    pub balance_after: i64,
    pub reason: String,
    /// The till's unit, on a spend or a return.
    pub unit_id: Option<String>,
    pub sale_ref: Option<String>,
    pub by: String,
    pub at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BenefitAccountView {
    pub employee_id: String,
    pub balance_minor: i64,
    pub entries: Vec<BenefitEntryView>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BenefitSettingView {
    pub effective_from: NaiveDate,
    pub enabled: bool,
    pub code_minutes: i32,
    pub set_by: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BenefitCodeView {
    pub code: String,
    pub expires_at: DateTime<Utc>,
    pub balance_minor: i64,
}

/// What the till sees when a code is shown: whose it is and what is left.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BenefitHolderView {
    pub employee_id: String,
    pub employee_code: String,
    pub full_name: Option<String>,
    pub balance_minor: i64,
}

// ── settings ──────────────────────────────────────────────────────────────

pub async fn benefit_settings(pool: &PgPool) -> Result<Vec<BenefitSettingView>, AppError> {
    let rows = sqlx::query(
        "SELECT effective_from, enabled, code_minutes, set_by->>'actor' AS by_actor,
                set_by->>'reason' AS reason
           FROM benefit_setting ORDER BY effective_from DESC",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(BenefitSettingView {
                effective_from: row.try_get("effective_from")?,
                enabled: row.try_get("enabled")?,
                code_minutes: row.try_get("code_minutes")?,
                set_by: row
                    .try_get::<Option<String>, _>("by_actor")?
                    .unwrap_or_default(),
                reason: row
                    .try_get::<Option<String>, _>("reason")?
                    .unwrap_or_default(),
            })
        })
        .collect()
}

pub async fn state_benefit_setting(
    pool: &PgPool,
    effective_from: NaiveDate,
    enabled: bool,
    code_minutes: i32,
    by: &Authorization,
) -> Result<(), AppError> {
    if !(1..=60).contains(&code_minutes) {
        return Err(AppError::Validation(
            "a code stays good for 1 to 60 minutes".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO benefit_setting (effective_from, enabled, code_minutes, set_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (effective_from) DO UPDATE
            SET enabled = EXCLUDED.enabled, code_minutes = EXCLUDED.code_minutes,
                set_by = EXCLUDED.set_by",
    )
    .bind(effective_from)
    .bind(enabled)
    .bind(code_minutes)
    .bind(serde_json::to_value(by)?)
    .execute(pool)
    .await?;
    Ok(())
}

/// The setting in force today: `(enabled, code_minutes)`. Off until head
/// office turns it on — a balance nobody can spend is a balance nobody set up.
async fn setting_now(tx: &mut Transaction<'_, Postgres>) -> Result<(bool, i32), AppError> {
    let row: Option<(bool, i32)> = sqlx::query_as(
        "SELECT enabled, code_minutes FROM benefit_setting
          WHERE effective_from <= current_date ORDER BY effective_from DESC LIMIT 1",
    )
    .fetch_optional(&mut **tx)
    .await?;
    Ok(row.unwrap_or((false, 5)))
}

// ── the ledger ────────────────────────────────────────────────────────────

/// Serialises every movement of one person's balance and reads it.
async fn locked_balance(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
) -> Result<i64, AppError> {
    let exists: Option<String> =
        sqlx::query_scalar("SELECT id FROM employee WHERE id = $1 FOR UPDATE")
            .bind(employee_id)
            .fetch_optional(&mut **tx)
            .await?;
    if exists.is_none() {
        return Err(AppError::NotFound(format!("employee {employee_id}")));
    }
    Ok(sqlx::query_scalar(
        "SELECT balance_after FROM benefit_entry WHERE employee_id = $1
          ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .bind(employee_id)
    .fetch_optional(&mut **tx)
    .await?
    .unwrap_or(0))
}

#[allow(clippy::too_many_arguments)]
async fn append(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
    kind: &str,
    delta: i64,
    balance_after: i64,
    reason: &str,
    unit_id: Option<&str>,
    sale_ref: Option<&str>,
    by: &Authorization,
) -> Result<String, AppError> {
    let id = format!("ben_{}", Uuid::new_v4().simple());
    sqlx::query(
        "INSERT INTO benefit_entry
             (id, employee_id, kind, delta_minor, balance_after, reason, unit_id, sale_ref, by_actor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(&id)
    .bind(employee_id)
    .bind(kind)
    .bind(delta)
    .bind(balance_after)
    .bind(reason)
    .bind(unit_id)
    .bind(sale_ref)
    .bind(serde_json::to_value(by)?)
    .execute(&mut **tx)
    .await?;
    Ok(id)
}

/// HR's hand on a balance: add to it, take some off, or set it to a figure.
pub async fn adjust_benefit(
    pool: &PgPool,
    employee_id: &str,
    action: &str,
    amount_minor: i64,
    by: &Authorization,
) -> Result<i64, AppError> {
    if amount_minor < 0 || (action != "RESET" && amount_minor == 0) {
        return Err(AppError::Validation(
            "an amount is a positive number of rupiah (a reset may be to nothing)".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let now = locked_balance(&mut tx, employee_id).await?;
    let (delta, after) = match action {
        "ADD" => (amount_minor, now + amount_minor),
        "REMOVE" => {
            if amount_minor > now {
                return Err(AppError::Conflict(format!(
                    "only {now} is left to take off; reset it to 0 to clear it"
                )));
            }
            (-amount_minor, now - amount_minor)
        }
        "RESET" => (amount_minor - now, amount_minor),
        other => {
            return Err(AppError::Validation(format!(
                "{other:?} is not an action: expected ADD, REMOVE or RESET"
            )))
        }
    };
    append(
        &mut tx,
        employee_id,
        action,
        delta,
        after,
        by.reason().as_str(),
        None,
        None,
        by,
    )
    .await?;
    tx.commit().await?;
    Ok(after)
}

pub async fn benefit_account(
    pool: &PgPool,
    employee_id: &str,
) -> Result<BenefitAccountView, AppError> {
    let rows = sqlx::query(
        "SELECT id, kind, delta_minor, balance_after, reason, unit_id, sale_ref,
                by_actor->>'actor' AS by_name, created_at
           FROM benefit_entry WHERE employee_id = $1
          ORDER BY created_at DESC, id DESC LIMIT 200",
    )
    .bind(employee_id)
    .fetch_all(pool)
    .await?;
    let entries = rows
        .iter()
        .map(|row| {
            Ok(BenefitEntryView {
                id: row.try_get("id")?,
                kind: row.try_get("kind")?,
                delta_minor: row.try_get("delta_minor")?,
                balance_after: row.try_get("balance_after")?,
                reason: row.try_get("reason")?,
                unit_id: row.try_get("unit_id")?,
                sale_ref: row.try_get("sale_ref")?,
                by: row
                    .try_get::<Option<String>, _>("by_name")?
                    .unwrap_or_default(),
                at: row.try_get("created_at")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    Ok(BenefitAccountView {
        employee_id: employee_id.to_owned(),
        balance_minor: entries.first().map_or(0, |entry| entry.balance_after),
        entries,
    })
}

/// Every movement of every balance, newest first: Benefits › History.
///
/// `from`/`to` are calendar days in Jakarta, both ends included; `unit` is
/// where the person is posted now, the same unit the balances list shows.
pub async fn benefit_movements(
    pool: &PgPool,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    unit: Option<&str>,
) -> Result<Vec<BenefitMovementRow>, AppError> {
    let rows = sqlx::query(
        "SELECT b.id, b.employee_id, e.code, p.full_name, posted.unit_id AS employee_unit_id,
                b.kind, b.delta_minor, b.balance_after, b.reason, b.unit_id, b.sale_ref,
                b.by_actor->>'actor' AS by_name, b.created_at
           FROM benefit_entry b
           JOIN employee e ON e.id = b.employee_id
           LEFT JOIN employee_profile p ON p.employee_id = b.employee_id
           LEFT JOIN LATERAL (
                SELECT a.unit_id FROM employee_assignment a
                 WHERE a.employee_id = b.employee_id
                   AND (a.valid_to IS NULL OR a.valid_to >= current_date)
                 ORDER BY a.valid_from LIMIT 1
           ) posted ON TRUE
          WHERE ($1::date IS NULL OR (b.created_at AT TIME ZONE 'Asia/Jakarta')::date >= $1)
            AND ($2::date IS NULL OR (b.created_at AT TIME ZONE 'Asia/Jakarta')::date <= $2)
            AND ($3::text IS NULL OR posted.unit_id = $3)
          ORDER BY b.created_at DESC, b.id DESC
          LIMIT 1000",
    )
    .bind(from)
    .bind(to)
    .bind(unit)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(BenefitMovementRow {
                id: row.try_get("id")?,
                employee_id: row.try_get("employee_id")?,
                employee_code: row.try_get("code")?,
                full_name: row.try_get("full_name")?,
                employee_unit_id: row.try_get("employee_unit_id")?,
                kind: row.try_get("kind")?,
                delta_minor: row.try_get("delta_minor")?,
                balance_after: row.try_get("balance_after")?,
                reason: row.try_get("reason")?,
                unit_id: row.try_get("unit_id")?,
                sale_ref: row.try_get("sale_ref")?,
                by: row
                    .try_get::<Option<String>, _>("by_name")?
                    .unwrap_or_default(),
                at: row.try_get("created_at")?,
            })
        })
        .collect()
}

/// Everybody working, with what they hold — zero included, so a list is
/// where HR fills balances from.
pub async fn benefit_balances(pool: &PgPool) -> Result<Vec<BenefitBalanceRow>, AppError> {
    let rows = sqlx::query(
        "SELECT e.id, e.code, p.full_name,
                (SELECT a.unit_id FROM employee_assignment a
                  WHERE a.employee_id = e.id
                    AND (a.valid_to IS NULL OR a.valid_to >= current_date)
                  ORDER BY a.valid_from LIMIT 1) AS unit_id,
                b.balance_after, b.created_at
           FROM employee e
           LEFT JOIN employee_profile p ON p.employee_id = e.id
           LEFT JOIN LATERAL (
                SELECT balance_after, created_at FROM benefit_entry
                 WHERE employee_id = e.id ORDER BY created_at DESC, id DESC LIMIT 1
           ) b ON TRUE
          WHERE e.status = 'ACTIVE'
          ORDER BY COALESCE(p.full_name, e.code)",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(BenefitBalanceRow {
                employee_id: row.try_get("id")?,
                employee_code: row.try_get("code")?,
                full_name: row.try_get("full_name")?,
                unit_id: row.try_get("unit_id")?,
                balance_minor: row.try_get::<Option<i64>, _>("balance_after")?.unwrap_or(0),
                last_moved_at: row.try_get("created_at")?,
            })
        })
        .collect()
}

// ── the till ──────────────────────────────────────────────────────────────

/// A fresh code for the employee to show at the till. An older unused one
/// stops working: one code in a pocket at a time.
pub async fn issue_benefit_code(
    pool: &PgPool,
    employee_id: &str,
) -> Result<BenefitCodeView, AppError> {
    let mut tx = pool.begin().await?;
    let (enabled, minutes) = setting_now(&mut tx).await?;
    if !enabled {
        return Err(AppError::Conflict(
            "the employee benefit is not turned on".into(),
        ));
    }
    let balance = locked_balance(&mut tx, employee_id).await?;
    sqlx::query(
        "UPDATE benefit_code SET used_at = now()
          WHERE employee_id = $1 AND used_at IS NULL",
    )
    .bind(employee_id)
    .execute(&mut *tx)
    .await?;
    let expires_at = Utc::now() + Duration::minutes(i64::from(minutes));
    // Six digits a cashier can key in; retried on the rare live collision.
    for _ in 0..10 {
        let code = format!("{:06}", rand_six());
        let inserted = sqlx::query(
            "INSERT INTO benefit_code (code, employee_id, expires_at)
             VALUES ($1, $2, $3)
             ON CONFLICT (code) DO UPDATE
                SET employee_id = EXCLUDED.employee_id, expires_at = EXCLUDED.expires_at,
                    used_at = NULL, created_at = now()
              WHERE benefit_code.used_at IS NOT NULL OR benefit_code.expires_at < now()",
        )
        .bind(&code)
        .bind(employee_id)
        .bind(expires_at)
        .execute(&mut *tx)
        .await?;
        if inserted.rows_affected() == 1 {
            tx.commit().await?;
            return Ok(BenefitCodeView {
                code,
                expires_at,
                balance_minor: balance,
            });
        }
    }
    Err(AppError::Conflict(
        "no free code right now; try again".into(),
    ))
}

fn rand_six() -> u32 {
    let bytes = *Uuid::new_v4().as_bytes();
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) % 1_000_000
}

/// Whose code this is, if it is still good. Does not use it up.
async fn holder_of(tx: &mut Transaction<'_, Postgres>, code: &str) -> Result<String, AppError> {
    let employee: Option<String> = sqlx::query_scalar(
        "SELECT employee_id FROM benefit_code
          WHERE code = $1 AND used_at IS NULL AND expires_at > now()",
    )
    .bind(code.trim())
    .fetch_optional(&mut **tx)
    .await?;
    employee.ok_or_else(|| {
        AppError::NotFound(
            "that code is not good: wrong, used, or expired — ask for a new one".into(),
        )
    })
}

pub async fn benefit_holder(pool: &PgPool, code: &str) -> Result<BenefitHolderView, AppError> {
    let mut tx = pool.begin().await?;
    let (enabled, _) = setting_now(&mut tx).await?;
    if !enabled {
        return Err(AppError::Conflict(
            "the employee benefit is not turned on".into(),
        ));
    }
    let employee_id = holder_of(&mut tx, code).await?;
    let balance = locked_balance(&mut tx, &employee_id).await?;
    let (employee_code, full_name): (String, Option<String>) = sqlx::query_as(
        "SELECT e.code, p.full_name FROM employee e
           LEFT JOIN employee_profile p ON p.employee_id = e.id WHERE e.id = $1",
    )
    .bind(&employee_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(BenefitHolderView {
        employee_id,
        employee_code,
        full_name,
        balance_minor: balance,
    })
}

/// Spend part of a basket from the balance shown by `code`. Refused for a
/// sale that already spent once, for more than is left, for a basket on
/// promotion, and for the cashier's own balance.
#[allow(clippy::too_many_arguments)]
pub async fn spend_benefit(
    pool: &PgPool,
    code: &str,
    sale_ref: &str,
    unit_id: &str,
    amount_minor: i64,
    basket_has_promotion: bool,
    cashier_employee_id: Option<&str>,
    by: &Authorization,
) -> Result<BenefitHolderView, AppError> {
    if amount_minor <= 0 {
        return Err(AppError::Validation(
            "spend a positive number of rupiah".into(),
        ));
    }
    if sale_ref.trim().is_empty() {
        return Err(AppError::Validation(
            "a spend names the sale it pays".into(),
        ));
    }
    if basket_has_promotion {
        return Err(AppError::Conflict(
            "the employee benefit does not combine with a promotion".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let (enabled, _) = setting_now(&mut tx).await?;
    if !enabled {
        return Err(AppError::Conflict(
            "the employee benefit is not turned on".into(),
        ));
    }
    let employee_id = holder_of(&mut tx, code).await?;
    if cashier_employee_id == Some(employee_id.as_str()) {
        return Err(AppError::Forbidden(
            "a cashier does not ring up their own benefit; ask a colleague".into(),
        ));
    }
    let balance = locked_balance(&mut tx, &employee_id).await?;
    if amount_minor > balance {
        return Err(AppError::Conflict(format!(
            "only {balance} is left on this balance"
        )));
    }
    append(
        &mut tx,
        &employee_id,
        "SPEND",
        -amount_minor,
        balance - amount_minor,
        by.reason().as_str(),
        Some(unit_id),
        Some(sale_ref.trim()),
        by,
    )
    .await
    .map_err(|error| match &error {
        AppError::Database(sqlx::Error::Database(db)) if db.is_unique_violation() => {
            AppError::Conflict(format!("sale {sale_ref} has already spent a benefit"))
        }
        _ => error,
    })?;
    sqlx::query("UPDATE benefit_code SET used_at = now() WHERE code = $1")
        .bind(code.trim())
        .execute(&mut *tx)
        .await?;
    let (employee_code, full_name): (String, Option<String>) = sqlx::query_as(
        "SELECT e.code, p.full_name FROM employee e
           LEFT JOIN employee_profile p ON p.employee_id = e.id WHERE e.id = $1",
    )
    .bind(&employee_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(BenefitHolderView {
        employee_id,
        employee_code,
        full_name,
        balance_minor: balance - amount_minor,
    })
}

/// A return gives back what the balance paid, up to what that sale spent and
/// was not already given back.
pub async fn return_benefit(
    pool: &PgPool,
    sale_ref: &str,
    amount_minor: i64,
    by: &Authorization,
) -> Result<i64, AppError> {
    if amount_minor <= 0 {
        return Err(AppError::Validation(
            "give back a positive number of rupiah".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let spent: Option<(String, String, i64)> = sqlx::query_as(
        "SELECT employee_id, unit_id, -delta_minor FROM benefit_entry
          WHERE kind = 'SPEND' AND sale_ref = $1",
    )
    .bind(sale_ref.trim())
    .fetch_optional(&mut *tx)
    .await?;
    let (employee_id, unit_id, spent) =
        spent.ok_or_else(|| AppError::NotFound(format!("sale {sale_ref} spent no benefit")))?;
    let balance = locked_balance(&mut tx, &employee_id).await?;
    let returned: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(delta_minor), 0)::bigint FROM benefit_entry
          WHERE kind = 'RETURN' AND sale_ref = $1",
    )
    .bind(sale_ref.trim())
    .fetch_one(&mut *tx)
    .await?;
    if returned + amount_minor > spent {
        return Err(AppError::Conflict(format!(
            "sale {sale_ref} spent {spent} and {returned} has come back already"
        )));
    }
    append(
        &mut tx,
        &employee_id,
        "RETURN",
        amount_minor,
        balance + amount_minor,
        by.reason().as_str(),
        Some(&unit_id),
        Some(sale_ref.trim()),
        by,
    )
    .await?;
    tx.commit().await?;
    Ok(balance + amount_minor)
}
