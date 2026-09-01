PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS node_metadata (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    node_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('DC','STORE')),
    site_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Goods enter the system when they land in the `unidentified` pool: counted,
-- verified, and not yet worked out. At that moment they have no SKU and no
-- RFID tag, so both columns are nullable and a subject carries an explicit
-- type. A UNIT is one tagged item; a QUANTITY is a count of untagged goods
-- known only by the article they were ordered against.
CREATE TABLE IF NOT EXISTS inventory_subject (
    id               TEXT PRIMARY KEY,
    subject_type     TEXT NOT NULL DEFAULT 'UNIT'
                     CHECK (subject_type IN ('UNIT','QUANTITY')),
    article_code     TEXT,
    epc              TEXT UNIQUE,
    sku_code         TEXT,
    quantity         INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
    created_at       TEXT NOT NULL,
    CHECK (
        (subject_type='UNIT' AND quantity=1 AND epc IS NOT NULL)
        OR subject_type='QUANTITY'
    )
);
CREATE INDEX IF NOT EXISTS ix_subject_article
    ON inventory_subject(article_code) WHERE article_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS movement_group (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    cause TEXT NOT NULL,
    reason TEXT NOT NULL,
    reference_type TEXT,
    reference_id TEXT,
    actor_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS movement (
    id TEXT PRIMARY KEY,
    movement_group_id TEXT NOT NULL REFERENCES movement_group(id),
    subject_id TEXT NOT NULL REFERENCES inventory_subject(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    from_place_id TEXT NOT NULL,
    to_place_id TEXT NOT NULL,
    cause TEXT NOT NULL,
    reference_type TEXT,
    reference_id TEXT,
    actor_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS movement_subject_time ON movement(subject_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS movement_places ON movement(from_place_id, to_place_id);

CREATE TRIGGER IF NOT EXISTS movement_group_reject_update
BEFORE UPDATE ON movement_group
BEGIN
    SELECT RAISE(ABORT, 'movement_group is append-only');
END;

CREATE TRIGGER IF NOT EXISTS movement_group_reject_delete
BEFORE DELETE ON movement_group
BEGIN
    SELECT RAISE(ABORT, 'movement_group is append-only');
END;

CREATE TRIGGER IF NOT EXISTS movement_reject_update
BEFORE UPDATE ON movement
BEGIN
    SELECT RAISE(ABORT, 'movement is append-only');
END;

CREATE TRIGGER IF NOT EXISTS movement_reject_delete
BEFORE DELETE ON movement
BEGIN
    SELECT RAISE(ABORT, 'movement is append-only');
END;

CREATE TABLE IF NOT EXISTS inventory_projection (
    subject_id TEXT NOT NULL REFERENCES inventory_subject(id),
    place_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (subject_id, place_id)
);

CREATE TABLE IF NOT EXISTS idempotency_response (
    idempotency_key TEXT PRIMARY KEY,
    operation TEXT NOT NULL,
    request_json TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS store_receipt (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    subject_id TEXT NOT NULL REFERENCES inventory_subject(id),
    source_dc_id TEXT,
    shipment_reference TEXT,
    movement_group_id TEXT NOT NULL REFERENCES movement_group(id),
    received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sale (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status = 'COMPLETED'),
    total_minor INTEGER NOT NULL CHECK (total_minor > 0),
    paid_minor INTEGER NOT NULL CHECK (paid_minor >= total_minor),
    change_minor INTEGER NOT NULL CHECK (change_minor >= 0),
    movement_group_id TEXT NOT NULL REFERENCES movement_group(id),
    actor_id TEXT NOT NULL,
    completed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_line (
    sale_id TEXT NOT NULL REFERENCES sale(id),
    subject_id TEXT NOT NULL REFERENCES inventory_subject(id),
    epc TEXT NOT NULL,
    sku_code TEXT NOT NULL,
    unit_price_minor INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (sale_id, subject_id)
);
