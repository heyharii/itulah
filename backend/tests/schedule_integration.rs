//! The clock, against a real database.
//!
//! The pure half of the schedule lives in `domain::schedule` and is tested
//! there. What this file adds is the row half: an accrual claim writes exactly
//! one ledger entry, and a second pass over the same month claims nothing more
//! — the property that makes hourly ticks safe.

use inventory_backend::cloud::postgres as cloud;
use serde_json::json;
use sqlx::PgPool;

fn date(raw: &str) -> chrono::NaiveDate {
    raw.parse()
        .unwrap_or_else(|error| panic!("date {raw}: {error}"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
#[ignore = "blocked by migration 0365 (GA lane): it fails its own UPDATE probe while applying. \
            The scheduler row half is exercised by this test once that lane hydrates; the pure \
            arithmetic is covered in domain::schedule and runs in the default suite."]
async fn the_clock_earns_a_monthly_policy_once(pool: PgPool) {
    let on = date("2026-09-25");

    sqlx::query(
        "INSERT INTO leave_type
             (code, name, backing, max_centidays, payment, requires_evidence)
         VALUES ('ANNUAL', 'Cuti tahunan', 'BALANCE', NULL, 'FULL', FALSE)",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("leave type: {error}"));

    // A month before the run, so this is not the first month of the policy:
    // twelve days a year is a hundred centidays a month, and September has
    // earned nine of them.
    let policy = json!({
        "version": 1,
        "effective_from": "2026-01-01",
        "annual_entitlement": 1200,
        "accrual": "MONTHLY",
        "carry_forward": { "kind": "FORBIDDEN" },
        "encashment": { "kind": "FORBIDDEN" },
        "protected_leave": "CONTINUES"
    });
    sqlx::query(
        "INSERT INTO leave_policy (version, effective_from, annual_centidays, policy)
         VALUES (1, '2026-01-01', 1200, $1)",
    )
    .bind(&policy)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("leave policy: {error}"));

    sqlx::query(
        "INSERT INTO employee (id, code, status) VALUES ('emp_sched', 'E-SCHED', 'ACTIVE')",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("employee: {error}"));

    let authorized = json!({
        "actor": "test",
        "action_key": "people.assignment.manage",
        "at": "2026-01-01T00:00:00Z",
        "reason": "fixture"
    });
    sqlx::query(
        "INSERT INTO employee_assignment
             (id, employee_id, unit_id, valid_from, valid_to, authorized)
         VALUES ('as_sched', 'emp_sched', 'ho', '2026-01-01', NULL, $1)",
    )
    .bind(&authorized)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("assignment: {error}"));

    let first = cloud::run_all(&pool, on).await;
    assert!(
        first.iter().any(|result| result.job == "leave.accrual"),
        "the accrual job must appear in the pass: {first:?}"
    );

    let earned: i32 = sqlx::query_scalar(
        "SELECT COALESCE(sum(centidays), 0)::int
           FROM leave_ledger_entry
          WHERE employee_id = 'emp_sched' AND event = 'ACCRUAL'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("ledger sum: {error}"));
    assert_eq!(
        earned, 900,
        "nine twelfths of twelve days, which is what September has earned"
    );

    // A second pass on the same day is the property the claim ledger exists
    // for: the hourly worker must not accrue the month again.
    let second = cloud::run_all(&pool, on).await;
    let again: i32 = sqlx::query_scalar(
        "SELECT COALESCE(sum(centidays), 0)::int
           FROM leave_ledger_entry
          WHERE employee_id = 'emp_sched' AND event = 'ACCRUAL'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("ledger sum: {error}"));
    assert_eq!(again, 900, "the month is earned once");
    assert!(
        second.iter().any(|result| result.job == "leave.accrual"),
        "the job still reports what it did: {second:?}"
    );
}
