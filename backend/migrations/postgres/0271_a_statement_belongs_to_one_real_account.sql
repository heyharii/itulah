-- A statement belongs to one real account, not to a kind of balance.
--
-- `bank_statement` (0071) identified itself by (`account_code`, `site_id`) — the
-- natural account and the place. That worked only while `company_bank_account`
-- forbade a second account on one ledger binding, which 0269 stopped doing on
-- purpose. Without this migration, two real BCA giro accounts would file
-- statements indistinguishable from each other, and `confirm_match` would
-- happily agree a line on one with a voucher on the other.
--
-- # Why the backfill is unambiguous, and only now
--
-- Every statement that exists was filed when at most ONE company bank account
-- could exist per (ledger account, place) — 0223's `UNIQUE`, removed in 0269. So
-- the join below has exactly one candidate per statement by construction. Run
-- after a second account exists, the same join would be a guess. It runs here
-- because here is the last moment it cannot be.
--
-- # Statements that resolve to nothing
--
-- `scripts/seed-finance.py:886` files one statement per site over `SITES[:4]`,
-- including "Rekening koran store-01". Shops do not hold bank accounts — what a
-- shop holds is a DESTINATION for its takings (`store_bank_destination`, 0111,
-- a semantic key resolved through `account_map`). So those rows name an account
-- that was never real, and inventing one to satisfy a NOT NULL is exactly what
-- `docs/finance-bank-audit.md` §2 forbids.
--
-- Hence `NOT VALID`, which is not a weaker constraint but a differently-scoped
-- one: Postgres enforces it on every INSERT and every UPDATE from now on, and
-- exempts the rows already there. So:
--
--     * no statement can arrive from here on without naming a real account;
--     * the statements already imported stay readable, which is the whole point
--       of keeping a closed account's history at all;
--     * no account is invented.
--
-- The count that is left unnamed is reported by
-- `tests/bank_identity_integration.rs`, so it is a number somebody can watch
-- shrink rather than a silence.

-- A foreign key needs a unique index to point at, and this one carries the
-- consistency we actually want: a statement cannot claim a ledger account or a
-- place that its own bank account does not have.
ALTER TABLE company_bank_account
    ADD CONSTRAINT company_bank_account_ledger_binding_is_addressable
    UNIQUE (account_id, ledger_account_code, site_id);

ALTER TABLE bank_statement
    ADD COLUMN bank_account_id uuid;

UPDATE bank_statement s
   SET bank_account_id = c.account_id
  FROM company_bank_account c
 WHERE c.ledger_account_code = s.account_code
   AND c.site_id = s.site_id
   AND s.bank_account_id IS NULL;

ALTER TABLE bank_statement
    ADD CONSTRAINT bank_statement_account_agrees_with_its_ledger_binding
    FOREIGN KEY (bank_account_id, account_code, site_id)
    REFERENCES company_bank_account (account_id, ledger_account_code, site_id);

ALTER TABLE bank_statement
    ADD CONSTRAINT bank_statement_names_a_real_account
    CHECK (bank_account_id IS NOT NULL) NOT VALID;

CREATE INDEX ix_bank_statement_bank_account ON bank_statement (bank_account_id);

-- And the dedupe key moves with it. `ux_bank_statement_current` was
--
--     UNIQUE (account_code, site_id, period_start, period_end)
--       WHERE superseded_by IS NULL
--
-- which is "one current statement per ledger binding per period" — correct only
-- while one ledger binding meant one account. With two real BCA giro accounts it
-- would refuse the second account's September statement as a duplicate of the
-- first, which is the same conflation as the rest of this migration, in the one
-- place where it shows up as a refusal a reconciler cannot argue with.
DROP INDEX IF EXISTS ux_bank_statement_current;

CREATE UNIQUE INDEX ux_bank_statement_current
    ON bank_statement (bank_account_id, period_start, period_end)
 WHERE superseded_by IS NULL;

-- Rows that predate the account master hold NULL here, and NULLs do not collide,
-- so they are no longer deduped against each other. They also can no longer be
-- created: the check below refuses a new statement without an account. What is
-- left unprotected is history that is already written.

DO $$
DECLARE
    unnamed bigint;
    total   bigint;
BEGIN
    SELECT COUNT(*) FILTER (WHERE bank_account_id IS NULL), COUNT(*)
      INTO unnamed, total FROM bank_statement;
    IF unnamed > 0 THEN
        RAISE NOTICE
            '% of % existing statement(s) name no real bank account and are left as history; new ones are refused',
            unnamed, total;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The intake routes to an account, not to a ledger binding
-- ---------------------------------------------------------------------------
--
-- `bank_statement_source` (0142) picks a reader by (`account_code`, `site_id`)
-- plus sender/subject/filename patterns. Two accounts at one bank on one ledger
-- account would route to whichever row sorted first — and since the statement it
-- produces must now name an account, the source has to know which.
--
-- Nullable, and NOT `NOT VALID`: a source is configuration a person edits, not
-- history, so the right place to insist is the screen that writes it. The column
-- exists so it can.
ALTER TABLE bank_statement_source
    ADD COLUMN bank_account_id uuid;

UPDATE bank_statement_source s
   SET bank_account_id = c.account_id
  FROM company_bank_account c
 WHERE c.ledger_account_code = s.account_code
   AND c.site_id = s.site_id
   AND s.bank_account_id IS NULL;

ALTER TABLE bank_statement_source
    ADD CONSTRAINT bank_statement_source_account_agrees_with_its_ledger_binding
    FOREIGN KEY (bank_account_id, account_code, site_id)
    REFERENCES company_bank_account (account_id, ledger_account_code, site_id);

COMMENT ON COLUMN bank_statement.bank_account_id IS
    'The real account this statement is of. NOT NULL for everything imported from 0271 onwards, enforced by a NOT VALID check; older rows predate the account master and are kept readable rather than given an invented account.';
