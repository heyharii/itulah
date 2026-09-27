-- id: stock.projection_matches_movements
-- severity: critical
-- rule: inventory_projection is exactly the fold of movement at every company place: same quantity, same last fact, no row where the fold is empty
-- enforced: Rust single writer movements::refresh_projection_positions, inside apply_lines' transaction; rebuild control::run_repost, compare control::run_replay
-- requires: movement, inventory_projection, inventory_place
-- mutate: UPDATE inventory_projection SET quantity = quantity + 1 WHERE (subject_id, place_id) = (SELECT subject_id, place_id FROM inventory_projection ORDER BY subject_id, place_id LIMIT 1)
WITH d AS (
    SELECT subject_id, to_place_id AS place_id, quantity AS delta, fact_sequence FROM movement
    UNION ALL
    SELECT subject_id, from_place_id, -quantity, fact_sequence FROM movement
), fold AS (
    SELECT d.subject_id, d.place_id, SUM(d.delta)::bigint AS qty, MAX(d.fact_sequence) AS seq
      FROM d JOIN inventory_place p ON p.id = d.place_id AND p.is_company
     GROUP BY d.subject_id, d.place_id
)
SELECT COALESCE(f.subject_id, p.subject_id) AS subject_id,
       COALESCE(f.place_id, p.place_id)     AS place_id,
       f.qty AS from_movements, p.quantity AS in_projection,
       f.seq AS last_fact, p.last_fact_sequence AS projection_fact
  FROM (SELECT * FROM fold WHERE qty > 0) f
  FULL JOIN inventory_projection p ON p.subject_id = f.subject_id AND p.place_id = f.place_id
 WHERE f.qty IS DISTINCT FROM p.quantity
    OR f.seq IS DISTINCT FROM p.last_fact_sequence
