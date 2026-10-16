-- Dev-only stock history for the stores the centre itself keeps the books of,
-- so Inventory › Stock, a store's Movements tab and Counts have something to
-- read on a demo rig.
--
--   psql postgresql:///sim_rig_demo -v ON_ERROR_STOP=1 -f scripts/seed-inventory-demo.sql
--
-- Only stores with no edge node (every store but store-01 on the demo rig):
-- their ledger is the centre's, so the stock written here is the stock the
-- fleet read shows, not a shadow under somebody else's numbers. Head office
-- and store-01 keep their books on their own nodes and are left alone.
--
-- What it writes, per store 02–09, ten SKUs each:
--   * one tagged UNIT inventory_subject per piece (EPC SEED…, barcode
--     'SEED-INV') — counts read tags, so a piece without one cannot be counted;
--   * OPENING into the stockroom 30 days ago;
--   * part of it moved to the floor 21 days ago;
--   * SALE off the floor on four days in the last two weeks;
--   * now and then a CUSTOMER_RETURN back onto the floor;
--   * the projection rebuilt for those subjects;
--   * a handheld sweep a few hours ago that read about 29 in 30 of them.
--
-- Missing (the exceptions) is NOT written here: scripts/seed-inventory-demo.py
-- runs real counts through the API afterwards, and approving one is what books
-- a shortage — the same rows the apps would leave.
--
-- Re-runnable: does nothing if its subjects are already there.
BEGIN;

DO $$
BEGIN
  IF current_database() NOT LIKE 'sim_rig_%' THEN
    RAISE EXCEPTION 'seed-inventory-demo: refusing to write to % (not a sim_rig_* database)', current_database();
  END IF;
END $$;

CREATE TEMP TABLE seed_inv_store ON COMMIT DROP AS
SELECT format('store-%s', lpad(n::text, 2, '0')) AS site_id, n
FROM generate_series(2, 9) AS n
WHERE NOT EXISTS (SELECT 1 FROM inventory_subject WHERE barcode = 'SEED-INV')
  AND NOT EXISTS (
    SELECT 1 FROM edge_inventory_pool e
    WHERE e.origin_id = format('store-%s', lpad(n::text, 2, '0'))
  );

-- Ten SKUs per store, a different ten for each store, with an opening of 6–20,
-- and how many of them each step moves: 60% to the floor, four small sales
-- off the floor (never more than the floor holds) and one return.
CREATE TEMP TABLE seed_inv_line ON COMMIT DROP AS
SELECT st.site_id, st.n, s.id AS sku_id, s.sku_code,
       6 + abs(hashtext(st.site_id || s.id::text)) % 15 AS opening,
       abs(hashtext('q' || st.site_id || s.id::text)) AS h
FROM seed_inv_store st
CROSS JOIN LATERAL (
  SELECT id, sku_code FROM sku
  ORDER BY hashtext(st.site_id || id::text)
  LIMIT 10
) s;

-- One row per piece, with the step it is sold at (if any).
CREATE TEMP TABLE seed_inv_piece ON COMMIT DROP AS
SELECT l.site_id, l.n, l.sku_id, k,
       gen_random_uuid() AS subject_id,
       format('SEED%s%s%s', lpad(l.n::text, 2, '0'), l.sku_code, lpad(k::text, 3, '0')) AS epc,
       k <= f.to_floor AS on_floor,
       CASE
         WHEN k > f.to_floor THEN NULL
         WHEN k <= f.c1 THEN 'sale-1'
         WHEN k <= f.c2 THEN 'sale-2'
         WHEN k <= f.c3 THEN 'sale-3'
         WHEN k <= f.c4 THEN 'sale-4'
       END AS sold_at,
       k = 1 AND f.c1 >= 1 AND l.h % 4 = 0 AS comes_back
FROM seed_inv_line l
CROSS JOIN LATERAL (
  SELECT (l.opening * 6) / 10 AS to_floor,
         l.h % 3 AS c1,
         l.h % 3 + (l.h / 3) % 3 AS c2,
         l.h % 3 + (l.h / 3) % 3 + (l.h / 9) % 2 AS c3,
         l.h % 3 + (l.h / 3) % 3 + (l.h / 9) % 2 + (l.h / 27) % 2 AS c4
) f
CROSS JOIN generate_series(1, l.opening) AS k;

INSERT INTO inventory_subject (id, subject_type, sku_id, epc, barcode, quantity, uom)
SELECT subject_id, 'UNIT', sku_id, epc, 'SEED-INV', 1, 'PCS'
FROM seed_inv_piece;

-- One group per (store, step): a business step is one atomic group.
CREATE TEMP TABLE seed_inv_step ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('opening',  'OPENING',         30, 'Opening stock'),
  ('floor',    'NORMAL_MOVE',     21, 'Stockroom to floor'),
  ('sale-1',   'SALE',            13, 'Sales of the day'),
  ('sale-2',   'SALE',             9, 'Sales of the day'),
  ('sale-3',   'SALE',             5, 'Sales of the day'),
  ('return',   'CUSTOMER_RETURN',  4, 'Customer return'),
  ('sale-4',   'SALE',             2, 'Sales of the day')
) AS v(step, cause, days_ago, reason);

INSERT INTO movement_group (id, cause, reason, reference_type, reference_id, actor_id, idempotency_key, payload_digest, occurred_at, recorded_at)
SELECT md5(format('seed-inv-group:%s:%s', st.site_id, sp.step))::uuid,
       sp.cause, sp.reason, 'SEED-INV', st.site_id, 'system-seed',
       format('seed-inv:%s:%s', st.site_id, sp.step),
       md5(format('seed-inv:%s:%s', st.site_id, sp.step)),
       now() - make_interval(days => sp.days_ago) + make_interval(hours => 10 + st.n),
       now() - make_interval(days => sp.days_ago) + make_interval(hours => 10 + st.n)
FROM seed_inv_store st CROSS JOIN seed_inv_step sp;

INSERT INTO movement (movement_id, movement_group_id, subject_id, quantity, from_place_id, to_place_id, cause, reference_type, reference_id, idempotency_key, payload_digest, actor_id, occurred_at, recorded_at)
SELECT gen_random_uuid(), g.id, p.subject_id, 1, m.from_place, m.to_place,
       g.cause, 'SEED-INV', p.site_id, g.idempotency_key, g.payload_digest,
       'system-seed', g.occurred_at, g.recorded_at
FROM seed_inv_piece p
CROSS JOIN LATERAL (VALUES
  ('opening', true,                      'system/opening',                  p.site_id || '.warehouse:on_hand'),
  ('floor',   p.on_floor,                p.site_id || '.warehouse:on_hand', p.site_id || '.floor:on_hand'),
  (p.sold_at, p.sold_at IS NOT NULL,     p.site_id || '.floor:on_hand',     'external/customer'),
  ('return',  p.comes_back,              'external/customer',               p.site_id || '.floor:on_hand')
) AS m(step, happens, from_place, to_place)
JOIN movement_group g ON g.id = md5(format('seed-inv-group:%s:%s', p.site_id, m.step))::uuid
WHERE m.happens;

-- The projection, rebuilt for exactly these subjects, the way the ledger's
-- own write does it.
INSERT INTO inventory_projection (subject_id, place_id, quantity, last_fact_sequence, updated_at)
SELECT d.subject_id, d.place_id, SUM(d.delta)::bigint, MAX(d.seq)::bigint, now()
FROM (
  SELECT m.subject_id, m.to_place_id AS place_id, m.quantity AS delta, m.fact_sequence AS seq
  FROM movement m JOIN seed_inv_piece l ON l.subject_id = m.subject_id
  UNION ALL
  SELECT m.subject_id, m.from_place_id, -m.quantity, m.fact_sequence
  FROM movement m JOIN seed_inv_piece l ON l.subject_id = m.subject_id
) d
JOIN inventory_place ip ON ip.id = d.place_id AND ip.kind = 'OPERATIONAL'
GROUP BY d.subject_id, d.place_id
HAVING SUM(d.delta) > 0
ON CONFLICT (subject_id, place_id) DO UPDATE
SET quantity = EXCLUDED.quantity, last_fact_sequence = EXCLUDED.last_fact_sequence, updated_at = now();

SELECT count(*) AS pieces FROM seed_inv_piece;

COMMIT;

-- The handheld sweep: most pieces that sit on a shelf now were read in the
-- last few hours, so Observed beside Inventory is a real reading. About one
-- in thirty is not read — the gap a store would actually see. Runs on its own
-- guard, so a second run after the counts reads again only if nothing did.
BEGIN;

INSERT INTO observation_sighting (observation_id, subject_id, epc, site_id, pool_id, first_seen_at, last_seen_at, device_id, reader_session_id, method, read_count, operator_id)
SELECT gen_random_uuid(), s.id, s.epc, op.site_id, op.id,
       now() - interval '3 hours', now() - interval '2 hours',
       'RFID-HH-SEED', 'seed-sweep-' || op.site_id, 'RFID_HANDHELD',
       1 + abs(hashtext(s.epc)) % 5, 'system-seed'
FROM inventory_projection p
JOIN inventory_subject s ON s.id = p.subject_id AND s.barcode = 'SEED-INV'
JOIN inventory_place ip ON ip.id = p.place_id AND ip.id LIKE '%:on_hand'
JOIN operational_pool op ON op.id = ip.pool_id
WHERE p.quantity > 0
  AND abs(hashtext('seen' || s.epc)) % 30 <> 0
  AND NOT EXISTS (SELECT 1 FROM observation_sighting WHERE device_id = 'RFID-HH-SEED');

COMMIT;
