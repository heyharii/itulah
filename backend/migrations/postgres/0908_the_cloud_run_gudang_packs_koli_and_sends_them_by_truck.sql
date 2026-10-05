-- The cloud-run Gudang packs koli and sends them by truck
-- (DC-CLOUD-NATIVE.md, src/cloud/dc/packing.rs).
--
-- When INVENTORY_DC_HOSTING=cloud the warehouse's outbound work is done
-- against the cloud's own tables: the goods move through the Gudang's
-- outbound pools in the cloud's ledger, and what is inside what — piece in
-- koli, koli on surat jalan, surat jalan on a truck run — is kept here, the
-- same containment the DC server keeps in its SQLite (sqlite/0009, 0013).
--
-- How far along a koli is falls out of containment, as on the DC server:
--
--   dc_koli.shipment_id IS NULL        PACKED
--   dc_shipment.dispatch_id IS NULL    SHIPMENT
--   dc_dispatch.departed_at IS NULL    LOADED
--   dc_dispatch.departed_at NOT NULL   IN_TRANSIT
--
-- `dc_koli.stage` is the rung the goods have actually been moved to in the
-- ledger, which is what a retry or a legacy route has to know.

-- A shop that counts a piece in has it; the Gudang lets go of it here, as a
-- DC server does on an in-transit release (edge/sync.rs). The centre's ledger
-- never needed this place until it ran a warehouse.
INSERT INTO inventory_place (id, kind, code, is_company, is_saleable)
VALUES ('system/handed_over', 'SYSTEM', 'HANDED_OVER', FALSE, FALSE)
ON CONFLICT (id) DO NOTHING;

-- One truck run. `departed_at` is the moment custody leaves the Gudang.
CREATE TABLE IF NOT EXISTS dc_dispatch (
    dispatch_id     uuid PRIMARY KEY,
    dispatch_number text NOT NULL UNIQUE CHECK (btrim(dispatch_number) <> ''),
    site_id         text NOT NULL,
    carrier         text,
    vehicle_plate   text,
    driver_name     text,
    -- What the bay wrote about the trip — plate, driver, courier — as one note.
    trip_note       text,
    created_by      text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at      timestamptz NOT NULL,
    departed_at     timestamptz,
    -- The dispatch trip that made it, so a retry answers with this run
    -- instead of loading a second truck.
    trip_key        text UNIQUE,
    trip_request    text,
    CHECK ((trip_key IS NULL) = (trip_request IS NULL))
);

-- One consignment to one shop: the surat jalan it signs on arrival.
CREATE TABLE IF NOT EXISTS dc_shipment (
    shipment_id          uuid PRIMARY KEY,
    shipment_number      text NOT NULL UNIQUE CHECK (btrim(shipment_number) <> ''),
    site_id              text NOT NULL,
    destination_store_id text NOT NULL CHECK (btrim(destination_store_id) <> ''),
    dispatch_id          uuid REFERENCES dc_dispatch (dispatch_id),
    created_by           text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at           timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_dc_shipment_dispatch
    ON dc_shipment (dispatch_id) WHERE dispatch_id IS NOT NULL;

-- The box.
CREATE TABLE IF NOT EXISTS dc_koli (
    koli_id              uuid PRIMARY KEY,
    koli_number          text NOT NULL UNIQUE CHECK (btrim(koli_number) <> ''),
    site_id              text NOT NULL,
    -- The shop, as head office names it (what allotment lines carry).
    destination_store_id text NOT NULL CHECK (btrim(destination_store_id) <> ''),
    -- The shop as its own node spells itself: what the koli's facts and the
    -- shop's inbound announcement carry, so the shop recognises its name.
    wire_destination_id  text NOT NULL CHECK (btrim(wire_destination_id) <> ''),
    stage                text NOT NULL DEFAULT 'PACKED'
                         CHECK (stage IN ('PACKED', 'SHIPMENT', 'LOADED', 'IN_TRANSIT')),
    shipment_id          uuid REFERENCES dc_shipment (shipment_id),
    sealed_at            timestamptz,
    sealed_by            text,
    -- The picklists the packer packed it from, as the bench named them.
    pick_session_ids     text[] NOT NULL DEFAULT '{}',
    created_by           text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at           timestamptz NOT NULL,
    updated_at           timestamptz NOT NULL,
    -- The pack that made it, so a retry answers with this carton instead of
    -- packing a second one from what the first left behind.
    pack_key             text UNIQUE,
    pack_request         text,
    CHECK ((sealed_at IS NULL) = (sealed_by IS NULL)),
    CHECK ((pack_key IS NULL) = (pack_request IS NULL)),
    CHECK (stage = 'PACKED' OR shipment_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_dc_koli_shipment
    ON dc_koli (shipment_id) WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_dc_koli_destination
    ON dc_koli (destination_store_id, created_at);

-- One piece in a box, and the allotment line it answers.
CREATE TABLE IF NOT EXISTS dc_koli_unit (
    koli_id           uuid NOT NULL REFERENCES dc_koli (koli_id),
    subject_id        uuid NOT NULL REFERENCES inventory_subject (id),
    epc               text NOT NULL CHECK (btrim(epc) <> '' AND epc = upper(epc)),
    sku_code          text NOT NULL CHECK (btrim(sku_code) <> ''),
    allotment_id      uuid NOT NULL REFERENCES allotment (id),
    allotment_line_id uuid NOT NULL REFERENCES allotment_line (id),
    PRIMARY KEY (koli_id, subject_id),
    UNIQUE (koli_id, epc)
);
CREATE INDEX IF NOT EXISTS ix_dc_koli_unit_line ON dc_koli_unit (allotment_line_id);
CREATE INDEX IF NOT EXISTS ix_dc_koli_unit_epc ON dc_koli_unit (epc);

-- ---------------------------------------------------------------------------
-- The DC server's rules (sqlite/0009, 0013), enforced by the database
-- ---------------------------------------------------------------------------

-- A seal is a one-way door: a packing list already printed, and quite possibly
-- already travelled, must not be made to lie.
CREATE OR REPLACE FUNCTION dc_koli_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.sealed_at IS NOT NULL
           AND (NEW.sealed_at IS DISTINCT FROM OLD.sealed_at
                OR NEW.sealed_by IS DISTINCT FROM OLD.sealed_by) THEN
            RAISE EXCEPTION 'a sealed koli cannot be unsealed';
        END IF;
        IF OLD.shipment_id IS NOT NULL
           AND NEW.shipment_id IS DISTINCT FROM OLD.shipment_id THEN
            RAISE EXCEPTION 'koli % is already on a surat jalan', OLD.koli_number;
        END IF;
    END IF;
    -- An open box cannot be shipped: its paper would describe contents that
    -- can still change while it travels.
    IF NEW.shipment_id IS NOT NULL AND NEW.sealed_at IS NULL THEN
        RAISE EXCEPTION 'a koli must be sealed before it joins a shipment';
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS dc_koli_guard ON dc_koli;
CREATE TRIGGER dc_koli_guard
BEFORE INSERT OR UPDATE ON dc_koli
FOR EACH ROW EXECUTE FUNCTION dc_koli_guard();

-- Nothing goes into, comes out of, or changes in a sealed box.
CREATE OR REPLACE FUNCTION dc_koli_unit_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    box uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        box := OLD.koli_id;
    ELSE
        box := NEW.koli_id;
    END IF;
    IF (SELECT sealed_at FROM dc_koli WHERE koli_id = box) IS NOT NULL THEN
        RAISE EXCEPTION 'a sealed koli is final; its contents cannot change';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS dc_koli_unit_guard ON dc_koli_unit;
CREATE TRIGGER dc_koli_unit_guard
BEFORE INSERT OR UPDATE OR DELETE ON dc_koli_unit
FOR EACH ROW EXECUTE FUNCTION dc_koli_unit_guard();

-- Once the truck has gone, its contents are history; and a surat jalan on a
-- truck stays on that truck.
CREATE OR REPLACE FUNCTION dc_shipment_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    joining boolean := NEW.dispatch_id IS NOT NULL;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.dispatch_id IS NOT NULL
           AND NEW.dispatch_id IS DISTINCT FROM OLD.dispatch_id THEN
            RAISE EXCEPTION 'surat jalan % is already on a truck run', OLD.shipment_number;
        END IF;
        joining := joining AND OLD.dispatch_id IS NULL;
    END IF;
    IF joining
       AND (SELECT departed_at FROM dc_dispatch WHERE dispatch_id = NEW.dispatch_id) IS NOT NULL THEN
        RAISE EXCEPTION 'that dispatch has already departed';
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS dc_shipment_guard ON dc_shipment;
CREATE TRIGGER dc_shipment_guard
BEFORE INSERT OR UPDATE ON dc_shipment
FOR EACH ROW EXECUTE FUNCTION dc_shipment_guard();

-- Departure is a fact about the physical world and happens once.
CREATE OR REPLACE FUNCTION dc_dispatch_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.departed_at IS NOT NULL AND NEW.departed_at IS DISTINCT FROM OLD.departed_at THEN
        RAISE EXCEPTION 'that dispatch has already departed';
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS dc_dispatch_guard ON dc_dispatch;
CREATE TRIGGER dc_dispatch_guard
BEFORE UPDATE ON dc_dispatch
FOR EACH ROW EXECUTE FUNCTION dc_dispatch_guard();

COMMENT ON TABLE dc_koli IS
    'A koli packed by the cloud-run Gudang (0908): its number, seal, shop and surat jalan. Its pieces are dc_koli_unit; its goods stand in the Gudang''s outbound pools of the cloud ledger.';
COMMENT ON TABLE dc_shipment IS
    'A surat jalan of the cloud-run Gudang (0908): one shop''s koli on one truck run.';
COMMENT ON TABLE dc_dispatch IS
    'A truck run of the cloud-run Gudang (0908). Departs once; takes nothing after.';
