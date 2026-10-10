//! Head office, told what its promotions are doing — proved against Postgres.
//!
//! Three things are fixed here:
//!
//!  * the usage message says how far each shop's stream had been applied when
//!    it was counted, read in one snapshot with the counts, and never vouches
//!    for a new generation while an older one is still behind — a till deletes
//!    its own count of a sale on the strength of it (edge `0043`);
//!  * a crossed budget is recorded and announced once, and the fleet is sent
//!    the new count at once rather than on the next beat;
//!  * the marketing scheduler reports a shop that could not apply a price book,
//!    one that has said nothing about it, one behind on its messages, and
//!    tomorrow's starts — each exactly once.

use chrono::{Duration, NaiveTime, Utc};
use inventory_backend::cloud::{
    application::{CommandRequest, CommercialCampaignInput, CreateCommercialPublicationRequest},
    domain::{IngestBatch, SyncFact, COMMAND_COMMERCIAL_USAGE, FACT_PUBLICATION_ACTIVATION_FAILED},
    postgres as cloud,
};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

const ORIGIN: &str = "store-07";

async fn register_shop(pool: &PgPool) {
    cloud::register_origin_credential_binding(
        pool,
        ORIGIN,
        &format!("{ORIGIN}-marketing-watch-sync-key-000001"),
        Some("Toko Tujuh"),
        Some(ORIGIN),
        Some("STORE"),
        Some(1),
        Some(true),
    )
    .await
    .unwrap_or_else(|error| panic!("register {ORIGIN}: {error}"));
}

async fn head_office(pool: &PgPool) {
    sqlx::query(
        "INSERT INTO app_user (id, username, display_name, password_hash, role, created_by)
         VALUES ($1, 'kantor', 'Kantor Pusat', 'x', 'ADMIN', 'test')",
    )
    .bind(Uuid::new_v4())
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("admin: {error}"));
}

/// Publish a book carrying one campaign, and return its id.
async fn publish_campaign(
    pool: &PgPool,
    version: i64,
    budget_minor: Option<i64>,
    valid_from: Option<chrono::DateTime<Utc>>,
) -> Uuid {
    let created = cloud::create_commercial_publication(
        pool,
        CreateCommercialPublicationRequest {
            change_type: None,
            version,
            name: format!("Kampanye v{version}"),
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
                valid_from,
                valid_to: None,
                budget_minor,
                max_uses: None,
                site_ids: Vec::new(),
                image_url: None,
                headline: None,
                terms: None,
            }],
            actor_id: "kantor".into(),
            idempotency_key: format!("draft-{version}"),
        },
    )
    .await
    .unwrap_or_else(|error| panic!("draft {version}: {error}"));
    let id: Uuid = created["id"]
        .as_str()
        .unwrap_or_else(|| panic!("no id: {created}"))
        .parse()
        .unwrap_or_else(|error| panic!("id: {error}"));
    cloud::publish_commercial_publication(
        pool,
        id,
        CommandRequest {
            actor_id: "kantor".into(),
            idempotency_key: format!("publish-{version}"),
        },
    )
    .await
    .unwrap_or_else(|error| panic!("publish {version}: {error}"));
    id
}

async fn set_usage(pool: &PgPool, kind: &str, key: &str, uses: i64, spent: i64) {
    sqlx::query(
        "INSERT INTO commercial_usage (kind, key, uses, spent_minor)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (kind, key) DO UPDATE
            SET uses = EXCLUDED.uses, spent_minor = EXCLUDED.spent_minor,
                last_used_at = now()",
    )
    .bind(kind)
    .bind(key)
    .bind(uses)
    .bind(spent)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("usage: {error}"));
}

async fn notices(pool: &PgPool, kind: &str) -> Vec<(String, String)> {
    sqlx::query_as("SELECT title, body FROM notification WHERE kind = $1 ORDER BY created_at")
        .bind(kind)
        .fetch_all(pool)
        .await
        .unwrap_or_else(|error| panic!("notices: {error}"))
}

async fn usage_messages(pool: &PgPool) -> Vec<Value> {
    sqlx::query_scalar(
        "SELECT payload FROM sync_command WHERE command_type = $1 ORDER BY issued_at",
    )
    .bind(COMMAND_COMMERCIAL_USAGE)
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("messages: {error}"))
}

async fn set_positions(pool: &PgPool, generation: i64, durable: i64, applied: i64) {
    sqlx::query(
        "INSERT INTO sync_ingest_watermark (origin_id, generation, durable_seq)
         VALUES ($1, $2, $3)
         ON CONFLICT (origin_id, generation) DO UPDATE SET durable_seq = EXCLUDED.durable_seq",
    )
    .bind(ORIGIN)
    .bind(generation)
    .bind(durable)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("ingest watermark: {error}"));
    sqlx::query(
        "INSERT INTO sync_applied_watermark (origin_id, generation, applied_seq)
         VALUES ($1, $2, $3)
         ON CONFLICT (origin_id, generation) DO UPDATE SET applied_seq = EXCLUDED.applied_seq",
    )
    .bind(ORIGIN)
    .bind(generation)
    .bind(applied)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("applied watermark: {error}"));
}

// ── the usage message ───────────────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_count_says_how_far_each_stream_had_been_applied(pool: PgPool) {
    register_shop(&pool).await;
    set_positions(&pool, 1, 7, 7).await;
    set_usage(&pool, "RULE", "R1", 3, 30_000).await;

    cloud::publish_commercial_usage_to_fleet(&pool, "test")
        .await
        .unwrap_or_else(|error| panic!("send: {error}"));

    let messages = usage_messages(&pool).await;
    let payload = messages.last().unwrap_or_else(|| panic!("nothing sent"));
    assert_eq!(
        payload["applied_through"],
        json!([{ "origin_id": ORIGIN, "generation": 1, "applied_seq": 7 }])
    );
    // And it still passes the parser every till runs it through.
    inventory_backend::cloud::domain::parse_commercial_usage(payload)
        .unwrap_or_else(|error| panic!("a till would refuse this: {error}"));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_newer_generation_is_not_vouched_for_while_an_older_one_is_behind(pool: PgPool) {
    register_shop(&pool).await;
    // Generation 1 received five and applied three; generation 2 is ahead of
    // it. A fact renumbered into 2 but held under 1 is counted when 1 reaches
    // it, so 2's position cannot yet tell a till to stop counting.
    set_positions(&pool, 1, 5, 3).await;
    set_positions(&pool, 2, 4, 4).await;

    cloud::publish_commercial_usage_to_fleet(&pool, "test")
        .await
        .unwrap_or_else(|error| panic!("send: {error}"));
    let payload = usage_messages(&pool).await.pop().unwrap_or_default();
    assert_eq!(
        payload["applied_through"],
        json!([
            { "origin_id": ORIGIN, "generation": 1, "applied_seq": 3 },
            { "origin_id": ORIGIN, "generation": 2, "applied_seq": 0 },
        ])
    );

    // Once 1 has caught up, 2 is vouched for.
    set_positions(&pool, 1, 5, 5).await;
    cloud::publish_commercial_usage_to_fleet(&pool, "test")
        .await
        .unwrap_or_else(|error| panic!("send: {error}"));
    let payload = usage_messages(&pool).await.pop().unwrap_or_default();
    assert_eq!(payload["applied_through"][1]["applied_seq"], 4);
}

// ── the usage watch ─────────────────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_spent_budget_is_announced_once_and_counted_out_at_once(pool: PgPool) {
    register_shop(&pool).await;
    head_office(&pool).await;
    publish_campaign(&pool, 900, Some(1_000_000), None).await;
    let mut watch = cloud::UsageWatch::default();

    // A first tick with nothing crossed sends the first count and says nothing.
    set_usage(&pool, "CAMPAIGN", "LEBARAN", 5, 500_000).await;
    let first = cloud::watch_commercial_usage(&pool, &mut watch)
        .await
        .unwrap_or_else(|error| panic!("tick: {error}"));
    assert_eq!(first.announced, 0);
    assert!(first.sent.is_some(), "the first count goes out");

    // The budget runs out. Announced once, as used up rather than "nearly",
    // and the count goes out now — not on a beat minutes away.
    set_usage(&pool, "CAMPAIGN", "LEBARAN", 9, 1_000_000).await;
    sqlx::query("UPDATE sync_command SET issued_at = issued_at - interval '1 minute'")
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("age: {error}"));
    // The watch remembers when it last sent; start it afresh so it re-reads
    // the aged command log rather than its own clock.
    let mut watch = cloud::UsageWatch::default();
    let crossed = cloud::watch_commercial_usage(&pool, &mut watch)
        .await
        .unwrap_or_else(|error| panic!("tick: {error}"));
    assert_eq!(crossed.announced, 1);
    assert!(crossed.sent.is_some(), "a crossing is sent at once");
    let used_up = notices(&pool, "commercial.cap.reached").await;
    assert_eq!(used_up.len(), 1, "{used_up:?}");
    assert_eq!(
        used_up[0].0,
        "Campaign \u{201c}Lebaran\u{201d} has used its whole budget"
    );
    assert!(
        notices(&pool, "commercial.cap.near").await.is_empty(),
        "a count that jumped past both lines says the higher one"
    );

    // Nothing changes: nothing is said and nothing is sent.
    let quiet = cloud::watch_commercial_usage(&pool, &mut watch)
        .await
        .unwrap_or_else(|error| panic!("tick: {error}"));
    assert_eq!(quiet.announced, 0);
    assert!(quiet.sent.is_none());

    // More sales past the line: not news, and the count waits for its beat.
    set_usage(&pool, "CAMPAIGN", "LEBARAN", 10, 1_050_000).await;
    let again = cloud::watch_commercial_usage(&pool, &mut watch)
        .await
        .unwrap_or_else(|error| panic!("tick: {error}"));
    assert_eq!(again.announced, 0);
    assert!(
        again.sent.is_none(),
        "changed, but the last count is seconds old"
    );
    assert_eq!(notices(&pool, "commercial.cap.reached").await.len(), 1);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_budget_topped_up_is_news_again_at_its_new_line(pool: PgPool) {
    register_shop(&pool).await;
    head_office(&pool).await;
    publish_campaign(&pool, 901, Some(1_000_000), None).await;
    set_usage(&pool, "CAMPAIGN", "LEBARAN", 9, 1_000_000).await;
    cloud::watch_commercial_usage(&pool, &mut cloud::UsageWatch::default())
        .await
        .unwrap_or_else(|error| panic!("tick: {error}"));

    // A later book raises the budget to two million, and the spending goes on.
    publish_campaign(&pool, 902, Some(2_000_000), None).await;
    set_usage(&pool, "CAMPAIGN", "LEBARAN", 15, 1_700_000).await;
    let report = cloud::watch_commercial_usage(&pool, &mut cloud::UsageWatch::default())
        .await
        .unwrap_or_else(|error| panic!("tick: {error}"));
    assert_eq!(report.announced, 1);
    let near = notices(&pool, "commercial.cap.near").await;
    assert_eq!(near.len(), 1, "{near:?}");
    assert_eq!(near[0].1, "Rp 1.700.000 of Rp 2.000.000 given away.");
}

// ── the marketing scheduler ─────────────────────────────────────────────────

async fn report_failure(pool: &PgPool, publication_id: Uuid, version: i64) {
    cloud::ingest_batch(
        pool,
        &IngestBatch {
            origin_id: ORIGIN.into(),
            generation: 1,
            facts: vec![SyncFact {
                seq: 1,
                event_id: Uuid::new_v4(),
                event_type: FACT_PUBLICATION_ACTIVATION_FAILED.into(),
                payload: json!({
                    "publication_id": publication_id,
                    "version": version,
                    "attempted_at": Utc::now(),
                    "error": "unknown tax category PPN11",
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

fn job<'a>(results: &'a [cloud::SchedulerJobResult], name: &str) -> &'a cloud::SchedulerJobResult {
    results
        .iter()
        .find(|result| result.job == name)
        .unwrap_or_else(|| panic!("no {name} in {results:?}"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_shop_that_could_not_apply_a_book_is_reported_once(pool: PgPool) {
    register_shop(&pool).await;
    head_office(&pool).await;
    let book = publish_campaign(&pool, 910, None, None).await;
    report_failure(&pool, book, 910).await;

    let today = inventory_backend::reporting::local_today();
    let first = cloud::run_marketing_watch(&pool, Utc::now(), today, false).await;
    assert_eq!(
        job(&first, "marketing.rollout_failed").detail["raised"],
        1,
        "{first:?}"
    );
    let failed = notices(&pool, "commercial.rollout.failed").await;
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].0, "Toko Tujuh could not apply a price book");
    assert!(
        failed[0]
            .1
            .ends_with("The shop said: unknown tax category PPN11"),
        "{}",
        failed[0].1
    );

    let second = cloud::run_marketing_watch(&pool, Utc::now(), today, false).await;
    assert_eq!(job(&second, "marketing.rollout_failed").detail["raised"], 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_silent_shop_is_reported_after_half_an_hour_and_not_before(pool: PgPool) {
    register_shop(&pool).await;
    head_office(&pool).await;
    publish_campaign(&pool, 920, None, None).await;
    let today = inventory_backend::reporting::local_today();

    let early = cloud::run_marketing_watch(&pool, Utc::now(), today, false).await;
    assert_eq!(job(&early, "marketing.rollout_stalled").detail["raised"], 0);
    assert_eq!(job(&early, "marketing.usage_stale").detail["raised"], 0);

    let later = Utc::now() + Duration::minutes(31);
    let late = cloud::run_marketing_watch(&pool, later, today, false).await;
    assert_eq!(
        job(&late, "marketing.rollout_stalled").detail["raised"],
        1,
        "{late:?}"
    );
    assert_eq!(
        job(&late, "marketing.usage_stale").detail["raised"],
        1,
        "the book is also a message the shop has not taken"
    );
    assert_eq!(
        notices(&pool, "commercial.rollout.stalled").await[0].0,
        "Toko Tujuh has not applied a price book"
    );

    let again = cloud::run_marketing_watch(&pool, later, today, false).await;
    assert_eq!(job(&again, "marketing.rollout_stalled").detail["raised"], 0);
    assert_eq!(job(&again, "marketing.usage_stale").detail["raised"], 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn tomorrows_start_is_said_once_the_day_before(pool: PgPool) {
    head_office(&pool).await;
    let today = inventory_backend::reporting::local_today();
    let tomorrow = today + Duration::days(1);
    // Ten in the morning tomorrow, in the estate's own offset.
    let starts = (tomorrow.and_time(NaiveTime::from_hms_opt(10, 0, 0).unwrap_or_default())
        - Duration::minutes(i64::from(
            inventory_backend::reporting::DEFAULT_UTC_OFFSET_MINUTES,
        )))
    .and_utc();
    publish_campaign(&pool, 930, None, Some(starts)).await;

    let first = cloud::run_marketing_watch(&pool, Utc::now(), today, false).await;
    assert_eq!(
        job(&first, "marketing.calendar").detail["raised"],
        1,
        "{first:?}"
    );
    assert_eq!(
        notices(&pool, "commercial.promotion.starting").await[0].0,
        "Campaign \u{201c}Lebaran\u{201d} starts tomorrow"
    );
    let second = cloud::run_marketing_watch(&pool, Utc::now(), today, false).await;
    assert_eq!(job(&second, "marketing.calendar").detail["raised"], 0);
}

// ── the hard cap ────────────────────────────────────────────────────────────

async fn register_as(pool: &PgPool, origin: &str) {
    cloud::register_origin_credential_binding(
        pool,
        origin,
        &format!("{origin}-marketing-watch-sync-key-000001"),
        Some(origin),
        Some(origin),
        Some("STORE"),
        Some(1),
        Some(true),
    )
    .await
    .unwrap_or_else(|error| panic!("register {origin}: {error}"));
}

/// A sale at `origin` on which the Lebaran campaign took `benefit` off.
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
                event_type: inventory_backend::cloud::domain::FACT_SALES_COMPLETED.into(),
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

fn granted(view: &cloud::CapAllocationView, origin: &str) -> Option<i64> {
    view.shops
        .iter()
        .find(|shop| shop.origin_id == origin)
        .and_then(|shop| shop.budget_granted)
}

async fn split_lebaran(pool: &PgPool, enabled: bool) -> cloud::CapAllocationView {
    cloud::set_cap_allocation(
        pool,
        "CAMPAIGN",
        "LEBARAN",
        cloud::CapAllocationRequest { enabled },
        "kantor",
    )
    .await
    .unwrap_or_else(|error| panic!("split: {error}"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_split_limit_is_granted_half_evenly_and_sent_with_the_count(pool: PgPool) {
    register_as(&pool, "store-07").await;
    register_as(&pool, "store-08").await;
    publish_campaign(&pool, 940, Some(1_000_000), None).await;

    let view = split_lebaran(&pool, true).await;
    assert!(view.enabled);
    assert_eq!(granted(&view, "store-07"), Some(250_000));
    assert_eq!(granted(&view, "store-08"), Some(250_000));
    assert_eq!(
        view.budget_pool,
        Some(500_000),
        "half kept for whoever turns out busy"
    );

    let payload = usage_messages(&pool).await.pop().unwrap_or_default();
    let allowances = payload["allowances"]
        .as_array()
        .unwrap_or_else(|| panic!("no allowances in {payload}"));
    assert_eq!(allowances.len(), 2);
    assert_eq!(allowances[0]["budget_minor"], 250_000);
    assert_eq!(allowances[0]["own_spent_minor"], 0);
    inventory_backend::cloud::domain::parse_commercial_usage(&payload)
        .unwrap_or_else(|error| panic!("a till would refuse this: {error}"));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_busy_shop_is_topped_up_and_no_grant_is_ever_taken_back(pool: PgPool) {
    register_as(&pool, "store-07").await;
    register_as(&pool, "store-08").await;
    publish_campaign(&pool, 941, Some(1_000_000), None).await;
    split_lebaran(&pool, true).await;

    // Store 07 gives away two hundred of its two hundred and fifty.
    sell_at(&pool, "store-07", 1, 200_000).await;
    let regranted = cloud::rebalance_allocations(&pool)
        .await
        .unwrap_or_else(|error| panic!("rebalance: {error}"));
    assert_eq!(regranted, 1);
    let view = cloud::cap_allocation(&pool, "CAMPAIGN", "LEBARAN")
        .await
        .unwrap_or_else(|error| panic!("view: {error}"));
    assert_eq!(
        granted(&view, "store-07"),
        Some(500_000),
        "one more first share"
    );
    assert_eq!(
        granted(&view, "store-08"),
        Some(250_000),
        "nobody has sold there"
    );
    let seven = view
        .shops
        .iter()
        .find(|shop| shop.origin_id == "store-07")
        .unwrap_or_else(|| panic!("store-07"));
    assert_eq!(seven.own_spent_minor, 200_000);

    // Whatever code tries, an allowance never shrinks.
    let shrink = sqlx::query(
        "UPDATE commercial_cap_allocation SET granted = 1 WHERE origin_id = 'store-08'",
    )
    .execute(&pool)
    .await;
    assert!(shrink.is_err(), "the table refuses a grant that shrinks");
    let withdraw = sqlx::query("DELETE FROM commercial_cap_allocation")
        .execute(&pool)
        .await;
    assert!(withdraw.is_err(), "and one withdrawn");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_limit_too_small_to_split_is_refused(pool: PgPool) {
    register_as(&pool, "store-07").await;
    register_as(&pool, "store-08").await;
    publish_campaign(&pool, 942, Some(1), None).await;
    let refused = cloud::set_cap_allocation(
        &pool,
        "CAMPAIGN",
        "LEBARAN",
        cloud::CapAllocationRequest { enabled: true },
        "kantor",
    )
    .await;
    assert!(
        refused.is_err(),
        "each shop would start with nothing and never sell"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_split_switched_off_stops_sending_allowances_and_keeps_the_grants(pool: PgPool) {
    register_as(&pool, "store-07").await;
    publish_campaign(&pool, 943, Some(1_000_000), None).await;
    split_lebaran(&pool, true).await;

    let view = split_lebaran(&pool, false).await;
    assert!(!view.enabled);
    assert_eq!(
        granted(&view, "store-07"),
        Some(500_000),
        "kept, so switching back on does not grant the limit twice"
    );
    let payload = usage_messages(&pool).await.pop().unwrap_or_default();
    assert_eq!(
        payload["allowances"],
        json!([]),
        "the shops go back to the fleet's count"
    );
}
