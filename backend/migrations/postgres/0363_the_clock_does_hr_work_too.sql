-- 0363: The clock does HR work too, and keeps a ledger of what it ran.
--
-- Four things in this system are driven by the date rather than by a person,
-- and until now nothing was driving them:
--
--   * the annual or monthly entitlement the leave kernel already knows how to
--     compute (`LeavePolicy::accrued_by_month`) — with nothing writing the
--     ACCRUAL entry, a policy of twelve days paid out nought;
--   * the carry-forward expiry sweep (`LedgerTimeline::expiry_due`), which
--     hands back the entry it is due and waits for somebody to store it;
--   * next week's roster, which a shop must have before the week starts
--     because an unplanned day cannot be an absence and cannot be paid;
--   * the nudges — a contract about to end, a month nobody closed.
--
-- # Why a run ledger rather than a "last run" column
--
-- The obvious shape is a `last_run_at` per job, and it is wrong in two ways
-- that both bite in production. A column cannot express "this job has already
-- run for the week of the 5th" — only "it ran at some point" — so a crash
-- between the work and the stamp either runs it twice or never runs it again.
-- And an operator cannot answer "did the expiry sweep run on 31 March?" from a
-- single timestamp at all.
--
-- So a run is a row keyed by what the run was FOR, not when it happened: a
-- day, a month, a week. Claiming the row is the mutex — `ON CONFLICT DO
-- NOTHING` returning a row means this job has not done this period yet, and a
-- second worker racing for the same period loses. `outcome` and `detail` are
-- what the last attempt did and what refused it, so the screen that shows the
-- schedule can be honest about a job that ran and failed.
CREATE TABLE scheduled_job_run (
    job        text NOT NULL CHECK (btrim(job) <> ''),
    -- What the run was for: `day:2026-09-25`, `month:2026-09`, `week:2026-09-28`.
    -- A period key rather than a timestamp, because that is the thing being
    -- claimed and the thing an operator asks about.
    run_key    text NOT NULL CHECK (btrim(run_key) <> ''),
    outcome    text NOT NULL CHECK (outcome IN ('RAN', 'FAILED', 'SKIPPED')),
    -- What it did: counts, ids it wrote, and the sentence a refusal said.
    detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    PRIMARY KEY (job, run_key)
);

-- The screen lists the newest runs across all jobs.
CREATE INDEX ix_scheduled_job_run_started ON scheduled_job_run (started_at DESC);

COMMENT ON TABLE scheduled_job_run IS
    'One row per (job, period) the scheduler has claimed. The primary key is '
    'the mutex: a period is worked once, by whichever worker claims it first.';

-- The three things the clock can tell a person. A notification kind is a
-- closed set (0046, 0125, 0217): the browser routes on it, so adding one is a
-- migration rather than a string a job happened to write.
--
-- These are raised by a PASS rather than by a request — the shape 0218 argues
-- for — and each is claimed once per (person, period), so a contract that is
-- still ending tomorrow does not become tomorrow's news again.
ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check
    CHECK (kind IN (
        'activity',
        'purchase.price_amendment.requested',
        'purchase.delivery.due_soon',
        'receipt.awaiting_identity',
        'receipt.excess_awaiting_decision',
        'finance.integrity.exception',
        'discussion.thread.opened',
        'discussion.thread.replied',
        'asset.assessment.overdue',
        'people.contract.expiring',
        'people.period.month_open',
        'people.roster.gap'
    ));
