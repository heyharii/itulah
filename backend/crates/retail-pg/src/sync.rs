//! PostgreSQL adapter for the ordered sync engine.
//!
//! Storage only: every protocol decision (what a response does to the
//! watermark, when the breaker opens, what gets rejected) lives in
//! `domain::sync`. This module knows transactions, locks and rows.

use super::payload_digest;
use retail_app::AppError;
use retail_domain::{
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
    if origin_id.trim().is_empty() {
        return Err(AppError::Validation("origin_id must not be empty".into()));
    }
    if ingest_key.len() < 8 {
        return Err(AppError::Validation(
            "ingest_key must be at least 8 characters".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO sync_origin_credential (origin_id, ingest_key_sha256, label)
         VALUES ($1, $2, $3)
         ON CONFLICT (origin_id) DO UPDATE SET
             ingest_key_sha256 = EXCLUDED.ingest_key_sha256,
             label = COALESCE(EXCLUDED.label, sync_origin_credential.label),
             rotated_at = now()",
    )
    .bind(origin_id.trim())
    .bind(sha256_hex(ingest_key))
    .bind(label)
    .execute(pool)
    .await?;
    Ok(())
}

/// The stored key digest for an origin, if it is registered.
pub async fn origin_credential_digest(
    pool: &PgPool,
    origin_id: &str,
) -> Result<Option<String>, AppError> {
    let row = sqlx::query("SELECT ingest_key_sha256 FROM sync_origin_credential WHERE origin_id = $1")
        .bind(origin_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.get("ingest_key_sha256")))
}

/// Constant-shape comparison of a presented key against the stored digest.
pub fn ingest_key_matches(stored_digest: &str, presented_key: &str) -> bool {
    sha256_hex(presented_key) == stored_digest
}

/// Registered origins for the operator — never exposes key material.
pub async fn list_origin_credentials(pool: &PgPool) -> Result<Value, AppError> {
    let rows = sqlx::query(
        "SELECT origin_id, label, created_at, rotated_at
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
                "created_at": r.get::<DateTime<Utc>, _>("created_at"),
                "rotated_at": r.get::<Option<DateTime<Utc>>, _>("rotated_at"),
            })
        })
        .collect();
    Ok(json!({ "items": items }))
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
    /// Nothing left below the receipt watermark.
    Drained,
    /// One fact handled and the applied prefix advanced.
    Advanced { applied_movement: bool },
    /// The fact at `seq` cannot be applied; the stream stops here (and will
    /// retry from the same seq next pass — blocking is observability, not a
    /// terminal state).
    Blocked { seq: i64, reason: String },
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
    .map(|r| (r.get("origin_id"), r.get("generation"), r.get("durable_seq")))
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
                ApplyStep::Advanced { applied_movement } => {
                    if applied_movement {
                        report.applied += 1;
                    } else {
                        report.skipped += 1;
                    }
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
        "SELECT event_type, payload, status FROM sync_ingest_fact
         WHERE origin_id = $1 AND generation = $2 AND seq = $3",
    )
    .bind(origin_id)
    .bind(generation)
    .bind(next)
    .fetch_optional(&mut *tx)
    .await?;
    let applied_movement = match fact {
        // A receipt-less seq (duplicate advanced by event-id, or purged after
        // application elsewhere) or a rejection tombstone: nothing to apply.
        None => false,
        Some(row) if row.get::<String, _>("status") == "REJECTED" => false,
        Some(row) => {
            let event_type: String = row.get("event_type");
            if event_type != "inventory.movement" {
                // Unknown types pass through: the receipt log still holds
                // them for a future applier that understands them.
                tracing::warn!(origin_id, generation, seq = next, %event_type,
                    "sync apply: unknown event_type passed through");
                false
            } else {
                let payload: Value = row.get("payload");
                let fact = match retail_domain::parse_movement_fact(&payload) {
                    Ok(fact) => fact,
                    Err(reason) => return Ok(ApplyStep::Blocked { seq: next, reason }),
                };
                match apply_movement(&mut tx, origin_id, generation, next, &fact).await {
                    Ok(applied) => applied,
                    Err(error) => {
                        // The transaction rolls back on drop; the block is
                        // recorded outside it by the caller.
                        return Ok(ApplyStep::Blocked {
                            seq: next,
                            reason: error.to_string(),
                        });
                    }
                }
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
    .bind(next)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(ApplyStep::Advanced { applied_movement })
}

/// Replay one movement fact into the local ledger. Returns `false` when the
/// movement group already exists (single-database demo, or a replayed
/// stream) — idempotence by the group's stable id.
async fn apply_movement(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    fact: &retail_domain::MovementFactPayload,
) -> Result<bool, AppError> {
    let exists = sqlx::query("SELECT 1 FROM movement_group WHERE id = $1")
        .bind(fact.movement_group_id)
        .fetch_optional(&mut **tx)
        .await?
        .is_some();
    if exists {
        return Ok(false);
    }
    let idempotency_key = format!("sync:{origin_id}:{generation}:{seq}");
    let digest = fact.payload_digest.clone().unwrap_or_default();
    sqlx::query(
        "INSERT INTO movement_group
             (id, cause, reason, reference_type, reference_id, actor_id,
              idempotency_key, payload_digest, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(fact.movement_group_id)
    .bind(&fact.cause)
    .bind(&fact.reason)
    .bind(&fact.reference_type)
    .bind(&fact.reference_id)
    .bind(&fact.actor_id)
    .bind(&idempotency_key)
    .bind(&digest)
    .bind(fact.occurred_at)
    .execute(&mut **tx)
    .await?;
    for line in &fact.lines {
        let from: retail_domain::Place = line
            .from_place_id
            .parse()
            .map_err(|e: retail_domain::PlaceError| AppError::Validation(e.to_string()))?;
        let to: retail_domain::Place = line
            .to_place_id
            .parse()
            .map_err(|e: retail_domain::PlaceError| AppError::Validation(e.to_string()))?;
        sqlx::query(
            "INSERT INTO movement
                 (movement_id, movement_group_id, subject_id, quantity,
                  from_place_id, to_place_id, cause, reference_type, reference_id,
                  idempotency_key, payload_digest, actor_id, occurred_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        )
        .bind(Uuid::new_v4())
        .bind(fact.movement_group_id)
        .bind(line.subject_id)
        .bind(line.quantity)
        .bind(&line.from_place_id)
        .bind(&line.to_place_id)
        .bind(&fact.cause)
        .bind(&fact.reference_type)
        .bind(&fact.reference_id)
        .bind(&idempotency_key)
        .bind(&digest)
        .bind(&fact.actor_id)
        .bind(fact.occurred_at)
        .execute(&mut **tx)
        .await?;
        super::refresh_projection_position(tx, line.subject_id, &from).await?;
        super::refresh_projection_position(tx, line.subject_id, &to).await?;
    }
    Ok(true)
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

/// Receiver-side retention: receipt rows both applied and old may go. Dedup
/// of very-late resends survives the purge because it keys on the ingest
/// WATERMARK (`seq <= durable_seq` is skipped), not on the receipt rows.
pub async fn purge_applied_ingest(pool: &PgPool, retention_days: i64) -> Result<u64, AppError> {
    let result = sqlx::query(
        "DELETE FROM sync_ingest_fact f
         USING sync_applied_watermark a
         WHERE a.origin_id = f.origin_id AND a.generation = f.generation
           AND f.seq <= a.applied_seq
           AND f.received_at < now() - make_interval(days => $1::int)",
    )
    .bind(retention_days.max(0) as i32)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}
