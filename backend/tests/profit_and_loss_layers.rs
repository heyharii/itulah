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

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{self as cloud, LineAccount, PostingIntent, PostingLine};
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
        .find(|unit| unit.site_id == STORE)
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
