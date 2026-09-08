//! A validated log plus the checkpoints that make time travel cheap.
//!
//! Without checkpoints, a binary search over a log of `n` events replays
//! `O(n log n)` events, and the constant is the whole log every single probe.
//! With a checkpoint every `k` events, a probe replays at most `k` events on
//! top of a stored world, so the search is `O(n + k log n)`.

use crate::hash::{hash_world, StateHash};
use crate::model::{Event, StateSource, SubjectId, WorldState};
use crate::replay::{apply, check_ordering, ReplayError};
use serde::{Deserialize, Serialize};

/// Default distance between checkpoints. Small enough that a probe is cheap,
/// large enough that the stored worlds do not dominate memory on a log of a
/// few hundred thousand events.
pub const DEFAULT_CHECKPOINT_INTERVAL: usize = 256;

/// A stored world, keyed by *prefix length* rather than sequence number so it
/// composes with the binary search, which probes prefixes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Checkpoint {
    /// Number of events folded in.
    pub prefix_len: usize,
    /// Highest sequence number folded in, if any.
    pub upto_seq: Option<u64>,
    pub world_hash: StateHash,
    pub world: WorldState,
}

/// A log that has been checked for ordering and indexed for random access in
/// time. Construction is the only place ordering is validated; every other
/// entry point takes a `Timeline` and can therefore assume it.
#[derive(Debug, Clone)]
pub struct Timeline {
    source: StateSource,
    events: Vec<Event>,
    interval: usize,
    checkpoints: Vec<Checkpoint>,
}

impl Timeline {
    /// Build with the default checkpoint interval.
    pub fn build(source: StateSource, events: Vec<Event>) -> Result<Self, ReplayError> {
        Self::build_with_interval(source, events, DEFAULT_CHECKPOINT_INTERVAL)
    }

    /// Build with an explicit interval. An interval of zero is treated as one:
    /// "no checkpoints at all" is never what the caller wants, and silently
    /// dividing by zero later is worse than rounding up here.
    pub fn build_with_interval(
        source: StateSource,
        events: Vec<Event>,
        interval: usize,
    ) -> Result<Self, ReplayError> {
        check_ordering(&events)?;
        let interval = interval.max(1);

        let mut checkpoints = Vec::with_capacity(events.len() / interval + 1);
        let mut world = WorldState::empty(source);
        checkpoints.push(Checkpoint {
            prefix_len: 0,
            upto_seq: None,
            world_hash: hash_world(&world),
            world: world.clone(),
        });
        for (index, event) in events.iter().enumerate() {
            apply(&mut world, event);
            let prefix_len = index + 1;
            if prefix_len % interval == 0 {
                checkpoints.push(Checkpoint {
                    prefix_len,
                    upto_seq: world.upto_seq,
                    world_hash: hash_world(&world),
                    world: world.clone(),
                });
            }
        }

        Ok(Timeline {
            source,
            events,
            interval,
            checkpoints,
        })
    }

    /// A log that will be folded exactly once.
    ///
    /// Checkpoints are an index for *repeated* probing: a binary search over
    /// time reads them and replays at most `interval` events per probe. A
    /// caller that asks for one state — the final world, or the world at one
    /// sequence — reads none of them, and building them is not free: every
    /// checkpoint clones the whole world and takes a Merkle root over every
    /// subject in it. On a ledger of eight thousand events that is thirty-four
    /// full-world clones and thirty-four Merkle roots computed and thrown away.
    ///
    /// So this is the constructor for that caller. Checkpoint zero still
    /// exists — `state_at_prefix` resumes from it — and folding from zero is
    /// the linear pass the caller was going to pay for anyway.
    pub fn build_for_single_fold(
        source: StateSource,
        events: Vec<Event>,
    ) -> Result<Self, ReplayError> {
        Self::build_with_interval(source, events, usize::MAX)
    }

    pub fn source(&self) -> StateSource {
        self.source
    }

    pub fn events(&self) -> &[Event] {
        &self.events
    }

    pub fn len(&self) -> usize {
        self.events.len()
    }

    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    pub fn checkpoint_interval(&self) -> usize {
        self.interval
    }

    pub fn checkpoints(&self) -> &[Checkpoint] {
        &self.checkpoints
    }

    /// Every sequence number in the log, ascending.
    pub fn sequence_numbers(&self) -> Vec<u64> {
        self.events.iter().map(|event| event.seq).collect()
    }

    /// The world after the first `prefix_len` events, resumed from the nearest
    /// checkpoint at or before that point. Longer prefixes than the log are
    /// clamped to the whole log.
    pub fn state_at_prefix(&self, prefix_len: usize) -> WorldState {
        let prefix_len = prefix_len.min(self.events.len());
        let base = self
            .checkpoints
            .iter()
            .rev()
            .find(|checkpoint| checkpoint.prefix_len <= prefix_len)
            .expect("checkpoint 0 always exists");
        let mut world = base.world.clone();
        for event in &self.events[base.prefix_len..prefix_len] {
            apply(&mut world, event);
        }
        world
    }

    /// The world after every event with `seq <= upto_seq`.
    pub fn state_at_seq(&self, upto_seq: u64) -> WorldState {
        self.state_at_prefix(self.prefix_len_for_seq(upto_seq))
    }

    /// The whole log folded.
    pub fn final_state(&self) -> WorldState {
        self.state_at_prefix(self.events.len())
    }

    /// How many events have `seq <= upto_seq`. Binary search over the log's own
    /// ordering, which construction guarantees is strictly increasing.
    pub fn prefix_len_for_seq(&self, upto_seq: u64) -> usize {
        self.events.partition_point(|event| event.seq <= upto_seq)
    }

    pub fn world_hash_at_prefix(&self, prefix_len: usize) -> StateHash {
        let prefix_len = prefix_len.min(self.events.len());
        if let Some(checkpoint) = self
            .checkpoints
            .iter()
            .find(|checkpoint| checkpoint.prefix_len == prefix_len)
        {
            return checkpoint.world_hash;
        }
        hash_world(&self.state_at_prefix(prefix_len))
    }

    /// Events touching one subject, in order.
    pub fn events_for(&self, subject: &SubjectId) -> Vec<&Event> {
        self.events
            .iter()
            .filter(|event| &event.subject == subject)
            .collect()
    }

    /// Events touching one subject up to and including `upto_seq`.
    pub fn events_for_upto(&self, subject: &SubjectId, upto_seq: u64) -> Vec<&Event> {
        self.events
            .iter()
            .filter(|event| &event.subject == subject && event.seq <= upto_seq)
            .collect()
    }

    /// Look up one event by sequence number.
    pub fn event_at_seq(&self, seq: u64) -> Option<&Event> {
        let index = self.events.partition_point(|event| event.seq < seq);
        self.events.get(index).filter(|event| event.seq == seq)
    }
}
