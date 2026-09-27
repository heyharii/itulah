-- An order is placed in any unit and kept in pieces.
--
-- The piece is the unit everything is counted, valued and stocked in — the
-- owner's "formulasi piece". A buyer orders in whatever the supplier sells
-- by: pieces, dozens (lusin), scores (kodi), a carton. The line keeps what was
-- ordered (10 KODI), the factor that applied that day (20), and the pieces it
-- comes to (200) in `ordered_quantity`, which is what receiving, stock and
-- money read. The factor is a snapshot: changing the master later does not
-- rewrite an order already placed — the rule ERPNext's `conversion_factor`
-- on every transaction line follows.
--
-- Conversions are global (`unit_conversion`, 0394: LUSIN = 12, KODI = 20) with
-- a per-item override for pack units whose size is the item's own — a carton
-- of one item holds 24, of another 36 (owner, 2026-09-26).

CREATE TABLE supplier_item_unit (
    supplier_item_id uuid NOT NULL REFERENCES supplier_item (supplier_item_id) ON DELETE CASCADE,
    unit_code        text NOT NULL REFERENCES unit_of_measure (code),
    -- Pieces in one of this unit, for this item.
    factor           numeric(12, 4) NOT NULL CHECK (factor > 0),
    PRIMARY KEY (supplier_item_id, unit_code)
);

ALTER TABLE purchase_order_line
    ADD COLUMN order_unit_code     text REFERENCES unit_of_measure (code),
    ADD COLUMN order_unit_quantity numeric(14, 4) CHECK (order_unit_quantity > 0),
    ADD COLUMN unit_factor         numeric(12, 4) CHECK (unit_factor > 0),
    ADD CONSTRAINT purchase_order_line_unit_whole CHECK (
        (order_unit_code IS NULL) = (order_unit_quantity IS NULL)
        AND (order_unit_code IS NULL) = (unit_factor IS NULL)
    );

-- Pieces in one of a unit, for one item: 1 for the base unit, else the
-- item's own override, else the global conversion straight to the base unit.
-- NULL when the unit has no conversion at all.
CREATE FUNCTION unit_pieces_per(p_item uuid, p_unit text) RETURNS numeric
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM unit_of_measure WHERE code = p_unit AND is_base)
            THEN 1::numeric
        ELSE COALESCE(
            (SELECT factor FROM supplier_item_unit
              WHERE supplier_item_id = p_item AND unit_code = p_unit),
            (SELECT c.factor
               FROM unit_conversion c
               JOIN unit_of_measure base ON base.code = c.to_unit AND base.is_base
              WHERE c.from_unit = p_unit AND c.active)
        )
    END
$$;
