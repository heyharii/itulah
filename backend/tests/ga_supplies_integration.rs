//! GA tahap 5: the places hub and the supplies register.
//!
//! What 0367/0368 installed and what `postgres/ga_locations.rs` and
//! `postgres/ga_supplies.rs` enforce: the one-to-one place detail that does not
//! create a site, the seven supply categories and the customer-supplies
//! boundary, the ask's stage ladder and its three refusals, the site-own rule a
//! shop files under, and the overview's new "new asks" section.
//!
//! The style follows `ga_maintenance_integration`: a helper builds the ordinary
//! case so each test says only what it is about.

use chrono::NaiveDate;
use inventory_backend::cloud::{domain, postgres as cloud};
use sqlx::PgPool;
use uuid::Uuid;

const ACTOR: &str = "ana";

fn day(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).unwrap_or_else(|| panic!("bad date"))
}

/// The business day every read is answered against: late September 2026.
fn today() -> NaiveDate {
    day(2026, 9, 24)
}

/// A registered supplier, because a repair must name the party doing the work.
async fn a_supplier(pool: &PgPool) -> Uuid {
    let id = Uuid::new_v4();
    let suffix = id.simple().to_string();
    sqlx::query(
        "INSERT INTO supplier (supplier_id, supplier_code, supplier_code_normalized, name,
                               created_by, updated_by)
         VALUES ($1, $2, $3, 'Teknisi Servis Nusantara', 'ana', 'ana')",
    )
    .bind(id)
    .bind(format!("SUP-GA5-{}", &suffix[..8]))
    .bind(format!("sup-ga5-{}", &suffix[..8]))
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("supplier: {error}"));
    id
}

/// The ordinary ask: A4 paper for a shop, at the start of the ladder.
async fn a_request(pool: &PgPool, site_id: &str) -> cloud::GaSupplyRequestRow {
    cloud::ga_supply_record(
        pool,
        &cloud::RecordGaSupplyRequestRequest {
            site_id: site_id.into(),
            requested_by: "Rina".into(),
            category_code: "ATK".into(),
            item: "Kertas A4 80gsm".into(),
            quantity: Some("10 rim".into()),
            needed_by: Some(day(2026, 10, 1)),
            estimated_cost_minor: Some(750_000),
            notes: None,
        },
        ACTOR,
        None,
    )
    .await
    .unwrap_or_else(|error| panic!("supply request: {error}"))
}

/// Advance one request through every rung, collecting the row at each step.
async fn advance(
    pool: &PgPool,
    request_id: Uuid,
    to: &str,
    po_reference: Option<&str>,
) -> cloud::GaSupplyRequestRow {
    cloud::ga_supply_move(
        pool,
        request_id,
        &cloud::MoveGaSupplyRequestRequest {
            to: to.into(),
            po_reference: po_reference.map(str::to_string),
            rejected_reason: None,
        },
        ACTOR,
        None,
    )
    .await
    .unwrap_or_else(|error| panic!("move to {to}: {error}"))
}

// ---------------------------------------------------------------------------
// 1. The migration
// ---------------------------------------------------------------------------

/// The detail's key is the site, seven categories are seeded, none of them is
/// Customer Supplies, and the estate has exactly one head office.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_migration_installs_the_detail_and_the_seven_categories(pool: PgPool) {
    // The primary key of the side table is the site itself: one place, one row.
    let mut pk: Vec<String> = sqlx::query_scalar(
        "SELECT k.column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage k
             ON k.constraint_name = tc.constraint_name
            AND k.table_name = tc.table_name
          WHERE tc.table_name = 'ga_location_detail'
            AND tc.constraint_type = 'PRIMARY KEY'",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("pk: {error}"));
    pk.sort();
    assert_eq!(pk, vec!["site_id".to_string()], "the detail is keyed by the site");

    let categories: i64 = sqlx::query_scalar("SELECT count(*) FROM ga_supply_category")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("categories: {error}"));
    assert_eq!(categories, 7, "brief §9.4 keeps seven supply categories");

    let customer_supplies: i64 =
        sqlx::query_scalar("SELECT count(*) FROM ga_supply_category WHERE account_code = '6004'")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("6004: {error}"));
    assert_eq!(customer_supplies, 0, "6004 belongs to Commercial, not GA");

    // Every account is a live leaf, or a bill would resolve and then refuse.
    let not_leaves: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM ga_supply_category c
           JOIN ledger_account a ON a.account_code = c.account_code
          WHERE a.is_group OR NOT a.is_active",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("leaves: {error}"));
    assert_eq!(not_leaves, 0);

    let head_offices: i64 = sqlx::query_scalar("SELECT count(*) FROM site WHERE kind = 'HO'")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("ho: {error}"));
    assert_eq!(head_offices, 1, "two head offices is a bug, not a configuration");
}

// ---------------------------------------------------------------------------
// 2. The places
// ---------------------------------------------------------------------------

/// A site with no detail is still a place; filling the detail in creates no new
/// site; and the counts beside a place are read back through the references.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_place_keeps_its_detail_without_becoming_a_second_site(pool: PgPool) {
    // Nothing has been written about store-01, and it is on the list anyway.
    let listed = cloud::ga_locations(&pool, None, today())
        .await
        .unwrap_or_else(|error| panic!("locations: {error}"));
    let bare = listed
        .iter()
        .find(|place| place.site_id == "store-01")
        .unwrap_or_else(|| panic!("a site with no detail is still a place"));
    assert!(bare.address.is_none());
    assert_eq!(bare.site_kind, "STORE");
    assert_eq!(bare.version, 0, "nobody has written GA's detail yet");

    let sites_before: i64 = sqlx::query_scalar("SELECT count(*) FROM site")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("sites: {error}"));

    let updated = cloud::ga_location_update(
        &pool,
        "store-01",
        &cloud::UpdateGaLocationRequest {
            address: Some("Jl. Merdeka 1, Bandung".into()),
            kind: Some("Toko".into()),
            floor_area_sqm: Some(240),
            contact_name: Some("Pak Andi".into()),
            contact_phone: Some("0812-3456".into()),
            notes: Some("pintu belakang untuk bongkar".into()),
        },
        ACTOR,
        today(),
    )
    .await
    .unwrap_or_else(|error| panic!("update: {error}"));
    assert_eq!(updated.address.as_deref(), Some("Jl. Merdeka 1, Bandung"));
    assert_eq!(updated.kind.as_deref(), Some("Toko"));
    assert_eq!(updated.floor_area_sqm, Some(240));
    assert_eq!(updated.version, 1, "the first write is version one");

    let sites_after: i64 = sqlx::query_scalar("SELECT count(*) FROM site")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("sites: {error}"));
    assert_eq!(sites_before, sites_after, "a detail never creates a site");

    // Now the counts. One of each, all at store-01.
    let asset_id = Uuid::new_v4();
    let suffix = asset_id.simple().to_string();
    sqlx::query(
        "INSERT INTO fixed_asset
           (asset_id, asset_number, name, category_code, site_id, acquired_on, status, registered_by)
         VALUES ($1,$2,'AC toko','AIR_CONDITIONER','store-01',$3,'REGISTERED','ana')",
    )
    .bind(asset_id)
    .bind(format!("AST-GA5-{}", &suffix[..8]))
    .bind(today())
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("asset: {error}"));

    sqlx::query(
        "INSERT INTO ga_contract (contract_type, counterparty_name, site_id, starts_on, created_by)
         VALUES ('SEWA_TOKO', 'Pemilik Ruko', 'store-01', $1, 'ana')",
    )
    .bind(today())
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("contract: {error}"));

    let supplier = a_supplier(&pool).await;
    sqlx::query(
        "INSERT INTO ga_repair (site_id, objek, title, supplier_id, failure_at, created_by)
         VALUES ('store-01', 'AC', 'AC tidak dingin', $1, $2, 'ana')",
    )
    .bind(supplier)
    .bind(today())
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("repair: {error}"));

    a_request(&pool, "store-01").await;

    let hub = cloud::ga_location(&pool, "store-01", today())
        .await
        .unwrap_or_else(|error| panic!("hub: {error}"));
    assert_eq!(hub.location.asset_count, 1, "one thing is here");
    assert_eq!(hub.location.contract_count, 1, "one deal names this place");
    assert_eq!(hub.location.open_repair_count, 1, "one repair is open");
    assert_eq!(hub.location.supply_request_count, 1, "one ask came from here");
    assert_eq!(hub.assets.len(), 1);
    assert_eq!(hub.contracts.len(), 1);
    assert_eq!(hub.repairs.len(), 1);
    assert_eq!(hub.supplies.len(), 1);

    // Somewhere the estate does not have is a 404, not a new place.
    let missing = cloud::ga_location(&pool, "toko-yang-tidak-ada", today()).await;
    assert!(missing.is_err(), "a hub is only for a place that exists");
}

/// The site-own rule: a shop files for itself, head office for anywhere.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_shop_files_a_supply_request_only_for_itself(pool: PgPool) {
    // A shop token names store-01; the ask must be for store-01.
    let refused = cloud::ga_supply_record(
        &pool,
        &cloud::RecordGaSupplyRequestRequest {
            site_id: "store-02".into(),
            requested_by: "Rina".into(),
            category_code: "ATK".into(),
            item: "Kertas A4".into(),
            quantity: None,
            needed_by: None,
            estimated_cost_minor: None,
            notes: None,
        },
        ACTOR,
        Some("store-01"),
    )
    .await
    .expect_err("a shop may not file for another shop");
    assert!(
        refused.to_string().contains("store-02") && refused.to_string().contains("store-01"),
        "the refusal names both places: {refused}"
    );

    // The same ask for its own site is fine.
    cloud::ga_supply_record(
        &pool,
        &cloud::RecordGaSupplyRequestRequest {
            site_id: "store-01".into(),
            requested_by: "Rina".into(),
            category_code: "ATK".into(),
            item: "Kertas A4".into(),
            quantity: None,
            needed_by: None,
            estimated_cost_minor: None,
            notes: None,
        },
        ACTOR,
        Some("store-01"),
    )
    .await
    .unwrap_or_else(|error| panic!("own site: {error}"));

    // Head office passes None and is not narrowed.
    cloud::ga_supply_record(
        &pool,
        &cloud::RecordGaSupplyRequestRequest {
            site_id: "store-05".into(),
            requested_by: "GA HO".into(),
            category_code: "ATK".into(),
            item: "Kertas A4".into(),
            quantity: None,
            needed_by: None,
            estimated_cost_minor: None,
            notes: None,
        },
        ACTOR,
        None,
    )
    .await
    .unwrap_or_else(|error| panic!("head office: {error}"));
}

// ---------------------------------------------------------------------------
// 3. The supply ladder, pure and under the database
// ---------------------------------------------------------------------------

/// Every legal move is accepted and every other pair is refused, and the two
/// ends hold still. Tested directly because the database could only repeat it.
#[test]
fn the_supply_ladder_is_one_way_and_its_ends_are_ends() {
    let states = ["REQUESTED", "APPROVED", "ORDERED", "RECEIVED", "BILLED", "REJECTED"];
    let legal = [
        ("REQUESTED", "APPROVED"),
        ("REQUESTED", "REJECTED"),
        ("APPROVED", "ORDERED"),
        ("ORDERED", "RECEIVED"),
        ("RECEIVED", "BILLED"),
    ];
    for from in states {
        for to in states {
            assert_eq!(
                domain::supply_may_move(from, to),
                legal.contains(&(from, to)),
                "{from} -> {to}"
            );
        }
    }
    for to in states {
        assert!(!domain::supply_may_move("BILLED", to), "BILLED is an end");
        assert!(!domain::supply_may_move("REJECTED", to), "REJECTED is an end");
    }
    assert_eq!(
        domain::SUPPLY_STATUS_FLOW,
        &["REQUESTED", "APPROVED", "ORDERED", "RECEIVED", "BILLED"][..],
        "REJECTED sits outside the flow"
    );
}

/// A rejection says why, a PO number rides only the order, the later moves keep
/// the number, and a billed request does not move again.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_rejection_says_why_and_a_po_only_rides_the_order(pool: PgPool) {
    let request = a_request(&pool, "store-01").await;

    // REJECTED with no reason is refused, in words.
    let refused = cloud::ga_supply_move(
        &pool,
        request.request_id,
        &cloud::MoveGaSupplyRequestRequest {
            to: "REJECTED".into(),
            po_reference: None,
            rejected_reason: None,
        },
        ACTOR,
        None,
    )
    .await
    .expect_err("a rejection must say why");
    assert!(refused.to_string().contains("why"), "{refused}");

    // A PO number offered before ORDERED is refused, naming the stage.
    let refused = cloud::ga_supply_move(
        &pool,
        request.request_id,
        &cloud::MoveGaSupplyRequestRequest {
            to: "APPROVED".into(),
            po_reference: Some("PO-2026-0001".into()),
            rejected_reason: None,
        },
        ACTOR,
        None,
    )
    .await
    .expect_err("a PO number only rides the order");
    assert!(refused.to_string().contains("ORDERED"), "{refused}");

    // The legal path, and the PO set at ORDERED is kept by the moves after it.
    let approved = advance(&pool, request.request_id, "APPROVED", None).await;
    assert_eq!(approved.status, "APPROVED");
    let ordered = advance(&pool, request.request_id, "ORDERED", Some("PO-2026-0001")).await;
    assert_eq!(ordered.po_reference.as_deref(), Some("PO-2026-0001"));
    let received = advance(&pool, request.request_id, "RECEIVED", None).await;
    assert_eq!(
        received.po_reference.as_deref(),
        Some("PO-2026-0001"),
        "a received request did not lose the order it was placed on"
    );
    let billed = advance(&pool, request.request_id, "BILLED", None).await;
    assert_eq!(billed.status, "BILLED");

    // BILLED is the end.
    let refused = cloud::ga_supply_move(
        &pool,
        request.request_id,
        &cloud::MoveGaSupplyRequestRequest {
            to: "RECEIVED".into(),
            po_reference: None,
            rejected_reason: None,
        },
        ACTOR,
        None,
    )
    .await
    .expect_err("a billed request is history");
    assert!(refused.to_string().contains("BILLED"), "{refused}");
}

/// An unknown category is refused with the seven named, and a decided request
/// is not corrected through the update route.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_request_uses_a_known_category_and_is_corrected_before_it_is_decided(pool: PgPool) {
    let refused = cloud::ga_supply_record(
        &pool,
        &cloud::RecordGaSupplyRequestRequest {
            site_id: "store-01".into(),
            requested_by: "Rina".into(),
            category_code: "CUSTOMER_SUPPLIES".into(),
            item: "kantong".into(),
            quantity: None,
            needed_by: None,
            estimated_cost_minor: None,
            notes: None,
        },
        ACTOR,
        None,
    )
    .await
    .expect_err("6004 is not a GA category");
    assert!(refused.to_string().contains("ATK"), "the refusal lists the seven: {refused}");

    let request = a_request(&pool, "store-01").await;
    let corrected = cloud::ga_supply_update(
        &pool,
        request.request_id,
        &cloud::UpdateGaSupplyRequest {
            requested_by: None,
            category_code: None,
            item: Some("Kertas A3".into()),
            quantity: Some("4 rim".into()),
            needed_by: None,
            estimated_cost_minor: Some(400_000),
            notes: Some("untuk laporan".into()),
        },
        ACTOR,
        None,
    )
    .await
    .unwrap_or_else(|error| panic!("update: {error}"));
    assert_eq!(corrected.item, "Kertas A3");
    assert_eq!(corrected.version, 2, "a correction moves the version");

    advance(&pool, request.request_id, "APPROVED", None).await;
    let refused = cloud::ga_supply_update(
        &pool,
        request.request_id,
        &cloud::UpdateGaSupplyRequest {
            requested_by: None,
            category_code: None,
            item: Some("Kertas A3".into()),
            quantity: None,
            needed_by: None,
            estimated_cost_minor: None,
            notes: None,
        },
        ACTOR,
        None,
    )
    .await
    .expect_err("an approved request is a decision, not a draft");
    assert!(refused.to_string().contains("APPROVED"), "{refused}");
}

// ---------------------------------------------------------------------------
// 4. The categories
// ---------------------------------------------------------------------------

/// The seven categories are the brief's own pairs, and Customer Supplies is not
/// among them.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_seven_categories_are_the_briefs_and_exclude_customer_supplies(pool: PgPool) {
    let categories = cloud::ga_supply_categories(&pool)
        .await
        .unwrap_or_else(|error| panic!("categories: {error}"));
    assert_eq!(categories.len(), 7);

    let expected: &[(&str, &str)] = &[
        ("ATK", "6041"),
        ("RUMAH_TANGGA", "6042"),
        ("TOKO_KANTOR", "6052"),
        ("LISTRIK", "6054"),
        ("TOOLS", "6057"),
        ("TELEPON", "6059"),
        ("MESS", "6063"),
    ];
    for (code, account) in expected {
        let category = categories
            .iter()
            .find(|category| category.category_code == *code)
            .unwrap_or_else(|| panic!("no {code}"));
        assert_eq!(category.account_code, *account, "{code} is the brief's account");
    }
    assert!(
        categories.iter().all(|category| category.account_code != "6004"),
        "Customer Supplies is Commercial's"
    );
}

// ---------------------------------------------------------------------------
// 5. Who may reach it
// ---------------------------------------------------------------------------

/// Every new location and supply route sits on GA's surface, which is one rung
/// for reads and writes alike.
#[test]
fn the_location_and_supply_routes_are_a_supervisors_surface() {
    let id = "9f0f5f0e-0000-0000-0000-000000000000";
    for (method, path) in [
        ("GET", "/api/v1/ga/locations".to_string()),
        ("GET", format!("/api/v1/ga/locations/{id}")),
        ("PATCH", format!("/api/v1/ga/locations/{id}")),
        ("GET", "/api/v1/ga/supplies".to_string()),
        ("POST", "/api/v1/ga/supplies".to_string()),
        ("POST", format!("/api/v1/ga/supplies/{id}/move")),
        ("GET", "/api/v1/ga/supply-categories".to_string()),
    ] {
        assert_eq!(
            domain::required_role(method, &path),
            domain::Role::Supervisor,
            "{method} {path}"
        );
    }
}

// ---------------------------------------------------------------------------
// 6. The overview's new asks
// ---------------------------------------------------------------------------

/// A REQUESTED ask is on the overview; one that has been billed is not.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_overview_lists_new_asks_and_not_billed_ones(pool: PgPool) {
    let open = a_request(&pool, "store-01").await;

    let settled = a_request(&pool, "store-02").await;
    advance(&pool, settled.request_id, "APPROVED", None).await;
    advance(&pool, settled.request_id, "ORDERED", Some("PO-2026-0002")).await;
    advance(&pool, settled.request_id, "RECEIVED", None).await;
    advance(&pool, settled.request_id, "BILLED", None).await;

    // The overview's supply section does not exist until the tahap-5 wiring
    // lands; the integrator adds `GaOverview.supply_requests` and its reader.
    let overview = cloud::ga_overview(&pool, today())
        .await
        .unwrap_or_else(|error| panic!("overview: {error}"));
    let ids: Vec<String> = overview
        .supply_requests
        .iter()
        .map(|row| row.id.clone())
        .collect();
    assert!(
        ids.contains(&open.request_id.to_string()),
        "a REQUESTED ask wants somebody's attention: {ids:?}"
    );
    assert!(
        !ids.contains(&settled.request_id.to_string()),
        "a BILLED ask has already been decided"
    );
}
