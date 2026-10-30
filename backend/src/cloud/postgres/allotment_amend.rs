//! MD changes an allotment in place, and cancels it at any stage before it
//! is sent (owner, 9 Oct 2026; docs/research/2026-10-09-outbound-cancel-edit-build.md).
//!
//! Only an allotment the centre runs itself — the cloud-run Gudang,
//! `activation_target_origin_id IS NULL` — is changed here. An edit of one a
//! DC server holds is forwarded to that server and waits for its answer
//! (`allotment_node`); `allotment_work` still refuses it.
//!
//! # The arithmetic
//!
//! A line's **target** is what MD wants the destination to end up with, net:
//! `quantity − Σ(released + owed)` over its REDUCE and CANCEL amendments. An
//! addition is not subtracted back in: it already raised `quantity`. Its
//! **floor** is what is already on a delivery note or beyond — at shipment,
//! loaded, in transit, handed over or received — which nothing here can take
//! back.
//!
//! Bringing a line down by `x` takes from demand nobody packed yet first
//! (`to_pack_qty`, which counts pieces picked and still waiting in the pick
//! area): `released = min(x, to_pack)` is closed short at once, so MD only
//! ever gives up what is in To Pack (allotment-v1 ALT-INV-04). The rest,
//! `owed = x − released`, sits in cartons that have not left; it becomes
//! `takeout_pending_quantity` and the Gudang moves it back (`dc::move_back`),
//! which closes it short as the carton is opened. Picked pieces nobody wants
//! any more are owed to the racks; that is derived (`waiting − to_pack`),
//! never stored, and `pack` cannot take them because `to_pack` refuses.
//!
//! A Close short (`allotment_close_short`) gives pieces up without an
//! amendment, so the target stands above what the store will still get by
//! that much. A later reduction takes those first: they are gone already, so
//! they are recorded as released and nothing more is written to the counters
//! for them. The record keeps `quantity − Σ(released + owed)` equal to the
//! target; the counters only ever move by what physically changes.
//!
//! Raising a line by `y` is a promise made later: `quantity += y`, after the
//! same free-stock check an allotment is raised with, and its own
//! ALLOTMENT_CREATED event beside the first (0939 lets `quantity` rise, never
//! fall).
//!
//! Every change is one `allotment_amendment` row per line (0938) — the
//! history behind "300 → 250" — and the allotment events the rest of the
//! estate already reads: ALLOTMENT_CANCELLED for what is released,
//! ALLOTMENT_CANCELLATION_REQUESTED for what is owed back (no reservation
//! moves yet), ALLOTMENT_CREATED for an addition, each referenced to the
//! amendment.

use super::allotments::{
    active_allotment_tx, insert_allotment_event, line_identity_from_row, lock_open_allotment,
    normal_balance_tx, validate_added_lines_tx, LineIdentity,
};
use super::{begin_idempotent, complete_idempotent, payload_digest};
use crate::cloud::application::AppError;
use crate::cloud::domain::flow::{Actor, FlowRole};
use crate::cloud::domain::{AllotmentStatus, AllotmentType, DestinationType, FulfillmentStatus};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::collections::{BTreeMap, HashMap};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// The wire (frontend-hub/src/lib/operations/changes.ts)
// ---------------------------------------------------------------------------

/// One line MD changes, and what it should be now.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AmendAllotmentLine {
    pub allotment_line_id: Uuid,
    /// The line's new net target, in pieces. Never below what is sent.
    pub to: i64,
}

/// A line the allotment did not have: a store, or a SKU, MD adds in place
/// (owner, 9 Oct 2026: Edit opens the New Allotment grid). It leaves from the
/// same site as the allotment's other lines.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AmendNewLine {
    pub sku_id: Uuid,
    pub destination_id: String,
    /// Pieces, more than none.
    pub quantity: i64,
    /// The pool it is taken from. Absent: the pool the allotment's other
    /// lines of this SKU, or else its first line, take from.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub source_pool_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AmendAllotmentRequest {
    pub idempotency_key: String,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub lines: Vec<AmendAllotmentLine>,
    /// Lines to add (a store or a SKU the allotment did not have).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "Array<AmendNewLine>"))]
    pub add: Vec<AmendNewLine>,
    /// MD's Edit (owner, 18 Oct 2026): every piece goes to a store, as on a
    /// new allotment, so an edit only MOVES pieces between stores — each
    /// SKU's total stays what it was. Nothing is taken from the pool and
    /// nothing is simply given back: a reduction alone is a Cancel. Absent
    /// (a cancel of some stores, an Undo), the totals may change.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean"))]
    pub move_only: bool,
}

/// One line as the change left it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AmendedAllotmentLine {
    pub allotment_line_id: Uuid,
    pub sku_code: String,
    /// The net target before the change.
    pub was: i64,
    /// The net target after it.
    pub now: i64,
    /// Taken from demand not packed yet: gone at once. Pieces a Close short
    /// had already given up are counted here too, so `was − now` is always
    /// `released + owed`.
    pub released: i64,
    /// Taken from pieces already in cartons: the Gudang moves them back.
    pub owed: i64,
    /// The lowest target this line accepts: pieces already sent.
    pub floor: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AmendAllotmentResult {
    pub id: Uuid,
    pub allotment_number: String,
    pub lines: Vec<AmendedAllotmentLine>,
    pub released_total: i64,
    pub owed_total: i64,
    /// The lines added, each `was` 0.
    #[serde(default)]
    pub added: Vec<AmendedAllotmentLine>,
    /// PENDING while the Gudang server that holds the allotment has not
    /// answered the edit Central forwarded ("waiting for the Gudang"); absent
    /// when the edit was made where the allotment is written.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub edge_amendment_status: Option<String>,
    /// The forwarded request, to follow it to its answer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub amendment_request_id: Option<Uuid>,
}

/// Pieces at one stage, and how many stores they are for.
#[derive(Clone, Copy, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AllotmentWorkStage {
    pub stores: i64,
    pub pieces: i64,
}

/// Pieces in cartons that have not left, and how many cartons.
#[derive(Clone, Copy, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AllotmentPackedStage {
    pub stores: i64,
    pub pieces: i64,
    pub koli: i64,
}

/// Where an allotment's pieces stand, by stage: what a cancel would cost.
#[derive(Clone, Copy, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AllotmentWork {
    /// Still to fetch from the racks: closed at once by a cancel.
    pub to_pick: AllotmentWorkStage,
    /// In the pick area and still wanted: a cancel owes them to the racks.
    pub picked: AllotmentWorkStage,
    /// In cartons that have not left: a cancel owes them back.
    pub packed: AllotmentPackedStage,
    /// On a delivery note or beyond: stays sent.
    pub sent: AllotmentWorkStage,
}

// ---------------------------------------------------------------------------
// One line, as a change reads it
// ---------------------------------------------------------------------------

/// What an amendment is, as `allotment_amendment.kind` spells it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AmendmentKind {
    Reduce,
    Add,
    Cancel,
}

impl AmendmentKind {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Reduce => "REDUCE",
            Self::Add => "ADD",
            Self::Cancel => "CANCEL",
        }
    }
}

/// One allotment line, locked, with the figures a change is decided on.
#[derive(Clone, Debug)]
pub(super) struct LineStanding {
    pub(super) id: Uuid,
    pub(super) identity: LineIdentity,
    pub(super) sku_code: String,
    /// What MD wants the destination to end up with now: `quantity`, every
    /// addition included, less what her reductions and cancels took.
    pub(super) target: i64,
    /// On a delivery note or beyond: the lowest `target` may go.
    pub(super) floor: i64,
    /// Not packed yet and still wanted, picked-and-waiting included: the
    /// view's `to_pack_qty` less what is already owed to the racks.
    pub(super) to_pack: i64,
    /// Picked and waiting in the pick area, still wanted by this line.
    pub(super) picked_wanted: i64,
    /// In cartons that have not left, less what MD already took out of them:
    /// what can still be owed back.
    pub(super) in_cartons: i64,
}

impl LineStanding {
    /// The answer to a target under the floor: the pieces are on their way.
    fn below_floor(&self) -> AppError {
        AppError::Conflict(format!(
            "{} to {}: {} pcs already sent, so it cannot go below {}.",
            self.sku_code, self.identity.destination_id, self.floor, self.floor
        ))
    }

    /// What MD's Edit may not move (owner, 18 Oct 2026): everything the
    /// warehouse has worked — sent, packed, picked. An edit only moves what is
    /// still to pick; the rest moves once Ops puts it back to the picklist.
    fn worked(&self) -> i64 {
        let unpicked = (self.to_pack - self.picked_wanted).max(0);
        (self.target - unpicked).max(self.floor).min(self.target)
    }

    /// The answer to an edit under what the warehouse has worked.
    fn below_worked(&self) -> AppError {
        let worked = self.worked();
        AppError::Conflict(format!(
            "{} to {}: {} pcs are already picked, packed or sent, so an edit cannot go below {}. Ask Ops to put them back to the picklist to move them.",
            self.sku_code, self.identity.destination_id, worked, worked
        ))
    }

    fn unchanged(&self) -> AmendedAllotmentLine {
        AmendedAllotmentLine {
            allotment_line_id: self.id,
            sku_code: self.sku_code.clone(),
            was: self.target,
            now: self.target,
            released: 0,
            owed: 0,
            floor: self.floor,
        }
    }
}

/// Every line of an allotment, locked in id order, then read off the
/// commitment view.
///
/// Locked first and read after, in two statements, so the figures are the
/// ones the last writer committed: a join that locks while it reads would
/// recheck the line it locked but not the view rows beside it.
pub(super) async fn lock_lines_tx(
    tx: &mut Transaction<'_, Postgres>,
    allotment_id: Uuid,
) -> Result<Vec<LineStanding>, AppError> {
    sqlx::query("SELECT id FROM allotment_line WHERE allotment_id = $1 ORDER BY id FOR UPDATE")
        .bind(allotment_id)
        .fetch_all(&mut **tx)
        .await?;
    // `sent` is the floor: every place past the carton the view knows. Not
    // `shipment − unshipped`, which still counts what Inventory booked lost
    // on the road — that demand is back in To Pack, and MD may give it up.
    // `taken` is what MD's reductions and cancels took; the target is
    // `quantity` less that (an addition is already in `quantity`).
    let rows = sqlx::query(
        "SELECT line.id, line.source_site_id, line.source_pool_id, line.destination_type,
                line.destination_id, line.sku_id, sku.sku_code, line.quantity,
                line.takeout_pending_quantity, line.pick_owed_quantity, c.to_pack_qty,
                c.at_packed, COALESCE(waiting.quantity, 0)::bigint AS waiting,
                (c.at_shipment + c.at_loaded + c.at_in_transit
                 + c.receiving_gap_qty + c.received)::bigint AS sent,
                COALESCE(amended.taken, 0)::bigint AS taken
           FROM allotment_line line
           JOIN allotment_line_commitment c ON c.allotment_line_id = line.id
           JOIN sku ON sku.id = line.sku_id
           LEFT JOIN (SELECT allotment_line_id, SUM(released + owed)::bigint AS taken
                        FROM allotment_amendment
                       WHERE allotment_id = $1 AND kind IN ('REDUCE', 'CANCEL')
                       GROUP BY allotment_line_id) amended
             ON amended.allotment_line_id = line.id
           LEFT JOIN (SELECT allotment_line_id, SUM(quantity)::bigint AS quantity
                        FROM dc_pick_waiting
                       WHERE allotment_id = $1
                       GROUP BY allotment_line_id) waiting
             ON waiting.allotment_line_id = line.id
          WHERE line.allotment_id = $1
          ORDER BY line.id",
    )
    .bind(allotment_id)
    .fetch_all(&mut **tx)
    .await?;
    rows.iter()
        .map(|row| {
            let quantity: i64 = row.try_get("quantity")?;
            let taken: i64 = row.try_get("taken")?;
            let at_packed: i64 = row.try_get("at_packed")?;
            let takeout_pending: i64 = row.try_get("takeout_pending_quantity")?;
            let pick_owed: i64 = row.try_get("pick_owed_quantity")?;
            // Still wanted: To Pack less the picked pieces already owed back.
            let to_pack = (row.try_get::<i64, _>("to_pack_qty")? - pick_owed).max(0);
            // Of the pieces waiting in the pick area, those the line still
            // wants (never more than it still wants packed).
            let waiting = (row.try_get::<i64, _>("waiting")? - pick_owed).max(0);
            Ok(LineStanding {
                id: row.try_get("id")?,
                identity: line_identity_from_row(row)?,
                sku_code: row.try_get("sku_code")?,
                target: (quantity - taken).max(0),
                floor: row.try_get::<i64, _>("sent")?.max(0),
                to_pack,
                picked_wanted: waiting.min(to_pack),
                in_cartons: (at_packed - takeout_pending).max(0),
            })
        })
        .collect::<Result<Vec<_>, AppError>>()
}

/// Bring one line to `to`, net. Unchanged when it already is.
///
/// A reduction releases To Pack first and owes the rest; an addition raises
/// `quantity` once the source has the stock free. `cancelling` writes the
/// change as a CANCEL and refuses to raise anything. The caller holds the
/// allotment and its lines locked ([`lock_lines_tx`]) and, for an addition,
/// the SKU row, so two promises cannot be made from the same free piece.
#[allow(clippy::too_many_arguments)]
pub(super) async fn apply_target_tx(
    tx: &mut Transaction<'_, Postgres>,
    allotment_id: Uuid,
    line: &LineStanding,
    to: i64,
    cancelling: bool,
    reason: Option<&str>,
    actor_id: &str,
    idempotency_key: &str,
    at: DateTime<Utc>,
) -> Result<AmendedAllotmentLine, AppError> {
    let was = line.target;
    if to == was {
        return Ok(line.unchanged());
    }
    if to < 0 {
        return Err(AppError::Validation("a line cannot go below zero".into()));
    }
    if to < line.floor {
        return Err(line.below_floor());
    }

    let mut supply = None;
    // `released` is what the record says was given up from To Pack;
    // `closed_now` is what this change writes to `closed_short_quantity`.
    // They differ only by pieces a Close short had already given up.
    let (kind, released, closed_now, owed, added, pick_owed) = if to < was {
        let taken = was - to;
        // What the store would still get without this change. Only that much
        // can physically change; a target above it stands on pieces already
        // given up, which this change records and does not write again.
        let coming = line.floor + line.to_pack + line.in_cartons;
        let physical = (coming - to).clamp(0, taken);
        // Only what nobody picked yet is given up at once (owner, 10 Oct
        // 2026: stock returns when the warehouse confirms). Picked pieces stay
        // reserved, owed to the racks (`pick_owed_quantity`, 0965), until the
        // Gudang moves them back; then cartons.
        let unpicked = (line.to_pack - line.picked_wanted).max(0);
        let closed_now = physical.min(unpicked);
        let pick_owed = (physical - closed_now).min(line.picked_wanted);
        // Never more than the cartons hold: `to` is at least the floor, so
        // `physical` is at most `to_pack + in_cartons`.
        let carton_owed = physical - closed_now - pick_owed;
        let owed = pick_owed + carton_owed;
        let kind = if cancelling {
            AmendmentKind::Cancel
        } else {
            AmendmentKind::Reduce
        };
        (kind, taken - owed, closed_now, owed, 0, pick_owed)
    } else {
        if cancelling {
            return Err(AppError::Conflict("a cancel never adds to a line".into()));
        }
        let added = to - was;
        // The check an allotment is raised with: the source pool and its pick
        // areas, against everything still to pack of the SKU there.
        let normal =
            normal_balance_tx(tx, &line.identity.source_pool_id, line.identity.sku_id).await?;
        let allotted =
            active_allotment_tx(tx, &line.identity.source_pool_id, line.identity.sku_id).await?;
        let free = normal - allotted;
        if added > free {
            return Err(AppError::Conflict(format!(
                "{} to {}: only {} pcs free at {}, {added} asked.",
                line.sku_code,
                line.identity.destination_id,
                free.max(0),
                line.identity.source_pool_id
            )));
        }
        supply = Some((normal, allotted, free));
        (AmendmentKind::Add, 0, 0, 0, added, 0)
    };

    let written = sqlx::query(
        "UPDATE allotment_line
            SET quantity = quantity + $3,
                closed_short_quantity = closed_short_quantity + $4,
                takeout_pending_quantity = takeout_pending_quantity + $5,
                pick_owed_quantity = pick_owed_quantity + $7,
                updated_at = $6
          WHERE id = $1 AND allotment_id = $2",
    )
    .bind(line.id)
    .bind(allotment_id)
    .bind(added)
    .bind(closed_now)
    .bind(owed - pick_owed)
    .bind(at)
    .bind(pick_owed)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    if written != 1 {
        return Err(AppError::Conflict(format!(
            "allotment line {} could not be changed",
            line.id
        )));
    }

    let amendment_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO allotment_amendment
             (id, allotment_id, allotment_line_id, kind, target_before, target_after,
              released, owed, reason, actor_id, created_at, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    )
    .bind(amendment_id)
    .bind(allotment_id)
    .bind(line.id)
    .bind(kind.as_str())
    .bind(was)
    .bind(to)
    .bind(released)
    .bind(owed)
    .bind(reason)
    .bind(actor_id)
    .bind(at)
    .bind(idempotency_key)
    .execute(&mut **tx)
    .await?;

    let reference = amendment_id.to_string();
    let details = json!({
        "kind": kind.as_str(),
        "amendment_id": amendment_id,
        "reason": reason,
        "target_before": was,
        "target_after": to,
        "already_given_up": released - closed_now,
    });
    if closed_now > 0 {
        insert_allotment_event(
            tx,
            &format!("amendment:{amendment_id}:released"),
            Some(allotment_id),
            Some(line.id),
            "ALLOTMENT_CANCELLED",
            Some(&line.identity),
            closed_now,
            -closed_now,
            None,
            Some("ALLOTMENT_AMENDMENT"),
            Some(&reference),
            actor_id,
            details.clone(),
            at,
        )
        .await?;
    }
    if owed > 0 {
        // Asked for, not done: the reservation moves when the Gudang opens
        // the carton, so the event carries no delta.
        insert_allotment_event(
            tx,
            &format!("amendment:{amendment_id}:owed"),
            Some(allotment_id),
            Some(line.id),
            "ALLOTMENT_CANCELLATION_REQUESTED",
            Some(&line.identity),
            owed,
            0,
            None,
            Some("ALLOTMENT_AMENDMENT"),
            Some(&reference),
            actor_id,
            details.clone(),
            at,
        )
        .await?;
    }
    if added > 0 {
        let mut details = details;
        if let Some((normal, allotted, free)) = supply {
            details["normal_qty"] = json!(normal);
            details["allotted_qty_before"] = json!(allotted);
            details["on_hand_qty_before"] = json!(free);
            details["on_hand_qty_after"] = json!(free - added);
        }
        insert_allotment_event(
            tx,
            &format!("amendment:{amendment_id}:added"),
            Some(allotment_id),
            Some(line.id),
            "ALLOTMENT_CREATED",
            Some(&line.identity),
            added,
            added,
            None,
            Some("ALLOTMENT_AMENDMENT"),
            Some(&reference),
            actor_id,
            details,
            at,
        )
        .await?;
    }

    Ok(AmendedAllotmentLine {
        now: to,
        released,
        owed,
        ..line.unchanged()
    })
}

/// What the Gudang has to move back on an allotment now: pieces in the pick
/// area beyond what its lines still want (owed to the racks), and pieces MD
/// took out of cartons that have not been opened yet.
pub(super) async fn owed_tx(
    tx: &mut Transaction<'_, Postgres>,
    allotment_id: Uuid,
) -> Result<(i64, i64), AppError> {
    let row = sqlx::query(
        "SELECT
             (SELECT COALESCE(SUM(GREATEST(0, waiting.quantity
                         - GREATEST(c.to_pack_qty - owing.pick_owed_quantity, 0))), 0)::bigint
                FROM (SELECT allotment_line_id, SUM(quantity)::bigint AS quantity
                        FROM dc_pick_waiting
                       WHERE allotment_id = $1
                       GROUP BY allotment_line_id) waiting
                JOIN allotment_line_commitment c ON c.allotment_line_id = waiting.allotment_line_id
                JOIN allotment_line owing ON owing.id = waiting.allotment_line_id)
                 AS owed_picked,
             (SELECT COALESCE(SUM(takeout_pending_quantity), 0)::bigint
                FROM allotment_line WHERE allotment_id = $1) AS owed_packed",
    )
    .bind(allotment_id)
    .fetch_one(&mut **tx)
    .await?;
    Ok((row.try_get("owed_picked")?, row.try_get("owed_packed")?))
}

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

/// MD edits an allotment in place: each named line to its new net target.
///
/// Every line is checked against its floor before anything is written, so a
/// refusal changes nothing. Reductions go first: what they release is free
/// for an addition in the same request (300 from one store to another).
pub async fn amend_allotment(
    pool: &PgPool,
    allotment_id: Uuid,
    request: AmendAllotmentRequest,
    actor: &Actor,
) -> Result<AmendAllotmentResult, AppError> {
    let actor_id = actor.id.trim();
    if actor_id.is_empty() {
        return Err(AppError::Validation("actor is required".into()));
    }
    if request.lines.is_empty() && request.add.is_empty() {
        return Err(AppError::Validation(
            "name at least one line to change".into(),
        ));
    }
    let mut adding = std::collections::BTreeSet::new();
    for line in &request.add {
        if line.quantity <= 0 {
            return Err(AppError::Validation(
                "a line added to an allotment carries at least one piece".into(),
            ));
        }
        let destination = line.destination_id.trim().to_ascii_lowercase();
        if destination.is_empty() {
            return Err(AppError::Validation(
                "a line added to an allotment names its destination".into(),
            ));
        }
        if !adding.insert((line.sku_id, destination)) {
            return Err(AppError::Validation(
                "the same SKU is added for the same destination twice".into(),
            ));
        }
    }
    let mut asked = BTreeMap::new();
    for line in &request.lines {
        if line.to < 0 {
            return Err(AppError::Validation("a line cannot go below zero".into()));
        }
        if asked.insert(line.allotment_line_id, line.to).is_some() {
            return Err(AppError::Validation(format!(
                "allotment line {} is named twice",
                line.allotment_line_id
            )));
        }
    }
    let reason = request
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned);

    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "AMEND_ALLOTMENT",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(serde_json::from_value(response)?);
    }

    let header = lock_open_allotment(&mut tx, allotment_id).await?;
    // The Gudang server holds the pen for this allotment (GUDANG-SERVER-PLAN
    // §0): nothing is written here; the edit is forwarded and waits for the
    // server's answer. While Central hosts the Gudang no allotment has a
    // holder, and everything below runs as it always did.
    if let Some(origin_id) = header.get::<Option<String>, _>("activation_target_origin_id") {
        let result = super::allotment_node::forward_amend_tx(
            &mut tx,
            allotment_id,
            &header,
            &origin_id,
            &request,
            reason.as_deref(),
            actor,
        )
        .await?;
        complete_idempotent(
            &mut tx,
            &request.idempotency_key,
            &serde_json::to_value(&result)?,
        )
        .await?;
        tx.commit().await?;
        return Ok(result);
    }
    // A cancel is the last word on an allotment: one still open only because
    // a carton has to be opened, or a store has to count what was sent, is
    // not edited again (cancelled demand is never revived).
    let cancelled: bool = sqlx::query_scalar(
        "SELECT a.cancelled_at IS NOT NULL
                OR EXISTS (SELECT 1 FROM allotment_amendment m
                            WHERE m.allotment_id = a.id AND m.kind = 'CANCEL')
           FROM allotment a WHERE a.id = $1",
    )
    .bind(allotment_id)
    .fetch_one(&mut *tx)
    .await?;
    if cancelled {
        return Err(AppError::Conflict("This allotment is cancelled.".into()));
    }
    let standing = lock_lines_tx(&mut tx, allotment_id).await?;
    let by_id: HashMap<Uuid, &LineStanding> = standing.iter().map(|line| (line.id, line)).collect();
    let mut add_skus = Vec::new();
    for (line_id, to) in &asked {
        let line = by_id.get(line_id).ok_or_else(|| {
            AppError::NotFound(format!("allotment line {line_id} on this allotment"))
        })?;
        if *to != line.target && *to < line.floor {
            return Err(line.below_floor());
        }
        if request.move_only && *to < line.target && *to < line.worked() {
            return Err(line.below_worked());
        }
        if *to > line.target {
            add_skus.push(line.identity.sku_id);
        }
    }
    if request.move_only {
        check_moves_only(&standing, &asked, &request.add)?;
    }
    // An addition is a new promise: the SKU must still be sold, and its row
    // is held so no other allotment promises the same free piece meanwhile.
    add_skus.sort_unstable();
    add_skus.dedup();
    if !add_skus.is_empty() {
        let locked =
            sqlx::query("SELECT id FROM sku WHERE id = ANY($1) AND active ORDER BY id FOR UPDATE")
                .bind(&add_skus)
                .fetch_all(&mut *tx)
                .await?;
        if locked.len() != add_skus.len() {
            return Err(AppError::Validation(
                "only an active SKU can be allotted more".into(),
            ));
        }
    }

    let now = Utc::now();
    let mut amended: HashMap<Uuid, AmendedAllotmentLine> = HashMap::new();
    for reducing in [true, false] {
        for line in &standing {
            let Some(&to) = asked.get(&line.id) else {
                continue;
            };
            if (to < line.target) != reducing || to == line.target {
                continue;
            }
            let result = apply_target_tx(
                &mut tx,
                allotment_id,
                line,
                to,
                false,
                reason.as_deref(),
                actor_id,
                &request.idempotency_key,
                now,
            )
            .await?;
            amended.insert(line.id, result);
        }
    }

    // Lines the allotment did not have: checked as a new allotment's lines
    // are, each against the stock still free at its source, then written as
    // a new allotment would write them — the line, its ALLOTMENT_CREATED
    // event — with the amendment that says it was added afterwards.
    let added = add_lines_tx(
        &mut tx,
        allotment_id,
        &standing,
        &request.add,
        reason.as_deref(),
        actor,
        &request.idempotency_key,
        now,
    )
    .await?;

    // A change can end the allotment (every line down to what was received),
    // so the header follows the view, as packing's refresh does.
    if !amended.is_empty() || !added.is_empty() {
        let stored: String =
            sqlx::query_scalar("SELECT status FROM allotment_commitment WHERE allotment_id = $1")
                .bind(allotment_id)
                .fetch_one(&mut *tx)
                .await?;
        let status = AllotmentStatus::from(FulfillmentStatus::from_legacy(&stored));
        sqlx::query("UPDATE allotment SET status = $2, updated_at = $3 WHERE id = $1")
            .bind(allotment_id)
            .bind(status.as_str())
            .bind(now)
            .execute(&mut *tx)
            .await?;
    }

    let lines: Vec<AmendedAllotmentLine> = request
        .lines
        .iter()
        .filter_map(|asked_line| {
            amended.remove(&asked_line.allotment_line_id).or_else(|| {
                by_id
                    .get(&asked_line.allotment_line_id)
                    .map(|line| line.unchanged())
            })
        })
        .collect();
    let result = AmendAllotmentResult {
        id: allotment_id,
        allotment_number: header.get("allotment_number"),
        released_total: lines.iter().map(|line| line.released).sum(),
        owed_total: lines.iter().map(|line| line.owed).sum(),
        lines,
        added,
        edge_amendment_status: None,
        amendment_request_id: None,
    };
    complete_idempotent(
        &mut tx,
        &request.idempotency_key,
        &serde_json::to_value(&result)?,
    )
    .await?;
    tx.commit().await?;
    Ok(result)
}

/// An edit that only moves: per SKU, the lines' targets after the change —
/// the ones named at their new `to`, the rest as they stand, the added ones
/// at their quantity — sum to what the SKU's lines held before.
fn check_moves_only(
    standing: &[LineStanding],
    asked: &BTreeMap<Uuid, i64>,
    add: &[AmendNewLine],
) -> Result<(), AppError> {
    let mut totals: BTreeMap<Uuid, (String, i64, i64)> = BTreeMap::new();
    for line in standing {
        let entry = totals
            .entry(line.identity.sku_id)
            .or_insert_with(|| (line.sku_code.clone(), 0, 0));
        entry.1 += line.target;
        entry.2 += asked.get(&line.id).copied().unwrap_or(line.target);
    }
    for line in add {
        let Some(entry) = totals.get_mut(&line.sku_id) else {
            return Err(AppError::Validation(
                "an edit only moves pieces the allotment already holds; a SKU it does not have is a new allotment".into(),
            ));
        };
        entry.2 += line.quantity;
    }
    for (code, was, now) in totals.values() {
        if was != now {
            return Err(AppError::Validation(format!(
                "An edit only moves pieces between stores: {code} would go from {was} to {now} pcs. Place every piece, or cancel what is not wanted."
            )));
        }
    }
    Ok(())
}

/// Add the lines an allotment did not have (see [`AmendNewLine`]).
///
/// Every one leaves from the allotment's own source site; the pool is the one
/// named, else the one its other lines of the SKU take from, else its first
/// line's. A SKU already on the allotment for that destination is not added
/// again: its quantity is changed instead. A destination new to the allotment
/// gets its flow document, as a new allotment's destinations do.
#[allow(clippy::too_many_arguments)]
async fn add_lines_tx(
    tx: &mut Transaction<'_, Postgres>,
    allotment_id: Uuid,
    standing: &[LineStanding],
    asked: &[AmendNewLine],
    reason: Option<&str>,
    actor: &Actor,
    idempotency_key: &str,
    at: DateTime<Utc>,
) -> Result<Vec<AmendedAllotmentLine>, AppError> {
    if asked.is_empty() {
        return Ok(Vec::new());
    }
    let first = standing.first().ok_or_else(|| {
        AppError::Conflict("an allotment with no lines cannot be added to".into())
    })?;
    let stored_type: String = sqlx::query_scalar("SELECT type FROM allotment WHERE id = $1")
        .bind(allotment_id)
        .fetch_one(&mut **tx)
        .await?;
    let allotment_type: AllotmentType = stored_type
        .parse()
        .map_err(|_| AppError::Conflict(format!("allotment type {stored_type} is unknown")))?;
    if allotment_type != AllotmentType::ToSite {
        return Err(AppError::Conflict(
            "only an allotment to stores takes new lines; a return goes where it goes".into(),
        ));
    }

    let mut wanted = Vec::with_capacity(asked.len());
    for line in asked {
        let destination_id = line.destination_id.trim().to_ascii_lowercase();
        let source_pool_id = match line
            .source_pool_id
            .as_deref()
            .map(str::trim)
            .filter(|pool| !pool.is_empty())
        {
            Some(pool) => pool.to_ascii_lowercase(),
            None => standing
                .iter()
                .find(|one| one.identity.sku_id == line.sku_id)
                .unwrap_or(first)
                .identity
                .source_pool_id
                .clone(),
        };
        if standing.iter().any(|one| {
            one.identity.sku_id == line.sku_id
                && one.identity.destination_id == destination_id
                && one.identity.source_pool_id == source_pool_id
        }) {
            return Err(AppError::Validation(format!(
                "{destination_id} already has this SKU on the allotment: change its quantity"
            )));
        }
        wanted.push((
            LineIdentity {
                source_site_id: first.identity.source_site_id.clone(),
                source_pool_id,
                destination_type: DestinationType::Site,
                destination_id,
                sku_id: line.sku_id,
            },
            line.quantity,
        ));
    }
    let wanted = validate_added_lines_tx(tx, allotment_type, wanted).await?;

    // The SKUs are held so no other allotment promises the same free piece
    // meanwhile, and only one still sold may be promised.
    let mut skus: Vec<Uuid> = wanted.iter().map(|(identity, _)| identity.sku_id).collect();
    skus.sort_unstable();
    skus.dedup();
    let codes: HashMap<Uuid, String> = sqlx::query(
        "SELECT id, sku_code FROM sku WHERE id = ANY($1) AND active ORDER BY id FOR UPDATE",
    )
    .bind(&skus)
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .map(|row| Ok((row.try_get("id")?, row.try_get("sku_code")?)))
    .collect::<Result<_, AppError>>()?;
    if codes.len() != skus.len() {
        return Err(AppError::Validation(
            "only an active SKU can be allotted".into(),
        ));
    }

    let known: std::collections::HashSet<&str> = standing
        .iter()
        .map(|one| one.identity.destination_id.as_str())
        .collect();
    let mut flow_lines = Vec::new();
    let mut added = Vec::with_capacity(wanted.len());
    for (identity, quantity) in wanted {
        let sku_code = codes.get(&identity.sku_id).cloned().unwrap_or_default();
        // Read again for every line: an earlier line of this change is
        // already in `active_allotment_tx`.
        let normal = normal_balance_tx(tx, &identity.source_pool_id, identity.sku_id).await?;
        let allotted = active_allotment_tx(tx, &identity.source_pool_id, identity.sku_id).await?;
        let free = normal - allotted;
        if quantity > free {
            return Err(AppError::Conflict(format!(
                "{sku_code} to {}: only {} pcs free at {}, {quantity} asked.",
                identity.destination_id,
                free.max(0),
                identity.source_pool_id
            )));
        }
        let line_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO allotment_line
                 (id, allotment_id, source_site_id, source_pool_id, destination_type,
                  destination_id, sku_id, quantity)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(line_id)
        .bind(allotment_id)
        .bind(&identity.source_site_id)
        .bind(&identity.source_pool_id)
        .bind(identity.destination_type.as_str())
        .bind(&identity.destination_id)
        .bind(identity.sku_id)
        .bind(quantity)
        .execute(&mut **tx)
        .await?;

        let amendment_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO allotment_amendment
                 (id, allotment_id, allotment_line_id, kind, target_before, target_after,
                  released, owed, reason, actor_id, created_at, idempotency_key)
             VALUES ($1, $2, $3, $4, 0, $5, 0, 0, $6, $7, $8, $9)",
        )
        .bind(amendment_id)
        .bind(allotment_id)
        .bind(line_id)
        .bind(AmendmentKind::Add.as_str())
        .bind(quantity)
        .bind(reason)
        .bind(actor.id.trim())
        .bind(at)
        .bind(idempotency_key)
        .execute(&mut **tx)
        .await?;
        insert_allotment_event(
            tx,
            &format!("amendment:{amendment_id}:created"),
            Some(allotment_id),
            Some(line_id),
            "ALLOTMENT_CREATED",
            Some(&identity),
            quantity,
            quantity,
            None,
            Some("ALLOTMENT_AMENDMENT"),
            Some(&amendment_id.to_string()),
            actor.id.trim(),
            json!({
                "kind": AmendmentKind::Add.as_str(),
                "amendment_id": amendment_id,
                "reason": reason,
                "target_before": 0,
                "target_after": quantity,
                "normal_qty": normal,
                "allotted_qty_before": allotted,
                "on_hand_qty_before": free,
                "on_hand_qty_after": free - quantity,
            }),
            at,
        )
        .await?;

        if !known.contains(identity.destination_id.as_str()) {
            flow_lines.push((
                identity.source_site_id.clone(),
                identity.destination_type,
                identity.destination_id.clone(),
                identity.sku_id,
                quantity,
            ));
        }
        added.push(AmendedAllotmentLine {
            allotment_line_id: line_id,
            sku_code,
            was: 0,
            now: quantity,
            released: 0,
            owed: 0,
            floor: 0,
        });
    }
    // A store the allotment did not go to has no flow document yet.
    if !flow_lines.is_empty() {
        super::flows::start_flow_for_allotment_tx(
            tx,
            allotment_id,
            &flow_lines,
            actor,
            FlowRole::HoMd,
            at,
        )
        .await?;
    }
    Ok(added)
}

/// Where an allotment's pieces stand, by stage, counted per allotment: the
/// cost of a cancel, before MD makes it.
///
/// To pick is the picklist's own figure (`dc::picking` OPEN_PICK_LINES);
/// picked is what waits in the pick area and is still wanted; packed is
/// what sits in cartons that have not left, and the cartons; sent is what is
/// on a delivery note or beyond. A store counts at a stage when it has a
/// piece there.
pub async fn allotment_work(pool: &PgPool, allotment_id: Uuid) -> Result<AllotmentWork, AppError> {
    let origin: Option<Option<String>> =
        sqlx::query_scalar("SELECT activation_target_origin_id FROM allotment WHERE id = $1")
            .bind(allotment_id)
            .fetch_optional(pool)
            .await?;
    match origin {
        None => return Err(AppError::NotFound("allotment".into())),
        Some(Some(_)) => {
            return Err(AppError::Conflict(
                "Edge-owned allotment is worked by its DC, not here".into(),
            ))
        }
        Some(None) => {}
    }
    let row = sqlx::query(
        "WITH stage AS (
             SELECT line.destination_id,
                    GREATEST(0, LEAST(line.quantity - line.picked_quantity - line.cancelled_quantity,
                                      c.to_pack_qty - COALESCE(waiting.quantity, 0)))::bigint AS to_pick,
                    LEAST(COALESCE(waiting.quantity, 0),
                          GREATEST(c.to_pack_qty - line.pick_owed_quantity, 0))::bigint AS picked,
                    GREATEST(c.at_packed, 0)::bigint AS packed,
                    (c.at_shipment + c.at_loaded + c.at_in_transit
                     + c.receiving_gap_qty + c.received)::bigint AS sent
               FROM allotment_line line
               JOIN allotment_line_commitment c ON c.allotment_line_id = line.id
               LEFT JOIN (SELECT allotment_line_id, SUM(quantity)::bigint AS quantity
                            FROM dc_pick_waiting
                           WHERE allotment_id = $1
                           GROUP BY allotment_line_id) waiting
                 ON waiting.allotment_line_id = line.id
              WHERE line.allotment_id = $1
         )
         SELECT COALESCE(SUM(to_pick), 0)::bigint AS to_pick_pieces,
                COUNT(DISTINCT destination_id) FILTER (WHERE to_pick > 0) AS to_pick_stores,
                COALESCE(SUM(picked), 0)::bigint AS picked_pieces,
                COUNT(DISTINCT destination_id) FILTER (WHERE picked > 0) AS picked_stores,
                COALESCE(SUM(packed), 0)::bigint AS packed_pieces,
                COUNT(DISTINCT destination_id) FILTER (WHERE packed > 0) AS packed_stores,
                COALESCE(SUM(sent), 0)::bigint AS sent_pieces,
                COUNT(DISTINCT destination_id) FILTER (WHERE sent > 0) AS sent_stores,
                (SELECT COUNT(*)
                   FROM dc_koli koli
                  WHERE koli.shipment_id IS NULL
                    AND koli.voided_at IS NULL
                    AND EXISTS (SELECT 1 FROM dc_koli_unit unit
                                 WHERE unit.koli_id = koli.koli_id
                                   AND unit.allotment_id = $1)) AS packed_koli
           FROM stage",
    )
    .bind(allotment_id)
    .fetch_one(pool)
    .await?;
    let stage = |stores: &str, pieces: &str| -> Result<AllotmentWorkStage, AppError> {
        Ok(AllotmentWorkStage {
            stores: row.try_get(stores)?,
            pieces: row.try_get(pieces)?,
        })
    };
    Ok(AllotmentWork {
        to_pick: stage("to_pick_stores", "to_pick_pieces")?,
        picked: stage("picked_stores", "picked_pieces")?,
        packed: AllotmentPackedStage {
            stores: row.try_get("packed_stores")?,
            pieces: row.try_get("packed_pieces")?,
            koli: row.try_get("packed_koli")?,
        },
        sent: stage("sent_stores", "sent_pieces")?,
    })
}
