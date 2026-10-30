//! The till's day: a drawer that opens and closes, and a sale the shop can
//! take back.
//!
//! Three things live here that a counter cannot work without, and that this
//! node has never had:
//!
//! **The shift.** Without one there is no answer to "how much should be in
//! this drawer right now", so every cash difference is discovered weeks later
//! as a mystery instead of that evening at the counter. The close is blind on
//! purpose — a cashier shown the expected figure counts toward it.
//!
//! **The void and the return.** Neither is an edit. The sale keeps its total
//! and its lines; what changes is that a reversing movement carries the
//! garments home and the money going back out is written down. `sale.status`
//! used to be `CHECK (status = 'COMPLETED')`, which is why neither existed.
//!
//! **The receipt.** Assembled here, rendered by `escpos.rs`, sent down the
//! same TCP socket `printing.rs` already uses for labels. The shop's own
//! printer is on the shop's own LAN, which is the whole reason the edge does
//! this and the centre cannot.
//!
//! Functions take a connection and the business instant as plain arguments,
//! like `printing.rs` and `outbound.rs` beside them: it keeps them testable
//! and keeps this out of a file several other workstreams are editing. The
//! instant comes from the caller's clock (`SqliteEdge`), so a shift follows
//! the business clock, not the wall (VIRTUAL-TIME-PLAN.md §3).

use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::contracts::EdgeError;
use super::escpos::{
    self, DrawerMode, PaperWidth, ReceiptCharge, ReceiptDocument, ReceiptLine, ReceiptTender,
};

fn db(error: rusqlite::Error) -> EdgeError {
    super::sqlite::db(error)
}

fn stamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Secs, true)
}

// ════════════════════════════════════════════════════════════════════════════
// The shift
// ════════════════════════════════════════════════════════════════════════════

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpenShiftRequest {
    /// Which seat — `KASIR-1` … `KASIR-N`, head office's number of them
    /// ([`seat_ids`]). One seat, one drawer: two shifts open at the same one
    /// would each believe the other's cash was theirs.
    pub terminal_id: String,
    pub opening_float_minor: i64,
    #[serde(default)]
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CashMovementRequest {
    pub kind: String,
    /// Signed. Money into the drawer is positive, out is negative — a
    /// magnitude plus a direction column is the same number written twice, and
    /// the two disagree the first time somebody writes a negative payout.
    ///
    /// Two exceptions (client, 24 Oct 2026): a `FLOAT_RETURN` is the float
    /// handed over, read as money out whatever its sign; and a `DROP` may be
    /// nought, its amount left for the Kepala toko to write on the slip.
    pub amount_minor: i64,
    pub reason: String,
    #[serde(default)]
    pub actor_id: String,
    /// A payout needs a second pair of eyes; a safe drop does not.
    #[serde(default)]
    pub supervisor: Option<Supervisor>,
    /// Who took the cash, for a drop that leaves the drawer for somebody's
    /// hands. Optional: the till has always posted a drop by amount alone.
    #[serde(default)]
    pub received_by: Option<String>,
    /// The handful the movement was counted from, one row per note or coin.
    /// Optional, and only for a `DROP`, a `PICKUP` or a `FLOAT_RETURN`; when it
    /// is sent it must add up to the amount exactly, the way the close's sheet
    /// does.
    #[serde(default)]
    pub counted: Vec<CashCount>,
    pub idempotency_key: String,
    /// Set by the router, never by the caller: the person signed in is a
    /// supervisor or an admin, who may act on a drawer that is not theirs.
    #[serde(skip)]
    #[cfg_attr(feature = "ts", ts(skip))]
    pub supervising: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CloseShiftRequest {
    /// What the cashier counted. Sent without the expected figure ever having
    /// been disclosed — and a cashier is not shown it afterwards either (see
    /// `ShiftReport`); the variance is the supervisor's to read.
    pub declared_cash_minor: i64,
    /// The sheet the declared figure was added up from, one row per note or
    /// coin. Optional — a till that counts only a total still closes — but
    /// when it is sent it must add up to `declared_cash_minor` exactly.
    #[serde(default)]
    pub counted: Vec<CashCount>,
    /// How many slips each EDC machine printed, as the cashier counted them
    /// (client, 25 Oct 2026) — blind like the cash: the machines come from
    /// `/shifts/{id}/edc-machines`, which names them and nothing else.
    /// Optional; skipped on the way out when empty, so a request from before
    /// is recorded exactly as it always was.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edc_slips: Vec<EdcSlipCount>,
    /// How many paper vouchers the shoppers paid with, counted off the drawer
    /// (Hari, 30 Oct 2026): sheets, blind like the slips. Optional; skipped on
    /// the way out when absent, so a request from before replays the same.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vouchers: Option<i64>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub actor_id: String,
    pub idempotency_key: String,
    /// Set by the router, never by the caller: see [`CashMovementRequest`].
    #[serde(skip)]
    #[cfg_attr(feature = "ts", ts(skip))]
    pub supervising: bool,
}

/// One EDC machine as Tutup kasir asks about it: a name to count slips off,
/// and no figure (client, 25 Oct 2026).
///
/// A shop has one machine per bank (postgres 0989), so the machine is the bank
/// each card and QRIS tender names as `acquirer`; a bank's QRIS counts on that
/// bank's machine.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ShiftEdcMachine {
    /// The bank, upper-cased: `BCA`.
    pub machine_id: String,
    /// The bank as the cashier says it: `BCA`, `Mandiri`.
    pub machine_name: String,
}

/// What the cashier counted off one machine.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EdcSlipCount {
    pub machine_id: String,
    pub slips: i64,
}

/// One machine on the shift report: the slips counted, and the node's own
/// count of the card and QRIS tenders taken on it.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ShiftEdcSlip {
    pub machine_id: String,
    pub machine_name: String,
    /// As the cashier counted them; null until the drawer is counted.
    pub slips: Option<i64>,
    /// Every card and QRIS tender rung on this machine in the shift, a voided
    /// sale's included: each printed its slip when it was taken. Null for a
    /// cashier, like the expected cash (`http.rs`, `blind_for_cashier`).
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub expected: i64,
}

/// Open your own drawer at a free seat. A seat somebody else is holding is
/// refused: their drawer is counted and closed first (owner, 23 Oct 2026).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TakeOverRequest {
    pub terminal_id: String,
    /// The float the person arriving counts in. A new shift always starts
    /// from its own float.
    pub opening_float_minor: i64,
    #[serde(default)]
    pub actor_id: String,
    pub idempotency_key: String,
    /// The Kepala toko who opened the till for this cashier and hands the
    /// float over: "Diserahkan" on the MODAL AWAL slip. Absent when the
    /// cashier opened alone; the slip then names the cashier on both sides.
    #[serde(default)]
    pub handed_by: Option<String>,
}

/// The shift it opened. `ended` is always null now: nobody's shift is ended
/// by another person opening.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TakeOverOutcome {
    pub ended: Option<ShiftReport>,
    pub shift: ShiftReport,
}

/// One seat at the counter, and who holds it now.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TillSeat {
    /// `KASIR-1`. What a shift and a receipt carry.
    pub terminal_id: String,
    /// `Kasir 1`. What a person reads.
    pub label: String,
    /// False for a seat that is no longer in head office's number but still
    /// has a drawer open — it is listed so the drawer can be closed, and no
    /// new shift opens at it.
    pub current: bool,
    pub shift_id: Option<String>,
    pub held_by: Option<String>,
    pub held_since: Option<String>,
}

/// The shifts that are one person's to deal with: the drawer they hold now,
/// and the ones somebody took over from them that they have not counted yet.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MyShifts {
    pub open: Option<ShiftReport>,
    pub uncounted: Vec<ShiftReport>,
}

/// One line of a drawer count: this many pieces of this denomination.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CashCount {
    pub value_minor: i64,
    pub pieces: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CashMovementView {
    pub id: String,
    pub kind: String,
    pub amount_minor: i64,
    pub reason: String,
    pub actor_id: String,
    pub approved_by: Option<String>,
    /// Who took the cash, when the drop said.
    #[serde(default)]
    pub received_by: Option<String>,
    /// The sheet the movement was counted from; empty when it was written by
    /// amount alone.
    #[serde(default)]
    pub counted: Vec<CashCount>,
    /// The slip it handed out — `TM-0004`, `SM-0002`, `ST-0008` — which the
    /// closing paper prints beside it. Null for a movement with no slip.
    #[serde(default)]
    pub slip_no: Option<String>,
    pub occurred_at: String,
}

/// One sale on a drawer, as a session sheet lists it: the number a customer
/// reads back, when it was rung, what it came to and how it was paid.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ShiftSale {
    pub sale_id: String,
    pub receipt_no: String,
    pub completed_at: String,
    pub cashier: String,
    /// `COMPLETED` or `VOIDED`.
    pub status: String,
    pub total_minor: i64,
    pub change_minor: i64,
    /// Refunded against this sale since.
    pub returned_minor: i64,
    /// The pieces on it: its tagged lines and those sold without a tag.
    #[serde(default)]
    pub pcs: i64,
    pub tenders: Vec<ShiftSaleTender>,
}

/// One return made at a drawer, as Transactions lists it (Hari, 30 Oct
/// 2026): a transaction of its own, on its own receipt, at the time and drawer
/// it was made — never a minus on the struk it came from.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ShiftReturn {
    pub return_id: String,
    /// The return's own number: the replacement sale's, or its own when
    /// nothing went out.
    pub receipt_no: String,
    pub occurred_at: String,
    pub cashier: String,
    /// The struk the pieces came back from.
    pub from_receipt_no: String,
    /// The sale that carried the replacements; its row is this return.
    pub replacement_sale_id: Option<String>,
    pub back_pcs: i64,
    pub out_pcs: i64,
    pub back_minor: i64,
    pub replacement_minor: i64,
    /// What the customer paid on top; never negative, a cheaper replacement
    /// pays nothing back.
    pub paid_minor: i64,
}

/// One sale as the receipt search listed it. The search is gone (Hari, 28 Oct
/// 2026: a struk is found only by its whole number, `lookup_receipt`); the
/// shape stays for the contract until the till stops naming it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaleSearchRow {
    pub sale_id: String,
    /// The number the receipt carries: the till's seven letters, or the
    /// derived number of a sale from before them.
    pub receipt_no: String,
    pub completed_at: String,
    /// Who rang it, by name.
    pub cashier_name: String,
    pub total_minor: i64,
    pub pcs: i64,
    pub tenders: Vec<ShiftSaleTender>,
    /// `PAID`; `VOIDED`; or `RETURNED` once anything has come back against
    /// it, all of it or part.
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ShiftSaleTender {
    pub method: String,
    pub amount_minor: i64,
    /// `DEBIT` or `CREDIT` on a card; null on every other tender, and on a
    /// card rung before the till sent it.
    pub card_kind: Option<String>,
    /// The EDC's bank, as the till named it.
    pub acquirer: Option<String>,
    pub reference: Option<String>,
}

/// The Z report — one shift, closed or still running.
///
/// Cash and non-cash are separated because only cash is in the drawer. A till
/// whose report added a card sale to the expected float would report a
/// shortage every single evening.
///
/// # Blind for the person who counts
///
/// The close is blind, and a close that is blind only on one screen is not
/// blind: the same figures were a `GET` away. So a CASHIER is served this
/// report with `blind: true` and every figure the expectation can be worked
/// back from set to null — the takings by kind, the change, the refunds, the
/// per-tender totals, the expectation and the variance (`http.rs`,
/// `blind_for_cashier`). Supervisors and admins read it whole. The struct
/// itself always carries the numbers; the fields marked `number | null` in
/// the contract are the ones a cashier receives empty.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ShiftReport {
    pub shift_id: String,
    pub terminal_id: String,
    /// `Kasir 1` for a seat; the id itself for a till from before seats.
    #[serde(default)]
    pub terminal_label: String,
    pub status: String,
    pub opened_by: String,
    pub opened_at: String,
    pub closed_by: Option<String>,
    pub closed_at: Option<String>,
    /// The day this shift trades for, in the store's time: the date it opened.
    /// Every sale rung on it carries the same day, past midnight included.
    #[serde(default)]
    pub business_date: Option<String>,
    /// Who took the seat, when that is how the shift ended. It is then closed
    /// with nothing declared until its holder counts (`counted_at`).
    #[serde(default)]
    pub taken_over_by: Option<String>,
    #[serde(default)]
    pub counted_at: Option<String>,
    pub opening_float_minor: i64,
    pub sale_count: i64,
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub sales_total_minor: i64,
    /// Rung and then reversed. Kept out of the totals but reported, because a
    /// shift with forty voids is a fact about the evening even when the money
    /// balances.
    pub voided_count: i64,
    pub voided_total_minor: i64,
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub cash_sales_minor: i64,
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub non_cash_minor: i64,
    /// Change handed back. Comes out of the drawer and is not part of any
    /// sale's total, so it has to be subtracted separately or every drawer is
    /// long by exactly the change given.
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub change_given_minor: i64,
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub cash_refunds_minor: i64,
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub non_cash_refunds_minor: i64,
    pub cash_movements_minor: i64,
    pub movements: Vec<CashMovementView>,
    /// "Setor modal" (client, 24 Oct 2026): the float handed back to the
    /// Kepala toko while the shift stays open — every `FLOAT_RETURN`, as a
    /// positive figure, nought until it has been. Already inside the signed
    /// movements above; carried on its own so the till and the closing paper
    /// can say "Modal disetor" without adding movements up themselves.
    #[serde(default)]
    pub float_returned_minor: i64,
    /// Who took the float back, by name, for the paper's "Penerima". Null
    /// until it has been returned.
    #[serde(default)]
    pub float_returned_to: Option<String>,
    /// "Tambah modal": every PICKUP, as a positive figure.
    #[serde(default)]
    pub float_added_minor: i64,
    /// "Setoran sementara": every DROP, as a positive figure (a drop sent
    /// without an amount counts nought until the Kepala toko writes it).
    #[serde(default)]
    pub drops_minor: i64,
    /// "Modal Akhir" on the closing paper: the opening float, plus every
    /// Tambah modal, less every Setor modal. Setoran sementara is takings
    /// leaving the drawer, not float, and is not in it.
    #[serde(default)]
    pub float_end_minor: i64,
    /// Float + cash taken − change − cash refunded + signed movements.
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub expected_cash_minor: i64,
    pub declared_cash_minor: Option<i64>,
    pub variance_minor: Option<i64>,
    pub tenders: Vec<TenderTotal>,
    pub note: Option<String>,
    /// The count sheet the close was declared from; empty while open, and on
    /// a shift closed with a total only.
    #[serde(default)]
    pub counted: Vec<CashCount>,
    /// Each EDC machine the shift took cards or QRIS on, and every machine
    /// the cashier counted slips off: the machines first used first.
    #[serde(default)]
    pub edc_slips: Vec<ShiftEdcSlip>,
    /// The paper vouchers the cashier counted off the drawer at close (0105);
    /// null until counted, and on a shift closed before.
    #[serde(default)]
    pub vouchers_counted: Option<i64>,
    /// True when the figures above were withheld from a cashier.
    #[serde(default)]
    pub blind: bool,
    /// The slip a PICKUP or a DROP just handed out — only on the reply to
    /// that movement (client, 23 Oct 2026).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub slip: Option<CashSlip>,
}

/// The slip for "Tambah modal kasir" (PICKUP, `TM-0001`), "Setoran
/// sementara" (DROP, `ST-0001`) or "Setor modal" (FLOAT_RETURN, `SM-0001`,
/// client 24 Oct 2026).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CashSlip {
    pub slip_no: String,
    /// What moved, as a positive figure. Null on a drop sent without an
    /// amount: the Kepala toko writes it on the paper.
    #[serde(default)]
    pub amount_minor: Option<i64>,
    pub given_by_name: String,
    pub received_by_name: String,
    pub at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TenderTotal {
    pub method: String,
    pub count: i64,
    pub amount_minor: i64,
}

/// `FLOAT_RETURN` is "Setor modal" (client, 24 Oct 2026): the float going back
/// to the Kepala toko's hands with the shift still open. Its own kind rather
/// than a DROP with a flag, because the two are different papers with their
/// own numbers (SM, ST) and the closing paper asks only for the first.
const CASH_KINDS: [&str; 6] = [
    "OPENING_FLOAT",
    "DROP",
    "PAYOUT",
    "PICKUP",
    "CORRECTION",
    "FLOAT_RETURN",
];

/// Teach `cash_movement` and `cash_slip` the word `FLOAT_RETURN` (`0089`).
///
/// Both CHECKs were written before it, and SQLite widens a CHECK only by
/// rebuilding the table — done once, from the live definition, while the word
/// is missing (`payment_methods::widen_check`, foreign keys off around the
/// swap, so the count sheets and slips that point at a movement stay put).
pub(crate) fn apply_float_return_schema(connection: &Connection) -> Result<(), EdgeError> {
    super::payment_methods::widen_check(
        connection,
        "cash_movement",
        "'CORRECTION')",
        "'CORRECTION','FLOAT_RETURN')",
        "FLOAT_RETURN",
    )?;
    super::payment_methods::widen_check(
        connection,
        "cash_slip",
        "'DROP'))",
        "'DROP', 'FLOAT_RETURN'))",
        "FLOAT_RETURN",
    )?;
    // MODAL AWAL (MA-0001, Hari 30 Oct 2026): the opening float's slip.
    super::payment_methods::widen_check(
        connection,
        "cash_slip",
        "'FLOAT_RETURN'))",
        "'FLOAT_RETURN', 'OPENING_FLOAT'))",
        "OPENING_FLOAT",
    )
}

/// What a till is told when it tries to open a shift in a store head office
/// has not opened yet.
pub const STORE_NOT_OPEN_YET: &str =
    "This store is not open yet — head office opens it from the hub.";

// ════════════════════════════════════════════════════════════════════════════
// The seats
// ════════════════════════════════════════════════════════════════════════════

/// What every seat's id starts with: `KASIR-1`.
pub const SEAT_PREFIX: &str = "KASIR-";

/// The seats this store has — head office's number of them, from the site
/// profile (`site_profile::KnownSite::till_count`). One until head office has
/// said, so a node that has not heard still trades at one counter.
pub fn seat_ids(connection: &Connection) -> Vec<String> {
    let count = super::site_profile::own(connection)
        .and_then(|site| site.till_count)
        .unwrap_or(1);
    (1..=count).map(|n| format!("{SEAT_PREFIX}{n}")).collect()
}

/// `Kasir 1` for `KASIR-1`; any other id — a till from before seats — as it is.
pub fn seat_label(terminal_id: &str) -> String {
    match terminal_id.strip_prefix(SEAT_PREFIX) {
        Some(number) if !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()) => {
            format!("Kasir {number}")
        }
        _ => terminal_id.to_string(),
    }
}

/// Refuse a seat head office has not given this store. A machine sits at a
/// seat; naming a new one is not how a store gets another.
fn require_seat(connection: &Connection, terminal: &str) -> Result<(), EdgeError> {
    let seats = seat_ids(connection);
    if seats.iter().any(|seat| seat == terminal) {
        return Ok(());
    }
    Err(EdgeError::Validation(if seats.is_empty() {
        "this store has no till seats; head office sets how many it has".into()
    } else {
        format!(
            "{terminal} is not a till seat of this store; it has {}",
            seats
                .iter()
                .map(|seat| seat_label(seat))
                .collect::<Vec<_>>()
                .join(", ")
        )
    }))
}

/// The open shift this person holds, at any seat.
pub fn open_shift_of(connection: &Connection, actor: &str) -> Result<Option<String>, EdgeError> {
    connection
        .prepare_cached(
            "SELECT id FROM cash_shift WHERE opened_by=?1 AND status='OPEN'
              ORDER BY opened_at DESC, id LIMIT 1",
        )
        .map_err(db)?
        .query_row([actor.trim()], |row| row.get(0))
        .optional()
        .map_err(db)
}

/// Refuse a person who already holds a drawer somewhere else. One person, one
/// drawer: two would split their takings between counts nobody can reconcile.
fn require_free_person(
    connection: &Connection,
    actor: &str,
    terminal: &str,
) -> Result<(), EdgeError> {
    let held: Option<(String, String)> = connection
        .prepare_cached(
            "SELECT id, terminal_id FROM cash_shift WHERE opened_by=?1 AND status='OPEN'
              ORDER BY opened_at DESC, id LIMIT 1",
        )
        .map_err(db)?
        .query_row([actor.trim()], |row| Ok((row.get(0)?, row.get(1)?)))
        .optional()
        .map_err(db)?;
    match held {
        None => Ok(()),
        Some((_, seat)) if seat == terminal => Err(EdgeError::Conflict(format!(
            "{actor} already holds {}",
            seat_label(&seat)
        ))),
        Some((_, seat)) => Err(EdgeError::Conflict(format!(
            "{actor} still holds {}; close that drawer before taking another seat",
            seat_label(&seat)
        ))),
    }
}

/// The store's own date at `at`: the day a shift opened then trades for.
fn local_date(connection: &Connection, at: DateTime<Utc>) -> String {
    let offset = chrono::Duration::minutes(i64::from(super::site_profile::utc_offset_minutes(
        connection,
    )));
    (at + offset).date_naive().to_string()
}

/// Every seat and who holds it. Seats beyond head office's number that still
/// have a drawer open — the number went down, or a till from before seats —
/// are listed after, so the drawer can be closed.
pub fn seats(connection: &Connection) -> Result<Vec<TillSeat>, EdgeError> {
    let mut open: Vec<(String, String, String, String)> = {
        let mut statement = connection
            .prepare(
                "SELECT terminal_id, id, opened_by, opened_at FROM cash_shift
                  WHERE status='OPEN' ORDER BY opened_at, id",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    let mut seats = Vec::new();
    for seat in seat_ids(connection) {
        let held = open
            .iter()
            .position(|(terminal, ..)| *terminal == seat)
            .map(|index| open.remove(index));
        seats.push(TillSeat {
            label: seat_label(&seat),
            terminal_id: seat,
            current: true,
            shift_id: held.as_ref().map(|held| held.1.clone()),
            held_by: held.as_ref().map(|held| held.2.clone()),
            held_since: held.map(|held| held.3),
        });
    }
    for (terminal, shift_id, held_by, held_since) in open {
        seats.push(TillSeat {
            label: seat_label(&terminal),
            terminal_id: terminal,
            current: false,
            shift_id: Some(shift_id),
            held_by: Some(held_by),
            held_since: Some(held_since),
        });
    }
    Ok(seats)
}

// ════════════════════════════════════════════════════════════════════════════
// Opening, taking over, counting
// ════════════════════════════════════════════════════════════════════════════

/// Open the drawer at a seat.
///
/// Refuses a seat head office has not given the store, a seat somebody else
/// holds (nobody opens over another's drawer, [`take_over`]), and a person
/// who already holds a drawer. The
/// unique index on one open shift per seat still does the final refusing: two
/// people pressing "open" at the same second is exactly the race a check in
/// application code loses.
pub fn open_shift(
    tx: &Transaction<'_>,
    request: &OpenShiftRequest,
    now: DateTime<Utc>,
) -> Result<ShiftReport, EdgeError> {
    let terminal = request.terminal_id.trim();
    check_opening(
        tx,
        terminal,
        request.opening_float_minor,
        &request.actor_id,
        now,
    )?;
    if let Some(existing) = open_shift_id(tx, terminal)? {
        return Err(EdgeError::Conflict(format!(
            "{} is held by another shift ({existing}); it is closed first",
            seat_label(terminal)
        )));
    }
    insert_shift(
        tx,
        terminal,
        request.actor_id.trim(),
        request.opening_float_minor,
        &request.idempotency_key,
        None,
        now,
    )
}

/// Open your own drawer at a free seat — the route the POS opens every shift
/// through (`POST /api/v1/store/shifts/take-over`, the name it was given when
/// it could take a seat over).
///
/// A seat somebody else holds is not taken from them (owner, 23 Oct 2026:
/// "nobody opens over it"): their drawer is counted and closed first — at
/// that POS, or by the store head from the Shift screen. Refused in the till's
/// language, naming who holds it, because it is read at the counter.
/// `ended` is always `None` now; it stays in the answer so an older POS reads
/// it.
pub fn take_over(
    tx: &Transaction<'_>,
    request: &TakeOverRequest,
    now: DateTime<Utc>,
) -> Result<TakeOverOutcome, EdgeError> {
    let terminal = request.terminal_id.trim();
    let actor = request.actor_id.trim();
    check_opening(tx, terminal, request.opening_float_minor, actor, now)?;
    if let Some(held) = open_shift_id(tx, terminal)? {
        let running = report(tx, &held)?;
        let holder: String = tx
            .query_row(
                "SELECT COALESCE(NULLIF(trim(display_name), ''), username)
                   FROM edge_user WHERE username = ?1",
                params![running.opened_by],
                |row| row.get(0),
            )
            .optional()
            .map_err(db)?
            .unwrap_or_else(|| running.opened_by.clone());
        let seat = seat_label(terminal);
        return Err(EdgeError::Conflict(format!(
            "{seat} masih dibuka {holder}. Tutup kasir {holder} dulu: hitung lacinya di \
             {seat}, atau kepala toko menutupnya dari menu Shift."
        )));
    }
    let shift = insert_shift(
        tx,
        terminal,
        actor,
        request.opening_float_minor,
        &request.idempotency_key,
        request.handed_by.as_deref().map(str::trim).filter(|by| !by.is_empty()),
        now,
    )?;
    Ok(TakeOverOutcome { ended: None, shift })
}

/// What opening and taking over both refuse.
fn check_opening(
    tx: &Transaction<'_>,
    terminal: &str,
    opening_float_minor: i64,
    actor: &str,
    now: DateTime<Utc>,
) -> Result<(), EdgeError> {
    if terminal.is_empty() {
        return Err(EdgeError::Validation("terminal_id is required".into()));
    }
    if opening_float_minor < 0 {
        return Err(EdgeError::Validation(
            "opening float cannot be negative".into(),
        ));
    }
    if actor.trim().is_empty() {
        return Err(EdgeError::Validation("actor_id is required".into()));
    }
    // A store trades from the day head office opens it (postgres 0630), and
    // its site directory says so (`0061`). Until then the drawer stays shut:
    // the server, the tills and the first stock may all be in place while the
    // store is still getting ready. Only an explicit "not yet" refuses — a
    // node that has not heard keeps trading (`site_profile::own_store_is_open`).
    if !crate::edge::site_profile::own_store_is_open(tx) {
        return Err(EdgeError::Conflict(STORE_NOT_OPEN_YET.into()));
    }
    // Head office's stops (0990): the store, the person, or the seat's till.
    crate::edge::pos_stop::refuse_opening(tx, actor, terminal)?;
    require_seat(tx, terminal)?;
    require_free_person(tx, actor, terminal)?;
    refuse_closed_today(tx, actor, terminal, now)
}

fn insert_shift(
    tx: &Transaction<'_>,
    terminal: &str,
    actor: &str,
    opening_float_minor: i64,
    idempotency_key: &str,
    handed_by: Option<&str>,
    now: DateTime<Utc>,
) -> Result<ShiftReport, EdgeError> {
    let shift_id = Uuid::new_v4().to_string();
    let opened_at = now;
    tx.prepare_cached(
        "INSERT INTO cash_shift(id,idempotency_key,terminal_id,status,opened_by,opened_at,
                                opening_float_minor,business_date)
         VALUES(?1,?2,?3,'OPEN',?4,?5,?6,?7)",
    )
    .map_err(db)?
    .execute(params![
        shift_id,
        idempotency_key,
        terminal,
        actor,
        stamp(opened_at),
        opening_float_minor,
        local_date(tx, opened_at)
    ])
    .map_err(db)?;

    // The float is a cash movement like any other. Recording it only in the
    // shift row would mean the drawer's arithmetic had two sources, and the
    // one nobody looks at is the one that drifts.
    if opening_float_minor > 0 {
        let movement_id = Uuid::new_v4().to_string();
        tx.prepare_cached("INSERT INTO cash_movement(id,idempotency_key,shift_id,kind,amount_minor,reason,actor_id,occurred_at)
             VALUES(?1,?2,?3,'OPENING_FLOAT',?4,'Modal awal',?5,?6)"
    ).map_err(db)?.execute(
            params![
                movement_id,
                format!("{idempotency_key}:float"),
                shift_id,
                opening_float_minor,
                actor,
                stamp(opened_at)
            ],
        )
        .map_err(db)?;
        // MODAL AWAL, numbered like the other slips (MA-0001): the Kepala
        // toko hands the float, the cashier receives it.
        record_slip(
            tx,
            &movement_id,
            "OPENING_FLOAT",
            opening_float_minor,
            actor,
            handed_by.unwrap_or(actor),
            opened_at,
        )?;
    }
    report(tx, &shift_id)
}

/// Count a drawer somebody took the seat from.
///
/// The shift is already closed — its holder has left the seat — and its
/// expectation was fixed when it was taken over. What arrives here is what the
/// holder counted out of it, and only the holder (or a supervisor) says so.
pub fn count_shift(
    tx: &Transaction<'_>,
    shift_id: &str,
    request: &CloseShiftRequest,
    now: DateTime<Utc>,
) -> Result<ShiftReport, EdgeError> {
    check_declaration(request)?;
    let (status, holder, declared): (String, String, Option<i64>) = tx
        .prepare_cached("SELECT status, opened_by, declared_cash_minor FROM cash_shift WHERE id=?1")
        .map_err(db)?
        .query_row([shift_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .optional()
        .map_err(db)?
        .ok_or_else(|| EdgeError::NotFound(format!("shift {shift_id}")))?;
    if status == "OPEN" {
        return Err(EdgeError::Conflict(format!(
            "shift {shift_id} is still open; close it instead"
        )));
    }
    if declared.is_some() {
        return Err(EdgeError::Conflict(format!(
            "shift {shift_id} has already been counted"
        )));
    }
    require_holder(&holder, request.actor_id.trim(), request.supervising)?;
    record_count(tx, shift_id, request)?;
    record_edc_slips(tx, shift_id, request)?;
    record_vouchers(tx, shift_id, request)?;

    // Recomputed rather than read: a sale the holder rang offline before the
    // seat was taken can arrive after, and belongs in this drawer.
    let running = report(tx, shift_id)?;
    tx.prepare_cached(
        "UPDATE cash_shift
            SET declared_cash_minor=?2, expected_cash_minor=?3, variance_minor=?4,
                close_note=COALESCE(?5, close_note), counted_at=?6
          WHERE id=?1",
    )
    .map_err(db)?
    .execute(params![
        shift_id,
        request.declared_cash_minor,
        running.expected_cash_minor,
        request.declared_cash_minor - running.expected_cash_minor,
        request.note.as_deref().map(str::trim),
        stamp(now)
    ])
    .map_err(db)?;
    report(tx, shift_id)
}

/// Refuse anybody but the drawer's holder, unless a supervisor is acting.
fn require_holder(holder: &str, actor: &str, supervising: bool) -> Result<(), EdgeError> {
    if supervising || holder == actor {
        return Ok(());
    }
    Err(EdgeError::Forbidden(format!(
        "this drawer is {holder}'s; only {holder} or a supervisor may act on it"
    )))
}

/// The drawer a sale, a checkout or a refund belongs to: the shift of the
/// person ringing it.
///
/// The one that was theirs at `at` (the node's own stamp on the sale), else
/// the one they hold now. `None` when they hold none, and the sale still
/// completes: goods that left the shop are a sale whatever the paperwork says,
/// and refusing one the till had queued would leave stock the shop no longer
/// has. A till checks the person still holds a seat before it takes money
/// (`/shifts/mine`), so a sale with no drawer is a till that did not ask.
///
/// Never another person's drawer. Before seats, this was the oldest open shift
/// on the node, which with two counters put one cashier's money in the other's
/// count.
///
/// Refused when, at `at`, head office had stopped the store, the person or
/// the drawer's till (`pos_stop::refuse_selling`, 0990). A sale rung before
/// the stop still lands; a refused one stays in the till's outbox for a
/// supervisor, so nothing that left the shop goes unrecorded.
pub fn shift_for_sale(
    connection: &Connection,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<Option<String>, EdgeError> {
    let shift = shift_held_at(connection, actor, at)?;
    crate::edge::pos_stop::refuse_selling(connection, actor, shift.as_deref(), at)?;
    Ok(shift)
}

fn shift_held_at(
    connection: &Connection,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<Option<String>, EdgeError> {
    let at = at.to_rfc3339_opts(SecondsFormat::Micros, true);
    let then: Option<String> = connection
        .prepare_cached(
            "SELECT id FROM cash_shift
              WHERE opened_by=?1
                AND julianday(opened_at) <= julianday(?2)
                AND (closed_at IS NULL OR julianday(?2) < julianday(closed_at))
              ORDER BY opened_at DESC, id LIMIT 1",
        )
        .map_err(db)?
        .query_row(params![actor.trim(), at], |row| row.get(0))
        .optional()
        .map_err(db)?;
    match then {
        Some(shift) => Ok(Some(shift)),
        None => open_shift_of(connection, actor),
    }
}

/// The day a sale trades for: its shift's, or the store's own date at `at`
/// when it was rung with no shift open.
pub fn business_date_for(
    connection: &Connection,
    shift_id: Option<&str>,
    at: DateTime<Utc>,
) -> Result<String, EdgeError> {
    let from_shift: Option<String> = match shift_id {
        Some(shift_id) => connection
            .prepare_cached("SELECT business_date FROM cash_shift WHERE id=?1")
            .map_err(db)?
            .query_row([shift_id], |row| row.get(0))
            .optional()
            .map_err(db)?
            .flatten(),
        None => None,
    };
    Ok(from_shift.unwrap_or_else(|| local_date(connection, at)))
}

/// The drawer this person holds, and the ones taken over from them that they
/// have not counted yet.
pub fn my_shifts(connection: &Connection, actor: &str) -> Result<MyShifts, EdgeError> {
    let open = open_shift_of(connection, actor)?
        .map(|shift| report(connection, &shift))
        .transpose()?;
    let ids: Vec<String> = {
        let mut statement = connection
            .prepare(
                "SELECT id FROM cash_shift
                  WHERE opened_by=?1 AND status='CLOSED' AND declared_cash_minor IS NULL
                  ORDER BY closed_at, id",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([actor.trim()], |row| row.get(0))
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    let uncounted = ids
        .iter()
        .map(|shift| report(connection, shift))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(MyShifts { open, uncounted })
}

/// The count sheets of a shift's movements, by movement id.
fn movement_counts(
    connection: &Connection,
    shift_id: &str,
) -> Result<std::collections::HashMap<String, Vec<CashCount>>, EdgeError> {
    let mut statement = connection
        .prepare_cached(
            "SELECT c.movement_id,c.value_minor,c.pieces
               FROM cash_movement_count c
               JOIN cash_movement m ON m.id = c.movement_id
              WHERE m.shift_id=?1
              ORDER BY c.value_minor DESC",
        )
        .map_err(db)?;
    let rows = statement
        .query_map([shift_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                CashCount {
                    value_minor: row.get(1)?,
                    pieces: row.get(2)?,
                },
            ))
        })
        .map_err(db)?;
    let mut sheets: std::collections::HashMap<String, Vec<CashCount>> =
        std::collections::HashMap::new();
    for row in rows {
        let (movement, line) = row.map_err(db)?;
        sheets.entry(movement).or_default().push(line);
    }
    Ok(sheets)
}

/// Every drawer that traded on one business day, oldest first, open and closed
/// alike — the sessions of a day. `business_date` is the store's own date, the
/// one a shift carries from the moment it opens.
pub fn shifts_on(
    connection: &Connection,
    business_date: &str,
) -> Result<Vec<ShiftReport>, EdgeError> {
    let ids: Vec<String> = {
        let mut statement = connection
            .prepare_cached(
                "SELECT id FROM cash_shift WHERE business_date=?1 ORDER BY opened_at, id",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([business_date.trim()], |row| row.get(0))
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    ids.iter().map(|shift| report(connection, shift)).collect()
}

/// The sales rung on one drawer, oldest first, with how each was paid.
pub fn shift_sales(
    connection: &Connection,
    site_id: &str,
    shift_id: &str,
) -> Result<Vec<ShiftSale>, EdgeError> {
    let mut sales = {
        let mut statement = connection
            .prepare_cached(&format!(
                "SELECT s.id,s.completed_at,s.actor_id,s.status,s.total_minor,s.change_minor,
                        COALESCE((SELECT SUM(r.refund_minor) FROM sale_return r WHERE r.sale_id = s.id),0),
                        (SELECT k.receipt_no FROM sale_receipt k WHERE k.sale_id = s.id),
                        {SALE_PCS}
                   FROM sale s
                  WHERE s.shift_id=?1
                  ORDER BY s.completed_at, s.id"
            ))
            .map_err(db)?;
        let rows = statement
            .query_map([shift_id], |row| {
                let sale_id: String = row.get(0)?;
                let completed_at: String = row.get(1)?;
                let kept: Option<String> = row.get(7)?;
                Ok(ShiftSale {
                    receipt_no: kept
                        .unwrap_or_else(|| receipt_number(site_id, &sale_id, &completed_at)),
                    sale_id,
                    completed_at,
                    cashier: row.get(2)?,
                    status: row.get(3)?,
                    total_minor: row.get(4)?,
                    change_minor: row.get(5)?,
                    returned_minor: row.get(6)?,
                    pcs: row.get(8)?,
                    tenders: Vec::new(),
                })
            })
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    let mut statement = connection
        .prepare_cached(
            "SELECT t.sale_id,t.method,t.amount_minor,t.card_kind,t.acquirer,t.reference
               FROM sale_tender t
               JOIN sale s ON s.id = t.sale_id
              WHERE s.shift_id=?1
              ORDER BY t.sale_id, t.tender_seq",
        )
        .map_err(db)?;
    let rows = statement
        .query_map([shift_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                ShiftSaleTender {
                    method: row.get(1)?,
                    amount_minor: row.get(2)?,
                    card_kind: row.get(3)?,
                    acquirer: row.get(4)?,
                    reference: row.get(5)?,
                },
            ))
        })
        .map_err(db)?;
    let mut by_sale: std::collections::HashMap<String, Vec<ShiftSaleTender>> =
        std::collections::HashMap::new();
    for row in rows {
        let (sale, tender) = row.map_err(db)?;
        by_sale.entry(sale).or_default().push(tender);
    }
    for sale in &mut sales {
        sale.tenders = by_sale.remove(&sale.sale_id).unwrap_or_default();
    }
    Ok(sales)
}

/// The returns made at one drawer, oldest first.
pub fn shift_returns(
    connection: &Connection,
    site_id: &str,
    shift_id: &str,
) -> Result<Vec<ShiftReturn>, EdgeError> {
    type Row = (
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        i64,
        i64,
    );
    let rows: Vec<Row> = {
        let mut statement = connection
            .prepare_cached(
                "SELECT r.id, r.occurred_at, r.actor_id, r.sale_id, k.receipt_no,
                        COALESCE(k.replacement_sale_id,
                                 CASE WHEN r.refund_method='EXCHANGE' THEN r.refund_reference END),
                        k.back_minor, k.replacement_minor, k.paid_minor,
                        (SELECT COUNT(*) FROM sale_return_line l WHERE l.return_id = r.id)
                        + (SELECT COUNT(*) FROM unmatched_return_line u WHERE u.return_id = r.id),
                        COALESCE((SELECT SUM(l.refund_minor) FROM sale_return_line l WHERE l.return_id = r.id),0)
                        + COALESCE((SELECT SUM(u.refund_minor) FROM unmatched_return_line u WHERE u.return_id = r.id),0)
                   FROM sale_return r
              LEFT JOIN return_receipt k ON k.return_id = r.id
                  WHERE r.shift_id=?1
                  ORDER BY r.occurred_at, r.id",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([shift_id], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                    row.get(10)?,
                ))
            })
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    let mut out = Vec::with_capacity(rows.len());
    for (
        return_id,
        occurred_at,
        cashier,
        from_sale_id,
        kept,
        replacement,
        back,
        out_minor,
        paid,
        back_pcs,
        lines_minor,
    ) in rows
    {
        let (replacement_pcs, replacement_total): (i64, i64) = match replacement.as_deref() {
            Some(sale_id) => connection
                .prepare_cached(&format!(
                    "SELECT {SALE_PCS}, s.total_minor FROM sale s WHERE s.id=?1"
                ))
                .map_err(db)?
                .query_row([sale_id], |row| Ok((row.get(0)?, row.get(1)?)))
                .optional()
                .map_err(db)?
                .unwrap_or((0, 0)),
            None => (0, 0),
        };
        // A return from before 0102 has no receipt row: its number was the
        // replacement's, its worth the lines'.
        let receipt_no = match (kept, replacement.as_deref()) {
            (Some(kept), _) => kept,
            (None, Some(sale_id)) => sale_receipt_no(connection, site_id, sale_id)?,
            (None, None) => sale_receipt_no(connection, site_id, &from_sale_id)?,
        };
        let back_minor = back.unwrap_or(lines_minor);
        let replacement_minor = out_minor.unwrap_or(replacement_total);
        out.push(ShiftReturn {
            return_id,
            receipt_no,
            occurred_at,
            cashier,
            from_receipt_no: sale_receipt_no(connection, site_id, &from_sale_id)?,
            replacement_sale_id: replacement,
            back_pcs,
            out_pcs: replacement_pcs,
            back_minor,
            replacement_minor,
            paid_minor: paid.unwrap_or((replacement_minor - back_minor).max(0)),
        });
    }
    Ok(out)
}

/// The pieces on sale `s`, as one SQL expression: its tagged lines, and one
/// for each piece sold without a tag (`0084`).
const SALE_PCS: &str =
    "COALESCE((SELECT SUM(l.quantity) FROM sale_line l WHERE l.sale_id = s.id),0)
     + (SELECT COUNT(*) FROM unmatched_sale_line u WHERE u.sale_id = s.id)";

/// Every drawer open in the store now, oldest first.
pub fn open_shifts(connection: &Connection) -> Result<Vec<ShiftReport>, EdgeError> {
    let ids: Vec<String> = {
        let mut statement = connection
            .prepare("SELECT id FROM cash_shift WHERE status='OPEN' ORDER BY opened_at, id")
            .map_err(db)?;
        let rows = statement.query_map([], |row| row.get(0)).map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    ids.iter().map(|shift| report(connection, shift)).collect()
}

/// The open shift on this terminal, if there is one.
pub fn open_shift_id(
    connection: &Connection,
    terminal_id: &str,
) -> Result<Option<String>, EdgeError> {
    connection
        .prepare_cached("SELECT id FROM cash_shift WHERE terminal_id=?1 AND status='OPEN'")
        .map_err(db)?
        .query_row([terminal_id.trim()], |row| row.get(0))
        .optional()
        .map_err(db)
}

/// The oldest open shift on ANY seat of this node.
///
/// Only for a reader asking "is a drawer open here at all" with no seat to
/// name. It never decides whose drawer money goes in — that is
/// [`shift_for_sale`], by the person ringing it. Before seats a sale found its
/// shift through this, which with two counters put one cashier's takings in the
/// other's count.
pub fn any_open_shift(connection: &Connection) -> Result<Option<String>, EdgeError> {
    connection
        .prepare_cached(
            "SELECT id FROM cash_shift WHERE status='OPEN' ORDER BY opened_at, id LIMIT 1",
        )
        .map_err(db)?
        .query_row([], |row| row.get(0))
        .optional()
        .map_err(db)
}

pub fn record_cash_movement(
    tx: &Transaction<'_>,
    shift_id: &str,
    request: &CashMovementRequest,
    now: DateTime<Utc>,
) -> Result<ShiftReport, EdgeError> {
    let kind = request.kind.trim().to_ascii_uppercase();
    if !CASH_KINDS.contains(&kind.as_str()) {
        return Err(EdgeError::Validation(format!(
            "unknown cash movement kind {kind}"
        )));
    }
    // A drop may come without an amount (client, 24 Oct 2026): the Kepala toko
    // counts what he was handed and writes it on the ST slip. It still needs
    // his name, below. Every other kind is a figure or it is nothing.
    if request.amount_minor == 0 && kind != "DROP" {
        return Err(EdgeError::Validation(
            "a cash movement of zero records nothing".into(),
        ));
    }
    if request.reason.trim().is_empty() {
        return Err(EdgeError::Validation(
            "a cash movement needs a reason".into(),
        ));
    }
    // The till sends "Setor modal" as the float it hands over, a positive
    // figure, the way it sends a PICKUP; in the drawer's signed ledger it is
    // money out, whichever sign it came with.
    let amount_minor = if kind == "FLOAT_RETURN" {
        -request
            .amount_minor
            .checked_abs()
            .ok_or_else(|| EdgeError::Validation("the amount is too large".into()))?
    } else {
        request.amount_minor
    };
    check_movement_count(&kind, request)?;
    require_open(tx, shift_id)?;
    let holder = holder_of(tx, shift_id)?;
    require_holder(&holder, request.actor_id.trim(), request.supervising)?;
    if kind == "FLOAT_RETURN" {
        check_float_left(tx, shift_id, -amount_minor)?;
    }

    // Money leaving the drawer is the direction somebody steals in. A payout
    // is money gone. Since 23 Oct 2026 (client) modal only grows and every
    // hand-over has two names: a DROP's and a FLOAT_RETURN's supervisor
    // receives. "Tambah modal" (PICKUP) needs no finger since 28 Oct 2026
    // (Hari): money coming INTO the drawer is not the direction anybody
    // steals in, and the slip still carries both signatures. A grant the
    // till sends anyway is checked and names the giver.
    //
    // Setoran sementara (DROP) needs no finger either since 30 Oct 2026
    // (Hari: "tempelan sidik jarinya dihapus"): the Kepala toko's line on the
    // slip is left for a pen, as on Tambah modal.
    let finger_needed = matches!(kind.as_str(), "PAYOUT" | "CORRECTION" | "FLOAT_RETURN");
    let approved_by = if finger_needed
        || (matches!(kind.as_str(), "PICKUP" | "DROP") && request.supervisor.is_some())
    {
        Some(
            verify_supervisor(
                tx,
                request.supervisor.as_ref(),
                &[request.actor_id.as_str(), holder.as_str()],
            )
            .map_err(|error| match error {
                EdgeError::Validation(_) => {
                    EdgeError::Validation(format!("a {kind} needs a supervisor"))
                }
                other => other,
            })?,
        )
    } else {
        None
    };

    let movement_id = Uuid::new_v4().to_string();
    let received_by = request
        .received_by
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        // A drop's cash, and a returned float, go into the supervisor's hands.
        .or(if matches!(kind.as_str(), "DROP" | "FLOAT_RETURN") {
            approved_by.as_deref()
        } else {
            None
        });
    tx.prepare_cached("INSERT INTO cash_movement(id,idempotency_key,shift_id,kind,amount_minor,reason,actor_id,approved_by,received_by,occurred_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)"
    ).map_err(db)?.execute(
        params![
            movement_id,
            request.idempotency_key,
            shift_id,
            kind,
            amount_minor,
            request.reason.trim(),
            request.actor_id.trim(),
            approved_by,
            received_by,
            stamp(now)
        ],
    )
    .map_err(db)?;
    for line in request.counted.iter().filter(|line| line.pieces > 0) {
        tx.prepare_cached(
            "INSERT INTO cash_movement_count(movement_id,value_minor,pieces) VALUES(?1,?2,?3)",
        )
        .map_err(db)?
        .execute(params![movement_id, line.value_minor, line.pieces])
        .map_err(db)?;
    }
    let slip = match (kind.as_str(), approved_by.as_deref()) {
        // Tambah modal or Setoran sementara without a finger: the other
        // person's line is left for a pen.
        ("PICKUP" | "DROP", None) => Some(record_slip(
            tx,
            &movement_id,
            &kind,
            amount_minor,
            request.actor_id.trim(),
            "",
            now,
        )?),
        ("PICKUP" | "DROP" | "FLOAT_RETURN", Some(supervisor)) => Some(record_slip(
            tx,
            &movement_id,
            &kind,
            amount_minor,
            request.actor_id.trim(),
            supervisor,
            now,
        )?),
        _ => None,
    };
    let mut answer = report(tx, shift_id)?;
    answer.slip = slip;
    Ok(answer)
}

/// "Setor modal" hands back at most the float this drawer was given — the
/// opening float and every Tambah modal — less what has gone back already. A
/// second tap on the button is then refused rather than recorded as the float
/// leaving twice, which would put the drawer short by a float at the close.
fn check_float_left(tx: &Transaction<'_>, shift_id: &str, returning: i64) -> Result<(), EdgeError> {
    let left: i64 = tx
        .prepare_cached(
            "SELECT COALESCE(SUM(amount_minor), 0) FROM cash_movement
              WHERE shift_id=?1 AND kind IN ('OPENING_FLOAT','PICKUP','FLOAT_RETURN')",
        )
        .map_err(db)?
        .query_row([shift_id], |row| row.get(0))
        .map_err(db)?;
    if left <= 0 {
        return Err(EdgeError::Conflict("Modal sudah disetor semua".into()));
    }
    if returning > left {
        return Err(EdgeError::Validation(format!(
            "Modal tersisa Rp {}; tidak bisa setor Rp {}",
            escpos::rupiah(left),
            escpos::rupiah(returning)
        )));
    }
    Ok(())
}

/// Number and write the slip for a PICKUP (the supervisor gives, the cashier
/// receives), a DROP or a FLOAT_RETURN (the cashier gives, the supervisor
/// receives). Each kind keeps its own run of numbers.
fn record_slip(
    tx: &Transaction<'_>,
    movement_id: &str,
    kind: &str,
    amount_minor: i64,
    cashier: &str,
    supervisor: &str,
    now: DateTime<Utc>,
) -> Result<CashSlip, EdgeError> {
    let (prefix, given_by, received_by) = match kind {
        "PICKUP" => ("TM", supervisor, cashier),
        "OPENING_FLOAT" => ("MA", supervisor, cashier),
        "FLOAT_RETURN" => ("SM", cashier, supervisor),
        _ => ("ST", cashier, supervisor),
    };
    let seq: i64 = tx
        .prepare_cached("SELECT COALESCE(MAX(seq), 0) + 1 FROM cash_slip WHERE kind=?1")
        .map_err(db)?
        .query_row([kind], |row| row.get(0))
        .map_err(db)?;
    let slip_no = format!("{prefix}-{seq:04}");
    tx.prepare_cached(
        "INSERT INTO cash_slip(movement_id,kind,seq,slip_no,given_by,received_by)
         VALUES(?1,?2,?3,?4,?5,?6)",
    )
    .map_err(db)?
    .execute(params![
        movement_id,
        kind,
        seq,
        slip_no,
        given_by,
        received_by
    ])
    .map_err(db)?;
    Ok(CashSlip {
        slip_no,
        // Null for a drop sent without an amount, not "Rp 0": the paper
        // leaves the line for the Kepala toko's pen.
        amount_minor: amount_minor.checked_abs().filter(|amount| *amount > 0),
        given_by_name: display_name_of(tx, given_by)?,
        received_by_name: display_name_of(tx, received_by)?,
        at: stamp(now),
    })
}

/// The sheet a movement was counted from has to be a sheet: denominations that
/// are real, none twice, and adding up to the amount that left or entered the
/// drawer. Only cash handled by hand — a drop, a pickup or a returned float —
/// has one; a payout or a correction is an amount and a reason.
fn check_movement_count(kind: &str, request: &CashMovementRequest) -> Result<(), EdgeError> {
    if request.counted.is_empty() {
        return Ok(());
    }
    if !matches!(kind, "DROP" | "PICKUP" | "FLOAT_RETURN") {
        return Err(EdgeError::Validation(format!(
            "a {kind} is not counted note by note"
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let mut sum: i64 = 0;
    for line in &request.counted {
        if line.value_minor <= 0 || line.pieces < 0 {
            return Err(EdgeError::Validation(
                "a counted line needs a positive denomination and a non-negative number of pieces"
                    .into(),
            ));
        }
        if !seen.insert(line.value_minor) {
            return Err(EdgeError::Validation(format!(
                "denomination {} is counted twice",
                line.value_minor
            )));
        }
        sum = line
            .value_minor
            .checked_mul(line.pieces)
            .and_then(|value| sum.checked_add(value))
            .ok_or_else(|| EdgeError::Validation("the count is too large".into()))?;
    }
    let amount = request
        .amount_minor
        .checked_abs()
        .ok_or_else(|| EdgeError::Validation("the amount is too large".into()))?;
    if sum != amount {
        return Err(EdgeError::Validation(format!(
            "the counted lines add up to {sum}, not the {amount} moved"
        )));
    }
    Ok(())
}

/// Close the drawer against what the cashier counted.
///
/// The declaration arrives with the request and the expectation is computed
/// here, so the two can never be reconciled after the fact into agreeing. Both
/// numbers and their difference are stored; nothing recomputes the variance
/// later from figures that may have moved.
pub fn close_shift(
    tx: &Transaction<'_>,
    shift_id: &str,
    request: &CloseShiftRequest,
    now: DateTime<Utc>,
) -> Result<ShiftReport, EdgeError> {
    check_declaration(request)?;
    require_open(tx, shift_id)?;
    require_no_held(tx, shift_id, now)?;
    // Only the person who counted the float in counts the drawer out — or a
    // supervisor. Anybody else closing it would be declaring money they never
    // held.
    require_holder(
        &holder_of(tx, shift_id)?,
        request.actor_id.trim(),
        request.supervising,
    )?;
    record_count(tx, shift_id, request)?;
    require_every_machine(tx, shift_id, request)?;
    record_edc_slips(tx, shift_id, request)?;
    record_vouchers(tx, shift_id, request)?;

    let running = report(tx, shift_id)?;
    let variance = request.declared_cash_minor - running.expected_cash_minor;
    tx.prepare_cached(
        "UPDATE cash_shift
            SET status='CLOSED', closed_by=?2, closed_at=?3,
                declared_cash_minor=?4, expected_cash_minor=?5, variance_minor=?6,
                close_note=?7, counted_at=?3
          WHERE id=?1",
    )
    .map_err(db)?
    .execute(params![
        shift_id,
        request.actor_id.trim(),
        stamp(now),
        request.declared_cash_minor,
        running.expected_cash_minor,
        variance,
        request.note.as_deref().map(str::trim)
    ])
    .map_err(db)?;
    report(tx, shift_id)
}

fn check_declaration(request: &CloseShiftRequest) -> Result<(), EdgeError> {
    if request.declared_cash_minor < 0 {
        return Err(EdgeError::Validation(
            "declared cash cannot be negative".into(),
        ));
    }
    if request.actor_id.trim().is_empty() {
        return Err(EdgeError::Validation("actor_id is required".into()));
    }
    Ok(())
}

/// Write the count sheet, when there is one.
///
/// The sheet must be the figure declared beside it. A count that says
/// 1,517,000 on top of rows adding to 1,516,000 is two declarations, and the
/// audit would have to guess which one was meant.
fn record_count(
    tx: &Transaction<'_>,
    shift_id: &str,
    request: &CloseShiftRequest,
) -> Result<(), EdgeError> {
    if request.counted.is_empty() {
        return Ok(());
    }
    let mut seen = std::collections::HashSet::new();
    let mut sum: i64 = 0;
    for line in &request.counted {
        if line.value_minor <= 0 || line.pieces < 0 {
            return Err(EdgeError::Validation(
                "a counted line needs a positive denomination and a non-negative number of pieces"
                    .into(),
            ));
        }
        if !seen.insert(line.value_minor) {
            return Err(EdgeError::Validation(format!(
                "denomination {} is counted twice",
                line.value_minor
            )));
        }
        sum = line
            .value_minor
            .checked_mul(line.pieces)
            .and_then(|value| sum.checked_add(value))
            .ok_or_else(|| EdgeError::Validation("the count is too large".into()))?;
    }
    if sum != request.declared_cash_minor {
        return Err(EdgeError::Validation(format!(
            "the counted lines add up to {sum}, not the {} declared",
            request.declared_cash_minor
        )));
    }
    for line in request.counted.iter().filter(|line| line.pieces > 0) {
        tx.prepare_cached(
            "INSERT INTO cash_shift_count(shift_id,value_minor,pieces) VALUES(?1,?2,?3)",
        )
        .map_err(db)?
        .execute(params![shift_id, line.value_minor, line.pieces])
        .map_err(db)?;
    }
    Ok(())
}

/// Write the slips the cashier counted off each EDC machine (`0093`), when
/// the till sent them: a whole number, nought or more, each machine once.
fn record_edc_slips(
    tx: &Transaction<'_>,
    shift_id: &str,
    request: &CloseShiftRequest,
) -> Result<(), EdgeError> {
    let mut seen = std::collections::HashSet::new();
    for line in &request.edc_slips {
        let machine = line.machine_id.trim().to_ascii_uppercase();
        if machine.is_empty() {
            return Err(EdgeError::Validation(
                "an EDC slip count names its machine".into(),
            ));
        }
        if line.slips < 0 {
            return Err(EdgeError::Validation(format!(
                "EDC {machine} cannot have printed fewer than no slips"
            )));
        }
        if !seen.insert(machine.clone()) {
            return Err(EdgeError::Validation(format!(
                "EDC {machine} is counted twice"
            )));
        }
        tx.prepare_cached(
            "INSERT INTO cash_shift_edc_slip(shift_id,machine_id,slips) VALUES(?1,?2,?3)",
        )
        .map_err(db)?
        .execute(params![shift_id, machine, line.slips])
        .map_err(db)?;
    }
    Ok(())
}

/// Write the paper vouchers the cashier counted off the drawer (`0105`), when
/// the till sent them: a whole number, nought or more.
fn record_vouchers(
    tx: &Transaction<'_>,
    shift_id: &str,
    request: &CloseShiftRequest,
) -> Result<(), EdgeError> {
    let Some(vouchers) = request.vouchers else {
        return Ok(());
    };
    if vouchers < 0 {
        return Err(EdgeError::Validation(
            "a drawer cannot hold fewer than no vouchers".into(),
        ));
    }
    tx.prepare_cached(
        "INSERT INTO cash_shift_voucher_count(shift_id,vouchers) VALUES(?1,?2)
         ON CONFLICT(shift_id) DO UPDATE SET vouchers=excluded.vouchers",
    )
    .map_err(db)?
    .execute(params![shift_id, vouchers])
    .map_err(db)?;
    Ok(())
}

/// Tutup kasir is one form (Hari, 28 Oct 2026): once the till counts slips at
/// all, it counts every machine `/edc-machines` named — "F4 Tutup kasir waits
/// for every machine's slips". A close with no slips at all (a supervisor
/// closing from the store app, a till from before 25 Oct) still closes.
fn require_every_machine(
    tx: &Transaction<'_>,
    shift_id: &str,
    request: &CloseShiftRequest,
) -> Result<(), EdgeError> {
    if request.edc_slips.is_empty() {
        return Ok(());
    }
    for machine in edc_machines(tx, shift_id)? {
        let counted = request.edc_slips.iter().any(|line| {
            line.machine_id
                .trim()
                .eq_ignore_ascii_case(&machine.machine_id)
        });
        if !counted {
            return Err(EdgeError::Validation(format!(
                "Hitung struk EDC {} dulu",
                machine.machine_name
            )));
        }
    }
    Ok(())
}

/// The bank as the cashier says it — a short code as it is (`BCA`, `BRI`), a
/// longer one with one capital (`Mandiri`) — the till's own `bankWord`.
fn machine_name(machine_id: &str) -> String {
    if machine_id.chars().count() <= 4 {
        return machine_id.to_string();
    }
    let mut letters = machine_id.chars();
    match letters.next() {
        Some(first) => first
            .to_uppercase()
            .chain(letters.flat_map(char::to_lowercase))
            .collect(),
        None => String::new(),
    }
}

/// Every EDC machine a shift took cards or QRIS on, first used first, with
/// how many tenders it took. A voided sale's tenders count: each printed its
/// slip when it was taken. A card rung before the till named its bank has no
/// machine to count on, and is left out.
fn machine_tenders(
    connection: &Connection,
    shift_id: &str,
) -> Result<Vec<(String, i64)>, EdgeError> {
    let mut statement = connection
        .prepare_cached(
            "SELECT upper(trim(t.acquirer)), COUNT(*)
               FROM sale_tender t
               JOIN sale s ON s.id = t.sale_id
              WHERE s.shift_id=?1 AND t.method IN ('CARD','QRIS')
                AND t.acquirer IS NOT NULL AND trim(t.acquirer) <> ''
              GROUP BY upper(trim(t.acquirer))
              ORDER BY MIN(s.completed_at), upper(trim(t.acquirer))",
        )
        .map_err(db)?;
    let rows = statement
        .query_map([shift_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(db)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db)
}

/// The shop's EDC machines as head office names them (sqlite 0100), in book
/// order. Empty on a node head office has not sent a book to.
fn edc_book(connection: &Connection) -> Result<Vec<String>, EdgeError> {
    let mut statement = connection
        .prepare_cached("SELECT machine_id FROM edge_edc_machine ORDER BY machine_id")
        .map_err(db)?;
    let rows = statement.query_map([], |row| row.get(0)).map_err(db)?;
    rows.collect::<Result<Vec<String>, _>>().map_err(db)
}

/// `GET /api/v1/store/shifts/{id}/edc-machines`: every machine Tutup kasir asks
/// the cashier to count slips off — the shop's book (0100) first, then any
/// machine that took a card this shift but is not in it. By name only: no
/// count, no amount, so the count stays blind.
pub fn edc_machines(
    connection: &Connection,
    shift_id: &str,
) -> Result<Vec<ShiftEdcMachine>, EdgeError> {
    holder_of(connection, shift_id)?;
    let mut ids = edc_book(connection)?;
    for (machine_id, _) in machine_tenders(connection, shift_id)? {
        if !ids.iter().any(|id| id == &machine_id) {
            ids.push(machine_id);
        }
    }
    Ok(ids
        .into_iter()
        .map(|machine_id| ShiftEdcMachine {
            machine_name: machine_name(&machine_id),
            machine_id,
        })
        .collect())
}

/// The shift report's EDC lines: every machine in the shop's book (0100) —
/// counted or not — then any machine outside it that took a card or was
/// counted here.
fn edc_slips_of(connection: &Connection, shift_id: &str) -> Result<Vec<ShiftEdcSlip>, EdgeError> {
    let mut counted: Vec<(String, i64)> = {
        let mut statement = connection
            .prepare_cached(
                "SELECT machine_id,slips FROM cash_shift_edc_slip
                  WHERE shift_id=?1 ORDER BY rowid",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([shift_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    let tenders: std::collections::BTreeMap<String, i64> =
        machine_tenders(connection, shift_id)?.into_iter().collect();
    let mut ids = edc_book(connection)?;
    for machine_id in tenders.keys() {
        if !ids.iter().any(|id| id == machine_id) {
            ids.push(machine_id.clone());
        }
    }
    for (machine_id, _) in &counted {
        if !ids.iter().any(|id| id == machine_id) {
            ids.push(machine_id.clone());
        }
    }
    let mut lines = Vec::with_capacity(ids.len());
    for machine_id in ids {
        let found = counted
            .iter()
            .position(|(counted_id, _)| *counted_id == machine_id);
        let slips = found.map(|index| counted.remove(index).1);
        lines.push(ShiftEdcSlip {
            machine_name: machine_name(&machine_id),
            expected: tenders.get(&machine_id).copied().unwrap_or(0),
            slips,
            machine_id,
        });
    }
    Ok(lines)
}

fn holder_of(connection: &Connection, shift_id: &str) -> Result<String, EdgeError> {
    connection
        .prepare_cached("SELECT opened_by FROM cash_shift WHERE id=?1")
        .map_err(db)?
        .query_row([shift_id], |row| row.get(0))
        .optional()
        .map_err(db)?
        .ok_or_else(|| EdgeError::NotFound(format!("shift {shift_id}")))
}

fn require_open(connection: &Connection, shift_id: &str) -> Result<(), EdgeError> {
    let status: Option<String> = connection
        .prepare_cached("SELECT status FROM cash_shift WHERE id=?1")
        .map_err(db)?
        .query_row([shift_id], |row| row.get(0))
        .optional()
        .map_err(db)?;
    match status.as_deref() {
        Some("OPEN") => Ok(()),
        Some(_) => Err(EdgeError::Conflict(format!("shift {shift_id} is closed"))),
        None => Err(EdgeError::NotFound(format!("shift {shift_id}"))),
    }
}

/// What this shift took, and what should therefore be in the drawer.
pub fn report(connection: &Connection, shift_id: &str) -> Result<ShiftReport, EdgeError> {
    let head = connection
        .prepare_cached(
            "SELECT terminal_id,status,opened_by,opened_at,closed_by,closed_at,
                    opening_float_minor,declared_cash_minor,variance_minor,close_note,
                    business_date,taken_over_by,counted_at
               FROM cash_shift WHERE id=?1",
        )
        .map_err(db)?
        .query_row([shift_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, Option<i64>>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<String>>(9)?,
                (
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, Option<String>>(12)?,
                ),
            ))
        })
        .optional()
        .map_err(db)?
        .ok_or_else(|| EdgeError::NotFound(format!("shift {shift_id}")))?;

    // Completed sales only. A voided sale was rung and reversed; counting its
    // money would report a drawer that is short by every void of the evening.
    let (sale_count, sales_total_minor, change_given_minor) = connection
        .prepare_cached(
            "SELECT COUNT(*), COALESCE(SUM(total_minor),0), COALESCE(SUM(change_minor),0)
               FROM sale WHERE shift_id=?1 AND status='COMPLETED'",
        )
        .map_err(db)?
        .query_row([shift_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(db)?;

    let (voided_count, voided_total_minor) = connection
        .prepare_cached(
            "SELECT COUNT(*), COALESCE(SUM(total_minor),0)
               FROM sale WHERE shift_id=?1 AND status='VOIDED'",
        )
        .map_err(db)?
        .query_row([shift_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(db)?;

    let mut tenders = Vec::new();
    let mut cash_sales_minor = 0_i64;
    let mut non_cash_minor = 0_i64;
    {
        let mut statement = connection
            .prepare(
                "SELECT t.method, COUNT(*), COALESCE(SUM(t.amount_minor),0)
                   FROM sale_tender t
                   JOIN sale s ON s.id = t.sale_id
                  WHERE s.shift_id=?1 AND s.status='COMPLETED'
                  GROUP BY t.method
                  ORDER BY t.method",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([shift_id], |row| {
                Ok(TenderTotal {
                    method: row.get(0)?,
                    count: row.get(1)?,
                    amount_minor: row.get(2)?,
                })
            })
            .map_err(db)?;
        for row in rows {
            let total = row.map_err(db)?;
            if total.method == "CASH" {
                cash_sales_minor += total.amount_minor;
            } else {
                non_cash_minor += total.amount_minor;
            }
            tenders.push(total);
        }
    }

    let (cash_refunds_minor, non_cash_refunds_minor) = connection
        .prepare_cached(
            "SELECT COALESCE(SUM(CASE WHEN refund_method='CASH' THEN refund_minor ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN refund_method<>'CASH' THEN refund_minor ELSE 0 END),0)
               FROM sale_return WHERE shift_id=?1",
        )
        .map_err(db)?
        .query_row([shift_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(db)?;

    let mut movements = Vec::new();
    let mut cash_movements_minor = 0_i64;
    {
        let mut statement = connection
            .prepare(
                "SELECT m.id,m.kind,m.amount_minor,m.reason,m.actor_id,m.approved_by,m.occurred_at,
                        m.received_by,
                        (SELECT k.slip_no FROM cash_slip k WHERE k.movement_id = m.id)
                   FROM cash_movement m WHERE m.shift_id=?1 ORDER BY m.occurred_at, m.id",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([shift_id], |row| {
                Ok(CashMovementView {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    amount_minor: row.get(2)?,
                    reason: row.get(3)?,
                    actor_id: row.get(4)?,
                    approved_by: row.get(5)?,
                    received_by: row.get(7)?,
                    counted: Vec::new(),
                    slip_no: row.get(8)?,
                    occurred_at: row.get(6)?,
                })
            })
            .map_err(db)?;
        let mut sheets = movement_counts(connection, shift_id)?;
        for row in rows {
            let mut movement = row.map_err(db)?;
            movement.counted = sheets.remove(&movement.id).unwrap_or_default();
            // The opening float is already the first movement, so it is NOT
            // added again from the shift row below.
            cash_movements_minor += movement.amount_minor;
            movements.push(movement);
        }
    }
    // "Setor modal": what went back, and to whom — the last hand that took
    // it, which is the name the closing paper signs for.
    let float_returned_minor: i64 = movements
        .iter()
        .filter(|movement| movement.kind == "FLOAT_RETURN")
        .map(|movement| -movement.amount_minor)
        .sum();
    let float_added_minor: i64 = movements
        .iter()
        .filter(|movement| movement.kind == "PICKUP")
        .map(|movement| movement.amount_minor)
        .sum();
    let drops_minor: i64 = movements
        .iter()
        .filter(|movement| movement.kind == "DROP")
        .map(|movement| -movement.amount_minor)
        .sum();
    let float_returned_to = match movements
        .iter()
        .rev()
        .find(|movement| movement.kind == "FLOAT_RETURN")
        .and_then(|movement| {
            movement
                .received_by
                .as_deref()
                .or(movement.approved_by.as_deref())
        }) {
        Some(username) => Some(display_name_of(connection, username)?),
        None => None,
    };

    // Only cash is in the drawer. Change handed back left it, and a cash
    // refund left it; a card refund never touched it.
    let expected_cash_minor =
        cash_movements_minor + cash_sales_minor - change_given_minor - cash_refunds_minor;

    let declared = head.7;
    let counted = {
        let mut statement = connection
            .prepare(
                "SELECT value_minor,pieces FROM cash_shift_count
                  WHERE shift_id=?1 ORDER BY value_minor DESC",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([shift_id], |row| {
                Ok(CashCount {
                    value_minor: row.get(0)?,
                    pieces: row.get(1)?,
                })
            })
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    let (business_date, taken_over_by, counted_at) = head.10;
    Ok(ShiftReport {
        shift_id: shift_id.to_string(),
        terminal_label: seat_label(&head.0),
        terminal_id: head.0,
        status: head.1,
        opened_by: head.2,
        opened_at: head.3,
        closed_by: head.4,
        closed_at: head.5,
        business_date,
        taken_over_by,
        counted_at,
        opening_float_minor: head.6,
        sale_count,
        sales_total_minor,
        voided_count,
        voided_total_minor,
        cash_sales_minor,
        non_cash_minor,
        change_given_minor,
        cash_refunds_minor,
        non_cash_refunds_minor,
        cash_movements_minor,
        movements,
        float_returned_minor,
        float_returned_to,
        float_added_minor,
        drops_minor,
        float_end_minor: head.6 + float_added_minor - float_returned_minor,
        expected_cash_minor,
        declared_cash_minor: declared,
        // Recomputed for an open shift so the number moves with the evening;
        // read from the row once closed, so a later sale cannot rewrite
        // history.
        variance_minor: match head.8 {
            Some(stored) => Some(stored),
            None => declared.map(|declared| declared - expected_cash_minor),
        },
        tenders,
        note: head.9,
        counted,
        edc_slips: edc_slips_of(connection, shift_id)?,
        vouchers_counted: connection
            .prepare_cached("SELECT vouchers FROM cash_shift_voucher_count WHERE shift_id=?1")
            .map_err(db)?
            .query_row([shift_id], |row| row.get(0))
            .optional()
            .map_err(db)?,
        blind: false,
        slip: None,
    })
}

// ════════════════════════════════════════════════════════════════════════════
// The supervisor
// ════════════════════════════════════════════════════════════════════════════

/// A step-up, not a session.
///
/// The cashier stays logged in and a supervisor walks over. Signing the
/// cashier out to authorise one void would mean a queue watching somebody type
/// two passwords, so this verifies a second person against `edge_user` and
/// issues nothing. Whoever it was is written onto the row that needed them.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Supervisor {
    pub username: String,
    /// Read from the wire, never written back out.
    ///
    /// Every command that carries a supervisor — a void, a return, a payout —
    /// is serialised whole into `idempotency_response.request_json` so a
    /// replayed key can be told from a reused one
    /// (`SqliteEdge::encode_idempotent_request`). Without this attribute that
    /// record is a supervisor's password, in plaintext, kept in the shop's
    /// SQLite for as long as the row lives — and a shop node is a box under a
    /// counter, not a vault.
    ///
    /// Skipping it leaves the replay check intact: the username, the tags, the
    /// reason and the amounts all still distinguish one request from another.
    /// Two attempts that differ only in the password are the same action tried
    /// twice, which is exactly what an idempotency key is for.
    #[serde(skip_serializing)]
    #[serde(default)]
    pub password: Option<String>,
    /// A single-use authorisation earned by pressing a finger on this terminal
    /// (`edge/fingerprint.rs`), offered instead of a password.
    ///
    /// Additive on purpose: the Android till and everything else already in the
    /// field send a password and keep working untouched. A supervisor called to
    /// a counter many times a day is the case this exists for — typing a
    /// password in front of a queue is how it ends up written on a monitor.
    ///
    /// Skipped on the way out for the same reason the password is: it is a
    /// credential, and `request_json` is kept.
    #[serde(skip_serializing)]
    #[serde(default)]
    pub authorization: Option<String>,
}

/// Who said yes to `asking`'s request: a supervisor who proved themselves
/// (below), who is none of `asking` — the person asking, and for drawer money
/// the drawer's holder — and whom head office has not stopped (24 Oct 2026).
/// Two names on everything a supervisor signs: a supervisor ringing at a
/// counter who could approve their own void, payout or cancelled basket was
/// one person holding both keys. Every approval on this node comes through
/// here, so none can leave the second name out.
pub fn verify_supervisor(
    connection: &Transaction<'_>,
    supervisor: Option<&Supervisor>,
    asking: &[&str],
) -> Result<String, EdgeError> {
    let approver = verify_supervisor_alone(connection, supervisor)?;
    let own = asking.iter().any(|who| {
        crate::security::normalize_username(who.trim()).is_ok_and(|who| who == approver)
    });
    if own {
        return Err(EdgeError::Forbidden(
            "Supervisor tidak menyetujui permintaannya sendiri; minta supervisor lain.".into(),
        ));
    }
    crate::edge::pos_stop::refuse_approving(connection, &approver)?;
    Ok(approver)
}

fn verify_supervisor_alone(
    connection: &Transaction<'_>,
    supervisor: Option<&Supervisor>,
) -> Result<String, EdgeError> {
    let supervisor = supervisor.ok_or_else(|| {
        EdgeError::Validation("this action needs a supervisor's authorisation".into())
    })?;

    // A finger, if one was pressed. Spent inside the caller's transaction, so a
    // void that fails after this point does not burn the grant for nothing —
    // and one grant can never pay for two voids.
    if let Some(token) = supervisor
        .authorization
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        let granted_to = crate::edge::fingerprint::spend_grant(connection, token)?;
        // If the caller also named somebody, the two must be the same person.
        // A grant earned by one supervisor and filed under another's name would
        // put the wrong signature on the row that needed it.
        let claimed = supervisor.username.trim();
        if !claimed.is_empty() {
            let claimed =
                crate::security::normalize_username(claimed).map_err(EdgeError::Validation)?;
            if claimed != granted_to {
                return Err(EdgeError::Unauthorized(
                    "supervisor authorisation refused".into(),
                ));
            }
        }
        return Ok(granted_to);
    }

    let Some(password) = supervisor.password.as_deref() else {
        return Err(EdgeError::Validation(
            "a supervisor must authorise this with a password or a fingerprint".into(),
        ));
    };
    let username =
        crate::security::normalize_username(&supervisor.username).map_err(EdgeError::Validation)?;
    let row: Option<(String, String, i64)> = connection
        .prepare_cached("SELECT password_hash,role,active FROM edge_user WHERE username=?1")
        .map_err(db)?
        .query_row([&username], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .optional()
        .map_err(db)?;

    // One message for every failure. "No such supervisor" and "wrong password"
    // told apart is a way to enumerate who can authorise a void.
    let refuse = || EdgeError::Unauthorized("supervisor authorisation refused".into());
    let (password_hash, role, active) = row.ok_or_else(refuse)?;
    if active == 0 || !matches!(role.as_str(), "SUPERVISOR" | "ADMIN") {
        return Err(refuse());
    }
    if !crate::security::password_matches(&password_hash, password) {
        return Err(refuse());
    }
    Ok(username)
}

// ════════════════════════════════════════════════════════════════════════════
// The approvals a basket needs
// ════════════════════════════════════════════════════════════════════════════

/// The basket edits a supervisor has to see. Mirrors `till_approval.action`.
const APPROVAL_ACTIONS: [&str; 3] = ["EDIT_CART", "CANCEL_BASKET", "DROP_HOLD"];

/// A supervisor's yes to something done to an unsold basket.
///
/// The basket is the terminal's, so none of these has a sale row to carry the
/// signature the way a void does. This is that row: the supervisor proves
/// themselves exactly as for a void (`verify_supervisor` — a grant from a PIN
/// or a finger, or a password), the grant is spent here, and what they agreed
/// to is written beside their name.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TillApprovalRequest {
    /// `EDIT_CART` (a unit taken off the basket), `CANCEL_BASKET`, or
    /// `DROP_HOLD` (a parked basket thrown away).
    pub action: String,
    pub terminal_id: String,
    /// What the supervisor was shown, in the words they were shown it.
    pub detail: String,
    #[serde(default)]
    pub reason: Option<String>,
    /// The tags involved, when there are any.
    #[serde(default)]
    pub epcs: Vec<String>,
    /// The priced value involved, when the till knew it.
    #[serde(default)]
    pub amount_minor: Option<i64>,
    pub supervisor: Supervisor,
    #[serde(default)]
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TillApproval {
    pub approval_id: String,
    pub action: String,
    pub approved_by: String,
    pub recorded_at: String,
}

pub fn record_approval(
    tx: &Transaction<'_>,
    request: &TillApprovalRequest,
    now: DateTime<Utc>,
) -> Result<TillApproval, EdgeError> {
    let action = request.action.trim().to_ascii_uppercase();
    if !APPROVAL_ACTIONS.contains(&action.as_str()) {
        return Err(EdgeError::Validation(format!(
            "unknown approval action {action}; expected one of {}",
            APPROVAL_ACTIONS.join(", ")
        )));
    }
    let terminal = request.terminal_id.trim();
    if terminal.is_empty() {
        return Err(EdgeError::Validation("terminal_id is required".into()));
    }
    let detail = request.detail.trim();
    if detail.is_empty() || detail.chars().count() > 240 {
        return Err(EdgeError::Validation(
            "detail must say what was approved, in under 240 characters".into(),
        ));
    }
    if request.actor_id.trim().is_empty() {
        return Err(EdgeError::Validation("actor_id is required".into()));
    }
    let approved_by =
        verify_supervisor(tx, Some(&request.supervisor), &[request.actor_id.as_str()])?;
    let approval_id = Uuid::new_v4().to_string();
    let recorded_at = stamp(now);
    tx.prepare_cached(
        "INSERT INTO till_approval
           (id,idempotency_key,action,terminal_id,actor_id,approved_by,detail,reason,
            epcs_json,amount_minor,recorded_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
    )
    .map_err(db)?
    .execute(params![
        approval_id,
        request.idempotency_key,
        action,
        terminal,
        request.actor_id.trim(),
        approved_by,
        detail,
        request
            .reason
            .as_deref()
            .map(str::trim)
            .filter(|reason| !reason.is_empty()),
        serde_json::to_string(&request.epcs)
            .map_err(|error| EdgeError::Validation(error.to_string()))?,
        request.amount_minor,
        recorded_at,
    ])
    .map_err(db)?;
    Ok(TillApproval {
        approval_id,
        action,
        approved_by,
        recorded_at,
    })
}

// ════════════════════════════════════════════════════════════════════════════
// Taking it back
// ════════════════════════════════════════════════════════════════════════════

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct VoidSaleRequest {
    pub reason: String,
    pub supervisor: Supervisor,
    #[serde(default)]
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReturnLineRequest {
    /// The tag on the garment being handed back. A return is scanned like a
    /// sale — the shop has to know WHICH shirt came home, not merely that one
    /// did, or the unit stays sold forever and a different one goes missing.
    ///
    /// Empty for a piece sold without a tag: that one names `sku_code`.
    #[serde(default)]
    pub epc: String,
    /// A piece sold without a tag (typed SKU, `unmatched_sale_line`) comes
    /// back by its SKU (owner, 25 Oct 2026): the first line of that SKU on the
    /// receipt not yet returned. Read only when `epc` is empty.
    #[serde(default)]
    pub sku_code: Option<String>,
    /// `RESALEABLE` back to the floor, `DAMAGED` to the reject pool. Anything
    /// not fit to sell must not reach the rail by default.
    #[serde(default = "resaleable")]
    pub disposition: String,
}

fn resaleable() -> String {
    "RESALEABLE".to_string()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReturnRequest {
    pub sale_id: String,
    pub lines: Vec<ReturnLineRequest>,
    /// How the money went back. Not assumed from the original sale: a card
    /// sale refunded in cash happens every day.
    pub refund_method: String,
    #[serde(default)]
    pub refund_reference: Option<String>,
    pub reason: String,
    pub supervisor: Supervisor,
    #[serde(default)]
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReturnedLine {
    pub epc: String,
    pub sku_code: String,
    pub refund_minor: i64,
    pub disposition: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReturnResult {
    pub return_id: String,
    pub sale_id: String,
    pub refund_minor: i64,
    pub refund_method: String,
    pub movement_group_id: String,
    pub approved_by: String,
    pub occurred_at: String,
    pub lines: Vec<ReturnedLine>,
    /// What is still out with the customer after this return. Zero means the
    /// basket has come back entirely — which is a void in everything but name,
    /// and the shop should be able to see that without arithmetic.
    pub remaining_lines: i64,
}

/// One line of the original sale, with what it was charged and whether it has
/// already come back.
#[derive(Clone, Debug)]
pub struct SoldLine {
    pub subject_id: String,
    pub epc: String,
    pub sku_code: String,
    pub charged_minor: i64,
    pub already_returned: bool,
}

/// One line of the original sale rung without a tag (`unmatched_sale_line`),
/// with what it was charged and whether it has already come back (`0092`).
#[derive(Clone, Debug)]
pub struct UntaggedSoldLine {
    /// The unmatched line's id.
    pub line_id: String,
    pub sku_code: String,
    pub charged_minor: i64,
    pub already_returned: bool,
    /// The piece of this shop head office matched the line to and the node
    /// let go (`unmatched_sale_take` TAKEN): it comes home with the return.
    pub taken_subject_id: Option<String>,
    pub taken_epc: Option<String>,
}

/// The untagged lines of a sale that can come back by their SKU, in the
/// order they were rung. An UNKNOWN item names no SKU and is not among them.
pub fn untagged_sold_lines(
    connection: &Connection,
    sale_id: &str,
) -> Result<Vec<UntaggedSoldLine>, EdgeError> {
    let mut statement = connection
        .prepare(
            "SELECT u.id, u.sku_code, u.line_total_minor,
                    EXISTS(SELECT 1 FROM unmatched_return_line r WHERE r.unmatched_line_id = u.id),
                    (SELECT s.id FROM unmatched_sale_take t
                       JOIN inventory_subject s ON s.epc = t.epc
                      WHERE t.take_id = u.id AND t.outcome = 'TAKEN' LIMIT 1),
                    (SELECT t.epc FROM unmatched_sale_take t
                      WHERE t.take_id = u.id AND t.outcome = 'TAKEN' LIMIT 1)
               FROM unmatched_sale_line u
              WHERE u.sale_id = ?1 AND u.sku_code IS NOT NULL AND u.kind <> 'UNKNOWN'
              ORDER BY u.line_no",
        )
        .map_err(db)?;
    let rows = statement
        .query_map([sale_id], |row| {
            Ok(UntaggedSoldLine {
                line_id: row.get(0)?,
                sku_code: row.get(1)?,
                charged_minor: row.get(2)?,
                already_returned: row.get::<_, i64>(3)? == 1,
                taken_subject_id: row.get(4)?,
                taken_epc: row.get(5)?,
            })
        })
        .map_err(db)?;
    rows.map(|row| row.map_err(db)).collect()
}

/// The next untagged line of `sku` on this receipt still out with the
/// shopper and not already chosen in this request (`taken`, line ids).
pub fn pick_untagged(
    sold: &[UntaggedSoldLine],
    taken: &mut std::collections::HashSet<String>,
    sku: &str,
) -> Result<UntaggedSoldLine, EdgeError> {
    let sku = crate::edge::unmatched::normalized_sku(sku);
    if sku.is_empty() {
        return Err(EdgeError::Validation(
            "barang yang dikembalikan perlu tag atau SKU".into(),
        ));
    }
    let label = if sku.len() == 11 && sku.bytes().all(|b| b.is_ascii_digit()) {
        format!("{}·{}", &sku[..8], &sku[8..])
    } else {
        sku.clone()
    };
    let of_sku: Vec<&UntaggedSoldLine> = sold.iter().filter(|line| line.sku_code == sku).collect();
    if of_sku.is_empty() {
        return Err(EdgeError::Validation(format!(
            "SKU {label} tidak dijual tanpa tag di struk ini"
        )));
    }
    let line = of_sku
        .into_iter()
        .find(|line| !line.already_returned && !taken.contains(&line.line_id))
        .ok_or_else(|| {
            EdgeError::Conflict(format!("SKU {label} di struk ini semua sudah dikembalikan"))
        })?;
    taken.insert(line.line_id.clone());
    Ok(line.clone())
}

pub fn sold_lines(connection: &Connection, sale_id: &str) -> Result<Vec<SoldLine>, EdgeError> {
    let mut statement = connection
        .prepare(
            "SELECT l.subject_id, l.epc, l.sku_code, l.unit_price_minor,
                    EXISTS(SELECT 1 FROM sale_return_line r
                            WHERE r.sale_id = l.sale_id AND r.subject_id = l.subject_id)
               FROM sale_line l WHERE l.sale_id=?1
              ORDER BY l.epc",
        )
        .map_err(db)?;
    let rows = statement
        .query_map([sale_id], |row| {
            Ok(SoldLine {
                subject_id: row.get(0)?,
                epc: row.get(1)?,
                sku_code: row.get(2)?,
                charged_minor: row.get(3)?,
                already_returned: row.get::<_, i64>(4)? == 1,
            })
        })
        .map_err(db)?;
    rows.map(|row| row.map_err(db)).collect()
}

pub fn sale_status(connection: &Connection, sale_id: &str) -> Result<String, EdgeError> {
    connection
        .prepare_cached("SELECT status FROM sale WHERE id=?1")
        .map_err(db)?
        .query_row([sale_id], |row| row.get(0))
        .optional()
        .map_err(db)?
        .ok_or_else(|| EdgeError::NotFound(format!("sale {sale_id}")))
}

/// Write the return rows. The movement that carries the garments home is the
/// caller's, because only `SqliteEdge` owns the movement funnel.
#[allow(clippy::too_many_arguments)]
pub fn record_return(
    tx: &Transaction<'_>,
    return_id: &str,
    request: &ReturnRequest,
    approved_by: &str,
    shift_id: Option<&str>,
    movement_group_id: &str,
    lines: &[(SoldLine, String)],
    untagged: &[(UntaggedSoldLine, String)],
    occurred_at: DateTime<Utc>,
) -> Result<ReturnResult, EdgeError> {
    let refund_minor: i64 = lines
        .iter()
        .map(|(line, _)| line.charged_minor)
        .chain(untagged.iter().map(|(line, _)| line.charged_minor))
        .try_fold(0_i64, |total, charged| total.checked_add(charged))
        .ok_or_else(|| EdgeError::Validation("refund total overflow".into()))?;
    record_return_valued(
        tx,
        return_id,
        request,
        approved_by,
        shift_id,
        movement_group_id,
        lines,
        untagged,
        refund_minor,
        occurred_at,
    )
}

/// [`record_return`] with the header's `refund_minor` given rather than summed.
///
/// An exchange (`EXCHANGE`) gives back only the credit the replacement used:
/// returned pieces worth more than the replacement leave nothing to hand back
/// (owner, 23 Oct 2026), so the header says what was spent while each line
/// still says what that piece was charged on its own receipt.
#[allow(clippy::too_many_arguments)]
pub fn record_return_valued(
    tx: &Transaction<'_>,
    return_id: &str,
    request: &ReturnRequest,
    approved_by: &str,
    shift_id: Option<&str>,
    movement_group_id: &str,
    lines: &[(SoldLine, String)],
    untagged: &[(UntaggedSoldLine, String)],
    refund_minor: i64,
    occurred_at: DateTime<Utc>,
) -> Result<ReturnResult, EdgeError> {
    tx.prepare_cached(
        "INSERT INTO sale_return(id,idempotency_key,sale_id,refund_minor,refund_method,
                                 refund_reference,reason,actor_id,approved_by,shift_id,
                                 movement_group_id,occurred_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
    )
    .map_err(db)?
    .execute(params![
        return_id,
        request.idempotency_key,
        request.sale_id,
        refund_minor,
        request.refund_method.trim().to_ascii_uppercase(),
        request.refund_reference.as_deref().map(str::trim),
        request.reason.trim(),
        request.actor_id.trim(),
        approved_by,
        shift_id,
        movement_group_id,
        stamp(occurred_at)
    ])
    .map_err(db)?;

    let mut returned = Vec::with_capacity(lines.len());
    for (line, disposition) in lines {
        tx.prepare_cached("INSERT INTO sale_return_line(return_id,sale_id,subject_id,epc,sku_code,refund_minor,disposition)
             VALUES(?1,?2,?3,?4,?5,?6,?7)"
    ).map_err(db)?.execute(
            params![
                return_id,
                request.sale_id,
                line.subject_id,
                line.epc,
                line.sku_code,
                line.charged_minor,
                disposition
            ],
        )
        .map_err(db)?;
        returned.push(ReturnedLine {
            epc: line.epc.clone(),
            sku_code: line.sku_code.clone(),
            refund_minor: line.charged_minor,
            disposition: disposition.clone(),
        });
    }
    // Pieces sold without a tag, by their line (`0092`).
    for (line, disposition) in untagged {
        tx.prepare_cached(
            "INSERT INTO unmatched_return_line(return_id,sale_id,unmatched_line_id,sku_code,refund_minor,disposition)
             VALUES(?1,?2,?3,?4,?5,?6)",
        )
        .map_err(db)?
        .execute(params![
            return_id,
            request.sale_id,
            line.line_id,
            line.sku_code,
            line.charged_minor,
            disposition
        ])
        .map_err(db)?;
        returned.push(ReturnedLine {
            epc: line.taken_epc.clone().unwrap_or_default(),
            sku_code: line.sku_code.clone(),
            refund_minor: line.charged_minor,
            disposition: disposition.clone(),
        });
    }

    let remaining_tagged: i64 = tx
        .prepare_cached(
            "SELECT COUNT(*) FROM sale_line l
              WHERE l.sale_id=?1
                AND NOT EXISTS(SELECT 1 FROM sale_return_line r
                                WHERE r.sale_id=l.sale_id AND r.subject_id=l.subject_id)",
        )
        .map_err(db)?
        .query_row([&request.sale_id], |row| row.get(0))
        .map_err(db)?;
    let remaining_untagged: i64 = tx
        .prepare_cached(
            "SELECT COUNT(*) FROM unmatched_sale_line u
              WHERE u.sale_id=?1 AND u.sku_code IS NOT NULL AND u.kind <> 'UNKNOWN'
                AND NOT EXISTS(SELECT 1 FROM unmatched_return_line r
                                WHERE r.unmatched_line_id=u.id)",
        )
        .map_err(db)?
        .query_row([&request.sale_id], |row| row.get(0))
        .map_err(db)?;
    let remaining_lines = remaining_tagged + remaining_untagged;

    Ok(ReturnResult {
        return_id: return_id.to_string(),
        sale_id: request.sale_id.clone(),
        refund_minor,
        refund_method: request.refund_method.trim().to_ascii_uppercase(),
        movement_group_id: movement_group_id.to_string(),
        approved_by: approved_by.to_string(),
        occurred_at: stamp(occurred_at),
        lines: returned,
        remaining_lines,
    })
}

// ════════════════════════════════════════════════════════════════════════════
// Exchange: a return that pays for the replacement
// ════════════════════════════════════════════════════════════════════════════

/// Pieces from one receipt come back and replacement pieces go out, with no
/// money back (owner, 23 Oct 2026). A dearer replacement is topped up with
/// ordinary tenders; a cheaper or equal one costs nothing and returns nothing.
/// The Kepala toko authorises it, exactly as for a return.
///
/// This is THE return at the till since 28 Oct 2026 (Hari): `POST
/// /api/v1/store/returns` and `/exchanges` both take it. Replacements are
/// optional — with none the pieces go home, nothing is paid out and their
/// whole value is forfeited ("selisih tidak diuangkan"). Every return is a
/// receipt of its own (`return_receipt`, 0102) that can never be returned.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExchangeRequest {
    /// The receipt the returned pieces were sold on.
    pub sale_id: String,
    /// Each a piece sold on `sale_id` and not yet returned. Back to the floor.
    #[serde(default)]
    pub returned_epcs: Vec<String>,
    /// Pieces sold on `sale_id` without a tag, each by its SKU (owner, 25 Oct
    /// 2026): one entry per piece, the first line of that SKU not yet
    /// returned.
    #[serde(default)]
    pub returned_skus: Vec<String>,
    /// Each a piece on this shop's floor. Optional: a return may end with no
    /// replacement at all.
    #[serde(default)]
    pub replacement_epcs: Vec<String>,
    /// Replacements typed at the till instead of read off a tag (Hari, 30 Oct
    /// 2026: "hapus aturan itu"), rung like a sale's typed lines.
    #[serde(default)]
    pub replacement_untagged: Vec<super::contracts::UntaggedLine>,
    /// The difference only, when the replacement is dearer. Empty otherwise.
    #[serde(default)]
    pub tenders: Vec<crate::tender::SaleTender>,
    #[serde(default)]
    pub reason: Option<String>,
    pub supervisor: Supervisor,
    #[serde(default)]
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExchangeResult {
    /// The replacement sale; null when nothing went out.
    pub sale_id: Option<String>,
    /// The return's own receipt: the replacement sale's number, or — with no
    /// replacement — a number of its own from the same run.
    pub receipt_no: String,
    /// The return of the pieces that came back (`refund_method = EXCHANGE`).
    pub return_id: String,
    pub original_sale_id: String,
    /// The struk the pieces were sold on, as "Return dari" prints it.
    #[serde(default)]
    pub original_receipt_no: String,
    /// What the returned pieces were charged on their own receipt.
    pub returned_minor: i64,
    /// What the replacement comes to.
    pub replacement_minor: i64,
    /// `min(returned, replacement)`: the credit tender on the replacement sale.
    pub credit_minor: i64,
    /// `max(0, replacement − returned)`: what the shopper's tenders covered.
    pub owed_minor: i64,
    /// `max(0, returned − replacement)`: value left behind, not handed back —
    /// forfeited, and kept on the return receipt (`forfeited_minor`).
    pub unused_credit_minor: i64,
    /// What the shopper's own tenders came to (the credit not included).
    pub paid_minor: i64,
    pub change_minor: i64,
    pub approved_by: String,
    pub occurred_at: String,
    /// The replacement sale; null when nothing went out.
    pub sale: Option<super::contracts::SaleResult>,
    pub returned: ReturnResult,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct VoidResult {
    pub sale_id: String,
    /// What the shop hands back. The whole sale: a void that refunded part of
    /// a basket would be a return wearing the wrong name.
    pub refund_minor: i64,
    pub movement_group_id: String,
    pub approved_by: String,
    pub voided_at: String,
    pub lines: Vec<ReturnedLine>,
}

pub fn mark_voided(
    tx: &Transaction<'_>,
    sale_id: &str,
    request: &VoidSaleRequest,
    approved_by: &str,
    occurred_at: DateTime<Utc>,
) -> Result<(), EdgeError> {
    tx.prepare_cached(
        "UPDATE sale SET status='VOIDED', voided_at=?2, voided_by=?3, void_reason=?4,
                         void_approved_by=?5
          WHERE id=?1 AND status='COMPLETED'",
    )
    .map_err(db)?
    .execute(params![
        sale_id,
        stamp(occurred_at),
        request.actor_id.trim(),
        request.reason.trim(),
        approved_by
    ])
    .map_err(db)?;
    Ok(())
}

// ════════════════════════════════════════════════════════════════════════════
// The receipt
// ════════════════════════════════════════════════════════════════════════════

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PrintReceiptRequest {
    pub printer_host: String,
    #[serde(default = "default_printer_port")]
    pub printer_port: u16,
    /// `NARROW` (58mm, 32 columns) or `WIDE` (80mm, 48).
    #[serde(default)]
    pub paper: Option<String>,
    /// `PRINTER_PULSE`, `MANUAL` or `NONE`.
    #[serde(default)]
    pub drawer: Option<String>,
    /// A reprint says so on its face. Two identical receipts in a drawer at
    /// the end of the day are two sales to whoever counts them.
    #[serde(default)]
    pub copy: bool,
}

fn default_printer_port() -> u16 {
    9100
}

/// Everything printed, gathered in one pass.
///
/// A sale that has been voided or returned against still prints — that is what
/// a customer is handed with their money back — but it prints stamped, so the
/// two copies cannot be confused.
pub fn receipt_document(
    connection: &Connection,
    sale_id: &str,
    shop_name: &str,
    site_id: &str,
    footer: Option<&str>,
) -> Result<ReceiptDocument, EdgeError> {
    let head = connection
        .prepare_cached(
            "SELECT status,total_minor,paid_minor,change_minor,actor_id,completed_at
               FROM sale WHERE id=?1",
        )
        .map_err(db)?
        .query_row([sale_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .optional()
        .map_err(db)?
        .ok_or_else(|| EdgeError::NotFound(format!("sale {sale_id}")))?;

    let mut lines = Vec::new();
    let mut subtotal_minor = 0_i64;
    {
        // The catalogue supplies the name; a receipt listing SKU codes is a
        // receipt a customer cannot check. LEFT JOIN because a garment can be
        // sold before its catalogue row has synced, and refusing to print then
        // would hold up the queue over a name.
        let mut statement = connection
            .prepare(
                "SELECT l.epc, l.sku_code, l.quantity, l.unit_price_minor,
                        l.base_unit_price_minor, c.name
                   FROM sale_line l
              LEFT JOIN catalog_item c ON c.sku_code = l.sku_code
                  WHERE l.sale_id=?1
                  ORDER BY l.epc",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([sale_id], |row| {
                let base: Option<i64> = row.get(4)?;
                let name: Option<String> = row.get(5)?;
                let sku_code: String = row.get(1)?;
                Ok(ReceiptLine {
                    name: name.unwrap_or_else(|| sku_code.clone()),
                    sku_code,
                    quantity: row.get(2)?,
                    unit_price_minor: row.get(3)?,
                    line_total_minor: row.get(3)?,
                    base_unit_price_minor: base,
                    exchangeable: true,
                    no_exchange_by: None,
                })
            })
            .map_err(db)?;
        for row in rows {
            let line = row.map_err(db)?;
            subtotal_minor += line.base_unit_price_minor.unwrap_or(line.line_total_minor);
            lines.push(line);
        }
    }
    {
        // What sold that this shop's stock could not give (owner, 23 Oct
        // 2026): on the paper like any line, by the catalogue's name, or the
        // Kepala toko's for an unknown item.
        let mut statement = connection
            .prepare(
                "SELECT u.sku_code, u.unit_price_minor, u.line_total_minor,
                        COALESCE(c.name, u.name, u.sku_code)
                   FROM unmatched_sale_line u
              LEFT JOIN catalog_item c ON c.sku_code = u.sku_code
                  WHERE u.sale_id = ?1
                  ORDER BY u.line_no",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([sale_id], |row| {
                let unit_price_minor: i64 = row.get(1)?;
                Ok(ReceiptLine {
                    sku_code: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    name: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    quantity: 1,
                    unit_price_minor,
                    line_total_minor: row.get(2)?,
                    base_unit_price_minor: Some(unit_price_minor),
                    exchangeable: true,
                    no_exchange_by: None,
                })
            })
            .map_err(db)?;
        for row in rows {
            let line = row.map_err(db)?;
            subtotal_minor += line.base_unit_price_minor.unwrap_or(line.line_total_minor);
            lines.push(line);
        }
    }

    // Bags and other fees are on the bill but are not merchandise: printed as
    // their own lines after the goods, counted in the money, never in Pcs.
    let mut charges = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT description,amount_minor FROM sale_charge
                  WHERE sale_id=?1 ORDER BY charge_seq",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([sale_id], |row| {
                Ok(ReceiptCharge {
                    description: row.get(0)?,
                    amount_minor: row.get(1)?,
                })
            })
            .map_err(db)?;
        for row in rows {
            charges.push(row.map_err(db)?);
        }
    }

    let mut tenders = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT method,amount_minor,reference,card_kind,acquirer FROM sale_tender
                  WHERE sale_id=?1 ORDER BY tender_seq",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([sale_id], |row| {
                Ok(ReceiptTender {
                    method: row.get(0)?,
                    amount_minor: row.get(1)?,
                    reference: row.get(2)?,
                    card_kind: row.get(3)?,
                    acquirer: row.get(4)?,
                })
            })
            .map_err(db)?;
        for row in rows {
            tenders.push(row.map_err(db)?);
        }
    }

    // A return pays nothing out since 28 Oct 2026, so its refund can be
    // nought: whether anything came back is a count, not a sum.
    let returns: i64 = connection
        .prepare_cached("SELECT COUNT(*) FROM sale_return WHERE sale_id=?1")
        .map_err(db)?
        .query_row([sale_id], |row| row.get(0))
        .map_err(db)?;

    // Pieces sold without a tag still out with the shopper (`0092`).
    let mut untagged_open = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT u.sku_code FROM unmatched_sale_line u
                  WHERE u.sale_id = ?1 AND u.sku_code IS NOT NULL AND u.kind <> 'UNKNOWN'
                    AND NOT EXISTS(SELECT 1 FROM unmatched_return_line r
                                    WHERE r.unmatched_line_id = u.id)
                  ORDER BY u.line_no",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([sale_id], |row| row.get::<_, String>(0))
            .map_err(db)?;
        for row in rows {
            untagged_open.push(row.map_err(db)?);
        }
    }

    let stamp_text = if head.0 == "VOIDED" {
        Some("** BATAL **".to_string())
    } else if returns > 0 {
        Some("** DI-RETURN **".to_string())
    } else {
        None
    };

    // Which pieces never come back (postgres 1006), and the last day for the
    // rest, as the sale wrote it — the on-screen struk says both.
    let promise = super::return_policy::current(connection)?;
    for line in &mut lines {
        if !line.sku_code.is_empty() {
            // As the sale was made (0103), not as the policy reads today.
            line.no_exchange_by =
                super::return_policy::refused_on_sale(connection, &promise, sale_id, &line.sku_code)?;
            line.exchangeable = line.no_exchange_by.is_none();
        }
    }
    let exchange_until: Option<String> = connection
        .prepare_cached("SELECT return_by FROM sale WHERE id=?1")
        .map_err(db)?
        .query_row([sale_id], |row| row.get(0))
        .map_err(db)?;

    // What the sale earned its member, line by line (0032), for the paper's
    // "Member point" row.
    let points_earned: i64 = connection
        .prepare_cached("SELECT COALESCE(SUM(points_earned),0) FROM sale_line WHERE sale_id=?1")
        .map_err(db)?
        .query_row([sale_id], |row| row.get(0))
        .map_err(db)?;

    let mut document = ReceiptDocument {
        shop_name: shop_name.to_string(),
        header_image: crate::edge::receipt_header::current(connection).ok(),
        shop_line_1: None,
        shop_line_2: None,
        site_id: site_id.to_string(),
        sale_id: sale_id.to_string(),
        receipt_no: receipt_no_of(connection, site_id, sale_id, &head.5)?,
        completed_at: head.5.clone(),
        cashier: head.4,
        lines,
        charges,
        subtotal_minor,
        discount_minor: (subtotal_minor - head.1).max(0),
        total_minor: head.1,
        tenders,
        paid_minor: head.2,
        change_minor: head.3,
        points_earned,
        footer: footer.map(str::to_string),
        stamp: stamp_text,
        untagged_open,
        returned_from: None,
        returned_in: Vec::new(),
        forfeited_minor: 0,
        exchange_until,
        require_hang_tag: promise.setting.require_hang_tag,
        require_receipt: promise.setting.require_receipt,
        promotions: sale_promotions(connection, sale_id)?,
    };
    document.returned_in = returned_in(connection, site_id, sale_id)?
        .into_iter()
        .filter_map(|returned| returned.receipt_no)
        .collect();
    dress_as_return(connection, site_id, sale_id, &mut document)?;
    Ok(document)
}

/// The promotions a sale kept for its paper (0104), in the order they came off.
fn sale_promotions(
    connection: &Connection,
    sale_id: &str,
) -> Result<Vec<super::escpos::ReceiptPromotion>, EdgeError> {
    let mut statement = connection
        .prepare_cached(
            "SELECT name,sku_code,benefit_minor FROM sale_promotion_line
              WHERE sale_id=?1 ORDER BY promo_seq, rowid",
        )
        .map_err(db)?;
    let rows = statement
        .query_map([sale_id], |row| {
            Ok(super::escpos::ReceiptPromotion {
                name: row.get(0)?,
                sku_code: row.get(1)?,
                benefit_minor: row.get(2)?,
            })
        })
        .map_err(db)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db)
}

/// The number a customer reads back over the phone.
///
/// A UUID is not something anybody says out loud, so this is the site, the
/// day, and the last six of the sale id — short, unambiguous within a shop's
/// day, and derived rather than allocated, which means no counter to keep and
/// nothing to get out of step after a restore.
pub(crate) fn receipt_number(site_id: &str, sale_id: &str, completed_at: &str) -> String {
    let day: String = completed_at
        .chars()
        .filter(char::is_ascii_digit)
        .take(8)
        .collect();
    let tail: String = sale_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!(
        "{}-{day}-{}",
        site_id.to_ascii_uppercase(),
        tail.to_ascii_uppercase()
    )
}

// ════════════════════════════════════════════════════════════════════════════
// A return is its own receipt; a struk is found by its number and printed
// once (Hari, 28–29 Oct 2026)
// ════════════════════════════════════════════════════════════════════════════

/// What the till is told when it asks to return a return's receipt.
pub const RETURN_RECEIPT_NOT_RETURNABLE: &str =
    "Struk return tidak bisa di-return · barang hasil tukar tidak bisa ditukar lagi";

/// What the till is told when a struk already has a return on it: one
/// return per struk, the rest of it stays sold (Hari, 29 Oct 2026).
pub const STRUK_ALREADY_RETURNED: &str =
    "Struk ini sudah pernah di-return · tidak bisa di-return lagi";

/// What the till is told when a struk is printed a second time.
pub const NO_REPRINT: &str = "tidak bisa cetak ulang";

/// Whether `sale_id` is itself a return's receipt: the replacement sale of a
/// return (0102), or of an exchange rung before it.
pub fn is_return_receipt(connection: &Connection, sale_id: &str) -> Result<bool, EdgeError> {
    connection
        .prepare_cached(
            "SELECT EXISTS(SELECT 1 FROM return_receipt WHERE replacement_sale_id=?1)
                 OR EXISTS(SELECT 1 FROM sale_return
                            WHERE refund_method='EXCHANGE' AND refund_reference=?1)",
        )
        .map_err(db)?
        .query_row([sale_id], |row| row.get::<_, bool>(0))
        .map_err(db)
}

/// The number for a return that rang no replacement: the next at the seat of
/// the drawer it was made on, from the run the sales use. Not yet taken — the
/// `return_receipt` row takes it, in the same transaction.
pub(crate) fn next_return_number(
    connection: &Connection,
    shift_id: Option<&str>,
) -> Result<(String, i64, String), EdgeError> {
    let seat = receipt_seat(connection, shift_id)?;
    let (n, receipt_no) = next_receipt(connection, &seat)?;
    Ok((seat, n, receipt_no))
}

/// One return receipt, as `exchange_sale` writes it.
pub(crate) struct ReturnReceiptRow<'a> {
    pub return_id: &'a str,
    pub receipt_no: &'a str,
    /// The seat and number when the return numbered itself.
    pub numbered_at: Option<(&'a str, i64)>,
    pub from_sale_id: &'a str,
    pub replacement_sale_id: Option<&'a str>,
    pub back_minor: i64,
    pub replacement_minor: i64,
    pub paid_minor: i64,
    pub forfeited_minor: i64,
    pub at: DateTime<Utc>,
}

pub(crate) fn record_return_receipt(
    tx: &Transaction<'_>,
    row: &ReturnReceiptRow<'_>,
) -> Result<(), EdgeError> {
    tx.prepare_cached(
        "INSERT INTO return_receipt(return_id,receipt_no,terminal_id,n,from_sale_id,
                                    replacement_sale_id,back_minor,replacement_minor,
                                    paid_minor,forfeited_minor,created_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
    )
    .map_err(db)?
    .execute(params![
        row.return_id,
        row.receipt_no,
        row.numbered_at.map(|(seat, _)| seat),
        row.numbered_at.map(|(_, n)| n),
        row.from_sale_id,
        row.replacement_sale_id,
        row.back_minor,
        row.replacement_minor,
        row.paid_minor,
        row.forfeited_minor,
        stamp(row.at)
    ])
    .map_err(db)?;
    Ok(())
}

/// One return made against a struk: "Di-return di <receipt_no>".
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReturnedIn {
    pub return_id: String,
    /// The return's own receipt. Null for a refund in money made before 28
    /// Oct 2026, which had none.
    pub receipt_no: Option<String>,
    pub occurred_at: String,
}

/// Every return made against `sale_id`, oldest first.
pub fn returned_in(
    connection: &Connection,
    site_id: &str,
    sale_id: &str,
) -> Result<Vec<ReturnedIn>, EdgeError> {
    let rows: Vec<(String, Option<String>, Option<String>, String)> = {
        let mut statement = connection
            .prepare_cached(
                "SELECT r.id, k.receipt_no,
                        CASE WHEN r.refund_method='EXCHANGE' THEN r.refund_reference END,
                        r.occurred_at
                   FROM sale_return r
              LEFT JOIN return_receipt k ON k.return_id = r.id
                  WHERE r.sale_id=?1
                  ORDER BY r.occurred_at, r.id",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([sale_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    let mut out = Vec::with_capacity(rows.len());
    for (return_id, kept, replacement, occurred_at) in rows {
        // An exchange from before 0102 has no row of its own: its receipt
        // was the replacement sale's.
        let receipt_no = match (kept, replacement) {
            (Some(kept), _) => Some(kept),
            (None, Some(replacement)) => {
                let completed_at: Option<String> = connection
                    .prepare_cached("SELECT completed_at FROM sale WHERE id=?1")
                    .map_err(db)?
                    .query_row([&replacement], |row| row.get(0))
                    .optional()
                    .map_err(db)?;
                match completed_at {
                    Some(completed_at) => Some(receipt_no_of(
                        connection,
                        site_id,
                        &replacement,
                        &completed_at,
                    )?),
                    None => None,
                }
            }
            (None, None) => None,
        };
        out.push(ReturnedIn {
            return_id,
            receipt_no,
            occurred_at,
        });
    }
    Ok(out)
}

/// The pieces a return took back, as receipt lines: quantity −1 and a
/// negative total, at what each was charged on its own struk.
fn back_lines(connection: &Connection, return_id: &str) -> Result<Vec<ReceiptLine>, EdgeError> {
    let mut lines = Vec::new();
    for sql in [
        "SELECT r.sku_code, r.refund_minor, COALESCE(c.name, r.sku_code)
           FROM sale_return_line r
      LEFT JOIN catalog_item c ON c.sku_code = r.sku_code
          WHERE r.return_id=?1
          ORDER BY r.epc",
        "SELECT u.sku_code, u.refund_minor, COALESCE(c.name, u.sku_code)
           FROM unmatched_return_line u
      LEFT JOIN catalog_item c ON c.sku_code = u.sku_code
          WHERE u.return_id=?1
          ORDER BY u.unmatched_line_id",
    ] {
        let mut statement = connection.prepare_cached(sql).map_err(db)?;
        let rows = statement
            .query_map([return_id], |row| {
                let charged: i64 = row.get(1)?;
                Ok(ReceiptLine {
                    sku_code: row.get(0)?,
                    name: row.get(2)?,
                    quantity: -1,
                    unit_price_minor: charged,
                    line_total_minor: -charged,
                    base_unit_price_minor: None,
                    exchangeable: true,
                    no_exchange_by: None,
                })
            })
            .map_err(db)?;
        for row in rows {
            lines.push(row.map_err(db)?);
        }
    }
    Ok(lines)
}

/// The head of one return receipt.
struct ReturnReceiptHead {
    return_id: String,
    receipt_no: String,
    from_sale_id: String,
    paid_minor: i64,
    forfeited_minor: i64,
}

fn return_receipt_head(
    connection: &Connection,
    column: &str,
    value: &str,
) -> Result<Option<ReturnReceiptHead>, EdgeError> {
    // `column` is one of two literals below, never a caller's word.
    let sql = format!(
        "SELECT return_id,receipt_no,from_sale_id,paid_minor,forfeited_minor
           FROM return_receipt WHERE {column}=?1"
    );
    connection
        .prepare_cached(&sql)
        .map_err(db)?
        .query_row([value], |row| {
            Ok(ReturnReceiptHead {
                return_id: row.get(0)?,
                receipt_no: row.get(1)?,
                from_sale_id: row.get(2)?,
                paid_minor: row.get(3)?,
                forfeited_minor: row.get(4)?,
            })
        })
        .optional()
        .map_err(db)
}

fn sale_receipt_no(
    connection: &Connection,
    site_id: &str,
    sale_id: &str,
) -> Result<String, EdgeError> {
    let completed_at: String = connection
        .prepare_cached("SELECT completed_at FROM sale WHERE id=?1")
        .map_err(db)?
        .query_row([sale_id], |row| row.get(0))
        .optional()
        .map_err(db)?
        .ok_or_else(|| EdgeError::NotFound(format!("sale {sale_id}")))?;
    receipt_no_of(connection, site_id, sale_id, &completed_at)
}

/// A replacement sale's paper is the return's receipt: the pieces back (−)
/// above the replacements (+), "Return dari" the struk they came from, the
/// difference as its total, and the credit the pieces gave left off the
/// tenders — the lines already say it. A return receipt promises no return.
fn dress_as_return(
    connection: &Connection,
    site_id: &str,
    sale_id: &str,
    document: &mut ReceiptDocument,
) -> Result<(), EdgeError> {
    let Some(head) = return_receipt_head(connection, "replacement_sale_id", sale_id)? else {
        return Ok(());
    };
    document.returned_from = Some(sale_receipt_no(connection, site_id, &head.from_sale_id)?);
    let mut lines = back_lines(connection, &head.return_id)?;
    lines.append(&mut document.lines);
    document.lines = lines;
    document.subtotal_minor = document
        .lines
        .iter()
        .map(|line| line.line_total_minor)
        .sum();
    document.discount_minor = 0;
    document.total_minor = head.paid_minor;
    let credit = head.from_sale_id.clone();
    document.tenders.retain(|tender| {
        !(tender.method == "OTHER" && tender.reference.as_deref() == Some(credit.as_str()))
    });
    document.paid_minor = document
        .tenders
        .iter()
        .map(|tender| tender.amount_minor)
        .sum();
    document.forfeited_minor = head.forfeited_minor;
    document.footer = None;
    document.exchange_until = None;
    Ok(())
}

/// The paper of a return that rang no replacement: only the pieces back,
/// nothing paid, the whole value forfeited.
fn bare_return_document(
    connection: &Connection,
    shop_name: &str,
    site_id: &str,
    head: &ReturnReceiptHead,
) -> Result<ReceiptDocument, EdgeError> {
    let (actor_id, occurred_at): (String, String) = connection
        .prepare_cached("SELECT actor_id,occurred_at FROM sale_return WHERE id=?1")
        .map_err(db)?
        .query_row([&head.return_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(db)?;
    let lines = back_lines(connection, &head.return_id)?;
    Ok(ReceiptDocument {
        shop_name: shop_name.to_string(),
        header_image: crate::edge::receipt_header::current(connection).ok(),
        shop_line_1: None,
        shop_line_2: None,
        site_id: site_id.to_string(),
        // No sale: the return names itself.
        sale_id: head.return_id.clone(),
        receipt_no: head.receipt_no.clone(),
        completed_at: occurred_at,
        cashier: actor_id,
        subtotal_minor: lines.iter().map(|line| line.line_total_minor).sum(),
        lines,
        charges: Vec::new(),
        discount_minor: 0,
        total_minor: 0,
        tenders: Vec::new(),
        paid_minor: 0,
        change_minor: 0,
        points_earned: 0,
        footer: None,
        stamp: None,
        untagged_open: Vec::new(),
        returned_from: Some(sale_receipt_no(connection, site_id, &head.from_sale_id)?),
        returned_in: Vec::new(),
        forfeited_minor: head.forfeited_minor,
        exchange_until: None,
        // A return's paper promises no return; its terms only name the
        // replacements, so the two conditions never print.
        require_hang_tag: true,
        require_receipt: true,
        promotions: Vec::new(),
    })
}

/// One piece on a struk as the Return screen needs it: what it is, what it
/// was charged, and whether it may still come back.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReceiptPiece {
    /// The tag read back on a return. Null for a piece sold without one; it
    /// then comes back by `sku_code`.
    pub epc: Option<String>,
    pub sku_code: String,
    pub name: String,
    pub charged_minor: i64,
    /// Already taken back on an earlier return: never twice.
    pub returned: bool,
    /// False when a return policy says it never comes back (postgres 1006).
    pub exchangeable: bool,
}

/// `GET /api/v1/store/receipts/{receipt_no}`: one struk, found only by its
/// whole number — never listed or browsed (Hari, 28 Oct 2026).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReceiptLookup {
    /// `SALE` — a struk a return may start from; `RETURN` — a return's own
    /// receipt (with or without replacements), never returnable.
    pub kind: String,
    /// The sale; null for a return that rang no replacement.
    pub sale_id: Option<String>,
    /// The return, when this is a return's receipt.
    pub return_id: Option<String>,
    /// `PAID`, `VOIDED`, `RETURNED` (anything came back against it) or
    /// `RETURN` (it is a return's receipt).
    pub status: String,
    /// The paper as printed — never printed again.
    pub receipt: ReceiptDocument,
    /// Whether a return may start from it now.
    pub returnable: bool,
    /// Why not, in the till's words, when `returnable` is false.
    pub refusal: Option<String>,
    /// The last day written on the sale (`YYYY-MM-DD`), when one was.
    pub return_by: Option<String>,
    /// "Di-return di …": the returns made against it.
    pub returned_in: Vec<ReturnedIn>,
    /// Every piece on a SALE struk; empty on a RETURN.
    pub pieces: Vec<ReceiptPiece>,
}

/// Which sale or return `receipt_no` names: the till's seven letters (a
/// sale's, or a return's own), or the derived number of a sale from before
/// them. Exact and whole — a part of a number finds nothing.
pub(crate) enum ReceiptTarget {
    Sale(String),
    Return(String),
}

pub(crate) fn find_receipt(
    connection: &Connection,
    site_id: &str,
    receipt_no: &str,
) -> Result<ReceiptTarget, EdgeError> {
    let wanted = receipt_no.trim().to_ascii_uppercase();
    if wanted.is_empty() {
        return Err(EdgeError::Validation("ketik nomor struk".into()));
    }
    let sale: Option<String> = connection
        .prepare_cached("SELECT sale_id FROM sale_receipt WHERE receipt_no=?1")
        .map_err(db)?
        .query_row([&wanted], |row| row.get(0))
        .optional()
        .map_err(db)?;
    if let Some(sale_id) = sale {
        return Ok(ReceiptTarget::Sale(sale_id));
    }
    let returned: Option<String> = connection
        .prepare_cached("SELECT return_id FROM return_receipt WHERE receipt_no=?1")
        .map_err(db)?
        .query_row([&wanted], |row| row.get(0))
        .optional()
        .map_err(db)?;
    if let Some(return_id) = returned {
        return Ok(ReceiptTarget::Return(return_id));
    }
    // A sale from before the seven letters prints `SITE-YYYYMMDD-XXXXXX`.
    let derived: Vec<String> = {
        let mut statement = connection
            .prepare_cached(
                "SELECT s.id FROM sale s
                  WHERE NOT EXISTS(SELECT 1 FROM sale_receipt k WHERE k.sale_id = s.id)
                    AND upper(?1) || '-' || replace(substr(s.completed_at, 1, 10), '-', '')
                        || '-' || upper(substr(replace(s.id, '-', ''), -6)) = ?2
                  LIMIT 2",
            )
            .map_err(db)?;
        let rows = statement
            .query_map(params![site_id, wanted], |row| row.get(0))
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    match derived.as_slice() {
        [sale_id] => Ok(ReceiptTarget::Sale(sale_id.clone())),
        _ => Err(EdgeError::NotFound(format!("Struk {wanted} tidak ada"))),
    }
}

/// The struk behind a number, with what a return from it may take.
pub fn lookup_receipt(
    connection: &Connection,
    shop_name: &str,
    site_id: &str,
    receipt_no: &str,
) -> Result<ReceiptLookup, EdgeError> {
    let sale_id = match find_receipt(connection, site_id, receipt_no)? {
        ReceiptTarget::Return(return_id) => {
            let head = return_receipt_head(connection, "return_id", &return_id)?
                .ok_or_else(|| EdgeError::NotFound(format!("return {return_id}")))?;
            return Ok(ReceiptLookup {
                kind: "RETURN".into(),
                sale_id: None,
                return_id: Some(return_id),
                status: "RETURN".into(),
                receipt: bare_return_document(connection, shop_name, site_id, &head)?,
                returnable: false,
                refusal: Some(RETURN_RECEIPT_NOT_RETURNABLE.into()),
                return_by: None,
                returned_in: Vec::new(),
                pieces: Vec::new(),
            });
        }
        ReceiptTarget::Sale(sale_id) => sale_id,
    };
    let footer = super::return_policy::receipt_footer(connection, &sale_id)?;
    let receipt = receipt_document(connection, &sale_id, shop_name, site_id, footer.as_deref())?;
    let as_return = return_receipt_head(connection, "replacement_sale_id", &sale_id)?;
    // What went out on a return comes back only when the return policy says
    // so (1007); a return with nothing out has no goods to take back anyway.
    let returnable_returns = super::return_policy::current(connection)?
        .setting
        .return_receipt_returnable;
    if !returnable_returns && (as_return.is_some() || is_return_receipt(connection, &sale_id)?) {
        return Ok(ReceiptLookup {
            kind: "RETURN".into(),
            sale_id: Some(sale_id),
            return_id: as_return.map(|head| head.return_id),
            status: "RETURN".into(),
            receipt,
            returnable: false,
            refusal: Some(RETURN_RECEIPT_NOT_RETURNABLE.into()),
            return_by: None,
            returned_in: Vec::new(),
            pieces: Vec::new(),
        });
    }

    let (status, return_by): (String, Option<String>) = connection
        .prepare_cached("SELECT status,return_by FROM sale WHERE id=?1")
        .map_err(db)?
        .query_row([&sale_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(db)?;
    let promise = super::return_policy::current(connection)?;
    let name_of = |sku: &str| -> Result<String, EdgeError> {
        Ok(connection
            .prepare_cached("SELECT name FROM catalog_item WHERE sku_code=?1")
            .map_err(db)?
            .query_row([sku], |row| row.get::<_, String>(0))
            .optional()
            .map_err(db)?
            .unwrap_or_else(|| sku.to_string()))
    };
    let mut pieces = Vec::new();
    for line in sold_lines(connection, &sale_id)? {
        pieces.push(ReceiptPiece {
            name: name_of(&line.sku_code)?,
            exchangeable: super::return_policy::refused_on_sale(
                connection,
                &promise,
                &sale_id,
                &line.sku_code,
            )?
            .is_none(),
            epc: Some(line.epc),
            sku_code: line.sku_code,
            charged_minor: line.charged_minor,
            returned: line.already_returned,
        });
    }
    for line in untagged_sold_lines(connection, &sale_id)? {
        pieces.push(ReceiptPiece {
            name: name_of(&line.sku_code)?,
            exchangeable: super::return_policy::refused_on_sale(
                connection,
                &promise,
                &sale_id,
                &line.sku_code,
            )?
            .is_none(),
            epc: None,
            sku_code: line.sku_code,
            charged_minor: line.charged_minor,
            returned: line.already_returned,
        });
    }
    let returned_in = returned_in(connection, site_id, &sale_id)?;

    let refusal = if status == "VOIDED" {
        Some("Struk ini sudah dibatalkan".to_string())
    } else if !returned_in.is_empty() && promise.setting.one_return_per_receipt {
        Some(STRUK_ALREADY_RETURNED.to_string())
    } else if pieces.iter().all(|piece| piece.returned) {
        Some("Semua barang struk ini sudah dikembalikan".to_string())
    } else if pieces
        .iter()
        .filter(|piece| !piece.returned)
        .all(|piece| !piece.exchangeable)
    {
        Some("Barang di struk ini tidak bisa ditukar".to_string())
    } else {
        super::return_policy::assert_within_window(connection, &sale_id)
            .err()
            .map(|error| match error {
                EdgeError::Conflict(words) => words,
                other => other.to_string(),
            })
    };
    Ok(ReceiptLookup {
        kind: "SALE".into(),
        status: if status == "VOIDED" {
            "VOIDED".into()
        } else if returned_in.is_empty() {
            "PAID".into()
        } else {
            "RETURNED".into()
        },
        sale_id: Some(sale_id),
        return_id: None,
        receipt,
        returnable: refusal.is_none(),
        refusal,
        return_by,
        returned_in,
        pieces,
    })
}

/// The paper behind a number, for a printer.
pub fn document_for_number(
    connection: &Connection,
    shop_name: &str,
    site_id: &str,
    receipt_no: &str,
) -> Result<ReceiptDocument, EdgeError> {
    match find_receipt(connection, site_id, receipt_no)? {
        ReceiptTarget::Sale(sale_id) => {
            let footer = super::return_policy::receipt_footer(connection, &sale_id)?;
            receipt_document(connection, &sale_id, shop_name, site_id, footer.as_deref())
        }
        ReceiptTarget::Return(return_id) => {
            let head = return_receipt_head(connection, "return_id", &return_id)?
                .ok_or_else(|| EdgeError::NotFound(format!("return {return_id}")))?;
            bare_return_document(connection, shop_name, site_id, &head)
        }
    }
}

/// Spend the one print a struk has: written the first time it goes to a
/// printer, refused every time after (no Cetak ulang, Cetak salinan or
/// Ctrl+P anywhere). A copy is refused outright.
pub fn claim_print(
    connection: &Connection,
    receipt_no: &str,
    actor: &str,
    copy: bool,
    now: DateTime<Utc>,
) -> Result<(), EdgeError> {
    if copy {
        return Err(EdgeError::Conflict(format!(
            "Struk {receipt_no} {NO_REPRINT}"
        )));
    }
    let written = connection
        .prepare_cached(
            "INSERT INTO receipt_print(receipt_no,printed_at,printed_by) VALUES(?1,?2,?3)
             ON CONFLICT(receipt_no) DO NOTHING",
        )
        .map_err(db)?
        .execute(params![receipt_no, stamp(now), actor.trim()])
        .map_err(db)?;
    if written == 0 {
        return Err(EdgeError::Conflict(format!(
            "Struk {receipt_no} sudah dicetak · {NO_REPRINT}"
        )));
    }
    Ok(())
}

/// Give a print back when the printer took nothing — a network printer that
/// refused the connection printed no paper, and the struk still owes one.
pub fn release_print(connection: &Connection, receipt_no: &str) -> Result<(), EdgeError> {
    connection
        .prepare_cached("DELETE FROM receipt_print WHERE receipt_no=?1")
        .map_err(db)?
        .execute([receipt_no])
        .map_err(db)?;
    Ok(())
}

// ════════════════════════════════════════════════════════════════════════════
// Held sales — Tunda (client, 23 Oct 2026)
// ════════════════════════════════════════════════════════════════════════════

/// `POST /api/v1/store/held`: put a basket aside on this node.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct HoldSaleRequest {
    /// The till's own basket, kept as it was sent and handed back on resume.
    #[cfg_attr(feature = "ts", ts(type = "unknown"))]
    pub basket: serde_json::Value,
    pub total_minor: i64,
    pub pcs: i64,
    /// The seat it was held at. Optional: the holder's open shift says so.
    #[serde(default)]
    pub terminal_id: Option<String>,
    /// Set by the router from the session.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(skip))]
    pub actor_id: String,
}

/// The answer to a hold.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct HeldSaleCreated {
    pub id: String,
    pub held_by_name: String,
    pub held_at: String,
}

/// One held basket, as `GET /api/v1/store/held` lists it and resume returns it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct HeldSale {
    pub id: String,
    pub terminal_id: Option<String>,
    pub held_by: String,
    pub held_by_name: String,
    pub held_at: String,
    pub business_date: String,
    pub total_minor: i64,
    pub pcs: i64,
    #[cfg_attr(feature = "ts", ts(type = "unknown"))]
    pub basket: serde_json::Value,
}

/// `DELETE /api/v1/store/held/{id}`: thrown away, with the Kepala toko's yes.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DropHeldRequest {
    pub supervisor: Supervisor,
    /// What the Kepala toko checked, SKU by SKU (client, 25 Oct 2026). It has
    /// to be the whole basket — every SKU, at the basket's quantity — or the
    /// drop is refused with [`DROP_NOT_ALL_CHECKED`].
    #[serde(default)]
    pub checked: Vec<CheckedPiece>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(skip))]
    pub actor_id: String,
}

/// So many pieces of one SKU, seen by the Kepala toko before a tunda goes.
/// A Barang tak dikenal has no SKU and is checked under the empty one.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CheckedPiece {
    pub sku: String,
    pub quantity: i64,
}

/// `POST /api/v1/store/held/{id}/resume`. The body is optional: the person
/// who held a basket resumes it with none.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ResumeHeldRequest {
    /// The Kepala toko's yes, for a basket somebody else held — how a tunda
    /// past its thirty minutes is settled once the head has unlocked the till
    /// (client, 25 Oct 2026).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub supervisor: Option<Supervisor>,
    /// Set by the router from the session.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(skip))]
    pub actor_id: String,
    /// Set by the router, never by the caller: auth is off, so there is no
    /// person signed in to hold the basket to.
    #[serde(skip)]
    #[cfg_attr(feature = "ts", ts(skip))]
    pub anyone: bool,
}

/// How a resume ends when somebody else held the basket and no supervisor
/// said yes: "Hanya Siti yang bisa melanjutkan tunda ini". The router answers
/// it 403 in these words alone (`http.rs`, `store_resume_held`).
pub const ONLY_THE_HOLDER_RESUMES: &str = "yang bisa melanjutkan tunda ini";

/// Said when a drop's check does not account for the whole basket. The router
/// answers it 422 in these words alone (`http.rs`, `store_drop_held`).
pub const DROP_NOT_ALL_CHECKED: &str = "Supervisor wajib cek semua barang";

fn display_name_of(connection: &Connection, username: &str) -> Result<String, EdgeError> {
    Ok(connection
        .prepare_cached("SELECT display_name FROM edge_user WHERE username=?1")
        .map_err(db)?
        .query_row([username], |row| row.get::<_, Option<String>>(0))
        .optional()
        .map_err(db)?
        .flatten()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| username.to_string()))
}

/// Put a basket aside for today. Any till of the store may resume it.
pub fn hold_sale(
    tx: &Transaction<'_>,
    request: &HoldSaleRequest,
    now: DateTime<Utc>,
) -> Result<HeldSaleCreated, EdgeError> {
    let actor = request.actor_id.trim();
    if actor.is_empty() {
        return Err(EdgeError::Validation("actor_id is required".into()));
    }
    if request.total_minor < 0 || request.pcs < 0 {
        return Err(EdgeError::Validation(
            "a held basket cannot come to less than nothing".into(),
        ));
    }
    if request.basket.is_null() {
        return Err(EdgeError::Validation("a held sale needs its basket".into()));
    }
    let terminal = match request
        .terminal_id
        .as_deref()
        .map(str::trim)
        .filter(|terminal| !terminal.is_empty())
    {
        Some(terminal) => Some(terminal.to_string()),
        None => match open_shift_of(tx, actor)? {
            Some(shift_id) => tx
                .prepare_cached("SELECT terminal_id FROM cash_shift WHERE id=?1")
                .map_err(db)?
                .query_row([&shift_id], |row| row.get::<_, String>(0))
                .optional()
                .map_err(db)?,
            None => None,
        },
    };
    let id = Uuid::new_v4().to_string();
    let held_at = stamp(now);
    let basket = serde_json::to_string(&request.basket)
        .map_err(|error| EdgeError::Validation(error.to_string()))?;
    tx.prepare_cached(
        "INSERT INTO held_sale(id,terminal_id,held_by,held_at,business_date,basket_json,
                               total_minor,pcs)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
    )
    .map_err(db)?
    .execute(params![
        id,
        terminal,
        actor,
        held_at,
        local_date(tx, now),
        basket,
        request.total_minor,
        request.pcs
    ])
    .map_err(db)?;
    Ok(HeldSaleCreated {
        id,
        held_by_name: display_name_of(tx, actor)?,
        held_at,
    })
}

fn held_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<(HeldSale, String)> {
    Ok((
        HeldSale {
            id: row.get(0)?,
            terminal_id: row.get(1)?,
            held_by: row.get(2)?,
            held_by_name: String::new(),
            held_at: row.get(3)?,
            business_date: row.get(4)?,
            total_minor: row.get(6)?,
            pcs: row.get(7)?,
            basket: serde_json::Value::Null,
        },
        row.get(5)?,
    ))
}

const HELD_COLUMNS: &str =
    "SELECT id,terminal_id,held_by,held_at,business_date,basket_json,total_minor,pcs
       FROM held_sale";

fn finish_held(
    connection: &Connection,
    (mut held, basket): (HeldSale, String),
) -> Result<HeldSale, EdgeError> {
    held.held_by_name = display_name_of(connection, &held.held_by)?;
    held.basket =
        serde_json::from_str(&basket).map_err(|error| EdgeError::Persistence(error.to_string()))?;
    Ok(held)
}

/// Today's held baskets, every cashier's, oldest first. One from an earlier
/// business day has expired and is not listed.
pub fn held_sales(connection: &Connection, now: DateTime<Utc>) -> Result<Vec<HeldSale>, EdgeError> {
    let rows = {
        let mut statement = connection
            .prepare(&format!(
                "{HELD_COLUMNS} WHERE status='HELD' AND business_date=?1 ORDER BY held_at, id"
            ))
            .map_err(db)?;
        let rows = statement
            .query_map([local_date(connection, now)], held_row)
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    rows.into_iter()
        .map(|row| finish_held(connection, row))
        .collect()
}

/// The held basket `id`, still held today — or why not.
fn open_held(connection: &Connection, id: &str, now: DateTime<Utc>) -> Result<HeldSale, EdgeError> {
    let row = connection
        .prepare_cached(&format!("{HELD_COLUMNS} WHERE id=?1 AND status='HELD'"))
        .map_err(db)?
        .query_row([id], held_row)
        .optional()
        .map_err(db)?
        .ok_or_else(|| EdgeError::NotFound(format!("held sale {id}")))?;
    if row.0.business_date != local_date(connection, now) {
        return Err(EdgeError::Conflict(
            "transaksi tunda ini sudah kedaluwarsa".into(),
        ));
    }
    finish_held(connection, row)
}

fn close_held(
    tx: &Transaction<'_>,
    id: &str,
    status: &str,
    by: &str,
    now: DateTime<Utc>,
) -> Result<(), EdgeError> {
    let changed = tx
        .prepare_cached(
            "UPDATE held_sale SET status=?2, closed_by=?3, closed_at=?4
              WHERE id=?1 AND status='HELD'",
        )
        .map_err(db)?
        .execute(params![id, status, by, stamp(now)])
        .map_err(db)?;
    if changed == 1 {
        Ok(())
    } else {
        Err(EdgeError::NotFound(format!("held sale {id}")))
    }
}

/// Take a held basket back to a till: it leaves the list, and the till gets
/// the basket it sent.
///
/// The person who held it takes it back as it is. Anybody else needs the
/// Kepala toko's yes (client, 25 Oct 2026); without one they are told whose
/// it is.
pub fn resume_held(
    tx: &Transaction<'_>,
    id: &str,
    request: &ResumeHeldRequest,
    now: DateTime<Utc>,
) -> Result<HeldSale, EdgeError> {
    let held = open_held(tx, id, now)?;
    let actor = request.actor_id.trim();
    match request.supervisor.as_ref() {
        Some(supervisor) => {
            verify_supervisor(tx, Some(supervisor), &[actor])?;
        }
        None if request.anyone || held.held_by == actor => {}
        None => {
            return Err(EdgeError::Forbidden(format!(
                "Hanya {} {ONLY_THE_HOLDER_RESUMES}",
                held.held_by_name
            )));
        }
    }
    close_held(tx, id, "RESUMED", actor, now)?;
    Ok(held)
}

/// Throw a held basket away, with the Kepala toko's finger or password, once
/// he has checked every piece in it (client, 25 Oct 2026). What he checked is
/// written on the approval row beside his name.
pub fn drop_held(
    tx: &Transaction<'_>,
    id: &str,
    request: &DropHeldRequest,
    now: DateTime<Utc>,
) -> Result<HeldSale, EdgeError> {
    let held = open_held(tx, id, now)?;
    let checked = all_checked(&held, &request.checked)
        .ok_or_else(|| EdgeError::Validation(DROP_NOT_ALL_CHECKED.into()))?;
    let approved_by =
        verify_supervisor(tx, Some(&request.supervisor), &[request.actor_id.as_str()])?;
    close_held(tx, id, "DROPPED", &approved_by, now)?;
    record_drop_check(
        tx,
        &held,
        &checked,
        request.actor_id.trim(),
        &approved_by,
        now,
    )?;
    Ok(held)
}

/// A SKU as a key: letters and digits only, upper-cased, so `00000004·103`
/// as the till prints it is `00000004103` as it is stored.
fn sku_key(sku: &str) -> String {
    sku.chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|letter| letter.to_ascii_uppercase())
        .collect()
}

/// The pieces in a held basket by SKU: one entry in `units` per piece, as the
/// till keeps it (`Held` in `pos-desktop/ui/src/till.tsx`). None for a basket
/// kept in some other shape.
fn held_pieces(basket: &serde_json::Value) -> Option<std::collections::BTreeMap<String, i64>> {
    let units = basket.get("units")?.as_array()?;
    let mut pieces = std::collections::BTreeMap::new();
    for unit in units {
        let sku = unit
            .get("sku_code")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        *pieces.entry(sku_key(sku)).or_insert(0_i64) += 1;
    }
    Some(pieces)
}

/// What was checked, by SKU, when it is the whole basket: every SKU in it at
/// its quantity, and nothing else. A basket kept in another shape is held to
/// the number of pieces it was held with.
fn all_checked(
    held: &HeldSale,
    checked: &[CheckedPiece],
) -> Option<std::collections::BTreeMap<String, i64>> {
    let mut seen = std::collections::BTreeMap::new();
    for piece in checked {
        if piece.quantity < 0 {
            return None;
        }
        let quantity = seen.entry(sku_key(&piece.sku)).or_insert(0_i64);
        *quantity = quantity.checked_add(piece.quantity)?;
    }
    seen.retain(|_, quantity| *quantity > 0);
    let whole = match held_pieces(&held.basket) {
        Some(basket) => basket == seen,
        None => {
            seen.values()
                .try_fold(0_i64, |sum, quantity| sum.checked_add(*quantity))
                == Some(held.pcs)
        }
    };
    whole.then_some(seen)
}

/// The Kepala toko's yes to a dropped tunda, on the till's approval row
/// (`0045`, `DROP_HOLD`): the pieces he checked, in words, and the basket's
/// tags.
fn record_drop_check(
    tx: &Transaction<'_>,
    held: &HeldSale,
    checked: &std::collections::BTreeMap<String, i64>,
    actor: &str,
    approved_by: &str,
    now: DateTime<Utc>,
) -> Result<(), EdgeError> {
    let pieces = checked
        .iter()
        .map(|(sku, quantity)| {
            if sku.is_empty() {
                format!("Barang tak dikenal x{quantity}")
            } else {
                format!("{sku} x{quantity}")
            }
        })
        .collect::<Vec<_>>();
    let detail = if pieces.is_empty() {
        format!("Tunda {} pcs dihapus", held.pcs)
    } else {
        format!(
            "Tunda {} pcs dihapus, semua barang dicek: {}",
            held.pcs,
            pieces.join(", ")
        )
    };
    let epcs: Vec<&str> = held
        .basket
        .get("units")
        .and_then(serde_json::Value::as_array)
        .map(|units| {
            units
                .iter()
                .filter(|unit| unit.get("untagged").is_none_or(serde_json::Value::is_null))
                .filter_map(|unit| unit.get("epc").and_then(serde_json::Value::as_str))
                .collect()
        })
        .unwrap_or_default();
    tx.prepare_cached(
        "INSERT INTO till_approval
           (id,idempotency_key,action,terminal_id,actor_id,approved_by,detail,reason,
            epcs_json,amount_minor,recorded_at)
         VALUES(?1,?2,'DROP_HOLD',?3,?4,?5,?6,NULL,?7,?8,?9)",
    )
    .map_err(db)?
    .execute(params![
        Uuid::new_v4().to_string(),
        format!("held:{}:drop", held.id),
        held.terminal_id.as_deref().unwrap_or_default(),
        if actor.is_empty() { "api" } else { actor },
        approved_by,
        detail,
        serde_json::to_string(&epcs).map_err(|error| EdgeError::Validation(error.to_string()))?,
        held.total_minor,
        stamp(now),
    ])
    .map_err(db)?;
    Ok(())
}

/// Refuse to close a drawer while its seat has a basket held today.
fn require_no_held(
    connection: &Connection,
    shift_id: &str,
    now: DateTime<Utc>,
) -> Result<(), EdgeError> {
    let held: i64 = connection
        .prepare_cached(
            "SELECT COUNT(*) FROM held_sale h
               JOIN cash_shift s ON s.id=?1
              WHERE h.status='HELD' AND h.business_date=?2
                AND (h.terminal_id=s.terminal_id
                     OR (h.terminal_id IS NULL AND h.held_by=s.opened_by))",
        )
        .map_err(db)?
        .query_row(params![shift_id, local_date(connection, now)], |row| {
            row.get(0)
        })
        .map_err(db)?;
    if held > 0 {
        return Err(EdgeError::Conflict(format!(
            "Masih ada {held} transaksi tunda"
        )));
    }
    Ok(())
}

// ════════════════════════════════════════════════════════════════════════════
// A cashier who closed is done for the day at that till (client, 23 Oct 2026)
// ════════════════════════════════════════════════════════════════════════════

/// Refuse `actor` at `terminal` when they closed a shift there today:
/// "{name} sudah tutup kasir hari ini". A shift taken over from them is not a
/// close of theirs.
pub fn refuse_closed_today(
    connection: &Connection,
    actor: &str,
    terminal: &str,
    now: DateTime<Utc>,
) -> Result<(), EdgeError> {
    let actor = actor.trim();
    let terminal = terminal.trim();
    if actor.is_empty() || terminal.is_empty() {
        return Ok(());
    }
    let closed: i64 = connection
        .prepare_cached(
            "SELECT COUNT(*) FROM cash_shift
              WHERE opened_by=?1 AND terminal_id=?2 AND status='CLOSED'
                AND taken_over_by IS NULL AND business_date=?3",
        )
        .map_err(db)?
        .query_row(
            params![actor, terminal, local_date(connection, now)],
            |row| row.get(0),
        )
        .map_err(db)?;
    if closed > 0 {
        return Err(EdgeError::Forbidden(format!(
            "{} sudah tutup kasir hari ini",
            display_name_of(connection, actor)?
        )));
    }
    Ok(())
}

// ════════════════════════════════════════════════════════════════════════════
// The 7-letter transaction number (client, 23 Oct 2026)
// ════════════════════════════════════════════════════════════════════════════

/// Four letters' worth of numbers: 26⁴.
const RECEIPT_SPACE: u64 = 26 * 26 * 26 * 26;

/// The till's running number scrambled into four letters:
/// `x = ((n mod 26⁴) × 214013 + 97151) mod 26⁴`, written base-26 with A = 0.
/// 214013 shares no factor with 26⁴, so no two numbers in a cycle meet.
pub(crate) fn scrambled_letters(n: u64) -> String {
    let mut x = ((n % RECEIPT_SPACE) * 214_013 + 97_151) % RECEIPT_SPACE;
    let mut letters = [b'A'; 4];
    for slot in letters.iter_mut().rev() {
        // `x % 26` is below 26, so the cast cannot truncate.
        #[allow(clippy::cast_possible_truncation)]
        let digit = (x % 26) as u8;
        *slot = b'A' + digit;
        x /= 26;
    }
    String::from_utf8_lossy(&letters).into_owned()
}

/// The store's two letters: the first two letters of the site's name,
/// uppercase — its id's when the name has fewer, `X` after that.
pub(crate) fn store_letters(connection: &Connection) -> String {
    let site = super::site_profile::own(connection);
    let name = site
        .as_ref()
        .map(|site| site.name.clone())
        .unwrap_or_default();
    let id = site.map(|site| site.site_id).unwrap_or_default();
    let mut letters: String = name
        .chars()
        .chain(id.chars())
        .filter(char::is_ascii_alphabetic)
        .take(2)
        .collect::<String>()
        .to_ascii_uppercase();
    while letters.len() < 2 {
        letters.push('X');
    }
    letters
}

/// A = the store's first till (`KASIR-1`), B the second… Z past 26, and for an
/// id from before seats.
pub(crate) fn till_letter(terminal_id: &str) -> char {
    terminal_id
        .strip_prefix(SEAT_PREFIX)
        .and_then(|number| number.parse::<u32>().ok())
        .filter(|number| (1..=26).contains(number))
        .and_then(|number| char::from_u32(u32::from(b'A') + number - 1))
        .unwrap_or('Z')
}

/// The seat a sale was rung at: its shift's, else the store's first.
fn receipt_seat(connection: &Connection, shift_id: Option<&str>) -> Result<String, EdgeError> {
    let seat: Option<String> = match shift_id {
        Some(shift_id) => connection
            .prepare_cached("SELECT terminal_id FROM cash_shift WHERE id=?1")
            .map_err(db)?
            .query_row([shift_id], |row| row.get(0))
            .optional()
            .map_err(db)?,
        None => None,
    };
    Ok(seat.unwrap_or_else(|| format!("{SEAT_PREFIX}1")))
}

/// Replace this store's slices of the transaction numbers with the ones head
/// office just sent (postgres 1010); the count numbered from them stays.
pub(crate) fn apply_receipt_slices(
    tx: &Transaction<'_>,
    slices: &[crate::cloud::domain::receipt_number::ReceiptSlice],
) -> Result<(), rusqlite::Error> {
    tx.execute("DELETE FROM receipt_slice_state", [])?;
    for slice in slices {
        tx.prepare_cached("INSERT INTO receipt_slice_state (start,size) VALUES (?1,?2)")?
            .execute(params![slice.start, slice.size])?;
    }
    Ok(())
}

/// The next code from this store's slices — counted as used when `take` —
/// `None` when it holds none or has spent them, and the old number stands in.
fn next_slice_code(connection: &Connection, take: bool) -> Result<Option<String>, EdgeError> {
    use crate::cloud::domain::receipt_number::{code_at, ReceiptSlice};
    let slices: Vec<ReceiptSlice> = {
        // Head office grants them in rising order, so `start` is grant order.
        let mut statement = connection
            .prepare_cached("SELECT start,size FROM receipt_slice_state ORDER BY start")
            .map_err(db)?;
        let rows = statement
            .query_map([], |row| {
                Ok(ReceiptSlice {
                    start: row.get(0)?,
                    size: row.get(1)?,
                })
            })
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    if slices.is_empty() {
        return Ok(None);
    }
    let mut used: i64 = connection
        .prepare_cached("SELECT used FROM receipt_slice_counter WHERE singleton=1")
        .map_err(db)?
        .query_row([], |row| row.get(0))
        .optional()
        .map_err(db)?
        .unwrap_or(0);
    // A code an older number already printed is passed over, never reused.
    let found = loop {
        let Some(code) = code_at(&slices, used) else {
            break None;
        };
        used += 1;
        let taken: i64 = connection
            .prepare_cached(
                "SELECT (SELECT COUNT(*) FROM sale_receipt WHERE receipt_no=?1)
                      + (SELECT COUNT(*) FROM return_receipt WHERE receipt_no=?1)",
            )
            .map_err(db)?
            .query_row([&code], |row| row.get(0))
            .map_err(db)?;
        if taken == 0 {
            break Some(code);
        }
    };
    if take {
        connection
            .prepare_cached(
                "INSERT INTO receipt_slice_counter (singleton,used) VALUES (1,?1)
                 ON CONFLICT(singleton) DO UPDATE SET used=excluded.used",
            )
            .map_err(db)?
            .execute([used])
            .map_err(db)?;
    }
    Ok(found)
}

/// The next number at a seat, and what it reads as — not yet taken.
fn next_receipt(connection: &Connection, seat: &str) -> Result<(i64, String), EdgeError> {
    numbered(connection, seat, true)
}

/// The number a seat would give next, or gives now when `take`.
fn numbered(connection: &Connection, seat: &str, take: bool) -> Result<(i64, String), EdgeError> {
    // A return with no replacement numbers itself from the same run (0102),
    // so the sales and the returns at a seat never share a number.
    let last: i64 = connection
        .prepare_cached(
            "SELECT COALESCE(MAX(n), 0) FROM (
                 SELECT n FROM sale_receipt WHERE terminal_id=?1
                 UNION ALL
                 SELECT n FROM return_receipt WHERE terminal_id=?1 AND n IS NOT NULL)",
        )
        .map_err(db)?
        .query_row([seat], |row| row.get(0))
        .map_err(db)?;
    // Seven random-looking letters from head office's slice (postgres 1010);
    // the seat's own run below only while the store holds none.
    if let Some(code) = next_slice_code(connection, take)? {
        return Ok((last + 1, code));
    }
    let prefix = format!("{}{}", store_letters(connection), till_letter(seat));
    let mut n = last + 1;
    // On a clash take the next n — at most once round the four letters.
    for _ in 0..RECEIPT_SPACE {
        let receipt_no = format!(
            "{prefix}{}",
            scrambled_letters(u64::try_from(n).unwrap_or(0))
        );
        let taken: i64 = connection
            .prepare_cached(
                "SELECT (SELECT COUNT(*) FROM sale_receipt WHERE receipt_no=?1)
                      + (SELECT COUNT(*) FROM return_receipt WHERE receipt_no=?1)",
            )
            .map_err(db)?
            .query_row([&receipt_no], |row| row.get(0))
            .map_err(db)?;
        if taken == 0 {
            return Ok((n, receipt_no));
        }
        n += 1;
    }
    Err(EdgeError::Conflict(format!(
        "till {seat} has used every transaction number"
    )))
}

/// Give a sale its 7-letter number, inside the sale's own transaction (after
/// its `sale` row). The unique index on `receipt_no` does the final refusing.
pub(crate) fn allocate_receipt(
    tx: &Transaction<'_>,
    sale_id: &str,
    shift_id: Option<&str>,
) -> Result<String, EdgeError> {
    let seat = receipt_seat(tx, shift_id)?;
    let (n, receipt_no) = next_receipt(tx, &seat)?;
    tx.prepare_cached(
        "INSERT INTO sale_receipt(sale_id, terminal_id, n, receipt_no) VALUES(?1,?2,?3,?4)",
    )
    .map_err(db)?
    .execute(params![sale_id, seat, n, receipt_no])
    .map_err(db)?;
    Ok(receipt_no)
}

/// What the next sale by this person would be numbered — for the quote, so
/// the till can show it before Bayar. Not reserved: another sale at the same
/// seat first takes it, and the sale's own reply is the one that counts.
pub(crate) fn peek_receipt(
    connection: &Connection,
    actor: &str,
) -> Result<Option<String>, EdgeError> {
    if actor.trim().is_empty() {
        return Ok(None);
    }
    let Some(shift_id) = open_shift_of(connection, actor)? else {
        return Ok(None);
    };
    let seat = receipt_seat(connection, Some(&shift_id))?;
    numbered(connection, &seat, false).map(|(_, receipt_no)| Some(receipt_no))
}

/// A sale's number: the one it was given, or — for a sale from before
/// 7-letter numbers — the derived one it always printed.
pub(crate) fn receipt_no_of(
    connection: &Connection,
    site_id: &str,
    sale_id: &str,
    completed_at: &str,
) -> Result<String, EdgeError> {
    let kept: Option<String> = connection
        .prepare_cached("SELECT receipt_no FROM sale_receipt WHERE sale_id=?1")
        .map_err(db)?
        .query_row([sale_id], |row| row.get(0))
        .optional()
        .map_err(db)?;
    Ok(kept.unwrap_or_else(|| receipt_number(site_id, sale_id, completed_at)))
}

/// The receipt exactly as a printer receives it: ESC/POS for this paper, the
/// drawer's pulse when asked for, and a copy stamped as one.
///
/// One rendering for every printer. [`print_receipt`] sends these bytes to a
/// network printer; a till with a USB printer fetches them
/// (`POST /api/v1/store/sales/{id}/receipt/escpos`) and sends them down its
/// own cable — so the paper a customer takes home is the same paper whichever
/// way it came out.
pub fn render_receipt(
    document: &ReceiptDocument,
    paper: Option<&str>,
    drawer: Option<&str>,
    copy: bool,
) -> Vec<u8> {
    let paper = paper.map(PaperWidth::parse).unwrap_or(PaperWidth::Narrow);
    let drawer = drawer.map(DrawerMode::parse).unwrap_or(DrawerMode::None);
    let mut document = document.clone();
    if copy && document.stamp.is_none() {
        document.stamp = Some("** SALINAN **".to_string());
    }
    escpos::render(&document, paper, drawer)
}

/// Render and send. Best-effort on the drawer, never on the receipt: a printer
/// that refused is reported, because a customer standing there without a
/// receipt is not a success.
pub fn print_receipt(
    document: &ReceiptDocument,
    request: &PrintReceiptRequest,
) -> Result<usize, EdgeError> {
    let bytes = render_receipt(
        document,
        request.paper.as_deref(),
        request.drawer.as_deref(),
        request.copy,
    );
    super::printing::send_bytes(&request.printer_host, request.printer_port, &bytes)?;
    Ok(bytes.len())
}

/// `POST /api/v1/store/sales/{id}/receipt/escpos`: a receipt rendered for a
/// printer the node cannot reach — the USB printer on a till — and handed to
/// that till to send. The same three choices a print takes, and no address.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct RenderReceiptRequest {
    /// `NARROW` (58mm, 32 columns) or `WIDE` (80mm, 48).
    #[serde(default)]
    pub paper: Option<String>,
    /// `PRINTER_PULSE`, `MANUAL` or `NONE`.
    #[serde(default)]
    pub drawer: Option<String>,
    #[serde(default)]
    pub copy: bool,
}

// ════════════════════════════════════════════════════════════════════════════
// A member tied to a sale already rung (client, 24 Oct 2026)
// ════════════════════════════════════════════════════════════════════════════

/// `POST /api/v1/store/sales/member`: F5 "Daftar member" with a struk number.
/// The shopper who paid without a card registers at the counter, and the sale
/// on that struk becomes theirs.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AttachMemberRequest {
    /// The 7-letter number on the struk, `SPAPODH`. Spaces and case do not
    /// matter.
    pub receipt_no: String,
    /// The member's number, as the enrolment answered it.
    pub member_id: String,
}

/// The sale as it now stands: whose it is, and what it earned them.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AttachMemberResult {
    pub sale_id: String,
    pub receipt_no: String,
    pub member_id: String,
    /// Head office's name for them; their number when head office could not
    /// be asked.
    pub member_name: String,
    /// The sale's points for this member. Spendable once head office has the
    /// sale and this, the same as points earned at the till.
    pub points_earned: i64,
}

/// How an attach came out, before the router answers.
pub enum MemberAttach {
    /// Tied on now, or before to the same member: the same answer each time.
    Attached(AttachMemberResult),
    /// Already somebody else's sale. Their name when this node holds it; the
    /// router asks head office otherwise.
    Taken {
        receipt_no: String,
        member_id: String,
        member_name: Option<String>,
    },
}

/// A member's number as head office keeps it: the digits of a phone however
/// it was typed, anything else as it is (head office's `relay_member_id`).
fn member_key(raw: &str) -> String {
    let trimmed = raw.trim();
    let digits: String = trimmed.chars().filter(char::is_ascii_digit).collect();
    if !digits.is_empty()
        && trimmed
            .chars()
            .all(|c| c.is_ascii_digit() || " -.·".contains(c))
    {
        digits
    } else {
        trimmed.to_string()
    }
}

/// Tie a member to the sale on struk `receipt_no`, so they earn its points as
/// if they had been on it at the till.
///
/// Refused before anything is written: `Struk … tidak ada`, `… sudah di-void`,
/// `… sudah ditukar` (an exchange came back against it) and `… sudah diretur`
/// (a refund did) — goods that came back would otherwise earn. A sale rung
/// with a member, or tied to one here before, stays that member's: the same
/// member again is the same answer and nothing new travels, anybody else is
/// [`MemberAttach::Taken`].
///
/// Written once per sale (`sale_member`, `0089`), and told to head office as
/// `sales.member_attached` in the same transaction — behind the sale's own
/// fact on this node's stream, so it lands after the sale whether the sale
/// has reached head office yet or not.
pub fn attach_member(
    tx: &Transaction<'_>,
    site_id: &str,
    request: &AttachMemberRequest,
    member_name: Option<&str>,
    actor: &str,
    now: DateTime<Utc>,
) -> Result<MemberAttach, EdgeError> {
    let receipt_no: String = request
        .receipt_no
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_ascii_uppercase();
    if receipt_no.is_empty() {
        return Err(EdgeError::Validation("Nomor struk belum diisi".into()));
    }
    let member_id = member_key(&request.member_id);
    if member_id.is_empty() {
        return Err(EdgeError::Validation("Nomor member belum diisi".into()));
    }
    let sale: Option<(String, String, String)> = tx
        .prepare_cached(
            "SELECT s.id, s.status, s.completed_at
               FROM sale_receipt r JOIN sale s ON s.id = r.sale_id
              WHERE r.receipt_no = ?1",
        )
        .map_err(db)?
        .query_row([&receipt_no], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .optional()
        .map_err(db)?;
    let Some((sale_id, status, completed_at)) = sale else {
        return Err(EdgeError::NotFound(format!("Struk {receipt_no} tidak ada")));
    };
    if status == "VOIDED" {
        return Err(EdgeError::Conflict(format!("{receipt_no} sudah di-void")));
    }
    let returns: Vec<String> = {
        let mut statement = tx
            .prepare_cached("SELECT refund_method FROM sale_return WHERE sale_id=?1")
            .map_err(db)?;
        let rows = statement
            .query_map([&sale_id], |row| row.get(0))
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    if returns.iter().any(|method| method == "EXCHANGE") {
        return Err(EdgeError::Conflict(format!("{receipt_no} sudah ditukar")));
    }
    if !returns.is_empty() {
        return Err(EdgeError::Conflict(format!("{receipt_no} sudah diretur")));
    }

    // Tied on here before.
    let kept: Option<(String, Option<String>, i64)> = tx
        .prepare_cached(
            "SELECT member_id, member_name, points_earned FROM sale_member WHERE sale_id=?1",
        )
        .map_err(db)?
        .query_row([&sale_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .optional()
        .map_err(db)?;
    if let Some((kept_id, kept_name, points_earned)) = kept {
        if kept_id != member_id {
            return Ok(MemberAttach::Taken {
                receipt_no,
                member_id: kept_id,
                member_name: kept_name,
            });
        }
        return Ok(MemberAttach::Attached(AttachMemberResult {
            sale_id,
            receipt_no,
            member_name: kept_name
                .or_else(|| member_name.map(str::to_string))
                .unwrap_or_else(|| kept_id.clone()),
            member_id: kept_id,
            points_earned,
        }));
    }
    // Rung with a member: the sale's own fact says who, and what it earned.
    let rung = rung_sale_fact(tx, &sale_id)?;
    let rung_member = rung
        .as_ref()
        .and_then(|fact| fact.get("customer_id"))
        .and_then(serde_json::Value::as_str)
        .map(member_key)
        .filter(|id| !id.is_empty());
    if let Some(rung_member) = rung_member {
        if rung_member != member_id {
            return Ok(MemberAttach::Taken {
                receipt_no,
                member_id: rung_member,
                member_name: None,
            });
        }
        let points_earned = rung
            .as_ref()
            .and_then(|fact| fact.get("points_earned"))
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0);
        return Ok(MemberAttach::Attached(AttachMemberResult {
            sale_id,
            receipt_no,
            member_name: member_name.map_or_else(|| member_id.clone(), str::to_string),
            member_id,
            points_earned,
        }));
    }

    let (points_earned, lines) = member_points(
        tx,
        site_id,
        &sale_id,
        &completed_at,
        &member_id,
        rung.as_ref(),
    )?;
    tx.prepare_cached(
        "INSERT INTO sale_member(sale_id,member_id,member_name,points_earned,attached_by,attached_at)
         VALUES(?1,?2,?3,?4,?5,?6)",
    )
    .map_err(db)?
    .execute(params![
        sale_id,
        member_id,
        member_name,
        points_earned,
        actor,
        stamp(now)
    ])
    .map_err(db)?;
    // Each line's share of the award, as a sale fact carries it: a later
    // return at head office takes back what that piece earned, not nought.
    let held: Vec<serde_json::Value> = lines
        .iter()
        .filter_map(|(line, points)| match line {
            PricedAgain::Held(subject_id) => Some(serde_json::json!({
                "subject_id": subject_id,
                "points_earned": points,
            })),
            PricedAgain::Unmatched(_) => None,
        })
        .collect();
    let unmatched: Vec<serde_json::Value> = lines
        .iter()
        .filter_map(|(line, points)| match line {
            PricedAgain::Unmatched(id) => Some(serde_json::json!({
                "id": id,
                "points_earned": points,
            })),
            PricedAgain::Held(_) => None,
        })
        .collect();
    super::sync::enqueue_fact(
        tx,
        Uuid::new_v4(),
        crate::cloud::domain::FACT_SALES_MEMBER_ATTACHED,
        &serde_json::json!({
            "sale_id": sale_id,
            "site_id": site_id,
            "receipt_no": receipt_no,
            "customer_id": member_id,
            "points_earned": points_earned,
            "lines": held,
            "unmatched": unmatched,
            "actor_id": actor,
            "attached_at": stamp(now),
        }),
    )
    .map_err(db)?;
    Ok(MemberAttach::Attached(AttachMemberResult {
        sale_id,
        receipt_no,
        member_name: member_name.map_or_else(|| member_id.clone(), str::to_string),
        member_id,
        points_earned,
    }))
}

/// The sale's own `sales.completed` as the till wrote it, while this node
/// keeps it (`SYNC_RETENTION_DAYS` after head office has it). The node holds
/// who a sale was rung for, and which codes came off it, nowhere else.
fn rung_sale_fact(
    tx: &Transaction<'_>,
    sale_id: &str,
) -> Result<Option<serde_json::Value>, EdgeError> {
    let payload: Option<String> = tx
        .prepare_cached(
            "SELECT payload FROM sync_fact_log WHERE event_id=?1 AND event_type=?2
              ORDER BY seq DESC LIMIT 1",
        )
        .map_err(db)?
        .query_row(
            params![sale_id, crate::cloud::domain::FACT_SALES_COMPLETED],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?;
    Ok(payload.and_then(|text| serde_json::from_str(&text).ok()))
}

/// One line of a sale handed to the engine again: a held piece by its
/// subject, or an unmatched line by its id.
enum PricedAgain {
    Held(String),
    Unmatched(String),
}

/// The sale's points had the member been on it at the till.
///
/// Its basket — every line that names a SKU, the held pieces and the ones the
/// shop's stock could not give — priced again by this node's engine at the
/// instant it was rung, with the member, and with the codes that came off it
/// and their holds (read from the sale's own fact while the node keeps it).
/// So the earning rule is the very one that would have run. The award the till
/// recorded then cannot simply be handed over: a members-only "1 poin per
/// Rp 10.000" gave the anonymous sale nought. Only the points are kept; what
/// was paid stands as it was paid, and nothing here counts as a promotion's
/// use.
///
/// The book is the one in force now, not the sale's: one replaced since
/// prices the basket as it is today. A struk is tied on at its own counter,
/// minutes after it was rung, which is why that is close enough.
fn member_points(
    tx: &Transaction<'_>,
    site_id: &str,
    sale_id: &str,
    completed_at: &str,
    member_id: &str,
    rung: Option<&serde_json::Value>,
) -> Result<(i64, Vec<(PricedAgain, i64)>), EdgeError> {
    let mut basket: Vec<(PricedAgain, String)> = Vec::new();
    {
        let mut statement = tx
            .prepare_cached(
                "SELECT subject_id, sku_code FROM sale_line WHERE sale_id=?1 ORDER BY rowid",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([sale_id], |row| {
                Ok((PricedAgain::Held(row.get(0)?), row.get::<_, String>(1)?))
            })
            .map_err(db)?;
        for row in rows {
            basket.push(row.map_err(db)?);
        }
    }
    {
        // An unknown item is outside the points, as it was at the till.
        let mut statement = tx
            .prepare_cached(
                "SELECT id, sku_code FROM unmatched_sale_line
                  WHERE sale_id=?1 AND sku_code IS NOT NULL AND kind <> 'UNKNOWN'
                  ORDER BY line_no",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([sale_id], |row| {
                Ok((
                    PricedAgain::Unmatched(row.get(0)?),
                    row.get::<_, String>(1)?,
                ))
            })
            .map_err(db)?;
        for row in rows {
            basket.push(row.map_err(db)?);
        }
    }
    if basket.is_empty() {
        return Ok((0, Vec::new()));
    }
    let at = DateTime::parse_from_rfc3339(completed_at)
        .map(|at| at.with_timezone(&Utc))
        .map_err(|error| {
            EdgeError::Persistence(format!("sale {sale_id} has an unreadable time: {error}"))
        })?;
    let sku_codes: Vec<String> = basket.iter().map(|(_, sku)| sku.clone()).collect();
    let mut codes: Vec<String> = Vec::new();
    let mut holds: Vec<pricing_engine::CouponAuthorization> = Vec::new();
    let promotions = rung
        .and_then(|fact| fact.get("promotions"))
        .and_then(serde_json::Value::as_array);
    for promotion in promotions.into_iter().flatten() {
        let Some(code) = promotion
            .get("coupon_code")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|code| !code.is_empty())
        else {
            continue;
        };
        if !codes.iter().any(|known| known == code) {
            codes.push(code.to_string());
        }
        if let Some(held) = promotion
            .get("coupon_authorization_id")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty())
        {
            holds.push(pricing_engine::CouponAuthorization {
                code: code.to_string(),
                authorization_id: held.to_string(),
            });
        }
    }
    let price = |codes: &[String], holds: &[pricing_engine::CouponAuthorization]| {
        super::pricing::quote_with_coupon_holds(
            tx,
            site_id,
            super::pricing::STORE_CHANNEL,
            at,
            &sku_codes,
            codes,
            Some(member_id),
            &[],
            holds,
        )
    };
    let quote = match price(&codes, &holds) {
        Ok(quote) => quote,
        // A code the book has dropped since is refused outright; the basket
        // is then priced without the codes rather than not at all.
        Err(EdgeError::Validation(_)) if !codes.is_empty() => price(&[], &[])?,
        Err(error) => return Err(error),
    };
    // No book in force: the till earned nothing on it either.
    let Some(quote) = quote else {
        return Ok((0, Vec::new()));
    };
    if quote.lines.len() != basket.len() {
        return Err(EdgeError::Persistence(
            "the price book answered for a different number of lines than were rung".into(),
        ));
    }
    let lines = basket
        .into_iter()
        .zip(quote.lines.iter())
        .map(|((line, _), quoted)| (line, quoted.points_earned.max(0)))
        .collect();
    Ok((quote.points_earned.max(0), lines))
}

// ════════════════════════════════════════════════════════════════════════════
// Telling head office what the drawer did
// ════════════════════════════════════════════════════════════════════════════

/// The fact the centre reads a shift from.
///
/// The shop authors a shift — it has to, because the counter keeps working when
/// the line to head office does not — and this is how the centre gets a copy.
/// Until it existed the centre could read what a shop SOLD and could not read
/// what a shop HELD, so the two questions a cash retailer lives on had no answer
/// outside the shop that cannot answer them honestly about itself.
///
/// One fact type rather than three. Whole-state rather than a diff: it carries
/// the shift and every movement on it, and the centre upserts. A stream of
/// `shift.opened`, `cash.moved`, `shift.closed` would be three parsers, three
/// ordering assumptions and a shift that is permanently half-applied the day one
/// of them is rejected. This one is idempotent by construction — replaying the
/// last fact for a shift reconstructs it exactly.
pub const FACT_SHIFT_RECORDED: &str = "till.shift.recorded";

/// Build the payload for one shift, as it stands right now.
///
/// `site_id` is passed in rather than read: the shop's identity belongs to the
/// node, not to the till, and a payload that named itself would be a claim
/// rather than an attribution.
pub fn shift_fact(
    connection: &Connection,
    shift_id: &str,
    site_id: &str,
) -> Result<serde_json::Value, EdgeError> {
    let head = connection
        .prepare_cached(
            "SELECT terminal_id,status,opened_by,opened_at,opening_float_minor,
                    closed_by,closed_at,declared_cash_minor,expected_cash_minor,
                    variance_minor,close_note,business_date,taken_over_by,counted_at
               FROM cash_shift WHERE id=?1",
        )
        .map_err(db)?
        .query_row([shift_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<i64>>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<i64>>(9)?,
                row.get::<_, Option<String>>(10)?,
                (
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, Option<String>>(12)?,
                    row.get::<_, Option<String>>(13)?,
                ),
            ))
        })
        .optional()
        .map_err(db)?
        .ok_or_else(|| EdgeError::NotFound(format!("shift {shift_id}")))?;

    // A drop sent without an amount (client, 24 Oct 2026) moved nothing this
    // node can count, and head office refuses a zero movement as no fact —
    // refusing it there stops this node's whole sales lane. It stays here, on
    // its slip, and does not travel.
    let mut statement = connection
        .prepare(
            "SELECT id,kind,amount_minor,reason,actor_id,approved_by,occurred_at
               FROM cash_movement WHERE shift_id=?1 AND amount_minor <> 0
              ORDER BY occurred_at,id",
        )
        .map_err(db)?;
    let movements = statement
        .query_map([shift_id], |row| {
            Ok(serde_json::json!({
                "movement_id": row.get::<_, String>(0)?,
                "kind": row.get::<_, String>(1)?,
                "amount_minor": row.get::<_, i64>(2)?,
                "reason": row.get::<_, String>(3)?,
                "actor_id": row.get::<_, String>(4)?,
                "approved_by": row.get::<_, Option<String>>(5)?,
                "occurred_at": row.get::<_, String>(6)?,
            }))
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;

    let (business_date, taken_over_by, counted_at) = head.11;
    Ok(serde_json::json!({
        "shift_id": shift_id,
        "site_id": site_id,
        "terminal_id": head.0,
        "status": head.1,
        "opened_by": head.2,
        "opened_at": head.3,
        "opening_float_minor": head.4,
        "closed_by": head.5,
        "closed_at": head.6,
        "declared_cash_minor": head.7,
        // What the SHOP worked out. The centre computes the same equation from
        // the sales it has and shows both, so a till on an old build is visible
        // as a disagreement rather than being silently authoritative.
        "expected_cash_minor": head.8,
        "variance_minor": head.9,
        "close_note": head.10,
        // The day the shift trades for, and a shift ended by somebody taking
        // the seat (`0070`): closed, nothing declared until `counted_at`.
        "business_date": business_date,
        "taken_over_by": taken_over_by,
        "counted_at": counted_at,
        "movements": movements,
    }))
}

/// Put the current state of a shift on the outbound queue.
///
/// Called after every write to a shift — open, movement, close — inside the
/// same transaction, so a shift the shop believes it recorded and a fact the
/// centre never received cannot happen. A fresh event id each time, because the
/// centre deduplicates on it and the second and third facts for one shift are
/// new information rather than a resend.
pub fn enqueue_shift_fact(
    tx: &Transaction<'_>,
    shift_id: &str,
    site_id: &str,
) -> Result<(), EdgeError> {
    let payload = shift_fact(tx, shift_id, site_id)?;
    super::sync::enqueue_fact(tx, Uuid::new_v4(), FACT_SHIFT_RECORDED, &payload).map_err(db)?;
    Ok(())
}
