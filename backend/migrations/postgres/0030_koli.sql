-- 0030: The centre calls a box what the warehouse floor calls it.
--
-- The DC renamed `dc_fulfillment_package` to `koli` in its own migration 0009:
-- "fulfillment package" is ecommerce vocabulary for a thing everyone here calls
-- a koli, and the mirror kept the imported word while the original changed.
--
-- Only the box is renamed. The word "fulfillment" survives elsewhere in these
-- tables and is a separate question — a koli is an object, fulfillment is a
-- process, and one is not the other.

ALTER TABLE edge_fulfillment_package RENAME TO edge_koli;
ALTER TABLE edge_fulfillment_package_unit RENAME TO edge_koli_unit;

ALTER TABLE edge_koli RENAME COLUMN package_id TO koli_id;
ALTER TABLE edge_koli_unit RENAME COLUMN package_id TO koli_id;
ALTER TABLE edge_fulfillment_progress_fact RENAME COLUMN package_id TO koli_id;
ALTER TABLE edge_fulfillment_progress_unit RENAME COLUMN package_id TO koli_id;
ALTER TABLE edge_transfer_allotment_attribution RENAME COLUMN package_id TO koli_id;

COMMENT ON TABLE edge_koli IS
    'The centre''s mirror of a carton sealed at a DC. Named for the thing the '
    'warehouse floor names: a koli is the box, not the process of filling it.';
