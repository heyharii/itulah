-- Allotment is a commitment against DC Warehouse / On Hand.
-- It is intentionally not an inventory pool, state, place, or movement cause.
CREATE SEQUENCE allotment_number_sequence START 1;

CREATE TABLE allotment (
    id UUID PRIMARY KEY,
    allotment_number TEXT NOT NULL UNIQUE,
    source_pool_id TEXT NOT NULL DEFAULT 'dc.warehouse' REFERENCES operational_pool(id),
    destination_store_id TEXT NOT NULL REFERENCES site(id),
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'PARTIALLY_PICKED', 'FULLY_PICKED', 'CANCELLED')),
    created_by TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    notes TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at TIMESTAMPTZ,
    CHECK (source_pool_id = 'dc.warehouse'),
    CHECK ((status = 'CANCELLED' AND cancelled_at IS NOT NULL) OR status <> 'CANCELLED')
);
CREATE INDEX allotment_destination_status_idx
ON allotment(destination_store_id, status, created_at DESC);

CREATE TABLE allotment_line (
    id UUID PRIMARY KEY,
    allotment_id UUID NOT NULL REFERENCES allotment(id),
    sku_id UUID NOT NULL REFERENCES sku(id),
    requested_qty BIGINT NOT NULL CHECK (requested_qty > 0),
    picked_qty BIGINT NOT NULL DEFAULT 0 CHECK (picked_qty >= 0),
    cancelled_qty BIGINT NOT NULL DEFAULT 0 CHECK (cancelled_qty >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (picked_qty + cancelled_qty <= requested_qty),
    UNIQUE (allotment_id, sku_id)
);
CREATE INDEX allotment_line_sku_idx ON allotment_line(sku_id, allotment_id);

CREATE TABLE allotment_event (
    event_sequence BIGSERIAL UNIQUE NOT NULL,
    id UUID PRIMARY KEY,
    event_key TEXT NOT NULL UNIQUE,
    allotment_id UUID REFERENCES allotment(id),
    allotment_line_id UUID REFERENCES allotment_line(id),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'ALLOTMENT_CREATED',
        'ALLOTMENT_PICKED',
        'ALLOTMENT_PARTIALLY_PICKED',
        'ALLOTMENT_CANCELLED',
        'ALLOTMENT_SHORTAGE'
    )),
    sku_id UUID REFERENCES sku(id),
    destination_store_id TEXT REFERENCES site(id),
    quantity BIGINT NOT NULL CHECK (quantity > 0),
    remaining_delta BIGINT NOT NULL,
    movement_group_id UUID REFERENCES movement_group(id),
    reference_type TEXT,
    reference_id TEXT,
    actor_id TEXT NOT NULL CHECK (btrim(actor_id) <> ''),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (event_type = 'ALLOTMENT_CREATED' AND allotment_id IS NOT NULL AND allotment_line_id IS NOT NULL AND remaining_delta = quantity AND movement_group_id IS NULL)
        OR (event_type IN ('ALLOTMENT_PICKED', 'ALLOTMENT_PARTIALLY_PICKED') AND allotment_id IS NOT NULL AND allotment_line_id IS NOT NULL AND remaining_delta = -quantity AND movement_group_id IS NOT NULL)
        OR (event_type = 'ALLOTMENT_CANCELLED' AND allotment_id IS NOT NULL AND allotment_line_id IS NOT NULL AND remaining_delta = -quantity AND movement_group_id IS NULL)
        OR (event_type = 'ALLOTMENT_SHORTAGE' AND remaining_delta = 0 AND movement_group_id IS NOT NULL)
    )
);
CREATE INDEX allotment_event_allotment_time_idx
ON allotment_event(allotment_id, occurred_at, event_sequence);
CREATE INDEX allotment_event_sku_time_idx
ON allotment_event(sku_id, occurred_at, event_sequence);
CREATE INDEX allotment_event_movement_idx
ON allotment_event(movement_group_id) WHERE movement_group_id IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_allotment_identity() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'allotments cannot be deleted; cancel remaining quantity instead';
    END IF;
    IF OLD.source_pool_id <> NEW.source_pool_id
       OR OLD.destination_store_id <> NEW.destination_store_id
       OR OLD.created_by <> NEW.created_by
       OR OLD.created_at <> NEW.created_at
       OR OLD.idempotency_key <> NEW.idempotency_key THEN
        RAISE EXCEPTION 'allotment identity and destination are immutable; cancel and create a new allotment';
    END IF;
    IF OLD.status IN ('FULLY_PICKED', 'CANCELLED') THEN
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
       OR OLD.sku_id <> NEW.sku_id
       OR OLD.requested_qty <> NEW.requested_qty
       OR OLD.created_at <> NEW.created_at THEN
        RAISE EXCEPTION 'allotment line identity and requested quantity are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER allotment_line_identity_immutable
BEFORE UPDATE OR DELETE ON allotment_line
FOR EACH ROW EXECUTE FUNCTION protect_allotment_line_identity();

CREATE TRIGGER allotment_event_append_only
BEFORE UPDATE OR DELETE ON allotment_event
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

COMMENT ON TABLE allotment IS 'Current DC Warehouse commitment header. It is not an inventory pool, state, place, or movement.';
COMMENT ON TABLE allotment_line IS 'Current per-SKU commitment counters; remaining is requested minus picked minus cancelled.';
COMMENT ON TABLE allotment_event IS 'Immutable Allotment business history, independent from the Inventory movement ledger.';
COMMENT ON COLUMN allotment.destination_store_id IS 'Intended Store destination; physical placement remains unchanged until Pick.';
COMMENT ON COLUMN allotment_event.remaining_delta IS 'Event delta used to reconstruct historical active Allotment independently from Inventory Time Machine.';
