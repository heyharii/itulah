//! Where a supplier's money is supposed to land.
//!
//! A bilyet giro is not a cheque. It is an order to move money **into a named
//! account**, so the paper cannot be filled in without the bank, the account
//! number and the name that account is registered under. `supplier` (0032) has
//! a name, a contact, a phone, an email and an address, and nothing about where
//! the money goes; every giro written so far was copied off somebody's notebook.
//! `0221` gives those accounts a table and this module gives them a door.
//!
//! # Why a list and not three columns on the supplier
//!
//! Because a supplier has more than one, and keeps the old one. The trading
//! company banks at BCA while the factory that ships for it invoices from
//! Mandiri; a supplier changes bank and the account we wrote a giro against
//! last March still has to be readable on that giro. Three columns would make
//! each of those an overwrite.
//!
//! ERPNext arrives at the same shape from the other end: its `Bank Account`
//! doctype carries `party_type` + `party` and sits beside the supplier rather
//! than inside it, with `is_default` marking the one a payment reaches for.
//!
//! # What this module refuses to decide
//!
//! Which account a particular giro was paid into. That belongs on the payment,
//! not here, and it is the giro print step's to add: an account that was
//! default in March is not evidence about what a March giro said.

use super::destinations::{destination_key, fingerprint};
use super::{begin_idempotent, complete_idempotent, NullablePatch};
use crate::cloud::application::AppError;
use crate::cloud::domain::payment_account_mask;
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgRow, PgPool, Row};
use uuid::Uuid;

/// One account, as a screen shows it and as a giro is filled in from it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierBankAccount {
    pub account_id: Uuid,
    pub supplier_id: Uuid,
    /// As it will be printed — "Bank BCA", not the normalised form uniqueness
    /// is judged on.
    pub bank_name: String,
    /// As somebody typed it, dashes and all. Also what gets printed: a giro
    /// whose number is grouped the way the passbook groups it is a giro the
    /// counter clerk can check at a glance.
    pub account_no: String,
    /// The name the account is registered under, which is regularly not the
    /// trading name on the invoice — PT and CV forms, a personal account for a
    /// small maker, an old name after a merger. A giro made out to a name the
    /// bank does not recognise comes back.
    pub account_holder: String,
    pub branch: Option<String>,
    /// The one a payment reaches for. At most one per supplier among the live
    /// accounts, and the database holds that rather than this code — see 0221.
    pub is_default: bool,
    /// Hidden from the pickers, still readable on everything it ever paid.
    /// Retired accounts are returned when the caller asks for them, for the
    /// reason every master here does it: a retirement nobody can find is a
    /// retirement nobody can undo.
    pub retired: bool,
    /// `UNVERIFIED`, `VERIFIED` or `REJECTED` (0308). Read-only here on
    /// purpose: verifying a number is Finance's act, done on the payment it
    /// is about to fund — a supplier master that could verify its own
    /// account would be the fraud control signing itself off. Carried so a
    /// register reading the same book can show the state without asking a
    /// second endpoint.
    pub verification_status: Option<String>,
    pub note: Option<String>,
    /// What a PATCH must quote in `If-Match`.
    pub version: i32,
}

/// A new account for a supplier.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateSupplierBankAccountRequest {
    pub bank_name: String,
    pub account_no: String,
    pub account_holder: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub branch: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
    /// Absent means "decide for me": the first live account a supplier has is
    /// the default, because a supplier with one account and no default is a
    /// screen that asks a question with one answer.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub is_default: Option<bool>,
}

/// Correct, re-point, retire or restore one account.
///
/// There is no delete. An account that has been paid into is part of what a
/// printed giro said, and `retired` is the operation people actually mean when
/// they reach for delete.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateSupplierBankAccountRequest {
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub bank_name: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub account_no: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub account_holder: Option<String>,
    // Absent leaves it alone, `null` clears it, a string sets it — the three
    // states `NullablePatch` exists for, spelled the same way `UpdateSupplier`
    // spells them.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub branch: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub is_default: Option<bool>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub retired: Option<bool>,
}

// The merged table carries the party as `(party_type, party_id)` text and the
// bank as an institution row, so the screen's columns are assembled: the
// supplier id back from the text party id, the bank's name from the JOIN.
// There is no version counter on `bank_account`; the second-granularity stamp
// of the last write stands in for one, which is what `If-Match` quotes.
const ACCOUNT_FROM: &str = "FROM bank_account b JOIN bank bk ON bk.bank_id = b.bank_id";
const ACCOUNT_COLUMNS: &str = "b.account_id, b.party_id::uuid AS supplier_id, \
                               bk.name AS bank_name, b.account_no, b.account_holder, \
                               branch, is_default, (b.retired_at IS NOT NULL) AS retired, \
                               verification_status, \
                               note, (extract(epoch FROM b.updated_at))::bigint AS version";

fn account_from_row(row: &PgRow) -> Result<SupplierBankAccount, AppError> {
    Ok(SupplierBankAccount {
        account_id: row.try_get("account_id")?,
        supplier_id: row.try_get("supplier_id")?,
        bank_name: row.try_get("bank_name")?,
        account_no: row.try_get("account_no")?,
        account_holder: row.try_get("account_holder")?,
        branch: row.try_get("branch")?,
        is_default: row.try_get("is_default")?,
        retired: row.try_get("retired")?,
        verification_status: row.try_get("verification_status")?,
        note: row.try_get("note")?,
        // Epoch seconds fit an i32 until 2038; the wire field predates the
        // merged table and keeps its name.
        version: row.try_get::<i64, _>("version")? as i32,
    })
}

/// "Bank BCA", "BANK BCA" and "BCA" are one bank.
///
/// Uniqueness is judged on this and the digits, never on what was typed —
/// otherwise the same account entered twice with the bank spelled two ways is
/// two accounts, and the second is a typo nobody can see. The leading "BANK" is
/// dropped because Indonesian bank names carry it optionally and both spellings
/// are correct on a giro.
/// Shared with `company_banks` (0223) rather than copied: "BCA" has to
/// normalise the same way on both halves, or the Banks screen — which gathers
/// institutions from our accounts and our suppliers' together — shows one bank
/// twice.
pub(crate) fn normalize_bank(value: &str) -> Result<(String, String), AppError> {
    let display = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if display.is_empty() {
        return Err(AppError::Validation("bank name cannot be blank".into()));
    }
    let upper = display.to_uppercase();
    let normalized = upper
        .strip_prefix("BANK ")
        .unwrap_or(&upper)
        .trim()
        .to_owned();
    // "BANK" on its own reaches here as "BANK", not as "": the prefix strip
    // needs the trailing space. Without this second arm the refusal below was
    // unreachable for the exact input it was written for.
    if normalized.is_empty() || normalized == "BANK" {
        return Err(AppError::Validation(
            "bank name cannot be the word 'bank' on its own".into(),
        ));
    }
    Ok((display, normalized))
}

/// What was typed, and the digits it comes down to.
///
/// `123-456-789` and `123456789` are the same account. The bounds match the
/// `CHECK` on `bank_account.account_no_digits` (0302) so that a number too
/// short to be one is refused here, with a sentence, rather than by SQLSTATE
/// 23514 arriving as "database operation failed".
pub(crate) fn normalize_account_no(value: &str) -> Result<(String, String), AppError> {
    let display = value.trim().to_owned();
    let digits: String = display.chars().filter(char::is_ascii_digit).collect();
    if digits.len() < 5 || digits.len() > 25 {
        return Err(AppError::Validation(format!(
            "account number '{display}' does not look like one: it has {} digits, and an account \
             number has between 5 and 25",
            digits.len()
        )));
    }
    Ok((display, digits))
}

fn required(value: &str, what: &str) -> Result<String, AppError> {
    let trimmed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{what} cannot be blank")));
    }
    Ok(trimmed)
}

fn optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|one| !one.is_empty())
        .map(str::to_owned)
}

/// Say which constraint refused, in the words of the person who tripped it.
fn map_write_error(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        return match database.code().as_deref() {
            Some("23505") => AppError::Conflict(
                // The identity index (0302) spans every party and our own
                // accounts alike: a number lives at one bank once, whoever
                // owns it.
                "that account number is already recorded at that bank".to_owned(),
            ),
            // The institution foreign key. The supplier side is text and
            // checked in the code above, so this can only be a `bank_id`
            // that lost its row mid-flight — a 404 rather than a 500.
            Some("23503") => AppError::NotFound("Supplier".to_owned()),
            Some("23514") | Some("23502") => AppError::Validation(database.message().to_owned()),
            _ => AppError::Database(error),
        };
    }
    AppError::Database(error)
}

/// Every account a supplier has, default first.
///
/// `include_retired` is the picker/master split: a form choosing where to send
/// money wants the live ones, and the screen that retired one has to be able to
/// find it again.
pub async fn supplier_bank_accounts(
    pool: &PgPool,
    supplier_id: Uuid,
    include_retired: bool,
) -> Result<Vec<SupplierBankAccount>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {ACCOUNT_COLUMNS}
           {ACCOUNT_FROM}
          WHERE b.party_type = 'SUPPLIER' AND b.party_id = $1
            AND ($2 OR b.retired_at IS NULL)
          ORDER BY (b.retired_at IS NOT NULL), b.is_default DESC, bank_name, b.account_no"
    ))
    .bind(supplier_id.to_string())
    .bind(include_retired)
    .fetch_all(pool)
    .await?;

    rows.iter().map(account_from_row).collect()
}

async fn read_account(pool: &PgPool, account_id: Uuid) -> Result<SupplierBankAccount, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {ACCOUNT_COLUMNS} {ACCOUNT_FROM}
          WHERE b.account_id = $1 AND b.party_type = 'SUPPLIER'"
    ))
    .bind(account_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Supplier bank account".to_owned()))?;
    account_from_row(&row)
}

pub async fn get_supplier_bank_account(
    pool: &PgPool,
    account_id: Uuid,
) -> Result<SupplierBankAccount, AppError> {
    read_account(pool, account_id).await
}

/// Add an account to a supplier.
///
/// Guarded by an idempotency key like every other write here: a buyer whose
/// browser retries a slow request must not end up with the same account twice
/// — and it would be twice, because the second attempt would be refused by the
/// unique index with a message about a clash the caller did not cause.
pub async fn create_supplier_bank_account(
    pool: &PgPool,
    supplier_id: Uuid,
    request: CreateSupplierBankAccountRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<SupplierBankAccount, AppError> {
    let (bank_name, bank_normalized) = normalize_bank(&request.bank_name)?;
    let (account_no, account_digits) = normalize_account_no(&request.account_no)?;
    let account_holder = required(&request.account_holder, "account holder")?;
    // The number is encrypted at rest on a PARTY row, and 0308's
    // `bank_account_check6` enforces it: a row that is not ours must carry
    // `account_number_enc`. That rule came over from `payment_destination`
    // (0151) with the merge, and it is the same rule for the same reason — a
    // recipient's account number is the one field on this table that a dump
    // must not hand over in the clear.
    //
    // So the key, the mask and the fingerprint are the ones `destinations.rs`
    // computes, reused rather than restated: two definitions of "the same
    // account" is how a duplicate gets in, and two definitions of the key is
    // how a row becomes unreadable.
    let key = destination_key()?;
    let branch = optional(request.branch.as_deref());
    let note = optional(request.note.as_deref());

    let mut transaction = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut transaction,
        idempotency_key,
        "supplier_bank_account.create",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }

    // The merged table carries the party as free text, so "no such supplier"
    // is no longer a foreign key's answer — it is asked here, where it can
    // still be a 404 instead of an account pointing at nobody.
    let supplier_exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM supplier WHERE supplier_id = $1)")
            .bind(supplier_id)
            .fetch_one(&mut *transaction)
            .await?;
    if !supplier_exists {
        return Err(AppError::NotFound("Supplier".to_owned()));
    }

    // The institution is a row now; the name typed resolves to it or the
    // account is refused, rather than naming a bank that does not exist.
    let bank_id: Uuid = sqlx::query_scalar("SELECT bank_id FROM bank WHERE normalized_name = $1")
        .bind(&bank_normalized)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| {
            AppError::Validation(format!(
                "bank '{bank_name}' does not exist as an institution"
            ))
        })?;

    // The register's name is the better party_name; the text id is what a row
    // carries when the register has nothing better. Same fill the migration
    // backfill did, done here so rows written today never need the fill-in.
    let party_name: String = sqlx::query_scalar("SELECT name FROM supplier WHERE supplier_id = $1")
        .bind(supplier_id)
        .fetch_optional(&mut *transaction)
        .await?
        .unwrap_or_else(|| supplier_id.to_string());

    // Absent means "the first one is the default". Asked for explicitly, it
    // takes the flag from whoever holds it — the same act ERPNext performs in
    // application code on save, done here inside the transaction so two
    // requests arriving together cannot both win.
    let wants_default = match request.is_default {
        Some(asked) => asked,
        None => {
            let live: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM bank_account
                  WHERE party_type = 'SUPPLIER' AND party_id = $1 AND retired_at IS NULL",
            )
            .bind(supplier_id.to_string())
            .fetch_one(&mut *transaction)
            .await?;
            live == 0
        }
    };
    if wants_default {
        sqlx::query(
            "UPDATE bank_account SET is_default = false
              WHERE party_type = 'SUPPLIER' AND party_id = $1 AND is_default",
        )
        .bind(supplier_id.to_string())
        .execute(&mut *transaction)
        .await?;
    }

    let account_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO bank_account
             (account_id, bank_id, is_company_account, party_type, party_id, party_name,
              account_holder, branch, is_default, account_no, account_no_digits,
              account_number_enc, account_number_mask, account_number_fingerprint,
              owner_domain, verification_status,
              note, active, created_by, updated_by)
         VALUES ($1, $2, false, 'SUPPLIER', $3, $4, $5, $6, $7, $8, $9,
                 pgp_sym_encrypt($10, $11), $12, $13,
                 'SUPPLIER_MASTER', 'UNVERIFIED',
                 $14, true, $15, $15)",
    )
    .bind(account_id)
    .bind(bank_id)
    .bind(supplier_id.to_string())
    .bind(&party_name)
    .bind(&account_holder)
    .bind(&branch)
    .bind(wants_default)
    .bind(&account_no)
    .bind(&account_digits)
    .bind(&account_digits)
    .bind(&key)
    .bind(payment_account_mask(&account_digits))
    .bind(fingerprint(&account_digits))
    .bind(&note)
    .bind(actor)
    .execute(&mut *transaction)
    .await
    .map_err(map_write_error)?;

    // Read back rather than assembled here, so what this answers with and what
    // the next list shows cannot disagree about a default.
    let account = account_from_row(
        &sqlx::query(&format!(
            "SELECT {ACCOUNT_COLUMNS} {ACCOUNT_FROM}
              WHERE b.account_id = $1 AND b.party_type = 'SUPPLIER'"
        ))
        .bind(account_id)
        .fetch_one(&mut *transaction)
        .await?,
    )?;
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&account)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(account)
}

/// Correct an account, make it the default, retire it or bring it back.
pub async fn update_supplier_bank_account(
    pool: &PgPool,
    account_id: Uuid,
    expected_version: i32,
    request: UpdateSupplierBankAccountRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<SupplierBankAccount, AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }

    let bank = request
        .bank_name
        .as_deref()
        .map(normalize_bank)
        .transpose()?;
    let number = request
        .account_no
        .as_deref()
        .map(normalize_account_no)
        .transpose()?;
    let holder = request
        .account_holder
        .as_deref()
        .map(|one| required(one, "account holder"))
        .transpose()?;
    let changes_branch = !matches!(request.branch, NullablePatch::Missing);
    let changes_note = !matches!(request.note, NullablePatch::Missing);
    if bank.is_none()
        && number.is_none()
        && holder.is_none()
        && !changes_branch
        && !changes_note
        && request.is_default.is_none()
        && request.retired.is_none()
    {
        return Err(AppError::Validation(
            "Supplier bank account update must contain at least one field".into(),
        ));
    }

    let mut transaction = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut transaction,
        idempotency_key,
        "supplier_bank_account.update",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }

    let current = sqlx::query(
        "SELECT party_id, (extract(epoch FROM updated_at))::bigint AS version
           FROM bank_account WHERE account_id = $1 AND party_type = 'SUPPLIER' FOR UPDATE",
    )
    .bind(account_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Supplier bank account".to_owned()))?;
    let supplier_id: Uuid = current
        .try_get::<String, _>("party_id")?
        .parse()
        .map_err(|error: uuid::Error| AppError::Validation(error.to_string()))?;
    let actual_version: i64 = current.try_get("version")?;
    if actual_version != i64::from(expected_version) {
        return Err(AppError::Conflict(format!(
            "Supplier bank account has moved on: If-Match said {expected_version}, it is now \
             {actual_version}"
        )));
    }

    // Retiring takes the default with it. The party-default index (0302) only
    // counts live rows, so a retired row could keep the flag and nothing would complain —
    // and the next screen to read "the default" would name an account the
    // supplier has closed.
    let retiring = request.retired == Some(true);
    let becoming_default = request.is_default == Some(true) && !retiring;
    if becoming_default {
        sqlx::query(
            "UPDATE bank_account SET is_default = false
              WHERE party_type = 'SUPPLIER' AND party_id = $1
                AND account_id <> $2 AND is_default",
        )
        .bind(supplier_id.to_string())
        .bind(account_id)
        .execute(&mut *transaction)
        .await?;
    }

    // A changed bank name re-points at the institution row, or the account is
    // refused: the merged table carries no name to hide a spelling behind.
    let bank_id = match bank.as_ref().map(|(_, normalized)| normalized) {
        Some(normalized) => Some(
            sqlx::query_scalar::<_, Uuid>("SELECT bank_id FROM bank WHERE normalized_name = $1")
                .bind(normalized)
                .fetch_optional(&mut *transaction)
                .await?
                .ok_or_else(|| {
                    AppError::Validation(format!(
                        "bank '{}' does not exist as an institution",
                        bank.as_ref().unwrap().0
                    ))
                })?,
        ),
        None => None,
    };

    sqlx::query(
        "UPDATE bank_account
            SET bank_id               = COALESCE($2, bank_id),
                account_no            = COALESCE($3, account_no),
                account_no_digits     = COALESCE($4, account_no_digits),
                account_holder        = COALESCE($5, account_holder),
                branch                = CASE WHEN $6 THEN $7 ELSE branch END,
                note                  = CASE WHEN $8 THEN $9 ELSE note END,
                is_default            = CASE
                                           WHEN $10 THEN false
                                           WHEN $11 IS NULL THEN is_default
                                           ELSE $11
                                       END,
                retired_at            = CASE
                                           WHEN $12 IS NULL THEN retired_at
                                           WHEN $12 THEN COALESCE(retired_at, now())
                                           ELSE NULL
                                       END,
                active                = CASE
                                           WHEN $12 IS NULL THEN active
                                           WHEN $12 THEN false
                                           ELSE true
                                       END,
                updated_by            = $13,
                updated_at            = now()
          WHERE account_id = $1",
    )
    .bind(account_id)
    .bind(bank_id)
    .bind(number.as_ref().map(|(display, _)| display))
    .bind(number.as_ref().map(|(_, digits)| digits))
    .bind(holder.as_ref())
    .bind(changes_branch)
    .bind(match &request.branch {
        NullablePatch::Value(value) => optional(Some(value.as_str())),
        _ => None,
    })
    .bind(changes_note)
    .bind(match &request.note {
        NullablePatch::Value(value) => optional(Some(value.as_str())),
        _ => None,
    })
    .bind(retiring)
    .bind(request.is_default)
    .bind(request.retired)
    .bind(actor)
    .execute(&mut *transaction)
    .await
    .map_err(map_write_error)?;

    let account = account_from_row(
        &sqlx::query(&format!(
            "SELECT {ACCOUNT_COLUMNS} {ACCOUNT_FROM}
              WHERE b.account_id = $1 AND b.party_type = 'SUPPLIER'"
        ))
        .bind(account_id)
        .fetch_one(&mut *transaction)
        .await?,
    )?;
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&account)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(account)
}
