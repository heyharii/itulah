-- 1002: two edits of one purchase order never silently overwrite each other.
--
-- A revise replaced the order with whatever arrived last. Two buyers who
-- opened the same order and both pressed Save left only the second one's
-- order standing, and the first never learnt their change was gone. The
-- lines that already carry goods or a bill were protected; the rest were not.
--
-- The order now carries a version, as a supplier, a supplier item, an article
-- and a unit already do. Every change a person makes to the order — an edit,
-- a cancel, a line closed short, a price approved for the rest of the order —
-- moves it on by one. A revise that names the version it was opened at is
-- refused when the order has moved since. Facts arriving from the Gudang
-- (counts, receipts) do not move it: they are not an edit anyone could have
-- overwritten.
--
-- Every order that exists starts at 1, which is also what a receipt written
-- before this answers with when it is replayed.

ALTER TABLE purchase_order
    ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1 CHECK (version > 0);

COMMENT ON COLUMN purchase_order.version IS
    'Moves on by one with every change a person makes to the order; a revise sent with If-Match is refused when it no longer matches.';
