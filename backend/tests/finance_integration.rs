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

/// A chart small enough to read and shaped like the client's: two headings and
/// three postable leaves under them, with the location in the code.
async fn seed_chart(pool: &PgPool) {
    sqlx::query(
        "INSERT INTO ledger_account (account_code, name, is_group) VALUES
           ('1','ASSET',true), ('2','LIABILITIES',true), ('5','BIAYA / BEBAN POKOK',true)",
    )
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("roots: {error}"));
    sqlx::query(
        "INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id) VALUES
           ('101120100100','Persediaan Barang Dagangan HO','1',false,'dc'),
           ('201200100100','Hutang Suppliers Barang Dagangan HO','2',false,'dc'),
           ('501011000100','Harga Pokok Pembelian HO','5',false,'dc')",
    )
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("leaves: {error}"));
}

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
            site_id: "dc".into(),
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
            PostingLine::debit("inventory", "dc", amount),
            PostingLine::credit("trade_payable", "dc", amount).for_supplier("SUP01"),
        ],
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_meaning_with_no_account_refuses_and_says_which(pool: PgPool) {
    seed_chart(&pool).await;
    open_september(&pool).await;
    // Only one of the two meanings is mapped, so the entry cannot be completed.
    map(&pool, "inventory", "101120100100").await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let refusal = cloud::post(&mut tx, &bill(8_600_000), ACTOR).await;

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
        message.contains("dc"),
        "the refusal should name the location, said: {message}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_bill_posts_and_the_trial_balance_balances(pool: PgPool) {
    seed_chart(&pool).await;
    open_september(&pool).await;
    map(&pool, "inventory", "101120100100").await;
    map(&pool, "trade_payable", "201200100100").await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posted = cloud::post(&mut tx, &bill(8_600_000), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    assert_eq!(posted.total_minor, 8_600_000);

    let balance = cloud::trial_balance(&pool, september(30), None)
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
    seed_chart(&pool).await;
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
        (1, "101120100100", 5000_i64, 0_i64),
        (2, "201200100100", 0, 4000),
    ] {
        sqlx::query(
            "INSERT INTO journal_line (line_id, entry_id, line_number, account_code, site_id,
                 debit_minor, credit_minor) VALUES ($1,$2,$3,$4,'dc',$5,$6)",
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
    seed_chart(&pool).await;
    open_september(&pool).await;
    map(&pool, "inventory", "101120100100").await;
    map(&pool, "trade_payable", "201200100100").await;

    let sealed = cloud::close_period(&pool, 2026, 9, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("close: {error}"));
    assert_eq!(sealed, 0, "nothing was posted before the close");

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let refusal = cloud::post(&mut tx, &bill(1_000), ACTOR).await;
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
    seed_chart(&pool).await;
    open_september(&pool).await;
    map(&pool, "inventory", "101120100100").await;
    map(&pool, "trade_payable", "201200100100").await;

    let mut intent = bill(1_000);
    // A mistyped year is the ordinary way this happens, and it is exactly the
    // mistake an "open the period first" rule turns from a silent success into
    // a refusal.
    intent.posting_date = NaiveDate::from_ymd_opt(2062, 9, 1).unwrap_or_else(|| panic!("date"));

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let refusal = cloud::post(&mut tx, &intent, ACTOR).await;
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
    seed_chart(&pool).await;
    open_september(&pool).await;

    // Mapping a heading is refused before anything is ever posted, by the
    // composite foreign key on (account_code, is_group).
    let refusal = cloud::set_account_mapping(
        &pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: "inventory".into(),
            site_id: "dc".into(),
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
    map(&pool, "trade_payable", "201200100100").await;
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
                site_id: "dc".into(),
                debit_minor: 500,
                credit_minor: 0,
                supplier_id: None,
                memo: None,
            },
            PostingLine::credit("trade_payable", "dc", 500),
        ],
    };
    assert!(
        cloud::post(&mut tx, &intent, ACTOR).await.is_err(),
        "posting to a heading should be refused by the database"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_reversal_mirrors_the_original_and_leaves_it_alone(pool: PgPool) {
    seed_chart(&pool).await;
    open_september(&pool).await;
    map(&pool, "inventory", "101120100100").await;
    map(&pool, "trade_payable", "201200100100").await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let original = cloud::post(&mut tx, &bill(2_000_000), ACTOR)
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
    let register = cloud::journal_register(&pool, None, None, None, 100)
        .await
        .unwrap_or_else(|error| panic!("register: {error}"));
    assert_eq!(register.len(), 2);

    let detail = cloud::journal_entry(&pool, original.entry_id)
        .await
        .unwrap_or_else(|error| panic!("entry: {error}"));
    assert_eq!(detail.entry.reversed_by, Some(mirror.entry_id));

    // Net zero: the reversal undoes the original exactly.
    let payable = cloud::account_balance(&pool, "201200100100", None, None)
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
    seed_chart(&pool).await;
    open_september(&pool).await;
    map(&pool, "inventory", "101120100100").await;
    map(&pool, "trade_payable", "201200100100").await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posted = cloud::post(&mut tx, &bill(4_000), ACTOR)
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
    seed_chart(&pool).await;
    open_september(&pool).await;
    cloud::open_period(&pool, 2026, 10)
        .await
        .unwrap_or_else(|error| panic!("open october: {error}"));
    map(&pool, "inventory", "101120100100").await;
    map(&pool, "trade_payable", "201200100100").await;

    for (day, amount) in [(1_u32, 1_000_i64), (2, 2_000)] {
        let mut intent = bill(amount);
        intent.posting_date = september(day);
        let mut tx = pool
            .begin()
            .await
            .unwrap_or_else(|error| panic!("begin: {error}"));
        cloud::post(&mut tx, &intent, ACTOR)
            .await
            .unwrap_or_else(|error| panic!("post: {error}"));
        tx.commit()
            .await
            .unwrap_or_else(|error| panic!("commit: {error}"));
    }

    let october = cloud::general_ledger(
        &pool,
        "101120100100",
        None,
        NaiveDate::from_ymd_opt(2026, 10, 1).unwrap_or_else(|| panic!("date")),
        NaiveDate::from_ymd_opt(2026, 10, 31).unwrap_or_else(|| panic!("date")),
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
