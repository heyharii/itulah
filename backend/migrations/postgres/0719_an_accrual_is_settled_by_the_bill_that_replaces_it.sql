-- An accrual is settled by the bill that replaces it.
--
-- An accrual is a journal entry that credits an account linked to the role
-- `accrued_expense` (the client's YMHD accounts, 2022–2024): the month's
-- telephone, electricity or water booked before the supplier's bill arrives.
-- Until 1 Oct 2026 nothing ever took one back, so the month the bill was
-- posted the cost was in the books twice — once accrued, once billed — and the
-- YMHD balance only ever grew (owner, 2026-10-01: Payables › Accruals).
--
-- Settling one reverses the accrual entry (an ordinary REVERSAL, which a
-- soft-closed month still takes) and remembers which bill took its place. The
-- bill posts to Accounts Payable as it always did; the reversal only clears
-- YMHD and takes the accrued cost back out, so the month carries the billed
-- amount once. Whether an accrual is open is read from the journal — does a
-- reversal of it exist — and never stored, so this row cannot disagree with
-- the books. It holds only what the journal cannot: the bill.
CREATE TABLE accrual_settlement (
    entry_id          uuid PRIMARY KEY REFERENCES journal_entry(entry_id),
    reversal_entry_id uuid NOT NULL UNIQUE REFERENCES journal_entry(entry_id),
    -- Absent when the accrual was released without a bill: the cost turned out
    -- not to be owed, or was billed under something this list cannot see.
    invoice_id        uuid REFERENCES supplier_invoice(invoice_id),
    settled_by        text NOT NULL,
    settled_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_accrual_settlement_invoice ON accrual_settlement (invoice_id);
