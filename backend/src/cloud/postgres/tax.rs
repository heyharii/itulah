//! Tax, by type and by period.
//!
//! # The distinction this module exists to hold
//!
//! `1011302002 Prepaid - PPh Pasal 25` and `2012101006 Hutang Pajak PPh Pasal 29`
//! are the same tax and opposite balances: one is money already handed to the
//! state, the other is money still owed. Netting them because the names look
//! alike is the mistake this module is built to make impossible — `nature` is a
//! property of the TYPE, a type is either a credit or a payable, and nothing
//! here ever adds one to the other.
//!
//! # What records and what posts
//!
//! An obligation is recognised by the document that caused it and has already
//! reached the ledger by the time this module hears about it: output VAT by the
//! day's takings, PPh 21 by the payroll run, PPh 23 by the supplier payment. So
//! recording one writes a SUBLEDGER row and no journal — the alternative is two
//! writers for one economic event.
//!
//! The one thing this module posts itself is a settlement: money to the
//! authority, or a credit bought with money.
//!
//!   PAYABLE   Dr <the payable>  Cr <bank>     the debt is discharged
//!   CREDIT    Dr <the credit>   Cr <bank>     the credit is acquired
//!
//! Both are `source_kind = 'TAX_SETTLEMENT'`, which 0266 added for exactly
//! this: `PAYMENT` can pay a tax but cannot express an obligation moving BY
//! PERIOD.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::poster::{post, PostingIntent, PostingLine};
use crate::cloud::application::AppError;

const SOURCE_KIND: &str = "TAX_SETTLEMENT";
const RULE_VERSION: &str = "tax_settlement/1";

// ---------------------------------------------------------------------------
// What a screen is told
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TaxType {
    pub code: String,
    pub name: String,
    /// `PAYABLE` or `CREDIT`. Never both, and never inferred from the name.
    pub nature: String,
    pub semantic_key: String,
    pub authority: String,
    pub active: bool,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TaxPeriod {
    pub period_id: Uuid,
    pub tax_type_code: String,
    pub tax_type_name: String,
    pub nature: String,
    pub period_year: i32,
    pub period_month: i32,
    pub status: String,
    pub due_date: Option<NaiveDate>,
    pub filed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub filed_by: Option<String>,
    pub filed_reference: Option<String>,
    /// What the period has gathered. Kept apart, always.
    pub obligation_minor: i64,
    pub credit_minor: i64,
    pub settled_minor: i64,
    /// What is still to pay (a payable) or still to claim (a credit).
    pub outstanding_minor: i64,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TaxLedgerItem {
    pub item_id: Uuid,
    pub site_id: String,
    pub kind: String,
    pub amount_minor: i64,
    pub source_kind: String,
    pub source_id: String,
    pub entry_id: Option<Uuid>,
    pub entry_number: Option<String>,
    pub evidence: Option<String>,
    pub note: Option<String>,
    pub created_by: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TaxPeriodDocument {
    pub period: TaxPeriod,
    pub items: Vec<TaxLedgerItem>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordTaxItemRequest {
    pub tax_type_code: String,
    pub year: i32,
    pub month: u32,
    pub site_id: String,
    /// `OBLIGATION` or `CREDIT`. A settlement is made by paying, not by saying.
    pub kind: String,
    pub amount_minor: i64,
    pub source_kind: String,
    pub source_id: String,
    #[serde(default)]
    pub evidence: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SettleTaxRequest {
    pub tax_type_code: String,
    pub year: i32,
    pub month: u32,
    pub site_id: String,
    pub amount_minor: i64,
    pub posting_date: NaiveDate,
    /// Which of our bank meanings paid it, and at which bank.
    pub bank_key: String,
    #[serde(default)]
    pub bank_qualifier: String,
    #[serde(default)]
    pub evidence: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FileTaxPeriodRequest {
    pub tax_type_code: String,
    pub year: i32,
    pub month: u32,
    pub reference: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TaxReconciliationRow {
    pub tax_type_code: String,
    pub tax_type_name: String,
    pub nature: String,
    pub period_year: i32,
    pub period_month: i32,
    pub status: String,
    /// What the subledger says the period comes to.
    pub subledger_minor: i64,
    /// What the ledger holds on the account the type is mapped to.
    pub gl_minor: i64,
    pub difference_minor: i64,
    pub account_code: Option<String>,
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

pub async fn tax_types(pool: &PgPool) -> Result<Vec<TaxType>, AppError> {
    let rows = sqlx::query(
        "SELECT code, name, nature, semantic_key, authority, active, note
           FROM tax_type ORDER BY code",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(TaxType {
                code: row.try_get("code")?,
                name: row.try_get("name")?,
                nature: row.try_get("nature")?,
                semantic_key: row.try_get("semantic_key")?,
                authority: row.try_get("authority")?,
                active: row.try_get("active")?,
                note: row.try_get("note")?,
            })
        })
        .collect()
}

const PERIOD_COLUMNS: &str = "p.period_id, p.tax_type_code, t.name AS tax_type_name,
     t.nature, p.period_year, p.period_month, p.status, p.due_date, p.filed_at,
     p.filed_by, p.filed_reference, p.note,
     COALESCE(i.obligation_minor, 0)::bigint AS obligation_minor,
     COALESCE(i.credit_minor, 0)::bigint     AS credit_minor,
     COALESCE(i.settled_minor, 0)::bigint    AS settled_minor";

const PERIOD_FROM: &str = "FROM tax_period p
       JOIN tax_type t ON t.code = p.tax_type_code
       LEFT JOIN (
            SELECT period_id,
                   SUM(amount_minor) FILTER (WHERE kind = 'OBLIGATION') AS obligation_minor,
                   SUM(amount_minor) FILTER (WHERE kind = 'CREDIT')     AS credit_minor,
                   SUM(amount_minor) FILTER (WHERE kind = 'SETTLEMENT') AS settled_minor
              FROM tax_ledger_item GROUP BY period_id
       ) i ON i.period_id = p.period_id";

fn to_period(row: &sqlx::postgres::PgRow) -> Result<TaxPeriod, AppError> {
    let nature: String = row.try_get("nature")?;
    let obligation: i64 = row.try_get("obligation_minor")?;
    let credit: i64 = row.try_get("credit_minor")?;
    let settled: i64 = row.try_get("settled_minor")?;
    // A payable is discharged by settling it; a credit is ACQUIRED by settling
    // it. The two are never added together — see the module note.
    let outstanding = if nature == "CREDIT" {
        credit - settled
    } else {
        obligation - settled
    };
    Ok(TaxPeriod {
        period_id: row.try_get("period_id")?,
        tax_type_code: row.try_get("tax_type_code")?,
        tax_type_name: row.try_get("tax_type_name")?,
        nature,
        period_year: i32::from(row.try_get::<i16, _>("period_year")?),
        period_month: i32::from(row.try_get::<i16, _>("period_month")?),
        status: row.try_get("status")?,
        due_date: row.try_get("due_date")?,
        filed_at: row.try_get("filed_at")?,
        filed_by: row.try_get("filed_by")?,
        filed_reference: row.try_get("filed_reference")?,
        obligation_minor: obligation,
        credit_minor: credit,
        settled_minor: settled,
        outstanding_minor: outstanding,
        note: row.try_get("note")?,
    })
}

pub async fn tax_periods(
    pool: &PgPool,
    tax_type_code: Option<&str>,
    year: Option<i32>,
    limit: i64,
) -> Result<Vec<TaxPeriod>, AppError> {
    let sql = format!(
        "SELECT {PERIOD_COLUMNS} {PERIOD_FROM}
          WHERE ($1::text IS NULL OR p.tax_type_code = $1)
            AND ($2::int IS NULL OR p.period_year = $2::int)
          ORDER BY p.period_year DESC, p.period_month DESC, p.tax_type_code
          LIMIT $3"
    );
    let rows = sqlx::query(&sql)
        .bind(tax_type_code)
        .bind(year)
        .bind(limit.clamp(1, 500))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_period).collect()
}

pub async fn tax_period_detail(
    pool: &PgPool,
    period_id: Uuid,
) -> Result<TaxPeriodDocument, AppError> {
    let sql = format!("SELECT {PERIOD_COLUMNS} {PERIOD_FROM} WHERE p.period_id = $1");
    let row = sqlx::query(&sql)
        .bind(period_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("tax period {period_id}")))?;
    let period = to_period(&row)?;

    let rows = sqlx::query(
        "SELECT i.item_id, i.site_id, i.kind, i.amount_minor, i.source_kind, i.source_id,
                i.entry_id, e.entry_number, i.evidence, i.note, i.created_by, i.created_at
           FROM tax_ledger_item i
           LEFT JOIN journal_entry e ON e.entry_id = i.entry_id
          WHERE i.period_id = $1
          ORDER BY i.created_at",
    )
    .bind(period_id)
    .fetch_all(pool)
    .await?;
    let items = rows
        .iter()
        .map(|row| {
            Ok(TaxLedgerItem {
                item_id: row.try_get("item_id")?,
                site_id: row.try_get("site_id")?,
                kind: row.try_get("kind")?,
                amount_minor: row.try_get("amount_minor")?,
                source_kind: row.try_get("source_kind")?,
                source_id: row.try_get("source_id")?,
                entry_id: row.try_get("entry_id")?,
                entry_number: row.try_get("entry_number")?,
                evidence: row.try_get("evidence")?,
                note: row.try_get("note")?,
                created_by: row.try_get("created_by")?,
                created_at: row.try_get("created_at")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    Ok(TaxPeriodDocument { period, items })
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/// The period row, made if this is the first thing that belongs to it.
async fn period_for(
    executor: impl sqlx::PgExecutor<'_> + Copy,
    tax_type_code: &str,
    year: i32,
    month: u32,
) -> Result<Uuid, AppError> {
    let year16 =
        i16::try_from(year).map_err(|_| AppError::Validation(format!("{year} is not a year")))?;
    let month16 = i16::try_from(month)
        .map_err(|_| AppError::Validation(format!("{month} is not a month")))?;
    if !(1..=12).contains(&month16) {
        return Err(AppError::Validation(format!("{month} is not a month")));
    }
    let existing: Option<Uuid> = sqlx::query_scalar(
        "SELECT period_id FROM tax_period
          WHERE tax_type_code = $1 AND period_year = $2 AND period_month = $3",
    )
    .bind(tax_type_code)
    .bind(year16)
    .bind(month16)
    .fetch_optional(executor)
    .await?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let period_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO tax_period (period_id, tax_type_code, period_year, period_month)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (tax_type_code, period_year, period_month) DO NOTHING",
    )
    .bind(period_id)
    .bind(tax_type_code)
    .bind(year16)
    .bind(month16)
    .execute(executor)
    .await?;
    let id: Uuid = sqlx::query_scalar(
        "SELECT period_id FROM tax_period
          WHERE tax_type_code = $1 AND period_year = $2 AND period_month = $3",
    )
    .bind(tax_type_code)
    .bind(year16)
    .bind(month16)
    .fetch_one(executor)
    .await?;
    Ok(id)
}

/// Record what a document already posted, against the period it belongs to.
///
/// Idempotent on `(period, kind, source_kind, source_id)`: a payroll run or a
/// day's takings can be replayed into the subledger and will not double it.
pub async fn tax_item_record(
    pool: &PgPool,
    request: &RecordTaxItemRequest,
    actor: &str,
) -> Result<TaxPeriodDocument, AppError> {
    if request.kind != "OBLIGATION" && request.kind != "CREDIT" {
        return Err(AppError::Validation(
            "a recorded item is an OBLIGATION or a CREDIT; a settlement is made by paying".into(),
        ));
    }
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "a tax item is a positive amount".into(),
        ));
    }
    let nature: Option<String> = sqlx::query_scalar("SELECT nature FROM tax_type WHERE code = $1")
        .bind(&request.tax_type_code)
        .fetch_optional(pool)
        .await?;
    let nature = nature
        .ok_or_else(|| AppError::Validation(format!("no tax type {}", request.tax_type_code)))?;
    // A credit type cannot owe and a payable type cannot be held as a credit.
    // This is the netting guard, and it lives here rather than in a report.
    if nature == "CREDIT" && request.kind == "OBLIGATION" {
        return Err(AppError::Validation(format!(
            "{} is a tax CREDIT — money already paid that may be set off. An obligation \
             against it would net an asset against a liability, which is the one thing \
             this subledger exists to prevent.",
            request.tax_type_code
        )));
    }
    if nature == "PAYABLE" && request.kind == "CREDIT" {
        return Err(AppError::Validation(format!(
            "{} is a tax PAYABLE; a credit belongs to the type that holds it \
             (PPh 25, PPN Masukan)",
            request.tax_type_code
        )));
    }

    let period_id = period_for(pool, &request.tax_type_code, request.year, request.month).await?;
    let entry_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT entry_id FROM journal_entry
          WHERE source_kind = $1 AND source_id = $2 ORDER BY posted_at LIMIT 1",
    )
    .bind(request.source_kind.trim())
    .bind(request.source_id.trim())
    .fetch_optional(pool)
    .await?;

    sqlx::query(
        "INSERT INTO tax_ledger_item
           (item_id, period_id, site_id, kind, amount_minor, source_kind, source_id,
            entry_id, evidence, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (period_id, kind, source_kind, source_id) DO NOTHING",
    )
    .bind(Uuid::new_v4())
    .bind(period_id)
    .bind(&request.site_id)
    .bind(&request.kind)
    .bind(request.amount_minor)
    .bind(request.source_kind.trim())
    .bind(request.source_id.trim())
    .bind(entry_id)
    .bind(request.evidence.as_deref())
    .bind(request.note.as_deref())
    .bind(actor)
    .execute(pool)
    .await?;

    tax_period_detail(pool, period_id).await
}

/// Pay a tax, or buy a credit. The one posting this module makes.
pub async fn tax_settle(
    pool: &PgPool,
    request: &SettleTaxRequest,
    actor: &str,
) -> Result<TaxPeriodDocument, AppError> {
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "a settlement is a positive amount".into(),
        ));
    }
    let row = sqlx::query("SELECT nature, semantic_key, name FROM tax_type WHERE code = $1")
        .bind(&request.tax_type_code)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Validation(format!("no tax type {}", request.tax_type_code)))?;
    let semantic_key: String = row.try_get("semantic_key")?;
    let name: String = row.try_get("name")?;

    let period_id = period_for(pool, &request.tax_type_code, request.year, request.month).await?;
    let settlement_id = Uuid::new_v4();

    let mut tx = pool.begin().await?;
    // Both natures debit their own account and credit the bank: a payable is
    // discharged, a credit is acquired. Same shape, opposite meaning, and the
    // account the meaning resolves to is what keeps them apart.
    let intent = PostingIntent {
        posting_date: request.posting_date,
        source_kind: SOURCE_KIND.into(),
        source_id: Some(period_id.to_string()),
        rule_version: RULE_VERSION.into(),
        currency: "IDR".into(),
        memo: Some(format!("{name} {}-{:02}", request.year, request.month)),
        lines: vec![
            PostingLine::debit(&semantic_key, &request.site_id, request.amount_minor),
            PostingLine::credit(&request.bank_key, &request.site_id, request.amount_minor)
                .with_qualifier(&request.bank_qualifier),
        ],
    };
    let purpose = format!("S{}", &settlement_id.to_string()[..8].to_uppercase());
    let posted = post(&mut tx, &intent, Some(&purpose), actor).await?;
    sqlx::query(
        "INSERT INTO tax_ledger_item
           (item_id, period_id, site_id, kind, amount_minor, source_kind, source_id,
            entry_id, evidence, created_by)
         VALUES ($1,$2,$3,'SETTLEMENT',$4,$5,$6,$7,$8,$9)",
    )
    .bind(settlement_id)
    .bind(period_id)
    .bind(&request.site_id)
    .bind(request.amount_minor)
    .bind(SOURCE_KIND)
    .bind(settlement_id.to_string())
    .bind(posted.entry_id)
    .bind(request.evidence.as_deref())
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    // A period with nothing left owing is settled. A credit period is settled
    // when the credit has been bought.
    sqlx::query(
        "UPDATE tax_period p
            SET status = 'SETTLED'
          FROM tax_type t
          WHERE p.period_id = $1 AND t.code = p.tax_type_code AND p.status <> 'SETTLED'
            AND (SELECT COALESCE(SUM(i.amount_minor) FILTER (WHERE i.kind = 'SETTLEMENT'), 0)
                   FROM tax_ledger_item i WHERE i.period_id = p.period_id)
                >= (SELECT COALESCE(SUM(i.amount_minor)
                                    FILTER (WHERE i.kind = CASE WHEN t.nature = 'CREDIT'
                                                                THEN 'CREDIT' ELSE 'OBLIGATION' END), 0)
                      FROM tax_ledger_item i WHERE i.period_id = p.period_id)
            AND (SELECT COUNT(*) FROM tax_ledger_item i
                  WHERE i.period_id = p.period_id AND i.kind <> 'SETTLEMENT') > 0",
    )
    .bind(period_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    tax_period_detail(pool, period_id).await
}

/// The return went in. Filing does not move money; it fixes what the period is.
pub async fn tax_period_file(
    pool: &PgPool,
    request: &FileTaxPeriodRequest,
    actor: &str,
) -> Result<TaxPeriodDocument, AppError> {
    if request.reference.trim().is_empty() {
        return Err(AppError::Validation(
            "a filed return has a reference; it is what the authority will ask for".into(),
        ));
    }
    let period_id = period_for(pool, &request.tax_type_code, request.year, request.month).await?;
    sqlx::query(
        "UPDATE tax_period
            SET status = 'FILED', filed_at = now(), filed_by = $2, filed_reference = $3
          WHERE period_id = $1 AND status = 'OPEN'",
    )
    .bind(period_id)
    .bind(actor)
    .bind(request.reference.trim())
    .execute(pool)
    .await?;
    tax_period_detail(pool, period_id).await
}

// ---------------------------------------------------------------------------
// The control accounts
// ---------------------------------------------------------------------------

/// Each period against the ledger balance of the account its type is mapped to.
///
/// Credits and payables are reported side by side and never summed: the row
/// carries `nature`, and a reader who adds them across natures is adding an
/// asset to a liability.
pub async fn tax_reconciliation(
    pool: &PgPool,
    year: Option<i32>,
) -> Result<Vec<TaxReconciliationRow>, AppError> {
    let rows = sqlx::query(
        "WITH account AS (
             SELECT t.code, MIN(m.account_code) AS account_code
               FROM tax_type t
               LEFT JOIN account_resolution m ON m.role = t.semantic_key
              GROUP BY t.code
         ), gl AS (
             SELECT a.code, SUM(l.debit_minor - l.credit_minor)::bigint AS gl_minor
               FROM account a
               JOIN journal_line l ON l.account_code = a.account_code
              GROUP BY a.code
         )
         SELECT p.tax_type_code, t.name AS tax_type_name, t.nature,
                p.period_year, p.period_month, p.status,
                account.account_code,
                COALESCE(gl.gl_minor, 0)::bigint AS gl_minor,
                COALESCE(SUM(i.amount_minor) FILTER (
                    WHERE i.kind = CASE WHEN t.nature = 'CREDIT' THEN 'CREDIT' ELSE 'OBLIGATION' END
                ), 0)::bigint
                - COALESCE(SUM(i.amount_minor) FILTER (WHERE i.kind = 'SETTLEMENT'), 0)::bigint
                    AS subledger_minor
           FROM tax_period p
           JOIN tax_type t ON t.code = p.tax_type_code
           LEFT JOIN tax_ledger_item i ON i.period_id = p.period_id
           LEFT JOIN account ON account.code = p.tax_type_code
           LEFT JOIN gl ON gl.code = p.tax_type_code
          WHERE ($1::int IS NULL OR p.period_year = $1::int)
          GROUP BY p.tax_type_code, t.name, t.nature, p.period_year, p.period_month,
                   p.status, account.account_code, gl.gl_minor
          ORDER BY p.period_year DESC, p.period_month DESC, p.tax_type_code",
    )
    .bind(year)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let nature: String = row.try_get("nature")?;
            let sub: i64 = row.try_get("subledger_minor")?;
            let gl_raw: i64 = row.try_get("gl_minor")?;
            // A payable sits credit-side in the ledger; the subledger counts it
            // as a positive amount owed. Flip the ledger's sign for a payable so
            // the two are comparable, rather than teaching every reader to.
            let gl = if nature == "CREDIT" { gl_raw } else { -gl_raw };
            Ok(TaxReconciliationRow {
                tax_type_code: row.try_get("tax_type_code")?,
                tax_type_name: row.try_get("tax_type_name")?,
                nature,
                period_year: i32::from(row.try_get::<i16, _>("period_year")?),
                period_month: i32::from(row.try_get::<i16, _>("period_month")?),
                status: row.try_get("status")?,
                subledger_minor: sub,
                gl_minor: gl,
                difference_minor: gl - sub,
                account_code: row.try_get("account_code")?,
            })
        })
        .collect()
}
