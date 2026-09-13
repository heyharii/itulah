//! What our own bank accounts actually are.
//!
//! The account map says where a posting lands; this says what the account it
//! points at IS — number, holder, branch, which one a shop pays out of. The two
//! are kept apart so an account can be renumbered or moved to another branch
//! without touching a posting rule (0223).
//!
//! The supplier half of the same question lives in `supplier_banks` (0221), and
//! the two deliberately share a shape and a normaliser: "BCA" has to mean the
//! same string on both, or the Banks screen shows one bank twice.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::cloud::postgres::supplier_banks::{normalize_account_no, normalize_bank};
use crate::cloud::AppError;

/// One of our accounts, as the bank knows it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CompanyBankAccount {
    pub account_id: Uuid,
    /// The ledger account this describes, and the place it is kept for.
    pub ledger_account_code: String,
    pub ledger_account_name: String,
    pub site_id: String,
    pub bank_name: String,
    pub account_no: String,
    pub account_holder: String,
    pub branch: Option<String>,
    /// `GIRO` or `SAVINGS`.
    pub kind: String,
    /// The account this place pays out of unless somebody says otherwise.
    pub is_primary: bool,
    pub note: Option<String>,
    pub retired_at: Option<DateTime<Utc>>,
    pub updated_by: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DescribeBankAccountRequest {
    pub ledger_account_code: String,
    pub site_id: String,
    pub bank_name: String,
    pub account_no: String,
    pub account_holder: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub branch: Option<String>,
    /// `GIRO` or `SAVINGS`.
    pub kind: String,
    /// Absent means "decide for me": the first live account at a place becomes
    /// its primary, because a place with one account and no primary is a
    /// question with one answer.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub is_primary: Option<bool>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
}

const KINDS: [&str; 2] = ["GIRO", "SAVINGS"];

fn check_kind(kind: &str) -> Result<String, AppError> {
    let upper = kind.trim().to_uppercase();
    if !KINDS.contains(&upper.as_str()) {
        return Err(AppError::Validation(format!(
            "an account is {} — '{kind}' is neither",
            KINDS.join(" or ")
        )));
    }
    Ok(upper)
}

fn row_to_account(row: &sqlx::postgres::PgRow) -> Result<CompanyBankAccount, AppError> {
    Ok(CompanyBankAccount {
        account_id: row.try_get("account_id")?,
        ledger_account_code: row.try_get("ledger_account_code")?,
        ledger_account_name: row.try_get("ledger_account_name")?,
        site_id: row.try_get("site_id")?,
        bank_name: row.try_get("bank_name")?,
        account_no: row.try_get("account_no")?,
        account_holder: row.try_get("account_holder")?,
        branch: row.try_get("branch")?,
        kind: row.try_get("kind")?,
        is_primary: row.try_get("is_primary")?,
        note: row.try_get("note")?,
        retired_at: row.try_get("retired_at")?,
        updated_by: row.try_get("updated_by")?,
        updated_at: row.try_get("updated_at")?,
    })
}

const SELECT: &str = "SELECT c.account_id, c.ledger_account_code, a.name AS ledger_account_name,
                             c.site_id, c.bank_name, c.account_no, c.account_holder, c.branch,
                             c.kind, c.is_primary, c.note, c.retired_at, c.updated_by, c.updated_at
                        FROM company_bank_account c
                        JOIN ledger_account a ON a.account_code = c.ledger_account_code";

/// Every account we have described. Retired ones come too, marked: they are
/// still what a statement from last March was filed against.
pub async fn list_accounts(
    pool: &PgPool,
    site_id: Option<&str>,
) -> Result<Vec<CompanyBankAccount>, AppError> {
    let rows = sqlx::query(&format!(
        "{SELECT}
          WHERE ($1::text IS NULL OR c.site_id = $1)
          ORDER BY c.retired_at NULLS FIRST, c.bank_name, c.account_no"
    ))
    .bind(site_id)
    .fetch_all(pool)
    .await?;
    rows.iter().map(row_to_account).collect()
}

/// Describe an account, or correct what we said about it.
///
/// One row per ledger binding, so this is an upsert rather than a create: the
/// account already exists in the chart and in the map — what is being written
/// here is what it is, and writing it twice is a correction, not a second
/// account.
pub async fn describe_account(
    pool: &PgPool,
    request: &DescribeBankAccountRequest,
    actor: &str,
) -> Result<CompanyBankAccount, AppError> {
    let (bank_name, bank_normalized) = normalize_bank(&request.bank_name)?;
    let (account_no, account_digits) = normalize_account_no(&request.account_no)?;
    let kind = check_kind(&request.kind)?;
    let holder = request.account_holder.trim();
    if holder.is_empty() {
        return Err(AppError::Validation(
            "a bank prints the name the account is registered under; it cannot be blank".into(),
        ));
    }

    let mut tx = pool.begin().await?;

    // First live account at a place is that place's primary unless told
    // otherwise. Asked inside the transaction so two people describing the
    // first two accounts at once cannot both be told they are the first.
    let primary = match request.is_primary {
        Some(value) => value,
        None => {
            let existing: i64 = sqlx::query(
                "SELECT COUNT(*)::bigint AS n FROM company_bank_account
                  WHERE site_id = $1 AND retired_at IS NULL
                    AND ledger_account_code <> $2",
            )
            .bind(&request.site_id)
            .bind(&request.ledger_account_code)
            .fetch_one(&mut *tx)
            .await?
            .try_get("n")?;
            existing == 0
        }
    };

    // Only one primary per place can be live (0223's partial unique index), so
    // naming a new one stands the old one down rather than being refused. The
    // refusal would be correct and useless: somebody who says "this is the one
    // we pay from now" has already decided about the other.
    if primary {
        sqlx::query(
            "UPDATE company_bank_account SET is_primary = false, updated_by = $2, updated_at = now()
              WHERE site_id = $1 AND is_primary AND retired_at IS NULL",
        )
        .bind(&request.site_id)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
    }

    let row = sqlx::query(
        "INSERT INTO company_bank_account
           (account_id, ledger_account_code, site_id, bank_name, bank_name_normalized,
            account_no, account_no_digits, account_holder, branch, kind, is_primary, note,
            created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
         ON CONFLICT (ledger_account_code, site_id) DO UPDATE
            SET bank_name = EXCLUDED.bank_name,
                bank_name_normalized = EXCLUDED.bank_name_normalized,
                account_no = EXCLUDED.account_no,
                account_no_digits = EXCLUDED.account_no_digits,
                account_holder = EXCLUDED.account_holder,
                branch = EXCLUDED.branch,
                kind = EXCLUDED.kind,
                is_primary = EXCLUDED.is_primary,
                note = EXCLUDED.note,
                retired_at = NULL,
                version = company_bank_account.version + 1,
                updated_by = EXCLUDED.updated_by,
                updated_at = now()
         RETURNING account_id",
    )
    .bind(Uuid::new_v4())
    .bind(&request.ledger_account_code)
    .bind(&request.site_id)
    .bind(&bank_name)
    .bind(&bank_normalized)
    .bind(&account_no)
    .bind(&account_digits)
    .bind(holder)
    .bind(
        request
            .branch
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty()),
    )
    .bind(&kind)
    .bind(primary)
    .bind(
        request
            .note
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty()),
    )
    .bind(actor)
    .fetch_one(&mut *tx)
    .await?;
    let account_id: Uuid = row.try_get("account_id")?;
    tx.commit().await?;

    let found = sqlx::query(&format!("{SELECT} WHERE c.account_id = $1"))
        .bind(account_id)
        .fetch_one(pool)
        .await?;
    row_to_account(&found)
}

/// Stop offering an account, without losing what it already paid.
pub async fn retire_account(
    pool: &PgPool,
    account_id: Uuid,
    actor: &str,
) -> Result<CompanyBankAccount, AppError> {
    let row = sqlx::query(
        "UPDATE company_bank_account
            SET retired_at = now(), updated_by = $2, updated_at = now(),
                version = version + 1
          WHERE account_id = $1 AND retired_at IS NULL
      RETURNING account_id",
    )
    .bind(account_id)
    .bind(actor)
    .fetch_optional(pool)
    .await?;
    if row.is_none() {
        return Err(AppError::NotFound("bank account".into()));
    }
    let found = sqlx::query(&format!("{SELECT} WHERE c.account_id = $1"))
        .bind(account_id)
        .fetch_one(pool)
        .await?;
    row_to_account(&found)
}

/// One institution, gathered from every account that names it.
///
/// Not a master: nobody maintains this list. It is what the accounts say, ours
/// (0223) and our suppliers' (0221) together, grouped on the normalised name
/// both halves compute the same way. A bank appears the moment an account names
/// it and disappears when the last one stops.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BankInstitution {
    /// As it will be printed — the spelling the most recent account used.
    pub name: String,
    /// What uniqueness is judged on. "BCA", "Bank BCA" and "bank bca" are one.
    pub normalized: String,
    pub our_accounts: i64,
    pub supplier_accounts: i64,
    /// What the books hold across our accounts at this bank. Null when we hold
    /// none there, which is different from holding nothing: a bank we only pay
    /// suppliers at has no balance of ours at all.
    pub our_balance_minor: Option<i64>,
}

/// Every bank anybody has named, with what we keep there.
pub async fn bank_institutions(pool: &PgPool) -> Result<Vec<BankInstitution>, AppError> {
    let rows = sqlx::query(
        "WITH ours AS (
             SELECT bank_name_normalized AS k,
                    COUNT(*)::bigint      AS n,
                    MAX(updated_at)       AS newest
               FROM company_bank_account
              WHERE retired_at IS NULL
              GROUP BY 1
         ), theirs AS (
             SELECT bank_name_normalized AS k, COUNT(*)::bigint AS n
               FROM supplier_bank_account
              WHERE retired_at IS NULL
              GROUP BY 1
         ), held AS (
             -- The ledger's own sum over the accounts we described, the same
             -- subtraction `/finance/money` makes. Two different sums of one
             -- account would be two answers.
             SELECT c.bank_name_normalized AS k,
                    SUM(l.debit_minor - l.credit_minor)::bigint AS balance
               FROM company_bank_account c
               JOIN journal_line l
                 ON l.account_code = c.ledger_account_code AND l.site_id = c.site_id
              WHERE c.retired_at IS NULL
              GROUP BY 1
         ), names AS (
             SELECT DISTINCT ON (bank_name_normalized)
                    bank_name_normalized AS k, bank_name AS display
               FROM (
                    SELECT bank_name_normalized, bank_name, updated_at
                      FROM company_bank_account WHERE retired_at IS NULL
                    UNION ALL
                    SELECT bank_name_normalized, bank_name, updated_at
                      FROM supplier_bank_account WHERE retired_at IS NULL
               ) every_name
              ORDER BY bank_name_normalized, updated_at DESC
         )
         SELECT COALESCE(ours.k, theirs.k)          AS normalized,
                names.display                       AS name,
                COALESCE(ours.n, 0)                 AS our_accounts,
                COALESCE(theirs.n, 0)               AS supplier_accounts,
                held.balance                        AS our_balance_minor
           FROM ours
           FULL OUTER JOIN theirs ON theirs.k = ours.k
           LEFT JOIN names ON names.k = COALESCE(ours.k, theirs.k)
           LEFT JOIN held  ON held.k  = COALESCE(ours.k, theirs.k)
          ORDER BY COALESCE(ours.n, 0) DESC, 1",
    )
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let normalized: String = row.try_get("normalized")?;
            Ok(BankInstitution {
                name: row
                    .try_get::<Option<String>, _>("name")?
                    .unwrap_or_else(|| normalized.clone()),
                normalized,
                our_accounts: row.try_get("our_accounts")?,
                supplier_accounts: row.try_get("supplier_accounts")?,
                our_balance_minor: row.try_get("our_balance_minor")?,
            })
        })
        .collect()
}
