//! The receiver's half of the generation handshake, and what it noticed.
//!
//! Storage only, like every adapter here: [`crate::cloud::domain::plan_handshake`]
//! decides which generation a sender may write into, and this module reads the
//! two numbers that decision needs and durably applies its consequences.
//!
//! # Why this is a separate file
//!
//! `postgres/sync.rs` is six thousand lines of table ingestion that several
//! sessions edit at once. Watermark and generation are a different subject
//! with a different blast radius: everything here is about WHOSE seqs these
//! are, and nothing here interprets a fact's payload.
//!
//! # The names
//!
//! `postgres/mod.rs` re-exports every submodule with `pub use x::*`, so a name
//! that reads well in isolation collides in the flattened namespace and the
//! compiler blames the wrong file. Everything public here starts with `sync_`.

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    plan_handshake, HandshakeAgreement, HandshakeRequest, LocalStream, OriginHorizon,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};

/// A sender was moved to a new generation because the one it proposed would
/// have written into seqs already acknowledged.
pub const SYNC_ALERT_GENERATION_ROTATED: &str = "generation_rotated";

/// A batch arrived entirely at or below the watermark with nothing to replay.
/// The sender's database is not the one that wrote this stream.
pub const SYNC_ALERT_BELOW_WATERMARK: &str = "batch_below_watermark";

/// What the receiver holds for one origin at a proposed generation.
///
/// `highest_generation` deliberately takes the greater of what has actually
/// been received and what the origin's credential says is active. The
/// credential's `active_generation` fences inventory facts, so a handshake
/// that rotated above the received generations but below the credential would
/// hand a shop a generation whose every inventory fact is then refused —
/// trading a silent loss for a loud stall.
pub async fn sync_origin_horizon(
    pool: &PgPool,
    origin_id: &str,
    proposed_generation: i64,
) -> Result<OriginHorizon, AppError> {
    let mut tx = pool.begin().await?;
    let horizon = sync_origin_horizon_tx(&mut tx, origin_id, proposed_generation).await?;
    tx.commit().await?;
    Ok(horizon)
}

async fn sync_origin_horizon_tx(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    proposed_generation: i64,
) -> Result<OriginHorizon, AppError> {
    let row = sqlx::query(
        "SELECT
             GREATEST(
                 COALESCE((SELECT max(generation) FROM sync_ingest_watermark WHERE origin_id = $1), 0),
                 COALESCE((SELECT active_generation FROM sync_origin_credential WHERE origin_id = $1), 0)
             ) AS highest_generation,
             COALESCE(
                 (SELECT durable_seq FROM sync_ingest_watermark
                  WHERE origin_id = $1 AND generation = $2),
                 0
             ) AS durable_through",
    )
    .bind(origin_id)
    .bind(proposed_generation)
    .fetch_one(&mut **tx)
    .await?;
    Ok(OriginHorizon {
        highest_generation: row.get("highest_generation"),
        durable_through: row.get("durable_through"),
    })
}

/// Decide, and durably commit, which generation this sender may write into.
///
/// The whole exchange is one transaction because the three effects of a
/// rotation have to be one fact: the watermark row that opens the new stream,
/// the credential fence that lets its inventory facts through, and the alert
/// that tells a person a shop's database was replaced. A crash between any two
/// of those leaves a shop uploading into a generation the cloud will refuse,
/// which is the stall this design exists to avoid.
pub async fn sync_negotiate_generation(
    pool: &PgPool,
    request: &HandshakeRequest,
) -> Result<HandshakeAgreement, AppError> {
    if request.origin_id.trim().is_empty() || request.generation < 1 || request.next_seq < 0 {
        return Err(AppError::Validation(
            "handshake requires origin_id, generation >= 1 and next_seq >= 0".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    // Serialize against a concurrent handshake for the same origin. Two tills
    // restored at once must not both be told "generation 2".
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1))")
        .bind(&request.origin_id)
        .execute(&mut *tx)
        .await?;
    let horizon = sync_origin_horizon_tx(&mut tx, &request.origin_id, request.generation).await?;
    let plan = plan_handshake(
        LocalStream {
            generation: request.generation,
            next_seq: request.next_seq,
        },
        horizon,
    );
    let agreement = plan.agreement(horizon);

    // Open the stream on the receiver's side. Doing it here rather than
    // leaving it to the first upload means the operator screen can show a
    // rotated origin before its first fact arrives — which is precisely the
    // window in which somebody wants to look.
    sqlx::query(
        "INSERT INTO sync_ingest_watermark (origin_id, generation)
         VALUES ($1, $2) ON CONFLICT (origin_id, generation) DO NOTHING",
    )
    .bind(&request.origin_id)
    .bind(agreement.generation)
    .execute(&mut *tx)
    .await?;

    if agreement.rotated {
        // Move the inventory fence up with the stream. Only for an origin that
        // has a credential row: an unregistered origin has no fence to move.
        sqlx::query(
            "UPDATE sync_origin_credential
             SET active_generation = $2
             WHERE origin_id = $1 AND active_generation < $2",
        )
        .bind(&request.origin_id)
        .bind(agreement.generation)
        .execute(&mut *tx)
        .await?;
        let detail = agreement.reason.clone().unwrap_or_else(|| {
            format!(
                "moved from generation {} to {}",
                request.generation, agreement.generation
            )
        });
        sync_raise_integrity_alert_tx(
            &mut tx,
            &request.origin_id,
            agreement.generation,
            SYNC_ALERT_GENERATION_ROTATED,
            &detail,
            Some(horizon.durable_through),
        )
        .await?;
        tracing::warn!(
            origin = %request.origin_id,
            proposed = request.generation,
            granted = agreement.generation,
            durable_through = horizon.durable_through,
            "sync origin rotated to a new generation; its database was replaced"
        );
    }
    tx.commit().await?;
    Ok(agreement)
}

/// Record an observation about a stream where a person can find it.
///
/// One open row per (origin, generation, kind): a till retrying every five
/// seconds must not write twelve rows a minute, so a repeat bumps the counter
/// and the timestamp. Acknowledging closes the row and lets the next
/// occurrence open a fresh one — deliberately, because "it happened again
/// after we thought it was fixed" is the thing worth being told.
pub async fn sync_raise_integrity_alert(
    pool: &PgPool,
    origin_id: &str,
    generation: i64,
    kind: &str,
    detail: &str,
    watermark_seq: Option<i64>,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    sync_raise_integrity_alert_tx(&mut tx, origin_id, generation, kind, detail, watermark_seq)
        .await?;
    tx.commit().await?;
    Ok(())
}

async fn sync_raise_integrity_alert_tx(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    kind: &str,
    detail: &str,
    watermark_seq: Option<i64>,
) -> Result<(), AppError> {
    let updated = sqlx::query(
        "UPDATE sync_integrity_alert
         SET occurrences = occurrences + 1,
             last_seen_at = now(),
             detail = $4,
             watermark_seq = COALESCE($5, watermark_seq)
         WHERE origin_id = $1 AND generation = $2 AND kind = $3
           AND acknowledged_at IS NULL",
    )
    .bind(origin_id)
    .bind(generation)
    .bind(kind)
    .bind(detail)
    .bind(watermark_seq)
    .execute(&mut **tx)
    .await?;
    if updated.rows_affected() > 0 {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO sync_integrity_alert
             (origin_id, generation, kind, detail, watermark_seq)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING",
    )
    .bind(origin_id)
    .bind(generation)
    .bind(kind)
    .bind(detail)
    .bind(watermark_seq)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Close one alert. A person did something about it and says so.
pub async fn sync_acknowledge_integrity_alert(
    pool: &PgPool,
    id: i64,
    acknowledged_by: &str,
) -> Result<(), AppError> {
    if acknowledged_by.trim().is_empty() {
        return Err(AppError::Validation(
            "acknowledging an integrity alert requires a name".into(),
        ));
    }
    let done = sqlx::query(
        "UPDATE sync_integrity_alert
         SET acknowledged_at = now(), acknowledged_by = $2
         WHERE id = $1 AND acknowledged_at IS NULL",
    )
    .bind(id)
    .bind(acknowledged_by.trim())
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "no open sync integrity alert {id}"
        )));
    }
    Ok(())
}

/// Every origin the cloud knows, with where its stream stands.
///
/// One row per origin rather than per (origin, generation): an operator asks
/// "is this shop's till reaching me", not "what happened in generation 3". The
/// generation shown is the one currently being received, its watermark, when a
/// fact last arrived, and any alert nobody has closed.
///
/// Origins that were never registered still appear when they have uploaded —
/// an unregistered origin sending facts is exactly the thing worth seeing.
pub async fn sync_origins_list(pool: &PgPool) -> Result<Value, AppError> {
    let rows = sqlx::query(
        "WITH latest AS (
             SELECT DISTINCT ON (origin_id)
                    origin_id, generation, durable_seq, last_received_at
             FROM sync_ingest_watermark
             ORDER BY origin_id, generation DESC
         ),
         applied AS (
             SELECT DISTINCT ON (origin_id) origin_id, generation, applied_seq
             FROM sync_applied_watermark
             ORDER BY origin_id, generation DESC
         ),
         alerts AS (
             SELECT origin_id,
                    count(*) AS open_alerts,
                    sum(occurrences) AS occurrences,
                    max(last_seen_at) AS last_alert_at,
                    (array_agg(kind ORDER BY last_seen_at DESC))[1] AS latest_kind,
                    (array_agg(detail ORDER BY last_seen_at DESC))[1] AS latest_detail
             FROM sync_integrity_alert
             WHERE acknowledged_at IS NULL
             GROUP BY origin_id
         ),
         known AS (
             SELECT origin_id FROM sync_origin_credential
             UNION
             SELECT origin_id FROM latest
         )
         SELECT known.origin_id,
                credential.label,
                credential.site_id,
                credential.node_role,
                credential.active_generation,
                credential.inventory_enabled,
                credential.created_at,
                credential.rotated_at,
                (credential.origin_id IS NOT NULL) AS registered,
                latest.generation      AS receiving_generation,
                latest.durable_seq,
                latest.last_received_at,
                applied.applied_seq,
                COALESCE(alerts.open_alerts, 0)  AS open_alerts,
                COALESCE(alerts.occurrences, 0)  AS alert_occurrences,
                alerts.last_alert_at,
                alerts.latest_kind,
                alerts.latest_detail
         FROM known
         LEFT JOIN sync_origin_credential credential ON credential.origin_id = known.origin_id
         LEFT JOIN latest  ON latest.origin_id  = known.origin_id
         LEFT JOIN applied ON applied.origin_id = known.origin_id
         LEFT JOIN alerts  ON alerts.origin_id  = known.origin_id
         ORDER BY known.origin_id",
    )
    .fetch_all(pool)
    .await?;

    let items: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "origin_id": r.get::<String, _>("origin_id"),
                "registered": r.get::<bool, _>("registered"),
                "label": r.get::<Option<String>, _>("label"),
                "site_id": r.get::<Option<String>, _>("site_id"),
                "node_role": r.get::<Option<String>, _>("node_role"),
                // Kept under their established names: this endpoint already
                // had readers before it learned to answer the harder question.
                "active_generation": r.get::<Option<i64>, _>("active_generation"),
                "inventory_enabled": r.get::<Option<bool>, _>("inventory_enabled"),
                "created_at": r.get::<Option<DateTime<Utc>>, _>("created_at"),
                "rotated_at": r.get::<Option<DateTime<Utc>>, _>("rotated_at"),
                // What the stream is actually doing.
                "generation": r.get::<Option<i64>, _>("receiving_generation"),
                "durable_through": r.get::<Option<i64>, _>("durable_seq").unwrap_or(0),
                "applied_through": r.get::<Option<i64>, _>("applied_seq").unwrap_or(0),
                "last_seen_at": r.get::<Option<DateTime<Utc>>, _>("last_received_at"),
                "open_alerts": r.get::<i64, _>("open_alerts"),
                "alert_occurrences": r.get::<i64, _>("alert_occurrences"),
                "last_alert_at": r.get::<Option<DateTime<Utc>>, _>("last_alert_at"),
                "latest_alert_kind": r.get::<Option<String>, _>("latest_kind"),
                "latest_alert_detail": r.get::<Option<String>, _>("latest_detail"),
            })
        })
        .collect();
    Ok(json!({ "items": items }))
}

/// The open alerts themselves, newest first.
pub async fn sync_integrity_alerts(pool: &PgPool, limit: i64) -> Result<Value, AppError> {
    let rows = sqlx::query(
        "SELECT id, origin_id, generation, kind, detail, watermark_seq,
                occurrences, first_seen_at, last_seen_at
         FROM sync_integrity_alert
         WHERE acknowledged_at IS NULL
         ORDER BY last_seen_at DESC
         LIMIT $1",
    )
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await?;
    let items: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.get::<i64, _>("id"),
                "origin_id": r.get::<String, _>("origin_id"),
                "generation": r.get::<i64, _>("generation"),
                "kind": r.get::<String, _>("kind"),
                "detail": r.get::<String, _>("detail"),
                "watermark_seq": r.get::<Option<i64>, _>("watermark_seq"),
                "occurrences": r.get::<i64, _>("occurrences"),
                "first_seen_at": r.get::<DateTime<Utc>, _>("first_seen_at"),
                "last_seen_at": r.get::<DateTime<Utc>, _>("last_seen_at"),
            })
        })
        .collect();
    Ok(json!({ "items": items }))
}
