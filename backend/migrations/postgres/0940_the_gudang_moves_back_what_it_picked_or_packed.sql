-- The cloud-run Gudang takes its own work back: Packed → Picked, Packed →
-- To pick, Picked → To pick (owner, 9 Oct 2026;
-- docs/research/2026-10-09-outbound-cancel-edit-build.md, src/cloud/dc/move_back.rs).
--
--   dc_move_back            one move back, kept so a retry answers with it
--                           instead of opening the carton twice
--   dc_koli_unit_guard      a move back may take pieces out of a sealed
--                           carton that is on no surat jalan yet (its label
--                           is printed again); nothing else may
--   ix_dc_koli_unsent       the cartons still in the building, read every
--                           30 s by the board's owed work (`dc/owed.rs`)

CREATE TABLE IF NOT EXISTS dc_move_back (
    move_back_id    uuid        PRIMARY KEY,
    site_id         text        NOT NULL,
    -- The shop the pieces were for, as head office names it.
    destination_id  text        NOT NULL CHECK (btrim(destination_id) <> ''),
    -- The carton they left, when they left one.
    koli_id         uuid        REFERENCES dc_koli (koli_id),
    from_stage      text        NOT NULL CHECK (from_stage IN ('picked', 'packed')),
    to_stage        text        NOT NULL CHECK (to_stage IN ('picked', 'pick')),
    moved           bigint      NOT NULL CHECK (moved > 0),
    -- Of them, pieces MD had already taken out: not asked for again.
    settled         bigint      NOT NULL CHECK (settled >= 0 AND settled <= moved),
    reason          text,
    actor_id        text        NOT NULL CHECK (btrim(actor_id) <> ''),
    created_at      timestamptz NOT NULL,
    idempotency_key text        NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
    request         text        NOT NULL,
    result          jsonb       NOT NULL,
    CHECK ((from_stage = 'packed') = (koli_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS dc_move_back_koli_idx
    ON dc_move_back (koli_id) WHERE koli_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_dc_koli_unsent
    ON dc_koli (site_id, created_at)
    WHERE shipment_id IS NULL AND voided_at IS NULL;

-- 0908 made a seal a one-way door: nothing goes into, comes out of, or
-- changes in a sealed box. It still is for everything but a move back, which
-- declares itself for its own transaction (`set_config('dc.move_back', 'on',
-- true)`) and may only take pieces OUT, and only of a carton on no surat
-- jalan: a packing list already on a truck must not be made to lie.
CREATE OR REPLACE FUNCTION dc_koli_unit_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    box     uuid;
    sealed  timestamptz;
    shipped uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        box := OLD.koli_id;
    ELSE
        box := NEW.koli_id;
    END IF;
    SELECT sealed_at, shipment_id INTO sealed, shipped FROM dc_koli WHERE koli_id = box;
    IF sealed IS NOT NULL
       AND NOT (TG_OP = 'DELETE'
                AND shipped IS NULL
                AND COALESCE(current_setting('dc.move_back', true), '') = 'on') THEN
        RAISE EXCEPTION 'a sealed koli is final; its contents cannot change';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END
$$;

COMMENT ON TABLE dc_move_back IS
    'A move back at the cloud-run Gudang (0940): pieces out of a carton or the pick area, back a stage. Kept for the retry and the record.';
COMMENT ON COLUMN dc_koli.voided_at IS
    'Set when a move back took the last piece out (0938, 0940): the carton is gone from every list and cannot be dispatched.';
