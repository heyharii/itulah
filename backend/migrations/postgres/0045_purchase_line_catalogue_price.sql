-- 0045: What the catalogue was asking, beside what we agreed to pay.
--
-- 0032 gave `purchase_order_line` a snapshot of the supplier item's code, name
-- and image, and 0044 let an order's price disagree with the catalogue's. The
-- one thing not snapshotted was the price — the only field anybody actually
-- overrides.
--
-- Without it, a line that says 28.000 cannot say what it was 28.000 *instead
-- of*. `supplier_item_version` records which revision was consulted, but
-- `supplier_item` keeps no history, so that version is a number with nothing
-- behind it: the row it names has already moved on. A buyer asking "did we get
-- a better price than the list?" six months later could not be answered, which
-- is precisely the question a negotiated price exists to raise.
--
-- Nullable, because every line raised before this migration genuinely does not
-- know, and inventing the current catalogue price for them would be worse than
-- admitting it: it would read as evidence of a decision nobody made.

ALTER TABLE purchase_order_line
    ADD COLUMN supplier_item_price_snapshot bigint
        CHECK (supplier_item_price_snapshot IS NULL OR supplier_item_price_snapshot >= 0);

COMMENT ON COLUMN purchase_order_line.supplier_item_price_snapshot IS
    'What the catalogue was asking when this line was raised. Equal to '
    'unit_price_minor when the buyer took the catalogue''s word for it; '
    'different when they agreed something else. NULL on lines raised before '
    'the column existed.';
