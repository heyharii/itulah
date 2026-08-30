//! Integration tests for the vendored inventory time machine.
//!
//! Two comparisons are exercised end to end against a migrated database:
//! ledger vs projection (single node: corruption is localised, explained by
//! the divergent row's full canonical history, and repaired hypothetically by
//! what-if), and edge fact log vs cloud ingest log (multi node: a tampered
//! fact is found at its exact sequence number with a reproducing fixture).

use inventory_edge::{
    application::{CorruptProjectionRequest, CreateMovementRequest, MovementLineRequest},
    infrastructure,
    infrastructure::{
        SyncDivergenceQuery, TimeMachineScope, TimeMachineStateQuery, WhatIfLine, WhatIfRequest,
    },
};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

async fn subject_by_epc(pool: &PgPool, epc: &str) -> Uuid {
    sqlx::query("SELECT id FROM inventory_subject WHERE epc = $1")
        .bind(epc)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|e| panic!("subject by epc: {e}"))
        .get("id")
}

fn delta_for<'a>(report: &'a Value, subject: Uuid, place: &str) -> &'a Value {
    report["reported"]
        .as_array()
        .unwrap_or_else(|| panic!("reported array"))
        .iter()
        .find(|entry| {
            entry["subject_id"] == json!(subject.to_string()) && entry["place_id"] == json!(place)
        })
        .unwrap_or_else(|| panic!("no delta for {subject}@{place} in {report}"))
}

#[sqlx::test(migrations = "./migrations")]
async fn ledger_projection_divergence_is_localised_and_what_if_repairs_it(pool: PgPool) {
    // A healthy seeded node: ledger fold and projection agree everywhere.
    let baseline = infrastructure::time_machine_divergence(&pool, TimeMachineScope::default())
        .await
        .unwrap_or_else(|e| panic!("baseline divergence: {e}"));
    assert_eq!(baseline["status"], "MATCH", "seed should be consistent: {baseline}");

    // Sequence-based travel is deterministic: same log, same hash, twice.
    let state_query = || TimeMachineStateQuery {
        seq: None,
        subject_id: None,
        pool_id: Some("store-07.floor".into()),
    };
    let once = infrastructure::time_machine_state(&pool, state_query())
        .await
        .unwrap_or_else(|e| panic!("state once: {e}"));
    let twice = infrastructure::time_machine_state(&pool, state_query())
        .await
        .unwrap_or_else(|e| panic!("state twice: {e}"));
    assert_eq!(once["state_hash"], twice["state_hash"]);
    assert_eq!(once["read_only"], true);

    // Move one unit so the subject has history worth explaining.
    let subject = subject_by_epc(&pool, "EPC00000006").await;
    infrastructure::create_movement(
        &pool,
        CreateMovementRequest {
            idempotency_key: "tm-move-1".into(),
            actor_id: "time-machine-test".into(),
            occurred_at: None,
            reason: "time machine history".into(),
            reference_type: Some("TEST".into()),
            reference_id: Some("TM-001".into()),
            cause: Some("NORMAL_MOVE".into()),
            lines: vec![MovementLineRequest {
                subject_id: None,
                epc: Some("EPC00000006".into()),
                quantity: 1,
                from: "store-07.warehouse:on_hand".into(),
                to: "store-07.floor:on_hand".into(),
            }],
        },
    )
    .await
    .unwrap_or_else(|e| panic!("movement: {e}"));

    let after_move = infrastructure::time_machine_divergence(&pool, TimeMachineScope::default())
        .await
        .unwrap_or_else(|e| panic!("post-move divergence: {e}"));
    assert_eq!(after_move["status"], "MATCH", "a normal movement keeps both in step");

    // Corrupt the projection row by +3 and expect exactly that row flagged,
    // with the ledger's full history of the row attached.
    let place = "store-07.floor:on_hand";
    infrastructure::corrupt_projection_for_test(
        &pool,
        CorruptProjectionRequest {
            subject_id: subject,
            place_id: place.into(),
            delta: 3,
        },
        true,
    )
    .await
    .unwrap_or_else(|e| panic!("corrupt projection: {e}"));

    let report = infrastructure::time_machine_divergence(&pool, TimeMachineScope::default())
        .await
        .unwrap_or_else(|e| panic!("divergence report: {e}"));
    assert_eq!(report["status"], "DIVERGENCE");
    assert_eq!(report["divergent_subjects"], 1, "only the corrupted row: {report}");
    let delta = delta_for(&report, subject, place);
    let quantity_diff = delta["diffs"]
        .as_array()
        .unwrap_or_else(|| panic!("diffs array"))
        .iter()
        .find(|diff| diff["field"] == "quantity")
        .unwrap_or_else(|| panic!("quantity diff in {delta}"));
    let ledger_says: i64 = quantity_diff["ledger"]
        .as_str()
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(|| panic!("ledger quantity"));
    let projection_says: i64 = quantity_diff["projection"]
        .as_str()
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(|| panic!("projection quantity"));
    assert_eq!(projection_says, ledger_says + 3);
    assert!(
        !delta["ledger_history"]
            .as_array()
            .unwrap_or_else(|| panic!("history array"))
            .is_empty(),
        "the divergent row carries its canonical history"
    );

    // The wrong hypothesis does not close the gap; the right one does.
    // Neither writes anything.
    let what_if = |delta: i64| WhatIfRequest {
        scope: TimeMachineScope::default(),
        hypothetical: vec![WhatIfLine {
            subject_id: subject,
            place_id: place.into(),
            quantity_delta: delta,
        }],
    };
    let wrong = infrastructure::time_machine_what_if(&pool, what_if(1))
        .await
        .unwrap_or_else(|e| panic!("wrong what-if: {e}"));
    assert_eq!(wrong["resolves_projection"], false);
    let right = infrastructure::time_machine_what_if(&pool, what_if(3))
        .await
        .unwrap_or_else(|e| panic!("right what-if: {e}"));
    assert_eq!(right["resolves_projection"], true, "{right}");
    let still = infrastructure::time_machine_divergence(&pool, TimeMachineScope::default())
        .await
        .unwrap_or_else(|e| panic!("post-what-if divergence: {e}"));
    assert_eq!(still["status"], "DIVERGENCE", "what-if must not write");
}

async fn insert_fact(
    pool: &PgPool,
    table: &str,
    origin: &str,
    seq: i64,
    subject: Uuid,
    quantity: i64,
    accepted: bool,
) {
    let payload = json!({
        "movement_group_id": Uuid::new_v4(),
        "cause": "NORMAL_MOVE",
        "reason": "sync test",
        "occurred_at": "2026-08-30T01:00:00Z",
        "lines": [{
            "subject_id": subject,
            "quantity": quantity,
            "from_place_id": "store-07.warehouse:on_hand",
            "to_place_id": "store-07.floor:on_hand",
        }],
    });
    let sql = if table == "sync_fact_log" {
        "INSERT INTO sync_fact_log (origin_id, generation, seq, event_id, event_type, payload)
         VALUES ($1, 1, $2, $3, 'inventory.movement', $4)"
    } else {
        "INSERT INTO sync_ingest_fact (origin_id, generation, seq, event_id, event_type, payload, status)
         VALUES ($1, 1, $2, $3, 'inventory.movement', $4, $5)"
    };
    let mut query = sqlx::query(sql)
        .bind(origin)
        .bind(seq)
        .bind(Uuid::new_v4())
        .bind(&payload);
    if table != "sync_fact_log" {
        query = query.bind(if accepted { "ACCEPTED" } else { "REJECTED" });
    }
    query
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("insert {table} seq {seq}: {e}"));
}

#[sqlx::test(migrations = "./migrations")]
async fn sync_divergence_localises_a_tampered_cloud_fact(pool: PgPool) {
    let subject = Uuid::new_v4();

    // Stream edge-1: three facts on the edge; the cloud holds the same three
    // but fact 2 arrived with quantity 7 instead of 5.
    for seq in 1..=3 {
        insert_fact(&pool, "sync_fact_log", "edge-1", seq, subject, 5, true).await;
    }
    insert_fact(&pool, "sync_ingest_fact", "edge-1", 1, subject, 5, true).await;
    insert_fact(&pool, "sync_ingest_fact", "edge-1", 2, subject, 7, true).await;
    insert_fact(&pool, "sync_ingest_fact", "edge-1", 3, subject, 5, true).await;

    let report = infrastructure::time_machine_sync_divergence(
        &pool,
        SyncDivergenceQuery {
            origin_id: "edge-1".into(),
            generation: 1,
        },
    )
    .await
    .unwrap_or_else(|e| panic!("sync divergence: {e}"));
    assert_eq!(report["status"], "DIVERGENCE", "{report}");
    assert_eq!(report["first_divergence_fact_seq"], 2, "{report}");
    assert_eq!(report["subject_id"], json!(subject.to_string()));
    assert!(report["causal_chain"]["canonical"]
        .as_array()
        .is_some_and(|steps| !steps.is_empty()));
    assert_eq!(report["minimal_fixture"]["faithful"], true, "{report}");

    // Stream edge-2: the cloud is one fact behind but agrees on what it holds.
    for seq in 1..=2 {
        insert_fact(&pool, "sync_fact_log", "edge-2", seq, subject, 4, true).await;
    }
    insert_fact(&pool, "sync_ingest_fact", "edge-2", 1, subject, 4, true).await;
    let behind = infrastructure::time_machine_sync_divergence(
        &pool,
        SyncDivergenceQuery {
            origin_id: "edge-2".into(),
            generation: 1,
        },
    )
    .await
    .unwrap_or_else(|e| panic!("behind stream: {e}"));
    assert_eq!(behind["status"], "MATCH", "{behind}");
    assert!(behind["detail"]
        .as_str()
        .is_some_and(|detail| detail.contains("behind")));

    // A stream nobody has written is reported as empty, not as agreement.
    let empty = infrastructure::time_machine_sync_divergence(
        &pool,
        SyncDivergenceQuery {
            origin_id: "edge-none".into(),
            generation: 1,
        },
    )
    .await
    .unwrap_or_else(|e| panic!("empty stream: {e}"));
    assert_eq!(empty["status"], "EMPTY");
}
