//! The reminder pass, against a real database.
//!
//! The bands are pure and tested in `domain::reminder`. What this file adds is
//! the row half: a lapsing contract, paper, bill or tax month raises exactly one
//! notice to head office, a second pass over the same day raises nothing, and
//! the kinds the HR nudges raise are ones the database accepts.

use chrono::NaiveDate;
use inventory_backend::cloud::{
    domain::{reminder, schedule},
    postgres::{self as cloud, NewNotification},
};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

const ACTOR: &str = "ana";

fn day(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).unwrap_or_else(|| panic!("bad date"))
}

/// The business day every pass runs for.
fn today() -> NaiveDate {
    day(2026, 9, 25)
}

async fn head_office(pool: &PgPool) {
    sqlx::query(
        "INSERT INTO app_user (id, username, display_name, password_hash, role, created_by)
         VALUES ($1, 'kantor', 'Kantor Pusat', 'x', 'ADMIN', 'test')",
    )
    .bind(Uuid::new_v4())
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("admin: {error}"));
}

async fn notices(pool: &PgPool, kind: &str) -> Vec<(String, String, Option<String>)> {
    sqlx::query_as(
        "SELECT n.title, n.body, n.subject_id
           FROM notification n
           JOIN notification_recipient r ON r.notification_id = n.notification_id
          WHERE n.kind = $1 AND r.username = 'kantor'
          ORDER BY n.created_at, n.title",
    )
    .bind(kind)
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("notices {kind}: {error}"))
}

fn raised(result: &cloud::SchedulerJobResult) -> u64 {
    assert_eq!(result.status, "RAN", "{}: {}", result.job, result.detail);
    result.detail["raised"].as_u64().unwrap_or(0)
}

async fn pass(pool: &PgPool) -> Vec<cloud::SchedulerJobResult> {
    cloud::run_reminders(pool, today()).await
}

fn job<'a>(results: &'a [cloud::SchedulerJobResult], name: &str) -> &'a cloud::SchedulerJobResult {
    results
        .iter()
        .find(|result| result.job == name)
        .unwrap_or_else(|| panic!("no result for {name}"))
}

// ---------------------------------------------------------------------------

async fn active_contract(pool: &PgPool, number: &str, ends_on: NaiveDate) -> Uuid {
    let request = cloud::RecordGaContractRequest {
        contract_number: Some(number.into()),
        contract_type: "SEWA_TOKO".into(),
        objek: None,
        supplier_id: None,
        counterparty_name: Some("Pasar Raya Inkubator".into()),
        site_id: Some("dc".into()),
        site_scope: None,
        asset_id: None,
        starts_on: day(2026, 1, 1),
        ends_on: Some(ends_on),
        contract_value_minor: Some(240_000_000),
        is_signed: true,
        signed_by: Some("Bpk. Har".into()),
        customer_number: None,
        reminder_days: 60,
        notes: None,
    };
    let row = cloud::ga_contract_record(pool, &request, ACTOR, today())
        .await
        .unwrap_or_else(|error| panic!("record: {error}"));
    let mut update = cloud::UpdateGaContractRequest::default();
    update.status = Some("ACTIVE".into());
    cloud::ga_contract_update(pool, row.contract_id, &update, ACTOR, today())
        .await
        .unwrap_or_else(|error| panic!("activate: {error}"));
    row.contract_id
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_contract_inside_its_window_is_told_once(pool: PgPool) {
    head_office(&pool).await;
    // Inside the sixty-day window, and far outside it.
    let soon = active_contract(&pool, "LK/2026/0142", day(2026, 10, 31)).await;
    active_contract(&pool, "LK/2026/0200", day(2027, 6, 30)).await;
    // Ended a week ago and still ACTIVE: renewed on paper or not, the register
    // has to say which.
    let ended = active_contract(&pool, "LK/2025/0077", day(2026, 9, 18)).await;

    let first = pass(&pool).await;
    assert_eq!(raised(job(&first, reminder::jobs::GA_CONTRACT)), 2);
    let told = notices(&pool, reminder::kinds::GA_CONTRACT).await;
    assert_eq!(told.len(), 2);
    let subjects: Vec<_> = told.iter().filter_map(|(_, _, s)| s.clone()).collect();
    assert!(subjects.contains(&soon.to_string()));
    assert!(subjects.contains(&ended.to_string()));
    assert!(told.iter().any(|(_, body, _)| body.contains("LK/2026/0142")
        && body.contains("in 36 days")));

    let second = pass(&pool).await;
    assert_eq!(raised(job(&second, reminder::jobs::GA_CONTRACT)), 0);
    assert_eq!(notices(&pool, reminder::kinds::GA_CONTRACT).await.len(), 2);
}

// ---------------------------------------------------------------------------

async fn a_paper(pool: &PgPool, doc_type: &str, expires_on: NaiveDate) -> Uuid {
    let file_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO stored_file
             (file_id, file_name, content_type, byte_size, sha256, storage, bytes, uploaded_by)
         VALUES ($1,'scan.jpg','image/jpeg',16,$2,'DATABASE',$3,$4)",
    )
    .bind(file_id)
    .bind("0".repeat(64))
    .bind(vec![0u8; 16])
    .bind(ACTOR)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("file: {error}"));
    sqlx::query_scalar(
        "INSERT INTO document (file_id, name, uploaded_by, doc_type, doc_number, expires_on)
         VALUES ($1, 'scan.jpg', $2, $3, 'B 1234 XYZ', $4)
         RETURNING document_id",
    )
    .bind(file_id)
    .bind(ACTOR)
    .bind(doc_type)
    .bind(expires_on)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("document: {error}"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_paper_about_to_lapse_is_told_once(pool: PgPool) {
    head_office(&pool).await;
    let stnk = a_paper(&pool, "STNK", day(2026, 10, 10)).await;
    a_paper(&pool, "SLO", day(2027, 3, 1)).await;
    a_paper(&pool, "POLIS", day(2025, 1, 1)).await;

    let first = pass(&pool).await;
    assert_eq!(raised(job(&first, reminder::jobs::DOCUMENT)), 1);
    let told = notices(&pool, reminder::kinds::DOCUMENT).await;
    assert_eq!(told.len(), 1);
    assert_eq!(told[0].2.as_deref(), Some(stnk.to_string().as_str()));
    assert!(told[0].1.starts_with("STNK B 1234 XYZ"), "{}", told[0].1);

    let second = pass(&pool).await;
    assert_eq!(raised(job(&second, reminder::jobs::DOCUMENT)), 0);
}

// ---------------------------------------------------------------------------

async fn a_posted_bill(pool: &PgPool, number: &str, due: NaiveDate, total: i64) {
    sqlx::query(
        "INSERT INTO supplier_invoice
             (invoice_id, invoice_number, supplier_id, supplier_name, site_id, invoice_date,
              due_date, currency, subtotal_minor, total_minor, status, recorded_by)
         VALUES ($1, $2, 'sup-1', 'PT Kain Nusantara', 'dc', '2026-09-01', $3, 'IDR',
                 $4, $4, 'POSTED', $5)",
    )
    .bind(Uuid::new_v4())
    .bind(number)
    .bind(due)
    .bind(total)
    .bind(ACTOR)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("bill {number}: {error}"));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn bills_due_this_week_are_told_in_one_notice(pool: PgPool) {
    head_office(&pool).await;
    a_posted_bill(&pool, "INV-001", day(2026, 9, 28), 1_250_000).await;
    a_posted_bill(&pool, "INV-002", day(2026, 10, 2), 750_000).await;
    a_posted_bill(&pool, "INV-003", day(2026, 10, 20), 500_000).await;
    a_posted_bill(&pool, "INV-004", day(2026, 9, 20), 900_000).await;

    let first = pass(&pool).await;
    let result = job(&first, reminder::jobs::BILL_DUE);
    assert_eq!(raised(result), 1);
    assert_eq!(result.detail["bills"], json!(2));
    let told = notices(&pool, reminder::kinds::BILL_DUE).await;
    assert_eq!(told.len(), 1);
    let body = &told[0].1;
    assert!(body.contains("INV-001") && body.contains("INV-002"), "{body}");
    assert!(!body.contains("INV-003") && !body.contains("INV-004"), "{body}");
    assert!(body.contains("Rp 2.000.000"), "{body}");

    // The same bills are not the same news tomorrow.
    let second = pass(&pool).await;
    assert_eq!(raised(job(&second, reminder::jobs::BILL_DUE)), 0);
    assert_eq!(notices(&pool, reminder::kinds::BILL_DUE).await.len(), 1);
}

// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_withholding_month_is_told_before_its_deadlines(pool: PgPool) {
    head_office(&pool).await;
    // August's PPh 21 was due to be paid on 15 September and reported on the
    // 20th; on the 25th both are late. September's is not due until October.
    for (month, source) in [(8, "payroll-2026-08"), (9, "payroll-2026-09")] {
        cloud::tax_item_record(
            &pool,
            &cloud::RecordTaxItemRequest {
                tax_type_code: "PPH21".into(),
                year: 2026,
                month,
                unit_id: "ho".into(),
                kind: "OBLIGATION".into(),
                amount_minor: 3_400_000,
                source_kind: "PAYROLL".into(),
                source_id: source.into(),
                evidence: None,
                note: None,
            },
            ACTOR,
        )
        .await
        .unwrap_or_else(|error| panic!("tax item {month}: {error}"));
    }

    let first = pass(&pool).await;
    assert_eq!(raised(job(&first, reminder::jobs::TAX_DEADLINE)), 2);
    let told = notices(&pool, reminder::kinds::TAX_DEADLINE).await;
    let titles: Vec<_> = told.iter().map(|(title, _, _)| title.as_str()).collect();
    assert!(titles.contains(&"A tax payment is late"), "{titles:?}");
    assert!(titles.contains(&"A tax return is late"), "{titles:?}");
    assert!(told.iter().all(|(_, body, _)| body.contains("2026-08")));
    assert!(told.iter().any(|(_, body, _)| body.contains("Rp 3.400.000")));

    let second = pass(&pool).await;
    assert_eq!(raised(job(&second, reminder::jobs::TAX_DEADLINE)), 0);
}

// ---------------------------------------------------------------------------

/// The HR nudges once raised under their job names, which the kind check
/// refused. The kinds they raise now are the ones 0363 added.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_hr_nudges_raise_kinds_the_database_accepts(pool: PgPool) {
    head_office(&pool).await;
    for kind in [
        schedule::kinds::CONTRACT_NUDGE,
        schedule::kinds::PERIOD_NUDGE,
        schedule::kinds::ROSTER_NUDGE,
    ] {
        let mut tx = pool.begin().await.unwrap_or_else(|error| panic!("{error}"));
        cloud::raise_notification(
            &mut tx,
            NewNotification {
                kind,
                title: "t".into(),
                body: "b".into(),
                subject: None,
                origin_id: None,
                payload: json!({}),
            },
            &["kantor".to_owned()],
        )
        .await
        .unwrap_or_else(|error| panic!("{kind} refused: {error}"));
        tx.commit().await.unwrap_or_else(|error| panic!("{error}"));
    }
}
