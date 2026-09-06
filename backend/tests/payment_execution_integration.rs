//! Destinations, batches and the payment context, against a real Postgres.
//!
//! # What is proved here and what cannot be
//!
//! Everything about a destination, a snapshot, a batch's orchestration and the
//! payment context runs against a real database and is asserted on.
//!
//! What cannot run in this branch is the last step of execution, and the reason
//! is worth stating rather than hiding behind a green tick: the money-execution
//! layer is `cash_document` (migration 0115) and it lands in a sibling lane. So
//! the tests that need a posted PAY check for the table first and say plainly
//! that they were skipped. They are written for the tree the lanes make
//! together, not for this one, and they will run the day the two meet without
//! being touched.
//!
//! A skipped assertion that says so is worth more than an assertion quietly
//! rewritten to something that passes.

use chrono::NaiveDate;
use inventory_backend::cloud::application::AppError;
use inventory_backend::cloud::domain::{
    payment_account_mask, payment_pattern_for, PaymentDirection, PaymentPattern, PaymentSourceShape,
};
use inventory_backend::cloud::postgres::{
    self as cloud, CreatePaymentBatchRequest, CreatePaymentDestinationRequest,
    ExecutePaymentBatchItemRequest, PaymentBatchItemInput, VerifyPaymentDestinationRequest,
};
use sqlx::PgPool;
use uuid::Uuid;

const ACTOR: &str = "ana";
const KEY: &str = "a key only this test uses";

/// The encryption key, set for every test in this binary.
///
/// Every test sets the same value, so any interleaving leaves the same string
/// in place. There is no development default in the module itself, deliberately
/// — see `postgres::destinations` — so a test that did not do this would find
/// the refusal rather than the behaviour.
fn use_a_test_key() {
    std::env::set_var("PAYMENT_DESTINATION_KEY", KEY);
}

/// Whether the money-execution layer is in this build.
async fn money_layer(pool: &PgPool) -> bool {
    let found: Option<String> =
        sqlx::query_scalar("SELECT to_regclass('public.cash_document')::text")
            .fetch_one(pool)
            .await
            .unwrap_or(None);
    found.is_some()
}

fn skipped(what: &str) {
    println!(
        "SKIPPED: {what} — this branch has no cash_document (migration 0115), which is the \
         money-execution layer and lands in a sibling lane"
    );
}

fn september(day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, day).unwrap_or_else(|| panic!("bad date"))
}

// ---------------------------------------------------------------------------
// A chart shaped like the client's, and the meanings a payment needs
// ---------------------------------------------------------------------------

async fn seed_chart(pool: &PgPool) {
    let accounts: [(&str, &str, Option<&str>, Option<&str>); 14] = [
        ("1", "ASSET", None, None),
        ("101", "CURRENT ASSET", Some("1"), None),
        ("10110", "CASH AND BANK", Some("101"), None),
        ("1011001", "CASH ON HAND", Some("10110"), None),
        ("10112", "INVENTORY", Some("101"), None),
        ("1011201", "Persediaan Barang Dagang", Some("10112"), None),
        ("2", "LIABILITIES", None, None),
        ("201", "HUTANG JANGKA PENDEK", Some("2"), None),
        ("20120", "HUTANG DAGANG", Some("201"), None),
        ("2012001", "HUTANG SUPPLIER", Some("20120"), None),
        ("6", "BIAYA OPERASIONAL", None, None),
        ("601", "BIAYA UMUM", Some("6"), None),
        ("60101", "BIAYA UMUM", Some("601"), None),
        ("6010110", "Biaya Lain-lain", Some("60101"), None),
    ];
    for (code, name, parent, site) in accounts {
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
             VALUES ($1,$2,$3,true,$4)",
        )
        .bind(code)
        .bind(name)
        .bind(parent)
        .bind(site)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{code}: {error}"));
    }
    for (code, name, parent) in [
        ("101100100100", "Cash On Hand HO", "1011001"),
        ("101120100100", "Persediaan Barang Dagangan HO", "1011201"),
        (
            "201200100100",
            "Hutang Suppliers Barang Dagangan HO",
            "2012001",
        ),
        ("601011000100", "Biaya Lain-lain HO", "6010110"),
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

    for (key, code) in [
        ("cash", "101100100100"),
        ("inventory", "101120100100"),
        ("trade_payable", "201200100100"),
    ] {
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
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
}

fn a_destination(party_id: &str, number: &str) -> CreatePaymentDestinationRequest {
    CreatePaymentDestinationRequest {
        party_type: "SUPPLIER".into(),
        party_id: party_id.into(),
        party_name: format!("PT {party_id}"),
        bank_name: "BCA".into(),
        bank_code: Some("014".into()),
        account_number: number.into(),
        account_holder: format!("PT {party_id}"),
        owner_domain: None,
    }
}

async fn a_verified_destination(pool: &PgPool, party_id: &str, number: &str) -> Uuid {
    let created = cloud::payment_destination_create(pool, &a_destination(party_id, number), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("create destination: {error}"));
    cloud::payment_destination_verify(
        pool,
        created.destination_id,
        &VerifyPaymentDestinationRequest {
            verified: true,
            note: "one-rupiah test transfer, name matched".into(),
        },
        "budi",
    )
    .await
    .unwrap_or_else(|error| panic!("verify destination: {error}"));
    created.destination_id
}

/// A posted merchandise bill, so there is something real to pay.
async fn a_posted_bill(pool: &PgPool, supplier: &str, number: &str, amount: i64) -> Uuid {
    let bill = cloud::record_bill(
        pool,
        &cloud::RecordBillRequest {
            invoice_number: number.into(),
            supplier_id: supplier.into(),
            supplier_name: Some(format!("PT {supplier}")),
            site_id: "dc".into(),
            invoice_date: september(1),
            due_date: Some(september(30)),
            subtotal_minor: amount,
            tax_minor: 0,
            discount_minor: 0,
            note: None,
            kind: None,
            lines: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("record bill {number}: {error}"));
    cloud::post_bill(pool, bill.invoice_id, Some(september(1)), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post bill {number}: {error}"));
    bill.invoice_id
}

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_destination_is_created_verified_and_shown_only_as_a_mask(pool: PgPool) {
    use_a_test_key();
    let created =
        cloud::payment_destination_create(&pool, &a_destination("SUP01", "8290123456"), ACTOR)
            .await
            .unwrap_or_else(|error| panic!("create: {error}"));

    assert_eq!(created.account_number_mask, "••••••3456");
    assert_eq!(created.verification_status, "UNVERIFIED");
    assert!(created.finance_may_edit);

    // The number is not on the row a screen reads, and the row that holds it
    // holds ciphertext.
    let stored: Vec<u8> = sqlx::query_scalar(
        "SELECT account_number_enc FROM payment_destination WHERE destination_id = $1",
    )
    .bind(created.destination_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("read ciphertext: {error}"));
    let as_text = String::from_utf8_lossy(&stored);
    assert!(
        !as_text.contains("8290123456"),
        "the account number is stored in the clear"
    );

    let verified = cloud::payment_destination_verify(
        &pool,
        created.destination_id,
        &VerifyPaymentDestinationRequest {
            verified: true,
            note: "bank confirmation letter, 3 September".into(),
        },
        "budi",
    )
    .await
    .unwrap_or_else(|error| panic!("verify: {error}"));
    assert_eq!(verified.verification_status, "VERIFIED");
    assert_eq!(verified.verified_by.as_deref(), Some("budi"));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_recipient_account_is_never_one_of_our_own(pool: PgPool) {
    use_a_test_key();
    seed_chart(&pool).await;

    // The company's own cash account, keyed into the account-number box.
    let refused =
        cloud::payment_destination_create(&pool, &a_destination("SUP01", "101100100100"), ACTOR)
            .await;
    let message = match refused {
        Err(AppError::Database(sqlx::Error::Database(db))) => db.message().to_string(),
        Err(other) => other.to_string(),
        Ok(_) => panic!("one of our own ledger accounts was accepted as a bank account"),
    };
    assert!(
        message.contains("101100100100") && message.contains("our own ledger accounts"),
        "the refusal did not say which account it was: {message}"
    );

    // And the separation is structural as well: there is no column on this
    // table that could hold a chart-of-accounts code or a semantic key, so a
    // destination cannot be posted to even by somebody trying.
    let columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name::text FROM information_schema.columns
          WHERE table_name = 'payment_destination'",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("read columns: {error}"));
    for forbidden in ["account_code", "semantic_key", "site_id", "ledger_account"] {
        assert!(
            !columns.iter().any(|c| c == forbidden),
            "payment_destination has a `{forbidden}` column, which is how a recipient's bank \
             account becomes one of ours"
        );
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn finance_reads_an_employee_account_and_does_not_write_it(pool: PgPool) {
    use_a_test_key();
    let refused = cloud::payment_destination_create(
        &pool,
        &CreatePaymentDestinationRequest {
            party_type: "EMPLOYEE".into(),
            party_id: "emp-1".into(),
            party_name: "Sari".into(),
            bank_name: "Mandiri".into(),
            bank_code: None,
            account_number: "1370099887766".into(),
            account_holder: "SARI".into(),
            owner_domain: None,
        },
        ACTOR,
    )
    .await;
    match refused {
        Err(AppError::Forbidden(message)) => assert!(
            message.contains("HR"),
            "the refusal did not name HR: {message}"
        ),
        other => panic!("Finance was allowed to write an employee's bank account: {other:?}"),
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn editing_a_destination_does_not_rewrite_what_was_already_paid(pool: PgPool) {
    use_a_test_key();
    let destination = a_verified_destination(&pool, "SUP01", "8290123456").await;

    // A payment executed against it — the snapshot is taken inside the
    // transaction that moves the money, so this is what that step writes.
    let mut tx = pool.begin().await.unwrap_or_else(|e| panic!("begin: {e}"));
    sqlx::query(
        "INSERT INTO payment_destination_snapshot
           (snapshot_id, payment_kind, payment_id, destination_id, bank_name, bank_code,
            account_number_mask, account_holder, verification_status, verified_by, verified_at,
            party_type, party_id, party_name, taken_by)
         SELECT gen_random_uuid(), 'SUPPLIER_PAYMENT', 'pay-1', d.destination_id,
                d.bank_name, d.bank_code, d.account_number_mask, d.account_holder,
                d.verification_status, d.verified_by, d.verified_at,
                d.party_type, d.party_id, d.party_name, $2
           FROM payment_destination d WHERE d.destination_id = $1",
    )
    .bind(destination)
    .bind(ACTOR)
    .execute(&mut *tx)
    .await
    .unwrap_or_else(|e| panic!("snapshot: {e}"));
    tx.commit().await.unwrap_or_else(|e| panic!("commit: {e}"));

    // Next month the supplier changes bank. One row, one screen.
    sqlx::query(
        "UPDATE payment_destination
            SET bank_name = 'Mandiri', account_number_mask = '•••••••1122',
                account_holder = 'PT SUP01 (NEW)', verification_status = 'UNVERIFIED',
                verified_by = NULL, verified_at = NULL, updated_by = 'ana', updated_at = now()
          WHERE destination_id = $1",
    )
    .bind(destination)
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("change bank: {e}"));

    let paid_to = cloud::payment_destination_snapshot_for(&pool, "SUPPLIER_PAYMENT", "pay-1")
        .await
        .unwrap_or_else(|e| panic!("read snapshot: {e}"))
        .unwrap_or_else(|| panic!("the record of what was paid to is gone"));

    assert_eq!(paid_to.bank_name, "BCA");
    assert_eq!(paid_to.account_number_mask, "••••••3456");
    assert_eq!(paid_to.account_holder, "PT SUP01");
    // The field people forget. "Was this verified when we paid it" cannot be
    // answered by the live row, which now says UNVERIFIED.
    assert_eq!(paid_to.verification_status, "VERIFIED");

    // And it cannot be edited into agreement with the new account.
    let edit = sqlx::query(
        "UPDATE payment_destination_snapshot SET bank_name = 'Mandiri' WHERE payment_id = 'pay-1'",
    )
    .execute(&pool)
    .await;
    assert!(
        edit.is_err(),
        "the record of what a payment was paid to could be edited"
    );
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

fn a_batch(items: Vec<PaymentBatchItemInput>, policy: &str) -> CreatePaymentBatchRequest {
    CreatePaymentBatchRequest {
        source_kind: "SUPPLIER_BILLS".into(),
        source_id: None,
        from_key: "cash".into(),
        from_qualifier: String::new(),
        site_id: "dc".into(),
        counter_key: Some("trade_payable".into()),
        counter_qualifier: String::new(),
        counter_account_code: None,
        method: "BANK_TRANSFER".into(),
        doc_date: september(15),
        unverified_policy: policy.into(),
        unverified_policy_reason: "a supplier run should not wait on one supplier".into(),
        memo: "September supplier run".into(),
        items,
    }
}

async fn twenty_recipients(pool: &PgPool) -> Vec<PaymentBatchItemInput> {
    let mut items = Vec::new();
    for index in 1..=20u32 {
        let party = format!("SUP{index:02}");
        let destination = a_verified_destination(pool, &party, &format!("82901{index:05}")).await;
        items.push(PaymentBatchItemInput {
            party_type: "SUPPLIER".into(),
            party_id: party.clone(),
            party_name: format!("PT {party}"),
            destination_id: Some(destination),
            amount_minor: i64::from(index) * 1_000_00,
            obligation_kind: None,
            obligation_id: None,
            obligation_reference: Some(format!("INV-{index:02}")),
        });
    }
    items
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_batch_of_twenty_produces_twenty_ordinary_payments(pool: PgPool) {
    use_a_test_key();
    seed_chart(&pool).await;
    let items = twenty_recipients(&pool).await;
    let expected_total: i64 = items.iter().map(|i| i.amount_minor).sum();

    let created = cloud::payment_batch_create(&pool, &a_batch(items, "SKIP"), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("create batch: {error}"));

    // Orchestration, before anything is executed. The total is restated by the
    // database from the items, so it cannot drift from them.
    assert_eq!(created.batch.item_count, 20);
    assert_eq!(created.batch.total_minor, expected_total);
    assert_eq!(created.batch.status, "READY");
    assert_eq!(created.items.len(), 20);
    assert!(created.items.iter().all(|i| i.status == "PENDING"));
    // The choice of policy is recorded with its reason, on the batch and in the
    // log, before anybody has run anything.
    assert_eq!(created.batch.unverified_policy, "SKIP");
    assert!(created
        .events
        .iter()
        .any(|e| e.kind == "AUTHORISED" && e.policy_in_force.as_deref() == Some("SKIP")));

    if !money_layer(&pool).await {
        skipped("a batch of twenty produces twenty ordinary PAY documents");
        // What can still be proved here: the batch itself posts nothing. No
        // journal entry names it, and none ever will, because there is no
        // posting rule that takes a batch.
        let entries: i64 =
            sqlx::query_scalar("SELECT COUNT(*)::bigint FROM journal_entry WHERE source_id = $1")
                .bind(created.batch.batch_id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap_or_else(|e| panic!("count entries: {e}"));
        assert_eq!(entries, 0, "a batch posted a journal entry of its own");
        return;
    }

    let outcome = cloud::payment_batch_execute_remaining(&pool, created.batch.batch_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("execute: {error}"));
    assert_eq!(outcome.executed, 20);
    assert_eq!(outcome.status, "EXECUTED");

    let after = cloud::payment_batch_read(&pool, created.batch.batch_id)
        .await
        .unwrap_or_else(|error| panic!("read back: {error}"));
    let documents: Vec<Uuid> = after
        .items
        .iter()
        .filter_map(|i| i.cash_document_id)
        .collect();
    assert_eq!(documents.len(), 20, "not every line produced a document");

    let ordinary: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM cash_document
          WHERE document_id = ANY($1) AND kind = 'PAY' AND status = 'POSTED'
            AND number LIKE 'KK-%'",
    )
    .bind(&documents)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("count documents: {e}"));
    assert_eq!(
        ordinary, 20,
        "the twenty payments are not twenty ordinary posted PAY documents"
    );

    // And every one of them has a frozen copy of where it went.
    assert!(after
        .items
        .iter()
        .all(|i| i.snapshot_account_mask.is_some()));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn one_unverified_destination_is_skipped_or_holds_the_run_and_it_is_recorded(pool: PgPool) {
    use_a_test_key();
    seed_chart(&pool).await;

    let good = a_verified_destination(&pool, "SUP01", "8290111111").await;
    // Created and never checked: the ordinary friction of paying people.
    let unchecked =
        cloud::payment_destination_create(&pool, &a_destination("SUP02", "8290222222"), ACTOR)
            .await
            .unwrap_or_else(|e| panic!("create: {e}"))
            .destination_id;

    let lines = |good: Uuid, unchecked: Uuid| {
        vec![
            PaymentBatchItemInput {
                party_type: "SUPPLIER".into(),
                party_id: "SUP01".into(),
                party_name: "PT SUP01".into(),
                destination_id: Some(good),
                amount_minor: 500_000_00,
                obligation_kind: None,
                obligation_id: None,
                obligation_reference: None,
            },
            PaymentBatchItemInput {
                party_type: "SUPPLIER".into(),
                party_id: "SUP02".into(),
                party_name: "PT SUP02".into(),
                destination_id: Some(unchecked),
                amount_minor: 300_000_00,
                obligation_kind: None,
                obligation_id: None,
                obligation_reference: None,
            },
        ]
    };

    // HOLD: nothing is paid, and the reason is on the batch and in the log.
    let held_batch =
        cloud::payment_batch_create(&pool, &a_batch(lines(good, unchecked), "HOLD"), ACTOR)
            .await
            .unwrap_or_else(|e| panic!("create held batch: {e}"));
    let held = cloud::payment_batch_execute_remaining(&pool, held_batch.batch.batch_id, ACTOR)
        .await
        .unwrap_or_else(|e| panic!("run held batch: {e}"));

    if !money_layer(&pool).await {
        skipped("the HOLD policy stopping a run after the first line was paid");
        // Line one cannot be paid without the money layer, so it fails rather
        // than being paid; line two is what this test is about and it is
        // reached either way. What is asserted is that the batch stopped and
        // said why, under the policy that was in force.
        let after = cloud::payment_batch_read(&pool, held_batch.batch.batch_id)
            .await
            .unwrap_or_else(|e| panic!("read: {e}"));
        assert_eq!(after.batch.status, "HELD", "{:?}", after.batch.held_reason);
        let reason = after
            .batch
            .held_reason
            .unwrap_or_else(|| panic!("held with no reason"));
        assert!(
            reason.contains("PT SUP02") && reason.contains("not been verified"),
            "the hold did not say who or why: {reason}"
        );
        assert!(after
            .events
            .iter()
            .any(|e| e.kind == "POLICY_APPLIED" && e.policy_in_force.as_deref() == Some("HOLD")));
    } else {
        assert_eq!(held.executed, 1);
        assert_eq!(held.status, "HELD");
    }

    // SKIP: the rest is paid and the passed-over row says why.
    let skip_batch =
        cloud::payment_batch_create(&pool, &a_batch(lines(good, unchecked), "SKIP"), ACTOR)
            .await
            .unwrap_or_else(|e| panic!("create skip batch: {e}"));
    cloud::payment_batch_execute_remaining(&pool, skip_batch.batch.batch_id, ACTOR)
        .await
        .unwrap_or_else(|e| panic!("run skip batch: {e}"));
    let after = cloud::payment_batch_read(&pool, skip_batch.batch.batch_id)
        .await
        .unwrap_or_else(|e| panic!("read: {e}"));

    let passed_over = after
        .items
        .iter()
        .find(|i| i.party_id == "SUP02")
        .unwrap_or_else(|| panic!("line two is missing"));
    assert_eq!(passed_over.status, "SKIPPED");
    let why = passed_over
        .skip_reason
        .as_deref()
        .unwrap_or_else(|| panic!("skipped with no reason"));
    assert!(
        why.contains("PT SUP02") && why.contains("not been verified"),
        "the skip did not say who or why: {why}"
    );
    assert!(after
        .events
        .iter()
        .any(|e| e.kind == "ITEM_SKIPPED" && e.policy_in_force.as_deref() == Some("SKIP")));
    // A skipped row is not part of the money going out, so the checksum drops.
    assert_eq!(after.batch.total_minor, 500_000_00);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_run_that_stopped_halfway_picks_up_where_it_left_off(pool: PgPool) {
    use_a_test_key();
    seed_chart(&pool).await;
    let items = twenty_recipients(&pool).await;
    let created = cloud::payment_batch_create(&pool, &a_batch(items, "SKIP"), ACTOR)
        .await
        .unwrap_or_else(|e| panic!("create: {e}"));

    if !money_layer(&pool).await {
        skipped("resuming a partially executed batch");
        // What holds without the money layer: an item that failed is recorded
        // as FAILED with the refusal on it rather than silently retried, the
        // run is not lost, and a second pass finds the same rows.
        let first = cloud::payment_batch_execute_remaining(&pool, created.batch.batch_id, ACTOR)
            .await
            .unwrap_or_else(|e| panic!("first pass: {e}"));
        assert_eq!(first.failed, 20);
        assert_eq!(first.still_pending, 0);
        let after = cloud::payment_batch_read(&pool, created.batch.batch_id)
            .await
            .unwrap_or_else(|e| panic!("read: {e}"));
        let failure = after.items[0]
            .skip_reason
            .as_deref()
            .unwrap_or_else(|| panic!("a failed line with no reason"));
        assert!(
            failure.contains("cash documents"),
            "the failure did not say what was missing: {failure}"
        );
        assert_eq!(
            after
                .events
                .iter()
                .filter(|e| e.kind == "ITEM_FAILED")
                .count(),
            20
        );
        return;
    }

    // Three by hand, then the rest.
    for item in created.items.iter().take(3) {
        cloud::payment_batch_execute_item(
            &pool,
            created.batch.batch_id,
            item.item_id,
            &ExecutePaymentBatchItemRequest {
                bank_reference: Some("BCA/0001".into()),
            },
            ACTOR,
        )
        .await
        .unwrap_or_else(|e| panic!("execute one: {e}"));
    }
    let midway = cloud::payment_batch_read(&pool, created.batch.batch_id)
        .await
        .unwrap_or_else(|e| panic!("read: {e}"));
    assert_eq!(midway.batch.status, "PARTIAL");

    let rest = cloud::payment_batch_execute_remaining(&pool, created.batch.batch_id, ACTOR)
        .await
        .unwrap_or_else(|e| panic!("resume: {e}"));
    assert_eq!(rest.executed, 17, "the resumed run paid the wrong number");
    assert_eq!(rest.still_pending, 0);

    // The three paid first were not paid again.
    let documents: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT cash_document_id)::bigint FROM payment_batch_item
          WHERE batch_id = $1 AND cash_document_id IS NOT NULL",
    )
    .bind(created.batch.batch_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("count: {e}"));
    assert_eq!(documents, 20);
}

// ---------------------------------------------------------------------------
// The payment context
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn one_bill_is_a_single_payment_and_two_are_pay_obligations(pool: PgPool) {
    use_a_test_key();
    seed_chart(&pool).await;
    let first = a_posted_bill(&pool, "SUP01", "INV-1", 400_000_00).await;
    a_posted_bill(&pool, "SUP01", "INV-2", 250_000_00).await;

    let one = cloud::payment_context_resolve(&pool, "BILL", &first.to_string())
        .await
        .unwrap_or_else(|e| panic!("bill context: {e}"));
    assert_eq!(one.pattern, PaymentPattern::SinglePayment);
    assert_eq!(one.primitive, "PAY");
    assert!(one.allocates);
    assert_eq!(one.obligations.len(), 1);
    assert_eq!(one.default_amount_minor, 400_000_00);
    assert_eq!(one.due_date, Some(september(30)));

    let both = cloud::payment_context_resolve(&pool, "SUPPLIER", "SUP01")
        .await
        .unwrap_or_else(|e| panic!("supplier context: {e}"));
    assert_eq!(both.pattern, PaymentPattern::PayObligations);
    assert_eq!(both.obligations.len(), 2);
    assert_eq!(both.default_amount_minor, 650_000_00);
    assert_eq!(
        both.party.as_ref().map(|p| p.party_id.as_str()),
        Some("SUP01")
    );

    // The same bill paid on paper is a different screen and only one method.
    let giro = cloud::payment_context_resolve(&pool, "GIRO", &first.to_string())
        .await
        .unwrap_or_else(|e| panic!("giro context: {e}"));
    assert_eq!(giro.pattern, PaymentPattern::GiroPayment);
    assert_eq!(giro.allowed_methods, vec!["GIRO".to_string()]);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_transfer_is_a_transfer_and_a_float_is_a_float(pool: PgPool) {
    use_a_test_key();
    seed_chart(&pool).await;

    let transfer = cloud::payment_context_resolve(&pool, "BANK_TRANSFER", "dc")
        .await
        .unwrap_or_else(|e| panic!("transfer context: {e}"));
    assert_eq!(transfer.pattern, PaymentPattern::MoneyTransfer);
    assert_eq!(transfer.primitive, "TRANSFER");
    // The whole claim, at the layer this lane owns: a transfer offers no
    // allocation and no obligations, so there is nothing for it to settle and
    // no entry for it to open. The Payment Ledger holds balances somebody has
    // to follow; money moving between two of our own pots leaves none.
    assert!(!transfer.allocates);
    assert!(transfer.obligations.is_empty());
    assert!(transfer.recipients.is_empty());
    assert!(!transfer.allowed_methods.contains(&"GIRO".to_string()));

    let ledger: Option<String> =
        sqlx::query_scalar("SELECT to_regclass('public.payment_ledger_entry')::text")
            .fetch_one(&pool)
            .await
            .unwrap_or(None);
    match ledger {
        Some(_) => {
            let rows: i64 = sqlx::query_scalar(
                "SELECT COUNT(*)::bigint FROM payment_ledger_entry WHERE voucher_kind = 'CASH_DOC'",
            )
            .fetch_one(&pool)
            .await
            .unwrap_or(0);
            assert_eq!(rows, 0, "a transfer opened a Payment Ledger entry");
        }
        None => println!(
            "SKIPPED: counting payment_ledger_entry rows — the Payment Ledger (0143) lands in a \
             sibling lane. The claim is asserted above as: a transfer allocates nothing and \
             answers nothing"
        ),
    }

    let float = cloud::payment_context_resolve(&pool, "FUND_ALLOCATION", "emp-1")
        .await
        .unwrap_or_else(|e| panic!("fund context: {e}"));
    assert_eq!(float.pattern, PaymentPattern::FundCustodian);
    assert_eq!(float.primitive, "PAY");
    assert!(!float.allocates);
    assert!(!float.notes.is_empty());
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_batch_is_a_batch_payout_and_an_unknown_source_is_refused(pool: PgPool) {
    use_a_test_key();
    seed_chart(&pool).await;
    let items = twenty_recipients(&pool).await;
    let created = cloud::payment_batch_create(&pool, &a_batch(items, "SKIP"), ACTOR)
        .await
        .unwrap_or_else(|e| panic!("create: {e}"));

    let context =
        cloud::payment_context_resolve(&pool, "BATCH", &created.batch.batch_id.to_string())
            .await
            .unwrap_or_else(|e| panic!("batch context: {e}"));
    assert_eq!(context.pattern, PaymentPattern::BatchPayout);
    assert_eq!(context.primitive, "PAY");
    assert_eq!(context.default_amount_minor, created.batch.total_minor);

    // A payroll run resolves to the right pattern even though nothing can pay
    // it yet, and says so rather than pretending.
    let payroll = cloud::payment_context_resolve(&pool, "PAYROLL_RUN", "run-2026-09")
        .await
        .unwrap_or_else(|e| panic!("payroll context: {e}"));
    assert_eq!(payroll.pattern, PaymentPattern::BatchPayout);
    assert!(payroll.obligations.is_empty());
    assert!(
        payroll.notes.iter().any(|n| n.contains("net figure")),
        "the payroll seam does not say what is missing: {:?}",
        payroll.notes
    );

    let refused = cloud::payment_context_resolve(&pool, "SOMETHING_ELSE", "1").await;
    match refused {
        Err(AppError::Validation(message)) => assert!(
            message.contains("BILL") && message.contains("SUPPLIER"),
            "the refusal did not list what is understood: {message}"
        ),
        other => panic!("an unknown source kind was accepted: {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// The allocation surface
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn allocation_refuses_over_settlement_and_an_accidental_remainder(pool: PgPool) {
    use_a_test_key();
    seed_chart(&pool).await;
    let bill = a_posted_bill(&pool, "SUP01", "INV-1", 400_000_00).await;
    let destination = a_verified_destination(&pool, "SUP01", "8290123456").await;

    let created = cloud::payment_batch_create(
        &pool,
        &a_batch(
            vec![PaymentBatchItemInput {
                party_type: "SUPPLIER".into(),
                party_id: "SUP01".into(),
                party_name: "PT SUP01".into(),
                destination_id: Some(destination),
                amount_minor: 500_000_00,
                obligation_kind: Some("BILL".into()),
                obligation_id: Some(bill.to_string()),
                obligation_reference: Some("INV-1".into()),
            }],
            "SKIP",
        ),
        ACTOR,
    )
    .await
    .unwrap_or_else(|e| panic!("create: {e}"));
    let item = created.items[0].item_id;

    let surface = cloud::payment_allocation_surface(&pool, "BATCH_ITEM", &item.to_string())
        .await
        .unwrap_or_else(|e| panic!("surface: {e}"));
    assert_eq!(surface.amount_minor, 500_000_00);
    assert_eq!(surface.unallocated_minor, 500_000_00);
    assert_eq!(surface.candidates.len(), 1);
    assert_eq!(surface.candidates[0].outstanding_minor, 400_000_00);
    assert!(!surface.ledger_available || surface.notes.is_empty());

    // More than is open against the bill.
    let over = cloud::payment_allocation_apply(
        &pool,
        "BATCH_ITEM",
        &item.to_string(),
        &cloud::PaymentAllocationRequest {
            action: "ALLOCATE".into(),
            lines: vec![cloud::AllocationLine {
                obligation_kind: "BILL".into(),
                obligation_id: bill.to_string(),
                amount_minor: 450_000_00,
            }],
            permit_remainder: true,
            remainder_reason: Some("advance".into()),
            reason: None,
        },
        ACTOR,
    )
    .await;
    match over {
        Err(AppError::Validation(message)) => assert!(
            message.contains("credit note"),
            "over-settlement was refused for the wrong reason: {message}"
        ),
        other => panic!("a bill was over-settled: {other:?}"),
    }

    // The right amount, but 100,000.00 left answering nothing and nobody said
    // so. This is the failure that leaves an ageing showing a debt that has
    // been paid.
    let silent_remainder = cloud::payment_allocation_apply(
        &pool,
        "BATCH_ITEM",
        &item.to_string(),
        &cloud::PaymentAllocationRequest {
            action: "ALLOCATE".into(),
            lines: vec![cloud::AllocationLine {
                obligation_kind: "BILL".into(),
                obligation_id: bill.to_string(),
                amount_minor: 400_000_00,
            }],
            permit_remainder: false,
            remainder_reason: None,
            reason: None,
        },
        ACTOR,
    )
    .await;
    match silent_remainder {
        Err(AppError::Validation(message)) => assert!(
            message.contains("answering nothing"),
            "an accidental remainder was not named: {message}"
        ),
        other => panic!("money was left answering nothing without anybody saying so: {other:?}"),
    }

    // Said deliberately, it reaches the ledger — which is where this branch
    // stops, and says which call it stops before.
    let permitted = cloud::payment_allocation_apply(
        &pool,
        "BATCH_ITEM",
        &item.to_string(),
        &cloud::PaymentAllocationRequest {
            action: "ALLOCATE".into(),
            lines: vec![cloud::AllocationLine {
                obligation_kind: "BILL".into(),
                obligation_id: bill.to_string(),
                amount_minor: 400_000_00,
            }],
            permit_remainder: true,
            remainder_reason: Some("paid a round figure ahead of the October bill".into()),
            reason: None,
        },
        ACTOR,
    )
    .await;
    match permitted {
        Err(AppError::Configuration(message)) => assert!(
            message.contains("Payment Ledger"),
            "the seam did not name the ledger: {message}"
        ),
        Ok(_) => {} // The ledger is present and did the bookkeeping.
        other => panic!("a permitted remainder was refused for the wrong reason: {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// The kernel, from the outside
// ---------------------------------------------------------------------------

#[test]
fn the_pattern_is_a_function_of_the_facts_and_not_of_the_caller() {
    // The same shape reached from two different screens is the same pattern.
    // That is the whole reason this lives in the kernel and is asked once.
    let from_payables = PaymentSourceShape::paying(2);
    let from_the_supplier_page = PaymentSourceShape {
        recipients: 1,
        obligations: 2,
        between_own_accounts: false,
        custodial: false,
        on_instrument: false,
        direction: PaymentDirection::Out,
    };
    assert_eq!(
        payment_pattern_for(from_payables),
        payment_pattern_for(from_the_supplier_page)
    );
    assert_eq!(payment_account_mask("1234 5678 90"), "••••••7890");
}
