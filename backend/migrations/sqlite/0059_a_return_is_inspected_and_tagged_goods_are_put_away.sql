-- 0059: A store's return is inspected, and tagged goods are put away.
--
-- Two Gudang steps of the goods flows had no path of their own
-- (`edge::flows`):
--
-- * **Inspecting a store's return.** A return is received, blind, into that
--   store's own return pool here (`0054`); inspecting it moves each unit out
--   of that pool — good goods onto the racks, damaged goods to reject — as an
--   ordinary move, and tells head office (`inventory.return.inspected.v1`),
--   which moves the flow's Inspect stage. A unit is inspected once.
-- * **Putting tagged goods away.** Tagging already lands the units on the
--   racks in the ledger, so a putaway moves nothing more: it records that a
--   tagged job's goods were shelved and tells head office
--   (`inventory.putaway.v1`), which moves the flow's Putaway stage. Once per
--   job.
--
-- Each keeps its idempotency key and the answer it gave, so a resend is the
-- same act. Creates only, so it runs on every open.

CREATE TABLE IF NOT EXISTS return_inspection (
    inspection_id     TEXT PRIMARY KEY,
    idempotency_key   TEXT NOT NULL UNIQUE,
    delivery_id       TEXT NOT NULL,
    -- The first movement group it wrote; NULL only if it moved nothing.
    movement_group_id TEXT,
    good_units        INTEGER NOT NULL CHECK (good_units >= 0),
    damaged_units     INTEGER NOT NULL CHECK (damaged_units >= 0),
    inspected_by      TEXT NOT NULL,
    inspected_at      TEXT NOT NULL,
    result_json       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS return_inspection_by_delivery
    ON return_inspection (delivery_id);

CREATE TABLE IF NOT EXISTS return_inspection_unit (
    inspection_id     TEXT NOT NULL,
    delivery_id       TEXT NOT NULL,
    epc               TEXT NOT NULL,
    sku_code          TEXT NOT NULL,
    -- The allotment line it came back on; NULL for a tag no koli held.
    allotment_line_id TEXT,
    outcome           TEXT NOT NULL CHECK (outcome IN ('GOOD', 'DAMAGED')),
    UNIQUE (delivery_id, epc)
);

CREATE TABLE IF NOT EXISTS putaway (
    putaway_id      TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    job_id          TEXT NOT NULL UNIQUE,
    pool_id         TEXT NOT NULL,
    units           INTEGER NOT NULL CHECK (units > 0),
    put_away_by     TEXT NOT NULL,
    put_away_at     TEXT NOT NULL,
    result_json     TEXT NOT NULL
);
