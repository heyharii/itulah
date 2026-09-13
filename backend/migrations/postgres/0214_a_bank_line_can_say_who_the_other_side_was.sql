-- A bank line can say who the other side was.
--
-- ERPNext calls these two columns `Party type` and `Party`; the word in this
-- codebase is **counterparty** (CONTEXT.md, and `letters.rs` already uses it),
-- so that is what the columns are called. They are two of the nine columns on
-- ERPNext's reconciliation table, and ours have been drawn empty since the
-- screen was built: 0071 stored what the bank sent and nothing about who it was. That is
-- the column a person uses to recognise a line at a glance — "PEMASOK C" —
-- and the one ERPNext's matcher scores with.
--
-- # What may be written here, and what may not
--
-- The bank's own words stay untouchable. `value_date`, `description`,
-- `reference`, `debit_minor`, `credit_minor` and `fingerprint` are evidence:
-- they came out of a file the bank sent, the dedupe key is computed over them,
-- and a screen that could type over them would turn the statement into an
-- opinion. Everything added below is OUR reading of that evidence, kept beside
-- it and never on top of it — which is also why `counterparty_name` exists separately
-- from `bank_said`: one is what we concluded, the other is the string the bank
-- printed.

ALTER TABLE bank_statement_line
    -- Which register the other side lives in. Null means nobody has said yet,
    -- which is different from OTHER — that is somebody saying "not one of ours".
    ADD COLUMN counterparty_kind text
        CHECK (counterparty_kind IN ('SUPPLIER', 'CUSTOMER', 'MEMBER', 'STAFF', 'OTHER')),
    -- The record's id in that register, as text: the registers do not share a
    -- key type, and a line may name somebody who has no record at all.
    ADD COLUMN counterparty_id text,
    -- What we call them. Free text on purpose: the counterparty of a bank line
    -- is often not in any register of ours — a tax office, a landlord — and
    -- refusing to write the name until somebody creates a record is how a
    -- reconciliation stalls.
    ADD COLUMN counterparty_name text NOT NULL DEFAULT '',
    -- What the BANK called them, if the file said. Kept apart from
    -- `counterparty_name` so that correcting our reading never edits the evidence.
    ADD COLUMN bank_said text NOT NULL DEFAULT '',
    -- A person's note about this line. Not the memo of any journal entry —
    -- this one survives even when the line is never booked.
    ADD COLUMN note text NOT NULL DEFAULT '',
    ADD COLUMN counterparty_set_by text,
    ADD COLUMN counterparty_set_at timestamptz;

-- An id without a register is not an answer.
ALTER TABLE bank_statement_line
    ADD CONSTRAINT bank_statement_line_counterparty_id_needs_a_kind
    CHECK (counterparty_id IS NULL OR counterparty_kind IS NOT NULL);

-- The reconciliation screen filters and groups by counterparty, and a statement's
-- worth of lines is small — but every statement of every account for a year is
-- not, and the Bank Transactions list reads across all of them.
CREATE INDEX ix_bank_statement_line_counterparty
    ON bank_statement_line (counterparty_kind, counterparty_id)
    WHERE counterparty_kind IS NOT NULL;

COMMENT ON COLUMN bank_statement_line.counterparty_name IS
    'Our reading of who the other side was. The bank''s own string is in '
    'bank_said, and the two are deliberately not the same column.';
