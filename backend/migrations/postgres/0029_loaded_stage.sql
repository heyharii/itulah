-- 0029: The centre's mirror learns LOADED too.
--
-- The DC renamed the stage a carton is in: "dispatched" reads as gone, and
-- goods on a truck that has not moved have not gone. LOADED says what actually
-- happened, and leaves "dispatch" to mean the one thing it should — the truck
-- run itself.
--
-- Postgres can alter a CHECK in place, so unlike the edge there is no table to
-- rebuild here. Existing rows are carried over: a carton that was loaded before
-- this migration was loaded, whatever the word said at the time.

UPDATE edge_fulfillment_package SET status = 'LOADED' WHERE status = 'DISPATCHED';
UPDATE edge_fulfillment_package_unit SET current_stage = 'LOADED' WHERE current_stage = 'DISPATCHED';
UPDATE edge_fulfillment_progress_fact SET stage = 'LOADED' WHERE stage = 'DISPATCHED';

ALTER TABLE edge_fulfillment_package
    DROP CONSTRAINT edge_fulfillment_package_status_check,
    ADD CONSTRAINT edge_fulfillment_package_status_check
        CHECK (status IN ('PACKED', 'SHIPMENT', 'LOADED', 'IN_TRANSIT'));

ALTER TABLE edge_fulfillment_package_unit
    DROP CONSTRAINT edge_fulfillment_package_unit_current_stage_check,
    ADD CONSTRAINT edge_fulfillment_package_unit_current_stage_check
        CHECK (current_stage IN ('PACKED', 'SHIPMENT', 'LOADED', 'IN_TRANSIT'));

ALTER TABLE edge_fulfillment_progress_fact
    DROP CONSTRAINT edge_fulfillment_progress_fact_stage_check,
    ADD CONSTRAINT edge_fulfillment_progress_fact_stage_check
        CHECK (stage IN ('PACKED', 'SHIPMENT', 'LOADED', 'IN_TRANSIT'));

COMMENT ON COLUMN edge_fulfillment_package.status IS
    'PACKED, SHIPMENT, LOADED or IN_TRANSIT. LOADED means on the truck and '
    'still on the yard; the truck run itself is a dispatch.';
