//! Period Closing Voucher — ERPNext's, for this estate (owner decision 27 Sep
//! 2026; replaces hard rule I10).
//!
//! Closing a month only locks it. Moving a period's profit into retained
//! earnings is this document: for a date range that starts the day after the
//! last voucher ended, every profit-and-loss account's balance in every unit's
//! books is reversed to zero and the difference lands on the role
//! `retained_earnings` (3003) in the same unit's books. Each unit's lines
//! balance on their own, so the balancer adds nothing. Run it once a year and
//! it is what the client's 7Soft does (C001's Laba Ditahan is C001's); run it
//! per month or quarter and it is what current ERPNext allows.
//!
//! Per unit, not per site (0605): head office closes one set of books however
//! many premises it keeps.

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::poster::{post, reverse, LineAccount, PostingIntent, PostingLine};
use crate::cloud::application::AppError;

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PeriodClosingRequest {
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub remarks: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PeriodClosingVoucher {
    pub voucher_id: Uuid,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    /// `POSTED` or `CANCELLED`.
    pub status: String,
    /// Absent when the range had no profit or loss to move.
    pub entry_id: Option<Uuid>,
    pub reversal_entry_id: Option<Uuid>,
    /// What moved into retained earnings over every unit: a profit is
    /// positive, a loss negative.
    pub profit_minor: i64,
    pub remarks: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub cancelled_by: Option<String>,
    pub cancelled_at: Option<DateTime<Utc>>,
}

const VOUCHER_COLUMNS: &str = "voucher_id, period_start, period_end, status, entry_id,
     reversal_entry_id, profit_minor, remarks, created_by, created_at, cancelled_by, cancelled_at";

fn to_voucher(row: &sqlx::postgres::PgRow) -> Result<PeriodClosingVoucher, AppError> {
    Ok(PeriodClosingVoucher {
        voucher_id: row.try_get("voucher_id")?,
        period_start: row.try_get("period_start")?,
        period_end: row.try_get("period_end")?,
        status: row.try_get("status")?,
        entry_id: row.try_get("entry_id")?,
        reversal_entry_id: row.try_get("reversal_entry_id")?,
        profit_minor: row.try_get("profit_minor")?,
        remarks: row.try_get("remarks")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        cancelled_by: row.try_get("cancelled_by")?,
        cancelled_at: row.try_get("cancelled_at")?,
    })
}

/// Close a date range into retained earnings.
///
/// The range must start the day after the last live voucher ended. With no
/// voucher yet it may start anywhere, provided nothing earlier is left open:
/// a profit posted before the first voucher's start would never be closed.
pub async fn post_period_closing(
    pool: &PgPool,
    request: &PeriodClosingRequest,
    actor: &str,
) -> Result<PeriodClosingVoucher, AppError> {
    let (start, end) = (request.period_start, request.period_end);
    if end < start {
        return Err(AppError::Validation(format!(
            "the period ends ({end}) before it starts ({start})"
        )));
    }
    let mut tx = pool.begin().await?;
    // One voucher at a time: the "follows the last one" rule reads the last one.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('period_closing_voucher'))")
        .execute(&mut *tx)
        .await?;

    let last_end: Option<NaiveDate> = sqlx::query_scalar(
        "SELECT MAX(period_end) FROM period_closing_voucher WHERE status = 'POSTED'",
    )
    .fetch_one(&mut *tx)
    .await?;
    match last_end {
        Some(last) if start != last + Duration::days(1) => {
            return Err(AppError::Conflict(format!(
                "the books are closed up to {last}; the next closing voucher starts on {}",
                last + Duration::days(1)
            )));
        }
        Some(_) => {}
        None => {
            let earlier: Option<NaiveDate> = sqlx::query_scalar(
                "SELECT MIN(e.posting_date)
                   FROM journal_line l
                   JOIN journal_entry e ON e.entry_id = l.entry_id
                   JOIN ledger_account a ON a.account_code = l.account_code
                  WHERE a.root_type IN ('INCOME', 'EXPENSE')
                    AND e.posting_date < $1",
            )
            .bind(start)
            .fetch_one(&mut *tx)
            .await?;
            if let Some(first) = earlier {
                return Err(AppError::Conflict(format!(
                    "profit and loss was posted from {first}, before this voucher starts; \
                     the first closing voucher has to start on or before {first}"
                )));
            }
        }
    }

    // Every profit-and-loss balance over the range, per unit, account and
    // category, leaving out what earlier vouchers (and their cancellations)
    // already moved.
    let balances = sqlx::query(
        "SELECT l.unit_id, l.account_code, l.category_code,
                SUM(l.debit_minor - l.credit_minor)::bigint AS balance
           FROM journal_line l
           JOIN journal_entry e ON e.entry_id = l.entry_id
           JOIN ledger_account a ON a.account_code = l.account_code
          WHERE a.root_type IN ('INCOME', 'EXPENSE')
            AND e.posting_date BETWEEN $1 AND $2
            AND NOT journal_entry_closes_books(e.source_kind, e.reversal_of)
          GROUP BY l.unit_id, l.account_code, l.category_code
         HAVING SUM(l.debit_minor - l.credit_minor) <> 0
          ORDER BY l.unit_id, l.account_code, l.category_code",
    )
    .bind(start)
    .bind(end)
    .fetch_all(&mut *tx)
    .await?;

    let voucher_id = Uuid::new_v4();
    let mut lines = Vec::new();
    let mut per_unit: Vec<(String, i64)> = Vec::new();
    for row in &balances {
        let unit: String = row.try_get("unit_id")?;
        let balance: i64 = row.try_get("balance")?;
        let account = LineAccount::Account {
            account_code: row.try_get("account_code")?,
            category_code: row.try_get("category_code")?,
        };
        lines.push(if balance > 0 {
            PostingLine::credit(account, &unit, balance)
        } else {
            PostingLine::debit(account, &unit, -balance)
        });
        match per_unit.iter_mut().find(|(id, _)| *id == unit) {
            Some((_, net)) => *net += balance,
            None => per_unit.push((unit, balance)),
        }
    }
    // A unit's P&L nets to a debit when it lost money: retained earnings takes
    // the debit. A credit net is a profit, credited to retained earnings.
    let mut profit = 0i64;
    for (unit, net) in &per_unit {
        profit -= net;
        match net.signum() {
            1 => lines.push(PostingLine::debit("retained_earnings", unit, *net)),
            -1 => lines.push(PostingLine::credit("retained_earnings", unit, -net)),
            _ => {}
        }
    }

    let entry_id = if lines.is_empty() {
        None
    } else {
        let intent = PostingIntent {
            posting_date: end,
            source_kind: "PERIOD_CLOSING".into(),
            source_id: Some(voucher_id.to_string()),
            rule_version: "period_closing/1".into(),
            currency: "IDR".into(),
            memo: Some(format!("Period closing {start} – {end}")),
            lines,
        };
        Some(post(&mut tx, &intent, None, actor).await?.entry_id)
    };

    let row = sqlx::query(&format!(
        "INSERT INTO period_closing_voucher
            (voucher_id, period_start, period_end, entry_id, profit_minor, remarks, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING {VOUCHER_COLUMNS}"
    ))
    .bind(voucher_id)
    .bind(start)
    .bind(end)
    .bind(entry_id)
    .bind(profit)
    .bind(
        request
            .remarks
            .as_deref()
            .map(str::trim)
            .filter(|text| !text.is_empty()),
    )
    .bind(actor)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    to_voucher(&row)
}

/// Cancel the LAST live voucher, by reversing its entry on the same date.
/// An earlier one is refused: the vouchers after it were computed on top of it.
pub async fn cancel_period_closing(
    pool: &PgPool,
    voucher_id: Uuid,
    actor: &str,
) -> Result<PeriodClosingVoucher, AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('period_closing_voucher'))")
        .execute(&mut *tx)
        .await?;
    let row = sqlx::query(&format!(
        "SELECT {VOUCHER_COLUMNS} FROM period_closing_voucher WHERE voucher_id = $1"
    ))
    .bind(voucher_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("closing voucher {voucher_id}")))?;
    let voucher = to_voucher(&row)?;
    if voucher.status != "POSTED" {
        return Err(AppError::Conflict(
            "this closing voucher is already cancelled".into(),
        ));
    }
    let later: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM period_closing_voucher
          WHERE status = 'POSTED' AND period_start > $1",
    )
    .bind(voucher.period_end)
    .fetch_one(&mut *tx)
    .await?;
    if later > 0 {
        return Err(AppError::Conflict(
            "a later closing voucher was built on this one; cancel the later one first".into(),
        ));
    }
    let reversal = match voucher.entry_id {
        Some(entry) => Some(
            reverse(
                &mut tx,
                entry,
                voucher.period_end,
                "closing voucher cancelled",
                actor,
            )
            .await?
            .entry_id,
        ),
        None => None,
    };
    let row = sqlx::query(&format!(
        "UPDATE period_closing_voucher
            SET status = 'CANCELLED', reversal_entry_id = $2, cancelled_by = $3,
                cancelled_at = now()
          WHERE voucher_id = $1
         RETURNING {VOUCHER_COLUMNS}"
    ))
    .bind(voucher_id)
    .bind(reversal)
    .bind(actor)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    to_voucher(&row)
}

/// Every voucher, newest period first.
pub async fn period_closings(pool: &PgPool) -> Result<Vec<PeriodClosingVoucher>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {VOUCHER_COLUMNS} FROM period_closing_voucher
          ORDER BY period_end DESC, created_at DESC"
    ))
    .fetch_all(pool)
    .await?;
    rows.iter().map(to_voucher).collect()
}
