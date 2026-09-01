//! Reading the journal: the register, one entry, and an account's ledger.
//!
//! Writing lives in `poster.rs`. Everything here is a projection — there is no
//! stored balance anywhere in this file, including the running balance in the
//! general ledger, which is a window function over the lines rather than a
//! column somebody maintains.

use crate::cloud::application::AppError;
use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JournalEntryRow {
    pub entry_id: Uuid,
    pub entry_number: String,
    pub posting_date: NaiveDate,
    pub source_kind: String,
    pub source_id: Option<String>,
    pub total_minor: i64,
    pub currency: String,
    pub memo: Option<String>,
    pub posted_by: String,
    pub posted_at: DateTime<Utc>,
    /// Set when this entry undoes another. The screen shows it as a link rather
    /// than as a status, because both entries remain real.
    pub reversal_of: Option<Uuid>,
    /// Set when this entry has itself been reversed. Derived, not stored.
    pub reversed_by: Option<Uuid>,
    pub line_count: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JournalLineView {
    pub line_number: i32,
    pub account_code: String,
    /// The client's own name, never translated.
    pub account_name: String,
    pub site_id: String,
    pub debit_minor: i64,
    pub credit_minor: i64,
    pub supplier_id: Option<String>,
    pub memo: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JournalEntryDetail {
    /// A named field rather than `#[serde(flatten)]`: ts-rs does not render a
    /// flattened struct faithfully, and a wire type the generator cannot
    /// describe is exactly the hand-mirroring this whole contract exists to
    /// avoid.
    pub entry: JournalEntryRow,
    pub lines: Vec<JournalLineView>,
}

/// One movement in an account's own ledger.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GeneralLedgerRow {
    pub entry_id: Uuid,
    pub entry_number: String,
    pub posting_date: NaiveDate,
    pub source_kind: String,
    pub source_id: Option<String>,
    pub site_id: String,
    pub memo: Option<String>,
    pub debit_minor: i64,
    pub credit_minor: i64,
    /// The balance after this line. Computed by a window function on every
    /// read, so it cannot disagree with the lines above it.
    pub running_minor: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GeneralLedger {
    pub account_code: String,
    pub account_name: String,
    pub site_id: Option<String>,
    pub from: NaiveDate,
    pub to: NaiveDate,
    /// What the account held the day before `from`. Without it the first
    /// running figure would be a movement pretending to be a balance.
    pub opening_minor: i64,
    pub closing_minor: i64,
    pub rows: Vec<GeneralLedgerRow>,
}

const ENTRY_COLUMNS: &str =
    "e.entry_id, e.entry_number, e.posting_date, e.source_kind, e.source_id,
     e.total_minor, e.currency, e.memo, e.posted_by, e.posted_at, e.reversal_of,
     (SELECT r.entry_id FROM journal_entry r WHERE r.reversal_of = e.entry_id) AS reversed_by,
     (SELECT COUNT(*) FROM journal_line l WHERE l.entry_id = e.entry_id)::bigint AS line_count";

fn to_entry(row: &sqlx::postgres::PgRow) -> Result<JournalEntryRow, AppError> {
    Ok(JournalEntryRow {
        entry_id: row.try_get("entry_id")?,
        entry_number: row.try_get("entry_number")?,
        posting_date: row.try_get("posting_date")?,
        source_kind: row.try_get("source_kind")?,
        source_id: row.try_get("source_id")?,
        total_minor: row.try_get("total_minor")?,
        currency: row.try_get("currency")?,
        memo: row.try_get("memo")?,
        posted_by: row.try_get("posted_by")?,
        posted_at: row.try_get("posted_at")?,
        reversal_of: row.try_get("reversal_of")?,
        reversed_by: row.try_get("reversed_by")?,
        line_count: row.try_get("line_count")?,
    })
}

pub async fn journal_register(
    pool: &PgPool,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    source_kind: Option<&str>,
    limit: i64,
) -> Result<Vec<JournalEntryRow>, AppError> {
    let sql = format!(
        "SELECT {ENTRY_COLUMNS} FROM journal_entry e
          WHERE ($1::date IS NULL OR e.posting_date >= $1)
            AND ($2::date IS NULL OR e.posting_date <= $2)
            AND ($3::text IS NULL OR e.source_kind = $3)
          ORDER BY e.posting_date DESC, e.entry_number DESC
          LIMIT $4"
    );
    let rows = sqlx::query(&sql)
        .bind(from)
        .bind(to)
        .bind(source_kind)
        .bind(limit.clamp(1, 1000))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_entry).collect()
}

pub async fn journal_entry(pool: &PgPool, entry_id: Uuid) -> Result<JournalEntryDetail, AppError> {
    let sql = format!("SELECT {ENTRY_COLUMNS} FROM journal_entry e WHERE e.entry_id = $1");
    let row = sqlx::query(&sql)
        .bind(entry_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("journal entry".into()))?;
    let entry = to_entry(&row)?;

    let lines = sqlx::query(
        "SELECT l.line_number, l.account_code, a.name AS account_name, l.site_id,
                l.debit_minor, l.credit_minor, l.supplier_id, l.memo
           FROM journal_line l JOIN ledger_account a ON a.account_code = l.account_code
          WHERE l.entry_id = $1 ORDER BY l.line_number",
    )
    .bind(entry_id)
    .fetch_all(pool)
    .await?;

    Ok(JournalEntryDetail {
        entry,
        lines: lines
            .iter()
            .map(|row| {
                Ok(JournalLineView {
                    line_number: row.try_get("line_number")?,
                    account_code: row.try_get("account_code")?,
                    account_name: row.try_get("account_name")?,
                    site_id: row.try_get("site_id")?,
                    debit_minor: row.try_get("debit_minor")?,
                    credit_minor: row.try_get("credit_minor")?,
                    supplier_id: row.try_get("supplier_id")?,
                    memo: row.try_get("memo")?,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?,
    })
}

/// One account's movements over a window, with the balance walking down it.
///
/// The account code is matched by prefix, so asking for a heading gives the
/// whole subtree — which is how somebody reads "what happened in CASH this
/// month" without knowing that cash is fourteen separate leaves.
pub async fn general_ledger(
    pool: &PgPool,
    account_code: &str,
    site_id: Option<&str>,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<GeneralLedger, AppError> {
    let name: String = sqlx::query("SELECT name FROM ledger_account WHERE account_code = $1")
        .bind(account_code)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("account {account_code}")))?
        .try_get("name")?;

    let opening: i64 = sqlx::query(
        "SELECT COALESCE(SUM(l.debit_minor - l.credit_minor),0)::bigint AS opening
           FROM journal_line l JOIN journal_entry e USING (entry_id)
          WHERE l.account_code LIKE $1 || '%'
            AND ($2::text IS NULL OR l.site_id = $2)
            AND e.posting_date < $3",
    )
    .bind(account_code)
    .bind(site_id)
    .bind(from)
    .fetch_one(pool)
    .await?
    .try_get("opening")?;

    let rows = sqlx::query(
        "SELECT e.entry_id, e.entry_number, e.posting_date, e.source_kind, e.source_id,
                l.site_id, COALESCE(l.memo, e.memo) AS memo,
                l.debit_minor, l.credit_minor,
                ($4::bigint + SUM(l.debit_minor - l.credit_minor)
                    OVER (ORDER BY e.posting_date, e.entry_number, l.line_number
                          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))::bigint AS running
           FROM journal_line l JOIN journal_entry e USING (entry_id)
          WHERE l.account_code LIKE $1 || '%'
            AND ($2::text IS NULL OR l.site_id = $2)
            AND e.posting_date >= $3 AND e.posting_date <= $5
          ORDER BY e.posting_date, e.entry_number, l.line_number",
    )
    .bind(account_code)
    .bind(site_id)
    .bind(from)
    .bind(opening)
    .bind(to)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    let mut closing = opening;
    for row in &rows {
        let running: i64 = row.try_get("running")?;
        closing = running;
        out.push(GeneralLedgerRow {
            entry_id: row.try_get("entry_id")?,
            entry_number: row.try_get("entry_number")?,
            posting_date: row.try_get("posting_date")?,
            source_kind: row.try_get("source_kind")?,
            source_id: row.try_get("source_id")?,
            site_id: row.try_get("site_id")?,
            memo: row.try_get("memo")?,
            debit_minor: row.try_get("debit_minor")?,
            credit_minor: row.try_get("credit_minor")?,
            running_minor: running,
        });
    }

    Ok(GeneralLedger {
        account_code: account_code.to_string(),
        account_name: name,
        site_id: site_id.map(str::to_string),
        from,
        to,
        opening_minor: opening,
        closing_minor: closing,
        rows: out,
    })
}
