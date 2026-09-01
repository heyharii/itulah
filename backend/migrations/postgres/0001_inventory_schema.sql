CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE article (
    id UUID PRIMARY KEY,
    article_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sku (
    id UUID PRIMARY KEY,
    article_id UUID NOT NULL REFERENCES article(id),
    sku_code TEXT NOT NULL UNIQUE,
    color TEXT,
    size TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE site (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('DC', 'STORE')),
    edge_node_id TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE operational_pool (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES site(id),
    group_code TEXT NOT NULL CHECK (group_code IN ('PENDING', 'WAREHOUSE', 'OUTBOUND', 'REJECT', 'STORE_INVENTORY')),
    pool_code TEXT NOT NULL,
    label TEXT NOT NULL,
    store_origin_site_id TEXT REFERENCES site(id),
    display_order INTEGER NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK ((store_origin_site_id IS NULL) OR (group_code = 'REJECT' AND site_id = 'dc'))
);

CREATE TABLE inventory_place (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('OPERATIONAL', 'EXTERNAL', 'SYSTEM')),
    pool_id TEXT REFERENCES operational_pool(id),
    state TEXT CHECK (state IN ('ON_HAND', 'MISSING')),
    code TEXT,
    is_company BOOLEAN NOT NULL,
    is_saleable BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (
        (kind = 'OPERATIONAL' AND pool_id IS NOT NULL AND state IS NOT NULL AND code IS NULL AND is_company)
        OR (kind IN ('EXTERNAL', 'SYSTEM') AND pool_id IS NULL AND state IS NULL AND code IS NOT NULL AND NOT is_company)
    ),
    CHECK (NOT is_saleable OR (kind = 'OPERATIONAL' AND state = 'ON_HAND'))
);

CREATE TABLE inventory_subject (
    id UUID PRIMARY KEY,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('UNIT', 'QUANTITY')),
    sku_id UUID REFERENCES sku(id),
    epc TEXT UNIQUE,
    barcode TEXT,
    quantity BIGINT NOT NULL CHECK (quantity > 0),
    uom TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((subject_type = 'UNIT' AND quantity = 1 AND epc IS NOT NULL) OR subject_type = 'QUANTITY')
);

CREATE TABLE command_deduplication (
    idempotency_key TEXT PRIMARY KEY,
    command_type TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    response_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE movement_group (
    id UUID PRIMARY KEY,
    cause TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
    reference_type TEXT,
    reference_id TEXT,
    actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_digest TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE movement (
    fact_sequence BIGSERIAL UNIQUE NOT NULL,
    movement_id UUID PRIMARY KEY,
    movement_group_id UUID NOT NULL REFERENCES movement_group(id),
    subject_id UUID NOT NULL REFERENCES inventory_subject(id),
    quantity BIGINT NOT NULL CHECK (quantity > 0),
    from_place_id TEXT NOT NULL REFERENCES inventory_place(id),
    to_place_id TEXT NOT NULL REFERENCES inventory_place(id),
    cause TEXT NOT NULL,
    reference_type TEXT,
    reference_id TEXT,
    idempotency_key TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (from_place_id <> to_place_id),
    UNIQUE (movement_group_id, subject_id, from_place_id, to_place_id)
);
CREATE INDEX movement_subject_time_idx ON movement(subject_id, occurred_at, fact_sequence);
CREATE INDEX movement_places_time_idx ON movement(from_place_id, to_place_id, occurred_at);
CREATE INDEX movement_group_idx ON movement(movement_group_id);

CREATE TABLE inventory_projection (
    subject_id UUID NOT NULL REFERENCES inventory_subject(id),
    place_id TEXT NOT NULL REFERENCES inventory_place(id),
    quantity BIGINT NOT NULL CHECK (quantity > 0),
    last_fact_sequence BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (subject_id, place_id)
);
CREATE INDEX inventory_projection_place_idx ON inventory_projection(place_id);

CREATE TABLE observation_sighting (
    observation_id UUID PRIMARY KEY,
    subject_id UUID REFERENCES inventory_subject(id),
    epc TEXT NOT NULL,
    site_id TEXT NOT NULL REFERENCES site(id),
    pool_id TEXT NOT NULL REFERENCES operational_pool(id),
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    device_id TEXT NOT NULL,
    reader_session_id TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method = 'RFID_HANDHELD'),
    read_count BIGINT NOT NULL CHECK (read_count > 0),
    best_rssi REAL,
    antenna TEXT,
    CHECK (last_seen_at >= first_seen_at)
);
CREATE INDEX observation_burst_idx ON observation_sighting(device_id, reader_session_id, pool_id, epc, last_seen_at DESC);
CREATE INDEX observation_recent_pool_idx ON observation_sighting(pool_id, last_seen_at DESC);
CREATE INDEX observation_subject_idx ON observation_sighting(subject_id, last_seen_at DESC);

CREATE TABLE official_count (
    id UUID PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES site(id),
    pool_id TEXT NOT NULL REFERENCES operational_pool(id),
    kind TEXT NOT NULL CHECK (kind IN ('FULL', 'CYCLE', 'TARGETED')),
    status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'REVIEW', 'CLOSED')),
    scope_json JSONB NOT NULL,
    reason TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    approval_movement_group_id UUID REFERENCES movement_group(id)
);
CREATE INDEX official_count_pool_idx ON official_count(pool_id, created_at DESC);

CREATE TABLE count_snapshot (
    count_id UUID NOT NULL REFERENCES official_count(id),
    subject_id UUID NOT NULL REFERENCES inventory_subject(id),
    expected_quantity BIGINT NOT NULL CHECK (expected_quantity > 0),
    expected_place_id TEXT NOT NULL REFERENCES inventory_place(id),
    PRIMARY KEY (count_id, subject_id)
);

CREATE TABLE count_entry (
    count_id UUID NOT NULL REFERENCES official_count(id),
    subject_id UUID NOT NULL REFERENCES inventory_subject(id),
    found_quantity BIGINT NOT NULL CHECK (found_quantity >= 0),
    recorded_by TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (count_id, subject_id)
);

CREATE TABLE replay_run (
    id UUID PRIMARY KEY,
    scope_json JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('MATCH', 'DIFFERENCE')),
    ledger_fact_count BIGINT NOT NULL,
    difference_count BIGINT NOT NULL,
    result_json JSONB NOT NULL,
    actor_id TEXT NOT NULL,
    ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE repost_run (
    id UUID PRIMARY KEY,
    scope_json JSONB NOT NULL,
    ledger_fact_count_before BIGINT NOT NULL,
    ledger_fact_count_after BIGINT NOT NULL,
    projection_rows BIGINT NOT NULL,
    actor_id TEXT NOT NULL,
    ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ledger_fact_count_before = ledger_fact_count_after)
);

CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'inventory ledger is append-only: % is forbidden', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER movement_append_only
BEFORE UPDATE OR DELETE ON movement
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER movement_group_append_only
BEFORE UPDATE OR DELETE ON movement_group
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

COMMENT ON TABLE movement IS 'Authoritative immutable double-entry inventory movement facts. Projection is never authoritative.';
COMMENT ON TABLE inventory_projection IS 'Disposable current-state projection rebuilt only from movement facts.';
COMMENT ON TABLE observation_sighting IS 'RFID evidence stream; never changes ledger inventory.';
COMMENT ON COLUMN operational_pool.store_origin_site_id IS 'Preserves originating store for DC Store Reject inventory.';
