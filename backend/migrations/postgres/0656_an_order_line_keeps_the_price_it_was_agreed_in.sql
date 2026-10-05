-- An order line keeps the price in the unit it was agreed in.
--
-- A supplier quotes "Rp 250.000 per lusin". Until now the line kept only a
-- price per piece, so that quote became 20.833 a piece after rounding and
-- the line total drifted a few rupiah from the supplier's own invoice. 7Soft
-- keeps the price in the unit on the line ("Harga: harga satuan dari item
-- yang dipesan", subtotal = jumlah × harga) and so does ERPNext (`rate` per
-- `uom`, `stock_uom_rate` beside it). Now so do we:
--
--   * `order_unit_price_minor` — the agreed price for one order unit, exactly
--     as quoted. Null when the line was ordered in the stock unit.
--   * `line_amount_minor` — order unit quantity × that price: what the
--     supplier bills.
--   * `unit_price_minor` — that price divided by the unit's factor, rounded
--     to the rupiah: what one piece is valued at when it is received.
ALTER TABLE purchase_order_line
    ADD COLUMN order_unit_price_minor bigint
        CHECK (order_unit_price_minor IS NULL OR order_unit_price_minor >= 0),
    ADD CONSTRAINT purchase_order_line_unit_price_has_its_unit
        CHECK (order_unit_price_minor IS NULL OR order_unit_code IS NOT NULL);
