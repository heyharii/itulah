-- Phase 2/3 of POS-PERFORMANCE-PLAN.md (2026-10-07).
--
-- Two changes, both measured before being made (docs/pos-performance-round1.md):
--
-- 1. Reporting and returns group `sale_line` by `sku_code`; the column had no
--    index, so every SKU-dimension question scanned the table. The sale path
--    itself never needed it (it seeks by `(sale_id, subject_id)`), which is
--    why it stayed missing — but a returns screen and a Z-report variant both
--    pay the scan, and the scan grows with every sale the shop ever took.
--
-- 2. RFID observation batches now land in bounded chunks rather than one
--    transaction of up to 2,000 INSERTs holding the node's write lock while
--    a counter is trying to sell (Phase 3). Each chunk writes a receipt row
--    so a retry after a mid-batch crash skips the chunks that already
--    landed; the batch-level receipt in `edge_rfid_batch_receipt` is still
--    written once, when the last chunk commits, and still answers idempotent
--    replays. Sightings are evidence, never ledger quantities, so a chunk
--    boundary between them breaks nothing — but a retried batch must not
--    double-write the chunks that survived, and this table is how it knows.

CREATE INDEX IF NOT EXISTS ix_sale_line_sku_code ON sale_line(sku_code);

CREATE TABLE IF NOT EXISTS edge_rfid_batch_chunk (
    idempotency_key TEXT NOT NULL,
    chunk_index     INTEGER NOT NULL CHECK (chunk_index >= 0),
    sighting_count  INTEGER NOT NULL,
    request_digest  TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    PRIMARY KEY (idempotency_key, chunk_index)
);
