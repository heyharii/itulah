-- 0068: a DC holds what goes back to the supplier.
--
-- A count over the order puts every piece in the Unidentified pool, and only
-- the matched part is ever set up and labelled (cloud 0178). The rest stays
-- there as the untagged quantity the count created, until the buyer puts it
-- on a purchase return (cloud 0710) and this node hands it to the supplier.
--
-- The return arrives down the command lane (`purchase.return.raise`) and is
-- work here: which receipt lines, how many pieces, for which supplier.
-- Handing it over is one movement out of Unidentified to the supplier, with
-- the return as its reference; that movement going up is what closes the
-- return at the centre. Creates only, so it runs on every open.

CREATE TABLE IF NOT EXISTS purchase_return (
    return_id         TEXT PRIMARY KEY,
    return_number     TEXT NOT NULL,
    purchase_order_id TEXT NOT NULL,
    po_number         TEXT NOT NULL,
    supplier_id       TEXT NOT NULL,
    supplier_name     TEXT,
    note              TEXT,
    raised_by         TEXT NOT NULL,
    received_at       TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'OPEN'
                      CHECK (status IN ('OPEN', 'HANDED_OVER')),
    handed_over_by    TEXT,
    -- Who took the goods for the supplier: a driver's name, off the bay.
    handed_over_to    TEXT,
    handed_over_at    TEXT,
    movement_group_id TEXT,
    CHECK ((status = 'HANDED_OVER') = (handed_over_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ix_purchase_return_status
    ON purchase_return (status, received_at);

CREATE TABLE IF NOT EXISTS purchase_return_line (
    return_id       TEXT NOT NULL REFERENCES purchase_return (return_id),
    -- The accepted count the pieces arrived on; the pile is found through it.
    receipt_line_id TEXT NOT NULL,
    po_line_id      TEXT NOT NULL,
    article_code    TEXT NOT NULL,
    article_name    TEXT NOT NULL,
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (return_id, receipt_line_id)
);
