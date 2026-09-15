//! A cutover against a real Postgres: the beginning of every balance in the
//! books, and the one thing about it that cannot be redone.
//!
//! The kernel's own tests prove the parsing, the totals and the pricing rule.
//! None of them can see the things that only exist once there is a database:
//! that the opening entry balances per site, that the FIFO queue this creates
//! is a queue the sale path already knows how to consume, that the Payment
//! Ledger's integrity equation reports balanced the moment the items are
//! opened, and — the one this file exists for — that a rehearsal and a run
//! compute the same numbers because they are the same code.
//!
//! Most of these assert on a REFUSAL. That is the shape of the lane. An opening
//! balance that does not agree, a stock sheet that does not reconcile to the
//! inventory account, an account the chart cannot take: every one of them would
//! post something plausible, balance, and be found a year later by somebody
//! trying to explain a stock difference that has been there since the first day.

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{self as cloud, OpeningImportRequest, StockOutflow};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
const CUTOVER: &str = "2026-08-31";

// ---------------------------------------------------------------------------
// A world small enough to read
// ---------------------------------------------------------------------------

/// A chart shaped like the client's: the ladder, then the postable leaves.
///
/// The rungs are not decoration. The client's codes ARE the tree, a balance
/// rolls up by prefix, and a seed of leaves hanging off the roots would pass
/// tests a real chart fails. Every code and every name below is copied from
/// their own master account report, five rungs and a twelve-digit leaf per
/// place, double spaces in the names and all.
async fn seed_chart(pool: &PgPool) {
    let ladder: [(&str, &str, Option<&str>); 26] = [
        ("1", "ASSET", None),
        ("101", "CURRENT ASSET", Some("1")),
        ("10110", "KAS & SETARA KAS", Some("101")),
        ("1011001", "CASH ON HAND", Some("10110")),
        ("1011001001", "CASH ON HAND", Some("1011001")),
        ("10111", "PIUTANG", Some("101")),
        ("1011101", "PIUTANG DAGANG", Some("10111")),
        ("1011101001", "Piutang kartu Kredit", Some("1011101")),
        ("10112", "INVENTORY", Some("101")),
        ("1011201", "Persediaan Barang Dagang", Some("10112")),
        ("1011201001", "Persediaan Barang Dagangan", Some("1011201")),
        ("2", "LIABILITIES", None),
        ("201", "HUTANG JANGKA PENDEK", Some("2")),
        ("20120", "HUTANG DAGANG", Some("201")),
        ("2012001", "HUTANG SUPPLIER", Some("20120")),
        (
            "2012001001",
            "Hutang Suppliers  Barang Dagangan",
            Some("2012001"),
        ),
        ("3", "MODAL", None),
        ("301", "MODAL", Some("3")),
        ("30130", "MODAL", Some("301")),
        ("3013001", "MODAL", Some("30130")),
        ("3013001002", "Laba (Rugi) Ditahan", Some("3013001")),
        ("5", "BIAYA / BEBAN POKOK", None),
        ("501", "HARGA POKOK PEMBELIAN", Some("5")),
        ("50101", "HARGA POKOK PEMBELIAN", Some("501")),
        ("5010110", "HARGA POKOK PEMBELIAN", Some("50101")),
        ("5010110001", "Harga Pokok Pembelian", Some("5010110")),
    ];
    for (code, name, parent) in ladder {
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group)
             VALUES ($1,$2,$3,true)
             ON CONFLICT (account_code) DO NOTHING",
        )
        .bind(code)
        .bind(name)
        .bind(parent)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{code}: {error}"));
    }
    // The leaves. `00` is head office and `01` is the client's C001, which is
    // this system's `store-01` — the suffix IS the place, which is why an
    // opening balance can name a client code and a place in the same row.
    for (code, name, parent, site) in [
        (
            "101110100100",
            "Piutang Kartu Kredit HO",
            "1011101001",
            "dc",
        ),
        (
            "101120100100",
            "Persediaan Barang Dagangan  HO",
            "1011201001",
            "dc",
        ),
        (
            "101120100101",
            "Persediaan Barang Dagangan  C001",
            "1011201001",
            "store-01",
        ),
        (
            "201200100100",
            "Hutang Suppliers  Barang Dagangan HO",
            "2012001001",
            "dc",
        ),
        ("301300100200", "Laba (Rugi) Ditahan HO", "3013001002", "dc"),
        (
            "301300100201",
            "Laba (Rugi) Ditahan C001",
            "3013001002",
            "store-01",
        ),
        (
            "501011000100",
            "Harga Pokok Pembelian HO",
            "5010110001",
            "dc",
        ),
    ] {
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
             VALUES ($1,$2,$3,false,$4)
             ON CONFLICT (account_code) DO NOTHING",
        )
        .bind(code)
        .bind(name)
        .bind(parent)
        .bind(site)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{code}: {error}"));
    }
    // One retired account, so "the chart cannot take a posting" can be shown
    // for a reason other than a typo — which is the reason that survives a
    // year, because a mapping made while an account was live goes on resolving
    // after Finance quietly retires it. The code is the client's own; whether
    // THIS one is retired in their chart is not something the report says, and
    // a chart of 7,528 accounts has some that are.
    sqlx::query(
        "INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id, is_active)
         VALUES ('101100100100','Cash on Hand HO','1011001001',false,'dc',false)
         ON CONFLICT (account_code) DO NOTHING",
    )
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("retired account: {error}"));
}

async fn map(pool: &PgPool, key: &str, site: &str, qualifier: &str, code: &str) {
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
    .unwrap_or_else(|error| panic!("map {key} at {site}: {error}"));
}

async fn seed_article(pool: &PgPool, code: &str) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO article (id, article_code, name) VALUES ($1,$2,$3)")
        .bind(id)
        .bind(code)
        .bind(format!("Kemeja {code}"))
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("article {code}: {error}"));
    id
}

/// Everything a cutover needs before it can be rehearsed, in one call.
async fn a_world(pool: &PgPool) {
    seed_chart(pool).await;
    // August is the last month of the old system and September the first of
    // this one. Both open: the opening entry is dated the 31st of August and
    // the first sale is on the 1st of September.
    for month in [8, 9] {
        cloud::open_period(pool, 2026, month)
            .await
            .unwrap_or_else(|error| panic!("open 2026-{month}: {error}"));
    }
    map(pool, "inventory", "dc", "", "101120100100").await;
    map(pool, "inventory", "store-01", "", "101120100101").await;
    map(pool, "trade_payable", "dc", "", "201200100100").await;
    map(pool, "card_receivable_debit", "dc", "BCA", "101110100100").await;
    map(pool, "cogs", "dc", "", "501011000100").await;
}

fn cutover() -> NaiveDate {
    NaiveDate::parse_from_str(CUTOVER, "%Y-%m-%d").unwrap_or_else(|error| panic!("{error}"))
}

fn request(csv: &str, commit: bool) -> OpeningImportRequest {
    OpeningImportRequest {
        cutover_date: cutover(),
        csv: csv.to_string(),
        commit,
    }
}

/// A trial balance that agrees: stock and a payable at head office, stock and
/// retained earnings at one shop.
const BALANCES: &str = "site_id,account_code,debit,credit,document_no,memo
dc,101120100100,15.000.000,,TB-2026-08,Persediaan per 31 Agustus
dc,201200100100,,9.000.000,TB-2026-08,Hutang dagang
dc,301300100200,,6.000.000,TB-2026-08,Laba ditahan
store-01,101120100101,4.000.000,,TB-2026-08,Persediaan toko
store-01,301300100201,,4.000.000,TB-2026-08,Laba ditahan toko
";

/// What one account has on it, straight from the lines.
async fn balance(pool: &PgPool, code: &str) -> i64 {
    sqlx::query(
        "SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::bigint AS b
           FROM journal_line WHERE account_code = $1",
    )
    .bind(code)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("balance: {error}"))
    .try_get("b")
    .unwrap_or_else(|e| panic!("{e}"))
}

async fn count(pool: &PgPool, table: &str) -> i64 {
    sqlx::query(&format!("SELECT COUNT(*)::bigint AS n FROM {table}"))
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("count {table}: {error}"))
        .try_get("n")
        .unwrap_or_else(|e| panic!("{e}"))
}

// ---------------------------------------------------------------------------
// The opening trial balance
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_trial_balance_that_agrees_posts_one_balanced_entry_per_place(pool: PgPool) {
    a_world(&pool).await;

    let outcome = cloud::opening_import_balances(&pool, &request(BALANCES, true), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("import: {error}"));

    assert!(outcome.committed);
    assert_eq!(outcome.lines, 5);
    assert_eq!(
        outcome.entries.len(),
        2,
        "two places, two entries — not one entry spanning both, which would leave neither \
         set of books balanced on its own"
    );
    for entry in &outcome.entries {
        assert!(
            entry.entry_number.starts_with("JV-"),
            "the opening entry is a journal entry like any other"
        );
    }
    assert_eq!(
        outcome.document_numbers,
        vec!["TB-2026-08".to_string()],
        "the client's own reference is kept, because their auditors look for it"
    );

    assert_eq!(balance(&pool, "101120100100").await, 15_000_000);
    assert_eq!(balance(&pool, "201200100100").await, -9_000_000);
    assert_eq!(balance(&pool, "101120100101").await, 4_000_000);

    // Every place's own books balance as at the cutover.
    for equation in &outcome.equations {
        assert!(
            equation.agrees,
            "{} is out by {}",
            equation.detail, equation.difference_minor
        );
    }

    // And the source is what says where this came from.
    let kinds: Vec<String> = sqlx::query("SELECT DISTINCT source_kind FROM journal_entry")
        .fetch_all(&pool)
        .await
        .unwrap_or_else(|error| panic!("{error}"))
        .iter()
        .map(|row| row.get("source_kind"))
        .collect();
    assert_eq!(kinds, vec!["OPENING".to_string()]);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_trial_balance_that_does_not_agree_is_refused_and_the_difference_is_named(pool: PgPool) {
    a_world(&pool).await;

    let out_by_a_million = "site_id,account_code,debit,credit,document_no
dc,101120100100,15.000.000,,TB-2026-08
dc,201200100100,,9.000.000,TB-2026-08
dc,301300100200,,5.000.000,TB-2026-08
";
    let error = cloud::opening_import_balances(&pool, &request(out_by_a_million, true), ACTOR)
        .await
        .expect_err("a trial balance that does not agree is not a trial balance");
    let message = error.to_string();
    assert!(message.contains("1000000"), "the difference: {message}");
    assert!(message.contains("dc"), "the place: {message}");
    assert!(
        message.contains("debits exceed credits"),
        "which way round it is out, which is half of finding out why: {message}"
    );
    assert_eq!(count(&pool, "journal_entry").await, 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn one_place_being_out_does_not_hide_behind_another_being_over(pool: PgPool) {
    a_world(&pool).await;

    // The company total agrees exactly; neither place does.
    let crossed = "site_id,account_code,debit,credit,document_no
dc,101120100100,15.000.000,,TB-2026-08
dc,201200100100,,14.000.000,TB-2026-08
store-01,101120100101,4.000.000,,TB-2026-08
store-01,301300100201,,5.000.000,TB-2026-08
";
    let error = cloud::opening_import_balances(&pool, &request(crossed, true), ACTOR)
        .await
        .expect_err("each set of books balances on its own or none of them do");
    assert!(error.to_string().contains("1000000"), "{error}");
    assert_eq!(count(&pool, "journal_entry").await, 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_account_the_chart_cannot_take_is_named_and_never_dropped(pool: PgPool) {
    a_world(&pool).await;

    // Three faults at once: a code that is not there, a heading, and one the
    // client has retired. All three have to come back together — the person
    // fixing them is in a spreadsheet, and one per round trip is a week.
    let three_faults = "site_id,account_code,debit,credit,document_no
dc,999999999999,1.000.000,,TB-2026-08
dc,1011201,2.000.000,,TB-2026-08
dc,101100100100,3.000.000,,TB-2026-08
dc,301300100200,,6.000.000,TB-2026-08
";
    let error = cloud::opening_import_balances(&pool, &request(three_faults, true), ACTOR)
        .await
        .expect_err("an opening balance may not drop a figure");
    let message = error.to_string();
    assert!(message.contains("999999999999"), "the typo: {message}");
    assert!(message.contains("1011201"), "the heading: {message}");
    assert!(
        message.contains("101100100100"),
        "the retired one: {message}"
    );
    assert!(
        message.contains("heading") && message.contains("inactive"),
        "each says which of the three things is wrong with it: {message}"
    );
    assert_eq!(count(&pool, "journal_entry").await, 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_ledger_begins_once_and_a_second_import_is_refused(pool: PgPool) {
    a_world(&pool).await;

    cloud::opening_import_balances(&pool, &request(BALANCES, true), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("first import: {error}"));

    let error = cloud::opening_import_balances(&pool, &request(BALANCES, true), ACTOR)
        .await
        .expect_err("a ledger begins once");
    assert!(
        error.to_string().contains("already been posted"),
        "and it says so rather than doubling every balance: {error}"
    );
    assert_eq!(
        balance(&pool, "101120100100").await,
        15_000_000,
        "the stock did not double"
    );
    assert_eq!(count(&pool, "journal_entry").await, 2);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_closed_month_refuses_an_opening_balance_like_any_other_posting(pool: PgPool) {
    a_world(&pool).await;
    cloud::close_period(&pool, 2026, 8, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("close: {error}"));

    let error = cloud::opening_import_balances(&pool, &request(BALANCES, true), ACTOR)
        .await
        .expect_err("a signed-off month is not rewritten, not even to begin");
    assert!(error.to_string().contains("closed"), "{error}");
    assert_eq!(count(&pool, "journal_entry").await, 0);
}

// ---------------------------------------------------------------------------
// The opening stock
// ---------------------------------------------------------------------------

/// Priced to agree with the trial balance above: 15,000,000 at head office and
/// 4,000,000 at the shop.
const STOCK: &str =
    "site_id,article_code,pool_id,quantity,last_purchase_cost,stated_cost,document_no
dc,ART-001,dc.warehouse,100,120.000,,SO-2026-08
dc,ART-002,dc.warehouse,30,100.000,,SO-2026-08
store-01,ART-001,store-01.floor,40,100.000,,SO-2026-08
";

async fn a_priced_world(pool: &PgPool) -> (Uuid, Uuid) {
    a_world(pool).await;
    let one = seed_article(pool, "ART-001").await;
    let two = seed_article(pool, "ART-002").await;
    cloud::opening_import_balances(pool, &request(BALANCES, true), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("balances: {error}"));
    (one, two)
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn opening_stock_creates_the_layers_the_inventory_account_is_explained_by(pool: PgPool) {
    a_priced_world(&pool).await;

    let outcome = cloud::opening_import_stock(&pool, &request(STOCK, true), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("stock: {error}"));

    assert_eq!(outcome.layers, 3);
    assert!(
        outcome.fallbacks.is_empty(),
        "every line carried the client's own purchase price"
    );
    for site in &outcome.sites {
        assert!(
            site.reconciliation.agrees,
            "{} prices its stock at {} and {} carries {}",
            site.site_id,
            site.value_minor,
            site.inventory_account,
            site.reconciliation.ledger_minor
        );
    }

    // The layers are ordinary layers: the valuation screen can see them, and
    // they cost what the sheet said.
    let queue = cloud::cost_layer_queue(&pool, "ART-001")
        .await
        .unwrap_or_else(|error| panic!("queue: {error}"));
    assert_eq!(queue.len(), 2, "one per place");
    assert_eq!(queue[0].economic_date, cutover());
    assert_eq!(
        queue.iter().map(|l| l.remaining_value_minor).sum::<i64>(),
        16_000_000,
        "100 at 120,000 plus 40 at 100,000"
    );

    // And the opening layers post no journal of their own: the debit to
    // inventory already has an owner in the opening trial balance, and a second
    // one would put the same stock into the asset twice with both balancing.
    assert_eq!(balance(&pool, "101120100100").await, 15_000_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn opening_stock_that_does_not_reconcile_is_refused_and_the_difference_is_named(
    pool: PgPool,
) {
    a_priced_world(&pool).await;

    // A million rupiah of stock that the trial balance never accounted for.
    let too_much = "site_id,article_code,pool_id,quantity,last_purchase_cost,document_no
dc,ART-001,dc.warehouse,100,120.000,SO-2026-08
dc,ART-002,dc.warehouse,40,100.000,SO-2026-08
store-01,ART-001,store-01.floor,40,100.000,SO-2026-08
";
    let error = cloud::opening_import_stock(&pool, &request(too_much, true), ACTOR)
        .await
        .expect_err("the reconciliation is the point of this import");
    let message = error.to_string();
    assert!(message.contains("1000000"), "the difference: {message}");
    assert!(message.contains("101120100100"), "the account: {message}");
    assert_eq!(count(&pool, "cost_layer").await, 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_price_nobody_gave_is_refused_rather_than_opened_at_zero(pool: PgPool) {
    a_priced_world(&pool).await;

    let no_price =
        "site_id,article_code,pool_id,quantity,last_purchase_cost,stated_cost,document_no
dc,ART-001,dc.warehouse,100,120.000,,SO-2026-08
dc,ART-002,dc.warehouse,30,,,SO-2026-08
store-01,ART-001,store-01.floor,40,100.000,,SO-2026-08
";
    let error = cloud::opening_import_stock(&pool, &request(no_price, true), ACTOR)
        .await
        .expect_err("a layer costing nothing sells at a hundred per cent margin, quietly");
    let message = error.to_string();
    assert!(message.contains("ART-002"), "which line: {message}");
    assert!(message.contains("no fallback"), "{message}");
    assert_eq!(count(&pool, "cost_layer").await, 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_stated_price_is_carried_and_reported_as_a_fallback(pool: PgPool) {
    a_priced_world(&pool).await;

    // ART-002 has no purchase history; somebody put 100,000 on the sheet.
    let stated = "site_id,article_code,pool_id,quantity,last_purchase_cost,stated_cost,document_no
dc,ART-001,dc.warehouse,100,120.000,,SO-2026-08
dc,ART-002,dc.warehouse,30,,100.000,SO-2026-08
store-01,ART-001,store-01.floor,40,100.000,,SO-2026-08
";
    let outcome = cloud::opening_import_stock(&pool, &request(stated, true), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("stock: {error}"));

    assert_eq!(outcome.fallbacks.len(), 1);
    let fallback = &outcome.fallbacks[0];
    assert_eq!(fallback.article_code, "ART-002");
    assert_eq!(fallback.basis, "STATED_FALLBACK");
    assert_eq!(fallback.value_minor, 3_000_000);
    assert!(
        fallback.note.contains("stated on the sheet"),
        "the note says which rule priced it, in a sentence: {}",
        fallback.note
    );

    // And it is visible afterwards, which is the whole reason it is stored.
    let report = cloud::opening_cutover_report(&pool, cutover())
        .await
        .unwrap_or_else(|error| panic!("report: {error}"));
    assert_eq!(report.fallback_value_minor, 3_000_000);
    assert_eq!(report.stock_value_minor, 19_000_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_sale_on_the_first_morning_consumes_the_opening_layer(pool: PgPool) {
    let (_one, two) = a_priced_world(&pool).await;
    cloud::opening_import_stock(&pool, &request(STOCK, true), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("stock: {error}"));

    // The first day of the new system. Nothing has been received; the only
    // basis in the queue is what the cutover put there.
    //
    // ART-002 and not ART-001 deliberately. The FIFO queue is the COMPANY's —
    // one interchangeable shirt is as good as another wherever it is standing —
    // so ART-001's two opening layers, both dated the cutover, are two equally
    // old candidates and which one a head-office sale takes is not something
    // this test should be asserting. ART-002 was opened at head office only, so
    // the cost below is the cost the cutover chose and nothing else.
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posting = cloud::stock_ledger_consume(
        &mut tx,
        &StockOutflow {
            article_id: two,
            sku_id: None,
            epc: None,
            lot_reference: None,
            quantity: 5,
            event_kind: "SALE".into(),
            event_id: "S-0001".into(),
            from_pool_id: "dc.warehouse".into(),
            site_id: "dc".into(),
            economic_date: NaiveDate::from_ymd_opt(2026, 9, 1)
                .unwrap_or_else(|| panic!("bad date")),
            source_id: "SALES-2026-09-01".into(),
            memo: Some("Penjualan hari pertama".into()),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("consume: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    assert_eq!(
        posting.value_minor, 500_000,
        "five at the 100,000 the cutover priced them at — a queue with no beginning would \
         have had nothing to take"
    );
    assert_eq!(posting.allocations.len(), 1);
    assert_eq!(
        balance(&pool, "501011000100").await,
        500_000,
        "and the cost reached the books"
    );
    assert_eq!(
        balance(&pool, "101120100100").await,
        14_500_000,
        "the inventory account came down by what left it"
    );
}

// ---------------------------------------------------------------------------
// The open items
// ---------------------------------------------------------------------------

/// Nine million of unpaid supplier bills at head office: exactly what the
/// opening trial balance credited to `201200100100`.
const OPEN_ITEMS: &str = "site_id,account_key,qualifier,party_type,party_id,party_name,side,voucher_kind,voucher_id,amount,document_date,due_date
dc,trade_payable,,SUPPLIER,SUP-01,PT Kain Jaya,PAYABLE,INVOICE,INV-8891,6.000.000,2026-08-02,2026-09-30
dc,trade_payable,,SUPPLIER,SUP-02,CV Benang Mas,PAYABLE,INVOICE,INV-8892,3.000.000,2026-07-15,2026-08-14
";

#[sqlx::test(migrations = "./migrations/postgres")]
async fn unpaid_bills_open_as_items_and_the_equation_reports_balanced(pool: PgPool) {
    a_priced_world(&pool).await;

    let outcome = cloud::opening_import_subledger(&pool, &request(OPEN_ITEMS, true), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("subledger: {error}"));

    assert_eq!(outcome.lines, 2);
    assert_eq!(outcome.payable_minor, 9_000_000);
    assert_eq!(outcome.parties, 2);

    // The equation 0145 exists to make checkable, asked the moment the items
    // are open rather than at the first month end.
    let integrity = cloud::payment_ledger_integrity(&pool, Some(cutover()), None)
        .await
        .unwrap_or_else(|error| panic!("integrity: {error}"));
    assert!(
        integrity.agrees,
        "the sub-ledger and the books have started life apart: {:?}",
        integrity.rows
    );

    // A supplier ringing up on the second day and quoting a number from before
    // the cutover can be answered, which is what the voucher is for.
    let items = cloud::ple_open_items(
        &pool,
        &cloud::PaymentLedgerFilter {
            account_key: Some("trade_payable".into()),
            as_of: Some(cutover()),
            limit: 50,
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("open items: {error}"));
    assert!(items.iter().any(|item| item.voucher_id == "INV-8891"));

    // And the one that was already overdue on the cutover date is aged from
    // the client's own invoice date, not from the cutover.
    let overdue = items
        .iter()
        .find(|item| item.voucher_id == "INV-8892")
        .unwrap_or_else(|| panic!("INV-8892"));
    assert_eq!(
        overdue.due_date,
        NaiveDate::from_ymd_opt(2026, 8, 14),
        "an open item at a cutover is older than the cutover, and half of them are overdue"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn open_items_that_do_not_explain_the_control_account_are_refused(pool: PgPool) {
    a_priced_world(&pool).await;

    let short = "site_id,account_key,qualifier,party_type,party_id,party_name,side,voucher_kind,voucher_id,amount,document_date,due_date
dc,trade_payable,,SUPPLIER,SUP-01,PT Kain Jaya,PAYABLE,INVOICE,INV-8891,6.000.000,2026-08-02,2026-09-30
";
    let error = cloud::opening_import_subledger(&pool, &request(short, true), ACTOR)
        .await
        .expect_err("a sub-ledger that starts out of agreement never catches up");
    let message = error.to_string();
    assert!(message.contains("trade_payable"), "{message}");
    assert!(message.contains("201200100100"), "the account: {message}");
    assert_eq!(count(&pool, "payment_ledger_entry").await, 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn open_items_need_the_opening_balances_to_hang_off(pool: PgPool) {
    a_world(&pool).await;

    let error = cloud::opening_import_subledger(&pool, &request(OPEN_ITEMS, true), ACTOR)
        .await
        .expect_err("an open item explains a balance the books have already recognised");
    assert!(
        error.to_string().contains("no opening journal entry"),
        "{error}"
    );
}

// ---------------------------------------------------------------------------
// The rehearsal
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_rehearsal_posts_nothing_and_reports_what_the_run_would(pool: PgPool) {
    a_world(&pool).await;

    let rehearsed = cloud::opening_import_balances(&pool, &request(BALANCES, false), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("rehearsal: {error}"));

    assert!(!rehearsed.committed);
    assert_eq!(
        count(&pool, "journal_entry").await,
        0,
        "a rehearsal posts nothing"
    );
    assert_eq!(count(&pool, "opening_balance_line").await, 0);
    assert_eq!(balance(&pool, "101120100100").await, 0);

    // And what it reported is what the run does. Not "close to" — the same
    // numbers, because it is the same code with the transaction rolled back.
    let run = cloud::opening_import_balances(&pool, &request(BALANCES, true), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("run: {error}"));

    assert!(run.committed);
    assert_eq!(run.lines, rehearsed.lines);
    assert_eq!(run.sites, rehearsed.sites);
    assert_eq!(run.document_numbers, rehearsed.document_numbers);
    assert_eq!(
        run.entries
            .iter()
            .map(|e| e.total_minor)
            .collect::<Vec<_>>(),
        rehearsed
            .entries
            .iter()
            .map(|e| e.total_minor)
            .collect::<Vec<_>>()
    );
    assert_eq!(
        run.equations
            .iter()
            .map(|e| (e.site_id.clone(), e.difference_minor))
            .collect::<Vec<_>>(),
        rehearsed
            .equations
            .iter()
            .map(|e| (e.site_id.clone(), e.difference_minor))
            .collect::<Vec<_>>(),
        "the equations the rehearsal predicted are the ones the run leaves"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_rehearsal_of_the_stock_names_its_fallbacks_and_leaves_the_queue_empty(pool: PgPool) {
    a_priced_world(&pool).await;

    let stated = "site_id,article_code,pool_id,quantity,last_purchase_cost,stated_cost,document_no
dc,ART-001,dc.warehouse,100,120.000,,SO-2026-08
dc,ART-002,dc.warehouse,30,,100.000,SO-2026-08
store-01,ART-001,store-01.floor,40,100.000,,SO-2026-08
";
    let rehearsed = cloud::opening_import_stock(&pool, &request(stated, false), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("rehearsal: {error}"));

    assert!(!rehearsed.committed);
    assert_eq!(rehearsed.layers, 3, "it says what it would create");
    assert_eq!(rehearsed.fallbacks.len(), 1, "and which price was invented");
    assert_eq!(
        count(&pool, "cost_layer").await,
        0,
        "and creates none of them"
    );
    assert_eq!(count(&pool, "opening_stock_line").await, 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_rehearsal_finds_the_refusal_the_run_would_hit(pool: PgPool) {
    a_priced_world(&pool).await;

    // The same sheet that is refused for real, rehearsed. A rehearsal that
    // reported "fine" and then failed on the night would be worse than no
    // rehearsal at all.
    let too_much = "site_id,article_code,pool_id,quantity,last_purchase_cost,document_no
dc,ART-001,dc.warehouse,100,120.000,SO-2026-08
dc,ART-002,dc.warehouse,40,100.000,SO-2026-08
store-01,ART-001,store-01.floor,40,100.000,SO-2026-08
";
    let error = cloud::opening_import_stock(&pool, &request(too_much, false), ACTOR)
        .await
        .expect_err("the rehearsal is the run");
    assert!(error.to_string().contains("1000000"), "{error}");
}

// ---------------------------------------------------------------------------
// The cutover report
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_cutover_report_answers_the_three_questions_on_one_page(pool: PgPool) {
    a_priced_world(&pool).await;
    cloud::opening_import_stock(&pool, &request(STOCK, true), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("stock: {error}"));
    cloud::opening_import_subledger(&pool, &request(OPEN_ITEMS, true), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("subledger: {error}"));

    let report = cloud::opening_cutover_report(&pool, cutover())
        .await
        .unwrap_or_else(|error| panic!("report: {error}"));

    assert!(
        report.sound,
        "every equation balanced, nothing unmapped: {:?}",
        report
            .equations
            .iter()
            .filter(|e| !e.agrees)
            .collect::<Vec<_>>()
    );
    assert!(report.unmapped.is_empty());
    assert!(report.fallbacks.is_empty());
    assert_eq!(report.stock_value_minor, 19_000_000);
    assert_eq!(report.payable_minor, 9_000_000);
    assert_eq!(report.entries.len(), 2);
    assert!(report.document_numbers.contains(&"TB-2026-08".to_string()));
    assert!(report.document_numbers.contains(&"SO-2026-08".to_string()));

    // All three families of equation are on the page: the books balancing, the
    // open items against their control account, and the shelf against the
    // inventory account.
    for key in [
        "ledger.balanced",
        "payment_ledger.control_accounts",
        "stock.value_vs_gl",
    ] {
        assert!(
            report.equations.iter().any(|e| e.key == key),
            "the report does not answer {key}"
        );
    }
}
