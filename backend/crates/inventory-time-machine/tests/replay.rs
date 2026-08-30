//! Unit tests for the fold, the invariants, hashing, and checkpointed travel.

mod common;

use common::*;
use inventory_time_machine::{
    hash_subject, hash_world, replay, replay_prefix, subject_hashes, Invariant, ReplayError,
    StateSource, SubjectId, SubjectState, Timeline, UnitStatus,
};

#[test]
fn replay_is_a_pure_fold() {
    let events = vec![
        receive(1, "E1", "DC1", 10),
        move_to(2, "E1", "STORE7"),
        adjust(3, "E1", -4),
    ];

    let first = replay(StateSource::Canonical, &events, None).unwrap();
    let second = replay(StateSource::Canonical, &events, None).unwrap();
    assert_eq!(first, second);
    assert_eq!(hash_world(&first), hash_world(&second));

    let state = first.get(&SubjectId::from("E1")).unwrap();
    assert_eq!(state.location.as_deref(), Some("STORE7"));
    assert_eq!(state.quantity, 6);
    assert_eq!(state.version, 3);
    assert_eq!(state.last_seq, 3);
}

#[test]
fn upto_seq_truncates_the_fold() {
    let events = vec![
        receive(1, "E1", "DC1", 10),
        move_to(5, "E1", "STORE7"),
        adjust(9, "E1", -4),
    ];

    let partial = replay(StateSource::Canonical, &events, Some(5)).unwrap();
    assert_eq!(partial.applied, 2);
    assert_eq!(partial.upto_seq, Some(5));
    assert_eq!(partial.get(&SubjectId::from("E1")).unwrap().quantity, 10);

    // A sequence number that is not in the log lands between events.
    let between = replay(StateSource::Canonical, &events, Some(7)).unwrap();
    assert_eq!(between.subjects, partial.subjects);
}

#[test]
fn receiving_without_a_holder_puts_custody_at_the_receiving_node() {
    let world = replay(StateSource::Canonical, &[receive(1, "E1", "DC1", 3)], None).unwrap();
    let state = world.get(&SubjectId::from("E1")).unwrap();
    assert_eq!(state.custody.as_deref(), Some("DC1"));
    assert_eq!(state.status, UnitStatus::InStock);
}

#[test]
fn a_move_leaves_custody_alone_but_a_transfer_does_not() {
    let events = vec![
        receive(1, "E1", "DC1", 1),
        move_to(2, "E1", "DC1_BAY4"),
        transfer(3, "E1", "DC1", "STORE7"),
    ];
    let world = replay(StateSource::Canonical, &events, None).unwrap();
    let state = world.get(&SubjectId::from("E1")).unwrap();
    assert_eq!(state.location.as_deref(), Some("STORE7"));
    assert_eq!(state.custody.as_deref(), Some("STORE7"));

    let midway = replay(StateSource::Canonical, &events, Some(2)).unwrap();
    let midway = midway.get(&SubjectId::from("E1")).unwrap();
    assert_eq!(midway.location.as_deref(), Some("DC1_BAY4"));
    assert_eq!(
        midway.custody.as_deref(),
        Some("DC1"),
        "a move is not a handover"
    );
}

#[test]
fn a_count_reconciles_rather_than_accumulates() {
    let events = vec![
        receive(1, "E1", "DC1", 10),
        adjust(2, "E1", 5),
        count(3, "E1", "DC1", 2),
    ];
    let world = replay(StateSource::Canonical, &events, None).unwrap();
    assert_eq!(world.get(&SubjectId::from("E1")).unwrap().quantity, 2);
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

#[test]
fn a_transfer_from_the_wrong_node_breaks_single_custody() {
    let events = vec![
        receive(1, "E1", "DC1", 1),
        // STORE3 never held it; two nodes now believe they do.
        transfer(2, "E1", "STORE3", "STORE7"),
    ];
    let world = replay(StateSource::Canonical, &events, None).unwrap();
    assert_eq!(world.violations.len(), 1);
    let violation = &world.violations[0];
    assert_eq!(violation.invariant, Invariant::SingleCustody);
    assert_eq!(violation.seq, 2);
    assert!(violation.detail.contains("STORE3"), "{}", violation.detail);
}

#[test]
fn negative_quantity_is_reported_and_left_visible() {
    let events = vec![receive(1, "E1", "DC1", 2), adjust(2, "E1", -5)];
    let world = replay(StateSource::Canonical, &events, None).unwrap();
    assert_eq!(
        world.violations[0].invariant,
        Invariant::NonNegativeQuantity
    );
    assert_eq!(
        world.get(&SubjectId::from("E1")).unwrap().quantity,
        -3,
        "clamping here would hide the evidence"
    );
}

#[test]
fn a_version_that_goes_backwards_is_reported() {
    let mut stale = adjust(2, "E1", 1);
    stale.payload.version = Some(1);
    let events = vec![receive(1, "E1", "DC1", 1), stale];

    let world = replay(StateSource::Canonical, &events, None).unwrap();
    assert_eq!(world.violations[0].invariant, Invariant::VersionMonotonic);
    // The fold keeps going, and keeps the version monotonic anyway.
    assert_eq!(world.get(&SubjectId::from("E1")).unwrap().version, 2);
}

#[test]
fn a_higher_claimed_version_is_honoured() {
    let mut jump = adjust(2, "E1", 1);
    jump.payload.version = Some(99);
    let world = replay(
        StateSource::Canonical,
        &[receive(1, "E1", "DC1", 1), jump],
        None,
    )
    .unwrap();
    assert_eq!(world.get(&SubjectId::from("E1")).unwrap().version, 99);
}

#[test]
fn an_out_of_order_log_is_rejected_rather_than_sorted() {
    let events = vec![receive(5, "E1", "DC1", 1), receive(2, "E2", "DC1", 1)];
    assert_eq!(
        replay(StateSource::Canonical, &events, None).unwrap_err(),
        ReplayError::NonMonotonicSeq {
            previous: 5,
            next: 2
        }
    );

    let duplicated = vec![receive(5, "E1", "DC1", 1), receive(5, "E2", "DC1", 1)];
    assert_eq!(
        replay(StateSource::Canonical, &duplicated, None).unwrap_err(),
        ReplayError::DuplicateSeq(5)
    );
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

#[test]
fn the_world_hash_moves_when_any_field_moves() {
    let base = SubjectState {
        subject: SubjectId::from("E1"),
        location: Some("DC1".into()),
        custody: Some("DC1".into()),
        quantity: 4,
        status: UnitStatus::InStock,
        version: 2,
        last_seq: 9,
    };

    let mut moved = base.clone();
    moved.location = Some("DC2".into());
    assert_ne!(hash_subject(&base), hash_subject(&moved));

    // `last_seq` is deliberately outside the hash: two sources can reach the
    // same state by logs of different lengths.
    let mut later = base.clone();
    later.last_seq = 900;
    assert_eq!(hash_subject(&base), hash_subject(&later));
}

#[test]
fn field_boundaries_cannot_be_smudged() {
    let split = SubjectState {
        subject: SubjectId::from("E1"),
        location: Some("A".into()),
        custody: Some("B".into()),
        quantity: 0,
        status: UnitStatus::Unknown,
        version: 0,
        last_seq: 0,
    };
    let joined = SubjectState {
        location: Some("AB".into()),
        custody: Some(String::new()),
        ..split.clone()
    };
    assert_ne!(hash_subject(&split), hash_subject(&joined));
}

#[test]
fn subject_hashes_localise_the_change() {
    let events = vec![receive(1, "E1", "DC1", 1), receive(2, "E2", "DC1", 1)];
    let before = replay(StateSource::Canonical, &events, None).unwrap();

    let mut after = before.clone();
    after
        .subjects
        .get_mut(&SubjectId::from("E2"))
        .unwrap()
        .quantity = 7;

    let before_hashes = subject_hashes(&before);
    let after_hashes = subject_hashes(&after);
    assert_eq!(before_hashes[0], after_hashes[0], "E1 is untouched");
    assert_ne!(before_hashes[1], after_hashes[1], "E2 moved");
    assert_ne!(hash_world(&before), hash_world(&after));
}

#[test]
fn an_empty_world_has_a_stable_distinct_hash() {
    let empty = replay(StateSource::Canonical, &[], None).unwrap();
    assert_eq!(
        hash_world(&empty),
        inventory_time_machine::StateHash::empty_world()
    );
    let occupied = replay(StateSource::Canonical, &[receive(1, "E1", "DC1", 1)], None).unwrap();
    assert_ne!(hash_world(&empty), hash_world(&occupied));
}

#[test]
fn state_hash_round_trips_through_json() {
    let world = replay(StateSource::Canonical, &[receive(1, "E1", "DC1", 1)], None).unwrap();
    let hash = hash_world(&world);
    let json = serde_json::to_string(&hash).unwrap();
    assert_eq!(json, format!("\"{}\"", hash.to_hex()));
    let back: inventory_time_machine::StateHash = serde_json::from_str(&json).unwrap();
    assert_eq!(hash, back);
}

// ---------------------------------------------------------------------------
// Checkpointed time travel
// ---------------------------------------------------------------------------

fn long_log() -> Vec<inventory_time_machine::Event> {
    let mut events = Vec::new();
    for seq in 1..=40u64 {
        let subject = format!("E{}", seq % 5);
        events.push(match seq % 4 {
            0 => count(seq, &subject, "DC1", (seq % 7) as i64),
            1 => receive(seq, &subject, "DC1", 2),
            2 => move_to(seq, &subject, "STORE7"),
            _ => adjust(seq, &subject, 1),
        });
    }
    events
}

#[test]
fn checkpointed_travel_equals_a_full_replay() {
    let events = long_log();
    let timeline =
        Timeline::build_with_interval(StateSource::Canonical, events.clone(), 7).unwrap();

    for prefix_len in 0..=events.len() {
        let travelled = timeline.state_at_prefix(prefix_len);
        let replayed = replay_prefix(StateSource::Canonical, &events, prefix_len).unwrap();
        assert_eq!(travelled, replayed, "prefix {prefix_len}");
        assert_eq!(
            timeline.world_hash_at_prefix(prefix_len),
            hash_world(&replayed)
        );
    }
}

#[test]
fn the_checkpoint_interval_does_not_change_the_answer() {
    let events = long_log();
    let reference =
        Timeline::build_with_interval(StateSource::Canonical, events.clone(), 1).unwrap();
    for interval in [0usize, 2, 3, 13, 1000] {
        let timeline =
            Timeline::build_with_interval(StateSource::Canonical, events.clone(), interval)
                .unwrap();
        assert_eq!(
            timeline.final_state(),
            reference.final_state(),
            "interval {interval}"
        );
        assert_eq!(
            timeline.state_at_seq(17),
            reference.state_at_seq(17),
            "interval {interval}"
        );
    }
}

#[test]
fn checkpoints_are_placed_where_the_interval_says() {
    let timeline = Timeline::build_with_interval(StateSource::Canonical, long_log(), 10).unwrap();
    let placements: Vec<usize> = timeline
        .checkpoints()
        .iter()
        .map(|checkpoint| checkpoint.prefix_len)
        .collect();
    assert_eq!(placements, vec![0, 10, 20, 30, 40]);
}

#[test]
fn event_lookup_by_sequence_number_is_exact() {
    let timeline = Timeline::build_with_interval(
        StateSource::Canonical,
        vec![receive(1, "E1", "DC1", 1), adjust(9, "E1", 1)],
        4,
    )
    .unwrap();
    assert_eq!(timeline.event_at_seq(9).unwrap().seq, 9);
    assert!(timeline.event_at_seq(5).is_none());
    assert_eq!(timeline.prefix_len_for_seq(5), 1);
}
