-- 0138: The depreciation run stops waiting to be remembered.
--
-- # What was missing
--
-- 0070 wrote the arithmetic and 0083 gave the entries their own kind, and both
-- assumed somebody would press the button. Nothing ever calls
-- `run_depreciation` unless a person opens the screen: the seed script does it
-- four times and then never again. A month that nobody runs looks exactly like
-- a month in which nothing was due — `asset_depreciation_entry` has no row
-- either way — so the failure mode is silence, and it is discovered when
-- somebody reads a profit and loss with no depreciation in it, or when a
-- disposal is refused four months later because the run "still owes it a
-- charge".
--
-- The scheduler itself is Rust, beside the catalogue publisher and the auth
-- lease refresher, which is where this node already keeps the work that
-- happens because time passed. What the schema owes it is two things it cannot
-- keep in memory: a record that an attempt happened, and enough of its outcome
-- to tell "ran, nothing was due" from "never ran".
--
-- # Why a log of ATTEMPTS and not a status per month
--
-- A "months completed" table would be one row per month with a flag, and it
-- would be a lie the first time an asset is capitalised late: the month was
-- run, correctly, and now owes a charge it did not owe then. The flag would say
-- done and the register would disagree.
--
-- So this records attempts — who asked, when, what happened — and the QUESTION
-- "is this month complete" is answered from the register itself, by asking
-- every capitalised asset whether it is owed a charge. The log says what has
-- been tried; the register says what is true. Where the two disagree, the
-- register wins, and the log is how somebody finds out why.
--
-- # Why failures are rows too
--
-- The run posts asset by asset, each in its own transaction, so one asset whose
-- category is unmapped does not roll back the ninety that worked. That is the
-- right behaviour and it is also the one that hides: the endpoint returns a
-- list a person reads once, and by the next morning the only evidence that
-- eleven assets were refused is that their entries are absent. `failed_count`
-- and `note` are that evidence.

CREATE TABLE asset_depreciation_run (
    run_id       uuid PRIMARY KEY,
    -- The month charged, named by its first day — the same key
    -- `asset_depreciation_entry.period_month` uses, so the two join without a
    -- date function in the middle.
    period_month date NOT NULL CHECK (EXTRACT(DAY FROM period_month) = 1),

    started_at   timestamptz NOT NULL DEFAULT now(),
    -- NULL while a run is in flight, and NULL forever on one that died. A run
    -- with no finish is not a run that posted nothing; it is a run nobody can
    -- account for, and the difference matters at year end.
    finished_at  timestamptz,

    posted_count       integer NOT NULL DEFAULT 0 CHECK (posted_count >= 0),
    posted_total_minor bigint  NOT NULL DEFAULT 0 CHECK (posted_total_minor >= 0),
    skipped_count      integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
    -- Assets the run reached and could not charge: an unmapped category, a
    -- closed month, an account somebody retired. Not the same as skipped, which
    -- is the arithmetic correctly deciding there is nothing to charge.
    failed_count       integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),

    -- `system:month-end` for the scheduled run, a username for a person's. One
    -- column rather than a boolean, because "which of the two" is a question
    -- somebody asks about a specific run and "was it automatic" is not.
    triggered_by text NOT NULL CHECK (btrim(triggered_by) <> ''),
    -- The first few refusals, verbatim. A count says eleven assets failed; this
    -- says they all failed for the same missing mapping.
    note         text
);
-- The read is always "the runs for this month, newest first".
CREATE INDEX ix_asset_depreciation_run_period
    ON asset_depreciation_run (period_month DESC, started_at DESC);

COMMENT ON TABLE asset_depreciation_run IS
    'One row per ATTEMPT to charge a month, not one per completed month. Whether a month is actually complete is asked of the register; this says what has been tried and what came of it.';
COMMENT ON COLUMN asset_depreciation_run.failed_count IS
    'Assets the run reached and could not charge. Distinct from skipped, which is the arithmetic correctly finding nothing to charge.';
