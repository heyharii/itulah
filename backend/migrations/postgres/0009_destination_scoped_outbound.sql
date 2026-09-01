-- Destination Store becomes part of physical placement after TO_STORE execution.
-- Generic stage rows remain aggregation parents only; inventory is held by leaf pools.

ALTER TABLE operational_pool
    ADD COLUMN is_placement BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN outbound_stage TEXT,
    ADD COLUMN destination_store_id TEXT REFERENCES site(id);

UPDATE operational_pool
SET is_placement = FALSE,
    outbound_stage = CASE pool_code
        WHEN 'PICKED' THEN 'PICKED'
        WHEN 'PACKED' THEN 'PACKED'
        WHEN 'SHIPMENT' THEN 'SHIPMENT'
        WHEN 'IN_TRANSIT' THEN 'IN_TRANSIT'
    END
WHERE id IN (
    'dc.outbound.picked',
    'dc.outbound.packed',
    'dc.outbound.shipment',
    'dc.outbound.in-transit'
);

INSERT INTO operational_pool (
    id, site_id, group_code, pool_code, label, display_order,
    is_placement, outbound_stage, destination_store_id
)
SELECT stage.prefix || '.' || store.id,
       'dc',
       'OUTBOUND',
       stage.pool_code,
       stage.label || ' / ' || store.name,
       stage.display_order,
       TRUE,
       stage.outbound_stage,
       store.id
FROM site store
CROSS JOIN (VALUES
    ('dc.outbound.picked', 'PICKED', 'PICKED', 'Picked', 40),
    ('dc.outbound.packed', 'PACKED', 'PACKED', 'Packed', 50),
    ('dc.outbound.shipment', 'SHIPMENT', 'SHIPMENT', 'Shipment', 60),
    ('dc.outbound.in-transit', 'IN_TRANSIT', 'IN_TRANSIT', 'In Transit', 70)
) AS stage(prefix, outbound_stage, pool_code, label, display_order)
WHERE store.kind = 'STORE'
ON CONFLICT (id) DO NOTHING;

ALTER TABLE operational_pool
    ADD CONSTRAINT operational_pool_outbound_shape_check CHECK (
        (outbound_stage IS NULL AND destination_store_id IS NULL AND is_placement)
        OR (
            group_code = 'OUTBOUND'
            AND outbound_stage IN ('PICKED', 'PACKED', 'SHIPMENT', 'IN_TRANSIT')
            AND (
                (NOT is_placement AND destination_store_id IS NULL)
                OR (is_placement AND destination_store_id IS NOT NULL)
            )
        )
    );
CREATE UNIQUE INDEX operational_pool_outbound_leaf_unique
    ON operational_pool(outbound_stage, destination_store_id)
    WHERE is_placement AND outbound_stage IS NOT NULL;

INSERT INTO inventory_place (id, kind, pool_id, state, is_company, is_saleable)
SELECT pool.id || ':on_hand', 'OPERATIONAL', pool.id, 'NORMAL', TRUE, FALSE
FROM operational_pool pool
WHERE pool.is_placement AND pool.outbound_stage IS NOT NULL
ON CONFLICT (id) DO NOTHING;
INSERT INTO inventory_place (id, kind, pool_id, state, is_company, is_saleable)
SELECT pool.id || ':missing', 'OPERATIONAL', pool.id, 'MISSING', TRUE, FALSE
FROM operational_pool pool
WHERE pool.is_placement AND pool.outbound_stage IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Existing greenfield demo balances predate destination-scoped placement. Preserve
-- immutable facts and append one explicit cutover movement into deterministic Store
-- leaves. New operational facts are destination-scoped from their first Pick.
CREATE TEMP TABLE outbound_leaf_cutover ON COMMIT DROP AS
WITH delta AS (
    SELECT subject_id, to_place_id place_id, quantity delta FROM movement
    UNION ALL
    SELECT subject_id, from_place_id place_id, -quantity delta FROM movement
), balance AS (
    SELECT delta.subject_id,
           place.id from_place_id,
           place.pool_id from_pool_id,
           place.state,
           SUM(delta.delta)::bigint quantity
    FROM delta
    JOIN inventory_place place ON place.id = delta.place_id
    WHERE place.pool_id IN (
        'dc.outbound.picked',
        'dc.outbound.packed',
        'dc.outbound.shipment',
        'dc.outbound.in-transit'
    )
    GROUP BY delta.subject_id, place.id, place.pool_id, place.state
    HAVING SUM(delta.delta) > 0
), stores AS (
    SELECT id,
           row_number() OVER (ORDER BY id) - 1 store_index,
           count(*) OVER () store_count
    FROM site WHERE kind = 'STORE'
), assigned AS (
    SELECT balance.*,
           COALESCE(provenance.destination_store_id, fallback.id) destination_store_id
    FROM balance
    LEFT JOIN LATERAL (
        SELECT line.destination_id destination_store_id
        FROM movement fact
        JOIN allotment_line line
          ON fact.reference_type = 'ALLOTMENT_LINE'
         AND fact.reference_id = line.id::text
        WHERE fact.subject_id = balance.subject_id
          AND line.destination_type = 'STORE'
        ORDER BY fact.fact_sequence DESC
        LIMIT 1
    ) provenance ON TRUE
    JOIN stores fallback
      ON fallback.store_index = mod(
          mod(hashtextextended(balance.subject_id::text, 6006), fallback.store_count)
          + fallback.store_count,
          fallback.store_count
      )
)
SELECT subject_id,
       quantity,
       from_place_id,
       from_pool_id,
       from_pool_id || '.' || destination_store_id ||
           CASE state WHEN 'MISSING' THEN ':missing' ELSE ':on_hand' END AS to_place_id,
       destination_store_id
FROM assigned;

INSERT INTO movement_group (
    id, cause, reason, reference_type, reference_id, actor_id,
    idempotency_key, payload_digest, occurred_at, recorded_at
)
SELECT md5('outbound-leaf-cutover-v1')::uuid,
       'PLACEMENT_CORRECTION',
       'Destination-scoped Outbound placement cutover',
       'MIGRATION',
       'OUTBOUND-STORE-CUTOVER',
       'system-migration',
       'outbound-leaf-cutover-v1',
       md5('outbound-leaf-cutover-v1'),
       now(),
       now()
WHERE EXISTS (SELECT 1 FROM outbound_leaf_cutover)
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO movement (
    movement_id, movement_group_id, subject_id, quantity,
    from_place_id, to_place_id, cause, reference_type, reference_id,
    idempotency_key, payload_digest, actor_id, occurred_at, recorded_at
)
SELECT md5('outbound-leaf-cutover:' || subject_id::text || ':' || from_place_id)::uuid,
       md5('outbound-leaf-cutover-v1')::uuid,
       subject_id,
       quantity,
       from_place_id,
       to_place_id,
       'PLACEMENT_CORRECTION',
       'MIGRATION',
       'OUTBOUND-STORE-CUTOVER',
       'outbound-leaf-cutover-v1',
       md5('outbound-leaf-cutover-v1'),
       'system-migration',
       now(),
       now()
FROM outbound_leaf_cutover
ON CONFLICT (movement_id) DO NOTHING;

-- Carry matching RFID evidence to the same destination leaf without changing Stock.
UPDATE observation_sighting observation
SET pool_id = split_part(cutover.to_place_id, ':', 1)
FROM outbound_leaf_cutover cutover
WHERE observation.subject_id = cutover.subject_id
  AND observation.pool_id = cutover.from_pool_id;

-- Projection remains disposable and is rebuilt from immutable facts.
DELETE FROM inventory_projection projection
USING inventory_place place
WHERE projection.place_id = place.id
  AND place.pool_id LIKE 'dc.outbound.%';
INSERT INTO inventory_projection(subject_id, place_id, quantity, last_fact_sequence, updated_at)
WITH delta AS (
    SELECT subject_id, to_place_id place_id, quantity delta, fact_sequence FROM movement
    UNION ALL
    SELECT subject_id, from_place_id place_id, -quantity delta, fact_sequence FROM movement
), balance AS (
    SELECT subject_id, place_id, SUM(delta)::bigint quantity, MAX(fact_sequence)::bigint sequence
    FROM delta GROUP BY subject_id, place_id HAVING SUM(delta) > 0
)
SELECT balance.subject_id, balance.place_id, balance.quantity, balance.sequence, now()
FROM balance
JOIN inventory_place place ON place.id = balance.place_id
WHERE place.kind = 'OPERATIONAL' AND place.pool_id LIKE 'dc.outbound.%'
ON CONFLICT(subject_id, place_id) DO UPDATE
SET quantity = EXCLUDED.quantity,
    last_fact_sequence = EXCLUDED.last_fact_sequence,
    updated_at = now();

-- A parent stage cannot be selected for new counts; retain historical rows only.
UPDATE official_count
SET pool_id = 'dc.outbound.packed.store-07'
WHERE pool_id = 'dc.outbound.packed' AND status <> 'CLOSED';

COMMENT ON COLUMN operational_pool.is_placement IS 'False for aggregation-only stage parents; only placement leaves may hold inventory.';
COMMENT ON COLUMN operational_pool.destination_store_id IS 'Required physical placement dimension for destination-scoped DC Outbound leaves.';
