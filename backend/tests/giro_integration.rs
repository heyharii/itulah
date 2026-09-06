//! Giros and bank rules, against a real Postgres.
//!
//! Two subjects in one file because they share a fixture and, more to the
//! point, a claim: money does not move because a machine thought it should.
//! A rule proposes and a person accepts; a giro is written and only the bank
//! clearing it moves the bank balance. Both are places where the obvious
//! shortcut posts something nobody signed for.
//!
//! The giro assertions are about an actual bug. `payments.rs` used to credit
//! `bank_giro` the moment a giro was written, so a company paying ninety days
//! out had a bank balance that could not be reconciled against a statement.
//! `giro_outstanding` had been in `required_semantic_keys` since the ledger's
//! first day with nothing ever writing to it. Every test below that reads a
//! balance is reading it for that reason.

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{
    self as cloud, AllocateToBill, ImportStatementLine, ImportStatementRequest,
    RecordPaymentRequest,
};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";

type ChartRow = (
    &'static str,
    &'static str,
    Option<&'static str>,
    bool,
    Option<&'static str>,
);

/// The client's own codes for the four accounts a giro touches, plus the two a
/// bank rule proposes.
async fn seed(pool: &PgPool) {
    let rows: [ChartRow; 18] = [
        ("1", "ASSET", None, true, None),
        ("101", "CURRENT ASSET", Some("1"), true, None),
        ("10110", "KAS & SETARA KAS", Some("101"), true, None),
        ("1011002", "CASH IN BANK GIRO", Some("10110"), true, None),
        (
            "101100200100",
            "Cash In Bank Giro Bank BCA HO",
            Some("1011002"),
            false,
            Some("dc"),
        ),
        (
            "101100200200",
            "Cash In Bank Giro Bank MANDIRI HO",
            Some("1011002"),
            false,
            Some("dc"),
        ),
        ("10112", "INVENTORY", Some("101"), true, None),
        (
            "1011201",
            "Persediaan Barang Dagang",
            Some("10112"),
            true,
            None,
        ),
        (
            "101120100100",
            "Persediaan Barang Dagangan HO",
            Some("1011201"),
            false,
            Some("dc"),
        ),
        ("2", "LIABILITIES", None, true, None),
        ("201", "HUTANG JANGKA PENDEK", Some("2"), true, None),
        ("20120", "HUTANG DAGANG", Some("201"), true, None),
        ("2012001", "HUTANG SUPPLIER", Some("20120"), true, None),
        (
            "201200100100",
            "Hutang Suppliers Barang Dagangan HO",
            Some("2012001"),
            false,
            Some("dc"),
        ),
        ("2012002", "OUTSTANDING GIRO", Some("20120"), true, None),
        (
            "201200200100",
            "Outstanding Giro Bank BCA HO",
            Some("2012002"),
            false,
            Some("dc"),
        ),
        ("6", "BEBAN USAHA", None, true, None),
        (
            "601031000400",
            "Biaya Bank HO",
            Some("6"),
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
    for month in [9, 10, 11, 12] {
        cloud::open_period(pool, 2026, month)
            .await
            .unwrap_or_else(|error| panic!("period {month}: {error}"));
    }
    map(pool, "bank_giro", "BCA", "101100200100").await;
    map(pool, "bank_giro", "MANDIRI", "101100200200").await;
    map(pool, "giro_outstanding", "BCA", "201200200100").await;
    map(pool, "trade_payable", "", "201200100100").await;
    map(pool, "inventory", "", "101120100100").await;
    map(pool, "bank_admin_fee", "", "601031000400").await;
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

fn day(month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, month, day).unwrap_or_else(|| panic!("bad date"))
}

/// What one account nets to across the whole ledger.
async fn balance(pool: &PgPool, code: &str) -> i64 {
    sqlx::query(
        "SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::bigint AS net
           FROM journal_line WHERE account_code = $1",
    )
    .bind(code)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("balance {code}: {error}"))
    .try_get("net")
    .unwrap_or_else(|error| panic!("read: {error}"))
}

/// A posted merchandise bill for one supplier, so a giro has something to pay.
async fn a_bill(pool: &PgPool, number: &str, amount: i64) -> Uuid {
    use inventory_backend::cloud::postgres::{PostingIntent, PostingLine};
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posted = cloud::post(
        &mut tx,
        &PostingIntent {
            posting_date: day(9, 1),
            source_kind: "SUPPLIER_INVOICE".into(),
            source_id: Some(number.into()),
            rule_version: "supplier_invoice/1".into(),
            currency: "IDR".into(),
            memo: Some("Faktur pemasok".into()),
            lines: vec![
                PostingLine::debit("inventory", "dc", amount),
                PostingLine::credit("trade_payable", "dc", amount).for_supplier("SUP01"),
            ],
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post bill: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    let invoice_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO supplier_invoice
           (invoice_id, invoice_number, supplier_id, supplier_name, site_id, invoice_date,
            subtotal_minor, tax_minor, discount_minor, total_minor,
            status, kind, currency, recorded_by, journal_entry_id, posted_by, posted_at)
         VALUES ($1,$2,'SUP01','PT Sumber Jaya','dc',$3,$4,0,0,$4,
                 'POSTED','MERCHANDISE','IDR',$5,$6,$5,now())",
    )
    .bind(invoice_id)
    .bind(number)
    .bind(day(9, 1))
    .bind(amount)
    .bind(ACTOR)
    .bind(posted.entry_id)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("bill: {error}"));
    invoice_id
}

/// Write a giro for the whole of one bill and post it.
async fn pay_by_giro(
    pool: &PgPool,
    invoice_id: Uuid,
    amount: i64,
    number: &str,
    due: NaiveDate,
) -> Uuid {
    let payment = cloud::record_payment(
        pool,
        &RecordPaymentRequest {
            site_id: "dc".into(),
            payment_date: day(9, 5),
            method: "GIRO".into(),
            account_key: "bank_giro".into(),
            account_qualifier: "BCA".into(),
            total_minor: Some(amount),
            reference: None,
            note: None,
            allocations: vec![AllocateToBill {
                invoice_id,
                amount_minor: amount,
            }],
            giro_number: Some(number.into()),
            giro_due_date: Some(due),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("record payment: {error}"));
    cloud::post_payment(pool, payment.payment_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post payment: {error}"));
    payment.payment_id
}

// ---------------------------------------------------------------------------
// Issuing
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn issuing_a_giro_credits_the_instrument_and_leaves_the_bank_alone(pool: PgPool) {
    seed(&pool).await;
    let invoice_id = a_bill(&pool, "INV-11", 40_000_000).await;
    pay_by_giro(&pool, invoice_id, 40_000_000, "BG-0001", day(12, 4)).await;

    // The bug, in one assertion: the bank has not moved, because the bank has
    // not seen this piece of paper and will not for three months.
    assert_eq!(
        balance(&pool, "101100200100").await,
        0,
        "writing a giro must not move the bank balance"
    );
    // The debt has moved from the supplier to the instrument.
    assert_eq!(balance(&pool, "201200200100").await, -40_000_000);
    assert_eq!(balance(&pool, "201200100100").await, 0);

    let giros = cloud::giro_list(&pool, None, None, None, None, 50)
        .await
        .unwrap_or_else(|error| panic!("list: {error}"));
    assert_eq!(giros.len(), 1);
    assert_eq!(giros[0].status, "ISSUED");
    assert_eq!(giros[0].number, "BG-0001");
    assert_eq!(giros[0].bank, "BCA");
    assert_eq!(giros[0].direction, "OUT");
    assert_eq!(giros[0].amount_minor, 40_000_000);
    assert_eq!(giros[0].party_name.as_deref(), Some("PT Sumber Jaya"));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_giro_payment_without_the_paper_is_refused(pool: PgPool) {
    seed(&pool).await;
    let invoice_id = a_bill(&pool, "INV-12", 1_000_000).await;

    let refusal = cloud::record_payment(
        &pool,
        &RecordPaymentRequest {
            site_id: "dc".into(),
            payment_date: day(9, 5),
            method: "GIRO".into(),
            account_key: "bank_giro".into(),
            account_qualifier: "BCA".into(),
            total_minor: Some(1_000_000),
            reference: Some("giro BCA".into()),
            note: None,
            allocations: vec![AllocateToBill {
                invoice_id,
                amount_minor: 1_000_000,
            }],
            giro_number: None,
            giro_due_date: None,
        },
        ACTOR,
    )
    .await;
    let message = match refusal {
        Ok(_) => panic!("recorded a giro with no number and no date"),
        Err(error) => error.to_string(),
    };
    // Without both it is a transfer that has not happened yet, which is exactly
    // how it used to be booked.
    assert!(message.contains("number"), "said: {message}");
    assert!(message.contains("date"), "said: {message}");
}

// ---------------------------------------------------------------------------
// Clearing
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn clearing_moves_it_from_the_instrument_to_the_bank(pool: PgPool) {
    seed(&pool).await;
    let invoice_id = a_bill(&pool, "INV-13", 40_000_000).await;
    pay_by_giro(&pool, invoice_id, 40_000_000, "BG-0002", day(12, 4)).await;
    let giro_id = cloud::giro_list(&pool, None, None, None, None, 10)
        .await
        .unwrap_or_else(|error| panic!("list: {error}"))[0]
        .giro_id;

    let cleared = cloud::giro_clear(&pool, giro_id, day(12, 4), None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("clear: {error}"));
    assert_eq!(cleared.status, "CLEARED");

    // NOW the bank moves, and the instrument comes off.
    assert_eq!(balance(&pool, "101100200100").await, -40_000_000);
    assert_eq!(balance(&pool, "201200200100").await, 0);

    let kind: String = sqlx::query("SELECT source_kind FROM journal_entry WHERE entry_id = $1")
        .bind(
            cleared
                .clearing_entry_id
                .unwrap_or_else(|| panic!("no entry")),
        )
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("entry: {error}"))
        .try_get("source_kind")
        .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(kind, "GIRO");

    // A cleared giro walked back and cleared again would post a second,
    // perfectly balanced entry moving money that only moved once.
    let twice = cloud::giro_clear(&pool, giro_id, day(12, 5), None, ACTOR).await;
    let message = match twice {
        Ok(_) => panic!("cleared the same giro twice"),
        Err(error) => error.to_string(),
    };
    assert!(message.contains("already cleared"), "said: {message}");
    assert_eq!(balance(&pool, "101100200100").await, -40_000_000);
}

// ---------------------------------------------------------------------------
// Rejection
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_rejected_giro_reverses_the_issue_and_gives_the_bill_back(pool: PgPool) {
    seed(&pool).await;
    let invoice_id = a_bill(&pool, "INV-14", 40_000_000).await;
    let payment_id = pay_by_giro(&pool, invoice_id, 40_000_000, "BG-0003", day(12, 4)).await;
    let giro_id = cloud::giro_list(&pool, None, None, None, None, 10)
        .await
        .unwrap_or_else(|error| panic!("list: {error}"))[0]
        .giro_id;

    let rejected = cloud::giro_reject(&pool, giro_id, day(12, 4), "saldo tidak cukup", ACTOR)
        .await
        .unwrap_or_else(|error| panic!("reject: {error}"));
    assert_eq!(rejected.status, "REJECTED");

    // The instrument is off the books and the supplier is owed again.
    assert_eq!(balance(&pool, "201200200100").await, 0);
    assert_eq!(balance(&pool, "201200100100").await, -40_000_000);
    // And the bank never moved at any point in the story.
    assert_eq!(balance(&pool, "101100200100").await, 0);

    let payment = cloud::payment(&pool, payment_id)
        .await
        .unwrap_or_else(|error| panic!("payment: {error}"));
    assert_eq!(payment.status, "REVERSED");

    // The bill reopens without another table learning what a giro is:
    // `supplier_payment_allocation` counts DRAFT and POSTED, and this is
    // neither.
    let outstanding: i64 = sqlx::query(
        "SELECT (i.total_minor - COALESCE((
             SELECT SUM(al.amount_minor) FROM supplier_payment_allocation al
               JOIN supplier_payment p USING (payment_id)
              WHERE al.invoice_id = i.invoice_id AND p.status IN ('DRAFT','POSTED')), 0))::bigint
                AS owed
           FROM supplier_invoice i WHERE i.invoice_id = $1",
    )
    .bind(invoice_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("owed: {error}"))
    .try_get("owed")
    .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(outstanding, 40_000_000, "the bill should be open again");

    let after = cloud::giro_clear(&pool, giro_id, day(12, 5), None, ACTOR).await;
    assert!(after.is_err(), "a rejected giro cannot then clear");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn rejecting_without_a_reason_is_refused(pool: PgPool) {
    seed(&pool).await;
    let invoice_id = a_bill(&pool, "INV-15", 1_000_000).await;
    pay_by_giro(&pool, invoice_id, 1_000_000, "BG-0004", day(12, 4)).await;
    let giro_id = cloud::giro_list(&pool, None, None, None, None, 10)
        .await
        .unwrap_or_else(|error| panic!("list: {error}"))[0]
        .giro_id;

    // The supplier is going to ask why, and this is the only record of what to
    // tell them.
    let refusal = cloud::giro_reject(&pool, giro_id, day(12, 4), "   ", ACTOR).await;
    assert!(refusal.is_err(), "a rejection needs a reason");
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_board_says_what_is_out_what_falls_due_and_what_has_fallen(pool: PgPool) {
    seed(&pool).await;
    // One overdue, one due inside the week, one comfortably ahead.
    for (number, amount, due) in [
        ("BG-1001", 10_000_000, day(9, 20)),
        ("BG-1002", 20_000_000, day(10, 3)),
        ("BG-1003", 30_000_000, day(11, 30)),
    ] {
        let invoice_id = a_bill(&pool, &format!("INV-{number}"), amount).await;
        pay_by_giro(&pool, invoice_id, amount, number, due).await;
    }

    let board = cloud::giro_board(&pool, day(10, 1))
        .await
        .unwrap_or_else(|error| panic!("board: {error}"));
    assert_eq!(board.banks.len(), 1);
    let bca = &board.banks[0];
    assert_eq!(bca.bank, "BCA");
    assert_eq!(bca.count, 3);
    assert_eq!(bca.outstanding_minor, 60_000_000);
    assert_eq!(bca.due_this_week_minor, 20_000_000);
    assert_eq!(bca.overdue_minor, 10_000_000);
    assert_eq!(bca.overdue_count, 1);
    // The single fact this board exists to make visible: what is written
    // against a bank, beside what is in it.
    assert_eq!(bca.bank_balance_minor, Some(0));

    assert_eq!(board.due_this_week.len(), 1);
    assert_eq!(board.due_this_week[0].number, "BG-1002");
    assert_eq!(board.overdue.len(), 1);
    assert_eq!(board.overdue[0].number, "BG-1001");
    assert!(board.overdue[0].days_overdue > 0);

    // A cleared giro leaves the board entirely, which is the same predicate
    // `domain::GiroState::is_outstanding` answers.
    let overdue_id = board.overdue[0].giro_id;
    cloud::giro_clear(&pool, overdue_id, day(10, 1), None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("clear: {error}"));
    let after = cloud::giro_board(&pool, day(10, 1))
        .await
        .unwrap_or_else(|error| panic!("board: {error}"));
    assert_eq!(after.banks[0].outstanding_minor, 50_000_000);
    assert!(after.overdue.is_empty());
}

// ---------------------------------------------------------------------------
// Bank lines, rules and proposals
// ---------------------------------------------------------------------------

fn statement(lines: Vec<ImportStatementLine>) -> ImportStatementRequest {
    ImportStatementRequest {
        account_code: "101100200100".into(),
        site_id: "dc".into(),
        period_start: day(9, 1),
        period_end: day(9, 30),
        opening_minor: 0,
        closing_minor: -35_000,
        source_name: Some("BCA".into()),
        lines,
    }
}

fn charge(number: u32, description: &str, debit: i64, credit: i64) -> ImportStatementLine {
    ImportStatementLine {
        value_date: day(9, number),
        description: description.into(),
        reference: None,
        debit_minor: debit,
        credit_minor: credit,
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_bank_line_becomes_a_document_and_a_match_in_one_transaction(pool: PgPool) {
    seed(&pool).await;
    cloud::import_statement(
        &pool,
        &statement(vec![charge(30, "BIAYA ADM", 35_000, 0)]),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("import: {error}"));
    let line_id: Uuid = sqlx::query("SELECT line_id FROM bank_statement_line LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("line: {error}"))
        .try_get("line_id")
        .unwrap_or_else(|error| panic!("read: {error}"));

    let booked = cloud::book_bank_line(
        &pool,
        line_id,
        &cloud::BookBankLineRequest {
            account_code: "601031000400".into(),
            memo: "biaya administrasi September".into(),
            party_name: Some("Bank BCA".into()),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("book: {error}"));

    // A charge is money leaving, so the line becomes a Kas Keluar with a number
    // the bank's own advice slip can be filed under. It used to be a raw
    // journal entry with nothing to print.
    assert!(booked.number.starts_with("KK-26-09-"), "{}", booked.number);

    let document = cloud::cash_document_read(&pool, booked.document_id)
        .await
        .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(document.kind, "PAY");
    assert_eq!(document.status, "POSTED");
    assert_eq!(document.statement_line_id, Some(line_id));

    let source_kind: String =
        sqlx::query("SELECT source_kind FROM journal_entry WHERE entry_id=$1")
            .bind(booked.entry_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("entry: {error}"))
            .try_get("source_kind")
            .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(source_kind, "CASH_DOC");

    // And the line reads as agreed the moment the entry exists — the window in
    // which an entry exists with nothing pointing at its line is exactly the
    // state a reconciliation is supposed to eliminate.
    let matched: i64 =
        sqlx::query("SELECT COUNT(*)::bigint AS n FROM bank_line_match WHERE line_id = $1")
            .bind(line_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("match: {error}"))
            .try_get("n")
            .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(matched, 1);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_rule_proposes_and_only_a_person_makes_it_money(pool: PgPool) {
    seed(&pool).await;
    cloud::import_statement(
        &pool,
        &statement(vec![
            charge(30, "BIAYA ADM BULANAN", 35_000, 0),
            charge(28, "TRSF E-BANKING DB PT SUMBER", 5_000_000, 0),
        ]),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("import: {error}"));

    let outcome = cloud::bank_rule_evaluate(&pool, None)
        .await
        .unwrap_or_else(|error| panic!("evaluate: {error}"));
    assert_eq!(outcome.examined, 2);
    assert_eq!(outcome.proposed, 1);
    // The number that says whether the rule list is doing anything, reported
    // rather than left to be inferred from a shorter list than expected.
    assert_eq!(outcome.unrecognised, 1);
    // The rule proposes a CATEGORY now (0157), not a key of its own. The key
    // it resolves through is still `bank_admin_fee` and the account below is
    // still Biaya Bank — what changed is that the meaning is declared in one
    // place instead of two.
    assert_eq!(
        outcome.proposals[0].category_code.as_deref(),
        Some("ops_bank_charges")
    );
    assert_eq!(
        outcome.proposals[0].semantic_key, None,
        "the direct key is the fallback for a narration no category covers; a seeded rule has a \
         category, so carrying a key beside it would be the disagreement 0157 removed"
    );

    // Nothing has been posted. That is the whole design: a rule that posted
    // would invent journal entries out of text matching, and the first time a
    // bank reworded a narration it would invent them somewhere wrong.
    let entries: i64 = sqlx::query(
        "SELECT COUNT(*)::bigint AS n FROM journal_entry WHERE source_kind = 'CASH_DOC'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("count: {error}"))
    .try_get("n")
    .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(entries, 0);

    // Running it again proposes nothing further: one open proposal per line,
    // or a screen becomes a list that only grows.
    let again = cloud::bank_rule_evaluate(&pool, None)
        .await
        .unwrap_or_else(|error| panic!("evaluate: {error}"));
    assert_eq!(again.proposed, 0);

    let document = cloud::bank_proposal_accept(&pool, outcome.proposals[0].proposal_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("accept: {error}"));
    assert_eq!(document.status, "POSTED");
    assert!(document
        .number
        .as_deref()
        .unwrap_or_default()
        .starts_with("KK-26-09-"));
    assert_eq!(balance(&pool, "601031000400").await, 35_000);
    assert_eq!(balance(&pool, "101100200100").await, -35_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_greedier_rule_does_not_swallow_the_one_below_it(pool: PgPool) {
    seed(&pool).await;
    // "PAJAK BUNGA" contains "BUNGA" and they are different accounts — one is
    // income, the other tax withheld on it. Priority is the only thing that can
    // separate them, and the seeds are ordered for exactly this line.
    cloud::import_statement(
        &pool,
        &statement(vec![
            charge(30, "PAJAK BUNGA 20%", 2_000, 0),
            charge(30, "BUNGA BANK", 0, 10_000),
        ]),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("import: {error}"));

    let outcome = cloud::bank_rule_evaluate(&pool, None)
        .await
        .unwrap_or_else(|error| panic!("evaluate: {error}"));
    assert_eq!(outcome.proposed, 2);
    let categories: Vec<&str> = outcome
        .proposals
        .iter()
        .filter_map(|proposal| proposal.category_code.as_deref())
        .collect();
    assert!(
        categories.contains(&"finance_tax_on_interest"),
        "{categories:?}"
    );
    assert!(
        categories.contains(&"income_bank_interest"),
        "{categories:?}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_ignored_proposal_stops_being_proposed(pool: PgPool) {
    seed(&pool).await;
    cloud::import_statement(
        &pool,
        &statement(vec![charge(30, "BIAYA ADM", 35_000, 0)]),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("import: {error}"));
    let outcome = cloud::bank_rule_evaluate(&pool, None)
        .await
        .unwrap_or_else(|error| panic!("evaluate: {error}"));

    let ignored = cloud::bank_proposal_ignore(
        &pool,
        outcome.proposals[0].proposal_id,
        Some("sudah dibukukan manual bulan lalu"),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("ignore: {error}"));
    assert_eq!(ignored.status, "IGNORED");

    // A person looked and said no, and that is what stops the same line being
    // proposed forever.
    let again = cloud::bank_rule_evaluate(&pool, None)
        .await
        .unwrap_or_else(|error| panic!("evaluate: {error}"));
    assert_eq!(again.proposed, 0);

    let twice = cloud::bank_proposal_accept(&pool, outcome.proposals[0].proposal_id, ACTOR).await;
    assert!(
        twice.is_err(),
        "an ignored proposal cannot then be accepted"
    );
}

/// A payment body written before giros existed still parses.
///
/// Not pedantry: `frontend-hub` and the seed scripts post this shape, and two
/// new fields on a request type is exactly the change that silently turns every
/// existing caller into a 422. Serde leaves a missing `Option` as `None`, and
/// this is the assertion that says so out loud rather than trusting it.
#[test]
fn a_payment_body_without_the_giro_fields_still_parses() {
    let body = serde_json::json!({
        "site_id": "dc",
        "payment_date": "2026-09-05",
        "method": "TRANSFER",
        "account_key": "bank_giro",
        "account_qualifier": "BCA",
        "allocations": [],
    });
    let parsed: RecordPaymentRequest =
        serde_json::from_value(body).unwrap_or_else(|error| panic!("parse: {error}"));
    assert_eq!(parsed.giro_number, None);
    assert_eq!(parsed.giro_due_date, None);
    assert_eq!(parsed.total_minor, None);
}
