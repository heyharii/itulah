-- 0123: Whether the books reconcile, asked on a schedule and written down.
--
-- # Why a run is a row
--
-- The engine's answer changes every night, and the interesting question is
-- almost never "what does it say now". It is "when did this start", which
-- nobody can answer from a screen that only holds the latest figure. So each
-- evaluation is a run, every check's answer is filed under it, and the history
-- of one control equation is a query rather than an archaeology.
--
-- It also means a run is reproducible evidence. `as_of` is the date the
-- equations were asked about, which is deliberately not `started_at`: a run
-- launched at one in the morning is asking about yesterday, and a table that
-- conflated the two would make every month-end figure a day wrong.
--
-- # What this table is not
--
-- It is not a second ledger and it holds no postings. Nothing in this migration
-- may ever be summed into a financial statement: these are the results of
-- comparing the three ledgers with each other and with the registers around
-- them, and a comparison that got into the thing it compares would be its own
-- worst kind of circular.

CREATE TABLE integrity_run (
    run_id      uuid PRIMARY KEY,

    -- The date the equations were asked about. Not when they were asked.
    as_of       date NOT NULL,

    started_at  timestamptz NOT NULL DEFAULT now(),
    -- Null while it is running. A run that never finished is a run that
    -- crashed, and that is worth being able to see rather than inferring from
    -- a gap in the dates.
    finished_at timestamptz,

    -- SCHEDULED is the nightly agent; MANUAL is somebody pressing the button
    -- because they are closing a month and will not wait until tomorrow.
    trigger     text NOT NULL CHECK (trigger IN ('MANUAL', 'SCHEDULED')),
    -- The person, or `system:integrity`.
    started_by  text NOT NULL CHECK (btrim(started_by) <> ''),

    -- The worst state any of its results reached, so a fleet screen can rank
    -- runs without reading every result. Written when the run finishes, which
    -- is why it is nullable.
    worst_state text CHECK (worst_state IN ('BALANCED', 'PENDING', 'EXCEPTION', 'BLOCKED')),

    -- Set when the run itself failed, as opposed to finding something wrong.
    -- The two are different facts and a screen that showed them the same way
    -- would report a broken engine as a clean set of books.
    failure     text,

    CHECK ((finished_at IS NULL) OR (worst_state IS NOT NULL OR failure IS NOT NULL))
);

CREATE INDEX ix_integrity_run_as_of ON integrity_run (as_of DESC, started_at DESC);
CREATE INDEX ix_integrity_run_started ON integrity_run (started_at DESC);

-- One control equation's answer, in one run.
--
-- `expected` is what the business records say; `actual` is what the ledger
-- holds. Kept as two columns and not one difference, because "we are 3,000,000
-- apart" is a question and "the Payment Ledger says 8,600,000 and the General
-- Ledger says 5,600,000" is halfway to an answer.
CREATE TABLE integrity_result (
    result_id        uuid PRIMARY KEY,
    run_id           uuid NOT NULL REFERENCES integrity_run(run_id) ON DELETE CASCADE,

    -- The check's stable name, e.g. `payment_ledger.control_accounts`. Free
    -- text and not a CHECK list: the registry is a Rust list that other lanes
    -- register into, and a migration per new equation would make adding one a
    -- two-repository act.
    key              text NOT NULL CHECK (btrim(key) <> ''),

    -- `GROUP` for a company-wide equation, otherwise a `site.id`. Stored as the
    -- site id itself rather than `SITE:<id>`, so the same string keys the
    -- attention item and filters the store feed.
    scope            text NOT NULL CHECK (btrim(scope) <> ''),

    state            text NOT NULL CHECK (state IN ('BALANCED', 'PENDING', 'EXCEPTION', 'BLOCKED')),

    expected_minor   bigint NOT NULL DEFAULT 0,
    actual_minor     bigint NOT NULL DEFAULT 0,
    -- Stored rather than computed on read, and checked, so that a row and the
    -- sentence written beside it can never disagree about which way it points.
    difference_minor bigint NOT NULL DEFAULT 0,

    -- `{ "summary": "...", "rows": [...] }`. The summary is the sentence a
    -- person reads, written when the facts were in hand; the rows are what the
    -- two figures were summed from.
    details          jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- What could be done about it, as a list of `{verb, target_kind,
    -- target_id, label}`. This is what the attention feed is minted from.
    suggested_actions jsonb NOT NULL DEFAULT '[]'::jsonb,

    evaluated_at     timestamptz NOT NULL DEFAULT now(),

    CHECK (difference_minor = expected_minor - actual_minor),
    -- One answer per equation per scope per run. A check that answered twice in
    -- one run would make its own history unreadable.
    UNIQUE (run_id, key, scope)
);

CREATE INDEX ix_integrity_result_key ON integrity_result (key, evaluated_at DESC);
CREATE INDEX ix_integrity_result_open ON integrity_result (state, evaluated_at DESC)
    WHERE state IN ('EXCEPTION', 'BLOCKED');

COMMENT ON TABLE integrity_run IS
    'One evaluation of every control equation. as_of is the date asked about, '
    'never the moment it was asked.';
COMMENT ON TABLE integrity_result IS
    'One control equation''s answer in one run. Never summed into a financial '
    'statement: these compare the statements, they do not belong in them.';
COMMENT ON COLUMN integrity_result.scope IS
    'GROUP, or a site.id — the same string the attention item is keyed and '
    'filtered on.';
