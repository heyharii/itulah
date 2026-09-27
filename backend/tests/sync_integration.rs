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
use inventory_backend::cloud::application::sync::{
    sync_cycle, CycleReport, SyncCycleConfig, SyncTransport,
};
use inventory_backend::cloud::domain::{BreakerPolicy, IngestBatch, IngestResponse};
use inventory_backend::cloud::{
    application::{CreateMovementRequest, MovementLineRequest},
    http as api_http, postgres as infrastructure, AppConfig, AppState,
};
use serde_json::json;
use sqlx::{PgPool, Row};
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

fn generic_fact(seq: i64, event_id: uuid::Uuid) -> inventory_backend::cloud::domain::SyncFact {
    inventory_backend::cloud::domain::SyncFact {
        seq,
        event_id,
        event_type: "test.performance".into(),
        payload: json!({"seq":seq}),
        created_at: chrono::Utc::now(),
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn ingest_bulk_preserves_the_contiguous_prefix(pool: PgPool) {
    let first = uuid::Uuid::new_v4();
    let third = uuid::Uuid::new_v4();
    let response = infrastructure::ingest_batch(
        &pool,
        &IngestBatch {
            origin_id: "bulk-origin".into(),
            generation: 1,
            command_watermark: 0,
            command_blocked: None,
            facts: vec![generic_fact(3, third), generic_fact(1, first)],
        },
    )
    .await
    .unwrap_or_else(|error| panic!("gapped batch: {error}"));
    assert_eq!(response.durable_through, 1);

    let response = infrastructure::ingest_batch(
        &pool,
        &IngestBatch {
            origin_id: "bulk-origin".into(),
            generation: 1,
            command_watermark: 0,
            command_blocked: None,
            facts: vec![
                generic_fact(3, third),
                generic_fact(2, uuid::Uuid::new_v4()),
            ],
        },
    )
    .await
    .unwrap_or_else(|error| panic!("filled gap: {error}"));
    assert_eq!(response.durable_through, 3);

    let facts: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM sync_ingest_fact WHERE origin_id='bulk-origin'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("fact count: {error}"));
    assert_eq!(facts, 3);

    let hundred: Vec<_> = (1..=100)
        .map(|seq| generic_fact(seq, uuid::Uuid::new_v4()))
        .rev()
        .collect();
    let response = infrastructure::ingest_batch(
        &pool,
        &IngestBatch {
            origin_id: "hundred-origin".into(),
            generation: 1,
            command_watermark: 0,
            command_blocked: None,
            facts: hundred,
        },
    )
    .await
    .unwrap_or_else(|error| panic!("hundred facts: {error}"));
    assert_eq!(response.durable_through, 100);
}

fn test_config() -> AppConfig {
    AppConfig {
        po_import: inventory_backend::cloud::intake::po::PoImportConfig::from_env(),
        clock: None,
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
        finance_automation_enabled: false,
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
        auth_session_idle_minutes: 30,
        auth_cookie_secure: false,
        bootstrap_admin_password: None,
        cors_allowed_origins: None,
        media: None,
        attachments: None,
        default_destination_site_id: "dc".into(),
        assistant_api_key: None,
        assistant_base_url: "https://openrouter.ai/api/v1".into(),
        assistant_model: "anthropic/claude-opus-5".into(),
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
        command_key: None,
    }
}

/// A cycle config whose store can verify commands signed for it.
fn cycle_config_with_key(ingest_key: &str) -> SyncCycleConfig {
    SyncCycleConfig {
        command_key: Some(infrastructure::command_signing_key(ingest_key)),
        ..cycle_config()
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
    /// Present once the origin is registered: per-origin auth then demands it.
    key: Option<String>,
}

impl RouterTransport {
    fn with_key(state: AppState, key: &str) -> Self {
        Self {
            state,
            key: Some(key.to_string()),
        }
    }
}

#[async_trait::async_trait]
impl SyncTransport for RouterTransport {
    async fn send(&self, batch: &IngestBatch) -> Result<IngestResponse, String> {
        let app = api_http::router(self.state.clone());
        let body = serde_json::to_vec(batch).map_err(|e| e.to_string())?;
        let request = Request::builder()
            .method("POST")
            .uri("/api/v1/sync/ingest")
            .header("content-type", "application/json");
        let request = match &self.key {
            Some(key) => request.header("x-sync-key", key),
            None => request,
        };
        let request = request.body(Body::from(body)).map_err(|e| e.to_string())?;
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

#[sqlx::test(migrations = "./migrations/postgres")]
async fn ordered_sync_end_to_end(pool: PgPool) {
    const KEY: &str = "ordered-sync-integration-key-00000001";
    infrastructure::provision_origin(&pool, "store-e2e", 1, true)
        .await
        .unwrap_or_else(|e| panic!("provision: {e}"));
    infrastructure::register_origin_credential_binding(
        &pool,
        "store-e2e",
        KEY,
        Some("Store E2E"),
        Some("store-07"),
        Some("STORE"),
        Some(1),
        Some(true),
    )
    .await
    .unwrap_or_else(|e| panic!("register inventory origin: {e}"));
    let state = AppState::new(pool.clone(), test_config());
    let transport = RouterTransport::with_key(state.clone(), KEY);

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
        report.upstream,
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
        report.upstream,
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
        report.upstream,
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
        report.upstream,
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
    assert_eq!(report.upstream, CycleReport::Idle);

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

#[sqlx::test(migrations = "./migrations/postgres")]
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
        match report.upstream {
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
    assert!(matches!(
        report.upstream,
        CycleReport::SkippedBreaker { .. }
    ));

    // Operator reset: the sender tries again immediately (and fails afresh
    // with a clean streak — the breaker did not remember the old one).
    infrastructure::reset_breaker(&pool)
        .await
        .unwrap_or_else(|e| panic!("reset: {e}"));
    let report = sync_cycle(&pool, &config, &FailingTransport)
        .await
        .unwrap_or_else(|e| panic!("post-reset cycle: {e}"));
    assert_eq!(
        report.upstream,
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
    site_id: &str,
) -> inventory_backend::cloud::domain::SyncFact {
    inventory_backend::cloud::domain::SyncFact {
        seq,
        event_id: group_id,
        event_type: "inventory.movement".into(),
        payload: json!({
            "movement_group_id": group_id,
            "cause": "STORE_RECEIVE",
            "reason": "multi-store apply test",
            "reference_type": null,
            "reference_id": null,
            "actor_id": "till-1",
            "occurred_at": chrono::Utc::now(),
            "lines": [{
                "subject_id": subject_id,
                "quantity": 1,
                // An inbound movement, so the fixture does not ask the centre
                // to take stock out of a place that never had any. The centre
                // now refuses a movement that would drive a position
                // negative, which is right — a shop's history should never
                // imply it shipped what it never held.
                "from_place_id": "system/opening",
                "to_place_id": format!("{site_id}.warehouse:on_hand"),
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

#[sqlx::test(migrations = "./migrations/postgres")]
async fn thirty_store_apply_is_per_stream_and_idempotent(pool: PgPool) {
    // Every shop that uploads is a registered origin — the centre keeps the
    // position it derives per origin, and a position for a node it has never
    // heard of would belong to nobody.
    for (origin, site) in [("store-A", "store-07"), ("store-B", "store-12")] {
        infrastructure::register_origin_credential(
            &pool,
            origin,
            "fleet-integration-sync-key-00000001",
            Some(origin),
        )
        .await
        .unwrap_or_else(|e| panic!("register {origin}: {e}"));
        sqlx::query(
            "UPDATE sync_origin_credential
             SET site_id = $2, node_role = 'STORE', active_generation = 1, inventory_enabled = true
             WHERE origin_id = $1",
        )
        .bind(origin)
        .bind(site)
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("bind {origin}: {e}"));
    }
    let subject_a = seeded_subject(&pool, "EPC00000010").await;
    let subject_b = seeded_subject(&pool, "EPC00000011").await;
    let group_a = uuid::Uuid::new_v4();
    let group_b = uuid::Uuid::new_v4();

    // Two stores upload independently.
    for (origin, group, subject, site) in [
        ("store-A", group_a, subject_a, "store-07"),
        ("store-B", group_b, subject_b, "store-12"),
    ] {
        let response = infrastructure::ingest_batch(
            &pool,
            &IngestBatch {
                origin_id: origin.into(),
                generation: 1,
                command_watermark: 0,
                command_blocked: None,
                facts: vec![movement_fact(1, group, subject, site)],
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
    assert!(report.blocked.is_empty(), "blocked: {:?}", report.blocked);
    assert_eq!(report.applied, 2);
    for group in [group_a, group_b] {
        let rows: i64 = sqlx::query(
            // Node history lands in the node-history tables, never in the
            // centre's own ledger — the centre does not own this inventory.
            "SELECT count(*)::bigint AS count FROM edge_movement_line
             WHERE movement_group_id = $1",
        )
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
            command_watermark: 0,
            command_blocked: None,
            facts: vec![movement_fact(2, group_a, subject_a, "store-07")],
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
    let broken = inventory_backend::cloud::domain::SyncFact {
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
            command_watermark: 0,
            command_blocked: None,
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
            command_watermark: 0,
            command_blocked: None,
            facts: vec![movement_fact(
                2,
                uuid::Uuid::new_v4(),
                subject_b,
                "store-12",
            )],
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

#[sqlx::test(migrations = "./migrations/postgres")]
async fn per_origin_keys_stop_store_spoofing(pool: PgPool) {
    let mut config = test_config();
    const MASTER_KEY: &str = "test-master-provisioning-key-00000001";
    const STORE_A_KEY: &str = "store-a-integration-sync-key-00000001";
    config.sync_ingest_key = Some(MASTER_KEY.into());
    let state = AppState::new(pool.clone(), config);
    let app = || api_http::router(state.clone());
    let empty_batch = |origin: &str| json!({"origin_id": origin, "generation": 1, "facts": []});

    // Registration needs the master key.
    let register = json!({"origin_id": "store-A", "ingest_key": STORE_A_KEY, "label": "Store A"});
    assert_eq!(
        post_json(app(), "/api/v1/sync/origins", None, register.clone()).await,
        http::StatusCode::FORBIDDEN
    );
    let weak_register =
        json!({"origin_id": "store-weak", "ingest_key": "short-key", "label": "Weak"});
    assert_eq!(
        post_json(
            app(),
            "/api/v1/sync/origins",
            Some(MASTER_KEY),
            weak_register,
        )
        .await,
        http::StatusCode::BAD_REQUEST,
        "origin provisioning rejects weak machine credentials"
    );
    assert_eq!(
        post_json(app(), "/api/v1/sync/origins", Some(MASTER_KEY), register).await,
        http::StatusCode::CREATED
    );

    // A registered origin is accepted ONLY with its own key: the master key
    // no longer lets anyone speak as store-A, and neither does store-B's key.
    for wrong in [None, Some(MASTER_KEY), Some("some-other-key")] {
        assert_eq!(
            post_json(app(), "/api/v1/sync/ingest", wrong, empty_batch("store-A")).await,
            http::StatusCode::FORBIDDEN
        );
    }
    assert_eq!(
        post_json(
            app(),
            "/api/v1/sync/ingest",
            Some(STORE_A_KEY),
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
            Some(MASTER_KEY),
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

// ---- The downstream lane: cloud -> store commands -------------------------

fn publication_payload(version: i64, price_minor: i64, sku_id: uuid::Uuid) -> serde_json::Value {
    json!({
        "publication_id": uuid::Uuid::new_v4(),
        "version": version,
        "name": format!("Harga v{version}"),
        "effective_from": chrono::Utc::now(),
        "effective_to": null,
        "tax_rules": [{"tax_category": "STANDARD", "rate_bps": 1100, "tax_inclusive": true}],
        "price_rules": [{
            "sku_id": sku_id,
            // The shop floor names products by code, not by the centre's UUID.
            "sku_code": "SYNC-SKU",
            "site_id": null,
            "channel": "STORE",
            "sellable": true,
            "currency": "IDR",
            "unit_price_minor": price_minor,
            "tax_category": "STANDARD"
        }],
    })
}

async fn a_sku(pool: &PgPool) -> uuid::Uuid {
    sqlx::query("SELECT id FROM sku ORDER BY id LIMIT 1")
        .fetch_one(pool)
        .await
        .unwrap_or_else(|e| panic!("sku: {e}"))
        .get("id")
}

async fn store_command_watermark(pool: &PgPool) -> i64 {
    infrastructure::command_watermark(pool)
        .await
        .unwrap_or_else(|e| panic!("command watermark: {e}"))
        .0
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn commands_ride_the_upload_cycle_and_activate_pricing(pool: PgPool) {
    const KEY: &str = "store-e2e-integration-sync-key-00000001";
    infrastructure::provision_origin(&pool, "store-e2e", 1, true)
        .await
        .unwrap_or_else(|e| panic!("provision: {e}"));
    infrastructure::register_origin_credential(&pool, "store-e2e", KEY, Some("Toko E2E"))
        .await
        .unwrap_or_else(|e| panic!("register: {e}"));
    let state = AppState::new(pool.clone(), test_config());
    let transport = RouterTransport::with_key(state.clone(), KEY);
    let config = cycle_config_with_key(KEY);
    let sku_id = a_sku(&pool).await;

    // The cloud activates a publication for the whole fleet.
    let payload = publication_payload(101, 25_000, sku_id);
    let publication_id: uuid::Uuid =
        serde_json::from_value(payload["publication_id"].clone()).unwrap_or_else(|e| panic!("{e}"));
    let (command_id, targets) = infrastructure::issue_command(
        &pool,
        "commercial.publication.activate",
        &payload,
        "ho-pricing",
        None,
        &[],
    )
    .await
    .unwrap_or_else(|e| panic!("issue: {e}"));
    assert_eq!(targets, vec!["store-e2e".to_string()]);

    // ONE cycle — with NOTHING to upload — carries it down and applies it.
    // This is the piggyback: no second connection, no separate cadence.
    let outcome = sync_cycle(&pool, &config, &transport)
        .await
        .unwrap_or_else(|e| panic!("cycle: {e}"));
    assert_eq!(outcome.upstream, CycleReport::Idle);
    assert_eq!(outcome.commands_blocked, None);
    assert_eq!(outcome.commands_applied, 1);
    assert_eq!(store_command_watermark(&pool).await, 1);

    // The effect is real: the publication and its rules are live at the store.
    let price: i64 =
        sqlx::query("SELECT unit_price_minor FROM commercial_price_rule WHERE publication_id = $1")
            .bind(publication_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("price rule: {e}"))
            .get("unit_price_minor");
    assert_eq!(price, 25_000);
    let status: String = sqlx::query("SELECT status FROM commercial_publication WHERE id = $1")
        .bind(publication_id)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("publication: {e}"))
        .get("status");
    assert_eq!(status, "PUBLISHED");

    // Applying is idempotent and the stream drains.
    let outcome = sync_cycle(&pool, &config, &transport)
        .await
        .unwrap_or_else(|e| panic!("cycle 2: {e}"));
    assert_eq!(outcome.commands_applied, 0);

    // The cloud sees convergence without asking the store anything extra.
    let reach = infrastructure::command_reach(&pool, command_id)
        .await
        .unwrap_or_else(|e| panic!("reach: {e}"));
    assert_eq!(reach["converged"], true);
    assert_eq!(reach["settled_count"], 1);
    assert_eq!(reach["pending_count"], 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_forged_command_blocks_and_a_revoked_one_is_skipped(pool: PgPool) {
    const KEY: &str = "store-e2e-integration-sync-key-00000001";
    infrastructure::provision_origin(&pool, "store-e2e", 1, true)
        .await
        .unwrap_or_else(|e| panic!("provision: {e}"));
    infrastructure::register_origin_credential(&pool, "store-e2e", KEY, None)
        .await
        .unwrap_or_else(|e| panic!("register: {e}"));
    let sku_id = a_sku(&pool).await;

    // A command signed for THIS store, tampered with in flight.
    let (_, _) = infrastructure::issue_command(
        &pool,
        "commercial.publication.activate",
        &publication_payload(9101, 10_000, sku_id),
        "ho-pricing",
        None,
        &[],
    )
    .await
    .unwrap_or_else(|e| panic!("issue: {e}"));
    let mut delivered = infrastructure::commands_for(&pool, "store-e2e", 0, 20)
        .await
        .unwrap_or_else(|e| panic!("commands_for: {e}"));
    assert_eq!(delivered.len(), 1);
    let key = infrastructure::command_signing_key(KEY);
    delivered[0].payload["price_rules"][0]["unit_price_minor"] = json!(1);
    let report = infrastructure::apply_commands(&pool, key.as_bytes(), &delivered)
        .await
        .unwrap_or_else(|e| panic!("apply forged: {e}"));
    assert_eq!(report.applied, 0);
    let blocked = report.blocked.unwrap_or_else(|| panic!("expected a block"));
    assert_eq!(blocked.seq, 1);
    assert!(blocked.reason.contains("signature"));
    assert_eq!(store_command_watermark(&pool).await, 0);

    // The untampered command still applies — the block was about the forgery,
    // not about the position, and it heals with no operator action.
    let honest = infrastructure::commands_for(&pool, "store-e2e", 0, 20)
        .await
        .unwrap_or_else(|e| panic!("commands_for 2: {e}"));
    let report = infrastructure::apply_commands(&pool, key.as_bytes(), &honest)
        .await
        .unwrap_or_else(|e| panic!("apply honest: {e}"));
    assert_eq!(report.blocked, None);
    assert_eq!(report.applied, 1);

    // A second command, recalled before the store reads it, is skipped — and
    // the prefix advances past it rather than damming the stream.
    let (revoked_id, _) = infrastructure::issue_command(
        &pool,
        "commercial.publication.activate",
        &publication_payload(9102, 99_000, sku_id),
        "ho-pricing",
        None,
        &[],
    )
    .await
    .unwrap_or_else(|e| panic!("issue 2: {e}"));
    let caught = infrastructure::revoke_command(&pool, revoked_id, "harga salah")
        .await
        .unwrap_or_else(|e| panic!("revoke: {e}"));
    assert_eq!(caught, 1, "the recall caught the store in time");
    let after_revoke = infrastructure::commands_for(&pool, "store-e2e", 1, 20)
        .await
        .unwrap_or_else(|e| panic!("commands_for 3: {e}"));
    assert!(after_revoke[0].revoked);
    let report = infrastructure::apply_commands(&pool, key.as_bytes(), &after_revoke)
        .await
        .unwrap_or_else(|e| panic!("apply revoked: {e}"));
    assert_eq!((report.applied, report.skipped), (0, 1));
    assert_eq!(store_command_watermark(&pool).await, 2);
    let never_applied: i64 =
        sqlx::query("SELECT count(*)::bigint AS count FROM commercial_price_rule WHERE unit_price_minor = 99000")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("count: {e}"))
            .get("count");
    assert_eq!(never_applied, 0, "a recalled price never went live");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_fleet_view_names_who_is_behind_and_who_is_stuck(pool: PgPool) {
    for (origin, key) in [
        ("store-01", "store-01-integration-sync-key-00000001"),
        ("store-02", "store-02-integration-sync-key-00000001"),
        ("store-03", "store-03-integration-sync-key-00000001"),
    ] {
        infrastructure::register_origin_credential(&pool, origin, key, Some(origin))
            .await
            .unwrap_or_else(|e| panic!("register {origin}: {e}"));
    }
    let sku_id = a_sku(&pool).await;
    infrastructure::issue_command(
        &pool,
        "commercial.publication.activate",
        &publication_payload(7, 5_000, sku_id),
        "ho-pricing",
        None,
        &[],
    )
    .await
    .unwrap_or_else(|e| panic!("issue: {e}"));

    // store-01 applies, store-02 reports a block, store-03 says nothing.
    infrastructure::record_command_ack(&pool, "store-01", 1, None)
        .await
        .unwrap_or_else(|e| panic!("ack 1: {e}"));
    infrastructure::record_command_ack(
        &pool,
        "store-02",
        0,
        Some(&inventory_backend::cloud::domain::CommandBlock {
            seq: 1,
            reason: "sku tidak dikenal di toko ini".into(),
        }),
    )
    .await
    .unwrap_or_else(|e| panic!("ack 2: {e}"));

    let fleet = infrastructure::fleet_command_status(&pool)
        .await
        .unwrap_or_else(|e| panic!("fleet: {e}"));
    assert_eq!(fleet.len(), 3);
    let by = |id: &str| {
        fleet
            .iter()
            .find(|s| s.origin_id == id)
            .unwrap_or_else(|| panic!("{id} missing"))
            .clone()
    };
    assert!(by("store-01").converged());
    assert_eq!(by("store-01").pending(), 0);
    assert!(!by("store-02").converged());
    assert_eq!(by("store-02").blocked_at_seq, Some(1));
    assert!(by("store-02")
        .blocked_reason
        .unwrap_or_default()
        .contains("sku"));
    assert_eq!(
        by("store-03").pending(),
        1,
        "silent store is counted behind"
    );
    assert!(by("store-03").blocked_at_seq.is_none());

    // A store that recovers clears its own block on the next report.
    infrastructure::record_command_ack(&pool, "store-02", 1, None)
        .await
        .unwrap_or_else(|e| panic!("ack 3: {e}"));
    let fleet = infrastructure::fleet_command_status(&pool)
        .await
        .unwrap_or_else(|e| panic!("fleet 2: {e}"));
    let recovered = fleet
        .iter()
        .find(|s| s.origin_id == "store-02")
        .unwrap_or_else(|| panic!("store-02 missing"));
    assert!(recovered.converged());
    assert!(recovered.blocked_at_seq.is_none());
}
