//! Payables › Accruals — costs booked before their bill, and the bill that
//! settles each one (migration 0719, owner 2026-10-01).
//!
//! An accrual is any posted entry that leaves a net credit on an account
//! linked to the role `accrued_expense`. It is open until it is reversed;
//! settling it reverses it, dated with the bill, and records the bill. The
//! journal is the state: nothing here can say an accrual is open while its
//! reversal sits in the ledger.

use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::poster::reverse;
use crate::cloud::application::AppError;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccrualRow {
    pub entry_id: Uuid,
    pub entry_number: String,
    pub posting_date: NaiveDate,
    pub unit_id: String,
    /// The YMHD account the cost waits on.
    pub account_code: String,
    pub account_name: String,
    /// The cost it stands for: the entry's largest debit line.
    pub expense_code: Option<String>,
    pub expense_name: Option<String>,
    pub amount_minor: i64,
    pub memo: Option<String>,
    /// `OPEN` or `SETTLED`.
    pub status: String,
    pub settled_on: Option<NaiveDate>,
    pub reversal_entry_number: Option<String>,
    pub invoice_id: Option<Uuid>,
    pub invoice_number: Option<String>,
    pub supplier_name: Option<String>,
    pub invoice_total_minor: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SettleAccrualRequest {
    /// The bill that replaces the accrual. Absent releases it without one.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub invoice_id: Option<Uuid>,
    /// The reversal's date. Defaults to the bill's posting date — the cost
    /// leaves the month the bill brings it into — or today without a bill.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub on: Option<NaiveDate>,
}

const ACCRUALS: &str = "
    WITH accrued AS (
        SELECT DISTINCT account_code FROM account_link WHERE role = 'accrued_expense'
    ),
    acc AS (
        SELECT e.entry_id, e.entry_number, e.posting_date, e.memo,
               MIN(l.unit_id) AS unit_id, MIN(l.account_code) AS account_code,
               SUM(l.credit_minor - l.debit_minor)::bigint AS amount_minor
          FROM journal_entry e
          JOIN journal_line l ON l.entry_id = e.entry_id
         WHERE l.account_code IN (SELECT account_code FROM accrued)
           AND e.source_kind <> 'REVERSAL'
         GROUP BY e.entry_id, e.entry_number, e.posting_date, e.memo
        HAVING SUM(l.credit_minor - l.debit_minor) > 0
    )
    SELECT acc.entry_id, acc.entry_number, acc.posting_date, acc.memo, acc.unit_id,
           acc.account_code, a.name AS account_name, acc.amount_minor,
           cost.account_code AS expense_code, ca.name AS expense_name,
           r.entry_number AS reversal_entry_number, r.posting_date AS settled_on,
           s.invoice_id, i.invoice_number, i.supplier_name,
           i.total_minor AS invoice_total_minor,
           CASE WHEN r.entry_id IS NULL THEN 'OPEN' ELSE 'SETTLED' END AS status
      FROM acc
      JOIN ledger_account a ON a.account_code = acc.account_code
      LEFT JOIN LATERAL (
            SELECT l2.account_code FROM journal_line l2
             WHERE l2.entry_id = acc.entry_id AND l2.debit_minor > 0
             ORDER BY l2.debit_minor DESC, l2.line_number
             LIMIT 1) cost ON TRUE
      LEFT JOIN ledger_account ca ON ca.account_code = cost.account_code
      LEFT JOIN journal_entry r ON r.reversal_of = acc.entry_id
      LEFT JOIN accrual_settlement s ON s.entry_id = acc.entry_id
      LEFT JOIN supplier_invoice i ON i.invoice_id = s.invoice_id";

fn to_row(row: &sqlx::postgres::PgRow) -> Result<AccrualRow, AppError> {
    Ok(AccrualRow {
        entry_id: row.try_get("entry_id")?,
        entry_number: row.try_get("entry_number")?,
        posting_date: row.try_get("posting_date")?,
        unit_id: row.try_get("unit_id")?,
        account_code: row.try_get("account_code")?,
        account_name: row.try_get("account_name")?,
        expense_code: row.try_get("expense_code")?,
        expense_name: row.try_get("expense_name")?,
        amount_minor: row.try_get("amount_minor")?,
        memo: row.try_get("memo")?,
        status: row.try_get("status")?,
        settled_on: row.try_get("settled_on")?,
        reversal_entry_number: row.try_get("reversal_entry_number")?,
        invoice_id: row.try_get("invoice_id")?,
        invoice_number: row.try_get("invoice_number")?,
        supplier_name: row.try_get("supplier_name")?,
        invoice_total_minor: row.try_get("invoice_total_minor")?,
    })
}

/// Every accrual, newest first. `status` narrows to `OPEN` or `SETTLED`.
pub async fn accruals(pool: &PgPool, status: Option<&str>) -> Result<Vec<AccrualRow>, AppError> {
    let status = match status {
        None | Some("") | Some("ALL") => None,
        Some(s @ ("OPEN" | "SETTLED")) => Some(s),
        Some(other) => {
            return Err(AppError::Validation(format!(
                "unknown accrual status '{other}': OPEN, SETTLED or ALL"
            )))
        }
    };
    let rows = sqlx::query(&format!(
        "SELECT * FROM ({ACCRUALS}) x
          WHERE $1::text IS NULL OR x.status = $1
          ORDER BY x.posting_date DESC, x.entry_number DESC"
    ))
    .bind(status)
    .fetch_all(pool)
    .await?;
    rows.iter().map(to_row).collect()
}

/// Settle an open accrual: reverse it and remember the bill that took its
/// place.
pub async fn settle_accrual(
    pool: &PgPool,
    entry_id: Uuid,
    request: &SettleAccrualRequest,
    actor: &str,
) -> Result<AccrualRow, AppError> {
    let mut tx = pool.begin().await?;
    // One settlement per accrual at a time; the UNIQUE on `reversal_of` would
    // refuse the second anyway, this makes it refuse in words.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('accrual:' || $1::text))")
        .bind(entry_id)
        .execute(&mut *tx)
        .await?;

    let current = sqlx::query(&format!(
        "SELECT * FROM ({ACCRUALS}) x WHERE x.entry_id = $1"
    ))
    .bind(entry_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("accrual".into()))?;
    let current = to_row(&current)?;
    if current.status != "OPEN" {
        return Err(AppError::Conflict(format!(
            "{} is already settled",
            current.entry_number
        )));
    }

    let mut on = request.on;
    if let Some(invoice_id) = request.invoice_id {
        let bill = sqlx::query(
            "SELECT i.invoice_number, i.status, i.invoice_date, e.posting_date
               FROM supplier_invoice i
               LEFT JOIN journal_entry e ON e.entry_id = i.journal_entry_id
              WHERE i.invoice_id = $1",
        )
        .bind(invoice_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("bill".into()))?;
        let status: String = bill.try_get("status")?;
        let number: String = bill.try_get("invoice_number")?;
        if status != "POSTED" {
            return Err(AppError::Conflict(format!(
                "{number} is {status}; an accrual is settled by a posted bill, \
                 or the cost would leave the books before the bill brings it back"
            )));
        }
        let taken: Option<String> = sqlx::query_scalar(
            "SELECT e.entry_number FROM accrual_settlement s
               JOIN journal_entry e ON e.entry_id = s.entry_id
              WHERE s.invoice_id = $1 LIMIT 1",
        )
        .bind(invoice_id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(other) = taken {
            return Err(AppError::Conflict(format!(
                "{number} already settles {other}; one bill replaces one accrual"
            )));
        }
        if on.is_none() {
            let posted: Option<NaiveDate> = bill.try_get("posting_date")?;
            let dated: NaiveDate = bill.try_get("invoice_date")?;
            on = Some(posted.unwrap_or(dated));
        }
    }
    let on = on.unwrap_or_else(|| Utc::now().date_naive());
    if on < current.posting_date {
        return Err(AppError::Validation(format!(
            "an accrual cannot be settled before it was made ({})",
            current.posting_date
        )));
    }

    let reason = match request.invoice_id {
        Some(_) => "accrual settled by its bill",
        None => "accrual released without a bill",
    };
    let reversal = reverse(&mut tx, entry_id, on, reason, actor).await?;
    sqlx::query(
        "INSERT INTO accrual_settlement (entry_id, reversal_entry_id, invoice_id, settled_by)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(entry_id)
    .bind(reversal.entry_id)
    .bind(request.invoice_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    let row = sqlx::query(&format!(
        "SELECT * FROM ({ACCRUALS}) x WHERE x.entry_id = $1"
    ))
    .bind(entry_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    to_row(&row)
}
