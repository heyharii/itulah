//! The ledger's invariants, proved against a real Postgres.
//!
//! Everything asserted here is enforced by the database rather than by Rust,
//! and that is the point of testing it this way. Application validation is
//! where a rule lives until somebody opens psql, writes a migration, or adds a
//! second writer. A general ledger that can be left unbalanced by any of those
//! is not a ledger, so several of these tests reach past the poster entirely and
//! insert raw SQL — if the guarantee only holds when you go through the front
//! door, it is not a guarantee.

use chrono::NaiveDate;
use inventory_backend::cloud::application::AppError;
use inventory_backend::cloud::postgres::{self as cloud, LineAccount, PostingIntent, PostingLine};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";

/// The chart is not seeded here any more.
///
/// It used to be: twenty rows shaped like the client's, with postable leaves
/// carrying a unit suffix and a `site_id`. Since 0243 the migrations write the
/// client's own chart, and 0244 collapsed the fourteen unit-suffixed copies of
/// each account into one — `ledger_account` may no longer name a unit at all,
/// and `101120100100 Persediaan Barang Dagangan HO` is now `1011201001
/// Persediaan Barang Dagangan` with the unit carried by `journal_line.site_id`.
/// The ladder this file cares about (a balance rolls up by prefix, through
/// every intermediate rung) is the real chart's, which is deeper than the
/// fixture's was.

async fn open_september(pool: &PgPool) {
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
}

async fn map(pool: &PgPool, key: &str, code: &str) {
    cloud::set_account_mapping(
        pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: key.into(),
            site_id: "ho".into(),
            qualifier: String::new(),
            account_code: code.into(),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("map {key}: {error}"));
}

/// What the browser will actually be told.
///
/// `AppError::Database` renders as a flat "database operation failed" on
/// purpose — a database error is not something to hand a stranger. But
/// `into_response` makes one exception: SQLSTATE P0001 is a trigger's
/// `RAISE EXCEPTION`, which is a business rule rather than a server fault, so
/// its message goes through verbatim as a 409.
///
/// Asserting on `to_string()` would therefore test the wrong surface and pass
/// or fail for reasons unrelated to what anybody reads. This reads the same
/// field that path reads.
fn as_shown_to_a_person(error: &AppError) -> String {
    match error {
        AppError::Database(sqlx::Error::Database(db)) if db.code().as_deref() == Some("P0001") => {
            db.message().to_string()
        }
        other => other.to_string(),
    }
}

fn september(day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, day).unwrap_or_else(|| panic!("bad date"))
}

fn bill(amount: i64) -> PostingIntent {
    PostingIntent {
        posting_date: september(1),
        source_kind: "SUPPLIER_INVOICE".into(),
        source_id: Some("INV-1".into()),
        rule_version: "supplier_invoice/1".into(),
        currency: "IDR".into(),
        memo: Some("Faktur pemasok".into()),
        lines: vec![
            PostingLine::debit("inventory", "ho", amount),
            PostingLine::credit("trade_payable", "ho", amount).for_supplier("SUP01"),
        ],
    }
}

/// One posted bill, for the tests that need the ledger to have moved.
async fn post_a_bill(pool: &PgPool) {
    map(pool, "inventory", "1011201001").await;
    map(pool, "trade_payable", "2012001001").await;
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    cloud::post(&mut tx, &bill(8_600_000), None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_meaning_with_no_account_refuses_and_says_which(pool: PgPool) {
    open_september(&pool).await;
    // Only one of the two meanings is mapped, so the entry cannot be completed.
    map(&pool, "inventory", "1011201001").await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let refusal = cloud::post(&mut tx, &bill(8_600_000), None, ACTOR).await;

    let message = match refusal {
        Ok(posted) => panic!(
            "posted {} with a meaning nobody mapped",
            posted.entry_number
        ),
        Err(error) => error.to_string(),
    };
    // The message has to name the key, because the fix is to go and map that
    // key. "Posting failed" would send somebody to read source code.
    assert!(
        message.contains("trade_payable"),
        "the refusal should name the unmapped key, said: {message}"
    );
    assert!(
        message.contains("ho"),
        "the refusal should name the location, said: {message}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_bill_posts_and_the_trial_balance_balances(pool: PgPool) {
    open_september(&pool).await;
    map(&pool, "inventory", "1011201001").await;
    map(&pool, "trade_payable", "2012001001").await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posted = cloud::post(&mut tx, &bill(8_600_000), None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    assert_eq!(posted.total_minor, 8_600_000);

    let balance = cloud::trial_balance(
        &pool,
        cloud::TrialBalanceScope {
            as_of: Some(september(30)),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("trial balance: {error}"));
    assert!(balance.balanced, "debits and credits should agree");
    assert_eq!(balance.total_debit_minor, 8_600_000);
    assert_eq!(balance.rows.len(), 2);

    // A heading's balance is its descendants', found by prefix on the code —
    // which is the whole reason the client's chart is a tree written in digits.
    let asset = cloud::account_balance(&pool, "1", None, None)
        .await
        .unwrap_or_else(|error| panic!("asset balance: {error}"));
    assert_eq!(asset.balance_minor, 8_600_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_unbalanced_entry_is_refused_by_the_database(pool: PgPool) {
    open_september(&pool).await;

    // Straight past the poster: raw SQL, inside one transaction, exactly as a
    // careless migration or a second writer would do it.
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let entry = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO journal_entry (entry_id, entry_number, posting_date, source_kind,
             source_id, rule_version, total_minor, currency, posted_by)
         VALUES ($1,'JV-RAW','2026-09-01','MANUAL',NULL,'raw/1',5000,'IDR','psql')",
    )
    .bind(entry)
    .execute(&mut *tx)
    .await
    .unwrap_or_else(|error| panic!("header: {error}"));
    for (line, code, debit, credit) in [
        (1, "1011201001", 5000_i64, 0_i64),
        (2, "2012001001", 0, 4000),
    ] {
        sqlx::query(
            "INSERT INTO journal_line (line_id, entry_id, line_number, account_code, site_id,
                 debit_minor, credit_minor) VALUES ($1,$2,$3,$4,'ho',$5,$6)",
        )
        .bind(Uuid::new_v4())
        .bind(entry)
        .bind(line)
        .bind(code)
        .bind(debit)
        .bind(credit)
        .execute(&mut *tx)
        .await
        .unwrap_or_else(|error| panic!("line: {error}"));
    }

    // The trigger is deferred, so this is the moment it fires.
    let outcome = tx.commit().await;
    let message = match outcome {
        Ok(()) => panic!("Postgres committed an unbalanced journal entry"),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains("does not balance"),
        "expected the balance trigger, got: {message}"
    );

    let count: i64 = sqlx::query("SELECT COUNT(*)::bigint AS n FROM journal_entry")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"))
        .try_get("n")
        .unwrap_or_else(|error| panic!("read count: {error}"));
    assert_eq!(count, 0, "nothing should survive the rollback");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_closed_period_refuses_a_posting(pool: PgPool) {
    open_september(&pool).await;
    map(&pool, "inventory", "1011201001").await;
    map(&pool, "trade_payable", "2012001001").await;

    let sealed = cloud::close_period(&pool, 2026, 9, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("close: {error}"));
    assert_eq!(sealed, 0, "nothing was posted before the close");

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let refusal = cloud::post(&mut tx, &bill(1_000), None, ACTOR).await;
    let message = match refusal {
        Ok(posted) => panic!("posted {} into a closed month", posted.entry_number),
        Err(error) => as_shown_to_a_person(&error),
    };
    assert!(
        message.contains("closed") || message.contains("2026-09"),
        "expected the period gate, got: {message}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_month_nobody_opened_refuses_a_posting(pool: PgPool) {
    open_september(&pool).await;
    map(&pool, "inventory", "1011201001").await;
    map(&pool, "trade_payable", "2012001001").await;

    let mut intent = bill(1_000);
    // A mistyped year is the ordinary way this happens, and it is exactly the
    // mistake an "open the period first" rule turns from a silent success into
    // a refusal.
    intent.posting_date = NaiveDate::from_ymd_opt(2062, 9, 1).unwrap_or_else(|| panic!("date"));

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let refusal = cloud::post(&mut tx, &intent, None, ACTOR).await;
    let message = match refusal {
        Ok(posted) => panic!("posted {} into a month nobody opened", posted.entry_number),
        Err(error) => as_shown_to_a_person(&error),
    };
    assert!(
        message.contains("2062"),
        "the refusal should name the month, got: {message}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_heading_cannot_be_posted_to(pool: PgPool) {
    open_september(&pool).await;

    // Mapping a heading is refused before anything is ever posted, by the
    // composite foreign key on (account_code, is_group).
    let refusal = cloud::set_account_mapping(
        &pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: "inventory".into(),
            site_id: "ho".into(),
            qualifier: String::new(),
            account_code: "1".into(),
            note: None,
        },
        ACTOR,
    )
    .await;
    assert!(
        refusal.is_err(),
        "a heading should not be mappable; the whole of ASSET is not a place to post"
    );

    // And directly, for a manual entry that names the account itself.
    map(&pool, "trade_payable", "2012001001").await;
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let intent = PostingIntent {
        posting_date: september(1),
        source_kind: "MANUAL".into(),
        source_id: None,
        rule_version: "manual/1".into(),
        currency: "IDR".into(),
        memo: None,
        lines: vec![
            PostingLine {
                account: LineAccount::Account {
                    account_code: "1".into(),
                },
                site_id: "ho".into(),
                debit_minor: 500,
                credit_minor: 0,
                supplier_id: None,
                asset_id: None,
                memo: None,
                counter_site_id: None,
            },
            PostingLine::credit("trade_payable", "ho", 500),
        ],
    };
    assert!(
        cloud::post(&mut tx, &intent, None, ACTOR).await.is_err(),
        "posting to a heading should be refused by the database"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_reversal_mirrors_the_original_and_leaves_it_alone(pool: PgPool) {
    open_september(&pool).await;
    map(&pool, "inventory", "1011201001").await;
    map(&pool, "trade_payable", "2012001001").await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let original = cloud::post(&mut tx, &bill(2_000_000), None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let mirror = cloud::reverse(
        &mut tx,
        original.entry_id,
        september(5),
        "billed twice",
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("reverse: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit reversal: {error}"));

    // Both entries are still there. The original is a record of what somebody
    // did, and it does not stop being true because it was wrong.
    // The register answers with an envelope now — rows, a cursor, a total and
    // facet counts — the shape every other finance list answers in.
    let register = cloud::journal_page(
        &pool,
        cloud::JournalScope {
            limit: Some(100),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("register: {error}"));
    assert_eq!(register.rows.len(), 2);
    // `total` counts the whole matched set rather than the page, which is the
    // difference between "two entries" and "two entries on this page".
    assert_eq!(register.total, 2);

    let detail = cloud::journal_entry(&pool, original.entry_id)
        .await
        .unwrap_or_else(|error| panic!("entry: {error}"));
    assert_eq!(detail.entry.reversed_by, Some(mirror.entry_id));

    // Net zero: the reversal undoes the original exactly.
    let payable = cloud::account_balance(&pool, "2012001001", None, None)
        .await
        .unwrap_or_else(|error| panic!("balance: {error}"));
    assert_eq!(payable.balance_minor, 0);

    // And it cannot be reversed twice — `reversal_of` is UNIQUE, so the
    // database refuses rather than a check somebody could forget to write.
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    assert!(
        cloud::reverse(&mut tx, original.entry_id, september(6), "again", ACTOR)
            .await
            .is_err(),
        "an entry should only be reversible once"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_journal_cannot_be_edited_or_deleted(pool: PgPool) {
    open_september(&pool).await;
    map(&pool, "inventory", "1011201001").await;
    map(&pool, "trade_payable", "2012001001").await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posted = cloud::post(&mut tx, &bill(4_000), None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    let edit = sqlx::query("UPDATE journal_entry SET total_minor = 1 WHERE entry_id = $1")
        .bind(posted.entry_id)
        .execute(&pool)
        .await;
    assert!(edit.is_err(), "the journal must not be editable");

    let delete = sqlx::query("DELETE FROM journal_line WHERE entry_id = $1")
        .bind(posted.entry_id)
        .execute(&pool)
        .await;
    assert!(delete.is_err(), "the journal must not be deletable");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_general_ledger_opens_where_the_previous_window_closed(pool: PgPool) {
    open_september(&pool).await;
    cloud::open_period(&pool, 2026, 10)
        .await
        .unwrap_or_else(|error| panic!("open october: {error}"));
    map(&pool, "inventory", "1011201001").await;
    map(&pool, "trade_payable", "2012001001").await;

    for (day, amount) in [(1_u32, 1_000_i64), (2, 2_000)] {
        let mut intent = bill(amount);
        intent.posting_date = september(day);
        // Two bills and not one bill posted twice. `bill()` names INV-1, and
        // from migration 0140 a document posts once for each step it has — so
        // the second of these would be refused as the duplicate it looks like.
        // Which is the right refusal: what this test wants is two movements in
        // one account, and two movements come from two documents.
        intent.source_id = Some(format!("INV-{day}"));
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
    }

    let october = cloud::general_ledger(
        &pool,
        "1011201001",
        cloud::GeneralLedgerScope {
            from: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap_or_else(|| panic!("date")),
            to: NaiveDate::from_ymd_opt(2026, 10, 31).unwrap_or_else(|| panic!("date")),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("ledger: {error}"));

    // Nothing happened in October, so the window is empty — and the opening
    // balance still has to carry September in, or the first figure a reader
    // sees would be a movement pretending to be a position.
    assert!(october.rows.is_empty());
    assert_eq!(october.opening_minor, 3_000);
    assert_eq!(october.closing_minor, 3_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_bill_debits_inventory_gross_and_credits_the_discount(pool: PgPool) {
    open_september(&pool).await;
    map(&pool, "inventory", "1011201001").await;
    map(&pool, "trade_payable", "2012001001").await;
    map(&pool, "purchase_discount", "8010110003").await;
    map(&pool, "vat_in", "1011302004").await;

    let recorded = cloud::record_bill(
        &pool,
        &cloud::RecordBillRequest {
            invoice_number: "INV-4471".into(),
            supplier_id: "SUP01".into(),
            supplier_name: Some("PT Sinar Jaya".into()),
            site_id: "ho".into(),
            invoice_date: september(1),
            due_date: Some(september(30)),
            subtotal_minor: 10_000_000,
            tax_minor: 1_100_000,
            discount_minor: 500_000,
            note: None,
            kind: None,
            lines: None,
            matching: None,
            withholding_code: None,
            receipt_ids: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("record: {error}"));
    assert_eq!(recorded.status, "DRAFT", "recording is not posting");
    assert_eq!(recorded.total_minor, 10_600_000);

    let posted = cloud::post_bill(&pool, recorded.invoice_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    assert_eq!(posted.status, "POSTED");

    // The shape that matters. The client keeps purchase discounts under root 8,
    // PENDAPATAN DAN (BIAYA) LAIN - LAIN, so a discount is other income and NOT
    // a smaller inventory figure. Netting it off inventory would balance just
    // as well and quietly empty an account their own statements have a line for.
    let inventory = cloud::account_balance(&pool, "1011201001", None, None)
        .await
        .unwrap_or_else(|error| panic!("inventory: {error}"));
    assert_eq!(
        inventory.balance_minor, 10_000_000,
        "inventory is debited gross, before the discount"
    );
    let discount = cloud::account_balance(&pool, "8010110003", None, None)
        .await
        .unwrap_or_else(|error| panic!("discount: {error}"));
    assert_eq!(
        discount.balance_minor, -500_000,
        "the discount is a credit to Potongan Pembelian"
    );
    let payable = cloud::account_balance(&pool, "2012001001", None, None)
        .await
        .unwrap_or_else(|error| panic!("payable: {error}"));
    assert_eq!(
        payable.balance_minor, -10_600_000,
        "the supplier is owed the bill net of the discount"
    );

    // Posting twice would double the payable.
    assert!(
        cloud::post_bill(&pool, recorded.invoice_id, None, ACTOR)
            .await
            .is_err(),
        "a posted bill should not post again"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_balance_sheet_balances_once_the_result_is_counted(pool: PgPool) {
    open_september(&pool).await;
    map(&pool, "inventory", "1011201001").await;
    map(&pool, "trade_payable", "2012001001").await;
    map(&pool, "purchase_discount", "8010110003").await;

    let recorded = cloud::record_bill(
        &pool,
        &cloud::RecordBillRequest {
            invoice_number: "INV-1".into(),
            supplier_id: "SUP01".into(),
            supplier_name: None,
            site_id: "ho".into(),
            invoice_date: september(1),
            due_date: None,
            subtotal_minor: 1_000_000,
            tax_minor: 0,
            discount_minor: 100_000,
            note: None,
            kind: None,
            lines: None,
            matching: None,
            withholding_code: None,
            receipt_ids: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("record: {error}"));
    cloud::post_bill(&pool, recorded.invoice_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));

    let sheet = cloud::statement(&pool, "BALANCE_SHEET", None, september(30), None)
        .await
        .unwrap_or_else(|error| panic!("balance sheet: {error}"));

    // Assets 1,000,000; liabilities 900,000; and 100,000 of profit sitting in
    // class 8 because nobody has closed the year. A sheet of classes 1-3 alone
    // would report itself out by exactly that, which is alarming and wrong —
    // the client keeps the figure as `3013001003 Laba (Rugi) bulan berjalan`.
    assert_eq!(sheet.result_minor, -100_000, "the period earned 100,000");
    assert_eq!(
        sheet.out_of_balance_minor, 0,
        "assets equal liabilities and equity once the result is counted"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_family_shows_a_cell_for_every_location(pool: PgPool) {
    open_september(&pool).await;
    map(&pool, "inventory", "1011201001").await;
    map(&pool, "trade_payable", "2012001001").await;
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    cloud::post(&mut tx, &bill(7_000), None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    let matrix = cloud::balance_matrix(&pool, "1011201", september(30))
        .await
        .unwrap_or_else(|error| panic!("matrix: {error}"));

    // A location with nothing posted is a zero, not an absent key. In a sparse
    // map "no stock at store 07" and "store 07 was never asked about" look the
    // same, and they are very different things to an accountant.
    assert_eq!(matrix.locations.len(), 14);
    assert_eq!(matrix.locations.first().map(String::as_str), Some("ho"));
    for row in &matrix.rows {
        assert_eq!(row.cells.len(), matrix.locations.len());
    }
    assert_eq!(matrix.grand_total_minor, 7_000);
}

// ---------------------------------------------------------------------------
// Cash and bank: paging, filtering and ordering
// ---------------------------------------------------------------------------

/// Map one meaning to one account at one site.
///
/// `map` above pins head office; this list is per-site, which is the whole
/// point of the money screen — one meaning, fourteen places.
async fn map_at(pool: &PgPool, key: &str, site: &str, code: &str) {
    cloud::set_account_mapping(
        pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: key.into(),
            site_id: site.into(),
            qualifier: String::new(),
            account_code: code.into(),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("map {key} at {site}: {error}"));
}

/// A money account at every shop, so paging has something to page through.
///
/// Cash and a bank at each of five sites, which is ten rows — enough that a
/// page of three both repeats and runs out, and small enough to read when a
/// case fails.
///
/// Ten MAPPINGS, though, and no longer ten accounts. Before 0244 each unit had
/// a cash account of its own and this seeded them; the collapse left one
/// `1011001001 Cash On Hand` that all fourteen units post to, with the unit on
/// `journal_line.site_id`. The row the money screen shows is still the PAIR —
/// `(account_code, site_id)` — which is what the cursor carries, so the list
/// this builds is the same shape it always was.
async fn seed_money(pool: &PgPool) {
    let sites = ["ho", "store-01", "store-02", "store-03", "store-04"];
    for site in sites {
        for (key, code) in [("cash", "1011001001"), ("bank_giro", "1011002001")] {
            map_at(pool, key, site, code).await;
        }
    }
}

/// The key that names one row, which is what a cursor carries.
fn keys(page: &cloud::MoneyOverview) -> Vec<(String, String)> {
    page.rows
        .iter()
        .map(|row| (row.account_code.clone(), row.site_id.clone()))
        .collect()
}

/// Walk the whole list a page at a time, exactly as the screen does.
async fn scroll(pool: &PgPool, scope: cloud::MoneyScope, page: i64) -> Vec<(String, String)> {
    let mut seen = Vec::new();
    let mut cursor = None;
    // A guard, not a limit: a cursor that stops advancing is the bug this whole
    // test exists to catch, and an infinite loop reports it as a hung suite
    // rather than as a failure.
    for _ in 0..50 {
        let asked = cloud::MoneyScope {
            cursor: cursor.clone(),
            limit: Some(page),
            ..scope.clone()
        };
        let answer = cloud::money_overview(pool, asked).await.expect("page");
        seen.extend(keys(&answer));
        match answer.next_cursor {
            None => return seen,
            some => cursor = some,
        }
    }
    panic!("cursor never ran out");
}

/// Scrolling to the end gives the list, exactly once.
///
/// This is the property a keyset cursor exists to hold, and the one that fails
/// invisibly: a page boundary that loses a row shows a list that is simply
/// short, and one that repeats shows a duplicate nobody reads twice. Checked
/// against the unpaged answer, which is what the endpoint gives a caller that
/// sends no `limit`.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn scrolling_a_paged_list_gives_every_row_once(pool: PgPool) {
    seed_money(&pool).await;
    let whole = cloud::money_overview(&pool, cloud::MoneyScope::default())
        .await
        .expect("unpaged");
    let expected = keys(&whole);
    assert_eq!(expected.len(), 10, "seed");
    assert!(whole.next_cursor.is_none(), "unpaged asks for no next page");

    for page in [1, 3, 7, 10, 11] {
        let scrolled = scroll(&pool, cloud::MoneyScope::default(), page).await;
        assert_eq!(scrolled, expected, "page size {page} changed the order");
        let mut unique = scrolled.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(
            unique.len(),
            scrolled.len(),
            "page size {page} repeated a row"
        );
    }
}

/// And it still holds under every order the screen offers.
///
/// A keyset is only exact while the sort is TOTAL. `balance` ties on every
/// account holding nothing, so without the natural key behind it the tied rows
/// are the ones a page boundary drops.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_sort_pages_exactly(pool: PgPool) {
    seed_money(&pool).await;
    for sort in ["default", "balance", "name"] {
        for desc in [false, true] {
            let scope = cloud::MoneyScope {
                sort: Some(sort.into()),
                desc,
                ..Default::default()
            };
            let whole = cloud::money_overview(&pool, scope.clone())
                .await
                .expect("unpaged");
            let scrolled = scroll(&pool, scope, 3).await;
            assert_eq!(
                scrolled,
                keys(&whole),
                "sort={sort} desc={desc} lost or repeated a row"
            );
        }
    }
}

/// The total follows the FILTER; the facet counts follow the SEARCH.
///
/// These were one number once, and the page showed sixty-nine rows under a
/// heading that said a hundred and thirty-nine. They are different questions:
/// "how long is this list" and "how many banks are there to tick".
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_total_counts_the_filtered_list_and_the_facets_do_not(pool: PgPool) {
    seed_money(&pool).await;
    let banks = cloud::MoneyScope {
        pots: vec!["BANK".into()],
        ..Default::default()
    };
    let answer = cloud::money_overview(&pool, banks).await.expect("filtered");

    assert_eq!(answer.total, 5, "total is the length of the list on screen");
    assert_eq!(answer.rows.len(), 5);

    let cash = answer
        .facets
        .pots
        .iter()
        .find(|facet| facet.value == "CASH")
        .expect("cash is still offered while bank is ticked");
    assert_eq!(
        cash.count, 5,
        "a facet answers how many there ARE, not how many survive the filter"
    );

    // And a site facet says what a person calls the place, not what we file it
    // under — the list beside the panel shows `C001`.
    let site = answer
        .facets
        .sites
        .iter()
        .find(|facet| facet.value == "store-01")
        .expect("store-01");
    assert_eq!(site.label.as_deref(), Some("C001"));
}

/// An unknown filter value is dropped, not refused.
///
/// A filter arrives from a URL somebody may have kept from an older build, and
/// answering 400 to a stale bookmark is worse than answering the rows that do
/// match. Empty means "no filter", never "nothing passes" — otherwise a screen
/// shows nothing the moment somebody unticks the last box.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_filter_this_build_does_not_know_is_ignored(pool: PgPool) {
    seed_money(&pool).await;
    let stale = cloud::MoneyScope {
        pots: vec!["CRYPTOCURRENCY".into()],
        sort: Some("by_vibes".into()),
        ..Default::default()
    };
    let answer = cloud::money_overview(&pool, stale)
        .await
        .expect("stale url");
    assert_eq!(answer.total, 10, "an unrecognised filter narrows nothing");
}

// ---------------------------------------------------------------------------
// The rest of the finance lists, brought to the same envelope
// ---------------------------------------------------------------------------

/// Walk the chart a page at a time and get it exactly once.
///
/// The chart is the list where a page boundary that loses a row is invisible:
/// the client's own is 7,528 accounts, and `101` alone matches 1,248 of them.
/// Every order, every direction, and a page size of one — which is where a
/// keyset that compares the wrong tuple fails first.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn scrolling_the_chart_gives_every_account_once(pool: PgPool) {
    for sort in ["default", "code", "name", "children"] {
        for desc in [false, true] {
            let scope = cloud::AccountScope {
                // A search rather than a branch: branch mode is one level, and
                // the whole chart is what has to page correctly.
                needle: Some("A".into()),
                sort: Some(sort.into()),
                desc,
                ..Default::default()
            };
            let whole = cloud::account_page(&pool, scope.clone())
                .await
                .expect("whole");
            let expected: Vec<String> = whole
                .rows
                .iter()
                .map(|row| row.account_code.clone())
                .collect();
            assert!(!expected.is_empty(), "the seed matches something");
            assert_eq!(
                whole.total,
                expected.len() as i64,
                "one page holds the seed, so total is its length"
            );

            for page in [1, 2, 3, 7] {
                let mut seen: Vec<String> = Vec::new();
                let mut cursor = None;
                // A guard, not a limit: a cursor that stops advancing is the
                // bug this test exists to catch, and an infinite loop reports
                // it as a hung suite rather than as a failure.
                for _ in 0..200 {
                    let answer = cloud::account_page(
                        &pool,
                        cloud::AccountScope {
                            cursor: cursor.clone(),
                            limit: Some(page),
                            ..scope.clone()
                        },
                    )
                    .await
                    .expect("page");
                    seen.extend(answer.rows.iter().map(|row| row.account_code.clone()));
                    match answer.next_cursor {
                        None => break,
                        some => cursor = some,
                    }
                }
                assert_eq!(
                    seen, expected,
                    "sort={sort} desc={desc} page={page} lost, repeated or reordered a row"
                );
            }
        }
    }
}

/// A branch is a branch, and a search is the whole chart.
///
/// The tree position is not read while searching: a needle asks about the
/// chart, and narrowing it to whichever heading somebody last opened would
/// answer a question nobody asked.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_search_ignores_the_heading_the_tree_is_parked_on(pool: PgPool) {
    let roots = cloud::account_page(&pool, cloud::AccountScope::default())
        .await
        .expect("roots");
    assert!(!roots.searched);
    assert!(
        roots.rows.iter().all(|row| row.parent_code.is_none()),
        "no parent means the roots"
    );

    let parked = cloud::account_page(
        &pool,
        cloud::AccountScope {
            parent: Some("2".into()),
            needle: Some("HARGA".into()),
            ..Default::default()
        },
    )
    .await
    .expect("searched");
    assert!(parked.searched);
    assert_eq!(
        parked.parent, None,
        "the branch is not echoed back mid-search"
    );
    assert!(
        parked.rows.iter().any(|row| row.account_code == "501"),
        "a hit under 5 is found while the tree sits on 2"
    );
}

/// The house order puts what you typed the code of first.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_code_match_outranks_a_name_match(pool: PgPool) {
    let answer = cloud::account_page(
        &pool,
        cloud::AccountScope {
            needle: Some("101".into()),
            ..Default::default()
        },
    )
    .await
    .expect("search");
    let first = &answer.rows[0].account_code;
    assert!(
        first.starts_with("101"),
        "a code match leads; got {first} first"
    );
}

/// **A trial balance does not move when somebody types in a search box.**
///
/// The totals it exists to prove are about the whole ledger. Narrow the rows
/// and the proof stays the proof — otherwise "do the books balance" quietly
/// becomes "does page one balance", which is not a question anybody asked.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn narrowing_a_trial_balance_does_not_move_its_totals(pool: PgPool) {
    open_september(&pool).await;
    post_a_bill(&pool).await;

    let whole = cloud::trial_balance(
        &pool,
        cloud::TrialBalanceScope {
            as_of: Some(september(30)),
            ..Default::default()
        },
    )
    .await
    .expect("whole");
    assert!(whole.balanced, "the seed balances");
    assert!(whole.total_debit_minor > 0);

    // A search that leaves one row. The list shrinks; the proof does not.
    let narrowed = cloud::trial_balance(
        &pool,
        cloud::TrialBalanceScope {
            as_of: Some(september(30)),
            needle: Some("HUTANG".into()),
            ..Default::default()
        },
    )
    .await
    .expect("narrowed");
    assert!(
        narrowed.total < whole.total,
        "the search narrowed the list: {} of {}",
        narrowed.total,
        whole.total
    );
    assert_eq!(narrowed.total_debit_minor, whole.total_debit_minor);
    assert_eq!(narrowed.total_credit_minor, whole.total_credit_minor);
    assert_eq!(narrowed.ledger_rows, whole.ledger_rows);
    assert!(narrowed.balanced, "still balanced, because it still is");

    // And a page of one says the same thing.
    let paged = cloud::trial_balance(
        &pool,
        cloud::TrialBalanceScope {
            as_of: Some(september(30)),
            limit: Some(1),
            ..Default::default()
        },
    )
    .await
    .expect("paged");
    assert_eq!(paged.rows.len(), 1);
    assert_eq!(paged.total_debit_minor, whole.total_debit_minor);
    assert!(paged.balanced);
    assert!(paged.next_cursor.is_some(), "there is more to read");
}

/// The same rule, one account down: a general ledger's window totals are about
/// the window, not about what the search left on screen.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn narrowing_a_ledger_does_not_move_its_opening_or_its_window(pool: PgPool) {
    open_september(&pool).await;
    post_a_bill(&pool).await;

    let window = cloud::GeneralLedgerScope {
        from: september(1),
        to: september(30),
        ..Default::default()
    };
    let whole = cloud::general_ledger(&pool, "2", window.clone())
        .await
        .expect("whole");
    assert!(whole.window_rows > 0, "the bill moved this account");

    let narrowed = cloud::general_ledger(
        &pool,
        "2",
        cloud::GeneralLedgerScope {
            needle: Some("nothing-matches-this".into()),
            ..window.clone()
        },
    )
    .await
    .expect("narrowed");
    assert!(
        narrowed.rows.is_empty(),
        "the search left nothing on screen"
    );
    assert_eq!(narrowed.total, 0);
    // And every figure the screen proves itself with is untouched.
    assert_eq!(narrowed.opening_minor, whole.opening_minor);
    assert_eq!(narrowed.closing_minor, whole.closing_minor);
    assert_eq!(narrowed.window_debit_minor, whole.window_debit_minor);
    assert_eq!(narrowed.window_credit_minor, whole.window_credit_minor);
    assert_eq!(narrowed.window_rows, whole.window_rows);
}

/// A ledger row carries the JOURNAL LINE's id, not the entry's.
///
/// They are different things and the difference is load-bearing:
/// reconciliation is keyed on the line, because a bank statement agrees with
/// one side of an entry rather than with the entry. A payment carries only
/// `journal_entry_id`, which is why the payments list cannot say whether a
/// payment has cleared and this list can.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_ledger_row_is_keyed_on_the_line_so_it_can_answer_reconciliation(pool: PgPool) {
    open_september(&pool).await;
    post_a_bill(&pool).await;

    let ledger = cloud::general_ledger(
        &pool,
        "2",
        cloud::GeneralLedgerScope {
            from: september(1),
            to: september(30),
            ..Default::default()
        },
    )
    .await
    .expect("ledger");
    let row = &ledger.rows[0];
    assert_ne!(
        row.line_id, row.entry_id,
        "the line and the entry are different rows and must not share an id"
    );
    assert!(
        !row.reconciled,
        "nothing has agreed with this line, which is the ordinary state"
    );
}

/// The journal's facets count the search, its total counts the filter, and the
/// site counts deliberately do not add up.
///
/// An entry with lines at two locations is counted under both, because it
/// genuinely touched both. A panel whose numbers summed to the total would
/// have to pick one location per entry, and there is no honest way to pick.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_journal_counts_the_search_and_the_filter_separately(pool: PgPool) {
    open_september(&pool).await;
    post_a_bill(&pool).await;

    let filtered = cloud::journal_page(
        &pool,
        cloud::JournalScope {
            kinds: vec!["NOTHING_POSTS_THIS".into()],
            ..Default::default()
        },
    )
    .await
    .expect("filtered");
    assert_eq!(filtered.total, 0, "the total follows the filter");
    assert!(
        filtered.facets.kinds.iter().any(|facet| facet.count > 0),
        "the facets follow the search, so the kinds that exist are still offered"
    );
}

/// An unrecognised `sort` falls back to the house order rather than 400ing.
///
/// A sort arrives from a URL somebody may have kept from an older build, and a
/// 400 for a stale bookmark is a worse answer than the rows in the house order.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_stale_bookmark_still_opens_every_finance_list(pool: PgPool) {
    open_september(&pool).await;

    let stale = Some("by_vibes".to_owned());

    let accounts = cloud::account_page(
        &pool,
        cloud::AccountScope {
            sort: stale.clone(),
            ..Default::default()
        },
    )
    .await
    .expect("chart");
    assert_eq!(accounts.rows.len(), 4, "the seed's four roots");

    let journal = cloud::journal_page(
        &pool,
        cloud::JournalScope {
            sort: stale.clone(),
            ..Default::default()
        },
    )
    .await
    .expect("journal");
    assert_eq!(journal.total, 0);

    let periods = cloud::period_page(
        &pool,
        cloud::PeriodScope {
            sort: stale.clone(),
            ..Default::default()
        },
    )
    .await
    .expect("periods");
    assert_eq!(periods.total, 1, "september is open");

    let assets = cloud::asset_page(
        &pool,
        cloud::AssetScope {
            sort: stale.clone(),
            ..Default::default()
        },
    )
    .await
    .expect("assets");
    assert_eq!(assets.total, 0);

    let statements = cloud::bank_statement_page(
        &pool,
        cloud::BankStatementScope {
            sort: stale.clone(),
            ..Default::default()
        },
    )
    .await
    .expect("statements");
    assert_eq!(statements.total, 0);

    let map = cloud::account_map_page(
        &pool,
        cloud::AccountMapScope {
            sort: stale,
            ..Default::default()
        },
    )
    .await
    .expect("map");
    // Nothing is mapped in this seed, and the gap is counted over every
    // required meaning at every location — never over the page.
    assert_eq!(map.total, 0);
    assert!(map.unmapped_pairs > 0, "an unmapped map has a gap");
}
