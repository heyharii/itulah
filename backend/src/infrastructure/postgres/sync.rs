//! PostgreSQL adapter for the ordered sync engine.
//!
//! Storage only: every protocol decision (what a response does to the
//! watermark, when the breaker opens, what gets rejected) lives in
//! `domain::sync`. This module knows transactions, locks and rows.

use super::payload_digest;
use crate::application::AppError;
use crate::domain::{
    cooldown_after_failure, ingest_rejection_reason, BreakerPolicy, IngestBatch, IngestResponse,
    MovementCommand, RejectedFact, SyncFact,
};
use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
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
    let mut rejected = Vec::new();
    for fact in facts {
        if fact.seq <= durable {
            continue;
        }
        if fact.seq > durable + 1 {
            break;
        }
        let already_held = sqlx::query("SELECT 1 FROM sync_ingest_fact WHERE event_id = $1")
            .bind(fact.event_id)
            .fetch_optional(&mut *tx)
            .await?
            .is_some();
        if already_held {
            durable = fact.seq;
            continue;
        }
        let (status, reason) = match ingest_rejection_reason(fact) {
            Some(reason) => ("REJECTED", Some(reason)),
            None => ("ACCEPTED", None),
        };
        sqlx::query(
            "INSERT INTO sync_ingest_fact
                 (origin_id, generation, seq, event_id, event_type, payload, status, reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (origin_id, generation, seq) DO NOTHING",
        )
        .bind(&batch.origin_id)
        .bind(batch.generation)
        .bind(fact.seq)
        .bind(fact.event_id)
        .bind(&fact.event_type)
        .bind(&fact.payload)
        .bind(status)
        .bind(&reason)
        .execute(&mut *tx)
        .await?;
        if let Some(reason) = reason {
            rejected.push(RejectedFact {
                seq: fact.seq,
                reason,
            });
        }
        durable = fact.seq;
    }
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
    Ok(IngestResponse {
        durable_through: durable,
        rejected,
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
    let dead_letter_count =
        sqlx::query("SELECT count(*)::bigint AS count FROM sync_dead_letter")
            .fetch_one(pool)
            .await?
            .get("count");
    let ingest_streams = sqlx::query(
        "SELECT w.origin_id, w.generation, w.durable_seq, w.last_received_at,
                (SELECT count(*)::bigint FROM sync_ingest_fact f
                 WHERE f.origin_id = w.origin_id AND f.generation = w.generation
                   AND f.status = 'REJECTED') AS rejected_count
         FROM sync_ingest_watermark w
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
pub async fn list_dead_letters(pool: &PgPool, limit: i64) -> Result<Value, AppError> {
    let rows = sqlx::query(
        "SELECT origin_id, generation, seq, event_id, event_type, payload, reason, rejected_at
         FROM sync_dead_letter ORDER BY rejected_at DESC LIMIT $1",
    )
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await?;
    let items: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "origin_id": r.get::<String, _>("origin_id"),
                "generation": r.get::<i64, _>("generation"),
                "seq": r.get::<i64, _>("seq"),
                "event_id": r.get::<Uuid, _>("event_id"),
                "event_type": r.get::<String, _>("event_type"),
                "payload": r.get::<Value, _>("payload"),
                "reason": r.get::<String, _>("reason"),
                "rejected_at": r.get::<DateTime<Utc>, _>("rejected_at"),
            })
        })
        .collect();
    Ok(json!({ "items": items }))
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
    if breaker_open || backlog_stale {
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
