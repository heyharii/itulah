-- Picking at the Gudang when the cloud runs it (DC-CLOUD-NATIVE.md,
-- src/cloud/dc/picking.rs).
--
-- The stock move of a pick is the cloud's own allotment execution
-- (`execute_allotment`): it takes the pieces off the allotment line's rack
-- into the Gudang's pick area (the head-office site's PICKING pool) and raises
-- `allotment_line.picked_quantity`. What that leaves unsaid is the paperwork
-- a DC server kept beside it, and that is what these tables are:
--
--   dc_pick_session  one picklist: an allotment × shop, walked once, by whom
--   dc_pick_line     what it asked of one SKU, split over the allotment lines
--                    that SKU was owed on, and what each line actually got
--   dc_pick_piece    which subjects each line moved into the pick area, so a
--                    shop's carton is packed from exactly those (packing reads
--                    them through `dc_pick_waiting`, 0907)

CREATE TABLE IF NOT EXISTS dc_pick_session (
    session_id      uuid        PRIMARY KEY,
    -- The Gudang's site, found by its kind when the picklist was raised.
    site_id         text        NOT NULL,
    picker_id       text        NOT NULL CHECK (btrim(picker_id) <> ''),
    started_at      timestamptz NOT NULL,
    closed_at       timestamptz,
    status          text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    note            text,
    -- The rack the picker named. The pieces come off each allotment line's
    -- own source pool regardless; this is what the hub said, kept as said.
    source_pool_id  text,
    -- One picklist per allotment × shop (owner, 29 Sep 2026).
    destination_id  text,
    allotment_id    uuid        REFERENCES allotment(id),
    -- A retry of the same accept answers with this picklist instead of
    -- walking the racks twice.
    idempotency_key text        UNIQUE,
    request_json    jsonb,
    CHECK (allotment_id IS NULL OR destination_id IS NOT NULL),
    CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS dc_pick_session_started_idx
    ON dc_pick_session (site_id, started_at DESC);

CREATE TABLE IF NOT EXISTS dc_pick_line (
    id                uuid        PRIMARY KEY,
    pick_session_id   uuid        NOT NULL REFERENCES dc_pick_session(session_id),
    sku_code          text        NOT NULL CHECK (btrim(sku_code) <> ''),
    -- NULL on a REFUSED line that no allotment line could take.
    allotment_id      uuid        REFERENCES allotment(id),
    allotment_line_id uuid        REFERENCES allotment_line(id),
    -- PLANNED: how much this allotment line is to give; REFUSED: how much
    -- was asked and could not be picked.
    quantity          bigint      NOT NULL CHECK (quantity > 0),
    picked            bigint      NOT NULL DEFAULT 0 CHECK (picked >= 0),
    status            text        NOT NULL CHECK (status IN ('PLANNED', 'DONE', 'REFUSED')),
    reason            text,
    -- The key the allotment execution runs under: a delivery that died
    -- between planning and executing resumes the same execution, never a
    -- second one.
    execute_key       text        UNIQUE,
    movement_group_id uuid,
    planned_at        timestamptz NOT NULL,
    done_at           timestamptz,
    CHECK (status = 'REFUSED' OR (allotment_line_id IS NOT NULL AND execute_key IS NOT NULL)),
    CHECK (status <> 'DONE' OR movement_group_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS dc_pick_line_session_idx
    ON dc_pick_line (pick_session_id, sku_code);

CREATE TABLE IF NOT EXISTS dc_pick_piece (
    -- The order pieces were picked in: a piece picked again for another shop
    -- belongs to its newest pick.
    seq               bigserial   PRIMARY KEY,
    pick_line_id      uuid        NOT NULL REFERENCES dc_pick_line(id),
    pick_session_id   uuid        NOT NULL REFERENCES dc_pick_session(session_id),
    allotment_id      uuid        NOT NULL REFERENCES allotment(id),
    allotment_line_id uuid        NOT NULL REFERENCES allotment_line(id),
    destination_id    text        NOT NULL,
    sku_id            uuid        NOT NULL,
    sku_code          text        NOT NULL,
    subject_id        uuid        NOT NULL REFERENCES inventory_subject(id),
    -- The pick area place it landed in (`<picking pool>:on_hand`).
    place_id          text        NOT NULL,
    quantity          bigint      NOT NULL CHECK (quantity > 0),
    movement_group_id uuid        NOT NULL,
    picked_at         timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS dc_pick_piece_subject_idx
    ON dc_pick_piece (subject_id, place_id, seq);
CREATE INDEX IF NOT EXISTS dc_pick_piece_session_idx
    ON dc_pick_piece (pick_session_id);
CREATE INDEX IF NOT EXISTS dc_pick_piece_line_idx
    ON dc_pick_piece (allotment_line_id);

COMMENT ON TABLE dc_pick_session IS
    'A picklist walked at the cloud-run Gudang (0906): one allotment × shop, accepted once.';
COMMENT ON TABLE dc_pick_line IS
    'What a picklist asked of one SKU, split over the allotment lines it was owed on, and what each got (0906).';
COMMENT ON TABLE dc_pick_piece IS
    'The subjects a cloud-run pick moved into the Gudang''s pick area, and the shop and allotment line they were picked for (0906).';
