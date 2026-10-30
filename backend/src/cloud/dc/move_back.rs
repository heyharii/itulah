//! The Gudang takes its own work back (owner, 9 Oct 2026;
//! docs/research/2026-10-09-outbound-cancel-edit-build.md §0 rule 5, §1).
//!
//! Three moves, and never from a carton already on a trip:
//!
//! - **Packed → Picked**: pieces leave an unsent carton for the pick area.
//!   The allotment line counts them as unpacked — `unpacked_quantity`, the
//!   ledger's own reversal of `packed_quantity`, which is never lowered
//!   (allotment-v1 §3–4) — their `dc_koli_unit` rows go, their mirror rows in
//!   `edge_koli_unit` are released, and a carton left empty is voided. Pieces
//!   MD had already taken out of the carton (`takeout_pending_quantity`) are
//!   now given up for good: `closed_short_quantity` takes them in the same
//!   transaction, and they wait in the pick area as owed to the racks.
//! - **Picked → To pick**: pieces in the pick area go back to the room their
//!   line was served from, and the line's legacy `picked_quantity` falls, so
//!   the picklist asks for whatever the line still wants.
//! - **Packed → To pick**: both, in one transaction.
//!
//! Pieces MD took out go first and are not asked for again (`settled`); the
//! rest go back on the picklist (`to_pick_again`). The flows are not rewound
//! (spec §5): a flow keeps the Pack stage it reached.
//!
//! Under the same per-Gudang lock as a pack or a trip, so a carton is never
//! opened while it is being loaded; a retry with the same key answers with
//! the first attempt's result (`dc_move_back`, 0940).
//!
//! It writes allotment lines, cartons, their mirror and the ledger — never
//! the allotment header, and it never locks one: MD's edit and cancel lock
//! the header and then the lines, and a header MD cancelled is final (0005).
//! The lines are taken in id order, as MD's edit and a pack take them. What
//! an allotment's status is follows from the commitment view
//! (`allotment_commitment.status`), which reads these lines.

use super::common;
use super::packing::{lock_outbound, move_pieces, place_of_role, Piece};
use crate::cloud::domain::{
    MovementCause, MovementCommand, MovementGroupId, MovementLine, Place, SubjectId,
};
use crate::cloud::http::auth::Principal;
use crate::cloud::{AppError, AppState};
use crate::pool_role::PoolRole;
use axum::{
    extract::State,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, Row, Transaction};
use std::collections::BTreeMap;
use uuid::Uuid;

type Tx<'a> = Transaction<'a, Postgres>;

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/dc/move-back", post(move_back))
        .route("/api/v1/dc/move-backs", get(list_to_pick))
}

/// One move back to the picklist, as the board marks the card it put back
/// ("Back from Pack" / "Back from Dispatch", owner 18 Oct 2026).
#[derive(Clone, Debug, Serialize)]
pub struct MoveBackToPick {
    pub move_back_id: Uuid,
    pub destination_id: String,
    pub allotment_id: Option<Uuid>,
    /// `picked` (from Pack) or `packed` (from Dispatch).
    pub from_stage: String,
    pub moved: i64,
    pub actor_id: String,
    pub created_at: DateTime<Utc>,
    pub sku_codes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoveBackToPickList {
    pub items: Vec<MoveBackToPick>,
}

/// The moves back to the picklist of the last two days, newest first.
async fn list_to_pick(State(state): State<AppState>) -> Result<Json<MoveBackToPickList>, AppError> {
    common::require_hosted()?;
    let since = state.clock.now() - chrono::Duration::days(2);
    let rows = sqlx::query(
        "SELECT move_back_id, destination_id, allotment_id, from_stage, moved, actor_id,
                created_at, request
           FROM dc_move_back
          WHERE to_stage = 'pick' AND created_at >= $1
          ORDER BY created_at DESC
          LIMIT 500",
    )
    .bind(since)
    .fetch_all(&state.db)
    .await?;
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let request: String = row.try_get("request")?;
        let sku_codes = serde_json::from_str::<MoveBackRequest>(&request)
            .map(|one| one.lines.into_iter().map(|line| line.sku_code).collect())
            .unwrap_or_default();
        items.push(MoveBackToPick {
            move_back_id: row.try_get("move_back_id")?,
            destination_id: row.try_get("destination_id")?,
            allotment_id: row.try_get("allotment_id")?,
            from_stage: row.try_get("from_stage")?,
            moved: row.try_get("moved")?,
            actor_id: row.try_get("actor_id")?,
            created_at: row.try_get("created_at")?,
            sku_codes,
        });
    }
    Ok(Json(MoveBackToPickList { items }))
}

// ---------------------------------------------------------------------------
// The wire (frontend-hub/src/lib/operations/changes.ts)
// ---------------------------------------------------------------------------

/// Where the pieces are now.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum MoveBackFrom {
    Picked,
    Packed,
}

impl MoveBackFrom {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Picked => "picked",
            Self::Packed => "packed",
        }
    }
}

/// Where they go: the pick area (`picked`) or the racks (`pick`).
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum MoveBackTo {
    Picked,
    Pick,
}

impl MoveBackTo {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Picked => "picked",
            Self::Pick => "pick",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MoveBackLine {
    pub sku_code: String,
    pub quantity: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MoveBackRequest {
    pub idempotency_key: String,
    /// The shop the pieces were for.
    pub destination_id: String,
    /// Only this allotment's pieces; any of the shop's when absent.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub allotment_id: Option<String>,
    pub from: MoveBackFrom,
    pub to: MoveBackTo,
    /// The carton they leave; required when `from` is `packed`.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub koli_id: Option<String>,
    pub lines: Vec<MoveBackLine>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub reason: Option<String>,
}

/// A carton the move back opened, as it is left.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MoveBackKoli {
    pub koli_id: Uuid,
    pub koli_number: String,
    pub units_left: i64,
    /// Its label counts pieces it no longer holds: print it again.
    pub label_reprint: bool,
    /// Nothing left in it: the carton is gone (voided).
    pub emptied: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MoveBackResult {
    pub moved: i64,
    /// How many of them MD had already taken out (not asked for again).
    pub settled: i64,
    /// How many go back on the picklist to be picked again. Nothing does
    /// when the pieces only went back to the pick area: they wait there to
    /// be packed again.
    pub to_pick_again: i64,
    pub kolis: Vec<MoveBackKoli>,
}

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

async fn move_back(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<MoveBackRequest>,
) -> Result<Json<MoveBackResult>, AppError> {
    common::require_hosted()?;
    Ok(Json(run(&state, &principal.username, request).await?))
}

/// What one move back works with, beside the transaction.
struct Ctx<'a> {
    site: &'a str,
    /// The shop, as head office names it (what allotment lines carry).
    destination: &'a str,
    /// The pick area's place (`<picking pool>:on_hand`).
    picking: &'a str,
    allotment_id: Option<Uuid>,
    move_back_id: Uuid,
    actor: &'a str,
    at: DateTime<Utc>,
}

pub(super) async fn run(
    state: &AppState,
    actor: &str,
    mut request: MoveBackRequest,
) -> Result<MoveBackResult, AppError> {
    let actor = actor.trim().to_owned();
    if actor.is_empty() {
        return Err(AppError::Validation("actor is required".into()));
    }
    let (allotment_id, koli_id) = normalise(&mut request)?;

    let mut tx = state.db.begin().await?;
    let site = common::gudang_site_tx(&mut tx).await?;
    lock_outbound(&mut tx, &site).await?;
    let destination =
        crate::cloud::postgres::canonical_site_id_tx(&mut tx, &request.destination_id).await?;
    request.destination_id = destination.clone();
    let request_json = serde_json::to_string(&request)?;

    // A retry answers with what the first attempt did: a second attempt
    // would find the carton already opened and open it further.
    if let Some(row) =
        sqlx::query("SELECT request, result FROM dc_move_back WHERE idempotency_key = $1")
            .bind(&request.idempotency_key)
            .fetch_optional(&mut *tx)
            .await?
    {
        if row.try_get::<String, _>("request")? != request_json {
            return Err(AppError::Conflict(
                "idempotency key was already used with a different request payload".into(),
            ));
        }
        let result: MoveBackResult = serde_json::from_value(row.try_get("result")?)?;
        tx.commit().await?;
        return Ok(result);
    }

    let shop_exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM site WHERE id = $1)")
        .bind(&destination)
        .fetch_one(&mut *tx)
        .await?;
    if !shop_exists {
        return Err(AppError::NotFound(format!("shop {destination}")));
    }
    if let Some(allotment_id) = allotment_id {
        let owner: Option<Option<String>> =
            sqlx::query_scalar("SELECT activation_target_origin_id FROM allotment WHERE id = $1")
                .bind(allotment_id)
                .fetch_optional(&mut *tx)
                .await?;
        match owner {
            None => return Err(AppError::NotFound(format!("allotment {allotment_id}"))),
            Some(Some(_)) => {
                return Err(AppError::Conflict(
                    "Edge-owned allotment: the DC server that runs it moves its pieces back".into(),
                ))
            }
            Some(None) => {}
        }
    }

    let picking = place_of_role(&mut tx, &site, PoolRole::Picking).await?;
    let ctx = Ctx {
        site: &site,
        destination: &destination,
        picking: &picking,
        allotment_id,
        move_back_id: Uuid::new_v4(),
        actor: &actor,
        at: state.clock.now(),
    };

    let mut kolis = Vec::new();
    let (moved, settled, to_pick_again) = match (request.from, koli_id) {
        (MoveBackFrom::Packed, Some(koli_id)) => {
            let unpacked = unpack(&mut tx, &ctx, koli_id, &request.lines).await?;
            let moved = i64::try_from(unpacked.pieces.len()).unwrap_or(i64::MAX);
            kolis.push(unpacked.koli);
            match request.to {
                // They wait in the pick area to be packed again; the ones MD
                // took out wait there as owed to the racks.
                MoveBackTo::Picked => (moved, unpacked.settled, 0),
                MoveBackTo::Pick => {
                    let mut by_line: BTreeMap<Uuid, BTreeMap<Uuid, i64>> = BTreeMap::new();
                    for piece in &unpacked.pieces {
                        by_line
                            .entry(piece.allotment_line_id)
                            .or_default()
                            .insert(piece.subject_id, 1);
                    }
                    let settled = put_away(&mut tx, &ctx, &by_line).await?;
                    (moved, settled, moved - settled)
                }
            }
        }
        (MoveBackFrom::Picked, None) => {
            let chosen = choose_waiting(&mut tx, &ctx, &request.lines).await?;
            let moved: i64 = chosen.values().flat_map(BTreeMap::values).sum();
            let settled = put_away(&mut tx, &ctx, &chosen).await?;
            (moved, settled, moved - settled)
        }
        // `normalise` refused both already.
        (MoveBackFrom::Packed, None) | (MoveBackFrom::Picked, Some(_)) => {
            return Err(AppError::Validation(
                "a move back from Packed names its carton, and only then".into(),
            ))
        }
    };

    let result = MoveBackResult {
        moved,
        settled,
        to_pick_again,
        kolis,
    };
    sqlx::query(
        "INSERT INTO dc_move_back
             (move_back_id, site_id, destination_id, koli_id, from_stage, to_stage, moved,
              settled, reason, actor_id, created_at, idempotency_key, request, result,
              allotment_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
    )
    .bind(ctx.move_back_id)
    .bind(&site)
    .bind(&destination)
    .bind(koli_id)
    .bind(request.from.as_str())
    .bind(request.to.as_str())
    .bind(moved)
    .bind(settled)
    .bind(&request.reason)
    .bind(&actor)
    .bind(ctx.at)
    .bind(&request.idempotency_key)
    .bind(&request_json)
    .bind(serde_json::to_value(&result)?)
    .bind(ctx.allotment_id)
    .execute(&mut *tx)
    .await?;
    // The header follows the lines again (owner, 10 Oct 2026): an allotment
    // MD cancelled closes — and lands in Cancelled — once its last owed piece
    // is moved back, not only when a pack or a trip next touches it. The
    // allotment named, or every open one with lines to this shop.
    let touched: Vec<Uuid> = match ctx.allotment_id {
        Some(id) => vec![id],
        None => {
            sqlx::query_scalar(
                "SELECT DISTINCT allotment.id FROM allotment
                   JOIN allotment_line line ON line.allotment_id = allotment.id
                  WHERE line.destination_id = $1
                    AND allotment.activation_target_origin_id IS NULL
                    AND allotment.status = 'ACTIVE'",
            )
            .bind(&destination)
            .fetch_all(&mut *tx)
            .await?
        }
    };
    for allotment_id in touched {
        super::packing::stages::refresh_allotment_status(&mut tx, allotment_id, ctx.at).await?;
    }
    tx.commit().await?;
    Ok(result)
}

/// The request in one spelling, so a retry compares equal; answers the
/// allotment and carton it names, parsed.
fn normalise(request: &mut MoveBackRequest) -> Result<(Option<Uuid>, Option<Uuid>), AppError> {
    request.idempotency_key = request.idempotency_key.trim().to_owned();
    if request.idempotency_key.is_empty() {
        return Err(AppError::Validation("idempotency_key is required".into()));
    }
    if request.from == MoveBackFrom::Picked && request.to == MoveBackTo::Picked {
        return Err(AppError::Validation(
            "these pieces are in the pick area already; move them back to the racks (to: pick)"
                .into(),
        ));
    }
    request.destination_id = request.destination_id.trim().to_owned();
    if request.destination_id.is_empty() {
        return Err(AppError::Validation(
            "name the shop the pieces were for".into(),
        ));
    }
    let allotment_id = match trimmed(request.allotment_id.take()) {
        Some(id) => Some(
            Uuid::parse_str(&id)
                .map_err(|_| AppError::Validation(format!("{id} is not an allotment id")))?,
        ),
        None => None,
    };
    request.allotment_id = allotment_id.map(|id| id.to_string());
    let koli_id = match trimmed(request.koli_id.take()) {
        Some(id) => {
            Some(Uuid::parse_str(&id).map_err(|_| AppError::NotFound(format!("koli {id}")))?)
        }
        None => None,
    };
    request.koli_id = koli_id.map(|id| id.to_string());
    match (request.from, koli_id) {
        (MoveBackFrom::Packed, None) => {
            return Err(AppError::Validation(
                "name the carton the pieces leave (koli_id)".into(),
            ))
        }
        (MoveBackFrom::Picked, Some(_)) => {
            return Err(AppError::Validation(
                "pieces in the pick area are in no carton; leave koli_id out".into(),
            ))
        }
        _ => {}
    }
    request.reason = trimmed(request.reason.take());
    for line in &mut request.lines {
        line.sku_code = line.sku_code.trim().to_ascii_uppercase();
        if line.sku_code.is_empty() {
            return Err(AppError::Validation("sku_code is required".into()));
        }
        if line.quantity <= 0 {
            return Err(AppError::Validation(format!(
                "quantity for {} must be positive",
                line.sku_code
            )));
        }
    }
    request
        .lines
        .sort_by(|left, right| left.sku_code.cmp(&right.sku_code));
    if request.lines.is_empty() {
        return Err(AppError::Validation(
            "a move back needs at least one line".into(),
        ));
    }
    if request
        .lines
        .windows(2)
        .any(|pair| pair[0].sku_code == pair[1].sku_code)
    {
        return Err(AppError::Validation(
            "one SKU cannot appear on two lines of the same move back".into(),
        ));
    }
    Ok((allotment_id, koli_id))
}

fn trimmed(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
}

// ---------------------------------------------------------------------------
// Out of a carton
// ---------------------------------------------------------------------------

struct Unpacked {
    pieces: Vec<Piece>,
    /// Of them, pieces MD had taken out: now closed short.
    settled: i64,
    koli: MoveBackKoli,
}

/// Take pieces out of one unsent carton into the pick area: the reverse of a
/// pack's first step (`record_stage`), with the same movement helper, one
/// movement group per allotment line, referenced to the line.
///
/// Per SKU, the pieces of a line MD took pieces out of (or of an allotment MD
/// cancelled) leave first, then the oldest allotment's.
async fn unpack(
    tx: &mut Tx<'_>,
    ctx: &Ctx<'_>,
    koli_id: Uuid,
    lines: &[MoveBackLine],
) -> Result<Unpacked, AppError> {
    let koli = sqlx::query(
        "SELECT koli_number, site_id, destination_store_id, stage, shipment_id, voided_at
           FROM dc_koli WHERE koli_id = $1
            FOR UPDATE",
    )
    .bind(koli_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("koli {koli_id}")))?;
    let number: String = koli.try_get("koli_number")?;
    if koli.try_get::<String, _>("site_id")? != ctx.site {
        return Err(AppError::NotFound(format!("koli {koli_id}")));
    }
    let shop: String = koli.try_get("destination_store_id")?;
    if shop != ctx.destination {
        return Err(AppError::Validation(format!(
            "carton {number} is for {shop}, not {}",
            ctx.destination
        )));
    }
    if koli
        .try_get::<Option<DateTime<Utc>>, _>("voided_at")?
        .is_some()
    {
        return Err(AppError::Conflict(format!(
            "carton {number} was emptied by an earlier move back"
        )));
    }
    if koli.try_get::<String, _>("stage")? != "PACKED"
        || koli.try_get::<Option<Uuid>, _>("shipment_id")?.is_some()
    {
        return Err(AppError::Conflict(format!(
            "carton {number} is already on a trip; what has left the bench is not moved back"
        )));
    }

    let mut pieces: Vec<Piece> = Vec::new();
    for asked in lines {
        let found = sqlx::query(
            "SELECT unit.subject_id, unit.epc, unit.sku_code, unit.allotment_id,
                    unit.allotment_line_id
               FROM dc_koli_unit unit
               JOIN allotment_line line ON line.id = unit.allotment_line_id
               JOIN allotment header ON header.id = unit.allotment_id
              WHERE unit.koli_id = $1
                AND unit.sku_code = $2
                AND ($3::uuid IS NULL OR unit.allotment_id = $3)
              ORDER BY (line.takeout_pending_quantity > 0
                        OR header.status IN ('CANCELLED', 'REJECTED')
                        OR header.cancelled_at IS NOT NULL) DESC,
                       header.created_at, unit.allotment_id, unit.allotment_line_id, unit.epc
              LIMIT $4",
        )
        .bind(koli_id)
        .bind(&asked.sku_code)
        .bind(ctx.allotment_id)
        .bind(asked.quantity)
        .fetch_all(&mut **tx)
        .await?
        .iter()
        .map(|row| -> Result<Piece, AppError> {
            Ok(Piece {
                subject_id: row.try_get("subject_id")?,
                epc: row.try_get("epc")?,
                sku_code: row.try_get("sku_code")?,
                allotment_id: row.try_get("allotment_id")?,
                allotment_line_id: row.try_get("allotment_line_id")?,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
        if i64::try_from(found.len()).unwrap_or(0) < asked.quantity {
            return Err(AppError::Conflict(format!(
                "carton {number} holds {} of {}{}; {} was asked for",
                found.len(),
                asked.sku_code,
                if ctx.allotment_id.is_some() {
                    " for this allotment"
                } else {
                    ""
                },
                asked.quantity
            )));
        }
        pieces.extend(found);
    }

    let mut by_line: BTreeMap<Uuid, Vec<&Piece>> = BTreeMap::new();
    for piece in &pieces {
        by_line
            .entry(piece.allotment_line_id)
            .or_default()
            .push(piece);
    }
    // The lines held for the rest of the transaction, in one order, so MD's
    // edit of the same line waits for this and then sees it.
    let line_ids: Vec<Uuid> = by_line.keys().copied().collect();
    let mut held: BTreeMap<Uuid, (i64, i64)> = BTreeMap::new();
    for row in sqlx::query(
        "SELECT line.id, line.takeout_pending_quantity, commitment.at_packed
           FROM allotment_line line
           JOIN allotment_line_commitment commitment
             ON commitment.allotment_line_id = line.id
          WHERE line.id = ANY($1)
          ORDER BY line.id
            FOR UPDATE OF line",
    )
    .bind(&line_ids)
    .fetch_all(&mut **tx)
    .await?
    {
        held.insert(
            row.try_get("id")?,
            (
                row.try_get("takeout_pending_quantity")?,
                row.try_get("at_packed")?,
            ),
        );
    }

    let packed_place = place_of_role(tx, ctx.site, PoolRole::Packed).await?;
    let mut settled = 0_i64;
    for (line_id, line_pieces) in &by_line {
        let n = i64::try_from(line_pieces.len()).unwrap_or(i64::MAX);
        let (pending, at_packed) = held
            .get(line_id)
            .copied()
            .ok_or_else(|| AppError::NotFound(format!("allotment line {line_id}")))?;
        if at_packed < n {
            return Err(AppError::Conflict(format!(
                "carton {number} holds {n} pieces of allotment line {line_id}, which counts \
                 only {at_packed} packed; nothing was moved"
            )));
        }
        // What MD took out of the carton is given up now that it is out
        // (spec §1): closed short, never asked for again.
        let given_up = n.min(pending.max(0));
        move_pieces(
            tx,
            line_pieces,
            *line_id,
            &packed_place,
            ctx.picking,
            MovementCause::NormalMove,
            &format!("dc-move-back:{}:unpack:{line_id}", ctx.move_back_id),
            &format!("Koli {number} opened again; back to the pick area"),
            ctx.actor,
            ctx.at,
        )
        .await?;
        // Never `packed_quantity - n`: a reversal is a fact of its own
        // (allotment-v1 §3), and the commitment view reads both.
        let updated = sqlx::query(
            "UPDATE allotment_line
                SET unpacked_quantity = unpacked_quantity + $2,
                    closed_short_quantity = closed_short_quantity + $3,
                    takeout_pending_quantity = takeout_pending_quantity - $3,
                    updated_at = $4
              WHERE id = $1",
        )
        .bind(line_id)
        .bind(n)
        .bind(given_up)
        .bind(ctx.at)
        .execute(&mut **tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(AppError::Conflict(format!(
                "Allotment line {line_id} cannot be unpacked"
            )));
        }
        settled += given_up;
    }

    // Out of the box, and out of its mirror: a piece is in one box at most.
    // A sealed carton's contents are final (0908) to everything but a move
    // back, which says so for this transaction only (0940).
    let subjects: Vec<Uuid> = pieces.iter().map(|piece| piece.subject_id).collect();
    let epcs: Vec<String> = pieces.iter().map(|piece| piece.epc.clone()).collect();
    sqlx::query("SELECT set_config('dc.move_back', 'on', true)")
        .execute(&mut **tx)
        .await?;
    sqlx::query("DELETE FROM dc_koli_unit WHERE koli_id = $1 AND subject_id = ANY($2)")
        .bind(koli_id)
        .bind(&subjects)
        .execute(&mut **tx)
        .await?;
    sqlx::query(
        "UPDATE edge_koli_unit SET released_at = $3, updated_at = $3
          WHERE koli_id = $1 AND epc = ANY($2) AND released_at IS NULL",
    )
    .bind(koli_id)
    .bind(&epcs)
    .bind(ctx.at)
    .execute(&mut **tx)
    .await?;
    let units_left: i64 =
        sqlx::query_scalar("SELECT count(*)::bigint FROM dc_koli_unit WHERE koli_id = $1")
            .bind(koli_id)
            .fetch_one(&mut **tx)
            .await?;
    if units_left == 0 {
        // Nothing left in it: no carton any more, on no list, on no trip.
        sqlx::query("UPDATE dc_koli SET voided_at = $2, updated_at = $2 WHERE koli_id = $1")
            .bind(koli_id)
            .bind(ctx.at)
            .execute(&mut **tx)
            .await?;
    } else {
        sqlx::query("UPDATE dc_koli SET updated_at = $2 WHERE koli_id = $1")
            .bind(koli_id)
            .bind(ctx.at)
            .execute(&mut **tx)
            .await?;
    }

    Ok(Unpacked {
        pieces,
        settled,
        koli: MoveBackKoli {
            koli_id,
            koli_number: number,
            units_left,
            // Its label still counts what it held; the bench prints it
            // again (`POST /api/v1/dc/koli/{id}/label`, its own printer).
            label_reprint: units_left > 0,
            emptied: units_left == 0,
        },
    })
}

// ---------------------------------------------------------------------------
// Out of the pick area, onto the racks
// ---------------------------------------------------------------------------

/// The shop's pieces of one SKU standing in the pick area: `dc_pick_waiting`
/// (0907) for what stands there now, one row per pick still waiting. `$1` the
/// pick area, `$2` the shop, `$3` the SKU, `$4` an allotment or NULL.
const WAITING_FOR_SHOP: &str = "
    WITH here AS (
        SELECT projection.subject_id, projection.place_id, projection.quantity
          FROM inventory_projection projection
          JOIN inventory_subject subject ON subject.id = projection.subject_id
          JOIN sku ON sku.id = subject.sku_id
         WHERE projection.place_id = $1 AND upper(sku.sku_code) = $3
    ), ranked AS (
        SELECT piece.allotment_line_id, piece.subject_id, piece.quantity,
               here.quantity AS on_hand,
               COALESCE(SUM(piece.quantity) OVER (
                   PARTITION BY piece.subject_id, piece.place_id
                   ORDER BY piece.seq DESC
                   ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ), 0)::bigint AS newer
          FROM here
          JOIN dc_pick_piece piece
            ON piece.subject_id = here.subject_id AND piece.place_id = here.place_id
    )
    SELECT ranked.allotment_line_id, ranked.subject_id,
           LEAST(ranked.quantity, ranked.on_hand - ranked.newer)::bigint AS quantity
      FROM ranked
      JOIN allotment_line line ON line.id = ranked.allotment_line_id
      JOIN allotment header ON header.id = line.allotment_id
      JOIN inventory_subject subject ON subject.id = ranked.subject_id
     WHERE ranked.on_hand - ranked.newer > 0
       AND line.destination_id = $2
       AND ($4::uuid IS NULL OR line.allotment_id = $4)
       AND header.activation_target_origin_id IS NULL
     ORDER BY header.created_at, line.allotment_id, line.id, subject.created_at, subject.id";

/// What waits in the pick area for one allotment line: `dc_pick_waiting`
/// (0907) for that line alone, read through its indexes rather than the
/// whole view.
const LINE_WAITING: &str = "
    SELECT COALESCE(SUM(LEAST(piece.quantity, projection.quantity - newer.quantity)), 0)::bigint
      FROM dc_pick_piece piece
      JOIN inventory_projection projection
        ON projection.subject_id = piece.subject_id AND projection.place_id = piece.place_id
     CROSS JOIN LATERAL (
           SELECT COALESCE(SUM(later.quantity), 0)::bigint AS quantity
             FROM dc_pick_piece later
            WHERE later.subject_id = piece.subject_id
              AND later.place_id = piece.place_id
              AND later.seq > piece.seq) newer
     WHERE piece.allotment_line_id = $1
       AND projection.quantity - newer.quantity > 0";

/// Which of the shop's picked pieces go back to the racks, per allotment
/// line and subject. Pieces a line no longer wants (it waits for more than it
/// still has to pack — MD took them out) go first; then the oldest
/// allotment's.
async fn choose_waiting(
    tx: &mut Tx<'_>,
    ctx: &Ctx<'_>,
    lines: &[MoveBackLine],
) -> Result<BTreeMap<Uuid, BTreeMap<Uuid, i64>>, AppError> {
    struct Waiting {
        line_id: Uuid,
        subject_id: Uuid,
        left: i64,
    }
    let mut chosen: BTreeMap<Uuid, BTreeMap<Uuid, i64>> = BTreeMap::new();
    for asked in lines {
        let mut waiting: Vec<Waiting> = sqlx::query(WAITING_FOR_SHOP)
            .bind(ctx.picking)
            .bind(ctx.destination)
            .bind(&asked.sku_code)
            .bind(ctx.allotment_id)
            .fetch_all(&mut **tx)
            .await?
            .iter()
            .map(|row| -> Result<Waiting, AppError> {
                Ok(Waiting {
                    line_id: row.try_get("allotment_line_id")?,
                    subject_id: row.try_get("subject_id")?,
                    left: row.try_get("quantity")?,
                })
            })
            .collect::<Result<_, _>>()?;
        let mut per_line: BTreeMap<Uuid, i64> = BTreeMap::new();
        for piece in &waiting {
            *per_line.entry(piece.line_id).or_insert(0) += piece.left;
        }
        let available: i64 = per_line.values().sum();
        if available < asked.quantity {
            return Err(AppError::Conflict(format!(
                "only {available} of {} for {} {} in the pick area{}; {} was asked for",
                asked.sku_code,
                ctx.destination,
                if available == 1 { "is" } else { "are" },
                if ctx.allotment_id.is_some() {
                    " for this allotment"
                } else {
                    ""
                },
                asked.quantity
            )));
        }
        let ids: Vec<Uuid> = per_line.keys().copied().collect();
        let to_pack: BTreeMap<Uuid, i64> = sqlx::query(
            "SELECT commitment.allotment_line_id,
                    commitment.to_pack_qty - line.pick_owed_quantity AS to_pack_qty
               FROM allotment_line_commitment commitment
               JOIN allotment_line line ON line.id = commitment.allotment_line_id
              WHERE commitment.allotment_line_id = ANY($1)",
        )
        .bind(&ids)
        .fetch_all(&mut **tx)
        .await?
        .iter()
        .map(|row| -> Result<(Uuid, i64), AppError> {
            Ok((
                row.try_get("allotment_line_id")?,
                row.try_get("to_pack_qty")?,
            ))
        })
        .collect::<Result<_, _>>()?;
        // Owed to the racks, per line: waiting beyond what it still wants.
        let mut owed: BTreeMap<Uuid, i64> = per_line
            .iter()
            .map(|(line_id, waits)| {
                let wants = to_pack.get(line_id).copied().unwrap_or(0).max(0);
                (*line_id, (waits - wants).max(0))
            })
            .collect();

        let mut left = asked.quantity;
        // MD's surplus first.
        for piece in &mut waiting {
            if left == 0 {
                break;
            }
            let line_owed = owed.entry(piece.line_id).or_insert(0);
            let take = piece.left.min(*line_owed).min(left);
            if take > 0 {
                *chosen
                    .entry(piece.line_id)
                    .or_default()
                    .entry(piece.subject_id)
                    .or_insert(0) += take;
                piece.left -= take;
                *line_owed -= take;
                left -= take;
            }
        }
        // Then the oldest allotment's.
        for piece in &mut waiting {
            if left == 0 {
                break;
            }
            let take = piece.left.min(left);
            if take > 0 {
                *chosen
                    .entry(piece.line_id)
                    .or_default()
                    .entry(piece.subject_id)
                    .or_insert(0) += take;
                piece.left -= take;
                left -= take;
            }
        }
    }
    Ok(chosen)
}

/// Pieces out of the pick area onto the rack their line was served from,
/// one movement group per line, referenced to it; the line's legacy
/// `picked_quantity` falls by as many, so execution (and the picklist) may
/// fetch what the line still wants.
///
/// Answers how many of them their line no longer wanted (it waited for more
/// than it still had to pack): those the picklist does not ask for again.
async fn put_away(
    tx: &mut Tx<'_>,
    ctx: &Ctx<'_>,
    by_line: &BTreeMap<Uuid, BTreeMap<Uuid, i64>>,
) -> Result<i64, AppError> {
    let line_ids: Vec<Uuid> = by_line.keys().copied().collect();
    let mut lines: BTreeMap<Uuid, (String, i64, i64)> = BTreeMap::new();
    for row in sqlx::query(
        "SELECT line.id, line.source_pool_id, commitment.to_pack_qty,
                line.pick_owed_quantity
           FROM allotment_line line
           JOIN allotment_line_commitment commitment
             ON commitment.allotment_line_id = line.id
          WHERE line.id = ANY($1)
          ORDER BY line.id
            FOR UPDATE OF line",
    )
    .bind(&line_ids)
    .fetch_all(&mut **tx)
    .await?
    {
        lines.insert(
            row.try_get("id")?,
            (
                row.try_get("source_pool_id")?,
                row.try_get("to_pack_qty")?,
                row.try_get("pick_owed_quantity")?,
            ),
        );
    }

    let mut settled = 0_i64;
    for (line_id, subjects) in by_line {
        let (source_pool, to_pack, pick_owed) = lines
            .get(line_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("allotment line {line_id}")))?;
        let n: i64 = subjects.values().sum();
        // Read after any unpack above: the pieces just out of a carton count.
        let waiting: i64 = sqlx::query_scalar(LINE_WAITING)
            .bind(line_id)
            .fetch_one(&mut **tx)
            .await?;
        // Owed to the racks: waiting beyond what the line still wants, which
        // is To Pack less the picked pieces MD gave up (0965).
        let owed = (waiting - (to_pack - pick_owed).max(0)).max(0);
        let line_settled = n.min(owed);
        settled += line_settled;
        // Those MD gave up and that were still held for her: free now that
        // they are back on the rack (owner, 10 Oct 2026 — stock returns when
        // the warehouse confirms). Closed short, and no longer owed.
        let release = line_settled.min(pick_owed.max(0));
        move_quantities(
            tx,
            *line_id,
            ctx.picking,
            &format!("{source_pool}:on_hand"),
            subjects,
            &format!("dc-move-back:{}:rack:{line_id}", ctx.move_back_id),
            &format!("Moved back from the pick area to {source_pool}"),
            ctx.actor,
            ctx.at,
        )
        .await?;
        // The legacy pick counter (allotment-v1 §4: ALLOTMENT_PICKED is
        // retired) is what execution holds a line to; it may fall, and
        // `picked + cancelled <= quantity` still holds.
        let updated = sqlx::query(
            "UPDATE allotment_line
                SET picked_quantity = GREATEST(picked_quantity - $2, 0),
                    closed_short_quantity = closed_short_quantity + $4,
                    pick_owed_quantity = pick_owed_quantity - $4,
                    updated_at = $3
              WHERE id = $1",
        )
        .bind(line_id)
        .bind(n)
        .bind(ctx.at)
        .bind(release)
        .execute(&mut **tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(AppError::Conflict(format!(
                "Allotment line {line_id} cannot be put back"
            )));
        }
    }
    Ok(settled)
}

/// One movement group of subjects and quantities, referenced to an
/// allotment line: `move_pieces` for whatever stands in the pick area, a
/// counted quantity included.
#[allow(clippy::too_many_arguments)]
async fn move_quantities(
    tx: &mut Tx<'_>,
    allotment_line_id: Uuid,
    from: &str,
    to: &str,
    subjects: &BTreeMap<Uuid, i64>,
    key: &str,
    reason: &str,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let place = |id: &str| -> Result<Place, AppError> {
        id.parse()
            .map_err(|error: crate::cloud::domain::PlaceError| {
                AppError::Validation(error.to_string())
            })
    };
    let from_place = place(from)?;
    let to_place = place(to)?;
    let command = MovementCommand {
        movement_group_id: MovementGroupId::new(),
        lines: subjects
            .iter()
            .map(|(subject_id, quantity)| MovementLine {
                subject_id: SubjectId(*subject_id),
                quantity: *quantity,
                from: from_place.clone(),
                to: to_place.clone(),
            })
            .collect(),
        cause: MovementCause::NormalMove,
        reference_type: Some("ALLOTMENT_LINE".into()),
        reference_id: Some(allotment_line_id.to_string()),
        reason: reason.to_owned(),
        actor_id: actor.to_owned(),
        occurred_at: at,
    };
    crate::cloud::domain::validate_command(&command)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    crate::cloud::postgres::insert_group(tx, &command, key, key).await?;
    crate::cloud::postgres::apply_lines(tx, &command, key, key).await?;
    Ok(())
}
