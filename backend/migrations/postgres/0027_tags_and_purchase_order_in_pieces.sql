-- Tags as a vocabulary, and a purchase order that speaks in pieces.
--
-- # Why tags become a table
--
-- They were a `text[]`. That works until two people write "kemeja" and
-- "Kemeja", at which point the catalogue has two tags that look identical on
-- screen and never appear in each other's reports. A free-text tag does not
-- fail; it silently splits.
--
-- The purchase order refers to the same vocabulary the master article does.
-- That is the point: a buyer files an order under "kemeja" and a merchandiser
-- later files the article under "kemeja", and those are the same word because
-- there is only one row that can spell it.
--
-- # Why the UOM columns go
--
-- This company orders in pieces. `purchase_uom` and `uom_conversion` existed
-- so an order placed in cartons could be counted in garments — real machinery
-- for a real problem, but not this company's problem. Carrying a conversion
-- that is always 1 is not free: it is arithmetic on every read that can be
-- got wrong, and it was, once, turning 118 pieces into 1,416.
--
-- If the business ever buys by the carton, this comes back as a column on the
-- order line with the conversion applied at exactly one place. It does not
-- come back as a default of 1 sprinkled through the code.

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------

CREATE TABLE tag (
    code       text PRIMARY KEY CHECK (btrim(code) <> ''),
    label      text NOT NULL CHECK (btrim(label) <> ''),
    active     boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- No two tags may share a display name. Two rows both reading "Kemeja" are
-- exactly the split this table exists to prevent.
CREATE UNIQUE INDEX tag_label_unique ON tag (lower(btrim(label)));

INSERT INTO tag (code, label) VALUES
    ('KEMEJA',         'Kemeja'),
    ('KAOS',           'Kaos'),
    ('CELANA',         'Celana'),
    ('JAKET',          'Jaket'),
    ('LENGAN_PANJANG', 'Lengan Panjang'),
    ('LENGAN_PENDEK',  'Lengan Pendek'),
    ('BASIC',          'Basic'),
    ('MUSIMAN',        'Musiman');

CREATE TABLE article_tag (
    article_id uuid NOT NULL REFERENCES article(id) ON DELETE CASCADE,
    tag_code   text NOT NULL REFERENCES tag(code),
    PRIMARY KEY (article_id, tag_code)
);
CREATE INDEX ix_article_tag_tag ON article_tag (tag_code);

CREATE TABLE article_setup_session_tag (
    session_id uuid NOT NULL REFERENCES article_setup_session(session_id) ON DELETE CASCADE,
    tag_code   text NOT NULL REFERENCES tag(code),
    PRIMARY KEY (session_id, tag_code)
);

CREATE TABLE purchase_order_line_tag (
    po_line_id uuid NOT NULL REFERENCES purchase_order_line(po_line_id) ON DELETE CASCADE,
    tag_code   text NOT NULL REFERENCES tag(code),
    PRIMARY KEY (po_line_id, tag_code)
);
CREATE INDEX ix_purchase_order_line_tag_tag ON purchase_order_line_tag (tag_code);

-- ---------------------------------------------------------------------------
-- The order, simplified
-- ---------------------------------------------------------------------------

-- What the buyer already knows when raising the order, and what the setup
-- form will be pre-filled with later. A preset, not a decision: head office
-- may replace it when the goods are actually identified.
ALTER TABLE purchase_order_line
    ADD COLUMN division_code text REFERENCES division(code);
CREATE INDEX ix_purchase_order_line_division
    ON purchase_order_line (division_code) WHERE division_code IS NOT NULL;

-- Quantities are pieces, so there is nothing to convert and no second unit to
-- name. Dropping these also drops the CHECKs that referenced them.
ALTER TABLE purchase_order_line
    DROP COLUMN purchase_uom,
    DROP COLUMN uom_conversion,
    -- The supplier's own description of the goods. It overlapped with
    -- `article_code` (also the supplier's) and `article_name` (ours), and
    -- nothing ever displayed it.
    DROP COLUMN supplier_wording;

COMMENT ON COLUMN purchase_order_line.ordered_quantity IS
    'Pieces. This company orders in pieces, so this is the unit the checker counts in and the unit stock is held in.';

-- Written on every order and read by nothing. The rule tying it to
-- `origin_kind` was a constraint guarding a column nobody used.
ALTER TABLE purchase_order DROP COLUMN sourcing_decision_id;

-- No order was ever created as a draft: raising one issues it. A status value
-- nothing can produce is a branch every reader must consider and no writer
-- can reach.
ALTER TABLE purchase_order DROP CONSTRAINT purchase_order_order_status_check;
ALTER TABLE purchase_order ALTER COLUMN order_status SET DEFAULT 'ISSUED';
ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_order_status_check
    CHECK (order_status IN ('ISSUED', 'CLOSED', 'CANCELLED'));
