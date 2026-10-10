#!/usr/bin/env bash
# EXPLAIN ANALYZE the suspect cloud queries against a seeded rig.
# Usage: bash scripts/check-db-efficiency.sh <database>
set -euo pipefail
DB="${1:-rig_perf}"
Q() { echo "== $1"; shift; psql -X -d "$DB" -c "$@" ; }

# 1. finance_close_readiness — unposted trading days (finance_control.rs:547)
Q "close-unposted (EXTRACT, as written)" "
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
SELECT COUNT(*)::bigint FROM (
     SELECT DISTINCT s.site_id, s.business_date AS day
       FROM edge_sale s
      WHERE EXTRACT(YEAR FROM s.business_date) = 2025
        AND EXTRACT(MONTH FROM s.business_date) = 6
 ) traded
 WHERE NOT EXISTS (
     SELECT 1 FROM sales_posting p
      WHERE p.site_id = traded.site_id AND p.business_date = traded.day
        AND p.status = 'POSTED');"

Q "close-unposted (range rewrite)" "
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
SELECT COUNT(*)::bigint FROM (
     SELECT DISTINCT s.site_id, s.business_date AS day
       FROM edge_sale s
      WHERE s.business_date >= DATE '2025-06-01'
        AND s.business_date <  DATE '2025-07-01'
 ) traded
 WHERE NOT EXISTS (
     SELECT 1 FROM sales_posting p
      WHERE p.site_id = traded.site_id AND p.business_date = traded.day
        AND p.status = 'POSTED');"

# 2. observation_anomalies (observations.rs:432)
Q "observation-anomalies (as written)" "
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
WITH latest_observation AS (
    SELECT DISTINCT ON (subject_id) subject_id,epc,pool_id,last_seen_at,device_id
    FROM observation_sighting WHERE subject_id IS NOT NULL ORDER BY subject_id,last_seen_at DESC
), deltas AS (
    SELECT subject_id,to_place_id place_id,quantity delta FROM movement
    UNION ALL SELECT subject_id,from_place_id,-quantity FROM movement
), current_ledger AS (
    SELECT d.subject_id,ip.pool_id,SUM(d.delta)::bigint quantity FROM deltas d JOIN inventory_place ip ON ip.id=d.place_id
    WHERE ip.kind='OPERATIONAL' GROUP BY d.subject_id,ip.pool_id HAVING SUM(d.delta)>0
)
SELECT o.subject_id,o.epc,o.pool_id observed_pool,o.last_seen_at,o.device_id,c.pool_id ledger_pool,c.quantity
FROM latest_observation o JOIN current_ledger c ON c.subject_id=o.subject_id WHERE c.pool_id<>o.pool_id
ORDER BY o.last_seen_at DESC;"

Q "observation-anomalies (projection instead of ledger rebuild)" "
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
WITH latest_observation AS (
    SELECT DISTINCT ON (subject_id) subject_id,epc,pool_id,last_seen_at,device_id
    FROM observation_sighting WHERE subject_id IS NOT NULL ORDER BY subject_id,last_seen_at DESC
)
SELECT o.subject_id,o.epc,o.pool_id observed_pool,o.last_seen_at,o.device_id,
       ip.pool_id ledger_pool,pr.quantity
FROM latest_observation o
JOIN inventory_projection pr ON pr.subject_id = o.subject_id
JOIN inventory_place ip ON ip.id = pr.place_id AND ip.kind = 'OPERATIONAL'
WHERE ip.pool_id <> o.pool_id
ORDER BY o.last_seen_at DESC;"

# 3. sales explorer range (reports.rs:487) — sanity that this one is fine
Q "sales-explorer range (sanity)" "
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
SELECT count(*) FROM edge_sale
 WHERE occurred_at >= TIMESTAMPTZ '2025-06-01 00:00+07'
   AND occurred_at <  TIMESTAMPTZ '2025-07-01 00:00+07';"

# 4. fleet risk window (queries.rs:224 observed_raw part)
Q "fleet risk observed window (sanity)" "
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
SELECT pool_id,COUNT(DISTINCT COALESCE(subject_id::text,epc))::bigint quantity
  FROM observation_sighting
 WHERE last_seen_at > TIMESTAMPTZ '2025-12-01 00:00+07' - interval '24 hours'
   AND last_seen_at <= TIMESTAMPTZ '2025-12-01 00:00+07'
 GROUP BY pool_id;"

# 5. pools lost-risk: derived opening (balance - window) vs full-ledger replay.
#    Parity must be 0 at the rollup level POOL_ROWS consumes (COALESCE per pool).
Q "pools-risk parity (drift must be 0)" "
WITH old_risk AS (
    SELECT side.pool_id, SUM(side.opening)::bigint opening,
           SUM(side.inbound)::bigint inbound, SUM(side.lost)::bigint lost
      FROM movement
      CROSS JOIN LATERAL (VALUES
        (CASE WHEN movement.to_place_id LIKE '%:on_hand' THEN left(movement.to_place_id,-8) END,
         CASE WHEN movement.occurred_at < now() - interval '30 days' THEN movement.quantity ELSE 0 END,
         CASE WHEN movement.occurred_at >= now() - interval '30 days' THEN movement.quantity ELSE 0 END,
         0::bigint),
        (CASE WHEN movement.from_place_id LIKE '%:on_hand'
                OR (movement.from_place_id LIKE '%:missing' AND movement.to_place_id='system/lost')
              THEN left(movement.from_place_id,-8) END,
         CASE WHEN movement.from_place_id LIKE '%:on_hand'
                AND movement.occurred_at < now() - interval '30 days'
              THEN -movement.quantity ELSE 0 END,
         0::bigint,
         CASE WHEN movement.from_place_id LIKE '%:missing' AND movement.to_place_id='system/lost'
                AND movement.occurred_at >= now() - interval '30 days' THEN movement.quantity ELSE 0 END)
      ) AS side(pool_id,opening,inbound,lost)
     WHERE movement.occurred_at <= now() AND side.pool_id IS NOT NULL
     GROUP BY side.pool_id
), balances AS (
    SELECT place.pool_id, place.state, SUM(pr.quantity)::bigint quantity
      FROM inventory_projection pr JOIN inventory_place place ON place.id = pr.place_id
     WHERE place.kind='OPERATIONAL' GROUP BY place.pool_id, place.state
), new_risk AS (
    SELECT op.id AS pool_id,
           (COALESCE((SELECT quantity FROM balances b
                       WHERE b.pool_id=op.id AND b.state='NORMAL'),0)
              - COALESCE(SUM(m.quantity) FILTER (WHERE m.to_place_id = op.id||':on_hand'),0)
              + COALESCE(SUM(m.quantity) FILTER (WHERE m.from_place_id = op.id||':on_hand'),0))::bigint opening,
           COALESCE(SUM(m.quantity) FILTER (WHERE m.to_place_id = op.id||':on_hand'),0)::bigint inbound,
           COALESCE(SUM(m.quantity) FILTER (WHERE m.from_place_id = op.id||':missing'
               AND m.to_place_id='system/lost'),0)::bigint lost
      FROM operational_pool op
      LEFT JOIN movement m
             ON m.occurred_at >= now() - interval '30 days' AND m.occurred_at <= now()
            AND (m.to_place_id = op.id||':on_hand'
                 OR m.from_place_id IN (op.id||':on_hand', op.id||':missing'))
     GROUP BY op.id
)
SELECT count(*) FROM (
  SELECT p.pool_id FROM (SELECT pool_id FROM old_risk UNION SELECT pool_id FROM new_risk) p
    LEFT JOIN old_risk o ON o.pool_id=p.pool_id
    LEFT JOIN new_risk n ON n.pool_id=p.pool_id
   WHERE COALESCE(o.opening,0)<>COALESCE(n.opening,0)
      OR COALESCE(o.inbound,0)<>COALESCE(n.inbound,0)
      OR COALESCE(o.lost,0)<>COALESCE(n.lost,0)) drift;"
