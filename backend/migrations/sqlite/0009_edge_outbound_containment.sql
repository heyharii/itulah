-- 0009: Outbound containment — koli, shipment, dispatch, and the sessions that
-- produce them.
--
-- The old model answers "how far along is this unit" with a four-value ladder
-- copied into seven tables. It cannot answer "what is inside what": a shipment
-- was a free-text reference stamped on each box, and a dispatch did not exist
-- at all. This migration adds the containment that answers it.
--
-- Nothing is removed here. The ladder keeps running beside the new tables, so
-- this migration cannot break a flow that works today.
--
-- Two shapes, deliberately different:
--
--   SESSION      work a person performs over time — it has an actor, a start,
--                an end, and it PRODUCES things. Picking and packing.
--   GROUPING     an act of selection. No duration, no worker on duty; it only
--                gathers things that already exist. Shipment and dispatch.
--
-- They do not get the same columns, because they are not the same kind of
-- thing.

PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

-- One picker's run. The goods it yields are NOT yet destined for any store:
-- a picklist reads "fetch 300 of SKU X", and which store each piece serves is
-- decided when it goes into a box. Deciding earlier means goods stranded under
-- a cancelled allotment that have to be moved before anyone else can use them.
CREATE TABLE IF NOT EXISTS pick_session (
    session_id  TEXT PRIMARY KEY,
    picker_id   TEXT NOT NULL CHECK (trim(picker_id) <> ''),
    started_at  TEXT NOT NULL,
    closed_at   TEXT,
    status      TEXT NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN', 'CLOSED')),
    note        TEXT,
    CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);

-- One packer's run. It produces koli — several of them, because a run fills a
-- box, seals it, and starts the next.
CREATE TABLE IF NOT EXISTS packing_session (
    session_id  TEXT PRIMARY KEY,
    packer_id   TEXT NOT NULL CHECK (trim(packer_id) <> ''),
    started_at  TEXT NOT NULL,
    closed_at   TEXT,
    status      TEXT NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN', 'CLOSED')),
    note        TEXT,
    CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);

-- ---------------------------------------------------------------------------
-- Groupings
-- ---------------------------------------------------------------------------

-- One truck run. `departed_at` is the moment custody leaves this DC, and it is
-- the only stage change in the whole outbound flow that moves goods in the
-- physical world.
CREATE TABLE IF NOT EXISTS dispatch (
    dispatch_id     TEXT PRIMARY KEY,
    dispatch_number TEXT NOT NULL UNIQUE CHECK (trim(dispatch_number) <> ''),
    carrier         TEXT,
    vehicle_plate   TEXT,
    driver_name     TEXT,
    created_by      TEXT NOT NULL CHECK (trim(created_by) <> ''),
    created_at      TEXT NOT NULL,
    departed_at     TEXT
);

-- One consignment to one store: the surat jalan that gets signed on arrival.
-- A dispatch may carry several, one per destination.
CREATE TABLE IF NOT EXISTS shipment (
    shipment_id          TEXT PRIMARY KEY,
    shipment_number      TEXT NOT NULL UNIQUE CHECK (trim(shipment_number) <> ''),
    destination_store_id TEXT NOT NULL CHECK (trim(destination_store_id) <> ''),
    -- NULL until it is loaded onto a truck run.
    dispatch_id          TEXT REFERENCES dispatch(dispatch_id),
    created_by           TEXT NOT NULL CHECK (trim(created_by) <> ''),
    created_at           TEXT NOT NULL,
    closed_at            TEXT
);

CREATE INDEX IF NOT EXISTS ix_shipment_dispatch
    ON shipment (dispatch_id) WHERE dispatch_id IS NOT NULL;

-- Numbers are minted at the DC. The site inside each one is what makes it
-- unique across the fleet without a central allocator handing them out.
CREATE TABLE IF NOT EXISTS outbound_number_counter (
    kind        TEXT PRIMARY KEY CHECK (kind IN ('KOLI', 'SHIPMENT', 'DISPATCH')),
    last_number INTEGER NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);
INSERT OR IGNORE INTO outbound_number_counter (kind, last_number)
VALUES ('KOLI', 0), ('SHIPMENT', 0), ('DISPATCH', 0);

-- ---------------------------------------------------------------------------
-- The box becomes a koli
-- ---------------------------------------------------------------------------
--
-- `dc_fulfillment_package` was already a koli: a box with units in it. What it
-- lacked was a number, a seal, and a parent. The `dc_` prefix is a convention
-- this schema abandoned at migration 0005 — everything since is a plain noun —
-- and "fulfillment package" is ecommerce jargon for what the warehouse floor
-- calls a koli.
--
-- The box is created under its own name in 0004; what it lacked, and what this
-- migration adds, is a number, a seal, and a parent.

-- `KOLI-dc-01-000123`. Printed on the sticker, encoded in its QR, spoken over
-- the radio when something goes missing.
ALTER TABLE koli ADD COLUMN koli_number TEXT;

-- The run that produced this box. Not the PICK session: picking and packing
-- are not one-to-one, and a box may hold goods from more than one fetch.
ALTER TABLE koli ADD COLUMN packing_session_id TEXT REFERENCES packing_session(session_id);

-- The moment the contents became final. A packing list printed before this is
-- a document that can still be made to lie.
ALTER TABLE koli ADD COLUMN sealed_at TEXT;
ALTER TABLE koli ADD COLUMN sealed_by TEXT;

-- The consignment this box belongs to; NULL means still on the packing bench.
ALTER TABLE koli ADD COLUMN shipment_id TEXT REFERENCES shipment(shipment_id);

-- Boxes that predate this migration get a number so the column is total. They
-- are distinguishable on sight, which is the point: nobody should mistake a
-- back-filled number for one that was minted at the bench.
UPDATE koli
   SET koli_number = 'KOLI-LEGACY-' || koli_id
 WHERE koli_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_koli_number ON koli (koli_number);
CREATE INDEX IF NOT EXISTS ix_koli_shipment
    ON koli (shipment_id) WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_koli_packing_session
    ON koli (packing_session_id) WHERE packing_session_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Invariants that ALTER TABLE cannot express
-- ---------------------------------------------------------------------------
--
-- SQLite cannot add NOT NULL or CHECK to an existing table without rebuilding
-- it, and rebuilding three tables by hand to gain three constraints is a worse
-- trade than stating them as triggers. These are enforced by the database, not
-- by whoever remembers to call the right function.

CREATE TRIGGER IF NOT EXISTS koli_number_required_on_insert
BEFORE INSERT ON koli
WHEN NEW.koli_number IS NULL OR trim(NEW.koli_number) = ''
BEGIN
    SELECT RAISE(ABORT, 'koli_number is required');
END;

CREATE TRIGGER IF NOT EXISTS koli_number_required_on_update
BEFORE UPDATE OF koli_number ON koli
WHEN NEW.koli_number IS NULL OR trim(NEW.koli_number) = ''
BEGIN
    SELECT RAISE(ABORT, 'koli_number is required');
END;

-- An open box cannot be shipped. Whatever is written on its packing list would
-- be a claim about contents that can still change while the paper travels.
CREATE TRIGGER IF NOT EXISTS koli_sealed_before_shipment
BEFORE UPDATE OF shipment_id ON koli
WHEN NEW.shipment_id IS NOT NULL AND NEW.sealed_at IS NULL
BEGIN
    SELECT RAISE(ABORT, 'a koli must be sealed before it joins a shipment');
END;

-- A seal is a one-way door. Re-opening a sealed box would silently invalidate
-- a packing list that has already been printed and, quite possibly, already
-- travelled.
CREATE TRIGGER IF NOT EXISTS koli_seal_is_final
BEFORE UPDATE OF sealed_at ON koli
WHEN OLD.sealed_at IS NOT NULL AND NEW.sealed_at IS NOT OLD.sealed_at
BEGIN
    SELECT RAISE(ABORT, 'a sealed koli cannot be unsealed');
END;

-- Nothing may be added to a box after it is sealed.
CREATE TRIGGER IF NOT EXISTS koli_unit_not_after_seal
BEFORE INSERT ON koli_unit
WHEN (SELECT sealed_at FROM koli WHERE koli_id = NEW.koli_id) IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'cannot add a unit to a sealed koli');
END;

-- A packing session cannot be closed while it still holds an open box. The
-- packer is the only person who knows whether that box is finished.
CREATE TRIGGER IF NOT EXISTS packing_session_closes_only_when_sealed
BEFORE UPDATE OF status ON packing_session
WHEN NEW.status = 'CLOSED'
 AND EXISTS (SELECT 1 FROM koli
              WHERE packing_session_id = NEW.session_id AND sealed_at IS NULL)
BEGIN
    SELECT RAISE(ABORT, 'packing session still has an unsealed koli');
END;

-- Once the truck has gone, its contents are history. Adding a consignment to a
-- departed dispatch would describe goods onto a vehicle that is already away.
CREATE TRIGGER IF NOT EXISTS shipment_not_onto_departed_dispatch
BEFORE UPDATE OF dispatch_id ON shipment
WHEN NEW.dispatch_id IS NOT NULL
 AND (SELECT departed_at FROM dispatch WHERE dispatch_id = NEW.dispatch_id) IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'that dispatch has already departed');
END;

-- Departure is a fact about the physical world and happens once.
CREATE TRIGGER IF NOT EXISTS dispatch_departs_once
BEFORE UPDATE OF departed_at ON dispatch
WHEN OLD.departed_at IS NOT NULL AND NEW.departed_at IS NOT OLD.departed_at
BEGIN
    SELECT RAISE(ABORT, 'that dispatch has already departed');
END;

COMMIT;
PRAGMA foreign_keys=ON;
