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

/// The months this file posts into.
///
/// The chart itself is no longer seeded here. Since 0243 the migrations write
/// the client's own 219-account chart, and 0244 collapsed the fourteen
/// unit-suffixed copies of each account into one: `ledger_account` may not
/// name a unit at all, and `102150400100 Mesin HO` is now `1021504001 Air
/// Conditioner` with the unit carried by `journal_line.site_id`. A test that
/// minted its own leaves would be testing a chart the books do not have — and
/// `ledger_account_carries_no_unit` would refuse it anyway.
async fn seed(pool: &PgPool) {
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
        ("depreciation_expense", "7010212001"),
        ("accumulated_depreciation", "1021604001"),
    ] {
        cloud::set_account_mapping(
            pool,
            &cloud::SetAccountMappingRequest {
                semantic_key: key.into(),
                site_id: "ho".into(),
                qualifier: "1021504".into(),
                account_code: code.into(),
                note: None,
            },
            ACTOR,
        )
        .await
        .unwrap_or_else(|error| panic!("map {key}: {error:?}"));
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
            site_id: "ho".into(),
            acquired_on: date(2026, 1, 5),
            serial_number: Some("JK-99".into()),
            notes: None,
            quantity: None,
            acquired_via_line_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("register: {error:?}"))
    .asset_id
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_asset_carries_no_money_until_finance_says_so(pool: PgPool) {
    seed(&pool).await;
    let asset_id = a_machine(&pool).await;

    // Registered and unassessed. That is a real state and the list can ask for
    // it: "nobody has looked at this yet" is an open control gap, and it must
    // not be indistinguishable from "looked at and expensed".
    // The register answers with an envelope now, and "unassessed" is a value
    // of the decision filter rather than a boolean of its own — because that
    // is what it is: a state an asset is in, which the old flag could only ever
    // ask for alone.
    let unassessed = cloud::asset_page(
        &pool,
        cloud::AssetScope {
            decisions: vec!["UNASSESSED".into()],
            limit: Some(100),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("list: {error}"));
    assert_eq!(unassessed.total, 1);
    assert_eq!(unassessed.rows.len(), 1);
    assert_eq!(unassessed.rows[0].decision, None);
    assert_eq!(unassessed.rows[0].capitalized_cost_minor, None);
    assert_eq!(unassessed.rows[0].accumulated_minor, 0);

    cloud::assess_asset(
        &pool,
        asset_id,
        &cloud::AssessAssetRequest {
            decision: "CAPITALIZE".into(),
            category_code: None,
            rate_bps: None,
            opening_accumulated_minor: None,
            opening_through: None,
            capitalized_cost_minor: Some(12_000_000),
            salvage_value_minor: Some(0),
            useful_life_months: Some(12),
            method: Some("STRAIGHT_LINE".into()),
            charge_kind: Some("DEPRECIATION".into()),
            in_service_on: Some(date(2026, 1, 1)),
            reason: "mesin produksi, umur ekonomis 1 tahun".into(),
            acquired_via_line_id: None,
            acquired_via_line_ids: None,
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
    assert!(cloud::asset_page(
        &pool,
        cloud::AssetScope {
            decisions: vec!["UNASSESSED".into()],
            limit: Some(100),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("list: {error}"))
    .rows
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
                charge_kind: None,
                in_service_on: None,
                reason: reason.into(),
                acquired_via_line_id: None,
                acquired_via_line_ids: None,
                category_code: None,
                rate_bps: None,
                opening_accumulated_minor: None,
                opening_through: None,
            }
        } else {
            cloud::AssessAssetRequest {
                decision: decision.into(),
                capitalized_cost_minor: Some(12_000_000),
                salvage_value_minor: Some(0),
                useful_life_months: Some(12),
                method: Some("STRAIGHT_LINE".into()),
                charge_kind: Some("DEPRECIATION".into()),
                in_service_on: Some(date(2026, 1, 1)),
                reason: reason.into(),
                acquired_via_line_id: None,
                acquired_via_line_ids: None,
                category_code: None,
                rate_bps: None,
                opening_accumulated_minor: None,
                opening_through: None,
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
            category_code: None,
            rate_bps: None,
            opening_accumulated_minor: None,
            opening_through: None,
            capitalized_cost_minor: Some(12_000_000),
            salvage_value_minor: Some(0),
            useful_life_months: Some(12),
            method: Some("STRAIGHT_LINE".into()),
            charge_kind: Some("DEPRECIATION".into()),
            in_service_on: Some(date(2026, 1, 1)),
            reason: "mesin produksi".into(),
            acquired_via_line_id: None,
            acquired_via_line_ids: None,
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
    let expense = cloud::account_balance(&pool, "7010212001", None, None)
        .await
        .unwrap_or_else(|error| panic!("expense: {error}"));
    let accumulated = cloud::account_balance(&pool, "1021604001", None, None)
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
            category_code: None,
            rate_bps: None,
            opening_accumulated_minor: None,
            opening_through: None,
            capitalized_cost_minor: Some(1_200_000),
            salvage_value_minor: Some(0),
            useful_life_months: Some(12),
            method: Some("STRAIGHT_LINE".into()),
            charge_kind: Some("DEPRECIATION".into()),
            in_service_on: Some(date(2026, 1, 1)),
            reason: "mesin".into(),
            acquired_via_line_id: None,
            acquired_via_line_ids: None,
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

/// A BKK, as the client actually writes one: several lines, one document.
///
/// Inserted rather than posted through the bill API because what is under test
/// is the register's side of the link, and a fixture that had to keep a bill
/// API's shape in step would fail for reasons that are not about assets.
async fn a_bkk(pool: &PgPool, number: &str, lines: &[(&str, i64)]) -> Vec<Uuid> {
    let invoice_id = Uuid::new_v4();
    let total: i64 = lines.iter().map(|(_, amount)| amount).sum();
    // One transaction for the header and its lines. 0094 checks that an
    // expense bill says what it was for with a DEFERRED constraint trigger, so
    // a header committed on its own is a bill with no lines and is refused —
    // correctly.
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    sqlx::query(
        "INSERT INTO supplier_invoice
           (invoice_id, invoice_number, supplier_id, supplier_name, site_id, invoice_date,
            currency, subtotal_minor, total_minor, kind, status, recorded_by)
         VALUES ($1,$2,'SUP-1','Toko Elektronik','ho',$3,'IDR',$4,$4,'EXPENSE','DRAFT',$5)",
    )
    .bind(invoice_id)
    .bind(number)
    .bind(date(2026, 6, 25))
    .bind(total)
    .bind(ACTOR)
    .execute(&mut *tx)
    .await
    .unwrap_or_else(|error| panic!("bill {number}: {error}"));

    let mut ids = Vec::new();
    for (index, (account, amount)) in lines.iter().enumerate() {
        let line_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO supplier_invoice_expense_line
               (line_id, invoice_id, line_number, account_code, site_id, amount_minor, memo)
             VALUES ($1,$2,$3,$4,'ho',$5,'AC C4')",
        )
        .bind(line_id)
        .bind(invoice_id)
        .bind(index as i32 + 1)
        .bind(account)
        .bind(amount)
        .execute(&mut *tx)
        .await
        .unwrap_or_else(|error| panic!("line {}: {error}", index + 1));
        ids.push(line_id);
    }
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit {number}: {error}"));
    ids
}

/// The client's own air conditioner, paid for three times.
///
///     KK-26-06-00276   102150400100   25,000,000   the unit
///                      102150400100    1,390,000   installing it
///                      101100300100        5,000   the bank's charge
///     an earlier BKK   102150400100    7,000,000   paid at the start of June
///
/// Their words: "asset itu pengakuannya sekaligus (tidak bisa dicicil)
/// sementara pembayaran ke suppliernya dipisah antara harga unit dan biaya
/// pemasangan" and "ada pembayaran untuk unit yang sama di awal Juni 7 juta".
/// One air conditioner, 33,390,000, four lines of which three are the asset.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_purchase_paid_in_several_lines_is_still_one_asset(pool: PgPool) {
    seed(&pool).await;
    let lines = a_bkk(
        &pool,
        "KK-26-06-00276",
        &[
            ("1021504001", 25_000_000),
            ("1021504001", 1_390_000),
            // The bank's administration fee, on the same document and not part
            // of the asset. This is why the split cannot be read off the
            // document total.
            ("1011003001", 5_000),
        ],
    )
    .await;
    let earlier = a_bkk(&pool, "KK-26-06-00101", &[("1021504001", 7_000_000)]).await;

    let asset_id = cloud::register_asset(
        &pool,
        &cloud::RegisterAssetRequest {
            asset_number: "AST-000001".into(),
            name: "AC C4".into(),
            category_code: "1021504".into(),
            site_id: "ho".into(),
            acquired_on: date(2026, 6, 1),
            serial_number: None,
            notes: None,
            quantity: None,
            acquired_via_line_id: Some(lines[0]),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("register: {error:?}"))
    .asset_id;

    let assess = |cost: i64, named: Vec<Uuid>| cloud::AssessAssetRequest {
        decision: "CAPITALIZE".into(),
        capitalized_cost_minor: Some(cost),
        salvage_value_minor: Some(0),
        useful_life_months: Some(60),
        method: Some("STRAIGHT_LINE".into()),
        charge_kind: Some("DEPRECIATION".into()),
        in_service_on: Some(date(2026, 6, 1)),
        reason: "AC toko, unit dan pemasangan".into(),
        acquired_via_line_id: None,
        acquired_via_line_ids: Some(named),
        category_code: None,
        rate_bps: None,
        opening_accumulated_minor: None,
        opening_through: None,
    };

    // Capitalising at the full 33,390,000 while only the BKK's two asset lines
    // are named is refused, and the refusal says what the books actually paid
    // rather than naming one line and leaving the reader to work it out.
    let refusal = cloud::assess_asset(
        &pool,
        asset_id,
        &assess(33_390_000, vec![lines[0], lines[1]]),
        ACTOR,
    )
    .await
    .expect_err("33,390,000 against 26,390,000 of lines should be refused");
    let said = refusal.to_string();
    assert!(said.contains("26390000"), "{said:?}");
    assert!(said.contains("2 line(s)"), "{said:?}");

    // The unit and its installation, which is what that document paid.
    cloud::assess_asset(
        &pool,
        asset_id,
        &assess(26_390_000, vec![lines[0], lines[1]]),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("two lines: {error}"));

    // And then the payment from earlier in the month, which raises the cost of
    // the same asset rather than creating a second one. This is the case 0099
    // could not express and 0137's one-line-one-asset rule would have turned
    // into three air conditioners.
    let row = cloud::assess_asset(
        &pool,
        asset_id,
        &assess(33_390_000, vec![lines[0], lines[1], earlier[0]]),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("three lines: {error}"));
    assert_eq!(row.capitalized_cost_minor, Some(33_390_000));

    // The screen names every line that bought it, not the first one.
    let named = row.acquired_via.unwrap_or_default();
    assert!(named.contains("KK-26-06-00276 line 1"), "{named:?}");
    assert!(named.contains("KK-26-06-00276 line 2"), "{named:?}");
    assert!(named.contains("KK-26-06-00101 line 1"), "{named:?}");

    // The bank charge on the same document is not an asset purchase, and
    // saying so names the account rather than reporting a bad request.
    let refusal = cloud::assess_asset(&pool, asset_id, &assess(33_395_000, vec![lines[2]]), ACTOR)
        .await
        .expect_err("the bank charge is not part of the asset");
    assert!(refusal.to_string().contains("not an asset account"));

    // Nothing was left attached by the refusal: the cost still reconciles.
    let after = cloud::asset(&pool, asset_id)
        .await
        .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(after.capitalized_cost_minor, Some(33_390_000));
}

/// The seventh family, which does not depreciate.
///
/// `1021607` is *Reserve Replacement*, not accumulated depreciation, and
/// `7010215` is *BIAYA REPLACEMENT*, not a depreciation expense. Racks and
/// hangers are replaced rather than written down.
///
/// The category is the rung-7 group `1021507 Operating Equipment`, which is
/// what `account_map` is keyed on. It used to be the ten-character sub-kind
/// (`1021507027 OE - Hanger Wanita / ABG`), because the client's imported
/// chart was cut at that granularity; 0244's chart is cut at `1021507001`
/// instead, and the qualifier the migrations seed is the group. Both the
/// chart arrives with the database; the mapping does not, so the reserve pair
/// is bound here.
async fn map_operating_equipment(pool: &PgPool) {
    for (key, code) in [
        ("replacement_expense", "7010215001"),
        ("replacement_reserve", "1021607001"),
    ] {
        cloud::set_account_mapping(
            pool,
            &cloud::SetAccountMappingRequest {
                semantic_key: key.into(),
                site_id: "ho".into(),
                qualifier: "1021507".into(),
                account_code: code.into(),
                note: None,
            },
            ACTOR,
        )
        .await
        .unwrap_or_else(|error| panic!("map {key}: {error}"));
    }
}

/// A lot of eight hundred hangers, which is one row and not eight hundred.
async fn a_lot_of_hangers(pool: &PgPool) -> Uuid {
    cloud::register_asset(
        pool,
        &cloud::RegisterAssetRequest {
            asset_number: "AST-000426".into(),
            name: "Hanger wanita".into(),
            category_code: "1021507".into(),
            site_id: "ho".into(),
            acquired_on: date(2026, 1, 1),
            serial_number: None,
            notes: None,
            quantity: Some(800),
            acquired_via_line_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("register: {error:?}"))
    .asset_id
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn operating_equipment_accrues_a_reserve_and_leaves_depreciation_alone(pool: PgPool) {
    seed(&pool).await;
    // Both pairs are mapped, so "the reserve moved" cannot be confused with
    // "only the reserve was mappable".
    map_machinery(&pool).await;
    map_operating_equipment(&pool).await;

    let asset_id = a_lot_of_hangers(&pool).await;
    let registered = cloud::asset(&pool, asset_id)
        .await
        .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(registered.quantity, 800, "a lot keeps its count");

    cloud::assess_asset(
        &pool,
        asset_id,
        &cloud::AssessAssetRequest {
            decision: "CAPITALIZE".into(),
            category_code: None,
            rate_bps: None,
            opening_accumulated_minor: None,
            opening_through: None,
            capitalized_cost_minor: Some(12_000_000),
            salvage_value_minor: Some(0),
            useful_life_months: Some(12),
            // The arithmetic is the same straight line. Only the name of the
            // charge — and so the pair of accounts — differs.
            method: Some("STRAIGHT_LINE".into()),
            charge_kind: Some("REPLACEMENT_RESERVE".into()),
            in_service_on: Some(date(2026, 1, 1)),
            reason: "hanger toko, dicadangkan untuk penggantian".into(),
            acquired_via_line_id: None,
            acquired_via_line_ids: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("assess: {error}"));

    let run = cloud::run_depreciation(&pool, 2026, 1, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("run: {error}"));
    assert_eq!(run.posted_count, 1);
    assert_eq!(run.posted_total_minor, 1_000_000);

    // The replacement pair moved.
    let expense = cloud::account_balance(&pool, "7010215001", None, None)
        .await
        .unwrap_or_else(|error| panic!("replacement expense: {error}"));
    let reserve = cloud::account_balance(&pool, "1021607001", None, None)
        .await
        .unwrap_or_else(|error| panic!("reserve: {error}"));
    assert_eq!(expense.balance_minor, 1_000_000);
    assert_eq!(reserve.balance_minor, -1_000_000);

    // And the depreciation pair did not. This is the assertion the whole
    // migration exists for: before 0159 both charges resolved through
    // `accumulated_depreciation`, so a reserve accrual and a write-down landed
    // in the same account and the balance sheet could not tell them apart.
    let accumulated = cloud::account_balance(&pool, "1021604001", None, None)
        .await
        .unwrap_or_else(|error| panic!("accumulated: {error}"));
    let depreciation = cloud::account_balance(&pool, "7010212001", None, None)
        .await
        .unwrap_or_else(|error| panic!("depreciation: {error}"));
    assert_eq!(accumulated.balance_minor, 0);
    assert_eq!(depreciation.balance_minor, 0);

    // What the entry calls itself, in the client's own word. An accountant
    // reading the journal should not be told this was depreciation.
    let memo: Option<String> = sqlx::query(
        "SELECT memo FROM journal_entry WHERE source_kind = 'DEPRECIATION'
          ORDER BY posted_at DESC LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("memo: {error}"))
    .try_get("memo")
    .unwrap_or_else(|error| panic!("memo column: {error}"));
    let memo = memo.unwrap_or_default();
    assert!(
        memo.starts_with("Cadangan Penggantian"),
        "the memo should name the charge, got {memo:?}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_assessment_that_does_not_say_what_the_charge_is_is_refused(pool: PgPool) {
    seed(&pool).await;
    let asset_id = a_machine(&pool).await;

    // Silence is not a default. If it were, the only available default is
    // "depreciation" — which is the wrong answer for every rack in the
    // client's register, and wrong in a way that posts and balances.
    let refusal = cloud::assess_asset(
        &pool,
        asset_id,
        &cloud::AssessAssetRequest {
            decision: "CAPITALIZE".into(),
            category_code: None,
            rate_bps: None,
            opening_accumulated_minor: None,
            opening_through: None,
            capitalized_cost_minor: Some(12_000_000),
            salvage_value_minor: Some(0),
            useful_life_months: Some(12),
            method: Some("STRAIGHT_LINE".into()),
            charge_kind: None,
            in_service_on: Some(date(2026, 1, 1)),
            reason: "mesin".into(),
            acquired_via_line_id: None,
            acquired_via_line_ids: None,
        },
        ACTOR,
    )
    .await
    .expect_err("an assessment with no charge kind should be refused");
    let said = refusal.to_string();
    assert!(
        said.contains("REPLACEMENT_RESERVE"),
        "the refusal should list the values, got {said:?}"
    );

    // And an expensed asset must NOT name one: it has no monthly charge.
    let refusal = cloud::assess_asset(
        &pool,
        asset_id,
        &cloud::AssessAssetRequest {
            decision: "EXPENSE".into(),

            category_code: None,
            rate_bps: None,
            opening_accumulated_minor: None,
            opening_through: None,
            capitalized_cost_minor: None,
            salvage_value_minor: None,
            useful_life_months: None,
            method: None,
            charge_kind: Some("DEPRECIATION".into()),
            in_service_on: None,
            reason: "di bawah batas kapitalisasi".into(),
            acquired_via_line_id: None,
            acquired_via_line_ids: None,
        },
        ACTOR,
    )
    .await
    .expect_err("an expensed asset should not carry a charge kind");
    assert!(refusal.to_string().contains("no monthly charge"));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_pair_reported_as_unmapped_is_the_pair_the_asset_actually_charges(pool: PgPool) {
    seed(&pool).await;
    // Deliberately no mapping at all.
    let asset_id = a_lot_of_hangers(&pool).await;
    cloud::assess_asset(
        &pool,
        asset_id,
        &cloud::AssessAssetRequest {
            decision: "CAPITALIZE".into(),
            category_code: None,
            rate_bps: None,
            opening_accumulated_minor: None,
            opening_through: None,
            capitalized_cost_minor: Some(12_000_000),
            salvage_value_minor: Some(0),
            useful_life_months: Some(12),
            method: Some("STRAIGHT_LINE".into()),
            charge_kind: Some("REPLACEMENT_RESERVE".into()),
            in_service_on: Some(date(2026, 1, 1)),
            reason: "hanger toko".into(),
            acquired_via_line_id: None,
            acquired_via_line_ids: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("assess: {error}"));

    let missing = cloud::unmapped_categories(&pool)
        .await
        .unwrap_or_else(|error| panic!("unmapped: {error}"));
    // Naming the depreciation pair here would send somebody to map two
    // accounts this asset will never post through.
    assert!(
        missing.iter().any(|m| m.contains("replacement_expense")),
        "expected the replacement pair, got {missing:?}"
    );
    assert!(missing.iter().any(|m| m.contains("replacement_reserve")));
    assert!(
        !missing.iter().any(|m| m.contains("depreciation")),
        "the depreciation pair is not what this asset charges: {missing:?}"
    );
}

// ---------------------------------------------------------------------------
// Bank reconciliation
// ---------------------------------------------------------------------------

fn statement(lines: Vec<cloud::ImportStatementLine>) -> cloud::ImportStatementRequest {
    cloud::ImportStatementRequest {
        account_code: "1011003001".into(),
        site_id: "ho".into(),
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
            site_id: "ho".into(),
            qualifier: String::new(),
            account_code: "1011003001".into(),
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
            site_id: "ho".into(),
            qualifier: String::new(),
            account_code: "2012001001".into(),
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
                cloud::PostingLine::debit("trade_payable", "ho", 5_000_000),
                cloud::PostingLine::credit("bank_savings", "ho", 5_000_000),
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

    let suggestions = cloud::suggest_matches(&pool, imported.statement_id, false)
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
            allocated_minor: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("confirm: {error}"));

    // Matching records agreement and writes no journal.
    let entries = cloud::journal_page(
        &pool,
        cloud::JournalScope {
            limit: Some(100),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("register: {error:?}"));
    assert_eq!(entries.total, 1, "reconciling posts nothing");

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
                allocated_minor: None,
            },
            ACTOR,
        )
        .await
        .is_err(),
        "one journal line settles one bank line, and the database says so"
    );
}

// ---------------------------------------------------------------------------
// What the old system already charged
// ---------------------------------------------------------------------------
//
// The client's register has a column for depreciation to date and it is empty
// on all 1,342 rows, while 1,129 of those assets were bought in 2021 or
// earlier. Migration 0237 is the whole argument; these are the two behaviours
// it buys.

/// A machine that has been depreciating for nine months somewhere else.
///
/// Twelve-month life, a million a month, nine of them already charged by the
/// ledger this system replaces.
async fn a_machine_mid_life(pool: &PgPool) -> Uuid {
    let asset_id = a_machine(pool).await;
    cloud::assess_asset(
        pool,
        asset_id,
        &cloud::AssessAssetRequest {
            decision: "CAPITALIZE".into(),
            capitalized_cost_minor: Some(12_000_000),
            salvage_value_minor: Some(0),
            useful_life_months: Some(12),
            method: Some("STRAIGHT_LINE".into()),
            charge_kind: Some("DEPRECIATION".into()),
            in_service_on: Some(date(2025, 4, 1)),
            reason: "dibawa dari sistem lama".into(),
            category_code: None,
            rate_bps: None,
            opening_accumulated_minor: Some(9_000_000),
            opening_through: Some(date(2025, 12, 1)),
            acquired_via_line_id: None,
            acquired_via_line_ids: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("assess: {error}"));
    asset_id
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_asset_that_did_not_start_here_is_charged_from_where_it_left_off(pool: PgPool) {
    seed(&pool).await;
    map_machinery(&pool).await;
    let asset_id = a_machine_mid_life(&pool).await;

    // The carried-in figure counts as accumulated before anything is posted
    // here, so the asset is already three quarters written down.
    let before = cloud::asset(&pool, asset_id)
        .await
        .unwrap_or_else(|error| panic!("asset: {error}"));
    assert_eq!(before.opening_accumulated_minor, Some(9_000_000));
    assert_eq!(before.accumulated_minor, 9_000_000);
    assert_eq!(before.book_value_minor, Some(3_000_000));

    // A month the old ledger already charged is refused, and says so. Nothing
    // here would have collided with it: this system has no entry for June.
    let december = cloud::run_depreciation(&pool, 2025, 12, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("run: {error}"));
    assert_eq!(december.posted_count, 0);
    assert_eq!(december.skipped_count, 1);
    assert_eq!(
        december.lines[0].skipped_because.as_deref(),
        Some("carried in: the opening figure already covers 2025-12")
    );

    // The first month this system owns charges the ordinary instalment — not a
    // sweep of everything that happened before it existed.
    let january = cloud::run_depreciation(&pool, 2026, 1, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("run: {error}"));
    assert_eq!(january.posted_count, 1);
    assert_eq!(january.posted_total_minor, 1_000_000);

    // And the schedule counts the life from where the asset actually is: two
    // instalments left of twelve, not twelve.
    let schedule = cloud::asset_schedule(&pool, asset_id)
        .await
        .unwrap_or_else(|error| panic!("schedule: {error}"));
    assert_eq!(schedule.opening_accumulated_minor, Some(9_000_000));
    assert_eq!(schedule.opening_through, Some(date(2025, 12, 1)));
    assert_eq!(schedule.charged_total_minor, 1_000_000);
    assert_eq!(schedule.months_remaining, 2);
    assert_eq!(schedule.remaining_depreciable_minor, 2_000_000);

    // The last instalment sweeps what is genuinely left — two months, because
    // February was never run — and lands exactly on salvage. Without the
    // opening figure this month would have charged eleven months at once.
    let march = cloud::run_depreciation(&pool, 2026, 3, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("run: {error}"));
    assert_eq!(march.posted_count, 1);
    assert_eq!(march.posted_total_minor, 2_000_000);

    let after = cloud::asset(&pool, asset_id)
        .await
        .unwrap_or_else(|error| panic!("asset: {error}"));
    assert_eq!(after.accumulated_minor, 12_000_000);
    assert_eq!(after.book_value_minor, Some(0));

    // Only what this system posted is in the client's accounts. The nine
    // million carried in belongs to the ledger that charged it, and posting it
    // again here would double it.
    let accumulated = cloud::account_balance(&pool, "1021604001", None, None)
        .await
        .unwrap_or_else(|error| panic!("accumulated: {error}"));
    assert_eq!(accumulated.balance_minor, -3_000_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_carried_in_figure_without_the_month_it_covers_is_refused(pool: PgPool) {
    seed(&pool).await;
    map_machinery(&pool).await;
    let asset_id = a_machine(&pool).await;

    let assess = |opening: Option<i64>, through: Option<NaiveDate>| cloud::AssessAssetRequest {
        decision: "CAPITALIZE".into(),
        capitalized_cost_minor: Some(12_000_000),
        salvage_value_minor: Some(2_000_000),
        useful_life_months: Some(12),
        method: Some("STRAIGHT_LINE".into()),
        charge_kind: Some("DEPRECIATION".into()),
        in_service_on: Some(date(2026, 1, 1)),
        reason: "uji".into(),
        category_code: None,
        rate_bps: None,
        opening_accumulated_minor: opening,
        opening_through: through,
        acquired_via_line_id: None,
        acquired_via_line_ids: None,
    };

    // A figure nobody can check twice.
    let orphan = cloud::assess_asset(&pool, asset_id, &assess(Some(1_000_000), None), ACTOR)
        .await
        .expect_err("a figure with no month should be refused");
    assert!(
        orphan.to_string().contains("both or neither"),
        "the refusal should name what is missing: {orphan}"
    );

    // More written down than there ever was to write down.
    let too_much = cloud::assess_asset(
        &pool,
        asset_id,
        &assess(Some(11_000_000), Some(date(2026, 6, 1))),
        ACTOR,
    )
    .await
    .expect_err("carrying in more than the depreciable amount should be refused");
    assert!(
        too_much.to_string().contains("10000000 depreciable"),
        "the refusal should name both figures: {too_much}"
    );

    // A month that ends before the asset was in service.
    let too_early = cloud::assess_asset(
        &pool,
        asset_id,
        &assess(Some(1_000_000), Some(date(2025, 12, 1))),
        ACTOR,
    )
    .await
    .expect_err("a figure covering a month before service should be refused");
    assert!(
        too_early
            .to_string()
            .contains("before the asset went into service"),
        "{too_early}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_rehearsal_charges_nothing_and_names_what_would_refuse(pool: PgPool) {
    seed(&pool).await;
    // Deliberately unmapped. A run refuses the whole month for this; a
    // rehearsal has to answer anyway, because the list of assets with nowhere
    // to charge is most of what somebody looks ahead for.
    let asset_id = a_machine(&pool).await;
    cloud::assess_asset(
        &pool,
        asset_id,
        &cloud::AssessAssetRequest {
            decision: "CAPITALIZE".into(),
            category_code: None,
            rate_bps: None,
            opening_accumulated_minor: None,
            opening_through: None,
            capitalized_cost_minor: Some(1_200_000),
            salvage_value_minor: Some(0),
            useful_life_months: Some(12),
            method: Some("STRAIGHT_LINE".into()),
            charge_kind: Some("DEPRECIATION".into()),
            in_service_on: Some(date(2026, 1, 1)),
            reason: "mesin".into(),
            acquired_via_line_id: None,
            acquired_via_line_ids: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("assess: {error}"));

    let blocked = cloud::preview_depreciation(&pool, 2026, 1)
        .await
        .unwrap_or_else(|error| panic!("preview: {error}"));
    assert_eq!(blocked.posted_count, 0);
    assert_eq!(blocked.blocked_count, 1);
    // The amount is still worked out — what it would charge is the other half
    // of the answer — and the refusal names the meaning and the qualifier.
    assert_eq!(blocked.lines[0].amount_minor, Some(100_000));
    let why = blocked.lines[0]
        .blocked_because
        .as_deref()
        .unwrap_or_default();
    assert!(why.contains("depreciation_expense"), "{why}");
    assert!(why.contains("1021504"), "{why}");

    // Map the pair and the same rehearsal changes its mind, still writing
    // nothing.
    map_machinery(&pool).await;
    let ready = cloud::preview_depreciation(&pool, 2026, 1)
        .await
        .unwrap_or_else(|error| panic!("preview: {error}"));
    assert_eq!(ready.blocked_count, 0);
    assert_eq!(ready.posted_count, 1);
    assert_eq!(ready.posted_total_minor, 100_000);

    let schedule = cloud::asset_schedule(&pool, asset_id)
        .await
        .unwrap_or_else(|error| panic!("schedule: {error}"));
    assert!(
        schedule.charged.is_empty(),
        "a rehearsal writes nothing: {:?}",
        schedule.charged
    );
    assert_eq!(schedule.charged_total_minor, 0);

    // And the month is still there to run for real.
    let run = cloud::run_depreciation(&pool, 2026, 1, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("run: {error}"));
    assert_eq!(run.posted_count, 1);
    assert_eq!(run.blocked_count, 0);
}

// ---------------------------------------------------------------------------
// Finished work leaving Contract In Progress
// ---------------------------------------------------------------------------

/// The client's CIP account, which is one per unit and not one per family:
/// work in progress has not become a kind of thing yet.
async fn seed_work_in_progress(pool: &PgPool) {
    // `1031803001 Contract In Progress (CIP)` is a POSTING account in the
    // client's own chart — 0244 moved CIP to a code of ours, and 0254 put it
    // back where the client files it. The chart arrives with the migrations;
    // `account_map` does not, so every meaning this test posts through is
    // still bound here.
    for (key, qualifier, code) in [
        ("work_in_progress", "1031803001", "1031803001"),
        ("fixed_asset", "1021504", "1021504001"),
        ("trade_payable", "", "2012001001"),
    ] {
        cloud::set_account_mapping(
            pool,
            &cloud::SetAccountMappingRequest {
                semantic_key: key.into(),
                site_id: "ho".into(),
                qualifier: qualifier.into(),
                account_code: code.into(),
                note: None,
            },
            ACTOR,
        )
        .await
        .unwrap_or_else(|error| panic!("map {key}: {error:?}"));
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn finished_work_leaves_contract_in_progress_and_the_cost_moves_with_it(pool: PgPool) {
    seed(&pool).await;
    map_machinery(&pool).await;
    seed_work_in_progress(&pool).await;

    let asset_id = cloud::register_asset(
        &pool,
        &cloud::RegisterAssetRequest {
            asset_number: "AST-000009".into(),
            name: "Renovasi toko".into(),
            category_code: "1031803001".into(),
            site_id: "ho".into(),
            acquired_on: date(2026, 1, 5),
            serial_number: None,
            notes: None,
            quantity: None,
            acquired_via_line_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("register: {error:?}"))
    .asset_id;

    let in_progress = cloud::AssessAssetRequest {
        decision: "IN_PROGRESS".into(),
        capitalized_cost_minor: Some(5_000_000),
        salvage_value_minor: None,
        useful_life_months: None,
        method: None,
        charge_kind: None,
        in_service_on: None,
        reason: "fit-out berjalan".into(),
        category_code: None,
        rate_bps: None,
        opening_accumulated_minor: None,
        opening_through: None,
        acquired_via_line_id: None,
        acquired_via_line_ids: None,
    };
    cloud::assess_asset(&pool, asset_id, &in_progress, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("assess: {error}"));

    let finished = cloud::AssessAssetRequest {
        decision: "CAPITALIZE".into(),
        capitalized_cost_minor: Some(5_000_000),
        salvage_value_minor: Some(0),
        useful_life_months: Some(60),
        method: Some("STRAIGHT_LINE".into()),
        charge_kind: Some("DEPRECIATION".into()),
        in_service_on: Some(date(2026, 2, 1)),
        reason: "toko dibuka".into(),
        category_code: Some("1021504".into()),
        rate_bps: None,
        opening_accumulated_minor: None,
        opening_through: None,
        acquired_via_line_id: None,
        acquired_via_line_ids: None,
    };

    // Nothing has put this cost into the client's CIP account, so there is
    // nothing to take out of it. Refused rather than posted: the credit would
    // drive their own account negative and call the difference finished work.
    let empty = cloud::assess_asset(&pool, asset_id, &finished, ACTOR)
        .await
        .expect_err("capitalising out of an empty CIP account should be refused");
    assert!(
        empty.to_string().contains("1031803001") && empty.to_string().contains("nothing to move"),
        "the refusal should name the account and the fix: {empty}"
    );

    // The bill that paid the contractor, landing where the client puts it.
    let intent = cloud::PostingIntent {
        posting_date: date(2026, 1, 20),
        source_kind: "SUPPLIER_INVOICE".into(),
        source_id: Some(Uuid::new_v4().to_string()),
        rule_version: "test/1".into(),
        currency: "IDR".into(),
        memo: Some("termin kontraktor".into()),
        lines: vec![
            cloud::PostingLine::debit("work_in_progress", "ho", 5_000_000)
                .with_qualifier("1031803001"),
            cloud::PostingLine::credit("trade_payable", "ho", 5_000_000),
        ],
    };
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    cloud::post(&mut tx, &intent, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    // Now it can finish, and the cost moves with the decision.
    let capitalised = cloud::assess_asset(&pool, asset_id, &finished, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("capitalise: {error}"));
    assert_eq!(capitalised.category_code, "1021504");
    assert_eq!(capitalised.decision.as_deref(), Some("CAPITALIZE"));

    let progress = cloud::account_balance(&pool, "1031803001", None, None)
        .await
        .unwrap_or_else(|error| panic!("cip: {error}"));
    let fixed = cloud::account_balance(&pool, "1021504001", None, None)
        .await
        .unwrap_or_else(|error| panic!("fixed: {error}"));
    assert_eq!(progress.balance_minor, 0, "work in progress is emptied");
    assert_eq!(
        fixed.balance_minor, 5_000_000,
        "and the family it became holds it"
    );

    // And the move is nameable: its own source kind, pointing at the asset.
    let kind: String = sqlx::query_scalar(
        "SELECT source_kind FROM journal_entry WHERE source_id = $1 ORDER BY posting_date DESC LIMIT 1",
    )
    .bind(asset_id.to_string())
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("entry: {error}"));
    assert_eq!(kind, "ASSET_CAPITALIZATION");
}
