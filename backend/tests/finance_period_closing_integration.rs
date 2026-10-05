//! The Period Closing Voucher (owner decision 27 Sep 2026: "sama dengan
//! ERPNext"; replaces hard rule I10), end to end against the migration chain.
//!
//!   1  a voucher moves each site's profit into 3003 at that site; the P&L
//!      accounts net to zero, every site still balances, the profit and loss
//!      still shows the period's profit, and the balance sheet balances
//!   2  vouchers close in order: the next starts the day after the last
//!   3  the first voucher cannot leave earlier profit unclosed
//!   4  only the last voucher can be cancelled, and cancelling restores the
//!      profit-and-loss balances
//!   5  a soft-closed month takes the voucher; a closed month does not

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{self as cloud, PostingIntent, PostingLine};
use sqlx::PgPool;
use uuid::Uuid;

const ACTOR: &str = "finance-ho";
const STORE: &str = "store-01";
const HO: &str = "ho";

fn date(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).unwrap_or_else(|| panic!("bad date"))
}

async fn open(pool: &PgPool, year: i32, month: i32) {
    cloud::open_period(pool, year, month)
        .await
        .unwrap_or_else(|error| panic!("open {year}-{month}: {error}"));
}

async fn post(pool: &PgPool, on: NaiveDate, kind: &str, lines: Vec<PostingLine>) {
    let mut tx = pool.begin().await.unwrap_or_else(|e| panic!("tx: {e}"));
    cloud::post(
        &mut tx,
        &PostingIntent {
            posting_date: on,
            source_kind: kind.into(),
            source_id: Some(Uuid::new_v4().to_string()),
            rule_version: "period_closing_test/1".into(),
            currency: "IDR".into(),
            memo: None,
            lines,
        },
        None,
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post {kind}: {error}"));
    tx.commit().await.unwrap_or_else(|e| panic!("commit: {e}"));
}

/// A cash sale at a site.
async fn sale(pool: &PgPool, on: NaiveDate, site: &str, amount: i64) {
    post(
        pool,
        on,
        "SALE_DAY",
        vec![
            PostingLine::debit("cash", site, amount),
            PostingLine::credit("revenue_cash", site, amount),
        ],
    )
    .await;
}

/// An expense paid in cash at a site, keyed by Finance.
async fn expense(pool: &PgPool, on: NaiveDate, site: &str, account: &str, amount: i64) {
    let code = |account_code: &str| cloud::LineAccount::Account {
        account_code: account_code.into(),
        category_code: None,
    };
    post(
        pool,
        on,
        "MANUAL",
        vec![
            PostingLine::debit(code(account), site, amount),
            PostingLine::credit(code("1002"), site, amount),
        ],
    )
    .await;
}

async fn balance(pool: &PgPool, account: &str, unit: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::bigint FROM journal_line
          WHERE account_code = $1 AND unit_id = $2",
    )
    .bind(account)
    .bind(unit)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("balance {account}: {error}"))
}

/// Debits less credits over every profit-and-loss account in a unit's books,
/// closing entries included.
async fn open_profit(pool: &PgPool, unit: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint
           FROM journal_line l JOIN ledger_account a USING (account_code)
          WHERE a.root_type IN ('INCOME', 'EXPENSE') AND l.unit_id = $1",
    )
    .bind(unit)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("open profit: {error}"))
}

fn closing(start: NaiveDate, end: NaiveDate) -> cloud::PeriodClosingRequest {
    cloud::PeriodClosingRequest {
        period_start: start,
        period_end: end,
        remarks: None,
    }
}

// 1 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_voucher_moves_each_sites_profit_into_retained_earnings(pool: PgPool) {
    open(&pool, 2026, 9).await;
    sale(&pool, date(2026, 9, 10), STORE, 1_000_000).await;
    expense(&pool, date(2026, 9, 12), STORE, "6045", 300_000).await;
    sale(&pool, date(2026, 9, 15), HO, 500_000).await;

    let voucher = cloud::post_period_closing(&pool, &closing(date(2026, 9, 1), date(2026, 9, 30)), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("close: {error}"));
    assert_eq!(voucher.status, "POSTED");
    assert_eq!(voucher.profit_minor, 1_200_000);

    assert_eq!(open_profit(&pool, STORE).await, 0, "the store's P&L accounts are closed");
    assert_eq!(open_profit(&pool, HO).await, 0, "head office's P&L accounts are closed");
    assert_eq!(balance(&pool, "3003", STORE).await, -700_000, "the store's profit, credited");
    assert_eq!(balance(&pool, "3003", HO).await, -500_000, "head office's profit, credited");

    let unbalanced: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM (
             SELECT entry_id, unit_id FROM journal_line
              GROUP BY entry_id, unit_id HAVING SUM(debit_minor - credit_minor) <> 0) s",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("per unit: {error}"));
    assert_eq!(unbalanced, 0, "every unit balances in its own books");

    let pnl = cloud::profit_and_loss(&pool, date(2026, 9, 1), date(2026, 9, 30), Some(STORE))
        .await
        .unwrap_or_else(|error| panic!("p&l: {error}"));
    assert_eq!(pnl.net_profit_minor, 700_000, "a closed month still reports its profit");

    let sheet = cloud::balance_sheet(&pool, date(2026, 9, 30), Some(STORE))
        .await
        .unwrap_or_else(|error| panic!("balance sheet: {error}"));
    assert!(sheet.balanced, "difference {}", sheet.difference_minor);
    assert_eq!(sheet.result_minor, 0, "no profit left outside retained earnings");
}

// 2 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn vouchers_close_in_order(pool: PgPool) {
    open(&pool, 2026, 9).await;
    open(&pool, 2026, 10).await;
    sale(&pool, date(2026, 9, 10), STORE, 100_000).await;
    sale(&pool, date(2026, 10, 10), STORE, 200_000).await;

    cloud::post_period_closing(&pool, &closing(date(2026, 9, 1), date(2026, 9, 30)), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("september: {error}"));

    let gap = cloud::post_period_closing(&pool, &closing(date(2026, 10, 2), date(2026, 10, 31)), ACTOR)
        .await
        .err()
        .unwrap_or_else(|| panic!("a voucher that skips a day is refused"))
        .to_string();
    assert!(gap.contains("2026-10-01"), "the refusal names the day to start on: {gap}");
    assert!(
        cloud::post_period_closing(&pool, &closing(date(2026, 9, 15), date(2026, 10, 31)), ACTOR)
            .await
            .is_err(),
        "a voucher over an already closed range is refused"
    );

    let october = cloud::post_period_closing(&pool, &closing(date(2026, 10, 1), date(2026, 10, 31)), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("october: {error}"));
    assert_eq!(october.profit_minor, 200_000, "October closes only October's profit");
    assert_eq!(balance(&pool, "3003", STORE).await, -300_000);
}

// 3 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_first_voucher_leaves_no_earlier_profit_open(pool: PgPool) {
    open(&pool, 2026, 8).await;
    open(&pool, 2026, 9).await;
    sale(&pool, date(2026, 8, 20), STORE, 100_000).await;

    let refused = cloud::post_period_closing(&pool, &closing(date(2026, 9, 1), date(2026, 9, 30)), ACTOR)
        .await
        .err()
        .unwrap_or_else(|| panic!("August's profit would never be closed"))
        .to_string();
    assert!(refused.contains("2026-08-20"), "{refused}");

    cloud::post_period_closing(&pool, &closing(date(2026, 8, 1), date(2026, 9, 30)), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("from August: {error}"));
    assert_eq!(open_profit(&pool, STORE).await, 0);
}

// 4 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn only_the_last_voucher_is_cancelled_and_cancelling_restores_the_profit(pool: PgPool) {
    open(&pool, 2026, 9).await;
    open(&pool, 2026, 10).await;
    sale(&pool, date(2026, 9, 10), STORE, 100_000).await;
    sale(&pool, date(2026, 10, 10), STORE, 200_000).await;
    let september = cloud::post_period_closing(&pool, &closing(date(2026, 9, 1), date(2026, 9, 30)), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("september: {error}"));
    let october = cloud::post_period_closing(&pool, &closing(date(2026, 10, 1), date(2026, 10, 31)), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("october: {error}"));

    assert!(
        cloud::cancel_period_closing(&pool, september.voucher_id, ACTOR).await.is_err(),
        "October was built on September"
    );
    let cancelled = cloud::cancel_period_closing(&pool, october.voucher_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("cancel october: {error}"));
    assert_eq!(cancelled.status, "CANCELLED");
    assert!(cancelled.reversal_entry_id.is_some());
    assert_eq!(balance(&pool, "3003", STORE).await, -100_000, "only September stays closed");
    assert_eq!(open_profit(&pool, STORE).await, -200_000, "October's income is open again");

    let again = cloud::post_period_closing(&pool, &closing(date(2026, 10, 1), date(2026, 10, 31)), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("close october again: {error}"));
    assert_eq!(again.profit_minor, 200_000, "a cancelled voucher is not counted twice");
}

// 5 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_soft_closed_month_takes_the_voucher_and_a_closed_one_does_not(pool: PgPool) {
    open(&pool, 2026, 9).await;
    sale(&pool, date(2026, 9, 10), STORE, 100_000).await;
    cloud::period_soft_close(&pool, 2026, 9, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("soft close: {error}"));
    cloud::post_period_closing(&pool, &closing(date(2026, 9, 1), date(2026, 9, 30)), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("a soft-closed month takes the voucher: {error}"));

    open(&pool, 2026, 10).await;
    sale(&pool, date(2026, 10, 10), STORE, 200_000).await;
    sqlx::query("UPDATE fiscal_period SET status = 'CLOSED', closed_by = $1, closed_at = now() WHERE year = 2026 AND month = 10")
        .bind(ACTOR)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("close october: {error}"));
    let refused = cloud::post_period_closing(&pool, &closing(date(2026, 10, 1), date(2026, 10, 31)), ACTOR)
        .await
        .err()
        .unwrap_or_else(|| panic!("a closed month takes nothing"))
        .to_string();
    assert!(refused.contains("closed"), "{refused}");
}

/// Seal a month the way `period_close` leaves it, without running its
/// checklist — the checklist is not what this test is about.
async fn sealed(pool: &PgPool, year: i32, month: i32) {
    open(pool, year, month).await;
    sqlx::query(
        "UPDATE fiscal_period SET status='CLOSED', closed_by=$3, closed_at=now()
          WHERE year=$1 AND month=$2",
    )
    .bind(year as i16)
    .bind(month as i16)
    .bind(ACTOR)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("seal {year}-{month}: {error}"));
}

async fn status_of(pool: &PgPool, year: i32, month: i32) -> String {
    sqlx::query_scalar("SELECT status FROM fiscal_period WHERE year=$1 AND month=$2")
        .bind(year as i16)
        .bind(month as i16)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("status {year}-{month}: {error}"))
}

/// Undo Closing, as 7Soft has it: the latest closed month first, a reason
/// every time, and never under a year-end voucher that still stands.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn closing_is_undone_newest_month_first(pool: PgPool) {
    sealed(&pool, 2026, 7).await;
    sealed(&pool, 2026, 8).await;

    let refused = cloud::period_reopen(&pool, 2026, 7, ACTOR, "late invoice")
        .await
        .err()
        .unwrap_or_else(|| panic!("July reopened under a closed August"));
    assert!(refused.to_string().contains("2026-08"), "{refused}");
    assert_eq!(status_of(&pool, 2026, 7).await, "CLOSED");

    let no_reason = cloud::period_reopen(&pool, 2026, 8, ACTOR, "  ").await;
    assert!(no_reason.is_err(), "a reopen without a reason");

    cloud::period_reopen(&pool, 2026, 8, ACTOR, "late invoice from PLN")
        .await
        .unwrap_or_else(|error| panic!("reopen August: {error}"));
    cloud::period_reopen(&pool, 2026, 7, ACTOR, "late invoice from PLN")
        .await
        .unwrap_or_else(|error| panic!("reopen July: {error}"));
    assert_eq!(status_of(&pool, 2026, 7).await, "OPEN");
    assert_eq!(status_of(&pool, 2026, 8).await, "OPEN");

    let events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM fiscal_period_event WHERE event = 'REOPEN' AND reason = 'late invoice from PLN'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("events: {error}"));
    assert_eq!(events, 2, "each undo is written down with its reason");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_standing_year_end_voucher_blocks_undoing_a_close(pool: PgPool) {
    sealed(&pool, 2026, 9).await;
    sqlx::query(
        "INSERT INTO period_closing_voucher (voucher_id, period_start, period_end, created_by)
         VALUES ($1, '2026-01-01', '2026-12-31', $2)",
    )
    .bind(Uuid::new_v4())
    .bind(ACTOR)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("voucher: {error}"));

    let refused = cloud::period_reopen(&pool, 2026, 9, ACTOR, "late invoice")
        .await
        .err()
        .unwrap_or_else(|| panic!("reopened under a standing voucher"));
    assert!(refused.to_string().contains("Period Closing Voucher"), "{refused}");
    assert_eq!(status_of(&pool, 2026, 9).await, "CLOSED");
}
