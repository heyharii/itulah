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

/// The map, and two open months. The chart is the migrations' own.
///
/// This used to mint twenty rows of the client's ladder down to twelve-digit
/// per-unit leaves, on the argument that the codes ARE the tree. They were, and
/// they are not any more: 0244 forbade an account that names a unit and 0289
/// replaced the ladder with forty accounts hanging off the roots. What a
/// document names is an account and a category.
async fn seed(pool: &PgPool) {
    for (year, month) in [(2026, 9), (2026, 10)] {
        cloud::open_period(pool, year, month)
            .await
            .unwrap_or_else(|error| panic!("period {year}-{month}: {error}"));
    }
    map(pool, "cash", "", "1101", Some("DRAWER")).await;
    // Giro at BCA, giro at Mandiri and the time deposit are three meanings on
    // one account now: which bank is `bank_account_id`, and `1102` declares no
    // category family at all. The map still narrows by qualifier, which is what
    // keeps `bank_giro`/`MANDIRI` a different ROW even though it resolves to
    // the same code.
    map(pool, "bank_giro", "BCA", "1102", None).await;
    map(pool, "bank_giro", "MANDIRI", "1102", None).await;
    map(pool, "time_deposit", "BCA", "1102", None).await;
    map(pool, "bank_admin_fee", "", "6301", Some("BIAYA_BANK_HO")).await;
    map(pool, "trade_payable", "", "2101", None).await;
}

async fn map(pool: &PgPool, key: &str, qualifier: &str, code: &str, category: Option<&str>) {
    cloud::set_account_mapping(
        pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: key.into(),
            site_id: "dc".into(),
            qualifier: qualifier.into(),
            account_code: code.into(),
            category_code: category.map(str::to_string),
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
        // Refused beside a meaning: the map already chose the pair, and a
        // second answer here could only disagree with it.
        category_code: None,
        site_id: "dc".into(),
    }
}

/// The other way a side is named: a code chosen by the person keying the slip,
/// and — on an account kept by kind — what kind of thing it is.
fn account(code: &str, category: Option<&str>) -> CashSide {
    CashSide {
        semantic_key: None,
        qualifier: String::new(),
        account_code: Some(code.into()),
        category_code: category.map(str::to_string),
        site_id: "dc".into(),
    }
}

/// The repair the slips in this file pay for. Was `601031000500 Biaya Perbaikan
/// HO`; it is `6301` with the client's own words for it now.
fn repairs() -> CashSide {
    account("6301", Some("BIAYA_PERBAIKAN_DAN_PERAWATAN_BANGUNAN"))
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
        None,
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
        &document(meaning("cash", ""), repairs(), 350_000, 3),
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
        &document(repairs(), meaning("bank_giro", "BCA"), 90_000, 3),
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
            &document(meaning("cash", ""), repairs(), 100_000, day),
        )
        .await;
    }
    let october = RecordCashDocumentRequest {
        doc_date: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap_or_else(|| panic!("date")),
        ..document(meaning("cash", ""), repairs(), 100_000, 3)
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
    let document_id = through(&pool, &document(meaning("cash", ""), repairs(), 350_000, 3)).await;

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
        if code == "1101" {
            assert_eq!(credit, 350_000, "the till should be credited");
        }
        if code == "6301" {
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
    let document_id = through(&pool, &document(meaning("cash", ""), repairs(), 350_000, 3)).await;

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
    let document_id = through(&pool, &document(meaning("cash", ""), repairs(), 350_000, 3)).await;

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
           FROM journal_line
          WHERE account_code = '6301'
            AND category_code = 'BIAYA_PERBAIKAN_DAN_PERAWATAN_BANGUNAN'",
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
        &document(account("6301", Some("BIAYA_BANK_HO")), repairs(), 10_000, 3),
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
        &document(meaning("cash", ""), account("1102", None), 1_000_000, 3),
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
        ..document(meaning("cash", ""), repairs(), 2_000_000, 3)
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
        &document(meaning("cash", ""), repairs(), 350_000, 3),
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

    // The Payment Ledger, by name, holds nothing at all: not an item and not
    // an allocation. This is the assertion the whole module is written around.
    for table in ["payment_ledger_entry", "payment_ledger_settlement"] {
        let rows: i64 = sqlx::query(&format!("SELECT COUNT(*)::bigint AS n FROM {table}"))
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("count {table}: {error}"))
            .try_get("n")
            .unwrap_or_else(|error| panic!("read: {error}"));
        assert_eq!(
            rows, 0,
            "a transfer between our own banks put a row in {table}"
        );
    }

    // Two ledger entries, one journal entry, no supplier anywhere on it.
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
    //
    // KNOWN GAP in HOW this can be read. It used to be two account codes with
    // opposite nets; both giros are `1102` now and which bank a line was about
    // is `bank_account_id`. This fixture registers no `company_bank_account`,
    // so the column is null on both legs and the only thing left to assert is
    // that the account nets to nothing across two legs of the stated size.
    //
    // That is weaker, and it is weak for a reason worth writing down: a
    // transfer between two of our own banks is now a debit and a credit on ONE
    // account, and reading it back needs the bank master. Under
    // `bank_giro`/`BCA` and `bank_giro`/`MANDIRI` both mapped at `dc`, `1102`
    // is also what `banking::statement_meaning` will refuse as "mapped by more
    // than one meaning".
    let legs: Vec<i64> = sqlx::query_scalar(
        "SELECT (debit_minor - credit_minor)::bigint FROM journal_line l
           JOIN journal_entry e USING (entry_id)
          WHERE e.source_kind = 'CASH_DOC' AND l.account_code = '1102'
          ORDER BY 1",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("legs: {error}"));
    assert_eq!(
        legs,
        vec![-25_000_000i64, 25_000_000],
        "one account, two legs, opposite and equal"
    );
}

// ---------------------------------------------------------------------------
// The slip
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_slip_carries_the_letterhead_the_title_and_the_amount_in_words(pool: PgPool) {
    seed(&pool).await;
    let document_id = through(
        &pool,
        &document(meaning("cash", ""), repairs(), 2_500_000, 3),
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
    assert_eq!(slip.from.account_name, "Kas");
    assert_eq!(slip.from.account_code, "1101");

    assert_eq!(slip.prepared_by, ACTOR);
    assert_eq!(slip.approved_by.as_deref(), Some(CHECKER));
    // Never filled by the system. Printing a name against "diperiksa" would be
    // the system claiming somebody checked what they have not seen.
    assert_eq!(slip.checked_by, None);
}

/// A posted bill and the payable it raised, in one transaction, the way
/// `post_bill` writes them.
///
/// It stands in for the real thing rather than calling it: this module's chart
/// has no inventory and no supplier tables, and what these two tests are about
/// is the cash document, not how the debt got there.
async fn a_bill_still_open(pool: &PgPool, amount: i64) {
    use inventory_backend::cloud::postgres::{
        PaymentLedgerItem, PaymentLedgerPartyType, PaymentLedgerSide, PostingIntent, PostingLine,
    };
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posted = cloud::post(
        &mut tx,
        &PostingIntent {
            posting_date: september(1),
            source_kind: "SUPPLIER_INVOICE".into(),
            source_id: Some("INV-88".into()),
            rule_version: "supplier_invoice/1".into(),
            currency: "IDR".into(),
            memo: Some("Faktur pemasok".into()),
            lines: vec![
                PostingLine::debit("bank_admin_fee", "dc", amount),
                PostingLine::credit("trade_payable", "dc", amount).for_supplier("SUP01"),
            ],
        },
        None,
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post bill: {error}"));
    cloud::ple_open(
        &mut tx,
        &PaymentLedgerItem {
            account_key: "trade_payable".into(),
            qualifier: String::new(),
            site_id: "dc".into(),
            party_type: PaymentLedgerPartyType::Supplier,
            party_id: "SUP01".into(),
            party_name: Some("PT Sumber Jaya".into()),
            voucher_kind: "SUPPLIER_INVOICE".into(),
            voucher_id: "INV-88".into(),
            journal_entry_id: posted.entry_id,
            side: PaymentLedgerSide::Payable,
            amount_minor: amount,
            currency: "IDR".into(),
            due_date: Some(september(30)),
            posting_date: september(1),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("open: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));
}

/// A slip that takes money out of the bank and puts it against the payable.
///
/// Keyed before the bill exists, which is why `cash_draft_from` allows it: its
/// refusal is about a supplier who has bills open on Payables at the moment
/// somebody keys the slip, and it is checked then rather than at posting.
fn a_supplier_slip(amount: i64) -> RecordCashDocumentRequest {
    RecordCashDocumentRequest {
        party_kind: Some("SUPPLIER".into()),
        supplier_id: Some("SUP01".into()),
        party_name: "PT Sumber Jaya".into(),
        ..document(
            meaning("bank_giro", "BCA"),
            meaning("trade_payable", ""),
            amount,
            9,
        )
    }
}

/// What the report says about the trade payable, having first insisted that
/// every control account in it agrees.
async fn payable_control(
    pool: &PgPool,
) -> inventory_backend::cloud::postgres::PaymentLedgerIntegrityRow {
    let as_of = september(30).max(chrono::Utc::now().date_naive());
    let integrity = cloud::payment_ledger_integrity(pool, Some(as_of), None)
        .await
        .unwrap_or_else(|error| panic!("integrity: {error}"));
    assert!(
        integrity.agrees,
        "the Payment Ledger and the books disagree: {:?}",
        integrity
            .rows
            .iter()
            .map(|row| (row.account_key.clone(), row.difference_minor))
            .collect::<Vec<_>>()
    );
    integrity
        .rows
        .into_iter()
        .find(|row| row.account_key == "trade_payable")
        .unwrap_or_else(|| panic!("no trade payable row in the integrity report"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_slip_that_lands_on_the_payable_closes_the_item_it_landed_on(pool: PgPool) {
    seed(&pool).await;
    let keyed = cloud::cash_document_record(&pool, &a_supplier_slip(8_500_000), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("record: {error}"));

    a_bill_still_open(&pool, 8_500_000).await;
    let owed = payable_control(&pool).await;
    assert_eq!(owed.ledger_outstanding_minor, 8_500_000);
    assert_eq!(owed.gl_balance_minor, 8_500_000);

    cloud::cash_document_approve(&pool, keyed.document_id, CHECKER)
        .await
        .unwrap_or_else(|error| panic!("approve: {error}"));
    cloud::cash_document_post(&pool, keyed.document_id, None, CHECKER)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));

    // The entry debited `trade_payable`, so the item it debited is answered by
    // the same amount. Both readings of the same money, and they agree.
    let settled = payable_control(&pool).await;
    assert_eq!(settled.ledger_outstanding_minor, 0);
    assert_eq!(settled.gl_balance_minor, 0);
    assert_eq!(settled.open_items, 0);

    // And the settlement names the slip, which is how somebody looking at the
    // bill finds out what answered it.
    let history = cloud::payment_ledger_settlements(&pool, "SUPPLIER_INVOICE", "INV-88")
        .await
        .unwrap_or_else(|error| panic!("settlements: {error}"));
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].against_voucher_kind, "CASH_DOC");
    assert_eq!(history[0].against_voucher_id, keyed.document_id.to_string());
    assert_eq!(history[0].amount_minor, 8_500_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_slip_for_part_of_a_debt_leaves_the_rest_on_both_sides(pool: PgPool) {
    seed(&pool).await;
    let keyed = cloud::cash_document_record(&pool, &a_supplier_slip(3_000_000), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("record: {error}"));
    a_bill_still_open(&pool, 8_500_000).await;
    cloud::cash_document_approve(&pool, keyed.document_id, CHECKER)
        .await
        .unwrap_or_else(|error| panic!("approve: {error}"));
    cloud::cash_document_post(&pool, keyed.document_id, None, CHECKER)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));

    let part_paid = payable_control(&pool).await;
    assert_eq!(part_paid.ledger_outstanding_minor, 5_500_000);
    assert_eq!(part_paid.gl_balance_minor, 5_500_000);
    assert_eq!(part_paid.difference_minor, 0);
    assert_eq!(part_paid.open_items, 1);

    // Reversing the slip puts the whole debt back, on both sides at once.
    cloud::cash_document_reverse(
        &pool,
        keyed.document_id,
        Some(september(20)),
        "paid the wrong supplier",
        CHECKER,
    )
    .await
    .unwrap_or_else(|error| panic!("reverse: {error}"));
    let reversed = payable_control(&pool).await;
    assert_eq!(reversed.ledger_outstanding_minor, 8_500_000);
    assert_eq!(reversed.gl_balance_minor, 8_500_000);
}
