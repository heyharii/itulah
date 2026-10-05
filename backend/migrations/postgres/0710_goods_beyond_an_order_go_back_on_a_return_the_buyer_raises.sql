-- 0710: goods beyond an order go back on a return the buyer raises.
--
-- An order for 10 kodi that arrives as 10 kodi and 50 loose pieces is 200
-- pieces bought and 50 that were not (0178 splits every receipt line into
-- `matched_quantity` and `excess_quantity`). The 50 are real: the DC put them
-- in its Unidentified pool when it accepted the count, and there they stay —
-- nothing ever identifies them, because only the matched part is set up.
--
-- 0178 wrote a decision for every excess the moment it was verified,
-- 'RETURNED', in the verifier's name. Nothing acted on it: no document, no
-- work at the DC, no movement. The goods stayed on the receiving floor with a
-- row somewhere saying they had gone. The owner (29 Sep 2026): the person who
-- raised the order puts the excess on a return to the supplier, from the
-- order, and the DC hands it back.
--
-- So a decision is written when the buyer raises the return, and the return
-- is a document of its own: which lines, how many pieces, and when the DC
-- handed them to the supplier. Like ERPNext's Purchase Return against a
-- Purchase Receipt — a quantity against the receipt line it arrived on, not a
-- movement of tagged units, because these pieces were never given an
-- identity and are not going to be.

-- The automatic decisions were never acted on; the excess they covered is
-- waiting for its buyer again.
DELETE FROM purchase_excess_decision
 WHERE outcome = 'RETURNED'
   AND reason LIKE '% counted beyond the order — returned to supplier';

CREATE SEQUENCE purchase_return_number_sequence;

CREATE TABLE purchase_return (
    return_id         uuid PRIMARY KEY,
    -- RS-00000001: minted at the centre, where the return is raised.
    return_number     text NOT NULL UNIQUE,
    purchase_order_id uuid NOT NULL REFERENCES purchase_order (purchase_order_id),
    supplier_id       text NOT NULL,
    -- The DC holding the goods: the order's destination.
    site_id           text NOT NULL REFERENCES site (id),
    -- OPEN        raised; the goods are still on the DC's floor
    -- HANDED_OVER the DC gave them to the supplier (its movement came up)
    status            text NOT NULL DEFAULT 'OPEN'
                      CHECK (status IN ('OPEN', 'HANDED_OVER')),
    note              text,
    raised_by         text NOT NULL CHECK (btrim(raised_by) <> ''),
    raised_at         timestamptz NOT NULL DEFAULT now(),
    -- The command that told the DC.
    command_id        uuid,
    handed_over_by    text,
    handed_over_at    timestamptz,
    -- The DC's movement out of Unidentified to the supplier.
    movement_group_id uuid,
    CHECK ((status = 'HANDED_OVER') = (handed_over_at IS NOT NULL))
);

CREATE INDEX ix_purchase_return_order ON purchase_return (purchase_order_id);
CREATE INDEX ix_purchase_return_status ON purchase_return (status, raised_at DESC);

-- One row per receipt line: an excess goes back once, whole. The decision
-- row beside it (purchase_excess_decision, 'RETURNED') says the same thing in
-- the words Finance already reads.
CREATE TABLE purchase_return_line (
    receipt_line_id uuid PRIMARY KEY
                    REFERENCES goods_receipt_line (receipt_line_id),
    return_id       uuid NOT NULL REFERENCES purchase_return (return_id) ON DELETE CASCADE,
    po_line_id      uuid NOT NULL REFERENCES purchase_order_line (po_line_id),
    quantity        bigint NOT NULL CHECK (quantity > 0)
);

CREATE INDEX ix_purchase_return_line_return ON purchase_return_line (return_id);

COMMENT ON TABLE purchase_return IS
    'Goods that arrived beyond a purchase order, going back to the supplier (0710). Raised by the buyer from the order; handed over by the DC holding them.';
COMMENT ON TABLE purchase_return_line IS
    'The excess of one receipt line on a purchase return (0710). Quantity equals the line''s excess_quantity.';
