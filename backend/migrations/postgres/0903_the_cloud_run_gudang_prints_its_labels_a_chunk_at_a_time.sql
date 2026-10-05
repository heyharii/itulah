-- Label printing at the Gudang run by the cloud (DC-CLOUD-NATIVE.md,
-- src/cloud/dc/tagging.rs).
--
-- The same print queue a DC server keeps in its SQLite (`print_session`,
-- `print_item`, edge/printing.rs), here in the cloud's own database: one run
-- per tagging job, one row per label, claimed a chunk at a time and handed to
-- the warehouse printer through the print bridge. Counters and status are
-- recomputed from the items, never kept beside them.
--
-- The words on a label are snapshotted when the run is opened: a reprint six
-- weeks later must reproduce the tag that was printed, not today's catalogue.

CREATE TABLE IF NOT EXISTS dc_print_session (
    session_id      uuid PRIMARY KEY,
    -- One run per job: a second run would be two tags carrying one identity.
    -- Reprints happen inside this run.
    job_id          uuid NOT NULL UNIQUE REFERENCES tagging_job (job_id),
    -- `bridge:<name>` for a printer in the warehouse, reached through the
    -- print bridge; anything else is opened directly.
    printer_host    text NOT NULL CHECK (btrim(printer_host) <> ''),
    printer_port    bigint NOT NULL CHECK (printer_port BETWEEN 1 AND 65535),
    lang            text NOT NULL DEFAULT 'ZPL' CHECK (lang IN ('ZPL', 'TSPL')),
    label_width_mm  bigint NOT NULL CHECK (label_width_mm BETWEEN 10 AND 200),
    label_height_mm bigint NOT NULL CHECK (label_height_mm BETWEEN 10 AND 200),
    label_offset_mm bigint NOT NULL DEFAULT 0,
    chunk_size      bigint NOT NULL CHECK (chunk_size BETWEEN 1 AND 1000),
    -- Absent leaves the printer on whatever it was last told.
    darkness        bigint CHECK (darkness IS NULL OR darkness BETWEEN 0 AND 30),
    speed_ips       bigint CHECK (speed_ips IS NULL OR speed_ips BETWEEN 1 AND 12),
    total_items     bigint NOT NULL CHECK (total_items > 0),
    printed_count   bigint NOT NULL DEFAULT 0 CHECK (printed_count >= 0),
    failed_count    bigint NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    status          text NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'PRINTING', 'COMPLETED', 'PARTIAL', 'CANCELLED')),
    created_by      text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    closed_at       timestamptz,
    CHECK (printed_count + failed_count <= total_items)
);

CREATE TABLE IF NOT EXISTS dc_print_item (
    session_id      uuid NOT NULL REFERENCES dc_print_session (session_id) ON DELETE CASCADE,
    -- Position in the run, from 1, stable: "it stopped at 340" means the same
    -- label every time anybody says it.
    seq             bigint NOT NULL CHECK (seq > 0),
    -- One label per EPC, across every run.
    epc             text NOT NULL UNIQUE CHECK (btrim(epc) <> ''),
    sku_code        text NOT NULL,
    article_name    text NOT NULL,
    colour_label    text,
    size_label      text,
    barcode_payload text NOT NULL,
    price_minor     bigint NOT NULL CHECK (price_minor >= 0),
    status          text NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'CLAIMED', 'PRINTED', 'FAILED')),
    -- Counted where the label leaves for the printer, so a label nobody
    -- heard back about still shows what it cost.
    attempts        bigint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    claimed_at      timestamptz,
    printed_at      timestamptz,
    last_error      text,
    PRIMARY KEY (session_id, seq)
);

CREATE INDEX IF NOT EXISTS ix_dc_print_item_waiting
    ON dc_print_item (session_id, seq)
    WHERE status IN ('PENDING', 'CLAIMED', 'FAILED');

COMMENT ON TABLE dc_print_session IS
    'A label print run of the cloud-run Gudang (0903): one per tagging job, sent through the print bridge.';
COMMENT ON TABLE dc_print_item IS
    'One label of a print run (0903), its words snapshotted when the run was opened.';
