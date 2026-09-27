-- id: stock.edge_position_matches_facts
-- severity: critical
-- rule: what the centre holds as a shop's position (edge_inventory_fact_position) is the fold of that shop's movement facts at its operational pools, and never negative
-- enforced: Rust single writer sync::apply_fact_position_delta (refuses a negative result, skips external/system places); no rebuild or compare exists — reconcile_positions compares facts with the snapshot, not with this table
-- requires: edge_movement, edge_movement_line, edge_inventory_fact_position
-- mutate: DELETE FROM edge_inventory_fact_position WHERE (origin_id, subject_id, place_id) = (SELECT origin_id, subject_id, place_id FROM edge_inventory_fact_position ORDER BY 1, 2, 3 LIMIT 1)
WITH d AS (
    SELECT m.origin_id, l.subject_id, l.to_place_id AS place_id, l.quantity AS delta
      FROM edge_movement m JOIN edge_movement_line l ON l.movement_group_id = m.movement_group_id
    UNION ALL
    SELECT m.origin_id, l.subject_id, l.from_place_id, -l.quantity
      FROM edge_movement m JOIN edge_movement_line l ON l.movement_group_id = m.movement_group_id
), fold AS (
    SELECT origin_id, subject_id, place_id, SUM(delta)::bigint AS qty
      FROM d
     WHERE place_id NOT LIKE 'external/%' AND place_id NOT LIKE 'system/%'
     GROUP BY origin_id, subject_id, place_id
)
SELECT COALESCE(f.origin_id, p.origin_id) AS origin_id,
       COALESCE(f.subject_id, p.subject_id) AS subject_id,
       COALESCE(f.place_id, p.place_id) AS place_id,
       f.qty AS from_facts, p.quantity AS held
  FROM (SELECT * FROM fold WHERE qty <> 0) f
  FULL JOIN edge_inventory_fact_position p
    ON p.origin_id = f.origin_id AND p.subject_id = f.subject_id AND p.place_id = f.place_id
 WHERE f.qty IS DISTINCT FROM p.quantity
