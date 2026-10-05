use async_trait::async_trait;
use axum::body::{to_bytes, Body};
use http::Request;
use inventory_backend::cloud::domain::{BreakerPolicy, IngestBatch, IngestResponse, SyncFact};
use inventory_backend::cloud::postgres as cloud;
use inventory_backend::edge::{
    dc_router, derive_rfid_signing_key, sign_rfid_request, store_router, DeviceProof,
    EdgeInventory, EdgeRfid, EdgeRfidObservationRequest, EdgeRole, IntakeRequest, NodeContext,
    ReceiveRequest, RfidRead, SiteId, SqliteEdge, SqliteSyncStore,
};
use inventory_backend::sync::inventory::{
    PoolSnapshotBalance, PoolSnapshotPayload, INVENTORY_POOL_SNAPSHOT_V1,
};
use inventory_backend::sync::port::{SyncConfig, SyncStore, SyncTransport};
use inventory_backend::sync::{run_cycle, CycleReport};
use serde_json::Value;
use sqlx::{PgPool, Row};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tower::ServiceExt;
use uuid::Uuid;

fn node(role: EdgeRole, site_id: &str) -> NodeContext {
    let site = SiteId::new(site_id).unwrap_or_else(|error| panic!("site: {error}"));
    NodeContext::new(format!("{site_id}-edge"), role, site)
        .unwrap_or_else(|error| panic!("node: {error}"))
}

fn sqlite_path(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!("inventory-{label}-{}.sqlite3", Uuid::new_v4()))
}

fn remove_sqlite(path: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let candidate = PathBuf::from(format!("{}{suffix}", path.display()));
        let _ = std::fs::remove_file(candidate);
    }
}

fn sync_config() -> SyncConfig {
    SyncConfig {
        batch_limit: 100,
        breaker: BreakerPolicy {
            threshold: 3,
            base_cooldown_seconds: 1,
            max_cooldown_seconds: 10,
        },
        command_key: None,
    }
}

#[derive(Clone)]
struct DirectCloud {
    pool: PgPool,
}

#[async_trait]
impl SyncTransport for DirectCloud {
    async fn send(&self, batch: &IngestBatch) -> Result<IngestResponse, String> {
        cloud::ingest_batch(&self.pool, batch)
            .await
            .map_err(|error| error.to_string())
    }
}

struct CommitThenDropCloud {
    pool: PgPool,
    drop_first_response: AtomicBool,
}

#[async_trait]
impl SyncTransport for CommitThenDropCloud {
    async fn send(&self, batch: &IngestBatch) -> Result<IngestResponse, String> {
        let response = cloud::ingest_batch(&self.pool, batch)
            .await
            .map_err(|error| error.to_string())?;
        if self.drop_first_response.swap(false, Ordering::SeqCst) {
            Err("simulated lost HTTP response after Cloud commit".into())
        } else {
            Ok(response)
        }
    }
}

async fn register_inventory_origin(
    pool: &PgPool,
    origin_id: &str,
    site_id: &str,
    role: &str,
    generation: i64,
) {
    cloud::register_origin_credential_binding(
        pool,
        origin_id,
        &format!("{origin_id}-integration-sync-key-00000001"),
        Some(origin_id),
        Some(site_id),
        Some(role),
        Some(generation),
        Some(true),
    )
    .await
    .unwrap_or_else(|error| panic!("register {origin_id}: {error}"));
}

fn snapshot_fact(
    seq: i64,
    origin_id: &str,
    role: &str,
    site_id: &str,
    pools: Vec<PoolSnapshotBalance>,
) -> SyncFact {
    let payload = PoolSnapshotPayload::new(origin_id, role, site_id, chrono::Utc::now(), pools)
        .unwrap_or_else(|error| panic!("snapshot: {error}"));
    SyncFact {
        seq,
        event_id: Uuid::new_v4(),
        event_type: INVENTORY_POOL_SNAPSHOT_V1.into(),
        payload: serde_json::to_value(payload)
            .unwrap_or_else(|error| panic!("snapshot JSON: {error}")),
        created_at: chrono::Utc::now(),
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn file_backed_dc_and_store_restart_then_materialize_without_touching_cloud_ledger(
    pool: PgPool,
) {
    let dc_path = sqlite_path("dc-offline");
    let store_path = sqlite_path("store-offline");
    let dc_node = node(EdgeRole::Dc, "dc-01");
    let store_node = node(EdgeRole::Store, "store-07");

    // Both edges operate while there is no transport or Cloud process.
    {
        let dc = SqliteEdge::open(&dc_path, dc_node.clone())
            .unwrap_or_else(|error| panic!("open DC: {error}"));
        dc.intake_dc(IntakeRequest {
            epc: "EPC-DC-OFFLINE-001".into(),
            sku_code: "SKU-001".into(),
            unit_price_minor: 100_000,
            actor_id: "dc-receiver".into(),
            idempotency_key: "dc-offline-intake".into(),
        })
        .unwrap_or_else(|error| panic!("DC intake: {error}"));

        let store = SqliteEdge::open(&store_path, store_node.clone())
            .unwrap_or_else(|error| panic!("open Store: {error}"));
        store
            .receive_store(ReceiveRequest {
                epc: "EPC-STORE-OFFLINE-001".into(),
                sku_code: "SKU-001".into(),
                unit_price_minor: 110_000,
                source_dc_id: Some(
                    SiteId::new("dc-01").unwrap_or_else(|error| panic!("DC site: {error}")),
                ),
                shipment_reference: Some("SHIP-OFFLINE-001".into()),
                actor_id: "store-receiver".into(),
                idempotency_key: "store-offline-receive".into(),
            })
            .unwrap_or_else(|error| panic!("Store receive: {error}"));
    }

    register_inventory_origin(&pool, "dc-01-edge", "dc-01", "DC", 1).await;
    register_inventory_origin(&pool, "store-07-edge", "store-07", "STORE", 1).await;
    let movement_before: i64 = sqlx::query("SELECT count(*)::bigint AS count FROM movement")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("movement count: {error}"))
        .get("count");
    let projection_before: i64 =
        sqlx::query("SELECT count(*)::bigint AS count FROM inventory_projection")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("projection count: {error}"))
            .get("count");

    // A process restart preserves each independent backlog, then both drain.
    let dc =
        SqliteEdge::open(&dc_path, dc_node).unwrap_or_else(|error| panic!("reopen DC: {error}"));
    let store = SqliteEdge::open(&store_path, store_node)
        .unwrap_or_else(|error| panic!("reopen Store: {error}"));
    let dc_sync = SqliteSyncStore::new(dc.connection());
    let store_sync = SqliteSyncStore::new(store.connection());
    let transport = DirectCloud { pool: pool.clone() };
    for sync in [&dc_sync, &store_sync] {
        let outcome = run_cycle(sync, &sync_config(), &transport)
            .await
            .unwrap_or_else(|error| panic!("drain Edge: {error}"));
        assert!(matches!(outcome.upstream, CycleReport::Advanced { .. }));
    }
    let report = cloud::apply_pending(&pool, 100)
        .await
        .unwrap_or_else(|error| panic!("apply snapshots: {error}"));
    assert!(report.blocked.is_empty(), "blocked: {:?}", report.blocked);

    let snapshots: i64 =
        sqlx::query("SELECT count(*)::bigint AS count FROM edge_inventory_snapshot")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("snapshot count: {error}"))
            .get("count");
    assert_eq!(snapshots, 2);
    let owners: Vec<String> =
        sqlx::query("SELECT origin_id FROM edge_inventory_snapshot ORDER BY origin_id")
            .fetch_all(&pool)
            .await
            .unwrap_or_else(|error| panic!("snapshot owners: {error}"))
            .into_iter()
            .map(|row| row.get("origin_id"))
            .collect();
    assert_eq!(owners, vec!["dc-01-edge", "store-07-edge"]);

    let movement_after: i64 = sqlx::query("SELECT count(*)::bigint AS count FROM movement")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("movement count after: {error}"))
        .get("count");
    let projection_after: i64 =
        sqlx::query("SELECT count(*)::bigint AS count FROM inventory_projection")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("projection count after: {error}"))
            .get("count");
    assert_eq!(movement_after, movement_before);
    assert_eq!(projection_after, projection_before);

    // Fleet freshness is Cloud-observed apply age, not the untrusted Edge
    // clock. A future capture timestamp cannot keep an old snapshot CURRENT.
    sqlx::query(
        "UPDATE edge_inventory_snapshot
         SET captured_at = now() + interval '1 day',
             applied_at = now() - interval '10 minutes'
         WHERE origin_id = 'store-07-edge'",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("skew snapshot clock: {error}"));

    let fleet = cloud::list_fleet_pools(&pool, "cloud-primary", 24, 30)
        .await
        .unwrap_or_else(|error| panic!("fleet pools: {error}"));
    assert!(fleet.get("fleet_total").is_some_and(Value::is_null));
    let fleet_items = fleet["items"]
        .as_array()
        .unwrap_or_else(|| panic!("fleet items"));
    assert!(fleet_items.iter().any(|item| {
        item["origin_id"] == "dc-01-edge" && item["source_type"] == "EDGE_FACT_POSITION"
    }));
    let skewed_store = fleet_items
        .iter()
        .find(|item| {
            item["origin_id"] == "store-07-edge"
                && item["source_type"] == "EDGE_FACT_POSITION"
                && item["is_rollup"] == false
        })
        .unwrap_or_else(|| panic!("store fact-derived fleet position"));
    assert_eq!(skewed_store["checkpoint_status"], "STALE");
    assert!(skewed_store["checkpoint_age_seconds"]
        .as_f64()
        .is_some_and(|age| age >= 599.0));
    assert_eq!(skewed_store["source_capture_age_seconds"], 0.0);
    assert!(fleet_items.iter().any(|item| {
        item["origin_id"] == "dc-01-edge"
            && item["id"] == "dc-01.outbound.loaded"
            && item["is_rollup"] == true
    }));

    drop(dc);
    drop(store);
    remove_sqlite(&dc_path);
    remove_sqlite(&store_path);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn signed_rfid_evidence_survives_offline_queue_and_reaches_cloud(pool: PgPool) {
    let origin_id = "store-07-edge";
    register_inventory_origin(&pool, origin_id, "store-07", "STORE", 1).await;
    let raw_device_key = "one-time-test-device-key";
    let signing_key = derive_rfid_signing_key(raw_device_key);
    sqlx::query(
        "INSERT INTO rfid_device
             (device_id,origin_id,label,auth_key_sha256,offline_ttl_seconds,created_by)
         VALUES('RFID-07', $1, 'Floor reader', $2, 604800, 'test')",
    )
    .bind(origin_id)
    .bind(&signing_key)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("Cloud RFID device: {error}"));
    sqlx::query(
        "INSERT INTO rfid_device_pool(device_id,pool_id)
         VALUES('RFID-07','store-07.floor')",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("Cloud RFID scope: {error}"));

    let store_node = node(EdgeRole::Store, "store-07");
    let edge = SqliteEdge::open_in_memory(store_node.clone())
        .unwrap_or_else(|error| panic!("Store Edge: {error}"));
    {
        let shared = edge.connection();
        let connection = shared
            .lock()
            .unwrap_or_else(|error| panic!("SQLite connection: {error}"));
        connection
            .execute(
                "INSERT INTO edge_rfid_device
                     (device_id,label,auth_key_sha256,active,valid_until,last_sequence,
                      policy_version,updated_at)
                 VALUES('RFID-07','Floor reader',?1,1,?2,0,1,?3)",
                rusqlite::params![
                    signing_key,
                    (chrono::Utc::now() + chrono::Duration::days(7)).to_rfc3339(),
                    chrono::Utc::now().to_rfc3339(),
                ],
            )
            .unwrap_or_else(|error| panic!("Edge RFID device: {error}"));
        connection
            .execute(
                "INSERT INTO edge_rfid_device_pool(device_id,pool_id)
                 VALUES('RFID-07','store-07.floor')",
                [],
            )
            .unwrap_or_else(|error| panic!("Edge RFID scope: {error}"));
    }
    let observed_at = chrono::Utc::now();
    let request = EdgeRfidObservationRequest {
        site_id: "store-07".into(),
        pool: "store-07.floor".into(),
        reader_session_id: "floor-walk-1".into(),
        observed_at,
        idempotency_key: "rfid-offline-1".into(),
        observations: vec![RfidRead {
            epc: "EPC00000001".into(),
            antenna: Some("A1".into()),
            rssi: Some(-43.0),
            phase: None,
            frequency: None,
            read_count: 8,
        }],
    };
    let body =
        serde_json::to_vec(&request).unwrap_or_else(|error| panic!("RFID request JSON: {error}"));
    let timestamp = chrono::Utc::now().timestamp();
    let proof = DeviceProof {
        device_id: "RFID-07".into(),
        timestamp,
        sequence: 1,
        signature: sign_rfid_request(
            &signing_key,
            "RFID-07",
            timestamp,
            1,
            &inventory_backend::security::sha256_hex(&body),
        ),
    };
    let rfid = EdgeRfid::new(edge.connection(), store_node, edge.clock());
    let response = rfid
        .ingest(proof, &body, Some("operator-07".into()))
        .unwrap_or_else(|error| panic!("offline RFID ingest: {error}"));
    assert_eq!(response["sync"]["queued"], true);

    let movement_before: i64 = sqlx::query_scalar("SELECT count(*)::bigint FROM movement")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("movement before: {error}"));
    let sync = SqliteSyncStore::new(edge.connection());
    let outcome = run_cycle(&sync, &sync_config(), &DirectCloud { pool: pool.clone() })
        .await
        .unwrap_or_else(|error| panic!("RFID sync cycle: {error}"));
    assert!(matches!(outcome.upstream, CycleReport::Advanced { .. }));
    let report = cloud::apply_pending(&pool, 100)
        .await
        .unwrap_or_else(|error| panic!("apply RFID fact: {error}"));
    assert!(report.blocked.is_empty(), "blocked: {:?}", report.blocked);

    let observation = sqlx::query(
        "SELECT epc,device_id,operator_id,edge_origin_id,device_sequence,read_count
         FROM observation_sighting WHERE edge_origin_id=$1",
    )
    .bind(origin_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("Cloud observation: {error}"));
    assert_eq!(observation.get::<String, _>("epc"), "EPC00000001");
    assert_eq!(observation.get::<String, _>("device_id"), "RFID-07");
    assert_eq!(
        observation
            .get::<Option<String>, _>("operator_id")
            .as_deref(),
        Some("operator-07")
    );
    assert_eq!(observation.get::<i64, _>("device_sequence"), 1);
    assert_eq!(observation.get::<i64, _>("read_count"), 8);
    let movement_after: i64 = sqlx::query_scalar("SELECT count(*)::bigint FROM movement")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("movement after: {error}"));
    assert_eq!(movement_after, movement_before);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn ownership_spoof_rejection_survives_lost_response_and_retention_purge(pool: PgPool) {
    let path = sqlite_path("lost-reject");
    register_inventory_origin(&pool, "store-07-edge", "store-07", "STORE", 1).await;
    let edge = SqliteEdge::open(&path, node(EdgeRole::Store, "store-07"))
        .unwrap_or_else(|error| panic!("open Store: {error}"));

    // Corrupt the queued bootstrap as if a compromised/buggy node claimed a
    // different owner's canonical Pool. The Cloud must tombstone it.
    let spoofed = PoolSnapshotPayload::new(
        "store-07-edge",
        "STORE",
        "store-07",
        chrono::Utc::now(),
        vec![PoolSnapshotBalance {
            pool_id: "store-08.floor".into(),
            stock: 1,
            allotted: None,
            on_hand: 1,
            missing: 0,
        }],
    )
    .unwrap_or_else(|error| panic!("spoofed payload shape: {error}"));
    {
        let connection = edge.connection();
        let connection = connection
            .lock()
            .unwrap_or_else(|error| panic!("SQLite connection: {error}"));
        connection
            .execute(
                "UPDATE sync_fact_log SET payload=?1 WHERE seq=1",
                [serde_json::to_string(&spoofed)
                    .unwrap_or_else(|error| panic!("spoof JSON: {error}"))],
            )
            .unwrap_or_else(|error| panic!("corrupt queued fact: {error}"));
    }

    let sync = SqliteSyncStore::new(edge.connection());
    let transport = CommitThenDropCloud {
        pool: pool.clone(),
        drop_first_response: AtomicBool::new(true),
    };
    let first = run_cycle(&sync, &sync_config(), &transport)
        .await
        .unwrap_or_else(|error| panic!("first cycle: {error}"));
    assert!(matches!(first.upstream, CycleReport::Failed { .. }));
    assert_eq!(
        sync.watermark("store-07-edge", 1)
            .await
            .unwrap_or_else(|error| panic!("watermark after lost response: {error}")),
        0
    );

    // The Cloud can apply and age out ordinary receipts while this sender is
    // offline. A permanent rejection must survive that purge because the Edge
    // has not yet observed it and therefore has no local dead-letter evidence.
    cloud::apply_pending(&pool, 10)
        .await
        .unwrap_or_else(|error| panic!("apply rejected receipt: {error}"));
    sqlx::query(
        "UPDATE sync_ingest_fact
         SET received_at = now() - interval '30 days'
         WHERE origin_id = $1 AND generation = 1 AND seq = 1",
    )
    .bind("store-07-edge")
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("age rejected receipt: {error}"));
    let purged = cloud::purge_applied_ingest(&pool, 14)
        .await
        .unwrap_or_else(|error| panic!("purge applied receipts: {error}"));
    assert_eq!(purged, 0);
    let retained_rejections: i64 = sqlx::query(
        "SELECT count(*)::bigint AS count FROM sync_ingest_fact
         WHERE origin_id = $1 AND generation = 1 AND seq = 1 AND status = 'REJECTED'",
    )
    .bind("store-07-edge")
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("retained rejection: {error}"))
    .get("count");
    assert_eq!(retained_rejections, 1);

    let second = run_cycle(&sync, &sync_config(), &transport)
        .await
        .unwrap_or_else(|error| panic!("retry cycle: {error}"));
    assert!(matches!(
        second.upstream,
        CycleReport::Advanced {
            advance_to: 1,
            dead_lettered: 1,
            ..
        }
    ));
    let connection = edge.connection();
    let connection = connection
        .lock()
        .unwrap_or_else(|error| panic!("SQLite connection: {error}"));
    let dead_letters: i64 = connection
        .query_row("SELECT count(*) FROM sync_dead_letter", [], |row| {
            row.get(0)
        })
        .unwrap_or_else(|error| panic!("dead letters: {error}"));
    assert_eq!(dead_letters, 1);
    drop(connection);
    drop(edge);
    remove_sqlite(&path);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn active_generation_fence_prevents_old_snapshot_overwrite(pool: PgPool) {
    register_inventory_origin(&pool, "store-07-edge", "store-07", "STORE", 1).await;
    let generation_one = IngestBatch {
        origin_id: "store-07-edge".into(),
        generation: 1,
        facts: vec![snapshot_fact(
            1,
            "store-07-edge",
            "STORE",
            "store-07",
            vec![PoolSnapshotBalance {
                pool_id: "store-07.floor".into(),
                stock: 4,
                allotted: None,
                on_hand: 4,
                missing: 0,
            }],
        )],
        command_watermark: 0,
        command_blocked: None,
    };
    let accepted = cloud::ingest_batch(&pool, &generation_one)
        .await
        .unwrap_or_else(|error| panic!("ingest generation one: {error}"));
    assert!(accepted.rejected.is_empty());
    cloud::apply_pending(&pool, 10)
        .await
        .unwrap_or_else(|error| panic!("apply generation one: {error}"));

    let generation_two = IngestBatch {
        origin_id: "store-07-edge".into(),
        generation: 2,
        facts: vec![snapshot_fact(
            1,
            "store-07-edge",
            "STORE",
            "store-07",
            vec![PoolSnapshotBalance {
                pool_id: "store-07.floor".into(),
                stock: 9,
                allotted: None,
                on_hand: 8,
                missing: 1,
            }],
        )],
        command_watermark: 0,
        command_blocked: None,
    };

    // Rolling the Edge first must be retryable: Cloud must not create a
    // durable prefix or tombstone the one generation-two bootstrap.
    let premature = cloud::ingest_batch(&pool, &generation_two).await;
    assert!(matches!(
        premature,
        Err(inventory_backend::cloud::application::AppError::Conflict(_))
    ));
    let generation_two_watermarks: i64 = sqlx::query(
        "SELECT count(*)::bigint AS count FROM sync_ingest_watermark
         WHERE origin_id = $1 AND generation = 2",
    )
    .bind("store-07-edge")
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("premature generation watermark: {error}"))
    .get("count");
    assert_eq!(generation_two_watermarks, 0);

    // Cloud-first activation makes the exact same queued fact acceptable.
    cloud::register_origin_credential_binding(
        &pool,
        "store-07-edge",
        "store-07-edge-integration-sync-key-00000001",
        None,
        Some("store-07"),
        Some("STORE"),
        Some(2),
        Some(true),
    )
    .await
    .unwrap_or_else(|error| panic!("activate generation two: {error}"));
    let accepted_generation_two = cloud::ingest_batch(&pool, &generation_two)
        .await
        .unwrap_or_else(|error| panic!("ingest generation two: {error}"));
    assert_eq!(accepted_generation_two.durable_through, 1);
    assert!(accepted_generation_two.rejected.is_empty());
    cloud::apply_pending(&pool, 10)
        .await
        .unwrap_or_else(|error| panic!("apply generation two: {error}"));

    // Simulate replay/recovery of a delayed old stream. The active-generation
    // fence must consume it without replacing generation two.
    sqlx::query(
        "UPDATE sync_applied_watermark SET applied_seq=0 WHERE origin_id=$1 AND generation=1",
    )
    .bind("store-07-edge")
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("rewind old apply watermark: {error}"));
    cloud::apply_pending(&pool, 10)
        .await
        .unwrap_or_else(|error| panic!("replay old generation: {error}"));

    let row = sqlx::query(
        "SELECT snapshot.generation, line.stock, line.on_hand, line.missing
         FROM edge_inventory_snapshot snapshot
         JOIN edge_inventory_pool line ON line.origin_id=snapshot.origin_id
         WHERE snapshot.origin_id='store-07-edge' AND line.pool_id='store-07.floor'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("materialized generation: {error}"));
    assert_eq!(row.get::<i64, _>("generation"), 2);
    assert_eq!(row.get::<i64, _>("stock"), 9);
    assert_eq!(row.get::<i64, _>("on_hand"), 8);
    assert_eq!(row.get::<i64, _>("missing"), 1);

    let stale_upload = IngestBatch {
        origin_id: "store-07-edge".into(),
        generation: 1,
        facts: vec![snapshot_fact(
            2,
            "store-07-edge",
            "STORE",
            "store-07",
            vec![PoolSnapshotBalance {
                pool_id: "store-07.floor".into(),
                stock: 99,
                allotted: None,
                on_hand: 99,
                missing: 0,
            }],
        )],
        command_watermark: 0,
        command_blocked: None,
    };
    let rejected = cloud::ingest_batch(&pool, &stale_upload)
        .await
        .unwrap_or_else(|error| panic!("stale upload response: {error}"));
    assert_eq!(rejected.rejected.len(), 1);
}

async fn get_json(app: axum::Router, path: &str) -> (http::StatusCode, Value) {
    let response = app
        .oneshot(
            Request::builder()
                .uri(path)
                .body(Body::empty())
                .unwrap_or_else(|error| panic!("request: {error}")),
        )
        .await
        .unwrap_or_else(|error| panic!("response: {error}"));
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap_or_else(|error| panic!("body: {error}"));
    let value = serde_json::from_slice(&bytes)
        .unwrap_or_else(|error| panic!("JSON body for {path}: {error}"));
    (status, value)
}

async fn get_text(app: axum::Router, path: &str) -> (http::StatusCode, String) {
    let response = app
        .oneshot(
            Request::builder()
                .uri(path)
                .body(Body::empty())
                .unwrap_or_else(|error| panic!("request: {error}")),
        )
        .await
        .unwrap_or_else(|error| panic!("response: {error}"));
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap_or_else(|error| panic!("body: {error}"));
    (
        status,
        String::from_utf8(bytes.to_vec()).unwrap_or_else(|error| panic!("UTF-8 body: {error}")),
    )
}

#[tokio::test]
async fn dc_and_store_serve_role_aware_normalized_inventory() {
    // A bundle the test writes itself, rather than `../frontend`: the
    // single-page app that directory held was replaced by the Vite surfaces
    // under `frontend-*`, and a node still serves whatever `FRONTEND_DIR`
    // names — which is what this asserts. A fixture of our own is also the only
    // form of this test that survives the apps moving.
    let frontend = std::env::temp_dir().join(format!("edge-static-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&frontend).unwrap_or_else(|error| panic!("static dir: {error}"));
    std::fs::write(
        frontend.join("index.html"),
        "<!doctype html><title>Inventory by Pool</title>",
    )
    .unwrap_or_else(|error| panic!("static index: {error}"));
    let dc_static = Arc::new(
        SqliteEdge::open_in_memory(node(EdgeRole::Dc, "dc-01"))
            .unwrap_or_else(|error| panic!("DC Edge static: {error}")),
    );
    let (static_status, index) = get_text(
        dc_router(dc_static, frontend.clone())
            .unwrap_or_else(|error| panic!("DC static router: {error}")),
        "/",
    )
    .await;
    assert_eq!(static_status, http::StatusCode::OK);
    assert!(index.contains("Inventory by Pool"));

    let dc = Arc::new(
        SqliteEdge::open_in_memory(node(EdgeRole::Dc, "dc-01"))
            .unwrap_or_else(|error| panic!("DC Edge: {error}")),
    );
    let (status, health) = get_json(
        dc_router(dc, frontend.clone()).unwrap_or_else(|error| panic!("DC router: {error}")),
        "/api/v1/health",
    )
    .await;
    assert_eq!(status, http::StatusCode::OK);
    assert_eq!(health["node_role"], "DC");
    assert_eq!(
        health["inventory_endpoints"]["owned"],
        "/api/v1/inventory/pools"
    );

    let dc = Arc::new(
        SqliteEdge::open_in_memory(node(EdgeRole::Dc, "dc-01"))
            .unwrap_or_else(|error| panic!("DC Edge pools: {error}")),
    );
    let (_, pools) = get_json(
        dc_router(dc, frontend.clone()).unwrap_or_else(|error| panic!("DC router: {error}")),
        "/api/v1/inventory/pools",
    )
    .await;
    let items = pools["items"]
        .as_array()
        .unwrap_or_else(|| panic!("DC pool items"));
    assert_eq!(
        items
            .iter()
            .filter(|item| item["is_rollup"] == true)
            .count(),
        5
    );
    assert!(items.iter().all(|item| item.get("group").is_some()));
    assert!(items.iter().all(|item| item.get("source_type").is_some()));
    assert!(items.iter().all(|item| item["observed"].is_null()));

    let store = Arc::new(
        SqliteEdge::open_in_memory(node(EdgeRole::Store, "store-07"))
            .unwrap_or_else(|error| panic!("Store Edge: {error}")),
    );
    let (_, store_pools) = get_json(
        store_router(store, frontend.clone())
            .unwrap_or_else(|error| panic!("Store router: {error}")),
        "/api/v1/inventory/pools",
    )
    .await;
    assert!(store_pools["items"]
        .as_array()
        .unwrap_or_else(|| panic!("Store pool items"))
        .iter()
        .all(|item| item["site_id"] == "store-07" && item["is_rollup"] == false));

    let _ = std::fs::remove_dir_all(&frontend);
}
