-- Head office writes down when its own background jobs last ran.
--
-- The fleet status page has a row for head office itself (owner's decision
-- of 28 Sep 2026): the cloud API and database, and the background jobs the
-- stores depend on without seeing them — applying what the stores sent,
-- the automatic postings (a sales day, a goods receipt, a flow's held
-- postings), notifications and Web Push, and the assistant's morning brief.
--
-- Most of that can be read off the data: a stream whose applied watermark
-- lags its received one, a flow posting held with a reason, a push delivery
-- due and not sent, a morning with no brief. What the data cannot say is
-- that a loop has stopped altogether — a job that never runs leaves exactly
-- the rows a job with nothing to do leaves. So each loop writes one line here
-- when it finishes a pass, and the fleet sweep reads how long ago that was.
--
-- One row per job, overwritten. A pass that failed keeps the last good one's
-- time beside its error.

CREATE TABLE fleet_job_beat (
    job           text PRIMARY KEY CHECK (job ~ '^[a-z][a-z0-9_.]{1,63}$'),
    last_run_at   timestamptz NOT NULL,
    last_ok_at    timestamptz,
    last_error    text CHECK (last_error IS NULL OR length(last_error) <= 500),
    last_error_at timestamptz,
    runs          bigint NOT NULL DEFAULT 1 CHECK (runs >= 1)
);

COMMENT ON TABLE fleet_job_beat IS
    'When each of head office''s background loops last finished a pass, and its last error (0640). Read by the fleet sweep for head office''s row.';
