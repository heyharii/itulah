//! The rest of the payables loop, proved against a real Postgres.
//!
//! One property ties every test here together, and it is the reason the suspend
//! account is worth having at all: **every account this lane opens is emptied
//! again by the next document**. A delivery credits `supplier_suspend`; the bill
//! that answers it debits the same account to nothing. An advance debits
//! `advance_purchase`; the bill it is set against credits it back. A balance
//! left on either at a month end is a real exposure and not an artefact, which
//! is only true if the two halves agree — so the tests check the account, not
//! just the return value.
//!
//! The refusals are checked as hard as the successes. Half of what this lane
//! adds is a refusal: a delivery valued twice, a supplier billing for goods
//! that never arrived, a price outside tolerance that nobody has accepted.
//! Each of those is money, and a test that only proved the happy path would
//! prove the part that was never in doubt.

use chrono::NaiveDate;
use inventory_backend::cloud::application::AppError;
use inventory_backend::cloud::postgres::{self as cloud};
use sqlx::PgPool;
use uuid::Uuid;

const ACTOR: &str = "ana";
const CHECKER: &str = "budi";
const SUPPLIER: &str = "SUP01";

/// What the browser will actually be told.
///
/// `AppError::Database` renders as a flat "database operation failed" on
/// purpose. But `into_response` makes one exception: SQLSTATE P0001 is a
/// trigger's `RAISE EXCEPTION`, which is a business rule rather than a server
/// fault, so its message goes through verbatim as a 409. Most of this lane's
/// refusals are triggers — the invariants are in the database because
/// application validation is where a rule lives until somebody opens psql —
/// so asserting on `to_string()` would test the wrong surface.
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

// ---------------------------------------------------------------------------
// A chart shaped like the client's, cut down to what this lane touches
// ---------------------------------------------------------------------------

/// The ladder matters and not only the leaves: the client's codes ARE the tree
/// and a balance rolls up by prefix, so a seed of leaves hanging off the roots
/// would pass tests a real chart fails.
async fn seed_chart(pool: &PgPool) {
    let headings: [(&str, &str, Option<&str>); 21] = [
        ("1", "ASSET", None),
        ("101", "CURRENT ASSET", Some("1")),
        ("10112", "INVENTORY", Some("101")),
        ("1011201", "Persediaan Barang Dagang", Some("10112")),
        ("10113", "PREPAID", Some("101")),
        ("1011302", "PAJAK BAYAR DIMUKA", Some("10113")),
        ("1011303", "UANG MUKA / ADVANCED", Some("10113")),
        ("10110", "KAS & SETARA KAS", Some("101")),
        ("1011003", "CASH IN BANK TABUNGAN", Some("10110")),
        ("2", "LIABILITIES", None),
        ("201", "HUTANG JANGKA PENDEK", Some("2")),
        ("20120", "HUTANG DAGANG", Some("201")),
        ("2012001", "HUTANG SUPPLIER", Some("20120")),
        ("20121", "HUTANG PAJAK", Some("201")),
        ("2012101", "HUTANG PAJAK", Some("20121")),
        ("6", "BIAYA OPERASIONAL", None),
        ("601", "BIAYA UMUM DAN ADMINISTRASI", Some("6")),
        ("60103", "BIAYA ADMINISTRASI DAN UMUM", Some("601")),
        ("6010310", "BIAYA ADMINISTRASI DAN UMUM", Some("60103")),
        ("8", "BEBAN NON OPERASIONAL", None),
        ("801", "PENDAPATAN DAN (BIAYA) LAIN - LAIN", Some("8")),
    ];
    for (code, name, parent) in headings {
        insert_account(pool, code, name, parent, None).await;
    }
    insert_account(
        pool,
        "80101",
        "PENDAPATAN DAN (BIAYA) LAIN - LAIN",
        Some("801"),
        None,
    )
    .await;
    insert_account(
        pool,
        "8010110",
        "Pendapatan (Biaya) Lain-lain",
        Some("80101"),
        None,
    )
    .await;

    // The postable leaves, at head office. Every code is the client's own,
    // read out of `Laporan_Master_Account1.csv`, with their `00` HO suffix.
    for (code, name, parent) in [
        ("101120100100", "Persediaan Barang Dagangan HO", "1011201"),
        ("101130200400", "Prepaid - VAT (PPN Masukan) HO", "1011302"),
        ("101130300200", "Advanced - Purchase HO", "1011303"),
        ("101100300100", "Cash In Bank Tabungan BCA HO", "1011003"),
        (
            "201200100100",
            "Hutang Suppliers Barang Dagangan HO",
            "2012001",
        ),
        (
            "201200100200",
            "Hutang Supplier Barang Dagang - Suspend HO",
            "2012001",
        ),
        ("201210100200", "PPH Pasal 23 (withold) HO", "2012101"),
        ("601031000400", "Biaya Bank HO", "6010310"),
        ("801011000300", "Potongan Pembelian HO", "8010110"),
    ] {
        insert_account(pool, code, name, Some(parent), Some("dc")).await;
    }
}

async fn insert_account(
    pool: &PgPool,
    code: &str,
    name: &str,
    parent: Option<&str>,
    site: Option<&str>,
) {
    sqlx::query(
        "INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
         VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(code)
    .bind(name)
    .bind(parent)
    .bind(code.len() < 12)
    .bind(site)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("{code}: {error}"));
}

async fn map(pool: &PgPool, key: &str, code: &str) {
    map_qualified(pool, key, "", code).await;
}

async fn map_qualified(pool: &PgPool, key: &str, qualifier: &str, code: &str) {
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
    .unwrap_or_else(|error| panic!("map {key}: {error}"));
}

/// Everything this lane can post, mapped.
async fn seed_books(pool: &PgPool) {
    seed_chart(pool).await;
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
    map(pool, "inventory", "101120100100").await;
    map(pool, "trade_payable", "201200100100").await;
    map(pool, "supplier_suspend", "201200100200").await;
    map(pool, "vat_in", "101130200400").await;
    map(pool, "purchase_discount", "801011000300").await;
    map(pool, "purchase_price_variance", "801011000300").await;
    map(pool, "advance_purchase", "101130300200").await;
    map(pool, "pph23_payable", "201210100200").await;
    map(pool, "bank_admin_fee", "601031000400").await;
    map_qualified(pool, "bank_savings", "BCA", "101100300100").await;
}

// ---------------------------------------------------------------------------
// An order and a delivery against it
// ---------------------------------------------------------------------------

/// The DC that a delivery arrives at. `goods_receipt.origin_id` points at a
/// sync credential, because a receipt is a fact a node reported.
async fn seed_origin(pool: &PgPool) {
    sqlx::query(
        "INSERT INTO sync_origin_credential
             (origin_id, ingest_key_sha256, node_role, site_id, label)
         VALUES ('dc-edge-01', 'x', 'DC', 'dc', 'DC')
         ON CONFLICT (origin_id) DO NOTHING",
    )
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("origin: {error}"));
}

/// An issued order for `quantity` pieces at `unit_price`, and the id of its
/// only line.
async fn order(pool: &PgPool, number: &str, quantity: i64, unit_price: i64) -> (Uuid, Uuid) {
    let purchase_order_id = Uuid::new_v4();
    let po_line_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO purchase_order
           (purchase_order_id, po_number, supplier_id, supplier_name, destination_site_id,
            origin_kind, order_status, currency, created_by, issued_at)
         VALUES ($1,$2,$3,'PT Sinar Jaya','dc','DIRECT','ISSUED','IDR',$4, now())",
    )
    .bind(purchase_order_id)
    .bind(number)
    .bind(SUPPLIER)
    .bind(ACTOR)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("order: {error}"));
    sqlx::query(
        "INSERT INTO purchase_order_line
           (po_line_id, purchase_order_id, line_number, article_code, article_name,
            ordered_quantity, unit_price_minor, line_amount_minor)
         VALUES ($1,$2,1,'ART-001','Kemeja Pria',$3,$4,$5)",
    )
    .bind(po_line_id)
    .bind(purchase_order_id)
    .bind(quantity)
    .bind(unit_price)
    .bind(quantity * unit_price)
    .execute(pool)
    .await
    .map(|_| ())
    .unwrap_or_else(|error| panic!("order line: {error}"));
    (purchase_order_id, po_line_id)
}

/// A closed delivery of `accepted` pieces against `po_line_id`, and the id of
/// its only line.
///
/// `counted_by` and `verified_by` are different people because the schema
/// insists: goods one person both counted and approved are phantom stock
/// nobody would ever see as wrong.
async fn delivery(pool: &PgPool, number: &str, po_line_id: Uuid, accepted: i64) -> (Uuid, Uuid) {
    let receipt_id = Uuid::new_v4();
    let receipt_line_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO goods_receipt
           (receipt_id, receipt_number, origin_id, site_id, supplier_id, arrived_at,
            status, opened_by, opened_at, closed_by, closed_at, generation, seq)
         VALUES ($1,$2,'dc-edge-01','dc',$3,$4,'CLOSED',$5,$4,$6,$4,1,1)",
    )
    .bind(receipt_id)
    .bind(number)
    .bind(SUPPLIER)
    .bind(september(3).and_hms_opt(9, 0, 0).map(|t| t.and_utc()))
    .bind(ACTOR)
    .bind(CHECKER)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("delivery: {error}"));
    sqlx::query(
        "INSERT INTO goods_receipt_line
           (receipt_line_id, receipt_id, po_line_id, quantity, counted_by, verified_by,
            counted_at, verified_at, movement_group_id, generation, seq)
         VALUES ($1,$2,$3,$4,$5,$6,now(),now(),$7,1,1)",
    )
    .bind(receipt_line_id)
    .bind(receipt_id)
    .bind(po_line_id)
    .bind(accepted)
    .bind(ACTOR)
    .bind(CHECKER)
    .bind(Uuid::new_v4())
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("delivery line: {error}"));
    (receipt_id, receipt_line_id)
}

// ---------------------------------------------------------------------------
// Reading the books back
// ---------------------------------------------------------------------------

/// What an account has moved, net of debits and credits, across every entry.
///
/// Read from `journal_line` rather than from any projection, because the point
/// of these tests is what is actually in the ledger.
async fn balance(pool: &PgPool, code: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::bigint
           FROM journal_line WHERE account_code = $1",
    )
    .bind(code)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("balance {code}: {error}"))
}

/// A merchandise bill, drafted and not posted.
async fn draft_bill(
    pool: &PgPool,
    number: &str,
    subtotal: i64,
    tax: i64,
) -> inventory_backend::cloud::postgres::SupplierBill {
    cloud::record_bill(
        pool,
        &cloud::RecordBillRequest {
            invoice_number: number.into(),
            supplier_id: SUPPLIER.into(),
            supplier_name: Some("PT Sinar Jaya".into()),
            site_id: "dc".into(),
            invoice_date: september(5),
            due_date: Some(september(30)),
            subtotal_minor: subtotal,
            tax_minor: tax,
            discount_minor: 0,
            note: None,
            kind: None,
            lines: None,
            matching: None,
            withholding_code: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("record {number}: {error}"))
}

// ---------------------------------------------------------------------------
// A delivery is worth something before the invoice arrives
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_delivery_debits_inventory_and_credits_the_suspend_account(pool: PgPool) {
    seed_books(&pool).await;
    seed_origin(&pool).await;
    let (_, po_line) = order(&pool, "PO-0001", 120, 85_000).await;
    let (receipt, _) = delivery(&pool, "GRN-dc-000001", po_line, 120).await;

    // Before: the delivery is in the warehouse and nowhere in the books. This
    // is exactly the hole 0052 documented and refused to close.
    assert_eq!(balance(&pool, "101120100100").await, 0);

    let posted = cloud::receipt_post(&pool, receipt, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));

    assert_eq!(
        posted.value_minor,
        120 * 85_000,
        "accepted quantity at the ordered price"
    );
    assert_eq!(
        posted.posting_date,
        september(3),
        "a delivery posts on the day it arrived, not the day finance found it"
    );
    assert_eq!(
        balance(&pool, "101120100100").await,
        10_200_000,
        "stock that has arrived is now on the balance sheet"
    );
    assert_eq!(
        balance(&pool, "201200100200").await,
        -10_200_000,
        "and what the warehouse owes for it is a figure somebody can point at"
    );
    // The credit carries the supplier, because "who is this owed to" is the
    // first question anybody asks of a suspense balance.
    let party: Option<String> = sqlx::query_scalar(
        "SELECT supplier_id FROM journal_line
          WHERE account_code = '201200100200' AND credit_minor > 0",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("party: {error}"));
    assert_eq!(party.as_deref(), Some(SUPPLIER));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_delivery_valued_twice_is_refused_by_the_database(pool: PgPool) {
    seed_books(&pool).await;
    seed_origin(&pool).await;
    let (_, po_line) = order(&pool, "PO-0001", 120, 85_000).await;
    let (receipt, _) = delivery(&pool, "GRN-dc-000001", po_line, 120).await;

    cloud::receipt_post(&pool, receipt, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("first post: {error}"));
    let second = cloud::receipt_post(&pool, receipt, None, ACTOR).await;

    let message = match second {
        Ok(_) => panic!("valued the same delivery twice; inventory is now doubled"),
        Err(error) => as_shown_to_a_person(&error),
    };
    assert!(
        message.contains("GRN-dc-000001") && message.contains("already"),
        "the refusal should name the delivery, said: {message}"
    );
    assert_eq!(
        balance(&pool, "101120100100").await,
        10_200_000,
        "and nothing was posted the second time"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn reversing_a_valuation_empties_both_accounts_and_keeps_both_facts(pool: PgPool) {
    seed_books(&pool).await;
    seed_origin(&pool).await;
    let (_, po_line) = order(&pool, "PO-0001", 120, 85_000).await;
    let (receipt, _) = delivery(&pool, "GRN-dc-000001", po_line, 120).await;
    cloud::receipt_post(&pool, receipt, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));

    let reversed = cloud::receipt_reverse(&pool, receipt, None, "delivery cancelled", ACTOR)
        .await
        .unwrap_or_else(|error| panic!("reverse: {error}"));

    assert!(reversed.reversal_entry_id.is_some());
    assert_eq!(balance(&pool, "101120100100").await, 0);
    assert_eq!(balance(&pool, "201200100200").await, 0);
    // Two entries, not none: the delivery was valued and then un-valued, and
    // both are evidence.
    let entries: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM journal_entry WHERE source_kind = 'GOODS_RECEIPT'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(
        entries, 1,
        "the mirror is a REVERSAL, and the original stays"
    );
}

// ---------------------------------------------------------------------------
// A bill answers the delivery
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_matched_bill_clears_the_suspend_account_and_raises_the_payable(pool: PgPool) {
    seed_books(&pool).await;
    seed_origin(&pool).await;
    let (_, po_line) = order(&pool, "PO-0001", 120, 85_000).await;
    let (receipt, receipt_line) = delivery(&pool, "GRN-dc-000001", po_line, 120).await;
    cloud::receipt_post(&pool, receipt, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("value: {error}"));

    let bill = draft_bill(&pool, "INV-4471", 10_200_000, 1_122_000).await;
    let matched = cloud::bill_match(
        &pool,
        bill.invoice_id,
        &cloud::BillMatchRequest {
            receipt_ids: vec![receipt],
            lines: vec![cloud::BillMatchLine {
                receipt_line_id: receipt_line,
                description: "Kemeja Pria".into(),
                quantity: 120,
                unit_price_minor: 85_000,
                tax_minor: 1_122_000,
            }],
            accept_variance: false,
            tolerance_bp: None,
        },
        CHECKER,
    )
    .await
    .unwrap_or_else(|error| panic!("match: {error}"));

    assert_eq!(
        matched.status, "MATCHED",
        "a status nothing could reach before"
    );
    assert_eq!(matched.price_variance_minor, 0);
    assert!(matched.disagreements.is_empty());

    cloud::post_bill(&pool, bill.invoice_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));

    assert_eq!(
        balance(&pool, "201200100200").await,
        0,
        "the suspend account empties exactly as it filled"
    );
    assert_eq!(
        balance(&pool, "101120100100").await,
        10_200_000,
        "and inventory was debited once, by the delivery, not twice"
    );
    assert_eq!(balance(&pool, "201200100100").await, -11_322_000);
    assert_eq!(balance(&pool, "101130200400").await, 1_122_000, "input VAT");

    // The link is written, which is what makes the three-way report possible.
    let linked: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM supplier_invoice_receipt WHERE invoice_id = $1",
    )
    .bind(bill.invoice_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(linked, 1);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn billing_for_more_than_arrived_is_refused(pool: PgPool) {
    seed_books(&pool).await;
    seed_origin(&pool).await;
    let (_, po_line) = order(&pool, "PO-0001", 120, 85_000).await;
    let (receipt, receipt_line) = delivery(&pool, "GRN-dc-000001", po_line, 120).await;
    cloud::receipt_post(&pool, receipt, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("value: {error}"));

    let bill = draft_bill(&pool, "INV-4472", 130 * 85_000, 0).await;
    let refusal = cloud::bill_match(
        &pool,
        bill.invoice_id,
        &cloud::BillMatchRequest {
            receipt_ids: vec![receipt],
            lines: vec![cloud::BillMatchLine {
                receipt_line_id: receipt_line,
                description: "Kemeja Pria".into(),
                quantity: 130,
                unit_price_minor: 85_000,
                tax_minor: 0,
            }],
            // Accepting is offered and must not help: a price is a decision and
            // a quantity that never arrived is a fact.
            accept_variance: true,
            tolerance_bp: None,
        },
        CHECKER,
    )
    .await;

    let message = match refusal {
        Ok(_) => panic!("agreed to pay for ten shirts that are not in the building"),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains("130") && message.contains("120"),
        "the refusal should quote both counts, said: {message}"
    );
    let status: String =
        sqlx::query_scalar("SELECT status FROM supplier_invoice WHERE invoice_id = $1")
            .bind(bill.invoice_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("status: {error}"));
    assert_eq!(status, "DRAFT", "a refused match changes nothing");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_price_rise_somebody_accepts_lands_on_the_variance_account(pool: PgPool) {
    seed_books(&pool).await;
    seed_origin(&pool).await;
    let (_, po_line) = order(&pool, "PO-0001", 120, 85_000).await;
    let (receipt, receipt_line) = delivery(&pool, "GRN-dc-000001", po_line, 120).await;
    cloud::receipt_post(&pool, receipt, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("value: {error}"));

    // 93,500 against an ordered 85,000: ten per cent, well outside tolerance.
    let bill = draft_bill(&pool, "INV-4473", 120 * 93_500, 0).await;
    let request = cloud::BillMatchRequest {
        receipt_ids: vec![receipt],
        lines: vec![cloud::BillMatchLine {
            receipt_line_id: receipt_line,
            description: "Kemeja Pria".into(),
            quantity: 120,
            unit_price_minor: 93_500,
            tax_minor: 0,
        }],
        accept_variance: false,
        tolerance_bp: None,
    };

    let refused = cloud::bill_match(&pool, bill.invoice_id, &request, CHECKER).await;
    let message = match refused {
        Ok(_) => panic!("waved a ten per cent price rise through unread"),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains("accepted"),
        "the refusal should say a person may accept it, said: {message}"
    );

    let matched = cloud::bill_match(
        &pool,
        bill.invoice_id,
        &cloud::BillMatchRequest {
            accept_variance: true,
            ..request
        },
        CHECKER,
    )
    .await
    .unwrap_or_else(|error| panic!("match: {error}"));
    assert_eq!(matched.price_variance_minor, 1_020_000);

    cloud::post_bill(&pool, bill.invoice_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));

    assert_eq!(
        balance(&pool, "201200100200").await,
        0,
        "the suspend account still empties to exactly what the delivery put in it"
    );
    assert_eq!(
        balance(&pool, "801011000300").await,
        1_020_000,
        "and the difference is on its own account rather than buried in the stock"
    );
    assert_eq!(
        balance(&pool, "101120100100").await,
        10_200_000,
        "inventory carries what was ordered, not what was invoiced"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_three_way_report_shows_what_nobody_has_billed(pool: PgPool) {
    seed_books(&pool).await;
    seed_origin(&pool).await;
    let (_, po_line) = order(&pool, "PO-0001", 120, 85_000).await;
    let (receipt, _) = delivery(&pool, "GRN-dc-000001", po_line, 120).await;
    cloud::receipt_post(&pool, receipt, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("value: {error}"));

    let report = cloud::three_way_report(&pool, 50)
        .await
        .unwrap_or_else(|error| panic!("report: {error}"));

    assert_eq!(report.receipts_not_billed.len(), 1);
    assert_eq!(
        report.receipts_not_billed[0].receipt_number,
        "GRN-dc-000001"
    );
    assert_eq!(
        report.suspense_expected_minor, 10_200_000,
        "what 2012001002 should be carrying, to check the account against"
    );
    assert_eq!(
        report.suspense_expected_minor,
        -balance(&pool, "201200100200").await,
        "and the report and the ledger agree, which is the whole point of it"
    );
}

// ---------------------------------------------------------------------------
// The supplier takes it back
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_credit_note_reduces_what_is_outstanding_on_the_bill(pool: PgPool) {
    seed_books(&pool).await;
    seed_origin(&pool).await;
    let (_, po_line) = order(&pool, "PO-0001", 120, 85_000).await;
    let (receipt, receipt_line) = delivery(&pool, "GRN-dc-000001", po_line, 120).await;
    cloud::receipt_post(&pool, receipt, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("value: {error}"));
    let bill = draft_bill(&pool, "INV-4471", 10_200_000, 1_122_000).await;
    cloud::bill_match(
        &pool,
        bill.invoice_id,
        &cloud::BillMatchRequest {
            receipt_ids: vec![receipt],
            lines: vec![cloud::BillMatchLine {
                receipt_line_id: receipt_line,
                description: "Kemeja Pria".into(),
                quantity: 120,
                unit_price_minor: 85_000,
                tax_minor: 1_122_000,
            }],
            accept_variance: false,
            tolerance_bp: None,
        },
        CHECKER,
    )
    .await
    .unwrap_or_else(|error| panic!("match: {error}"));
    cloud::post_bill(&pool, bill.invoice_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));

    // Ten shirts go back: 850,000 of goods and 93,500 of VAT with them.
    let note = cloud::credit_note_create(
        &pool,
        &cloud::CreditNoteRequest {
            invoice_id: bill.invoice_id,
            credit_date: september(10),
            reason: "RETURN".into(),
            subtotal_minor: 850_000,
            tax_minor: 93_500,
            their_number: Some("CN-77".into()),
            credit_account_code: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("credit note: {error}"));

    let payable_before = balance(&pool, "201200100100").await;
    cloud::credit_note_post(&pool, note.credit_note_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post note: {error}"));

    assert_eq!(
        balance(&pool, "201200100100").await - payable_before,
        943_500,
        "the payable falls by the whole note"
    );
    assert_eq!(
        balance(&pool, "101120100100").await,
        10_200_000 - 850_000,
        "and the goods come out of inventory"
    );
    assert_eq!(
        balance(&pool, "101130200400").await,
        1_122_000 - 93_500,
        "the input VAT claim goes back with them"
    );

    // A payment may no longer answer the part of the debt the note answered.
    let over = cloud::record_payment(
        &pool,
        &cloud::RecordPaymentRequest {
            site_id: "dc".into(),
            payment_date: september(20),
            method: "TRANSFER".into(),
            account_key: "bank_savings".into(),
            account_qualifier: "BCA".into(),
            total_minor: None,
            reference: None,
            note: None,
            giro_number: None,
            giro_due_date: None,
            allocations: vec![cloud::AllocateToBill {
                invoice_id: bill.invoice_id,
                amount_minor: 11_322_000,
            }],
        },
        ACTOR,
    )
    .await;
    let message = match over {
        Ok(_) => panic!("paid for shirts that went back to the supplier"),
        Err(error) => as_shown_to_a_person(&error),
    };
    assert!(
        message.contains("credited") || message.contains("no longer owed"),
        "the refusal should explain the note, said: {message}"
    );
}

// ---------------------------------------------------------------------------
// Money before the goods
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_advance_applied_to_a_bill_reduces_what_the_payment_has_to_cover(pool: PgPool) {
    seed_books(&pool).await;
    seed_origin(&pool).await;
    let (purchase_order, po_line) = order(&pool, "PO-0001", 120, 85_000).await;
    let (receipt, receipt_line) = delivery(&pool, "GRN-dc-000001", po_line, 120).await;

    let advance = cloud::supplier_advance_issue(
        &pool,
        &cloud::SupplierAdvanceRequest {
            purchase_order_id: purchase_order,
            site_id: "dc".into(),
            advance_date: september(1),
            amount_minor: 4_000_000,
            account_key: "bank_savings".into(),
            account_qualifier: "BCA".into(),
            reference: Some("TRF-9001".into()),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("issue: {error}"));
    cloud::supplier_advance_post(&pool, advance.advance_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post advance: {error}"));

    assert_eq!(
        balance(&pool, "101130300200").await,
        4_000_000,
        "the company is owed goods, and that is an asset"
    );
    assert_eq!(balance(&pool, "101100300100").await, -4_000_000);

    // The goods arrive and the bill follows.
    cloud::receipt_post(&pool, receipt, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("value: {error}"));
    let bill = draft_bill(&pool, "INV-4471", 10_200_000, 0).await;
    cloud::bill_match(
        &pool,
        bill.invoice_id,
        &cloud::BillMatchRequest {
            receipt_ids: vec![receipt],
            lines: vec![cloud::BillMatchLine {
                receipt_line_id: receipt_line,
                description: "Kemeja Pria".into(),
                quantity: 120,
                unit_price_minor: 85_000,
                tax_minor: 0,
            }],
            accept_variance: false,
            tolerance_bp: None,
        },
        CHECKER,
    )
    .await
    .unwrap_or_else(|error| panic!("match: {error}"));
    cloud::post_bill(&pool, bill.invoice_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post bill: {error}"));

    let applied = cloud::supplier_advance_apply(
        &pool,
        advance.advance_id,
        &cloud::SupplierAdvanceApplyRequest {
            invoice_id: bill.invoice_id,
            amount_minor: 4_000_000,
            posting_date: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("apply: {error}"));

    assert_eq!(applied.outstanding_minor, 0, "the advance is spent");
    assert_eq!(
        balance(&pool, "101130300200").await,
        0,
        "and the asset is emptied by the debt it answered"
    );
    assert_eq!(
        balance(&pool, "201200100100").await,
        -(10_200_000 - 4_000_000),
        "the supplier is owed the balance and not the whole bill"
    );

    // Which is exactly what the payment may now settle, and no more.
    let too_much = cloud::record_payment(
        &pool,
        &cloud::RecordPaymentRequest {
            site_id: "dc".into(),
            payment_date: september(20),
            method: "TRANSFER".into(),
            account_key: "bank_savings".into(),
            account_qualifier: "BCA".into(),
            total_minor: None,
            reference: None,
            note: None,
            giro_number: None,
            giro_due_date: None,
            allocations: vec![cloud::AllocateToBill {
                invoice_id: bill.invoice_id,
                amount_minor: 10_200_000,
            }],
        },
        ACTOR,
    )
    .await;
    assert!(
        too_much.is_err(),
        "paying the whole bill would pay the advance a second time"
    );

    let payment = cloud::record_payment(
        &pool,
        &cloud::RecordPaymentRequest {
            site_id: "dc".into(),
            payment_date: september(20),
            method: "TRANSFER".into(),
            account_key: "bank_savings".into(),
            account_qualifier: "BCA".into(),
            total_minor: None,
            reference: None,
            note: None,
            giro_number: None,
            giro_due_date: None,
            allocations: vec![cloud::AllocateToBill {
                invoice_id: bill.invoice_id,
                amount_minor: 6_200_000,
            }],
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("record payment: {error}"));
    cloud::post_payment(&pool, payment.payment_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post payment: {error}"));

    assert_eq!(
        balance(&pool, "201200100100").await,
        0,
        "the debt is answered by an advance and a transfer, and closes"
    );
    assert_eq!(
        balance(&pool, "101100300100").await,
        -10_200_000,
        "and the bank paid the bill exactly once, across two dates"
    );
}

// ---------------------------------------------------------------------------
// Tax kept back at the bank
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn pph_is_withheld_at_payment_and_the_supplier_is_credited_in_full(pool: PgPool) {
    seed_books(&pool).await;
    // A security contract: an expense bill, and PPh 23 at two per cent.
    insert_account(&pool, "7", "BIAYA OPERASIONAL LAIN", None, None).await;
    insert_account(&pool, "701", "BIAYA JASA", Some("7"), None).await;
    insert_account(&pool, "70103", "BIAYA JASA", Some("701"), None).await;
    insert_account(&pool, "7010310", "BIAYA JASA", Some("70103"), None).await;
    insert_account(
        &pool,
        "701031000100",
        "Biaya Keamanan HO",
        Some("7010310"),
        Some("dc"),
    )
    .await;
    map(&pool, "non_merchandise_payable", "201200100100").await;

    let bill = cloud::record_bill(
        &pool,
        &cloud::RecordBillRequest {
            invoice_number: "INV-SEC-09".into(),
            supplier_id: SUPPLIER.into(),
            supplier_name: Some("PT Jaga Aman".into()),
            site_id: "dc".into(),
            invoice_date: september(1),
            due_date: Some(september(30)),
            subtotal_minor: 10_000_000,
            tax_minor: 1_100_000,
            discount_minor: 0,
            note: None,
            kind: Some("EXPENSE".into()),
            lines: Some(vec![cloud::RecordBillLine {
                account_code: "701031000100".into(),
                site_id: "dc".into(),
                amount_minor: 10_000_000,
                memo: Some("Keamanan September".into()),
            }]),
            matching: None,
            withholding_code: Some("PPH23_SERVICE".into()),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("record: {error}"));
    assert_eq!(bill.withholding_code.as_deref(), Some("PPH23_SERVICE"));

    cloud::post_bill(&pool, bill.invoice_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post bill: {error}"));

    let payment = cloud::record_payment(
        &pool,
        &cloud::RecordPaymentRequest {
            site_id: "dc".into(),
            payment_date: september(25),
            method: "TRANSFER".into(),
            account_key: "bank_savings".into(),
            account_qualifier: "BCA".into(),
            total_minor: None,
            reference: None,
            note: None,
            giro_number: None,
            giro_due_date: None,
            allocations: vec![cloud::AllocateToBill {
                invoice_id: bill.invoice_id,
                amount_minor: 11_100_000,
            }],
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("record payment: {error}"));

    let deductions = cloud::payment_withhold(
        &pool,
        payment.payment_id,
        &cloud::PaymentWithholdRequest {
            bank_charge_minor: 6_500,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("withhold: {error}"));

    assert_eq!(
        deductions.withholding_minor, 200_000,
        "two per cent of the fee, not of the fee plus VAT"
    );
    assert_eq!(deductions.withholding_key.as_deref(), Some("pph23_payable"));
    assert_eq!(
        deductions.leaving_the_bank_minor,
        11_100_000 - 200_000 + 6_500
    );

    cloud::post_payment(&pool, payment.payment_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post payment: {error}"));

    assert_eq!(
        balance(&pool, "201200100100").await,
        0,
        "the vendor is credited with the whole debt and is not left in arrears by the tax"
    );
    assert_eq!(
        balance(&pool, "201210100200").await,
        -200_000,
        "and the tax office is owed what was kept back, in the vendor's name"
    );
    assert_eq!(
        balance(&pool, "601031000400").await,
        6_500,
        "the bank's fee"
    );
    assert_eq!(
        balance(&pool, "101100300100").await,
        -(11_100_000 - 200_000 + 6_500)
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_withholding_this_system_cannot_compute_is_refused_when_the_bill_is_keyed(pool: PgPool) {
    seed_books(&pool).await;

    let refusal = cloud::record_bill(
        &pool,
        &cloud::RecordBillRequest {
            invoice_number: "INV-BUILD-01".into(),
            supplier_id: SUPPLIER.into(),
            supplier_name: None,
            site_id: "dc".into(),
            invoice_date: september(1),
            due_date: None,
            subtotal_minor: 50_000_000,
            tax_minor: 0,
            discount_minor: 0,
            note: None,
            kind: None,
            lines: None,
            matching: None,
            // Construction: the rate depends on whether the vendor holds a
            // certification, which is a fact nothing here records.
            withholding_code: Some("PPH42_CONSTRUCTION".into()),
        },
        ACTOR,
    )
    .await;

    let message = match refusal {
        Ok(_) => panic!("accepted a tax code whose rate would be a guess"),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains("PPH23_SERVICE"),
        "the refusal should list what it does know, said: {message}"
    );
}
