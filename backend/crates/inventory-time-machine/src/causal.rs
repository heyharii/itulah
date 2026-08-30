//! Turning a sequence number into a story.
//!
//! A divergence report says "seq 4711, unit E9, quantity 3 vs 4". That is the
//! *location* of the bug, not its cause. The causal chain replays only the
//! divergent subject, from both sides, and prints the two histories next to
//! each other so the step where they parted is visible rather than inferred.

use crate::diverge::{find_first_divergence, Divergence};
use crate::model::{Event, EventKind, StateSource, SubjectId, SubjectState, WorldState};
use crate::timeline::Timeline;
use serde::{Deserialize, Serialize};

/// One event in the subject's history, with the state it produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CausalStep {
    pub seq: u64,
    pub source: StateSource,
    pub kind: EventKind,
    pub event_time: chrono::DateTime<chrono::Utc>,
    /// Sentence describing what this event did to this subject.
    pub explanation: String,
    /// The subject's state immediately after this event.
    pub state_after: SubjectState,
    /// True when this is the step at which the two sides parted.
    pub is_divergence_point: bool,
}

/// Which side is the odd one out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    /// All three views agree; there is nothing to explain.
    Agreed,
    /// The projection reproduces canonical faithfully; legacy is the outlier.
    LegacyIsOutlier { seq: u64, subject: SubjectId },
    /// Legacy agrees with canonical; the projection is the outlier — a
    /// consumer bug rather than a data-migration one.
    ProjectionIsOutlier { seq: u64, subject: SubjectId },
    /// Both disagree with canonical. Whether they disagree with each other in
    /// the same way is the next question, and `same_way` answers it.
    BothDiverge {
        legacy_seq: u64,
        projection_seq: u64,
        /// True when both observed views produced the *same* wrong state,
        /// which points at canonical replay or a shared upstream feed rather
        /// than at two independent bugs.
        same_way: bool,
    },
}

impl Verdict {
    /// A sentence a human can paste into an incident channel.
    pub fn headline(&self) -> String {
        match self {
            Verdict::Agreed => "all three views agree; no divergence found".to_owned(),
            Verdict::LegacyIsOutlier { seq, subject } => format!(
                "projection reproduces canonical faithfully; legacy is the outlier, first at seq {seq} on `{subject}`"
            ),
            Verdict::ProjectionIsOutlier { seq, subject } => format!(
                "legacy agrees with canonical; the projection is the outlier, first at seq {seq} on `{subject}`"
            ),
            Verdict::BothDiverge {
                legacy_seq,
                projection_seq,
                same_way,
            } => {
                if *same_way {
                    format!(
                        "legacy (seq {legacy_seq}) and projection (seq {projection_seq}) diverge identically — \
                         suspect the canonical log or a shared upstream feed, not the two consumers"
                    )
                } else {
                    format!(
                        "legacy (seq {legacy_seq}) and projection (seq {projection_seq}) diverge differently — \
                         two independent faults"
                    )
                }
            }
        }
    }
}

/// The two histories of one subject, side by side.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CausalChain {
    pub subject: SubjectId,
    pub divergence_seq: u64,
    /// What canonical replay says happened to this subject, in order.
    pub canonical: Vec<CausalStep>,
    /// What the observed source's log says, in order.
    pub observed: Vec<CausalStep>,
    pub observed_source: StateSource,
    pub summary: String,
}

/// Walk the divergent subject's history on both sides, up to and including the
/// divergence point.
///
/// Only that subject's events are folded, which is what makes the output
/// readable: the surrounding thousands of events cannot have moved this
/// subject, so leaving them out loses nothing.
pub fn explain(canonical: &Timeline, observed: &Timeline, divergence: &Divergence) -> CausalChain {
    let subject = divergence.subject.clone();
    let canonical_steps = subject_steps(canonical, &subject, divergence.seq);
    let observed_steps = subject_steps(observed, &subject, divergence.seq);

    let summary = summarise(divergence, &canonical_steps, &observed_steps);

    CausalChain {
        subject,
        divergence_seq: divergence.seq,
        canonical: canonical_steps,
        observed: observed_steps,
        observed_source: observed.source(),
        summary,
    }
}

fn subject_steps(timeline: &Timeline, subject: &SubjectId, upto_seq: u64) -> Vec<CausalStep> {
    let mut world = WorldState::empty(timeline.source());
    let mut steps = Vec::new();
    for event in timeline.events_for_upto(subject, upto_seq) {
        crate::replay::apply(&mut world, event);
        let state_after = world
            .get(subject)
            .cloned()
            .unwrap_or_else(|| SubjectState::empty(subject.clone()));
        steps.push(CausalStep {
            seq: event.seq,
            source: timeline.source(),
            kind: event.kind,
            event_time: event.event_time,
            explanation: describe(event, &state_after),
            state_after,
            is_divergence_point: event.seq == upto_seq,
        });
    }
    steps
}

/// A sentence for one event. Reads the payload rather than the kind alone, so
/// "moved" says where to and "adjusted" says by how much.
pub fn describe(event: &Event, after: &SubjectState) -> String {
    let payload = &event.payload;
    let location = payload.location.as_deref().unwrap_or("-");
    let custody = payload.custody.as_deref().unwrap_or("-");
    let body = match event.kind {
        EventKind::Receive => format!(
            "received {} at `{location}` into custody of `{}`",
            payload.quantity_delta.unwrap_or(1),
            after.custody.as_deref().unwrap_or("-")
        ),
        EventKind::Move => format!("moved to `{location}` (custody unchanged)"),
        EventKind::CustodyTransfer => format!(
            "custody handed from `{}` to `{custody}`",
            payload.from_custody.as_deref().unwrap_or("-")
        ),
        EventKind::Pick => format!("picked at `{location}`"),
        EventKind::Pack => format!("packed at `{location}`"),
        EventKind::Dispatch => format!("dispatched from `{location}` to carrier `{custody}`"),
        EventKind::CountObserved => format!(
            "counted at `{location}`: quantity reconciled to {}",
            payload.observed_quantity.unwrap_or(after.quantity)
        ),
        EventKind::Adjust => format!(
            "quantity adjusted by {:+} to {}",
            payload.quantity_delta.unwrap_or(0),
            after.quantity
        ),
        EventKind::StatusChange => format!("status set to `{}`", after.status),
        EventKind::Void => "voided; quantity zeroed and custody released".to_owned(),
    };

    let mut line = format!("seq {}: {body}", event.seq);
    if let Some(origin) = &event.origin {
        line.push_str(&format!(" [{origin}]"));
    }
    if let Some(note) = &payload.note {
        line.push_str(&format!(" — {note}"));
    }
    line
}

fn summarise(divergence: &Divergence, canonical: &[CausalStep], observed: &[CausalStep]) -> String {
    let fields = if divergence.fields.is_empty() {
        "state".to_owned()
    } else {
        divergence
            .fields
            .iter()
            .map(|field| format!("{} ({} vs {})", field.field, field.expected, field.observed))
            .collect::<Vec<_>>()
            .join(", ")
    };

    let shape = match (
        canonical.last().map(|step| step.seq),
        observed.last().map(|step| step.seq),
    ) {
        (Some(left), Some(right)) if left == right => {
            "both logs carry an event at the divergence point; compare their payloads".to_owned()
        }
        (Some(left), Some(right)) => format!(
            "the observed log's last touch of this subject is seq {right}, canonical's is seq {left} — \
             one side processed an event the other did not"
        ),
        (Some(left), None) => format!(
            "the observed log never touches this subject; canonical last did at seq {left} — a dropped feed"
        ),
        (None, Some(right)) => format!(
            "canonical never touches this subject; the observed log did at seq {right} — a phantom row"
        ),
        (None, None) => "neither log touches this subject at or before the divergence point".to_owned(),
    };

    let invariant = match divergence.violated_invariant {
        Some(invariant) => format!(" Invariant `{invariant}` was broken at this sequence number."),
        None => String::new(),
    };

    format!(
        "`{}` first diverges at seq {} on {fields}; {shape}.{invariant}",
        divergence.subject, divergence.seq
    )
}

/// The three-way question: canonical is the reference, legacy and projection
/// are both claims about it. Whichever one matches canonical exonerates itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Triage {
    pub legacy: Option<Divergence>,
    pub projection: Option<Divergence>,
    pub verdict: Verdict,
    /// The causal chain for whichever divergence came first, if any.
    pub chain: Option<CausalChain>,
}

/// Compare both observed logs against canonical and name the outlier.
pub fn triage(canonical: &Timeline, legacy: &Timeline, projection: &Timeline) -> Triage {
    let legacy_divergence = find_first_divergence(canonical, legacy);
    let projection_divergence = find_first_divergence(canonical, projection);

    let verdict = match (&legacy_divergence, &projection_divergence) {
        (None, None) => Verdict::Agreed,
        (Some(divergence), None) => Verdict::LegacyIsOutlier {
            seq: divergence.seq,
            subject: divergence.subject.clone(),
        },
        (None, Some(divergence)) => Verdict::ProjectionIsOutlier {
            seq: divergence.seq,
            subject: divergence.subject.clone(),
        },
        (Some(left), Some(right)) => Verdict::BothDiverge {
            legacy_seq: left.seq,
            projection_seq: right.seq,
            // "The same way" means the two observed worlds agree with each
            // other at the earlier of the two divergence points, while both
            // disagree with canonical.
            same_way: {
                let at = left.seq.min(right.seq);
                legacy
                    .state_at_seq(at)
                    .same_subjects(&projection.state_at_seq(at))
            },
        },
    };

    let chain = match (&legacy_divergence, &projection_divergence) {
        (Some(divergence), None) => Some(explain(canonical, legacy, divergence)),
        (None, Some(divergence)) => Some(explain(canonical, projection, divergence)),
        (Some(left), Some(right)) => {
            if left.seq <= right.seq {
                Some(explain(canonical, legacy, left))
            } else {
                Some(explain(canonical, projection, right))
            }
        }
        (None, None) => None,
    };

    Triage {
        legacy: legacy_divergence,
        projection: projection_divergence,
        verdict,
        chain,
    }
}
