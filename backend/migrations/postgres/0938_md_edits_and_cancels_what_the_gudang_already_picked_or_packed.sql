-- MD may edit or cancel an allotment at any stage before it is sent, and the
-- Gudang may take its own work back (owner, 9 Oct 2026;
-- docs/research/2026-10-09-outbound-cancel-edit-build.md).
--
-- The counters of allotment-v1 stay as they are: MD can only give up what is
-- in To Pack (`closed_short`, ALT-INV-04), and a carton is opened again
-- through `unpacked_quantity`. What MD says about pieces already in a carton
-- is not a counter, it is an intent the Gudang has still to carry out, so it
-- gets a column of its own: `takeout_pending_quantity`. It falls (and
-- `closed_short_quantity` rises by the same) when the pieces are unpacked.
--
--   allotment_line.takeout_pending_quantity  pieces MD took out that still sit
--                                            in an unsent carton
--   allotment_amendment                      every edit / cancel MD made, the
--                                            history behind "300 → 250"
--   dc_koli.voided_at                        a carton emptied by a move back
--   dc_short_pick                            a picker who could not finish a
--                                            line, and why (the card's flag)

ALTER TABLE allotment_line
    ADD COLUMN IF NOT EXISTS takeout_pending_quantity bigint NOT NULL DEFAULT 0
        CHECK (takeout_pending_quantity >= 0);

CREATE TABLE IF NOT EXISTS allotment_amendment (
    id              uuid        PRIMARY KEY,
    allotment_id    uuid        NOT NULL REFERENCES allotment(id),
    allotment_line_id uuid      NOT NULL REFERENCES allotment_line(id),
    kind            text        NOT NULL CHECK (kind IN ('REDUCE', 'ADD', 'CANCEL')),
    -- What MD wants the line to be, net, before and after this act.
    target_before   bigint      NOT NULL CHECK (target_before >= 0),
    target_after    bigint      NOT NULL CHECK (target_after >= 0),
    -- Taken from demand that was not packed yet: closed short at once.
    released        bigint      NOT NULL DEFAULT 0 CHECK (released >= 0),
    -- Taken from pieces already in cartons: `takeout_pending_quantity` until
    -- the Gudang unpacks them.
    owed            bigint      NOT NULL DEFAULT 0 CHECK (owed >= 0),
    reason          text,
    actor_id        text        NOT NULL CHECK (btrim(actor_id) <> ''),
    created_at      timestamptz NOT NULL,
    idempotency_key text
);
CREATE INDEX IF NOT EXISTS allotment_amendment_allotment_idx
    ON allotment_amendment (allotment_id, created_at);
CREATE INDEX IF NOT EXISTS allotment_amendment_line_idx
    ON allotment_amendment (allotment_line_id);

ALTER TABLE dc_koli
    ADD COLUMN IF NOT EXISTS voided_at timestamptz;

CREATE TABLE IF NOT EXISTS dc_short_pick (
    id              uuid        PRIMARY KEY,
    allotment_id    uuid        NOT NULL REFERENCES allotment(id),
    destination_id  text        NOT NULL,
    sku_code        text        NOT NULL,
    -- How many the picker could not find on this report.
    pieces          bigint      NOT NULL CHECK (pieces > 0),
    reason          text        NOT NULL CHECK (reason IN (
                        'NOT_CONFIRMED', 'NOT_FOUND', 'DAMAGED',
                        'LABEL_OR_EQUIPMENT', 'OTHER')),
    note            text,
    pick_session_id uuid,
    -- The targeted count a stock-related reason raised, if any.
    count_id        text,
    reported_by     text        NOT NULL CHECK (btrim(reported_by) <> ''),
    reported_at     timestamptz NOT NULL,
    idempotency_key text        UNIQUE
);
CREATE INDEX IF NOT EXISTS dc_short_pick_open_idx
    ON dc_short_pick (allotment_id, destination_id, sku_code);
