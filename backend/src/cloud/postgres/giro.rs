//! Giros: the money the company has promised and not yet paid.
//!
//! # What was wrong
//!
//! `payments.rs` credited `bank_giro` the moment somebody recorded a payment
//! with method GIRO. The client pays most of its suppliers this way, thirty to
//! ninety days out, so the books said the bank account was empty of money the
//! bank still held — and would hold for another two months. Every one of those
//! is a liability that exists and a bank balance that did not move, and the
//! error runs in the direction that hurts: a cash position that looks worse
//! than it is invites somebody to borrow against nothing.
//!
//! Meanwhile `giro_outstanding` sat in `required_semantic_keys` from the
//! ledger's first day and nothing ever wrote to it.
//!
//! # What happens now
//!
//! Issuing credits `giro_outstanding` for the bank the giro is drawn on. The
//! debt has moved from the supplier to the instrument; no money has moved.
//! Clearing is the only act that touches the bank:
//!
//!   Dr giro_outstanding (bank)  /  Cr bank_giro (bank)
//!
//! and rejection reverses the issue, which reopens whatever the giro was
//! written to settle.
//!
//! # Why the reversal reverses rather than re-posting
//!
//! `poster::reverse` copies the original entry's account CODES rather than
//! resolving the meanings again, which matters here more than anywhere: a giro
//! can sit outstanding for ninety days, and a bank remapped in that time would
//! otherwise have the reversal land somewhere the issue never touched — both
//! accounts wrong by the same amount, and the trial balance still balancing.

use super::banking::claim_bank_line;
use super::ledger::resolve_account_code;
use super::poster::{post, reverse, PostingIntent, PostingLine};
use crate::cloud::application::AppError;
use crate::cloud::domain::{giro_may_move, giro_may_unclear, GiroState};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// One instrument, as a screen reads it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GiroRow {
    pub giro_id: Uuid,
    /// `OUT` we wrote it, `IN` somebody gave us one.
    pub direction: String,
    pub number: String,
    /// The `account_link` source — `BCA`, `MANDIRI` — because it is what
    /// picks the leaf, not a display name.
    pub bank: String,
    /// Whose books the giro is drawn in: the unit that holds the bank account
    /// (P14, 0608).
    pub unit_id: String,
    pub amount_minor: i64,
    pub currency: String,
    pub issue_date: NaiveDate,
    pub due_date: NaiveDate,
    pub status: String,
    /// Days past due, negative while it is still ahead. Derived on read rather
    /// than stored, because it changes every midnight and a stored copy would
    /// be wrong for exactly as long as nobody looked.
    ///
    /// Measured against the day the board was drawn for, not against the
    /// server's clock. Those are the same number on the ordinary day and not on
    /// the interesting one: a board asked for last Friday would otherwise list
    /// a giro as overdue and print "-3 days" beside it.
    pub days_overdue: i64,
    pub supplier_payment_id: Option<Uuid>,
    pub payment_number: Option<String>,
    pub cash_document_id: Option<Uuid>,
    pub cash_document_number: Option<String>,
    /// Who it is for. Read through whichever source it has.
    pub party_name: Option<String>,
    pub issue_entry_id: Option<Uuid>,
    pub clearing_entry_id: Option<Uuid>,
    pub cleared_line_id: Option<Uuid>,
    pub cleared_on: Option<NaiveDate>,
    pub rejected_reason: Option<String>,
    pub rejected_on: Option<NaiveDate>,
    /// Set when the payment that wrote it was reversed before it cleared
    /// (0712).
    pub voided_reason: Option<String>,
    pub voided_on: Option<NaiveDate>,
    pub recorded_by: String,
    pub recorded_at: DateTime<Utc>,
    pub settled_by: Option<String>,
    /// How many times a clearing of this giro was taken back — Batal Cair, or
    /// a bounce after clearing (0705). Zero for almost every giro.
    pub times_uncleared: i64,
    /// For a bounced giro: the payment or cash document that settled what it
    /// did not (0705). Both empty while the bounce is still waiting for one.
    pub replaced_by_payment_id: Option<Uuid>,
    pub replaced_by_document_id: Option<Uuid>,
    pub replaced_by: Option<String>,
    /// The number of the payment or cash document that replaced it — what a
    /// person looks for on the board, where `replaced_by` is who did it.
    pub replacement_number: Option<String>,
}

/// `$1` is always the day being asked about, and NULL means today. Every query
/// below binds it first for that reason: `days_overdue` has to agree with the
/// list the row came out of, and a column that read the clock while the query
/// filtered on a date would disagree with it by exactly the amount that matters.
const GIRO_COLUMNS: &str = "g.giro_id, g.direction, g.number, g.bank, g.unit_id,
     g.amount_minor, g.currency, g.issue_date, g.due_date, g.status,
     (COALESCE($1::date, CURRENT_DATE) - g.due_date)::bigint AS days_overdue,
     g.supplier_payment_id, g.cash_document_id,
     g.issue_entry_id, g.clearing_entry_id, g.cleared_line_id, g.cleared_on,
     g.rejected_reason, g.rejected_on, g.voided_reason, g.voided_on, g.recorded_by, g.recorded_at, g.settled_by,
     g.replaced_by_payment_id, g.replaced_by_document_id, g.replaced_by,
     COALESCE((SELECT rp.payment_number FROM supplier_payment rp
                WHERE rp.payment_id = g.replaced_by_payment_id),
              (SELECT rd.number FROM cash_document rd
                WHERE rd.document_id = g.replaced_by_document_id)) AS replacement_number,
     (SELECT count(*) FROM giro_unclearing u WHERE u.giro_id = g.giro_id)::bigint
         AS times_uncleared,
     p.payment_number,
     d.number AS cash_document_number,
     COALESCE(d.party_name, (
         SELECT COALESCE(i.supplier_name, i.supplier_id)
           FROM supplier_payment_allocation al
           JOIN supplier_invoice i USING (invoice_id)
          WHERE al.payment_id = g.supplier_payment_id
          ORDER BY al.amount_minor DESC LIMIT 1)) AS party_name";

const GIRO_FROM: &str = "FROM giro g
     LEFT JOIN supplier_payment p ON p.payment_id = g.supplier_payment_id
     LEFT JOIN cash_document   d ON d.document_id = g.cash_document_id";

fn to_giro(row: &sqlx::postgres::PgRow) -> Result<GiroRow, AppError> {
    Ok(GiroRow {
        giro_id: row.try_get("giro_id")?,
        direction: row.try_get("direction")?,
        number: row.try_get("number")?,
        bank: row.try_get("bank")?,
        unit_id: row.try_get("unit_id")?,
        amount_minor: row.try_get("amount_minor")?,
        currency: row.try_get("currency")?,
        issue_date: row.try_get("issue_date")?,
        due_date: row.try_get("due_date")?,
        status: row.try_get("status")?,
        days_overdue: row.try_get("days_overdue")?,
        supplier_payment_id: row.try_get("supplier_payment_id")?,
        payment_number: row.try_get("payment_number")?,
        cash_document_id: row.try_get("cash_document_id")?,
        cash_document_number: row.try_get("cash_document_number")?,
        party_name: row.try_get("party_name")?,
        issue_entry_id: row.try_get("issue_entry_id")?,
        clearing_entry_id: row.try_get("clearing_entry_id")?,
        cleared_line_id: row.try_get("cleared_line_id")?,
        cleared_on: row.try_get("cleared_on")?,
        rejected_reason: row.try_get("rejected_reason")?,
        voided_reason: row.try_get("voided_reason")?,
        voided_on: row.try_get("voided_on")?,
        rejected_on: row.try_get("rejected_on")?,
        recorded_by: row.try_get("recorded_by")?,
        recorded_at: row.try_get("recorded_at")?,
        settled_by: row.try_get("settled_by")?,
        times_uncleared: row.try_get("times_uncleared")?,
        replaced_by_payment_id: row.try_get("replaced_by_payment_id")?,
        replaced_by_document_id: row.try_get("replaced_by_document_id")?,
        replaced_by: row.try_get("replaced_by")?,
        replacement_number: row.try_get("replacement_number")?,
    })
}

pub async fn giro_list(
    pool: &PgPool,
    status: Option<&str>,
    bank: Option<&str>,
    direction: Option<&str>,
    as_of: Option<NaiveDate>,
    limit: i64,
) -> Result<Vec<GiroRow>, AppError> {
    let sql = format!(
        "SELECT {GIRO_COLUMNS} {GIRO_FROM}
          WHERE ($2::text IS NULL OR g.status = $2)
            AND ($3::text IS NULL OR g.bank = $3)
            AND ($4::text IS NULL OR g.direction = $4)
          ORDER BY g.due_date, g.number
          LIMIT $5"
    );
    let rows = sqlx::query(&sql)
        .bind(as_of)
        .bind(status)
        .bind(bank)
        .bind(direction)
        .bind(limit.clamp(1, 500))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_giro).collect()
}

pub async fn giro_read(pool: &PgPool, giro_id: Uuid) -> Result<GiroRow, AppError> {
    let sql = format!("SELECT {GIRO_COLUMNS} {GIRO_FROM} WHERE g.giro_id = $2");
    let row = sqlx::query(&sql)
        .bind(Option::<NaiveDate>::None)
        .bind(giro_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("giro".into()))?;
    to_giro(&row)
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/// What one bank still has out, and how much of it is a problem.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GiroBankTotal {
    pub bank: String,
    pub direction: String,
    pub count: i64,
    pub outstanding_minor: i64,
    /// Falling due in the next seven days, this one included.
    pub due_this_week_minor: i64,
    /// Past its date and the bank has not taken it.
    pub overdue_minor: i64,
    pub overdue_count: i64,
    /// What the bank account itself holds, so the two can be read together.
    /// A bank with more giro out than money in it is the single fact this
    /// board exists to make visible.
    pub bank_balance_minor: Option<i64>,
}

/// The whole board: per bank, plus what is falling due and what has fallen.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GiroBoard {
    pub as_of: NaiveDate,
    pub banks: Vec<GiroBankTotal>,
    /// Every giro due within the week, soonest first.
    pub due_this_week: Vec<GiroRow>,
    /// Every giro past its date, oldest first.
    pub overdue: Vec<GiroRow>,
}

/// Outstanding per bank, due this week, overdue.
///
/// "Outstanding" is the three live states — ISSUED, DELIVERED, DUE — which is
/// the same predicate `domain::GiroState::is_outstanding` answers, said once in
/// SQL. If the two ever disagree the board and the ledger disagree about what
/// the company owes, so the kernel test and this WHERE clause are checked
/// against each other in `giro_integration`.
pub async fn giro_board(pool: &PgPool, as_of: NaiveDate) -> Result<GiroBoard, AppError> {
    let banks = sqlx::query(
        "SELECT g.bank, g.direction,
                COUNT(*)::bigint AS count,
                COALESCE(SUM(g.amount_minor), 0)::bigint AS outstanding_minor,
                COALESCE(SUM(g.amount_minor) FILTER (
                    WHERE g.due_date BETWEEN $1 AND $1 + 6), 0)::bigint AS due_this_week_minor,
                COALESCE(SUM(g.amount_minor) FILTER (
                    WHERE g.due_date < $1), 0)::bigint AS overdue_minor,
                COUNT(*) FILTER (WHERE g.due_date < $1)::bigint AS overdue_count,
                (SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint
                   FROM journal_line l
                   JOIN account_resolution m ON m.account_code = l.account_code
                                            AND m.unit_id = l.unit_id
                  WHERE m.role = 'bank_giro'
                    AND m.source_type = 'COMPANY'
                    AND m.source_id = g.bank
                    AND l.unit_id = g.unit_id) AS bank_balance_minor
           FROM giro g
          WHERE g.status IN ('ISSUED', 'DELIVERED', 'DUE')
          GROUP BY g.bank, g.direction, g.unit_id
          ORDER BY g.direction, g.bank",
    )
    .bind(as_of)
    .fetch_all(pool)
    .await?;

    let banks = banks
        .iter()
        .map(|row| {
            Ok(GiroBankTotal {
                bank: row.try_get("bank")?,
                direction: row.try_get("direction")?,
                count: row.try_get("count")?,
                outstanding_minor: row.try_get("outstanding_minor")?,
                due_this_week_minor: row.try_get("due_this_week_minor")?,
                overdue_minor: row.try_get("overdue_minor")?,
                overdue_count: row.try_get("overdue_count")?,
                bank_balance_minor: row.try_get("bank_balance_minor")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    let due_sql = format!(
        "SELECT {GIRO_COLUMNS} {GIRO_FROM}
          WHERE g.status IN ('ISSUED', 'DELIVERED', 'DUE')
            AND g.due_date BETWEEN $1 AND $1 + 6
          ORDER BY g.due_date, g.number"
    );
    let due_this_week = sqlx::query(&due_sql)
        .bind(as_of)
        .fetch_all(pool)
        .await?
        .iter()
        .map(to_giro)
        .collect::<Result<Vec<_>, AppError>>()?;

    let overdue_sql = format!(
        "SELECT {GIRO_COLUMNS} {GIRO_FROM}
          WHERE g.status IN ('ISSUED', 'DELIVERED', 'DUE')
            AND g.due_date < $1
          ORDER BY g.due_date, g.number"
    );
    let overdue = sqlx::query(&overdue_sql)
        .bind(as_of)
        .fetch_all(pool)
        .await?
        .iter()
        .map(to_giro)
        .collect::<Result<Vec<_>, AppError>>()?;

    Ok(GiroBoard {
        as_of,
        banks,
        due_this_week,
        overdue,
    })
}

// ---------------------------------------------------------------------------
// Writing one down
// ---------------------------------------------------------------------------

/// Everything a giro needs at the moment it is written.
///
/// Not a request type: nothing keys a giro on its own. It is always a
/// consequence — of a supplier payment, or of a cash document — and a screen
/// that could create a bare one would be a screen that creates a liability
/// with no posting behind it.
#[derive(Clone, Debug)]
pub(super) struct NewGiro {
    pub direction: &'static str,
    pub number: String,
    pub bank: String,
    /// The unit whose bank account it is drawn on (0608).
    pub unit_id: String,
    pub amount_minor: i64,
    pub issue_date: NaiveDate,
    pub due_date: NaiveDate,
    pub supplier_payment_id: Option<Uuid>,
    pub cash_document_id: Option<Uuid>,
    pub issue_entry_id: Uuid,
}

pub(super) async fn giro_insert(
    tx: &mut Transaction<'_, Postgres>,
    giro: &NewGiro,
    actor: &str,
) -> Result<Uuid, AppError> {
    if giro.due_date < giro.issue_date {
        return Err(AppError::Validation(format!(
            "giro {} is due {} and was written {}; a giro cannot fall due before it exists",
            giro.number, giro.due_date, giro.issue_date
        )));
    }
    let giro_id = Uuid::new_v4();
    let result = sqlx::query(
        "INSERT INTO giro
           (giro_id, direction, number, bank, unit_id, amount_minor, currency,
            issue_date, due_date, supplier_payment_id, cash_document_id,
            issue_entry_id, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,'IDR',$7,$8,$9,$10,$11,$12)",
    )
    .bind(giro_id)
    .bind(giro.direction)
    .bind(&giro.number)
    .bind(&giro.bank)
    .bind(&giro.unit_id)
    .bind(giro.amount_minor)
    .bind(giro.issue_date)
    .bind(giro.due_date)
    .bind(giro.supplier_payment_id)
    .bind(giro.cash_document_id)
    .bind(giro.issue_entry_id)
    .bind(actor)
    .execute(&mut **tx)
    .await;
    match result {
        Ok(_) => Ok(giro_id),
        // The unique key is (bank, direction, number). A bank does not issue
        // one number twice, so a collision is somebody re-keying a giro that
        // is already recorded — which is worth saying in those words rather
        // than as SQLSTATE 23505.
        Err(sqlx::Error::Database(error)) if error.code().as_deref() == Some("23505") => {
            Err(AppError::Conflict(format!(
                "giro {} at {} is already recorded; one number, one instrument",
                giro.number, giro.bank
            )))
        }
        Err(error) => Err(error.into()),
    }
}

// ---------------------------------------------------------------------------
// Moving one along
// ---------------------------------------------------------------------------

/// Read a giro under a lock and check the move the kernel allows.
async fn take_for_move(
    tx: &mut Transaction<'_, Postgres>,
    giro_id: Uuid,
    to: GiroState,
) -> Result<sqlx::postgres::PgRow, AppError> {
    let row = sqlx::query(
        "SELECT giro_id, direction, number, bank, unit_id, amount_minor, currency,
                status, issue_entry_id, supplier_payment_id, cash_document_id
           FROM giro WHERE giro_id = $1 FOR UPDATE",
    )
    .bind(giro_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("giro".into()))?;

    let stored: String = row.try_get("status")?;
    let from = GiroState::parse(&stored)
        .ok_or_else(|| AppError::Validation(format!("'{stored}' is not a giro state")))?;
    // The kernel's sentence, not a constraint's name. The trigger in 0117 is
    // the guarantee; this is the explanation a person can act on.
    giro_may_move(from, to).map_err(|why| {
        let number: String = row.try_get("number").unwrap_or_default();
        AppError::Conflict(format!("giro {number}: {why}"))
    })?;
    Ok(row)
}

/// Handed over. Nothing in the ledger changes.
///
/// Recorded anyway, because it is the difference between a giro we can still
/// tear up and one we cannot, and that is the question somebody asks the
/// afternoon a supplier's account turns out to be wrong.
///
/// # Why this takes no actor
///
/// `settled_by` on the row is for settlement — the act that posts — and the two
/// intermediate moves post nothing, so there is nothing on them for anybody to
/// sign. Who made them is answered by the audit log, which `http::audit`
/// records for every write with the actor the session resolved. A column here
/// would be a second, thinner copy of that: one that only knows about giros,
/// and one somebody would have to remember to write.
pub async fn giro_deliver(pool: &PgPool, giro_id: Uuid) -> Result<GiroRow, AppError> {
    move_to(pool, giro_id, GiroState::Delivered).await
}

/// The date arrived and the bank has not taken it. Also no posting.
///
/// A state a report derives and a person confirms, and it exists so "overdue"
/// is a thing the board can say without inventing a fourth status for it.
pub async fn giro_mark_due(pool: &PgPool, giro_id: Uuid) -> Result<GiroRow, AppError> {
    move_to(pool, giro_id, GiroState::Due).await
}

/// The two moves that change a status and nothing else.
async fn move_to(pool: &PgPool, giro_id: Uuid, to: GiroState) -> Result<GiroRow, AppError> {
    let mut tx = pool.begin().await?;
    take_for_move(&mut tx, giro_id, to).await?;
    sqlx::query("UPDATE giro SET status=$2 WHERE giro_id=$1")
        .bind(giro_id)
        .bind(to.as_str())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    giro_read(pool, giro_id).await
}

/// The bank took it. This is the only act that moves the bank balance.
///
/// `Dr giro_outstanding (bank) / Cr bank_giro (bank)` for one we wrote, and the
/// mirror for one we were given. Both legs are resolved through `account_resolution`
/// with the bank as the qualifier, so a company that opens a sixth bank maps
/// two rows on a screen rather than shipping a release.

/// Two spellings of one bank: the giro carries the name the account map was
/// qualified by, the statement carries the institution's registered name,
/// and neither side ever sees the other's whitespace.
fn same_bank(a: &str, b: &str) -> bool {
    let fold = |s: &str| s.split_whitespace().collect::<String>().to_uppercase();
    fold(a) == fold(b)
}

pub async fn giro_clear(
    pool: &PgPool,
    giro_id: Uuid,
    cleared_on: NaiveDate,
    statement_line_id: Option<Uuid>,
    actor: &str,
) -> Result<GiroRow, AppError> {
    let mut tx = pool.begin().await?;
    let row = take_for_move(&mut tx, giro_id, GiroState::Cleared).await?;

    let direction: String = row.try_get("direction")?;
    let number: String = row.try_get("number")?;
    let bank: String = row.try_get("bank")?;
    let unit_id: String = row.try_get("unit_id")?;
    let amount: i64 = row.try_get("amount_minor")?;
    let currency: String = row.try_get("currency")?;

    // The evidence is the bank's own word, so it has to be THIS bank's: a
    // BCA giro cleared on a Mandiri line is somebody reading two statements
    // at once, and the books would move twice for one piece of paper.
    if let Some(line_id) = statement_line_id {
        let line_bank: Option<String> = sqlx::query(
            "SELECT b.name
               FROM bank_statement_line l
               JOIN bank_statement s USING (statement_id)
               JOIN bank_account a ON a.account_id = s.bank_account_id
               JOIN bank b ON b.bank_id = a.bank_id
              WHERE l.line_id = $1",
        )
        .bind(line_id)
        .fetch_optional(&mut *tx)
        .await?
        .and_then(|row| row.try_get::<String, _>("name").ok());
        let line_bank = line_bank.unwrap_or_default();
        if !same_bank(&line_bank, &bank) {
            return Err(AppError::Validation(format!(
                "that statement line is {line_bank}'s word, and giro {number} is a {bank} \
                 instrument; clearance evidence has to come from the bank the giro was drawn on"
            )));
        }
        // And the line's story is ours to take (0317).
        claim_bank_line(&mut tx, line_id, "GIRO_CLEAR", actor).await?;
    }

    // Both meanings resolved before anything is written, so an unmapped bank
    // is refused by name rather than arriving from the poster.
    resolve_account_code(&mut *tx, "giro_outstanding", &unit_id, &bank).await?;
    resolve_account_code(&mut *tx, "bank_giro", &unit_id, &bank).await?;

    let outgoing = direction == "OUT";
    let memo = format!("Giro {number} {bank}");
    let lines = if outgoing {
        vec![
            PostingLine::debit("giro_outstanding", &unit_id, amount).with_qualifier(&bank),
            PostingLine::credit("bank_giro", &unit_id, amount).with_qualifier(&bank),
        ]
    } else {
        // One a customer gave us: the receivable on the instrument becomes
        // money. Same two accounts, other way round.
        vec![
            PostingLine::debit("bank_giro", &unit_id, amount).with_qualifier(&bank),
            PostingLine::credit("giro_outstanding", &unit_id, amount).with_qualifier(&bank),
        ]
    };

    let intent = PostingIntent {
        posting_date: cleared_on,
        source_kind: "GIRO".into(),
        source_id: Some(giro_id.to_string()),
        rule_version: "giro/1".into(),
        currency,
        memo: Some(format!("{memo} cleared")),
        lines: lines
            .into_iter()
            .map(|mut line| {
                line.memo = Some(memo.clone());
                line
            })
            .collect(),
    };
    // Clearing is the only thing posted under GIRO: the issue came in on a
    // cash document, and a bounce reverses this entry rather than posting a
    // second one.
    let posted = post(&mut tx, &intent, None, actor).await?;

    sqlx::query(
        "UPDATE giro
            SET status='CLEARED', clearing_entry_id=$2, cleared_line_id=$3, cleared_on=$4,
                settled_by=$5, settled_at=now()
          WHERE giro_id=$1",
    )
    .bind(giro_id)
    .bind(posted.entry_id)
    .bind(statement_line_id)
    .bind(cleared_on)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    giro_read(pool, giro_id).await
}

/// It bounced, or we stopped it. The issue is reversed and the debt comes back.
///
/// # Why the payment goes to REVERSED and is not deleted
///
/// `supplier_payment_allocation` holds a bill against `status IN
/// ('DRAFT','POSTED')`. While the payment reads POSTED the bill stays fully
/// allocated and cannot be paid again — exactly wrong once the giro bounced.
/// REVERSED is not an edit of a posted payment: the row stays frozen, its entry
/// stays in the ledger, and a mirror sits beside it. The allocation rules
/// already read the status, so the bill reopens without another table learning
/// what a giro is.
pub async fn giro_reject(
    pool: &PgPool,
    giro_id: Uuid,
    rejected_on: NaiveDate,
    reason: &str,
    actor: &str,
) -> Result<GiroRow, AppError> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "a rejected giro needs a reason; the supplier is going to ask, and it is the only \
             record of what to tell them"
                .into(),
        ));
    }
    let mut tx = pool.begin().await?;
    // A giro the bank took and then returned unpaid (Tolak after Cair, 0705):
    // the clearing is taken back first, and the bounce then goes exactly the
    // way a bounce of a giro that never cleared goes.
    if current_status(&mut tx, giro_id).await? == GiroState::Cleared {
        undo_clearing(&mut tx, giro_id, rejected_on, reason, true, actor).await?;
    }
    let row = take_for_move(&mut tx, giro_id, GiroState::Rejected).await?;
    let number: String = row.try_get("number")?;
    let bank: String = row.try_get("bank")?;
    let issue_entry_id: Option<Uuid> = row.try_get("issue_entry_id")?;
    let payment_id: Option<Uuid> = row.try_get("supplier_payment_id")?;
    let document_id: Option<Uuid> = row.try_get("cash_document_id")?;

    // The entry that put it on `giro_outstanding`, reversed by id rather than
    // rebuilt: ninety days is long enough for a bank to be remapped, and a
    // rebuilt reversal would land where the issue never did.
    let mirror = match issue_entry_id {
        Some(entry_id) => Some(
            reverse(
                &mut tx,
                entry_id,
                rejected_on,
                &format!("giro {number} {bank} rejected: {reason}"),
                actor,
            )
            .await?,
        ),
        None => None,
    };

    if let (Some(payment_id), Some(mirror)) = (payment_id, mirror.as_ref()) {
        sqlx::query(
            "UPDATE supplier_payment
                SET status='REVERSED', reversal_entry_id=$2, reversed_by=$3,
                    reversed_at=now(), reversal_reason=$4
              WHERE payment_id=$1",
        )
        .bind(payment_id)
        .bind(mirror.entry_id)
        .bind(actor)
        .bind(format!("giro {number} {bank} rejected: {reason}"))
        .execute(&mut *tx)
        .await?;
        // The bills it paid are owed again: without this the Payment Ledger
        // kept them settled while the ledger had the payable back, and the
        // next payment of the same bill settled nothing (CONTROL_AP, 1 Oct).
        super::payment_ledger::ple_delink(
            &mut tx,
            "PAYMENT",
            &payment_id.to_string(),
            &format!("giro {number} {bank} rejected: {reason}"),
            actor,
        )
        .await?;
    }
    if let (Some(document_id), Some(mirror)) = (document_id, mirror.as_ref()) {
        sqlx::query(
            "UPDATE cash_document SET status='REVERSED', reversal_entry_id=$2
              WHERE document_id=$1 AND status='POSTED'",
        )
        .bind(document_id)
        .bind(mirror.entry_id)
        .execute(&mut *tx)
        .await?;
        // A BKK voucher paid by this giro settled bills with it (0711): the
        // bounce reverses the whole voucher, so its bills are open again.
        let has_lines: bool =
            sqlx::query_scalar("SELECT has_lines FROM cash_document WHERE document_id = $1")
                .bind(document_id)
                .fetch_one(&mut *tx)
                .await?;
        if has_lines {
            let why = format!("giro {number} {bank} rejected: {reason}");
            super::voucher::voucher_undo_settlement(
                &mut tx,
                document_id,
                mirror.entry_id,
                &why,
                actor,
            )
            .await?;
            super::payment_ledger::ple_delink(
                &mut tx,
                "CASH_DOC",
                &document_id.to_string(),
                &why,
                actor,
            )
            .await?;
        }
    }

    sqlx::query(
        "UPDATE giro
            SET status='REJECTED', rejected_reason=$2, rejected_on=$3,
                settled_by=$4, settled_at=now()
          WHERE giro_id=$1",
    )
    .bind(giro_id)
    .bind(reason)
    .bind(rejected_on)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    giro_read(pool, giro_id).await
}

/// Tear up the giro a reversed document wrote (0712).
///
/// Called from inside the reversal's own transaction, before the mirror is
/// written, with the document that is being taken back — a cash document or a
/// supplier payment. A document paid some other way has no giro and nothing
/// happens. A giro still on the board (ISSUED, DELIVERED, DUE) becomes VOIDED:
/// the reversal already takes the amount off `giro_outstanding`, so no entry
/// is written here. One the bank has CLEARED refuses the whole reversal — the
/// money has left, and un-clearing it (Batal Cair) or recording the refund is
/// a decision somebody has to make on purpose. One already REJECTED or VOIDED
/// has nothing left to do.
pub(super) async fn giro_void_for(
    tx: &mut Transaction<'_, Postgres>,
    supplier_payment_id: Option<Uuid>,
    cash_document_id: Option<Uuid>,
    voided_on: NaiveDate,
    reason: &str,
    actor: &str,
) -> Result<(), AppError> {
    let row = sqlx::query(
        "SELECT giro_id, number, bank, status FROM giro
          WHERE ($1::uuid IS NOT NULL AND supplier_payment_id = $1)
             OR ($2::uuid IS NOT NULL AND cash_document_id = $2)
          FOR UPDATE",
    )
    .bind(supplier_payment_id)
    .bind(cash_document_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(row) = row else {
        return Ok(());
    };
    let giro_id: Uuid = row.try_get("giro_id")?;
    let number: String = row.try_get("number")?;
    let bank: String = row.try_get("bank")?;
    let stored: String = row.try_get("status")?;
    let state = GiroState::parse(&stored)
        .ok_or_else(|| AppError::Conflict(format!("giro {number} has an unknown status")))?;
    match state {
        GiroState::Issued | GiroState::Delivered | GiroState::Due => {
            sqlx::query(
                "UPDATE giro
                    SET status='VOIDED', voided_on=$2, voided_reason=$3,
                        settled_by=$4, settled_at=now()
                  WHERE giro_id=$1",
            )
            .bind(giro_id)
            .bind(voided_on)
            .bind(reason)
            .bind(actor)
            .execute(&mut **tx)
            .await?;
            Ok(())
        }
        GiroState::Cleared => Err(AppError::Conflict(format!(
            "giro {number} at {bank} has already cleared, so the money has left the bank; \
             un-clear it first (Batal Cair) or record the refund as its own document"
        ))),
        GiroState::Rejected | GiroState::Voided => Ok(()),
    }
}

/// The state a giro is in, locked for the rest of the transaction.
async fn current_status(
    tx: &mut Transaction<'_, Postgres>,
    giro_id: Uuid,
) -> Result<GiroState, AppError> {
    let stored: String = sqlx::query_scalar("SELECT status FROM giro WHERE giro_id = $1 FOR UPDATE")
        .bind(giro_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound("giro".into()))?;
    GiroState::parse(&stored)
        .ok_or_else(|| AppError::Validation(format!("'{stored}' is not a giro state")))
}

/// Take a clearing back: reverse its entry into an open period, release the
/// statement line it claimed, write down that it happened, and put the giro
/// back on `giro_outstanding` as DUE.
///
/// The giro row's clearing columns go back to empty — 0117 ties them to
/// CLEARED — so `giro_unclearing` is where "it was once cleared, on this
/// line, by this entry" is kept.
async fn undo_clearing(
    tx: &mut Transaction<'_, Postgres>,
    giro_id: Uuid,
    undone_on: NaiveDate,
    reason: &str,
    then_rejected: bool,
    actor: &str,
) -> Result<(), AppError> {
    let row = sqlx::query(
        "SELECT number, bank, status, clearing_entry_id, cleared_on, cleared_line_id
           FROM giro WHERE giro_id = $1 FOR UPDATE",
    )
    .bind(giro_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("giro".into()))?;
    let number: String = row.try_get("number")?;
    let bank: String = row.try_get("bank")?;
    let stored: String = row.try_get("status")?;
    let from = GiroState::parse(&stored)
        .ok_or_else(|| AppError::Validation(format!("'{stored}' is not a giro state")))?;
    giro_may_unclear(from).map_err(|why| AppError::Conflict(format!("giro {number}: {why}")))?;
    let clearing_entry_id: Uuid = row.try_get::<Option<Uuid>, _>("clearing_entry_id")?.ok_or_else(|| {
        AppError::Conflict(format!("giro {number} is cleared but names no clearing entry"))
    })?;
    let cleared_on: NaiveDate = row
        .try_get::<Option<NaiveDate>, _>("cleared_on")?
        .ok_or_else(|| AppError::Conflict(format!("giro {number} is cleared but names no day")))?;
    let cleared_line_id: Option<Uuid> = row.try_get("cleared_line_id")?;
    if undone_on < cleared_on {
        return Err(AppError::Validation(format!(
            "giro {number} cleared on {cleared_on}; it cannot be taken back on {undone_on},              before it happened"
        )));
    }

    // Reversed by id, into the period `undone_on` falls in: a clearing in a
    // month that has since closed is answered in the open month, never by
    // reopening the closed one.
    let mirror = reverse(
        tx,
        clearing_entry_id,
        undone_on,
        &format!("giro {number} {bank} clearing taken back: {reason}"),
        actor,
    )
    .await?;

    if let Some(line_id) = cleared_line_id {
        sqlx::query(
            "UPDATE bank_line_claim
                SET released_by = $2, released_at = now()
              WHERE line_id = $1 AND claim_kind = 'GIRO_CLEAR' AND released_at IS NULL",
        )
        .bind(line_id)
        .bind(actor)
        .execute(&mut **tx)
        .await?;
    }

    sqlx::query(
        "INSERT INTO giro_unclearing
             (giro_id, clearing_entry_id, reversal_entry_id, cleared_on, cleared_line_id,
              undone_on, reason, then_rejected, undone_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(giro_id)
    .bind(clearing_entry_id)
    .bind(mirror.entry_id)
    .bind(cleared_on)
    .bind(cleared_line_id)
    .bind(undone_on)
    .bind(reason)
    .bind(then_rejected)
    .bind(actor)
    .execute(&mut **tx)
    .await?;

    sqlx::query(
        "UPDATE giro
            SET status = 'DUE', clearing_entry_id = NULL, cleared_on = NULL,
                cleared_line_id = NULL, settled_by = NULL, settled_at = NULL
          WHERE giro_id = $1",
    )
    .bind(giro_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Batal Cair: the clearing was wrong — the wrong statement line, a day early,
/// the wrong giro — and is taken back. The giro is outstanding again, DUE,
/// and can be cleared properly.
pub async fn giro_unclear(
    pool: &PgPool,
    giro_id: Uuid,
    undone_on: NaiveDate,
    reason: &str,
    actor: &str,
) -> Result<GiroRow, AppError> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "taking a clearing back needs a reason; the bank balance moves by it, and the next              person to read the statement will ask why"
                .into(),
        ));
    }
    let mut tx = pool.begin().await?;
    undo_clearing(&mut tx, giro_id, undone_on, reason, false, actor).await?;
    tx.commit().await?;
    giro_read(pool, giro_id).await
}

/// What a screen sends to take a clearing back.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnclearGiroRequest {
    /// The day the clearing is taken back on — into an open month.
    pub on: NaiveDate,
    pub reason: String,
}

/// What settled the debt a bounced giro did not: exactly one of the two.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReplaceGiroRequest {
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub payment_id: Option<Uuid>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub cash_document_id: Option<Uuid>,
}

/// Say what replaced a bounced giro (7Soft's Tolakan, 0705).
///
/// The bounce itself already reopened what the giro was meant to settle — a
/// supplier payment goes to REVERSED and its bills are owed again. This only
/// records which later document settled them, so the bounce report can follow
/// every rejected giro to its end. A replacement for a supplier payment's giro
/// must settle at least one of the same bills; one for a cash document's must
/// be a posted cash document in the same direction.
pub async fn giro_replace(
    pool: &PgPool,
    giro_id: Uuid,
    request: &ReplaceGiroRequest,
    actor: &str,
) -> Result<GiroRow, AppError> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "SELECT number, direction, status, supplier_payment_id, cash_document_id,
                replaced_by_payment_id, replaced_by_document_id
           FROM giro WHERE giro_id = $1 FOR UPDATE",
    )
    .bind(giro_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("giro".into()))?;
    let number: String = row.try_get("number")?;
    let status: String = row.try_get("status")?;
    if status != "REJECTED" {
        return Err(AppError::Conflict(format!(
            "giro {number} is {}; only a bounced giro is replaced",
            status.to_lowercase()
        )));
    }
    let already: Option<Uuid> = row
        .try_get::<Option<Uuid>, _>("replaced_by_payment_id")?
        .or(row.try_get("replaced_by_document_id")?);
    if already.is_some() {
        return Err(AppError::Conflict(format!(
            "giro {number} has already been replaced"
        )));
    }
    match (request.payment_id, request.cash_document_id) {
        (Some(replacement), None) => {
            let original: Option<Uuid> = row.try_get("supplier_payment_id")?;
            let Some(original) = original else {
                return Err(AppError::Validation(format!(
                    "giro {number} was written on a cash document; replace it with a cash                      document"
                )));
            };
            let replacement_status: Option<String> =
                sqlx::query_scalar("SELECT status FROM supplier_payment WHERE payment_id = $1")
                    .bind(replacement)
                    .fetch_optional(&mut *tx)
                    .await?;
            match replacement_status.as_deref() {
                Some("POSTED") => {}
                Some(other) => {
                    return Err(AppError::Validation(format!(
                        "the replacing payment is {}, not posted",
                        other.to_lowercase()
                    )))
                }
                None => return Err(AppError::NotFound("supplier payment".into())),
            }
            let shares_a_bill: bool = sqlx::query_scalar(
                "SELECT EXISTS (
                     SELECT 1 FROM supplier_payment_allocation a
                      JOIN supplier_payment_allocation b ON b.invoice_id = a.invoice_id
                     WHERE a.payment_id = $1 AND b.payment_id = $2)",
            )
            .bind(original)
            .bind(replacement)
            .fetch_one(&mut *tx)
            .await?;
            if !shares_a_bill {
                return Err(AppError::Validation(format!(
                    "the replacing payment settles none of the bills giro {number} was written                      for"
                )));
            }
        }
        (None, Some(replacement)) => {
            if row.try_get::<Option<Uuid>, _>("cash_document_id")?.is_none() {
                return Err(AppError::Validation(format!(
                    "giro {number} was written on a supplier payment; replace it with a payment"
                )));
            }
            let direction: String = row.try_get("direction")?;
            let replacement_row = sqlx::query(
                "SELECT status, kind FROM cash_document WHERE document_id = $1",
            )
            .bind(replacement)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound("cash document".into()))?;
            let replacement_status: String = replacement_row.try_get("status")?;
            let kind: String = replacement_row.try_get("kind")?;
            if replacement_status != "POSTED" {
                return Err(AppError::Validation(format!(
                    "the replacing cash document is {}, not posted",
                    replacement_status.to_lowercase()
                )));
            }
            let expected = if direction == "OUT" { "PAY" } else { "RECEIVE" };
            if kind != expected {
                return Err(AppError::Validation(format!(
                    "giro {number} moved money {}; its replacement has to as well",
                    if direction == "OUT" { "out" } else { "in" }
                )));
            }
        }
        _ => {
            return Err(AppError::Validation(
                "name exactly one replacement: a payment_id or a cash_document_id".into(),
            ))
        }
    }
    sqlx::query(
        "UPDATE giro
            SET replaced_by_payment_id = $2, replaced_by_document_id = $3,
                replaced_by = $4, replaced_at = now()
          WHERE giro_id = $1",
    )
    .bind(giro_id)
    .bind(request.payment_id)
    .bind(request.cash_document_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    giro_read(pool, giro_id).await
}

/// What a screen sends to settle one.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SettleGiroRequest {
    /// The day the bank took it, or the day it bounced. Not "today": a
    /// statement read on Monday carries Friday's clearings, and posting them on
    /// Monday puts them in the wrong week and, four times a year, the wrong
    /// month.
    pub on: NaiveDate,
    /// The statement line that proves it, when there is one.
    pub statement_line_id: Option<Uuid>,
    /// Required to reject, ignored to clear.
    pub reason: Option<String>,
}
