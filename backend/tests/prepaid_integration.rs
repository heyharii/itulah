//! A prepayment, spread over the months it belongs to.
//!
//! Against a real Postgres, because most of what matters is enforced there: the
//! month cannot be allocated twice (a unique key), the schedule cannot name a
//! heading (a composite foreign key), and the entry has to balance (a deferred
//! trigger). A test with a stubbed database would prove the Rust agrees with
//! itself.

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{
    self as cloud, CreatePrepaidScheduleRequest, PrepaidAllocationRequest,
};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
const SITE: &str = "store-01";
/// `1011301001 Asuransi Bayar Dimuka` — the client's own prepaid insurance.
const PREPAID: &str = "1011301001";
/// `1011302004 Prepaid - VAT (PPN Masukan)` — a tax CREDIT, which this module
/// must refuse.
const PREPAID_TAX: &str = "1011302004";
/// `7010310001 Property All Risk & Fire Insurance` — where the months land.
const EXPENSE: &str = "7010310001";
const PAYABLE: &str = "2012001001";

async fn map(pool: &PgPool, key: &str, code: &str) {
    sqlx::query(
        "INSERT INTO account_map (semantic_key, site_id, qualifier, account_code, set_by)
         VALUES ($1,$2,'',$3,'test')
         ON CONFLICT (semantic_key, site_id, qualifier) DO UPDATE SET account_code = $3",
    )
    .bind(key)
    .bind(SITE)
    .bind(code)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("map {key}: {error}"));
}

async fn open_period(pool: &PgPool, year: i32, month: i32) {
    cloud::open_period(pool, year, month)
        .await
        .unwrap_or_else(|error| panic!("open {year}-{month}: {error}"));
}

/// The bill, as the bill posts it: `Dr prepaid / Cr supplier`.
///
/// Written straight into the journal rather than through the payables module,
/// for the reason `sales_posting_integration` gives: what is under test is the
/// schedule, and going through a second module would make every failure here
/// ambiguous.
async fn a_posted_bill(pool: &PgPool, amount_minor: i64) -> String {
    // The bill's own month. A journal entry lands in a period somebody opened,
    // which is 0051's rule and not this module's — the fixture has to obey it
    // the same way a bill would.
    let _ = cloud::open_period(pool, 2026, 9).await;
    let entry_id = Uuid::new_v4();
    let source_id = Uuid::new_v4().to_string();
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    sqlx::query(
        "INSERT INTO journal_entry
           (entry_id, entry_number, posting_date, source_kind, source_id, purpose,
            rule_version, total_minor, currency, memo, posted_by)
         VALUES ($1,$2,'2026-09-30','SUPPLIER_INVOICE',$3,'MAIN','bill/1',$4,'IDR',
                 'asuransi setahun',$5)",
    )
    .bind(entry_id)
    .bind(format!("JV-{}", &entry_id.to_string()[..8]))
    .bind(&source_id)
    .bind(amount_minor)
    .bind(ACTOR)
    .execute(&mut *tx)
    .await
    .unwrap_or_else(|error| panic!("bill entry: {error}"));
    for (index, (code, debit, credit)) in [(PREPAID, amount_minor, 0), (PAYABLE, 0, amount_minor)]
        .into_iter()
        .enumerate()
    {
        sqlx::query(
            "INSERT INTO journal_line
               (line_id, entry_id, line_number, account_code, site_id, debit_minor, credit_minor)
             VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(Uuid::new_v4())
        .bind(entry_id)
        .bind(index as i32 + 1)
        .bind(code)
        .bind(SITE)
        .bind(debit)
        .bind(credit)
        .execute(&mut *tx)
        .await
        .unwrap_or_else(|error| panic!("bill line on {code}: {error}"));
    }
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));
    source_id
}

fn ask(source_id: &str, amount_minor: i64) -> CreatePrepaidScheduleRequest {
    CreatePrepaidScheduleRequest {
        site_id: SITE.into(),
        prepaid_account_code: PREPAID.into(),
        expense_account_code: EXPENSE.into(),
        source_kind: "SUPPLIER_INVOICE".into(),
        source_id: source_id.into(),
        amount_minor,
        start_period: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap_or_default(),
        end_period: NaiveDate::from_ymd_opt(2027, 9, 1).unwrap_or_default(),
        currency: None,
        memo: Some("asuransi kebakaran setahun".into()),
    }
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

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_year_of_insurance_becomes_twelve_months_of_expense(pool: PgPool) {
    map(&pool, "prepaid_expense", PREPAID).await;
    for month in 10..=12 {
        open_period(&pool, 2026, month).await;
    }
    // 1,000,001 does not divide by twelve, which is the point.
    let amount = 1_000_001;
    let source_id = a_posted_bill(&pool, amount).await;

    let document = cloud::prepaid_schedule_create(&pool, &ask(&source_id, amount), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("create: {error}"));
    assert_eq!(document.schedule.periods, 12);
    assert_eq!(document.schedule.remaining_minor, amount);
    assert!(document.schedule.schedule_number.starts_with("PPD-"));

    // October and November, posted one at a time the way a month-end runs.
    let october = cloud::prepaid_allocate(
        &pool,
        &PrepaidAllocationRequest {
            year: 2026,
            month: 10,
            site_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("october: {error}"));
    assert_eq!(october.posted, 1);
    // The remainder lands at the front: 83,334 rather than 83,333.
    assert_eq!(october.amount_minor, 83_334);

    let replay = cloud::prepaid_allocate(
        &pool,
        &PrepaidAllocationRequest {
            year: 2026,
            month: 10,
            site_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("replay: {error}"));
    assert_eq!(replay.posted, 0, "a replayed month posts nothing");
    assert_eq!(replay.already_posted, 1, "and says it found it");

    cloud::prepaid_allocate(
        &pool,
        &PrepaidAllocationRequest {
            year: 2026,
            month: 11,
            site_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("november: {error}"));

    let after = cloud::prepaid_schedule_detail(&pool, document.schedule.schedule_id)
        .await
        .unwrap_or_else(|error| panic!("detail: {error}"));
    assert_eq!(after.allocations.len(), 2);
    assert_eq!(after.schedule.allocated_minor, 83_334 + 83_334);
    assert_eq!(
        after.schedule.remaining_minor,
        amount - 83_334 - 83_334,
        "what is left is counted from the allocations, not carried"
    );
    assert_eq!(after.schedule.status, "ACTIVE");

    // The ledger says the same thing from the other side.
    assert_eq!(balance(&pool, PREPAID).await, amount - 166_668);
    assert_eq!(balance(&pool, EXPENSE).await, 166_668);

    let control = cloud::prepaid_reconciliation(&pool, None)
        .await
        .unwrap_or_else(|error| panic!("reconciliation: {error}"));
    let row = control
        .iter()
        .find(|row| row.account_code == PREPAID && row.site_id == SITE)
        .unwrap_or_else(|| panic!("the control account has to appear: {control:?}"));
    assert_eq!(row.gl_minor, amount - 166_668);
    assert_eq!(row.subledger_minor, amount - 166_668);
    assert_eq!(row.difference_minor, 0, "the subledger IS the control");
    assert_eq!(row.open_schedules, 1);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_last_month_finishes_the_schedule_to_the_rupiah(pool: PgPool) {
    map(&pool, "prepaid_expense", PREPAID).await;
    let amount = 1_000_001;
    let source_id = a_posted_bill(&pool, amount).await;
    // A three-month schedule, so the whole life fits in a test.
    let mut request = ask(&source_id, amount);
    request.start_period = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap_or_default();
    request.end_period = NaiveDate::from_ymd_opt(2026, 12, 1).unwrap_or_default();
    for month in 10..=12 {
        open_period(&pool, 2026, month).await;
    }

    let document = cloud::prepaid_schedule_create(&pool, &request, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("create: {error}"));
    for month in 10..=12 {
        cloud::prepaid_allocate(
            &pool,
            &PrepaidAllocationRequest {
                year: 2026,
                month,
                site_id: None,
            },
            ACTOR,
        )
        .await
        .unwrap_or_else(|error| panic!("month {month}: {error}"));
    }

    let after = cloud::prepaid_schedule_detail(&pool, document.schedule.schedule_id)
        .await
        .unwrap_or_else(|error| panic!("detail: {error}"));
    assert_eq!(
        after.schedule.allocated_minor, amount,
        "the months add up to the schedule exactly"
    );
    assert_eq!(after.schedule.remaining_minor, 0);
    assert_eq!(
        after.schedule.status, "COMPLETED",
        "a schedule with nothing left to give is finished"
    );
    assert_eq!(balance(&pool, PREPAID).await, 0);
    assert_eq!(balance(&pool, EXPENSE).await, amount);

    // And a run after that finds nothing to do rather than posting a thirteenth.
    let extra = cloud::prepaid_allocate(
        &pool,
        &PrepaidAllocationRequest {
            year: 2027,
            month: 1,
            site_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("january: {error}"));
    assert_eq!(extra.posted, 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_tax_credit_is_not_a_prepayment(pool: PgPool) {
    // `vat_in` is where `1011302004` belongs, and this module refuses it: a tax
    // credit is reclaimed on a return, not amortised over months.
    map(&pool, "vat_in", PREPAID_TAX).await;
    map(&pool, "prepaid_expense", PREPAID).await;
    let amount = 600_000;
    let source_id = a_posted_bill(&pool, amount).await;

    let mut request = ask(&source_id, amount);
    request.prepaid_account_code = PREPAID_TAX.into();
    let refused = cloud::prepaid_schedule_create(&pool, &request, ACTOR)
        .await
        .err()
        .unwrap_or_else(|| panic!("a tax credit must not become a prepaid schedule"));
    let said = refused.to_string();
    assert!(said.contains(PREPAID_TAX), "name the account: {said}");
    assert!(
        said.contains("prepaid_expense"),
        "and say what would have made it valid: {said}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_schedule_needs_a_document_that_has_already_posted(pool: PgPool) {
    map(&pool, "prepaid_expense", PREPAID).await;
    let refused =
        cloud::prepaid_schedule_create(&pool, &ask(&Uuid::new_v4().to_string(), 120_000), ACTOR)
            .await
            .err()
            .unwrap_or_else(|| panic!("a schedule over nothing must be refused"));
    assert!(
        refused.to_string().contains("post the document first"),
        "{refused}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_months_it_already_took_survive_cancelling(pool: PgPool) {
    map(&pool, "prepaid_expense", PREPAID).await;
    open_period(&pool, 2026, 10).await;
    let amount = 1_200_000;
    let source_id = a_posted_bill(&pool, amount).await;
    let document = cloud::prepaid_schedule_create(&pool, &ask(&source_id, amount), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("create: {error}"));
    cloud::prepaid_allocate(
        &pool,
        &PrepaidAllocationRequest {
            year: 2026,
            month: 10,
            site_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("october: {error}"));

    let stopped = cloud::prepaid_schedule_cancel(
        &pool,
        document.schedule.schedule_id,
        "polis dibatalkan",
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("cancel: {error}"));
    assert_eq!(stopped.schedule.status, "CANCELLED");
    assert_eq!(stopped.allocations.len(), 1, "what was consumed stays");
    assert_eq!(balance(&pool, EXPENSE).await, 100_000);

    // And it takes no more months.
    let after = cloud::prepaid_allocate(
        &pool,
        &PrepaidAllocationRequest {
            year: 2026,
            month: 11,
            site_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("november: {error}"));
    assert_eq!(after.posted, 0);

    // A cancelled schedule leaves the ledger holding the rest, which is a real
    // balance somebody now has to decide about — so the control account shows
    // it as a difference rather than hiding it.
    let control = cloud::prepaid_reconciliation(&pool, None)
        .await
        .unwrap_or_else(|error| panic!("reconciliation: {error}"));
    let row = control
        .iter()
        .find(|row| row.account_code == PREPAID)
        .unwrap_or_else(|| panic!("the control account has to appear"));
    assert_eq!(row.gl_minor, amount - 100_000);
    assert_eq!(
        row.subledger_minor, 0,
        "no open schedule claims it any more"
    );
    assert_eq!(row.difference_minor, amount - 100_000);
}
