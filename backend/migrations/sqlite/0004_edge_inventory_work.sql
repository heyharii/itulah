-- Durable DC work queues populated only by exact-target signed commands.
-- Allotted is a quantity reservation, Pick is a FIFO business fact without
-- EPC identity, and Pack is the first exact EPC inventory movement.

CREATE TABLE IF NOT EXISTS dc_allotment_work (
    allotment_id          TEXT PRIMARY KEY,
    command_id            TEXT NOT NULL UNIQUE,
    allotment_number      TEXT NOT NULL,
    allotment_type        TEXT NOT NULL CHECK (allotment_type IN ('TO_STORE','RETURN_TO_DC','RETURN_TO_SUPPLIER')),
    source_site_id        TEXT NOT NULL,
    application_status    TEXT NOT NULL CHECK (application_status IN ('ACCEPTED','REJECTED')),
    fulfillment_status    TEXT NOT NULL CHECK (fulfillment_status IN ('OPEN','IN_PROGRESS','DC_COMPLETED','CANCELLED','REJECTED')),
    application_result_id TEXT NOT NULL UNIQUE,
    application_fact_seq  INTEGER NOT NULL UNIQUE CHECK (application_fact_seq >= 1),
    rejection_code        TEXT,
    rejection_reason      TEXT,
    created_by            TEXT NOT NULL,
    notes                 TEXT,
    created_at            TEXT NOT NULL,
    applied_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    CHECK (
        (application_status='ACCEPTED' AND fulfillment_status<>'REJECTED' AND rejection_code IS NULL AND rejection_reason IS NULL)
        OR
        (application_status='REJECTED' AND fulfillment_status='REJECTED' AND rejection_code IS NOT NULL AND rejection_reason IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS dc_allotment_work_line (
    allotment_line_id    TEXT PRIMARY KEY,
    allotment_id         TEXT NOT NULL REFERENCES dc_allotment_work(allotment_id),
    source_pool_id       TEXT NOT NULL,
    destination_type    TEXT NOT NULL CHECK (destination_type IN ('STORE','DC','SUPPLIER')),
    destination_id      TEXT NOT NULL,
    sku_id               TEXT NOT NULL,
    sku_code             TEXT NOT NULL,
    planned_quantity     INTEGER NOT NULL CHECK (planned_quantity > 0),
    accepted_quantity    INTEGER NOT NULL CHECK (accepted_quantity >= 0),
    picked_quantity      INTEGER NOT NULL DEFAULT 0 CHECK (picked_quantity >= 0),
    packed_quantity      INTEGER NOT NULL DEFAULT 0 CHECK (packed_quantity >= 0),
    shipment_quantity    INTEGER NOT NULL DEFAULT 0 CHECK (shipment_quantity >= 0),
    dispatched_quantity  INTEGER NOT NULL DEFAULT 0 CHECK (dispatched_quantity >= 0),
    in_transit_quantity  INTEGER NOT NULL DEFAULT 0 CHECK (in_transit_quantity >= 0),
    cancelled_quantity   INTEGER NOT NULL DEFAULT 0 CHECK (cancelled_quantity >= 0),
    updated_at            TEXT NOT NULL,
    CHECK (accepted_quantity IN (0, planned_quantity)),
    CHECK (picked_quantity + cancelled_quantity <= accepted_quantity),
    CHECK (packed_quantity <= picked_quantity),
    CHECK (shipment_quantity <= packed_quantity),
    CHECK (dispatched_quantity <= shipment_quantity),
    CHECK (in_transit_quantity <= dispatched_quantity)
);
CREATE INDEX IF NOT EXISTS ix_dc_allotment_fifo
    ON dc_allotment_work_line(source_pool_id, sku_code, allotment_id);
CREATE INDEX IF NOT EXISTS ix_dc_allotment_destination
    ON dc_allotment_work_line(destination_type, destination_id, sku_code);
CREATE INDEX IF NOT EXISTS ix_dc_allotment_status
    ON dc_allotment_work(application_status, fulfillment_status, created_at, allotment_id);

CREATE TABLE IF NOT EXISTS dc_allotment_pick_event (
    pick_id         TEXT PRIMARY KEY,
    source_site_id  TEXT NOT NULL,
    source_pool_id  TEXT NOT NULL,
    sku_code        TEXT NOT NULL,
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    actor_id        TEXT NOT NULL,
    occurred_at     TEXT NOT NULL,
    allocations_json TEXT NOT NULL,
    fact_seq        INTEGER NOT NULL UNIQUE CHECK (fact_seq >= 1)
);
CREATE TRIGGER IF NOT EXISTS dc_allotment_pick_reject_update
BEFORE UPDATE ON dc_allotment_pick_event BEGIN
    SELECT RAISE(ABORT, 'dc_allotment_pick_event is append-only');
END;
CREATE TRIGGER IF NOT EXISTS dc_allotment_pick_reject_delete
BEFORE DELETE ON dc_allotment_pick_event BEGIN
    SELECT RAISE(ABORT, 'dc_allotment_pick_event is append-only');
END;

CREATE TABLE IF NOT EXISTS koli (
    koli_id               TEXT PRIMARY KEY,
    destination_store_id  TEXT NOT NULL,
    status                TEXT NOT NULL CHECK (status IN ('PACKED','SHIPMENT','LOADED','IN_TRANSIT')),
    shipment_reference    TEXT,
    created_by            TEXT NOT NULL,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    CHECK ((status='PACKED' AND shipment_reference IS NULL) OR (status<>'PACKED' AND shipment_reference IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS koli_unit (
    koli_id             TEXT NOT NULL REFERENCES koli(koli_id),
    subject_id          TEXT NOT NULL REFERENCES inventory_subject(id),
    epc                 TEXT NOT NULL,
    sku_code            TEXT NOT NULL,
    allotment_id        TEXT NOT NULL REFERENCES dc_allotment_work(allotment_id),
    allotment_line_id   TEXT NOT NULL REFERENCES dc_allotment_work_line(allotment_line_id),
    current_stage       TEXT NOT NULL CHECK (current_stage IN ('PACKED','SHIPMENT','LOADED','IN_TRANSIT')),
    stage_rank          INTEGER NOT NULL CHECK (stage_rank BETWEEN 2 AND 5),
    packed_at           TEXT NOT NULL,
    shipment_at         TEXT,
    dispatched_at       TEXT,
    in_transit_at       TEXT,
    released_at         TEXT,
    updated_at          TEXT NOT NULL,
    PRIMARY KEY (koli_id, epc)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dc_active_package_epc
    ON koli_unit(epc) WHERE released_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_dc_active_package_subject
    ON koli_unit(subject_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_dc_package_allotment
    ON koli_unit(allotment_line_id, stage_rank, epc);

CREATE TABLE IF NOT EXISTS dc_fulfillment_progress_event (
    progress_id        TEXT PRIMARY KEY,
    koli_id            TEXT NOT NULL REFERENCES koli(koli_id),
    source_site_id     TEXT NOT NULL,
    destination_store_id TEXT NOT NULL,
    stage              TEXT NOT NULL CHECK (stage IN ('PACKED','SHIPMENT','LOADED','IN_TRANSIT')),
    shipment_reference TEXT,
    movement_group_id  TEXT NOT NULL UNIQUE REFERENCES movement_group(id),
    actor_id            TEXT NOT NULL,
    occurred_at         TEXT NOT NULL,
    units_json          TEXT NOT NULL,
    fact_seq            INTEGER NOT NULL UNIQUE CHECK (fact_seq >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_koli_stage
    ON dc_fulfillment_progress_event(koli_id, stage);
CREATE TRIGGER IF NOT EXISTS dc_fulfillment_progress_reject_update
BEFORE UPDATE ON dc_fulfillment_progress_event BEGIN
    SELECT RAISE(ABORT, 'dc_fulfillment_progress_event is append-only');
END;
CREATE TRIGGER IF NOT EXISTS dc_fulfillment_progress_reject_delete
BEFORE DELETE ON dc_fulfillment_progress_event BEGIN
    SELECT RAISE(ABORT, 'dc_fulfillment_progress_event is append-only');
END;

CREATE TABLE IF NOT EXISTS dc_allotment_cancellation (
    cancellation_id    TEXT PRIMARY KEY,
    command_id         TEXT NOT NULL UNIQUE,
    allotment_id       TEXT NOT NULL REFERENCES dc_allotment_work(allotment_id),
    outcome            TEXT NOT NULL CHECK (outcome IN ('APPLIED','PARTIALLY_APPLIED','REJECTED')),
    result_id          TEXT NOT NULL UNIQUE,
    requested_by       TEXT NOT NULL,
    reason             TEXT NOT NULL,
    requested_at       TEXT NOT NULL,
    result_reason      TEXT,
    lines_json         TEXT NOT NULL,
    result_fact_seq    INTEGER NOT NULL UNIQUE CHECK (result_fact_seq >= 1),
    applied_at         TEXT NOT NULL,
    CHECK ((outcome='APPLIED' AND result_reason IS NULL) OR (outcome<>'APPLIED' AND result_reason IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS dc_official_count_work (
    count_id          TEXT PRIMARY KEY,
    command_id        TEXT NOT NULL UNIQUE,
    site_id           TEXT NOT NULL,
    pool_id           TEXT NOT NULL,
    kind              TEXT NOT NULL CHECK (kind IN ('FULL','CYCLE','TARGETED')),
    status            TEXT NOT NULL CHECK (status IN ('ACTIVE','SUBMITTED','ADJUSTMENT_PENDING','CLOSED')),
    reason            TEXT NOT NULL,
    created_by        TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    activated_at      TEXT NOT NULL,
    scope_json        TEXT NOT NULL,
    applied_at        TEXT NOT NULL,
    submitted_at      TEXT,
    result_id         TEXT UNIQUE,
    result_fact_seq   INTEGER UNIQUE,
    adjustment_id     TEXT UNIQUE,
    adjustment_command_id TEXT UNIQUE,
    adjustment_completion_id TEXT UNIQUE,
    adjustment_fact_seq INTEGER UNIQUE,
    closed_at         TEXT
);
CREATE TABLE IF NOT EXISTS dc_official_count_expected (
    count_id          TEXT NOT NULL REFERENCES dc_official_count_work(count_id),
    subject_id        TEXT NOT NULL,
    epc               TEXT NOT NULL,
    sku_code          TEXT NOT NULL,
    expected_quantity INTEGER NOT NULL CHECK (expected_quantity > 0),
    PRIMARY KEY (count_id, subject_id),
    UNIQUE (count_id, epc)
);
CREATE TABLE IF NOT EXISTS dc_official_count_entry (
    count_id       TEXT NOT NULL REFERENCES dc_official_count_work(count_id),
    subject_id     TEXT NOT NULL,
    epc            TEXT NOT NULL,
    sku_code       TEXT NOT NULL,
    found_quantity INTEGER NOT NULL CHECK (found_quantity >= 0),
    actor_id       TEXT NOT NULL,
    recorded_at    TEXT NOT NULL,
    PRIMARY KEY (count_id, subject_id),
    UNIQUE (count_id, epc)
);
CREATE TABLE IF NOT EXISTS dc_official_count_adjustment (
    adjustment_id    TEXT PRIMARY KEY,
    command_id        TEXT NOT NULL UNIQUE,
    count_id          TEXT NOT NULL UNIQUE REFERENCES dc_official_count_work(count_id),
    result_id         TEXT NOT NULL,
    status            TEXT NOT NULL CHECK (status IN ('APPLIED','REJECTED')),
    lines_json        TEXT NOT NULL,
    movement_group_id TEXT UNIQUE REFERENCES movement_group(id),
    actor_id           TEXT NOT NULL,
    reason             TEXT,
    applied_at         TEXT NOT NULL,
    completion_id      TEXT NOT NULL UNIQUE,
    fact_seq           INTEGER NOT NULL UNIQUE CHECK (fact_seq >= 1),
    CHECK ((status='APPLIED') OR (status='REJECTED' AND reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_dc_count_work_status
    ON dc_official_count_work(status, activated_at);
