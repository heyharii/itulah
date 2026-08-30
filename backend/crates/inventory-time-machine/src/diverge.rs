//! Finding the *first* moment two views of the world stopped agreeing.
//!
//! The last state is easy to compare and almost useless: by the time a
//! projection is 400 units short, thousands of events have gone by and the one
//! that broke it is buried. What matters is the earliest sequence number at
//! which the two views differ, because the event at that number is the suspect.
//!
//! # The absorbing assumption
//!
//! The binary search here assumes divergence is *absorbing*: once two views
//! disagree, they keep disagreeing. That holds for append-only inventory logs
//! — nothing in the fold reaches back and repairs a subject — with one honest
//! exception: a reconciling event ([`crate::EventKind::CountObserved`] or
//! [`crate::EventKind::Void`]) can overwrite a wrong quantity and paper the
//! disagreement over. If a log may contain those *after* the suspected
//! corruption, use [`scan_first_divergence`], which is linear and assumes
//! nothing. [`find_first_divergence`] is the fast path and returns the same
//! answer whenever the assumption holds.

use crate::model::{Invariant, StateSource, SubjectId, SubjectState, UnitStatus, WorldState};
use crate::timeline::Timeline;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A state observation that is not a log: a legacy table dump, or a
/// projection's rows read straight out of its store.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapshot {
    pub source: StateSource,
    /// The sequence number the source believes it has consumed up to. `None`
    /// means "it did not say", and the comparison then uses the whole log.
    pub as_of_seq: Option<u64>,
    pub subjects: BTreeMap<SubjectId, SubjectState>,
}

impl Snapshot {
    pub fn new(source: StateSource, as_of_seq: Option<u64>) -> Self {
        Snapshot {
            source,
            as_of_seq,
            subjects: BTreeMap::new(),
        }
    }

    pub fn with_subject(mut self, state: SubjectState) -> Self {
        self.subjects.insert(state.subject.clone(), state);
        self
    }

    /// Present the snapshot as a world so it can be diffed against a replay.
    pub fn as_world(&self) -> WorldState {
        WorldState {
            source: self.source,
            subjects: self.subjects.clone(),
            applied: 0,
            upto_seq: self.as_of_seq,
            violations: Vec::new(),
        }
    }
}

/// One field's worth of disagreement, pre-rendered for a human.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FieldDiff {
    pub field: String,
    pub expected: String,
    pub observed: String,
}

/// Everything two views disagree about for one subject.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubjectDelta {
    pub subject: SubjectId,
    pub expected: Option<SubjectState>,
    pub observed: Option<SubjectState>,
    pub fields: Vec<FieldDiff>,
}

/// The answer this crate exists to produce.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Divergence {
    /// The earliest sequence number at which the two views differ. The event
    /// carrying this number is the suspect.
    pub seq: u64,
    /// The subject that diverged. When several did at once, the
    /// lexicographically smallest, so the result is deterministic; the rest
    /// are in `also_divergent`.
    pub subject: SubjectId,
    pub expected: Option<SubjectState>,
    pub observed: Option<SubjectState>,
    /// Fields of `subject` that differ.
    pub fields: Vec<FieldDiff>,
    /// An invariant broken at this sequence number for this subject, if the
    /// replay of either side logged one. Often the whole explanation.
    pub violated_invariant: Option<Invariant>,
    /// Which non-canonical view was being checked.
    pub observed_source: StateSource,
    pub also_divergent: Vec<SubjectId>,
}

/// Compare two subject states field by field. `None` on either side is
/// rendered as `<absent>` rather than skipped: "the projection never created
/// this row" is a diff, and the most common one.
pub fn diff_subject(
    expected: Option<&SubjectState>,
    observed: Option<&SubjectState>,
) -> Vec<FieldDiff> {
    fn opt(value: Option<&str>) -> String {
        value.unwrap_or("-").to_owned()
    }

    match (expected, observed) {
        (None, None) => Vec::new(),
        (Some(expected), None) => vec![FieldDiff {
            field: "presence".to_owned(),
            expected: expected.summary(),
            observed: "<absent>".to_owned(),
        }],
        (None, Some(observed)) => vec![FieldDiff {
            field: "presence".to_owned(),
            expected: "<absent>".to_owned(),
            observed: observed.summary(),
        }],
        (Some(expected), Some(observed)) => {
            let mut diffs = Vec::new();
            if expected.location != observed.location {
                diffs.push(FieldDiff {
                    field: "location".to_owned(),
                    expected: opt(expected.location.as_deref()),
                    observed: opt(observed.location.as_deref()),
                });
            }
            if expected.custody != observed.custody {
                diffs.push(FieldDiff {
                    field: "custody".to_owned(),
                    expected: opt(expected.custody.as_deref()),
                    observed: opt(observed.custody.as_deref()),
                });
            }
            if expected.quantity != observed.quantity {
                diffs.push(FieldDiff {
                    field: "quantity".to_owned(),
                    expected: expected.quantity.to_string(),
                    observed: observed.quantity.to_string(),
                });
            }
            if expected.status != observed.status {
                diffs.push(FieldDiff {
                    field: "status".to_owned(),
                    expected: expected.status.to_string(),
                    observed: observed.status.to_string(),
                });
            }
            if expected.version != observed.version {
                diffs.push(FieldDiff {
                    field: "version".to_owned(),
                    expected: expected.version.to_string(),
                    observed: observed.version.to_string(),
                });
            }
            diffs
        }
    }
}

/// Every subject two worlds disagree about, in subject order.
pub fn diff_worlds(expected: &WorldState, observed: &WorldState) -> Vec<SubjectDelta> {
    let mut subjects: Vec<&SubjectId> = expected.subjects.keys().collect();
    subjects.extend(observed.subjects.keys());
    subjects.sort_unstable();
    subjects.dedup();

    subjects
        .into_iter()
        .filter_map(|subject| {
            let left = expected.subjects.get(subject);
            let right = observed.subjects.get(subject);
            // `equivalent` rather than `==`: `last_seq` is provenance, and a
            // stricter test here than the world hash uses would report
            // divergences the binary search cannot see.
            let agree = match (left, right) {
                (None, None) => true,
                (Some(left), Some(right)) => left.equivalent(right),
                _ => false,
            };
            if agree {
                return None;
            }
            Some(SubjectDelta {
                subject: subject.clone(),
                expected: left.cloned(),
                observed: right.cloned(),
                fields: diff_subject(left, right),
            })
        })
        .collect()
}

/// The sequence numbers at which two logs can meaningfully be compared: the
/// union of both, ascending. Comparing at any other point would ask one side
/// about a moment it has no opinion on.
fn comparison_points(left: &Timeline, right: &Timeline) -> Vec<u64> {
    let mut points = left.sequence_numbers();
    points.extend(right.sequence_numbers());
    points.sort_unstable();
    points.dedup();
    points
}

/// Fast path: binary search the comparison grid using checkpointed replay.
///
/// Returns `None` when the two logs agree at every point. See the module note
/// on the absorbing assumption.
pub fn find_first_divergence(canonical: &Timeline, observed: &Timeline) -> Option<Divergence> {
    let points = comparison_points(canonical, observed);
    if points.is_empty() {
        return None;
    }

    // If they still agree at the end, they agreed all the way — under the
    // absorbing assumption this single probe rules out the whole log.
    let last = *points.last().expect("non-empty");
    if !differs_at(canonical, observed, last) {
        return None;
    }

    // Invariant: `high` differs, everything strictly below `low` agrees.
    let mut low = 0usize;
    let mut high = points.len() - 1;
    while low < high {
        let mid = low + (high - low) / 2;
        if differs_at(canonical, observed, points[mid]) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }

    Some(build_divergence(canonical, observed, points[high]))
}

/// Slow path: probe every comparison point in order. Assumes nothing, and is
/// the oracle the property tests hold [`find_first_divergence`] against.
pub fn scan_first_divergence(canonical: &Timeline, observed: &Timeline) -> Option<Divergence> {
    comparison_points(canonical, observed)
        .into_iter()
        .find(|&seq| differs_at(canonical, observed, seq))
        .map(|seq| build_divergence(canonical, observed, seq))
}

fn differs_at(canonical: &Timeline, observed: &Timeline, seq: u64) -> bool {
    // Compare hashes first: one 32-byte comparison instead of a walk over
    // every subject, and the endpoints usually come straight from checkpoints.
    let left_prefix = canonical.prefix_len_for_seq(seq);
    let right_prefix = observed.prefix_len_for_seq(seq);
    canonical.world_hash_at_prefix(left_prefix) != observed.world_hash_at_prefix(right_prefix)
}

fn build_divergence(canonical: &Timeline, observed: &Timeline, seq: u64) -> Divergence {
    let expected_world = canonical.state_at_seq(seq);
    let observed_world = observed.state_at_seq(seq);
    let mut deltas = diff_worlds(&expected_world, &observed_world);

    // `differs_at` said the hashes differ, so there is at least one delta
    // unless a hash collided — in which case reporting the earliest subject of
    // an empty diff would be a lie, and an empty subject is the honest answer.
    let head = if deltas.is_empty() {
        SubjectDelta {
            subject: SubjectId(String::new()),
            expected: None,
            observed: None,
            fields: Vec::new(),
        }
    } else {
        deltas.remove(0)
    };

    let violated_invariant = expected_world
        .violations
        .iter()
        .chain(observed_world.violations.iter())
        .find(|violation| violation.seq == seq && violation.subject == head.subject)
        .map(|violation| violation.invariant);

    Divergence {
        seq,
        subject: head.subject,
        expected: head.expected,
        observed: head.observed,
        fields: head.fields,
        violated_invariant,
        observed_source: observed.source(),
        also_divergent: deltas.into_iter().map(|delta| delta.subject).collect(),
    }
}

/// Compare a replayed world against a snapshot that is not a log.
///
/// The snapshot's `as_of_seq` decides how much of the canonical log to fold;
/// when it is absent the whole log is used, which is the right default for a
/// dump taken while the writer was idle and the wrong one otherwise — so
/// sources that know their watermark should say so.
pub fn compare_snapshot(canonical: &Timeline, snapshot: &Snapshot) -> Vec<SubjectDelta> {
    let expected = match snapshot.as_of_seq {
        Some(seq) => canonical.state_at_seq(seq),
        None => canonical.final_state(),
    };
    diff_worlds(&expected, &snapshot.as_world())
}

/// A subject in a snapshot that breaks an invariant on its own terms, with no
/// replay involved: negative stock, or a status that cannot hold no custody.
pub fn snapshot_invariant_faults(snapshot: &Snapshot) -> Vec<(SubjectId, Invariant, String)> {
    let mut faults = Vec::new();
    for (subject, state) in &snapshot.subjects {
        if state.quantity < 0 {
            faults.push((
                subject.clone(),
                Invariant::NonNegativeQuantity,
                format!("snapshot holds quantity {}", state.quantity),
            ));
        }
        let held_somewhere = matches!(
            state.status,
            UnitStatus::InStock | UnitStatus::Reserved | UnitStatus::Picked | UnitStatus::Packed
        );
        if held_somewhere && state.custody.is_none() {
            faults.push((
                subject.clone(),
                Invariant::SingleCustody,
                format!("status `{}` with no custody node", state.status),
            ));
        }
    }
    faults
}
