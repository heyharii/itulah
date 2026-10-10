-- Availability subtracts what is still allotted and unpacked from a pool. It
-- read that from every allotment line the pool ever sent — completed lines
-- included, whose counters net to zero — so the page grew with history: 1.87M
-- lines and 8.6 s at a year of sales, every one contributing 0.
--
-- The expression is the line's own "still to pack" figure, which the
-- fulfillment-places check keeps at or above zero; the index holds only lines
-- where it is above zero, which is the live work.
CREATE INDEX IF NOT EXISTS ix_allotment_line_to_pack
    ON allotment_line (source_pool_id, sku_id)
 WHERE quantity + unpacked_quantity + lost_packed_quantity + lost_in_transit_quantity
       + lost_at_store_quantity - packed_quantity - cancelled_quantity - closed_short_quantity > 0;
