//! Inspecting a shop's return once it is received into that shop's return
//! pool: good goods to the racks, damaged goods to reject — the goods flow's
//! Inspect stage (`edge::flows::inspect_return` is the specification).
//!
//! A unit is inspected once; the same key twice is the same inspection; an
//! inspection may cover part of what waits, and names only what stands there.
//! The flow hears of it through the applier the DC server's
//! `inventory.return.inspected.v1` reached (`flow_stages::apply_return_inspected_tx`).

use super::{
    actor_of, hosted, lock_document, normalized_epc, require_key, site_pool_tx, time_text,
    write_movement,
};
use crate::cloud::dc::common;
use crate::cloud::domain::{
    InventoryState, MovementCause, MovementCommand, MovementGroupId, MovementLine, OperationalPool,
    Place, SubjectId,
};
use crate::cloud::http::auth::Principal;
use crate::cloud::{AppError, AppState};
use crate::edge::flows::{
    InspectReturnRequest, InspectReturnResult, ReturnInspectionDetail, ReturnInspectionList,
    ReturnToInspect, ReturnUnitToInspect,
};
use crate::sync::flow::{ReturnInspectedLine, ReturnInspectedPayload, FLOW_FACT_SCHEMA_VERSION};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use chrono::{DateTime, Utc};
use sqlx::{PgConnection, Row};
use std::collections::{BTreeMap, BTreeSet};
use std::str::FromStr;
use uuid::Uuid;

/// At most a thousand lines per movement group.
const CHUNK: usize = 1000;

/// A received delivery that landed in a shop's return pool here.
struct ReturnDelivery {
    delivery_id: String,
    source_site_id: String,
    shipment_reference: Option<String>,
    received_at: DateTime<Utc>,
    pool_id: String,
}

/// One waiting unit, with the subject the move needs.
struct Waiting {
    unit: ReturnUnitToInspect,
    subject_id: Uuid,
}

async fn return_delivery(
    conn: &mut PgConnection,
    delivery_id: &str,
) -> Result<ReturnDelivery, AppError> {
    let row = sqlx::query(
        "SELECT r.source_site_id, r.shipment_reference, r.received_at, r.landing_pool_id,
                pool.role
           FROM dc_inbound_receipt r
           JOIN operational_pool pool ON pool.id = r.landing_pool_id
          WHERE r.delivery_id = $1",
    )
    .bind(delivery_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(row) = row else {
        let announced: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM dc_inbound_koli WHERE delivery_id = $1)",
        )
        .bind(delivery_id)
        .fetch_one(&mut *conn)
        .await?;
        return Err(if announced {
            AppError::Conflict(format!(
                "delivery {delivery_id} is not received yet; receive it before it is inspected"
            ))
        } else {
            AppError::NotFound(format!("inbound delivery {delivery_id}"))
        });
    };
    if row.try_get::<Option<String>, _>("role")?.as_deref() != Some("RETURN") {
        return Err(AppError::Conflict(format!(
            "delivery {delivery_id} did not land in a store's return pool here; only a store's return is inspected"
        )));
    }
    Ok(ReturnDelivery {
        delivery_id: delivery_id.to_owned(),
        source_site_id: row.try_get("source_site_id")?,
        shipment_reference: row.try_get("shipment_reference")?,
        received_at: row.try_get("received_at")?,
        pool_id: row.try_get("landing_pool_id")?,
    })
}

/// The units of a received return still standing in its return pool and not
/// yet inspected: the manifest's units found, and tags read that no koli held.
async fn waiting_units(
    conn: &mut PgConnection,
    delivery: &ReturnDelivery,
) -> Result<Vec<Waiting>, AppError> {
    let rows = sqlx::query(
        "SELECT unit.epc, unit.sku_code, article.name, unit.allotment_line_id, unit.subject_id
           FROM dc_inbound_unit unit
           JOIN inventory_projection projection
             ON projection.subject_id = unit.subject_id AND projection.place_id = $2
            AND projection.quantity > 0
           LEFT JOIN sku ON upper(sku.sku_code) = upper(unit.sku_code)
           LEFT JOIN article ON article.id = sku.article_id
          WHERE unit.delivery_id = $1 AND unit.outcome IN ('RECEIVED', 'EXTRA')
            AND NOT EXISTS (SELECT 1 FROM dc_return_inspection_unit done
                             WHERE done.delivery_id = unit.delivery_id AND done.epc = unit.epc)
          ORDER BY unit.sku_code, unit.epc",
    )
    .bind(&delivery.delivery_id)
    .bind(format!("{}:on_hand", delivery.pool_id))
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(Waiting {
                unit: ReturnUnitToInspect {
                    epc: row.try_get("epc")?,
                    sku_code: row.try_get("sku_code")?,
                    name: row.try_get("name")?,
                    allotment_line_id: row
                        .try_get::<Option<Uuid>, _>("allotment_line_id")?
                        .map(|line| line.to_string()),
                },
                subject_id: row.try_get("subject_id")?,
            })
        })
        .collect()
}

async fn summary(
    conn: &mut PgConnection,
    delivery: &ReturnDelivery,
    waiting: i64,
) -> Result<ReturnToInspect, AppError> {
    let row = sqlx::query(
        "SELECT (SELECT count(*) FROM dc_inbound_unit
                  WHERE delivery_id = $1 AND outcome IN ('RECEIVED', 'EXTRA'))::bigint AS received,
                (SELECT count(*) FROM dc_return_inspection_unit
                  WHERE delivery_id = $1)::bigint AS inspected",
    )
    .bind(&delivery.delivery_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(ReturnToInspect {
        delivery_id: delivery.delivery_id.clone(),
        source_site_id: delivery.source_site_id.clone(),
        shipment_reference: delivery.shipment_reference.clone(),
        received_at: Some(time_text(delivery.received_at)),
        return_pool_id: delivery.pool_id.clone(),
        received_units: row.try_get("received")?,
        inspected_units: row.try_get("inspected")?,
        waiting_units: waiting,
    })
}

/// Every received return with units still waiting to be inspected, newest
/// receipt first.
pub(super) async fn list(
    State(state): State<AppState>,
) -> Result<Json<ReturnInspectionList>, AppError> {
    hosted()?;
    let rows = sqlx::query(
        "SELECT * FROM (
             SELECT r.delivery_id, r.source_site_id, r.shipment_reference, r.received_at,
                    r.landing_pool_id,
                    (SELECT count(*) FROM dc_inbound_unit u
                      WHERE u.delivery_id = r.delivery_id
                        AND u.outcome IN ('RECEIVED', 'EXTRA'))::bigint AS received,
                    (SELECT count(*) FROM dc_return_inspection_unit d
                      WHERE d.delivery_id = r.delivery_id)::bigint AS inspected,
                    (SELECT count(*) FROM dc_inbound_unit u
                       JOIN inventory_projection p
                         ON p.subject_id = u.subject_id
                        AND p.place_id = r.landing_pool_id || ':on_hand'
                        AND p.quantity > 0
                      WHERE u.delivery_id = r.delivery_id
                        AND u.outcome IN ('RECEIVED', 'EXTRA')
                        AND NOT EXISTS (SELECT 1 FROM dc_return_inspection_unit d
                                         WHERE d.delivery_id = u.delivery_id
                                           AND d.epc = u.epc))::bigint AS waiting
               FROM dc_inbound_receipt r
               JOIN operational_pool pool ON pool.id = r.landing_pool_id AND pool.role = 'RETURN'
         ) returns
          WHERE waiting > 0
          ORDER BY received_at DESC, delivery_id
          LIMIT 200",
    )
    .fetch_all(&state.db)
    .await?;
    let deliveries = rows
        .iter()
        .map(|row| -> Result<ReturnToInspect, AppError> {
            Ok(ReturnToInspect {
                delivery_id: row.try_get("delivery_id")?,
                source_site_id: row.try_get("source_site_id")?,
                shipment_reference: row.try_get("shipment_reference")?,
                received_at: Some(time_text(row.try_get("received_at")?)),
                return_pool_id: row.try_get("landing_pool_id")?,
                received_units: row.try_get("received")?,
                inspected_units: row.try_get("inspected")?,
                waiting_units: row.try_get("waiting")?,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(ReturnInspectionList { deliveries }))
}

/// One received return and the units still waiting in its return pool.
pub(super) async fn detail(
    State(state): State<AppState>,
    Path(delivery_id): Path<String>,
) -> Result<Json<ReturnInspectionDetail>, AppError> {
    hosted()?;
    let mut conn = state.db.acquire().await?;
    let delivery = return_delivery(&mut *conn, delivery_id.trim()).await?;
    let waiting = waiting_units(&mut *conn, &delivery).await?;
    let count = i64::try_from(waiting.len()).unwrap_or(i64::MAX);
    Ok(Json(ReturnInspectionDetail {
        delivery: summary(&mut *conn, &delivery, count).await?,
        units: waiting.into_iter().map(|waiting| waiting.unit).collect(),
    }))
}

/// Inspect (part of) a received return, in ONE transaction: good goods out
/// of the return pool onto the racks, damaged goods to reject, the inspection
/// written down, and the flow told.
pub(super) async fn inspect(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(delivery_id): Path<String>,
    Json(request): Json<InspectReturnRequest>,
) -> Result<(StatusCode, Json<InspectReturnResult>), AppError> {
    hosted()?;
    let actor = actor_of(&principal)?;
    let key = require_key(&request.idempotency_key)?;
    let delivery_id = delivery_id.trim().to_owned();
    common::ensure_origin(&state.db).await?;

    let mut tx = state.db.begin().await?;
    lock_document(&mut tx, "inbound", &delivery_id).await?;
    let saved: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT result FROM dc_return_inspection WHERE idempotency_key = $1")
            .bind(&key)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some(saved) = saved {
        let result: InspectReturnResult = serde_json::from_value(saved)?;
        if result.delivery_id != delivery_id {
            return Err(AppError::Conflict(
                "idempotency key was already used for another delivery's inspection".into(),
            ));
        }
        tx.commit().await?;
        return Ok((StatusCode::CREATED, Json(result)));
    }

    let delivery = return_delivery(&mut *tx, &delivery_id).await?;
    let waiting = waiting_units(&mut *tx, &delivery).await?;
    let covered: Vec<&Waiting> = match &request.epcs {
        None => waiting.iter().collect(),
        Some(epcs) => {
            let mut asked = BTreeSet::new();
            for epc in epcs {
                asked.insert(normalized_epc(epc)?);
            }
            let covered: Vec<&Waiting> = waiting
                .iter()
                .filter(|waiting| asked.contains(&waiting.unit.epc))
                .collect();
            if covered.len() != asked.len() {
                return Err(AppError::Validation(format!(
                    "{} of the tags named are not waiting in {}; inspect only what stands there",
                    asked.len() - covered.len(),
                    delivery.pool_id
                )));
            }
            covered
        }
    };
    if covered.is_empty() {
        return Err(AppError::Conflict(format!(
            "nothing from delivery {delivery_id} is waiting to be inspected"
        )));
    }
    let mut damaged = BTreeSet::new();
    for epc in &request.damaged_epcs {
        damaged.insert(normalized_epc(epc)?);
    }
    if let Some(stranger) = damaged
        .iter()
        .find(|epc| !covered.iter().any(|waiting| &waiting.unit.epc == *epc))
    {
        return Err(AppError::Validation(format!(
            "{stranger} is marked damaged but is not one of the units this inspection covers"
        )));
    }

    let gudang = common::gudang_site_tx(&mut tx).await?;
    let place_of = |pool_id: &str| -> Result<Place, AppError> {
        Ok(Place::Operational {
            pool: OperationalPool::from_str(pool_id)
                .map_err(|error| AppError::Conflict(error.to_string()))?,
            state: InventoryState::Normal,
        })
    };
    let from = place_of(&delivery.pool_id)?;
    let racks = place_of(&site_pool_tx(&mut tx, &gudang, "STOCKROOM").await?.ok_or_else(|| {
        AppError::Unprocessable(format!("the Gudang ({gudang}) has no stockroom pool"))
    })?)?;
    let reject = place_of(&site_pool_tx(&mut tx, &gudang, "REJECT").await?.ok_or_else(|| {
        AppError::Unprocessable(format!("the Gudang ({gudang}) has no reject pool"))
    })?)?;

    let inspection_id = Uuid::new_v4();
    let now = state.clock.now();
    let good_units = i64::try_from(covered.len() - damaged.len()).unwrap_or(0);
    let damaged_units = i64::try_from(damaged.len()).unwrap_or(0);
    let reason = format!(
        "Return {} from {} inspected: {good_units} to the racks, {damaged_units} to reject",
        delivery
            .shipment_reference
            .as_deref()
            .unwrap_or(&delivery.delivery_id),
        delivery.source_site_id
    );
    let mut first_group: Option<Uuid> = None;
    for (index, chunk) in covered.chunks(CHUNK).enumerate() {
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines: chunk
                .iter()
                .map(|waiting| MovementLine {
                    subject_id: SubjectId(waiting.subject_id),
                    quantity: 1,
                    from: from.clone(),
                    to: if damaged.contains(&waiting.unit.epc) {
                        reject.clone()
                    } else {
                        racks.clone()
                    },
                })
                .collect(),
            cause: MovementCause::NormalMove,
            reference_type: Some("RETURN_INSPECTION".into()),
            reference_id: Some(inspection_id.to_string()),
            reason: reason.clone(),
            actor_id: actor.clone(),
            occurred_at: now,
        };
        write_movement(
            &mut tx,
            &command,
            &format!("dc-return-inspection:{inspection_id}#{index}"),
        )
        .await?;
        first_group.get_or_insert(command.movement_group_id.0);
    }

    let result = InspectReturnResult {
        inspection_id,
        delivery_id: delivery.delivery_id.clone(),
        good_units,
        damaged_units,
        movement_group_id: first_group,
        waiting_units: i64::try_from(waiting.len() - covered.len()).unwrap_or(0),
    };
    sqlx::query(
        "INSERT INTO dc_return_inspection
             (inspection_id, idempotency_key, delivery_id, movement_group_id, good_units,
              damaged_units, inspected_by, inspected_at, result)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(inspection_id)
    .bind(&key)
    .bind(&delivery.delivery_id)
    .bind(first_group)
    .bind(good_units)
    .bind(damaged_units)
    .bind(&actor)
    .bind(now)
    .bind(serde_json::to_value(&result)?)
    .execute(&mut *tx)
    .await?;

    // What was inspected, per allotment line, for the flow the return runs.
    let mut per_line: BTreeMap<(Option<String>, String), (i64, i64)> = BTreeMap::new();
    for waiting in &covered {
        let is_damaged = damaged.contains(&waiting.unit.epc);
        let entry = per_line
            .entry((
                waiting.unit.allotment_line_id.clone(),
                waiting.unit.sku_code.clone(),
            ))
            .or_insert((0, 0));
        if is_damaged {
            entry.1 += 1;
        } else {
            entry.0 += 1;
        }
        sqlx::query(
            "INSERT INTO dc_return_inspection_unit
                 (delivery_id, epc, inspection_id, sku_code, allotment_line_id, outcome)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(&delivery.delivery_id)
        .bind(&waiting.unit.epc)
        .bind(inspection_id)
        .bind(&waiting.unit.sku_code)
        .bind(
            waiting
                .unit
                .allotment_line_id
                .as_deref()
                .and_then(|line| Uuid::parse_str(line).ok()),
        )
        .bind(if is_damaged { "DAMAGED" } else { "GOOD" })
        .execute(&mut *tx)
        .await?;
    }
    let fact = ReturnInspectedPayload {
        schema_version: FLOW_FACT_SCHEMA_VERSION,
        inspection_id,
        delivery_id: delivery.delivery_id.clone(),
        source_site_id: delivery.source_site_id.clone(),
        site_id: gudang,
        shipment_reference: delivery.shipment_reference.clone(),
        movement_group_id: first_group.unwrap_or(inspection_id),
        lines: per_line
            .into_iter()
            .map(
                |((allotment_line_id, sku_code), (good, damaged))| ReturnInspectedLine {
                    allotment_line_id: allotment_line_id
                        .as_deref()
                        .and_then(|line| Uuid::parse_str(line).ok()),
                    sku_code,
                    good,
                    damaged,
                },
            )
            .collect(),
        inspected_by: actor.clone(),
        inspected_at: now,
    };
    let seq = common::next_seq(&mut tx).await?;
    crate::cloud::postgres::flow_stages::apply_return_inspected_tx(
        &mut tx,
        common::CLOUD_DC_ORIGIN,
        common::CLOUD_DC_GENERATION,
        seq,
        inspection_id,
        &fact,
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(result)))
}
