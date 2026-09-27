//! A flow document: one run of one template version between two ends, and
//! the state its actions build.
//!
//! # Statuses, and who and when for each
//!
//! Borrowed from Medusa's order change: a document is `REQUESTED` by
//! somebody, `CONFIRMED` (by the approver, or by the person who started it
//! when the template asks nobody), and then either `COMPLETED` when its last
//! stage is done, `DECLINED` at an approval, or `CANCELED` before any goods
//! moved. Each status records its `_by` and `_at` (0616), so the history of a
//! document is read off its row and never inferred.
//!
//! # The state is a replay
//!
//! Nothing here is stored as "the current stage". A [`FlowState`] is the
//! template's stages, the document's planned lines, and every applied action
//! replayed in order (`super::action::replay`). The preview replays the same
//! list plus the actions not yet confirmed, in memory; confirming writes those
//! actions once. The database keeps a projection of the result
//! (`flow_stage_state`, `flow_stage_line`) that its constraints can hold, but
//! the ledger is the action list.

use super::stage::{ParkReason, ProofKind, StageKind};
use super::template::{FlowRoute, PartyKind, PoolRole, TemplateStage};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FlowStatus {
    /// Started; waiting for an approval before anything moves.
    Requested,
    /// Running: approved, or started by somebody who needed nobody's yes.
    Confirmed,
    Completed,
    Declined,
    Canceled,
}

impl FlowStatus {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Requested => "REQUESTED",
            Self::Confirmed => "CONFIRMED",
            Self::Completed => "COMPLETED",
            Self::Declined => "DECLINED",
            Self::Canceled => "CANCELED",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code.trim() {
            "REQUESTED" => Some(Self::Requested),
            "CONFIRMED" => Some(Self::Confirmed),
            "COMPLETED" => Some(Self::Completed),
            "DECLINED" => Some(Self::Declined),
            "CANCELED" => Some(Self::Canceled),
            _ => None,
        }
    }

    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Declined | Self::Canceled)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StageStatus {
    Pending,
    /// Waiting for a scan, a decision or a signature; resumed by the stage's
    /// idempotency key.
    Parked,
    Done,
    Skipped,
}

impl StageStatus {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Parked => "PARKED",
            Self::Done => "DONE",
            Self::Skipped => "SKIPPED",
        }
    }

    pub const fn is_open(self) -> bool {
        matches!(self, Self::Pending | Self::Parked)
    }
}

/// What one stage did with one SKU.
///
/// `quantity` is what the stage handled and passes on; at receive it is what
/// was found. `missing` is handed over and not found (receive only);
/// `reject` is found and unsaleable, a part of `quantity`.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct StageCount {
    pub quantity: i64,
    #[serde(default)]
    pub missing: i64,
    #[serde(default)]
    pub reject: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ProofRecord {
    pub kind: ProofKind,
    /// Where the evidence is: a scan session, a file id, a note number.
    pub reference: String,
}

/// The document's fixed facts, as it was started.
#[derive(Clone, Debug, Serialize)]
pub struct FlowHeader {
    pub document_id: Uuid,
    pub route: FlowRoute,
    /// Who started it. An approval is never theirs to give.
    pub initiator: String,
    /// Whether the origin's unit is not the destination's. Decided by the
    /// sites' rows, never by the template.
    pub crosses_units: bool,
    pub destination_party: Option<PartyKind>,
    pub destination_pool: Option<PoolRole>,
    /// What was asked for, per SKU. Hidden from a blind stage.
    pub planned: BTreeMap<Uuid, i64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct StageRuntime {
    pub index: usize,
    pub stage: TemplateStage,
    pub status: StageStatus,
    pub park_reason: Option<ParkReason>,
    pub counts: BTreeMap<Uuid, StageCount>,
    /// Whether `counts` were recorded at this stage (rather than not yet).
    pub counted: bool,
    pub proof: Vec<ProofRecord>,
    pub done_by: Option<String>,
    pub delivery_number: Option<String>,
    pub decision: Option<ApprovalDecision>,
    pub note: Option<String>,
}

impl StageRuntime {
    pub fn kind(&self) -> StageKind {
        self.stage.kind
    }

    pub fn has_proof(&self, kind: ProofKind) -> bool {
        self.proof.iter().any(|proof| proof.kind == kind)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApprovalDecision {
    Approved,
    Declined,
}

impl ApprovalDecision {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Approved => "APPROVED",
            Self::Declined => "DECLINED",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct FlowState {
    pub header: FlowHeader,
    pub status: FlowStatus,
    pub stages: Vec<StageRuntime>,
}

impl FlowState {
    /// A document as it starts: every stage pending, and confirmed at once
    /// unless the template asks for an approval.
    pub fn start(header: FlowHeader, stages: Vec<TemplateStage>) -> Self {
        let asks_approval = stages.iter().any(|stage| stage.kind == StageKind::Approval);
        let stages = stages
            .into_iter()
            .enumerate()
            .map(|(index, stage)| StageRuntime {
                index,
                stage,
                status: StageStatus::Pending,
                park_reason: None,
                counts: BTreeMap::new(),
                counted: false,
                proof: Vec::new(),
                done_by: None,
                delivery_number: None,
                decision: None,
                note: None,
            })
            .collect();
        Self {
            header,
            status: if asks_approval {
                FlowStatus::Requested
            } else {
                FlowStatus::Confirmed
            },
            stages,
        }
    }

    /// The stage now due: the first one still open. `None` when every stage
    /// is done or skipped.
    pub fn cursor(&self) -> Option<usize> {
        self.stages
            .iter()
            .position(|stage| stage.status.is_open())
    }

    pub fn current(&self) -> Option<&StageRuntime> {
        self.cursor().map(|index| &self.stages[index])
    }

    pub fn stage_of(&self, kind: StageKind) -> Option<&StageRuntime> {
        self.stages.iter().find(|stage| stage.kind() == kind)
    }

    /// What the stage at `index` may pass on at most, per SKU: what the
    /// nearest earlier done stage that counted handed on, or the plan when no
    /// stage has counted yet.
    ///
    /// A blind count has no ceiling (`None`): goods beyond the order are real
    /// goods (Excess), and a count capped at the order would be a count that
    /// could see it.
    pub fn upstream(&self, index: usize) -> Option<BTreeMap<Uuid, i64>> {
        if self.stages[index].kind() == StageKind::BlindCount {
            return None;
        }
        let earlier = self.stages[..index]
            .iter()
            .rev()
            .find(|stage| stage.status == StageStatus::Done && stage.counted);
        Some(match earlier {
            Some(stage) => stage
                .counts
                .iter()
                .map(|(sku, count)| (*sku, count.quantity))
                .collect(),
            None => self.header.planned.clone(),
        })
    }

    /// Whether any goods have left the origin. A document whose goods are on
    /// the road is received, never cancelled.
    pub fn goods_have_left(&self) -> bool {
        self.stages.iter().any(|stage| {
            stage.status == StageStatus::Done
                && matches!(
                    stage.kind(),
                    StageKind::Depart | StageKind::HandoverWithProof
                )
        })
    }

    /// Whether any stage has moved goods at all.
    pub fn goods_have_moved(&self) -> bool {
        self.stages
            .iter()
            .any(|stage| stage.status == StageStatus::Done && stage.kind().moves_goods())
    }

    /// Whether the planned quantities may be shown now. Not while the stage
    /// due is blind, and not before it: the checker never sees the order.
    pub fn plan_is_visible(&self) -> bool {
        match self.stage_of(StageKind::BlindCount) {
            Some(blind) => blind.status == StageStatus::Done,
            None => !self.current().is_some_and(|stage| stage.stage.kind.spec().blind),
        }
    }
}
