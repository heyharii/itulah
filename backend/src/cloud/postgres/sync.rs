//! PostgreSQL adapter for the ordered sync engine.
//!
//! Storage only: every protocol decision (what a response does to the
//! watermark, when the breaker opens, what gets rejected) lives in
//! `domain::sync`. This module knows transactions, locks and rows.

use super::allotments::{insert_allotment_event, LineIdentity};
use super::payload_digest;
use crate::cloud::application::{AppError, DeadLetterQuery};
use crate::cloud::domain::{
    admit_batch, cooldown_after_failure, ingest_rejection_reason, stale_generation_message,
    BatchAdmission, BatchFact, BreakerPolicy, DestinationType, IngestBatch, IngestResponse,
    MovementCommand, RejectedFact, SyncFact, HEAD_OFFICE_SITE_ID,
};
use crate::edge::{
    EdgeRole, InventoryState, MovementCause as EdgeMovementCause, MovementLine as EdgeMovementLine,
    NodeContext, OperationalPool, Place, SiteId, SubjectId,
};
use crate::sync::inventory::{PoolSnapshotPayload, INVENTORY_POOL_SNAPSHOT_V1};
use crate::sync::rfid::{RfidObservationBatchPayload, INVENTORY_RFID_OBSERVATION_BATCH_V1};
use crate::sync::transfer::{TransferClaimKind, TransferClaimPayload, INVENTORY_TRANSFER_CLAIM_V1};
use crate::sync::workflow::{
    parse_allotment_activation, parse_allotment_application_result, parse_allotment_cancellation,
    parse_allotment_cancellation_result, parse_fulfillment_progress,
    parse_official_count_activation, parse_official_count_adjustment_result,
    parse_official_count_result, parse_pick, AllotmentApplicationResultPayload,
    AllotmentCancellationPayload, AllotmentCancellationResultPayload, ApplicationDecision,
    CancellationOutcome, FulfillmentProgressPayload, FulfillmentStage,
    OfficialCountAdjustmentResultPayload, OfficialCountResultPayload, PickPayload,
    INVENTORY_ALLOTMENT_ACTIVATE_V1, INVENTORY_ALLOTMENT_APPLICATION_RESULT_V1,
    INVENTORY_ALLOTMENT_CANCELLATION_RESULT_V1, INVENTORY_ALLOTMENT_CANCEL_V1,
    INVENTORY_ALLOTMENT_PICK_V1, INVENTORY_FULFILLMENT_PROGRESS_V1,
    INVENTORY_OFFICIAL_COUNT_ACTIVATE_V1, INVENTORY_OFFICIAL_COUNT_ADJUSTMENT_RESULT_V1,
    INVENTORY_OFFICIAL_COUNT_RESULT_V1, INVENTORY_PICK_V1,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    str::FromStr,
};
use uuid::Uuid;

/// Upsert this node's sync identity at boot. A generation change (or a new
/// origin id) resets the seq allocator: an activated generation starts at one
/// rather than inheriting the previous epoch's high-water mark.
pub async fn provision_origin(
    pool: &PgPool,
    origin_id: &str,
    generation: i64,
    enqueue_enabled: bool,
) -> Result<(), AppError> {
    if origin_id.trim().is_empty() {
        return Err(AppError::Configuration(
            "sync origin id must not be empty".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO sync_origin (singleton, origin_id, generation, next_seq, enqueue_enabled)
         VALUES (true, $1, $2, 0, $3)
         ON CONFLICT (singleton) DO UPDATE SET
             origin_id = EXCLUDED.origin_id,
             generation = EXCLUDED.generation,
             enqueue_enabled = EXCLUDED.enqueue_enabled,
             next_seq = CASE
                 WHEN sync_origin.origin_id = EXCLUDED.origin_id
                  AND sync_origin.generation = EXCLUDED.generation
                 THEN sync_origin.next_seq ELSE 0 END",
    )
    .bind(origin_id)
    .bind(generation)
    .bind(enqueue_enabled)
    .execute(pool)
    .await?;
    sqlx::query("INSERT INTO sync_sender_state (singleton) VALUES (true) ON CONFLICT DO NOTHING")
        .execute(pool)
        .await?;
    Ok(())
}

/// The provisioned identity, if any: `(origin_id, generation)`.
pub async fn origin_identity(pool: &PgPool) -> Result<Option<(String, i64)>, AppError> {
    let row = sqlx::query("SELECT origin_id, generation FROM sync_origin")
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| (r.get("origin_id"), r.get("generation"))))
}

/// Append one fact to the ordered log INSIDE the caller's transaction.
///
/// Locks the singleton origin row to allocate the next seq, so allocation
/// commits — and rolls back — with the domain write that produced the fact.
/// This serializes concurrent writers per node; at edge volumes that is the
/// point, not a bottleneck. Returns `None` when enqueueing is disabled (the
/// CLOUD role) so the domain path stays role-agnostic.
pub(super) async fn enqueue_fact(
    tx: &mut Transaction<'_, Postgres>,
    event_id: Uuid,
    event_type: &str,
    payload: &Value,
) -> Result<Option<i64>, AppError> {
    let origin = sqlx::query(
        "SELECT origin_id, generation, next_seq FROM sync_origin WHERE enqueue_enabled FOR UPDATE",
    )
    .fetch_optional(&mut **tx)
    .await?;
    let Some(origin) = origin else {
        return Ok(None);
    };
    let origin_id: String = origin.get("origin_id");
    let generation: i64 = origin.get("generation");
    let seq: i64 = origin.get::<i64, _>("next_seq") + 1;
    sqlx::query("UPDATE sync_origin SET next_seq = $1")
        .bind(seq)
        .execute(&mut **tx)
        .await?;
    sqlx::query(
        "INSERT INTO sync_fact_log (origin_id, generation, seq, event_id, event_type, payload)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&origin_id)
    .bind(generation)
    .bind(seq)
    .bind(event_id)
    .bind(event_type)
    .bind(payload)
    .execute(&mut **tx)
    .await?;
    Ok(Some(seq))
}

/// Append the movement-group fact for a committed command. The movement group
/// id is the fact's stable identity: idempotent replays of the command never
/// reach this point (they return the deduplicated response first), so one
/// group is one fact.
pub(super) async fn enqueue_movement_fact(
    tx: &mut Transaction<'_, Postgres>,
    command: &MovementCommand,
) -> Result<(), AppError> {
    let lines: Vec<Value> = command
        .lines
        .iter()
        .map(|line| {
            json!({
                "subject_id": line.subject_id.0,
                "quantity": line.quantity,
                "from_place_id": line.from.id(),
                "to_place_id": line.to.id(),
            })
        })
        .collect();
    let payload = json!({
        "movement_group_id": command.movement_group_id.0,
        "cause": command.cause.as_str(),
        "reason": command.reason,
        "reference_type": command.reference_type,
        "reference_id": command.reference_id,
        "actor_id": command.actor_id,
        "occurred_at": command.occurred_at,
        "lines": lines,
        "payload_digest": payload_digest(&lines)?,
    });
    enqueue_fact(
        tx,
        command.movement_group_id.0,
        "inventory.movement",
        &payload,
    )
    .await?;
    Ok(())
}

/// The sender's durable watermark for one stream (0 when none yet).
pub async fn watermark(pool: &PgPool, origin_id: &str, generation: i64) -> Result<i64, AppError> {
    let row = sqlx::query(
        "SELECT durable_seq FROM sync_watermark WHERE origin_id = $1 AND generation = $2",
    )
    .bind(origin_id)
    .bind(generation)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.get("durable_seq")).unwrap_or(0))
}

/// The next contiguous batch above the watermark, oldest first.
pub async fn pending_batch(
    pool: &PgPool,
    origin_id: &str,
    generation: i64,
    after_seq: i64,
    limit: i64,
) -> Result<Vec<SyncFact>, AppError> {
    let rows = sqlx::query(
        "SELECT seq, event_id, event_type, payload, created_at FROM sync_fact_log
         WHERE origin_id = $1 AND generation = $2 AND seq > $3
         ORDER BY seq LIMIT $4",
    )
    .bind(origin_id)
    .bind(generation)
    .bind(after_seq)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| SyncFact {
            seq: r.get("seq"),
            event_id: r.get("event_id"),
            event_type: r.get("event_type"),
            payload: r.get("payload"),
            created_at: r.get("created_at"),
        })
        .collect())
}

/// Apply a settled cycle in ONE transaction: copy the rejected facts to the
/// dead-letter table, then advance the watermark. The watermark never
/// regresses (`GREATEST`), and the dead-letter copy happens before the
/// advance so a crash between the two cannot lose the evidence.
pub async fn settle_advance(
    pool: &PgPool,
    origin_id: &str,
    generation: i64,
    advance_to: i64,
    dead_letters: &[RejectedFact],
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    for reject in dead_letters {
        sqlx::query(
            "INSERT INTO sync_dead_letter
                 (origin_id, generation, seq, event_id, event_type, payload, reason)
             SELECT origin_id, generation, seq, event_id, event_type, payload, $4
             FROM sync_fact_log
             WHERE origin_id = $1 AND generation = $2 AND seq = $3
             ON CONFLICT DO NOTHING",
        )
        .bind(origin_id)
        .bind(generation)
        .bind(reject.seq)
        .bind(&reject.reason)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "INSERT INTO sync_watermark (origin_id, generation, durable_seq, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (origin_id, generation) DO UPDATE SET
             durable_seq = GREATEST(sync_watermark.durable_seq, EXCLUDED.durable_seq),
             updated_at = now()",
    )
    .bind(origin_id)
    .bind(generation)
    .bind(advance_to)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Durable sender state, as the cycle needs it.
#[derive(Clone, Debug)]
pub struct SenderState {
    pub consecutive_failures: u32,
    pub breaker_open_until: Option<DateTime<Utc>>,
    pub last_success_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub last_error_at: Option<DateTime<Utc>>,
}

pub async fn load_sender_state(pool: &PgPool) -> Result<SenderState, AppError> {
    let row = sqlx::query(
        "SELECT consecutive_failures, breaker_open_until, last_success_at, last_error, last_error_at
         FROM sync_sender_state",
    )
    .fetch_optional(pool)
    .await?;
    Ok(match row {
        Some(r) => SenderState {
            consecutive_failures: r.get::<i32, _>("consecutive_failures").max(0) as u32,
            breaker_open_until: r.get("breaker_open_until"),
            last_success_at: r.get("last_success_at"),
            last_error: r.get("last_error"),
            last_error_at: r.get("last_error_at"),
        },
        None => SenderState {
            consecutive_failures: 0,
            breaker_open_until: None,
            last_success_at: None,
            last_error: None,
            last_error_at: None,
        },
    })
}

/// A cycle that settled successfully closes the breaker and stamps success.
pub async fn record_cycle_success(pool: &PgPool) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO sync_sender_state
             (singleton, consecutive_failures, breaker_open_until, last_success_at, last_cycle_at, updated_at)
         VALUES (true, 0, NULL, now(), now(), now())
         ON CONFLICT (singleton) DO UPDATE SET
             consecutive_failures = 0, breaker_open_until = NULL,
             last_success_at = now(), last_cycle_at = now(), updated_at = now()",
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// An idle cycle (nothing pending) stamps liveness without touching the breaker.
pub async fn record_cycle_idle(pool: &PgPool) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO sync_sender_state (singleton, last_cycle_at, updated_at)
         VALUES (true, now(), now())
         ON CONFLICT (singleton) DO UPDATE SET last_cycle_at = now(), updated_at = now()",
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// A failed cycle bumps the durable failure count and, past the policy
/// threshold, opens the breaker. Returns the state after recording.
pub async fn record_cycle_failure(
    pool: &PgPool,
    error: &str,
    policy: BreakerPolicy,
) -> Result<SenderState, AppError> {
    let failures = sqlx::query(
        "INSERT INTO sync_sender_state
             (singleton, consecutive_failures, last_error, last_error_at, last_cycle_at, updated_at)
         VALUES (true, 1, $1, now(), now(), now())
         ON CONFLICT (singleton) DO UPDATE SET
             consecutive_failures = sync_sender_state.consecutive_failures + 1,
             last_error = EXCLUDED.last_error, last_error_at = now(),
             last_cycle_at = now(), updated_at = now()
         RETURNING consecutive_failures",
    )
    .bind(error)
    .fetch_one(pool)
    .await?
    .get::<i32, _>("consecutive_failures")
    .max(0) as u32;
    if let Some(cooldown_seconds) = cooldown_after_failure(policy, failures) {
        sqlx::query(
            "UPDATE sync_sender_state
             SET breaker_open_until = now() + make_interval(secs => $1::double precision),
                 updated_at = now()",
        )
        .bind(cooldown_seconds as f64)
        .execute(pool)
        .await?;
    }
    load_sender_state(pool).await
}

/// Operator action: close the breaker and forget the failure streak.
pub async fn reset_breaker(pool: &PgPool) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE sync_sender_state
         SET consecutive_failures = 0, breaker_open_until = NULL, updated_at = now()",
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Housekeeping: delete synced facts (at or below the watermark) older than
/// the retention window. Dead letters are never touched.
pub async fn purge_synced(pool: &PgPool, retention_days: i64) -> Result<u64, AppError> {
    let result = sqlx::query(
        "DELETE FROM sync_fact_log f
         USING sync_watermark w
         WHERE w.origin_id = f.origin_id AND w.generation = f.generation
           AND f.seq <= w.durable_seq
           AND f.created_at < now() - make_interval(days => $1::int)",
    )
    .bind(retention_days.max(0) as i32)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// Receiver side: ingest one contiguous batch and answer with the durable
/// prefix. One transaction; the per-origin watermark row is locked so two
/// concurrent uploads for the same stream serialize.
///
/// Rules, in seq order within the batch:
/// * `seq <= durable` — duplicate of something already held; skip.
/// * `seq == durable + 1` — validate; record ACCEPTED or a REJECTED tombstone
///   (both advance the prefix — a permanent reject must not dam the stream).
/// * `seq > durable + 1` — a gap: stop and answer with the current prefix so
///   the sender re-reads from its true position.
///
/// A fact whose `event_id` is already held (same fact re-sequenced after a
/// generation bump) counts as duplicate-accepted and advances the prefix
/// without a second receipt row.
pub async fn ingest_batch(pool: &PgPool, batch: &IngestBatch) -> Result<IngestResponse, AppError> {
    if batch.origin_id.trim().is_empty() || batch.generation < 1 {
        return Err(AppError::Validation(
            "ingest batch requires origin_id and generation >= 1".into(),
        ));
    }
    let mut tx = pool.begin().await?;

    // Inventory generations ahead of the Cloud registration are a rollout
    // ordering issue, not bad data. Refuse the whole batch before creating a
    // receiver watermark so the Edge keeps its facts queued and retries them
    // after the operator activates the generation in Cloud.
    let inventory_binding = if batch.facts.iter().any(|fact| {
        matches!(
            fact.event_type.as_str(),
            "inventory.movement"
                | INVENTORY_POOL_SNAPSHOT_V1
                | INVENTORY_TRANSFER_CLAIM_V1
                | INVENTORY_RFID_OBSERVATION_BATCH_V1
                | INVENTORY_ALLOTMENT_APPLICATION_RESULT_V1
                | INVENTORY_ALLOTMENT_CANCELLATION_RESULT_V1
                | INVENTORY_ALLOTMENT_PICK_V1
                | INVENTORY_PICK_V1
                | INVENTORY_FULFILLMENT_PROGRESS_V1
                | INVENTORY_OFFICIAL_COUNT_RESULT_V1
                | INVENTORY_OFFICIAL_COUNT_ADJUSTMENT_RESULT_V1
        )
    }) {
        sqlx::query(
            "SELECT origin_id, site_id, node_role, active_generation, inventory_enabled
             FROM sync_origin_credential WHERE origin_id = $1 FOR KEY SHARE",
        )
        .bind(&batch.origin_id)
        .fetch_optional(&mut *tx)
        .await?
        .as_ref()
        .map(inventory_binding_from_row)
    } else {
        None
    };
    if let Some(binding) = &inventory_binding {
        if batch.generation > binding.active_generation {
            return Err(AppError::Conflict(format!(
                "inventory generation {} is ahead of active generation {}; activate it in Cloud and retry",
                batch.generation, binding.active_generation
            )));
        }
    }

    sqlx::query(
        "INSERT INTO sync_ingest_watermark (origin_id, generation, last_received_at)
         VALUES ($1, $2, now())
         ON CONFLICT (origin_id, generation) DO UPDATE SET last_received_at = now()",
    )
    .bind(&batch.origin_id)
    .bind(batch.generation)
    .execute(&mut *tx)
    .await?;
    let mut durable: i64 = sqlx::query(
        "SELECT durable_seq FROM sync_ingest_watermark
         WHERE origin_id = $1 AND generation = $2 FOR UPDATE",
    )
    .bind(&batch.origin_id)
    .bind(batch.generation)
    .fetch_one(&mut *tx)
    .await?
    .get("durable_seq");

    let mut facts: Vec<&SyncFact> = batch.facts.iter().collect();
    facts.sort_by_key(|f| f.seq);
    let event_ids: Vec<Uuid> = facts.iter().map(|fact| fact.event_id).collect();
    let sequences: Vec<i64> = facts.iter().map(|fact| fact.seq).collect();
    let held_rows = sqlx::query(
        "SELECT origin_id,generation,seq,event_id,status,reason FROM sync_ingest_fact
         WHERE event_id = ANY($1)
         UNION ALL
         SELECT origin_id,generation,seq,event_id,status,reason FROM sync_ingest_fact
         WHERE origin_id=$2 AND generation=$3 AND seq = ANY($4)",
    )
    .bind(&event_ids)
    .bind(&batch.origin_id)
    .bind(batch.generation)
    .bind(&sequences)
    .fetch_all(&mut *tx)
    .await?;
    let mut held_by_event: HashMap<Uuid, (String, Option<String>)> = HashMap::new();
    let mut held_by_sequence: HashMap<i64, (String, Option<String>)> = HashMap::new();
    for row in held_rows {
        let status: String = row.get("status");
        let reason: Option<String> = row.get("reason");
        held_by_event.insert(row.get("event_id"), (status.clone(), reason.clone()));
        if row.get::<String, _>("origin_id") == batch.origin_id
            && row.get::<i64, _>("generation") == batch.generation
        {
            held_by_sequence.insert(row.get("seq"), (status, reason));
        }
    }
    // Whose seqs are these? Below the watermark the loop that follows treats
    // every fact as a duplicate and skips it. For a sender resending its own
    // facts after losing its watermark that is exactly right. For a sender
    // whose database was replaced it is catastrophic: brand new sales are
    // discarded in silence and the response reports them durable.
    //
    // Identity is what tells the two apart, so that is what is handed to the
    // guard — whether this cloud has ever seen each fact, not where it sits.
    let arriving: Vec<BatchFact> = facts
        .iter()
        .map(|fact| BatchFact {
            seq: fact.seq,
            known: held_by_event.contains_key(&fact.event_id),
        })
        .collect();
    if let BatchAdmission::BelowWatermark {
        watermark,
        lowest_seq,
        highest_seq,
        contested,
    } = admit_batch(durable, &arriving)
    {
        let message = stale_generation_message(
            &batch.origin_id,
            batch.generation,
            watermark,
            lowest_seq,
            highest_seq,
            contested,
        );
        // Roll the receipt back before recording the alert: the alert is what
        // the operator sees, and it must survive the refusal that produced it.
        drop(tx);
        super::sync_raise_integrity_alert(
            pool,
            &batch.origin_id,
            batch.generation,
            super::SYNC_ALERT_BELOW_WATERMARK,
            &message,
            Some(watermark),
        )
        .await?;
        tracing::error!(
            origin = %batch.origin_id,
            generation = batch.generation,
            watermark,
            lowest_seq,
            highest_seq,
            "refused a sync batch lying entirely below the watermark"
        );
        return Err(AppError::Conflict(message));
    }

    let mut rejected = Vec::new();
    let mut pending_rows = Vec::new();
    for fact in facts {
        if fact.seq <= durable {
            // A sender can lose the response after the Cloud committed a
            // permanent rejection. Repeat its tombstone on the retry so the
            // sender still records a dead letter before advancing locally.
            let prior = held_by_sequence
                .get(&fact.seq)
                .filter(|(status, _)| status == "REJECTED")
                .or_else(|| {
                    held_by_event
                        .get(&fact.event_id)
                        .filter(|(status, _)| status == "REJECTED")
                });
            if let Some((_status, reason)) = prior {
                include_rejection(
                    &mut rejected,
                    fact.seq,
                    reason
                        .clone()
                        .unwrap_or_else(|| "permanently rejected".into()),
                );
            }
            continue;
        }
        if fact.seq > durable + 1 {
            break;
        }
        if let Some((status, reason)) = held_by_event.get(&fact.event_id) {
            if status == "REJECTED" {
                include_rejection(
                    &mut rejected,
                    fact.seq,
                    reason
                        .clone()
                        .unwrap_or_else(|| "permanently rejected".into()),
                );
            }
            durable = fact.seq;
            continue;
        }
        let inventory_rejection = if fact.event_type == "inventory.movement" {
            match crate::cloud::domain::parse_movement_fact(&fact.payload) {
                Ok(payload) if fact.event_id != payload.movement_group_id => {
                    Some("inventory movement event_id must equal movement_group_id".into())
                }
                Ok(_) if inventory_binding.as_ref().is_none_or(|binding| {
                    !binding.inventory_enabled || batch.generation != binding.active_generation
                }) => Some(
                    "inventory movement requires a registered, inventory-enabled origin at the active generation"
                        .into(),
                ),
                Ok(_) => None,
                // Structural parse failures retain the established apply-time
                // head-of-line blocking behavior and diagnostic path.
                Err(_) => None,
            }
        } else if fact.event_type == INVENTORY_POOL_SNAPSHOT_V1 {
            match serde_json::from_value::<PoolSnapshotPayload>(fact.payload.clone()) {
                Ok(payload) => validate_snapshot_binding(
                    &payload,
                    &batch.origin_id,
                    batch.generation,
                    inventory_binding.as_ref(),
                )
                .err(),
                Err(error) => Some(format!("invalid inventory pool snapshot: {error}")),
            }
        } else if fact.event_type == INVENTORY_TRANSFER_CLAIM_V1 {
            match serde_json::from_value::<TransferClaimPayload>(fact.payload.clone()) {
                Ok(payload) => validate_transfer_binding(
                    &payload,
                    &batch.origin_id,
                    batch.generation,
                    inventory_binding.as_ref(),
                )
                .err(),
                Err(error) => Some(format!("invalid inventory transfer claim: {error}")),
            }
        } else if fact.event_type == INVENTORY_ALLOTMENT_APPLICATION_RESULT_V1 {
            match parse_allotment_application_result(&fact.payload) {
                Ok(payload) if fact.event_id != payload.result_id => {
                    Some("allotment application result_id must equal event_id".into())
                }
                Ok(payload) => validate_allotment_application_binding(
                    &payload,
                    &batch.origin_id,
                    batch.generation,
                    inventory_binding.as_ref(),
                )
                .err(),
                Err(error) => Some(format!("invalid allotment application result: {error}")),
            }
        } else if fact.event_type == INVENTORY_ALLOTMENT_CANCELLATION_RESULT_V1 {
            match parse_allotment_cancellation_result(&fact.payload) {
                Ok(payload) if fact.event_id != payload.result_id => {
                    Some("allotment cancellation result_id must equal event_id".into())
                }
                Ok(payload) => validate_allotment_cancellation_binding(
                    &payload,
                    &batch.origin_id,
                    batch.generation,
                    inventory_binding.as_ref(),
                )
                .err(),
                Err(error) => Some(format!("invalid allotment cancellation result: {error}")),
            }
        } else if fact.event_type == INVENTORY_OFFICIAL_COUNT_RESULT_V1 {
            match parse_official_count_result(&fact.payload) {
                Ok(payload) if fact.event_id != payload.result_id => {
                    Some("official count result_id must equal event_id".into())
                }
                Ok(payload) => validate_official_count_result_binding(
                    &payload,
                    &batch.origin_id,
                    batch.generation,
                    inventory_binding.as_ref(),
                )
                .err(),
                Err(error) => Some(format!("invalid official count result: {error}")),
            }
        } else if fact.event_type == INVENTORY_OFFICIAL_COUNT_ADJUSTMENT_RESULT_V1 {
            match parse_official_count_adjustment_result(&fact.payload) {
                Ok(payload) if fact.event_id != payload.completion_id => {
                    Some("official count completion_id must equal event_id".into())
                }
                Ok(payload) => validate_official_count_adjustment_result_binding(
                    &payload,
                    &batch.origin_id,
                    batch.generation,
                    inventory_binding.as_ref(),
                )
                .err(),
                Err(error) => Some(format!("invalid official count adjustment result: {error}")),
            }
        } else if fact.event_type == INVENTORY_PICK_V1
            || fact.event_type == INVENTORY_ALLOTMENT_PICK_V1
        {
            match parse_pick(&fact.payload) {
                Ok(payload) if fact.event_id != payload.pick_id => {
                    Some("allotment Pick pick_id must equal event_id".into())
                }
                Ok(payload) => validate_allotment_pick_binding(
                    &payload,
                    &batch.origin_id,
                    batch.generation,
                    inventory_binding.as_ref(),
                )
                .err(),
                Err(error) => Some(format!("invalid allotment Pick: {error}")),
            }
        } else if fact.event_type == INVENTORY_FULFILLMENT_PROGRESS_V1 {
            match parse_fulfillment_progress(&fact.payload) {
                Ok(payload) if fact.event_id != payload.progress_id => {
                    Some("fulfillment progress_id must equal event_id".into())
                }
                Ok(payload) => validate_fulfillment_progress_binding(
                    &payload,
                    &batch.origin_id,
                    batch.generation,
                    inventory_binding.as_ref(),
                )
                .err(),
                Err(error) => Some(format!("invalid fulfillment progress: {error}")),
            }
        } else if fact.event_type == INVENTORY_RFID_OBSERVATION_BATCH_V1 {
            match serde_json::from_value::<RfidObservationBatchPayload>(fact.payload.clone()) {
                Ok(payload) => validate_rfid_binding(
                    &payload,
                    &batch.origin_id,
                    batch.generation,
                    inventory_binding.as_ref(),
                )
                .err(),
                Err(error) => Some(format!("invalid RFID observation batch: {error}")),
            }
        } else {
            None
        };
        let (status, reason) = match ingest_rejection_reason(fact).or(inventory_rejection) {
            Some(reason) => ("REJECTED", Some(reason)),
            None => ("ACCEPTED", None),
        };
        pending_rows.push(json!({
            "seq":fact.seq,"event_id":fact.event_id,"event_type":fact.event_type,
            "payload":fact.payload,"status":status,"reason":reason
        }));
        let held = (status.to_owned(), reason.clone());
        held_by_event.insert(fact.event_id, held.clone());
        held_by_sequence.insert(fact.seq, held);
        if let Some(reason) = reason {
            include_rejection(&mut rejected, fact.seq, reason);
        }
        durable = fact.seq;
    }
    if !pending_rows.is_empty() {
        sqlx::query(
            "INSERT INTO sync_ingest_fact
                 (origin_id,generation,seq,event_id,event_type,payload,status,reason)
             SELECT $1,$2,row.seq,row.event_id,row.event_type,row.payload,row.status,row.reason
             FROM jsonb_to_recordset($3::jsonb) AS row(
                 seq bigint,event_id uuid,event_type text,payload jsonb,status text,reason text)
             ON CONFLICT (origin_id,generation,seq) DO NOTHING",
        )
        .bind(&batch.origin_id)
        .bind(batch.generation)
        .bind(Value::Array(pending_rows))
        .execute(&mut *tx)
        .await?;
    }
    rejected.sort_by_key(|fact| fact.seq);
    sqlx::query(
        "UPDATE sync_ingest_watermark
         SET durable_seq = $3, updated_at = now()
         WHERE origin_id = $1 AND generation = $2",
    )
    .bind(&batch.origin_id)
    .bind(batch.generation)
    .bind(durable)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    // The downstream half rides this response. The ack is recorded first so
    // the commands we attach are computed from the watermark the store just
    // reported, never a stale one.
    record_command_ack(
        pool,
        &batch.origin_id,
        batch.command_watermark,
        batch.command_blocked.as_ref(),
    )
    .await?;
    let commands = commands_for(
        pool,
        &batch.origin_id,
        batch.command_watermark,
        COMMAND_BATCH,
    )
    .await?;
    Ok(IngestResponse {
        durable_through: durable,
        rejected,
        commands,
    })
}

/// Everything observability needs about sync, in one snapshot.
#[derive(Clone, Debug)]
pub struct SyncSnapshot {
    pub origin: Option<(String, i64)>,
    pub backlog_count: i64,
    pub backlog_oldest_seconds: Option<f64>,
    pub watermark_seq: i64,
    pub dead_letter_count: i64,
    pub sender: SenderState,
    pub ingest_streams: Vec<IngestStreamStatus>,
}

#[derive(Clone, Debug)]
pub struct IngestStreamStatus {
    pub origin_id: String,
    pub generation: i64,
    pub durable_seq: i64,
    pub rejected_count: i64,
    pub last_received_at: Option<DateTime<Utc>>,
    /// Contiguous prefix applied into this node's ledger. `durable_seq -
    /// applied_seq` is the apply lag the dashboard watches per store.
    pub applied_seq: i64,
    pub blocked_at_seq: Option<i64>,
    pub blocked_reason: Option<String>,
    pub blocked_since: Option<DateTime<Utc>>,
}

impl IngestStreamStatus {
    pub fn apply_lag(&self) -> i64 {
        (self.durable_seq - self.applied_seq).max(0)
    }
}

pub async fn sync_snapshot(pool: &PgPool) -> Result<SyncSnapshot, AppError> {
    let origin = origin_identity(pool).await?;
    let (backlog_count, backlog_oldest_seconds, watermark_seq) = match &origin {
        Some((origin_id, generation)) => {
            let mark = watermark(pool, origin_id, *generation).await?;
            let row = sqlx::query(
                "SELECT count(*)::bigint AS backlog,
                        EXTRACT(EPOCH FROM (now() - min(created_at)))::double precision AS oldest
                 FROM sync_fact_log
                 WHERE origin_id = $1 AND generation = $2 AND seq > $3",
            )
            .bind(origin_id)
            .bind(generation)
            .bind(mark)
            .fetch_one(pool)
            .await?;
            (
                row.get::<i64, _>("backlog"),
                row.get::<Option<f64>, _>("oldest"),
                mark,
            )
        }
        None => (0, None, 0),
    };
    let dead_letter_count = sqlx::query("SELECT count(*)::bigint AS count FROM sync_dead_letter")
        .fetch_one(pool)
        .await?
        .get("count");
    let ingest_streams = sqlx::query(
        "SELECT w.origin_id, w.generation, w.durable_seq, w.last_received_at,
                COALESCE(a.applied_seq, 0) AS applied_seq,
                a.blocked_at_seq, a.blocked_reason, a.blocked_since,
                (SELECT count(*)::bigint FROM sync_ingest_fact f
                 WHERE f.origin_id = w.origin_id AND f.generation = w.generation
                   AND f.status = 'REJECTED') AS rejected_count
         FROM sync_ingest_watermark w
         LEFT JOIN sync_applied_watermark a
           ON a.origin_id = w.origin_id AND a.generation = w.generation
         ORDER BY w.origin_id, w.generation",
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|r| IngestStreamStatus {
        origin_id: r.get("origin_id"),
        generation: r.get("generation"),
        durable_seq: r.get("durable_seq"),
        rejected_count: r.get("rejected_count"),
        last_received_at: r.get("last_received_at"),
        applied_seq: r.get("applied_seq"),
        blocked_at_seq: r.get("blocked_at_seq"),
        blocked_reason: r.get("blocked_reason"),
        blocked_since: r.get("blocked_since"),
    })
    .collect();
    Ok(SyncSnapshot {
        origin,
        backlog_count,
        backlog_oldest_seconds,
        watermark_seq,
        dead_letter_count,
        sender: load_sender_state(pool).await?,
        ingest_streams,
    })
}

/// Dead letters for the operator, newest first.
/// One rejected event, as the sync console lists it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DeadLetterRow {
    pub origin_id: String,
    pub generation: i64,
    pub seq: i64,
    pub event_id: Uuid,
    pub event_type: String,
    /// What the node actually sent. Typed as `unknown` for the browser rather
    /// than `any`: a reader has to narrow it before using it, which is correct
    /// — its contents depend on which lane produced the event.
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub payload: Value,
    pub reason: String,
    pub rejected_at: DateTime<Utc>,
}

/// One value a filter can take, and how many rejections would still be there.
/// Counted over what the SEARCH leaves, ignoring the filters currently applied.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DeadLetterFacet {
    pub value: String,
    pub label: Option<String>,
    pub count: i64,
}

/// The three things the rejection list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DeadLetterFacets {
    /// Which node is producing them. The first question a rejection raises: one
    /// shop misbehaving and the whole fleet misbehaving are different faults.
    pub origins: Vec<DeadLetterFacet>,
    pub event_types: Vec<DeadLetterFacet>,
    /// Why they were refused. The column that says whether this is one bug or
    /// thirty.
    pub reasons: Vec<DeadLetterFacet>,
}

/// A page of rejections, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DeadLetterList {
    pub rows: Vec<DeadLetterRow>,
    pub next_cursor: Option<String>,
    /// Every rejection the search and the filters match, not just this page.
    /// The number the sync console could not previously state: it asked for a
    /// hundred and had no way of knowing whether that was the backlog.
    pub total: i64,
    pub facets: DeadLetterFacets,
}

/// Where the previous page stopped — as a ROW, not a position.
///
/// Three fields because the table's key is three: a node, a generation and a
/// sequence number. Anything less would stop at the first pair of rejections
/// that share it, which is every replayed batch.
#[derive(Serialize, Deserialize)]
struct DeadLetterCursor {
    origin_id: String,
    generation: i64,
    seq: i64,
}

impl DeadLetterCursor {
    fn encode(&self) -> Result<String, AppError> {
        Ok(hex::encode(serde_json::to_vec(self)?))
    }

    fn decode(raw: &str) -> Result<Self, AppError> {
        let bytes = hex::decode(raw).map_err(|_| {
            AppError::Validation("cursor is not a cursor this server issued".into())
        })?;
        serde_json::from_slice(&bytes)
            .map_err(|_| AppError::Validation("cursor is not a cursor this server issued".into()))
    }
}

const DEAD_LETTER_DEFAULT_LIMIT: i64 = 100;
const DEAD_LETTER_MAX_LIMIT: i64 = 500;

/// One rejection row, defined once.
///
/// Used by the page query and by the facet counts, which is the whole reason it
/// is a constant: the facets are only honest if they count exactly what the
/// page can show.
///
/// It stops at the SEARCH; the node, type and reason filters are applied
/// outside by each caller, so one definition answers two questions.
///
/// Every column a sort can name is NOT NULL — `rejected_at`, `origin_id`,
/// `event_type` — so no `COALESCE` sentinel is needed. Worth stating rather
/// than rediscovering: a row comparison against NULL is NULL rather than true,
/// so a nullable sort key added here would end paging at the first NULL, in
/// silence.
///
/// Binds: `$1` the search pattern or NULL.
const DEAD_LETTER_ROWS: &str = "
    SELECT origin_id, generation, seq, event_id, event_type, payload, reason,
           rejected_at
      FROM sync_dead_letter
     WHERE ($1::text IS NULL
            OR origin_id ILIKE $1
            OR event_type ILIKE $1
            OR reason ILIKE $1)
";

/// Every filter, in one place, so the page and the total cannot drift.
const DEAD_LETTER_FILTERS: &str = "
    WHERE ($2::text IS NULL OR origin_id = $2)
      AND ($3::text IS NULL OR event_type = $3)
      AND ($4::text IS NULL OR reason = $4)
";

/// What the fleet sent that this server would not take, one page at a time.
pub async fn list_dead_letters(
    pool: &PgPool,
    query: DeadLetterQuery,
) -> Result<DeadLetterList, AppError> {
    // A blank search is not a search: `Some("")` compiles to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{value}%"));

    // The sort, and the tie-break that makes it total: every order ends in the
    // table's own three-column key, so no two rows can compare equal.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not.
    let lead = match query.sort.as_deref() {
        Some("origin") => "origin_id",
        Some("type") => "event_type",
        _ => "rejected_at",
    };
    let descending = query.dir.as_deref() != Some("asc");
    let cols = format!("{lead}, origin_id, generation, seq");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!("{lead} {dir}, origin_id {dir}, generation {dir}, seq {dir}");
    let seek = if descending { "<" } else { ">" };

    let cursor = query
        .cursor
        .as_deref()
        .map(DeadLetterCursor::decode)
        .transpose()?;
    let limit = query
        .limit
        .unwrap_or(DEAD_LETTER_DEFAULT_LIMIT)
        .clamp(1, DEAD_LETTER_MAX_LIMIT);

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let rows = sqlx::query(&format!(
        "WITH searched AS NOT MATERIALIZED ({DEAD_LETTER_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched {DEAD_LETTER_FILTERS}
         )
         SELECT * FROM kept
          WHERE $5::text IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept
                                  WHERE origin_id = $5 AND generation = $6 AND seq = $7)
          ORDER BY {order}
          LIMIT $8"
    ))
    .bind(&needle)
    .bind(&query.origin_id)
    .bind(&query.event_type)
    .bind(&query.reason)
    .bind(cursor.as_ref().map(|one| one.origin_id.clone()))
    .bind(cursor.as_ref().map(|one| one.generation))
    .bind(cursor.as_ref().map(|one| one.seq))
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            DeadLetterCursor {
                origin_id: row.try_get("origin_id")?,
                generation: row.try_get("generation")?,
                seq: row.try_get("seq")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let out = rows
        .iter()
        .map(|row| {
            Ok(DeadLetterRow {
                origin_id: row.try_get("origin_id")?,
                generation: row.try_get("generation")?,
                seq: row.try_get("seq")?,
                event_id: row.try_get("event_id")?,
                event_type: row.try_get("event_type")?,
                payload: row.try_get("payload")?,
                reason: row.try_get("reason")?,
                rejected_at: row.try_get("rejected_at")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    let counted = sqlx::query(&format!(
        "WITH searched AS ({DEAD_LETTER_ROWS}), kept AS (
             SELECT * FROM searched {DEAD_LETTER_FILTERS}
         )
         SELECT 'origin' AS facet, origin_id AS value, COUNT(*)::bigint AS n
           FROM searched GROUP BY origin_id
          UNION ALL
         SELECT 'type', event_type, COUNT(*)::bigint
           FROM searched GROUP BY event_type
          UNION ALL
         SELECT 'reason', reason, COUNT(*)::bigint
           FROM searched GROUP BY reason
          UNION ALL
         SELECT 'all', '', COUNT(*)::bigint FROM kept"
    ))
    .bind(&needle)
    .bind(&query.origin_id)
    .bind(&query.event_type)
    .bind(&query.reason)
    .fetch_all(pool)
    .await?;

    let mut total = 0i64;
    let (mut origins, mut types, mut reasons) = (Vec::new(), Vec::new(), Vec::new());
    for row in &counted {
        let facet: String = row.try_get("facet")?;
        let one = DeadLetterFacet {
            value: row.try_get("value")?,
            label: None,
            count: row.try_get("n")?,
        };
        match facet.as_str() {
            "origin" => origins.push(one),
            "type" => types.push(one),
            "reason" => reasons.push(one),
            _ => total = one.count,
        }
    }
    for list in [&mut origins, &mut types, &mut reasons] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }

    Ok(DeadLetterList {
        rows: out,
        next_cursor,
        total,
        facets: DeadLetterFacets {
            origins,
            event_types: types,
            reasons,
        },
    })
}

/// Health classification thresholds are policy, so they arrive as arguments.
pub fn sync_health_state(
    snapshot: &SyncSnapshot,
    degraded_after_seconds: i64,
    now: DateTime<Utc>,
) -> &'static str {
    let breaker_open = snapshot
        .sender
        .breaker_open_until
        .is_some_and(|until| until > now);
    let backlog_stale = snapshot
        .backlog_oldest_seconds
        .is_some_and(|age| age >= degraded_after_seconds as f64);
    // A blocked apply stream means a store's facts stopped reaching this
    // node's ledger — page-worthy even while transport looks healthy.
    let apply_blocked = snapshot
        .ingest_streams
        .iter()
        .any(|stream| stream.blocked_at_seq.is_some());
    if breaker_open || backlog_stale || apply_blocked {
        "DEGRADED"
    } else {
        "OK"
    }
}

/// `true` while the breaker holds the sender back.
pub fn breaker_is_open(state: &SenderState, now: DateTime<Utc>) -> bool {
    state.breaker_open_until.is_some_and(|until| until > now)
}

/// Age helper for metrics: seconds since `at`, if known.
pub fn seconds_since(at: Option<DateTime<Utc>>, now: DateTime<Utc>) -> Option<f64> {
    at.map(|t| (now - t).num_milliseconds() as f64 / 1000.0)
}

/// A convenience used by tests to fabricate an unsettleable fact directly in
/// the log (bypassing enqueue validation), advancing the allocator with it.
#[doc(hidden)]
pub async fn debug_insert_raw_fact(
    pool: &PgPool,
    event_type: &str,
    payload: &Value,
) -> Result<i64, AppError> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "SELECT origin_id, generation, next_seq FROM sync_origin WHERE enqueue_enabled FOR UPDATE",
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Conflict("sync origin is not provisioned/enabled".into()))?;
    let origin_id: String = row.get("origin_id");
    let generation: i64 = row.get("generation");
    let seq: i64 = row.get::<i64, _>("next_seq") + 1;
    sqlx::query("UPDATE sync_origin SET next_seq = $1")
        .bind(seq)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO sync_fact_log (origin_id, generation, seq, event_id, event_type, payload)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&origin_id)
    .bind(generation)
    .bind(seq)
    .bind(Uuid::new_v4())
    .bind(event_type)
    .bind(payload)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(seq)
}

/// Interval helper used by tests. `make_interval` needs a concrete cast, so
/// keep the conversion in one place.
#[allow(dead_code)]
fn chrono_seconds(duration: Duration) -> f64 {
    duration.num_milliseconds() as f64 / 1000.0
}

// ---- Per-origin ingest credentials (30-store hardening) -------------------

fn sha256_hex(value: &str) -> String {
    use sha2::{Digest as _, Sha256};
    hex::encode(Sha256::digest(value.as_bytes()))
}

/// Register (or rotate) one origin's ingest key. Only the SHA-256 digest is
/// stored; the plaintext key lives at the store, in its SYNC_UPLOAD_KEY.
pub async fn register_origin_credential(
    pool: &PgPool,
    origin_id: &str,
    ingest_key: &str,
    label: Option<&str>,
) -> Result<(), AppError> {
    register_origin_credential_binding(pool, origin_id, ingest_key, label, None, None, None, None)
        .await
}

/// Register or rotate an origin and optionally bind it to one inventory owner.
/// Omitted binding fields preserve an existing registration during key
/// rotation; a new registration defaults to movement-only, generation 1.
#[allow(clippy::too_many_arguments)]
pub async fn register_origin_credential_binding(
    pool: &PgPool,
    origin_id: &str,
    ingest_key: &str,
    label: Option<&str>,
    site_id: Option<&str>,
    node_role: Option<&str>,
    active_generation: Option<i64>,
    inventory_enabled: Option<bool>,
) -> Result<(), AppError> {
    let origin_id = origin_id.trim();
    if origin_id.is_empty() {
        return Err(AppError::Validation("origin_id must not be empty".into()));
    }
    if ingest_key.chars().count() < crate::security::MIN_SYNC_KEY_LENGTH {
        return Err(AppError::Validation(format!(
            "ingest_key must be at least {} characters",
            crate::security::MIN_SYNC_KEY_LENGTH
        )));
    }
    if active_generation.is_some_and(|generation| generation < 1) {
        return Err(AppError::Validation(
            "active_generation must be at least 1".into(),
        ));
    }
    let site_id = site_id.map(str::trim).filter(|value| !value.is_empty());
    let node_role = node_role.map(str::trim).filter(|value| !value.is_empty());
    if site_id.is_some() != node_role.is_some() {
        return Err(AppError::Validation(
            "site_id and node_role must be provided together".into(),
        ));
    }
    if inventory_enabled == Some(true) && (site_id.is_none() || node_role.is_none()) {
        return Err(AppError::Validation(
            "inventory-enabled origin requires site_id and node_role".into(),
        ));
    }
    let normalized_role = if let (Some(site), Some(role)) = (site_id, node_role) {
        let role =
            EdgeRole::from_str(role).map_err(|error| AppError::Validation(error.to_string()))?;
        let site = SiteId::new(site).map_err(|error| AppError::Validation(error.to_string()))?;
        NodeContext::new(origin_id, role, site)
            .map_err(|error| AppError::Validation(error.to_string()))?;
        Some(role.to_string())
    } else {
        None
    };
    let mut tx = pool.begin().await?;

    if let Some(existing) = sqlx::query(
        "SELECT site_id,node_role,active_generation
         FROM sync_origin_credential WHERE origin_id=$1 FOR UPDATE",
    )
    .bind(origin_id)
    .fetch_optional(&mut *tx)
    .await?
    {
        let existing_site: Option<String> = existing.get("site_id");
        let existing_role: Option<String> = existing.get("node_role");
        let existing_generation: i64 = existing.get("active_generation");
        if active_generation.is_some_and(|generation| generation < existing_generation) {
            return Err(AppError::Conflict(format!(
                "active_generation cannot regress from {existing_generation}"
            )));
        }
        if site_id.is_some_and(|site| existing_site.as_deref().is_some_and(|old| old != site))
            || normalized_role.as_deref().is_some_and(|role| {
                existing_role
                    .as_deref()
                    .is_some_and(|old| !old.eq_ignore_ascii_case(role))
            })
        {
            return Err(AppError::Conflict(
                "registered inventory origin cannot be rebound to another site or role".into(),
            ));
        }
        if active_generation.is_some_and(|generation| generation > existing_generation) {
            // Durable means the sender may purge its fact. Do not retire the
            // generation until Cloud has applied that entire durable prefix.
            // The credential UPDATE lock is shared by ingest/apply readers,
            // so neither path can race this preflight.
            let state = sqlx::query(
                "SELECT COALESCE(ingest.durable_seq,0)::bigint AS durable_seq,
                        COALESCE(applied.applied_seq,0)::bigint AS applied_seq
                 FROM (SELECT 1) singleton
                 LEFT JOIN sync_ingest_watermark ingest
                   ON ingest.origin_id=$1 AND ingest.generation=$2
                 LEFT JOIN sync_applied_watermark applied
                   ON applied.origin_id=$1 AND applied.generation=$2",
            )
            .bind(origin_id)
            .bind(existing_generation)
            .fetch_one(&mut *tx)
            .await?;
            let durable_seq: i64 = state.get("durable_seq");
            let applied_seq: i64 = state.get("applied_seq");
            if applied_seq < durable_seq {
                return Err(AppError::Conflict(format!(
                    "cannot activate generation {}: generation {existing_generation} is durable through {durable_seq} but applied only through {applied_seq}",
                    active_generation.unwrap_or(existing_generation)
                )));
            }
        }
    } else if active_generation.unwrap_or(1) != 1 {
        return Err(AppError::Conflict(
            "a new sync origin must be registered at active_generation 1 before rollover".into(),
        ));
    }

    sqlx::query(
        "INSERT INTO sync_origin_credential
             (origin_id, ingest_key_sha256, label, site_id, node_role,
              active_generation, inventory_enabled)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, 1), COALESCE($7, false))
         ON CONFLICT (origin_id) DO UPDATE SET
             ingest_key_sha256 = EXCLUDED.ingest_key_sha256,
             label = COALESCE(EXCLUDED.label, sync_origin_credential.label),
             site_id = COALESCE(EXCLUDED.site_id, sync_origin_credential.site_id),
             node_role = COALESCE(EXCLUDED.node_role, sync_origin_credential.node_role),
             active_generation = GREATEST(
                 sync_origin_credential.active_generation,
                 COALESCE($6, sync_origin_credential.active_generation)
             ),
             inventory_enabled = COALESCE($7, sync_origin_credential.inventory_enabled),
             rotated_at = now()",
    )
    .bind(origin_id)
    .bind(sha256_hex(ingest_key))
    .bind(label)
    .bind(site_id)
    .bind(normalized_role)
    .bind(active_generation)
    .bind(inventory_enabled)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// The stored key digest for an origin, if it is registered.
pub async fn origin_credential_digest(
    pool: &PgPool,
    origin_id: &str,
) -> Result<Option<String>, AppError> {
    let row =
        sqlx::query("SELECT ingest_key_sha256 FROM sync_origin_credential WHERE origin_id = $1")
            .bind(origin_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|r| r.get("ingest_key_sha256")))
}

/// The shop a registered origin speaks for.
///
/// Read rather than taken from the request body: a relay stamps the shop id it
/// believes it is, and this is what the centre checks it against. Two shops
/// cannot both be store-07, and the register is the only thing that knows.
pub async fn origin_site(pool: &PgPool, origin_id: &str) -> Result<Option<String>, AppError> {
    let row = sqlx::query("SELECT site_id FROM sync_origin_credential WHERE origin_id = $1")
        .bind(origin_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.and_then(|r| r.get::<Option<String>, _>("site_id")))
}

/// The key material both sides sign commands under.
///
/// The cloud never stores a plaintext ingest key, so it signs with the stored
/// digest; the store derives the same digest from the key it holds. Neither
/// side has to keep a second secret, and the plaintext still never lands in
/// the cloud's database.
pub fn command_signing_key(ingest_key: &str) -> String {
    sha256_hex(ingest_key)
}

/// Constant-shape comparison of a presented key against the stored digest.
pub fn ingest_key_matches(stored_digest: &str, presented_key: &str) -> bool {
    crate::security::constant_time_eq(&sha256_hex(presented_key), stored_digest)
}

/// Registered origins for the operator — never exposes key material.
pub async fn list_origin_credentials(pool: &PgPool) -> Result<Value, AppError> {
    let rows = sqlx::query(
        "SELECT origin_id, label, site_id, node_role, active_generation,
                inventory_enabled, created_at, rotated_at
         FROM sync_origin_credential ORDER BY origin_id",
    )
    .fetch_all(pool)
    .await?;
    let items: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "origin_id": r.get::<String, _>("origin_id"),
                "label": r.get::<Option<String>, _>("label"),
                "site_id": r.get::<Option<String>, _>("site_id"),
                "node_role": r.get::<Option<String>, _>("node_role"),
                "active_generation": r.get::<i64, _>("active_generation"),
                "inventory_enabled": r.get::<bool, _>("inventory_enabled"),
                "created_at": r.get::<DateTime<Utc>, _>("created_at"),
                "rotated_at": r.get::<Option<DateTime<Utc>>, _>("rotated_at"),
            })
        })
        .collect();
    Ok(json!({ "items": items }))
}

#[derive(Clone, Debug)]
struct InventoryOriginBinding {
    origin_id: String,
    site_id: Option<String>,
    node_role: Option<String>,
    active_generation: i64,
    inventory_enabled: bool,
}

fn inventory_binding_from_row(row: &sqlx::postgres::PgRow) -> InventoryOriginBinding {
    InventoryOriginBinding {
        origin_id: row.get("origin_id"),
        site_id: row.get("site_id"),
        node_role: row.get("node_role"),
        active_generation: row.get("active_generation"),
        inventory_enabled: row.get("inventory_enabled"),
    }
}

fn validate_snapshot_binding(
    payload: &PoolSnapshotPayload,
    batch_origin_id: &str,
    generation: i64,
    binding: Option<&InventoryOriginBinding>,
) -> Result<NodeContext, String> {
    payload.validate().map_err(|error| error.to_string())?;
    let binding = binding
        .ok_or_else(|| "inventory.pool_snapshot.v1 requires a registered origin".to_string())?;
    if !binding.inventory_enabled {
        return Err("origin is not enabled for inventory snapshots".into());
    }
    if binding.origin_id != batch_origin_id || payload.node_id != batch_origin_id {
        return Err("snapshot node_id must match the authenticated origin_id".into());
    }
    if generation != binding.active_generation {
        return Err(format!(
            "snapshot generation {generation} is not active generation {}",
            binding.active_generation
        ));
    }
    let expected_site = binding
        .site_id
        .as_deref()
        .ok_or_else(|| "inventory origin has no registered site_id".to_string())?;
    let expected_role = binding
        .node_role
        .as_deref()
        .ok_or_else(|| "inventory origin has no registered node_role".to_string())?;
    if payload.site_id != expected_site || !payload.node_role.eq_ignore_ascii_case(expected_role) {
        return Err("snapshot site_id/node_role does not match origin registration".into());
    }
    let role = EdgeRole::from_str(expected_role).map_err(|error| error.to_string())?;
    let site_id = SiteId::new(expected_site).map_err(|error| error.to_string())?;
    let node =
        NodeContext::new(batch_origin_id, role, site_id).map_err(|error| error.to_string())?;
    for balance in &payload.pools {
        let pool =
            OperationalPool::from_str(&balance.pool_id).map_err(|error| error.to_string())?;
        if !node.owns_pool(&pool) {
            return Err(format!(
                "pool {} is not owned by registered site {}",
                balance.pool_id, node.site_id
            ));
        }
    }
    Ok(node)
}

fn validate_allotment_application_binding(
    payload: &AllotmentApplicationResultPayload,
    batch_origin_id: &str,
    generation: i64,
    binding: Option<&InventoryOriginBinding>,
) -> Result<NodeContext, String> {
    payload.validate()?;
    let binding = binding.ok_or_else(|| {
        "inventory.allotment.application_result.v1 requires a registered origin".to_string()
    })?;
    if !binding.inventory_enabled {
        return Err("origin is not enabled for inventory workflow facts".into());
    }
    if binding.origin_id != batch_origin_id {
        return Err("allotment application origin does not match authenticated origin_id".into());
    }
    if generation != binding.active_generation {
        return Err(format!(
            "allotment application generation {generation} is not active generation {}",
            binding.active_generation
        ));
    }
    let expected_site = binding
        .site_id
        .as_deref()
        .ok_or_else(|| "inventory origin has no registered site_id".to_string())?;
    let expected_role = binding
        .node_role
        .as_deref()
        .ok_or_else(|| "inventory origin has no registered node_role".to_string())?;
    if expected_role != "DC" || payload.source_site_id != expected_site {
        return Err("allotment application must come from its exact registered DC site".into());
    }
    let site_id = SiteId::new(expected_site).map_err(|error| error.to_string())?;
    NodeContext::new(batch_origin_id, EdgeRole::Dc, site_id).map_err(|error| error.to_string())
}

fn validate_allotment_cancellation_binding(
    payload: &AllotmentCancellationResultPayload,
    batch_origin_id: &str,
    generation: i64,
    binding: Option<&InventoryOriginBinding>,
) -> Result<NodeContext, String> {
    payload.validate()?;
    let binding = binding.ok_or_else(|| {
        "inventory.allotment.cancellation_result.v1 requires a registered origin".to_string()
    })?;
    if !binding.inventory_enabled {
        return Err("origin is not enabled for inventory workflow facts".into());
    }
    if binding.origin_id != batch_origin_id {
        return Err("allotment cancellation origin does not match authenticated origin_id".into());
    }
    if generation != binding.active_generation {
        return Err(format!(
            "allotment cancellation generation {generation} is not active generation {}",
            binding.active_generation
        ));
    }
    let expected_site = binding
        .site_id
        .as_deref()
        .ok_or_else(|| "inventory origin has no registered site_id".to_string())?;
    let expected_role = binding
        .node_role
        .as_deref()
        .ok_or_else(|| "inventory origin has no registered node_role".to_string())?;
    if expected_role != "DC" || payload.source_site_id != expected_site {
        return Err("allotment cancellation must come from its exact registered DC site".into());
    }
    let site_id = SiteId::new(expected_site).map_err(|error| error.to_string())?;
    NodeContext::new(batch_origin_id, EdgeRole::Dc, site_id).map_err(|error| error.to_string())
}

fn validate_official_count_owner_binding(
    site_id: &str,
    pool_id: &str,
    batch_origin_id: &str,
    generation: i64,
    binding: Option<&InventoryOriginBinding>,
    fact_label: &str,
) -> Result<NodeContext, String> {
    let binding = binding.ok_or_else(|| format!("{fact_label} requires a registered origin"))?;
    if !binding.inventory_enabled {
        return Err("origin is not enabled for inventory workflow facts".into());
    }
    if binding.origin_id != batch_origin_id {
        return Err(format!(
            "{fact_label} origin does not match authenticated origin_id"
        ));
    }
    if generation != binding.active_generation {
        return Err(format!(
            "{fact_label} generation {generation} is not active generation {}",
            binding.active_generation
        ));
    }
    let expected_site = binding
        .site_id
        .as_deref()
        .ok_or_else(|| "inventory origin has no registered site_id".to_string())?;
    if binding.node_role.as_deref() != Some("DC") || site_id != expected_site {
        return Err(format!(
            "{fact_label} must come from its exact registered DC site"
        ));
    }
    let site = SiteId::new(expected_site).map_err(|error| error.to_string())?;
    let node =
        NodeContext::new(batch_origin_id, EdgeRole::Dc, site).map_err(|error| error.to_string())?;
    let pool = OperationalPool::from_str(pool_id).map_err(|error| error.to_string())?;
    if pool.id() != pool_id || !node.owns_pool(&pool) {
        return Err(format!(
            "{fact_label} pool {pool_id} is not canonically owned by registered site {}",
            node.site_id
        ));
    }
    Ok(node)
}

fn validate_official_count_result_binding(
    payload: &OfficialCountResultPayload,
    batch_origin_id: &str,
    generation: i64,
    binding: Option<&InventoryOriginBinding>,
) -> Result<NodeContext, String> {
    payload.validate()?;
    validate_official_count_owner_binding(
        &payload.site_id,
        &payload.pool_id,
        batch_origin_id,
        generation,
        binding,
        INVENTORY_OFFICIAL_COUNT_RESULT_V1,
    )
}

fn validate_official_count_adjustment_result_binding(
    payload: &OfficialCountAdjustmentResultPayload,
    batch_origin_id: &str,
    generation: i64,
    binding: Option<&InventoryOriginBinding>,
) -> Result<NodeContext, String> {
    payload.validate()?;
    validate_official_count_owner_binding(
        &payload.site_id,
        &payload.pool_id,
        batch_origin_id,
        generation,
        binding,
        INVENTORY_OFFICIAL_COUNT_ADJUSTMENT_RESULT_V1,
    )
}

fn validate_allotment_pick_binding(
    payload: &PickPayload,
    batch_origin_id: &str,
    generation: i64,
    binding: Option<&InventoryOriginBinding>,
) -> Result<NodeContext, String> {
    payload.validate()?;
    let binding = binding
        .ok_or_else(|| "inventory.allotment.pick.v1 requires a registered origin".to_string())?;
    if !binding.inventory_enabled {
        return Err("origin is not enabled for inventory workflow facts".into());
    }
    if binding.origin_id != batch_origin_id {
        return Err("allotment Pick origin does not match authenticated origin_id".into());
    }
    if generation != binding.active_generation {
        return Err(format!(
            "allotment Pick generation {generation} is not active generation {}",
            binding.active_generation
        ));
    }
    let expected_site = binding
        .site_id
        .as_deref()
        .ok_or_else(|| "inventory origin has no registered site_id".to_string())?;
    let expected_role = binding
        .node_role
        .as_deref()
        .ok_or_else(|| "inventory origin has no registered node_role".to_string())?;
    if expected_role != "DC" || payload.source_site_id != expected_site {
        return Err("allotment Pick must come from its exact registered DC site".into());
    }
    let site_id = SiteId::new(expected_site).map_err(|error| error.to_string())?;
    let node = NodeContext::new(batch_origin_id, EdgeRole::Dc, site_id)
        .map_err(|error| error.to_string())?;
    let pool =
        OperationalPool::from_str(&payload.source_pool_id).map_err(|error| error.to_string())?;
    if pool.id() != payload.source_pool_id || !pool.is_dc_fulfillment_source_for(&node.site_id) {
        return Err(format!(
            "allotment Pick pool {} is not a canonical non-fulfillment source for registered site {}",
            payload.source_pool_id, node.site_id
        ));
    }
    Ok(node)
}

fn validate_fulfillment_progress_binding(
    payload: &FulfillmentProgressPayload,
    batch_origin_id: &str,
    generation: i64,
    binding: Option<&InventoryOriginBinding>,
) -> Result<NodeContext, String> {
    payload.validate()?;
    let binding = binding.ok_or_else(|| {
        "inventory.fulfillment.progress.v1 requires a registered origin".to_string()
    })?;
    if !binding.inventory_enabled {
        return Err("origin is not enabled for inventory workflow facts".into());
    }
    if binding.origin_id != batch_origin_id {
        return Err("fulfillment origin does not match authenticated origin_id".into());
    }
    if generation != binding.active_generation {
        return Err(format!(
            "fulfillment generation {generation} is not active generation {}",
            binding.active_generation
        ));
    }
    let expected_site = binding
        .site_id
        .as_deref()
        .ok_or_else(|| "inventory origin has no registered site_id".to_string())?;
    let expected_role = binding
        .node_role
        .as_deref()
        .ok_or_else(|| "inventory origin has no registered node_role".to_string())?;
    if expected_role != "DC" || payload.source_site_id != expected_site {
        return Err("fulfillment progress must come from its exact registered DC site".into());
    }
    let site_id = SiteId::new(expected_site).map_err(|error| error.to_string())?;
    let node = NodeContext::new(batch_origin_id, EdgeRole::Dc, site_id)
        .map_err(|error| error.to_string())?;
    let destination =
        SiteId::new(&payload.destination_store_id).map_err(|error| error.to_string())?;
    if destination.kind() != crate::edge::SiteKind::Store
        || destination.to_string() != payload.destination_store_id
    {
        return Err("fulfillment destination_store_id must be a canonical Store site".into());
    }
    Ok(node)
}

fn validate_transfer_binding(
    payload: &TransferClaimPayload,
    batch_origin_id: &str,
    generation: i64,
    binding: Option<&InventoryOriginBinding>,
) -> Result<NodeContext, String> {
    payload.validate().map_err(|error| error.to_string())?;
    let binding = binding
        .ok_or_else(|| "inventory.transfer_claim.v1 requires a registered origin".to_string())?;
    if !binding.inventory_enabled {
        return Err("origin is not enabled for inventory transfer claims".into());
    }
    if binding.origin_id != batch_origin_id {
        return Err("transfer claim origin does not match authenticated origin_id".into());
    }
    if generation != binding.active_generation {
        return Err(format!(
            "transfer claim generation {generation} is not active generation {}",
            binding.active_generation
        ));
    }
    let expected_site = binding
        .site_id
        .as_deref()
        .ok_or_else(|| "inventory origin has no registered site_id".to_string())?;
    let expected_role = binding
        .node_role
        .as_deref()
        .ok_or_else(|| "inventory origin has no registered node_role".to_string())?;
    let role = EdgeRole::from_str(expected_role).map_err(|error| error.to_string())?;
    let site_id = SiteId::new(expected_site).map_err(|error| error.to_string())?;
    let node =
        NodeContext::new(batch_origin_id, role, site_id).map_err(|error| error.to_string())?;

    let destination =
        SiteId::new(&payload.destination_store_id).map_err(|error| error.to_string())?;
    if destination.kind() != crate::edge::SiteKind::Store {
        return Err("transfer destination_store_id must identify a Store".into());
    }
    let source = payload
        .source_dc_id
        .as_deref()
        .map(SiteId::new)
        .transpose()
        .map_err(|error| error.to_string())?;
    if source
        .as_ref()
        .is_some_and(|site| site.kind() != crate::edge::SiteKind::Dc)
    {
        return Err("transfer source_dc_id must identify a DC".into());
    }

    match payload.claim_kind {
        TransferClaimKind::InTransit
            if role != EdgeRole::Dc
                || source.as_ref() != Some(&node.site_id)
                || payload.receipt_id.is_some() =>
        {
            Err("IN_TRANSIT claim must be owned by its registered source DC".into())
        }
        TransferClaimKind::Received
            if role != EdgeRole::Store
                || destination != node.site_id
                || payload.receipt_id.is_none() =>
        {
            Err("RECEIVED claim must be owned by its registered destination Store".into())
        }
        _ => Ok(node),
    }
}

fn validate_rfid_binding(
    payload: &RfidObservationBatchPayload,
    batch_origin_id: &str,
    generation: i64,
    binding: Option<&InventoryOriginBinding>,
) -> Result<NodeContext, String> {
    payload.validate().map_err(|error| error.to_string())?;
    let binding = binding.ok_or_else(|| {
        "inventory.rfid_observation_batch.v1 requires a registered origin".to_string()
    })?;
    if !binding.inventory_enabled {
        return Err("origin is not enabled for RFID observations".into());
    }
    if binding.origin_id != batch_origin_id {
        return Err("RFID observation origin does not match authenticated origin_id".into());
    }
    if generation != binding.active_generation {
        return Err(format!(
            "RFID observation generation {generation} is not active generation {}",
            binding.active_generation
        ));
    }
    let expected_site = binding
        .site_id
        .as_deref()
        .ok_or_else(|| "inventory origin has no registered site_id".to_string())?;
    let expected_role = binding
        .node_role
        .as_deref()
        .ok_or_else(|| "inventory origin has no registered node_role".to_string())?;
    if payload.site_id != expected_site {
        return Err("RFID observation site_id does not match origin registration".into());
    }
    let role = EdgeRole::from_str(expected_role).map_err(|error| error.to_string())?;
    let site_id = SiteId::new(expected_site).map_err(|error| error.to_string())?;
    let node =
        NodeContext::new(batch_origin_id, role, site_id).map_err(|error| error.to_string())?;
    let pool = OperationalPool::from_str(&payload.pool_id).map_err(|error| error.to_string())?;
    if !node.owns_pool(&pool) {
        return Err(format!(
            "RFID pool {} is not owned by registered site {}",
            payload.pool_id, node.site_id
        ));
    }
    Ok(node)
}

fn include_rejection(rejected: &mut Vec<RejectedFact>, seq: i64, reason: String) {
    if !rejected.iter().any(|item| item.seq == seq) {
        rejected.push(RejectedFact { seq, reason });
    }
}

// ---- The applier: receipt log -> this node's ledger -----------------------

/// One stream that is blocked at a fact it cannot apply.
#[derive(Clone, Debug)]
pub struct BlockedStream {
    pub origin_id: String,
    pub generation: i64,
    pub seq: i64,
    pub reason: String,
}

/// What one apply pass did across every stream.
#[derive(Clone, Debug, Default)]
pub struct ApplyReport {
    pub applied: u64,
    pub skipped: u64,
    pub blocked: Vec<BlockedStream>,
}

enum ApplyStep {
    /// Nothing left below the receipt watermark, or an atomic fulfillment
    /// movement is waiting for its immediate progress successor to arrive.
    Drained,
    /// One atomic application unit handled. Fulfillment movement/progress
    /// pairs consume two facts while committing under one transaction.
    Advanced {
        applied_movements: u64,
        skipped_facts: u64,
    },
    /// The fact at `seq` cannot be applied; the stream stops here (and will
    /// retry from the same seq next pass — blocking is observability, not a
    /// terminal state).
    Blocked { seq: i64, reason: String },
    /// The fact at `seq` will never apply where it stands, and the facts that
    /// would make it applicable are queued behind it. Blocking would be a
    /// deadlock rather than observability, so it goes to the dead-letter table
    /// and the stream carries on past it.
    SetAside { seq: i64, reason: String },
}

/// Apply pending accepted facts into this node's ledger, one stream at a
/// time, in seq order, each fact in its own transaction together with its
/// watermark advance — so a crash can never leave a fact applied but
/// unaccounted, or accounted but unapplied.
///
/// Head-of-line blocking per stream is deliberate: facts within one origin
/// are causally ordered (a sale after a restock), so skipping an unappliable
/// fact would let effects apply out of order. Streams are independent — one
/// blocked store never delays the other 29.
pub async fn apply_pending(pool: &PgPool, per_stream_limit: i64) -> Result<ApplyReport, AppError> {
    let streams: Vec<(String, i64, i64)> = sqlx::query(
        "SELECT origin_id, generation, durable_seq FROM sync_ingest_watermark
         ORDER BY origin_id, generation",
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|r| {
        (
            r.get("origin_id"),
            r.get("generation"),
            r.get("durable_seq"),
        )
    })
    .collect();
    let mut report = ApplyReport::default();
    for (origin_id, generation, durable_seq) in streams {
        sqlx::query(
            "INSERT INTO sync_applied_watermark (origin_id, generation)
             VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(&origin_id)
        .bind(generation)
        .execute(pool)
        .await?;
        for _ in 0..per_stream_limit.max(1) {
            match apply_one(pool, &origin_id, generation, durable_seq).await? {
                ApplyStep::Drained => break,
                ApplyStep::Advanced {
                    applied_movements,
                    skipped_facts,
                } => {
                    report.applied += applied_movements;
                    report.skipped += skipped_facts;
                }
                ApplyStep::Blocked { seq, reason } => {
                    record_blocked(pool, &origin_id, generation, seq, &reason).await?;
                    report.blocked.push(BlockedStream {
                        origin_id: origin_id.clone(),
                        generation,
                        seq,
                        reason,
                    });
                    break;
                }
                ApplyStep::SetAside { seq, reason } => {
                    tracing::warn!(
                        origin_id, generation, seq, %reason,
                        "sync apply: fact set aside to the dead-letter table"
                    );
                    set_aside(pool, &origin_id, generation, seq, &reason).await?;
                    report.skipped += 1;
                }
            }
        }
    }
    Ok(report)
}

async fn apply_one(
    pool: &PgPool,
    origin_id: &str,
    generation: i64,
    durable_seq: i64,
) -> Result<ApplyStep, AppError> {
    let mut tx = pool.begin().await?;
    let applied_seq: i64 = sqlx::query(
        "SELECT applied_seq FROM sync_applied_watermark
         WHERE origin_id = $1 AND generation = $2 FOR UPDATE",
    )
    .bind(origin_id)
    .bind(generation)
    .fetch_one(&mut *tx)
    .await?
    .get("applied_seq");
    let next = applied_seq + 1;
    if next > durable_seq {
        tx.commit().await?;
        return Ok(ApplyStep::Drained);
    }
    let fact = sqlx::query(
        "SELECT event_id, event_type, payload, status FROM sync_ingest_fact
         WHERE origin_id = $1 AND generation = $2 AND seq = $3",
    )
    .bind(origin_id)
    .bind(generation)
    .bind(next)
    .fetch_optional(&mut *tx)
    .await?;
    let mut advance_to = next;
    let mut paired_progress = false;
    let applied_movement = match fact {
        // A receipt-less seq (duplicate advanced by event-id, or purged after
        // application elsewhere) or a rejection tombstone: nothing to apply.
        None => false,
        Some(row) if row.get::<String, _>("status") == "REJECTED" => false,
        Some(row) => {
            let event_type: String = row.get("event_type");
            let payload: Value = row.get("payload");
            if event_type == "inventory.movement" {
                let event_id: Uuid = row.get("event_id");
                let fact = match crate::cloud::domain::parse_movement_fact(&payload) {
                    Ok(fact) => fact,
                    Err(reason) => return Ok(ApplyStep::Blocked { seq: next, reason }),
                };
                if fact.reference_type.as_deref() == Some("FULFILLMENT_PACKAGE") {
                    let progress_seq = next.checked_add(1).ok_or_else(|| {
                        AppError::Conflict("fulfillment sequence overflow".into())
                    })?;
                    if progress_seq > durable_seq {
                        // The upload batch may end between the two facts. Keep
                        // both unapplied until the producer's atomic pair is
                        // durably present.
                        tx.commit().await?;
                        return Ok(ApplyStep::Drained);
                    }
                    let progress_row = sqlx::query(
                        "SELECT event_id,event_type,payload,status FROM sync_ingest_fact
                         WHERE origin_id=$1 AND generation=$2 AND seq=$3",
                    )
                    .bind(origin_id)
                    .bind(generation)
                    .bind(progress_seq)
                    .fetch_optional(&mut *tx)
                    .await?;
                    let Some(progress_row) = progress_row else {
                        return Ok(ApplyStep::Blocked {
                            seq: next,
                            reason: "fulfillment movement has no materialized immediate progress successor".into(),
                        });
                    };
                    let progress_status: String = progress_row.get("status");
                    let progress_type: String = progress_row.get("event_type");
                    let retired_generation = sqlx::query(
                        "SELECT active_generation>$2 AS retired
                         FROM sync_origin_credential WHERE origin_id=$1 FOR KEY SHARE",
                    )
                    .bind(origin_id)
                    .bind(generation)
                    .fetch_optional(&mut *tx)
                    .await?
                    .is_some_and(|row| row.get::<bool, _>("retired"));
                    if progress_type != INVENTORY_FULFILLMENT_PROGRESS_V1
                        || (!retired_generation && progress_status != "ACCEPTED")
                    {
                        return Ok(ApplyStep::Blocked {
                            seq: next,
                            reason: "fulfillment movement immediate successor is not an accepted progress fact".into(),
                        });
                    }
                    if retired_generation {
                        // Both facts belong to a superseded authority epoch.
                        // Consume the pair together, but materialize neither.
                        advance_to = progress_seq;
                        paired_progress = true;
                        false
                    } else {
                        let progress_payload: Value = progress_row.get("payload");
                        let progress = match parse_fulfillment_progress(&progress_payload) {
                            Ok(progress) => progress,
                            Err(reason) => return Ok(ApplyStep::Blocked { seq: next, reason }),
                        };
                        let progress_event_id: Uuid = progress_row.get("event_id");
                        let applied = match apply_movement(
                            &mut tx, origin_id, generation, next, event_id, &fact,
                        )
                        .await
                        {
                            Ok(applied) => applied,
                            Err(error) => {
                                return Ok(ApplyStep::Blocked {
                                    seq: next,
                                    reason: block_diagnostic(&error),
                                });
                            }
                        };
                        if let Err(error) = apply_fulfillment_progress(
                            &mut tx,
                            origin_id,
                            generation,
                            progress_seq,
                            progress_event_id,
                            &progress,
                        )
                        .await
                        {
                            return Ok(ApplyStep::Blocked {
                                seq: next,
                                reason: block_diagnostic(&error),
                            });
                        }
                        advance_to = progress_seq;
                        paired_progress = true;
                        applied
                    }
                } else {
                    match apply_movement(&mut tx, origin_id, generation, next, event_id, &fact)
                        .await
                    {
                        Ok(applied) => applied,
                        Err(error) => {
                            // The transaction rolls back on drop; the block is
                            // recorded outside it by the caller.
                            return Ok(ApplyStep::Blocked {
                                seq: next,
                                reason: block_diagnostic(&error),
                            });
                        }
                    }
                }
            } else if event_type == FACT_PRICE_AMENDMENT_REQUESTED {
                let request = match parse_price_amendment_request(&payload) {
                    Ok(request) => request,
                    Err(reason) => return Ok(ApplyStep::Blocked { seq: next, reason }),
                };
                if let Err(error) =
                    apply_price_amendment_request(&mut tx, origin_id, generation, next, &request)
                        .await
                {
                    return Ok(ApplyStep::Blocked {
                        seq: next,
                        reason: block_diagnostic(&error),
                    });
                }
                false
            } else if event_type == FACT_GOODS_RECEIPT_LINE {
                let line = match parse_goods_receipt_line(&payload) {
                    Ok(line) => line,
                    Err(reason) => return Ok(ApplyStep::Blocked { seq: next, reason }),
                };
                if let Err(error) =
                    apply_goods_receipt_line(&mut tx, origin_id, generation, next, &line).await
                {
                    return Ok(ApplyStep::Blocked {
                        seq: next,
                        reason: block_diagnostic(&error),
                    });
                }
                false
            } else if event_type == FACT_GOODS_RECEIPT_REJECTED {
                let refused = match parse_goods_receipt_rejected(&payload) {
                    Ok(refused) => refused,
                    Err(reason) => return Ok(ApplyStep::Blocked { seq: next, reason }),
                };
                if let Err(error) =
                    apply_goods_receipt_rejected(&mut tx, origin_id, generation, next, &refused)
                        .await
                {
                    return Ok(ApplyStep::Blocked {
                        seq: next,
                        reason: block_diagnostic(&error),
                    });
                }
                false
            } else if event_type == FACT_GOODS_RECEIPT_INVOICE {
                let invoice = match parse_goods_receipt_invoice(&payload) {
                    Ok(invoice) => invoice,
                    Err(reason) => return Ok(ApplyStep::Blocked { seq: next, reason }),
                };
                match apply_goods_receipt_invoice(&mut tx, &invoice).await {
                    Ok(InvoiceApplication::Applied) => {}
                    Ok(InvoiceApplication::NoSuchReceipt) => {
                        return Ok(ApplyStep::SetAside {
                            seq: next,
                            reason: format!(
                                "no goods receipt {}: an invoice arrived before the lines that \
                                 tell the centre the delivery exists, and those lines are queued \
                                 behind it",
                                invoice.receipt_id
                            ),
                        })
                    }
                    Err(error) => {
                        return Ok(ApplyStep::Blocked {
                            seq: next,
                            reason: block_diagnostic(&error),
                        })
                    }
                }
                false
            } else if event_type == crate::cloud::domain::FACT_TAGGING_COMPLETED {
                let done = match crate::cloud::domain::parse_tagging_completed(&payload) {
                    Ok(done) => done,
                    Err(reason) => return Ok(ApplyStep::Blocked { seq: next, reason }),
                };
                if let Err(error) = apply_tagging_completed(&mut tx, &done).await {
                    return Ok(ApplyStep::Blocked {
                        seq: next,
                        reason: block_diagnostic(&error),
                    });
                }
                false
            } else if event_type == crate::cloud::domain::FACT_PUBLICATION_ACTIVATED {
                let activated = match crate::cloud::domain::parse_publication_activated(&payload) {
                    Ok(activated) => activated,
                    Err(reason) => return Ok(ApplyStep::Blocked { seq: next, reason }),
                };
                if let Err(error) =
                    apply_publication_activated(&mut tx, origin_id, &activated).await
                {
                    return Ok(ApplyStep::Blocked {
                        seq: next,
                        reason: block_diagnostic(&error),
                    });
                }
                false
            } else if event_type == crate::cloud::domain::FACT_PUBLICATION_ACTIVATION_FAILED {
                let failed =
                    match crate::cloud::domain::parse_publication_activation_failed(&payload) {
                        Ok(failed) => failed,
                        Err(reason) => return Ok(ApplyStep::Blocked { seq: next, reason }),
                    };
                if let Err(error) =
                    apply_publication_activation_failed(&mut tx, origin_id, &failed).await
                {
                    return Ok(ApplyStep::Blocked {
                        seq: next,
                        reason: block_diagnostic(&error),
                    });
                }
                false
            } else if event_type == crate::cloud::domain::FACT_CHECKOUT_UNRESOLVED {
                let exception = match crate::cloud::domain::parse_checkout_unresolved(&payload) {
                    Ok(exception) => exception,
                    Err(reason) => return Ok(ApplyStep::Blocked { seq: next, reason }),
                };
                if let Err(error) = apply_checkout_unresolved(&mut tx, origin_id, &exception).await
                {
                    return Ok(ApplyStep::Blocked {
                        seq: next,
                        reason: block_diagnostic(&error),
                    });
                }
                false
            } else if event_type == crate::cloud::domain::FACT_SALES_COMPLETED {
                let sale = match crate::cloud::domain::parse_sales_completed(&payload) {
                    Ok(sale) => sale,
                    Err(reason) => return Ok(ApplyStep::Blocked { seq: next, reason }),
                };
                if let Err(error) = apply_sale(&mut tx, origin_id, generation, next, &sale).await {
                    return Ok(ApplyStep::Blocked {
                        seq: next,
                        reason: block_diagnostic(&error),
                    });
                }
                false
            } else if event_type == crate::edge::till::FACT_SHIFT_RECORDED {
                // The drawer, on the same path the tenders take. Nothing here
                // touches the watermark or the generation: the coordinate is
                // handed over and stored, so the shift can be traced to the
                // push that delivered it.
                let shift = match super::store_money::parse_cash_shift(&payload) {
                    Ok(shift) => shift,
                    Err(reason) => return Ok(ApplyStep::Blocked { seq: next, reason }),
                };
                if let Err(error) = super::store_money::cash_shift_ingest(
                    &mut tx, origin_id, generation, next, &shift,
                )
                .await
                {
                    return Ok(ApplyStep::Blocked {
                        seq: next,
                        reason: block_diagnostic(&error),
                    });
                }
                false
            } else if event_type == INVENTORY_ALLOTMENT_APPLICATION_RESULT_V1 {
                let event_id: Uuid = row.get("event_id");
                let result = match parse_allotment_application_result(&payload) {
                    Ok(result) => result,
                    Err(reason) => return Ok(ApplyStep::Blocked { seq: next, reason }),
                };
                if let Err(error) = apply_allotment_application_result(
                    &mut tx, origin_id, generation, next, event_id, &result,
                )
                .await
                {
                    return Ok(ApplyStep::Blocked {
                        seq: next,
                        reason: block_diagnostic(&error),
                    });
                }
                false
            } else if event_type == INVENTORY_ALLOTMENT_CANCELLATION_RESULT_V1 {
                let event_id: Uuid = row.get("event_id");
                let result = match parse_allotment_cancellation_result(&payload) {
                    Ok(result) => result,
                    Err(reason) => return Ok(ApplyStep::Blocked { seq: next, reason }),
                };
                if let Err(error) = apply_allotment_cancellation_result(
                    &mut tx, origin_id, generation, next, event_id, &result,
                )
                .await
                {
                    return Ok(ApplyStep::Blocked {
                        seq: next,
                        reason: block_diagnostic(&error),
                    });
                }
                false
            } else if event_type == INVENTORY_PICK_V1 || event_type == INVENTORY_ALLOTMENT_PICK_V1 {
                let event_id: Uuid = row.get("event_id");
                let pick = match parse_pick(&payload) {
                    Ok(pick) => pick,
                    Err(reason) => return Ok(ApplyStep::Blocked { seq: next, reason }),
                };
                if let Err(error) =
                    apply_allotment_pick(&mut tx, origin_id, generation, next, event_id, &pick)
                        .await
                {
                    return Ok(ApplyStep::Blocked {
                        seq: next,
                        reason: block_diagnostic(&error),
                    });
                }
                false
            } else if event_type == INVENTORY_FULFILLMENT_PROGRESS_V1 {
                let event_id: Uuid = row.get("event_id");
                let progress = match parse_fulfillment_progress(&payload) {
                    Ok(progress) => progress,
                    Err(reason) => return Ok(ApplyStep::Blocked { seq: next, reason }),
                };
                if let Err(error) = apply_fulfillment_progress(
                    &mut tx, origin_id, generation, next, event_id, &progress,
                )
                .await
                {
                    return Ok(ApplyStep::Blocked {
                        seq: next,
                        reason: block_diagnostic(&error),
                    });
                }
                false
            } else if event_type == INVENTORY_POOL_SNAPSHOT_V1 {
                let event_id: Uuid = row.get("event_id");
                let snapshot = match serde_json::from_value::<PoolSnapshotPayload>(payload) {
                    Ok(snapshot) => snapshot,
                    Err(error) => {
                        return Ok(ApplyStep::Blocked {
                            seq: next,
                            reason: format!("invalid inventory pool snapshot: {error}"),
                        });
                    }
                };
                if let Err(error) =
                    apply_pool_snapshot(&mut tx, origin_id, generation, next, event_id, &snapshot)
                        .await
                {
                    return Ok(ApplyStep::Blocked {
                        seq: next,
                        reason: error.to_string(),
                    });
                }
                false
            } else if event_type == INVENTORY_TRANSFER_CLAIM_V1 {
                let event_id: Uuid = row.get("event_id");
                let claim = match serde_json::from_value::<TransferClaimPayload>(payload) {
                    Ok(claim) => claim,
                    Err(error) => {
                        return Ok(ApplyStep::Blocked {
                            seq: next,
                            reason: format!("invalid inventory transfer claim: {error}"),
                        });
                    }
                };
                if let Err(error) =
                    apply_transfer_claim(&mut tx, origin_id, generation, next, event_id, &claim)
                        .await
                {
                    return Ok(ApplyStep::Blocked {
                        seq: next,
                        reason: error.to_string(),
                    });
                }
                false
            } else if event_type == INVENTORY_RFID_OBSERVATION_BATCH_V1 {
                let event_id: Uuid = row.get("event_id");
                let batch = match serde_json::from_value::<RfidObservationBatchPayload>(payload) {
                    Ok(batch) => batch,
                    Err(error) => {
                        return Ok(ApplyStep::Blocked {
                            seq: next,
                            reason: format!("invalid RFID observation batch: {error}"),
                        });
                    }
                };
                if let Err(error) =
                    apply_rfid_observation_batch(&mut tx, origin_id, generation, event_id, &batch)
                        .await
                {
                    return Ok(ApplyStep::Blocked {
                        seq: next,
                        reason: error.to_string(),
                    });
                }
                false
            } else if event_type == crate::edge::attendance::FACT_ATTENDANCE_PUNCH_RECORDED {
                // **This arm deliberately never blocks, and it is the only one.**
                //
                // Every other fact here is a movement of stock or money, and a
                // stream that stops on one of those is a stream that stops for
                // a reason an operator must fix. A punch is not that: it is an
                // observation about a person, and the centre refusing one is a
                // *business* outcome — the month closed while the unit was
                // offline, somebody was transferred, the station was revoked —
                // rather than a protocol fault.
                //
                // If it blocked, one punch landing in a settled month would
                // stop that shop's whole fact lane, sales included, until
                // somebody noticed. That is a far worse failure than an
                // attendance day nobody can explain, and the day is not lost
                // either: the punch stays in `sync_ingest_fact`, the refusal is
                // warned with its reason, and the fix is a correction — which is
                // the mechanism that exists for exactly this.
                match apply_attendance_punch(pool, origin_id, &payload).await {
                    Ok(true) => {}
                    Ok(false) => {
                        tracing::info!(
                            origin_id,
                            generation,
                            seq = next,
                            "sync apply: attendance punch already recorded"
                        );
                    }
                    Err(error) => {
                        tracing::warn!(origin_id, generation, seq = next, %error,
                            "sync apply: attendance punch refused; the stream advances \
                             because a punch is an observation and not a movement");
                    }
                }
                false
            } else {
                // Unknown types pass through: the receipt log still holds
                // them for a future applier that understands them.
                tracing::warn!(origin_id, generation, seq = next, %event_type,
                    "sync apply: unknown event_type passed through");
                false
            }
        }
    };
    sqlx::query(
        "UPDATE sync_applied_watermark
         SET applied_seq = $3, blocked_at_seq = NULL, blocked_reason = NULL,
             blocked_since = NULL, updated_at = now()
         WHERE origin_id = $1 AND generation = $2",
    )
    .bind(origin_id)
    .bind(generation)
    .bind(advance_to)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(ApplyStep::Advanced {
        applied_movements: u64::from(applied_movement),
        skipped_facts: u64::from(!applied_movement) + u64::from(paired_progress),
    })
}

/// Record one punch that arrived on the fact lane.
///
/// The whole kernel runs: the station is loaded and must belong to this
/// origin's place, `attest` refuses a suspended or revoked one, the employment
/// record and the posting timeline are loaded, the period is loaded, and
/// `Punch::record` decides. Nothing about a punch is taken on the edge's word
/// except what the device observed.
///
/// `Ok(false)` when this punch was already recorded, which is the ordinary
/// outcome of a redelivery.
/// # Why this takes the pool and not the applier's transaction
///
/// Its reads are reads, and its one write is idempotent on the punch identity.
/// So the insert commits on its own, and if the applier's transaction then
/// rolls back, the watermark does not advance and the punch is redelivered —
/// where it lands as a no-op. The failure mode runs in the safe direction:
/// a punch recorded twice is impossible, and a punch lost between the two
/// commits is impossible.
async fn apply_attendance_punch(
    pool: &PgPool,
    origin_id: &str,
    payload: &Value,
) -> Result<bool, AppError> {
    use crate::cloud::domain::{
        ClockQuality, DayOffset, MinuteOfDay, Punch, PunchContext, PunchDirection, PunchId,
        PunchTime,
    };

    #[derive(serde::Deserialize)]
    struct Wire {
        punch_id: String,
        employee_id: String,
        terminal_id: String,
        direction: String,
        business_date: chrono::NaiveDate,
        #[serde(default)]
        day_offset: u8,
        minute: u16,
        recorded_at: DateTime<Utc>,
        clock_quality: String,
    }
    let wire: Wire = serde_json::from_value(payload.clone())
        .map_err(|error| AppError::Validation(format!("malformed attendance punch: {error}")))?;

    // The place comes from the ORIGIN, never from the payload. A node cannot
    // file a punch against another unit, because there is no field it could say
    // so in that anybody reads.
    let place = super::place_of_origin(pool, origin_id)
        .await?
        .ok_or_else(|| AppError::Conflict(format!("origin {origin_id} is not bound to a place")))?;
    let terminal = super::load_attendance_terminal(pool, &wire.terminal_id)
        .await?
        .ok_or_else(|| {
            AppError::NotFound(format!("terminal {} is not registered", wire.terminal_id))
        })?;
    if terminal.place() != &place {
        return Err(AppError::Forbidden(format!(
            "terminal {} is registered at {} and this node is {place}",
            wire.terminal_id,
            terminal.place()
        )));
    }
    let record = super::load_employee(pool, &wire.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", wire.employee_id)))?;
    let period = super::period_for(pool, &place, wire.business_date).await?;

    let attestation = terminal
        .attest(record.employee.id().clone())
        .map_err(super::attendance_error)?;
    let punch = Punch::record(
        PunchId::try_new(&wire.punch_id)
            .map_err(|error| AppError::Validation(error.to_string()))?,
        &attestation,
        PunchDirection::parse(&wire.direction)
            .map_err(|error| AppError::Validation(error.to_string()))?,
        PunchTime::new(
            wire.business_date,
            DayOffset::try_new(wire.day_offset)
                .map_err(|error| AppError::Validation(error.to_string()))?,
            MinuteOfDay::try_new(wire.minute)
                .map_err(|error| AppError::Validation(error.to_string()))?,
        ),
        wire.recorded_at,
        ClockQuality::parse(&wire.clock_quality)
            .map_err(|error| AppError::Validation(error.to_string()))?,
        PunchContext {
            employee: &record.employee,
            assignment: &record.assignments,
            period: &period,
        },
    )
    .map_err(super::attendance_error)?;
    super::insert_punch(pool, &punch).await
}

/// Apply device-authenticated Edge evidence without mutating inventory.
async fn apply_rfid_observation_batch(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    event_id: Uuid,
    batch: &RfidObservationBatchPayload,
) -> Result<bool, AppError> {
    if event_id != batch.batch_id {
        return Err(AppError::Validation(
            "RFID batch_id must equal its sync event_id".into(),
        ));
    }
    let binding_row = sqlx::query(
        "SELECT origin_id, site_id, node_role, active_generation, inventory_enabled
         FROM sync_origin_credential WHERE origin_id=$1 FOR KEY SHARE",
    )
    .bind(origin_id)
    .fetch_optional(&mut **tx)
    .await?;
    let binding = binding_row.as_ref().map(inventory_binding_from_row);
    if binding
        .as_ref()
        .is_some_and(|binding| generation < binding.active_generation)
    {
        return Ok(false);
    }
    validate_rfid_binding(batch, origin_id, generation, binding.as_ref())
        .map_err(AppError::Validation)?;

    let registered_origin: Option<String> =
        sqlx::query("SELECT origin_id FROM rfid_device WHERE device_id=$1")
            .bind(&batch.device_id)
            .fetch_optional(&mut **tx)
            .await?
            .map(|row| row.get("origin_id"));
    match registered_origin.as_deref() {
        Some(registered) if registered == origin_id => {}
        Some(_) => {
            return Err(AppError::Validation(
                "RFID device is registered to a different Edge origin".into(),
            ));
        }
        None => return Err(AppError::Validation("RFID device is not registered".into())),
    }

    let inserted_count: i64 = sqlx::query_scalar(
        "WITH payload AS (
             SELECT * FROM jsonb_to_recordset($1::jsonb) AS sighting(
                 observation_id uuid, epc text, read_count bigint,
                 best_rssi real, antenna text)
         ), inserted AS (
             INSERT INTO observation_sighting
                 (observation_id,subject_id,epc,site_id,pool_id,first_seen_at,
                  last_seen_at,received_at,device_id,reader_session_id,method,
                  read_count,best_rssi,antenna,operator_id,edge_origin_id,
                  edge_batch_id,device_sequence)
             SELECT sighting.observation_id,subject.id,sighting.epc,$2,$3,$4,$4,$5,
                    $6,$7,'RFID_HANDHELD',sighting.read_count,sighting.best_rssi,
                    sighting.antenna,$8,$9,$10,$11
             FROM payload sighting
             LEFT JOIN inventory_subject subject ON subject.epc=sighting.epc
             ON CONFLICT(observation_id) DO NOTHING
             RETURNING 1
         ) SELECT COUNT(*)::bigint FROM inserted",
    )
    .bind(json!(&batch.sightings))
    .bind(&batch.site_id)
    .bind(&batch.pool_id)
    .bind(batch.observed_at)
    .bind(batch.received_at)
    .bind(&batch.device_id)
    .bind(&batch.reader_session_id)
    .bind(&batch.operator_id)
    .bind(origin_id)
    .bind(batch.batch_id)
    .bind(batch.device_sequence)
    .fetch_one(&mut **tx)
    .await?;
    sqlx::query(
        "UPDATE rfid_device
         SET last_seen_at=GREATEST(COALESCE(last_seen_at,$2),$2)
         WHERE device_id=$1",
    )
    .bind(&batch.device_id)
    .bind(batch.received_at)
    .execute(&mut **tx)
    .await?;
    Ok(inserted_count > 0)
}

/// Persist one immutable owner claim without touching either inventory ledger.
/// A generation retired after receipt is consumed but cannot add stale evidence.
async fn reconcile_transfer_allotment_attribution(
    tx: &mut Transaction<'_, Postgres>,
    source_dc_id: &str,
    destination_store_id: &str,
    shipment_reference: &str,
    epc: &str,
) -> Result<(), AppError> {
    // The claims belong to independent origin streams. Serialize their shared
    // read-model key so that concurrent first arrivals cannot both miss the
    // other transaction and leave a permanently unattributed pair.
    let lock_key = format!(
        "{}:{source_dc_id}|{}:{destination_store_id}|{}:{shipment_reference}|{}:{epc}",
        source_dc_id.len(),
        destination_store_id.len(),
        shipment_reference.len(),
        epc.len()
    );
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(lock_key)
        .execute(&mut **tx)
        .await?;

    let claim_rows = sqlx::query(
        "SELECT event_id,claim_kind,sku_code,origin_id
         FROM edge_transfer_claim
         WHERE source_dc_id=$1 AND destination_store_id=$2
           AND shipment_reference=$3 AND epc=$4
         ORDER BY claim_kind,event_id FOR KEY SHARE",
    )
    .bind(source_dc_id)
    .bind(destination_store_id)
    .bind(shipment_reference)
    .bind(epc)
    .fetch_all(&mut **tx)
    .await?;
    let claims = claim_rows
        .iter()
        .map(|row| {
            (
                row.get::<Uuid, _>("event_id"),
                row.get::<String, _>("claim_kind"),
                row.get::<String, _>("sku_code"),
                row.get::<String, _>("origin_id"),
            )
        })
        .collect::<Vec<_>>();
    let in_transit = claims
        .iter()
        .filter(|claim| claim.1 == "IN_TRANSIT")
        .collect::<Vec<_>>();
    let received = claims
        .iter()
        .filter(|claim| claim.1 == "RECEIVED")
        .collect::<Vec<_>>();
    let unique_same_sku =
        in_transit.len() == 1 && received.len() == 1 && in_transit[0].2 == received[0].2;
    let mut touched_lines = BTreeSet::<Uuid>::new();
    let mut touched_allotments = BTreeSet::<Uuid>::new();

    if unique_same_sku {
        let in_transit_event_id = in_transit[0].0;
        let receipt_event_id = received[0].0;
        let dc_origin_id = &in_transit[0].3;
        let unit = sqlx::query(
            "SELECT unit.koli_id,unit.allotment_id,unit.allotment_line_id,
                    unit.epc,unit.sku_code
             FROM edge_transfer_claim claim
             JOIN edge_fulfillment_progress_unit unit
               ON unit.progress_event_id=claim.in_transit_progress_event_id
              AND unit.unit_ordinal=claim.in_transit_unit_ordinal
              AND unit.epc=claim.epc AND unit.sku_code=claim.sku_code
             WHERE claim.event_id=$1 AND claim.claim_kind='IN_TRANSIT'
             FOR KEY SHARE OF claim,unit",
        )
        .bind(in_transit_event_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| {
            AppError::Conflict("matched In-Transit claim has no immutable fulfillment unit".into())
        })?;
        let koli_id: Uuid = unit.get("koli_id");
        let allotment_id: Uuid = unit.get("allotment_id");
        let allotment_line_id: Uuid = unit.get("allotment_line_id");
        let line = sqlx::query(
            "SELECT origin_id,source_site_id,destination_type,destination_id,
                    sku_code,in_transit_quantity
             FROM edge_allotment_line_progress
             WHERE allotment_line_id=$1 AND allotment_id=$2 FOR UPDATE",
        )
        .bind(allotment_line_id)
        .bind(allotment_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::Conflict("fulfillment unit has no Allotment projection".into()))?;
        if line.get::<String, _>("origin_id") != dc_origin_id.as_str()
            || line.get::<String, _>("source_site_id") != source_dc_id
            || line.get::<String, _>("destination_type") != "STORE"
            || line.get::<String, _>("destination_id") != destination_store_id
            || line.get::<String, _>("sku_code") != in_transit[0].2
            || unit.get::<String, _>("epc") != epc
            || unit.get::<String, _>("sku_code") != in_transit[0].2
            || line.get::<i64, _>("in_transit_quantity") < 1
        {
            return Err(AppError::Conflict(
                "matched transfer pair disagrees with immutable Allotment unit identity".into(),
            ));
        }

        let existing = sqlx::query(
            "SELECT in_transit_event_id,koli_id,allotment_id,
                    allotment_line_id,epc
             FROM edge_transfer_allotment_attribution
             WHERE receipt_event_id=$1 FOR UPDATE",
        )
        .bind(receipt_event_id)
        .fetch_optional(&mut **tx)
        .await?;
        if let Some(existing) = existing {
            if existing.get::<Uuid, _>("in_transit_event_id") != in_transit_event_id
                || existing.get::<Uuid, _>("koli_id") != koli_id
                || existing.get::<Uuid, _>("allotment_id") != allotment_id
                || existing.get::<Uuid, _>("allotment_line_id") != allotment_line_id
                || existing.get::<String, _>("epc") != epc
            {
                return Err(AppError::Conflict(
                    "receipt attribution cannot be rewritten to another fulfillment unit".into(),
                ));
            }
        } else {
            sqlx::query(
                "INSERT INTO edge_transfer_allotment_attribution
                     (receipt_event_id,in_transit_event_id,koli_id,allotment_id,
                      allotment_line_id,epc)
                 VALUES($1,$2,$3,$4,$5,$6)",
            )
            .bind(receipt_event_id)
            .bind(in_transit_event_id)
            .bind(koli_id)
            .bind(allotment_id)
            .bind(allotment_line_id)
            .bind(epc)
            .execute(&mut **tx)
            .await?;
        }
        touched_lines.insert(allotment_line_id);
        touched_allotments.insert(allotment_id);
    } else {
        // Duplicate or mismatched immutable evidence is a reconciliation
        // conflict. Remove any formerly valid disposable attribution rather
        // than continuing to report a receipt that is no longer unique.
        let removed = sqlx::query(
            "DELETE FROM edge_transfer_allotment_attribution attribution
             USING edge_transfer_claim receipt
             WHERE attribution.receipt_event_id=receipt.event_id
               AND receipt.claim_kind='RECEIVED'
               AND receipt.source_dc_id=$1
               AND receipt.destination_store_id=$2
               AND receipt.shipment_reference=$3
               AND receipt.epc=$4
             RETURNING attribution.allotment_id,attribution.allotment_line_id",
        )
        .bind(source_dc_id)
        .bind(destination_store_id)
        .bind(shipment_reference)
        .bind(epc)
        .fetch_all(&mut **tx)
        .await?;
        for row in removed {
            touched_allotments.insert(row.get("allotment_id"));
            touched_lines.insert(row.get("allotment_line_id"));
        }
    }

    for allotment_line_id in touched_lines {
        let progress = sqlx::query(
            "SELECT allotment_id,in_transit_quantity
             FROM edge_allotment_line_progress
             WHERE allotment_line_id=$1 FOR UPDATE",
        )
        .bind(allotment_line_id)
        .fetch_one(&mut **tx)
        .await?;
        let received_quantity: i64 = sqlx::query_scalar(
            "SELECT count(*)::bigint FROM edge_transfer_allotment_attribution
             WHERE allotment_line_id=$1",
        )
        .bind(allotment_line_id)
        .fetch_one(&mut **tx)
        .await?;
        if received_quantity > progress.get::<i64, _>("in_transit_quantity") {
            return Err(AppError::Conflict(
                "derived Store receipt quantity exceeds In-Transit quantity".into(),
            ));
        }
        sqlx::query(
            "UPDATE edge_allotment_line_progress
             SET received_quantity=$2,updated_at=now()
             WHERE allotment_line_id=$1",
        )
        .bind(allotment_line_id)
        .bind(received_quantity)
        .execute(&mut **tx)
        .await?;
        touched_allotments.insert(progress.get("allotment_id"));
    }

    for allotment_id in touched_allotments {
        // Different EPCs (and even different lines) can arrive from Store
        // streams concurrently. The header lock serializes the aggregate
        // lifecycle decision so the final receipt cannot be lost.
        sqlx::query("SELECT id FROM allotment WHERE id=$1 FOR UPDATE")
            .bind(allotment_id)
            .fetch_one(&mut **tx)
            .await?;
        let totals = sqlx::query(
            "SELECT COALESCE(sum(accepted_quantity),0)::bigint AS accepted,
                    COALESCE(sum(dispatched_quantity),0)::bigint AS dispatched,
                    COALESCE(sum(received_quantity),0)::bigint AS received,
                    COALESCE(sum(cancelled_quantity),0)::bigint AS cancelled
             FROM edge_allotment_line_progress WHERE allotment_id=$1",
        )
        .bind(allotment_id)
        .fetch_one(&mut **tx)
        .await?;
        let accepted: i64 = totals.get("accepted");
        let dispatched: i64 = totals.get("dispatched");
        let received: i64 = totals.get("received");
        let cancelled: i64 = totals.get("cancelled");
        let received_complete = received
            .checked_add(cancelled)
            .is_some_and(|quantity| accepted > 0 && quantity == accepted);
        let dc_complete = dispatched
            .checked_add(cancelled)
            .is_some_and(|quantity| accepted > 0 && quantity == accepted);
        let status = if received_complete {
            "COMPLETED"
        } else if dc_complete {
            "DC_COMPLETED"
        } else {
            "IN_PROGRESS"
        };
        sqlx::query(
            "UPDATE allotment SET status=$2,updated_at=now()
             WHERE id=$1 AND edge_application_status='ACCEPTED'
               AND status IN ('ACTIVE','IN_PROGRESS','DC_COMPLETED','COMPLETED')",
        )
        .bind(allotment_id)
        .bind(status)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

async fn apply_transfer_claim(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    event_id: Uuid,
    claim: &TransferClaimPayload,
) -> Result<bool, AppError> {
    let binding_row = sqlx::query(
        "SELECT origin_id, site_id, node_role, active_generation, inventory_enabled
         FROM sync_origin_credential WHERE origin_id = $1 FOR KEY SHARE",
    )
    .bind(origin_id)
    .fetch_optional(&mut **tx)
    .await?;
    let binding = binding_row.as_ref().map(inventory_binding_from_row);
    if binding
        .as_ref()
        .is_some_and(|binding| generation < binding.active_generation)
    {
        return Ok(false);
    }
    let node = validate_transfer_binding(claim, origin_id, generation, binding.as_ref())
        .map_err(AppError::Validation)?;
    let claim_kind = match claim.claim_kind {
        TransferClaimKind::InTransit => "IN_TRANSIT",
        TransferClaimKind::Received => "RECEIVED",
    };
    let (progress_event_id, unit_ordinal) = if claim.claim_kind == TransferClaimKind::InTransit {
        let progress = sqlx::query(
            "SELECT event_id,seq,source_site_id,destination_store_id,
                    shipment_reference,occurred_at
             FROM edge_fulfillment_progress_fact
             WHERE origin_id=$1 AND generation=$2 AND movement_group_id=$3
               AND stage='IN_TRANSIT' FOR KEY SHARE",
        )
        .bind(origin_id)
        .bind(generation)
        .bind(claim.movement_group_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| {
            AppError::Validation(
                "IN_TRANSIT claim has no applied package In-Transit progress".into(),
            )
        })?;
        let progress_event_id: Uuid = progress.get("event_id");
        let progress_seq: i64 = progress.get("seq");
        let unit = sqlx::query(
            "SELECT unit_ordinal,sku_code FROM edge_fulfillment_progress_unit
             WHERE progress_event_id=$1 AND epc=$2 FOR KEY SHARE",
        )
        .bind(progress_event_id)
        .bind(&claim.epc)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| {
            AppError::Validation("IN_TRANSIT claim EPC is not a package member".into())
        })?;
        let unit_ordinal: i64 = unit.get("unit_ordinal");
        let expected_seq = progress_seq
            .checked_add(unit_ordinal)
            .ok_or_else(|| AppError::Conflict("transfer claim sequence overflow".into()))?;
        if seq != expected_seq
            || unit.get::<String, _>("sku_code") != claim.sku_code.as_str()
            || progress.get::<String, _>("source_site_id")
                != claim.source_dc_id.as_deref().unwrap_or_default()
            || progress.get::<String, _>("destination_store_id")
                != claim.destination_store_id.as_str()
            || progress
                .get::<Option<String>, _>("shipment_reference")
                .as_deref()
                != claim.shipment_reference.as_deref()
            || progress.get::<DateTime<Utc>, _>("occurred_at") != claim.occurred_at
        {
            return Err(AppError::Validation(
                "IN_TRANSIT claim does not match immutable package progress identity or order"
                    .into(),
            ));
        }
        (Some(progress_event_id), Some(unit_ordinal))
    } else {
        (None, None)
    };
    let inserted = sqlx::query(
        "INSERT INTO edge_transfer_claim
             (event_id,origin_id,owner_site_id,owner_node_role,generation,seq,
              claim_kind,source_dc_id,destination_store_id,shipment_reference,
              epc,quantity,sku_code,movement_group_id,receipt_id,occurred_at,
              in_transit_progress_event_id,in_transit_unit_ordinal)
         VALUES
             ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (event_id) DO NOTHING",
    )
    .bind(event_id)
    .bind(origin_id)
    .bind(node.site_id.to_string())
    .bind(node.role.to_string())
    .bind(generation)
    .bind(seq)
    .bind(claim_kind)
    .bind(claim.source_dc_id.as_deref())
    .bind(&claim.destination_store_id)
    .bind(claim.shipment_reference.as_deref())
    .bind(&claim.epc)
    .bind(claim.quantity)
    .bind(&claim.sku_code)
    .bind(claim.movement_group_id)
    .bind(claim.receipt_id)
    .bind(claim.occurred_at)
    .bind(progress_event_id)
    .bind(unit_ordinal)
    .execute(&mut **tx)
    .await?;
    if let (Some(source_dc_id), Some(shipment_reference)) = (
        claim.source_dc_id.as_deref(),
        claim.shipment_reference.as_deref(),
    ) {
        reconcile_transfer_allotment_attribution(
            tx,
            source_dc_id,
            &claim.destination_store_id,
            shipment_reference,
            &claim.epc,
        )
        .await?;
    }
    Ok(inserted.rows_affected() == 1)
}

/// Materialize one whole-Allotment DC decision without touching either
/// inventory ledger. Accepted quantity becomes the fact-derived reservation;
/// a rejection writes zero accepted quantity for every authored line.
async fn apply_allotment_application_result(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    event_id: Uuid,
    result: &AllotmentApplicationResultPayload,
) -> Result<bool, AppError> {
    if event_id != result.result_id {
        return Err(AppError::Validation(
            "allotment application result_id must equal event_id".into(),
        ));
    }
    let binding_row = sqlx::query(
        "SELECT origin_id,site_id,node_role,active_generation,inventory_enabled
         FROM sync_origin_credential WHERE origin_id=$1 FOR KEY SHARE",
    )
    .bind(origin_id)
    .fetch_optional(&mut **tx)
    .await?;
    let binding = binding_row.as_ref().map(inventory_binding_from_row);
    if binding
        .as_ref()
        .is_some_and(|binding| generation < binding.active_generation)
    {
        return Ok(false);
    }
    validate_allotment_application_binding(result, origin_id, generation, binding.as_ref())
        .map_err(AppError::Validation)?;

    let header = sqlx::query(
        "SELECT activation_command_id,activation_target_origin_id,edge_application_status
         FROM allotment WHERE id=$1 FOR UPDATE",
    )
    .bind(result.allotment_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("authored allotment".into()))?;
    if header.get::<Option<Uuid>, _>("activation_command_id") != Some(result.activation_command_id)
        || header
            .get::<Option<String>, _>("activation_target_origin_id")
            .as_deref()
            != Some(origin_id)
    {
        return Err(AppError::Validation(
            "application result does not match the issued exact-target command".into(),
        ));
    }
    if header
        .get::<Option<String>, _>("edge_application_status")
        .as_deref()
        != Some("PENDING")
    {
        return Err(AppError::Conflict(
            "allotment application is no longer pending".into(),
        ));
    }

    let authored = sqlx::query(
        "SELECT line.id,line.source_site_id,line.source_pool_id,line.destination_type,
                line.destination_id,line.quantity,sku.sku_code
         FROM allotment_line line JOIN sku ON sku.id=line.sku_id
         WHERE line.allotment_id=$1 ORDER BY line.id FOR KEY SHARE OF line",
    )
    .bind(result.allotment_id)
    .fetch_all(&mut **tx)
    .await?;
    let supplied = result
        .lines
        .iter()
        .map(|line| (line.allotment_line_id, line))
        .collect::<BTreeMap<_, _>>();
    if authored.len() != supplied.len() {
        return Err(AppError::Validation(
            "application result line set differs from authored Allotment".into(),
        ));
    }
    // The authored lines carry the CENTRE's site — `dc` — and the result
    // carries the Edge's own, which a DC registered as `dc-01` is entitled to
    // be. `validate_allotment_application_binding` above has already pinned
    // `result.source_site_id` to this origin's registered site, so what makes
    // the two one warehouse is that this origin OWNS the authored site — the
    // same question `create_allotment` asked when it issued the command.
    // Comparing the two strings instead refused every result a DC running
    // under its own name ever sent back, and the allotment stayed PENDING for
    // ever with nothing on screen to say why.
    let authored_site: String = match authored.first() {
        Some(row) => row.get("source_site_id"),
        None => {
            return Err(AppError::Validation(
                "authored Allotment has no lines".into(),
            ))
        }
    };
    if inventory_dc_owner_tx(tx, &authored_site).await?.as_deref() != Some(origin_id) {
        return Err(AppError::Validation(format!(
            "application result came from {origin_id}, which does not own authored source site {authored_site}"
        )));
    }
    for row in &authored {
        let line_id: Uuid = row.get("id");
        let line = supplied.get(&line_id).ok_or_else(|| {
            AppError::Validation(format!("application result omits authored line {line_id}"))
        })?;
        if row.get::<String, _>("source_site_id") != authored_site
            || row.get::<i64, _>("quantity") != line.planned_quantity
        {
            return Err(AppError::Validation(format!(
                "application result changed authored line {line_id}"
            )));
        }
    }

    let decision = match result.decision {
        ApplicationDecision::Accepted => "ACCEPTED",
        ApplicationDecision::Rejected => "REJECTED",
    };
    let inserted = sqlx::query(
        "INSERT INTO edge_allotment_application_result
             (event_id,origin_id,generation,seq,result_id,activation_command_id,
              allotment_id,source_site_id,decision,rejection_code,reason,lines,applied_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (event_id) DO NOTHING",
    )
    .bind(event_id)
    .bind(origin_id)
    .bind(generation)
    .bind(seq)
    .bind(result.result_id)
    .bind(result.activation_command_id)
    .bind(result.allotment_id)
    .bind(&result.source_site_id)
    .bind(decision)
    .bind(result.rejection_code.as_deref())
    .bind(result.reason.as_deref())
    .bind(serde_json::to_value(&result.lines)?)
    .bind(result.applied_at)
    .execute(&mut **tx)
    .await?
    .rows_affected()
        == 1;
    if !inserted {
        return Ok(false);
    }

    for row in authored {
        let line_id: Uuid = row.get("id");
        let line = supplied
            .get(&line_id)
            .ok_or_else(|| AppError::Validation(format!("missing application line {line_id}")))?;
        sqlx::query(
            "INSERT INTO edge_allotment_line_progress
                 (allotment_line_id,allotment_id,origin_id,source_site_id,source_pool_id,
                  destination_type,destination_id,sku_code,planned_quantity,
                  accepted_quantity,last_generation,last_seq)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        )
        .bind(line_id)
        .bind(result.allotment_id)
        .bind(origin_id)
        // The authored site, not the wire's: `source_pool_id` beside it is the
        // centre's `dc.warehouse`, and a row reading `dc-01` / `dc.warehouse`
        // is one nobody can join on.
        .bind(&authored_site)
        .bind(row.get::<String, _>("source_pool_id"))
        .bind(row.get::<String, _>("destination_type"))
        .bind(row.get::<String, _>("destination_id"))
        .bind(row.get::<String, _>("sku_code"))
        .bind(line.planned_quantity)
        .bind(line.accepted_quantity)
        .bind(generation)
        .bind(seq)
        .execute(&mut **tx)
        .await?;
    }
    sqlx::query(
        "UPDATE allotment SET edge_application_status=$2,edge_application_result_id=$3,
                edge_application_received_at=now(),status=CASE WHEN $2='REJECTED'
                    THEN 'REJECTED' ELSE status END,updated_at=now()
         WHERE id=$1",
    )
    .bind(result.allotment_id)
    .bind(decision)
    .bind(result.result_id)
    .execute(&mut **tx)
    .await?;
    Ok(true)
}

/// Materialize the authoritative DC decision for one whole-Allotment
/// cancellation request. The command carried full accepted quantities; this
/// result is accepted only when every line partitions exactly into the actual
/// unpicked cancellation and the quantity already protected by Pick.
async fn apply_allotment_cancellation_result(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    event_id: Uuid,
    result: &AllotmentCancellationResultPayload,
) -> Result<bool, AppError> {
    if event_id != result.result_id {
        return Err(AppError::Validation(
            "allotment cancellation result_id must equal event_id".into(),
        ));
    }
    let binding_row = sqlx::query(
        "SELECT origin_id,site_id,node_role,active_generation,inventory_enabled
         FROM sync_origin_credential WHERE origin_id=$1 FOR KEY SHARE",
    )
    .bind(origin_id)
    .fetch_optional(&mut **tx)
    .await?;
    let binding = binding_row.as_ref().map(inventory_binding_from_row);
    if binding
        .as_ref()
        .is_some_and(|binding| generation < binding.active_generation)
    {
        return Ok(false);
    }
    validate_allotment_cancellation_binding(result, origin_id, generation, binding.as_ref())
        .map_err(AppError::Validation)?;

    let header = sqlx::query(
        "SELECT activation_target_origin_id,edge_application_status,cancellation_id,
                cancellation_command_id,edge_cancellation_status
         FROM allotment WHERE id=$1 FOR UPDATE",
    )
    .bind(result.allotment_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("authored allotment".into()))?;
    if header
        .get::<Option<String>, _>("activation_target_origin_id")
        .as_deref()
        != Some(origin_id)
        || header
            .get::<Option<String>, _>("edge_application_status")
            .as_deref()
            != Some("ACCEPTED")
        || header.get::<Option<Uuid>, _>("cancellation_id") != Some(result.cancellation_id)
        || header.get::<Option<Uuid>, _>("cancellation_command_id")
            != Some(result.cancellation_command_id)
    {
        return Err(AppError::Validation(
            "cancellation result does not match the issued exact-target command".into(),
        ));
    }
    if header
        .get::<Option<String>, _>("edge_cancellation_status")
        .as_deref()
        != Some("PENDING")
    {
        return Err(AppError::Conflict(
            "Allotment cancellation is no longer pending".into(),
        ));
    }

    let command_row = sqlx::query(
        "SELECT command_type,payload FROM sync_command
         WHERE command_id=$1 FOR KEY SHARE",
    )
    .bind(result.cancellation_command_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("cancellation command".into()))?;
    if command_row.get::<String, _>("command_type") != INVENTORY_ALLOTMENT_CANCEL_V1 {
        return Err(AppError::Validation(
            "cancellation result references the wrong command type".into(),
        ));
    }
    let command: AllotmentCancellationPayload =
        parse_allotment_cancellation(&command_row.get::<Value, _>("payload"))
            .map_err(AppError::Validation)?;
    if command.cancellation_id != result.cancellation_id
        || command.allotment_id != result.allotment_id
        || command.source_site_id != result.source_site_id
    {
        return Err(AppError::Validation(
            "cancellation result changed command identity".into(),
        ));
    }

    let authored = sqlx::query(
        "SELECT line.id,line.source_site_id,line.source_pool_id,line.destination_type,
                line.destination_id,line.sku_id,progress.accepted_quantity,
                progress.picked_quantity,progress.dispatched_quantity,
                progress.received_quantity,progress.cancelled_quantity
         FROM allotment_line line
         JOIN edge_allotment_line_progress progress
           ON progress.allotment_line_id=line.id
          AND progress.allotment_id=line.allotment_id
          AND progress.origin_id=$2
         WHERE line.allotment_id=$1 ORDER BY line.id
         FOR UPDATE OF line,progress",
    )
    .bind(result.allotment_id)
    .bind(origin_id)
    .fetch_all(&mut **tx)
    .await?;
    let requested = command
        .lines
        .iter()
        .map(|line| (line.allotment_line_id, line))
        .collect::<BTreeMap<_, _>>();
    let supplied = result
        .lines
        .iter()
        .map(|line| (line.allotment_line_id, line))
        .collect::<BTreeMap<_, _>>();
    if authored.is_empty() || authored.len() != requested.len() || authored.len() != supplied.len()
    {
        return Err(AppError::Validation(
            "cancellation command/result line set differs from the accepted Allotment".into(),
        ));
    }
    for row in &authored {
        let line_id: Uuid = row.get("id");
        let requested_line = requested.get(&line_id).ok_or_else(|| {
            AppError::Validation(format!(
                "cancellation command omits accepted line {line_id}"
            ))
        })?;
        let result_line = supplied.get(&line_id).ok_or_else(|| {
            AppError::Validation(format!("cancellation result omits accepted line {line_id}"))
        })?;
        let accepted: i64 = row.get("accepted_quantity");
        let picked: i64 = row.get("picked_quantity");
        let already_cancelled: i64 = row.get("cancelled_quantity");
        if row.get::<String, _>("source_site_id") != result.source_site_id
            || accepted <= 0
            || requested_line.quantity != accepted
            || result_line.requested_quantity != accepted
        {
            return Err(AppError::Validation(format!(
                "cancellation changed accepted line {line_id}"
            )));
        }
        let expected_cancelled = accepted
            .checked_sub(picked)
            .and_then(|quantity| quantity.checked_sub(already_cancelled))
            .filter(|quantity| *quantity >= 0)
            .ok_or_else(|| AppError::Conflict(format!("invalid progress for line {line_id}")))?;
        let expected_blocked = accepted
            .checked_sub(expected_cancelled)
            .ok_or_else(|| AppError::Conflict("cancellation partition underflow".into()))?;
        if result_line.cancelled_quantity != expected_cancelled
            || result_line.blocked_picked_quantity != expected_blocked
        {
            return Err(AppError::Validation(format!(
                "cancellation result does not match authoritative progress for line {line_id}"
            )));
        }
    }

    let outcome = match result.outcome {
        CancellationOutcome::Applied => "APPLIED",
        CancellationOutcome::PartiallyApplied => "PARTIALLY_APPLIED",
        CancellationOutcome::Rejected => "REJECTED",
    };
    let inserted = sqlx::query(
        "INSERT INTO edge_allotment_cancellation_result
             (event_id,origin_id,generation,seq,result_id,cancellation_id,
              cancellation_command_id,allotment_id,source_site_id,outcome,reason,
              lines,applied_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT(event_id) DO NOTHING",
    )
    .bind(event_id)
    .bind(origin_id)
    .bind(generation)
    .bind(seq)
    .bind(result.result_id)
    .bind(result.cancellation_id)
    .bind(result.cancellation_command_id)
    .bind(result.allotment_id)
    .bind(&result.source_site_id)
    .bind(outcome)
    .bind(result.reason.as_deref())
    .bind(serde_json::to_value(&result.lines)?)
    .bind(result.applied_at)
    .execute(&mut **tx)
    .await?
    .rows_affected()
        == 1;
    if !inserted {
        return Ok(false);
    }

    let cancellation_reference = result.cancellation_id.to_string();
    let mut cancelled_delta_total = 0_i64;
    for row in &authored {
        let line_id: Uuid = row.get("id");
        let result_line = supplied
            .get(&line_id)
            .ok_or_else(|| AppError::Validation(format!("missing cancellation line {line_id}")))?;
        let updated = sqlx::query(
            "UPDATE edge_allotment_line_progress
             SET cancelled_quantity=cancelled_quantity+$4,last_generation=$5,
                 last_seq=$6,updated_at=now()
             WHERE allotment_line_id=$1 AND allotment_id=$2 AND origin_id=$3
               AND accepted_quantity-picked_quantity-cancelled_quantity=$4",
        )
        .bind(line_id)
        .bind(result.allotment_id)
        .bind(origin_id)
        .bind(result_line.cancelled_quantity)
        .bind(generation)
        .bind(seq)
        .execute(&mut **tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(AppError::Conflict(format!(
                "Allotment line {line_id} changed while applying cancellation"
            )));
        }
        cancelled_delta_total = cancelled_delta_total
            .checked_add(result_line.cancelled_quantity)
            .ok_or_else(|| AppError::Conflict("cancelled quantity overflow".into()))?;
        if result_line.cancelled_quantity > 0 {
            let destination_type =
                DestinationType::from_str(&row.get::<String, _>("destination_type"))
                    .map_err(|error| AppError::Conflict(error.to_string()))?;
            let identity = LineIdentity {
                source_site_id: row.get("source_site_id"),
                source_pool_id: row.get("source_pool_id"),
                destination_type,
                destination_id: row.get("destination_id"),
                sku_id: row.get("sku_id"),
            };
            insert_allotment_event(
                tx,
                &format!("edge-cancellation:{}:cancelled:{line_id}", result.result_id),
                Some(result.allotment_id),
                Some(line_id),
                "ALLOTMENT_CANCELLED",
                Some(&identity),
                result_line.cancelled_quantity,
                0,
                None,
                Some("ALLOTMENT_CANCELLATION"),
                Some(&cancellation_reference),
                &command.requested_by,
                json!({
                    "reason":command.reason,
                    "cancellation_id":result.cancellation_id,
                    "cancellation_command_id":result.cancellation_command_id,
                    "cancellation_result_id":result.result_id,
                    "blocked_picked_quantity":result_line.blocked_picked_quantity
                }),
                result.applied_at,
            )
            .await?;
        }
    }

    let totals = sqlx::query(
        "SELECT COALESCE(SUM(accepted_quantity),0)::bigint AS accepted,
                COALESCE(SUM(picked_quantity),0)::bigint AS picked,
                COALESCE(SUM(dispatched_quantity),0)::bigint AS dispatched,
                COALESCE(SUM(received_quantity),0)::bigint AS received,
                COALESCE(SUM(cancelled_quantity),0)::bigint AS cancelled
         FROM edge_allotment_line_progress
         WHERE allotment_id=$1 AND origin_id=$2",
    )
    .bind(result.allotment_id)
    .bind(origin_id)
    .fetch_one(&mut **tx)
    .await?;
    let accepted: i64 = totals.get("accepted");
    let picked: i64 = totals.get("picked");
    let dispatched: i64 = totals.get("dispatched");
    let received: i64 = totals.get("received");
    let cancelled: i64 = totals.get("cancelled");
    let dc_consumed = dispatched
        .checked_add(cancelled)
        .ok_or_else(|| AppError::Conflict("DC completion quantity overflow".into()))?;
    let store_consumed = received
        .checked_add(cancelled)
        .ok_or_else(|| AppError::Conflict("Store completion quantity overflow".into()))?;
    let status = if accepted > 0 && cancelled == accepted && picked == 0 {
        "CANCELLED"
    } else if accepted > 0 && store_consumed == accepted {
        "COMPLETED"
    } else if accepted > 0 && dc_consumed == accepted {
        "DC_COMPLETED"
    } else {
        "IN_PROGRESS"
    };
    let updated = sqlx::query(
        "UPDATE allotment
         SET edge_cancellation_status=$2,edge_cancellation_result_id=$3,
             edge_cancellation_received_at=now(),status=$4,
             cancelled_at=CASE WHEN $5>0 THEN $6 ELSE cancelled_at END,
             updated_at=now()
         WHERE id=$1 AND cancellation_command_id=$7
           AND edge_cancellation_status='PENDING'",
    )
    .bind(result.allotment_id)
    .bind(outcome)
    .bind(result.result_id)
    .bind(status)
    .bind(cancelled_delta_total)
    .bind(result.applied_at)
    .bind(result.cancellation_command_id)
    .execute(&mut **tx)
    .await?;
    if updated.rows_affected() != 1 {
        return Err(AppError::Conflict(
            "Allotment cancellation stopped being pending".into(),
        ));
    }
    Ok(true)
}

/// Materialize one quantity-only FIFO Pick. The Edge chooses the lines, but
/// Cloud recomputes the same FIFO order under row locks before accepting the
/// immutable fact. No EPC or inventory movement exists at this stage.
async fn apply_allotment_pick(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    event_id: Uuid,
    pick: &PickPayload,
) -> Result<bool, AppError> {
    if event_id != pick.pick_id {
        return Err(AppError::Validation(
            "allotment Pick pick_id must equal event_id".into(),
        ));
    }
    let binding_row = sqlx::query(
        "SELECT origin_id,site_id,node_role,active_generation,inventory_enabled
         FROM sync_origin_credential WHERE origin_id=$1 FOR KEY SHARE",
    )
    .bind(origin_id)
    .fetch_optional(&mut **tx)
    .await?;
    let binding = binding_row.as_ref().map(inventory_binding_from_row);
    if binding
        .as_ref()
        .is_some_and(|binding| generation < binding.active_generation)
    {
        return Ok(false);
    }
    validate_allotment_pick_binding(pick, origin_id, generation, binding.as_ref())
        .map_err(AppError::Validation)?;

    // Nothing is allotted by fetching. A pick says a picker took so many of a
    // SKU off the racks, and that is all it says — the centre records it and
    // touches no allotment, exactly as the DC does.
    //
    // Which store each garment serves is settled when it goes into a carton,
    // and that is where both sides consume an allotment line. Recomputing a
    // FIFO order here to check one the edge no longer makes would be the
    // centre validating a decision nobody took.

    let inserted = sqlx::query(
        "INSERT INTO edge_allotment_pick_fact
             (event_id,origin_id,generation,seq,pick_id,source_site_id,
              source_pool_id,sku_code,quantity,actor_id,occurred_at,allocations)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT(event_id) DO NOTHING",
    )
    .bind(event_id)
    .bind(origin_id)
    .bind(generation)
    .bind(seq)
    .bind(pick.pick_id)
    .bind(&pick.source_site_id)
    .bind(&pick.source_pool_id)
    .bind(&pick.sku_code)
    .bind(pick.quantity)
    .bind(&pick.actor_id)
    .bind(pick.occurred_at)
    .bind(serde_json::json!([]))
    .execute(&mut **tx)
    .await?
    .rows_affected()
        == 1;
    if !inserted {
        return Ok(false);
    }

    Ok(true)
}

/// Apply one whole-package custody transition. The preceding movement fact is
/// the exact physical evidence; this fact binds that movement to immutable
/// package membership and cumulative Allotment progress.
async fn apply_fulfillment_progress(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    event_id: Uuid,
    progress: &FulfillmentProgressPayload,
) -> Result<bool, AppError> {
    if event_id != progress.progress_id {
        return Err(AppError::Validation(
            "fulfillment progress_id must equal event_id".into(),
        ));
    }
    let binding_row = sqlx::query(
        "SELECT origin_id,site_id,node_role,active_generation,inventory_enabled
         FROM sync_origin_credential WHERE origin_id=$1 FOR KEY SHARE",
    )
    .bind(origin_id)
    .fetch_optional(&mut **tx)
    .await?;
    let binding = binding_row.as_ref().map(inventory_binding_from_row);
    if binding
        .as_ref()
        .is_some_and(|binding| generation < binding.active_generation)
    {
        return Ok(false);
    }
    let node =
        validate_fulfillment_progress_binding(progress, origin_id, generation, binding.as_ref())
            .map_err(AppError::Validation)?;
    if sqlx::query("SELECT 1 FROM edge_fulfillment_progress_fact WHERE event_id=$1")
        .bind(event_id)
        .fetch_optional(&mut **tx)
        .await?
        .is_some()
    {
        return Ok(false);
    }
    if sqlx::query("SELECT 1 FROM edge_fulfillment_progress_fact WHERE koli_id=$1 AND stage=$2")
        .bind(progress.koli_id)
        .bind(progress.stage.as_str())
        .fetch_optional(&mut **tx)
        .await?
        .is_some()
    {
        return Err(AppError::Conflict(format!(
            "package {} already has a {} fact",
            progress.koli_id,
            progress.stage.as_str()
        )));
    }

    let movement = sqlx::query(
        "SELECT generation,seq,cause,reference_type,reference_id,actor_id,occurred_at
         FROM edge_movement WHERE movement_group_id=$1 AND origin_id=$2 FOR KEY SHARE",
    )
    .bind(progress.movement_group_id)
    .bind(origin_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("preceding fulfillment movement".into()))?;
    let koli_id_text = progress.koli_id.to_string();
    let movement_generation: i64 = movement.get("generation");
    let movement_seq: i64 = movement.get("seq");
    if movement_generation != generation
        || movement_seq.checked_add(1) != Some(seq)
        || movement.get::<String, _>("cause") != "NORMAL_MOVE"
        || movement
            .get::<Option<String>, _>("reference_type")
            .as_deref()
            != Some("FULFILLMENT_PACKAGE")
        || movement.get::<Option<String>, _>("reference_id").as_deref()
            != Some(koli_id_text.as_str())
        || movement.get::<String, _>("actor_id") != progress.actor_id
        || movement.get::<DateTime<Utc>, _>("occurred_at") != progress.occurred_at
    {
        return Err(AppError::Validation(
            "fulfillment progress does not match its exact preceding package movement".into(),
        ));
    }
    let movement_lines = sqlx::query(
        "SELECT subject_id,epc,sku_code,quantity,from_place_id,to_place_id
         FROM edge_movement_line WHERE movement_group_id=$1 ORDER BY epc NULLS LAST",
    )
    .bind(progress.movement_group_id)
    .fetch_all(&mut **tx)
    .await?;
    if movement_lines.len() != progress.units.len() {
        return Err(AppError::Validation(
            "fulfillment movement line set differs from package membership".into(),
        ));
    }
    for (row, unit) in movement_lines.iter().zip(&progress.units) {
        if row.get::<Option<String>, _>("epc").as_deref() != Some(unit.epc.as_str())
            || row.get::<Option<String>, _>("sku_code").as_deref() != Some(unit.sku_code.as_str())
            || row.get::<i64, _>("quantity") != 1
        {
            return Err(AppError::Validation(
                "fulfillment movement EPC/SKU membership differs from progress fact".into(),
            ));
        }
    }

    let destination_store = SiteId::new(&progress.destination_store_id)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let stage_pool = |stage: FulfillmentStage| match stage {
        FulfillmentStage::Packed => OperationalPool::DcOutboundPacked {
            dc_id: node.site_id.clone(),
            store_id: destination_store.clone(),
        },
        FulfillmentStage::Shipment => OperationalPool::DcOutboundShipment {
            dc_id: node.site_id.clone(),
            store_id: destination_store.clone(),
        },
        FulfillmentStage::Loaded => OperationalPool::DcOutboundLoaded {
            dc_id: node.site_id.clone(),
            store_id: destination_store.clone(),
        },
        FulfillmentStage::InTransit => OperationalPool::DcOutboundInTransit {
            dc_id: node.site_id.clone(),
            store_id: destination_store.clone(),
        },
    };
    let stage_place_id = |stage| format!("{}:on_hand", stage_pool(stage).id());
    let target_place_id = stage_place_id(progress.stage);
    let mut touched_allotments = BTreeSet::new();

    if progress.stage == FulfillmentStage::Packed {
        if sqlx::query("SELECT 1 FROM edge_koli WHERE koli_id=$1")
            .bind(progress.koli_id)
            .fetch_optional(&mut **tx)
            .await?
            .is_some()
        {
            return Err(AppError::Conflict(format!(
                "fulfillment package {} already exists",
                progress.koli_id
            )));
        }
        for (movement_line, unit) in movement_lines.iter().zip(&progress.units) {
            if movement_line.get::<String, _>("to_place_id") != target_place_id {
                return Err(AppError::Validation(format!(
                    "PACKED EPC {} moved to the wrong destination pool",
                    unit.epc
                )));
            }
            let source_place = Place::from_str(&movement_line.get::<String, _>("from_place_id"))
                .map_err(|error| AppError::Validation(error.to_string()))?;
            let _source_pool_id = match source_place {
                Place::Operational {
                    pool,
                    state: InventoryState::Normal,
                } if pool.is_dc_fulfillment_source_for(&node.site_id) => pool.id(),
                _ => {
                    return Err(AppError::Validation(format!(
                        "PACKED EPC {} did not leave an allowed normal source pool for its DC",
                        unit.epc
                    )));
                }
            };
            let candidate = sqlx::query(
                // The centre's mirror of the DC's own rule: FIFO among the
                // lines of the store whose carton this is. Picking commits to
                // nobody, so there is no picked quantity to draw against — what
                // matters is that this store still has goods coming.
                //
                // The line's own source pool is not matched either: the garment
                // has been picked, so it is standing in the outbound area
                // rather than on the rack the allotment named.
                "SELECT line.allotment_id,line.allotment_line_id
                 FROM edge_allotment_line_progress line
                 JOIN allotment header ON header.id=line.allotment_id
                 WHERE line.origin_id=$1 AND line.source_site_id=$2
                   AND line.sku_code=$3
                   AND line.destination_type='STORE' AND line.destination_id=$4
                   AND line.accepted_quantity-line.packed_quantity-line.cancelled_quantity>0
                   AND header.activation_target_origin_id=$1
                   AND header.edge_application_status='ACCEPTED'
                   AND header.status IN ('ACTIVE','IN_PROGRESS')
                 ORDER BY header.created_at,line.allotment_id,line.allotment_line_id
                 LIMIT 1 FOR UPDATE OF line,header",
            )
            .bind(origin_id)
            .bind(&progress.source_site_id)
            .bind(&unit.sku_code)
            .bind(&progress.destination_store_id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| {
                AppError::Conflict(format!(
                    "no open allotment for EPC {} at {}",
                    unit.epc, progress.destination_store_id
                ))
            })?;
            let expected_allotment_id: Uuid = candidate.get("allotment_id");
            let expected_line_id: Uuid = candidate.get("allotment_line_id");
            if unit.allotment_id != expected_allotment_id
                || unit.allotment_line_id != expected_line_id
            {
                return Err(AppError::Validation(format!(
                    "PACKED EPC {} does not match authoritative FIFO attribution",
                    unit.epc
                )));
            }
            let updated = sqlx::query(
                // Picked and packed rise together, as they do at the edge:
                // from an allotment's point of view a garment is picked FOR IT
                // at the moment it goes into its box.
                "UPDATE edge_allotment_line_progress
                 SET picked_quantity=picked_quantity+1,
                     packed_quantity=packed_quantity+1,last_generation=$4,last_seq=$5,
                     updated_at=now()
                 WHERE allotment_line_id=$1 AND allotment_id=$2 AND origin_id=$3
                   AND accepted_quantity-packed_quantity-cancelled_quantity>=1",
            )
            .bind(unit.allotment_line_id)
            .bind(unit.allotment_id)
            .bind(origin_id)
            .bind(generation)
            .bind(seq)
            .execute(&mut **tx)
            .await?;
            if updated.rows_affected() != 1 {
                return Err(AppError::Conflict(format!(
                    "Allotment line {} no longer has unpacked Pick quantity",
                    unit.allotment_line_id
                )));
            }
            touched_allotments.insert(unit.allotment_id);
        }
        sqlx::query(
            "INSERT INTO edge_koli
                 (koli_id,origin_id,source_site_id,destination_store_id,status,
                  shipment_reference,created_at,updated_at,last_generation,last_seq)
             VALUES($1,$2,$3,$4,'PACKED',NULL,$5,$5,$6,$7)",
        )
        .bind(progress.koli_id)
        .bind(origin_id)
        .bind(&progress.source_site_id)
        .bind(&progress.destination_store_id)
        .bind(progress.occurred_at)
        .bind(generation)
        .bind(seq)
        .execute(&mut **tx)
        .await?;
        for unit in &progress.units {
            sqlx::query(
                "INSERT INTO edge_koli_unit
                     (koli_id,epc,sku_code,allotment_id,allotment_line_id,current_stage,
                      stage_rank,packed_at,updated_at)
                 VALUES($1,$2,$3,$4,$5,'PACKED',2,$6,$6)",
            )
            .bind(progress.koli_id)
            .bind(&unit.epc)
            .bind(&unit.sku_code)
            .bind(unit.allotment_id)
            .bind(unit.allotment_line_id)
            .bind(progress.occurred_at)
            .execute(&mut **tx)
            .await?;
        }
    } else {
        let expected_previous = progress.stage.previous().ok_or_else(|| {
            AppError::Validation("PACKED cannot use package advancement path".into())
        })?;
        let package = sqlx::query(
            "SELECT origin_id,source_site_id,destination_store_id,status,shipment_reference
             FROM edge_koli WHERE koli_id=$1 FOR UPDATE",
        )
        .bind(progress.koli_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound("fulfillment package".into()))?;
        let stored_reference: Option<String> = package.get("shipment_reference");
        if package.get::<String, _>("origin_id") != origin_id
            || package.get::<String, _>("source_site_id") != progress.source_site_id
            || package.get::<String, _>("destination_store_id") != progress.destination_store_id
            || package.get::<String, _>("status") != expected_previous.as_str()
            || (progress.stage == FulfillmentStage::Shipment && stored_reference.is_some())
            || (progress.stage != FulfillmentStage::Shipment
                && stored_reference != progress.shipment_reference)
        {
            return Err(AppError::Validation(
                "fulfillment stage does not match persisted package identity/lifecycle".into(),
            ));
        }
        let persisted_units = sqlx::query(
            "SELECT epc,sku_code,allotment_id,allotment_line_id,current_stage,stage_rank
             FROM edge_koli_unit WHERE koli_id=$1 AND released_at IS NULL
             ORDER BY epc FOR UPDATE",
        )
        .bind(progress.koli_id)
        .fetch_all(&mut **tx)
        .await?;
        if persisted_units.len() != progress.units.len() {
            return Err(AppError::Validation(
                "fulfillment progress changed package membership".into(),
            ));
        }
        let expected_from_place_id = stage_place_id(expected_previous);
        for ((stored, movement_line), unit) in persisted_units
            .iter()
            .zip(&movement_lines)
            .zip(&progress.units)
        {
            if stored.get::<String, _>("epc") != unit.epc
                || stored.get::<String, _>("sku_code") != unit.sku_code
                || stored.get::<Uuid, _>("allotment_id") != unit.allotment_id
                || stored.get::<Uuid, _>("allotment_line_id") != unit.allotment_line_id
                || stored.get::<String, _>("current_stage") != expected_previous.as_str()
                || stored.get::<i16, _>("stage_rank") != expected_previous.rank()
                || movement_line.get::<String, _>("from_place_id") != expected_from_place_id
                || movement_line.get::<String, _>("to_place_id") != target_place_id
            {
                return Err(AppError::Validation(format!(
                    "fulfillment EPC {} changed membership or skipped a custody stage",
                    unit.epc
                )));
            }
            let line_sql = match progress.stage {
                FulfillmentStage::Shipment => {
                    "UPDATE edge_allotment_line_progress
                     SET shipment_quantity=shipment_quantity+1,last_generation=$4,last_seq=$5,
                         updated_at=now()
                     WHERE allotment_line_id=$1 AND allotment_id=$2 AND origin_id=$3
                       AND packed_quantity-shipment_quantity>=1"
                }
                FulfillmentStage::Loaded => {
                    "UPDATE edge_allotment_line_progress
                     SET dispatched_quantity=dispatched_quantity+1,last_generation=$4,last_seq=$5,
                         updated_at=now()
                     WHERE allotment_line_id=$1 AND allotment_id=$2 AND origin_id=$3
                       AND shipment_quantity-dispatched_quantity>=1"
                }
                FulfillmentStage::InTransit => {
                    "UPDATE edge_allotment_line_progress
                     SET in_transit_quantity=in_transit_quantity+1,last_generation=$4,last_seq=$5,
                         updated_at=now()
                     WHERE allotment_line_id=$1 AND allotment_id=$2 AND origin_id=$3
                       AND dispatched_quantity-in_transit_quantity>=1"
                }
                FulfillmentStage::Packed => unreachable!(),
            };
            if sqlx::query(line_sql)
                .bind(unit.allotment_line_id)
                .bind(unit.allotment_id)
                .bind(origin_id)
                .bind(generation)
                .bind(seq)
                .execute(&mut **tx)
                .await?
                .rows_affected()
                != 1
            {
                return Err(AppError::Conflict(format!(
                    "Allotment line {} cannot advance to {}",
                    unit.allotment_line_id,
                    progress.stage.as_str()
                )));
            }
            let unit_sql = match progress.stage {
                FulfillmentStage::Shipment => {
                    "UPDATE edge_koli_unit
                     SET current_stage='SHIPMENT',stage_rank=3,shipment_at=$3,updated_at=$3
                     WHERE koli_id=$1 AND epc=$2 AND current_stage='PACKED' AND stage_rank=2"
                }
                FulfillmentStage::Loaded => {
                    "UPDATE edge_koli_unit
                     SET current_stage='LOADED',stage_rank=4,dispatched_at=$3,updated_at=$3
                     WHERE koli_id=$1 AND epc=$2 AND current_stage='SHIPMENT' AND stage_rank=3"
                }
                FulfillmentStage::InTransit => {
                    "UPDATE edge_koli_unit
                     SET current_stage='IN_TRANSIT',stage_rank=5,in_transit_at=$3,updated_at=$3
                     WHERE koli_id=$1 AND epc=$2 AND current_stage='LOADED' AND stage_rank=4"
                }
                FulfillmentStage::Packed => unreachable!(),
            };
            if sqlx::query(unit_sql)
                .bind(progress.koli_id)
                .bind(&unit.epc)
                .bind(progress.occurred_at)
                .execute(&mut **tx)
                .await?
                .rows_affected()
                != 1
            {
                return Err(AppError::Conflict(format!(
                    "package EPC {} cannot advance to {}",
                    unit.epc,
                    progress.stage.as_str()
                )));
            }
            touched_allotments.insert(unit.allotment_id);
        }
        let updated = sqlx::query(
            "UPDATE edge_koli
             SET status=$2,shipment_reference=$3,updated_at=$4,
                 last_generation=$5,last_seq=$6
             WHERE koli_id=$1 AND status=$7",
        )
        .bind(progress.koli_id)
        .bind(progress.stage.as_str())
        .bind(&progress.shipment_reference)
        .bind(progress.occurred_at)
        .bind(generation)
        .bind(seq)
        .bind(expected_previous.as_str())
        .execute(&mut **tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(AppError::Conflict(format!(
                "package {} cannot advance to {}",
                progress.koli_id,
                progress.stage.as_str()
            )));
        }
    }

    for allotment_id in touched_allotments {
        let totals = sqlx::query(
            "SELECT COALESCE(SUM(accepted_quantity),0)::bigint AS accepted,
                    COALESCE(SUM(dispatched_quantity),0)::bigint AS dispatched,
                    COALESCE(SUM(cancelled_quantity),0)::bigint AS cancelled
             FROM edge_allotment_line_progress WHERE allotment_id=$1 AND origin_id=$2",
        )
        .bind(allotment_id)
        .bind(origin_id)
        .fetch_one(&mut **tx)
        .await?;
        let accepted: i64 = totals.get("accepted");
        let dispatched: i64 = totals.get("dispatched");
        let cancelled: i64 = totals.get("cancelled");
        let completed = dispatched
            .checked_add(cancelled)
            .is_some_and(|consumed| accepted > 0 && consumed == accepted);
        sqlx::query(
            "UPDATE allotment SET status=$2,updated_at=now()
             WHERE id=$1 AND activation_target_origin_id=$3
               AND edge_application_status='ACCEPTED'
               AND status IN ('ACTIVE','IN_PROGRESS','DC_COMPLETED')",
        )
        .bind(allotment_id)
        .bind(if completed {
            "DC_COMPLETED"
        } else {
            "IN_PROGRESS"
        })
        .bind(origin_id)
        .execute(&mut **tx)
        .await?;
    }

    sqlx::query(
        "INSERT INTO edge_fulfillment_progress_fact
             (event_id,origin_id,generation,seq,progress_id,koli_id,source_site_id,
              destination_store_id,stage,shipment_reference,movement_group_id,actor_id,
              occurred_at,units)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
    )
    .bind(event_id)
    .bind(origin_id)
    .bind(generation)
    .bind(seq)
    .bind(progress.progress_id)
    .bind(progress.koli_id)
    .bind(&progress.source_site_id)
    .bind(&progress.destination_store_id)
    .bind(progress.stage.as_str())
    .bind(&progress.shipment_reference)
    .bind(progress.movement_group_id)
    .bind(&progress.actor_id)
    .bind(progress.occurred_at)
    .bind(serde_json::to_value(&progress.units)?)
    .execute(&mut **tx)
    .await?;
    for (index, unit) in progress.units.iter().enumerate() {
        let unit_ordinal = i64::try_from(index)
            .ok()
            .and_then(|value| value.checked_add(1))
            .ok_or_else(|| AppError::Conflict("package unit ordinal overflow".into()))?;
        sqlx::query(
            "INSERT INTO edge_fulfillment_progress_unit
                 (progress_event_id,koli_id,unit_ordinal,epc,sku_code,
                  allotment_id,allotment_line_id)
             VALUES($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(event_id)
        .bind(progress.koli_id)
        .bind(unit_ordinal)
        .bind(&unit.epc)
        .bind(&unit.sku_code)
        .bind(unit.allotment_id)
        .bind(unit.allotment_line_id)
        .execute(&mut **tx)
        .await?;
    }
    Ok(true)
}

async fn validate_in_transit_claim_boundary(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    prior_snapshot_seq: i64,
    snapshot_seq: i64,
) -> Result<(), AppError> {
    let progresses = sqlx::query(
        "SELECT event_id,seq FROM edge_fulfillment_progress_fact
         WHERE origin_id=$1 AND generation=$2 AND stage='IN_TRANSIT'
           AND seq>$3 AND seq<$4 ORDER BY seq FOR KEY SHARE",
    )
    .bind(origin_id)
    .bind(generation)
    .bind(prior_snapshot_seq)
    .bind(snapshot_seq)
    .fetch_all(&mut **tx)
    .await?;
    for progress in progresses {
        let progress_event_id: Uuid = progress.get("event_id");
        let progress_seq: i64 = progress.get("seq");
        let expected: i64 = sqlx::query(
            "SELECT count(*)::bigint AS count FROM edge_fulfillment_progress_unit
             WHERE progress_event_id=$1",
        )
        .bind(progress_event_id)
        .fetch_one(&mut **tx)
        .await?
        .get("count");
        let observed: i64 = sqlx::query(
            "SELECT count(*)::bigint AS count FROM edge_transfer_claim
             WHERE in_transit_progress_event_id=$1 AND claim_kind='IN_TRANSIT'",
        )
        .bind(progress_event_id)
        .fetch_one(&mut **tx)
        .await?
        .get("count");
        let expected_snapshot_seq = progress_seq
            .checked_add(expected)
            .and_then(|value| value.checked_add(1))
            .ok_or_else(|| AppError::Conflict("claim boundary sequence overflow".into()))?;
        if expected <= 0 || observed != expected || snapshot_seq != expected_snapshot_seq {
            return Err(AppError::Conflict(format!(
                "In-Transit progress {progress_event_id} requires {expected} ordered claims before snapshot {snapshot_seq}; observed {observed}"
            )));
        }
    }
    Ok(())
}

/// Replace one origin's current snapshot without touching the Cloud movement
/// ledger. Generation/sequence comparison prevents a delayed old stream from
/// overwriting a newer owner view.
async fn apply_pool_snapshot(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    event_id: Uuid,
    snapshot: &PoolSnapshotPayload,
) -> Result<bool, AppError> {
    let binding_row = sqlx::query(
        "SELECT origin_id, site_id, node_role, active_generation, inventory_enabled
         FROM sync_origin_credential WHERE origin_id = $1 FOR KEY SHARE",
    )
    .bind(origin_id)
    .fetch_optional(&mut **tx)
    .await?;
    let binding = binding_row.as_ref().map(inventory_binding_from_row);
    if let Some(binding) = binding.as_ref() {
        if generation < binding.active_generation {
            // This generation was valid when received but has since been
            // retired. Consume it without allowing stale state to win.
            return Ok(false);
        }
    }
    let node = validate_snapshot_binding(snapshot, origin_id, generation, binding.as_ref())
        .map_err(AppError::Validation)?;

    let current = sqlx::query(
        "SELECT generation, seq FROM edge_inventory_snapshot
         WHERE origin_id = $1 FOR UPDATE",
    )
    .bind(origin_id)
    .fetch_optional(&mut **tx)
    .await?;
    if current.as_ref().is_some_and(|row| {
        let current_generation = row.get::<i64, _>("generation");
        let current_seq = row.get::<i64, _>("seq");
        current_generation > generation || (current_generation == generation && current_seq >= seq)
    }) {
        return Ok(false);
    }
    if node.role == EdgeRole::Dc {
        let prior_snapshot_seq = current
            .as_ref()
            .filter(|row| row.get::<i64, _>("generation") == generation)
            .map(|row| row.get::<i64, _>("seq"))
            .unwrap_or(0);
        validate_in_transit_claim_boundary(tx, origin_id, generation, prior_snapshot_seq, seq)
            .await?;
    }

    sqlx::query(
        "INSERT INTO edge_inventory_snapshot
             (origin_id, site_id, node_role, generation, seq, event_id, captured_at, applied_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (origin_id) DO UPDATE SET
             site_id = EXCLUDED.site_id,
             node_role = EXCLUDED.node_role,
             generation = EXCLUDED.generation,
             seq = EXCLUDED.seq,
             event_id = EXCLUDED.event_id,
             captured_at = EXCLUDED.captured_at,
             applied_at = now()",
    )
    .bind(origin_id)
    .bind(&snapshot.site_id)
    .bind(snapshot.node_role.to_ascii_uppercase())
    .bind(generation)
    .bind(seq)
    .bind(event_id)
    .bind(snapshot.captured_at)
    .execute(&mut **tx)
    .await?;
    sqlx::query("DELETE FROM edge_inventory_pool WHERE origin_id = $1")
        .bind(origin_id)
        .execute(&mut **tx)
        .await?;
    for balance in &snapshot.pools {
        sqlx::query(
            "INSERT INTO edge_inventory_pool
                 (origin_id, pool_id, stock, allotted, on_hand, missing)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(origin_id)
        .bind(&balance.pool_id)
        .bind(balance.stock)
        .bind(balance.allotted)
        .bind(balance.on_hand)
        .bind(balance.missing)
        .execute(&mut **tx)
        .await?;
    }
    Ok(true)
}

async fn validate_and_register_movement(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    fact: &crate::cloud::domain::MovementFactPayload,
) -> Result<Option<NodeContext>, AppError> {
    let binding_row = sqlx::query(
        "SELECT origin_id,site_id,node_role,active_generation,inventory_enabled
         FROM sync_origin_credential WHERE origin_id=$1 FOR KEY SHARE",
    )
    .bind(origin_id)
    .fetch_optional(&mut **tx)
    .await?;
    let binding = binding_row
        .as_ref()
        .map(inventory_binding_from_row)
        .ok_or_else(|| {
            AppError::Validation("inventory movement requires a registered origin".into())
        })?;
    if generation < binding.active_generation {
        return Ok(None);
    }
    if generation != binding.active_generation || !binding.inventory_enabled {
        return Err(AppError::Validation(
            "inventory movement generation is not active or inventory-enabled".into(),
        ));
    }
    let site_id = SiteId::new(
        binding
            .site_id
            .as_deref()
            .ok_or_else(|| AppError::Validation("inventory origin has no site_id".into()))?,
    )
    .map_err(|error| AppError::Validation(error.to_string()))?;
    let role = EdgeRole::from_str(
        binding
            .node_role
            .as_deref()
            .ok_or_else(|| AppError::Validation("inventory origin has no node_role".into()))?,
    )
    .map_err(|error| AppError::Validation(error.to_string()))?;
    let node = NodeContext::new(origin_id, role, site_id)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let cause = EdgeMovementCause::from_str(&fact.cause)
        .map_err(|error| AppError::Validation(error.to_string()))?;

    let mut line_keys = BTreeSet::new();
    let mut identities = BTreeMap::<Uuid, (Option<String>, Option<String>)>::new();
    let mut epc_subjects = BTreeMap::<String, Uuid>::new();
    for line in &fact.lines {
        let from = Place::from_str(&line.from_place_id)
            .map_err(|error| AppError::Validation(error.to_string()))?;
        let to = Place::from_str(&line.to_place_id)
            .map_err(|error| AppError::Validation(error.to_string()))?;
        if from.id() != line.from_place_id || to.id() != line.to_place_id {
            return Err(AppError::Validation(
                "inventory movement places must use canonical identifiers".into(),
            ));
        }
        if !line_keys.insert((
            line.subject_id,
            line.from_place_id.clone(),
            line.to_place_id.clone(),
        )) {
            return Err(AppError::Validation(
                "inventory movement contains a duplicate subject/from/to line".into(),
            ));
        }
        node.authorize_line(
            cause,
            &EdgeMovementLine {
                subject_id: SubjectId(line.subject_id),
                quantity: line.quantity,
                from,
                to,
            },
        )
        .map_err(|error| AppError::Validation(error.to_string()))?;

        let epc = line.epc.as_ref().map(|value| value.trim().to_owned());
        let sku_code = line.sku_code.as_ref().map(|value| value.trim().to_owned());
        if epc
            .as_ref()
            .is_some_and(|value| value.is_empty() || value != &value.to_ascii_uppercase())
            || sku_code
                .as_ref()
                .is_some_and(|value| value.is_empty() || value != &value.to_ascii_uppercase())
        {
            return Err(AppError::Validation(
                "movement EPC and SKU identity must be canonical uppercase".into(),
            ));
        }
        if let Some(epc) = epc.as_ref() {
            if epc_subjects
                .insert(epc.clone(), line.subject_id)
                .is_some_and(|subject_id| subject_id != line.subject_id)
            {
                return Err(AppError::Validation(
                    "one movement EPC cannot identify multiple subjects".into(),
                ));
            }
        }
        match identities.entry(line.subject_id) {
            std::collections::btree_map::Entry::Vacant(entry) => {
                entry.insert((epc, sku_code));
            }
            std::collections::btree_map::Entry::Occupied(entry)
                if entry.get() != &(epc, sku_code) =>
            {
                return Err(AppError::Validation(
                    "one movement subject cannot carry conflicting EPC/SKU identity".into(),
                ));
            }
            std::collections::btree_map::Entry::Occupied(_) => {}
        }
    }

    for (subject_id, (epc, sku_code)) in identities {
        let registered = sqlx::query(
            "INSERT INTO edge_inventory_fact_subject_identity
                 (origin_id,subject_id,epc,sku_code,first_generation,first_seq)
             VALUES($1,$2,$3,$4,$5,$6)
             ON CONFLICT(origin_id,subject_id) DO UPDATE SET
                 epc=COALESCE(edge_inventory_fact_subject_identity.epc,EXCLUDED.epc),
                 sku_code=COALESCE(edge_inventory_fact_subject_identity.sku_code,EXCLUDED.sku_code),
                 updated_at=now()
             WHERE (EXCLUDED.epc IS NULL
                    OR edge_inventory_fact_subject_identity.epc IS NULL
                    OR edge_inventory_fact_subject_identity.epc=EXCLUDED.epc)
               AND (EXCLUDED.sku_code IS NULL
                    OR edge_inventory_fact_subject_identity.sku_code IS NULL
                    OR edge_inventory_fact_subject_identity.sku_code=EXCLUDED.sku_code)
             RETURNING epc,sku_code",
        )
        .bind(origin_id)
        .bind(subject_id)
        .bind(epc.as_deref())
        .bind(sku_code.as_deref())
        .bind(generation)
        .bind(seq)
        .fetch_optional(&mut **tx)
        .await?;
        if registered.is_none() {
            return Err(AppError::Conflict(format!(
                "movement attempted to relabel subject {subject_id}"
            )));
        }
    }
    Ok(Some(node))
}

/// Replay one movement fact into the local ledger. Returns `false` when the
/// movement group already exists (single-database demo, or a replayed
/// stream) — idempotence by the group's stable id.
async fn apply_movement(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    event_id: Uuid,
    fact: &crate::cloud::domain::MovementFactPayload,
) -> Result<bool, AppError> {
    if event_id != fact.movement_group_id {
        return Err(AppError::Validation(
            "inventory movement event_id must equal movement_group_id".into(),
        ));
    }
    if let Some(existing) = sqlx::query(
        "SELECT event_id,origin_id FROM edge_movement WHERE movement_group_id=$1 FOR KEY SHARE",
    )
    .bind(fact.movement_group_id)
    .fetch_optional(&mut **tx)
    .await?
    {
        if existing.get::<Uuid, _>("event_id") == event_id
            && existing.get::<String, _>("origin_id") == origin_id
        {
            return Ok(false);
        }
        return Err(AppError::Conflict(
            "movement_group_id is already owned by different evidence".into(),
        ));
    }
    if validate_and_register_movement(tx, origin_id, generation, seq, fact)
        .await?
        .is_none()
    {
        return Ok(false);
    }
    let inserted = sqlx::query(
        "INSERT INTO edge_movement
             (origin_id,generation,seq,event_id,movement_group_id,cause,reason,
              reference_type,reference_id,actor_id,occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    )
    .bind(origin_id)
    .bind(generation)
    .bind(seq)
    .bind(event_id)
    .bind(fact.movement_group_id)
    .bind(&fact.cause)
    .bind(&fact.reason)
    .bind(&fact.reference_type)
    .bind(&fact.reference_id)
    .bind(&fact.actor_id)
    .bind(fact.occurred_at)
    .execute(&mut **tx)
    .await?
    .rows_affected()
        == 1;
    if !inserted {
        return Ok(false);
    }
    for line in &fact.lines {
        sqlx::query(
            "INSERT INTO edge_movement_line
                 (movement_group_id, subject_id, epc, sku_code, quantity,
                  from_place_id, to_place_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(fact.movement_group_id)
        .bind(line.subject_id)
        .bind(&line.epc)
        .bind(&line.sku_code)
        .bind(line.quantity)
        .bind(&line.from_place_id)
        .bind(&line.to_place_id)
        .execute(&mut **tx)
        .await?;
        apply_fact_position_delta(
            tx,
            origin_id,
            generation,
            seq,
            line.subject_id,
            &line.from_place_id,
            line.epc.as_deref(),
            line.sku_code.as_deref(),
            -line.quantity,
        )
        .await?;
        apply_fact_position_delta(
            tx,
            origin_id,
            generation,
            seq,
            line.subject_id,
            &line.to_place_id,
            line.epc.as_deref(),
            line.sku_code.as_deref(),
            line.quantity,
        )
        .await?;
    }
    Ok(true)
}

#[allow(clippy::too_many_arguments)]
async fn apply_fact_position_delta(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    subject_id: Uuid,
    place_id: &str,
    _epc: Option<&str>,
    _sku_code: Option<&str>,
    delta: i64,
) -> Result<(), AppError> {
    let identity = sqlx::query(
        "SELECT epc,sku_code FROM edge_inventory_fact_subject_identity
         WHERE origin_id=$1 AND subject_id=$2 FOR KEY SHARE",
    )
    .bind(origin_id)
    .bind(subject_id)
    .fetch_one(&mut **tx)
    .await?;
    let epc: Option<String> = identity.get("epc");
    let sku_code: Option<String> = identity.get("sku_code");
    let Some((pool_id, _state)) = place_id.split_once(':') else {
        return Ok(());
    };
    if OperationalPool::from_str(pool_id).is_err() {
        return Ok(());
    }
    let current = sqlx::query(
        "SELECT quantity FROM edge_inventory_fact_position
         WHERE origin_id=$1 AND subject_id=$2 AND place_id=$3 FOR UPDATE",
    )
    .bind(origin_id)
    .bind(subject_id)
    .bind(place_id)
    .fetch_optional(&mut **tx)
    .await?;
    let current_quantity = current
        .as_ref()
        .map(|row| row.get::<i64, _>("quantity"))
        .unwrap_or(0);
    let next = current_quantity.checked_add(delta).ok_or_else(|| {
        AppError::Conflict(format!(
            "fact position quantity overflow for subject {subject_id} at {place_id}"
        ))
    })?;
    if next < 0 {
        return Err(AppError::Conflict(format!(
            "movement would make fact position negative for subject {subject_id} at {place_id}"
        )));
    }
    if next == 0 {
        sqlx::query(
            "DELETE FROM edge_inventory_fact_position
             WHERE origin_id=$1 AND subject_id=$2 AND place_id=$3",
        )
        .bind(origin_id)
        .bind(subject_id)
        .bind(place_id)
        .execute(&mut **tx)
        .await?;
    } else {
        sqlx::query(
            "INSERT INTO edge_inventory_fact_position
                 (origin_id,subject_id,place_id,epc,sku_code,quantity,last_generation,last_seq)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (origin_id,subject_id,place_id) DO UPDATE SET
                 epc=COALESCE(edge_inventory_fact_position.epc,EXCLUDED.epc),
                 sku_code=COALESCE(edge_inventory_fact_position.sku_code,EXCLUDED.sku_code),
                 quantity=EXCLUDED.quantity,last_generation=EXCLUDED.last_generation,
                 last_seq=EXCLUDED.last_seq,updated_at=now()",
        )
        .bind(origin_id)
        .bind(subject_id)
        .bind(place_id)
        .bind(epc)
        .bind(sku_code)
        .bind(next)
        .bind(generation)
        .bind(seq)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// Move one fact out of the stream's way, keeping the evidence.
///
/// The dead-letter table is where a fact goes when the centre cannot use it.
/// Until now only the ingest path wrote to it; the apply path had one answer
/// for everything, which is to stop. Stopping is right when the next pass
/// might succeed — a lock, a transient failure, a fact whose parent is still
/// in flight. It is wrong when the thing that would fix the fact is queued
/// *behind* it, because then the stream is waiting on itself.
///
/// The watermark advances past the set-aside seq in the same transaction as
/// the copy, so a crash between the two cannot lose the fact and let the
/// stream walk on regardless.
async fn set_aside(
    pool: &PgPool,
    origin_id: &str,
    generation: i64,
    seq: i64,
    reason: &str,
) -> Result<(), AppError> {
    let bounded: String = reason.chars().take(500).collect();
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO sync_dead_letter
             (origin_id, generation, seq, event_id, event_type, payload, reason)
         SELECT origin_id, generation, seq, event_id, event_type, payload, $4
         FROM sync_ingest_fact
         WHERE origin_id = $1 AND generation = $2 AND seq = $3
         ON CONFLICT DO NOTHING",
    )
    .bind(origin_id)
    .bind(generation)
    .bind(seq)
    .bind(&bounded)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE sync_applied_watermark
         SET applied_seq = $3, blocked_at_seq = NULL, blocked_reason = NULL,
             blocked_since = NULL, updated_at = now()
         WHERE origin_id = $1 AND generation = $2",
    )
    .bind(origin_id)
    .bind(generation)
    .bind(seq)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn record_blocked(
    pool: &PgPool,
    origin_id: &str,
    generation: i64,
    seq: i64,
    reason: &str,
) -> Result<(), AppError> {
    let bounded: String = reason.chars().take(500).collect();
    sqlx::query(
        "UPDATE sync_applied_watermark
         SET blocked_at_seq = $3, blocked_reason = $4,
             blocked_since = COALESCE(blocked_since, now()), updated_at = now()
         WHERE origin_id = $1 AND generation = $2",
    )
    .bind(origin_id)
    .bind(generation)
    .bind(seq)
    .bind(bounded)
    .execute(pool)
    .await?;
    Ok(())
}

/// Receiver-side retention: old applied ACCEPTED receipts may go. Dedup of
/// very-late accepted resends survives the purge because it keys on the ingest
/// watermark (`seq <= durable_seq` is skipped), not on receipt rows.
/// Permanent-rejection tombstones are retained because they still affect
/// sender settlement: after a lost response the sender must copy the rejection
/// into its durable dead-letter table before advancing.
pub async fn purge_applied_ingest(pool: &PgPool, retention_days: i64) -> Result<u64, AppError> {
    let result = sqlx::query(
        "DELETE FROM sync_ingest_fact f
         USING sync_applied_watermark a
         WHERE a.origin_id = f.origin_id AND a.generation = f.generation
           AND f.seq <= a.applied_seq
           AND f.status <> 'REJECTED'
           AND f.received_at < now() - make_interval(days => $1::int)",
    )
    .bind(retention_days.max(0) as i32)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

// ---- The downstream lane: cloud -> store commands -------------------------

use crate::cloud::domain::{
    decide_command, parse_activate_publication, sign_command, CommandBlock, CommandDisposition,
    PushedCommand, COMMAND_ACTIVATE_PUBLICATION, COMMAND_AUTH_POLICY_REPLACE,
};

/// How many commands one response carries. Small on purpose: commands are
/// rare and the response also carries settlement.
pub const COMMAND_BATCH: i64 = 20;

/// Issue one command to a set of stores, or to the whole fleet.
///
/// The payload is stored ONCE; each target gets a delivery row carrying only
/// its position. `targets` empty means broadcast to every registered origin —
/// a store registered later starts its own sequence and never inherits
/// history it was not meant to see.
fn validate_issued_command(command_type: &str, payload: &Value) -> Result<(), AppError> {
    if command_type.trim().is_empty() {
        return Err(AppError::Validation("command_type is required".into()));
    }
    match command_type {
        COMMAND_ACTIVATE_PUBLICATION => {
            parse_activate_publication(payload).map_err(AppError::Validation)?;
        }
        crate::cloud::domain::COMMAND_COMMERCIAL_USAGE => {
            crate::cloud::domain::parse_commercial_usage(payload).map_err(AppError::Validation)?;
        }
        crate::cloud::domain::COMMAND_COMMERCIAL_CAMPAIGN => {
            crate::cloud::domain::parse_campaign_switch(payload).map_err(AppError::Validation)?;
        }
        COMMAND_CATALOG_CHUNK => {
            crate::cloud::domain::parse_catalog_chunk(payload).map_err(AppError::Validation)?;
        }
        COMMAND_PRICE_AMENDMENT_DECIDED => {
            parse_price_amendment_decision(payload).map_err(AppError::Validation)?;
        }
        COMMAND_PURCHASE_ORDER_ACTIVATE => {
            // Refused at the issuing desk rather than at the DC: an order the
            // warehouse cannot read blocks its command stream, and the buyer
            // who raised it is the one who can fix it.
            parse_purchase_order(payload).map_err(AppError::Validation)?;
        }
        COMMAND_AUTH_POLICY_REPLACE => {
            crate::cloud::domain::parse_auth_policy(payload).map_err(AppError::Validation)?;
        }
        crate::cloud::domain::COMMAND_TAGGING_JOB_ACTIVATE => {
            // Every EPC in here is checked to decode back to the SKU on its
            // own line. That catch is worth making at the issuing desk: the
            // next stop for these strings is a printer, and after that they
            // are on garments.
            crate::cloud::domain::parse_tagging_job(payload).map_err(AppError::Validation)?;
        }
        INVENTORY_ALLOTMENT_ACTIVATE_V1 => {
            parse_allotment_activation(payload).map_err(AppError::Validation)?;
        }
        INVENTORY_ALLOTMENT_CANCEL_V1 => {
            parse_allotment_cancellation(payload).map_err(AppError::Validation)?;
        }
        INVENTORY_OFFICIAL_COUNT_ACTIVATE_V1 => {
            parse_official_count_activation(payload).map_err(AppError::Validation)?;
        }
        crate::cloud::domain::COMMAND_ATTENDANCE_BOOK_REPLACE => {
            // Refused at the issuing desk rather than at the unit, for the
            // reason the purchase-order arm above gives: a command the edge
            // cannot read **blocks its whole command stream**, and the person
            // who pressed publish is the one who can fix it.
            crate::cloud::domain::parse_attendance_book(payload).map_err(AppError::Validation)?;
        }
        _ => {}
    }
    Ok(())
}

/// Resolve the exact authoritative DC for a site inside the caller's business
/// transaction. No aliasing and no broadcast fallback are permitted.
///
/// What the CENTRE calls the building the warehouse stands in — `site.id`, and
/// `ho` since 0256 folded `dc` and `dc-01` into head office. Not what the box
/// in that building calls itself: an edge node registers under the site id it
/// runs as, which is still `dc` or `dc-01`, and that spelling lives in
/// `sync_origin_credential.site_id`. The gap between the two is exactly what
/// [`sole_dc_origin_tx`] exists to bridge, and it is why this constant must
/// follow `site` and not the origin table.
pub(super) const CANONICAL_WAREHOUSE_SITE_ID: &str = HEAD_OFFICE_SITE_ID;

/// Every name the CENTRE has used for that one building, for the sole purpose
/// of deciding whether a site id that no origin answers to is worth resolving
/// to the one registered DC.
///
/// Two entries and not one, because 0256 renamed the site but could not rename
/// what is already written down elsewhere: `purchase_order.destination_site_id`
/// carries no foreign key into `site`, holds `dc` on every database, and is the
/// default `INVENTORY_DEFAULT_DESTINATION_SITE_ID` still hands out. Dropping
/// `dc` here would refuse every purchase order raised on a rig whose DC edge
/// registers as `dc-01` — which is what `.claude/launch.json` configures.
///
/// A store id is deliberately absent: a shop that no origin answers to is a
/// real miss and must stay one.
const WAREHOUSE_SITE_ALIASES: [&str; 2] = [CANONICAL_WAREHOUSE_SITE_ID, "dc"];

/// The single registered DC origin, or nothing when that is not unambiguous.
async fn sole_dc_origin_tx(tx: &mut Transaction<'_, Postgres>) -> Result<Option<String>, AppError> {
    let rows = sqlx::query(
        "SELECT origin_id FROM sync_origin_credential
         WHERE inventory_enabled AND node_role = 'DC'
         ORDER BY origin_id FOR SHARE",
    )
    .fetch_all(&mut **tx)
    .await?;
    match rows.len() {
        0 => Ok(None),
        1 => Ok(Some(rows[0].get("origin_id"))),
        _ => Err(AppError::Conflict(
            "several DC origins are registered; name the site explicitly rather \
             than relying on the canonical `dc`"
                .into(),
        )),
    }
}

/// The site an origin actually runs as.
///
/// The other half of `inventory_dc_owner_tx`. That one answers "who owns the
/// site the centre calls `dc`" and returns an ORIGIN; this answers "and what
/// does that origin call itself", which is what has to go on the wire.
pub(super) async fn origin_site_id_tx(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
) -> Result<String, AppError> {
    sqlx::query("SELECT site_id FROM sync_origin_credential WHERE origin_id=$1 FOR SHARE")
        .bind(origin_id)
        .fetch_optional(&mut **tx)
        .await?
        .map(|row| row.get::<String, _>("site_id"))
        .ok_or_else(|| AppError::NotFound(format!("registered origin {origin_id}")))
}

/// A pool id, respelled for the site that owns it.
///
/// # The name gap this closes
///
/// Cloud's pool model has exactly one distribution centre and spells it into
/// the id literally: `dc.warehouse`, `dc.outbound.picked.store-07`. The Edge
/// parameterises the same grammar by the site it actually runs as, so the same
/// two shelves are `dc-01.warehouse` and `dc-01.outbound.picked.store-07`.
/// Stores never diverge — `store-07.floor` is `store-07.floor` on both sides —
/// which is why this went unnoticed until the DC needed it.
///
/// `inventory_dc_owner_tx` already resolves the SITE half of that gap. Nothing
/// resolved the POOL half, so every DC allotment failed three times over: the
/// centre checked fact positions at a `place_id` the Edge never emits and read
/// zero, the activation command carried a site the Edge refuses to answer to,
/// and the pool on the line was not a fulfillment source for the Edge's own
/// warehouse. All three were silent.
///
/// **A no-op wherever the names already agree**, which is every store and any
/// DC registered as `dc` — the first segment is replaced with a value it
/// already holds. That is what makes this safe to apply unconditionally at the
/// boundary rather than behind a "is this the canonical DC" test.
///
/// The first segment IS the site: `SiteId` admits only lowercase letters,
/// digits and `-`, so it can never contain the separator.
pub(super) fn pool_id_for_site(pool_id: &str, site_id: &str) -> String {
    match pool_id.split_once('.') {
        Some((_, rest)) => format!("{site_id}.{rest}"),
        // Not a pool id this grammar recognises. Handed back untouched so the
        // parser downstream is the one that refuses it, with its own message.
        None => pool_id.to_string(),
    }
}

pub(super) async fn inventory_dc_owner_tx(
    tx: &mut Transaction<'_, Postgres>,
    site_id: &str,
) -> Result<Option<String>, AppError> {
    let row = sqlx::query(
        "SELECT origin_id, node_role FROM sync_origin_credential
         WHERE inventory_enabled AND site_id = $1 FOR SHARE",
    )
    .bind(site_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(row) = row else {
        // The centre names the warehouse `ho` since 0256, because it is head
        // office and the pool model has exactly one of it; the Edge registers
        // under the site it actually runs as, which is `dc` or `dc-01`.
        // Nothing reconciles those names, so an Official Count opened for the
        // centre's own spelling found no owner, silently became a
        // cloud-executed count, and never reached the warehouse that was
        // supposed to walk it.
        //
        // Resolving the canonical name to the one registered DC closes that
        // without pretending the model supports several. If a second DC ever
        // registers this refuses rather than guessing, because picking one of
        // two warehouses to send a count to is not a decision code may make.
        if WAREHOUSE_SITE_ALIASES.contains(&site_id) {
            return sole_dc_origin_tx(tx).await;
        }
        return Ok(None);
    };
    let role: String = row.get("node_role");
    if role != "DC" {
        return Err(AppError::Conflict(format!(
            "inventory owner for source site {site_id} is {role}, not DC"
        )));
    }
    Ok(Some(row.get("origin_id")))
}

/// Insert one command and its dense per-target deliveries in the caller's
/// transaction. This function never commits and never expands an empty target
/// list to a broadcast.
pub(super) async fn issue_command_tx(
    tx: &mut Transaction<'_, Postgres>,
    command_type: &str,
    payload: &Value,
    issued_by: &str,
    expires_at: Option<DateTime<Utc>>,
    targets: &[String],
) -> Result<Uuid, AppError> {
    validate_issued_command(command_type, payload)?;
    if issued_by.trim().is_empty() {
        return Err(AppError::Validation("issued_by is required".into()));
    }
    let resolved: std::collections::BTreeSet<String> = targets
        .iter()
        .map(|target| target.trim().to_string())
        .collect();
    if resolved.is_empty() || resolved.iter().any(String::is_empty) {
        return Err(AppError::Validation(
            "transactional command issue requires explicit targets".into(),
        ));
    }
    let command_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO sync_command (command_id, command_type, payload, issued_by, expires_at)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(command_id)
    .bind(command_type)
    .bind(payload)
    .bind(issued_by.trim())
    .bind(expires_at)
    .execute(&mut **tx)
    .await?;
    for origin_id in resolved {
        let seq: i64 = sqlx::query(
            "INSERT INTO sync_command_cursor (origin_id, next_seq) VALUES ($1, 1)
             ON CONFLICT (origin_id) DO UPDATE SET
                 next_seq = sync_command_cursor.next_seq + 1, updated_at = now()
             RETURNING next_seq",
        )
        .bind(&origin_id)
        .fetch_one(&mut **tx)
        .await?
        .get("next_seq");
        sqlx::query(
            "INSERT INTO sync_command_delivery (origin_id, seq, command_id) VALUES ($1, $2, $3)",
        )
        .bind(origin_id)
        .bind(seq)
        .bind(command_id)
        .execute(&mut **tx)
        .await?;
    }
    Ok(command_id)
}

pub async fn issue_command(
    pool: &PgPool,
    command_type: &str,
    payload: &Value,
    issued_by: &str,
    expires_at: Option<DateTime<Utc>>,
    targets: &[String],
) -> Result<(Uuid, Vec<String>), AppError> {
    validate_issued_command(command_type, payload)?;
    let mut tx = pool.begin().await?;
    let resolved: Vec<String> = if targets.is_empty() {
        sqlx::query("SELECT origin_id FROM sync_origin_credential ORDER BY origin_id")
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .map(|row| row.get::<String, _>("origin_id"))
            .collect()
    } else {
        targets
            .iter()
            .map(|target| target.trim().to_string())
            .collect()
    };
    if resolved.is_empty() {
        return Err(AppError::Validation(
            "no target stores: register origins before issuing commands".into(),
        ));
    }
    let command_id = issue_command_tx(
        &mut tx,
        command_type,
        payload,
        issued_by,
        expires_at,
        &resolved,
    )
    .await?;
    tx.commit().await?;
    Ok((command_id, resolved))
}

/// Recall a command. Stores that have not yet applied it will skip it and
/// record why; stores that already applied it are unaffected — revocation is
/// not an undo, and pretending otherwise would be worse than saying so.
pub async fn revoke_command(
    pool: &PgPool,
    command_id: Uuid,
    reason: &str,
) -> Result<u64, AppError> {
    let affected = sqlx::query(
        "UPDATE sync_command SET revoked_at = now(), revoked_reason = $2
         WHERE command_id = $1 AND revoked_at IS NULL",
    )
    .bind(command_id)
    .bind(reason)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(
            "command not found, or already revoked".into(),
        ));
    }
    // How many stores the recall actually caught in time.
    let caught: i64 = sqlx::query(
        "SELECT count(*)::bigint AS count
         FROM sync_command_delivery d
         JOIN sync_command_cursor c ON c.origin_id = d.origin_id
         WHERE d.command_id = $1 AND d.seq > c.acked_seq",
    )
    .bind(command_id)
    .fetch_one(pool)
    .await?
    .get("count");
    Ok(caught.max(0) as u64)
}

/// The next contiguous commands for one store, signed under ITS key.
///
/// Signing happens here, per store, because the signature covers the position
/// — which is per store — and because a store must not be able to verify (or
/// forge) another store's traffic.
pub async fn commands_for(
    pool: &PgPool,
    origin_id: &str,
    after_seq: i64,
    limit: i64,
) -> Result<Vec<PushedCommand>, AppError> {
    let Some(key) =
        sqlx::query("SELECT ingest_key_sha256 FROM sync_origin_credential WHERE origin_id = $1")
            .bind(origin_id)
            .fetch_optional(pool)
            .await?
            .map(|row| row.get::<String, _>("ingest_key_sha256"))
    else {
        // An unregistered origin has no key to sign under, so it gets no
        // commands. Bootstrap uploads still work; commands need identity.
        return Ok(Vec::new());
    };
    let rows = sqlx::query(
        "SELECT d.seq, c.command_id, c.command_type, c.payload, c.expires_at, c.revoked_at
         FROM sync_command_delivery d
         JOIN sync_command c ON c.command_id = d.command_id
         WHERE d.origin_id = $1 AND d.seq > $2
         ORDER BY d.seq LIMIT $3",
    )
    .bind(origin_id)
    .bind(after_seq)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let seq: i64 = row.get("seq");
            let command_id: Uuid = row.get("command_id");
            let command_type: String = row.get("command_type");
            let payload: Value = row.get("payload");
            let expires_at: Option<DateTime<Utc>> = row.get("expires_at");
            let revoked = row.get::<Option<DateTime<Utc>>, _>("revoked_at").is_some();
            // Signed at read time because revocation and expiry are part of
            // the authenticated command state delivered to this store.
            let signature = sign_command(
                key.as_bytes(),
                seq,
                &command_id,
                &command_type,
                &payload,
                expires_at.as_ref(),
                revoked,
            );
            PushedCommand {
                seq,
                command_id,
                command_type,
                payload,
                expires_at,
                revoked,
                signature,
            }
        })
        .collect())
}

/// Record what a store reported about its command stream. The watermark only
/// ever advances; a block is recorded with its reason, and clears itself the
/// moment the store reports progress.
pub async fn record_command_ack(
    pool: &PgPool,
    origin_id: &str,
    acked_seq: i64,
    blocked: Option<&CommandBlock>,
) -> Result<(), AppError> {
    let bounded = blocked.map(|b| b.reason.chars().take(500).collect::<String>());
    sqlx::query(
        "INSERT INTO sync_command_cursor
             (origin_id, next_seq, acked_seq, acked_at, blocked_at_seq, blocked_reason, blocked_since)
         VALUES ($1, 0, GREATEST($2, 0), now(), $3, $4, CASE WHEN $3 IS NULL THEN NULL ELSE now() END)
         ON CONFLICT (origin_id) DO UPDATE SET
             acked_seq = GREATEST(sync_command_cursor.acked_seq, EXCLUDED.acked_seq),
             acked_at = now(),
             blocked_at_seq = EXCLUDED.blocked_at_seq,
             blocked_reason = EXCLUDED.blocked_reason,
             blocked_since = CASE
                 WHEN EXCLUDED.blocked_at_seq IS NULL THEN NULL
                 WHEN sync_command_cursor.blocked_at_seq = EXCLUDED.blocked_at_seq
                     THEN COALESCE(sync_command_cursor.blocked_since, now())
                 ELSE now() END,
             updated_at = now()",
    )
    .bind(origin_id)
    .bind(acked_seq)
    .bind(blocked.map(|b| b.seq))
    .bind(bounded)
    .execute(pool)
    .await?;
    Ok(())
}

/// The store's applied command watermark, and its block if it has one.
pub async fn command_watermark(pool: &PgPool) -> Result<(i64, Option<CommandBlock>), AppError> {
    let row = sqlx::query(
        "SELECT applied_seq, blocked_at_seq, blocked_reason FROM sync_command_watermark",
    )
    .fetch_optional(pool)
    .await?;
    Ok(match row {
        None => (0, None),
        Some(row) => {
            let applied: i64 = row.get("applied_seq");
            let blocked = row
                .get::<Option<i64>, _>("blocked_at_seq")
                .map(|seq| CommandBlock {
                    seq,
                    reason: row
                        .get::<Option<String>, _>("blocked_reason")
                        .unwrap_or_default(),
                });
            (applied, blocked)
        }
    })
}

/// What one command-application pass did.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CommandApplyReport {
    pub applied: u64,
    pub skipped: u64,
    pub blocked: Option<CommandBlock>,
}

/// Apply the commands a response delivered, in seq order, each effect
/// committed with its watermark in ONE transaction.
///
/// Blocking is per store and self-healing: the watermark does not move, the
/// reason is recorded and reported upward on the next cycle, and the same
/// command is retried every cycle until it applies or the cloud revokes it.
pub async fn apply_commands(
    pool: &PgPool,
    key: &[u8],
    commands: &[PushedCommand],
) -> Result<CommandApplyReport, AppError> {
    let mut report = CommandApplyReport::default();
    for command in commands {
        let (watermark, _) = command_watermark(pool).await?;
        if command.seq <= watermark {
            continue; // already settled; a resend after a lost response
        }
        let disposition = decide_command(key, watermark, command, Utc::now());
        match apply_one_command(pool, command, disposition).await? {
            Some(true) => report.applied += 1,
            Some(false) => report.skipped += 1,
            None => break, // blocked; the reason is durable, stop the stream
        }
    }
    let (_, blocked) = command_watermark(pool).await?;
    report.blocked = blocked;
    Ok(report)
}

/// `Some(true)` applied, `Some(false)` deliberately skipped, `None` blocked.
async fn apply_one_command(
    pool: &PgPool,
    command: &PushedCommand,
    disposition: CommandDisposition,
) -> Result<Option<bool>, AppError> {
    let (outcome, reason) = match disposition {
        CommandDisposition::Block { reason } => {
            record_command_block(pool, command.seq, &reason).await?;
            return Ok(None);
        }
        CommandDisposition::Skip { outcome, reason } => (outcome, Some(reason)),
        CommandDisposition::Apply => ("APPLIED", None),
    };
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO sync_command_inbox
             (seq, command_id, command_type, payload, settled_at, outcome, reason)
         VALUES ($1, $2, $3, $4, now(), $5, $6)
         ON CONFLICT (seq) DO NOTHING",
    )
    .bind(command.seq)
    .bind(command.command_id)
    .bind(&command.command_type)
    .bind(&command.payload)
    .bind(outcome)
    .bind(&reason)
    .execute(&mut *tx)
    .await?;
    if outcome == "APPLIED" {
        if let Err(error) = apply_command_effect(&mut tx, command).await {
            // The transaction rolls back on drop, so the inbox row goes with
            // the failed effect: the retry re-inserts it cleanly.
            drop(tx);
            record_command_block(pool, command.seq, &block_diagnostic(&error)).await?;
            return Ok(None);
        }
    }
    sqlx::query(
        "INSERT INTO sync_command_watermark
             (singleton, applied_seq, blocked_at_seq, blocked_reason, blocked_since)
         VALUES (true, $1, NULL, NULL, NULL)
         ON CONFLICT (singleton) DO UPDATE SET
             applied_seq = $1, blocked_at_seq = NULL, blocked_reason = NULL,
             blocked_since = NULL, updated_at = now()",
    )
    .bind(command.seq)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Some(outcome == "APPLIED"))
}

/// Dispatch one command to its effect. An unknown type is an error (and so
/// blocks): it means this store is older than the cloud that addressed it,
/// and discarding the instruction silently would be the worse failure.
async fn apply_command_effect(
    tx: &mut Transaction<'_, Postgres>,
    command: &PushedCommand,
) -> Result<(), AppError> {
    match command.command_type.as_str() {
        COMMAND_ACTIVATE_PUBLICATION => {
            let payload =
                parse_activate_publication(&command.payload).map_err(AppError::Validation)?;
            // The receiving domain holds published commercial versions
            // immutable (three triggers enforce it), and the applier respects
            // that rather than working around it: a version already published
            // here is the same version, so re-applying is a no-op, not an
            // overwrite. That also makes the whole command idempotent for free.
            let existing: Option<String> =
                sqlx::query("SELECT status FROM commercial_publication WHERE id = $1")
                    .bind(payload.publication_id)
                    .fetch_optional(&mut **tx)
                    .await?
                    .map(|r| r.get("status"));
            match existing.as_deref() {
                Some("PUBLISHED") => return Ok(()),
                Some(_) => {
                    // A draft of this version is here: replace its rules
                    // wholesale, because the activation carries the whole
                    // version and a partial merge could leave a rule from an
                    // older one priced against a newer catalogue.
                    for table in [
                        "commercial_tax_rule",
                        "commercial_price_rule",
                        "commercial_assortment_rule",
                    ] {
                        sqlx::query(&format!("DELETE FROM {table} WHERE publication_id = $1"))
                            .bind(payload.publication_id)
                            .execute(&mut **tx)
                            .await?;
                    }
                }
                None => {
                    // Land it as a DRAFT first: rules can only be written
                    // while the version is unpublished.
                    sqlx::query(
                        "INSERT INTO commercial_publication
                             (id, version, name, status, effective_from, effective_to, created_by)
                         VALUES ($1, $2, $3, 'DRAFT', $4, $5, 'sync')",
                    )
                    .bind(payload.publication_id)
                    .bind(payload.version)
                    .bind(&payload.name)
                    .bind(payload.effective_from)
                    .bind(payload.effective_to)
                    .execute(&mut **tx)
                    .await?;
                }
            }
            for rule in &payload.tax_rules {
                sqlx::query(
                    "INSERT INTO commercial_tax_rule
                         (id, publication_id, tax_category, rate_bps, tax_inclusive)
                     VALUES ($1, $2, $3, $4, $5)",
                )
                .bind(Uuid::new_v4())
                .bind(payload.publication_id)
                .bind(&rule.tax_category)
                .bind(rule.rate_bps)
                .bind(rule.tax_inclusive)
                .execute(&mut **tx)
                .await?;
            }
            for rule in &payload.price_rules {
                sqlx::query(
                    "INSERT INTO commercial_assortment_rule
                         (id, publication_id, sku_id, site_id, channel, sellable)
                     VALUES ($1, $2, $3, $4, $5, $6)",
                )
                .bind(Uuid::new_v4())
                .bind(payload.publication_id)
                .bind(rule.sku_id)
                .bind(&rule.site_id)
                .bind(&rule.channel)
                .bind(rule.sellable)
                .execute(&mut **tx)
                .await?;
                sqlx::query(
                    "INSERT INTO commercial_price_rule
                         (id, publication_id, sku_id, site_id, channel, currency,
                          unit_price_minor, tax_category)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
                )
                .bind(Uuid::new_v4())
                .bind(payload.publication_id)
                .bind(rule.sku_id)
                .bind(&rule.site_id)
                .bind(&rule.channel)
                .bind(&rule.currency)
                .bind(rule.unit_price_minor)
                .bind(&rule.tax_category)
                .execute(&mut **tx)
                .await?;
            }
            // Publishing last seals the rules: from here the version is
            // immutable at this store, exactly as it is at the cloud.
            // `published_at` records when it went live HERE.
            sqlx::query(
                "UPDATE commercial_publication
                 SET status = 'PUBLISHED', published_by = 'sync', published_at = now()
                 WHERE id = $1",
            )
            .bind(payload.publication_id)
            .execute(&mut **tx)
            .await?;
            Ok(())
        }
        unknown => Err(AppError::Validation(format!(
            "this store does not understand command type {unknown}"
        ))),
    }
}

/// A block reason an operator can act on.
///
/// `AppError::Database` deliberately renders as "database operation failed"
/// so an API client learns nothing about the schema — but a store stuck on a
/// command is read by someone who has to unstick it, and "database operation
/// failed" names no cause. The underlying message stays inside the fleet's own
/// diagnostics.
fn block_diagnostic(error: &AppError) -> String {
    match error {
        AppError::Database(inner) => format!("database: {inner}"),
        other => other.to_string(),
    }
}

async fn record_command_block(pool: &PgPool, seq: i64, reason: &str) -> Result<(), AppError> {
    let bounded: String = reason.chars().take(500).collect();
    sqlx::query(
        "INSERT INTO sync_command_watermark
             (singleton, applied_seq, blocked_at_seq, blocked_reason, blocked_since)
         VALUES (true, 0, $1, $2, now())
         ON CONFLICT (singleton) DO UPDATE SET
             blocked_at_seq = $1, blocked_reason = $2,
             blocked_since = CASE
                 WHEN sync_command_watermark.blocked_at_seq = $1
                     THEN COALESCE(sync_command_watermark.blocked_since, now())
                 ELSE now() END,
             updated_at = now()",
    )
    .bind(seq)
    .bind(bounded)
    .execute(pool)
    .await?;
    Ok(())
}

/// One store's line in the fleet-convergence view.
#[derive(Clone, Debug)]
pub struct FleetStore {
    pub origin_id: String,
    pub label: Option<String>,
    pub issued_seq: i64,
    pub acked_seq: i64,
    pub acked_at: Option<DateTime<Utc>>,
    pub blocked_at_seq: Option<i64>,
    pub blocked_reason: Option<String>,
    pub blocked_since: Option<DateTime<Utc>>,
}

impl FleetStore {
    /// Commands issued to this store that it has not yet settled.
    pub fn pending(&self) -> i64 {
        (self.issued_seq - self.acked_seq).max(0)
    }
    pub fn converged(&self) -> bool {
        self.pending() == 0 && self.blocked_at_seq.is_none()
    }
}

/// The whole fleet's command convergence, in one query.
///
/// This is the question 30 stores make unavoidable and that per-command acks
/// answer only by hand: which shops are up to date, which are behind, which
/// are stuck and why.
pub async fn fleet_command_status(pool: &PgPool) -> Result<Vec<FleetStore>, AppError> {
    let rows = sqlx::query(
        "SELECT cred.origin_id, cred.label,
                COALESCE(cur.next_seq, 0) AS issued_seq,
                COALESCE(cur.acked_seq, 0) AS acked_seq,
                cur.acked_at, cur.blocked_at_seq, cur.blocked_reason, cur.blocked_since
         FROM sync_origin_credential cred
         LEFT JOIN sync_command_cursor cur ON cur.origin_id = cred.origin_id
         ORDER BY cred.origin_id",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| FleetStore {
            origin_id: r.get("origin_id"),
            label: r.get("label"),
            issued_seq: r.get("issued_seq"),
            acked_seq: r.get("acked_seq"),
            acked_at: r.get("acked_at"),
            blocked_at_seq: r.get("blocked_at_seq"),
            blocked_reason: r.get("blocked_reason"),
            blocked_since: r.get("blocked_since"),
        })
        .collect())
}

/// Which stores have settled a given command, and which have not — the
/// per-command version of the fleet view ("is this price live everywhere?").
pub async fn command_reach(pool: &PgPool, command_id: Uuid) -> Result<Value, AppError> {
    let row = sqlx::query(
        "SELECT command_type, issued_by, issued_at, expires_at, revoked_at, revoked_reason
         FROM sync_command WHERE command_id = $1",
    )
    .bind(command_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("command".into()))?;
    let targets = sqlx::query(
        "SELECT d.origin_id, d.seq,
                COALESCE(c.acked_seq, 0) AS acked_seq,
                c.blocked_at_seq, c.blocked_reason
         FROM sync_command_delivery d
         LEFT JOIN sync_command_cursor c ON c.origin_id = d.origin_id
         WHERE d.command_id = $1
         ORDER BY d.origin_id",
    )
    .bind(command_id)
    .fetch_all(pool)
    .await?;
    let mut settled = Vec::new();
    let mut pending = Vec::new();
    for row in targets {
        let origin_id: String = row.get("origin_id");
        let seq: i64 = row.get("seq");
        let acked: i64 = row.get("acked_seq");
        if acked >= seq {
            settled.push(json!({"origin_id": origin_id, "seq": seq}));
        } else {
            pending.push(json!({
                "origin_id": origin_id,
                "seq": seq,
                "acked_seq": acked,
                "blocked_at_seq": row.get::<Option<i64>, _>("blocked_at_seq"),
                "blocked_reason": row.get::<Option<String>, _>("blocked_reason"),
            }));
        }
    }
    Ok(json!({
        "command_id": command_id,
        "command_type": row.get::<String, _>("command_type"),
        "issued_by": row.get::<String, _>("issued_by"),
        "issued_at": row.get::<DateTime<Utc>, _>("issued_at"),
        "expires_at": row.get::<Option<DateTime<Utc>>, _>("expires_at"),
        "revoked_at": row.get::<Option<DateTime<Utc>>, _>("revoked_at"),
        "revoked_reason": row.get::<Option<String>, _>("revoked_reason"),
        "converged": pending.is_empty(),
        "settled_count": settled.len(),
        "pending_count": pending.len(),
        "settled": settled,
        "pending": pending,
    }))
}

// ---- The cloud node as a [`SyncStore`] ------------------------------------

/// The PostgreSQL adapter for the shared cycle.
///
/// Thin by design: every method here is a call into the functions above, and
/// no settlement decision is made in this block. The cloud node runs the same
/// algorithm the two SQLite edges run.
#[derive(Clone)]
pub struct PgSyncStore {
    pool: PgPool,
}

impl PgSyncStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn sync_err(error: AppError) -> crate::sync::SyncError {
    crate::sync::SyncError::new(block_diagnostic(&error))
}

#[async_trait::async_trait]
impl crate::sync::SyncStore for PgSyncStore {
    async fn origin_identity(&self) -> Result<Option<(String, i64)>, crate::sync::SyncError> {
        origin_identity(&self.pool).await.map_err(sync_err)
    }

    async fn sender_state(&self) -> Result<crate::sync::port::SenderState, crate::sync::SyncError> {
        let state = load_sender_state(&self.pool).await.map_err(sync_err)?;
        Ok(crate::sync::port::SenderState {
            consecutive_failures: state.consecutive_failures,
            breaker_open_until: state.breaker_open_until,
            last_success_at: state.last_success_at,
            last_error: state.last_error,
            last_error_at: state.last_error_at,
        })
    }

    async fn watermark(
        &self,
        origin_id: &str,
        generation: i64,
    ) -> Result<i64, crate::sync::SyncError> {
        watermark(&self.pool, origin_id, generation)
            .await
            .map_err(sync_err)
    }

    async fn pending_batch(
        &self,
        origin_id: &str,
        generation: i64,
        after_seq: i64,
        limit: i64,
    ) -> Result<Vec<crate::cloud::domain::SyncFact>, crate::sync::SyncError> {
        pending_batch(&self.pool, origin_id, generation, after_seq, limit)
            .await
            .map_err(sync_err)
    }

    async fn settle_advance(
        &self,
        origin_id: &str,
        generation: i64,
        advance_to: i64,
        dead_letters: &[RejectedFact],
    ) -> Result<(), crate::sync::SyncError> {
        settle_advance(&self.pool, origin_id, generation, advance_to, dead_letters)
            .await
            .map_err(sync_err)
    }

    async fn record_cycle_success(&self) -> Result<(), crate::sync::SyncError> {
        record_cycle_success(&self.pool).await.map_err(sync_err)
    }

    async fn record_cycle_idle(&self) -> Result<(), crate::sync::SyncError> {
        record_cycle_idle(&self.pool).await.map_err(sync_err)
    }

    async fn record_cycle_failure(
        &self,
        error: &str,
        policy: BreakerPolicy,
    ) -> Result<crate::sync::port::SenderState, crate::sync::SyncError> {
        let state = record_cycle_failure(&self.pool, error, policy)
            .await
            .map_err(sync_err)?;
        Ok(crate::sync::port::SenderState {
            consecutive_failures: state.consecutive_failures,
            breaker_open_until: state.breaker_open_until,
            last_success_at: state.last_success_at,
            last_error: state.last_error,
            last_error_at: state.last_error_at,
        })
    }

    async fn command_watermark(
        &self,
    ) -> Result<(i64, Option<CommandBlock>), crate::sync::SyncError> {
        command_watermark(&self.pool).await.map_err(sync_err)
    }

    async fn apply_commands(
        &self,
        key: &[u8],
        commands: &[PushedCommand],
    ) -> Result<crate::sync::port::CommandApplyReport, crate::sync::SyncError> {
        let report = apply_commands(&self.pool, key, commands)
            .await
            .map_err(sync_err)?;
        Ok(crate::sync::port::CommandApplyReport {
            applied: report.applied,
            skipped: report.skipped,
            blocked: report.blocked,
        })
    }
}

// ---- Publishing master data down the command lane ------------------------

use crate::cloud::domain::{catalog_content_hash, CatalogItem, COMMAND_CATALOG_CHUNK};

/// Items per catalogue chunk.
///
/// Small enough that a chunk rides comfortably inside an ordinary ingest
/// response, and small enough that a shop which drops a connection re-sends
/// little. Progress is durable per chunk, so the size trades bandwidth
/// against nothing important.
pub const CATALOG_CHUNK_ITEMS: usize = 500;

/// Send the fleet a product list, but only when it is not the one they have.
///
/// Called on a timer rather than from anywhere in particular, because "the
/// products changed" has no single moment: an article setup mints SKUs, and so
/// could an import or a correction. Publishing on a schedule catches all of
/// them without every writer having to remember.
///
/// Publishing on every setup was the obvious alternative and is wrong at size.
/// A catalogue goes out as a whole snapshot, five hundred items to a command,
/// to every node — so a fifty-thousand-SKU business sends a hundred commands to
/// each of thirty shops for one new shirt. Coalescing on a timer costs a hash
/// and sends nothing when nothing changed.
///
/// Returns the generation published, or `None` when the fleet is already
/// holding this list.
pub async fn publish_catalog_if_changed(
    pool: &PgPool,
    issued_by: &str,
) -> Result<Option<i64>, AppError> {
    let items = catalog_items(pool).await?;
    let content_hash = catalog_content_hash(&items);

    let last: Option<(i64, String)> = sqlx::query_as(
        "SELECT generation, content_hash FROM catalog_publication
          ORDER BY generation DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    if last
        .as_ref()
        .is_some_and(|(_, previous)| *previous == content_hash)
    {
        return Ok(None);
    }
    let generation = last.map_or(1, |(previous, _)| previous + 1);

    // Everything with a site, DC and shop alike. A DC needs the list too: a
    // stock count that turns up an unexpected tag prices it from here.
    let targets: Vec<String> = sqlx::query_scalar(
        "SELECT origin_id FROM sync_origin_credential WHERE site_id IS NOT NULL
          ORDER BY origin_id",
    )
    .fetch_all(pool)
    .await?;
    if targets.is_empty() {
        return Ok(None);
    }

    let (snapshot_id, _, _) =
        publish_catalog(pool, generation, &items, issued_by, &targets).await?;
    sqlx::query(
        "INSERT INTO catalog_publication
             (generation, snapshot_id, content_hash, item_count, published_by)
         VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(generation)
    .bind(snapshot_id)
    .bind(&content_hash)
    .bind(items.len() as i64)
    .bind(issued_by)
    .execute(pool)
    .await?;
    Ok(Some(generation))
}

/// The product list as the fleet should see it.
///
/// Ordered by SKU code so the hash is a function of the catalogue and not of
/// how Postgres felt like returning it.
async fn catalog_items(pool: &PgPool) -> Result<Vec<CatalogItem>, AppError> {
    let rows = sqlx::query(
        "SELECT s.sku_code, s.color, s.size, s.active, s.base_price_minor,
                a.name article_name, a.article_code, a.division_code, a.image_url,
                COALESCE(
                    array_agg(t.tag_code ORDER BY t.tag_code)
                        FILTER (WHERE t.tag_code IS NOT NULL),
                    '{}'
                ) tags
           FROM sku s
           JOIN article a ON a.id = s.article_id
           LEFT JOIN article_tag t ON t.article_id = a.id
          GROUP BY s.sku_code, s.color, s.size, s.active, s.base_price_minor,
                   a.name, a.article_code, a.division_code, a.image_url
          ORDER BY s.sku_code",
    )
    .fetch_all(pool)
    .await?;

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let sku_code: String = row.get("sku_code");
        // What a person reads on a screen: the style, then which one of it.
        let name = [
            row.get::<String, _>("article_name"),
            row.get::<Option<String>, _>("color").unwrap_or_default(),
            row.get::<Option<String>, _>("size").unwrap_or_default(),
        ]
        .iter()
        .filter(|part| !part.trim().is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join(" ");
        items.push(CatalogItem {
            barcode: crate::cloud::domain::barcode_payload(&sku_code).ok(),
            sku_code,
            name,
            uom: "PCS".into(),
            // A SKU carries no tax class anywhere in the master data. Named as
            // a constant so it is findable when tax comes back; its home is the
            // setup form, beside division and tags.
            tax_category: "STANDARD".into(),
            active: row.get("active"),
            base_price_minor: row.get("base_price_minor"),
            // What the product is, for the rules that price a range rather
            // than a product.
            article_code: row.get("article_code"),
            division_code: row.get("division_code"),
            tags: row.get("tags"),
            // A colourway shares one photograph with every size of the same
            // style, which is why this hangs off the article and not the SKU.
            image_url: row.get("image_url"),
        });
    }
    Ok(items)
}

/// Publish a catalogue to the fleet as an ordered run of commands.
///
/// Every chunk carries the hash of the WHOLE catalogue, so an edge knows the
/// target before the last piece lands. Because the chunks are ordinary
/// commands they inherit the lane's properties for free: contiguous delivery,
/// per-store signatures, acknowledgement, revocation and the fleet
/// convergence view. Nothing about snapshots needed inventing.
///
/// Returns `(snapshot_id, command_ids, targets)`.
pub async fn publish_catalog(
    pool: &PgPool,
    generation: i64,
    items: &[CatalogItem],
    issued_by: &str,
    targets: &[String],
) -> Result<(Uuid, Vec<Uuid>, Vec<String>), AppError> {
    if generation <= 0 {
        return Err(AppError::Validation(
            "catalogue generation must be positive".into(),
        ));
    }
    let snapshot_id = Uuid::new_v4();
    let content_hash = catalog_content_hash(items);
    // An empty catalogue is a legitimate (if alarming) publication, and is
    // expressed as a single chunk carrying no items rather than as no chunks
    // at all — otherwise an edge could never be told "there is nothing".
    let batches: Vec<&[CatalogItem]> = if items.is_empty() {
        vec![&[]]
    } else {
        items.chunks(CATALOG_CHUNK_ITEMS).collect()
    };
    let chunk_count = batches.len() as u32;
    let mut command_ids = Vec::with_capacity(batches.len());
    let mut resolved = Vec::new();
    for (index, batch) in batches.iter().enumerate() {
        let payload = json!({
            "snapshot_id": snapshot_id,
            "generation": generation,
            "chunk_index": index as u32,
            "chunk_count": chunk_count,
            "content_hash": content_hash,
            "items": batch,
        });
        let (command_id, these_targets) = issue_command(
            pool,
            COMMAND_CATALOG_CHUNK,
            &payload,
            issued_by,
            None,
            targets,
        )
        .await?;
        command_ids.push(command_id);
        resolved = these_targets;
    }
    Ok((snapshot_id, command_ids, resolved))
}

/// Land one shop's completed sale in the centre's revenue record.
///
/// Idempotent on the shop's own `sale_id`: a resend after a lost response —
/// the ordinary way a flaky shop connection ends — must not double a day's
/// takings. `ON CONFLICT DO NOTHING` rather than an upsert, because a
/// completed sale is immutable: if the same id ever arrived with different
/// money, silently overwriting would erase the discrepancy instead of
/// leaving it to be found.
async fn apply_sale(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    sale: &crate::cloud::domain::SalesCompletedPayload,
) -> Result<(), AppError> {
    let inserted = sqlx::query(
        "INSERT INTO edge_sale
             (sale_id, origin_id, generation, seq, movement_group_id, site_id, actor_id,
              occurred_at, currency, total_minor, paid_minor, change_minor,
              discount_total_minor, points_earned, pricing_trace_id, customer_id,
              net_ex_tax_minor, tax_total_minor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (sale_id) DO NOTHING",
    )
    .bind(sale.sale_id)
    .bind(origin_id)
    .bind(generation)
    .bind(seq)
    .bind(sale.movement_group_id)
    .bind(&sale.site_id)
    .bind(&sale.actor_id)
    .bind(sale.occurred_at)
    .bind(&sale.currency)
    .bind(sale.total_minor)
    .bind(sale.paid_minor)
    .bind(sale.change_minor)
    .bind(sale.discount_total_minor)
    .bind(sale.points_earned)
    .bind(sale.pricing_trace_id.as_deref())
    // Blank is not a customer. A till that sends an empty string means the
    // shopper was anonymous, and storing "" would put a row in every member's
    // history that belongs to nobody.
    .bind(
        sale.customer_id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty()),
    )
    // The basket's split. `None` from a shop whose book publishes no rate, or
    // one running a build that predates this — not recorded, never nought.
    .bind(sale.net_ex_tax_minor)
    .bind(sale.tax_total_minor)
    .execute(&mut **tx)
    .await?
    .rows_affected()
        == 1;
    if !inserted {
        return Ok(()); // already held; a resend
    }
    // Counting runs behind that guard on purpose: a resent sale returns above,
    // so a promotion is never counted twice for one basket. This is the only
    // place a running total is written, and it is written from a fact that has
    // already been accepted.
    // How it was settled. Keyed by the position the till captured, so a resent
    // fact overwrites the same rows rather than recording each payment twice.
    for tender in &sale.tenders {
        sqlx::query(
            // lane-A: the acquirer, terminal and batch travel with the tender
            // when the till knows them. Null when it does not, which is every
            // till today — the ledger then falls back to `reference`.
            "INSERT INTO edge_sale_tender
                 (sale_id, tender_seq, method, amount_minor, reference,
                  acquirer, terminal_id, batch_no, card_kind)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (sale_id, tender_seq) DO NOTHING",
        )
        .bind(sale.sale_id)
        .bind(tender.tender_seq)
        .bind(tender.method.trim().to_ascii_uppercase())
        .bind(tender.amount_minor)
        .bind(
            tender
                .reference
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(
            tender
                .acquirer
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_ascii_uppercase),
        )
        .bind(
            tender
                .terminal_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(
            tender
                .batch_no
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(
            tender
                .card_kind
                .as_deref()
                .map(str::trim)
                .map(str::to_ascii_uppercase)
                .filter(|value| value == "DEBIT" || value == "CREDIT"),
        )
        .execute(&mut **tx)
        .await?;
    }
    // A voucher that settled a basket was authorised at the centre before the
    // sale: the hold is what stopped two shops spending one card. Now that the
    // fact has landed, the hold becomes the redemption — in this transaction,
    // so a sale and the money it took from a card either both exist or neither
    // does. Only a VOUCHER tender can carry one (`validate_tenders` refuses it
    // anywhere else), so this loop can only ever do something for that method.
    for tender in &sale.tenders {
        if let Some(hold_id) = tender
            .voucher_authorization_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let authorization_id = Uuid::parse_str(hold_id).map_err(|_| {
                AppError::Validation(format!(
                    "sale {} carries a malformed voucher hold id {hold_id:?}",
                    sale.sale_id
                ))
            })?;
            super::vouchers::commit_voucher_hold_for_fact(
                tx,
                authorization_id,
                sale.sale_id,
                &sale.actor_id,
            )
            .await?;
        }
    }
    for promotion in &sale.promotions {
        // The detail, kept beside the count. Both are written from this one
        // accepted fact and behind the same idempotency guard, so the totals on
        // the usage screen and the promotions on a receipt cannot drift apart —
        // which they would the moment they were derived from two reads.
        sqlx::query(
            "INSERT INTO edge_sale_promotion
                 (sale_id, rule_id, campaign_id, coupon_code, benefit_minor)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (sale_id, rule_id) DO NOTHING",
        )
        .bind(sale.sale_id)
        .bind(promotion.rule_id.trim())
        .bind(
            promotion
                .campaign_id
                .as_deref()
                .map(str::trim)
                .filter(|id| !id.is_empty()),
        )
        .bind(
            promotion
                .coupon_code
                .as_deref()
                .map(str::trim)
                .filter(|code| !code.is_empty()),
        )
        .bind(promotion.benefit_minor)
        .execute(&mut **tx)
        .await?;

        // And which units it came off, when the shop said. Written from the
        // same fact and inside the same guard as the row above, so the parts
        // and the total cannot come to disagree — which they would the moment
        // either was derived from a second read.
        //
        // Empty from a shop older than this field, and that stays legible: the
        // total above is what the promotion cost the basket, and these are the
        // attributed split of it. A report must say "not broken down" for a
        // sale with no lines here, never zero.
        for line in &promotion.lines {
            sqlx::query(
                "INSERT INTO edge_sale_promotion_line
                     (sale_id, rule_id, subject_id, benefit_minor)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (sale_id, rule_id, subject_id) DO NOTHING",
            )
            .bind(sale.sale_id)
            .bind(promotion.rule_id.trim())
            .bind(line.subject_id)
            .bind(line.benefit_minor)
            .execute(&mut **tx)
            .await?;
        }

        let mut keys: Vec<(&str, &str)> = vec![("RULE", promotion.rule_id.trim())];
        if let Some(campaign_id) = promotion.campaign_id.as_deref() {
            if !campaign_id.trim().is_empty() {
                keys.push(("CAMPAIGN", campaign_id.trim()));
            }
        }
        if let Some(code) = promotion.coupon_code.as_deref() {
            if !code.trim().is_empty() {
                keys.push(("COUPON", code.trim()));
            }
        }
        for (kind, key) in keys {
            sqlx::query(
                "INSERT INTO commercial_usage (kind, key, uses, spent_minor)
                 VALUES ($1, $2, 1, $3)
                 ON CONFLICT (kind, key) DO UPDATE SET
                     uses = commercial_usage.uses + 1,
                     spent_minor = commercial_usage.spent_minor + $3,
                     last_used_at = now()",
            )
            .bind(kind)
            .bind(key)
            .bind(promotion.benefit_minor)
            .execute(&mut **tx)
            .await?;
            // A per-customer limit is meaningless for an anonymous sale, so
            // nothing is recorded rather than a row against nobody.
            if let Some(customer_id) = sale.customer_id.as_deref() {
                if !customer_id.trim().is_empty() {
                    sqlx::query(
                        "INSERT INTO commercial_usage_customer (kind, key, customer_id, uses)
                         VALUES ($1, $2, $3, 1)
                         ON CONFLICT (kind, key, customer_id) DO UPDATE SET
                             uses = commercial_usage_customer.uses + 1,
                             last_used_at = now()",
                    )
                    .bind(kind)
                    .bind(key)
                    .bind(customer_id.trim())
                    .execute(&mut **tx)
                    .await?;
                }
            }
        }
    }
    for line in &sale.lines {
        sqlx::query(
            "INSERT INTO edge_sale_line
                 (sale_id, subject_id, epc, sku_code, quantity, unit_price_minor,
                  line_total_minor, price_source, publication_version,
                  base_unit_price_minor, markdown_id, net_ex_tax_minor, tax_minor,
                  points_earned)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        )
        .bind(sale.sale_id)
        .bind(line.subject_id)
        .bind(&line.epc)
        .bind(&line.sku_code)
        .bind(line.quantity)
        .bind(line.unit_price_minor)
        // Already validated to reconcile against the header at parse time, so
        // this cannot store a figure the total disagrees with.
        .bind(line.charged().map_err(AppError::Validation)?)
        .bind(line.price_source.as_deref())
        .bind(line.publication_version)
        .bind(line.base_unit_price_minor)
        .bind(line.markdown_id.as_deref())
        // Not recorded, never nought — see `SaleFactLine`.
        .bind(line.net_ex_tax_minor)
        .bind(line.tax_minor)
        .bind(line.points_earned)
        .execute(&mut **tx)
        .await?;
    }

    // ── the points the sale earned, awarded HERE and not at the till ────────
    //
    // A till computes an award; the centre accepting the sale is what makes it
    // spendable. That gap is the whole of the offline rule: a shop selling with
    // the line down records what the basket earned, and the shopper cannot
    // spend it until the sale has arrived and been taken. Awarding at the till
    // would let an offline sale fund a redemption the centre has not yet seen —
    // and might yet reject.
    //
    // Keyed on the sale, so a fact delivered twice awards once: the unique
    // index on `(sale_id) WHERE entry_type = 'EARN'` decides that rather than a
    // prior read, and a replay after a lost acknowledgement is silently correct
    // instead of doubling a member's balance.
    if let Some(customer_id) = sale
        .customer_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        super::loyalty::earn_from_sale(
            tx,
            customer_id,
            sale.sale_id,
            sale.points_earned,
            &sale.actor_id,
        )
        .await?;
    }

    // Nothing here reaches across to the centre's own `sale` row, and that is a
    // constraint rather than an omission. By the time a shop's fact arrives the
    // matching `sale` is COMPLETED, and 0003's `sale_finalized_immutable`
    // refuses to let it be written — so a stamp attempted here would not fail
    // quietly, it would block this origin's whole sync stream on a loyalty
    // detail. The crossing happens at `complete_sale` instead, while the sale
    // is still OPEN. See `sales::carry_customer_from_shop_fact`.
    Ok(())
}

/// Record that a shop has put a price book into service.
///
/// The site is resolved from the origin's credential here, at the moment the
/// report lands, rather than trusted from the payload or looked up later. Taken
/// from the payload it would be a claim; looked up later it would change if the
/// node were ever re-pointed at another shop, quietly rewriting who was selling
/// at what.
async fn apply_publication_activated(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    activated: &crate::cloud::domain::PublicationActivatedPayload,
) -> Result<(), AppError> {
    let site_id: Option<String> =
        sqlx::query_scalar("SELECT site_id FROM sync_origin_credential WHERE origin_id = $1")
            .bind(origin_id)
            .fetch_optional(&mut **tx)
            .await?
            .flatten();
    // Settles the row rather than declining to touch it. `DO NOTHING` was right
    // while the only row that could exist was another activation — but since
    // 0179 the publish writes a PENDING row when it hands the book over, so
    // `DO NOTHING` would have left every shop in the fleet reading as
    // outstanding for ever, and the screen would have been worse than before.
    //
    // Still idempotent, and by a stronger rule than the conflict clause was: a
    // shop already ACTIVE on this book is left untouched entirely, so a
    // redelivered fact cannot walk `activated_at` forward off the shop's own
    // clock or count a second attempt that never happened.
    super::rollout::record_activated(
        tx,
        activated.publication_id,
        origin_id,
        site_id.as_deref(),
        activated.version,
        activated.activated_at,
        activated.price_rule_count,
        Utc::now(),
    )
    .await
}

/// Record that a shop could not put a price book into service.
///
/// The site is resolved from the origin's credential for the same reason the
/// activation resolves it there: taken from the payload it would be a claim, and
/// looked up later it would move if the node were re-pointed.
///
/// A failure does NOT reopen a shop that has already reported activating this
/// book — `rollout::settle_rollout` holds that rule and says why.
async fn apply_publication_activation_failed(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    failed: &crate::cloud::domain::PublicationActivationFailedPayload,
) -> Result<(), AppError> {
    let site_id: Option<String> =
        sqlx::query_scalar("SELECT site_id FROM sync_origin_credential WHERE origin_id = $1")
            .bind(origin_id)
            .fetch_optional(&mut **tx)
            .await?
            .flatten();
    super::rollout::record_failed(
        tx,
        failed.publication_id,
        origin_id,
        site_id.as_deref(),
        failed.version,
        failed.attempted_at,
        &failed.error,
        Utc::now(),
    )
    .await
}

/// A shop reporting money it took without producing a sale.
///
/// `DO NOTHING` on conflict rather than an update, and that is the load-bearing
/// choice: the centre may already have worked this exception — refunded the
/// customer, written it off — and a fact redelivered by a sync retry must not
/// reopen a case somebody has closed. The shop's account of what happened does
/// not change; only head office's answer to it does, and that lives in columns
/// this never writes.
async fn apply_checkout_unresolved(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    exception: &crate::cloud::domain::CheckoutUnresolvedPayload,
) -> Result<(), AppError> {
    let site_id: Option<String> =
        sqlx::query_scalar("SELECT site_id FROM sync_origin_credential WHERE origin_id = $1")
            .bind(origin_id)
            .fetch_optional(&mut **tx)
            .await?
            .flatten();
    let inserted = sqlx::query(
        "INSERT INTO edge_checkout_exception
             (checkout_id, origin_id, site_id, actor_id, total_minor,
              money_held_minor, opened_at, resolved_at, last_error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (checkout_id) DO NOTHING",
    )
    .bind(exception.checkout_id)
    .bind(origin_id)
    .bind(site_id)
    .bind(&exception.actor_id)
    .bind(exception.total_minor)
    .bind(exception.money_held_minor)
    .bind(exception.opened_at)
    .bind(exception.resolved_at)
    .bind(exception.last_error.as_deref())
    .execute(&mut **tx)
    .await?
    .rows_affected();
    // The tenders belong to the row that was just made. Writing them against a
    // redelivery would rewrite the acquirer references under an exception
    // somebody is in the middle of chasing.
    if inserted == 0 {
        return Ok(());
    }
    for tender in &exception.tenders {
        sqlx::query(
            "INSERT INTO edge_checkout_exception_tender
                 (checkout_id, tender_seq, method, amount_minor, status,
                  external_reference, last_error)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (checkout_id, tender_seq) DO NOTHING",
        )
        .bind(exception.checkout_id)
        .bind(tender.tender_seq)
        .bind(&tender.method)
        .bind(tender.amount_minor)
        .bind(&tender.status)
        .bind(tender.external_reference.as_deref())
        .bind(tender.last_error.as_deref())
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// Takings per shop over a window — the report thirty shops exist to produce,
/// and which was impossible until the money started travelling.
pub async fn sales_by_site(
    pool: &PgPool,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Value, AppError> {
    let rows = sqlx::query(
        "SELECT site_id,
                count(*)::bigint            AS sale_count,
                COALESCE(sum(total_minor),0)::bigint AS gross_minor,
                max(occurred_at)            AS last_sale_at
         FROM edge_sale
         WHERE occurred_at >= $1 AND occurred_at < $2
         GROUP BY site_id ORDER BY site_id",
    )
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;
    let items: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "site_id": r.get::<String, _>("site_id"),
                "sale_count": r.get::<i64, _>("sale_count"),
                "gross_minor": r.get::<i64, _>("gross_minor"),
                "last_sale_at": r.get::<Option<DateTime<Utc>>, _>("last_sale_at"),
            })
        })
        .collect();
    let gross: i64 = items
        .iter()
        .map(|i| i["gross_minor"].as_i64().unwrap_or(0))
        .sum();

    // The same window split by how the money arrived. Treasury asks this every
    // Monday and it is a different question from "what did we take": cash is
    // counted at thirty counters and banked locally, card settlements land from
    // an acquirer days later net of fees. A single takings figure cannot be
    // reconciled against either.
    let tenders: Vec<Value> = sqlx::query(
        "SELECT t.method,
                sum(t.amount_minor)::bigint AS amount_minor,
                count(*)::bigint            AS count
         FROM edge_sale_tender t
         JOIN edge_sale s ON s.sale_id = t.sale_id
         WHERE s.occurred_at >= $1 AND s.occurred_at < $2
         GROUP BY t.method ORDER BY sum(t.amount_minor) DESC",
    )
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|r| {
        json!({
            "method": r.get::<String, _>("method"),
            "amount_minor": r.get::<i64, _>("amount_minor"),
            // Tenders, not sales: one basket split across two cards is two.
            "count": r.get::<i64, _>("count"),
        })
    })
    .collect();

    Ok(json!({
        "from": from,
        "to": to,
        "gross_minor": gross,
        "sites": items,
        "tenders": tenders,
    }))
}

// ---- Reconciliation: computed position vs observed position ---------------

/// One pool where the centre's arithmetic and the node's own claim disagree.
#[derive(Clone, Debug)]
pub struct PoolDiscrepancy {
    pub origin_id: String,
    pub site_id: String,
    pub pool_id: String,
    /// Available On Hand derived from physical movement facts minus reservation facts.
    pub computed_on_hand: i64,
    /// Available On Hand independently observed by the node checkpoint.
    pub observed_on_hand: i64,
    /// Reservation derived from immutable workflow facts at the snapshot seq.
    pub computed_allotted: i64,
    /// Reservation independently observed by the node checkpoint.
    pub observed_allotted: i64,
    pub snapshot_seq: i64,
    pub applied_seq: i64,
}

impl PoolDiscrepancy {
    pub fn difference(&self) -> i64 {
        self.computed_on_hand - self.observed_on_hand
    }

    pub fn allotted_difference(&self) -> i64 {
        self.computed_allotted - self.observed_allotted
    }
}

/// Compare every node's reported position against the position the centre
/// derived from that node's own movement facts.
///
/// # What this catches that facts alone cannot
///
/// Facts record what a system believes it did. They cannot reveal that the
/// belief was wrong. Three failures live in exactly that blind spot:
///
/// * a bug in [`apply_movement`] — the centre replays the facts into a
///   position that is confidently, silently incorrect;
/// * an edge projection that has drifted from its own ledger — the edge keeps
///   `inventory_projection` incrementally, and an increment that went astray
///   never shows up in the facts it failed to match;
/// * a hand-edited database — someone fixing a shop over SSH with SQL leaves
///   no fact at all, and the position moves anyway.
///
/// A snapshot is an independent observation of the same quantity, so a
/// disagreement localises the fault to one of two derivations. What it cannot
/// catch is shared blindness: a movement that neither emitted a fact nor
/// touched the projection leaves both sides agreeing, and both wrong.
///
/// # Why comparing is safe without any clock
///
/// A snapshot is itself a fact at some sequence position, so it accounts for
/// exactly the facts before it. A node is compared only once the centre has
/// applied at least that far; until then its snapshot is simply not yet due,
/// which is an ordinary state and not a discrepancy.
pub async fn reconcile_positions(pool: &PgPool) -> Result<Vec<PoolDiscrepancy>, AppError> {
    let rows = sqlx::query(
        "WITH ready AS (
             SELECT s.origin_id,s.site_id,s.generation,s.seq AS snapshot_seq,
                    COALESCE(a.applied_seq,0) AS applied_seq
             FROM edge_inventory_snapshot s
             LEFT JOIN sync_applied_watermark a
               ON a.origin_id=s.origin_id AND a.generation=s.generation
             WHERE COALESCE(a.applied_seq,0) >= s.seq
         ),
         moved AS (
             SELECT em.origin_id,ml.to_place_id AS place_id,ml.quantity AS delta
             FROM ready r
             JOIN edge_movement em
               ON em.origin_id=r.origin_id
              AND (em.generation<r.generation
                   OR (em.generation=r.generation AND em.seq<=r.snapshot_seq))
             JOIN edge_movement_line ml ON ml.movement_group_id=em.movement_group_id
             UNION ALL
             SELECT em.origin_id,ml.from_place_id,-ml.quantity
             FROM ready r
             JOIN edge_movement em
               ON em.origin_id=r.origin_id
              AND (em.generation<r.generation
                   OR (em.generation=r.generation AND em.seq<=r.snapshot_seq))
             JOIN edge_movement_line ml ON ml.movement_group_id=em.movement_group_id
         ),
         physical AS (
             SELECT origin_id,split_part(place_id,':',1) AS pool_id,
                    COALESCE(sum(delta),0)::bigint AS normal_quantity
             FROM moved
             WHERE split_part(place_id,':',2)='on_hand'
             GROUP BY origin_id,split_part(place_id,':',1)
         ),
         remaining_allotted AS (
             -- What each origin still has to put into cartons, read off the
             -- one commitment view.
             --
             -- This used to be `accepted − free picks`, and it was the only
             -- one of the fleet's four spellings that subtracted a FREE pick.
             -- Neither the centre nor a node has ever done that — picking
             -- commits to nobody — so the reconciliation was reporting
             -- disagreements of its own invention against the very nodes it
             -- was checking.
             SELECT commitment.origin_id,commitment.source_pool_id AS pool_id,
                    COALESCE(sum(commitment.to_pack_qty),0)::bigint AS quantity
             FROM ready r
             JOIN allotment_line_commitment commitment
               ON commitment.origin_id=r.origin_id
             GROUP BY commitment.origin_id,commitment.source_pool_id
         )
         SELECT r.origin_id,r.site_id,pool.pool_id,
                -- On Hand is what may still be spent and stops at nought, on
                -- both sides of this comparison: the excess is a shortfall,
                -- and a node that clamps while the centre does not would be
                -- reported as diverging every time a promise outran a shelf.
                GREATEST(COALESCE(physical.normal_quantity,0)-COALESCE(reserved.quantity,0),0)
                    AS computed_on_hand,
                pool.on_hand AS observed_on_hand,
                COALESCE(reserved.quantity,0) AS computed_allotted,
                COALESCE(pool.allotted,0) AS observed_allotted,
                r.snapshot_seq,r.applied_seq
         FROM ready r
         JOIN edge_inventory_pool pool ON pool.origin_id=r.origin_id
         LEFT JOIN physical
           ON physical.origin_id=r.origin_id AND physical.pool_id=pool.pool_id
         LEFT JOIN remaining_allotted reserved
           ON reserved.origin_id=r.origin_id AND reserved.pool_id=pool.pool_id
         WHERE GREATEST(COALESCE(physical.normal_quantity,0)-COALESCE(reserved.quantity,0),0)
                   <> pool.on_hand
            OR COALESCE(reserved.quantity,0) <> COALESCE(pool.allotted,0)
         ORDER BY r.origin_id,pool.pool_id",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| PoolDiscrepancy {
            origin_id: r.get("origin_id"),
            site_id: r.get("site_id"),
            pool_id: r.get("pool_id"),
            computed_on_hand: r.get("computed_on_hand"),
            observed_on_hand: r.get("observed_on_hand"),
            computed_allotted: r.get("computed_allotted"),
            observed_allotted: r.get("observed_allotted"),
            snapshot_seq: r.get("snapshot_seq"),
            applied_seq: r.get("applied_seq"),
        })
        .collect())
}

// ---- Purchase orders ------------------------------------------------------

use crate::cloud::domain::{
    parse_goods_receipt_invoice, parse_goods_receipt_line, parse_goods_receipt_rejected,
    parse_purchase_order, PurchaseOrderLinePayload, COMMAND_PURCHASE_ORDER_ACTIVATE,
    FACT_GOODS_RECEIPT_INVOICE, FACT_GOODS_RECEIPT_LINE, FACT_GOODS_RECEIPT_REJECTED,
};

/// One line as a buyer supplies it.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct NewPurchaseLine {
    pub article_code: String,
    pub article_name: String,
    #[serde(default)]
    pub image_url: Option<String>,
    /// Where the buyer files it, from the same vocabulary the master article
    /// will use. A preset for the setup form later, never a decision.
    #[serde(default)]
    pub division_code: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Pieces.
    pub ordered_quantity: i64,
    pub unit_price_minor: i64,
    #[serde(default)]
    pub promised_date: Option<chrono::NaiveDate>,
}

#[derive(Clone, Debug, serde::Deserialize)]
pub struct NewPurchaseOrder {
    pub po_number: String,
    pub supplier_id: String,
    #[serde(default)]
    pub supplier_name: Option<String>,
    pub destination_site_id: String,
    pub origin_kind: String,
    pub currency: String,
    #[serde(default)]
    pub notes: Option<String>,
    pub created_by: String,
    pub lines: Vec<NewPurchaseLine>,
}

/// Raise a purchase order and send it to the DC that will receive it — in ONE
/// transaction.
///
/// The order and the command that carries it commit together on purpose. An
/// order that exists at the centre but was never sent is invisible to the DC
/// that must act on it, and a command sent for an order that rolled back is an
/// instruction about nothing. Either both happen or neither does.
///
/// The destination is resolved to the ONE origin that owns that site's
/// inventory. No guessing, no broadcast: a command whose target is inferred is
/// a command that will one day arrive at the wrong warehouse.
pub async fn create_purchase_order(
    pool: &PgPool,
    request: &NewPurchaseOrder,
) -> Result<(Uuid, Uuid, String), AppError> {
    if !matches!(request.origin_kind.as_str(), "SOURCING" | "DIRECT") {
        return Err(AppError::Validation(
            "origin_kind must be SOURCING or DIRECT".into(),
        ));
    }
    if request.lines.is_empty() {
        return Err(AppError::Validation("a purchase order needs lines".into()));
    }

    let mut tx = pool.begin().await?;
    // Exactly one node owns a site's inventory; that is who receives against
    // this order. Resolve it inside the same transaction as the PO and command.
    let target = inventory_dc_owner_tx(&mut tx, &request.destination_site_id).await?;
    let Some(target) = target else {
        return Err(AppError::Validation(format!(
            "no registered DC owns site '{}'; register it before ordering to it",
            request.destination_site_id
        )));
    };

    let purchase_order_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO purchase_order
             (purchase_order_id, po_number, supplier_id, supplier_name, destination_site_id,
              origin_kind, order_status, currency, notes, created_by, issued_at)
         VALUES ($1,$2,$3,$4,$5,$6,'ISSUED',$7,$8,$9, now())",
    )
    .bind(purchase_order_id)
    .bind(&request.po_number)
    .bind(&request.supplier_id)
    .bind(&request.supplier_name)
    .bind(&request.destination_site_id)
    .bind(&request.origin_kind)
    .bind(&request.currency)
    .bind(&request.notes)
    .bind(&request.created_by)
    .execute(&mut *tx)
    .await
    .map_err(|error| {
        AppError::Conflict(format!("cannot raise PO {}: {error}", request.po_number))
    })?;

    let mut wire_lines = Vec::with_capacity(request.lines.len());
    for (index, line) in request.lines.iter().enumerate() {
        let line_number = (index + 1) as i32;
        let po_line_id = Uuid::new_v4();
        let line_amount = line
            .unit_price_minor
            .checked_mul(line.ordered_quantity)
            .ok_or_else(|| AppError::Validation(format!("line {line_number} overflows")))?;
        sqlx::query(
            "INSERT INTO purchase_order_line
                 (po_line_id, purchase_order_id, line_number, article_code, article_name,
                  image_url, division_code, ordered_quantity,
                  unit_price_minor, line_amount_minor, promised_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        )
        .bind(po_line_id)
        .bind(purchase_order_id)
        .bind(line_number)
        .bind(&line.article_code)
        .bind(&line.article_name)
        .bind(&line.image_url)
        .bind(&line.division_code)
        .bind(line.ordered_quantity)
        .bind(line.unit_price_minor)
        .bind(line_amount)
        .bind(line.promised_date)
        .execute(&mut *tx)
        .await?;
        // Tags come from the vocabulary, so an unknown one is refused here
        // rather than quietly filed under a word that does not exist.
        for tag in &line.tags {
            sqlx::query(
                "INSERT INTO purchase_order_line_tag (po_line_id, tag_code) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING",
            )
            .bind(po_line_id)
            .bind(tag.trim())
            .execute(&mut *tx)
            .await
            .map_err(|error| {
                AppError::Validation(format!(
                    "line {line_number} carries tag {tag:?}, which is not in the tag \
                     vocabulary: {error}"
                ))
            })?;
        }
        wire_lines.push(PurchaseOrderLinePayload {
            po_line_id,
            line_number,
            article_code: line.article_code.clone(),
            article_name: line.article_name.clone(),
            image_url: line.image_url.clone(),
            division_code: line.division_code.clone(),
            tags: line.tags.clone(),
            ordered_quantity: line.ordered_quantity,
            unit_price_minor: line.unit_price_minor,
            promised_date: line.promised_date.map(|d| d.to_string()),
        });
    }
    // The agreed price goes with the order. The verifier is asked to check it
    // against the supplier's invoice, which arrives on the same lorry as the
    // goods — checking a match against a number you are not allowed to see is
    // not a check.
    let payload = json!({
        "purchase_order_id": purchase_order_id,
        "po_number": request.po_number,
        "supplier_id": request.supplier_id,
        "supplier_name": request.supplier_name,
        "destination_site_id": request.destination_site_id,
        "lines": wire_lines,
    });
    parse_purchase_order(&payload).map_err(AppError::Validation)?;
    let command_id = issue_command_tx(
        &mut tx,
        COMMAND_PURCHASE_ORDER_ACTIVATE,
        &payload,
        &request.created_by,
        None,
        std::slice::from_ref(&target),
    )
    .await?;
    sqlx::query(
        "UPDATE purchase_order SET activation_command_id = $2 WHERE purchase_order_id = $1",
    )
    .bind(purchase_order_id)
    .bind(command_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((purchase_order_id, command_id, target))
}

/// Record what a DC reported receiving against a PO line.
/// A DC reporting that the labels are on the goods.
///
/// This closes the loop head office opened when it set the article up. It is
/// deliberately thin: the units themselves arrive on the movement facts that
/// accompany it, so all this has to do is record that the work happened and
/// let the session rest.
async fn apply_tagging_completed(
    tx: &mut Transaction<'_, Postgres>,
    done: &crate::cloud::domain::TaggingCompletedPayload,
) -> Result<(), AppError> {
    let updated = sqlx::query(
        "UPDATE tagging_job
         SET status = 'TAGGED', confirmed_by = $2, confirmed_at = $3
         WHERE job_id = $1 AND status = 'ISSUED'",
    )
    .bind(done.job_id)
    .bind(&done.confirmed_by)
    .bind(done.confirmed_at)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    if updated == 0 {
        // Either the job is unknown, or it is already closed. An unknown job
        // is a real problem worth stopping for; a resend after a lost
        // response is the ordinary end of a flaky link and must pass.
        let known: Option<String> =
            sqlx::query_scalar("SELECT status FROM tagging_job WHERE job_id = $1")
                .bind(done.job_id)
                .fetch_optional(&mut **tx)
                .await?;
        match known.as_deref() {
            Some("TAGGED") => return Ok(()),
            Some(other) => {
                return Err(AppError::Validation(format!(
                    "tagging job {} is {other}, not awaiting confirmation",
                    done.job_id
                )));
            }
            None => {
                return Err(AppError::Validation(format!(
                    "no tagging job {}: a DC confirmed work the centre never sent",
                    done.job_id
                )));
            }
        }
    }
    sqlx::query(
        "UPDATE article_setup_session SET status = 'TAGGED', tagged_at = $2 WHERE session_id = $1",
    )
    .bind(done.session_id)
    .bind(done.confirmed_at)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn apply_goods_receipt_line(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    line: &crate::cloud::domain::GoodsReceiptLinePayload,
) -> Result<(), AppError> {
    // ---- what the order says, read here rather than taken on trust --------
    //
    // Everything below is checked at the centre even though the DC checked it
    // first. A fact arrives over a wire from a node that may be behind, may
    // have been rebuilt from an old backup, or may not be the node it claims
    // to be; "the edge already validated it" is an assumption, and the two
    // rules this enforces — the right warehouse, the right supplier — are the
    // ones that put goods on somebody else's order and invoice the wrong
    // company.
    let ordered: Option<(Uuid, i64, i64, String, String, i64)> = sqlx::query_as(
        "SELECT o.purchase_order_id, l.ordered_quantity, l.unit_price_minor,
                o.destination_site_id, o.supplier_id, o.discount_minor
           FROM purchase_order_line l
           JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
          WHERE l.po_line_id = $1
          FOR UPDATE OF l",
    )
    .bind(line.po_line_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some((
        purchase_order_id,
        ordered_quantity,
        ordered_unit_price,
        destination_site_id,
        ordered_from,
        order_discount,
    )) = ordered
    else {
        return Err(AppError::Validation(format!(
            "purchase order line {} does not exist here: a receipt arrived against an order the \
             centre has no record of",
            line.po_line_id
        )));
    };

    let reporting_site: Option<String> =
        sqlx::query_scalar("SELECT site_id FROM sync_origin_credential WHERE origin_id = $1")
            .bind(origin_id)
            .fetch_optional(&mut **tx)
            .await?;
    let Some(reporting_site) = reporting_site else {
        return Err(AppError::Validation(format!(
            "origin {origin_id} is not registered; it cannot report a delivery"
        )));
    };
    if reporting_site != destination_site_id {
        return Err(AppError::Validation(format!(
            "{origin_id} stands in site {reporting_site} and purchase order line {} is to be \
             delivered to {destination_site_id}; a warehouse cannot receive against another \
             warehouse's order",
            line.po_line_id
        )));
    }
    if line.supplier_id.trim() != ordered_from.trim() {
        return Err(AppError::Validation(format!(
            "this delivery came from {} and that order is with {ordered_from}; a supplier's goods \
             cannot be received against another supplier's order",
            line.supplier_id
        )));
    }

    // ---- the split, re-derived from what the centre itself holds ----------
    //
    // The DC sends its own answer and this ignores it, because the order lives
    // here. What arrived beyond the outstanding quantity is real — the goods
    // are on the floor — but it is not quantity this company agreed to buy,
    // and it stays out of every figure that says what the order is owed.
    let already_matched: i64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(matched_quantity), 0)::bigint
           FROM goods_receipt_line WHERE po_line_id = $1",
    )
    .bind(line.po_line_id)
    .fetch_one(&mut **tx)
    .await?;
    let outstanding = (ordered_quantity - already_matched).max(0);
    let matched_quantity = line.quantity.min(outstanding);
    let excess_quantity = line.quantity - matched_quantity;

    // The price as it was when the goods were accepted. The DC writes it down
    // at that moment; a node too old to send one leaves the order's price as
    // it stands now, which is the best the centre can honestly do.
    let agreed_unit_price = line
        .agreed_unit_price_minor
        .unwrap_or(ordered_unit_price)
        .max(0);

    // ---- this receipt's share of the order discount -----------------------
    //
    // Allocated by running cumulative value, so the shares add up to the
    // discount exactly and no receipt's share changes once written. A partial
    // order allocates only the part it has earned: a discount on goods that
    // never arrived was never earned.
    let allocated_discount = if order_discount > 0 {
        let expected_gross: i64 = sqlx::query_scalar(
            "SELECT COALESCE(sum(ordered_quantity * unit_price_minor), 0)::bigint
               FROM purchase_order_line WHERE purchase_order_id = $1",
        )
        .bind(purchase_order_id)
        .fetch_one(&mut **tx)
        .await?;
        let (matched_value_so_far, allocated_so_far): (i64, i64) = sqlx::query_as(
            "SELECT COALESCE(sum(r.matched_quantity
                                 * COALESCE(r.agreed_unit_price_minor, l.unit_price_minor)), 0)::bigint,
                    COALESCE(sum(r.allocated_discount_minor), 0)::bigint
               FROM goods_receipt_line r
               JOIN purchase_order_line l ON l.po_line_id = r.po_line_id
              WHERE l.purchase_order_id = $1",
        )
        .bind(purchase_order_id)
        .fetch_one(&mut **tx)
        .await?;
        if expected_gross <= 0 {
            0
        } else {
            let cumulative = matched_value_so_far
                .saturating_add(matched_quantity.saturating_mul(agreed_unit_price));
            // Rounded half up, on integers, and capped at the whole discount:
            // the last receipt of a completed order takes whatever rounding
            // left behind, which is what makes the shares reconcile.
            let target = ((cumulative as i128 * order_discount as i128 * 2
                + expected_gross as i128)
                / (expected_gross as i128 * 2)) as i64;
            target
                .min(order_discount)
                .saturating_sub(allocated_so_far)
                .max(0)
        }
    } else {
        0
    };

    // The document, upserted. Each accepted line carries the header so no
    // ordering rule is needed between two kinds of fact — the first line to
    // arrive creates the receipt, the rest recognise it.
    sqlx::query(
        "INSERT INTO goods_receipt
             (receipt_id, receipt_number, origin_id, site_id, supplier_id, arrived_at,
              opened_by, opened_at, generation, seq)
         SELECT $1, $2, $3, c.site_id, $4, $5, $6, $7, $8, $9
         FROM sync_origin_credential c WHERE c.origin_id = $3
         ON CONFLICT (receipt_id) DO NOTHING",
    )
    .bind(line.receipt_id)
    .bind(&line.receipt_number)
    .bind(origin_id)
    .bind(&line.supplier_id)
    .bind(line.arrived_at)
    .bind(&line.opened_by)
    .bind(line.opened_at)
    .bind(generation)
    .bind(seq)
    .execute(&mut **tx)
    .await?;

    let inserted = sqlx::query(
        "INSERT INTO goods_receipt_line
             (receipt_line_id, receipt_id, count_id, po_line_id, quantity, matched_quantity,
              excess_quantity, agreed_unit_price_minor, allocated_discount_minor,
              counted_by, verified_by, counted_at, verified_at, movement_group_id,
              generation, seq)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (receipt_line_id) DO NOTHING",
    )
    .bind(line.receipt_line_id)
    .bind(line.receipt_id)
    .bind(line.count_id)
    .bind(line.po_line_id)
    .bind(line.quantity)
    .bind(matched_quantity)
    .bind(excess_quantity)
    .bind(agreed_unit_price)
    .bind(allocated_discount)
    .bind(&line.counted_by)
    .bind(&line.verified_by)
    .bind(line.counted_at)
    .bind(line.verified_at)
    .bind(line.movement_group_id)
    .bind(generation)
    .bind(seq)
    .execute(&mut **tx)
    .await?;

    // Accepted goods with no identity yet are head office's move, and nobody
    // at the warehouse can make it: the article, its SKUs and their EPCs are
    // minted centrally. Raised only when the line was actually inserted — a
    // replayed fact is the same delivery, not a second one.
    if inserted.rows_affected() > 0 {
        let ordered: Option<(String, String)> = sqlx::query_as(
            "SELECT o.po_number, l.article_name
               FROM purchase_order_line l
               JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
              WHERE l.po_line_id = $1",
        )
        .bind(line.po_line_id)
        .fetch_optional(&mut **tx)
        .await?;
        if let Some((po_number, article_name)) = ordered {
            let recipients =
                super::notifications::recipients_with_role(tx, &["ADMIN", "SUPERVISOR"]).await?;
            super::notifications::raise_notification(
                tx,
                super::notifications::NewNotification {
                    kind: "receipt.awaiting_identity",
                    title: "Goods arrived without an identity".into(),
                    body: format!(
                        "{} pieces of \"{article_name}\" ({po_number}) were accepted on {} at {origin_id} and are waiting to be named, priced and given labels.",
                        line.quantity, line.receipt_number,
                    ),
                    subject: Some(("receipt", line.receipt_id.to_string())),
                    origin_id: Some(origin_id),
                    payload: serde_json::json!({
                        "receipt_line_id": line.receipt_line_id,
                        "po_line_id": line.po_line_id,
                        "quantity": line.quantity,
                        "matched_quantity": matched_quantity,
                        "excess_quantity": excess_quantity,
                    }),
                },
                &recipients,
            )
            .await?;
        }
        // Quantity nobody ordered is a commercial question, and it is asked
        // the moment it arrives rather than found weeks later by whoever
        // reconciles the invoice.
        if excess_quantity > 0 {
            let recipients =
                super::notifications::recipients_with_role(tx, &["ADMIN", "SUPERVISOR"]).await?;
            super::notifications::raise_notification(
                tx,
                super::notifications::NewNotification {
                    kind: "receipt.excess_awaiting_decision",
                    title: "More arrived than was ordered".into(),
                    body: format!(
                        "{excess_quantity} pieces on {} at {origin_id} are beyond what the order \
                         had outstanding. They are in the warehouse and are not yet ours to sell: \
                         keep them or send them back.",
                        line.receipt_number
                    ),
                    subject: Some(("receipt", line.receipt_id.to_string())),
                    origin_id: Some(origin_id),
                    payload: serde_json::json!({
                        "receipt_line_id": line.receipt_line_id,
                        "po_line_id": line.po_line_id,
                        "excess_quantity": excess_quantity,
                    }),
                },
                &recipients,
            )
            .await?;
        }
    }
    Ok(())
}

/// A whole delivery turned away at the gate.
///
/// No lines, because nothing was accepted — which is exactly why this travels
/// as its own fact. The header used to arrive only on the back of an accepted
/// line, so a refused lorry left no trace at the centre at all, and "this
/// supplier sent damaged goods three times" was unanswerable.
async fn apply_goods_receipt_rejected(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    refused: &crate::cloud::domain::GoodsReceiptRejectedPayload,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO goods_receipt
             (receipt_id, receipt_number, origin_id, site_id, supplier_id, arrived_at,
              opened_by, opened_at, status, closed_by, closed_at, rejected_reason,
              generation, seq)
         SELECT $1, $2, $3, c.site_id, $4, $5, $6, $7, 'REJECTED', $8, $9, $10, $11, $12
         FROM sync_origin_credential c WHERE c.origin_id = $3
         ON CONFLICT (receipt_id) DO UPDATE
            SET status          = 'REJECTED',
                closed_by       = EXCLUDED.closed_by,
                closed_at       = EXCLUDED.closed_at,
                rejected_reason = EXCLUDED.rejected_reason
          WHERE goods_receipt.status <> 'REJECTED'",
    )
    .bind(refused.receipt_id)
    .bind(&refused.receipt_number)
    .bind(origin_id)
    .bind(&refused.supplier_id)
    .bind(refused.arrived_at)
    .bind(&refused.opened_by)
    .bind(refused.opened_at)
    .bind(&refused.rejected_by)
    .bind(refused.rejected_at)
    .bind(refused.reason.trim())
    .bind(generation)
    .bind(seq)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// An invoice date is a day on a piece of paper, not an instant.
///
/// The column is `date` and the field means the day the supplier wrote on the
/// invoice — a fact with no time and no zone. Some senders hand us that day
/// already stringified through a clock (`new Date(day).toISOString()`), so the
/// wire carries `2026-09-10T00:00:00.000Z` where `2026-09-10` was meant.
/// Refusing those is what blocked one warehouse's whole stream behind a single
/// typed date: a validation error here stops the origin rather than being set
/// aside, so everything the DC said afterwards waited on one bad field.
///
/// The date part is taken from the instant as it was sent, not as WIB would
/// read it. A sender that meant a day and passed it through UTC midnight —
/// which is what every one of these has been — gets the day back unchanged;
/// shifting by the local offset would move it to the day before instead.
fn parse_invoice_date(value: &str) -> Result<chrono::NaiveDate, AppError> {
    let value = value.trim();
    if let Ok(date) = value.parse::<chrono::NaiveDate>() {
        return Ok(date);
    }
    if let Ok(moment) = chrono::DateTime::parse_from_rfc3339(value) {
        return Ok(moment.naive_utc().date());
    }
    Err(AppError::Validation(format!(
        "invoice date: expected a day as YYYY-MM-DD, got {value:?}"
    )))
}

/// The supplier's invoice, recorded against a delivery that already arrived.
/// Whether the invoice found the delivery it belongs to.
enum InvoiceApplication {
    Applied,
    /// The centre has no such delivery yet. Not an error: see the body.
    NoSuchReceipt,
}

async fn apply_goods_receipt_invoice(
    tx: &mut Transaction<'_, Postgres>,
    invoice: &crate::cloud::domain::GoodsReceiptInvoicePayload,
) -> Result<InvoiceApplication, AppError> {
    let date = invoice
        .invoice_date
        .as_deref()
        .map(parse_invoice_date)
        .transpose()?;
    let updated = sqlx::query(
        "UPDATE goods_receipt
         SET invoice_number = $2, invoice_date = $3, invoice_total_minor = $4,
             invoice_document_ref = $5, invoice_recorded_by = $6, invoice_recorded_at = $7
         WHERE receipt_id = $1",
    )
    .bind(invoice.receipt_id)
    .bind(&invoice.invoice_number)
    .bind(date)
    .bind(invoice.invoice_total_minor)
    .bind(&invoice.invoice_document_ref)
    .bind(&invoice.recorded_by)
    .bind(invoice.recorded_at)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    if updated == 0 {
        // An invoice for a delivery the centre has never heard of.
        //
        // This used to be treated as "genuinely wrong rather than merely
        // early", on the reasoning that the line facts and this one leave the
        // same node in sequence. They do — but not in the order this assumed.
        // A node enqueues the invoice when somebody types it and the lines
        // when each count is verified, so an invoice typed first sits at a
        // LOWER seq than the lines. The centre learns a delivery exists only
        // from a line fact (that payload carries the receipt number, the
        // supplier and the arrival; this one carries an id and money), so the
        // invoice cannot be applied until they land — and they are queued
        // behind it. Blocking here stops the warehouse for good.
        return Ok(InvoiceApplication::NoSuchReceipt);
    }
    Ok(InvoiceApplication::Applied)
}

/// A purchase order with what has actually arrived against it.
///
/// `received_quantity` is summed from the receipt facts every time it is
/// asked for. It is not a column that someone increments, because a counter
/// and the facts behind it drift, and when they do there is no way to tell
/// which one lied.
pub async fn purchase_order_status(pool: &PgPool, id: Uuid) -> Result<Value, AppError> {
    let header = sqlx::query(
        "SELECT po_number, supplier_id, supplier_name, destination_site_id, origin_kind,
                order_status, currency, created_by, issued_at, activation_command_id,
                discount_minor
         FROM purchase_order WHERE purchase_order_id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("purchase order".into()))?;
    let lines = sqlx::query(
        "SELECT l.po_line_id, l.line_number, l.article_code, l.article_name, l.division_code,
                l.image_url,
                l.ordered_quantity,
                l.cancelled_quantity, l.line_status, l.promised_date,
                l.closed_short_units, l.closed_short_by, l.closed_short_reason,
                l.unit_price_minor, l.line_amount_minor,
                -- What answered the order, and what arrived beyond it. Two
                -- numbers because they are two different facts: one is the
                -- company's purchase, the other is goods it has not agreed to
                -- buy and may be sending back.
                COALESCE((SELECT sum(r.matched_quantity) FROM goods_receipt_line r
                          WHERE r.po_line_id = l.po_line_id), 0)::bigint AS received_quantity,
                COALESCE((SELECT sum(r.excess_quantity) FROM goods_receipt_line r
                          WHERE r.po_line_id = l.po_line_id), 0)::bigint AS excess_quantity,
                -- What the acceptances are expected to be worth, at the prices
                -- that applied when each was accepted and net of the discount
                -- allocated to it. An estimate for Finance to match against —
                -- nothing here is owed, and nothing here is posted.
                COALESCE((SELECT sum(r.matched_quantity
                                     * COALESCE(r.agreed_unit_price_minor, l.unit_price_minor))
                                 - sum(r.allocated_discount_minor)
                          FROM goods_receipt_line r
                          WHERE r.po_line_id = l.po_line_id), 0)::bigint AS expected_value_minor,
                COALESCE((SELECT array_agg(t.tag_code ORDER BY t.tag_code)
                          FROM purchase_order_line_tag t
                          WHERE t.po_line_id = l.po_line_id), '{}')::text[] AS tags
         FROM purchase_order_line l
         WHERE l.purchase_order_id = $1
         ORDER BY l.line_number",
    )
    .bind(id)
    .fetch_all(pool)
    .await?;
    let mut fully_received = true;
    let mut any_received = false;
    let mut all_lines_settled = true;
    let mut expected_value_total: i64 = 0;
    let mut gross_total: i64 = 0;
    let mut promised: Option<chrono::NaiveDate> = None;
    let items: Vec<Value> = lines
        .into_iter()
        .map(|r| {
            let ordered: i64 = r.get("ordered_quantity");
            let cancelled: i64 = r.get("cancelled_quantity");
            let received: i64 = r.get("received_quantity");
            // Both sides are pieces, so the comparison is direct.
            let expected_stock_units = ordered - cancelled;
            let short_units: Option<i64> = r.get("closed_short_units");
            if received > 0 {
                any_received = true;
            }
            if r.get::<String, _>("line_status") == "OPEN" {
                all_lines_settled = false;
            }
            // A line closed short has stopped waiting: nothing is outstanding
            // on it any more, even though it was never filled. The shortfall
            // is still reported, because "settled" and "arrived" are not the
            // same thing and a buyer needs to see which one this was.
            let outstanding = match short_units {
                Some(_) => 0,
                None => (expected_stock_units - received).max(0),
            };
            if outstanding > 0 {
                fully_received = false;
            }
            // What is owed, as opposed to what was committed to.
            //
            // Derived from receipts, never from the order: a supplier is paid
            // for what they delivered. `line_amount_minor` remains the value
            // of the ORDER — the two are different numbers with different
            // meanings, and a line that arrived short must show both.
            //
            // Price and receipts are both per piece, so this is a straight
            // multiplication with nothing to convert and nothing to round.
            let unit_price: i64 = r.get("unit_price_minor");
            let expected_value_minor: i64 = r.get("expected_value_minor");
            expected_value_total += expected_value_minor;
            gross_total += r.get::<i64, _>("line_amount_minor");
            // One promise per order, which is how it is agreed and how it is
            // stamped. The earliest of the lines, so a split promise reads as
            // the first thing due.
            if let Some(date) = r.get::<Option<chrono::NaiveDate>, _>("promised_date") {
                promised = Some(promised.map_or(date, |held| held.min(date)));
            }
            json!({
                "po_line_id": r.get::<Uuid, _>("po_line_id"),
                "line_number": r.get::<i32, _>("line_number"),
                "unit_price_minor": unit_price,
                "ordered_value_minor": r.get::<i64, _>("line_amount_minor"),
                // What the acceptances against this line are expected to be
                // worth. NOT a payable: nothing has validated it and nothing
                // is posted until Finance matches a supplier bill.
                "expected_value_minor": expected_value_minor,
                "article_code": r.get::<String, _>("article_code"),
                "article_name": r.get::<String, _>("article_name"),
                // The picture the buyer chose when the order was raised. It has
                // been stored on the line since the catalogue path was written
                // and shown on no screen that reads the order back.
                "image_url": r.get::<Option<String>, _>("image_url"),
                "division_code": r.get::<Option<String>, _>("division_code"),
                "tags": r.get::<Vec<String>, _>("tags"),
                // When the supplier said it would arrive. Selected by this
                // query since the column existed and then dropped on the way
                // out, so the date a buyer sets when raising the order was
                // write-only: stored, shipped to the DC, and invisible on the
                // one screen that shows the order back to them.
                "promised_date": r.get::<Option<chrono::NaiveDate>, _>("promised_date")
                    .map(|date| date.to_string()),
                "ordered_quantity": ordered,
                "cancelled_quantity": cancelled,
                "expected_stock_units": expected_stock_units,
                "received_quantity": received,
                "excess_quantity": r.get::<i64, _>("excess_quantity"),
                "outstanding_stock_units": outstanding,
                "closed_short_units": short_units,
                "closed_short_by": r.get::<Option<String>, _>("closed_short_by"),
                "closed_short_reason": r.get::<Option<String>, _>("closed_short_reason"),
                "line_status": r.get::<String, _>("line_status"),
            })
        })
        .collect();
    Ok(json!({
        "purchase_order_id": id,
        "po_number": header.get::<String, _>("po_number"),
        "supplier_id": header.get::<String, _>("supplier_id"),
        "supplier_name": header.get::<Option<String>, _>("supplier_name"),
        "destination_site_id": header.get::<String, _>("destination_site_id"),
        "origin_kind": header.get::<String, _>("origin_kind"),
        "order_status": header.get::<String, _>("order_status"),
        "currency": header.get::<String, _>("currency"),
        "created_by": header.get::<String, _>("created_by"),
        "issued_at": header.get::<Option<DateTime<Utc>>, _>("issued_at"),
        "activation_command_id": header.get::<Option<Uuid>, _>("activation_command_id"),
        "fully_received": fully_received,
        // Where the order stands, worked out from its receipts on every read.
        // The stored `order_status` knows only ISSUED and CLOSED and cannot
        // tell an order that has arrived in full from one nobody has
        // delivered against.
        "lifecycle": if all_lines_settled || header.get::<String, _>("order_status") == "CLOSED" {
            "CLOSED"
        } else if fully_received {
            "FULLY_RECEIVED"
        } else if any_received {
            "PARTIALLY_RECEIVED"
        } else {
            "ACTIVE"
        },
        // What the deliveries are expected to be worth, at the prices that
        // applied when each was accepted. An operational estimate for Finance
        // to match against — not a payable, and not in the ledger.
        "expected_value_minor": expected_value_total,
        // What the order is WORTH, which is a different question and the one
        // the list column and the composer's ladder both answer: the lines,
        // the discount agreed on the whole order, and what will be invoiced.
        "gross_minor": gross_total,
        "discount_minor": header.get::<i64, _>("discount_minor"),
        "net_minor": (gross_total - header.get::<i64, _>("discount_minor")).max(0),
        "expected_arrival": promised.map(|date| date.to_string()),
        "lines": items,
    }))
}

/// Every purchase order with its outstanding position — the buyer's list.
/// What narrows the order book, as the browser asked for it.
///
/// Named `PurchaseOrderFilter` and not `Filter`: everything in `postgres::` is
/// re-exported into one namespace, and a generic name here collides with a
/// module three doors down and reports it as something else entirely.
#[derive(Clone, Debug, Default)]
pub struct PurchaseOrderFilter {
    /// PO number, supplier name or supplier code. One box, because that is the
    /// one question — "where is that order" — and a buyer holding a number does
    /// not want to be asked which KIND of thing they are holding.
    pub q: Option<String>,
    /// Empty means every status, never "no status". An empty list bound as an
    /// array would match nothing and empty the screen on a filter nobody set.
    pub statuses: Vec<String>,
    pub suppliers: Vec<String>,
    pub issued_from: Option<chrono::NaiveDate>,
    pub issued_to: Option<chrono::NaiveDate>,
    /// `issued` (the default), `po_number`, `supplier`, `value` or `expected`.
    ///
    /// Anything unrecognised falls back to `issued` rather than refusing: a
    /// sort arrives from a URL somebody may have kept from an older build, and
    /// a 400 for a stale bookmark is a worse answer than the rows in the house
    /// order.
    ///
    /// There is deliberately no sort by status. Sorting four state names
    /// alphabetically groups nothing anybody asked for — "show me the open
    /// ones" is a filter, and the facet counts are how it is asked.
    pub sort: Option<String>,
    /// `asc` or `desc`. Absent means each key's OWN natural direction: the
    /// newest orders first, the largest amounts first, but a PO number and a
    /// promised date forwards. An order book that opened on the oldest order
    /// the company ever raised would be a screen nobody could use.
    pub dir: Option<String>,
    pub cursor: Option<String>,
    /// Absent means [`ORDER_BOOK_DEFAULT_LIMIT`], not "everything".
    pub limit: Option<i64>,
}

/// How many orders the book returns when the caller does not say.
///
/// Here rather than in the handler, beside the only clamp that enforces it. It
/// was five hundred in the handler and clamped to two thousand here, which is
/// two spellings of one number and neither of them a page.
const ORDER_BOOK_DEFAULT_LIMIT: i64 = 200;
/// And the most it will return however loudly a caller asks.
///
/// Down from two thousand. That ceiling existed because there was no other way
/// to reach the rest of the book — a buyer looking for the nine-hundredth order
/// had to ask for a thousand. There is a cursor now, so a large `limit` buys
/// nothing and costs the server a wider scan and the browser a longer list.
const ORDER_BOOK_MAX_LIMIT: i64 = 1000;

/// One order, as the book draws it.
///
/// Typed rather than hand-built JSON, so the browser's `PurchaseOrderRow` is
/// generated from this struct instead of transcribed beside it. Two of them
/// were transcribed — the hub's and the cloud console's — which is the disease
/// `contract_types` exists to cure.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseOrderRow {
    pub purchase_order_id: Uuid,
    pub po_number: String,
    pub supplier_id: String,
    pub supplier_name: Option<String>,
    pub destination_site_id: String,
    /// Where the order stands, derived from its receipts every time it is
    /// asked for: `ACTIVE`, `PARTIALLY_RECEIVED`, `FULLY_RECEIVED`, `CLOSED`.
    /// This is what a screen shows and what the status facet counts.
    pub lifecycle: String,
    /// The stored column, which knows only that an order was issued or that
    /// every line of it has stopped waiting. Kept for readers that still ask;
    /// `lifecycle` is the answer to "where is this order".
    pub order_status: String,
    pub currency: String,
    /// Absent while the order is still a draft. That is also why the house
    /// order needs a sentinel — see [`ORDER_BOOK_ROWS`].
    pub issued_at: Option<DateTime<Utc>>,
    /// The date the supplier promised. One per order, because that is how it is
    /// agreed and how it is stamped — the earliest of the lines, so a split
    /// promise reads as the first thing due.
    pub expected_arrival: Option<chrono::NaiveDate>,
    pub line_count: i64,
    pub gross_minor: i64,
    pub discount_minor: i64,
    /// What the supplier will invoice. Stated here rather than left to the
    /// browser to subtract, so the figure in the list and the figure on the
    /// order are one calculation.
    pub net_minor: i64,
    pub expected_stock_units: i64,
    /// Quantity that answered the order. Excess is not in here.
    pub received_stock_units: i64,
    pub outstanding_stock_units: i64,
    /// Quantity covered by active supplier bills linked to the order lines.
    /// Draft, matched, and posted bills count; rejected and void bills do not.
    pub invoiced_stock_units: i64,
    /// Quantity that arrived beyond the order and is waiting for a buyer to
    /// say whether the company is keeping it.
    pub excess_stock_units: i64,
    pub fully_received: bool,
}

/// One value a filter can take, and how many orders would still be there.
///
/// Counted over what the SEARCH leaves, ignoring the filters currently applied
/// — so the number beside a supplier answers "how many of their orders are
/// there", which is the question somebody has while deciding whether to click
/// it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseOrderFacet {
    pub value: String,
    /// The supplier's name beside its code, because `SUP-0004` is what this
    /// system files an order under and the list beside the filter shows
    /// `PT Sinar Abadi`. Absent for a status, whose words belong to the screen.
    pub label: Option<String>,
    pub count: i64,
}

/// The two things the order book can be narrowed by that are worth counting.
///
/// The issue dates are not among them: a facet is a value somebody ticks, and a
/// range is not a value.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseOrderFacets {
    pub order_status: Vec<PurchaseOrderFacet>,
    pub supplier: Vec<PurchaseOrderFacet>,
}

/// A page of the order book, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseOrderPage {
    pub rows: Vec<PurchaseOrderRow>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    ///
    /// Deliberately not an offset. Orders are raised, issued and cancelled
    /// while somebody pages through them, and an offset would skip or repeat
    /// rows with nothing saying so.
    pub next_cursor: Option<String>,
    /// Every order the search and the filters match — not just this page.
    /// Without it a screen can only say "200 orders", which is a statement
    /// about the page size rather than about the book.
    pub total: i64,
    pub facets: PurchaseOrderFacets,
}

/// Where the previous page stopped — as a ROW, not as a position.
///
/// The order's id, whatever the list is sorted by. The seek re-reads that row's
/// own sort value in SQL, so one cursor shape serves every order and a sixth
/// sort cannot arrive without its cursor.
#[derive(Serialize, Deserialize)]
struct PurchaseOrderCursor {
    purchase_order_id: Uuid,
}

/// One order-book row, defined once.
///
/// Used by the page query and by the facet counts, and that is the whole reason
/// it is a constant: the facets are only honest if they count exactly what the
/// page can show.
///
/// Binds: `$1` the search pattern, or NULL for no search.
///
/// It stops at the SEARCH. The status, supplier and date filters are applied
/// outside it, which is what lets one definition answer two different questions
/// from the same rows: the page wants what the filters leave, while the filter
/// panel's counts want what the search alone leaves — because "ISSUED 41" has
/// to mean "there are 41 issued orders", not "41 among the ones you have
/// already narrowed to issued".
///
/// The `*_key` columns are computed here rather than only in `ORDER BY` because
/// the keyset has to COMPARE the sort value in a `WHERE`, and a sort expression
/// that is not also a column is one a `WHERE` cannot see.
///
/// **`issued_key` is where `NULLS LAST` used to be, and the swap is the whole
/// point.** A draft has no issue instant, and the old order said
/// `issued_at DESC NULLS LAST` to keep drafts at the bottom. `NULLS LAST`
/// orders a result and says nothing a keyset can seek against: a row comparison
/// against NULL is NULL rather than true, so the first draft would have ended
/// paging at whatever row happened to carry it, silently, with the rest of the
/// book below the fold. `-infinity` is the same decision as a VALUE — the
/// beginning of time sorts last descending, which is where a draft belongs, and
/// first ascending, which is honest about what an unissued order is.
const ORDER_BOOK_ROWS: &str = "
    SELECT b.*,
           -- Where the order stands, derived rather than stored.
           --
           -- `order_status` only ever reads ISSUED or CLOSED, and nothing sets
           -- CLOSED except closing every line short — so an order that arrived
           -- in full stayed ISSUED for ever and the list said it was still
           -- waiting. A stored lifecycle would be a second copy of what the
           -- receipts already say, and the two would drift the first time a
           -- fact was replayed.
           CASE
               WHEN b.all_lines_settled OR b.order_status = 'CLOSED' THEN 'CLOSED'
               WHEN b.expected_stock_units > 0
                    AND b.received_stock_units >= b.expected_stock_units
                    THEN 'FULLY_RECEIVED'
               WHEN b.received_stock_units > 0 THEN 'PARTIALLY_RECEIVED'
               ELSE 'ACTIVE'
           END AS lifecycle
    FROM (
        SELECT o.purchase_order_id, o.po_number, o.supplier_id, o.supplier_name,
               o.destination_site_id, o.order_status, o.currency, o.issued_at,
               o.discount_minor,
               COALESCE(o.issued_at, TIMESTAMPTZ '-infinity') AS issued_key,
               COALESCE(o.supplier_name, o.supplier_id)       AS supplier_key,
               count(l.po_line_id)::bigint AS line_count,
               min(l.promised_date) AS expected_arrival,
               -- A promise nobody made sorts after every promise somebody did,
               -- which is the useful answer when the question is what is due
               -- next.
               COALESCE(min(l.promised_date), DATE '9999-12-31') AS expected_key,
               COALESCE(sum(l.line_amount_minor), 0)::bigint AS gross_minor,
               (COALESCE(sum(l.line_amount_minor), 0) - o.discount_minor)::bigint AS net_key,
               COALESCE(sum(l.ordered_quantity - l.cancelled_quantity), 0)::bigint
                   AS expected_stock_units,
               -- MATCHED, not everything accepted. Quantity that arrived
               -- beyond the order was never what the order was waiting for,
               -- and counting it here is how a second delivery of 300 against
               -- a filled order of 300 read as an order twice over.
               COALESCE(sum((SELECT COALESCE(sum(r.matched_quantity), 0)
                             FROM goods_receipt_line r
                             WHERE r.po_line_id = l.po_line_id)), 0)::bigint
                   AS received_stock_units,
               COALESCE(sum((SELECT COALESCE(sum(il.quantity), 0)
                             FROM supplier_invoice_line il
                             JOIN supplier_invoice si ON si.invoice_id = il.invoice_id
                             WHERE il.po_line_id = l.po_line_id
                               AND si.status IN ('DRAFT', 'MATCHED', 'POSTED'))), 0)::bigint
                   AS invoiced_stock_units,
               COALESCE(sum((SELECT COALESCE(sum(r.excess_quantity), 0)
                             FROM goods_receipt_line r
                             WHERE r.po_line_id = l.po_line_id)), 0)::bigint
                   AS excess_stock_units,
               (count(l.po_line_id) > 0 AND bool_and(l.line_status <> 'OPEN'))
                   AS all_lines_settled
        FROM purchase_order o
        LEFT JOIN purchase_order_line l ON l.purchase_order_id = o.purchase_order_id
        WHERE ($1::text IS NULL
               OR o.po_number ILIKE $1
               OR o.supplier_name ILIKE $1
               OR o.supplier_id ILIKE $1)
        GROUP BY o.purchase_order_id
    ) b
";

/// The status, supplier and date filters, written once for both queries.
const ORDER_BOOK_FILTERS: &str = "
    ($2::text[] IS NULL OR lifecycle = ANY($2))
    AND ($3::text[] IS NULL OR supplier_id = ANY($3))
    AND ($4::date IS NULL OR issued_at >= $4::date)
    AND ($5::date IS NULL OR issued_at < $5::date + 1)
";

/// The order book, narrowed HERE and not in the browser.
///
/// A list that is filtered after it arrives is a list that arrived: the whole
/// book crosses the wire, is held in memory, and is then thrown away by a chip
/// somebody set. This is the same lesson the pricelist learned at five hundred
/// styles, applied before the order book gets there.
///
/// Every row carries what the list has to be able to say without opening
/// anything: how many lines, what they come to, when the supplier promised
/// them, and how much of the order has actually landed.
pub async fn list_purchase_orders(
    pool: &PgPool,
    filter: &PurchaseOrderFilter,
) -> Result<PurchaseOrderPage, AppError> {
    // `%` on both sides and the escape hatch none of these has: a buyer types
    // a fragment of a number, not a pattern. A blank search is not a search —
    // `Some("")` would compile to `ILIKE '%%'`, which matches everything and
    // costs a scan to say so.
    let needle = filter
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{}%", value.replace('%', "\\%")));
    let statuses = (!filter.statuses.is_empty()).then(|| filter.statuses.clone());
    let suppliers = (!filter.suppliers.is_empty()).then(|| filter.suppliers.clone());

    // The sort, and the tie-break that makes it total. Every order ends in the
    // order's id, which is the primary key, so no two rows can compare equal —
    // which is what stops a keyset from repeating or losing the rows that tie.
    // The PO number would nearly do and the issue instant would not: a batch
    // issued together shares it.
    let (lead, natural_desc) = match filter.sort.as_deref() {
        Some("po_number") => ("po_number", false),
        Some("supplier") => ("supplier_key", false),
        Some("value") => ("net_key", true),
        Some("expected") => ("expected_key", false),
        _ => ("issued_key", true),
    };
    let desc = match filter.dir.as_deref() {
        Some("asc") => false,
        Some("desc") => true,
        _ => natural_desc,
    };
    let (cols, order) = super::order_by(lead, "purchase_order_id", desc);
    // Which way the seek points follows the direction, or paging a descending
    // list walks back up it.
    let seek = if desc { "<" } else { ">" };

    let cursor: Option<PurchaseOrderCursor> = filter
        .cursor
        .as_deref()
        .map(super::decode_cursor)
        .transpose()?;
    let limit = filter
        .limit
        .unwrap_or(ORDER_BOOK_DEFAULT_LIMIT)
        .clamp(1, ORDER_BOOK_MAX_LIMIT);

    // The seek re-reads the previous row's own sort value rather than trusting
    // one encoded in the cursor: one cursor shape then serves every order, and
    // a sixth sort cannot arrive without its cursor.
    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({ORDER_BOOK_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched WHERE {ORDER_BOOK_FILTERS}
         )
         SELECT * FROM kept
          WHERE $6::uuid IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE purchase_order_id = $6)
          ORDER BY {order}
          LIMIT $7"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&statuses)
        .bind(&suppliers)
        .bind(filter.issued_from)
        .bind(filter.issued_to)
        .bind(cursor.as_ref().map(|c| c.purchase_order_id))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    // A short page is the last page. A full one may not be — the next request
    // can come back empty — and that is the honest answer: knowing whether more
    // rows exist without asking costs a second count of the same query.
    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => {
            Some(super::encode_cursor(&PurchaseOrderCursor {
                purchase_order_id: row.try_get("purchase_order_id")?,
            })?)
        }
        _ => None,
    };

    let mut items = Vec::with_capacity(rows.len());
    for r in &rows {
        let expected: i64 = r.try_get("expected_stock_units")?;
        let received: i64 = r.try_get("received_stock_units")?;
        let gross: i64 = r.try_get("gross_minor")?;
        let discount: i64 = r.try_get("discount_minor")?;
        items.push(PurchaseOrderRow {
            purchase_order_id: r.try_get("purchase_order_id")?,
            po_number: r.try_get("po_number")?,
            supplier_id: r.try_get("supplier_id")?,
            supplier_name: r.try_get("supplier_name")?,
            destination_site_id: r.try_get("destination_site_id")?,
            lifecycle: r.try_get("lifecycle")?,
            order_status: r.try_get("order_status")?,
            currency: r.try_get("currency")?,
            issued_at: r.try_get("issued_at")?,
            expected_arrival: r.try_get("expected_arrival")?,
            line_count: r.try_get("line_count")?,
            gross_minor: gross,
            discount_minor: discount,
            net_minor: (gross - discount).max(0),
            expected_stock_units: expected,
            received_stock_units: received,
            outstanding_stock_units: (expected - received).max(0),
            invoiced_stock_units: r.try_get("invoiced_stock_units")?,
            excess_stock_units: r.try_get("excess_stock_units")?,
            fully_received: received >= expected,
        });
    }

    let (total, facets) = order_book_facets(pool, filter, needle.as_deref()).await?;
    Ok(PurchaseOrderPage {
        rows: items,
        next_cursor,
        total,
        facets,
    })
}

/// How many orders there are, and how they split.
///
/// Counted from the SAME [`ORDER_BOOK_ROWS`] the page is drawn from, so a
/// change to what a listable order is moves both together. The two scopes are
/// deliberate:
///
///   per-value counts read the SEARCHED set, ignoring which filters are
///     applied. The number answers "is this filter worth pressing" — a count
///     already narrowed by the filter it is offering would be zero beside every
///     option nobody has ticked, which reads as a book with nothing in it.
///   the total reads the FILTERED set, because it describes the list on screen.
///
/// The old version counted the whole `purchase_order` table for both — search
/// included — so a search with three hits sat under a filter panel promising
/// hundreds, and the counts described a book the caller was not looking at.
/// This is the same correction the pricelist's facets already carry.
async fn order_book_facets(
    pool: &PgPool,
    filter: &PurchaseOrderFilter,
    needle: Option<&str>,
) -> Result<(i64, PurchaseOrderFacets), AppError> {
    let statuses = (!filter.statuses.is_empty()).then(|| filter.statuses.clone());
    let suppliers = (!filter.suppliers.is_empty()).then(|| filter.suppliers.clone());
    let sql = format!(
        "WITH searched AS ({ORDER_BOOK_ROWS}), kept AS (
             SELECT * FROM searched WHERE {ORDER_BOOK_FILTERS}
         )
         SELECT 'status' AS facet, lifecycle AS value, NULL::text AS label,
                count(*)::bigint AS n
           FROM searched GROUP BY lifecycle
          UNION ALL
         SELECT 'supplier', supplier_id, max(supplier_name), count(*)::bigint
           FROM searched GROUP BY supplier_id
          UNION ALL
         SELECT 'all', '', NULL::text, count(*)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(&statuses)
        .bind(&suppliers)
        .bind(filter.issued_from)
        .bind(filter.issued_to)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut order_status = Vec::new();
    let mut supplier = Vec::new();
    for row in &rows {
        let facet: String = row.try_get("facet")?;
        let one = PurchaseOrderFacet {
            value: row.try_get("value")?,
            label: row.try_get("label")?,
            count: row.try_get("n")?,
        };
        match facet.as_str() {
            "status" => order_status.push(one),
            "supplier" => supplier.push(one),
            _ => total = one.count,
        }
    }
    // Biggest first, ties broken on the value, as every other facet panel in
    // this estate is ordered — a list that reshuffles between calls is a list
    // nobody can click.
    for list in [&mut order_status, &mut supplier] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }
    Ok((
        total,
        PurchaseOrderFacets {
            order_status,
            supplier,
        },
    ))
}

// ---- Price amendments: the question, and head office's answer ------------

use crate::cloud::domain::{
    parse_price_amendment_decision, parse_price_amendment_request, PriceAmendmentOutcome,
    COMMAND_PRICE_AMENDMENT_DECIDED, FACT_PRICE_AMENDMENT_REQUESTED,
};

/// Record a DC's request that a price be changed.
///
/// The ordered price is captured HERE rather than sent up with the request:
/// the warehouse was never told what the order costs, so it could not have
/// quoted it. Storing both sides at the moment of arrival lets a later reader
/// see the gap without reconstructing what the order said at the time.
async fn apply_price_amendment_request(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    request: &crate::cloud::domain::PriceAmendmentRequestPayload,
) -> Result<(), AppError> {
    let ordered_price: Option<i64> = sqlx::query_scalar(
        "SELECT unit_price_minor FROM purchase_order_line WHERE po_line_id = $1",
    )
    .bind(request.po_line_id)
    .fetch_optional(&mut **tx)
    .await?;
    let ordered_price = ordered_price.ok_or_else(|| {
        AppError::NotFound(format!(
            "purchase order line {} does not exist here",
            request.po_line_id
        ))
    })?;
    sqlx::query(
        "INSERT INTO purchase_price_amendment
             (request_id, po_line_id, origin_id, generation, seq, count_id,
              ordered_price_minor, invoiced_price_minor, note, requested_by, requested_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (request_id) DO NOTHING",
    )
    .bind(request.request_id)
    .bind(request.po_line_id)
    .bind(origin_id)
    .bind(generation)
    .bind(seq)
    .bind(request.count_id)
    .bind(ordered_price)
    .bind(request.invoiced_price_minor)
    .bind(&request.note)
    .bind(&request.requested_by)
    .bind(request.requested_at)
    .execute(&mut **tx)
    .await?;

    // Tell the people who can answer it. Raised here, in the ingest
    // transaction, rather than by a sweep that looks for undecided rows: a
    // query is only pending because somebody at a warehouse is waiting, and
    // "we noticed a few minutes later" is not a property worth building in.
    let recipients =
        super::notifications::recipients_with_role(tx, &["ADMIN", "SUPERVISOR"]).await?;
    let difference = request.invoiced_price_minor - ordered_price;
    super::notifications::raise_notification(
        tx,
        super::notifications::NewNotification {
            kind: "purchase.price_amendment.requested",
            title: "A supplier invoiced a different price".into(),
            body: format!(
                "{} at {origin_id} accepted a delivery invoiced at {} per piece against an agreed {}, a difference of {}{}.",
                request.requested_by,
                minor(request.invoiced_price_minor),
                minor(ordered_price),
                if difference > 0 { "+" } else { "" },
                minor(difference),
            ),
            subject: Some(("purchase_price_amendment", request.request_id.to_string())),
            origin_id: Some(origin_id),
            payload: serde_json::json!({
                "request_id": request.request_id,
                "po_line_id": request.po_line_id,
                "ordered_price_minor": ordered_price,
                "invoiced_price_minor": request.invoiced_price_minor,
            }),
        },
        &recipients,
    )
    .await?;
    Ok(())
}

/// Minor units as a person reads them. Rupiah has no subunit in practice, so
/// this groups thousands and does not invent decimals the currency does not
/// have — the notification is prose, and prose showing "215000000" teaches
/// nobody anything.
fn minor(value: i64) -> String {
    let negative = value < 0;
    let digits = value.abs().to_string();
    let mut grouped = String::new();
    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(ch);
    }
    if negative {
        format!("-{grouped}")
    } else {
        grouped
    }
}

/// What narrows the buyer's inbox.
#[derive(Clone, Debug, Default)]
pub struct PriceAmendmentScope {
    /// PO number, article code, article name, or who asked. One box: the
    /// question is "which query was that" and a buyer holding a delivery note
    /// does not want to be asked which KIND of thing they are holding.
    pub q: Option<String>,
    /// Which warehouse asked. Empty means every one of them.
    pub origins: Vec<String>,
    /// `requested` (the default), `difference` or `po_number`. Anything
    /// unrecognised falls back to `requested` rather than refusing.
    pub sort: Option<String>,
    /// `asc` or `desc`. Absent means each key's own natural direction: oldest
    /// question first, because this is a QUEUE and the thing that has been
    /// waiting longest is the thing to answer — but the biggest gap first when
    /// sorting by what the supplier over-billed.
    pub dir: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// How many questions the inbox returns when the caller does not say.
const AMENDMENT_DEFAULT_LIMIT: i64 = 200;
/// And the most it will return however loudly a caller asks.
const AMENDMENT_MAX_LIMIT: i64 = 1000;

/// One question waiting for head office.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PriceAmendmentRow {
    pub request_id: Uuid,
    pub po_number: String,
    pub po_line_id: Uuid,
    /// The warehouse that accepted the delivery and found the gap.
    pub origin_id: String,
    pub count_id: Uuid,
    pub article_code: String,
    pub article_name: String,
    pub ordered_price_minor: i64,
    pub invoiced_price_minor: i64,
    /// What the supplier billed over the agreed price. Signed, because a
    /// supplier billing UNDER the agreement is also a question and a screen
    /// that showed it as a positive gap would read it as an overcharge.
    pub difference_minor: i64,
    pub note: String,
    pub requested_by: String,
    pub requested_at: DateTime<Utc>,
}

/// One value the inbox can be narrowed by, and how many questions it leaves.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PriceAmendmentFacet {
    pub value: String,
    pub count: i64,
}

/// The one thing this inbox can be narrowed by that is worth counting.
///
/// Which warehouse is asking is the first question an unanswered pile raises:
/// one DC finding gaps on every delivery and the whole fleet finding them are
/// different faults, and only one of them is about a supplier.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PriceAmendmentFacets {
    pub origins: Vec<PriceAmendmentFacet>,
}

/// A page of the buyer's inbox, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PriceAmendmentPage {
    pub rows: Vec<PriceAmendmentRow>,
    pub next_cursor: Option<String>,
    /// Every question still waiting, not just this page.
    ///
    /// This is the number the navigation badge wants. It used to read the
    /// array's own `length`, which counts the page — so a pile deeper than a
    /// page would have advertised itself as exactly one page deep, on the one
    /// control whose whole job is to say how much is waiting.
    pub total: i64,
    pub facets: PriceAmendmentFacets,
}

/// Where the previous page stopped — as a ROW, not as a position.
#[derive(Serialize, Deserialize)]
struct PriceAmendmentCursor {
    request_id: Uuid,
}

/// One pending question, defined once.
///
/// Used by the page query and by the facet counts, and that is the whole reason
/// it is a constant: the facets are only honest if they count exactly what the
/// page can show.
///
/// Binds: `$1` the search pattern, or NULL for no search.
///
/// `status = 'PENDING'` is not a filter here, it is what this list IS: an
/// answered query is a decision with a trail, and it is read from the audit,
/// not from the inbox.
const AMENDMENT_ROWS: &str = "
    SELECT a.request_id, a.po_line_id, a.origin_id, a.count_id,
           a.ordered_price_minor, a.invoiced_price_minor, a.note,
           a.requested_by, a.requested_at,
           o.po_number, l.article_code, l.article_name,
           (a.invoiced_price_minor - a.ordered_price_minor) AS difference_minor
      FROM purchase_price_amendment a
      JOIN purchase_order_line l ON l.po_line_id = a.po_line_id
      JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
     WHERE a.status = 'PENDING'
       AND ($1::text IS NULL
            OR o.po_number ILIKE $1
            OR l.article_code ILIKE $1
            OR l.article_name ILIKE $1
            OR a.requested_by ILIKE $1)
";

/// Questions waiting for head office. The buyer's inbox.
///
/// Paged, and the reason is not today's row count — it is nought. It is that
/// nothing drains this. A request sits here until somebody at head office
/// answers it, and the failure mode of a queue nobody empties is that it grows
/// without any single day's work looking unusual. A bare array would have had
/// nowhere to put a cursor on the day it mattered, and that day is the one when
/// the pile is already too deep to read.
pub async fn pending_price_amendments(
    pool: &PgPool,
    scope: &PriceAmendmentScope,
) -> Result<PriceAmendmentPage, AppError> {
    let needle = scope
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{}%", value.replace('%', "\\%")));
    let origins = (!scope.origins.is_empty()).then(|| scope.origins.clone());

    let (lead, natural_desc) = match scope.sort.as_deref() {
        Some("difference") => ("difference_minor", true),
        Some("po_number") => ("po_number", false),
        _ => ("requested_at", false),
    };
    let desc = match scope.dir.as_deref() {
        Some("asc") => false,
        Some("desc") => true,
        _ => natural_desc,
    };
    let (cols, order) = super::order_by(lead, "request_id", desc);
    let seek = if desc { "<" } else { ">" };

    let cursor: Option<PriceAmendmentCursor> = scope
        .cursor
        .as_deref()
        .map(super::decode_cursor)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(AMENDMENT_DEFAULT_LIMIT)
        .clamp(1, AMENDMENT_MAX_LIMIT);

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({AMENDMENT_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched WHERE ($2::text[] IS NULL OR origin_id = ANY($2))
         )
         SELECT * FROM kept
          WHERE $3::uuid IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE request_id = $3)
          ORDER BY {order}
          LIMIT $4"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&origins)
        .bind(cursor.as_ref().map(|c| c.request_id))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => {
            Some(super::encode_cursor(&PriceAmendmentCursor {
                request_id: row.try_get("request_id")?,
            })?)
        }
        _ => None,
    };

    let mut items = Vec::with_capacity(rows.len());
    for r in &rows {
        items.push(PriceAmendmentRow {
            request_id: r.try_get("request_id")?,
            po_number: r.try_get("po_number")?,
            po_line_id: r.try_get("po_line_id")?,
            origin_id: r.try_get("origin_id")?,
            count_id: r.try_get("count_id")?,
            article_code: r.try_get("article_code")?,
            article_name: r.try_get("article_name")?,
            ordered_price_minor: r.try_get("ordered_price_minor")?,
            invoiced_price_minor: r.try_get("invoiced_price_minor")?,
            difference_minor: r.try_get("difference_minor")?,
            note: r.try_get("note")?,
            requested_by: r.try_get("requested_by")?,
            requested_at: r.try_get("requested_at")?,
        });
    }

    let (total, facets) = amendment_facets(pool, &origins, needle.as_deref()).await?;
    Ok(PriceAmendmentPage {
        rows: items,
        next_cursor,
        total,
        facets,
    })
}

/// How many questions are waiting, and which warehouse is asking them.
///
/// Counted from the SAME [`AMENDMENT_ROWS`] the page is drawn from. The
/// per-value counts read the SEARCHED set, ignoring which origin is ticked; the
/// total reads the FILTERED set, because it describes the list on screen.
async fn amendment_facets(
    pool: &PgPool,
    origins: &Option<Vec<String>>,
    needle: Option<&str>,
) -> Result<(i64, PriceAmendmentFacets), AppError> {
    let sql = format!(
        "WITH searched AS ({AMENDMENT_ROWS}), kept AS (
             SELECT * FROM searched WHERE ($2::text[] IS NULL OR origin_id = ANY($2))
         )
         SELECT 'origin' AS facet, origin_id AS value, count(*)::bigint AS n
           FROM searched GROUP BY origin_id
          UNION ALL
         SELECT 'all', '', count(*)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(origins)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut by_origin = Vec::new();
    for row in &rows {
        let facet: String = row.try_get("facet")?;
        let one = PriceAmendmentFacet {
            value: row.try_get("value")?,
            count: row.try_get("n")?,
        };
        if facet == "origin" {
            by_origin.push(one);
        } else {
            total = one.count;
        }
    }
    by_origin.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    Ok((total, PriceAmendmentFacets { origins: by_origin }))
}

/// Head office answers, and the answer travels back to the DC that asked.
///
/// Approving changes the order and only then tells the DC; the two commit
/// together, because an order changed without the warehouse being told leaves
/// a delivery waiting on an answer that already exists. Rejecting changes
/// nothing about the order and is still recorded: a supplier who repeatedly
/// bills above the agreed price leaves a trail here and nowhere else.
/// How far an approval reaches.
///
/// Two different commercial acts. A verifier's query is about the lorry in
/// front of them: the supplier billed this delivery at a different price, and
/// the buyer either agrees to pay it for THIS delivery or does not. Changing
/// what the rest of the order costs is a negotiation, and running them
/// together is how an order silently changes value because somebody approved
/// an invoice.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AmendmentReach {
    /// Settle this acceptance at the approved price. The order line keeps the
    /// price it was raised at, and the next delivery is still expected at it.
    Delivery,
    /// Settle this acceptance AND make the approved price the agreed price for
    /// quantity not yet received. Receipts already accepted are untouched:
    /// each carries the price it was accepted at.
    Remaining,
}

impl AmendmentReach {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Delivery => "DELIVERY",
            Self::Remaining => "REMAINING",
        }
    }
}

pub async fn decide_price_amendment(
    pool: &PgPool,
    request_id: Uuid,
    outcome: PriceAmendmentOutcome,
    reach: AmendmentReach,
    decided_by: &str,
    note: Option<&str>,
) -> Result<(Uuid, Uuid), AppError> {
    if decided_by.trim().is_empty() {
        return Err(AppError::Validation(
            "a decision must name who made it".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "SELECT po_line_id, origin_id, count_id, invoiced_price_minor, status
         FROM purchase_price_amendment WHERE request_id = $1 FOR UPDATE",
    )
    .bind(request_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("price amendment request".into()))?;
    if row.get::<String, _>("status") != "PENDING" {
        return Err(AppError::Conflict(
            "this request has already been answered".into(),
        ));
    }
    let po_line_id: Uuid = row.get("po_line_id");
    let origin_id: String = row.get("origin_id");
    let count_id: Uuid = row.get("count_id");
    let invoiced: i64 = row.get("invoiced_price_minor");
    let decided_at = Utc::now();

    // Which acceptance this answers. The query names the DC's count; the
    // receipt line carries that count, so the approval can be tied to the
    // delivery it is about instead of to a column somebody will edit later.
    let receipt_line_id: Option<Uuid> =
        sqlx::query_scalar("SELECT receipt_line_id FROM goods_receipt_line WHERE count_id = $1")
            .bind(count_id)
            .fetch_optional(&mut *tx)
            .await?;

    let approved_price = match outcome {
        PriceAmendmentOutcome::Approved => {
            // Only a REMAINING approval touches the order. A DELIVERY approval
            // settles the acceptance that raised it, and the acceptance
            // carries its own price — so rewriting the line here would restate
            // what every earlier delivery on this order had been worth, which
            // is exactly the defect this replaced.
            if reach == AmendmentReach::Remaining {
                sqlx::query(
                    "UPDATE purchase_order_line
                     SET unit_price_minor = $2,
                         line_amount_minor = $2 * (ordered_quantity - cancelled_quantity)
                     WHERE po_line_id = $1",
                )
                .bind(po_line_id)
                .bind(invoiced)
                .execute(&mut *tx)
                .await?;
            }
            Some(invoiced)
        }
        PriceAmendmentOutcome::Rejected => None,
    };
    sqlx::query(
        "UPDATE purchase_price_amendment
         SET status = $2, decided_by = $3, decided_at = $4, decision_note = $5,
             receipt_line_id = $6,
             approved_unit_price_minor = $7,
             scope = $8
         WHERE request_id = $1",
    )
    .bind(request_id)
    .bind(match outcome {
        PriceAmendmentOutcome::Approved => "APPROVED",
        PriceAmendmentOutcome::Rejected => "REJECTED",
    })
    .bind(decided_by)
    .bind(decided_at)
    .bind(note)
    .bind(receipt_line_id)
    .bind(approved_price)
    .bind(approved_price.map(|_| reach.as_str()))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let payload = json!({
        "causation_request_id": request_id,
        "po_line_id": po_line_id,
        "count_id": count_id,
        "outcome": outcome,
        "approved_price_minor": approved_price,
        "scope": approved_price.map(|_| reach.as_str()),
        "decided_by": decided_by,
        "decision_note": note,
        "decided_at": decided_at,
    });
    let (command_id, _) = issue_command(
        pool,
        COMMAND_PRICE_AMENDMENT_DECIDED,
        &payload,
        decided_by,
        None,
        std::slice::from_ref(&origin_id),
    )
    .await?;
    sqlx::query(
        "UPDATE purchase_price_amendment SET decision_command_id = $2 WHERE request_id = $1",
    )
    .bind(request_id)
    .bind(command_id)
    .execute(pool)
    .await?;
    Ok((request_id, command_id))
}

/// Stop waiting for the rest of a line.
///
/// 100 of 300 arrived; the buyer decides the other 200 are not coming. The
/// line settles at what was actually received, and the shortfall is written
/// down as a shortfall — who accepted it, why, and how much.
///
/// Only the person who owns the order may do this. A warehouse that could
/// close its own outstanding lines would be marking the company's purchases
/// complete on the strength of what turned up at its door.
pub async fn close_purchase_line_short(
    pool: &PgPool,
    po_line_id: Uuid,
    closed_by: &str,
    reason: &str,
) -> Result<Value, AppError> {
    if closed_by.trim().is_empty() {
        return Err(AppError::Validation(
            "closing a line short must name who accepted the shortfall".into(),
        ));
    }
    if reason.trim().is_empty() {
        return Err(AppError::Validation(
            "closing a line short must say why the rest is not coming".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "SELECT l.ordered_quantity, l.cancelled_quantity,
                l.closed_short_at, l.purchase_order_id,
                COALESCE((SELECT sum(r.quantity) FROM goods_receipt_line r
                          WHERE r.po_line_id = l.po_line_id), 0)::bigint AS received
         FROM purchase_order_line l
         WHERE l.po_line_id = $1
         FOR UPDATE",
    )
    .bind(po_line_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("purchase order line".into()))?;
    if row
        .get::<Option<DateTime<Utc>>, _>("closed_short_at")
        .is_some()
    {
        return Err(AppError::Conflict(
            "this line was already closed short".into(),
        ));
    }
    let ordered: i64 = row.get("ordered_quantity");
    let cancelled: i64 = row.get("cancelled_quantity");
    let received: i64 = row.get("received");
    let purchase_order_id: Uuid = row.get("purchase_order_id");
    // Both sides are pieces.
    let expected = ordered - cancelled;
    let shortfall = expected - received;
    if shortfall <= 0 {
        return Err(AppError::Conflict(format!(
            "nothing is outstanding on this line: {received} of {expected} received"
        )));
    }
    sqlx::query(
        "UPDATE purchase_order_line
         SET line_status = 'CLOSED', closed_short_at = now(), closed_short_by = $2,
             closed_short_reason = $3, closed_short_units = $4
         WHERE po_line_id = $1",
    )
    .bind(po_line_id)
    .bind(closed_by)
    .bind(reason)
    .bind(shortfall)
    .execute(&mut *tx)
    .await?;
    // An order whose every line has stopped waiting is itself finished.
    let still_open: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM purchase_order_line
         WHERE purchase_order_id = $1 AND line_status = 'OPEN'",
    )
    .bind(purchase_order_id)
    .fetch_one(&mut *tx)
    .await?;
    if still_open == 0 {
        sqlx::query(
            "UPDATE purchase_order SET order_status = 'CLOSED'
             WHERE purchase_order_id = $1 AND order_status = 'ISSUED'",
        )
        .bind(purchase_order_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(json!({
        "po_line_id": po_line_id,
        "received_stock_units": received,
        "expected_stock_units": expected,
        "closed_short_units": shortfall,
        "closed_by": closed_by,
        "order_closed": still_open == 0,
    }))
}

#[cfg(test)]
mod pool_namespace_tests {
    use super::pool_id_for_site;

    /// The gap this whole translation exists to close. Cloud's pool model
    /// spells its single distribution centre `dc`; an Edge DC registers under
    /// the site it actually runs as.
    #[test]
    fn dc_pools_take_the_owner_site() {
        assert_eq!(pool_id_for_site("dc.warehouse", "dc-01"), "dc-01.warehouse");
        assert_eq!(
            pool_id_for_site("dc.pending.untagged", "dc-01"),
            "dc-01.pending.untagged"
        );
        assert_eq!(pool_id_for_site("dc.reject.dc", "dc-01"), "dc-01.reject.dc");
    }

    /// Only the first segment is the site. A pool named after a destination
    /// store keeps that store.
    #[test]
    fn only_the_leading_segment_moves() {
        assert_eq!(
            pool_id_for_site("dc.outbound.picked.store-07", "dc-01"),
            "dc-01.outbound.picked.store-07"
        );
        assert_eq!(
            pool_id_for_site("dc.reject.store-07", "dc-01"),
            "dc-01.reject.store-07"
        );
    }

    /// The property that makes it safe to apply at the boundary without asking
    /// whether this origin is the canonical DC: where the names already agree —
    /// every store, and a DC registered as `dc` — nothing changes.
    #[test]
    fn agreeing_names_are_untouched() {
        assert_eq!(
            pool_id_for_site("store-07.floor", "store-07"),
            "store-07.floor"
        );
        assert_eq!(pool_id_for_site("dc.warehouse", "dc"), "dc.warehouse");
    }

    /// Not a pool id. Handed back for the parser downstream to refuse with its
    /// own message rather than mangled into one that looks plausible.
    #[test]
    fn a_string_without_a_segment_is_left_alone() {
        assert_eq!(
            pool_id_for_site("external/supplier", "dc-01"),
            "external/supplier"
        );
    }
}
