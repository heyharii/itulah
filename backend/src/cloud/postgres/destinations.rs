//! Where a payment goes, and the frozen copy of it that a payment keeps.
//!
//! # Two tables and one rule between them
//!
//! `payment_destination` is the master: a recipient's bank account, live and
//! editable. `payment_destination_snapshot` is what a payment holds: a copy of
//! that account as it was when the money moved, immutable by trigger.
//!
//! The rule this module exists to keep is that **no read answering "what was
//! this paid to" follows `destination_id`**. It is stated here rather than only
//! in the migration because it is a rule about code, not about data: the schema
//! cannot stop somebody writing a join, and the join looks correct.
//!
//! # The number is encrypted and this module is the only thing that can read it
//!
//! `pgp_sym_encrypt` under `PAYMENT_DESTINATION_KEY`, which the application
//! holds and the database does not. There is no development default and there
//! must not be one: a default is a key that ships, and an encrypted column
//! under a key everybody has is an encrypted column in name only. A node
//! without the variable set can list destinations, verify them and deactivate
//! them — the mask is not a secret — and refuses to create one or to produce a
//! payment instruction, which is the smallest honest failure.
//!
//! `payment_destination_number` is the only function that decrypts, it is
//! `pub(super)`, and its callers are the ones producing a bank instruction. A
//! screen, a list, an export and a log all read `account_number_mask`, so none
//! of them is holding an account number to leak.

use crate::cloud::application::AppError;
use crate::cloud::domain::{payment_account_digits, payment_account_mask};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// The symmetric key, from the environment.
///
/// Absent is a refusal and never a fallback. See the module header.
fn destination_key() -> Result<String, AppError> {
    std::env::var("PAYMENT_DESTINATION_KEY")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::Configuration(
                "PAYMENT_DESTINATION_KEY is not set, so this node cannot read or write a \
                 recipient's account number. Destinations can still be listed and verified — \
                 the mask is not a secret — but nothing can be created and no payment \
                 instruction can be produced until the key is configured"
                    .into(),
            )
        })
}

/// SHA-256 of the digits, hex. Answers "the same account?" without decrypting.
fn fingerprint(digits: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(digits.as_bytes());
    hex::encode(hasher.finalize())
}

/// A destination as a screen reads it. The number is not here, and cannot be.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentDestinationRow {
    pub destination_id: Uuid,
    /// `SUPPLIER`, `EMPLOYEE` or `OTHER`.
    pub party_type: String,
    pub party_id: String,
    pub party_name: String,
    pub bank_name: String,
    pub bank_code: Option<String>,
    /// `••••••7890`. The only form of the number that leaves this process.
    pub account_number_mask: String,
    pub account_holder: String,
    /// `UNVERIFIED`, `VERIFIED` or `REJECTED`.
    pub verification_status: String,
    pub verified_by: Option<String>,
    pub verified_at: Option<DateTime<Utc>>,
    pub verification_note: Option<String>,
    pub active: bool,
    pub deactivated_reason: Option<String>,
    /// `SUPPLIER_MASTER`, `HR` or `FINANCE`.
    pub owner_domain: String,
    /// Whether a Finance user may edit this one. Derived, so a screen does not
    /// have to know the ownership rule to grey out a button.
    pub finance_may_edit: bool,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_by: String,
    pub updated_at: DateTime<Utc>,
}

const DESTINATION_COLUMNS: &str = "d.destination_id, d.party_type, d.party_id, d.party_name,
     d.bank_name, d.bank_code, d.account_number_mask, d.account_holder,
     d.verification_status, d.verified_by, d.verified_at, d.verification_note,
     d.active, d.deactivated_reason, d.owner_domain,
     d.created_by, d.created_at, d.updated_by, d.updated_at";

fn to_destination(row: &sqlx::postgres::PgRow) -> Result<PaymentDestinationRow, AppError> {
    let owner_domain: String = row.try_get("owner_domain")?;
    Ok(PaymentDestinationRow {
        destination_id: row.try_get("destination_id")?,
        party_type: row.try_get("party_type")?,
        party_id: row.try_get("party_id")?,
        party_name: row.try_get("party_name")?,
        bank_name: row.try_get("bank_name")?,
        bank_code: row.try_get("bank_code")?,
        account_number_mask: row.try_get("account_number_mask")?,
        account_holder: row.try_get("account_holder")?,
        verification_status: row.try_get("verification_status")?,
        verified_by: row.try_get("verified_by")?,
        verified_at: row.try_get("verified_at")?,
        verification_note: row.try_get("verification_note")?,
        active: row.try_get("active")?,
        deactivated_reason: row.try_get("deactivated_reason")?,
        finance_may_edit: owner_domain != "HR",
        owner_domain,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        updated_by: row.try_get("updated_by")?,
        updated_at: row.try_get("updated_at")?,
    })
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreatePaymentDestinationRequest {
    pub party_type: String,
    pub party_id: String,
    pub party_name: String,
    pub bank_name: String,
    pub bank_code: Option<String>,
    /// As it is written on the paper. Spaces and dashes are fine; they are
    /// taken out before anything is stored, so the same account keyed three
    /// ways is one destination.
    pub account_number: String,
    pub account_holder: String,
    /// `SUPPLIER_MASTER`, `HR` or `FINANCE`. Defaults from the party type,
    /// because the ordinary case has one right answer and asking a person to
    /// choose is asking them to get it wrong.
    pub owner_domain: Option<String>,
}

/// The refusal that keeps an employee's bank account out of Finance's hands.
///
/// An employee's account is personal data HR holds a lawful basis for, and a
/// clerk who could edit it could redirect a salary. Finance reads every
/// destination — it has to, to pay anybody — and writes none that HR owns.
///
/// A separate task adds the HR-side screen that writes them. Until it does,
/// employee destinations are created by HR's own code path and not by this one,
/// which is why this refuses rather than warning.
fn assert_finance_may_write(owner_domain: &str, party_name: &str) -> Result<(), AppError> {
    if owner_domain == "HR" {
        return Err(AppError::Forbidden(format!(
            "{party_name}'s bank account belongs to HR, and Finance reads it rather than \
             editing it. A salary account is personal data HR holds the basis for, and a \
             payments clerk who could change it could redirect a salary — ask HR to change it \
             on the People screen"
        )));
    }
    Ok(())
}

/// The domain that owns a destination for this party, when nobody says.
fn default_owner(party_type: &str) -> &'static str {
    match party_type {
        "EMPLOYEE" => "HR",
        // Not SUPPLIER_MASTER. The client's supplier master carries no bank
        // details today, so a supplier destination keyed now was keyed by
        // Finance, and saying otherwise would lose the one fact that lets the
        // two be told apart the day the master grows the field.
        _ => "FINANCE",
    }
}

pub async fn payment_destination_list(
    pool: &PgPool,
    party_type: Option<&str>,
    party_id: Option<&str>,
    include_inactive: bool,
    limit: i64,
) -> Result<Vec<PaymentDestinationRow>, AppError> {
    let sql = format!(
        "SELECT {DESTINATION_COLUMNS} FROM payment_destination d
          WHERE ($1::text IS NULL OR d.party_type = $1)
            AND ($2::text IS NULL OR d.party_id = $2)
            AND ($3 OR d.active)
          ORDER BY d.party_name, d.bank_name, d.created_at
          LIMIT $4"
    );
    let rows = sqlx::query(&sql)
        .bind(party_type)
        .bind(party_id)
        .bind(include_inactive)
        .bind(limit.clamp(1, 500))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_destination).collect()
}

pub async fn payment_destination_read(
    pool: &PgPool,
    destination_id: Uuid,
) -> Result<PaymentDestinationRow, AppError> {
    let sql = format!(
        "SELECT {DESTINATION_COLUMNS} FROM payment_destination d WHERE d.destination_id = $1"
    );
    let row = sqlx::query(&sql)
        .bind(destination_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("payment destination".into()))?;
    to_destination(&row)
}

pub async fn payment_destination_create(
    pool: &PgPool,
    request: &CreatePaymentDestinationRequest,
    actor: &str,
) -> Result<PaymentDestinationRow, AppError> {
    let key = destination_key()?;

    let party_type = request.party_type.trim().to_ascii_uppercase();
    if !matches!(party_type.as_str(), "SUPPLIER" | "EMPLOYEE" | "OTHER") {
        return Err(AppError::Validation(format!(
            "'{party_type}' is not a party; expected SUPPLIER, EMPLOYEE or OTHER"
        )));
    }
    let party_id = request.party_id.trim();
    let party_name = request.party_name.trim();
    let bank_name = request.bank_name.trim();
    let account_holder = request.account_holder.trim();
    for (value, what) in [
        (party_id, "which party this account belongs to"),
        (party_name, "the party's name, which is what a list prints"),
        (bank_name, "the bank"),
        (
            account_holder,
            "the name the bank has on the account, which is the field a transfer fails on",
        ),
    ] {
        if value.is_empty() {
            return Err(AppError::Validation(format!(
                "a payment destination needs {what}"
            )));
        }
    }

    let digits = payment_account_digits(&request.account_number);
    if digits.len() < 6 {
        return Err(AppError::Validation(
            "that does not look like a bank account number; it has fewer than six digits in it"
                .into(),
        ));
    }
    let mask = payment_account_mask(&digits);
    let owner_domain = request
        .owner_domain
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_uppercase)
        .unwrap_or_else(|| default_owner(&party_type).to_string());
    if !matches!(owner_domain.as_str(), "SUPPLIER_MASTER" | "HR" | "FINANCE") {
        return Err(AppError::Validation(format!(
            "'{owner_domain}' does not own anything; expected SUPPLIER_MASTER, HR or FINANCE"
        )));
    }
    assert_finance_may_write(&owner_domain, party_name)?;

    let destination_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO payment_destination
           (destination_id, party_type, party_id, party_name, bank_name, bank_code,
            account_number_enc, account_number_mask, account_number_fingerprint,
            account_holder, owner_domain, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,pgp_sym_encrypt($7,$8),$9,$10,$11,$12,$13,$13)",
    )
    .bind(destination_id)
    .bind(&party_type)
    .bind(party_id)
    .bind(party_name)
    .bind(bank_name)
    .bind(
        request
            .bank_code
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    )
    .bind(&digits)
    .bind(&key)
    .bind(&mask)
    .bind(fingerprint(&digits))
    .bind(account_holder)
    .bind(&owner_domain)
    .bind(actor)
    .execute(pool)
    .await
    .map_err(duplicate_account)?;

    payment_destination_read(pool, destination_id).await
}

/// The unique index's message, in the words of what somebody just did.
fn duplicate_account(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &error {
        if db.constraint() == Some("ux_payment_destination_live") {
            return AppError::Conflict(
                "that account is already on file for this party. Deactivate the one that is \
                 there before adding it again, so there is never a question about which of two \
                 identical rows a payment used"
                    .into(),
            );
        }
    }
    AppError::from(error)
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct VerifyPaymentDestinationRequest {
    /// True for VERIFIED, false for REJECTED.
    pub verified: bool,
    /// How it was checked: a cancelled cheque, a bank confirmation, a
    /// one-rupiah test transfer. Required, because "verified" with nothing
    /// behind it is a tick somebody clicked.
    pub note: String,
}

pub async fn payment_destination_verify(
    pool: &PgPool,
    destination_id: Uuid,
    request: &VerifyPaymentDestinationRequest,
    actor: &str,
) -> Result<PaymentDestinationRow, AppError> {
    let note = request.note.trim();
    if note.is_empty() {
        return Err(AppError::Validation(
            "say how the account was checked — a cancelled cheque, a bank confirmation, a \
             one-rupiah test transfer. It is the only record of what 'verified' meant on this row"
                .into(),
        ));
    }
    let existing = payment_destination_read(pool, destination_id).await?;
    assert_finance_may_write(&existing.owner_domain, &existing.party_name)?;
    if !existing.active {
        return Err(AppError::Conflict(format!(
            "{}'s {} account has been deactivated; there is nothing to verify",
            existing.party_name, existing.bank_name
        )));
    }

    sqlx::query(
        "UPDATE payment_destination
            SET verification_status = $2, verified_by = $3, verified_at = now(),
                verification_note = $4, updated_by = $3, updated_at = now()
          WHERE destination_id = $1",
    )
    .bind(destination_id)
    .bind(if request.verified {
        "VERIFIED"
    } else {
        "REJECTED"
    })
    .bind(actor)
    .bind(note)
    .execute(pool)
    .await?;
    payment_destination_read(pool, destination_id).await
}

pub async fn payment_destination_deactivate(
    pool: &PgPool,
    destination_id: Uuid,
    reason: &str,
    actor: &str,
) -> Result<PaymentDestinationRow, AppError> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "say why the account is being taken out of use; the next person to look for it will \
             want to know whether it was closed or replaced"
                .into(),
        ));
    }
    let existing = payment_destination_read(pool, destination_id).await?;
    assert_finance_may_write(&existing.owner_domain, &existing.party_name)?;
    if !existing.active {
        return Ok(existing);
    }
    sqlx::query(
        "UPDATE payment_destination
            SET active = false, deactivated_by = $2, deactivated_at = now(),
                deactivated_reason = $3, updated_by = $2, updated_at = now()
          WHERE destination_id = $1",
    )
    .bind(destination_id)
    .bind(actor)
    .bind(reason)
    .execute(pool)
    .await?;
    payment_destination_read(pool, destination_id).await
}

/// The account number itself. The only function that decrypts.
///
/// `pub(super)` on purpose: producing a bank instruction is inside the
/// repository, and nothing above it — no handler, no serialiser — should be
/// able to reach a number by accident.
#[allow(dead_code)]
pub(super) async fn payment_destination_number(
    executor: impl sqlx::PgExecutor<'_>,
    destination_id: Uuid,
) -> Result<String, AppError> {
    let key = destination_key()?;
    let row = sqlx::query(
        "SELECT pgp_sym_decrypt(account_number_enc, $2) AS digits
           FROM payment_destination WHERE destination_id = $1",
    )
    .bind(destination_id)
    .bind(&key)
    .fetch_optional(executor)
    .await?
    .ok_or_else(|| AppError::NotFound("payment destination".into()))?;
    Ok(row.try_get("digits")?)
}

// ---------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------

/// What a payment was paid to, as it was at the moment it was paid.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentDestinationSnapshot {
    pub snapshot_id: Uuid,
    pub payment_kind: String,
    pub payment_id: String,
    /// Which destination this was copied from. Present so the question can be
    /// asked; never followed to answer what was paid to.
    pub destination_id: Option<Uuid>,
    pub bank_name: String,
    pub bank_code: Option<String>,
    pub account_number_mask: String,
    pub account_holder: String,
    /// What it was when the money moved, which is the question an audit asks.
    pub verification_status: String,
    pub verified_by: Option<String>,
    pub party_type: String,
    pub party_id: String,
    pub party_name: String,
    pub taken_at: DateTime<Utc>,
    pub taken_by: String,
}

fn to_snapshot(row: &sqlx::postgres::PgRow) -> Result<PaymentDestinationSnapshot, AppError> {
    Ok(PaymentDestinationSnapshot {
        snapshot_id: row.try_get("snapshot_id")?,
        payment_kind: row.try_get("payment_kind")?,
        payment_id: row.try_get("payment_id")?,
        destination_id: row.try_get("destination_id")?,
        bank_name: row.try_get("bank_name")?,
        bank_code: row.try_get("bank_code")?,
        account_number_mask: row.try_get("account_number_mask")?,
        account_holder: row.try_get("account_holder")?,
        verification_status: row.try_get("verification_status")?,
        verified_by: row.try_get("verified_by")?,
        party_type: row.try_get("party_type")?,
        party_id: row.try_get("party_id")?,
        party_name: row.try_get("party_name")?,
        taken_at: row.try_get("taken_at")?,
        taken_by: row.try_get("taken_by")?,
    })
}

/// Copy the destination onto a payment, inside the transaction that executes it.
///
/// Takes a transaction and not a pool, deliberately. A snapshot written outside
/// the transaction that moves the money is a snapshot that can exist without
/// the payment, or the payment without it, and the second of those is the
/// failure this whole pair of tables exists to prevent.
pub(super) async fn payment_destination_snapshot_take(
    tx: &mut Transaction<'_, Postgres>,
    payment_kind: &str,
    payment_id: &str,
    destination_id: Uuid,
    actor: &str,
) -> Result<Uuid, AppError> {
    let snapshot_id = Uuid::new_v4();
    let done = sqlx::query(
        "INSERT INTO payment_destination_snapshot
           (snapshot_id, payment_kind, payment_id, destination_id,
            bank_name, bank_code, account_number_mask, account_holder,
            verification_status, verified_by, verified_at,
            party_type, party_id, party_name, taken_by)
         SELECT $1, $2, $3, d.destination_id,
                d.bank_name, d.bank_code, d.account_number_mask, d.account_holder,
                d.verification_status, d.verified_by, d.verified_at,
                d.party_type, d.party_id, d.party_name, $5
           FROM payment_destination d
          WHERE d.destination_id = $4
         ON CONFLICT (payment_kind, payment_id) DO NOTHING",
    )
    .bind(snapshot_id)
    .bind(payment_kind)
    .bind(payment_id)
    .bind(destination_id)
    .bind(actor)
    .execute(&mut **tx)
    .await?;

    if done.rows_affected() == 1 {
        return Ok(snapshot_id);
    }
    // Either the destination is gone, or this payment already has a copy —
    // which is what a retried execution looks like, and is not an error. The
    // existing one is the answer, because the first copy is the one taken when
    // the money moved.
    let existing: Option<Uuid> = sqlx::query_scalar(
        "SELECT snapshot_id FROM payment_destination_snapshot
          WHERE payment_kind = $1 AND payment_id = $2",
    )
    .bind(payment_kind)
    .bind(payment_id)
    .fetch_optional(&mut **tx)
    .await?;
    existing.ok_or_else(|| AppError::NotFound("payment destination".into()))
}

pub async fn payment_destination_snapshot_for(
    pool: &PgPool,
    payment_kind: &str,
    payment_id: &str,
) -> Result<Option<PaymentDestinationSnapshot>, AppError> {
    let row = sqlx::query(
        "SELECT snapshot_id, payment_kind, payment_id, destination_id, bank_name, bank_code,
                account_number_mask, account_holder, verification_status, verified_by,
                party_type, party_id, party_name, taken_at, taken_by
           FROM payment_destination_snapshot
          WHERE payment_kind = $1 AND payment_id = $2",
    )
    .bind(payment_kind)
    .bind(payment_id)
    .fetch_optional(pool)
    .await?;
    row.as_ref().map(to_snapshot).transpose()
}
