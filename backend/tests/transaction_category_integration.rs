//! Categories, and the three doors out of a bank statement line.
//!
//! What the kernel decides — direction, refusal, what is still missing — is
//! unit-tested beside it, exhaustively and without a database. What is checked
//! here is everything the kernel cannot see:
//!
//!   * that a category plus a location really does come out as the client's own
//!     twelve-digit code, through `account_map` and nothing else;
//!   * that categorising produces one cash document and one balanced entry, and
//!     never a journal written straight off a statement line;
//!   * that the categories a person may not choose refuse them by name, and say
//!     which document to go and find;
//!   * that the options endpoint puts matches ahead of categories, in the
//!     serialised JSON a browser actually receives.
//!
//! The last one is the assertion most likely to be argued with, and it is the
//! one worth keeping. Categorising is the fastest of the three doors and is
//! always available, so a screen that showed it first would get it used on
//! every line whose payment was one door away. Each of those is an expense
//! recognised twice in books that still balance, which is the class of error
//! nobody finds until a year-end.

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{
    self as cloud, CategoriseBankLineRequest, ImportStatementLine, ImportStatementRequest,
    RecordBankRuleRequest, RecordTransactionCategoryRequest,
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

/// Enough of the client's chart to explain a statement two ways.
///
/// Their codes, and their two-digit location suffix: `601031000400` is Biaya
/// Bank at head office and `601031000401` the same expense at store 01. Both
/// are here because the point of a category is that it means one thing and
/// lands on a different leaf per place, and a fixture with one leaf could not
/// tell that from a category that hard-codes a code.
async fn seed(pool: &PgPool) {
    let rows: [ChartRow; 14] = [
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
        ("2", "LIABILITIES", None, true, None),
        ("20120", "HUTANG DAGANG", Some("2"), true, None),
        ("2012001", "HUTANG SUPPLIER", Some("20120"), true, None),
        (
            "201200100100",
            "Hutang Suppliers Barang Dagangan HO",
            Some("2012001"),
            false,
            Some("dc"),
        ),
        ("6", "BEBAN USAHA", None, true, None),
        (
            "6010310",
            "BIAYA ADMINISTRASI DAN UMUM",
            Some("6"),
            true,
            None,
        ),
        (
            "601031000400",
            "Biaya Bank HO",
            Some("6010310"),
            false,
            Some("dc"),
        ),
        (
            "601031000401",
            "Biaya Bank C001",
            Some("6010310"),
            false,
            Some("store-01"),
        ),
        ("8", "PENDAPATAN LAIN", None, true, None),
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
    for month in [9, 10] {
        cloud::open_period(pool, 2026, month)
            .await
            .unwrap_or_else(|error| panic!("period {month}: {error}"));
    }
    map(pool, "dc", "bank_giro", "BCA", "101100200100").await;
    map(pool, "dc", "bank_admin_fee", "", "601031000400").await;
    map(pool, "store-01", "bank_admin_fee", "", "601031000401").await;
    map(pool, "dc", "trade_payable", "", "201200100100").await;
}

async fn map(pool: &PgPool, site: &str, key: &str, qualifier: &str, code: &str) {
    cloud::set_account_mapping(
        pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: key.into(),
            site_id: site.into(),
            qualifier: qualifier.into(),
            account_code: code.into(),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("map {key}/{qualifier} at {site}: {error}"));
}

fn day(number: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, number).unwrap_or_else(|| panic!("bad date"))
}

fn statement(lines: Vec<ImportStatementLine>) -> ImportStatementRequest {
    ImportStatementRequest {
        account_code: "101100200100".into(),
        site_id: "dc".into(),
        period_start: day(1),
        period_end: day(30),
        opening_minor: 0,
        closing_minor: 0,
        source_name: Some("BCA".into()),
        lines,
    }
}

fn line(number: u32, description: &str, debit: i64, credit: i64) -> ImportStatementLine {
    ImportStatementLine {
        value_date: day(number),
        description: description.into(),
        reference: None,
        debit_minor: debit,
        credit_minor: credit,
    }
}

/// Import a statement and hand back its lines in the order they were given.
async fn import(pool: &PgPool, lines: Vec<ImportStatementLine>) -> Vec<Uuid> {
    cloud::import_statement(pool, &statement(lines), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("import: {error}"));
    sqlx::query("SELECT line_id FROM bank_statement_line ORDER BY line_number")
        .fetch_all(pool)
        .await
        .unwrap_or_else(|error| panic!("lines: {error}"))
        .iter()
        .map(|row| {
            row.try_get("line_id")
                .unwrap_or_else(|error| panic!("read: {error}"))
        })
        .collect()
}

fn explain(category: &str, memo: &str) -> CategoriseBankLineRequest {
    CategoriseBankLineRequest {
        category_code: category.into(),
        qualifier: None,
        party_name: Some("Bank BCA".into()),
        reference: None,
        memo: memo.into(),
        proposal_id: None,
    }
}

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

async fn count(pool: &PgPool, sql: &str) -> i64 {
    sqlx::query(sql)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("{sql}: {error}"))
        .try_get("n")
        .unwrap_or_else(|error| panic!("read: {error}"))
}

// ---------------------------------------------------------------------------
// A category plus a place is a client account code
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_category_and_a_location_resolve_to_the_client_own_code(pool: PgPool) {
    seed(&pool).await;

    let at_head_office = cloud::transaction_category_read(&pool, "ops_bank_charges", Some("dc"))
        .await
        .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(at_head_office.semantic_key, "bank_admin_fee");
    assert_eq!(
        at_head_office.account_code.as_deref(),
        Some("601031000400"),
        "one category, resolved at head office"
    );
    assert_eq!(
        at_head_office.account_name.as_deref(),
        Some("Biaya Bank HO")
    );

    // The same category at a shop. Nothing about the category changed; the map
    // answered for a different place.
    let at_the_shop = cloud::transaction_category_read(&pool, "ops_bank_charges", Some("store-01"))
        .await
        .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(at_the_shop.code, at_head_office.code);
    assert_eq!(at_the_shop.account_code.as_deref(), Some("601031000401"));

    // And the expectation quoted from the client's chart is the ten-digit
    // template both leaves hang off, not either leaf.
    assert_eq!(
        at_head_office.expects_account_code.as_deref(),
        Some("6010310004")
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_category_whose_meaning_nobody_mapped_still_lists_and_says_so(pool: PgPool) {
    seed(&pool).await;

    // Nothing in the fixture maps `rent_store`. The category is still on the
    // list — hiding it would hide the thing that has to be fixed — and its
    // account is honestly absent.
    let rent = cloud::transaction_category_read(&pool, "rent_store", Some("dc"))
        .await
        .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(rent.account_code, None);
    assert_eq!(
        rent.expects_account_name.as_deref(),
        Some("Biaya Sewa Bangunan Toko dan Gudang"),
        "the client's own words, so whoever maps it knows what to look for"
    );

    let unmapped = cloud::transaction_category_unmapped(&pool, Some("dc"))
        .await
        .unwrap_or_else(|error| panic!("unmapped: {error}"));
    assert!(unmapped.iter().any(|row| row.code == "rent_store"));
    assert!(
        !unmapped.iter().any(|row| row.code == "ops_bank_charges"),
        "the fixture mapped bank charges, so it is not on the list of gaps"
    );
}

// ---------------------------------------------------------------------------
// Door three, taken
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_bank_charge_categorised_makes_one_document_and_one_balanced_entry(pool: PgPool) {
    seed(&pool).await;
    let lines = import(&pool, vec![line(30, "BIAYA ADM BULANAN", 35_000, 0)]).await;

    let document = cloud::bank_line_categorise(
        &pool,
        lines[0],
        &explain("ops_bank_charges", "biaya administrasi bulanan"),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("categorise: {error}"));

    // A slip, not a journal entry somebody typed. Money out of the bank is Kas
    // Keluar and the number says so.
    assert_eq!(document.kind, "PAY");
    assert_eq!(document.status, "POSTED");
    assert!(document
        .number
        .as_deref()
        .unwrap_or_default()
        .starts_with("KK-26-09-"));
    assert_eq!(document.amount_minor, 35_000);

    // The label survives beside the accounts, which is the half a remapped
    // chart would otherwise lose.
    let category: Option<String> =
        sqlx::query("SELECT category_code FROM cash_document WHERE document_id = $1")
            .bind(document.document_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("read: {error}"))
            .try_get("category_code")
            .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(category.as_deref(), Some("ops_bank_charges"));

    // One entry, and it is the document's — never a `BANK_STATEMENT` journal
    // written off the line. That distinction is the whole of requirement three
    // and it is invisible in a trial balance, so it is asserted here.
    assert_eq!(
        count(
            &pool,
            "SELECT COUNT(*)::bigint AS n FROM journal_entry WHERE source_kind = 'CASH_DOC'"
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &pool,
            "SELECT COUNT(*)::bigint AS n FROM journal_entry WHERE source_kind = 'BANK_STATEMENT'"
        )
        .await,
        0,
        "no journal is written straight from a statement line"
    );
    assert_eq!(
        count(&pool, "SELECT COUNT(*)::bigint AS n FROM cash_document").await,
        1
    );

    // Debited the expense, credited the bank, and it balances.
    assert_eq!(balance(&pool, "601031000400").await, 35_000);
    assert_eq!(balance(&pool, "101100200100").await, -35_000);

    // And the line is agreed with the entry, so it cannot be explained twice.
    assert_eq!(
        count(&pool, "SELECT COUNT(*)::bigint AS n FROM bank_line_match").await,
        1
    );
    let twice =
        cloud::bank_line_categorise(&pool, lines[0], &explain("ops_bank_charges", "lagi"), ACTOR)
            .await;
    assert!(twice.is_err(), "one line explains itself once");
}

// ---------------------------------------------------------------------------
// The categories that exist only to be refused
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_salary_line_refuses_categorisation_and_names_the_payroll_run(pool: PgPool) {
    seed(&pool).await;
    let lines = import(
        &pool,
        vec![line(25, "TRSF GAJI KARYAWAN SEPTEMBER", 48_000_000, 0)],
    )
    .await;

    let refused = cloud::bank_line_categorise(
        &pool,
        lines[0],
        &explain("payroll_salary_operations", "gaji september"),
        ACTOR,
    )
    .await;
    let message = format!("{}", refused.expect_err("payroll cannot be categorised"));
    assert!(
        message.contains("payroll run"),
        "the refusal names the document to find instead: {message}"
    );
    assert!(
        message.contains("find the payment"),
        "and says what to do: {message}"
    );

    // Nothing was written on the way to being refused.
    assert_eq!(
        count(&pool, "SELECT COUNT(*)::bigint AS n FROM cash_document").await,
        0
    );
    assert_eq!(
        count(&pool, "SELECT COUNT(*)::bigint AS n FROM journal_entry").await,
        0
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_refusable_family_says_which_document_to_find(pool: PgPool) {
    seed(&pool).await;
    let lines = import(
        &pool,
        vec![
            line(20, "TRSF KE PT SUMBER JAYA", 12_000_000, 0),
            line(21, "SETTLEMENT BCA MERCHANT", 0, 9_500_000),
        ],
    )
    .await;

    for (line_index, category, expected) in [
        (0usize, "payable_supplier", "bill"),
        (0, "inventory_merchandise", "goods receipt"),
        (0, "depreciation_charge", "monthly run"),
        (1, "acquirer_credit_card", "settlement"),
        (1, "sales_cash", "till"),
    ] {
        let refused = cloud::bank_line_categorise(
            &pool,
            lines[line_index],
            &explain(category, "apa ini"),
            ACTOR,
        )
        .await;
        let message = format!("{}", refused.expect_err(category));
        assert!(
            message.contains(expected),
            "{category} should point at '{expected}': {message}"
        );
    }
    assert_eq!(
        count(&pool, "SELECT COUNT(*)::bigint AS n FROM journal_entry").await,
        0
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_category_marked_not_directly_postable_is_refused_from_a_bank_line(pool: PgPool) {
    seed(&pool).await;
    let lines = import(&pool, vec![line(28, "TARIK TUNAI PEMILIK", 20_000_000, 0)]).await;

    // A drawing is a real category on a real client account — `3013001004
    // Prive` — and a person may key a cash document for it. What they may not
    // do is explain a statement line away as one, because that is the act with
    // nobody's signature on it.
    let drawing = cloud::transaction_category_read(&pool, "equity_owner_drawing", Some("dc"))
        .await
        .unwrap_or_else(|error| panic!("read: {error}"));
    assert!(drawing.active, "it is not retired; it is not postable here");
    assert!(!drawing.bank_postable);
    assert!(drawing.requires_approval);

    let refused = cloud::bank_line_categorise(
        &pool,
        lines[0],
        &explain("equity_owner_drawing", "prive"),
        ACTOR,
    )
    .await;
    let message = format!("{}", refused.expect_err("a drawing needs a signature"));
    assert!(message.contains("approved"), "{message}");

    // And a category that is not used on bank documents at all is refused
    // before the question of postability even arises. `ops_miscellaneous` is
    // deliberately a cash-slip category: every chart has that leaf and every
    // chart has it as the largest expense nobody can explain, so the one place
    // it must not be reachable from is the screen where explaining is quickest.
    let elsewhere = cloud::transaction_category_read(&pool, "ops_miscellaneous", Some("dc"))
        .await
        .unwrap_or_else(|error| panic!("read: {error}"));
    assert!(!elsewhere.domains.iter().any(|domain| domain == "BANK"));
    let refused = cloud::bank_line_categorise(
        &pool,
        lines[0],
        &explain("ops_miscellaneous", "lain-lain"),
        ACTOR,
    )
    .await;
    let message = format!("{}", refused.expect_err("not a bank-line category"));
    assert!(message.contains("cash document"), "{message}");

    assert_eq!(
        count(&pool, "SELECT COUNT(*)::bigint AS n FROM journal_entry").await,
        0
    );
}

// ---------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_inflow_line_is_not_offered_outflow_categories(pool: PgPool) {
    seed(&pool).await;
    let lines = import(&pool, vec![line(30, "BUNGA BANK", 0, 10_000)]).await;

    let options = cloud::bank_line_options(&pool, lines[0])
        .await
        .unwrap_or_else(|error| panic!("options: {error}"));
    assert!(!options.outgoing, "a credit is money arriving");

    let offered: Vec<&str> = options
        .categories
        .iter()
        .map(|option| option.category.code.as_str())
        .collect();
    assert!(
        offered.contains(&"income_bank_interest"),
        "interest received explains a credit: {offered:?}"
    );
    assert!(
        !offered.contains(&"ops_bank_charges"),
        "a bank charge cannot explain money arriving, so it is not offered at all: {offered:?}"
    );
    assert!(
        offered.contains(&"income_rounding"),
        "a category for both directions is offered either way: {offered:?}"
    );
    for option in &options.categories {
        assert_ne!(
            option.category.direction, "OUTFLOW",
            "{} slipped through the direction filter",
            option.category.code
        );
    }

    // And the refusal, if somebody sends one anyway, is about the direction
    // rather than about permission: they have misread the line.
    let wrong = cloud::bank_line_categorise(
        &pool,
        lines[0],
        &explain("ops_bank_charges", "biaya"),
        ACTOR,
    )
    .await;
    let message = format!("{}", wrong.expect_err("wrong way round"));
    assert!(message.contains("money coming in"), "{message}");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_list_narrows_the_same_way_the_line_does(pool: PgPool) {
    seed(&pool).await;
    let outflow = cloud::transaction_category_list(&pool, None, Some("OUTFLOW"), None, None, false)
        .await
        .unwrap_or_else(|error| panic!("list: {error}"));
    assert!(outflow.iter().all(|row| row.direction != "INFLOW"));
    assert!(outflow.iter().any(|row| row.direction == "BOTH"));

    let inflow = cloud::transaction_category_list(&pool, None, Some("INFLOW"), None, None, false)
        .await
        .unwrap_or_else(|error| panic!("list: {error}"));
    assert!(inflow.iter().all(|row| row.direction != "OUTFLOW"));

    let rent = cloud::transaction_category_list(&pool, None, None, Some("RENT"), None, false)
        .await
        .unwrap_or_else(|error| panic!("list: {error}"));
    assert!(!rent.is_empty());
    assert!(rent.iter().all(|row| row.family == "RENT"));

    let nonsense =
        cloud::transaction_category_list(&pool, None, Some("sideways"), None, None, false).await;
    assert!(nonsense.is_err(), "a direction that is not one is refused");
}

// ---------------------------------------------------------------------------
// The order of the doors
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_options_endpoint_returns_matches_before_categories(pool: PgPool) {
    seed(&pool).await;
    let lines = import(
        &pool,
        vec![
            line(20, "TRSF E-BANKING DB PT SUMBER", 12_000_000, 0),
            line(30, "BIAYA ADM BULANAN", 35_000, 0),
        ],
    )
    .await;

    // Something already in the books for the first line: a supplier paid, on
    // the day, for the amount. This is the event the first door exists to find.
    a_payment(&pool, 12_000_000).await;

    let options = cloud::bank_line_options(&pool, lines[0])
        .await
        .unwrap_or_else(|error| panic!("options: {error}"));
    assert!(
        !options.matches.is_empty(),
        "the payment is in the books and the first door has to find it"
    );
    assert_eq!(options.matches[0].source_kind, "PAYMENT");
    assert_eq!(options.matches[0].door, "MATCH");
    assert_eq!(options.door_order, vec!["MATCH", "CREATE", "CATEGORISE"]);

    // The second door: the categories a person may not choose, grouped by the
    // document they point at.
    let documents: Vec<&str> = options
        .creatable
        .iter()
        .map(|option| option.document_type.as_str())
        .collect();
    assert!(
        documents.contains(&"SUPPLIER_PAYMENT"),
        "money out to a supplier should offer creating the payment: {documents:?}"
    );
    assert!(options.creatable.iter().all(|o| o.door == "CREATE"));
    assert!(
        options.creatable.iter().all(|o| !o.reached_by.is_empty()),
        "a document says which categories lead to it; \"create a supplier payment\" means \
         nothing until it sits beside \"you were looking for Hutang Supplier\""
    );
    // Five payroll categories are one instruction, which is the whole reason
    // this door is grouped by the document rather than listed per category.
    let payroll = options
        .creatable
        .iter()
        .find(|o| o.document_type == "PAYROLL_RUN")
        .unwrap_or_else(|| panic!("money out should offer creating the payroll payment"));
    assert!(
        payroll.reached_by.len() > 1,
        "grouped: {:?}",
        payroll.reached_by
    );

    // The third: what may actually be posted, and what may only be explained.
    assert!(options.categories.iter().all(|o| o.door == "CATEGORISE"));
    assert!(options.categories.iter().any(|o| o.available));

    // The order, in the JSON a browser receives. Field order is the contract
    // here — a page that picked the blocks up separately could render them any
    // way round, and the fastest door is the one that double-counts.
    let wire = serde_json::to_string(&options).unwrap_or_else(|error| panic!("json: {error}"));
    let at = |needle: &str| {
        wire.find(needle)
            .unwrap_or_else(|| panic!("{needle} is missing from the wire"))
    };
    assert!(at("\"matches\"") < at("\"creatable\""));
    assert!(at("\"creatable\"") < at("\"categories\""));

    // A line with nothing in the books behind it offers no match and still
    // offers the other two doors.
    let plain = cloud::bank_line_options(&pool, lines[1])
        .await
        .unwrap_or_else(|error| panic!("options: {error}"));
    assert!(plain.matches.is_empty());
    assert!(plain
        .categories
        .iter()
        .any(|o| o.category.code == "ops_bank_charges" && o.available));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_settled_line_offers_no_doors_at_all(pool: PgPool) {
    seed(&pool).await;
    let lines = import(&pool, vec![line(30, "BIAYA ADM", 35_000, 0)]).await;
    cloud::bank_line_categorise(
        &pool,
        lines[0],
        &explain("ops_bank_charges", "biaya"),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("categorise: {error}"));

    let options = cloud::bank_line_options(&pool, lines[0])
        .await
        .unwrap_or_else(|error| panic!("options: {error}"));
    assert!(options.settled.is_some(), "it says what happened to it");
    assert!(options.matches.is_empty());
    assert!(options.creatable.is_empty());
    assert!(
        options.categories.is_empty(),
        "there is nothing left to decide, and a door here would be a second document"
    );
}

// ---------------------------------------------------------------------------
// A rule proposes a category
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_rule_proposes_a_category_and_a_person_accepting_it_makes_the_document(pool: PgPool) {
    seed(&pool).await;
    let lines = import(&pool, vec![line(30, "BIAYA ADM BULANAN", 35_000, 0)]).await;

    let outcome = cloud::bank_rule_evaluate(&pool, None)
        .await
        .unwrap_or_else(|error| panic!("evaluate: {error}"));
    assert_eq!(outcome.proposed, 1);
    let proposal = &outcome.proposals[0];
    assert_eq!(proposal.category_code.as_deref(), Some("ops_bank_charges"));
    assert_eq!(
        proposal.semantic_key, None,
        "the meaning is declared once, in the category"
    );
    // Resolved through the category's key, so the screen can show the account
    // without knowing that a category has one.
    assert_eq!(proposal.account_code.as_deref(), Some("601031000400"));
    assert_eq!(proposal.category_refusal, None);

    // It appears on the line's options as a suggestion, first among the
    // categories and never ahead of a match.
    let options = cloud::bank_line_options(&pool, lines[0])
        .await
        .unwrap_or_else(|error| panic!("options: {error}"));
    assert!(options.categories[0].suggested);
    assert_eq!(options.categories[0].category.code, "ops_bank_charges");
    assert_eq!(
        options.categories[0].proposal_id,
        Some(proposal.proposal_id)
    );
    assert!(
        options.categories.iter().filter(|o| o.suggested).count() == 1,
        "one rule, one suggestion"
    );

    // Nothing has been posted. A rule proposes and stops.
    assert_eq!(
        count(&pool, "SELECT COUNT(*)::bigint AS n FROM journal_entry").await,
        0
    );

    let document = cloud::bank_proposal_accept(&pool, proposal.proposal_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("accept: {error}"));
    assert_eq!(document.status, "POSTED");
    assert_eq!(balance(&pool, "601031000400").await, 35_000);
    assert_eq!(balance(&pool, "101100200100").await, -35_000);

    let stored: Option<String> =
        sqlx::query("SELECT category_code FROM cash_document WHERE document_id = $1")
            .bind(document.document_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("read: {error}"))
            .try_get("category_code")
            .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(stored.as_deref(), Some("ops_bank_charges"));

    let decided = cloud::bank_proposal_list(&pool, Some("ACCEPTED"), None, 10)
        .await
        .unwrap_or_else(|error| panic!("list: {error}"));
    assert_eq!(decided.len(), 1);
    assert_eq!(decided[0].cash_document_id, Some(document.document_id));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_rule_pointed_at_a_refused_category_refuses_on_acceptance(pool: PgPool) {
    seed(&pool).await;
    // Somebody writes a rule for the monthly payroll transfer, because a line
    // that keeps showing as unrecognised is annoying. It is allowed — and it
    // only ever produces proposals nobody may accept, which the rule says
    // about itself.
    let rule = cloud::bank_rule_record(
        &pool,
        &RecordBankRuleRequest {
            priority: Some(5),
            match_kind: "CONTAINS".into(),
            pattern: "GAJI".into(),
            direction: Some("OUT".into()),
            category_code: Some("payroll_salary_operations".into()),
            semantic_key: None,
            qualifier: String::new(),
            site_id: None,
            party: None,
            active: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("rule: {error}"));
    assert!(
        rule.category_refuses,
        "the rule says up front that it can only produce refusals"
    );

    import(&pool, vec![line(25, "TRSF GAJI KARYAWAN", 48_000_000, 0)]).await;
    let outcome = cloud::bank_rule_evaluate(&pool, None)
        .await
        .unwrap_or_else(|error| panic!("evaluate: {error}"));
    assert_eq!(outcome.proposed, 1);
    assert!(
        outcome.proposals[0]
            .category_refusal
            .as_deref()
            .unwrap_or_default()
            .contains("payroll run"),
        "the proposal carries the sentence, so Accept is not offered blind"
    );

    let refused = cloud::bank_proposal_accept(&pool, outcome.proposals[0].proposal_id, ACTOR).await;
    let message = format!(
        "{}",
        refused.expect_err("payroll cannot be booked this way")
    );
    assert!(message.contains("payroll run"), "{message}");
    assert_eq!(
        count(&pool, "SELECT COUNT(*)::bigint AS n FROM journal_entry").await,
        0,
        "the salary was recognised when the run was sealed; this would recognise it twice"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_rule_names_a_category_or_a_meaning_and_never_both(pool: PgPool) {
    seed(&pool).await;
    let both = cloud::bank_rule_record(
        &pool,
        &RecordBankRuleRequest {
            priority: Some(50),
            match_kind: "CONTAINS".into(),
            pattern: "ADMIN".into(),
            direction: Some("OUT".into()),
            category_code: Some("ops_bank_charges".into()),
            semantic_key: Some("bank_admin_fee".into()),
            qualifier: String::new(),
            site_id: None,
            party: None,
            active: None,
            note: None,
        },
        ACTOR,
    )
    .await;
    assert!(both.is_err(), "two answers are two answers that can differ");

    let neither = cloud::bank_rule_record(
        &pool,
        &RecordBankRuleRequest {
            priority: Some(50),
            match_kind: "CONTAINS".into(),
            pattern: "ADMIN".into(),
            direction: Some("OUT".into()),
            category_code: None,
            semantic_key: None,
            qualifier: String::new(),
            site_id: None,
            party: None,
            active: None,
            note: None,
        },
        ACTOR,
    )
    .await;
    assert!(
        neither.is_err(),
        "a rule that proposes nothing is not a rule"
    );

    // The fallback still works: a narration no category covers yet.
    let fallback = cloud::bank_rule_record(
        &pool,
        &RecordBankRuleRequest {
            priority: Some(50),
            match_kind: "CONTAINS".into(),
            pattern: "SESUATU YANG LAIN".into(),
            direction: Some("OUT".into()),
            category_code: None,
            semantic_key: Some("bank_admin_fee".into()),
            qualifier: String::new(),
            site_id: None,
            party: None,
            active: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("fallback rule: {error}"));
    assert_eq!(fallback.semantic_key.as_deref(), Some("bank_admin_fee"));
    assert_eq!(fallback.category_code, None);
    assert!(!fallback.category_refuses);
    assert_eq!(
        fallback.account_code.as_deref(),
        Some("601031000400"),
        "the fallback resolves through the map the same way a category does"
    );
}

// ---------------------------------------------------------------------------
// The master itself
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_seeded_master_is_grouped_and_every_refusal_says_something(pool: PgPool) {
    seed(&pool).await;
    let all = cloud::transaction_category_list(&pool, None, None, None, None, true)
        .await
        .unwrap_or_else(|error| panic!("list: {error}"));
    assert!(
        all.len() >= 50,
        "roughly fifty and then some: {}",
        all.len()
    );

    for family in [
        "SELLING",
        "OPERATIONS",
        "MAINTENANCE",
        "RENT",
        "INSURANCE_PROPERTY",
        "FINANCE_COST",
        "TAX_EXPENSE",
        "OTHER_INCOME",
        "PREPAID_ADVANCE",
        "RECEIVABLE",
        "FINANCING_EQUITY",
        "TRANSFER",
    ] {
        assert!(
            all.iter().any(|row| row.family == family),
            "no category in {family}"
        );
    }

    for row in &all {
        assert_eq!(
            row.bank_postable,
            row.refusal.is_none(),
            "{}: a refusal with no sentence is a dead end, and a sentence beside an allowed \
             category is one nobody maintains",
            row.code
        );
        assert!(
            row.expects_account_code.is_some(),
            "{} cites no client account; every one of these came out of their chart",
            row.code
        );
        assert!(
            !(row.requires_approval && row.bank_postable),
            "{}: approval is a second person and categorising is one person's single act",
            row.code
        );
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_category_can_be_added_and_retired_but_never_deleted(pool: PgPool) {
    seed(&pool).await;
    let added = cloud::transaction_category_record(
        &pool,
        &RecordTransactionCategoryRequest {
            code: "ops_security".into(),
            display_name: "Security and guarding".into(),
            family: "OPERATIONS".into(),
            direction: "OUTFLOW".into(),
            semantic_key: "cleaning_expense".into(),
            qualifier: String::new(),
            qualifier_asked: false,
            source_document: "DIRECT_EXPENSE".into(),
            requires_party: true,
            requires_reference: false,
            requires_approval: false,
            domains: vec!["BANK".into(), "CASH".into()],
            bank_postable: true,
            refusal: None,
            expects_account_code: Some("6010310001".into()),
            expects_account_name: Some("Biaya Kebersihan (Cleaning)".into()),
            note: None,
            sort_order: Some(15),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("record: {error}"));
    assert!(added.active);
    assert!(added.bank_postable);

    // Postable and needing a signature cannot both be true.
    let contradiction = cloud::transaction_category_record(
        &pool,
        &RecordTransactionCategoryRequest {
            code: "ops_impossible".into(),
            display_name: "Impossible".into(),
            family: "OPERATIONS".into(),
            direction: "OUTFLOW".into(),
            semantic_key: "cleaning_expense".into(),
            qualifier: String::new(),
            qualifier_asked: false,
            source_document: "DIRECT_EXPENSE".into(),
            requires_party: false,
            requires_reference: false,
            requires_approval: true,
            domains: vec!["BANK".into()],
            bank_postable: true,
            refusal: None,
            expects_account_code: None,
            expects_account_name: None,
            note: None,
            sort_order: None,
        },
        ACTOR,
    )
    .await;
    assert!(contradiction.is_err());

    let retired = cloud::transaction_category_deactivate(&pool, "ops_security", ACTOR)
        .await
        .unwrap_or_else(|error| panic!("retire: {error}"));
    assert!(!retired.active);

    let live = cloud::transaction_category_list(&pool, None, None, None, None, false)
        .await
        .unwrap_or_else(|error| panic!("list: {error}"));
    assert!(!live.iter().any(|row| row.code == "ops_security"));
    // Still readable, because a posted document may name it.
    assert!(
        cloud::transaction_category_read(&pool, "ops_security", None)
            .await
            .is_ok()
    );
}

/// A posted supplier payment on the bank account, so door one has something to
/// find. Written through the poster because that is the only thing that writes
/// a journal, and a fixture that inserted journal lines by hand would be
/// testing against a shape the system cannot actually produce.
async fn a_payment(pool: &PgPool, amount: i64) {
    use inventory_backend::cloud::postgres::{PostingIntent, PostingLine};
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    cloud::post(
        &mut tx,
        &PostingIntent {
            posting_date: day(20),
            source_kind: "PAYMENT".into(),
            source_id: Some("PAY-1".into()),
            rule_version: "supplier_payment/1".into(),
            currency: "IDR".into(),
            memo: Some("Bayar PT Sumber Jaya".into()),
            lines: vec![
                PostingLine::debit("trade_payable", "dc", amount).for_supplier("SUP01"),
                PostingLine::credit("bank_giro", "dc", amount).with_qualifier("BCA"),
            ],
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post payment: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));
}
