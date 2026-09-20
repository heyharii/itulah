-- A document remembers the category it chose.
--
-- 0288 put the category on the journal line and 0290 put it on the map, which
-- between them cover every posting a RULE makes. This migration covers the
-- other kind: the postings a PERSON sets up in advance.
--
-- A prepaid schedule is written once and then posts every month for a year
-- without anybody looking at it. A payment batch names the account its
-- counter-leg will hit before the payment runs. A cash document, a credit note,
-- an advance settlement, a bill's expense line and an opening balance line all
-- work the same way: somebody chooses, and the choice is honoured later.
--
-- Before the chart collapsed, the account code carried the whole choice — the
-- schedule said `6010310006` and that WAS electricity. Now the account says
-- `6301` and the category says which expense, so a document that stores only
-- the account has stored half of what the person decided. It would post, and it
-- would post to the wrong thing, or (because 0288's trigger refuses a
-- family-bearing account with no category) it would simply stop working on the
-- day the schedule next ran — months after anybody remembered setting it up.
--
-- So each of these gets its own column, and the column is a foreign key into
-- `line_category` so a category cannot be retired out from under a schedule
-- that still points at it.
--
-- One naming note, because it is a trap already sprung once in this repo:
-- `cash_document` ALREADY has a column called `category_code`, and it means
-- `transaction_category` — the bank-rule/cash-document classification, a
-- different idea with a different table. The two columns here are therefore
-- `from_category_code` and `to_category_code`, named for the sides of the
-- document, so that nobody reading a query has to work out which `category` is
-- meant.

ALTER TABLE cash_document
    ADD COLUMN from_category_code TEXT REFERENCES line_category (category_code),
    ADD COLUMN to_category_code   TEXT REFERENCES line_category (category_code);

COMMENT ON COLUMN cash_document.from_category_code IS
    'line_category for the account money left. Not to be confused with '
    'cash_document.category_code, which is a transaction_category.';

ALTER TABLE prepaid_schedule
    ADD COLUMN prepaid_category_code TEXT REFERENCES line_category (category_code),
    ADD COLUMN expense_category_code TEXT REFERENCES line_category (category_code);

ALTER TABLE supplier_credit_note
    ADD COLUMN credit_category_code TEXT REFERENCES line_category (category_code);

ALTER TABLE payment_batch
    ADD COLUMN counter_category_code TEXT REFERENCES line_category (category_code);

ALTER TABLE advance_settlement
    ADD COLUMN category_code TEXT REFERENCES line_category (category_code);

ALTER TABLE supplier_invoice_expense_line
    ADD COLUMN category_code TEXT REFERENCES line_category (category_code);

ALTER TABLE opening_balance_line
    ADD COLUMN category_code TEXT REFERENCES line_category (category_code);

-- Nothing is back-filled, and that is a decision rather than an omission.
--
-- 0291 moved these rows onto the forty accounts but could not give them a
-- category: the only thing that knew which category a row meant was the account
-- it used to name, and by then 0291 had overwritten it.
-- `ledger_account_remap` is keyed on the old code, which these rows no longer
-- carry, so the answer is genuinely not recoverable from the row.
--
-- Nor is there a safe default. Every one of the sixteen families has at least
-- two values, so there is no family where "the only possible answer" exists;
-- the expense family has fifty-one. A person chose one of them and nobody wrote
-- it down.
--
-- So these stay NULL and 0288's trigger refuses them at posting time, naming
-- the account and listing legal values. That is the right failure. Guessing
-- would put real money in the wrong expense line, and posting to the first
-- category in the family would do the same while looking deliberate. Stopping
-- sends somebody back to the screen to choose again, which is exactly what has
-- to happen.
--
-- The count is printed below so it appears in the migration log, instead of
-- being discovered one refused posting at a time.

DO $$
DECLARE
    owing TEXT;
BEGIN
    -- Say out loud how many stored choices are now incomplete, so that the
    -- number appears in the migration log rather than being discovered one
    -- refused posting at a time.
    SELECT string_agg(t || '=' || n, ', ' ORDER BY t) INTO owing FROM (
        SELECT 'prepaid_schedule' t, count(*) n FROM prepaid_schedule d
          JOIN ledger_account a ON a.account_code = d.expense_account_code
         WHERE a.category_family IS NOT NULL AND d.expense_category_code IS NULL
        UNION ALL
        SELECT 'supplier_invoice_expense_line', count(*) FROM supplier_invoice_expense_line d
          JOIN ledger_account a ON a.account_code = d.account_code
         WHERE a.category_family IS NOT NULL AND d.category_code IS NULL
        UNION ALL
        SELECT 'opening_balance_line', count(*) FROM opening_balance_line d
          JOIN ledger_account a ON a.account_code = d.account_code
         WHERE a.category_family IS NOT NULL AND d.category_code IS NULL
    ) x WHERE n > 0;
    IF owing IS NOT NULL THEN
        RAISE NOTICE 'stored choices still needing a category: %', owing;
    ELSE
        RAISE NOTICE 'every stored choice either has its category or needs none';
    END IF;
END $$;
