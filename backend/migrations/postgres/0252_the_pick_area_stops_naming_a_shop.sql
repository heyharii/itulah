-- The Pick Area stops naming a shop.
--
-- # What was found
--
-- INVENTORY-V1 §4 freezes the Pick Area as one shared shelf that names no
-- store, and INV-05 says why: picking fetches a SKU and a number, and which
-- piece serves which shop is settled when it goes into a carton. A pool that
-- names the shop before Pack asserts a decision nobody has taken.
--
-- The DC node has run that way since picking became a real movement --
-- `edge/outbound.rs` picks into `{dc}.outbound.picking`, and
-- `DcOutboundPicked` is never constructed anywhere under `backend/src/edge`;
-- it survives there only in a `matches!` that reads old facts and in a label
-- map. `FulfillmentStage` has four variants and PICKED is not one of them.
--
-- The centre held the opposite, and held it by accident. Its own state machine
-- already allows Warehouse -> Picking -> Packed
-- (`cloud/domain/movement.rs::normal_pool_transition`), but `dc.outbound.picking`
-- had no row in `operational_pool` at all, so that path could never be written:
-- the movement would have failed the `inventory_place` foreign key. What ran
-- instead was `execution_transition`, which sends every TO_STORE allotment
-- execution into `dc.outbound.picked.{store}` -- thirteen pools, each one
-- naming a destination that Pack had not yet chosen.
--
-- So the legacy spelling was the only one that existed, and the canonical one
-- was the one that did not.
--
-- # What this does
--
-- Files the shelf the centre was missing, moves what stands in the thirteen
-- legacy pools onto it, and retires them.
--
-- `PLACEMENT_CORRECTION` is the cause because nothing moved. The goods are on
-- the same floor of the same outbound area; what is corrected is the claim
-- about them, not where they are. `validate_transition` allows this cause
-- between any two on-hand places for exactly that reason, and every piece
-- standing in these pools today is on hand -- none is Missing.
--
-- The pools are retired, not deleted. Their movement history is immutable and
-- keyed by their places, so `picked.{store}` stays readable for as long as that
-- history does. Retiring only stops them being shelves anybody can write to:
-- the pool list, the placement-source lookup and the allotment source picker
-- all read `WHERE pool.active`.
--
-- The three remaining stage parents -- `packed`, `shipment`, `in-transit` --
-- are deliberately left standing. They are not shelves and never held anything;
-- `control.rs`, `observations.rs` and `movements.rs` select *through* them to
-- mean "this stage, whatever the store", and a scope handle earns its row.
-- `dc.outbound.picked` goes with its leaves, because after this there is no
-- PICKED stage left to scope.

-- 1. The shelf itself. No stage and no destination: this is the one outbound
--    pool that is a placement without being a leaf of a stage, which is what
--    "commits to nobody" means in the shape check.
INSERT INTO operational_pool (
    id, site_id, group_code, pool_code, label, display_order,
    is_placement, outbound_stage, destination_store_id, active
)
SELECT site.id || '.outbound.picking',
       site.id,
       'OUTBOUND',
       'PICKING',
       'Pick Area',
       40,
       TRUE,
       NULL,
       NULL,
       TRUE
FROM site
WHERE site.kind = 'DC'
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_place (id, kind, pool_id, state, is_company, is_saleable)
SELECT pool.id || ':on_hand', 'OPERATIONAL', pool.id, 'NORMAL', TRUE, FALSE
FROM operational_pool pool
WHERE pool.pool_code = 'PICKING'
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_place (id, kind, pool_id, state, is_company, is_saleable)
SELECT pool.id || ':missing', 'OPERATIONAL', pool.id, 'MISSING', TRUE, FALSE
FROM operational_pool pool
WHERE pool.pool_code = 'PICKING'
ON CONFLICT (id) DO NOTHING;

-- 2. What stands in the legacy pools, and where it belongs. Balances come from
--    the facts rather than from the projection, which is disposable and is
--    rebuilt below from the same source.
CREATE TEMP TABLE pick_area_cutover ON COMMIT DROP AS
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
    JOIN operational_pool pool ON pool.id = place.pool_id
    WHERE pool.outbound_stage = 'PICKED' AND pool.is_placement
    GROUP BY delta.subject_id, place.id, place.pool_id, place.state
    HAVING SUM(delta.delta) > 0
)
SELECT balance.subject_id,
       balance.quantity,
       balance.from_place_id,
       balance.from_pool_id,
       split_part(balance.from_pool_id, '.', 1) || '.outbound.picking' ||
           CASE balance.state WHEN 'MISSING' THEN ':missing' ELSE ':on_hand' END AS to_place_id
FROM balance;

INSERT INTO movement_group (
    id, cause, reason, reference_type, reference_id, actor_id,
    idempotency_key, payload_digest, occurred_at, recorded_at
)
SELECT md5('pick-area-canonicalisation-v1')::uuid,
       'PLACEMENT_CORRECTION',
       'Pick Area does not name a shop (INVENTORY-V1 INV-05)',
       'MIGRATION',
       'PICK-AREA-CANONICALISATION',
       'system-migration',
       'pick-area-canonicalisation-v1',
       md5('pick-area-canonicalisation-v1'),
       now(),
       now()
WHERE EXISTS (SELECT 1 FROM pick_area_cutover)
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO movement (
    movement_id, movement_group_id, subject_id, quantity,
    from_place_id, to_place_id, cause, reference_type, reference_id,
    idempotency_key, payload_digest, actor_id, occurred_at, recorded_at
)
SELECT md5('pick-area-canonicalisation:' || subject_id::text || ':' || from_place_id)::uuid,
       md5('pick-area-canonicalisation-v1')::uuid,
       subject_id,
       quantity,
       from_place_id,
       to_place_id,
       'PLACEMENT_CORRECTION',
       'MIGRATION',
       'PICK-AREA-CANONICALISATION',
       'pick-area-canonicalisation-v1',
       md5('pick-area-canonicalisation-v1'),
       'system-migration',
       now(),
       now()
FROM pick_area_cutover
ON CONFLICT (movement_id) DO NOTHING;

-- RFID evidence follows the goods to the shelf they are now recorded on,
-- without changing Stock: a sighting is where a tag was read, and the tag was
-- read in the pick area either way.
UPDATE observation_sighting observation
SET pool_id = split_part(cutover.to_place_id, ':', 1)
FROM pick_area_cutover cutover
WHERE observation.subject_id = cutover.subject_id
  AND observation.pool_id = cutover.from_pool_id;

-- The projection is disposable and is rebuilt from the immutable facts, which
-- now include the correction above.
DELETE FROM inventory_projection projection
USING inventory_place place
WHERE projection.place_id = place.id
  AND place.pool_id LIKE '%.outbound.pick%';

INSERT INTO inventory_projection (subject_id, place_id, quantity, last_fact_sequence, updated_at)
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
WHERE place.kind = 'OPERATIONAL' AND place.pool_id LIKE '%.outbound.pick%'
ON CONFLICT (subject_id, place_id) DO UPDATE
SET quantity = EXCLUDED.quantity,
    last_fact_sequence = EXCLUDED.last_fact_sequence,
    updated_at = now();

-- 3. Retire the legacy spelling: the thirteen leaves, and the stage parent that
--    has nothing left to be a parent of.
UPDATE operational_pool
SET active = FALSE
WHERE outbound_stage = 'PICKED';
