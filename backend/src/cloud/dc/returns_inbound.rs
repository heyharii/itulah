//! A shop's return, received blind at the Gudang (`/api/v1/dc/inbound*`).
//!
//! The DC server's rules (`edge::inbound`, `SqliteEdge::receive_store_inbound`)
//! are the specification:
//!
//! - **blind**: while a delivery is in transit only its koli count is shown —
//!   no expected quantity, no tag, no per-SKU count;
//! - **one receipt**: a delivery is received once; the same sweep sent again
//!   is a resend, a different one is refused;
//! - a manifest tag that was read is booked into the shop's return pool here
//!   (its stockroom when the shop has none); a tag read that no koli held but
//!   that decodes to a SKU is booked too, as an extra; a tag already standing
//!   somewhere in the ledger, or one that is not ours, is skipped and said so;
//!   a manifest tag not read is MISSING and stays in transit at the shop.
//!
//! Where the DC server's receipt went up as facts, the same records are
//! written here by the appliers those facts reached: a RECEIVED claim per
//! booked piece (pairing with the shop's IN_TRANSIT claim releases the piece
//! at the shop's node — `reconcile_transfer_allotment_attribution`), and the
//! delivery as one receipt for the flow (`flow_stages::apply_inbound_received_tx`).

use super::{
    actor_of, hosted, lock_document, normalized_epc, require_key, site_pool_tx, unit_subject_tx,
    write_movement,
};
use crate::cloud::dc::common;
use crate::cloud::domain::{
    InventoryState, MovementCause, MovementCommand, MovementGroupId, MovementLine, OperationalPool,
    Place, SubjectId, SystemPlace,
};
use crate::cloud::http::auth::Principal;
use crate::cloud::{AppError, AppState};
use crate::edge::inbound::{
    StoreInboundCountRequest, StoreInboundDelivery, StoreInboundDetail, StoreInboundLine,
    StoreInboundList, StoreInboundReceiveRequest, StoreInboundResult, STATUS_IN_TRANSIT,
    STATUS_RECEIVED, STORE_INBOUND_LIST_LIMIT, STORE_INBOUND_MAX_EPCS,
};
use crate::sync::flow::{InboundReceivedLine, InboundReceivedPayload, FLOW_FACT_SCHEMA_VERSION};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::{PgConnection, Row};
use std::collections::{BTreeMap, BTreeSet};
use std::str::FromStr;
use uuid::Uuid;

/// At most a thousand lines per movement group, as the DC server books them.
const CHUNK: usize = 1000;

#[derive(Deserialize)]
pub(super) struct StatusQuery {
    #[serde(default)]
    status: Option<String>,
}

/// `?status=IN_TRANSIT|RECEIVED|ALL` → the status to filter on.
fn parse_status(value: Option<&str>) -> Result<Option<&'static str>, AppError> {
    match value.map(|value| value.trim().to_ascii_uppercase()).as_deref() {
        None | Some("") | Some("ALL") => Ok(None),
        Some(STATUS_IN_TRANSIT) => Ok(Some(STATUS_IN_TRANSIT)),
        Some(STATUS_RECEIVED) => Ok(Some(STATUS_RECEIVED)),
        Some(other) => Err(AppError::Validation(format!(
            "status must be IN_TRANSIT, RECEIVED or ALL, not {other}"
        ))),
    }
}

/// Every delivery on its way here or received, one row each: the koli as the
/// shops' facts announce them, the receipt where there is one. The result
/// columns are only read for a received delivery — blind otherwise.
const DELIVERIES: &str = "
WITH koli AS (
    SELECT delivery_id,
           min(source_site_id) AS source_site_id,
           min(shipment_reference) AS shipment_reference,
           max(departed_at) AS departed_at,
           count(DISTINCT koli_id)::bigint AS koli_count
      FROM dc_inbound_koli
     WHERE ($1::text IS NULL OR delivery_id = $1)
     GROUP BY delivery_id
), delivery AS (
    SELECT k.delivery_id,
           COALESCE(r.source_site_id, k.source_site_id) AS source_site_id,
           COALESCE(r.shipment_reference, k.shipment_reference) AS shipment_reference,
           COALESCE(r.departed_at, k.departed_at) AS departed_at,
           CASE WHEN r.delivery_id IS NULL THEN 'IN_TRANSIT' ELSE 'RECEIVED' END AS status,
           COALESCE(r.koli_count, k.koli_count) AS koli_count,
           r.received_at, r.received_by, r.skipped_epcs
      FROM koli k
      LEFT JOIN dc_inbound_receipt r ON r.delivery_id = k.delivery_id
)
SELECT d.*,
       tally.expected, tally.received, tally.missing, tally.extra
  FROM delivery d
  LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE u.outcome <> 'EXTRA')::bigint AS expected,
             count(*) FILTER (WHERE u.outcome = 'RECEIVED')::bigint AS received,
             count(*) FILTER (WHERE u.outcome = 'MISSING')::bigint AS missing,
             count(*) FILTER (WHERE u.outcome = 'EXTRA')::bigint AS extra
        FROM dc_inbound_unit u
       WHERE u.delivery_id = d.delivery_id
  ) tally ON d.status = 'RECEIVED'
 WHERE ($2::text IS NULL OR d.status = $2)
 ORDER BY d.departed_at DESC, d.delivery_id
 LIMIT $3";

fn delivery_from(row: &sqlx::postgres::PgRow) -> Result<StoreInboundDelivery, AppError> {
    let status: String = row.try_get("status")?;
    // Blind: nothing about the manifest's contents leaves here while the
    // delivery is in transit.
    let result = if status == STATUS_RECEIVED {
        Some(StoreInboundResult {
            expected_units: row.try_get::<Option<i64>, _>("expected")?.unwrap_or(0),
            received_units: row.try_get::<Option<i64>, _>("received")?.unwrap_or(0),
            missing_units: row.try_get::<Option<i64>, _>("missing")?.unwrap_or(0),
            extra_units: row.try_get::<Option<i64>, _>("extra")?.unwrap_or(0),
        })
    } else {
        None
    };
    Ok(StoreInboundDelivery {
        delivery_id: row.try_get("delivery_id")?,
        shipment_reference: row.try_get("shipment_reference")?,
        source_site_id: row.try_get("source_site_id")?,
        departed_at: row.try_get("departed_at")?,
        status,
        koli_count: row.try_get("koli_count")?,
        received_at: row.try_get("received_at")?,
        received_by: row.try_get("received_by")?,
        result,
    })
}

async fn load_list(
    conn: &mut PgConnection,
    status: Option<&str>,
) -> Result<StoreInboundList, AppError> {
    let rows = sqlx::query(DELIVERIES)
        .bind(None::<String>)
        .bind(status)
        .bind(STORE_INBOUND_LIST_LIMIT)
        .fetch_all(&mut *conn)
        .await?;
    let deliveries = rows
        .iter()
        .map(delivery_from)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(StoreInboundList { deliveries })
}

/// One delivery; its comparison per SKU only once received.
async fn load_detail(
    conn: &mut PgConnection,
    delivery_id: &str,
) -> Result<StoreInboundDetail, AppError> {
    let row = sqlx::query(DELIVERIES)
        .bind(delivery_id)
        .bind(None::<String>)
        .bind(1_i64)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("inbound delivery {delivery_id}")))?;
    let delivery = delivery_from(&row)?;
    if delivery.status != STATUS_RECEIVED {
        return Ok(StoreInboundDetail {
            delivery,
            lines: Vec::new(),
            skipped_epcs: Vec::new(),
        });
    }
    let skipped_epcs: Vec<String> = row
        .try_get::<Option<serde_json::Value>, _>("skipped_epcs")?
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_default();

    #[derive(Default)]
    struct Tally {
        expected: i64,
        received: i64,
        missing: i64,
        missing_epcs: BTreeSet<String>,
        extra_epcs: BTreeSet<String>,
    }
    let units = sqlx::query(
        "SELECT sku_code, epc, outcome FROM dc_inbound_unit WHERE delivery_id = $1",
    )
    .bind(delivery_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut by_sku: BTreeMap<String, Tally> = BTreeMap::new();
    for unit in &units {
        let sku_code: String = unit.try_get("sku_code")?;
        let epc: String = unit.try_get("epc")?;
        let outcome: String = unit.try_get("outcome")?;
        let tally = by_sku.entry(sku_code).or_default();
        match outcome.as_str() {
            "RECEIVED" => {
                tally.expected += 1;
                tally.received += 1;
            }
            "MISSING" => {
                tally.expected += 1;
                tally.missing += 1;
                tally.missing_epcs.insert(epc);
            }
            _ => {
                tally.extra_epcs.insert(epc);
            }
        }
    }
    let codes: Vec<String> = by_sku.keys().cloned().collect();
    let names: BTreeMap<String, String> = sqlx::query(
        "SELECT upper(sku.sku_code) AS sku_code, article.name
           FROM sku JOIN article ON article.id = sku.article_id
          WHERE upper(sku.sku_code) = ANY($1)",
    )
    .bind(&codes)
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .map(|row| (row.get("sku_code"), row.get("name")))
    .collect();
    let lines = by_sku
        .into_iter()
        .map(|(sku_code, tally)| StoreInboundLine {
            name: names.get(&sku_code).cloned(),
            expected: tally.expected,
            received: tally.received,
            missing: tally.missing,
            extra: tally.extra_epcs.len() as i64,
            missing_epcs: tally.missing_epcs.into_iter().collect(),
            extra_epcs: tally.extra_epcs.into_iter().collect(),
            sku_code,
        })
        .collect();
    Ok(StoreInboundDetail {
        delivery,
        lines,
        skipped_epcs,
    })
}

/// What is on its way to the Gudang, and what it has received.
pub(super) async fn list(
    State(state): State<AppState>,
    Query(query): Query<StatusQuery>,
) -> Result<Json<StoreInboundList>, AppError> {
    hosted()?;
    let status = parse_status(query.status.as_deref())?;
    let mut conn = state.db.acquire().await?;
    Ok(Json(load_list(&mut *conn, status).await?))
}

/// One delivery; its per-SKU comparison only once received.
pub(super) async fn detail(
    State(state): State<AppState>,
    Path(delivery_id): Path<String>,
) -> Result<Json<StoreInboundDetail>, AppError> {
    hosted()?;
    let mut conn = state.db.acquire().await?;
    Ok(Json(load_detail(&mut *conn, delivery_id.trim()).await?))
}

/// Receive a delivery from what the handheld swept.
pub(super) async fn receive(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(delivery_id): Path<String>,
    Json(request): Json<StoreInboundReceiveRequest>,
) -> Result<Json<StoreInboundDetail>, AppError> {
    hosted()?;
    let actor = actor_of(&principal)?;
    let key = require_key(&request.idempotency_key)?;
    let detail = receive_epcs(
        &state,
        delivery_id.trim(),
        &request.epcs,
        &actor,
        &key,
    )
    .await?;
    Ok(Json(detail))
}

/// Receive without a reader: a blind count per SKU becomes that many of the
/// delivery's own manifest pieces of the SKU, chosen in tag order and never by
/// outcome — so a retry resolves the same tags — and then the ordinary
/// receipt. A count above what was sent books what was sent.
pub(super) async fn receive_count(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(delivery_id): Path<String>,
    Json(request): Json<StoreInboundCountRequest>,
) -> Result<Json<StoreInboundDetail>, AppError> {
    hosted()?;
    let actor = actor_of(&principal)?;
    let key = require_key(&request.idempotency_key)?;
    let delivery_id = delivery_id.trim().to_owned();
    let mut counts: BTreeMap<String, i64> = BTreeMap::new();
    for line in &request.counts {
        let sku_code = line.sku_code.trim().to_ascii_uppercase();
        if sku_code.is_empty() {
            return Err(AppError::Validation("sku_code is required".into()));
        }
        if line.quantity < 0 {
            return Err(AppError::Validation(format!(
                "the count for {sku_code} cannot be negative"
            )));
        }
        *counts.entry(sku_code).or_default() += line.quantity;
    }
    let known: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM dc_inbound_koli WHERE delivery_id = $1)",
    )
    .bind(&delivery_id)
    .fetch_one(&state.db)
    .await?;
    if !known {
        return Err(AppError::NotFound(format!("inbound delivery {delivery_id}")));
    }
    let mut epcs = Vec::new();
    for (sku_code, quantity) in &counts {
        if *quantity == 0 {
            continue;
        }
        let found: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT unit.epc
               FROM dc_inbound_koli koli
               JOIN edge_fulfillment_progress_unit unit ON unit.progress_event_id = koli.event_id
              WHERE koli.delivery_id = $1 AND upper(unit.sku_code) = $2
              ORDER BY unit.epc
              LIMIT $3",
        )
        .bind(&delivery_id)
        .bind(sku_code)
        .bind(quantity)
        .fetch_all(&state.db)
        .await?;
        epcs.extend(found);
    }
    if epcs.is_empty() {
        return Err(AppError::Validation(
            "nothing counted matches this delivery; count what came off the lorry".into(),
        ));
    }
    let detail = receive_epcs(&state, &delivery_id, &epcs, &actor, &key).await?;
    Ok(Json(detail))
}

/// One piece of the manifest, as the shop's IN_TRANSIT fact named it.
struct ManifestUnit {
    sku_code: String,
    koli_id: Uuid,
    allotment_line_id: Uuid,
}

/// The receipt itself, in ONE transaction: the movement into the ledger, the
/// receipt and its pieces, a RECEIVED claim per piece, and the flow told.
async fn receive_epcs(
    state: &AppState,
    delivery_id: &str,
    raw_epcs: &[String],
    actor: &str,
    key: &str,
) -> Result<StoreInboundDetail, AppError> {
    if raw_epcs.len() > STORE_INBOUND_MAX_EPCS {
        return Err(AppError::Validation(format!(
            "receive at most {STORE_INBOUND_MAX_EPCS} tags per delivery, not {}",
            raw_epcs.len()
        )));
    }
    // A double read is one garment, so the set is what counts.
    let mut epcs = BTreeSet::new();
    for raw in raw_epcs {
        epcs.insert(normalized_epc(raw)?);
    }
    if epcs.is_empty() {
        return Err(AppError::Validation(
            "a receipt of no tags is not a receipt; sweep the delivery first".into(),
        ));
    }
    let digest = crate::security::sha256_hex(
        epcs.iter().map(String::as_str).collect::<Vec<_>>().join("\n"),
    );
    common::ensure_origin(&state.db).await?;

    let mut tx = state.db.begin().await?;
    lock_document(&mut tx, "inbound", delivery_id).await?;

    // The same key again: the same receipt, or a mistake.
    let by_key: Option<(String, String)> = sqlx::query_as(
        "SELECT delivery_id, receive_digest FROM dc_inbound_receipt WHERE idempotency_key = $1",
    )
    .bind(key)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some((saved_delivery, saved_digest)) = by_key {
        if saved_delivery != delivery_id || saved_digest != digest {
            return Err(AppError::Conflict(
                "idempotency key was already used with a different receipt".into(),
            ));
        }
        let detail = load_detail(&mut *tx, delivery_id).await?;
        tx.commit().await?;
        return Ok(detail);
    }
    // A delivery is received once. The same sweep under a new key is a
    // resend; a different sweep is a second receipt, refused.
    let received_digest: Option<String> =
        sqlx::query_scalar("SELECT receive_digest FROM dc_inbound_receipt WHERE delivery_id = $1")
            .bind(delivery_id)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some(received_digest) = received_digest {
        if received_digest == digest {
            let detail = load_detail(&mut *tx, delivery_id).await?;
            tx.commit().await?;
            return Ok(detail);
        }
        return Err(AppError::Conflict(format!(
            "delivery {delivery_id} was already received with a different set of tags"
        )));
    }

    // The delivery as the shops' facts announced it.
    let header = sqlx::query(
        "SELECT min(source_site_id) AS source_site_id,
                min(destination_store_id) AS destination_site_id,
                min(shipment_reference) AS shipment_reference,
                max(departed_at) AS departed_at,
                count(DISTINCT koli_id)::bigint AS koli_count,
                COALESCE(array_agg(DISTINCT koli_id), '{}') AS koli_ids
           FROM dc_inbound_koli WHERE delivery_id = $1",
    )
    .bind(delivery_id)
    .fetch_one(&mut *tx)
    .await?;
    let koli_count: i64 = header.try_get("koli_count")?;
    if koli_count == 0 {
        return Err(AppError::NotFound(format!("inbound delivery {delivery_id}")));
    }
    let source_site_id: String = header.try_get("source_site_id")?;
    let destination_site_id: String = header.try_get("destination_site_id")?;
    let shipment_reference: Option<String> = header.try_get("shipment_reference")?;
    let departed_at: DateTime<Utc> = header.try_get("departed_at")?;
    let mut koli_ids: Vec<Uuid> = header.try_get("koli_ids")?;
    koli_ids.sort();

    let mut manifest: BTreeMap<String, ManifestUnit> = BTreeMap::new();
    for row in sqlx::query(
        "SELECT unit.epc, unit.sku_code, unit.koli_id, unit.allotment_line_id
           FROM dc_inbound_koli koli
           JOIN edge_fulfillment_progress_unit unit ON unit.progress_event_id = koli.event_id
          WHERE koli.delivery_id = $1
          ORDER BY unit.epc, koli.departed_at",
    )
    .bind(delivery_id)
    .fetch_all(&mut *tx)
    .await?
    {
        let epc: String = row.try_get("epc")?;
        manifest.entry(epc.to_ascii_uppercase()).or_insert(ManifestUnit {
            sku_code: row.try_get::<String, _>("sku_code")?.to_ascii_uppercase(),
            koli_id: row.try_get("koli_id")?,
            allotment_line_id: row.try_get("allotment_line_id")?,
        });
    }

    // Where the goods land: that shop's return pool here, to be inspected;
    // its stockroom when the shop has no return pool here yet.
    let gudang = common::gudang_site_tx(&mut tx).await?;
    let landing_pool_id =
        match crate::cloud::postgres::sites::return_pool_for(&mut *tx, &gudang, &source_site_id)
            .await?
        {
            Some(pool) => pool,
            None => site_pool_tx(&mut tx, &gudang, "STOCKROOM").await?.ok_or_else(|| {
                AppError::Unprocessable(format!(
                    "the Gudang ({gudang}) has no stockroom pool to receive {source_site_id}'s return into"
                ))
            })?,
        };
    let landing = Place::Operational {
        pool: OperationalPool::from_str(&landing_pool_id)
            .map_err(|error| AppError::Conflict(error.to_string()))?,
        state: InventoryState::Normal,
    };

    // On the books means standing at one of our places now, not merely
    // having stood there once: a garment the Gudang shipped and a shop sends
    // back is booked in again under the subject it always had.
    let read: Vec<String> = epcs.iter().cloned().collect();
    let on_books: BTreeSet<String> = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT subject.epc
           FROM inventory_subject subject
           JOIN inventory_projection projection ON projection.subject_id = subject.id
           JOIN inventory_place place ON place.id = projection.place_id
          WHERE subject.epc = ANY($1) AND projection.quantity > 0 AND place.is_company",
    )
    .bind(&read)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .collect();

    // (epc, sku, subject, on the manifest)
    let mut booked: Vec<(String, String, Uuid, bool)> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    for epc in &epcs {
        if on_books.contains(epc) {
            // Already ours somewhere; it cannot arrive twice. On the manifest
            // it stays MISSING for this delivery, and the bay is told why.
            skipped.push(epc.clone());
            continue;
        }
        let (sku_code, on_manifest) = match manifest.get(epc) {
            Some(unit) => (unit.sku_code.clone(), true),
            None => match crate::cloud::domain::decode_epc(epc) {
                Ok((sku_code, _)) => (sku_code.to_ascii_uppercase(), false),
                Err(_) => {
                    skipped.push(epc.clone());
                    continue;
                }
            },
        };
        match unit_subject_tx(&mut tx, epc, &sku_code).await? {
            Some(subject) => booked.push((epc.clone(), sku_code, subject, on_manifest)),
            // A SKU the catalogue here does not hold cannot be stock here.
            None => skipped.push(epc.clone()),
        }
    }

    let occurred_at = state.clock.now();
    let receipt_id = Uuid::new_v4();
    let reason = format!(
        "Announced delivery {} from {source_site_id} received into {landing_pool_id}",
        shipment_reference.as_deref().unwrap_or(delivery_id)
    );
    // Each booked piece's movement group, for its claim.
    let mut group_of: BTreeMap<String, Uuid> = BTreeMap::new();
    for (index, chunk) in booked.chunks(CHUNK).enumerate() {
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines: chunk
                .iter()
                .map(|(_, _, subject, _)| MovementLine {
                    subject_id: SubjectId(*subject),
                    quantity: 1,
                    from: Place::System {
                        place: SystemPlace::Opening,
                    },
                    to: landing.clone(),
                })
                .collect(),
            cause: MovementCause::ReturnToWarehouse,
            reference_type: Some("RETURN_RECEIPT".into()),
            reference_id: Some(receipt_id.to_string()),
            reason: reason.clone(),
            actor_id: actor.to_owned(),
            occurred_at,
        };
        write_movement(
            &mut tx,
            &command,
            &format!("dc-return-receipt:{receipt_id}#{index}"),
        )
        .await?;
        for (epc, ..) in chunk {
            group_of.insert(epc.clone(), command.movement_group_id.0);
        }
    }

    sqlx::query(
        "INSERT INTO dc_inbound_receipt
             (delivery_id, receipt_id, source_site_id, destination_site_id, shipment_reference,
              landing_pool_id, departed_at, koli_count, received_by, received_at,
              idempotency_key, receive_digest, skipped_epcs)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
    )
    .bind(delivery_id)
    .bind(receipt_id)
    .bind(&source_site_id)
    .bind(&destination_site_id)
    .bind(&shipment_reference)
    .bind(&landing_pool_id)
    .bind(departed_at)
    .bind(koli_count)
    .bind(actor)
    .bind(occurred_at)
    .bind(key)
    .bind(&digest)
    .bind(serde_json::to_value(&skipped)?)
    .execute(&mut *tx)
    .await?;
    let booked_subject: BTreeMap<&str, Uuid> = booked
        .iter()
        .map(|(epc, _, subject, _)| (epc.as_str(), *subject))
        .collect();
    for (epc, unit) in &manifest {
        let subject = booked_subject.get(epc.as_str()).copied();
        sqlx::query(
            "INSERT INTO dc_inbound_unit
                 (delivery_id, epc, sku_code, koli_id, allotment_line_id, outcome, subject_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(delivery_id)
        .bind(epc)
        .bind(&unit.sku_code)
        .bind(unit.koli_id)
        .bind(unit.allotment_line_id)
        .bind(if subject.is_some() { "RECEIVED" } else { "MISSING" })
        .bind(subject)
        .execute(&mut *tx)
        .await?;
    }
    for (epc, sku_code, subject, on_manifest) in &booked {
        if *on_manifest {
            continue;
        }
        sqlx::query(
            "INSERT INTO dc_inbound_unit
                 (delivery_id, epc, sku_code, koli_id, allotment_line_id, outcome, subject_id)
             VALUES ($1, $2, $3, NULL, NULL, 'EXTRA', $4)",
        )
        .bind(delivery_id)
        .bind(epc)
        .bind(sku_code)
        .bind(subject)
        .execute(&mut *tx)
        .await?;
    }

    // A RECEIVED claim per booked piece, as the DC server's receipt sent
    // them: owned by the Gudang as the shop's fact spells it, so it pairs
    // with the shop's IN_TRANSIT claim. The pair releases the piece at the
    // shop's node and counts it received on the allotment line.
    for (epc, sku_code, _, _) in &booked {
        let seq = common::next_seq(&mut tx).await?;
        sqlx::query(
            "INSERT INTO edge_transfer_claim
                 (event_id, origin_id, owner_site_id, owner_node_role, generation, seq,
                  claim_kind, source_dc_id, destination_store_id, shipment_reference,
                  epc, quantity, sku_code, movement_group_id, receipt_id, occurred_at)
             VALUES ($1, $2, $3, 'DC', $4, $5, 'RECEIVED', $6, $3, $7, $8, 1, $9, $10, $11, $12)",
        )
        .bind(Uuid::new_v4())
        .bind(common::CLOUD_DC_ORIGIN)
        .bind(&destination_site_id)
        .bind(common::CLOUD_DC_GENERATION)
        .bind(seq)
        .bind(&source_site_id)
        .bind(&shipment_reference)
        .bind(epc)
        .bind(sku_code)
        .bind(group_of.get(epc).copied().unwrap_or(receipt_id))
        .bind(receipt_id)
        .bind(occurred_at)
        .execute(&mut *tx)
        .await?;
        if let Some(reference) = shipment_reference.as_deref() {
            crate::cloud::postgres::reconcile_transfer_allotment_attribution(
                &mut tx,
                &source_site_id,
                &destination_site_id,
                reference,
                epc,
            )
            .await?;
        }
    }

    // The delivery as one receipt, for the flows of the allotments it
    // carried: after the claims, as the DC server sent it.
    let mut per_line: BTreeMap<(Uuid, String), (i64, i64)> = BTreeMap::new();
    for (epc, unit) in &manifest {
        let entry = per_line
            .entry((unit.allotment_line_id, unit.sku_code.clone()))
            .or_insert((0, 0));
        entry.0 += 1;
        if booked_subject.contains_key(epc.as_str()) {
            entry.1 += 1;
        }
    }
    let extra_units = booked.iter().filter(|(.., on_manifest)| !on_manifest).count() as i64;
    let payload = InboundReceivedPayload {
        schema_version: FLOW_FACT_SCHEMA_VERSION,
        receipt_id,
        delivery_id: delivery_id.to_owned(),
        source_site_id: source_site_id.clone(),
        destination_site_id: gudang.clone(),
        shipment_reference: shipment_reference.clone(),
        landing_pool_id: landing_pool_id.clone(),
        koli_ids,
        lines: per_line
            .into_iter()
            .map(|((allotment_line_id, sku_code), (expected, received))| InboundReceivedLine {
                allotment_line_id: Some(allotment_line_id),
                sku_code,
                expected,
                received,
            })
            .collect(),
        extra_units,
        received_by: actor.to_owned(),
        received_at: occurred_at,
    };
    let seq = common::next_seq(&mut tx).await?;
    crate::cloud::postgres::flow_stages::apply_inbound_received_tx(
        &mut tx,
        common::CLOUD_DC_ORIGIN,
        common::CLOUD_DC_GENERATION,
        seq,
        receipt_id,
        &payload,
    )
    .await?;

    let detail = load_detail(&mut *tx, delivery_id).await?;
    tx.commit().await?;
    Ok(detail)
}

