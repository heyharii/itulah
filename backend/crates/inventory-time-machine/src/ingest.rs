//! Reading the six shapes the world actually arrives in.
//!
//! Every struct here is a plain serde record matching what one source emits —
//! column names, spelling and all — and every one of them normalises into the
//! same [`Event`] or [`Snapshot`]. Keeping the raw shapes visible is the point:
//! when a normaliser has to guess (a legacy row with no version, an outbox
//! entry whose body is missing a node), the guess is written down here in one
//! place instead of being spread through the fold.

use crate::diverge::Snapshot;
use crate::model::{
    Event, EventKind, NodeId, Payload, StateSource, SubjectId, SubjectState, UnitStatus,
};
use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum IngestError {
    #[error("row {row}: unknown {field} value `{value}`")]
    UnknownValue {
        row: String,
        field: &'static str,
        value: String,
    },
    #[error("row {row}: missing required field `{field}`")]
    MissingField { row: String, field: &'static str },
    #[error("row {row}: subject `{subject}` claims custody at {count} nodes at once")]
    MultipleCustody {
        row: String,
        subject: SubjectId,
        count: usize,
    },
    #[error("outbox entry {seq}: body is not an object")]
    MalformedBody { seq: u64 },
}

// ---------------------------------------------------------------------------
// 1. Canonical movement log
// ---------------------------------------------------------------------------

/// A row of the canonical movement log — the source of truth this crate
/// replays. `movement` is a string rather than an enum because the log is
/// older than this debugger and gains verbs without asking.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CanonicalMovement {
    pub seq: u64,
    pub occurred_at: DateTime<Utc>,
    pub epc: String,
    pub movement: String,
    #[serde(default)]
    pub from_node: Option<NodeId>,
    #[serde(default)]
    pub to_node: Option<NodeId>,
    #[serde(default)]
    pub quantity: Option<i64>,
    #[serde(default)]
    pub version: Option<u64>,
}

impl CanonicalMovement {
    pub fn into_event(self) -> Result<Event, IngestError> {
        let kind = match self.movement.as_str() {
            "receive" | "goods_receipt" => EventKind::Receive,
            "move" | "relocate" => EventKind::Move,
            "custody_transfer" | "handover" => EventKind::CustodyTransfer,
            "pick" => EventKind::Pick,
            "pack" => EventKind::Pack,
            "dispatch" | "ship" => EventKind::Dispatch,
            "adjust" => EventKind::Adjust,
            "void" | "write_off" => EventKind::Void,
            other => {
                return Err(IngestError::UnknownValue {
                    row: format!("movement seq {}", self.seq),
                    field: "movement",
                    value: other.to_owned(),
                })
            }
        };

        // A movement's custody follows its destination unless it is a pure
        // relocation, which by definition leaves the holder alone.
        let custody = match kind {
            EventKind::Move | EventKind::Pick | EventKind::Pack => None,
            _ => self.to_node.clone(),
        };

        Ok(Event {
            seq: self.seq,
            event_time: self.occurred_at,
            subject: SubjectId(self.epc),
            kind,
            payload: Payload {
                location: self.to_node,
                custody,
                from_custody: self.from_node,
                quantity_delta: self.quantity,
                observed_quantity: None,
                status: None,
                version: self.version,
                note: None,
            },
            caused_by: Vec::new(),
            origin: Some(format!("movement_log#{}", self.seq)),
        })
    }
}

// ---------------------------------------------------------------------------
// 2. Legacy ledger rows
// ---------------------------------------------------------------------------

/// A row from the pre-migration ledger. Its clock is naive (the old system
/// stored local time with no zone) and its sequence is a row id, so ordering
/// across the two systems is by `row_id` alone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegacyLedgerRow {
    pub row_id: u64,
    pub posted_at: NaiveDateTime,
    pub unit_id: String,
    pub action: String,
    #[serde(default)]
    pub node: Option<NodeId>,
    #[serde(default)]
    pub qty_delta: Option<i64>,
    #[serde(default)]
    pub revision: Option<u64>,
}

impl LegacyLedgerRow {
    pub fn into_event(self) -> Result<Event, IngestError> {
        let row = format!("legacy row {}", self.row_id);
        let kind = match self.action.as_str() {
            "IN" => EventKind::Receive,
            "XFER" => EventKind::CustodyTransfer,
            "MOVE" => EventKind::Move,
            "PICK" => EventKind::Pick,
            "PACK" => EventKind::Pack,
            "OUT" => EventKind::Dispatch,
            "ADJ" => EventKind::Adjust,
            "CNT" => EventKind::CountObserved,
            "VOID" => EventKind::Void,
            other => {
                return Err(IngestError::UnknownValue {
                    row,
                    field: "action",
                    value: other.to_owned(),
                })
            }
        };

        let observed_quantity = matches!(kind, EventKind::CountObserved)
            .then_some(self.qty_delta)
            .flatten();
        let quantity_delta = (!matches!(kind, EventKind::CountObserved))
            .then_some(self.qty_delta)
            .flatten();

        Ok(Event {
            seq: self.row_id,
            // The old system's local time is treated as UTC. This is wrong by
            // whatever the offset was, and it does not matter: `event_time` is
            // never an ordering input, only something a human reads.
            event_time: Utc.from_utc_datetime(&self.posted_at),
            subject: SubjectId(self.unit_id),
            kind,
            payload: Payload {
                location: self.node.clone(),
                custody: match kind {
                    EventKind::Move | EventKind::Pick | EventKind::Pack => None,
                    _ => self.node,
                },
                from_custody: None,
                quantity_delta,
                observed_quantity,
                status: None,
                version: self.revision,
                note: None,
            },
            caused_by: Vec::new(),
            origin: Some(format!("legacy_ledger#{}", self.row_id)),
        })
    }
}

// ---------------------------------------------------------------------------
// 3. Projection rows (a snapshot, not a log)
// ---------------------------------------------------------------------------

/// One row of a read model. A projection has no history to replay — it only
/// knows where it currently thinks the unit is — so these become a
/// [`Snapshot`], compared against a replay at the projection's watermark.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectionRow {
    pub subject: String,
    #[serde(default)]
    pub location: Option<NodeId>,
    /// A list because the storage allows it, which is exactly how a
    /// double-custody bug hides. Normalisation rejects more than one.
    #[serde(default)]
    pub custody_nodes: Vec<NodeId>,
    #[serde(default)]
    pub quantity: i64,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub version: u64,
}

impl ProjectionRow {
    fn into_state(self) -> Result<SubjectState, IngestError> {
        let row = format!("projection row `{}`", self.subject);
        let subject = SubjectId(self.subject);
        if self.custody_nodes.len() > 1 {
            return Err(IngestError::MultipleCustody {
                row,
                subject,
                count: self.custody_nodes.len(),
            });
        }
        let status = match self.status.as_deref() {
            None => UnitStatus::Unknown,
            Some(text) => parse_status(text).ok_or_else(|| IngestError::UnknownValue {
                row,
                field: "status",
                value: text.to_owned(),
            })?,
        };

        Ok(SubjectState {
            subject,
            location: self.location,
            custody: self.custody_nodes.into_iter().next(),
            quantity: self.quantity,
            status,
            version: self.version,
            last_seq: 0,
        })
    }
}

fn parse_status(text: &str) -> Option<UnitStatus> {
    Some(match text {
        "unknown" => UnitStatus::Unknown,
        "in_stock" => UnitStatus::InStock,
        "reserved" => UnitStatus::Reserved,
        "picked" => UnitStatus::Picked,
        "packed" => UnitStatus::Packed,
        "dispatched" => UnitStatus::Dispatched,
        "consumed" => UnitStatus::Consumed,
        "voided" => UnitStatus::Voided,
        _ => return None,
    })
}

/// Fold projection rows into a snapshot at the projection's own watermark.
pub fn projection_snapshot(
    rows: Vec<ProjectionRow>,
    as_of_seq: Option<u64>,
) -> Result<Snapshot, IngestError> {
    snapshot_from_rows(StateSource::Projection, rows, as_of_seq)
}

/// The same, for a legacy table dump that arrives as state rather than rows.
pub fn legacy_snapshot(
    rows: Vec<ProjectionRow>,
    as_of_seq: Option<u64>,
) -> Result<Snapshot, IngestError> {
    snapshot_from_rows(StateSource::Legacy, rows, as_of_seq)
}

fn snapshot_from_rows(
    source: StateSource,
    rows: Vec<ProjectionRow>,
    as_of_seq: Option<u64>,
) -> Result<Snapshot, IngestError> {
    let mut snapshot = Snapshot::new(source, as_of_seq);
    for row in rows {
        let state = row.into_state()?;
        snapshot.subjects.insert(state.subject.clone(), state);
    }
    Ok(snapshot)
}

// ---------------------------------------------------------------------------
// 4. Outbox / inbox entries
// ---------------------------------------------------------------------------

/// A transport-layer row: the envelope is structured, the body is whatever the
/// producer serialised. Divergences caused by an outbox that dropped, doubled
/// or reordered a message are found by replaying the outbox as its own log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutboxEntry {
    pub seq: u64,
    pub enqueued_at: DateTime<Utc>,
    pub subject: String,
    pub kind: String,
    #[serde(default)]
    pub body: serde_json::Value,
    #[serde(default)]
    pub caused_by: Vec<u64>,
}

impl OutboxEntry {
    pub fn into_event(self) -> Result<Event, IngestError> {
        let row = format!("outbox entry {}", self.seq);
        let kind = parse_kind(&self.kind).ok_or_else(|| IngestError::UnknownValue {
            row: row.clone(),
            field: "kind",
            value: self.kind.clone(),
        })?;

        let body = match &self.body {
            serde_json::Value::Null => serde_json::Map::new(),
            serde_json::Value::Object(map) => map.clone(),
            _ => return Err(IngestError::MalformedBody { seq: self.seq }),
        };
        let text = |key: &str| {
            body.get(key)
                .and_then(|value| value.as_str())
                .map(str::to_owned)
        };
        let number = |key: &str| body.get(key).and_then(serde_json::Value::as_i64);

        Ok(Event {
            seq: self.seq,
            event_time: self.enqueued_at,
            subject: SubjectId(self.subject),
            kind,
            payload: Payload {
                location: text("location").or_else(|| text("to_node")),
                custody: text("custody"),
                from_custody: text("from_custody").or_else(|| text("from_node")),
                quantity_delta: number("quantity_delta"),
                observed_quantity: number("observed_quantity"),
                status: text("status").and_then(|value| parse_status(&value)),
                version: number("version").and_then(|value| u64::try_from(value).ok()),
                note: text("note"),
            },
            caused_by: self.caused_by,
            origin: Some(format!("outbox#{}", self.seq)),
        })
    }
}

fn parse_kind(text: &str) -> Option<EventKind> {
    Some(match text {
        "receive" => EventKind::Receive,
        "move" => EventKind::Move,
        "custody_transfer" => EventKind::CustodyTransfer,
        "pick" => EventKind::Pick,
        "pack" => EventKind::Pack,
        "dispatch" => EventKind::Dispatch,
        "count_observed" => EventKind::CountObserved,
        "adjust" => EventKind::Adjust,
        "status_change" => EventKind::StatusChange,
        "void" => EventKind::Void,
        _ => return None,
    })
}

// ---------------------------------------------------------------------------
// 5. Count observations
// ---------------------------------------------------------------------------

/// A line off a count sheet: an assertion about reality that reconciles the
/// quantity rather than adding to it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CountObservationRow {
    pub seq: u64,
    pub counted_at: DateTime<Utc>,
    pub subject: String,
    pub node: NodeId,
    pub counted_quantity: i64,
    #[serde(default)]
    pub counter: Option<String>,
}

impl CountObservationRow {
    pub fn into_event(self) -> Event {
        let note = self.counter.map(|counter| format!("counted by {counter}"));
        Event {
            seq: self.seq,
            event_time: self.counted_at,
            subject: SubjectId(self.subject),
            kind: EventKind::CountObserved,
            payload: Payload {
                location: Some(self.node),
                observed_quantity: Some(self.counted_quantity),
                note,
                ..Payload::default()
            },
            caused_by: Vec::new(),
            origin: Some(format!("count_sheet#{}", self.seq)),
        }
    }
}

// ---------------------------------------------------------------------------
// 6. Pick / pack / dispatch facts
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FulfilmentStage {
    Pick,
    Pack,
    Dispatch,
}

/// What the fulfilment floor reported. Separate from the movement log because
/// it is produced by handhelds that batch and retry, so it arrives late and
/// occasionally twice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FulfilmentFact {
    pub seq: u64,
    pub happened_at: DateTime<Utc>,
    pub subject: String,
    pub stage: FulfilmentStage,
    pub node: NodeId,
    /// Required for dispatch: who took the unit away.
    #[serde(default)]
    pub carrier: Option<NodeId>,
}

impl FulfilmentFact {
    pub fn into_event(self) -> Result<Event, IngestError> {
        let row = format!("fulfilment fact {}", self.seq);
        let (kind, custody) = match self.stage {
            FulfilmentStage::Pick => (EventKind::Pick, None),
            FulfilmentStage::Pack => (EventKind::Pack, None),
            FulfilmentStage::Dispatch => {
                let carrier = self.carrier.clone().ok_or(IngestError::MissingField {
                    row,
                    field: "carrier",
                })?;
                (EventKind::Dispatch, Some(carrier))
            }
        };

        Ok(Event {
            seq: self.seq,
            event_time: self.happened_at,
            subject: SubjectId(self.subject),
            kind,
            payload: Payload {
                location: Some(self.node.clone()),
                custody,
                from_custody: matches!(self.stage, FulfilmentStage::Dispatch).then_some(self.node),
                ..Payload::default()
            },
            caused_by: Vec::new(),
            origin: Some(format!("fulfilment#{}", self.seq)),
        })
    }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/// Merge normalised events from several sources into one ordered log.
///
/// Sorting is by `seq` and *stable*, so two rows that collided on a sequence
/// number keep the order their sources were listed in — which
/// [`crate::Timeline::build`] will then reject as a duplicate. That rejection
/// is the useful outcome: a collision means two sources disagree about the
/// total order, and silently picking one is how a debugger starts lying.
pub fn merge(sources: Vec<Vec<Event>>) -> Vec<Event> {
    let mut merged: Vec<Event> = sources.into_iter().flatten().collect();
    merged.sort_by_key(|event| event.seq);
    merged
}
