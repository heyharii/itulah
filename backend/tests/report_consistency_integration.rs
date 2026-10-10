//! Reports that must say what the books say.
//!
//! Found by dogfooding the demo: the payables ageing and the bill list owed a
//! supplier an advance the ledger had already set against the bill, and the
//! asset register counted a written-off asset "at book value" beside a balance
//! sheet that no longer carried it.

use chrono::NaiveDate;
use inventory_backend::cloud::postgres as cloud;
use sqlx::PgPool;
use uuid::Uuid;

const ACTOR: &str = "ana";
/// The premises these documents name — head office's Gudang.
const SITE: &str = "dc";
/// The BOOKS they belong to: head office's unit, which is what a posting, an
/// account link and a journal line are keyed by since 0605/0606.
const UNIT: &str = "ho";

fn day(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).unwrap_or_else(|| panic!("bad date"))
}

async fn map(pool: &PgPool, key: &str, code: &str) {
    cloud::set_account_link(
        pool,
        &cloud::SetAccountLinkRequest {
            role: key.into(),
            source_type: "COMPANY".into(),
            source_id: String::new(),
            scope_type: "UNIT".into(),
            scope_key: UNIT.into(),
            account_code: code.into(),
            category_code: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("map {key}: {error}"));
}

/// A supplier, an order to pay an advance against, and a posted expense bill.
/// Returns the supplier id as the bill carries it, the order and the bill.
async fn a_supplier_with_an_order_and_a_bill(pool: &PgPool, total: i64) -> (String, Uuid, Uuid) {
    map(pool, "non_merchandise_payable", "2004").await;
    map(pool, "advance_purchase", "1052").await;
    map(pool, "cash", "1002").await;
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));

    let id = Uuid::new_v4();
    let suffix = &id.simple().to_string()[..8];
    sqlx::query(
        "INSERT INTO supplier (supplier_id, supplier_code, supplier_code_normalized, name,
                               category, expense_account_code, created_by, updated_by)
         VALUES ($1,$2,$3,'PT Uang Muka','EXPENSE','6045',$4,$4)",
    )
    .bind(id)
    .bind(format!("SUP-RC-{suffix}"))
    .bind(format!("sup-rc-{suffix}"))
    .bind(ACTOR)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("supplier: {error}"));
    let supplier = id.to_string();

    let order = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO purchase_order
           (purchase_order_id, po_number, supplier_id, supplier_ref_id, destination_site_id,
            origin_kind, order_status, issued_at, currency, created_by)
         VALUES ($1,'PO-RC-1',$2,$3,$4,'DIRECT','ISSUED',now(),'IDR',$5)",
    )
    .bind(order)
    .bind(&supplier)
    .bind(id)
    .bind(SITE)
    .bind(ACTOR)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("order: {error}"));

    let line = cloud::RecordBillLine {
        account_code: "6045".into(),
        site_id: SITE.into(),
        amount_minor: total,
        category_code: None,
        asset_class_code: None,
        draws_reserve: false,
        asset_id: None,
        contract_id: None,
        repair_id: None,
        replacement_id: None,
        supply_request_id: None,
        service_period_start: None,
        service_period_end: None,
        account_overridden: false,
        memo: None,
    };
    let draft = cloud::record_bill_draft(
        pool,
        &cloud::RecordBillRequest {
            invoice_number: "INV-RC-1".into(),
            supplier_id: supplier.clone(),
            supplier_name: Some("PT Uang Muka".into()),
            site_id: SITE.into(),
            invoice_date: day(2026, 9, 10),
            due_date: Some(day(2026, 10, 30)),
            subtotal_minor: total,
            tax_minor: 0,
            discount_minor: 0,
            note: None,
            kind: Some("EXPENSE".into()),
            lines: Some(vec![line]),
            receipt_ids: None,
            matching: None,
            withholding_code: None,
            submitted_by_domain: None,
            document_ref: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("bill: {error}"));
    cloud::post_bill(pool, draft.invoice_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post bill: {error}"));
    (supplier, order, draft.invoice_id)
}

/// SUP-002 in the demo: a Rp 3.480.000 bill with a Rp 500.000 advance set
/// against it. The ledger and the payment ledger owe Rp 2.980.000; the ageing
/// and the bill list must too, and the ageing's own "per the books" figure
/// must be the ledger's and not a code the chart does not have.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_applied_advance_is_paid_on_the_bill_in_the_ageing_and_the_bill_list(pool: PgPool) {
    let (_, order, invoice) = a_supplier_with_an_order_and_a_bill(&pool, 3_480_000).await;

    let advance = cloud::supplier_advance_issue(
        &pool,
        &cloud::SupplierAdvanceRequest {
            purchase_order_id: order,
            unit_id: UNIT.into(),
            advance_date: day(2026, 9, 5),
            amount_minor: 500_000,
            account_key: "cash".into(),
            account_qualifier: String::new(),
            reference: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("advance: {error}"));
    cloud::supplier_advance_post(&pool, advance.advance_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post advance: {error}"));
    cloud::supplier_advance_apply(
        &pool,
        advance.advance_id,
        &cloud::SupplierAdvanceApplyRequest {
            invoice_id: invoice,
            amount_minor: 500_000,
            posting_date: Some(day(2026, 9, 12)),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("apply: {error}"));

    // The bill list and the bill: 0391.
    let bill = cloud::bill(&pool, invoice)
        .await
        .unwrap_or_else(|error| panic!("bill: {error}"));
    assert_eq!(bill.paid_minor, 500_000, "the advance is paid on the bill");
    assert_eq!(bill.outstanding_minor, 2_980_000);
    assert_eq!(bill.payment_state, "PARTIALLY_PAID");

    // The ageing, and the ledger beside it.
    let aging = cloud::payables_aging(&pool, day(2026, 9, 24), None)
        .await
        .unwrap_or_else(|error| panic!("aging: {error}"));
    assert_eq!(
        aging.total.total_minor, 2_980_000,
        "the ageing owes what the ledger owes"
    );
    assert_eq!(
        aging.books_minor, 2_980_000,
        "the books figure is the payable accounts"
    );

    // Wound back: before the advance was set against it, all of it was owed.
    let before = cloud::payables_aging(&pool, day(2026, 9, 11), None)
        .await
        .unwrap_or_else(|error| panic!("aging before: {error}"));
    assert_eq!(before.total.total_minor, 3_480_000);
    assert_eq!(before.books_minor, 3_480_000);
}

/// AST-000003 in the demo: a written-off laptop. The disposal entry took it
/// out of the books, so the register carries it at nothing.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_disposed_asset_has_no_book_value(pool: PgPool) {
    // The month the disposal entry is dated in has to be open before anything
    // can be posted to it (`assert_period_open`, 0283) — this test writes its
    // entry by hand rather than through `a_supplier_with_an_order_and_a_bill`,
    // which is where the other test opens September.
    cloud::open_period(&pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
    let asset = cloud::register_asset(
        &pool,
        &cloud::RegisterAssetRequest {
            asset_number: "AST-RC-1".into(),
            name: "Laptop kasir".into(),
            category_code: "FFE_KOMPUTER".into(),
            site_id: SITE.into(),
            acquired_on: day(2026, 1, 5),
            serial_number: None,
            notes: None,
            quantity: None,
            acquired_via_line_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("register: {error}"));
    let assessed = cloud::assess_asset(
        &pool,
        asset.asset_id,
        &cloud::AssessAssetRequest {
            decision: "CAPITALIZE".into(),
            capitalized_cost_minor: Some(7_050_000),
            salvage_value_minor: Some(0),
            useful_life_months: Some(48),
            category_code: None,
            rate_bps: None,
            method: Some("STRAIGHT_LINE".into()),
            charge_kind: Some("DEPRECIATION".into()),
            in_service_on: Some(day(2026, 1, 5)),
            opening_accumulated_minor: None,
            opening_through: None,
            reason: "a laptop lasts four years".into(),
            acquired_via_line_id: None,
            acquired_via_line_ids: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("assess: {error}"));
    assert_eq!(
        assessed.book_value_minor,
        Some(7_050_000),
        "in service, cost less nothing"
    );

    // The disposal as `dispose_asset` leaves it, with an entry to point at.
    let entry = Uuid::new_v4();
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("tx: {error}"));
    sqlx::query(
        "INSERT INTO journal_entry
             (entry_id, entry_number, posting_date, source_kind, rule_version, total_minor,
              currency, posted_by)
         VALUES ($1, 'JV-RC-DISPOSAL', '2026-09-25', 'MANUAL', 'report-consistency-test', 1,
                 'IDR', $2)",
    )
    .bind(entry)
    .bind(ACTOR)
    .execute(&mut *tx)
    .await
    .unwrap_or_else(|error| panic!("entry: {error}"));
    for (number, debit, credit) in [(1, 1, 0), (2, 0, 1)] {
        sqlx::query(
            "INSERT INTO journal_line
                 (line_id, entry_id, line_number, account_code, unit_id, debit_minor, credit_minor)
             VALUES ($1, $2, $3, '1002', 'ho', $4, $5)",
        )
        .bind(Uuid::new_v4())
        .bind(entry)
        .bind(number)
        .bind(debit)
        .bind(credit)
        .execute(&mut *tx)
        .await
        .unwrap_or_else(|error| panic!("line: {error}"));
    }
    sqlx::query(
        "UPDATE fixed_asset
            SET status = 'DISPOSED', disposed_on = '2026-09-25', disposal_method = 'WRITTEN_OFF',
                disposal_proceeds_minor = 0, disposal_journal_entry_id = $2
          WHERE asset_id = $1",
    )
    .bind(asset.asset_id)
    .bind(entry)
    .execute(&mut *tx)
    .await
    .unwrap_or_else(|error| panic!("dispose: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    let gone = cloud::asset(&pool, asset.asset_id)
        .await
        .unwrap_or_else(|error| panic!("asset: {error}"));
    assert_eq!(
        gone.capitalized_cost_minor,
        Some(7_050_000),
        "what it cost is still history"
    );
    assert_eq!(
        gone.book_value_minor,
        Some(0),
        "a disposed asset is off the books"
    );
}
