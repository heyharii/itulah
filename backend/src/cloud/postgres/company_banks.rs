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
    /// The institution's code, authoritative since 0269.
    pub bank_code: String,
    pub bank_name: String,
    pub account_no: String,
    pub account_holder: String,
    pub branch: Option<String>,
    /// `GIRO`, `SAVINGS` or `TIME_DEPOSIT`.
    pub kind: String,
    /// `ACTIVE`, `DORMANT` (exists, unused) or `CLOSED` (terminated).
    pub status: String,
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
    /// The institution's own code — `BCA`, `MANDIRI` — which is the way to name
    /// it now that 0269 made institutions rows.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub bank_code: Option<String>,
    /// The old way, kept because the screens still send it. Resolved against
    /// `bank.normalized_name`, and REFUSED when it resolves to nothing: typing a
    /// bank name used to create a bank, which is the duplication 0269 exists to
    /// end.
    #[serde(default)]
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

/// `GIRO` rather than ERPNext's `CURRENT`: giro IS the Indonesian current
/// account, it is the client's own word, and it is the word printed on
/// `1011002 CASH IN BANK GIRO`. `TIME_DEPOSIT` joined them in 0269 — the chart
/// holds four of them (`1011004001` onwards) and they were unrepresentable here.
const KINDS: [&str; 3] = ["GIRO", "SAVINGS", "TIME_DEPOSIT"];

fn check_kind(kind: &str) -> Result<String, AppError> {
    let upper = kind.trim().to_uppercase();
    if !KINDS.contains(&upper.as_str()) {
        return Err(AppError::Validation(format!(
            "an account is one of {} — '{kind}' is none of them",
            KINDS.join(", ")
        )));
    }
    Ok(upper)
}

/// Which institution the caller means, refusing rather than inventing one.
///
/// Before 0269 a bank existed because an account had named it, so a typo made a
/// bank and the Banks screen showed BCA twice. Now the institution is a row, and
/// the only two ways to name it are its code and a name that resolves to one.
/// Neither creates anything: a bank we genuinely start using is a deliberate act,
/// not a side effect of describing an account at half past six.
async fn resolve_institution(
    pool: &PgPool,
    request: &DescribeBankAccountRequest,
) -> Result<(Uuid, String, String), AppError> {
    let by_code = request
        .bank_code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_uppercase);

    let normalized = match &by_code {
        Some(_) => None,
        None => Some(normalize_bank(&request.bank_name)?.1),
    };

    let row = sqlx::query(
        "SELECT bank_id, code, name, normalized_name FROM bank
          WHERE ($1::text IS NOT NULL AND code = $1)
             OR ($2::text IS NOT NULL AND normalized_name = $2)",
    )
    .bind(by_code.as_deref())
    .bind(normalized.as_deref())
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        let known: Vec<String> = sqlx::query("SELECT code FROM bank WHERE active ORDER BY code")
            .fetch_all(pool)
            .await?
            .iter()
            .map(|row| row.try_get::<String, _>("code"))
            .collect::<Result<_, _>>()?;
        let asked = by_code
            .clone()
            .unwrap_or_else(|| request.bank_name.trim().to_string());
        return Err(AppError::Validation(format!(
            "there is no institution '{asked}'. We bank at {}. Starting to bank somewhere new is a \
             decision of its own, and it is made once for every environment by a migration — not as \
             a side effect of describing an account at half past six.",
            known.join(", ")
        )));
    };

    Ok((
        row.try_get("bank_id")?,
        row.try_get("name")?,
        row.try_get("normalized_name")?,
    ))
}

fn row_to_account(row: &sqlx::postgres::PgRow) -> Result<CompanyBankAccount, AppError> {
    Ok(CompanyBankAccount {
        account_id: row.try_get("account_id")?,
        ledger_account_code: row.try_get("ledger_account_code")?,
        ledger_account_name: row.try_get("ledger_account_name")?,
        site_id: row.try_get("site_id")?,
        bank_code: row.try_get("bank_code")?,
        bank_name: row.try_get("bank_name")?,
        account_no: row.try_get("account_no")?,
        account_holder: row.try_get("account_holder")?,
        branch: row.try_get("branch")?,
        kind: row.try_get("kind")?,
        status: row.try_get("status")?,
        is_primary: row.try_get("is_primary")?,
        note: row.try_get("note")?,
        retired_at: row.try_get("retired_at")?,
        updated_by: row.try_get("updated_by")?,
        updated_at: row.try_get("updated_at")?,
    })
}

// Callers append `AND ...` to this, so the company filter lives here: the
// merged table holds our accounts AND our parties', and only the former is
// ours to list.
const SELECT: &str = "SELECT c.account_id, c.ledger_account_code, a.name AS ledger_account_name,
                             c.site_id, b.code AS bank_code, b.name AS bank_name,
                             c.account_no, c.account_holder, c.branch,
                             c.kind, c.status, c.is_primary, c.note, c.retired_at,
                             c.updated_by, c.updated_at
                        FROM bank_account c
                        JOIN ledger_account a ON a.account_code = c.ledger_account_code
                        -- The bank's name is the institution row's now (0302);
                        -- a correction to it reaches every account at it. The
                        -- merge's CHECK keeps a company row's bank_id NOT NULL.
                        JOIN bank b ON b.bank_id = c.bank_id
                        WHERE c.is_company_account";

/// Every account we have described. Retired ones come too, marked: they are
/// still what a statement from last March was filed against.
pub async fn list_accounts(
    pool: &PgPool,
    site_id: Option<&str>,
) -> Result<Vec<CompanyBankAccount>, AppError> {
    let rows = sqlx::query(&format!(
        "{SELECT}
          AND ($1::text IS NULL OR c.site_id = $1)
          ORDER BY c.retired_at NULLS FIRST, b.name, c.account_no"
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
    // The ledger binding must be a real, postable leaf. 0308 merged the two
    // register tables and dropped the composite foreign key that used to
    // guarantee this (`(ledger_account_code, is_group) REFERENCES
    // ledger_account`); the check is back as an assertion, which can also say
    // WHY -- a heading is a sum, not an account a bank statement can move.
    super::ledger::assert_postable(
        pool,
        &request.ledger_account_code,
        super::ledger::Intent::Map,
    )
    .await?;
    // Only the institution's id survives the merge (0302): the row no longer
    // carries a copy of its name, so the display strings are dropped here.
    let (bank_id, _, _) = resolve_institution(pool, request).await?;
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
    //
    // "Other than this one" is judged on the account's identity — the number at
    // the bank — and not on its ledger binding, which since 0269 no longer
    // identifies anything: two accounts may share one.
    let primary = match request.is_primary {
        Some(value) => value,
        None => {
            let existing: i64 = sqlx::query(
                "SELECT COUNT(*)::bigint AS n FROM bank_account
                  WHERE is_company_account AND site_id = $1 AND retired_at IS NULL
                    AND NOT (bank_id = $2 AND account_no_digits = $3)",
            )
            .bind(&request.site_id)
            .bind(bank_id)
            .bind(&account_digits)
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
            "UPDATE bank_account SET is_primary = false, updated_by = $2, updated_at = now()
              WHERE is_company_account AND site_id = $1 AND is_primary AND retired_at IS NULL",
        )
        .bind(&request.site_id)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
    }

    let row = sqlx::query(
        "INSERT INTO bank_account
           (account_id, bank_id, is_company_account, ledger_account_code, site_id,
            account_no, account_no_digits, account_holder, branch, kind, status,
            is_primary, note, created_by, updated_by)
         VALUES ($1,$2,true,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',$10,$11,$12,$12)
         -- Identity is the number at the institution (0269), carried on the
         -- merged table as a partial index (0302). Describing the same account
         -- again is a correction; describing a DIFFERENT number on the same
         -- ledger account is a second account, which is the whole point of
         -- what 0269 unlocked.
         ON CONFLICT (bank_id, account_no_digits) WHERE account_no_digits IS NOT NULL DO UPDATE
            SET ledger_account_code = EXCLUDED.ledger_account_code,
                site_id = EXCLUDED.site_id,
                account_no = EXCLUDED.account_no,
                account_holder = EXCLUDED.account_holder,
                branch = EXCLUDED.branch,
                kind = EXCLUDED.kind,
                is_primary = EXCLUDED.is_primary,
                note = EXCLUDED.note,
                retired_at = NULL,
                -- Re-describing a closed account reopens it, and `status` has
                -- to move with `retired_at` or the reopened row reads CLOSED
                -- with no closure date on it.
                status = 'ACTIVE',
                updated_by = EXCLUDED.updated_by,
                updated_at = now()
         RETURNING account_id",
    )
    .bind(Uuid::new_v4())
    .bind(bank_id)
    .bind(&request.ledger_account_code)
    .bind(&request.site_id)
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

    let found = sqlx::query(&format!("{SELECT} AND c.account_id = $1"))
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
        "UPDATE bank_account
            SET retired_at = now(), status = 'CLOSED', updated_by = $2, updated_at = now()
          WHERE account_id = $1 AND is_company_account AND retired_at IS NULL
      RETURNING account_id",
    )
    .bind(account_id)
    .bind(actor)
    .fetch_optional(pool)
    .await?;
    if row.is_none() {
        return Err(AppError::NotFound("bank account".into()));
    }
    let found = sqlx::query(&format!("{SELECT} AND c.account_id = $1"))
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
pub struct BankingSetupGap {
    /// `bank_giro`, `bank_savings` or `time_deposit`.
    pub semantic_key: String,
    /// The institution's code as the map spells it, which is `bank.code`.
    pub qualifier: String,
    pub site_id: String,
    pub account_code: String,
    pub account_name: String,
    /// What is missing, in a sentence.
    pub why: String,
    /// Null when the map's qualifier matches no institution, which is its own
    /// kind of wrong: the map is naming a bank we do not have.
    pub expected_bank_code: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BankInstitution {
    pub bank_id: Uuid,
    /// Our own stable code for it: `BCA`, `MANDIRI`.
    pub code: String,
    /// As it will be printed.
    pub name: String,
    /// What uniqueness is judged on. "BCA", "Bank BCA" and "bank bca" are one.
    pub normalized: String,
    pub country_code: String,
    pub active: bool,
    pub our_accounts: i64,
    pub supplier_accounts: i64,
    /// What the books hold across our accounts at this bank. Null when we hold
    /// none there, which is different from holding nothing: a bank we only pay
    /// suppliers at has no balance of ours at all.
    pub our_balance_minor: Option<i64>,
}

/// What is still missing before normal bank posting works.
///
/// The gate the validator enforces, read out as a list rather than met as a
/// refusal. A row here is an account somebody has DECLARED holds money at a bank
/// — by pointing `bank_giro`, `bank_savings` or `time_deposit` at it — with no
/// real account of ours registered against it. Until it is registered, postings
/// to that account are refused and the rest of the estate carries on.
///
/// Empty is the whole answer: banking setup is complete when nothing is listed.
/// A fresh installation with nothing mapped yet is complete by that reading, and
/// correctly so — there is nothing it has claimed and not delivered.
///
/// Company-dimension accounts mapped at a shop are not listed. `1011002001` posts
/// at head office and nowhere else (0122), so a mapping of it at store-04 is a
/// mapping nothing can use, and demanding an account for it would be demanding
/// thirteen bank accounts no shop has.
pub async fn banking_readiness(
    pool: &PgPool,
    head_office: &str,
) -> Result<Vec<BankingSetupGap>, AppError> {
    let rows = sqlx::query(
        "SELECT m.role AS semantic_key, m.source_id AS qualifier, m.site_id, m.account_code,
                a.name AS account_name,
                (SELECT COUNT(*)::bigint FROM bank_account c
                  WHERE c.is_company_account
                    AND c.ledger_account_code = m.account_code
                    AND c.site_id = m.site_id) AS described,
                b.code AS expected_bank
           FROM account_resolution m
           JOIN ledger_account a ON a.account_code = m.account_code
           LEFT JOIN bank b ON b.code = m.source_id
          WHERE m.role IN ('bank_giro', 'bank_savings', 'time_deposit')
            AND m.source_type = 'COMPANY'
            AND (a.dimension IS DISTINCT FROM 'company' OR m.site_id = $1)
            AND NOT EXISTS (
                SELECT 1 FROM bank_account c
                 WHERE c.is_company_account
                   AND c.ledger_account_code = m.account_code
                   AND c.site_id = m.site_id
                   AND c.status = 'ACTIVE'
            )
          ORDER BY m.site_id, m.role, m.source_id",
    )
    .bind(head_office)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let described: i64 = row.try_get("described")?;
            let expected: Option<String> = row.try_get("expected_bank")?;
            Ok(BankingSetupGap {
                semantic_key: row.try_get("semantic_key")?,
                qualifier: row.try_get("qualifier")?,
                site_id: row.try_get("site_id")?,
                account_code: row.try_get("account_code")?,
                account_name: row.try_get("account_name")?,
                // The difference between "nobody has described one" and "the one
                // described is dormant or closed" is the difference between an
                // unfinished setup and a deliberate decision, and the person
                // reading this needs to be told which.
                why: if described == 0 {
                    "no bank account of ours is described against this".into()
                } else {
                    "the accounts described against this are dormant or closed".into()
                },
                expected_bank_code: expected,
            })
        })
        .collect()
}

/// The institutions, from the master, with what we keep at each.
///
/// Until 0269 this derived the list with a `UNION ALL` over two text columns, so
/// a bank existed only while some account named it and a typo was a new bank. It
/// reads the table now. The counts still come from the accounts, because that is
/// genuinely what they are.
pub async fn bank_institutions(pool: &PgPool) -> Result<Vec<BankInstitution>, AppError> {
    let rows = sqlx::query(
        "SELECT b.bank_id, b.code, b.name, b.normalized_name AS normalized,
                b.country_code, b.active,
                COALESCE(ours.n, 0)      AS our_accounts,
                COALESCE(theirs.n, 0)    AS supplier_accounts,
                held.balance             AS our_balance_minor
           FROM bank b
           LEFT JOIN LATERAL (
               SELECT COUNT(*)::bigint AS n FROM bank_account c
                WHERE c.is_company_account
                  AND c.bank_id = b.bank_id AND c.retired_at IS NULL
           ) ours ON true
           LEFT JOIN LATERAL (
               SELECT COUNT(*)::bigint AS n FROM bank_account s
                WHERE s.party_type = 'SUPPLIER'
                  AND s.bank_id = b.bank_id AND s.retired_at IS NULL
           ) theirs ON true
           -- The ledger's own sum over the accounts we described, the same
           -- subtraction `/finance/money` makes. Two different sums of one
           -- account would be two answers.
           LEFT JOIN LATERAL (
               SELECT SUM(l.debit_minor - l.credit_minor)::bigint AS balance
                 FROM bank_account c
                 JOIN journal_line l
                   ON l.account_code = c.ledger_account_code AND l.site_id = c.site_id
                WHERE c.is_company_account
                  AND c.bank_id = b.bank_id AND c.retired_at IS NULL
           ) held ON true
          ORDER BY b.active DESC, b.code",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(BankInstitution {
                bank_id: row.try_get("bank_id")?,
                code: row.try_get("code")?,
                name: row.try_get("name")?,
                normalized: row.try_get("normalized")?,
                country_code: row.try_get("country_code")?,
                active: row.try_get("active")?,
                our_accounts: row.try_get("our_accounts")?,
                supplier_accounts: row.try_get("supplier_accounts")?,
                our_balance_minor: row.try_get("our_balance_minor")?,
            })
        })
        .collect()
}
