-- Purchase orders a DC has been given to receive against, and the delivery
-- documents it raises when goods actually turn up.
--
-- The DC does not raise orders — procurement is a central function — so
-- `purchase_order` is written only by applying a `purchase.order.activate`
-- command. What it holds is a work list: which items to expect and how many.
--
-- The receipt is the other way round: it is the DC's own document, opened on
-- the loading bay, and it travels UP.

CREATE TABLE IF NOT EXISTS purchase_order (
    purchase_order_id   TEXT PRIMARY KEY,
    po_number           TEXT NOT NULL UNIQUE,
    supplier_id         TEXT NOT NULL,
    supplier_name       TEXT,
    destination_site_id TEXT NOT NULL,
    activated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_order_line (
    po_line_id        TEXT PRIMARY KEY,
    purchase_order_id TEXT NOT NULL REFERENCES purchase_order(purchase_order_id),
    line_number       INTEGER NOT NULL,
    -- What the checker is shown: the article's name and picture. Not a SKU —
    -- these goods have no SKU yet — and above all not the ordered quantity.
    article_code      TEXT NOT NULL,
    article_name      TEXT NOT NULL,
    image_url         TEXT,
    -- Pieces. This company orders in pieces, so this is the same unit the
    -- checker counts in and the same unit stock is held in. There is nothing
    -- to convert.
    ordered_quantity  INTEGER NOT NULL CHECK (ordered_quantity > 0),
    -- The agreed price, for the verifier to check the supplier's invoice
    -- against. The invoice arrives on the same lorry as the goods, so the
    -- verifier already holds one of the two numbers; withholding the other
    -- would be asking them to check a match they cannot see. The CHECKER's
    -- work list never selects this column — a checker counts, and comparing
    -- is somebody else's job.
    unit_price_minor  INTEGER,
    promised_date     TEXT,
    UNIQUE (purchase_order_id, line_number)
);
CREATE INDEX IF NOT EXISTS ix_edge_po_line_article ON purchase_order_line(article_code);

-- ---------------------------------------------------------------------------
-- The delivery document
-- ---------------------------------------------------------------------------

-- Opened when a truck arrives, before anything is counted.
--
-- One truck brings several articles against several orders, so the document
-- comes first and the counted lines hang off it. It is also the only place
-- the supplier's invoice is ever recorded: the verifier is holding the paper,
-- and nothing else in the estate can see it.
--
-- The number is minted here, not at the centre. A warehouse must be able to
-- receive with the network down, and a number handed out by the centre would
-- make receiving wait for the one thing a loading bay cannot wait for. The
-- site is inside the number, so two DCs numbering at the same moment cannot
-- collide.
CREATE TABLE IF NOT EXISTS goods_receipt (
    receipt_id      TEXT PRIMARY KEY,
    receipt_number  TEXT NOT NULL UNIQUE,
    supplier_id     TEXT NOT NULL,
    arrived_at      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'CLOSED')),
    opened_by       TEXT NOT NULL,
    opened_at       TEXT NOT NULL,
    closed_by       TEXT,
    closed_at       TEXT,

    -- All nullable: the delivery is real whether or not the paperwork came
    -- with it. A warehouse that could not receive without an invoice would
    -- leave goods on the bay over a filing problem.
    invoice_number       TEXT,
    invoice_date         TEXT,
    invoice_total_minor  INTEGER CHECK (invoice_total_minor IS NULL OR invoice_total_minor >= 0),
    invoice_document_ref TEXT,
    invoice_recorded_by  TEXT,
    invoice_recorded_at  TEXT,

    CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
    CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
    CHECK ((invoice_recorded_at IS NULL) = (invoice_recorded_by IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_goods_receipt_status ON goods_receipt(status, arrived_at);

-- Gapless per site. The number is on a document a supplier will quote back at
-- you, so a hole in the sequence is a question somebody has to answer.
CREATE TABLE IF NOT EXISTS goods_receipt_counter (
    singleton   INTEGER PRIMARY KEY CHECK (singleton = 1),
    last_number INTEGER NOT NULL CHECK (last_number >= 0)
);

-- A blind count of one order line, awaiting a verifier.
--
-- This is a document, not inventory. The goods it describes are on the
-- loading bay: physically present, not yet anything the system holds. They
-- become stock only when a verifier accepts the count, which is also the only
-- moment the centre hears about them.
CREATE TABLE IF NOT EXISTS receiving_count (
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
    -- One pair of hands cannot both count a delivery and approve it.
    CHECK (verified_by IS NULL OR verified_by <> counted_by),
    CHECK ((status = 'ACCEPTED') = (receipt_line_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_receiving_count_line ON receiving_count(po_line_id, status);
CREATE INDEX IF NOT EXISTS ix_receiving_count_receipt ON receiving_count(receipt_id);

-- Price amendments this DC has asked head office for, and the answers.
--
-- The verifier is the only person who sees the supplier's invoice, so they
-- are the only one who can notice a discrepancy — but they are not the one
-- who may decide. A warehouse that could rewrite the price it is being billed
-- at would be settling the company's debts from the loading bay.
CREATE TABLE IF NOT EXISTS purchase_price_amendment (
    request_id           TEXT PRIMARY KEY,
    po_line_id           TEXT NOT NULL REFERENCES purchase_order_line(po_line_id),
    count_id             TEXT NOT NULL REFERENCES receiving_count(count_id),
    invoiced_price_minor INTEGER NOT NULL CHECK (invoiced_price_minor >= 0),
    note                 TEXT NOT NULL,
    requested_by         TEXT NOT NULL,
    requested_at         TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING','APPROVED','REJECTED')),
    approved_price_minor INTEGER,
    decided_by           TEXT,
    decided_at           TEXT,
    decision_note        TEXT
);
CREATE INDEX IF NOT EXISTS ix_edge_price_amendment_count
    ON purchase_price_amendment(count_id, status);
