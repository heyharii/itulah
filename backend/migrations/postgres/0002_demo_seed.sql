INSERT INTO site (id, name, kind, edge_node_id) VALUES
('dc', 'DC', 'DC', 'dc-edge-01');
INSERT INTO site (id, name, kind, edge_node_id)
SELECT format('store-%s', lpad(n::text, 2, '0')), format('Store %s', lpad(n::text, 2, '0')), 'STORE', format('store-edge-%s', lpad(n::text, 2, '0'))
FROM generate_series(1, 13) AS n;

INSERT INTO operational_pool (id, site_id, group_code, pool_code, label, display_order) VALUES
('dc.pending.unidentified', 'dc', 'PENDING', 'UNIDENTIFIED', 'Unidentified', 10),
('dc.pending.untagged', 'dc', 'PENDING', 'UNTAGGED', 'Untagged', 20),
('dc.warehouse', 'dc', 'WAREHOUSE', 'WAREHOUSE', 'Warehouse', 30),
('dc.outbound.picked', 'dc', 'OUTBOUND', 'PICKED', 'Picked', 40),
('dc.outbound.packed', 'dc', 'OUTBOUND', 'PACKED', 'Packed', 50),
('dc.outbound.shipment', 'dc', 'OUTBOUND', 'SHIPMENT', 'Shipment', 60),
('dc.outbound.in-transit', 'dc', 'OUTBOUND', 'IN_TRANSIT', 'In Transit', 70),
('dc.reject.dc', 'dc', 'REJECT', 'DC_REJECT', 'DC Reject', 80);

INSERT INTO operational_pool (id, site_id, group_code, pool_code, label, store_origin_site_id, display_order)
SELECT format('dc.reject.store-%s', lpad(n::text, 2, '0')), 'dc', 'REJECT', 'STORE_REJECT',
       format('Store %s', lpad(n::text, 2, '0')), format('store-%s', lpad(n::text, 2, '0')), 80 + n
FROM generate_series(1, 13) AS n;

INSERT INTO operational_pool (id, site_id, group_code, pool_code, label, display_order)
SELECT site_id || suffix, site_id, group_code, pool_code, label, display_order
FROM (
    SELECT format('store-%s', lpad(n::text, 2, '0')) AS site_id FROM generate_series(1, 13) AS n
) stores
CROSS JOIN (VALUES
    ('.warehouse', 'STORE_INVENTORY', 'WAREHOUSE', 'Warehouse', 10),
    ('.floor', 'STORE_INVENTORY', 'FLOOR', 'Floor', 20),
    ('.reject', 'REJECT', 'REJECT', 'Reject', 30)
) AS kinds(suffix, group_code, pool_code, label, display_order);

INSERT INTO inventory_place (id, kind, pool_id, state, is_company, is_saleable)
SELECT id || ':on_hand', 'OPERATIONAL', id, 'ON_HAND', TRUE, pool_code = 'FLOOR'
FROM operational_pool;
INSERT INTO inventory_place (id, kind, pool_id, state, is_company, is_saleable)
SELECT id || ':missing', 'OPERATIONAL', id, 'MISSING', TRUE, FALSE
FROM operational_pool;
INSERT INTO inventory_place (id, kind, code, is_company, is_saleable) VALUES
('external/supplier', 'EXTERNAL', 'SUPPLIER', FALSE, FALSE),
('external/customer', 'EXTERNAL', 'CUSTOMER', FALSE, FALSE),
('external/disposal', 'EXTERNAL', 'DISPOSAL', FALSE, FALSE),
('system/opening', 'SYSTEM', 'OPENING', FALSE, FALSE),
('system/count_gain', 'SYSTEM', 'COUNT_GAIN', FALSE, FALSE),
('system/lost', 'SYSTEM', 'LOST', FALSE, FALSE);

INSERT INTO article (id, article_code, name) VALUES
(md5('article:1')::uuid, 'ART-TSHIRT', 'Essential T-Shirt'),
(md5('article:2')::uuid, 'ART-DENIM', 'Straight Denim'),
(md5('article:3')::uuid, 'ART-HOODIE', 'Everyday Hoodie'),
(md5('article:4')::uuid, 'ART-SHOES', 'Runner Shoes'),
(md5('article:5')::uuid, 'ART-JACKET', 'Light Jacket'),
(md5('article:6')::uuid, 'ART-CAP', 'Classic Cap');

INSERT INTO sku (id, article_id, sku_code, color, size)
SELECT md5('sku:' || n)::uuid,
       md5('article:' || (((n - 1) / 3) + 1))::uuid,
       format('SKU-%s-%s', lpad((((n - 1) / 3) + 1)::text, 2, '0'), (ARRAY['S','M','L'])[((n - 1) % 3) + 1]),
       (ARRAY['Black','Navy','Natural'])[((n - 1) % 3) + 1],
       (ARRAY['S','M','L'])[((n - 1) % 3) + 1]
FROM generate_series(1, 18) AS n;

CREATE FUNCTION seed_target_pool(n integer) RETURNS text IMMUTABLE AS $$
    SELECT CASE
        WHEN n <= 900 THEN 'dc.warehouse'
        WHEN n <= 1050 THEN 'dc.outbound.picked'
        WHEN n <= 1200 THEN 'dc.outbound.packed'
        WHEN n <= 1320 THEN 'dc.outbound.shipment'
        WHEN n <= 1440 THEN 'dc.outbound.in-transit'
        WHEN n <= 1480 THEN 'dc.reject.dc'
        WHEN n <= 1545 THEN format('dc.reject.store-%s', lpad((((n - 1481) % 13) + 1)::text, 2, '0'))
        ELSE format('store-%s.%s',
            lpad((((n - 1546) % 13) + 1)::text, 2, '0'),
            CASE WHEN n % 10 < 7 THEN 'floor' WHEN n % 10 < 9 THEN 'warehouse' ELSE 'reject' END)
    END
$$ LANGUAGE sql;

INSERT INTO inventory_subject (id, subject_type, sku_id, epc, barcode, quantity, uom, created_at)
SELECT md5('subject:' || n)::uuid, 'UNIT', md5('sku:' || (((n - 1) % 18) + 1))::uuid,
       format('EPC%s', lpad(n::text, 8, '0')), format('899%s', lpad(n::text, 10, '0')), 1, 'EA', now() - interval '70 days'
FROM generate_series(1, 3600) AS n;

INSERT INTO inventory_subject (id, subject_type, sku_id, barcode, quantity, uom, created_at)
SELECT md5('quantity-subject:' || n)::uuid, 'QUANTITY', md5('sku:' || (((n - 1) % 18) + 1))::uuid,
       format('QTY%s', lpad(n::text, 5, '0')), 100 + n, 'EA', now() - interval '70 days'
FROM generate_series(1, 24) AS n;

INSERT INTO movement_group (id, cause, reason, reference_type, reference_id, actor_id, idempotency_key, payload_digest, occurred_at, recorded_at)
VALUES (md5('seed-opening-group')::uuid, 'OPENING', 'Deterministic V1 demo opening inventory', 'SEED', 'V1', 'system-seed', 'seed-opening-v1', md5('seed-opening-v1'), now() - interval '60 days', now() - interval '60 days');

INSERT INTO movement (movement_id, movement_group_id, subject_id, quantity, from_place_id, to_place_id, cause, reference_type, reference_id, idempotency_key, payload_digest, actor_id, occurred_at, recorded_at)
SELECT md5('opening-movement:' || n)::uuid, md5('seed-opening-group')::uuid, md5('subject:' || n)::uuid, 1,
       'system/opening', seed_target_pool(n) || ':on_hand', 'OPENING', 'SEED', 'V1', 'seed-opening-v1', md5('seed-opening-v1'), 'system-seed',
       now() - interval '60 days' + n * interval '1 second', now() - interval '60 days' + n * interval '1 second'
FROM generate_series(1, 3600) AS n;

INSERT INTO movement (movement_id, movement_group_id, subject_id, quantity, from_place_id, to_place_id, cause, reference_type, reference_id, idempotency_key, payload_digest, actor_id, occurred_at, recorded_at)
SELECT md5('opening-quantity-movement:' || n)::uuid, md5('seed-opening-group')::uuid, md5('quantity-subject:' || n)::uuid, 100 + n,
       'system/opening', 'dc.warehouse:on_hand', 'OPENING', 'SEED', 'V1', 'seed-opening-v1', md5('seed-opening-v1'), 'system-seed',
       now() - interval '60 days' + n * interval '1 second', now() - interval '60 days' + n * interval '1 second'
FROM generate_series(1, 24) AS n;

-- A real multi-step movement history for ten EPCs, using one atomic group per business step.
INSERT INTO movement_group (id, cause, reason, reference_type, reference_id, actor_id, idempotency_key, payload_digest, occurred_at, recorded_at)
SELECT md5('seed-chain-group:' || step)::uuid, 'NORMAL_MOVE', 'Seed outbound flow', 'DEMO_FLOW', 'FLOW-001', 'demo-operator',
       'seed-chain-' || step, md5('seed-chain-' || step), now() - ((12 - step) || ' days')::interval, now() - ((12 - step) || ' days')::interval
FROM generate_series(1, 7) AS step;

WITH stages AS (
    SELECT * FROM (VALUES
      (1, 'dc.warehouse:on_hand', 'dc.outbound.picked:on_hand'),
      (2, 'dc.outbound.picked:on_hand', 'dc.outbound.packed:on_hand'),
      (3, 'dc.outbound.packed:on_hand', 'dc.outbound.shipment:on_hand'),
      (4, 'dc.outbound.shipment:on_hand', 'dc.outbound.in-transit:on_hand'),
      (5, 'dc.outbound.in-transit:on_hand', 'store-07.warehouse:on_hand')
    ) AS s(step, from_place, to_place)
)
INSERT INTO movement (movement_id, movement_group_id, subject_id, quantity, from_place_id, to_place_id, cause, reference_type, reference_id, idempotency_key, payload_digest, actor_id, occurred_at, recorded_at)
SELECT md5(format('seed-chain-movement:%s:%s', step, n))::uuid, md5('seed-chain-group:' || step)::uuid, md5('subject:' || n)::uuid, 1,
       from_place, to_place, 'NORMAL_MOVE', 'DEMO_FLOW', 'FLOW-001', 'seed-chain-' || step, md5('seed-chain-' || step), 'demo-operator',
       now() - ((12 - step) || ' days')::interval, now() - ((12 - step) || ' days')::interval
FROM stages CROSS JOIN generate_series(1, 10) AS n;

INSERT INTO movement (movement_id, movement_group_id, subject_id, quantity, from_place_id, to_place_id, cause, reference_type, reference_id, idempotency_key, payload_digest, actor_id, occurred_at, recorded_at)
SELECT md5('seed-chain-floor:' || n)::uuid, md5('seed-chain-group:6')::uuid, md5('subject:' || n)::uuid, 1,
       'store-07.warehouse:on_hand', 'store-07.floor:on_hand', 'NORMAL_MOVE', 'DEMO_FLOW', 'FLOW-001', 'seed-chain-6', md5('seed-chain-6'), 'store-07-operator',
       now() - interval '6 days', now() - interval '6 days'
FROM generate_series(1, 5) AS n;

-- Current Missing remains attached to the exact operational pool where shortage was proven.
INSERT INTO movement_group (id, cause, reason, reference_type, reference_id, actor_id, idempotency_key, payload_digest, occurred_at, recorded_at)
VALUES (md5('seed-shortage-group')::uuid, 'COUNT_SHORTAGE', 'Approved demo cycle-count shortages', 'OFFICIAL_COUNT', 'COUNT-SEED-01', 'count-supervisor', 'seed-shortages-v1', md5('seed-shortages-v1'), now() - interval '14 days', now() - interval '14 days');

INSERT INTO movement (movement_id, movement_group_id, subject_id, quantity, from_place_id, to_place_id, cause, reference_type, reference_id, idempotency_key, payload_digest, actor_id, occurred_at, recorded_at)
SELECT md5('seed-shortage:' || n)::uuid, md5('seed-shortage-group')::uuid, md5('subject:' || n)::uuid, 1,
       seed_target_pool(n) || ':on_hand', seed_target_pool(n) || ':missing', 'COUNT_SHORTAGE', 'OFFICIAL_COUNT', 'COUNT-SEED-01',
       'seed-shortages-v1', md5('seed-shortages-v1'), 'count-supervisor', now() - interval '14 days', now() - interval '14 days'
FROM generate_series(173, 3600, 173) AS n
WHERE n > 10;

-- A subset of those shortages is finalized as Lost, retaining its source pool on the movement fact.
INSERT INTO movement_group (id, cause, reason, reference_type, reference_id, actor_id, idempotency_key, payload_digest, occurred_at, recorded_at)
VALUES (md5('seed-lost-group')::uuid, 'CONFIRMED_LOST', 'Investigation completed; inventory confirmed lost', 'INVESTIGATION', 'LOSS-SEED-01', 'loss-supervisor', 'seed-lost-v1', md5('seed-lost-v1'), now() - interval '4 days', now() - interval '4 days');

INSERT INTO movement (movement_id, movement_group_id, subject_id, quantity, from_place_id, to_place_id, cause, reference_type, reference_id, idempotency_key, payload_digest, actor_id, occurred_at, recorded_at)
SELECT md5('seed-lost:' || n)::uuid, md5('seed-lost-group')::uuid, md5('subject:' || n)::uuid, 1,
       seed_target_pool(n) || ':missing', 'system/lost', 'CONFIRMED_LOST', 'INVESTIGATION', 'LOSS-SEED-01',
       'seed-lost-v1', md5('seed-lost-v1'), 'loss-supervisor', now() - interval '4 days', now() - interval '4 days'
FROM generate_series(519, 3600, 519) AS n
WHERE n > 10;

-- Projection is generated from ledger deltas, never authored as an independent stock truth.
INSERT INTO inventory_projection (subject_id, place_id, quantity, last_fact_sequence, updated_at)
WITH deltas AS (
    SELECT subject_id, to_place_id AS place_id, quantity, fact_sequence FROM movement
    UNION ALL
    SELECT subject_id, from_place_id AS place_id, -quantity, fact_sequence FROM movement
), balances AS (
    SELECT subject_id, place_id, sum(quantity)::bigint AS quantity, max(fact_sequence) AS last_fact_sequence
    FROM deltas GROUP BY subject_id, place_id
)
SELECT b.subject_id, b.place_id, b.quantity, b.last_fact_sequence, now()
FROM balances b JOIN inventory_place p ON p.id = b.place_id
WHERE p.kind = 'OPERATIONAL' AND b.quantity > 0;

-- RFID evidence: mostly matching, with deliberate same-store Floor/Warehouse mismatches.
WITH expected AS (
    SELECT n, seed_target_pool(n) AS expected_pool,
           split_part(seed_target_pool(n), '.', 1) AS site_id
    FROM generate_series(1600, 2200) AS n
    WHERE seed_target_pool(n) LIKE 'store-%' AND seed_target_pool(n) NOT LIKE '%.reject'
), observed AS (
    SELECT *, CASE
        WHEN n % 97 = 0 AND expected_pool LIKE '%.floor' THEN replace(expected_pool, '.floor', '.warehouse')
        WHEN n % 97 = 0 AND expected_pool LIKE '%.warehouse' THEN replace(expected_pool, '.warehouse', '.floor')
        ELSE expected_pool END AS observed_pool
    FROM expected
)
INSERT INTO observation_sighting (observation_id, subject_id, epc, site_id, pool_id, first_seen_at, last_seen_at, received_at, device_id, reader_session_id, method, read_count, best_rssi)
SELECT md5('observation:' || n)::uuid, md5('subject:' || n)::uuid, format('EPC%s', lpad(n::text, 8, '0')), site_id, observed_pool,
       now() - ((n % 20) || ' hours')::interval, now() - ((n % 20) || ' hours')::interval,
       now() - ((n % 20) || ' hours')::interval + interval '5 seconds', upper(site_id) || '-RFID-01', 'SEED-SESSION', 'RFID_HANDHELD', 1 + (n % 20), -42.0 - (n % 20)
FROM observed;

-- Compact official-count history and an active count for the operations screen.
INSERT INTO official_count (id, site_id, pool_id, kind, status, scope_json, reason, created_by, created_at, activated_at, submitted_at, closed_at)
VALUES
(md5('count:closed')::uuid, 'store-04', 'store-04.floor', 'CYCLE', 'CLOSED', '{"sku_ids":[]}'::jsonb, 'Weekly cycle count', 'store-04-lead', now() - interval '21 days', now() - interval '20 days', now() - interval '20 days' + interval '2 hours', now() - interval '20 days' + interval '3 hours'),
(md5('count:active')::uuid, 'store-09', 'store-09.floor', 'FULL', 'ACTIVE', '{}'::jsonb, 'Monthly floor count', 'store-09-lead', now() - interval '2 hours', now() - interval '1 hour', NULL, NULL),
(md5('count:review')::uuid, 'dc', 'dc.outbound.packed', 'TARGETED', 'REVIEW', '{"epcs":[]}'::jsonb, 'Outbound spot check', 'dc-lead', now() - interval '1 day', now() - interval '23 hours', now() - interval '20 hours', NULL);

WITH candidates AS (
    SELECT p.subject_id, p.quantity, row_number() OVER (ORDER BY p.subject_id) AS rn
    FROM inventory_projection p WHERE p.place_id = 'store-04.floor:on_hand' LIMIT 20
)
INSERT INTO count_snapshot (count_id, subject_id, expected_quantity, expected_place_id)
SELECT md5('count:closed')::uuid, subject_id, quantity, 'store-04.floor:on_hand' FROM candidates;

INSERT INTO count_entry (count_id, subject_id, found_quantity, recorded_by, recorded_at)
SELECT count_id, subject_id, expected_quantity, 'store-04-counter', now() - interval '20 days' + interval '90 minutes'
FROM count_snapshot WHERE count_id = md5('count:closed')::uuid;

DROP FUNCTION seed_target_pool(integer);
