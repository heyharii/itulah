-- 0092: A piece sold without a tag comes back by its SKU.
--
-- Owner, 25 Oct 2026 ("yg penting tau skunya"): a return or an exchange of a
-- piece rung by its typed SKU (`unmatched_sale_line`, kind NO_TAG /
-- NOT_IN_STOCK / OTHER) names the SKU, and the node takes back the first line
-- of that SKU on the receipt not yet returned. `sale_return_line` cannot hold
-- it: it is keyed by the unit (`subject_id NOT NULL REFERENCES
-- inventory_subject`), and an untagged line has none. So it is written here,
-- one row per unmatched line, under the same `sale_return` header.
--
-- Nothing moved at the sale for such a line (`0084`), so nothing moves back,
-- unless head office had already matched it to a piece of this shop
-- (`unmatched_sale_take` TAKEN): that piece comes home.
--
-- `IF NOT EXISTS`: creates only, runs on every open.

CREATE TABLE IF NOT EXISTS unmatched_return_line (
    return_id         TEXT NOT NULL REFERENCES sale_return(id),
    sale_id           TEXT NOT NULL REFERENCES sale(id),
    unmatched_line_id TEXT NOT NULL REFERENCES unmatched_sale_line(id),
    sku_code          TEXT NOT NULL,
    -- What that line was charged on the day.
    refund_minor      INTEGER NOT NULL CHECK (refund_minor >= 0),
    disposition       TEXT NOT NULL CHECK (disposition IN ('RESALEABLE', 'DAMAGED')),
    PRIMARY KEY (return_id, unmatched_line_id)
);

-- One line cannot come back twice.
CREATE UNIQUE INDEX IF NOT EXISTS unmatched_return_line_once
    ON unmatched_return_line (unmatched_line_id);

CREATE INDEX IF NOT EXISTS unmatched_return_line_by_sale
    ON unmatched_return_line (sale_id);
