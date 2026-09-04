//! A member's own screen: points earned, purchases, one receipt.
//!
//! The chain these tests follow is the whole point of the feature. A shop
//! reports a completed sale naming the shopper; the centre accepts it; and the
//! member's phone can then be shown a number that came from the same row the
//! centre's revenue is built from. Before this, the till knew who was buying
//! and the centre threw the name away, so `edge_sale.points_earned` was points
//! credited to nobody.
//!
//! Driven at the query layer rather than over HTTP: the three routes in
//! `cloud/http/customer.rs` are one-line wrappers around these functions, and
//! everything worth breaking — the attribution, the paging, the scoping — is
//! here. What HTTP adds is checked by `api_flow_integration.rs` for the
//! surfaces that have logic in their handlers.

use inventory_backend::cloud::domain::FACT_SALES_COMPLETED;
use inventory_backend::cloud::postgres::{self as cloud, CustomerTransactionsQuery};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

const ORIGIN: &str = "store-07";
const MEMBER: &str = "M-000123";
const SOMEBODY_ELSE: &str = "M-999999";

/// A completed sale as a till reports it.
///
/// `minutes_ago` orders the history: the newest purchase is the one a member
/// opens the app to see.
#[allow(clippy::too_many_arguments)]
fn sale_payload(
    sale_id: Uuid,
    customer_id: Option<&str>,
    total: i64,
    discount: i64,
    points: i64,
    minutes_ago: i64,
    lines: Value,
) -> Value {
    let mut payload = json!({
        "sale_id": sale_id,
        "movement_group_id": Uuid::new_v4(),
        "site_id": ORIGIN,
        "actor_id": "kasir-1",
        "occurred_at": chrono::Utc::now() - chrono::Duration::minutes(minutes_ago),
        "currency": "IDR",
        "total_minor": total,
        "paid_minor": total,
        "change_minor": 0,
        "discount_total_minor": discount,
        "points_earned": points,
        "lines": lines,
    });
    if let Some(customer_id) = customer_id {
        payload["customer_id"] = json!(customer_id);
    }
    payload
}

fn line(sku: &str, unit: i64, total: i64) -> Value {
    json!({
        "subject_id": Uuid::new_v4(),
        "epc": format!("EPC-{sku}"),
        "sku_code": sku,
        "quantity": 1,
        "unit_price_minor": unit,
        "line_total_minor": total,
    })
}

/// The centre re-checks a till's arithmetic at ingest and refuses a sale whose
/// lines do not add up to its total, so every sale built here adds up.
fn one_line(sku: &str, unit: i64, total: i64) -> Value {
    json!([line(sku, unit, total)])
}

async fn ingest(pool: &PgPool, seq: i64, payload: Value) {
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
    let report = cloud::apply_pending(pool, 200)
        .await
        .unwrap_or_else(|e| panic!("apply: {e}"));
    assert!(report.blocked.is_empty(), "{:?}", report.blocked);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_shoppers_points_and_purchases_come_back_to_them(pool: PgPool) {
    ingest(
        &pool,
        1,
        sale_payload(
            Uuid::new_v4(),
            Some(MEMBER),
            348_000,
            30_000,
            348,
            120,
            // Two lines, one of them marked down: 169.000 + 179.000 = 348.000.
            json!([
                line("KMJ-01", 199_000, 169_000),
                line("KMJ-02", 179_000, 179_000),
            ]),
        ),
    )
    .await;
    ingest(
        &pool,
        2,
        sale_payload(
            Uuid::new_v4(),
            Some(MEMBER),
            129_000,
            0,
            129,
            60,
            one_line("KMJ-03", 129_000, 129_000),
        ),
    )
    .await;
    // Somebody else shopping in the same shop on the same day. None of this
    // may reach the member's screen.
    ingest(
        &pool,
        3,
        sale_payload(
            Uuid::new_v4(),
            Some(SOMEBODY_ELSE),
            900_000,
            0,
            900,
            30,
            one_line("KMJ-03", 900_000, 900_000),
        ),
    )
    .await;

    let summary = cloud::customer_summary(&pool, MEMBER)
        .await
        .unwrap_or_else(|e| panic!("summary: {e}"));
    assert_eq!(summary.points_earned_total, 477);
    assert_eq!(summary.transaction_count, 2);
    assert_eq!(summary.spent_minor, 477_000);
    assert_eq!(summary.saved_minor, 30_000);
    assert_eq!(summary.currency.as_deref(), Some("IDR"));
    assert!(summary.first_purchase_at < summary.last_purchase_at);

    let page = cloud::customer_transactions(&pool, MEMBER, CustomerTransactionsQuery::default())
        .await
        .unwrap_or_else(|e| panic!("transactions: {e}"));
    assert_eq!(
        page.transactions.len(),
        2,
        "the other shopper's sale leaked"
    );
    assert_eq!(
        page.transactions[0].total_minor, 129_000,
        "history reads newest first"
    );
    assert_eq!(page.transactions[0].item_count, 1);
    assert_eq!(
        page.transactions[1].item_count, 2,
        "item count is units bought, not lines"
    );
    assert!(page.next_before_sale_id.is_none(), "there is no third page");

    let receipt = cloud::customer_transaction(&pool, MEMBER, page.transactions[1].sale_id)
        .await
        .unwrap_or_else(|e| panic!("receipt: {e}"));
    assert_eq!(receipt.sale.discount_total_minor, 30_000);
    assert_eq!(receipt.lines.len(), 2);
    // What the line was charged, not the shelf price times the quantity — the
    // difference is the promotion, and a receipt that showed the shelf price
    // would not add up to the total beside it.
    assert_eq!(receipt.lines[0].line_total_minor, 169_000);
    assert_eq!(receipt.lines[0].unit_price_minor, 199_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn one_shopper_cannot_read_anothers_receipt(pool: PgPool) {
    let theirs = Uuid::new_v4();
    ingest(
        &pool,
        1,
        sale_payload(
            theirs,
            Some(SOMEBODY_ELSE),
            900_000,
            0,
            900,
            10,
            one_line("KMJ-03", 900_000, 900_000),
        ),
    )
    .await;

    // A sale id is a uuid somebody could hold from an earlier receipt of their
    // own. Asking for one that is not yours must answer the same as asking for
    // one that does not exist: anything else confirms it is real.
    let refused = cloud::customer_transaction(&pool, MEMBER, theirs).await;
    assert!(
        matches!(
            refused,
            Err(inventory_backend::cloud::application::AppError::NotFound(_))
        ),
        "a member read somebody else's receipt: {refused:?}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_anonymous_sale_is_credited_to_nobody(pool: PgPool) {
    ingest(
        &pool,
        1,
        sale_payload(
            Uuid::new_v4(),
            None,
            50_000,
            0,
            50,
            10,
            one_line("KMJ-04", 50_000, 50_000),
        ),
    )
    .await;
    // A till that sends an empty string means the same thing as one that sends
    // nothing: the shopper did not give a card.
    ingest(
        &pool,
        2,
        sale_payload(
            Uuid::new_v4(),
            Some("   "),
            60_000,
            0,
            60,
            5,
            one_line("KMJ-05", 60_000, 60_000),
        ),
    )
    .await;

    let attributed: i64 =
        sqlx::query_scalar("SELECT count(*)::bigint FROM edge_sale WHERE customer_id IS NOT NULL")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("count: {e}"));
    assert_eq!(attributed, 0, "an anonymous sale was credited to somebody");

    // And a blank id is refused as a question rather than quietly matching the
    // anonymous sales, which are most of a shop's takings.
    let refused = cloud::customer_summary(&pool, "   ").await;
    assert!(
        matches!(
            refused,
            Err(inventory_backend::cloud::application::AppError::Validation(
                _
            ))
        ),
        "a blank member id was accepted: {refused:?}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn history_pages_from_a_cursor_and_ends(pool: PgPool) {
    for seq in 1..=5 {
        ingest(
            &pool,
            seq,
            sale_payload(
                Uuid::new_v4(),
                Some(MEMBER),
                10_000 * seq,
                0,
                seq,
                // Newest last, so the page order below is not the insert order.
                100 - seq,
                one_line("KMJ-06", 10_000 * seq, 10_000 * seq),
            ),
        )
        .await;
    }

    let first = cloud::customer_transactions(
        &pool,
        MEMBER,
        CustomerTransactionsQuery {
            limit: Some(2),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|e| panic!("page 1: {e}"));
    assert_eq!(first.transactions.len(), 2);
    assert!(first.next_before_sale_id.is_some());

    let second = cloud::customer_transactions(
        &pool,
        MEMBER,
        CustomerTransactionsQuery {
            limit: Some(2),
            before_occurred_at: first.next_before_occurred_at,
            before_sale_id: first.next_before_sale_id,
        },
    )
    .await
    .unwrap_or_else(|e| panic!("page 2: {e}"));
    assert_eq!(second.transactions.len(), 2);
    let seen: Vec<Uuid> = first
        .transactions
        .iter()
        .chain(second.transactions.iter())
        .map(|sale| sale.sale_id)
        .collect();
    assert_eq!(
        seen.iter().collect::<std::collections::HashSet<_>>().len(),
        4,
        "a page repeated a purchase"
    );

    let third = cloud::customer_transactions(
        &pool,
        MEMBER,
        CustomerTransactionsQuery {
            limit: Some(2),
            before_occurred_at: second.next_before_occurred_at,
            before_sale_id: second.next_before_sale_id,
        },
    )
    .await
    .unwrap_or_else(|e| panic!("page 3: {e}"));
    assert_eq!(third.transactions.len(), 1);
    assert!(
        third.next_before_sale_id.is_none(),
        "the history claimed a page that is not there"
    );

    // Half a cursor is not a cursor: rewinding to the newest page silently
    // would loop a reader through the same purchases forever.
    let refused = cloud::customer_transactions(
        &pool,
        MEMBER,
        CustomerTransactionsQuery {
            limit: Some(2),
            before_occurred_at: None,
            before_sale_id: first.next_before_sale_id,
        },
    )
    .await;
    assert!(
        matches!(
            refused,
            Err(inventory_backend::cloud::application::AppError::Validation(
                _
            ))
        ),
        "half a cursor was accepted: {refused:?}"
    );
}

/// The shop's backlog: numbers a till wrote onto sales that no card was ever
/// enrolled for.
///
/// The segment book has counted these since it existed. What it could not do
/// was name them, so nobody could act on the count — and the act that matters
/// is in the second half of this test.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn enrolling_a_stray_number_hands_over_the_history_it_already_has(pool: PgPool) {
    // A real customer whose card was never enrolled: two sales, two shops.
    // Which is the shape that tells them apart from a slip of the finger.
    for (seq, minutes, total, points, site) in [
        (1_i64, 400_i64, 250_000_i64, 250_i64, ORIGIN),
        (2, 200, 150_000, 150, "store-09"),
    ] {
        let mut payload = sale_payload(
            Uuid::new_v4(),
            Some(MEMBER),
            total,
            0,
            points,
            minutes,
            one_line("KMJ-01", total, total),
        );
        payload["site_id"] = json!(site);
        ingest(&pool, seq, payload).await;
    }
    // And one sale carrying what a mistyped number looks like: once, one shop.
    ingest(
        &pool,
        3,
        sale_payload(
            Uuid::new_v4(),
            Some("M-00012"),
            99_000,
            0,
            99,
            10,
            one_line("KMJ-02", 99_000, 99_000),
        ),
    )
    .await;

    let strays = cloud::list_unenrolled(&pool, None)
        .await
        .unwrap_or_else(|e| panic!("unenrolled: {e}"));
    assert_eq!(strays.unenrolled_count, 2, "{:?}", strays.strangers);
    assert_eq!(strays.unenrolled_spent_minor, 499_000);
    // Largest first, because what is at stake is the size of what enrolling
    // one would hand back.
    assert_eq!(strays.strangers[0].customer_id, MEMBER);
    assert_eq!(strays.strangers[0].transaction_count, 2);
    assert_eq!(strays.strangers[0].points_earned_total, 400);
    assert_eq!(
        strays.strangers[0].site_count, 2,
        "the column that says this is a customer rather than a typing mistake"
    );
    assert_eq!(
        strays.strangers[1].transaction_count, 1,
        "the mistyped number should be listed too — it cannot be repaired, but \
         it can at least be seen"
    );
    assert_eq!(strays.strangers[1].site_count, 1);

    // The act. Nothing is rewritten and no sale is touched.
    cloud::enrol_member(&pool, MEMBER, None)
        .await
        .unwrap_or_else(|e| panic!("enrol: {e}"));

    let summary = cloud::customer_summary(&pool, MEMBER)
        .await
        .unwrap_or_else(|e| panic!("summary: {e}"));
    assert_eq!(
        summary.points_earned_total, 400,
        "enrolling a number that already had sales did not hand over its history"
    );
    assert_eq!(summary.spent_minor, 400_000);

    let after = cloud::list_unenrolled(&pool, None)
        .await
        .unwrap_or_else(|e| panic!("unenrolled after: {e}"));
    assert_eq!(
        after.unenrolled_count, 1,
        "the adopted number is still counted as a stranger"
    );
    assert_eq!(after.strangers[0].customer_id, "M-00012");
}
