//! The Finance hard rules as tests (owner decisions, 25 Sep 2026).
//!
//! These are the acceptance scenarios from the owner's brief: not "the code
//! says it", but the journal each rule produces, and the ones it refuses.
//! Every test runs against the migration chain alone, so the deliverable is the
//! migration and the poster, not a fixture.
//!
//!   1  a store cash sale stays in the shop (no inter-unit line)
//!   2  a store remits its takings to a head-office bank in two affiliate halves
//!   3  head office tops up a shop's petty cash through 1057/2028
//!   4  head office pays a shop's electricity: shop Dr expense / Cr 2028,
//!      head office Dr 1057 / Cr bank, and NO supplier payable at the shop
//!   5  goods sent to a shop cross on Atas Barang (1058/2029), never 1057/2028
//!   6  Modal Kasir (1004) cannot pay an expense — HARD REJECT
//!   7  a supplier payable (2002/2004) cannot sit at a shop — HARD REJECT
//!   8  salary, THR, medical and BPJS have four separate homes
//!   9  stock loss and damage have a route to 8007 / 6011
//!  10  closing a period does not post profit to retained earnings

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{self as cloud, PostingIntent, PostingLine};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
const STORE: &str = "store-01";
const HO: &str = "dc";

fn day() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, 15).unwrap_or_else(|| panic!("bad date"))
}

fn intent(kind: &str, lines: Vec<PostingLine>) -> PostingIntent {
    PostingIntent {
        posting_date: day(),
        source_kind: kind.into(),
        source_id: Some(Uuid::new_v4().to_string()),
        rule_version: "finance_hard_rules/1".into(),
        currency: "IDR".into(),
        memo: Some(format!("{kind} hard-rule test")),
        lines,
    }
}

async fn open_september(pool: &PgPool) {
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
}

async fn bank_account(pool: &PgPool, ledger: &str, site: &str, bank: &str, number: &str) {
    cloud::describe_account(
        pool,
        &cloud::DescribeBankAccountRequest {
            ledger_account_code: ledger.into(),
            site_id: site.into(),
            bank_code: Some(bank.into()),
            bank_name: String::new(),
            account_no: number.into(),
            account_holder: "PT Contoh".into(),
            branch: None,
            kind: "GIRO".into(),
            is_primary: Some(true),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("bank account {ledger}: {error}"));
}

async fn try_post(
    pool: &PgPool,
    kind: &str,
    lines: Vec<PostingLine>,
) -> Result<Uuid, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    match cloud::post(&mut tx, &intent(kind, lines), None, ACTOR).await {
        Ok(posted) => {
            tx.commit().await.map_err(|e| e.to_string())?;
            Ok(posted.entry_id)
        }
        Err(error) => Err(error.to_string()),
    }
}

/// (site, account_code, debit_minor, credit_minor) per line, in line order.
async fn lines_of(pool: &PgPool, entry: Uuid) -> Vec<(String, String, i64, i64)> {
    sqlx::query(
        "SELECT site_id, account_code, debit_minor, credit_minor
           FROM journal_line WHERE entry_id = $1 ORDER BY line_number",
    )
    .bind(entry)
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("lines: {error}"))
    .into_iter()
    .map(|row| {
        (
            row.get::<String, _>("site_id"),
            row.get::<String, _>("account_code"),
            row.get::<i64, _>("debit_minor"),
            row.get::<i64, _>("credit_minor"),
        )
    })
    .collect()
}

async fn accounts_of(pool: &PgPool, entry: Uuid) -> Vec<String> {
    lines_of(pool, entry)
        .await
        .into_iter()
        .map(|(_, account, _, _)| account)
        .collect()
}

fn is_affiliate(account: &str) -> bool {
    matches!(account, "1057" | "1058" | "1059" | "2028" | "2029")
}

async fn mapped(pool: &PgPool, key: &str, qualifier: &str) -> String {
    sqlx::query_scalar(
        "SELECT account_code FROM account_map
          WHERE semantic_key = $1 AND site_id = $2 AND qualifier = $3",
    )
    .bind(key)
    .bind(STORE)
    .bind(qualifier)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("{key}({qualifier}): {error}"))
}

// 1 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_store_cash_sale_stays_in_the_shop(pool: PgPool) {
    open_september(&pool).await;
    let entry = try_post(
        &pool,
        "SALE_DAY",
        vec![
            PostingLine::debit("cash", STORE, 100_000),
            PostingLine::credit("revenue_cash", STORE, 100_000),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("cash sale must post: {error}"));

    let accounts = accounts_of(&pool, entry).await;
    assert_eq!(accounts, vec!["1002", "4002"], "store Dr 1002 / Cr 4002");
    assert!(
        !accounts.iter().any(|a| is_affiliate(a)),
        "a sale inside one site creates no inter-unit balance: {accounts:?}"
    );
}

// 2 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_store_remittance_is_two_affiliate_halves(pool: PgPool) {
    open_september(&pool).await;

    // The bag leaves the shop: Dr 1057 / Cr 1002, the shop's books balanced.
    let out = try_post(
        &pool,
        "STORE_DEPOSIT",
        vec![
            PostingLine::debit("affiliate_receivable", STORE, 100_000)
                .with_qualifier("PEMBIAYAAN:dc")
                .with_counter_site(HO),
            PostingLine::credit("cash", STORE, 100_000),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("hand over must post: {error}"));
    assert_eq!(
        accounts_of(&pool, out).await,
        vec!["1057", "1002"],
        "shop: Dr 1057 Piutang Affiliasi / Cr 1002 Cash on Hand"
    );

    // The bank agrees: Dr bank / Cr 2028, head office's books balanced.
    bank_account(&pool, "1005", HO, "BCA", "8880012345").await;
    let inn = try_post(
        &pool,
        "STORE_DEPOSIT",
        vec![
            PostingLine::debit("bank_giro", HO, 100_000).with_qualifier("BCA"),
            PostingLine::credit("affiliate_payable", HO, 100_000)
                .with_qualifier("PEMBIAYAAN:store-01")
                .with_counter_site(STORE),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("confirm must post: {error}"));
    assert_eq!(
        accounts_of(&pool, inn).await,
        vec!["1005", "2028"],
        "head office: Dr Bank / Cr 2028 Hutang Affiliasi"
    );
}

// 3 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn head_office_tops_up_a_shops_petty_cash(pool: PgPool) {
    open_september(&pool).await;
    bank_account(&pool, "1005", HO, "BCA", "8880012345").await;

    let entry = try_post(
        &pool,
        "PAYMENT",
        vec![
            PostingLine::debit("petty_cash", STORE, 50_000),
            PostingLine::credit("bank_giro", HO, 50_000).with_qualifier("BCA"),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("top-up must post: {error}"));

    let lines = lines_of(&pool, entry).await;
    assert!(
        lines.contains(&(STORE.into(), "1003".into(), 50_000, 0)),
        "shop Dr 1003 Petty Cash: {lines:?}"
    );
    assert!(
        lines.contains(&(STORE.into(), "2028".into(), 0, 50_000)),
        "shop Cr 2028: {lines:?}"
    );
    assert!(
        lines.contains(&(HO.into(), "1057".into(), 50_000, 0)),
        "head office Dr 1057: {lines:?}"
    );
    assert!(
        lines.contains(&(HO.into(), "1005".into(), 0, 50_000)),
        "head office Cr bank: {lines:?}"
    );
}

// 4 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn head_office_pays_a_shops_electricity(pool: PgPool) {
    open_september(&pool).await;
    bank_account(&pool, "1005", HO, "BCA", "8880012345").await;

    let entry = try_post(
        &pool,
        "SUPPLIER_INVOICE",
        vec![
            PostingLine::debit("expense_electricity", STORE, 200_000),
            PostingLine::credit("bank_giro", HO, 200_000).with_qualifier("BCA"),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("paying a shop's bill must post: {error}"));

    let lines = lines_of(&pool, entry).await;
    assert!(
        lines.contains(&(STORE.into(), "6045".into(), 200_000, 0)),
        "shop Dr Biaya Listrik: {lines:?}"
    );
    assert!(
        lines.contains(&(STORE.into(), "2028".into(), 0, 200_000)),
        "shop Cr 2028; the shop never owes PLN: {lines:?}"
    );
    assert!(
        lines.contains(&(HO.into(), "1057".into(), 200_000, 0)),
        "head office Dr 1057: {lines:?}"
    );
    assert!(
        lines.contains(&(HO.into(), "1005".into(), 0, 200_000)),
        "head office Cr bank: {lines:?}"
    );
    assert!(
        !lines
            .iter()
            .any(|(site, account, _, _)| site == STORE && matches!(account.as_str(), "2002" | "2004")),
        "no supplier payable at the shop: {lines:?}"
    );
}

// 5 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn goods_sent_to_a_shop_cross_on_atas_barang(pool: PgPool) {
    open_september(&pool).await;

    let entry = try_post(
        &pool,
        "TRANSFER",
        vec![
            PostingLine::debit("inventory", STORE, 300_000),
            PostingLine::credit("inventory", HO, 300_000),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("a transfer must post: {error}"));

    let lines = lines_of(&pool, entry).await;
    assert!(
        lines.contains(&(STORE.into(), "2029".into(), 0, 300_000)),
        "shop Cr 2029 Hutang Affiliasi Atas Barang: {lines:?}"
    );
    assert!(
        lines.contains(&(HO.into(), "1058".into(), 300_000, 0)),
        "head office Dr 1058 Piutang Affiliasi Atas Barang: {lines:?}"
    );
    assert!(
        !lines
            .iter()
            .any(|(_, account, _, _)| matches!(account.as_str(), "1057" | "2028")),
        "goods never cross on Pembiayaan: {lines:?}"
    );
}

// 6 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn modal_kasir_cannot_pay_an_expense(pool: PgPool) {
    open_september(&pool).await;
    let error = try_post(
        &pool,
        "STORE_EXPENSE",
        vec![
            PostingLine::debit("expense_electricity", STORE, 5_000),
            PostingLine::credit("cashier_float", STORE, 5_000),
        ],
    )
    .await
    .expect_err("Modal Kasir must not pay for anything");

    assert!(
        error.contains("1004"),
        "the refusal names Modal Kasir: {error}"
    );
}

// 7 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_supplier_payable_cannot_sit_at_a_shop(pool: PgPool) {
    open_september(&pool).await;

    for key in ["trade_payable", "non_merchandise_payable"] {
        let error = try_post(
            &pool,
            "SUPPLIER_INVOICE",
            vec![
                PostingLine::debit("expense_electricity", STORE, 5_000),
                PostingLine::credit(key, STORE, 5_000).for_supplier("sup-1"),
            ],
        )
        .await
        .err()
        .unwrap_or_else(|| panic!("{key} at a shop must be refused"));

        assert!(
            error.contains("2002") || error.contains("2004"),
            "{key} refusal names the account: {error}"
        );
    }
}

// 8 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn payroll_components_have_four_separate_homes(pool: PgPool) {
    open_september(&pool).await;

    let salary = mapped(&pool, "payroll_payable", "").await;
    let thr = mapped(&pool, "thr_payable", "").await;
    let medical = mapped(&pool, "employee_claim_payable", "MEDICAL").await;
    let bpjs = mapped(&pool, "bpjs_payable", "").await;

    assert_eq!(salary, "2017", "salary payable");
    assert_eq!(thr, "2018", "THR / bonus / severance payable");
    assert_eq!(medical, "2020", "medical payable");
    assert_eq!(bpjs, "2021", "BPJS payable — its own meaning, not folded into 2017");

    let mut homes = vec![salary, thr, medical, bpjs];
    homes.sort();
    homes.dedup();
    assert_eq!(homes.len(), 4, "four components, four accounts");
}

// 9 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn stock_loss_and_damage_have_a_route(pool: PgPool) {
    open_september(&pool).await;
    assert_eq!(mapped(&pool, "stock_loss", "").await, "8007", "opname loss");
    assert_eq!(
        mapped(&pool, "inventory_damage", "").await,
        "6011",
        "damage / write-off"
    );
}

// 10 ------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn closing_a_period_leaves_profit_derived(pool: PgPool) {
    open_september(&pool).await;
    cloud::close_period(&pool, 2026, 9, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("close: {error}"));

    let posting_to_retained: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM journal_line WHERE account_code = '3003'")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(
        posting_to_retained, 0,
        "closing a period seals and validates; it never posts current profit to retained earnings (that is derived)"
    );

    // And a period that is closed takes no new posting.
    let after_close = try_post(
        &pool,
        "MANUAL",
        vec![
            PostingLine::debit("cash", STORE, 1_000),
            PostingLine::credit("revenue_cash", STORE, 1_000),
        ],
    )
    .await;
    assert!(after_close.is_err(), "a closed period refuses new postings");
}
