//! The Payment Ledger's invariants, proved against a real Postgres.
//!
//! The claim being tested is one sentence: an open-item ledger does not replace
//! the books, it explains a line of them. So most of what follows opens a
//! balance, moves it, and then asks whether the two still agree — because a
//! sub-ledger that quietly parted company with the general ledger would pass
//! every test written only about itself.
//!
//! Two of these reach past the API entirely and write raw SQL, in the spirit of
//! `finance_integration`: if over-settlement is only impossible when you go
//! through the front door, it is not impossible.

use chrono::NaiveDate;
use inventory_backend::cloud::domain::{required_role, Role};
use inventory_backend::cloud::postgres::{
    self as cloud, LineAccount, PaymentLedgerAllocation, PaymentLedgerItem, PaymentLedgerPartyType,
    PaymentLedgerSide, PostingIntent, PostingLine,
};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
const SITE: &str = "dc";

// ---------------------------------------------------------------------------
// A chart small enough to read and shaped like the client's
// ---------------------------------------------------------------------------

/// Head office's leaves for the meanings this lane touches.
///
/// The ladder is kept because the client's codes ARE the tree and a balance
/// rolls up by prefix. Leaves hanging straight off a root would pass a test
/// that a real chart fails.
async fn seed_chart(pool: &PgPool) {
    let groups: [(&str, &str, Option<&str>); 18] = [
        ("1", "ASSET", None),
        ("101", "CURRENT ASSET", Some("1")),
        ("10110", "KAS DAN SETARA KAS", Some("101")),
        ("1011001", "KAS", Some("10110")),
        ("1011003", "CASH IN BANK TABUNGAN", Some("10110")),
        ("10111", "PIUTANG", Some("101")),
        ("1011101", "PIUTANG KARTU", Some("10111")),
        ("1011102", "PIUTANG LAIN-LAIN", Some("10111")),
        ("10112", "PERSEDIAAN", Some("101")),
        ("1011201", "Persediaan Barang Dagang", Some("10112")),
        ("2", "LIABILITIES", None),
        ("201", "HUTANG JANGKA PENDEK", Some("2")),
        ("20120", "HUTANG DAGANG", Some("201")),
        ("2012001", "HUTANG SUPPLIER", Some("20120")),
        ("4", "PENDAPATAN", None),
        ("401", "PENJUALAN", Some("4")),
        ("40101", "PENJUALAN", Some("401")),
        ("4010110", "Penjualan Barang Dagangan", Some("40101")),
    ];
    for (code, name, parent) in groups {
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group)
             VALUES ($1,$2,$3,true)",
        )
        .bind(code)
        .bind(name)
        .bind(parent)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{code}: {error}"));
    }
    for (code, name, parent) in [
        ("101100100100", "Cash On Hand HO", "1011001"),
        ("101100300100", "Cash In Bank Tabungan HO", "1011003"),
        ("101110100200", "Piutang Debit Card HO", "1011101"),
        ("101110200200", "PIUTANG KEPALA TOKO HO", "1011102"),
        ("101120100100", "Persediaan Barang Dagangan HO", "1011201"),
        (
            "201200100100",
            "Hutang Suppliers Barang Dagangan HO",
            "2012001",
        ),
        ("401011000100", "Penjualan Barang Dagangan HO", "4010110"),
    ] {
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
             VALUES ($1,$2,$3,false,'dc')",
        )
        .bind(code)
        .bind(name)
        .bind(parent)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{code}: {error}"));
    }
}

async fn map(pool: &PgPool, key: &str, code: &str) {
    cloud::set_account_mapping(
        pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: key.into(),
            site_id: SITE.into(),
            qualifier: String::new(),
            account_code: code.into(),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("map {key}: {error}"));
}

/// Chart, September open, and the meanings this lane posts against.
async fn books(pool: &PgPool) {
    seed_chart(pool).await;
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
    map(pool, "inventory", "101120100100").await;
    map(pool, "trade_payable", "201200100100").await;
    map(pool, "card_receivable_debit", "101110100200").await;
    map(pool, "store_manager_receivable", "101110200200").await;
    map(pool, "cash", "101100100100").await;
    map(pool, "bank_savings", "101100300100").await;
}

fn september(day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, day).unwrap_or_else(|| panic!("bad date"))
}

fn to_account(code: &str, debit: i64, credit: i64) -> PostingLine {
    PostingLine {
        account: LineAccount::Account {
            account_code: code.to_string(),
        },
        site_id: SITE.to_string(),
        debit_minor: debit,
        credit_minor: credit,
        supplier_id: None,
        memo: None,
    }
}

fn intent(kind: &str, source: &str, day: u32, lines: Vec<PostingLine>) -> PostingIntent {
    PostingIntent {
        posting_date: september(day),
        source_kind: kind.into(),
        source_id: Some(source.into()),
        rule_version: "lane_p_test/1".into(),
        currency: "IDR".into(),
        memo: Some(format!("{kind} {source}")),
        lines,
    }
}

fn payable(voucher: &str, journal_entry_id: Uuid, amount: i64, due: u32) -> PaymentLedgerItem {
    PaymentLedgerItem {
        account_key: "trade_payable".into(),
        qualifier: String::new(),
        site_id: SITE.into(),
        party_type: PaymentLedgerPartyType::Supplier,
        party_id: "SUP01".into(),
        party_name: Some("PT Benang Emas".into()),
        voucher_kind: "SUPPLIER_INVOICE".into(),
        voucher_id: voucher.into(),
        journal_entry_id,
        side: PaymentLedgerSide::Payable,
        amount_minor: amount,
        currency: "IDR".into(),
        due_date: Some(september(due)),
        posting_date: september(1),
    }
}

/// Post a bill and open the payable it creates, in one transaction, the way a
/// posting rule will.
async fn bill(pool: &PgPool, voucher: &str, amount: i64, due: u32) -> Uuid {
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posted = cloud::post(
        &mut tx,
        &intent(
            "SUPPLIER_INVOICE",
            voucher,
            1,
            vec![
                PostingLine::debit("inventory", SITE, amount),
                PostingLine::credit("trade_payable", SITE, amount).for_supplier("SUP01"),
            ],
        ),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post {voucher}: {error}"));
    let entry_id = cloud::ple_open(
        &mut tx,
        &payable(voucher, posted.entry_id, amount, due),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("open {voucher}: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));
    entry_id
}

/// What the browser is actually shown. A trigger's `RAISE EXCEPTION` is
/// SQLSTATE P0001, which `into_response` passes through verbatim as a 409;
/// `to_string()` would test a different surface.
fn as_shown_to_a_person(error: &inventory_backend::cloud::application::AppError) -> String {
    use inventory_backend::cloud::application::AppError;
    match error {
        AppError::Database(sqlx::Error::Database(db)) if db.code().as_deref() == Some("P0001") => {
            db.message().to_string()
        }
        other => other.to_string(),
    }
}

// ---------------------------------------------------------------------------
// The equation
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_open_item_and_its_control_account_hold_the_same_money(pool: PgPool) {
    books(&pool).await;
    bill(&pool, "INV-1", 8_600_000, 30).await;

    let outstanding = cloud::ple_outstanding(
        &pool,
        "trade_payable",
        Some(SITE),
        Some(""),
        Some(september(30)),
    )
    .await
    .unwrap_or_else(|error| panic!("outstanding: {error}"));
    assert_eq!(outstanding.outstanding_minor, 8_600_000);
    assert_eq!(outstanding.open_items, 1);

    // The same money, read from the books. A payable is a credit balance, so
    // the general ledger's signed figure is the negative of the ledger's.
    let control = cloud::account_balance(&pool, "201200100100", Some(SITE), Some(september(30)))
        .await
        .unwrap_or_else(|error| panic!("balance: {error}"));
    assert_eq!(control.balance_minor, -8_600_000);

    let integrity = cloud::payment_ledger_integrity(&pool, Some(september(30)), None)
        .await
        .unwrap_or_else(|error| panic!("integrity: {error}"));
    assert!(
        integrity.agrees,
        "the ledger and the books should agree, differences: {:?}",
        integrity
            .rows
            .iter()
            .map(|row| (row.account_key.clone(), row.difference_minor))
            .collect::<Vec<_>>()
    );
    assert_eq!(integrity.rows.len(), 1);
    let row = &integrity.rows[0];
    assert_eq!(row.account_code.as_deref(), Some("201200100100"));
    assert_eq!(row.ledger_outstanding_minor, 8_600_000);
    assert_eq!(row.gl_balance_minor, 8_600_000);
    assert_eq!(row.difference_minor, 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_receivable_agrees_with_its_control_account_the_same_way(pool: PgPool) {
    books(&pool).await;

    // A card sale: the acquirer owes us until the settlement lands. This is the
    // balance nothing followed before this lane existed.
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posted = cloud::post(
        &mut tx,
        &intent(
            "SALE_DAY",
            "2026-09-02/dc",
            2,
            vec![
                PostingLine::debit("card_receivable_debit", SITE, 4_250_000),
                to_account("401011000100", 0, 4_250_000),
            ],
        ),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post: {error}"));
    cloud::ple_open(
        &mut tx,
        &PaymentLedgerItem {
            account_key: "card_receivable_debit".into(),
            qualifier: String::new(),
            site_id: SITE.into(),
            party_type: PaymentLedgerPartyType::Acquirer,
            party_id: "BCA".into(),
            party_name: Some("BCA".into()),
            voucher_kind: "SALE_DAY".into(),
            voucher_id: "2026-09-02/dc".into(),
            journal_entry_id: posted.entry_id,
            side: PaymentLedgerSide::Receivable,
            amount_minor: 4_250_000,
            currency: "IDR".into(),
            due_date: Some(september(4)),
            posting_date: september(2),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("open: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    let integrity = cloud::payment_ledger_integrity(&pool, Some(september(30)), None)
        .await
        .unwrap_or_else(|error| panic!("integrity: {error}"));
    assert!(integrity.agrees);
    let row = &integrity.rows[0];
    assert_eq!(row.side, "RECEIVABLE");
    // Signed to the ledger's own side: a receivable is a debit balance, and the
    // comparison is a difference rather than a sum.
    assert_eq!(row.gl_balance_minor, 4_250_000);
    assert_eq!(row.difference_minor, 0);
}

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_partial_settlement_leaves_the_rest_open(pool: PgPool) {
    books(&pool).await;
    let item = bill(&pool, "INV-1", 8_600_000, 30).await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posted = cloud::post(
        &mut tx,
        &intent(
            "PAYMENT",
            "PAY-1",
            10,
            vec![
                PostingLine::credit("cash", SITE, 3_600_000),
                PostingLine::debit("trade_payable", SITE, 3_600_000).for_supplier("SUP01"),
            ],
        ),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post payment: {error}"));
    let settled = cloud::ple_settle(
        &mut tx,
        "PAYMENT",
        "PAY-1",
        posted.entry_id,
        september(10),
        &[PaymentLedgerAllocation {
            entry_id: item,
            amount_minor: 3_600_000,
        }],
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("settle: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    assert_eq!(settled.applied_minor, 3_600_000);
    assert_eq!(settled.items.len(), 1);
    assert_eq!(settled.items[0].outstanding_minor, 5_000_000);

    let outstanding = cloud::ple_outstanding(
        &pool,
        "trade_payable",
        Some(SITE),
        Some(""),
        Some(september(30)),
    )
    .await
    .unwrap_or_else(|error| panic!("outstanding: {error}"));
    assert_eq!(outstanding.outstanding_minor, 5_000_000);

    // And the books moved by the same 3,600,000, which is the only reason the
    // remainder can be believed.
    let integrity = cloud::payment_ledger_integrity(&pool, Some(september(30)), None)
        .await
        .unwrap_or_else(|error| panic!("integrity: {error}"));
    assert!(integrity.agrees, "{:?}", integrity.rows);
    assert_eq!(integrity.rows[0].ledger_outstanding_minor, 5_000_000);

    // Asked from either end: what this payment paid for, and what has been paid
    // against this bill.
    let history = cloud::payment_ledger_settlements(&pool, "PAYMENT", "PAY-1")
        .await
        .unwrap_or_else(|error| panic!("history: {error}"));
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].role, "SETTLED_BY");
    assert_eq!(history[0].amount_minor, 3_600_000);
    let against = cloud::payment_ledger_settlements(&pool, "SUPPLIER_INVOICE", "INV-1")
        .await
        .unwrap_or_else(|error| panic!("history: {error}"));
    assert_eq!(against.len(), 1);
    assert_eq!(against[0].role, "SETTLED");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn settling_more_than_is_open_is_refused_and_says_by_how_much(pool: PgPool) {
    books(&pool).await;
    let item = bill(&pool, "INV-1", 8_600_000, 30).await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posted = cloud::post(
        &mut tx,
        &intent(
            "PAYMENT",
            "PAY-1",
            10,
            vec![
                PostingLine::credit("cash", SITE, 9_000_000),
                PostingLine::debit("trade_payable", SITE, 9_000_000).for_supplier("SUP01"),
            ],
        ),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post payment: {error}"));
    let refusal = cloud::ple_settle(
        &mut tx,
        "PAYMENT",
        "PAY-1",
        posted.entry_id,
        september(10),
        &[PaymentLedgerAllocation {
            entry_id: item,
            amount_minor: 9_000_000,
        }],
        ACTOR,
    )
    .await;

    let message = match refusal {
        Ok(settled) => panic!("settled {} against 8,600,000", settled.applied_minor),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains("8600000"),
        "the refusal should say what is actually open, said: {message}"
    );
    assert!(
        message.contains(&item.to_string()),
        "the refusal should name the item, said: {message}"
    );
}

/// The refusal above is the explanation. This is the guarantee.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn even_raw_sql_cannot_settle_more_than_is_open(pool: PgPool) {
    books(&pool).await;
    let item = bill(&pool, "INV-1", 8_600_000, 30).await;
    let journal: Uuid =
        sqlx::query("SELECT journal_entry_id FROM payment_ledger_entry WHERE entry_id=$1")
            .bind(item)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("read: {error}"))
            .try_get("journal_entry_id")
            .unwrap_or_else(|error| panic!("column: {error}"));

    // Straight past the API: raw SQL, exactly as a careless migration or a
    // second writer would do it.
    let refusal = sqlx::query(
        "INSERT INTO payment_ledger_settlement
           (settlement_id, entry_id, against_voucher_kind, against_voucher_id,
            amount_minor, journal_entry_id, posting_date, created_by)
         VALUES (gen_random_uuid(), $1, 'PAYMENT', 'PAY-RAW', 9000000, $2, '2026-09-10', 'psql')",
    )
    .bind(item)
    .bind(journal)
    .execute(&pool)
    .await;

    let error = match refusal {
        Ok(_) => panic!("raw SQL over-settled an open item"),
        Err(error) => inventory_backend::cloud::application::AppError::from(error),
    };
    let message = as_shown_to_a_person(&error);
    assert!(
        message.contains("more than"),
        "the trigger should say what it refused, said: {message}"
    );
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn reversing_a_bill_takes_its_balance_out_of_outstanding(pool: PgPool) {
    books(&pool).await;
    bill(&pool, "INV-1", 8_600_000, 30).await;
    let journal: Uuid = sqlx::query("SELECT journal_entry_id FROM payment_ledger_entry LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("read: {error}"))
        .try_get("journal_entry_id")
        .unwrap_or_else(|error| panic!("column: {error}"));

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    cloud::reverse(&mut tx, journal, september(12), "keyed twice", ACTOR)
        .await
        .unwrap_or_else(|error| panic!("reverse: {error}"));
    let delinked = cloud::ple_delink(&mut tx, "SUPPLIER_INVOICE", "INV-1", "keyed twice", ACTOR)
        .await
        .unwrap_or_else(|error| panic!("delink: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    assert_eq!(delinked.entries_delinked, 1);

    let outstanding = cloud::ple_outstanding(
        &pool,
        "trade_payable",
        Some(SITE),
        Some(""),
        Some(september(30)),
    )
    .await
    .unwrap_or_else(|error| panic!("outstanding: {error}"));
    assert_eq!(outstanding.outstanding_minor, 0);
    assert_eq!(outstanding.open_items, 0);

    // The reversal took the payable out of the books too, so the two still
    // agree — which is the whole point of delinking rather than deleting.
    let integrity = cloud::payment_ledger_integrity(&pool, Some(september(30)), None)
        .await
        .unwrap_or_else(|error| panic!("integrity: {error}"));
    assert!(integrity.agrees, "{:?}", integrity.rows);

    // The row is still there. A balance that vanished would leave the reversing
    // journal entry with nothing to explain it.
    let kept: i64 = sqlx::query("SELECT COUNT(*)::bigint AS n FROM payment_ledger_entry")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"))
        .try_get("n")
        .unwrap_or_else(|error| panic!("column: {error}"));
    assert_eq!(kept, 1);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn reversing_a_payment_opens_again_what_it_had_closed(pool: PgPool) {
    books(&pool).await;
    let item = bill(&pool, "INV-1", 8_600_000, 30).await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posted = cloud::post(
        &mut tx,
        &intent(
            "PAYMENT",
            "PAY-1",
            10,
            vec![
                PostingLine::credit("cash", SITE, 8_600_000),
                PostingLine::debit("trade_payable", SITE, 8_600_000).for_supplier("SUP01"),
            ],
        ),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post payment: {error}"));
    cloud::ple_settle(
        &mut tx,
        "PAYMENT",
        "PAY-1",
        posted.entry_id,
        september(10),
        &[PaymentLedgerAllocation {
            entry_id: item,
            amount_minor: 8_600_000,
        }],
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("settle: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    // The transfer bounced.
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    cloud::reverse(&mut tx, posted.entry_id, september(12), "bounced", ACTOR)
        .await
        .unwrap_or_else(|error| panic!("reverse: {error}"));
    let delinked = cloud::ple_delink(&mut tx, "PAYMENT", "PAY-1", "bounced", ACTOR)
        .await
        .unwrap_or_else(|error| panic!("delink: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    assert_eq!(delinked.entries_delinked, 0);
    assert_eq!(delinked.settlements_delinked, 1);
    assert_eq!(delinked.reopened_minor, 8_600_000);

    let outstanding = cloud::ple_outstanding(
        &pool,
        "trade_payable",
        Some(SITE),
        Some(""),
        Some(september(30)),
    )
    .await
    .unwrap_or_else(|error| panic!("outstanding: {error}"));
    assert_eq!(outstanding.outstanding_minor, 8_600_000);
}

// ---------------------------------------------------------------------------
// Ageing
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn each_balance_lands_in_the_bucket_its_age_puts_it_in(pool: PgPool) {
    books(&pool).await;
    // Read as at 30 September: due the 30th is not late, due the 1st is 29 days
    // late, and one carried over from June is well past ninety.
    bill(&pool, "INV-NOT-DUE", 1_000_000, 30).await;
    bill(&pool, "INV-RECENT", 2_000_000, 1).await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posted = cloud::post(
        &mut tx,
        &intent(
            "SUPPLIER_INVOICE",
            "INV-OLD",
            1,
            vec![
                PostingLine::debit("inventory", SITE, 4_000_000),
                PostingLine::credit("trade_payable", SITE, 4_000_000).for_supplier("SUP02"),
            ],
        ),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post: {error}"));
    cloud::ple_open(
        &mut tx,
        &PaymentLedgerItem {
            party_id: "SUP02".into(),
            party_name: Some("CV Kain Nusantara".into()),
            voucher_id: "INV-OLD".into(),
            due_date: Some(NaiveDate::from_ymd_opt(2026, 6, 1).unwrap_or_else(|| panic!("date"))),
            posting_date: NaiveDate::from_ymd_opt(2026, 6, 1).unwrap_or_else(|| panic!("date")),
            ..payable("INV-OLD", posted.entry_id, 4_000_000, 1)
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("open: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    let aging = cloud::payment_ledger_aging(
        &pool,
        Some(september(30)),
        &cloud::PaymentLedgerFilter::default(),
    )
    .await
    .unwrap_or_else(|error| panic!("aging: {error}"));

    assert_eq!(aging.total.not_due_minor, 1_000_000);
    assert_eq!(aging.total.days_1_30_minor, 2_000_000);
    assert_eq!(aging.total.days_over_90_minor, 4_000_000);
    assert_eq!(aging.total.total_minor, 7_000_000);

    // One control account, and two parties inside it. Heaviest first, because
    // an ageing report is read to decide what to chase.
    assert_eq!(aging.accounts.len(), 1);
    assert_eq!(aging.accounts[0].account_key, "trade_payable");
    assert_eq!(aging.accounts[0].items, 3);
    assert_eq!(aging.accounts[0].oldest_days, 121);
    assert_eq!(aging.parties.len(), 2);
    assert_eq!(aging.parties[0].party_id.as_deref(), Some("SUP02"));
    assert_eq!(aging.parties[0].buckets.total_minor, 4_000_000);
}

// ---------------------------------------------------------------------------
// Idempotence, and the rule about what belongs here
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn opening_the_same_balance_twice_opens_it_once(pool: PgPool) {
    books(&pool).await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posted = cloud::post(
        &mut tx,
        &intent(
            "SUPPLIER_INVOICE",
            "INV-1",
            1,
            vec![
                PostingLine::debit("inventory", SITE, 8_600_000),
                PostingLine::credit("trade_payable", SITE, 8_600_000).for_supplier("SUP01"),
            ],
        ),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post: {error}"));
    let item = payable("INV-1", posted.entry_id, 8_600_000, 30);

    let first = cloud::ple_open(&mut tx, &item, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("first: {error}"));
    // The retried command, the replayed sync batch, the double-clicked button.
    let second = cloud::ple_open(&mut tx, &item, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("second: {error}"));
    assert_eq!(
        first, second,
        "a retry should find the balance already open"
    );

    // What is refused is the same document claiming a different amount. That is
    // not a retry; it is two events wearing one document number.
    let conflict = cloud::ple_open(
        &mut tx,
        &PaymentLedgerItem {
            amount_minor: 9_000_000,
            ..item.clone()
        },
        ACTOR,
    )
    .await;
    let message = match conflict {
        Ok(_) => panic!("a second amount was accepted under one document"),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains("8600000") && message.contains("9000000"),
        "the refusal should name both amounts, said: {message}"
    );
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    let count: i64 = sqlx::query("SELECT COUNT(*)::bigint AS n FROM payment_ledger_entry")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"))
        .try_get("n")
        .unwrap_or_else(|error| panic!("column: {error}"));
    assert_eq!(count, 1);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn money_moving_is_not_enough_to_open_a_balance(pool: PgPool) {
    books(&pool).await;

    // Cash banked. Real money, a real journal entry, and nothing anybody has to
    // follow to settlement — so the Payment Ledger stays empty. 0143 has the
    // list; this is the rule as a test.
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    cloud::post(
        &mut tx,
        &intent(
            "TRANSFER",
            "DEP-1",
            5,
            vec![
                PostingLine::debit("bank_savings", SITE, 12_000_000),
                PostingLine::credit("cash", SITE, 12_000_000),
            ],
        ),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    let entries: i64 = sqlx::query("SELECT COUNT(*)::bigint AS n FROM payment_ledger_entry")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"))
        .try_get("n")
        .unwrap_or_else(|error| panic!("column: {error}"));
    assert_eq!(entries, 0, "a bank transfer opens nothing");

    let integrity = cloud::payment_ledger_integrity(&pool, Some(september(30)), None)
        .await
        .unwrap_or_else(|error| panic!("integrity: {error}"));
    assert!(integrity.rows.is_empty());
    assert!(integrity.agrees);

    // And the money did move, which is what makes the assertion above mean
    // something rather than testing that nothing happened at all.
    let bank = cloud::account_balance(&pool, "101100300100", Some(SITE), Some(september(30)))
        .await
        .unwrap_or_else(|error| panic!("balance: {error}"));
    assert_eq!(bank.balance_minor, 12_000_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_store_manager_holding_head_office_money_is_a_receivable(pool: PgPool) {
    books(&pool).await;

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posted = cloud::post(
        &mut tx,
        &intent(
            "TRANSFER",
            "FLOAT-1",
            3,
            vec![
                PostingLine::debit("store_manager_receivable", SITE, 5_000_000),
                PostingLine::credit("cash", SITE, 5_000_000),
            ],
        ),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post: {error}"));
    cloud::ple_open(
        &mut tx,
        &PaymentLedgerItem {
            account_key: "store_manager_receivable".into(),
            qualifier: String::new(),
            site_id: SITE.into(),
            party_type: PaymentLedgerPartyType::Employee,
            party_id: "EMP-014".into(),
            party_name: Some("Rina".into()),
            voucher_kind: "TRANSFER".into(),
            voucher_id: "FLOAT-1".into(),
            journal_entry_id: posted.entry_id,
            side: PaymentLedgerSide::Receivable,
            amount_minor: 5_000_000,
            currency: "IDR".into(),
            due_date: None,
            posting_date: september(3),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("open: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    let statement = cloud::payment_ledger_party(
        &pool,
        PaymentLedgerPartyType::Employee,
        "EMP-014",
        Some(september(30)),
        true,
    )
    .await
    .unwrap_or_else(|error| panic!("statement: {error}"));
    assert_eq!(statement.items.len(), 1);
    assert_eq!(statement.buckets.total_minor, 5_000_000);
    // No due date, so it is aged from the day it was handed over rather than
    // called "not due" forever.
    assert_eq!(statement.oldest_days, 27);

    let integrity = cloud::payment_ledger_integrity(&pool, Some(september(30)), Some(SITE))
        .await
        .unwrap_or_else(|error| panic!("integrity: {error}"));
    assert!(integrity.agrees, "{:?}", integrity.rows);
    assert_eq!(
        integrity.rows[0].account_name.as_deref(),
        Some("PIUTANG KEPALA TOKO HO")
    );
}

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

/// No RBAC rule of its own, and this is the assertion that says so on purpose.
///
/// The whole `/api/v1/finance` prefix is already SUPERVISOR to read; a second
/// rule beside the central one would be two policies agreeing until somebody
/// edited one. What a till operator has no business seeing is what the company
/// owes, which is exactly this.
#[test]
fn reading_the_payment_ledger_takes_a_supervisor() {
    for path in [
        "/api/v1/finance/payment-ledger",
        "/api/v1/finance/payment-ledger/aging",
        "/api/v1/finance/payment-ledger/integrity",
        "/api/v1/finance/payment-ledger/SUPPLIER/SUP01",
    ] {
        assert_eq!(required_role("GET", path), Role::Supervisor, "{path}");
    }
}

/// The key names the client's own account, and not the one beside it.
#[test]
fn the_store_manager_key_points_at_piutang_kepala_toko() {
    let keys = cloud::required_semantic_keys();
    let key = keys
        .iter()
        .find(|doc| doc.key == "store_manager_receivable")
        .unwrap_or_else(|| panic!("store_manager_receivable is not a required key"));
    assert_eq!(key.expects, "1011102002 PIUTANG KEPALA TOKO");
    // 1011102001 PIUTANG PEGAWAI is what an employee personally owes and is a
    // different debt. Pointing this key there would put a manager's float in
    // with the staff loans, where nobody would ever look for it.
    assert!(!key.expects.contains("1011102001"));
    assert!(
        !key.qualified,
        "the location is the narrowing, not a qualifier"
    );
}
