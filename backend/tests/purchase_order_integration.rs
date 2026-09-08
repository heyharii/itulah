//! Purchase orders end to end: raised centrally, counted blind at a DC,
//! verified by a second person, and only then real.
//!
//! The control this exercises is the reason receiving works the way it does.
//! A checker counts what arrived without being told what to expect — a count
//! taken while looking at the number it is supposed to produce is not
//! evidence, it is a confirmation of the paperwork. A verifier, who does know
//! the order, then accepts that number or sends it back. Only acceptance
//! makes the goods exist, and only acceptance tells the centre anything,
//! because the quantity a verifier accepted is what settles the supplier's
//! invoice.
//!
//! Nothing here is stubbed. A real order travels the real command lane, a
//! real SQLite DC applies it, real counts and verifications run against the
//! real edge, and the real receipt fact comes back through the real ingest.

use async_trait::async_trait;
use inventory_backend::cloud::domain::{BreakerPolicy, IngestBatch, IngestResponse};
use inventory_backend::cloud::postgres::{self as cloud, NewPurchaseLine, NewPurchaseOrder};
use inventory_backend::edge::{
    EdgeInventory as _, EdgeRole, NodeContext, OpenGoodsReceiptRequest, PurchaseCountRequest,
    PurchaseVerifyDecision, PurchaseVerifyRequest, SiteId, SqliteEdge, SqliteSyncStore,
    StoreInvoiceDocumentRequest,
};
use inventory_backend::sync::port::{SyncConfig, SyncTransport};
use inventory_backend::sync::{run_cycle, CycleReport};
use sqlx::PgPool;
use uuid::Uuid;

const DC_ORIGIN: &str = "dc-01-edge";
const DC_SITE: &str = "dc-01";
const KEY: &str = "dc-01-integration-sync-key-00000001";

fn distribution_centre() -> SqliteEdge {
    let site = SiteId::new(DC_SITE).unwrap_or_else(|e| panic!("site: {e}"));
    let node =
        NodeContext::new(DC_ORIGIN, EdgeRole::Dc, site).unwrap_or_else(|e| panic!("node: {e}"));
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
        command_key: Some(cloud::command_signing_key(KEY)),
    }
}

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

async fn enrol_dc(pool: &PgPool) {
    cloud::register_origin_credential(pool, DC_ORIGIN, KEY, Some("DC 01"))
        .await
        .unwrap_or_else(|e| panic!("register: {e}"));
    sqlx::query(
        "UPDATE sync_origin_credential
         SET site_id = $2, node_role = 'DC', active_generation = 1, inventory_enabled = true
         WHERE origin_id = $1",
    )
    .bind(DC_ORIGIN)
    .bind(DC_SITE)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("bind: {e}"));
}

/// Drive the real cycle in both directions until it settles, then apply.
async fn sync(edge: &SqliteEdge, pool: &PgPool) {
    let store = SqliteSyncStore::new(edge.connection());
    let transport = Cloud { pool: pool.clone() };
    for _ in 0..20 {
        let outcome = run_cycle(&store, &config(), &transport)
            .await
            .unwrap_or_else(|e| panic!("cycle: {e}"));
        if let Some(blocked) = outcome.commands_blocked {
            panic!("the DC could not apply a command: {blocked:?}");
        }
        if matches!(outcome.upstream, CycleReport::Idle) && outcome.commands_applied == 0 {
            break;
        }
    }
    let report = cloud::apply_pending(pool, 500)
        .await
        .unwrap_or_else(|e| panic!("apply: {e}"));
    assert!(report.blocked.is_empty(), "blocked: {:?}", report.blocked);
}

/// One line: ten cartons of twelve, so a hundred and twenty pieces expected.
fn order_for(site: &str) -> NewPurchaseOrder {
    NewPurchaseOrder {
        po_number: format!("PO-{}", &Uuid::new_v4().to_string()[..8]),
        supplier_id: "SUP-01".into(),
        supplier_name: Some("PT Sumber Pangan".into()),
        destination_site_id: site.into(),
        origin_kind: "DIRECT".into(),
        currency: "IDR".into(),
        notes: None,
        created_by: "buyer-1".into(),
        lines: vec![NewPurchaseLine {
            article_code: "KEMEJA-MERAH".into(),
            article_name: "Kemeja Lengan Panjang Merah".into(),
            image_url: Some("https://cdn.itulah.co.id/kemeja-merah.jpg".into()),
            division_code: Some("MENSWEAR".into()),
            tags: vec!["KEMEJA".into(), "LENGAN_PANJANG".into()],
            ordered_quantity: 120,
            unit_price_minor: 300_000,
            promised_date: None,
        }],
    }
}

/// A delivery document to count into.
///
/// Opened once per DC and reused: a lorry arrives, a document is opened, and
/// everything counted from it belongs to that document.
fn delivery(dc: &SqliteEdge) -> Uuid {
    if let Some(open) = dc
        .open_goods_receipts()
        .unwrap_or_else(|e| panic!("receipts: {e}"))
        .first()
    {
        return open.receipt_id;
    }
    dc.open_goods_receipt(OpenGoodsReceiptRequest {
        supplier_id: "SUP-01".into(),
        arrived_at: None,
        actor_id: "penerima-1".into(),
        idempotency_key: "grn-1".into(),
    })
    .unwrap_or_else(|e| panic!("open delivery: {e}"))
    .receipt_id
}

async fn line_of(pool: &PgPool, po_id: Uuid) -> Uuid {
    sqlx::query_scalar(
        "SELECT po_line_id FROM purchase_order_line
         WHERE purchase_order_id = $1 AND line_number = 1",
    )
    .bind(po_id)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|e| panic!("line: {e}"))
}

/// `(warehouse, unidentified)` — what is pickable, and what has merely been
/// accepted and is waiting to be worked out.
fn stock(edge: &SqliteEdge) -> (i64, i64) {
    let pools = edge.list_pools().unwrap_or_else(|e| panic!("pools: {e}"));
    let unidentified = pools
        .iter()
        .filter(|p| p.pool_id.contains("unidentified"))
        .map(|p| p.on_hand)
        .sum();
    let warehouse = pools
        .iter()
        .filter(|p| p.pool_id.ends_with(".warehouse"))
        .map(|p| p.on_hand)
        .sum();
    (warehouse, unidentified)
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_delivery_becomes_stock_only_when_a_second_person_accepts_the_count(pool: PgPool) {
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let (po_id, command_id, target) = cloud::create_purchase_order(&pool, &order_for(DC_SITE))
        .await
        .unwrap_or_else(|e| panic!("raise: {e}"));
    assert_eq!(target, DC_ORIGIN, "addressed to the one DC owning the site");

    // The order and the command that carried it committed together.
    let stored: Option<Uuid> = sqlx::query_scalar(
        "SELECT activation_command_id FROM purchase_order WHERE purchase_order_id = $1",
    )
    .bind(po_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("header: {e}"));
    assert_eq!(stored, Some(command_id));

    sync(&dc, &pool).await;

    // --- What the checker is given ---------------------------------------
    let work = dc
        .open_purchase_lines()
        .unwrap_or_else(|e| panic!("work list: {e}"));
    assert_eq!(work.len(), 1);
    assert_eq!(work[0].article_name, "Kemeja Lengan Panjang Merah");
    assert!(
        work[0].image_url.is_some(),
        "the checker works from a picture"
    );
    assert_eq!(
        work[0].expected_stock_units, None,
        "a checker who can see the expected number is not counting, they are confirming"
    );
    let po_line_id = work[0].po_line_id;

    // --- The count: a hundred and eighteen pieces, by hand ---------------
    let count = dc
        .count_purchase(PurchaseCountRequest {
            receipt_id: delivery(&dc),
            po_line_id,
            counted_quantity: 118,
            actor_id: "penerima-1".into(),
            idempotency_key: "count-1".into(),
        })
        .unwrap_or_else(|e| panic!("count: {e}"));
    assert_eq!(count.counted_quantity, 118);

    // Nothing exists yet. The goods are on the bay; the system holds a piece
    // of paper about them and nothing more.
    assert_eq!(stock(&dc), (0, 0));
    sync(&dc, &pool).await;
    let detail = cloud::purchase_order_status(&pool, po_id)
        .await
        .unwrap_or_else(|e| panic!("status: {e}"));
    assert_eq!(
        detail["lines"][0]["received_quantity"], 0,
        "an unverified count must not settle anything against the supplier"
    );

    // --- The counter cannot approve their own count ----------------------
    let refused = dc.verify_purchase(PurchaseVerifyRequest {
        count_id: count.count_id,
        verifier_actor_id: "penerima-1".into(),
        decision: PurchaseVerifyDecision::Accept,
        note: None,
        invoiced_price_minor: None,
        idempotency_key: "verify-self".into(),
    });
    let error = refused
        .err()
        .unwrap_or_else(|| panic!("self-approval must be refused"));
    assert!(error.to_string().contains("second person"), "{error}");
    assert_eq!(stock(&dc), (0, 0));

    // --- A second person accepts it --------------------------------------
    let verified = dc
        .verify_purchase(PurchaseVerifyRequest {
            count_id: count.count_id,
            verifier_actor_id: "supervisor-1".into(),
            decision: PurchaseVerifyDecision::Accept,
            note: None,
            invoiced_price_minor: None,
            idempotency_key: "verify-1".into(),
        })
        .unwrap_or_else(|e| panic!("verify: {e}"));
    assert_eq!(verified.counted_by, "penerima-1");
    assert_eq!(verified.verified_by, "supervisor-1");
    assert_eq!(
        verified.accepted_quantity,
        Some(118),
        "the verifier accepts the checker's number, never one of their own"
    );

    // NOW the goods exist — as a quantity of an article, unidentified. Not in
    // the warehouse: nobody has worked out what they are yet.
    let (warehouse, unidentified) = stock(&dc);
    assert_eq!(unidentified, 118, "goods land unidentified, and only there");
    assert_eq!(
        warehouse, 0,
        "they are not pickable until they have been identified and tagged"
    );

    // And they carry no SKU and no tag, because neither exists yet.
    let (subject_type, epc, sku): (String, Option<String>, Option<String>) = {
        let connection = dc.connection();
        let guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
        guard
            .query_row(
                "SELECT subject_type, epc, sku_code FROM inventory_subject
                 WHERE article_code = 'KEMEJA-MERAH'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap_or_else(|e| panic!("subject: {e}"))
    };
    assert_eq!(subject_type, "QUANTITY");
    assert_eq!(epc, None, "goods arrive untagged");
    assert_eq!(sku, None, "and unidentified");

    // --- Only now does the centre hear, and it hears both names ----------
    sync(&dc, &pool).await;
    let detail = cloud::purchase_order_status(&pool, po_id)
        .await
        .unwrap_or_else(|e| panic!("status 2: {e}"));
    assert_eq!(detail["lines"][0]["expected_stock_units"], 120);
    assert_eq!(detail["lines"][0]["received_quantity"], 118);
    assert_eq!(
        detail["lines"][0]["outstanding_stock_units"], 2,
        "a short delivery leaves the order open, it does not close it"
    );
    assert_eq!(detail["fully_received"], false);

    let (counted, approved): (String, String) = sqlx::query_as(
        "SELECT counted_by, verified_by FROM goods_receipt_line WHERE po_line_id = $1",
    )
    .bind(po_line_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("receipt: {e}"));
    assert_eq!(counted, "penerima-1");
    assert_eq!(approved, "supervisor-1");

    // Deciding twice changes nothing.
    let again = dc.verify_purchase(PurchaseVerifyRequest {
        count_id: count.count_id,
        verifier_actor_id: "supervisor-2".into(),
        decision: PurchaseVerifyDecision::Accept,
        note: None,
        invoiced_price_minor: None,
        idempotency_key: "verify-2".into(),
    });
    assert!(again.is_err(), "a count cannot be decided twice");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_recount_leaves_the_goods_where_they_were_and_says_why(pool: PgPool) {
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let (po_id, _, _) = cloud::create_purchase_order(&pool, &order_for(DC_SITE))
        .await
        .unwrap_or_else(|e| panic!("raise: {e}"));
    sync(&dc, &pool).await;
    let po_line_id = line_of(&pool, po_id).await;

    let first = dc
        .count_purchase(PurchaseCountRequest {
            receipt_id: delivery(&dc),
            po_line_id,
            counted_quantity: 60,
            actor_id: "penerima-1".into(),
            idempotency_key: "count-1".into(),
        })
        .unwrap_or_else(|e| panic!("count: {e}"));

    // A recount must say what to look at again; an unexplained bounce-back
    // just makes the same count happen twice.
    let unexplained = dc.verify_purchase(PurchaseVerifyRequest {
        count_id: first.count_id,
        verifier_actor_id: "supervisor-1".into(),
        decision: PurchaseVerifyDecision::Recount,
        note: None,
        invoiced_price_minor: None,
        idempotency_key: "recount-blank".into(),
    });
    assert!(unexplained.is_err(), "a recount needs a reason");

    let sent_back = dc
        .verify_purchase(PurchaseVerifyRequest {
            count_id: first.count_id,
            verifier_actor_id: "supervisor-1".into(),
            decision: PurchaseVerifyDecision::Recount,
            note: Some("Jauh di bawah PO — cek apakah ada karton belum dibuka".into()),
            invoiced_price_minor: None,
            idempotency_key: "recount-1".into(),
        })
        .unwrap_or_else(|e| panic!("recount: {e}"));
    assert_eq!(sent_back.decision, PurchaseVerifyDecision::Recount);
    assert_eq!(sent_back.accepted_quantity, None);
    assert_eq!(stock(&dc), (0, 0), "nothing moved");

    // A recount tells the centre nothing either.
    sync(&dc, &pool).await;
    let detail = cloud::purchase_order_status(&pool, po_id)
        .await
        .unwrap_or_else(|e| panic!("status: {e}"));
    assert_eq!(detail["lines"][0]["received_quantity"], 0);

    // The checker counts again and this time it is accepted.
    let second = dc
        .count_purchase(PurchaseCountRequest {
            receipt_id: delivery(&dc),
            po_line_id,
            counted_quantity: 120,
            actor_id: "penerima-1".into(),
            idempotency_key: "count-2".into(),
        })
        .unwrap_or_else(|e| panic!("recount: {e}"));
    dc.verify_purchase(PurchaseVerifyRequest {
        count_id: second.count_id,
        verifier_actor_id: "supervisor-1".into(),
        decision: PurchaseVerifyDecision::Accept,
        note: None,
        invoiced_price_minor: None,
        idempotency_key: "verify-2".into(),
    })
    .unwrap_or_else(|e| panic!("verify: {e}"));

    sync(&dc, &pool).await;
    let detail = cloud::purchase_order_status(&pool, po_id)
        .await
        .unwrap_or_else(|e| panic!("status 2: {e}"));
    assert_eq!(detail["lines"][0]["received_quantity"], 120);
    assert_eq!(detail["fully_received"], true);
    assert_eq!(stock(&dc), (0, 120));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_short_delivery_keeps_the_order_open_for_the_rest(pool: PgPool) {
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let (po_id, _, _) = cloud::create_purchase_order(&pool, &order_for(DC_SITE))
        .await
        .unwrap_or_else(|e| panic!("raise: {e}"));
    sync(&dc, &pool).await;
    let po_line_id = line_of(&pool, po_id).await;

    // Two deliveries against one line: 84 now, 36 later. Each is counted and
    // verified on its own, and the order simply stays open in between — no
    // one has to do anything to keep it waiting.
    for (index, (quantity, checker)) in [(84, "penerima-1"), (36, "penerima-2")]
        .into_iter()
        .enumerate()
    {
        let count = dc
            .count_purchase(PurchaseCountRequest {
                receipt_id: delivery(&dc),
                po_line_id,
                counted_quantity: quantity,
                actor_id: checker.into(),
                idempotency_key: format!("count-{index}"),
            })
            .unwrap_or_else(|e| panic!("count {index}: {e}"));
        dc.verify_purchase(PurchaseVerifyRequest {
            count_id: count.count_id,
            verifier_actor_id: "supervisor-1".into(),
            decision: PurchaseVerifyDecision::Accept,
            note: None,
            invoiced_price_minor: None,
            idempotency_key: format!("verify-{index}"),
        })
        .unwrap_or_else(|e| panic!("verify {index}: {e}"));
        sync(&dc, &pool).await;

        let detail = cloud::purchase_order_status(&pool, po_id)
            .await
            .unwrap_or_else(|e| panic!("status {index}: {e}"));
        if index == 0 {
            assert_eq!(detail["lines"][0]["received_quantity"], 84);
            assert_eq!(detail["lines"][0]["outstanding_stock_units"], 36);
            assert_eq!(detail["fully_received"], false);
        } else {
            assert_eq!(detail["lines"][0]["received_quantity"], 120);
            assert_eq!(detail["lines"][0]["outstanding_stock_units"], 0);
            assert_eq!(detail["fully_received"], true);
        }
    }

    // Both deliveries stay on record separately, not merged into a total.
    let deliveries: i64 =
        sqlx::query_scalar("SELECT count(*)::bigint FROM goods_receipt_line WHERE po_line_id = $1")
            .bind(po_line_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("receipts: {e}"));
    assert_eq!(deliveries, 2);
    assert_eq!(stock(&dc), (0, 120));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_order_for_a_site_nobody_owns_is_refused_at_the_desk(pool: PgPool) {
    enrol_dc(&pool).await;
    let error = cloud::create_purchase_order(&pool, &order_for("dc-99"))
        .await
        .err()
        .unwrap_or_else(|| panic!("an order to an unregistered site must not be raised"));
    assert!(
        error.to_string().contains("no registered DC owns site"),
        "{error}"
    );
    let orders: i64 = sqlx::query_scalar("SELECT count(*)::bigint FROM purchase_order")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("count: {e}"));
    assert_eq!(orders, 0, "a refused order leaves nothing behind");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_dc_cannot_count_against_an_order_it_was_never_given(pool: PgPool) {
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let refused = dc.count_purchase(PurchaseCountRequest {
        receipt_id: delivery(&dc),
        po_line_id: Uuid::new_v4(),
        counted_quantity: 5,
        actor_id: "penerima-1".into(),
        idempotency_key: "orphan".into(),
    });
    let error = refused
        .err()
        .unwrap_or_else(|| panic!("counting against an unknown line must fail"));
    assert!(error.to_string().contains("never given"), "{error}");
}

/// The full round trip, and the point of simplifying it: reporting a price
/// difference does NOT hold the delivery.
///
/// Quantity and price are different questions. The count was right, so the
/// goods go in; the invoice disagreed, so the buyer is asked to settle what
/// the company pays. Making the warehouse wait for that answer would leave a
/// correct delivery on the loading bay over a billing dispute, and would send
/// the verifier back a second time for something they cannot decide anyway.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn accepting_reports_a_price_difference_without_holding_the_goods(pool: PgPool) {
    use inventory_backend::cloud::domain::PriceAmendmentOutcome;

    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let (po_id, _, _) = cloud::create_purchase_order(&pool, &order_for(DC_SITE))
        .await
        .unwrap_or_else(|e| panic!("raise: {e}"));
    sync(&dc, &pool).await;
    let po_line_id = line_of(&pool, po_id).await;

    let count = dc
        .count_purchase(PurchaseCountRequest {
            receipt_id: delivery(&dc),
            po_line_id,
            counted_quantity: 120,
            actor_id: "penerima-1".into(),
            idempotency_key: "count-1".into(),
        })
        .unwrap_or_else(|e| panic!("count: {e}"));

    // The verifier sees the agreed price, reads 310.000 off the invoice that
    // came in with the lorry, and accepts anyway — reporting the gap.
    let accepted = dc
        .verify_purchase(PurchaseVerifyRequest {
            count_id: count.count_id,
            verifier_actor_id: "supervisor-1".into(),
            decision: PurchaseVerifyDecision::Accept,
            note: Some("Invoice supplier 310.000 per karton, PO 300.000".into()),
            invoiced_price_minor: Some(310_000),
            idempotency_key: "accept-1".into(),
        })
        .unwrap_or_else(|e| panic!("accept: {e}"));

    // The goods went in. One action, one visit.
    assert_eq!(accepted.accepted_quantity, Some(120));
    assert_eq!(
        stock(&dc),
        (0, 120),
        "a billing dispute does not hold goods"
    );
    let request_id = accepted
        .price_amendment_request_id
        .unwrap_or_else(|| panic!("the price gap must have been reported"));

    // --- The buyer sees the query, with both prices side by side ---------
    sync(&dc, &pool).await;
    let detail = cloud::purchase_order_status(&pool, po_id)
        .await
        .unwrap_or_else(|e| panic!("status: {e}"));
    assert_eq!(
        detail["lines"][0]["received_quantity"], 120,
        "the delivery settled while the price is still being argued"
    );

    let inbox = cloud::pending_price_amendments(&pool)
        .await
        .unwrap_or_else(|e| panic!("inbox: {e}"));
    assert_eq!(inbox["pending"], 1);
    assert_eq!(inbox["items"][0]["ordered_price_minor"], 300_000);
    assert_eq!(inbox["items"][0]["invoiced_price_minor"], 310_000);
    assert_eq!(inbox["items"][0]["difference_minor"], 10_000);

    // --- The buyer updates the price -------------------------------------
    cloud::decide_price_amendment(
        &pool,
        request_id,
        PriceAmendmentOutcome::Approved,
        "buyer-1",
        Some("Sesuai revisi harga Agustus"),
    )
    .await
    .unwrap_or_else(|e| panic!("decide: {e}"));

    let (price, amount): (i64, i64) = sqlx::query_as(
        "SELECT unit_price_minor, line_amount_minor FROM purchase_order_line
         WHERE po_line_id = $1",
    )
    .bind(po_line_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("line: {e}"));
    assert_eq!(price, 310_000);
    assert_eq!(
        amount,
        310_000 * 120,
        "a price and a total that disagree are worse than either being wrong"
    );

    // The answer reaches the DC, which now shows what came of the query.
    sync(&dc, &pool).await;
    let status: String = {
        let connection = dc.connection();
        let guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
        guard
            .query_row(
                "SELECT status FROM purchase_price_amendment WHERE request_id = ?1",
                rusqlite::params![request_id.to_string()],
                |row| row.get(0),
            )
            .unwrap_or_else(|e| panic!("amendment: {e}"))
    };
    assert_eq!(status, "APPROVED");
}

/// An invoice that agrees with the order is the ordinary case and troubles
/// nobody.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_matching_invoice_raises_no_query(pool: PgPool) {
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let (po_id, _, _) = cloud::create_purchase_order(&pool, &order_for(DC_SITE))
        .await
        .unwrap_or_else(|e| panic!("raise: {e}"));
    sync(&dc, &pool).await;
    let po_line_id = line_of(&pool, po_id).await;

    let count = dc
        .count_purchase(PurchaseCountRequest {
            receipt_id: delivery(&dc),
            po_line_id,
            counted_quantity: 120,
            actor_id: "penerima-1".into(),
            idempotency_key: "count-1".into(),
        })
        .unwrap_or_else(|e| panic!("count: {e}"));
    let accepted = dc
        .verify_purchase(PurchaseVerifyRequest {
            count_id: count.count_id,
            verifier_actor_id: "supervisor-1".into(),
            decision: PurchaseVerifyDecision::Accept,
            note: None,
            invoiced_price_minor: Some(300_000),
            idempotency_key: "accept-1".into(),
        })
        .unwrap_or_else(|e| panic!("accept: {e}"));
    assert_eq!(accepted.price_amendment_request_id, None);
    sync(&dc, &pool).await;
    assert_eq!(
        cloud::pending_price_amendments(&pool)
            .await
            .unwrap_or_else(|e| panic!("inbox: {e}"))["pending"],
        0,
        "nobody should be asked to look at a price that matches"
    );
}

/// A refusal settles nothing about the order, and is still worth keeping.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_refused_price_query_leaves_the_order_alone_but_stays_on_record(pool: PgPool) {
    use inventory_backend::cloud::domain::PriceAmendmentOutcome;

    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let (po_id, _, _) = cloud::create_purchase_order(&pool, &order_for(DC_SITE))
        .await
        .unwrap_or_else(|e| panic!("raise: {e}"));
    sync(&dc, &pool).await;
    let po_line_id = line_of(&pool, po_id).await;

    let count = dc
        .count_purchase(PurchaseCountRequest {
            receipt_id: delivery(&dc),
            po_line_id,
            counted_quantity: 120,
            actor_id: "penerima-1".into(),
            idempotency_key: "count-1".into(),
        })
        .unwrap_or_else(|e| panic!("count: {e}"));
    let asked = dc
        .verify_purchase(PurchaseVerifyRequest {
            count_id: count.count_id,
            verifier_actor_id: "supervisor-1".into(),
            decision: PurchaseVerifyDecision::Accept,
            note: Some("Invoice 400.000 — jauh di atas PO".into()),
            invoiced_price_minor: Some(400_000),
            idempotency_key: "ask-1".into(),
        })
        .unwrap_or_else(|e| panic!("accept and report: {e}"));
    let request_id = asked
        .price_amendment_request_id
        .unwrap_or_else(|| panic!("no id"));
    sync(&dc, &pool).await;

    cloud::decide_price_amendment(
        &pool,
        request_id,
        PriceAmendmentOutcome::Rejected,
        "buyer-1",
        Some("Harga PO sudah benar; tagihan supplier akan disengketakan"),
    )
    .await
    .unwrap_or_else(|e| panic!("reject: {e}"));

    // The order is untouched.
    let price: i64 = sqlx::query_scalar(
        "SELECT unit_price_minor FROM purchase_order_line WHERE po_line_id = $1",
    )
    .bind(po_line_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("price: {e}"));
    assert_eq!(price, 300_000, "a refusal changes nothing about the order");

    // But the disagreement is kept. A supplier who repeatedly overbills leaves
    // a trail here and nowhere else.
    let (status, ordered, invoiced, note): (String, i64, i64, String) = sqlx::query_as(
        "SELECT status, ordered_price_minor, invoiced_price_minor, note
         FROM purchase_price_amendment WHERE request_id = $1",
    )
    .bind(request_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("record: {e}"));
    assert_eq!(status, "REJECTED");
    assert_eq!((ordered, invoiced), (300_000, 400_000));
    assert!(note.contains("400.000"));

    // The delivery was never held in the first place.
    assert_eq!(stock(&dc), (0, 120));
}

/// The two views are different on purpose, and the difference is the control.
///
/// A checker is counting: they see the article and its picture and nothing
/// that could tell them what answer is expected. A verifier is comparing:
/// they see the count, what the order asked for, the variance between them,
/// and the agreed price — because the supplier's invoice came in on the same
/// lorry as the goods, and checking a match against a number you are not
/// allowed to see is not a check.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_checker_is_shown_nothing_to_confirm_and_the_verifier_everything_to_compare(
    pool: PgPool,
) {
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let (po_id, _, _) = cloud::create_purchase_order(&pool, &order_for(DC_SITE))
        .await
        .unwrap_or_else(|e| panic!("raise: {e}"));
    sync(&dc, &pool).await;
    let po_line_id = line_of(&pool, po_id).await;

    // --- The checker's view ----------------------------------------------
    let work = dc
        .open_purchase_lines()
        .unwrap_or_else(|e| panic!("work list: {e}"));
    assert_eq!(work[0].article_name, "Kemeja Lengan Panjang Merah");
    assert!(work[0].image_url.is_some());
    assert_eq!(
        work[0].expected_stock_units, None,
        "a checker who sees the expected number is confirming, not counting"
    );

    dc.count_purchase(PurchaseCountRequest {
        receipt_id: delivery(&dc),
        po_line_id,
        counted_quantity: 118,
        actor_id: "penerima-1".into(),
        idempotency_key: "count-1".into(),
    })
    .unwrap_or_else(|e| panic!("count: {e}"));

    // --- The verifier's view ---------------------------------------------
    let queue = dc
        .counts_awaiting_verification()
        .unwrap_or_else(|e| panic!("queue: {e}"));
    assert_eq!(queue.len(), 1);
    let waiting = &queue[0];
    assert_eq!(waiting.counted_quantity, 118);
    assert_eq!(waiting.counted_by, "penerima-1");
    assert_eq!(waiting.expected_stock_units, 120, "ten cartons of twelve");
    assert_eq!(waiting.variance, -2, "two short, worked out for them");
    assert_eq!(
        waiting.unit_price_minor,
        Some(300_000),
        "the verifier must see the agreed price to check the invoice against it"
    );

    // Accepting clears the queue: there is nothing left to decide about this
    // delivery, whatever happens to the price afterwards.
    dc.verify_purchase(PurchaseVerifyRequest {
        count_id: waiting.count_id,
        verifier_actor_id: "supervisor-1".into(),
        decision: PurchaseVerifyDecision::Accept,
        note: None,
        invoiced_price_minor: Some(310_000),
        idempotency_key: "accept-1".into(),
    })
    .unwrap_or_else(|e| panic!("accept: {e}"));
    assert!(dc
        .counts_awaiting_verification()
        .unwrap_or_else(|e| panic!("queue 2: {e}"))
        .is_empty());
}

/// The verifier keeps the invoice, and the count says which delivery it goes on.
///
/// Two things are being asserted, and they are the same thing said from two
/// ends. The page is kept on THIS node — a DC has to take a delivery with the
/// line to head office down, so the centre's file vault is not an option. And
/// the verifier's queue carries the delivery document the count hangs off,
/// because a verifier holding a piece of paper would otherwise have to guess
/// which of a supplier's open deliveries it belongs to.
///
/// A second upload replaces the first. Somebody photographs a crumpled page,
/// flattens it, and photographs it again; they meant the second one, and two
/// invoices on one delivery is a second liability the supplier never issued.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_verifier_keeps_the_invoice_against_the_delivery_the_count_names(pool: PgPool) {
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let (po_id, _, _) = cloud::create_purchase_order(&pool, &order_for(DC_SITE))
        .await
        .unwrap_or_else(|e| panic!("raise: {e}"));
    sync(&dc, &pool).await;
    let po_line_id = line_of(&pool, po_id).await;
    let receipt_id = delivery(&dc);

    dc.count_purchase(PurchaseCountRequest {
        receipt_id,
        po_line_id,
        counted_quantity: 120,
        actor_id: "penerima-1".into(),
        idempotency_key: "count-1".into(),
    })
    .unwrap_or_else(|e| panic!("count: {e}"));

    let queue = dc
        .counts_awaiting_verification()
        .unwrap_or_else(|e| panic!("queue: {e}"));
    assert_eq!(
        queue[0].receipt_id, receipt_id,
        "the verifier has to know which delivery the paper in their hand belongs to"
    );

    let stored = dc
        .store_invoice_document(StoreInvoiceDocumentRequest {
            receipt_id,
            filename: "faktur-crumpled.jpg".into(),
            content_type: "image/jpeg".into(),
            bytes: b"the crumpled page".to_vec(),
            actor_id: "supervisor-1".into(),
        })
        .unwrap_or_else(|e| panic!("upload: {e}"));
    assert_eq!(stored.byte_count, 17);
    assert_eq!(stored.uploaded_by, "supervisor-1");

    let again = dc
        .store_invoice_document(StoreInvoiceDocumentRequest {
            receipt_id,
            filename: "faktur.pdf".into(),
            content_type: "application/pdf".into(),
            bytes: b"the flat one".to_vec(),
            actor_id: "supervisor-1".into(),
        })
        .unwrap_or_else(|e| panic!("re-upload: {e}"));
    assert_eq!(again.filename, "faktur.pdf");

    let page = dc
        .invoice_document(receipt_id)
        .unwrap_or_else(|e| panic!("read back: {e}"));
    assert_eq!(page.content_type, "application/pdf");
    assert_eq!(
        page.bytes,
        b"the flat one".to_vec(),
        "the second photograph is the one they meant"
    );

    // An empty file is not a document, and a delivery nobody opened has
    // nothing to attach one to.
    assert!(dc
        .store_invoice_document(StoreInvoiceDocumentRequest {
            receipt_id,
            filename: "nothing.pdf".into(),
            content_type: "application/pdf".into(),
            bytes: Vec::new(),
            actor_id: "supervisor-1".into(),
        })
        .is_err());
    assert!(dc.invoice_document(Uuid::new_v4()).is_err());
}

/// The buyer stops waiting for a delivery that is not coming.
///
/// A hundred of three hundred arrived. The order settles at what was actually
/// received — but the shortfall is written down as a shortfall, not folded
/// into a cancellation. Cancelling says those units were never wanted;
/// closing short says they were wanted and never came, and only one of those
/// is the supplier's problem.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_buyer_can_stop_waiting_and_the_shortfall_is_recorded_as_one(pool: PgPool) {
    enrol_dc(&pool).await;
    let dc = distribution_centre();

    // Three hundred pieces.
    let mut order = order_for(DC_SITE);
    order.lines[0].ordered_quantity = 300;
    let (po_id, _, _) = cloud::create_purchase_order(&pool, &order)
        .await
        .unwrap_or_else(|e| panic!("raise: {e}"));
    sync(&dc, &pool).await;
    let po_line_id = line_of(&pool, po_id).await;

    // Only a hundred turn up, and they are counted and accepted normally.
    let count = dc
        .count_purchase(PurchaseCountRequest {
            receipt_id: delivery(&dc),
            po_line_id,
            counted_quantity: 100,
            actor_id: "penerima-1".into(),
            idempotency_key: "count-1".into(),
        })
        .unwrap_or_else(|e| panic!("count: {e}"));
    dc.verify_purchase(PurchaseVerifyRequest {
        count_id: count.count_id,
        verifier_actor_id: "supervisor-1".into(),
        decision: PurchaseVerifyDecision::Accept,
        note: None,
        invoiced_price_minor: None,
        idempotency_key: "accept-1".into(),
    })
    .unwrap_or_else(|e| panic!("accept: {e}"));
    sync(&dc, &pool).await;

    // The order waits for the other two hundred, without anyone doing
    // anything to keep it waiting.
    let detail = cloud::purchase_order_status(&pool, po_id)
        .await
        .unwrap_or_else(|e| panic!("status: {e}"));
    assert_eq!(detail["lines"][0]["expected_stock_units"], 300);
    assert_eq!(detail["lines"][0]["received_quantity"], 100);
    assert_eq!(detail["lines"][0]["outstanding_stock_units"], 200);
    assert_eq!(detail["fully_received"], false);

    // --- The buyer decides the rest is not coming ------------------------
    // It must say why: a line closed with no reason is indistinguishable
    // from one closed by accident.
    assert!(
        cloud::close_purchase_line_short(&pool, po_line_id, "buyer-1", "  ")
            .await
            .is_err(),
        "closing short must say why"
    );

    let closed = cloud::close_purchase_line_short(
        &pool,
        po_line_id,
        "buyer-1",
        "Supplier konfirmasi sisa 200 tidak akan dikirim; stok mereka habis",
    )
    .await
    .unwrap_or_else(|e| panic!("close: {e}"));
    assert_eq!(closed["received_stock_units"], 100);
    assert_eq!(closed["closed_short_units"], 200);
    assert_eq!(
        closed["order_closed"], true,
        "its only line stopped waiting"
    );

    // --- The order is settled, and honest about how ----------------------
    let detail = cloud::purchase_order_status(&pool, po_id)
        .await
        .unwrap_or_else(|e| panic!("status 2: {e}"));
    assert_eq!(
        detail["lines"][0]["outstanding_stock_units"], 0,
        "nothing is outstanding: the order has stopped waiting"
    );
    assert_eq!(detail["fully_received"], true, "settled");
    // But not pretending it arrived.
    assert_eq!(detail["lines"][0]["received_quantity"], 100);
    assert_eq!(detail["lines"][0]["closed_short_units"], 200);
    assert_eq!(detail["lines"][0]["closed_short_by"], "buyer-1");
    assert!(detail["lines"][0]["closed_short_reason"]
        .as_str()
        .unwrap_or_default()
        .contains("stok mereka habis"));
    assert_eq!(detail["order_status"], "CLOSED");

    // The goods that did arrive are untouched by any of this.
    assert_eq!(stock(&dc), (0, 100));

    // Closing twice is refused rather than silently repeated.
    assert!(
        cloud::close_purchase_line_short(&pool, po_line_id, "buyer-1", "lagi")
            .await
            .is_err()
    );
}

/// A line with nothing outstanding cannot be closed short: there is no
/// shortfall to write down, and recording one would invent a supplier failure
/// that did not happen.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_fully_received_line_cannot_be_closed_short(pool: PgPool) {
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let (po_id, _, _) = cloud::create_purchase_order(&pool, &order_for(DC_SITE))
        .await
        .unwrap_or_else(|e| panic!("raise: {e}"));
    sync(&dc, &pool).await;
    let po_line_id = line_of(&pool, po_id).await;

    let count = dc
        .count_purchase(PurchaseCountRequest {
            receipt_id: delivery(&dc),
            po_line_id,
            counted_quantity: 120,
            actor_id: "penerima-1".into(),
            idempotency_key: "count-1".into(),
        })
        .unwrap_or_else(|e| panic!("count: {e}"));
    dc.verify_purchase(PurchaseVerifyRequest {
        count_id: count.count_id,
        verifier_actor_id: "supervisor-1".into(),
        decision: PurchaseVerifyDecision::Accept,
        note: None,
        invoiced_price_minor: None,
        idempotency_key: "accept-1".into(),
    })
    .unwrap_or_else(|e| panic!("accept: {e}"));
    sync(&dc, &pool).await;

    let error = cloud::close_purchase_line_short(&pool, po_line_id, "buyer-1", "sudah lengkap")
        .await
        .err()
        .unwrap_or_else(|| panic!("a full line has no shortfall to record"));
    assert!(
        error.to_string().contains("nothing is outstanding"),
        "{error}"
    );
}
