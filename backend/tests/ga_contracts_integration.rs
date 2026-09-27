//! GA tahap 3: the contract register, its meters, and the accounts the types
//! resolve to.
//!
//! The register's own acts are tested in `ga_assets_integration`; this file
//! holds what 0360–0362 added: the seventeen types and eleven repair objects
//! (the two vocabularies stage 4 will reuse), the shape a contract must
//! have, the standing arithmetic, the meter that measures a Langganan
//! month, and the §9.2 account map the contracts point at. The sweep's
//! short-month regression lives here too, because the promise that clamps
//! the 31st is the FINANCE side of one of these contracts.

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

/// A deal with everything the ordinary case has, so each test only says what
/// it is about: a shop lease from the DC's landlord, on paper since March.
fn a_lease() -> cloud::RecordGaContractRequest {
    cloud::RecordGaContractRequest {
        contract_number: Some("LK/2026/0142".into()),
        contract_type: "SEWA_TOKO".into(),
        objek: None,
        supplier_id: None,
        counterparty_name: Some("Pasar Raya Inkubator".into()),
        site_id: Some("dc".into()),
        site_scope: None,
        asset_id: None,
        starts_on: day(2026, 3, 1),
        ends_on: Some(day(2027, 2, 28)),
        contract_value_minor: Some(240_000_000),
        is_signed: true,
        signed_by: Some("Bpk. Har".into()),
        customer_number: None,
        reminder_days: 60,
        notes: None,
    }
}

/// A registered supplier, because one party shape must be the real thing.
/// A fresh database seeds no suppliers, so the test makes its own.
async fn a_supplier(pool: &PgPool) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO supplier (supplier_id, supplier_code, supplier_code_normalized, name,
                               created_by, updated_by)
         VALUES ($1, 'SUP-GA-1', 'sup-ga-1', 'Grid Listrik Nusantara', $2, $2)",
    )
    .bind(id)
    .bind(ACTOR)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("supplier: {error}"));
    id
}

async fn record(pool: &PgPool, request: &cloud::RecordGaContractRequest) -> cloud::GaContractRow {
    cloud::ga_contract_record(pool, request, ACTOR, today())
        .await
        .unwrap_or_else(|error| panic!("record: {error}"))
}

/// Record a deal and say the paper is signed and running. The overview reads
/// ACTIVE only — DRAFT has not begun — so a test about a window closing has to
/// take the deal through the one act that starts it.
async fn activate(pool: &PgPool, contract_id: Uuid) -> cloud::GaContractRow {
    let mut update = cloud::UpdateGaContractRequest::default();
    update.status = Some("ACTIVE".into());
    cloud::ga_contract_update(pool, contract_id, &update, ACTOR, today())
        .await
        .unwrap_or_else(|error| panic!("activate: {error}"))
}

async fn active(pool: &PgPool, request: &cloud::RecordGaContractRequest) -> cloud::GaContractRow {
    let row = record(pool, request).await;
    activate(pool, row.contract_id).await
}

/// The plant contract, with whatever makes THIS test interesting changed.
async fn a_maintenance(pool: &PgPool, objek: &str) -> cloud::GaContractRow {
    let mut request = a_lease();
    request.contract_type = "JASA_MAINTENANCE".into();
    request.objek = Some(objek.into());
    request.site_scope = None;
    request.site_id = Some("dc".into());
    record(pool, &request).await
}

async fn contract_page(pool: &PgPool, scope: cloud::GaContractScope) -> cloud::GaContractPage {
    cloud::ga_contract_page(pool, scope)
        .await
        .unwrap_or_else(|error| panic!("page: {error}"))
}

fn a_scope() -> cloud::GaContractScope {
    cloud::GaContractScope {
        needle: None,
        types: vec![],
        groups: vec![],
        sites: vec![],
        standings: vec![],
        archived: None,
        today: today(),
        limit: cloud::DEFAULT_GA_CONTRACT_LIMIT,
    }
}

// ---------------------------------------------------------------------------
// 1. The migration, and the two vocabularies it seeds
// ---------------------------------------------------------------------------

/// Seventeen types, eleven repair objects, no `usage` column, and the record
/// kind that lets a contract carry files and history. Each is a fact a
/// future migration could quietly break — a type dropped from the seed, a
/// `usage` somebody added "as a convenience", a kind forgotten — and each
/// would surface months later, somewhere else.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_migration_seeds_the_vocabulary_the_register_needs(pool: PgPool) {
    let types: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT code, name, group_code FROM contract_type ORDER BY sort_order",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("types: {error}"));
    assert_eq!(types.len(), 17, "brief §9.2 keeps seventeen contract types");
    assert_eq!(types[0].0, "SEWA_TANAH");
    assert_eq!(types[9], ("IZIN_KENDARAAN".into(), "STNK / KIR".into(), "IZIN".into()));
    assert_eq!(types[16].0, "DISEWAKAN_PERALATAN");

    // The Rust side of the vocabulary is the same seventeen, in the same
    // order — the constant names them in refusals, the table backs the FK.
    assert_eq!(domain::CONTRACT_TYPES.len(), 17);
    for (kept, (code, _, _)) in types.iter().zip(domain::CONTRACT_TYPES) {
        assert_eq!(kept.0, *code, "the table and the constant disagree at {code}");
    }

    let objects: i64 = sqlx::query_scalar("SELECT count(*) FROM ga_repair_object")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("objects: {error}"));
    assert_eq!(objects, 11, "brief §9.3 keeps eleven repair objects");
    // GENSET_BBM proves the list is the client's and not a neat range: its
    // account (6058) sits outside the 6066..6075 run.
    let genset: (String, String) =
        sqlx::query_as("SELECT code, account_code FROM ga_repair_object WHERE code = 'GENSET_BBM'")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("genset: {error}"));
    assert_eq!(genset, ("GENSET_BBM".into(), "6058".into()));

    // `usage` is closing - opening, and NOTHING stored: one number kept
    // twice is one disagreement waiting.
    let usage: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM information_schema.columns
          WHERE table_name = 'ga_meter_reading' AND column_name = 'usage'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("usage column: {error}"));
    assert_eq!(usage, 0, "usage must be computed, never stored");

    let kind: Option<(String, String)> = sqlx::query_as(
        "SELECT code, label FROM record_kind WHERE code = 'contract'",
    )
    .fetch_optional(&pool)
    .await
    .unwrap_or_else(|error| panic!("record kind: {error}"));
    assert_eq!(
        kind.as_ref().map(|(code, label)| (code.as_str(), label.as_str())),
        Some(("contract", "Contract")),
        "a contract must be fileable: papers, comments, history"
    );
}

// ---------------------------------------------------------------------------
// 2. The shape of a deal, and the window's one-way door
// ---------------------------------------------------------------------------

/// Exactly one party, exactly one coverage, an objek only on a maintenance
/// contract, a window that ends after it opens, and a scope only for the
/// types whose deal genuinely spans places. Every refusal names what is
/// wrong, because the person typing got here by filling in a form.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_contract_has_exactly_one_party_and_one_coverage(pool: PgPool) {
    // No party at all.
    let mut request = a_lease();
    request.counterparty_name = None;
    let refused = cloud::ga_contract_record(&pool, &request, ACTOR, today())
        .await
        .expect_err("a deal with nobody on the other side is a note");
    assert!(refused.to_string().contains("counterparty"), "{refused}");

    // Two parties.
    let supplier = a_supplier(&pool).await;
    let mut request = a_lease();
    request.supplier_id = Some(supplier);
    let refused = cloud::ga_contract_record(&pool, &request, ACTOR, today())
        .await
        .expect_err("supplier AND free-text is two deals in one number");
    assert!(refused.to_string().contains("one counterparty"), "{refused}");

    // No coverage.
    let mut request = a_lease();
    request.site_id = None;
    let refused = cloud::ga_contract_record(&pool, &request, ACTOR, today())
        .await
        .expect_err("a contract is somewhere or everywhere");
    assert!(refused.to_string().contains("coverage"), "{refused}");

    // Two coverages.
    let mut request = a_lease();
    request.site_scope = Some("ALL_STORES".into());
    let refused = cloud::ga_contract_record(&pool, &request, ACTOR, today())
        .await
        .expect_err("one site AND all stores is not one answer");
    assert!(refused.to_string().contains("coverage"), "{refused}");

    // A scope on a type whose deal is about one address. SEWA_RUMAH is not one
    // of the coverage kinds (`CONTRACT_SCOPE_TYPES`): a lease of one house is
    // about one address, and ALL_SITES is a word for a deal that spans them.
    let mut request = a_lease();
    request.contract_type = "SEWA_RUMAH".into();
    request.site_id = None;
    request.site_scope = Some("ALL_SITES".into());
    let refused = cloud::ga_contract_record(&pool, &request, ACTOR, today())
        .await
        .expect_err("a house lease is about one address");
    assert!(
        refused.to_string().contains("SEWA_RUMAH") && refused.to_string().contains("ALL_SITES"),
        "the refusal names the type and the word it refused: {refused}"
    );

    // A window that ends before it opens.
    let mut request = a_lease();
    request.ends_on = Some(day(2026, 2, 28));
    let refused = cloud::ga_contract_record(&pool, &request, ACTOR, today())
        .await
        .expect_err("the window does not run backwards");
    assert!(refused.to_string().contains("ends_on"), "{refused}");

    // And the supplier side, happy: the real FK shape goes in and comes back.
    let mut request = a_lease();
    request.supplier_id = Some(supplier);
    request.counterparty_name = None;
    let recorded = record(&pool, &request).await;
    assert_eq!(recorded.supplier_name.as_deref(), Some("Grid Listrik Nusantara"));
    assert!(recorded.counterparty_name.is_none());
}

/// The objek is the maintenance contract's alone — required there, refused
/// everywhere else — and it must be one of the eleven.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn objek_belongs_to_maintenance_and_only_to_it(pool: PgPool) {
    let mut request = a_lease();
    request.objek = Some("AC".into());
    let refused = cloud::ga_contract_record(&pool, &request, ACTOR, today())
        .await
        .expect_err("a lease does not maintain an air conditioner");
    assert!(
        refused.to_string().contains("JASA_MAINTENANCE") && refused.to_string().contains("AC"),
        "{refused}"
    );

    let mut request = a_lease();
    request.contract_type = "JASA_MAINTENANCE".into();
    let refused = cloud::ga_contract_record(&pool, &request, ACTOR, today())
        .await
        .expect_err("maintenance must say what it maintains");
    assert!(refused.to_string().contains("maintains"), "{refused}");

    let mut request = a_lease();
    request.contract_type = "JASA_MAINTENANCE".into();
    request.objek = Some("POMPA".into());
    let refused = cloud::ga_contract_record(&pool, &request, ACTOR, today())
        .await
        .expect_err("POMPA is not one of the eleven objects");
    assert!(refused.to_string().contains("repair object"), "{refused}");

    let air_conditioner = a_maintenance(&pool, "AC").await;
    assert_eq!(air_conditioner.objek_name.as_deref(), Some("AC & refrigerator"));
    assert_eq!(air_conditioner.status, "DRAFT", "a deal starts as a draft");
}

/// The window's one-way door: a draft activates, an active deal terminates,
/// and neither move goes backwards. An archived deal is corrected by nobody
/// until it is brought back.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn status_moves_one_way_and_archived_rows_hold_still(pool: PgPool) {
    let lease = record(&pool, &a_lease()).await;

    let mut request = cloud::UpdateGaContractRequest {
        status: Some("TERMINATED".into()),
        ..Default::default()
    };
    let refused = cloud::ga_contract_update(&pool, lease.contract_id, &request, ACTOR, today())
        .await
        .expect_err("a draft cannot be terminated; it was never running");
    assert!(refused.to_string().contains("one way"), "{refused}");

    request.status = Some("ACTIVE".into());
    let active = cloud::ga_contract_update(&pool, lease.contract_id, &request, ACTOR, today())
        .await
        .unwrap_or_else(|error| panic!("activate: {error}"));
    assert_eq!(active.status, "ACTIVE");

    request.status = Some("DRAFT".into());
    let refused = cloud::ga_contract_update(&pool, lease.contract_id, &request, ACTOR, today())
        .await
        .expect_err("time does not run backwards");
    assert!(refused.to_string().contains("one way"), "{refused}");

    request.status = Some("TERMINATED".into());
    let terminated = cloud::ga_contract_update(&pool, lease.contract_id, &request, ACTOR, today())
        .await
        .unwrap_or_else(|error| panic!("terminate: {error}"));
    assert_eq!(terminated.status, "TERMINATED");
    assert_eq!(terminated.version, lease.version + 2, "each act is a version");

    request.status = Some("ACTIVE".into());
    let refused = cloud::ga_contract_update(&pool, lease.contract_id, &request, ACTOR, today())
        .await
        .expect_err("a terminated deal stays terminated");
    assert!(refused.to_string().contains("TERMINATED"), "{refused}");

    // Archive refuses an empty reason and keeps the reason it is given.
    let archive = cloud::ArchiveGaContractRequest {
        archived: true,
        reason: "  ".into(),
    };
    let refused = cloud::ga_contract_archive(&pool, lease.contract_id, &archive, ACTOR, today())
        .await
        .expect_err("archiving without a why is archiving without a when");
    assert!(refused.to_string().contains("why"), "{refused}");

    let archive = cloud::ArchiveGaContractRequest {
        archived: true,
        reason: "sewa diakhiri pemilik gedung".into(),
    };
    let archived = cloud::ga_contract_archive(&pool, lease.contract_id, &archive, ACTOR, today())
        .await
        .unwrap_or_else(|error| panic!("archive: {error}"));
    assert!(archived.archived);
    assert!(
        archived.notes.as_deref().unwrap_or_default().contains("sewa diakhiri pemilik gedung"),
        "the why travels with the row"
    );

    let mut request = cloud::UpdateGaContractRequest::default();
    request.notes = Some("dihubungi lagi".into());
    let refused = cloud::ga_contract_update(&pool, lease.contract_id, &request, ACTOR, today())
        .await
        .expect_err("an archived row holds still");
    assert!(refused.to_string().contains("archived"), "{refused}");
}

// ---------------------------------------------------------------------------
// 3. The standing, pure
// ---------------------------------------------------------------------------

/// The standing is arithmetic on the contract's own window, so it is tested
/// directly — the database could only repeat it.
#[test]
fn the_standing_is_arithmetic_on_the_window() {
    // Not started yet, even though the window is short.
    let (standing, days) = domain::contract_standing(
        "ACTIVE",
        day(2026, 10, 1),
        Some(day(2026, 10, 20)),
        60,
        today(),
    );
    assert_eq!(standing, "BELUM_MULAI");
    assert_eq!(days, Some(26), "days_to_end counts even before the start");

    // A window with no end never runs out.
    let (standing, days) = domain::contract_standing(
        "ACTIVE",
        day(2026, 1, 1),
        None,
        60,
        today(),
    );
    assert_eq!(standing, "AKTIF");
    assert_eq!(days, None);

    // Active, far from the end.
    let (standing, days) = domain::contract_standing(
        "ACTIVE",
        day(2026, 1, 1),
        Some(day(2027, 1, 31)),
        60,
        today(),
    );
    assert_eq!(standing, "AKTIF");
    assert_eq!(days, Some(129));

    // The boundary: the last day of the window is still SEGERA_HABIS at
    // zero days, and the day after is HABIS at minus one.
    let (standing, days) = domain::contract_standing(
        "ACTIVE",
        day(2026, 1, 1),
        Some(today()),
        60,
        today(),
    );
    assert_eq!(standing, "SEGERA_HABIS");
    assert_eq!(days, Some(0));

    let (standing, days) = domain::contract_standing(
        "ACTIVE",
        day(2026, 1, 1),
        Some(day(2026, 9, 23)),
        60,
        today(),
    );
    assert_eq!(standing, "HABIS");
    assert_eq!(days, Some(-1));

    // "Segera" is the CONTRACT's own threshold, not a global one.
    let (standing, _) = domain::contract_standing(
        "ACTIVE",
        day(2026, 1, 1),
        Some(day(2027, 7, 21)),
        400,
        today(),
    );
    assert_eq!(standing, "SEGERA_HABIS", "300 days is soon to a 400-day reminder");

    // Decisions beat dates: a terminated deal is DIHENTIKAN inside its own
    // window, and a draft is a draft.
    let (standing, days) = domain::contract_standing(
        "TERMINATED",
        day(2026, 1, 1),
        Some(day(2026, 10, 12)),
        60,
        today(),
    );
    assert_eq!(standing, "DIHENTIKAN");
    assert_eq!(days, Some(18));

    let (standing, _) = domain::contract_standing(
        "DRAFT",
        day(2026, 1, 1),
        Some(day(2026, 9, 1)),
        60,
        today(),
    );
    assert_eq!(standing, "DRAFT", "a draft has not begun, even one past its end");
}

// ---------------------------------------------------------------------------
// 4. The meter
// ---------------------------------------------------------------------------

/// One month, one row. Reading the same month again CORRECTS the numbers —
/// a mis-typed closing is fixed, not doubled — and `usage` is computed by
/// the reader, never stored.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_meter_reading_is_one_month_one_row_and_the_usage_is_computed(pool: PgPool) {
    let mut request = a_lease();
    request.contract_type = "LANGGANAN_LISTRIK".into();
    request.site_scope = None;
    request.site_id = Some("dc".into());
    request.customer_number = Some("5-4321/DC/2026".into());
    let contract = record(&pool, &request).await;

    let reading = cloud::ga_meter_reading_record(
        &pool,
        contract.contract_id,
        &cloud::RecordMeterReadingRequest {
            period: day(2026, 8, 1),
            unit: "kWh".into(),
            opening: 41_000,
            closing: 41_250,
            read_on: day(2026, 9, 1),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("reading: {error}"));
    assert_eq!(reading.usage, 250, "usage is closing - opening");
    assert_eq!(reading.recorded_by, ACTOR);

    // The same month again: a correction, not a second reading.
    let corrected = cloud::ga_meter_reading_record(
        &pool,
        contract.contract_id,
        &cloud::RecordMeterReadingRequest {
            period: day(2026, 8, 1),
            unit: "kWh".into(),
            opening: 41_000,
            closing: 41_290,
            read_on: day(2026, 9, 2),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("correction: {error}"));
    assert_eq!(corrected.reading_id, reading.reading_id, "same month, same row");
    assert_eq!(corrected.usage, 290);

    let history = cloud::ga_contract_meter_readings(&pool, contract.contract_id)
        .await
        .unwrap_or_else(|error| panic!("history: {error}"));
    assert_eq!(history.len(), 1, "August was read once, truthfully");

    // The meter runs forward.
    let refused = cloud::ga_meter_reading_record(
        &pool,
        contract.contract_id,
        &cloud::RecordMeterReadingRequest {
            period: day(2026, 9, 1),
            unit: "kWh".into(),
            opening: 41_290,
            closing: 41_200,
            read_on: day(2026, 10, 1),
        },
        ACTOR,
    )
    .await
    .expect_err("a meter that went down is a swap a person explains");
    assert!(refused.to_string().contains("runs forward"), "{refused}");

    // A month is its first day.
    let refused = cloud::ga_meter_reading_record(
        &pool,
        contract.contract_id,
        &cloud::RecordMeterReadingRequest {
            period: day(2026, 9, 15),
            unit: "kWh".into(),
            opening: 1,
            closing: 2,
            read_on: day(2026, 10, 1),
        },
        ACTOR,
    )
    .await
    .expect_err("the period is the month, not a day in it");
    assert!(refused.to_string().contains("first day"), "{refused}");

    // The list is newest month first.
    cloud::ga_meter_reading_record(
        &pool,
        contract.contract_id,
        &cloud::RecordMeterReadingRequest {
            period: day(2026, 9, 1),
            unit: "kWh".into(),
            opening: 41_290,
            closing: 41_540,
            read_on: day(2026, 10, 1),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("september: {error}"));
    let history = cloud::ga_contract_meter_readings(&pool, contract.contract_id)
        .await
        .unwrap_or_else(|error| panic!("history: {error}"));
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].period, day(2026, 9, 1), "newest first");
    // And the last reading rides the row, for the Langganan strip.
    let page = contract_page(&pool, a_scope()).await;
    let row = page
        .rows
        .iter()
        .find(|row| row.contract_id == contract.contract_id)
        .unwrap_or_else(|| panic!("contract missing from page"));
    assert_eq!(row.last_usage_period, Some(day(2026, 9, 1)));
    assert_eq!(row.last_usage, Some(250));
    assert_eq!(row.last_unit.as_deref(), Some("kWh"));
}

// ---------------------------------------------------------------------------
// 5. Archive, and the register's memory
// ---------------------------------------------------------------------------

/// An archived deal leaves the default list and comes back when asked for by
/// name. It does not vanish: the row, its notes and its standing stay.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn archiving_hides_from_the_default_list_and_not_from_the_register(pool: PgPool) {
    let lease = record(&pool, &a_lease()).await;
    let other = {
        let mut request = a_lease();
        request.contract_number = Some("LK/2026/0143".into());
        request.site_id = Some("store-01".into());
        record(&pool, &request).await
    };

    let archive = cloud::ArchiveGaContractRequest {
        archived: true,
        reason: "gedung dijual".into(),
    };
    cloud::ga_contract_archive(&pool, lease.contract_id, &archive, ACTOR, today())
        .await
        .unwrap_or_else(|error| panic!("archive: {error}"));

    // Default: both facets and rows answer for the LIVING register.
    let mut scope = a_scope();
    scope.archived = Some(false);
    let page = contract_page(&pool, scope).await;
    assert_eq!(page.total, 1);
    assert_eq!(page.rows[0].contract_id, other.contract_id);

    // `archived=true`: the archive, on request.
    let mut scope = a_scope();
    scope.archived = Some(true);
    let page = contract_page(&pool, scope).await;
    assert_eq!(page.total, 1);
    assert!(page.rows[0].archived);
    assert_eq!(page.rows[0].contract_id, lease.contract_id);
    assert!(
        page.rows[0].notes.as_deref().unwrap_or_default().contains("gedung dijual"),
        "the archive keeps the why"
    );

    // Absent a choice: everything, archived included — the register does not
    // quietly pretend a row is not there.
    let page = contract_page(&pool, a_scope()).await;
    assert_eq!(page.total, 2);
}

// ---------------------------------------------------------------------------
// 6. The accounts, §9.2
// ---------------------------------------------------------------------------

/// Every type that HAS an expense account resolves to exactly the account
/// the brief names; SEWA_KENDARAAN and JASA_MAINTENANCE refuse, in a
/// sentence naming the type and the site — an unmapped deal must be a
/// question for Finance, not a posting to a guessed account. The prepaid
/// and accrual sides answer under the vocabularies that were already there.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_contract_type_resolves_to_the_account_the_brief_names(pool: PgPool) {
    let expected: &[(&str, &str)] = &[
        ("SEWA_TANAH", "7002"),
        ("SEWA_TOKO", "7004"),
        ("SEWA_RUMAH", "7005"),
        ("JASA_CLEANING", "6040"),
        ("ASURANSI_PROPERTI", "7029"),
        ("ASURANSI_KENDARAAN", "7033"),
        ("IZIN_USAHA", "6049"),
        ("IZIN_KENDARAAN", "6062"),
        ("PAJAK_PBB", "7030"),
        ("PAJAK_REKLAME", "7031"),
        ("LANGGANAN_LISTRIK", "6045"),
        ("LANGGANAN_AIR", "6046"),
        ("LANGGANAN_TELEKOM", "6044"),
    ];
    for (kind, account) in expected {
        let resolved = cloud::resolve_account_code(&pool, "contract_expense", "dc", kind)
            .await
            .unwrap_or_else(|error| panic!("{kind}: {error}"));
        assert_eq!(resolved, *account, "{kind} charges to the brief's account");
    }

    // The two deliberate refusals, for two different reasons — one waits for
    // Finance to name the account, the other for stage 4's repair objects.
    for kind in ["SEWA_KENDARAAN", "JASA_MAINTENANCE"] {
        let refused = cloud::resolve_account_code(&pool, "contract_expense", "dc", kind)
            .await
            .expect_err("an unmapped deal refuses rather than guessing");
        let message = refused.to_string();
        assert!(
            message.contains(kind) && message.contains("dc"),
            "the refusal names the contract type and the site: {message}"
        );
    }

    // The prepaid side, under the prepaid_kind vocabulary that was already
    // there — one per type the brief seeds, two insurance kinds sharing.
    let prepaid: &[(&str, &str)] = &[
        ("SEWA_TANAH_BAYAR_DIMUKA", "1037"),
        ("SEWA_TOKO_BAYAR_DIMUKA", "1038"),
        ("SEWA_RUMAH_BAYAR_DIMUKA", "1039"),
        ("SEWA_KENDARAAN_BAYAR_DIMUKA", "1041"),
        ("KONTRAK_MAINTENANCE_BAYAR_DIMUKA", "1040"),
        ("ASURANSI_BAYAR_DIMUKA", "1036"),
        ("BIAYA_IJIN_USAHA_BAYAR_DIMUKA", "1043"),
    ];
    for (kind, account) in prepaid {
        let resolved = cloud::resolve_account_code(&pool, "prepaid_expense", "dc", kind)
            .await
            .unwrap_or_else(|error| panic!("prepaid {kind}: {error}"));
        assert_eq!(resolved, *account, "{kind} is the brief's prepaid account");
    }

    // The accrual side, under accrual_kind: the two rents and three
    // utilities a shop and a mess run on.
    let accrued: &[(&str, &str)] = &[
        ("BIAYA_SEWA_KANTOR_TOKO_YMHD", "2025"),
        ("BIAYA_SEWA_RUMAH_MESS_YMHD", "2026"),
        ("BIAYA_PEMAKAIAN_LISTRIK_YMHD", "2023"),
        ("BIAYA_PEMAKAIAN_AIR_BERSIH_YMHD", "2024"),
        ("BIAYA_TELEPHONE_FAX_MODEM_YMHD", "2022"),
    ];
    for (kind, account) in accrued {
        let resolved = cloud::resolve_account_code(&pool, "accrued_expense", "dc", kind)
            .await
            .unwrap_or_else(|error| panic!("accrued {kind}: {error}"));
        assert_eq!(resolved, *account, "{kind} is the brief's accrual account");
    }

    // The income side of the rooms the company lets out.
    let income = cloud::resolve_account_code(&pool, "contract_income", "dc", "DISEWAKAN_GEDUNG")
        .await
        .unwrap_or_else(|error| panic!("income: {error}"));
    assert_eq!(income, "8005");

    // And the endpoint stitches the map to the types, at one site, prepaid
    // through the bridge constant.
    let types = cloud::ga_contract_types(&pool, "dc")
        .await
        .unwrap_or_else(|error| panic!("types endpoint: {error}"));
    assert_eq!(types.len(), 17);
    let toko = types
        .iter()
        .find(|kind| kind.code == "SEWA_TOKO")
        .unwrap_or_else(|| panic!("no SEWA_TOKO"));
    assert_eq!(toko.name, "Sewa toko/gudang/kantor");
    assert_eq!(toko.prepaid_account_code.as_deref(), Some("1038"));
    assert_eq!(toko.expense_account_code.as_deref(), Some("7004"));
    assert_eq!(toko.income_account_code, None);
    let maintenance = types
        .iter()
        .find(|kind| kind.code == "JASA_MAINTENANCE")
        .unwrap_or_else(|| panic!("no JASA_MAINTENANCE"));
    assert_eq!(
        maintenance.expense_account_code, None,
        "stage 4 wires the repair objects; an empty answer is the honest one"
    );
    let disewakan = types
        .iter()
        .find(|kind| kind.code == "DISEWAKAN_GEDUNG")
        .unwrap_or_else(|| panic!("no DISEWAKAN_GEDUNG"));
    assert_eq!(disewakan.income_account_code.as_deref(), Some("8005"));
}

// ---------------------------------------------------------------------------
// 7. The recurring bill that says whose promise it is
// ---------------------------------------------------------------------------

/// A template may name its contract — and the name survives a read; a
/// template filed under an ARCHIVED contract is refused, because a promise
/// under a retired deal is a bill nobody can explain. And the sweep's clamp:
/// a promise of the 31st is February's promise of the 28th, not a skipped
/// month.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_template_names_its_contract_and_the_sweep_clamps_to_the_months_end(pool: PgPool) {
    let contract = record(&pool, &a_lease()).await;

    let promise = cloud::RecordBillTemplateRequest {
        supplier_id: "PLN".into(),
        supplier_name: Some("PLN (persero)".into()),
        site_id: "dc".into(),
        // 6045 (Biaya pemakaian listrik) rather than the retired 6301. It is
        // already the specific electricity account, so it takes no further
        // category: a category is how a general heading is told apart by kind,
        // and a leaf that names the kind does not need one.
        expense_account_code: "6045".into(),
        expense_category_code: None,
        expense_site_id: None,
        expected_subtotal_minor: 2_100_000,
        expected_tax_minor: 231_000,
        tolerance_bps: 500,
        due_day: 31,
        label: "Listrik Pusat".into(),
        note: None,
        contract_id: Some(contract.contract_id),
    };
    let stored = cloud::record_bill_template(&pool, &promise, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("template: {error}"));
    assert_eq!(stored.contract_id, Some(contract.contract_id));

    let templates = cloud::bill_templates(&pool)
        .await
        .unwrap_or_else(|error| panic!("templates: {error}"));
    assert_eq!(templates.len(), 1);
    assert_eq!(templates[0].contract_id, Some(contract.contract_id));

    // The hub reads the same promise back, from the contract's side.
    let hub = cloud::ga_contract_hub_on(&pool, contract.contract_id, today())
        .await
        .unwrap_or_else(|error| panic!("hub: {error}"));
    assert_eq!(hub.templates.len(), 1);
    assert_eq!(hub.templates[0].label, "Listrik Pusat");
    assert!(hub.bills.is_empty(), "tahap 6 brings the bills; until then, none");

    // February: the 31st does not exist, and the promise does not skip the
    // month — it raises on the month's own last day.
    let sweep = cloud::bill_template_sweep(&pool, day(2026, 2, 28), "system")
        .await
        .unwrap_or_else(|error| panic!("february sweep: {error}"));
    assert_eq!(
        sweep.raised, 1,
        "a due_day of 31 in a 28-day month is due on the 28th"
    );
    let again = cloud::bill_template_sweep(&pool, day(2026, 2, 28), "system")
        .await
        .unwrap_or_else(|error| panic!("repeat sweep: {error}"));
    assert_eq!(again.raised, 0, "once per period, however often swept");

    // The February promise is retired so October's numbers are its alone —
    // and in a 31-day month the same promise waits for the real 31st.
    cloud::retire_bill_template(&pool, stored.template_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("retire: {error}"));
    cloud::record_bill_template(&pool, &promise, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("second template: {error}"));
    let second_sweep = cloud::bill_template_sweep(&pool, day(2026, 10, 30), "system")
        .await
        .unwrap_or_else(|error| panic!("october 30 sweep: {error}"));
    assert_eq!(second_sweep.raised, 0, "the 30th is not the 31st in October");
    let october = cloud::bill_template_sweep(&pool, day(2026, 10, 31), "system")
        .await
        .unwrap_or_else(|error| panic!("october 31 sweep: {error}"));
    assert_eq!(october.raised, 1);

    // An archived contract is refused as a template's home.
    let archive = cloud::ArchiveGaContractRequest {
        archived: true,
        reason: "gedung dijual".into(),
    };
    cloud::ga_contract_archive(&pool, contract.contract_id, &archive, ACTOR, today())
        .await
        .unwrap_or_else(|error| panic!("archive: {error}"));
    let refused = cloud::record_bill_template(&pool, &promise, ACTOR)
        .await
        .expect_err("a promise under an archived deal is a bill nobody can explain");
    assert!(refused.to_string().contains("archived"), "{refused}");

    // A contract that does not exist is refused by name, not by FK.
    let mut unknown = promise.clone();
    unknown.contract_id = Some(Uuid::new_v4());
    let refused = cloud::record_bill_template(&pool, &unknown, ACTOR)
        .await
        .expect_err("the contract must be in the register");
    assert!(refused.to_string().contains("register"), "{refused}");
}

// ---------------------------------------------------------------------------
// 8. Who may reach it
// ---------------------------------------------------------------------------

/// The contract routes sit on GA's surface, and GA is one rung for reads and
/// writes alike — the department that FILES the fact.
#[test]
fn the_contract_routes_are_a_supervisors_surface() {
    for (method, path) in [
        ("GET", "/api/v1/ga/contracts"),
        ("POST", "/api/v1/ga/contracts"),
        ("GET", "/api/v1/ga/contract-types"),
        (
            "GET",
            "/api/v1/ga/contracts/9f0f5f0e-0000-0000-0000-000000000000",
        ),
        (
            "PATCH",
            "/api/v1/ga/contracts/9f0f5f0e-0000-0000-0000-000000000000",
        ),
        (
            "POST",
            "/api/v1/ga/contracts/9f0f5f0e-0000-0000-0000-000000000000/archive",
        ),
        (
            "GET",
            "/api/v1/ga/contracts/9f0f5f0e-0000-0000-0000-000000000000/meter-readings",
        ),
        (
            "POST",
            "/api/v1/ga/contracts/9f0f5f0e-0000-0000-0000-000000000000/meter-readings",
        ),
    ] {
        assert_eq!(
            domain::required_role(method, path),
            domain::Role::Supervisor,
            "{method} {path}"
        );
    }
}

// ---------------------------------------------------------------------------
// 9. The overview, with each contract's own threshold
// ---------------------------------------------------------------------------

/// A contract appears when ITS OWN reminder says so — a 60-day reminder
/// fires at 40 days out and not at 300, and a 400-day reminder fires at
/// 300. The threshold is the deal's, not the register's.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_overview_fires_on_each_contracts_own_reminder(pool: PgPool) {
    // Ends in 40 days, reminder 60: inside its own window.
    let soon = {
        let mut request = a_lease();
        request.contract_number = Some("LK/2026/0201".into());
        request.ends_on = Some(day(2026, 11, 3));
        active(&pool, &request).await
    };
    // Ends in 300 days, reminder 60: nowhere near.
    let far = {
        let mut request = a_lease();
        request.contract_number = Some("LK/2026/0202".into());
        request.ends_on = Some(day(2027, 7, 21));
        active(&pool, &request).await
    };
    // Ends in 300 days, reminder 400: inside ITS window, at the same date
    // the last one was quiet.
    let patient = {
        let mut request = a_lease();
        request.contract_number = Some("LK/2026/0203".into());
        request.site_id = Some("store-02".into());
        request.ends_on = Some(day(2027, 7, 21));
        request.reminder_days = 400;
        active(&pool, &request).await
    };
    // Already past its end: stays on the list — the worst case is the reason
    // the list exists.
    let lapsed = {
        let mut request = a_lease();
        request.contract_number = Some("LK/2026/0204".into());
        request.site_id = Some("store-03".into());
        request.ends_on = Some(day(2026, 9, 1));
        active(&pool, &request).await
    };
    // Terminated: a decision taken, not a date approaching.
    let terminated = {
        let mut request = a_lease();
        request.contract_number = Some("LK/2026/0205".into());
        request.site_id = Some("store-04".into());
        request.ends_on = Some(day(2026, 11, 3));
        let row = record(&pool, &request).await;
        let mut update = cloud::UpdateGaContractRequest::default();
        update.status = Some("ACTIVE".into());
        cloud::ga_contract_update(&pool, row.contract_id, &update, ACTOR, today())
            .await
            .unwrap_or_else(|error| panic!("activate: {error}"));
        let mut update = cloud::UpdateGaContractRequest::default();
        update.status = Some("TERMINATED".into());
        cloud::ga_contract_update(&pool, row.contract_id, &update, ACTOR, today())
            .await
            .unwrap_or_else(|error| panic!("terminate: {error}"));
        row
    };

    let overview = cloud::ga_overview(&pool, today())
        .await
        .unwrap_or_else(|error| panic!("overview: {error}"));
    let listed: Vec<String> = overview
        .expiring_contracts
        .iter()
        .map(|row| row.id.clone())
        .collect();

    assert!(
        listed.contains(&soon.contract_id.to_string()),
        "40 days is inside a 60-day reminder: {listed:?}"
    );
    assert!(
        listed.contains(&lapsed.contract_id.to_string()),
        "a deal already past its end is the loudest thing on the list"
    );
    assert!(
        listed.contains(&patient.contract_id.to_string()),
        "300 days is inside a 400-day reminder: the threshold is the deal's"
    );
    assert!(
        !listed.contains(&far.contract_id.to_string()),
        "300 days is not soon to a 60-day reminder"
    );
    assert!(
        !listed.contains(&terminated.contract_id.to_string()),
        "a terminated deal was decided, not pending"
    );

    // The row says what it is and who is on the other side, so the reader
    // knows whose chase it is without opening it.
    let row = overview
        .expiring_contracts
        .iter()
        .find(|row| row.id == soon.contract_id.to_string())
        .unwrap_or_else(|| panic!("the soon row is on the list"));
    assert_eq!(row.kind, "contract");
    assert_eq!(row.label, "LK/2026/0201");
    assert_eq!(row.detail.as_deref(), Some("SEWA_TOKO · Pasar Raya Inkubator"));
    assert_eq!(row.on.as_deref(), Some("2026-11-03"));
}
