//! The profit and loss reads like the client's (owner decision, 25 Sep 2026).
//!
//! The client's 2025 unit compilation, posted as balanced journals, must land
//! in the same layers the client's own report draws:
//!
//! ```text
//! Penjualan bersih                     103,676,066,725
//! Beban pokok penjualan (5002)          62,327,940,507
//! = Laba kotor                          41,348,126,218
//! Beban usaha (6xxx)                    20,384,704,875
//! = Gross operating profit              20,963,421,343
//! Beban usaha lainnya (7xxx)             9,553,489,071
//! = Net operating profit                11,409,932,272
//! Pendapatan (biaya) non operasi          -236,598,166
//! = Net profit before tax               11,173,334,106
//! Pajak penghasilan (8015)                 153,514,428
//! = Net profit after tax                11,019,819,678
//! ```
//!
//! And 8004 Potongan Pembelian is non-operating now: it moves NPBT, never the
//! gross profit.

use chrono::{DateTime, NaiveDate, Utc};
use inventory_backend::cloud::postgres::{
    self as cloud, LineAccount, NewCostLayer, PostingIntent, PostingLine,
};
use sqlx::PgPool;
use uuid::Uuid;

const ACTOR: &str = "ana";
const STORE: &str = "store-01";
const CASH: &str = "1002";

fn day() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, 15).unwrap_or_else(|| panic!("bad date"))
}

fn code(account: &str) -> LineAccount {
    LineAccount::Account {
        account_code: account.into(),
        category_code: None,
    }
}

/// One balanced entry per account: the account against cash on hand.
///
/// `amount` is signed the way the ledger reads it: positive is a debit to the
/// account (cash credited), negative a credit (cash debited).
async fn post(pool: &PgPool, account: &str, amount: i64) {
    let lines = if amount >= 0 {
        vec![
            PostingLine::debit(code(account), STORE, amount),
            PostingLine::credit(code(CASH), STORE, amount),
        ]
    } else {
        vec![
            PostingLine::debit(code(CASH), STORE, -amount),
            PostingLine::credit(code(account), STORE, -amount),
        ]
    };
    let intent = PostingIntent {
        posting_date: day(),
        source_kind: "MANUAL".into(),
        source_id: Some(Uuid::new_v4().to_string()),
        rule_version: "profit_and_loss_layers/1".into(),
        currency: "IDR".into(),
        memo: Some(format!("2025 compilation: {account}")),
        lines,
    };
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    cloud::post(&mut tx, &intent, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post {account}: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));
}

async fn section_of(pool: &PgPool, account: &str) -> String {
    sqlx::query_scalar("SELECT statement_section FROM ledger_account WHERE account_code = $1")
        .bind(account)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("section of {account}: {error}"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_chart_carries_the_clients_layers(pool: PgPool) {
    for account in [
        "7000", "7001", "7006", "7028", "7002", "7018", "7024", "7033",
    ] {
        assert_eq!(
            section_of(&pool, account).await,
            "OTHER_OPERATING_EXPENSE",
            "{account} is beban usaha lainnya"
        );
    }
    for account in ["8013", "8014", "8015"] {
        assert_eq!(section_of(&pool, account).await, "INCOME_TAX", "{account}");
    }
    assert_eq!(
        section_of(&pool, "8004").await,
        "OTHER_NET",
        "potongan pembelian"
    );
    let normal: Vec<Option<String>> = sqlx::query_scalar(
        "SELECT normal_balance::text FROM ledger_account
          WHERE account_code IN ('8003', '8008') ORDER BY account_code",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("normal balance: {error}"));
    assert_eq!(normal, vec![Some("C".to_string()), Some("C".to_string())]);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_2025_compilation_lands_in_every_layer(pool: PgPool) {
    cloud::open_period(&pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));

    // Penjualan, net of the 4011 discount group.
    post(&pool, "4002", -104_000_000_000).await;
    post(&pool, "4012", 323_933_275).await;
    // Beban pokok penjualan.
    post(&pool, "5002", 62_327_940_507).await;
    // Beban usaha: 20,384,704,875.
    post(&pool, "6012", 12_000_000_000).await;
    post(&pool, "6045", 8_384_704_875).await;
    // Beban usaha lainnya: 9,553,489,071.
    post(&pool, "7004", 5_000_000_000).await;
    post(&pool, "7018", 4_553_489_071).await;
    // Non operasi, net -236,598,166.
    post(&pool, "8002", -15_271_631).await; // bunga bank (income)
    post(&pool, "8003", -156_528).await; // selisih pembulatan (+)
    post(&pool, "8004", -7_159_999).await; // potongan pembelian (+)
    post(&pool, "8007", 127_057_487).await; // selisih stock opname (cost)
    post(&pool, "8008", 36_019_769).await; // lain-lain (-)
    post(&pool, "8011", 96_109_068).await; // bunga pinjaman bank (cost)

    // Pajak penghasilan.
    post(&pool, "8015", 153_514_428).await;

    let from = NaiveDate::from_ymd_opt(2026, 9, 1).unwrap_or_else(|| panic!("from"));
    let to = NaiveDate::from_ymd_opt(2026, 9, 30).unwrap_or_else(|| panic!("to"));
    let pl = cloud::profit_and_loss(&pool, from, to, None)
        .await
        .unwrap_or_else(|error| panic!("profit and loss: {error}"));

    assert_eq!(pl.revenue_minor, 103_676_066_725, "penjualan bersih");
    assert_eq!(
        pl.cost_of_sales_minor, 62_327_940_507,
        "beban pokok penjualan"
    );
    // Had 8004 stayed in cost of sales this would read 41,355,286,217.
    assert_eq!(pl.gross_profit_minor, 41_348_126_218, "laba kotor");
    assert_eq!(pl.operating_expenses_minor, 20_384_704_875, "beban usaha");
    assert_eq!(pl.gross_operating_profit_minor, 20_963_421_343, "GOP");
    assert_eq!(
        pl.other_operating_expenses_minor, 9_553_489_071,
        "beban usaha lainnya"
    );
    assert_eq!(pl.net_operating_profit_minor, 11_409_932_272, "NOP");
    assert_eq!(pl.non_operating_minor, -236_598_166, "non operasi");
    assert_eq!(pl.profit_before_tax_minor, 11_173_334_106, "NPBT");
    assert_eq!(pl.income_tax_minor, 153_514_428, "pajak penghasilan");
    assert_eq!(pl.net_profit_minor, 11_019_819_678, "NPAT");

    let potongan = pl
        .lines
        .iter()
        .find(|line| line.account_code == "8004")
        .unwrap_or_else(|| panic!("8004 line"));
    assert_eq!(potongan.section, "OTHER_NET");
    assert_eq!(potongan.amount_minor, 7_159_999, "credit-positive");
    assert_eq!(potongan.group_code.as_deref(), Some("8001"));
    let sewa = pl
        .lines
        .iter()
        .find(|line| line.account_code == "7004")
        .unwrap_or_else(|| panic!("7004 line"));
    assert_eq!(
        sewa.group_code.as_deref(),
        Some("7001"),
        "grouped under BIAYA SEWA"
    );

    // The unit view carries the same layers, and the consolidated is its sum.
    let units = cloud::unit_results(&pool, from, to)
        .await
        .unwrap_or_else(|error| panic!("unit results: {error}"));
    let store = units
        .iter()
        .find(|unit| unit.unit_id == STORE)
        .unwrap_or_else(|| panic!("{STORE} row"));
    assert_eq!(store.gross_profit_minor, 41_348_126_218);
    assert_eq!(store.gross_operating_profit_minor, 20_963_421_343);
    assert_eq!(store.net_operating_profit_minor, 11_409_932_272);
    assert_eq!(store.non_operating_minor, -236_598_166);
    assert_eq!(store.profit_before_tax_minor, 11_173_334_106);
    assert_eq!(store.income_tax_minor, 153_514_428);
    assert_eq!(store.net_profit_minor, 11_019_819_678);
    let consolidated: i64 = units.iter().map(|unit| unit.net_profit_minor).sum();
    assert_eq!(consolidated, pl.net_profit_minor);

    // The balance sheet's computed result counts beban usaha lainnya and tax
    // as costs, so it is NPAT and the sheet balances.
    let sheet = cloud::balance_sheet(&pool, to, None)
        .await
        .unwrap_or_else(|error| panic!("balance sheet: {error}"));
    assert_eq!(sheet.result_minor, 11_019_819_678);
    assert!(sheet.balanced, "difference {}", sheet.difference_minor);
}

// ---------------------------------------------------------------------------
// Summary Penjualan per Divisi by HPP rata-rata (the client's 7Soft report)
// ---------------------------------------------------------------------------

/// An article in a division, with one SKU.
async fn an_article(pool: &PgPool, code: &str, division: &str) -> Uuid {
    let article = Uuid::new_v4();
    sqlx::query("INSERT INTO article (id, article_code, name, division_code) VALUES ($1,$2,$3,$4)")
        .bind(article)
        .bind(code)
        .bind(format!("Kaos {code}"))
        .bind(division)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("article: {error}"));
    sqlx::query("INSERT INTO sku (id, article_id, sku_code) VALUES ($1,$2,$3)")
        .bind(Uuid::new_v4())
        .bind(article)
        .bind(format!("{code}-M"))
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("sku: {error}"));
    article
}

/// A verified receipt of `quantity` pieces at `unit` each, at the DC.
async fn a_receipt(pool: &PgPool, article: Uuid, quantity: i64, unit: i64) {
    let to_pool: String = sqlx::query_scalar(
        "SELECT id FROM operational_pool WHERE site_id = 'dc' ORDER BY id LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .unwrap_or_else(|error| panic!("pool: {error}"))
    .unwrap_or_else(|| "dc.warehouse".to_string());
    let mut tx = pool.begin().await.unwrap_or_else(|e| panic!("begin: {e}"));
    cloud::cost_layer_create(
        &mut tx,
        &NewCostLayer {
            article_id: article,
            quantity,
            gross_cost_minor: quantity * unit,
            discount_minor: 0,
            economic_date: day(),
            site_id: "dc".into(),
            to_pool_id: to_pool,
            receipt_id: None,
            receipt_line_id: None,
            source_reference: Some(format!("GRN-{}", article.simple())),
            supplier_id: None,
            source_kind: "GOODS_RECEIPT".into(),
            source_id: Uuid::new_v4().to_string(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("layer: {error}"));
    tx.commit().await.unwrap_or_else(|e| panic!("commit: {e}"));
}

/// One till sale of one line, as a shop syncs it up.
#[allow(clippy::too_many_arguments)]
async fn a_till_sale(
    pool: &PgPool,
    seq: i64,
    site: &str,
    at: &str,
    sku_code: &str,
    quantity: i64,
    unit_price: i64,
    charged: i64,
    status: &str,
) {
    let occurred_at: DateTime<Utc> = at
        .parse()
        .unwrap_or_else(|error| panic!("time {at}: {error}"));
    let sale = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO edge_sale
             (sale_id, origin_id, generation, seq, movement_group_id, site_id, actor_id,
              occurred_at, currency, total_minor, paid_minor, change_minor,
              discount_total_minor, status)
         VALUES ($1, $2, 1, $3, $4, $5, 'kasir', $6, 'IDR', $7, $7, 0, $8, $9)",
    )
    .bind(sale)
    .bind(format!("{site}-edge"))
    .bind(seq)
    .bind(Uuid::new_v4())
    .bind(site)
    .bind(occurred_at)
    .bind(charged)
    .bind(quantity * unit_price - charged)
    .bind(status)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("sale: {e}"));
    sqlx::query(
        "INSERT INTO edge_sale_line
             (sale_id, subject_id, epc, sku_code, quantity, unit_price_minor,
              line_total_minor, price_source, publication_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'BOOK', 1)",
    )
    .bind(sale)
    .bind(Uuid::new_v4())
    .bind(format!("EPC-{seq}"))
    .bind(sku_code)
    .bind(quantity)
    .bind(unit_price)
    .bind(charged)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("line: {e}"));
}

/// Divisions from the till's lines, cost at the article's average receipt
/// cost, voids on their own line, the day read in WIB, and the unit and
/// category filters narrowing all of it.
///
/// Returns are not seeded: `sale_return` hangs off a central `sale`, which
/// needs a commercial publication to exist; the returns column reads zero.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn sales_by_division_reads_like_the_7soft_summary(pool: PgPool) {
    cloud::open_period(&pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
    sqlx::query(
        "INSERT INTO division (code, label, display_order) VALUES
             ('T_WANITA', 'Divisi Wanita', 1), ('T_PRIA', 'Divisi Pria', 2)
         ON CONFLICT (code) DO NOTHING",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("divisions: {error}"));
    sqlx::query("INSERT INTO tag (code, label) VALUES ('T_KAOS', 'Kaos uji') ON CONFLICT DO NOTHING")
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("tag: {error}"));

    let blouse = an_article(&pool, "TW-001", "T_WANITA").await;
    let shirt = an_article(&pool, "TP-001", "T_PRIA").await;
    sqlx::query("INSERT INTO article_tag (article_id, tag_code) VALUES ($1, 'T_KAOS')")
        .bind(blouse)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("article tag: {error}"));
    // Two receipts at two costs: HPP rata-rata is 60,000, not either of them.
    a_receipt(&pool, blouse, 10, 50_000).await;
    a_receipt(&pool, blouse, 10, 70_000).await;
    a_receipt(&pool, shirt, 5, 30_000).await;

    // 15 Sep, mid-morning WIB. Two blouses with 20,000 off the pair.
    a_till_sale(&pool, 1, STORE, "2026-09-15T03:00:00Z", "TW-001-M", 2, 100_000, 180_000, "COMPLETED").await;
    a_till_sale(&pool, 2, STORE, "2026-09-15T03:05:00Z", "TP-001-M", 1, 80_000, 80_000, "COMPLETED").await;
    // Taken back at the till: PEMBATALAN PENJUALAN, never in a row.
    a_till_sale(&pool, 3, STORE, "2026-09-15T03:10:00Z", "TW-001-M", 1, 100_000, 100_000, "VOIDED").await;
    // Another unit's shop.
    a_till_sale(&pool, 4, "store-02", "2026-09-15T04:00:00Z", "TP-001-M", 1, 80_000, 80_000, "COMPLETED").await;
    // 1 Oct 00:30 WIB is still 30 Sep in UTC; it belongs to October.
    a_till_sale(&pool, 5, STORE, "2026-09-30T17:30:00Z", "TP-001-M", 1, 80_000, 80_000, "COMPLETED").await;

    let from = NaiveDate::from_ymd_opt(2026, 9, 1).unwrap_or_else(|| panic!("from"));
    let to = NaiveDate::from_ymd_opt(2026, 9, 30).unwrap_or_else(|| panic!("to"));

    let all = cloud::sales_by_division(&pool, from, to, None, None)
        .await
        .unwrap_or_else(|error| panic!("sales by division: {error}"));
    let row = |code: &str| {
        all.rows
            .iter()
            .find(|row| row.division_code == code)
            .unwrap_or_else(|| panic!("{code} row"))
            .clone()
    };
    let wanita = row("T_WANITA");
    assert_eq!(wanita.division_name, "Divisi Wanita");
    assert_eq!(wanita.quantity, 2);
    assert_eq!(wanita.gross_minor, 200_000);
    assert_eq!(wanita.discount_minor, 20_000);
    assert_eq!(wanita.returns_minor, 0);
    assert_eq!(wanita.net_minor, 180_000);
    assert_eq!(wanita.cost_minor, 120_000, "2 x the 60,000 average");
    let pria = row("T_PRIA");
    assert_eq!(pria.quantity, 2, "both units' shops, not October's");
    assert_eq!(pria.net_minor, 160_000);
    assert_eq!(pria.cost_minor, 60_000);
    assert_eq!(all.total.net_minor, 340_000);
    assert_eq!(all.total.cost_minor, 180_000);
    assert_eq!(all.total.quantity, 4);
    assert_eq!(all.voided.count, 1);
    assert_eq!(all.voided.gross_minor, 100_000);
    assert!(
        all.rows.iter().position(|r| r.division_code == "T_WANITA")
            < all.rows.iter().position(|r| r.division_code == "T_PRIA"),
        "rows follow the division master's order"
    );

    let one_unit = cloud::sales_by_division(&pool, from, to, Some("store-02"), None)
        .await
        .unwrap_or_else(|error| panic!("one unit: {error}"));
    assert_eq!(one_unit.rows.len(), 1);
    assert_eq!(one_unit.rows[0].division_code, "T_PRIA");
    assert_eq!(one_unit.total.net_minor, 80_000);
    assert_eq!(one_unit.voided.count, 0);

    let category = cloud::sales_by_division(&pool, from, to, None, Some("T_KAOS"))
        .await
        .unwrap_or_else(|error| panic!("one category: {error}"));
    assert_eq!(category.rows.len(), 1);
    assert_eq!(category.rows[0].division_code, "T_WANITA");
    assert_eq!(category.voided.count, 1);

    let october = cloud::sales_by_division(
        &pool,
        NaiveDate::from_ymd_opt(2026, 10, 1).unwrap_or_else(|| panic!("oct")),
        NaiveDate::from_ymd_opt(2026, 10, 31).unwrap_or_else(|| panic!("oct")),
        None,
        None,
    )
    .await
    .unwrap_or_else(|error| panic!("october: {error}"));
    assert_eq!(october.total.quantity, 1, "the 00:30 WIB sale is October's");
}

/// Tags overlap: an article under two tags is in both rows, the total counts
/// it once, the untagged row comes last, and the division filter narrows it.
/// Re-tagging is not retroactive: a sale counts under the tags its article
/// carried when it sold.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn sales_by_tag_counts_an_article_under_its_tags_of_the_day(pool: PgPool) {
    cloud::open_period(&pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
    sqlx::query(
        "INSERT INTO division (code, label, display_order) VALUES
             ('T_WANITA', 'Divisi Wanita', 1), ('T_PRIA', 'Divisi Pria', 2)
         ON CONFLICT (code) DO NOTHING",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("divisions: {error}"));
    sqlx::query(
        "INSERT INTO tag (code, label) VALUES ('T_KAOS', 'Kaos uji'), ('T_BASIC', 'Basic uji')
         ON CONFLICT DO NOTHING",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("tags: {error}"));

    let blouse = an_article(&pool, "TW-001", "T_WANITA").await;
    let shirt = an_article(&pool, "TP-001", "T_PRIA").await;
    let plain = an_article(&pool, "TX-001", "T_PRIA").await;
    sqlx::query(
        "INSERT INTO article_tag (article_id, tag_code) VALUES
             ($1, 'T_KAOS'), ($1, 'T_BASIC'), ($2, 'T_BASIC')",
    )
    .bind(blouse)
    .bind(shirt)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("article tags: {error}"));
    // Tagged after the articles were written, so the periods open now; these
    // two carried their tags all along.
    sqlx::query("UPDATE article_tag_period SET valid_from = '-infinity'")
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("backdate: {error}"));

    // The master's save replaces the list wholesale; a tag kept across it
    // keeps one open period.
    let mut tx = pool.begin().await.unwrap_or_else(|e| panic!("begin: {e}"));
    sqlx::query("DELETE FROM article_tag WHERE article_id = $1")
        .bind(shirt)
        .execute(&mut *tx)
        .await
        .unwrap_or_else(|error| panic!("delete tags: {error}"));
    sqlx::query("INSERT INTO article_tag (article_id, tag_code) VALUES ($1, 'T_BASIC')")
        .bind(shirt)
        .execute(&mut *tx)
        .await
        .unwrap_or_else(|error| panic!("put back: {error}"));
    tx.commit().await.unwrap_or_else(|e| panic!("commit: {e}"));
    let periods: Vec<(Option<DateTime<Utc>>,)> = sqlx::query_as(
        "SELECT valid_to FROM article_tag_period WHERE article_id = $1",
    )
    .bind(shirt)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("periods: {error}"));
    assert_eq!(periods, vec![(None,)], "an unchanged tag is not cut in two");

    // The plain article is filed under Kaos from 20 Sep: what it sold on the
    // 15th stays untagged, what it sold on the 25th is Kaos.
    sqlx::query("INSERT INTO article_tag (article_id, tag_code) VALUES ($1, 'T_KAOS')")
        .bind(plain)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("re-tag: {error}"));
    sqlx::query(
        "UPDATE article_tag_period SET valid_from = '2026-09-20T00:00:00Z'
          WHERE article_id = $1",
    )
    .bind(plain)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("date the re-tag: {error}"));

    a_receipt(&pool, blouse, 10, 60_000).await;
    a_receipt(&pool, shirt, 5, 30_000).await;

    a_till_sale(&pool, 1, STORE, "2026-09-15T03:00:00Z", "TW-001-M", 2, 100_000, 180_000, "COMPLETED").await;
    a_till_sale(&pool, 2, STORE, "2026-09-15T03:05:00Z", "TP-001-M", 1, 80_000, 80_000, "COMPLETED").await;
    a_till_sale(&pool, 3, STORE, "2026-09-15T03:10:00Z", "TX-001-M", 1, 50_000, 50_000, "COMPLETED").await;
    a_till_sale(&pool, 4, STORE, "2026-09-15T03:15:00Z", "TW-001-M", 1, 100_000, 100_000, "VOIDED").await;
    a_till_sale(&pool, 5, STORE, "2026-09-25T03:00:00Z", "TX-001-M", 1, 50_000, 50_000, "COMPLETED").await;

    let from = NaiveDate::from_ymd_opt(2026, 9, 1).unwrap_or_else(|| panic!("from"));
    let to = NaiveDate::from_ymd_opt(2026, 9, 30).unwrap_or_else(|| panic!("to"));

    let all = cloud::sales_breakdown(&pool, cloud::BreakdownBy::Tag, from, to, None, None)
        .await
        .unwrap_or_else(|error| panic!("sales by tag: {error}"));
    let codes: Vec<&str> = all.rows.iter().map(|row| row.code.as_str()).collect();
    assert_eq!(codes, ["T_BASIC", "T_KAOS", ""], "biggest net first, untagged last");
    let basic = &all.rows[0];
    assert_eq!(basic.name, "Basic uji");
    assert_eq!(basic.articles, 2);
    assert_eq!(basic.quantity, 3);
    assert_eq!(basic.net_minor, 260_000);
    assert_eq!(basic.cost_minor, 150_000);
    let kaos = &all.rows[1];
    assert_eq!(kaos.articles, 2);
    assert_eq!(kaos.quantity, 3);
    assert_eq!(kaos.discount_minor, 20_000);
    assert_eq!(kaos.net_minor, 230_000, "the blouse, and the plain one from the 20th");
    let untagged = &all.rows[2];
    assert_eq!(untagged.name, "Untagged");
    assert_eq!(untagged.net_minor, 50_000, "the 15 Sep sale keeps its tags of the day");
    assert_eq!(all.total.quantity, 5, "every line once, not once per tag");
    assert_eq!(all.total.net_minor, 360_000);
    assert_eq!(all.total.cost_minor, 150_000);
    assert_eq!(all.voided.count, 1);

    // The per-store table: one shop sold everything here.
    let kaos_here = all
        .cells
        .iter()
        .find(|cell| cell.code == "T_KAOS" && cell.site_id == STORE)
        .unwrap_or_else(|| panic!("Kaos at the store"));
    assert_eq!(kaos_here.quantity, 3);
    assert_eq!(kaos_here.net_minor, 230_000);
    let store_total = all
        .site_totals
        .iter()
        .find(|cell| cell.site_id == STORE)
        .unwrap_or_else(|| panic!("the store's total"));
    assert_eq!(store_total.net_minor, 360_000, "the shop's lines once");

    // A month steps by day: two trading days.
    assert_eq!(all.step, "day");
    let days: Vec<String> = all.step_totals.iter().map(|s| s.starts.to_string()).collect();
    assert_eq!(days, ["2026-09-15", "2026-09-25"]);
    assert_eq!(all.step_totals[0].net_minor, 310_000);
    let kaos_25 = all
        .steps
        .iter()
        .find(|s| s.code == "T_KAOS" && s.starts.to_string() == "2026-09-25")
        .unwrap_or_else(|| panic!("Kaos on the 25th"));
    assert_eq!(kaos_25.net_minor, 50_000);

    let pria = cloud::sales_breakdown(&pool, cloud::BreakdownBy::Tag, from, to, None, Some("T_PRIA"))
        .await
        .unwrap_or_else(|error| panic!("one division: {error}"));
    let codes: Vec<&str> = pria.rows.iter().map(|row| row.code.as_str()).collect();
    assert_eq!(codes, ["T_BASIC", "T_KAOS", ""]);
    assert_eq!(pria.total.net_minor, 180_000);
    assert_eq!(pria.voided.count, 0);

    // The same window by division and by store: partitions, so the rows add
    // up to the total.
    let divisions = cloud::sales_breakdown(&pool, cloud::BreakdownBy::Division, from, to, None, None)
        .await
        .unwrap_or_else(|error| panic!("by division: {error}"));
    // 180,000 each: a tie falls to the name.
    let codes: Vec<&str> = divisions.rows.iter().map(|row| row.code.as_str()).collect();
    assert_eq!(codes, ["T_PRIA", "T_WANITA"]);
    assert_eq!(divisions.rows.iter().map(|row| row.net_minor).sum::<i64>(), 360_000);
    let stores = cloud::sales_breakdown(&pool, cloud::BreakdownBy::Store, from, to, None, None)
        .await
        .unwrap_or_else(|error| panic!("by store: {error}"));
    let here = stores
        .rows
        .iter()
        .find(|row| row.code == STORE)
        .unwrap_or_else(|| panic!("the store's row"));
    assert_eq!(here.net_minor, 360_000);

    // By article and by SKU: identities, so partitions too.
    let articles = cloud::sales_breakdown(&pool, cloud::BreakdownBy::Article, from, to, None, None)
        .await
        .unwrap_or_else(|error| panic!("by article: {error}"));
    assert_eq!(articles.rows[0].code, "TW-001");
    assert_eq!(articles.rows_total, 3);
    assert!(articles.has_stock);
    let skus = cloud::sales_breakdown(&pool, cloud::BreakdownBy::Sku, from, to, None, None)
        .await
        .unwrap_or_else(|error| panic!("by sku: {error}"));
    assert_eq!(skus.rows[0].code, "TW-001-M");

    // These tags were not minted here, so no piece has an order: one row,
    // and nothing fails on an EPC that is not hex.
    let orders = cloud::sales_breakdown(&pool, cloud::BreakdownBy::Po, from, to, None, None)
        .await
        .unwrap_or_else(|error| panic!("by po: {error}"));
    let codes: Vec<&str> = orders.rows.iter().map(|row| row.code.as_str()).collect();
    assert_eq!(codes, [""]);
    assert_eq!(orders.rows[0].name, "No PO");

    // The blouses were paid 100,000 by debit card and 100,000 in cash with
    // 20,000 change: 180,000 splits 100,000 card and 80,000 cash. The rest
    // carry no tenders.
    let blouses: Uuid = sqlx::query_scalar("SELECT sale_id FROM edge_sale WHERE seq = 1")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("sale 1: {error}"));
    sqlx::query(
        "UPDATE edge_sale SET paid_minor = 200000, change_minor = 20000 WHERE sale_id = $1",
    )
    .bind(blouses)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("change: {error}"));
    sqlx::query(
        "INSERT INTO edge_sale_tender (sale_id, tender_seq, method, amount_minor, card_kind)
         VALUES ($1, 0, 'CARD', 100000, 'DEBIT'), ($1, 1, 'CASH', 100000, NULL)",
    )
    .bind(blouses)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("tenders: {error}"));
    let paid = cloud::sales_breakdown(&pool, cloud::BreakdownBy::Payment, from, to, None, None)
        .await
        .unwrap_or_else(|error| panic!("by payment: {error}"));
    assert!(!paid.has_stock);
    let net = |code: &str| {
        paid.rows
            .iter()
            .find(|row| row.code == code)
            .map(|row| row.net_minor)
            .unwrap_or_else(|| panic!("{code} row"))
    };
    assert_eq!(net("CARD_DEBIT"), 100_000);
    assert_eq!(net("CASH"), 80_000);
    assert_eq!(net(""), 180_000, "the three sales with no tenders");
    assert_eq!(paid.total.net_minor, 360_000);

    // No campaign touched these lines.
    let campaigns = cloud::sales_breakdown(&pool, cloud::BreakdownBy::Campaign, from, to, None, None)
        .await
        .unwrap_or_else(|error| panic!("by campaign: {error}"));
    assert_eq!(campaigns.rows.len(), 1);
    assert_eq!(campaigns.rows[0].name, "No campaign");
}

/// One article sold in two sizes on one day is costed for every piece.
///
/// The day's cost of sales used to consume per SKU while the stock ledger
/// keys a consumption on the ARTICLE, so the second size was read as a replay
/// of the first and never costed: 2 M + 3 L at 50,000 posted 100,000, not
/// 250,000. The posting now consumes once per article.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_day_costs_every_size_of_an_article(pool: PgPool) {
    cloud::open_period(&pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
    sqlx::query(
        "INSERT INTO division (code, label, display_order) VALUES ('T_WANITA', 'Divisi Wanita', 1)
         ON CONFLICT (code) DO NOTHING",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("division: {error}"));
    let blouse = an_article(&pool, "TW-002", "T_WANITA").await;
    sqlx::query("INSERT INTO sku (id, article_id, sku_code) VALUES ($1, $2, 'TW-002-L')")
        .bind(Uuid::new_v4())
        .bind(blouse)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("second sku: {error}"));
    a_receipt(&pool, blouse, 10, 50_000).await;

    a_till_sale(&pool, 1, STORE, "2026-09-15T03:00:00Z", "TW-002-M", 2, 100_000, 200_000, "COMPLETED").await;
    a_till_sale(&pool, 2, STORE, "2026-09-15T03:05:00Z", "TW-002-L", 3, 100_000, 300_000, "COMPLETED").await;

    let business_date = NaiveDate::from_ymd_opt(2026, 9, 15).unwrap_or_else(|| panic!("date"));
    let document = cloud::sales_posting_generate(
        &pool,
        &cloud::GenerateSalesPostingRequest {
            site_id: STORE.into(),
            business_date,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("generate: {error}"));
    cloud::sales_posting_post(&pool, document.posting.posting_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));

    let consumed: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(l.debit_minor), 0)::bigint
           FROM journal_entry e JOIN journal_line l USING (entry_id)
          WHERE e.memo = $1",
    )
    .bind(format!("HPP {STORE} {business_date}"))
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("cost of sales: {error}"));
    assert_eq!(consumed, 250_000, "5 pieces x 50,000, both sizes");
}
