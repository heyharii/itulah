//! Tax: what is owed, what is held as a credit, and the line between them.
//!
//! The chart these run against is the migrations' own — 0243 and its
//! successors put the client's accounts there — so nothing here seeds a chart.
//! What a test does seed is the MAP, because pointing a meaning at an account
//! is a statement a person makes, and the refusals below are the ones that
//! statement makes possible.

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{
    self as cloud, RecordTaxItemRequest, SettleTaxRequest,
};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
const SITE: &str = "dc";
/// `2012101006 Hutang Pajak PPh Pasal 29` — what is owed at year end.
const PPH29: &str = "2012101006";
/// `1011302002 Prepaid - PPh Pasal 25` — instalments already paid.
const PPH25: &str = "1011302002";
const BANK: &str = "1011002001";

async fn map(pool: &PgPool, key: &str, qualifier: &str, code: &str) {
    sqlx::query(
        "INSERT INTO account_map (semantic_key, site_id, qualifier, account_code, set_by)
         VALUES ($1,$2,$3,$4,'test')
         ON CONFLICT (semantic_key, site_id, qualifier) DO UPDATE SET account_code = $4",
    )
    .bind(key)
    .bind(SITE)
    .bind(qualifier)
    .bind(code)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("map {key}: {error}"));
}

async fn ready(pool: &PgPool) {
    map(pool, "pph29_payable", "", PPH29).await;
    map(pool, "pph25_credit", "", PPH25).await;
    map(pool, "bank_giro", "BCA", BANK).await;
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open september: {error}"));
}

/// A document that has already posted, so an obligation has something to point
/// at. Written straight into the journal: what is under test is the subledger.
async fn a_posted_document(pool: &PgPool, amount_minor: i64) -> String {
    let entry_id = Uuid::new_v4();
    let source_id = Uuid::new_v4().to_string();
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    sqlx::query(
        "INSERT INTO journal_entry
           (entry_id, entry_number, posting_date, source_kind, source_id, purpose,
            rule_version, total_minor, currency, memo, posted_by)
         VALUES ($1,$2,'2026-09-30','PAYROLL_RUN',$3,'MAIN','payroll/1',$4,'IDR','gaji',$5)",
    )
    .bind(entry_id)
    .bind(format!("JV-{}", &entry_id.to_string()[..8]))
    .bind(&source_id)
    .bind(amount_minor)
    .bind(ACTOR)
    .execute(&mut *tx)
    .await
    .unwrap_or_else(|error| panic!("entry: {error}"));
    for (index, (code, debit, credit)) in
        [(PPH29, 0, amount_minor), (BANK, amount_minor, 0)]
            .into_iter()
            .enumerate()
    {
        sqlx::query(
            "INSERT INTO journal_line
               (line_id, entry_id, line_number, account_code, site_id, debit_minor, credit_minor)
             VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(Uuid::new_v4())
        .bind(entry_id)
        .bind(index as i32 + 1)
        .bind(code)
        .bind(SITE)
        .bind(debit)
        .bind(credit)
        .execute(&mut *tx)
        .await
        .unwrap_or_else(|error| panic!("line: {error}"));
    }
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));
    source_id
}

async fn balance(pool: &PgPool, code: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(debit_minor - credit_minor),0)::bigint
           FROM journal_line WHERE account_code = $1",
    )
    .bind(code)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("balance {code}: {error}"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_obligation_is_recorded_once_however_often_its_document_replays(pool: PgPool) {
    ready(&pool).await;
    let source_id = a_posted_document(&pool, 4_000_000).await;

    let ask = RecordTaxItemRequest {
        tax_type_code: "PPH29".into(),
        year: 2026,
        month: 9,
        site_id: SITE.into(),
        kind: "OBLIGATION".into(),
        amount_minor: 4_000_000,
        source_kind: "PAYROLL_RUN".into(),
        source_id: source_id.clone(),
        evidence: None,
        note: None,
    };
    let first = cloud::tax_item_record(&pool, &ask, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("record: {error}"));
    assert_eq!(first.period.obligation_minor, 4_000_000);
    assert_eq!(first.period.outstanding_minor, 4_000_000);
    assert_eq!(first.items.len(), 1);

    let again = cloud::tax_item_record(&pool, &ask, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("replay: {error}"));
    assert_eq!(
        again.items.len(),
        1,
        "the same document recognises the same tax once"
    );
    assert_eq!(again.period.obligation_minor, 4_000_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn paying_a_tax_discharges_it_and_settles_the_period(pool: PgPool) {
    ready(&pool).await;
    let source_id = a_posted_document(&pool, 4_000_000).await;
    cloud::tax_item_record(
        &pool,
        &RecordTaxItemRequest {
            tax_type_code: "PPH29".into(),
            year: 2026,
            month: 9,
            site_id: SITE.into(),
            kind: "OBLIGATION".into(),
            amount_minor: 4_000_000,
            source_kind: "PAYROLL_RUN".into(),
            source_id,
            evidence: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("record: {error}"));

    let before = balance(&pool, PPH29).await;
    let settled = cloud::tax_settle(
        &pool,
        &SettleTaxRequest {
            tax_type_code: "PPH29".into(),
            year: 2026,
            month: 9,
            site_id: SITE.into(),
            amount_minor: 4_000_000,
            posting_date: NaiveDate::from_ymd_opt(2026, 9, 30).unwrap_or_default(),
            bank_key: "bank_giro".into(),
            bank_qualifier: "BCA".into(),
            evidence: Some("SSP-2026-09".into()),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("settle: {error}"));

    assert_eq!(settled.period.settled_minor, 4_000_000);
    assert_eq!(settled.period.outstanding_minor, 0);
    assert_eq!(settled.period.status, "SETTLED");
    // The debt is discharged: the payable's credit balance comes back to where
    // it was before the obligation was recognised.
    assert_eq!(balance(&pool, PPH29).await, before + 4_000_000);
    assert!(
        settled
            .items
            .iter()
            .any(|item| item.kind == "SETTLEMENT" && item.entry_id.is_some()),
        "a settlement carries the entry it posted"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_credit_type_cannot_be_made_to_owe(pool: PgPool) {
    ready(&pool).await;
    let source_id = a_posted_document(&pool, 1_000_000).await;
    let refused = cloud::tax_item_record(
        &pool,
        &RecordTaxItemRequest {
            tax_type_code: "PPH25".into(),
            year: 2026,
            month: 9,
            site_id: SITE.into(),
            kind: "OBLIGATION".into(),
            amount_minor: 1_000_000,
            source_kind: "PAYROLL_RUN".into(),
            source_id,
            evidence: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .err()
    .unwrap_or_else(|| panic!("PPh 25 is a credit and cannot carry an obligation"));
    let said = refused.to_string();
    assert!(said.contains("CREDIT"), "{said}");
    assert!(
        said.contains("net"),
        "the refusal has to say what it is preventing: {said}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_instalment_paid_in_advance_is_an_asset_and_not_a_discharge(pool: PgPool) {
    ready(&pool).await;
    // Buying a PPh 25 credit: the money leaves and an ASSET appears. The
    // shape looks like a payment and the meaning is the opposite one.
    let settled = cloud::tax_settle(
        &pool,
        &SettleTaxRequest {
            tax_type_code: "PPH25".into(),
            year: 2026,
            month: 9,
            site_id: SITE.into(),
            amount_minor: 2_500_000,
            posting_date: NaiveDate::from_ymd_opt(2026, 9, 15).unwrap_or_default(),
            bank_key: "bank_giro".into(),
            bank_qualifier: "BCA".into(),
            evidence: Some("SSP PPh25".into()),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("settle: {error}"));
    assert_eq!(settled.period.nature, "CREDIT");
    assert_eq!(
        balance(&pool, PPH25).await,
        2_500_000,
        "the credit is held as an asset"
    );
    assert_eq!(balance(&pool, BANK).await, -2_500_000);

    // And the two never meet: a control reading reports them on separate rows.
    let control = cloud::tax_reconciliation(&pool, None)
        .await
        .unwrap_or_else(|error| panic!("reconciliation: {error}"));
    let credit_rows = control.iter().filter(|row| row.nature == "CREDIT").count();
    assert!(credit_rows >= 1);
    assert!(
        control
            .iter()
            .all(|row| row.nature == "CREDIT" || row.nature == "PAYABLE"),
        "every row declares which side it is"
    );
}
