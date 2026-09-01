//! The whole chain, end to end: a shop trades, its facts travel, the centre
//! rebuilds the position, the shop states its own position, and the two are
//! compared.
//!
//! Nothing here is stubbed. A real SQLite edge does real receipts, moves and
//! sales; the real sync cycle uploads through the real ingest; the real
//! applier rebuilds a real PostgreSQL ledger; the real reconciliation query
//! compares them. The point is not that each part works — the unit tests say
//! that — but that the parts still mean the same thing when joined.
//!
//! The last test is the one that matters most: it breaks the shop's position
//! behind the system's back, the way a hand-edited database or a drifted
//! projection would, and asserts the centre NOTICES. A cross-check that never
//! fires when it should is worse than no cross-check, because it is trusted.

use inventory_backend::tender::{PaymentMethod, SaleTender};
use async_trait::async_trait;
use inventory_backend::cloud::domain::{
    BreakerPolicy, IngestBatch, IngestResponse, FACT_SALES_COMPLETED,
};
use inventory_backend::cloud::postgres as cloud;
use inventory_backend::edge::{
    EdgeInventory, EdgeRole, MoveRequest, MovementCause, NodeContext, ReceiveRequest, SaleRequest,
    SiteId, SqliteEdge, SqliteSyncStore,
};
use inventory_backend::sync::port::{SyncConfig, SyncTransport};
use inventory_backend::sync::{run_cycle, CycleReport};
use sqlx::PgPool;

const ORIGIN: &str = "store-07";

fn shop() -> SqliteEdge {
    let site = SiteId::new(ORIGIN).unwrap_or_else(|e| panic!("site: {e}"));
    let node =
        NodeContext::new(ORIGIN, EdgeRole::Store, site).unwrap_or_else(|e| panic!("node: {e}"));
    SqliteEdge::open_in_memory(node).unwrap_or_else(|e| panic!("edge: {e}"))
}

fn config() -> SyncConfig {
    SyncConfig {
        batch_limit: 100,
        breaker: BreakerPolicy {
            threshold: 5,
            base_cooldown_seconds: 30,
            max_cooldown_seconds: 900,
        },
        command_key: None,
    }
}

/// The real cloud ingest, called directly rather than over a socket: the
/// bytes and the code path are the same, without a listener to manage.
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
}

/// Register the shop so its uploads are authorised and its inventory bound.
async fn enrol(pool: &PgPool) {
    cloud::register_origin_credential(
        pool,
        ORIGIN,
        "store-07-integration-sync-key-00000001",
        Some("Toko 07"),
    )
    .await
    .unwrap_or_else(|e| panic!("register: {e}"));
    sqlx::query(
        "UPDATE sync_origin_credential
         SET site_id = $1, node_role = 'STORE', active_generation = 1, inventory_enabled = true
         WHERE origin_id = $1",
    )
    .bind(ORIGIN)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("bind: {e}"));
}

/// Drain everything the shop has queued, then apply it at the centre.
async fn sync_and_apply(edge: &SqliteEdge, pool: &PgPool) {
    let store = SqliteSyncStore::new(edge.connection());
    let transport = Cloud { pool: pool.clone() };
    // Loop rather than one cycle: a day's trading is more than one batch, and
    // the point is to reach a settled state, not to test the batch limit.
    for _ in 0..20 {
        let outcome = run_cycle(&store, &config(), &transport)
            .await
            .unwrap_or_else(|e| panic!("cycle: {e}"));
        match outcome.upstream {
            CycleReport::Idle => break,
            CycleReport::Advanced { .. } => {}
            other => panic!("upload did not settle: {other:?}"),
        }
    }
    let report = cloud::apply_pending(pool, 500)
        .await
        .unwrap_or_else(|e| panic!("apply: {e}"));
    assert!(
        report.blocked.is_empty(),
        "the centre could not apply what the shop sent: {:?}",
        report.blocked
    );
}

/// One item into the shop, onto the sales floor.
fn stock(edge: &SqliteEdge, epc: &str, sku: &str, price: i64) {
    edge.receive_store(ReceiveRequest {
        idempotency_key: format!("{epc}-recv"),
        actor_id: "gudang".into(),
        epc: epc.into(),
        sku_code: sku.into(),
        unit_price_minor: price,
        source_dc_id: None,
        shipment_reference: None,
    })
    .unwrap_or_else(|e| panic!("receive {epc}: {e}"));
    edge.move_stock(MoveRequest {
        idempotency_key: format!("{epc}-move"),
        actor_id: "gudang".into(),
        epc: epc.into(),
        from: format!("{ORIGIN}.warehouse:on_hand"),
        to: format!("{ORIGIN}.floor:on_hand"),
        quantity: 1,
        cause: MovementCause::NormalMove,
        reason: "Isi lantai jual".into(),
        reference_type: None,
        reference_id: None,
    })
    .unwrap_or_else(|e| panic!("move {epc}: {e}"));
}

async fn fact_kinds(pool: &PgPool) -> Vec<(String, i64)> {
    sqlx::query_as::<_, (String, i64)>(
        "SELECT event_type, count(*)::bigint FROM sync_ingest_fact
         WHERE status = 'ACCEPTED' GROUP BY event_type ORDER BY event_type",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_else(|e| panic!("kinds: {e}"))
}

/// A sale settled the ordinary way, so the tests below read as sales rather
/// than as payment plumbing. The interesting tenders are spelled out where they
/// are the point.
fn cash(amount_minor: i64) -> Vec<SaleTender> {
    vec![SaleTender {
        method: PaymentMethod::Cash,
        amount_minor,
        reference: None,
    }]
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_trading_day_reaches_the_centre_and_reconciles(pool: PgPool) {
    enrol(&pool).await;
    let edge = shop();

    // --- The shop trades -------------------------------------------------
    stock(&edge, "EPC70000001", "BERAS-5KG", 25_000);
    stock(&edge, "EPC70000002", "GULA-1KG", 15_000);
    stock(&edge, "EPC70000003", "MINYAK-2L", 35_000);
    edge.complete_sale(SaleRequest {
        coupon_codes: Vec::new(),
        customer_id: None,
        idempotency_key: "sale-1".into(),
        actor_id: "kasir-1".into(),
        epcs: vec!["EPC70000001".into()],
        tenders: cash(50_000),
    })
    .unwrap_or_else(|e| panic!("sale: {e}"));

    // --- Everything travels ---------------------------------------------
    sync_and_apply(&edge, &pool).await;

    // History arrived, with its causes intact — this is what a position
    // alone could never carry.
    let kinds = fact_kinds(&pool).await;
    let movements = kinds
        .iter()
        .find(|(k, _)| k == "inventory.movement")
        .map(|(_, n)| *n)
        .unwrap_or(0);
    assert!(
        movements >= 6,
        "3 receipts + 3 floor moves + 1 sale movement expected, got {movements} ({kinds:?})"
    );
    let causes = sqlx::query_as::<_, (String, i64)>(
        "SELECT cause, count(*)::bigint FROM edge_movement
         WHERE origin_id = $1 GROUP BY cause ORDER BY cause",
    )
    .bind(ORIGIN)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| panic!("causes: {e}"));
    let cause_names: Vec<&str> = causes.iter().map(|(c, _)| c.as_str()).collect();
    assert!(
        cause_names.contains(&"SALE"),
        "the centre must be able to tell a sale from a loss: {causes:?}"
    );
    assert!(cause_names.contains(&"NORMAL_MOVE"), "{causes:?}");

    // The money arrived too, and it is the priced, line-level record.
    let takings: i64 =
        sqlx::query_scalar("SELECT COALESCE(sum(total_minor),0)::bigint FROM edge_sale")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("takings: {e}"));
    assert_eq!(takings, 25_000);
    assert!(kinds.iter().any(|(k, _)| k == FACT_SALES_COMPLETED));

    // --- Day close: the shop states its own position ---------------------
    let snapshot_seq = edge
        .capture_pool_snapshot()
        .unwrap_or_else(|e| panic!("snapshot: {e}"));
    sync_and_apply(&edge, &pool).await;

    // Exactly one snapshot for the whole day, not one per movement. That is
    // the change: the cross-check costs one fact, not one per fact it checks.
    let snapshots = fact_kinds(&pool)
        .await
        .into_iter()
        .find(|(k, _)| k == "inventory.pool_snapshot.v1")
        .map(|(_, n)| n)
        .unwrap_or(0);
    // The adapter emits one snapshot when the node is first provisioned, and
    // this test adds one at day close. What matters is the ratio: a day of
    // trading produces far fewer cross-checks than the facts they check —
    // which was the whole point of taking the snapshot off the movement path.
    assert_eq!(snapshots, 2, "bootstrap + one day close");
    assert!(
        snapshots < movements,
        "the cross-check must cost less than what it checks: {snapshots} vs {movements}"
    );

    // --- The two derivations agree ---------------------------------------
    let discrepancies = cloud::reconcile_positions(&pool)
        .await
        .unwrap_or_else(|e| panic!("reconcile: {e}"));
    assert!(
        discrepancies.is_empty(),
        "the centre's arithmetic disagrees with the shop's own count: {discrepancies:?}"
    );

    // The comparison actually ran — it was not vacuously empty because the
    // centre had nothing to compare against.
    let compared: i64 =
        sqlx::query_scalar("SELECT count(*)::bigint FROM edge_inventory_pool WHERE origin_id = $1")
            .bind(ORIGIN)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("pools: {e}"));
    assert!(compared > 0, "no pools were compared at all");
    assert!(snapshot_seq > 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_position_broken_behind_the_systems_back_is_caught(pool: PgPool) {
    enrol(&pool).await;
    let edge = shop();
    stock(&edge, "EPC70000010", "TEPUNG-1KG", 12_000);
    stock(&edge, "EPC70000011", "TELUR-1KG", 28_000);
    sync_and_apply(&edge, &pool).await;

    // Someone fixes the shop over SSH with SQL: the projection moves and no
    // fact records it. This is the failure a ledger cannot see, because a
    // ledger only knows what the system believes it did.
    {
        let connection = edge.connection();
        let guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
        // One item only, so the pool ends up exactly five units richer than
        // its own history accounts for.
        let touched = guard
            .execute(
                "UPDATE inventory_projection SET quantity = quantity + 5
                 WHERE place_id = ?1 AND subject_id = (
                     SELECT subject_id FROM inventory_projection
                     WHERE place_id = ?1 ORDER BY subject_id LIMIT 1)",
                rusqlite::params![format!("{ORIGIN}.floor:on_hand")],
            )
            .unwrap_or_else(|e| panic!("hand edit: {e}"));
        assert_eq!(touched, 1, "the hand edit must actually have landed");
    }

    // Day close. The shop reports what it now believes, which is wrong.
    edge.capture_pool_snapshot()
        .unwrap_or_else(|e| panic!("snapshot: {e}"));
    sync_and_apply(&edge, &pool).await;

    let discrepancies = cloud::reconcile_positions(&pool)
        .await
        .unwrap_or_else(|e| panic!("reconcile: {e}"));
    assert_eq!(
        discrepancies.len(),
        1,
        "the cross-check must fire on an untracked change: {discrepancies:?}"
    );
    let found = &discrepancies[0];
    assert_eq!(found.origin_id, ORIGIN);
    assert!(found.pool_id.contains("floor"), "{}", found.pool_id);
    // The shop claims five more than its own history accounts for.
    assert_eq!(found.difference(), -5, "{found:?}");
    assert!(found.applied_seq >= found.snapshot_seq);
}
