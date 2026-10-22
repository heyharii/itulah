-- A count whose adjustment the node refused is closed (20 Oct 2026).
--
-- The node answered REJECTED and booked nothing, and a count takes exactly one
-- adjustment, so a REVIEW count with that answer could never move again: the
-- hub showed it "To do" behind an Apply that answered 409. From now on the
-- refusal closes it (sync.rs); this closes the ones already stuck. The node's
-- reason stays on edge_official_count_adjustment_result.
UPDATE official_count
SET status = 'CLOSED',
    closed_at = COALESCE(edge_adjustment_received_at, now())
WHERE status = 'REVIEW'
  AND edge_adjustment_status = 'REJECTED';
