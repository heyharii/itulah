//! The cash document, against a real Postgres.
//!
//! What the kernel decides — the kind, the number, the words — is unit-tested
//! beside it and property-tested in `finance_properties`. What is checked here
//! is everything the kernel cannot see: that the counter really is per kind per
//! month under a lock, that the refusals fire against actual rows, that a bank
//! line becomes a document AND a match in one transaction, and that a plain
//! transfer between two of the company's own banks tells the Payment Ledger
//! nothing at all.
//!
//! That last one is the assertion that will age best. The Payment Ledger holds
//! receivables and payables with a balance outstanding; money moving is not a
//! reason to be in it. The temptation, once Lane P's ledger exists, will be to
//! write an entry for every document because every document moves money — so
//! there is a test standing in the way of it.

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{self as cloud, CashSide, RecordCashDocumentRequest};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
const CHECKER: &str = "budi";

type ChartRow = (
    &'static str,
    &'static str,
    Option<&'static str>,
    bool,
    Option<&'static str>,
);

/// Enough of the client's chart to move money four ways.
///
/// Their codes, not invented ones, because the codes ARE the tree: a balance
/// rolls up by prefix, and leaves hanging off the roots would pass tests a real
/// chart fails.
async fn seed(pool: &PgPool) {
    let rows: [ChartRow; 20] = [
        ("1", "ASSET", None, true, None),
        ("101", "CURRENT ASSET", Some("1"), true, None),
        ("10110", "KAS & SETARA KAS", Some("101"), true, None),
        ("1011001", "CASH ON HAND", Some("10110"), true, None),
        (
            "101100100100",
            "Cash On Hand HO",
            Some("1011001"),
            false,
            Some("dc"),
        ),
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
        ("1011004", "TIME DEPOSIT", Some("10110"), true, None),
        (
            "101100400100",
            "TIME DEPOSIT BANK BCA HO",
            Some("1011004"),
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
        ("6", "BEBAN USAHA", None, true, None),
        ("60103", "BIAYA KANTOR", Some("6"), true, None),
        ("6010310", "BIAYA UMUM KANTOR", Some("60103"), true, None),
        (
            "601031000400",
            "Biaya Bank HO",
            Some("6010310"),
            false,
            Some("dc"),
        ),
        (
            "601031000500",
            "Biaya Perbaikan HO",
            Some("6010310"),
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
    for (year, month) in [(2026, 9), (2026, 10)] {
        cloud::open_period(pool, year, month)
            .await
            .unwrap_or_else(|error| panic!("period {year}-{month}: {error}"));
    }
    map(pool, "cash", "", "101100100100").await;
    map(pool, "bank_giro", "BCA", "101100200100").await;
    map(pool, "bank_giro", "MANDIRI", "101100200200").await;
    map(pool, "time_deposit", "BCA", "101100400100").await;
    map(pool, "bank_admin_fee", "", "601031000400").await;
    map(pool, "trade_payable", "", "201200100100").await;
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

fn september(day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, day).unwrap_or_else(|| panic!("bad date"))
}

fn meaning(key: &str, qualifier: &str) -> CashSide {
    CashSide {
        semantic_key: Some(key.into()),
        qualifier: qualifier.into(),
        account_code: None,
        site_id: "dc".into(),
    }
}

fn account(code: &str) -> CashSide {
    CashSide {
        semantic_key: None,
        qualifier: String::new(),
        account_code: Some(code.into()),
        site_id: "dc".into(),
    }
}

fn document(from: CashSide, to: CashSide, amount: i64, day: u32) -> RecordCashDocumentRequest {
    RecordCashDocumentRequest {
        doc_date: september(day),
        from,
        to,
        amount_minor: amount,
        party_kind: None,
        supplier_id: None,
        employee_id: None,
        party_name: "Pak Slamet".into(),
        memo: "perbaikan AC toko".into(),
        attachment_file_id: None,
    }
}

/// A real posted entry standing in for a bill's, so a fixture bill can be
/// POSTED without the schema refusing it: `supplier_invoice` insists that
/// posted and in-the-ledger are the same fact.
async fn post_a_bill(pool: &PgPool, amount: i64) -> Uuid {
    use inventory_backend::cloud::postgres::{PostingIntent, PostingLine};
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posted = cloud::post(
        &mut tx,
        &PostingIntent {
            posting_date: september(1),
            source_kind: "SUPPLIER_INVOICE".into(),
            source_id: Some("INV-77".into()),
            rule_version: "supplier_invoice/1".into(),
            currency: "IDR".into(),
            memo: Some("Faktur pemasok".into()),
            lines: vec![
                PostingLine::debit("bank_admin_fee", "dc", amount),
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
    posted.entry_id
}

/// Key, approve, post — the three acts, in one line for the tests that are
/// about something else.
async fn through(pool: &PgPool, request: &RecordCashDocumentRequest) -> Uuid {
    let keyed = cloud::cash_document_record(pool, request, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("record: {error}"));
    cloud::cash_document_approve(pool, keyed.document_id, CHECKER)
        .await
        .unwrap_or_else(|error| panic!("approve: {error}"));
    cloud::cash_document_post(pool, keyed.document_id, None, CHECKER)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    keyed.document_id
}

// ---------------------------------------------------------------------------
// The kind, and the number that follows from it
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_three_kinds_take_the_three_prefixes(pool: PgPool) {
    seed(&pool).await;

    // Out of the till into an expense: Kas Keluar.
    let pay = cloud::cash_document_record(
        &pool,
        &document(meaning("cash", ""), account("601031000500"), 350_000, 3),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("pay: {error}"));
    assert_eq!(pay.kind, "PAY");
    // Nothing is numbered until somebody approves it: a draft that is
    // abandoned must burn no number out of a file people check for gaps.
    assert_eq!(pay.number, None);

    // Into the bank from nowhere in particular: Kas Masuk.
    let receive = cloud::cash_document_record(
        &pool,
        &document(
            account("601031000500"),
            meaning("bank_giro", "BCA"),
            90_000,
            3,
        ),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("receive: {error}"));
    assert_eq!(receive.kind, "RECEIVE");

    // Two of our own: a transfer, and no expense or income anywhere.
    let transfer = cloud::cash_document_record(
        &pool,
        &document(
            meaning("bank_giro", "BCA"),
            meaning("time_deposit", "BCA"),
            50_000_000,
            3,
        ),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("transfer: {error}"));
    assert_eq!(transfer.kind, "TRANSFER");

    for (id, prefix) in [
        (pay.document_id, "KK-26-09-"),
        (receive.document_id, "KM-26-09-"),
        (transfer.document_id, "TF-26-09-"),
    ] {
        let approved = cloud::cash_document_approve(&pool, id, CHECKER)
            .await
            .unwrap_or_else(|error| panic!("approve: {error}"));
        let number = approved.number.unwrap_or_else(|| panic!("no number"));
        assert!(
            number.starts_with(prefix),
            "expected {prefix}…, got {number}"
        );
        // Each kind counts from one in its own month: three documents, three
        // number ones.
        assert!(number.ends_with("00001"), "{number} should be the first");
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_counter_starts_again_in_the_next_month_and_not_before(pool: PgPool) {
    seed(&pool).await;

    for day in [3, 4, 5] {
        through(
            &pool,
            &document(meaning("cash", ""), account("601031000500"), 100_000, day),
        )
        .await;
    }
    let october = RecordCashDocumentRequest {
        doc_date: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap_or_else(|| panic!("date")),
        ..document(meaning("cash", ""), account("601031000500"), 100_000, 3)
    };
    let fourth = cloud::cash_document_record(&pool, &october, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("record: {error}"));
    let numbered = cloud::cash_document_approve(&pool, fourth.document_id, CHECKER)
        .await
        .unwrap_or_else(|error| panic!("approve: {error}"));

    // The month is IN the number, so the counter cannot drift away from the
    // label: September ran to three, October starts at one.
    assert_eq!(numbered.number.as_deref(), Some("KK-26-10-00001"));

    let last: i32 = sqlx::query(
        "SELECT last_no FROM cash_document_sequence WHERE kind='PAY' AND yyyymm=202609",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("counter: {error}"))
    .try_get("last_no")
    .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(last, 3);
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_posted_document_debits_where_it_went_and_credits_where_it_came_from(pool: PgPool) {
    seed(&pool).await;
    let document_id = through(
        &pool,
        &document(meaning("cash", ""), account("601031000500"), 350_000, 3),
    )
    .await;

    let read = cloud::cash_document_read(&pool, document_id)
        .await
        .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(read.status, "POSTED");
    let entry_id = read
        .journal_entry_id
        .unwrap_or_else(|| panic!("posted with no entry"));

    let lines = sqlx::query(
        "SELECT account_code, debit_minor, credit_minor FROM journal_line
          WHERE entry_id = $1 ORDER BY line_number",
    )
    .bind(entry_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("lines: {error}"));
    assert_eq!(lines.len(), 2);

    let mut debits = 0i64;
    let mut credits = 0i64;
    for line in &lines {
        let code: String = line.try_get("account_code").unwrap_or_default();
        let debit: i64 = line.try_get("debit_minor").unwrap_or_default();
        let credit: i64 = line.try_get("credit_minor").unwrap_or_default();
        debits += debit;
        credits += credit;
        // The money left the till, so the till is credited and the expense
        // takes the debit. Getting this backwards is the mistake that balances.
        if code == "101100100100" {
            assert_eq!(credit, 350_000, "the till should be credited");
        }
        if code == "601031000500" {
            assert_eq!(debit, 350_000, "the expense should be debited");
        }
    }
    assert_eq!(debits, credits);
    assert_eq!(debits, 350_000);

    let kind: String = sqlx::query("SELECT source_kind FROM journal_entry WHERE entry_id = $1")
        .bind(entry_id)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("entry: {error}"))
        .try_get("source_kind")
        .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(kind, "CASH_DOC");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn posting_twice_is_refused_and_says_so_in_words(pool: PgPool) {
    seed(&pool).await;
    let document_id = through(
        &pool,
        &document(meaning("cash", ""), account("601031000500"), 350_000, 3),
    )
    .await;

    let again = cloud::cash_document_post(&pool, document_id, None, CHECKER).await;
    let message = match again {
        Ok(_) => panic!("posted the same document twice"),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains("already in the ledger"),
        "the refusal should say it is already there, said: {message}"
    );

    // And exactly one entry exists, which is the fact the message is about.
    let entries: i64 =
        sqlx::query("SELECT COUNT(*)::bigint AS n FROM journal_entry WHERE source_kind='CASH_DOC'")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("count: {error}"))
            .try_get("n")
            .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(entries, 1);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_reversal_mirrors_the_entry_and_the_original_stays_posted(pool: PgPool) {
    seed(&pool).await;
    let document_id = through(
        &pool,
        &document(meaning("cash", ""), account("601031000500"), 350_000, 3),
    )
    .await;

    let reversed = cloud::cash_document_reverse(
        &pool,
        document_id,
        None,
        "the repair was paid by the landlord",
        CHECKER,
    )
    .await
    .unwrap_or_else(|error| panic!("reverse: {error}"));
    assert_eq!(reversed.status, "REVERSED");
    // The entry that recorded it is still there. A slip already in a file with
    // a number on it does not stop existing because somebody undid it.
    assert!(reversed.journal_entry_id.is_some());
    assert!(reversed.reversal_entry_id.is_some());
    assert!(reversed.number.is_some());

    let net: i64 = sqlx::query(
        "SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::bigint AS net
           FROM journal_line WHERE account_code = '601031000500'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("net: {error}"))
    .try_get("net")
    .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(net, 0, "the reversal should leave the expense at nothing");

    let twice = cloud::cash_document_reverse(&pool, document_id, None, "again", CHECKER).await;
    assert!(
        twice.is_err(),
        "a reversed document cannot be reversed twice"
    );
}

// ---------------------------------------------------------------------------
// The refusals
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn two_accounts_that_hold_no_money_is_not_a_cash_document(pool: PgPool) {
    seed(&pool).await;
    // Rent prepaid becoming rent expensed is a reclassification, and it belongs
    // in the journal where somebody has to justify it. Letting it through here
    // would make the cash document the back door the manual-journal guard
    // exists to close.
    let refusal = cloud::cash_document_record(
        &pool,
        &document(account("601031000400"), account("601031000500"), 10_000, 3),
        ACTOR,
    )
    .await;
    let message = match refusal {
        Ok(row) => panic!("keyed {} with no money on either side", row.kind),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains("reclassification"),
        "the refusal should name what this actually is, said: {message}"
    );
    assert!(
        message.contains("cash"),
        "the refusal should list the meanings that hold money, said: {message}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn naming_a_bank_by_its_code_is_refused_rather_than_mislabelled(pool: PgPool) {
    seed(&pool).await;
    // A person who types the BCA giro's own code is describing a transfer, and
    // the document would head the slip BUKTI KAS KELUAR over an entry that only
    // moved money between two pots we hold.
    let refusal = cloud::cash_document_record(
        &pool,
        &document(meaning("cash", ""), account("101100200100"), 1_000_000, 3),
        ACTOR,
    )
    .await;
    let message = match refusal {
        Ok(row) => panic!("keyed a {} against a bank account by code", row.kind),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains("bank_giro"),
        "the refusal should name the meaning to use instead, said: {message}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_supplier_with_open_bills_is_sent_to_payables(pool: PgPool) {
    seed(&pool).await;
    // A posted bill nobody has paid. Not a draft: `open_bills_for` counts what
    // Payables counts, and Payables counts posted bills — so the fixture has to
    // be one, entry and all. `supplier_invoice.supplier_id` is text and not a
    // foreign key, deliberately (see 0115), so the supplier row is not needed
    // for the bill to exist.
    let entry_id = post_a_bill(&pool, 8_500_000).await;
    sqlx::query(
        "INSERT INTO supplier_invoice
           (invoice_id, invoice_number, supplier_id, supplier_name, site_id, invoice_date,
            subtotal_minor, tax_minor, discount_minor, total_minor,
            status, kind, currency, recorded_by, journal_entry_id, posted_by, posted_at)
         VALUES ($1, 'INV-77', 'SUP01', 'PT Sumber Jaya', 'dc', $2,
                 8500000, 0, 0, 8500000,
                 'POSTED', 'MERCHANDISE', 'IDR', $3, $4, $3, now())",
    )
    .bind(Uuid::new_v4())
    .bind(september(1))
    .bind(ACTOR)
    .bind(entry_id)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("bill: {error}"));

    let request = RecordCashDocumentRequest {
        party_kind: Some("SUPPLIER".into()),
        supplier_id: Some("SUP01".into()),
        party_name: "PT Sumber Jaya".into(),
        ..document(meaning("cash", ""), account("601031000500"), 2_000_000, 3)
    };
    let refusal = cloud::cash_document_record(&pool, &request, ACTOR).await;
    let message = match refusal {
        Ok(_) => panic!("paid a supplier from here while they had bills open"),
        Err(error) => error.to_string(),
    };
    // Money that answers no particular debt leaves an ageing showing a supplier
    // who has been paid and still owes everything.
    assert!(
        message.contains("Payables"),
        "the refusal should point at the screen that allocates, said: {message}"
    );
    assert!(
        message.contains("1 bill"),
        "the refusal should say how many, said: {message}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn posting_before_approving_is_refused_because_a_slip_needs_a_number(pool: PgPool) {
    seed(&pool).await;
    let keyed = cloud::cash_document_record(
        &pool,
        &document(meaning("cash", ""), account("601031000500"), 350_000, 3),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("record: {error}"));

    let refusal = cloud::cash_document_post(&pool, keyed.document_id, None, CHECKER).await;
    let message = match refusal {
        Ok(_) => panic!("posted a draft"),
        Err(error) => error.to_string(),
    };
    assert!(message.contains("not been approved"), "said: {message}");
}

// ---------------------------------------------------------------------------
// The Payment Ledger, and what does not belong in it
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_transfer_between_our_own_banks_settles_nothing(pool: PgPool) {
    seed(&pool).await;
    // Money moving is not, on its own, a reason to be in the Payment Ledger:
    // that ledger holds receivables and payables with a balance outstanding,
    // and nobody is owed anything when a company moves its own money between
    // its own accounts.
    //
    // Lane P has not merged, so the assertion is written against what a
    // settling path would leave behind rather than against a mock: the document
    // names no party, so `cash_document_settle_payment_ledger` returns on its
    // first line and no table anywhere gains a row.
    let document_id = through(
        &pool,
        &document(
            meaning("bank_giro", "BCA"),
            meaning("bank_giro", "MANDIRI"),
            25_000_000,
            9,
        ),
    )
    .await;

    let read = cloud::cash_document_read(&pool, document_id)
        .await
        .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(read.kind, "TRANSFER");
    assert_eq!(read.party_kind, "OTHER");
    assert_eq!(read.supplier_id, None);

    // Two ledger entries, one journal entry, no supplier anywhere on it. When
    // Lane P lands, the Payment Ledger table joins this assertion by name; the
    // shape of the claim does not change.
    let supplier_lines: i64 = sqlx::query(
        "SELECT COUNT(*)::bigint AS n FROM journal_line l
           JOIN journal_entry e USING (entry_id)
          WHERE e.source_kind = 'CASH_DOC' AND l.supplier_id IS NOT NULL",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("count: {error}"))
    .try_get("n")
    .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(
        supplier_lines, 0,
        "a transfer between our own banks owes nobody anything"
    );

    // And it moved the two banks in opposite directions by the same amount,
    // which is the whole of what a transfer is.
    for (code, expected) in [
        ("101100200100", -25_000_000i64),
        ("101100200200", 25_000_000),
    ] {
        let net: i64 = sqlx::query(
            "SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::bigint AS net
               FROM journal_line WHERE account_code = $1",
        )
        .bind(code)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("net: {error}"))
        .try_get("net")
        .unwrap_or_else(|error| panic!("read: {error}"));
        assert_eq!(net, expected, "{code}");
    }
}

// ---------------------------------------------------------------------------
// The slip
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_slip_carries_the_letterhead_the_title_and_the_amount_in_words(pool: PgPool) {
    seed(&pool).await;
    let document_id = through(
        &pool,
        &document(meaning("cash", ""), account("601031000500"), 2_500_000, 3),
    )
    .await;

    let slip = cloud::cash_document_slip(&pool, document_id)
        .await
        .unwrap_or_else(|error| panic!("slip: {error}"));

    assert_eq!(slip.title, "BUKTI KAS KELUAR");
    assert_eq!(slip.company_name, "CENTRAL FASHION STORE");
    // The line that makes a 1 added to the front of a figure visible.
    assert_eq!(slip.amount_in_words, "Dua juta lima ratus ribu rupiah");
    // The client's own name for the account, untranslated: an accountant looks
    // for the string they know.
    assert_eq!(slip.from.account_name, "Cash On Hand HO");
    assert_eq!(slip.from.account_code, "101100100100");

    assert_eq!(slip.prepared_by, ACTOR);
    assert_eq!(slip.approved_by.as_deref(), Some(CHECKER));
    // Never filled by the system. Printing a name against "diperiksa" would be
    // the system claiming somebody checked what they have not seen.
    assert_eq!(slip.checked_by, None);
}
