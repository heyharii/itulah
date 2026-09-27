//! The cash document: the sanctioned way money moves between two accounts.
//!
//! Before this, money moved by side effect. A supplier payment moved it, a sale
//! moved it, `book_bank_line` moved it with a raw journal entry — and anything
//! that did not fit one of those had to be a hand-keyed journal, which is the
//! one act the ledger cannot check. A shop paying for a repair out of the till,
//! a cashier banking the day's takings, head office moving a float between two
//! banks: none of them had a document, and all of them are ordinary.
//!
//! # What the document decides, and what it refuses
//!
//! One side must hold money. That is the rule that makes this a cash document
//! and not a general journal with nicer wording — two non-money accounts is a
//! reclassification, and reclassifications belong in the journal where somebody
//! has to justify them.
//!
//! A supplier with open bills is refused and sent to Payables. Not because
//! paying a supplier from here would fail — it would post perfectly — but
//! because it would pay them without answering any particular debt, and the
//! ageing would then show a supplier who has been paid and still owes
//! everything. Payables exists to allocate; this exists to move money.
//!
//! Posting twice is refused by the status ladder in the database, and again
//! here so the message names the document rather than a constraint.
//!
//! # Two acts, and a third for the paper
//!
//! Keyed, then approved, then posted. Approval is where the number is taken —
//! `KK-26-09-00001`, per kind per month — because a draft somebody abandons
//! should not burn a number out of a file that is checked for gaps. The slip
//! carries three signature lines and the system fills in two of them; the
//! third, "diperiksa", is a wet signature and this module does not pretend
//! otherwise.

use super::ledger::{assert_category_for_account, assert_postable, resolve_account, Intent};
use super::poster::{post, reverse, LineAccount, PostingIntent, PostingLine};
use crate::cloud::application::AppError;
use crate::cloud::domain::{
    accounting_month, cash_direction, cash_document_number, holds_money, rupiah_in_words,
    CashDirection, MONEY_MEANINGS,
};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// One side of a document, as a caller says it.
///
/// Either a meaning resolved through `account_resolution` in that unit's books, or
/// a client account code a person chose — the same choice `poster::LineAccount`
/// models, for the same reason. The money side always has a meaning; the other
/// side, when it is a bank charge or a donation, usually has none.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CashSide {
    pub semantic_key: Option<String>,
    #[serde(default)]
    pub qualifier: String,
    pub account_code: Option<String>,
    /// What kind of thing this side is, on the accounts that are kept by kind.
    ///
    /// Sent only with `account_code`, and required there whenever the account
    /// declares a family: `6301` is every general and administrative expense
    /// the company has, and a document naming it without saying which cannot
    /// post. Refused beside `semantic_key`, because the map already chose the
    /// pair and a second answer could only disagree with it.
    #[serde(default)]
    pub category_code: Option<String>,
    /// Whose books this side is in: a unit (0608).
    pub unit_id: String,
}

/// One side, after it has been made sense of.
#[derive(Clone, Debug)]
pub(super) struct ResolvedSide {
    pub key: Option<String>,
    pub qualifier: String,
    pub account_code: Option<String>,
    /// The category this side posts under: the map's, when the side named a
    /// meaning; the person's, when they named a code. Stored on the document
    /// either way, so that posting it a second time — a reversal, a re-post
    /// after a correction — files it exactly where the first one did.
    pub category_code: Option<String>,
    pub unit_id: String,
    /// Whether this side is one of the seven meanings that hold money.
    pub money: bool,
    /// The client code this resolves to today, for the slip.
    pub resolved_code: String,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordCashDocumentRequest {
    pub doc_date: NaiveDate,
    pub from: CashSide,
    pub to: CashSide,
    pub amount_minor: i64,
    /// `SUPPLIER`, `EMPLOYEE` or `OTHER`.
    #[serde(default)]
    pub party_type: Option<String>,
    pub supplier_id: Option<String>,
    pub employee_id: Option<String>,
    /// What the slip prints on the "dibayarkan kepada" line. Required, whatever
    /// the party's shape: a slip that printed an id would be a slip nobody
    /// could file.
    pub party_name: String,
    pub memo: String,
    pub attachment_file_id: Option<Uuid>,
}

/// A cash document as a screen reads it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CashDocumentRow {
    pub document_id: Uuid,
    /// `PAY`, `RECEIVE` or `TRANSFER`. Derived from the two accounts when the
    /// document was keyed, never chosen.
    pub kind: String,
    /// `KK-26-09-00001`. Absent until it is approved.
    pub number: Option<String>,
    pub doc_date: NaiveDate,

    pub from_key: Option<String>,
    pub from_qualifier: String,
    pub from_account_code: Option<String>,
    /// What the FROM side is filed as. Stored on the document rather than
    /// re-derived at posting time: the document is the record of what somebody
    /// decided, and a category worked out afresh months later could file a
    /// reversal somewhere the original never went.
    pub from_category_code: Option<String>,
    /// Whose books the money leaves (0608).
    pub from_unit: String,
    pub to_key: Option<String>,
    pub to_qualifier: String,
    pub to_account_code: Option<String>,
    pub to_category_code: Option<String>,
    /// Whose books the money enters (0608).
    pub to_unit: String,

    pub amount_minor: i64,
    pub currency: String,
    pub party_type: String,
    pub supplier_id: Option<String>,
    pub employee_id: Option<String>,
    pub party_name: String,
    pub memo: String,
    pub attachment_file_id: Option<Uuid>,
    /// The bank line this was booked from, when it was not typed.
    pub statement_line_id: Option<Uuid>,

    pub status: String,
    pub journal_entry_id: Option<Uuid>,
    pub entry_number: Option<String>,
    pub reversal_entry_id: Option<Uuid>,

    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub approved_by: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    pub posted_by: Option<String>,
    pub posted_at: Option<DateTime<Utc>>,
}

const DOCUMENT_COLUMNS: &str = "d.document_id, d.kind, d.number, d.doc_date,
     d.from_key, d.from_qualifier, d.from_account_code, d.from_category_code, d.from_unit,
     d.to_key, d.to_qualifier, d.to_account_code, d.to_category_code, d.to_unit,
     d.amount_minor, d.currency, d.party_type, d.supplier_id, d.employee_id,
     d.party_name, d.memo, d.attachment_file_id, d.statement_line_id,
     d.status, d.journal_entry_id, d.reversal_entry_id,
     d.created_by, d.created_at, d.approved_by, d.approved_at,
     d.posted_by, d.posted_at,
     (SELECT e.entry_number FROM journal_entry e WHERE e.entry_id = d.journal_entry_id)
         AS entry_number";

fn to_document(row: &sqlx::postgres::PgRow) -> Result<CashDocumentRow, AppError> {
    Ok(CashDocumentRow {
        document_id: row.try_get("document_id")?,
        kind: row.try_get("kind")?,
        number: row.try_get("number")?,
        doc_date: row.try_get("doc_date")?,
        from_key: row.try_get("from_key")?,
        from_qualifier: row.try_get("from_qualifier")?,
        from_account_code: row.try_get("from_account_code")?,
        from_category_code: row.try_get("from_category_code")?,
        from_unit: row.try_get("from_unit")?,
        to_key: row.try_get("to_key")?,
        to_qualifier: row.try_get("to_qualifier")?,
        to_account_code: row.try_get("to_account_code")?,
        to_category_code: row.try_get("to_category_code")?,
        to_unit: row.try_get("to_unit")?,
        amount_minor: row.try_get("amount_minor")?,
        currency: row.try_get("currency")?,
        party_type: row.try_get("party_type")?,
        supplier_id: row.try_get("supplier_id")?,
        employee_id: row.try_get("employee_id")?,
        party_name: row.try_get("party_name")?,
        memo: row.try_get("memo")?,
        attachment_file_id: row.try_get("attachment_file_id")?,
        statement_line_id: row.try_get("statement_line_id")?,
        status: row.try_get("status")?,
        journal_entry_id: row.try_get("journal_entry_id")?,
        entry_number: row.try_get("entry_number")?,
        reversal_entry_id: row.try_get("reversal_entry_id")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        approved_by: row.try_get("approved_by")?,
        approved_at: row.try_get("approved_at")?,
        posted_by: row.try_get("posted_by")?,
        posted_at: row.try_get("posted_at")?,
    })
}

pub async fn cash_document_list(
    pool: &PgPool,
    status: Option<&str>,
    kind: Option<&str>,
    unit_id: Option<&str>,
    limit: i64,
) -> Result<Vec<CashDocumentRow>, AppError> {
    let sql = format!(
        "SELECT {DOCUMENT_COLUMNS} FROM cash_document d
          WHERE ($1::text IS NULL OR d.status = $1)
            AND ($2::text IS NULL OR d.kind = $2)
            AND ($3::text IS NULL OR d.from_unit = $3 OR d.to_unit = $3)
          ORDER BY d.doc_date DESC, d.created_at DESC
          LIMIT $4"
    );
    let rows = sqlx::query(&sql)
        .bind(status)
        .bind(kind)
        .bind(unit_id)
        .bind(limit.clamp(1, 500))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_document).collect()
}

pub async fn cash_document_read(
    pool: &PgPool,
    document_id: Uuid,
) -> Result<CashDocumentRow, AppError> {
    let sql = format!("SELECT {DOCUMENT_COLUMNS} FROM cash_document d WHERE d.document_id = $1");
    let row = sqlx::query(&sql)
        .bind(document_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("cash document".into()))?;
    to_document(&row)
}

// ---------------------------------------------------------------------------
// Making sense of a side
// ---------------------------------------------------------------------------

/// Which money meaning carries this account in this unit's books, if any.
///
/// Asked of an account code a person chose, because the direction rule reads
/// meanings and a person who types the BCA giro's own code would otherwise
/// produce a "payment" out of the bank into the bank. Two meanings on one
/// account in one unit is a mistake on the Account Links and is refused
/// rather than guessed at — the same refusal `banking::statement_meaning`
/// makes, for the same reason.
async fn money_meaning_of(
    executor: impl sqlx::PgExecutor<'_>,
    account_code: &str,
    unit_id: &str,
) -> Result<Option<String>, AppError> {
    let rows = sqlx::query(
        "SELECT role AS semantic_key FROM account_resolution
          WHERE account_code = $1 AND unit_id = $2 AND role = ANY($3)",
    )
    .bind(account_code)
    .bind(unit_id)
    .bind(&MONEY_MEANINGS[..])
    .fetch_all(executor)
    .await?;
    match rows.len() {
        0 => Ok(None),
        _ => Ok(Some(rows[0].try_get("semantic_key")?)),
    }
}

async fn resolve_side(
    pool: &PgPool,
    side: &CashSide,
    which: &str,
) -> Result<ResolvedSide, AppError> {
    let key = side
        .semantic_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let code = side
        .account_code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let unit = side.unit_id.trim();
    if unit.is_empty() {
        return Err(AppError::Validation(format!(
            "the {which} side needs a unit; every posting is in somebody's books"
        )));
    }

    let named_category = side
        .category_code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    match (key, code) {
        (Some(key), None) => {
            if let Some(named) = named_category {
                return Err(AppError::Validation(format!(
                    "the {which} side names the meaning '{key}' and the category {named}; the \
                     Account Links already chose a category for that meaning here, and a second \
                     answer could only disagree with it. Send the meaning, or send an account \
                     code and a category."
                )));
            }
            let resolved = resolve_account(pool, key, unit, side.qualifier.trim()).await?;
            assert_postable(pool, &resolved.account_code, Intent::Post).await?;
            Ok(ResolvedSide {
                key: Some(key.to_string()),
                qualifier: side.qualifier.trim().to_string(),
                account_code: None,
                category_code: resolved.category_code,
                unit_id: unit.to_string(),
                money: holds_money(key),
                resolved_code: resolved.account_code,
            })
        }
        (None, Some(code)) => {
            assert_postable(pool, code, Intent::Post).await?;
            // Checked here and not left to the poster, for the reason the
            // refusal above is checked here: the person keying the document is
            // still on the screen, and a category refused at approval time
            // names a choice somebody else made days ago.
            assert_category_for_account(pool, code, named_category, Intent::Post).await?;
            // A person who names a bank account by its code is describing a
            // transfer, and the document would call it a payment. Refused, and
            // the refusal says which word to use instead — the alternative is a
            // slip headed BUKTI KAS KELUAR over an entry that only moved money
            // between two of our own pots.
            if let Some(meaning) = money_meaning_of(pool, code, unit).await? {
                return Err(AppError::Validation(format!(
                    "{code} is this unit's '{meaning}' account; name the meaning on the \
                     {which} side rather than the code, so the document knows it is moving \
                     money between two accounts we hold"
                )));
            }
            Ok(ResolvedSide {
                key: None,
                qualifier: String::new(),
                account_code: Some(code.to_string()),
                category_code: named_category.map(str::to_string),
                unit_id: unit.to_string(),
                money: false,
                resolved_code: code.to_string(),
            })
        }
        (Some(_), Some(_)) => Err(AppError::Validation(format!(
            "the {which} side names both a meaning and an account code; it is one or the other"
        ))),
        (None, None) => Err(AppError::Validation(format!(
            "the {which} side names no account"
        ))),
    }
}

/// A side named by meaning, once its code is known.
///
/// Separate from [`resolve_side`] because the bank-line path already holds an
/// open transaction and has to resolve through it: reading `account_resolution` on the
/// pool while a transaction is open would work, and would also be the kind of
/// thing that stops working the day one of those rows is written inside the
/// same transaction.
pub(super) fn side_from_meaning(
    semantic_key: &str,
    qualifier: &str,
    unit_id: &str,
    resolved_code: String,
    category_code: Option<String>,
) -> ResolvedSide {
    ResolvedSide {
        key: Some(semantic_key.to_string()),
        qualifier: qualifier.to_string(),
        account_code: None,
        category_code,
        unit_id: unit_id.to_string(),
        money: holds_money(semantic_key),
        resolved_code,
    }
}

/// A side named by a client account code a person chose, and the category they
/// chose with it.
///
/// The two travel together for the same reason `ledger::Resolved` carries both:
/// with forty accounts the code alone does not say what the line is about, and
/// a caller free to pass one without the other is a caller free to build a line
/// the ledger will refuse.
pub(super) fn side_from_account(
    account_code: &str,
    unit_id: &str,
    category_code: Option<String>,
) -> ResolvedSide {
    ResolvedSide {
        key: None,
        qualifier: String::new(),
        account_code: Some(account_code.to_string()),
        category_code,
        unit_id: unit_id.to_string(),
        money: false,
        resolved_code: account_code.to_string(),
    }
}

/// Everything a document needs before it can be written down.
#[derive(Clone, Debug)]
pub(super) struct CashDraft {
    pub doc_date: NaiveDate,
    pub from: ResolvedSide,
    pub to: ResolvedSide,
    pub direction: CashDirection,
    pub amount_minor: i64,
    pub party_type: String,
    pub supplier_id: Option<String>,
    pub employee_id: Option<String>,
    pub party_name: String,
    pub memo: String,
    pub attachment_file_id: Option<Uuid>,
    pub statement_line_id: Option<Uuid>,
}

/// Bills this supplier still owes on, if any.
///
/// Counted the way `payables` counts them, over posted bills and posted
/// payments, so the two screens cannot disagree about who is owed what.
async fn open_bills_for(
    executor: impl sqlx::PgExecutor<'_>,
    supplier_id: &str,
) -> Result<(i64, i64), AppError> {
    let row = sqlx::query(
        "SELECT COUNT(*)::bigint AS bills, COALESCE(SUM(owed), 0)::bigint AS owed FROM (
             SELECT i.total_minor - COALESCE((
                        SELECT SUM(al.amount_minor)
                          FROM supplier_payment_allocation al
                          JOIN supplier_payment p USING (payment_id)
                         WHERE al.invoice_id = i.invoice_id AND p.status = 'POSTED'), 0) AS owed
               FROM supplier_invoice i
              WHERE i.supplier_id = $1 AND i.status = 'POSTED'
         ) still WHERE owed > 0",
    )
    .bind(supplier_id)
    .fetch_one(executor)
    .await?;
    Ok((row.try_get("bills")?, row.try_get("owed")?))
}

/// Check a request and turn it into something writable.
pub(super) async fn cash_draft_from(
    pool: &PgPool,
    request: &RecordCashDocumentRequest,
) -> Result<CashDraft, AppError> {
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "a cash document moves a positive amount; the direction is which account is which, \
             not the sign"
                .into(),
        ));
    }
    let memo = request.memo.trim();
    if memo.is_empty() {
        return Err(AppError::Validation(
            "a cash document needs a note saying what the money was for; it is the line the \
             slip prints and the only record of why"
                .into(),
        ));
    }
    let party_name = request.party_name.trim();
    if party_name.is_empty() {
        return Err(AppError::Validation(
            "a cash document names who the money is for or from; the slip has a line for it".into(),
        ));
    }

    let from = resolve_side(pool, &request.from, "from").await?;
    let to = resolve_side(pool, &request.to, "to").await?;
    if from.resolved_code == to.resolved_code && from.unit_id == to.unit_id {
        return Err(AppError::Validation(format!(
            "both sides resolve to {} in the books of {}; money cannot arrive where it left from",
            from.resolved_code, from.unit_id
        )));
    }

    let direction = cash_direction(from.money, to.money).ok_or_else(|| {
        AppError::Validation(format!(
            "neither {} nor {} holds money, so this is not a cash document; one side must be \
             one of {}. Two accounts that hold no money is a reclassification, and that belongs \
             in the journal where somebody has to justify it",
            from.resolved_code,
            to.resolved_code,
            MONEY_MEANINGS.join(", ")
        ))
    })?;

    let party_type = request
        .party_type
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_uppercase)
        .unwrap_or_else(|| "OTHER".to_string());
    let supplier_id = request
        .supplier_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let employee_id = request
        .employee_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    match party_type.as_str() {
        "SUPPLIER" => {
            let id = supplier_id.as_deref().ok_or_else(|| {
                AppError::Validation("a supplier document must say which supplier".into())
            })?;
            // The refusal this lane exists to make. Paying a supplier from here
            // would post perfectly and answer no debt, and the ageing would
            // then show somebody who has been paid and still owes everything.
            let (bills, owed) = open_bills_for(pool, id).await?;
            if bills > 0 {
                return Err(AppError::Validation(format!(
                    "{party_name} has {bills} bill{} still open, totalling {owed}; pay them on \
                     Payables so the money answers the debt, not here",
                    if bills == 1 { "" } else { "s" }
                )));
            }
        }
        "EMPLOYEE" => {
            if employee_id.is_none() {
                return Err(AppError::Validation(
                    "an employee document must say which employee".into(),
                ));
            }
        }
        "OTHER" => {}
        other => {
            return Err(AppError::Validation(format!(
                "'{other}' is not a party; expected SUPPLIER, EMPLOYEE or OTHER"
            )))
        }
    }

    // Cleared rather than carried, so what the table's CHECK insists on — a
    // supplier id exactly when the party is a supplier — is already true here
    // and the refusal comes from this function rather than from a constraint.
    let supplier_id = supplier_id.filter(|_| party_type == "SUPPLIER");
    let employee_id = employee_id.filter(|_| party_type == "EMPLOYEE");

    Ok(CashDraft {
        doc_date: request.doc_date,
        from,
        to,
        direction,
        amount_minor: request.amount_minor,
        party_type,
        supplier_id,
        employee_id,
        party_name: party_name.to_string(),
        memo: memo.to_string(),
        attachment_file_id: request.attachment_file_id,
        statement_line_id: None,
    })
}

/// Write the draft. Nothing is numbered and nothing is in the books yet.
pub(super) async fn cash_document_insert(
    tx: &mut Transaction<'_, Postgres>,
    draft: &CashDraft,
    actor: &str,
) -> Result<Uuid, AppError> {
    let document_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO cash_document
           (document_id, kind, doc_date,
            from_key, from_qualifier, from_account_code, from_category_code, from_unit,
            to_key, to_qualifier, to_account_code, to_category_code, to_unit,
            amount_minor, currency, party_type, supplier_id, employee_id, party_name,
            memo, attachment_file_id, statement_line_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'IDR',
                 $15,$16,$17,$18,$19,$20,$21,$22)",
    )
    .bind(document_id)
    .bind(draft.direction.kind())
    .bind(draft.doc_date)
    .bind(draft.from.key.as_deref())
    .bind(&draft.from.qualifier)
    .bind(draft.from.account_code.as_deref())
    .bind(draft.from.category_code.as_deref())
    .bind(&draft.from.unit_id)
    .bind(draft.to.key.as_deref())
    .bind(&draft.to.qualifier)
    .bind(draft.to.account_code.as_deref())
    .bind(draft.to.category_code.as_deref())
    .bind(&draft.to.unit_id)
    .bind(draft.amount_minor)
    .bind(&draft.party_type)
    .bind(draft.supplier_id.as_deref())
    .bind(draft.employee_id.as_deref())
    .bind(&draft.party_name)
    .bind(&draft.memo)
    .bind(draft.attachment_file_id)
    .bind(draft.statement_line_id)
    .bind(actor)
    .execute(&mut **tx)
    .await?;
    Ok(document_id)
}

pub async fn cash_document_record(
    pool: &PgPool,
    request: &RecordCashDocumentRequest,
    actor: &str,
) -> Result<CashDocumentRow, AppError> {
    let draft = cash_draft_from(pool, request).await?;
    let mut tx = pool.begin().await?;
    let document_id = cash_document_insert(&mut tx, &draft, actor).await?;
    tx.commit().await?;
    cash_document_read(pool, document_id).await
}

// ---------------------------------------------------------------------------
// Approval, which is where the number comes from
// ---------------------------------------------------------------------------

/// Take the next number for one kind in one month.
///
/// `INSERT ... ON CONFLICT DO UPDATE` rather than a read then a write: the row
/// is locked by the update itself, so two approvals in the same second cannot
/// both read 41. A Postgres sequence would be simpler and wrong — it is global,
/// and the client's number carries the month.
async fn next_number(
    tx: &mut Transaction<'_, Postgres>,
    direction: CashDirection,
    doc_date: NaiveDate,
) -> Result<String, AppError> {
    let month = accounting_month(doc_date.year(), doc_date.month());
    let row = sqlx::query(
        "INSERT INTO cash_document_sequence (kind, yyyymm, last_no)
         VALUES ($1,$2,1)
         ON CONFLICT (kind, yyyymm)
         DO UPDATE SET last_no = cash_document_sequence.last_no + 1
         RETURNING last_no",
    )
    .bind(direction.kind())
    .bind(month)
    .fetch_one(&mut **tx)
    .await?;
    let sequence: i32 = row.try_get("last_no")?;
    Ok(cash_document_number(
        direction,
        doc_date.year(),
        doc_date.month(),
        i64::from(sequence),
    ))
}

pub(super) async fn cash_document_approve_in(
    tx: &mut Transaction<'_, Postgres>,
    document_id: Uuid,
    actor: &str,
) -> Result<String, AppError> {
    let row = sqlx::query(
        "SELECT kind, doc_date, status, number FROM cash_document
          WHERE document_id = $1 FOR UPDATE",
    )
    .bind(document_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("cash document".into()))?;
    let status: String = row.try_get("status")?;
    if status != "DRAFT" {
        let number: Option<String> = row.try_get("number")?;
        return Err(AppError::Conflict(format!(
            "cash document {} is {}, not waiting to be approved",
            number.unwrap_or_else(|| document_id.to_string()),
            status.to_lowercase()
        )));
    }
    let kind: String = row.try_get("kind")?;
    let doc_date: NaiveDate = row.try_get("doc_date")?;
    let direction = CashDirection::from_kind(&kind)
        .ok_or_else(|| AppError::Validation(format!("'{kind}' is not a cash document kind")))?;

    let number = next_number(tx, direction, doc_date).await?;
    sqlx::query(
        "UPDATE cash_document
            SET status='APPROVED', number=$2, approved_by=$3, approved_at=now()
          WHERE document_id=$1",
    )
    .bind(document_id)
    .bind(&number)
    .bind(actor)
    .execute(&mut **tx)
    .await?;
    Ok(number)
}

pub async fn cash_document_approve(
    pool: &PgPool,
    document_id: Uuid,
    actor: &str,
) -> Result<CashDocumentRow, AppError> {
    let mut tx = pool.begin().await?;
    cash_document_approve_in(&mut tx, document_id, actor).await?;
    tx.commit().await?;
    cash_document_read(pool, document_id).await
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn side_line(
    key: Option<&str>,
    qualifier: &str,
    account_code: Option<&str>,
    category_code: Option<&str>,
    unit_id: &str,
    debit: i64,
    credit: i64,
    memo: &str,
) -> PostingLine {
    let account = match (key, account_code) {
        // The map chooses the category for a meaning, so nothing is carried
        // here: the poster resolves the pair together and a category attached
        // to a meaning would be a second, staler answer.
        (Some(key), _) => LineAccount::Meaning {
            semantic_key: key.to_string(),
            qualifier: qualifier.to_string(),
            source_type: "COMPANY".into(),
        },
        // The person's, stored on the document when they keyed it.
        (None, Some(code)) => LineAccount::Account {
            account_code: code.to_string(),
            category_code: category_code.map(str::to_string),
        },
        // Unreachable: the table's CHECK refuses a side that names neither.
        (None, None) => LineAccount::Account {
            account_code: String::new(),
            category_code: None,
        },
    };
    PostingLine {
        dimensions: Vec::new(),
        account,
        unit_id: unit_id.to_string(),
        // A cash document names both of its own sides, so there is no
        // counterparty for the balancer to infer. When the two are different
        // units the balancer adds the affiliate legs, and names each other
        // unit on them itself.
        counter_unit_id: None,
        debit_minor: debit,
        credit_minor: credit,
        party_type: None,
        party_id: None,
        asset_id: None,
        bank_account_id: None,
        memo: Some(memo.to_string()),
    }
}

/// Debit where it went, credit where it came from. That is the whole entry.
///
/// The destination is line 1 and the source line 2, fixed, because
/// `book_bank_line` finds the bank leg again by line number and a rule that
/// depended on which side happened to be the bank would be a rule that breaks
/// the first time a transfer is booked.
pub(super) async fn cash_document_post_in(
    tx: &mut Transaction<'_, Postgres>,
    document_id: Uuid,
    posting_date: Option<NaiveDate>,
    actor: &str,
) -> Result<super::poster::Posted, AppError> {
    let row = sqlx::query(
        "SELECT kind, number, status, doc_date, amount_minor, currency, memo,
                party_name, party_type, supplier_id,
                from_key, from_qualifier, from_account_code, from_category_code, from_unit,
                to_key, to_qualifier, to_account_code, to_category_code, to_unit
           FROM cash_document WHERE document_id = $1 FOR UPDATE",
    )
    .bind(document_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("cash document".into()))?;

    let status: String = row.try_get("status")?;
    let number: Option<String> = row.try_get("number")?;
    let label = number.unwrap_or_else(|| document_id.to_string());
    if status != "APPROVED" {
        return Err(AppError::Conflict(match status.as_str() {
            "DRAFT" => format!(
                "cash document {label} has not been approved; approving it is what gives it a \
                 number, and a slip with no number cannot be filed"
            ),
            "POSTED" => format!("cash document {label} is already in the ledger"),
            _ => format!("cash document {label} is {}", status.to_lowercase()),
        }));
    }

    let amount: i64 = row.try_get("amount_minor")?;
    let currency: String = row.try_get("currency")?;
    let doc_date: NaiveDate = row.try_get("doc_date")?;
    let memo: String = row.try_get("memo")?;
    let party: String = row.try_get("party_name")?;

    let lines = vec![
        side_line(
            row.try_get::<Option<String>, _>("to_key")?.as_deref(),
            &row.try_get::<String, _>("to_qualifier")?,
            row.try_get::<Option<String>, _>("to_account_code")?
                .as_deref(),
            row.try_get::<Option<String>, _>("to_category_code")?
                .as_deref(),
            &row.try_get::<String, _>("to_unit")?,
            amount,
            0,
            &memo,
        ),
        side_line(
            row.try_get::<Option<String>, _>("from_key")?.as_deref(),
            &row.try_get::<String, _>("from_qualifier")?,
            row.try_get::<Option<String>, _>("from_account_code")?
                .as_deref(),
            row.try_get::<Option<String>, _>("from_category_code")?
                .as_deref(),
            &row.try_get::<String, _>("from_unit")?,
            0,
            amount,
            &memo,
        ),
    ];

    let intent = PostingIntent {
        posting_date: posting_date.unwrap_or(doc_date),
        source_kind: "CASH_DOC".into(),
        source_id: Some(document_id.to_string()),
        rule_version: "cash_document/1".into(),
        currency,
        memo: Some(format!("{label} {party} — {memo}")),
        lines,
    };
    // A cash document is approved once and posted once; a correction is a
    // reversal and a new document.
    let posted = post(tx, &intent, None, actor).await?;

    sqlx::query(
        "UPDATE cash_document
            SET status='POSTED', journal_entry_id=$2, posted_by=$3, posted_at=now()
          WHERE document_id=$1",
    )
    .bind(document_id)
    .bind(posted.entry_id)
    .bind(actor)
    .execute(&mut **tx)
    .await?;

    let party_type: String = row.try_get("party_type")?;
    let supplier_id: Option<String> = row.try_get("supplier_id")?;
    cash_document_settle_payment_ledger(
        tx,
        document_id,
        &party_type,
        supplier_id.as_deref(),
        // The side money went TO, which is the side the entry debited. A
        // document only settles a debt when that is where it landed.
        row.try_get::<Option<String>, _>("to_key")?.as_deref(),
        &row.try_get::<String, _>("to_qualifier")?,
        &row.try_get::<String, _>("to_unit")?,
        amount,
        intent.posting_date,
        posted.entry_id,
        actor,
    )
    .await?;

    Ok(posted)
}

/// The two meanings a cash document can land on that are somebody's debt.
///
/// Every other side of every other cash document moves money and owes nobody
/// anything: a transfer between two of our own banks, a deposit, a bank charge,
/// an expense paid on the spot. Money moving is not, on its own, a reason to be
/// in the Payment Ledger — 0143 has the argument — so the list is short on
/// purpose and everything not on it reaches the ledger and leaves without a
/// word.
const SETTLEABLE_KEYS: [&str; 2] = ["trade_payable", "non_merchandise_payable"];

/// Tell the Payment Ledger that this document answered a debt, when it did.
///
/// # Why this is a function and not a call site
///
/// The ledger architecture was frozen to three: General, Payment, Stock. The
/// Payment Ledger holds receivables and payables **that have a balance
/// outstanding** — and money moving is not, on its own, a reason to be in it.
/// A transfer between two of the company's own banks, a cash deposit, a monthly
/// bank charge: all of them move money and none of them is owed to anybody, so
/// none of them belongs there. Writing an entry for each would fill the ledger
/// that answers "who owes what" with rows that answer nothing, and the ageing
/// that reads it would be a list of movements.
///
/// So the call is here, on the one path where a document does settle something,
/// and the shape of the refusal is the point: everything else reaches this and
/// leaves without a word. A `Transfer` posted through [`cash_document_post_in`]
/// calls this and this does nothing, which is the behaviour
/// `cash_document_integration` asserts on.
///
/// # What makes a document a settlement
///
/// Two things, together, and neither alone. The party has to be a supplier, and
/// the side the money went TO has to be one of the payable meanings — because
/// that side is what the entry beside this DEBITED. A supplier document that
/// paid an expense account debits the expense and answers no debt; settling an
/// item for it would take a balance out of the sub-ledger that the books still
/// carry, which is the disagreement `payment_ledger_integrity` exists to
/// report. So the ledger moves exactly when, and by exactly what, the control
/// account moved.
///
/// The document names no bill, unlike everything in `payables_flow`, so what it
/// answers is the supplier's open items oldest first. That is the honest
/// reading of a slip that says only "PT Sinar Jaya, 5,000,000": somebody
/// paying a named invoice keys it on Payables, where the allocation is the
/// document. `cash_draft_from` says so in its own refusal.
#[allow(clippy::too_many_arguments)]
async fn cash_document_settle_payment_ledger(
    tx: &mut Transaction<'_, Postgres>,
    document_id: Uuid,
    party_type: &str,
    supplier_id: Option<&str>,
    to_key: Option<&str>,
    to_qualifier: &str,
    to_unit: &str,
    amount_minor: i64,
    posting_date: NaiveDate,
    journal_entry_id: Uuid,
    actor: &str,
) -> Result<(), AppError> {
    // A document that names no party settles no debt. This is the whole of the
    // rule for four documents out of five, and it is deliberately stated rather
    // than left implied.
    let (Some(supplier_id), "SUPPLIER") = (supplier_id, party_type) else {
        return Ok(());
    };
    let Some(key) = to_key.filter(|key| SETTLEABLE_KEYS.contains(key)) else {
        return Ok(());
    };
    super::payment_ledger::ple_settle_claim(
        tx,
        &super::payment_ledger::PaymentLedgerClaim {
            account_key: key,
            qualifier: to_qualifier,
            unit_id: to_unit,
            party_type: super::payment_ledger::PaymentLedgerPartyType::Supplier,
            party_id: supplier_id,
            // No bill: see the note above. A slip that names one is keyed on
            // Payables, where the allocation is part of the document.
            voucher_kind: None,
            voucher_id: None,
        },
        "CASH_DOC",
        &document_id.to_string(),
        journal_entry_id,
        posting_date,
        amount_minor,
        actor,
    )
    .await?;
    Ok(())
}

pub async fn cash_document_post(
    pool: &PgPool,
    document_id: Uuid,
    posting_date: Option<NaiveDate>,
    actor: &str,
) -> Result<CashDocumentRow, AppError> {
    let mut tx = pool.begin().await?;
    cash_document_post_in(&mut tx, document_id, posting_date, actor).await?;
    tx.commit().await?;
    cash_document_read(pool, document_id).await
}

/// Undo a posted document by writing its mirror. The original stays as posted.
pub async fn cash_document_reverse(
    pool: &PgPool,
    document_id: Uuid,
    posting_date: Option<NaiveDate>,
    reason: &str,
    actor: &str,
) -> Result<CashDocumentRow, AppError> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "a reversal needs a reason; it is the only record of why".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "SELECT status, number, journal_entry_id, doc_date FROM cash_document
          WHERE document_id = $1 FOR UPDATE",
    )
    .bind(document_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("cash document".into()))?;
    let status: String = row.try_get("status")?;
    let number: Option<String> = row.try_get("number")?;
    let label = number.unwrap_or_else(|| document_id.to_string());
    if status != "POSTED" {
        return Err(AppError::Conflict(format!(
            "cash document {label} is {}; only a posted document can be reversed",
            status.to_lowercase()
        )));
    }
    let entry_id: Uuid = row.try_get("journal_entry_id")?;
    let doc_date: NaiveDate = row.try_get("doc_date")?;
    let mirror = reverse(
        &mut tx,
        entry_id,
        posting_date.unwrap_or(doc_date),
        reason,
        actor,
    )
    .await?;
    sqlx::query(
        "UPDATE cash_document SET status='REVERSED', reversal_entry_id=$2 WHERE document_id=$1",
    )
    .bind(document_id)
    .bind(mirror.entry_id)
    .execute(&mut *tx)
    .await?;
    // The mirror credits back whatever this document debited, so a payable it
    // had answered is open again. Nothing happens for the four documents in
    // five that settled nothing — there is no allocation to take out.
    super::payment_ledger::ple_delink(
        &mut tx,
        "CASH_DOC",
        &document_id.to_string(),
        &format!("cash document {label} was reversed: {reason}"),
        actor,
    )
    .await?;
    tx.commit().await?;
    cash_document_read(pool, document_id).await
}

// ---------------------------------------------------------------------------
// The slip
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SlipAccount {
    pub account_code: String,
    /// The client's own name for it, untranslated: an accountant looks for
    /// "Cash In Bank Giro Bank BCA HO" and anything else is a different account
    /// as far as they are concerned.
    pub account_name: String,
    /// What kind of thing it is, where the account is kept by kind, and the
    /// client's own word for that kind.
    ///
    /// Printed because the slip has to be readable as paper: with forty
    /// accounts, "6301 Beban Umum & Administrasi" is what every general
    /// expense says, and the person filing it needs to see "Listrik" beside it
    /// to know which slip they are holding.
    pub category_code: Option<String>,
    pub category_name: Option<String>,
    /// Whose books this side is in.
    pub unit_id: String,
}

/// Everything printed on one piece of paper.
///
/// Assembled on the server rather than left to the browser, because the amount
/// in words, the account names and the title are all derived from things a
/// screen would otherwise have to re-derive — and a slip whose words disagreed
/// with its figures would be worse than one with no words at all.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CashDocumentSlip {
    /// The three lines at the top of the page.
    pub company_name: String,
    pub company_address: String,
    pub company_phone: String,

    /// `BUKTI KAS KELUAR`, `BUKTI KAS MASUK` or `BUKTI TRANSFER`.
    pub title: String,
    pub number: Option<String>,
    pub doc_date: NaiveDate,

    pub from: SlipAccount,
    pub to: SlipAccount,

    pub amount_minor: i64,
    /// "Dua juta lima ratus ribu rupiah".
    pub amount_in_words: String,
    pub party_name: String,
    pub memo: String,
    pub status: String,

    /// Dibuat oleh. Filled by the system.
    pub prepared_by: String,
    /// Diperiksa oleh. Never filled by the system — it is a wet signature, and
    /// printing a name against it would be the system claiming somebody checked
    /// something they have not seen.
    pub checked_by: Option<String>,
    /// Disetujui oleh.
    pub approved_by: Option<String>,
}

async fn account_name_of(pool: &PgPool, code: &str) -> Result<String, AppError> {
    let row = sqlx::query("SELECT name FROM ledger_account WHERE account_code = $1")
        .bind(code)
        .fetch_optional(pool)
        .await?;
    Ok(row
        .map(|row| row.try_get::<String, _>("name"))
        .transpose()?
        .unwrap_or_else(|| code.to_string()))
}

/// The client's word for a category, or the code itself when the row is gone.
///
/// Falls back rather than refusing, exactly as `account_name_of` does: a slip
/// is a reprint of something that already posted, and a category retired since
/// then must still print the paper it is on.
async fn category_name_of(pool: &PgPool, code: &str) -> Result<String, AppError> {
    let row = sqlx::query("SELECT name FROM line_category WHERE category_code = $1")
        .bind(code)
        .fetch_optional(pool)
        .await?;
    Ok(row
        .map(|row| row.try_get::<String, _>("name"))
        .transpose()?
        .unwrap_or_else(|| code.to_string()))
}

async fn slip_side(
    pool: &PgPool,
    key: Option<&str>,
    qualifier: &str,
    account_code: Option<&str>,
    category_code: Option<&str>,
    unit_id: &str,
) -> Result<SlipAccount, AppError> {
    // Resolved through the map on every read rather than remembered, so the
    // slip follows a remapping instead of printing where the account used to
    // be. The category comes back with the account for the meaning side, and
    // off the document for the side a person coded — the same split the
    // posting makes, so the paper and the entry cannot say different things.
    let (code, category) = match (key, account_code) {
        (Some(key), _) => {
            let resolved = resolve_account(pool, key, unit_id, qualifier).await?;
            (resolved.account_code, resolved.category_code)
        }
        (None, Some(code)) => (code.to_string(), category_code.map(str::to_string)),
        (None, None) => (String::new(), None),
    };
    let account_name = account_name_of(pool, &code).await?;
    let category_name = match &category {
        Some(category) => Some(category_name_of(pool, category).await?),
        None => None,
    };
    Ok(SlipAccount {
        account_code: code,
        account_name,
        category_code: category,
        category_name,
        unit_id: unit_id.to_string(),
    })
}

pub async fn cash_document_slip(
    pool: &PgPool,
    document_id: Uuid,
) -> Result<CashDocumentSlip, AppError> {
    let document = cash_document_read(pool, document_id).await?;
    let direction = CashDirection::from_kind(&document.kind).ok_or_else(|| {
        AppError::Validation(format!("'{}' is not a cash document kind", document.kind))
    })?;

    let letterhead = sqlx::query(
        "SELECT name, address, phone FROM company_letterhead WHERE only_row ORDER BY only_row",
    )
    .fetch_optional(pool)
    .await?;
    let (company_name, company_address, company_phone) = match letterhead {
        Some(row) => (
            row.try_get::<String, _>("name")?,
            row.try_get::<String, _>("address")?,
            row.try_get::<String, _>("phone")?,
        ),
        None => (String::new(), String::new(), String::new()),
    };

    let from = slip_side(
        pool,
        document.from_key.as_deref(),
        &document.from_qualifier,
        document.from_account_code.as_deref(),
        document.from_category_code.as_deref(),
        &document.from_unit,
    )
    .await?;
    let to = slip_side(
        pool,
        document.to_key.as_deref(),
        &document.to_qualifier,
        document.to_account_code.as_deref(),
        document.to_category_code.as_deref(),
        &document.to_unit,
    )
    .await?;

    Ok(CashDocumentSlip {
        company_name,
        company_address,
        company_phone,
        title: direction.slip_title().to_string(),
        number: document.number,
        doc_date: document.doc_date,
        from,
        to,
        amount_minor: document.amount_minor,
        amount_in_words: rupiah_in_words(document.amount_minor),
        party_name: document.party_name,
        memo: document.memo,
        status: document.status,
        prepared_by: document.created_by,
        checked_by: None,
        approved_by: document.approved_by,
    })
}
