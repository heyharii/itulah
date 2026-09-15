//! The stock ledger against a real Postgres: what goods cost, and who spent it.
//!
//! The kernel's own tests prove the arithmetic and the property tests prove it
//! for queues nobody chose. Neither can see the things that only exist once
//! there is a database: the lock that stops two sales spending the same layer,
//! the trigger that refuses a closed month, the CHECK that will not let a
//! transfer name a cost layer at all, and the reconciliation between what the
//! goods cost and what the books say they cost.
//!
//! Several of these assert on a REFUSAL rather than on a result. That is the
//! point of them. A costing system that quietly short-fills, quietly consumes
//! twice, or quietly posts into a signed-off month produces numbers that all
//! look reasonable and are all wrong, and the reconciliation that finds it will
//! be a year old by the time anybody runs it.

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{
    self as cloud, LayerPriceCorrection, NewCostLayer, PostingIntent, PostingLine, StockOutflow,
    StockTransfer, SupplierReturn,
};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";

// ---------------------------------------------------------------------------
// A world small enough to read
// ---------------------------------------------------------------------------

/// A chart shaped like the client's: the ladder, then the postable leaves.
///
/// The rungs matter and are not decoration. The client's codes ARE the tree, a
/// balance rolls up by prefix, and a seed of leaves hanging off the roots would
/// pass tests a real chart fails.
async fn seed_chart(pool: &PgPool) {
    let ladder: [(&str, &str, Option<&str>); 16] = [
        ("1", "ASSET", None),
        ("101", "CURRENT ASSET", Some("1")),
        ("10112", "INVENTORY", Some("101")),
        ("1011201", "Persediaan Barang Dagang", Some("10112")),
        ("2", "LIABILITIES", None),
        ("201", "HUTANG JANGKA PENDEK", Some("2")),
        ("20120", "HUTANG DAGANG", Some("201")),
        ("2012001", "HUTANG SUPPLIER", Some("20120")),
        ("5", "BIAYA / BEBAN POKOK", None),
        ("501", "HARGA POKOK PEMBELIAN", Some("5")),
        ("50101", "HARGA POKOK PEMBELIAN", Some("501")),
        ("5010110", "HARGA POKOK PEMBELIAN", Some("50101")),
        ("8", "BEBAN  NON OPERASIONAL", None),
        ("801", "PENDAPATAN DAN (BIAYA) LAIN - LAIN", Some("8")),
        ("80101", "PENDAPATAN DAN (BIAYA) LAIN - LAIN", Some("801")),
        ("8010110", "Pendapatan (Biaya) Lain-lain", Some("80101")),
    ];
    for (code, name, parent) in ladder {
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group)
             VALUES ($1,$2,$3,true)
             ON CONFLICT (account_code) DO NOTHING",
        )
        .bind(code)
        .bind(name)
        .bind(parent)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{code}: {error}"));
    }
    // The leaves this lane posts to, at head office. Twelve characters, which
    // is what makes them postable rather than headings.
    for (code, name, parent) in [
        ("101120100100", "Persediaan Barang Dagangan HO", "1011201"),
        (
            "201200100100",
            "Hutang Suppliers Barang Dagangan HO",
            "2012001",
        ),
        ("501011000100", "Harga Pokok Pembelian HO", "5010110"),
        (
            "801011000600",
            "Kehilangan Barang atau Selisih Stock Opname HO",
            "8010110",
        ),
    ] {
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
             VALUES ($1,$2,$3,false,'dc')
             ON CONFLICT (account_code) DO NOTHING",
        )
        .bind(code)
        .bind(name)
        .bind(parent)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{code}: {error}"));
    }
}

async fn seed_article(pool: &PgPool, code: &str) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO article (id, article_code, name) VALUES ($1,$2,$3)")
        .bind(id)
        .bind(code)
        .bind(format!("Kemeja {code}"))
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("article {code}: {error}"));
    id
}

async fn map(pool: &PgPool, key: &str, code: &str) {
    cloud::set_account_mapping(
        pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: key.into(),
            site_id: "dc".into(),
            qualifier: String::new(),
            account_code: code.into(),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("map {key}: {error}"));
}

/// Everything the lane needs before it can cost anything, in one call.
async fn a_world(pool: &PgPool) -> Uuid {
    // The sites and pools come from `0002_demo_seed`: `dc` with a warehouse,
    // thirteen stores with a floor each. Seeding our own would collide with
    // them, and using theirs is the more honest test anyway — these are the
    // pool identifiers the rest of the system actually passes around.
    seed_chart(pool).await;
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
    map(pool, "inventory", "101120100100").await;
    map(pool, "trade_payable", "201200100100").await;
    map(pool, "cogs", "501011000100").await;
    map(pool, "stock_loss", "801011000600").await;
    seed_article(pool, "ART-001").await
}

fn september(day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, day).unwrap_or_else(|| panic!("bad date"))
}

/// A delivery, as Lane G will hand it over.
fn a_delivery(article: Uuid, quantity: i64, gross: i64, day: u32, reference: &str) -> NewCostLayer {
    NewCostLayer {
        article_id: article,
        quantity,
        gross_cost_minor: gross,
        discount_minor: 0,
        economic_date: september(day),
        site_id: "dc".into(),
        to_pool_id: "dc.warehouse".into(),
        receipt_id: None,
        receipt_line_id: None,
        source_reference: Some(reference.into()),
        supplier_id: None,
        source_kind: "GOODS_RECEIPT".into(),
        source_id: reference.into(),
    }
}

fn a_sale(article: Uuid, quantity: i64, day: u32, event: &str) -> StockOutflow {
    StockOutflow {
        article_id: article,
        sku_id: None,
        epc: None,
        lot_reference: None,
        quantity,
        event_kind: "SALE".into(),
        event_id: event.into(),
        from_pool_id: "dc.warehouse".into(),
        site_id: "dc".into(),
        economic_date: september(day),
        source_id: format!("SALES-{event}"),
        memo: Some("Penjualan harian".into()),
    }
}

/// Open a layer in its own transaction and commit it.
async fn receive(pool: &PgPool, request: &NewCostLayer) -> Uuid {
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let layer = cloud::cost_layer_create(&mut tx, request, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("receive: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));
    layer.layer_id
}

/// The whole company's holding of one article, from the running totals.
async fn position(pool: &PgPool, article: Uuid) -> (i64, i64) {
    let row = sqlx::query(
        "SELECT qty_after, stock_value_after_minor FROM stock_ledger_entry
          WHERE article_id = $1 ORDER BY fact_sequence DESC LIMIT 1",
    )
    .bind(article)
    .fetch_optional(pool)
    .await
    .unwrap_or_else(|error| panic!("position: {error}"));
    match row {
        Some(row) => (
            row.try_get("qty_after").unwrap_or_else(|e| panic!("{e}")),
            row.try_get("stock_value_after_minor")
                .unwrap_or_else(|e| panic!("{e}")),
        ),
        None => (0, 0),
    }
}

/// What one account has on it, straight from the lines.
async fn balance(pool: &PgPool, code: &str) -> i64 {
    sqlx::query(
        "SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::bigint AS b
           FROM journal_line WHERE account_code = $1",
    )
    .bind(code)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("balance: {error}"))
    .try_get("b")
    .unwrap_or_else(|e| panic!("{e}"))
}

// ---------------------------------------------------------------------------
// What a delivery is worth
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_receipt_brings_in_quantity_and_value_at_what_was_paid(pool: PgPool) {
    let article = a_world(&pool).await;
    receive(&pool, &a_delivery(article, 10, 1_250_000, 1, "GR-1")).await;

    assert_eq!(
        position(&pool, article).await,
        (10, 1_250_000),
        "ten pieces at 125,000 each is ten pieces and 1,250,000"
    );

    let layers = cloud::cost_layer_queue(&pool, "ART-001")
        .await
        .unwrap_or_else(|error| panic!("queue: {error}"));
    assert_eq!(layers.len(), 1);
    assert_eq!(layers[0].remaining_quantity, 10);
    assert_eq!(layers[0].remaining_value_minor, 1_250_000);
    assert_eq!(layers[0].unit_cost_minor, 125_000);

    // A receipt posts no journal, deliberately: the debit to inventory has an
    // owner already in the supplier's bill, and a second one here would put the
    // same money into the asset twice with both entries balancing.
    assert_eq!(
        balance(&pool, "101120100100").await,
        0,
        "the receipt posted an entry the supplier's bill had already posted"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_invoice_discount_makes_the_goods_cheaper_and_not_the_company_richer(pool: PgPool) {
    let article = a_world(&pool).await;
    let mut delivery = a_delivery(article, 10, 1_250_000, 1, "GR-1");
    delivery.discount_minor = 250_000;
    receive(&pool, &delivery).await;

    assert_eq!(
        position(&pool, article).await,
        (10, 1_000_000),
        "the discount came off the goods, not out of income"
    );

    // Both halves are on the record as components, so "the discount reduced
    // what the goods cost" is something a person can point at.
    let components: Vec<(String, i64)> = sqlx::query(
        "SELECT component_type, amount_minor FROM cost_layer_adjustment a
           JOIN cost_layer l ON l.layer_id = a.layer_id
          WHERE l.article_id = $1 ORDER BY component_type",
    )
    .bind(article)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("components: {error}"))
    .iter()
    .map(|row| {
        (
            row.try_get("component_type")
                .unwrap_or_else(|e| panic!("{e}")),
            row.try_get("amount_minor")
                .unwrap_or_else(|e| panic!("{e}")),
        )
    })
    .collect();
    assert_eq!(
        components,
        vec![
            ("DISCOUNT".to_string(), -250_000),
            ("PURCHASE".to_string(), 1_250_000)
        ]
    );

    // `8010110003 Potongan Pembelian` is an income account and the client's
    // periodic habit is to book discounts there. Nothing in this lane touches
    // it: doing so overstates inventory and other income by the same amount.
    let income: i64 = sqlx::query(
        "SELECT COUNT(*)::bigint AS n FROM journal_line WHERE account_code LIKE '8010110003%'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("{error}"))
    .try_get("n")
    .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(income, 0, "the discount was booked as other income");
}

// ---------------------------------------------------------------------------
// What leaves, and what it costs
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_sale_takes_the_oldest_layer_and_posts_what_it_took(pool: PgPool) {
    let article = a_world(&pool).await;
    let old = receive(&pool, &a_delivery(article, 10, 1_250_000, 1, "GR-1")).await;
    let new = receive(&pool, &a_delivery(article, 10, 1_400_000, 5, "GR-2")).await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posting = cloud::stock_ledger_consume(&mut tx, &a_sale(article, 4, 10, "S1"), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("consume: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    assert_eq!(posting.value_minor, 500_000, "four at 125,000");
    assert_eq!(posting.allocations.len(), 1);
    assert_eq!(
        posting.allocations[0].cost_layer_id,
        Some(old),
        "the sale took the newer delivery"
    );

    // Dr cost of sales, Cr inventory, both at the site of the sale.
    assert_eq!(balance(&pool, "501011000100").await, 500_000);
    assert_eq!(balance(&pool, "101120100100").await, -500_000);

    let entry = posting
        .journal_entry_id
        .unwrap_or_else(|| panic!("the sale posted no cost"));
    let kind: String = sqlx::query("SELECT source_kind FROM journal_entry WHERE entry_id = $1")
        .bind(entry)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("{error}"))
        .try_get("source_kind")
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(
        kind, "COGS_DAY",
        "the cost of a day's sales is its own kind, not the sale's"
    );

    // And the newer layer is untouched, which is the whole claim of FIFO.
    let layers = cloud::cost_layer_queue(&pool, "ART-001")
        .await
        .unwrap_or_else(|error| panic!("queue: {error}"));
    let newer = layers
        .iter()
        .find(|layer| layer.layer_id == new)
        .unwrap_or_else(|| panic!("the second delivery vanished"));
    assert_eq!(newer.remaining_quantity, 10);
    assert_eq!(newer.remaining_value_minor, 1_400_000);

    // Months later, the entry can still say which layers it spent.
    let explained = cloud::stock_ledger_explain(&pool, entry)
        .await
        .unwrap_or_else(|error| panic!("explain: {error}"));
    assert_eq!(explained.postings.len(), 1);
    assert_eq!(
        explained.postings[0].allocations[0].cost_layer_id,
        Some(old)
    );
    assert_eq!(
        explained.postings[0].allocations[0].valuation_rate_minor,
        Some(125_000)
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_transfer_between_our_own_places_costs_nothing(pool: PgPool) {
    let article = a_world(&pool).await;
    receive(&pool, &a_delivery(article, 10, 1_250_000, 1, "GR-1")).await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posting = cloud::stock_ledger_record_transfer(
        &mut tx,
        &StockTransfer {
            article_id: article,
            sku_id: None,
            epc: None,
            quantity: 6,
            event_id: "T1".into(),
            from_pool_id: "dc.warehouse".into(),
            to_pool_id: "store-01.floor".into(),
            site_id: "store-01".into(),
            economic_date: september(3),
            source_id: "ALLOT-1".into(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("transfer: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    assert_eq!(posting.value_minor, 0);
    assert!(
        posting.journal_entry_id.is_none(),
        "custody moved and the books were told it was a cost"
    );
    assert_eq!(posting.allocations[0].cost_layer_id, None);
    assert_eq!(
        position(&pool, article).await,
        (10, 1_250_000),
        "the company still holds ten pieces worth 1,250,000; they are just elsewhere"
    );
    assert_eq!(
        balance(&pool, "501011000100").await,
        0,
        "moving stock to a shop posted cost of goods sold"
    );

    // Unconsumed, so the next sale still has the whole layer to take from.
    let layers = cloud::cost_layer_queue(&pool, "ART-001")
        .await
        .unwrap_or_else(|error| panic!("queue: {error}"));
    assert_eq!(layers[0].remaining_quantity, 10);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn goods_go_back_to_the_receipt_they_came_from(pool: PgPool) {
    let article = a_world(&pool).await;
    let first = receive(&pool, &a_delivery(article, 10, 1_250_000, 1, "GR-1")).await;
    let second = receive(&pool, &a_delivery(article, 10, 1_400_000, 5, "GR-2")).await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posting = cloud::stock_ledger_return_to_supplier(
        &mut tx,
        &SupplierReturn {
            layer_id: second,
            quantity: 3,
            event_id: "CN-1".into(),
            from_pool_id: "dc.warehouse".into(),
            site_id: "dc".into(),
            economic_date: september(7),
            source_id: "CN-1".into(),
            memo: Some("Barang cacat".into()),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("return: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    // Three at 140,000, from the SECOND delivery — not the head of the queue.
    assert_eq!(posting.value_minor, 420_000);
    assert_eq!(posting.allocations[0].cost_layer_id, Some(second));

    let layers = cloud::cost_layer_queue(&pool, "ART-001")
        .await
        .unwrap_or_else(|error| panic!("queue: {error}"));
    let head = layers
        .iter()
        .find(|layer| layer.layer_id == first)
        .unwrap_or_else(|| panic!("the first delivery vanished"));
    assert_eq!(
        head.remaining_quantity, 10,
        "the return was taken off the oldest layer instead of its own"
    );

    // The debit belongs on the payable. Goods going back to a vendor are not a
    // cost of sales, whichever way the credit note eventually settles.
    assert_eq!(balance(&pool, "201200100100").await, 420_000);
    assert_eq!(balance(&pool, "501011000100").await, 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_return_bigger_than_its_own_layer_refuses_rather_than_spilling(pool: PgPool) {
    let article = a_world(&pool).await;
    let first = receive(&pool, &a_delivery(article, 4, 500_000, 1, "GR-1")).await;
    receive(&pool, &a_delivery(article, 10, 1_400_000, 5, "GR-2")).await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let refusal = cloud::stock_ledger_return_to_supplier(
        &mut tx,
        &SupplierReturn {
            layer_id: first,
            quantity: 6,
            event_id: "CN-1".into(),
            from_pool_id: "dc.warehouse".into(),
            site_id: "dc".into(),
            economic_date: september(7),
            source_id: "CN-1".into(),
            memo: None,
        },
        ACTOR,
    )
    .await;

    let message = match refusal {
        Ok(_) => panic!("six went back against a receipt that only ever held four"),
        Err(error) => error.to_string(),
    };
    // The number is the fix, so the message has to carry it.
    assert!(
        message.contains("has 4 unconsumed"),
        "the refusal should say how much that receipt has left, said: {message}"
    );
}

// ---------------------------------------------------------------------------
// A price that arrives after the goods
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_correction_on_a_half_sold_layer_lands_on_both_sides(pool: PgPool) {
    let article = a_world(&pool).await;
    let layer = receive(&pool, &a_delivery(article, 10, 1_000_000, 1, "GR-1")).await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    cloud::stock_ledger_consume(&mut tx, &a_sale(article, 4, 3, "S1"), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("consume: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    // The supplier bills 50,000 more for a line that is already 40% sold.
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posting = cloud::cost_layer_correct_price(
        &mut tx,
        &LayerPriceCorrection {
            layer_id: layer,
            amount_minor: 50_000,
            effective_date: september(9),
            reason: "Harga faktur berbeda dari surat jalan".into(),
            source_id: "DN-1".into(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("correct: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    let split: (i64, i64) = sqlx::query(
        "SELECT inventory_portion_minor, cogs_portion_minor FROM cost_layer_adjustment
          WHERE layer_id = $1 AND component_type = 'PRICE_CORRECTION'",
    )
    .bind(layer)
    .fetch_one(&pool)
    .await
    .map(|row| {
        (
            row.try_get("inventory_portion_minor")
                .unwrap_or_else(|e| panic!("{e}")),
            row.try_get("cogs_portion_minor")
                .unwrap_or_else(|e| panic!("{e}")),
        )
    })
    .unwrap_or_else(|error| panic!("split: {error}"));
    assert_eq!(split, (30_000, 20_000), "six on hand, four already sold");

    // Cost of sales carries 400,000 for the sale plus the 20,000 that belonged
    // to the pieces already gone. Inventory carries the other 30,000 — which is
    // the whole point: debiting the asset in full would strand the sold portion
    // there forever, because the pieces that would have carried it out are gone.
    assert_eq!(balance(&pool, "501011000100").await, 400_000 + 20_000);
    assert_eq!(balance(&pool, "101120100100").await, -400_000 + 30_000);
    assert_eq!(balance(&pool, "201200100100").await, -50_000);

    // Only the on-hand half reaches the stock ledger. The other half is a cost
    // of goods already sold and is not in the stock.
    assert_eq!(position(&pool, article).await, (6, 600_000 + 30_000));
    assert_eq!(posting.value_minor, 50_000);
}

/// Where the goods physically are, which is a different question from what the
/// company's queue is worth.
///
/// The per-site figure is quantity at that place times the article's
/// company-wide average rate, and it is a presentation number rather than an
/// authority: the FIFO queue is the company's, so there is no honest per-place
/// split of it. What has to be right is the QUANTITY, because that comes from
/// summing movements in and out of each place and is easy to get backwards.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn stock_is_counted_where_it_actually_sits(pool: PgPool) {
    let article = a_world(&pool).await;
    receive(&pool, &a_delivery(article, 10, 1_250_000, 1, "GR-1")).await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    cloud::stock_ledger_record_transfer(
        &mut tx,
        &StockTransfer {
            article_id: article,
            sku_id: None,
            epc: None,
            quantity: 6,
            event_id: "T1".into(),
            from_pool_id: "dc.warehouse".into(),
            to_pool_id: "store-01.floor".into(),
            site_id: "store-01".into(),
            economic_date: september(3),
            source_id: "ALLOT-1".into(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("transfer: {error}"));
    cloud::stock_ledger_consume(&mut tx, &a_sale(article, 2, 4, "S1"), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("consume: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    // Ten in, six sent to the shop, two sold out of the warehouse.
    let shop = cloud::stock_ledger_valuation_by_site(&pool, Some("store-01"), 50)
        .await
        .unwrap_or_else(|error| panic!("by site: {error}"));
    assert_eq!(shop.len(), 1);
    assert_eq!(shop[0].quantity, 6);
    assert_eq!(shop[0].value_minor, 6 * 125_000);

    let centre = cloud::stock_ledger_valuation_by_site(&pool, Some("dc"), 50)
        .await
        .unwrap_or_else(|error| panic!("by site: {error}"));
    assert_eq!(centre.len(), 1);
    assert_eq!(centre[0].quantity, 2, "ten less six sent out less two sold");

    // The company's own answer is still eight pieces: the transfer moved
    // custody and the sale is the only thing that took any away.
    let company = cloud::stock_ledger_valuation(&pool, Some("ART-001"), 10)
        .await
        .unwrap_or_else(|error| panic!("valuation: {error}"));
    assert_eq!(company[0].quantity, 8);
    assert_eq!(company[0].value_minor, 1_000_000);
    assert_eq!(company[0].average_rate_minor, 125_000);
    assert_eq!(
        company[0].quantity,
        shop[0].quantity + centre[0].quantity,
        "the places do not add up to the company"
    );
}

// ---------------------------------------------------------------------------
// The two ways to spend basis that is not there
// ---------------------------------------------------------------------------

/// One sale in its own transaction, start to finish.
///
/// Its own transaction is the whole point: the race this is here to catch only
/// exists between two of them.
async fn sell(pool: PgPool, article: Uuid, quantity: i64, event: &str) -> Result<i64, String> {
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    let posting =
        cloud::stock_ledger_consume(&mut tx, &a_sale(article, quantity, 10, event), ACTOR)
            .await
            .map_err(|error| error.to_string())?;
    tx.commit().await.map_err(|error| error.to_string())?;
    Ok(posting.value_minor)
}

/// One delivery in its own transaction, start to finish.
async fn stock_up(pool: PgPool, request: NewCostLayer) -> Result<Uuid, String> {
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    let layer = cloud::cost_layer_create(&mut tx, &request, ACTOR)
        .await
        .map_err(|error| error.to_string())?;
    tx.commit().await.map_err(|error| error.to_string())?;
    Ok(layer.layer_id)
}

/// A delivery and a sale of one article, overlapping.
///
/// This is the race row locks cannot reach. A receipt INSERTS a layer, so there
/// is no row for the two transactions to collide on — `FOR UPDATE` can only
/// lock rows that already exist. Both then read the article's running position
/// from its last stock ledger entry, and without the advisory lock both can
/// read the same one and append totals computed from a position the other has
/// already made untrue.
///
/// Stated as an invariant rather than as a reproduction, because that is what a
/// test can honestly promise here: two writers cannot be made to interleave on
/// demand, so this passing is evidence and not proof. What it does check every
/// run is the thing that would be wrong if they had — that the running totals
/// and the totals derived from the layers still say the same number.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_delivery_and_a_sale_at_the_same_moment_keep_the_running_total_honest(pool: PgPool) {
    let article = a_world(&pool).await;
    receive(&pool, &a_delivery(article, 10, 1_250_000, 1, "GR-1")).await;

    let (delivered, sold) = tokio::join!(
        stock_up(pool.clone(), a_delivery(article, 10, 1_400_000, 5, "GR-2")),
        sell(pool.clone(), article, 4, "S1")
    );
    delivered.unwrap_or_else(|error| panic!("the delivery should have landed: {error}"));
    sold.unwrap_or_else(|error| panic!("the sale should have gone through: {error}"));

    // Twenty received, four sold; 1,250,000 plus 1,400,000 less the 500,000 the
    // sale took off the head of the queue.
    assert_eq!(
        position(&pool, article).await,
        (16, 2_150_000),
        "the two writers computed their running totals from the same stale position"
    );

    // And the derived answer agrees with the running one, which is the check
    // that would have caught it months later.
    let valued = cloud::stock_ledger_valuation(&pool, Some("ART-001"), 10)
        .await
        .unwrap_or_else(|error| panic!("valuation: {error}"));
    assert_eq!(valued.len(), 1);
    assert_eq!(valued[0].quantity, 16);
    assert_eq!(valued[0].value_minor, 2_150_000);
}

/// Two sales of six against ten on hand: one of them has to lose.
///
/// What actually holds this is the `FOR UPDATE` in `read_queue`. The second
/// transaction blocks on those rows, and at READ COMMITTED its next statement
/// takes a fresh snapshot once the lock is granted — so it reads the residuals
/// after the first has committed and sees the four that are left. Worth saying
/// plainly, because the advisory lock looks like the thing making this pass and
/// is not: removing it leaves this test green. The lock earns its place against
/// a different race, in the test above.
///
/// Truly concurrent all the same. Two transactions opened and then run one after
/// the other would pass with no locking of any kind, for the same
/// snapshot-per-statement reason, and would be testing nothing.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn two_sales_racing_for_the_same_layer_do_not_both_get_it(pool: PgPool) {
    let article = a_world(&pool).await;
    receive(&pool, &a_delivery(article, 10, 1_250_000, 1, "GR-1")).await;

    let (first, second) = tokio::join!(
        sell(pool.clone(), article, 6, "S1"),
        sell(pool.clone(), article, 6, "S2")
    );

    assert_ne!(
        first.is_ok(),
        second.is_ok(),
        "exactly one of two sales of six against ten on hand may succeed; got {first:?} and \
         {second:?}"
    );
    let refusal = match (&first, &second) {
        (Err(message), _) | (_, Err(message)) => message.clone(),
        _ => unreachable!("one of them failed"),
    };
    assert!(
        refusal.contains("has 4 piece(s)"),
        "the loser should be told what is actually left, said: {refusal}"
    );

    assert_eq!(
        position(&pool, article).await,
        (4, 500_000),
        "four pieces and their money survived the race"
    );
    assert_eq!(
        balance(&pool, "501011000100").await,
        750_000,
        "cost of sales carries more than the goods that actually left"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_consumption_dated_into_a_closed_month_refuses(pool: PgPool) {
    let article = a_world(&pool).await;
    receive(&pool, &a_delivery(article, 10, 1_250_000, 1, "GR-1")).await;
    cloud::close_period(&pool, 2026, 9, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("close: {error}"));

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let refusal = cloud::stock_ledger_consume(&mut tx, &a_sale(article, 4, 10, "S1"), ACTOR).await;

    let message = match refusal {
        Ok(_) => panic!("a cost was posted into a month somebody had already signed off"),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains("2026-09") && message.contains("closed"),
        "the refusal should name the period and say it is closed, said: {message}"
    );
    drop(tx);

    assert_eq!(
        position(&pool, article).await,
        (10, 1_250_000),
        "the refused sale left the stock ledger alone"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_same_sale_delivered_twice_consumes_once(pool: PgPool) {
    let article = a_world(&pool).await;
    receive(&pool, &a_delivery(article, 10, 1_250_000, 1, "GR-1")).await;

    // Dispatch is at-least-once. Replay is the ordinary case, not an edge one.
    for _ in 0..2 {
        let mut tx = pool
            .begin()
            .await
            .unwrap_or_else(|error| panic!("begin: {error}"));
        cloud::stock_ledger_consume(&mut tx, &a_sale(article, 4, 10, "S1"), ACTOR)
            .await
            .unwrap_or_else(|error| panic!("consume: {error}"));
        tx.commit()
            .await
            .unwrap_or_else(|error| panic!("commit: {error}"));
    }

    assert_eq!(position(&pool, article).await, (6, 750_000));
    assert_eq!(
        balance(&pool, "501011000100").await,
        500_000,
        "the redelivered sale cost the company twice"
    );
}

// ---------------------------------------------------------------------------
// The two ledgers describing the same goods
// ---------------------------------------------------------------------------

/// The one thing about stock valuation that nothing else can see.
///
/// Every entry is right, every journal balances, and the two ledgers are
/// describing the same goods with different numbers. Lane E calls this.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_stock_ledger_and_the_inventory_account_agree(pool: PgPool) {
    let article = a_world(&pool).await;

    // The supplier's bill, which is what actually debits inventory. Receipts
    // post nothing, so this is the only entry putting the goods into the asset.
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    cloud::post(
        &mut tx,
        &PostingIntent {
            posting_date: september(1),
            source_kind: "SUPPLIER_INVOICE".into(),
            source_id: Some("INV-1".into()),
            rule_version: "supplier_invoice/1".into(),
            currency: "IDR".into(),
            memo: Some("Faktur pemasok".into()),
            lines: vec![
                PostingLine::debit("inventory", "dc", 1_250_000),
                PostingLine::credit("trade_payable", "dc", 1_250_000),
            ],
        },
        None,
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("bill: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    receive(&pool, &a_delivery(article, 10, 1_250_000, 1, "GR-1")).await;

    let agreed = cloud::stock_ledger_integrity(&pool, september(30))
        .await
        .unwrap_or_else(|error| panic!("integrity: {error}"));
    assert_eq!(agreed.stock_ledger_value_minor, 1_250_000);
    assert_eq!(agreed.ledger_balance_minor, 1_250_000);
    assert_eq!(agreed.difference_minor, 0, "{}", agreed.note);
    assert_eq!(agreed.control_accounts, vec!["101120100100".to_string()]);

    // A sale credits inventory and the stock ledger takes the same money out.
    // The two move together or the reconciliation is theatre.
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    cloud::stock_ledger_consume(&mut tx, &a_sale(article, 4, 10, "S1"), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("consume: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    let still = cloud::stock_ledger_integrity(&pool, september(30))
        .await
        .unwrap_or_else(|error| panic!("integrity: {error}"));
    assert_eq!(still.stock_ledger_value_minor, 750_000);
    assert_eq!(still.ledger_balance_minor, 750_000);
    assert_eq!(still.difference_minor, 0, "{}", still.note);

    // And a loss, which lands in the client's own account for exactly this.
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let mut count = a_sale(article, 1, 12, "COUNT-1");
    count.event_kind = "LOSS".into();
    count.source_id = "SO-1".into();
    cloud::stock_ledger_consume(&mut tx, &count, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("loss: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    assert_eq!(balance(&pool, "801011000600").await, 125_000);
    let after = cloud::stock_ledger_integrity(&pool, september(30))
        .await
        .unwrap_or_else(|error| panic!("integrity: {error}"));
    assert_eq!(after.difference_minor, 0, "{}", after.note);
    assert_eq!(after.stock_ledger_value_minor, 625_000);
}

/// A difference has to be reported, not smoothed over.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_bill_with_no_layer_behind_it_shows_up_as_a_difference(pool: PgPool) {
    a_world(&pool).await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    cloud::post(
        &mut tx,
        &PostingIntent {
            posting_date: september(1),
            source_kind: "SUPPLIER_INVOICE".into(),
            source_id: Some("INV-1".into()),
            rule_version: "supplier_invoice/1".into(),
            currency: "IDR".into(),
            memo: None,
            lines: vec![
                PostingLine::debit("inventory", "dc", 900_000),
                PostingLine::credit("trade_payable", "dc", 900_000),
            ],
        },
        None,
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("bill: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    let gap = cloud::stock_ledger_integrity(&pool, september(30))
        .await
        .unwrap_or_else(|error| panic!("integrity: {error}"));
    assert_eq!(gap.stock_ledger_value_minor, 0);
    assert_eq!(gap.ledger_balance_minor, 900_000);
    assert_eq!(gap.difference_minor, 900_000);
    assert!(
        gap.note.contains("no cost layer"),
        "the note should say where to look, said: {}",
        gap.note
    );
}

// ---------------------------------------------------------------------------
// What the schema refuses regardless of what this lane does
// ---------------------------------------------------------------------------

/// Reaching past the front door on purpose. If the rule only holds when you go
/// through this module, it is not a rule.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_transfer_may_not_name_a_cost_layer_even_from_raw_sql(pool: PgPool) {
    let article = a_world(&pool).await;
    let layer = receive(&pool, &a_delivery(article, 10, 1_250_000, 1, "GR-1")).await;

    let refused = sqlx::query(
        "INSERT INTO stock_ledger_entry
           (entry_id, posting_group_id, line_number, article_id, from_pool_id, to_pool_id,
            site_id, quantity, qty_delta, qty_after, cost_layer_id, valuation_rate_minor,
            stock_value_difference_minor, stock_value_after_minor, costing_method, event_kind,
            source_kind, source_id, economic_date, idempotency_key, actor)
         VALUES ($1,$2,1,$3,'dc.warehouse','store-01.floor','store-01',6,0,10,$4,125000,0,1250000,
                 'FIFO','TRANSFER','TRANSFER','ALLOT-9','2026-09-03','raw','ana')",
    )
    .bind(Uuid::new_v4())
    .bind(Uuid::new_v4())
    .bind(article)
    .bind(layer)
    .execute(&pool)
    .await;
    assert!(
        refused.is_err(),
        "raw SQL moved custody and consumed a cost layer for it"
    );
}

/// The stock ledger is append-only, like the journal it shadows.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_recorded_movement_cannot_be_edited_away(pool: PgPool) {
    let article = a_world(&pool).await;
    receive(&pool, &a_delivery(article, 10, 1_250_000, 1, "GR-1")).await;

    let edited = sqlx::query("UPDATE stock_ledger_entry SET quantity = 99 WHERE article_id = $1")
        .bind(article)
        .execute(&pool)
        .await;
    assert!(edited.is_err(), "a movement was quietly rewritten");

    let deleted = sqlx::query("DELETE FROM stock_ledger_entry WHERE article_id = $1")
        .bind(article)
        .execute(&pool)
        .await;
    assert!(deleted.is_err(), "a movement was quietly removed");
}
