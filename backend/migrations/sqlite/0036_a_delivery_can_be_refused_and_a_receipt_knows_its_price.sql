-- 0036: what the bay writes down when it accepts, and the lorry it turns away.
--
-- Three things this node could not say.
--
-- # What the acceptance was worth
--
-- The price lived only on the order line, and the centre read it back at
-- whatever value it held later. So a delivery accepted in March was restated
-- when somebody approved a new price in May. The count now carries the price
-- that applied when it was accepted, and that number never moves again.
--
-- # What the order could not take
--
-- Nothing compared the count against what the order still had outstanding, so
-- a second full delivery against a filled order read as twice the goods
-- ordered and twice the money expected. The split is written here, at the
-- moment of acceptance, by the node that knows both the order and every
-- receipt against it — one order is worked by exactly one DC, so this node
-- sees the whole history. The centre re-derives it and does not take this
-- node's word for it.
--
-- Two quantities, not a flag: 105 accepted against an order of 100 is 100
-- matched and 5 excess, and the 100 must be able to go on being worked while
-- the 5 wait for a buyer.
--
-- # A lorry that was turned away
--
-- `goods_receipt` allowed OPEN and CLOSED, and nothing ever wrote CLOSED. A
-- delivery that arrived soaked and went back on the lorry could not be
-- recorded at all, so the one fact worth keeping — this supplier sent damaged
-- goods, three times — was the one the system threw away. A delivery is a
-- supplier's arrival, not our decision to accept it, so it exists whatever we
-- decide about the goods.
--
-- SQLite cannot alter a CHECK, so the table is rebuilt once, guarded on the
-- new column.

-- ---------------------------------------------------------------------------
-- The acceptance
-- ---------------------------------------------------------------------------

ALTER TABLE receiving_count ADD COLUMN matched_quantity INTEGER;
ALTER TABLE receiving_count ADD COLUMN excess_quantity INTEGER;
ALTER TABLE receiving_count ADD COLUMN agreed_unit_price_minor INTEGER;

-- Everything already accepted was treated as matched by every reader at the
-- time. Saying so is honest; leaving it null makes every later query carry a
-- branch for a question nobody can now answer.
UPDATE receiving_count
   SET matched_quantity = counted_quantity,
       excess_quantity  = 0
 WHERE status = 'ACCEPTED' AND matched_quantity IS NULL;

-- ---------------------------------------------------------------------------
-- The answer to a price query, and how far it reaches
-- ---------------------------------------------------------------------------

-- DELIVERY settles the acceptance that raised it; REMAINING also repriced the
-- quantity not yet received. The DC does not decide either — it is told.
ALTER TABLE purchase_price_amendment ADD COLUMN scope TEXT;

-- ---------------------------------------------------------------------------
-- The delivery that was refused
-- ---------------------------------------------------------------------------

PRAGMA foreign_keys=OFF;

CREATE TABLE goods_receipt_rebuilt (
    receipt_id      TEXT PRIMARY KEY,
    receipt_number  TEXT NOT NULL UNIQUE,
    supplier_id     TEXT NOT NULL,
    arrived_at      TEXT NOT NULL,
    -- OPEN      goods are being counted and decided
    -- COMPLETED the bay has finished with this lorry
    -- REJECTED  nothing was accepted; it went back
    status          TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'COMPLETED', 'REJECTED')),
    opened_by       TEXT NOT NULL,
    opened_at       TEXT NOT NULL,
    closed_by       TEXT,
    closed_at       TEXT,
    -- Why it was refused, and by whom. A rejection with no reason is a rumour.
    rejected_reason TEXT,

    invoice_number       TEXT,
    invoice_date         TEXT,
    invoice_total_minor  INTEGER CHECK (invoice_total_minor IS NULL OR invoice_total_minor >= 0),
    invoice_document_ref TEXT,
    invoice_recorded_by  TEXT,
    invoice_recorded_at  TEXT,

    CHECK ((status = 'OPEN') = (closed_at IS NULL)),
    CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
    CHECK ((status = 'REJECTED') = (rejected_reason IS NOT NULL)),
    CHECK (status <> 'REJECTED' OR trim(rejected_reason) <> ''),
    CHECK ((invoice_recorded_at IS NULL) = (invoice_recorded_by IS NULL))
);

INSERT INTO goods_receipt_rebuilt
    (receipt_id, receipt_number, supplier_id, arrived_at, status, opened_by, opened_at,
     closed_by, closed_at, rejected_reason,
     invoice_number, invoice_date, invoice_total_minor, invoice_document_ref,
     invoice_recorded_by, invoice_recorded_at)
SELECT receipt_id, receipt_number, supplier_id, arrived_at,
       CASE WHEN status = 'CLOSED' THEN 'COMPLETED' ELSE status END,
       opened_by, opened_at, closed_by, closed_at, NULL,
       invoice_number, invoice_date, invoice_total_minor, invoice_document_ref,
       invoice_recorded_by, invoice_recorded_at
FROM goods_receipt;

DROP TABLE goods_receipt;
ALTER TABLE goods_receipt_rebuilt RENAME TO goods_receipt;

CREATE INDEX IF NOT EXISTS ix_goods_receipt_status ON goods_receipt(status, arrived_at);

PRAGMA foreign_keys=ON;
