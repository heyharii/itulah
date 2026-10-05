//! The surat jalan a store has received, one row each.
//!
//! # Why the centre answers this and not the Gudang
//!
//! The DC's own shipment stops at IN_TRANSIT: its position is derived from
//! what contains what, and nothing a store does changes that. The store knows
//! its receipt but only its own. The centre holds both halves: every store's
//! receipt as it was counted at the door (`edge_goods_step`, kind RECEIVED,
//! written once) and every tag a store booked later against the same surat
//! jalan (`edge_transfer_claim`, kind RECEIVED). So the operations board reads
//! its Received lane here.
//!
//! # What the numbers mean
//!
//! `sent_qty` is what the store's delivery said was on the lorry and
//! `received_qty` what it found at the door: both from the receipt, never
//! recounted. `found_qty` is what the store booked afterwards against the same
//! surat jalan, capped at the gap, because a tag read later that was never
//! missing is an extra, not a find. `open_gap_qty` is what is still short:
//! sent, less received at the door and found since. What stays short is
//! Missing, and Inventory settles it there — never on this list.
//!
//! A surat jalan is keyed by its number (`shipment_reference`) and the site it
//! left: the centre has no copy of the DC's shipment id, and the number is
//! what the store scanned.

use crate::cloud::application::AppError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgRow, PgPool, Row};
use uuid::Uuid;

/// The most rows one read returns, and the default when none is asked for.
const MAX_ROWS: i64 = 500;
const DEFAULT_ROWS: i64 = 200;

#[derive(Clone, Debug, Default, Deserialize)]
pub struct ReceivedShipmentQuery {
    /// One store, in the centre's spelling.
    #[serde(default)]
    pub destination_store_id: Option<String>,
    /// Receipts at or after this instant. A surat jalan still short is
    /// returned however old it is: an open gap is work, not history.
    #[serde(default)]
    pub since: Option<DateTime<Utc>>,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// One surat jalan as the store received it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReceivedShipment {
    /// The receipt itself.
    pub receipt_id: Uuid,
    /// The surat jalan number the store scanned.
    pub shipment_number: String,
    /// The store's delivery, as the store keys it.
    pub delivery_id: String,
    /// The store, in the centre's spelling.
    pub destination_store_id: String,
    pub destination_name: String,
    /// The site the lorry left, in its node's spelling.
    pub source_site_id: Option<String>,
    pub received_at: DateTime<Utc>,
    pub received_by: String,
    pub koli_count: i64,
    /// What the delivery said was on the lorry.
    pub sent_qty: i64,
    /// What the store found at the door.
    pub received_qty: i64,
    /// Booked later against this surat jalan, at most the gap.
    pub found_qty: i64,
    /// Still short: sent, less received at the door and found since.
    pub open_gap_qty: i64,
    /// Tags read that no koli of the delivery held.
    pub extra_qty: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReceivedShipmentList {
    /// Still-short first, then newest received first.
    pub items: Vec<ReceivedShipment>,
}

/// Every store receipt with its found, lost and open quantities. `$1` narrows
/// to one store and `$4` to one receipt; the caller writes its own SELECT over
/// `settled`.
const RECEIPTS: &str = "WITH receipt AS (
         SELECT g.event_id, g.delivery_id, g.site_id, s.name AS site_name,
                g.source_site_id, g.shipment_reference, g.occurred_at, g.actor_id,
                CASE WHEN jsonb_typeof(g.payload->'koli_ids') = 'array'
                     THEN jsonb_array_length(g.payload->'koli_ids') ELSE 0 END::bigint AS koli_count,
                COALESCE((g.payload->>'extra_units')::bigint, 0) AS extra_qty,
                COALESCE(SUM(l.expected), 0)::bigint AS sent_qty,
                COALESCE(SUM(l.quantity), 0)::bigint AS received_qty
         FROM edge_goods_step g
         -- A store's receipt only: the Gudang receives store returns under
         -- the same kind, and those are not a surat jalan going out.
         JOIN site s ON s.id = g.site_id AND s.kind = 'STORE'
         LEFT JOIN edge_goods_step_line l ON l.event_id = g.event_id
         WHERE g.kind = 'RECEIVED'
           AND g.shipment_reference IS NOT NULL
           AND ($1::text IS NULL OR g.site_id = $1)
           AND ($4::uuid IS NULL OR g.event_id = $4)
         GROUP BY g.event_id, s.name
     ),
     later AS (
         SELECT r.event_id, COUNT(c.event_id)::bigint AS booked
         FROM receipt r
         JOIN edge_transfer_claim c
           ON c.claim_kind = 'RECEIVED'
          AND c.shipment_reference = r.shipment_reference
          AND c.source_dc_id IS NOT DISTINCT FROM r.source_site_id
          AND c.receipt_id <> r.event_id
          AND c.occurred_at >= r.occurred_at
         GROUP BY r.event_id
     ),
     counted AS (
         SELECT r.*,
                LEAST(COALESCE(l.booked, 0), GREATEST(r.sent_qty - r.received_qty, 0)) AS found_qty
         FROM receipt r
         LEFT JOIN later l ON l.event_id = r.event_id
     ),
     settled AS (
         SELECT counted.*,
                GREATEST(sent_qty - received_qty - found_qty, 0)::bigint AS open_gap_qty
         FROM counted
     )";

pub async fn list_received_shipments(
    pool: &PgPool,
    query: ReceivedShipmentQuery,
) -> Result<ReceivedShipmentList, AppError> {
    let limit = query.limit.unwrap_or(DEFAULT_ROWS).clamp(1, MAX_ROWS);
    let store = query
        .destination_store_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());
    let rows = sqlx::query(&format!(
        "{RECEIPTS}
         SELECT * FROM settled
         WHERE $2::timestamptz IS NULL OR occurred_at >= $2 OR open_gap_qty > 0
         ORDER BY (open_gap_qty > 0) DESC, occurred_at DESC
         LIMIT $3"
    ))
    .bind(store)
    .bind(query.since)
    .bind(limit)
    .bind(None::<Uuid>)
    .fetch_all(pool)
    .await?;
    Ok(ReceivedShipmentList {
        items: rows.iter().map(present).collect(),
    })
}

fn present(row: &PgRow) -> ReceivedShipment {
    ReceivedShipment {
        receipt_id: row.get("event_id"),
        shipment_number: row.get("shipment_reference"),
        delivery_id: row.get("delivery_id"),
        destination_store_id: row.get("site_id"),
        destination_name: row.get("site_name"),
        source_site_id: row.get("source_site_id"),
        received_at: row.get("occurred_at"),
        received_by: row.get("actor_id"),
        koli_count: row.get("koli_count"),
        sent_qty: row.get("sent_qty"),
        received_qty: row.get("received_qty"),
        found_qty: row.get("found_qty"),
        open_gap_qty: row.get("open_gap_qty"),
        extra_qty: row.get("extra_qty"),
    }
}
