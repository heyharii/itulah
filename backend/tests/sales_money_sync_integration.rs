//! Money travelling up: a sale rung at a shop reaches the centre's takings.
//!
//! Until this lane existed the centre knew stock had left a shop but not what
//! it sold for, which made a sales report over thirty shops impossible. The
//! tests below follow one sale from a SQLite till to a PostgreSQL report, and
//! then try to break it the two ways that matter: a resend must not double
//! the day's takings, and a till whose arithmetic is wrong must not have its
//! numbers quietly believed.

use inventory_backend::cloud::domain::{parse_sales_completed, FACT_SALES_COMPLETED};
use inventory_backend::cloud::postgres as cloud;
use inventory_backend::edge::{
    EdgeInventory, EdgeRole, MoveRequest, MovementCause, NodeContext, ReceiveRequest, SaleRequest,
    SiteId, SqliteEdge,
};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

const ORIGIN: &str = "store-07";

fn shop() -> SqliteEdge {
    let site = SiteId::new(ORIGIN).unwrap_or_else(|e| panic!("site: {e}"));
    let node =
        NodeContext::new(ORIGIN, EdgeRole::Store, site).unwrap_or_else(|e| panic!("node: {e}"));
    SqliteEdge::open_in_memory(node).unwrap_or_else(|e| panic!("edge: {e}"))
}

/// Take one item into the shop and put it on the floor, so it can be sold.
fn stock_one(edge: &SqliteEdge, epc: &str, sku: &str, price: i64, key: &str) {
    edge.receive_store(ReceiveRequest {
        idempotency_key: format!("{key}-recv"),
        actor_id: "gudang".into(),
        epc: epc.into(),
        sku_code: sku.into(),
        unit_price_minor: price,
        source_dc_id: None,
        shipment_reference: None,
    })
    .unwrap_or_else(|e| panic!("receive: {e}"));
    edge.move_stock(MoveRequest {
        idempotency_key: format!("{key}-move"),
        actor_id: "gudang".into(),
        epc: epc.into(),
        from: format!("{ORIGIN}.warehouse:on_hand"),
        to: format!("{ORIGIN}.floor:on_hand"),
        quantity: 1,
        cause: MovementCause::NormalMove,
        reason: "Pindah ke lantai jual".into(),
        reference_type: None,
        reference_id: None,
    })
    .unwrap_or_else(|e| panic!("move: {e}"));
}

/// Every fact the shop has queued, oldest first.
fn queued_facts(edge: &SqliteEdge) -> Vec<(String, serde_json::Value)> {
    let connection = edge.connection();
    let guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
    let mut statement = guard
        .prepare("SELECT event_type, payload FROM sync_fact_log ORDER BY seq")
        .unwrap_or_else(|e| panic!("prepare: {e}"));
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .unwrap_or_else(|e| panic!("query: {e}"));
    rows.map(|r| {
        let (kind, payload) = r.unwrap_or_else(|e| panic!("row: {e}"));
        (
            kind,
            serde_json::from_str(&payload).unwrap_or_else(|e| panic!("payload: {e}")),
        )
    })
    .collect()
}

#[test]
fn a_sale_queues_its_money_alongside_its_stock_movement() {
    let edge = shop();
    stock_one(&edge, "EPC90000001", "BERAS-5KG", 25_000, "a");

    let sale = edge
        .complete_sale(SaleRequest {
            coupon_codes: Vec::new(),
            customer_id: None,
            idempotency_key: "sale-1".into(),
            actor_id: "kasir-1".into(),
            epcs: vec!["EPC90000001".into()],
            cash_minor: 50_000,
        })
        .unwrap_or_else(|e| panic!("sale: {e}"));

    let facts = queued_facts(&edge);
    let money: Vec<_> = facts
        .iter()
        .filter(|(kind, _)| kind == FACT_SALES_COMPLETED)
        .collect();
    assert_eq!(money.len(), 1, "exactly one money fact per sale");

    let parsed = parse_sales_completed(&money[0].1)
        .unwrap_or_else(|e| panic!("the shop must emit a valid sale fact: {e}"));
    assert_eq!(parsed.total_minor, 25_000);
    assert_eq!(parsed.paid_minor, 50_000);
    assert_eq!(parsed.change_minor, 25_000);
    assert_eq!(parsed.lines.len(), 1);
    assert_eq!(parsed.lines[0].sku_code, "BERAS-5KG");
    // The shop's local ledger reference travels with the money, so an
    // investigation can get from a revenue line back to the movements behind
    // it. The stock side itself goes up separately, in aggregate, as a pool
    // snapshot — which is exactly why this fact matters: it is the only
    // line-level record of a sale the centre ever receives.
    assert_eq!(parsed.movement_group_id, sale.movement_group_id);
}

#[test]
fn an_idempotent_replay_of_a_sale_queues_no_second_money_fact() {
    let edge = shop();
    stock_one(&edge, "EPC90000002", "GULA-1KG", 15_000, "b");
    let request = SaleRequest {
        coupon_codes: Vec::new(),
        customer_id: None,
        idempotency_key: "sale-2".into(),
        actor_id: "kasir-1".into(),
        epcs: vec!["EPC90000002".into()],
        cash_minor: 15_000,
    };
    let first = edge
        .complete_sale(request.clone())
        .unwrap_or_else(|e| panic!("sale: {e}"));
    let again = edge
        .complete_sale(request)
        .unwrap_or_else(|e| panic!("replay: {e}"));
    assert_eq!(first.sale_id, again.sale_id);

    let money = queued_facts(&edge)
        .into_iter()
        .filter(|(kind, _)| kind == FACT_SALES_COMPLETED)
        .count();
    assert_eq!(money, 1, "a retried till must not bill the day twice");
}

// ---- The centre's side ---------------------------------------------------

fn sale_payload(sale_id: Uuid, total: i64, paid: i64, change: i64, unit: i64) -> serde_json::Value {
    json!({
        "sale_id": sale_id,
        "movement_group_id": Uuid::new_v4(),
        "site_id": ORIGIN,
        "actor_id": "kasir-1",
        "occurred_at": chrono::Utc::now(),
        "currency": "IDR",
        "total_minor": total,
        "paid_minor": paid,
        "change_minor": change,
        "lines": [{
            "subject_id": Uuid::new_v4(),
            "epc": "EPC90000003",
            "sku_code": "MINYAK-2L",
            "quantity": 1,
            "unit_price_minor": unit
        }],
    })
}

async fn ingest(pool: &PgPool, seq: i64, payload: serde_json::Value) {
    cloud::ingest_batch(
        pool,
        &inventory_backend::cloud::domain::IngestBatch {
            origin_id: ORIGIN.into(),
            generation: 1,
            facts: vec![inventory_backend::cloud::domain::SyncFact {
                seq,
                event_id: Uuid::new_v4(),
                event_type: FACT_SALES_COMPLETED.into(),
                payload,
                created_at: chrono::Utc::now(),
            }],
            command_watermark: 0,
            command_blocked: None,
        },
    )
    .await
    .unwrap_or_else(|e| panic!("ingest: {e}"));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn takings_reach_the_centre_and_a_resend_does_not_double_them(pool: PgPool) {
    let sale_id = Uuid::new_v4();
    ingest(
        &pool,
        1,
        sale_payload(sale_id, 30_000, 50_000, 20_000, 30_000),
    )
    .await;
    let report = cloud::apply_pending(&pool, 200)
        .await
        .unwrap_or_else(|e| panic!("apply: {e}"));
    assert!(report.blocked.is_empty(), "{:?}", report.blocked);

    let takings: i64 =
        sqlx::query_scalar("SELECT COALESCE(sum(total_minor),0)::bigint FROM edge_sale")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("takings: {e}"));
    assert_eq!(takings, 30_000);

    // The same sale arrives again at a later position — a resend after a lost
    // response, which is how a flaky shop connection ordinarily ends.
    ingest(
        &pool,
        2,
        sale_payload(sale_id, 30_000, 50_000, 20_000, 30_000),
    )
    .await;
    let report = cloud::apply_pending(&pool, 200)
        .await
        .unwrap_or_else(|e| panic!("apply 2: {e}"));
    assert!(report.blocked.is_empty());
    let takings: i64 =
        sqlx::query_scalar("SELECT COALESCE(sum(total_minor),0)::bigint FROM edge_sale")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("takings 2: {e}"));
    assert_eq!(
        takings, 30_000,
        "a resend must not double the day's takings"
    );

    let lines: i64 = sqlx::query_scalar("SELECT count(*)::bigint FROM edge_sale_line")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("lines: {e}"));
    assert_eq!(lines, 1);

    // The report the fleet exists to produce.
    let summary = cloud::sales_by_site(
        &pool,
        chrono::Utc::now() - chrono::Duration::hours(1),
        chrono::Utc::now() + chrono::Duration::hours(1),
    )
    .await
    .unwrap_or_else(|e| panic!("report: {e}"));
    assert_eq!(summary["gross_minor"], 30_000);
    assert_eq!(summary["sites"][0]["site_id"], ORIGIN);
    assert_eq!(summary["sites"][0]["sale_count"], 1);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_till_whose_arithmetic_is_wrong_is_refused_not_believed(pool: PgPool) {
    // Lines say 20,000; the till claims a 30,000 total. Believing it would
    // put a wrong number into the centre's revenue silently, which is worse
    // than refusing it loudly.
    ingest(
        &pool,
        1,
        sale_payload(Uuid::new_v4(), 30_000, 30_000, 0, 20_000),
    )
    .await;
    let report = cloud::apply_pending(&pool, 200)
        .await
        .unwrap_or_else(|e| panic!("apply: {e}"));
    assert_eq!(report.blocked.len(), 1);
    assert!(
        report.blocked[0].reason.contains("add up to"),
        "{}",
        report.blocked[0].reason
    );

    let rows: i64 = sqlx::query_scalar("SELECT count(*)::bigint FROM edge_sale")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("count: {e}"));
    assert_eq!(rows, 0, "nothing from a sale that does not add up");
}
