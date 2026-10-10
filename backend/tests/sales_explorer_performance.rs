use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{self as cloud, ExplorerQuery};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{PgPool, Row};
use std::collections::BTreeMap;
use uuid::Uuid;

const STORE: &str = "store-01";
const DIVISION: &str = "EXPLORER_PERF";
const TAG: &str = "EXPLORER_PERF_TAG";

async fn read(pool: &PgPool, query: &ExplorerQuery) -> cloud::SalesExplorer {
    cloud::sales_explorer(pool, query, true)
        .await
        .unwrap_or_else(|error| panic!("explorer {:?}: {error}", query.group))
}

async fn window_plan_counts(pool: &PgPool) -> (i64, i64) {
    let rows = sqlx::query(
        "SELECT generic_plans, custom_plans
           FROM pg_prepared_statements
          WHERE statement LIKE 'WITH win AS NOT MATERIALIZED (%'
            AND statement LIKE '%FROM sales_sku_month m%'",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("read cached Explorer plan counts: {error}"));
    assert_eq!(rows.len(), 1, "one stable SKU window statement is cached");
    let generic = rows[0]
        .try_get("generic_plans")
        .unwrap_or_else(|error| panic!("read generic plan count: {error}"));
    let custom = rows[0]
        .try_get("custom_plans")
        .unwrap_or_else(|error| panic!("read custom plan count: {error}"));
    (generic, custom)
}

async fn current_plan_cache_mode(pool: &PgPool) -> String {
    sqlx::query_scalar("SELECT current_setting('plan_cache_mode')")
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("read plan_cache_mode: {error}"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn explorer_replans_cached_month_and_year_windows_and_resets_local_guc(
    pool_options: PgPoolOptions,
    connect_options: PgConnectOptions,
) {
    // Keep every request on one PostgreSQL session so pg_prepared_statements
    // observes the same prepared statement across the auto-plan threshold.
    let pool = pool_options
        .max_connections(1)
        .connect_with(connect_options)
        .await
        .unwrap_or_else(|error| panic!("connect one-session test pool: {error}"));
    let initial_plan_cache_mode = current_plan_cache_mode(&pool).await;

    let month_from = NaiveDate::from_ymd_opt(2025, 9, 1).unwrap_or_else(|| panic!("month from"));
    let month_to = NaiveDate::from_ymd_opt(2025, 9, 30).unwrap_or_else(|| panic!("month to"));
    let year_from = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap_or_else(|| panic!("year from"));
    let year_to = NaiveDate::from_ymd_opt(2025, 12, 31).unwrap_or_else(|| panic!("year to"));
    for execution in 0..5 {
        let (from, to) = if execution < 3 {
            (month_from, month_to)
        } else {
            (year_from, year_to)
        };
        let query = ExplorerQuery {
            from,
            to,
            group: Some("sku".into()),
            totals: Some(false),
            compare: None,
            ..Default::default()
        };
        let _ = read(&pool, &query).await;
        assert_eq!(
            current_plan_cache_mode(&pool).await,
            initial_plan_cache_mode,
            "transaction-local planning mode resets after execution {execution}"
        );
    }

    assert_eq!(
        window_plan_counts(&pool).await,
        (0, 5),
        "the first five requests share one prepared window statement"
    );

    let sixth_year = ExplorerQuery {
        from: year_from,
        to: year_to,
        group: Some("sku".into()),
        totals: Some(false),
        compare: None,
        ..Default::default()
    };
    let _ = read(&pool, &sixth_year).await;
    assert_eq!(
        window_plan_counts(&pool).await,
        (0, 6),
        "the sixth execution must use a custom plan instead of the generic plan"
    );
    assert_eq!(
        current_plan_cache_mode(&pool).await,
        initial_plan_cache_mode
    );
    pool.close().await;
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn filtered_months_and_page_stock_keep_sales_and_stock_exact(pool: PgPool) {
    sqlx::query("INSERT INTO division (code, label) VALUES ($1, 'Explorer perf')")
        .bind(DIVISION)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("division fixture: {error}"));
    sqlx::query("INSERT INTO tag (code, label) VALUES ($1, 'Explorer perf tag')")
        .bind(TAG)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("tag fixture: {error}"));
    let article_black = Uuid::new_v4();
    let article_navy = Uuid::new_v4();
    let article_plain = Uuid::new_v4();
    for (id, code) in [
        (article_black, "EXPLORER-BLACK"),
        (article_navy, "EXPLORER-NAVY"),
        (article_plain, "EXPLORER-PLAIN"),
    ] {
        sqlx::query(
            "INSERT INTO article (id, article_code, name, division_code)
             VALUES ($1, $2, $2, $3)",
        )
        .bind(id)
        .bind(code)
        .bind(DIVISION)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("article fixture {code}: {error}"));
        sqlx::query("INSERT INTO article_tag (article_id, tag_code) VALUES ($1, $2)")
            .bind(id)
            .bind(TAG)
            .execute(&pool)
            .await
            .unwrap_or_else(|error| panic!("article tag fixture {code}: {error}"));
    }

    sqlx::query(
        "INSERT INTO article_colour (article_id, colour_digit, label, colour_code)
         VALUES ($1, '1', 'Black', 'BLACK'), ($2, '1', 'Navy', 'NAVY')",
    )
    .bind(article_black)
    .bind(article_navy)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("colour fixture: {error}"));

    for (id, article_id, sku_code, colour, size) in [
        (
            Uuid::new_v4(),
            article_black,
            "EXPLORER-BLACK-03",
            Some("1"),
            Some("03"),
        ),
        (
            Uuid::new_v4(),
            article_navy,
            "EXPLORER-NAVY-04",
            Some("1"),
            Some("04"),
        ),
        (
            Uuid::new_v4(),
            article_plain,
            "EXPLORER-PLAIN-00",
            None,
            None,
        ),
    ] {
        sqlx::query(
            "INSERT INTO sku (id, article_id, sku_code, colour_digit, size_code)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(id)
        .bind(article_id)
        .bind(sku_code)
        .bind(colour)
        .bind(size)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("sku fixture {sku_code}: {error}"));
    }

    // There are partial edge days around a complete September. The month
    // summary must answer September while both edges and the prior comparison
    // still match the day summary exactly.
    let dates = [
        ("2025-06-20", [1_i64, 2, 1]),
        ("2025-07-10", [2, 3, 1]),
        ("2025-08-10", [3, 4, 1]),
        ("2025-08-20", [4, 5, 1]),
        ("2025-09-10", [5, 6, 2]),
        ("2025-10-10", [6, 7, 3]),
    ];
    let skus = ["EXPLORER-BLACK-03", "EXPLORER-NAVY-04", "EXPLORER-PLAIN-00"];
    let articles = [article_black, article_navy, article_plain];
    for (date, quantities) in dates {
        let business_date = NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .unwrap_or_else(|error| panic!("date {date}: {error}"));
        for index in 0..skus.len() {
            let quantity = quantities[index];
            sqlx::query(
                "INSERT INTO sales_sku_day (
                     business_date, site_id, sku_code, article_id, division_code, tag_codes,
                     sold_qty, full_qty, list_minor, gross_minor, net_minor)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $8, $8)",
            )
            .bind(business_date)
            .bind(STORE)
            .bind(skus[index])
            .bind(articles[index])
            .bind(DIVISION)
            .bind(vec![TAG.to_string()])
            .bind(quantity)
            .bind(quantity * 10_000)
            .execute(&pool)
            .await
            .unwrap_or_else(|error| panic!("day fixture {date}/{}: {error}", skus[index]));
        }
    }
    sqlx::query(
        "INSERT INTO store_stock_sku (site_id, sku_code, on_hand) VALUES
             ($1, 'EXPLORER-BLACK-03', 5),
             ($1, 'EXPLORER-NAVY-04', 8),
             ($1, 'EXPLORER-PLAIN-00', 2)",
    )
    .bind(STORE)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("stock fixture: {error}"));
    sqlx::query(
        "INSERT INTO store_stock_article (article_id, site_id, on_hand, stock_cost_minor)
         VALUES ($1, $3, 5, 0), ($2, $3, 8, 0), ($4, $3, 2, 0)",
    )
    .bind(article_black)
    .bind(article_navy)
    .bind(STORE)
    .bind(article_plain)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("article stock fixture: {error}"));

    let from = NaiveDate::from_ymd_opt(2025, 8, 15).unwrap_or_else(|| panic!("from date"));
    let to = NaiveDate::from_ymd_opt(2025, 10, 15).unwrap_or_else(|| panic!("to date"));
    let query = |group: &str| ExplorerQuery {
        from,
        to,
        group: Some(group.into()),
        stores: Some(STORE.into()),
        q: Some("EXPLORER".into()),
        compare: Some("previous".into()),
        totals: Some(true),
        ..Default::default()
    };
    for (group, colours, sizes) in [
        ("article", Some("BLACK"), None),
        ("division", Some("BLACK"), None),
        ("tag", None, Some("03")),
        ("sku", Some("BLACK"), Some("03")),
        ("colour", None, Some("03")),
        ("size", Some("BLACK"), None),
    ] {
        let mut filtered = query(group);
        filtered.colours = colours.map(str::to_owned);
        filtered.sizes = sizes.map(str::to_owned);
        filtered.stock = Some(true);
        filtered.matrix = Some(true);
        let result = read(&pool, &filtered).await;
        assert_eq!(result.total.qty, 15, "{group} filtered main-window qty");
        assert_eq!(result.total.sales_minor, 150_000, "{group} main sales");
        assert_eq!(
            result.total_compare.as_ref().map(|figures| figures.qty),
            Some(6)
        );
        assert_eq!(
            result
                .total_compare
                .as_ref()
                .map(|figures| figures.sales_minor),
            Some(60_000)
        );
        assert_eq!(
            result.rows.len(),
            1,
            "{group} filter selects the black size-03 SKU"
        );
        assert_eq!(result.rows[0].figures.stock, Some(5), "{group} page stock");
        assert_eq!(result.total.stock, Some(5), "{group} filtered estate stock");
        assert_eq!(
            result.rows[0].cells.len(),
            1,
            "{group} stock/sales matrix cell"
        );
        assert_eq!(result.rows[0].cells[0].figures.stock, Some(5));
    }

    let mut month_filter = query("month");
    month_filter.sizes = Some("03".into());
    month_filter.matrix = Some(true);
    let monthly = read(&pool, &month_filter).await;
    assert_eq!(monthly.total.sales_minor, 150_000);
    assert_eq!(
        monthly
            .total_compare
            .as_ref()
            .map(|figures| figures.sales_minor),
        Some(60_000)
    );
    assert_eq!(monthly.rows.len(), 3, "partial edges plus September");

    let mut unfiltered = query("sku");
    unfiltered.limit = Some(1);
    unfiltered.stock = Some(true);
    unfiltered.matrix = Some(true);
    let page = read(&pool, &unfiltered).await;
    assert_eq!(page.rows_total, 3);
    assert_eq!(page.rows.len(), 1);
    assert_eq!(page.rows[0].key, "EXPLORER-NAVY-04");
    assert_eq!(page.rows[0].figures.stock, Some(8));
    assert_eq!(page.rows[0].cells[0].figures.stock, Some(8));
    assert_eq!(
        page.total.stock,
        Some(15),
        "estate total still reads all filtered stock"
    );

    let mut stock_sort = query("sku");
    stock_sort.stock = Some(true);
    stock_sort.matrix = Some(true);
    stock_sort.sort = Some("stock".into());
    stock_sort.dir = Some("desc".into());
    let sorted = read(&pool, &stock_sort).await;
    let keys: Vec<&str> = sorted.rows.iter().map(|row| row.key.as_str()).collect();
    assert_eq!(
        keys,
        ["EXPLORER-NAVY-04", "EXPLORER-BLACK-03", "EXPLORER-PLAIN-00"]
    );

    for group in ["colour", "size"] {
        let mut all = query(group);
        all.compare = None;
        all.stock = Some(true);
        all.matrix = Some(true);
        let result = read(&pool, &all).await;
        let blank = result
            .rows
            .iter()
            .find(|row| row.key.is_empty())
            .unwrap_or_else(|| panic!("{group} keeps the null metadata key"));
        assert_eq!(blank.figures.stock, Some(2), "{group} null metadata stock");
    }

    let mut sku_without_stock = query("sku");
    sku_without_stock.colours = Some("BLACK".into());
    sku_without_stock.stock = Some(false);
    sku_without_stock.matrix = Some(true);
    let no_stock = read(&pool, &sku_without_stock).await;
    assert_eq!(no_stock.total.sales_minor, 150_000);
    assert_eq!(no_stock.rows[0].figures.stock, None);
    assert_eq!(no_stock.rows[0].cells.len(), 1);
    assert_eq!(no_stock.rows[0].cells[0].figures.stock, None);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn colour_size_stock_summaries_match_crossdimension_shelf_filters_without_search(
    pool: PgPool,
) {
    const DIVISION: &str = "EXPLORER_CROSSDIM";
    sqlx::query("INSERT INTO division (code, label) VALUES ($1, 'Explorer cross-dimension')")
        .bind(DIVISION)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("division fixture: {error}"));

    let articles = [
        (Uuid::new_v4(), "CS-BLACK-03", Some("1"), Some("03"), 5_i64),
        (Uuid::new_v4(), "CS-BLACK-04", Some("1"), Some("04"), 8_i64),
        (Uuid::new_v4(), "CS-NAVY-03", Some("1"), Some("03"), 3_i64),
        (Uuid::new_v4(), "CS-PLAIN", None, None, 2_i64),
    ];
    for (index, (article_id, code, colour_digit, size, on_hand)) in articles.iter().enumerate() {
        sqlx::query(
            "INSERT INTO article (id, article_code, name, division_code)
             VALUES ($1, $2, $2, $3)",
        )
        .bind(article_id)
        .bind(code)
        .bind(DIVISION)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("article fixture {code}: {error}"));

        if let Some(colour_code) = match index {
            0 | 1 => Some("BLACK"),
            2 => Some("NAVY"),
            _ => None,
        } {
            sqlx::query(
                "INSERT INTO article_colour (article_id, colour_digit, label, colour_code)
                 VALUES ($1, '1', $2, $3)",
            )
            .bind(article_id)
            .bind(colour_code)
            .bind(colour_code)
            .execute(&pool)
            .await
            .unwrap_or_else(|error| panic!("article colour fixture {code}: {error}"));
        }

        sqlx::query(
            "INSERT INTO sku (id, article_id, sku_code, colour_digit, size_code)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(Uuid::new_v4())
        .bind(article_id)
        .bind(code)
        .bind(colour_digit)
        .bind(size)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("SKU fixture {code}: {error}"));

        sqlx::query(
            "INSERT INTO sales_sku_day (
                 business_date, site_id, sku_code, article_id, division_code, tag_codes,
                 sold_qty, full_qty, list_minor, gross_minor, net_minor)
             VALUES (DATE '2025-09-10', $1, $2, $3, $4, ARRAY[]::text[], 1, 1, 1000, 1000, 1000)",
        )
        .bind(STORE)
        .bind(code)
        .bind(article_id)
        .bind(DIVISION)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("sales fixture {code}: {error}"));

        sqlx::query("INSERT INTO store_stock_sku (site_id, sku_code, on_hand) VALUES ($1, $2, $3)")
            .bind(STORE)
            .bind(code)
            .bind(on_hand)
            .execute(&pool)
            .await
            .unwrap_or_else(|error| panic!("shelf fixture {code}: {error}"));
    }

    // These are exact refresh-equivalent summaries of the four shelf rows.
    // A summary lacks the other dimension, so the cross-dimension cases below
    // must still read the SKU shelves and match their narrower totals.
    sqlx::query(
        "INSERT INTO store_stock_colour (colour_code, site_id, on_hand, stock_cost_minor) VALUES
             ('BLACK', $1, 13, 0), ('NAVY', $1, 3, 0), ('', $1, 2, 0)",
    )
    .bind(STORE)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("colour summary fixture: {error}"));
    sqlx::query(
        "INSERT INTO store_stock_size (size_code, site_id, on_hand, stock_cost_minor) VALUES
             ('03', $1, 8, 0), ('04', $1, 8, 0), ('', $1, 2, 0)",
    )
    .bind(STORE)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("size summary fixture: {error}"));

    let from = NaiveDate::from_ymd_opt(2025, 9, 10).unwrap_or_else(|| panic!("from date"));
    let to = from;
    let query = |group: &str, colours: Option<&str>, sizes: Option<&str>| ExplorerQuery {
        from,
        to,
        group: Some(group.into()),
        stores: Some(STORE.into()),
        colours: colours.map(str::to_owned),
        sizes: sizes.map(str::to_owned),
        q: None,
        stock: Some(true),
        matrix: Some(true),
        compare: None,
        totals: Some(true),
        ..Default::default()
    };
    let cases: [(&str, Option<&str>, Option<&str>, &[(&str, i64)], i64); 6] = [
        (
            "colour",
            None,
            None,
            &[("", 2), ("BLACK", 13), ("NAVY", 3)],
            18,
        ),
        ("size", None, None, &[("", 2), ("03", 8), ("04", 8)], 18),
        ("colour", None, Some("03"), &[("BLACK", 5), ("NAVY", 3)], 8),
        ("size", Some("BLACK"), None, &[("03", 5), ("04", 8)], 13),
        ("colour", Some("BLACK"), Some("03"), &[("BLACK", 5)], 5),
        ("size", Some("BLACK"), Some("03"), &[("03", 5)], 5),
    ];

    for (group, colours, sizes, expected, expected_total) in cases {
        let result = read(&pool, &query(group, colours, sizes)).await;
        let actual: BTreeMap<String, Option<i64>> = result
            .rows
            .iter()
            .map(|row| (row.key.clone(), row.figures.stock))
            .collect();
        let expected: BTreeMap<String, Option<i64>> = expected
            .iter()
            .map(|(key, value)| ((*key).to_owned(), Some(*value)))
            .collect();
        assert_eq!(
            actual, expected,
            "{group} colours={colours:?} sizes={sizes:?}"
        );
        assert_eq!(result.total.stock, Some(expected_total));
        for row in result.rows {
            assert_eq!(row.cells.len(), 1, "{group} matrix store count");
            assert_eq!(row.cells[0].figures.stock, row.figures.stock);
        }
    }
}
