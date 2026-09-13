//! What the offers did, measured from the sale facts.
//!
//! These read the three Performa endpoints' SQL directly rather than over HTTP,
//! because what is worth pinning down is the arithmetic, and the arithmetic has
//! exactly three ways to be quietly wrong: a basket counted twice when two
//! rules of one campaign both fired on it, a window that includes the sale it
//! is being compared against, and a "new customer" who has been shopping with
//! us for years. Each has a test below.
//!
//! `sqlx::test` builds a throwaway database per test and drops it afterwards,
//! so nothing here can leave a fixture behind in a database somebody is using.

use chrono::{DateTime, Duration, TimeZone, Utc};
use inventory_backend::cloud::domain::CommercialChannel;
use inventory_backend::cloud::postgres::{
    article_prices, campaign_performance, pricelist_performance, rule_performance,
    ArticlePriceScope, PerformanceWindow,
};
use serde_json::Value;
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// Midnight UTC, so the day buckets in a series fall where a reader expects.
fn base() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 5, 10, 0, 0, 0)
        .single()
        .unwrap_or_else(|| panic!("base instant"))
}

/// The window under test: two days, with two days of history behind it.
fn window() -> PerformanceWindow {
    PerformanceWindow::resolve(Some(base()), Some(base() + Duration::days(2)), None)
        .unwrap_or_else(|e| panic!("window: {e}"))
}

fn at_site(site: &str) -> PerformanceWindow {
    PerformanceWindow::resolve(Some(base()), Some(base() + Duration::days(2)), Some(site))
        .unwrap_or_else(|e| panic!("window: {e}"))
}

/// One book, published, carrying two campaigns, three rules and a coupon.
///
/// Written as a DRAFT and then published, because the triggers refuse to let a
/// published book grow a rule — which is the point of them.
///
/// The version is taken from whatever is already there rather than written as
/// `1`, because a migrated database is not an empty one:
/// `0003_commercial_sales.sql:194` seeds a published version 1, so a literal
/// collides with `commercial_publication_version_key` before a single number in
/// this file is measured.
async fn publish_book(pool: &PgPool) {
    let book = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO commercial_publication
             (id, version, name, status, effective_from, created_by)
         VALUES ($1, (SELECT coalesce(max(version), 0) + 1 FROM commercial_publication),
                 'Raya 2026', 'DRAFT', $2, 'test')",
    )
    .bind(book)
    .bind(base() - Duration::days(30))
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("book: {e}"));

    for (id, name, status, budget, uses) in [
        (
            "CAMP-RAYA",
            "Lebaran Sale",
            "ACTIVE",
            Some(5_000_000i64),
            Some(100i32),
        ),
        // Declared and never used. It must still appear, at zero.
        ("CAMP-QUIET", "Ramadan Teaser", "EXPIRED", None, None),
    ] {
        sqlx::query(
            "INSERT INTO commercial_campaign
                 (id, publication_id, campaign_id, name, status, valid_from, valid_to,
                  budget_minor, max_uses)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        )
        .bind(Uuid::new_v4())
        .bind(book)
        .bind(id)
        .bind(name)
        .bind(status)
        .bind(base() - Duration::days(7))
        .bind(base() + Duration::days(7))
        .bind(budget)
        .bind(uses)
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("campaign {id}: {e}"));
    }

    for (id, name, campaign) in [
        ("RULE-RAYA-10", "10% Lebaran", Some("CAMP-RAYA")),
        ("RULE-BUNDLE", "Beli 2 hemat", Some("CAMP-RAYA")),
        ("RULE-SOLO", "Kupon hemat", None),
    ] {
        let definition = match campaign {
            Some(campaign) => serde_json::json!({
                "campaign_id": campaign,
                "caps": { "budget": { "minor": 1_000_000 }, "max_uses": 50 },
            }),
            None => serde_json::json!({ "caps": {} }),
        };
        sqlx::query(
            "INSERT INTO commercial_rule
                 (id, publication_id, rule_id, name, definition, status, priority)
             VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 10)",
        )
        .bind(Uuid::new_v4())
        .bind(book)
        .bind(id)
        .bind(name)
        .bind(definition)
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("rule {id}: {e}"));
    }

    sqlx::query(
        "INSERT INTO commercial_coupon (id, publication_id, code, rule_id, max_uses)
         VALUES ($1, $2, 'HEMAT10', 'RULE-SOLO', 500)",
    )
    .bind(Uuid::new_v4())
    .bind(book)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("coupon: {e}"));

    sqlx::query(
        "UPDATE commercial_publication
            SET status = 'PUBLISHED', published_by = 'test', published_at = $2
          WHERE id = $1",
    )
    .bind(book)
    .bind(base() - Duration::days(30))
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("publish: {e}"));
}

/// A style with two sizes, so the pricelist report has something to group.
async fn catalogue(pool: &PgPool) {
    let article = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO article (id, article_code, name) VALUES ($1, 'ART-TEE', 'Kaos Polos')",
    )
    .bind(article)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("article: {e}"));
    for code in ["TEE-01-M", "TEE-01-L"] {
        sqlx::query("INSERT INTO sku (id, article_id, sku_code) VALUES ($1, $2, $3)")
            .bind(Uuid::new_v4())
            .bind(article)
            .bind(code)
            .execute(pool)
            .await
            .unwrap_or_else(|e| panic!("sku {code}: {e}"));
    }
}

/// One sale as the centre stores it, with its line and whatever came off it.
#[allow(clippy::too_many_arguments)]
async fn sell(
    pool: &PgPool,
    seq: i64,
    site: &str,
    occurred_at: DateTime<Utc>,
    customer: Option<&str>,
    line: (&str, i64, i64, &str),
    promotions: &[(&str, Option<&str>, Option<&str>, i64)],
) -> Uuid {
    let (sku_code, quantity, unit_price, source) = line;
    let total = unit_price * quantity;
    let sale = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO edge_sale
             (sale_id, origin_id, generation, seq, movement_group_id, site_id, actor_id,
              occurred_at, currency, total_minor, paid_minor, change_minor, customer_id)
         VALUES ($1, $2, 1, $3, $4, $5, 'kasir', $6, 'IDR', $7, $7, 0, $8)",
    )
    .bind(sale)
    .bind(format!("{site}-edge"))
    .bind(seq)
    .bind(Uuid::new_v4())
    .bind(site)
    .bind(occurred_at)
    .bind(total)
    .bind(customer)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("sale: {e}"));

    sqlx::query(
        "INSERT INTO edge_sale_line
             (sale_id, subject_id, epc, sku_code, quantity, unit_price_minor,
              line_total_minor, price_source, publication_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)",
    )
    .bind(sale)
    .bind(Uuid::new_v4())
    .bind(format!("EPC-{seq}"))
    .bind(sku_code)
    .bind(quantity)
    .bind(unit_price)
    .bind(total)
    .bind(source)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("line: {e}"));

    for (rule, campaign, coupon, benefit) in promotions {
        sqlx::query(
            "INSERT INTO edge_sale_promotion
                 (sale_id, rule_id, campaign_id, coupon_code, benefit_minor)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(sale)
        .bind(rule)
        .bind(*campaign)
        .bind(*coupon)
        .bind(benefit)
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("promotion {rule}: {e}"));
    }
    sale
}

/// Five sales: three in the window under one campaign, one on a coupon, and
/// one in the window before, which is what the comparison is drawn against.
///
/// `C-OLD` first shopped in the previous window and `C-NEW` inside this one, so
/// exactly one of the two is a new customer — and it is not the one who bought
/// the most.
async fn sales(pool: &PgPool) {
    let day1 = base() + Duration::hours(9);
    let day2 = base() + Duration::hours(33);
    let earlier = base() - Duration::hours(12);

    // A basket two rules of the SAME campaign both fired on. One sale, one
    // basket of revenue, both benefits.
    sell(
        pool,
        1,
        "store-01",
        day1,
        Some("C-NEW"),
        ("TEE-01-M", 1, 200_000, "COMPANY_PRICE"),
        &[
            ("RULE-RAYA-10", Some("CAMP-RAYA"), None, 20_000),
            ("RULE-BUNDLE", Some("CAMP-RAYA"), None, 5_000),
        ],
    )
    .await;
    sell(
        pool,
        2,
        "store-01",
        day1,
        Some("C-OLD"),
        ("TEE-01-L", 1, 150_000, "MARKDOWN"),
        &[("RULE-RAYA-10", Some("CAMP-RAYA"), None, 15_000)],
    )
    .await;
    // Anonymous: it counts as a sale and as revenue, and as nobody.
    sell(
        pool,
        3,
        "store-02",
        day2,
        None,
        ("TEE-01-M", 2, 150_000, "MARKDOWN"),
        &[("RULE-RAYA-10", Some("CAMP-RAYA"), None, 30_000)],
    )
    .await;
    sell(
        pool,
        4,
        "store-02",
        day2,
        Some("C-NEW"),
        ("TEE-01-L", 1, 100_000, "COMPANY_PRICE"),
        &[("RULE-SOLO", None, Some("HEMAT10"), 10_000)],
    )
    .await;
    // The window before. C-OLD's first purchase ever, which is what stops them
    // counting as new in the window under test.
    sell(
        pool,
        5,
        "store-01",
        earlier,
        Some("C-OLD"),
        ("TEE-01-M", 2, 250_000, "COMPANY_PRICE"),
        &[("RULE-RAYA-10", Some("CAMP-RAYA"), None, 50_000)],
    )
    .await;
}

fn find<'a>(items: &'a Value, key: &str) -> &'a Value {
    items
        .as_array()
        .unwrap_or_else(|| panic!("expected a list, got {items}"))
        .iter()
        .find(|item| item["key"] == key)
        .unwrap_or_else(|| panic!("no {key} in {items}"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_campaign_reports_what_it_gave_away_and_what_came_back(pool: PgPool) {
    publish_book(&pool).await;
    catalogue(&pool).await;
    sales(&pool).await;

    let body = campaign_performance(&pool, &window())
        .await
        .unwrap_or_else(|e| panic!("campaigns: {e}"));

    // The label that says how to read the revenue below it.
    assert_eq!(body["attribution"], "BASKET");
    assert!(body["as_of"].is_string());

    let raya = find(&body["campaigns"], "CAMP-RAYA");
    assert_eq!(raya["name"], "Lebaran Sale");
    assert_eq!(raya["status"], "ACTIVE");
    assert_eq!(raya["budget_minor"], 5_000_000);
    assert_eq!(raya["max_uses"], 100);
    assert_eq!(raya["benefit_minor"], 70_000);
    // Three sales, not four: the first basket had two of this campaign's rules
    // on it and is still one sale.
    assert_eq!(raya["sale_count"], 3);
    assert_eq!(raya["basket_revenue_minor"], 650_000);
    assert_eq!(raya["customer_count"], 2, "the anonymous sale is nobody");
    assert_eq!(raya["new_customer_count"], 1, "C-OLD bought here before");

    // No ratio is shipped; the two integers that make it are.
    assert!(raya.get("roas").is_none());
    assert!(raya.get("return_per_rupiah").is_none());

    let previous = &raya["previous"];
    assert_eq!(previous["benefit_minor"], 50_000);
    assert_eq!(previous["sale_count"], 1);
    assert_eq!(previous["basket_revenue_minor"], 500_000);
    assert_eq!(previous["new_customer_count"], 1, "C-OLD was new then");

    let series = raya["series"]
        .as_array()
        .unwrap_or_else(|| panic!("series: {raya}"));
    assert_eq!(series.len(), 2, "two days of trading: {series:?}");
    assert_eq!(series[0]["day"], "2026-05-10");
    assert_eq!(series[0]["benefit_minor"], 40_000);
    assert_eq!(series[0]["sale_count"], 2);
    assert_eq!(series[0]["basket_revenue_minor"], 350_000);
    assert_eq!(series[1]["day"], "2026-05-11");
    assert_eq!(series[1]["benefit_minor"], 30_000);

    // Declared, never used. Present at zero rather than missing: a campaign
    // that gave nothing away is a finding.
    let quiet = find(&body["campaigns"], "CAMP-QUIET");
    assert_eq!(quiet["benefit_minor"], 0);
    assert_eq!(quiet["sale_count"], 0);
    assert_eq!(quiet["basket_revenue_minor"], 0);
    assert_eq!(quiet["name"], "Ramadan Teaser");
    assert_eq!(quiet["series"], serde_json::json!([]));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn one_shops_numbers_are_only_that_shops(pool: PgPool) {
    publish_book(&pool).await;
    catalogue(&pool).await;
    sales(&pool).await;

    let body = campaign_performance(&pool, &at_site("store-01"))
        .await
        .unwrap_or_else(|e| panic!("campaigns: {e}"));
    assert_eq!(body["site_id"], "store-01");
    let raya = find(&body["campaigns"], "CAMP-RAYA");
    // Both of the campaign's rules fired on the first basket, so store-01 gave
    // away 20_000 + 5_000 there and 15_000 on the second — 40_000, of the
    // fleet's 70_000. Counting the bundle here is the same choice the fleet
    // number makes; leaving it out would make two shops fail to add up to the
    // company.
    assert_eq!(raya["benefit_minor"], 40_000);
    // Still two baskets, though: three promotion rows, two sales.
    assert_eq!(raya["sale_count"], 2);
    assert_eq!(raya["basket_revenue_minor"], 350_000);
    // A shopper is a person, not a branch: C-NEW is new to the company, and
    // would be new here whichever counter they reached.
    assert_eq!(raya["new_customer_count"], 1);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_rule_and_the_coupon_that_unlocks_it_are_counted_apart(pool: PgPool) {
    publish_book(&pool).await;
    catalogue(&pool).await;
    sales(&pool).await;

    let body = rule_performance(&pool, &window())
        .await
        .unwrap_or_else(|e| panic!("rules: {e}"));
    assert_eq!(body["attribution"], "BASKET");

    let raya = find(&body["rules"], "RULE-RAYA-10");
    assert_eq!(raya["name"], "10% Lebaran");
    assert_eq!(raya["campaign_id"], "CAMP-RAYA");
    assert_eq!(raya["budget_minor"], 1_000_000);
    assert_eq!(raya["benefit_minor"], 65_000);
    assert_eq!(raya["sale_count"], 3);
    assert_eq!(raya["basket_revenue_minor"], 650_000);

    // The other rule on that first basket. Its own benefit, and the SAME
    // basket's revenue — which is what basket attribution means and why the
    // rules do not add up to the campaign's revenue.
    let bundle = find(&body["rules"], "RULE-BUNDLE");
    assert_eq!(bundle["benefit_minor"], 5_000);
    assert_eq!(bundle["sale_count"], 1);
    assert_eq!(bundle["basket_revenue_minor"], 200_000);

    let coupon = find(&body["coupons"], "HEMAT10");
    assert_eq!(coupon["rule_id"], "RULE-SOLO");
    assert_eq!(coupon["max_uses"], 500);
    assert_eq!(coupon["benefit_minor"], 10_000);
    assert_eq!(coupon["sale_count"], 1);
    assert_eq!(coupon["basket_revenue_minor"], 100_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_style_reports_every_price_it_actually_sold_at(pool: PgPool) {
    publish_book(&pool).await;
    catalogue(&pool).await;
    sales(&pool).await;

    // Two orders for the style and one cancelled. The newest agreed price is
    // the cost basis; the cancelled one was never a cost at all.
    for (number, status, price, days_ago) in [
        ("PO-OLD", "CLOSED", 80_000i64, 90i64),
        ("PO-NEW", "ISSUED", 90_000, 10),
        ("PO-VOID", "CANCELLED", 999_999, 1),
    ] {
        let order = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO purchase_order
                 (purchase_order_id, po_number, supplier_id, destination_site_id, origin_kind,
                  order_status, currency, created_by, created_at, issued_at)
             VALUES ($1, $2, 'SUP-1', 'dc', 'DIRECT', $3, 'IDR', 'test', $4, $4)",
        )
        .bind(order)
        .bind(number)
        .bind(status)
        .bind(base() - Duration::days(days_ago))
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("order {number}: {e}"));
        sqlx::query(
            "INSERT INTO purchase_order_line
                 (po_line_id, purchase_order_id, line_number, article_code, article_name,
                  ordered_quantity, unit_price_minor, line_amount_minor)
             VALUES ($1, $2, 1, 'ART-TEE', 'Kaos Polos', 10, $3, $3 * 10)",
        )
        .bind(Uuid::new_v4())
        .bind(order)
        .bind(price)
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("order line {number}: {e}"));
    }

    // Seven on the floor at store-01, so sell-through has a denominator.
    let subject = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO inventory_subject (id, subject_type, sku_id, quantity, uom)
         SELECT $1, 'QUANTITY', id, 7, 'EA' FROM sku WHERE sku_code = 'TEE-01-M'",
    )
    .bind(subject)
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("subject: {e}"));
    sqlx::query(
        "INSERT INTO inventory_projection (subject_id, place_id, quantity, last_fact_sequence)
         VALUES ($1, 'store-01.floor:on_hand', 7, 1)",
    )
    .bind(subject)
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("projection: {e}"));

    let body = pricelist_performance(&pool, "ART-TEE", &window())
        .await
        .unwrap_or_else(|e| panic!("pricelist: {e}"));

    assert_eq!(body["attribution"], "BASKET");
    assert_eq!(body["article_code"], "ART-TEE");
    assert_eq!(body["article_name"], "Kaos Polos");
    // The cost is named for what it is, so nobody divides it into a size.
    assert_eq!(body["cost_basis"], "ARTICLE_LATEST_PO");
    assert_eq!(body["cost_unit_minor"], 90_000);
    assert_eq!(body["cost_source"]["po_number"], "PO-NEW");
    // Margin is the caller's subtraction, not ours.
    assert!(body.get("margin_minor").is_none());

    // The previous window's sale is excluded: 5 units over the two days.
    assert_eq!(body["units"], 5);
    assert_eq!(body["revenue_minor"], 750_000);
    assert_eq!(body["on_hand"], 7);

    let skus = body["skus"]
        .as_array()
        .unwrap_or_else(|| panic!("skus: {body}"));
    assert_eq!(skus.len(), 2);

    let medium = skus
        .iter()
        .find(|s| s["sku_code"] == "TEE-01-M")
        .unwrap_or_else(|| panic!("TEE-01-M: {body}"));
    assert_eq!(medium["units"], 3);
    assert_eq!(medium["revenue_minor"], 500_000);
    assert_eq!(medium["on_hand"], 7);
    let prices = medium["prices"]
        .as_array()
        .unwrap_or_else(|| panic!("prices: {medium}"));
    // Full price and clearance are two rows. Averaging them would hide the one
    // fact the report exists to show.
    assert_eq!(prices.len(), 2);
    let markdown = prices
        .iter()
        .find(|p| p["price_source"] == "MARKDOWN")
        .unwrap_or_else(|| panic!("markdown: {medium}"));
    assert_eq!(markdown["unit_price_minor"], 150_000);
    assert_eq!(markdown["units"], 2);
    assert_eq!(markdown["revenue_minor"], 300_000);
    assert_eq!(markdown["publication_version"], 1);

    let large = skus
        .iter()
        .find(|s| s["sku_code"] == "TEE-01-L")
        .unwrap_or_else(|| panic!("TEE-01-L: {body}"));
    assert_eq!(large["units"], 2);
    assert_eq!(large["revenue_minor"], 250_000);
    // Nothing of this size in the projection, which is a zero rather than an
    // unknown.
    assert_eq!(large["on_hand"], 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_window_with_no_sales_answers_zero_rather_than_nothing(pool: PgPool) {
    publish_book(&pool).await;
    catalogue(&pool).await;

    let body = campaign_performance(&pool, &window())
        .await
        .unwrap_or_else(|e| panic!("campaigns: {e}"));
    let campaigns = body["campaigns"]
        .as_array()
        .unwrap_or_else(|| panic!("campaigns: {body}"));
    assert_eq!(campaigns.len(), 2, "both declared campaigns, both at zero");
    for campaign in campaigns {
        assert_eq!(campaign["benefit_minor"], 0);
        assert_eq!(campaign["sale_count"], 0);
        assert_eq!(campaign["previous"]["sale_count"], 0);
        assert_eq!(campaign["series"], serde_json::json!([]));
    }

    let body = pricelist_performance(&pool, "ART-TEE", &window())
        .await
        .unwrap_or_else(|e| panic!("pricelist: {e}"));
    assert_eq!(body["units"], 0);
    assert_eq!(body["revenue_minor"], 0);
    // The sizes are still listed: "nothing sold" is an answer about them.
    assert_eq!(body["skus"].as_array().map(Vec::len), Some(2));
    // Nothing was ever ordered, so there is no cost basis to quote.
    assert_eq!(body["cost_unit_minor"], Value::Null);
    assert_eq!(body["cost_source"], Value::Null);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_key_no_published_book_declares_is_still_reported(pool: PgPool) {
    catalogue(&pool).await;
    // A shop still charging against a campaign the centre never published, or
    // published and withdrew. The money moved either way.
    sell(
        &pool,
        1,
        "store-01",
        base() + Duration::hours(2),
        None,
        ("TEE-01-M", 1, 90_000, "COMPANY_PRICE"),
        &[("RULE-GHOST", Some("CAMP-GHOST"), None, 9_000)],
    )
    .await;

    let body = campaign_performance(&pool, &window())
        .await
        .unwrap_or_else(|e| panic!("campaigns: {e}"));
    let ghost = find(&body["campaigns"], "CAMP-GHOST");
    assert_eq!(ghost["benefit_minor"], 9_000);
    assert_eq!(ghost["sale_count"], 1);
    // Named as unknown rather than left off the row, so a column is never
    // missing on some rows only.
    assert_eq!(ghost["name"], Value::Null);
    assert_eq!(ghost["budget_minor"], Value::Null);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_window_that_runs_backwards_is_refused(pool: PgPool) {
    let _ = pool;
    let error = PerformanceWindow::resolve(Some(base()), Some(base() - Duration::days(1)), None)
        .err()
        .unwrap_or_else(|| panic!("a backwards window should be refused"));
    assert!(
        error.to_string().contains("backwards"),
        "unhelpful message: {error}"
    );

    // A site id no origin could ever have, refused here rather than returning
    // an empty report that looks like a quiet week.
    let error = PerformanceWindow::resolve(None, None, Some("dc-01"))
        .err()
        .unwrap_or_else(|| panic!("dc-01 should be refused"));
    assert!(error.to_string().contains("site id"), "{error}");

    // An empty parameter is the picker on "all shops", not a bad site id.
    let all = PerformanceWindow::resolve(None, None, Some(""))
        .unwrap_or_else(|e| panic!("empty site: {e}"));
    assert!(all.site_id.is_none());
    // Thirty days back, by default.
    assert_eq!(all.to - all.from, Duration::days(30));
    assert_eq!(all.from - all.previous_from, Duration::days(30));
}

// ---------------------------------------------------------------------------
// A campaign whose members are markdowns
// ---------------------------------------------------------------------------

/// One published book carrying one clearance, filed under `CAMP-RAYA`.
///
/// DRAFT, then the markdown, then PUBLISHED — the order migration 0073 forces,
/// and the order a merchandiser works in.
async fn publish_markdowns(pool: &PgPool, markdown_id: &str, ends: bool) {
    let book = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO commercial_publication
             (id, version, name, status, effective_from, created_by)
         VALUES ($1, (SELECT coalesce(max(version), 0) + 1 FROM commercial_publication),
                 'Flash Sale', 'DRAFT', $2, 'test')",
    )
    .bind(book)
    .bind(base() - Duration::days(8))
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("clearance book: {e}"));

    sqlx::query(
        "INSERT INTO commercial_markdown
             (id, publication_id, markdown_id, sku_code, replacement_unit_price_minor,
              priority, effective_from, effective_to, campaign_id)
         VALUES ($1, $2, $3, 'TEE-01-M', 120000, 10, $4, $5, 'CAMP-RAYA')",
    )
    .bind(Uuid::new_v4())
    .bind(book)
    .bind(markdown_id)
    .bind(base() - Duration::days(7))
    .bind(ends.then(|| base() + Duration::days(7)))
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("markdown: {e}"));

    sqlx::query(
        "UPDATE commercial_publication
            SET status = 'PUBLISHED', published_by = 'test', published_at = $2
          WHERE id = $1",
    )
    .bind(book)
    .bind(base() - Duration::days(8))
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("publish clearance book: {e}"));
}

/// A published clearance under a campaign, plus a sale that took it.
///
/// Written straight into `commercial_markdown` and `edge_sale_line` because
/// that is exactly what the two real paths produce: a merchandiser publishing a
/// book, and a till reporting what it charged.
async fn cleared_under_campaign(pool: &PgPool) {
    // Its own book, and written as a DRAFT first. Migration 0073 refuses to let
    // a published book grow a markdown, which is the whole point of it — a
    // clearance added after dispatch would change the centre and no till. A
    // clearance published a week after the campaign it joins is also the ordinary
    // case: the campaign is declared once, and the drops are cut when the buyer
    // decides what to clear.
    publish_markdowns(pool, "MD-TEE-CLEAR", true).await;

    // Two units at 120.000 that would have been 200.000. The campaign gave up
    // 160.000, and not one rupiah of it is a discount.
    let sale = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO edge_sale
             (sale_id, origin_id, generation, seq, movement_group_id, site_id, actor_id,
              occurred_at, currency, total_minor, paid_minor, change_minor, customer_id)
         VALUES ($1, 'store-01-edge', 1, 90, $2, 'store-01', 'kasir', $3, 'IDR',
                 240000, 240000, 0, 'C-DEAL')",
    )
    .bind(sale)
    .bind(Uuid::new_v4())
    .bind(base() + Duration::hours(10))
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("cleared sale: {e}"));

    sqlx::query(
        "INSERT INTO edge_sale_line
             (sale_id, subject_id, epc, sku_code, quantity, unit_price_minor,
              line_total_minor, price_source, publication_version,
              base_unit_price_minor, markdown_id)
         VALUES ($1, $2, 'EPC-DEAL', 'TEE-01-M', 2, 120000, 240000, 'MARKDOWN', 1,
                 200000, 'MD-TEE-CLEAR')",
    )
    .bind(sale)
    .bind(Uuid::new_v4())
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("cleared line: {e}"));
}

/// The whole reason this exists: before campaigns could hold markdowns, a
/// campaign run as a flash sale reported **nothing**. Every rupiah of it sat in
/// `edge_sale_line`, and this file read only `edge_sale_promotion`.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_campaign_reports_what_its_price_drops_gave_up(pool: PgPool) {
    publish_book(&pool).await;
    catalogue(&pool).await;
    cleared_under_campaign(&pool).await;

    let body = campaign_performance(&pool, &window())
        .await
        .unwrap_or_else(|e| panic!("campaigns: {e}"));
    let raya = find(&body["campaigns"], "CAMP-RAYA");

    // Two units, 80.000 off each.
    assert_eq!(raya["clearance_minor"], 160_000);
    // And no promotion fired on that sale, so the discount figure is untouched
    // by it. The two never merge — a markdown booked as a discount would
    // inflate both revenue and discount by 160.000 nobody discounted.
    assert_eq!(raya["benefit_minor"], 0);
    assert_eq!(raya["sale_count"], 1);
    assert_eq!(raya["basket_revenue_minor"], 240_000);

    // A rule campaign is unaffected: an effect has no clearance.
    assert_eq!(find(&body["campaigns"], "CAMP-QUIET")["clearance_minor"], 0);
}

/// A campaign that discounts AND clears is one campaign, and a basket it
/// touched both ways is one sale.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_campaign_run_both_ways_counts_each_basket_once(pool: PgPool) {
    publish_book(&pool).await;
    catalogue(&pool).await;
    sales(&pool).await;
    cleared_under_campaign(&pool).await;

    let body = campaign_performance(&pool, &window())
        .await
        .unwrap_or_else(|e| panic!("campaigns: {e}"));
    let raya = find(&body["campaigns"], "CAMP-RAYA");

    // Three baskets took a promotion of this campaign in the window, and one
    // more took only a cleared price. Four sales, not five — the union of two
    // sources is folded per (campaign, sale) precisely so a basket that did
    // both is not counted twice.
    assert_eq!(raya["sale_count"], 4);
    assert_eq!(raya["clearance_minor"], 160_000);
    // 20.000 + 5.000 on the first basket, 15.000 on the second, 30.000 on the
    // third. The fourth took a rule outside this campaign and the fifth is in
    // the window before.
    assert_eq!(raya["benefit_minor"], 70_000);

    // The two figures stay apart in the daily series as well, so a chart
    // cannot silently add them.
    let series = raya["series"]
        .as_array()
        .unwrap_or_else(|| panic!("series"));
    let cleared: i64 = series
        .iter()
        .map(|day| day["clearance_minor"].as_i64().unwrap_or(0))
        .sum();
    assert_eq!(cleared, 160_000);
}

/// A line the shop could not measure is left out, never counted as free.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_cleared_line_with_no_list_price_is_not_counted_as_a_giveaway(pool: PgPool) {
    publish_book(&pool).await;
    catalogue(&pool).await;

    publish_markdowns(&pool, "MD-UNKNOWN", false).await;

    // `base_unit_price_minor` null: a shop with no book in force, or one on a
    // build that predates the field. Reading null as nought would report the
    // entire selling price as a giveaway — 240.000 of clearance that never
    // happened.
    let sale = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO edge_sale
             (sale_id, origin_id, generation, seq, movement_group_id, site_id, actor_id,
              occurred_at, currency, total_minor, paid_minor, change_minor)
         VALUES ($1, 'store-01-edge', 1, 91, $2, 'store-01', 'kasir', $3, 'IDR',
                 240000, 240000, 0)",
    )
    .bind(sale)
    .bind(Uuid::new_v4())
    .bind(base() + Duration::hours(10))
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("sale: {e}"));
    sqlx::query(
        "INSERT INTO edge_sale_line
             (sale_id, subject_id, epc, sku_code, quantity, unit_price_minor,
              line_total_minor, price_source, markdown_id)
         VALUES ($1, $2, 'EPC-UNKNOWN', 'TEE-01-M', 2, 120000, 240000, 'MARKDOWN',
                 'MD-UNKNOWN')",
    )
    .bind(sale)
    .bind(Uuid::new_v4())
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("line: {e}"));

    let body = campaign_performance(&pool, &window())
        .await
        .unwrap_or_else(|e| panic!("campaigns: {e}"));
    assert_eq!(find(&body["campaigns"], "CAMP-RAYA")["clearance_minor"], 0);
}

/// The authoring path, end to end: a scheduled clearance written the way the
/// console writes one, and read back off the row it landed in.
///
/// The console's own form is where a flash sale is decided, and a field that
/// reaches Postgres under a different name than the one it was bound to fails
/// silently — the book publishes, the shop applies it, and the sale runs all
/// day because the hours arrived as nothing. Nothing else in the suite would
/// notice, because everything else writes the columns by hand.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_clearance_authored_with_hours_keeps_them(pool: PgPool) {
    use inventory_backend::cloud::application::{
        CommercialMarkdownInput, CreateCommercialPublicationRequest,
    };

    inventory_backend::cloud::postgres::create_commercial_publication(
        &pool,
        CreateCommercialPublicationRequest {
            version: 9_000,
            name: "Flash 12-14".into(),
            effective_from: base() - Duration::days(1),
            effective_to: None,
            // No tax rules: this book sets no prices, and the server refuses a
            // book whose tax rules would categorise nothing. A clearance-only
            // book is a legitimate shape — the prices it replaces were set by
            // an earlier one.
            tax_rules: Vec::new(),
            offer_rules: Vec::new(),
            markdowns: vec![CommercialMarkdownInput {
                markdown_id: "MD-FLASH".into(),
                sku_id: None,
                sku_code: None,
                article_code: Some("ART-TEE".into()),
                site_id: None,
                site_ids: None,
                replacement_unit_price_minor: 99_000,
                priority: 0,
                campaign_id: None,
                // Noon to two, Saturday and Sunday.
                iso_weekdays: vec![6, 7],
                from_minute: Some(720),
                to_minute: Some(840),
                effective_from: base() - Duration::days(1),
                effective_to: None,
            }],
            rules: Vec::new(),
            coupons: Vec::new(),
            campaigns: Vec::new(),
            actor_id: "test".into(),
            idempotency_key: Uuid::new_v4().to_string(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("author: {e}"));

    let row = sqlx::query(
        "SELECT iso_weekdays, from_minute, to_minute
           FROM commercial_markdown WHERE markdown_id = 'MD-FLASH'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("read back: {e}"));

    assert_eq!(row.get::<Vec<i16>, _>("iso_weekdays"), vec![6, 7]);
    assert_eq!(row.get::<Option<i32>, _>("from_minute"), Some(720));
    assert_eq!(row.get::<Option<i32>, _>("to_minute"), Some(840));
}

/// The console's own price grid must go dark when a campaign is paused.
///
/// `article_prices` is what the Pricelist menu draws, and it reads the price
/// book only — no rules, no coupons, and until a markdown could name a
/// campaign, no campaigns either. That was right then and wrong the moment a
/// campaign became a switch over PRICES: with none loaded, the engine reads
/// every clearance as belonging to a campaign this reader does not hold, and
/// that case deliberately leaves the cleared price standing.
///
/// So the screen a merchandiser opens to check prices would have shown a
/// stopped flash sale's numbers while every till had already put them back up.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_price_grid_stops_showing_a_paused_campaigns_clearance(pool: PgPool) {
    publish_book(&pool).await;
    catalogue(&pool).await;
    shop(&pool).await;
    publish_base_prices(&pool).await;
    publish_markdowns(&pool, "MD-TEE-CLEAR", true).await;

    let cleared = grid(&pool).await;
    assert!(
        grid_mentions(&cleared, 120_000),
        "while the campaign runs, the grid shows the cleared price"
    );

    // The lever, pulled at the centre.
    sqlx::query("UPDATE commercial_campaign SET status = 'PAUSED' WHERE campaign_id = 'CAMP-RAYA'")
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("pause: {e}"));

    let paused = grid(&pool).await;
    assert!(
        !grid_mentions(&paused, 120_000),
        "a paused campaign's clearance must leave the console's grid too"
    );
}

/// The Pricelist menu's own read, as JSON.
///
/// `article_prices` answers a typed envelope now — rows, a keyset cursor, a
/// total and facet counts — and this test is about one figure appearing in it
/// or not, so it is flattened back to a `Value` rather than walked.
async fn grid(pool: &PgPool) -> Value {
    let page = article_prices(
        pool,
        CommercialChannel::Store,
        base(),
        ArticlePriceScope {
            limit: Some(50),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|e| panic!("grid: {e}"));
    serde_json::to_value(page).unwrap_or_else(|e| panic!("grid json: {e}"))
}

/// Whether any price in the grid is this number. Deliberately blunt: the shape
/// of a stack is the screen's business, and this test is about one figure being
/// there or not.
fn grid_mentions(body: &Value, minor: i64) -> bool {
    body.to_string()
        .contains(&format!("\"unit_price_minor\":{minor}"))
}

/// A company-wide base price for the catalogue, in its own published book.
///
/// `article_prices` joins a price rule to an assortment rule — a price with no
/// `sellable` beside it is a style the shop does not stock, and the grid skips
/// it. So both are written, which is also what authoring does.
async fn publish_base_prices(pool: &PgPool) {
    let book = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO commercial_publication
             (id, version, name, status, effective_from, created_by)
         VALUES ($1, (SELECT coalesce(max(version), 0) + 1 FROM commercial_publication),
                 'Harga Dasar', 'DRAFT', $2, 'test')",
    )
    .bind(book)
    .bind(base() - Duration::days(20))
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("price book: {e}"));

    sqlx::query(
        "INSERT INTO commercial_tax_rule (id, publication_id, tax_category, rate_bps, tax_inclusive)
         VALUES ($1, $2, 'STANDARD', 1100, true)",
    )
    .bind(Uuid::new_v4())
    .bind(book)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("tax: {e}"));

    let skus: Vec<(Uuid, String)> = sqlx::query_as("SELECT id, sku_code FROM sku")
        .fetch_all(pool)
        .await
        .unwrap_or_else(|e| panic!("skus: {e}"));
    for (sku_id, _) in skus {
        sqlx::query(
            "INSERT INTO commercial_assortment_rule
                 (id, publication_id, sku_id, channel, sellable)
             VALUES ($1, $2, $3, 'STORE', true)",
        )
        .bind(Uuid::new_v4())
        .bind(book)
        .bind(sku_id)
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("assortment: {e}"));
        sqlx::query(
            "INSERT INTO commercial_price_rule
                 (id, publication_id, sku_id, channel, currency, unit_price_minor, tax_category)
             VALUES ($1, $2, $3, 'STORE', 'IDR', 200000, 'STANDARD')",
        )
        .bind(Uuid::new_v4())
        .bind(book)
        .bind(sku_id)
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("price: {e}"));
    }

    sqlx::query(
        "UPDATE commercial_publication
            SET status = 'PUBLISHED', published_by = 'test', published_at = $2
          WHERE id = $1",
    )
    .bind(book)
    .bind(base() - Duration::days(20))
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("publish prices: {e}"));
}

/// One shop, so `article_prices` has a branch to price for.
async fn shop(pool: &PgPool) {
    sqlx::query(
        "INSERT INTO site (id, name, kind, edge_node_id)
         VALUES ('store-01', 'Toko Satu', 'STORE', 'store-01-edge')
         ON CONFLICT (id) DO NOTHING",
    )
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("site: {e}"));
    sqlx::query(
        "INSERT INTO sync_origin_credential
             (origin_id, ingest_key_sha256, node_role, site_id, label)
         VALUES ('store-01-edge', 'x', 'STORE', 'store-01', 'Toko Satu')
         ON CONFLICT (origin_id) DO NOTHING",
    )
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("origin: {e}"));
}
