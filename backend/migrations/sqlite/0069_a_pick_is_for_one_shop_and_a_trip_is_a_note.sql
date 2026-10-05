-- 0069: a pick is for one shop, and a trip is a note.
--
-- Owner, 29 Sep 2026: picking makes one picklist per shop, packing packs
-- straight from that shop's picklist (no RFID sweep required), and Dispatch
-- is the one act after packing — it makes the surat jalan and the goods are
-- in transit. Shipments as a separate station are gone.
--
-- `pick_session.destination_id` is the shop a round was walked for, and
-- `allotment_id` the allotment it answers: a picklist exists for every
-- allotment × shop as soon as the allotment is here (owner, 29 Sep 2026), and
-- packing gathers a shop's picklists back together. Both NULL on rounds an
-- older build raised for nobody in particular.
--
-- `dc_pick_unit` is which pieces a pick moved into the pick area. The pick
-- area stays one pool in the ledger; this is what lets a carton be packed
-- from "store 3's picklist" rather than from a shared heap, so the pieces
-- a picker set aside for one shop are the pieces that shop's carton holds.
-- A piece picked twice (put back, picked again) has two rows; the newest
-- (highest rowid) is the one that counts.
--
-- `dispatch.trip_note` replaces asking for a plate and a driver: whatever the
-- bay knows about the trip, as free text, printed on the surat jalan.
--
-- The ALTERs make this probed: it runs while `pick_session.destination_id`
-- is absent.

ALTER TABLE pick_session ADD COLUMN destination_id TEXT;
ALTER TABLE pick_session ADD COLUMN allotment_id TEXT;
ALTER TABLE dispatch ADD COLUMN trip_note TEXT;

CREATE TABLE IF NOT EXISTS dc_pick_unit (
    pick_id         TEXT NOT NULL,
    pick_session_id TEXT,
    subject_id      TEXT NOT NULL,
    sku_code        TEXT NOT NULL,
    PRIMARY KEY (pick_id, subject_id)
);
CREATE INDEX IF NOT EXISTS dc_pick_unit_by_session
    ON dc_pick_unit (pick_session_id, sku_code);
CREATE INDEX IF NOT EXISTS dc_pick_unit_by_subject
    ON dc_pick_unit (subject_id);
