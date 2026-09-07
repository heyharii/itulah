-- 0121: The inter-unit rule exists, so the two refusals come off.
--
-- Both of them said so in writing, and both said what would have to be true
-- first. It now is.
--
--   0098: "When the inter-unit rule is written, this constraint comes off and
--          nothing else moves."
--   0084: "Doing that properly needs the client's inter-unit accounts and is
--          deliberately out of scope; refusing is honest, silently mis-posting
--          is not."
--
-- What changed is `domain::interunit` and the poster that calls it: an entry
-- spanning two units now grows the affiliate legs that bring each of them back
-- to zero, and 0120's constraint trigger refuses one that does not. So the
-- honest credit both migrations described is written, every time, by the only
-- thing allowed to write a journal.
--
-- Single-unit behaviour is untouched. A bill whose lines all sit at its own
-- location, and a payment from the location that owes the bill, post exactly
-- the entries they posted yesterday: the balancer finds every unit already at
-- zero and adds nothing.

-- ---------------------------------------------------------------------------
-- 0098: an expense line may name another unit again
-- ---------------------------------------------------------------------------
--
-- Back to 0094's key, which still pins the two things that were never in
-- question: a line belongs to a bill, and only to an EXPENSE bill. What it no
-- longer pins is the location, which is the whole of the change.
--
-- The UNIQUE that 0098 added on `supplier_invoice` is dropped with it. It
-- existed only to give the composite key something to point at, and leaving it
-- behind would also leave `site_id` frozen on a posted bill for a reason nobody
-- reading the table could reconstruct.

ALTER TABLE supplier_invoice_expense_line
    DROP CONSTRAINT supplier_invoice_expense_line_invoice_id_kind_site_fkey;
ALTER TABLE supplier_invoice_expense_line
    ADD CONSTRAINT supplier_invoice_expense_line_invoice_id_kind_fkey
        FOREIGN KEY (invoice_id, kind)
        REFERENCES supplier_invoice (invoice_id, kind) ON DELETE CASCADE;

ALTER TABLE supplier_invoice
    DROP CONSTRAINT supplier_invoice_id_kind_site_unique;

COMMENT ON COLUMN supplier_invoice_expense_line.site_id IS
    'Where the cost belongs, which is not always where the bill does. One electricity invoice at head office covering four shops is four lines at four locations; the poster adds the affiliate legs that leave each shop and head office balanced on their own.';

-- ---------------------------------------------------------------------------
-- 0084: a payment may settle another unit's bill
-- ---------------------------------------------------------------------------
--
-- The function is recreated whole rather than patched, because that is the only
-- way plpgsql offers, and every other check inside it is reproduced verbatim
-- from 0084. Exactly one paragraph is gone: the one that compared the bill's
-- location with the payment's.
--
-- The posting rule changes with it, in `payments.rs`: the payable is debited at
-- the BILL's location, where the bill credited it, and the money is credited at
-- the PAYMENT's. That was already the honest entry; what made it impossible was
-- that it does not balance per location on its own. Now it does, because the
-- poster completes it.

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

    -- Where the location check used to be. Head office paying a shop's supplier
    -- is a real thing an Indonesian retailer does every week, and it is now
    -- recorded the way they record it: the shop's payable is cleared in the
    -- shop's books, head office's bank is credited in head office's, and the
    -- difference between the two is the affiliate balance the poster writes.

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

COMMENT ON FUNCTION assert_allocation_fits() IS
    'A payment allocation must point at a posted bill in the same currency and must not over-pay it. Locations may differ: the poster balances the entry per unit through the client''s affiliate accounts.';
