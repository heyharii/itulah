-- Master data that the centre owns and the edge only ever receives.
--
-- Until now an edge invented its own catalogue: `insert_subject` took a
-- sku_code and a price from whoever scanned the item in. With one shop that
-- looks like flexibility; with thirty it means "SKU-123" is a different
-- product in every shop and no report can be trusted. This table is the
-- centre's copy, delivered down the command lane, and the edge never writes
-- to it except by applying a snapshot.

CREATE TABLE IF NOT EXISTS catalog_item (
    sku_code         TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    uom              TEXT NOT NULL,
    barcode          TEXT,
    tax_category     TEXT NOT NULL,
    active           INTEGER NOT NULL CHECK (active IN (0, 1)),
    -- Which snapshot generation put this row here. A row from an older
    -- generation than the resident one is stale by definition.
    generation       INTEGER NOT NULL,
    updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_catalog_barcode ON catalog_item(barcode) WHERE barcode IS NOT NULL;

-- The catalogue generation this edge is currently honouring. One row.
CREATE TABLE IF NOT EXISTS catalog_state (
    singleton    INTEGER PRIMARY KEY CHECK (singleton = 1),
    snapshot_id  TEXT NOT NULL,
    generation   INTEGER NOT NULL CHECK (generation >= 1),
    item_count   INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    activated_at TEXT NOT NULL
);

-- Chunks of a snapshot that is still arriving.
--
-- A catalogue is too big for one command payload, so it is delivered as an
-- ordered run of chunks. Nothing is visible to the till until the last chunk
-- lands and the hash over the whole set matches what the centre said it would
-- be — a half-applied catalogue is worse than none, because it prices some
-- items and silently omits others.
--
-- Chunks need no ordering logic of their own: they ride the command stream,
-- which is already contiguous and gap-free. That is the whole reason this is
-- simpler here than in the systems that deliver snapshots out of band.
CREATE TABLE IF NOT EXISTS catalog_staging (
    snapshot_id TEXT NOT NULL,
    generation  INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    chunk_count INTEGER NOT NULL CHECK (chunk_count >= 1),
    items_json  TEXT NOT NULL,
    received_at TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, chunk_index)
);
