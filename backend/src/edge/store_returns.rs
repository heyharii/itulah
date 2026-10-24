//! The returns Merchandise asked this shop for, and the one act that sends one.
//!
//! A shop never starts a return and has no pick flow (owner, 1 Oct 2026):
//! head office raises a RETURN_TO_DC allotment, the shop's node files it in
//! `dc_allotment_work`, and the shop taps **Sent**. Sending is the outbound
//! path every site already has — pick off the return pool, pack and seal one
//! carton, put it on a trip — done in one go by the handler, each step under
//! its own idempotency key derived from the request's, so a retried tap
//! finishes what the first one started instead of doing it twice.

use super::sqlite::db;
use super::EdgeError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize)]
pub struct StoreReturnLine {
    pub sku_code: String,
    pub name: Option<String>,
    /// Still to send: accepted, less what is packed and what was cancelled.
    pub quantity: i64,
    /// Where the pieces come off.
    #[serde(skip)]
    pub source_pool_id: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct StoreReturnAsk {
    pub allotment_id: String,
    pub allotment_number: String,
    pub requested_at: String,
    pub quantity: i64,
    pub lines: Vec<StoreReturnLine>,
    /// The site the goods go to.
    #[serde(skip)]
    pub destination_id: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct StoreReturnList {
    pub items: Vec<StoreReturnAsk>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SendReturnRequest {
    pub idempotency_key: String,
    /// Who carries it — courier, plate, driver — as one note, the way the
    /// Gudang writes a trip (owner, 23 Oct 2026: the shop dispatches itself).
    #[serde(default)]
    pub trip_note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SendReturnResult {
    pub shipment_number: String,
    pub quantity: i64,
}

/// Every return Merchandise asked this shop for that still has something to send.
pub fn asks(connection: &Connection) -> Result<StoreReturnList, EdgeError> {
    let mut statement = connection
        .prepare(
            "SELECT w.allotment_id, w.allotment_number, w.created_at,
                    l.sku_code, l.source_pool_id, l.destination_id,
                    l.accepted_quantity - l.packed_quantity - l.cancelled_quantity AS left,
                    (SELECT c.name FROM catalog_item c WHERE c.sku_code = l.sku_code) AS name
               FROM dc_allotment_work w
               JOIN dc_allotment_work_line l ON l.allotment_id = w.allotment_id
              WHERE w.allotment_type = 'RETURN_TO_DC'
                AND w.application_status = 'ACCEPTED'
                AND w.fulfillment_status IN ('OPEN', 'IN_PROGRESS')
                AND l.accepted_quantity - l.packed_quantity - l.cancelled_quantity > 0
              ORDER BY w.created_at, w.allotment_id, l.sku_code",
        )
        .map_err(db)?;
    let rows = statement
        .query_map(params![], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    let mut by: BTreeMap<String, StoreReturnAsk> = BTreeMap::new();
    let mut order: Vec<String> = Vec::new();
    for (id, number, at, sku, pool, destination, left, name) in rows {
        let ask = by.entry(id.clone()).or_insert_with(|| {
            order.push(id.clone());
            StoreReturnAsk {
                allotment_id: id.clone(),
                allotment_number: number,
                requested_at: at,
                quantity: 0,
                lines: Vec::new(),
                destination_id: destination,
            }
        });
        ask.quantity += left;
        ask.lines.push(StoreReturnLine {
            sku_code: sku,
            name,
            quantity: left,
            source_pool_id: pool,
        });
    }
    Ok(StoreReturnList {
        items: order.into_iter().filter_map(|id| by.remove(&id)).collect(),
    })
}
