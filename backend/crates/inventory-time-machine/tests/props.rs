//! Property tests.
//!
//! Four claims are load-bearing for this crate, and none of them can be
//! established by examples:
//!
//! * the fold is deterministic and prefix-consistent;
//! * checkpointed time travel equals a full replay at every point;
//! * the binary-search divergence finder agrees with a linear scan;
//! * a shrunk fixture still reproduces the divergence it was cut from.

mod common;

use common::at;
use inventory_time_machine::{
    find_first_divergence, hash_world, minimal_fixture, replay, replay_prefix,
    scan_first_divergence, Event, EventKind, Payload, StateSource, Timeline,
};
use proptest::prelude::*;

const SUBJECTS: [&str; 4] = ["E1", "E2", "E3", "E4"];
const NODES: [&str; 3] = ["DC1", "STORE7", "STORE9"];

/// Any event kind, including the two reconciling ones. Used wherever the
/// property does not depend on divergence being absorbing.
fn any_event(seq: u64) -> impl Strategy<Value = Event> {
    (
        0usize..SUBJECTS.len(),
        0usize..10,
        0usize..NODES.len(),
        0usize..NODES.len(),
        -6i64..8,
    )
        .prop_map(move |(subject, kind, node, from_node, quantity)| {
            let kind = match kind {
                0 | 1 => EventKind::Receive,
                2 => EventKind::Move,
                3 => EventKind::CustodyTransfer,
                4 => EventKind::Pick,
                5 => EventKind::Pack,
                6 => EventKind::Dispatch,
                7 => EventKind::CountObserved,
                8 => EventKind::Adjust,
                _ => EventKind::Void,
            };
            Event::new(seq, at(seq), SUBJECTS[subject], kind).with_payload(Payload {
                location: Some(NODES[node].to_owned()),
                custody: Some(NODES[node].to_owned()),
                from_custody: Some(NODES[from_node].to_owned()),
                quantity_delta: Some(quantity),
                observed_quantity: Some(quantity.abs()),
                ..Payload::default()
            })
        })
}

/// Only kinds whose effect on quantity is additive: no count, no void.
///
/// The divergence finder's binary search assumes disagreement is absorbing,
/// and a reconciling event is exactly what breaks that assumption — it can
/// overwrite a wrong quantity and hide the earlier split. Generating logs
/// without them is not dodging the hard case; it is stating the precondition
/// the fast path documents, and the corruption below is then provably
/// permanent.
fn additive_event(seq: u64) -> impl Strategy<Value = Event> {
    (
        0usize..SUBJECTS.len(),
        0usize..6,
        0usize..NODES.len(),
        1i64..6,
    )
        .prop_map(move |(subject, kind, node, quantity)| {
            let kind = match kind {
                0..=2 => EventKind::Receive,
                3 => EventKind::Move,
                4 => EventKind::CustodyTransfer,
                _ => EventKind::Adjust,
            };
            Event::new(seq, at(seq), SUBJECTS[subject], kind).with_payload(Payload {
                location: Some(NODES[node].to_owned()),
                custody: Some(NODES[node].to_owned()),
                quantity_delta: Some(quantity),
                ..Payload::default()
            })
        })
}

fn any_log(max_len: usize) -> impl Strategy<Value = Vec<Event>> {
    (1usize..=max_len).prop_flat_map(|len| {
        let parts: Vec<_> = (0..len).map(|index| any_event(index as u64 + 1)).collect();
        parts
    })
}

fn additive_log(max_len: usize) -> impl Strategy<Value = Vec<Event>> {
    (4usize..=max_len).prop_flat_map(|len| {
        let parts: Vec<_> = (0..len)
            .map(|index| additive_event(index as u64 + 1))
            .collect();
        parts
    })
}

/// A log, plus a copy with the quantity of one additive event shifted. Because
/// nothing in an additive log ever reconciles a quantity, the shift can never
/// be undone: the two logs disagree from that event onwards, forever.
fn corrupted_pair() -> impl Strategy<Value = (Vec<Event>, Vec<Event>, usize)> {
    additive_log(30).prop_flat_map(|events| {
        let candidates: Vec<usize> = events
            .iter()
            .enumerate()
            .filter(|(_, event)| matches!(event.kind, EventKind::Receive | EventKind::Adjust))
            .map(|(index, _)| index)
            .collect();
        let candidate_count = candidates.len().max(1);
        (Just(events), Just(candidates), 0usize..candidate_count).prop_map(
            |(events, candidates, pick)| {
                if candidates.is_empty() {
                    return (events.clone(), events, usize::MAX);
                }
                let index = candidates[pick];
                let mut corrupted = events.clone();
                let payload = &mut corrupted[index].payload;
                payload.quantity_delta = Some(payload.quantity_delta.unwrap_or(0) + 17);
                (events, corrupted, index)
            },
        )
    })
}

proptest! {
    /// (a) The same log always folds to the same world, and folding a prefix
    /// then applying the next event equals folding the longer prefix.
    #[test]
    fn replay_is_deterministic_and_prefix_consistent(events in any_log(24)) {
        let once = replay(StateSource::Canonical, &events, None)?;
        let twice = replay(StateSource::Canonical, &events, None)?;
        prop_assert_eq!(&once, &twice);
        prop_assert_eq!(hash_world(&once), hash_world(&twice));

        for split in 0..events.len() {
            let mut stepwise = replay_prefix(StateSource::Canonical, &events, split)?;
            inventory_time_machine::apply(&mut stepwise, &events[split]);
            let wholesale = replay_prefix(StateSource::Canonical, &events, split + 1)?;
            prop_assert_eq!(&stepwise, &wholesale, "prefix {} + 1 event", split);
        }
    }

    /// The world hash is a function of the subject map alone, so equal states
    /// hash equal and (in practice) different states do not.
    #[test]
    fn equal_worlds_hash_equal(events in any_log(20)) {
        let left = replay(StateSource::Canonical, &events, None)?;
        // A different `source` is not part of the state being compared.
        let right = replay(StateSource::Legacy, &events, None)?;
        prop_assert!(left.same_subjects(&right));
        prop_assert_eq!(hash_world(&left), hash_world(&right));
    }

    /// (d) Checkpointed travel equals a full replay at every prefix, whatever
    /// the interval.
    #[test]
    fn checkpointed_replay_matches_full_replay(
        events in any_log(30),
        interval in 1usize..12,
    ) {
        let timeline = Timeline::build_with_interval(StateSource::Canonical, events.clone(), interval)?;
        for prefix_len in 0..=events.len() {
            let travelled = timeline.state_at_prefix(prefix_len);
            let replayed = replay_prefix(StateSource::Canonical, &events, prefix_len)?;
            prop_assert_eq!(&travelled, &replayed, "interval {} prefix {}", interval, prefix_len);
            prop_assert_eq!(timeline.world_hash_at_prefix(prefix_len), hash_world(&replayed));
        }
    }

    /// (b) The binary search returns exactly what a linear scan returns.
    #[test]
    fn divergence_search_matches_linear_scan(
        (clean, corrupted, index) in corrupted_pair(),
        interval in 1usize..9,
    ) {
        let canonical = Timeline::build_with_interval(StateSource::Canonical, clean, interval)?;
        let observed = Timeline::build_with_interval(StateSource::Projection, corrupted, interval)?;

        let searched = find_first_divergence(&canonical, &observed);
        let scanned = scan_first_divergence(&canonical, &observed);
        prop_assert_eq!(&searched, &scanned);

        if index == usize::MAX {
            prop_assert!(searched.is_none(), "an uncorrupted pair cannot diverge");
        } else {
            let divergence = searched.expect("a permanent quantity shift must show up");
            // The corruption is at `index`, whose sequence number is index + 1,
            // and nothing before it was touched.
            prop_assert_eq!(divergence.seq, index as u64 + 1);
            prop_assert_eq!(&divergence.subject, &canonical.events()[index].subject);
        }
    }

    /// An uncorrupted pair never diverges, however the checkpoints fall.
    #[test]
    fn identical_logs_never_diverge(events in any_log(24), interval in 1usize..9) {
        let canonical = Timeline::build_with_interval(StateSource::Canonical, events.clone(), interval)?;
        let twin = Timeline::build_with_interval(StateSource::Projection, events, interval + 1)?;
        prop_assert!(find_first_divergence(&canonical, &twin).is_none());
        prop_assert!(scan_first_divergence(&canonical, &twin).is_none());
    }

    /// (c) The shrunk fixture reproduces the same divergence, and is no bigger
    /// than the logs it came from.
    #[test]
    fn minimal_fixture_still_reproduces((clean, corrupted, index) in corrupted_pair()) {
        prop_assume!(index != usize::MAX);
        let canonical = Timeline::build_with_interval(StateSource::Canonical, clean, 5)?;
        let observed = Timeline::build_with_interval(StateSource::Legacy, corrupted, 5)?;
        let divergence = find_first_divergence(&canonical, &observed).expect("corrupted");

        let fixture = minimal_fixture(&canonical, &observed, &divergence);
        prop_assert!(fixture.is_faithful());

        let reproduced = fixture.reproduces().expect("faithful fixtures reproduce");
        prop_assert_eq!(reproduced.seq, divergence.seq);
        prop_assert_eq!(&reproduced.subject, &divergence.subject);
        prop_assert!(fixture.total_events() <= canonical.len() + observed.len());

        // The fixture survives a round trip through JSON, which is the form it
        // is actually filed in.
        let json = fixture.to_json().expect("serialisable");
        let restored = inventory_time_machine::Fixture::from_json(&json).expect("parses");
        prop_assert!(restored.is_faithful());
    }

    /// A hypothetical never mutates the world it was asked about.
    #[test]
    fn what_if_leaves_the_base_untouched(events in any_log(16), extra in any_log(4)) {
        let base = replay(StateSource::Canonical, &events, None)?;
        let before = base.clone();
        let hypothetical: Vec<Event> = extra
            .into_iter()
            .enumerate()
            .map(|(offset, mut event)| {
                event.seq = 10_000 + offset as u64;
                event
            })
            .collect();

        let result = inventory_time_machine::what_if(&base, &hypothetical)?;
        prop_assert_eq!(&base, &before);
        prop_assert_eq!(result.changes.is_empty(), base.same_subjects(&result.after));
    }
}
