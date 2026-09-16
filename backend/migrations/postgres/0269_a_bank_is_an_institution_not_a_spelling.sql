-- A bank is an institution, not a spelling.
--
-- Until now "which bank" was a string, written five different ways across the
-- estate: `company_bank_account.bank_name_normalized`,
-- `supplier_bank_account.bank_name_normalized`, `payment_destination.bank_code`,
-- `giro.bank`, and `store_bank_destination.bank_key`. None of them pointed at a
-- row, because there was no row to point at. `bank_institutions()`
-- (`company_banks.rs:288`) derived the list with a `UNION ALL` over the first
-- two — so a bank only existed while some account named it, and a typo was a
-- new bank.
--
-- # Three things that were being used as one
--
--     bank          the institution              BCA
--     bank account  our real account there       1234567890, held by PT ...
--     ledger acct   the natural accounting home  1011002001 Cash In Bank Giro BCA
--
-- The third was doing the first one's job: `1011002001` IS "our BCA giro money",
-- and `UNIQUE (ledger_account_code, site_id)` on `company_bank_account` made
-- that identification total — one account per ledger binding, so a second real
-- BCA giro account could not be recorded at all. That is the constraint this
-- migration removes, and §Identity below is what replaces it.
--
-- # Which institutions, and where they come from
--
-- The six the owner settled on 13 September, written down in
-- `docs/finance-menu.md` line 231: *"master institusi — enam bank, bukan lima"*.
--
-- NOT derived from the chart. The chart names six banks across `1011002`,
-- `1011003` and `1011004`, but a ledger account says which KINDS of bank balance
-- may exist, never which real accounts do. This migration therefore creates six
-- institutions and **zero accounts**: an institution is a fact about who we bank
-- with, an account is a fact only the client holds.
--
-- Any normalized name that existing rows prove is in use, and that is not one of
-- the six, becomes a bank too — data is evidence, and the backfill below must
-- have something to point at.
--
-- And a seventh bank arrives the same way this one did: by a migration. Not for
-- want of a screen, but because which institutions a company banks at is a
-- deployment-wide fact, and Phase 1C already taught this estate what happens to a
-- fact that depends on somebody remembering to enter it in each environment. The
-- API therefore refuses an unknown institution instead of creating one.
--
-- # No alias table
--
-- `normalize_bank()` (`supplier_banks.rs:151`) already folds "Bank BCA", "BANK
-- BCA" and "BCA" onto "BCA", and both masters share it. It does NOT fold "PT
-- Bank Central Asia", and it does not need to: once the institution is a row
-- somebody PICKS, nobody types a bank name, and the spelling axis is gone rather
-- than normalised harder. An alias table would be a second place for the answer
-- to live.

CREATE TABLE bank (
    bank_id          uuid PRIMARY KEY,

    -- Our stable internal code, never a user-entered name. It is what other
    -- tables will be read against in a log, and what `payment_destination`
    -- (0151) already has a `bank_code` column shaped for.
    code             text NOT NULL UNIQUE
                     CHECK (code ~ '^[A-Z][A-Z0-9]{1,15}$'),

    -- As printed on a giro, and as compared. Same pair as 0221/0223, and the
    -- normalized half is unique because two rows normalising alike are the very
    -- duplicate this table exists to prevent.
    name             text NOT NULL CHECK (btrim(name) <> ''),
    normalized_name  text NOT NULL UNIQUE CHECK (btrim(normalized_name) <> ''),

    country_code     char(2) NOT NULL DEFAULT 'ID' CHECK (country_code ~ '^[A-Z]{2}$'),

    -- Hidden from pickers, still readable on everything it ever paid — the same
    -- reasoning 0221 and 0223 give for `retired_at`. A bank we stop using does
    -- not stop having been on last March's giro.
    active           boolean NOT NULL DEFAULT true,

    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE bank IS
    'The financial institutions we bank with, and that our suppliers bank at. An institution only -- never an account, and never a ledger account.';

-- Deterministic ids from the code, so every environment agrees on which row is
-- BCA without a seed file having to be shipped alongside.
INSERT INTO bank (bank_id, code, name, normalized_name)
VALUES (md5('bank:BCA')::uuid,      'BCA',      'Bank BCA',      'BCA'),
       (md5('bank:MANDIRI')::uuid,  'MANDIRI',  'Bank Mandiri',  'MANDIRI'),
       (md5('bank:BRI')::uuid,      'BRI',      'Bank BRI',      'BRI'),
       (md5('bank:BNI')::uuid,      'BNI',      'Bank BNI',      'BNI'),
       (md5('bank:BTN')::uuid,      'BTN',      'Bank BTN',      'BTN'),
       (md5('bank:DANAMON')::uuid,  'DANAMON',  'Bank Danamon',  'DANAMON')
ON CONFLICT (code) DO NOTHING;

-- Whatever the rows already say, on top of the six. A normalized name in use
-- that we do not have an institution for would make the NOT NULL below
-- impossible, and inventing the account is forbidden — inventing the
-- institution it already names is not.
INSERT INTO bank (bank_id, code, name, normalized_name)
SELECT md5('bank:' || k)::uuid,
       regexp_replace(upper(k), '[^A-Z0-9]', '', 'g'),
       display,
       k
  FROM (
        SELECT DISTINCT ON (bank_name_normalized)
               bank_name_normalized AS k, bank_name AS display
          FROM (
                SELECT bank_name_normalized, bank_name, updated_at
                  FROM company_bank_account
                UNION ALL
                SELECT bank_name_normalized, bank_name, updated_at
                  FROM supplier_bank_account
          ) every_name
         ORDER BY bank_name_normalized, updated_at DESC
  ) in_use
 WHERE NOT EXISTS (SELECT 1 FROM bank b WHERE b.normalized_name = in_use.k)
   AND regexp_replace(upper(k), '[^A-Z0-9]', '', 'g') ~ '^[A-Z][A-Z0-9]{1,15}$'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- `company_bank_account` becomes the canonical company bank account
-- ---------------------------------------------------------------------------
--
-- Evolved, not replaced. Its semantics were already right: our account, at a
-- real bank, bound to the natural account it belongs in, at a place, with the
-- number and holder a giro needs. A second table would have been a second
-- answer.

ALTER TABLE company_bank_account
    ADD COLUMN bank_id    uuid REFERENCES bank (bank_id),
    -- Exists but unused is not the same as terminated. `retired_at` already
    -- carries the closure DATE; `status` carries the three-way distinction the
    -- pickers and the posting rules need to read without a CASE over timestamps.
    ADD COLUMN status     text NOT NULL DEFAULT 'ACTIVE'
               CHECK (status IN ('ACTIVE', 'DORMANT', 'CLOSED')),
    ADD COLUMN opened_at  date,
    -- One ledger currency in this estate, and the same column shape
    -- `cash_document` uses. Here rather than derived because a foreign-currency
    -- account is a real thing a bank sells, and the day one exists the
    -- reconciliation has to refuse to net it against IDR.
    ADD COLUMN currency   char(3) NOT NULL DEFAULT 'IDR';

UPDATE company_bank_account c
   SET bank_id = b.bank_id
  FROM bank b
 WHERE b.normalized_name = c.bank_name_normalized
   AND c.bank_id IS NULL;

DO $$
DECLARE
    orphaned bigint;
BEGIN
    SELECT COUNT(*) INTO orphaned FROM company_bank_account WHERE bank_id IS NULL;
    IF orphaned > 0 THEN
        RAISE EXCEPTION
            '% company bank account(s) name a bank that could not be resolved to an institution', orphaned;
    END IF;
END $$;

ALTER TABLE company_bank_account ALTER COLUMN bank_id SET NOT NULL;

-- `bank_name` / `bank_name_normalized` stay for now, deliberately: five callers
-- read them and `bank_institutions()` is still derived from them. 0270 moves the
-- readers over; dropping the columns in the same migration that adds the key
-- would break the build between two files of one chain.

-- Status and the closure date are two halves of one fact, so they cannot
-- disagree.
UPDATE company_bank_account SET status = 'CLOSED' WHERE retired_at IS NOT NULL;

ALTER TABLE company_bank_account
    ADD CONSTRAINT company_bank_account_closed_has_a_date
    CHECK ((status = 'CLOSED') = (retired_at IS NOT NULL));

-- Time deposits are accounts too. The chart holds four of them (`1011004001`
-- onwards) and they were unrepresentable here.
--
-- `GIRO` is kept rather than renamed to ERPNext's `CURRENT`: giro IS the
-- Indonesian current account, it is the client's own word, and it is the word
-- printed on `1011002 CASH IN BANK GIRO`. Restating the whole list because a
-- CHECK cannot be widened in place, and a DROP that forgets a value is how
-- `source_kind` silently lost 21 of its 35 (0257).
ALTER TABLE company_bank_account DROP CONSTRAINT IF EXISTS company_bank_account_kind_check;
ALTER TABLE company_bank_account
    ADD CONSTRAINT company_bank_account_kind_check
    CHECK (kind IN ('GIRO', 'SAVINGS', 'TIME_DEPOSIT'));

-- ---------------------------------------------------------------------------
-- Identity: the number at the bank, not the ledger binding
-- ---------------------------------------------------------------------------
--
-- 0223 wrote `UNIQUE (ledger_account_code, site_id)` and gave a real reason:
--
--     "Two rows describing one account at one place is two answers to 'what is
--      the number', and a giro printed from the wrong one comes back."
--
-- That answers "which number gets printed" by forbidding "we hold two accounts
-- at this bank". They are different questions and they get different answers:
--
--   * what makes two rows the same account -> the bank and the digits;
--   * which one is used when nobody says   -> exactly one `is_primary` per place.
--
-- So a second BCA giro account may exist, share `1011002001` with the first, and
-- still reconcile separately — because the statement will name the account, not
-- the ledger code.
ALTER TABLE company_bank_account
    DROP CONSTRAINT IF EXISTS company_bank_account_ledger_account_code_site_id_key;

ALTER TABLE company_bank_account
    ADD CONSTRAINT company_bank_account_is_its_number_at_its_bank
    UNIQUE (bank_id, account_no_digits);

-- And the question 0223 was actually protecting was ALREADY answered, by its own
-- `ux_company_bank_account_primary`:
--
--     UNIQUE (site_id) WHERE is_primary AND retired_at IS NULL
--
-- One account per place is the one a giro prints from, enforced independently of
-- how many accounts we hold. So the ledger-binding uniqueness was not carrying
-- that guarantee either — it was only forbidding the second real account. Left
-- as it is; nothing to add.

CREATE INDEX ix_company_bank_account_institution ON company_bank_account (bank_id);

COMMENT ON COLUMN company_bank_account.bank_id IS
    'The institution. Authoritative from here on; `bank_name` survives only until 0270 moves its readers.';
COMMENT ON COLUMN company_bank_account.status IS
    'ACTIVE | DORMANT (exists, unused) | CLOSED (terminated, and `retired_at` says when). Never deleted: a closed account still has to be legible on the statements and giro it produced.';
