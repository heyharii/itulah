//! Stage handlers: where each stage's work is done today, and the adapters
//! that connect it to a flow document.
//!
//! The flow engine does not re-implement picking, packing, a blind count or a
//! store receipt. Those exist, on the node that owns the site's ledger, and a
//! node is the only machine entitled to write its site's movements. So a
//! stage whose work happens on a node is connected in two directions:
//!
//! * **node → flow**: when the node's fact arrives (a pick, a departure, a
//!   receipt), [`resume_from_node_fact_tx`] turns it into the stage's actions
//!   and applies them through the same code a hub confirm runs — one
//!   transaction, keyed by the stage (`<document>:<STAGE_KIND>`), so a fact
//!   delivered twice resumes the stage once;
//! * **flow → node**: a stage confirmed in the hub writes its movements to the
//!   outbox (`flow_event`), for the relay to carry to the owning node.
//!
//! [`stage_delegate`] says, per stage, which existing surface does the work
//! and what is still to wire. The catalogue endpoint serves it, so the editor
//! can show a template's author which stages the building can actually run.
//!
//! # What is wired, and what is not
//!
//! Wired in the flow itself: approval, and handover with proof (a decision
//! and a document, both hub acts). Every other stage delegates to an existing
//! surface, and the call from that surface's fact applier into
//! [`resume_from_node_fact_tx`] is not yet made — it belongs in the cloud's
//! sync ingest (`postgres::sync`), beside the code that already applies the
//! pick, fulfillment-progress, transfer-claim and accepted-receipt facts.
//! Inspect, ready for pickup and putaway have no surface of their own yet.

use super::flows::{self, DocumentRow};
use crate::cloud::application::AppError;
use crate::cloud::domain::flow::{
    Actor, CountRule, Effect, FlowActionInput, FlowSource, FlowState, ProofRecord, StageKind,
    FLOW_ACTION_COMPLETE_STAGE, FLOW_ACTION_CONFIRM_RECEIVE, FLOW_ACTION_RECORD_COUNT,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::json;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

/// How far a stage is connected.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Wiring {
    /// Done inside the flow's own transaction: nothing else to call.
    InFlow,
    /// An existing surface does the work; its fact still has to be handed to
    /// [`resume_from_node_fact_tx`].
    ExistingSurface,
    /// Nothing does it yet.
    Missing,
}

/// Where one stage's work is done.
#[derive(Clone, Copy, Debug, Serialize)]
pub struct StageDelegate {
    pub stage: StageKind,
    pub wiring: Wiring,
    /// The route or function that does the work today.
    pub surface: &'static str,
    /// The fact the node publishes when it has done it: what resumes the
    /// stage.
    pub fact: Option<&'static str>,
    pub note: &'static str,
}

pub fn stage_delegate(kind: StageKind) -> StageDelegate {
    let (wiring, surface, fact, note) = match kind {
        StageKind::Pick => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/picks (node Gudang, edge::outbound)",
            Some("inventory.pick.v1"),
            "Pick di Gudang sudah ada. Pick di toko (mutasi, retur) belum punya layar sendiri.",
        ),
        StageKind::Pack => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/packs · POST /api/v1/dc/packing-boxes/{id}/capture",
            Some("inventory.fulfillment.progress.v1 (PACKED)"),
            "Pack mengikat barang ke satu tujuan (allotment §1). Unpack: ALLOTMENT_UNPACKED.",
        ),
        StageKind::CloseKoli => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/koli/{koli_id}/seal",
            None,
            "Nomor KOLI. Isi koli yang disegel adalah yang kelak dihitung diserahkan (ALT-D01).",
        ),
        StageKind::Ship => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/shipments · POST /api/v1/dc/koli/{koli_id}/shipment",
            Some("inventory.fulfillment.progress.v1 (SHIPMENT)"),
            "Nomor SJ, satu per tujuan (edge::outbound::NumberKind::Shipment). Unship: ALLOTMENT_UNSHIPPED.",
        ),
        StageKind::Load => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/dispatches · POST /api/v1/dc/koli/{koli_id}/dispatch",
            Some("inventory.fulfillment.progress.v1 (LOADED)"),
            "Nomor DSP: satu perjalanan, beberapa SJ. Masih di halaman: Loaded, bukan Dispatched (ALT-D06). Unload: ALLOTMENT_UNLOADED.",
        ),
        StageKind::Depart => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/dispatches/{dispatch_id}/depart",
            Some("inventory.fulfillment.progress.v1 (IN_TRANSIT) + klaim IN_TRANSIT"),
            "DSP berangkat; bila Muat dilewati, DSP dibuka di sini. Interunit barang (SJD) ditulis flow_posting; nilainya oleh stock_transfer_post_pending.",
        ),
        StageKind::Receive => (
            Wiring::ExistingSurface,
            "POST /api/v1/store/inbound/{delivery_id}/receive (node toko, edge::inbound)",
            Some("klaim transfer RECEIVED"),
            "Terima di toko sudah ada. Terima retur toko di Gudang belum punya layar.",
        ),
        StageKind::Inspect => (
            Wiring::Missing,
            "—",
            None,
            "Belum ada layar periksa; pool reject (dc.reject.*) sudah ada.",
        ),
        StageKind::ReadyForPickup => (
            Wiring::Missing,
            "—",
            None,
            "Belum ada alur ambil sendiri oleh pelanggan.",
        ),
        StageKind::HandoverWithProof => (
            Wiring::InFlow,
            "hub: aksi HANDOVER dengan bukti",
            None,
            "Nilai retur supplier dibukukan dari flow_posting lewat stock_ledger_return_to_supplier (belum disambung).",
        ),
        StageKind::Approval => (
            Wiring::InFlow,
            "hub: aksi DECIDE_APPROVAL",
            None,
            "Keputusan di hub; tidak ada yang lain untuk dipanggil.",
        ),
        StageKind::Arrival => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/goods-receipts (node Gudang)",
            None,
            "Nomor delivery diberikan site saat lori datang.",
        ),
        StageKind::BlindCount => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/purchase-counts",
            None,
            "Daftar checker di node tidak membawa kuantitas maupun harga.",
        ),
        StageKind::Verification => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/purchase-verifications",
            Some("accepted receipt (edge::sync::record_accepted_receipt_line)"),
            "Verifier bukan checker; ditegakkan juga di node.",
        ),
        StageKind::Tagging => (
            Wiring::ExistingSurface,
            "POST /api/v1/dc/tagging-confirmations · postgres::tagging",
            None,
            "Tagging job dari Article Setup.",
        ),
        StageKind::Putaway => (
            Wiring::Missing,
            "—",
            None,
            "Pending → rak belum punya layar sendiri; hari ini ikut konfirmasi tagging.",
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
/// its work. Today every hub-confirmed stage's movements leave through the
/// outbox (`flow_event`) and nothing more is called here:
///
/// * APPROVAL — a decision; nothing else exists to call.
/// * HANDOVER_WITH_PROOF — the goods' movement to the supplier travels as a
///   `MOVEMENT` event to the Gudang's node; the valued entry is Finance's,
///   from `flow_posting` (`stock_ledger_return_to_supplier`, to wire).
/// * every node stage confirmed from the hub (a manual fallback) — the node
///   is the only writer of its ledger, so its `MOVEMENT` event is the
///   instruction; the relay that turns it into a signed sync command is the
///   part still to build.
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

/// The actions a node's fact stands for.
///
/// A receipt is the one confirm (everything the fact names as received;
/// what departed and was not named becomes Missing by the confirm's own
/// rule). A counting stage records the fact's lines and completes. An
/// arrival completes under its delivery number. The stage index is filled in
/// from the stage's key when applied.
pub fn actions_for_node_fact(
    kind: StageKind,
    lines: &[(Uuid, i64)],
    proof: &[ProofRecord],
    delivery_number: Option<&str>,
) -> Vec<FlowActionInput> {
    let action = |action_type: &str, details: serde_json::Value| FlowActionInput {
        action_type: action_type.to_owned(),
        stage_index: 0,
        details,
    };
    match kind {
        StageKind::Receive => vec![action(
            FLOW_ACTION_CONFIRM_RECEIVE,
            json!({
                "lines": lines
                    .iter()
                    .map(|(sku_id, quantity)| json!({ "sku_id": sku_id, "received": quantity }))
                    .collect::<Vec<_>>(),
                "proof": proof,
            }),
        )],
        StageKind::Arrival => vec![action(
            FLOW_ACTION_COMPLETE_STAGE,
            json!({ "delivery_number": delivery_number, "proof": proof }),
        )],
        other if other.spec().count != CountRule::None && !lines.is_empty() => vec![
            action(
                FLOW_ACTION_RECORD_COUNT,
                json!({
                    "lines": lines
                        .iter()
                        .map(|(sku_id, quantity)| json!({ "sku_id": sku_id, "quantity": quantity }))
                        .collect::<Vec<_>>(),
                    "proof": proof,
                }),
            ),
            action(FLOW_ACTION_COMPLETE_STAGE, json!({})),
        ],
        _ => vec![action(FLOW_ACTION_COMPLETE_STAGE, json!({ "proof": proof }))],
    }
}

/// A node's fact resumes the stage it finishes.
///
/// `source` names the document the fact is about (the allotment, the
/// purchase order) and `destination_site_id` which of its destinations; a
/// source that runs under no flow is not an error — `None` — because flows
/// are being introduced beside the paths that already work. A stage already done is
/// answered as it stands, so a fact delivered twice is applied once; a stage
/// that is not yet due is refused by the flow's own ordering.
///
/// NOT YET CALLED: the cloud's fact appliers in `postgres::sync` should call
/// it, in the transaction that applies the fact, with the fact's actor.
#[allow(clippy::too_many_arguments)]
pub async fn resume_from_node_fact_tx(
    tx: &mut Transaction<'_, Postgres>,
    source: &FlowSource,
    destination_site_id: Option<&str>,
    kind: StageKind,
    lines: &[(Uuid, i64)],
    proof: &[ProofRecord],
    delivery_number: Option<&str>,
    actor: &Actor,
    fact_key: &str,
    at: DateTime<Utc>,
) -> Result<Option<Uuid>, AppError> {
    let Some(document_id) = flows::live_flow_for_source_tx(tx, source, destination_site_id).await?
    else {
        return Ok(None);
    };
    let key = flows::stage_key(document_id, kind);
    let row = sqlx::query(
        "SELECT stage_index, status FROM flow_stage_state WHERE idempotency_key = $1 FOR UPDATE",
    )
    .bind(&key)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(row) = row else {
        // The template this document runs has no such stage: the node did
        // work the flow does not track. Not an error either.
        return Ok(Some(document_id));
    };
    let status: String = row.try_get("status")?;
    if status == "DONE" || status == "SKIPPED" {
        return Ok(Some(document_id));
    }
    let stage_index: i32 = row.try_get("stage_index")?;
    let stage_index = usize::try_from(stage_index).unwrap_or(usize::MAX);
    let actions: Vec<FlowActionInput> = actions_for_node_fact(kind, lines, proof, delivery_number)
        .into_iter()
        .map(|mut action| {
            action.stage_index = stage_index;
            action
        })
        .collect();
    flows::apply_stage_tx(tx, document_id, &actions, None, actor, fact_key, at).await?;
    Ok(Some(document_id))
}
