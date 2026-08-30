//! The self-contained event and state model the time machine folds over.
//!
//! Nothing here is imported from the domain crates on purpose. The debugger
//! has to ingest *heterogeneous* sources — the canonical movement log, legacy
//! ledger rows, a projection's own row set, outbox/inbox entries, count sheets,
//! pick/pack/dispatch facts — and those sources disagree about types by
//! definition. Sharing a domain type with one of them would quietly privilege
//! that source's view of the world, which is exactly the bug being hunted.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;

/// The thing whose history is being replayed: an EPC, a unit id, a lot id.
/// Opaque on purpose — the debugger never parses it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SubjectId(pub String);

impl SubjectId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<&str> for SubjectId {
    fn from(s: &str) -> Self {
        SubjectId(s.to_owned())
    }
}

impl From<String> for SubjectId {
    fn from(s: String) -> Self {
        SubjectId(s)
    }
}

impl fmt::Display for SubjectId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A place or party that can hold stock: a store, a DC, a bay, a carrier.
pub type NodeId = String;

/// Which of the three views of the world a state or log came from.
///
/// [`StateSource::Canonical`] is the only one derived by replay in this crate;
/// the other two are observations that may or may not agree with it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StateSource {
    /// Derived by deterministic replay of the movement log. The reference.
    Canonical,
    /// A legacy system's own book of record, usually row-per-posting.
    Legacy,
    /// A read model maintained incrementally by a consumer.
    Projection,
}

impl fmt::Display for StateSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            StateSource::Canonical => "canonical",
            StateSource::Legacy => "legacy",
            StateSource::Projection => "projection",
        })
    }
}

/// The lifecycle position of a subject. Deliberately coarse: this crate is a
/// debugger, not a workflow engine, and every extra state is another way for
/// two sources to disagree for uninteresting reasons.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default,
)]
#[serde(rename_all = "snake_case")]
pub enum UnitStatus {
    /// Never seen by any event yet.
    #[default]
    Unknown,
    InStock,
    Reserved,
    Picked,
    Packed,
    Dispatched,
    Consumed,
    Voided,
}

impl fmt::Display for UnitStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            UnitStatus::Unknown => "unknown",
            UnitStatus::InStock => "in_stock",
            UnitStatus::Reserved => "reserved",
            UnitStatus::Picked => "picked",
            UnitStatus::Packed => "packed",
            UnitStatus::Dispatched => "dispatched",
            UnitStatus::Consumed => "consumed",
            UnitStatus::Voided => "voided",
        })
    }
}

/// What an event claims happened. The payload carries the operands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    /// Stock arrived at a node and became known.
    Receive,
    /// Stock changed location without changing who is responsible for it.
    Move,
    /// Responsibility moved between nodes; location may or may not follow.
    CustodyTransfer,
    Pick,
    Pack,
    Dispatch,
    /// A physical count asserting a quantity. Reconciling, not incremental.
    CountObserved,
    /// A quantity correction with no physical movement.
    Adjust,
    /// A pure status transition (reserve, consume, ...).
    StatusChange,
    /// The subject is written off; quantity goes to zero.
    Void,
}

impl EventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EventKind::Receive => "receive",
            EventKind::Move => "move",
            EventKind::CustodyTransfer => "custody_transfer",
            EventKind::Pick => "pick",
            EventKind::Pack => "pack",
            EventKind::Dispatch => "dispatch",
            EventKind::CountObserved => "count_observed",
            EventKind::Adjust => "adjust",
            EventKind::StatusChange => "status_change",
            EventKind::Void => "void",
        }
    }
}

impl fmt::Display for EventKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Operands for an event. Every field is optional and `#[serde(default)]`,
/// because the sources being ingested each fill in a different subset and a
/// strict shape would reject the very rows worth debugging.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Payload {
    /// Where the subject ends up.
    pub location: Option<NodeId>,
    /// Who holds it afterwards.
    pub custody: Option<NodeId>,
    /// Who the source believes held it beforehand. Checked, not trusted:
    /// a mismatch is a [`Invariant::SingleCustody`] violation.
    pub from_custody: Option<NodeId>,
    /// Incremental quantity change (`Receive`, `Adjust`).
    pub quantity_delta: Option<i64>,
    /// Absolute asserted quantity (`CountObserved`).
    pub observed_quantity: Option<i64>,
    /// Target status (`StatusChange`).
    pub status: Option<UnitStatus>,
    /// The version the *source* claims this event produces. When present it is
    /// checked for monotonicity rather than taken on faith.
    pub version: Option<u64>,
    /// Free-form provenance ("outbox row 91", "count sheet 7"), carried into
    /// causal explanations verbatim.
    pub note: Option<String>,
}

/// One entry in a log. `seq` is the total order; `event_time` is what the
/// source *said* the wall clock was and is never used for ordering, because
/// the sources' clocks disagree and that disagreement is a bug class, not an
/// ordering input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Event {
    pub seq: u64,
    pub event_time: DateTime<Utc>,
    pub subject: SubjectId,
    pub kind: EventKind,
    #[serde(default)]
    pub payload: Payload,
    /// Sequence numbers this event was derived from. Used by the minimal
    /// fixture extractor to close over causal dependencies that do not share
    /// the divergent subject (a split, a re-pack, a merge).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub caused_by: Vec<u64>,
    /// Where the row came from, for the human reading the causal chain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
}

impl Event {
    /// Terse constructor for tests and for ingest normalisers.
    pub fn new(
        seq: u64,
        event_time: DateTime<Utc>,
        subject: impl Into<SubjectId>,
        kind: EventKind,
    ) -> Self {
        Event {
            seq,
            event_time,
            subject: subject.into(),
            kind,
            payload: Payload::default(),
            caused_by: Vec::new(),
            origin: None,
        }
    }

    pub fn with_payload(mut self, payload: Payload) -> Self {
        self.payload = payload;
        self
    }

    pub fn with_origin(mut self, origin: impl Into<String>) -> Self {
        self.origin = Some(origin.into());
        self
    }

    pub fn with_causes(mut self, causes: impl IntoIterator<Item = u64>) -> Self {
        self.caused_by = causes.into_iter().collect();
        self
    }
}

/// The folded state of one subject after some prefix of the log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubjectState {
    pub subject: SubjectId,
    pub location: Option<NodeId>,
    pub custody: Option<NodeId>,
    pub quantity: i64,
    pub status: UnitStatus,
    /// Monotonic per subject. Bumped by every applied event unless the source
    /// asserted a higher version of its own.
    pub version: u64,
    /// The sequence number of the last event folded into this state.
    pub last_seq: u64,
}

impl SubjectState {
    pub fn empty(subject: SubjectId) -> Self {
        SubjectState {
            subject,
            location: None,
            custody: None,
            quantity: 0,
            status: UnitStatus::Unknown,
            version: 0,
            last_seq: 0,
        }
    }

    /// Equality *as the debugger defines it*: every field except `last_seq`.
    ///
    /// Two sources can arrive at the same state by logs of different lengths —
    /// a projection that coalesced two updates is not wrong — so the sequence
    /// number that last touched a subject is provenance, not state. This is
    /// the same set of fields [`crate::hash_subject`] covers, which is what
    /// keeps the hash-based probe and the field-level diff from disagreeing.
    pub fn equivalent(&self, other: &SubjectState) -> bool {
        self.subject == other.subject
            && self.location == other.location
            && self.custody == other.custody
            && self.quantity == other.quantity
            && self.status == other.status
            && self.version == other.version
    }

    /// A one-line rendering used in divergence reports.
    pub fn summary(&self) -> String {
        format!(
            "loc={} custody={} qty={} status={} v{} @seq{}",
            self.location.as_deref().unwrap_or("-"),
            self.custody.as_deref().unwrap_or("-"),
            self.quantity,
            self.status,
            self.version,
            self.last_seq
        )
    }
}

/// Everything the replay knows after a prefix of the log.
///
/// `violations` is carried alongside the subjects rather than inside them:
/// two sources can reach the same state by different, differently-illegal
/// routes, and equality of *state* is the question the divergence finder asks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldState {
    pub source: StateSource,
    pub subjects: BTreeMap<SubjectId, SubjectState>,
    /// Number of events folded in (not the highest seq — logs can be sparse).
    pub applied: usize,
    /// Highest sequence number folded in, if any.
    pub upto_seq: Option<u64>,
    pub violations: Vec<InvariantViolation>,
}

impl WorldState {
    pub fn empty(source: StateSource) -> Self {
        WorldState {
            source,
            subjects: BTreeMap::new(),
            applied: 0,
            upto_seq: None,
            violations: Vec::new(),
        }
    }

    pub fn get(&self, subject: &SubjectId) -> Option<&SubjectState> {
        self.subjects.get(subject)
    }

    /// State equality *as the divergence finder defines it*: the subject map
    /// compared with [`SubjectState::equivalent`], ignoring which source
    /// produced it and any invariant violations logged along the way.
    pub fn same_subjects(&self, other: &WorldState) -> bool {
        self.subjects.len() == other.subjects.len()
            && self.subjects.iter().all(|(id, state)| {
                other
                    .subjects
                    .get(id)
                    .is_some_and(|theirs| state.equivalent(theirs))
            })
    }
}

/// The three properties replay enforces. Violations are recorded, never
/// silently repaired: a debugger that fixes the evidence is useless.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Invariant {
    /// A subject is in the custody of exactly one node at a time, and a
    /// transfer's claimed origin must be that node.
    SingleCustody,
    /// Quantities never go below zero.
    NonNegativeQuantity,
    /// A subject's version never decreases.
    VersionMonotonic,
}

impl Invariant {
    pub fn as_str(self) -> &'static str {
        match self {
            Invariant::SingleCustody => "single_custody",
            Invariant::NonNegativeQuantity => "non_negative_quantity",
            Invariant::VersionMonotonic => "version_monotonic",
        }
    }
}

impl fmt::Display for Invariant {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InvariantViolation {
    pub seq: u64,
    pub subject: SubjectId,
    pub invariant: Invariant,
    pub detail: String,
}
