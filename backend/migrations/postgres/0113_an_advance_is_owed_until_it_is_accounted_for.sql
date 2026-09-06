-- 0113: Money given out before it is spent, and the equation that closes it.
--
-- # What this is for
--
-- A shop is told to buy fittings, or somebody is sent to Jakarta, or a
-- contractor needs paying in stages. Head office transfers a sum for that
-- purpose, from an HO bank account, before anybody knows the exact cost. That
-- sum is not an expense — nothing has been consumed yet — it is a receivable:
-- whoever holds it owes head office either goods, receipts, or the money back.
--
-- The client's chart already knows this. `1011303 UANG MUKA / ADVANCED` has
-- four leaves — Travelling, Purchase, To Contractors, Others — and
-- `1011102001 PIUTANG PEGAWAI` is where a person, rather than a place, holds
-- it. None of them had a document behind them, so none of them had a balance
-- anybody could take apart.
--
-- # The equation
--
--     issued = spent + returned + outstanding
--
-- It is the whole point of the table, and it is checked rather than reported:
-- `returned_minor` may not exceed what is left after what has been spent, and
-- an advance is CLOSED exactly when outstanding reaches zero.
--
-- # Why "spent" is not a column
--
-- Because a store expense (0114) already records every rupiah of it, with a
-- category, a vendor, a photograph and an approver. A `spent_minor` column here
-- would be a second copy of that sum, and the two would part company the first
-- time an expense was rejected after being approved. So spending is defined as
-- the sum of POSTED store expenses drawn on this advance — one truth, derived
-- where it is needed.
--
-- This is the same decision `purchase_order` makes about received quantities
-- and `ledger_account` makes about balances, for the same reason.
--
-- # Postings
--
--   ISSUE   Dr advance_<purpose> (holder's site) / Cr bank (HO, qualified)
--           or, issued to a person, Dr employee_receivable (HO)
--   RETURN  Dr bank (HO, qualified)              / Cr the same advance meaning
--
-- Spending is posted by the expense (0114), which credits this same advance
-- meaning. So the advance account drains by exactly the two routes the equation
-- names, and its balance per site IS the outstanding figure — a report and the
-- ledger agreeing because they are reading the same rows, not because somebody
-- reconciled them.

CREATE TABLE operating_advance (
    advance_id      uuid PRIMARY KEY,
    -- `ADV-26-09-00001`.
    advance_number  text NOT NULL UNIQUE CHECK (btrim(advance_number) <> ''),

    -- Who holds it. A place, a person, or both — a shop manager sent to buy
    -- fittings for their own shop is genuinely both, and forcing a choice would
    -- lose whichever half was not chosen.
    --
    -- At least one is required: an advance nobody holds is money that has left
    -- the bank and is owed by no one.
    issued_to_site_id     text REFERENCES site(id),
    issued_to_employee_id text REFERENCES employee(id),
    CHECK (issued_to_site_id IS NOT NULL OR issued_to_employee_id IS NOT NULL),

    -- Which of the client's advance accounts this is. Not free text: the
    -- posting rule turns this into a semantic key, and a fifth purpose has to
    -- be a considered addition to the chart rather than a typo somebody made
    -- at half past five.
    --
    --   PURCHASE    1011303002 Advanced - Purchase
    --   TRAVEL      1011303001 Advanced - Travelling
    --   CONTRACTOR  1011303003 Advanced - To Contractors
    --   PERSONAL    1011102001 PIUTANG PEGAWAI — a person, not a purpose
    purpose_kind    text NOT NULL CHECK (purpose_kind IN
                        ('PURCHASE', 'TRAVEL', 'CONTRACTOR', 'PERSONAL')),
    -- What it is actually for, in words. The account says which drawer; this
    -- says what anybody has to account for.
    purpose         text NOT NULL CHECK (btrim(purpose) <> ''),

    amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
    returned_minor  bigint NOT NULL DEFAULT 0 CHECK (returned_minor >= 0),
    currency        char(3) NOT NULL DEFAULT 'IDR',

    -- Which HO account it came out of.
    bank_key        text NOT NULL CHECK (bank_key IN ('bank_giro', 'bank_savings')),
    bank_qualifier  text NOT NULL CHECK (btrim(bank_qualifier) <> ''),

    -- ISSUED   the money has gone out and nothing has come back
    -- PARTIAL  something has been spent or returned, and something is left
    -- CLOSED   outstanding is nil; the holder owes nothing
    status          text NOT NULL CHECK (status IN ('ISSUED', 'PARTIAL', 'CLOSED')),

    issued_by       text NOT NULL CHECK (btrim(issued_by) <> ''),
    issued_at       timestamptz NOT NULL DEFAULT now(),
    issue_date      date NOT NULL,
    -- When it has to be accounted for. What makes an ageing report possible,
    -- which is the only thing that makes an advance come back.
    due_date        date,

    issue_entry_id  uuid REFERENCES journal_entry(entry_id),
    closed_at       timestamptz,
    note            text,

    CHECK (returned_minor <= amount_minor),
    CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
    CHECK ((issue_entry_id IS NOT NULL) = (status IN ('ISSUED', 'PARTIAL', 'CLOSED'))),
    -- A personal advance is held by a person.
    CHECK (purpose_kind <> 'PERSONAL' OR issued_to_employee_id IS NOT NULL)
);

CREATE INDEX ix_advance_site_status ON operating_advance (issued_to_site_id, status, issue_date DESC);
CREATE INDEX ix_advance_employee ON operating_advance (issued_to_employee_id)
    WHERE issued_to_employee_id IS NOT NULL;
-- The ageing list: still owed, and past its date.
CREATE INDEX ix_advance_outstanding ON operating_advance (due_date)
    WHERE status <> 'CLOSED';

COMMENT ON TABLE operating_advance IS
    'Money issued for a stated purpose before it is spent. Issued = spent + '
    'returned + outstanding; spent is summed from the store expenses drawn on '
    'it, never stored here.';

-- Money handed back.
--
-- Its own table rather than a column, because an advance comes back in pieces —
-- some cash on Tuesday, the rest when the job finishes — and each piece is a
-- bank line somebody will have to reconcile. `operating_advance.returned_minor`
-- is the running total these keep, maintained by the trigger below rather than
-- by whichever code path remembered.
CREATE TABLE operating_advance_return (
    return_id        uuid PRIMARY KEY,
    advance_id       uuid NOT NULL REFERENCES operating_advance(advance_id) ON DELETE CASCADE,
    amount_minor     bigint NOT NULL CHECK (amount_minor > 0),
    return_date      date NOT NULL,
    received_by      text NOT NULL CHECK (btrim(received_by) <> ''),
    received_at      timestamptz NOT NULL DEFAULT now(),
    journal_entry_id uuid NOT NULL REFERENCES journal_entry(entry_id),
    note             text
);

CREATE INDEX ix_advance_return_advance ON operating_advance_return (advance_id, return_date);

CREATE FUNCTION operating_advance_returned_total() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    target uuid := COALESCE(NEW.advance_id, OLD.advance_id);
BEGIN
    UPDATE operating_advance a
       SET returned_minor = COALESCE(
               (SELECT SUM(r.amount_minor) FROM operating_advance_return r
                 WHERE r.advance_id = target), 0)
     WHERE a.advance_id = target;
    RETURN NULL;
END;
$$;

-- AFTER, and STATEMENT-level would not do: the CHECK on `returned_minor` has to
-- see the new total, and it is the row constraint that refuses an overpayment
-- rather than a read-then-write in Rust that two concurrent returns would both
-- pass.
CREATE TRIGGER operating_advance_returned_total
    AFTER INSERT OR UPDATE OR DELETE ON operating_advance_return
    FOR EACH ROW EXECUTE FUNCTION operating_advance_returned_total();

COMMENT ON TABLE operating_advance_return IS
    'One repayment against an advance. The advance''s returned_minor is kept by '
    'trigger from these rows, so the total cannot disagree with its parts.';
