//! The runtime that drives head office's background jobs (0703).
//!
//! # What a job is here
//!
//! A [`Job`] — a name, a label, how often — and a body: an async function
//! handed a [`Pass`] to fill in and give back. The body does what the old loop
//! body did, and says what it did (`pass.did(n)`) and what it could not do
//! (`pass.problem(...)`) instead of only logging it. The runtime does the rest:
//!
//! * **schedule** — the first pass at start, then one every `every`;
//! * **run now** — a person's request (`POST /api/v1/system/jobs/{job}/run`)
//!   is picked up within fifteen seconds, paused or not;
//! * **pause** — a paused job skips its schedule;
//! * **one at a time** — a session advisory lock per job, so two servers never
//!   run the same pass;
//! * **retry** — a pass with problems is tried again sooner than its next tick,
//!   backing off from a minute and never later than the tick itself;
//! * **a record** — `job_definition` is the heartbeat, and `job_run` keeps
//!   every pass that did something, failed or was asked for;
//! * **a panic is a failure** — the body runs in its own task, so a panic is
//!   written down as the pass's problem rather than ending the loop for good.
//!
//! # Why the body keeps its log lines
//!
//! The rows are what a person reads on the System screen; the log is what an
//! engineer reads when that is not enough. Both, not either.

use crate::cloud::postgres::jobs as store;
use serde::Serialize;
use sqlx::PgPool;
use std::future::Future;
use std::time::Duration;
use tokio::time::Instant;
use tracing::{info, warn};

/// How often a sleeping job looks for a person's "run now".
const LISTEN: Duration = Duration::from_secs(15);
/// The first retry of a failed pass; each further one doubles.
const FIRST_RETRY: Duration = Duration::from_secs(60);

/// One job the runtime drives.
#[derive(Clone, Copy, Debug)]
pub struct Job {
    /// `job_definition.job`: lower-case, dots and underscores.
    pub key: &'static str,
    pub label: &'static str,
    pub every: Duration,
}

/// What one pass did, filled in by the body.
#[derive(Debug, Default)]
pub struct Pass {
    did: u64,
    problems: Vec<String>,
    notes: serde_json::Map<String, serde_json::Value>,
}

impl Pass {
    /// Count things the pass did: documents posted, notices raised.
    pub fn did(&mut self, count: u64) {
        self.did = self.did.saturating_add(count);
    }

    /// Something the pass could not do, in words a person can act on.
    pub fn problem(&mut self, text: impl Into<String>) {
        self.problems.push(text.into());
    }

    /// A figure worth keeping beside the run: which month was charged, how
    /// many receipts are waiting.
    pub fn note(&mut self, key: &str, value: impl Serialize) {
        if let Ok(value) = serde_json::to_value(value) {
            self.notes.insert(key.to_owned(), value);
        }
    }

    pub fn failed(&self) -> bool {
        !self.problems.is_empty()
    }

    /// The first problem, if any — for a heartbeat that has room for one.
    pub fn first_problem(&self) -> Option<&str> {
        self.problems.first().map(String::as_str)
    }
}

/// Start driving a job. Returns at once; the job runs on its own task for the
/// life of the process.
pub fn spawn<F, Fut>(pool: PgPool, job: Job, body: F)
where
    F: Fn(PgPool, Pass) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Pass> + Send + 'static,
{
    tokio::spawn(drive(pool, job, body));
}

async fn drive<F, Fut>(pool: PgPool, job: Job, body: F)
where
    F: Fn(PgPool, Pass) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Pass> + Send + 'static,
{
    let every_seconds = i32::try_from(job.every.as_secs()).unwrap_or(i32::MAX).max(1);
    if let Err(error) = store::register_job(&pool, job.key, job.label, Some(every_seconds)).await {
        warn!(%error, job = job.key, "a job could not be registered; it runs unrecorded until it can");
    }
    info!(job = job.key, seconds = job.every.as_secs(), "{} started", job.label);

    let mut due = Instant::now();
    let mut failures: u32 = 0;
    loop {
        let now = Instant::now();
        if due > now {
            tokio::time::sleep((due - now).min(LISTEN)).await;
        }

        let requested_by = store::take_run_request(&pool, job.key).await.unwrap_or_else(|error| {
            warn!(%error, job = job.key, "could not read the job's run requests");
            None
        });
        let is_due = Instant::now() >= due;
        if requested_by.is_none() && !is_due {
            continue;
        }
        if requested_by.is_none() && store::job_paused(&pool, job.key).await.unwrap_or(false) {
            due = Instant::now() + job.every;
            continue;
        }

        let lock = match store::try_lock_job(&pool, job.key).await {
            Ok(Some(lock)) => lock,
            Ok(None) => {
                // Another server is running this pass.
                due = Instant::now() + job.every;
                continue;
            }
            Err(error) => {
                warn!(%error, job = job.key, "could not take the job's lock");
                due = Instant::now() + FIRST_RETRY.min(job.every);
                continue;
            }
        };

        let trigger = match (&requested_by, failures) {
            (Some(_), _) => "MANUAL",
            (None, 0) => "SCHEDULE",
            (None, _) => "RETRY",
        };
        let started_at = store::database_now(&pool).await.ok();
        let pass = match tokio::spawn(body(pool.clone(), Pass::default())).await {
            Ok(pass) => pass,
            Err(error) => {
                let mut pass = Pass::default();
                pass.problem(format!("the pass stopped part-way: {error}"));
                pass
            }
        };
        if let Err(error) = store::unlock_job(lock, job.key).await {
            warn!(%error, job = job.key, "could not release the job's lock");
        }

        if let Some(started_at) = started_at {
            let problems = pass.problems.clone();
            let notes = serde_json::Value::Object(pass.notes.clone());
            let recorded = store::finish_run(
                &pool,
                store::FinishedRun {
                    job: job.key,
                    trigger,
                    requested_by: requested_by.as_deref(),
                    attempt: i32::try_from(failures.saturating_add(1)).unwrap_or(i32::MAX),
                    started_at,
                    did: pass.did,
                    problems: &problems,
                    notes: &notes,
                },
            )
            .await;
            if let Err(error) = recorded {
                warn!(%error, job = job.key, "a job run was not written down");
            }
        }

        if pass.failed() {
            failures = failures.saturating_add(1);
            let backoff = FIRST_RETRY
                .saturating_mul(2u32.saturating_pow(failures.saturating_sub(1).min(10)))
                .min(job.every);
            warn!(
                job = job.key,
                failures,
                retry_in = backoff.as_secs(),
                problem = pass.first_problem().unwrap_or(""),
                "{} had problems",
                job.label
            );
            due = Instant::now() + backoff;
        } else {
            failures = 0;
            due = Instant::now() + job.every;
        }
    }
}
