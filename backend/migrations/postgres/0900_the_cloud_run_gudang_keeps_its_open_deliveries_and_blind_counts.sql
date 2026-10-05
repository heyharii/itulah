-- Receiving at the Gudang run by the cloud (DC-CLOUD-NATIVE.md,
-- src/cloud/dc/receiving.rs).
--
-- A DC server kept two things to itself until a count was accepted: the
-- delivery documents opened on the loading bay, and the blind counts taken
-- against them. The cloud's `goods_receipt` / `goods_receipt_line` are what
-- downstream readers (payables, letters, the PO summary, flows) read, and
-- they hear of a delivery only from its first ACCEPTED line — a delivery that
-- is still being counted, or a count nobody has decided, is not something
-- Finance may see. So the bay's working state lives here, prefixed `dc_`, and
-- the accepted line is written through the same applier a DC server's fact
-- went through.

-- A delivery as the bay opened it: one lorry, one supplier.
CREATE TABLE IF NOT EXISTS dc_goods_receipt (
    receipt_id           uuid PRIMARY KEY,
    site_id              text NOT NULL,
    -- `GRN-HO-GUDANG-2026-000001`: the series is per site and year (0915).
    receipt_number       text NOT NULL UNIQUE CHECK (btrim(receipt_number) <> ''),
    supplier_id          text NOT NULL CHECK (btrim(supplier_id) <> ''),
    arrived_at           timestamptz NOT NULL,
    -- Stays OPEN for as long as a DC server's would; REJECTED when the whole
    -- lorry went back before anything on it was accepted.
    status               text NOT NULL DEFAULT 'OPEN'
                         CHECK (status IN ('OPEN', 'REJECTED')),
    opened_by            text NOT NULL,
    opened_at            timestamptz NOT NULL,
    rejected_reason      text,
    closed_by            text,
    closed_at            timestamptz,
    -- The supplier's invoice as the verifier read it off the paper. The day
    -- is kept as typed; the cloud's receipt parses it when it is recorded.
    invoice_number       text,
    invoice_date         text,
    invoice_total_minor  bigint CHECK (invoice_total_minor IS NULL OR invoice_total_minor >= 0),
    invoice_document_ref text,
    invoice_recorded_by  text,
    invoice_recorded_at  timestamptz,
    CHECK ((status = 'REJECTED') = (rejected_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_dc_goods_receipt_open
    ON dc_goods_receipt (status, arrived_at);

-- A blind count of one purchase order line, on one delivery. A document, not
-- stock: the pieces exist in the ledger only once the count is ACCEPTED.
CREATE TABLE IF NOT EXISTS dc_receiving_count (
    count_id                uuid PRIMARY KEY,
    receipt_id              uuid NOT NULL REFERENCES dc_goods_receipt (receipt_id),
    po_line_id              uuid NOT NULL REFERENCES purchase_order_line (po_line_id),
    counted_quantity        bigint NOT NULL CHECK (counted_quantity > 0),
    -- Pieces on the lorry that are not the article the line names (0829).
    wrong_quantity          bigint NOT NULL DEFAULT 0
                            CHECK (wrong_quantity >= 0 AND wrong_quantity <= counted_quantity),
    -- What the count was typed in ("9.5 KODI"), when not pieces.
    counted_unit_code       text,
    counted_unit_quantity   text,
    counted_by              text NOT NULL,
    counted_at              timestamptz NOT NULL,
    status                  text NOT NULL DEFAULT 'AWAITING_VERIFICATION'
                            CHECK (status IN ('AWAITING_VERIFICATION', 'RECOUNT_REQUESTED', 'ACCEPTED')),
    verified_by             text,
    verified_at             timestamptz,
    verifier_note           text,
    -- Set together on acceptance: the cloud's receipt line and the movement
    -- that put the pieces in the Gudang's Unidentified pool.
    receipt_line_id         uuid,
    movement_group_id       uuid,
    matched_quantity        bigint,
    excess_quantity         bigint,
    agreed_unit_price_minor bigint,
    CHECK ((status = 'ACCEPTED') = (receipt_line_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_dc_receiving_count_line
    ON dc_receiving_count (po_line_id, status);
CREATE INDEX IF NOT EXISTS ix_dc_receiving_count_receipt
    ON dc_receiving_count (receipt_id);
CREATE INDEX IF NOT EXISTS ix_dc_receiving_count_waiting
    ON dc_receiving_count (counted_at) WHERE status = 'AWAITING_VERIFICATION';

COMMENT ON TABLE dc_goods_receipt IS
    'Deliveries opened on the cloud-run Gudang''s bay (0900). The cloud''s goods_receipt is written from the first accepted count.';
COMMENT ON TABLE dc_receiving_count IS
    'Blind counts at the cloud-run Gudang (0900): nothing is stock until a count is accepted.';
