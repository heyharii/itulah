//! Identity, end to end: from a pile of anonymous goods to individually
//! tracked units on a warehouse shelf.
//!
//! A delivery has been counted and accepted, so it exists — as "118 pieces of
//! the article we ordered" and nothing more. It cannot be picked, allotted or
//! sold, because there is nothing yet to pick BY.
//!
//! Head office resolves that: it names the article, files it under a division,
//! splits it into the colour/size variants that actually arrived, prices each
//! one, and mints their SKUs and EPCs. That travels down as a tagging job. The
//! warehouse prints the labels, attaches them, and says so. Only then does the
//! stock become individually tracked.
//!
//! Nothing here is stubbed. A real order, a real blind count, a real
//! verification, a real setup session, the real command lane, a real SQLite
//! DC, and the real fact lane back.

use async_trait::async_trait;
use inventory_backend::cloud::domain::{decode_epc, BreakerPolicy, IngestBatch, IngestResponse};
use inventory_backend::cloud::postgres::{
    self as cloud, NewPurchaseLine, NewPurchaseOrder, NewSetupColour, NewSetupSession,
    NewSetupVariant,
};
use inventory_backend::edge::{
    EdgeInventory as _, EdgeRole, NodeContext, OpenGoodsReceiptRequest, PurchaseCountRequest,
    PurchaseVerifyDecision, PurchaseVerifyRequest, SiteId, SqliteEdge, SqliteSyncStore,
    TaggingConfirmRequest,
};
use inventory_backend::sync::port::{SyncConfig, SyncTransport};
use inventory_backend::sync::{run_cycle, CycleReport};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const DC_ORIGIN: &str = "dc-01-edge";
const DC_SITE: &str = "dc-01";
const KEY: &str = "dc-01-integration-sync-key-00000001";
/// What the checker actually counted: two short of the hundred and twenty
/// ordered, which is the ordinary case and the one worth testing.
const DELIVERED: i64 = 118;
/// What the SUPPLIER calls this product. It rides along on the order so a
/// warehouse can match a carton to a line, and it never becomes an identity:
/// two suppliers will use the same string for different goods, and one
/// supplier will change theirs between shipments.
const SUPPLIER_CODE: &str = "SANDANG-KMJ-LP-01";

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

/// An order, carrying the SUPPLIER's code for the product.
///
/// That is all a purchase order knows. It tells the warehouse what to expect
/// on the loading bay and pre-fills a name and a picture for the setup form
/// later; it does not decide what the thing IS.
fn order(supplier_article_code: &str) -> NewPurchaseOrder {
    NewPurchaseOrder {
        po_number: format!("PO-{}", &Uuid::new_v4().to_string()[..8]),
        supplier_id: "SUP-01".into(),
        supplier_name: Some("PT Sandang Jaya".into()),
        destination_site_id: DC_SITE.into(),
        origin_kind: "DIRECT".into(),
        currency: "IDR".into(),
        notes: None,
        created_by: "buyer-1".into(),
        lines: vec![NewPurchaseLine {
            article_code: supplier_article_code.into(),
            article_name: "Kemeja Lengan Panjang".into(),
            image_url: Some("https://cdn.itulah.co.id/kemeja.jpg".into()),
            division_code: Some("PRIA".into()),
            tags: vec!["KEMEJA".into(), "LENGAN_PANJANG".into()],
            ordered_quantity: 120,
            unit_price_minor: 300_000,
            promised_date: None,
            unit_code: None,
            unit_quantity: None,
            order_unit_price_minor: None,
        }],
    }
}

/// `(warehouse, untagged, unidentified)`.
fn stock(edge: &SqliteEdge) -> (i64, i64, i64) {
    let pools = edge.list_pools().unwrap_or_else(|e| panic!("pools: {e}"));
    let sum = |needle: &str| -> i64 {
        pools
            .iter()
            .filter(|p| p.pool_id.contains(needle))
            .map(|p| p.on_hand)
            .sum()
    };
    (
        pools
            .iter()
            .filter(|p| p.pool_id.ends_with(".warehouse"))
            .map(|p| p.on_hand)
            .sum(),
        sum("untagged"),
        sum("unidentified"),
    )
}

/// Raise an order, deliver it, count it and have the count accepted.
/// Returns the receipt the centre now holds.
///
/// `run` distinguishes one delivery from the next: idempotency keys are the
/// edge's defence against a retried request, so reusing them across two
/// genuinely different deliveries would replay the first instead of
/// performing the second.
async fn deliver(pool: &PgPool, dc: &SqliteEdge, run: &str, article_code: &str) -> Uuid {
    let (po_id, _, _) = cloud::create_purchase_order(pool, &order(article_code))
        .await
        .unwrap_or_else(|e| panic!("raise: {e}"));
    sync(dc, pool).await;

    let po_line_id: Uuid = sqlx::query_scalar(
        "SELECT po_line_id FROM purchase_order_line WHERE purchase_order_id = $1",
    )
    .bind(po_id)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|e| panic!("line: {e}"));

    let count = dc
        .count_purchase(PurchaseCountRequest {
            receipt_id: delivery(dc),
            po_line_id,
            counted_quantity: DELIVERED,
            wrong_quantity: 0,
            counted_unit_code: None,
            counted_unit_quantity: None,
            actor_id: "checker-1".into(),
            idempotency_key: format!("count-{run}"),
        })
        .unwrap_or_else(|e| panic!("count: {e}"));
    dc.verify_purchase(PurchaseVerifyRequest {
        count_id: count.count_id,
        decision: PurchaseVerifyDecision::Accept,
        // A permitted role accepts: checker-1 counted, buyer-1 decides.
        // 118 of 120 is short, so the order stays open.
        verifier_actor_id: "buyer-1".into(),
        note: None,
        invoiced_price_minor: None,
        idempotency_key: format!("verify-{run}"),
    })
    .unwrap_or_else(|e| panic!("verify: {e}"));
    sync(dc, pool).await;

    sqlx::query_scalar("SELECT receipt_line_id FROM goods_receipt_line WHERE po_line_id = $1")
        .bind(po_line_id)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|e| panic!("receipt line: {e}"))
}

/// A delivery document to count into, opened once per DC and reused.
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

/// Head office's decision: one colourway, two sizes, 60 and 58.
///
/// `article_code` is `None` for a product new to the company — the code is
/// minted during setup — and `Some` when this delivery is more of something
/// already sold.
fn setup_for(receipt_line_id: Uuid, article_code: Option<&str>) -> NewSetupSession {
    NewSetupSession {
        receipt_line_id,
        article_code: article_code.map(str::to_string),
        article_name: "Kemeja Lengan Panjang Merah".into(),
        division_code: "PRIA".into(),
        tags: vec!["KEMEJA".into(), "LENGAN_PANJANG".into()],
        image_url: Some("https://cdn.itulah.co.id/kemeja-merah.jpg".into()),
        description: None,
        currency: "IDR".into(),
        colours: vec![NewSetupColour {
            colour_digit: "1".into(),
            colour_code: "RED".into(),
        }],
        variants: vec![
            NewSetupVariant {
                colour_digit: "1".into(),
                size_code: "03".into(),
                quantity: 60,
                base_price_minor: 450_000,
            },
            NewSetupVariant {
                colour_digit: "1".into(),
                size_code: "04".into(),
                quantity: 58,
                base_price_minor: 450_000,
            },
        ],
        created_by: "merchandiser-1".into(),
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn background_setup_replays_and_two_workers_mint_once(pool: PgPool) {
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let receipt = deliver(&pool, &dc, "background-once", SUPPLIER_CODE).await;
    let request = setup_for(receipt, None);
    let session = cloud::create_setup_session_background(&pool, &request, "background-once")
        .await
        .unwrap_or_else(|e| panic!("accept: {e}"));
    let replay = cloud::create_setup_session_background(&pool, &request, "background-once")
        .await
        .unwrap_or_else(|e| panic!("replay: {e}"));
    assert_eq!(session, replay);
    let before = cloud::setup_session_status(&pool, session)
        .await
        .unwrap_or_else(|e| panic!("status: {e}"));
    assert_eq!(before["issue_state"], "QUEUED");
    assert!(
        before["job"].is_null(),
        "accepting a setup does not wait for minting"
    );
    let (a, b) = tokio::join!(
        cloud::process_setup_issue_queue(&pool),
        cloud::process_setup_issue_queue(&pool)
    );
    assert_eq!(
        a.unwrap_or_else(|e| panic!("worker a: {e}"))
            + b.unwrap_or_else(|e| panic!("worker b: {e}")),
        1
    );
    let after = cloud::setup_session_status(&pool, session)
        .await
        .unwrap_or_else(|e| panic!("status: {e}"));
    assert_eq!(after["status"], "ISSUED");
    assert_eq!(after["issue_state"], "DONE");
    let jobs: i64 = sqlx::query_scalar("SELECT count(*) FROM tagging_job WHERE session_id=$1")
        .bind(session)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("jobs: {e}"));
    assert_eq!(jobs, 1);
    assert_eq!(
        cloud::process_setup_issue_queue(&pool)
            .await
            .unwrap_or_else(|e| panic!("idle: {e}")),
        0
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn background_setup_rolls_back_invalid_save_and_recovers_failed_work(pool: PgPool) {
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let receipt = deliver(&pool, &dc, "background-recovery", SUPPLIER_CODE).await;
    let request = setup_for(receipt, None);
    let mut short = request.clone();
    short.variants[0].quantity -= 1;
    assert!(
        cloud::create_setup_session_background(&pool, &short, "invalid-background")
            .await
            .is_err()
    );
    let saved: i64 = sqlx::query_scalar("SELECT count(*) FROM article_setup_issue_queue")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("queue: {e}"));
    assert_eq!(saved, 0);
    let session = cloud::create_setup_session_background(&pool, &request, "background-recovery")
        .await
        .unwrap_or_else(|e| panic!("accept: {e}"));
    sqlx::query("UPDATE sync_origin_credential SET inventory_enabled=false WHERE origin_id=$1")
        .bind(DC_ORIGIN)
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("disconnect: {e}"));
    for attempt in 0..3 {
        if attempt > 0 {
            // Simulate a lost worker lease as well as a scheduled retry.
            sqlx::query("UPDATE article_setup_issue_queue SET state='PROCESSING',lease_until=now()-interval '1 second' WHERE session_id=$1")
                .bind(session).execute(&pool).await.unwrap_or_else(|e| panic!("expire: {e}"));
        }
        cloud::process_setup_issue_queue(&pool)
            .await
            .unwrap_or_else(|e| panic!("failed worker: {e}"));
    }
    let failed = cloud::setup_session_status(&pool, session)
        .await
        .unwrap_or_else(|e| panic!("status: {e}"));
    assert_eq!(failed["status"], "OPEN");
    assert_eq!(failed["issue_state"], "FAILED");
    assert!(failed["job"].is_null());
    enrol_dc(&pool).await;
    cloud::enqueue_setup_issue(&pool, session, "merchandiser-1")
        .await
        .unwrap_or_else(|e| panic!("retry: {e}"));
    cloud::process_setup_issue_queue(&pool)
        .await
        .unwrap_or_else(|e| panic!("recovered worker: {e}"));
    let done = cloud::setup_session_status(&pool, session)
        .await
        .unwrap_or_else(|e| panic!("done: {e}"));
    assert_eq!(done["issue_state"], "DONE");
}

// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn anonymous_goods_become_tracked_units(pool: PgPool) {
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let receipt_id = deliver(&pool, &dc, "1", SUPPLIER_CODE).await;

    // Where we start: the goods exist, and they are nothing in particular.
    let (warehouse, untagged, unidentified) = stock(&dc);
    assert_eq!(
        (warehouse, untagged, unidentified),
        (0, 0, DELIVERED),
        "an accepted delivery is unidentified and nowhere else"
    );

    // Head office's queue shows the delivery waiting for a decision.
    let waiting = cloud::unidentified_receipts(&pool)
        .await
        .unwrap_or_else(|e| panic!("queue: {e}"));
    assert_eq!(waiting.len(), 1);
    assert_eq!(waiting[0]["quantity"], DELIVERED);
    // What the queue shows is the SUPPLIER's code, named as such. The delivery
    // has no code of ours yet — that is the whole point of it being here.
    assert_eq!(waiting[0]["supplier_article_code"], SUPPLIER_CODE);

    // --- Head office decides what it is -----------------------------------
    let session_id = cloud::create_setup_session(&pool, &setup_for(receipt_id, None))
        .await
        .unwrap_or_else(|e| panic!("setup: {e}"));
    let (job_id, _command_id) = cloud::issue_setup_session(&pool, session_id, "merchandiser-1")
        .await
        .unwrap_or_else(|e| panic!("issue: {e:?}"));

    // The article code was minted here, not taken from the order. Eight of
    // our own digits, bearing no relation to what the supplier calls it.
    let status = cloud::setup_session_status(&pool, session_id)
        .await
        .unwrap_or_else(|e| panic!("status: {e}"));
    let article = status["article_code"]
        .as_str()
        .unwrap_or_else(|| panic!("no article code on {status}"))
        .to_string();
    assert_eq!(article.len(), 8, "{article}");
    assert!(article.chars().all(|c| c.is_ascii_digit()), "{article}");
    assert_ne!(article, SUPPLIER_CODE);
    assert_eq!(status["supplier_article_code"], SUPPLIER_CODE);

    // The SKUs now exist, derived and not invented: article + colour + size.
    let skus: Vec<(String, i64)> = sqlx::query(
        "SELECT s.sku_code, s.base_price_minor FROM sku s
         JOIN article a ON a.id = s.article_id
         WHERE a.article_code = $1 ORDER BY s.sku_code",
    )
    .bind(&article)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| panic!("skus: {e}"))
    .into_iter()
    .map(|row| {
        (
            row.get("sku_code"),
            row.get::<Option<i64>, _>("base_price_minor").unwrap_or(0),
        )
    })
    .collect();
    // Colour 1, sizes 03 and 04, appended to the code we minted. Building
    // them from `article` rather than from a literal is the point: the eight
    // digits are ours, so the test cannot know them in advance either.
    let medium = format!("{article}103");
    let large = format!("{article}104");
    assert_eq!(
        skus,
        vec![(medium.clone(), 450_000), (large, 450_000)],
        "SKU is article(8) + colour(1) + size(2), and carries its base price"
    );

    // The QR is per SKU, not per unit: it says WHAT this is.
    let qr: String = sqlx::query_scalar("SELECT qr_payload FROM sku WHERE sku_code = $1")
        .bind(&medium)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("qr: {e}"));
    assert_eq!(qr, format!("R1:{medium}"));

    // --- The job travels down ---------------------------------------------
    sync(&dc, &pool).await;

    // The goods stopped being unidentified the moment head office settled
    // what they are. They have not moved an inch; the system has learned
    // something.
    let (warehouse, untagged, unidentified) = stock(&dc);
    assert_eq!(
        (warehouse, untagged, unidentified),
        (0, DELIVERED, 0),
        "identity assigned means untagged, not tagged and not still unknown"
    );

    let jobs = dc
        .open_tagging_jobs()
        .unwrap_or_else(|e| panic!("jobs: {e}"));
    assert_eq!(jobs.len(), 1);
    let job = &jobs[0];
    assert_eq!(job.job_id, job_id);
    assert_eq!(job.total_quantity, DELIVERED);
    assert_eq!(job.lines.len(), 2);

    // Every label is here, finished, one per unit. The DC computed none of
    // them — and every one decodes back to the SKU on its own line.
    for line in &job.lines {
        assert_eq!(
            line.epcs.len() as i64,
            line.quantity,
            "one label per unit on {}",
            line.sku_code
        );
        for epc in &line.epcs {
            let (sku, _serial) = decode_epc(epc).unwrap_or_else(|e| panic!("{epc}: {e}"));
            assert_eq!(sku, line.sku_code);
        }
    }
    let all: std::collections::HashSet<&String> =
        job.lines.iter().flat_map(|l| l.epcs.iter()).collect();
    assert_eq!(
        all.len(),
        DELIVERED as usize,
        "no two garments may share an identity"
    );

    // --- The warehouse tags them ------------------------------------------
    let done = dc
        .confirm_tagging(TaggingConfirmRequest {
            job_id,
            actor_id: "petugas-tag".into(),
            idempotency_key: "tag-1".into(),
        })
        .unwrap_or_else(|e| panic!("confirm: {e}"));
    assert_eq!(done.tagged_units, DELIVERED);

    let (warehouse, untagged, unidentified) = stock(&dc);
    assert_eq!(
        (warehouse, untagged, unidentified),
        (DELIVERED, 0, 0),
        "tagged goods are pickable stock"
    );

    // And they are now individually tracked, not a count.
    let units: i64 = {
        let connection = dc.connection();
        let guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
        guard
            .query_row(
                "SELECT count(*) FROM inventory_subject WHERE subject_type = 'UNIT'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|e| panic!("units: {e}"))
    };
    assert_eq!(units, DELIVERED, "one tracked unit per garment");

    // --- The centre hears -------------------------------------------------
    sync(&dc, &pool).await;
    let status = cloud::setup_session_status(&pool, session_id)
        .await
        .unwrap_or_else(|e| panic!("status: {e}"));
    assert_eq!(status["status"], "TAGGED");
    assert_eq!(status["job"]["status"], "TAGGED");
    assert_eq!(status["job"]["confirmed_by"], "petugas-tag");

    // The units themselves arrived too, on the movement facts — which is why
    // the confirmation did not need to carry them.
    let tracked: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM edge_inventory_fact_position
         WHERE origin_id = $1 AND epc IS NOT NULL",
    )
    .bind(DC_ORIGIN)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("tracked: {e}"));
    assert_eq!(tracked, DELIVERED);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn variants_that_do_not_account_for_the_delivery_are_refused(pool: PgPool) {
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let receipt_id = deliver(&pool, &dc, "1", SUPPLIER_CODE).await;

    // 60 + 50 = 110, but 118 arrived. Accepting this would strand eight
    // garments in `unidentified` with no job that will ever rescue them.
    let mut short = setup_for(receipt_id, None);
    short.variants[1].quantity = 50;
    let Err(error) = cloud::create_setup_session(&pool, &short).await else {
        panic!("a session that does not account for the delivery must be refused")
    };
    assert!(error.to_string().contains("118"), "{error}");

    // 60 + 70 = 130 would be worse: twelve garments minted from nothing.
    let mut over = setup_for(receipt_id, None);
    over.variants[1].quantity = 70;
    assert!(cloud::create_setup_session(&pool, &over).await.is_err());

    // The sound one still works, so the refusals above were about the
    // arithmetic and not about the fixture.
    assert!(
        cloud::create_setup_session(&pool, &setup_for(receipt_id, None))
            .await
            .is_ok()
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn one_delivery_cannot_be_given_two_identities(pool: PgPool) {
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let receipt_id = deliver(&pool, &dc, "1", SUPPLIER_CODE).await;

    cloud::create_setup_session(&pool, &setup_for(receipt_id, None))
        .await
        .unwrap_or_else(|e| panic!("first: {e}"));
    let Err(error) = cloud::create_setup_session(&pool, &setup_for(receipt_id, None)).await else {
        panic!("a second identity for one delivery must be refused")
    };
    assert!(error.to_string().contains("already been set up"), "{error}");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn two_deliveries_of_one_sku_never_share_a_serial(pool: PgPool) {
    // The failure this guards against is unrecoverable: two garments carrying
    // the same EPC cannot be told apart afterwards, because by then the tags
    // are on the clothes.
    enrol_dc(&pool).await;
    let dc = distribution_centre();

    let first = deliver(&pool, &dc, "1", SUPPLIER_CODE).await;
    let session_one = cloud::create_setup_session(&pool, &setup_for(first, None))
        .await
        .unwrap_or_else(|e| panic!("setup 1: {e}"));
    cloud::issue_setup_session(&pool, session_one, "merchandiser-1")
        .await
        .unwrap_or_else(|e| panic!("issue 1: {e:?}"));
    sync(&dc, &pool).await;

    let article = cloud::setup_session_status(&pool, session_one)
        .await
        .unwrap_or_else(|e| panic!("status: {e}"))["article_code"]
        .as_str()
        .unwrap_or_else(|| panic!("no article code"))
        .to_string();

    // A second delivery of the SAME article into the same warehouse. Head
    // office says so explicitly by naming the existing code — otherwise this
    // would become a second product with its own SKUs, and a repeat purchase
    // would fragment the catalogue a little more every time.
    let second = deliver(&pool, &dc, "2", SUPPLIER_CODE).await;
    let session_two = cloud::create_setup_session(&pool, &setup_for(second, Some(&article)))
        .await
        .unwrap_or_else(|e| panic!("setup 2: {e}"));
    cloud::issue_setup_session(&pool, session_two, "merchandiser-1")
        .await
        .unwrap_or_else(|e| panic!("issue 2: {e:?}"));

    // The ranges for each SKU must be adjacent, never overlapping.
    let ranges = sqlx::query(
        "SELECT sku_code, serial_from, serial_to FROM tagging_job_line
         ORDER BY sku_code, serial_from",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| panic!("ranges: {e}"));
    assert_eq!(ranges.len(), 4, "two jobs of two SKUs each");
    for pair in ranges.chunks(2) {
        let (a_sku, a_to): (String, i64) = (pair[0].get("sku_code"), pair[0].get("serial_to"));
        let (b_sku, b_from): (String, i64) = (pair[1].get("sku_code"), pair[1].get("serial_from"));
        assert_eq!(a_sku, b_sku, "chunks must pair a SKU with itself");
        assert!(
            b_from > a_to,
            "{a_sku}: second range starts at {b_from}, inside the first which ends at {a_to}"
        );
    }

    // And the counter says exactly what was issued, with nothing skipped.
    let counters: Vec<(String, i64)> = sqlx::query_as(
        "SELECT sku_code::text, last_serial FROM epc_serial_counter ORDER BY sku_code",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| panic!("counters: {e}"));
    assert_eq!(counters.len(), 2);
    assert_eq!(counters[0].1, 120, "60 from each of two deliveries");
    assert_eq!(counters[1].1, 116, "58 from each of two deliveries");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn concurrent_setup_issues_reserve_disjoint_ranges(pool: PgPool) {
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let first = deliver(&pool, &dc, "concurrent-1", SUPPLIER_CODE).await;
    let first_session = cloud::create_setup_session(&pool, &setup_for(first, None))
        .await
        .unwrap_or_else(|e| panic!("first setup: {e}"));
    cloud::issue_setup_session(&pool, first_session, "merchandiser-1")
        .await
        .unwrap_or_else(|e| panic!("first issue: {e}"));
    let article: String =
        sqlx::query_scalar("SELECT article_code FROM article_setup_session WHERE session_id = $1")
            .bind(first_session)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("article: {e}"));

    let second = deliver(&pool, &dc, "concurrent-2", SUPPLIER_CODE).await;
    let third = deliver(&pool, &dc, "concurrent-3", SUPPLIER_CODE).await;
    let second_session = cloud::create_setup_session(&pool, &setup_for(second, Some(&article)))
        .await
        .unwrap_or_else(|e| panic!("second setup: {e}"));
    let third_session = cloud::create_setup_session(&pool, &setup_for(third, Some(&article)))
        .await
        .unwrap_or_else(|e| panic!("third setup: {e}"));

    let (second_issue, third_issue) = tokio::join!(
        cloud::issue_setup_session(&pool, second_session, "merchandiser-2"),
        cloud::issue_setup_session(&pool, third_session, "merchandiser-3"),
    );
    second_issue.unwrap_or_else(|e| panic!("second issue: {e}"));
    third_issue.unwrap_or_else(|e| panic!("third issue: {e}"));

    let ranges = sqlx::query(
        "SELECT l.sku_code, array_agg(l.serial_from ORDER BY l.serial_from) AS starts,
                array_agg(l.serial_to ORDER BY l.serial_from) AS ends,
                c.last_serial
           FROM tagging_job_line l
           JOIN epc_serial_counter c USING (sku_code)
          GROUP BY l.sku_code, c.last_serial
          ORDER BY l.sku_code",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| panic!("ranges: {e}"));
    assert_eq!(ranges.len(), 2, "the article has two SKUs");
    for row in ranges {
        let sku: String = row.get("sku_code");
        let starts: Vec<i64> = row.get("starts");
        let ends: Vec<i64> = row.get("ends");
        let last_serial: i64 = row.get("last_serial");
        assert_eq!(starts.len(), 3, "{sku} should have one range per delivery");
        assert_eq!(ends.len(), starts.len());
        for index in 1..starts.len() {
            assert!(
                starts[index] > ends[index - 1],
                "{sku} ranges overlap: {starts:?} {ends:?}"
            );
        }
        assert_eq!(last_serial, *ends.last().unwrap_or(&0), "{sku} counter");
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn serial_counter_overflow_rolls_back_the_setup_issue(pool: PgPool) {
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let first = deliver(&pool, &dc, "overflow-1", SUPPLIER_CODE).await;
    let first_session = cloud::create_setup_session(&pool, &setup_for(first, None))
        .await
        .unwrap_or_else(|e| panic!("first setup: {e}"));
    cloud::issue_setup_session(&pool, first_session, "merchandiser-1")
        .await
        .unwrap_or_else(|e| panic!("first issue: {e}"));
    let article: String =
        sqlx::query_scalar("SELECT article_code FROM article_setup_session WHERE session_id = $1")
            .bind(first_session)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("article: {e}"));

    let second = deliver(&pool, &dc, "overflow-2", SUPPLIER_CODE).await;
    let second_session = cloud::create_setup_session(&pool, &setup_for(second, Some(&article)))
        .await
        .unwrap_or_else(|e| panic!("second setup: {e}"));
    let sku_03 = format!("{article}103");
    let sku_04 = format!("{article}104");
    sqlx::query(
        "UPDATE epc_serial_counter SET last_serial = $2
          WHERE rtrim(sku_code::text) = ANY($1::text[])",
    )
    .bind(vec![sku_03.clone()])
    .bind(i64::MAX - 10)
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("set counters near overflow: {e}"));
    let counters_before: Vec<(String, i64)> = sqlx::query_as(
        "SELECT rtrim(sku_code::text), last_serial FROM epc_serial_counter
          WHERE rtrim(sku_code::text) = ANY($1::text[]) ORDER BY sku_code",
    )
    .bind(vec![sku_03.clone(), sku_04.clone()])
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| panic!("read counters before issue: {e}"));
    assert_eq!(counters_before.len(), 2);
    assert_eq!(counters_before[0].0, sku_03);
    assert_eq!(counters_before[0].1, i64::MAX - 10);
    assert_eq!(counters_before[1].0, sku_04);
    assert_eq!(
        counters_before[1].1, 58,
        "the other SKU has room to advance"
    );

    let error = cloud::issue_setup_session(&pool, second_session, "merchandiser-2")
        .await
        .err()
        .unwrap_or_else(|| panic!("an overflowing counter must refuse the issue"));
    assert!(error.to_string().contains("serial counter"), "{error}");

    let counters_after: Vec<(String, i64)> = sqlx::query_as(
        "SELECT rtrim(sku_code::text), last_serial FROM epc_serial_counter
          WHERE rtrim(sku_code::text) = ANY($1::text[]) ORDER BY sku_code",
    )
    .bind(vec![sku_03, sku_04])
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| panic!("read counters: {e}"));
    assert_eq!(
        counters_after, counters_before,
        "failed issue must roll back every counter update"
    );
    let job_lines: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM tagging_job_line l
         JOIN tagging_job j USING (job_id) WHERE j.session_id = $1",
    )
    .bind(second_session)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("check rolled-back lines: {e}"));
    assert_eq!(job_lines, 0, "the rejected issue must leave no job lines");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_suppliers_own_code_never_becomes_ours(pool: PgPool) {
    // The order carries whatever the supplier calls the product. That string
    // is useful on the loading bay and useless as an identity: two suppliers
    // will use the same one for different goods, and one supplier will change
    // theirs between shipments. So the eight digits a SKU is built from are
    // minted here, and bear no relation to it.
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let receipt_id = deliver(&pool, &dc, "1", SUPPLIER_CODE).await;

    let session_id = cloud::create_setup_session(&pool, &setup_for(receipt_id, None))
        .await
        .unwrap_or_else(|e| panic!("setup: {e}"));
    let status = cloud::setup_session_status(&pool, session_id)
        .await
        .unwrap_or_else(|e| panic!("status: {e}"));

    let ours = status["article_code"]
        .as_str()
        .unwrap_or_else(|| panic!("no article code on {status}"));
    assert_eq!(ours.len(), 8, "our code is eight digits: {ours}");
    assert!(ours.chars().all(|c| c.is_ascii_digit()), "{ours}");
    assert_ne!(ours, SUPPLIER_CODE);
    // The supplier's own string survives beside it, so a buyer can still get
    // from a product back to the line it was bought on.
    assert_eq!(status["supplier_article_code"], SUPPLIER_CODE);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_delivery_cannot_be_attached_to_an_article_that_does_not_exist(pool: PgPool) {
    // Naming an unknown code would create an article whose eight digits came
    // from nowhere — exactly the hole that minting exists to close.
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let receipt_id = deliver(&pool, &dc, "1", SUPPLIER_CODE).await;

    let Err(error) =
        cloud::create_setup_session(&pool, &setup_for(receipt_id, Some("00099999"))).await
    else {
        panic!("attaching to a non-existent article must be refused")
    };
    assert!(error.to_string().contains("no article 00099999"), "{error}");

    // And a code that is not ours in SHAPE is refused before that check runs.
    let Err(error) =
        cloud::create_setup_session(&pool, &setup_for(receipt_id, Some(SUPPLIER_CODE))).await
    else {
        panic!("a supplier code must not be usable as ours")
    };
    assert!(error.to_string().contains("8 ASCII digits"), "{error}");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_article_cannot_carry_an_eleventh_colourway(pool: PgPool) {
    // The colour is one digit of the SKU string. Ten is not a soft limit that
    // gets awkward — the eleventh value does not exist. Saying so here beats
    // failing somewhere deeper with a confusing message.
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let receipt_id = deliver(&pool, &dc, "1", SUPPLIER_CODE).await;

    let mut crowded = setup_for(receipt_id, None);
    // Eleven distinct master colours, so the refusal below is the ceiling
    // talking and not a duplicate colour.
    const ELEVEN: [&str; 11] = [
        "BLACK", "CHARCOAL", "GREY", "WHITE", "NATURAL", "BEIGE", "KHAKI", "BROWN", "NAVY", "BLUE",
        "DENIM",
    ];
    crowded.colours = (0..11)
        .map(|digit| NewSetupColour {
            colour_digit: digit.to_string(),
            colour_code: ELEVEN[digit].into(),
        })
        .collect();
    let Err(error) = cloud::create_setup_session(&pool, &crowded).await else {
        panic!("an eleventh colourway must be refused")
    };
    assert!(error.to_string().contains("ten colourways"), "{error}");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_repeated_confirmation_does_not_tag_the_goods_twice(pool: PgPool) {
    enrol_dc(&pool).await;
    let dc = distribution_centre();
    let receipt_id = deliver(&pool, &dc, "1", SUPPLIER_CODE).await;
    let session_id = cloud::create_setup_session(&pool, &setup_for(receipt_id, None))
        .await
        .unwrap_or_else(|e| panic!("setup: {e}"));
    let (job_id, _) = cloud::issue_setup_session(&pool, session_id, "merchandiser-1")
        .await
        .unwrap_or_else(|e| panic!("issue: {e:?}"));
    sync(&dc, &pool).await;

    let request = TaggingConfirmRequest {
        job_id,
        actor_id: "petugas-tag".into(),
        idempotency_key: "tag-1".into(),
    };
    let first = dc
        .confirm_tagging(request.clone())
        .unwrap_or_else(|e| panic!("confirm: {e}"));
    let again = dc
        .confirm_tagging(request)
        .unwrap_or_else(|e| panic!("replay: {e}"));
    assert_eq!(first.movement_group_id, again.movement_group_id);

    let (warehouse, untagged, unidentified) = stock(&dc);
    assert_eq!(
        (warehouse, untagged, unidentified),
        (DELIVERED, 0, 0),
        "a retried confirmation must not double the stock"
    );

    // A genuinely new attempt on a finished job is a conflict, not a silent
    // second tagging run.
    let Err(error) = dc.confirm_tagging(TaggingConfirmRequest {
        job_id,
        actor_id: "petugas-tag".into(),
        idempotency_key: "tag-2".into(),
    }) else {
        panic!("a finished job cannot be confirmed again")
    };
    assert!(error.to_string().contains("already confirmed"), "{error}");
}
