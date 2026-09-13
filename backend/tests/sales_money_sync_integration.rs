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
use inventory_backend::tender::{PaymentMethod, SaleTender};
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

/// A sale settled the ordinary way, so the tests below read as sales rather
/// than as payment plumbing. The interesting tenders are spelled out where they
/// are the point.
fn cash(amount_minor: i64) -> Vec<SaleTender> {
    vec![SaleTender {
        voucher_authorization_id: None,
        method: PaymentMethod::Cash,
        amount_minor,
        reference: None,
    }]
}

#[test]
fn a_sale_queues_its_money_alongside_its_stock_movement() {
    let edge = shop();
    stock_one(&edge, "EPC90000001", "BERAS-5KG", 25_000, "a");

    let sale = edge
        .complete_sale(SaleRequest {
            charges: Vec::new(),
            coupon_codes: Vec::new(),
            customer_id: None,
            idempotency_key: "sale-1".into(),
            actor_id: "kasir-1".into(),
            epcs: vec!["EPC90000001".into()],
            tenders: cash(50_000),
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
        charges: Vec::new(),
        coupon_codes: Vec::new(),
        customer_id: None,
        idempotency_key: "sale-2".into(),
        actor_id: "kasir-1".into(),
        epcs: vec!["EPC90000002".into()],
        tenders: cash(15_000),
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

// ---- Split payments ------------------------------------------------------

/// A basket settled half on a card and half in cash, followed end to end.
///
/// This is the ordinary Indonesian basket — a card until the limit, the rest
/// from a wallet — and until now the till could not record it. What it exists
/// to protect is the drawer figure: cash and card are two different debts owed
/// to the shop, counted tonight and settled by an acquirer next week
/// respectively, and a report that adds them together is only ever right by
/// accident.
#[test]
fn a_basket_paid_half_on_a_card_records_both_halves() {
    let edge = shop();
    stock_one(&edge, "EPC90000010", "KEMEJA", 200_000, "split");

    let sale = edge
        .complete_sale(SaleRequest {
            charges: Vec::new(),
            coupon_codes: Vec::new(),
            customer_id: None,
            idempotency_key: "sale-split".into(),
            actor_id: "kasir-1".into(),
            epcs: vec!["EPC90000010".into()],
            tenders: vec![
                SaleTender {
                    voucher_authorization_id: None,
                    method: PaymentMethod::Card,
                    amount_minor: 150_000,
                    reference: Some("BCA auth 4471".into()),
                },
                SaleTender {
                    voucher_authorization_id: None,
                    method: PaymentMethod::Cash,
                    amount_minor: 100_000,
                    reference: None,
                },
            ],
        })
        .unwrap_or_else(|e| panic!("split sale: {e}"));

    // 200,000 owed, 250,000 handed over, 50,000 back — and the change came out
    // of the drawer, because it always does.
    assert_eq!(sale.total_minor, 200_000);
    assert_eq!(sale.paid_minor, 250_000);
    assert_eq!(sale.change_minor, 50_000);

    let facts = queued_facts(&edge);
    let money = facts
        .iter()
        .find(|(kind, _)| kind == FACT_SALES_COMPLETED)
        .unwrap_or_else(|| panic!("the sale must queue its money"));
    let parsed = parse_sales_completed(&money.1)
        .unwrap_or_else(|e| panic!("a split sale must still be a valid fact: {e}"));
    assert_eq!(parsed.tenders.len(), 2, "both halves travel to the centre");
    assert_eq!(parsed.tenders[0].method, "CARD");
    assert_eq!(parsed.tenders[0].tender_seq, 0);
    assert_eq!(parsed.tenders[1].method, "CASH");
    assert_eq!(
        parsed.tenders.iter().map(|t| t.amount_minor).sum::<i64>(),
        parsed.paid_minor,
        "what was tendered has to equal what the sale says was paid"
    );

    // The shop's own close-of-day report, which is the number a manager counts
    // the drawer against. The card half must not be in it.
    let window = edge
        .sales_window(inventory_backend::edge::reports::SalesWindowQuery {
            from: chrono::Utc::now().date_naive(),
            to: chrono::Utc::now().date_naive(),
            utc_offset_minutes: Some(0),
            limit: None,
        })
        .unwrap_or_else(|e| panic!("window: {e}"));
    assert_eq!(
        window.cash_expected_minor, 50_000,
        "100,000 in, 50,000 out; the card settles somewhere else entirely"
    );
    let card = window
        .tenders
        .iter()
        .find(|tender| tender.method == "CARD")
        .unwrap_or_else(|| panic!("the card takings must be reported, not hidden"));
    assert_eq!(card.amount_minor, 150_000);
}

/// A card charged for more than the basket is a mistake, not generosity.
///
/// Neither reference implementation checks this: both store a list of payments
/// beside a paid figure and trust whatever wrote them. The cost is a customer
/// overcharged on a card with the till showing change owed in a drawer that
/// never received it.
#[test]
fn a_card_cannot_be_charged_above_the_basket() {
    let edge = shop();
    stock_one(&edge, "EPC90000011", "CELANA", 100_000, "over");
    let refusal = edge.complete_sale(SaleRequest {
        charges: Vec::new(),
        coupon_codes: Vec::new(),
        customer_id: None,
        idempotency_key: "sale-over".into(),
        actor_id: "kasir-1".into(),
        epcs: vec!["EPC90000011".into()],
        tenders: vec![SaleTender {
            voucher_authorization_id: None,
            method: PaymentMethod::Card,
            amount_minor: 150_000,
            reference: None,
        }],
    });
    assert!(
        refusal.is_err(),
        "there is no such thing as change from a card"
    );
}

/// A reference is for reconciling, never for the instrument itself.
#[test]
fn a_reference_that_looks_like_a_card_number_is_refused() {
    let edge = shop();
    stock_one(&edge, "EPC90000012", "TOPI", 50_000, "pan");
    let refusal = edge.complete_sale(SaleRequest {
        charges: Vec::new(),
        coupon_codes: Vec::new(),
        customer_id: None,
        idempotency_key: "sale-pan".into(),
        actor_id: "kasir-1".into(),
        epcs: vec!["EPC90000012".into()],
        tenders: vec![SaleTender {
            voucher_authorization_id: None,
            method: PaymentMethod::Card,
            amount_minor: 50_000,
            reference: Some("4571 2234 9981 0043".into()),
        }],
    });
    assert!(
        refusal.is_err(),
        "a card number that reaches the database has to be erased from every backup of it"
    );
}

/// The centre's copy of a split sale, and what a resend does to it.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_centre_keeps_both_halves_and_a_resend_does_not_double_them(pool: PgPool) {
    let sale_id = Uuid::new_v4();
    let mut payload = sale_payload(sale_id, 30_000, 50_000, 20_000, 30_000);
    payload["tenders"] = json!([
        {"tender_seq": 0, "method": "CARD", "amount_minor": 30_000, "reference": "BCA"},
        {"tender_seq": 1, "method": "CASH", "amount_minor": 20_000, "reference": null},
    ]);
    ingest(&pool, 1, payload.clone()).await;
    let report = cloud::apply_pending(&pool, 200)
        .await
        .unwrap_or_else(|e| panic!("apply: {e}"));
    assert!(report.blocked.is_empty(), "{:?}", report.blocked);

    // Delivery is at-least-once by design, so the same fact arrives again.
    ingest(&pool, 2, payload).await;
    let report = cloud::apply_pending(&pool, 200)
        .await
        .unwrap_or_else(|e| panic!("apply 2: {e}"));
    assert!(report.blocked.is_empty());

    let rows: Vec<(i32, String, i64)> = sqlx::query_as(
        "SELECT tender_seq, method, amount_minor FROM edge_sale_tender \
         WHERE sale_id = $1 ORDER BY tender_seq",
    )
    .bind(sale_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| panic!("tenders: {e}"));
    assert_eq!(
        rows.len(),
        2,
        "the ordinal keys the tender, so a resend overwrites rather than doubles"
    );
    assert_eq!(rows[0], (0, "CARD".into(), 30_000));
    assert_eq!(rows[1], (1, "CASH".into(), 20_000));
}

/// Tenders that do not add up to the paid figure are refused at the boundary.
///
/// The centre already re-checks a till's arithmetic rather than believing it.
/// This is the same rule applied to settlement: a sale saying 50,000 was paid
/// with 40,000 of tenders behind it is money on the books that no payment
/// accounts for — the hardest kind of difference to chase, because both numbers
/// look reasonable on their own.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn tenders_that_do_not_add_up_are_refused_not_believed(pool: PgPool) {
    let mut payload = sale_payload(Uuid::new_v4(), 30_000, 50_000, 20_000, 30_000);
    payload["tenders"] = json!([
        {"tender_seq": 0, "method": "CASH", "amount_minor": 40_000, "reference": null},
    ]);
    ingest(&pool, 1, payload).await;
    let report = cloud::apply_pending(&pool, 200)
        .await
        .unwrap_or_else(|e| panic!("apply: {e}"));
    assert_eq!(
        report.blocked.len(),
        1,
        "10,000 with no payment behind it must be refused loudly, not stored quietly"
    );
}
