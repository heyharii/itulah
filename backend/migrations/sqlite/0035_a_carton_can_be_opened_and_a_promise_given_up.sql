-- 0035: the counters a DC needs when goods come back out of a carton, or never
-- reach the shop at all.
--
-- Until now this node could only count forwards: accepted, picked, packed,
-- shipment, dispatched, in transit. Two ordinary things had nowhere to go.
--
-- A carton is opened again — wrong size, wrong shop, a koli pulled out of a
-- shipment, a pallet taken off a lorry that is not leaving. Each is its own
-- fact here rather than a decrement of the forward counter, because a
-- decrement erases that the reversal happened and lets two different histories
-- satisfy the same row.
--
-- And a piece is lost. Where it was lost is what decides who reports it — the
-- DC for goods that vanish here after being bound to a shop, the road for a
-- lorry that never arrives, the shop for a koli handed over with two shirts
-- missing inside. None of those is this node's to decide: **Inventory settles
-- whether goods are found or gone.** What reaches this table is the
-- consequence, and the consequence is always the same shape — the demand comes
-- back, and the bench has that much more to pack.
--
-- `closed_short_quantity` is the other direction: MD giving up, which takes
-- work off this bench and moves no stock at all.
--
-- There is no `handed_over_quantity` or `received_quantity` here. A DC does not
-- see a lorry arrive at a shop; those are the store's facts, settled at the
-- centre, and they reach this node only as demand that did or did not come
-- back.
--
-- The ladder CHECKs on this table (`packed <= picked`, `shipment <= packed`,
-- and the rest) still stand, and are still true of everything that writes to
-- it today. They stop being true when packing a replacement can push `packed`
-- past what was accepted, which is step 6. SQLite cannot alter a CHECK, so
-- swapping them for the place CHECKs means rebuilding the table with every
-- index and trigger typed back — work that belongs in the migration that first
-- writes these counters, not in the one that makes room for them.

ALTER TABLE dc_allotment_work_line
    ADD COLUMN unpacked_quantity INTEGER NOT NULL DEFAULT 0 CHECK (unpacked_quantity >= 0);
ALTER TABLE dc_allotment_work_line
    ADD COLUMN unshipped_quantity INTEGER NOT NULL DEFAULT 0 CHECK (unshipped_quantity >= 0);
ALTER TABLE dc_allotment_work_line
    ADD COLUMN unloaded_quantity INTEGER NOT NULL DEFAULT 0 CHECK (unloaded_quantity >= 0);
ALTER TABLE dc_allotment_work_line
    ADD COLUMN lost_packed_quantity INTEGER NOT NULL DEFAULT 0 CHECK (lost_packed_quantity >= 0);
ALTER TABLE dc_allotment_work_line
    ADD COLUMN lost_in_transit_quantity INTEGER NOT NULL DEFAULT 0 CHECK (lost_in_transit_quantity >= 0);
ALTER TABLE dc_allotment_work_line
    ADD COLUMN lost_at_store_quantity INTEGER NOT NULL DEFAULT 0 CHECK (lost_at_store_quantity >= 0);
ALTER TABLE dc_allotment_work_line
    ADD COLUMN closed_short_quantity INTEGER NOT NULL DEFAULT 0 CHECK (closed_short_quantity >= 0);
