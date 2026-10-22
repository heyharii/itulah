//! GA tahap 4: the schedule, the walk-round, the repair, the swap and the
//! disposal.
//!
//! What 0365/0366 installed and what `postgres/ga_maintenance.rs` enforces:
//! the five tables and the append-only inspection, the repair ladder and the
//! maker/checker rule on the three acts that commit money, the replacement
//! that mints a new asset, the disposal Finance answers but does not book here,
//! and the §9.3 account map the objects resolve through. The overview's three
//! new sections are read last — they are the screen that reads all of this at
//! once.
//!
//! The style follows `ga_contracts_integration`: a helper builds the ordinary
//! case so each test says only what it is about.

use chrono::NaiveDate;
use inventory_backend::cloud::{domain, postgres as cloud};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
/// The second pair of eyes. Every approval in here is theirs, because the maker
/// may not approve their own.
const CHECKER: &str = "budi";

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
    .bind(format!("SUP-GA4-{}", &suffix[..8]))
    .bind(format!("sup-ga4-{}", &suffix[..8]))
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("supplier: {error}"));
    id
}

/// A thing in the register. `specs` is what a build would have written.
async fn an_asset_with_specs(pool: &PgPool, class_code: &str, specs: serde_json::Value) -> Uuid {
    let id = Uuid::new_v4();
    let suffix = id.simple().to_string();
    sqlx::query(
        "INSERT INTO fixed_asset
           (asset_id, asset_number, name, category_code, site_id, acquired_on, specs, status,
            registered_by)
         VALUES ($1,$2,$3,$4,'dc',$5,$6,'REGISTERED','ana')",
    )
    .bind(id)
    .bind(format!("AST-GA4-{}", &suffix[..8]))
    .bind(format!("Asset uji {class_code}"))
    .bind(class_code)
    .bind(today())
    .bind(specs)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("asset: {error}"));
    id
}

async fn an_asset(pool: &PgPool, class_code: &str) -> Uuid {
    an_asset_with_specs(pool, class_code, serde_json::json!({})).await
}

async fn a_task(
    pool: &PgPool,
    asset_id: Option<Uuid>,
    site_id: Option<&str>,
    interval_kind: &str,
    interval_value: i32,
    next_due: Option<NaiveDate>,
) -> cloud::GaMaintenanceTaskRow {
    cloud::ga_maintenance_task_record(
        pool,
        &cloud::RecordGaTaskRequest {
            asset_id,
            site_id: site_id.map(str::to_string),
            title: "Servis berkala".into(),
            interval_kind: interval_kind.into(),
            interval_value,
            next_due,
            next_due_km: None,
            contract_id: None,
            supplier_id: None,
            notes: None,
        },
        ACTOR,
        today(),
    )
    .await
    .unwrap_or_else(|error| panic!("task: {error}"))
}

async fn a_repair(
    pool: &PgPool,
    asset_id: Option<Uuid>,
    objek: Option<&str>,
) -> cloud::GaRepairRow {
    let supplier = a_supplier(pool).await;
    cloud::ga_repair_record(
        pool,
        &cloud::RecordGaRepairRequest {
            site_id: "dc".into(),
            asset_id,
            objek: objek.map(str::to_string),
            title: "AC cassette tidak dingin".into(),
            supplier_id: supplier,
            contract_id: None,
            task_id: None,
            inspection_id: None,
            estimated_cost_minor: Some(5_000_000),
            failure_at: day(2026, 9, 20),
            notes: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("repair: {error}"))
}

fn a_replacement(asset_id: Uuid) -> cloud::RecordGaReplacementRequest {
    cloud::RecordGaReplacementRequest {
        old_asset_id: asset_id,
        repair_id: None,
        reason: "rusak berat, tidak ekonomis diperbaiki".into(),
        supplier_id: None,
        proposed_on: today(),
    }
}

// ---------------------------------------------------------------------------
// 1. The migration
// ---------------------------------------------------------------------------

/// The five tables exist, an inspection really refuses an UPDATE and a DELETE,
/// the register really accepts the two new status words, and all five record
/// kinds are seeded. Each is a fact a later migration could quietly break.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_migration_installs_the_five_tables_and_their_records(pool: PgPool) {
    for table in [
        "ga_maintenance_task",
        "ga_inspection",
        "ga_repair",
        "ga_replacement",
        "ga_disposal",
    ] {
        let there: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = $1",
        )
        .bind(table)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("{table}: {error}"));
        assert_eq!(there, 1, "{table} must exist");
    }

    // Append-only, proven by live attempts rather than by the trigger's name.
    let asset = an_asset(&pool, "AIR_CONDITIONER").await;
    let inspection_id: Uuid = sqlx::query_scalar(
        "INSERT INTO ga_inspection (asset_id, inspected_on, inspected_by, result, findings,
                                    recorded_by)
         VALUES ($1,$2,'ana','BAIK','probe','ana') RETURNING inspection_id",
    )
    .bind(asset)
    .bind(today())
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("inspection: {error}"));
    let updated =
        sqlx::query("UPDATE ga_inspection SET findings = 'diubah' WHERE inspection_id = $1")
            .bind(inspection_id)
            .execute(&pool)
            .await;
    assert!(updated.is_err(), "an inspection is appended, never edited");
    let deleted = sqlx::query("DELETE FROM ga_inspection WHERE inspection_id = $1")
        .bind(inspection_id)
        .execute(&pool)
        .await;
    assert!(deleted.is_err(), "an inspection is appended, never deleted");

    // The two status words GA writes and Finance never does.
    for status in ["DISPOSAL_REQUESTED", "REPLACED"] {
        let id = Uuid::new_v4();
        let suffix = id.simple().to_string();
        sqlx::query(
            "INSERT INTO fixed_asset
               (asset_id, asset_number, name, category_code, site_id, acquired_on, status,
                registered_by)
             VALUES ($1,$2,'status probe','AIR_CONDITIONER','dc',$3,$4,'migrasi')",
        )
        .bind(id)
        .bind(format!("AST-PROBE-{}", &suffix[..8]))
        .bind(today())
        .bind(status)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("{status}: {error}"));
    }

    let kinds: Vec<String> = vec![
        "maintenance_task".into(),
        "inspection".into(),
        "repair".into(),
        "replacement".into(),
        "disposal".into(),
    ];
    let seeded: i64 = sqlx::query_scalar("SELECT count(*) FROM record_kind WHERE code = ANY($1)")
        .bind(&kinds)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("record kinds: {error}"));
    assert_eq!(seeded, 5, "every new object must be fileable");
}

// ---------------------------------------------------------------------------
// 2. The repair ladder, pure
// ---------------------------------------------------------------------------

/// Every legal move is accepted and every other pair is refused, and the two
/// ends hold still. Tested directly because the database could only repeat it.
#[test]
fn the_repair_ladder_is_one_way_and_its_ends_are_ends() {
    let states = [
        "OPEN",
        "APPROVED",
        "IN_PROGRESS",
        "COMPLETED",
        "CLOSED",
        "CANCELLED",
    ];
    let legal = [
        ("OPEN", "APPROVED"),
        ("OPEN", "CANCELLED"),
        ("APPROVED", "IN_PROGRESS"),
        ("APPROVED", "CANCELLED"),
        ("IN_PROGRESS", "COMPLETED"),
        ("IN_PROGRESS", "CANCELLED"),
        ("COMPLETED", "CLOSED"),
    ];
    for from in states {
        for to in states {
            assert_eq!(
                domain::repair_may_move(from, to),
                legal.contains(&(from, to)),
                "{from} -> {to}"
            );
        }
    }
    for to in states {
        assert!(!domain::repair_may_move("CLOSED", to), "CLOSED is an end");
        assert!(
            !domain::repair_may_move("CANCELLED", to),
            "CANCELLED is an end"
        );
    }
}

// ---------------------------------------------------------------------------
// 3. maker != checker
// ---------------------------------------------------------------------------

/// The three approvals refuse the person who raised the record, with a sentence
/// naming the rule, and accept somebody else.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_maker_cannot_approve_their_own_record(pool: PgPool) {
    let asset = an_asset(&pool, "AIR_CONDITIONER").await;
    let repair = a_repair(&pool, Some(asset), Some("AC")).await;

    let refused = cloud::ga_repair_approve_budget(
        &pool,
        repair.repair_id,
        &cloud::ApproveGaRepairRequest {
            approved_budget_minor: 6_000_000,
        },
        ACTOR,
    )
    .await
    .expect_err("the maker may not approve their own budget");
    assert!(
        refused.to_string().contains("maker") && refused.to_string().contains(ACTOR),
        "the refusal names the rule and the person: {refused}"
    );
    assert!(
        cloud::ga_repair(&pool, repair.repair_id)
            .await
            .unwrap()
            .approved_budget_minor
            .is_none(),
        "a refused approval changes nothing"
    );

    let approved = cloud::ga_repair_approve_budget(
        &pool,
        repair.repair_id,
        &cloud::ApproveGaRepairRequest {
            approved_budget_minor: 6_000_000,
        },
        CHECKER,
    )
    .await
    .unwrap_or_else(|error| panic!("approve: {error}"));
    assert_eq!(approved.status, "APPROVED");
    assert_eq!(approved.approved_by.as_deref(), Some(CHECKER));
    assert_eq!(approved.approved_budget_minor, Some(6_000_000));

    // A replacement is the same rule.
    let replacement = cloud::ga_replacement_record(&pool, &a_replacement(asset), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("replacement: {error}"));
    let refused = cloud::ga_replacement_move(
        &pool,
        replacement.replacement_id,
        &cloud::MoveGaReplacementRequest {
            to: "APPROVED".into(),
            new_asset_id: None,
        },
        ACTOR,
        today(),
    )
    .await
    .expect_err("the proposer may not approve their own replacement");
    assert!(refused.to_string().contains("maker"), "{refused}");
    let moved = cloud::ga_replacement_move(
        &pool,
        replacement.replacement_id,
        &cloud::MoveGaReplacementRequest {
            to: "APPROVED".into(),
            new_asset_id: None,
        },
        CHECKER,
        today(),
    )
    .await
    .unwrap_or_else(|error| panic!("approve replacement: {error}"));
    assert_eq!(moved.status, "APPROVED");
    assert_eq!(moved.decided_by.as_deref(), Some(CHECKER));

    // And a disposal.
    let disposal = cloud::ga_disposal_request(
        &pool,
        &cloud::RequestGaDisposalRequest {
            asset_id: asset,
            method: "SCRAPPED".into(),
            proceeds_minor: None,
            reason: "rusak berat".into(),
            requested_on: today(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("disposal: {error}"));
    let refused = cloud::ga_disposal_decide(
        &pool,
        disposal.disposal_id,
        &cloud::DecideGaDisposalRequest {
            approve: true,
            note: None,
        },
        ACTOR,
    )
    .await
    .expect_err("the requester may not approve their own disposal");
    assert!(refused.to_string().contains("maker"), "{refused}");
    let decided = cloud::ga_disposal_decide(
        &pool,
        disposal.disposal_id,
        &cloud::DecideGaDisposalRequest {
            approve: true,
            note: Some("silakan".into()),
        },
        CHECKER,
    )
    .await
    .unwrap_or_else(|error| panic!("decide: {error}"));
    assert_eq!(decided.status, "APPROVED");
    assert_eq!(decided.approved_by.as_deref(), Some(CHECKER));
}

// ---------------------------------------------------------------------------
// 4. The budget arrives with its approver
// ---------------------------------------------------------------------------

/// The database refuses a budget with nobody behind it, in either direction.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_budget_and_its_approver_arrive_together(pool: PgPool) {
    let supplier = a_supplier(&pool).await;
    let budget_without_approver = sqlx::query(
        "INSERT INTO ga_repair (site_id, objek, title, supplier_id, approved_budget_minor,
                                failure_at, created_by)
         VALUES ('dc','AC','probe',$1,1000000,$2,'ana')",
    )
    .bind(supplier)
    .bind(today())
    .execute(&pool)
    .await;
    assert!(
        budget_without_approver.is_err(),
        "a budget without an approver is a number with no authority"
    );

    let approver_without_budget = sqlx::query(
        "INSERT INTO ga_repair (site_id, objek, title, supplier_id, approved_by, approved_at,
                                failure_at, created_by)
         VALUES ('dc','AC','probe',$1,'budi',now(),$2,'ana')",
    )
    .bind(supplier)
    .bind(today())
    .execute(&pool)
    .await;
    assert!(
        approver_without_budget.is_err(),
        "an approver without a budget approved nothing"
    );
}

// ---------------------------------------------------------------------------
// 5. A repair without an asset
// ---------------------------------------------------------------------------

/// A leak in the ceiling has no asset: the site is required, the object is
/// chosen by a person, and it stores and reads back. Without either, it is
/// refused with a sentence.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_repair_without_an_asset_is_filed_by_hand(pool: PgPool) {
    let supplier = a_supplier(&pool).await;
    let repair = cloud::ga_repair_record(
        &pool,
        &cloud::RecordGaRepairRequest {
            site_id: "dc".into(),
            asset_id: None,
            objek: Some("BANGUNAN".into()),
            title: "Plafon bocor".into(),
            supplier_id: supplier,
            contract_id: None,
            task_id: None,
            inspection_id: None,
            estimated_cost_minor: Some(3_500_000),
            failure_at: day(2026, 9, 21),
            notes: Some("tetes di atas rak sepatu".into()),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("no-asset repair: {error}"));
    assert!(repair.asset_id.is_none());
    assert_eq!(repair.objek, "BANGUNAN");
    assert_eq!(repair.objek_name, "Bangunan");
    assert_eq!(repair.site_id, "dc");

    // No asset AND no object: the writer cannot guess which object it is.
    let refused = cloud::ga_repair_record(
        &pool,
        &cloud::RecordGaRepairRequest {
            site_id: "dc".into(),
            asset_id: None,
            objek: None,
            title: "Plafon bocor".into(),
            supplier_id: supplier,
            contract_id: None,
            task_id: None,
            inspection_id: None,
            estimated_cost_minor: None,
            failure_at: day(2026, 9, 21),
            notes: None,
        },
        ACTOR,
    )
    .await
    .expect_err("a repair must say which object it is for");
    assert!(refused.to_string().contains("object"), "{refused}");

    // Somewhere the estate does not have.
    let refused = cloud::ga_repair_record(
        &pool,
        &cloud::RecordGaRepairRequest {
            site_id: "toko-yang-tidak-ada".into(),
            asset_id: None,
            objek: Some("BANGUNAN".into()),
            title: "Plafon bocor".into(),
            supplier_id: supplier,
            contract_id: None,
            task_id: None,
            inspection_id: None,
            estimated_cost_minor: None,
            failure_at: day(2026, 9, 21),
            notes: None,
        },
        ACTOR,
    )
    .await
    .expect_err("a repair is filed where the estate is");
    assert!(
        refused.to_string().contains("toko-yang-tidak-ada"),
        "{refused}"
    );
}

// ---------------------------------------------------------------------------
// 6. The object comes from the class
// ---------------------------------------------------------------------------

/// The derivation the prototype's `CLASSES[].objek` spells out, including the
/// two FFE exceptions and the operating-equipment family, and an unknown class
/// answering `None` so the caller decides.
#[test]
fn the_object_is_derived_from_the_asset_class() {
    assert_eq!(
        domain::repair_object_for_class("PPE", "AIR_CONDITIONER"),
        Some("AC")
    );
    assert_eq!(domain::repair_object_for_class("PPE", "LIFT"), Some("LIFT"));
    assert_eq!(
        domain::repair_object_for_class("PPE", "ESKALATOR"),
        Some("LIFT")
    );
    assert_eq!(
        domain::repair_object_for_class("PPE", "GENSET"),
        Some("POWER_PLANT")
    );
    assert_eq!(
        domain::repair_object_for_class("PPE", "MOBIL"),
        Some("KENDARAAN")
    );
    assert_eq!(
        domain::repair_object_for_class("PPE", "SEPEDA_MOTOR"),
        Some("KENDARAAN")
    );
    // The two FFE exceptions are named before the FFE_* catch.
    assert_eq!(
        domain::repair_object_for_class("PPE", "FFE_KOMPUTER"),
        Some("KOMPUTER")
    );
    assert_eq!(
        domain::repair_object_for_class("PPE", "FFE_STAFF_HOUSE_MESS"),
        Some("STAFF_HOUSE")
    );
    assert_eq!(
        domain::repair_object_for_class("PPE", "BANGUNAN_STAFF_HOUSE_MESS"),
        Some("STAFF_HOUSE")
    );
    assert_eq!(
        domain::repair_object_for_class("PPE", "FFE_OFFICE"),
        Some("FFE")
    );
    assert_eq!(
        domain::repair_object_for_class("PPE", "INSTALASI_MEKANIKAL_ELEKTRIKAL"),
        Some("BANGUNAN")
    );
    assert_eq!(
        domain::repair_object_for_class("INTANGIBLE", "SEVENTH_SOFT_APPLICATION"),
        Some("SOFTWARE")
    );
    // All thirty-six operating-equipment classes share one object.
    assert_eq!(
        domain::repair_object_for_class("OE", "OE_RAK_1"),
        Some("FFE")
    );
    assert_eq!(
        domain::repair_object_for_class("OE", "OE_PATUNG_KEPALA_ANAK"),
        Some("FFE")
    );
    // Unknown: the caller decides, no guessing.
    assert_eq!(domain::repair_object_for_class("PPE", "POMPA"), None);
    assert_eq!(
        domain::repair_object_for_class("DEFERRED", "PRE_OPENING"),
        None
    );
}

// ---------------------------------------------------------------------------
// 7. The rung that makes an asset
// ---------------------------------------------------------------------------

/// Moving a replacement to INSTALLED mints the new asset from the old one —
/// class, site and specs included — and retires the old to REPLACED, in one
/// transaction.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn installing_a_replacement_makes_the_new_asset_and_retires_the_old(pool: PgPool) {
    let specs = serde_json::json!({"material": "kayu", "dim": "2m"});
    let old = an_asset_with_specs(&pool, "OE_RAK_1", specs.clone()).await;
    let replacement = cloud::ga_replacement_record(&pool, &a_replacement(old), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("replacement: {error}"));

    for to in ["APPROVED", "PURCHASED"] {
        cloud::ga_replacement_move(
            &pool,
            replacement.replacement_id,
            &cloud::MoveGaReplacementRequest {
                to: to.into(),
                new_asset_id: None,
            },
            CHECKER,
            today(),
        )
        .await
        .unwrap_or_else(|error| panic!("{to}: {error}"));
    }

    let installed = cloud::ga_replacement_move(
        &pool,
        replacement.replacement_id,
        &cloud::MoveGaReplacementRequest {
            to: "INSTALLED".into(),
            new_asset_id: None,
        },
        CHECKER,
        today(),
    )
    .await
    .unwrap_or_else(|error| panic!("install: {error}"));
    assert_eq!(installed.status, "INSTALLED");
    let new_asset_id = installed.new_asset_id.expect("a new asset from the old");

    let old_status: String =
        sqlx::query_scalar("SELECT status FROM fixed_asset WHERE asset_id = $1")
            .bind(old)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("old status: {error}"));
    assert_eq!(old_status, "REPLACED", "the old thing left service");

    let new =
        sqlx::query("SELECT category_code, site_id, specs FROM fixed_asset WHERE asset_id = $1")
            .bind(new_asset_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("new asset: {error}"));
    assert_eq!(new.get::<String, _>("category_code"), "OE_RAK_1");
    assert_eq!(new.get::<String, _>("site_id"), "dc");
    assert_eq!(new.get::<serde_json::Value, _>("specs"), specs);
}

// ---------------------------------------------------------------------------
// 8. The disposal
// ---------------------------------------------------------------------------

/// The request marks the asset, a refusal puts it back, approving keeps it
/// pending, and closing changes only the disposal's state — GA posts no journal.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_disposal_asks_finance_and_ga_posts_nothing(pool: PgPool) {
    let asset = an_asset(&pool, "AIR_CONDITIONER").await;
    let journals_before: i64 = sqlx::query_scalar("SELECT count(*) FROM journal_entry")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("journal count: {error}"));

    let requested = cloud::ga_disposal_request(
        &pool,
        &cloud::RequestGaDisposalRequest {
            asset_id: asset,
            method: "SOLD".into(),
            proceeds_minor: Some(2_000_000),
            reason: "diganti unit baru".into(),
            requested_on: today(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("request: {error}"));
    assert_eq!(requested.status, "REQUESTED");
    assert_eq!(asset_status(&pool, asset).await, "DISPOSAL_REQUESTED");

    // A refusal returns the thing to service.
    let rejected = cloud::ga_disposal_decide(
        &pool,
        requested.disposal_id,
        &cloud::DecideGaDisposalRequest {
            approve: false,
            note: Some("masih dipakai".into()),
        },
        CHECKER,
    )
    .await
    .unwrap_or_else(|error| panic!("reject: {error}"));
    assert_eq!(rejected.status, "REJECTED");
    assert_eq!(asset_status(&pool, asset).await, "REGISTERED");

    // Ask again, approve, close.
    let requested = cloud::ga_disposal_request(
        &pool,
        &cloud::RequestGaDisposalRequest {
            asset_id: asset,
            method: "SCRAPPED".into(),
            proceeds_minor: None,
            reason: "rusak total".into(),
            requested_on: today(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("re-request: {error}"));
    let approved = cloud::ga_disposal_decide(
        &pool,
        requested.disposal_id,
        &cloud::DecideGaDisposalRequest {
            approve: true,
            note: None,
        },
        CHECKER,
    )
    .await
    .unwrap_or_else(|error| panic!("approve: {error}"));
    assert_eq!(approved.status, "APPROVED");
    assert_eq!(
        asset_status(&pool, asset).await,
        "DISPOSAL_REQUESTED",
        "approved is not yet gone; the books have to say so"
    );

    let closed = cloud::ga_disposal_close(&pool, requested.disposal_id, CHECKER)
        .await
        .unwrap_or_else(|error| panic!("close: {error}"));
    assert_eq!(closed.status, "POSTED");
    assert_eq!(closed.closed_by.as_deref(), Some(CHECKER));

    let journals_after: i64 = sqlx::query_scalar("SELECT count(*) FROM journal_entry")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("journal count: {error}"));
    assert_eq!(journals_before, journals_after, "GA posts no journal");

    // Proceeds only make sense for something sold.
    let refused = cloud::ga_disposal_request(
        &pool,
        &cloud::RequestGaDisposalRequest {
            asset_id: an_asset(&pool, "AIR_CONDITIONER").await,
            method: "DONATED".into(),
            proceeds_minor: Some(1_000_000),
            reason: "diberikan".into(),
            requested_on: today(),
        },
        ACTOR,
    )
    .await
    .expect_err("a donation received no money");
    assert!(refused.to_string().contains("SOLD"), "{refused}");
}

async fn asset_status(pool: &PgPool, asset_id: Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM fixed_asset WHERE asset_id = $1")
        .bind(asset_id)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("asset status: {error}"))
}

// ---------------------------------------------------------------------------
// 9. The §9.3 accounts
// ---------------------------------------------------------------------------

/// All eleven objects resolve `repair_expense` to exactly the account the brief
/// names, and the endpoint serves the same eleven.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_eleven_objects_resolve_to_the_briefs_accounts(pool: PgPool) {
    let expected: &[(&str, &str)] = &[
        ("FFE", "6066"),
        ("SOFTWARE", "6067"),
        ("KOMPUTER", "6068"),
        ("BANGUNAN", "6069"),
        ("STAFF_HOUSE", "6070"),
        ("KENDARAAN", "6071"),
        ("AC", "6072"),
        ("POWER_PLANT", "6073"),
        ("GENSET_BBM", "6058"),
        ("CAT", "6074"),
        ("LIFT", "6075"),
    ];
    for (code, account) in expected {
        let resolved = cloud::resolve_account_code(&pool, "repair_expense", "dc", code)
            .await
            .unwrap_or_else(|error| panic!("{code}: {error}"));
        assert_eq!(resolved, *account, "{code} is the brief's account");
    }

    let objects = cloud::ga_repair_objects(&pool)
        .await
        .unwrap_or_else(|error| panic!("objects: {error}"));
    assert_eq!(objects.len(), 11, "brief §9.3 keeps eleven objects");
    let ac = objects
        .iter()
        .find(|object| object.code == "AC")
        .unwrap_or_else(|| panic!("no AC"));
    assert_eq!(ac.account_code, "6072");
    assert_eq!(ac.name, "AC & refrigerator");
}

// ---------------------------------------------------------------------------
// 10. Who may reach it
// ---------------------------------------------------------------------------

/// Every upkeep route sits on GA's surface, which is one rung for reads and
/// writes alike — the department that FILES the fact.
#[test]
fn the_upkeep_routes_are_a_supervisors_surface() {
    let id = "9f0f5f0e-0000-0000-0000-000000000000";
    for (method, path) in [
        ("GET", "/api/v1/ga/maintenance-tasks".to_string()),
        ("POST", "/api/v1/ga/maintenance-tasks".to_string()),
        ("PATCH", format!("/api/v1/ga/maintenance-tasks/{id}")),
        ("GET", "/api/v1/ga/inspections".to_string()),
        ("POST", "/api/v1/ga/inspections".to_string()),
        ("GET", "/api/v1/ga/repairs".to_string()),
        ("POST", "/api/v1/ga/repairs".to_string()),
        ("GET", format!("/api/v1/ga/repairs/{id}")),
        ("PATCH", format!("/api/v1/ga/repairs/{id}")),
        ("POST", format!("/api/v1/ga/repairs/{id}/move")),
        ("POST", format!("/api/v1/ga/repairs/{id}/approve-budget")),
        ("GET", "/api/v1/ga/replacements".to_string()),
        ("POST", "/api/v1/ga/replacements".to_string()),
        ("POST", format!("/api/v1/ga/replacements/{id}/move")),
        ("GET", "/api/v1/ga/disposals".to_string()),
        ("POST", "/api/v1/ga/disposals".to_string()),
        ("POST", format!("/api/v1/ga/disposals/{id}/decide")),
        ("POST", format!("/api/v1/ga/disposals/{id}/close")),
        ("GET", "/api/v1/ga/repair-objects".to_string()),
    ] {
        assert_eq!(
            domain::required_role(method, &path),
            domain::Role::Supervisor,
            "{method} {path}"
        );
    }
}

// ---------------------------------------------------------------------------
// 11. The overview's three new sections
// ---------------------------------------------------------------------------

/// A service three days out is listed and one thirty days out is not; an open
/// repair is listed and a closed one is not; a proposed replacement is listed.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_overview_lists_what_is_due_and_open(pool: PgPool) {
    let asset = an_asset(&pool, "AIR_CONDITIONER").await;
    let soon = a_task(&pool, Some(asset), None, "DAYS", 30, Some(day(2026, 9, 27))).await;
    let far = a_task(
        &pool,
        Some(asset),
        None,
        "DAYS",
        30,
        Some(day(2026, 10, 24)),
    )
    .await;

    let open = a_repair(&pool, Some(asset), Some("AC")).await;
    let closed = a_repair(&pool, Some(asset), Some("AC")).await;
    // Approval goes through the budget, never a plain move (17 Oct 2026).
    cloud::ga_repair_approve_budget(
        &pool,
        closed.repair_id,
        &cloud::ApproveGaRepairRequest {
            approved_budget_minor: 1_000_000,
        },
        CHECKER,
    )
    .await
    .unwrap_or_else(|error| panic!("approve: {error}"));
    for to in ["IN_PROGRESS", "COMPLETED", "CLOSED"] {
        cloud::ga_repair_move(
            &pool,
            closed.repair_id,
            &cloud::MoveGaRepairRequest {
                to: to.into(),
                note: None,
            },
            CHECKER,
            today(),
        )
        .await
        .unwrap_or_else(|error| panic!("move to {to}: {error}"));
    }

    let replacement = cloud::ga_replacement_record(&pool, &a_replacement(asset), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("replacement: {error}"));

    let overview = cloud::ga_overview(&pool, today())
        .await
        .unwrap_or_else(|error| panic!("overview: {error}"));

    let due: Vec<String> = overview
        .due_maintenance
        .iter()
        .map(|row| row.id.clone())
        .collect();
    assert!(
        due.contains(&soon.task_id.to_string()),
        "three days is inside the seven-day window: {due:?}"
    );
    assert!(
        !due.contains(&far.task_id.to_string()),
        "thirty days is not due this week"
    );

    let repairs: Vec<String> = overview
        .open_repairs
        .iter()
        .map(|row| row.id.clone())
        .collect();
    assert!(
        repairs.contains(&open.repair_id.to_string()),
        "an OPEN repair is not finished: {repairs:?}"
    );
    assert!(
        !repairs.contains(&closed.repair_id.to_string()),
        "a CLOSED repair is done"
    );

    let replacements: Vec<String> = overview
        .replacements
        .iter()
        .map(|row| row.id.clone())
        .collect();
    assert!(
        replacements.contains(&replacement.replacement_id.to_string()),
        "a PROPOSED replacement is still running: {replacements:?}"
    );
}
