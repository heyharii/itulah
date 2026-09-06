-- 0133: Money paid before the goods, and tax kept back at the bank.
--
-- Two things that both happen on the way from a bill to a bank line, and that
-- 0084 said out loud it was not doing.
--
-- # An advance
--
-- A supplier who has not been dealt with before, or a make-to-order run, is
-- paid something up front against the purchase order. That money is not an
-- expense and it is not a payment of a bill — there is no bill yet. It is an
-- asset: the company is owed goods. The client keeps the account for it,
-- `1011303002 Advanced - Purchase`, with a leaf per location.
--
--     issue   Dr advance_purchase / Cr bank
--     apply   Dr trade_payable     / Cr advance_purchase
--
-- Applying is its own act on its own date because that is when the debt it
-- answers comes into existence. An advance that could only be consumed at the
-- moment the bill posted would be an advance that could not be split across the
-- two bills a large order arrives on.
--
-- # Withholding
--
-- An Indonesian company paying a domestic vendor for services, rent or
-- royalties does not pay the whole invoice. It keeps back the vendor's income
-- tax, pays the rest, and remits the difference to the tax office in the
-- vendor's name. The vendor is credited with the full amount and receives less.
--
--     Dr trade_payable   the whole debt, as billed
--     Dr bank_admin_fee  the bank's own charge for the transfer, when there is one
--     Cr bank            what actually left
--     Cr pph_payable     what was kept back
--
-- The debit is the full amount because the debt is fully settled: a vendor who
-- has been withheld from is not still owed the difference, and a payment that
-- debited only the net would leave a payable balance that never clears and an
-- ageing report that shows every service vendor permanently in arrears.
--
-- WHICH rate is a property of the bill, not of the payment, because it follows
-- what was bought: 2% on services and equipment rental under PPh 23, 15% on
-- royalties, 10% on land and building rent under PPh 4(2), which is final. So
-- the category sits on `supplier_invoice` and the payment computes from it.
-- `cloud::domain::withholding` holds the rates and the arithmetic, and is
-- checked by `kernel_purity` for the same reason the depreciation kernel is:
-- a tax figure that depended on when it was asked would be indefensible.
--
-- # Why the bank charge is here after all
--
-- 0084 argued a transfer fee belongs on the bank statement rather than inside
-- the settlement of a bill, and that is right when the bank debits it
-- separately. It is not what happens on a transfer where the fee comes out of
-- the same movement: the statement then shows one line for net-plus-fee and
-- reconciliation has to explain a difference that has no document. The column
-- is optional and defaults to zero, so the 0084 case is unchanged.

-- ---------------------------------------------------------------------------
-- Money paid before the goods
-- ---------------------------------------------------------------------------

CREATE SEQUENCE supplier_advance_number_seq;

CREATE TABLE supplier_advance (
    advance_id      uuid PRIMARY KEY,
    -- `AV-00000001`. Ours, and gaps are harmless, as with every other document
    -- number in this ledger.
    advance_number  text NOT NULL UNIQUE CHECK (btrim(advance_number) <> ''),

    supplier_id     text NOT NULL,
    site_id         text NOT NULL REFERENCES site(id),
    -- Against WHAT. An advance with no order behind it is a loan to a supplier,
    -- which is a different thing with a different account, so the order is
    -- required rather than merely recorded.
    purchase_order_id uuid NOT NULL REFERENCES purchase_order(purchase_order_id),

    advance_date    date NOT NULL,
    currency        char(3) NOT NULL,
    amount_minor    bigint NOT NULL CHECK (amount_minor > 0),

    -- Where the money left from, said the only way this system says it.
    account_key       text NOT NULL CHECK (account_key IN
                          ('bank_giro', 'bank_savings', 'cash', 'petty_cash')),
    account_qualifier text NOT NULL DEFAULT '',

    status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED')),
    journal_entry_id uuid REFERENCES journal_entry(entry_id),

    reference       text,
    note            text,
    recorded_by     text NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at     timestamptz NOT NULL DEFAULT now(),
    posted_by       text,
    posted_at       timestamptz,

    FOREIGN KEY (account_key, site_id, account_qualifier)
        REFERENCES account_map (semantic_key, site_id, qualifier),

    CHECK ((status = 'POSTED') = (journal_entry_id IS NOT NULL)),
    CHECK ((posted_at IS NULL) = (posted_by IS NULL)),
    CHECK ((status = 'POSTED') = (posted_at IS NOT NULL))
);
CREATE INDEX ix_supplier_advance_supplier ON supplier_advance (supplier_id, advance_date DESC);
CREATE INDEX ix_supplier_advance_order ON supplier_advance (purchase_order_id);
CREATE INDEX ix_supplier_advance_status ON supplier_advance (status, advance_date);

-- One bill this advance was set against, and the entry that moved it.
--
-- The primary key is (advance, invoice): applying more of the same advance to
-- the same bill is a bigger application, not a second row somebody has to
-- remember to add up. Each application posts its own entry, so it carries one.
CREATE TABLE supplier_advance_application (
    advance_id       uuid NOT NULL REFERENCES supplier_advance(advance_id) ON DELETE CASCADE,
    invoice_id       uuid NOT NULL REFERENCES supplier_invoice(invoice_id),
    amount_minor     bigint NOT NULL CHECK (amount_minor > 0),
    journal_entry_id uuid NOT NULL REFERENCES journal_entry(entry_id),
    applied_by       text NOT NULL CHECK (btrim(applied_by) <> ''),
    applied_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (advance_id, invoice_id)
);
CREATE INDEX ix_supplier_advance_application_invoice
    ON supplier_advance_application (invoice_id);

CREATE OR REPLACE FUNCTION assert_advance_application_fits() RETURNS trigger AS $$
DECLARE
    adv     supplier_advance%ROWTYPE;
    bill    supplier_invoice%ROWTYPE;
    applied bigint;
BEGIN
    SELECT * INTO adv FROM supplier_advance
     WHERE advance_id = NEW.advance_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'no supplier advance %', NEW.advance_id;
    END IF;
    IF adv.status <> 'POSTED' THEN
        RAISE EXCEPTION
            'advance % is %, not posted; money that has not left cannot be set against a bill',
            adv.advance_number, lower(adv.status);
    END IF;

    SELECT * INTO bill FROM supplier_invoice
     WHERE invoice_id = NEW.invoice_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'no supplier bill %', NEW.invoice_id;
    END IF;
    IF bill.status <> 'POSTED' THEN
        RAISE EXCEPTION
            'bill % is %, not posted; a bill that is not in the ledger is not yet owed',
            bill.invoice_number, lower(bill.status);
    END IF;
    IF bill.supplier_id <> adv.supplier_id THEN
        RAISE EXCEPTION
            'advance % was paid to % and bill % is from %; an advance answers its own supplier''s bill',
            adv.advance_number, adv.supplier_id, bill.invoice_number, bill.supplier_id;
    END IF;
    IF bill.site_id <> adv.site_id THEN
        RAISE EXCEPTION
            'advance % is at % and bill % is at %; set a location''s advance against that location''s bill',
            adv.advance_number, adv.site_id, bill.invoice_number, bill.site_id;
    END IF;
    IF bill.currency <> adv.currency THEN
        RAISE EXCEPTION
            'advance % is in % and bill % is in %; there is no exchange rate in this ledger',
            adv.advance_number, adv.currency, bill.invoice_number, bill.currency;
    END IF;

    SELECT COALESCE(SUM(amount_minor), 0) INTO applied
      FROM supplier_advance_application
     WHERE advance_id = NEW.advance_id AND invoice_id <> NEW.invoice_id;

    IF applied + NEW.amount_minor > adv.amount_minor THEN
        RAISE EXCEPTION
            'advance % is % and % of it is already set against bills; % more would spend % that was never paid',
            adv.advance_number, adv.amount_minor, applied, NEW.amount_minor,
            applied + NEW.amount_minor - adv.amount_minor;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER supplier_advance_application_fits
    BEFORE INSERT OR UPDATE ON supplier_advance_application
    FOR EACH ROW EXECUTE FUNCTION assert_advance_application_fits();

CREATE OR REPLACE FUNCTION protect_posted_supplier_advance() RETURNS trigger AS $$
BEGIN
    IF OLD.status = 'POSTED' AND (
           NEW.amount_minor      IS DISTINCT FROM OLD.amount_minor
        OR NEW.site_id           IS DISTINCT FROM OLD.site_id
        OR NEW.supplier_id       IS DISTINCT FROM OLD.supplier_id
        OR NEW.advance_date      IS DISTINCT FROM OLD.advance_date
        OR NEW.account_key       IS DISTINCT FROM OLD.account_key
        OR NEW.account_qualifier IS DISTINCT FROM OLD.account_qualifier
        OR NEW.currency          IS DISTINCT FROM OLD.currency
        OR NEW.status            IS DISTINCT FROM OLD.status
        OR NEW.journal_entry_id  IS DISTINCT FROM OLD.journal_entry_id
    ) THEN
        RAISE EXCEPTION
            'advance % is posted; reverse its journal entry rather than editing what left the bank',
            OLD.advance_number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER supplier_advance_posted_is_evidence
    BEFORE UPDATE ON supplier_advance
    FOR EACH ROW EXECUTE FUNCTION protect_posted_supplier_advance();

-- An advance set against a bill answers part of that debt, so a payment may no
-- longer answer the same part. This is 0132's function, extended — it is this
-- lane's own, so replacing the body discards nothing anybody else wrote.
CREATE OR REPLACE FUNCTION assert_allocation_leaves_credits_room() RETURNS trigger AS $$
DECLARE
    bill      supplier_invoice%ROWTYPE;
    answered  bigint;
    allocated bigint;
BEGIN
    SELECT * INTO bill FROM supplier_invoice
     WHERE invoice_id = NEW.invoice_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'no supplier bill %', NEW.invoice_id;
    END IF;

    SELECT COALESCE((SELECT SUM(total_minor) FROM supplier_credit_note
                      WHERE invoice_id = NEW.invoice_id
                        AND status IN ('POSTED', 'REFUNDED')), 0)
         + COALESCE((SELECT SUM(amount_minor) FROM supplier_advance_application
                      WHERE invoice_id = NEW.invoice_id), 0)
      INTO answered;

    IF answered = 0 THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(SUM(a.amount_minor), 0) INTO allocated
      FROM supplier_payment_allocation a
      JOIN supplier_payment p ON p.payment_id = a.payment_id
     WHERE a.invoice_id = NEW.invoice_id
       AND p.status IN ('DRAFT', 'POSTED')
       AND NOT (a.payment_id = NEW.payment_id AND a.invoice_id = NEW.invoice_id);

    IF allocated + NEW.amount_minor > bill.total_minor - answered THEN
        RAISE EXCEPTION
            'bill % is %, % is already answered by credit notes and advances and % is allocated; % more would pay % that is no longer owed',
            bill.invoice_number, bill.total_minor, answered, allocated, NEW.amount_minor,
            allocated + NEW.amount_minor - (bill.total_minor - answered);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Tax kept back at the bank
-- ---------------------------------------------------------------------------

ALTER TABLE supplier_invoice
    -- NULL means nothing is withheld, which is the ordinary case: goods for
    -- resale are not subject to PPh 23. The set is small on purpose — each
    -- member is a rate this system will compute and remit in somebody's name,
    -- and a category whose rate depends on a fact the system does not record
    -- (a construction vendor's certification, say) would be a guess wearing a
    -- code. `cloud::domain::withholding` holds the same list and the rates.
    ADD COLUMN withholding_code text
        CHECK (withholding_code IS NULL OR withholding_code IN (
            'PPH23_SERVICE',          -- 2%,  services
            'PPH23_RENT_EQUIPMENT',   -- 2%,  hire of vehicles and equipment
            'PPH23_ROYALTY',          -- 15%, royalties and licences
            'PPH42_RENT_PROPERTY'));  -- 10%, land and buildings; final

COMMENT ON COLUMN supplier_invoice.withholding_code IS
    'Which income tax is kept back when this bill is paid, or NULL for none. A property of what was bought, so it lives on the bill and not on the payment.';

ALTER TABLE supplier_payment
    -- What was kept back and is owed to the tax office rather than to the
    -- supplier. `total_minor` stays what it always was — the sum of the
    -- allocations, which is the DEBT settled — and what actually left the
    -- account is `total_minor - withholding_minor + bank_charge_minor`.
    --
    -- Deliberately not renaming `total_minor` to something like `gross_minor`:
    -- it is quoted by 0084's deferred trigger, by the ageing projection and by
    -- every caller written since, and a rename would be a large diff to make one
    -- column read better.
    ADD COLUMN withholding_minor bigint NOT NULL DEFAULT 0
        CHECK (withholding_minor >= 0),
    ADD COLUMN bank_charge_minor bigint NOT NULL DEFAULT 0
        CHECK (bank_charge_minor >= 0),
    -- WHICH tax was kept back, said the way this system says every account:
    -- a meaning, resolved through `account_map` at posting time. PPh 23 is
    -- creditable against the vendor's annual liability and PPh 4(2) is final,
    -- and the client's chart keeps them apart, so the payment has to remember
    -- which of the two it withheld.
    ADD COLUMN withholding_key text
        CHECK (withholding_key IS NULL OR withholding_key IN
            ('pph23_payable', 'pph_final_payable')),
    ADD CONSTRAINT supplier_payment_withholding_within_total
        CHECK (withholding_minor < total_minor),
    ADD CONSTRAINT supplier_payment_withholding_names_its_account
        CHECK ((withholding_minor > 0) = (withholding_key IS NOT NULL));

COMMENT ON COLUMN supplier_payment.withholding_minor IS
    'Income tax kept back from the supplier and owed to the tax office. The supplier is credited with the full total_minor and receives total_minor - withholding_minor + bank_charge_minor.';

-- The new columns are quoted by a journal entry that cannot move, so they stop
-- moving when the payment posts. A separate trigger from 0084's, so that a
-- session rewriting that one cannot delete this sentence by accident.
CREATE OR REPLACE FUNCTION protect_posted_payment_deductions() RETURNS trigger AS $$
BEGIN
    IF OLD.status = 'POSTED' AND (
           NEW.withholding_minor IS DISTINCT FROM OLD.withholding_minor
        OR NEW.bank_charge_minor IS DISTINCT FROM OLD.bank_charge_minor
        OR NEW.withholding_key   IS DISTINCT FROM OLD.withholding_key
    ) THEN
        RAISE EXCEPTION
            'payment % is posted; what was withheld is in the ledger and cannot be re-decided',
            OLD.payment_number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER supplier_payment_deductions_are_evidence
    BEFORE UPDATE ON supplier_payment
    FOR EACH ROW EXECUTE FUNCTION protect_posted_payment_deductions();

COMMENT ON TABLE supplier_advance IS
    'Money paid to a supplier against a purchase order before any bill exists. An asset while it is outstanding — the company is owed goods — and set against bills as they arrive.';
