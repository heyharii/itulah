-- The map never got what 0294 asked of it.
--
-- 0290 pointed `account_map` at the forty and gave each row its category,
-- reading both off `ledger_account_remap`. 0294 then gave `7101` a
-- `depreciation_kind` and `1601` an `asset_stage`, and set those categories on
-- the remap rows — but the map had already been written. Nothing went back for
-- it.
--
-- The trigger that guards this fires BEFORE INSERT OR UPDATE, so rows that were
-- already sitting there were never re-examined and no error was raised. The
-- result is silent and total: every map row on `7101` and `1601` carries NULL,
-- both accounts now demand a category, and so **every depreciation run, every
-- amortisation run, every replacement charge and every capitalisation would
-- refuse at the moment somebody pressed the button.**
--
-- It cannot be fixed the way 0290 did it. `ledger_account_remap` is keyed on the
-- client's code, and the map rows stopped carrying that code the moment 0290
-- moved them, so there is nothing left to join on. What does still identify
-- them is the thing that was never in doubt: the MEANING. `depreciation_expense`
-- is depreciation whichever account it points at; `work_in_progress` is work in
-- progress. So the five are set by name, which is also the most legible way to
-- write it down.
--
-- The check at the bottom is the one 0294 should have had: no map row anywhere
-- may sit on an account that demands a category without carrying one. It is
-- cheap, it is exhaustive, and it would have caught this the day it happened.

UPDATE account_map SET category_code = 'DEPRECIATION'
 WHERE semantic_key = 'depreciation_expense' AND category_code IS NULL;
UPDATE account_map SET category_code = 'AMORTISATION'
 WHERE semantic_key = 'amortisation_expense' AND category_code IS NULL;
UPDATE account_map SET category_code = 'REPLACEMENT'
 WHERE semantic_key = 'replacement_expense' AND category_code IS NULL;
UPDATE account_map SET category_code = 'IN_SERVICE'
 WHERE semantic_key = 'fixed_asset' AND category_code IS NULL;
UPDATE account_map SET category_code = 'IN_PROGRESS'
 WHERE semantic_key = 'work_in_progress' AND category_code IS NULL;

-- # An opening balance could not record what it was handed
--
-- `opening_balance_line` is the record of the trial balance somebody gave us at
-- cutover, and 0158 keyed it `(cutover_date, site_id, account_code)` — one line
-- per account, which was true when an account meant one thing.
--
-- It is not true any more, and in two ways that both bite at cutover:
--
--   * A client's trial balance has a line for cash on hand, a line for petty
--     cash and a line for the till float. All three are `1101`, so the second
--     one is refused as a duplicate of the first. The same for six prepayment
--     kinds, nine tax kinds, fifty-one expenses.
--   * A shop's opening balance needs a `1501` line per counter-unit, and there
--     is nowhere to put the counter-unit at all — the importer posts one, and
--     the row it posts from cannot say which.
--
-- So the line gains the counter-unit and the key gains both. `COALESCE` because
-- a unique index counts two NULLs as different, and "no category" is one value,
-- not an endless supply of them.

ALTER TABLE opening_balance_line
    ADD COLUMN counter_site_id TEXT REFERENCES site (id);

COMMENT ON COLUMN opening_balance_line.counter_site_id IS
    'The unit on the other side, on an inter-unit line and nowhere else. A '
    'shop''s opening balance carries its position against head office here, '
    'because equity is company-wide and a shop has no equity of its own.';

ALTER TABLE opening_balance_line DROP CONSTRAINT IF EXISTS opening_balance_line_cutover_date_site_id_account_code_key;
DROP INDEX IF EXISTS opening_balance_line_cutover_date_site_id_account_code_key;

CREATE UNIQUE INDEX opening_balance_line_one_per_line
    ON opening_balance_line (cutover_date, site_id, account_code,
                             COALESCE(category_code, ''), COALESCE(counter_site_id, ''));

DO $$
DECLARE
    stale TEXT;
BEGIN
    -- Every map row, against the rule its account declares. This is the check
    -- whose absence let the bug above exist.
    SELECT string_agg(DISTINCT m.semantic_key || ' -> ' || m.account_code, ', ')
      INTO stale
      FROM account_map m
      JOIN ledger_account a USING (account_code)
     WHERE (a.category_family IS NOT NULL) <> (m.category_code IS NOT NULL);
    IF stale IS NOT NULL THEN
        RAISE EXCEPTION
            'these map rows disagree with their account about whether a '
            'category is wanted: %', stale;
    END IF;

    -- And the same for every document that stores a choice to post later.
    SELECT string_agg(t, ', ') INTO stale FROM (
        SELECT 'prepaid_schedule.expense' t FROM prepaid_schedule d
          JOIN ledger_account a ON a.account_code = d.expense_account_code
         WHERE a.category_family IS NOT NULL AND d.expense_category_code IS NULL
        UNION SELECT 'store_deposit.drawer' FROM store_deposit d
          JOIN ledger_account a ON a.account_code = d.drawer_account_code
         WHERE a.category_family IS NOT NULL AND d.drawer_category_code IS NULL
        UNION SELECT 'opening_balance_line' FROM opening_balance_line d
          JOIN ledger_account a ON a.account_code = d.account_code
         WHERE a.category_family IS NOT NULL AND d.category_code IS NULL
    ) x;
    IF stale IS NOT NULL THEN
        RAISE NOTICE 'stored choices still needing a category: %', stale;
    END IF;
END $$;
