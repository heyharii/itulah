-- The goods receipt: a document, not an alias for a count.
--
-- # What was wrong before
--
-- A "receipt" was the accepted count, reusing its identifier. That works
-- exactly as long as a delivery is one article counted once. It stops working
-- the moment a truck brings four articles against three orders — which is the
-- ordinary case — because there is then no row that stands for "the
-- delivery", nothing to attach the supplier's invoice to, and nothing anyone
-- can look up by number when the supplier telephones.
--
-- So the receipt becomes what it always was on paper: a numbered document,
-- opened when the truck arrives, carrying one line per order line that was
-- counted and accepted, and holding the invoice that came with the goods.
--
-- # Why the number is minted at the DC
--
-- A warehouse must be able to receive with the network down. A number handed
-- out by the centre would make receiving depend on the centre being reachable,
-- which is the one thing a loading bay cannot wait for. The site is inside the
-- number, so two DCs numbering at the same moment cannot collide.
--
-- # Why the invoice sits on the header
--
-- One invoice covers the delivery, not each line of it. Recording it here is
-- also the only place the system ever learns what the supplier actually
-- billed — the verifier is holding the paper, and nothing else in the estate
-- can see it.

CREATE TABLE goods_receipt (
    receipt_id      uuid PRIMARY KEY,
    -- `GRN-dc-01-000001`. Minted at the DC; the site inside it is what makes
    -- it unique across the fleet without a central allocator.
    receipt_number  text NOT NULL UNIQUE CHECK (btrim(receipt_number) <> ''),
    origin_id       text NOT NULL REFERENCES sync_origin_credential(origin_id),
    site_id         text NOT NULL,
    supplier_id     text NOT NULL,
    -- When the goods physically arrived, as opposed to when the centre heard.
    arrived_at      timestamptz NOT NULL,

    -- The supplier's invoice, as it arrived on paper with the goods. All
    -- nullable: the delivery is real whether or not the paperwork came with
    -- it, and a warehouse that could not receive without an invoice would
    -- leave goods on the bay over a filing problem.
    invoice_number       text,
    invoice_date         date,
    invoice_total_minor  bigint CHECK (invoice_total_minor IS NULL OR invoice_total_minor >= 0),
    -- Where the scan of the invoice lives. A reference, not the bytes: this
    -- database is not a filestore.
    invoice_document_ref text,
    invoice_recorded_by  text,
    invoice_recorded_at  timestamptz,

    status          text NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'CLOSED')),
    opened_by       text NOT NULL,
    opened_at       timestamptz NOT NULL,
    closed_by       text,
    closed_at       timestamptz,

    generation      bigint NOT NULL,
    seq             bigint NOT NULL,
    received_at     timestamptz NOT NULL DEFAULT now(),

    CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
    CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
    CHECK ((invoice_recorded_at IS NULL) = (invoice_recorded_by IS NULL))
);
CREATE INDEX ix_goods_receipt_supplier ON goods_receipt (supplier_id, arrived_at DESC);
CREATE INDEX ix_goods_receipt_site ON goods_receipt (site_id, status);
CREATE INDEX ix_goods_receipt_invoice ON goods_receipt (invoice_number)
    WHERE invoice_number IS NOT NULL;

-- One line per order line that was counted and a second person accepted.
--
-- This is what a supplier is paid against: the quantity here, not the
-- quantity on the order. A line that arrived short shows both numbers, and
-- the difference is the whole point of counting.
CREATE TABLE goods_receipt_line (
    receipt_line_id   uuid PRIMARY KEY,
    receipt_id        uuid NOT NULL REFERENCES goods_receipt(receipt_id) ON DELETE CASCADE,
    po_line_id        uuid NOT NULL REFERENCES purchase_order_line(po_line_id) ON DELETE CASCADE,
    -- Pieces.
    quantity          bigint NOT NULL CHECK (quantity > 0),
    -- Who counted and who accepted. Separate columns and a constraint rather
    -- than a convention: goods one person both counted and approved are
    -- phantom stock nobody would ever see as wrong.
    counted_by        text NOT NULL,
    verified_by       text NOT NULL,
    counted_at        timestamptz NOT NULL,
    verified_at       timestamptz NOT NULL,
    movement_group_id uuid NOT NULL,

    generation        bigint NOT NULL,
    seq               bigint NOT NULL,
    received_at       timestamptz NOT NULL DEFAULT now(),

    CHECK (counted_by <> verified_by)
);
CREATE INDEX ix_goods_receipt_line_receipt ON goods_receipt_line (receipt_id);
CREATE INDEX ix_goods_receipt_line_po_line ON goods_receipt_line (po_line_id);
CREATE UNIQUE INDEX ux_goods_receipt_line_movement
    ON goods_receipt_line (movement_group_id, po_line_id);

-- A setup session works out ONE line of a delivery, because a truck brings
-- several articles and each is a different product.
ALTER TABLE article_setup_session
    ADD CONSTRAINT article_setup_session_receipt_line_fkey
    FOREIGN KEY (receipt_line_id) REFERENCES goods_receipt_line(receipt_line_id);

-- Superseded. Everything it held now lives on the document and its lines,
-- where a delivery of four articles is one row plus four rather than four
-- rows that know nothing of each other.
DROP TABLE purchase_receipt;

COMMENT ON TABLE goods_receipt IS
    'A numbered delivery document, opened at the DC when a truck arrives. Holds the supplier invoice; carries one line per accepted count.';
COMMENT ON COLUMN goods_receipt_line.quantity IS
    'What was counted and accepted, in pieces. The supplier is paid against this, never against the ordered quantity.';
