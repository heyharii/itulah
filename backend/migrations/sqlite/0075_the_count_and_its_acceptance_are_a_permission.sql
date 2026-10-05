-- 0075: Who counts and who accepts is a permission, not two names.
--
-- The owner (2026-10-04): the person who raised a purchase order may also
-- count its deliveries, and one person may count and accept. Which of the two
-- acts a caller may perform is decided by their role and permission, and by
-- nothing else — so the table no longer refuses its own acceptance:
-- 0005's `CHECK (verified_by IS NULL OR verified_by <> counted_by)` is gone.
-- Both names are still required: `counted_by` NOT NULL stays, and accepting
-- still writes `verified_by`. SQLite cannot drop a CHECK, so the table is
-- rebuilt and the rows carried over — the 0036 pattern.

PRAGMA foreign_keys=OFF;

CREATE TABLE receiving_count_new (
    count_id         TEXT PRIMARY KEY,
    receipt_id       TEXT NOT NULL REFERENCES goods_receipt(receipt_id),
    po_line_id       TEXT NOT NULL REFERENCES purchase_order_line(po_line_id),
    counted_quantity INTEGER NOT NULL CHECK (counted_quantity > 0),
    counted_by       TEXT NOT NULL,
    counted_at       TEXT NOT NULL,
    status           TEXT NOT NULL
                     CHECK (status IN ('AWAITING_VERIFICATION','ACCEPTED','RECOUNT_REQUESTED')),
    verified_by      TEXT,
    verified_at      TEXT,
    verifier_note    TEXT,
    movement_group_id TEXT,
    -- The receipt line this count became, once accepted. It is what a setup
    -- session at head office will later be opened against.
    receipt_line_id  TEXT UNIQUE,
    -- 0036: what the order still had room for, and what came beyond it, with
    -- the price that applied at acceptance.
    matched_quantity INTEGER,
    excess_quantity INTEGER,
    agreed_unit_price_minor INTEGER,
    -- 0048: a count typed in a unit other than pieces.
    counted_unit_code TEXT,
    counted_unit_quantity TEXT,
    CHECK ((status = 'ACCEPTED') = (receipt_line_id IS NOT NULL))
);

INSERT INTO receiving_count_new
    (count_id, receipt_id, po_line_id, counted_quantity, counted_by, counted_at,
     status, verified_by, verified_at, verifier_note, movement_group_id, receipt_line_id,
     matched_quantity, excess_quantity, agreed_unit_price_minor,
     counted_unit_code, counted_unit_quantity)
SELECT
    count_id, receipt_id, po_line_id, counted_quantity, counted_by, counted_at,
    status, verified_by, verified_at, verifier_note, movement_group_id, receipt_line_id,
    matched_quantity, excess_quantity, agreed_unit_price_minor,
    counted_unit_code, counted_unit_quantity
  FROM receiving_count;

DROP TABLE receiving_count;
ALTER TABLE receiving_count_new RENAME TO receiving_count;

CREATE INDEX IF NOT EXISTS ix_receiving_count_line ON receiving_count(po_line_id, status);
CREATE INDEX IF NOT EXISTS ix_receiving_count_receipt ON receiving_count(receipt_id);

PRAGMA foreign_keys=ON;
