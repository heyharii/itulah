-- A facility is borrowed once and repaid on a schedule.
--
-- # What the evidence says
--
-- The chart carries `2022401001 Pinjaman Jangka Panjang Principal`,
-- `2022402001 ... Bank BCA`, their current portions at `2012501001`/`2012502001`,
-- and two interest accounts: `8020111001 Biaya Bunga Pinjaman Bank` and
-- `8020111002 Biaya Bunga Leasing`. So the chart anticipates bank loans,
-- principal loans and leases.
--
-- LEASE IS BUILT AND LEFT DORMANT. There is no lease contract in evidence —
-- `docs/finance-client-decisions.md` asks for one — and building an asset-side
-- lease model (right-of-use, its own depreciation) on the strength of an
-- interest account would be inventing a business fact. The type is allowed here
-- because a facility with instalments is the same shape whoever lent the money;
-- what a lease would ADD is not built.
--
-- # The shape
--
-- A facility is the agreement; an instalment is one due date on it. Splitting
-- them is what lets the two halves of a payment be posted separately and
-- correctly:
--
--   Dr <loan principal>   the part that reduces the debt
--   Dr <interest>         the part that is this month's cost of the money
--   Cr <bank>             what actually left
--
-- Interest is NOT accrued here on its own. It is recognised when the instalment
-- posts, which is what the client does today and what their chart's single
-- interest account supports. An accrual model can be added when a period close
-- needs one; it would be one more row kind, not another table.
--
-- # Current and non-current
--
-- Derivable rather than stored: an instalment due within twelve months of a
-- date is current, and the chart's `20125*` (jatuh tempo) against `20224*` is
-- the presentation of that. Storing the split would freeze an answer that
-- changes with the calendar.

CREATE TABLE IF NOT EXISTS financing_facility (
    facility_id     uuid PRIMARY KEY,
    facility_number text NOT NULL UNIQUE CHECK (btrim(facility_number) <> ''),
    kind            text NOT NULL CHECK (kind IN ('BANK_LOAN', 'LEASE', 'PRINCIPAL_LOAN')),

    -- Who lent it. A bank facility names a bank institution; a principal loan
    -- names an owner. Exactly one, for the reason `advance` gives.
    bank_id         uuid REFERENCES bank (bank_id),
    principal_id    uuid REFERENCES principal (principal_id),
    lender_name     text,

    -- Whose books it sits in. Company-wide today: head office borrows.
    site_id         text NOT NULL REFERENCES site (id),

    currency        char(3) NOT NULL DEFAULT 'IDR',
    principal_minor bigint NOT NULL CHECK (principal_minor > 0),
    rate_bps        integer NOT NULL DEFAULT 0 CHECK (rate_bps >= 0 AND rate_bps <= 100000),
    start_date      date NOT NULL,
    maturity_date   date NOT NULL,

    -- The meanings the two halves of a payment post through, so no Rust names
    -- an account code: the qualifier tells `2022401001` from `2022402001`.
    principal_key       text NOT NULL DEFAULT 'loan_principal',
    principal_qualifier text NOT NULL DEFAULT '',
    interest_key        text NOT NULL DEFAULT 'interest_expense',
    interest_qualifier  text NOT NULL DEFAULT '',

    status          text NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'CLOSED', 'CANCELLED')),
    note            text,
    created_by      text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at      timestamptz NOT NULL DEFAULT now(),
    closed_at       timestamptz,
    closed_by       text,

    CHECK (maturity_date >= start_date),
    CHECK ((kind = 'PRINCIPAL_LOAN') = (principal_id IS NOT NULL)),
    CHECK (kind = 'PRINCIPAL_LOAN' OR bank_id IS NOT NULL OR btrim(coalesce(lender_name,'')) <> ''),
    CHECK ((closed_at IS NULL) = (closed_by IS NULL))
);

CREATE INDEX IF NOT EXISTS ix_financing_facility_status
    ON financing_facility (status, maturity_date);

CREATE TABLE IF NOT EXISTS financing_installment (
    installment_id  uuid PRIMARY KEY,
    facility_id     uuid NOT NULL REFERENCES financing_facility (facility_id),
    seq             integer NOT NULL CHECK (seq > 0),
    due_date        date NOT NULL,
    principal_minor bigint NOT NULL CHECK (principal_minor >= 0),
    interest_minor  bigint NOT NULL CHECK (interest_minor >= 0),
    -- Paid when the entry exists, and not before. One column, one truth.
    entry_id        uuid REFERENCES journal_entry (entry_id),
    paid_on         date,
    paid_by         text,

    UNIQUE (facility_id, seq),
    CHECK (principal_minor + interest_minor > 0),
    CHECK ((entry_id IS NULL) = (paid_on IS NULL)),
    CHECK ((entry_id IS NULL) = (paid_by IS NULL))
);

CREATE INDEX IF NOT EXISTS ix_financing_installment_due
    ON financing_installment (facility_id, due_date);
CREATE INDEX IF NOT EXISTS ix_financing_installment_open
    ON financing_installment (due_date) WHERE entry_id IS NULL;

CREATE SEQUENCE IF NOT EXISTS financing_facility_number_seq;

COMMENT ON TABLE financing_facility IS
    'Money borrowed on terms: a bank loan, a principal loan, or a lease. Lease is
     allowed and left dormant — no contract is in evidence, and building the
     asset side of one would be inventing a business fact.';
COMMENT ON TABLE financing_installment IS
    'One due date: how much of it repays the debt and how much is the cost of
     the money. Posted as one entry with both halves named separately.';
