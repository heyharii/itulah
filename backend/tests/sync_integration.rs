//! End-to-end tests for the ordered edge->cloud sync engine.
//!
//! One database plays both roles: the edge side (fact log, watermark, sender
//! state) and the receiver side (ingest log, ingest watermark) live in
//! disjoint tables, and the transport drives the REAL receiver router
//! in-process, so the whole protocol — enqueue-in-domain-tx, upload, prefix
//! settlement, dedup on resend, dead-lettering, breaker — is exercised
//! without a network.

use axum::body::{to_bytes, Body};
use http::Request;
use inventory_edge::application::sync::{
    sync_cycle, CycleReport, SyncCycleConfig, SyncTransport,
};
use inventory_edge::domain::{BreakerPolicy, IngestBatch, IngestResponse};
use inventory_edge::{
    application::{CreateMovementRequest, MovementLineRequest},
    http as api_http, infrastructure, AppConfig, AppState,
};
use serde_json::json;
use sqlx::{PgPool, Row};
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

fn test_config() -> AppConfig {
    AppConfig {
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|e| panic!("socket address: {e}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "store-e2e".into(),
        node_role: "STORE".into(),
        rfid_burst_window_seconds: 10,
        observed_window_hours: 24,
        lost_risk_window_days: 30,
        enable_test_controls: false,
        frontend_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend"),
        sync_upload_url: None,
        sync_upload_key: None,
        sync_ingest_key: None,
        sync_generation: 1,
        sync_enqueue_enabled: true,
        sync_interval_seconds: 5,
        sync_batch_limit: 100,
        sync_breaker_threshold: 3,
        sync_breaker_base_cooldown_seconds: 30,
        sync_breaker_max_cooldown_seconds: 900,
        sync_retention_days: 14,
        sync_degraded_after_seconds: 900,
        sync_apply_enabled: false,
        jwt_secret: None,
        auth_token_ttl_minutes: 60,
        bootstrap_admin_password: None,
        cors_allowed_origins: None,
    }
}

fn cycle_config() -> SyncCycleConfig {
    SyncCycleConfig {
        batch_limit: 100,
        breaker: BreakerPolicy {
            threshold: 3,
            base_cooldown_seconds: 30,
            max_cooldown_seconds: 900,
        },
    }
}

fn movement(epc: &str, key: &str) -> CreateMovementRequest {
    CreateMovementRequest {
        idempotency_key: key.into(),
        actor_id: "sync-test".into(),
        occurred_at: None,
        reason: "Sync integration test".into(),
        reference_type: Some("TEST".into()),
        reference_id: Some("SYNC-001".into()),
        cause: Some("NORMAL_MOVE".into()),
        lines: vec![MovementLineRequest {
            subject_id: None,
            epc: Some(epc.into()),
            quantity: 1,
            from: "store-07.warehouse:on_hand".into(),
            to: "store-07.floor:on_hand".into(),
        }],
    }
}

/// Drives the REAL receiver router in-process over the same database.
struct RouterTransport {
    state: AppState,
}

#[async_trait::async_trait]
impl SyncTransport for RouterTransport {
    async fn send(&self, batch: &IngestBatch) -> Result<IngestResponse, String> {
        let app = api_http::router(self.state.clone());
        let body = serde_json::to_vec(batch).map_err(|e| e.to_string())?;
        let request = Request::builder()
            .method("POST")
            .uri("/api/v1/sync/ingest")
            .header("content-type", "application/json")
            .body(Body::from(body))
            .map_err(|e| e.to_string())?;
        let response = app.oneshot(request).await.map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("ingest returned {}", response.status()));
        }
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
    }
}

/// A transport that always fails, for breaker tests.
struct FailingTransport;

#[async_trait::async_trait]
impl SyncTransport for FailingTransport {
    async fn send(&self, _batch: &IngestBatch) -> Result<IngestResponse, String> {
        Err("simulated transport failure".into())
    }
}

async fn fact_log_count(pool: &PgPool) -> i64 {
    sqlx::query("SELECT count(*)::bigint AS count FROM sync_fact_log")
        .fetch_one(pool)
        .await
        .unwrap_or_else(|e| panic!("fact log count: {e}"))
        .get("count")
}

async fn ingest_count(pool: &PgPool, status: &str) -> i64 {
    sqlx::query("SELECT count(*)::bigint AS count FROM sync_ingest_fact WHERE status = $1")
        .bind(status)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|e| panic!("ingest count: {e}"))
        .get("count")
}

#[sqlx::test(migrations = "./migrations")]
async fn ordered_sync_end_to_end(pool: PgPool) {
    infrastructure::provision_origin(&pool, "store-e2e", 1, true)
        .await
        .unwrap_or_else(|e| panic!("provision: {e}"));
    let state = AppState::new(pool.clone(), test_config());
    let transport = RouterTransport {
        state: state.clone(),
    };

    // A movement commits its sync fact in the same transaction.
    infrastructure::create_movement(&pool, movement("EPC00000006", "sync-e2e-move-1"))
        .await
        .unwrap_or_else(|e| panic!("movement: {e}"));
    assert_eq!(fact_log_count(&pool).await, 1);

    // One cycle drains it and the watermark advances on both sides.
    let report = sync_cycle(&pool, &cycle_config(), &transport)
        .await
        .unwrap_or_else(|e| panic!("cycle: {e}"));
    assert_eq!(
        report,
        CycleReport::Advanced {
            sent: 1,
            advance_to: 1,
            dead_lettered: 0
        }
    );
    assert_eq!(
        infrastructure::watermark(&pool, "store-e2e", 1)
            .await
            .unwrap_or_else(|e| panic!("watermark: {e}")),
        1
    );
    assert_eq!(ingest_count(&pool, "ACCEPTED").await, 1);

    // A second movement drains in the next cycle.
    infrastructure::create_movement(&pool, movement("EPC00000007", "sync-e2e-move-2"))
        .await
        .unwrap_or_else(|e| panic!("movement 2: {e}"));
    let report = sync_cycle(&pool, &cycle_config(), &transport)
        .await
        .unwrap_or_else(|e| panic!("cycle 2: {e}"));
    assert_eq!(
        report,
        CycleReport::Advanced {
            sent: 1,
            advance_to: 2,
            dead_lettered: 0
        }
    );

    // Crash recovery: a lost watermark means resending everything, and the
    // receiver's dedup makes that harmless.
    sqlx::query("UPDATE sync_watermark SET durable_seq = 0")
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("reset watermark: {e}"));
    let report = sync_cycle(&pool, &cycle_config(), &transport)
        .await
        .unwrap_or_else(|e| panic!("cycle 3: {e}"));
    assert_eq!(
        report,
        CycleReport::Advanced {
            sent: 2,
            advance_to: 2,
            dead_lettered: 0
        }
    );
    assert_eq!(ingest_count(&pool, "ACCEPTED").await, 2);

    // A malformed fact is tombstoned at the receiver, dead-lettered at the
    // edge, and the watermark passes it instead of damming the stream.
    infrastructure::debug_insert_raw_fact(&pool, "  ", &json!({"broken": true}))
        .await
        .unwrap_or_else(|e| panic!("raw fact: {e}"));
    let report = sync_cycle(&pool, &cycle_config(), &transport)
        .await
        .unwrap_or_else(|e| panic!("cycle 4: {e}"));
    assert_eq!(
        report,
        CycleReport::Advanced {
            sent: 1,
            advance_to: 3,
            dead_lettered: 1
        }
    );
    assert_eq!(ingest_count(&pool, "REJECTED").await, 1);
    let dead: i64 = sqlx::query("SELECT count(*)::bigint AS count FROM sync_dead_letter")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("dead letters: {e}"))
        .get("count");
    assert_eq!(dead, 1);

    // Idle cycle once drained.
    let report = sync_cycle(&pool, &cycle_config(), &transport)
        .await
        .unwrap_or_else(|e| panic!("cycle 5: {e}"));
    assert_eq!(report, CycleReport::Idle);

    // Observability surfaces answer.
    let app = api_http::router(state.clone());
    let status = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/sync/status")
                .body(Body::empty())
                .unwrap_or_else(|e| panic!("status request: {e}")),
        )
        .await
        .unwrap_or_else(|e| panic!("status: {e}"));
    assert!(status.status().is_success());
    let bytes = to_bytes(status.into_body(), usize::MAX)
        .await
        .unwrap_or_else(|e| panic!("status body: {e}"));
    let status_json: serde_json::Value =
        serde_json::from_slice(&bytes).unwrap_or_else(|e| panic!("status json: {e}"));
    assert_eq!(status_json["watermark_seq"], 3);
    assert_eq!(status_json["backlog_count"], 0);
    assert_eq!(status_json["dead_letter_count"], 1);
    assert_eq!(status_json["state"], "OK");
    let metrics = app
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .body(Body::empty())
                .unwrap_or_else(|e| panic!("metrics request: {e}")),
        )
        .await
        .unwrap_or_else(|e| panic!("metrics: {e}"));
    assert!(metrics.status().is_success());
    let body = to_bytes(metrics.into_body(), usize::MAX)
        .await
        .unwrap_or_else(|e| panic!("metrics body: {e}"));
    let text = String::from_utf8_lossy(&body).to_string();
    assert!(text.contains("sync_backlog_facts 0"));
    assert!(text.contains("sync_dead_letter_total 1"));
    assert!(text.contains("sync_ingest_watermark_seq{origin=\"store-e2e\",generation=\"1\"} 3"));
}

#[sqlx::test(migrations = "./migrations")]
async fn breaker_opens_after_consecutive_failures_and_reset_closes_it(pool: PgPool) {
    infrastructure::provision_origin(&pool, "store-breaker", 1, true)
        .await
        .unwrap_or_else(|e| panic!("provision: {e}"));
    infrastructure::debug_insert_raw_fact(&pool, "inventory.movement", &json!({"n": 1}))
        .await
        .unwrap_or_else(|e| panic!("raw fact: {e}"));

    let config = cycle_config();
    for attempt in 1..=3_u32 {
        let report = sync_cycle(&pool, &config, &FailingTransport)
            .await
            .unwrap_or_else(|e| panic!("cycle: {e}"));
        match report {
            CycleReport::Failed {
                consecutive_failures,
                breaker_opened,
                ..
            } => {
                assert_eq!(consecutive_failures, attempt);
                assert_eq!(breaker_opened, attempt >= 3);
            }
            other => panic!("expected failure, got {other:?}"),
        }
    }
    // Breaker open: the next cycle refuses to try at all.
    let report = sync_cycle(&pool, &config, &FailingTransport)
        .await
        .unwrap_or_else(|e| panic!("skipped cycle: {e}"));
    assert!(matches!(report, CycleReport::SkippedBreaker { .. }));

    // Operator reset: the sender tries again immediately (and fails afresh
    // with a clean streak — the breaker did not remember the old one).
    infrastructure::reset_breaker(&pool)
        .await
        .unwrap_or_else(|e| panic!("reset: {e}"));
    let report = sync_cycle(&pool, &config, &FailingTransport)
        .await
        .unwrap_or_else(|e| panic!("post-reset cycle: {e}"));
    assert_eq!(
        report,
        CycleReport::Failed {
            error: "simulated transport failure".into(),
            consecutive_failures: 1,
            breaker_opened: false
        }
    );

    // Nothing ever advanced: the watermark is untouched by failures.
    assert_eq!(
        infrastructure::watermark(&pool, "store-breaker", 1)
            .await
            .unwrap_or_else(|e| panic!("watermark: {e}")),
        0
    );
}

// ---- 30-store scenarios ---------------------------------------------------

fn movement_fact(
    seq: i64,
    group_id: uuid::Uuid,
    subject_id: uuid::Uuid,
) -> inventory_edge::domain::SyncFact {
    inventory_edge::domain::SyncFact {
        seq,
        event_id: uuid::Uuid::new_v4(),
        event_type: "inventory.movement".into(),
        payload: json!({
            "movement_group_id": group_id,
            "cause": "NORMAL_MOVE",
            "reason": "multi-store apply test",
            "reference_type": null,
            "reference_id": null,
            "actor_id": "till-1",
            "occurred_at": chrono::Utc::now(),
            "lines": [{
                "subject_id": subject_id,
                "quantity": 1,
                "from_place_id": "store-07.warehouse:on_hand",
                "to_place_id": "store-07.floor:on_hand",
            }],
        }),
        created_at: chrono::Utc::now(),
    }
}

async fn seeded_subject(pool: &PgPool, epc: &str) -> uuid::Uuid {
    sqlx::query("SELECT id FROM inventory_subject WHERE epc = $1")
        .bind(epc)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|e| panic!("seeded subject {epc}: {e}"))
        .get("id")
}

async fn applied_seq(pool: &PgPool, origin: &str) -> i64 {
    sqlx::query(
        "SELECT applied_seq FROM sync_applied_watermark WHERE origin_id = $1 AND generation = 1",
    )
    .bind(origin)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|e| panic!("applied watermark {origin}: {e}"))
    .get("applied_seq")
}

#[sqlx::test(migrations = "./migrations")]
async fn thirty_store_apply_is_per_stream_and_idempotent(pool: PgPool) {
    let subject_a = seeded_subject(&pool, "EPC00000010").await;
    let subject_b = seeded_subject(&pool, "EPC00000011").await;
    let group_a = uuid::Uuid::new_v4();
    let group_b = uuid::Uuid::new_v4();

    // Two stores upload independently.
    for (origin, group, subject) in [
        ("store-A", group_a, subject_a),
        ("store-B", group_b, subject_b),
    ] {
        let response = infrastructure::ingest_batch(
            &pool,
            &IngestBatch {
                origin_id: origin.into(),
                generation: 1,
                facts: vec![movement_fact(1, group, subject)],
            },
        )
        .await
        .unwrap_or_else(|e| panic!("ingest {origin}: {e}"));
        assert_eq!(response.durable_through, 1);
    }

    // The applier replays both into the ledger.
    let report = infrastructure::apply_pending(&pool, 200)
        .await
        .unwrap_or_else(|e| panic!("apply: {e}"));
    assert_eq!(report.applied, 2);
    assert!(report.blocked.is_empty());
    for group in [group_a, group_b] {
        let rows: i64 =
            sqlx::query("SELECT count(*)::bigint AS count FROM movement WHERE movement_group_id = $1")
                .bind(group)
                .fetch_one(&pool)
                .await
                .unwrap_or_else(|e| panic!("movement rows: {e}"))
                .get("count");
        assert_eq!(rows, 1);
    }
    assert_eq!(applied_seq(&pool, "store-A").await, 1);
    assert_eq!(applied_seq(&pool, "store-B").await, 1);

    // Re-running applies nothing new.
    let report = infrastructure::apply_pending(&pool, 200)
        .await
        .unwrap_or_else(|e| panic!("apply 2: {e}"));
    assert_eq!((report.applied, report.skipped), (0, 0));

    // A replayed group id (same fact re-sequenced) is skipped by identity,
    // and the applied prefix still advances.
    infrastructure::ingest_batch(
        &pool,
        &IngestBatch {
            origin_id: "store-A".into(),
            generation: 1,
            facts: vec![movement_fact(2, group_a, subject_a)],
        },
    )
    .await
    .unwrap_or_else(|e| panic!("ingest replay: {e}"));
    let report = infrastructure::apply_pending(&pool, 200)
        .await
        .unwrap_or_else(|e| panic!("apply 3: {e}"));
    assert_eq!((report.applied, report.skipped), (0, 1));
    assert_eq!(applied_seq(&pool, "store-A").await, 2);

    // A store with an unappliable fact blocks ALONE; the other 29 keep going.
    let broken = inventory_edge::domain::SyncFact {
        seq: 1,
        event_id: uuid::Uuid::new_v4(),
        event_type: "inventory.movement".into(),
        payload: json!({"movement_group_id": uuid::Uuid::new_v4(), "not": "a movement"}),
        created_at: chrono::Utc::now(),
    };
    infrastructure::ingest_batch(
        &pool,
        &IngestBatch {
            origin_id: "store-C".into(),
            generation: 1,
            facts: vec![broken],
        },
    )
    .await
    .unwrap_or_else(|e| panic!("ingest broken: {e}"));
    infrastructure::ingest_batch(
        &pool,
        &IngestBatch {
            origin_id: "store-B".into(),
            generation: 1,
            facts: vec![movement_fact(2, uuid::Uuid::new_v4(), subject_b)],
        },
    )
    .await
    .unwrap_or_else(|e| panic!("ingest B2: {e}"));
    let report = infrastructure::apply_pending(&pool, 200)
        .await
        .unwrap_or_else(|e| panic!("apply 4: {e}"));
    assert_eq!(report.applied, 1); // store-B advanced
    assert_eq!(report.blocked.len(), 1);
    assert_eq!(report.blocked[0].origin_id, "store-C");
    assert_eq!(applied_seq(&pool, "store-C").await, 0);
    assert_eq!(applied_seq(&pool, "store-B").await, 2);

    // The blocked stream is visible: status flips DEGRADED with the reason.
    let app = api_http::router(AppState::new(pool.clone(), test_config()));
    let status = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/sync/status")
                .body(Body::empty())
                .unwrap_or_else(|e| panic!("status request: {e}")),
        )
        .await
        .unwrap_or_else(|e| panic!("status: {e}"));
    let bytes = to_bytes(status.into_body(), usize::MAX)
        .await
        .unwrap_or_else(|e| panic!("status body: {e}"));
    let status_json: serde_json::Value =
        serde_json::from_slice(&bytes).unwrap_or_else(|e| panic!("status json: {e}"));
    assert_eq!(status_json["state"], "DEGRADED");
    let blocked_stream = status_json["ingest_streams"]
        .as_array()
        .unwrap_or_else(|| panic!("streams array"))
        .iter()
        .find(|s| s["origin_id"] == "store-C")
        .unwrap_or_else(|| panic!("store-C stream missing"));
    assert!(blocked_stream["blocked"]["reason"]
        .as_str()
        .unwrap_or_default()
        .contains("payload"));
}

async fn post_json(
    app: axum::Router,
    uri: &str,
    key: Option<&str>,
    body: serde_json::Value,
) -> http::StatusCode {
    let mut request = Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json");
    if let Some(key) = key {
        request = request.header("x-sync-key", key);
    }
    let request = request
        .body(Body::from(
            serde_json::to_vec(&body).unwrap_or_else(|e| panic!("body: {e}")),
        ))
        .unwrap_or_else(|e| panic!("request: {e}"));
    app.oneshot(request)
        .await
        .unwrap_or_else(|e| panic!("oneshot: {e}"))
        .status()
}

#[sqlx::test(migrations = "./migrations")]
async fn per_origin_keys_stop_store_spoofing(pool: PgPool) {
    let mut config = test_config();
    config.sync_ingest_key = Some("master-key".into());
    let state = AppState::new(pool.clone(), config);
    let app = || api_http::router(state.clone());
    let empty_batch = |origin: &str| json!({"origin_id": origin, "generation": 1, "facts": []});

    // Registration needs the master key.
    let register =
        json!({"origin_id": "store-A", "ingest_key": "store-a-key", "label": "Store A"});
    assert_eq!(
        post_json(app(), "/api/v1/sync/origins", None, register.clone()).await,
        http::StatusCode::FORBIDDEN
    );
    assert_eq!(
        post_json(app(), "/api/v1/sync/origins", Some("master-key"), register).await,
        http::StatusCode::CREATED
    );

    // A registered origin is accepted ONLY with its own key: the master key
    // no longer lets anyone speak as store-A, and neither does store-B's key.
    for wrong in [None, Some("master-key"), Some("some-other-key")] {
        assert_eq!(
            post_json(app(), "/api/v1/sync/ingest", wrong, empty_batch("store-A")).await,
            http::StatusCode::FORBIDDEN
        );
    }
    assert_eq!(
        post_json(
            app(),
            "/api/v1/sync/ingest",
            Some("store-a-key"),
            empty_batch("store-A")
        )
        .await,
        http::StatusCode::OK
    );

    // An unregistered origin still bootstraps with the master key, and
    // nothing else.
    assert_eq!(
        post_json(
            app(),
            "/api/v1/sync/ingest",
            Some("master-key"),
            empty_batch("store-B")
        )
        .await,
        http::StatusCode::OK
    );
    assert_eq!(
        post_json(app(), "/api/v1/sync/ingest", None, empty_batch("store-B")).await,
        http::StatusCode::FORBIDDEN
    );
}
