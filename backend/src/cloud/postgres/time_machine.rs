//! Adapter between itulah's ledger/sync tables and the vendored
//! `inventory-time-machine` crate (the deterministic divergence debugger).
//!
//! Mapping: the time machine folds subject-centric events, while itulah's
//! ledger is double-entry per (subject, place). Each movement row therefore
//! becomes up to two `Adjust` events on a synthetic pair subject
//! `"<subject_id>@<place_id>"` — `-quantity` on the from side, `+quantity` on
//! the to side. Folding that log reproduces exactly what
//! `inventory_projection` claims to hold, so the two can be diffed, and two
//! sync logs (edge fact log vs cloud ingest log) can be compared event by
//! event with `find_first_divergence`/`explain`.
//!
//! Sequence mapping (the ledger's `fact_sequence` and the sync log's `seq`
//! must stay recoverable from the internal ordering):
//! - ledger: internal seq = fact_sequence*2 - 1 (from side), fact_sequence*2
//! - sync logs: internal seq = fact_seq*4096 + line_index*2 (+1 for to side)

use crate::cloud::application::AppError;
use chrono::{DateTime, Utc};
use inventory_time_machine as tm;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// Hard cap on rows loaded into one timeline. The debugger is an operator
/// tool, not a reporting path; past this size export the logs instead.
const MAX_TIMELINE_ROWS: i64 = 100_000;
/// Width reserved for every sync fact in the deterministic event sequence.
const SYNC_FACT_SEQUENCE_WIDTH: u64 = 4_096;
/// A movement group with more lines than this cannot keep its per-line
/// ordering inside the 4096-wide sync seq slot.
const MAX_GROUP_LINES: usize = 2_047;
/// Divergent subjects listed in full (with history) before truncating.
const MAX_REPORTED_SUBJECTS: usize = 25;

#[derive(Clone, Debug, Default, Deserialize)]
pub struct TimeMachineScope {
    pub subject_id: Option<Uuid>,
    pub pool_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct TimeMachineStateQuery {
    /// Ledger `fact_sequence` to travel to; absent means "now".
    pub seq: Option<u64>,
    pub subject_id: Option<Uuid>,
    pub pool_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SyncDivergenceQuery {
    pub origin_id: String,
    pub generation: i64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct WhatIfLine {
    pub subject_id: Uuid,
    pub place_id: String,
    pub quantity_delta: i64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct WhatIfRequest {
    #[serde(default)]
    pub scope: TimeMachineScope,
    pub hypothetical: Vec<WhatIfLine>,
}

fn pair_subject(subject_id: &str, place_id: &str) -> tm::SubjectId {
    tm::SubjectId(format!("{subject_id}@{place_id}"))
}

fn split_pair(subject: &tm::SubjectId) -> (String, String) {
    match subject.as_str().split_once('@') {
        Some((s, p)) => (s.to_owned(), p.to_owned()),
        None => (subject.as_str().to_owned(), String::new()),
    }
}

fn adjust_event(
    seq: u64,
    at: DateTime<Utc>,
    subject: tm::SubjectId,
    delta: i64,
    origin: String,
) -> tm::Event {
    tm::Event::new(seq, at, subject, tm::EventKind::Adjust)
        .with_payload(tm::Payload {
            quantity_delta: Some(delta),
            ..tm::Payload::default()
        })
        .with_origin(origin)
}

fn build_timeline(
    source: tm::StateSource,
    events: Vec<tm::Event>,
) -> Result<tm::Timeline, AppError> {
    tm::Timeline::build(source, events).map_err(|error| {
        AppError::Conflict(format!("time machine cannot replay this log: {error}"))
    })
}

fn fact_seq_u64(value: i64, table: &str) -> Result<u64, AppError> {
    u64::try_from(value)
        .map_err(|_| AppError::Conflict(format!("{table} holds a negative sequence number")))
}

/// Load the operational ledger as a time-machine log: one `Adjust` per
/// operational side of every movement, ordered by `fact_sequence`.
async fn ledger_timeline(
    pool: &PgPool,
    scope: &TimeMachineScope,
) -> Result<(tm::Timeline, bool), AppError> {
    let rows = sqlx::query(
        r#"SELECT m.fact_sequence, m.subject_id, m.quantity, m.occurred_at,
                  m.movement_group_id, m.from_place_id, m.to_place_id,
                  fp.kind AS from_kind, tp.kind AS to_kind,
                  fp.pool_id AS from_pool, tp.pool_id AS to_pool
           FROM movement m
           JOIN inventory_place fp ON fp.id = m.from_place_id
           JOIN inventory_place tp ON tp.id = m.to_place_id
           WHERE ($1::uuid IS NULL OR m.subject_id = $1)
           ORDER BY m.fact_sequence
           LIMIT $2"#,
    )
    .bind(scope.subject_id)
    .bind(MAX_TIMELINE_ROWS + 1)
    .fetch_all(pool)
    .await?;

    let truncated = rows.len() as i64 > MAX_TIMELINE_ROWS;
    let mut events = Vec::with_capacity(rows.len() * 2);
    for row in rows.iter().take(MAX_TIMELINE_ROWS as usize) {
        let fact = fact_seq_u64(row.get::<i64, _>("fact_sequence"), "movement")?;
        let subject: Uuid = row.get("subject_id");
        let quantity: i64 = row.get("quantity");
        let at: DateTime<Utc> = row.get("occurred_at");
        let group: Uuid = row.get("movement_group_id");
        let origin = format!("movement group {group} fact {fact}");
        let sides = [
            (
                "from_place_id",
                "from_kind",
                "from_pool",
                -quantity,
                fact * 2 - 1,
            ),
            ("to_place_id", "to_kind", "to_pool", quantity, fact * 2),
        ];
        for (place_col, kind_col, pool_col, delta, seq) in sides {
            let kind: String = row.get(kind_col);
            if kind != "OPERATIONAL" {
                continue;
            }
            if let Some(wanted) = scope.pool_id.as_deref() {
                let pool_id: Option<String> = row.get(pool_col);
                if pool_id.as_deref() != Some(wanted) {
                    continue;
                }
            }
            let place: String = row.get(place_col);
            events.push(adjust_event(
                seq,
                at,
                pair_subject(&subject.to_string(), &place),
                delta,
                origin.clone(),
            ));
        }
    }
    Ok((
        build_timeline(tm::StateSource::Canonical, events)?,
        truncated,
    ))
}

/// The projection's current claim as a world, on the same pair subjects.
async fn projection_world(
    pool: &PgPool,
    scope: &TimeMachineScope,
) -> Result<tm::WorldState, AppError> {
    let rows = sqlx::query(
        r#"SELECT p.subject_id, p.place_id, p.quantity, p.last_fact_sequence
           FROM inventory_projection p
           JOIN inventory_place ip ON ip.id = p.place_id
           WHERE ip.kind = 'OPERATIONAL'
             AND ($1::uuid IS NULL OR p.subject_id = $1)
             AND ($2::text IS NULL OR ip.pool_id = $2)"#,
    )
    .bind(scope.subject_id)
    .bind(&scope.pool_id)
    .fetch_all(pool)
    .await?;

    let mut world = tm::WorldState::empty(tm::StateSource::Projection);
    for row in rows {
        let subject_id: Uuid = row.get("subject_id");
        let place_id: String = row.get("place_id");
        let subject = pair_subject(&subject_id.to_string(), &place_id);
        let state = tm::SubjectState {
            subject: subject.clone(),
            location: None,
            custody: None,
            quantity: row.get::<i64, _>("quantity"),
            status: tm::UnitStatus::default(),
            version: 0,
            last_seq: fact_seq_u64(
                row.get::<i64, _>("last_fact_sequence"),
                "inventory_projection",
            )?,
        };
        world.subjects.insert(subject, state);
    }
    Ok(world)
}

/// The projection only asserts existence and quantity per (subject, place);
/// version/status/custody are fold bookkeeping the projection never stored.
/// Comparing those fields would flag every row, so the diff is restricted to
/// what the projection actually claims.
fn projection_asserted_fields(deltas: Vec<tm::SubjectDelta>) -> Vec<tm::SubjectDelta> {
    deltas
        .into_iter()
        .filter_map(|mut delta| {
            delta
                .fields
                .retain(|diff| diff.field == "presence" || diff.field == "quantity");
            if delta.fields.is_empty() {
                None
            } else {
                Some(delta)
            }
        })
        .collect()
}

/// Zero-quantity pair subjects are provenance, not stock: the ledger fold
/// keeps them, the projection deletes the row. Both readings are correct, so
/// they are removed before the diff.
fn prune_zero_quantity(world: &mut tm::WorldState) {
    world.subjects.retain(|_, state| state.quantity != 0);
}

fn delta_json(delta: &tm::SubjectDelta) -> Value {
    let (subject_id, place_id) = split_pair(&delta.subject);
    json!({
        "subject_id": subject_id,
        "place_id": place_id,
        "diffs": delta.fields.iter().map(|diff| json!({
            "field": diff.field,
            "ledger": diff.expected,
            "projection": diff.observed,
        })).collect::<Vec<_>>(),
    })
}

fn subject_history(timeline: &tm::Timeline, subject: &tm::SubjectId) -> Vec<Value> {
    timeline
        .events_for(subject)
        .into_iter()
        .map(|event| {
            json!({
                "fact_sequence": event.seq.div_ceil(2),
                "quantity_delta": event.payload.quantity_delta,
                "occurred_at": event.event_time,
                "origin": event.origin,
            })
        })
        .collect()
}

fn violations_json(world: &tm::WorldState) -> Vec<Value> {
    world
        .violations
        .iter()
        .map(|violation| {
            let (subject_id, place_id) = split_pair(&violation.subject);
            json!({
                "fact_sequence": violation.seq.div_ceil(2),
                "subject_id": subject_id,
                "place_id": place_id,
                "invariant": violation.invariant.as_str(),
                "detail": violation.detail,
            })
        })
        .collect()
}

/// Sequence-based time travel: the ledger's state after `fact_sequence`,
/// deterministic and immune to backdated `occurred_at` inserts.
pub async fn time_machine_state(
    pool: &PgPool,
    query: TimeMachineStateQuery,
) -> Result<Value, AppError> {
    let scope = TimeMachineScope {
        subject_id: query.subject_id,
        pool_id: query.pool_id,
    };
    let (timeline, truncated) = ledger_timeline(pool, &scope).await?;
    let world = match query.seq {
        Some(fact) => timeline.state_at_seq(fact * 2),
        None => timeline.final_state(),
    };
    let hash = tm::hash_world(&world);
    let items: Vec<Value> = world
        .subjects
        .values()
        .filter(|state| state.quantity != 0)
        .map(|state| {
            let (subject_id, place_id) = split_pair(&state.subject);
            json!({
                "subject_id": subject_id,
                "place_id": place_id,
                "quantity": state.quantity,
                "last_fact_sequence": state.last_seq.div_ceil(2),
            })
        })
        .collect();
    Ok(json!({
        "as_of_fact_sequence": query.seq,
        "events_applied": world.applied,
        "state_hash": hash,
        "items": items,
        "violations": violations_json(&world),
        "truncated": truncated,
        "read_only": true,
    }))
}

/// Ledger vs projection, localised: which (subject, place) rows disagree,
/// by how much, and the full canonical history of each divergent row.
pub async fn time_machine_divergence(
    pool: &PgPool,
    scope: TimeMachineScope,
) -> Result<Value, AppError> {
    let (timeline, truncated) = ledger_timeline(pool, &scope).await?;
    let mut expected = timeline.final_state();
    let violations = violations_json(&expected);
    prune_zero_quantity(&mut expected);
    let observed = projection_world(pool, &scope).await?;
    let deltas = projection_asserted_fields(tm::diff_worlds(&expected, &observed));

    let reported: Vec<Value> = deltas
        .iter()
        .take(MAX_REPORTED_SUBJECTS)
        .map(|delta| {
            let mut entry = delta_json(delta);
            if let Some(map) = entry.as_object_mut() {
                map.insert(
                    "ledger_history".to_owned(),
                    Value::Array(subject_history(&timeline, &delta.subject)),
                );
            }
            entry
        })
        .collect();

    Ok(json!({
        "status": if deltas.is_empty() { "MATCH" } else { "DIVERGENCE" },
        "ledger_events": timeline.len(),
        "divergent_subjects": deltas.len(),
        "reported": reported,
        "reported_truncated": deltas.len() > MAX_REPORTED_SUBJECTS,
        "ledger_violations": violations,
        "ledger_truncated": truncated,
        "read_only": true,
    }))
}

#[derive(Debug, Deserialize)]
struct SyncLine {
    subject_id: Uuid,
    quantity: i64,
    from_place_id: String,
    to_place_id: String,
}

#[derive(Debug, Deserialize)]
struct SyncPayload {
    occurred_at: DateTime<Utc>,
    lines: Vec<SyncLine>,
}

fn sync_fact_events(
    fact_seq: u64,
    event_id: Uuid,
    event_type: &str,
    payload: &Value,
) -> Result<Vec<tm::Event>, AppError> {
    if event_type != "inventory.movement" {
        return Ok(Vec::new());
    }
    let payload: SyncPayload = serde_json::from_value(payload.clone()).map_err(|error| {
        AppError::Conflict(format!(
            "sync fact {event_id} has an unreadable payload: {error}"
        ))
    })?;
    if payload.lines.len() > MAX_GROUP_LINES {
        return Err(AppError::Conflict(format!(
            "sync fact {event_id} has {} lines; the time machine mapping holds at most {MAX_GROUP_LINES}",
            payload.lines.len()
        )));
    }
    let origin = format!("sync fact {fact_seq} group {event_id}");
    let mut events = Vec::with_capacity(payload.lines.len() * 2);
    for (index, line) in payload.lines.iter().enumerate() {
        let base = fact_seq * SYNC_FACT_SEQUENCE_WIDTH + (index as u64) * 2;
        let subject = line.subject_id.to_string();
        events.push(adjust_event(
            base,
            payload.occurred_at,
            pair_subject(&subject, &line.from_place_id),
            -line.quantity,
            origin.clone(),
        ));
        events.push(adjust_event(
            base + 1,
            payload.occurred_at,
            pair_subject(&subject, &line.to_place_id),
            line.quantity,
            origin.clone(),
        ));
    }
    Ok(events)
}

async fn sync_log_events(
    pool: &PgPool,
    table_sql: &str,
    origin_id: &str,
    generation: i64,
    table_name: &str,
) -> Result<(Vec<tm::Event>, Vec<Value>, i64), AppError> {
    let rows = sqlx::query(table_sql)
        .bind(origin_id)
        .bind(generation)
        .bind(MAX_TIMELINE_ROWS)
        .fetch_all(pool)
        .await?;
    let mut events = Vec::new();
    let mut rejected = Vec::new();
    let mut last_seq = 0_i64;
    for row in rows {
        let seq: i64 = row.get("seq");
        last_seq = seq;
        let event_id: Uuid = row.get("event_id");
        if row
            .try_get::<String, _>("status")
            .is_ok_and(|status| status == "REJECTED")
        {
            rejected.push(json!({
                "seq": seq,
                "event_id": event_id,
                "reason": row.try_get::<Option<String>, _>("reason").unwrap_or(None),
            }));
            continue;
        }
        let event_type: String = row.get("event_type");
        let payload: Value = row.get("payload");
        events.extend(sync_fact_events(
            fact_seq_u64(seq, table_name)?,
            event_id,
            &event_type,
            &payload,
        )?);
    }
    Ok((events, rejected, last_seq))
}

/// Edge fact log vs cloud ingest log for one (origin, generation) stream:
/// the first sequence number at which the two sides stop agreeing, the
/// side-by-side history of the divergent subject, and a minimal fixture that
/// reproduces the disagreement.
pub async fn time_machine_sync_divergence(
    pool: &PgPool,
    query: SyncDivergenceQuery,
) -> Result<Value, AppError> {
    let (edge_events, _, edge_last) = sync_log_events(
        pool,
        "SELECT seq, event_id, event_type, payload, NULL::text AS status, NULL::text AS reason
         FROM sync_fact_log WHERE origin_id = $1 AND generation = $2 ORDER BY seq LIMIT $3",
        &query.origin_id,
        query.generation,
        "sync_fact_log",
    )
    .await?;
    let (cloud_events, rejected, cloud_last) = sync_log_events(
        pool,
        "SELECT seq, event_id, event_type, payload, status, reason
         FROM sync_ingest_fact WHERE origin_id = $1 AND generation = $2 ORDER BY seq LIMIT $3",
        &query.origin_id,
        query.generation,
        "sync_ingest_fact",
    )
    .await?;

    if edge_events.is_empty() && cloud_events.is_empty() {
        return Ok(json!({
            "status": "EMPTY",
            "detail": "neither sync_fact_log nor sync_ingest_fact holds facts for this stream on this node",
            "origin_id": query.origin_id,
            "generation": query.generation,
        }));
    }

    let edge_count = edge_events.len();
    let cloud_count = cloud_events.len();
    let comparable_edge_events = if cloud_last < edge_last {
        let cloud_prefix = fact_seq_u64(cloud_last, "sync_ingest_fact")?;
        edge_events
            .iter()
            .filter(|event| event.seq / SYNC_FACT_SEQUENCE_WIDTH <= cloud_prefix)
            .cloned()
            .collect()
    } else {
        edge_events.clone()
    };
    let canonical = build_timeline(tm::StateSource::Canonical, comparable_edge_events)?;
    let observed = build_timeline(tm::StateSource::Projection, cloud_events)?;

    let base = json!({
        "origin_id": query.origin_id,
        "generation": query.generation,
        "edge_events": edge_count,
        "cloud_events": cloud_count,
        "edge_last_fact_seq": edge_last,
        "cloud_last_fact_seq": cloud_last,
        "rejected_tombstones": rejected,
        "read_only": true,
    });
    let mut result = base;

    match tm::find_first_divergence(&canonical, &observed) {
        None => {
            if let Some(map) = result.as_object_mut() {
                map.insert("status".to_owned(), json!("MATCH"));
                if cloud_last < edge_last {
                    map.insert(
                        "detail".to_owned(),
                        json!(format!(
                            "cloud is behind (holds through fact seq {cloud_last} of {edge_last}) but agrees on everything it holds"
                        )),
                    );
                }
            }
            Ok(result)
        }
        Some(divergence) => {
            let chain = tm::explain(&canonical, &observed, &divergence);
            let fixture = tm::minimal_fixture(&canonical, &observed, &divergence);
            let (subject_id, place_id) = split_pair(&divergence.subject);
            if let Some(map) = result.as_object_mut() {
                map.insert("status".to_owned(), json!("DIVERGENCE"));
                map.insert(
                    "first_divergence_fact_seq".to_owned(),
                    json!(divergence.seq / SYNC_FACT_SEQUENCE_WIDTH),
                );
                map.insert("subject_id".to_owned(), json!(subject_id));
                map.insert("place_id".to_owned(), json!(place_id));
                map.insert("summary".to_owned(), json!(chain.summary));
                map.insert(
                    "fields".to_owned(),
                    serde_json::to_value(&divergence.fields)?,
                );
                map.insert(
                    "also_divergent".to_owned(),
                    json!(divergence
                        .also_divergent
                        .iter()
                        .map(|subject| {
                            let (s, p) = split_pair(subject);
                            json!({"subject_id": s, "place_id": p})
                        })
                        .collect::<Vec<_>>()),
                );
                map.insert("causal_chain".to_owned(), serde_json::to_value(&chain)?);
                map.insert(
                    "minimal_fixture".to_owned(),
                    json!({
                        "faithful": fixture.is_faithful(),
                        "total_events": fixture.total_events(),
                        "fixture_json": fixture.to_json()?,
                    }),
                );
            }
            Ok(result)
        }
    }
}

/// "Would this hypothetical movement reconcile ledger and projection?" —
/// evaluated on a cloned world, writing nothing.
pub async fn time_machine_what_if(
    pool: &PgPool,
    request: WhatIfRequest,
) -> Result<Value, AppError> {
    if request.hypothetical.is_empty() {
        return Err(AppError::Validation(
            "what-if requires at least one hypothetical line".into(),
        ));
    }
    let (timeline, _) = ledger_timeline(pool, &request.scope).await?;
    let base = timeline.final_state();
    let next_seq = base.upto_seq.unwrap_or(0) + 1;
    let now = Utc::now();
    let events: Vec<tm::Event> = request
        .hypothetical
        .iter()
        .enumerate()
        .map(|(index, line)| {
            adjust_event(
                next_seq + index as u64,
                now,
                pair_subject(&line.subject_id.to_string(), &line.place_id),
                line.quantity_delta,
                format!("hypothetical line {index}"),
            )
        })
        .collect();
    let outcome = tm::what_if(&base, &events).map_err(|error| {
        AppError::Validation(format!("hypothetical log is unreplayable: {error}"))
    })?;

    let mut after = outcome.after.clone();
    prune_zero_quantity(&mut after);
    let observed = projection_world(pool, &request.scope).await?;
    let remaining = projection_asserted_fields(tm::diff_worlds(&after, &observed));

    Ok(json!({
        "resolves_projection": remaining.is_empty(),
        "remaining_divergences": remaining.iter().map(delta_json).collect::<Vec<_>>(),
        "changed_subjects": outcome.changes.iter().map(delta_json).collect::<Vec<_>>(),
        "new_violations": outcome
            .new_violations
            .iter()
            .map(|violation| json!({
                "invariant": violation.invariant.as_str(),
                "detail": violation.detail,
            }))
            .collect::<Vec<_>>(),
        "read_only": true,
    }))
}
