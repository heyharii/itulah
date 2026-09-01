#![allow(clippy::items_after_test_module)]

//! The SQLite adapter for the shared sync engine.
//!
//! This is the edge twin of `cloud::postgres::sync`. It answers the same
//! [`SyncStore`] questions the cloud adapter answers, and it contains no
//! settlement decision of its own — those live in the domain and are driven
//! by `sync::run_cycle`, which both nodes share. A behaviour that appears
//! here and not there is a bug in one of them, and the conformance suite in
//! `tests/sync_conformance.rs` is what catches it.
//!
//! # SQLite instead of row locks
//!
//! PostgreSQL serialises the sequence allocator with `SELECT ... FOR UPDATE`.
//! SQLite has exactly one writer, so `BEGIN IMMEDIATE` takes the write lock
//! for the whole transaction and gives the same guarantee: allocation commits
//! — and rolls back — with the domain write that produced the fact.
//!
//! # Blocking storage inside async methods
//!
//! The trait is async because the cloud adapter genuinely awaits its network
//! database. Here the work is a local file, measured in microseconds, so it
//! runs inline rather than on a blocking pool: a `spawn_blocking` round trip
//! per statement would cost more than the statement.

use crate::cloud::domain::{
    catalog_content_hash, cooldown_after_failure, parse_catalog_chunk, parse_purchase_order,
    ActivatePublicationPayload, CatalogChunkPayload, CatalogItem, PurchaseOrderPayload,
    COMMAND_CATALOG_CHUNK, COMMAND_PURCHASE_ORDER_ACTIVATE,
};
use crate::cloud::domain::{
    decide_command, parse_activate_publication, parse_auth_policy, AuthPolicySnapshot,
    BreakerPolicy, CommandBlock, CommandDisposition, PushedCommand, RejectedFact, SyncFact,
    COMMAND_ACTIVATE_PUBLICATION, COMMAND_AUTH_POLICY_REPLACE,
};
use crate::edge::{
    derive_allotment_status, EdgeRole, InventoryState, MovementCause, MovementCommand,
    MovementGroupId, MovementLine, NodeContext, OperationalPool, Place, SiteId, SqliteEdge,
    SubjectId, SystemPlace,
};
use crate::sync::port::{CommandApplyReport, SenderState, SyncStore};
use crate::sync::workflow::{
    parse_allotment_activation, parse_allotment_cancellation, parse_official_count_activation,
    parse_official_count_adjustment, AdjustmentResultStatus, AllotmentActivationPayload,
    AllotmentApplicationLine, AllotmentApplicationResultPayload, AllotmentCancellationPayload,
    AllotmentCancellationResultLine, AllotmentCancellationResultPayload, ApplicationDecision,
    CancellationOutcome, OfficialCountActivationPayload, OfficialCountAdjustmentLine,
    OfficialCountAdjustmentPayload, OfficialCountAdjustmentResultPayload,
    INVENTORY_ALLOTMENT_ACTIVATE_V1, INVENTORY_ALLOTMENT_APPLICATION_RESULT_V1,
    INVENTORY_ALLOTMENT_CANCELLATION_RESULT_V1, INVENTORY_ALLOTMENT_CANCEL_V1,
    INVENTORY_OFFICIAL_COUNT_ACTIVATE_V1, INVENTORY_OFFICIAL_COUNT_ADJUSTMENT_RESULT_V1,
    INVENTORY_OFFICIAL_COUNT_ADJUST_V1, INVENTORY_WORKFLOW_SCHEMA_VERSION,
};
use crate::sync::SyncError;
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    str::FromStr,
    sync::{Arc, Mutex},
};
use tokio::sync::Notify;
use uuid::Uuid;

/// Render a group of shop ids for storage, or nothing at all.
///
/// An empty list is stored as NULL rather than `[]`. The two would read the
/// same to a careless query and mean opposite things: no group named, versus a
/// group that names nobody.
fn site_ids_document(site_ids: Option<&[String]>) -> Result<Option<String>, SyncError> {
    match site_ids {
        Some(ids) if !ids.is_empty() => serde_json::to_string(ids).map(Some).map_err(err),
        _ => Ok(None),
    }
}

fn err(error: impl std::fmt::Display) -> SyncError {
    SyncError::new(error)
}

fn now_text() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn time_text(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn parse_time(value: &str) -> Result<DateTime<Utc>, SyncError> {
    DateTime::parse_from_rfc3339(value)
        .map(|parsed| parsed.with_timezone(&Utc))
        .map_err(|error| err(format!("malformed timestamp {value}: {error}")))
}

fn parse_time_opt(value: Option<String>) -> Result<Option<DateTime<Utc>>, SyncError> {
    value.as_deref().map(parse_time).transpose()
}

/// The edge's durable sync state, over the node's SQLite connection.
///
/// Holds the same `Arc<Mutex<Connection>>` the inventory adapter holds, so a
/// fact and the movement that produced it commit in ONE transaction on ONE
/// connection — the invariant the whole design rests on.
#[derive(Clone)]
pub struct SqliteSyncStore {
    connection: Arc<Mutex<Connection>>,
}

impl SqliteSyncStore {
    pub fn new(connection: Arc<Mutex<Connection>>) -> Self {
        Self { connection }
    }

    fn with_connection<T>(
        &self,
        action: impl FnOnce(&mut Connection) -> Result<T, SyncError>,
    ) -> Result<T, SyncError> {
        let mut guard = self
            .connection
            .lock()
            .map_err(|_| err("edge sync connection is poisoned"))?;
        action(&mut guard)
    }
}

/// Append one fact to the ordered log INSIDE the caller's transaction.
///
/// Returns `None` when this node has enqueueing disabled, so the domain path
/// stays the same whether or not the node syncs. Serialization is performed
/// before sequence allocation and any error aborts the caller's transaction.
pub fn enqueue_fact<T: Serialize + ?Sized>(
    tx: &Transaction<'_>,
    event_id: Uuid,
    event_type: &str,
    payload: &T,
) -> rusqlite::Result<Option<i64>> {
    let origin: Option<(String, i64, i64)> = tx
        .query_row(
            "SELECT origin_id, generation, next_seq FROM sync_origin WHERE enqueue_enabled = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((origin_id, generation, next_seq)) = origin else {
        return Ok(None);
    };
    let payload = serde_json::to_string(payload)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let seq = next_seq + 1;
    tx.execute("UPDATE sync_origin SET next_seq = ?1", params![seq])?;
    tx.execute(
        "INSERT INTO sync_fact_log
             (origin_id, generation, seq, event_id, event_type, payload, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            origin_id,
            generation,
            seq,
            event_id.to_string(),
            event_type,
            payload,
            now_text()
        ],
    )?;
    Ok(Some(seq))
}

/// Backlog and dead-letter counts for this edge's active stream.
pub fn backlog(connection: &Connection) -> rusqlite::Result<(i64, i64, i64)> {
    let origin: Option<(String, i64)> = connection
        .query_row(
            "SELECT origin_id, generation FROM sync_origin WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((origin_id, generation)) = origin else {
        return Ok((0, 0, 0));
    };
    let watermark: i64 = connection
        .query_row(
            "SELECT durable_seq FROM sync_watermark WHERE origin_id=?1 AND generation=?2",
            params![origin_id, generation],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(0);
    let backlog: i64 = connection.query_row(
        "SELECT count(*) FROM sync_fact_log
         WHERE origin_id=?1 AND generation=?2 AND seq>?3",
        params![origin_id, generation, watermark],
        |row| row.get(0),
    )?;
    let dead: i64 = connection.query_row(
        "SELECT count(*) FROM sync_dead_letter WHERE origin_id=?1 AND generation=?2",
        params![origin_id, generation],
        |row| row.get(0),
    )?;
    Ok((watermark, backlog, dead))
}

/// Delete synced facts older than the retention window. Dead letters stay.
pub fn purge_synced(connection: &Connection, retention_days: i64) -> rusqlite::Result<usize> {
    let cutoff = Utc::now() - chrono::Duration::days(retention_days.max(0));
    connection.execute(
        "DELETE FROM sync_fact_log
         WHERE created_at < ?1
           AND seq <= COALESCE((SELECT durable_seq FROM sync_watermark
                                WHERE origin_id = sync_fact_log.origin_id
                                  AND generation = sync_fact_log.generation), 0)",
        params![time_text(cutoff)],
    )
}

fn read_sender_state(connection: &Connection) -> Result<SenderState, SyncError> {
    let row = connection
        .query_row(
            "SELECT consecutive_failures, breaker_open_until, last_success_at, last_error, last_error_at
             FROM sync_sender_state",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()
        .map_err(err)?;
    let Some((failures, open_until, success_at, last_error, error_at)) = row else {
        return Ok(SenderState::default());
    };
    Ok(SenderState {
        consecutive_failures: failures.max(0) as u32,
        breaker_open_until: parse_time_opt(open_until)?,
        last_success_at: parse_time_opt(success_at)?,
        last_error,
        last_error_at: parse_time_opt(error_at)?,
    })
}

fn read_command_watermark(
    connection: &Connection,
) -> Result<(i64, Option<CommandBlock>), SyncError> {
    let row = connection
        .query_row(
            "SELECT applied_seq, blocked_at_seq, blocked_reason FROM sync_command_watermark",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(err)?;
    Ok(match row {
        None => (0, None),
        Some((applied, blocked_seq, reason)) => (
            applied,
            blocked_seq.map(|seq| CommandBlock {
                seq,
                reason: reason.unwrap_or_default(),
            }),
        ),
    })
}

fn record_command_block(connection: &Connection, seq: i64, reason: &str) -> Result<(), SyncError> {
    let bounded: String = reason.chars().take(500).collect();
    connection
        .execute(
            "INSERT INTO sync_command_watermark
                 (singleton, applied_seq, blocked_at_seq, blocked_reason, blocked_since, updated_at)
             VALUES (1, 0, ?1, ?2, ?3, ?3)
             ON CONFLICT(singleton) DO UPDATE SET
                 blocked_at_seq = ?1,
                 blocked_reason = ?2,
                 blocked_since = CASE
                     WHEN sync_command_watermark.blocked_at_seq = ?1
                         THEN COALESCE(sync_command_watermark.blocked_since, ?3)
                     ELSE ?3 END,
                 updated_at = ?3",
            params![seq, bounded, now_text()],
        )
        .map_err(err)?;
    Ok(())
}

/// Replay one activation into this edge's commercial tables.
///
/// The edge keeps a flattened copy — enough to price a basket with no round
/// trip — rather than the cloud's authoring schema. It is a read model that
/// the command owns: replaced wholesale, never merged, because the activation
/// carries the whole version.
fn apply_activation(
    tx: &Transaction<'_>,
    payload: &ActivatePublicationPayload,
) -> Result<(), SyncError> {
    let publication_id = payload.publication_id.to_string();
    // A version already resident is the same immutable version, so a replay
    // is a no-op. That makes the command idempotent without a second key.
    let resident: Option<i64> = tx
        .query_row(
            "SELECT version FROM commercial_publication WHERE id = ?1",
            params![publication_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    if resident.is_some() {
        return Ok(());
    }
    tx.execute(
        "INSERT INTO commercial_publication
             (id, version, name, effective_from, effective_to, activated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            publication_id,
            payload.version,
            payload.name,
            time_text(payload.effective_from),
            payload.effective_to.map(time_text),
            now_text()
        ],
    )
    .map_err(err)?;
    for rule in &payload.tax_rules {
        tx.execute(
            "INSERT INTO commercial_tax_rule
                 (publication_id, tax_category, rate_bps, tax_inclusive)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                publication_id,
                rule.tax_category,
                rule.rate_bps,
                i64::from(rule.tax_inclusive)
            ],
        )
        .map_err(err)?;
    }
    for rule in &payload.price_rules {
        tx.execute(
            "INSERT INTO commercial_price_rule
                 (publication_id, sku_id, sku_code, site_id, site_ids_json, tier,
                  channel, sellable, currency, unit_price_minor, tax_category)
             VALUES (?1, ?2, ?3, ?4, ?10, ?11, ?5, ?6, ?7, ?8, ?9)",
            params![
                publication_id,
                rule.sku_id.to_string(),
                rule.sku_code.trim(),
                rule.site_id,
                rule.channel,
                i64::from(rule.sellable),
                rule.currency,
                rule.unit_price_minor,
                rule.tax_category,
                site_ids_document(rule.site_ids.as_deref())?,
                rule.tier,
            ],
        )
        .map_err(err)?;
    }
    for markdown in &payload.markdowns {
        tx.execute(
            "INSERT INTO commercial_markdown
                 (markdown_id, publication_id, sku_code, article_code, site_id,
                  site_ids_json, tier, replacement_unit_price_minor, priority,
                  effective_from, effective_to)
             VALUES (?1, ?2, ?3, ?4, ?5, ?10, ?11, ?6, ?7, ?8, ?9)",
            params![
                markdown.markdown_id,
                publication_id,
                markdown.sku_code,
                markdown.article_code,
                markdown.site_id,
                markdown.replacement_unit_price_minor,
                markdown.priority,
                time_text(markdown.effective_from),
                markdown.effective_to.map(time_text),
                site_ids_document(markdown.site_ids.as_deref())?,
                markdown.tier,
            ],
        )
        .map_err(err)?;
    }
    // Campaigns land before the rules that name them would be read, so a shop
    // never holds an offer whose envelope is missing.
    for campaign in &payload.campaigns {
        tx.execute(
            "INSERT INTO commercial_campaign
                 (campaign_id, publication_id, name, status, valid_from, valid_to,
                  budget_minor, spent_minor, max_uses, used, max_uses_per_customer)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                campaign.campaign_id,
                publication_id,
                campaign.name,
                campaign.status,
                campaign.valid_from.map(time_text),
                campaign.valid_to.map(time_text),
                campaign.budget_minor,
                campaign.spent_minor,
                campaign.max_uses,
                campaign.used,
                campaign.max_uses_per_customer,
            ],
        )
        .map_err(err)?;
    }
    // Promotions are stored as the centre sent them. See the payload type for
    // why this shop does not parse them here: a promotion it cannot read must
    // cost it an offer, never the ability to price.
    for rule in &payload.rules {
        let rule_id = rule
            .get("rule_id")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| err("promotion rule has no rule_id"))?;
        let name = rule
            .get("name")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(rule_id);
        let status = rule
            .get("status")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("ACTIVE");
        let priority = rule
            .get("priority")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0);
        tx.execute(
            "INSERT INTO commercial_rule
                 (rule_id, publication_id, name, definition_json, status, priority)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                rule_id,
                publication_id,
                name,
                serde_json::to_string(rule).map_err(err)?,
                status,
                priority
            ],
        )
        .map_err(err)?;
    }
    for coupon in &payload.coupons {
        tx.execute(
            "INSERT INTO commercial_coupon
                 (code, publication_id, rule_id, active, customer_id,
                  valid_from, valid_to, max_uses, used)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                coupon.code,
                publication_id,
                coupon.rule_id,
                i64::from(coupon.active),
                coupon.customer_id,
                coupon.valid_from.map(time_text),
                coupon.valid_to.map(time_text),
                coupon.max_uses,
                coupon.used,
            ],
        )
        .map_err(err)?;
    }

    // Say so, in the same transaction that put it into service.
    //
    // In the same transaction because the two must not be able to disagree: a
    // shop that is charging these prices and has not reported it looks
    // identical, from the centre, to one whose sync has stalled — and the
    // difference between those two is whether anybody needs to drive out there.
    //
    // The publication id is the fact's event id, so a replay is deduplicated by
    // the lane rather than counted twice.
    let activated_at = now_text();
    let price_rule_count = payload.price_rules.len() as i64;
    enqueue_fact(
        tx,
        payload.publication_id,
        crate::cloud::domain::FACT_PUBLICATION_ACTIVATED,
        &serde_json::json!({
            "publication_id": payload.publication_id,
            "version": payload.version,
            "activated_at": activated_at,
            "price_rule_count": price_rule_count,
        }),
    )
    .map_err(err)?;
    Ok(())
}

/// Replace what this shop believes promotions have already given away.
///
/// The whole table is swapped, not merged: the command carries the whole
/// picture, so anything absent from it is a promotion the centre no longer
/// counts. Merging would leave a retired campaign's total sitting here forever,
/// quietly holding a budget closed that nobody is spending.
fn apply_commercial_usage(
    tx: &Transaction<'_>,
    payload: &crate::cloud::domain::CommercialUsagePayload,
) -> Result<(), SyncError> {
    tx.execute("DELETE FROM commercial_usage", [])
        .map_err(err)?;
    for count in &payload.counts {
        tx.execute(
            "INSERT INTO commercial_usage (kind, key, uses, spent_minor, as_of)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                count.kind,
                count.key.trim(),
                count.uses,
                count.spent_minor,
                time_text(payload.counted_at)
            ],
        )
        .map_err(err)?;
    }
    Ok(())
}

/// Land one catalogue chunk, and swap the whole snapshot in when the last
/// one arrives.
///
/// Nothing is visible to the till until the run is complete AND the hash over
/// every item matches what the centre declared. A half-applied catalogue is
/// worse than none: it prices some items and silently omits others, and the
/// omission looks like a missing product rather than a broken delivery.
///
/// Chunks need no reordering logic. They arrive on the command stream, which
/// is already contiguous and gap-free, so chunk N cannot overtake chunk N-1.
fn apply_catalog_chunk(tx: &Transaction<'_>, chunk: &CatalogChunkPayload) -> Result<(), SyncError> {
    // Anti-rollback. A replayed or late publication must never walk the
    // catalogue backwards; the generation is the fleet's ordering, and this
    // edge honours only forward moves.
    let resident: Option<i64> = tx
        .query_row("SELECT generation FROM catalog_state", [], |row| row.get(0))
        .optional()
        .map_err(err)?;
    if let Some(resident) = resident {
        if chunk.generation < resident {
            // Not an error: an old generation arriving after a newer one is
            // ordinary during a re-publication, and refusing to APPLY it is
            // the correct outcome, not a reason to block the stream.
            tracing::info!(
                resident,
                offered = chunk.generation,
                "ignoring a catalogue generation older than the resident one"
            );
            return Ok(());
        }
        if chunk.generation == resident {
            return Ok(()); // already honoured; a replay
        }
    }
    tx.execute(
        "INSERT OR REPLACE INTO catalog_staging
             (snapshot_id, generation, chunk_index, chunk_count, items_json, received_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            chunk.snapshot_id.to_string(),
            chunk.generation,
            chunk.chunk_index,
            chunk.chunk_count,
            serde_json::to_string(&chunk.items).unwrap_or_else(|_| "[]".into()),
            now_text()
        ],
    )
    .map_err(err)?;

    let staged: i64 = tx
        .query_row(
            "SELECT count(*) FROM catalog_staging WHERE snapshot_id = ?1",
            params![chunk.snapshot_id.to_string()],
            |row| row.get(0),
        )
        .map_err(err)?;
    if staged < i64::from(chunk.chunk_count) {
        return Ok(()); // still arriving
    }

    // Complete: rebuild the item list in delivery order and check it against
    // the hash the centre committed to before any of it becomes visible.
    let mut items: Vec<CatalogItem> = Vec::new();
    {
        let mut statement = tx
            .prepare(
                "SELECT items_json FROM catalog_staging
                 WHERE snapshot_id = ?1 ORDER BY chunk_index",
            )
            .map_err(err)?;
        let rows = statement
            .query_map(params![chunk.snapshot_id.to_string()], |row| {
                row.get::<_, String>(0)
            })
            .map_err(err)?;
        for row in rows {
            let json = row.map_err(err)?;
            let mut part: Vec<CatalogItem> = serde_json::from_str(&json)
                .map_err(|error| err(format!("staged catalogue chunk is unreadable: {error}")))?;
            items.append(&mut part);
        }
    }
    let actual = catalog_content_hash(&items);
    if actual != chunk.content_hash {
        // Discard the whole staged run: a mismatch means the pieces we hold
        // are not the catalogue the centre published, and keeping them would
        // let a later chunk complete a set nobody authored.
        tx.execute(
            "DELETE FROM catalog_staging WHERE snapshot_id = ?1",
            params![chunk.snapshot_id.to_string()],
        )
        .map_err(err)?;
        return Err(err(format!(
            "catalogue content hash mismatch: expected {}, assembled {actual}",
            chunk.content_hash
        )));
    }

    // The swap. Whole-table replace, in the caller's transaction, so the till
    // never observes a partial catalogue.
    tx.execute("DELETE FROM catalog_item", []).map_err(err)?;
    for item in &items {
        tx.execute(
            "INSERT INTO catalog_item
                 (sku_code, name, uom, barcode, tax_category, active, generation,
                  updated_at, base_price_minor)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                item.sku_code,
                item.name,
                item.uom,
                item.barcode,
                item.tax_category,
                i64::from(item.active),
                chunk.generation,
                now_text(),
                item.base_price_minor,
            ],
        )
        .map_err(err)?;
    }
    tx.execute(
        "INSERT INTO catalog_state
             (singleton, snapshot_id, generation, item_count, content_hash, activated_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(singleton) DO UPDATE SET
             snapshot_id = ?1, generation = ?2, item_count = ?3,
             content_hash = ?4, activated_at = ?5",
        params![
            chunk.snapshot_id.to_string(),
            chunk.generation,
            items.len() as i64,
            chunk.content_hash,
            now_text()
        ],
    )
    .map_err(err)?;
    tx.execute(
        "DELETE FROM catalog_staging WHERE snapshot_id = ?1",
        params![chunk.snapshot_id.to_string()],
    )
    .map_err(err)?;
    Ok(())
}

fn command_node(tx: &Transaction<'_>) -> Result<NodeContext, SyncError> {
    let (node_id, role, site_id): (String, String, String) = tx
        .query_row(
            "SELECT node_id,role,site_id FROM node_metadata WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(err)?;
    let role = EdgeRole::from_str(&role).map_err(err)?;
    let site_id = SiteId::new(site_id).map_err(err)?;
    NodeContext::new(node_id, role, site_id).map_err(err)
}

fn require_dc_work_owner(tx: &Transaction<'_>, site_id: &str) -> Result<NodeContext, SyncError> {
    let node = command_node(tx)?;
    if node.role != EdgeRole::Dc || node.site_id.as_str() != site_id {
        return Err(err(format!(
            "inventory work for DC {site_id} cannot apply on {}/{}",
            node.role, node.site_id
        )));
    }
    Ok(node)
}

fn apply_allotment_activation(
    tx: &Transaction<'_>,
    command_id: Uuid,
    payload: &AllotmentActivationPayload,
) -> Result<(), SyncError> {
    let node = require_dc_work_owner(tx, &payload.source_site_id)?;
    let mut requested_by_stock = BTreeMap::<(String, String), i64>::new();
    for line in &payload.lines {
        let source = OperationalPool::from_str(&line.source_pool_id).map_err(err)?;
        if !source.is_dc_fulfillment_source_for(&node.site_id) {
            return Err(err(format!(
                "allotment source pool {} is not an allowed non-fulfillment pool for {}",
                line.source_pool_id, node.site_id
            )));
        }
        let requested = requested_by_stock
            .entry((line.source_pool_id.clone(), line.sku_code.clone()))
            .or_default();
        *requested = requested
            .checked_add(line.quantity)
            .ok_or_else(|| err("allotment requested quantity overflow"))?;
    }

    let mut available_by_stock = BTreeMap::<(String, String), i64>::new();
    let mut shortages = Vec::new();
    for ((pool_id, sku_code), requested) in &requested_by_stock {
        let physical: i64 = tx
            .query_row(
                "SELECT COALESCE(SUM(projection.quantity),0)
                 FROM inventory_projection projection
                 JOIN inventory_subject subject ON subject.id=projection.subject_id
                 WHERE projection.place_id=?1 AND subject.sku_code=?2",
                params![format!("{pool_id}:on_hand"), sku_code],
                |row| row.get(0),
            )
            .map_err(err)?;
        let reserved: i64 = tx
            .query_row(
                "SELECT COALESCE(SUM(line.accepted_quantity-line.picked_quantity-line.cancelled_quantity),0)
                 FROM dc_allotment_work_line line
                 JOIN dc_allotment_work work ON work.allotment_id=line.allotment_id
                 WHERE work.application_status='ACCEPTED'
                   AND line.source_pool_id=?1 AND line.sku_code=?2",
                params![pool_id, sku_code],
                |row| row.get(0),
            )
            .map_err(err)?;
        let available = physical.checked_sub(reserved).ok_or_else(|| {
            err(format!(
                "availability overflow for pool {pool_id} SKU {sku_code}"
            ))
        })?;
        let reportable_available = available.max(0);
        available_by_stock.insert((pool_id.clone(), sku_code.clone()), reportable_available);
        if *requested > reportable_available {
            shortages.push(format!(
                "{pool_id}/{sku_code}: requested {requested}, available {reportable_available}"
            ));
        }
    }

    let decision = if shortages.is_empty() {
        ApplicationDecision::Accepted
    } else {
        ApplicationDecision::Rejected
    };
    let result_id = Uuid::new_v4();
    let applied_at = Utc::now();
    let result_lines = payload
        .lines
        .iter()
        .map(|line| AllotmentApplicationLine {
            allotment_line_id: line.allotment_line_id,
            planned_quantity: line.quantity,
            accepted_quantity: if decision == ApplicationDecision::Accepted {
                line.quantity
            } else {
                0
            },
            available_quantity: available_by_stock
                .get(&(line.source_pool_id.clone(), line.sku_code.clone()))
                .copied()
                .unwrap_or_default(),
        })
        .collect::<Vec<_>>();
    let result = AllotmentApplicationResultPayload {
        schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
        result_id,
        activation_command_id: command_id,
        allotment_id: payload.allotment_id,
        source_site_id: payload.source_site_id.clone(),
        decision,
        rejection_code: (!shortages.is_empty()).then(|| "INSUFFICIENT_STOCK".to_string()),
        reason: (!shortages.is_empty()).then(|| shortages.join("; ")),
        lines: result_lines,
        applied_at,
    };
    result.validate().map_err(err)?;
    let application_fact_seq = enqueue_fact(
        tx,
        result_id,
        INVENTORY_ALLOTMENT_APPLICATION_RESULT_V1,
        &result,
    )
    .map_err(err)?
    .ok_or_else(|| err("allotment application result capture is disabled"))?;

    let application_status = if decision == ApplicationDecision::Accepted {
        "ACCEPTED"
    } else {
        "REJECTED"
    };
    let fulfillment_status = if decision == ApplicationDecision::Accepted {
        "OPEN"
    } else {
        "REJECTED"
    };
    tx.execute(
        "INSERT INTO dc_allotment_work
             (allotment_id,command_id,allotment_number,allotment_type,source_site_id,
              application_status,fulfillment_status,application_result_id,
              application_fact_seq,rejection_code,rejection_reason,created_by,notes,
              created_at,applied_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15)",
        params![
            payload.allotment_id.to_string(),
            command_id.to_string(),
            payload.allotment_number,
            payload.allotment_type,
            payload.source_site_id,
            application_status,
            fulfillment_status,
            result_id.to_string(),
            application_fact_seq,
            result.rejection_code,
            result.reason,
            payload.created_by,
            payload.notes,
            time_text(payload.created_at),
            time_text(applied_at),
        ],
    )
    .map_err(err)?;
    for line in &payload.lines {
        let accepted_quantity = if decision == ApplicationDecision::Accepted {
            line.quantity
        } else {
            0
        };
        tx.execute(
            "INSERT INTO dc_allotment_work_line
                 (allotment_line_id,allotment_id,source_pool_id,destination_type,
                  destination_id,sku_id,sku_code,planned_quantity,accepted_quantity,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                line.allotment_line_id.to_string(),
                payload.allotment_id.to_string(),
                line.source_pool_id,
                line.destination_type,
                line.destination_id,
                line.sku_id.to_string(),
                line.sku_code,
                line.quantity,
                accepted_quantity,
                time_text(applied_at),
            ],
        )
        .map_err(err)?;
    }

    // The result fact precedes this checkpoint. Once Cloud applies through the
    // snapshot seq it can independently compare observed Allotted with the
    // reservation derived from facts.
    crate::edge::SqliteEdge::enqueue_pool_snapshot(tx, &node, Uuid::new_v4())
        .map(|_| ())
        .map_err(err)
}

/// Cancel only the reservation that is still unpicked when this exact-target
/// command reaches the authoritative DC. Picked/packed/package quantities and
/// physical inventory are deliberately untouched.
fn apply_allotment_cancellation(
    tx: &Transaction<'_>,
    command_id: Uuid,
    payload: &AllotmentCancellationPayload,
) -> Result<(), SyncError> {
    let node = require_dc_work_owner(tx, &payload.source_site_id)?;
    let (application_status, fulfillment_status): (String, String) = tx
        .query_row(
            "SELECT application_status,fulfillment_status
             FROM dc_allotment_work
             WHERE allotment_id=?1 AND source_site_id=?2",
            params![payload.allotment_id.to_string(), payload.source_site_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(err)?
        .ok_or_else(|| err(format!("unknown Allotment {}", payload.allotment_id)))?;
    if application_status != "ACCEPTED"
        || !matches!(
            fulfillment_status.as_str(),
            "OPEN" | "IN_PROGRESS" | "DC_COMPLETED"
        )
    {
        return Err(err(format!(
            "Allotment {} is not cancellable: application={application_status}, fulfillment={fulfillment_status}",
            payload.allotment_id
        )));
    }
    if tx
        .query_row(
            "SELECT 1 FROM dc_allotment_cancellation WHERE allotment_id=?1",
            [payload.allotment_id.to_string()],
            |_| Ok(()),
        )
        .optional()
        .map_err(err)?
        .is_some()
    {
        return Err(err(format!(
            "Allotment {} already has a cancellation result",
            payload.allotment_id
        )));
    }

    let stored_lines = {
        let mut statement = tx
            .prepare(
                "SELECT allotment_line_id,accepted_quantity,picked_quantity,cancelled_quantity
                 FROM dc_allotment_work_line
                 WHERE allotment_id=?1 ORDER BY allotment_line_id",
            )
            .map_err(err)?;
        let rows = statement
            .query_map([payload.allotment_id.to_string()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)?
    };
    let requested = payload
        .lines
        .iter()
        .map(|line| (line.allotment_line_id, line))
        .collect::<BTreeMap<_, _>>();
    if stored_lines.len() != requested.len() {
        return Err(err(
            "cancellation line set differs from the accepted Allotment",
        ));
    }

    let mut result_lines = Vec::with_capacity(stored_lines.len());
    let mut cancelled_total = 0_i64;
    let mut blocked_total = 0_i64;
    for (line_id_text, accepted, picked, already_cancelled) in &stored_lines {
        let line_id = Uuid::parse_str(line_id_text).map_err(err)?;
        let requested_line = requested
            .get(&line_id)
            .ok_or_else(|| err(format!("cancellation omits accepted line {line_id}")))?;
        if *accepted <= 0 || requested_line.quantity != *accepted {
            return Err(err(format!(
                "cancellation must request the full accepted quantity for line {line_id}"
            )));
        }
        let actual_cancelled = accepted
            .checked_sub(*picked)
            .and_then(|quantity| quantity.checked_sub(*already_cancelled))
            .filter(|quantity| *quantity >= 0)
            .ok_or_else(|| err(format!("invalid reservation progress for line {line_id}")))?;
        let blocked_picked = requested_line
            .quantity
            .checked_sub(actual_cancelled)
            .ok_or_else(|| err("cancellation quantity underflow"))?;
        cancelled_total = cancelled_total
            .checked_add(actual_cancelled)
            .ok_or_else(|| err("cancelled quantity overflow"))?;
        blocked_total = blocked_total
            .checked_add(blocked_picked)
            .ok_or_else(|| err("blocked Pick quantity overflow"))?;
        result_lines.push(AllotmentCancellationResultLine {
            allotment_line_id: line_id,
            requested_quantity: requested_line.quantity,
            cancelled_quantity: actual_cancelled,
            blocked_picked_quantity: blocked_picked,
        });
    }

    let outcome = match (cancelled_total > 0, blocked_total > 0) {
        (true, false) => CancellationOutcome::Applied,
        (true, true) => CancellationOutcome::PartiallyApplied,
        (false, true) => CancellationOutcome::Rejected,
        (false, false) => return Err(err("cancellation produced no outcome")),
    };
    let result_reason = match outcome {
        CancellationOutcome::Applied => None,
        CancellationOutcome::PartiallyApplied => Some(format!(
            "{blocked_total} accepted unit(s) were already Picked and remain eligible for fulfillment"
        )),
        CancellationOutcome::Rejected => Some(format!(
            "all {blocked_total} accepted unit(s) were already Picked and cannot be cancelled"
        )),
    };
    let result_id = Uuid::new_v4();
    let applied_at = Utc::now();
    let result = AllotmentCancellationResultPayload {
        schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
        result_id,
        cancellation_id: payload.cancellation_id,
        cancellation_command_id: command_id,
        allotment_id: payload.allotment_id,
        source_site_id: payload.source_site_id.clone(),
        outcome,
        reason: result_reason,
        lines: result_lines,
        applied_at,
    };
    result.validate().map_err(err)?;
    let result_fact_seq = enqueue_fact(
        tx,
        result_id,
        INVENTORY_ALLOTMENT_CANCELLATION_RESULT_V1,
        &result,
    )
    .map_err(err)?
    .ok_or_else(|| err("allotment cancellation result capture is disabled"))?;

    for line in &result.lines {
        let updated = tx
            .execute(
                "UPDATE dc_allotment_work_line
                 SET cancelled_quantity=cancelled_quantity+?2,updated_at=?3
                 WHERE allotment_line_id=?1
                   AND accepted_quantity-picked_quantity-cancelled_quantity=?2",
                params![
                    line.allotment_line_id.to_string(),
                    line.cancelled_quantity,
                    time_text(applied_at)
                ],
            )
            .map_err(err)?;
        if updated != 1 {
            return Err(err(format!(
                "Allotment line {} changed during cancellation",
                line.allotment_line_id
            )));
        }
    }
    let (accepted, picked, dispatched, cancelled): (i64, i64, i64, i64) = tx
        .query_row(
            "SELECT COALESCE(SUM(accepted_quantity),0),
                    COALESCE(SUM(picked_quantity),0),
                    COALESCE(SUM(dispatched_quantity),0),
                    COALESCE(SUM(cancelled_quantity),0)
             FROM dc_allotment_work_line WHERE allotment_id=?1",
            [payload.allotment_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(err)?;
    let status =
        derive_allotment_status(accepted, picked, dispatched, cancelled, false).map_err(err)?;
    if tx
        .execute(
            "UPDATE dc_allotment_work SET fulfillment_status=?2,updated_at=?3
             WHERE allotment_id=?1 AND application_status='ACCEPTED'",
            params![
                payload.allotment_id.to_string(),
                status.as_str(),
                time_text(applied_at)
            ],
        )
        .map_err(err)?
        != 1
    {
        return Err(err(format!(
            "Allotment {} changed during cancellation",
            payload.allotment_id
        )));
    }

    let outcome_text = match outcome {
        CancellationOutcome::Applied => "APPLIED",
        CancellationOutcome::PartiallyApplied => "PARTIALLY_APPLIED",
        CancellationOutcome::Rejected => "REJECTED",
    };
    tx.execute(
        "INSERT INTO dc_allotment_cancellation
             (cancellation_id,command_id,allotment_id,outcome,result_id,requested_by,
              reason,requested_at,result_reason,lines_json,result_fact_seq,applied_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![
            payload.cancellation_id.to_string(),
            command_id.to_string(),
            payload.allotment_id.to_string(),
            outcome_text,
            result_id.to_string(),
            payload.requested_by,
            payload.reason,
            time_text(payload.requested_at),
            result.reason,
            serde_json::to_string(&result.lines).map_err(err)?,
            result_fact_seq,
            time_text(applied_at),
        ],
    )
    .map_err(err)?;

    // The result fact is current-state authority; this later snapshot is only
    // a reconciliation checkpoint that observes the released reservation.
    crate::edge::SqliteEdge::enqueue_pool_snapshot(tx, &node, Uuid::new_v4())
        .map(|_| ())
        .map_err(err)
}

fn apply_official_count_activation(
    tx: &Transaction<'_>,
    command_id: Uuid,
    payload: &OfficialCountActivationPayload,
) -> Result<(), SyncError> {
    let node = require_dc_work_owner(tx, &payload.site_id)?;
    let pool = OperationalPool::from_str(&payload.pool_id).map_err(err)?;
    if !node.owns_pool(&pool) {
        return Err(err(format!(
            "official count pool {} is not owned by {}",
            payload.pool_id, node.site_id
        )));
    }
    tx.execute(
        "INSERT INTO dc_official_count_work
             (count_id,command_id,site_id,pool_id,kind,status,reason,created_by,
              created_at,activated_at,scope_json,applied_at)
         VALUES (?1,?2,?3,?4,?5,'ACTIVE',?6,?7,?8,?9,?10,?11)",
        params![
            payload.count_id.to_string(),
            command_id.to_string(),
            payload.site_id,
            payload.pool_id,
            payload.kind,
            payload.reason,
            payload.created_by,
            time_text(payload.created_at),
            time_text(payload.activated_at),
            serde_json::to_string(&payload.scope).map_err(err)?,
            now_text(),
        ],
    )
    .map_err(err)?;
    let place_id = format!("{}:on_hand", payload.pool_id);
    let mut statement = tx
        .prepare(
            "SELECT projection.subject_id,subject.epc,subject.sku_code,projection.quantity
             FROM inventory_projection projection
             JOIN inventory_subject subject ON subject.id=projection.subject_id
             WHERE projection.place_id=?1 AND projection.quantity>0
             ORDER BY subject.epc",
        )
        .map_err(err)?;
    let rows = statement
        .query_map([place_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(err)?;
    let expected = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?
        .into_iter()
        .filter(|(_, epc, sku_code, _)| {
            (payload.scope.sku_codes.is_empty() || payload.scope.sku_codes.contains(sku_code))
                && (payload.scope.epcs.is_empty() || payload.scope.epcs.contains(epc))
        })
        .collect::<Vec<_>>();
    drop(statement);
    for (subject_id, epc, sku_code, quantity) in expected {
        tx.execute(
            "INSERT INTO dc_official_count_expected
                 (count_id,subject_id,epc,sku_code,expected_quantity)
             VALUES (?1,?2,?3,?4,?5)",
            params![
                payload.count_id.to_string(),
                subject_id,
                epc,
                sku_code,
                quantity,
            ],
        )
        .map_err(err)?;
    }
    Ok(())
}

fn apply_official_count_adjustment(
    tx: &Transaction<'_>,
    command_id: Uuid,
    payload: &OfficialCountAdjustmentPayload,
) -> Result<(), SyncError> {
    let node = require_dc_work_owner(tx, &payload.site_id)?;
    let pool = OperationalPool::from_str(&payload.pool_id).map_err(err)?;
    if pool.id() != payload.pool_id || !node.owns_pool(&pool) {
        return Err(err(format!(
            "official count adjustment pool {} is not owned by {}",
            payload.pool_id, node.site_id
        )));
    }
    let work: (String, String, String, Option<String>, Option<String>) = tx
        .query_row(
            "SELECT site_id,pool_id,status,result_id,adjustment_id
             FROM dc_official_count_work WHERE count_id=?1",
            [payload.count_id.to_string()],
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
        .map_err(err)?
        .ok_or_else(|| {
            err(format!(
                "Official Count {} is not active here",
                payload.count_id
            ))
        })?;
    if work.0 != payload.site_id
        || work.1 != payload.pool_id
        || work.2 != "SUBMITTED"
        || work.3.as_deref() != Some(payload.result_id.to_string().as_str())
        || work.4.is_some()
    {
        return Err(err(
            "Official Count adjustment does not match one submitted local result",
        ));
    }

    let local_lines = {
        let mut statement = tx
            .prepare(
                "WITH epcs AS (
                     SELECT epc FROM dc_official_count_expected WHERE count_id=?1
                     UNION
                     SELECT epc FROM dc_official_count_entry WHERE count_id=?1
                 )
                 SELECT epcs.epc,COALESCE(expected.sku_code,entry.sku_code),
                        COALESCE(expected.expected_quantity,0),
                        COALESCE(entry.found_quantity,0)
                 FROM epcs
                 LEFT JOIN dc_official_count_expected expected
                   ON expected.count_id=?1 AND expected.epc=epcs.epc
                 LEFT JOIN dc_official_count_entry entry
                   ON entry.count_id=?1 AND entry.epc=epcs.epc
                 ORDER BY epcs.epc",
            )
            .map_err(err)?;
        let rows = statement
            .query_map([payload.count_id.to_string()], |row| {
                let expected_quantity = row.get::<_, i64>(2)?;
                let found_quantity = row.get::<_, i64>(3)?;
                Ok(OfficialCountAdjustmentLine {
                    epc: row.get(0)?,
                    sku_code: row.get(1)?,
                    expected_quantity,
                    found_quantity,
                    adjustment_quantity: found_quantity - expected_quantity,
                })
            })
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        rows.into_iter()
            .filter(|line| line.adjustment_quantity != 0)
            .collect::<Vec<_>>()
    };
    let local_partition = local_lines
        .iter()
        .cloned()
        .map(|line| (line.epc.clone(), line))
        .collect::<BTreeMap<_, _>>();
    let command_partition = payload
        .lines
        .iter()
        .cloned()
        .map(|line| (line.epc.clone(), line))
        .collect::<BTreeMap<_, _>>();
    if local_partition != command_partition {
        return Err(err(
            "Official Count adjustment lines differ from the immutable submitted result",
        ));
    }

    let normal_place = Place::Operational {
        pool: pool.clone(),
        state: InventoryState::Normal,
    };
    let missing_place = Place::Operational {
        pool: pool.clone(),
        state: InventoryState::Missing,
    };
    let mut shortage_lines = Vec::new();
    let mut gain_lines = Vec::new();
    let mut rejection_reason = None;
    for line in &local_lines {
        let subject: Option<(String, String)> = tx
            .query_row(
                "SELECT id,sku_code FROM inventory_subject WHERE epc=?1",
                [line.epc.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        let Some((subject_id, sku_code)) = subject else {
            rejection_reason = Some(format!("count EPC {} has no local subject", line.epc));
            break;
        };
        if sku_code != line.sku_code {
            rejection_reason = Some(format!(
                "count EPC {} identifies SKU {}, not {}",
                line.epc, sku_code, line.sku_code
            ));
            break;
        }
        let subject_id = Uuid::parse_str(&subject_id)
            .map(SubjectId)
            .map_err(|error| err(format!("invalid local subject id: {error}")))?;
        if line.adjustment_quantity < 0 {
            let balance: i64 = tx
                .query_row(
                    "SELECT COALESCE(SUM(quantity),0) FROM inventory_projection
                     WHERE subject_id=?1 AND place_id=?2",
                    params![subject_id.to_string(), normal_place.id()],
                    |row| row.get(0),
                )
                .map_err(err)?;
            if balance != line.expected_quantity {
                rejection_reason = Some(format!(
                    "count EPC {} changed after submission: expected on-hand {}, now {}",
                    line.epc, line.expected_quantity, balance
                ));
                break;
            }
            let quantity = line
                .adjustment_quantity
                .checked_neg()
                .ok_or_else(|| err("count shortage quantity overflow"))?;
            shortage_lines.push(MovementLine {
                subject_id,
                quantity,
                from: normal_place.clone(),
                to: missing_place.clone(),
            });
        } else {
            let positioned: i64 = tx
                .query_row(
                    "SELECT COALESCE(SUM(quantity),0) FROM inventory_projection WHERE subject_id=?1",
                    [subject_id.to_string()],
                    |row| row.get(0),
                )
                .map_err(err)?;
            if positioned != 0 || line.expected_quantity != 0 {
                rejection_reason = Some(format!(
                    "count gain EPC {} already has inventory position {}",
                    line.epc, positioned
                ));
                break;
            }
            gain_lines.push(MovementLine {
                subject_id,
                quantity: line.adjustment_quantity,
                from: Place::System {
                    place: SystemPlace::CountGain,
                },
                to: normal_place.clone(),
            });
        }
    }

    let applied_at = Utc::now();
    let mut movement_group_ids = Vec::new();
    let status = if let Some(reason) = rejection_reason.as_ref() {
        tracing::warn!(
            count_id = %payload.count_id,
            adjustment_id = %payload.adjustment_id,
            %reason,
            "rejecting Official Count adjustment after local state changed"
        );
        AdjustmentResultStatus::Rejected
    } else {
        if !shortage_lines.is_empty() {
            let command = MovementCommand {
                movement_group_id: MovementGroupId::new(),
                lines: shortage_lines,
                cause: MovementCause::CountShortage,
                reference_type: Some("OFFICIAL_COUNT".into()),
                reference_id: Some(payload.count_id.to_string()),
                reason: format!("Approved Official Count {} shortage", payload.count_id),
                actor_id: payload.approved_by.clone(),
                occurred_at: applied_at,
            };
            movement_group_ids.push(
                SqliteEdge::append_movement(
                    &node,
                    tx,
                    &format!("official-count:{}:shortage", payload.adjustment_id),
                    &command,
                )
                .map_err(err)?
                .movement_group_id,
            );
        }
        if !gain_lines.is_empty() {
            let command = MovementCommand {
                movement_group_id: MovementGroupId::new(),
                lines: gain_lines,
                cause: MovementCause::CountGain,
                reference_type: Some("OFFICIAL_COUNT".into()),
                reference_id: Some(payload.count_id.to_string()),
                reason: format!("Approved Official Count {} gain", payload.count_id),
                actor_id: payload.approved_by.clone(),
                occurred_at: applied_at,
            };
            movement_group_ids.push(
                SqliteEdge::append_movement(
                    &node,
                    tx,
                    &format!("official-count:{}:gain", payload.adjustment_id),
                    &command,
                )
                .map_err(err)?
                .movement_group_id,
            );
        }
        AdjustmentResultStatus::Applied
    };

    let completion = OfficialCountAdjustmentResultPayload {
        schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
        completion_id: Uuid::new_v4(),
        adjustment_id: payload.adjustment_id,
        adjustment_command_id: command_id,
        count_id: payload.count_id,
        site_id: payload.site_id.clone(),
        pool_id: payload.pool_id.clone(),
        status,
        movement_group_ids: movement_group_ids.clone(),
        actor_id: payload.approved_by.clone(),
        reason: rejection_reason.clone(),
        applied_at,
        lines: payload.lines.clone(),
    };
    completion.validate().map_err(err)?;
    let fact_seq = enqueue_fact(
        tx,
        completion.completion_id,
        INVENTORY_OFFICIAL_COUNT_ADJUSTMENT_RESULT_V1,
        &serde_json::to_value(&completion).map_err(err)?,
    )
    .map_err(err)?
    .ok_or_else(|| err("edge count adjustment fact capture is disabled"))?;
    tx.execute(
        "INSERT INTO dc_official_count_adjustment
             (adjustment_id,command_id,count_id,result_id,status,lines_json,
              movement_group_ids_json,actor_id,reason,applied_at,completion_id,fact_seq)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![
            payload.adjustment_id.to_string(),
            command_id.to_string(),
            payload.count_id.to_string(),
            payload.result_id.to_string(),
            match status {
                AdjustmentResultStatus::Applied => "APPLIED",
                AdjustmentResultStatus::Rejected => "REJECTED",
            },
            serde_json::to_string(&payload.lines).map_err(err)?,
            serde_json::to_string(&movement_group_ids).map_err(err)?,
            payload.approved_by,
            rejection_reason,
            time_text(applied_at),
            completion.completion_id.to_string(),
            fact_seq,
        ],
    )
    .map_err(err)?;
    tx.execute(
        "UPDATE dc_official_count_work
         SET status=CASE WHEN ?5='APPLIED' THEN 'CLOSED' ELSE status END,
             adjustment_id=?2,adjustment_command_id=?3,
             adjustment_completion_id=?4,adjustment_fact_seq=?6,
             closed_at=CASE WHEN ?5='APPLIED' THEN ?7 ELSE closed_at END
         WHERE count_id=?1 AND status='SUBMITTED' AND adjustment_id IS NULL",
        params![
            payload.count_id.to_string(),
            payload.adjustment_id.to_string(),
            command_id.to_string(),
            completion.completion_id.to_string(),
            match status {
                AdjustmentResultStatus::Applied => "APPLIED",
                AdjustmentResultStatus::Rejected => "REJECTED",
            },
            fact_seq,
            time_text(applied_at),
        ],
    )
    .map_err(err)?;
    SqliteEdge::enqueue_pool_snapshot(tx, &node, Uuid::new_v4()).map_err(err)?;
    Ok(())
}

fn apply_auth_policy(tx: &Transaction<'_>, snapshot: &AuthPolicySnapshot) -> Result<(), SyncError> {
    let node = command_node(tx)?;
    if snapshot.origin_id != node.node_id
        || snapshot.site_id != node.site_id.as_str()
        || snapshot.node_role != node.role.to_string()
    {
        return Err(err(format!(
            "auth policy for {}/{}/{} cannot apply on {}/{}/{}",
            snapshot.node_role,
            snapshot.site_id,
            snapshot.origin_id,
            node.role,
            node.site_id,
            node.node_id
        )));
    }
    for device in &snapshot.devices {
        for pool_id in &device.pools {
            let pool = OperationalPool::from_str(pool_id).map_err(err)?;
            if !node.owns_pool(&pool) {
                return Err(err(format!(
                    "RFID device {} is scoped to foreign pool {pool_id}",
                    device.device_id
                )));
            }
        }
    }
    let resident: Option<(i64, String)> = tx
        .query_row(
            "SELECT version,content_hash FROM edge_auth_policy_state WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    if let Some((version, content_hash)) = resident {
        if snapshot.version < version {
            return Ok(());
        }
        if snapshot.version == version {
            if content_hash == snapshot.content_hash {
                return Ok(());
            }
            return Err(err(
                "auth policy version was reused with different contents",
            ));
        }
    }

    // Upsert the complete projection under this version, then remove rows that
    // were not present. Unchanged users keep their sessions during a routine
    // lease renewal; changed auth_version values invalidate sessions locally.
    for user in &snapshot.users {
        tx.execute(
            "INSERT INTO edge_user
                 (id,username,display_name,password_hash,role,active,auth_version,source,
                  policy_version,valid_until,created_at,updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,'CLOUD',?8,?9,?10,?10)
             ON CONFLICT(id) DO UPDATE SET
                 username=excluded.username,display_name=excluded.display_name,
                 password_hash=excluded.password_hash,role=excluded.role,
                 active=excluded.active,auth_version=excluded.auth_version,
                 policy_version=excluded.policy_version,valid_until=excluded.valid_until,
                 updated_at=excluded.updated_at,
                 failed_login_count=CASE
                     WHEN edge_user.password_hash<>excluded.password_hash
                       OR edge_user.auth_version<>excluded.auth_version THEN 0
                     ELSE edge_user.failed_login_count END,
                 failed_login_window_started_at=CASE
                     WHEN edge_user.password_hash<>excluded.password_hash
                       OR edge_user.auth_version<>excluded.auth_version THEN NULL
                     ELSE edge_user.failed_login_window_started_at END,
                 login_blocked_until=CASE
                     WHEN edge_user.password_hash<>excluded.password_hash
                       OR edge_user.auth_version<>excluded.auth_version THEN NULL
                     ELSE edge_user.login_blocked_until END",
            params![
                user.user_id.to_string(),
                user.username,
                user.display_name,
                user.credential_hash,
                user.role,
                i64::from(user.active),
                user.auth_version,
                snapshot.version,
                time_text(user.valid_until),
                now_text(),
            ],
        )
        .map_err(err)?;
    }
    tx.execute(
        "DELETE FROM edge_user WHERE source='CLOUD' AND policy_version<>?1",
        params![snapshot.version],
    )
    .map_err(err)?;

    for device in &snapshot.devices {
        let key_changed = tx
            .query_row(
                "SELECT auth_key_sha256<>?2 FROM edge_rfid_device WHERE device_id=?1",
                params![device.device_id, device.auth_key_sha256],
                |row| row.get::<_, bool>(0),
            )
            .optional()
            .map_err(err)?
            .unwrap_or(false);
        tx.execute(
            "INSERT INTO edge_rfid_device
                 (device_id,label,auth_key_sha256,active,valid_until,updated_at,policy_version)
             VALUES(?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(device_id) DO UPDATE SET
                 label=excluded.label,auth_key_sha256=excluded.auth_key_sha256,
                 active=excluded.active,valid_until=excluded.valid_until,
                 updated_at=excluded.updated_at,policy_version=excluded.policy_version,
                 last_sequence=CASE
                     WHEN edge_rfid_device.auth_key_sha256<>excluded.auth_key_sha256 THEN 0
                     ELSE edge_rfid_device.last_sequence END,
                 last_request_digest=CASE
                     WHEN edge_rfid_device.auth_key_sha256<>excluded.auth_key_sha256 THEN NULL
                     ELSE edge_rfid_device.last_request_digest END",
            params![
                device.device_id,
                device.label,
                device.auth_key_sha256,
                i64::from(device.active),
                time_text(device.valid_until),
                now_text(),
                snapshot.version,
            ],
        )
        .map_err(err)?;
        if key_changed {
            // A rotated key starts a fresh monotonic sequence epoch. Old
            // receipts remain represented by immutable sightings/sync facts,
            // but cannot reserve sequence numbers for the new credential.
            tx.execute(
                "DELETE FROM edge_rfid_batch_receipt WHERE device_id=?1",
                params![device.device_id],
            )
            .map_err(err)?;
        }
        tx.execute(
            "DELETE FROM edge_rfid_device_pool WHERE device_id=?1",
            params![device.device_id],
        )
        .map_err(err)?;
        for pool_id in &device.pools {
            tx.execute(
                "INSERT INTO edge_rfid_device_pool(device_id,pool_id) VALUES(?1,?2)",
                params![device.device_id, pool_id],
            )
            .map_err(err)?;
        }
    }
    tx.execute(
        "DELETE FROM edge_rfid_device WHERE policy_version<>?1",
        params![snapshot.version],
    )
    .map_err(err)?;
    tx.execute(
        "INSERT INTO edge_auth_policy_state
             (singleton,snapshot_id,version,origin_id,site_id,node_role,issued_at,
              valid_until,content_hash,activated_at)
         VALUES(1,?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(singleton) DO UPDATE SET
             snapshot_id=excluded.snapshot_id,version=excluded.version,
             origin_id=excluded.origin_id,site_id=excluded.site_id,
             node_role=excluded.node_role,issued_at=excluded.issued_at,
             valid_until=excluded.valid_until,content_hash=excluded.content_hash,
             activated_at=excluded.activated_at",
        params![
            snapshot.snapshot_id.to_string(),
            snapshot.version,
            snapshot.origin_id,
            snapshot.site_id,
            snapshot.node_role,
            time_text(snapshot.issued_at),
            time_text(snapshot.valid_until),
            snapshot.content_hash,
            now_text(),
        ],
    )
    .map_err(err)?;
    Ok(())
}

/// Land a purchase order as work for this DC to receive against.
///
/// Refuses an order addressed to another site. A command that arrived at the
/// wrong warehouse is not a business problem to be recorded and moved past —
/// it means the centre's targeting is broken, and quietly accepting it would
/// have this DC receiving goods that belong somewhere else.
/// The node's own identity, read from its own database.
///
/// Never from the caller: the identity that decides what a node may do must
/// be the one that survives a restart, not one passed down a call chain.
fn resident_node(tx: &Transaction<'_>) -> Result<NodeContext, SyncError> {
    let (node_id, role, site_id): (String, String, String) = tx
        .query_row(
            "SELECT node_id, role, site_id FROM node_metadata WHERE singleton = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| err(format!("this node has no identity recorded: {error}")))?;
    let role = match role.as_str() {
        "DC" => EdgeRole::Dc,
        "STORE" => EdgeRole::Store,
        other => return Err(err(format!("unknown node role {other}"))),
    };
    let site = SiteId::new(&site_id).map_err(err)?;
    NodeContext::new(node_id, role, site).map_err(err)
}

/// Head office has settled what a delivery actually is.
///
/// Two things happen here, and they are one transaction because either alone
/// is worse than neither: the job is stored so the warehouse can print and
/// tag, and the goods stop being unidentified. The second is not a journey —
/// the pile does not move an inch — it is the system learning what it has
/// been holding. One anonymous quantity of an article becomes several
/// identified quantities of SKUs.
fn apply_tagging_job(
    tx: &Transaction<'_>,
    job: &crate::cloud::domain::TaggingJobPayload,
) -> Result<(), SyncError> {
    let node = resident_node(tx)?;
    if node.role != EdgeRole::Dc {
        return Err(err(format!(
            "tagging job {} was sent to a {:?} node; tagging happens at a DC",
            job.job_id, node.role
        )));
    }
    if job.site_id != node.site_id.as_str() {
        return Err(err(format!(
            "tagging job {} is for site {}, not {}",
            job.job_id, job.site_id, node.site_id
        )));
    }

    // A resend after a lost response is a no-op, not a duplicate.
    let resident: Option<String> = tx
        .query_row(
            "SELECT job_id FROM tagging_job WHERE job_id = ?1",
            params![job.job_id.to_string()],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    if resident.is_some() {
        return Ok(());
    }

    // The goods this job is about. Finding them through the receipt rather
    // than by matching on article code is what stops a job landing on the
    // wrong delivery when two of the same article are waiting.
    //
    // The receipt the centre names is the count that was accepted: the edge
    // mints one identifier at verification and it serves as both, so the
    // answer coming back down still points at the exact pile it was asked
    // about.
    let subject_id: String = tx
        .query_row(
            "SELECT m.subject_id
             FROM receiving_count c
             JOIN movement m ON m.movement_group_id = c.movement_group_id
             WHERE c.receipt_line_id = ?1 AND c.status = 'ACCEPTED'",
            params![job.receipt_line_id.to_string()],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?
        .ok_or_else(|| {
            err(format!(
                "this DC holds no accepted delivery line {}; it cannot tag goods it never received",
                job.receipt_line_id
            ))
        })?;
    let subject_uuid =
        Uuid::parse_str(&subject_id).map_err(|error| err(format!("stored subject id: {error}")))?;

    // What is actually still sitting unidentified. A job for more than
    // remains would take stock the DC does not have; the projection is the
    // only honest answer to how much is there.
    let unidentified_pool = format!("{}.pending.unidentified:on_hand", node.site_id);
    let on_hand: i64 = tx
        .query_row(
            "SELECT quantity FROM inventory_projection WHERE subject_id = ?1 AND place_id = ?2",
            params![subject_id, unidentified_pool],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?
        .unwrap_or(0);
    if on_hand != job.total_quantity {
        return Err(err(format!(
            "tagging job {} accounts for {} units but {} of delivery line {} are unidentified",
            job.job_id, job.total_quantity, on_hand, job.receipt_line_id
        )));
    }

    let article_code: Option<String> = tx
        .query_row(
            "SELECT article_code FROM inventory_subject WHERE id = ?1",
            params![subject_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?
        .flatten();

    let received_at = now_text();
    tx.execute(
        "INSERT INTO tagging_job
             (job_id, session_id, article_code, article_name, image_url, total_quantity,
              issued_at, received_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            job.job_id.to_string(),
            job.session_id.to_string(),
            job.article_code,
            job.article_name,
            job.image_url,
            job.total_quantity,
            job.issued_at.to_rfc3339_opts(SecondsFormat::Micros, true),
            received_at
        ],
    )
    .map_err(err)?;

    // --- The transformation ------------------------------------------------
    //
    // The old subject leaves in one line; the new ones arrive in several. The
    // two halves name different subjects, so they balance through the
    // identification place rather than against each other.
    let mut lines = vec![crate::edge::MovementLine {
        subject_id: crate::edge::SubjectId(subject_uuid),
        quantity: job.total_quantity,
        from: crate::edge::Place::Operational {
            pool: OperationalPool::DcPendingUnidentified {
                dc_id: node.site_id.clone(),
            },
            state: crate::edge::InventoryState::Normal,
        },
        to: crate::edge::Place::System {
            place: crate::edge::SystemPlace::Identification,
        },
    }];

    for line in &job.lines {
        let variant_subject = Uuid::new_v4();
        tx.execute(
            "INSERT INTO inventory_subject
                 (id, subject_type, article_code, epc, sku_code, quantity, unit_price_minor,
                  created_at)
             VALUES (?1, 'QUANTITY', ?2, NULL, ?3, ?4, ?5, ?6)",
            params![
                variant_subject.to_string(),
                article_code,
                line.sku_code,
                line.quantity,
                line.base_price_minor,
                received_at
            ],
        )
        .map_err(err)?;

        tx.execute(
            "INSERT INTO tagging_job_line
                 (job_id, sku_code, colour_digit, colour_label, size_code, size_label,
                  quantity, qr_payload, barcode_payload, base_price_minor, subject_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                job.job_id.to_string(),
                line.sku_code,
                line.colour_digit,
                line.colour_label,
                line.size_code,
                line.size_label,
                line.quantity,
                line.qr_payload,
                line.barcode_payload,
                line.base_price_minor,
                variant_subject.to_string()
            ],
        )
        .map_err(err)?;

        // The labels, stored exactly as they arrived. Nothing here computes
        // an EPC, and nothing here may: the encoding rule lives in one place
        // in this system, and a second copy that drifted would write tags
        // that read back as missing stock.
        for epc in &line.epcs {
            tx.execute(
                "INSERT INTO tagging_job_epc (epc, job_id, sku_code) VALUES (?1, ?2, ?3)",
                params![epc, job.job_id.to_string(), line.sku_code],
            )
            .map_err(|error| {
                err(format!(
                    "EPC {epc} is already held by this DC under another job: {error}"
                ))
            })?;
        }

        lines.push(crate::edge::MovementLine {
            subject_id: crate::edge::SubjectId(variant_subject),
            quantity: line.quantity,
            from: crate::edge::Place::System {
                place: crate::edge::SystemPlace::Identification,
            },
            to: crate::edge::Place::Operational {
                pool: OperationalPool::DcPendingUntagged {
                    dc_id: node.site_id.clone(),
                },
                state: crate::edge::InventoryState::Normal,
            },
        });
    }

    let command = crate::edge::MovementCommand {
        movement_group_id: crate::edge::MovementGroupId::new(),
        lines,
        cause: crate::edge::MovementCause::Identification,
        reference_type: Some("TAGGING_JOB".into()),
        reference_id: Some(job.job_id.to_string()),
        reason: format!(
            "Identifikasi {} menjadi {} varian",
            job.article_code,
            job.lines.len()
        ),
        actor_id: "system:tagging".into(),
        occurred_at: Utc::now(),
    };
    crate::edge::SqliteEdge::append_movement(
        &node,
        tx,
        &format!("tagging-job-{}", job.job_id),
        &command,
    )
    .map_err(err)?;

    Ok(())
}

fn apply_purchase_order(
    tx: &Transaction<'_>,
    order: &PurchaseOrderPayload,
) -> Result<(), SyncError> {
    // Who this node is comes from its own database, not from the caller: the
    // identity that decides whether an order belongs here must be the one
    // that survives a restart, not one passed down a call chain.
    let (role, site_id): (String, String) = tx
        .query_row(
            "SELECT role, site_id FROM node_metadata WHERE singleton = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| err(format!("this node has no identity recorded: {error}")))?;
    if role != "DC" {
        return Err(err(format!(
            "purchase order {} was sent to a {role} node; only a DC receives against one",
            order.po_number
        )));
    }
    if order.destination_site_id != site_id {
        return Err(err(format!(
            "purchase order {} is for site {}, not {site_id}",
            order.po_number, order.destination_site_id
        )));
    }
    // Re-activation of an order already held is a no-op, not a duplicate: the
    // centre may resend after a lost response.
    let resident: Option<String> = tx
        .query_row(
            "SELECT po_number FROM purchase_order WHERE purchase_order_id = ?1",
            params![order.purchase_order_id.to_string()],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    if resident.is_some() {
        return Ok(());
    }
    tx.execute(
        "INSERT INTO purchase_order
             (purchase_order_id, po_number, supplier_id, supplier_name,
              destination_site_id, activated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            order.purchase_order_id.to_string(),
            order.po_number,
            order.supplier_id,
            order.supplier_name,
            order.destination_site_id,
            now_text()
        ],
    )
    .map_err(err)?;
    for line in &order.lines {
        tx.execute(
            "INSERT INTO purchase_order_line
                 (po_line_id, purchase_order_id, line_number, article_code, article_name,
                  image_url, ordered_quantity, unit_price_minor, promised_date)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                line.po_line_id.to_string(),
                order.purchase_order_id.to_string(),
                line.line_number,
                line.article_code,
                line.article_name,
                line.image_url,
                line.ordered_quantity,
                line.unit_price_minor,
                line.promised_date
            ],
        )
        .map_err(err)?;
    }
    Ok(())
}

/// Record the buyer's answer to a price the DC queried.
///
/// Nothing physical turns on this. The goods went into stock when the count
/// was accepted — quantity and price are different questions — so all this
/// does is close the query at the DC so the verifier can see what came of it.
/// What the answer changes is what the company will pay, and that was never
/// the warehouse's to decide.
fn apply_price_amendment_decision(
    tx: &Transaction<'_>,
    decision: &crate::cloud::domain::PriceAmendmentDecisionPayload,
) -> Result<(), SyncError> {
    let pending: Option<String> = tx
        .query_row(
            "SELECT status FROM purchase_price_amendment WHERE request_id = ?1",
            params![decision.causation_request_id.to_string()],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    let Some(status) = pending else {
        // An answer to a question this node never asked. Blocking would be
        // wrong — the centre is not confused, this node is behind or was
        // rebuilt — but applying it would invent a request that never existed.
        tracing::warn!(
            request = %decision.causation_request_id,
            "ignoring a price decision for a request this node does not hold"
        );
        return Ok(());
    };
    if status != "PENDING" {
        return Ok(()); // already answered; a resend
    }
    let outcome = match decision.outcome {
        crate::cloud::domain::PriceAmendmentOutcome::Approved => "APPROVED",
        crate::cloud::domain::PriceAmendmentOutcome::Rejected => "REJECTED",
    };
    tx.execute(
        "UPDATE purchase_price_amendment
         SET status=?2, approved_price_minor=?3, decided_by=?4, decided_at=?5, decision_note=?6
         WHERE request_id=?1",
        params![
            decision.causation_request_id.to_string(),
            outcome,
            decision.approved_price_minor,
            decision.decided_by,
            time_text(decision.decided_at),
            decision.decision_note
        ],
    )
    .map_err(err)?;
    Ok(())
}

fn apply_command_effect(tx: &Transaction<'_>, command: &PushedCommand) -> Result<(), SyncError> {
    match command.command_type.as_str() {
        COMMAND_ACTIVATE_PUBLICATION => {
            let payload = parse_activate_publication(&command.payload).map_err(err)?;
            apply_activation(tx, &payload)
        }
        COMMAND_CATALOG_CHUNK => {
            let chunk = parse_catalog_chunk(&command.payload).map_err(err)?;
            apply_catalog_chunk(tx, &chunk)
        }
        crate::cloud::domain::COMMAND_COMMERCIAL_USAGE => {
            let counts =
                crate::cloud::domain::parse_commercial_usage(&command.payload).map_err(err)?;
            apply_commercial_usage(tx, &counts)
        }
        COMMAND_PURCHASE_ORDER_ACTIVATE => {
            let order = parse_purchase_order(&command.payload).map_err(err)?;
            apply_purchase_order(tx, &order)
        }
        crate::cloud::domain::COMMAND_TAGGING_JOB_ACTIVATE => {
            let job = crate::cloud::domain::parse_tagging_job(&command.payload).map_err(err)?;
            apply_tagging_job(tx, &job)
        }
        crate::cloud::domain::COMMAND_PRICE_AMENDMENT_DECIDED => {
            let decision = crate::cloud::domain::parse_price_amendment_decision(&command.payload)
                .map_err(err)?;
            apply_price_amendment_decision(tx, &decision)
        }
        COMMAND_AUTH_POLICY_REPLACE => {
            let snapshot = parse_auth_policy(&command.payload).map_err(err)?;
            apply_auth_policy(tx, &snapshot)
        }
        INVENTORY_ALLOTMENT_ACTIVATE_V1 => {
            let payload = parse_allotment_activation(&command.payload).map_err(err)?;
            apply_allotment_activation(tx, command.command_id, &payload)
        }
        INVENTORY_ALLOTMENT_CANCEL_V1 => {
            let payload = parse_allotment_cancellation(&command.payload).map_err(err)?;
            apply_allotment_cancellation(tx, command.command_id, &payload)
        }
        INVENTORY_OFFICIAL_COUNT_ACTIVATE_V1 => {
            let payload = parse_official_count_activation(&command.payload).map_err(err)?;
            apply_official_count_activation(tx, command.command_id, &payload)
        }
        INVENTORY_OFFICIAL_COUNT_ADJUST_V1 => {
            let payload = parse_official_count_adjustment(&command.payload).map_err(err)?;
            apply_official_count_adjustment(tx, command.command_id, &payload)
        }
        // An unknown type BLOCKS rather than being skipped: it means the cloud
        // is ahead of this edge's build, and quietly discarding an instruction
        // is worse than stopping and being seen.
        unknown => Err(err(format!(
            "this edge does not understand command type {unknown}"
        ))),
    }
}

#[async_trait::async_trait]
impl SyncStore for SqliteSyncStore {
    async fn origin_identity(&self) -> Result<Option<(String, i64)>, SyncError> {
        self.with_connection(|connection| {
            connection
                .query_row("SELECT origin_id, generation FROM sync_origin", [], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })
                .optional()
                .map_err(err)
        })
    }

    async fn sender_state(&self) -> Result<SenderState, SyncError> {
        self.with_connection(|connection| read_sender_state(connection))
    }

    async fn watermark(&self, origin_id: &str, generation: i64) -> Result<i64, SyncError> {
        self.with_connection(|connection| {
            Ok(connection
                .query_row(
                    "SELECT durable_seq FROM sync_watermark
                     WHERE origin_id = ?1 AND generation = ?2",
                    params![origin_id, generation],
                    |row| row.get(0),
                )
                .optional()
                .map_err(err)?
                .unwrap_or(0))
        })
    }

    async fn pending_batch(
        &self,
        origin_id: &str,
        generation: i64,
        after_seq: i64,
        limit: i64,
    ) -> Result<Vec<SyncFact>, SyncError> {
        self.with_connection(|connection| {
            let mut statement = connection
                .prepare(
                    "SELECT seq, event_id, event_type, payload, created_at FROM sync_fact_log
                     WHERE origin_id = ?1 AND generation = ?2 AND seq > ?3
                     ORDER BY seq LIMIT ?4",
                )
                .map_err(err)?;
            let rows = statement
                .query_map(params![origin_id, generation, after_seq, limit], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                })
                .map_err(err)?;
            let mut facts = Vec::new();
            for row in rows {
                let (seq, event_id, event_type, payload, created_at) = row.map_err(err)?;
                facts.push(SyncFact {
                    seq,
                    event_id: Uuid::parse_str(&event_id)
                        .map_err(|error| err(format!("malformed event_id: {error}")))?,
                    event_type,
                    payload: serde_json::from_str(&payload)
                        .map_err(|error| err(format!("malformed payload: {error}")))?,
                    created_at: parse_time(&created_at)?,
                });
            }
            Ok(facts)
        })
    }

    async fn settle_advance(
        &self,
        origin_id: &str,
        generation: i64,
        advance_to: i64,
        dead_letters: &[RejectedFact],
    ) -> Result<(), SyncError> {
        self.with_connection(|connection| {
            let tx = connection.transaction().map_err(err)?;
            // Dead letters are copied BEFORE the advance, so a crash between
            // the two cannot lose the evidence.
            for reject in dead_letters {
                tx.execute(
                    "INSERT OR IGNORE INTO sync_dead_letter
                         (origin_id, generation, seq, event_id, event_type, payload, reason, rejected_at)
                     SELECT origin_id, generation, seq, event_id, event_type, payload, ?4, ?5
                     FROM sync_fact_log
                     WHERE origin_id = ?1 AND generation = ?2 AND seq = ?3",
                    params![origin_id, generation, reject.seq, reject.reason, now_text()],
                )
                .map_err(err)?;
            }
            tx.execute(
                "INSERT INTO sync_watermark (origin_id, generation, durable_seq, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(origin_id, generation) DO UPDATE SET
                     durable_seq = MAX(sync_watermark.durable_seq, excluded.durable_seq),
                     updated_at = excluded.updated_at",
                params![origin_id, generation, advance_to, now_text()],
            )
            .map_err(err)?;
            tx.commit().map_err(err)
        })
    }

    async fn record_cycle_success(&self) -> Result<(), SyncError> {
        self.with_connection(|connection| {
            let now = now_text();
            connection
                .execute(
                    "INSERT INTO sync_sender_state
                         (singleton, consecutive_failures, breaker_open_until, last_success_at,
                          last_cycle_at, updated_at)
                     VALUES (1, 0, NULL, ?1, ?1, ?1)
                     ON CONFLICT(singleton) DO UPDATE SET
                         consecutive_failures = 0, breaker_open_until = NULL,
                         last_success_at = ?1, last_cycle_at = ?1, updated_at = ?1",
                    params![now],
                )
                .map_err(err)?;
            Ok(())
        })
    }

    async fn record_cycle_idle(&self) -> Result<(), SyncError> {
        self.with_connection(|connection| {
            let now = now_text();
            connection
                .execute(
                    "INSERT INTO sync_sender_state
                         (singleton, consecutive_failures, breaker_open_until, last_success_at,
                          last_cycle_at, updated_at)
                     VALUES (1, 0, NULL, ?1, ?1, ?1)
                     ON CONFLICT(singleton) DO UPDATE SET
                         consecutive_failures = 0, breaker_open_until = NULL,
                         last_success_at = ?1, last_cycle_at = ?1, updated_at = ?1",
                    params![now],
                )
                .map_err(err)?;
            Ok(())
        })
    }

    async fn record_cycle_failure(
        &self,
        error_text: &str,
        policy: BreakerPolicy,
    ) -> Result<SenderState, SyncError> {
        self.with_connection(|connection| {
            let tx = connection.transaction().map_err(err)?;
            let now = now_text();
            tx.execute(
                "INSERT INTO sync_sender_state
                     (singleton, consecutive_failures, last_error, last_error_at,
                      last_cycle_at, updated_at)
                 VALUES (1, 1, ?1, ?2, ?2, ?2)
                 ON CONFLICT(singleton) DO UPDATE SET
                     consecutive_failures = sync_sender_state.consecutive_failures + 1,
                     last_error = ?1, last_error_at = ?2,
                     last_cycle_at = ?2, updated_at = ?2",
                params![error_text, now],
            )
            .map_err(err)?;
            let failures: i64 = tx
                .query_row(
                    "SELECT consecutive_failures FROM sync_sender_state",
                    [],
                    |row| row.get(0),
                )
                .map_err(err)?;
            if let Some(cooldown) = cooldown_after_failure(policy, failures.max(0) as u32) {
                let until = Utc::now() + chrono::Duration::seconds(cooldown);
                tx.execute(
                    "UPDATE sync_sender_state SET breaker_open_until = ?1, updated_at = ?2",
                    params![time_text(until), now_text()],
                )
                .map_err(err)?;
            }
            let state = read_sender_state(&tx)?;
            tx.commit().map_err(err)?;
            Ok(state)
        })
    }

    async fn command_watermark(&self) -> Result<(i64, Option<CommandBlock>), SyncError> {
        self.with_connection(|connection| read_command_watermark(connection))
    }

    async fn apply_commands(
        &self,
        key: &[u8],
        commands: &[PushedCommand],
    ) -> Result<CommandApplyReport, SyncError> {
        self.with_connection(|connection| {
            let mut report = CommandApplyReport::default();
            for command in commands {
                let (watermark, _) = read_command_watermark(connection)?;
                if command.seq <= watermark {
                    continue; // already settled; a resend after a lost response
                }
                let (outcome, reason) =
                    match decide_command(key, watermark, command, Utc::now()) {
                        CommandDisposition::Block { reason } => {
                            record_command_block(connection, command.seq, &reason)?;
                            break;
                        }
                        CommandDisposition::Skip { outcome, reason } => (outcome, Some(reason)),
                        CommandDisposition::Apply => ("APPLIED", None),
                    };
                let tx = connection.transaction().map_err(err)?;
                tx.execute(
                    "INSERT OR IGNORE INTO sync_command_inbox
                         (seq, command_id, command_type, payload, received_at, settled_at,
                          outcome, reason)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)",
                    params![
                        command.seq,
                        command.command_id.to_string(),
                        command.command_type,
                        serde_json::to_string(&command.payload)
                            .unwrap_or_else(|_| "null".into()),
                        now_text(),
                        outcome,
                        reason
                    ],
                )
                .map_err(err)?;
                if outcome == "APPLIED" {
                    if let Err(effect_error) = apply_command_effect(&tx, command) {
                        // The transaction rolls back on drop, so the inbox row
                        // goes with the failed effect: the retry re-inserts it.
                        drop(tx);
                        record_command_block(connection, command.seq, &effect_error.0)?;
                        break;
                    }
                }
                tx.execute(
                    "INSERT INTO sync_command_watermark
                         (singleton, applied_seq, blocked_at_seq, blocked_reason, blocked_since, updated_at)
                     VALUES (1, ?1, NULL, NULL, NULL, ?2)
                     ON CONFLICT(singleton) DO UPDATE SET
                         applied_seq = ?1, blocked_at_seq = NULL, blocked_reason = NULL,
                         blocked_since = NULL, updated_at = ?2",
                    params![command.seq, now_text()],
                )
                .map_err(err)?;
                tx.commit().map_err(err)?;
                if outcome == "APPLIED" {
                    report.applied += 1;
                } else {
                    report.skipped += 1;
                }
            }
            let (_, blocked) = read_command_watermark(connection)?;
            report.blocked = blocked;
            Ok(report)
        })
    }
}

// ---- The edge's sync agent ------------------------------------------------

/// Everything an edge needs to talk to its cloud, read from the environment.
#[derive(Clone, Debug)]
pub struct EdgeSyncConfig {
    pub upload_url: String,
    pub upload_key: String,
    pub interval_seconds: u64,
    pub batch_limit: i64,
    pub retention_days: i64,
    pub breaker: BreakerPolicy,
}

impl EdgeSyncConfig {
    /// Read the always-applicable durable stream generation. This is parsed
    /// even when no sender URL is configured because capture never turns off.
    pub fn generation_from_env() -> Result<i64, crate::edge::EdgeError> {
        Self::generation_from_lookup(&|name| std::env::var(name).ok())
    }

    fn generation_from_lookup<F>(lookup: &F) -> Result<i64, crate::edge::EdgeError>
    where
        F: Fn(&str) -> Option<String>,
    {
        let generation = Self::number(lookup, "INVENTORY_ORIGIN_GENERATION", 1)?;
        if generation < 1 {
            return Err(crate::edge::EdgeError::Configuration(
                "INVENTORY_ORIGIN_GENERATION must be at least 1".into(),
            ));
        }
        Ok(generation)
    }

    /// `None` when `SYNC_UPLOAD_URL` is unset. Capture and durable backlog
    /// continue regardless; only the HTTP sender is optional.
    pub fn from_env() -> Result<Option<Self>, crate::edge::EdgeError> {
        Self::from_lookup(&|name| std::env::var(name).ok())
    }

    fn from_lookup<F>(lookup: &F) -> Result<Option<Self>, crate::edge::EdgeError>
    where
        F: Fn(&str) -> Option<String>,
    {
        let Some(upload_url) = lookup("SYNC_UPLOAD_URL")
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
        else {
            return Ok(None);
        };
        let upload_key = lookup("SYNC_UPLOAD_KEY")
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                crate::edge::EdgeError::Configuration(
                    "SYNC_UPLOAD_KEY is required when SYNC_UPLOAD_URL is set".into(),
                )
            })?;
        if upload_key.chars().count() < crate::security::MIN_SYNC_KEY_LENGTH {
            return Err(crate::edge::EdgeError::Configuration(format!(
                "SYNC_UPLOAD_KEY must be at least {} characters",
                crate::security::MIN_SYNC_KEY_LENGTH
            )));
        }
        let interval_seconds = Self::number(lookup, "SYNC_INTERVAL_SECONDS", 5)?;
        if !(1..=3600).contains(&interval_seconds) {
            return Err(crate::edge::EdgeError::Configuration(
                "SYNC_INTERVAL_SECONDS must be between 1 and 3600".into(),
            ));
        }
        let batch_limit = Self::number(lookup, "SYNC_BATCH_LIMIT", 100)?;
        if !(1..=1000).contains(&batch_limit) {
            return Err(crate::edge::EdgeError::Configuration(
                "SYNC_BATCH_LIMIT must be between 1 and 1000".into(),
            ));
        }
        let retention_days = Self::number(lookup, "SYNC_RETENTION_DAYS", 14)?;
        if retention_days < 0 {
            return Err(crate::edge::EdgeError::Configuration(
                "SYNC_RETENTION_DAYS cannot be negative".into(),
            ));
        }
        let threshold = Self::number(lookup, "SYNC_BREAKER_THRESHOLD", 5)?;
        if !(1..=1000).contains(&threshold) {
            return Err(crate::edge::EdgeError::Configuration(
                "SYNC_BREAKER_THRESHOLD must be between 1 and 1000".into(),
            ));
        }
        let base_cooldown = Self::number(lookup, "SYNC_BREAKER_BASE_COOLDOWN_SECONDS", 30)?;
        let max_cooldown = Self::number(lookup, "SYNC_BREAKER_MAX_COOLDOWN_SECONDS", 900)?;
        if base_cooldown < 1 {
            return Err(crate::edge::EdgeError::Configuration(
                "SYNC_BREAKER_BASE_COOLDOWN_SECONDS must be at least 1".into(),
            ));
        }
        if max_cooldown < base_cooldown {
            return Err(crate::edge::EdgeError::Configuration(
                "SYNC_BREAKER_MAX_COOLDOWN_SECONDS must be at least the base cooldown".into(),
            ));
        }
        Ok(Some(Self {
            upload_url,
            upload_key,
            interval_seconds: interval_seconds as u64,
            batch_limit,
            retention_days,
            breaker: BreakerPolicy {
                threshold: threshold as u32,
                base_cooldown_seconds: base_cooldown,
                max_cooldown_seconds: max_cooldown,
            },
        }))
    }

    fn number<F>(lookup: &F, name: &str, default: i64) -> Result<i64, crate::edge::EdgeError>
    where
        F: Fn(&str) -> Option<String>,
    {
        match lookup(name) {
            None => Ok(default),
            Some(value) => value.trim().parse::<i64>().map_err(|_| {
                crate::edge::EdgeError::Configuration(format!("{name} must be a valid integer"))
            }),
        }
    }
}

/// Start the optional HTTP sender over an already configured durable stream.
///
/// The edge runs the SAME cycle the cloud runs — `sync::run_cycle` over this
/// module's [`SqliteSyncStore`] — so a behaviour proven in
/// `tests/sync_conformance.rs` is proven for both.
fn persistence(error: rusqlite::Error) -> crate::edge::EdgeError {
    crate::edge::EdgeError::Persistence(error.to_string())
}

/// A running Edge sync agent, and the two things a screen needs from it: what
/// the outbox looks like, and a way to say "go now".
///
/// Held by the HTTP router so `/api/v1/sync/status` and `/api/v1/sync/trigger`
/// can reach the agent that is already running, rather than starting a second
/// one. There is deliberately no way to stop it from here — an operator who
/// could switch off the upload could hide a day of sales by accident.
pub struct EdgeSyncHandle {
    wake: Notify,
    connection: Arc<Mutex<Connection>>,
    upload_url: String,
    interval_seconds: i64,
}

impl EdgeSyncHandle {
    /// Wake the sender now instead of waiting out its interval.
    ///
    /// Coalescing rather than queueing: several presses during one cycle
    /// collapse into a single extra cycle. That is the honest behaviour — the
    /// backlog drains in order, and asking twice does not drain it twice.
    ///
    /// This does NOT bypass an open breaker. A node that has been failing is
    /// still in its cooldown, and the status this returns alongside says so;
    /// pretending a button could shorten it would only hide the outage.
    pub fn trigger(&self) {
        self.wake.notify_one();
    }

    /// Blocking: reads SQLite. Call it from `run_blocking`.
    pub fn status(&self) -> Result<crate::contract::EdgeSyncStatus, crate::edge::EdgeError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| crate::edge::EdgeError::Persistence("edge sync store poisoned".into()))?;
        let origin: Option<(String, i64)> = connection
            .query_row(
                "SELECT origin_id, generation FROM sync_origin WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(persistence)?;
        let (watermark, pending, dead) = backlog(&connection).map_err(persistence)?;
        let sender = read_sender_state(&connection)
            .map_err(|error| crate::edge::EdgeError::Persistence(error.to_string()))?;
        Ok(crate::contract::EdgeSyncStatus {
            origin_id: origin.as_ref().map(|(id, _)| id.clone()),
            generation: origin.map_or(0, |(_, generation)| generation),
            pending_facts: pending,
            durable_through: watermark,
            dead_lettered: dead,
            consecutive_failures: sender.consecutive_failures,
            breaker_open_until: sender.breaker_open_until,
            last_success_at: sender.last_success_at,
            last_error: sender.last_error,
            last_error_at: sender.last_error_at,
            sender_enabled: true,
            upload_url: Some(self.upload_url.clone()),
            interval_seconds: Some(self.interval_seconds),
        })
    }
}

pub fn spawn_agent(
    edge: &crate::edge::SqliteEdge,
    config: EdgeSyncConfig,
) -> Result<Arc<EdgeSyncHandle>, crate::edge::EdgeError> {
    if config.upload_key.trim().chars().count() < crate::security::MIN_SYNC_KEY_LENGTH {
        return Err(crate::edge::EdgeError::Configuration(format!(
            "SYNC_UPLOAD_KEY must be at least {} characters when the sync sender is enabled",
            crate::security::MIN_SYNC_KEY_LENGTH
        )));
    }
    let store = SqliteSyncStore::new(edge.connection());
    let transport = crate::cloud::application::sync::HttpTransport::new(
        &config.upload_url,
        Some(config.upload_key.clone()),
    )
    .map_err(|error| crate::edge::EdgeError::Configuration(error.to_string()))?;
    let cycle = crate::sync::SyncConfig {
        batch_limit: config.batch_limit,
        breaker: config.breaker,
        command_key: Some(crate::cloud::postgres::command_signing_key(
            &config.upload_key,
        )),
    };
    let connection = edge.connection();
    let origin = crate::edge::EdgeInventory::node(edge).node_id.clone();
    let runtime = tokio::runtime::Handle::try_current().map_err(|error| {
        crate::edge::EdgeError::Configuration(format!(
            "edge sync sender requires a Tokio runtime: {error}"
        ))
    })?;
    let handle = Arc::new(EdgeSyncHandle {
        wake: Notify::new(),
        connection: edge.connection(),
        upload_url: config.upload_url.clone(),
        interval_seconds: config.interval_seconds as i64,
    });
    let agent = Arc::clone(&handle);
    runtime.spawn(async move {
        let interval = std::time::Duration::from_secs(config.interval_seconds);
        let mut last_purge = std::time::Instant::now();
        tracing::info!(
            origin = %origin,
            url = %config.upload_url,
            interval_seconds = config.interval_seconds,
            "edge sync agent started"
        );
        loop {
            // Either the interval elapses or somebody pressed "send now".
            tokio::select! {
                () = tokio::time::sleep(interval) => {}
                () = agent.wake.notified() => {}
            }
            match crate::sync::run_cycle(&store, &cycle, &transport).await {
                Ok(outcome) => {
                    if let crate::sync::CycleReport::Advanced {
                        sent, advance_to, ..
                    } = outcome.upstream
                    {
                        tracing::info!(sent, advance_to, "edge sync advanced");
                    }
                    if outcome.commands_applied > 0 || outcome.commands_skipped > 0 {
                        tracing::info!(
                            applied = outcome.commands_applied,
                            skipped = outcome.commands_skipped,
                            "edge applied downstream commands"
                        );
                    }
                    if let Some(blocked) = outcome.commands_blocked {
                        tracing::warn!(
                            seq = blocked.seq,
                            reason = %blocked.reason,
                            "edge command stream blocked; the cloud is told next cycle"
                        );
                    }
                }
                Err(error) => tracing::warn!(%error, "edge sync cycle errored"),
            }
            if last_purge.elapsed() >= std::time::Duration::from_secs(3600) {
                last_purge = std::time::Instant::now();
                if let Ok(guard) = connection.lock() {
                    match purge_synced(&guard, config.retention_days) {
                        Ok(0) => {}
                        Ok(purged) => tracing::info!(purged, "edge sync retention purge"),
                        Err(error) => tracing::warn!(%error, "edge retention purge failed"),
                    }
                }
            }
        }
    });
    Ok(handle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::domain::{
        auth_policy_content_hash, AuthPolicyDevice, AuthPolicySnapshot, AuthPolicyUser,
        IngestBatch, IngestResponse,
    };
    use crate::edge::{EdgeRole, NodeContext, SiteId, SqliteEdge};
    use crate::sync::port::SyncTransport;
    use crate::sync::{run_cycle, CycleReport, SyncConfig, SyncStore, INVENTORY_POOL_SNAPSHOT_V1};
    use serde::ser::Error as _;
    use std::collections::HashMap;

    fn values(entries: &[(&str, &str)]) -> HashMap<String, String> {
        entries
            .iter()
            .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
            .collect()
    }

    struct AcceptingTransport;

    #[async_trait::async_trait]
    impl SyncTransport for AcceptingTransport {
        async fn send(&self, _batch: &IngestBatch) -> Result<IngestResponse, String> {
            Ok(IngestResponse {
                durable_through: 0,
                rejected: Vec::new(),
                commands: Vec::new(),
            })
        }
    }

    #[test]
    fn optional_sender_requires_key_and_strict_numbers() {
        let empty = HashMap::<String, String>::new();
        assert!(
            EdgeSyncConfig::from_lookup(&|name| empty.get(name).cloned())
                .unwrap_or_else(|error| panic!("standalone config: {error}"))
                .is_none()
        );

        let missing_key = values(&[("SYNC_UPLOAD_URL", "http://cloud:8080")]);
        assert!(matches!(
            EdgeSyncConfig::from_lookup(&|name| missing_key.get(name).cloned()),
            Err(crate::edge::EdgeError::Configuration(_))
        ));

        let malformed = values(&[
            ("SYNC_UPLOAD_URL", "http://cloud:8080"),
            ("SYNC_UPLOAD_KEY", "secret"),
            ("SYNC_BATCH_LIMIT", "many"),
        ]);
        assert!(matches!(
            EdgeSyncConfig::from_lookup(&|name| malformed.get(name).cloned()),
            Err(crate::edge::EdgeError::Configuration(_))
        ));

        let weak_key = values(&[
            ("SYNC_UPLOAD_URL", "http://cloud:8080"),
            ("SYNC_UPLOAD_KEY", "short-sync-key"),
        ]);
        assert!(matches!(
            EdgeSyncConfig::from_lookup(&|name| weak_key.get(name).cloned()),
            Err(crate::edge::EdgeError::Configuration(_))
        ));

        let valid = values(&[
            ("SYNC_UPLOAD_URL", "http://cloud:8080"),
            ("SYNC_UPLOAD_KEY", "edge-integration-sync-key-00000001"),
            ("SYNC_INTERVAL_SECONDS", "7"),
            ("SYNC_BATCH_LIMIT", "25"),
        ]);
        let config = EdgeSyncConfig::from_lookup(&|name| valid.get(name).cloned())
            .unwrap_or_else(|error| panic!("valid sender config: {error}"))
            .unwrap_or_else(|| panic!("sender config"));
        assert_eq!(config.interval_seconds, 7);
        assert_eq!(config.batch_limit, 25);
    }

    #[test]
    fn generation_is_strict_and_defaults_to_one() {
        let empty = HashMap::<String, String>::new();
        assert_eq!(
            EdgeSyncConfig::generation_from_lookup(&|name| empty.get(name).cloned())
                .unwrap_or_else(|error| panic!("default generation: {error}")),
            1
        );
        for value in ["0", "-1", "not-a-number"] {
            let configured = values(&[("INVENTORY_ORIGIN_GENERATION", value)]);
            assert!(matches!(
                EdgeSyncConfig::generation_from_lookup(&|name| configured.get(name).cloned()),
                Err(crate::edge::EdgeError::Configuration(_))
            ));
        }
    }

    #[test]
    fn auth_policy_projects_users_devices_and_preserves_replay_state() {
        let site = SiteId::new("store-07").unwrap_or_else(|error| panic!("site: {error}"));
        let node = NodeContext::new("store-07-edge", EdgeRole::Store, site)
            .unwrap_or_else(|error| panic!("node: {error}"));
        let edge = SqliteEdge::open_in_memory(node).unwrap_or_else(|error| panic!("edge: {error}"));
        let now = Utc::now();
        let user_id = Uuid::new_v4();
        let mut snapshot = AuthPolicySnapshot {
            snapshot_id: Uuid::new_v4(),
            version: 1,
            origin_id: "store-07-edge".into(),
            site_id: "store-07".into(),
            node_role: "STORE".into(),
            issued_at: now,
            valid_until: now + chrono::Duration::days(7),
            content_hash: String::new(),
            users: vec![AuthPolicyUser {
                user_id,
                username: "cashier.07".into(),
                display_name: "Cashier 07".into(),
                role: "CASHIER".into(),
                credential_hash: "$argon2id$test-verifier".into(),
                active: true,
                auth_version: 1,
                valid_until: now + chrono::Duration::days(7),
            }],
            devices: vec![AuthPolicyDevice {
                device_id: "RFID-07".into(),
                label: "Floor reader".into(),
                auth_key_sha256: "a".repeat(64),
                active: true,
                pools: vec!["store-07.floor".into()],
                valid_until: now + chrono::Duration::days(7),
            }],
        };
        snapshot.content_hash = auth_policy_content_hash(&snapshot);
        let version_one = snapshot.clone();
        let shared = edge.connection();
        let mut connection = shared
            .lock()
            .unwrap_or_else(|error| panic!("connection: {error}"));
        {
            let tx = connection
                .transaction()
                .unwrap_or_else(|error| panic!("transaction: {error}"));
            apply_auth_policy(&tx, &snapshot)
                .unwrap_or_else(|error| panic!("apply policy: {error}"));
            tx.commit()
                .unwrap_or_else(|error| panic!("commit policy: {error}"));
        }
        let role: String = connection
            .query_row(
                "SELECT role FROM edge_user WHERE id=?1",
                params![user_id.to_string()],
                |row| row.get(0),
            )
            .unwrap_or_else(|error| panic!("user: {error}"));
        assert_eq!(role, "CASHIER");
        connection
            .execute(
                "UPDATE edge_rfid_device SET last_sequence=7 WHERE device_id='RFID-07'",
                [],
            )
            .unwrap_or_else(|error| panic!("sequence: {error}"));
        connection
            .execute(
                "INSERT INTO edge_rfid_batch_receipt
                     (idempotency_key,device_id,sequence,request_digest,response_json,created_at)
                 VALUES('old-key-receipt','RFID-07',7,?1,'{}',?2)",
                params!["d".repeat(64), now_text()],
            )
            .unwrap_or_else(|error| panic!("receipt: {error}"));

        snapshot.version = 2;
        snapshot.snapshot_id = Uuid::new_v4();
        snapshot.issued_at = now + chrono::Duration::hours(1);
        snapshot.valid_until = now + chrono::Duration::days(8);
        snapshot.users[0].valid_until = snapshot.valid_until;
        snapshot.devices[0].valid_until = snapshot.valid_until;
        snapshot.content_hash = auth_policy_content_hash(&snapshot);
        {
            let tx = connection
                .transaction()
                .unwrap_or_else(|error| panic!("renew transaction: {error}"));
            apply_auth_policy(&tx, &snapshot)
                .unwrap_or_else(|error| panic!("renew policy: {error}"));
            tx.commit()
                .unwrap_or_else(|error| panic!("commit renewal: {error}"));
        }
        let sequence: i64 = connection
            .query_row(
                "SELECT last_sequence FROM edge_rfid_device WHERE device_id='RFID-07'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|error| panic!("reader sequence: {error}"));
        assert_eq!(
            sequence, 7,
            "lease renewal must not reopen replayed sequences"
        );
        let version: i64 = connection
            .query_row(
                "SELECT version FROM edge_auth_policy_state WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|error| panic!("policy version: {error}"));
        assert_eq!(version, 2);

        {
            let tx = connection
                .transaction()
                .unwrap_or_else(|error| panic!("rollback transaction: {error}"));
            apply_auth_policy(&tx, &version_one)
                .unwrap_or_else(|error| panic!("ignore rollback policy: {error}"));
            tx.commit()
                .unwrap_or_else(|error| panic!("commit ignored rollback: {error}"));
        }
        let version: i64 = connection
            .query_row(
                "SELECT version FROM edge_auth_policy_state WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|error| panic!("policy after rollback: {error}"));
        assert_eq!(version, 2, "older auth snapshots must not roll policy back");

        snapshot.version = 3;
        snapshot.snapshot_id = Uuid::new_v4();
        snapshot.devices[0].auth_key_sha256 = "b".repeat(64);
        snapshot.content_hash = auth_policy_content_hash(&snapshot);
        {
            let tx = connection
                .transaction()
                .unwrap_or_else(|error| panic!("rotation transaction: {error}"));
            apply_auth_policy(&tx, &snapshot)
                .unwrap_or_else(|error| panic!("rotate policy: {error}"));
            tx.commit()
                .unwrap_or_else(|error| panic!("commit rotation: {error}"));
        }
        let (sequence, receipts): (i64, i64) = connection
            .query_row(
                "SELECT d.last_sequence,
                        (SELECT count(*) FROM edge_rfid_batch_receipt r
                         WHERE r.device_id=d.device_id)
                 FROM edge_rfid_device d WHERE d.device_id='RFID-07'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or_else(|error| panic!("rotated device state: {error}"));
        assert_eq!((sequence, receipts), (0, 0));
    }

    #[tokio::test]
    async fn successful_idle_http_cycle_clears_failure_streak() {
        let site = SiteId::new("store-07").unwrap_or_else(|error| panic!("site: {error}"));
        let node = NodeContext::new("store-07-edge", EdgeRole::Store, site)
            .unwrap_or_else(|error| panic!("node: {error}"));
        let edge = SqliteEdge::open_in_memory(node).unwrap_or_else(|error| panic!("edge: {error}"));
        let store = SqliteSyncStore::new(edge.connection());
        let policy = BreakerPolicy {
            threshold: 3,
            base_cooldown_seconds: 30,
            max_cooldown_seconds: 900,
        };
        store
            .settle_advance("store-07-edge", 1, 1, &[])
            .await
            .unwrap_or_else(|error| panic!("settle bootstrap: {error}"));
        let failed = store
            .record_cycle_failure("temporary", policy)
            .await
            .unwrap_or_else(|error| panic!("record failure: {error}"));
        assert_eq!(failed.consecutive_failures, 1);

        let outcome = run_cycle(
            &store,
            &SyncConfig {
                batch_limit: 100,
                breaker: policy,
                command_key: None,
            },
            &AcceptingTransport,
        )
        .await
        .unwrap_or_else(|error| panic!("idle cycle: {error}"));
        assert_eq!(outcome.upstream, CycleReport::Idle);
        let recovered = store
            .sender_state()
            .await
            .unwrap_or_else(|error| panic!("sender state: {error}"));
        assert_eq!(recovered.consecutive_failures, 0);
        assert_eq!(recovered.breaker_open_until, None);
        assert!(recovered.last_success_at.is_some());
    }

    struct FailingPayload;

    impl Serialize for FailingPayload {
        fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
        where
            S: serde::Serializer,
        {
            Err(S::Error::custom("intentional serialization failure"))
        }
    }

    #[test]
    fn serialization_failure_writes_neither_null_nor_sequence() {
        let site = SiteId::new("store-07").unwrap_or_else(|error| panic!("site: {error}"));
        let node = NodeContext::new("store-07-edge", EdgeRole::Store, site)
            .unwrap_or_else(|error| panic!("node: {error}"));
        let edge = SqliteEdge::open_in_memory(node).unwrap_or_else(|error| panic!("edge: {error}"));
        let connection = edge.connection();
        let mut guard = connection
            .lock()
            .unwrap_or_else(|error| panic!("connection: {error}"));
        let tx = guard
            .transaction()
            .unwrap_or_else(|error| panic!("transaction: {error}"));
        assert!(enqueue_fact(
            &tx,
            Uuid::new_v4(),
            INVENTORY_POOL_SNAPSHOT_V1,
            &FailingPayload,
        )
        .is_err());
        tx.commit()
            .unwrap_or_else(|error| panic!("commit unchanged transaction: {error}"));
        let next_seq: i64 = guard
            .query_row("SELECT next_seq FROM sync_origin", [], |row| row.get(0))
            .unwrap_or_else(|error| panic!("next seq: {error}"));
        let null_payloads: i64 = guard
            .query_row(
                "SELECT count(*) FROM sync_fact_log WHERE payload='null'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|error| panic!("null payloads: {error}"));
        assert_eq!(next_seq, 1);
        assert_eq!(null_payloads, 0);
    }
}

/// Queue a VERIFIED purchase receipt for the centre.
///
/// Deliberately separate from counting: what the centre records against a
/// purchase order is the verified quantity, because that is the number that
/// settles what is owed to the supplier. A count that nobody has approved is
/// an observation, and observations do not settle debts.
/// One accepted line, sent up as part of its delivery document.
///
/// The header travels with every line rather than as a fact of its own.
/// Two fact types would need an ordering rule between them — "the document
/// must arrive before its lines" — and a rule like that is one more way for a
/// stream to block. This way each line stands alone and the centre upserts.
#[allow(clippy::too_many_arguments)]
pub fn record_accepted_receipt_line(
    tx: &Transaction<'_>,
    receipt_line_id: Uuid,
    count_id: Uuid,
    po_line_id: Uuid,
    movement_group_id: Uuid,
    counted_quantity: i64,
    counted_by: &str,
    verified_by: &str,
    verified_at: DateTime<Utc>,
) -> Result<i64, SyncError> {
    if counted_quantity <= 0 {
        return Err(err("a receipt of nothing is not a receipt"));
    }
    let (article_code, receipt_id): (String, String) = tx
        .query_row(
            "SELECT l.article_code, c.receipt_id
             FROM receiving_count c
             JOIN purchase_order_line l ON l.po_line_id = c.po_line_id
             WHERE c.count_id = ?1",
            params![count_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(err)?
        .ok_or_else(|| {
            err(format!(
                "this DC holds no count {count_id}; it cannot receive against one it never took"
            ))
        })?;

    let (receipt_number, supplier_id, arrived_at, opened_by, opened_at): (
        String,
        String,
        String,
        String,
        String,
    ) = tx
        .query_row(
            "SELECT receipt_number, supplier_id, arrived_at, opened_by, opened_at
             FROM goods_receipt WHERE receipt_id = ?1",
            params![receipt_id],
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
        .map_err(err)?
        .ok_or_else(|| {
            err(format!(
                "no goods receipt {receipt_id} behind count {count_id}"
            ))
        })?;

    enqueue_fact(
        tx,
        receipt_line_id,
        crate::cloud::domain::FACT_GOODS_RECEIPT_LINE,
        &serde_json::json!({
            "receipt_id": receipt_id,
            "receipt_number": receipt_number,
            "supplier_id": supplier_id,
            "arrived_at": arrived_at,
            "opened_by": opened_by,
            "opened_at": opened_at,
            "receipt_line_id": receipt_line_id,
            "po_line_id": po_line_id,
            "movement_group_id": movement_group_id,
            "quantity": counted_quantity,
            "article_code": article_code,
            "counted_by": counted_by,
            "verified_by": verified_by,
            "counted_at": verified_at,
            "verified_at": verified_at,
        }),
    )
    .map_err(err)?;
    Ok(counted_quantity)
}

/// The supplier's invoice, as the verifier read it off the paper that came
/// with the goods.
#[allow(clippy::too_many_arguments)]
pub fn record_receipt_invoice(
    tx: &Transaction<'_>,
    event_id: Uuid,
    receipt_id: Uuid,
    invoice_number: &str,
    invoice_date: Option<&str>,
    invoice_total_minor: i64,
    invoice_document_ref: Option<&str>,
    recorded_by: &str,
    recorded_at: DateTime<Utc>,
) -> Result<(), SyncError> {
    enqueue_fact(
        tx,
        event_id,
        crate::cloud::domain::FACT_GOODS_RECEIPT_INVOICE,
        &serde_json::json!({
            "receipt_id": receipt_id,
            "invoice_number": invoice_number,
            "invoice_date": invoice_date,
            "invoice_total_minor": invoice_total_minor,
            "invoice_document_ref": invoice_document_ref,
            "recorded_by": recorded_by,
            "recorded_at": recorded_at,
        }),
    )
    .map_err(err)?;
    Ok(())
}
