//! The restore that used to lose a day of sales, end to end.
//!
//! Every test here is one variation on a single question: when a sender and a
//! receiver disagree about whose seqs these are, does anything notice?
//!
//! Before this lane the answer was no. A till whose SQLite file was restored
//! from a backup — or replaced and re-provisioned under the same node id —
//! started allocating seq 1 into a stream the cloud was already durable
//! through. The receiver skipped every fact as a duplicate, answered with its
//! own high watermark, and the sender read that as acknowledgement, advanced
//! and purged. No error anywhere. The one test that touched the behaviour
//! asserted it was correct.
//!
//! These run against a real Postgres and a real SQLite file, because the
//! failure was never in the decision — it was in what the two databases did
//! with it.

use async_trait::async_trait;
use inventory_backend::cloud::domain::BreakerPolicy;
use inventory_backend::cloud::domain::{
    is_stale_generation, HandshakeAgreement, HandshakeRequest, IngestBatch, IngestResponse,
    SyncFact, STALE_GENERATION_CODE,
};
use inventory_backend::cloud::postgres as cloud;
use inventory_backend::edge::{
    EdgeInventory, EdgeRole, NodeContext, ReceiveRequest, SiteId, SqliteEdge, SqliteSyncStore,
};
use inventory_backend::sync::handshake::{negotiate_generation, GenerationStore, HandshakeReport};
use inventory_backend::sync::port::{SyncConfig, SyncStore, SyncTransport};
use inventory_backend::sync::{run_cycle, CycleReport};
use serde_json::Value;
use sqlx::{PgPool, Row};
use std::path::{Path, PathBuf};
use uuid::Uuid;

const ORIGIN: &str = "store-07-edge";

fn node() -> NodeContext {
    let site = SiteId::new("store-07").unwrap_or_else(|error| panic!("site: {error}"));
    NodeContext::new(ORIGIN.to_owned(), EdgeRole::Store, site)
        .unwrap_or_else(|error| panic!("node: {error}"))
}

fn sqlite_path(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!("inventory-{label}-{}.sqlite3", Uuid::new_v4()))
}

fn remove_sqlite(path: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(PathBuf::from(format!("{}{suffix}", path.display())));
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

async fn register_origin(pool: &PgPool) {
    cloud::register_origin_credential_binding(
        pool,
        ORIGIN,
        &format!("{ORIGIN}-integration-sync-key-00000001"),
        Some(ORIGIN),
        Some("store-07"),
        Some("STORE"),
        Some(1),
        Some(true),
    )
    .await
    .unwrap_or_else(|error| panic!("register {ORIGIN}: {error}"));
}

/// The cloud, called in-process: the same functions the HTTP handlers call, so
/// a behaviour proven here is the behaviour the route serves.
#[derive(Clone)]
struct Cloud {
    pool: PgPool,
}

#[async_trait]
impl SyncTransport for Cloud {
    async fn send(&self, batch: &IngestBatch) -> Result<IngestResponse, String> {
        cloud::ingest_batch(&self.pool, batch)
            .await
            .map_err(|error| error.to_string())
    }

    async fn handshake(&self, request: &HandshakeRequest) -> Result<HandshakeAgreement, String> {
        cloud::sync_negotiate_generation(&self.pool, request)
            .await
            .map_err(|error| error.to_string())
    }
}

/// A cloud that answers about a stream this sender never wrote: it claims a
/// seq above the highest the sender uploaded.
struct OverclaimingCloud {
    claim: i64,
}

#[async_trait]
impl SyncTransport for OverclaimingCloud {
    async fn send(&self, _batch: &IngestBatch) -> Result<IngestResponse, String> {
        Ok(IngestResponse {
            durable_through: self.claim,
            rejected: Vec::new(),
            commands: Vec::new(),
        })
    }
}

fn receive(edge: &SqliteEdge, epc: &str, key: &str) {
    edge.receive_store(ReceiveRequest {
        epc: epc.into(),
        sku_code: "SKU-001".into(),
        unit_price_minor: 110_000,
        source_dc_id: Some(SiteId::new("dc-01").unwrap_or_else(|error| panic!("dc: {error}"))),
        shipment_reference: Some("SHIP-001".into()),
        actor_id: "store-receiver".into(),
        idempotency_key: key.into(),
    })
    .unwrap_or_else(|error| panic!("receive {epc}: {error}"));
}

async fn received_facts(pool: &PgPool) -> i64 {
    sqlx::query("SELECT count(*)::bigint AS count FROM sync_ingest_fact WHERE origin_id = $1")
        .bind(ORIGIN)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("count receipts: {error}"))
        .get("count")
}

/// The RECEIVER's watermark. Deliberately not `cloud::watermark`, which reads
/// the cloud node's own SENDER watermark for its uploads to an upstream — a
/// different table with the same name in English.
async fn receiver_watermark(pool: &PgPool, generation: i64) -> i64 {
    sqlx::query(
        "SELECT durable_seq FROM sync_ingest_watermark
         WHERE origin_id = $1 AND generation = $2",
    )
    .bind(ORIGIN)
    .bind(generation)
    .fetch_optional(pool)
    .await
    .unwrap_or_else(|error| panic!("receiver watermark: {error}"))
    .map_or(0, |row| row.get("durable_seq"))
}

fn queued_facts(edge: &SqliteEdge) -> i64 {
    let connection = edge.connection();
    let connection = connection
        .lock()
        .unwrap_or_else(|error| panic!("sqlite: {error}"));
    connection
        .query_row("SELECT count(*) FROM sync_fact_log", [], |row| row.get(0))
        .unwrap_or_else(|error| panic!("count queued: {error}"))
}

fn origin_row(edge: &SqliteEdge) -> (i64, i64, i64, Option<String>) {
    let connection = edge.connection();
    let connection = connection
        .lock()
        .unwrap_or_else(|error| panic!("sqlite: {error}"));
    connection
        .query_row(
            "SELECT generation, next_seq, handshake_settled, handshake_note
             FROM sync_origin WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap_or_else(|error| panic!("origin row: {error}"))
}

// ---- The whole failure, reproduced and closed -----------------------------

/// A till's database is replaced. It keeps its origin id, starts counting from
/// one, and everything it takes that evening must still arrive.
///
/// Without the handshake this is the silent-loss path: the cloud would skip
/// each fact as a duplicate of a seq it already holds and answer with its own
/// watermark, the sender would advance and purge, and the receipts would exist
/// nowhere. The assertion that matters is the last one — every fact either
/// database ever captured is present at the cloud.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_replaced_database_negotiates_a_new_generation_and_loses_nothing(pool: PgPool) {
    register_origin(&pool).await;
    let transport = Cloud { pool: pool.clone() };

    // --- The shop's first life. -------------------------------------------
    let first_path = sqlite_path("restore-before");
    let before = SqliteEdge::open(&first_path, node()).unwrap_or_else(|e| panic!("open: {e}"));
    receive(&before, "EPC-BEFORE-001", "before-001");
    receive(&before, "EPC-BEFORE-002", "before-002");
    let captured_before = queued_facts(&before);
    assert!(captured_before >= 3, "bootstrap plus two receipts");

    let sender = SqliteSyncStore::new(before.connection());
    negotiate_generation(&sender, &transport)
        .await
        .unwrap_or_else(|e| panic!("first handshake: {e}"));
    let cycle = run_cycle(&sender, &sync_config(), &transport)
        .await
        .unwrap_or_else(|e| panic!("first cycle: {e}"));
    assert!(
        matches!(cycle.upstream, CycleReport::Advanced { .. }),
        "the ordinary path still works: {:?}",
        cycle.upstream
    );
    let durable_before = sender
        .watermark(ORIGIN, 1)
        .await
        .unwrap_or_else(|e| panic!("watermark: {e}"));
    assert_eq!(durable_before, captured_before);
    assert_eq!(received_facts(&pool).await, captured_before);
    drop(sender);
    drop(before);
    remove_sqlite(&first_path);

    // --- The database is replaced. ----------------------------------------
    let second_path = sqlite_path("restore-after");
    let after = SqliteEdge::open(&second_path, node()).unwrap_or_else(|e| panic!("reopen: {e}"));
    let (generation, next_seq, settled, _) = origin_row(&after);
    assert_eq!(
        (generation, next_seq, settled),
        (1, 1, 0),
        "a fresh database starts at generation 1 with an unsettled handshake"
    );
    receive(&after, "EPC-AFTER-001", "after-001");
    receive(&after, "EPC-AFTER-002", "after-002");
    let captured_after = queued_facts(&after);

    let restored = SqliteSyncStore::new(after.connection());
    let report = negotiate_generation(&restored, &transport)
        .await
        .unwrap_or_else(|e| panic!("handshake after restore: {e}"));
    let HandshakeReport::Rotated { from, to, reason } = report.clone() else {
        panic!("a replaced database must be moved to a new generation: {report:?}");
    };
    assert_eq!((from, to), (1, 2));
    assert!(
        reason.is_some_and(|reason| reason.contains(&durable_before.to_string())),
        "the reason names the watermark that would have swallowed these facts"
    );

    // The agreement is durable, and the backlog moved with it.
    let (generation, next_seq, settled, note) = origin_row(&after);
    assert_eq!((generation, settled), (2, 1));
    assert_eq!(
        next_seq, captured_after,
        "the unsent tail is renumbered contiguously from one in the new generation"
    );
    assert!(
        note.is_some(),
        "why it moved is recorded, not only that it did"
    );

    let cycle = run_cycle(&restored, &sync_config(), &transport)
        .await
        .unwrap_or_else(|e| panic!("cycle after restore: {e}"));
    assert!(
        matches!(cycle.upstream, CycleReport::Advanced { .. }),
        "the restored stream uploads: {:?}",
        cycle.upstream
    );

    // Nothing was lost, and the two lives are kept apart by generation.
    assert_eq!(
        received_facts(&pool).await,
        captured_before + captured_after,
        "every fact from both databases is held by the cloud"
    );
    let generations: Vec<i64> = sqlx::query(
        "SELECT DISTINCT generation FROM sync_ingest_fact WHERE origin_id = $1 ORDER BY 1",
    )
    .bind(ORIGIN)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| panic!("generations: {e}"))
    .into_iter()
    .map(|row| row.get::<i64, _>("generation"))
    .collect();
    assert_eq!(generations, vec![1, 2]);

    // The rotation is visible to an operator rather than only to a log.
    let origins = cloud::sync_origins_list(&pool)
        .await
        .unwrap_or_else(|e| panic!("origins: {e}"));
    let row = &origins["items"][0];
    assert_eq!(row["origin_id"], ORIGIN);
    assert_eq!(row["generation"], 2);
    assert_eq!(row["durable_through"], captured_after);
    assert!(row["last_seen_at"].is_string(), "when a fact last arrived");
    assert_eq!(row["open_alerts"], 1);
    assert_eq!(row["latest_alert_kind"], "generation_rotated");

    drop(restored);
    drop(after);
    remove_sqlite(&second_path);
}

/// The same restore, with the handshake skipped: the receiver's own guard.
///
/// A sender can arrive here by being older than this protocol, or by being
/// restored between one cycle and the next. Either way the batch it sends
/// covers seqs the receiver already holds, and the old behaviour — skip them
/// all, answer with the watermark — is indistinguishable from success.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_batch_entirely_below_the_watermark_is_refused_by_name(pool: PgPool) {
    register_origin(&pool).await;
    let first = IngestBatch {
        origin_id: ORIGIN.into(),
        generation: 1,
        facts: (1..=3).map(plain_fact).collect(),
        command_watermark: 0,
        command_blocked: None,
    };
    let response = cloud::ingest_batch(&pool, &first)
        .await
        .unwrap_or_else(|e| panic!("first batch: {e}"));
    assert_eq!(response.durable_through, 3);

    // A replaced database sends its OWN first facts, which happen to occupy
    // seqs the cloud is already durable through. Different event ids: these
    // are not a resend, they are different sales.
    let restored = IngestBatch {
        origin_id: ORIGIN.into(),
        generation: 1,
        facts: (1..=2).map(plain_fact).collect(),
        command_watermark: 0,
        command_blocked: None,
    };
    let error = cloud::ingest_batch(&pool, &restored)
        .await
        .expect_err("a batch below the watermark must not be swallowed")
        .to_string();
    assert!(
        is_stale_generation(&error),
        "the refusal carries a code the sender can act on: {error}"
    );
    assert!(
        error.contains('3'),
        "the refusal names the watermark so a person can see the gap: {error}"
    );
    assert!(error.contains(ORIGIN), "and the origin: {error}");
    assert!(
        error.contains("handshake"),
        "and what to do about it: {error}"
    );

    // Refusing rolled the receipt back; the alert survives it, because the
    // alert is the only thing that will still be there in the morning.
    let alerts = cloud::sync_integrity_alerts(&pool, 50)
        .await
        .unwrap_or_else(|e| panic!("alerts: {e}"));
    assert_eq!(alerts["items"].as_array().map(Vec::len), Some(1));
    let alert = &alerts["items"][0];
    assert_eq!(alert["kind"], "batch_below_watermark");
    assert_eq!(alert["watermark_seq"], 3);
    assert_eq!(alert["occurrences"], 1);

    // A till retrying every five seconds must not bury the operator.
    let _ = cloud::ingest_batch(&pool, &restored).await;
    let alerts = cloud::sync_integrity_alerts(&pool, 50)
        .await
        .unwrap_or_else(|e| panic!("alerts again: {e}"));
    assert_eq!(
        alerts["items"].as_array().map(Vec::len),
        Some(1),
        "a repeat bumps the row it already has"
    );
    assert_eq!(alerts["items"][0]["occurrences"], 2);

    // Nothing landed. The receiver's watermark is exactly where it was.
    assert_eq!(receiver_watermark(&pool, 1).await, 3);
    assert_eq!(received_facts(&pool).await, 3);
}

/// A resend that STRADDLES the watermark is the ordinary recovery after a lost
/// response, and it must keep working. This is the test that would catch the
/// guard above being written one comparison too greedily.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_resend_straddling_the_watermark_still_lands(pool: PgPool) {
    register_origin(&pool).await;
    let facts: Vec<SyncFact> = (1..=4).map(plain_fact).collect();
    let first = IngestBatch {
        origin_id: ORIGIN.into(),
        generation: 1,
        facts: facts[..2].to_vec(),
        command_watermark: 0,
        command_blocked: None,
    };
    cloud::ingest_batch(&pool, &first)
        .await
        .unwrap_or_else(|e| panic!("first: {e}"));

    // The sender never saw the response, so it resends from its own watermark
    // of zero — seqs 1..4, two of which the cloud already holds.
    let resend = IngestBatch {
        origin_id: ORIGIN.into(),
        generation: 1,
        facts,
        command_watermark: 0,
        command_blocked: None,
    };
    let response = cloud::ingest_batch(&pool, &resend)
        .await
        .unwrap_or_else(|e| panic!("resend: {e}"));
    assert_eq!(response.durable_through, 4);
    assert_eq!(received_facts(&pool).await, 4);
    let alerts = cloud::sync_integrity_alerts(&pool, 50)
        .await
        .unwrap_or_else(|e| panic!("alerts: {e}"));
    assert_eq!(
        alerts["items"].as_array().map(Vec::len),
        Some(0),
        "an ordinary recovery is not an integrity event"
    );
}

/// A receiver claiming a seq above the highest we sent stops the session.
///
/// The kernel used to cap the claim and call it progress. Capping means
/// advancing the watermark past facts nobody can prove were received, and the
/// retention purge then deletes them.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_watermark_above_what_was_sent_stops_the_session(pool: PgPool) {
    register_origin(&pool).await;
    let path = sqlite_path("overclaim");
    let edge = SqliteEdge::open(&path, node()).unwrap_or_else(|e| panic!("open: {e}"));
    receive(&edge, "EPC-OVERCLAIM-001", "overclaim-001");
    let queued = queued_facts(&edge);
    let sender = SqliteSyncStore::new(edge.connection());

    let cycle = run_cycle(
        &sender,
        &sync_config(),
        &OverclaimingCloud {
            claim: queued + 5_000,
        },
    )
    .await
    .unwrap_or_else(|e| panic!("cycle: {e}"));
    let CycleReport::Divergent {
        claimed, max_sent, ..
    } = cycle.upstream
    else {
        panic!("an impossible claim must not settle: {:?}", cycle.upstream);
    };
    assert_eq!((claimed, max_sent), (queued + 5_000, queued));

    assert_eq!(
        sender
            .watermark(ORIGIN, 1)
            .await
            .unwrap_or_else(|e| panic!("watermark: {e}")),
        0,
        "nothing advanced, so nothing can be purged"
    );
    assert_eq!(
        queued_facts(&edge),
        queued,
        "and every fact is still queued locally"
    );
    drop(sender);
    drop(edge);
    remove_sqlite(&path);
}

/// A healthy shop restarts. The handshake confirms the stream it already has,
/// nothing moves, and the seqs it allocates next are the ones it would have.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_established_shop_keeps_its_stream_across_a_restart(pool: PgPool) {
    register_origin(&pool).await;
    let path = sqlite_path("restart");
    let transport = Cloud { pool: pool.clone() };
    let edge = SqliteEdge::open(&path, node()).unwrap_or_else(|e| panic!("open: {e}"));
    receive(&edge, "EPC-RESTART-001", "restart-001");
    let sender = SqliteSyncStore::new(edge.connection());
    negotiate_generation(&sender, &transport)
        .await
        .unwrap_or_else(|e| panic!("handshake: {e}"));
    run_cycle(&sender, &sync_config(), &transport)
        .await
        .unwrap_or_else(|e| panic!("cycle: {e}"));
    let settled_at = queued_facts(&edge);

    // The restart: the gate is cleared, so it asks again.
    sender
        .reopen_handshake("process restarted")
        .await
        .unwrap_or_else(|e| panic!("reopen: {e}"));
    let report = negotiate_generation(&sender, &transport)
        .await
        .unwrap_or_else(|e| panic!("second handshake: {e}"));
    assert_eq!(report, HandshakeReport::Kept { generation: 1 });

    let (generation, next_seq, settled, _) = origin_row(&edge);
    assert_eq!(
        (generation, next_seq, settled),
        (1, settled_at, 1),
        "nothing moved, and the seq allocator is untouched"
    );

    // And it keeps streaming from where it was.
    receive(&edge, "EPC-RESTART-002", "restart-002");
    let cycle = run_cycle(&sender, &sync_config(), &transport)
        .await
        .unwrap_or_else(|e| panic!("cycle after restart: {e}"));
    assert!(
        matches!(cycle.upstream, CycleReport::Advanced { .. }),
        "{:?}",
        cycle.upstream
    );
    assert_eq!(received_facts(&pool).await, queued_facts(&edge));
    drop(sender);
    drop(edge);
    remove_sqlite(&path);
}

/// A node that cannot reach the cloud queues and does not send. It must not
/// guess a generation, and it must not lose what it takes in the meantime.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_unreachable_cloud_leaves_the_backlog_queued(pool: PgPool) {
    register_origin(&pool).await;
    let path = sqlite_path("unreachable");
    let edge = SqliteEdge::open(&path, node()).unwrap_or_else(|e| panic!("open: {e}"));
    receive(&edge, "EPC-OFFLINE-001", "offline-001");
    let sender = SqliteSyncStore::new(edge.connection());

    // A transport with no handshake stands in for a cloud that cannot be
    // asked: the default answer is a refusal, which is the same conclusion.
    let report = negotiate_generation(&sender, &OverclaimingCloud { claim: 0 })
        .await
        .unwrap_or_else(|e| panic!("handshake: {e}"));
    assert!(
        matches!(report, HandshakeReport::Unreachable { .. }),
        "{report:?}"
    );
    assert!(!report.clear_to_send(), "and the sender stays gated");

    let (generation, _, settled, _) = origin_row(&edge);
    assert_eq!(
        (generation, settled),
        (1, 0),
        "nothing was agreed, so nothing is recorded as agreed"
    );
    assert!(queued_facts(&edge) > 0, "the takings are still here");
    assert_eq!(received_facts(&pool).await, 0);
    drop(sender);
    drop(edge);
    remove_sqlite(&path);
}

/// An origin nobody has registered still shows up once it has uploaded, and an
/// alert can be closed by the person who dealt with it.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_origins_view_shows_unregistered_senders_and_alerts_can_be_closed(pool: PgPool) {
    cloud::sync_raise_integrity_alert(
        &pool,
        "store-99-edge",
        1,
        "batch_below_watermark",
        "a stranger",
        Some(17),
    )
    .await
    .unwrap_or_else(|e| panic!("raise: {e}"));

    let alerts = cloud::sync_integrity_alerts(&pool, 50)
        .await
        .unwrap_or_else(|e| panic!("alerts: {e}"));
    let id = alerts["items"][0]["id"]
        .as_i64()
        .unwrap_or_else(|| panic!("alert id: {alerts}"));
    cloud::sync_acknowledge_integrity_alert(&pool, id, "ops-on-call")
        .await
        .unwrap_or_else(|e| panic!("acknowledge: {e}"));
    assert!(
        cloud::sync_acknowledge_integrity_alert(&pool, id, "ops-on-call")
            .await
            .is_err(),
        "closing a closed alert is not a silent success"
    );

    // Closed, so the next occurrence opens a fresh row rather than reviving
    // one somebody has already signed off.
    cloud::sync_raise_integrity_alert(
        &pool,
        "store-99-edge",
        1,
        "batch_below_watermark",
        "it happened again",
        Some(17),
    )
    .await
    .unwrap_or_else(|e| panic!("raise again: {e}"));
    let alerts: Value = cloud::sync_integrity_alerts(&pool, 50)
        .await
        .unwrap_or_else(|e| panic!("alerts: {e}"));
    assert_eq!(alerts["items"].as_array().map(Vec::len), Some(1));
    assert_ne!(alerts["items"][0]["id"], id);
}

fn plain_fact(seq: i64) -> SyncFact {
    SyncFact {
        seq,
        event_id: Uuid::new_v4(),
        event_type: "sales.receipt".into(),
        payload: serde_json::json!({ "seq": seq }),
        created_at: chrono::Utc::now(),
    }
}

/// The constant the receiver and the sender both read. If this ever drifts,
/// a restored till retries a doomed batch until its breaker opens instead of
/// renegotiating, and the failure looks like a network problem.
#[test]
fn the_refusal_code_is_one_string_both_ends_know() {
    assert!(is_stale_generation(&format!(
        "prefix {STALE_GENERATION_CODE} suffix"
    )));
    assert!(!is_stale_generation("connection refused"));
}
