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

fn now() -> DateTime<Utc> {
    Utc::now()
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

/// Up to this, the shop's own manager approves. Above it, head office does.
///
/// Five hundred thousand rupiah, the owner's own line (2026-09-07). A constant
/// rather than a settings row, because it is company policy and not a per-shop
/// preference, and a settings table nobody has a screen for is a number nobody
/// can change anyway.
///
/// **In this node's unit, which is the rupiah.** Every `_minor` on the edge is
/// a whole rupiah — a Rp 500.000 opening float is `500_000`, a Rp 149.000
/// garment is `149_000` — and `money()` in the browser treats IDR as a
/// zero-decimal currency to match. The centre's unmerged `store_cash.rs` spells
/// the same policy `500_000_00`, which is a hundred times this number in the
/// unit the centre stores sales in; whoever merges the two lanes has to settle
/// that, and this side is the one that agrees with every other figure a till
/// has ever written.
pub const STORE_EXPENSE_MANAGER_LIMIT_MINOR: i64 = 500_000;

/// The nine kinds of cost a shop may file against.
///
/// The same nine the centre's `store_expense` constrains, named identically, so
/// a row written here maps to a posting rule there without a translation table
/// in between. Adding a tenth is a line here, a line in the migration, a line
/// in the centre's CHECK, and a considered decision about the client's chart.
pub const EXPENSE_CATEGORIES: [&str; 9] = [
    "expense_electricity",
    "expense_water",
    "expense_telephone",
    "expense_household",
    "expense_stationery",
    "expense_repairs",
    "expense_transport",
    "expense_cleaning",
    "expense_misc",
];

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
/// these to the ledger without the maker/checker and the limit being re-checked
/// there. The refusals in this module protect a till, not a general ledger.
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
    /// One of `EXPENSE_CATEGORIES`. Refused by name rather than silently filed
    /// under miscellaneous, because a cost in the wrong account is a cost
    /// nobody finds again.
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
    /// The second pair of eyes. Not optional: every rupiah out of the tin is
    /// signed for, which is the control that survives the manager being the
    /// only person in the building.
    pub supervisor: Supervisor,
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
    pub approved_by: String,
    /// Which rung said yes, kept because the limit may move and an audit six
    /// months later asks who was allowed to approve this, then.
    pub approved_role: String,
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
    /// Sent so the screen can show the ceiling BEFORE somebody types past it.
    /// A limit a person only meets as a refusal is a limit they meet with the
    /// receipt already in their hand and the money already gone.
    pub manager_limit_minor: i64,
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
}

// ════════════════════════════════════════════════════════════════════════════
// Spending it
// ════════════════════════════════════════════════════════════════════════════

/// Record an expense paid out of petty cash.
///
/// Five refusals live here and none of them lives in the browser. A screen that
/// enforced the ceiling would be a screen, and this node answers a browser it
/// did not write, a tablet running an old build, and curl.
///
///   1. a category the chart knows, or nothing;
///   2. an amount, a payee and a reason — a row without any of the three is a
///      receipt nobody can audit;
///   3. a supervisor who is really a supervisor, verified against `edge_user`
///      the same way a void's is;
///   4. an approver who is not the claimant, at any amount and with no
///      override — an override is the only feature of this control that ever
///      gets used;
///   5. a rung high enough for the size: above Rp 500.000 a store manager may
///      not say yes, and head office has to.
///
/// And one more that is arithmetic rather than policy: an expense larger than
/// what is in the tin is money that did not come out of the tin. It is refused
/// with the balance named, because the honest fix is to record the top-up head
/// office already made, not to let the float go negative and call it petty cash.
pub fn record_expense(
    tx: &Transaction<'_>,
    request: &RecordExpenseRequest,
) -> Result<ExpenseRecorded, EdgeError> {
    let category = request.category.trim().to_ascii_lowercase();
    if !EXPENSE_CATEGORIES.contains(&category.as_str()) {
        return Err(EdgeError::Validation(format!(
            "'{category}' is not a kind of cost this shop can file against; it is one of {}",
            EXPENSE_CATEGORIES.join(", ")
        )));
    }
    if request.amount_minor <= 0 {
        return Err(EdgeError::Validation(
            "an expense of nothing records nothing".into(),
        ));
    }
    let payee = request.payee.trim();
    if payee.is_empty() {
        return Err(EdgeError::Validation(
            "an expense needs a payee — who was handed the money".into(),
        ));
    }
    let reason = request.reason.trim();
    if reason.is_empty() {
        return Err(EdgeError::Validation(
            "an expense needs a reason — what the money was for".into(),
        ));
    }

    // Before the password is asked for. Somebody standing at a counter typing
    // a supervisor's credentials only to be told the tin is empty has been
    // asked for a secret for nothing.
    let tin = position(tx)?;
    if request.amount_minor > tin.balance_minor {
        return Err(EdgeError::Conflict(format!(
            "petty cash holds {} and this is {}. The drawer and the day's takings are not \
             available for it: record the top-up head office handed over, or send this to head \
             office to pay by transfer.",
            rupiah(tin.balance_minor),
            rupiah(request.amount_minor)
        )));
    }

    // The same verification a void takes, and the same one function. A second
    // implementation of "is this really a supervisor" is a second place for the
    // answer to drift, and this one already refuses an inactive account, a
    // cashier, and a wrong password with one indistinguishable message.
    let approver = verify_supervisor(tx, Some(&request.supervisor))?;
    let claimant =
        crate::security::normalize_username(&request.actor_id).map_err(EdgeError::Validation)?;
    if approver == claimant {
        return Err(EdgeError::Forbidden(
            "the person who spent the money does not approve it. Somebody else signs.".into(),
        ));
    }

    let role = role_of(tx, &approver)?;
    if request.amount_minor > STORE_EXPENSE_MANAGER_LIMIT_MINOR && role != "ADMIN" {
        return Err(EdgeError::Forbidden(format!(
            "a store manager may approve up to {} out of petty cash. {} is above that, and head \
             office has to approve it.",
            rupiah(STORE_EXPENSE_MANAGER_LIMIT_MINOR),
            rupiah(request.amount_minor)
        )));
    }

    let id = Uuid::new_v4().to_string();
    let spent_at = stamp(now());
    tx.execute(
        "INSERT INTO store_expense(id,idempotency_key,category,amount_minor,payee,reason,
                                   claimed_by,approved_by,approved_role,spent_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            id,
            request.idempotency_key,
            category,
            request.amount_minor,
            payee,
            reason,
            claimant,
            approver,
            role,
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
            approved_by: approver,
            approved_role: role,
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
    let received_at = stamp(now());
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
        manager_limit_minor: STORE_EXPENSE_MANAGER_LIMIT_MINOR,
    })
}

/// The shop's petty cash book over a span.
///
/// The span is the shop's own wall clock, not UTC: `spent_at` is RFC3339 in UTC
/// and `window_of` turns two local dates into the instants that bound them, the
/// same way the sales window does. A shop in Jakarta asking for "today" before
/// seven in the morning otherwise gets yesterday.
pub fn window(
    connection: &Connection,
    query: &ExpenseWindowQuery,
) -> Result<ExpenseWindow, EdgeError> {
    let utc_offset_minutes = offset_of(query.utc_offset_minutes);
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

    let mut expenses = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id,category,amount_minor,payee,reason,claimed_by,approved_by,
                        approved_role,spent_at
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
                    spent_at: row.get(8)?,
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
    })
}

/// Which rung an approver holds.
///
/// Read after `verify_supervisor` rather than instead of it. That function
/// returns a username and nothing else — on purpose, because every other caller
/// only needs to know that somebody signed — and the size limit is the one rule
/// in this estate that needs to know WHICH somebody. Reading the row twice is
/// cheaper than a second credential check, and far cheaper than a copy of
/// `verify_supervisor` that returns more and drifts.
fn role_of(connection: &Connection, username: &str) -> Result<String, EdgeError> {
    connection
        .query_row(
            "SELECT role FROM edge_user WHERE username=?1",
            [username],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?
        // Unreachable through the handler: `verify_supervisor` has just read
        // this row. Refused rather than defaulted, because a default here would
        // be a default APPROVAL RUNG, and the safe direction for one of those
        // is "no".
        .ok_or_else(|| EdgeError::Unauthorized("supervisor authorisation refused".into()))
}
