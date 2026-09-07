//! Fixed assets and bank reconciliation, against a real Postgres.
//!
//! The arithmetic is unit-tested in `domain::depreciation` and the scoring in
//! `domain::bank_match`; both are pure. What is checked here is everything
//! those cannot see: that a schedule survives being written down and read back,
//! that re-running a month charges nothing twice, and that the database refuses
//! a second match on either side of a pair.

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{self as cloud};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";

/// One row of the seeded chart: code, name, parent, whether it is a heading,
/// and the location it is scoped to.
type ChartRow = (
    &'static str,
    &'static str,
    Option<&'static str>,
    bool,
    Option<&'static str>,
);

/// Enough of the client's chart to depreciate one machine: the category family,
/// its accumulated pair, its expense account, and a bank account for the
/// reconciliation tests.
async fn seed(pool: &PgPool) {
    let rows: [ChartRow; 14] = [
        ("1", "ASSET", None, true, None),
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
        ("101", "CURRENT ASSET", Some("1"), true, None),
        ("10110", "KAS & SETARA KAS", Some("101"), true, None),
        (
            "1011003",
            "CASH IN BANK TABUNGAN",
            Some("10110"),
            true,
            None,
        ),
        (
            "101100300100",
            "Cash In Bank Tabungan Bank BCA HO",
            Some("1011003"),
            false,
            Some("dc"),
        ),
        ("2", "LIABILITIES", None, true, None),
        (
            "201200100100",
            "Hutang Suppliers HO",
            Some("2"),
            false,
            Some("dc"),
        ),
    ];
    for (code, name, parent, is_group, site) in rows {
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
             VALUES ($1,$2,$3,$4,$5)",
        )
        .bind(code)
        .bind(name)
        .bind(parent)
        .bind(is_group)
        .bind(site)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{code}: {error}"));
    }
    // The depreciation expense family, which lives under root 7.
    for (code, name, parent, is_group, site) in [
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
    ] {
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
             VALUES ($1,$2,$3,$4,$5)",
        )
        .bind(code)
        .bind(name)
        .bind(parent)
        .bind(is_group)
        .bind(site)
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

/// The category is the qualifier: `1021504 Machineries` resolves to the
/// client's own expense and accumulated accounts.
async fn map_machinery(pool: &PgPool) {
    for (key, code) in [
        ("depreciation_expense", "701021200100"),
        ("accumulated_depreciation", "102160400100"),
    ] {
        cloud::set_account_mapping(
            pool,
            &cloud::SetAccountMappingRequest {
                semantic_key: key.into(),
                site_id: "dc".into(),
                qualifier: "1021504".into(),
                account_code: code.into(),
                note: None,
            },
            ACTOR,
        )
        .await
        .unwrap_or_else(|error| panic!("map {key}: {error}"));
    }
}

fn date(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).unwrap_or_else(|| panic!("bad date"))
}

async fn a_machine(pool: &PgPool) -> Uuid {
    cloud::register_asset(
        pool,
        &cloud::RegisterAssetRequest {
            asset_number: "AST-000001".into(),
            name: "Mesin jahit Juki".into(),
            category_code: "1021504".into(),
            site_id: "dc".into(),
            acquired_on: date(2026, 1, 5),
            serial_number: Some("JK-99".into()),
            notes: None,
            acquired_via_line_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("register: {error}"))
    .asset_id
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_asset_carries_no_money_until_finance_says_so(pool: PgPool) {
    seed(&pool).await;
    let asset_id = a_machine(&pool).await;

    // Registered and unassessed. That is a real state and the list can ask for
    // it: "nobody has looked at this yet" is an open control gap, and it must
    // not be indistinguishable from "looked at and expensed".
    let unassessed = cloud::list_assets(&pool, None, None, true, 100)
        .await
        .unwrap_or_else(|error| panic!("list: {error}"));
    assert_eq!(unassessed.len(), 1);
    assert_eq!(unassessed[0].decision, None);
    assert_eq!(unassessed[0].capitalized_cost_minor, None);
    assert_eq!(unassessed[0].accumulated_minor, 0);

    cloud::assess_asset(
        &pool,
        asset_id,
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

    let after = cloud::asset(&pool, asset_id)
        .await
        .unwrap_or_else(|error| panic!("asset: {error}"));
    assert_eq!(after.decision.as_deref(), Some("CAPITALIZE"));
    assert_eq!(after.book_value_minor, Some(12_000_000));
    assert!(cloud::list_assets(&pool, None, None, true, 100)
        .await
        .unwrap_or_else(|error| panic!("list: {error}"))
        .is_empty());
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_assessment_is_appended_and_the_latest_wins(pool: PgPool) {
    seed(&pool).await;
    let asset_id = a_machine(&pool).await;
    for (decision, reason) in [
        ("EXPENSE", "di bawah batas kapitalisasi"),
        ("CAPITALIZE", "salah — nilainya di atas batas, dikoreksi"),
    ] {
        let request = if decision == "EXPENSE" {
            cloud::AssessAssetRequest {
                decision: decision.into(),
                capitalized_cost_minor: None,
                salvage_value_minor: None,
                useful_life_months: None,
                method: None,
                in_service_on: None,
                reason: reason.into(),
                acquired_via_line_id: None,
            }
        } else {
            cloud::AssessAssetRequest {
                decision: decision.into(),
                capitalized_cost_minor: Some(12_000_000),
                salvage_value_minor: Some(0),
                useful_life_months: Some(12),
                method: Some("STRAIGHT_LINE".into()),
                in_service_on: Some(date(2026, 1, 1)),
                reason: reason.into(),
                acquired_via_line_id: None,
            }
        };
        cloud::assess_asset(&pool, asset_id, &request, ACTOR)
            .await
            .unwrap_or_else(|error| panic!("assess {decision}: {error}"));
    }

    // The correction is in force, and the mistake is still on the record —
    // "decided no in January, reversed in March" is itself the audit trail.
    let now = cloud::asset(&pool, asset_id)
        .await
        .unwrap_or_else(|error| panic!("asset: {error}"));
    assert_eq!(now.decision.as_deref(), Some("CAPITALIZE"));
    let kept: i64 = sqlx::query("SELECT COUNT(*)::bigint AS n FROM asset_capitalization")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"))
        .try_get("n")
        .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(kept, 2, "the earlier assessment is never deleted");

    let edited = sqlx::query("UPDATE asset_capitalization SET reason = 'x'")
        .execute(&pool)
        .await;
    assert!(edited.is_err(), "assessments are appended, not edited");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_month_is_charged_once_however_often_it_is_run(pool: PgPool) {
    seed(&pool).await;
    map_machinery(&pool).await;
    let asset_id = a_machine(&pool).await;
    cloud::assess_asset(
        &pool,
        asset_id,
        &cloud::AssessAssetRequest {
            decision: "CAPITALIZE".into(),
            capitalized_cost_minor: Some(12_000_000),
            salvage_value_minor: Some(0),
            useful_life_months: Some(12),
            method: Some("STRAIGHT_LINE".into()),
            in_service_on: Some(date(2026, 1, 1)),
            reason: "mesin produksi".into(),
            acquired_via_line_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("assess: {error}"));

    let first = cloud::run_depreciation(&pool, 2026, 1, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("run: {error}"));
    assert_eq!(first.posted_count, 1);
    assert_eq!(first.posted_total_minor, 1_000_000);

    // Run it again. The unique index on (asset, period) refuses a second entry,
    // so the report says why rather than charging twice.
    let again = cloud::run_depreciation(&pool, 2026, 1, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("rerun: {error}"));
    assert_eq!(again.posted_count, 0);
    assert_eq!(again.skipped_count, 1);
    assert_eq!(
        again.lines[0].skipped_because.as_deref(),
        Some("already charged for this month")
    );

    // The expense and the accumulated account both moved, and by the same
    // amount — the entry balances because the poster made it balance.
    let expense = cloud::account_balance(&pool, "701021200100", None, None)
        .await
        .unwrap_or_else(|error| panic!("expense: {error}"));
    let accumulated = cloud::account_balance(&pool, "102160400100", None, None)
        .await
        .unwrap_or_else(|error| panic!("accumulated: {error}"));
    assert_eq!(expense.balance_minor, 1_000_000);
    assert_eq!(accumulated.balance_minor, -1_000_000);

    // And the book value falls without anybody storing it.
    let after = cloud::asset(&pool, asset_id)
        .await
        .unwrap_or_else(|error| panic!("asset: {error}"));
    assert_eq!(after.accumulated_minor, 1_000_000);
    assert_eq!(after.book_value_minor, Some(11_000_000));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_unmapped_category_is_named_before_the_run_not_during(pool: PgPool) {
    seed(&pool).await;
    // Deliberately no mapping.
    let asset_id = a_machine(&pool).await;
    cloud::assess_asset(
        &pool,
        asset_id,
        &cloud::AssessAssetRequest {
            decision: "CAPITALIZE".into(),
            capitalized_cost_minor: Some(1_200_000),
            salvage_value_minor: Some(0),
            useful_life_months: Some(12),
            method: Some("STRAIGHT_LINE".into()),
            in_service_on: Some(date(2026, 1, 1)),
            reason: "mesin".into(),
            acquired_via_line_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("assess: {error}"));

    let missing = cloud::unmapped_categories(&pool)
        .await
        .unwrap_or_else(|error| panic!("check: {error}"));
    assert_eq!(missing.len(), 2, "both halves of the entry are unmapped");
    assert!(missing.iter().any(|m| m.contains("depreciation_expense")));
    assert!(missing.iter().any(|m| m.contains("1021504")));
}

// ---------------------------------------------------------------------------
// Bank reconciliation
// ---------------------------------------------------------------------------

fn statement(lines: Vec<cloud::ImportStatementLine>) -> cloud::ImportStatementRequest {
    cloud::ImportStatementRequest {
        account_code: "101100300100".into(),
        site_id: "dc".into(),
        period_start: date(2026, 1, 1),
        period_end: date(2026, 1, 31),
        opening_minor: 0,
        closing_minor: -5_000_000,
        source_name: Some("BCA".into()),
        lines,
    }
}

fn bank_line(day: u32, debit: i64, reference: &str) -> cloud::ImportStatementLine {
    cloud::ImportStatementLine {
        value_date: date(2026, 1, day),
        description: format!("TRSF E-BANKING DB {reference}"),
        reference: Some(reference.into()),
        debit_minor: debit,
        credit_minor: 0,
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn importing_the_same_statement_twice_changes_nothing(pool: PgPool) {
    seed(&pool).await;
    let request = statement(vec![
        bank_line(5, 5_000_000, "JV-00000001"),
        bank_line(6, 2_500_000, "JV-00000002"),
    ]);

    let first = cloud::import_statement(&pool, &request, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("import: {error}"));
    assert_eq!(first.inserted, 2);
    assert_eq!(first.duplicates, 0);

    // The same file again — a person re-uploading, a month overlapping the one
    // before. Every line is already known, so nothing is inserted and the
    // report says so rather than the screen quietly doubling.
    let second = cloud::import_statement(&pool, &request, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("reimport: {error}"));
    assert_eq!(second.inserted, 0);
    assert_eq!(second.duplicates, 2);

    let total: i64 = sqlx::query("SELECT COUNT(*)::bigint AS n FROM bank_statement_line")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"))
        .try_get("n")
        .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(total, 2);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_bank_line_is_matched_against_our_own_ledger(pool: PgPool) {
    seed(&pool).await;
    cloud::set_account_mapping(
        &pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: "bank_savings".into(),
            site_id: "dc".into(),
            qualifier: String::new(),
            account_code: "101100300100".into(),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("map: {error}"));
    cloud::set_account_mapping(
        &pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: "trade_payable".into(),
            site_id: "dc".into(),
            qualifier: String::new(),
            account_code: "201200100100".into(),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("map: {error}"));

    // We paid a supplier: payable down, bank down.
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let entry = cloud::post(
        &mut tx,
        &cloud::PostingIntent {
            posting_date: date(2026, 1, 5),
            source_kind: "PAYMENT".into(),
            source_id: Some("pay-1".into()),
            rule_version: "payment/1".into(),
            currency: "IDR".into(),
            memo: Some("bayar PT Sinar Jaya".into()),
            lines: vec![
                cloud::PostingLine::debit("trade_payable", "dc", 5_000_000),
                cloud::PostingLine::credit("bank_savings", "dc", 5_000_000),
            ],
        },
        None,
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    // The bank reports the same event, on the same day, quoting our entry
    // number in the narration.
    let imported = cloud::import_statement(
        &pool,
        &statement(vec![bank_line(5, 5_000_000, &entry.entry_number)]),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("import: {error}"));

    let suggestions = cloud::suggest_matches(&pool, imported.statement_id)
        .await
        .unwrap_or_else(|error| panic!("suggest: {error}"));
    assert_eq!(suggestions.len(), 1);
    let best = suggestions[0]
        .suggestions
        .first()
        .unwrap_or_else(|| panic!("no suggestion for an exact match"));
    assert!(
        best.auto_match,
        "same amount, same day, same reference, and alone: {:?}",
        best.reasons
    );
    assert!(best.reasons.iter().any(|r| r.contains("reference")));

    let line_id = suggestions[0].line_id;
    let journal_line_id: Uuid = best
        .journal_line_id
        .parse()
        .unwrap_or_else(|error| panic!("id: {error}"));
    cloud::confirm_match(
        &pool,
        line_id,
        &cloud::ConfirmMatchRequest {
            journal_line_id,
            score: Some(best.score),
            reasons: best.reasons.clone(),
            automatic: true,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("confirm: {error}"));

    // Matching records agreement and writes no journal.
    let entries = cloud::journal_register(&pool, None, None, None, None, 100)
        .await
        .unwrap_or_else(|error| panic!("register: {error}"));
    assert_eq!(entries.len(), 1, "reconciling posts nothing");

    // And the same journal line cannot be claimed by a second bank line.
    let another = cloud::import_statement(
        &pool,
        &statement(vec![bank_line(6, 5_000_000, "OTHER")]),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("import: {error}"));
    let other_line: Uuid = cloud::statement_lines(&pool, another.statement_id)
        .await
        .unwrap_or_else(|error| panic!("lines: {error}"))[0]
        .line_id;
    assert!(
        cloud::confirm_match(
            &pool,
            other_line,
            &cloud::ConfirmMatchRequest {
                journal_line_id,
                score: None,
                reasons: Vec::new(),
                automatic: false,
            },
            ACTOR,
        )
        .await
        .is_err(),
        "one journal line settles one bank line, and the database says so"
    );
}
