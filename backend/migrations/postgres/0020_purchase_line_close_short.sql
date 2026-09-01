-- Closing a line that will never be filled.
--
-- 100 of 300 arrived and the buyer decides the rest is not coming. The line
-- stops waiting.
--
-- # Why this is not `cancelled_quantity`
--
-- Cancelling 200 says those units were never wanted. Closing short says they
-- were wanted and never came. Those are different facts about a supplier, and
-- folding them together loses the one that matters: a supplier who repeatedly
-- delivers less than ordered looks identical to a buyer who repeatedly
-- changes their mind, and only one of those is the supplier's problem.
--
-- So the shortfall is recorded as what it is, with who accepted it and why.

ALTER TABLE purchase_order_line
    ADD COLUMN closed_short_at     timestamptz,
    ADD COLUMN closed_short_by     text,
    ADD COLUMN closed_short_reason text,
    -- The shortfall at the moment it was written off, in stock units. Kept
    -- rather than recomputed: a later receipt against a reopened line would
    -- otherwise quietly rewrite how short this delivery had been.
    ADD COLUMN closed_short_units  bigint,
    ADD CONSTRAINT purchase_line_close_short_complete CHECK (
        (closed_short_at IS NULL AND closed_short_by IS NULL
         AND closed_short_reason IS NULL AND closed_short_units IS NULL)
        OR (closed_short_at IS NOT NULL AND closed_short_by IS NOT NULL
            AND btrim(closed_short_reason) <> '' AND closed_short_units > 0)
    );

CREATE INDEX ix_po_line_closed_short ON purchase_order_line (closed_short_at)
    WHERE closed_short_at IS NOT NULL;
