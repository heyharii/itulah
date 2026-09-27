-- One table, four roles, one bank account.
--
-- # The decision being executed
--
-- ERPNext keeps ONE `Bank Account` doctype for every role a real account can
-- play: ours (`is_company_account`, bound to a chart leaf) and a party's
-- (`party_type` + `party`). The owner chose that shape on 22 September 2026
-- ("tiru abis"), and this migration ends the split that 0223/0151/0221 built
-- and 0270 defended. 0270's evidence stands -- the two halves answer different
-- questions -- and the merged table keeps the answers apart with CHECKs: a
-- company row must carry its ledger binding and may not carry a party; a
-- party row the reverse. What the merge buys is the ERPNext payoff: one
-- picker, one list, and the day the auto-match (0304) runs, one table to
-- match against.
--
-- # What merges, and what does not
--
-- * `company_bank_account` (0223, evolved by 0269) -- merged, `account_id`
--   PRESERVED so `bank_statement` (0271), `bank_statement_source` and
--   `journal_line` (0272) keep pointing at the same real accounts without a
--   renumber.
-- * `supplier_bank_account` (0221, evolved by 0270) -- merged as party rows.
-- * `payment_destination` (0151) -- merged as party rows, ENCRYPTION INTACT:
--   `account_number_enc`, the mask and the fingerprint move over byte for
--   byte. The snapshot table (0152) is history and stays as it is; its
--   foreign key is dropped with the table it pointed at, the column kept as
--   the historical id.
-- * `payroll_identity` (0105) -- NOT merged. Two reasons, and either holds:
--   its numbers are plain text and encrypting them needs the application's
--   PGP key, which a migration must never hold; and ERPNext itself keeps
--   employee bank details on the Employee rather than in the Bank Account
--   master. Payroll keeps its own lane.
--
-- # The bank on a party row
--
-- `payment_destination.bank_code` was optional text (0151), so a party row
-- may name no institution: `bank_id` is nullable on the party side and
-- REQUIRED on the company side, by CHECK. `giro.bank` (0117) -- free text
-- with zero rows ever written -- becomes `bank_id`, nullable until the giro
-- lane starts writing, because the audit §6 marked that lane's call.

CREATE TABLE bank_account (
    account_id   uuid PRIMARY KEY,
    bank_id      uuid REFERENCES bank (bank_id),
    is_company_account boolean NOT NULL,

    -- ── company side (is_company_account) — from 0223/0269 ──
    ledger_account_code text,
    is_group     boolean NOT NULL DEFAULT false CHECK (is_group = false),
    site_id      text REFERENCES site (id),
    kind         text CHECK (kind IN ('GIRO', 'SAVINGS', 'TIME_DEPOSIT')),
    status       text CHECK (status IN ('ACTIVE', 'DORMANT', 'CLOSED')),
    opened_at    date,
    is_primary   boolean NOT NULL DEFAULT false,
    currency     char(3) NOT NULL DEFAULT 'IDR',

    -- ── party side (NOT is_company_account) — from 0151/0221 ──
    party_type   text REFERENCES party_type (party_type),
    party_id     text CHECK (party_id IS NULL OR btrim(party_id) <> ''),
    party_name   text,
    account_holder text NOT NULL CHECK (btrim(account_holder) <> ''),
    branch       text,
    is_default   boolean NOT NULL DEFAULT false,
    -- Payment-lane ownership, verbatim from 0151: the domain that owns the
    -- party owns the destination, and an employee's belongs to HR.
    owner_domain text CHECK (owner_domain IN ('SUPPLIER_MASTER', 'HR', 'FINANCE')),

    -- ── identity, shared ──
    account_no   text,
    account_no_digits text CHECK (account_no_digits IS NULL OR account_no_digits ~ '^[0-9]{5,25}$'),
    account_number_enc bytea,
    account_number_mask text,
    account_number_fingerprint text CHECK (account_number_fingerprint IS NULL OR account_number_fingerprint ~ '^[0-9a-f]{64}$'),
    -- Statement-import column mapping, from the Bank master's own mapping (0269
    -- kept it on the institution). Carried per account for the parties that
    -- name one, as ERPNext does.
    verification_status text CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
    verified_by  text,
    verified_at  timestamptz,
    verification_note text,

    note         text,
    active       boolean NOT NULL DEFAULT true,
    retired_at   timestamptz,
    created_by   text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   text NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    -- A company account is ours: ledger binding, place, kind, status, and the
    -- institution REQUIRED. A party account is somebody else's: a party, a
    -- holder, and never a ledger binding -- "our money" and "where a payment
    -- goes" stay two questions with one row shape and CHECKed answers.
    CHECK (is_company_account = (ledger_account_code IS NOT NULL AND site_id IS NOT NULL)),
    CHECK (is_company_account = (kind IS NOT NULL)),
    CHECK (is_company_account = (status IS NOT NULL)),
    CHECK ((NOT is_company_account) OR bank_id IS NOT NULL),
    CHECK (is_company_account <> (party_type IS NOT NULL)),
    CHECK (is_company_account <> (party_id IS NOT NULL)),
    CHECK (is_company_account OR account_number_enc IS NOT NULL),
    CHECK ((verification_status = 'UNVERIFIED') = (verified_at IS NULL) OR is_company_account),
    CHECK ((verified_by IS NULL) = (verified_at IS NULL)),
    CHECK (is_company_account OR active = (retired_at IS NULL))
);

-- What makes two rows the same account: the bank and the digits. Party rows
-- whose number exists only encrypted join by fingerprint instead.
CREATE UNIQUE INDEX ux_bank_account_identity
    ON bank_account (bank_id, account_no_digits)
    WHERE account_no_digits IS NOT NULL;
CREATE UNIQUE INDEX ux_bank_account_fingerprint
    ON bank_account (party_type, party_id, account_number_fingerprint)
    WHERE account_number_fingerprint IS NOT NULL AND active;

-- The one a giro prints from: at most one primary per place among the live
-- company accounts (0223's rule, carried).
CREATE UNIQUE INDEX ux_bank_account_primary
    ON bank_account (site_id)
    WHERE is_company_account AND is_primary AND retired_at IS NULL;

-- At most one default per party (0221's rule, carried; ERPNext's is_default).
CREATE UNIQUE INDEX ux_bank_account_party_default
    ON bank_account (party_type, party_id)
    WHERE party_type IS NOT NULL AND is_default AND retired_at IS NULL;

CREATE INDEX ix_bank_account_company_ledger
    ON bank_account (ledger_account_code, site_id) WHERE is_company_account;
CREATE INDEX ix_bank_account_party ON bank_account (party_type, party_id)
    WHERE party_type IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Backfill one: company accounts, ids preserved
-- ---------------------------------------------------------------------------

INSERT INTO bank_account
    (account_id, bank_id, is_company_account, ledger_account_code, is_group, site_id,
     kind, status, opened_at, is_primary, currency,
     account_no, account_no_digits, account_holder, branch, note,
     retired_at, created_by, created_at, updated_by, updated_at)
SELECT
    c.account_id, c.bank_id, true, c.ledger_account_code, false, c.site_id,
    c.kind, c.status, c.opened_at, c.is_primary, c.currency,
    c.account_no, c.account_no_digits, c.account_holder, c.branch, c.note,
    c.retired_at, c.created_by, c.created_at, c.updated_by, c.updated_at
  FROM company_bank_account c;

-- ---------------------------------------------------------------------------
-- Backfill two: supplier accounts, as SUPPLIER party rows
-- ---------------------------------------------------------------------------

-- The number is encrypted on the way in, because `bank_account_check6` above
-- requires it of every party row and 0221 stored these in the clear. The key
-- is the one `payment_destination` already uses, read from the session rather
-- than written here: a migration must never hold the application's key, so the
-- caller sets `app.payment_destination_key` before running and the migration
-- refuses if it is absent AND there is anything to move.
DO $$
DECLARE
    rows_to_move integer;
    key text := current_setting('app.payment_destination_key', true);
BEGIN
    SELECT count(*) INTO rows_to_move FROM supplier_bank_account;
    IF rows_to_move > 0 AND (key IS NULL OR btrim(key) = '') THEN
        RAISE EXCEPTION
            'this database has % supplier bank account(s) whose numbers must be encrypted on the way into bank_account; set app.payment_destination_key to PAYMENT_DESTINATION_KEY before migrating',
            rows_to_move;
    END IF;
END $$;

INSERT INTO bank_account
    (account_id, bank_id, is_company_account, party_type, party_id, party_name,
     account_holder, branch, is_default,
     account_no, account_no_digits,
     account_number_enc, account_number_mask, account_number_fingerprint,
     owner_domain, note,
     retired_at, created_by, created_at, updated_by, updated_at)
SELECT
    s.account_id, s.bank_id, false, 'SUPPLIER', s.supplier_id::text, s.supplier_id::text,
    s.account_holder, s.branch, s.is_default,
    s.account_no, s.account_no_digits,
    pgp_sym_encrypt(s.account_no_digits, current_setting('app.payment_destination_key')),
    -- The same mask `payment_account_mask` draws: the last four, the rest
    -- hidden. Written here rather than left null so a screen reading the
    -- merged table sees one shape whichever half a row came from.
    repeat('•', greatest(length(s.account_no_digits) - 4, 0))
      || right(s.account_no_digits, 4),
    encode(digest(s.account_no_digits, 'sha256'), 'hex'),
    'SUPPLIER_MASTER', s.note,
    s.retired_at, s.created_by, s.created_at, s.updated_by, s.updated_at
  FROM supplier_bank_account s;

-- party_name: the supplier's register name where the register has it. Text ids
-- were the best 0221 could carry; the register is still the better name.
UPDATE bank_account b
   SET party_name = sp.name
  FROM supplier sp
 WHERE b.party_type = 'SUPPLIER' AND b.party_name = b.party_id
   AND sp.supplier_id::text = b.party_id;

-- ---------------------------------------------------------------------------
-- Backfill three: payment destinations, encrypted and verified verbatim
-- ---------------------------------------------------------------------------

INSERT INTO bank_account
    (account_id, bank_id, is_company_account, party_type, party_id, party_name,
     account_holder, is_default,
     account_number_enc, account_number_mask, account_number_fingerprint,
     verification_status, verified_by, verified_at, verification_note,
     owner_domain, active, retired_at, created_by, created_at, updated_by, updated_at)
SELECT
    d.destination_id,
    bnk.bank_id, false, d.party_type, d.party_id, d.party_name,
    d.account_holder, false,
    d.account_number_enc, d.account_number_mask, d.account_number_fingerprint,
    d.verification_status, d.verified_by, d.verified_at, d.verification_note,
    d.owner_domain, d.active, d.deactivated_at, d.created_by, d.created_at, d.updated_by, d.updated_at
  FROM payment_destination d
  LEFT JOIN bank bnk ON d.bank_code IS NOT NULL
                     AND bnk.normalized_name = upper(btrim(d.bank_code));

-- Snapshots keep their ids as history; the constraint goes with the table.
ALTER TABLE payment_destination_snapshot
    DROP CONSTRAINT IF EXISTS payment_destination_snapshot_destination_id_fkey;

-- Same for the batch items: the column stays as the historical id of where
-- the batch sent its money (0153), the live answer now lives on bank_account.
ALTER TABLE payment_batch_item
    DROP CONSTRAINT IF EXISTS payment_batch_item_destination_id_fkey;

-- ---------------------------------------------------------------------------
-- The readers re-point: statements, intake, journal lines
-- ---------------------------------------------------------------------------

-- The unique key 0271 needed, restated on the merged table.
ALTER TABLE bank_account
    ADD CONSTRAINT bank_account_ledger_binding_is_addressable
    UNIQUE (account_id, ledger_account_code, site_id);

ALTER TABLE bank_statement
    DROP CONSTRAINT bank_statement_account_agrees_with_its_ledger_binding;
ALTER TABLE bank_statement
    ADD CONSTRAINT bank_statement_account_agrees_with_its_ledger_binding
    FOREIGN KEY (bank_account_id, account_code, site_id)
    REFERENCES bank_account (account_id, ledger_account_code, site_id);

ALTER TABLE bank_statement_source
    DROP CONSTRAINT bank_statement_source_account_agrees_with_its_ledger_binding;
ALTER TABLE bank_statement_source
    ADD CONSTRAINT bank_statement_source_account_agrees_with_its_ledger_binding
    FOREIGN KEY (bank_account_id, account_code, site_id)
    REFERENCES bank_account (account_id, ledger_account_code, site_id);

ALTER TABLE journal_line
    DROP CONSTRAINT journal_line_bank_account_agrees_with_the_account_posted;
ALTER TABLE journal_line
    ADD CONSTRAINT journal_line_bank_account_agrees_with_the_account_posted
    FOREIGN KEY (bank_account_id, account_code, site_id)
    REFERENCES bank_account (account_id, ledger_account_code, site_id);

-- ---------------------------------------------------------------------------
-- giro names the institution (0117's free text, audit §6's first candidate)
-- ---------------------------------------------------------------------------

ALTER TABLE giro ADD COLUMN bank_id uuid REFERENCES bank (bank_id);

-- ---------------------------------------------------------------------------
-- The old tables go
-- ---------------------------------------------------------------------------

DROP TABLE company_bank_account;
DROP TABLE supplier_bank_account;
DROP TABLE payment_destination;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    company_rows bigint; party_rows bigint; merged_company bigint;
BEGIN
    SELECT count(*) INTO company_rows FROM bank_account WHERE is_company_account;
    SELECT count(*) INTO party_rows   FROM bank_account WHERE NOT is_company_account;
    SELECT count(*) INTO merged_company FROM bank_statement
     WHERE bank_account_id IS NOT NULL;

    -- Every statement still names a real account through the re-pointed key.
    IF EXISTS (SELECT 1 FROM bank_statement s
                JOIN bank_account b ON b.account_id = s.bank_account_id
              WHERE b.ledger_account_code <> s.account_code
                 OR b.site_id <> s.site_id) THEN
        RAISE EXCEPTION 'a statement disagrees with its merged account binding';
    END IF;

    -- A company row without a bank or a binding is not a company row.
    IF EXISTS (SELECT 1 FROM bank_account
                WHERE is_company_account AND (bank_id IS NULL OR ledger_account_code IS NULL)) THEN
        RAISE EXCEPTION 'a merged company account lost its institution or binding';
    END IF;

    RAISE NOTICE 'merged: % company account(s), % party account(s), % statement(s) re-pointed',
        company_rows, party_rows, merged_company;
END $$;
