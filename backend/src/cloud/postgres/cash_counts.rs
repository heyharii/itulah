//! Counting a drawer, and putting the difference in the books.
//!
//! The cash half of reconciliation. A bank account is checked against a
//! statement the bank sent; a drawer has no statement, so it is checked against
//! a person who counted it. That is the whole reason this module is not shaped
//! like `banking`: there are no lines to match, only one figure to explain.
//!
//! # What this module will not do
//!
//! It never names a client account code of its own. The drawer's code arrives
//! from the caller because that is how every money screen addresses a place,
//! and it is resolved BACK to a meaning before anything is posted — so a count
//! on an account nobody mapped is refused, by name, exactly as a bank line
//! booked against an unmapped account is. The other leg is the meaning
//! `cash_variance`, and until somebody points it at an account on the Account
//! Map screen, posting a difference refuses and says so. A count itself is
//! still recorded: observing a shortage does not depend on knowing where to
//! book it.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::cloud::postgres::poster::{post, PostingIntent, PostingLine};
use crate::cloud::AppError;

/// The meanings a drawer can carry. A bank account is not countable by hand,
/// which is why this list is not `MONEY_KEYS`.
const CASH_MEANINGS: [&str; 3] = ["cash", "petty_cash", "cashier_float"];

/// Where a difference goes when it is posted.
const VARIANCE_MEANING: &str = "cash_variance";

/// One count, with what it found and what the books said.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CashCountRow {
    pub count_id: Uuid,
    pub account_code: String,
    pub account_name: String,
    pub site_id: String,
    pub counted_on: NaiveDate,
    pub counted_by: String,
    pub witnessed_by: String,
    pub counted_minor: i64,
    pub per_books_minor: i64,
    /// Counted less books. Positive is money the books did not know about;
    /// negative is money that should be there and is not. Computed on read —
    /// see the note in 0216 on why it is not a column.
    pub variance_minor: i64,
    pub reason: String,
    /// Set once the difference has been put in the books.
    pub entry_id: Option<Uuid>,
    pub entry_number: Option<String>,
    pub created_at: DateTime<Utc>,
    pub notes: Vec<CashCountNote>,
}

/// How many of one denomination were in the drawer.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CashCountNote {
    pub denomination_minor: i64,
    pub quantity: i32,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordCountRequest {
    pub account_code: String,
    pub site_id: String,
    pub counted_on: NaiveDate,
    pub counted_by: String,
    #[serde(default)]
    pub witnessed_by: String,
    /// What the drawer held. Required even when a breakdown is given — the
    /// breakdown is a working, and a working that disagrees with the answer is
    /// refused by the database rather than quietly summed over.
    pub counted_minor: i64,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub notes: Vec<CashCountNote>,
}

/// Every count, newest first, optionally for one drawer.
pub async fn list_counts(
    pool: &PgPool,
    account_code: Option<&str>,
    site_id: Option<&str>,
) -> Result<Vec<CashCountRow>, AppError> {
    let rows = sqlx::query(
        "SELECT c.count_id, c.account_code, a.name AS account_name, c.site_id,
                c.counted_on, c.counted_by, c.witnessed_by, c.counted_minor,
                c.per_books_minor, c.reason, c.entry_id, c.created_at,
                e.entry_number
           FROM cash_count c
           JOIN ledger_account a ON a.account_code = c.account_code
           LEFT JOIN journal_entry e ON e.entry_id = c.entry_id
          WHERE ($1::text IS NULL OR c.account_code = $1)
            AND ($2::text IS NULL OR c.site_id = $2)
          ORDER BY c.counted_on DESC, c.created_at DESC",
    )
    .bind(account_code)
    .bind(site_id)
    .fetch_all(pool)
    .await?;

    let mut counts: Vec<CashCountRow> = Vec::with_capacity(rows.len());
    for row in &rows {
        let counted: i64 = row.try_get("counted_minor")?;
        let books: i64 = row.try_get("per_books_minor")?;
        counts.push(CashCountRow {
            count_id: row.try_get("count_id")?,
            account_code: row.try_get("account_code")?,
            account_name: row.try_get("account_name")?,
            site_id: row.try_get("site_id")?,
            counted_on: row.try_get("counted_on")?,
            counted_by: row.try_get("counted_by")?,
            witnessed_by: row.try_get("witnessed_by")?,
            counted_minor: counted,
            per_books_minor: books,
            variance_minor: counted - books,
            reason: row.try_get("reason")?,
            entry_id: row.try_get("entry_id")?,
            entry_number: row.try_get("entry_number")?,
            created_at: row.try_get("created_at")?,
            notes: Vec::new(),
        });
    }

    // The breakdowns in one more query rather than one per count: a month of
    // counts is a page, and a page that costs thirty round trips is a page
    // somebody stops opening.
    if !counts.is_empty() {
        let ids: Vec<Uuid> = counts.iter().map(|count| count.count_id).collect();
        let notes = sqlx::query(
            "SELECT count_id, denomination_minor, quantity
               FROM cash_count_note
              WHERE count_id = ANY($1)
              ORDER BY denomination_minor DESC",
        )
        .bind(&ids)
        .fetch_all(pool)
        .await?;
        for note in &notes {
            let owner: Uuid = note.try_get("count_id")?;
            if let Some(count) = counts.iter_mut().find(|count| count.count_id == owner) {
                count.notes.push(CashCountNote {
                    denomination_minor: note.try_get("denomination_minor")?,
                    quantity: note.try_get("quantity")?,
                });
            }
        }
    }
    Ok(counts)
}

/// What the ledger holds on one account at one place, at the end of a day.
///
/// The same sum `/finance/money` makes, and deliberately the same shape: two
/// different sums of one account are two answers, and a treasurer comparing a
/// count against one of them would be comparing it against the wrong one.
async fn books_at(
    pool: &PgPool,
    account_code: &str,
    site_id: &str,
    on: NaiveDate,
) -> Result<i64, AppError> {
    let row = sqlx::query(
        "SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint AS balance
           FROM journal_line l
           JOIN journal_entry e USING (entry_id)
          WHERE l.account_code = $1 AND l.site_id = $2 AND e.posting_date <= $3",
    )
    .bind(account_code)
    .bind(site_id)
    .bind(on)
    .fetch_one(pool)
    .await?;
    Ok(row.try_get("balance")?)
}

/// Which meaning carries this drawer here.
///
/// Refused rather than guessed when the account is not a mapped cash meaning:
/// a count against a bank account, or against an account nobody mapped, is a
/// count nothing can ever be posted from, and finding that out at posting time
/// is finding it out too late.
async fn drawer_meaning(
    pool: &PgPool,
    account_code: &str,
    site_id: &str,
) -> Result<(String, String), AppError> {
    let rows = sqlx::query(
        "SELECT semantic_key, qualifier FROM account_map
          WHERE account_code = $1 AND site_id = $2 AND semantic_key = ANY($3)
          ORDER BY semantic_key, qualifier",
    )
    .bind(account_code)
    .bind(site_id)
    .bind(&CASH_MEANINGS[..])
    .fetch_all(pool)
    .await?;

    match rows.len() {
        0 => Err(AppError::Validation(format!(
            "{account_code} at {site_id} is not a cash drawer: point one of {} at it on the \
             Account Map screen, or count the account that is",
            CASH_MEANINGS.join(", ")
        ))),
        1 => Ok((
            rows[0].try_get("semantic_key")?,
            rows[0].try_get("qualifier")?,
        )),
        _ => Err(AppError::Validation(format!(
            "{account_code} at {site_id} is mapped by more than one meaning; one account carries \
             one meaning, so fix the Account Map before counting against it"
        ))),
    }
}

/// Write down what was in the drawer.
///
/// Posts nothing. A count is an observation, and the decision to put its
/// difference in the books is a separate act by somebody who has read the
/// reason — which is why `reason` may still be empty here and may not be there.
pub async fn record_count(
    pool: &PgPool,
    request: &RecordCountRequest,
    actor: &str,
) -> Result<CashCountRow, AppError> {
    if request.counted_minor < 0 {
        return Err(AppError::Validation(
            "a drawer cannot hold less than nothing".into(),
        ));
    }
    // The database refuses a breakdown that disagrees with the count (0216).
    // Checked here too, so the answer is a sentence rather than a constraint
    // name: the trigger is the guarantee, this is the explanation.
    let breakdown: i64 = request
        .notes
        .iter()
        .map(|note| note.denomination_minor * i64::from(note.quantity))
        .sum();
    if breakdown != 0 && breakdown != request.counted_minor {
        return Err(AppError::Validation(format!(
            "the breakdown adds up to {breakdown} and the count says {}",
            request.counted_minor
        )));
    }

    // Refused here rather than at posting time. See the note on `drawer_meaning`.
    drawer_meaning(pool, &request.account_code, &request.site_id).await?;

    let books = books_at(
        pool,
        &request.account_code,
        &request.site_id,
        request.counted_on,
    )
    .await?;

    let count_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO cash_count
           (count_id, account_code, site_id, counted_on, counted_by, witnessed_by,
            counted_minor, per_books_minor, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(count_id)
    .bind(&request.account_code)
    .bind(&request.site_id)
    .bind(request.counted_on)
    .bind(if request.counted_by.trim().is_empty() {
        actor
    } else {
        request.counted_by.trim()
    })
    .bind(request.witnessed_by.trim())
    .bind(request.counted_minor)
    .bind(books)
    .bind(request.reason.trim())
    .execute(&mut *tx)
    .await?;

    for note in &request.notes {
        if note.quantity == 0 {
            continue;
        }
        sqlx::query(
            "INSERT INTO cash_count_note (count_id, denomination_minor, quantity)
             VALUES ($1,$2,$3)",
        )
        .bind(count_id)
        .bind(note.denomination_minor)
        .bind(note.quantity)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    list_counts(pool, Some(&request.account_code), Some(&request.site_id))
        .await?
        .into_iter()
        .find(|row| row.count_id == count_id)
        .ok_or_else(|| AppError::NotFound("cash count".into()))
}

/// Put the difference in the books.
///
/// # The two legs, and which way round they go
///
/// More in the drawer than the books say is money arriving from nowhere: the
/// drawer is debited and `cash_variance` credited. Less is money gone: the
/// drawer is credited and `cash_variance` debited. Both legs go through
/// `account_map`, so this function names no client account code — and a
/// difference cannot be posted anywhere until somebody has said where
/// `cash_variance` lives at that location.
/// The decision to post, and the sentence that justifies it.
#[derive(Clone, Debug, Default, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PostCountRequest {
    /// Fills the count's reason when it was saved without one. Never
    /// overwrites a reason somebody already wrote: whoever counted the drawer
    /// is not always whoever books the difference, and the first account of
    /// what happened is the one worth keeping.
    #[serde(default)]
    pub reason: String,
}

pub async fn post_variance(
    pool: &PgPool,
    count_id: Uuid,
    request: &PostCountRequest,
    actor: &str,
) -> Result<CashCountRow, AppError> {
    let row = sqlx::query(
        "SELECT account_code, site_id, counted_on, counted_minor, per_books_minor,
                reason, entry_id
           FROM cash_count WHERE count_id = $1 FOR UPDATE",
    )
    .bind(count_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("cash count".into()))?;

    if row.try_get::<Option<Uuid>, _>("entry_id")?.is_some() {
        return Err(AppError::Validation(
            "this count's difference is already in the books".into(),
        ));
    }
    let stored: String = row.try_get("reason")?;
    let reason = if stored.trim().is_empty() {
        request.reason.trim().to_string()
    } else {
        stored
    };
    if reason.trim().is_empty() {
        return Err(AppError::Validation(
            "say why the drawer and the books disagree before putting it in the books".into(),
        ));
    }
    let counted: i64 = row.try_get("counted_minor")?;
    let books: i64 = row.try_get("per_books_minor")?;
    let variance = counted - books;
    if variance == 0 {
        return Err(AppError::Validation(
            "the drawer and the books agree; there is nothing to post".into(),
        ));
    }

    let account_code: String = row.try_get("account_code")?;
    let site_id: String = row.try_get("site_id")?;
    let counted_on: NaiveDate = row.try_get("counted_on")?;
    let (meaning, qualifier) = drawer_meaning(pool, &account_code, &site_id).await?;

    let amount = variance.abs();
    let (drawer_leg, variance_leg) = if variance > 0 {
        (
            PostingLine::debit(&meaning, &site_id, amount).with_qualifier(&qualifier),
            PostingLine::credit(VARIANCE_MEANING, &site_id, amount),
        )
    } else {
        (
            PostingLine::credit(&meaning, &site_id, amount).with_qualifier(&qualifier),
            PostingLine::debit(VARIANCE_MEANING, &site_id, amount),
        )
    };

    let intent = PostingIntent {
        posting_date: counted_on,
        source_kind: "CASH_COUNT".into(),
        source_id: Some(count_id.to_string()),
        rule_version: "cash_count/1".into(),
        currency: "IDR".into(),
        memo: Some(format!(
            "cash count {counted_on}: counted {counted}, books {books} — {}",
            reason.trim()
        )),
        lines: vec![drawer_leg, variance_leg],
    };

    let mut tx = pool.begin().await?;
    let posted = post(&mut tx, &intent, None, actor).await?;
    // Only from null: two people pressing at once means one entry, not two, and
    // the second is told the difference is already in the books.
    let updated = sqlx::query(
        "UPDATE cash_count SET entry_id = $2, reason = $3
              WHERE count_id = $1 AND entry_id IS NULL",
    )
    .bind(count_id)
    .bind(posted.entry_id)
    .bind(reason.trim())
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Validation(
            "this count's difference is already in the books".into(),
        ));
    }
    tx.commit().await?;

    list_counts(pool, Some(&account_code), Some(&site_id))
        .await?
        .into_iter()
        .find(|count| count.count_id == count_id)
        .ok_or_else(|| AppError::NotFound("cash count".into()))
}
