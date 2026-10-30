-- 0098: the bay takes a count back, a count of nothing is a count, and a line
-- may be counted variant by variant — the cloud-run Gudang's 0950 and 0963 and
-- the owner's 2026-10-05 ruling, on the Gudang server (GUDANG-SERVER-PLAN.md
-- step 3).
--
-- * A count of 0 says "this line did not come". It puts nothing in the
--   Gudang, and once accepted it has no receipt line: nothing arrived, so
--   there is nothing for a setup session to be opened against. 0005's
--   `counted_quantity > 0` and 0075's "accepted exactly when it has a receipt
--   line" become "accepted with a receipt line, unless nothing was counted".
-- * RECALLED: the bay took its own count back before anybody decided on it.
--   The count stays in the order's history with who, when and why; its line
--   is owed a count again.
-- * `receiving_count_variant`: a count's breakdown by colour × size. The rows
--   add up to the count's matching pieces (`counted − wrong`); the receipt
--   stays per line.
-- * The surat jalan of a purchase return (cloud 0917, 0970): the Gudang's
--   person in charge, when it was generated and by whom, and a few words per
--   item.
--
-- SQLite cannot change a CHECK, so `receiving_count` is rebuilt and its rows
-- carried over (the 0075 pattern), inside one transaction with foreign keys
-- off (0009's pattern): `purchase_price_amendment` points at it. Applied once,
-- while `receiving_count.recalled_at` is absent (`edge::dc_receiving`).

PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;

CREATE TABLE receiving_count_new (
    count_id         TEXT PRIMARY KEY,
    receipt_id       TEXT NOT NULL REFERENCES goods_receipt(receipt_id),
    po_line_id       TEXT NOT NULL REFERENCES purchase_order_line(po_line_id),
    counted_quantity INTEGER NOT NULL CHECK (counted_quantity >= 0),
    counted_by       TEXT NOT NULL,
    counted_at       TEXT NOT NULL,
    status           TEXT NOT NULL
                     CHECK (status IN ('AWAITING_VERIFICATION','ACCEPTED','RECOUNT_REQUESTED',
                                       'RECALLED')),
    verified_by      TEXT,
    verified_at      TEXT,
    verifier_note    TEXT,
    movement_group_id TEXT,
    receipt_line_id  TEXT UNIQUE,
    matched_quantity INTEGER,
    excess_quantity INTEGER,
    agreed_unit_price_minor INTEGER,
    counted_unit_code TEXT,
    counted_unit_quantity TEXT,
    wrong_quantity   INTEGER NOT NULL DEFAULT 0
                     CHECK (wrong_quantity >= 0 AND wrong_quantity <= counted_quantity),
    -- The bay took it back (0950).
    recalled_by      TEXT,
    recalled_at      TEXT,
    recall_reason    TEXT,
    -- A receipt line only on an acceptance, and every acceptance has one
    -- unless nothing arrived.
    CHECK (receipt_line_id IS NULL OR status = 'ACCEPTED'),
    CHECK (status <> 'ACCEPTED' OR receipt_line_id IS NOT NULL OR counted_quantity = 0),
    CHECK ((status = 'RECALLED') = (recalled_at IS NOT NULL)),
    CHECK ((recalled_at IS NULL) = (recalled_by IS NULL))
);

INSERT INTO receiving_count_new
    (count_id, receipt_id, po_line_id, counted_quantity, counted_by, counted_at,
     status, verified_by, verified_at, verifier_note, movement_group_id, receipt_line_id,
     matched_quantity, excess_quantity, agreed_unit_price_minor,
     counted_unit_code, counted_unit_quantity, wrong_quantity)
SELECT
    count_id, receipt_id, po_line_id, counted_quantity, counted_by, counted_at,
    status, verified_by, verified_at, verifier_note, movement_group_id, receipt_line_id,
    matched_quantity, excess_quantity, agreed_unit_price_minor,
    counted_unit_code, counted_unit_quantity, wrong_quantity
  FROM receiving_count;

DROP TABLE receiving_count;
ALTER TABLE receiving_count_new RENAME TO receiving_count;

CREATE INDEX IF NOT EXISTS ix_receiving_count_line ON receiving_count(po_line_id, status);
CREATE INDEX IF NOT EXISTS ix_receiving_count_receipt ON receiving_count(receipt_id);

-- One row per variant the bay named on a count. A colour, a size or both;
-- each named once per count.
CREATE TABLE IF NOT EXISTS receiving_count_variant (
    count_id         TEXT NOT NULL REFERENCES receiving_count(count_id),
    colour_code      TEXT,
    size_code        TEXT,
    counted_quantity INTEGER NOT NULL CHECK (counted_quantity >= 0),
    CHECK (colour_code IS NOT NULL OR size_code IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_receiving_count_variant
    ON receiving_count_variant (count_id, COALESCE(colour_code, ''), COALESCE(size_code, ''));

-- The surat jalan of a purchase return. `note_line_notes` is a JSON object,
-- article code → words ("*" for the not-as-ordered pieces).
ALTER TABLE purchase_return ADD COLUMN note_pic TEXT;
ALTER TABLE purchase_return ADD COLUMN note_generated_at TEXT;
ALTER TABLE purchase_return ADD COLUMN note_generated_by TEXT;
ALTER TABLE purchase_return ADD COLUMN note_line_notes TEXT;

COMMIT;
PRAGMA foreign_keys=ON;
