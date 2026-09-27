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
    FlowEventNotice, FlowEventsPayload, InboundReceivedPayload, ReturnInspectedPayload,
    FLOWS_CAPABILITY, INVENTORY_FLOW_EVENTS_V1, INVENTORY_INBOUND_RECEIVED_V1,
    INVENTORY_RETURN_INSPECTED_V1,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
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
        // Kept in the catalogue because stored template versions name it
        // (TERIMA_DARI_SUPPLIER v1, 0619) and the database's stage CHECKs
        // list it; no current template uses it, and nothing runs it.
        StageKind::Putaway => (
            Wiring::Missing,
            "none: putaway is not part of the company's process",
            None,
            "Tagging already lands the goods on the racks. No current template uses this stage.",
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

// ---- flow → nodes and books: after every stage ----------------------------------------

/// Called in the stage's own transaction, after the flow's rows are written:
/// the journal meanings the stage produced are posted ([`post_document_postings_tx`])
/// and everything it produced goes to the nodes of the sites it touches
/// ([`relay_document_events_tx`]).
///
/// Neither can fail the stage. A meaning that cannot be posted stays PENDING
/// with its reason (0618's trigger only asks that it exists), and an event a
/// node cannot take yet waits for that node.
pub(super) async fn after_stage_tx(
    tx: &mut Transaction<'_, Postgres>,
    document: &DocumentRow,
    _state: &FlowState,
    stage_index: usize,
    effects: &[Effect],
    actor: &Actor,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    if effects
        .iter()
        .any(|effect| matches!(effect, Effect::Journal { .. }))
    {
        post_document_postings_tx(tx, document.id, Some(stage_index), &actor.id, at).await?;
    }
    relay_document_events_tx(tx, document, at).await
}

// ---- the meanings, posted -----------------------------------------------------------

/// A line of a flow posting as 0618 stores it: a SKU and a quantity.
#[derive(Debug, Deserialize)]
struct PostingQuantity {
    sku_id: Uuid,
    quantity: i64,
}

/// A flow posting waiting to be booked.
struct PendingPosting {
    id: Uuid,
    meaning: String,
    from_unit: Option<String>,
    to_unit: Option<String>,
    lines: Vec<PostingQuantity>,
}

/// What came of trying to post one meaning.
enum Booking {
    /// Posted, in these journal entries; the first becomes the posting's.
    Posted {
        entries: Vec<Uuid>,
        note: Option<String>,
    },
    /// Not posted, and why. Tried again by [`post_pending_flow_postings`].
    Held(String),
}

/// Post a document's PENDING meanings — one stage's, or all of them — each
/// in its own savepoint: a meaning that cannot be posted is rolled back whole
/// and keeps its reason, and the others go on. Returns how many posted.
async fn post_document_postings_tx(
    tx: &mut Transaction<'_, Postgres>,
    document_id: Uuid,
    stage_index: Option<usize>,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<usize, AppError> {
    let rows = sqlx::query(
        "SELECT id, meaning, from_unit_id, to_unit_id, lines
           FROM flow_posting
          WHERE document_id = $1 AND status = 'PENDING'
            AND ($2::int IS NULL OR stage_index = $2)
          ORDER BY created_at, id",
    )
    .bind(document_id)
    .bind(stage_index.and_then(|index| i32::try_from(index).ok()))
    .fetch_all(&mut **tx)
    .await?;
    if rows.is_empty() {
        return Ok(0);
    }
    let document = flows::load_document(&mut **tx, document_id, false).await?;
    let mut posted = 0;
    for row in &rows {
        let posting = PendingPosting {
            id: row.try_get("id")?,
            meaning: row.try_get("meaning")?,
            from_unit: row.try_get("from_unit_id")?,
            to_unit: row.try_get("to_unit_id")?,
            lines: serde_json::from_value(row.try_get::<Value, _>("lines")?)?,
        };
        let mut savepoint = sqlx::Connection::begin(&mut **tx).await?;
        let booking = post_meaning_tx(&mut savepoint, &document, &posting, actor, at).await;
        match booking {
            Ok(Booking::Posted { entries, note }) => {
                for entry in &entries {
                    sqlx::query(
                        "INSERT INTO flow_posting_entry (posting_id, journal_entry_id)
                         VALUES ($1, $2) ON CONFLICT DO NOTHING",
                    )
                    .bind(posting.id)
                    .bind(entry)
                    .execute(&mut *savepoint)
                    .await?;
                }
                sqlx::query(
                    "UPDATE flow_posting
                        SET status = 'POSTED', journal_entry_id = $2, posted_at = $3,
                            note = $4, attempted_at = $3
                      WHERE id = $1 AND status = 'PENDING'",
                )
                .bind(posting.id)
                .bind(entries.first())
                .bind(at)
                .bind(note.as_deref())
                .execute(&mut *savepoint)
                .await?;
                savepoint.commit().await?;
                posted += 1;
            }
            Ok(Booking::Held(reason)) => {
                savepoint.rollback().await?;
                hold_posting_tx(tx, posting.id, &reason, at).await?;
            }
            Err(error) => {
                savepoint.rollback().await?;
                hold_posting_tx(tx, posting.id, &problem_text(&error), at).await?;
            }
        }
    }
    Ok(posted)
}

async fn hold_posting_tx(
    tx: &mut Transaction<'_, Postgres>,
    posting_id: Uuid,
    reason: &str,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    sqlx::query("UPDATE flow_posting SET note = $2, attempted_at = $3 WHERE id = $1")
        .bind(posting_id)
        .bind(reason)
        .bind(at)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// One meaning, through the poster. A meaning is never an account: the lines
/// name meanings and the account map resolves them for each unit (I9).
async fn post_meaning_tx(
    tx: &mut Transaction<'_, Postgres>,
    document: &DocumentRow,
    posting: &PendingPosting,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<Booking, AppError> {
    match posting.meaning.as_str() {
        "INTERUNIT_GOODS_DISPATCHED" => {
            post_interunit_goods_tx(tx, document, posting, "DISPATCH", actor, at).await
        }
        "INTERUNIT_GOODS_RECEIVED" => {
            post_interunit_goods_tx(tx, document, posting, "RECEIPT", actor, at).await
        }
        "SUPPLIER_RETURN_HANDED_OVER" => {
            post_supplier_return_tx(tx, document, posting, actor, at).await
        }
        other => Ok(Booking::Held(format!(
            "this build has no posting rule for the meaning {other}"
        ))),
    }
}

/// Inter-unit goods, dispatched or received, in the SJD shape the client
/// accountant set (`stock_ledger::sjd_transfer_lines`), per allotment line and
/// in the books of the two units (0605).
///
/// What each line owes the books is read from the line itself — what left
/// (`in_transit_total`) for a dispatch, what came off the lorry in the
/// deliveries received for a receipt, so custody of goods not found moves
/// with the rest (allotment ALT-INV-00) — less what is already booked in
/// `stock_transfer_posting`, which the allotment sweep writes too. So a move
/// is booked once, by whichever of the two reaches it first.
///
/// A move between two stores crosses through head office (I8), and neither
/// the client accountant nor Finance has set how; it is held for Finance
/// rather than invented, as the sweep leaves it.
async fn post_interunit_goods_tx(
    tx: &mut Transaction<'_, Postgres>,
    document: &DocumentRow,
    posting: &PendingPosting,
    stage: &str,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<Booking, AppError> {
    let (Some(from_unit), Some(to_unit)) =
        (posting.from_unit.as_deref(), posting.to_unit.as_deref())
    else {
        return Ok(Booking::Held(
            "an inter-unit meaning names the unit on each side".into(),
        ));
    };
    let head_office = super::sites::head_office_unit_id(&mut **tx).await?;
    if from_unit != head_office && to_unit != head_office {
        return Ok(Booking::Held(format!(
            "goods moved from {from_unit} to {to_unit}, two stores, which cross through head office (I8); no posting rule is set for that yet, so Finance posts it"
        )));
    }
    if SourceKind::parse(&document.source_kind) != Some(SourceKind::Allotment) {
        return Ok(Booking::Held(
            "inter-unit goods are booked per allotment line, and this flow runs no allotment"
                .into(),
        ));
    }
    let Ok(allotment_id) = Uuid::parse_str(document.source_id.trim()) else {
        return Ok(Booking::Held(format!(
            "allotment {} is not an id",
            document.source_id
        )));
    };
    let named: BTreeSet<Uuid> = posting
        .lines
        .iter()
        .filter(|line| line.quantity > 0)
        .map(|line| line.sku_id)
        .collect();
    let lines = document_lines_tx(tx, document, allotment_id).await?;
    let lines: Vec<&DocumentLine> = lines
        .iter()
        .filter(|line| named.contains(&line.sku_id))
        .collect();
    if lines.is_empty() {
        return Ok(Booking::Held(
            "none of the posting's SKUs is on an allotment line of this flow".into(),
        ));
    }
    let line_ids: Vec<Uuid> = lines.iter().map(|line| line.line_id).collect();
    let moved: BTreeMap<Uuid, i64> = if stage == "DISPATCH" {
        sqlx::query(
            "SELECT allotment_line_id, COALESCE(in_transit_total, 0)::bigint AS moved
               FROM allotment_line_commitment WHERE allotment_line_id = ANY($1)",
        )
        .bind(&line_ids)
        .fetch_all(&mut **tx)
        .await?
        .iter()
        .map(|row| -> Result<(Uuid, i64), AppError> {
            Ok((row.try_get("allotment_line_id")?, row.try_get("moved")?))
        })
        .collect::<Result<_, AppError>>()?
    } else {
        sqlx::query(
            "SELECT line.allotment_line_id, sum(line.expected)::bigint AS moved
               FROM edge_goods_step_line line
               JOIN edge_goods_step step ON step.event_id = line.event_id
              WHERE step.kind = 'RECEIVED' AND line.allotment_line_id = ANY($1)
              GROUP BY line.allotment_line_id",
        )
        .bind(&line_ids)
        .fetch_all(&mut **tx)
        .await?
        .iter()
        .map(|row| -> Result<(Uuid, i64), AppError> {
            Ok((row.try_get("allotment_line_id")?, row.try_get("moved")?))
        })
        .collect::<Result<_, AppError>>()?
    };

    let date = at.date_naive();
    let mut entries = Vec::new();
    for line in lines {
        let target = moved.get(&line.line_id).copied().unwrap_or(0);
        // The allotment sweep books these lines too: one writer at a time.
        super::lock_transfer_line(tx, line.line_id).await?;
        let booked = super::transfer_booked(tx, line.line_id, stage).await?;
        let delta = target - booked;
        if delta <= 0 {
            continue;
        }
        let supply = super::article_is_supply(tx, line.article_id).await?;
        let unit = super::transfer_unit_cost(tx, line.article_id).await?;
        let value = unit.saturating_mul(delta);
        let entry = if value > 0 {
            let posted = super::poster::post(
                tx,
                &super::poster::PostingIntent {
                    posting_date: date,
                    source_kind: "TRANSFER".into(),
                    source_id: Some(line.line_id.to_string()),
                    rule_version: "sjd_transfer/1".into(),
                    currency: "IDR".into(),
                    memo: Some(format!(
                        "{stage} {delta} unit {from_unit} -> {to_unit} ({})",
                        document.number
                    )),
                    lines: super::sjd_transfer_lines(stage, from_unit, to_unit, value, supply),
                },
                Some(&format!("FLOW_{stage}_{booked}_{target}")),
                actor,
            )
            .await?;
            Some(posted.entry_id)
        } else {
            None
        };
        sqlx::query(
            "INSERT INTO stock_transfer_posting
               (allotment_line_id, stage, quantity, value_minor, journal_entry_id)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(line.line_id)
        .bind(stage)
        .bind(delta)
        .bind(value)
        .bind(entry)
        .execute(&mut **tx)
        .await?;
        entries.extend(entry);
    }
    if !entries.is_empty() {
        return Ok(Booking::Posted {
            entries,
            note: None,
        });
    }
    // Nothing left to book: the sweep got there first, or it moved at no value.
    let earlier: Vec<Uuid> = sqlx::query_scalar(
        "SELECT journal_entry_id FROM stock_transfer_posting
          WHERE allotment_line_id = ANY($1) AND stage = $2 AND journal_entry_id IS NOT NULL
          ORDER BY posted_at, journal_entry_id",
    )
    .bind(&line_ids)
    .bind(stage)
    .fetch_all(&mut **tx)
    .await?;
    if earlier.is_empty() {
        return Ok(Booking::Held(
            "nothing to book yet: the lines moved at no value, or their goods have not moved"
                .into(),
        ));
    }
    Ok(Booking::Posted {
        entries: earlier,
        note: Some("already booked by the allotment sweep (stock_transfer_posting)".into()),
    })
}

/// Goods handed back to a supplier: head office owes it less
/// (`stock_ledger_return_to_supplier`, CREDIT_NOTE).
///
/// A supplier return goes back to the receipt the goods came from and never
/// to the head of the queue (the stock ledger's own rule). A flow knows the
/// SKU and not the receipt, so it posts only where that is certain — the
/// article has goods left on exactly one receipt — and holds the rest for
/// Finance to name the receipt, rather than choosing one.
async fn post_supplier_return_tx(
    tx: &mut Transaction<'_, Postgres>,
    document: &DocumentRow,
    posting: &PendingPosting,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<Booking, AppError> {
    let Some(site_id) = document.origin_site_id.as_deref() else {
        return Ok(Booking::Held(
            "a return to a supplier leaves from one of our sites".into(),
        ));
    };
    let from_pool_id =
        super::sites::pool_of_role(&mut **tx, site_id, crate::pool_role::PoolRole::InTransit)
            .await?
            .unwrap_or_else(|| format!("{site_id}.warehouse"));
    let mut entries = Vec::new();
    for line in &posting.lines {
        if line.quantity <= 0 {
            continue;
        }
        let article: Option<Uuid> = sqlx::query_scalar("SELECT article_id FROM sku WHERE id = $1")
            .bind(line.sku_id)
            .fetch_optional(&mut **tx)
            .await?;
        let Some(article_id) = article else {
            return Ok(Booking::Held(format!(
                "SKU {} is not one of ours",
                line.sku_id
            )));
        };
        let layers: Vec<Uuid> = sqlx::query_scalar(
            "SELECT layer_id FROM cost_layer_remaining
              WHERE article_id = $1 AND remaining_quantity > 0
              ORDER BY economic_date, layer_id",
        )
        .bind(article_id)
        .fetch_all(&mut **tx)
        .await?;
        let [layer_id] = layers.as_slice() else {
            return Ok(Booking::Held(format!(
                "a supplier return goes back to the receipt its goods came from, and SKU {} has goods left on {} receipts; Finance names the receipt",
                line.sku_id,
                layers.len()
            )));
        };
        let returned = super::stock_ledger_return_to_supplier(
            tx,
            &super::SupplierReturn {
                layer_id: *layer_id,
                quantity: line.quantity,
                event_id: format!("flow:{}:{}", posting.id, line.sku_id),
                from_pool_id: from_pool_id.clone(),
                site_id: site_id.to_owned(),
                economic_date: at.date_naive(),
                source_id: posting.id.to_string(),
                memo: Some(format!(
                    "{} returned to the supplier ({})",
                    line.quantity, document.number
                )),
            },
            actor,
        )
        .await?;
        entries.extend(returned.journal_entry_id);
    }
    if entries.is_empty() {
        return Ok(Booking::Held(
            "nothing to book: the goods returned are valued at nothing".into(),
        ));
    }
    Ok(Booking::Posted {
        entries,
        note: None,
    })
}

/// Try again every flow posting still PENDING — a period reopened, a source
/// allowed, the sweep booked it meanwhile — one transaction per document.
/// Returns how many posted. Run beside the allotment sweep.
pub async fn post_pending_flow_postings(
    pool: &sqlx::PgPool,
    actor: &str,
) -> Result<usize, AppError> {
    let documents: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT document_id FROM flow_posting
          WHERE status = 'PENDING'
          ORDER BY document_id
          LIMIT 200",
    )
    .fetch_all(pool)
    .await?;
    let mut posted = 0;
    for document_id in documents {
        let mut tx = pool.begin().await?;
        posted += post_document_postings_tx(&mut tx, document_id, None, actor, Utc::now()).await?;
        tx.commit().await?;
    }
    Ok(posted)
}

// ---- the outbox, relayed ------------------------------------------------------------

/// How many documents one heartbeat relays waiting events for.
const FLOW_RELAYS_PER_HEARTBEAT: i64 = 200;

/// Whether a node's build takes the flow commands, as its latest heartbeat
/// says (`sync::flow::FLOWS_CAPABILITY`).
async fn origin_takes_flows_tx(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar::<_, bool>(
        "SELECT COALESCE(status->'capabilities' ? $2, false)
           FROM node_heartbeat WHERE origin_id = $1",
    )
    .bind(origin_id)
    .bind(FLOWS_CAPABILITY)
    .fetch_optional(&mut **tx)
    .await?
    .unwrap_or(false))
}

/// Carry a document's outbox to the nodes of the sites it touches: each
/// event to the node of its stage's site, and the document's own status to
/// the nodes at both ends. One command per node, carrying every event of the
/// document that node does not have yet, in order.
///
/// A node that does not advertise `inventory.flows.v1` is sent nothing — an
/// older build blocks its whole command stream on an unknown type — and its
/// events wait for [`relay_waiting_flow_events_tx`]. Never fails the stage
/// that wrote the events: a relay that trips is rolled back to its savepoint,
/// logged, and tried again by the next.
pub(super) async fn relay_document_events_tx(
    tx: &mut Transaction<'_, Postgres>,
    document: &DocumentRow,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let mut savepoint = sqlx::Connection::begin(&mut **tx).await?;
    match relay_events_tx(&mut savepoint, document, at).await {
        Ok(()) => savepoint.commit().await?,
        Err(error) => {
            savepoint.rollback().await?;
            tracing::warn!(
                document = %document.number,
                %error,
                "a flow's events could not be relayed now; they wait for the next relay"
            );
        }
    }
    Ok(())
}

async fn relay_events_tx(
    tx: &mut Transaction<'_, Postgres>,
    document: &DocumentRow,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let events = sqlx::query(
        "SELECT e.id, e.stage_index, s.stage_kind, e.event_type, e.executed_at,
                e.target_site_id, e.payload, e.created_at
           FROM flow_event e
           LEFT JOIN flow_stage_state s
                  ON s.document_id = e.document_id AND s.stage_index = e.stage_index
          WHERE e.document_id = $1 AND e.relayed_at IS NULL
          ORDER BY e.id",
    )
    .bind(document.id)
    .fetch_all(&mut **tx)
    .await?;
    if events.is_empty() {
        return Ok(());
    }

    // Each site's node, and whether it takes flows: asked once per site.
    let mut nodes: BTreeMap<String, Option<(String, bool)>> = BTreeMap::new();
    let mut outgoing: BTreeMap<String, Vec<FlowEventNotice>> = BTreeMap::new();
    let mut everywhere: Vec<i64> = Vec::new();
    for event in &events {
        let id: i64 = event.try_get("id")?;
        let target: Option<String> = event.try_get("target_site_id")?;
        let sites: Vec<String> = match &target {
            Some(site) => vec![site.clone()],
            None => [
                document.origin_site_id.clone(),
                document.destination_site_id.clone(),
            ]
            .into_iter()
            .flatten()
            .collect(),
        };
        let has: Vec<String> =
            sqlx::query_scalar("SELECT origin_id FROM flow_event_delivery WHERE event_id = $1")
                .bind(id)
                .fetch_all(&mut **tx)
                .await?;
        let notice = FlowEventNotice {
            event_id: id,
            stage_index: event.try_get("stage_index")?,
            stage_kind: event.try_get("stage_kind")?,
            event_type: event.try_get("event_type")?,
            executed_at: event.try_get("executed_at")?,
            target_site_id: target.clone(),
            payload: event.try_get("payload")?,
            created_at: event.try_get("created_at")?,
        };
        let mut all_told = true;
        for site in sites {
            let node = match nodes.get(&site) {
                Some(node) => node.clone(),
                None => {
                    let node = match super::sync::inventory_owner_tx(tx, &site).await? {
                        Some(origin_id) => {
                            let takes = origin_takes_flows_tx(tx, &origin_id).await?;
                            Some((origin_id, takes))
                        }
                        None => None,
                    };
                    nodes.insert(site.clone(), node.clone());
                    node
                }
            };
            // A site no node owns has nobody to tell.
            let Some((origin_id, takes)) = node else {
                continue;
            };
            if has.contains(&origin_id) {
                continue;
            }
            if !takes {
                all_told = false;
                continue;
            }
            let queue = outgoing.entry(origin_id).or_default();
            if !queue.iter().any(|queued| queued.event_id == id) {
                queue.push(notice.clone());
            }
        }
        if all_told {
            everywhere.push(id);
        }
    }

    if !outgoing.is_empty() {
        let status: String = sqlx::query_scalar("SELECT status FROM flow_document WHERE id = $1")
            .bind(document.id)
            .fetch_one(&mut **tx)
            .await?;
        let current_stage: Option<String> = sqlx::query_scalar(
            "SELECT stage_kind FROM flow_stage_state
              WHERE document_id = $1 AND status IN ('PENDING', 'PARKED')
              ORDER BY stage_index LIMIT 1",
        )
        .bind(document.id)
        .fetch_optional(&mut **tx)
        .await?;
        for (origin_id, notices) in outgoing {
            // The ends as this node spells our sites: the Gudang's node calls
            // itself its own way (inventory-fleet G1).
            let origin_site_id = match document.origin_site_id.as_deref() {
                Some(site) => Some(super::sync::node_site_id_tx(tx, site).await?),
                None => None,
            };
            let destination_site_id = match document.destination_site_id.as_deref() {
                Some(site) => Some(super::sync::node_site_id_tx(tx, site).await?),
                None => None,
            };
            let payload = FlowEventsPayload {
                document_id: document.id,
                document_number: document.number.clone(),
                template_code: document.template_code.clone(),
                template_name: document.template_name.clone(),
                source_kind: document.source_kind.clone(),
                source_id: document.source_id.clone(),
                origin_site_id,
                destination_site_id,
                destination_party_kind: document.destination_party_kind.clone(),
                status: status.clone(),
                current_stage: current_stage.clone(),
                events: notices,
            };
            let command_id = super::sync::issue_command_tx(
                tx,
                INVENTORY_FLOW_EVENTS_V1,
                &serde_json::to_value(&payload)?,
                "system:flow-relay",
                None,
                std::slice::from_ref(&origin_id),
            )
            .await?;
            for notice in &payload.events {
                sqlx::query(
                    "INSERT INTO flow_event_delivery (event_id, origin_id, command_id, relayed_at)
                     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
                )
                .bind(notice.event_id)
                .bind(&origin_id)
                .bind(command_id)
                .bind(at)
                .execute(&mut **tx)
                .await?;
            }
        }
    }
    if !everywhere.is_empty() {
        sqlx::query(
            "UPDATE flow_event SET relayed_at = $2 WHERE id = ANY($1) AND relayed_at IS NULL",
        )
        .bind(&everywhere)
        .bind(at)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// The events a node was not sent while its build could not take them, sent
/// once its heartbeat says it can (`postgres::node_health`). A bounded
/// instalment of documents per heartbeat. Returns how many were considered.
pub(super) async fn relay_waiting_flow_events_tx(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    at: DateTime<Utc>,
) -> Result<usize, AppError> {
    let site_id = node_site_tx(tx, origin_id).await?;
    let documents: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT e.document_id
           FROM flow_event e
           JOIN flow_document d ON d.id = e.document_id
          WHERE e.relayed_at IS NULL
            AND (e.target_site_id = $1
                 OR (e.target_site_id IS NULL
                     AND (d.origin_site_id = $1 OR d.destination_site_id = $1)))
            AND NOT EXISTS (SELECT 1 FROM flow_event_delivery x
                             WHERE x.event_id = e.id AND x.origin_id = $2)
          ORDER BY e.document_id
          LIMIT $3",
    )
    .bind(&site_id)
    .bind(origin_id)
    .bind(FLOW_RELAYS_PER_HEARTBEAT)
    .fetch_all(&mut **tx)
    .await?;
    for document_id in &documents {
        let document = flows::load_document(&mut **tx, *document_id, false).await?;
        relay_document_events_tx(tx, &document, at).await?;
    }
    Ok(documents.len())
}

/// The allotment lines a document runs: the allotment's lines to the
/// document's destination (a site in the centre's spelling, or the supplier)
/// from its origin.
struct DocumentLine {
    line_id: Uuid,
    sku_id: Uuid,
    article_id: Uuid,
}

async fn document_lines_tx(
    tx: &mut Transaction<'_, Postgres>,
    document: &DocumentRow,
    allotment_id: Uuid,
) -> Result<Vec<DocumentLine>, AppError> {
    let rows = sqlx::query(
        "SELECT l.id, l.sku_id, sku.article_id, l.destination_type, l.destination_id,
                l.source_site_id
           FROM allotment_line l
           JOIN sku ON sku.id = l.sku_id
          WHERE l.allotment_id = $1
          ORDER BY l.id",
    )
    .bind(allotment_id)
    .fetch_all(&mut **tx)
    .await?;
    let mut spellings: BTreeMap<String, String> = BTreeMap::new();
    let mut lines = Vec::new();
    for row in &rows {
        let destination_type: Option<String> = row.try_get("destination_type")?;
        let destination_id: Option<String> = row.try_get("destination_id")?;
        let source_site_id: Option<String> = row.try_get("source_site_id")?;
        if !belongs_to_document_tx(
            tx,
            &mut spellings,
            document,
            destination_type.as_deref(),
            destination_id.as_deref(),
            source_site_id.as_deref(),
        )
        .await?
        {
            continue;
        }
        lines.push(DocumentLine {
            line_id: row.try_get("id")?,
            sku_id: row.try_get("sku_id")?,
            article_id: row.try_get("article_id")?,
        });
    }
    Ok(lines)
}

/// Whether an allotment line runs under this document: it goes to the
/// document's destination and leaves from its origin, each read in the
/// centre's spelling (a node may spell the Gudang its own way, G1).
async fn belongs_to_document_tx(
    tx: &mut Transaction<'_, Postgres>,
    spellings: &mut BTreeMap<String, String>,
    document: &DocumentRow,
    destination_type: Option<&str>,
    destination_id: Option<&str>,
    source_site_id: Option<&str>,
) -> Result<bool, AppError> {
    let to_supplier = destination_type == Some("SUPPLIER");
    let goes_there = match (
        document.destination_site_id.as_deref(),
        document.destination_party_kind.as_deref(),
    ) {
        (Some(site), _) if !to_supplier => match destination_id {
            Some(spelled) => canonical_tx(tx, spellings, spelled).await? == site,
            None => false,
        },
        (None, Some("SUPPLIER")) => to_supplier,
        _ => false,
    };
    if !goes_there {
        return Ok(false);
    }
    match (document.origin_site_id.as_deref(), source_site_id) {
        (Some(origin), Some(spelled)) => Ok(canonical_tx(tx, spellings, spelled).await? == origin),
        _ => Ok(true),
    }
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
        // The node acts as the stage's performer: judged by that role's rung,
        // with no job role of its own to ask.
        Actor {
            id,
            rung: stage.stage.performer.min_role(),
            flow_roles: None,
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
        let source_site_id: Option<String> = line.try_get("source_site_id")?;
        if !belongs_to_document_tx(
            tx,
            &mut spellings,
            row,
            destination_type.as_deref(),
            destination_id.as_deref(),
            source_site_id.as_deref(),
        )
        .await?
        {
            continue;
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

/// A supplier's goods: the order's accepted receipt lines and its tagging
/// jobs. Line keys are purchase lines (`flow_document_line`).
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
              shipment_reference, actor_id, occurred_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
