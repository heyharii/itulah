-- id: stock.never_negative
-- severity: critical
-- rule: no subject is ever below zero at a company place, and a UNIT (one EPC) stands in at most one company place
-- enforced: Rust movements::apply_line (balance from movement under FOR UPDATE on inventory_subject) and validate_unique_company_placements; no DB guard on the ledger itself
-- requires: movement, inventory_place, inventory_subject
-- mutate: INSERT INTO movement (movement_id, movement_group_id, subject_id, quantity, from_place_id, to_place_id, cause, reference_type, reference_id, idempotency_key, payload_digest, actor_id, occurred_at, recorded_at) SELECT gen_random_uuid(), movement_group_id, subject_id, quantity + 1000, to_place_id, from_place_id, cause, reference_type, reference_id, idempotency_key, payload_digest, actor_id, occurred_at, recorded_at FROM movement m WHERE EXISTS (SELECT 1 FROM inventory_place p WHERE p.id = m.to_place_id AND p.is_company) ORDER BY fact_sequence LIMIT 1
WITH d AS (
    SELECT subject_id, to_place_id AS place_id, quantity AS delta FROM movement
    UNION ALL
    SELECT subject_id, from_place_id, -quantity FROM movement
), fold AS (
    SELECT d.subject_id, d.place_id, SUM(d.delta)::bigint AS qty
      FROM d JOIN inventory_place p ON p.id = d.place_id AND p.is_company
     GROUP BY d.subject_id, d.place_id
)
SELECT subject_id, place_id::text AS place, qty, 'below zero' AS problem
  FROM fold WHERE qty < 0
UNION ALL
SELECT f.subject_id, string_agg(f.place_id, ', ' ORDER BY f.place_id), SUM(f.qty), 'one unit in several places'
  FROM fold f JOIN inventory_subject s ON s.id = f.subject_id AND s.subject_type = 'UNIT'
 WHERE f.qty > 0
 GROUP BY f.subject_id
HAVING COUNT(*) > 1 OR SUM(f.qty) > 1
