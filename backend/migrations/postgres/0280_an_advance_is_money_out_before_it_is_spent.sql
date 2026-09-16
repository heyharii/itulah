-- An advance is money out before anybody knows what it was spent on.
--
-- # What exists, and what does not
--
-- Supplier advances exist: `SUPPLIER_ADVANCE` is a source kind, the payables
-- lane pays one against a purchase order, and `1011303002 Advanced - Purchase`
-- holds it. What has no home is every other advance the client actually gives
-- out — a driver's travel money, a contractor's down payment, a shop manager
-- told to buy something and bring back receipts. The chart has the accounts
-- (`1011303001` travelling, `003` to contractors, `004` others) and nothing
-- writes them except a hand-keyed journal.
--
-- # The shape
--
-- One table for the advance, one for what came back. An advance is not settled
-- by editing it: each settlement is a row with its own posting, so a partial
-- settlement is two rows and the outstanding balance is arithmetic over facts
-- rather than a column somebody has to remember to update.
--
-- Two ways money comes back, and they post differently:
--
--   EXPENSE  Dr <the expense, or the asset>   Cr Advance   receipts arrived
--   REFUND   Dr Cash / Bank                   Cr Advance   change came back
--
-- # Who it was given to
--
-- Typed, and not a generic party. An advance names an EMPLOYEE (the estate has
-- one), a SUPPLIER (it has one of those too), or — for the cases neither
-- covers — a name and nothing else, which is honest about what we know. A
-- generic `party` table with a `kind` column would make all three the same
-- thing and lose the foreign keys that stop a typo becoming a debtor.
--
-- # Aging
--
-- Derivable, not stored: `paid_at` is on the row and outstanding is arithmetic,
-- so "older than 30 days" is a query and can never disagree with the balance.

CREATE TABLE IF NOT EXISTS advance (
    advance_id     uuid PRIMARY KEY,
    advance_number text NOT NULL UNIQUE CHECK (btrim(advance_number) <> ''),
    site_id        text NOT NULL REFERENCES site (id),

    -- Exactly one identity. The CHECK is the whole point of not having a
    -- generic party: a row cannot be half an employee and half a supplier.
    party_kind     text NOT NULL CHECK (party_kind IN ('EMPLOYEE', 'SUPPLIER', 'OTHER')),
    -- `employee.id` is TEXT in this estate (the person's code), so the
    -- reference is text and not a uuid. Typed all the same: the foreign key
    -- is what stops a typo becoming a debtor.
    employee_id    text REFERENCES employee (id),
    supplier_id    uuid REFERENCES supplier (supplier_id),
    party_name     text,

    -- Which advance account it sits in, as a meaning plus its qualifier —
    -- `advance` is mapped per place and narrowed by purpose (PERJALANAN,
    -- PURCHASE, CONTRACTORS, OTHERS), which is how the client's four accounts
    -- are told apart.
    advance_qualifier text NOT NULL DEFAULT '',
    purpose        text NOT NULL CHECK (btrim(purpose) <> ''),

    currency       char(3) NOT NULL DEFAULT 'IDR',
    amount_minor   bigint NOT NULL CHECK (amount_minor > 0),

    status         text NOT NULL DEFAULT 'REQUESTED'
                       CHECK (status IN ('REQUESTED', 'APPROVED', 'PAID',
                                         'PARTIALLY_SETTLED', 'SETTLED', 'CANCELLED')),

    requested_by   text NOT NULL CHECK (btrim(requested_by) <> ''),
    requested_at   timestamptz NOT NULL DEFAULT now(),
    approved_by    text,
    approved_at    timestamptz,
    -- The payment: when the money left, and the entry that says so.
    paid_at        timestamptz,
    paid_by        text,
    paid_entry_id  uuid REFERENCES journal_entry (entry_id),
    cancelled_at   timestamptz,
    cancelled_by   text,
    cancel_reason  text,
    note           text,

    CHECK ((party_kind = 'EMPLOYEE') = (employee_id IS NOT NULL)),
    CHECK ((party_kind = 'SUPPLIER') = (supplier_id IS NOT NULL)),
    CHECK ((party_kind = 'OTHER') = (btrim(coalesce(party_name, '')) <> '')),
    CHECK ((approved_at IS NULL) = (approved_by IS NULL)),
    CHECK ((paid_at IS NULL) = (paid_entry_id IS NULL)),
    CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
    CHECK (cancelled_at IS NULL OR btrim(coalesce(cancel_reason, '')) <> '')
);

CREATE INDEX IF NOT EXISTS ix_advance_site ON advance (site_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS ix_advance_employee ON advance (employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_advance_supplier ON advance (supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_advance_open ON advance (paid_at)
    WHERE status IN ('PAID', 'PARTIALLY_SETTLED');

CREATE TABLE IF NOT EXISTS advance_settlement (
    settlement_id  uuid PRIMARY KEY,
    advance_id     uuid NOT NULL REFERENCES advance (advance_id),
    -- EXPENSE: receipts came back. REFUND: money came back.
    kind           text NOT NULL CHECK (kind IN ('EXPENSE', 'REFUND')),
    amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
    -- Where the expense landed. Null on a refund, which lands in cash.
    account_code   text,
    account_is_group boolean NOT NULL DEFAULT false CHECK (account_is_group = false),
    -- The meaning the refund went back into, when it is one.
    cash_key       text,
    cash_qualifier text NOT NULL DEFAULT '',
    entry_id       uuid NOT NULL REFERENCES journal_entry (entry_id),
    evidence       text,
    note           text,
    settled_by     text NOT NULL CHECK (btrim(settled_by) <> ''),
    settled_at     timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (account_code, account_is_group)
        REFERENCES ledger_account (account_code, is_group),
    CHECK ((kind = 'EXPENSE') = (account_code IS NOT NULL)),
    CHECK ((kind = 'REFUND') = (cash_key IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ix_advance_settlement_advance ON advance_settlement (advance_id);

CREATE SEQUENCE IF NOT EXISTS advance_number_seq;

COMMENT ON TABLE advance IS
    'Money given out before it is spent, to somebody this estate can name. The
     outstanding balance is arithmetic over its settlements, never a column.';
COMMENT ON TABLE advance_settlement IS
    'What came back: receipts (EXPENSE) or change (REFUND), each with the entry
     it posted.';
