-- 0084: Money leaving. The other half of a supplier bill.
--
-- # What was missing
--
-- 0052 gave finance a bill that goes DRAFT -> POSTED, and at POSTED it credits
-- `trade_payable` and stops. There was no document for paying it, so the
-- payable only ever grew: twenty-two finance endpoints and not one that
-- recorded money leaving. Every supplier balance in the system was therefore a
-- purchases total wearing a payables label.
--
-- # Why a payment is its own document, and not a status on the bill
--
-- Because one payment settles several bills and one bill is settled by several
-- payments, and a column on either side can express neither. A transfer of
-- 50,000,000 that clears three invoices is one bank line, one journal entry and
-- one thing the bank statement will be reconciled against; modelled as three
-- part-payments it would be three entries that have to be recognised as one
-- again by whoever does the reconciliation.
--
-- So: a header saying what left and from where, and an allocation child saying
-- which debts it answered. The same shape as the journal itself — one entry,
-- many lines.
--
-- # Why the rules are here and not only in Rust
--
-- Same argument as 0051. Application validation is where an invariant lives
-- until the day somebody opens psql, or a second writer appears, or a migration
-- back-fills. Over-paying a supplier is not a display bug; it is money gone.
-- The four rules below are therefore enforced by the database:
--
--   * a payment's allocations sum to the payment (deferred to COMMIT, because
--     the allocations do not exist when the header is inserted);
--   * an allocation cannot exceed what the bill still has outstanding, counting
--     every other payment already pointing at it;
--   * only a POSTED bill can be paid, at the payment's own site, in the
--     payment's own currency;
--   * a posted payment is evidence and stops moving.
--
-- # Scope, stated rather than assumed
--
-- One payment leaves one account at one site on one date, and may settle
-- several bills, in part or in full. No foreign exchange, no withholding tax,
-- no settlement discount, no bank charge split out. Each of those is a real
-- thing an Indonesian retailer meets — PPh 23 on services and a supplier
-- charging for the transfer, most of all — and each would put a second account
-- in the entry. None of them is guessed at here: a payment records what left
-- the bank, and when one of them is needed it is a new column, a semantic key
-- and one more line in the posting rule, with nothing below undone.

CREATE SEQUENCE supplier_payment_number_seq;

CREATE TABLE supplier_payment (
    payment_id      uuid PRIMARY KEY,
    -- `PV-00000001`. Ours, not the bank's: gaps are possible and harmless, in
    -- the same way `journal_entry_number` tolerates them.
    payment_number  text NOT NULL UNIQUE CHECK (btrim(payment_number) <> ''),

    -- Which location's money this is. Not decoration: the client's account
    -- codes carry the location, they keep a cash and bank balance per site, and
    -- the journal line has to say where the cash left from.
    site_id         text NOT NULL REFERENCES site(id),

    payment_date    date NOT NULL,

    -- The instrument. Distinct from the account below, because the same current
    -- account is emptied by transfer one day and by cheque the next, and a
    -- reconciler chasing an uncleared cheque needs to know which it was.
    method          text NOT NULL CHECK (method IN
                        ('TRANSFER', 'CASH', 'CHEQUE', 'GIRO', 'OTHER')),

    -- WHICH pot, said the only way this system is allowed to say it: a meaning
    -- and a qualifier, resolved through `account_map` at posting time. Storing
    -- the client's account code here instead would put a second copy of the map
    -- in a document table, and the copy would still name `101100200107` on the
    -- day Finance moved the BCA current account somewhere else.
    --
    -- Constrained to the four meanings that hold money. Without it a payment
    -- could claim to have come out of `inventory`, and the entry would balance.
    account_key       text NOT NULL CHECK (account_key IN
                          ('bank_giro', 'bank_savings', 'cash', 'petty_cash')),
    -- Which bank. Empty for cash, which needs no narrowing.
    account_qualifier text NOT NULL DEFAULT '',

    currency        char(3) NOT NULL,
    total_minor     bigint NOT NULL CHECK (total_minor > 0),

    -- DRAFT   keyed in, allocated, not yet in the ledger
    -- POSTED  in the ledger, and frozen
    --
    -- No VOID. Reversing a payment means reversing its journal entry, and that
    -- act does not exist yet for bills either; adding a status the code cannot
    -- reach would be a promise the module does not keep.
    status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED')),

    journal_entry_id uuid REFERENCES journal_entry(entry_id),

    -- The bank's own reference, when there is one. What ties this row to a line
    -- on a statement during reconciliation.
    reference       text,
    note            text,

    recorded_by     text NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at     timestamptz NOT NULL DEFAULT now(),
    posted_by       text,
    posted_at       timestamptz,

    -- The account must be one somebody actually mapped, for this site, with
    -- this qualifier. A composite foreign key rather than a check in Rust: the
    -- same guarantee `journal_line` gets from `ledger_account`.
    FOREIGN KEY (account_key, site_id, account_qualifier)
        REFERENCES account_map (semantic_key, site_id, qualifier),

    -- Posted and in the ledger are the same fact, so they cannot disagree.
    CHECK ((status = 'POSTED') = (journal_entry_id IS NOT NULL)),
    CHECK ((posted_at IS NULL) = (posted_by IS NULL)),
    CHECK ((status = 'POSTED') = (posted_at IS NOT NULL))
);
CREATE INDEX ix_supplier_payment_site_date ON supplier_payment (site_id, payment_date DESC);
CREATE INDEX ix_supplier_payment_status ON supplier_payment (status, payment_date DESC);

-- Which debt this money answered.
--
-- The primary key is (payment, invoice): one payment names a bill once, and an
-- extra 5,000,000 against the same bill is a bigger allocation, not a second
-- row that somebody has to remember to add up.
CREATE TABLE supplier_payment_allocation (
    payment_id   uuid NOT NULL REFERENCES supplier_payment(payment_id) ON DELETE CASCADE,
    invoice_id   uuid NOT NULL REFERENCES supplier_invoice(invoice_id),
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    PRIMARY KEY (payment_id, invoice_id)
);
CREATE INDEX ix_supplier_payment_allocation_invoice
    ON supplier_payment_allocation (invoice_id);

-- ---------------------------------------------------------------------------
-- Invariant one: a payment is exactly its allocations.
-- ---------------------------------------------------------------------------
--
-- Deferred, and on both tables, for the reasons given at length in 0051: the
-- allocations do not exist when the header is inserted, and checking only one
-- side leaves a hole — a header with no allocations, or allocations appended to
-- a payment that already committed.
--
-- P0001 on purpose. `AppError::into_response` recognises exactly that SQLSTATE
-- and passes the message through as a 409, so what a person reads is the
-- sentence below. A more precise-looking ERRCODE would arrive as an opaque 500.

CREATE OR REPLACE FUNCTION assert_payment_allocated() RETURNS trigger AS $$
DECLARE
    header    bigint;
    allocated bigint;
    parts     bigint;
    target    uuid;
BEGIN
    target := NEW.payment_id;

    SELECT total_minor INTO header FROM supplier_payment WHERE payment_id = target;
    -- The payment may have been rolled back out from under its allocations;
    -- there is then nothing to check.
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT COUNT(*), COALESCE(SUM(amount_minor), 0) INTO parts, allocated
      FROM supplier_payment_allocation WHERE payment_id = target;

    IF parts = 0 THEN
        RAISE EXCEPTION
            'payment % settles no bill; a payment that answers no debt is a bank line, not a payment',
            target;
    END IF;
    IF allocated <> header THEN
        RAISE EXCEPTION
            'payment % is % but its allocations total %; every rupiah that leaves must be against a bill',
            target, header, allocated;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER supplier_payment_is_allocated
    AFTER INSERT ON supplier_payment
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_payment_allocated();

CREATE CONSTRAINT TRIGGER supplier_payment_allocation_totals
    AFTER INSERT OR UPDATE ON supplier_payment_allocation
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_payment_allocated();

-- ---------------------------------------------------------------------------
-- Invariant two: a bill can be paid once, only when posted, and only here.
-- ---------------------------------------------------------------------------
--
-- Not deferred: this one can be decided the moment the allocation is written,
-- and deciding it early means the refusal names the bill somebody just chose
-- rather than arriving at COMMIT naming a transaction.
--
-- FOR UPDATE on the bill, not a plain read — the same argument `assert_period_open`
-- makes about a closing month. Two payments allocating the last 10,000,000 of
-- the same bill at the same instant would both read an outstanding of
-- 10,000,000 and both be allowed; the lock makes one of them wait and then see
-- the other's allocation.

CREATE OR REPLACE FUNCTION assert_allocation_fits() RETURNS trigger AS $$
DECLARE
    bill      supplier_invoice%ROWTYPE;
    pay       supplier_payment%ROWTYPE;
    allocated bigint;
BEGIN
    SELECT * INTO bill FROM supplier_invoice
     WHERE invoice_id = NEW.invoice_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'no supplier bill %', NEW.invoice_id;
    END IF;

    SELECT * INTO pay FROM supplier_payment WHERE payment_id = NEW.payment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'no payment %', NEW.payment_id;
    END IF;

    -- Only a posted bill is a debt. A DRAFT bill is a piece of paper somebody
    -- is still checking, and paying it would credit cash against a payable the
    -- ledger has never heard of.
    IF bill.status <> 'POSTED' THEN
        RAISE EXCEPTION
            'bill % is %, not posted; a bill that is not in the ledger is not yet owed',
            bill.invoice_number, lower(bill.status);
    END IF;

    -- One payment, one site. The entry debits `trade_payable` at the payment's
    -- site, so settling a shop's bill out of head office would clear a payable
    -- the shop still carries and leave head office carrying one it never
    -- raised. Doing that properly needs the client's inter-unit accounts and is
    -- deliberately out of scope; refusing is honest, silently mis-posting is not.
    IF bill.site_id <> pay.site_id THEN
        RAISE EXCEPTION
            'bill % belongs to % and the payment is from %; pay a location''s bills from that location',
            bill.invoice_number, bill.site_id, pay.site_id;
    END IF;

    IF bill.currency <> pay.currency THEN
        RAISE EXCEPTION
            'bill % is in % and the payment is in %; there is no exchange rate in this ledger',
            bill.invoice_number, bill.currency, pay.currency;
    END IF;

    -- Everything else already pointing at this bill, from any payment that has
    -- not been thrown away. A DRAFT counts: two drafts that each fully allocate
    -- the same bill would both be postable, and the second would post a payable
    -- to nothing.
    SELECT COALESCE(SUM(a.amount_minor), 0) INTO allocated
      FROM supplier_payment_allocation a
      JOIN supplier_payment p ON p.payment_id = a.payment_id
     WHERE a.invoice_id = NEW.invoice_id
       AND p.status IN ('DRAFT', 'POSTED')
       AND NOT (a.payment_id = NEW.payment_id AND a.invoice_id = NEW.invoice_id);

    IF allocated + NEW.amount_minor > bill.total_minor THEN
        RAISE EXCEPTION
            'bill % is % and already has % allocated against it; % more would over-pay it by %',
            bill.invoice_number, bill.total_minor, allocated, NEW.amount_minor,
            allocated + NEW.amount_minor - bill.total_minor;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER supplier_payment_allocation_fits
    BEFORE INSERT OR UPDATE ON supplier_payment_allocation
    FOR EACH ROW EXECUTE FUNCTION assert_allocation_fits();

-- ---------------------------------------------------------------------------
-- Invariant three: a posted payment is evidence.
-- ---------------------------------------------------------------------------
--
-- Same shape and same argument as `protect_posted_supplier_invoice` in 0052.
-- The journal entry quotes these amounts and cannot move, so neither can they.
-- Posting itself is an UPDATE, so the guard fires on what the row WAS: only a
-- row that was already posted is frozen.

CREATE OR REPLACE FUNCTION protect_posted_supplier_payment() RETURNS trigger AS $$
BEGIN
    IF OLD.status = 'POSTED' AND (
           NEW.total_minor       IS DISTINCT FROM OLD.total_minor
        OR NEW.site_id           IS DISTINCT FROM OLD.site_id
        OR NEW.payment_date      IS DISTINCT FROM OLD.payment_date
        OR NEW.account_key       IS DISTINCT FROM OLD.account_key
        OR NEW.account_qualifier IS DISTINCT FROM OLD.account_qualifier
        OR NEW.currency          IS DISTINCT FROM OLD.currency
        OR NEW.payment_number    IS DISTINCT FROM OLD.payment_number
        OR NEW.status            IS DISTINCT FROM OLD.status
        OR NEW.journal_entry_id  IS DISTINCT FROM OLD.journal_entry_id
    ) THEN
        RAISE EXCEPTION
            'payment % is posted; reverse its journal entry rather than editing what left the bank',
            OLD.payment_number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER supplier_payment_posted_is_evidence
    BEFORE UPDATE ON supplier_payment
    FOR EACH ROW EXECUTE FUNCTION protect_posted_supplier_payment();

-- The allocations are half of that evidence: which debts the money answered is
-- exactly what the journal's `trade_payable` lines say, and moving one after
-- the fact would leave the sub-ledger and the general ledger disagreeing about
-- a supplier while the trial balance still balanced — the failure that survives
-- a year.
CREATE OR REPLACE FUNCTION protect_posted_payment_allocation() RETURNS trigger AS $$
DECLARE
    row_state  text;
    row_number text;
BEGIN
    SELECT status, payment_number INTO row_state, row_number
      FROM supplier_payment
     WHERE payment_id = COALESCE(NEW.payment_id, OLD.payment_id);

    -- The parent is already gone: this is the ON DELETE CASCADE tidying up
    -- after a draft, not somebody editing a settled payment.
    IF NOT FOUND THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF row_state = 'POSTED' THEN
        RAISE EXCEPTION
            'payment % is posted; the bills it settled cannot be changed afterwards',
            row_number;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER supplier_payment_allocation_is_evidence
    BEFORE INSERT OR UPDATE OR DELETE ON supplier_payment_allocation
    FOR EACH ROW EXECUTE FUNCTION protect_posted_payment_allocation();

COMMENT ON TABLE supplier_payment IS
    'Money leaving for a supplier. One account, one site, one date; settles one or more POSTED bills. Posted payments are frozen — correct one by reversing its journal entry.';
COMMENT ON COLUMN supplier_payment.account_key IS
    'A semantic key resolved through account_map at posting time, never a client account code. Restricted to the four meanings that hold money.';
COMMENT ON TABLE supplier_payment_allocation IS
    'Which bills a payment answered. The database refuses an allocation that would over-pay a bill, counting every draft and posted payment already pointing at it.';
