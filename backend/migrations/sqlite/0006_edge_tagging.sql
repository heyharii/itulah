-- Tagging work as the DC receives it: labels to print, tags to attach.
--
-- # The edge never encodes
--
-- Every EPC below arrived as a finished string from the centre. Nothing here
-- computes one, and nothing here may. The encoding rule lives in exactly one
-- place in this system, and the reason is not tidiness: a second copy that
-- drifts by one bit writes tags that cannot be read back, and the symptom on
-- the warehouse floor is not an error message — it is stock that scans as
-- missing. Storing the strings verbatim is what keeps the rule singular.
--
-- # Why one row per unit here, when the centre stores a range
--
-- The centre needs to know which serials it ISSUED, and a range says that
-- perfectly. The DC needs something different: a list to print, and a tag to
-- turn into a tracked unit. It works through the units one at a time, so it
-- holds them one at a time.

CREATE TABLE IF NOT EXISTS tagging_job (
    job_id         TEXT PRIMARY KEY,
    session_id     TEXT NOT NULL,
    article_code   TEXT NOT NULL,
    article_name   TEXT NOT NULL,
    image_url      TEXT,
    total_quantity INTEGER NOT NULL CHECK (total_quantity > 0),
    status         TEXT NOT NULL DEFAULT 'OPEN'
                   CHECK (status IN ('OPEN', 'TAGGED')),
    issued_at      TEXT NOT NULL,
    received_at    TEXT NOT NULL,
    confirmed_by   TEXT,
    confirmed_at   TEXT,
    -- The movement that turned this job's goods into tracked units.
    movement_group_id TEXT,
    CHECK ((status = 'TAGGED') = (confirmed_at IS NOT NULL)),
    CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_tagging_job_status ON tagging_job(status, issued_at);

CREATE TABLE IF NOT EXISTS tagging_job_line (
    job_id           TEXT NOT NULL REFERENCES tagging_job(job_id) ON DELETE CASCADE,
    sku_code         TEXT NOT NULL,
    colour_digit     TEXT NOT NULL,
    colour_label     TEXT NOT NULL,
    size_code        TEXT NOT NULL,
    size_label       TEXT NOT NULL,
    quantity         INTEGER NOT NULL CHECK (quantity > 0),
    qr_payload       TEXT NOT NULL,
    barcode_payload  TEXT NOT NULL,
    base_price_minor INTEGER NOT NULL CHECK (base_price_minor >= 0),
    -- The untagged QUANTITY these units will be drawn from. Filled when the
    -- job lands and the goods move out of `unidentified`.
    subject_id       TEXT,
    PRIMARY KEY (job_id, sku_code)
);

-- One row per physical label. `epc` is globally unique because an EPC
-- identifies one garment: two rows sharing one would be two objects the
-- system cannot tell apart, and by then the tags are already on the clothes.
CREATE TABLE IF NOT EXISTS tagging_job_epc (
    epc        TEXT PRIMARY KEY,
    job_id     TEXT NOT NULL REFERENCES tagging_job(job_id) ON DELETE CASCADE,
    sku_code   TEXT NOT NULL,
    -- Set when the job is confirmed: which tracked unit this tag became.
    subject_id TEXT
);
CREATE INDEX IF NOT EXISTS ix_tagging_job_epc_job ON tagging_job_epc(job_id, sku_code);
