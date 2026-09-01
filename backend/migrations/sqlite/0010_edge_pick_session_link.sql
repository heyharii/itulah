-- 0010: Tie each pick to the round it happened in.
--
-- Migration 0009 introduced `pick_session` and then left it orphaned: it
-- recorded who was picking and when, and nothing about what they fetched. So
-- the one question a picking round exists to answer — "this trip round the
-- racks, what came back?" — had no way to be asked.
--
-- A picker does not walk out for one SKU. They take a sheet listing everything
-- still owed, walk the aisles once, and confirm each SKU as it comes off its
-- rack. Many picks, one round. The event stays per SKU because that is the unit
-- of the thing that actually happens at a rack; the session is what gathers
-- them.

ALTER TABLE dc_allotment_pick_event
    ADD COLUMN pick_session_id TEXT REFERENCES pick_session(session_id);

CREATE INDEX IF NOT EXISTS ix_pick_event_session
    ON dc_allotment_pick_event (pick_session_id)
    WHERE pick_session_id IS NOT NULL;
