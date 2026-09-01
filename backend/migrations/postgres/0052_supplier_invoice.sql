-- 0052: The supplier's bill, as finance books it.
--
-- # Why this is not the invoice the warehouse already recorded
--
-- 0028 gave `goods_receipt` four nullable columns — invoice number, date, total
-- and a document reference — because the verifier at the loading bay is the
-- only person in the estate who can see the paper that came with the goods.
-- That record is evidence. It is not a bookable document: it has no lines, no
-- tax split, no due date, and nothing decided whether it may be paid.
--
-- So finance's invoice ADOPTS that record rather than copying it. The link
-- table below says which deliveries a bill covers, and the ordinary case is one
-- delivery. A supplier who bills a week at a time is not then a schema change.
--
-- # Why there is no goods-received-not-invoiced account
--
-- Because the client's chart of accounts does not have one, and inventing an
-- account they do not keep would put a line in their books that their own
-- accountant cannot explain. The consequence is real and is not hidden:
-- goods that have arrived and not been billed are in the warehouse and not in
-- the ledger, so at a month end both inventory and payables understate by that
-- amount. Payables reports the exposure as a list of receipts with no bill
-- against them; the balance sheet does not, because there is nowhere honest
-- to put it.
--
-- If Finance later wants it booked, that is one new account family, one row in
-- `account_map` and one posting rule. Nothing here has to be undone.

CREATE TABLE supplier_invoice (
    invoice_id      uuid PRIMARY KEY,
    -- The supplier's own number, as printed. Unique per supplier and not
    -- globally: two suppliers numbering from 1 is ordinary, and a global unique
    -- would reject the second one for no reason.
    invoice_number  text NOT NULL CHECK (btrim(invoice_number) <> ''),
    supplier_id     text NOT NULL,
    supplier_name   text,

    -- Which location owes this. The client keeps a profit and loss per site and
    -- their account codes carry the location, so a bill that could not say
    -- where it belongs could not be posted at all.
    site_id         text NOT NULL REFERENCES site(id),

    invoice_date    date NOT NULL,
    due_date        date,
    currency        char(3) NOT NULL,

    -- Goods, tax and the agreed reduction, kept apart because they post to
    -- three different accounts. A single total would have to be split again at
    -- posting time by a rule nobody wrote down.
    subtotal_minor  bigint NOT NULL CHECK (subtotal_minor >= 0),
    tax_minor       bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
    discount_minor  bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
    total_minor     bigint NOT NULL CHECK (total_minor >= 0),

    -- Where the scan lives. A reference, not the bytes.
    document_ref    text,

    -- DRAFT       keyed in, not yet reconciled against what was ordered and received
    -- MATCHED     reconciled; differences either none or accepted
    -- POSTED      in the ledger
    -- REJECTED    sent back to the supplier; never posts
    -- VOID        posted and then reversed
    status          text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'MATCHED', 'POSTED', 'REJECTED', 'VOID')),

    journal_entry_id uuid REFERENCES journal_entry(entry_id),

    recorded_by     text NOT NULL,
    recorded_at     timestamptz NOT NULL DEFAULT now(),
    posted_by       text,
    posted_at       timestamptz,
    note            text,

    UNIQUE (supplier_id, invoice_number),
    CHECK (total_minor = subtotal_minor + tax_minor - discount_minor),
    CHECK (due_date IS NULL OR due_date >= invoice_date),
    -- Posted and in the ledger are the same fact, so they cannot disagree.
    CHECK ((status IN ('POSTED', 'VOID')) = (journal_entry_id IS NOT NULL)),
    CHECK ((posted_at IS NULL) = (posted_by IS NULL)),
    CHECK ((status IN ('POSTED', 'VOID')) = (posted_at IS NOT NULL))
);
CREATE INDEX ix_supplier_invoice_supplier ON supplier_invoice (supplier_id, invoice_date DESC);
CREATE INDEX ix_supplier_invoice_status ON supplier_invoice (status, due_date);

-- One billed line. `po_line_id` is what ties it back to what was ordered; it
-- is nullable because a supplier may bill for something that was never ordered
-- as stock — freight, a pallet charge — and refusing to record that would mean
-- refusing to record the invoice as it actually reads.
CREATE TABLE supplier_invoice_line (
    invoice_line_id   uuid PRIMARY KEY,
    invoice_id        uuid NOT NULL REFERENCES supplier_invoice(invoice_id) ON DELETE CASCADE,
    line_number       integer NOT NULL CHECK (line_number > 0),

    po_line_id        uuid REFERENCES purchase_order_line(po_line_id),
    description       text NOT NULL CHECK (btrim(description) <> ''),

    -- In stock units, the same unit `goods_receipt_line.quantity` counts in, so
    -- the two can be compared without a conversion nobody remembers to apply.
    quantity          bigint NOT NULL CHECK (quantity > 0),
    unit_price_minor  bigint NOT NULL CHECK (unit_price_minor >= 0),
    line_amount_minor bigint NOT NULL CHECK (line_amount_minor >= 0),
    tax_minor         bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),

    UNIQUE (invoice_id, line_number)
);
CREATE INDEX ix_supplier_invoice_line_invoice ON supplier_invoice_line (invoice_id);
CREATE INDEX ix_supplier_invoice_line_po_line ON supplier_invoice_line (po_line_id)
    WHERE po_line_id IS NOT NULL;

-- Which deliveries this bill covers.
--
-- A table rather than a column on the invoice: one bill covering three trucks is
-- how suppliers actually bill, and a single foreign key would force finance to
-- either split the bill or lose the link to two of the three.
CREATE TABLE supplier_invoice_receipt (
    invoice_id  uuid NOT NULL REFERENCES supplier_invoice(invoice_id) ON DELETE CASCADE,
    receipt_id  uuid NOT NULL REFERENCES goods_receipt(receipt_id),
    PRIMARY KEY (invoice_id, receipt_id)
);
CREATE INDEX ix_supplier_invoice_receipt_receipt ON supplier_invoice_receipt (receipt_id);

-- A posted invoice is evidence of what was booked. Its amounts may not move
-- afterwards, because the journal that quotes them cannot move either.
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
    ) THEN
        RAISE EXCEPTION
            'supplier invoice % is posted; reverse the journal entry instead of editing the bill',
            OLD.invoice_number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER supplier_invoice_posted_is_evidence
    BEFORE UPDATE ON supplier_invoice
    FOR EACH ROW EXECUTE FUNCTION protect_posted_supplier_invoice();

COMMENT ON TABLE supplier_invoice IS
    'The supplier bill as finance books it. Adopts the invoice the DC recorded on a goods receipt rather than copying it; a posted invoice is immutable.';
COMMENT ON COLUMN supplier_invoice_line.quantity IS
    'Billed quantity in stock units — the same unit goods_receipt_line.quantity counts, so billed and received compare without a conversion.';
