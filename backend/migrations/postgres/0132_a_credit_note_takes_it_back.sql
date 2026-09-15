-- 0132: The supplier takes it back.
--
-- # Why a credit note is its own document
--
-- Goods go back — damaged, wrong colour, short-dated, or simply not what the
-- order said — and a price is corrected after the bill was agreed. Neither can
-- be an edit to the bill: 0052 froze a posted invoice precisely because the
-- journal quotes its amounts, and a bill that could shrink after posting would
-- be a bill whose ledger entry no longer explains it.
--
-- Neither can it be a negative bill. `supplier_invoice` checks every amount
-- non-negative, `supplier_payment_allocation` checks every allocation positive,
-- and the ageing report sums signed money it expects to be one sign. A negative
-- row would pass through a dozen queries written for positive ones and be wrong
-- in each of them differently.
--
-- So: a document that names the bill it credits, posts its own entry, and
-- reduces what is outstanding on that bill.
--
--     Dr trade_payable / non_merchandise_payable   the note's total
--     Cr inventory  (a merchandise bill)           the goods value
--        or the account the note names (an expense bill)
--     Cr vat_in                                    the tax that comes back
--
-- The credit to `vat_in` is the one worth naming: input VAT was claimed when
-- the bill posted, and returning the goods returns the claim. Leaving it debited
-- would overstate a receivable from the tax office, which is the sort of error
-- that is found by an auditor rather than by a balance.
--
-- # When the supplier pays instead
--
-- A note against a bill that has already been paid leaves the payable with a
-- DEBIT balance: the company is owed. Most of the time the next bill absorbs
-- it. When the supplier sends the money back instead, that is a second act with
-- its own date and its own bank line:
--
--     Dr bank / Cr trade_payable
--
-- which clears the debit and puts the money where it actually went. Modelling
-- the refund as part of the note would be modelling two events on one date.

CREATE SEQUENCE supplier_credit_note_number_seq;

CREATE TABLE supplier_credit_note (
    credit_note_id  uuid PRIMARY KEY,
    -- Ours, for reference in a list. The supplier's own number is `their_number`
    -- and is not unique across suppliers, in the same way an invoice number is
    -- not.
    credit_number   text NOT NULL UNIQUE CHECK (btrim(credit_number) <> ''),
    their_number    text,

    -- Which bill this takes back part of. A note that named only a supplier
    -- would be a note nobody could tie to what was over-charged.
    invoice_id      uuid NOT NULL REFERENCES supplier_invoice(invoice_id),
    supplier_id     text NOT NULL,
    site_id         text NOT NULL REFERENCES site(id),
    credit_date     date NOT NULL,

    -- RETURN            goods went back
    -- PRICE_CORRECTION  the goods stayed and the price was wrong
    --
    -- Kept apart because they are different conversations with a supplier and
    -- because a return should eventually move stock as well as money. Nothing
    -- here moves stock: the warehouse records a return of its own, and tying
    -- the two together is a link, not a posting rule.
    reason          text NOT NULL CHECK (reason IN ('RETURN', 'PRICE_CORRECTION')),

    currency        char(3) NOT NULL,
    subtotal_minor  bigint NOT NULL CHECK (subtotal_minor >= 0),
    tax_minor       bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
    total_minor     bigint NOT NULL CHECK (total_minor > 0),

    -- Which account the value goes back to, on a note against an EXPENSE bill.
    -- NULL on a merchandise note, where the answer is `inventory` by rule and
    -- there is nothing for a person to choose. Same door a manual entry and an
    -- expense bill line use: the code comes off the document.
    credit_account_code text REFERENCES ledger_account (account_code),

    -- DRAFT     keyed in, not in the ledger
    -- POSTED    in the ledger, reducing what is outstanding on the bill
    -- REFUNDED  posted, and the supplier has since sent the money back
    status          text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'POSTED', 'REFUNDED')),

    journal_entry_id uuid REFERENCES journal_entry(entry_id),
    posted_by       text,
    posted_at       timestamptz,

    refund_entry_id uuid UNIQUE REFERENCES journal_entry(entry_id),
    refund_date     date,
    refunded_by     text,
    refunded_at     timestamptz,
    -- Where the money arrived. The same meaning-and-qualifier pair a payment
    -- uses, resolved through `account_map`, never a stored account code.
    refund_account_key       text,
    refund_account_qualifier text,

    note            text,
    recorded_by     text NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at     timestamptz NOT NULL DEFAULT now(),

    CHECK (total_minor = subtotal_minor + tax_minor),
    CHECK ((status IN ('POSTED', 'REFUNDED')) = (journal_entry_id IS NOT NULL)),
    CHECK ((posted_at IS NULL) = (posted_by IS NULL)),
    CHECK ((status IN ('POSTED', 'REFUNDED')) = (posted_at IS NOT NULL)),
    CHECK ((status = 'REFUNDED') = (refund_entry_id IS NOT NULL)),
    CHECK ((refund_entry_id IS NULL) = (refunded_at IS NULL)),
    CHECK ((refunded_at IS NULL) = (refunded_by IS NULL)),
    CHECK ((refund_entry_id IS NULL) = (refund_account_key IS NULL)),
    CHECK ((refund_entry_id IS NULL) = (refund_date IS NULL))
);
CREATE INDEX ix_supplier_credit_note_invoice ON supplier_credit_note (invoice_id);
CREATE INDEX ix_supplier_credit_note_supplier
    ON supplier_credit_note (supplier_id, credit_date DESC);
CREATE INDEX ix_supplier_credit_note_status ON supplier_credit_note (status, credit_date);

-- ---------------------------------------------------------------------------
-- A note belongs to its bill, and cannot exceed it
-- ---------------------------------------------------------------------------
--
-- FOR UPDATE on the bill for `assert_allocation_fits`'s reason: two notes each
-- crediting the last of a bill at the same instant would both read the same
-- room and both be allowed.

CREATE OR REPLACE FUNCTION assert_credit_note_fits() RETURNS trigger AS $$
DECLARE
    bill    supplier_invoice%ROWTYPE;
    credited bigint;
BEGIN
    SELECT * INTO bill FROM supplier_invoice
     WHERE invoice_id = NEW.invoice_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'no supplier bill %', NEW.invoice_id;
    END IF;

    IF bill.status <> 'POSTED' THEN
        RAISE EXCEPTION
            'bill % is %, not posted; there is nothing in the ledger for a credit note to take back',
            bill.invoice_number, lower(bill.status);
    END IF;
    IF bill.supplier_id <> NEW.supplier_id THEN
        RAISE EXCEPTION
            'bill % is from % and the credit note is from %; a note credits its own supplier''s bill',
            bill.invoice_number, bill.supplier_id, NEW.supplier_id;
    END IF;
    IF bill.site_id <> NEW.site_id THEN
        RAISE EXCEPTION
            'bill % belongs to % and the credit note to %; credit a location''s bill at that location',
            bill.invoice_number, bill.site_id, NEW.site_id;
    END IF;
    IF bill.currency <> NEW.currency THEN
        RAISE EXCEPTION
            'bill % is in % and the credit note is in %; there is no exchange rate in this ledger',
            bill.invoice_number, bill.currency, NEW.currency;
    END IF;

    SELECT COALESCE(SUM(total_minor), 0) INTO credited
      FROM supplier_credit_note
     WHERE invoice_id = NEW.invoice_id
       AND status IN ('POSTED', 'REFUNDED')
       AND credit_note_id <> NEW.credit_note_id;

    IF credited + NEW.total_minor > bill.total_minor THEN
        RAISE EXCEPTION
            'bill % is % and % is already credited against it; % more would credit back % that was never billed',
            bill.invoice_number, bill.total_minor, credited, NEW.total_minor,
            credited + NEW.total_minor - bill.total_minor;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- On UPDATE as well as INSERT, because a note becomes real when it POSTS: the
-- sum above counts posted notes, so the moment that matters is the status
-- change, not the keying.
CREATE TRIGGER supplier_credit_note_fits
    BEFORE INSERT OR UPDATE ON supplier_credit_note
    FOR EACH ROW EXECUTE FUNCTION assert_credit_note_fits();

-- A posted note is evidence, exactly as a posted bill and a posted payment are.
CREATE OR REPLACE FUNCTION protect_posted_credit_note() RETURNS trigger AS $$
BEGIN
    IF OLD.status IN ('POSTED', 'REFUNDED') AND (
           NEW.subtotal_minor   IS DISTINCT FROM OLD.subtotal_minor
        OR NEW.tax_minor        IS DISTINCT FROM OLD.tax_minor
        OR NEW.total_minor      IS DISTINCT FROM OLD.total_minor
        OR NEW.invoice_id       IS DISTINCT FROM OLD.invoice_id
        OR NEW.supplier_id      IS DISTINCT FROM OLD.supplier_id
        OR NEW.site_id          IS DISTINCT FROM OLD.site_id
        OR NEW.credit_date      IS DISTINCT FROM OLD.credit_date
        OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
    ) THEN
        RAISE EXCEPTION
            'credit note % is posted; reverse its journal entry rather than editing what was credited',
            OLD.credit_number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER supplier_credit_note_posted_is_evidence
    BEFORE UPDATE ON supplier_credit_note
    FOR EACH ROW EXECUTE FUNCTION protect_posted_credit_note();

-- ---------------------------------------------------------------------------
-- A payment cannot answer a debt a credit note has already answered
-- ---------------------------------------------------------------------------
--
-- 0084's `assert_allocation_fits` compares allocations against the bill's TOTAL.
-- Once part of that total has been credited back, the bill owes less, and a
-- payment allocating the original total would pay for goods that went back.
--
-- A SECOND trigger function on the same table rather than a rewrite of 0084's.
-- Several sessions are editing that function this week — one of them is
-- relaxing the cross-site rule — and `CREATE OR REPLACE` of a whole body is how
-- one session silently deletes another's clause. Two BEFORE triggers both fire
-- and each enforces its own sentence, whichever order the migrations land in.
-- 0133 replaces the body below to count supplier advances too; that one is this
-- lane's own function, so replacing it discards nothing.

CREATE OR REPLACE FUNCTION assert_allocation_leaves_credits_room() RETURNS trigger AS $$
DECLARE
    bill      supplier_invoice%ROWTYPE;
    credited  bigint;
    allocated bigint;
BEGIN
    SELECT * INTO bill FROM supplier_invoice
     WHERE invoice_id = NEW.invoice_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'no supplier bill %', NEW.invoice_id;
    END IF;

    SELECT COALESCE(SUM(total_minor), 0) INTO credited
      FROM supplier_credit_note
     WHERE invoice_id = NEW.invoice_id AND status IN ('POSTED', 'REFUNDED');

    IF credited = 0 THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(SUM(a.amount_minor), 0) INTO allocated
      FROM supplier_payment_allocation a
      JOIN supplier_payment p ON p.payment_id = a.payment_id
     WHERE a.invoice_id = NEW.invoice_id
       AND p.status IN ('DRAFT', 'POSTED')
       AND NOT (a.payment_id = NEW.payment_id AND a.invoice_id = NEW.invoice_id);

    IF allocated + NEW.amount_minor > bill.total_minor - credited THEN
        RAISE EXCEPTION
            'bill % is %, % has been credited back and % is already allocated; % more would pay % that is no longer owed',
            bill.invoice_number, bill.total_minor, credited, allocated, NEW.amount_minor,
            allocated + NEW.amount_minor - (bill.total_minor - credited);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER supplier_payment_allocation_leaves_credits_room
    BEFORE INSERT OR UPDATE ON supplier_payment_allocation
    FOR EACH ROW EXECUTE FUNCTION assert_allocation_leaves_credits_room();

COMMENT ON TABLE supplier_credit_note IS
    'Goods returned or a price corrected after a bill was posted. Its own document because a posted bill cannot move and a negative bill would break every query written for positive money.';
