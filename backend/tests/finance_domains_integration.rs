//! Advances, owners, facilities — and the control panel that reads them.
//!
//! The chart is the migrations' own; what each test seeds is the map, an open
//! period, and the documents under test.

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{
    self as cloud, CreateAdvanceRequest, CreateFacilityRequest, CreatePrincipalRequest,
    PayAdvanceRequest, PayInstallmentRequest, PrincipalMovementRequest, ScheduledInstallment,
    SettleAdvanceRequest,
};
use sqlx::PgPool;

const ACTOR: &str = "ana";
const SITE: &str = "dc";
/// The forty, and the category each meaning chooses with them. The client's own
/// code is on the right, because these tests are about their documents.
const CASH: &str = "1101"; // 1011001001 CASH ON HAND
const CASH_POT: &str = "DRAWER";
/// `1102 Bank`: which bank is `bank_account_id`, so no category.
const BANK: &str = "1102"; // 1011002001 Cash In Bank Giro Bank BCA
/// `1403 Uang muka` × `ADVANCED_TRAVELLING`, was `1011303001`.
const ADVANCE_ACCOUNT: &str = "1403";
const ADVANCE_PURPOSE: &str = "ADVANCED_TRAVELLING";
/// `6301` × `BIAYA_PERJALANAN_DINAS`, was `6010310008`.
const TRAVEL_EXPENSE: &str = "6301";
const TRAVEL_CATEGORY: &str = "BIAYA_PERJALANAN_DINAS";
/// `3101 Modal disetor` and `3102 Prive`, was `3013001001` and `3013001004`.
/// Which owner is the `principal` register, so neither takes a category.
const CAPITAL: &str = "3101";
const DRAWINGS: &str = "3102";
/// `2502 Pinjaman pemilik`, was `2022401001 Pinjaman Jangka Panjang Principal`.
const PRINCIPAL_LOAN: &str = "2502";
/// `2501 Pinjaman bank`, was `2022402001`, and `8101`, was `8020111001`. The
/// facility register carries the lender, so neither takes a category either.
const BANK_LOAN: &str = "2501";
const INTEREST: &str = "8101";

/// Bound with raw SQL rather than `set_account_mapping`, because what these
/// tests need is the map to exist and not the endpoint that writes it.
///
/// `category_code` is not optional to the DATABASE: 0288 installs
/// `account_map_category_fits` on this table for exactly this reason — a map
/// row with the wrong category is thousands of wrong journal lines, and it is
/// far cheaper to refuse here.
async fn map(pool: &PgPool, key: &str, qualifier: &str, code: &str, category: Option<&str>) {
    sqlx::query(
        "INSERT INTO account_map
           (semantic_key, site_id, qualifier, account_code, category_code, set_by)
         VALUES ($1,$2,$3,$4,$5,'test')
         ON CONFLICT (semantic_key, site_id, qualifier)
         DO UPDATE SET account_code = $4, category_code = $5",
    )
    .bind(key)
    .bind(SITE)
    .bind(qualifier)
    .bind(code)
    .bind(category)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("map {key}: {error}"));
}

/// Our own BCA giro account, described the way Bank Accounts describes one.
///
/// Phase 2's rule: pointing `bank_giro`/`BCA` at a ledger account is somebody
/// saying "our BCA giro money lives here", and posting into it then requires a
/// real account of ours to be registered against it. A test that skips this is
/// testing a database no shop could run.
async fn a_registered_bank_account(pool: &PgPool) {
    cloud::describe_account(
        pool,
        &cloud::DescribeBankAccountRequest {
            ledger_account_code: BANK.into(),
            site_id: SITE.into(),
            bank_code: Some("BCA".into()),
            bank_name: String::new(),
            account_no: "1234567890".into(),
            account_holder: "PT Itulah Busana Nusantara".into(),
            branch: None,
            kind: "GIRO".into(),
            is_primary: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("bank account: {error}"));
}

async fn ready(pool: &PgPool) {
    map(pool, "cash", "", CASH, Some(CASH_POT)).await;
    map(pool, "bank_giro", "BCA", BANK, None).await;
    map(
        pool,
        "advance",
        "PERJALANAN",
        ADVANCE_ACCOUNT,
        Some(ADVANCE_PURPOSE),
    )
    .await;
    map(pool, "capital_contributed", "", CAPITAL, None).await;
    map(pool, "owner_drawings", "", DRAWINGS, None).await;
    map(pool, "loan_principal", "PRINCIPAL", PRINCIPAL_LOAN, None).await;
    map(pool, "loan_principal", "BCA", BANK_LOAN, None).await;
    map(pool, "interest_expense", "", INTEREST, None).await;
    for month in 9..=12 {
        cloud::open_period(pool, 2026, month)
            .await
            .unwrap_or_else(|error| panic!("open 2026-{month}: {error}"));
    }
    a_registered_bank_account(pool).await;
}

async fn balance(pool: &PgPool, code: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(debit_minor - credit_minor),0)::bigint
           FROM journal_line WHERE account_code = $1",
    )
    .bind(code)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("balance {code}: {error}"))
}

fn day(day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, day).unwrap_or_default()
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_advance_is_paid_spent_and_partly_returned(pool: PgPool) {
    ready(&pool).await;
    let created = cloud::advance_create(
        &pool,
        &CreateAdvanceRequest {
            site_id: SITE.into(),
            party_kind: "OTHER".into(),
            employee_id: None,
            supplier_id: None,
            party_name: Some("Pak Budi".into()),
            purpose: "Perjalanan dinas ke Purbalingga".into(),
            amount_minor: 1_000_000,
            advance_qualifier: Some("PERJALANAN".into()),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("create: {error}"));
    assert_eq!(created.advance.status, "REQUESTED");
    assert_eq!(created.advance.outstanding_minor, 1_000_000);

    // Paying before approval is refused: the approval is the control.
    assert!(
        cloud::advance_pay(
            &pool,
            created.advance.advance_id,
            &PayAdvanceRequest {
                posting_date: day(1),
                cash_key: "cash".into(),
                cash_qualifier: String::new(),
            },
            ACTOR,
        )
        .await
        .is_err(),
        "an advance is paid after it is approved"
    );

    cloud::advance_approve(&pool, created.advance.advance_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("approve: {error}"));
    let paid = cloud::advance_pay(
        &pool,
        created.advance.advance_id,
        &PayAdvanceRequest {
            posting_date: day(1),
            cash_key: "cash".into(),
            cash_qualifier: String::new(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("pay: {error}"));
    assert_eq!(paid.advance.status, "PAID");
    assert_eq!(balance(&pool, ADVANCE_ACCOUNT).await, 1_000_000);
    assert_eq!(balance(&pool, CASH).await, -1_000_000);

    // Receipts for most of it.
    let settled = cloud::advance_settle(
        &pool,
        paid.advance.advance_id,
        &SettleAdvanceRequest {
            kind: "EXPENSE".into(),
            amount_minor: 700_000,
            posting_date: day(10),
            account_code: Some(TRAVEL_EXPENSE.into()),
            category_code: Some(TRAVEL_CATEGORY.into()),
            cash_key: None,
            cash_qualifier: String::new(),
            evidence: Some("nota".into()),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("settle: {error}"));
    assert_eq!(settled.advance.status, "PARTIALLY_SETTLED");
    assert_eq!(settled.advance.outstanding_minor, 300_000);
    assert_eq!(balance(&pool, TRAVEL_EXPENSE).await, 700_000);

    // Settling more than is out would take the asset below nothing.
    assert!(
        cloud::advance_settle(
            &pool,
            settled.advance.advance_id,
            &SettleAdvanceRequest {
                kind: "REFUND".into(),
                amount_minor: 500_000,
                posting_date: day(11),
                account_code: None,
                category_code: None,
                cash_key: Some("cash".into()),
                cash_qualifier: String::new(),
                evidence: None,
                note: None,
            },
            ACTOR,
        )
        .await
        .is_err(),
        "an advance cannot be settled below nothing"
    );

    // The change comes back.
    let done = cloud::advance_settle(
        &pool,
        settled.advance.advance_id,
        &SettleAdvanceRequest {
            kind: "REFUND".into(),
            amount_minor: 300_000,
            posting_date: day(11),
            account_code: None,
            category_code: None,
            cash_key: Some("cash".into()),
            cash_qualifier: String::new(),
            evidence: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("refund: {error}"));
    assert_eq!(done.advance.status, "SETTLED");
    assert_eq!(done.advance.outstanding_minor, 0);
    assert_eq!(
        balance(&pool, ADVANCE_ACCOUNT).await,
        0,
        "nothing is out with anybody any more"
    );
    assert_eq!(balance(&pool, CASH).await, -700_000, "the trip cost that");

    let control = cloud::advance_reconciliation(&pool)
        .await
        .unwrap_or_else(|error| panic!("control: {error}"));
    assert!(
        control.iter().all(|row| row.difference_minor == 0),
        "the subledger and the ledger agree: {control:?}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn capital_drawings_and_an_owners_loan_are_three_different_balances(pool: PgPool) {
    ready(&pool).await;
    let owner = cloud::principal_create(
        &pool,
        &CreatePrincipalRequest {
            code: "OWN1".into(),
            name: "Ibu Sari".into(),
            kind: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("create: {error}"));
    let id = owner.principal.principal_id;

    for (kind, amount, date) in [
        ("CONTRIBUTION", 50_000_000, day(1)),
        ("DRAWING", 5_000_000, day(5)),
        ("LOAN_IN", 20_000_000, day(10)),
        ("LOAN_REPAY", 4_000_000, day(20)),
    ] {
        cloud::principal_movement(
            &pool,
            &PrincipalMovementRequest {
                principal_id: id,
                site_id: SITE.into(),
                kind: kind.into(),
                amount_minor: amount,
                posting_date: date,
                cash_key: "bank_giro".into(),
                cash_qualifier: "BCA".into(),
                evidence: None,
                note: None,
            },
            ACTOR,
        )
        .await
        .unwrap_or_else(|error| panic!("{kind}: {error}"));
    }

    let after = cloud::principal_detail(&pool, id)
        .await
        .unwrap_or_else(|error| panic!("detail: {error}"));
    assert_eq!(after.principal.contributed_minor, 50_000_000);
    assert_eq!(after.principal.drawn_minor, 5_000_000);
    // Equity and the loan are two balances, never one.
    assert_eq!(after.principal.equity_minor, 45_000_000);
    assert_eq!(after.principal.loan_outstanding_minor, 16_000_000);
    assert_eq!(after.transactions.len(), 4);

    assert_eq!(balance(&pool, CAPITAL).await, -50_000_000, "credit balance");
    assert_eq!(balance(&pool, DRAWINGS).await, 5_000_000, "debit balance");
    assert_eq!(balance(&pool, PRINCIPAL_LOAN).await, -16_000_000);
    assert_eq!(balance(&pool, BANK).await, 61_000_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_instalment_splits_into_principal_and_interest(pool: PgPool) {
    ready(&pool).await;
    let facility = cloud::financing_facility_create(
        &pool,
        &CreateFacilityRequest {
            kind: "BANK_LOAN".into(),
            site_id: SITE.into(),
            principal_minor: 12_000_000,
            start_date: day(1),
            maturity_date: NaiveDate::from_ymd_opt(2026, 12, 1).unwrap_or_default(),
            bank_id: None,
            principal_id: None,
            lender_name: Some("Bank BCA".into()),
            rate_bps: Some(1_200),
            principal_qualifier: Some("BCA".into()),
            interest_qualifier: Some(String::new()),
            installments: vec![
                ScheduledInstallment {
                    due_date: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap_or_default(),
                    principal_minor: 4_000_000,
                    interest_minor: 120_000,
                },
                ScheduledInstallment {
                    due_date: NaiveDate::from_ymd_opt(2026, 11, 1).unwrap_or_default(),
                    principal_minor: 4_000_000,
                    interest_minor: 80_000,
                },
                ScheduledInstallment {
                    due_date: NaiveDate::from_ymd_opt(2026, 12, 1).unwrap_or_default(),
                    principal_minor: 4_000_000,
                    interest_minor: 40_000,
                },
            ],
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("facility: {error}"));
    assert_eq!(facility.installments.len(), 3);
    assert_eq!(facility.facility.outstanding_principal_minor, 12_000_000);

    let first = facility
        .installments
        .first()
        .unwrap_or_else(|| panic!("a schedule with no first instalment"));
    let after = cloud::financing_installment_pay(
        &pool,
        first.installment_id,
        &PayInstallmentRequest {
            posting_date: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap_or_default(),
            bank_key: "bank_giro".into(),
            bank_qualifier: "BCA".into(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("pay: {error}"));

    assert_eq!(after.facility.paid_principal_minor, 4_000_000);
    assert_eq!(after.facility.outstanding_principal_minor, 8_000_000);
    assert_eq!(after.facility.paid_interest_minor, 120_000);
    // The debt came down by the principal only; the interest is this period's
    // cost of the money and never touches it.
    assert_eq!(balance(&pool, BANK_LOAN).await, 4_000_000);
    assert_eq!(balance(&pool, INTEREST).await, 120_000);
    assert_eq!(balance(&pool, BANK).await, -4_120_000);

    // Paying the same instalment twice is refused.
    assert!(cloud::financing_installment_pay(
        &pool,
        first.installment_id,
        &PayInstallmentRequest {
            posting_date: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap_or_default(),
            bank_key: "bank_giro".into(),
            bank_qualifier: "BCA".into(),
        },
        ACTOR,
    )
    .await
    .is_err());
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_schedule_that_does_not_repay_the_loan_is_refused(pool: PgPool) {
    ready(&pool).await;
    let refused = cloud::financing_facility_create(
        &pool,
        &CreateFacilityRequest {
            kind: "BANK_LOAN".into(),
            site_id: SITE.into(),
            principal_minor: 10_000_000,
            start_date: day(1),
            maturity_date: NaiveDate::from_ymd_opt(2026, 12, 1).unwrap_or_default(),
            bank_id: None,
            principal_id: None,
            lender_name: Some("Bank BCA".into()),
            rate_bps: None,
            principal_qualifier: Some("BCA".into()),
            interest_qualifier: None,
            installments: vec![ScheduledInstallment {
                due_date: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap_or_default(),
                principal_minor: 4_000_000,
                interest_minor: 0,
            }],
            note: None,
        },
        ACTOR,
    )
    .await
    .err()
    .unwrap_or_else(|| panic!("a schedule that repays 4 of 10 must be refused"));
    assert!(refused.to_string().contains("repays"), "{refused}");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_control_panel_reads_every_domain_and_says_what_it_cannot(pool: PgPool) {
    ready(&pool).await;
    let controls = cloud::finance_controls(&pool, None)
        .await
        .unwrap_or_else(|error| panic!("controls: {error}"));

    for domain in [
        "PREPAID",
        "TAX_PAYABLE",
        "TAX_CREDIT",
        "ADVANCE",
        "FINANCING",
        "INTERUNIT",
    ] {
        assert!(
            controls.iter().any(|row| row.domain == domain),
            "{domain} has to appear in the control panel"
        );
    }
    let inventory = controls
        .iter()
        .find(|row| row.domain == "INVENTORY")
        .unwrap_or_else(|| panic!("inventory has to appear even though it cannot be read"));
    assert!(
        !inventory.covered,
        "stock has no cost method here, and the panel says so rather than showing a zero"
    );
    assert!(inventory.note.is_some());
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_balance_sheet_balances_after_a_days_worth_of_movements(pool: PgPool) {
    ready(&pool).await;
    let owner = cloud::principal_create(
        &pool,
        &CreatePrincipalRequest {
            code: "OWN1".into(),
            name: "Ibu Sari".into(),
            kind: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("owner: {error}"));
    cloud::principal_movement(
        &pool,
        &PrincipalMovementRequest {
            principal_id: owner.principal.principal_id,
            site_id: SITE.into(),
            kind: "CONTRIBUTION".into(),
            amount_minor: 30_000_000,
            posting_date: day(1),
            cash_key: "bank_giro".into(),
            cash_qualifier: "BCA".into(),
            evidence: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("contribution: {error}"));

    let sheet = cloud::balance_sheet(&pool, day(30), None)
        .await
        .unwrap_or_else(|error| panic!("balance sheet: {error}"));
    assert!(
        sheet.balanced,
        "assets {} liabilities {} equity {} result {} — difference {}",
        sheet.assets_minor,
        sheet.liabilities_minor,
        sheet.equity_minor,
        sheet.result_minor,
        sheet.difference_minor
    );
    assert_eq!(sheet.assets_minor, 30_000_000);
    assert_eq!(sheet.equity_minor, 30_000_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_month_with_blockers_does_not_close_without_a_reason(pool: PgPool) {
    ready(&pool).await;
    // A prepaid schedule whose month has not been allocated is a blocker, and
    // the cheapest one to make: a bill that posted, and a plan to consume it.
    let entry_id = uuid::Uuid::new_v4();
    let source_id = uuid::Uuid::new_v4().to_string();
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    sqlx::query(
        "INSERT INTO journal_entry
           (entry_id, entry_number, posting_date, source_kind, source_id, purpose,
            rule_version, total_minor, currency, memo, posted_by)
         VALUES ($1,$2,'2026-09-30','SUPPLIER_INVOICE',$3,'MAIN','bill/1',1200000,'IDR','x',$4)",
    )
    .bind(entry_id)
    .bind(format!("JV-{}", &entry_id.to_string()[..8]))
    .bind(&source_id)
    .bind(ACTOR)
    .execute(&mut *tx)
    .await
    .unwrap_or_else(|error| panic!("entry: {error}"));
    // `1401` declares `prepaid_kind` and `2101` declares nothing, so the raw
    // rows carry exactly what a posting through the map would have carried.
    for (index, (code, category, debit, credit)) in [
        ("1401", Some("ASURANSI_BAYAR_DIMUKA"), 1_200_000_i64, 0_i64),
        ("2101", None, 0, 1_200_000),
    ]
    .into_iter()
    .enumerate()
    {
        sqlx::query(
            "INSERT INTO journal_line
               (line_id, entry_id, line_number, account_code, site_id, category_code,
                debit_minor, credit_minor)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        )
        .bind(uuid::Uuid::new_v4())
        .bind(entry_id)
        .bind(index as i32 + 1)
        .bind(code)
        .bind(SITE)
        .bind(category)
        .bind(debit)
        .bind(credit)
        .execute(&mut *tx)
        .await
        .unwrap_or_else(|error| panic!("line: {error}"));
    }
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    map(
        &pool,
        "prepaid_expense",
        "",
        "1401",
        Some("ASURANSI_BAYAR_DIMUKA"),
    )
    .await;
    cloud::prepaid_schedule_create(
        &pool,
        &cloud::CreatePrepaidScheduleRequest {
            site_id: SITE.into(),
            prepaid_account_code: "1401".into(),
            prepaid_category_code: Some("ASURANSI_BAYAR_DIMUKA".into()),
            // `7010310001 Property All Risk & Fire Insurance` is `6301` now, and
            // the schedule has to remember WHICH expense — a year from now,
            // when it posts the last instalment, the account alone would say
            // only "general and administrative".
            expense_account_code: "6301".into(),
            expense_category_code: Some("PROPERTY_ALL_RISK_FIRE_INSURANCE".into()),
            source_kind: "SUPPLIER_INVOICE".into(),
            source_id,
            amount_minor: 1_200_000,
            start_period: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap_or_default(),
            end_period: NaiveDate::from_ymd_opt(2026, 12, 1).unwrap_or_default(),
            currency: None,
            memo: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("schedule: {error}"));

    let readiness = cloud::finance_close_readiness(&pool, 2026, 10)
        .await
        .unwrap_or_else(|error| panic!("readiness: {error}"));
    assert!(
        readiness.blockers > 0,
        "an unallocated prepaid month is a blocker: {:?}",
        readiness.checks
    );

    let refused = cloud::finance_close_month(&pool, 2026, 10, None, ACTOR)
        .await
        .err()
        .unwrap_or_else(|| panic!("a month with blockers must not close silently"));
    assert!(
        refused.to_string().contains("blockers"),
        "the refusal names them: {refused}"
    );

    // With a reason, it closes — and the reason stays on the period.
    let closed = cloud::finance_close_month(&pool, 2026, 10, Some("audit deadline"), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("forced close: {error}"));
    assert_eq!(closed.period_status, "CLOSED");
    let reason: Option<String> = sqlx::query_scalar(
        "SELECT closed_over_reason FROM fiscal_period WHERE year = 2026 AND month = 10",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("reason: {error}"));
    assert!(
        reason.unwrap_or_default().contains("audit deadline"),
        "the reason a month was closed over its blockers is kept"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_figure_can_be_followed_to_the_document_behind_it(pool: PgPool) {
    ready(&pool).await;
    let owner = cloud::principal_create(
        &pool,
        &CreatePrincipalRequest {
            code: "OWN1".into(),
            name: "Ibu Sari".into(),
            kind: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("owner: {error}"));
    cloud::principal_movement(
        &pool,
        &PrincipalMovementRequest {
            principal_id: owner.principal.principal_id,
            site_id: SITE.into(),
            kind: "CONTRIBUTION".into(),
            amount_minor: 10_000_000,
            posting_date: day(3),
            cash_key: "bank_giro".into(),
            cash_qualifier: "BCA".into(),
            evidence: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("contribution: {error}"));

    let trace = cloud::ledger_trace(&pool, CAPITAL, day(1), day(30), None, 50)
        .await
        .unwrap_or_else(|error| panic!("trace: {error}"));
    let line = trace
        .first()
        .unwrap_or_else(|| panic!("the capital account has a line to follow"));
    assert_eq!(line.credit_minor, 10_000_000);
    assert_eq!(line.source_kind, "EQUITY_MOVEMENT");
    assert_eq!(
        line.subledger.as_deref(),
        Some("principal_transaction"),
        "a reader following a figure is told which subledger holds its document"
    );
    assert!(line.source_id.is_some());
}
