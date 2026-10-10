//! Setting a company up from the hub (0520, `postgres/setup.rs`): what the
//! client's own database reads as, and what opening a store actually makes.
//!
//! The store test compares the new store against the first one rather than
//! against a list written here. That is the claim the code makes — a new store
//! has exactly the shape the stores already have, because both are furnished
//! from the pool template (0610) — and a list here would pass on the day both
//! it and a migration forgot the same pool.

use inventory_backend::cloud::application::AppError;
use inventory_backend::cloud::postgres::{self as cloud};
use sqlx::PgPool;

const ACTOR: &str = "owner";
const ORIGIN: &str = "https://hub.test";

fn stores(names: &[(&str, &str)]) -> cloud::OpenStoresRequest {
    cloud::OpenStoresRequest {
        stores: names
            .iter()
            .map(|(name, city)| cloud::NewStore {
                name: (*name).into(),
                city: (*city).into(),
                // As the wizard sends it: the next number in the series.
                code: None,
                // Every store is opened with its manager (0634).
                manager: Some(cloud::NewStoreManager {
                    name: format!("Manager {name}"),
                }),
            })
            .collect(),
    }
}

async fn open(pool: &PgPool, names: &[(&str, &str)], key: &str) -> cloud::OpenStoresAnswer {
    cloud::open_stores(
        pool,
        stores(names),
        ACTOR,
        key,
        &format!("digest:{key}"),
        ORIGIN,
    )
    .await
    .unwrap_or_else(|error| panic!("open stores: {error}"))
}

/// The pools a shop works with — one per role at the shop — and the return
/// pool the Gudang keeps for its unit, as `(roles, return pools, places)`.
///
/// The Gudang's per-destination leaves for the first stores (0009) are not
/// part of it: they are read for ever and written never, and a new store is
/// rightly given none (0610).
async fn shape_of(pool: &PgPool, site_id: &str) -> (String, i64, i64) {
    let roles: String = sqlx::query_scalar(
        "SELECT COALESCE(string_agg(role, ',' ORDER BY role), '') FROM operational_pool
          WHERE site_id = $1 AND active AND is_placement
            AND destination_store_id IS NULL AND origin_unit_id IS NULL",
    )
    .bind(site_id)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("own pools: {error}"));
    let returns: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM operational_pool p
           JOIN site s ON s.unit_id = p.origin_unit_id
          WHERE s.id = $1 AND p.role = 'RETURN'",
    )
    .bind(site_id)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("return pools: {error}"));
    let places: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM inventory_place place
           JOIN operational_pool p ON p.id = place.pool_id
          WHERE (p.site_id = $1 AND p.active AND p.is_placement
                 AND p.destination_store_id IS NULL AND p.origin_unit_id IS NULL)
             OR (p.role = 'RETURN'
                 AND p.origin_unit_id = (SELECT unit_id FROM site WHERE id = $1))",
    )
    .bind(site_id)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("places: {error}"));
    (roles, returns, places)
}

/// A store's shop, found through its unit's code — the one place the code
/// lives (0621).
async fn site_id_of(pool: &PgPool, code: &str) -> String {
    sqlx::query_scalar(
        "SELECT s.id FROM site s JOIN unit u ON u.id = s.unit_id
          WHERE u.code = $1 AND s.kind = 'STORE'",
    )
    .bind(code)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("site for {code}: {error}"))
}

/// The label of the return pool the Gudang keeps for a shop's unit.
async fn return_label_of(pool: &PgPool, site_id: &str) -> String {
    sqlx::query_scalar(
        "SELECT p.label FROM operational_pool p
           JOIN site s ON s.unit_id = p.origin_unit_id
          WHERE s.id = $1 AND p.role = 'RETURN'",
    )
    .bind(site_id)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("return pool: {error}"))
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

/// A new store has exactly the first store's shape — a pool per role at its
/// shop, the Gudang's return pool for its unit, and a place for each — under
/// its own id, with its own name on the rows that carry one.
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

    let first = shape_of(&pool, "store-01").await;
    let tegal = site_id_of(&pool, &answer.created[0].unit_code).await;
    assert_eq!(shape_of(&pool, &tegal).await, first);
    assert!(
        !first.0.is_empty() && first.1 == 1 && first.2 > 0,
        "the first store has a shape to compare with: {first:?}"
    );

    // The return pool stays at the Gudang, belongs to the new store's unit,
    // and is called by its name.
    assert_eq!(return_label_of(&pool, &tegal).await, "Return Tegal");

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

    // A store unit for its books and its people, which the shop belongs to
    // and prints as, and tills that take cash and nothing else yet.
    let (kind, printed): (String, String) = sqlx::query_as(
        "SELECT u.kind, s.code FROM site s JOIN unit u ON u.id = s.unit_id WHERE s.id = $1",
    )
    .bind(&tegal)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("unit: {error}"));
    assert_eq!(kind, "STORE");
    assert_eq!(printed, format!("{}-TOKO", answer.created[0].unit_code));
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
        ORIGIN,
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

/// The name travels from the request into the unit and the return pool's
/// label, so a name with a quote and a slash in it must come out as that name
/// and not break the row it is written into.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_name_with_a_quote_is_carried_whole(pool: PgPool) {
    let answer = open(&pool, &[(r#"Toko "Baru" / Timur"#, "Tegal")], "quote").await;
    let site = site_id_of(&pool, &answer.created[0].unit_code).await;
    assert_eq!(
        return_label_of(&pool, &site).await,
        r#"Return Toko "Baru" / Timur"#
    );
    assert_eq!(
        shape_of(&pool, &site).await,
        shape_of(&pool, "store-01").await
    );
}

/// The pool template holds the pools a shop is given; with a shop's rows gone
/// there is nothing to open a store with, and the refusal says so rather than
/// opening a site with no stock places.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn without_a_template_no_store_is_half_opened(pool: PgPool) {
    sqlx::query("DELETE FROM pool_template WHERE site_kind = 'STORE'")
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("clear: {error}"));
    let refused = cloud::open_stores(
        &pool,
        stores(&[("Brebes", "Brebes")]),
        ACTOR,
        "no-template",
        "digest:no-template",
        ORIGIN,
    )
    .await;
    assert!(matches!(refused, Err(AppError::Conflict(_))));
}

/// Every store is opened with its manager (owner, 28 Sep 2026): a request
/// naming a store without one is a 422 that names it, and nothing is opened —
/// not even the stores that did name theirs.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_store_without_its_manager_refuses_the_whole_batch(pool: PgPool) {
    let mut request = stores(&[("Brebes", "Brebes"), ("Slawi", "Tegal")]);
    request.stores[1].manager = None;
    let refused =
        cloud::open_stores(&pool, request, ACTOR, "unmanned", "digest:unmanned", ORIGIN).await;
    match refused {
        Err(AppError::Unprocessable(sentence)) => {
            assert!(sentence.contains("Slawi"), "{sentence}");
            assert!(!sentence.contains("Brebes"), "{sentence}");
        }
        other => panic!("expected a 422 naming Slawi, got {other:?}"),
    }
    let opened: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM site WHERE name IN ('Brebes', 'Slawi'))")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("site: {error}"));
    assert!(!opened);
}

/// The manager is invited with the store, in its transaction: posted to its
/// unit as a candidate, with a link shown once and only its hash kept.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_store_is_opened_with_its_managers_join_link(pool: PgPool) {
    let answer = open(&pool, &[("Brebes", "Brebes")], "managed").await;
    let invitation = answer.created[0]
        .manager_invitation
        .clone()
        .unwrap_or_else(|| panic!("no manager invitation: {answer:?}"));
    assert_eq!(invitation.name, "Manager Brebes");
    assert!(
        invitation.link.starts_with("https://hub.test/join/"),
        "{}",
        invitation.link
    );
    let token = invitation.link.trim_start_matches("https://hub.test/join/");
    let (role, unit, posted): (String, String, bool) = sqlx::query_as(
        "SELECT i.role_code, i.unit_id,
                EXISTS (SELECT 1 FROM employee_assignment a
                         WHERE a.employee_id = i.employee_id AND a.unit_id = i.unit_id
                           AND a.valid_to IS NULL)
           FROM user_invitation i WHERE i.token_sha256 = encode(sha256($1::bytea), 'hex')",
    )
    .bind(token.as_bytes())
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("invitation: {error}"));
    assert_eq!(role, "STORE_MANAGER");
    assert_eq!(
        unit,
        format!("store-{}", answer.created[0].unit_code.to_ascii_lowercase())
    );
    assert!(posted, "the manager is posted to the store's unit");
}
