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
//! Functions take a connection and nothing else, like `printing.rs` and
//! `outbound.rs` beside them: it keeps them testable and keeps this out of a
//! file several other workstreams are editing.

use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::contracts::EdgeError;
use super::escpos::{self, DrawerMode, PaperWidth, ReceiptDocument, ReceiptLine, ReceiptTender};

fn db(error: rusqlite::Error) -> EdgeError {
    super::sqlite::db(error)
}

fn now() -> DateTime<Utc> {
    Utc::now()
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
    /// Which till. One terminal, one drawer — two shifts open on the same one
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
    pub amount_minor: i64,
    pub reason: String,
    #[serde(default)]
    pub actor_id: String,
    /// A payout needs a second pair of eyes; a safe drop does not.
    #[serde(default)]
    pub supervisor: Option<Supervisor>,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CloseShiftRequest {
    /// What the cashier counted. Sent BEFORE the expected figure is disclosed;
    /// the response is where the two meet.
    pub declared_cash_minor: i64,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub actor_id: String,
    pub idempotency_key: String,
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
    pub occurred_at: String,
}

/// The Z report — one shift, closed or still running.
///
/// Cash and non-cash are separated because only cash is in the drawer. A till
/// whose report added a card sale to the expected float would report a
/// shortage every single evening.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ShiftReport {
    pub shift_id: String,
    pub terminal_id: String,
    pub status: String,
    pub opened_by: String,
    pub opened_at: String,
    pub closed_by: Option<String>,
    pub closed_at: Option<String>,
    pub opening_float_minor: i64,
    pub sale_count: i64,
    pub sales_total_minor: i64,
    /// Rung and then reversed. Kept out of the totals but reported, because a
    /// shift with forty voids is a fact about the evening even when the money
    /// balances.
    pub voided_count: i64,
    pub voided_total_minor: i64,
    pub cash_sales_minor: i64,
    pub non_cash_minor: i64,
    /// Change handed back. Comes out of the drawer and is not part of any
    /// sale's total, so it has to be subtracted separately or every drawer is
    /// long by exactly the change given.
    pub change_given_minor: i64,
    pub cash_refunds_minor: i64,
    pub non_cash_refunds_minor: i64,
    pub cash_movements_minor: i64,
    pub movements: Vec<CashMovementView>,
    /// Float + cash taken − change − cash refunded + signed movements.
    pub expected_cash_minor: i64,
    pub declared_cash_minor: Option<i64>,
    pub variance_minor: Option<i64>,
    pub tenders: Vec<TenderTotal>,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TenderTotal {
    pub method: String,
    pub count: i64,
    pub amount_minor: i64,
}

const CASH_KINDS: [&str; 5] = ["OPENING_FLOAT", "DROP", "PAYOUT", "PICKUP", "CORRECTION"];

/// Open the drawer for the day.
///
/// The unique index does the refusing rather than a read-then-write: two
/// cashiers pressing "open" at the same second is exactly the race a check in
/// application code loses.
pub fn open_shift(
    tx: &Transaction<'_>,
    request: &OpenShiftRequest,
) -> Result<ShiftReport, EdgeError> {
    let terminal = request.terminal_id.trim();
    if terminal.is_empty() {
        return Err(EdgeError::Validation("terminal_id is required".into()));
    }
    if request.opening_float_minor < 0 {
        return Err(EdgeError::Validation(
            "opening float cannot be negative".into(),
        ));
    }
    if request.actor_id.trim().is_empty() {
        return Err(EdgeError::Validation("actor_id is required".into()));
    }
    if let Some(existing) = open_shift_id(tx, terminal)? {
        return Err(EdgeError::Conflict(format!(
            "terminal {terminal} already has an open shift ({existing})"
        )));
    }

    let shift_id = Uuid::new_v4().to_string();
    let opened_at = now();
    tx.execute(
        "INSERT INTO cash_shift(id,idempotency_key,terminal_id,status,opened_by,opened_at,opening_float_minor)
         VALUES(?1,?2,?3,'OPEN',?4,?5,?6)",
        params![
            shift_id,
            request.idempotency_key,
            terminal,
            request.actor_id.trim(),
            stamp(opened_at),
            request.opening_float_minor
        ],
    )
    .map_err(db)?;

    // The float is a cash movement like any other. Recording it only in the
    // shift row would mean the drawer's arithmetic had two sources, and the
    // one nobody looks at is the one that drifts.
    if request.opening_float_minor > 0 {
        tx.execute(
            "INSERT INTO cash_movement(id,idempotency_key,shift_id,kind,amount_minor,reason,actor_id,occurred_at)
             VALUES(?1,?2,?3,'OPENING_FLOAT',?4,'Modal awal',?5,?6)",
            params![
                Uuid::new_v4().to_string(),
                format!("{}:float", request.idempotency_key),
                shift_id,
                request.opening_float_minor,
                request.actor_id.trim(),
                stamp(opened_at)
            ],
        )
        .map_err(db)?;
    }
    report(tx, &shift_id)
}

/// The open shift on this terminal, if there is one.
pub fn open_shift_id(
    connection: &Connection,
    terminal_id: &str,
) -> Result<Option<String>, EdgeError> {
    connection
        .query_row(
            "SELECT id FROM cash_shift WHERE terminal_id=?1 AND status='OPEN'",
            [terminal_id.trim()],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)
}

/// The open shift on ANY terminal of this node.
///
/// A sale does not say which till took it — the request carries no terminal —
/// so this is how a sale finds its shift. With one till, which is every shop
/// this system runs in today, there is exactly one answer. With two, the
/// oldest open shift wins and the ambiguity is worth naming out loud rather
/// than silently attributing money to the wrong drawer.
pub fn any_open_shift(connection: &Connection) -> Result<Option<String>, EdgeError> {
    connection
        .query_row(
            "SELECT id FROM cash_shift WHERE status='OPEN' ORDER BY opened_at, id LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)
}

pub fn record_cash_movement(
    tx: &Transaction<'_>,
    shift_id: &str,
    request: &CashMovementRequest,
) -> Result<ShiftReport, EdgeError> {
    let kind = request.kind.trim().to_ascii_uppercase();
    if !CASH_KINDS.contains(&kind.as_str()) {
        return Err(EdgeError::Validation(format!(
            "unknown cash movement kind {kind}"
        )));
    }
    if request.amount_minor == 0 {
        return Err(EdgeError::Validation(
            "a cash movement of zero records nothing".into(),
        ));
    }
    if request.reason.trim().is_empty() {
        return Err(EdgeError::Validation(
            "a cash movement needs a reason".into(),
        ));
    }
    require_open(tx, shift_id)?;

    // Money leaving the drawer is the direction somebody steals in. A drop
    // into the safe is money still in the shop; a payout is money gone.
    let approved_by = if matches!(kind.as_str(), "PAYOUT" | "CORRECTION") {
        Some(
            verify_supervisor(tx, request.supervisor.as_ref()).map_err(|error| match error {
                EdgeError::Validation(_) => {
                    EdgeError::Validation(format!("a {kind} needs a supervisor"))
                }
                other => other,
            })?,
        )
    } else {
        None
    };

    tx.execute(
        "INSERT INTO cash_movement(id,idempotency_key,shift_id,kind,amount_minor,reason,actor_id,approved_by,occurred_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            Uuid::new_v4().to_string(),
            request.idempotency_key,
            shift_id,
            kind,
            request.amount_minor,
            request.reason.trim(),
            request.actor_id.trim(),
            approved_by,
            stamp(now())
        ],
    )
    .map_err(db)?;
    report(tx, shift_id)
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
) -> Result<ShiftReport, EdgeError> {
    if request.declared_cash_minor < 0 {
        return Err(EdgeError::Validation(
            "declared cash cannot be negative".into(),
        ));
    }
    if request.actor_id.trim().is_empty() {
        return Err(EdgeError::Validation("actor_id is required".into()));
    }
    require_open(tx, shift_id)?;

    let running = report(tx, shift_id)?;
    let variance = request.declared_cash_minor - running.expected_cash_minor;
    tx.execute(
        "UPDATE cash_shift
            SET status='CLOSED', closed_by=?2, closed_at=?3,
                declared_cash_minor=?4, expected_cash_minor=?5, variance_minor=?6,
                close_note=?7
          WHERE id=?1",
        params![
            shift_id,
            request.actor_id.trim(),
            stamp(now()),
            request.declared_cash_minor,
            running.expected_cash_minor,
            variance,
            request.note.as_deref().map(str::trim)
        ],
    )
    .map_err(db)?;
    report(tx, shift_id)
}

fn require_open(connection: &Connection, shift_id: &str) -> Result<(), EdgeError> {
    let status: Option<String> = connection
        .query_row(
            "SELECT status FROM cash_shift WHERE id=?1",
            [shift_id],
            |row| row.get(0),
        )
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
        .query_row(
            "SELECT terminal_id,status,opened_by,opened_at,closed_by,closed_at,
                    opening_float_minor,declared_cash_minor,variance_minor,close_note
               FROM cash_shift WHERE id=?1",
            [shift_id],
            |row| {
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
                ))
            },
        )
        .optional()
        .map_err(db)?
        .ok_or_else(|| EdgeError::NotFound(format!("shift {shift_id}")))?;

    // Completed sales only. A voided sale was rung and reversed; counting its
    // money would report a drawer that is short by every void of the evening.
    let (sale_count, sales_total_minor, change_given_minor) = connection
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(total_minor),0), COALESCE(SUM(change_minor),0)
               FROM sale WHERE shift_id=?1 AND status='COMPLETED'",
            [shift_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(db)?;

    let (voided_count, voided_total_minor) = connection
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(total_minor),0)
               FROM sale WHERE shift_id=?1 AND status='VOIDED'",
            [shift_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
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
        .query_row(
            "SELECT COALESCE(SUM(CASE WHEN refund_method='CASH' THEN refund_minor ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN refund_method<>'CASH' THEN refund_minor ELSE 0 END),0)
               FROM sale_return WHERE shift_id=?1",
            [shift_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(db)?;

    let mut movements = Vec::new();
    let mut cash_movements_minor = 0_i64;
    {
        let mut statement = connection
            .prepare(
                "SELECT id,kind,amount_minor,reason,actor_id,approved_by,occurred_at
                   FROM cash_movement WHERE shift_id=?1 ORDER BY occurred_at, id",
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
                    occurred_at: row.get(6)?,
                })
            })
            .map_err(db)?;
        for row in rows {
            let movement = row.map_err(db)?;
            // The opening float is already the first movement, so it is NOT
            // added again from the shift row below.
            cash_movements_minor += movement.amount_minor;
            movements.push(movement);
        }
    }

    // Only cash is in the drawer. Change handed back left it, and a cash
    // refund left it; a card refund never touched it.
    let expected_cash_minor =
        cash_movements_minor + cash_sales_minor - change_given_minor - cash_refunds_minor;

    let declared = head.7;
    Ok(ShiftReport {
        shift_id: shift_id.to_string(),
        terminal_id: head.0,
        status: head.1,
        opened_by: head.2,
        opened_at: head.3,
        closed_by: head.4,
        closed_at: head.5,
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
    pub password: String,
}

pub fn verify_supervisor(
    connection: &Connection,
    supervisor: Option<&Supervisor>,
) -> Result<String, EdgeError> {
    let supervisor = supervisor.ok_or_else(|| {
        EdgeError::Validation("this action needs a supervisor's authorisation".into())
    })?;
    let username =
        crate::security::normalize_username(&supervisor.username).map_err(EdgeError::Validation)?;
    let row: Option<(String, String, i64)> = connection
        .query_row(
            "SELECT password_hash,role,active FROM edge_user WHERE username=?1",
            [&username],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(db)?;

    // One message for every failure. "No such supervisor" and "wrong password"
    // told apart is a way to enumerate who can authorise a void.
    let refuse = || EdgeError::Unauthorized("supervisor authorisation refused".into());
    let (password_hash, role, active) = row.ok_or_else(refuse)?;
    if active == 0 || !matches!(role.as_str(), "SUPERVISOR" | "ADMIN") {
        return Err(refuse());
    }
    if !crate::security::password_matches(&password_hash, &supervisor.password) {
        return Err(refuse());
    }
    Ok(username)
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
    pub epc: String,
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
        .query_row("SELECT status FROM sale WHERE id=?1", [sale_id], |row| {
            row.get(0)
        })
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
    occurred_at: DateTime<Utc>,
) -> Result<ReturnResult, EdgeError> {
    let refund_minor: i64 = lines
        .iter()
        .try_fold(0_i64, |total, (line, _)| {
            total.checked_add(line.charged_minor)
        })
        .ok_or_else(|| EdgeError::Validation("refund total overflow".into()))?;

    tx.execute(
        "INSERT INTO sale_return(id,idempotency_key,sale_id,refund_minor,refund_method,
                                 refund_reference,reason,actor_id,approved_by,shift_id,
                                 movement_group_id,occurred_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![
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
        ],
    )
    .map_err(db)?;

    let mut returned = Vec::with_capacity(lines.len());
    for (line, disposition) in lines {
        tx.execute(
            "INSERT INTO sale_return_line(return_id,sale_id,subject_id,epc,sku_code,refund_minor,disposition)
             VALUES(?1,?2,?3,?4,?5,?6,?7)",
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

    let remaining_lines: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM sale_line l
              WHERE l.sale_id=?1
                AND NOT EXISTS(SELECT 1 FROM sale_return_line r
                                WHERE r.sale_id=l.sale_id AND r.subject_id=l.subject_id)",
            [&request.sale_id],
            |row| row.get(0),
        )
        .map_err(db)?;

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
    tx.execute(
        "UPDATE sale SET status='VOIDED', voided_at=?2, voided_by=?3, void_reason=?4,
                         void_approved_by=?5
          WHERE id=?1 AND status='COMPLETED'",
        params![
            sale_id,
            stamp(occurred_at),
            request.actor_id.trim(),
            request.reason.trim(),
            approved_by
        ],
    )
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
        .query_row(
            "SELECT status,total_minor,paid_minor,change_minor,actor_id,completed_at
               FROM sale WHERE id=?1",
            [sale_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
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
                })
            })
            .map_err(db)?;
        for row in rows {
            let line = row.map_err(db)?;
            subtotal_minor += line.base_unit_price_minor.unwrap_or(line.line_total_minor);
            lines.push(line);
        }
    }

    let mut tenders = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT method,amount_minor,reference FROM sale_tender
                  WHERE sale_id=?1 ORDER BY tender_seq",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([sale_id], |row| {
                Ok(ReceiptTender {
                    method: row.get(0)?,
                    amount_minor: row.get(1)?,
                    reference: row.get(2)?,
                })
            })
            .map_err(db)?;
        for row in rows {
            tenders.push(row.map_err(db)?);
        }
    }

    let returned_minor: i64 = connection
        .query_row(
            "SELECT COALESCE(SUM(refund_minor),0) FROM sale_return WHERE sale_id=?1",
            [sale_id],
            |row| row.get(0),
        )
        .map_err(db)?;

    let stamp_text = if head.0 == "VOIDED" {
        Some("** BATAL **".to_string())
    } else if returned_minor > 0 {
        Some("** RETUR **".to_string())
    } else {
        None
    };

    Ok(ReceiptDocument {
        shop_name: shop_name.to_string(),
        shop_line_1: None,
        shop_line_2: None,
        site_id: site_id.to_string(),
        sale_id: sale_id.to_string(),
        receipt_no: receipt_number(site_id, sale_id, &head.5),
        completed_at: head.5.clone(),
        cashier: head.4,
        lines,
        subtotal_minor,
        discount_minor: (subtotal_minor - head.1).max(0),
        total_minor: head.1,
        tenders,
        paid_minor: head.2,
        change_minor: head.3,
        points_earned: 0,
        footer: footer.map(str::to_string),
        stamp: stamp_text,
    })
}

/// The number a customer reads back over the phone.
///
/// A UUID is not something anybody says out loud, so this is the site, the
/// day, and the last six of the sale id — short, unambiguous within a shop's
/// day, and derived rather than allocated, which means no counter to keep and
/// nothing to get out of step after a restore.
fn receipt_number(site_id: &str, sale_id: &str, completed_at: &str) -> String {
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

/// Render and send. Best-effort on the drawer, never on the receipt: a printer
/// that refused is reported, because a customer standing there without a
/// receipt is not a success.
pub fn print_receipt(
    document: &ReceiptDocument,
    request: &PrintReceiptRequest,
) -> Result<usize, EdgeError> {
    let paper = request
        .paper
        .as_deref()
        .map(PaperWidth::parse)
        .unwrap_or(PaperWidth::Narrow);
    let drawer = request
        .drawer
        .as_deref()
        .map(DrawerMode::parse)
        .unwrap_or(DrawerMode::None);
    let mut document = document.clone();
    if request.copy && document.stamp.is_none() {
        document.stamp = Some("** SALINAN **".to_string());
    }
    let bytes = escpos::render(&document, paper, drawer);
    super::printing::send_bytes(&request.printer_host, request.printer_port, &bytes)?;
    Ok(bytes.len())
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
        .query_row(
            "SELECT terminal_id,status,opened_by,opened_at,opening_float_minor,
                    closed_by,closed_at,declared_cash_minor,expected_cash_minor,
                    variance_minor,close_note
               FROM cash_shift WHERE id=?1",
            [shift_id],
            |row| {
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
                ))
            },
        )
        .optional()
        .map_err(db)?
        .ok_or_else(|| EdgeError::NotFound(format!("shift {shift_id}")))?;

    let mut statement = connection
        .prepare(
            "SELECT id,kind,amount_minor,reason,actor_id,approved_by,occurred_at
               FROM cash_movement WHERE shift_id=?1 ORDER BY occurred_at,id",
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
