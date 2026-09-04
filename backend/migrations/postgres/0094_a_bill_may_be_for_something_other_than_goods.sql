-- 0094: A supplier bill that is not for merchandise.
--
-- # What was missing
--
-- 0052 gave finance one kind of bill and 0084 gave it a payment. Between them
-- they can record everything a supplier sends EXCEPT the majority of what this
-- client actually buys: electricity, rent, security, freight, agency staff,
-- repairs, the accountant's fee. `post_bill` debits `inventory` and nothing
-- else, so every bill in the system is a merchandise bill by construction, and
-- the whole of the client's 6* BEBAN USAHA and 7* BEBAN USAHA LAINNYA — five
-- expense families, several hundred accounts — could only be reached by a
-- hand-keyed journal entry with no document behind it.
--
-- The account map has said so for a while. `non_merchandise_payable`,
-- `prepaid_expense` and `advance` are mapped for all fourteen locations and
-- not one line of code has ever resolved them.
--
-- # Why this is a second KIND of invoice and not a second document family
--
-- Because everything around a bill is the same either way. It has a supplier,
-- a number that is unique per supplier, a date, terms, a tax split, a status
-- that goes DRAFT -> POSTED and freezes, an ageing bucket, and a payment that
-- settles it. A parallel `expense_invoice` table would duplicate all of that,
-- and then payables ageing, the payment allocation trigger, the unbilled
-- report and every supplier balance would each need a second half that agreed
-- with the first. The place they disagree is the place somebody's supplier
-- balance is wrong.
--
-- What genuinely differs is one thing: WHICH account the debit goes to. A
-- merchandise bill knows — it is `inventory`, and the rule says so. An expense
-- bill does not, and cannot: only the person holding the paper knows whether
-- this is electricity at store 04 or a year of insurance paid in advance. So an
-- expense bill carries lines that name the account, and a merchandise bill
-- carries none.
--
-- # Why an account code appears on a line here, and does not break the rule
--
-- 0050 says nothing in Rust may name a client account code. That rule is about
-- RULES: a posting rule that hard-codes `1011201001` is a rule that has to be
-- recompiled when Finance moves an account. It is not about DOCUMENTS. A person
-- choosing "6010110002 Biaya Listrik" on a bill is making the same choice they
-- make on a manual journal entry, which `poster::LineAccount::Account` already
-- exists for. The Rust posting rule below still names no code; it debits
-- whatever the person wrote down.

-- ---------------------------------------------------------------------------
-- The kind
-- ---------------------------------------------------------------------------

ALTER TABLE supplier_invoice
    ADD COLUMN kind text NOT NULL DEFAULT 'MERCHANDISE'
        CHECK (kind IN ('MERCHANDISE', 'EXPENSE'));

COMMENT ON COLUMN supplier_invoice.kind IS
    'MERCHANDISE debits inventory by rule; EXPENSE debits the accounts named on its lines. The only difference between the two.';

-- A discount on an expense bill has nowhere honest to go.
--
-- A merchandise bill credits its discount to `8010110003 Potongan Pembelian`,
-- which is where the client keeps a PURCHASE discount — it sits under root 8
-- with the other non-operating income. An early-settlement rebate on a
-- security contract is not that, and posting it there would quietly fill a
-- purchases account with amounts that never touched a purchase. Netting it off
-- the lines instead is what the person keying already has to do to make the
-- lines add up to the subtotal, so the refusal costs nothing and invents no
-- account. When Finance names an account for it, this CHECK is one line and a
-- semantic key away from being lifted.
ALTER TABLE supplier_invoice
    ADD CONSTRAINT supplier_invoice_expense_takes_no_discount
        CHECK (kind = 'MERCHANDISE' OR discount_minor = 0);

-- Referenced by the lines, so a line cannot hang off a bill whose kind it does
-- not match, and the kind cannot change out from under lines that exist. The
-- same device `bank_statement` uses in 0071 to stop a line's copy of the
-- account drifting from its statement's.
ALTER TABLE supplier_invoice
    ADD CONSTRAINT supplier_invoice_id_kind_unique UNIQUE (invoice_id, kind);

-- ---------------------------------------------------------------------------
-- The lines
-- ---------------------------------------------------------------------------
--
-- Named `supplier_invoice_expense_line` and not `supplier_invoice_line`,
-- because 0052 already took that name for the merchandise line — quantity,
-- unit price, a link back to the ordered line. The two have nothing in common
-- beyond belonging to an invoice: this one has no quantity, because "one month
-- of electricity" has no unit, and it has an account, because a merchandise
-- line's account is decided by the rule rather than by the person.

CREATE TABLE supplier_invoice_expense_line (
    line_id       uuid PRIMARY KEY,
    invoice_id    uuid NOT NULL,
    -- Pinned, and carried into the foreign key below: an expense line can only
    -- exist on an EXPENSE bill, and the database says so rather than a trigger.
    kind          text NOT NULL DEFAULT 'EXPENSE' CHECK (kind = 'EXPENSE'),
    line_number   integer NOT NULL CHECK (line_number > 0),

    -- What this cost is, in the client's own chart. Chosen by the person
    -- holding the paper; validated below.
    account_code  text NOT NULL,
    -- Pinned false and carried into a composite foreign key, exactly as
    -- `journal_line` does it: nothing may be booked to a heading.
    is_group      boolean NOT NULL DEFAULT false CHECK (is_group = false),

    -- WHERE this cost belongs, which is not always where the bill does. One
    -- electricity account covers four shops and one invoice arrives at head
    -- office; splitting it across the shops here is the whole reason a line
    -- carries a location at all.
    --
    -- The consequence, stated rather than hidden: the payable is credited at
    -- the BILL's location, so a bill at the DC carrying a line at store 04
    -- posts an entry that balances in total and does not balance per location.
    -- Doing that properly needs the client's inter-unit accounts, which they
    -- keep and which `assert_allocation_fits` in 0084 refuses to guess at for
    -- exactly the same reason. Keying the line at the bill's own location is
    -- always available and always balances; splitting is offered because the
    -- alternative is four invented invoices.
    site_id       text NOT NULL REFERENCES site(id),

    amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
    memo          text,

    UNIQUE (invoice_id, line_number),
    -- The kind travels with the reference, so this is one foreign key and not
    -- two: a line points at an EXPENSE bill or at nothing.
    FOREIGN KEY (invoice_id, kind)
        REFERENCES supplier_invoice (invoice_id, kind) ON DELETE CASCADE,
    FOREIGN KEY (account_code, is_group)
        REFERENCES ledger_account (account_code, is_group)
);
CREATE INDEX ix_supplier_invoice_expense_line_invoice
    ON supplier_invoice_expense_line (invoice_id, line_number);
CREATE INDEX ix_supplier_invoice_expense_line_account
    ON supplier_invoice_expense_line (account_code, site_id);

COMMENT ON TABLE supplier_invoice_expense_line IS
    'What an expense bill is for, account by account. Only EXPENSE bills have these, and their amounts must sum to the bill''s subtotal.';

-- ---------------------------------------------------------------------------
-- Invariant one: an expense bill is exactly its lines.
-- ---------------------------------------------------------------------------
--
-- Deferred, and on both tables, for the reasons 0051 gives at length about the
-- journal and 0084 repeats about payment allocations: the lines do not exist
-- when the header is inserted, and watching only one side leaves a hole — a
-- header that never got lines, or lines appended to a bill that already
-- committed.
--
-- P0001 on purpose, like every other refusal in this schema.
-- `AppError::into_response` recognises exactly that SQLSTATE and passes the
-- message through as a 409, so what a person reads is the sentence below. A
-- more precise-looking ERRCODE arrives as an opaque 500.

CREATE OR REPLACE FUNCTION assert_expense_bill_totals() RETURNS trigger AS $$
DECLARE
    bill    supplier_invoice%ROWTYPE;
    parts   bigint;
    lines   bigint;
    target  uuid;
BEGIN
    target := COALESCE(NEW.invoice_id, OLD.invoice_id);

    -- The bill may have been rolled back out from under its lines, or dropped
    -- by the ON DELETE CASCADE above; there is then nothing to check.
    SELECT * INTO bill FROM supplier_invoice WHERE invoice_id = target;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- A merchandise bill has no lines here, which the foreign key already
    -- guarantees, and its subtotal is not a sum of anything.
    IF bill.kind <> 'EXPENSE' THEN
        RETURN NULL;
    END IF;

    SELECT COUNT(*), COALESCE(SUM(amount_minor), 0) INTO lines, parts
      FROM supplier_invoice_expense_line WHERE invoice_id = target;

    IF lines = 0 THEN
        RAISE EXCEPTION
            'bill % is an expense bill with no lines; an expense bill that does not say what it '
            'was for cannot be posted anywhere',
            bill.invoice_number;
    END IF;
    IF parts <> bill.subtotal_minor THEN
        RAISE EXCEPTION
            'bill % says % before tax but its lines total %; the difference is %',
            bill.invoice_number, bill.subtotal_minor, parts,
            abs(bill.subtotal_minor - parts);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER supplier_invoice_expense_is_its_lines
    AFTER INSERT OR UPDATE ON supplier_invoice
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_expense_bill_totals();

CREATE CONSTRAINT TRIGGER supplier_invoice_expense_line_totals
    AFTER INSERT OR UPDATE OR DELETE ON supplier_invoice_expense_line
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_expense_bill_totals();

-- ---------------------------------------------------------------------------
-- Invariant two: the account is one a cost can actually go to.
-- ---------------------------------------------------------------------------
--
-- The composite foreign key above already refuses a heading and an unknown
-- code. Two things it cannot express are checked here instead:
--
--   * ACTIVE. `is_active` is mutable and belongs to no unique key, so it cannot
--     be carried into a foreign key. An account retired after somebody used it
--     would otherwise keep taking bills quietly — the failure that survives a
--     year. `assert_postable` makes the same check in Rust for journal lines,
--     and for the same reason.
--   * THE CLASS. A bill line is a cost or something that becomes one: root 6
--     BEBAN USAHA, root 7 BEBAN USAHA LAINNYA, or root 1 for the two asset
--     accounts that hold a cost until it is earned — `1011301* Biaya Dibayar
--     Dimuka` and `1011303* Uang Muka`. Without this a line could name
--     `2012001001 Hutang Suppliers` and the entry would balance perfectly while
--     saying the exact opposite of what happened.
--
-- Root 1 is admitted whole rather than narrowed to those two families, because
-- narrowing means writing the client's own codes into a database constraint,
-- which is the thing 0050 exists to prevent. The looseness is real and it is
-- bounded: the person is choosing from the chart, and choosing a bank account
-- here would be as visible on the bill as it is wrong.

CREATE OR REPLACE FUNCTION assert_expense_line_account() RETURNS trigger AS $$
DECLARE
    account ledger_account%ROWTYPE;
BEGIN
    SELECT * INTO account FROM ledger_account WHERE account_code = NEW.account_code;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'no account % in the chart', NEW.account_code;
    END IF;
    IF NOT account.is_active THEN
        RAISE EXCEPTION
            '% % is inactive in the client''s chart; it has been retired and cannot take new costs',
            account.account_code, account.name;
    END IF;
    IF account.root_class NOT IN ('1', '6', '7') THEN
        RAISE EXCEPTION
            '% % is in class %; a bill line is a cost — class 6 or 7 — or something that becomes '
            'one, which is prepaid expense or an advance in class 1',
            account.account_code, account.name, account.root_class;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER supplier_invoice_expense_line_account_takes_costs
    BEFORE INSERT OR UPDATE ON supplier_invoice_expense_line
    FOR EACH ROW EXECUTE FUNCTION assert_expense_line_account();

-- ---------------------------------------------------------------------------
-- Invariant three: a posted bill's lines are evidence.
-- ---------------------------------------------------------------------------
--
-- Same shape and same argument as `protect_posted_payment_allocation` in 0084.
-- The journal entry has one debit per line and quotes both the account and the
-- amount; moving a line afterwards would leave the document and the ledger
-- disagreeing about what the money was spent on while the trial balance still
-- balanced.

CREATE OR REPLACE FUNCTION protect_posted_expense_line() RETURNS trigger AS $$
DECLARE
    row_state  text;
    row_number text;
BEGIN
    SELECT status, invoice_number INTO row_state, row_number
      FROM supplier_invoice
     WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id);

    -- The bill is already gone: this is the cascade tidying up after a draft,
    -- not somebody editing a booked one.
    IF NOT FOUND THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF row_state IN ('POSTED', 'VOID') THEN
        RAISE EXCEPTION
            'bill % is posted; reverse its journal entry rather than editing what it was for',
            row_number;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER supplier_invoice_expense_line_is_evidence
    BEFORE INSERT OR UPDATE OR DELETE ON supplier_invoice_expense_line
    FOR EACH ROW EXECUTE FUNCTION protect_posted_expense_line();

-- The kind joins the list of things a posted bill may not change. Everything
-- else in this function is 0052's, unchanged; `kind` is added because the
-- posting rule branches on it, so a posted merchandise bill turning into an
-- expense bill would make the entry unexplainable from the document.
CREATE OR REPLACE FUNCTION protect_posted_supplier_invoice() RETURNS trigger AS $$
BEGIN
    IF OLD.status IN ('POSTED', 'VOID') AND (
           NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
        OR NEW.tax_minor      IS DISTINCT FROM OLD.tax_minor
        OR NEW.discount_minor IS DISTINCT FROM OLD.discount_minor
        OR NEW.total_minor    IS DISTINCT FROM OLD.total_minor
        OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
        OR NEW.supplier_id    IS DISTINCT FROM OLD.supplier_id
        OR NEW.site_id        IS DISTINCT FROM OLD.site_id
        OR NEW.invoice_date   IS DISTINCT FROM OLD.invoice_date
        OR NEW.kind           IS DISTINCT FROM OLD.kind
    ) THEN
        RAISE EXCEPTION
            'supplier invoice % is posted; reverse the journal entry instead of editing the bill',
            OLD.invoice_number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
