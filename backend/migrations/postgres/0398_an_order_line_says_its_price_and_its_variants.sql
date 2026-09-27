-- A purchase order line says what it will sell for, and in which variants.
--
-- The owner's rule of 2026-09-26: a buyer adding an item to an order states
-- the purchase price, a markup and the base (selling) price — the two kept in
-- step — and, when the item comes in colours and sizes, how many of each SKU
-- and, where it differs, that SKU's own price over the base.
--
-- `base_price_minor` and `markup_bps` sit on the line: they are the buyer's
-- intention for these goods when they are set up as articles, not the
-- supplier's price (that is `unit_price_minor`). Both optional — an order raised
-- before this, or by somebody who has not decided yet, carries neither.
--
-- `purchase_order_line_variant` breaks the line's pieces down by colour and
-- size. The line's `ordered_quantity` stays the whole of it, and is the sum of
-- its variants when it has any: receiving still counts the line, and article
-- setup reads the breakdown to prefill the SKUs it mints.
ALTER TABLE purchase_order_line
    ADD COLUMN base_price_minor bigint CHECK (base_price_minor IS NULL OR base_price_minor >= 0),
    ADD COLUMN markup_bps integer CHECK (markup_bps IS NULL OR markup_bps >= -10000);

CREATE TABLE purchase_order_line_variant (
    variant_id        uuid PRIMARY KEY,
    po_line_id        uuid NOT NULL REFERENCES purchase_order_line (po_line_id) ON DELETE CASCADE,
    colour_code       text REFERENCES colour (code),
    size_code         char(2) REFERENCES size_code (code),
    quantity          bigint NOT NULL CHECK (quantity > 0),
    -- This SKU's own selling price, when it is not the line's base price.
    base_price_minor  bigint CHECK (base_price_minor IS NULL OR base_price_minor >= 0),
    CHECK (colour_code IS NOT NULL OR size_code IS NOT NULL)
);

CREATE UNIQUE INDEX ux_purchase_order_line_variant
    ON purchase_order_line_variant (po_line_id, COALESCE(colour_code, ''), COALESCE(size_code, ''));
