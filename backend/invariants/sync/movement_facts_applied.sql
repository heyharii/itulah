-- id: sync.movement_facts_applied
-- severity: high
-- rule: nothing is recorded as applied beyond the watermark — every edge movement the centre holds sits at or below its stream's applied_seq
-- enforced: Rust sync::apply_one (watermark row FOR UPDATE, then apply, then advance, in one transaction)
-- requires: edge_movement, sync_applied_watermark
-- mutate: UPDATE sync_applied_watermark SET applied_seq = 0 WHERE (origin_id, generation) = (SELECT origin_id, generation FROM edge_movement ORDER BY 1, 2 LIMIT 1)
SELECT m.origin_id, m.generation, m.seq, m.event_id, a.applied_seq
  FROM edge_movement m
  LEFT JOIN sync_applied_watermark a ON a.origin_id = m.origin_id AND a.generation = m.generation
 WHERE m.seq > COALESCE(a.applied_seq, 0)
