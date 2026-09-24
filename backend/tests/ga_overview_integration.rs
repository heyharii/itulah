//! GA's own surface: the build a class is filled in on, and what the overview
//! decides is worth somebody's attention.
//!
//! The register itself is tested in `assets_completeness_integration`; this file
//! holds the two facts the General Affairs screens add to it — `asset_class.build`
//! (0356) and `GET /api/v1/ga/overview`.

use inventory_backend::cloud::postgres::{self as cloud};
use sqlx::PgPool;

const ACTOR: &str = "ana";

fn day(year: i32, month: u32, day: u32) -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(year, month, day).unwrap_or_else(|| panic!("bad date"))
}

/// The eleven forms, spelled out here rather than imported.
///
/// Deliberately a second copy: the point of the assertion is that the DATABASE
/// carries one of exactly these, and a test that read the list from the code it
/// is testing would pass on the day somebody added a twelfth build to both
/// halves of the same mistake.
const BUILDS: [&str; 11] = [
    "LAND", "BUILDING", "TECH", "VEHICLE", "FFE", "IT", "AUDIO", "OE", "SOFTWARE", "DEFERRED", "CIP",
];

fn an_asset(number: &str, class: &str) -> cloud::RegisterAssetRequest {
    cloud::RegisterAssetRequest {
        asset_number: number.into(),
        name: format!("{class} for {number}"),
        category_code: class.into(),
        site_id: "dc".into(),
        acquired_on: day(2026, 1, 15),
        serial_number: Some(format!("SN-{number}")),
        notes: None,
        quantity: None,
        acquired_via_line_id: None,
    }
}

/// Every class the register keeps is filled in on one of the eleven forms, and
/// every one of the eleven has something filed under it.
///
/// Both halves matter and they fail differently. A class with no build is a
/// class whose form nobody can draw — the omission 0356 exists to prevent. A
/// build with no class is a form and an icon maintained for nothing, which is
/// how a list of eleven quietly becomes a list of nine and nobody notices.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_class_is_filled_in_on_one_of_the_eleven_builds(pool: PgPool) {
    let classes = cloud::asset_classes(&pool, None)
        .await
        .unwrap_or_else(|error| panic!("classes: {error}"))
        .classes;
    assert!(classes.len() > 40, "the register keeps the client's own list");

    for class in &classes {
        assert!(
            BUILDS.contains(&class.build.as_str()),
            "{} is filed on '{}', which is not one of the eleven forms",
            class.class_code,
            class.build
        );
    }

    for build in BUILDS {
        assert!(
            classes.iter().any(|class| class.build == build),
            "no class is filled in on {build}, so its form is drawn for nobody"
        );
    }

    // The two that a reader would most easily get wrong, because the class list
    // does not say it: four classes are one form, and the thirty-six operating
    // equipment sub-types are one form told thirty-six ways.
    let build_of = |code: &str| {
        classes
            .iter()
            .find(|class| class.class_code == code)
            .map(|class| class.build.as_str())
            .unwrap_or_else(|| panic!("{code} is not a class"))
    };
    assert_eq!(build_of("AIR_CONDITIONER"), "TECH");
    assert_eq!(build_of("LIFT"), "TECH");
    assert_eq!(build_of("GENSET"), "TECH");
    assert_eq!(build_of("MOBIL"), "VEHICLE");
    assert_eq!(build_of("FFE_KOMPUTER"), "IT");
    assert_eq!(build_of("FFE_MUSIC"), "AUDIO");
    assert_eq!(build_of("OE_HANGER_PRIA"), "OE");
    assert_eq!(build_of("CONTRACT_IN_PROGRESS"), "CIP");
}

/// A row carries its build, because that is what the register draws its icon
/// from and what the build views narrow by.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_register_row_says_which_build_it_is(pool: PgPool) {
    let asset = cloud::register_asset(&pool, &an_asset("AST-9001", "AIR_CONDITIONER"), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("register: {error}"));
    assert_eq!(asset.build, "TECH");

    // And the filter is the same answer the row gives, so a chip that says
    // "Technical Equipment 1" cannot disagree with the list it opens.
    let machines = cloud::asset_page(
        &pool,
        cloud::AssetScope {
            builds: vec!["TECH".into()],
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("page: {error}"));
    assert_eq!(machines.total, 1);
    assert_eq!(machines.rows[0].asset_number, "AST-9001");

    let vehicles = cloud::asset_page(
        &pool,
        cloud::AssetScope {
            builds: vec!["VEHICLE".into()],
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("page: {error}"));
    assert_eq!(vehicles.total, 0, "an air conditioner is not a vehicle");

    // The chips count over the SEARCH rather than over the filters, which is
    // what makes "Vehicles 0" beside "Technical Equipment 1" a fact about the
    // register and not about what the reader has already clicked.
    assert!(machines
        .facets
        .builds
        .iter()
        .any(|facet| facet.value == "TECH" && facet.count == 1));
    assert!(
        machines
            .facets
            .builds
            .iter()
            .all(|facet| facet.value != "VEHICLE"),
        "a build with nothing under it is absent rather than zero"
    );
}

/// The overview lists what is unfinished and nothing else.
///
/// A draft asset is the one thing on it today, and it is the right thing: the
/// bill came first, the thing has arrived, and nobody has said where it is or
/// who holds it. An asset somebody has walked the floor for is not a nudge.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_overview_lists_drafts_and_leaves_finished_assets_alone(pool: PgPool) {
    let draft = cloud::register_asset(&pool, &an_asset("AST-9002", "FFE_KOMPUTER"), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("register: {error}"));
    let finished = cloud::register_asset(&pool, &an_asset("AST-9003", "MOBIL"), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("register: {error}"));

    // A DRAFT is what `post_bill` mints when a bill carries an asset class —
    // see `asset_drafts_for_bill`. Made here by hand so the overview is tested
    // without standing up a whole bill, which `assets_completeness` already
    // does from the other end.
    sqlx::query("UPDATE fixed_asset SET status = 'DRAFT' WHERE asset_id = $1")
        .bind(draft.asset_id)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("draft: {error}"));

    let overview = cloud::ga_overview(&pool, day(2026, 9, 24))
        .await
        .unwrap_or_else(|error| panic!("overview: {error}"));

    assert_eq!(overview.generated_on, "2026-09-24");
    assert_eq!(overview.draft_assets.len(), 1);
    let row = &overview.draft_assets[0];
    assert_eq!(row.kind, "asset");
    assert_eq!(row.id, draft.asset_id.to_string());
    assert_eq!(row.label, draft.name);
    assert_eq!(
        row.detail.as_deref(),
        Some("FFE_KOMPUTER · dc"),
        "the row says what it is and where, so the list is readable without opening it"
    );
    assert!(
        !overview
            .draft_assets
            .iter()
            .any(|row| row.id == finished.asset_id.to_string()),
        "an asset that is registered is not waiting for anybody"
    );
}

/// An empty register is an empty overview, and not an error.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_empty_overview_answers_with_nothing_rather_than_refusing(pool: PgPool) {
    let overview = cloud::ga_overview(&pool, day(2026, 9, 24))
        .await
        .unwrap_or_else(|error| panic!("overview: {error}"));
    assert!(overview.draft_assets.is_empty());
}
