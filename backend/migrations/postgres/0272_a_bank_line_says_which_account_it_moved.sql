-- A bank line says which account it moved.
--
-- `journal_line` already carries two typed sub-ledger references — `supplier_id`
-- (0051) and `asset_id` (0213) — each written by the rule that KNOWS, never
-- inferred from the account code afterwards. A bank account is the third of
-- exactly that kind, so it is the third column of exactly that kind. No generic
-- reference framework, no `account_required_reference` table pointing at tables
-- that do not exist: the pattern this schema already uses is a typed nullable FK.
--
-- # No `requires_bank_account` flag on `ledger_account`
--
-- The obvious design is a boolean saying which natural accounts demand a bank
-- account. I did not add one, because the requirement is already derivable from
-- a fact the database holds, and a flag would be a second place for that fact to
-- live — plus a column nobody reads is the mistake 0243 made four times over.
--
-- What the master knows is stronger than a flag:
--
--     no company_bank_account for this (ledger account, place)
--         -> nothing to name; postings carry on as they always have
--     exactly one active account
--         -> the poster fills it in; asking a rule to name the only candidate
--            would be ceremony
--     two or more active accounts
--         -> genuinely ambiguous, so the intent must say which, and a refusal
--            here is the control actually being exercised
--
-- So the control switches itself on the moment the client's real accounts are
-- registered, and cannot brick an estate that has not registered any yet. A flag
-- would have had to be turned on by hand, in every environment, which is the
-- Phase 1C lesson: policy that depends on somebody remembering is policy some
-- environment does not have.
--
-- `OPENING` is the one exemption, and it is not a bypass: an opening balance is
-- history arriving, and the account it sat in may have closed before this master
-- existed.

ALTER TABLE journal_line
    ADD COLUMN bank_account_id uuid;

-- Composite, against the unique 0271 added. So a line can never name an account
-- belonging to a different natural account or a different place — the exact
-- cross-account confusion `bank_line_match` was open to, refused by the shape of
-- the key rather than by a check somebody has to remember to write.
ALTER TABLE journal_line
    ADD CONSTRAINT journal_line_bank_account_agrees_with_the_account_posted
    FOREIGN KEY (bank_account_id, account_code, site_id)
    REFERENCES company_bank_account (account_id, ledger_account_code, site_id);

CREATE INDEX ix_journal_line_bank_account ON journal_line (bank_account_id)
 WHERE bank_account_id IS NOT NULL;

COMMENT ON COLUMN journal_line.bank_account_id IS
    'Which of our real bank accounts this line moved, when the natural account has any registered. Set by the rule that knows, or resolved by the poster when the ledger binding has exactly one active account; never inferred from the account code.';

-- ---------------------------------------------------------------------------
-- Reconciliation cannot cross two accounts
-- ---------------------------------------------------------------------------
--
-- `confirm_match` (`banking.rs:1049`) checks the AMOUNT left on a bank line and
-- nothing about the voucher it is agreed with. So today a line on a BCA
-- statement can be matched against a journal line on Mandiri — or against a
-- salary expense, which is not a bank line at all. `UNIQUE (journal_line_id)`
-- stops a voucher being claimed twice and says nothing about whether it is the
-- right voucher.
--
-- A trigger rather than a constraint because the invariant spans three tables
-- (`bank_line_match` -> `bank_statement_line` -> `bank_statement`, against
-- `journal_line`), which no CHECK can see. Reconciliation is a person clicking,
-- not a hot path.
CREATE OR REPLACE FUNCTION bank_line_match_stays_on_one_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    statement_account   text;
    statement_site      text;
    statement_bank      uuid;
    voucher_account     text;
    voucher_site        text;
    voucher_bank        uuid;
BEGIN
    SELECT s.account_code, s.site_id, s.bank_account_id
      INTO statement_account, statement_site, statement_bank
      FROM bank_statement_line l
      JOIN bank_statement s ON s.statement_id = l.statement_id
     WHERE l.line_id = NEW.line_id;

    SELECT j.account_code, j.site_id, j.bank_account_id
      INTO voucher_account, voucher_site, voucher_bank
      FROM journal_line j
     WHERE j.line_id = NEW.journal_line_id;

    -- The natural account and the place, always. This is the check that was
    -- missing outright.
    IF voucher_account IS DISTINCT FROM statement_account
       OR voucher_site IS DISTINCT FROM statement_site THEN
        RAISE EXCEPTION
            'this voucher line is on % at %, and the statement is of % at % -- a bank line can only be agreed with a voucher that moved the same account',
            voucher_account, voucher_site, statement_account, statement_site
            USING ERRCODE = 'P0001';
    END IF;

    -- And the real account, once both sides know it. One-sided is the ordinary
    -- state of everything posted before the master existed, and refusing it
    -- would close reconciliation for history rather than protect it.
    IF statement_bank IS NOT NULL AND voucher_bank IS NOT NULL
       AND statement_bank <> voucher_bank THEN
        RAISE EXCEPTION
            'the statement and the voucher are of two different accounts at this bank, so they cannot be the same event'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER bank_line_match_one_account
    BEFORE INSERT OR UPDATE ON bank_line_match
    FOR EACH ROW EXECUTE FUNCTION bank_line_match_stays_on_one_account();
