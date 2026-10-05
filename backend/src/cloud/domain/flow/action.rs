//! A flow document is an ordered list of typed actions.
//!
//! Borrowed from Medusa's `OrderChange` / `OrderChangeAction`: every act on a
//! document — a count recorded, a stage parked, an approval, the one confirm
//! at receive — is one row with a type and a `details` object, and each type
//! is registered here with two functions:
//!
//! * `validate` reads the state and says whether the action may happen, and
//!   refuses in a sentence when it may not;
//! * `apply` changes the in-memory state and returns the effects the stage
//!   produced — movements between pool stages, claims, journal meanings,
//!   status changes.
//!
//! Allotment's reversals — unpack, reopening a koli, unship, unload — are an
//! action of their own (`REVERSE_STAGE`): they take goods back one physical
//! step while nothing has departed, and they are corrections, not an
//! exception workflow (allotment §4). Nothing after departure is reversed:
//! goods on the road are received.
//!
//! A preview replays the document's applied actions and then the new ones, in
//! memory, and shows the result. Confirming runs exactly the same code once
//! more and writes the actions and their effects in ONE database transaction
//! (`postgres::flows`). There are no sagas and no compensations: an action
//! that cannot be applied is refused before anything is written, and an
//! action that was written is never undone — a mistake is corrected by the
//! next action (a recount), not by editing the last one.
//!
//! Pure. The actor arrives as an argument; nothing reads a clock.

use super::document::{
    ApprovalDecision, FlowState, FlowStatus, ProofRecord, StageCount, StageRuntime, StageStatus,
};
use super::stage::{
    ClaimKind, CountRule, JournalMeaning, ParkReason, PoolStage, ProofKind, StageKind,
};
use super::template::PartyKind;
use crate::cloud::domain::Role;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;
use uuid::Uuid;

/// One action as a caller sends it and `flow_action` stores it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FlowActionInput {
    #[serde(rename = "type")]
    pub action_type: String,
    /// The stage it acts on. Always the stage now due: a flow runs in order.
    pub stage_index: usize,
    #[serde(default)]
    pub details: Value,
}

/// Who is acting, on which rung, and which flow roles their job holds.
#[derive(Clone, Debug)]
pub struct Actor {
    pub id: String,
    pub rung: Role,
    /// The flow roles the actor's job role holds (0633) — every role for an
    /// OWNER or ADMIN.
    ///
    /// `None` is judged by the rung, as every stage was before job roles: a
    /// replayed action (the history stores the rung it was done on, and a
    /// replay must not refuse what was lawfully done then), and a node's own
    /// step, which acts as its stage's performer.
    pub flow_roles: Option<Vec<super::template::FlowRole>>,
}

impl Actor {
    /// Whether this actor may act as `role`: their job role holds it, or — for
    /// an actor judged by rung — the rung reaches it.
    pub fn holds(&self, role: super::template::FlowRole) -> bool {
        match &self.flow_roles {
            Some(held) => held.contains(&role),
            None => role.holds(self.rung),
        }
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum FlowError {
    #[error("action type `{0}` is not known")]
    UnknownAction(String),
    /// The action is not for the stage now due.
    #[error("{0}")]
    NotDue(String),
    /// A rule of the stage or of the document refused it.
    #[error("{0}")]
    Refused(String),
    /// The actor may not do this.
    #[error("{0}")]
    Forbidden(String),
    /// The details are not what this action takes.
    #[error("{0}")]
    Invalid(String),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct EffectLine {
    pub sku_id: Uuid,
    pub quantity: i64,
}

/// What applying an action produced. The database writes these in the same
/// transaction as the action (`postgres::flows`): a movement and a claim as
/// an outbox row for the node that owns the site's ledger, a journal meaning
/// as a posting Finance's poster resolves, a status on the document's row.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "effect", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Effect {
    StageDone {
        stage_index: usize,
        stage: StageKind,
    },
    StageSkipped {
        stage_index: usize,
        stage: StageKind,
        reason: String,
    },
    StageParked {
        stage_index: usize,
        stage: StageKind,
        reason: ParkReason,
    },
    /// A stage opened again: the verifier asked the checker to count again.
    StageReopened {
        stage_index: usize,
        stage: StageKind,
        reason: String,
    },
    Movement {
        stage_index: usize,
        stage: StageKind,
        from: PoolStage,
        to: PoolStage,
        lines: Vec<EffectLine>,
    },
    Claim {
        stage_index: usize,
        stage: StageKind,
        claim: ClaimKind,
        lines: Vec<EffectLine>,
    },
    /// A journal MEANING with quantities. Valued and posted by Finance
    /// against the account map; never an account here (I9).
    Journal {
        stage_index: usize,
        stage: StageKind,
        meaning: JournalMeaning,
        lines: Vec<EffectLine>,
    },
    Status {
        from: FlowStatus,
        to: FlowStatus,
        reason: Option<String>,
    },
}

/// One action type: registered once, in [`registry`].
pub trait ActionType: Send + Sync {
    fn code(&self) -> &'static str;

    /// Whether the action may happen to this state, as this actor.
    fn validate(
        &self,
        state: &FlowState,
        input: &FlowActionInput,
        actor: &Actor,
    ) -> Result<(), FlowError>;

    /// Change the state and say what changed. Called only after `validate`.
    fn apply(
        &self,
        state: &mut FlowState,
        input: &FlowActionInput,
        actor: &Actor,
    ) -> Result<Vec<Effect>, FlowError>;
}

pub const FLOW_ACTION_RECORD_COUNT: &str = "RECORD_COUNT";
pub const FLOW_ACTION_PARK_STAGE: &str = "PARK_STAGE";
pub const FLOW_ACTION_COMPLETE_STAGE: &str = "COMPLETE_STAGE";
pub const FLOW_ACTION_SKIP_STAGE: &str = "SKIP_STAGE";
pub const FLOW_ACTION_DECIDE_APPROVAL: &str = "DECIDE_APPROVAL";
pub const FLOW_ACTION_CONFIRM_RECEIVE: &str = "CONFIRM_RECEIVE";
pub const FLOW_ACTION_HANDOVER: &str = "HANDOVER";
pub const FLOW_ACTION_REQUEST_RECOUNT: &str = "REQUEST_RECOUNT";
pub const FLOW_ACTION_CANCEL_FLOW: &str = "CANCEL_FLOW";
pub const FLOW_ACTION_REVERSE_STAGE: &str = "REVERSE_STAGE";

static REGISTRY: [&dyn ActionType; 10] = [
    &RecordCount,
    &ParkStage,
    &CompleteStage,
    &SkipStage,
    &DecideApproval,
    &ConfirmReceive,
    &Handover,
    &RequestRecount,
    &CancelFlow,
    &ReverseStage,
];

/// Every action type this build knows.
pub fn registry() -> &'static [&'static dyn ActionType] {
    &REGISTRY
}

pub fn action_type(code: &str) -> Result<&'static dyn ActionType, FlowError> {
    let code = code.trim();
    REGISTRY
        .iter()
        .copied()
        .find(|action| action.code() == code)
        .ok_or_else(|| FlowError::UnknownAction(code.to_owned()))
}

/// Validate and apply one action.
pub fn apply_action(
    state: &mut FlowState,
    input: &FlowActionInput,
    actor: &Actor,
) -> Result<Vec<Effect>, FlowError> {
    let action = action_type(&input.action_type)?;
    action.validate(state, input, actor)?;
    action.apply(state, input, actor)
}

/// Apply a list in order: the document's history, or a preview's new actions.
pub fn replay(
    state: &mut FlowState,
    actions: &[(FlowActionInput, Actor)],
) -> Result<Vec<Effect>, FlowError> {
    let mut effects = Vec::new();
    for (input, actor) in actions {
        effects.extend(apply_action(state, input, actor)?);
    }
    Ok(effects)
}

/// A preview: the state the new actions would leave, and what they would do.
#[derive(Clone, Debug, Serialize)]
pub struct Preview {
    pub state: FlowState,
    pub effects: Vec<Effect>,
}

pub fn preview(
    state: &FlowState,
    actions: &[FlowActionInput],
    actor: &Actor,
) -> Result<Preview, FlowError> {
    let mut state = state.clone();
    let mut effects = Vec::new();
    for input in actions {
        effects.extend(apply_action(&mut state, input, actor)?);
    }
    Ok(Preview { state, effects })
}

/// The one stage a batch of actions acts on. A confirm writes one stage per
/// transaction, so a batch that spans two is refused before anything runs.
pub fn single_stage(actions: &[FlowActionInput]) -> Result<usize, FlowError> {
    let stages: BTreeSet<usize> = actions.iter().map(|action| action.stage_index).collect();
    match (stages.len(), stages.iter().next()) {
        (1, Some(stage)) => Ok(*stage),
        (0, _) => Err(FlowError::Invalid("there are no actions to confirm".into())),
        _ => Err(FlowError::Invalid(
            "one confirm is for one stage: send the next stage's actions once this one is saved"
                .into(),
        )),
    }
}

// --- shared checks --------------------------------------------------------

fn details<T: DeserializeOwned>(input: &FlowActionInput) -> Result<T, FlowError> {
    let value = match &input.details {
        Value::Null => Value::Object(serde_json::Map::new()),
        other => other.clone(),
    };
    serde_json::from_value(value)
        .map_err(|error| FlowError::Invalid(format!("details of {}: {error}", input.action_type)))
}

/// The stage the action names, which has to be the one now due, on a
/// document that is still running.
fn due<'a>(state: &'a FlowState, input: &FlowActionInput) -> Result<&'a StageRuntime, FlowError> {
    if state.status.is_terminal() {
        return Err(FlowError::Refused(format!(
            "this document is already {}; there is no stage left to work on",
            state.status.code()
        )));
    }
    let Some(cursor) = state.cursor() else {
        return Err(FlowError::Refused("every stage is already done".into()));
    };
    if input.stage_index != cursor {
        let due = &state.stages[cursor];
        return Err(FlowError::NotDue(format!(
            "the stage now due is #{} {}, not #{}",
            cursor + 1,
            due.kind().spec().label,
            input.stage_index + 1
        )));
    }
    let stage = &state.stages[cursor];
    if state.status == FlowStatus::Requested && stage.kind() != StageKind::Approval {
        return Err(FlowError::Refused(
            "the document is waiting for approval; no goods may move yet".into(),
        ));
    }
    Ok(stage)
}

fn may_perform(stage: &StageRuntime, actor: &Actor) -> Result<(), FlowError> {
    if actor.id.trim().is_empty() {
        return Err(FlowError::Forbidden(
            "an action without somebody doing it is not recorded".into(),
        ));
    }
    let performer = stage.stage.performer;
    if !actor.holds(performer) {
        return Err(FlowError::Forbidden(format!(
            "{} is done by {}; {} does not hold that role",
            stage.kind().spec().label,
            performer.label(),
            actor.id
        )));
    }
    Ok(())
}

fn expect_kind(stage: &StageRuntime, kinds: &[StageKind], action: &str) -> Result<(), FlowError> {
    if kinds.contains(&stage.kind()) {
        return Ok(());
    }
    Err(FlowError::Refused(format!(
        "{action} is not an action for the stage {}",
        stage.kind().spec().label
    )))
}

fn check_proof_kinds(stage: &StageRuntime, proof: &[ProofRecord]) -> Result<(), FlowError> {
    for record in proof {
        if !stage.kind().spec().allowed_proof.contains(&record.kind) {
            return Err(FlowError::Refused(format!(
                "{} does not take {} as proof",
                stage.kind().spec().label,
                record.kind.label()
            )));
        }
        if record.reference.trim().is_empty() {
            return Err(FlowError::Invalid(format!(
                "{} proof without a reference: name the scan session, the file or the note number",
                record.kind.label()
            )));
        }
    }
    Ok(())
}

/// Every proof the template asks of this stage is among what was recorded
/// before and what arrives now.
fn proof_complete(stage: &StageRuntime, arriving: &[ProofRecord]) -> Result<(), FlowError> {
    let have: BTreeSet<ProofKind> = stage
        .proof
        .iter()
        .chain(arriving.iter())
        .map(|record| record.kind)
        .collect();
    let missing: Vec<&str> = stage
        .stage
        .proof
        .iter()
        .filter(|kind| !have.contains(kind))
        .map(|kind| kind.label())
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(FlowError::Refused(format!(
            "{} is missing proof: {}",
            stage.kind().spec().label,
            missing.join(", ")
        )))
    }
}

fn lines_of(counts: &BTreeMap<Uuid, i64>) -> Vec<EffectLine> {
    counts
        .iter()
        .filter(|(_, quantity)| **quantity > 0)
        .map(|(sku_id, quantity)| EffectLine {
            sku_id: *sku_id,
            quantity: *quantity,
        })
        .collect()
}

fn quantities(counts: &BTreeMap<Uuid, StageCount>) -> BTreeMap<Uuid, i64> {
    counts
        .iter()
        .map(|(sku, count)| (*sku, count.quantity))
        .collect()
}

fn movement(
    index: usize,
    stage: StageKind,
    from: PoolStage,
    to: PoolStage,
    counts: &BTreeMap<Uuid, i64>,
) -> Option<Effect> {
    let lines = lines_of(counts);
    (!lines.is_empty()).then_some(Effect::Movement {
        stage_index: index,
        stage,
        from,
        to,
        lines,
    })
}

/// Close the document when nothing is left open.
fn finish_if_done(state: &mut FlowState) -> Option<Effect> {
    if state.cursor().is_none() && state.status == FlowStatus::Confirmed {
        state.status = FlowStatus::Completed;
        return Some(Effect::Status {
            from: FlowStatus::Confirmed,
            to: FlowStatus::Completed,
            reason: None,
        });
    }
    None
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CountLine {
    sku_id: Uuid,
    quantity: i64,
    /// Found and unsaleable, part of `quantity`. Inspection only.
    #[serde(default)]
    reject: i64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct CountDetails {
    #[serde(default)]
    lines: Vec<CountLine>,
    #[serde(default)]
    proof: Vec<ProofRecord>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteDetails {
    #[serde(default)]
    proof: Vec<ProofRecord>,
    #[serde(default)]
    delivery_number: Option<String>,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReasonDetails {
    #[serde(default)]
    reason: Option<String>,
}

fn reason_of(details: &ReasonDetails, what: &str) -> Result<String, FlowError> {
    details
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|reason| !reason.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| FlowError::Invalid(format!("{what} needs a reason")))
}

// --- FLOW_ACTION_RECORD_COUNT ---------------------------------------------------------

/// What a stage handled, per SKU. Recording again REPLACES the stage's count
/// rather than adding to it: nothing is counted twice.
struct RecordCount;

impl RecordCount {
    fn parsed(
        state: &FlowState,
        input: &FlowActionInput,
    ) -> Result<(BTreeMap<Uuid, StageCount>, Vec<ProofRecord>), FlowError> {
        let stage = &state.stages[input.stage_index];
        let parsed: CountDetails = details(input)?;
        let upstream = state.upstream(input.stage_index);
        let mut counts = BTreeMap::new();
        for line in &parsed.lines {
            if line.quantity < 0 || line.reject < 0 {
                return Err(FlowError::Invalid("a quantity cannot be negative".into()));
            }
            if line.reject > line.quantity {
                return Err(FlowError::Invalid(
                    "reject is part of what was inspected and cannot exceed it".into(),
                ));
            }
            if line.reject > 0 && stage.kind() != StageKind::Inspect {
                return Err(FlowError::Invalid(
                    "reject is recorded at Inspect, or as damaged at Receive".into(),
                ));
            }
            if let Some(upstream) = &upstream {
                let Some(ceiling) = upstream.get(&line.sku_id) else {
                    return Err(FlowError::Refused(format!(
                        "SKU {} is not in the stage before; goods that were not handed on cannot be counted here",
                        line.sku_id
                    )));
                };
                if line.quantity > *ceiling {
                    return Err(FlowError::Refused(format!(
                        "{} records {} of SKU {}, more than the {} the stage before handed on",
                        stage.kind().spec().label,
                        line.quantity,
                        line.sku_id,
                        ceiling
                    )));
                }
            }
            if counts
                .insert(
                    line.sku_id,
                    StageCount {
                        quantity: line.quantity,
                        missing: 0,
                        reject: line.reject,
                    },
                )
                .is_some()
            {
                return Err(FlowError::Invalid(format!(
                    "SKU {} is named twice; one line per SKU",
                    line.sku_id
                )));
            }
        }
        Ok((counts, parsed.proof))
    }
}

impl ActionType for RecordCount {
    fn code(&self) -> &'static str {
        FLOW_ACTION_RECORD_COUNT
    }

    fn validate(
        &self,
        state: &FlowState,
        input: &FlowActionInput,
        actor: &Actor,
    ) -> Result<(), FlowError> {
        let stage = due(state, input)?;
        may_perform(stage, actor)?;
        if stage.kind().spec().count == CountRule::None {
            return Err(FlowError::Refused(format!(
                "{} records no quantities",
                stage.kind().spec().label
            )));
        }
        if matches!(stage.kind(), StageKind::Receive) {
            return Err(FlowError::Refused(
                "Receive is recorded once, by Confirm receive, not by a separate count".into(),
            ));
        }
        let (_, proof) = Self::parsed(state, input)?;
        check_proof_kinds(stage, &proof)
    }

    fn apply(
        &self,
        state: &mut FlowState,
        input: &FlowActionInput,
        _actor: &Actor,
    ) -> Result<Vec<Effect>, FlowError> {
        let (counts, proof) = Self::parsed(state, input)?;
        let stage = &mut state.stages[input.stage_index];
        stage.counts = counts;
        stage.counted = true;
        stage.proof.extend(proof);
        Ok(Vec::new())
    }
}

// --- FLOW_ACTION_PARK_STAGE -----------------------------------------------------------

/// The stage waits for the world: a sweep of the handheld, a decision, a
/// signature. It is resumed by its idempotency key (document + stage).
struct ParkStage;

impl ActionType for ParkStage {
    fn code(&self) -> &'static str {
        FLOW_ACTION_PARK_STAGE
    }

    fn validate(
        &self,
        state: &FlowState,
        input: &FlowActionInput,
        actor: &Actor,
    ) -> Result<(), FlowError> {
        let stage = due(state, input)?;
        may_perform(stage, actor)?;
        let _: ReasonDetails = details(input)?;
        if stage.kind().spec().parks.is_none() {
            return Err(FlowError::Refused(format!(
                "{} waits for nothing; complete it directly",
                stage.kind().spec().label
            )));
        }
        if stage.status == StageStatus::Parked {
            return Err(FlowError::Refused(format!(
                "{} is already waiting; resume it by its key",
                stage.kind().spec().label
            )));
        }
        Ok(())
    }

    fn apply(
        &self,
        state: &mut FlowState,
        input: &FlowActionInput,
        _actor: &Actor,
    ) -> Result<Vec<Effect>, FlowError> {
        let stage = &mut state.stages[input.stage_index];
        let reason = stage
            .kind()
            .spec()
            .parks
            .ok_or_else(|| FlowError::Refused("this stage does not wait".into()))?;
        stage.status = StageStatus::Parked;
        stage.park_reason = Some(reason);
        Ok(vec![Effect::StageParked {
            stage_index: input.stage_index,
            stage: stage.kind(),
            reason,
        }])
    }
}

// --- FLOW_ACTION_COMPLETE_STAGE -------------------------------------------------------

/// Finish the stage now due. Receive, handover and approval have their own
/// actions, because each has a rule this one cannot hold.
struct CompleteStage;

impl ActionType for CompleteStage {
    fn code(&self) -> &'static str {
        FLOW_ACTION_COMPLETE_STAGE
    }

    fn validate(
        &self,
        state: &FlowState,
        input: &FlowActionInput,
        actor: &Actor,
    ) -> Result<(), FlowError> {
        let stage = due(state, input)?;
        may_perform(stage, actor)?;
        let kind = stage.kind();
        let label = kind.spec().label;
        match kind {
            StageKind::Receive => {
                return Err(FlowError::Refused(
                    "Receive is completed by Confirm receive: once, with no refusal".into(),
                ))
            }
            StageKind::HandoverWithProof => {
                return Err(FlowError::Refused(
                    "Handover is completed by the Handover action, with its proof".into(),
                ))
            }
            StageKind::Approval => {
                return Err(FlowError::Refused(
                    "Approval is completed by a decision: approve or decline".into(),
                ))
            }
            _ => {}
        }
        let parsed: CompleteDetails = details(input)?;
        check_proof_kinds(stage, &parsed.proof)?;
        if kind.spec().count == CountRule::MustCount && !stage.counted {
            return Err(FlowError::Refused(format!(
                "{label} has not recorded its count"
            )));
        }
        proof_complete(stage, &parsed.proof)?;
        if kind == StageKind::Arrival {
            let number = parsed
                .delivery_number
                .as_deref()
                .or(stage.delivery_number.as_deref())
                .map(str::trim)
                .unwrap_or_default();
            if number.is_empty() {
                return Err(FlowError::Refused(
                    "An arrival is recorded under a delivery number".into(),
                ));
            }
        }
        Ok(())
    }

    fn apply(
        &self,
        state: &mut FlowState,
        input: &FlowActionInput,
        actor: &Actor,
    ) -> Result<Vec<Effect>, FlowError> {
        let parsed: CompleteDetails = details(input)?;
        let index = input.stage_index;
        let upstream = state.upstream(index);
        let crosses = state.header.crosses_units;
        let done = |kind: StageKind| {
            state
                .stage_of(kind)
                .is_some_and(|stage| stage.status == StageStatus::Done)
        };
        let shipped = done(StageKind::Ship);
        let loaded = done(StageKind::Load);

        let stage = &mut state.stages[index];
        let kind = stage.kind();
        if !stage.counted && kind.spec().count == CountRule::CarriesUpstream {
            if let Some(upstream) = upstream {
                stage.counts = upstream
                    .into_iter()
                    .map(|(sku, quantity)| {
                        (
                            sku,
                            StageCount {
                                quantity,
                                missing: 0,
                                reject: 0,
                            },
                        )
                    })
                    .collect();
                stage.counted = true;
            }
        }
        stage.proof.extend(parsed.proof);
        if let Some(number) = parsed.delivery_number {
            stage.delivery_number = Some(number.trim().to_owned());
        }
        stage.note = parsed.note.or(stage.note.take());
        stage.status = StageStatus::Done;
        stage.done_by = Some(actor.id.clone());
        let handled = quantities(&stage.counts);

        let mut effects = vec![Effect::StageDone {
            stage_index: index,
            stage: kind,
        }];
        match kind {
            StageKind::Pick => effects.extend(movement(
                index,
                kind,
                PoolStage::OriginStock,
                PoolStage::Picked,
                &handled,
            )),
            StageKind::Pack => effects.extend(movement(
                index,
                kind,
                PoolStage::Picked,
                PoolStage::Packed,
                &handled,
            )),
            StageKind::Ship => effects.extend(movement(
                index,
                kind,
                PoolStage::Packed,
                PoolStage::Shipment,
                &handled,
            )),
            StageKind::Load => {
                let from = if shipped {
                    PoolStage::Shipment
                } else {
                    PoolStage::Packed
                };
                effects.extend(movement(index, kind, from, PoolStage::Loaded, &handled));
            }
            StageKind::Depart => {
                // Whatever stage the goods last stood in: the dispatch's
                // vehicle, or — when load was skipped and depart opens the
                // dispatch itself — the surat jalan.
                let from = if loaded {
                    PoolStage::Loaded
                } else if shipped {
                    PoolStage::Shipment
                } else {
                    PoolStage::Packed
                };
                effects.extend(movement(index, kind, from, PoolStage::InTransit, &handled));
                effects.push(Effect::Claim {
                    stage_index: index,
                    stage: kind,
                    claim: ClaimKind::InTransit,
                    lines: lines_of(&handled),
                });
                if crosses {
                    effects.push(Effect::Journal {
                        stage_index: index,
                        stage: kind,
                        meaning: JournalMeaning::InterunitGoodsDispatched,
                        lines: lines_of(&handled),
                    });
                }
            }
            StageKind::Inspect => {
                let rejected: BTreeMap<Uuid, i64> = state.stages[index]
                    .counts
                    .iter()
                    .map(|(sku, count)| (*sku, count.reject))
                    .collect();
                let passed: BTreeMap<Uuid, i64> = state.stages[index]
                    .counts
                    .iter()
                    .map(|(sku, count)| (*sku, count.quantity - count.reject))
                    .collect();
                effects.extend(movement(
                    index,
                    kind,
                    PoolStage::DestinationPool,
                    PoolStage::DestinationStock,
                    &passed,
                ));
                effects.extend(movement(
                    index,
                    kind,
                    PoolStage::DestinationPool,
                    PoolStage::DestinationReject,
                    &rejected,
                ));
            }
            StageKind::ReadyForPickup => effects.push(Effect::Claim {
                stage_index: index,
                stage: kind,
                claim: ClaimKind::ReadyForPickup,
                lines: lines_of(&handled),
            }),
            // The approved count is the receipt. It waits in Pending only for
            // a template that still puts goods away after it (version 1);
            // without a Putaway stage — the company's process (0629) — the
            // goods are the Gudang's stock the moment the count is approved.
            StageKind::Verification => {
                let putaway_follows = state.stages[index + 1..]
                    .iter()
                    .any(|later| later.kind() == StageKind::Putaway);
                effects.extend(movement(
                    index,
                    kind,
                    PoolStage::OutsideParty,
                    if putaway_follows {
                        PoolStage::Pending
                    } else {
                        PoolStage::DestinationPool
                    },
                    &handled,
                ))
            }
            StageKind::Putaway => effects.extend(movement(
                index,
                kind,
                PoolStage::Pending,
                PoolStage::DestinationPool,
                &handled,
            )),
            StageKind::CloseKoli
            | StageKind::Arrival
            | StageKind::BlindCount
            | StageKind::Tagging => {}
            StageKind::Receive | StageKind::HandoverWithProof | StageKind::Approval => {
                return Err(FlowError::Refused(
                    "this stage has an action of its own".into(),
                ))
            }
        }
        effects.extend(finish_if_done(state));
        Ok(effects)
    }
}

// --- FLOW_ACTION_SKIP_STAGE -----------------------------------------------------------

/// Pass over a stage the template allows to be skipped, with a reason.
struct SkipStage;

impl ActionType for SkipStage {
    fn code(&self) -> &'static str {
        FLOW_ACTION_SKIP_STAGE
    }

    fn validate(
        &self,
        state: &FlowState,
        input: &FlowActionInput,
        actor: &Actor,
    ) -> Result<(), FlowError> {
        let stage = due(state, input)?;
        may_perform(stage, actor)?;
        let label = stage.kind().spec().label;
        if !stage.kind().spec().may_skip {
            return Err(FlowError::Refused(format!("{label} can never be skipped")));
        }
        if !stage.stage.skippable {
            return Err(FlowError::Refused(format!(
                "this template does not allow {label} to be skipped"
            )));
        }
        let parsed: ReasonDetails = details(input)?;
        reason_of(&parsed, "Skipping a stage").map(|_| ())
    }

    fn apply(
        &self,
        state: &mut FlowState,
        input: &FlowActionInput,
        actor: &Actor,
    ) -> Result<Vec<Effect>, FlowError> {
        let parsed: ReasonDetails = details(input)?;
        let reason = reason_of(&parsed, "Skipping a stage")?;
        let stage = &mut state.stages[input.stage_index];
        stage.status = StageStatus::Skipped;
        stage.done_by = Some(actor.id.clone());
        stage.note = Some(reason.clone());
        let mut effects = vec![Effect::StageSkipped {
            stage_index: input.stage_index,
            stage: stage.kind(),
            reason,
        }];
        effects.extend(finish_if_done(state));
        Ok(effects)
    }
}

// --- FLOW_ACTION_DECIDE_APPROVAL ------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ApprovalDetails {
    decision: String,
    #[serde(default)]
    reason: Option<String>,
}

/// Yes or no, by somebody other than the person who asked.
struct DecideApproval;

impl DecideApproval {
    fn decision(input: &FlowActionInput) -> Result<(ApprovalDecision, Option<String>), FlowError> {
        let parsed: ApprovalDetails = details(input)?;
        let reason = parsed
            .reason
            .as_deref()
            .map(str::trim)
            .filter(|reason| !reason.is_empty())
            .map(str::to_owned);
        match parsed.decision.trim() {
            "APPROVE" => Ok((ApprovalDecision::Approved, reason)),
            "DECLINE" => match reason {
                Some(reason) => Ok((ApprovalDecision::Declined, Some(reason))),
                None => Err(FlowError::Invalid("declining needs a reason".into())),
            },
            other => Err(FlowError::Invalid(format!(
                "decision `{other}` is not known: APPROVE or DECLINE"
            ))),
        }
    }
}

impl ActionType for DecideApproval {
    fn code(&self) -> &'static str {
        FLOW_ACTION_DECIDE_APPROVAL
    }

    fn validate(
        &self,
        state: &FlowState,
        input: &FlowActionInput,
        actor: &Actor,
    ) -> Result<(), FlowError> {
        let stage = due(state, input)?;
        expect_kind(stage, &[StageKind::Approval], "An approval decision")?;
        may_perform(stage, actor)?;
        if actor.id == state.header.initiator {
            return Err(FlowError::Forbidden(
                "the approver cannot be the person who asked".into(),
            ));
        }
        Self::decision(input).map(|_| ())
    }

    fn apply(
        &self,
        state: &mut FlowState,
        input: &FlowActionInput,
        actor: &Actor,
    ) -> Result<Vec<Effect>, FlowError> {
        let (decision, reason) = Self::decision(input)?;
        let index = input.stage_index;
        let before = state.status;
        {
            let stage = &mut state.stages[index];
            stage.status = StageStatus::Done;
            stage.done_by = Some(actor.id.clone());
            stage.decision = Some(decision);
            stage.note = reason.clone();
        }
        let mut effects = vec![Effect::StageDone {
            stage_index: index,
            stage: StageKind::Approval,
        }];
        let after = match decision {
            ApprovalDecision::Approved => FlowStatus::Confirmed,
            ApprovalDecision::Declined => FlowStatus::Declined,
        };
        if after != before {
            state.status = after;
            effects.push(Effect::Status {
                from: before,
                to: after,
                reason,
            });
        }
        effects.extend(finish_if_done(state));
        Ok(effects)
    }
}

// --- FLOW_ACTION_CONFIRM_RECEIVE ------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReceiveLine {
    sku_id: Uuid,
    /// What actually came off the lorry for this SKU. Defaults to everything
    /// that departed; less when a koli stayed on the lorry, which then stays
    /// in transit (allotment ALT-D01) — Distribution's, not a difference.
    #[serde(default)]
    handed_over: Option<i64>,
    /// What was found.
    received: i64,
    /// Found but unsaleable: still received, into reject (ALT-D03).
    #[serde(default)]
    damaged: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReceiveDetails {
    #[serde(default)]
    lines: Vec<ReceiveLine>,
    #[serde(default)]
    proof: Vec<ProofRecord>,
}

/// The one act at receive. It states what arrived; it cannot refuse.
///
/// Every SKU that departed is accounted for: what was found is received,
/// what was handed over and not found is Missing at the destination, what
/// was found damaged is received into reject, and what never came off the
/// lorry stays in transit. A second confirm is refused, not added.
struct ConfirmReceive;

impl ConfirmReceive {
    fn counts(
        state: &FlowState,
        input: &FlowActionInput,
    ) -> Result<(BTreeMap<Uuid, StageCount>, Vec<ProofRecord>), FlowError> {
        let parsed: ReceiveDetails = details(input)?;
        let upstream = state.upstream(input.stage_index).unwrap_or_default();
        let mut given: BTreeMap<Uuid, &ReceiveLine> = BTreeMap::new();
        for line in &parsed.lines {
            if !upstream.contains_key(&line.sku_id) {
                return Err(FlowError::Refused(format!(
                    "SKU {} was not sent in this flow. Another SKU or an unknown EPC is not a receipt of this line; it is an Inventory finding",
                    line.sku_id
                )));
            }
            if given.insert(line.sku_id, line).is_some() {
                return Err(FlowError::Invalid(format!(
                    "SKU {} is named twice; one line per SKU",
                    line.sku_id
                )));
            }
        }
        let mut counts = BTreeMap::new();
        for (sku, departed) in &upstream {
            let (handed_over, received, damaged) = match given.get(sku) {
                Some(line) => (
                    line.handed_over.unwrap_or(*departed),
                    line.received,
                    line.damaged,
                ),
                None => (*departed, 0, 0),
            };
            if handed_over < 0 || received < 0 || damaged < 0 {
                return Err(FlowError::Invalid("a quantity cannot be negative".into()));
            }
            if handed_over > *departed {
                return Err(FlowError::Refused(format!(
                    "SKU {sku}: {handed_over} handed over, but {departed} departed"
                )));
            }
            if received > handed_over {
                return Err(FlowError::Refused(format!(
                    "SKU {sku}: {received} received is more than the {handed_over} handed over. A physical excess is an Inventory finding, not a receipt"
                )));
            }
            if damaged > received {
                return Err(FlowError::Invalid(format!(
                    "SKU {sku}: {damaged} damaged is part of the {received} received"
                )));
            }
            counts.insert(
                *sku,
                StageCount {
                    quantity: received,
                    missing: handed_over - received,
                    reject: damaged,
                },
            );
        }
        Ok((counts, parsed.proof))
    }
}

impl ActionType for ConfirmReceive {
    fn code(&self) -> &'static str {
        FLOW_ACTION_CONFIRM_RECEIVE
    }

    fn validate(
        &self,
        state: &FlowState,
        input: &FlowActionInput,
        actor: &Actor,
    ) -> Result<(), FlowError> {
        if let Some(receive) = state.stages.get(input.stage_index) {
            if receive.kind() == StageKind::Receive && receive.status == StageStatus::Done {
                return Err(FlowError::Refused(
                    "Receive is already confirmed. A second confirm is refused, not added".into(),
                ));
            }
        }
        let stage = due(state, input)?;
        expect_kind(stage, &[StageKind::Receive], "Confirm receive")?;
        may_perform(stage, actor)?;
        let (_, proof) = Self::counts(state, input)?;
        check_proof_kinds(stage, &proof)?;
        proof_complete(stage, &proof)
    }

    fn apply(
        &self,
        state: &mut FlowState,
        input: &FlowActionInput,
        actor: &Actor,
    ) -> Result<Vec<Effect>, FlowError> {
        let (counts, proof) = Self::counts(state, input)?;
        let index = input.stage_index;
        let crosses = state.header.crosses_units;

        let saleable: BTreeMap<Uuid, i64> = counts
            .iter()
            .map(|(sku, count)| (*sku, count.quantity - count.reject))
            .collect();
        let damaged: BTreeMap<Uuid, i64> = counts
            .iter()
            .map(|(sku, count)| (*sku, count.reject))
            .collect();
        let missing: BTreeMap<Uuid, i64> = counts
            .iter()
            .map(|(sku, count)| (*sku, count.missing))
            .collect();
        let received: BTreeMap<Uuid, i64> = quantities(&counts);
        let handed_over: BTreeMap<Uuid, i64> = counts
            .iter()
            .map(|(sku, count)| (*sku, count.quantity + count.missing))
            .collect();

        {
            let stage = &mut state.stages[index];
            stage.counts = counts;
            stage.counted = true;
            stage.proof.extend(proof);
            stage.status = StageStatus::Done;
            stage.done_by = Some(actor.id.clone());
        }

        let kind = StageKind::Receive;
        let mut effects = vec![Effect::StageDone {
            stage_index: index,
            stage: kind,
        }];
        effects.extend(movement(
            index,
            kind,
            PoolStage::InTransit,
            PoolStage::DestinationPool,
            &saleable,
        ));
        effects.extend(movement(
            index,
            kind,
            PoolStage::InTransit,
            PoolStage::DestinationReject,
            &damaged,
        ));
        effects.extend(movement(
            index,
            kind,
            PoolStage::InTransit,
            PoolStage::DestinationMissing,
            &missing,
        ));
        effects.push(Effect::Claim {
            stage_index: index,
            stage: kind,
            claim: ClaimKind::Received,
            lines: lines_of(&received),
        });
        // Custody of everything handed over moved, found or not: Missing is
        // stock at the destination, not stock on the road (ALT-INV-00).
        if crosses {
            effects.push(Effect::Journal {
                stage_index: index,
                stage: kind,
                meaning: JournalMeaning::InterunitGoodsReceived,
                lines: lines_of(&handed_over),
            });
        }
        effects.extend(finish_if_done(state));
        Ok(effects)
    }
}

// --- FLOW_ACTION_HANDOVER -------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct HandoverLine {
    sku_id: Uuid,
    quantity: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct HandoverDetails {
    proof: Vec<ProofRecord>,
    /// Defaults to everything that departed.
    #[serde(default)]
    lines: Option<Vec<HandoverLine>>,
}

/// Goods pass to somebody outside the company, against proof.
struct Handover;

impl Handover {
    fn counts(
        state: &FlowState,
        input: &FlowActionInput,
    ) -> Result<(BTreeMap<Uuid, i64>, Vec<ProofRecord>), FlowError> {
        let parsed: HandoverDetails = details(input)?;
        let upstream = state.upstream(input.stage_index).unwrap_or_default();
        let counts = match &parsed.lines {
            None => upstream.clone(),
            Some(lines) => {
                let mut counts = BTreeMap::new();
                for line in lines {
                    let Some(ceiling) = upstream.get(&line.sku_id) else {
                        return Err(FlowError::Refused(format!(
                            "SKU {} did not depart in this flow",
                            line.sku_id
                        )));
                    };
                    if line.quantity < 0 || line.quantity > *ceiling {
                        return Err(FlowError::Refused(format!(
                            "SKU {}: {} handed over of the {} that departed",
                            line.sku_id, line.quantity, ceiling
                        )));
                    }
                    if counts.insert(line.sku_id, line.quantity).is_some() {
                        return Err(FlowError::Invalid(format!(
                            "SKU {} is named twice",
                            line.sku_id
                        )));
                    }
                }
                counts
            }
        };
        Ok((counts, parsed.proof))
    }
}

impl ActionType for Handover {
    fn code(&self) -> &'static str {
        FLOW_ACTION_HANDOVER
    }

    fn validate(
        &self,
        state: &FlowState,
        input: &FlowActionInput,
        actor: &Actor,
    ) -> Result<(), FlowError> {
        let stage = due(state, input)?;
        expect_kind(stage, &[StageKind::HandoverWithProof], "Handover")?;
        may_perform(stage, actor)?;
        let (_, proof) = Self::counts(state, input)?;
        check_proof_kinds(stage, &proof)?;
        let has = |kind: ProofKind| {
            proof.iter().any(|record| record.kind == kind) || stage.has_proof(kind)
        };
        if !has(ProofKind::Signature) && !has(ProofKind::SignedReturnNote) {
            return Err(FlowError::Refused(
                "goods leave our hands only against proof: a signature or a signed return note"
                    .into(),
            ));
        }
        if state.header.destination_party == Some(PartyKind::Supplier)
            && !has(ProofKind::SignedReturnNote)
        {
            return Err(FlowError::Refused(
                "a handover to a supplier requires the supplier's signed return note".into(),
            ));
        }
        proof_complete(stage, &proof)
    }

    fn apply(
        &self,
        state: &mut FlowState,
        input: &FlowActionInput,
        actor: &Actor,
    ) -> Result<Vec<Effect>, FlowError> {
        let (counts, proof) = Self::counts(state, input)?;
        let index = input.stage_index;
        let to_supplier = state.header.destination_party == Some(PartyKind::Supplier);
        {
            let stage = &mut state.stages[index];
            stage.counts = counts
                .iter()
                .map(|(sku, quantity)| {
                    (
                        *sku,
                        StageCount {
                            quantity: *quantity,
                            missing: 0,
                            reject: 0,
                        },
                    )
                })
                .collect();
            stage.counted = true;
            stage.proof.extend(proof);
            stage.status = StageStatus::Done;
            stage.done_by = Some(actor.id.clone());
        }
        let kind = StageKind::HandoverWithProof;
        let mut effects = vec![Effect::StageDone {
            stage_index: index,
            stage: kind,
        }];
        effects.extend(movement(
            index,
            kind,
            PoolStage::InTransit,
            PoolStage::OutsideParty,
            &counts,
        ));
        if to_supplier {
            effects.push(Effect::Journal {
                stage_index: index,
                stage: kind,
                meaning: JournalMeaning::SupplierReturnHandedOver,
                lines: lines_of(&counts),
            });
        }
        effects.extend(finish_if_done(state));
        Ok(effects)
    }
}

// --- FLOW_ACTION_REQUEST_RECOUNT ------------------------------------------------------

/// The verifier does not accept the checker's count and asks for another.
/// The blind count opens again; its old number is replaced, not added to.
struct RequestRecount;

impl ActionType for RequestRecount {
    fn code(&self) -> &'static str {
        FLOW_ACTION_REQUEST_RECOUNT
    }

    fn validate(
        &self,
        state: &FlowState,
        input: &FlowActionInput,
        actor: &Actor,
    ) -> Result<(), FlowError> {
        let stage = due(state, input)?;
        expect_kind(stage, &[StageKind::Verification], "Request a recount")?;
        may_perform(stage, actor)?;
        let parsed: ReasonDetails = details(input)?;
        reason_of(&parsed, "Asking for a recount").map(|_| ())
    }

    fn apply(
        &self,
        state: &mut FlowState,
        input: &FlowActionInput,
        _actor: &Actor,
    ) -> Result<Vec<Effect>, FlowError> {
        let parsed: ReasonDetails = details(input)?;
        let reason = reason_of(&parsed, "Asking for a recount")?;
        let Some(blind) = state
            .stages
            .iter()
            .position(|stage| stage.kind() == StageKind::BlindCount)
        else {
            return Err(FlowError::Refused("this flow has no blind count".into()));
        };
        let stage = &mut state.stages[blind];
        stage.status = StageStatus::Pending;
        stage.park_reason = None;
        stage.counts.clear();
        stage.counted = false;
        stage.done_by = None;
        stage.note = Some(reason.clone());
        Ok(vec![Effect::StageReopened {
            stage_index: blind,
            stage: StageKind::BlindCount,
            reason,
        }])
    }
}

// --- FLOW_ACTION_CANCEL_FLOW ----------------------------------------------------------

/// Stop a document before anything has moved. After that, goods that
/// left are received and goods that were picked go back through their own
/// flow; nothing here compensates.
struct CancelFlow;

impl ActionType for CancelFlow {
    fn code(&self) -> &'static str {
        FLOW_ACTION_CANCEL_FLOW
    }

    fn validate(
        &self,
        state: &FlowState,
        input: &FlowActionInput,
        actor: &Actor,
    ) -> Result<(), FlowError> {
        if state.status.is_terminal() {
            return Err(FlowError::Refused(format!(
                "this document is already {}",
                state.status.code()
            )));
        }
        if state.cursor() != Some(input.stage_index) {
            return Err(FlowError::NotDue(
                "a cancellation is recorded on the stage now due".into(),
            ));
        }
        if state.goods_have_moved() {
            return Err(FlowError::Refused(
                "goods have moved; the document cannot be cancelled, only finished".into(),
            ));
        }
        if actor.id != state.header.initiator && actor.rung < Role::Admin {
            return Err(FlowError::Forbidden(
                "only the person who asked or a head-office Admin may cancel".into(),
            ));
        }
        let parsed: ReasonDetails = details(input)?;
        reason_of(&parsed, "Cancelling").map(|_| ())
    }

    fn apply(
        &self,
        state: &mut FlowState,
        input: &FlowActionInput,
        _actor: &Actor,
    ) -> Result<Vec<Effect>, FlowError> {
        let parsed: ReasonDetails = details(input)?;
        let reason = reason_of(&parsed, "Cancelling")?;
        let before = state.status;
        state.status = FlowStatus::Canceled;
        Ok(vec![Effect::Status {
            from: before,
            to: FlowStatus::Canceled,
            reason: Some(reason),
        }])
    }
}

// --- REVERSE_STAGE --------------------------------------------------------

/// Take goods back one physical step while nothing has departed: unpack
/// (packed → picked), reopen a sealed koli, unship (surat jalan → packed),
/// unload (dispatch → surat jalan). Allotment §4's reversals, and only them:
/// the step named must be the last one done, and a correction of the last
/// step is not a workflow for exceptions.
struct ReverseStage;

impl ActionType for ReverseStage {
    fn code(&self) -> &'static str {
        FLOW_ACTION_REVERSE_STAGE
    }

    fn validate(
        &self,
        state: &FlowState,
        input: &FlowActionInput,
        actor: &Actor,
    ) -> Result<(), FlowError> {
        if state.status.is_terminal() {
            return Err(FlowError::Refused(format!(
                "this document is already {}",
                state.status.code()
            )));
        }
        let Some(stage) = state.stages.get(input.stage_index) else {
            return Err(FlowError::Invalid(format!(
                "stage #{} does not exist",
                input.stage_index + 1
            )));
        };
        let label = stage.kind().spec().label;
        if !stage.kind().is_reversible() {
            return Err(FlowError::Refused(format!(
                "{label} cannot be reversed; only pack, close koli, ship and load can"
            )));
        }
        if stage.status != StageStatus::Done {
            return Err(FlowError::Refused(format!("{label} is not done")));
        }
        if state.goods_have_left() {
            return Err(FlowError::Refused(
                "goods have departed; what is on the road is received, not reversed".into(),
            ));
        }
        if state.stages[input.stage_index + 1..]
            .iter()
            .any(|later| later.status == StageStatus::Done)
        {
            return Err(FlowError::Refused(format!(
                "reverse the stage after {label} first: only the last step can be reversed"
            )));
        }
        may_perform(stage, actor)?;
        let parsed: ReasonDetails = details(input)?;
        reason_of(&parsed, "Reversing a stage").map(|_| ())
    }

    fn apply(
        &self,
        state: &mut FlowState,
        input: &FlowActionInput,
        _actor: &Actor,
    ) -> Result<Vec<Effect>, FlowError> {
        let parsed: ReasonDetails = details(input)?;
        let reason = reason_of(&parsed, "Reversing a stage")?;
        let index = input.stage_index;
        let shipped = state
            .stage_of(StageKind::Ship)
            .is_some_and(|ship| ship.status == StageStatus::Done);
        let stage = &mut state.stages[index];
        let kind = stage.kind();
        let back = quantities(&stage.counts);
        stage.status = StageStatus::Pending;
        stage.park_reason = None;
        stage.counts.clear();
        stage.counted = false;
        stage.done_by = None;
        stage.note = Some(reason.clone());

        let mut effects = Vec::new();
        let step = match kind {
            StageKind::Pack => Some((PoolStage::Packed, PoolStage::Picked)),
            StageKind::Ship => Some((PoolStage::Shipment, PoolStage::Packed)),
            StageKind::Load if shipped => Some((PoolStage::Loaded, PoolStage::Shipment)),
            StageKind::Load => Some((PoolStage::Loaded, PoolStage::Packed)),
            // Opening a seal moves nothing.
            _ => None,
        };
        if let Some((from, to)) = step {
            effects.extend(movement(index, kind, from, to, &back));
        }
        effects.push(Effect::StageReopened {
            stage_index: index,
            stage: kind,
            reason,
        });
        Ok(effects)
    }
}
