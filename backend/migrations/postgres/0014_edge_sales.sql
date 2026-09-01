-- Sales received from the shops.
--
-- # Why not the existing `sale` tables
--
-- Those model an interactive cart: DRAFT, then lines, then payments, then
-- completion, with triggers enforcing that order. A sale arriving from a shop
-- is none of that — it is a finished fact about something that already
-- happened, hundreds of kilometres away, possibly hours ago. Pushing it back
-- through a cart lifecycle would mean inventing states it never had and
-- letting the centre's triggers reject history it has no authority over.
--
-- So the shops' sales land here, as what they are: an append-only record of
-- completed transactions, keyed by the shop's own sale id.

CREATE TABLE edge_sale (
    sale_id           uuid PRIMARY KEY,
    origin_id         text NOT NULL,
    generation        bigint NOT NULL,
    seq               bigint NOT NULL,
    -- The inventory fact carrying the same sale's stock movement. This is the
    -- join that makes "what left the shelf" reconcilable against "what was
    -- billed" — the pair of numbers a shrinkage investigation starts from.
    movement_group_id uuid NOT NULL,
    site_id           text NOT NULL,
    actor_id          text NOT NULL,
    occurred_at       timestamptz NOT NULL,
    currency          char(3) NOT NULL,
    total_minor       bigint NOT NULL CHECK (total_minor >= 0),
    paid_minor        bigint NOT NULL CHECK (paid_minor >= 0),
    change_minor      bigint NOT NULL CHECK (change_minor >= 0),
    received_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (paid_minor - total_minor = change_minor)
);
CREATE INDEX ix_edge_sale_site_time ON edge_sale (site_id, occurred_at DESC);
CREATE INDEX ix_edge_sale_origin ON edge_sale (origin_id, generation, seq);

CREATE TABLE edge_sale_line (
    sale_id          uuid NOT NULL REFERENCES edge_sale(sale_id) ON DELETE CASCADE,
    subject_id       uuid NOT NULL,
    epc              text NOT NULL,
    -- The shop's sku_code as it stood at the till. Deliberately not a foreign
    -- key: a report must still be readable after an item leaves the
    -- catalogue, and a shop running a slightly older catalogue must not have
    -- its takings refused.
    sku_code         text NOT NULL,
    quantity         bigint NOT NULL CHECK (quantity > 0),
    unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
    PRIMARY KEY (sale_id, subject_id)
);
CREATE INDEX ix_edge_sale_line_sku ON edge_sale_line (sku_code);
