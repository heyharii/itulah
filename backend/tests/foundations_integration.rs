//! The backend foundations of 28 Sep 2026, against a real database:
//!
//! * unit scope follows the job role (0700);
//! * document numbers follow an editable, gapless series (0701);
//! * a master record keeps every change, field by field (0702);
//! * a background job keeps its runs, takes requests and can be paused (0703);
//! * a supplier bill can be settled with a discount (0704);
//! * a cleared giro can be un-cleared, bounced after clearing, and replaced
//!   (0705).

use chrono::NaiveDate;
use inventory_backend::cloud::domain::{Reach, RecordKind, Role};
use inventory_backend::cloud::postgres::{self as cloud, jobs, number_series};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
const STORE: &str = "store-01";
const HO: &str = "ho";

fn day() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, 15).unwrap_or_else(|| panic!("bad date"))
}

fn later(days: u64) -> NaiveDate {
    day()
        .checked_add_days(chrono::Days::new(days))
        .unwrap_or_else(|| panic!("bad date"))
}

async fn open_september(pool: &PgPool) {
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error:?}"));
}

async fn bank_account(pool: &PgPool, ledger: &str, unit: &str, bank: &str, number: &str) {
    cloud::describe_account(
        pool,
        &cloud::DescribeBankAccountRequest {
            ledger_account_code: ledger.into(),
            unit_id: unit.into(),
            bank_code: Some(bank.into()),
            bank_name: String::new(),
            account_no: number.into(),
            account_holder: "PT Contoh".into(),
            branch: None,
            kind: "GIRO".into(),
            is_primary: Some(true),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("bank account {ledger} at {unit}: {error:?}"));
}

async fn bill(pool: &PgPool, number: &str, amount: i64) -> Uuid {
    // Head office's premises, not its unit: a bill is received at a site.
    let head_office_site = cloud::sites::head_office_site_id(pool)
        .await
        .unwrap_or_else(|error| panic!("head office's site: {error:?}"));
    let invoice_id = cloud::record_bill(
        pool,
        &cloud::RecordBillRequest {
            invoice_number: number.into(),
            supplier_id: "SUP-FOUND".into(),
            supplier_name: Some("PT Kain Jaya".into()),
            site_id: head_office_site,
            invoice_date: day(),
            due_date: Some(day()),
            subtotal_minor: amount,
            tax_minor: 0,
            discount_minor: 0,
            note: None,
            kind: Some("MERCHANDISE".into()),
            lines: None,
            receipt_ids: None,
            matching: None,
            withholding_code: None,
            submitted_by_domain: None,
            document_ref: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("bill {number}: {error:?}"))
    .invoice_id;
    // Only a posted bill is owed (0084).
    cloud::post_bill(pool, invoice_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post bill {number}: {error:?}"));
    invoice_id
}

/// (unit, account_code, debit_minor, credit_minor) per line, in line order.
async fn lines_of(pool: &PgPool, entry: Uuid) -> Vec<(String, String, i64, i64)> {
    sqlx::query(
        "SELECT unit_id, account_code, debit_minor, credit_minor
           FROM journal_line WHERE entry_id = $1 ORDER BY line_number",
    )
    .bind(entry)
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("lines: {error:?}"))
    .into_iter()
    .map(|row| {
        (
            row.get::<String, _>("unit_id"),
            row.get::<String, _>("account_code"),
            row.get::<i64, _>("debit_minor"),
            row.get::<i64, _>("credit_minor"),
        )
    })
    .collect()
}

// 0700 ----------------------------------------------------------------------

/// Head office's departments reach every unit; a store's roles reach their
/// own. The section gate still decides what either may open.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_head_office_role_reaches_every_unit_and_a_store_role_its_own(pool: PgPool) {
    let reach: Vec<(String, String)> =
        sqlx::query("SELECT code, unit_reach FROM job_role ORDER BY code")
            .fetch_all(&pool)
            .await
            .unwrap_or_else(|error| panic!("roles: {error:?}"))
            .into_iter()
            .map(|row| (row.get("code"), row.get("unit_reach")))
            .collect();
    let of = |code: &str| {
        reach
            .iter()
            .find(|(role, _)| role == code)
            .map(|(_, reach)| reach.clone())
            .unwrap_or_else(|| panic!("no role {code}"))
    };
    assert_eq!(of("FINANCE"), "EVERY");
    assert_eq!(of("HR"), "EVERY");
    assert_eq!(of("STORE_MANAGER"), "OWN");
    assert_eq!(of("CASHIER"), "OWN");

    let finance = inventory_backend::cloud::domain::job_role::JobGrant::from_stored(
        "FINANCE".into(),
        "Finance".into(),
        &[],
        vec!["finance".into()],
        false,
        "EVERY",
    );
    assert!(finance.every_unit);
    assert_eq!(
        Reach::resolve_for(Role::Supervisor, finance.every_unit, None),
        Reach::Everywhere,
        "a finance supervisor reaches every unit even with no posting"
    );

    let refused = sqlx::query("UPDATE job_role SET unit_reach = 'OWN' WHERE code = 'ADMIN'")
        .execute(&pool)
        .await;
    assert!(refused.is_err(), "ADMIN always reaches every unit");
}

// 0701 ----------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_number_series_is_gapless_editable_and_never_repeats(pool: PgPool) {
    // A number taken inside a transaction that rolls back is taken back.
    let mut tx = pool.begin().await.unwrap_or_else(|e| panic!("{e}"));
    let first = number_series::next_number(&mut tx, number_series::CORRECTION, day(), None)
        .await
        .unwrap_or_else(|error| panic!("first: {error:?}"));
    tx.rollback().await.unwrap_or_else(|e| panic!("{e}"));
    let mut tx = pool.begin().await.unwrap_or_else(|e| panic!("{e}"));
    let again = number_series::next_number(&mut tx, number_series::CORRECTION, day(), None)
        .await
        .unwrap_or_else(|error| panic!("again: {error:?}"));
    tx.commit().await.unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(first, again, "a rolled-back number is issued again");
    assert!(
        first.starts_with("COR-"),
        "the seeded pattern spells COR-: {first}"
    );

    // A monthly series must print its month.
    let refused = number_series::put_number_series(
        &pool,
        number_series::STORE_EXPENSE,
        number_series::NumberSeriesPatch {
            pattern: Some("{UNIT}-BKK-{YY}-{#####}".into()),
            reset: None,
        },
        ACTOR,
        day(),
    )
    .await;
    assert!(
        refused.is_err(),
        "a monthly series without {{MM}} would repeat"
    );

    // A kind whose documents name no unit cannot print one.
    let refused = number_series::put_number_series(
        &pool,
        number_series::CORRECTION,
        number_series::NumberSeriesPatch {
            pattern: Some("{UNIT}-COR-{#####}".into()),
            reset: None,
        },
        ACTOR,
        day(),
    )
    .await;
    assert!(refused.is_err(), "a correction belongs to no single unit");

    // The client's own spelling, per unit.
    number_series::put_number_series(
        &pool,
        number_series::STORE_EXPENSE,
        number_series::NumberSeriesPatch {
            pattern: Some("{UNIT}-BKK-{YY}-{MM}-{#####}".into()),
            reset: Some("MONTHLY".into()),
        },
        ACTOR,
        day(),
    )
    .await
    .unwrap_or_else(|error| panic!("the client's pattern: {error:?}"));
    let code: String = sqlx::query_scalar("SELECT code FROM unit WHERE id = $1")
        .bind(STORE)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("unit code: {error:?}"));
    let mut connection = pool.acquire().await.unwrap_or_else(|e| panic!("{e}"));
    let one = number_series::next_number(
        &mut connection,
        number_series::STORE_EXPENSE,
        day(),
        Some(STORE),
    )
    .await
    .unwrap_or_else(|error| panic!("per unit: {error:?}"));
    let two = number_series::next_number(
        &mut connection,
        number_series::STORE_EXPENSE,
        day(),
        Some(STORE),
    )
    .await
    .unwrap_or_else(|error| panic!("per unit again: {error:?}"));
    assert_eq!(one, format!("{code}-BKK-26-09-00001"));
    assert_eq!(two, format!("{code}-BKK-26-09-00002"));
    let october = number_series::next_number(
        &mut connection,
        number_series::STORE_EXPENSE,
        later(20),
        Some(STORE),
    )
    .await
    .unwrap_or_else(|error| panic!("next month: {error:?}"));
    assert_eq!(
        october,
        format!("{code}-BKK-26-10-00001"),
        "a monthly series restarts"
    );

    // Back to the old pattern: its counter resumes rather than restarting.
    let before: i64 = sqlx::query_scalar(
        "SELECT COALESCE(max(last_value), 0) FROM number_series_counter
          WHERE document_kind = 'STORE_EXPENSE' AND pattern = 'KK-{UNIT}-{YY}-{MM}-{#####}'
            AND scope_key = $1 AND period_key = '2026-09'",
    )
    .bind(STORE)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("old counter: {error:?}"));
    number_series::put_number_series(
        &pool,
        number_series::STORE_EXPENSE,
        number_series::NumberSeriesPatch {
            pattern: Some("KK-{UNIT}-{YY}-{MM}-{#####}".into()),
            reset: None,
        },
        ACTOR,
        day(),
    )
    .await
    .unwrap_or_else(|error| panic!("back to the old pattern: {error:?}"));
    let resumed = number_series::next_number(
        &mut connection,
        number_series::STORE_EXPENSE,
        day(),
        Some(STORE),
    )
    .await
    .unwrap_or_else(|error| panic!("resumed: {error:?}"));
    assert_eq!(resumed, format!("KK-{code}-26-09-{:05}", before + 1));
}

// 0702 ----------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_master_record_keeps_every_change_field_by_field(pool: PgPool) {
    let name: String = sqlx::query_scalar("SELECT name FROM unit WHERE id = $1")
        .bind(STORE)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("unit: {error:?}"));
    sqlx::query("UPDATE unit SET name = $2, updated_at = now() WHERE id = $1")
        .bind(STORE)
        .bind(format!("{name} Baru"))
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("rename: {error:?}"));
    // Touching only the bookkeeping writes nothing.
    sqlx::query("UPDATE unit SET updated_at = now() WHERE id = $1")
        .bind(STORE)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("touch: {error:?}"));

    let versions = cloud::list_record_versions(&pool, RecordKind::Unit, STORE, 50)
        .await
        .unwrap_or_else(|error| panic!("versions: {error:?}"));
    assert_eq!(versions.len(), 1, "one change, one version: {versions:?}");
    let change = &versions[0];
    assert_eq!(change.operation, "UPDATE");
    assert_eq!(change.table_name, "unit");
    assert_eq!(change.changes.len(), 1, "only the name moved: {change:?}");
    assert_eq!(change.changes[0].field, "name");
    assert_eq!(change.changes[0].from, serde_json::json!(name));
    assert_eq!(
        change.changes[0].to,
        serde_json::json!(format!("{name} Baru"))
    );

    let edited = sqlx::query("UPDATE record_version SET actor = 'someone else'")
        .execute(&pool)
        .await;
    assert!(edited.is_err(), "the history cannot be rewritten");
}

// 0703 ----------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_job_keeps_its_runs_takes_requests_and_can_be_paused(pool: PgPool) {
    jobs::register_job(&pool, "test.job", "Test job", Some(60))
        .await
        .unwrap_or_else(|error| panic!("register: {error:?}"));

    // An idle pass is a heartbeat, not a run row.
    let started = jobs::database_now(&pool)
        .await
        .unwrap_or_else(|error| panic!("now: {error:?}"));
    let nothing = serde_json::json!({});
    jobs::finish_run(
        &pool,
        jobs::FinishedRun {
            job: "test.job",
            trigger: "SCHEDULE",
            requested_by: None,
            attempt: 1,
            started_at: started,
            did: 0,
            problems: &[],
            notes: &nothing,
        },
    )
    .await
    .unwrap_or_else(|error| panic!("idle pass: {error:?}"));
    assert!(jobs::job_runs(&pool, "test.job", 10)
        .await
        .unwrap_or_else(|error| panic!("runs: {error:?}"))
        .is_empty());

    // A failing pass is kept, with what it could not do.
    let problems = vec!["goods receipt GRN-1 awaits correction: unmapped account".to_owned()];
    jobs::finish_run(
        &pool,
        jobs::FinishedRun {
            job: "test.job",
            trigger: "SCHEDULE",
            requested_by: None,
            attempt: 1,
            started_at: started,
            did: 0,
            problems: &problems,
            notes: &nothing,
        },
    )
    .await
    .unwrap_or_else(|error| panic!("failed pass: {error:?}"));
    let runs = jobs::job_runs(&pool, "test.job", 10)
        .await
        .unwrap_or_else(|error| panic!("runs: {error:?}"));
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].status, "FAILED");
    assert_eq!(runs[0].problems, problems);
    let listed = jobs::list_jobs(&pool)
        .await
        .unwrap_or_else(|error| panic!("list: {error:?}"));
    let status = listed
        .items
        .iter()
        .find(|job| job.job == "test.job")
        .unwrap_or_else(|| panic!("the job is listed"));
    assert_eq!(status.consecutive_failures, 1);
    assert!(status.last_error.is_some());

    // Run now: asked by a person, taken once by the runtime.
    jobs::request_job_run(&pool, "test.job", ACTOR)
        .await
        .unwrap_or_else(|error| panic!("request: {error:?}"));
    assert_eq!(
        jobs::take_run_request(&pool, "test.job")
            .await
            .unwrap_or_else(|error| panic!("take: {error:?}")),
        Some(ACTOR.to_owned())
    );
    assert_eq!(
        jobs::take_run_request(&pool, "test.job")
            .await
            .unwrap_or_else(|error| panic!("take again: {error:?}")),
        None,
        "a request is taken once"
    );

    // Pause and resume.
    jobs::set_job_paused(&pool, "test.job", true, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("pause: {error:?}"));
    assert!(jobs::job_paused(&pool, "test.job")
        .await
        .unwrap_or_else(|error| panic!("paused: {error:?}")));
    jobs::set_job_paused(&pool, "test.job", false, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("resume: {error:?}"));
    assert!(!jobs::job_paused(&pool, "test.job")
        .await
        .unwrap_or_else(|error| panic!("resumed: {error:?}")));

    // Only one server holds a job at a time.
    let held = jobs::try_lock_job(&pool, "test.job")
        .await
        .unwrap_or_else(|error| panic!("lock: {error:?}"))
        .unwrap_or_else(|| panic!("the first lock is taken"));
    assert!(jobs::try_lock_job(&pool, "test.job")
        .await
        .unwrap_or_else(|error| panic!("second lock: {error:?}"))
        .is_none());
    jobs::unlock_job(held, "test.job")
        .await
        .unwrap_or_else(|error| panic!("unlock: {error:?}"));
}

// 0704 ----------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_bill_settled_with_a_discount_is_settled_and_books_the_potongan(pool: PgPool) {
    open_september(&pool).await;
    bank_account(&pool, "1005", STORE, "BCA", "8880054321").await;
    let invoice_id = bill(&pool, "INV-POT-01", 1_000_000).await;

    let recorded = cloud::record_payment(
        &pool,
        &cloud::RecordPaymentRequest {
            unit_id: STORE.into(),
            payment_date: day(),
            method: "TRANSFER".into(),
            account_key: "bank_giro".into(),
            account_qualifier: "BCA".into(),
            total_minor: Some(1_000_000),
            reference: None,
            note: None,
            allocations: vec![cloud::AllocateToBill {
                invoice_id,
                amount_minor: 1_000_000,
                discount_minor: Some(20_000),
            }],
            giro_number: None,
            giro_due_date: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("a discounted payment records: {error:?}"));
    let posted = cloud::post_payment(&pool, recorded.payment_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("a discounted payment posts: {error:?}"));
    let entry = posted
        .journal_entry_id
        .unwrap_or_else(|| panic!("a posted payment has an entry"));
    let lines = lines_of(&pool, entry).await;

    assert!(
        lines.contains(&(HO.into(), "2002".into(), 1_000_000, 0)),
        "the whole bill is cleared from the payable: {lines:?}"
    );
    assert!(
        lines.contains(&(STORE.into(), "1005".into(), 0, 980_000)),
        "the bank pays what is left after the potongan: {lines:?}"
    );
    assert!(
        lines.contains(&(HO.into(), "8004".into(), 0, 20_000)),
        "the potongan is Potongan Pembelian, beside the payable: {lines:?}"
    );

    // Settled: not one more rupiah may be paid against it.
    let overpaid = cloud::record_payment(
        &pool,
        &cloud::RecordPaymentRequest {
            unit_id: STORE.into(),
            payment_date: day(),
            method: "TRANSFER".into(),
            account_key: "bank_giro".into(),
            account_qualifier: "BCA".into(),
            total_minor: Some(1),
            reference: None,
            note: None,
            allocations: vec![cloud::AllocateToBill {
                invoice_id,
                amount_minor: 1,
                discount_minor: None,
            }],
            giro_number: None,
            giro_due_date: None,
        },
        ACTOR,
    )
    .await;
    assert!(overpaid.is_err(), "the bill is settled by the whole amount");

    // A discount larger than the line is refused.
    let too_much = cloud::record_payment(
        &pool,
        &cloud::RecordPaymentRequest {
            unit_id: STORE.into(),
            payment_date: day(),
            method: "TRANSFER".into(),
            account_key: "bank_giro".into(),
            account_qualifier: "BCA".into(),
            total_minor: None,
            reference: None,
            note: None,
            allocations: vec![cloud::AllocateToBill {
                invoice_id: bill(&pool, "INV-POT-02", 500_000).await,
                amount_minor: 100_000,
                discount_minor: Some(100_001),
            }],
            giro_number: None,
            giro_due_date: None,
        },
        ACTOR,
    )
    .await;
    assert!(too_much.is_err());
}

// 0705 ----------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_giro_clearing_can_be_taken_back_bounced_after_and_replaced(pool: PgPool) {
    open_september(&pool).await;
    bank_account(&pool, "1005", STORE, "BCA", "8880054321").await;
    let invoice_id = bill(&pool, "INV-BG-01", 400_000).await;

    let pay_by_giro = |number: &'static str| cloud::RecordPaymentRequest {
        unit_id: STORE.into(),
        payment_date: day(),
        method: "GIRO".into(),
        account_key: "bank_giro".into(),
        account_qualifier: "BCA".into(),
        total_minor: Some(400_000),
        reference: None,
        note: None,
        allocations: vec![cloud::AllocateToBill {
            invoice_id,
            amount_minor: 400_000,
            discount_minor: None,
        }],
        giro_number: Some(number.into()),
        giro_due_date: Some(later(10)),
    };
    let recorded = cloud::record_payment(&pool, &pay_by_giro("BCA-100001"), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("giro payment records: {error:?}"));
    cloud::post_payment(&pool, recorded.payment_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("giro payment posts: {error:?}"));
    let giro_id: Uuid =
        sqlx::query_scalar("SELECT giro_id FROM giro WHERE supplier_payment_id = $1")
            .bind(recorded.payment_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("the giro exists: {error:?}"));

    // Cleared, then taken back: Batal Cair.
    let cleared = cloud::giro_clear(&pool, giro_id, later(10), None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("clear: {error:?}"));
    let clearing = cleared
        .clearing_entry_id
        .unwrap_or_else(|| panic!("a cleared giro names its entry"));
    let uncleared = cloud::giro_unclear(&pool, giro_id, later(11), "cleared a day early", ACTOR)
        .await
        .unwrap_or_else(|error| panic!("unclear: {error:?}"));
    assert_eq!(uncleared.status, "DUE");
    assert_eq!(uncleared.clearing_entry_id, None);
    assert_eq!(uncleared.times_uncleared, 1);
    let reversed: i64 =
        sqlx::query_scalar("SELECT count(*)::bigint FROM journal_entry WHERE reversal_of = $1")
            .bind(clearing)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("reversal: {error:?}"));
    assert_eq!(reversed, 1, "the clearing is reversed, not deleted");

    // Cleared properly, then returned unpaid: Tolak after Cair.
    cloud::giro_clear(&pool, giro_id, later(12), None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("clear again: {error:?}"));
    let bounced = cloud::giro_reject(&pool, giro_id, later(14), "drawer's bank refused", ACTOR)
        .await
        .unwrap_or_else(|error| panic!("bounce after clearing: {error:?}"));
    assert_eq!(bounced.status, "REJECTED");
    assert_eq!(bounced.times_uncleared, 2);
    let payment_status: String =
        sqlx::query_scalar("SELECT status FROM supplier_payment WHERE payment_id = $1")
            .bind(recorded.payment_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("payment status: {error:?}"));
    assert_eq!(payment_status, "REVERSED", "the bill is owed again");

    // A settled giro is still settled: a rejected one cannot be un-cleared.
    assert!(cloud::giro_unclear(&pool, giro_id, later(15), "no", ACTOR)
        .await
        .is_err());

    // What replaced it.
    let replacement = cloud::record_payment(&pool, &pay_by_giro("BCA-100002"), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("replacement records: {error:?}"));
    cloud::post_payment(&pool, replacement.payment_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("replacement posts: {error:?}"));
    let replaced = cloud::giro_replace(
        &pool,
        giro_id,
        &cloud::ReplaceGiroRequest {
            payment_id: Some(replacement.payment_id),
            cash_document_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("replace: {error:?}"));
    assert_eq!(
        replaced.replaced_by_payment_id,
        Some(replacement.payment_id)
    );
    assert!(
        cloud::giro_replace(
            &pool,
            giro_id,
            &cloud::ReplaceGiroRequest {
                payment_id: Some(replacement.payment_id),
                cash_document_id: None,
            },
            ACTOR,
        )
        .await
        .is_err(),
        "a giro is replaced once"
    );
}
