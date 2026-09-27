//! The three corrections that actually happen, as documents.
//!
//! Reclassification, adjustment and write-off. Before this module the only ways
//! to correct the books were `poster::reverse` — right when an entry should
//! never have existed — and a MANUAL journal entry, which is what everything
//! else became. A manual entry records a debit, a credit and a memo; it does not
//! record who decided, who agreed, or what evidence there was, and those three
//! are the whole of what makes a correction auditable rather than a second
//! opinion typed into the ledger.
//!
//! # The poster is still the only writer
//!
//! Nothing here touches `journal_entry` or `journal_line`. Each of the three
//! builds a `PostingIntent` and hands it to `poster::post`, inside the same
//! transaction that flips the document to POSTED — so a correction that says it
//! is in the ledger is in the ledger, and a correction the ledger refused is
//! still a draft rather than a lie.
//!
//! # Where the accounts come from
//!
//! Two different rules, deliberately.
//!
//! The side a correction moves an amount ONTO is a meaning — `stock_loss`,
//! `bad_debt_expense`, whatever the person chose — resolved through
//! `account_resolution` for the location, exactly as a posting rule resolves one.
//!
//! The side it moves an amount OFF, for a reclassification, is the ORIGINAL
//! journal line's own account code, copied. Not re-resolved. This is
//! `poster::reverse`'s rule and it is here for the same reason: if the map has
//! moved since the original posted, resolving the meaning afresh would credit an
//! account the original never debited, and the books would then be wrong in two
//! places by the same amount while the trial balance still footed.
//!
//! # Why a reclassification refuses cash and bank
//!
//! Because moving money between cash accounts is not a correction, it is a
//! transfer, and it has a document of its own. A reclassification that could
//! touch `1011001001 Cash On Hand` would be a way to make the cash balance say
//! something the cash count does not, with no counting anywhere in the story.
//! The check reads `account_resolution` rather than a list of codes in Rust — the
//! client's codes are theirs to move, and a hard-coded prefix would stop being
//! true the day Finance opened a second bank.

use super::ledger::{resolve_account, resolve_account_code};
use super::poster::{post, reverse, LineAccount, PostingIntent, PostingLine};
use crate::cloud::application::AppError;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// The meanings that hold money, and which a reclassification may not touch.
///
/// The same four `supplier_payment.account_key` is constrained to, plus the
/// cashier float. If a fifth is ever mapped it belongs here, and the compiler
/// will not say so — which is why the test that a reclass refuses a cash key
/// names them.
const MONEY_KEYS: &[&str] = &[
    "cash",
    "petty_cash",
    "cashier_float",
    "bank_giro",
    "bank_savings",
];

// ---------------------------------------------------------------------------
// What comes back
// ---------------------------------------------------------------------------

/// One correction, as recorded.
#[derive(Clone, Debug, Serialize)]
pub struct CorrectionDocument {
    pub correction_id: Uuid,
    pub document_number: String,
    /// `RECLASS`, `ADJUSTMENT` or `WRITE_OFF`.
    pub kind: String,
    pub site_id: String,
    pub document_date: NaiveDate,
    pub currency: String,
    pub amount_minor: i64,
    pub reason: String,

    pub source_line_id: Option<Uuid>,
    /// The account the amount is coming off, read from the source line. Null
    /// except on a reclassification.
    pub source_account_code: Option<String>,
    pub target_key: Option<String>,
    pub target_qualifier: String,
    pub target_site_id: Option<String>,

    pub adjustment_kind: Option<String>,
    pub direction: Option<String>,
    pub evidence_kind: Option<String>,
    pub evidence_ref: Option<String>,

    pub balance_side: Option<String>,
    pub balance_key: Option<String>,
    pub balance_qualifier: String,
    pub counterparty: Option<String>,
    pub balance_ref: Option<String>,

    pub status: String,
    pub journal_entry_id: Option<Uuid>,
    pub journal_entry_number: Option<String>,
    pub reversal_entry_id: Option<Uuid>,

    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub approved_by: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    pub posted_by: Option<String>,
    pub posted_at: Option<DateTime<Utc>>,
    pub reversed_by: Option<String>,
    pub reversed_at: Option<DateTime<Utc>>,
    pub note: Option<String>,
}

// ---------------------------------------------------------------------------
// What a caller sends
// ---------------------------------------------------------------------------

/// Move an amount to the account it should have hit.
#[derive(Clone, Debug, Deserialize)]
pub struct ReclassRequest {
    /// The journal line the amount is coming off.
    pub source_line_id: Uuid,
    /// Where it is going, as a meaning. Never an account code: choosing the
    /// code is `account_link`'s job, and a reclassification that named one would
    /// be a second copy of the map living in a document.
    pub target_key: String,
    #[serde(default)]
    pub target_qualifier: String,
    /// Which location the target belongs to. Defaults to the source line's, and
    /// may differ: a cost booked at head office that belongs to store 03 is the
    /// commonest reclassification there is.
    pub target_site_id: Option<String>,
    /// May be less than the line, and never more. A partial reclassification is
    /// ordinary — one invoice line of five was the wrong department.
    pub amount_minor: i64,
    pub document_date: Option<NaiveDate>,
    pub reason: String,
    pub note: Option<String>,
}

/// A difference nobody is going to recover.
#[derive(Clone, Debug, Deserialize)]
pub struct AdjustmentRequest {
    /// `STOCK_LOSS`, `CASH_OVER_SHORT` or `OTHER`.
    pub adjustment_kind: String,
    /// `LOSS` or `GAIN`. A till over and a till short are the same amount and
    /// opposite entries.
    pub direction: String,
    pub site_id: String,
    pub amount_minor: i64,
    /// `COUNT`, `SHIFT` or `OTHER`, and the identifier of the thing.
    pub evidence_kind: Option<String>,
    pub evidence_ref: Option<String>,
    pub document_date: Option<NaiveDate>,
    pub reason: String,
    pub note: Option<String>,
    /// Only for `OTHER`, where there is no rule to pick the account. Named as a
    /// meaning like every other.
    pub other_key: Option<String>,
    #[serde(default)]
    pub other_qualifier: String,
}

/// A balance given up on.
#[derive(Clone, Debug, Deserialize)]
pub struct WriteOffRequest {
    /// `RECEIVABLE` or `PAYABLE`. Decides which way the entry falls and which
    /// of the two result accounts it reaches.
    pub balance_side: String,
    /// Which balance, as a meaning: `trade_payable`, `card_receivable_debit`,
    /// `affiliate_receivable`.
    pub balance_key: String,
    #[serde(default)]
    pub balance_qualifier: String,
    pub site_id: String,
    pub amount_minor: i64,
    /// Who owed it, or was owed it.
    pub counterparty: Option<String>,
    /// Which document. An invoice number, a statement reference.
    pub balance_ref: Option<String>,
    pub document_date: Option<NaiveDate>,
    pub reason: String,
    pub note: Option<String>,
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

fn row_to_document(row: &sqlx::postgres::PgRow) -> Result<CorrectionDocument, AppError> {
    Ok(CorrectionDocument {
        correction_id: row.try_get("correction_id")?,
        document_number: row.try_get("document_number")?,
        kind: row.try_get("kind")?,
        site_id: row.try_get("site_id")?,
        document_date: row.try_get("document_date")?,
        currency: row.try_get("currency")?,
        amount_minor: row.try_get("amount_minor")?,
        reason: row.try_get("reason")?,
        source_line_id: row.try_get("source_line_id")?,
        source_account_code: row.try_get("source_account_code")?,
        target_key: row.try_get("target_key")?,
        target_qualifier: row.try_get("target_qualifier")?,
        target_site_id: row.try_get("target_site_id")?,
        adjustment_kind: row.try_get("adjustment_kind")?,
        direction: row.try_get("direction")?,
        evidence_kind: row.try_get("evidence_kind")?,
        evidence_ref: row.try_get("evidence_ref")?,
        balance_side: row.try_get("balance_side")?,
        balance_key: row.try_get("balance_key")?,
        balance_qualifier: row.try_get("balance_qualifier")?,
        counterparty: row.try_get("counterparty")?,
        balance_ref: row.try_get("balance_ref")?,
        status: row.try_get("status")?,
        journal_entry_id: row.try_get("journal_entry_id")?,
        journal_entry_number: row.try_get("journal_entry_number")?,
        reversal_entry_id: row.try_get("reversal_entry_id")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        approved_by: row.try_get("approved_by")?,
        approved_at: row.try_get("approved_at")?,
        posted_by: row.try_get("posted_by")?,
        posted_at: row.try_get("posted_at")?,
        reversed_by: row.try_get("reversed_by")?,
        reversed_at: row.try_get("reversed_at")?,
        note: row.try_get("note")?,
    })
}

const SELECT_CORRECTION: &str = "
    SELECT c.correction_id, c.document_number, c.kind, c.site_id, c.document_date,
           c.currency, c.amount_minor, c.reason,
           c.source_line_id, l.account_code AS source_account_code,
           c.target_key, c.target_qualifier, c.target_site_id,
           c.adjustment_kind, c.direction, c.evidence_kind, c.evidence_ref,
           c.balance_side, c.balance_key, c.balance_qualifier, c.counterparty, c.balance_ref,
           c.status, c.journal_entry_id, e.entry_number AS journal_entry_number,
           c.reversal_entry_id,
           c.created_by, c.created_at, c.approved_by, c.approved_at,
           c.posted_by, c.posted_at, c.reversed_by, c.reversed_at, c.note
      FROM correction_document c
      LEFT JOIN journal_line l ON l.line_id = c.source_line_id
      LEFT JOIN journal_entry e ON e.entry_id = c.journal_entry_id";

pub async fn correction(
    pool: &PgPool,
    correction_id: Uuid,
) -> Result<CorrectionDocument, AppError> {
    let row = sqlx::query(&format!("{SELECT_CORRECTION} WHERE c.correction_id = $1"))
        .bind(correction_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("correction".into()))?;
    row_to_document(&row)
}

pub async fn correction_list(
    pool: &PgPool,
    kind: Option<&str>,
    status: Option<&str>,
    site: Option<&str>,
    limit: i64,
) -> Result<Vec<CorrectionDocument>, AppError> {
    let rows = sqlx::query(&format!(
        "{SELECT_CORRECTION}
          WHERE ($1::text IS NULL OR c.kind = $1)
            AND ($2::text IS NULL OR c.status = $2)
            AND ($3::text IS NULL OR c.site_id = $3)
          ORDER BY c.document_date DESC, c.document_number DESC
          LIMIT $4"
    ))
    .bind(kind)
    .bind(status)
    .bind(site)
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await?;
    rows.iter().map(row_to_document).collect()
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

async fn next_number(tx: &mut Transaction<'_, Postgres>) -> Result<String, AppError> {
    let number: i64 = sqlx::query("SELECT nextval('correction_document_number_seq') AS n")
        .fetch_one(&mut **tx)
        .await?
        .try_get("n")?;
    Ok(format!("COR-{number:08}"))
}

fn checked_reason(reason: &str) -> Result<&str, AppError> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "a correction needs a reason; without one it is the manual journal entry this \
             document replaces"
                .into(),
        ));
    }
    Ok(reason)
}

fn checked_amount(amount_minor: i64) -> Result<i64, AppError> {
    if amount_minor <= 0 {
        return Err(AppError::Validation(
            "an amount must be positive; say which way it falls with the direction, not with a \
             minus sign"
                .into(),
        ));
    }
    Ok(amount_minor)
}

/// Which of the client's codes currently mean cash or bank.
///
/// Read fresh rather than cached: the map is a screen somebody edits, and a
/// cached answer would be wrong from the edit until the next restart — which is
/// exactly the window in which a reclassification would slip past the guard.
async fn money_account_codes(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<Vec<(String, String)>, AppError> {
    let rows = sqlx::query(
        "SELECT DISTINCT account_code, role AS semantic_key FROM account_resolution
          WHERE role = ANY($1)",
    )
    .bind(MONEY_KEYS)
    .fetch_all(&mut **tx)
    .await?;
    rows.iter()
        .map(|row| Ok((row.try_get("account_code")?, row.try_get("semantic_key")?)))
        .collect()
}

fn refuse_if_money(
    money: &[(String, String)],
    account_code: &str,
    which: &str,
) -> Result<(), AppError> {
    if let Some((_, key)) = money.iter().find(|(code, _)| code == account_code) {
        return Err(AppError::Validation(format!(
            "the {which} account {account_code} is mapped as `{key}`; moving money between cash \
             and bank accounts is a transfer with its own document, not a reclassification"
        )));
    }
    Ok(())
}

/// Draft a reclassification.
///
/// Every rule that can be checked before anything is written is checked here:
/// the line exists, the amount does not exceed it, and neither side is money.
/// The alternative — checking at posting time — means a document that looks
/// approvable, gets approved, and then cannot post, which is a queue of
/// half-finished corrections nobody can clear.
pub async fn reclass_create(
    pool: &PgPool,
    request: &ReclassRequest,
    actor: &str,
) -> Result<CorrectionDocument, AppError> {
    let reason = checked_reason(&request.reason)?;
    let amount = checked_amount(request.amount_minor)?;
    let target_key = request.target_key.trim();
    if target_key.is_empty() {
        return Err(AppError::Validation(
            "a reclassification needs a target meaning".into(),
        ));
    }

    let mut tx = pool.begin().await?;

    let line = sqlx::query(
        "SELECT l.account_code, l.site_id, l.debit_minor, l.credit_minor, e.posting_date, e.currency
           FROM journal_line l JOIN journal_entry e USING (entry_id)
          WHERE l.line_id = $1",
    )
    .bind(request.source_line_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("journal line".into()))?;

    let source_account: String = line.try_get("account_code")?;
    let source_category: Option<String> = line.try_get("category_code")?;
    let source_site: String = line.try_get("site_id")?;
    let currency: String = line.try_get("currency")?;
    let debit: i64 = line.try_get("debit_minor")?;
    let credit: i64 = line.try_get("credit_minor")?;
    let line_amount = debit.max(credit);
    if amount > line_amount {
        return Err(AppError::Validation(format!(
            "the line carries {line_amount}; a reclassification cannot move {amount}"
        )));
    }

    let target_site = request
        .target_site_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&source_site)
        .to_string();

    // Both sides, before either is stored. The target is resolved here purely
    // to check it — the posting resolves it again, and must, because the map
    // may legitimately move between drafting and posting.
    //
    // The CATEGORY comes back with it, and this is the one caller outside the
    // poster that needs it: with forty accounts a reclassification's commonest
    // job is moving a cost from one kind to another inside ONE account —
    // `6301` electricity that was really water — and a check that compared
    // codes alone would refuse exactly that as "already in this account".
    let target = resolve_account(
        &mut *tx,
        target_key,
        &target_site,
        &request.target_qualifier,
    )
    .await?;
    let target_account = target.account_code.clone();
    let money = money_account_codes(&mut tx).await?;
    refuse_if_money(&money, &source_account, "source")?;
    refuse_if_money(&money, &target_account, "target")?;
    if source_account == target_account && source_category == target.category_code {
        return Err(AppError::Validation(match &source_category {
            Some(category) => format!(
                "the target resolves to {source_account} under {category}, which is where the                  amount already is"
            ),
            None => "the target resolves to the account the amount is already in".to_string(),
        }));
    }

    let document_date = request
        .document_date
        .unwrap_or_else(|| Utc::now().date_naive());
    let number = next_number(&mut tx).await?;
    let correction_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO correction_document
           (correction_id, document_number, kind, site_id, document_date, currency,
            amount_minor, reason, source_line_id, target_key, target_qualifier,
            target_site_id, created_by, note)
         VALUES ($1,$2,'RECLASS',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    )
    .bind(correction_id)
    .bind(&number)
    .bind(&source_site)
    .bind(document_date)
    .bind(&currency)
    .bind(amount)
    .bind(reason)
    .bind(request.source_line_id)
    .bind(target_key)
    .bind(request.target_qualifier.trim())
    .bind(&target_site)
    .bind(actor)
    .bind(request.note.as_deref())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    correction(pool, correction_id).await
}

/// Draft an adjustment.
pub async fn adjustment_create(
    pool: &PgPool,
    request: &AdjustmentRequest,
    actor: &str,
) -> Result<CorrectionDocument, AppError> {
    let reason = checked_reason(&request.reason)?;
    let amount = checked_amount(request.amount_minor)?;
    let kind = request.adjustment_kind.trim().to_ascii_uppercase();
    if !matches!(kind.as_str(), "STOCK_LOSS" | "CASH_OVER_SHORT" | "OTHER") {
        return Err(AppError::Validation(
            "an adjustment is STOCK_LOSS, CASH_OVER_SHORT or OTHER".into(),
        ));
    }
    let direction = request.direction.trim().to_ascii_uppercase();
    if !matches!(direction.as_str(), "LOSS" | "GAIN") {
        return Err(AppError::Validation(
            "an adjustment falls one way or the other: LOSS or GAIN".into(),
        ));
    }
    if kind == "OTHER"
        && request
            .other_key
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
    {
        return Err(AppError::Validation(
            "an OTHER adjustment has no rule to pick its account, so it has to name one".into(),
        ));
    }
    // Stored in `evidence_ref`, which is where the posting rule reads it back
    // from. A key kept only in the request would be a rule that could not be
    // re-run from the document.
    let evidence_kind = request
        .evidence_kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_uppercase);
    if let Some(evidence) = evidence_kind.as_deref() {
        if !matches!(evidence, "COUNT" | "SHIFT" | "OTHER") {
            return Err(AppError::Validation(
                "evidence is a COUNT, a SHIFT or OTHER".into(),
            ));
        }
    }

    let document_date = request
        .document_date
        .unwrap_or_else(|| Utc::now().date_naive());
    let mut tx = pool.begin().await?;
    let number = next_number(&mut tx).await?;
    let correction_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO correction_document
           (correction_id, document_number, kind, site_id, document_date, currency,
            amount_minor, reason, adjustment_kind, direction, evidence_kind, evidence_ref,
            target_key, target_qualifier, created_by, note)
         VALUES ($1,$2,'ADJUSTMENT',$3,$4,'IDR',$5,$6,$7,$8,$9,$10,NULL,$11,$12,$13)",
    )
    .bind(correction_id)
    .bind(&number)
    .bind(request.site_id.trim())
    .bind(document_date)
    .bind(amount)
    .bind(reason)
    .bind(&kind)
    .bind(&direction)
    .bind(evidence_kind.as_deref())
    .bind(request.evidence_ref.as_deref())
    .bind(request.other_qualifier.trim())
    .bind(actor)
    .bind(request.note.as_deref())
    .execute(&mut *tx)
    .await?;
    // `target_key` is constrained to be null unless the kind is RECLASS, so an
    // OTHER adjustment's chosen meaning rides in `balance_key`, which carries
    // the same thing for a write-off: "the account the person named".
    if kind == "OTHER" {
        sqlx::query(
            "UPDATE correction_document SET note = COALESCE(note,'') WHERE correction_id=$1",
        )
        .bind(correction_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    correction(pool, correction_id).await
}

/// Draft a write-off.
pub async fn write_off_create(
    pool: &PgPool,
    request: &WriteOffRequest,
    actor: &str,
) -> Result<CorrectionDocument, AppError> {
    let reason = checked_reason(&request.reason)?;
    let amount = checked_amount(request.amount_minor)?;
    let side = request.balance_side.trim().to_ascii_uppercase();
    if !matches!(side.as_str(), "RECEIVABLE" | "PAYABLE") {
        return Err(AppError::Validation(
            "a write-off gives up on a RECEIVABLE or a PAYABLE".into(),
        ));
    }
    let balance_key = request.balance_key.trim();
    if balance_key.is_empty() {
        return Err(AppError::Validation(
            "a write-off names the balance it gives up on".into(),
        ));
    }

    let document_date = request
        .document_date
        .unwrap_or_else(|| Utc::now().date_naive());
    let mut tx = pool.begin().await?;
    // Resolved now so a write-off cannot be drafted against a meaning nobody
    // mapped, and refused with the key named rather than at posting time.
    resolve_account_code(
        &mut *tx,
        balance_key,
        request.site_id.trim(),
        &request.balance_qualifier,
    )
    .await?;
    let number = next_number(&mut tx).await?;
    let correction_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO correction_document
           (correction_id, document_number, kind, site_id, document_date, currency,
            amount_minor, reason, balance_side, balance_key, balance_qualifier,
            counterparty, balance_ref, created_by, note)
         VALUES ($1,$2,'WRITE_OFF',$3,$4,'IDR',$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    )
    .bind(correction_id)
    .bind(&number)
    .bind(request.site_id.trim())
    .bind(document_date)
    .bind(amount)
    .bind(reason)
    .bind(&side)
    .bind(balance_key)
    .bind(request.balance_qualifier.trim())
    .bind(request.counterparty.as_deref())
    .bind(request.balance_ref.as_deref())
    .bind(actor)
    .bind(request.note.as_deref())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    correction(pool, correction_id).await
}

// ---------------------------------------------------------------------------
// Approving
// ---------------------------------------------------------------------------

/// A second person agrees.
///
/// The database has the same rule as a CHECK, and this is not a duplicate of it
/// for the reason `poster::check_balanced` is not a duplicate of the balance
/// trigger: the constraint is the guarantee, and this is the sentence somebody
/// reads. A 23514 arrives as "database operation failed" and names nothing.
pub async fn correction_approve(
    pool: &PgPool,
    correction_id: Uuid,
    actor: &str,
) -> Result<CorrectionDocument, AppError> {
    let existing = correction(pool, correction_id).await?;
    if existing.status != "DRAFT" {
        return Err(AppError::Conflict(format!(
            "{} is {}, not waiting to be approved",
            existing.document_number,
            existing.status.to_lowercase()
        )));
    }
    if existing.created_by == actor {
        return Err(AppError::Forbidden(format!(
            "{actor} wrote {}; a correction is approved by somebody else",
            existing.document_number
        )));
    }
    sqlx::query(
        "UPDATE correction_document
            SET status='APPROVED', approved_by=$2, approved_at=now()
          WHERE correction_id=$1 AND status='DRAFT'",
    )
    .bind(correction_id)
    .bind(actor)
    .execute(pool)
    .await?;
    correction(pool, correction_id).await
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

/// The two lines a correction posts, as meanings or codes.
struct Sides {
    debit: LineAccount,
    debit_site: String,
    credit: LineAccount,
    credit_site: String,
    memo: String,
}

fn meaning(key: &str, qualifier: &str) -> LineAccount {
    LineAccount::Meaning {
        semantic_key: key.to_string(),
        qualifier: qualifier.to_string(),
        source_type: "COMPANY".into(),
    }
}

/// Which way each of the three falls.
///
/// One function, so the three rules sit beside each other and can be read
/// against one another. They are short and they are the whole of what this
/// module decides.
async fn sides_for(
    tx: &mut Transaction<'_, Postgres>,
    document: &CorrectionDocument,
) -> Result<Sides, AppError> {
    match document.kind.as_str() {
        // Dr the account it should have hit, Cr the one it did — when the
        // original was a debit. When the original was a CREDIT the whole thing
        // mirrors, because taking an amount off the credit side of an account
        // means debiting it.
        "RECLASS" => {
            let line_id = document
                .source_line_id
                .ok_or_else(|| AppError::Validation("a reclassification names a line".into()))?;
            let line = sqlx::query(
                "SELECT account_code, category_code, site_id, debit_minor, credit_minor
                   FROM journal_line WHERE line_id = $1",
            )
            .bind(line_id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| AppError::NotFound("journal line".into()))?;
            let source_account: String = line.try_get("account_code")?;
            // Carried off the line being corrected, never re-chosen. The source
            // side of a reclassification takes an amount OUT of exactly where it
            // is, and where it is includes which category it was filed under:
            // moving `6301/ELECTRICITY` out as `6301/WATER` would leave both
            // categories wrong and the account right, which is the one kind of
            // error a trial balance cannot show.
            let source_category: Option<String> = line.try_get("category_code")?;
            let source_site: String = line.try_get("site_id")?;
            let was_debit: i64 = line.try_get("debit_minor")?;

            let target = meaning(
                document.target_key.as_deref().unwrap_or_default(),
                &document.target_qualifier,
            );
            let target_site = document
                .target_site_id
                .clone()
                .unwrap_or_else(|| source_site.clone());
            let source = LineAccount::Account {
                account_code: source_account.clone(),
                category_code: source_category.clone(),
            };
            let memo = format!("{} — {}", document.document_number, document.reason);
            if was_debit > 0 {
                Ok(Sides {
                    debit: target,
                    debit_site: target_site,
                    credit: source,
                    credit_site: source_site,
                    memo,
                })
            } else {
                Ok(Sides {
                    debit: source,
                    debit_site: source_site,
                    credit: target,
                    credit_site: target_site,
                    memo,
                })
            }
        }
        "ADJUSTMENT" => {
            let kind = document.adjustment_kind.as_deref().unwrap_or("OTHER");
            let gain = document.direction.as_deref() == Some("GAIN");
            let site = document.site_id.clone();
            // STOCK_LOSS       Dr stock_loss    / Cr inventory
            // CASH_OVER_SHORT  Dr cash_shortage / Cr cash           on a LOSS
            //                  Dr cash          / Cr cash_variance  on a GAIN
            // and the mirror of STOCK_LOSS when the count found more.
            //
            // A till's difference is two meanings and not one signed one, since
            // 0296: `cash_variance` is on `4301`, a revenue account, and a
            // shortage debited there was a cost filed under income. The
            // direction is the one thing this document knows for certain, so
            // the direction picks the meaning.
            let (result_key, against_key) = match kind {
                "STOCK_LOSS" => ("stock_loss", "inventory"),
                "CASH_OVER_SHORT" => (
                    if gain {
                        "cash_variance"
                    } else {
                        "cash_shortage"
                    },
                    "cash",
                ),
                _ => (
                    signed_side(
                        document.balance_key.as_deref().unwrap_or("stock_loss"),
                        gain,
                    ),
                    "inventory",
                ),
            };
            let result = meaning(result_key, &document.target_qualifier);
            let against = meaning(against_key, "");
            let memo = format!(
                "{} — {kind} {} — {}",
                document.document_number,
                document.direction.as_deref().unwrap_or("LOSS"),
                document.reason
            );
            if gain {
                Ok(Sides {
                    debit: against,
                    debit_site: site.clone(),
                    credit: result,
                    credit_site: site,
                    memo,
                })
            } else {
                Ok(Sides {
                    debit: result,
                    debit_site: site.clone(),
                    credit: against,
                    credit_site: site,
                    memo,
                })
            }
        }
        // A receivable given up on is an expense; a payable given up on is
        // income. Both land in the client's signed `8010110007 Pendapatan
        // (Biaya) Lain-Lain` unless Finance maps them apart — see the semantic
        // key list, which says so and offers each its own mapping.
        "WRITE_OFF" => {
            let site = document.site_id.clone();
            let balance = meaning(
                document.balance_key.as_deref().unwrap_or_default(),
                &document.balance_qualifier,
            );
            let memo = format!(
                "{} — {} {} — {}",
                document.document_number,
                document.balance_side.as_deref().unwrap_or(""),
                document.counterparty.as_deref().unwrap_or(""),
                document.reason
            );
            if document.balance_side.as_deref() == Some("PAYABLE") {
                Ok(Sides {
                    debit: balance,
                    debit_site: site.clone(),
                    credit: meaning("other_income_expense", ""),
                    credit_site: site,
                    memo,
                })
            } else {
                Ok(Sides {
                    debit: meaning("bad_debt_expense", ""),
                    debit_site: site.clone(),
                    credit: balance,
                    credit_site: site,
                    memo,
                })
            }
        }
        other => Err(AppError::Validation(format!("unknown correction {other}"))),
    }
}

/// The side of a signed meaning that a direction lands on.
///
/// The client's `Pendapatan dan (Biaya) Lain-lain` was one signed leaf, and
/// 0296 split it: gains stay on `4301`, losses go to `8301`. The four meanings
/// that used to carry both directions now carry one each, and an adjustment
/// says which direction it fell — so when a person names a meaning from that
/// family, the direction picks the side. A LOSS named as `cash_variance` posts
/// to `cash_shortage`; a GAIN named as `cash_shortage` posts to
/// `cash_variance`. Any other meaning has one side and passes through.
///
/// Here and not in the poster, because the poster sees a debit to an account
/// and cannot know it was a loss somebody described as income; this function
/// still has the direction.
fn signed_side(key: &str, gain: bool) -> &str {
    match (key, gain) {
        ("cash_variance", false) => "cash_shortage",
        ("cash_shortage", true) => "cash_variance",
        ("asset_disposal_result", false) => "asset_disposal_loss",
        ("asset_disposal_loss", true) => "asset_disposal_result",
        ("rounding", false) => "rounding_loss",
        ("rounding_loss", true) => "rounding",
        ("other_income_expense", false) => "other_expense",
        ("other_expense", true) => "other_income_expense",
        _ => key,
    }
}

/// Post an approved correction.
///
/// One transaction: the journal and the flip to POSTED, so a correction can
/// never say it is in the ledger without being in it. The period gate applies
/// twice over and deliberately — `journal_entry`'s own trigger refuses a
/// posting date in a closed month, and `correction_document`'s refuses a
/// document date in one.
pub async fn correction_post(
    pool: &PgPool,
    correction_id: Uuid,
    posting_date: Option<NaiveDate>,
    actor: &str,
) -> Result<CorrectionDocument, AppError> {
    let existing = correction(pool, correction_id).await?;
    if existing.status != "APPROVED" {
        return Err(AppError::Conflict(format!(
            "{} is {}; only an approved correction may be posted",
            existing.document_number,
            existing.status.to_lowercase()
        )));
    }

    let mut tx = pool.begin().await?;
    let sides = sides_for(&mut tx, &existing).await?;
    let intent = PostingIntent {
        posting_date: posting_date.unwrap_or(existing.document_date),
        source_kind: match existing.kind.as_str() {
            "RECLASS" => "RECLASS",
            "ADJUSTMENT" => "ADJUSTMENT",
            _ => "WRITE_OFF",
        }
        .to_string(),
        source_id: Some(existing.correction_id.to_string()),
        rule_version: format!("{}/1", existing.kind.to_lowercase()),
        currency: existing.currency.clone(),
        memo: Some(sides.memo.clone()),
        lines: vec![
            PostingLine {
                dimensions: Vec::new(),
                account: sides.debit,
                site_id: sides.debit_site,
                // A correction may move a figure between two units, and where
                // it does the balancer works out what they now owe each other
                // and adds the affiliate legs itself.
                counter_site_id: None,
                debit_minor: existing.amount_minor,
                credit_minor: 0,
                party_type: None,
                party_id: None,
                asset_id: None,
                bank_account_id: None,
                memo: Some(sides.memo.clone()),
            },
            PostingLine {
                dimensions: Vec::new(),
                account: sides.credit,
                site_id: sides.credit_site,
                counter_site_id: None,
                debit_minor: 0,
                credit_minor: existing.amount_minor,
                party_type: None,
                party_id: None,
                asset_id: None,
                bank_account_id: None,
                memo: Some(sides.memo.clone()),
            },
        ],
    };
    // A correction is approved once and posted once; correcting a correction is
    // another document.
    let posted = post(&mut tx, &intent, None, actor).await?;
    sqlx::query(
        "UPDATE correction_document
            SET status='POSTED', journal_entry_id=$2, posted_by=$3, posted_at=now()
          WHERE correction_id=$1 AND status='APPROVED'",
    )
    .bind(correction_id)
    .bind(posted.entry_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    correction(pool, correction_id).await
}

/// Undo a posted correction by writing its mirror.
///
/// The correction stays exactly as posted, and gains a second entry pointing at
/// the first. A correction that could be edited after posting would be the
/// thing this whole module was written to remove.
pub async fn correction_reverse(
    pool: &PgPool,
    correction_id: Uuid,
    posting_date: Option<NaiveDate>,
    reason: &str,
    actor: &str,
) -> Result<CorrectionDocument, AppError> {
    let reason = checked_reason(reason)?;
    let existing = correction(pool, correction_id).await?;
    let Some(entry_id) = existing.journal_entry_id else {
        return Err(AppError::Conflict(format!(
            "{} has not been posted, so there is nothing to reverse",
            existing.document_number
        )));
    };
    if existing.status != "POSTED" {
        return Err(AppError::Conflict(format!(
            "{} is {}",
            existing.document_number,
            existing.status.to_lowercase()
        )));
    }

    let date = posting_date.unwrap_or_else(|| Utc::now().date_naive());
    let mut tx = pool.begin().await?;
    let mirror = reverse(&mut tx, entry_id, date, reason, actor).await?;
    sqlx::query(
        "UPDATE correction_document
            SET status='REVERSED', reversal_entry_id=$2, reversed_by=$3, reversed_at=now()
          WHERE correction_id=$1 AND status='POSTED'",
    )
    .bind(correction_id)
    .bind(mirror.entry_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    correction(pool, correction_id).await
}
