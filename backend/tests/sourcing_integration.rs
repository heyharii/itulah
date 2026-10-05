//! Narrowing the catalogue by what an item is *not*, and by what it lacks.
//!
//! The sourcing search could only ever be told what to include. That is half a
//! filter, and the missing half is the one a buyer cleaning up a range actually
//! reaches for: "everything except the socks", "the items nobody has filed
//! yet". Worse, the facet list has been offering the second one all along —
//! `sourcing_facets` counts unfiled items under the synthetic value
//! `Unclassified` — while the filter had no clause that could match it, so
//! ticking that facet returned an empty page and looked like a broken screen.
//!
//! Two rules are load-bearing here and are asserted rather than assumed:
//!
//!   * a negation KEEPS the rows whose column is empty. An item nobody has
//!     classified is, truthfully, not kidswear, and dropping it would hide
//!     exactly the unfinished rows the question is usually asked about.
//!   * `division_null` agrees with the number the facet reports. A filter that
//!     disagrees with the count beside it is worse than no filter, because the
//!     count is what somebody read before they clicked.

use inventory_backend::cloud::domain::SupplierStatus;
use inventory_backend::cloud::postgres::{
    self as cloud, CreateSupplierItemRequest, CreateSupplierRequest, SourcingScope,
};
use sqlx::PgPool;
use uuid::Uuid;

const ACTOR: &str = "sourcing-test";

/// Every scope in this file starts here: the whole catalogue, one page, no
/// narrowing. Each test then sets the one field it is about, so the assertion
/// is never confused by a filter it did not mean to leave on.
fn everything() -> SourcingScope {
    SourcingScope {
        limit: 100,
        ..SourcingScope::default()
    }
}

async fn supplier(pool: &PgPool, code: &str, name: &str) -> Uuid {
    cloud::create_supplier(
        pool,
        CreateSupplierRequest {
            npwp: None,
            is_pkp: None,
            default_payment_terms_code: None,
            supplier_code: Some(code.to_owned()),
            name: name.to_owned(),
            legal_form: None,
            notes: None,
            contact_name: None,
            phone: None,
            email: None,
            address: None,
            status: SupplierStatus::Active,
            // 0212 split the vendor book. These are merchandise suppliers —
            // the column's own default — and they bill no expense account.
            category: None,
            expense_account_code: None,
        },
        ACTOR,
        &format!("supplier-{code}"),
        "digest",
    )
    .await
    .unwrap_or_else(|e| panic!("supplier {code}: {e}"))
    .supplier_id
}

/// One item on offer. `division` of `None` is the unfiled state this file is
/// largely about, and an empty `tags` is the same idea one table over.
///
/// Nothing here comes in variants: most of this file is about how the
/// classification clauses behave, and adding colours to every seeded row would
/// mean every one of those tests silently depended on them. `variant` below is
/// for the tests that are about variants.
async fn item(
    pool: &PgPool,
    supplier_id: Uuid,
    code: &str,
    division: Option<&str>,
    tags: &[&str],
) -> Uuid {
    variant(pool, supplier_id, code, division, tags, &[], &[]).await
}

/// The same, offered in colours and sizes.
async fn variant(
    pool: &PgPool,
    supplier_id: Uuid,
    code: &str,
    division: Option<&str>,
    tags: &[&str],
    colours: &[&str],
    sizes: &[&str],
) -> Uuid {
    cloud::create_supplier_item(
        pool,
        supplier_id,
        CreateSupplierItemRequest {
            supplier_item_code: code.to_owned(),
            name: format!("Item {code}"),
            description: None,
            image_url: None,
            unit_price_minor: 50_000,
            currency: "IDR".to_owned(),
            internal_article_code: None,
            status: SupplierStatus::Active,
            division_code: division.map(str::to_owned),
            tags: tags.iter().map(|tag| (*tag).to_owned()).collect(),
            colour_codes: colours.iter().map(|one| (*one).to_owned()).collect(),
            size_codes: sizes.iter().map(|one| (*one).to_owned()).collect(),
        },
        ACTOR,
        &format!("item-{code}"),
        "digest",
    )
    .await
    .unwrap_or_else(|e| panic!("item {code}: {e}"))
    .supplier_item_id
}

/// The item codes a scope returns, sorted, so an assertion reads as a set and
/// does not quietly depend on the relevance order.
async fn codes(pool: &PgPool, scope: SourcingScope) -> Vec<String> {
    let page = cloud::search_supplier_items(pool, scope)
        .await
        .unwrap_or_else(|e| panic!("search: {e}"));
    let mut found: Vec<String> = page
        .items
        .into_iter()
        .map(|row| row.item.supplier_item_code)
        .collect();
    found.sort();
    found
}

/// A catalogue with one of each interesting shape: two filed divisions, one
/// unfiled item, and one item nobody has tagged.
async fn seed(pool: &PgPool) -> Uuid {
    let acme = supplier(pool, "ACME", "Acme Garments").await;
    item(pool, acme, "KID-1", Some("ANAK_LAKI"), &["KAOS"]).await;
    item(pool, acme, "KID-2", Some("ANAK_LAKI"), &["KEMEJA"]).await;
    item(pool, acme, "MEN-1", Some("PRIA"), &["KAOS"]).await;
    item(pool, acme, "UNFILED-1", None, &[]).await;
    acme
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn excluding_a_division_keeps_the_items_nobody_has_filed(pool: PgPool) {
    seed(&pool).await;

    let found = codes(
        &pool,
        SourcingScope {
            excluded_division_codes: vec!["ANAK_LAKI".to_owned()],
            ..everything()
        },
    )
    .await;

    // The unfiled item is the point. It is not kidswear, so a buyer who asked
    // for anything-but-kidswear must be shown it — and it is precisely the row
    // they are most likely to be hunting for.
    assert_eq!(found, vec!["MEN-1", "UNFILED-1"]);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn excluding_every_division_still_leaves_the_unfiled_ones(pool: PgPool) {
    seed(&pool).await;

    let found = codes(
        &pool,
        SourcingScope {
            excluded_division_codes: vec!["ANAK_LAKI".to_owned(), "PRIA".to_owned()],
            ..everything()
        },
    )
    .await;

    assert_eq!(found, vec!["UNFILED-1"]);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_positive_and_a_negative_division_narrow_together(pool: PgPool) {
    seed(&pool).await;
    let acme = supplier(&pool, "BETA", "Beta Textiles").await;
    item(&pool, acme, "KID-3", Some("ANAK_LAKI"), &["KAOS"]).await;

    // "Kidswear, but not Beta's" — the pair a single signed parameter could
    // not express, which is why the negation is its own field.
    let found = codes(
        &pool,
        SourcingScope {
            division_codes: vec!["ANAK_LAKI".to_owned()],
            excluded_supplier_ids: vec![acme],
            ..everything()
        },
    )
    .await;

    assert_eq!(found, vec!["KID-1", "KID-2"]);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn asking_for_the_unfiled_items_agrees_with_the_facet_that_counts_them(pool: PgPool) {
    seed(&pool).await;

    let found = codes(
        &pool,
        SourcingScope {
            division_null: Some(true),
            ..everything()
        },
    )
    .await;
    assert_eq!(found, vec!["UNFILED-1"]);

    // The number beside the tick is what somebody read before they clicked it.
    // Before this clause existed the facet said 1 and the filter returned 0.
    let page = cloud::search_supplier_items(&pool, everything())
        .await
        .unwrap_or_else(|e| panic!("search: {e}"));
    let counted = page
        .facets
        .divisions
        .iter()
        .find(|facet| facet.value == "Unclassified")
        .map(|facet| facet.count)
        .unwrap_or_else(|| panic!("the Unclassified facet was not offered at all"));
    assert_eq!(counted, found.len() as i64);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn asking_for_the_filed_items_is_the_same_question_answered_the_other_way(pool: PgPool) {
    seed(&pool).await;

    let found = codes(
        &pool,
        SourcingScope {
            division_null: Some(false),
            ..everything()
        },
    )
    .await;

    assert_eq!(found, vec!["KID-1", "KID-2", "MEN-1"]);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn excluding_a_tag_keeps_the_items_carrying_none(pool: PgPool) {
    seed(&pool).await;

    let found = codes(
        &pool,
        SourcingScope {
            excluded_tag_codes: vec!["KAOS".to_owned()],
            ..everything()
        },
    )
    .await;

    // Same rule as division, one table over: an untagged item does not carry
    // KAOS, so excluding KAOS must not exclude it.
    assert_eq!(found, vec!["KID-2", "UNFILED-1"]);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn asking_for_the_untagged_items_returns_only_those(pool: PgPool) {
    seed(&pool).await;

    let found = codes(
        &pool,
        SourcingScope {
            tags_null: Some(true),
            ..everything()
        },
    )
    .await;

    assert_eq!(found, vec!["UNFILED-1"]);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_scope_with_no_negation_is_the_whole_catalogue(pool: PgPool) {
    seed(&pool).await;

    // The guard against the obvious regression: writing the new clauses as
    // `= ANY('{}')` rather than a null check would narrow every request in the
    // app to nothing, and every other test here would still pass.
    let found = codes(&pool, everything()).await;

    assert_eq!(found, vec!["KID-1", "KID-2", "MEN-1", "UNFILED-1"]);
}

// ---------------------------------------------------------------------------
// What an item comes in
//
// The six shapes a variant clause has, and one guard. Seeded separately from
// `seed` on purpose: the classification tests above must not start depending
// on colours nobody asked them about.

/// Three items in three overlapping colour and size runs, plus one offered in
/// nothing at all — which is the state most of a scraped supplier feed is in
/// and therefore the one worth a row of its own.
async fn wardrobe(pool: &PgPool) -> Uuid {
    let acme = supplier(pool, "ACME", "Acme Garments").await;
    variant(
        pool,
        acme,
        "TEE",
        Some("PRIA"),
        &[],
        &["NAVY", "BLACK"],
        &["02", "03", "04"],
    )
    .await;
    variant(
        pool,
        acme,
        "SHIRT",
        Some("PRIA"),
        &[],
        &["WHITE", "NAVY"],
        &["03", "04", "05"],
    )
    .await;
    variant(
        pool,
        acme,
        "BOOT",
        Some("SANDAL_SEPATU"),
        &[],
        &["BLACK"],
        &["14"],
    )
    .await;
    item(pool, acme, "PLAIN", Some("PRIA"), &[]).await;
    acme
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_colour_clause_is_an_any_and_not_an_all(pool: PgPool) {
    wardrobe(&pool).await;

    let found = codes(
        &pool,
        SourcingScope {
            colour_codes: vec!["NAVY".to_owned(), "WHITE".to_owned()],
            ..everything()
        },
    )
    .await;

    // The tee is navy and not white, and it is still here. Somebody narrowing a
    // catalogue by two colours is naming what would do, not writing a spec —
    // reading this as an AND would return the shirt alone and quietly hide the
    // thing they were most likely looking for.
    assert_eq!(found, vec!["SHIRT", "TEE"]);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn excluding_a_colour_keeps_the_items_offered_in_no_colour(pool: PgPool) {
    wardrobe(&pool).await;

    let found = codes(
        &pool,
        SourcingScope {
            excluded_colour_codes: vec!["NAVY".to_owned()],
            ..everything()
        },
    )
    .await;

    // `PLAIN` comes in nothing, so it is truthfully not navy. The division
    // clause above makes the same call for the same reason: dropping the
    // unfiled rows would hide exactly the ones somebody cleaning the catalogue
    // is hunting for.
    assert_eq!(found, vec!["BOOT", "PLAIN"]);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_size_clause_matches_an_item_offered_in_that_size(pool: PgPool) {
    wardrobe(&pool).await;

    let found = codes(
        &pool,
        SourcingScope {
            size_codes: vec!["02".to_owned()],
            ..everything()
        },
    )
    .await;

    assert_eq!(found, vec!["TEE"]);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_empty_clauses_find_what_nobody_has_broken_down(pool: PgPool) {
    wardrobe(&pool).await;

    assert_eq!(
        codes(
            &pool,
            SourcingScope {
                colours_null: Some(true),
                ..everything()
            },
        )
        .await,
        vec!["PLAIN"]
    );
    assert_eq!(
        codes(
            &pool,
            SourcingScope {
                sizes_null: Some(false),
                ..everything()
            },
        )
        .await,
        vec!["BOOT", "SHIRT", "TEE"]
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_item_carries_its_colours_labelled_and_its_sizes_in_size_order(pool: PgPool) {
    wardrobe(&pool).await;

    let page = cloud::search_supplier_items(
        &pool,
        SourcingScope {
            needle: Some("SHIRT".to_owned()),
            ..everything()
        },
    )
    .await
    .expect("search");
    let item = &page.items.first().expect("the shirt").item;

    // Labelled and hexed on the row, so a card draws its swatches without
    // fetching the colour master — and in the master's own display order, not
    // in the order they were written.
    assert_eq!(
        item.colours
            .iter()
            .map(|one| one.colour_code.as_str())
            .collect::<Vec<_>>(),
        vec!["WHITE", "NAVY"]
    );
    assert_eq!(item.colours[0].label, "White");
    assert_eq!(item.colours[0].hex_code.as_deref(), Some("#FFFFFF"));

    // Size order, which is what lets a screen print "M–XL" as the first and the
    // last of the list rather than sorting `03`, `04`, `05` itself.
    assert_eq!(item.size_codes, vec!["03", "04", "05"]);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_facets_count_items_and_not_variants(pool: PgPool) {
    wardrobe(&pool).await;

    let page = cloud::search_supplier_items(&pool, everything())
        .await
        .expect("search");
    let navy = page
        .facets
        .colours
        .iter()
        .find(|one| one.value == "NAVY")
        .expect("navy is counted");

    // Two items are offered in navy, across five colour rows between them. The
    // number a buyer reads has to be "how many things could I buy in navy".
    assert_eq!(navy.count, 2);

    let medium = page
        .facets
        .sizes
        .iter()
        .find(|one| one.value == "03")
        .expect("M is counted");
    assert_eq!(medium.count, 2);
}
