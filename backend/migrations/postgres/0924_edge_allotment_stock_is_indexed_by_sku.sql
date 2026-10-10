-- Allotment availability asks for a small set of (origin, SKU, place) pairs.
-- The existing origin/place index otherwise reads every unit at that place
-- before filtering its SKU. Unidentified lots have no SKU and cannot match
-- this lookup. Keep quantity out of the index so quantity-only updates do not
-- need to rewrite this index entry.
CREATE INDEX ix_edge_inventory_fact_position_origin_sku_place
    ON edge_inventory_fact_position (origin_id, sku_code, place_id)
    WHERE sku_code IS NOT NULL;
