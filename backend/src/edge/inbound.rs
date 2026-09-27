//! Deliveries on their way to this shop, and the blind count that receives them.
//!
//! "This shop" since the owner's routes of 2026-09-27 means any site of ours
//! that goods are sent to: a shop receives an allotment or a transfer here,
//! and the Gudang receives a shop's return — the same announcement, the same
//! blind count, the same one receipt. A return lands in that store's own
//! return pool at the Gudang, named on the announcement
//! (`destination_pool_id`), and is inspected afterwards; everything else lands
//! in the receiving site's stockroom, as it always did.
//!
//! Head office tells a Store Edge about every koli that leaves the DC for it
//! (`inventory.store_inbound.announce.v1`, issued when the centre applies the
//! koli's IN_TRANSIT fact). The koli of one surat jalan are filed under ONE
//! delivery, keyed deterministically by the DC and the surat-jalan number (or
//! the koli, when there is none).
//!
//! # The blind rule
//!
//! The manifest is held here but NOTHING of it is shown while the delivery is
//! in transit: no expected quantity, no EPC, no per-SKU count. Only the number
//! of koli is visible, because that is written on the lorry anyway. The
//! handheld sweeps, the shop submits what it read, and only then is the
//! comparison written down and shown — expected, received, missing, extra —
//! to the shop and, through the transfer claims it uploads, to head office.
//!
//! # What a receipt books
//!
//! * a manifest EPC that was read: booked (Opening → store warehouse), with a
//!   RECEIVED transfer claim carrying the DC and the surat-jalan number, so the
//!   centre pairs it with the DC's IN_TRANSIT claim (MATCHED);
//! * an EPC that was read but is not on the manifest, whose SKU decodes from
//!   the tag: booked the same way and recorded as an extra (the centre shows it
//!   STORE_ONLY);
//! * an EPC already on this shop's books, or one that does not decode: not
//!   booked, reported in `skipped_epcs`;
//! * a manifest EPC that was not read (or was skipped): MISSING, not booked —
//!   it stays in transit at the centre (DC_ONLY), which is head office's
//!   discrepancy to chase.
//!
//! The booking itself lives in `sqlite.rs` beside the other receipts, because
//! it goes through the same private movement funnel; this module holds the
//! contract, the command applier and the reads.

use super::sqlite::db;
use super::EdgeError;
use crate::sync::workflow::StoreInboundAnnouncePayload;
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

/// Most deliveries a list answers with, newest first.
pub const STORE_INBOUND_LIST_LIMIT: i64 = 200;
/// Most EPCs one receipt may carry (after de-duplication it can only shrink).
pub const STORE_INBOUND_MAX_EPCS: usize = 20_000;

pub const STATUS_IN_TRANSIT: &str = "IN_TRANSIT";
pub const STATUS_RECEIVED: &str = "RECEIVED";

/// What the receipt found, in units. Only ever present once RECEIVED.
///
/// `received_units` counts MANIFEST units booked by the receipt, so
/// `expected_units = received_units + missing_units`; `extra_units` are the
/// tags read that were not on the manifest (booked as well).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreInboundResult {
    pub expected_units: i64,
    pub received_units: i64,
    pub missing_units: i64,
    pub extra_units: i64,
}

/// One delivery as a list shows it. Blind while IN_TRANSIT: `result` is null
/// and nothing about the manifest's contents is exposed — only `koli_count`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreInboundDelivery {
    pub delivery_id: String,
    pub shipment_reference: Option<String>,
    pub source_site_id: String,
    /// When the delivery's last koli left the DC.
    pub departed_at: DateTime<Utc>,
    #[cfg_attr(feature = "ts", ts(type = "\"IN_TRANSIT\" | \"RECEIVED\""))]
    pub status: String,
    pub koli_count: i64,
    pub received_at: Option<DateTime<Utc>>,
    pub received_by: Option<String>,
    pub result: Option<StoreInboundResult>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreInboundList {
    pub deliveries: Vec<StoreInboundDelivery>,
}

/// One SKU of a received delivery. `received` counts manifest units booked;
/// `extra` counts tags of this SKU read that were not on the manifest.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreInboundLine {
    pub sku_code: String,
    /// From the resident catalogue, when this shop holds the SKU.
    pub name: Option<String>,
    pub expected: i64,
    pub received: i64,
    pub missing: i64,
    pub extra: i64,
    pub missing_epcs: Vec<String>,
    pub extra_epcs: Vec<String>,
}

/// A delivery and, once RECEIVED, its comparison per SKU. `lines` is EMPTY
/// while IN_TRANSIT (blind). `skipped_epcs` are tags the receipt read but did
/// not book: already on this shop's books, or not one of ours.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreInboundDetail {
    pub delivery: StoreInboundDelivery,
    pub lines: Vec<StoreInboundLine>,
    #[serde(default)]
    pub skipped_epcs: Vec<String>,
}

/// What the handheld submits: every tag it read, nothing it expected.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreInboundReceiveRequest {
    /// Up to 20 000; normalised (trimmed, uppercased) and de-duplicated here.
    pub epcs: Vec<String>,
    /// Replaced by the signed-in principal when the node enforces auth.
    #[serde(default)]
    pub actor_id: String,
    pub idempotency_key: String,
}

/// `?status=IN_TRANSIT|RECEIVED|ALL` → the status to filter on, `None` = all.
pub fn parse_status_filter(value: Option<&str>) -> Result<Option<&'static str>, EdgeError> {
    match value.map(|value| value.trim().to_ascii_uppercase()).as_deref() {
        None | Some("") | Some("ALL") => Ok(None),
        Some(STATUS_IN_TRANSIT) => Ok(Some(STATUS_IN_TRANSIT)),
        Some(STATUS_RECEIVED) => Ok(Some(STATUS_RECEIVED)),
        Some(other) => Err(EdgeError::Validation(format!(
            "status must be IN_TRANSIT, RECEIVED or ALL, not {other}"
        ))),
    }
}

/// The delivery a koli belongs to: one per (DC, surat jalan), or per koli when
/// the koli travels without one. A digest, so it is stable, URL-safe whatever
/// characters a surat-jalan number carries, and the same on every replay.
pub fn delivery_id_for(
    source_site_id: &str,
    shipment_reference: Option<&str>,
    koli_id: Uuid,
) -> String {
    let key = match shipment_reference.map(str::trim).filter(|value| !value.is_empty()) {
        Some(reference) => format!("{}\nSJ\n{reference}", source_site_id.trim()),
        None => format!("{}\nKOLI\n{koli_id}", source_site_id.trim()),
    };
    format!("inb-{}", &crate::security::sha256_hex(key)[..32])
}

fn time_text(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn now_text() -> String {
    time_text(Utc::now())
}

fn parse_time(value: &str) -> Result<DateTime<Utc>, EdgeError> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| EdgeError::Persistence(format!("malformed timestamp {value}: {error}")))
}

/// Apply one announcement inside the command's transaction.
///
/// Upserts: a koli already filed is not filed twice, and the koli of one
/// surat jalan merge into one delivery. A delivery already RECEIVED keeps its
/// result — a late koli is written down (`late_announcement = 1`) so the
/// history is complete, and never counted.
///
/// A node that is not the destination ignores the announcement with a
/// warning rather than blocking: the centre only ever targets the origin that
/// owns `destination_store_id`, so this is a misdirected command (e.g. an
/// operator broadcast), and stopping a node's whole command stream over an
/// advisory is worse than dropping it. Which ROLE the node runs as does not
/// matter: the Gudang is the destination of a shop's return.
pub(crate) fn apply_announcement(
    tx: &Transaction<'_>,
    command_id: Uuid,
    payload: &StoreInboundAnnouncePayload,
) -> Result<(), EdgeError> {
    let (role, site_id): (String, String) = tx
        .query_row(
            "SELECT role,site_id FROM node_metadata WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(db)?;
    if site_id != payload.destination_store_id {
        tracing::warn!(
            koli = %payload.koli_id,
            destination = %payload.destination_store_id,
            node_role = %role,
            node_site = %site_id,
            "ignoring an inbound announcement addressed to another node"
        );
        return Ok(());
    }
    let delivery_id = delivery_id_for(
        &payload.source_site_id,
        payload.shipment_reference.as_deref(),
        payload.koli_id,
    );
    let now = now_text();
    let departed_at = time_text(payload.departed_at);
    let status: Option<String> = tx
        .query_row(
            "SELECT status FROM store_inbound_delivery WHERE delivery_id=?1",
            [&delivery_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?;
    let late = match status.as_deref() {
        None => {
            tx.execute(
                "INSERT INTO store_inbound_delivery
                     (delivery_id,source_site_id,shipment_reference,departed_at,status,
                      created_at,updated_at,destination_pool_id)
                 VALUES(?1,?2,?3,?4,'IN_TRANSIT',?5,?5,?6)",
                params![
                    delivery_id,
                    payload.source_site_id,
                    payload.shipment_reference,
                    departed_at,
                    now,
                    payload.destination_pool_id
                ],
            )
            .map_err(db)?;
            false
        }
        Some(STATUS_IN_TRANSIT) => {
            // Text timestamps in one fixed format compare as times. The koli
            // of one surat jalan all land in one pool; the first to name it
            // names it for the delivery.
            tx.execute(
                "UPDATE store_inbound_delivery
                 SET departed_at=MAX(departed_at,?2),updated_at=?3,
                     destination_pool_id=COALESCE(destination_pool_id,?4)
                 WHERE delivery_id=?1",
                params![delivery_id, departed_at, now, payload.destination_pool_id],
            )
            .map_err(db)?;
            false
        }
        Some(_) => {
            tracing::warn!(
                koli = %payload.koli_id,
                delivery = %delivery_id,
                "a koli was announced after its delivery was received; recorded, not counted"
            );
            true
        }
    };
    for unit in &payload.units {
        tx.execute(
            "INSERT OR IGNORE INTO store_inbound_unit
                 (delivery_id,koli_id,epc,sku_code,allotment_line_id,outcome,
                  late_announcement,command_id,created_at)
             VALUES(?1,?2,?3,?4,?5,NULL,?6,?7,?8)",
            params![
                delivery_id,
                payload.koli_id.to_string(),
                unit.epc.trim().to_ascii_uppercase(),
                unit.sku_code.trim().to_ascii_uppercase(),
                unit.allotment_line_id.to_string(),
                i64::from(late),
                command_id.to_string(),
                now
            ],
        )
        .map_err(db)?;
    }
    Ok(())
}

/// Tell head office what one delivery's receipt handed over and found, per
/// allotment line (`inventory.inbound.received.v1`), inside the receipt's own
/// transaction and after its transfer claims — so the centre, which applies
/// this node's facts in order, has every claim of the delivery before it reads
/// the delivery. The flow the goods travel on confirms its receipt from this
/// (`cloud::postgres::flow_stages`): what came off the lorry was handed over,
/// and what of it was not found is Missing at this site (allotment ALT-D01).
///
/// Nothing is sent when this node captures no facts, as with every other fact.
#[allow(clippy::too_many_arguments)]
pub(crate) fn enqueue_received(
    tx: &Transaction<'_>,
    site_id: &str,
    delivery_id: &str,
    receipt_id: Uuid,
    source_site_id: &str,
    shipment_reference: Option<&str>,
    landing_pool_id: &str,
    received_by: &str,
    received_at: DateTime<Utc>,
) -> Result<(), EdgeError> {
    use crate::sync::flow::{
        InboundReceivedLine, InboundReceivedPayload, FLOW_FACT_SCHEMA_VERSION,
        INVENTORY_INBOUND_RECEIVED_V1,
    };
    let mut by_line = tx
        .prepare(
            "SELECT allotment_line_id, sku_code, COUNT(*),
                    COALESCE(SUM(CASE WHEN outcome='RECEIVED' THEN 1 ELSE 0 END),0)
             FROM store_inbound_unit
             WHERE delivery_id=?1 AND late_announcement=0
             GROUP BY allotment_line_id, sku_code
             ORDER BY allotment_line_id, sku_code",
        )
        .map_err(db)?;
    let lines: Vec<InboundReceivedLine> = by_line
        .query_map([delivery_id], |row| {
            Ok(InboundReceivedLine {
                allotment_line_id: row
                    .get::<_, Option<String>>(0)?
                    .and_then(|line| Uuid::parse_str(&line).ok()),
                sku_code: row.get(1)?,
                expected: row.get(2)?,
                received: row.get(3)?,
            })
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    drop(by_line);
    let mut koli = tx
        .prepare(
            "SELECT DISTINCT koli_id FROM store_inbound_unit
             WHERE delivery_id=?1 AND late_announcement=0
             ORDER BY koli_id",
        )
        .map_err(db)?;
    let koli_ids: Vec<Uuid> = koli
        .query_map([delivery_id], |row| row.get::<_, String>(0))
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?
        .iter()
        .filter_map(|koli_id| Uuid::parse_str(koli_id).ok())
        .collect();
    drop(koli);
    let extra_units: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM store_inbound_extra WHERE delivery_id=?1",
            [delivery_id],
            |row| row.get(0),
        )
        .map_err(db)?;
    let payload = InboundReceivedPayload {
        schema_version: FLOW_FACT_SCHEMA_VERSION,
        receipt_id,
        delivery_id: delivery_id.to_owned(),
        source_site_id: source_site_id.to_owned(),
        destination_site_id: site_id.to_owned(),
        shipment_reference: shipment_reference.map(str::to_owned),
        landing_pool_id: landing_pool_id.to_owned(),
        koli_ids,
        lines,
        extra_units,
        received_by: received_by.to_owned(),
        received_at,
    };
    crate::edge::sync::enqueue_fact(tx, receipt_id, INVENTORY_INBOUND_RECEIVED_V1, &payload)
        .map_err(db)?;
    Ok(())
}

struct DeliveryRow {
    delivery_id: String,
    source_site_id: String,
    shipment_reference: Option<String>,
    departed_at: String,
    status: String,
    received_at: Option<String>,
    received_by: Option<String>,
    skipped_epcs_json: String,
    koli_count: i64,
}

const DELIVERY_COLUMNS: &str = "d.delivery_id,d.source_site_id,d.shipment_reference,d.departed_at,
     d.status,d.received_at,d.received_by,d.skipped_epcs_json,
     (SELECT COUNT(DISTINCT u.koli_id) FROM store_inbound_unit u
       WHERE u.delivery_id=d.delivery_id AND u.late_announcement=0) AS koli_count";

fn delivery_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DeliveryRow> {
    Ok(DeliveryRow {
        delivery_id: row.get(0)?,
        source_site_id: row.get(1)?,
        shipment_reference: row.get(2)?,
        departed_at: row.get(3)?,
        status: row.get(4)?,
        received_at: row.get(5)?,
        received_by: row.get(6)?,
        skipped_epcs_json: row.get(7)?,
        koli_count: row.get(8)?,
    })
}

fn present(connection: &Connection, row: DeliveryRow) -> Result<StoreInboundDelivery, EdgeError> {
    // Blind: nothing about the manifest's contents leaves this function while
    // the delivery is in transit.
    let result = if row.status == STATUS_RECEIVED {
        let (expected, received, missing): (i64, i64, i64) = connection
            .query_row(
                "SELECT COUNT(*),
                        COALESCE(SUM(CASE WHEN outcome='RECEIVED' THEN 1 ELSE 0 END),0),
                        COALESCE(SUM(CASE WHEN outcome='MISSING' THEN 1 ELSE 0 END),0)
                 FROM store_inbound_unit WHERE delivery_id=?1 AND late_announcement=0",
                [&row.delivery_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(db)?;
        let extra: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM store_inbound_extra WHERE delivery_id=?1",
                [&row.delivery_id],
                |r| r.get(0),
            )
            .map_err(db)?;
        Some(StoreInboundResult {
            expected_units: expected,
            received_units: received,
            missing_units: missing,
            extra_units: extra,
        })
    } else {
        None
    };
    Ok(StoreInboundDelivery {
        delivery_id: row.delivery_id,
        shipment_reference: row.shipment_reference,
        source_site_id: row.source_site_id,
        departed_at: parse_time(&row.departed_at)?,
        status: row.status,
        koli_count: row.koli_count,
        received_at: row.received_at.as_deref().map(parse_time).transpose()?,
        received_by: row.received_by,
        result,
    })
}

/// Deliveries announced to this shop, newest departure first, at most 200.
pub fn list(connection: &Connection, status: Option<&str>) -> Result<StoreInboundList, EdgeError> {
    let sql = format!(
        "SELECT {DELIVERY_COLUMNS} FROM store_inbound_delivery d
         WHERE (?1 IS NULL OR d.status=?1)
         ORDER BY d.departed_at DESC, d.delivery_id
         LIMIT ?2"
    );
    let mut statement = connection.prepare(&sql).map_err(db)?;
    let rows = statement
        .query_map(params![status, STORE_INBOUND_LIST_LIMIT], delivery_row)
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    let deliveries = rows
        .into_iter()
        .map(|row| present(connection, row))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(StoreInboundList { deliveries })
}

/// One delivery. Lines only once RECEIVED; while IN_TRANSIT the answer is the
/// header alone, with `lines` empty.
pub fn detail(connection: &Connection, delivery_id: &str) -> Result<StoreInboundDetail, EdgeError> {
    let sql = format!("SELECT {DELIVERY_COLUMNS} FROM store_inbound_delivery d WHERE d.delivery_id=?1");
    let row = connection
        .query_row(&sql, [delivery_id], delivery_row)
        .optional()
        .map_err(db)?
        .ok_or_else(|| EdgeError::NotFound(format!("inbound delivery {delivery_id}")))?;
    let received = row.status == STATUS_RECEIVED;
    let skipped_epcs: Vec<String> = if received {
        serde_json::from_str(&row.skipped_epcs_json)
            .map_err(|error| EdgeError::Persistence(error.to_string()))?
    } else {
        Vec::new()
    };
    let delivery = present(connection, row)?;
    if !received {
        return Ok(StoreInboundDetail {
            delivery,
            lines: Vec::new(),
            skipped_epcs,
        });
    }

    #[derive(Default)]
    struct Tally {
        expected: i64,
        received: i64,
        missing: i64,
        missing_epcs: BTreeSet<String>,
        extra_epcs: BTreeSet<String>,
    }
    let mut by_sku: BTreeMap<String, Tally> = BTreeMap::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT sku_code,epc,outcome FROM store_inbound_unit
                 WHERE delivery_id=?1 AND late_announcement=0",
            )
            .map_err(db)?;
        let units = statement
            .query_map([delivery_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(db)?;
        for unit in units {
            let (sku_code, epc, outcome) = unit.map_err(db)?;
            let tally = by_sku.entry(sku_code).or_default();
            tally.expected += 1;
            match outcome.as_deref() {
                Some("RECEIVED") => tally.received += 1,
                Some("MISSING") => {
                    tally.missing += 1;
                    tally.missing_epcs.insert(epc);
                }
                _ => {}
            }
        }
    }
    {
        let mut statement = connection
            .prepare("SELECT sku_code,epc FROM store_inbound_extra WHERE delivery_id=?1")
            .map_err(db)?;
        let extras = statement
            .query_map([delivery_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(db)?;
        for extra in extras {
            let (sku_code, epc) = extra.map_err(db)?;
            by_sku.entry(sku_code).or_default().extra_epcs.insert(epc);
        }
    }
    let mut name_of = connection
        .prepare("SELECT name FROM catalog_item WHERE sku_code=?1")
        .map_err(db)?;
    let mut lines = Vec::with_capacity(by_sku.len());
    for (sku_code, tally) in by_sku {
        let name: Option<String> = name_of
            .query_row([&sku_code], |r| r.get(0))
            .optional()
            .map_err(db)?;
        lines.push(StoreInboundLine {
            name,
            expected: tally.expected,
            received: tally.received,
            missing: tally.missing,
            extra: tally.extra_epcs.len() as i64,
            missing_epcs: tally.missing_epcs.into_iter().collect(),
            extra_epcs: tally.extra_epcs.into_iter().collect(),
            sku_code,
        });
    }
    Ok(StoreInboundDetail {
        delivery,
        lines,
        skipped_epcs,
    })
}
