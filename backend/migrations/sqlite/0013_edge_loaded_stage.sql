-- 0013: DISPATCHED becomes LOADED, and two dangling foreign keys are repaired.
--
-- "Dispatched" reads as gone. These goods are on a truck that has not moved:
-- LOADED says what actually happened, and leaves DISPATCHED free to mean the
-- one thing it should — the entity, a truck run.
--
-- SQLite cannot alter a CHECK, so each table has to be rebuilt: a new table,
-- the rows copied across, the old one dropped, the new one renamed, and then
-- every index and trigger typed back. Indexes and triggers die with the table
-- they sit on, and a trigger silently left out fails nothing at all — the box
-- still packs, it simply stops refusing what it used to refuse. Three tests
-- pin the full set of triggers, indexes and columns so a slip here is loud.
--
-- While the tables are open: migration 0009 renamed `dc_fulfillment_package`
-- to `koli` and left `koli_unit` and `dc_fulfillment_progress_event` pointing
-- at the old name. The references have been dangling ever since — inert only
-- because foreign key enforcement happens to be off, and an error waiting for
-- whoever turns it on. They are repaired here.

PRAGMA foreign_keys=OFF;
-- SQLite re-parses every trigger and view when a table is renamed, so that
-- references follow it. That is usually a kindness; during a rebuild it is
-- fatal. Between `DROP TABLE koli` and the rename that puts it back, triggers
-- on OTHER tables still name `koli`, and re-parsing them at that instant fails
-- on a table that does not exist for another statement or two.
--
-- Switching the rename back to its legacy behaviour is what SQLite's own
-- documented rebuild procedure prescribes. Nothing is lost by it here: every
-- index and trigger is recreated explicitly below rather than carried across.
PRAGMA legacy_alter_table=ON;
BEGIN IMMEDIATE;

-- ---------------------------------------------------------------------------
-- koli
-- ---------------------------------------------------------------------------

CREATE TABLE koli_rebuilt (
    koli_id               TEXT PRIMARY KEY,
    destination_store_id  TEXT NOT NULL,
    status                TEXT NOT NULL
                          CHECK (status IN ('PACKED','SHIPMENT','LOADED','IN_TRANSIT')),
    shipment_reference    TEXT,
    created_by            TEXT NOT NULL,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    koli_number           TEXT,
    packing_session_id    TEXT REFERENCES packing_session(session_id),
    sealed_at             TEXT,
    sealed_by             TEXT,
    shipment_id           TEXT REFERENCES shipment(shipment_id),
    sealed_by_capture_id  TEXT REFERENCES packing_capture(capture_id),
    CHECK ((status='PACKED' AND shipment_reference IS NULL)
        OR (status<>'PACKED' AND shipment_reference IS NOT NULL))
);

INSERT INTO koli_rebuilt
    (koli_id,destination_store_id,status,shipment_reference,created_by,created_at,
     updated_at,koli_number,packing_session_id,sealed_at,sealed_by,shipment_id,
     sealed_by_capture_id)
SELECT koli_id,destination_store_id,
       CASE status WHEN 'DISPATCHED' THEN 'LOADED' ELSE status END,
       shipment_reference,created_by,created_at,updated_at,koli_number,
       packing_session_id,sealed_at,sealed_by,shipment_id,sealed_by_capture_id
FROM koli;

DROP TABLE koli;
ALTER TABLE koli_rebuilt RENAME TO koli;

CREATE UNIQUE INDEX ux_koli_number ON koli (koli_number);
CREATE INDEX ix_koli_shipment
    ON koli (shipment_id) WHERE shipment_id IS NOT NULL;
CREATE INDEX ix_koli_packing_session
    ON koli (packing_session_id) WHERE packing_session_id IS NOT NULL;

CREATE TRIGGER koli_number_required_on_insert
BEFORE INSERT ON koli
WHEN NEW.koli_number IS NULL OR trim(NEW.koli_number) = ''
BEGIN
    SELECT RAISE(ABORT, 'koli_number is required');
END;

CREATE TRIGGER koli_number_required_on_update
BEFORE UPDATE OF koli_number ON koli
WHEN NEW.koli_number IS NULL OR trim(NEW.koli_number) = ''
BEGIN
    SELECT RAISE(ABORT, 'koli_number is required');
END;

CREATE TRIGGER koli_sealed_before_shipment
BEFORE UPDATE OF shipment_id ON koli
WHEN NEW.shipment_id IS NOT NULL AND NEW.sealed_at IS NULL
BEGIN
    SELECT RAISE(ABORT, 'a koli must be sealed before it joins a shipment');
END;

CREATE TRIGGER koli_seal_is_final
BEFORE UPDATE OF sealed_at ON koli
WHEN OLD.sealed_at IS NOT NULL AND NEW.sealed_at IS NOT OLD.sealed_at
BEGIN
    SELECT RAISE(ABORT, 'a sealed koli cannot be unsealed');
END;

CREATE TRIGGER koli_seal_names_its_own_capture
BEFORE UPDATE OF sealed_by_capture_id ON koli
WHEN NEW.sealed_by_capture_id IS NOT NULL
 AND (SELECT s.koli_id
        FROM packing_capture c
        JOIN packing_session s ON s.session_id = c.session_id
       WHERE c.capture_id = NEW.sealed_by_capture_id) IS NOT NEW.koli_id
BEGIN
    SELECT RAISE(ABORT, 'that capture belongs to a different koli');
END;

-- ---------------------------------------------------------------------------
-- koli_unit
-- ---------------------------------------------------------------------------

CREATE TABLE koli_unit_rebuilt (
    -- Repaired: this pointed at `dc_fulfillment_package`, which 0009 renamed
    -- away.
    koli_id             TEXT NOT NULL REFERENCES koli(koli_id),
    subject_id          TEXT NOT NULL REFERENCES inventory_subject(id),
    epc                 TEXT NOT NULL,
    sku_code            TEXT NOT NULL,
    allotment_id        TEXT NOT NULL REFERENCES dc_allotment_work(allotment_id),
    allotment_line_id   TEXT NOT NULL REFERENCES dc_allotment_work_line(allotment_line_id),
    current_stage       TEXT NOT NULL
                        CHECK (current_stage IN ('PACKED','SHIPMENT','LOADED','IN_TRANSIT')),
    stage_rank          INTEGER NOT NULL CHECK (stage_rank BETWEEN 2 AND 5),
    packed_at           TEXT NOT NULL,
    shipment_at         TEXT,
    dispatched_at       TEXT,
    in_transit_at       TEXT,
    released_at         TEXT,
    updated_at          TEXT NOT NULL,
    PRIMARY KEY (koli_id, epc)
);

INSERT INTO koli_unit_rebuilt
    (koli_id,subject_id,epc,sku_code,allotment_id,allotment_line_id,current_stage,
     stage_rank,packed_at,shipment_at,dispatched_at,in_transit_at,released_at,updated_at)
SELECT koli_id,subject_id,epc,sku_code,allotment_id,allotment_line_id,
       CASE current_stage WHEN 'DISPATCHED' THEN 'LOADED' ELSE current_stage END,
       stage_rank,packed_at,shipment_at,dispatched_at,in_transit_at,released_at,updated_at
FROM koli_unit;

DROP TABLE koli_unit;
ALTER TABLE koli_unit_rebuilt RENAME TO koli_unit;

CREATE UNIQUE INDEX ux_dc_active_package_epc
    ON koli_unit(epc) WHERE released_at IS NULL;
CREATE UNIQUE INDEX ux_dc_active_package_subject
    ON koli_unit(subject_id) WHERE released_at IS NULL;
CREATE INDEX ix_dc_package_allotment
    ON koli_unit(allotment_line_id, stage_rank, epc);

CREATE TRIGGER koli_unit_not_after_seal
BEFORE INSERT ON koli_unit
WHEN (SELECT sealed_at FROM koli WHERE koli_id = NEW.koli_id) IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'cannot add a unit to a sealed koli');
END;

-- ---------------------------------------------------------------------------
-- dc_fulfillment_progress_event
-- ---------------------------------------------------------------------------

CREATE TABLE dc_fulfillment_progress_event_rebuilt (
    progress_id          TEXT PRIMARY KEY,
    -- Repaired for the same reason as above.
    package_id           TEXT NOT NULL REFERENCES koli(koli_id),
    source_site_id       TEXT NOT NULL,
    destination_store_id TEXT NOT NULL,
    stage                TEXT NOT NULL
                         CHECK (stage IN ('PACKED','SHIPMENT','LOADED','IN_TRANSIT')),
    shipment_reference   TEXT,
    movement_group_id    TEXT NOT NULL UNIQUE REFERENCES movement_group(id),
    actor_id             TEXT NOT NULL,
    occurred_at          TEXT NOT NULL,
    units_json           TEXT NOT NULL,
    fact_seq             INTEGER NOT NULL UNIQUE CHECK (fact_seq >= 1)
);

INSERT INTO dc_fulfillment_progress_event_rebuilt
    (progress_id,package_id,source_site_id,destination_store_id,stage,
     shipment_reference,movement_group_id,actor_id,occurred_at,units_json,fact_seq)
SELECT progress_id,package_id,source_site_id,destination_store_id,
       CASE stage WHEN 'DISPATCHED' THEN 'LOADED' ELSE stage END,
       shipment_reference,movement_group_id,actor_id,occurred_at,units_json,fact_seq
FROM dc_fulfillment_progress_event;

DROP TABLE dc_fulfillment_progress_event;
ALTER TABLE dc_fulfillment_progress_event_rebuilt
    RENAME TO dc_fulfillment_progress_event;

CREATE TRIGGER dc_fulfillment_progress_reject_update
BEFORE UPDATE ON dc_fulfillment_progress_event BEGIN
    SELECT RAISE(ABORT, 'dc_fulfillment_progress_event is append-only');
END;

CREATE TRIGGER dc_fulfillment_progress_reject_delete
BEFORE DELETE ON dc_fulfillment_progress_event BEGIN
    SELECT RAISE(ABORT, 'dc_fulfillment_progress_event is append-only');
END;

COMMIT;
PRAGMA legacy_alter_table=OFF;
PRAGMA foreign_keys=ON;
