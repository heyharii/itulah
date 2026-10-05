//! The one call anything in this lane makes to move money.
//!
//! # There is one money-execution layer and this is not it
//!
//! PAY, RECEIVE and TRANSFER are `cash_document` (migration 0115), and every
//! payment in this system is one of those three. A batch does not post. A
//! payroll run does not post. There is no supplier payment engine and no
//! payroll payment engine. What a pattern does is decide what the document
//! should say; what this function does is hand that to the execution layer and
//! give back the document's id.
//!
//! Keeping it to one function is the point. If executing a batch item were
//! twenty lines of posting inline in `batches.rs`, then the second pattern
//! would copy them, the third would diverge, and there would be three payment
//! engines inside a codebase whose architecture says there is one.
//!
//! # This file is a bridge, and it is meant to be deleted
//!
//! `cash_document` lands in a sibling lane. Until the two are in one tree, the
//! Rust module that owns it — `postgres::cash`, with `cash_draft_from`,
//! `cash_document_insert`, `cash_document_approve_in` and
//! `cash_document_post_in` — cannot be called from here, so what follows writes
//! the same three steps against the same tables through SQL. It produces
//! documents that are indistinguishable from the ones that module produces:
//! same number sequence, same `source_kind`, same `rule_version`, same two
//! lines through the same poster.
//!
//! When the lanes meet, the body of [`payment_execution_pay`] becomes four
//! lines and this comment goes with it:
//!
//! ```text
//! let draft = cash::cash_draft_from(pool, &request).await?;
//! let id = cash::cash_document_insert(tx, &draft, actor).await?;
//! cash::cash_document_approve_in(tx, id, actor).await?;
//! cash::cash_document_post_in(tx, id, None, actor).await?;
//! ```
//!
//! One thing must be carried across when that happens, and it is written here
//! so it is not lost: `cash_draft_from` refuses a supplier who has open bills
//! and sends the caller to Payables, which is right for somebody keying a slip
//! by hand and wrong for a batch item, whose whole purpose is to answer those
//! bills. The batch path must go through `cash_document_insert` with a draft it
//! built itself, not through `cash_draft_from`.
//!
//! # Why the absence is detected at runtime rather than refused at compile time
//!
//! Because the alternative is this lane not compiling until another lane lands,
//! and a lane that cannot be built cannot be tested. `to_regclass` answers in
//! microseconds and the refusal names the migration, so a node without the
//! money layer says so in a sentence instead of failing on a missing relation.

use super::poster::{post, LineAccount, PostingIntent, PostingLine};
use crate::cloud::application::AppError;
use chrono::NaiveDate;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

/// The meanings that carry money in a unit's books.
///
/// A copy of what `domain::MONEY_MEANINGS` will hold when the cash lane lands;
/// the names come from `ledger::required_semantic_keys`, which is the authority
/// in this tree. Kept private and named differently so the two cannot collide
/// in the glob re-export, and so replacing it is a deletion rather than a
/// merge.
const MONEY_AT_A_LOCATION: [&str; 5] = [
    "cash",
    "petty_cash",
    "cashier_float",
    "bank_savings",
    "bank_giro",
];

fn holds_money(semantic_key: &str) -> bool {
    MONEY_AT_A_LOCATION.contains(&semantic_key)
}

/// What one payment says, before it is a document.
///
/// Deliberately not "a batch item": a single payment, a giro payment and a
/// batch item all reduce to this, which is what makes them one execution layer
/// rather than three.
#[derive(Clone, Debug)]
pub(super) struct PayInstruction {
    pub doc_date: NaiveDate,
    /// The company money account the payment leaves from, named by meaning.
    pub from_key: String,
    pub from_qualifier: String,
    /// Whose books the money leaves (0608: a cash document names units). The
    /// document's two sides are the same unit: a payment, not a transfer.
    pub unit_id: String,
    /// What the money answers. A meaning, or an account code somebody chose.
    pub counter_key: Option<String>,
    pub counter_qualifier: String,
    pub counter_account_code: Option<String>,
    /// What kind of thing it answers, when the counter is an account somebody
    /// chose rather than a meaning. On a meaning the map chooses it, so this
    /// stays empty and nothing here has to decide which of the two won.
    pub counter_category_code: Option<String>,
    pub amount_minor: i64,
    /// `SUPPLIER`, `EMPLOYEE` or `OTHER`.
    pub party_type: String,
    pub supplier_id: Option<String>,
    pub employee_id: Option<String>,
    pub party_name: String,
    pub memo: String,
}

/// Whether the money-execution layer is in this database at all.
async fn money_layer_present(tx: &mut Transaction<'_, Postgres>) -> Result<bool, AppError> {
    let present: Option<String> =
        sqlx::query_scalar("SELECT to_regclass('public.cash_document')::text")
            .fetch_one(&mut **tx)
            .await?;
    Ok(present.is_some())
}

/// Turn one instruction into one ordinary PAY, posted.
///
/// Returns the cash document's id, which is the only thing the caller keeps.
/// Everything else about the document — its number, its entry, its slip — is
/// the execution layer's, and a batch that held copies of them would be a
/// second record of the same payment.
pub(super) async fn payment_execution_pay(
    tx: &mut Transaction<'_, Postgres>,
    instruction: &PayInstruction,
    actor: &str,
) -> Result<Uuid, AppError> {
    if instruction.amount_minor <= 0 {
        return Err(AppError::Validation(
            "a payment moves a positive amount; the direction is which account is which, not \
             the sign"
                .into(),
        ));
    }
    if !holds_money(&instruction.from_key) {
        return Err(AppError::Validation(format!(
            "'{}' is not an account money sits in, so a payment cannot leave from it. Expected \
             one of {}",
            instruction.from_key,
            MONEY_AT_A_LOCATION.join(", ")
        )));
    }
    // Decided before anything is written, so a payment that names no counter
    // fails without leaving half a document behind for the rollback to tidy up.
    let counter = match (
        instruction.counter_key.as_deref(),
        instruction.counter_account_code.as_deref(),
    ) {
        (Some(key), None) => LineAccount::Meaning {
            semantic_key: key.to_string(),
            qualifier: instruction.counter_qualifier.clone(),
            source_type: "COMPANY".into(),
        },
        (None, Some(code)) => LineAccount::Account {
            account_code: code.to_string(),
            category_code: instruction.counter_category_code.clone(),
        },
        (Some(_), Some(_)) => {
            return Err(AppError::Validation(
                "a payment answers a meaning or an account code, not both".into(),
            ))
        }
        (None, None) => {
            return Err(AppError::Validation(
                "a payment has to say what it answers: a meaning like trade_payable, or an \
                 account somebody chose"
                    .into(),
            ))
        }
    };
    // Cleared rather than carried, so what the table's CHECK insists on — a
    // supplier id exactly when the party is a supplier — is already true here
    // and the refusal, if there is one, comes from this function.
    let supplier_id = instruction
        .supplier_id
        .as_deref()
        .filter(|_| instruction.party_type == "SUPPLIER");
    let employee_id = instruction
        .employee_id
        .as_deref()
        .filter(|_| instruction.party_type == "EMPLOYEE");
    if instruction.party_type == "SUPPLIER" && supplier_id.is_none() {
        return Err(AppError::Validation(
            "a payment to a supplier has to say which supplier".into(),
        ));
    }
    if instruction.party_type == "EMPLOYEE" && employee_id.is_none() {
        return Err(AppError::Validation(
            "a payment to an employee has to say which employee".into(),
        ));
    }

    if !money_layer_present(tx).await? {
        return Err(AppError::Configuration(
            "this node has no cash documents, so nothing can be paid from here. The money \
             execution layer is migration 0115; until it is applied there is no PAY, RECEIVE or \
             TRANSFER for a payment to be"
                .into(),
        ));
    }

    let document_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO cash_document
           (document_id, kind, doc_date,
            from_key, from_qualifier, from_account_code, from_category_code, from_unit,
            to_key, to_qualifier, to_account_code, to_category_code, to_unit,
            amount_minor, currency, party_type, supplier_id, employee_id, party_name,
            memo, created_by)
         VALUES ($1,'PAY',$2,$3,$4,NULL,NULL,$5,$6,$7,$8,$9,$5,$10,'IDR',
                 $11,$12,$13,$14,$15,$16)",
    )
    .bind(document_id)
    .bind(instruction.doc_date)
    .bind(&instruction.from_key)
    .bind(&instruction.from_qualifier)
    .bind(&instruction.unit_id)
    .bind(instruction.counter_key.as_deref())
    .bind(&instruction.counter_qualifier)
    .bind(instruction.counter_account_code.as_deref())
    .bind(instruction.counter_category_code.as_deref())
    .bind(instruction.amount_minor)
    .bind(&instruction.party_type)
    .bind(supplier_id)
    .bind(employee_id)
    .bind(&instruction.party_name)
    .bind(&instruction.memo)
    .bind(actor)
    .execute(&mut **tx)
    .await?;

    // The number, from the same series a hand-keyed PAY is numbered by (0701):
    // a payment is Kas Keluar whichever pattern asked for it, in the paying
    // unit's books. The counter's upsert holds its row lock for this
    // transaction, so two payments in the same second cannot both read 41.
    let number = super::number_series::next_number(
        &mut **tx,
        super::number_series::CASH_OUT,
        instruction.doc_date,
        Some(&instruction.unit_id),
    )
    .await?;
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

    // Debit what the money answered, credit where it came from. Destination
    // first and source second, in that order, because `book_bank_line` finds
    // the money leg again by line number.
    let intent = PostingIntent {
        posting_date: instruction.doc_date,
        source_kind: "CASH_DOC".into(),
        source_id: Some(document_id.to_string()),
        rule_version: "cash_document/1".into(),
        currency: "IDR".into(),
        memo: Some(format!(
            "{number} {} — {}",
            instruction.party_name, instruction.memo
        )),
        lines: vec![
            PostingLine {
                dimensions: Vec::new(),
                account: counter,
                unit_id: instruction.unit_id.clone(),
                counter_unit_id: None,
                debit_minor: instruction.amount_minor,
                credit_minor: 0,
                party_type: Some("SUPPLIER".to_string()),
                party_id: supplier_id.map(str::to_string),
                asset_id: None,
                bank_account_id: None,
                memo: Some(instruction.memo.clone()),
            },
            PostingLine {
                dimensions: Vec::new(),
                account: LineAccount::Meaning {
                    semantic_key: instruction.from_key.clone(),
                    qualifier: instruction.from_qualifier.clone(),
                    source_type: "COMPANY".into(),
                },
                unit_id: instruction.unit_id.clone(),
                counter_unit_id: None,
                debit_minor: 0,
                credit_minor: instruction.amount_minor,
                party_type: None,
                party_id: None,
                asset_id: None,
                bank_account_id: None,
                memo: Some(instruction.memo.clone()),
            },
        ],
    };
    // The same document `cash.rs` posts, from the other door: one cash document,
    // one entry, one step.
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

    Ok(document_id)
}

/// The number of a document this lane produced, read back for a screen.
///
/// Tolerates the table's absence rather than propagating the error, so a build
/// without the money layer shows the batch with its documents unnamed instead
/// of failing the whole read. The `.ok()` is the tolerance: `cash_document` is
/// another lane's table and a missing relation is a fact about the build, not
/// about this row.
pub(super) async fn payment_execution_document_number(
    executor: impl sqlx::PgExecutor<'_>,
    document_id: Uuid,
) -> Result<Option<String>, AppError> {
    let row = sqlx::query("SELECT d.number FROM cash_document d WHERE d.document_id = $1")
        .bind(document_id)
        .fetch_optional(executor)
        .await
        .ok()
        .flatten();
    match row {
        Some(row) => Ok(row.try_get("number")?),
        None => Ok(None),
    }
}
