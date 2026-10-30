//! The work MD left the Gudang to undo (owner, 9 Oct 2026;
//! docs/research/2026-10-09-outbound-cancel-edit-build.md §1, §4): one card
//! per allotment × shop with pieces still to move back.
//!
//! Nothing here is stored. Per allotment line:
//!
//! - **owed picked** — pieces waiting in the pick area beyond what the line
//!   still wants: `max(0, waiting − max(to_pack − pick_owed, 0))`. A pack
//!   cannot take them (its check is the hard stop); they go to the racks, and
//!   until they do they stay reserved (`pick_owed_quantity`, 0965).
//! - **owed packed** — pieces MD took out that are still in an unsent carton:
//!   `takeout_pending_quantity`, and for an allotment MD cancelled every
//!   piece of a line with nothing left to pack. Assigned to the cartons
//!   holding the line's pieces, newest carton first.
//!
//! The board polls this every 30 s, so every read starts from what is in the
//! building now — the pick area's own stock, the cartons on no trip — and
//! never from history.

use super::common;
use crate::cloud::{AppError, AppState};
use crate::pool_role::PoolRole;
use axum::{extract::State, routing::get, Json, Router};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::Row;
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router.route("/api/v1/dc/owed", get(owed))
}

// ---------------------------------------------------------------------------
// The wire (frontend-hub/src/lib/operations/changes.ts)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OwedKoli {
    pub koli_id: Uuid,
    pub koli_number: String,
    pub quantity: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OwedLine {
    pub allotment_line_id: Uuid,
    pub sku_code: String,
    pub article_name: String,
    /// Pieces in the pick area MD no longer wants.
    pub owed_picked: i64,
    /// Pieces in unsent cartons MD no longer wants.
    pub owed_packed: i64,
    /// Where the packed ones are.
    pub koli: Vec<OwedKoli>,
}

/// CANCELLED when MD cancelled the allotment (the big stamp), EDITED when MD
/// reduced it (the red strip).
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum OwedKind {
    Cancelled,
    Edited,
}

/// One allotment × shop with pieces still to move back.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OwedWork {
    pub allotment_id: Uuid,
    pub allotment_number: String,
    pub destination_id: String,
    pub kind: OwedKind,
    pub reason: Option<String>,
    pub by: String,
    pub at: DateTime<Utc>,
    /// What this shop was allotted before MD's change, in pieces.
    pub was: i64,
    /// What MD wants it to be now, net.
    pub now: i64,
    pub owed_picked: i64,
    pub owed_packed: i64,
    pub lines: Vec<OwedLine>,
}

async fn owed(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let items = owed_work(&state).await?;
    Ok(Json(json!({ "items": items })))
}

// ---------------------------------------------------------------------------
// Reading it
// ---------------------------------------------------------------------------

/// The Gudang's cartons still in the building (on no surat jalan, not
/// emptied), per allotment line, newest carton first.
const UNSENT_CARTONS: &str = "
    SELECT unit.allotment_line_id, koli.koli_id, koli.koli_number,
           COUNT(*)::bigint AS quantity
      FROM dc_koli koli
      JOIN dc_koli_unit unit ON unit.koli_id = koli.koli_id
     WHERE koli.site_id = $1 AND koli.shipment_id IS NULL AND koli.voided_at IS NULL
     GROUP BY unit.allotment_line_id, koli.koli_id, koli.koli_number, koli.created_at
     ORDER BY unit.allotment_line_id, koli.created_at DESC, koli.koli_number DESC";

/// What waits in the pick area per allotment line: `dc_pick_waiting` (0907),
/// started from what stands in the pick area now (`$1`) rather than from
/// every pick ever made.
const PICK_AREA_WAITING: &str = "
    WITH here AS (
        SELECT subject_id, place_id, quantity
          FROM inventory_projection
         WHERE place_id = $1
    ), ranked AS (
        SELECT piece.allotment_line_id, piece.quantity, here.quantity AS on_hand,
               COALESCE(SUM(piece.quantity) OVER (
                   PARTITION BY piece.subject_id, piece.place_id
                   ORDER BY piece.seq DESC
                   ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ), 0)::bigint AS newer
          FROM here
          JOIN dc_pick_piece piece
            ON piece.subject_id = here.subject_id AND piece.place_id = here.place_id
    )
    SELECT allotment_line_id, SUM(LEAST(quantity, on_hand - newer))::bigint AS quantity
      FROM ranked
     WHERE on_hand - newer > 0
     GROUP BY allotment_line_id";

/// A cancel by its header (0024's cancel, a refused allotment) or by the
/// time MD cancelled it.
const HEADER_CANCELLED: &str =
    "(header.status IN ('CANCELLED', 'REJECTED') OR header.cancelled_at IS NOT NULL)";

struct Carton {
    koli_id: Uuid,
    koli_number: String,
    quantity: i64,
}

pub async fn owed_work(state: &AppState) -> Result<Vec<OwedWork>, AppError> {
    let site = common::gudang_site(&state.db).await?;
    let mut connection = state.db.acquire().await?;

    let mut cartons: BTreeMap<Uuid, Vec<Carton>> = BTreeMap::new();
    for row in sqlx::query(UNSENT_CARTONS)
        .bind(&site)
        .fetch_all(&mut *connection)
        .await?
    {
        cartons
            .entry(row.try_get("allotment_line_id")?)
            .or_default()
            .push(Carton {
                koli_id: row.try_get("koli_id")?,
                koli_number: row.try_get("koli_number")?,
                quantity: row.try_get("quantity")?,
            });
    }
    // A Gudang with no pick area has nothing waiting in one.
    let picking =
        crate::cloud::postgres::sites::pool_of_role(&mut *connection, &site, PoolRole::Picking)
            .await?;
    let mut waiting: BTreeMap<Uuid, i64> = BTreeMap::new();
    if let Some(pool) = picking {
        for row in sqlx::query(PICK_AREA_WAITING)
            .bind(format!("{pool}:on_hand"))
            .fetch_all(&mut *connection)
            .await?
        {
            waiting.insert(row.try_get("allotment_line_id")?, row.try_get("quantity")?);
        }
    }

    let candidates: Vec<Uuid> = cartons
        .keys()
        .chain(waiting.keys())
        .copied()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query(&format!(
        "SELECT line.id AS allotment_line_id, line.allotment_id, header.allotment_number,
                line.destination_id, upper(sku.sku_code) AS sku_code,
                article.name AS article_name, commitment.to_pack_qty,
                line.takeout_pending_quantity, line.pick_owed_quantity,
                {HEADER_CANCELLED} AS cancelled,
                header.created_by, header.cancelled_at, header.updated_at
           FROM allotment_line line
           JOIN allotment header ON header.id = line.allotment_id
           JOIN allotment_line_commitment commitment
             ON commitment.allotment_line_id = line.id
           JOIN sku ON sku.id = line.sku_id
           JOIN article ON article.id = sku.article_id
          WHERE line.id = ANY($1)
            AND line.destination_type = 'STORE'
            AND header.activation_target_origin_id IS NULL
          ORDER BY header.created_at, line.allotment_id, line.destination_id, sku.sku_code"
    ))
    .bind(&candidates)
    .fetch_all(&mut *connection)
    .await?;

    let mut cards: Vec<OwedWork> = Vec::new();
    let mut card_of: BTreeMap<(Uuid, String), usize> = BTreeMap::new();
    for row in &rows {
        let line_id: Uuid = row.try_get("allotment_line_id")?;
        // Still wanted: To Pack less the picked pieces MD gave up, which stay
        // reserved until moved back (0965).
        let to_pack: i64 =
            row.try_get::<i64, _>("to_pack_qty")? - row.try_get::<i64, _>("pick_owed_quantity")?;
        let pending: i64 = row.try_get("takeout_pending_quantity")?;
        let cancelled: bool = row.try_get("cancelled")?;
        let held = cartons.get(&line_id).map(Vec::as_slice).unwrap_or(&[]);
        let boxed: i64 = held.iter().map(|carton| carton.quantity).sum();

        let owed_picked = (waiting.get(&line_id).copied().unwrap_or(0) - to_pack.max(0)).max(0);
        // A cancelled line with nothing left to pack wants none of its
        // cartons' pieces, whether or not a take-out was written for them.
        // Never more than the cartons hold: a loss in a packed carton can
        // leave a take-out larger than what is still in one.
        let cancelled_boxed = if cancelled && to_pack <= 0 { boxed } else { 0 };
        let owed_packed = pending.max(cancelled_boxed).clamp(0, boxed);
        if owed_picked + owed_packed == 0 {
            continue;
        }
        let mut left = owed_packed;
        let mut koli = Vec::new();
        for carton in held {
            if left == 0 {
                break;
            }
            let take = carton.quantity.min(left);
            koli.push(OwedKoli {
                koli_id: carton.koli_id,
                koli_number: carton.koli_number.clone(),
                quantity: take,
            });
            left -= take;
        }

        let allotment_id: Uuid = row.try_get("allotment_id")?;
        let destination_id: String = row.try_get("destination_id")?;
        let index = match card_of.get(&(allotment_id, destination_id.clone())) {
            Some(&index) => index,
            None => {
                // Until MD's own record says otherwise (below): the header.
                let cancelled_at: Option<DateTime<Utc>> = row.try_get("cancelled_at")?;
                let updated_at: DateTime<Utc> = row.try_get("updated_at")?;
                cards.push(OwedWork {
                    allotment_id,
                    allotment_number: row.try_get("allotment_number")?,
                    destination_id: destination_id.clone(),
                    kind: if cancelled {
                        OwedKind::Cancelled
                    } else {
                        OwedKind::Edited
                    },
                    reason: None,
                    by: row
                        .try_get::<Option<String>, _>("created_by")?
                        .unwrap_or_default(),
                    at: cancelled_at.unwrap_or(updated_at),
                    was: 0,
                    now: 0,
                    owed_picked: 0,
                    owed_packed: 0,
                    lines: Vec::new(),
                });
                card_of.insert((allotment_id, destination_id), cards.len() - 1);
                cards.len() - 1
            }
        };
        let card = &mut cards[index];
        card.owed_picked += owed_picked;
        card.owed_packed += owed_packed;
        card.lines.push(OwedLine {
            allotment_line_id: line_id,
            sku_code: row.try_get("sku_code")?,
            article_name: row.try_get("article_name")?,
            owed_picked,
            owed_packed,
            koli,
        });
    }
    if cards.is_empty() {
        return Ok(Vec::new());
    }

    let allotment_ids: Vec<Uuid> = cards
        .iter()
        .map(|card| card.allotment_id)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    // Who changed what, and why: MD's latest act on the allotment.
    let mut amended: BTreeSet<Uuid> = BTreeSet::new();
    for row in sqlx::query(
        "SELECT DISTINCT ON (allotment_id) allotment_id, kind, reason, actor_id, created_at
           FROM allotment_amendment
          WHERE allotment_id = ANY($1)
          ORDER BY allotment_id, created_at DESC, id DESC",
    )
    .bind(&allotment_ids)
    .fetch_all(&mut *connection)
    .await?
    {
        let allotment_id: Uuid = row.try_get("allotment_id")?;
        let kind: String = row.try_get("kind")?;
        let reason: Option<String> = row.try_get("reason")?;
        let by: String = row.try_get("actor_id")?;
        let at: DateTime<Utc> = row.try_get("created_at")?;
        for card in cards
            .iter_mut()
            .filter(|card| card.allotment_id == allotment_id)
        {
            card.kind = if kind == "CANCEL" {
                OwedKind::Cancelled
            } else {
                OwedKind::Edited
            };
            card.reason = reason.clone();
            card.by = by.clone();
            card.at = at;
        }
        amended.insert(allotment_id);
    }
    // Owed without an amendment — an allotment cancelled or closed short
    // before MD could edit in place: its latest cancel event says who.
    let unamended: Vec<Uuid> = allotment_ids
        .iter()
        .filter(|id| !amended.contains(id))
        .copied()
        .collect();
    if !unamended.is_empty() {
        for row in sqlx::query(
            "SELECT DISTINCT ON (allotment_id) allotment_id, actor_id, occurred_at,
                    details->>'reason' AS reason
               FROM allotment_event
              WHERE allotment_id = ANY($1) AND event_type = 'ALLOTMENT_CANCELLED'
              ORDER BY allotment_id, occurred_at DESC",
        )
        .bind(&unamended)
        .fetch_all(&mut *connection)
        .await?
        {
            let allotment_id: Uuid = row.try_get("allotment_id")?;
            let reason: Option<String> = row.try_get("reason")?;
            let by: String = row.try_get("actor_id")?;
            let at: DateTime<Utc> = row.try_get("occurred_at")?;
            for card in cards
                .iter_mut()
                .filter(|card| card.allotment_id == allotment_id)
            {
                card.reason = reason.clone();
                card.by = by.clone();
                card.at = at;
            }
        }
    }

    // Was and now, over every line of the shop: what was allotted (an ADD
    // already raised `quantity`, 0939), and that less what MD reduced or
    // cancelled — released at once, or owed back. ADD rows are not added
    // again.
    let mut totals: BTreeMap<(Uuid, String), (i64, i64)> = BTreeMap::new();
    for row in sqlx::query(
        "SELECT line.allotment_id, line.destination_id,
                SUM(line.quantity)::bigint AS was,
                SUM(GREATEST(line.quantity - COALESCE(taken.quantity, 0), 0))::bigint AS now
           FROM allotment_line line
           LEFT JOIN (SELECT allotment_line_id, SUM(released + owed)::bigint AS quantity
                        FROM allotment_amendment
                       WHERE allotment_id = ANY($1) AND kind IN ('REDUCE', 'CANCEL')
                       GROUP BY allotment_line_id) taken
             ON taken.allotment_line_id = line.id
          WHERE line.allotment_id = ANY($1)
          GROUP BY line.allotment_id, line.destination_id",
    )
    .bind(&allotment_ids)
    .fetch_all(&mut *connection)
    .await?
    {
        totals.insert(
            (row.try_get("allotment_id")?, row.try_get("destination_id")?),
            (row.try_get("was")?, row.try_get("now")?),
        );
    }

    let mut items = cards;
    for work in &mut items {
        if let Some(&(was, now)) = totals.get(&(work.allotment_id, work.destination_id.clone())) {
            work.was = was;
            work.now = now;
        }
    }
    // The oldest change first: it has waited longest.
    items.sort_by(|left, right| {
        left.at
            .cmp(&right.at)
            .then_with(|| left.allotment_number.cmp(&right.allotment_number))
            .then_with(|| left.destination_id.cmp(&right.destination_id))
    });
    Ok(items)
}
