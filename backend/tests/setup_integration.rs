//! Setting a company up from the hub (0520, `postgres/setup.rs`): what the
//! client's own database reads as, and what opening a store actually makes.
//!
//! The store test compares the new store against the first one rather than
//! against a list written here. That is the claim the code makes — a new store
//! has exactly the shape the stores already have — and a list here would pass
//! on the day both it and a migration forgot the same pool.

use inventory_backend::cloud::application::AppError;
use inventory_backend::cloud::postgres::{self as cloud};
use sqlx::PgPool;

const ACTOR: &str = "owner";

fn stores(names: &[(&str, &str)]) -> cloud::OpenStoresRequest {
    cloud::OpenStoresRequest {
        stores: names
            .iter()
            .map(|(name, city)| cloud::NewStore {
                name: (*name).into(),
                city: (*city).into(),
            })
            .collect(),
    }
}

async fn open(pool: &PgPool, names: &[(&str, &str)], key: &str) -> cloud::OpenStoresAnswer {
    cloud::open_stores(pool, stores(names), ACTOR, key, &format!("digest:{key}"))
        .await
        .unwrap_or_else(|error| panic!("open stores: {error}"))
}

/// Everything that belongs to a store or names it, as `(kind, count)` —
/// pools on the store, the warehouse's pools pointing at it, and their places.
async fn shape_of(pool: &PgPool, site_id: &str) -> (i64, i64, i64, i64) {
    let own: i64 = sqlx::query_scalar("SELECT count(*) FROM operational_pool WHERE site_id = $1")
        .bind(site_id)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("own pools: {error}"));
    let outbound: i64 =
        sqlx::query_scalar("SELECT count(*) FROM operational_pool WHERE destination_store_id = $1")
            .bind(site_id)
            .fetch_one(pool)
            .await
            .unwrap_or_else(|error| panic!("outbound leaves: {error}"));
    let returns: i64 =
        sqlx::query_scalar("SELECT count(*) FROM operational_pool WHERE store_origin_site_id = $1")
            .bind(site_id)
            .fetch_one(pool)
            .await
            .unwrap_or_else(|error| panic!("return pools: {error}"));
    let places: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM inventory_place place
           JOIN operational_pool p ON p.id = place.pool_id
          WHERE p.site_id = $1 OR p.destination_store_id = $1 OR p.store_origin_site_id = $1",
    )
    .bind(site_id)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("places: {error}"));
    (own, outbound, returns, places)
}

async fn site_id_of(pool: &PgPool, code: &str) -> String {
    sqlx::query_scalar("SELECT id FROM site WHERE client_code = $1")
        .bind(code)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("site for {code}: {error}"))
}

/// The client was set up by migrations, not by the wizard, and must not be
/// sent through it: its company and books are carried over, and its stores
/// have their paper codes.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_clients_database_reads_as_already_set_up(pool: PgPool) {
    let status = cloud::setup_status(&pool)
        .await
        .unwrap_or_else(|error| panic!("status: {error}"));

    assert!(
        status.finished,
        "the wizard would stand in front of the client"
    );
    let company = status.company.unwrap_or_else(|| panic!("no company"));
    assert_eq!(
        company.legal_form, None,
        "the letterhead does not say the legal form, so it is not guessed"
    );
    assert_eq!(
        status.books.map(|books| books.chart).as_deref(),
        Some("IMPORTED")
    );

    let codes: Vec<&str> = status
        .stores
        .iter()
        .map(|store| store.unit_code.as_str())
        .collect();
    assert_eq!(codes.first().copied(), Some("C001"));
    assert!(
        codes.iter().all(|code| code.starts_with('C')),
        "every store has a paper code: {codes:?}"
    );
    assert_eq!(site_id_of(&pool, "C001").await, "store-01");
}

/// A new store has exactly the first store's shape — its own pools, the
/// warehouse's outbound leaves and return pool for it, and a place for each —
/// under its own id, with its own name on the rows that carry one.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn opening_a_store_copies_the_first_stores_shape(pool: PgPool) {
    // The highest paper code there is, which the new ones follow.
    let highest = cloud::setup_status(&pool)
        .await
        .unwrap_or_else(|error| panic!("status: {error}"))
        .stores
        .iter()
        .filter_map(|store| store.unit_code.strip_prefix('C')?.parse::<u32>().ok())
        .max()
        .unwrap_or(0);

    let answer = open(
        &pool,
        &[("Tegal", "Tegal"), ("Jayapura", "Kota Jayapura")],
        "two",
    )
    .await;
    let created: Vec<(String, String)> = answer
        .created
        .iter()
        .map(|store| (store.unit_code.clone(), store.timezone.clone()))
        .collect();
    assert_eq!(
        created,
        vec![
            (format!("C{:03}", highest + 1), "WIB".to_owned()),
            (format!("C{:03}", highest + 2), "WIT".to_owned()),
        ],
        "codes follow the last one, and the clock follows the city"
    );

    let template = shape_of(&pool, "store-01").await;
    let tegal = site_id_of(&pool, &answer.created[0].unit_code).await;
    assert_eq!(shape_of(&pool, &tegal).await, template);
    assert!(
        template.0 > 0 && template.3 > 0,
        "the template has a shape to copy"
    );

    // The return pool stays at the warehouse, points at the new store, and is
    // called by its name.
    let label: String =
        sqlx::query_scalar("SELECT label FROM operational_pool WHERE store_origin_site_id = $1")
            .bind(&tegal)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("return pool: {error}"));
    assert_eq!(label, "Tegal");

    // Only the floor sells, as on every other store.
    let saleable: Vec<String> = sqlx::query_scalar(
        "SELECT place.id FROM inventory_place place
           JOIN operational_pool p ON p.id = place.pool_id
          WHERE p.site_id = $1 AND place.is_saleable",
    )
    .bind(&tegal)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("saleable: {error}"));
    assert_eq!(saleable, vec![format!("{tegal}.floor:on_hand")]);

    // A posting for HR, and tills that take cash and nothing else yet.
    let posted: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM org_place WHERE site_id = $1)")
            .bind(&tegal)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("org place: {error}"));
    assert!(posted);
    let non_cash: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM payment_method_site m
           JOIN payment_method p ON p.code = m.method_code
          WHERE m.site_id = $1 AND p.tender_type <> 'CASH'",
    )
    .bind(&tegal)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("methods: {error}"));
    assert_eq!(
        non_cash, 0,
        "QRIS and cards wait for a merchant id or a terminal"
    );

    // And the home screen now has two more stores waiting for a server.
    let status = cloud::setup_status(&pool)
        .await
        .unwrap_or_else(|error| panic!("status: {error}"));
    let nodes = status
        .tasks
        .iter()
        .find(|task| task.id == "store_nodes")
        .unwrap_or_else(|| panic!("no store_nodes task"));
    assert!(!nodes.done);
    assert!(nodes.pending.unwrap_or(0) >= 2);
}

/// The same key opens the stores once: a retry after a timeout that did land
/// answers with the stores it already opened.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_same_key_opens_the_stores_once(pool: PgPool) {
    let count = |pool: PgPool| async move {
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM site WHERE kind = 'STORE'")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("count: {error}"))
    };
    let before = count(pool.clone()).await;

    let first = open(&pool, &[("Slawi", "Tegal")], "once").await;
    let again = open(&pool, &[("Slawi", "Tegal")], "once").await;

    assert_eq!(count(pool.clone()).await, before + 1);
    assert_eq!(first.created[0].unit_code, again.created[0].unit_code);
}

/// Nothing is half-opened: one bad name refuses the whole batch.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_blank_name_refuses_the_whole_batch(pool: PgPool) {
    let refused = cloud::open_stores(
        &pool,
        stores(&[("Brebes", "Brebes"), ("  ", "Tegal")]),
        ACTOR,
        "blank",
        "digest:blank",
    )
    .await;
    assert!(matches!(refused, Err(AppError::Validation(_))));
    let opened: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM site WHERE name = 'Brebes')")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("site: {error}"));
    assert!(!opened);
}

/// Describing the company prints it: the letterhead carries the name the way
/// it is written on paper, legal form after it.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_company_is_printed_on_the_letterhead(pool: PgPool) {
    let saved = cloud::save_setup_company(
        &pool,
        cloud::SaveSetupCompanyRequest {
            name: " Sepatu Sejahtera ".into(),
            legal_form: "pt".into(),
            address: "Jl. Sudirman 12, Purwokerto".into(),
            has_warehouse: true,
            // As printed on the card, and fifteen digits: the old form.
            tax_id: Some("01.234.567.8-901.000".into()),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("save: {error}"));
    assert_eq!(saved.name, "Sepatu Sejahtera");
    assert_eq!(saved.legal_form.as_deref(), Some("PT"));
    assert_eq!(
        saved.tax_id.as_deref(),
        Some("0012345678901000"),
        "punctuation dropped, and the fifteen-digit form gets its leading zero"
    );

    let printed: String = sqlx::query_scalar("SELECT name FROM company_letterhead")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("letterhead: {error}"));
    assert_eq!(printed, "Sepatu Sejahtera, PT");

    let refused = cloud::save_setup_company(
        &pool,
        cloud::SaveSetupCompanyRequest {
            name: "Sepatu Sejahtera".into(),
            legal_form: "GMBH".into(),
            address: "Jl. Sudirman 12".into(),
            has_warehouse: true,
            tax_id: None,
        },
        ACTOR,
    )
    .await;
    assert!(matches!(refused, Err(AppError::Validation(_))));
}

/// The books start once, and starting them opens the first month.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_books_start_once_and_open_their_first_month(pool: PgPool) {
    let request = || cloud::StartBooksRequest {
        chart: "STANDARD".into(),
        file_id: None,
        first_period: "2031-10".into(),
    };

    // The client's books were carried over by the migration.
    let carried = cloud::start_books(&pool, request(), ACTOR).await;
    assert!(matches!(carried, Err(AppError::Conflict(_))));

    sqlx::query("DELETE FROM setup_books")
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("clear: {error}"));
    let books = cloud::start_books(&pool, request(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("start: {error}"));
    assert_eq!(books.first_period, "2031-10");

    let status: String =
        sqlx::query_scalar("SELECT status FROM fiscal_period WHERE year = 2031 AND month = 10")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("period: {error}"));
    assert_eq!(status, "OPEN");

    let again = cloud::start_books(&pool, request(), ACTOR).await;
    assert!(matches!(again, Err(AppError::Conflict(_))));

    let imported_without_a_file = cloud::start_books(
        &pool,
        cloud::StartBooksRequest {
            chart: "IMPORTED".into(),
            file_id: None,
            first_period: "2031-10".into(),
        },
        ACTOR,
    )
    .await;
    assert!(matches!(
        imported_without_a_file,
        Err(AppError::Validation(_))
    ));
}

/// The name goes into the template's JSON as text, so a name with a quote in
/// it must come out as that name and not break the row it is written into.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_name_with_a_quote_is_carried_whole(pool: PgPool) {
    let answer = open(&pool, &[(r#"Toko "Baru" / Timur"#, "Tegal")], "quote").await;
    let site = site_id_of(&pool, &answer.created[0].unit_code).await;
    let label: String =
        sqlx::query_scalar("SELECT label FROM operational_pool WHERE store_origin_site_id = $1")
            .bind(&site)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("return pool: {error}"));
    assert_eq!(label, r#"Toko "Baru" / Timur"#);
    assert_eq!(
        shape_of(&pool, &site).await,
        shape_of(&pool, "store-01").await
    );
}

/// The template holds the rows a store is made of; with it empty there is
/// nothing to open a store from, and the refusal says so rather than opening
/// a site with no stock places.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn without_a_template_no_store_is_half_opened(pool: PgPool) {
    sqlx::query("DELETE FROM site_template_row WHERE template = 'STORE'")
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("clear: {error}"));
    let refused = cloud::open_stores(
        &pool,
        stores(&[("Brebes", "Brebes")]),
        ACTOR,
        "no-template",
        "digest:no-template",
    )
    .await;
    assert!(matches!(refused, Err(AppError::Conflict(_))));
}
