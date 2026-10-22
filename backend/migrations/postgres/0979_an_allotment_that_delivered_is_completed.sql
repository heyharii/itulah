-- An allotment that delivered is Completed (owner, 18 Oct 2026: "allotment
-- yg ga perlu review auto masuk inventory toko ya dan allotmentnya
-- completed").
--
-- The header fold (0176) called an allotment CLOSED — read as Cancelled —
-- whenever any of it was closed short. But a piece is closed short for more
-- than giving up: MD's Edit moves pieces between shops by closing them short
-- on one line and raising another, Accept short and MD's review give up what
-- never arrived. An allotment that has nothing left to receive and got any of
-- its goods to a shop is Completed; CLOSED is kept for one that was given up
-- before anything arrived. The rest of the view is unchanged.
CREATE OR REPLACE VIEW allotment_commitment AS
 SELECT allotment_id,
    line_count,
    sku_count,
    article_count,
    destination_count,
    original_alloted,
    to_pack_qty,
    at_packed,
    at_shipment,
    at_loaded,
    at_in_transit,
    receiving_gap_qty,
    received,
    closed_short_total,
    to_receive_qty,
        CASE
            WHEN to_receive_qty > 0 THEN 'ACTIVE'::text
            WHEN closed_short_total > 0 AND received = 0 THEN 'CLOSED'::text
            ELSE 'COMPLETED'::text
        END AS status,
    to_pack_qty = 0 AND at_packed = 0 AND at_shipment = 0 AND at_loaded = 0 AND original_alloted > 0 AS dc_fulfilled
   FROM ( SELECT header.id AS allotment_id,
            count(commitment.allotment_line_id) AS line_count,
            count(DISTINCT commitment.sku_id) AS sku_count,
            count(DISTINCT sku.article_id) AS article_count,
            count(DISTINCT ROW(commitment.destination_type, commitment.destination_id)) FILTER (WHERE commitment.allotment_line_id IS NOT NULL) AS destination_count,
            COALESCE(sum(commitment.original_alloted), 0::numeric)::bigint AS original_alloted,
            COALESCE(sum(commitment.to_pack_qty), 0::numeric)::bigint AS to_pack_qty,
            COALESCE(sum(commitment.at_packed), 0::numeric)::bigint AS at_packed,
            COALESCE(sum(commitment.at_shipment), 0::numeric)::bigint AS at_shipment,
            COALESCE(sum(commitment.at_loaded), 0::numeric)::bigint AS at_loaded,
            COALESCE(sum(commitment.at_in_transit), 0::numeric)::bigint AS at_in_transit,
            COALESCE(sum(commitment.receiving_gap_qty), 0::numeric)::bigint AS receiving_gap_qty,
            COALESCE(sum(commitment.received), 0::numeric)::bigint AS received,
            COALESCE(sum(commitment.closed_short_total), 0::numeric)::bigint AS closed_short_total,
            COALESCE(sum(commitment.to_receive_qty), 0::numeric)::bigint AS to_receive_qty
           FROM allotment header
             LEFT JOIN allotment_line_commitment commitment ON commitment.allotment_id = header.id
             LEFT JOIN sku ON sku.id = commitment.sku_id
          GROUP BY header.id) folded
;
