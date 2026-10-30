//! Two requests at the same instant, on every path where money or stock is
//! decided by reading and then writing.
//!
//! The database runs at READ COMMITTED and nothing in the estate asks for more,
//! so every one of these paths is only as safe as the lock, the atomic update
//! or the unique index it was written with. A path that is safe today is pinned
//! here so it stays safe; a path that is not is written down here, as a test
//! of the behaviour it SHOULD have, marked `#[ignore]` with the interleaving
//! that breaks it. Run them with
//!
//! ```text
//! cargo test --test consistency_under_concurrency -- --ignored
//! ```
//!
//! and a fix is finished when its test passes and loses its `#[ignore]`. The
//! same list, with where each rule is enforced, is `CONSISTENCY-MATRIX.md`.
//!
//! Where an interleaving can be forced it is — two transactions held open by
//! hand, or a table lock that parks both writers at the same statement — so a
//! red test is red every run rather than one run in fifty.

use std::time::Duration as StdDuration;

use chrono::{Duration, NaiveDate, Utc};
use futures_util::future::join_all;
use inventory_backend::cloud::{
    application::{CommandRequest, CommercialCampaignInput, CreateCommercialPublicationRequest},
    domain::{IngestBatch, SyncFact, FACT_SALES_COMPLETED},
    postgres::{
        self as cloud, IssueVoucherRequest, LineAccount, NewCostLayer, PostingIntent, PostingLine,
        RedeemPointsRequest, RedeemVoucherRequest, StockOutflow,
    },
};
use serde_json::json;
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
const STORE: &str = "store-01";
const RACERS: usize = 6;

fn day() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, 15).unwrap_or_else(|| panic!("bad date"))
}

async fn open_september(pool: &PgPool) {
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
}

fn intent(kind: &str, lines: Vec<PostingLine>) -> PostingIntent {
    PostingIntent {
        posting_date: day(),
        source_kind: kind.into(),
        source_id: Some(Uuid::new_v4().to_string()),
        rule_version: "consistency_under_concurrency/1".into(),
        currency: "IDR".into(),
        memo: None,
        lines,
    }
}

async fn try_post(pool: &PgPool, kind: &str, lines: Vec<PostingLine>) -> Result<Uuid, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let posted = cloud::post(&mut tx, &intent(kind, lines), None, ACTOR)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(posted.entry_id)
}

fn cash_sale(amount: i64) -> Vec<PostingLine> {
    vec![
        PostingLine::debit("cash", STORE, amount),
        PostingLine::credit("revenue_cash", STORE, amount),
    ]
}

fn account(code: &str) -> LineAccount {
    LineAccount::Account {
        account_code: code.into(),
        category_code: None,
    }
}

async fn member_with_points(pool: &PgPool, member: &str, points: i64) {
    cloud::enrol_member(pool, member, None)
        .await
        .unwrap_or_else(|error| panic!("member {member}: {error}"));
    let mut tx = pool.begin().await.unwrap_or_else(|e| panic!("begin: {e}"));
    cloud::earn_from_sale(&mut tx, member, Uuid::new_v4(), points, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("earn: {error}"));
    tx.commit().await.unwrap_or_else(|e| panic!("commit: {e}"));
}

async fn scalar(pool: &PgPool, sql: &str) -> i64 {
    sqlx::query_scalar(sql)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("{sql}: {error}"))
}

// ---------------------------------------------------------------------------
// SAFE today — pinned so they stay that way
// ---------------------------------------------------------------------------

/// The last unit of an article, taken by several sales at once: one wins, the
/// layer ends empty, nothing goes below zero.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_last_unit_is_sold_once(pool: PgPool) {
    open_september(&pool).await;
    let article = Uuid::new_v4();
    sqlx::query("INSERT INTO article (id, article_code, name) VALUES ($1, 'ART-RACE', 'Kemeja')")
        .bind(article)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("article: {error}"));
    let shop_pool: String = sqlx::query_scalar(
        "SELECT id FROM operational_pool WHERE site_id = $1 ORDER BY id LIMIT 1",
    )
    .bind(STORE)
    .fetch_optional(&pool)
    .await
    .unwrap_or_else(|error| panic!("pool: {error}"))
    .unwrap_or_else(|| "dc.warehouse".to_string());
    let mut tx = pool.begin().await.unwrap_or_else(|e| panic!("begin: {e}"));
    cloud::cost_layer_create(
        &mut tx,
        &NewCostLayer {
            article_id: article,
            quantity: 1,
            gross_cost_minor: 1_000,
            discount_minor: 0,
            economic_date: day(),
            site_id: STORE.into(),
            to_pool_id: shop_pool.clone(),
            receipt_id: None,
            receipt_line_id: None,
            source_reference: None,
            supplier_id: None,
            source_kind: "GOODS_RECEIPT".into(),
            source_id: Uuid::new_v4().to_string(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("layer: {error}"));
    tx.commit().await.unwrap_or_else(|e| panic!("commit: {e}"));

    let results = join_all((0..RACERS).map(|i| {
        let pool = pool.clone();
        let shop_pool = shop_pool.clone();
        async move {
            let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
            cloud::stock_ledger_consume(
                &mut tx,
                &StockOutflow {
                    article_id: article,
                    sku_id: None,
                    epc: None,
                    lot_reference: None,
                    quantity: 1,
                    event_kind: "SALE".into(),
                    event_id: format!("SALE-RACE-{i}"),
                    from_pool_id: shop_pool,
                    site_id: STORE.into(),
                    economic_date: day(),
                    source_id: format!("SALE-RACE-{i}"),
                    memo: None,
                },
                ACTOR,
            )
            .await
            .map_err(|e| e.to_string())?;
            tx.commit().await.map_err(|e| e.to_string())
        }
    }))
    .await;
    let won = results.iter().filter(|r| r.is_ok()).count();
    assert_eq!(won, 1, "exactly one sale takes the last unit: {results:?}");
    let remaining: i64 = sqlx::query_scalar(
        "SELECT remaining_quantity FROM cost_layer_remaining WHERE article_id = $1",
    )
    .bind(article)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("remaining: {error}"));
    assert_eq!(remaining, 0);
}

/// One gift card, several tills: the card is spent once, the balance is what
/// is left of it.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_gift_card_is_spent_once(pool: PgPool) {
    let card = cloud::issue_voucher(
        &pool,
        IssueVoucherRequest {
            code: None,
            kind: "GIFT_CARD".into(),
            value_minor: 100_000,
            currency: None,
            member_id: None,
            expires_at: None,
            site_id: None,
            note: None,
            // A card that keeps its rest, not a paper voucher (postgres 1006).
            single_use: Some(false),
        },
        ACTOR,
        "race-issue",
        "race-issue-digest",
    )
    .await
    .unwrap_or_else(|error| panic!("issue: {error}"));

    let results = join_all((0..RACERS).map(|i| {
        let pool = pool.clone();
        let code = card.code.clone();
        async move {
            cloud::redeem_voucher(
                &pool,
                &code,
                RedeemVoucherRequest {
                    amount_minor: 60_000,
                    sale_id: None,
                    site_id: None,
                    note: None,
                },
                ACTOR,
                &format!("race-redeem-{i}"),
                &format!("race-redeem-digest-{i}"),
            )
            .await
        }
    }))
    .await;
    assert_eq!(
        results.iter().filter(|r| r.is_ok()).count(),
        1,
        "{results:?}"
    );
    let balance: i64 = sqlx::query_scalar("SELECT balance_minor FROM voucher WHERE code = $1")
        .bind(&card.code)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("balance: {error}"));
    assert_eq!(balance, 40_000);
}

/// A member's points, spent from several screens at once, never go below zero.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn points_are_never_overspent(pool: PgPool) {
    member_with_points(&pool, "M-RACE", 500).await;
    let results = join_all((0..RACERS).map(|i| {
        let pool = pool.clone();
        async move {
            cloud::redeem_points_to_voucher(
                &pool,
                RedeemPointsRequest {
                    customer_id: "M-RACE".into(),
                    points: 300,
                    voucher_value_minor: 300,
                    actor_id: ACTOR.into(),
                    idempotency_key: format!("race-points-{i}"),
                    expires_at: None,
                },
            )
            .await
        }
    }))
    .await;
    assert_eq!(
        results.iter().filter(|r| r.is_ok()).count(),
        1,
        "{results:?}"
    );
    assert_eq!(
        scalar(
            &pool,
            "SELECT balance_points FROM points_account WHERE customer_id = 'M-RACE'"
        )
        .await,
        200
    );
    assert_eq!(
        scalar(
            &pool,
            "SELECT SUM(points)::bigint FROM points_ledger WHERE customer_id = 'M-RACE'"
        )
        .await,
        200,
        "the balance is still the ledger"
    );
}

/// Journals posted at the same instant get distinct numbers and all land.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn journals_posted_together_are_numbered_apart(pool: PgPool) {
    open_september(&pool).await;
    let results = join_all((0..RACERS).map(|_| {
        let pool = pool.clone();
        async move { try_post(&pool, "SALE_DAY", cash_sale(1_000)).await }
    }))
    .await;
    assert!(results.iter().all(Result::is_ok), "{results:?}");
    assert_eq!(
        scalar(
            &pool,
            "SELECT COUNT(DISTINCT entry_number)::bigint FROM journal_entry"
        )
        .await,
        RACERS as i64
    );
}

/// Closing a month while postings land in it: either the posting is in before
/// the close, or it is refused — never sealed into a month it arrived after.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_month_closes_between_postings_never_through_one(pool: PgPool) {
    open_september(&pool).await;
    let posts = join_all((0..RACERS).map(|_| {
        let pool = pool.clone();
        async move { try_post(&pool, "SALE_DAY", cash_sale(1_000)).await }
    }));
    let close = cloud::close_period(&pool, 2026, 9, ACTOR);
    let (posted, closed) = tokio::join!(posts, close);
    closed.unwrap_or_else(|error| panic!("close: {error}"));
    let landed = posted.iter().filter(|r| r.is_ok()).count() as i64;
    assert_eq!(
        scalar(&pool, "SELECT COUNT(*)::bigint FROM journal_entry").await,
        landed,
        "every posting that said yes is in the books, and nothing else is"
    );
    assert_eq!(
        scalar(
            &pool,
            "SELECT COUNT(*)::bigint FROM journal_entry e JOIN fiscal_period p
                ON p.year = 2026 AND p.month = 9
             WHERE e.posted_at > p.closed_at"
        )
        .await,
        0,
        "nothing was posted into September after it closed"
    );
}

/// A shop's upload delivered twice at the same instant is applied once.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_upload_delivered_twice_at_once_lands_once(pool: PgPool) {
    let facts: Vec<SyncFact> = (1..=3)
        .map(|seq| SyncFact {
            seq,
            event_id: Uuid::new_v4(),
            event_type: "test.performance".into(),
            payload: json!({ "seq": seq }),
            created_at: Utc::now(),
        })
        .collect();
    let batch = IngestBatch {
        origin_id: "race-origin".into(),
        generation: 1,
        command_watermark: 0,
        command_blocked: None,
        facts,
    };
    let results = join_all((0..RACERS).map(|_| {
        let pool = pool.clone();
        let batch = batch.clone();
        async move { cloud::ingest_batch(&pool, &batch).await }
    }))
    .await;
    for result in &results {
        let response = result
            .as_ref()
            .unwrap_or_else(|error| panic!("ingest: {error}"));
        assert_eq!(response.durable_through, 3);
    }
    assert_eq!(
        scalar(
            &pool,
            "SELECT COUNT(*)::bigint FROM sync_ingest_fact WHERE origin_id = 'race-origin'"
        )
        .await,
        3
    );
}

// ---------------------------------------------------------------------------
// OPEN — the behaviour each path should have, red until it is fixed
// ---------------------------------------------------------------------------

/// A STOP budget holds against two postings made at the same time.
///
/// `poster::enforce_budgets` sums the month with a plain read and no lock. Two
/// postings each under the line read the same spend, both pass, and together
/// they cross it. Forced here by holding both transactions open.
#[sqlx::test(migrations = "./migrations/postgres")]
#[ignore = "open race: poster::enforce_budgets reads the month's spend without a lock (CONSISTENCY-MATRIX R1)"]
async fn a_stop_budget_holds_against_two_postings_at_once(pool: PgPool) {
    open_september(&pool).await;
    sqlx::query(
        "INSERT INTO budget (budget_id, unit_id, account_code, period_start, period_end,
                             amount_minor, on_exceed, effective_from, set_by)
         VALUES ($1, $2, '6006', '2026-09-01', '2026-09-30', 100000, 'STOP', '2026-09-01', $3)",
    )
    .bind(Uuid::new_v4())
    .bind(STORE)
    .bind(ACTOR)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("budget: {error}"));
    let spend = || {
        vec![
            PostingLine::debit(account("6006"), STORE, 60_000),
            PostingLine::credit("cash", STORE, 60_000),
        ]
    };

    // The first posting is made and held open; the second runs on its own task
    // while it is. Today the second reads a month with nothing in it and passes.
    // Once the guard takes a lock, the second waits on it instead — so the
    // first is committed only when the second has either finished or is parked,
    // and then the second is awaited.
    let mut first = pool.begin().await.unwrap_or_else(|e| panic!("begin: {e}"));
    cloud::post(&mut first, &intent("STORE_EXPENSE", spend()), None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("the first spend is under the line: {error}"));
    let second = tokio::spawn({
        let pool = pool.clone();
        let lines = spend();
        async move { try_post(&pool, "STORE_EXPENSE", lines).await }
    });
    for _ in 0..200 {
        let parked = scalar(
            &pool,
            "SELECT COUNT(*)::bigint FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'",
        )
        .await;
        if second.is_finished() || parked > 0 {
            break;
        }
        tokio::time::sleep(StdDuration::from_millis(50)).await;
    }
    first
        .commit()
        .await
        .unwrap_or_else(|e| panic!("commit: {e}"));
    let b_committed = second
        .await
        .unwrap_or_else(|error| panic!("second task: {error}"))
        .is_ok();
    let spent = scalar(
        &pool,
        "SELECT COALESCE(SUM(debit_minor), 0)::bigint FROM journal_line WHERE account_code = '6006'",
    )
    .await;
    assert!(
        spent <= 100_000,
        "the promise was 100,000 and {spent} was spent (second posting committed: {b_committed})"
    );
}

/// A member has at most one live redeem request, however fast the tills ask.
///
/// `loyalty::ask_redeem_request` takes the member's row lock before it
/// replaces the live request and inserts its own, so two asks at once queue
/// and the second replaces the first.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_member_has_one_live_redeem_request(pool: PgPool) {
    for attempt in 0..20 {
        let member = format!("M-TAP-{attempt}");
        member_with_points(&pool, &member, 500).await;
        let asker = || cloud::RedeemAsker {
            actor: "kasir",
            origin_id: "store-07",
            site_id: None,
        };
        let (a, b) = tokio::join!(
            cloud::ask_redeem_request(&pool, &member, 300, asker()),
            cloud::ask_redeem_request(&pool, &member, 300, asker())
        );
        assert!(
            a.is_ok() && b.is_ok(),
            "attempt {attempt}: {:?} / {:?}",
            a.map(|_| ()),
            b.map(|_| ())
        );
        let live: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM member_redeem_request
              WHERE member_id = $1 AND confirmed_at IS NULL AND cancelled_at IS NULL",
        )
        .bind(&member)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"));
        assert_eq!(
            live, 1,
            "attempt {attempt}: {live} live requests for {member}"
        );
    }
}

/// Two rebalances of one split promotion limit never hand out more than the
/// limit between them.
///
/// Park the first rebalance at its upsert behind a table lock, register a
/// third shop, then start another rebalance. The policy lock must make the
/// second worker read the grants only after the first worker commits them.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_split_limit_is_never_over_granted(pool: PgPool) {
    for origin in ["store-07", "store-08"] {
        register(&pool, origin).await;
    }
    publish_budget_campaign(&pool, 1_000_000).await;
    cloud::set_cap_allocation(
        &pool,
        "CAMPAIGN",
        "LEBARAN",
        cloud::CapAllocationRequest { enabled: true },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("split: {error}"));
    sell_at(&pool, "store-07", 1, 200_000).await;
    cloud::rebalance_allocations(&pool)
        .await
        .unwrap_or_else(|error| panic!("rebalance: {error}"));
    sell_at(&pool, "store-07", 2, 260_000).await;

    let mut gate = pool.begin().await.unwrap_or_else(|e| panic!("begin: {e}"));
    sqlx::query("LOCK TABLE commercial_cap_allocation IN EXCLUSIVE MODE")
        .execute(&mut *gate)
        .await
        .unwrap_or_else(|error| panic!("lock: {error}"));

    let first = tokio::spawn({
        let pool = pool.clone();
        async move { cloud::rebalance_allocations(&pool).await }
    });
    wait_for_blocked(&pool, 1).await;
    register(&pool, "store-09").await;
    let second = tokio::spawn({
        let pool = pool.clone();
        async move { cloud::rebalance_allocations(&pool).await }
    });
    wait_for_blocked(&pool, 2).await;
    gate.commit()
        .await
        .unwrap_or_else(|e| panic!("release: {e}"));
    first
        .await
        .unwrap_or_else(|error| panic!("first worker: {error}"))
        .unwrap_or_else(|error| panic!("first rebalance: {error}"));
    second
        .await
        .unwrap_or_else(|error| panic!("second worker: {error}"))
        .unwrap_or_else(|error| panic!("second rebalance: {error}"));

    let granted = scalar(
        &pool,
        "SELECT COALESCE(SUM(granted), 0)::bigint FROM commercial_cap_allocation
          WHERE kind = 'CAMPAIGN' AND key = 'LEBARAN' AND measure = 'BUDGET'",
    )
    .await;
    assert!(
        granted <= 1_000_000,
        "the limit is 1,000,000 and {granted} was granted"
    );
}

/// A retired node may still hold an offline grant. Removing its credential
/// must not put that money back into the pool for another shop.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_retired_shops_grant_is_not_given_to_another_shop(pool: PgPool) {
    for origin in ["store-07", "store-08"] {
        register(&pool, origin).await;
    }
    publish_budget_campaign(&pool, 1_000_000).await;
    cloud::set_cap_allocation(
        &pool,
        "CAMPAIGN",
        "LEBARAN",
        cloud::CapAllocationRequest { enabled: true },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("split: {error}"));
    sqlx::query(
        "UPDATE commercial_cap_allocation SET granted = 750000
                  WHERE origin_id = 'store-07' AND kind = 'CAMPAIGN'
                    AND key = 'LEBARAN' AND measure = 'BUDGET'",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("grant: {error}"));
    sqlx::query("DELETE FROM sync_origin_credential WHERE origin_id = 'store-07'")
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("retire: {error}"));
    register(&pool, "store-09").await;
    cloud::rebalance_allocations(&pool)
        .await
        .unwrap_or_else(|error| panic!("rebalance: {error}"));
    let granted = scalar(
        &pool,
        "SELECT SUM(granted)::bigint FROM commercial_cap_allocation
          WHERE kind = 'CAMPAIGN' AND key = 'LEBARAN' AND measure = 'BUDGET'",
    )
    .await;
    assert_eq!(
        granted, 1_000_000,
        "a retired allowance stays out of the pool"
    );
    let new_grant = scalar(
        &pool,
        "SELECT granted FROM commercial_cap_allocation WHERE origin_id = 'store-09'
          AND kind = 'CAMPAIGN' AND key = 'LEBARAN' AND measure = 'BUDGET'",
    )
    .await;
    assert_eq!(new_grant, 0);
}

/// A shop enrolled between rebalances must receive zero rather than silently
/// enforcing the less restrictive fleet counter under an enabled hard cap.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_ungranted_shop_receives_zero_allowance(pool: PgPool) {
    register(&pool, "store-07").await;
    publish_budget_campaign(&pool, 1_000_000).await;
    cloud::set_cap_allocation(
        &pool,
        "CAMPAIGN",
        "LEBARAN",
        cloud::CapAllocationRequest { enabled: true },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("split: {error}"));
    register(&pool, "store-08").await;
    let (command_id, _) = cloud::publish_commercial_usage(&pool, ACTOR, &["store-08".into()])
        .await
        .unwrap_or_else(|error| panic!("usage: {error}"));
    let payload: serde_json::Value =
        sqlx::query_scalar("SELECT payload FROM sync_command WHERE command_id = $1")
            .bind(command_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("payload: {error}"));
    let allowance = payload["allowances"]
        .as_array()
        .and_then(|rows| {
            rows.iter()
                .find(|row| row["origin_id"] == "store-08" && row["key"] == "LEBARAN")
        })
        .unwrap_or_else(|| panic!("new shop has no allowance in {payload}"));
    assert_eq!(allowance["budget_minor"], json!(0));
    assert!(
        allowance["max_uses"].is_null(),
        "an uncapped measure stays uncapped"
    );
}

/// Failure to read the split must not send an empty allowance list and erase
/// the edge's last valid hard cap.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_failed_allowance_read_does_not_publish_a_weaker_usage_snapshot(pool: PgPool) {
    register(&pool, "store-07").await;
    publish_budget_campaign(&pool, 1_000_000).await;
    cloud::set_cap_allocation(
        &pool,
        "CAMPAIGN",
        "LEBARAN",
        cloud::CapAllocationRequest { enabled: true },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("split: {error}"));
    let before = scalar(&pool, "SELECT COUNT(*)::bigint FROM sync_command").await;
    sqlx::query("ALTER TABLE commercial_cap_allocation RENAME TO unavailable_cap_allocation")
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("simulate failed read: {error}"));
    let result = cloud::publish_commercial_usage(&pool, ACTOR, &["store-07".into()]).await;
    assert!(
        result.is_err(),
        "a failed allowance read published {result:?}"
    );
    assert_eq!(
        scalar(&pool, "SELECT COUNT(*)::bigint FROM sync_command").await,
        before
    );
}

/// A promotion's historical spend cannot become a second fresh pool when
/// somebody enables hard allocation after using the fleet-counter mode.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_split_cannot_ignore_sales_made_before_it_was_enabled(pool: PgPool) {
    register(&pool, "store-07").await;
    publish_budget_campaign(&pool, 1_000_000).await;
    sell_at(&pool, "store-07", 1, 200_000).await;
    let result = cloud::set_cap_allocation(
        &pool,
        "CAMPAIGN",
        "LEBARAN",
        cloud::CapAllocationRequest { enabled: true },
        ACTOR,
    )
    .await;
    assert!(
        result.is_err(),
        "historical spending was granted a new pool: {result:?}"
    );
    assert_eq!(
        scalar(
            &pool,
            "SELECT COUNT(*)::bigint FROM commercial_cap_allocation"
        )
        .await,
        0
    );
}

/// A direct redemption cannot spend money a checkout is holding.
///
/// Not a race — a gap the races make likely. `redeem_voucher` compares the
/// amount with the balance, not with the balance less the live holds, so the
/// hold it spends from is refused later, when the till that took it commits.
#[sqlx::test(migrations = "./migrations/postgres")]
#[ignore = "open gap: redeem_voucher ignores live holds (CONSISTENCY-MATRIX G3)"]
async fn a_redemption_cannot_spend_what_a_checkout_holds(pool: PgPool) {
    let card = cloud::issue_voucher(
        &pool,
        IssueVoucherRequest {
            code: None,
            kind: "GIFT_CARD".into(),
            value_minor: 100_000,
            currency: None,
            member_id: None,
            expires_at: None,
            site_id: None,
            note: None,
            // A card that keeps its rest, not a paper voucher (postgres 1006).
            single_use: Some(false),
        },
        ACTOR,
        "hold-issue",
        "hold-issue-digest",
    )
    .await
    .unwrap_or_else(|error| panic!("issue: {error}"));
    cloud::authorize_voucher(
        &pool,
        &card.code,
        cloud::AuthorizeVoucherRequest {
            checkout_id: "CHECKOUT-1".into(),
            amount_minor: 80_000,
            site_id: Some(STORE.into()),
            actor_id: ACTOR.into(),
            hold_seconds: Some(3_600),
        },
    )
    .await
    .unwrap_or_else(|error| panic!("hold: {error}"));
    let spend = cloud::redeem_voucher(
        &pool,
        &card.code,
        RedeemVoucherRequest {
            amount_minor: 50_000,
            sale_id: None,
            site_id: None,
            note: None,
        },
        ACTOR,
        "hold-redeem",
        "hold-redeem-digest",
    )
    .await;
    assert!(
        spend.is_err(),
        "only 20,000 is free on the card; 50,000 was redeemed"
    );
}

/// Head office's piutang account is never written at a shop, and a shop's
/// hutang account never at head office, even by a hand-keyed journal (I7).
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_affiliate_account_cannot_be_named_on_the_wrong_side(pool: PgPool) {
    open_september(&pool).await;
    let wrong = try_post(
        &pool,
        "MANUAL",
        vec![
            PostingLine::debit(account("1057"), STORE, 10_000).with_counter_unit("ho"),
            PostingLine::credit("cash", STORE, 10_000),
        ],
    )
    .await;
    assert!(
        wrong.is_err(),
        "1057 is head office's piutang; at {STORE} it was accepted"
    );
    let unit_to_unit = try_post(
        &pool,
        "MANUAL",
        vec![
            PostingLine::debit(account("2028"), STORE, 10_000).with_counter_unit("store-02"),
            PostingLine::credit("cash", STORE, 10_000),
        ],
    )
    .await;
    assert!(
        unit_to_unit.is_err(),
        "unit to unit must go through head office; it was accepted"
    );
}

// --- helpers for the split-limit race --------------------------------------

async fn register(pool: &PgPool, origin: &str) {
    cloud::register_origin_credential_binding(
        pool,
        origin,
        &format!("{origin}-concurrency-sync-key-000001"),
        Some(origin),
        Some(origin),
        Some("STORE"),
        Some(1),
        Some(true),
    )
    .await
    .unwrap_or_else(|error| panic!("register {origin}: {error}"));
}

async fn publish_budget_campaign(pool: &PgPool, budget_minor: i64) {
    let created = cloud::create_commercial_publication(
        pool,
        CreateCommercialPublicationRequest {
            change_type: None,
            version: 941,
            name: "Lebaran".into(),
            effective_from: Utc::now() - Duration::days(1),
            effective_to: None,
            tax_rules: Vec::new(),
            offer_rules: Vec::new(),
            markdowns: Vec::new(),
            rules: Vec::new(),
            coupons: Vec::new(),
            campaigns: vec![CommercialCampaignInput {
                campaign_id: "LEBARAN".into(),
                name: "Lebaran".into(),
                status: "ACTIVE".into(),
                valid_from: None,
                valid_to: None,
                budget_minor: Some(budget_minor),
                max_uses: None,
                site_ids: Vec::new(),
                image_url: None,
                headline: None,
                terms: None,
            }],
            actor_id: ACTOR.into(),
            idempotency_key: "race-draft".into(),
        },
    )
    .await
    .unwrap_or_else(|error| panic!("draft: {error}"));
    let id: Uuid = created["id"]
        .as_str()
        .and_then(|raw| raw.parse().ok())
        .unwrap_or_else(|| panic!("no id in {created}"));
    cloud::publish_commercial_publication(
        pool,
        id,
        CommandRequest {
            actor_id: ACTOR.into(),
            idempotency_key: "race-publish".into(),
        },
    )
    .await
    .unwrap_or_else(|error| panic!("publish: {error}"));
}

async fn sell_at(pool: &PgPool, origin: &str, seq: i64, benefit: i64) {
    let charged = 300_000 - benefit;
    cloud::ingest_batch(
        pool,
        &IngestBatch {
            origin_id: origin.into(),
            generation: 1,
            facts: vec![SyncFact {
                seq,
                event_id: Uuid::new_v4(),
                event_type: FACT_SALES_COMPLETED.into(),
                payload: json!({
                    "sale_id": Uuid::new_v4(),
                    "movement_group_id": Uuid::new_v4(),
                    "site_id": origin,
                    "actor_id": "kasir-1",
                    "occurred_at": Utc::now(),
                    "currency": "IDR",
                    "total_minor": charged,
                    "paid_minor": charged,
                    "change_minor": 0,
                    "lines": [{
                        "subject_id": Uuid::new_v4(),
                        "epc": format!("EPC{seq:08}"),
                        "sku_code": "MINYAK-2L",
                        "quantity": 1,
                        "unit_price_minor": charged,
                    }],
                    "promotions": [{
                        "rule_id": "R-LEBARAN",
                        "campaign_id": "LEBARAN",
                        "coupon_code": null,
                        "benefit_minor": benefit,
                        "lines": [],
                    }],
                }),
                created_at: Utc::now(),
            }],
            command_watermark: 0,
            command_blocked: None,
        },
    )
    .await
    .unwrap_or_else(|error| panic!("ingest: {error}"));
    let applied = cloud::apply_pending(pool, 200)
        .await
        .unwrap_or_else(|error| panic!("apply: {error}"));
    assert!(applied.blocked.is_empty(), "{:?}", applied.blocked);
}

/// Wait until `n` backends of this database are parked on a lock.
async fn wait_for_blocked(pool: &PgPool, n: i64) {
    for _ in 0..200 {
        let row = sqlx::query(
            "SELECT COUNT(*)::bigint AS n FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'",
        )
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("activity: {error}"));
        if row.get::<i64, _>("n") >= n {
            return;
        }
        tokio::time::sleep(StdDuration::from_millis(50)).await;
    }
    panic!("{n} rebalance(s) never reached the lock");
}
