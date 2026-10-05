-- What a cloud-run pick put in the Gudang's pick area and is still standing
-- there: in no carton, not put back (DC-CLOUD-NATIVE.md, picking.rs).
--
-- Packing reads this to know which pieces in the pick area are which shop's
-- and which allotment line's, and picking reads it to stop offering what is
-- already fetched. A piece is still waiting while the ledger has it at the
-- place the pick put it; packing it into a koli moves it out of that place,
-- and it drops out of here without anybody writing to picking's tables.
--
-- A subject picked more than once (picked, packed, unpacked back to the
-- rack, picked again for another shop) belongs to its newest pick: what is
-- left of it at the place is handed out newest pick first. For an RFID unit
-- that is simply "the newest pick of this tag".
CREATE OR REPLACE VIEW dc_pick_waiting AS
WITH ranked AS (
    SELECT piece.*,
           COALESCE(SUM(piece.quantity) OVER (
               PARTITION BY piece.subject_id, piece.place_id
               ORDER BY piece.seq DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ), 0)::bigint AS newer
      FROM dc_pick_piece piece
)
SELECT ranked.pick_session_id,
       ranked.pick_line_id,
       ranked.allotment_id,
       ranked.allotment_line_id,
       ranked.destination_id,
       ranked.sku_id,
       ranked.sku_code,
       ranked.subject_id,
       ranked.place_id,
       LEAST(ranked.quantity, projection.quantity - ranked.newer)::bigint AS quantity,
       ranked.picked_at
  FROM ranked
  JOIN inventory_projection projection
    ON projection.subject_id = ranked.subject_id
   AND projection.place_id = ranked.place_id
 WHERE projection.quantity - ranked.newer > 0;

COMMENT ON VIEW dc_pick_waiting IS
    'Pieces a cloud-run pick put in the Gudang''s pick area that are still there, by shop and allotment line (0907). Packing packs from these.';
