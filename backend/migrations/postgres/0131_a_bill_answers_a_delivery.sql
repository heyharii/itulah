-- 0131: A bill answers a delivery, and the two are checked against the order.
--
-- # The hole this closes
--
-- 0052 built three tables and wrote one of them. `supplier_invoice_receipt` —
-- which deliveries a bill covers — and `supplier_invoice_line` — what the bill
-- says was delivered and at what price — have existed since then with no writer
-- anywhere in the code. The consequence was quiet and complete: `MATCHED` was
-- a status nothing could reach, `unbilled_receipts` reported every delivery
-- ever made because its NOT EXISTS could never be false, and the three-way
-- check that every purchase ledger is built on — order, delivery, bill — was
-- a table layout rather than a control.
--
-- # What matching is
--
-- A bill names the deliveries it covers and, line by line, what it charges for
-- them. Three questions are then answerable, and each is a different failure:
--
--   * quantity — is the supplier billing for more than was accepted? That is
--     the count the loading bay did, and it is the one number the supplier
--     cannot dispute after the fact. Billing above it is refused outright.
--   * price — is the unit price the one that was ordered? Small differences
--     are ordinary (rounding, a rate agreed after the order) and pass within a
--     tolerance; larger ones are a decision somebody has to make, so they are
--     refused unless the person matching says in the request that the variance
--     is accepted.
--   * value — what the delivery was valued at when it was received, against
--     what the bill charges. The difference is a purchase price variance and
--     it goes to its own account rather than being buried in inventory.
--
-- # What posting a matched bill does
--
--     Dr supplier_suspend        what 0130 credited for these deliveries
--     Dr vat_in                  the tax on the bill
--     Dr purchase_price_variance when the bill charges more than that
--     Cr trade_payable           the bill total
--     Cr purchase_price_variance when the bill charges less
--     Cr purchase_discount       an agreed reduction, as before
--
-- The suspend account empties exactly as it filled, which is the property that
-- makes it worth having: a non-zero balance on `2012001002` at a month end is
-- deliveries nobody has billed, and it is now a figure on the balance sheet
-- rather than a list somebody has to remember to run.
--
-- A bill with no receipts behind it — a service, a freight charge, an expense —
-- posts by the path 0094 built and touches none of this.

-- ---------------------------------------------------------------------------
-- One delivery is billed once
-- ---------------------------------------------------------------------------
--
-- 0052 indexed `receipt_id` without making it unique, which left room for two
-- bills to both claim the same truck. They would then both clear a suspend
-- credit that was only made once, and the account would go negative by the
-- value of a delivery — the kind of wrong that still balances.
--
-- A supplier who bills a week of deliveries at a time is unaffected: that is
-- one bill naming several receipts, which is what the table was always for.

DROP INDEX ix_supplier_invoice_receipt_receipt;
CREATE UNIQUE INDEX ux_supplier_invoice_receipt_receipt
    ON supplier_invoice_receipt (receipt_id);

ALTER TABLE supplier_invoice_receipt
    ADD COLUMN matched_by text NOT NULL DEFAULT 'unknown',
    ADD COLUMN matched_at timestamptz NOT NULL DEFAULT now();
-- The default exists only so the columns can be added; nothing has ever written
-- this table, so no row can carry it, and a future one must say who matched.
ALTER TABLE supplier_invoice_receipt ALTER COLUMN matched_by DROP DEFAULT;

COMMENT ON COLUMN supplier_invoice_receipt.matched_by IS
    'Who tied this delivery to this bill. Matching is a decision — a variance may have been accepted — so it carries an actor, like posting does.';

-- ---------------------------------------------------------------------------
-- What the bill charges for the delivery
-- ---------------------------------------------------------------------------
--
-- `supplier_invoice_line` is 0052's, unchanged except for the one column that
-- makes the three-way join direct rather than inferred: which delivery LINE
-- this bill line answers. Going through `po_line_id` alone would be ambiguous
-- the moment a supplier delivers one order line twice, which is exactly what
-- a short delivery followed by the remainder looks like.

ALTER TABLE supplier_invoice_line
    ADD COLUMN receipt_line_id uuid REFERENCES goods_receipt_line(receipt_line_id);

CREATE INDEX ix_supplier_invoice_line_receipt_line
    ON supplier_invoice_line (receipt_line_id) WHERE receipt_line_id IS NOT NULL;

COMMENT ON COLUMN supplier_invoice_line.receipt_line_id IS
    'The accepted delivery line this bill line charges for. NULL on a line that answers no delivery — freight, a pallet charge, a service.';

-- A supplier may not bill for more than was accepted.
--
-- In the database and not only in Rust, for 0051's reason: application
-- validation is where an invariant lives until somebody opens psql or a
-- migration back-fills, and over-billing is money, not a display bug. The
-- count at the loading bay was made by one person and verified by another, and
-- it is the number that wins.
CREATE OR REPLACE FUNCTION assert_billed_within_receipt() RETURNS trigger AS $$
DECLARE
    accepted bigint;
    billed   bigint;
    receipt  text;
BEGIN
    IF NEW.receipt_line_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT l.quantity, r.receipt_number INTO accepted, receipt
      FROM goods_receipt_line l
      JOIN goods_receipt r ON r.receipt_id = l.receipt_id
     WHERE l.receipt_line_id = NEW.receipt_line_id
     FOR UPDATE OF l;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'no delivery line %', NEW.receipt_line_id;
    END IF;

    SELECT COALESCE(SUM(quantity), 0) INTO billed
      FROM supplier_invoice_line
     WHERE receipt_line_id = NEW.receipt_line_id
       AND invoice_line_id <> NEW.invoice_line_id;

    IF billed + NEW.quantity > accepted THEN
        RAISE EXCEPTION
            'delivery % accepted % of this line and % is already billed; % more would bill % that never arrived',
            receipt, accepted, billed, NEW.quantity,
            billed + NEW.quantity - accepted;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER supplier_invoice_line_within_receipt
    BEFORE INSERT OR UPDATE ON supplier_invoice_line
    FOR EACH ROW EXECUTE FUNCTION assert_billed_within_receipt();

-- ---------------------------------------------------------------------------
-- What the match decided
-- ---------------------------------------------------------------------------

ALTER TABLE supplier_invoice
    ADD COLUMN matched_by text,
    ADD COLUMN matched_at timestamptz,
    -- Signed, and that is the point. Positive: the bill charges more than the
    -- deliveries were valued at, so the variance is a debit. Negative: it
    -- charges less, and the variance is a credit. Stored rather than derived
    -- because the journal quotes it and the journal cannot move — recomputing
    -- it later from an order whose price has since been amended would disagree
    -- with the books.
    ADD COLUMN price_variance_minor bigint NOT NULL DEFAULT 0,
    ADD CONSTRAINT supplier_invoice_matched_pair
        CHECK ((matched_at IS NULL) = (matched_by IS NULL));

COMMENT ON COLUMN supplier_invoice.price_variance_minor IS
    'Bill value minus the value its deliveries were posted at. Positive is a debit to purchase price variance, negative a credit. Zero on a bill that answers no delivery.';

-- The match is evidence once the bill is posted, in the same way and for the
-- same reason as its amounts.
--
-- A SEPARATE trigger rather than an edit to 0052's `protect_posted_supplier_invoice`.
-- Several sessions are changing that function in the same week, and a
-- CREATE OR REPLACE of a whole body is a change that silently discards whatever
-- somebody else added to it. Two triggers, each guarding its own columns, both
-- survive being written in either order.
CREATE OR REPLACE FUNCTION protect_posted_supplier_invoice_match() RETURNS trigger AS $$
BEGIN
    IF OLD.status IN ('POSTED', 'VOID')
       AND NEW.price_variance_minor IS DISTINCT FROM OLD.price_variance_minor THEN
        RAISE EXCEPTION
            'supplier invoice % is posted; its price variance is in the ledger and cannot be re-decided',
            OLD.invoice_number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER supplier_invoice_match_is_evidence
    BEFORE UPDATE ON supplier_invoice
    FOR EACH ROW EXECUTE FUNCTION protect_posted_supplier_invoice_match();
