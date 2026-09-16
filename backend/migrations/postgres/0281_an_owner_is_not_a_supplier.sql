-- An owner is not a supplier, and the money they move is not a purchase.
--
-- # Why a master at all
--
-- The client's chart carries `3013001001 Modal Setor`, `3013001004 Prive` and
-- `2022401001 Pinjaman Jangka Panjang Principal`: capital put in, money taken
-- out, and money lent by the same people. Today nothing can say WHICH owner —
-- the accounts are company-wide and every movement is a hand-keyed journal.
--
-- A `principal` is an owner or an investor. It is deliberately NOT a supplier:
-- a supplier sells goods and services, is paid against invoices, ages in the AP
-- report and belongs in a buying workflow that would be nonsense here. Making
-- one table serve both is how a drawing ends up in supplier ageing.
--
-- And deliberately not a generic `party` either. Two tables that each mean
-- something beat one that means "somebody", for the same reason `advance`
-- names an employee or a supplier and refuses to blur them.
--
-- # What is recorded
--
-- `principal_transaction` is the subledger: who, which unit, what kind of
-- movement, and the entry it posted. Four kinds, and each has one shape:
--
--   CONTRIBUTION  Dr Cash/Bank            Cr Modal Setor
--   DRAWING       Dr Prive                Cr Cash/Bank
--   LOAN_IN       Dr Cash/Bank            Cr Pinjaman Principal
--   LOAN_REPAY    Dr Pinjaman Principal   Cr Cash/Bank
--
-- Interest on a principal loan is not here: it is financing, and 0282 is where
-- a facility with a schedule lives. This table is the identity and the four
-- movements that need no schedule.

CREATE TABLE IF NOT EXISTS principal (
    principal_id uuid PRIMARY KEY,
    code         text NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9_-]*$'),
    name         text NOT NULL CHECK (btrim(name) <> ''),
    -- OWNER holds equity; INVESTOR may hold equity, a loan, or both. The
    -- distinction is the client's own vocabulary and stays theirs.
    kind         text NOT NULL DEFAULT 'OWNER' CHECK (kind IN ('OWNER', 'INVESTOR')),
    active       boolean NOT NULL DEFAULT true,
    note         text,
    created_by   text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at   timestamptz NOT NULL DEFAULT now(),
    retired_at   timestamptz,
    retired_by   text,

    CHECK ((retired_at IS NULL) = (retired_by IS NULL)),
    CHECK (active OR retired_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS principal_transaction (
    transaction_id uuid PRIMARY KEY,
    principal_id   uuid NOT NULL REFERENCES principal (principal_id),
    site_id        text NOT NULL REFERENCES site (id),
    kind           text NOT NULL
                       CHECK (kind IN ('CONTRIBUTION', 'DRAWING', 'LOAN_IN', 'LOAN_REPAY')),
    amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
    currency       char(3) NOT NULL DEFAULT 'IDR',
    posting_date   date NOT NULL,
    -- The entry it made. NOT NULL: a movement that posted nothing is a story.
    entry_id       uuid NOT NULL REFERENCES journal_entry (entry_id),
    evidence       text,
    note           text,
    recorded_by    text NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_principal_transaction_owner
    ON principal_transaction (principal_id, posting_date DESC);
CREATE INDEX IF NOT EXISTS ix_principal_transaction_entry
    ON principal_transaction (entry_id);

COMMENT ON TABLE principal IS
    'An owner or investor. Never a supplier: what they move is capital, drawings
     or a loan, none of which belongs in AP ageing.';
COMMENT ON TABLE principal_transaction IS
    'Capital in, drawings out, and principal lending — each with the entry it
     posted and the owner it belongs to.';
