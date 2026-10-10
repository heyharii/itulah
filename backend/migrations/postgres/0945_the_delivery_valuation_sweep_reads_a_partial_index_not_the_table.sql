-- The goods-receipt valuation sweep (`receipts_post_pending`) asks one
-- question after every sync pass and once a minute on its own: which
-- receipts have a line that is accepted, matched against its order, and
-- not yet valued? On the load estate (2.2 million delivery lines) the
-- answer meant walking the lines, about three seconds, and the sync
-- applier asked on every cycle — nineteen walks in ten minutes. The
-- applier now asks only after a pass that applied something; this makes
-- each ask cheap besides.
--
-- The question's own shape is the index: a line is pending exactly while
-- posting_id IS NULL and matched_quantity > 0. The half of that which 0390
-- indexed (posting_id IS NULL) cannot shrink — a line the order had no
-- room for (matched_quantity = 0) is never valued, there being nothing to
-- owe for it, so its posting_id stays NULL for the life of the row and it
-- sits in that index for good. This one carries both predicates, so it
-- holds only what the sweep can still pick up, and an estate with nothing
-- pending reads an empty index. receipt_id leads because every reader
-- probes one receipt at a time; received_at follows for the sweep's
-- fresh-only window, the lines that arrived in the last five minutes.
--
-- The half-predicate index is dropped, because every reader of
-- posting_id IS NULL also asks for matched_quantity > 0 — the poster's own
-- day query and tranche query, the sweep, and finance's queue of
-- receipts awaiting posting — and this one serves each of them.

CREATE INDEX IF NOT EXISTS ix_goods_receipt_line_owed
    ON goods_receipt_line (receipt_id, received_at)
    WHERE posting_id IS NULL AND matched_quantity > 0;

DROP INDEX IF EXISTS ix_goods_receipt_line_unvalued;
