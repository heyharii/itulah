-- 0964: the Gudang acknowledges what MD changed, and a move back names its
-- allotment.
--
-- The owner (2026-10-10): an allotment MD cancels or edits while the warehouse
-- is working on it must never vanish from the warehouse's board unseen. Each
-- change MD made (`allotment_amendment`, 0938) waits until somebody in the
-- Gudang taps "Got it" (or "Remove", for a picklist cancelled before anything
-- was taken), and MD's History says who did and when.
--
-- One row per amendment acknowledged. Changes made before this migration are
-- acknowledged here, by 'migration', so the board does not wake up to every
-- test edit ever made; History leaves those rows out.

CREATE TABLE IF NOT EXISTS allotment_amendment_ack (
    amendment_id    uuid        PRIMARY KEY REFERENCES allotment_amendment (id),
    actor_id        text        NOT NULL CHECK (btrim(actor_id) <> ''),
    acknowledged_at timestamptz NOT NULL
);

INSERT INTO allotment_amendment_ack (amendment_id, actor_id, acknowledged_at)
SELECT id, 'migration', now() FROM allotment_amendment
ON CONFLICT (amendment_id) DO NOTHING;

-- The allotment a move back was for, when the warehouse named one: MD's
-- History lists the move backs of her allotment.
ALTER TABLE dc_move_back ADD COLUMN IF NOT EXISTS allotment_id uuid REFERENCES allotment (id);
CREATE INDEX IF NOT EXISTS dc_move_back_allotment_idx
    ON dc_move_back (allotment_id) WHERE allotment_id IS NOT NULL;
