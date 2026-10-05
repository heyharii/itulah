-- A received return is inspected at the Gudang the cloud runs
-- (DC-CLOUD-NATIVE.md, src/cloud/dc/returns.rs).
--
-- The goods flow's Inspect stage: what stands in a shop's return pool goes to
-- the racks or, damaged, to reject. A DC server kept its inspections in
-- SQLite (`return_inspection`, `return_inspection_unit`); these are the same
-- two records for the cloud-run Gudang. The flow hears of each one through
-- the same applier the server's fact reached (`edge_goods_step`, INSPECTED).

CREATE TABLE IF NOT EXISTS dc_return_inspection (
    inspection_id     uuid PRIMARY KEY,
    idempotency_key   text NOT NULL UNIQUE,
    delivery_id       text NOT NULL REFERENCES dc_inbound_receipt (delivery_id),
    movement_group_id uuid,
    good_units        bigint NOT NULL CHECK (good_units >= 0),
    damaged_units     bigint NOT NULL CHECK (damaged_units >= 0),
    inspected_by      text NOT NULL CHECK (btrim(inspected_by) <> ''),
    inspected_at      timestamptz NOT NULL,
    -- The answer, so the same key twice is the same inspection.
    result            jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_dc_return_inspection_delivery
    ON dc_return_inspection (delivery_id);

-- A piece is inspected once.
CREATE TABLE IF NOT EXISTS dc_return_inspection_unit (
    delivery_id       text NOT NULL REFERENCES dc_inbound_receipt (delivery_id),
    epc               text NOT NULL,
    inspection_id     uuid NOT NULL REFERENCES dc_return_inspection (inspection_id),
    sku_code          text NOT NULL,
    allotment_line_id uuid,
    outcome           text NOT NULL CHECK (outcome IN ('GOOD', 'DAMAGED')),
    PRIMARY KEY (delivery_id, epc)
);

COMMENT ON TABLE dc_return_inspection IS
    'An inspection of a shop''s return at the cloud-run Gudang (0913): good to the racks, damaged to reject.';
COMMENT ON TABLE dc_return_inspection_unit IS
    'Each piece an inspection covered (0913); a piece is inspected once.';
