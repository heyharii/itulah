-- MD reviews a short pick (owner, 18 Oct 2026): Ops says Cannot continue on
-- a pick, MD answers Continue (the picker tries again) or Accept short (the
-- existing Close short). Accept short leaves its own trace on the line's
-- counters; Continue does not, so the report remembers who said it and when.
-- A report MD has answered Continue is no longer in her review and no longer
-- carries the Short pick flag; a new report on the same line starts over.

ALTER TABLE dc_short_pick
    ADD COLUMN IF NOT EXISTS continued_by text,
    ADD COLUMN IF NOT EXISTS continued_at timestamptz,
    ADD CONSTRAINT dc_short_pick_continued_together
        CHECK ((continued_by IS NULL) = (continued_at IS NULL));
