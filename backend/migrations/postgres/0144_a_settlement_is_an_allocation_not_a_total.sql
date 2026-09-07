-- 0144: How an open balance gets closed, and why that is a table.
--
-- # Why the settlement is not a column on the entry
--
-- Because the ordinary case is many-to-many and always was. One transfer clears
-- four bills; one bill gets paid in three instalments; one acquirer settlement
-- covers a week of card takings. A pair of `against_voucher` columns on the
-- open item can hold exactly one of those, so a schema that stopped there would
-- force the first partial payment to either overwrite the last settlement or
-- split the open item — and splitting an item to record a payment is how a
-- sub-ledger stops agreeing with the document it came from.
--
-- So the allocation is the row. `payment_ledger_entry.against_voucher_kind` and
-- `against_voucher_id` remain, maintained from here, naming the last document
-- that settled the item — which is what a list wants to print. The history is
-- this table, and it is the answer to "what did this payment actually pay for".
--
-- # Why `settled_minor` is re-summed and never incremented
--
-- `UPDATE ... SET settled_minor = settled_minor + NEW.amount_minor` is one
-- retry, one double-fired trigger or one hand-written correction away from a
-- figure that no row supports. Re-summing costs an index scan over the
-- allocations of one item — a handful of rows — and buys a column that cannot
-- drift from the rows it summarises. It is the same bargain 0051 makes when it
-- checks a journal header against its lines at COMMIT.
--
-- # Why over-settlement is refused here and not only in Rust
--
-- Because a CHECK constraint refusing it arrives as SQLSTATE 23514, which
-- `AppError::into_response` renders as "database operation failed" — true, and
-- no use to the person who typed 12,000,000 against a bill with 8,000,000 left.
-- `RAISE EXCEPTION` is P0001, which that path passes through verbatim. The
-- CHECK on `payment_ledger_entry` stays as the guarantee; this is the
-- explanation, exactly as `poster::check_balanced` sits in front of the
-- deferred balance trigger.

CREATE TABLE payment_ledger_settlement (
    settlement_id     uuid PRIMARY KEY,
    entry_id          uuid NOT NULL REFERENCES payment_ledger_entry(entry_id),

    -- The document doing the settling: a payment, an acquirer settlement, a
    -- store manager's return of what was left.
    against_voucher_kind text NOT NULL CHECK (btrim(against_voucher_kind) <> ''),
    against_voucher_id   text NOT NULL CHECK (btrim(against_voucher_id) <> ''),

    amount_minor      bigint NOT NULL CHECK (amount_minor > 0),

    -- The GL entry the settling document posted, in the same transaction as
    -- this row. Same rule as the open item: both or neither.
    journal_entry_id  uuid NOT NULL REFERENCES journal_entry(entry_id),
    posting_date      date NOT NULL,

    -- Reversal of the settling document. The allocation stops counting and the
    -- open item comes back, which is exactly what a bounced payment means.
    delinked          boolean NOT NULL DEFAULT false,
    delinked_reason   text,
    delinked_by       text,
    delinked_at       timestamptz,
    -- The posting date of the cancellation, for the same reason the open item
    -- carries one: "as at" has to be able to wind both sides back.
    delinked_on       date,

    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        text NOT NULL CHECK (btrim(created_by) <> ''),

    CHECK (delinked = (delinked_at IS NOT NULL)),
    CHECK (delinked = (delinked_by IS NOT NULL)),
    CHECK (delinked = (delinked_on IS NOT NULL)),

    -- One document settles one open item once. A retried post finds the row
    -- already there instead of allocating the same money twice, which is the
    -- same guarantee the unique key on `payment_ledger_entry` gives the opening
    -- side. A document that genuinely pays one item twice is two documents.
    UNIQUE (entry_id, against_voucher_kind, against_voucher_id)
);

CREATE INDEX ix_payment_ledger_settlement_entry
    ON payment_ledger_settlement (entry_id);
-- "What did this payment pay for": the settlement history per voucher.
CREATE INDEX ix_payment_ledger_settlement_voucher
    ON payment_ledger_settlement (against_voucher_kind, against_voucher_id);
CREATE INDEX ix_payment_ledger_settlement_journal
    ON payment_ledger_settlement (journal_entry_id);

-- ---------------------------------------------------------------------------
-- An open item is evidence once it is written.
-- ---------------------------------------------------------------------------
--
-- Everything that identifies the balance — which account, which party, which
-- document, how much, and the journal entry beside it — is frozen. What moves
-- is what settlement and cancellation move, and nothing else. A ledger whose
-- amounts could be edited after the journal quoted them is a ledger that can be
-- made to agree with anything.
CREATE OR REPLACE FUNCTION protect_payment_ledger_entry() RETURNS trigger AS $$
BEGIN
    IF NEW.account_key      IS DISTINCT FROM OLD.account_key
    OR NEW.qualifier        IS DISTINCT FROM OLD.qualifier
    OR NEW.site_id          IS DISTINCT FROM OLD.site_id
    OR NEW.party_type       IS DISTINCT FROM OLD.party_type
    OR NEW.party_id         IS DISTINCT FROM OLD.party_id
    OR NEW.voucher_kind     IS DISTINCT FROM OLD.voucher_kind
    OR NEW.voucher_id       IS DISTINCT FROM OLD.voucher_id
    OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
    OR NEW.side             IS DISTINCT FROM OLD.side
    OR NEW.amount_minor     IS DISTINCT FROM OLD.amount_minor
    OR NEW.posting_date     IS DISTINCT FROM OLD.posting_date
    THEN
        RAISE EXCEPTION
            'payment ledger entry % is in the books already; settle it or delink it, but its amount and the account it sits on cannot be edited',
            OLD.entry_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_ledger_entry_is_evidence
    BEFORE UPDATE ON payment_ledger_entry
    FOR EACH ROW EXECUTE FUNCTION protect_payment_ledger_entry();

-- The same for an allocation: the amount and what it answered are fixed, and
-- the only thing that may change is whether it still counts.
CREATE OR REPLACE FUNCTION protect_payment_ledger_settlement() RETURNS trigger AS $$
BEGIN
    IF NEW.entry_id             IS DISTINCT FROM OLD.entry_id
    OR NEW.against_voucher_kind IS DISTINCT FROM OLD.against_voucher_kind
    OR NEW.against_voucher_id   IS DISTINCT FROM OLD.against_voucher_id
    OR NEW.amount_minor         IS DISTINCT FROM OLD.amount_minor
    OR NEW.journal_entry_id     IS DISTINCT FROM OLD.journal_entry_id
    THEN
        RAISE EXCEPTION
            'payment ledger settlement % is in the books already; delink it and allocate again rather than editing it',
            OLD.settlement_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_ledger_settlement_is_evidence
    BEFORE UPDATE ON payment_ledger_settlement
    FOR EACH ROW EXECUTE FUNCTION protect_payment_ledger_settlement();

-- ---------------------------------------------------------------------------
-- What is settled, re-summed from the allocations after every change.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION payment_ledger_resettle() RETURNS trigger AS $$
DECLARE
    target     uuid   := COALESCE(NEW.entry_id, OLD.entry_id);
    open_item  payment_ledger_entry%ROWTYPE;
    allocated  bigint;
    last_kind  text;
    last_id    text;
BEGIN
    -- Locked before the sum, so two settlements racing for the last of a
    -- balance are ordered rather than both seeing it free. Without this, the
    -- CHECK would still catch the overrun — at COMMIT, naming a constraint
    -- instead of a bill.
    SELECT * INTO open_item
      FROM payment_ledger_entry
     WHERE entry_id = target
       FOR UPDATE;

    SELECT COALESCE(SUM(s.amount_minor), 0)
      INTO allocated
      FROM payment_ledger_settlement s
     WHERE s.entry_id = target
       AND NOT s.delinked;

    -- Placing or reinstating an allocation against a cancelled item is refused;
    -- taking one away is not. The distinction matters: reversing the payment
    -- that settled a bill which was itself later reversed is an ordinary tidy-up
    -- and must not be blocked by the rule that stops new money being allocated
    -- to a balance nobody owes any more.
    IF open_item.delinked AND TG_OP <> 'DELETE' AND NOT NEW.delinked THEN
        RAISE EXCEPTION
            'payment ledger entry % was cancelled; there is nothing left to settle against it',
            target;
    END IF;

    IF allocated > open_item.amount_minor THEN
        RAISE EXCEPTION
            'allocating % would settle more than the % this % % opened; % is already allocated',
            allocated, open_item.amount_minor, open_item.voucher_kind,
            open_item.voucher_id, open_item.settled_minor;
    END IF;

    -- The last document still standing against the item, for the list column.
    -- Ordered by the date it posted and then by when it was written, because
    -- two settlements can share a posting date and a list still has to print
    -- one of them.
    SELECT s.against_voucher_kind, s.against_voucher_id
      INTO last_kind, last_id
      FROM payment_ledger_settlement s
     WHERE s.entry_id = target
       AND NOT s.delinked
     ORDER BY s.posting_date DESC, s.created_at DESC, s.settlement_id DESC
     LIMIT 1;

    UPDATE payment_ledger_entry
       SET settled_minor        = allocated,
           against_voucher_kind = last_kind,
           against_voucher_id   = last_id
     WHERE entry_id = target;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_ledger_settlement_moves_the_balance
    AFTER INSERT OR UPDATE OR DELETE ON payment_ledger_settlement
    FOR EACH ROW EXECUTE FUNCTION payment_ledger_resettle();

COMMENT ON TABLE payment_ledger_settlement IS
    'One allocation of one settling document against one open item. Many-to-many on purpose: a transfer clears several bills and a bill is paid in instalments. payment_ledger_entry.settled_minor is re-summed from these rows by trigger.';
COMMENT ON COLUMN payment_ledger_settlement.delinked IS
    'The settling document was reversed. The allocation stops counting and the open item comes back — which is what a bounced payment means.';
