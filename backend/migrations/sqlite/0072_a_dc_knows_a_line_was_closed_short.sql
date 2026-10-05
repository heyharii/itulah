-- A DC knows head office closed a purchase-order line short.
--
-- The buyer decides the rest of a line is not coming. Until now only the
-- centre knew, so the bay kept offering the line for counting. The centre
-- now sends `purchase.order.line.close`; the DC takes the line off its
-- receiving worklist and counts anything that still turns up as beyond the
-- order.
--
-- Applied only when `closed_short_at` is absent; see `edge::sqlite`.
ALTER TABLE purchase_order_line ADD COLUMN closed_short_at TEXT;
