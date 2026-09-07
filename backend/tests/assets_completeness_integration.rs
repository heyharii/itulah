//! The five things the asset register could not do, against a real Postgres.
//!
//! Each of these was a hole with the same shape: the arithmetic existed, the
//! table existed, and the one step that made it reach the books was left to
//! somebody remembering. What is checked here is that nobody has to remember.
//!
//!   * a disposal at a loss posts, where it used to be refused for want of one
//!     account mapping — the only one of the meanings the posting rules use
//!     that the seed never set;
//!   * running a month twice charges it once, and the log says both attempts
//!     happened;
//!   * a bill line that says it is buying a machine puts the machine on the
//!     register, linked to the line that bought it;
//!   * operating equipment is reserved for rather than depreciated, and a
//!     replacement draws the reserve down instead of hitting the profit and
//!     loss a second time;
//!   * every one of those lines names the asset it is about.

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{self as cloud};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ratna";

/// One row of the seeded chart: code, name, parent, whether it is a heading,
/// and the location it is scoped to.
type ChartRow = (
    &'static str,
    &'static str,
    Option<&'static str>,
    bool,
    Option<&'static str>,
);

/// Enough of the client's own chart to buy a machine, depreciate it, sell it at
/// a loss, and reserve against a rack.
///
/// The codes are the client's, read from their master account file, and the
/// three operating-equipment blocks are the point of half this file: `1021607`
/// is `Reserve Replacement`, not accumulated depreciation, and `7010215` is
/// `BIAYA REPLACEMENT`, not depreciation expense.
const CHART: &[ChartRow] = &[
    ("1", "ASSET", None, true, None),
    ("101", "CURRENT ASSET", Some("1"), true, None),
    ("10110", "KAS & SETARA KAS", Some("101"), true, None),
    ("1011001", "CASH ON HAND", Some("10110"), true, None),
    (
        "101100100100",
        "Cash on Hand HO",
        Some("1011001"),
        false,
        Some("dc"),
    ),
    ("102", "NON CURRENT ASSET", Some("1"), true, None),
    ("10215", "AKTIVA TETAP", Some("102"), true, None),
    ("1021504", "Machineries", Some("10215"), true, None),
    (
        "102150400100",
        "Mesin HO",
        Some("1021504"),
        false,
        Some("dc"),
    ),
    ("1021507", "Operating Equipment", Some("10215"), true, None),
    ("1021507001", "OE - Rak 1", Some("1021507"), true, None),
    (
        "102150700100",
        "OE - Rak 1 HO",
        Some("1021507001"),
        false,
        Some("dc"),
    ),
    (
        "10216",
        "AKUMULASI PENYUSUTAN AKTIVA TETAP",
        Some("102"),
        true,
        None,
    ),
    ("1021604", "Akum-Penyusu - Mesin", Some("10216"), true, None),
    (
        "102160400100",
        "Akum-Penyusu - Mesin HO",
        Some("1021604"),
        false,
        Some("dc"),
    ),
    (
        "1021607",
        "Reserve Replacement - Operating Equipment",
        Some("10216"),
        true,
        None,
    ),
    (
        "1021607001",
        "Reserve Replacement OE- Rak 1",
        Some("1021607"),
        true,
        None,
    ),
    (
        "102160700100",
        "RR OE- Rak 1 HO",
        Some("1021607001"),
        false,
        Some("dc"),
    ),
    ("2", "LIABILITIES", None, true, None),
    ("201", "HUTANG USAHA", Some("2"), true, None),
    (
        "201200100300",
        "Hutang Supplier Non Barang Dagang HO",
        Some("201"),
        false,
        Some("dc"),
    ),
    ("7", "BEBAN USAHA LAINNYA", None, true, None),
    (
        "70102",
        "BIAYA DEPRESIASI DAN AMORTISASI",
        Some("7"),
        true,
        None,
    ),
    (
        "7010212",
        "BIAYA DEPRESIASI  MESIN",
        Some("70102"),
        true,
        None,
    ),
    (
        "701021200100",
        "Biaya Depresiasi Mesin HO",
        Some("7010212"),
        false,
        Some("dc"),
    ),
    (
        "7010215",
        "BIAYA REPLACEMENT OPERATING EQUIPMENT",
        Some("70102"),
        true,
        None,
    ),
    (
        "7010215001",
        "Biaya Replacement OE - Rack 1",
        Some("7010215"),
        true,
        None,
    ),
    (
        "701021500100",
        "Biaya Replacement OE - Rack 1 HO",
        Some("7010215001"),
        false,
        Some("dc"),
    ),
    ("8", "BEBAN  NON OPERASIONAL", None, true, None),
    (
        "801",
        "PENDAPATAN DAN (BIAYA) LAIN - LAIN",
        Some("8"),
        true,
        None,
    ),
    (
        "801011000700",
        "Pendapatan (Biaya) Lain-Lain HO",
        Some("801"),
        false,
        Some("dc"),
    ),
];

async fn seed(pool: &PgPool) {
    for (code, name, parent, is_group, site) in CHART {
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
             VALUES ($1,$2,$3,$4,$5)",
        )
        .bind(code)
        .bind(name)
        .bind(*parent)
        .bind(is_group)
        .bind(*site)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{code}: {error}"));
    }
    for (year, month) in [(2026, 1), (2026, 2), (2026, 3)] {
        cloud::open_period(pool, year, month)
            .await
            .unwrap_or_else(|error| panic!("period: {error}"));
    }
}

async fn map(pool: &PgPool, key: &str, qualifier: &str, code: &str) {
    cloud::set_account_mapping(
        pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: key.into(),
            site_id: "dc".into(),
            qualifier: qualifier.into(),
            account_code: code.into(),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("map {key}/{qualifier}: {error}"));
}

/// The three a machine needs to be depreciated and taken off the books again —
/// but NOT `asset_disposal_result`, which each test maps for itself so that the
/// refusal can be seen before the fix.
async fn map_machinery(pool: &PgPool) {
    map(pool, "fixed_asset", "1021504", "102150400100").await;
    map(pool, "accumulated_depreciation", "1021504", "102160400100").await;
    map(pool, "depreciation_expense", "1021504", "701021200100").await;
    map(pool, "cash", "", "101100100100").await;
    map(pool, "non_merchandise_payable", "", "201200100300").await;
}

fn date(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).unwrap_or_else(|| panic!("bad date"))
}

/// A machine bought for 12,000,000 and written off over a year.
async fn a_machine(pool: &PgPool) -> Uuid {
    let asset = cloud::register_asset(
        pool,
        &cloud::RegisterAssetRequest {
            asset_number: "AST-000001".into(),
            name: "Mesin bordir Tajima".into(),
            category_code: "1021504".into(),
            site_id: "dc".into(),
            acquired_on: date(2026, 1, 2),
            serial_number: None,
            notes: None,
            acquired_via_line_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("register: {error}"));

    cloud::assess_asset(
        pool,
        asset.asset_id,
        &cloud::AssessAssetRequest {
            decision: "CAPITALIZE".into(),
            capitalized_cost_minor: Some(12_000_000),
            salvage_value_minor: Some(0),
            useful_life_months: Some(12),
            method: Some("STRAIGHT_LINE".into()),
            in_service_on: Some(date(2026, 1, 1)),
            reason: "mesin produksi, umur ekonomis 1 tahun".into(),
            acquired_via_line_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("assess: {error}"));
    asset.asset_id
}

/// Every line of one entry: account, debit, credit, and the asset it names.
async fn lines(pool: &PgPool, entry_id: Uuid) -> Vec<(String, i64, i64, Option<Uuid>)> {
    sqlx::query(
        "SELECT account_code, debit_minor, credit_minor, asset_id
           FROM journal_line WHERE entry_id = $1 ORDER BY line_number",
    )
    .bind(entry_id)
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("lines: {error}"))
    .iter()
    .map(|row| {
        (
            row.get::<String, _>("account_code"),
            row.get::<i64, _>("debit_minor"),
            row.get::<i64, _>("credit_minor"),
            row.get::<Option<Uuid>, _>("asset_id"),
        )
    })
    .collect()
}

// ---------------------------------------------------------------------------
// A disposal at a loss
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_disposal_at_a_loss_posts_once_the_client_s_own_account_is_mapped(pool: PgPool) {
    seed(&pool).await;
    map_machinery(&pool).await;
    let asset_id = a_machine(&pool).await;

    cloud::run_depreciation(&pool, 2026, 1, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("january: {error}"));

    let sold_for_less = cloud::DisposeAssetRequest {
        disposed_on: date(2026, 1, 31),
        proceeds_minor: 5_000_000,
        method: "SOLD".into(),
        proceeds_account_key: Some("cash".into()),
        proceeds_account_qualifier: String::new(),
        memo: Some("dijual ke bengkel".into()),
    };

    // The hole, seen before it is filled. Book value is 11,000,000 and it
    // fetched 5,000,000, so 6,000,000 has to land somewhere — and until
    // `asset_disposal_result` is mapped there is nowhere, so the whole disposal
    // is refused. Every disposal except one at exactly book value hit this.
    let refused = cloud::dispose_asset(&pool, asset_id, &sold_for_less, ACTOR)
        .await
        .expect_err("a loss with nowhere to land must be refused, not defaulted");
    assert!(
        refused.to_string().contains("asset_disposal_result"),
        "the refusal has to name the key somebody must go and set: {refused}"
    );

    // The client keeps no "Laba (Rugi) Penjualan Aktiva Tetap" — classes 4 and
    // 8 of their chart have nothing of the kind. What they keep is one signed
    // other-income-and-expense leaf, which is why this is one key and not two.
    map(&pool, "asset_disposal_result", "", "801011000700").await;

    let disposed = cloud::dispose_asset(&pool, asset_id, &sold_for_less, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("dispose: {error}"));
    assert_eq!(disposed.status, "DISPOSED");
    assert_eq!(disposed.disposal_proceeds_minor, Some(5_000_000));

    let entry_id = disposed
        .disposal_journal_entry_id
        .unwrap_or_else(|| panic!("a disposed asset carries its entry"));
    let posted = lines(&pool, entry_id).await;

    // Cost out, accumulated out, cash in, and the difference to the client's
    // own account. A loss is a debit.
    assert_eq!(
        posted,
        vec![
            ("102150400100".into(), 0, 12_000_000, Some(asset_id)),
            ("102160400100".into(), 1_000_000, 0, Some(asset_id)),
            ("101100100100".into(), 5_000_000, 0, Some(asset_id)),
            ("801011000700".into(), 6_000_000, 0, Some(asset_id)),
        ],
        "the loss is 12,000,000 less 1,000,000 charged less 5,000,000 received"
    );

    // And the drill-down reads as a sentence rather than as a UUID.
    let detail = cloud::journal_entry(&pool, entry_id)
        .await
        .unwrap_or_else(|error| panic!("entry: {error}"));
    assert!(
        detail
            .lines
            .iter()
            .all(|line| line.asset_number.as_deref() == Some("AST-000001")),
        "every line of a disposal is about the asset that left"
    );
}

// ---------------------------------------------------------------------------
// The month that charges itself
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn running_a_month_twice_charges_it_once_and_says_so_both_times(pool: PgPool) {
    seed(&pool).await;
    map_machinery(&pool).await;
    let asset_id = a_machine(&pool).await;

    let before = cloud::asset_depreciation_status(&pool, 2026, 2)
        .await
        .unwrap_or_else(|error| panic!("status: {error}"));
    assert_eq!(before.assets_due, 1);
    assert_eq!(before.posted_count, 0);
    assert_eq!(before.missing.len(), 1);
    assert!(!before.complete);
    assert_eq!(before.period_status.as_deref(), Some("OPEN"));
    assert!(
        before.last_run.is_none(),
        "nobody has run February; that is not the same as having run it and posted nothing"
    );

    let first = cloud::asset_depreciation_run_month(&pool, 2026, 2, "system:month-end")
        .await
        .unwrap_or_else(|error| panic!("first run: {error}"));
    assert_eq!(first.posted_count, 1);
    assert_eq!(first.posted_total_minor, 1_000_000);

    let second = cloud::asset_depreciation_run_month(&pool, 2026, 2, "system:month-end")
        .await
        .unwrap_or_else(|error| panic!("second run: {error}"));
    assert_eq!(
        second.posted_count, 0,
        "the second run must post nothing; the unique index is what guarantees it"
    );
    assert_eq!(second.skipped_count, 1);

    let charged: i64 = sqlx::query(
        "SELECT COUNT(*)::bigint AS n FROM asset_depreciation_entry
          WHERE asset_id = $1 AND period_month = DATE '2026-02-01'",
    )
    .bind(asset_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("count: {error}"))
    .get("n");
    assert_eq!(charged, 1, "one month, one charge, however often it is run");

    // Two attempts, both recorded and both finished. A run that left no trace
    // would look exactly like a month nobody ever reached.
    let attempts = sqlx::query(
        "SELECT triggered_by, finished_at, posted_count, failed_count
           FROM asset_depreciation_run
          WHERE period_month = DATE '2026-02-01' ORDER BY started_at",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("runs: {error}"));
    assert_eq!(attempts.len(), 2);
    for attempt in &attempts {
        assert_eq!(attempt.get::<String, _>("triggered_by"), "system:month-end");
        assert!(
            attempt
                .get::<Option<chrono::DateTime<chrono::Utc>>, _>("finished_at")
                .is_some(),
            "a run with no finish is a run nobody can account for"
        );
        assert_eq!(attempt.get::<i32, _>("failed_count"), 0);
    }
    assert_eq!(attempts[0].get::<i32, _>("posted_count"), 1);
    assert_eq!(attempts[1].get::<i32, _>("posted_count"), 0);

    let after = cloud::asset_depreciation_status(&pool, 2026, 2)
        .await
        .unwrap_or_else(|error| panic!("status: {error}"));
    assert!(after.complete, "February is finished and can be closed");
    assert_eq!(after.assets_due, 1);
    assert_eq!(after.posted_count, 1);
    assert_eq!(after.posted_total_minor, 1_000_000);
    assert!(after.missing.is_empty());
    assert_eq!(
        after.last_run.as_ref().map(|run| run.triggered_by.as_str()),
        Some("system:month-end")
    );
}

// ---------------------------------------------------------------------------
// A bill line that buys a machine
// ---------------------------------------------------------------------------

/// Record and post one expense bill, and hand back its id and its journal.
async fn expense_bill(
    pool: &PgPool,
    number: &str,
    line: cloud::RecordBillLine,
) -> (Uuid, Uuid, Vec<cloud::SupplierBillLine>) {
    let amount = line.amount_minor;
    let bill = cloud::record_bill(
        pool,
        &cloud::RecordBillRequest {
            invoice_number: number.into(),
            supplier_id: "SUP-01".into(),
            supplier_name: Some("CV Mitra Jaya".into()),
            site_id: "dc".into(),
            invoice_date: date(2026, 1, 10),
            due_date: None,
            subtotal_minor: amount,
            tax_minor: 0,
            discount_minor: 0,
            note: None,
            kind: Some("EXPENSE".into()),
            lines: Some(vec![line]),
            matching: None,
            withholding_code: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("record {number}: {error}"));

    let posted = cloud::post_bill(pool, bill.invoice_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post {number}: {error}"));
    let entry_id = posted
        .journal_entry_id
        .unwrap_or_else(|| panic!("a posted bill carries its entry"));
    (
        posted.invoice_id,
        entry_id,
        posted.lines.clone().unwrap_or_default(),
    )
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_bill_line_that_says_it_buys_a_machine_puts_the_machine_on_the_register(pool: PgPool) {
    seed(&pool).await;
    map_machinery(&pool).await;

    let (_, entry_id, billed) = expense_bill(
        &pool,
        "INV-2026-0001",
        cloud::RecordBillLine {
            account_code: "102150400100".into(),
            site_id: "dc".into(),
            amount_minor: 9_000_000,
            asset_class_code: Some("1021504".into()),
            draws_reserve: false,
            memo: Some("Mesin obras Yamato".into()),
        },
    )
    .await;

    let registered = cloud::list_assets(&pool, None, None, false, 100)
        .await
        .unwrap_or_else(|error| panic!("list: {error}"));
    assert_eq!(
        registered.len(),
        1,
        "posting the bill put it on the register"
    );
    let asset = &registered[0];
    assert_eq!(asset.status, "DRAFT", "nobody has confirmed it exists yet");
    assert_eq!(asset.name, "Mesin obras Yamato");
    assert_eq!(asset.category_code, "1021504");
    assert_eq!(asset.decision, None, "Finance has still to assess it");
    assert_eq!(
        asset.acquired_via.as_deref(),
        Some("INV-2026-0001 line 1"),
        "and it says which line bought it"
    );

    // The debit that bought it names it. Without that, "what has this machine
    // cost us" is a question only the depreciation table can answer.
    let posted = lines(&pool, entry_id).await;
    assert_eq!(
        posted,
        vec![
            ("102150400100".into(), 9_000_000, 0, Some(asset.asset_id)),
            ("201200100300".into(), 0, 9_000_000, None),
        ]
    );

    // The exception report stays honest: the books bought it and the register
    // has it, so neither half of the gap has anything to say.
    let gap = cloud::acquisition_gap(&pool)
        .await
        .unwrap_or_else(|error| panic!("gap: {error}"));
    assert!(
        gap.lines_without_an_asset.is_empty(),
        "the posted capital purchase is claimed"
    );
    assert!(
        gap.assets_without_a_line.is_empty(),
        "and the asset is backed"
    );

    // The accountant finishes it off, and that is what promotes the draft. The
    // cost has to be the cost the bill charged — `check_acquisition_line`
    // refuses anything else, which is the whole reason the link exists.
    let wrong = cloud::assess_asset(
        &pool,
        asset.asset_id,
        &cloud::AssessAssetRequest {
            decision: "CAPITALIZE".into(),
            capitalized_cost_minor: Some(9_500_000),
            salvage_value_minor: Some(0),
            useful_life_months: Some(60),
            method: Some("STRAIGHT_LINE".into()),
            in_service_on: Some(date(2026, 2, 1)),
            reason: "salah ketik".into(),
            acquired_via_line_id: None,
        },
        ACTOR,
    )
    .await
    .expect_err("a cost that is not what the bill charged has to be refused");
    assert!(wrong.to_string().contains("9000000"), "{wrong}");

    let assessed = cloud::assess_asset(
        &pool,
        asset.asset_id,
        &cloud::AssessAssetRequest {
            decision: "CAPITALIZE".into(),
            capitalized_cost_minor: Some(9_000_000),
            salvage_value_minor: Some(0),
            useful_life_months: Some(60),
            method: Some("STRAIGHT_LINE".into()),
            in_service_on: Some(date(2026, 2, 1)),
            reason: "mesin produksi, 5 tahun".into(),
            acquired_via_line_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("assess: {error}"));
    assert_eq!(
        assessed.status, "REGISTERED",
        "assessing a draft is somebody saying they have seen it"
    );
    assert_eq!(assessed.decision.as_deref(), Some("CAPITALIZE"));

    // And the line still carries what it said, so the bill can be read back.
    assert_eq!(billed.len(), 1);
    assert_eq!(billed[0].asset_class_code.as_deref(), Some("1021504"));
    assert!(!billed[0].draws_reserve);
}

// ---------------------------------------------------------------------------
// Operating equipment: reserved for, then replaced out of the reserve
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_class_is_reserved_for_monthly_and_a_replacement_draws_the_reserve_down(pool: PgPool) {
    seed(&pool).await;
    map_machinery(&pool).await;
    // The qualifier is the CLASS. `1021507001 OE - Rak 1` resolves to the
    // client's own `1021607001` reserve and `7010215001` charge — the two
    // parallel blocks their chart has always had.
    map(&pool, "replacement_reserve", "1021507001", "102160700100").await;
    map(&pool, "replacement_expense", "1021507001", "701021500100").await;

    cloud::set_asset_replacement_rate(
        &pool,
        &cloud::SetReplacementRateRequest {
            class_code: "1021507001".into(),
            site_id: "dc".into(),
            effective_from: date(2026, 1, 1),
            monthly_charge_minor: 400_000,
            note: Some("rak toko diganti tiap beberapa tahun".into()),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("rate: {error}"));

    let classes = cloud::asset_reserve_classes(&pool)
        .await
        .unwrap_or_else(|error| panic!("classes: {error}"));
    assert_eq!(classes.len(), 1);
    assert!(classes[0].has_replacement_reserve);
    assert_eq!(classes[0].rated_sites, 1);

    let january = cloud::asset_reserve_charge(&pool, 2026, 1, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("reserve january: {error}"));
    assert_eq!(january.posted_count, 1);
    assert_eq!(january.posted_total_minor, 400_000);

    let entry = sqlx::query(
        "SELECT entry_id, source_kind, source_id FROM journal_entry
          WHERE source_kind = 'ASSET_RESERVE'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("entry: {error}"));
    assert_eq!(entry.get::<String, _>("source_id"), "dc:2026-01");
    assert_eq!(
        lines(&pool, entry.get("entry_id")).await,
        vec![
            ("701021500100".into(), 400_000, 0, None),
            ("102160700100".into(), 0, 400_000, None),
        ],
        "the charge is per class and about no single thing, so no line names an asset"
    );

    // Repeating a month charges nothing twice: the UNIQUE on
    // (class, location, month) is what makes the schedule safe to run hourly.
    let again = cloud::asset_reserve_charge(&pool, 2026, 1, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("reserve january again: {error}"));
    assert_eq!(again.posted_count, 0);
    assert_eq!(again.skipped_count, 1);
    let status = cloud::asset_reserve_status(&pool, 2026, 1)
        .await
        .unwrap_or_else(|error| panic!("reserve status: {error}"));
    assert!(status.complete);
    assert_eq!(status.rates_in_force, 1);
    assert_eq!(status.charged_count, 1);
    assert_eq!(status.charged_total_minor, 400_000);

    // Now the rack is actually replaced. The expense was taken month by month
    // while the reserve was being built, so the purchase debits the reserve —
    // putting it through `7010215*` a second time would charge one rack twice.
    let (_, replacement_entry, billed) = expense_bill(
        &pool,
        "INV-2026-0002",
        cloud::RecordBillLine {
            account_code: "701021500100".into(),
            site_id: "dc".into(),
            amount_minor: 350_000,
            asset_class_code: Some("1021507001".into()),
            draws_reserve: true,
            memo: Some("Rak baru toko".into()),
        },
    )
    .await;
    assert!(billed[0].draws_reserve);

    assert_eq!(
        lines(&pool, replacement_entry).await,
        vec![
            ("102160700100".into(), 350_000, 0, None),
            ("201200100300".into(), 0, 350_000, None),
        ],
        "a replacement draws the reserve down; it does not reach the profit and loss again"
    );

    // Nothing was put on the register: the client does not capitalise
    // operating equipment, so there would be no cost for a row to carry.
    assert!(
        cloud::list_assets(&pool, None, None, false, 100)
            .await
            .unwrap_or_else(|error| panic!("list: {error}"))
            .is_empty(),
        "a reserve draw mints no asset"
    );

    // 400,000 reserved and 350,000 spent leaves 50,000 in the fund.
    let reserve: i64 = sqlx::query(
        "SELECT COALESCE(SUM(credit_minor - debit_minor), 0)::bigint AS net
           FROM journal_line WHERE account_code = '102160700100'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("reserve balance: {error}"))
    .get("net");
    assert_eq!(reserve, 50_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_draw_that_names_no_class_is_refused_before_it_reaches_the_books(pool: PgPool) {
    seed(&pool).await;
    map_machinery(&pool).await;

    let refused = cloud::record_bill(
        &pool,
        &cloud::RecordBillRequest {
            invoice_number: "INV-2026-0003".into(),
            supplier_id: "SUP-01".into(),
            supplier_name: None,
            site_id: "dc".into(),
            invoice_date: date(2026, 1, 10),
            due_date: None,
            subtotal_minor: 100_000,
            tax_minor: 0,
            discount_minor: 0,
            note: None,
            kind: Some("EXPENSE".into()),
            lines: Some(vec![cloud::RecordBillLine {
                account_code: "701021500100".into(),
                site_id: "dc".into(),
                amount_minor: 100_000,
                asset_class_code: None,
                draws_reserve: true,
                memo: None,
            }]),
            matching: None,
            withholding_code: None,
        },
        ACTOR,
    )
    .await
    .expect_err("a draw with no class is a debit with nowhere to go");
    assert!(
        refused.to_string().contains("which one"),
        "the refusal has to say what is missing: {refused}"
    );
}
