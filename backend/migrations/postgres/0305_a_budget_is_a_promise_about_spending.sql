-- A budget is a promise about spending.
--
-- ERPNext carries `Budget` as a master (account × cost center × fiscal period,
-- with a warning or a stop at a percentage) and `budget_controller.py` makes
-- the poster ask. Ours is the same three questions answered in this estate's
-- own units: a SITE (the axis every balance here already answers), a category
-- or an account (the client's own two granularities — a family budget covers
-- forty electricity codes and one billboard), and a MONTH (the grain the books
-- close on, `fiscal_period` 0050).
--
-- # The enforcement is a policy, not a fact
--
-- ERPNext makes the threshold a choice per budget (warning at 60%, stop at
-- 90%); the client gets the same choice as a column, and the poster reads it
-- at posting time. Nothing in this migration refuses a posting — a budget
-- nobody has loaded must not brick the estate — which is also why there is
-- no NOT NULL on the action.
--
-- Amounts are minor units, like every other money column here. Revisions are
-- rows: a revised budget is a new promise with its own effective month, not
-- an edit of the old one — the ledger discipline (entries are facts) applied
-- to promises.

CREATE TABLE budget (
    budget_id   uuid PRIMARY KEY,
    site_id     text NOT NULL REFERENCES site (id),
    -- The spending being promised about: an account leaf, or a whole category
    -- family. Exactly one is named; a row that promises about nothing is
    -- noise, and a row that promises about both is two promises.
    account_code text,
    category_code text REFERENCES line_category (category_code),
    period_start date NOT NULL,
    period_end  date NOT NULL,
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    -- WARN  the poster notes the overrun and carries on
    -- STOP  the poster refuses until the budget moves or the posting does
    on_exceed text NOT NULL DEFAULT 'WARN' CHECK (on_exceed IN ('WARN', 'STOP')),
    -- The month this promise starts to answer for spending; revisions sit
    -- beside the promise they replace, never on top of it.
    effective_from date NOT NULL,
    superseded_by uuid REFERENCES budget (budget_id),
    set_by      text NOT NULL CHECK (btrim(set_by) <> ''),
    set_at      timestamptz NOT NULL DEFAULT now(),

    CHECK ((account_code IS NULL) <> (category_code IS NULL)),
    CHECK (period_end >= period_start)
);

-- One live promise per (site, what, month): a revision supersedes rather
-- than joins, so "what is the budget for electricity at store-01 in
-- September" is one row and one argument.
CREATE UNIQUE INDEX ux_budget_live
    ON budget (site_id,
               COALESCE(account_code, ''),
               COALESCE(category_code, ''),
               period_start)
    WHERE superseded_by IS NULL;

CREATE INDEX ix_budget_lookup ON budget (site_id, period_start, period_end)
    WHERE superseded_by IS NULL;

COMMENT ON TABLE budget IS
    'A spending promise per site, per account or category, per month — ERPNext''s Budget master at this estate''s grain. The poster reads on_exceed at posting time: WARN notes, STOP refuses. Revisions are new rows superseded_by the old, so the promise that was made stays readable.';

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF (SELECT count(*) FROM pg_indexes
         WHERE tablename = 'budget' AND indexname = 'ux_budget_live') <> 1 THEN
        RAISE EXCEPTION 'the one-live-budget index is missing';
    END IF;
END $$;
