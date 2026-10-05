//! Goods flows at a node.
//!
//! Head office runs every movement of goods as a flow document — the
//! allotment or the purchase order it runs, stage by stage — and moves each
//! stage from what this node's facts say it did (`cloud::postgres::flow_stages`).
//! This module holds the node's side of that:
//!
//! * **What head office's flows said about this site**
//!   (`inventory.flow.events.v1`, `migrations/sqlite/0058`): which document a
//!   piece of work belongs to and where it stands, so a screen can say "pick
//!   for ALR-00000041, the transfer to Store 07" rather than only "Store 07".
//!   Kept, never acted on: nothing here moves stock on head office's word.
//! * **The Gudang step that had no path of its own**
//!   (`migrations/sqlite/0059`): inspecting a store's return that was received
//!   into its return pool — good goods to the racks, damaged goods to reject.
//!   It writes what it did and tells head office in the same transaction
//!   (`inventory.return.inspected.v1`), which is what moves the flow's Inspect
//!   stage. Putaway, which 0059 added beside it, is not part of the company's
//!   process (the owner's ruling) and was taken out again (`0060`).

use super::sqlite::db;
use super::{
    EdgeError, InventoryState, MovementCause, MovementCommand, MovementGroupId,
    MovementLine, NodeContext, OperationalPool, Place, SubjectId,
};
use crate::sync::flow::{
    FlowEventsPayload, ReturnInspectedLine, ReturnInspectedPayload, FLOW_FACT_SCHEMA_VERSION,
    INVENTORY_RETURN_INSPECTED_V1,
};
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::str::FromStr;
use uuid::Uuid;

/// Most documents a notice list answers with, newest first.
pub const FLOW_NOTICE_LIST_LIMIT: i64 = 200;
/// Most events shown per document in a notice list.
pub const FLOW_NOTICE_EVENTS_PER_DOCUMENT: i64 = 20;
/// Most units one inspection moves in one movement group.
const INSPECTION_CHUNK: usize = 1000;

fn time_text(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn normalized_epc(raw: &str) -> String {
    raw.trim().to_ascii_uppercase()
}

// ---- what head office's flows said ----------------------------------------------------

/// Keep one relay of a flow document's events.
///
/// Every event is kept once, by head office's own id, so a resend is the same
/// row. The document takes the status and the stage now due from the newest
/// relay only: an older one arriving late adds its events and turns nothing
/// back. Never refuses anything but a failing database: a node that stopped its
/// command stream over a notice would be worse off than one that missed it.
pub(crate) fn apply_flow_events(
    tx: &Transaction<'_>,
    command_id: Uuid,
    payload: &FlowEventsPayload,
) -> Result<(), EdgeError> {
    let now = time_text(Utc::now());
    let document_id = payload.document_id.to_string();
    let newest = payload
        .events
        .iter()
        .map(|event| event.event_id)
        .max()
        .unwrap_or(0);
    let known: Option<i64> = tx
        .query_row(
            "SELECT last_event_id FROM flow_notice_document WHERE document_id=?1",
            [&document_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?;
    match known {
        None => {
            tx.execute(
                "INSERT INTO flow_notice_document
                     (document_id,document_number,template_code,template_name,source_kind,
                      source_id,origin_site_id,destination_site_id,destination_party_kind,
                      status,current_stage,last_event_id,updated_at)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                params![
                    document_id,
                    payload.document_number,
                    payload.template_code,
                    payload.template_name,
                    payload.source_kind,
                    payload.source_id,
                    payload.origin_site_id,
                    payload.destination_site_id,
                    payload.destination_party_kind,
                    payload.status,
                    payload.current_stage,
                    newest,
                    now
                ],
            )
            .map_err(db)?;
        }
        Some(last) if newest >= last => {
            tx.execute(
                "UPDATE flow_notice_document
                    SET document_number=?2,template_code=?3,template_name=?4,status=?5,
                        current_stage=?6,last_event_id=?7,updated_at=?8
                  WHERE document_id=?1",
                params![
                    document_id,
                    payload.document_number,
                    payload.template_code,
                    payload.template_name,
                    payload.status,
                    payload.current_stage,
                    newest,
                    now
                ],
            )
            .map_err(db)?;
        }
        Some(_) => {}
    }
    for event in &payload.events {
        let payload_json = serde_json::to_string(&event.payload)
            .map_err(|error| EdgeError::Persistence(error.to_string()))?;
        tx.execute(
            "INSERT OR IGNORE INTO flow_notice_event
                 (event_id,document_id,stage_index,stage_kind,event_type,executed_at,
                  target_site_id,payload_json,created_at,command_id,received_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                event.event_id,
                document_id,
                event.stage_index,
                event.stage_kind,
                event.event_type,
                event.executed_at,
                event.target_site_id,
                payload_json,
                time_text(event.created_at),
                command_id.to_string(),
                now
            ],
        )
        .map_err(db)?;
    }
    Ok(())
}

/// One event of a document, as a list shows it.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FlowNoticeEvent {
    pub event_id: i64,
    pub stage_kind: Option<String>,
    /// `STAGE_DONE`, `STAGE_PARKED`, `MOVEMENT`, `STATUS`…
    pub event_type: String,
    /// `NODE` or `HUB`.
    pub executed_at: String,
    pub created_at: String,
}

/// A flow document touching this site, as head office last described it.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FlowNotice {
    pub document_id: String,
    /// `ALR-00000041`.
    pub document_number: String,
    pub template_code: String,
    pub template_name: String,
    /// `ALLOTMENT`, `PURCHASE_ORDER`…, and its id.
    pub source_kind: String,
    pub source_id: String,
    /// Our sites at either end, as this node spells them.
    pub origin_site_id: Option<String>,
    pub destination_site_id: Option<String>,
    pub destination_party_kind: Option<String>,
    /// `REQUESTED`, `CONFIRMED`, `COMPLETED`, `DECLINED`, `CANCELED`.
    pub status: String,
    /// The stage now due (`PICK`, `RECEIVE`…), when there is one.
    pub current_stage: Option<String>,
    pub updated_at: String,
    /// The newest events, newest first.
    pub events: Vec<FlowNoticeEvent>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FlowNoticeList {
    pub documents: Vec<FlowNotice>,
}

/// The flow documents head office told this node about, newest first.
/// `open`: only those still running (requested or confirmed).
pub fn notices(connection: &Connection, open: bool) -> Result<FlowNoticeList, EdgeError> {
    let mut statement = connection
        .prepare(
            "SELECT document_id,document_number,template_code,template_name,source_kind,
                    source_id,origin_site_id,destination_site_id,destination_party_kind,
                    status,current_stage,updated_at
               FROM flow_notice_document
              WHERE (?1=0 OR status IN ('REQUESTED','CONFIRMED'))
              ORDER BY updated_at DESC, document_id
              LIMIT ?2",
        )
        .map_err(db)?;
    let mut documents: Vec<FlowNotice> = statement
        .query_map(params![i64::from(open), FLOW_NOTICE_LIST_LIMIT], |row| {
            Ok(FlowNotice {
                document_id: row.get(0)?,
                document_number: row.get(1)?,
                template_code: row.get(2)?,
                template_name: row.get(3)?,
                source_kind: row.get(4)?,
                source_id: row.get(5)?,
                origin_site_id: row.get(6)?,
                destination_site_id: row.get(7)?,
                destination_party_kind: row.get(8)?,
                status: row.get(9)?,
                current_stage: row.get(10)?,
                updated_at: row.get(11)?,
                events: Vec::new(),
            })
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    drop(statement);
    let mut events = connection
        .prepare(
            "SELECT event_id,stage_kind,event_type,executed_at,created_at
               FROM flow_notice_event
              WHERE document_id=?1
              ORDER BY event_id DESC
              LIMIT ?2",
        )
        .map_err(db)?;
    for document in &mut documents {
        document.events = events
            .query_map(
                params![document.document_id, FLOW_NOTICE_EVENTS_PER_DOCUMENT],
                |row| {
                    Ok(FlowNoticeEvent {
                        event_id: row.get(0)?,
                        stage_kind: row.get(1)?,
                        event_type: row.get(2)?,
                        executed_at: row.get(3)?,
                        created_at: row.get(4)?,
                    })
                },
            )
            .map_err(db)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db)?;
    }
    Ok(FlowNoticeList { documents })
}

// ---- a store's return, inspected --------------------------------------------------------

/// A store's return this warehouse received into that store's return pool.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReturnToInspect {
    pub delivery_id: String,
    /// The store it came back from, as its node spells it.
    pub source_site_id: String,
    pub shipment_reference: Option<String>,
    pub received_at: Option<String>,
    /// The store's return pool here, where the goods stand until inspected.
    pub return_pool_id: String,
    /// Received into the pool: the manifest's units found, and tags read
    /// that no koli held.
    pub received_units: i64,
    pub inspected_units: i64,
    /// Still standing in the return pool, not inspected.
    pub waiting_units: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReturnInspectionList {
    pub deliveries: Vec<ReturnToInspect>,
}

/// One unit of a received return still waiting to be inspected.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReturnUnitToInspect {
    pub epc: String,
    pub sku_code: String,
    /// From the resident catalogue, when this node holds the SKU.
    pub name: Option<String>,
    /// The allotment line it came back on; `None` for a tag read that no koli held.
    pub allotment_line_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReturnInspectionDetail {
    pub delivery: ReturnToInspect,
    pub units: Vec<ReturnUnitToInspect>,
}

/// What the inspector found.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct InspectReturnRequest {
    /// Tags found unfit to sell: they go to reject. Every other unit this
    /// inspection covers goes to the racks.
    #[serde(default)]
    pub damaged_epcs: Vec<String>,
    /// Which waiting units this inspection covers. Absent: all of them.
    #[serde(default)]
    pub epcs: Option<Vec<String>>,
    /// Replaced by the signed-in principal when the node enforces auth.
    #[serde(default)]
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct InspectReturnResult {
    pub inspection_id: Uuid,
    pub delivery_id: String,
    pub good_units: i64,
    pub damaged_units: i64,
    /// The movement that took the goods out of the return pool.
    pub movement_group_id: Option<Uuid>,
    /// Still waiting in the return pool after this inspection.
    pub waiting_units: i64,
}

struct ReturnDelivery {
    delivery_id: String,
    source_site_id: String,
    shipment_reference: Option<String>,
    received_at: Option<String>,
    pool: OperationalPool,
}

/// A received delivery that landed in one of this site's return pools.
fn return_delivery(
    connection: &Connection,
    node: &NodeContext,
    delivery_id: &str,
) -> Result<ReturnDelivery, EdgeError> {
    type Row = (
        String,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
    );
    let row: Option<Row> = connection
        .query_row(
            "SELECT source_site_id,shipment_reference,status,received_at,destination_pool_id
               FROM store_inbound_delivery WHERE delivery_id=?1",
            [delivery_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(db)?;
    let Some((source_site_id, shipment_reference, status, received_at, pool_id)) = row else {
        return Err(EdgeError::NotFound(format!(
            "inbound delivery {delivery_id}"
        )));
    };
    let pool = pool_id
        .as_deref()
        .and_then(|pool_id| OperationalPool::from_str(pool_id).ok())
        .filter(|pool| {
            node.owns_pool(pool) && pool.role() == crate::pool_role::PoolRole::Return
        })
        .ok_or_else(|| {
            EdgeError::Conflict(format!(
                "delivery {delivery_id} did not land in a store's return pool here; only a store's return is inspected"
            ))
        })?;
    if status != super::inbound::STATUS_RECEIVED {
        return Err(EdgeError::Conflict(format!(
            "delivery {delivery_id} is not received yet; receive it before it is inspected"
        )));
    }
    Ok(ReturnDelivery {
        delivery_id: delivery_id.to_owned(),
        source_site_id,
        shipment_reference,
        received_at,
        pool,
    })
}

/// The pool a unit stands in until inspected, as a ledger place.
fn pool_place(pool: &OperationalPool) -> Place {
    Place::Operational {
        pool: pool.clone(),
        state: InventoryState::Normal,
    }
}

/// The units of a received return still standing in its return pool and not
/// yet inspected: the manifest's units found, and tags read that no koli held.
fn waiting_units(
    connection: &Connection,
    delivery: &ReturnDelivery,
) -> Result<Vec<ReturnUnitToInspect>, EdgeError> {
    let place_id = pool_place(&delivery.pool).id();
    let mut statement = connection
        .prepare(
            "SELECT unit.epc, unit.sku_code, catalog.name, unit.allotment_line_id
               FROM store_inbound_unit unit
               JOIN inventory_subject subject ON subject.epc = unit.epc
               JOIN inventory_projection projection
                 ON projection.subject_id = subject.id AND projection.place_id = ?2
                AND projection.quantity > 0
               LEFT JOIN catalog_item catalog ON catalog.sku_code = unit.sku_code
              WHERE unit.delivery_id = ?1 AND unit.outcome = 'RECEIVED'
                AND unit.late_announcement = 0
                AND NOT EXISTS (SELECT 1 FROM return_inspection_unit done
                                 WHERE done.delivery_id = unit.delivery_id AND done.epc = unit.epc)
             UNION ALL
             SELECT extra.epc, extra.sku_code, catalog.name, NULL
               FROM store_inbound_extra extra
               JOIN inventory_subject subject ON subject.epc = extra.epc
               JOIN inventory_projection projection
                 ON projection.subject_id = subject.id AND projection.place_id = ?2
                AND projection.quantity > 0
               LEFT JOIN catalog_item catalog ON catalog.sku_code = extra.sku_code
              WHERE extra.delivery_id = ?1
                AND NOT EXISTS (SELECT 1 FROM return_inspection_unit done
                                 WHERE done.delivery_id = extra.delivery_id AND done.epc = extra.epc)
              ORDER BY 2, 1",
        )
        .map_err(db)?;
    let units = statement
        .query_map(params![delivery.delivery_id, place_id], |row| {
            Ok(ReturnUnitToInspect {
                epc: row.get(0)?,
                sku_code: row.get(1)?,
                name: row.get(2)?,
                allotment_line_id: row.get(3)?,
            })
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    Ok(units)
}

fn summary(
    connection: &Connection,
    delivery: &ReturnDelivery,
    waiting: i64,
) -> Result<ReturnToInspect, EdgeError> {
    let received: i64 = connection
        .query_row(
            "SELECT (SELECT COUNT(*) FROM store_inbound_unit
                      WHERE delivery_id=?1 AND outcome='RECEIVED' AND late_announcement=0)
                  + (SELECT COUNT(*) FROM store_inbound_extra WHERE delivery_id=?1)",
            [&delivery.delivery_id],
            |row| row.get(0),
        )
        .map_err(db)?;
    let inspected: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM return_inspection_unit WHERE delivery_id=?1",
            [&delivery.delivery_id],
            |row| row.get(0),
        )
        .map_err(db)?;
    Ok(ReturnToInspect {
        delivery_id: delivery.delivery_id.clone(),
        source_site_id: delivery.source_site_id.clone(),
        shipment_reference: delivery.shipment_reference.clone(),
        received_at: delivery.received_at.clone(),
        return_pool_id: delivery.pool.id(),
        received_units: received,
        inspected_units: inspected,
        waiting_units: waiting,
    })
}

/// Every received return with units still waiting to be inspected, newest
/// receipt first.
pub fn return_inspections(
    connection: &Connection,
    node: &NodeContext,
) -> Result<ReturnInspectionList, EdgeError> {
    let mut statement = connection
        .prepare(
            "SELECT delivery_id FROM store_inbound_delivery
              WHERE status='RECEIVED' AND destination_pool_id IS NOT NULL
              ORDER BY received_at DESC, delivery_id
              LIMIT 200",
        )
        .map_err(db)?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    drop(statement);
    let mut deliveries = Vec::new();
    for delivery_id in ids {
        // A delivery that landed anywhere but a return pool is not a return.
        let Ok(delivery) = return_delivery(connection, node, &delivery_id) else {
            continue;
        };
        let waiting =
            i64::try_from(waiting_units(connection, &delivery)?.len()).unwrap_or(i64::MAX);
        if waiting == 0 {
            continue;
        }
        deliveries.push(summary(connection, &delivery, waiting)?);
    }
    Ok(ReturnInspectionList { deliveries })
}

/// One received return and its units still waiting.
pub fn return_inspection(
    connection: &Connection,
    node: &NodeContext,
    delivery_id: &str,
) -> Result<ReturnInspectionDetail, EdgeError> {
    let delivery = return_delivery(connection, node, delivery_id)?;
    let units = waiting_units(connection, &delivery)?;
    let waiting = i64::try_from(units.len()).unwrap_or(i64::MAX);
    Ok(ReturnInspectionDetail {
        delivery: summary(connection, &delivery, waiting)?,
        units,
    })
}

/// Where damaged goods go at this site: its reject pool.
///
/// One spelling for both roles: `{site}.reject`, which is what the centre's
/// template gives every site kind (0610). A Gudang used to write
/// `{site}.reject.dc`, an id the centre holds no row for unless that Gudang is
/// the seeded one — so damaged goods at a warehouse opened later stood in a
/// pool the hub could not name. The old spelling is still read
/// (`DcRejectDc`), never written.
fn reject_pool(node: &NodeContext) -> OperationalPool {
    OperationalPool::Reject {
        site_id: node.site_id.clone(),
    }
}

/// Inspect (part of) a received store return, in ONE transaction: good goods
/// out of the return pool onto the racks, damaged goods to reject, the
/// inspection written down, and head office told
/// (`inventory.return.inspected.v1`). The same key twice is the same
/// inspection; a unit is inspected once.
pub(crate) fn inspect_return(
    tx: &Transaction<'_>,
    node: &NodeContext,
    delivery_id: &str,
    request: &InspectReturnRequest,
    now: DateTime<Utc>,
) -> Result<InspectReturnResult, EdgeError> {
    let key = request.idempotency_key.trim();
    let actor_id = request.actor_id.trim();
    if let Some(saved) = tx
        .query_row(
            "SELECT result_json FROM return_inspection WHERE idempotency_key=?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(db)?
    {
        return serde_json::from_str(&saved)
            .map_err(|error| EdgeError::Persistence(error.to_string()));
    }
    let delivery = return_delivery(tx, node, delivery_id)?;
    let waiting = waiting_units(tx, &delivery)?;
    let covered: Vec<&ReturnUnitToInspect> = match &request.epcs {
        None => waiting.iter().collect(),
        Some(epcs) => {
            let asked: BTreeSet<String> = epcs
                .iter()
                .map(|epc| normalized_epc(epc.as_str()))
                .collect();
            let covered: Vec<&ReturnUnitToInspect> = waiting
                .iter()
                .filter(|unit| asked.contains(&unit.epc))
                .collect();
            if covered.len() != asked.len() {
                return Err(EdgeError::Validation(format!(
                    "{} of the tags named are not waiting in {}; inspect only what stands there",
                    asked.len() - covered.len(),
                    delivery.pool.id()
                )));
            }
            covered
        }
    };
    if covered.is_empty() {
        return Err(EdgeError::Conflict(format!(
            "nothing from delivery {delivery_id} is waiting to be inspected"
        )));
    }
    let damaged: BTreeSet<String> = request
        .damaged_epcs
        .iter()
        .map(|epc| normalized_epc(epc.as_str()))
        .collect();
    if let Some(stranger) = damaged
        .iter()
        .find(|epc| !covered.iter().any(|unit| &unit.epc == *epc))
    {
        return Err(EdgeError::Validation(format!(
            "{stranger} is marked damaged but is not one of the units this inspection covers"
        )));
    }

    let inspection_id = Uuid::new_v4();
    let from = pool_place(&delivery.pool);
    let racks = pool_place(&OperationalPool::Stockroom {
        site_id: node.site_id.clone(),
    });
    let reject = pool_place(&reject_pool(node));
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
    for (index, chunk) in covered.chunks(INSPECTION_CHUNK).enumerate() {
        let mut lines = Vec::with_capacity(chunk.len());
        for unit in chunk {
            let subject: String = tx
                .query_row(
                    "SELECT id FROM inventory_subject WHERE epc=?1",
                    [&unit.epc],
                    |row| row.get(0),
                )
                .map_err(db)?;
            let subject_id = Uuid::parse_str(&subject)
                .map_err(|error| EdgeError::Persistence(error.to_string()))?;
            lines.push(MovementLine {
                subject_id: SubjectId(subject_id),
                quantity: 1,
                from: from.clone(),
                to: if damaged.contains(&unit.epc) {
                    reject.clone()
                } else {
                    racks.clone()
                },
            });
        }
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines,
            cause: MovementCause::NormalMove,
            reference_type: Some("RETURN_INSPECTION".into()),
            reference_id: Some(inspection_id.to_string()),
            reason: reason.clone(),
            actor_id: actor_id.to_owned(),
            occurred_at: now,
        };
        let movement_key = if index == 0 {
            key.to_owned()
        } else {
            format!("{key}#{index}")
        };
        let result = crate::edge::SqliteEdge::append_movement(node, tx, &movement_key, &command)?;
        first_group.get_or_insert(result.movement_group_id);
    }

    // What was inspected, per allotment line, for the flow the return runs.
    let mut per_line: BTreeMap<(Option<String>, String), (i64, i64)> = BTreeMap::new();
    for unit in &covered {
        let entry = per_line
            .entry((unit.allotment_line_id.clone(), unit.sku_code.clone()))
            .or_insert((0, 0));
        if damaged.contains(&unit.epc) {
            entry.1 += 1;
        } else {
            entry.0 += 1;
        }
        tx.execute(
            "INSERT INTO return_inspection_unit
                 (inspection_id,delivery_id,epc,sku_code,allotment_line_id,outcome)
             VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                inspection_id.to_string(),
                delivery.delivery_id,
                unit.epc,
                unit.sku_code,
                unit.allotment_line_id,
                if damaged.contains(&unit.epc) {
                    "DAMAGED"
                } else {
                    "GOOD"
                }
            ],
        )
        .map_err(db)?;
    }
    let result = InspectReturnResult {
        inspection_id,
        delivery_id: delivery.delivery_id.clone(),
        good_units,
        damaged_units,
        movement_group_id: first_group,
        waiting_units: i64::try_from(waiting.len() - covered.len()).unwrap_or(0),
    };
    let result_json = serde_json::to_string(&result)
        .map_err(|error| EdgeError::Persistence(error.to_string()))?;
    tx.execute(
        "INSERT INTO return_inspection
             (inspection_id,idempotency_key,delivery_id,movement_group_id,good_units,
              damaged_units,inspected_by,inspected_at,result_json)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            inspection_id.to_string(),
            key,
            delivery.delivery_id,
            first_group.map(|group| group.to_string()),
            good_units,
            damaged_units,
            actor_id,
            time_text(now),
            result_json
        ],
    )
    .map_err(db)?;
    let fact = ReturnInspectedPayload {
        schema_version: FLOW_FACT_SCHEMA_VERSION,
        inspection_id,
        delivery_id: delivery.delivery_id.clone(),
        source_site_id: delivery.source_site_id.clone(),
        site_id: node.site_id.to_string(),
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
        inspected_by: actor_id.to_owned(),
        inspected_at: now,
    };
    crate::edge::sync::enqueue_fact(tx, inspection_id, INVENTORY_RETURN_INSPECTED_V1, &fact)
        .map_err(db)?;
    Ok(result)
}
