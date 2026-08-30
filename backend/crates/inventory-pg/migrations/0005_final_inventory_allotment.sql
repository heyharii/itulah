-- Final Inventory projection and generalized Allotment model.
-- Durable ':on_hand' place IDs are retained so immutable movement facts are not rewritten.

-- The ledger state is neutral NORMAL. User-facing On Hand is a derived quantity.
DO $$
DECLARE constraint_row RECORD;
BEGIN
    FOR constraint_row IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'inventory_place'::regclass
          AND contype = 'c'
          AND position('ON_HAND' IN pg_get_constraintdef(oid)) > 0
    LOOP
        EXECUTE format('ALTER TABLE inventory_place DROP CONSTRAINT %I', constraint_row.conname);
    END LOOP;
END $$;

UPDATE inventory_place SET state = 'NORMAL' WHERE state = 'ON_HAND';
ALTER TABLE inventory_place
    ADD CONSTRAINT inventory_place_state_final_check
        CHECK (state IN ('NORMAL', 'MISSING')),
    ADD CONSTRAINT inventory_place_saleable_final_check
        CHECK (NOT is_saleable OR (kind = 'OPERATIONAL' AND state = 'NORMAL'));
COMMENT ON COLUMN inventory_place.state IS 'Neutral ledger state NORMAL or exception state MISSING. User-facing On Hand is derived after subtracting Allotted.';

-- Remove V1 immutability triggers before moving header identity to each line.
DROP TRIGGER IF EXISTS allotment_identity_immutable ON allotment;
DROP TRIGGER IF EXISTS allotment_line_identity_immutable ON allotment_line;
DROP FUNCTION IF EXISTS protect_allotment_identity();
DROP FUNCTION IF EXISTS protect_allotment_line_identity();

-- Replace the Pick-specific header status constraint before translating values.
DO $$
DECLARE constraint_row RECORD;
BEGIN
    FOR constraint_row IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'allotment'::regclass
          AND contype = 'c'
          AND position('PARTIALLY_PICKED' IN pg_get_constraintdef(oid)) > 0
    LOOP
        EXECUTE format('ALTER TABLE allotment DROP CONSTRAINT %I', constraint_row.conname);
    END LOOP;
END $$;

ALTER TABLE allotment
    ADD COLUMN type TEXT NOT NULL DEFAULT 'TO_STORE';
UPDATE allotment SET status = 'PARTIALLY_EXECUTED' WHERE status = 'PARTIALLY_PICKED';
UPDATE allotment SET status = 'EXECUTED' WHERE status = 'FULLY_PICKED';
ALTER TABLE allotment
    ADD CONSTRAINT allotment_type_final_check
        CHECK (type IN ('TO_STORE', 'RETURN_TO_DC', 'RETURN_TO_SUPPLIER')),
    ADD CONSTRAINT allotment_status_final_check
        CHECK (status IN ('ACTIVE', 'PARTIALLY_EXECUTED', 'EXECUTED', 'CANCELLED'));

-- Generic counters and line-level source/destination identity.
ALTER TABLE allotment_line RENAME COLUMN requested_qty TO quantity;
ALTER TABLE allotment_line RENAME COLUMN picked_qty TO executed_quantity;
ALTER TABLE allotment_line RENAME COLUMN cancelled_qty TO cancelled_quantity;
ALTER TABLE allotment_line
    ADD COLUMN source_site_id TEXT,
    ADD COLUMN source_pool_id TEXT,
    ADD COLUMN destination_type TEXT,
    ADD COLUMN destination_id TEXT;

UPDATE allotment_line line
SET source_site_id = source_pool.site_id,
    source_pool_id = header.source_pool_id,
    destination_type = 'STORE',
    destination_id = header.destination_store_id
FROM allotment header
JOIN operational_pool source_pool ON source_pool.id = header.source_pool_id
WHERE header.id = line.allotment_id;

ALTER TABLE operational_pool
    ADD CONSTRAINT operational_pool_id_site_final_unique UNIQUE (id, site_id);
ALTER TABLE allotment_line
    ALTER COLUMN source_site_id SET NOT NULL,
    ALTER COLUMN source_pool_id SET NOT NULL,
    ALTER COLUMN destination_type SET NOT NULL,
    ALTER COLUMN destination_id SET NOT NULL,
    ADD CONSTRAINT allotment_line_source_pool_site_fk
        FOREIGN KEY (source_pool_id, source_site_id) REFERENCES operational_pool(id, site_id),
    ADD CONSTRAINT allotment_line_destination_type_check
        CHECK (destination_type IN ('STORE', 'DC', 'SUPPLIER')),
    ADD CONSTRAINT allotment_line_destination_id_check
        CHECK (
            (destination_type = 'STORE' AND destination_id LIKE 'store-%')
            OR (destination_type = 'DC' AND destination_id = 'dc')
            OR (destination_type = 'SUPPLIER' AND destination_id = 'external/supplier')
        );

ALTER TABLE allotment_line
    DROP CONSTRAINT IF EXISTS allotment_line_allotment_id_sku_id_key;
ALTER TABLE allotment_line
    ADD CONSTRAINT allotment_line_identity_final_unique
        UNIQUE (allotment_id, source_pool_id, destination_type, destination_id, sku_id);
CREATE INDEX allotment_line_source_active_idx
    ON allotment_line(source_pool_id, sku_id, allotment_id);
CREATE INDEX allotment_line_destination_active_idx
    ON allotment_line(destination_type, destination_id, allotment_id);

-- Header no longer owns either endpoint.
DROP INDEX IF EXISTS allotment_destination_status_idx;
ALTER TABLE allotment DROP COLUMN source_pool_id;
ALTER TABLE allotment DROP COLUMN destination_store_id;
CREATE INDEX allotment_type_status_idx ON allotment(type, status, created_at DESC);

-- New immutable events snapshot generic line provenance. Existing V1 events remain valid
-- through their allotment_line_id and are intentionally not rewritten.
ALTER TABLE allotment_event
    ADD COLUMN source_site_id TEXT,
    ADD COLUMN source_pool_id TEXT,
    ADD COLUMN destination_type TEXT,
    ADD COLUMN destination_id TEXT;
ALTER TABLE allotment_event
    ADD CONSTRAINT allotment_event_source_pool_fk
        FOREIGN KEY (source_pool_id) REFERENCES operational_pool(id),
    ADD CONSTRAINT allotment_event_destination_type_check
        CHECK (destination_type IS NULL OR destination_type IN ('STORE', 'DC', 'SUPPLIER')),
    ADD CONSTRAINT allotment_event_provenance_shape_check
        CHECK (
            (source_site_id IS NULL AND source_pool_id IS NULL AND destination_type IS NULL AND destination_id IS NULL)
            OR (source_site_id IS NOT NULL AND source_pool_id IS NOT NULL AND destination_type IS NOT NULL AND destination_id IS NOT NULL)
        );

DO $$
DECLARE constraint_row RECORD;
BEGIN
    FOR constraint_row IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'allotment_event'::regclass
          AND contype = 'c'
          AND position('event_type' IN pg_get_constraintdef(oid)) > 0
    LOOP
        EXECUTE format('ALTER TABLE allotment_event DROP CONSTRAINT %I', constraint_row.conname);
    END LOOP;
END $$;

ALTER TABLE allotment_event
    ADD CONSTRAINT allotment_event_type_final_check CHECK (event_type IN (
        'ALLOTMENT_CREATED',
        'ALLOTMENT_EXECUTED',
        'ALLOTMENT_CANCELLED',
        'ALLOTMENT_SHORTAGE',
        'ALLOTMENT_PICKED',
        'ALLOTMENT_PARTIALLY_PICKED'
    )),
    ADD CONSTRAINT allotment_event_semantics_final_check CHECK (
        (event_type = 'ALLOTMENT_CREATED' AND allotment_id IS NOT NULL AND allotment_line_id IS NOT NULL AND remaining_delta = quantity AND movement_group_id IS NULL)
        OR (event_type IN ('ALLOTMENT_EXECUTED', 'ALLOTMENT_PICKED', 'ALLOTMENT_PARTIALLY_PICKED') AND allotment_id IS NOT NULL AND allotment_line_id IS NOT NULL AND remaining_delta = -quantity AND movement_group_id IS NOT NULL)
        OR (event_type = 'ALLOTMENT_CANCELLED' AND allotment_id IS NOT NULL AND allotment_line_id IS NOT NULL AND remaining_delta = -quantity AND movement_group_id IS NULL)
        OR (event_type = 'ALLOTMENT_SHORTAGE' AND remaining_delta = 0 AND movement_group_id IS NOT NULL)
    );

CREATE OR REPLACE FUNCTION protect_allotment_identity() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'allotments cannot be deleted; cancel remaining quantity instead';
    END IF;
    IF OLD.type <> NEW.type
       OR OLD.created_by <> NEW.created_by
       OR OLD.created_at <> NEW.created_at
       OR OLD.idempotency_key <> NEW.idempotency_key THEN
        RAISE EXCEPTION 'allotment identity and type are immutable; cancel and create a new allotment';
    END IF;
    IF OLD.status IN ('EXECUTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'finalized allotments are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER allotment_identity_immutable
BEFORE UPDATE OR DELETE ON allotment
FOR EACH ROW EXECUTE FUNCTION protect_allotment_identity();

CREATE OR REPLACE FUNCTION protect_allotment_line_identity() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'allotment lines cannot be deleted';
    END IF;
    IF OLD.allotment_id <> NEW.allotment_id
       OR OLD.source_site_id <> NEW.source_site_id
       OR OLD.source_pool_id <> NEW.source_pool_id
       OR OLD.destination_type <> NEW.destination_type
       OR OLD.destination_id <> NEW.destination_id
       OR OLD.sku_id <> NEW.sku_id
       OR OLD.quantity <> NEW.quantity
       OR OLD.created_at <> NEW.created_at THEN
        RAISE EXCEPTION 'allotment line identity and quantity are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER allotment_line_identity_immutable
BEFORE UPDATE OR DELETE ON allotment_line
FOR EACH ROW EXECUTE FUNCTION protect_allotment_line_identity();

COMMENT ON TABLE allotment IS 'Allotment header. Destination decisions are stored on immutable lines; creation does not move inventory.';
COMMENT ON TABLE allotment_line IS 'Typed source and destination with quantity, executed_quantity, and cancelled_quantity; remaining is their difference.';
COMMENT ON COLUMN allotment.type IS 'TO_STORE, RETURN_TO_DC, or RETURN_TO_SUPPLIER.';
COMMENT ON COLUMN allotment_event.remaining_delta IS 'Immutable delta used to reconstruct Allotted by source pool at any time.';
