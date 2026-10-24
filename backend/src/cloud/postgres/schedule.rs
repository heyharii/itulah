//! The scheduler's rows, and the work each claimed period does.
//!
//! # Why this is a claim ledger and not a last-run column
//!
//! See `0363` for the whole argument. The short version: a job's unit of work
//! is a *period* — a month of accrual, a day's expiry sweep, a week's roster —
//! and "did March accrue?" cannot be answered by a single `last_run_at`.
//! [`claim_run`] takes that period; a second worker racing for it loses, and a
//! `FAILED` claim is retried on the next tick rather than lost until tomorrow.
//!
//! # What each job writes, and what it refuses
//!
//! * **Accrual** calls `domain::schedule::accrual_due`, which subtracts what
//!   the ledger already holds from what the policy has earned. It writes only
//!   the delta, and the ledger's primary key makes a replayed write a no-op.
//! * **Expiry** calls `LedgerTimeline::expiry_due` — the kernel already knows
//!   the entry it is due; this only stores it.
//! * **Roster carry** copies last week's plan into next week where a person has
//!   no plan yet. It never overwrites a human plan, and it never invents a
//!   shift: a day with no source plan is left for the gap nudge to report.
//! * **Nudges** raise notifications and write no business fact at all.

use crate::cloud::application::AppError;
use crate::cloud::domain::schedule;
use crate::cloud::domain::{
    actions, Authorization, CarryForward, EmployeeId, LeaveEvent, LeavePolicy, LeaveTypeCatalogue,
    PolicyTimeline, RosterDay, UnitId,
};
use crate::cloud::postgres::{self as infrastructure, NewNotification};
use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;

/// The actor every scheduler write is recorded under.
///
/// A name rather than a user, deliberately: an accrual is the clock's act and
/// nobody's decision, and a stored entry that named a person would outlive
/// their memory of having done it. It is a valid `ActorId` (non-empty,
/// printable, short) so every constructor accepts it.
pub const SCHEDULER_ACTOR: &str = "hr-scheduler";

/// One row of `scheduled_job_run`, as the screen reads it.
#[derive(Clone, Debug, Serialize)]
pub struct ScheduledRunView {
    pub job: String,
    pub run_key: String,
    pub outcome: String,
    pub detail: Value,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

/// What one job did in this pass.
#[derive(Clone, Debug, Serialize)]
pub struct SchedulerJobResult {
    pub job: String,
    /// `RAN`, `SKIPPED` or `FAILED`. The last is returned when the job refused
    /// and `run_all` caught it; it is also written to the run ledger.
    pub status: String,
    pub detail: Value,
}

/// One active employment record, and the place it is currently posted to.
#[derive(Clone, Debug)]
pub struct Posting {
    pub employee_id: String,
    pub unit_id: String,
    pub unit_name: Option<String>,
}

/// Claim a period, and say whether this caller won it.
///
/// A row that already exists and did not fail is somebody else's finished work
/// or this worker's own earlier pass: either way there is nothing to do. A
/// `FAILED` row is re-claimed, because a failure is not a decision — it is a
/// retry waiting for the next tick.
pub async fn claim_run(pool: &PgPool, job: &str, run_key: &str) -> Result<bool, AppError> {
    let affected = sqlx::query(
        "INSERT INTO scheduled_job_run (job, run_key, outcome, detail)
         VALUES ($1, $2, 'RAN', '{}'::jsonb)
         ON CONFLICT (job, run_key) DO UPDATE
            SET outcome = 'RAN',
                detail = '{}'::jsonb,
                started_at = now(),
                finished_at = NULL
          WHERE scheduled_job_run.outcome = 'FAILED'",
    )
    .bind(job)
    .bind(run_key)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(affected == 1)
}

/// Stamp a claimed run's outcome. Called inside the same pass, never later:
/// a run that produced work and crashed before this leaves a `RAN` claim whose
/// detail is empty, which is honest — the work exists, the report of it does
/// not.
pub async fn finish_run(
    pool: &PgPool,
    job: &str,
    run_key: &str,
    outcome: &str,
    detail: Value,
) -> Result<(), AppError> {
    if !matches!(outcome, "RAN" | "FAILED" | "SKIPPED") {
        return Err(AppError::Validation(format!(
            "{outcome:?} is not a scheduled run outcome"
        )));
    }
    sqlx::query(
        "UPDATE scheduled_job_run
            SET outcome = $3, detail = $4, finished_at = now()
          WHERE job = $1 AND run_key = $2",
    )
    .bind(job)
    .bind(run_key)
    .bind(outcome)
    .bind(detail)
    .execute(pool)
    .await?;
    Ok(())
}

/// Record a hand-run beside the claimed periods.
///
/// The jobs stamp their own rows; this is the row that says *why* somebody
/// asked for the pass by hand, under whose name and for which business day.
/// It is a run row like any other, so the screen that shows the clock's work
/// shows the intervention in the same list.
pub async fn record_manual_run(
    pool: &PgPool,
    on: NaiveDate,
    actor: &str,
    reason: &str,
    results: &[SchedulerJobResult],
) -> Result<(), AppError> {
    let run_key = format!("manual:{}:{}", on, Utc::now().timestamp_millis());
    let detail = json!({
        "as_of": on,
        "by": actor,
        "reason": reason,
        "results": results,
    });
    sqlx::query(
        "INSERT INTO scheduled_job_run (job, run_key, outcome, detail)
         VALUES ('hr-scheduler.manual', $1, 'RAN', $2)
         ON CONFLICT (job, run_key) DO NOTHING",
    )
    .bind(&run_key)
    .bind(detail)
    .execute(pool)
    .await?;
    Ok(())
}

/// A page of the run ledger, newest first.
#[derive(Clone, Debug, Serialize)]
pub struct ScheduledRunPage {
    pub rows: Vec<ScheduledRunView>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    pub next_cursor: Option<String>,
}

/// Where the previous page stopped, as the row's own primary key. The seek
/// re-reads that row's `started_at` rather than trusting one carried here.
#[derive(Serialize, Deserialize)]
struct ScheduledRunCursor {
    job: String,
    run_key: String,
}

/// The claims, newest first, a page at a time — for the screen that says
/// whether the clock is doing its work.
///
/// Every order ends in the primary key `(job, run_key)`, so no two rows can
/// compare equal and a keyset cannot repeat or lose the ones that tie on
/// `started_at` — which a pass that claims several jobs in one instant does.
/// All three descend together: a row expression compares in one direction.
pub async fn runs_page(
    pool: &PgPool,
    cursor: Option<&str>,
    limit: Option<i64>,
) -> Result<ScheduledRunPage, AppError> {
    let limit = limit.unwrap_or(50).clamp(1, 200);
    let cursor = cursor
        .map(super::decode_cursor::<ScheduledRunCursor>)
        .transpose()?;
    let rows = sqlx::query(
        "SELECT job, run_key, outcome, detail, started_at, finished_at
           FROM scheduled_job_run
          WHERE $1::text IS NULL
             OR (started_at, job, run_key) < (
                  SELECT started_at, job, run_key FROM scheduled_job_run
                   WHERE job = $1 AND run_key = $2)
          ORDER BY started_at DESC, job DESC, run_key DESC
          LIMIT $3",
    )
    .bind(cursor.as_ref().map(|c| c.job.clone()))
    .bind(cursor.as_ref().map(|c| c.run_key.clone()))
    .bind(limit)
    .fetch_all(pool)
    .await?;
    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => {
            Some(super::encode_cursor(&ScheduledRunCursor {
                job: row.try_get("job")?,
                run_key: row.try_get("run_key")?,
            })?)
        }
        _ => None,
    };
    let rows = rows
        .iter()
        .map(|row| {
            Ok(ScheduledRunView {
                job: row.try_get("job")?,
                run_key: row.try_get("run_key")?,
                outcome: row.try_get("outcome")?,
                detail: row.try_get("detail")?,
                started_at: row.try_get("started_at")?,
                finished_at: row.try_get("finished_at")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    Ok(ScheduledRunPage { rows, next_cursor })
}

// ── the estate the scheduler walks ───────────────────────────────────────

/// Everyone who works here and where they are posted, one row per open posting.
pub async fn active_postings(pool: &PgPool) -> Result<Vec<Posting>, AppError> {
    let rows = sqlx::query(
        "SELECT a.employee_id, a.unit_id, p.name AS unit_name
           FROM employee_assignment a
           JOIN employee e ON e.id = a.employee_id
           JOIN unit p ON p.id = a.unit_id
          WHERE a.valid_to IS NULL AND e.status = 'ACTIVE'
          ORDER BY a.unit_id, a.employee_id",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(Posting {
                employee_id: row.try_get("employee_id")?,
                unit_id: row.try_get("unit_id")?,
                unit_name: row.try_get("unit_name")?,
            })
        })
        .collect()
}

/// Every active employment record, posted anywhere or not.
///
/// Accrual does not depend on a posting: somebody on long leave whose assignment
/// has lapsed is still employed and still earns annual leave.
pub async fn active_employee_ids(pool: &PgPool) -> Result<Vec<String>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT id FROM employee WHERE status = 'ACTIVE' ORDER BY id")
            .fetch_all(pool)
            .await?,
    )
}

/// Which places have somebody posted today, with the place's display name.
pub fn units_of(postings: &[Posting]) -> BTreeMap<String, (Option<String>, Vec<String>)> {
    let mut units: BTreeMap<String, (Option<String>, Vec<String>)> = BTreeMap::new();
    for posting in postings {
        let entry = units
            .entry(posting.unit_id.clone())
            .or_insert_with(|| (posting.unit_name.clone(), Vec::new()));
        entry.1.push(posting.employee_id.clone());
    }
    units
}

// ── one pass over every job ──────────────────────────────────────────────

/// Run every job for one business day, catching each job's failure rather than
/// letting the first one end the pass.
///
/// The worker calls this on every tick and never unwraps a job's error into the
/// loop: one refused accrual must not stop the roster being carried, and the
/// screen must be able to show that the accrual refused. Claims make the pass
/// cheap when there is nothing due — a month already accrued is one `INSERT`
/// that changes nothing.
pub async fn run_all(pool: &PgPool, on: NaiveDate) -> Vec<SchedulerJobResult> {
    let mut results = Vec::new();
    for job in [
        schedule::jobs::LEAVE_ACCRUAL,
        schedule::jobs::LEAVE_EXPIRY,
        schedule::jobs::ROSTER_CARRY,
        schedule::jobs::CONTRACT_NUDGE,
        schedule::jobs::PERIOD_NUDGE,
        schedule::jobs::ROSTER_NUDGE,
        schedule::jobs::LOGIN_CLOSE,
    ] {
        let result = match job {
            schedule::jobs::LEAVE_ACCRUAL => run_leave_accrual(pool, on).await,
            schedule::jobs::LEAVE_EXPIRY => run_leave_expiry(pool, on).await,
            schedule::jobs::ROSTER_CARRY => run_roster_carry(pool, on).await,
            schedule::jobs::CONTRACT_NUDGE => run_contract_nudges(pool, on).await,
            schedule::jobs::PERIOD_NUDGE => run_period_nudges(pool, on).await,
            schedule::jobs::ROSTER_NUDGE => run_roster_gap_nudges(pool, on).await,
            schedule::jobs::LOGIN_CLOSE => run_login_close(pool, on).await,
            other => Err(AppError::Configuration(format!(
                "scheduler has no work for job {other}"
            ))),
        };
        results.push(match result {
            Ok(done) => done,
            Err(error) => {
                tracing::error!(job, %on, %error, "HR scheduler job failed");
                SchedulerJobResult {
                    job: job.to_owned(),
                    status: "FAILED".to_owned(),
                    detail: json!({ "error": error.to_string() }),
                }
            }
        });
    }
    results
}

/// The logins of people whose leaving or suspension has taken effect by `on`
/// and is not yet handled, closed (`close_login_on_leaving`). Hourly with the
/// rest, so a leaving dated for today closes its login that morning; not
/// claimed per day, because each event is claimed by itself.
async fn run_login_close(pool: &PgPool, on: NaiveDate) -> Result<SchedulerJobResult, AppError> {
    let job = schedule::jobs::LOGIN_CLOSE;
    let leavers: Vec<String> = sqlx::query_scalar(
        "SELECT e.id FROM employee e
           JOIN app_user u ON u.employee_id = e.id AND u.active
          WHERE e.status IN ('TERMINATED', 'SUSPENDED')
          ORDER BY e.id",
    )
    .fetch_all(pool)
    .await?;
    let mut closed = Vec::new();
    for employee_id in leavers {
        let Some(record) = infrastructure::load_employee(pool, &employee_id).await? else {
            continue;
        };
        // The event that made them leave is their last: the status moves
        // only by appending one.
        let history = record.employee.history();
        let Some(last) = history.last() else {
            continue;
        };
        if last.effective_on() > on {
            continue;
        }
        if let Some(login) = infrastructure::close_login_on_leaving(
            pool,
            &employee_id,
            history.len() - 1,
            "system:hr-scheduler",
        )
        .await?
        {
            closed.push(login);
        }
    }
    Ok(SchedulerJobResult {
        job: job.to_owned(),
        status: if closed.is_empty() { "SKIPPED" } else { "RAN" }.to_owned(),
        detail: if closed.is_empty() {
            json!({ "reason": "no leaving took effect that was not handled" })
        } else {
            json!({ "closed": closed })
        },
    })
}

/// The shared shape of one claimed job: claim the period, do the work, stamp
/// the outcome.
async fn claimed<F>(
    pool: &PgPool,
    job: &'static str,
    run_key: &str,
    work: F,
) -> Result<SchedulerJobResult, AppError>
where
    F: Future<Output = Result<Value, AppError>>,
{
    if !claim_run(pool, job, run_key).await? {
        return Ok(SchedulerJobResult {
            job: job.to_owned(),
            status: "SKIPPED".to_owned(),
            detail: json!({ "reason": "this period has already been worked" }),
        });
    }
    match work.await {
        Ok(detail) => {
            finish_run(pool, job, run_key, "RAN", detail.clone()).await?;
            Ok(SchedulerJobResult {
                job: job.to_owned(),
                status: "RAN".to_owned(),
                detail,
            })
        }
        Err(error) => {
            let detail = json!({ "error": error.to_string() });
            // A failed stamp is not allowed to replace the real error: the
            // caller needs to know why the work refused, not why the report of
            // it refused.
            let _ = finish_run(pool, job, run_key, "FAILED", detail.clone()).await;
            Err(error)
        }
    }
}

// ── leave accrual ────────────────────────────────────────────────────────

pub async fn run_leave_accrual(
    pool: &PgPool,
    on: NaiveDate,
) -> Result<SchedulerJobResult, AppError> {
    let timeline = infrastructure::load_policies(pool).await?;
    if timeline.is_empty() {
        return Ok(SchedulerJobResult {
            job: schedule::jobs::LEAVE_ACCRUAL.to_owned(),
            status: "SKIPPED".to_owned(),
            detail: json!({
                "reason": "no leave policy has been ratified, so there is nothing to have earned"
            }),
        });
    }
    let catalogue = infrastructure::load_catalogue(pool).await?;
    let employees = active_employee_ids(pool).await?;
    let mut written = 0usize;
    let mut already_held = 0usize;
    let mut no_policy = 0usize;
    let mut skipped = 0usize;
    let mut ran = 0usize;

    for employee_id in &employees {
        // A record that exists before any policy has been ratified is not owed
        // a default. It gets its own key, so the day a policy is installed the
        // ordinary key below is still free and the person earns immediately.
        let policy = match timeline.in_force_on(on) {
            Ok(policy) => policy,
            Err(_) => {
                no_policy += 1;
                let key = format!("accrual:{}:{}:no-policy", employee_id, on.format("%Y-%m"));
                if claim_run(pool, schedule::jobs::LEAVE_ACCRUAL, &key).await? {
                    finish_run(
                        pool,
                        schedule::jobs::LEAVE_ACCRUAL,
                        &key,
                        "SKIPPED",
                        json!({ "employee": employee_id, "reason": "no policy in force" }),
                    )
                    .await?;
                }
                continue;
            }
        };
        // One key per person per month, rather than one for the whole estate.
        // A shop that hires on the 20th must not wait for next month's pass to
        // get its first twelfth — and a single failure must not stop the other
        // people in the run from earning theirs.
        let key = format!("accrual:{}:{}", employee_id, on.format("%Y-%m"));
        if !claim_run(pool, schedule::jobs::LEAVE_ACCRUAL, &key).await? {
            skipped += 1;
            continue;
        }
        let result = accrual_for_employee(pool, policy, &catalogue, employee_id, on).await;
        match result {
            Ok(count) => {
                written += count;
                already_held += 1;
                ran += 1;
                finish_run(
                    pool,
                    schedule::jobs::LEAVE_ACCRUAL,
                    &key,
                    "RAN",
                    json!({ "employee": employee_id, "written": count }),
                )
                .await?;
            }
            Err(error) => {
                // The claim stays FAILED so the next tick retries this person
                // rather than silently losing their month.
                let _ = finish_run(
                    pool,
                    schedule::jobs::LEAVE_ACCRUAL,
                    &key,
                    "FAILED",
                    json!({ "employee": employee_id, "error": error.to_string() }),
                )
                .await;
                return Err(error);
            }
        }
    }

    Ok(SchedulerJobResult {
        job: schedule::jobs::LEAVE_ACCRUAL.to_owned(),
        status: "RAN".to_owned(),
        detail: json!({
            "employees": employees.len(),
            "ran": ran,
            "written": written,
            "already_held": already_held,
            "employees_without_policy": no_policy,
            "already_claimed": skipped
        }),
    })
}

async fn accrual_for_employee(
    pool: &PgPool,
    policy: &LeavePolicy,
    catalogue: &LeaveTypeCatalogue,
    employee_id: &str,
    on: NaiveDate,
) -> Result<usize, AppError> {
    let mut written = 0usize;
    // When their service began: the latest hire on the record (a rehire
    // starts the count again).
    let service_start: Option<NaiveDate> = sqlx::query_scalar(
        "SELECT max((event->>'effective_on')::date)
           FROM employee e, jsonb_array_elements(e.history) event
          WHERE e.id = $1 AND event->>'transition' = 'HIRE'",
    )
    .bind(employee_id)
    .fetch_one(pool)
    .await?;
    for leave_type in catalogue.balance_backed() {
        let ledger = infrastructure::load_ledger(pool, employee_id, leave_type.code()).await?;
        // One entry per (person, kind, month). A node that missed March mints
        // the delta in April under April's key, which is the arithmetic
        // `accrual_due` exists to produce.
        let entry_id = format!(
            "accrual:{}:{}:{}",
            employee_id,
            leave_type.code().as_str(),
            on.format("%Y-%m")
        );
        let due = schedule::accrual_due(policy, &ledger, on, &entry_id, service_start)
            .map_err(infrastructure::leave_error)?;
        if let Some(entry) = due {
            infrastructure::append_movement(pool, employee_id, leave_type, &entry).await?;
            written += 1;
        }
    }
    Ok(written)
}

// ── carry-forward expiry ─────────────────────────────────────────────────

pub async fn run_leave_expiry(
    pool: &PgPool,
    on: NaiveDate,
) -> Result<SchedulerJobResult, AppError> {
    let timeline = infrastructure::load_policies(pool).await?;
    if timeline.is_empty() {
        return Ok(SchedulerJobResult {
            job: schedule::jobs::LEAVE_EXPIRY.to_owned(),
            status: "SKIPPED".to_owned(),
            detail: json!({ "reason": "no leave policy has been ratified" }),
        });
    }
    let catalogue = infrastructure::load_catalogue(pool).await?;
    let employees = active_employee_ids(pool).await?;
    let mut written = 0usize;
    let mut skipped = 0usize;

    for employee_id in &employees {
        // Only the day the policy actually names is worked. Without this every
        // active employee would get a claim row for every day of the year just
        // to record that nothing expired.
        let Ok(policy) = timeline.in_force_on(on) else {
            continue;
        };
        let due_today = matches!(
            policy.carry_forward(),
            CarryForward::Capped {
                expires_on_month_day: (month, day),
                ..
            } if month == on.month() && day == on.day()
        );
        if !due_today {
            continue;
        }
        // Per person and per day, so somebody whose write failed is retried on
        // the next tick rather than waiting for the same expiry date next year.
        let key = format!("expiry:{}:{}", employee_id, on.format("%Y-%m-%d"));
        if !claim_run(pool, schedule::jobs::LEAVE_EXPIRY, &key).await? {
            skipped += 1;
            continue;
        }
        let result = expiry_for_employee(pool, &timeline, &catalogue, employee_id, on).await;
        match result {
            Ok(count) => {
                written += count;
                finish_run(
                    pool,
                    schedule::jobs::LEAVE_EXPIRY,
                    &key,
                    "RAN",
                    json!({ "employee": employee_id, "written": count }),
                )
                .await?;
            }
            Err(error) => {
                let _ = finish_run(
                    pool,
                    schedule::jobs::LEAVE_EXPIRY,
                    &key,
                    "FAILED",
                    json!({ "employee": employee_id, "error": error.to_string() }),
                )
                .await;
                return Err(error);
            }
        }
    }

    Ok(SchedulerJobResult {
        job: schedule::jobs::LEAVE_EXPIRY.to_owned(),
        status: "RAN".to_owned(),
        detail: json!({
            "employees": employees.len(),
            "written": written,
            "already_claimed": skipped
        }),
    })
}

async fn expiry_for_employee(
    pool: &PgPool,
    timeline: &PolicyTimeline,
    catalogue: &LeaveTypeCatalogue,
    employee_id: &str,
    on: NaiveDate,
) -> Result<usize, AppError> {
    let Ok(policy) = timeline.in_force_on(on) else {
        return Ok(0);
    };
    let mut written = 0usize;
    for leave_type in catalogue.balance_backed() {
        let ledger = infrastructure::load_ledger(pool, employee_id, leave_type.code()).await?;
        let entry_id = format!(
            "expiry:{}:{}:{}",
            employee_id,
            leave_type.code().as_str(),
            on.year()
        );
        let due = ledger
            .expiry_due(policy, on, &entry_id)
            .map_err(infrastructure::leave_error)?;
        if let Some(entry) = due {
            // The kernel hands back the entry; this is the only thing in the
            // estate that stores it. It fires on the policy's own expiry date
            // and on no other day.
            if entry.event() != LeaveEvent::Expiry {
                return Err(AppError::Configuration(
                    "the expiry kernel returned an entry that is not an expiry".to_owned(),
                ));
            }
            infrastructure::append_movement(pool, employee_id, leave_type, &entry).await?;
            written += 1;
        }
    }
    Ok(written)
}

// ── next week's roster ───────────────────────────────────────────────────

pub async fn run_roster_carry(
    pool: &PgPool,
    on: NaiveDate,
) -> Result<SchedulerJobResult, AppError> {
    let (week_from, _week_to) = schedule::next_week(on);
    let key = schedule::week_key("roster", week_from);
    claimed(
        pool,
        schedule::jobs::ROSTER_CARRY,
        &key,
        roster_carry_work(pool, week_from),
    )
    .await
}

async fn roster_carry_work(pool: &PgPool, week_from: NaiveDate) -> Result<Value, AppError> {
    let postings = active_postings(pool).await?;
    let units = units_of(&postings);
    let source_from = week_from - Duration::days(7);
    let mut written = 0usize;
    let mut without_source = 0usize;
    let mut skipped_closed = 0usize;

    for (unit_id, (_name, employees)) in &units {
        for employee_id in employees {
            for offset in 0..7i64 {
                let target_date = week_from + Duration::days(offset);
                let source_date = source_from + Duration::days(offset);
                // Never overwrite a plan a person made. The carry fills gaps and
                // nothing else; the gap nudge reports what it could not fill.
                if infrastructure::load_roster_day(pool, employee_id, target_date)
                    .await?
                    .is_some()
                {
                    continue;
                }
                let Some(source) =
                    infrastructure::load_roster_day(pool, employee_id, source_date).await?
                else {
                    without_source += 1;
                    continue;
                };
                let unit = UnitId::try_new(unit_id)
                    .map_err(|error| AppError::Validation(error.to_string()))?;
                let period = infrastructure::period_for(pool, &unit, target_date).await?;
                if period.is_closed() {
                    skipped_closed += 1;
                    continue;
                }
                let authorization = Authorization::try_new(
                    SCHEDULER_ACTOR,
                    actions::ROSTER_MANAGE,
                    Utc::now(),
                    &format!("carried forward from {source_date}"),
                )
                .map_err(|error| AppError::Validation(error.to_string()))?;
                let day = RosterDay::new(
                    EmployeeId::try_new(employee_id)
                        .map_err(|error| AppError::Validation(error.to_string()))?,
                    unit,
                    target_date,
                    source.plan().clone(),
                    authorization,
                )
                .map_err(infrastructure::attendance_error)?;
                infrastructure::save_roster_day(pool, &day).await?;
                written += 1;
            }
        }
    }

    Ok(json!({
        "week": week_from,
        "source_week": source_from,
        "units": units.len(),
        "written": written,
        "without_source_plan": without_source,
        "skipped_closed_period": skipped_closed
    }))
}

// ── nudges ───────────────────────────────────────────────────────────────

pub async fn run_contract_nudges(
    pool: &PgPool,
    on: NaiveDate,
) -> Result<SchedulerJobResult, AppError> {
    let before = on + Duration::days(schedule::CONTRACT_WARN_DAYS);
    let contracts = infrastructure::expiring_contracts(pool, on, before, None).await?;
    let mut raised = 0usize;
    let mut skipped = 0usize;

    for contract in contracts {
        let days = contract.days_remaining;
        let band = if days < 0 {
            "ENDED"
        } else if days <= schedule::CONTRACT_URGENT_DAYS {
            "URGENT"
        } else {
            "SOON"
        };
        // One notice per person per expiry date per band: crossing into the
        // urgent band is a second, different piece of work, and a contract
        // already ended is a third.
        let run_key = format!(
            "contract:{}:{}:{}",
            contract.employee_id,
            contract.ends_on.format("%Y-%m-%d"),
            band
        );
        if !claim_run(pool, schedule::jobs::CONTRACT_NUDGE, &run_key).await? {
            skipped += 1;
            continue;
        }
        let title = match band {
            "ENDED" => "A contract has already ended",
            "URGENT" => "A contract ends within two weeks",
            _ => "A contract ends within six weeks",
        };
        let body = format!(
            "{} {} — {} — term ends {}{}.",
            contract.employee_code,
            contract.full_name.as_deref().unwrap_or(""),
            contract.position,
            contract.ends_on,
            if days < 0 {
                format!(" ({} days ago)", -days)
            } else {
                format!(" ({days} days)")
            }
        );
        if let Err(error) = raise_for_unit(
            pool,
            contract.unit_id.as_deref(),
            schedule::kinds::CONTRACT_NUDGE,
            title,
            &body,
            Some(("employee", contract.employee_id.clone())),
        )
        .await
        {
            // Left claimed as RAN, this person's notice would never be raised:
            // the next tick would find the period already worked.
            let _ = finish_run(
                pool,
                schedule::jobs::CONTRACT_NUDGE,
                &run_key,
                "FAILED",
                json!({ "employee": contract.employee_id, "error": error.to_string() }),
            )
            .await;
            return Err(error);
        }
        finish_run(
            pool,
            schedule::jobs::CONTRACT_NUDGE,
            &run_key,
            "RAN",
            json!({ "employee": contract.employee_id, "days": days, "band": band }),
        )
        .await?;
        raised += 1;
    }

    Ok(SchedulerJobResult {
        job: schedule::jobs::CONTRACT_NUDGE.to_owned(),
        status: "RAN".to_owned(),
        detail: json!({ "raised": raised, "skipped": skipped }),
    })
}

pub async fn run_period_nudges(
    pool: &PgPool,
    on: NaiveDate,
) -> Result<SchedulerJobResult, AppError> {
    let Some(month_end) = schedule::month_awaiting_close(on) else {
        return Ok(SchedulerJobResult {
            job: schedule::jobs::PERIOD_NUDGE.to_owned(),
            status: "SKIPPED".to_owned(),
            detail: json!({ "reason": "the month being worked is not late yet" }),
        });
    };
    let month_first = month_end
        .with_day(1)
        .ok_or_else(|| AppError::Configuration("a month end without a first day".to_owned()))?;
    let run_key = schedule::month_key("period", month_first);
    claimed(
        pool,
        schedule::jobs::PERIOD_NUDGE,
        &run_key,
        period_nudge_work(pool, month_first),
    )
    .await
}

async fn period_nudge_work(pool: &PgPool, month_first: NaiveDate) -> Result<Value, AppError> {
    let postings = active_postings(pool).await?;
    let units = units_of(&postings);
    let closed: BTreeSet<String> = sqlx::query_scalar(
        "SELECT unit_id FROM attendance_period WHERE period = $1 AND status = 'CLOSED'",
    )
    .bind(month_first)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();

    let month = month_first.format("%Y-%m").to_string();
    let mut raised = 0usize;
    for (unit_id, (name, _employees)) in &units {
        if closed.contains(unit_id) {
            continue;
        }
        let unit_name = name.clone().unwrap_or_else(|| unit_id.clone());
        let body = format!(
            "Attendance at {unit_name} for {month} is still open, so its facts are still moving. \
             Close it before its payroll can be built."
        );
        raise_for_unit(
            pool,
            Some(unit_id.as_str()),
            schedule::kinds::PERIOD_NUDGE,
            "Attendance for a month is still open",
            &body,
            None,
        )
        .await?;
        raised += 1;
    }
    Ok(json!({ "month": month, "units": units.len(), "raised": raised }))
}

pub async fn run_roster_gap_nudges(
    pool: &PgPool,
    on: NaiveDate,
) -> Result<SchedulerJobResult, AppError> {
    let (week_from, week_to) = schedule::next_week(on);
    let key = schedule::week_key("roster_gap", week_from);
    claimed(
        pool,
        schedule::jobs::ROSTER_NUDGE,
        &key,
        roster_gap_work(pool, week_from, week_to),
    )
    .await
}

async fn roster_gap_work(
    pool: &PgPool,
    week_from: NaiveDate,
    week_to: NaiveDate,
) -> Result<Value, AppError> {
    let postings = active_postings(pool).await?;
    let units = units_of(&postings);
    let planned: BTreeSet<String> = sqlx::query_scalar(
        "SELECT employee_id FROM roster_day WHERE on_date >= $1 AND on_date <= $2",
    )
    .bind(week_from)
    .bind(week_to)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();

    let mut raised = 0usize;
    let mut gaps = 0usize;
    for (unit_id, (name, employees)) in &units {
        let missing: Vec<&String> = employees
            .iter()
            .filter(|employee| !planned.contains(employee.as_str()))
            .collect();
        if missing.is_empty() {
            continue;
        }
        let unit_name = name.clone().unwrap_or_else(|| unit_id.clone());
        let people = if missing.len() == 1 {
            "1 person has".to_owned()
        } else {
            format!("{} people have", missing.len())
        };
        let body = format!(
            "{people} no roster at {unit_name} for the week starting {week_from}. \
             A day nobody planned cannot be an absence and cannot be paid."
        );
        raise_for_unit(
            pool,
            Some(unit_id),
            schedule::kinds::ROSTER_NUDGE,
            "Next week still has unplanned people",
            &body,
            None,
        )
        .await?;
        raised += 1;
        gaps += missing.len();
    }
    Ok(json!({ "week": week_from, "units": units.len(), "raised": raised, "people": gaps }))
}

/// Resolve who hears a nudge, in their own transaction, and write nothing when
/// nobody is there to hear it.
///
/// The place half is [`infrastructure::recipients_with_role_at`]: a store's
/// notice goes to the supervisors posted to that store, plus head office. A
/// nudge with no recipient is not a failed nudge — it is a place nobody is
/// posted to, and the run ledger's detail says so rather than a notification
/// nobody can clear.
async fn raise_for_unit(
    pool: &PgPool,
    unit: Option<&str>,
    kind: &str,
    title: &str,
    body: &str,
    subject: Option<(&str, String)>,
) -> Result<(), AppError> {
    let mut tx: Transaction<'_, Postgres> = pool.begin().await?;
    let recipients = match unit {
        Some(unit) => {
            infrastructure::recipients_with_role_at(&mut tx, &["SUPERVISOR", "ADMIN"], unit).await?
        }
        None => infrastructure::recipients_with_role(&mut tx, &["ADMIN"]).await?,
    };
    let _: Option<uuid::Uuid> = infrastructure::raise_notification(
        &mut tx,
        NewNotification {
            kind,
            title: title.to_owned(),
            body: body.to_owned(),
            subject,
            origin_id: None,
            payload: json!({ "source": SCHEDULER_ACTOR }),
        },
        &recipients,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}
