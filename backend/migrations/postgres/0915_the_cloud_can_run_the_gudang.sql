-- The Gudang run by the cloud itself (DC-CLOUD-NATIVE.md, src/cloud/dc).
--
-- When INVENTORY_DC_HOSTING=cloud the warehouse's work is done against the
-- cloud's own tables. Two things it needs that a DC server kept for itself:

-- 1. A record stream. The cloud's tables key what a DC server reported by
--    (origin, generation, seq); the cloud-run Gudang writes the same rows
--    through the same appliers under the pseudo-origin `dc-cloud`, and takes
--    its seq from here. Never reused.
CREATE SEQUENCE IF NOT EXISTS cloud_dc_record_seq;

-- 2. Document numbers: koli, surat jalan, dispatch, goods receipt. Per site,
--    per series, per year; taken in the transaction that writes the document.
CREATE TABLE IF NOT EXISTS dc_number_series (
    site_id     text   NOT NULL,
    series      text   NOT NULL CHECK (btrim(series) <> ''),
    year        integer NOT NULL CHECK (year BETWEEN 2000 AND 2999),
    last_number bigint NOT NULL CHECK (last_number >= 1),
    PRIMARY KEY (site_id, series, year)
);

COMMENT ON TABLE dc_number_series IS
    'Document number series of the cloud-run Gudang (0915): koli, surat jalan, dispatch, receipt numbers per site and year.';
