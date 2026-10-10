-- `next_po_number` has to know the highest number already filed under today's
-- stamp, so that an order numbered by hand or imported is never collided with.
-- It found it by matching every purchase order's number against a pattern: one
-- full pass over the book on EVERY new order, and the order holds the day's
-- counter row for the whole pass. At 100 000 orders that was 0.6 s; it grows
-- with the book.
--
-- A byte-ordered index lets it read only today's numbers: they are one
-- contiguous range under the "C" collation (the default collation ignores
-- punctuation, so there they are not).
CREATE INDEX IF NOT EXISTS ix_purchase_order_number_bytes
    ON purchase_order ((po_number COLLATE "C"));
