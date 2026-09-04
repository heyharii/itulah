-- Dev-only sales, so the fleet screens have something to draw.
--
-- Written the way the till writes one, because the schema insists: a sale is
-- OPEN while its lines and tenders are appended, and only then completed.
-- Triggers enforce both halves.
--
-- Every row is marked SEED- in its sale_number, so:
--   DELETE FROM sale_payment WHERE sale_id IN (SELECT id FROM sale WHERE sale_number LIKE 'SEED-%');
--   DELETE FROM sale_line    WHERE sale_id IN (SELECT id FROM sale WHERE sale_number LIKE 'SEED-%');
--   DELETE FROM sale         WHERE sale_number LIKE 'SEED-%';
-- takes it back out (the delete triggers have to be dropped first — sales are
-- immutable by design).
BEGIN;

CREATE TEMP TABLE seed_ctx AS
SELECT (SELECT id FROM commercial_publication WHERE status='PUBLISHED' ORDER BY version DESC LIMIT 1) AS pub_id,
       (SELECT version FROM commercial_publication WHERE status='PUBLISHED' ORDER BY version DESC LIMIT 1) AS pub_version,
       (SELECT id FROM movement_group LIMIT 1) AS mg_id;

CREATE TEMP TABLE seed_subject AS
SELECT id, sku_id, (row_number() OVER (ORDER BY id) - 1) AS slot
FROM inventory_subject WHERE sku_id IS NOT NULL LIMIT 200;

CREATE TEMP TABLE seed_sale AS
WITH sites AS (
  SELECT id AS site_id, row_number() OVER (ORDER BY id) AS rank
  FROM site WHERE kind='STORE'
),
days AS (
  SELECT (current_date - offset_days)::date AS day
  FROM generate_series(0, 420) AS offset_days
),
receipts AS (
  SELECT s.site_id, s.rank, d.day,
         generate_series(1, 2 + (random() * 4)::int) AS seq
  FROM sites s CROSS JOIN days d
)
SELECT gen_random_uuid() AS id,
       r.site_id,
       r.day,
       r.seq,
       r.day + time '09:00' + (random() * interval '11 hours') AS ts,
       -- A fleet with a shape: the first shops take several times what the
       -- last ones do, weekends lift everything, and the trend drifts up over
       -- the year so a "vs previous" arrow has something to say.
       (
         (900000 - r.rank * 55000)
         * (0.75 + random() * 0.5)
         * CASE WHEN extract(dow FROM r.day) IN (0, 6) THEN 1.45 ELSE 1.0 END
         * (1.0 + (420 - (current_date - r.day)) * 0.0004)
       )::bigint AS total_minor,
       (1 + (random() * 3)::int) AS units
FROM receipts r;

INSERT INTO sale (
  id, sale_number, site_id, channel, status,
  commercial_publication_id, commercial_version, currency,
  net_minor, tax_minor, total_minor, paid_minor, change_minor,
  actor_id, idempotency_key, created_at
)
SELECT s.id,
       'SEED-' || s.site_id || '-' || to_char(s.day, 'YYYYMMDD') || '-' || s.seq,
       s.site_id, 'STORE', 'OPEN',
       c.pub_id, c.pub_version, 'IDR',
       (s.total_minor * 100 / 111)::bigint,
       s.total_minor - (s.total_minor * 100 / 111)::bigint,
       s.total_minor, s.total_minor, 0,
       'seed', 'seed-sale-' || s.id::text, s.ts
FROM seed_sale s CROSS JOIN seed_ctx c;

-- One line per receipt, against a real subject so the sheet's units column is
-- not a zero. Subjects are reused across receipts, which the schema allows —
-- the uniqueness is per sale.
INSERT INTO sale_line (
  id, sale_id, subject_id, sku_id, quantity,
  unit_price_minor, net_minor, tax_minor, total_minor, currency,
  tax_category, tax_rate_bps, tax_inclusive,
  commercial_publication_id, commercial_version, price_snapshot_digest,
  actor_id, idempotency_key, added_at
)
SELECT gen_random_uuid(), s.id, sub.id, sub.sku_id, s.units,
       (s.total_minor / s.units)::bigint,
       (s.total_minor * 100 / 111)::bigint,
       s.total_minor - (s.total_minor * 100 / 111)::bigint,
       s.total_minor, 'IDR',
       'STANDARD', 1100, true,
       c.pub_id, c.pub_version, 'seed',
       'seed', 'seed-line-' || s.id::text, s.ts
FROM seed_sale s
CROSS JOIN seed_ctx c
JOIN seed_subject sub ON sub.slot = (abs(hashtext(s.id::text)) % 200);

-- Tendered, so the drill-down sheet has a drawer to add up.
INSERT INTO sale_payment (id, sale_id, method, amount_minor, actor_id, idempotency_key, recorded_at)
SELECT gen_random_uuid(), s.id,
       (ARRAY['CASH','CARD','QRIS'])[1 + (abs(hashtext(s.id::text)) % 3)],
       s.total_minor, 'seed', 'seed-pay-' || s.id::text, s.ts
FROM seed_sale s;

UPDATE sale
SET status = 'COMPLETED',
    completed_at = s.ts,
    movement_group_id = c.mg_id
FROM seed_sale s, seed_ctx c
WHERE sale.id = s.id;

COMMIT;
