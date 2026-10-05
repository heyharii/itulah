//! Head office's background jobs, as rows (0703).
//!
//! The runtime that drives them is `cloud::jobs`; this module is what it
//! reads and writes, and what the System screen reads. Every function here is
//! cheap enough to be called on every tick of a minute job.

use crate::cloud::application::AppError;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};

/// How many days of `job_run` are kept.
const KEEP_DAYS: i32 = 30;

/// A job the runtime is about to drive: written on start, so the screen lists
/// every job from the moment the server that runs it has booted.
pub async fn register_job(
    pool: &PgPool,
    job: &str,
    label: &str,
    every_seconds: Option<i32>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO job_definition (job, label, every_seconds) VALUES ($1, $2, $3)
         ON CONFLICT (job) DO UPDATE SET label = EXCLUDED.label,
                                         every_seconds = EXCLUDED.every_seconds",
    )
    .bind(job)
    .bind(label)
    .bind(every_seconds)
    .execute(pool)
    .await?;
    Ok(())
}

/// Take a person's "run now", if there is one. Returns who asked.
pub async fn take_run_request(pool: &PgPool, job: &str) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar::<_, Option<String>>(
        "WITH taken AS (
             SELECT job, run_requested_by FROM job_definition
              WHERE job = $1 AND run_requested_at IS NOT NULL
                FOR UPDATE
         )
         UPDATE job_definition d
            SET run_requested_at = NULL, run_requested_by = NULL
           FROM taken
          WHERE d.job = taken.job
      RETURNING taken.run_requested_by",
    )
    .bind(job)
    .fetch_optional(pool)
    .await?
    .map(|who| who.unwrap_or_else(|| "someone".to_owned())))
}

pub async fn job_paused(pool: &PgPool, job: &str) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar::<_, bool>("SELECT paused FROM job_definition WHERE job = $1")
            .bind(job)
            .fetch_optional(pool)
            .await?
            .unwrap_or(false),
    )
}

/// Only one server runs a job at a time: a session advisory lock keyed on the
/// job's name, held on its own connection for the length of the pass.
pub async fn try_lock_job(
    pool: &PgPool,
    job: &str,
) -> Result<Option<sqlx::pool::PoolConnection<sqlx::Postgres>>, AppError> {
    let mut connection = pool.acquire().await?;
    let locked: bool =
        sqlx::query_scalar("SELECT pg_try_advisory_lock(hashtextextended('job:' || $1, 0))")
            .bind(job)
            .fetch_one(&mut *connection)
            .await?;
    Ok(locked.then_some(connection))
}

pub async fn unlock_job(
    mut connection: sqlx::pool::PoolConnection<sqlx::Postgres>,
    job: &str,
) -> Result<(), AppError> {
    sqlx::query("SELECT pg_advisory_unlock(hashtextextended('job:' || $1, 0))")
        .bind(job)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

/// The database's clock, for a run's start. The runtime keeps no wall clock of
/// its own (`tests/clock_authority.rs`).
pub async fn database_now(pool: &PgPool) -> Result<DateTime<Utc>, AppError> {
    Ok(sqlx::query_scalar("SELECT now()").fetch_one(pool).await?)
}

/// A loop finished a pass. For the loops that run continuously rather than on
/// a timer (applying what the stores sent, Web Push, the morning brief): the
/// heartbeat the fleet page reads. Never fails the loop: a beat that cannot be
/// written is logged and forgotten.
pub async fn job_beat(pool: &PgPool, job: &str, error: Option<&str>) {
    let error = error.map(|text| text.chars().take(500).collect::<String>());
    let result = sqlx::query(
        "INSERT INTO job_definition
             (job, label, last_run_at, last_ok_at, last_error, last_error_at, runs,
              consecutive_failures)
         VALUES ($1, $1, now(), CASE WHEN $2::text IS NULL THEN now() END, $2,
                 CASE WHEN $2::text IS NOT NULL THEN now() END, 1,
                 CASE WHEN $2::text IS NULL THEN 0 ELSE 1 END)
         ON CONFLICT (job) DO UPDATE SET
             last_run_at = EXCLUDED.last_run_at,
             last_ok_at = COALESCE(EXCLUDED.last_ok_at, job_definition.last_ok_at),
             last_error = COALESCE(EXCLUDED.last_error, job_definition.last_error),
             last_error_at = COALESCE(EXCLUDED.last_error_at, job_definition.last_error_at),
             consecutive_failures = CASE WHEN $2::text IS NULL THEN 0
                                         ELSE job_definition.consecutive_failures + 1 END,
             runs = job_definition.runs + 1",
    )
    .bind(job)
    .bind(error)
    .execute(pool)
    .await;
    if let Err(error) = result {
        tracing::debug!(%error, job, "a job beat was not written down");
    }
}

/// One finished pass, as the runtime hands it over.
#[derive(Clone, Debug)]
pub struct FinishedRun<'a> {
    pub job: &'a str,
    /// `SCHEDULE`, `RETRY` or `MANUAL`.
    pub trigger: &'a str,
    pub requested_by: Option<&'a str>,
    pub attempt: i32,
    pub started_at: DateTime<Utc>,
    pub did: u64,
    pub problems: &'a [String],
    pub notes: &'a serde_json::Value,
}

/// Write a pass down: the definition's heartbeat always, a run row when the
/// pass did something, failed, or was asked for.
pub async fn finish_run(pool: &PgPool, run: FinishedRun<'_>) -> Result<(), AppError> {
    let failed = !run.problems.is_empty();
    let first_problem = run
        .problems
        .first()
        .map(|text| text.chars().take(500).collect::<String>());
    sqlx::query(
        "UPDATE job_definition SET
             last_run_at = now(),
             last_ok_at = CASE WHEN $2 THEN last_ok_at ELSE now() END,
             last_error = CASE WHEN $2 THEN $3 ELSE last_error END,
             last_error_at = CASE WHEN $2 THEN now() ELSE last_error_at END,
             consecutive_failures = CASE WHEN $2 THEN consecutive_failures + 1 ELSE 0 END,
             runs = runs + 1
         WHERE job = $1",
    )
    .bind(run.job)
    .bind(failed)
    .bind(first_problem.as_deref())
    .execute(pool)
    .await?;

    if run.did > 0 || failed || run.trigger == "MANUAL" {
        let runs: i64 = sqlx::query_scalar(
            "INSERT INTO job_run
                 (job, trigger, requested_by, attempt, started_at, status, did, problems, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING run_id",
        )
        .bind(run.job)
        .bind(run.trigger)
        .bind(run.requested_by)
        .bind(run.attempt)
        .bind(run.started_at)
        .bind(if failed { "FAILED" } else { "SUCCEEDED" })
        .bind(i64::try_from(run.did).unwrap_or(i64::MAX))
        .bind(run.problems)
        .bind(run.notes)
        .fetch_one(pool)
        .await?;
        // Prune now and then rather than on every run.
        if runs % 200 == 0 {
            sqlx::query("DELETE FROM job_run WHERE finished_at < now() - make_interval(days => $1)")
                .bind(KEEP_DAYS)
                .execute(pool)
                .await?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// The System screen
// ---------------------------------------------------------------------------

/// One job, as `GET /api/v1/system/jobs` lists it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JobStatus {
    pub job: String,
    pub label: String,
    /// `null` for a loop that runs continuously.
    pub every_seconds: Option<i32>,
    pub paused: bool,
    pub paused_by: Option<String>,
    /// A person asked for a run that has not started yet.
    pub run_requested: bool,
    #[cfg_attr(feature = "ts", ts(type = "string | null"))]
    pub last_run_at: Option<DateTime<Utc>>,
    #[cfg_attr(feature = "ts", ts(type = "string | null"))]
    pub last_ok_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    #[cfg_attr(feature = "ts", ts(type = "string | null"))]
    pub last_error_at: Option<DateTime<Utc>>,
    /// How many passes in a row have failed. Zero is healthy.
    pub consecutive_failures: i32,
    pub runs: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JobList {
    pub items: Vec<JobStatus>,
}

/// One pass of one job.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JobRunRow {
    pub run_id: i64,
    pub job: String,
    pub trigger: String,
    pub requested_by: Option<String>,
    pub attempt: i32,
    #[cfg_attr(feature = "ts", ts(type = "string"))]
    pub started_at: DateTime<Utc>,
    #[cfg_attr(feature = "ts", ts(type = "string"))]
    pub finished_at: DateTime<Utc>,
    /// `SUCCEEDED` or `FAILED`.
    pub status: String,
    pub did: i64,
    pub problems: Vec<String>,
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub notes: serde_json::Value,
}

fn to_status(row: &sqlx::postgres::PgRow) -> Result<JobStatus, AppError> {
    Ok(JobStatus {
        job: row.try_get("job")?,
        label: row.try_get("label")?,
        every_seconds: row.try_get("every_seconds")?,
        paused: row.try_get("paused")?,
        paused_by: row.try_get("paused_by")?,
        run_requested: row.try_get("run_requested")?,
        last_run_at: row.try_get("last_run_at")?,
        last_ok_at: row.try_get("last_ok_at")?,
        last_error: row.try_get("last_error")?,
        last_error_at: row.try_get("last_error_at")?,
        consecutive_failures: row.try_get("consecutive_failures")?,
        runs: row.try_get("runs")?,
    })
}

const STATUS_COLUMNS: &str = "job, label, every_seconds, paused, paused_by,
       run_requested_at IS NOT NULL AS run_requested, last_run_at, last_ok_at, last_error,
       last_error_at, consecutive_failures, runs";

/// Every job, failing ones first.
pub async fn list_jobs(pool: &PgPool) -> Result<JobList, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {STATUS_COLUMNS} FROM job_definition
          ORDER BY consecutive_failures > 0 DESC, label"
    ))
    .fetch_all(pool)
    .await?;
    Ok(JobList {
        items: rows.iter().map(to_status).collect::<Result<_, _>>()?,
    })
}

async fn job_status(pool: &PgPool, job: &str) -> Result<JobStatus, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {STATUS_COLUMNS} FROM job_definition WHERE job = $1"
    ))
    .bind(job)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("job {job}")))?;
    to_status(&row)
}

/// A job's recent passes, newest first.
pub async fn job_runs(pool: &PgPool, job: &str, limit: i64) -> Result<Vec<JobRunRow>, AppError> {
    let rows = sqlx::query(
        "SELECT run_id, job, trigger, requested_by, attempt, started_at, finished_at, status,
                did, problems, notes
           FROM job_run WHERE job = $1
          ORDER BY finished_at DESC, run_id DESC
          LIMIT $2",
    )
    .bind(job)
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(JobRunRow {
                run_id: row.try_get("run_id")?,
                job: row.try_get("job")?,
                trigger: row.try_get("trigger")?,
                requested_by: row.try_get("requested_by")?,
                attempt: row.try_get("attempt")?,
                started_at: row.try_get("started_at")?,
                finished_at: row.try_get("finished_at")?,
                status: row.try_get("status")?,
                did: row.try_get("did")?,
                problems: row.try_get("problems")?,
                notes: row.try_get("notes")?,
            })
        })
        .collect()
}

/// Ask for a job to run as soon as the server that runs it next looks —
/// within fifteen seconds. A continuous loop cannot be asked.
pub async fn request_job_run(pool: &PgPool, job: &str, actor: &str) -> Result<JobStatus, AppError> {
    let status = job_status(pool, job).await?;
    if status.every_seconds.is_none() {
        return Err(AppError::Conflict(format!(
            "{} runs continuously; there is no pass to ask for",
            status.label
        )));
    }
    sqlx::query(
        "UPDATE job_definition SET run_requested_at = now(), run_requested_by = $2 WHERE job = $1",
    )
    .bind(job)
    .bind(actor)
    .execute(pool)
    .await?;
    job_status(pool, job).await
}

/// Pause a job, or let it run again. A paused job still runs when a person
/// asks it to: pausing stops the schedule, not the person.
pub async fn set_job_paused(
    pool: &PgPool,
    job: &str,
    paused: bool,
    actor: &str,
) -> Result<JobStatus, AppError> {
    let status = job_status(pool, job).await?;
    if status.every_seconds.is_none() {
        return Err(AppError::Conflict(format!(
            "{} runs continuously and cannot be paused from here",
            status.label
        )));
    }
    sqlx::query(
        "UPDATE job_definition
            SET paused = $2,
                paused_by = CASE WHEN $2 THEN $3 END,
                paused_at = CASE WHEN $2 THEN now() END
          WHERE job = $1",
    )
    .bind(job)
    .bind(paused)
    .bind(actor)
    .execute(pool)
    .await?;
    job_status(pool, job).await
}
