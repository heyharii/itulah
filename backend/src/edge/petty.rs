//! The shop's small money: a float head office hands over, and what it buys.
//!
//! A shop is not a place that pays. Expenses are centralised at head office and
//! settled by transfer; what a shop holds is two small floats, and only one of
//! them is a spending pot:
//!
//!   **cash on hand** — the day's takings. Banked daily, never spent. It is
//!   head office's money in this shop's keeping, and it leaves under a
//!   remittance order this node cannot issue.
//!
//!   **petty cash** — an imprest float, handed over as cash against a head
//!   office transfer. Iuran lingkungan, ATK, parkir, an ojek across town. This
//!   is the pot everything here draws on.
//!
//!   **modal kasir** — the cashier's opening float. Fixed, from head office,
//!   and never an expense route. It is `cash_shift.opening_float_minor` and it
//!   belongs to `till.rs`.
//!
//! So the whole of this module is arithmetic on ONE pot, and the drawer is
//! deliberately unreachable from it: nothing here reads a shift, writes a
//! `cash_movement`, or nets an expense off the day's takings. A shop that could
//! dip into the till for a light bulb is a shop whose cash variance is
//! unreadable, because every shortfall has an explanation available.
//!
//! Functions take a connection and nothing else, like `till.rs` beside them —
//! it keeps them testable and keeps this out of files several other lanes are
//! editing.

use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::contracts::EdgeError;
use super::till::{verify_supervisor, Supervisor};
use crate::reporting::{offset_of, window_of};

fn db(error: rusqlite::Error) -> EdgeError {
    super::sqlite::db(error)
}

/// Micros, matching `reports.rs`, because a span is filtered by comparing these
/// strings against the bounds `window_of` produces — and two stamp precisions
/// on one column is a row that sorts into the wrong day at midnight.
fn stamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}

/// Money in a refusal, written the way the person reading it writes it.
///
/// `"petty cash holds 350000"` is a number somebody has to count digits in
/// while a supplier waits at the counter. These messages are read in a shop,
/// in Indonesian punctuation, so the thousands are grouped with full stops.
fn rupiah(minor: i64) -> String {
    let digits = minor.unsigned_abs().to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3 + 3);
    if minor < 0 {
        grouped.push('-');
    }
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            grouped.push('.');
        }
        grouped.push(digit);
    }
    format!("Rp {grouped}")
}

// ════════════════════════════════════════════════════════════════════════════
// The policy
// ════════════════════════════════════════════════════════════════════════════

/// Above this, an expense needs a one-time code from Finance at head office
/// (owner, 2026-10-02). Whoever is signed in records an expense on their own;
/// nobody else signs.
///
/// The line itself is Finance's setting at the centre
/// (`store_expense.code_above_minor`). The node keeps the last value it learned
/// in `petty_cash_policy` (0073) and uses this until it has learned one.
///
/// In this node's unit, the whole rupiah.
pub const DEFAULT_CODE_ABOVE_MINOR: i64 = 500_000;

/// The line above which an expense needs Finance's code, as last learned.
pub fn code_above(connection: &Connection) -> Result<i64, EdgeError> {
    Ok(connection
        .query_row(
            "SELECT code_above_minor FROM petty_cash_policy WHERE singleton=1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(db)?
        .unwrap_or(DEFAULT_CODE_ABOVE_MINOR))
}

/// Keep the line the centre just said.
pub fn learn_code_above(
    connection: &Connection,
    code_above_minor: i64,
    now: DateTime<Utc>,
) -> Result<(), EdgeError> {
    if code_above_minor < 0 {
        return Ok(());
    }
    connection
        .execute(
            "INSERT INTO petty_cash_policy(singleton,code_above_minor,learned_at)
             VALUES(1,?1,?2)
             ON CONFLICT(singleton) DO UPDATE
                SET code_above_minor=excluded.code_above_minor, learned_at=excluded.learned_at",
            params![code_above_minor, stamp(now)],
        )
        .map_err(db)?;
    Ok(())
}

/// Finance's code, already checked and used up at the centre by the HTTP
/// layer. Never taken from the request body: the handler builds it from the
/// centre's answer.
#[derive(Clone, Debug)]
pub struct ExpenseApproval {
    pub code: String,
    /// Who at head office issued the code.
    pub issued_by: String,
}

/// The shape of an expense category's code. Which categories exist is head
/// office's master data (0465): the centre refuses a code it does not know
/// when the expense arrives, so a new category needs no new build of the shop.
fn is_category_code(code: &str) -> bool {
    let mut chars = code.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

// ════════════════════════════════════════════════════════════════════════════
// What travels, and what waits
// ════════════════════════════════════════════════════════════════════════════

/// The names this shop's small money travels under.
///
/// **Nothing at the centre applies either of them today.** This tree's
/// `cloud/postgres/sync.rs` has no arm for these, and the table they would land
/// in — `store_expense`, with its posting rule and its `petty_cash` account —
/// exists only on the unmerged `feat/finance-control` branch. So the honest
/// description of this lane is: the shop records it, the shop can read it back,
/// and head office cannot see it yet.
///
/// They are captured anyway, and that is a deliberate choice rather than a
/// half-measure. The centre's applier passes an unrecognised `event_type`
/// through with a warning and KEEPS it in the receipt log, explicitly "for a
/// future applier that understands them" — an unknown fact does not block the
/// ordered stream and does not become a dead letter. So capturing costs a log
/// line per expense and buys the shop's whole petty cash history being already
/// at the centre on the day somebody writes the arm that reads it. Not
/// capturing would mean a float that was spent in September being unexplainable
/// in November.
///
/// What must NOT happen is the opposite: an arm added at the centre that posts
/// these to the ledger without the code rule being re-checked there. The
/// refusals in this module protect a till, not a general ledger.
pub const FACT_STORE_EXPENSE_RECORDED: &str = "store.expense.recorded";

/// See `FACT_STORE_EXPENSE_RECORDED`. The same applies: captured, uploaded,
/// unapplied.
pub const FACT_PETTY_CASH_TOPPED_UP: &str = "store.petty_cash.topped_up";

// ════════════════════════════════════════════════════════════════════════════
// What a shop sends
// ════════════════════════════════════════════════════════════════════════════

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordExpenseRequest {
    /// An expense category code from head office's master data (0465).
    pub category: String,
    /// Positive, in whole rupiah. Unsigned, unlike a cash movement: there is
    /// only one direction money leaves a petty cash tin, and a signed column
    /// here would invite a "negative expense" that is really a refund nobody
    /// designed.
    pub amount_minor: i64,
    pub payee: String,
    pub reason: String,
    #[serde(default)]
    pub actor_id: String,
    /// Finance's one-time code. Needed only above `code_above_minor`; the
    /// node checks and uses it up at the centre before the row is written.
    #[serde(default)]
    pub approval_code: Option<String>,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PettyCashTopUpRequest {
    pub amount_minor: i64,
    /// Head office's own reference for the transfer, when the shop was given
    /// one. Free text: it is a slip number, a bank reference, or a date said
    /// over the phone.
    #[serde(default)]
    pub reference: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub actor_id: String,
    /// Cash changing hands with one signature on it is cash nobody can be
    /// asked about, so a handover is counted by two people the same way a
    /// payout is.
    pub supervisor: Supervisor,
    pub idempotency_key: String,
}

/// How much of the shop's own book to read, and over what.
///
/// Not a ts-rs type: it is query string, and it is assembled by the browser
/// from a span the screen already holds. `Deserialize` only, exactly like
/// `reports::SalesWindowQuery`.
#[derive(Clone, Debug, Deserialize)]
pub struct ExpenseWindowQuery {
    pub from: NaiveDate,
    /// Inclusive: a reader asking for the first to the thirtieth means the
    /// thirtieth to be in it.
    pub to: NaiveDate,
    pub utc_offset_minutes: Option<i32>,
    /// How many receipts to list. The totals are computed over the whole span
    /// regardless, so a truncated list never makes the summary lie.
    pub limit: Option<i64>,
    /// `true` reads the span as ONE book — receipts and hand-overs merged,
    /// newest first — a page at a time, with `limit` the size of the page and
    /// `next_cursor` on the answer where the page stopped. Absent is the
    /// original read: the newest `limit` of each half, side by side, which is
    /// what the shop's own screen still asks for.
    ///
    /// Opt-in rather than the new default because the two reads split `limit`
    /// differently — the book shares it between both halves — and a caller
    /// that never asked for a page should not find its receipt list shorter.
    pub paged: Option<bool>,
    /// The previous page's `next_cursor`. Implies `paged`.
    pub cursor: Option<String>,
}

/// Where a page of the merged book stopped: the last line's instant and id.
///
/// Both halves are ordered by the same pair, so one cursor seeks both. The id
/// is the tie-break — two lines stamped in the same microsecond are ordered by
/// it rather than repeated or lost across a page boundary.
#[derive(Serialize, Deserialize)]
struct BookCursor {
    at: String,
    id: String,
}

fn encode_book_cursor(cursor: &BookCursor) -> Result<String, EdgeError> {
    let bytes =
        serde_json::to_vec(cursor).map_err(|error| EdgeError::Validation(error.to_string()))?;
    Ok(hex::encode(bytes))
}

fn decode_book_cursor(raw: &str) -> Result<BookCursor, EdgeError> {
    let refused = || EdgeError::Validation("cursor is not a cursor this node issued".into());
    let bytes = hex::decode(raw).map_err(|_| refused())?;
    serde_json::from_slice(&bytes).map_err(|_| refused())
}

// ════════════════════════════════════════════════════════════════════════════
// What a shop reads back
// ════════════════════════════════════════════════════════════════════════════

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreExpenseView {
    pub id: String,
    pub category: String,
    pub amount_minor: i64,
    pub payee: String,
    pub reason: String,
    pub claimed_by: String,
    /// Who issued Finance's code, for an expense above the line. Empty for an
    /// ordinary one; older rows keep the manager who signed for them.
    pub approved_by: Option<String>,
    /// `FINANCE` for a code; `SUPERVISOR` / `ADMIN` on rows from before
    /// 2026-10-02.
    pub approved_role: Option<String>,
    pub approval_code: Option<String>,
    pub spent_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PettyCashTopUpView {
    pub id: String,
    pub amount_minor: i64,
    pub reference: Option<String>,
    pub note: Option<String>,
    pub received_by: String,
    pub approved_by: String,
    pub received_at: String,
}

/// What is in the tin, and how it got there.
///
/// Over the life of the float rather than over a span, deliberately. An imprest
/// balance is not a period figure: the money handed over in July is still in the
/// tin in September, and a "balance" that only counted this month's top-ups
/// would report a shop as broke every first of the month.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PettyCashPosition {
    /// Everything head office has ever handed over.
    pub float_in_minor: i64,
    pub spent_minor: i64,
    /// `float_in − spent`. Never stored: a balance column beside the movements
    /// that make it is a second source for one number, and the one nobody looks
    /// at is the one that drifts.
    pub balance_minor: i64,
    pub top_up_count: i64,
    pub expense_count: i64,
    pub last_top_up_at: Option<String>,
    /// Above this an expense needs Finance's code. Sent so the form asks for
    /// the code only when it is needed.
    pub code_above_minor: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExpenseRecorded {
    pub expense: StoreExpenseView,
    /// The tin after this. Returned with the write for the same reason a cash
    /// movement answers with the whole Z report: the number that just changed
    /// is the number the person is looking at.
    pub position: PettyCashPosition,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PettyCashTopUpRecorded {
    pub top_up: PettyCashTopUpView,
    pub position: PettyCashPosition,
}

/// One span of the shop's petty cash book.
///
/// Deliberately NOT carrying the position. The tin is a lifetime figure and
/// this is a span, and folding one into the other would mean the balance
/// blinking — refetched, identical, redrawn — every time somebody changed the
/// span on a screen. The position has a route of its own, cached under a key of
/// its own, and both writes above answer with it, so a screen never has to ask
/// twice for a number it just changed.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExpenseWindow {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub utc_offset_minutes: i32,
    /// What was spent over the WHOLE span, whether or not every row is listed.
    pub spent_minor: i64,
    pub count: i64,
    pub expenses: Vec<StoreExpenseView>,
    /// Said plainly rather than left to be inferred from a length: a list that
    /// stops at the limit and a shop that spent exactly that many times look
    /// identical, and only one of them means "there is more".
    pub truncated: bool,
    pub limit: i64,
    /// What came IN over the same span, so the book reads as one page rather
    /// than two screens a manager has to hold in their head.
    pub top_ups: Vec<PettyCashTopUpView>,
    /// What was handed over across the WHOLE span, and how many times —
    /// the other half's `spent_minor` and `count`, so a paged book can total
    /// both columns without adding up the lines it happens to hold.
    #[serde(default)]
    pub top_up_minor: i64,
    #[serde(default)]
    pub top_up_count: i64,
    /// Where the next page of the merged book starts. Only a `paged` read
    /// sets it, and `None` there means the book ends here.
    #[serde(default)]
    pub next_cursor: Option<String>,
}

// ════════════════════════════════════════════════════════════════════════════
// Spending it
// ════════════════════════════════════════════════════════════════════════════

/// Record an expense paid out of petty cash.
///
/// Whoever is signed in records it; nobody else signs (owner, 2026-10-02).
/// Refused here, not only in the browser:
///
///   1. a category the chart knows, or nothing;
///   2. an amount, a payee and a reason;
///   3. more than the tin holds;
///   4. above `code_above_minor`, no Finance code. The code itself is checked
///      and used up at the centre by the HTTP layer, which hands the result in
///      as `approval`.
pub fn record_expense(
    tx: &Transaction<'_>,
    request: &RecordExpenseRequest,
    approval: Option<&ExpenseApproval>,
    now: DateTime<Utc>,
) -> Result<ExpenseRecorded, EdgeError> {
    let category = request.category.trim().to_string();
    if !is_category_code(&category) {
        return Err(EdgeError::Validation(format!(
            "'{category}' is not an expense category code"
        )));
    }
    if request.amount_minor <= 0 {
        return Err(EdgeError::Validation("Enter an amount.".into()));
    }
    let payee = request.payee.trim();
    if payee.is_empty() {
        return Err(EdgeError::Validation("Enter who was paid.".into()));
    }
    let reason = request.reason.trim();
    if reason.is_empty() {
        return Err(EdgeError::Validation("Enter what it was for.".into()));
    }

    let tin = position(tx)?;
    if request.amount_minor > tin.balance_minor {
        return Err(EdgeError::Conflict(format!(
            "Petty cash holds {}. This is {}.",
            rupiah(tin.balance_minor),
            rupiah(request.amount_minor)
        )));
    }

    let line = tin.code_above_minor;
    let approval = if request.amount_minor > line {
        Some(approval.ok_or_else(|| {
            EdgeError::Forbidden(format!(
                "Above {} an expense needs an approval code from Finance.",
                rupiah(line)
            ))
        })?)
    } else {
        None
    };

    let claimant =
        crate::security::normalize_username(&request.actor_id).map_err(EdgeError::Validation)?;
    let approved_by = approval.map(|one| one.issued_by.clone());
    let approved_role = approval.map(|_| "FINANCE".to_string());
    let approval_code = approval.map(|one| one.code.clone());

    let id = Uuid::new_v4().to_string();
    let spent_at = stamp(now);
    tx.execute(
        "INSERT INTO store_expense(id,idempotency_key,category,amount_minor,payee,reason,
                                   claimed_by,approved_by,approved_role,approval_code,spent_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![
            id,
            request.idempotency_key,
            category,
            request.amount_minor,
            payee,
            reason,
            claimant,
            approved_by,
            approved_role,
            approval_code,
            spent_at
        ],
    )
    .map_err(db)?;

    Ok(ExpenseRecorded {
        expense: StoreExpenseView {
            id,
            category,
            amount_minor: request.amount_minor,
            payee: payee.to_owned(),
            reason: reason.to_owned(),
            claimed_by: claimant,
            approved_by,
            approved_role,
            approval_code,
            spent_at,
        },
        position: position(tx)?,
    })
}

/// Record the float head office handed over.
///
/// Not an expense and not a sale: this is the imprest being put back, and the
/// cost it covers was written down one receipt at a time as it was spent.
/// Signed for by two people, because that is what handing over cash is.
pub fn record_top_up(
    tx: &Transaction<'_>,
    request: &PettyCashTopUpRequest,
    now: DateTime<Utc>,
) -> Result<PettyCashTopUpRecorded, EdgeError> {
    if request.amount_minor <= 0 {
        return Err(EdgeError::Validation(
            "a top-up of nothing tops nothing up".into(),
        ));
    }
    let approver = verify_supervisor(tx, Some(&request.supervisor))?;
    let receiver =
        crate::security::normalize_username(&request.actor_id).map_err(EdgeError::Validation)?;
    // The same maker/checker rule the expense keeps, for the same reason: one
    // person who can both receive a float and sign for it is one person who can
    // invent one.
    if approver == receiver {
        return Err(EdgeError::Forbidden(
            "the person who took the money does not also sign for it. Somebody else counts it \
             with them."
                .into(),
        ));
    }

    let id = Uuid::new_v4().to_string();
    let received_at = stamp(now);
    let reference = request
        .reference
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let note = request
        .note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    tx.execute(
        "INSERT INTO petty_cash_top_up(id,idempotency_key,amount_minor,reference,note,
                                       received_by,approved_by,received_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            id,
            request.idempotency_key,
            request.amount_minor,
            reference,
            note,
            receiver,
            approver,
            received_at
        ],
    )
    .map_err(db)?;

    Ok(PettyCashTopUpRecorded {
        top_up: PettyCashTopUpView {
            id,
            amount_minor: request.amount_minor,
            reference: reference.map(str::to_owned),
            note: note.map(str::to_owned),
            received_by: receiver,
            approved_by: approver,
            received_at,
        },
        position: position(tx)?,
    })
}

// ════════════════════════════════════════════════════════════════════════════
// Reading it back
// ════════════════════════════════════════════════════════════════════════════

/// What is in the tin.
///
/// Two sums and a subtraction, computed on every read rather than kept. See
/// `PettyCashPosition::balance_minor` for why there is no column.
pub fn position(connection: &Connection) -> Result<PettyCashPosition, EdgeError> {
    let (float_in_minor, top_up_count, last_top_up_at) = connection
        .query_row(
            "SELECT COALESCE(SUM(amount_minor),0), COUNT(*), MAX(received_at)
               FROM petty_cash_top_up",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .map_err(db)?;
    let (spent_minor, expense_count) = connection
        .query_row(
            "SELECT COALESCE(SUM(amount_minor),0), COUNT(*) FROM store_expense",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(db)?;
    Ok(PettyCashPosition {
        float_in_minor,
        spent_minor,
        balance_minor: float_in_minor - spent_minor,
        top_up_count,
        expense_count,
        last_top_up_at,
        code_above_minor: code_above(connection)?,
    })
}

/// The shop's petty cash book over a span.
///
/// The span is the shop's own wall clock, not UTC: `spent_at` is RFC3339 in UTC
/// and `window_of` turns two local dates into the instants that bound them, the
/// same way the sales window does. A shop asking for "today" before its own
/// clock has passed UTC's midnight otherwise gets yesterday.
pub fn window(
    connection: &Connection,
    query: &ExpenseWindowQuery,
) -> Result<ExpenseWindow, EdgeError> {
    // The caller's offset, else this shop's own clock as head office told it.
    let utc_offset_minutes = offset_of(
        query
            .utc_offset_minutes
            .or_else(|| crate::edge::site_profile::own_utc_offset_minutes(connection)),
    );
    let (start, end) =
        window_of(query.from, query.to, utc_offset_minutes).map_err(EdgeError::Validation)?;
    let limit = query.limit.unwrap_or(100).clamp(1, 500);

    let (spent_minor, count) = connection
        .query_row(
            "SELECT COALESCE(SUM(amount_minor),0), COUNT(*) FROM store_expense
              WHERE spent_at >= ?1 AND spent_at < ?2",
            params![stamp(start), stamp(end)],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(db)?;
    let (top_up_minor, top_up_count) = connection
        .query_row(
            "SELECT COALESCE(SUM(amount_minor),0), COUNT(*) FROM petty_cash_top_up
              WHERE received_at >= ?1 AND received_at < ?2",
            params![stamp(start), stamp(end)],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(db)?;

    if query.paged == Some(true) || query.cursor.is_some() {
        let cursor = query
            .cursor
            .as_deref()
            .map(decode_book_cursor)
            .transpose()?;
        let (expenses, top_ups, next_cursor) =
            book_page(connection, &stamp(start), &stamp(end), cursor, limit)?;
        return Ok(ExpenseWindow {
            from: query.from,
            to: query.to,
            utc_offset_minutes,
            spent_minor,
            count,
            truncated: next_cursor.is_some(),
            limit,
            expenses,
            top_ups,
            top_up_minor,
            top_up_count,
            next_cursor,
        });
    }

    let mut expenses = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id,category,amount_minor,payee,reason,claimed_by,approved_by,
                        approved_role,approval_code,spent_at
                   FROM store_expense
                  WHERE spent_at >= ?1 AND spent_at < ?2
                  ORDER BY spent_at DESC, id DESC
                  LIMIT ?3",
            )
            .map_err(db)?;
        let rows = statement
            .query_map(params![stamp(start), stamp(end), limit], |row| {
                Ok(StoreExpenseView {
                    id: row.get(0)?,
                    category: row.get(1)?,
                    amount_minor: row.get(2)?,
                    payee: row.get(3)?,
                    reason: row.get(4)?,
                    claimed_by: row.get(5)?,
                    approved_by: row.get(6)?,
                    approved_role: row.get(7)?,
                    approval_code: row.get(8)?,
                    spent_at: row.get(9)?,
                })
            })
            .map_err(db)?;
        for row in rows {
            expenses.push(row.map_err(db)?);
        }
    }

    // The top-ups of the same span, so "what came in and what went out" reads
    // as one page rather than two screens a manager has to hold in their head.
    let mut top_ups = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id,amount_minor,reference,note,received_by,approved_by,received_at
                   FROM petty_cash_top_up
                  WHERE received_at >= ?1 AND received_at < ?2
                  ORDER BY received_at DESC, id DESC
                  LIMIT ?3",
            )
            .map_err(db)?;
        let rows = statement
            .query_map(params![stamp(start), stamp(end), limit], |row| {
                Ok(PettyCashTopUpView {
                    id: row.get(0)?,
                    amount_minor: row.get(1)?,
                    reference: row.get(2)?,
                    note: row.get(3)?,
                    received_by: row.get(4)?,
                    approved_by: row.get(5)?,
                    received_at: row.get(6)?,
                })
            })
            .map_err(db)?;
        for row in rows {
            top_ups.push(row.map_err(db)?);
        }
    }

    Ok(ExpenseWindow {
        from: query.from,
        to: query.to,
        utc_offset_minutes,
        spent_minor,
        count,
        truncated: count > i64::try_from(expenses.len()).unwrap_or(i64::MAX),
        limit,
        expenses,
        top_ups,
        top_up_minor,
        top_up_count,
        next_cursor: None,
    })
}

/// One page of the merged book: receipts and hand-overs over `[start, end)`,
/// newest first, after `cursor`.
///
/// One `UNION ALL` ordered by `(at, id)` rather than two lists each cut at
/// `limit`: two independently capped halves cannot be paged as one book — the
/// hand-overs on page one could reach back further than the receipts do, and
/// page two would then draw receipts above hand-overs already shown. The
/// columns the two halves do not share are NULL on the other side and the page
/// is split back into the two lists the answer has always carried.
fn book_page(
    connection: &Connection,
    start: &str,
    end: &str,
    cursor: Option<BookCursor>,
    limit: i64,
) -> Result<
    (
        Vec<StoreExpenseView>,
        Vec<PettyCashTopUpView>,
        Option<String>,
    ),
    EdgeError,
> {
    let (after_at, after_id) = match cursor {
        Some(cursor) => (Some(cursor.at), Some(cursor.id)),
        None => (None, None),
    };
    let mut statement = connection
        .prepare(
            "SELECT kind,id,at,amount_minor,category,party,reason,claimed_by,
                    approved_by,approved_role,approval_code
               FROM (
                 SELECT 'EXPENSE' AS kind,id,spent_at AS at,amount_minor,category,
                        payee AS party,reason,claimed_by,approved_by,approved_role,
                        approval_code
                   FROM store_expense
                  WHERE spent_at >= ?1 AND spent_at < ?2
                 UNION ALL
                 SELECT 'TOP_UP',id,received_at,amount_minor,NULL,
                        reference,note,received_by,approved_by,NULL,NULL
                   FROM petty_cash_top_up
                  WHERE received_at >= ?1 AND received_at < ?2
               )
              WHERE ?3 IS NULL OR at < ?3 OR (at = ?3 AND id < ?4)
              ORDER BY at DESC, id DESC
              LIMIT ?5",
        )
        .map_err(db)?;
    // One more than asked for, so whether another page exists is answered by
    // the same scan rather than by a second count.
    let mut lines = statement
        .query_map(params![start, end, after_at, after_id, limit + 1], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
            ))
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    let more = i64::try_from(lines.len()).unwrap_or(i64::MAX) > limit;
    lines.truncate(usize::try_from(limit).unwrap_or(usize::MAX));
    let next_cursor = match (more, lines.last()) {
        (true, Some(last)) => Some(encode_book_cursor(&BookCursor {
            at: last.2.clone(),
            id: last.1.clone(),
        })?),
        _ => None,
    };

    let mut expenses = Vec::new();
    let mut top_ups = Vec::new();
    for (
        kind,
        id,
        at,
        amount_minor,
        category,
        party,
        reason,
        claimed_by,
        approved_by,
        role,
        approval_code,
    ) in lines
    {
        if kind == "EXPENSE" {
            expenses.push(StoreExpenseView {
                id,
                category: category.unwrap_or_default(),
                amount_minor,
                payee: party.unwrap_or_default(),
                reason: reason.unwrap_or_default(),
                claimed_by,
                approved_by,
                approved_role: role,
                approval_code,
                spent_at: at,
            });
        } else {
            top_ups.push(PettyCashTopUpView {
                id,
                amount_minor,
                reference: party,
                note: reason,
                received_by: claimed_by,
                approved_by: approved_by.unwrap_or_default(),
                received_at: at,
            });
        }
    }
    Ok((expenses, top_ups, next_cursor))
}
