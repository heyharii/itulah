-- 0097: MD answers a short pick, and a koli is read before it goes.
--
-- The Gudang server catching up with the cloud-run Gudang
-- (GUDANG-SERVER-PLAN.md step 3, `edge::dc_outbound`). Three small books, as
-- `cloud/dc` keeps them in postgres 0976, 0985 and 0996:
--
-- * MD's **Continue** on a short pick: the picker tries again. Its own table
--   rather than two columns on `dc_short_pick`, because that table is created
--   on first use (`outbound::SHORT_PICK_SCHEMA`) and SQLite has no
--   `ADD COLUMN IF NOT EXISTS`. One answer per report; the first one stands.
-- * The last RFID check of each koli: the tags read of its own units
--   (`koli_unit`, the same rows a packing box's sweep sealed), how many there
--   were and how many were missing. A later check replaces it. Verified when
--   nothing was missing.
-- * The stores Packed sent to the C5 to be read. A row ends when the store is
--   verified, or when it has no packed koli left.
--
-- `IF NOT EXISTS`: creates only, runs on every open.

CREATE TABLE IF NOT EXISTS dc_short_pick_continue (
    short_pick_id TEXT PRIMARY KEY,
    continued_by  TEXT NOT NULL CHECK (trim(continued_by) <> ''),
    continued_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dc_koli_rfid_check (
    koli_id     TEXT PRIMARY KEY REFERENCES koli(koli_id),
    -- The koli's own EPCs the reader saw, as a JSON array.
    read_epcs   TEXT NOT NULL DEFAULT '[]',
    total       INTEGER NOT NULL CHECK (total > 0),
    missing     INTEGER NOT NULL CHECK (missing >= 0 AND missing <= total),
    checked_by  TEXT NOT NULL,
    checked_at  TEXT NOT NULL,
    verified_at TEXT,
    CHECK ((missing = 0) = (verified_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS dc_koli_rfid_request (
    destination_store_id TEXT PRIMARY KEY CHECK (trim(destination_store_id) <> ''),
    requested_by         TEXT NOT NULL,
    requested_at         TEXT NOT NULL
);
