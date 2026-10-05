-- 0703: A background job keeps every run, and can be paused or asked to run.
--
-- # What there was
--
-- About twenty loops in `bin/cloud.rs` — a sweep a minute, a posting pass a
-- minute, month-end charges hourly — each a `tokio::spawn` of an interval and
-- a body that logged its failures and carried on. Two of them wrote a line to
-- `fleet_job_beat` (0640) so the fleet page could tell a stopped loop from an
-- idle one; the rest said what went wrong only to a server log nobody reads.
-- A goods receipt that could not post because an account was unmapped was a
-- `warn!` at 02:00 and nothing else.
--
-- # What there is
--
-- `job_definition`: one row per job — what it is called, how often it runs,
-- whether somebody paused it or asked for it to run now, and how its last
-- pass went. It replaces `fleet_job_beat`, whose rows it carries over; the
-- fleet page reads its beats from here.
--
-- `job_run`: a row per pass that did something, failed, or was asked for by a
-- person — an idle pass of a minute job is a heartbeat on the definition, not
-- 1,440 rows a day. What a run could not do is kept as its problems, in the
-- job's own words, so "3 goods receipts await correction: unmapped account
-- 5110" is on a screen rather than in a log.
--
-- ERPNext keeps the same pair (Scheduled Job Type, Scheduled Job Log). A
-- failed run is retried sooner than the next tick, backing off; see
-- `cloud::jobs`.

CREATE TABLE job_definition (
    job                  text PRIMARY KEY CHECK (job ~ '^[a-z][a-z0-9_.]{1,63}$'),
    label                text NOT NULL CHECK (btrim(label) <> ''),
    -- NULL for a loop that runs continuously rather than on a timer (applying
    -- what the stores sent, Web Push): it beats, it cannot be scheduled.
    every_seconds        integer CHECK (every_seconds IS NULL OR every_seconds > 0),
    paused               boolean NOT NULL DEFAULT false,
    paused_by            text,
    paused_at            timestamptz,
    run_requested_at     timestamptz,
    run_requested_by     text,
    last_run_at          timestamptz,
    last_ok_at           timestamptz,
    last_error           text CHECK (last_error IS NULL OR length(last_error) <= 500),
    last_error_at        timestamptz,
    consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    runs                 bigint NOT NULL DEFAULT 0 CHECK (runs >= 0),
    CONSTRAINT job_definition_paused_says_who CHECK (NOT paused OR paused_by IS NOT NULL)
);

COMMENT ON TABLE job_definition IS
    'Head office''s background jobs: schedule, pause, run-now requests and the last pass (0703).';

INSERT INTO job_definition
    (job, label, last_run_at, last_ok_at, last_error, last_error_at, runs)
SELECT b.job,
       CASE b.job
           WHEN 'sync_apply' THEN 'Apply what the stores sent'
           WHEN 'postings'   THEN 'Automatic postings'
           WHEN 'push'       THEN 'Web Push'
           WHEN 'brief'      THEN 'Morning brief'
           WHEN 'exceptions' THEN 'Store exceptions sweep'
           ELSE b.job
       END,
       b.last_run_at, b.last_ok_at, b.last_error, b.last_error_at, b.runs
  FROM fleet_job_beat b;

CREATE TABLE job_run (
    run_id      bigserial PRIMARY KEY,
    job         text NOT NULL REFERENCES job_definition (job) ON UPDATE CASCADE ON DELETE CASCADE,
    trigger     text NOT NULL CHECK (trigger IN ('SCHEDULE', 'RETRY', 'MANUAL')),
    -- Who asked, for a MANUAL run.
    requested_by text,
    attempt     integer NOT NULL DEFAULT 1 CHECK (attempt >= 1),
    started_at  timestamptz NOT NULL,
    finished_at timestamptz NOT NULL DEFAULT now(),
    status      text NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED')),
    -- How many things the pass did: documents posted, notices raised.
    did         bigint NOT NULL DEFAULT 0 CHECK (did >= 0),
    problems    text[] NOT NULL DEFAULT '{}',
    notes       jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT job_run_failed_says_why CHECK (status = 'SUCCEEDED' OR cardinality(problems) > 0),
    CONSTRAINT job_run_manual_says_who CHECK (trigger <> 'MANUAL' OR requested_by IS NOT NULL)
);

CREATE INDEX ix_job_run_job ON job_run (job, finished_at DESC);

COMMENT ON TABLE job_run IS
    'One row per pass that did something, failed, or was asked for; 30 days are kept (0703).';

DROP TABLE fleet_job_beat;
