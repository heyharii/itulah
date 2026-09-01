-- Purchase orders. Raised at the centre, worked at a DC.
--
-- # Where a PO lives, and why
--
-- Procurement is a central function: a buyer commits the company's money to a
-- supplier. A DC does not raise its own orders, so a PO is created here and
-- travels down the command lane to exactly one DC — the one that will receive
-- the goods. That direction is not a convenience; it is the authority.
--
-- # What this table does NOT hold
--
-- A received quantity column. What has been received is derived from the
-- receipt facts the DC sends, never maintained as a counter here. A stored
-- counter and the facts it summarises drift, and when they do nobody can say
-- which one to believe — whereas a projection that disagrees with its source
-- is simply rebuilt. This is the one design decision worth copying wholesale
-- from the procurement systems that came before.

CREATE TABLE purchase_order (
    purchase_order_id     uuid PRIMARY KEY,
    po_number             text NOT NULL UNIQUE,
    supplier_id           text NOT NULL,
    supplier_name         text,
    -- The DC that will receive against this order. Exactly one: a command
    -- must have a determinate target, and goods arrive somewhere specific.
    destination_site_id   text NOT NULL,
    -- SOURCING requires a decision record; DIRECT forbids one. A buyer
    -- ordering without a sourcing round is an ordinary way to raise a PO, not
    -- a gap to be back-filled with an invented decision.
    origin_kind           text NOT NULL CHECK (origin_kind IN ('SOURCING', 'DIRECT')),
    sourcing_decision_id  text,
    order_status          text NOT NULL DEFAULT 'DRAFT'
                          CHECK (order_status IN ('DRAFT', 'ISSUED', 'CLOSED', 'CANCELLED')),
    currency              char(3) NOT NULL,
    notes                 text,
    created_by            text NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    issued_at             timestamptz,
    -- The command that carried this order to its DC, once it was issued.
    activation_command_id uuid,
    CHECK (
        (origin_kind = 'SOURCING' AND sourcing_decision_id IS NOT NULL)
        OR (origin_kind = 'DIRECT' AND sourcing_decision_id IS NULL)
    ),
    CHECK ((order_status = 'DRAFT') = (issued_at IS NULL))
);
CREATE INDEX ix_po_destination ON purchase_order (destination_site_id, order_status);
CREATE INDEX ix_po_supplier ON purchase_order (supplier_id);

CREATE TABLE purchase_order_line (
    po_line_id        uuid PRIMARY KEY,
    purchase_order_id uuid NOT NULL REFERENCES purchase_order(purchase_order_id) ON DELETE CASCADE,
    line_number       integer NOT NULL CHECK (line_number > 0),
    -- An order is placed against an ARTICLE. A SKU (article + colour + size)
    -- does not exist for these goods yet: it is worked out during
    -- identification, which happens after the delivery has been accepted.
    article_code      text NOT NULL,
    article_name      text NOT NULL,
    image_url         text,
    -- What the supplier calls it, captured when the order was raised. Kept as
    -- a snapshot rather than a reference: the supplier may rename an item, and
    -- a printed order must still read the way it was agreed.
    supplier_wording  text,
    ordered_quantity  bigint NOT NULL CHECK (ordered_quantity > 0),
    purchase_uom      text NOT NULL,
    -- How many stock units one purchase unit yields — a carton of 12 is
    -- ordered as 1 and received as 12, and losing this is how receiving
    -- reports come out twelvefold wrong.
    uom_conversion    bigint NOT NULL DEFAULT 1 CHECK (uom_conversion > 0),
    unit_price_minor  bigint NOT NULL CHECK (unit_price_minor >= 0),
    line_amount_minor bigint NOT NULL CHECK (line_amount_minor >= 0),
    promised_date     date,
    line_status       text NOT NULL DEFAULT 'OPEN'
                      CHECK (line_status IN ('OPEN', 'CLOSED', 'CANCELLED')),
    cancelled_quantity bigint NOT NULL DEFAULT 0 CHECK (cancelled_quantity >= 0),
    UNIQUE (purchase_order_id, line_number),
    CHECK (cancelled_quantity <= ordered_quantity)
);
CREATE INDEX ix_po_line_article ON purchase_order_line (article_code);

-- Receipts a DC reported against a PO line. Append-only evidence; the
-- received quantity is summed from here and never stored on the line.
CREATE TABLE purchase_receipt (
    receipt_id        uuid PRIMARY KEY,
    po_line_id        uuid NOT NULL REFERENCES purchase_order_line(po_line_id) ON DELETE CASCADE,
    origin_id         text NOT NULL,
    generation        bigint NOT NULL,
    seq               bigint NOT NULL,
    movement_group_id uuid NOT NULL,
    -- In stock units, already converted from the purchase UOM by the DC that
    -- physically counted them.
    quantity          bigint NOT NULL CHECK (quantity > 0),
    -- Who counted, and who verified. Separate columns and a constraint
    -- rather than a convention: a receipt one person both counted and
    -- approved is phantom stock nobody would ever see as wrong.
    actor_id          text NOT NULL,
    verified_by       text NOT NULL,
    occurred_at       timestamptz NOT NULL,
    verified_at       timestamptz NOT NULL,
    received_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (actor_id <> verified_by)
);
CREATE INDEX ix_purchase_receipt_line ON purchase_receipt (po_line_id);
CREATE UNIQUE INDEX ux_purchase_receipt_movement ON purchase_receipt (movement_group_id, po_line_id);
