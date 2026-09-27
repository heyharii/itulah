-- A delivery is owed to the supplier the moment its goods are accepted, and a
-- receipt is valued line by line rather than once.
--
-- 0130 made `goods_receipt_posting` one row per receipt, valued "over the
-- lines that existed when it posted". That held while a receipt was one
-- lorry. It is not: the DC never closes an accepted receipt, and the floor
-- counts every new delivery from a supplier into the OPEN receipt it already
-- has for them. So the second purchase order from the same supplier landed on
-- a receipt that was already valued, the primary key refused to value it
-- again, and those goods were never owed to anybody — no trade payable, no
-- cost layer. Found on 2026-09-26 driving PO -> DC receipt -> AP end to end.
--
-- Now one row per TRANCHE: the lines accepted since the receipt was last
-- valued. Each line names the tranche that valued it, so a line is valued
-- exactly once and a line that arrives later is valued on its own.
--
-- The tranche id is also the Payment Ledger voucher. Existing rows keep the
-- receipt id as their tranche id because that is the voucher id their open
-- payables were already filed under.

ALTER TABLE goods_receipt_posting ADD COLUMN posting_id uuid;
UPDATE goods_receipt_posting SET posting_id = receipt_id;
ALTER TABLE goods_receipt_posting ALTER COLUMN posting_id SET NOT NULL;
ALTER TABLE goods_receipt_posting DROP CONSTRAINT goods_receipt_posting_pkey;
ALTER TABLE goods_receipt_posting ADD PRIMARY KEY (posting_id);
CREATE INDEX ix_goods_receipt_posting_receipt ON goods_receipt_posting (receipt_id);

ALTER TABLE goods_receipt_line
    ADD COLUMN posting_id uuid REFERENCES goods_receipt_posting(posting_id);

-- The lines each existing valuation actually counted: those already there
-- when it posted. A line that arrived after is left unvalued, and the
-- receipt poster values it on its first pass — the debt that was missed.
UPDATE goods_receipt_line l
   SET posting_id = p.posting_id
  FROM goods_receipt_posting p
 WHERE p.receipt_id = l.receipt_id
   AND l.received_at <= p.posted_at;

CREATE INDEX ix_goods_receipt_line_unvalued
    ON goods_receipt_line (receipt_id) WHERE posting_id IS NULL;

CREATE OR REPLACE FUNCTION protect_goods_receipt_posting() RETURNS trigger AS $$
BEGIN
    IF NEW.posting_id       IS DISTINCT FROM OLD.posting_id
    OR NEW.receipt_id       IS DISTINCT FROM OLD.receipt_id
    OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
    OR NEW.value_minor      IS DISTINCT FROM OLD.value_minor
    OR NEW.posting_date     IS DISTINCT FROM OLD.posting_date
    OR NEW.currency         IS DISTINCT FROM OLD.currency
    THEN
        RAISE EXCEPTION
            'delivery % is already valued in the ledger; reverse the entry rather than editing what it was worth',
            OLD.receipt_id;
    END IF;
    IF OLD.reversal_entry_id IS NOT NULL
       AND NEW.reversal_entry_id IS DISTINCT FROM OLD.reversal_entry_id THEN
        RAISE EXCEPTION 'delivery % has already been reversed', OLD.receipt_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A valued line stays valued by the tranche that valued it.
CREATE OR REPLACE FUNCTION protect_goods_receipt_line_posting() RETURNS trigger AS $$
BEGIN
    IF OLD.posting_id IS NOT NULL AND NEW.posting_id IS DISTINCT FROM OLD.posting_id THEN
        RAISE EXCEPTION
            'receipt line % is already valued by %; reverse that valuation rather than moving the line',
            OLD.receipt_line_id, OLD.posting_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER goods_receipt_line_valued_once
    BEFORE UPDATE OF posting_id ON goods_receipt_line
    FOR EACH ROW EXECUTE FUNCTION protect_goods_receipt_line_posting();

COMMENT ON TABLE goods_receipt_posting IS
    'Which accepted receipt lines have been valued into the ledger, and for how much. One row per tranche: the lines of one receipt accepted since it was last valued. goods_receipt_line.posting_id names the tranche that valued each line.';
COMMENT ON COLUMN goods_receipt_posting.posting_id IS
    'The tranche, and the Payment Ledger voucher its payable is filed under. Equal to receipt_id for rows written before 0390.';
COMMENT ON COLUMN goods_receipt_line.posting_id IS
    'The valuation that counted this line. NULL means accepted and not yet owed; the receipt poster picks it up.';
