-- 0008: Label printing — an edge-owned queue, born from a tagging job.
--
-- Printing never goes cloud → printer. The centre works out WHAT to print and
-- sends it down as a tagging job; the DC works out WHEN, because the DC is the
-- only party on the same LAN as the printer. A cloud that dispatched labels
-- directly would be a cloud that cannot print when the line is down, which is
-- exactly the hour a warehouse most needs its labels.
--
-- print_session = one print run, bound to one tagging job and one printer.
-- print_item    = one label. One row per EPC, because a tag is written once and
--                 a failed tag must be reprintable on its own — reprinting a
--                 whole run to recover four labels burns four hundred tags.

CREATE TABLE IF NOT EXISTS print_session (
    session_id     TEXT PRIMARY KEY,
    -- The tagging job this run prints. UNIQUE: a job that has been printed
    -- twice has produced two tags carrying one identity, and the second one is
    -- indistinguishable from a stolen garment on the sales floor.
    job_id         TEXT NOT NULL UNIQUE REFERENCES tagging_job(job_id) ON DELETE CASCADE,

    -- Where the labels go. Held on the session rather than looked up at
    -- dispatch time: a run that started on one printer must finish on it, or
    -- half the batch ends up in another room.
    printer_host   TEXT NOT NULL CHECK (trim(printer_host) <> ''),
    printer_port   INTEGER NOT NULL DEFAULT 9100 CHECK (printer_port BETWEEN 1 AND 65535),
    -- Only ZPL today. The column exists because the field already runs TSPL
    -- printers, and a schema that cannot name the second language forces a
    -- migration on the day one arrives.
    lang           TEXT NOT NULL DEFAULT 'ZPL' CHECK (lang IN ('ZPL', 'TSPL')),

    -- Label geometry in millimetres, resolved to dots by the renderer. Stored
    -- per session: tag stock changes between runs and the ZPL must follow.
    label_width_mm  INTEGER NOT NULL DEFAULT 58 CHECK (label_width_mm > 0),
    label_height_mm INTEGER NOT NULL DEFAULT 40 CHECK (label_height_mm > 0),

    -- How many labels one claim hands out. A printer that is handed 4,000
    -- labels in one socket write holds them all in a buffer nobody can see
    -- into; chunking keeps the queue's count and the printer's reality close.
    chunk_size     INTEGER NOT NULL DEFAULT 100 CHECK (chunk_size BETWEEN 1 AND 1000),

    total_items    INTEGER NOT NULL CHECK (total_items > 0),
    printed_count  INTEGER NOT NULL DEFAULT 0 CHECK (printed_count >= 0),
    failed_count   INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),

    status         TEXT NOT NULL DEFAULT 'OPEN'
                   CHECK (status IN ('OPEN', 'PRINTING', 'COMPLETED', 'PARTIAL', 'CANCELLED')),
    created_by     TEXT NOT NULL CHECK (trim(created_by) <> ''),
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    closed_at      TEXT,

    -- The counters are a projection of print_item and must stay inside it.
    CHECK (printed_count + failed_count <= total_items),
    -- A run is only finished when every label is accounted for, and only
    -- COMPLETED when none of them failed.
    CHECK ((status IN ('COMPLETED', 'PARTIAL')) = (closed_at IS NOT NULL)),
    CHECK (status <> 'COMPLETED' OR (printed_count = total_items AND failed_count = 0)),
    CHECK (status <> 'PARTIAL' OR failed_count > 0)
);

CREATE TABLE IF NOT EXISTS print_item (
    -- The EPC is the identity of the label, so it is the identity of the row.
    -- Two rows sharing one EPC would be two tags nobody could tell apart, and
    -- by then both are already stuck to garments.
    epc            TEXT PRIMARY KEY,
    session_id     TEXT NOT NULL REFERENCES print_session(session_id) ON DELETE CASCADE,
    -- 1-based position in the run, so an operator can say "it stopped at 340"
    -- and the queue can find the same place.
    seq            INTEGER NOT NULL CHECK (seq > 0),

    -- What goes on the label, snapshotted at queue time rather than joined at
    -- print time. A reprint six weeks later must reproduce the label that was
    -- printed, not the one today's catalogue would produce — the garment on the
    -- rail did not get renamed when the master data did.
    sku_code        TEXT NOT NULL,
    article_name    TEXT NOT NULL,
    barcode_payload TEXT NOT NULL,
    price_minor     INTEGER NOT NULL CHECK (price_minor >= 0),

    status         TEXT NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'CLAIMED', 'PRINTED', 'FAILED')),
    -- Counted rather than inferred: an operator deciding whether a printer is
    -- misbehaving needs to see that this label has already been tried nine
    -- times, which a bare FAILED never says.
    attempts       INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error     TEXT,
    claimed_at     TEXT,
    printed_at     TEXT,

    UNIQUE (session_id, seq),
    CHECK ((status = 'PRINTED') = (printed_at IS NOT NULL)),
    CHECK (status <> 'FAILED' OR (attempts > 0 AND trim(last_error) <> '')),
    -- Nothing is printed or failed without having been attempted.
    CHECK (status NOT IN ('PRINTED', 'FAILED') OR attempts > 0)
);

CREATE INDEX IF NOT EXISTS ix_print_item_queue
    ON print_item (session_id, status, seq);

CREATE INDEX IF NOT EXISTS ix_print_session_open
    ON print_session (status) WHERE status IN ('OPEN', 'PRINTING');
