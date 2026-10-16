//! What packing and dispatch write (see `packing.rs` for the shape).
//!
//! Every write here happens inside one transaction per request, under one
//! lock per Gudang, so two benches never pack the same piece and a trip is
//! loaded, departed and announced whole or not at all.

use super::edge_error;
use crate::cloud::dc::common;
use crate::cloud::domain::flow::{FlowSource, SourceKind, StageKind};
use crate::cloud::domain::{
    AllotmentStatus, FulfillmentStatus, MovementCause, MovementCommand, MovementGroupId,
    MovementLine, Place, SubjectId,
};
use crate::cloud::postgres::flow_stages::{resume_from_node_fact_tx, NodeFact};
use crate::cloud::{AppError, AppState};
use crate::edge::contracts::{DispatchTripRequest, FulfillmentProgressResult, PackRequest};
use crate::pool_role::PoolRole;
use crate::sync::workflow::{
    FulfillmentProgressPayload, FulfillmentStage, PackageUnitAllocation,
    INVENTORY_FULFILLMENT_PROGRESS_V1, INVENTORY_WORKFLOW_SCHEMA_VERSION,
};
use chrono::{DateTime, Datelike, Utc};
use sqlx::{Postgres, Row, Transaction};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

type Tx<'a> = Transaction<'a, Postgres>;

/// The DC server counts surat jalan and truck runs on and on, never per year,
/// and prints no year in them (`edge::outbound::next_number`).
/// `dc_number_series` keys every series by year, so these two are filed under
/// one fixed year and never start again.
const RUNNING_SERIES_YEAR: i32 = 2000;

/// One piece in a box, and the allotment line it answers. Shared with the
/// move back (`dc/move_back.rs`), which takes pieces out of a box again.
#[derive(Clone, Debug)]
pub(in crate::cloud::dc) struct Piece {
    pub(in crate::cloud::dc) subject_id: Uuid,
    pub(in crate::cloud::dc) epc: String,
    pub(in crate::cloud::dc) sku_code: String,
    pub(in crate::cloud::dc) allotment_id: Uuid,
    pub(in crate::cloud::dc) allotment_line_id: Uuid,
}

/// A koli as the stage machinery needs it.
struct KoliRef {
    koli_id: Uuid,
    koli_number: String,
    site_id: String,
    /// Head office's name for the shop: what allotment lines and flows carry.
    destination_store_id: String,
    /// The shop's node's name for itself: what the facts and the announcement
    /// carry, so the shop recognises the delivery as its own.
    wire_destination_id: String,
    stage: FulfillmentStage,
    /// The surat jalan number, once it is on one.
    shipment_reference: Option<String>,
}

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

/// Pack a carton from quantities. The pieces are the shop's picked ones —
/// standing in the pick area, referenced to that shop's allotment lines —
/// oldest allotment first, the allotments of the picklists named first.
///
/// A retry with the same key answers with the carton the first attempt
/// packed: a second attempt would otherwise find different pieces (the first
/// box holds the ones it took) and pack a second carton.
pub(super) async fn pack(
    state: &AppState,
    actor: &str,
    mut request: PackRequest,
) -> Result<Uuid, AppError> {
    let actor = actor.trim().to_owned();
    if actor.is_empty() {
        return Err(AppError::Validation("actor is required".into()));
    }
    request.actor_id = actor.clone();
    request.idempotency_key = request.idempotency_key.trim().to_owned();
    if request.idempotency_key.is_empty() {
        return Err(AppError::Validation("idempotency_key is required".into()));
    }
    let mut picks: Vec<String> = request
        .pick_session_ids
        .iter()
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty())
        .collect();
    picks.sort();
    picks.dedup();
    request.pick_session_ids = picks;
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
            "a pack needs at least one line; a koli holding nothing is a number nobody can explain"
                .into(),
        ));
    }
    if request
        .lines
        .windows(2)
        .any(|pair| pair[0].sku_code == pair[1].sku_code)
    {
        return Err(AppError::Validation(
            "one SKU cannot appear on two lines of the same pack".into(),
        ));
    }

    common::ensure_origin(&state.db).await?;
    let mut tx = state.db.begin().await?;
    let site = common::gudang_site_tx(&mut tx).await?;
    lock_outbound(&mut tx, &site).await?;

    // Packed from a shop's picklists: the shop is the one they were walked
    // for, and a request naming another is a mistake, not a choice.
    let (picked_for, prefer) = picklist_hints(&mut tx, &request.pick_session_ids).await?;
    let named = request.destination_store_id.trim().to_owned();
    let destination = match (named.is_empty(), picked_for) {
        (true, Some(shop)) => shop,
        (true, None) => {
            return Err(AppError::Validation(
                "name the shop this koli is for".into(),
            ))
        }
        (false, Some(shop)) if shop != named => {
            return Err(AppError::Validation(format!(
                "these picklists are for {shop}, not {named}; one koli is for one shop"
            )))
        }
        (false, _) => named,
    };
    let destination = crate::cloud::postgres::canonical_site_id_tx(&mut tx, &destination).await?;
    let shop_exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM site WHERE id = $1)")
        .bind(&destination)
        .fetch_one(&mut *tx)
        .await?;
    if !shop_exists {
        return Err(AppError::NotFound(format!("shop {destination}")));
    }
    if destination == site {
        return Err(AppError::Validation(
            "a koli from the Gudang goes to a shop, not back to the Gudang".into(),
        ));
    }
    request.destination_store_id = destination.clone();
    let request_json = serde_json::to_string(&request)?;

    if let Some(row) = sqlx::query("SELECT koli_id, pack_request FROM dc_koli WHERE pack_key = $1")
        .bind(&request.idempotency_key)
        .fetch_optional(&mut *tx)
        .await?
    {
        if row.try_get::<Option<String>, _>("pack_request")?.as_deref()
            != Some(request_json.as_str())
        {
            return Err(AppError::Conflict(
                "idempotency key was already used with a different request payload".into(),
            ));
        }
        let koli_id: Uuid = row.try_get("koli_id")?;
        tx.commit().await?;
        return Ok(koli_id);
    }

    let picking = place_of_role(&mut tx, &site, PoolRole::Picking).await?;
    let mut pieces = Vec::new();
    for line in &request.lines {
        let found = waiting_pieces(
            &mut tx,
            &picking,
            &destination,
            &line.sku_code,
            &prefer,
            line.quantity,
        )
        .await?;
        // A short pack is a mistake worth refusing rather than a fact worth
        // recording: the sheet a packer works from already says how many are
        // standing in the pick area.
        if i64::try_from(found.len()).unwrap_or(0) < line.quantity {
            return Err(AppError::Conflict(if prefer.is_empty() {
                format!(
                    "only {} of {} is in the picking area for {destination}; {} was asked for",
                    found.len(),
                    line.sku_code,
                    line.quantity
                )
            } else {
                format!(
                    "only {} of {} from these picklists is waiting to be packed; {} was asked for",
                    found.len(),
                    line.sku_code,
                    line.quantity
                )
            }));
        }
        pieces.extend(found);
    }
    pieces.sort_by(|left, right| left.epc.cmp(&right.epc));

    let at = state.clock.now();
    let koli_id = Uuid::new_v4();
    let koli_number = next_koli_number(&mut tx, &site, at).await?;
    let wire_destination_id =
        crate::cloud::postgres::node_site_id_tx(&mut tx, &destination).await?;
    sqlx::query(
        "INSERT INTO dc_koli
             (koli_id, koli_number, site_id, destination_store_id, wire_destination_id, stage,
              pick_session_ids, created_by, created_at, updated_at, pack_key, pack_request)
         VALUES ($1, $2, $3, $4, $5, 'PACKED', $6, $7, $8, $8, $9, $10)",
    )
    .bind(koli_id)
    .bind(&koli_number)
    .bind(&site)
    .bind(&destination)
    .bind(&wire_destination_id)
    .bind(&request.pick_session_ids)
    .bind(&actor)
    .bind(at)
    .bind(&request.idempotency_key)
    .bind(&request_json)
    .execute(&mut *tx)
    .await?;
    for piece in &pieces {
        sqlx::query(
            "INSERT INTO dc_koli_unit
                 (koli_id, subject_id, epc, sku_code, allotment_id, allotment_line_id)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(koli_id)
        .bind(piece.subject_id)
        .bind(&piece.epc)
        .bind(&piece.sku_code)
        .bind(piece.allotment_id)
        .bind(piece.allotment_line_id)
        .execute(&mut *tx)
        .await?;
    }
    let koli = KoliRef {
        koli_id,
        koli_number,
        site_id: site,
        destination_store_id: destination,
        wire_destination_id,
        stage: FulfillmentStage::Packed,
        shipment_reference: None,
    };
    record_stage(
        &mut tx,
        &koli,
        &pieces,
        FulfillmentStage::Packed,
        &actor,
        at,
    )
    .await?;
    if request.seal {
        seal_tx(&mut tx, koli_id, &actor, at).await?;
    }
    tx.commit().await?;
    Ok(koli_id)
}

/// Close the box (`edge::outbound::seal_koli`).
pub(super) async fn seal(state: &AppState, koli_id: Uuid, actor: &str) -> Result<(), AppError> {
    let mut tx = state.db.begin().await?;
    seal_tx(&mut tx, koli_id, actor, state.clock.now()).await?;
    tx.commit().await?;
    Ok(())
}

async fn seal_tx(
    tx: &mut Tx<'_>,
    koli_id: Uuid,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    if actor.trim().is_empty() {
        return Err(AppError::Validation("sealer is required".into()));
    }
    let row = sqlx::query(
        "SELECT sealed_at, (SELECT count(*) FROM dc_koli_unit u WHERE u.koli_id = k.koli_id)::bigint AS units
           FROM dc_koli k WHERE k.koli_id = $1 FOR UPDATE",
    )
    .bind(koli_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("koli {koli_id}")))?;
    if row.try_get::<i64, _>("units")? == 0 {
        // An empty sealed box is a packing list describing nothing, and a
        // number that will be looked for on arrival and never explained.
        return Err(AppError::Validation(format!(
            "koli {koli_id} is empty; nothing to seal"
        )));
    }
    if row
        .try_get::<Option<DateTime<Utc>>, _>("sealed_at")?
        .is_some()
    {
        return Err(AppError::Conflict(format!(
            "koli {koli_id} is missing or already sealed"
        )));
    }
    sqlx::query(
        "UPDATE dc_koli SET sealed_at = $2, sealed_by = $3, updated_at = $2
          WHERE koli_id = $1 AND sealed_at IS NULL",
    )
    .bind(koli_id)
    .bind(at)
    .bind(actor.trim())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// The shop's picked pieces of one SKU that no box holds yet: standing in the
/// pick area with their movement referenced to one of the shop's allotment
/// lines. The allotments of the picklists named come first, then the oldest
/// allotment, then the oldest piece.
async fn waiting_pieces(
    tx: &mut Tx<'_>,
    picking_place: &str,
    destination: &str,
    sku_code: &str,
    prefer: &[Uuid],
    quantity: i64,
) -> Result<Vec<Piece>, AppError> {
    let rows = sqlx::query(
        "WITH referenced AS (
             SELECT m.subject_id, m.reference_id
               FROM movement m
              WHERE m.reference_type = 'ALLOTMENT_LINE'
                AND (m.to_place_id = $1 OR m.from_place_id = $1)
              GROUP BY m.subject_id, m.reference_id
             HAVING SUM(CASE WHEN m.to_place_id = $1 THEN m.quantity ELSE -m.quantity END) > 0
         )
         SELECT subject.id AS subject_id, subject.epc, upper(sku.sku_code) AS sku_code,
                line.allotment_id, line.id AS allotment_line_id
           FROM referenced
           JOIN allotment_line line ON line.id::text = referenced.reference_id
           JOIN allotment header ON header.id = line.allotment_id
           JOIN inventory_subject subject ON subject.id = referenced.subject_id
           JOIN sku ON sku.id = subject.sku_id
          WHERE line.destination_id = $2
            AND upper(sku.sku_code) = $3
            AND subject.subject_type = 'UNIT' AND subject.epc IS NOT NULL
            AND header.activation_target_origin_id IS NULL
          ORDER BY (line.allotment_id = ANY($4)) DESC, header.created_at, line.allotment_id,
                   line.id, subject.created_at, subject.id
          LIMIT $5
          FOR UPDATE OF subject",
    )
    .bind(picking_place)
    .bind(destination)
    .bind(sku_code)
    .bind(prefer)
    .bind(quantity)
    .fetch_all(&mut **tx)
    .await?;
    rows.iter()
        .map(|row| -> Result<Piece, AppError> {
            Ok(Piece {
                subject_id: row.try_get("subject_id")?,
                epc: row
                    .try_get::<Option<String>, _>("epc")?
                    .unwrap_or_default()
                    .trim()
                    .to_ascii_uppercase(),
                sku_code: row.try_get("sku_code")?,
                allotment_id: row.try_get("allotment_id")?,
                allotment_line_id: row.try_get("allotment_line_id")?,
            })
        })
        .collect()
}

/// What the picklists named on a pack say: the shop they were walked for and
/// the allotments they answer. Read from the picking area's record of its
/// rounds (`cloud/dc/picking.rs`, `dc_pick_session`) when it keeps a round's
/// shop and allotment; without it the pieces are still the shop's — every
/// piece in the pick area is referenced to the line it was fetched for — and
/// only the preference is lost.
async fn picklist_hints(
    tx: &mut Tx<'_>,
    pick_session_ids: &[String],
) -> Result<(Option<String>, Vec<Uuid>), AppError> {
    if pick_session_ids.is_empty() {
        return Ok((None, Vec::new()));
    }
    let readable: bool = sqlx::query_scalar(
        "SELECT count(DISTINCT column_name) = 3 FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'dc_pick_session'
            AND column_name IN ('session_id', 'destination_id', 'allotment_id')",
    )
    .fetch_one(&mut **tx)
    .await?;
    if !readable {
        return Ok((None, Vec::new()));
    }
    let rows = sqlx::query(
        "SELECT session_id::text AS session_id, destination_id::text AS destination_id,
                allotment_id::text AS allotment_id
           FROM dc_pick_session WHERE session_id::text = ANY($1)",
    )
    .bind(pick_session_ids)
    .fetch_all(&mut **tx)
    .await?;
    let mut shop: Option<String> = None;
    let mut prefer = Vec::new();
    for pick in pick_session_ids {
        let row = rows
            .iter()
            .find(|row| {
                row.try_get::<String, _>("session_id").ok().as_deref() == Some(pick.as_str())
            })
            .ok_or_else(|| AppError::NotFound(format!("picklist {pick}")))?;
        let walked_for: Option<String> = row.try_get("destination_id")?;
        let walked_for = walked_for.ok_or_else(|| {
            AppError::Validation(format!(
                "picklist {pick} was picked for no shop; pack it by destination"
            ))
        })?;
        match &shop {
            None => shop = Some(walked_for),
            Some(first) if *first != walked_for => {
                return Err(AppError::Validation(format!(
                    "picklist {pick} is for {walked_for}, not {first}; one koli is for one shop"
                )))
            }
            Some(_) => {}
        }
        if let Some(allotment) = row
            .try_get::<Option<String>, _>("allotment_id")?
            .and_then(|id| Uuid::parse_str(&id).ok())
        {
            if !prefer.contains(&allotment) {
                prefer.push(allotment);
            }
        }
    }
    Ok((shop, prefer))
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/// Sealed cartons onto one trip, in one act: a surat jalan per shop for the
/// cartons on none yet, the truck run, the cartons loaded, the truck gone and
/// every carton in transit — announced to its shop.
///
/// One transaction: the trip happens whole or not at all, so a retry after a
/// failure starts clean, and a retry after a success answers with the run.
pub(super) async fn dispatch_trip(
    state: &AppState,
    actor: &str,
    mut request: DispatchTripRequest,
) -> Result<Uuid, AppError> {
    let actor = actor.trim().to_owned();
    if actor.is_empty() {
        return Err(AppError::Validation("actor is required".into()));
    }
    request.actor_id = actor.clone();
    request.idempotency_key = request.idempotency_key.trim().to_owned();
    if request.idempotency_key.is_empty() {
        return Err(AppError::Validation("idempotency_key is required".into()));
    }
    request.trip_note = request
        .trip_note
        .as_deref()
        .map(str::trim)
        .filter(|note| !note.is_empty())
        .map(str::to_owned);
    for koli_id in &mut request.koli_ids {
        *koli_id = koli_id.trim().to_owned();
    }
    request.koli_ids.sort();
    if request.koli_ids.is_empty() {
        return Err(AppError::Validation(
            "a dispatch needs at least one sealed koli".into(),
        ));
    }
    if request.koli_ids.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(AppError::Validation(
            "one koli cannot be ticked twice on the same trip".into(),
        ));
    }
    let request_json = serde_json::to_string(&request)?;

    common::ensure_origin(&state.db).await?;
    let mut tx = state.db.begin().await?;
    let site = common::gudang_site_tx(&mut tx).await?;
    lock_outbound(&mut tx, &site).await?;

    if let Some(row) =
        sqlx::query("SELECT dispatch_id, trip_request FROM dc_dispatch WHERE trip_key = $1")
            .bind(&request.idempotency_key)
            .fetch_optional(&mut *tx)
            .await?
    {
        if row.try_get::<Option<String>, _>("trip_request")?.as_deref()
            != Some(request_json.as_str())
        {
            return Err(AppError::Conflict(
                "idempotency key was already used with a different request payload".into(),
            ));
        }
        let dispatch_id: Uuid = row.try_get("dispatch_id")?;
        tx.commit().await?;
        return Ok(dispatch_id);
    }

    // Every carton checked before anything is written: sealed, and not
    // already on a trip. Grouped by shop — a surat jalan is signed by one.
    // One locked read for the whole request, not one per carton.
    struct Carton {
        koli_number: String,
        destination_store_id: String,
        sealed_at: Option<DateTime<Utc>>,
        voided_at: Option<DateTime<Utc>>,
        shipment_id: Option<Uuid>,
        shipment_number: Option<String>,
        dispatch_id: Option<Uuid>,
    }
    let mut ids = Vec::with_capacity(request.koli_ids.len());
    for koli_id in &request.koli_ids {
        ids.push(
            Uuid::parse_str(koli_id).map_err(|_| AppError::NotFound(format!("koli {koli_id}")))?,
        );
    }
    let mut checked: BTreeMap<Uuid, Carton> = BTreeMap::new();
    for row in sqlx::query(
        "SELECT k.koli_id, k.koli_number, k.destination_store_id, k.sealed_at, k.voided_at,
                k.shipment_id, s.shipment_number, s.dispatch_id
           FROM dc_koli k
           LEFT JOIN dc_shipment s ON s.shipment_id = k.shipment_id
          WHERE k.koli_id = ANY($1)
            FOR UPDATE OF k",
    )
    .bind(&ids)
    .fetch_all(&mut *tx)
    .await?
    {
        checked.insert(
            row.get("koli_id"),
            Carton {
                koli_number: row.try_get("koli_number")?,
                destination_store_id: row.try_get("destination_store_id")?,
                sealed_at: row.try_get("sealed_at")?,
                voided_at: row.try_get("voided_at")?,
                shipment_id: row.try_get("shipment_id")?,
                shipment_number: row.try_get("shipment_number")?,
                dispatch_id: row.try_get("dispatch_id")?,
            },
        );
    }
    let mut loose: BTreeMap<String, Vec<Uuid>> = BTreeMap::new();
    let mut shipment_ids: Vec<Uuid> = Vec::new();
    for (koli_id, id) in request.koli_ids.iter().zip(&ids) {
        let carton = checked
            .get(id)
            .ok_or_else(|| AppError::NotFound(format!("koli {koli_id}")))?;
        let number = &carton.koli_number;
        if carton.voided_at.is_some() {
            return Err(AppError::Conflict(format!(
                "koli {number} was emptied by a put back; there is nothing in it to dispatch"
            )));
        }
        if carton.sealed_at.is_none() {
            return Err(AppError::Conflict(format!(
                "koli {number} is not sealed yet"
            )));
        }
        match carton.shipment_id {
            None => loose
                .entry(carton.destination_store_id.clone())
                .or_default()
                .push(*id),
            Some(shipment_id) => {
                if carton.dispatch_id.is_some() {
                    return Err(AppError::Conflict(format!(
                        "koli {number} is already on a trip ({})",
                        carton.shipment_number.clone().unwrap_or_default()
                    )));
                }
                if !shipment_ids.contains(&shipment_id) {
                    shipment_ids.push(shipment_id);
                }
            }
        }
    }
    // The hard stop: a carton holding pieces MD took out does not leave.
    refuse_taken_out(&mut tx, &ids, &shipment_ids).await?;

    let at = state.clock.now();
    // The surat jalan, one per shop, for the cartons on none yet. The serial
    // numbers are taken one by one (each takes the series' next); the writes
    // are one INSERT for every surat jalan and one UPDATE for every carton
    // of the trip, where each shop wrote its own before.
    if !loose.is_empty() {
        let mut new_shipments: Vec<Uuid> = Vec::with_capacity(loose.len());
        let mut numbers: Vec<String> = Vec::with_capacity(loose.len());
        let mut destinations: Vec<String> = Vec::with_capacity(loose.len());
        for destination in loose.keys() {
            numbers.push(next_paper_number(&mut tx, &site, "SJ", "SHIPMENT").await?);
            destinations.push(destination.clone());
            new_shipments.push(Uuid::new_v4());
        }
        sqlx::query(
            "INSERT INTO dc_shipment
                 (shipment_id, shipment_number, site_id, destination_store_id, created_by, created_at)
             SELECT shipment.shipment_id, shipment.shipment_number, $2,
                    shipment.destination_store_id, $3, $4
               FROM unnest($1::uuid[], $5::text[], $6::text[])
                    AS shipment(shipment_id, shipment_number, destination_store_id)",
        )
        .bind(&new_shipments)
        .bind(&site)
        .bind(&actor)
        .bind(at)
        .bind(&numbers)
        .bind(&destinations)
        .execute(&mut *tx)
        .await?;
        let mut loaded_kolis: Vec<Uuid> = Vec::new();
        let mut onto_shipment: Vec<Uuid> = Vec::new();
        for (index, koli_ids) in loose.values().enumerate() {
            for koli_id in koli_ids {
                loaded_kolis.push(*koli_id);
                onto_shipment.push(new_shipments[index]);
            }
        }
        sqlx::query(
            "UPDATE dc_koli k
                SET shipment_id = assignment.shipment_id, updated_at = $3
               FROM unnest($1::uuid[], $2::uuid[]) AS assignment(koli_id, shipment_id)
              WHERE k.koli_id = assignment.koli_id",
        )
        .bind(&loaded_kolis)
        .bind(&onto_shipment)
        .bind(at)
        .execute(&mut *tx)
        .await?;
        shipment_ids.extend(new_shipments);
    }

    // The truck run.
    let dispatch_id = Uuid::new_v4();
    let number = next_paper_number(&mut tx, &site, "DSP", "DISPATCH").await?;
    sqlx::query(
        "INSERT INTO dc_dispatch
             (dispatch_id, dispatch_number, site_id, trip_note, created_by, created_at,
              trip_key, trip_request)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(dispatch_id)
    .bind(&number)
    .bind(&site)
    .bind(&request.trip_note)
    .bind(&actor)
    .bind(at)
    .bind(&request.idempotency_key)
    .bind(&request_json)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE dc_shipment SET dispatch_id = $2 WHERE shipment_id = ANY($1)")
        .bind(&shipment_ids)
        .bind(dispatch_id)
        .execute(&mut *tx)
        .await?;

    // Every carton on those surat jalan goes — including one an earlier
    // surat jalan holds that was never put on a truck. The cartons and
    // their pieces are read for the whole trip in two queries, where the
    // stage machinery re-read both per carton per rung; no rung below
    // writes either.
    let carton_rows = sqlx::query(
        "SELECT k.koli_id, k.koli_number, k.site_id, k.destination_store_id,
                k.wire_destination_id, k.stage, s.shipment_number
           FROM dc_koli k
           JOIN dc_shipment s ON s.shipment_id = k.shipment_id
          WHERE s.dispatch_id = $1
          ORDER BY s.shipment_number, k.koli_number
            FOR UPDATE OF k",
    )
    .bind(dispatch_id)
    .fetch_all(&mut *tx)
    .await?;
    let carton_ids: Vec<Uuid> = carton_rows.iter().map(|row| row.get("koli_id")).collect();
    let mut pieces_of: BTreeMap<Uuid, Vec<Piece>> = BTreeMap::new();
    for row in sqlx::query(
        "SELECT koli_id, subject_id, epc, sku_code, allotment_id, allotment_line_id
           FROM dc_koli_unit
          WHERE koli_id = ANY($1)
          ORDER BY koli_id, epc",
    )
    .bind(&carton_ids)
    .fetch_all(&mut *tx)
    .await?
    {
        pieces_of
            .entry(row.get("koli_id"))
            .or_default()
            .push(Piece {
                subject_id: row.get("subject_id"),
                epc: row.get("epc"),
                sku_code: row.get("sku_code"),
                allotment_id: row.get("allotment_id"),
                allotment_line_id: row.get("allotment_line_id"),
            });
    }
    let mut trip: Vec<(KoliRef, Vec<Piece>)> = Vec::with_capacity(carton_rows.len());
    for row in &carton_rows {
        let koli_id: Uuid = row.get("koli_id");
        let pieces = pieces_of.remove(&koli_id).unwrap_or_default();
        trip.push((
            KoliRef {
                koli_id,
                koli_number: row.try_get("koli_number")?,
                site_id: row.try_get("site_id")?,
                destination_store_id: row.try_get("destination_store_id")?,
                wire_destination_id: row.try_get("wire_destination_id")?,
                stage: parse_stage(&row.try_get::<String, _>("stage")?)?,
                shipment_reference: row.try_get("shipment_number")?,
            },
            pieces,
        ));
    }

    // The truck leaves, stamped once, before any carton is announced.
    sqlx::query(
        "UPDATE dc_dispatch SET departed_at = $2 WHERE dispatch_id = $1 AND departed_at IS NULL",
    )
    .bind(dispatch_id)
    .bind(at)
    .execute(&mut *tx)
    .await?;
    // Every carton up the ladder in the cartons' order, a rung at a time,
    // from the one read above — each rung used to start from its own
    // re-read of the koli and its pieces. A carton's own stage order is
    // kept: each rung whole before the next, LOADED whole, then IN_TRANSIT
    // whole, whatever rung it starts from.
    for (mut koli, pieces) in trip {
        while koli.stage.rank() < FulfillmentStage::InTransit.rank() {
            let next = next_stage(koli.stage);
            record_stage(&mut tx, &koli, &pieces, next, &actor, at).await?;
            koli.stage = next;
        }
    }
    tx.commit().await?;
    Ok(dispatch_id)
}

/// The hard stop of MD's edit and cancel
/// (docs/research/2026-10-09-outbound-cancel-edit-build.md §0 rule 4): a
/// carton holding pieces of a line MD took pieces out of
/// (`takeout_pending_quantity`), or of an allotment MD cancelled, is refused
/// until the Gudang has moved them back. There is no override.
///
/// Every carton that would go is checked — the ones ticked, and the ones an
/// earlier surat jalan of the trip already holds — before anything is
/// written. Their lines are held (FOR SHARE) so an edit cannot land between
/// this read and the trip: it waits, and then sees the pieces as sent.
async fn refuse_taken_out(
    tx: &mut Tx<'_>,
    koli_ids: &[Uuid],
    shipment_ids: &[Uuid],
) -> Result<(), AppError> {
    sqlx::query(
        "SELECT line.id
           FROM allotment_line line
          WHERE line.id IN (SELECT unit.allotment_line_id
                              FROM dc_koli_unit unit
                              JOIN dc_koli koli ON koli.koli_id = unit.koli_id
                             WHERE koli.koli_id = ANY($1) OR koli.shipment_id = ANY($2))
          ORDER BY line.id
            FOR SHARE OF line",
    )
    .bind(koli_ids)
    .bind(shipment_ids)
    .fetch_all(&mut **tx)
    .await?;
    let Some(row) = sqlx::query(
        "SELECT koli.koli_number,
                COALESCE(SUM(LEAST(held.pieces, line.takeout_pending_quantity)), 0)::bigint
                    AS taken_out,
                COALESCE(SUM(held.pieces) FILTER (
                    WHERE header.status IN ('CANCELLED', 'REJECTED')
                       OR header.cancelled_at IS NOT NULL), 0)::bigint AS cancelled,
                string_agg(DISTINCT header.allotment_number, ', ') FILTER (
                    WHERE header.status IN ('CANCELLED', 'REJECTED')
                       OR header.cancelled_at IS NOT NULL) AS cancelled_allotments
           FROM (SELECT unit.koli_id, unit.allotment_line_id, COUNT(*)::bigint AS pieces
                   FROM dc_koli_unit unit
                   JOIN dc_koli koli ON koli.koli_id = unit.koli_id
                  WHERE koli.koli_id = ANY($1) OR koli.shipment_id = ANY($2)
                  GROUP BY unit.koli_id, unit.allotment_line_id) held
           JOIN dc_koli koli ON koli.koli_id = held.koli_id
           JOIN allotment_line line ON line.id = held.allotment_line_id
           JOIN allotment header ON header.id = line.allotment_id
          GROUP BY koli.koli_number
         HAVING SUM(LEAST(held.pieces, line.takeout_pending_quantity)) > 0
             OR bool_or(header.status IN ('CANCELLED', 'REJECTED')
                        OR header.cancelled_at IS NOT NULL)
          ORDER BY koli.koli_number
          LIMIT 1",
    )
    .bind(koli_ids)
    .bind(shipment_ids)
    .fetch_optional(&mut **tx)
    .await?
    else {
        return Ok(());
    };
    let number: String = row.try_get("koli_number")?;
    let cancelled: i64 = row.try_get("cancelled")?;
    if cancelled > 0 {
        let allotments: Option<String> = row.try_get("cancelled_allotments")?;
        return Err(AppError::Conflict(format!(
            "{number} holds {cancelled} pcs of {}, which MD cancelled; move them back first",
            allotments.unwrap_or_else(|| "an allotment".into())
        )));
    }
    let taken_out: i64 = row.try_get("taken_out")?;
    Err(AppError::Conflict(format!(
        "{number} holds {taken_out} pcs MD took out; move them back first"
    )))
}

/// The truck leaves (`edge::outbound::depart_dispatch`): stamped once. Its
/// cartons go in transit one by one (`koli_in_transit`), as on the DC server;
/// a trip made by `dispatch_trip` has already done both.
pub(super) async fn depart(state: &AppState, dispatch_id: Uuid) -> Result<(), AppError> {
    let mut tx = state.db.begin().await?;
    let shipments: i64 =
        sqlx::query_scalar("SELECT count(*)::bigint FROM dc_shipment WHERE dispatch_id = $1")
            .bind(dispatch_id)
            .fetch_one(&mut *tx)
            .await?;
    if shipments == 0 {
        return Err(AppError::Validation(format!(
            "dispatch {dispatch_id} carries nothing"
        )));
    }
    let changed = sqlx::query(
        "UPDATE dc_dispatch SET departed_at = $2 WHERE dispatch_id = $1 AND departed_at IS NULL",
    )
    .bind(dispatch_id)
    .bind(state.clock.now())
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "dispatch {dispatch_id} is missing or has already departed"
        )));
    }
    tx.commit().await?;
    Ok(())
}

/// One loaded koli onto the road. Asked again of a koli already on it, the
/// answer is the record of when it went.
pub(super) async fn koli_in_transit(
    state: &AppState,
    koli_id: Uuid,
    actor: &str,
) -> Result<FulfillmentProgressResult, AppError> {
    let actor = actor.trim().to_owned();
    if actor.is_empty() {
        return Err(AppError::Validation("actor is required".into()));
    }
    common::ensure_origin(&state.db).await?;
    let mut tx = state.db.begin().await?;
    let site = common::gudang_site_tx(&mut tx).await?;
    lock_outbound(&mut tx, &site).await?;
    let koli = load_koli_ref(&mut tx, koli_id).await?;
    let payload = match koli.stage {
        FulfillmentStage::InTransit => stage_record(&mut tx, koli_id, FulfillmentStage::InTransit)
            .await?
            .ok_or_else(|| {
                AppError::Conflict(format!("koli {koli_id} is in transit with no record of it"))
            })?,
        FulfillmentStage::Loaded => {
            let pieces = load_pieces(&mut tx, koli_id).await?;
            record_stage(
                &mut tx,
                &koli,
                &pieces,
                FulfillmentStage::InTransit,
                &actor,
                state.clock.now(),
            )
            .await?
        }
        other => {
            return Err(AppError::Conflict(format!(
                "package {koli_id} is {}, expected LOADED before IN_TRANSIT",
                other.as_str()
            )))
        }
    };
    tx.commit().await?;
    Ok(FulfillmentProgressResult {
        progress_id: payload.progress_id,
        koli_id: payload.koli_id,
        source_site_id: payload.source_site_id,
        destination_store_id: payload.destination_store_id,
        stage: payload.stage,
        shipment_reference: payload.shipment_reference,
        movement_group_id: payload.movement_group_id,
        actor_id: payload.actor_id,
        occurred_at: payload.occurred_at,
        units: payload.units,
    })
}

// ---------------------------------------------------------------------------
// The stage machinery
// ---------------------------------------------------------------------------

/// One rung, whole: the goods move in the ledger, the allotment lines' rung
/// rises, the koli's stage, and the record a DC server's fulfillment fact
/// leaves (`sync.rs` `apply_fulfillment_progress`) — the koli mirror, the
/// stage fact, and in transit the claims a shop's count pairs with and the
/// shop's announcement. Then the allotments' status and their flows.
async fn record_stage(
    tx: &mut Tx<'_>,
    koli: &KoliRef,
    pieces: &[Piece],
    stage: FulfillmentStage,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<FulfillmentProgressPayload, AppError> {
    if pieces.is_empty() {
        return Err(AppError::Conflict(format!(
            "koli {} has no pieces",
            koli.koli_number
        )));
    }
    let previous = stage.previous();
    let shipment_reference = match stage {
        FulfillmentStage::Packed => None,
        _ => Some(koli.shipment_reference.clone().ok_or_else(|| {
            AppError::Conflict(format!(
                "koli {} is on no surat jalan yet",
                koli.koli_number
            ))
        })?),
    };
    let from = place_of_role(
        tx,
        &koli.site_id,
        previous.map_or(PoolRole::Picking, role_of),
    )
    .await?;
    let to = place_of_role(tx, &koli.site_id, role_of(stage)).await?;

    let mut by_line: BTreeMap<Uuid, Vec<&Piece>> = BTreeMap::new();
    for piece in pieces {
        by_line
            .entry(piece.allotment_line_id)
            .or_default()
            .push(piece);
    }

    // 1. The goods move: one movement group per allotment line, because the
    //    ledger keeps outbound goods referenced to the line they answer.
    let mut groups: BTreeMap<Uuid, Uuid> = BTreeMap::new();
    for (line_id, line_pieces) in &by_line {
        if stage == FulfillmentStage::Packed {
            // What the line still wants, so a piece is never packed past it:
            // To Pack less the picked pieces MD gave up, which wait to go back
            // to the racks (0965) — the rest may be packed meanwhile (owner,
            // 10 Oct 2026: picked 30, now 20 → pack at most 20).
            let to_pack: Option<i64> = sqlx::query_scalar(
                "SELECT commitment.to_pack_qty - line.pick_owed_quantity
                   FROM allotment_line_commitment commitment
                   JOIN allotment_line line ON line.id = commitment.allotment_line_id
                  WHERE commitment.allotment_line_id = $1",
            )
            .bind(line_id)
            .fetch_optional(&mut **tx)
            .await?;
            if to_pack.unwrap_or(0) < i64::try_from(line_pieces.len()).unwrap_or(i64::MAX) {
                return Err(AppError::Conflict(format!(
                    "Allotment line {line_id} no longer wants goods"
                )));
            }
        }
        let group = move_pieces(
            tx,
            line_pieces,
            *line_id,
            &from,
            &to,
            MovementCause::NormalMove,
            &format!("dc-koli:{}:{}:{line_id}", koli.koli_id, stage.as_str()),
            &format!("Koli {} entered {}", koli.koli_number, stage.as_str()),
            actor,
            at,
        )
        .await?;
        groups.insert(*line_id, group);
    }

    // 2. The lines' rung. A cloud-run allotment keeps its rungs on its own
    //    lines (the commitment view reads them where no node reports).
    let column = match stage {
        FulfillmentStage::Packed => "packed_quantity",
        FulfillmentStage::Shipment => "shipment_quantity",
        // The LOADED rung (0176): on the truck, still on the yard.
        FulfillmentStage::Loaded => "dispatched_quantity",
        FulfillmentStage::InTransit => "in_transit_quantity",
    };
    for (line_id, line_pieces) in &by_line {
        let updated = sqlx::query(&format!(
            "UPDATE allotment_line SET {column} = {column} + $2, updated_at = $3 WHERE id = $1"
        ))
        .bind(line_id)
        .bind(i64::try_from(line_pieces.len()).unwrap_or(i64::MAX))
        .bind(at)
        .execute(&mut **tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(AppError::Conflict(format!(
                "Allotment line {line_id} cannot advance to {}",
                stage.as_str()
            )));
        }
    }

    // 3. The koli's own rung.
    if let Some(previous) = previous {
        let updated = sqlx::query(
            "UPDATE dc_koli SET stage = $2, updated_at = $3 WHERE koli_id = $1 AND stage = $4",
        )
        .bind(koli.koli_id)
        .bind(stage.as_str())
        .bind(at)
        .bind(previous.as_str())
        .execute(&mut **tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(AppError::Conflict(format!(
                "koli {} cannot advance to {}",
                koli.koli_number,
                stage.as_str()
            )));
        }
    }

    // 4. The record a DC server's fact leaves, under the cloud-run Gudang's
    //    own origin. Units sorted by EPC, as a fact carries them.
    let mut sorted: Vec<&Piece> = pieces.iter().collect();
    sorted.sort_by(|left, right| left.epc.cmp(&right.epc));
    let units: Vec<PackageUnitAllocation> = sorted
        .iter()
        .map(|piece| PackageUnitAllocation {
            allotment_id: piece.allotment_id,
            allotment_line_id: piece.allotment_line_id,
            sku_code: piece.sku_code.to_ascii_uppercase(),
            epc: piece.epc.clone(),
        })
        .collect();
    let first_group = groups
        .values()
        .next()
        .copied()
        .ok_or_else(|| AppError::Conflict("a koli rung moved nothing".into()))?;
    let event_id = Uuid::new_v4();
    let payload = FulfillmentProgressPayload {
        schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
        progress_id: event_id,
        koli_id: koli.koli_id,
        source_site_id: koli.site_id.clone(),
        destination_store_id: koli.wire_destination_id.clone(),
        koli_number: Some(koli.koli_number.clone()),
        stage,
        shipment_reference: shipment_reference.clone(),
        movement_group_id: first_group,
        actor_id: actor.to_owned(),
        occurred_at: at,
        units,
    };
    payload.validate().map_err(AppError::Validation)?;
    let seq = common::next_seq(tx).await?;
    mirror_koli(tx, &payload, seq).await?;
    sqlx::query(
        "INSERT INTO edge_fulfillment_progress_fact
             (event_id, origin_id, generation, seq, progress_id, koli_id, source_site_id,
              destination_store_id, stage, shipment_reference, movement_group_id, actor_id,
              occurred_at, units)
         VALUES ($1, $2, $3, $4, $1, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
    )
    .bind(event_id)
    .bind(common::CLOUD_DC_ORIGIN)
    .bind(common::CLOUD_DC_GENERATION)
    .bind(seq)
    .bind(koli.koli_id)
    .bind(&payload.source_site_id)
    .bind(&payload.destination_store_id)
    .bind(stage.as_str())
    .bind(&payload.shipment_reference)
    .bind(first_group)
    .bind(actor)
    .bind(at)
    .bind(serde_json::to_value(&payload.units)?)
    .execute(&mut **tx)
    .await?;
    // The units in one statement; unit_ordinal from the unnest's ordinality,
    // which numbers rows from 1 in array order, as the per-unit write did.
    let unit_epcs: Vec<String> = payload.units.iter().map(|unit| unit.epc.clone()).collect();
    let unit_skus: Vec<String> = payload
        .units
        .iter()
        .map(|unit| unit.sku_code.clone())
        .collect();
    let unit_allotments: Vec<Uuid> = payload.units.iter().map(|unit| unit.allotment_id).collect();
    let unit_lines: Vec<Uuid> = payload
        .units
        .iter()
        .map(|unit| unit.allotment_line_id)
        .collect();
    sqlx::query(
        "INSERT INTO edge_fulfillment_progress_unit
             (progress_event_id, koli_id, unit_ordinal, epc, sku_code,
              allotment_id, allotment_line_id)
         SELECT $1, $2, unit.ordinal, unit.epc, unit.sku_code,
                unit.allotment_id, unit.allotment_line_id
           FROM unnest($3::text[], $4::text[], $5::uuid[], $6::uuid[])
                WITH ORDINALITY
                AS unit(epc, sku_code, allotment_id, allotment_line_id, ordinal)",
    )
    .bind(event_id)
    .bind(koli.koli_id)
    .bind(&unit_epcs)
    .bind(&unit_skus)
    .bind(&unit_allotments)
    .bind(&unit_lines)
    .execute(&mut **tx)
    .await?;

    // 5. On the road: one claim per piece for the shop's count to pair with
    //    (what a DC server sends as `TransferClaim` IN_TRANSIT), and the
    //    shop's blind-count announcement — the applier's own function, so the
    //    shop's node is told exactly as it is told of a DC server's koli.
    if stage == FulfillmentStage::InTransit {
        // One claim per piece for the shop's count to pair with, in one
        // statement; the claims' seqs taken in one round trip, in unit order
        // (row i of generate_series for unit i), where each claim took its
        // own nextval before its insert.
        let claim_seqs: Vec<i64> =
            sqlx::query_scalar("SELECT nextval('cloud_dc_record_seq') FROM generate_series(1, $1)")
                .bind(i64::try_from(payload.units.len()).unwrap_or(i64::MAX))
                .fetch_all(&mut **tx)
                .await?;
        let claim_events: Vec<Uuid> = payload.units.iter().map(|_| Uuid::new_v4()).collect();
        let claim_groups: Vec<Uuid> = payload
            .units
            .iter()
            .map(|unit| {
                groups
                    .get(&unit.allotment_line_id)
                    .copied()
                    .unwrap_or(first_group)
            })
            .collect();
        sqlx::query(
            "INSERT INTO edge_transfer_claim
                 (event_id, origin_id, owner_site_id, owner_node_role, generation, seq,
                  claim_kind, source_dc_id, destination_store_id, shipment_reference,
                  epc, quantity, sku_code, movement_group_id, receipt_id, occurred_at,
                  in_transit_progress_event_id, in_transit_unit_ordinal)
             SELECT claim.event_id, $2, $3, 'DC', $4, claim.seq, 'IN_TRANSIT', $3, $5, $6,
                    claim.epc, 1, claim.sku_code, claim.movement_group_id, NULL, $7, $1,
                    claim.ordinal
               FROM unnest($8::uuid[], $9::bigint[], $10::text[], $11::text[], $12::uuid[])
                    WITH ORDINALITY
                    AS claim(event_id, seq, epc, sku_code, movement_group_id, ordinal)",
        )
        .bind(event_id)
        .bind(common::CLOUD_DC_ORIGIN)
        .bind(&koli.site_id)
        .bind(common::CLOUD_DC_GENERATION)
        .bind(&payload.destination_store_id)
        .bind(&payload.shipment_reference)
        .bind(at)
        .bind(&claim_events)
        .bind(&claim_seqs)
        .bind(&unit_epcs)
        .bind(&unit_skus)
        .bind(&claim_groups)
        .execute(&mut **tx)
        .await?;
        crate::cloud::postgres::announce_store_inbound_tx(tx, &payload).await?;
    }

    // 6. The allotments' status, and their flows to this shop.
    let allotments: BTreeSet<Uuid> = pieces.iter().map(|piece| piece.allotment_id).collect();
    let flow_stage = match stage {
        FulfillmentStage::Packed => StageKind::Pack,
        FulfillmentStage::Shipment => StageKind::Ship,
        FulfillmentStage::Loaded => StageKind::Load,
        FulfillmentStage::InTransit => StageKind::Depart,
    };
    let fact = NodeFact {
        origin_id: common::CLOUD_DC_ORIGIN,
        event_type: INVENTORY_FULFILLMENT_PROGRESS_V1,
        event_id,
        stage: flow_stage,
        actor_id: Some(actor),
    };
    for allotment_id in allotments {
        refresh_allotment_status(tx, allotment_id, at).await?;
        let source = FlowSource {
            kind: SourceKind::Allotment,
            id: allotment_id.to_string(),
        };
        resume_from_node_fact_tx(
            tx,
            &source,
            Some(koli.destination_store_id.as_str()),
            &fact,
            at,
        )
        .await?;
    }
    Ok(payload)
}

/// The koli as the centre's mirror holds a DC server's (`edge_koli`,
/// `edge_koli_unit`): what the surat jalan letter and the goods-in-transit
/// report read.
async fn mirror_koli(
    tx: &mut Tx<'_>,
    payload: &FulfillmentProgressPayload,
    seq: i64,
) -> Result<(), AppError> {
    let at = payload.occurred_at;
    match payload.stage.previous() {
        None => {
            sqlx::query(
                "INSERT INTO edge_koli
                     (koli_id, origin_id, source_site_id, destination_store_id, status,
                      shipment_reference, created_at, updated_at, last_generation, last_seq,
                      koli_number)
                 VALUES ($1, $2, $3, $4, 'PACKED', NULL, $5, $5, $6, $7, $8)",
            )
            .bind(payload.koli_id)
            .bind(common::CLOUD_DC_ORIGIN)
            .bind(&payload.source_site_id)
            .bind(&payload.destination_store_id)
            .bind(at)
            .bind(common::CLOUD_DC_GENERATION)
            .bind(seq)
            .bind(&payload.koli_number)
            .execute(&mut **tx)
            .await?;
            for unit in &payload.units {
                // A piece packed again is out of whatever box carried it
                // before (the DC server's box it once arrived in, a shop's
                // return box): one active box per tag.
                sqlx::query(
                    "UPDATE edge_koli_unit SET released_at = $2, updated_at = $2
                      WHERE epc = $1 AND released_at IS NULL AND koli_id <> $3",
                )
                .bind(&unit.epc)
                .bind(at)
                .bind(payload.koli_id)
                .execute(&mut **tx)
                .await?;
                sqlx::query(
                    "INSERT INTO edge_koli_unit
                         (koli_id, epc, sku_code, allotment_id, allotment_line_id,
                          current_stage, stage_rank, packed_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, 'PACKED', 2, $6, $6)",
                )
                .bind(payload.koli_id)
                .bind(&unit.epc)
                .bind(&unit.sku_code)
                .bind(unit.allotment_id)
                .bind(unit.allotment_line_id)
                .bind(at)
                .execute(&mut **tx)
                .await?;
            }
        }
        Some(previous) => {
            let stamp = match payload.stage {
                FulfillmentStage::Shipment => "shipment_at",
                FulfillmentStage::Loaded => "dispatched_at",
                _ => "in_transit_at",
            };
            sqlx::query(&format!(
                "UPDATE edge_koli_unit
                    SET current_stage = $2, stage_rank = $3, {stamp} = $4, updated_at = $4
                  WHERE koli_id = $1 AND current_stage = $5 AND released_at IS NULL"
            ))
            .bind(payload.koli_id)
            .bind(payload.stage.as_str())
            .bind(payload.stage.rank())
            .bind(at)
            .bind(previous.as_str())
            .execute(&mut **tx)
            .await?;
            sqlx::query(
                "UPDATE edge_koli
                    SET status = $2, shipment_reference = $3, updated_at = $4,
                        last_generation = $5, last_seq = $6,
                        koli_number = COALESCE($7, koli_number)
                  WHERE koli_id = $1 AND status = $8",
            )
            .bind(payload.koli_id)
            .bind(payload.stage.as_str())
            .bind(&payload.shipment_reference)
            .bind(at)
            .bind(common::CLOUD_DC_GENERATION)
            .bind(seq)
            .bind(&payload.koli_number)
            .bind(previous.as_str())
            .execute(&mut **tx)
            .await?;
        }
    }
    Ok(())
}

/// Move a line's pieces from one place to another as one movement group,
/// referenced to the line. Returns the group's id.
#[allow(clippy::too_many_arguments)]
pub(in crate::cloud::dc) async fn move_pieces(
    tx: &mut Tx<'_>,
    pieces: &[&Piece],
    allotment_line_id: Uuid,
    from: &str,
    to: &str,
    cause: MovementCause,
    key: &str,
    reason: &str,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<Uuid, AppError> {
    let from_place: Place = from
        .parse()
        .map_err(|error: crate::cloud::domain::PlaceError| {
            AppError::Validation(error.to_string())
        })?;
    let to_place: Place = to
        .parse()
        .map_err(|error: crate::cloud::domain::PlaceError| {
            AppError::Validation(error.to_string())
        })?;
    let command = MovementCommand {
        movement_group_id: MovementGroupId::new(),
        lines: pieces
            .iter()
            .map(|piece| MovementLine {
                subject_id: SubjectId(piece.subject_id),
                quantity: 1,
                from: from_place.clone(),
                to: to_place.clone(),
            })
            .collect(),
        cause,
        reference_type: Some("ALLOTMENT_LINE".into()),
        reference_id: Some(allotment_line_id.to_string()),
        reason: reason.to_owned(),
        actor_id: actor.to_owned(),
        occurred_at: at,
    };
    // The centre's rules are checked for every move the centre has always
    // made. Letting go of a piece a shop counted in (HANDED_OVER) is a move
    // only a warehouse makes, and here the cloud is the warehouse: it is the
    // DC server's own release (`edge::sync` `apply_in_transit_release`).
    if cause != MovementCause::HandedOver {
        crate::cloud::domain::validate_command(&command)
            .map_err(|error| AppError::Validation(error.to_string()))?;
    }
    crate::cloud::postgres::insert_group(tx, &command, key, key).await?;
    crate::cloud::postgres::apply_lines(tx, &command, key, key).await?;
    Ok(command.movement_group_id.0)
}

async fn load_koli_ref(tx: &mut Tx<'_>, koli_id: Uuid) -> Result<KoliRef, AppError> {
    let row = sqlx::query(
        "SELECT k.koli_number, k.site_id, k.destination_store_id, k.wire_destination_id,
                k.stage, s.shipment_number
           FROM dc_koli k
           LEFT JOIN dc_shipment s ON s.shipment_id = k.shipment_id
          WHERE k.koli_id = $1
            FOR UPDATE OF k",
    )
    .bind(koli_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("koli {koli_id}")))?;
    Ok(KoliRef {
        koli_id,
        koli_number: row.try_get("koli_number")?,
        site_id: row.try_get("site_id")?,
        destination_store_id: row.try_get("destination_store_id")?,
        wire_destination_id: row.try_get("wire_destination_id")?,
        stage: parse_stage(&row.try_get::<String, _>("stage")?)?,
        shipment_reference: row.try_get("shipment_number")?,
    })
}

async fn load_pieces(tx: &mut Tx<'_>, koli_id: Uuid) -> Result<Vec<Piece>, AppError> {
    sqlx::query(
        "SELECT subject_id, epc, sku_code, allotment_id, allotment_line_id
           FROM dc_koli_unit WHERE koli_id = $1 ORDER BY epc",
    )
    .bind(koli_id)
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
    .collect()
}

/// The record of a koli's rung, as it was written.
async fn stage_record(
    tx: &mut Tx<'_>,
    koli_id: Uuid,
    stage: FulfillmentStage,
) -> Result<Option<FulfillmentProgressPayload>, AppError> {
    let Some(row) = sqlx::query(
        "SELECT event_id, source_site_id, destination_store_id, shipment_reference,
                movement_group_id, actor_id, occurred_at, units
           FROM edge_fulfillment_progress_fact
          WHERE koli_id = $1 AND stage = $2",
    )
    .bind(koli_id)
    .bind(stage.as_str())
    .fetch_optional(&mut **tx)
    .await?
    else {
        return Ok(None);
    };
    let koli_number: Option<String> =
        sqlx::query_scalar("SELECT koli_number FROM dc_koli WHERE koli_id = $1")
            .bind(koli_id)
            .fetch_optional(&mut **tx)
            .await?;
    Ok(Some(FulfillmentProgressPayload {
        schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
        progress_id: row.try_get("event_id")?,
        koli_id,
        source_site_id: row.try_get("source_site_id")?,
        destination_store_id: row.try_get("destination_store_id")?,
        koli_number,
        stage,
        shipment_reference: row.try_get("shipment_reference")?,
        movement_group_id: row.try_get("movement_group_id")?,
        actor_id: row.try_get("actor_id")?,
        occurred_at: row.try_get("occurred_at")?,
        units: serde_json::from_value(row.try_get("units")?)?,
    }))
}

/// A cloud-run allotment's status, from the commitment view (as
/// `execute_allotment` writes it).
pub(crate) async fn refresh_allotment_status(
    tx: &mut Tx<'_>,
    allotment_id: Uuid,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let stored: Option<String> =
        sqlx::query_scalar("SELECT status FROM allotment_commitment WHERE allotment_id = $1")
            .bind(allotment_id)
            .fetch_optional(&mut **tx)
            .await?;
    let Some(stored) = stored else {
        return Ok(());
    };
    let status = AllotmentStatus::from(FulfillmentStatus::from_legacy(&stored));
    sqlx::query(
        "UPDATE allotment SET status = $2, updated_at = $3
          WHERE id = $1 AND activation_target_origin_id IS NULL AND status IS DISTINCT FROM $2",
    )
    .bind(allotment_id)
    .bind(status.as_str())
    .bind(at)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// The shop counted it in
// ---------------------------------------------------------------------------

/// A shop's count of one piece, against the in-transit claim the cloud-run
/// Gudang wrote for it (called from `sync.rs`
/// `reconcile_transfer_allotment_attribution` when the in-transit side is
/// [`common::CLOUD_DC_ORIGIN`]).
///
/// Where a DC server is told to let go (the in-transit release), the cloud
/// lets go itself: the piece leaves the Gudang's In Transit pool for
/// `system/handed_over`, as on the DC server, and the allotment line's
/// handed-over and received rungs rise. `pair` is the matched (in-transit,
/// receipt) claim pair, `None` when the claims under this key are not one
/// exact pair — then any earlier match is taken back, as for a DC server's
/// (the piece stays let go: a release is never undone there either).
pub(crate) async fn reconcile_counted_in_tx(
    tx: &mut Tx<'_>,
    source_dc_id: &str,
    destination_store_id: &str,
    shipment_reference: &str,
    epc: &str,
    pair: Option<(Uuid, Uuid)>,
) -> Result<(), AppError> {
    let mut touched_lines: BTreeSet<Uuid> = BTreeSet::new();
    let mut touched_allotments: BTreeSet<Uuid> = BTreeSet::new();
    match pair {
        Some((in_transit_event_id, receipt_event_id)) => {
            let existing: Option<Uuid> = sqlx::query_scalar(
                "SELECT in_transit_event_id FROM edge_transfer_allotment_attribution
                  WHERE receipt_event_id = $1 FOR UPDATE",
            )
            .bind(receipt_event_id)
            .fetch_optional(&mut **tx)
            .await?;
            if let Some(existing) = existing {
                if existing != in_transit_event_id {
                    return Err(AppError::Conflict(
                        "receipt attribution cannot be rewritten to another fulfillment unit"
                            .into(),
                    ));
                }
                return Ok(());
            }
            let unit = sqlx::query(
                "SELECT unit.koli_id, unit.allotment_id, unit.allotment_line_id, unit.epc,
                        receipt.occurred_at AS received_at
                   FROM edge_transfer_claim claim
                   JOIN edge_fulfillment_progress_unit unit
                     ON unit.progress_event_id = claim.in_transit_progress_event_id
                    AND unit.unit_ordinal = claim.in_transit_unit_ordinal
                    AND unit.epc = claim.epc AND unit.sku_code = claim.sku_code
                   JOIN edge_transfer_claim receipt ON receipt.event_id = $2
                  WHERE claim.event_id = $1 AND claim.claim_kind = 'IN_TRANSIT'",
            )
            .bind(in_transit_event_id)
            .bind(receipt_event_id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| {
                AppError::Conflict(
                    "matched In-Transit claim has no immutable fulfillment unit".into(),
                )
            })?;
            let koli_id: Uuid = unit.try_get("koli_id")?;
            let allotment_id: Uuid = unit.try_get("allotment_id")?;
            let allotment_line_id: Uuid = unit.try_get("allotment_line_id")?;
            let unit_epc: String = unit.try_get("epc")?;
            let received_at: DateTime<Utc> = unit.try_get("received_at")?;
            // Nothing to send anybody: no release origin.
            sqlx::query(
                "INSERT INTO edge_transfer_allotment_attribution
                     (receipt_event_id, in_transit_event_id, koli_id, allotment_id,
                      allotment_line_id, epc)
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(receipt_event_id)
            .bind(in_transit_event_id)
            .bind(koli_id)
            .bind(allotment_id)
            .bind(allotment_line_id)
            .bind(&unit_epc)
            .execute(&mut **tx)
            .await?;
            let_go(
                tx,
                allotment_line_id,
                &unit_epc,
                receipt_event_id,
                destination_store_id,
                received_at,
            )
            .await?;
            touched_lines.insert(allotment_line_id);
            touched_allotments.insert(allotment_id);
        }
        None => {
            let removed = sqlx::query(
                "DELETE FROM edge_transfer_allotment_attribution attribution
                  USING edge_transfer_claim receipt
                  WHERE attribution.receipt_event_id = receipt.event_id
                    AND receipt.claim_kind = 'RECEIVED'
                    AND receipt.source_dc_id = $1
                    AND receipt.destination_store_id = $2
                    AND receipt.shipment_reference = $3
                    AND receipt.epc = $4
                 RETURNING attribution.allotment_id, attribution.allotment_line_id",
            )
            .bind(source_dc_id)
            .bind(destination_store_id)
            .bind(shipment_reference)
            .bind(epc)
            .fetch_all(&mut **tx)
            .await?;
            for row in removed {
                touched_allotments.insert(row.try_get("allotment_id")?);
                touched_lines.insert(row.try_get("allotment_line_id")?);
            }
        }
    }

    for allotment_line_id in touched_lines {
        let received: i64 = sqlx::query_scalar(
            "SELECT count(*)::bigint FROM edge_transfer_allotment_attribution
              WHERE allotment_line_id = $1",
        )
        .bind(allotment_line_id)
        .fetch_one(&mut **tx)
        .await?;
        let in_transit: i64 = sqlx::query_scalar(
            "SELECT in_transit_quantity FROM allotment_line WHERE id = $1 FOR UPDATE",
        )
        .bind(allotment_line_id)
        .fetch_one(&mut **tx)
        .await?;
        if received > in_transit {
            return Err(AppError::Conflict(
                "derived Store receipt quantity exceeds In-Transit quantity".into(),
            ));
        }
        // Custody passes at the door; never lowered, as for a DC server's.
        sqlx::query(
            "UPDATE allotment_line
                SET received_quantity = $2,
                    handed_over_quantity = GREATEST(handed_over_quantity, $2),
                    updated_at = now()
              WHERE id = $1",
        )
        .bind(allotment_line_id)
        .bind(received)
        .execute(&mut **tx)
        .await?;
    }
    for allotment_id in touched_allotments {
        sqlx::query("SELECT id FROM allotment WHERE id = $1 FOR UPDATE")
            .bind(allotment_id)
            .fetch_one(&mut **tx)
            .await?;
        refresh_allotment_status(tx, allotment_id, Utc::now()).await?;
    }
    Ok(())
}

/// Out of the Gudang's In Transit pool to `system/handed_over`: the shop has
/// it. A piece no longer standing there (already let go, or booked Missing on
/// the road) is passed over, never an error that would stop the shop's
/// stream — the DC server records the same as NOT_IN_TRANSIT.
async fn let_go(
    tx: &mut Tx<'_>,
    allotment_line_id: Uuid,
    epc: &str,
    receipt_event_id: Uuid,
    destination: &str,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let site = common::gudang_site_tx(tx).await?;
    let in_transit = place_of_role(tx, &site, PoolRole::InTransit).await?;
    let Some(subject_id) =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM inventory_subject WHERE upper(epc) = $1")
            .bind(epc.to_ascii_uppercase())
            .fetch_optional(&mut **tx)
            .await?
    else {
        return Ok(());
    };
    let held: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(CASE WHEN to_place_id = $2 THEN quantity ELSE -quantity END), 0)::bigint
           FROM movement
          WHERE subject_id = $1 AND (to_place_id = $2 OR from_place_id = $2)",
    )
    .bind(subject_id)
    .bind(&in_transit)
    .fetch_one(&mut **tx)
    .await?;
    if held < 1 {
        return Ok(());
    }
    let piece = Piece {
        subject_id,
        epc: epc.to_owned(),
        sku_code: String::new(),
        allotment_id: Uuid::nil(),
        allotment_line_id,
    };
    move_pieces(
        tx,
        &[&piece],
        allotment_line_id,
        &in_transit,
        "system/handed_over",
        MovementCause::HandedOver,
        &format!("dc-handed-over:{receipt_event_id}"),
        &format!("Counted in at {destination}; custody passed"),
        "system:in-transit-release",
        at,
    )
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Small things
// ---------------------------------------------------------------------------

/// One packer or one trip at a time per Gudang: a piece is never put in two
/// boxes, a carton never on two trucks. A move back takes the same lock.
pub(in crate::cloud::dc) async fn lock_outbound(
    tx: &mut Tx<'_>,
    site: &str,
) -> Result<(), AppError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("dc-outbound:{site}"))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// A pool of the Gudang by its role, as a place in the ledger.
pub(in crate::cloud::dc) async fn place_of_role(
    tx: &mut Tx<'_>,
    site: &str,
    role: PoolRole,
) -> Result<String, AppError> {
    let pool = crate::cloud::postgres::sites::pool_of_role(&mut **tx, site, role)
        .await?
        .ok_or_else(|| AppError::Conflict(format!("{site} has no {} pool", role.label())))?;
    Ok(format!("{pool}:on_hand"))
}

const fn role_of(stage: FulfillmentStage) -> PoolRole {
    match stage {
        FulfillmentStage::Packed => PoolRole::Packed,
        FulfillmentStage::Shipment => PoolRole::Shipment,
        FulfillmentStage::Loaded => PoolRole::Loaded,
        FulfillmentStage::InTransit => PoolRole::InTransit,
    }
}

const fn next_stage(stage: FulfillmentStage) -> FulfillmentStage {
    match stage {
        FulfillmentStage::Packed => FulfillmentStage::Shipment,
        FulfillmentStage::Shipment => FulfillmentStage::Loaded,
        FulfillmentStage::Loaded | FulfillmentStage::InTransit => FulfillmentStage::InTransit,
    }
}

fn parse_stage(stored: &str) -> Result<FulfillmentStage, AppError> {
    match stored {
        "PACKED" => Ok(FulfillmentStage::Packed),
        "SHIPMENT" => Ok(FulfillmentStage::Shipment),
        "LOADED" => Ok(FulfillmentStage::Loaded),
        "IN_TRANSIT" => Ok(FulfillmentStage::InTransit),
        other => Err(AppError::Conflict(format!("unknown koli stage {other}"))),
    }
}

/// A koli number as the DC server prints it: the year's letter and a serial
/// (`A00001`), the year read at the Gudang's own offset so a carton sealed on
/// New Year's Eve in Jakarta is numbered in the year it was sealed there.
async fn next_koli_number(
    tx: &mut Tx<'_>,
    site: &str,
    at: DateTime<Utc>,
) -> Result<String, AppError> {
    let offset =
        crate::cloud::postgres::sites::business_utc_offset_minutes(&mut **tx, Some(site), at)
            .await?;
    let year = (at + chrono::Duration::minutes(i64::from(offset))).year();
    // Refused before a number is taken: a year with no letter takes none.
    crate::edge::outbound::koli_year_letter(year).map_err(edge_error)?;
    let serial = common::next_number(tx, site, "KOLI", year).await?;
    crate::edge::outbound::format_koli_number(year, serial).map_err(edge_error)
}

/// A surat jalan or truck-run number as the DC server prints it:
/// `SJ-HO-GUDANG-000045`, the site's display code, never its id.
async fn next_paper_number(
    tx: &mut Tx<'_>,
    site: &str,
    prefix: &str,
    series: &str,
) -> Result<String, AppError> {
    let number = common::next_number(tx, site, series, RUNNING_SERIES_YEAR).await?;
    let code = common::site_code_tx(tx, site).await?;
    Ok(format!("{prefix}-{code}-{number:06}"))
}
