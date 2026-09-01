//! The same sync behaviour, asserted against both storage adapters.
//!
//! There are now two implementations of [`SyncStore`] — PostgreSQL for the
//! cloud node, SQLite for the DC and store edges — driven by one shared
//! cycle. That split is only worth anything if a divergence between the
//! adapters shows up as a failing test here rather than as an incident in one
//! deployment, so every check in this file runs twice over the same script.
//!
//! Anything asserted here is a property of BEING a sync node, not of being a
//! particular database.

use async_trait::async_trait;
use inventory_backend::cloud::domain::{
    sign_command, BreakerPolicy, IngestBatch, IngestResponse, PushedCommand,
};
use inventory_backend::edge::{EdgeRole, NodeContext, SiteId, SqliteEdge, SqliteSyncStore};
use inventory_backend::sync::port::{SyncStore, SyncTransport};
use inventory_backend::sync::{run_cycle, CycleReport, SyncConfig};
use serde_json::json;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

const KEY: &str = "conformance-key";
const ORIGIN: &str = "node-under-test";

fn config(command_key: Option<String>) -> SyncConfig {
    SyncConfig {
        batch_limit: 100,
        breaker: BreakerPolicy {
            threshold: 3,
            base_cooldown_seconds: 30,
            max_cooldown_seconds: 900,
        },
        command_key,
    }
}

/// A cloud that accepts everything and hands back whatever commands the test
/// queued. Deterministic on purpose: the point is the node's behaviour.
struct ScriptedCloud {
    commands: Mutex<Vec<PushedCommand>>,
    seen: Mutex<Vec<IngestBatch>>,
    fail: bool,
}

impl ScriptedCloud {
    fn accepting() -> Self {
        Self {
            commands: Mutex::new(Vec::new()),
            seen: Mutex::new(Vec::new()),
            fail: false,
        }
    }

    fn failing() -> Self {
        Self {
            fail: true,
            ..Self::accepting()
        }
    }

    fn queue(&self, command: PushedCommand) {
        self.commands
            .lock()
            .unwrap_or_else(|e| panic!("queue: {e}"))
            .push(command);
    }

    fn last_batch(&self) -> Option<IngestBatch> {
        self.seen
            .lock()
            .unwrap_or_else(|e| panic!("seen: {e}"))
            .last()
            .cloned()
    }
}

#[async_trait]
impl SyncTransport for ScriptedCloud {
    async fn send(&self, batch: &IngestBatch) -> Result<IngestResponse, String> {
        self.seen
            .lock()
            .map_err(|e| e.to_string())?
            .push(batch.clone());
        if self.fail {
            return Err("scripted transport failure".into());
        }
        let durable_through = batch.facts.iter().map(|fact| fact.seq).max().unwrap_or(0);
        let commands = self
            .commands
            .lock()
            .map_err(|e| e.to_string())?
            .iter()
            .filter(|command| command.seq > batch.command_watermark)
            .cloned()
            .collect();
        Ok(IngestResponse {
            durable_through,
            rejected: Vec::new(),
            commands,
        })
    }
}

/// What each adapter must provide for the shared script to run.
#[async_trait]
trait NodeUnderTest: Sync {
    fn store(&self) -> &dyn SyncStore;
    /// Append `count` facts the way a real domain write would.
    async fn produce_facts(&self, count: usize);
    /// The commercial version this node is currently honouring, if any.
    async fn resident_publication_price(&self, publication_id: Uuid) -> Option<i64>;
    /// A sku this node will accept in a price rule.
    ///
    /// The script asks rather than inventing one: the cloud holds a foreign
    /// key to its own catalogue, while an edge's price book is a flattened
    /// read model with no such table. That is a real and correct difference
    /// between the adapters, so the suite accommodates it instead of
    /// pretending both nodes are the same database.
    async fn sample_sku_id(&self) -> Uuid;
}

// ---- The SQLite edge -----------------------------------------------------

struct SqliteNode {
    edge: SqliteEdge,
    store: SqliteSyncStore,
}

impl SqliteNode {
    fn fresh() -> Self {
        let site = SiteId::new("store-07").unwrap_or_else(|e| panic!("site: {e}"));
        let node =
            NodeContext::new(ORIGIN, EdgeRole::Store, site).unwrap_or_else(|e| panic!("node: {e}"));
        let edge = SqliteEdge::open_in_memory(node).unwrap_or_else(|e| panic!("edge: {e}"));
        // The adapter always starts with a real bootstrap snapshot. Settle it
        // as fixture setup so the shared scripts begin from an idle stream,
        // just as the freshly migrated PostgreSQL fixture does.
        {
            let connection = edge.connection();
            let guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
            guard
                .execute(
                    "INSERT INTO sync_watermark(origin_id,generation,durable_seq,updated_at)
                     VALUES (?1,1,1,?2)",
                    rusqlite::params![ORIGIN, chrono::Utc::now().to_rfc3339()],
                )
                .unwrap_or_else(|e| panic!("settle bootstrap: {e}"));
        }
        let store = SqliteSyncStore::new(edge.connection());
        Self { edge, store }
    }

    fn connection(&self) -> Arc<Mutex<rusqlite::Connection>> {
        self.edge.connection()
    }
}

#[async_trait]
impl NodeUnderTest for SqliteNode {
    fn store(&self) -> &dyn SyncStore {
        &self.store
    }

    async fn produce_facts(&self, count: usize) {
        // Write straight into the log the way `append_command` does, so the
        // script does not depend on the inventory domain's seeded data.
        let connection = self.connection();
        let mut guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
        for index in 0..count {
            let tx = guard.transaction().unwrap_or_else(|e| panic!("tx: {e}"));
            inventory_backend::edge::sync::enqueue_fact(
                &tx,
                Uuid::new_v4(),
                "inventory.movement",
                &json!({"n": index}),
            )
            .unwrap_or_else(|e| panic!("enqueue: {e}"));
            tx.commit().unwrap_or_else(|e| panic!("commit: {e}"));
        }
    }

    async fn sample_sku_id(&self) -> Uuid {
        Uuid::new_v4()
    }

    async fn resident_publication_price(&self, publication_id: Uuid) -> Option<i64> {
        let connection = self.connection();
        let guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
        guard
            .query_row(
                "SELECT unit_price_minor FROM commercial_price_rule WHERE publication_id = ?1",
                rusqlite::params![publication_id.to_string()],
                |row| row.get(0),
            )
            .ok()
    }
}

// ---- The shared script ---------------------------------------------------

fn activation(publication_id: Uuid, price_minor: i64, sku_id: Uuid) -> serde_json::Value {
    json!({
        "publication_id": publication_id,
        "version": 4242,
        "name": "Conformance price book",
        "effective_from": chrono::Utc::now(),
        "effective_to": null,
        "tax_rules": [{"tax_category": "STANDARD", "rate_bps": 1100, "tax_inclusive": true}],
        "price_rules": [{
            "sku_id": sku_id,
            // The shop floor names products by code, not by the centre's UUID.
            "sku_code": "CONFORMANCE-SKU",
            "site_id": null,
            "channel": "STORE",
            "sellable": true,
            "currency": "IDR",
            "unit_price_minor": price_minor,
            "tax_category": "STANDARD"
        }],
    })
}

fn signed_command(seq: i64, payload: serde_json::Value) -> PushedCommand {
    let command_id = Uuid::new_v4();
    let command_type = "commercial.publication.activate".to_string();
    let key = inventory_backend::cloud::postgres::command_signing_key(KEY);
    let signature = sign_command(
        key.as_bytes(),
        seq,
        &command_id,
        &command_type,
        &payload,
        None,
        false,
    );
    PushedCommand {
        seq,
        command_id,
        command_type,
        payload,
        expires_at: None,
        revoked: false,
        signature,
    }
}

/// An idle node still sends, so the downstream lane needs no second
/// connection: this is the property the piggyback design rests on.
async fn an_idle_cycle_still_reports_upward(node: &dyn NodeUnderTest) {
    let cloud = ScriptedCloud::accepting();
    let outcome = run_cycle(node.store(), &config(None), &cloud)
        .await
        .unwrap_or_else(|e| panic!("idle cycle: {e}"));
    assert_eq!(outcome.upstream, CycleReport::Idle);
    let batch = cloud
        .last_batch()
        .unwrap_or_else(|| panic!("an idle cycle must still send"));
    assert_eq!(batch.origin_id, ORIGIN);
    assert_eq!(batch.command_watermark, 0);
    assert!(batch.facts.is_empty());
}

/// Facts drain in order, and the watermark advances only on a settlement the
/// node can prove.
async fn facts_drain_and_the_watermark_advances(node: &dyn NodeUnderTest) {
    let baseline = node
        .store()
        .watermark(ORIGIN, 1)
        .await
        .unwrap_or_else(|e| panic!("baseline watermark: {e}"));
    node.produce_facts(3).await;
    let cloud = ScriptedCloud::accepting();
    let outcome = run_cycle(node.store(), &config(None), &cloud)
        .await
        .unwrap_or_else(|e| panic!("drain: {e}"));
    assert_eq!(
        outcome.upstream,
        CycleReport::Advanced {
            sent: 3,
            advance_to: baseline + 3,
            dead_lettered: 0
        }
    );
    assert_eq!(
        node.store()
            .watermark(ORIGIN, 1)
            .await
            .unwrap_or_else(|e| panic!("watermark: {e}")),
        baseline + 3
    );
    // Drained: the next cycle has nothing to send.
    let outcome = run_cycle(node.store(), &config(None), &cloud)
        .await
        .unwrap_or_else(|e| panic!("drain 2: {e}"));
    assert_eq!(outcome.upstream, CycleReport::Idle);
}

/// A transport failure advances nothing and is durably counted, and the
/// breaker opens at the configured threshold.
async fn failures_are_durable_and_open_the_breaker(node: &dyn NodeUnderTest) {
    let baseline = node
        .store()
        .watermark(ORIGIN, 1)
        .await
        .unwrap_or_else(|e| panic!("baseline watermark: {e}"));
    node.produce_facts(1).await;
    let cloud = ScriptedCloud::failing();
    for attempt in 1..=3_u32 {
        let outcome = run_cycle(node.store(), &config(None), &cloud)
            .await
            .unwrap_or_else(|e| panic!("failing cycle: {e}"));
        match outcome.upstream {
            CycleReport::Failed {
                consecutive_failures,
                breaker_opened,
                ..
            } => {
                assert_eq!(consecutive_failures, attempt);
                assert_eq!(breaker_opened, attempt >= 3);
            }
            other => panic!("expected a failure, got {other:?}"),
        }
    }
    // Open breaker: the node refuses to try at all.
    let outcome = run_cycle(node.store(), &config(None), &cloud)
        .await
        .unwrap_or_else(|e| panic!("breaker cycle: {e}"));
    assert!(matches!(
        outcome.upstream,
        CycleReport::SkippedBreaker { .. }
    ));
    // Nothing was ever settled.
    assert_eq!(
        node.store()
            .watermark(ORIGIN, 1)
            .await
            .unwrap_or_else(|e| panic!("watermark: {e}")),
        baseline
    );
}

/// A signed command applies its effect; a forged one blocks the stream
/// without moving the watermark.
async fn commands_apply_when_signed_and_block_when_forged(node: &dyn NodeUnderTest) {
    let publication_id = Uuid::new_v4();
    let sku_id = node.sample_sku_id().await;
    let key = inventory_backend::cloud::postgres::command_signing_key(KEY);
    let config = config(Some(key));

    // Forged first: same command, payload altered after signing.
    let mut forged = signed_command(1, activation(publication_id, 10_000, sku_id));
    forged.payload["price_rules"][0]["unit_price_minor"] = json!(1);
    let cloud = ScriptedCloud::accepting();
    cloud.queue(forged);
    let outcome = run_cycle(node.store(), &config, &cloud)
        .await
        .unwrap_or_else(|e| panic!("forged cycle: {e}"));
    assert_eq!(outcome.commands_applied, 0);
    let blocked = outcome
        .commands_blocked
        .unwrap_or_else(|| panic!("a forged command must block"));
    assert_eq!(blocked.seq, 1);
    assert!(blocked.reason.contains("signature"));
    assert_eq!(node.resident_publication_price(publication_id).await, None);

    // The honest command at the same position applies and clears the block —
    // no operator action required.
    let cloud = ScriptedCloud::accepting();
    cloud.queue(signed_command(
        1,
        activation(publication_id, 25_000, sku_id),
    ));
    let outcome = run_cycle(node.store(), &config, &cloud)
        .await
        .unwrap_or_else(|e| panic!("honest cycle: {e}"));
    assert_eq!(outcome.commands_blocked, None);
    assert_eq!(outcome.commands_applied, 1);
    assert_eq!(
        node.resident_publication_price(publication_id).await,
        Some(25_000)
    );

    // The node reports its new command watermark upward on the next cycle.
    let cloud = ScriptedCloud::accepting();
    run_cycle(node.store(), &config, &cloud)
        .await
        .unwrap_or_else(|e| panic!("report cycle: {e}"));
    let batch = cloud
        .last_batch()
        .unwrap_or_else(|| panic!("expected a batch"));
    assert_eq!(batch.command_watermark, 1);
    assert_eq!(batch.command_blocked, None);
}

/// Applying is idempotent: a resend below the watermark changes nothing.
async fn a_resent_command_is_ignored(node: &dyn NodeUnderTest) {
    let publication_id = Uuid::new_v4();
    let sku_id = node.sample_sku_id().await;
    let key = inventory_backend::cloud::postgres::command_signing_key(KEY);
    let config = config(Some(key));
    let command = signed_command(1, activation(publication_id, 30_000, sku_id));

    let cloud = ScriptedCloud::accepting();
    cloud.queue(command.clone());
    let outcome = run_cycle(node.store(), &config, &cloud)
        .await
        .unwrap_or_else(|e| panic!("first: {e}"));
    assert_eq!(outcome.commands_applied, 1);

    // The cloud repeats it (a lost response, say). The node must not re-apply.
    let applied = node
        .store()
        .apply_commands(
            inventory_backend::cloud::postgres::command_signing_key(KEY).as_bytes(),
            &[command],
        )
        .await
        .unwrap_or_else(|e| panic!("resend: {e}"));
    assert_eq!((applied.applied, applied.skipped), (0, 0));
    assert_eq!(
        node.resident_publication_price(publication_id).await,
        Some(30_000)
    );
}

// ---- The suite, run against each adapter ---------------------------------

macro_rules! conformance_suite {
    ($name:ident, $node:expr) => {
        mod $name {
            use super::*;

            #[tokio::test]
            async fn idle_cycle_still_reports_upward() {
                an_idle_cycle_still_reports_upward(&$node).await;
            }

            #[tokio::test]
            async fn facts_drain_and_watermark_advances() {
                facts_drain_and_the_watermark_advances(&$node).await;
            }

            #[tokio::test]
            async fn failures_open_the_breaker() {
                failures_are_durable_and_open_the_breaker(&$node).await;
            }

            #[tokio::test]
            async fn commands_apply_signed_and_block_forged() {
                commands_apply_when_signed_and_block_when_forged(&$node).await;
            }

            #[tokio::test]
            async fn resent_command_is_ignored() {
                a_resent_command_is_ignored(&$node).await;
            }
        }
    };
}

conformance_suite!(sqlite_edge, SqliteNode::fresh());

// The PostgreSQL node runs the same script under `#[sqlx::test]`, which
// supplies a fresh database per test; see `postgres_node` below.
mod postgres_node {
    use super::*;
    use inventory_backend::cloud::postgres::PgSyncStore;
    use sqlx::PgPool;

    struct PgNode {
        store: PgSyncStore,
        pool: PgPool,
    }

    impl PgNode {
        async fn fresh(pool: PgPool) -> Self {
            inventory_backend::cloud::postgres::provision_origin(&pool, ORIGIN, 1, true)
                .await
                .unwrap_or_else(|e| panic!("provision: {e}"));
            Self {
                store: PgSyncStore::new(pool.clone()),
                pool,
            }
        }
    }

    #[async_trait]
    impl NodeUnderTest for PgNode {
        fn store(&self) -> &dyn SyncStore {
            &self.store
        }

        async fn produce_facts(&self, count: usize) {
            for index in 0..count {
                inventory_backend::cloud::postgres::debug_insert_raw_fact(
                    &self.pool,
                    "inventory.movement",
                    &json!({"n": index}),
                )
                .await
                .unwrap_or_else(|e| panic!("enqueue: {e}"));
            }
        }

        async fn sample_sku_id(&self) -> Uuid {
            sqlx::query_scalar::<_, Uuid>("SELECT id FROM sku ORDER BY id LIMIT 1")
                .fetch_one(&self.pool)
                .await
                .unwrap_or_else(|e| panic!("seeded sku: {e}"))
        }

        async fn resident_publication_price(&self, publication_id: Uuid) -> Option<i64> {
            sqlx::query_scalar::<_, i64>(
                "SELECT unit_price_minor FROM commercial_price_rule WHERE publication_id = $1",
            )
            .bind(publication_id)
            .fetch_optional(&self.pool)
            .await
            .unwrap_or(None)
        }
    }

    #[sqlx::test(migrations = "./migrations/postgres")]
    async fn idle_cycle_still_reports_upward(pool: PgPool) {
        an_idle_cycle_still_reports_upward(&PgNode::fresh(pool).await).await;
    }

    #[sqlx::test(migrations = "./migrations/postgres")]
    async fn facts_drain_and_watermark_advances(pool: PgPool) {
        facts_drain_and_the_watermark_advances(&PgNode::fresh(pool).await).await;
    }

    #[sqlx::test(migrations = "./migrations/postgres")]
    async fn failures_open_the_breaker(pool: PgPool) {
        failures_are_durable_and_open_the_breaker(&PgNode::fresh(pool).await).await;
    }

    #[sqlx::test(migrations = "./migrations/postgres")]
    async fn commands_apply_signed_and_block_forged(pool: PgPool) {
        commands_apply_when_signed_and_block_when_forged(&PgNode::fresh(pool).await).await;
    }

    #[sqlx::test(migrations = "./migrations/postgres")]
    async fn resent_command_is_ignored(pool: PgPool) {
        a_resent_command_is_ignored(&PgNode::fresh(pool).await).await;
    }
}
