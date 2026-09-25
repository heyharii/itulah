//! Inventory's cost postings, wired to their events (25 Sep 2026).
//!
//! The writers in `stock_ledger` existed and were tested alone; nothing called
//! them, so a count shortfall, a confirmed loss, a disposal, a supplier return
//! and a price correction never reached the general ledger. These tests exercise
//! the writers the way the events now do — through the client's own 267 chart,
//! with no fixture maps — and pin the accounting each one produces.
//!
//!   * an official count's shortfall      Dr 8007 / Cr 1029
//!   * a confirmed loss or a disposal     Dr 6011 / Cr 1029
//!   * a supplier return at a shop        shop Dr 2029 / Cr 1029 · HO Dr 2002 / Cr 1058
//!   * a price correction on a half-sold  on-hand → inventory, sold → COGS, offset
//!     layer                              through Atas Barang when the goods are in a shop
//!
//! and that none of them posts twice for the same event.

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{
    self as cloud, LayerPriceCorrection, NewCostLayer, StockOutflow, SupplierReturn,
};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
const STORE: &str = "store-01";

fn day() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, 15).unwrap_or_else(|| panic!("bad date"))
}

async fn open_september(pool: &PgPool) {
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
}

async fn a_pool(pool: &PgPool, site: &str) -> String {
    sqlx::query_scalar("SELECT id FROM operational_pool WHERE site_id = $1 ORDER BY id LIMIT 1")
        .bind(site)
        .fetch_optional(pool)
        .await
        .unwrap_or_else(|error| panic!("pool: {error}"))
        .unwrap_or_else(|| "dc.warehouse".to_string())
}

/// An article, its SKU, and a quantity subject that can carry a movement.
async fn seed(pool: &PgPool, code: &str) -> (Uuid, Uuid, Uuid) {
    let article = Uuid::new_v4();
    let sku = Uuid::new_v4();
    let subject = Uuid::new_v4();
    sqlx::query("INSERT INTO article (id, article_code, name) VALUES ($1,$2,$3)")
        .bind(article)
        .bind(code)
        .bind(format!("Kemeja {code}"))
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("article: {error}"));
    sqlx::query("INSERT INTO sku (id, article_id, sku_code) VALUES ($1,$2,$3)")
        .bind(sku)
        .bind(article)
        .bind(format!("{code}-M"))
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("sku: {error}"));
    sqlx::query(
        "INSERT INTO inventory_subject (id, subject_type, sku_id, quantity, uom)
         VALUES ($1, 'QUANTITY', $2, 1, 'PCS')",
    )
    .bind(subject)
    .bind(sku)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("subject: {error}"));
    (article, sku, subject)
}

async fn a_layer(pool: &PgPool, article: Uuid, site: &str, quantity: i64, unit: i64) -> Uuid {
    let to_pool = a_pool(pool, site).await;
    let mut tx = pool.begin().await.unwrap_or_else(|e| panic!("begin: {e}"));
    let layer = cloud::cost_layer_create(
        &mut tx,
        &NewCostLayer {
            article_id: article,
            quantity,
            gross_cost_minor: quantity * unit,
            discount_minor: 0,
            economic_date: day(),
            site_id: site.to_string(),
            to_pool_id: to_pool,
            receipt_id: None,
            receipt_line_id: None,
            source_reference: Some(format!("GRN-{code}", code = article.simple())),
            supplier_id: None,
            source_kind: "GOODS_RECEIPT".into(),
            source_id: Uuid::new_v4().to_string(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("layer: {error}"));
    tx.commit().await.unwrap_or_else(|e| panic!("commit: {e}"));
    layer.layer_id
}

/// (account_code, debit_minor, credit_minor) for one entry, in line order.
async fn lines_of(pool: &PgPool, entry: Uuid) -> Vec<(String, i64, i64)> {
    sqlx::query(
        "SELECT account_code, debit_minor, credit_minor FROM journal_line
          WHERE entry_id = $1 ORDER BY line_number",
    )
    .bind(entry)
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("lines: {error}"))
    .into_iter()
    .map(|row| {
        (
            row.get::<String, _>("account_code"),
            row.get::<i64, _>("debit_minor"),
            row.get::<i64, _>("credit_minor"),
        )
    })
    .collect()
}

async fn journal_count(pool: &PgPool, source_id: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*)::bigint FROM journal_entry WHERE source_id = $1")
        .bind(source_id)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"))
}

// ---------------------------------------------------------------------------

/// An official count's shortfall: Dr 8007 Selisih Stock Opname / Cr 1029.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_official_count_shortfall_posts_to_8007(pool: PgPool) {
    open_september(&pool).await;
    let (article, _sku, subject) = seed(&pool, "ART-CNT").await;
    a_layer(&pool, article, STORE, 10, 1_000).await;
    let from_pool = a_pool(&pool, STORE).await;

    let posting = {
        let mut tx = pool.begin().await.unwrap();
        let posted = cloud::post_operational_outflow(
            &mut tx,
            "COUNT_SHORTAGE",
            subject,
            2,
            day(),
            &from_pool,
            STORE,
            "COUNT-1",
            "opname kurang 2",
            ACTOR,
        )
        .await
        .unwrap_or_else(|error| panic!("post: {error}"))
        .unwrap_or_else(|| panic!("a count shortfall is an outflow"));
        tx.commit().await.unwrap();
        posted
    };

    let entry = posting.journal_entry_id.expect("the shortfall posts");
    assert_eq!(
        lines_of(&pool, entry).await,
        vec![("8007".into(), 2_000, 0), ("1029".into(), 0, 2_000)],
        "Dr 8007 / Cr 1029 at the shop"
    );

    // The same event twice consumes once.
    let mut tx = pool.begin().await.unwrap();
    cloud::post_operational_outflow(
        &mut tx,
        "COUNT_SHORTAGE",
        subject,
        2,
        day(),
        &from_pool,
        STORE,
        "COUNT-1",
        "opname kurang 2",
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("replay: {error}"));
    tx.commit().await.unwrap();
    assert_eq!(journal_count(&pool, "COUNT-1").await, 1, "posted once");
}

/// A confirmed loss and a disposal: Dr 6011 Biaya Kerusakan Persediaan / Cr 1029.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_confirmed_loss_and_a_disposal_post_to_6011(pool: PgPool) {
    open_september(&pool).await;
    let from_pool = a_pool(&pool, STORE).await;

    for (cause, event) in [("CONFIRMED_LOST", "LOST-1"), ("DISPOSAL", "DISP-1")] {
        let (article, _sku, subject) = seed(&pool, &format!("ART-{event}")).await;
        a_layer(&pool, article, STORE, 5, 2_000).await;
        let mut tx = pool.begin().await.unwrap();
        let posting = cloud::post_operational_outflow(
            &mut tx,
            cause,
            subject,
            1,
            day(),
            &from_pool,
            STORE,
            event,
            cause,
            ACTOR,
        )
        .await
        .unwrap_or_else(|error| panic!("{cause}: {error}"))
        .unwrap_or_else(|| panic!("{cause} is an outflow"));
        tx.commit().await.unwrap();

        let entry = posting.journal_entry_id.expect("posts");
        assert_eq!(
            lines_of(&pool, entry).await,
            vec![("6011".into(), 2_000, 0), ("1029".into(), 0, 2_000)],
            "{cause}: Dr 6011 / Cr 1029"
        );
    }
}

/// A move between our own places is not an economic outflow and posts nothing.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_move_that_is_not_an_outflow_posts_nothing(pool: PgPool) {
    open_september(&pool).await;
    let (_article, _sku, subject) = seed(&pool, "ART-MOVE").await;
    let from_pool = a_pool(&pool, STORE).await;
    let mut tx = pool.begin().await.unwrap();
    let posted = cloud::post_operational_outflow(
        &mut tx,
        "NORMAL_MOVE",
        subject,
        1,
        day(),
        &from_pool,
        STORE,
        "MOVE-1",
        "pindah rak",
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("move: {error}"));
    tx.commit().await.unwrap();
    assert!(posted.is_none(), "a move costs nothing");
    assert_eq!(journal_count(&pool, "MOVE-1").await, 0);
}

/// Goods back to the supplier: the shop's debt to head office shrinks, and head
/// office's payable shrinks. Never an external payable at the shop.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_supplier_return_at_a_shop_moves_the_debt_not_a_receivable(pool: PgPool) {
    open_september(&pool).await;
    let (article, _sku, _subject) = seed(&pool, "ART-RET").await;
    let layer = a_layer(&pool, article, STORE, 10, 1_000).await;
    let from_pool = a_pool(&pool, STORE).await;

    let mut tx = pool.begin().await.unwrap();
    let posting = cloud::stock_ledger_return_to_supplier(
        &mut tx,
        &SupplierReturn {
            layer_id: layer,
            quantity: 4,
            event_id: "RET-1".into(),
            from_pool_id: from_pool,
            site_id: STORE.into(),
            economic_date: day(),
            source_id: "CN-1".into(),
            memo: Some("retur ke supplier".into()),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("return: {error}"));
    tx.commit().await.unwrap();

    let mut lines = lines_of(&pool, posting.journal_entry_id.expect("posts")).await;
    lines.sort();
    assert_eq!(
        lines,
        vec![
            ("1029".into(), 0, 4_000), // shop Cr inventory
            ("1058".into(), 0, 4_000), // head office Cr Piutang Atas Barang
            ("2002".into(), 4_000, 0), // head office Dr supplier payable
            ("2029".into(), 4_000, 0), // shop Dr Hutang Atas Barang
        ],
        "Atas Barang on both sides, and no external payable at the shop"
    );
}

/// The journal-less variant a supplier bill uses: it moves the layer and hands
/// back the split and the Atas Barang legs, and posts nothing itself, because the
/// bill it is folded into already credits the payable.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_journal_less_price_correction_posts_nothing_itself(pool: PgPool) {
    open_september(&pool).await;
    let (article, _sku, _subject) = seed(&pool, "ART-NOJ").await;
    let layer = a_layer(&pool, article, STORE, 10, 1_000).await;

    let mut tx = pool.begin().await.unwrap();
    let outcome = cloud::cost_layer_correct_price_without_journal(
        &mut tx,
        &LayerPriceCorrection {
            layer_id: layer,
            amount_minor: 2_000,
            effective_date: day(),
            reason: "selisih harga faktur".into(),
            source_id: "DN-NOJ".into(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("correct: {error}"));
    tx.commit().await.unwrap();

    assert_eq!(outcome.inventory_minor, 2_000, "all ten still on hand");
    assert_eq!(outcome.cogs_minor, 0);
    assert!(
        outcome.posting.journal_entry_id.is_none(),
        "the caller makes the journal, not this"
    );
    assert_eq!(journal_count(&pool, "DN-NOJ").await, 0, "nothing posted");
    assert_eq!(
        outcome.affiliate_lines.len(),
        2,
        "the shop's Cr 2029 and head office's Dr 1058, for the caller to include"
    );

    // And the layer really moved, so the caller's entry describes a true stock.
    let remaining: i64 = sqlx::query_scalar(
        "SELECT remaining_value_minor FROM cost_layer_remaining WHERE layer_id = $1",
    )
    .bind(layer)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("remaining: {error}"));
    assert_eq!(remaining, 12_000, "10,000 + 2,000 correction");
}

/// A price correction on a half-sold layer: the on-hand part corrects inventory,
/// the sold part is a cost of sales; both offset the payable at head office.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_price_correction_splits_between_stock_and_cost_of_sales(pool: PgPool) {
    open_september(&pool).await;
    let (article, sku, _subject) = seed(&pool, "ART-CORR").await;
    let layer = a_layer(&pool, article, STORE, 10, 1_000).await;
    let from_pool = a_pool(&pool, STORE).await;

    // Six of the ten are sold, so four remain on hand.
    {
        let mut tx = pool.begin().await.unwrap();
        cloud::stock_ledger_consume(
            &mut tx,
            &StockOutflow {
                article_id: article,
                sku_id: Some(sku),
                epc: None,
                lot_reference: None,
                quantity: 6,
                event_kind: "SALE".into(),
                event_id: "SALE-CORR".into(),
                from_pool_id: from_pool.clone(),
                site_id: STORE.into(),
                economic_date: day(),
                source_id: "SALE-CORR".into(),
                memo: None,
            },
            ACTOR,
        )
        .await
        .unwrap_or_else(|error| panic!("sell: {error}"));
        tx.commit().await.unwrap();
    }

    let mut tx = pool.begin().await.unwrap();
    let posting = cloud::cost_layer_correct_price(
        &mut tx,
        &LayerPriceCorrection {
            layer_id: layer,
            amount_minor: 2_000,
            effective_date: day(),
            reason: "harga faktur lebih tinggi".into(),
            source_id: "DN-1".into(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("correct: {error}"));
    tx.commit().await.unwrap();

    let mut lines = lines_of(&pool, posting.journal_entry_id.expect("posts")).await;
    lines.sort();
    assert_eq!(
        lines,
        vec![
            ("1029".into(), 800, 0),  // 4 of 10 on hand  → inventory
            ("1058".into(), 2_000, 0), // head office Dr Piutang Atas Barang
            ("2002".into(), 0, 2_000), // head office Cr supplier payable
            ("2029".into(), 0, 2_000), // shop Cr Hutang Atas Barang
            ("5002".into(), 1_200, 0), // 6 of 10 sold     → cost of sales
        ],
        "4/10 of a 2,000 correction to inventory (800), 6/10 to COGS (1,200)"
    );
}
