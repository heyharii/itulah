-- Dev-only sales history per store and SKU, so New allotment's Sales report
-- (Qty | Sales per store, 30/90 days) has something to read.
--
--   psql postgresql:///sim_rig_demo -v ON_ERROR_STOP=1 -f scripts/seed-allotment-sales.sql
--
-- What it writes, on the centre's database only:
--   * one QUANTITY inventory_subject per SKU (barcode 'SEED-SALES'), because
--     a sale line must name a subject and the centre holds none of its own —
--     the pieces live on the edge nodes;
--   * one movement_group, because a COMPLETED sale must carry one;
--   * one receipt per (store, SKU, day) that sold, one line, one tender,
--     dated 7 to 90 days ago.
--
-- Why never the last six days: the cloud's `sale_day` job closes the previous
-- six trading days into the books every hour. Days older than that are left
-- alone, so this history never reaches the journal, the P&L or COGS.
--
-- The shape: the first stores sell several times what the last ones do,
-- weekends lift, and each SKU has its own pull, so the report does not read
-- as noise. Prices are the SKU's published price (falling back to Rp 99.000).
--
-- Re-runnable: it does nothing if its sales are already there. Sales are
-- immutable by design, so taking them back out means dropping the
-- append-only triggers first; every row is marked SEED-AS- in sale_number.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sale WHERE sale_number LIKE 'SEED-AS-%') THEN
    RAISE NOTICE 'seed-allotment-sales: already seeded, nothing to do';
  END IF;
END $$;

CREATE TEMP TABLE seed_as_ctx ON COMMIT DROP AS
SELECT pub.id AS pub_id, pub.version AS pub_version
FROM commercial_publication pub
WHERE pub.status = 'PUBLISHED'
  AND NOT EXISTS (SELECT 1 FROM sale WHERE sale_number LIKE 'SEED-AS-%')
ORDER BY pub.version DESC
LIMIT 1;

-- One subject per SKU, reused across every receipt of that SKU.
CREATE TEMP TABLE seed_as_sku ON COMMIT DROP AS
SELECT s.id AS sku_id,
       gen_random_uuid() AS subject_id,
       COALESCE(
         (SELECT r.unit_price_minor
          FROM commercial_price_rule r
          JOIN commercial_publication p ON p.id = r.publication_id
          WHERE r.sku_id = s.id AND p.status = 'PUBLISHED'
          ORDER BY p.version DESC
          LIMIT 1),
         99000
       ) AS price,
       -- How well this SKU sells anywhere: 0.4 .. 1.6.
       0.4 + (abs(hashtext(s.id::text)) % 1000) / 1000.0 * 1.2 AS pull
FROM sku s
WHERE EXISTS (SELECT 1 FROM seed_as_ctx);

INSERT INTO inventory_subject (id, subject_type, sku_id, barcode, quantity, uom)
SELECT subject_id, 'QUANTITY', sku_id, 'SEED-SALES', 1, 'PCS'
FROM seed_as_sku;

CREATE TEMP TABLE seed_as_mg ON COMMIT DROP AS
SELECT gen_random_uuid() AS id
WHERE EXISTS (SELECT 1 FROM seed_as_ctx);

INSERT INTO movement_group (
  id, cause, reason, reference_type, reference_id,
  actor_id, idempotency_key, payload_digest, occurred_at
)
SELECT id, 'SALE', 'Seed: sales history for the allotment report', 'SEED',
       'seed-allotment-sales', 'seed', 'seed-allotment-sales', 'seed', now()
FROM seed_as_mg;

CREATE TEMP TABLE seed_as_sale ON COMMIT DROP AS
WITH stores AS (
  SELECT id AS site_id, row_number() OVER (ORDER BY id) AS rank,
         count(*) OVER () AS stores
  FROM site WHERE kind = 'STORE'
),
days AS (
  SELECT (current_date - back)::date AS day
  FROM generate_series(7, 90) AS back
),
tries AS (
  SELECT st.site_id, st.rank, st.stores, d.day, k.sku_id, k.price, k.pull
  FROM stores st CROSS JOIN days d CROSS JOIN seed_as_sku k
)
SELECT gen_random_uuid() AS id,
       t.site_id, t.day, t.sku_id, t.price,
       (1 + (random() < 0.25)::int) AS units,
       ((t.day + time '09:30' + random() * interval '11 hours')
         AT TIME ZONE 'Asia/Jakarta') AS ts
FROM tries t
WHERE random() < 0.09 * t.pull
                 * (1.6 - 1.2 * (t.rank - 1)::numeric / greatest(t.stores - 1, 1))
                 * CASE WHEN extract(dow FROM t.day) IN (0, 6) THEN 1.5 ELSE 1.0 END;

INSERT INTO sale (
  id, sale_number, site_id, channel, status,
  commercial_publication_id, commercial_version, currency,
  net_minor, tax_minor, total_minor, paid_minor, change_minor,
  actor_id, idempotency_key, created_at
)
SELECT s.id,
       'SEED-AS-' || s.site_id || '-' || to_char(s.day, 'YYYYMMDD') || '-' || left(s.id::text, 8),
       s.site_id, 'STORE', 'OPEN',
       c.pub_id, c.pub_version, 'IDR',
       (s.price * s.units * 100 / 111)::bigint,
       s.price * s.units - (s.price * s.units * 100 / 111)::bigint,
       s.price * s.units, s.price * s.units, 0,
       'seed', 'seed-as-sale-' || s.id::text, s.ts
FROM seed_as_sale s CROSS JOIN seed_as_ctx c;

INSERT INTO sale_line (
  id, sale_id, subject_id, sku_id, quantity,
  unit_price_minor, net_minor, tax_minor, total_minor, currency,
  tax_category, tax_rate_bps, tax_inclusive,
  commercial_publication_id, commercial_version, price_snapshot_digest,
  actor_id, idempotency_key, added_at
)
SELECT gen_random_uuid(), s.id, k.subject_id, s.sku_id, s.units,
       s.price,
       (s.price * s.units * 100 / 111)::bigint,
       s.price * s.units - (s.price * s.units * 100 / 111)::bigint,
       s.price * s.units, 'IDR',
       'STANDARD', 1100, true,
       c.pub_id, c.pub_version, 'seed',
       'seed', 'seed-as-line-' || s.id::text, s.ts
FROM seed_as_sale s
JOIN seed_as_sku k ON k.sku_id = s.sku_id
CROSS JOIN seed_as_ctx c;

INSERT INTO sale_payment (id, sale_id, method, amount_minor, actor_id, idempotency_key, recorded_at)
SELECT gen_random_uuid(), s.id,
       (ARRAY['CASH', 'CARD', 'QRIS'])[1 + (abs(hashtext(s.id::text)) % 3)],
       s.price * s.units, 'seed', 'seed-as-pay-' || s.id::text, s.ts
FROM seed_as_sale s;

UPDATE sale
SET status = 'COMPLETED', completed_at = s.ts, movement_group_id = mg.id
FROM seed_as_sale s CROSS JOIN seed_as_mg mg
WHERE sale.id = s.id;

SELECT 'seed-allotment-sales: ' || count(*) || ' receipts over '
       || count(DISTINCT site_id) || ' stores'
FROM seed_as_sale;

COMMIT;
