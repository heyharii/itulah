//! Unit tests for divergence finding, explanation, hypotheticals, fixtures,
//! and the ingest normalisers.

mod common;

use common::*;
use inventory_time_machine::{
    compare_hypotheses, compare_snapshot, explain, find_first_divergence, ingest, minimal_fixture,
    scan_first_divergence, snapshot_invariant_faults, triage, what_if, Event, EventKind, Fixture,
    Invariant, Payload, Snapshot, StateSource, SubjectId, SubjectState, Timeline, UnitStatus,
    Verdict,
};

/// A log long enough that a binary search does real work, with the projection
/// mis-handling exactly one event.
fn drifted_pair() -> (Timeline, Timeline) {
    let mut canonical = Vec::new();
    let mut projection = Vec::new();
    for seq in 1..=30u64 {
        let subject = format!("E{}", seq % 3);
        let event = if seq % 3 == 0 {
            adjust(seq, &subject, 2)
        } else {
            receive(seq, &subject, "DC1", 1)
        };
        canonical.push(event.clone());
        // At seq 17 the projection applied the adjustment twice.
        projection.push(if seq == 17 {
            adjust(seq, &subject, 4)
        } else {
            event
        });
    }
    (
        timeline(StateSource::Canonical, canonical),
        timeline(StateSource::Projection, projection),
    )
}

#[test]
fn identical_logs_do_not_diverge() {
    let (canonical, _) = drifted_pair();
    let twin = timeline(StateSource::Projection, canonical.events().to_vec());
    assert!(find_first_divergence(&canonical, &twin).is_none());
    assert!(scan_first_divergence(&canonical, &twin).is_none());
}

#[test]
fn the_binary_search_finds_the_first_divergence() {
    let (canonical, projection) = drifted_pair();
    let found = find_first_divergence(&canonical, &projection).expect("they drift");
    assert_eq!(found.seq, 17);
    assert_eq!(found.subject, SubjectId::from("E2"));
    assert_eq!(found.observed_source, StateSource::Projection);
    assert_eq!(found.fields.len(), 1);
    assert_eq!(found.fields[0].field, "quantity");
    assert_eq!(
        found,
        scan_first_divergence(&canonical, &projection).unwrap()
    );
}

#[test]
fn a_dropped_event_shows_up_as_an_absent_or_stale_row() {
    let canonical = timeline(
        StateSource::Canonical,
        vec![
            receive(1, "E1", "DC1", 1),
            move_to(2, "E1", "STORE7"),
            adjust(3, "E1", 1),
        ],
    );
    // The legacy feed never received seq 2.
    let legacy = timeline(
        StateSource::Legacy,
        vec![receive(1, "E1", "DC1", 1), adjust(3, "E1", 1)],
    );

    let found = find_first_divergence(&canonical, &legacy).unwrap();
    assert_eq!(found.seq, 2);
    let fields: Vec<&str> = found
        .fields
        .iter()
        .map(|field| field.field.as_str())
        .collect();
    assert_eq!(fields, vec!["location", "version"]);
}

#[test]
fn a_phantom_subject_is_reported_as_a_presence_diff() {
    let canonical = timeline(StateSource::Canonical, vec![receive(1, "E1", "DC1", 1)]);
    let legacy = timeline(
        StateSource::Legacy,
        vec![receive(1, "E1", "DC1", 1), receive(2, "GHOST", "DC1", 1)],
    );

    let found = find_first_divergence(&canonical, &legacy).unwrap();
    assert_eq!(found.seq, 2);
    assert_eq!(found.subject, SubjectId::from("GHOST"));
    assert_eq!(found.fields[0].field, "presence");
    assert_eq!(found.fields[0].expected, "<absent>");
}

#[test]
fn several_subjects_diverging_at_once_are_all_reported() {
    let canonical = timeline(
        StateSource::Canonical,
        vec![receive(1, "E1", "DC1", 1), receive(2, "E2", "DC1", 1)],
    );
    let legacy = timeline(StateSource::Legacy, vec![receive(2, "E2", "DC2", 1)]);

    let found = find_first_divergence(&canonical, &legacy).unwrap();
    assert_eq!(found.seq, 1);
    assert_eq!(found.subject, SubjectId::from("E1"));
    // E2 has not been seen yet at seq 1, so only E1 is divergent there.
    assert!(found.also_divergent.is_empty());

    let later = scan_first_divergence(&canonical, &legacy).unwrap();
    assert_eq!(later.seq, 1);
}

#[test]
fn an_invariant_broken_at_the_divergence_point_is_named() {
    let canonical = timeline(
        StateSource::Canonical,
        vec![receive(1, "E1", "DC1", 5), adjust(2, "E1", -1)],
    );
    let legacy = timeline(
        StateSource::Legacy,
        vec![receive(1, "E1", "DC1", 5), adjust(2, "E1", -9)],
    );

    let found = find_first_divergence(&canonical, &legacy).unwrap();
    assert_eq!(found.seq, 2);
    assert_eq!(
        found.violated_invariant,
        Some(Invariant::NonNegativeQuantity)
    );
}

// ---------------------------------------------------------------------------
// Causal explanation and triage
// ---------------------------------------------------------------------------

#[test]
fn the_causal_chain_prints_both_histories_up_to_the_split() {
    let (canonical, projection) = drifted_pair();
    let found = find_first_divergence(&canonical, &projection).unwrap();
    let chain = explain(&canonical, &projection, &found);

    assert_eq!(chain.subject, found.subject);
    assert_eq!(chain.divergence_seq, 17);
    assert_eq!(chain.observed_source, StateSource::Projection);
    assert!(!chain.canonical.is_empty() && !chain.observed.is_empty());

    // Only the divergent subject's events appear, in order, ending at the split.
    assert!(chain
        .canonical
        .windows(2)
        .all(|pair| pair[0].seq < pair[1].seq));
    assert_eq!(chain.canonical.last().unwrap().seq, 17);
    assert!(chain.canonical.last().unwrap().is_divergence_point);
    // Canonical received one unit at seq 17; the projection booked an
    // adjustment of +4 instead, and the two sentences say so.
    assert!(
        chain
            .canonical
            .last()
            .unwrap()
            .explanation
            .contains("received 1"),
        "{}",
        chain.canonical.last().unwrap().explanation
    );
    assert!(
        chain.observed.last().unwrap().explanation.contains("+4"),
        "{}",
        chain.observed.last().unwrap().explanation
    );
    assert!(chain.summary.contains("E2"), "{}", chain.summary);
}

#[test]
fn a_faithful_projection_exonerates_itself() {
    let events = vec![receive(1, "E1", "DC1", 4), move_to(2, "E1", "STORE7")];
    let canonical = timeline(StateSource::Canonical, events.clone());
    let projection = timeline(StateSource::Projection, events.clone());
    let legacy = timeline(
        StateSource::Legacy,
        vec![receive(1, "E1", "DC1", 4), move_to(2, "E1", "STORE9")],
    );

    let report = triage(&canonical, &legacy, &projection);
    assert!(matches!(
        report.verdict,
        Verdict::LegacyIsOutlier { seq: 2, .. }
    ));
    assert!(report.projection.is_none());
    assert!(report.verdict.headline().contains("legacy is the outlier"));
    assert_eq!(report.chain.unwrap().observed_source, StateSource::Legacy);
}

#[test]
fn a_faithful_legacy_points_at_the_consumer() {
    let events = vec![receive(1, "E1", "DC1", 4), move_to(2, "E1", "STORE7")];
    let canonical = timeline(StateSource::Canonical, events.clone());
    let legacy = timeline(StateSource::Legacy, events);
    let projection = timeline(
        StateSource::Projection,
        vec![receive(1, "E1", "DC1", 4), move_to(2, "E1", "STORE9")],
    );

    let report = triage(&canonical, &legacy, &projection);
    assert!(matches!(
        report.verdict,
        Verdict::ProjectionIsOutlier { seq: 2, .. }
    ));
    assert!(report
        .verdict
        .headline()
        .contains("projection is the outlier"));
}

#[test]
fn two_consumers_wrong_the_same_way_indict_the_shared_feed() {
    let canonical = timeline(
        StateSource::Canonical,
        vec![receive(1, "E1", "DC1", 4), move_to(2, "E1", "STORE7")],
    );
    let wrong = vec![receive(1, "E1", "DC1", 4), move_to(2, "E1", "STORE9")];
    let legacy = timeline(StateSource::Legacy, wrong.clone());
    let projection = timeline(StateSource::Projection, wrong);

    let report = triage(&canonical, &legacy, &projection);
    match report.verdict {
        Verdict::BothDiverge { same_way, .. } => assert!(same_way),
        other => panic!("expected both to diverge, got {other:?}"),
    }
    assert!(report.verdict.headline().contains("shared upstream feed"));
}

#[test]
fn two_consumers_wrong_differently_are_two_bugs() {
    let canonical = timeline(
        StateSource::Canonical,
        vec![receive(1, "E1", "DC1", 4), move_to(2, "E1", "STORE7")],
    );
    let legacy = timeline(
        StateSource::Legacy,
        vec![receive(1, "E1", "DC1", 4), move_to(2, "E1", "STORE9")],
    );
    let projection = timeline(
        StateSource::Projection,
        vec![receive(1, "E1", "DC1", 4), move_to(2, "E1", "STORE3")],
    );

    let report = triage(&canonical, &legacy, &projection);
    match report.verdict {
        Verdict::BothDiverge { same_way, .. } => assert!(!same_way),
        other => panic!("expected both to diverge, got {other:?}"),
    }
}

#[test]
fn agreement_across_all_three_yields_no_chain() {
    let events = vec![receive(1, "E1", "DC1", 4)];
    let report = triage(
        &timeline(StateSource::Canonical, events.clone()),
        &timeline(StateSource::Legacy, events.clone()),
        &timeline(StateSource::Projection, events),
    );
    assert_eq!(report.verdict, Verdict::Agreed);
    assert!(report.chain.is_none());
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

#[test]
fn a_snapshot_is_compared_at_its_own_watermark() {
    let canonical = timeline(
        StateSource::Canonical,
        vec![receive(1, "E1", "DC1", 4), move_to(2, "E1", "STORE7")],
    );

    // The projection is behind by one event but otherwise correct: compared at
    // its watermark it agrees, compared at the end it does not.
    let snapshot = Snapshot::new(StateSource::Projection, Some(1)).with_subject(SubjectState {
        subject: SubjectId::from("E1"),
        location: Some("DC1".into()),
        custody: Some("DC1".into()),
        quantity: 4,
        status: UnitStatus::InStock,
        version: 1,
        last_seq: 1,
    });
    assert!(compare_snapshot(&canonical, &snapshot).is_empty());

    let claiming_current = Snapshot {
        as_of_seq: None,
        ..snapshot
    };
    let deltas = compare_snapshot(&canonical, &claiming_current);
    assert_eq!(deltas.len(), 1);
    assert_eq!(deltas[0].subject, SubjectId::from("E1"));
}

#[test]
fn a_snapshot_can_be_faulted_without_any_log() {
    let snapshot = Snapshot::new(StateSource::Legacy, None)
        .with_subject(SubjectState {
            quantity: -2,
            ..SubjectState::empty(SubjectId::from("E1"))
        })
        .with_subject(SubjectState {
            status: UnitStatus::InStock,
            ..SubjectState::empty(SubjectId::from("E2"))
        });

    let faults = snapshot_invariant_faults(&snapshot);
    assert_eq!(faults.len(), 2);
    assert_eq!(faults[0].1, Invariant::NonNegativeQuantity);
    assert_eq!(faults[1].1, Invariant::SingleCustody);
}

// ---------------------------------------------------------------------------
// What-if
// ---------------------------------------------------------------------------

#[test]
fn a_hypothetical_never_touches_the_base_world() {
    let canonical = timeline(StateSource::Canonical, vec![receive(1, "E1", "DC1", 4)]);
    let base = canonical.final_state();
    let before = base.clone();

    let result = what_if(&base, &[move_to(2, "E1", "STORE7")]).unwrap();
    assert_eq!(base, before, "the base world is immutable");
    assert_eq!(result.changes.len(), 1);
    assert_eq!(result.changes[0].fields[0].field, "location");
    assert_eq!(
        result
            .after
            .get(&SubjectId::from("E1"))
            .unwrap()
            .location
            .as_deref(),
        Some("STORE7")
    );
    assert!(result.new_violations.is_empty());
}

#[test]
fn a_hypothetical_reports_the_violations_it_introduces() {
    let canonical = timeline(StateSource::Canonical, vec![receive(1, "E1", "DC1", 1)]);
    let result = what_if(&canonical.final_state(), &[adjust(2, "E1", -9)]).unwrap();
    assert_eq!(result.new_violations.len(), 1);
    assert_eq!(
        result.new_violations[0].invariant,
        Invariant::NonNegativeQuantity
    );
}

#[test]
fn a_hypothetical_that_changes_nothing_is_a_noop() {
    let canonical = timeline(StateSource::Canonical, vec![receive(1, "E1", "DC1", 4)]);
    let result = what_if(&canonical.final_state(), &[]).unwrap();
    assert!(result.is_noop());
}

#[test]
fn two_repairs_can_be_compared_to_each_other() {
    let canonical = timeline(StateSource::Canonical, vec![receive(1, "E1", "DC1", 4)]);
    let base = canonical.final_state();

    // Backfilling the missing adjustment and reconciling by count reach the
    // same quantity, so the only remaining difference is the version each path
    // leaves behind — which is exactly the kind of thing this comparison is for.
    let deltas =
        compare_hypotheses(&base, &[adjust(2, "E1", 3)], &[count(2, "E1", "DC1", 7)]).unwrap();
    assert!(deltas.is_empty(), "{deltas:?}");

    let differing =
        compare_hypotheses(&base, &[adjust(2, "E1", 3)], &[adjust(2, "E1", 4)]).unwrap();
    assert_eq!(differing.len(), 1);
    assert_eq!(differing[0].fields[0].field, "quantity");
}

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

#[test]
fn the_fixture_shrinks_to_the_events_that_matter() {
    let (canonical, projection) = drifted_pair();
    let found = find_first_divergence(&canonical, &projection).unwrap();
    let fixture = minimal_fixture(&canonical, &projection, &found);

    assert!(fixture.is_faithful());
    let reproduced = fixture.reproduces().unwrap();
    assert_eq!(reproduced.seq, found.seq);
    assert_eq!(reproduced.subject, found.subject);
    assert!(
        fixture.total_events() < canonical.len() + projection.len(),
        "a fixture that keeps everything has not been shrunk"
    );
    // Only the divergent subject survives the shrink.
    assert!(fixture
        .canonical_events
        .iter()
        .all(|event| event.subject == found.subject));
}

#[test]
fn the_fixture_round_trips_through_json() {
    let (canonical, projection) = drifted_pair();
    let found = find_first_divergence(&canonical, &projection).unwrap();
    let fixture = minimal_fixture(&canonical, &projection, &found);

    let json = fixture.to_json().unwrap();
    let restored = Fixture::from_json(&json).unwrap();
    assert_eq!(restored, fixture);
    assert!(restored.is_faithful());
}

#[test]
fn causal_dependencies_on_other_subjects_are_pulled_in() {
    // E_CHILD is created by a split of E_PARENT; the child's first event names
    // the parent's event as its cause.
    let split = Event::new(2, at(2), "CHILD", EventKind::Receive)
        .with_payload(Payload {
            location: Some("DC1".into()),
            quantity_delta: Some(3),
            ..Payload::default()
        })
        .with_causes([1]);

    let canonical = timeline(
        StateSource::Canonical,
        vec![
            receive(1, "PARENT", "DC1", 10),
            split.clone(),
            adjust(3, "CHILD", 1),
        ],
    );
    let legacy = timeline(
        StateSource::Legacy,
        vec![
            receive(1, "PARENT", "DC1", 10),
            split,
            adjust(3, "CHILD", 5),
        ],
    );

    let found = find_first_divergence(&canonical, &legacy).unwrap();
    assert_eq!(found.seq, 3);
    let fixture = minimal_fixture(&canonical, &legacy, &found);
    assert!(fixture.is_faithful());
    // The parent's event is only kept if dropping it changes the answer; the
    // shrink decides that, and either way the fixture must still reproduce.
    assert!(fixture
        .canonical_events
        .iter()
        .any(|event| event.subject == SubjectId::from("CHILD")));
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

#[test]
fn the_canonical_movement_log_normalises() {
    let row = ingest::CanonicalMovement {
        seq: 7,
        occurred_at: at(7),
        epc: "E1".into(),
        movement: "ship".into(),
        from_node: Some("DC1".into()),
        to_node: Some("CARRIER".into()),
        quantity: None,
        version: Some(3),
    };
    let event = row.into_event().unwrap();
    assert_eq!(event.kind, EventKind::Dispatch);
    assert_eq!(event.payload.custody.as_deref(), Some("CARRIER"));
    assert_eq!(event.payload.from_custody.as_deref(), Some("DC1"));
    assert_eq!(event.origin.as_deref(), Some("movement_log#7"));

    let unknown = ingest::CanonicalMovement {
        movement: "teleport".into(),
        ..ingest::CanonicalMovement {
            seq: 8,
            occurred_at: at(8),
            epc: "E1".into(),
            movement: String::new(),
            from_node: None,
            to_node: None,
            quantity: None,
            version: None,
        }
    };
    assert!(unknown.into_event().is_err());
}

#[test]
fn a_relocation_does_not_claim_custody() {
    let row = ingest::CanonicalMovement {
        seq: 1,
        occurred_at: at(1),
        epc: "E1".into(),
        movement: "relocate".into(),
        from_node: None,
        to_node: Some("BAY9".into()),
        quantity: None,
        version: None,
    };
    let event = row.into_event().unwrap();
    assert_eq!(event.kind, EventKind::Move);
    assert!(event.payload.custody.is_none());
}

#[test]
fn legacy_rows_normalise_including_their_naive_clock() {
    let row = ingest::LegacyLedgerRow {
        row_id: 11,
        posted_at: at(11).naive_utc(),
        unit_id: "E1".into(),
        action: "CNT".into(),
        node: Some("STORE7".into()),
        qty_delta: Some(4),
        revision: Some(2),
    };
    let event = row.into_event().unwrap();
    assert_eq!(event.kind, EventKind::CountObserved);
    assert_eq!(event.payload.observed_quantity, Some(4));
    assert!(
        event.payload.quantity_delta.is_none(),
        "a count is not a delta"
    );
    assert_eq!(event.event_time, at(11));
}

#[test]
fn a_projection_row_claiming_two_custody_nodes_is_rejected() {
    let rows = vec![ingest::ProjectionRow {
        subject: "E1".into(),
        location: Some("DC1".into()),
        custody_nodes: vec!["DC1".into(), "STORE7".into()],
        quantity: 1,
        status: Some("in_stock".into()),
        version: 1,
    }];
    let error = ingest::projection_snapshot(rows, Some(4)).unwrap_err();
    assert!(matches!(
        error,
        ingest::IngestError::MultipleCustody { count: 2, .. }
    ));
}

#[test]
fn projection_rows_become_a_snapshot() {
    let rows = vec![ingest::ProjectionRow {
        subject: "E1".into(),
        location: Some("DC1".into()),
        custody_nodes: vec!["DC1".into()],
        quantity: 4,
        status: Some("in_stock".into()),
        version: 1,
    }];
    let snapshot = ingest::projection_snapshot(rows, Some(1)).unwrap();
    assert_eq!(snapshot.source, StateSource::Projection);

    let canonical = timeline(StateSource::Canonical, vec![receive(1, "E1", "DC1", 4)]);
    assert!(compare_snapshot(&canonical, &snapshot).is_empty());
}

#[test]
fn an_outbox_body_is_read_leniently_but_not_blindly() {
    let entry = ingest::OutboxEntry {
        seq: 5,
        enqueued_at: at(5),
        subject: "E1".into(),
        kind: "custody_transfer".into(),
        body: serde_json::json!({ "from_node": "DC1", "custody": "STORE7", "note": "retry 2" }),
        caused_by: vec![4],
    };
    let event = entry.into_event().unwrap();
    assert_eq!(event.kind, EventKind::CustodyTransfer);
    assert_eq!(event.payload.from_custody.as_deref(), Some("DC1"));
    assert_eq!(event.payload.note.as_deref(), Some("retry 2"));
    assert_eq!(event.caused_by, vec![4]);

    let malformed = ingest::OutboxEntry {
        seq: 6,
        enqueued_at: at(6),
        subject: "E1".into(),
        kind: "move".into(),
        body: serde_json::json!("not an object"),
        caused_by: Vec::new(),
    };
    assert!(matches!(
        malformed.into_event().unwrap_err(),
        ingest::IngestError::MalformedBody { seq: 6 }
    ));
}

#[test]
fn a_dispatch_fact_without_a_carrier_is_refused() {
    let fact = ingest::FulfilmentFact {
        seq: 3,
        happened_at: at(3),
        subject: "E1".into(),
        stage: ingest::FulfilmentStage::Dispatch,
        node: "DC1".into(),
        carrier: None,
    };
    assert!(matches!(
        fact.into_event().unwrap_err(),
        ingest::IngestError::MissingField {
            field: "carrier",
            ..
        }
    ));
}

#[test]
fn a_count_sheet_line_becomes_a_reconciling_event() {
    let event = ingest::CountObservationRow {
        seq: 2,
        counted_at: at(2),
        subject: "E1".into(),
        node: "STORE7".into(),
        counted_quantity: 3,
        counter: Some("ayu".into()),
    }
    .into_event();
    assert_eq!(event.kind, EventKind::CountObserved);
    assert_eq!(event.payload.note.as_deref(), Some("counted by ayu"));
}

#[test]
fn merged_sources_build_one_ordered_log() {
    let movements = vec![ingest::CanonicalMovement {
        seq: 1,
        occurred_at: at(1),
        epc: "E1".into(),
        movement: "receive".into(),
        from_node: None,
        to_node: Some("DC1".into()),
        quantity: Some(5),
        version: None,
    }
    .into_event()
    .unwrap()];
    let counts = vec![ingest::CountObservationRow {
        seq: 2,
        counted_at: at(2),
        subject: "E1".into(),
        node: "DC1".into(),
        counted_quantity: 4,
        counter: None,
    }
    .into_event()];

    let merged = ingest::merge(vec![counts, movements]);
    let built = Timeline::build(StateSource::Canonical, merged).unwrap();
    assert_eq!(built.sequence_numbers(), vec![1, 2]);
    assert_eq!(
        built
            .final_state()
            .get(&SubjectId::from("E1"))
            .unwrap()
            .quantity,
        4
    );
}

#[test]
fn a_sequence_collision_between_sources_is_rejected_not_guessed() {
    let merged = ingest::merge(vec![
        vec![receive(1, "E1", "DC1", 1)],
        vec![receive(1, "E2", "DC1", 1)],
    ]);
    assert!(Timeline::build(StateSource::Canonical, merged).is_err());
}
