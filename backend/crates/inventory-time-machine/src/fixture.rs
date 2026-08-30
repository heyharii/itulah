//! Minimal reproduction export.
//!
//! A divergence found in a log of 200,000 events is not a bug report, it is a
//! haystack with a note attached. What a ticket needs is the smallest pair of
//! logs that still produce the same first divergence, small enough to paste
//! into a test.
//!
//! The extraction is two passes. First a causal *closure*: every event
//! touching the divergent subject at or before the divergence point, plus the
//! transitive closure over [`crate::Event::caused_by`], which is how an event
//! on a different subject (a split, a re-pack) gets pulled in. Then a greedy
//! *shrink*: drop one sequence number at a time and keep the drop only if the
//! divergence still reproduces exactly. The shrink is what makes the result
//! minimal rather than merely small, and because every candidate is verified,
//! a fixture that fails to reproduce cannot be produced by this code.

use crate::diverge::{find_first_divergence, Divergence};
use crate::model::{Event, StateSource, SubjectId};
use crate::replay::ReplayError;
use crate::timeline::Timeline;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// Checkpoint interval for the tiny timelines built during shrinking. A
/// fixture is dozens of events, not thousands, so checkpoints are about
/// correctness parity with the full-size path rather than speed.
const FIXTURE_CHECKPOINT_INTERVAL: usize = 8;

/// A self-contained reproduction: two small logs and the divergence they must
/// produce. Serialises to JSON and back with no loss.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fixture {
    pub subject: SubjectId,
    /// The sequence number the shrunk logs must still diverge at.
    pub expected_seq: u64,
    pub observed_source: StateSource,
    pub canonical_events: Vec<Event>,
    pub observed_events: Vec<Event>,
}

impl Fixture {
    /// Rebuild the two timelines. Fails only if the fixture was hand-edited
    /// into an unorderable state.
    pub fn timelines(&self) -> Result<(Timeline, Timeline), ReplayError> {
        let canonical = Timeline::build_with_interval(
            StateSource::Canonical,
            self.canonical_events.clone(),
            FIXTURE_CHECKPOINT_INTERVAL,
        )?;
        let observed = Timeline::build_with_interval(
            self.observed_source,
            self.observed_events.clone(),
            FIXTURE_CHECKPOINT_INTERVAL,
        )?;
        Ok((canonical, observed))
    }

    /// The divergence this fixture actually produces, which is the only claim
    /// worth trusting about it.
    pub fn reproduces(&self) -> Option<Divergence> {
        let (canonical, observed) = self.timelines().ok()?;
        find_first_divergence(&canonical, &observed)
    }

    /// True when the fixture reproduces the divergence it was cut from — same
    /// sequence number, same subject.
    pub fn is_faithful(&self) -> bool {
        matches!(
            self.reproduces(),
            Some(divergence) if divergence.seq == self.expected_seq && divergence.subject == self.subject
        )
    }

    pub fn total_events(&self) -> usize {
        self.canonical_events.len() + self.observed_events.len()
    }

    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

/// Cut the smallest pair of logs that still reproduces `divergence`.
pub fn minimal_fixture(
    canonical: &Timeline,
    observed: &Timeline,
    divergence: &Divergence,
) -> Fixture {
    let mut keep = causal_closure(canonical, observed, &divergence.subject, divergence.seq);
    keep.insert(divergence.seq);

    // Greedy shrink, largest sequence number first: later events are usually
    // consequences rather than causes, so dropping from the tail converges in
    // fewer verified rebuilds.
    let candidates: Vec<u64> = keep.iter().copied().rev().collect();
    for candidate in candidates {
        if candidate == divergence.seq {
            continue;
        }
        let mut trial = keep.clone();
        trial.remove(&candidate);
        if reproduces_with(canonical, observed, divergence, &trial) {
            keep = trial;
        }
    }

    build_fixture(canonical, observed, divergence, &keep)
}

/// Every sequence number that could bear on the divergent subject: its own
/// events, plus whatever those events say they were derived from, transitively.
fn causal_closure(
    canonical: &Timeline,
    observed: &Timeline,
    subject: &SubjectId,
    upto_seq: u64,
) -> BTreeSet<u64> {
    let mut keep = BTreeSet::new();
    let mut frontier: Vec<u64> = Vec::new();

    for event in canonical
        .events_for_upto(subject, upto_seq)
        .into_iter()
        .chain(observed.events_for_upto(subject, upto_seq))
    {
        if keep.insert(event.seq) {
            frontier.extend(event.caused_by.iter().copied());
        }
    }

    while let Some(seq) = frontier.pop() {
        if seq > upto_seq || !keep.insert(seq) {
            continue;
        }
        for timeline in [canonical, observed] {
            if let Some(event) = timeline.event_at_seq(seq) {
                frontier.extend(event.caused_by.iter().copied());
            }
        }
    }

    keep
}

fn reproduces_with(
    canonical: &Timeline,
    observed: &Timeline,
    divergence: &Divergence,
    keep: &BTreeSet<u64>,
) -> bool {
    build_fixture(canonical, observed, divergence, keep).is_faithful()
}

fn build_fixture(
    canonical: &Timeline,
    observed: &Timeline,
    divergence: &Divergence,
    keep: &BTreeSet<u64>,
) -> Fixture {
    Fixture {
        subject: divergence.subject.clone(),
        expected_seq: divergence.seq,
        observed_source: observed.source(),
        canonical_events: filter_events(canonical, keep),
        observed_events: filter_events(observed, keep),
    }
}

fn filter_events(timeline: &Timeline, keep: &BTreeSet<u64>) -> Vec<Event> {
    timeline
        .events()
        .iter()
        .filter(|event| keep.contains(&event.seq))
        .cloned()
        .collect()
}
