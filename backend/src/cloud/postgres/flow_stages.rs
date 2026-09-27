//! Stage handlers: where each stage's work is done, and how a flow document
//! hears of it.
//!
//! The flow engine does not re-implement picking, packing, a blind count or a
//! store receipt. Those exist, on the node that owns the site's ledger, and a
//! node is the only machine entitled to write its site's movements. So a
//! stage whose work happens on a node is connected in two directions:
//!
//! * **node → flow**: the cloud's fact appliers (`postgres::sync`) hand each
//!   fact about a flow's goods to [`resume_from_node_fact_tx`], keyed by the
//!   document the goods travel on — the allotment and the destination, the
//!   purchase order — and the flow is brought up to what the nodes' ledgers
//!   say ([`sync_from_nodes_tx`]), through the same code a hub confirm runs;
//! * **flow → node**: a stage done in the hub writes its effects to the
//!   outbox (`flow_event`), which [`after_stage_tx`] relays to the nodes.
//!
//! [`stage_delegate`] says, per stage, which surface does the work and which
//! fact tells the flow. The catalogue endpoint serves it, so the editor can
//! show a template's author which stages the building can actually run.
//!
//! # A node's work is pipelined; a flow's stages are not
//!
//! A flow document runs its stages in order, each once for the whole document
//! (an allotment to one destination). The Gudang packs, ships and loads koli by
//! koli: the first koli can be on the lorry while the last is being packed. So
//! a fact is never taken as "the stage is done". The flow reads what the
//! nodes' ledgers say about the document — the allotment's own counters
//! (`allotment_line_commitment`, allotment V1 §3), the deliveries received, the
//! inspections, the accepted receipts, the tagging jobs — and a stage is done
//! when everything the stage before handed on has passed it (for the first,
//! when nothing is left to pack). Until then it is parked with what has passed
//! so far. Reading the ledger rather than adding up facts is also what makes a
//! fact delivered twice, or a fact that arrives while the flow waits for an
//! approval, harmless: the next read is the same read.
//!
//! The allotment's arithmetic is not touched: its counters are only read here.
//!
//! # A flow never stops a node's stream
//!
//! Flows are introduced beside the paths that already work. Every entry point
//! below runs inside a savepoint of the fact's own transaction: a flow that
//! cannot take the node's work says why on the stage (`sync_problem`, 0625)
//! and the fact is applied all the same.

use super::flows::{self, DocumentRow};
use crate::cloud::application::AppError;
use crate::cloud::domain::flow::{
    Actor, CountRule, Effect, ExecutedAt, FlowActionInput, FlowSource, FlowState, FlowStatus,
    ProofKind, ProofRecord, SourceKind, StageKind, StageRuntime, StageSide, StageStatus,
    FLOW_ACTION_COMPLETE_STAGE, FLOW_ACTION_CONFIRM_RECEIVE, FLOW_ACTION_PARK_STAGE,
    FLOW_ACTION_RECORD_COUNT,
};
use crate::cloud::domain::{Reach, UnitId};
use crate::sync::flow::{
    InboundReceivedPayload, PutawayPayload, ReturnInspectedPayload, INVENTORY_INBOUND_RECEIVED_V1,
    INVENTORY_PUTAWAY_V1, INVENTORY_RETURN_INSPECTED_V1,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{Postgres, Row, Transaction};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

/// How far a stage is connected.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Wiring {
    /// Done inside the flow's own transaction: nothing else to call.
    InFlow,
    /// A surface on a node does the work, and its fact moves the flow.
    ExistingSurface,
    /// Nothing does it yet.
    Missing,
}

/// Where one stage's work is done.
#[derive(Clone, Copy, Debug, Serialize)]
pub struct StageDelegate {
    pub stage: StageKind,
    pub wiring: Wiring,
    /// The route or function that does the work.
    pub surface: &'static str,
    /// The fact the node publishes when it has done it: what moves the stage.
    pub fact: Option<&'static str>,
    pub note: &'static str,
}

pub fn stage_delegate(kind: StageKind) -> StageDelegate {
    let (wiring, surface, fact, note) = match kind {
        StageKind::Pick => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/picks (Gudang: Operations → Picking) · POST /api/v1/store/outbound/picks (shop: Stock → Send)",
            Some("inventory.pick.v1"),
            "Picking commits to no allotment (allotment §2), so a pick only parks the stage; how many were picked for a document is read at packing, and Pick is done when packing is.",
        ),
        StageKind::Pack => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/packs · POST /api/v1/dc/packing-boxes/{id}/capture",
            Some("inventory.fulfillment.progress.v1 (PACKED)"),
            "Pack binds goods to one destination (allotment §1). Done when nothing is left to pack for the document. Unpack: ALLOTMENT_UNPACKED.",
        ),
        StageKind::CloseKoli => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/koli/{koli_id}/seal",
            Some("inventory.fulfillment.progress.v1 (SHIPMENT)"),
            "A seal writes no fact of its own. Done when every packed piece has gone into a surat jalan, which only a sealed koli can.",
        ),
        StageKind::Ship => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/shipments · POST /api/v1/dc/koli/{koli_id}/shipment",
            Some("inventory.fulfillment.progress.v1 (SHIPMENT)"),
            "One SJ per destination (edge::outbound::NumberKind::Shipment). Unship: ALLOTMENT_UNSHIPPED.",
        ),
        StageKind::Load => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/dispatches · POST /api/v1/dc/koli/{koli_id}/dispatch",
            Some("inventory.fulfillment.progress.v1 (LOADED)"),
            "DSP: one vehicle run, several SJ. Still on the yard: Loaded, not Dispatched (ALT-D06). Unload: ALLOTMENT_UNLOADED.",
        ),
        StageKind::Depart => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/dispatches/{dispatch_id}/depart",
            Some("inventory.fulfillment.progress.v1 (IN_TRANSIT)"),
            "The DSP leaves; when Load is skipped it is opened here. Crossing units posts inter-unit goods dispatched (flow_posting).",
        ),
        StageKind::Receive => (
            Wiring::ExistingSurface,
            "POST /api/v1/store/inbound/{delivery_id}/receive (shop, handheld) · POST /api/v1/dc/inbound/{delivery_id}/receive (Gudang: Operations → Returns)",
            Some("inventory.inbound.received.v1"),
            "One confirm, once every koli that departed has been received: what came off the lorry is handed over, and what of it was not found is Missing.",
        ),
        StageKind::Inspect => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/inbound/{delivery_id}/inspection (Gudang: Operations → Returns)",
            Some("inventory.return.inspected.v1"),
            "Good goods to the racks, damaged goods to reject. Done when everything received has been inspected.",
        ),
        StageKind::ReadyForPickup => (
            Wiring::Missing,
            "—",
            None,
            "No customer collection flow yet.",
        ),
        StageKind::HandoverWithProof => (
            Wiring::InFlow,
            "hub: the HANDOVER action, with its proof",
            None,
            "A return to a supplier is posted from flow_posting (supplier return handed over).",
        ),
        StageKind::Approval => (
            Wiring::InFlow,
            "hub: the DECIDE_APPROVAL action",
            None,
            "A decision in the hub; nothing else to call. What the nodes did meanwhile is taken once it is approved.",
        ),
        StageKind::Arrival => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/goods-receipts (Gudang: Operations → Receiving)",
            Some("goods_receipt.line"),
            "Filed under the first accepted delivery's number.",
        ),
        StageKind::BlindCount => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/purchase-counts",
            Some("goods_receipt.line"),
            "The checker's list on the node carries neither the ordered quantity nor the price. Done when the order has been received.",
        ),
        StageKind::Verification => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/purchase-verifications",
            Some("goods_receipt.line"),
            "The verifier is never the checker; the node holds that too.",
        ),
        StageKind::Tagging => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/tagging-confirmations (Gudang: Operations → Tagging)",
            Some("tagging.completed"),
            "A tagging job per article, from Article Setup.",
        ),
        StageKind::Putaway => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/putaways (Gudang: Operations → Putaway)",
            Some("inventory.putaway.v1"),
            "Tagged goods are on the racks in the ledger from tagging; putaway records that they were shelved.",
        ),
    };
    StageDelegate {
        stage: kind,
        wiring,
        surface,
        fact,
        note,
    }
}

pub fn stage_delegates() -> Vec<StageDelegate> {
    StageKind::ALL.into_iter().map(stage_delegate).collect()
}

/// Called in the stage's own transaction, after the flow's rows are written.
///
/// The hook where a stage done in the hub reaches the code that already does
/// its work. Today every stage's effects leave through the outbox
/// (`flow_event`) and nothing more is called here.
pub(super) async fn after_stage_tx(
    _tx: &mut Transaction<'_, Postgres>,
    _document: &DocumentRow,
    _state: &FlowState,
    _stage_index: usize,
    _effects: &[Effect],
    _actor: &Actor,
    _at: DateTime<Utc>,
) -> Result<(), AppError> {
    Ok(())
}

// ---- node → flow: the entry points ------------------------------------------------

/// A node's fact, as the flow its goods belong to hears of it.
#[derive(Clone, Copy, Debug)]
pub struct NodeFact<'a> {
    /// The node that wrote it.
    pub origin_id: &'a str,
    pub event_type: &'a str,
    pub event_id: Uuid,
    /// The stage the fact is about.
    pub stage: StageKind,
    /// Who did it, as the node recorded them.
    pub actor_id: Option<&'a str>,
}

impl NodeFact<'_> {
    fn key(&self) -> String {
        format!(
            "node:{}:{}:{}",
            self.origin_id, self.event_type, self.event_id
        )
    }
}

/// A node's fact moves the flow its goods belong to.
///
/// Keyed by the document the fact is about — `source` is the allotment (and
/// `destination_site_id` which of its destinations, in the centre's spelling)
/// or the purchase order — and the flow is then brought up to what the nodes'
/// ledgers say ([`sync_from_nodes_tx`]).
///
/// Never stops the node's stream. A source that runs under no flow is not an
/// error — `None` — because flows are introduced beside the paths that
/// already work; a stage the flow cannot take yet says why on the stage; and
/// anything else the flow trips over is rolled back to a savepoint and logged,
/// so the fact is applied either way. The only error that escapes is the
/// database's own, which would have failed the fact anyway.
pub async fn resume_from_node_fact_tx(
    tx: &mut Transaction<'_, Postgres>,
    source: &FlowSource,
    destination_site_id: Option<&str>,
    fact: &NodeFact<'_>,
    at: DateTime<Utc>,
) -> Result<Option<Uuid>, AppError> {
    let mut savepoint = sqlx::Connection::begin(&mut **tx).await?;
    let outcome = keyed_sync(&mut savepoint, source, destination_site_id, fact, at).await;
    match outcome {
        Ok(document) => {
            savepoint.commit().await?;
            Ok(document)
        }
        Err(error) => {
            savepoint.rollback().await?;
            tracing::warn!(
                source_kind = source.kind.code(),
                source_id = %source.id,
                fact = %fact.event_id,
                %error,
                "a node's fact could not move its flow; the fact is applied all the same"
            );
            Ok(None)
        }
    }
}

async fn keyed_sync(
    tx: &mut Transaction<'_, Postgres>,
    source: &FlowSource,
    destination_site_id: Option<&str>,
    fact: &NodeFact<'_>,
    at: DateTime<Utc>,
) -> Result<Option<Uuid>, AppError> {
    let Some(document_id) = flows::live_flow_for_source_tx(tx, source, destination_site_id).await?
    else {
        return Ok(None);
    };
    sync_from_nodes_tx(tx, document_id, Some(fact), at).await?;
    Ok(Some(document_id))
}

/// A pick moves the flows whose pick is due at that site for that SKU.
///
/// Picking commits to no allotment (allotment §2: a picker fetches a SKU and a
/// number, and whom it is for is settled at the packing bench), so a pick
/// cannot be keyed by its allotment the way every other fact is. It is keyed
/// by where it happened and what was fetched, and it only says that picking is
/// under way: each document it could be for parks its Pick stage. How many
/// were picked for a document is read at packing, where both sides first
/// attribute a garment to one destination.
pub async fn resume_picks_tx(
    tx: &mut Transaction<'_, Postgres>,
    source_site_id: &str,
    sku_code: &str,
    fact: &NodeFact<'_>,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let mut savepoint = sqlx::Connection::begin(&mut **tx).await?;
    let outcome = picked_sync(&mut savepoint, source_site_id, sku_code, fact, at).await;
    match outcome {
        Ok(()) => savepoint.commit().await?,
        Err(error) => {
            savepoint.rollback().await?;
            tracing::warn!(
                pick = %fact.event_id,
                %error,
                "a pick could not park the flows it may be for; the pick is applied all the same"
            );
        }
    }
    Ok(())
}

async fn picked_sync(
    tx: &mut Transaction<'_, Postgres>,
    source_site_id: &str,
    sku_code: &str,
    fact: &NodeFact<'_>,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let origin = super::sync::canonical_site_id_tx(tx, source_site_id.trim()).await?;
    let documents: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT d.id
           FROM flow_document d
           JOIN flow_document_line l ON l.document_id = d.id
           JOIN sku ON sku.id = l.sku_id
           JOIN flow_stage_state s ON s.document_id = d.id AND s.stage_kind = 'PICK'
          WHERE d.origin_site_id = $1
            AND sku.sku_code = $2
            AND d.source_kind = 'ALLOTMENT'
            AND d.status = 'CONFIRMED'
            AND s.status IN ('PENDING', 'PARKED')
          LIMIT 50",
    )
    .bind(&origin)
    .bind(sku_code.trim())
    .fetch_all(&mut **tx)
    .await?;
    for document_id in documents {
        sync_from_nodes_tx(tx, document_id, Some(fact), at).await?;
    }
    Ok(())
}

/// After a person acted on a document in the hub, take what the nodes did
/// while the flow waited: the Gudang packs a supplier return before head
/// office approves it, and a stage confirmed by hand may be followed by one a
/// node has already finished. Never fails the person's act.
pub async fn catch_up_tx(
    tx: &mut Transaction<'_, Postgres>,
    document_id: Uuid,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let mut savepoint = sqlx::Connection::begin(&mut **tx).await?;
    match sync_from_nodes_tx(&mut savepoint, document_id, None, at).await {
        Ok(()) => savepoint.commit().await?,
        Err(error) => {
            savepoint.rollback().await?;
            tracing::warn!(
                document = %document_id,
                %error,
                "a flow could not take what its nodes did meanwhile"
            );
        }
    }
    Ok(())
}

// ---- node → flow: the sync --------------------------------------------------------

/// Bring a flow up to what the nodes' ledgers say about its goods.
///
/// From the stage now due, one stage at a time: when the nodes have finished
/// it for the whole document, record its count and complete it; when it is
/// only under way, record what has passed so far and park it; stop at the
/// first stage the nodes have not finished, at a stage done in the hub (an
/// approval, a handover), and at a document that is not running (waiting for
/// its approval, or finished).
///
/// Each stage is applied through `flows::apply_stage_tx` — the code a hub
/// confirm runs — as the node of the site it happens at: the person the node
/// named when it named one, the node itself when it did not; on the rung the
/// template asks for, because the node authorised its own people; reaching
/// that site's unit and no other. One savepoint per stage: a stage the flow
/// refuses is rolled back, its reason is written on the stage, and the stages
/// before it stay done.
pub async fn sync_from_nodes_tx(
    tx: &mut Transaction<'_, Postgres>,
    document_id: Uuid,
    fact: Option<&NodeFact<'_>>,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let mut row = flows::load_document(&mut **tx, document_id, false).await?;
    if FlowStatus::parse(&row.status) != Some(FlowStatus::Confirmed) {
        return Ok(());
    }
    let mut state = flows::load_state(&mut **tx, &row).await?;
    let progress = node_progress_tx(tx, &row, &state).await?;
    let trigger = fact.map_or_else(|| "hub:catch-up".to_owned(), |fact| fact.key());
    for _ in 0..state.stages.len() {
        let Some(cursor) = state.cursor() else {
            break;
        };
        let stage = &state.stages[cursor];
        let kind = stage.kind();
        if kind.spec().executed_at == ExecutedAt::Hub {
            break;
        }
        let Some(done) = progress.get(&kind) else {
            break;
        };
        let Some((actions, completes)) = next_actions(&state, cursor, done) else {
            break;
        };
        let (actor, reach) = node_performer_tx(tx, &row, stage, done, fact).await?;
        let key = format!("{trigger}:{}", kind.code());
        let mut savepoint = sqlx::Connection::begin(&mut **tx).await?;
        let applied = flows::apply_stage_tx(
            &mut savepoint,
            document_id,
            &actions,
            None,
            &actor,
            &reach,
            &key,
            at,
        )
        .await;
        match applied {
            Ok(_) => {
                savepoint.commit().await?;
                note_sync_problem(tx, document_id, cursor, None, at).await?;
            }
            Err(error) => {
                savepoint.rollback().await?;
                let problem = problem_text(&error);
                note_sync_problem(tx, document_id, cursor, Some(problem.as_str()), at).await?;
                break;
            }
        }
        if !completes {
            break;
        }
        row = flows::load_document(&mut **tx, document_id, false).await?;
        state = flows::load_state(&mut **tx, &row).await?;
    }
    Ok(())
}

/// What the nodes say of the stage now due, as actions, and whether they
/// complete it. `None`: nothing to say yet.
fn next_actions(
    state: &FlowState,
    index: usize,
    done: &StageProgress,
) -> Option<(Vec<FlowActionInput>, bool)> {
    let stage = &state.stages[index];
    let kind = stage.kind();
    let spec = kind.spec();
    let action = |action_type: &str, details: Value| FlowActionInput {
        action_type: action_type.to_owned(),
        stage_index: index,
        details,
    };
    if done.finished {
        let proof = proof_for(stage, done);
        let actions = if kind == StageKind::Receive {
            vec![action(
                FLOW_ACTION_CONFIRM_RECEIVE,
                receive_details(state, index, done, &proof),
            )]
        } else if spec.count == CountRule::None {
            vec![action(
                FLOW_ACTION_COMPLETE_STAGE,
                json!({ "proof": proof, "delivery_number": done.delivery_number }),
            )]
        } else {
            let mut actions = Vec::new();
            if done.counted {
                let counts = capped_counts(state, index, done);
                actions.push(action(
                    FLOW_ACTION_RECORD_COUNT,
                    json!({ "lines": count_lines(&counts) }),
                ));
            }
            actions.push(action(
                FLOW_ACTION_COMPLETE_STAGE,
                json!({ "proof": proof }),
            ));
            actions
        };
        return Some((actions, true));
    }
    // Under way: only a stage that waits can say so.
    if !done.started || spec.parks.is_none() {
        return None;
    }
    let mut actions = Vec::new();
    if done.counted && kind != StageKind::Receive {
        let counts = capped_counts(state, index, done);
        let recorded: BTreeMap<Uuid, (i64, i64)> = stage
            .counts
            .iter()
            .map(|(key, count)| (*key, (count.quantity, count.reject)))
            .collect();
        let something = counts.values().any(|(quantity, _)| *quantity > 0);
        if something && (!stage.counted || recorded != counts) {
            actions.push(action(
                FLOW_ACTION_RECORD_COUNT,
                json!({ "lines": count_lines(&counts) }),
            ));
        }
    }
    if stage.status != StageStatus::Parked {
        actions.push(action(FLOW_ACTION_PARK_STAGE, json!({})));
    }
    (!actions.is_empty()).then_some((actions, false))
}

/// The stage's count per line key, and its reject: never more than the stage
/// before handed on (the flow's own `upstream`), a blind count excepted.
fn capped_counts(
    state: &FlowState,
    index: usize,
    done: &StageProgress,
) -> BTreeMap<Uuid, (i64, i64)> {
    let ceiling = state.upstream(index);
    done.counts
        .iter()
        .filter_map(|(key, quantity)| {
            let quantity = match &ceiling {
                Some(ceiling) => (*quantity).min(*ceiling.get(key)?),
                None => *quantity,
            }
            .max(0);
            let reject = done
                .rejects
                .get(key)
                .copied()
                .unwrap_or(0)
                .min(quantity)
                .max(0);
            Some((*key, (quantity, reject)))
        })
        .collect()
}

fn count_lines(counts: &BTreeMap<Uuid, (i64, i64)>) -> Vec<Value> {
    counts
        .iter()
        .map(|(key, (quantity, reject))| {
            json!({ "sku_id": key, "quantity": quantity, "reject": reject })
        })
        .collect()
}

/// The one confirm at receive: for every SKU that departed, what came off the
/// lorry in the deliveries received and what of it was found. What departed
/// and was never handed over stays in transit, by the confirm's own rule.
fn receive_details(
    state: &FlowState,
    index: usize,
    done: &StageProgress,
    proof: &[ProofRecord],
) -> Value {
    let departed = state.upstream(index).unwrap_or_default();
    let lines: Vec<Value> = departed
        .iter()
        .map(|(key, departed)| {
            let handed_over = done
                .handed_over
                .get(key)
                .copied()
                .unwrap_or(0)
                .min(*departed)
                .max(0);
            let received = done
                .counts
                .get(key)
                .copied()
                .unwrap_or(0)
                .min(handed_over)
                .max(0);
            json!({ "sku_id": key, "handed_over": handed_over, "received": received })
        })
        .collect();
    json!({ "lines": lines, "proof": proof })
}

/// The proof the template asks of this stage that the node's own work is:
/// a sweep of tags is an RFID scan, a checker's typed number a manual count.
/// A kind the node cannot give — a photo, a signature — is not invented; the
/// stage stays open and says so, for a person to finish in the hub.
fn proof_for(stage: &StageRuntime, done: &StageProgress) -> Vec<ProofRecord> {
    done.evidence
        .iter()
        .filter(|record| {
            stage.stage.proof.contains(&record.kind)
                && stage.kind().spec().allowed_proof.contains(&record.kind)
                && !stage.has_proof(record.kind)
        })
        .cloned()
        .collect()
}

/// Who does a stage the nodes did: the node of the site it happens at.
async fn node_performer_tx(
    tx: &mut Transaction<'_, Postgres>,
    row: &DocumentRow,
    stage: &StageRuntime,
    done: &StageProgress,
    fact: Option<&NodeFact<'_>>,
) -> Result<(Actor, Reach), AppError> {
    let kind = stage.kind();
    let (site, unit) = match kind.spec().side {
        StageSide::Origin => (row.origin_site_id.as_deref(), row.origin_unit_id.as_deref()),
        StageSide::Destination => (
            row.destination_site_id.as_deref(),
            row.destination_unit_id.as_deref(),
        ),
        StageSide::HeadOffice => (None, None),
    };
    let (Some(site), Some(unit)) = (site, unit) else {
        return Err(AppError::Conflict(format!(
            "{} does not happen at a site of ours, so no node does it",
            kind.spec().label
        )));
    };
    let named = fact
        .filter(|fact| fact.stage == kind)
        .and_then(|fact| fact.actor_id)
        .or(done.actor.as_deref())
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_owned);
    let id = match named {
        Some(id) => id,
        None => match super::sync::inventory_owner_tx(tx, site).await? {
            Some(origin_id) => format!("node:{origin_id}"),
            None => format!("node:{site}"),
        },
    };
    let unit = UnitId::try_new(unit)
        .map_err(|error| AppError::Conflict(format!("unit {unit}: {error}")))?;
    Ok((
        Actor {
            id,
            rung: stage.stage.performer.min_role(),
        },
        Reach::Only(unit),
    ))
}

/// A refusal as a person should read it: a rule the database holds speaks in
/// its own words rather than as "database operation failed".
fn problem_text(error: &AppError) -> String {
    match error {
        AppError::Database(sqlx::Error::Database(database)) => database.message().to_owned(),
        other => other.to_string(),
    }
}

/// Say on the stage why the nodes' work could not move it, or clear what was
/// said once it could.
async fn note_sync_problem(
    tx: &mut Transaction<'_, Postgres>,
    document_id: Uuid,
    stage_index: usize,
    problem: Option<&str>,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE flow_stage_state
            SET sync_problem = $3::text,
                sync_problem_at = CASE WHEN $3::text IS NULL THEN NULL ELSE $4 END
          WHERE document_id = $1 AND stage_index = $2
            AND sync_problem IS DISTINCT FROM $3::text",
    )
    .bind(document_id)
    .bind(i32::try_from(stage_index).unwrap_or(i32::MAX))
    .bind(problem)
    .bind(at)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

// ---- node → flow: what the nodes' ledgers say ----------------------------------------

/// What the nodes' ledgers say one stage of a document has done so far.
#[derive(Clone, Debug, Default)]
struct StageProgress {
    /// What passed the stage, per line key: the SKU, or for a supplier's goods
    /// the purchase line (`flow_document_line`). At receive, what was found.
    counts: BTreeMap<Uuid, i64>,
    /// Inspect: found unfit to sell, part of `counts`.
    rejects: BTreeMap<Uuid, i64>,
    /// Receive: what came off the lorry in the deliveries received.
    handed_over: BTreeMap<Uuid, i64>,
    /// Whether the stage records `counts` (rather than carrying the stage
    /// before's forward).
    counted: bool,
    /// Whether anything has passed it yet.
    started: bool,
    /// Whether nothing more will: the stage is done for the whole document.
    finished: bool,
    /// What the node's work is as proof: a sweep, a typed count.
    evidence: Vec<ProofRecord>,
    delivery_number: Option<String>,
    /// Who did it, as the node recorded them.
    actor: Option<String>,
}

fn scanned(reference: String) -> Vec<ProofRecord> {
    vec![ProofRecord {
        kind: ProofKind::RfidScan,
        reference,
    }]
}

fn typed(reference: String) -> Vec<ProofRecord> {
    vec![ProofRecord {
        kind: ProofKind::ManualCount,
        reference,
    }]
}

fn started(counts: &BTreeMap<Uuid, i64>) -> bool {
    counts.values().any(|quantity| *quantity > 0)
}

/// Every key of `wanted` has at least as much in `got`.
fn covers(got: &BTreeMap<Uuid, i64>, wanted: &BTreeMap<Uuid, i64>) -> bool {
    wanted
        .iter()
        .all(|(key, wanted)| got.get(key).copied().unwrap_or(0) >= *wanted)
}

async fn node_progress_tx(
    tx: &mut Transaction<'_, Postgres>,
    row: &DocumentRow,
    state: &FlowState,
) -> Result<BTreeMap<StageKind, StageProgress>, AppError> {
    match SourceKind::parse(&row.source_kind) {
        Some(SourceKind::Allotment) => allotment_progress_tx(tx, row).await,
        Some(SourceKind::PurchaseOrder) => purchase_progress_tx(tx, row, state).await,
        _ => Ok(BTreeMap::new()),
    }
}

/// One SKU of a document, summed over its allotment lines.
#[derive(Default)]
struct LineSums {
    packed: i64,
    shipped: i64,
    loaded: i64,
    departed: i64,
    /// Departed and not declared lost on the road: what can still arrive.
    arriving: i64,
    to_pack: i64,
    at_packed: i64,
    at_shipment: i64,
    at_loaded: i64,
}

async fn canonical_tx(
    tx: &mut Transaction<'_, Postgres>,
    cache: &mut BTreeMap<String, String>,
    spelled: &str,
) -> Result<String, AppError> {
    if let Some(known) = cache.get(spelled) {
        return Ok(known.clone());
    }
    let resolved = super::sync::canonical_site_id_tx(tx, spelled).await?;
    cache.insert(spelled.to_owned(), resolved.clone());
    Ok(resolved)
}

/// An outbound document: the allotment's counters for its lines to this
/// destination (allotment V1 §3, `allotment_line_commitment`), and the
/// deliveries received and inspections made at the destination.
async fn allotment_progress_tx(
    tx: &mut Transaction<'_, Postgres>,
    row: &DocumentRow,
) -> Result<BTreeMap<StageKind, StageProgress>, AppError> {
    let mut progress = BTreeMap::new();
    let Ok(allotment_id) = Uuid::parse_str(row.source_id.trim()) else {
        return Ok(progress);
    };
    let rows = sqlx::query(
        "SELECT allotment_line_id, source_site_id, destination_type, destination_id, sku_id,
                packed_total, unpacked_total, lost_packed_total, shipment_total, unshipped_total,
                loaded_total, unloaded_total, in_transit_total, lost_in_transit_total,
                to_pack_qty, at_packed, at_shipment, at_loaded
           FROM allotment_line_commitment
          WHERE allotment_id = $1",
    )
    .bind(allotment_id)
    .fetch_all(&mut **tx)
    .await?;

    let mut spellings: BTreeMap<String, String> = BTreeMap::new();
    let mut sums: BTreeMap<Uuid, LineSums> = BTreeMap::new();
    let mut lines: BTreeMap<Uuid, Uuid> = BTreeMap::new();
    for line in &rows {
        let destination_type: Option<String> = line.try_get("destination_type")?;
        let destination_id: Option<String> = line.try_get("destination_id")?;
        let to_supplier = destination_type.as_deref() == Some("SUPPLIER");
        let ours = match (
            row.destination_site_id.as_deref(),
            row.destination_party_kind.as_deref(),
        ) {
            (Some(site), _) if !to_supplier => match destination_id.as_deref() {
                Some(spelled) => canonical_tx(tx, &mut spellings, spelled).await? == site,
                None => false,
            },
            (None, Some("SUPPLIER")) => to_supplier,
            _ => false,
        };
        if !ours {
            continue;
        }
        let source: Option<String> = line.try_get("source_site_id")?;
        if let (Some(origin), Some(spelled)) = (row.origin_site_id.as_deref(), source.as_deref()) {
            if canonical_tx(tx, &mut spellings, spelled).await? != origin {
                continue;
            }
        }
        let line_id: Option<Uuid> = line.try_get("allotment_line_id")?;
        let sku_id: Option<Uuid> = line.try_get("sku_id")?;
        let (Some(line_id), Some(sku_id)) = (line_id, sku_id) else {
            continue;
        };
        lines.insert(line_id, sku_id);
        let number = |column: &str| -> Result<i64, AppError> {
            Ok(line.try_get::<Option<i64>, _>(column)?.unwrap_or(0))
        };
        let sum = sums.entry(sku_id).or_default();
        sum.packed +=
            number("packed_total")? - number("unpacked_total")? - number("lost_packed_total")?;
        sum.shipped += number("shipment_total")? - number("unshipped_total")?;
        sum.loaded += number("loaded_total")? - number("unloaded_total")?;
        sum.departed += number("in_transit_total")?;
        sum.arriving += number("in_transit_total")? - number("lost_in_transit_total")?;
        sum.to_pack += number("to_pack_qty")?;
        sum.at_packed += number("at_packed")?;
        sum.at_shipment += number("at_shipment")?;
        sum.at_loaded += number("at_loaded")?;
    }
    if sums.is_empty() {
        return Ok(progress);
    }

    let every = |test: fn(&LineSums) -> bool| sums.values().all(test);
    let pack_finished = every(|sum| sum.to_pack <= 0);
    let ship_finished = pack_finished && every(|sum| sum.at_packed <= 0);
    let load_finished = ship_finished && every(|sum| sum.at_shipment <= 0);
    let depart_finished = load_finished && every(|sum| sum.at_loaded <= 0);
    let column = |pick: fn(&LineSums) -> i64| -> BTreeMap<Uuid, i64> {
        sums.iter()
            .map(|(sku, sum)| (*sku, pick(sum).max(0)))
            .collect()
    };
    let packed = column(|sum| sum.packed);
    let shipped = column(|sum| sum.shipped);
    let loaded = column(|sum| sum.loaded);
    let departed = column(|sum| sum.departed);
    let arriving = column(|sum| sum.arriving);
    let koli = format!("koli of allotment {allotment_id}");

    // Picking is anybody's until packing (allotment §2): under way when the
    // origin has picked any of these SKUs since the document started.
    let skus: Vec<Uuid> = sums.keys().copied().collect();
    let pick_started = started(&packed) || picked_at_origin_tx(tx, row, &skus).await?;
    progress.insert(
        StageKind::Pick,
        StageProgress {
            counts: packed.clone(),
            counted: true,
            started: pick_started,
            finished: pack_finished,
            evidence: scanned(koli.clone()),
            ..StageProgress::default()
        },
    );
    progress.insert(
        StageKind::Pack,
        StageProgress {
            counted: true,
            started: started(&packed),
            finished: pack_finished,
            evidence: scanned(koli.clone()),
            counts: packed,
            ..StageProgress::default()
        },
    );
    progress.insert(
        StageKind::CloseKoli,
        StageProgress {
            started: started(&shipped),
            finished: ship_finished,
            evidence: scanned(koli.clone()),
            ..StageProgress::default()
        },
    );
    progress.insert(
        StageKind::Ship,
        StageProgress {
            counted: true,
            started: started(&shipped),
            finished: ship_finished,
            counts: shipped,
            ..StageProgress::default()
        },
    );
    progress.insert(
        StageKind::Load,
        StageProgress {
            counted: true,
            started: started(&loaded),
            finished: load_finished,
            evidence: scanned(koli),
            counts: loaded,
            ..StageProgress::default()
        },
    );
    progress.insert(
        StageKind::Depart,
        StageProgress {
            counted: true,
            started: started(&departed),
            finished: depart_finished,
            counts: departed,
            ..StageProgress::default()
        },
    );

    // What the destination did with it: the deliveries it received and, for
    // a return at the Gudang, what it inspected.
    let line_ids: Vec<Uuid> = lines.keys().copied().collect();
    let steps = sqlx::query(
        "SELECT step.event_id, step.kind, step.delivery_id, step.actor_id,
                line.allotment_line_id, line.expected, line.quantity, line.damaged
           FROM edge_goods_step step
           JOIN edge_goods_step_line line ON line.event_id = step.event_id
          WHERE line.allotment_line_id = ANY($1)
            AND step.kind IN ('RECEIVED', 'INSPECTED')
          ORDER BY step.occurred_at, step.event_id, line.line_no",
    )
    .bind(&line_ids)
    .fetch_all(&mut **tx)
    .await?;
    let mut handed_over: BTreeMap<Uuid, i64> = BTreeMap::new();
    let mut found: BTreeMap<Uuid, i64> = BTreeMap::new();
    let mut inspected: BTreeMap<Uuid, i64> = BTreeMap::new();
    let mut damaged: BTreeMap<Uuid, i64> = BTreeMap::new();
    let mut deliveries: BTreeSet<String> = BTreeSet::new();
    let mut inspections: BTreeSet<Uuid> = BTreeSet::new();
    let mut receiver: Option<String> = None;
    let mut inspector: Option<String> = None;
    for step in &steps {
        let line_id: Option<Uuid> = step.try_get("allotment_line_id")?;
        let Some(sku) = line_id.and_then(|line_id| lines.get(&line_id).copied()) else {
            continue;
        };
        let kind: String = step.try_get("kind")?;
        let quantity: i64 = step.try_get("quantity")?;
        if kind == "RECEIVED" {
            *handed_over.entry(sku).or_insert(0) += step.try_get::<i64, _>("expected")?;
            *found.entry(sku).or_insert(0) += quantity;
            if let Some(delivery) = step.try_get::<Option<String>, _>("delivery_id")? {
                deliveries.insert(delivery);
            }
            receiver = Some(step.try_get("actor_id")?);
        } else {
            *inspected.entry(sku).or_insert(0) += quantity;
            *damaged.entry(sku).or_insert(0) += step.try_get::<i64, _>("damaged")?;
            inspections.insert(step.try_get("event_id")?);
            inspector = Some(step.try_get("actor_id")?);
        }
    }
    // Received once every koli that can still arrive has come off a lorry in
    // a delivery the destination received.
    let receive_finished = depart_finished && covers(&handed_over, &arriving);
    let inspect_finished = receive_finished && covers(&inspected, &found);
    let delivery_list = deliveries.iter().cloned().collect::<Vec<_>>().join(", ");
    progress.insert(
        StageKind::Receive,
        StageProgress {
            counted: true,
            started: !deliveries.is_empty(),
            finished: receive_finished,
            evidence: scanned(format!("deliveries {delivery_list}")),
            actor: receiver,
            handed_over,
            counts: found,
            ..StageProgress::default()
        },
    );
    let inspection_list = inspections
        .iter()
        .map(Uuid::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    progress.insert(
        StageKind::Inspect,
        StageProgress {
            counted: true,
            started: !inspections.is_empty(),
            finished: inspect_finished,
            evidence: scanned(format!("inspections {inspection_list}")),
            actor: inspector,
            counts: inspected,
            rejects: damaged,
            ..StageProgress::default()
        },
    );
    Ok(progress)
}

/// Whether the origin's node has picked any of these SKUs since the document
/// started. Picks name no allotment, so this is all a pick can say about one.
async fn picked_at_origin_tx(
    tx: &mut Transaction<'_, Postgres>,
    row: &DocumentRow,
    skus: &[Uuid],
) -> Result<bool, AppError> {
    let Some(origin_site) = row.origin_site_id.as_deref() else {
        return Ok(false);
    };
    let Some(origin_id) = super::sync::inventory_owner_tx(tx, origin_site).await? else {
        return Ok(false);
    };
    Ok(sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (
             SELECT 1 FROM edge_allotment_pick_fact pick
               JOIN sku ON sku.sku_code = pick.sku_code
              WHERE pick.origin_id = $1 AND sku.id = ANY($2) AND pick.occurred_at >= $3)",
    )
    .bind(origin_id)
    .bind(skus)
    .bind(row.requested_at)
    .fetch_one(&mut **tx)
    .await?)
}

/// A supplier's goods: the order's accepted receipt lines, its tagging jobs
/// and what was put away. Line keys are purchase lines (`flow_document_line`).
async fn purchase_progress_tx(
    tx: &mut Transaction<'_, Postgres>,
    row: &DocumentRow,
    state: &FlowState,
) -> Result<BTreeMap<StageKind, StageProgress>, AppError> {
    let mut progress = BTreeMap::new();
    let Ok(order_id) = Uuid::parse_str(row.source_id.trim()) else {
        return Ok(progress);
    };
    let receipts = sqlx::query(
        "SELECT r.receipt_number, r.opened_by, gl.po_line_id, gl.quantity, gl.matched_quantity,
                gl.counted_by, gl.verified_by
           FROM goods_receipt_line gl
           JOIN goods_receipt r ON r.receipt_id = gl.receipt_id
           JOIN purchase_order_line pl ON pl.po_line_id = gl.po_line_id
          WHERE pl.purchase_order_id = $1
          ORDER BY gl.verified_at, gl.receipt_line_id",
    )
    .bind(order_id)
    .fetch_all(&mut **tx)
    .await?;
    if receipts.is_empty() {
        return Ok(progress);
    }
    let mut counted: BTreeMap<Uuid, i64> = BTreeMap::new();
    let mut matched: BTreeMap<Uuid, i64> = BTreeMap::new();
    let mut numbers: Vec<String> = Vec::new();
    let mut opener: Option<String> = None;
    let mut checker: Option<String> = None;
    let mut verifier: Option<String> = None;
    for receipt in &receipts {
        let line: Uuid = receipt.try_get("po_line_id")?;
        *counted.entry(line).or_insert(0) += receipt.try_get::<i64, _>("quantity")?;
        *matched.entry(line).or_insert(0) += receipt
            .try_get::<Option<i64>, _>("matched_quantity")?
            .unwrap_or(0);
        let number: String = receipt.try_get("receipt_number")?;
        if !numbers.contains(&number) {
            numbers.push(number);
        }
        if opener.is_none() {
            opener = Some(receipt.try_get("opened_by")?);
        }
        checker = Some(receipt.try_get("counted_by")?);
        verifier = Some(receipt.try_get("verified_by")?);
    }

    // Received when every line the document asked for has stopped waiting:
    // matched in full, closed short, or its order closed or cancelled.
    let asked: Vec<Uuid> = state.header.planned.keys().copied().collect();
    let still_waiting: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint
           FROM purchase_order_line pl
           JOIN purchase_order po ON po.purchase_order_id = pl.purchase_order_id
          WHERE pl.purchase_order_id = $1
            AND pl.po_line_id = ANY($2)
            AND pl.line_status = 'OPEN'
            AND po.order_status = 'ISSUED'
            AND COALESCE((SELECT sum(r.matched_quantity) FROM goods_receipt_line r
                           WHERE r.po_line_id = pl.po_line_id), 0)
                < pl.ordered_quantity - pl.cancelled_quantity",
    )
    .bind(order_id)
    .bind(&asked)
    .fetch_one(&mut **tx)
    .await?;
    let received = still_waiting == 0;
    let receipt_list = numbers.join(", ");
    progress.insert(
        StageKind::Arrival,
        StageProgress {
            started: true,
            finished: true,
            delivery_number: numbers.first().cloned(),
            actor: opener,
            ..StageProgress::default()
        },
    );
    progress.insert(
        StageKind::BlindCount,
        StageProgress {
            counts: counted,
            counted: true,
            started: true,
            finished: received,
            evidence: typed(format!("receipts {receipt_list}")),
            actor: checker,
            ..StageProgress::default()
        },
    );
    progress.insert(
        StageKind::Verification,
        StageProgress {
            started: true,
            finished: received,
            actor: verifier,
            ..StageProgress::default()
        },
    );

    let jobs = sqlx::query(
        "SELECT gl.po_line_id, j.job_id, j.total_quantity, j.confirmed_by
           FROM tagging_job j
           JOIN article_setup_session s ON s.session_id = j.session_id
           JOIN goods_receipt_line gl ON gl.receipt_line_id = s.receipt_line_id
           JOIN purchase_order_line pl ON pl.po_line_id = gl.po_line_id
          WHERE pl.purchase_order_id = $1 AND j.status = 'TAGGED'
          ORDER BY j.confirmed_at, j.job_id",
    )
    .bind(order_id)
    .fetch_all(&mut **tx)
    .await?;
    let mut tagged: BTreeMap<Uuid, i64> = BTreeMap::new();
    let mut job_ids: BTreeSet<Uuid> = BTreeSet::new();
    let mut tagger: Option<String> = None;
    for job in &jobs {
        let line: Uuid = job.try_get("po_line_id")?;
        *tagged.entry(line).or_insert(0) += job.try_get::<i64, _>("total_quantity")?;
        job_ids.insert(job.try_get("job_id")?);
        tagger = job.try_get("confirmed_by")?;
    }
    // Everything accepted against the order is tagged; what came beyond it
    // goes back to the supplier and is never tagged.
    let tagging_finished = received && covers(&tagged, &matched);
    let job_list = job_ids
        .iter()
        .map(Uuid::to_string)
        .collect::<Vec<_>>()
        .join(", ");

    let shelved = sqlx::query(
        "SELECT gl.po_line_id, line.quantity, step.actor_id, step.event_id
           FROM edge_goods_step step
           JOIN edge_goods_step_line line ON line.event_id = step.event_id
           JOIN tagging_job j ON j.job_id = step.tagging_job_id
           JOIN article_setup_session s ON s.session_id = j.session_id
           JOIN goods_receipt_line gl ON gl.receipt_line_id = s.receipt_line_id
           JOIN purchase_order_line pl ON pl.po_line_id = gl.po_line_id
          WHERE step.kind = 'PUT_AWAY' AND pl.purchase_order_id = $1
          ORDER BY step.occurred_at, step.event_id, line.line_no",
    )
    .bind(order_id)
    .fetch_all(&mut **tx)
    .await?;
    let mut put_away: BTreeMap<Uuid, i64> = BTreeMap::new();
    let mut putaways: BTreeSet<Uuid> = BTreeSet::new();
    let mut shelver: Option<String> = None;
    for step in &shelved {
        let line: Uuid = step.try_get("po_line_id")?;
        *put_away.entry(line).or_insert(0) += step.try_get::<i64, _>("quantity")?;
        putaways.insert(step.try_get("event_id")?);
        shelver = Some(step.try_get("actor_id")?);
    }
    let putaway_finished = tagging_finished && covers(&put_away, &tagged);
    let putaway_list = putaways
        .iter()
        .map(Uuid::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    progress.insert(
        StageKind::Tagging,
        StageProgress {
            counted: true,
            started: !job_ids.is_empty(),
            finished: tagging_finished,
            evidence: scanned(format!("tagging jobs {job_list}")),
            actor: tagger,
            counts: tagged,
            ..StageProgress::default()
        },
    );
    progress.insert(
        StageKind::Putaway,
        StageProgress {
            counted: true,
            started: !putaways.is_empty(),
            finished: putaway_finished,
            evidence: typed(format!("putaways {putaway_list}")),
            actor: shelver,
            counts: put_away,
            ..StageProgress::default()
        },
    );
    Ok(progress)
}

// ---- node → flow: the facts that had no home ---------------------------------------

/// The site a node runs as, in the centre's spelling. Read from its
/// registration, never from what the fact says about itself.
async fn node_site_tx(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
) -> Result<String, AppError> {
    let spelled = super::sync::origin_site_id_tx(tx, origin_id).await?;
    super::sync::canonical_site_id_tx(tx, &spelled).await
}

/// One goods step and its lines, written once. `false`: already kept.
#[allow(clippy::too_many_arguments)]
async fn keep_goods_step_tx(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    event_id: Uuid,
    kind: &str,
    site_id: &str,
    delivery: Option<(&str, &str, Option<&str>)>,
    tagging_job_id: Option<Uuid>,
    actor_id: &str,
    occurred_at: DateTime<Utc>,
    payload: Value,
    lines: &[(Option<Uuid>, &str, i64, i64, i64)],
) -> Result<bool, AppError> {
    let (delivery_id, source_site_id, shipment_reference) = match delivery {
        Some((delivery_id, source_site_id, shipment_reference)) => {
            (Some(delivery_id), Some(source_site_id), shipment_reference)
        }
        None => (None, None, None),
    };
    let inserted = sqlx::query(
        "INSERT INTO edge_goods_step
             (event_id, origin_id, generation, seq, kind, site_id, delivery_id, source_site_id,
              shipment_reference, tagging_job_id, actor_id, occurred_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT DO NOTHING",
    )
    .bind(event_id)
    .bind(origin_id)
    .bind(generation)
    .bind(seq)
    .bind(kind)
    .bind(site_id)
    .bind(delivery_id)
    .bind(source_site_id)
    .bind(shipment_reference)
    .bind(tagging_job_id)
    .bind(actor_id.trim())
    .bind(occurred_at)
    .bind(payload)
    .execute(&mut **tx)
    .await?
    .rows_affected()
        == 1;
    if !inserted {
        return Ok(false);
    }
    for (index, (allotment_line_id, sku_code, expected, quantity, damaged)) in
        lines.iter().enumerate()
    {
        sqlx::query(
            "INSERT INTO edge_goods_step_line
                 (event_id, line_no, allotment_line_id, sku_code, expected, quantity, damaged)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(event_id)
        .bind(i32::try_from(index + 1).unwrap_or(i32::MAX))
        .bind(allotment_line_id)
        .bind(sku_code.trim())
        .bind(expected)
        .bind(quantity)
        .bind(damaged)
        .execute(&mut **tx)
        .await?;
    }
    Ok(true)
}

/// The allotments some allotment lines belong to.
async fn allotments_of_lines_tx(
    tx: &mut Transaction<'_, Postgres>,
    line_ids: &[Uuid],
) -> Result<Vec<Uuid>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT DISTINCT allotment_id FROM allotment_line WHERE id = ANY($1) ORDER BY allotment_id",
    )
    .bind(line_ids)
    .fetch_all(&mut **tx)
    .await?)
}

/// Move each allotment's flow to this site.
async fn resume_allotments_tx(
    tx: &mut Transaction<'_, Postgres>,
    line_ids: &[Uuid],
    site_id: &str,
    fact: &NodeFact<'_>,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    for allotment_id in allotments_of_lines_tx(tx, line_ids).await? {
        let source = FlowSource {
            kind: SourceKind::Allotment,
            id: allotment_id.to_string(),
        };
        resume_from_node_fact_tx(tx, &source, Some(site_id), fact, at).await?;
    }
    Ok(())
}

/// A site of ours received an announced delivery
/// (`inventory.inbound.received.v1`): kept, and the flows of the allotments
/// it carried to this site move with it.
pub(super) async fn apply_inbound_received_tx(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    event_id: Uuid,
    received: &InboundReceivedPayload,
) -> Result<(), AppError> {
    if event_id != received.receipt_id {
        return Err(AppError::Validation(
            "an inbound receipt's receipt_id must equal its event_id".into(),
        ));
    }
    let site_id = node_site_tx(tx, origin_id).await?;
    let lines: Vec<(Option<Uuid>, &str, i64, i64, i64)> = received
        .lines
        .iter()
        .map(|line| {
            (
                line.allotment_line_id,
                line.sku_code.as_str(),
                line.expected,
                line.received,
                0,
            )
        })
        .collect();
    let kept = keep_goods_step_tx(
        tx,
        origin_id,
        generation,
        seq,
        event_id,
        "RECEIVED",
        &site_id,
        Some((
            received.delivery_id.as_str(),
            received.source_site_id.as_str(),
            received.shipment_reference.as_deref(),
        )),
        None,
        &received.received_by,
        received.received_at,
        serde_json::to_value(received)?,
        &lines,
    )
    .await?;
    if !kept {
        return Ok(());
    }
    let line_ids: Vec<Uuid> = received
        .lines
        .iter()
        .filter_map(|line| line.allotment_line_id)
        .collect();
    let fact = NodeFact {
        origin_id,
        event_type: INVENTORY_INBOUND_RECEIVED_V1,
        event_id,
        stage: StageKind::Receive,
        actor_id: Some(received.received_by.as_str()),
    };
    resume_allotments_tx(tx, &line_ids, &site_id, &fact, received.received_at).await
}

/// The Gudang inspected a store's return (`inventory.return.inspected.v1`).
pub(super) async fn apply_return_inspected_tx(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    event_id: Uuid,
    inspected: &ReturnInspectedPayload,
) -> Result<(), AppError> {
    if event_id != inspected.inspection_id {
        return Err(AppError::Validation(
            "an inspection's inspection_id must equal its event_id".into(),
        ));
    }
    let site_id = node_site_tx(tx, origin_id).await?;
    let lines: Vec<(Option<Uuid>, &str, i64, i64, i64)> = inspected
        .lines
        .iter()
        .map(|line| {
            (
                line.allotment_line_id,
                line.sku_code.as_str(),
                0,
                line.good + line.damaged,
                line.damaged,
            )
        })
        .collect();
    let kept = keep_goods_step_tx(
        tx,
        origin_id,
        generation,
        seq,
        event_id,
        "INSPECTED",
        &site_id,
        Some((
            inspected.delivery_id.as_str(),
            inspected.source_site_id.as_str(),
            inspected.shipment_reference.as_deref(),
        )),
        None,
        &inspected.inspected_by,
        inspected.inspected_at,
        serde_json::to_value(inspected)?,
        &lines,
    )
    .await?;
    if !kept {
        return Ok(());
    }
    let line_ids: Vec<Uuid> = inspected
        .lines
        .iter()
        .filter_map(|line| line.allotment_line_id)
        .collect();
    let fact = NodeFact {
        origin_id,
        event_type: INVENTORY_RETURN_INSPECTED_V1,
        event_id,
        stage: StageKind::Inspect,
        actor_id: Some(inspected.inspected_by.as_str()),
    };
    resume_allotments_tx(tx, &line_ids, &site_id, &fact, inspected.inspected_at).await
}

/// The Gudang put a tagged job's goods away (`inventory.putaway.v1`).
pub(super) async fn apply_putaway_tx(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    event_id: Uuid,
    putaway: &PutawayPayload,
) -> Result<(), AppError> {
    if event_id != putaway.putaway_id {
        return Err(AppError::Validation(
            "a putaway's putaway_id must equal its event_id".into(),
        ));
    }
    let site_id = node_site_tx(tx, origin_id).await?;
    let lines: Vec<(Option<Uuid>, &str, i64, i64, i64)> = putaway
        .lines
        .iter()
        .map(|line| (None, line.sku_code.as_str(), 0, line.quantity, 0))
        .collect();
    let kept = keep_goods_step_tx(
        tx,
        origin_id,
        generation,
        seq,
        event_id,
        "PUT_AWAY",
        &site_id,
        None,
        Some(putaway.job_id),
        &putaway.put_away_by,
        putaway.put_away_at,
        serde_json::to_value(putaway)?,
        &lines,
    )
    .await?;
    if !kept {
        return Ok(());
    }
    let fact = NodeFact {
        origin_id,
        event_type: INVENTORY_PUTAWAY_V1,
        event_id,
        stage: StageKind::Putaway,
        actor_id: Some(putaway.put_away_by.as_str()),
    };
    resume_tagging_job_tx(tx, putaway.job_id, &fact, putaway.put_away_at).await
}

/// The purchase order a tagging job's goods were bought on moves its flow.
pub(super) async fn resume_tagging_job_tx(
    tx: &mut Transaction<'_, Postgres>,
    job_id: Uuid,
    fact: &NodeFact<'_>,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let orders: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT pl.purchase_order_id
           FROM tagging_job j
           JOIN article_setup_session s ON s.session_id = j.session_id
           JOIN goods_receipt_line gl ON gl.receipt_line_id = s.receipt_line_id
           JOIN purchase_order_line pl ON pl.po_line_id = gl.po_line_id
          WHERE j.job_id = $1",
    )
    .bind(job_id)
    .fetch_all(&mut **tx)
    .await?;
    for order_id in orders {
        let source = FlowSource {
            kind: SourceKind::PurchaseOrder,
            id: order_id.to_string(),
        };
        resume_from_node_fact_tx(tx, &source, None, fact, at).await?;
    }
    Ok(())
}
