//! The integrity engine, proved against a real Postgres.
//!
//! Almost everything here is about a distinction rather than a number: the same
//! difference is timing on Tuesday and somebody's problem on Friday, the same
//! exception is head office's work and not a shop's, and the same equation
//! answers Pending because it is waiting rather than because it is fine. Those
//! are the failures that would ship silently — an engine that got the
//! arithmetic right and the four states wrong would be a green screen that is
//! green because it looked at nothing.
//!
//! The seed is deliberately small. What is being tested is the reading, and a
//! fixture with two hundred postings in it would prove the same thing while
//! making a failure take an afternoon to find.

use chrono::NaiveDate;
use inventory_backend::cloud::domain::{Audience, CheckResult, Scope};
use inventory_backend::cloud::postgres::{
    self as cloud, AllocateToBill, IntegrityCheck, IntegrityResultRow, IntegrityRunSummary,
    PostingIntent, PostingLine, RecordBillRequest, RecordPaymentRequest, SetAccountMappingRequest,
};
use sqlx::PgPool;
use uuid::Uuid;

const ACTOR: &str = "ana";

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/// A chart shaped like the client's, because it IS the client's.
///
/// Every code and every name below is verified against their master account
/// list. That matters more than it looks: the client's chart carries the
/// location in the code itself, so `…00100` is head office and `…00101` is
/// store C001. A fixture that invented a store account would pass while the
/// real chart failed, and the failure would surface as a balance in the wrong
/// place months later.
///
/// Two locations, because half of what this engine notices is value that moved
/// between two of them and was only recorded at one.
async fn seed_chart(pool: &PgPool) {
    let accounts: [(&str, &str, Option<&str>, Option<&str>); 15] = [
        ("1", "ASSET", None, None),
        ("101", "CURRENT ASSET", Some("1"), None),
        ("10110", "KAS & SETARA KAS", Some("101"), None),
        ("1011002", "CASH IN BANK GIRO", Some("10110"), None),
        (
            "101100200100",
            "Cash In Bank Giro Bank BCA HO",
            Some("1011002"),
            Some("dc"),
        ),
        ("10112", "INVENTORY", Some("101"), None),
        ("1011201", "Persediaan Barang Dagang", Some("10112"), None),
        (
            "101120100100",
            "Persediaan Barang Dagangan HO",
            Some("1011201"),
            Some("dc"),
        ),
        (
            "101120100101",
            "Persediaan Barang Dagangan  C001",
            Some("1011201"),
            Some("store-01"),
        ),
        ("2", "LIABILITIES", None, None),
        ("201", "HUTANG JANGKA PENDEK", Some("2"), None),
        ("20120", "HUTANG DAGANG", Some("201"), None),
        ("2012001", "HUTANG SUPPLIER", Some("20120"), None),
        (
            "201200100100",
            "Hutang Suppliers HO",
            Some("2012001"),
            Some("dc"),
        ),
        (
            "201200100101",
            "Hutang Suppliers  Barang Dagangan C001",
            Some("2012001"),
            Some("store-01"),
        ),
    ];
    for (code, name, parent, site) in accounts {
        let is_group = code.len() < 12;
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
}

async fn map_at(pool: &PgPool, key: &str, site: &str, code: &str) {
    cloud::set_account_mapping(
        pool,
        &SetAccountMappingRequest {
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

/// The chart, the map and an open September. What every test here needs before
/// it can post anything at all.
async fn seed(pool: &PgPool) {
    seed_chart(pool).await;
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
    map_at(pool, "inventory", "dc", "101120100100").await;
    map_at(pool, "trade_payable", "dc", "201200100100").await;
    map_at(pool, "bank_giro", "dc", "101100200100").await;
    map_at(pool, "inventory", "store-01", "101120100101").await;
    map_at(pool, "trade_payable", "store-01", "201200100101").await;
}

fn september(day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, day).unwrap_or_else(|| panic!("bad date"))
}

/// Ask every equation as at the end of September.
async fn run(pool: &PgPool) -> IntegrityRunSummary {
    cloud::integrity_run_now(pool, september(30), "MANUAL", ACTOR)
        .await
        .unwrap_or_else(|error| panic!("run: {error}"))
}

fn answer<'a>(run: &'a IntegrityRunSummary, key: &str) -> &'a IntegrityResultRow {
    run.results
        .iter()
        .find(|result| result.key == key)
        .unwrap_or_else(|| {
            panic!(
                "{key} is not in the run; it answered {:?}",
                run.results.iter().map(|r| &r.key).collect::<Vec<_>>()
            )
        })
}

fn summary(result: &IntegrityResultRow) -> String {
    result.details.summary.clone()
}

fn verbs(result: &IntegrityResultRow) -> Vec<String> {
    result
        .suggested_actions
        .iter()
        .map(|action| action.verb.as_str().to_string())
        .collect()
}

// ---------------------------------------------------------------------------
// Equation 1: the General Ledger
// ---------------------------------------------------------------------------

/// Value moved between two locations and only one of them recorded it.
///
/// The entry balances — the poster would refuse it otherwise — and neither
/// location does. That is the whole point of asking the question per site as
/// well as per entry: the trial balance is green and two sets of books that
/// somebody has to publish are not.
///
/// Blocked and not Exception, because equation one is a foundation. Everything
/// else in the run is arithmetic over these accounts, and calling this
/// "somebody's morning" would invite a day spent proving nothing.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_real_imbalance_on_the_general_ledger_blocks_rather_than_queues(pool: PgPool) {
    seed(&pool).await;
    let mut tx = pool.begin().await.expect("begin");
    cloud::post(
        &mut tx,
        &PostingIntent {
            posting_date: september(4),
            source_kind: "TRANSFER".into(),
            source_id: Some("TRF-1".into()),
            rule_version: "test/1".into(),
            currency: "IDR".into(),
            memo: Some("Stock to the shop, and nobody said who now owes whom".into()),
            lines: vec![
                PostingLine::debit("inventory", "store-01", 8_600_000),
                PostingLine::credit("inventory", "dc", 8_600_000),
            ],
        },
        ACTOR,
    )
    .await
    .expect("post");
    tx.commit().await.expect("commit");

    let run = run(&pool).await;
    let gl = answer(&run, "gl.debits_equal_credits");
    assert_eq!(gl.state, "BLOCKED", "{}", summary(gl));
    // The group still balances, which is exactly why the group figure alone
    // would have said nothing.
    assert_eq!(gl.expected_minor, gl.actual_minor);
    assert!(
        summary(gl).contains("2 locations do not balance"),
        "the summary should name what is wrong: {}",
        summary(gl)
    );
    assert_eq!(run.worst_state.as_deref(), Some("BLOCKED"));

    // And both locations are told, because the manager is who will be asked
    // what happened even though head office posts the correction.
    let store = cloud::attention_for_store(&pool, "store-01", 50)
        .await
        .expect("store feed");
    assert_eq!(store.open_count, 1, "{store:?}");
}

/// The same books with nothing wrong in them.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn books_that_balance_everywhere_say_so(pool: PgPool) {
    seed(&pool).await;
    let mut tx = pool.begin().await.expect("begin");
    cloud::post(
        &mut tx,
        &PostingIntent {
            posting_date: september(4),
            source_kind: "SUPPLIER_INVOICE".into(),
            source_id: Some("INV-1".into()),
            rule_version: "test/1".into(),
            currency: "IDR".into(),
            memo: None,
            lines: vec![
                PostingLine::debit("inventory", "dc", 8_600_000),
                PostingLine::credit("trade_payable", "dc", 8_600_000).for_supplier("SUP01"),
            ],
        },
        ACTOR,
    )
    .await
    .expect("post");
    tx.commit().await.expect("commit");

    let run = run(&pool).await;
    let gl = answer(&run, "gl.debits_equal_credits");
    assert_eq!(gl.state, "BALANCED", "{}", summary(gl));
    assert_eq!(gl.expected_minor, 8_600_000);
    // A run with nothing wrong leaves nothing in anybody's queue.
    let feed = cloud::attention_list(&pool, 50).await.expect("feed");
    assert_eq!(feed.open_count, 0, "{feed:?}");
}

// ---------------------------------------------------------------------------
// Equation 2: the Payment Ledger
// ---------------------------------------------------------------------------

/// A bill, and a payment for part of it.
///
/// Two readings, and which one applies depends on whether the Payment Ledger's
/// own migrations are in this database. That lane publishes the comparison as
/// `payment_ledger_integrity(date, text)`; this engine calls it rather than
/// writing a second implementation of one control total.
///
/// So the assertion is the contract, not the arithmetic: with the function
/// present, a bill and a partial payment agree with the accounts they were
/// posted to. Without it, the equation says Pending and names the table it is
/// waiting for — never Balanced, because an equation nobody could compute did
/// not hold.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_bill_and_a_partial_payment_tie_to_the_payable_account(pool: PgPool) {
    seed(&pool).await;
    let bill = cloud::record_bill(
        &pool,
        &RecordBillRequest {
            invoice_number: "INV-1".into(),
            supplier_id: "SUP01".into(),
            supplier_name: Some("Pemasok Satu".into()),
            site_id: "dc".into(),
            invoice_date: september(2),
            due_date: Some(september(30)),
            subtotal_minor: 8_600_000,
            tax_minor: 0,
            discount_minor: 0,
            note: None,
            kind: None,
            lines: None,
        },
        ACTOR,
    )
    .await
    .expect("record bill");
    cloud::post_bill(&pool, bill.invoice_id, Some(september(2)), ACTOR)
        .await
        .expect("post bill");

    let payment = cloud::record_payment(
        &pool,
        &RecordPaymentRequest {
            site_id: "dc".into(),
            payment_date: september(10),
            method: "TRANSFER".into(),
            account_key: "bank_giro".into(),
            account_qualifier: String::new(),
            total_minor: Some(3_000_000),
            reference: Some("TRX-1".into()),
            note: None,
            allocations: vec![AllocateToBill {
                invoice_id: bill.invoice_id,
                // Part of it. The interesting case: the debt is neither gone
                // nor untouched, and both records have to agree about that.
                amount_minor: 3_000_000,
            }],
        },
        ACTOR,
    )
    .await
    .expect("record payment");
    cloud::post_payment(&pool, payment.payment_id, Some(september(10)), ACTOR)
        .await
        .expect("post payment");

    let run = run(&pool).await;
    let equation = answer(&run, "payment_ledger.control_accounts");
    let ledger_present: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                         WHERE n.nspname = 'public' AND p.proname = 'payment_ledger_integrity')",
    )
    .fetch_one(&pool)
    .await
    .expect("probe");

    if ledger_present {
        assert_eq!(equation.state, "BALANCED", "{}", summary(equation));
    } else {
        assert_eq!(equation.state, "PENDING", "{}", summary(equation));
        assert!(
            summary(equation).contains("payment_ledger_entry"),
            "a Pending equation must name what it is waiting for: {}",
            summary(equation)
        );
    }
    // Either way the books themselves are whole, which is what makes this a
    // test of the equation rather than of the seed.
    assert_eq!(answer(&run, "gl.debits_equal_credits").state, "BALANCED");
}

// ---------------------------------------------------------------------------
// Equation 9: the bank
// ---------------------------------------------------------------------------

async fn import_statement(pool: &PgPool, lines: &[(u32, i64, &str)]) -> Uuid {
    let statement_id = Uuid::new_v4();
    let closing: i64 = lines.iter().map(|(_, amount, _)| *amount).sum();
    sqlx::query(
        "INSERT INTO bank_statement
           (statement_id, account_code, site_id, period_start, period_end,
            opening_minor, closing_minor, imported_by)
         VALUES ($1,'101100200100','dc',$2,$3,0,$4,$5)",
    )
    .bind(statement_id)
    .bind(september(1))
    .bind(september(30))
    .bind(closing)
    .bind(ACTOR)
    .execute(pool)
    .await
    .expect("statement");
    for (index, (day, amount, description)) in lines.iter().enumerate() {
        sqlx::query(
            "INSERT INTO bank_statement_line
               (line_id, statement_id, line_number, value_date, description,
                debit_minor, credit_minor, fingerprint, account_code)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'101100200100')",
        )
        .bind(Uuid::new_v4())
        .bind(statement_id)
        .bind(index as i32 + 1)
        .bind(september(*day))
        .bind(description)
        .bind(if *amount < 0 { -*amount } else { 0 })
        .bind(if *amount > 0 { *amount } else { 0 })
        .bind(format!("fp-{index}-{day}-{amount}"))
        .execute(pool)
        .await
        .expect("line");
    }
    statement_id
}

/// A line the bank reported yesterday is timing; the same line three weeks ago
/// is not.
///
/// This is the distinction the four states exist for, and the one an engine
/// that answered only "agrees / does not agree" would get wrong every single
/// morning.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_old_unmatched_statement_line_is_an_exception_and_a_young_one_is_not(pool: PgPool) {
    seed(&pool).await;
    import_statement(&pool, &[(29, 500_000, "Setoran tunai")]).await;

    let young = run(&pool).await;
    let bank = answer(&young, "bank.reconciles_to_statement");
    assert_eq!(bank.state, "PENDING", "{}", summary(bank));
    // Nothing to do about it, so nothing is put in front of anybody. A feed
    // holding every line still inside its own clearing window would be several
    // hundred rows a day, none of which anybody should touch.
    assert!(verbs(bank).is_empty(), "{:?}", verbs(bank));
    assert_eq!(
        cloud::attention_list(&pool, 50)
            .await
            .expect("feed")
            .open_count,
        0
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_unmatched_line_past_the_clearing_window_arrives_with_a_verb(pool: PgPool) {
    seed(&pool).await;
    import_statement(
        &pool,
        &[(10, 4_150_000, "Transfer masuk"), (29, 500_000, "Setoran")],
    )
    .await;

    let run = run(&pool).await;
    let bank = answer(&run, "bank.reconciles_to_statement");
    assert_eq!(bank.state, "EXCEPTION", "{}", summary(bank));
    // One verb, for the old line only. "Bank account differs by 4,150,000" is a
    // fact nobody can act on; MATCH against a named line is the next move.
    assert_eq!(verbs(bank), vec!["MATCH".to_string()], "{:?}", verbs(bank));

    let feed = cloud::attention_list(&pool, 50).await.expect("feed");
    assert_eq!(feed.open_count, 1, "{feed:?}");
    let item = &feed.groups[0].items[0];
    assert_eq!(item.source_kind, "bank.reconciles_to_statement");
    assert!(
        item.body.contains("4.150.000") && item.body.contains("Transfer masuk"),
        "the row should read as a sentence somebody can act on: {}",
        item.body
    );
}

// ---------------------------------------------------------------------------
// The queue across runs
// ---------------------------------------------------------------------------

/// A queue that does not clear itself is a queue people abandon.
///
/// The line is matched in the morning; that night's run no longer raises it, so
/// that night's run closes it. Nobody has to remember to tick anything off, and
/// `resolved_by` says which of the two ways it happened — the engine finding it
/// fixed, or a person saying so.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_later_run_closes_what_somebody_fixed_during_the_day(pool: PgPool) {
    seed(&pool).await;
    import_statement(&pool, &[(10, 4_150_000, "Transfer masuk")]).await;

    let first = run(&pool).await;
    assert_eq!(
        answer(&first, "bank.reconciles_to_statement").state,
        "EXCEPTION"
    );
    let opened = cloud::attention_list(&pool, 50).await.expect("feed");
    assert_eq!(opened.open_count, 1);
    let item_id = opened.groups[0].items[0].item_id;

    // Somebody books the entry the line was missing and matches the two, which
    // is what the Bank reconciliation screen does.
    let mut tx = pool.begin().await.expect("begin");
    cloud::post(
        &mut tx,
        &PostingIntent {
            posting_date: september(10),
            source_kind: "MANUAL".into(),
            source_id: None,
            rule_version: "test/1".into(),
            currency: "IDR".into(),
            memo: Some("Transfer masuk, dibukukan".into()),
            lines: vec![
                PostingLine::debit("bank_giro", "dc", 4_150_000),
                PostingLine::credit("trade_payable", "dc", 4_150_000),
            ],
        },
        ACTOR,
    )
    .await
    .expect("post");
    tx.commit().await.expect("commit");
    sqlx::query(
        "INSERT INTO bank_line_match (match_id, line_id, journal_line_id, decided_by_kind,
                                      matched_by)
         SELECT $1, l.line_id, j.line_id, 'MANUAL', $2
           FROM bank_statement_line l
           JOIN journal_line j ON j.account_code = l.account_code AND j.debit_minor > 0
          LIMIT 1",
    )
    .bind(Uuid::new_v4())
    .bind(ACTOR)
    .execute(&pool)
    .await
    .expect("match");

    let second = run(&pool).await;
    assert_eq!(
        answer(&second, "bank.reconciles_to_statement").state,
        "BALANCED"
    );
    let after = cloud::attention_list(&pool, 50).await.expect("feed");
    assert_eq!(after.open_count, 0, "{after:?}");

    let (resolved_by, reason): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT resolved_by, resolved_reason FROM attention_item WHERE item_id = $1",
    )
    .bind(item_id)
    .fetch_one(&pool)
    .await
    .expect("row");
    assert_eq!(resolved_by.as_deref(), Some("system:integrity"));
    // No reason, and that is the record: nobody claimed anything, the books
    // simply agreed. A person closing one by hand has to say why.
    assert_eq!(reason, None);
}

/// Closing one by hand needs a reason, and closing it twice is refused.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_person_closing_an_exception_has_to_say_why(pool: PgPool) {
    seed(&pool).await;
    import_statement(&pool, &[(10, 4_150_000, "Transfer masuk")]).await;
    run(&pool).await;
    let item_id = cloud::attention_list(&pool, 50).await.expect("feed").groups[0].items[0].item_id;

    let refused = cloud::attention_resolve(&pool, item_id, "   ", ACTOR).await;
    assert!(
        matches!(refused, Err(ref error) if error.to_string().contains("needs a reason")),
        "{refused:?}"
    );

    let closed = cloud::attention_resolve(&pool, item_id, "Bank confirmed it was ours", ACTOR)
        .await
        .expect("resolve");
    assert_eq!(closed.resolved_by.as_deref(), Some(ACTOR));
    assert_eq!(
        closed.resolved_reason.as_deref(),
        Some("Bank confirmed it was ours")
    );
    let again = cloud::attention_resolve(&pool, item_id, "again", ACTOR).await;
    assert!(
        matches!(again, Err(ref error) if error.to_string().contains("already resolved")),
        "{again:?}"
    );
}

// ---------------------------------------------------------------------------
// The two feeds
// ---------------------------------------------------------------------------

/// A shop sees its own work, and only its own.
///
/// Both exceptions are open at once: the bank is head office's, and a location
/// that does not balance is the shop's to explain. If the shop's feed carried
/// the bank line it would be carrying something the shop cannot post a
/// correction for, and a list like that is one people scroll past.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_shop_is_never_shown_head_office_work(pool: PgPool) {
    seed(&pool).await;
    import_statement(&pool, &[(10, 4_150_000, "Transfer masuk")]).await;
    let mut tx = pool.begin().await.expect("begin");
    cloud::post(
        &mut tx,
        &PostingIntent {
            posting_date: september(4),
            source_kind: "TRANSFER".into(),
            source_id: Some("TRF-1".into()),
            rule_version: "test/1".into(),
            currency: "IDR".into(),
            memo: None,
            lines: vec![
                PostingLine::debit("inventory", "store-01", 8_600_000),
                PostingLine::credit("inventory", "dc", 8_600_000),
            ],
        },
        ACTOR,
    )
    .await
    .expect("post");
    tx.commit().await.expect("commit");
    run(&pool).await;

    let head_office = cloud::attention_list(&pool, 50).await.expect("HO feed");
    let ho_keys: Vec<&str> = head_office
        .groups
        .iter()
        .flat_map(|group| group.items.iter().map(|item| item.source_kind.as_str()))
        .collect();
    assert!(
        ho_keys.contains(&"bank.reconciles_to_statement"),
        "{ho_keys:?}"
    );
    assert!(ho_keys.contains(&"gl.debits_equal_credits"), "{ho_keys:?}");

    let shop = cloud::attention_for_store(&pool, "store-01", 50)
        .await
        .expect("shop feed");
    let shop_keys: Vec<&str> = shop
        .groups
        .iter()
        .flat_map(|group| group.items.iter().map(|item| item.source_kind.as_str()))
        .collect();
    assert_eq!(shop_keys, vec!["gl.debits_equal_credits"], "{shop:?}");
    // And its own location, not the other one that is equally out of balance.
    assert!(shop
        .groups
        .iter()
        .flat_map(|group| &group.items)
        .all(|item| item.site_id.as_deref() == Some("store-01")));

    // A shop nobody has heard of is a 404 rather than an empty feed: the two
    // read the same on a screen and only one of them is a typo.
    assert!(cloud::attention_for_store(&pool, "store-99", 50)
        .await
        .is_err());
}

// ---------------------------------------------------------------------------
// The equations that are waiting
// ---------------------------------------------------------------------------

/// An equation whose other half has not been built answers Pending, and names
/// the table.
///
/// Never Balanced. A run of ten greens where five of them are green because
/// nothing was asked is the exact failure this engine exists to prevent — and
/// a reason that said "not implemented" would leave nobody able to tell which
/// lane is late.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_equation_that_is_waiting_says_so_and_names_the_table(pool: PgPool) {
    seed(&pool).await;
    let run = run(&pool).await;

    for (key, relation) in [
        ("operating_funds.sent_equals_used", "store_fund_transfer"),
        ("fund_allocation.open_equals_outstanding", "fund_allocation"),
        ("proceeds.reconciled_equals_remitted", "store_remittance"),
    ] {
        let result = answer(&run, key);
        assert_eq!(result.state, "PENDING", "{key}: {}", summary(result));
        assert!(
            summary(result).contains(relation),
            "{key} should name {relation}: {}",
            summary(result)
        );
        assert_eq!(result.difference_minor, 0);
    }

    // And a Pending equation is not work: nothing about it reaches a queue.
    assert_eq!(
        cloud::attention_list(&pool, 50)
            .await
            .expect("feed")
            .open_count,
        0
    );
}

/// The whole registry answers, every run, whatever else is going on.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_equation_in_the_registry_answers(pool: PgPool) {
    seed(&pool).await;
    let run = run(&pool).await;
    for check in cloud::integrity_registry() {
        let result = answer(&run, check.key());
        assert!(
            !summary(result).trim().is_empty(),
            "{} answered with no sentence at all",
            check.key()
        );
    }
    // Ten equations, and none of them recorded twice — the unique index on
    // (run, key, scope) would have refused a duplicate, so this is really a
    // check that nothing was silently skipped.
    assert!(run.results.len() >= 10, "{}", run.results.len());
    assert!(run.finished_at.is_some());
}

// ---------------------------------------------------------------------------
// The door other lanes come in through
// ---------------------------------------------------------------------------

/// The Stock Ledger lane's equation, standing in for the real one.
struct StockCounted;

#[async_trait::async_trait]
impl IntegrityCheck for StockCounted {
    fn key(&self) -> &str {
        "stock.quantity_position"
    }
    fn title(&self) -> &str {
        "Stock quantity equals the position inside the boundary"
    }
    fn area(&self) -> &str {
        "Stock"
    }
    fn audience(&self) -> Audience {
        Audience::Both
    }
    fn scope(&self) -> Scope {
        Scope::Group
    }
    async fn evaluate(
        &self,
        _pool: &PgPool,
        _as_of: NaiveDate,
    ) -> Result<CheckResult, inventory_backend::cloud::application::AppError> {
        Ok(CheckResult::compared(
            self.key(),
            0,
            0,
            None,
            inventory_backend::cloud::domain::Tolerance::EXACT,
            inventory_backend::cloud::domain::Details::say("Every pool counts."),
        ))
    }
}

static STOCK_COUNTED: StockCounted = StockCounted;

/// A lane retires its own placeholder without editing this engine.
///
/// The registration is process-wide and deliberately so — the set of equations
/// is a property of the running system, not of one request. That is also why
/// this is the only test that registers anything: a check added here is added
/// for every test in this binary, so it replaces a placeholder with something
/// that answers Balanced and disturbs nothing.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_registered_check_replaces_the_placeholder_it_names(pool: PgPool) {
    seed(&pool).await;
    // Idempotent, because the test binary may have run this once already: the
    // second registration is refused by key, which is itself the guarantee
    // being relied on.
    let _ = cloud::register_integrity_check(&STOCK_COUNTED);
    assert!(
        cloud::register_integrity_check(&STOCK_COUNTED).is_err(),
        "registering one key twice must be refused, not silently won"
    );

    let registry = cloud::integrity_registry();
    assert_eq!(
        registry
            .iter()
            .filter(|check| check.key() == "stock.quantity_position")
            .count(),
        1,
        "a registration under an existing key replaces it rather than adding a second"
    );

    let run = run(&pool).await;
    let stock = answer(&run, "stock.quantity_position");
    assert_eq!(stock.state, "BALANCED", "{}", summary(stock));
    assert_eq!(summary(stock), "Every pool counts.");
    // The other Stock equation is untouched and still says what it waits for.
    assert_eq!(answer(&run, "stock.value_vs_gl").state, "PENDING");
}

// ---------------------------------------------------------------------------
// The notification hook
// ---------------------------------------------------------------------------

/// Somebody is told on the night it goes wrong, and not on the nights after.
///
/// An unmatched line open for six weeks is a real problem and it is not six
/// weeks of news. A notification every night would train exactly the reflex a
/// closed set of notification kinds exists to prevent, which is to dismiss all
/// of them; the standing state lives in the queue, which does not expire.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn crossing_into_trouble_is_news_and_staying_there_is_not(pool: PgPool) {
    seed(&pool).await;
    sqlx::query(
        "INSERT INTO app_user (id, username, display_name, role, password_hash, active,
                               created_by)
         VALUES ($1,'budi','Budi','ADMIN','x',true,'test')",
    )
    .bind(Uuid::new_v4())
    .execute(&pool)
    .await
    .expect("user");
    import_statement(&pool, &[(10, 4_150_000, "Transfer masuk")]).await;

    run(&pool).await;
    let after_first: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM notification WHERE kind = 'finance.integrity.exception'",
    )
    .fetch_one(&pool)
    .await
    .expect("count");
    assert_eq!(after_first, 1);

    run(&pool).await;
    let after_second: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM notification WHERE kind = 'finance.integrity.exception'",
    )
    .fetch_one(&pool)
    .await
    .expect("count");
    assert_eq!(
        after_second, 1,
        "the same standing exception must not be announced twice"
    );
}
