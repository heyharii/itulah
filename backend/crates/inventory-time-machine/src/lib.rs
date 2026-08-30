//! The Inventory Time Machine: a deterministic divergence debugger.
//!
//! Three systems claim to know where a unit is — the canonical movement log,
//! the legacy ledger, and a read-model projection — and periodically they stop
//! agreeing. The useful question is never "what is the difference now": by the
//! time anyone looks, the difference is a number with no cause attached. The
//! useful question is **at which sequence number did they first disagree, and
//! what happened there**.
//!
//! This crate answers that, in six steps:
//!
//! 1. [`ingest`] normalises six real-world row shapes into one [`Event`] type.
//! 2. [`Timeline::build`] validates the log's order and checkpoints it.
//! 3. [`Timeline::state_at_seq`] travels to any moment, resuming from the
//!    nearest checkpoint instead of replaying from zero.
//! 4. [`find_first_divergence`] binary-searches the comparison grid for the
//!    earliest disagreement, comparing Merkle-style world hashes at each probe.
//! 5. [`explain`] and [`triage`] turn that sequence number into two side-by-side
//!    histories of the divergent subject and a verdict naming the outlier.
//! 6. [`minimal_fixture`] shrinks the whole thing to the smallest pair of logs
//!    that still reproduces it, as JSON you can paste into a test.
//!
//! Along the way [`what_if`] answers "would this hypothetical event have fixed
//! it" against a cloned world, without touching the original.
//!
//! Everything here is a pure function of its inputs. No clock is read, no id is
//! generated, no I/O is performed, and iteration is over `BTreeMap`, never
//! `HashMap` — the same log always produces the same answer, byte for byte,
//! which is the only property that makes a debugger's output quotable in an
//! incident review.
//!
//! ```
//! use chrono::{TimeZone, Utc};
//! use inventory_time_machine::{
//!     find_first_divergence, Event, EventKind, Payload, StateSource, Timeline,
//! };
//!
//! let at = Utc.with_ymd_and_hms(2026, 3, 1, 9, 0, 0).unwrap();
//! let receive = Event::new(1, at, "E1", EventKind::Receive).with_payload(Payload {
//!     location: Some("DC1".into()),
//!     quantity_delta: Some(10),
//!     ..Payload::default()
//! });
//! let canonical_move = Event::new(2, at, "E1", EventKind::Move).with_payload(Payload {
//!     location: Some("STORE7".into()),
//!     ..Payload::default()
//! });
//! // The projection consumed the same event but wrote the wrong node.
//! let projected_move = Event::new(2, at, "E1", EventKind::Move).with_payload(Payload {
//!     location: Some("STORE9".into()),
//!     ..Payload::default()
//! });
//!
//! let canonical = Timeline::build(StateSource::Canonical, vec![receive.clone(), canonical_move]).unwrap();
//! let projection = Timeline::build(StateSource::Projection, vec![receive, projected_move]).unwrap();
//!
//! let divergence = find_first_divergence(&canonical, &projection).expect("they disagree");
//! assert_eq!(divergence.seq, 2);
//! assert_eq!(divergence.subject.as_str(), "E1");
//! assert_eq!(divergence.fields[0].field, "location");
//! ```

#![forbid(unsafe_code)]

pub mod causal;
pub mod diverge;
pub mod fixture;
pub mod hash;
pub mod ingest;
pub mod model;
pub mod replay;
pub mod timeline;
pub mod whatif;

pub use causal::{explain, triage, CausalChain, CausalStep, Triage, Verdict};
pub use diverge::{
    compare_snapshot, diff_subject, diff_worlds, find_first_divergence, scan_first_divergence,
    snapshot_invariant_faults, Divergence, FieldDiff, Snapshot, SubjectDelta,
};
pub use fixture::{minimal_fixture, Fixture};
pub use hash::{hash_subject, hash_world, subject_hashes, StateHash};
pub use model::{
    Event, EventKind, Invariant, InvariantViolation, NodeId, Payload, StateSource, SubjectId,
    SubjectState, UnitStatus, WorldState,
};
pub use replay::{apply, replay, replay_prefix, ReplayError};
pub use timeline::{Checkpoint, Timeline, DEFAULT_CHECKPOINT_INTERVAL};
pub use whatif::{compare_hypotheses, what_if, WhatIf};
