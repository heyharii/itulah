-- Remove the ambiguous executed terminology from Cloud's native Allotment
-- compatibility workflow. Pick, later DC stages, and Store receipt are
-- intentionally separate counters.
ALTER TABLE allotment_line RENAME COLUMN executed_quantity TO picked_quantity;
ALTER TABLE allotment_line
    ADD COLUMN packed_quantity bigint NOT NULL DEFAULT 0 CHECK (packed_quantity >= 0),
    ADD COLUMN shipment_quantity bigint NOT NULL DEFAULT 0 CHECK (shipment_quantity >= 0),
    ADD COLUMN dispatched_quantity bigint NOT NULL DEFAULT 0 CHECK (dispatched_quantity >= 0),
    ADD COLUMN in_transit_quantity bigint NOT NULL DEFAULT 0 CHECK (in_transit_quantity >= 0),
    ADD COLUMN received_quantity bigint NOT NULL DEFAULT 0 CHECK (received_quantity >= 0);

DO $$
DECLARE constraint_row RECORD;
BEGIN
    FOR constraint_row IN
        SELECT conname FROM pg_constraint
        WHERE conrelid='allotment_line'::regclass AND contype='c'
          AND position('picked_quantity' IN pg_get_constraintdef(oid)) > 0
    LOOP
        EXECUTE format('ALTER TABLE allotment_line DROP CONSTRAINT %I',constraint_row.conname);
    END LOOP;
END $$;
ALTER TABLE allotment_line
    ADD CONSTRAINT allotment_line_explicit_lifecycle_check CHECK (
        picked_quantity + cancelled_quantity <= quantity
        AND packed_quantity <= picked_quantity
        AND shipment_quantity <= packed_quantity
        AND dispatched_quantity <= shipment_quantity
        AND in_transit_quantity <= dispatched_quantity
        AND received_quantity <= in_transit_quantity
    );

DO $$
DECLARE constraint_row RECORD;
BEGIN
    FOR constraint_row IN
        SELECT conname FROM pg_constraint
        WHERE conrelid='allotment'::regclass AND contype='c'
          AND position('status' IN pg_get_constraintdef(oid)) > 0
    LOOP
        EXECUTE format('ALTER TABLE allotment DROP CONSTRAINT %I',constraint_row.conname);
    END LOOP;
END $$;
UPDATE allotment SET status='IN_PROGRESS' WHERE status='PARTIALLY_EXECUTED';
UPDATE allotment SET status='IN_PROGRESS' WHERE status='EXECUTED';
ALTER TABLE allotment
    ADD CONSTRAINT allotment_explicit_status_check CHECK (
        status IN ('ACTIVE','IN_PROGRESS','DC_COMPLETED','COMPLETED','CANCELLED','REJECTED')
    );

UPDATE allotment_event SET event_type='ALLOTMENT_PICKED'
WHERE event_type IN ('ALLOTMENT_EXECUTED','ALLOTMENT_PARTIALLY_PICKED');

COMMENT ON COLUMN allotment_line.picked_quantity IS 'Quantity FIFO-allocated at Pick; EPC identity is not known until Pack.';
COMMENT ON COLUMN allotment_line.dispatched_quantity IS 'Quantity that completed DC fulfillment; end-to-end completion still requires Store receipt.';
COMMENT ON TABLE allotment_line IS 'Explicit Allotment lifecycle counters; no executed alias is retained.';
