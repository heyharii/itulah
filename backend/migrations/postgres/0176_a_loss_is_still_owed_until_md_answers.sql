-- 0176: custody passes at the door, and a loss is still owed.
--
-- The ladder this replaces assumed goods only ever move one way and never leave
-- the road: every stage was the difference between two adjacent rungs, and the
-- CHECKs said each rung was no larger than the one below it. Three ordinary
-- things break that.
--
-- A carton can be opened again. A shipment can be split, a lorry unloaded
-- before it leaves.
--
-- Goods can be lost. Two shirts that never reached the shop are not received
-- and are not given up on: Inventory settles whether they are found or gone,
-- and a loss returns the demand to To Pack so the bench can pack replacements.
-- Which is why `closed_short + packed <= quantity` cannot be a constraint:
-- 100 packed, 2 lost and 2 replaced is 102 against 100, and it is a perfectly
-- ordinary ending.
--
-- And custody moves at the door. When a shop takes delivery, the koli handed
-- over become its responsibility — so the journey is over for them even if two
-- of the shirts inside cannot be found. Those two are not "still in transit";
-- they are a **receiving gap**, which the shop's own ledger records as Missing
-- in its warehouse. That is why `handed_over_quantity` is a column of its own
-- and not an inference from the manifest: nine koli unloaded with a tenth still
-- on the lorry is a different fact from ten unloaded and two shirts missing.
--
-- What replaces the ladder is one claim, made where it belongs: **no place may
-- go negative**. Every event moves one piece out of one place and into another,
-- so the eight places always sum to what MD promised. The model is frozen in
-- `docs/allotment-v1.md`; the arithmetic and its proof live in
-- `src/cloud/domain/commitment.rs`; this file is that model written where the
-- database can refuse to break it.
--
-- Two readings of the legacy rows are folded into the view rather than into an
-- UPDATE, because they are readings and not corrections:
--
--   * `cancelled_quantity` is the old spelling of Close Short — MD giving up
--     on demand the DC had not yet packed.
--   * a CANCELLED or REJECTED header stands for giving up on the whole
--     remainder. Without this, a refused allotment would go on blocking stock
--     for ever, because in the new model `accepted_quantity` no longer gates
--     the commitment.

-- ---------------------------------------------------------------------------
-- The counters the flow needs, on both sides of the sync
-- ---------------------------------------------------------------------------

ALTER TABLE allotment_line
    ADD COLUMN unpacked_quantity        bigint NOT NULL DEFAULT 0 CHECK (unpacked_quantity >= 0),
    ADD COLUMN unshipped_quantity       bigint NOT NULL DEFAULT 0 CHECK (unshipped_quantity >= 0),
    ADD COLUMN unloaded_quantity        bigint NOT NULL DEFAULT 0 CHECK (unloaded_quantity >= 0),
    ADD COLUMN handed_over_quantity     bigint NOT NULL DEFAULT 0 CHECK (handed_over_quantity >= 0),
    ADD COLUMN lost_packed_quantity     bigint NOT NULL DEFAULT 0 CHECK (lost_packed_quantity >= 0),
    ADD COLUMN lost_in_transit_quantity bigint NOT NULL DEFAULT 0 CHECK (lost_in_transit_quantity >= 0),
    ADD COLUMN lost_at_store_quantity   bigint NOT NULL DEFAULT 0 CHECK (lost_at_store_quantity >= 0),
    ADD COLUMN closed_short_quantity    bigint NOT NULL DEFAULT 0 CHECK (closed_short_quantity >= 0);

ALTER TABLE edge_allotment_line_progress
    ADD COLUMN unpacked_quantity        bigint NOT NULL DEFAULT 0 CHECK (unpacked_quantity >= 0),
    ADD COLUMN unshipped_quantity       bigint NOT NULL DEFAULT 0 CHECK (unshipped_quantity >= 0),
    ADD COLUMN unloaded_quantity        bigint NOT NULL DEFAULT 0 CHECK (unloaded_quantity >= 0),
    ADD COLUMN handed_over_quantity     bigint NOT NULL DEFAULT 0 CHECK (handed_over_quantity >= 0),
    ADD COLUMN lost_packed_quantity     bigint NOT NULL DEFAULT 0 CHECK (lost_packed_quantity >= 0),
    ADD COLUMN lost_in_transit_quantity bigint NOT NULL DEFAULT 0 CHECK (lost_in_transit_quantity >= 0),
    ADD COLUMN lost_at_store_quantity   bigint NOT NULL DEFAULT 0 CHECK (lost_at_store_quantity >= 0),
    ADD COLUMN closed_short_quantity    bigint NOT NULL DEFAULT 0 CHECK (closed_short_quantity >= 0);

-- Every row written before today was received without anybody recording the
-- handover, and the only honest reading of those rows is that custody passed
-- for exactly what the shop took. Anything still short of that stayed on the
-- road, which is what the old ladder meant by `in_transit - received`.
UPDATE allotment_line SET handed_over_quantity = received_quantity
 WHERE received_quantity > 0;
UPDATE edge_allotment_line_progress SET handed_over_quantity = received_quantity
 WHERE received_quantity > 0;

-- ---------------------------------------------------------------------------
-- Out with the ladder, in with the places
-- ---------------------------------------------------------------------------

ALTER TABLE allotment_line
    DROP CONSTRAINT IF EXISTS allotment_line_explicit_lifecycle_check;

-- The progress table's ladder CHECKs are unnamed, so they are found by what
-- they say rather than by what they are called.
DO $$
DECLARE constraint_row RECORD;
BEGIN
    FOR constraint_row IN
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid='edge_allotment_line_progress'::regclass AND contype='c'
    LOOP
        IF constraint_row.definition ~ '(packed_quantity <= picked_quantity|shipment_quantity <= packed_quantity|dispatched_quantity <= shipment_quantity|in_transit_quantity <= dispatched_quantity|received_quantity <= in_transit_quantity|picked_quantity \+ cancelled_quantity\) <= accepted_quantity)' THEN
            EXECUTE format('ALTER TABLE edge_allotment_line_progress DROP CONSTRAINT %I',constraint_row.conname);
        END IF;
    END LOOP;
END $$;

-- `dispatched_quantity` is the LOADED rung and has been since 0013 on the edge:
-- goods on a lorry that has not moved. It is read as `loaded_total` here and
-- renamed when the ladder is next migrated (T5).
ALTER TABLE allotment_line
    ADD CONSTRAINT allotment_line_fulfillment_places_check CHECK (
        quantity + unpacked_quantity
            + lost_packed_quantity + lost_in_transit_quantity + lost_at_store_quantity
            - packed_quantity - cancelled_quantity - closed_short_quantity >= 0
        AND packed_quantity + unshipped_quantity
            - unpacked_quantity - shipment_quantity - lost_packed_quantity >= 0
        AND shipment_quantity + unloaded_quantity
            - unshipped_quantity - dispatched_quantity >= 0
        AND dispatched_quantity - unloaded_quantity - in_transit_quantity >= 0
        AND in_transit_quantity - handed_over_quantity - lost_in_transit_quantity >= 0
        AND handed_over_quantity - received_quantity - lost_at_store_quantity >= 0
    );

ALTER TABLE edge_allotment_line_progress
    ADD CONSTRAINT edge_allotment_line_progress_places_check CHECK (
        planned_quantity + unpacked_quantity
            + lost_packed_quantity + lost_in_transit_quantity + lost_at_store_quantity
            - packed_quantity - cancelled_quantity - closed_short_quantity >= 0
        AND packed_quantity + unshipped_quantity
            - unpacked_quantity - shipment_quantity - lost_packed_quantity >= 0
        AND shipment_quantity + unloaded_quantity
            - unshipped_quantity - dispatched_quantity >= 0
        AND dispatched_quantity - unloaded_quantity - in_transit_quantity >= 0
        AND in_transit_quantity - handed_over_quantity - lost_in_transit_quantity >= 0
        AND handed_over_quantity - received_quantity - lost_at_store_quantity >= 0
    );

-- Picking stops being commitment when ALLOTMENT_PICKED is retired (step 3).
-- Until then the cloud-native route still writes it, and the guard it used to
-- live under went out with the ladder, so it is kept on its own and dies with
-- the event.
ALTER TABLE allotment_line
    ADD CONSTRAINT allotment_line_legacy_pick_check CHECK (
        picked_quantity + cancelled_quantity <= quantity
    );

-- ---------------------------------------------------------------------------
-- The one view everything reads
-- ---------------------------------------------------------------------------

CREATE VIEW allotment_line_commitment AS
SELECT
    counters.allotment_line_id,
    counters.allotment_id,
    counters.origin_id,
    counters.source_site_id,
    counters.source_pool_id,
    counters.destination_type,
    counters.destination_id,
    counters.sku_id,
    counters.original_alloted,
    counters.packed_total,
    counters.unpacked_total,
    counters.shipment_total,
    counters.unshipped_total,
    counters.loaded_total,
    counters.unloaded_total,
    counters.in_transit_total,
    counters.handed_over_total,
    counters.received_total,
    counters.lost_packed_total,
    counters.lost_in_transit_total,
    counters.lost_at_store_total,
    counters.closed_short_total,
    (counters.original_alloted + counters.unpacked_total
        + counters.lost_packed_total + counters.lost_in_transit_total
        + counters.lost_at_store_total
        - counters.packed_total - counters.closed_short_total)::bigint AS to_pack_qty,
    (counters.packed_total + counters.unshipped_total
        - counters.unpacked_total - counters.shipment_total
        - counters.lost_packed_total)::bigint AS at_packed,
    (counters.shipment_total + counters.unloaded_total
        - counters.unshipped_total - counters.loaded_total)::bigint AS at_shipment,
    (counters.loaded_total - counters.unloaded_total
        - counters.in_transit_total)::bigint AS at_loaded,
    (counters.in_transit_total - counters.handed_over_total
        - counters.lost_in_transit_total)::bigint AS at_in_transit,
    -- Handed over at the shop's door and not found there. Not a stage: the
    -- journey is over and the goods are the shop's custody, where its own
    -- ledger carries them as Missing. Counted here because what is still owed
    -- would otherwise have no explanation.
    (counters.handed_over_total - counters.received_total
        - counters.lost_at_store_total)::bigint AS receiving_gap_qty,
    counters.received_total AS received,
    (counters.original_alloted - counters.received_total
        - counters.closed_short_total)::bigint AS to_receive_qty
FROM (
    SELECT
        chosen.*,
        (chosen.cancelled_legacy + chosen.closed_short_written
         + CASE WHEN chosen.header_status IN ('CANCELLED','REJECTED')
                THEN GREATEST(chosen.original_alloted + chosen.unpacked_total
                              + chosen.lost_packed_total + chosen.lost_in_transit_total
                              + chosen.lost_at_store_total - chosen.packed_total
                              - chosen.cancelled_legacy - chosen.closed_short_written, 0)
                ELSE 0 END)::bigint AS closed_short_total
    FROM (
        -- A line the fleet reports on is reported on wholly: where a progress
        -- row exists it is the whole truth for that line, and mixing the two
        -- sources column by column would invent a history neither side has.
        SELECT
            line.id AS allotment_line_id,
            line.allotment_id,
            progress.origin_id,
            line.source_site_id,
            line.source_pool_id,
            line.destination_type,
            line.destination_id,
            line.sku_id,
            header.status AS header_status,
            line.quantity::bigint AS original_alloted,
            COALESCE(progress.packed_quantity, line.packed_quantity)::bigint AS packed_total,
            COALESCE(progress.unpacked_quantity, line.unpacked_quantity)::bigint AS unpacked_total,
            COALESCE(progress.shipment_quantity, line.shipment_quantity)::bigint AS shipment_total,
            COALESCE(progress.unshipped_quantity, line.unshipped_quantity)::bigint AS unshipped_total,
            COALESCE(progress.dispatched_quantity, line.dispatched_quantity)::bigint AS loaded_total,
            COALESCE(progress.unloaded_quantity, line.unloaded_quantity)::bigint AS unloaded_total,
            COALESCE(progress.in_transit_quantity, line.in_transit_quantity)::bigint AS in_transit_total,
            COALESCE(progress.handed_over_quantity, line.handed_over_quantity)::bigint AS handed_over_total,
            COALESCE(progress.received_quantity, line.received_quantity)::bigint AS received_total,
            COALESCE(progress.lost_packed_quantity, line.lost_packed_quantity)::bigint AS lost_packed_total,
            COALESCE(progress.lost_in_transit_quantity, line.lost_in_transit_quantity)::bigint AS lost_in_transit_total,
            COALESCE(progress.lost_at_store_quantity, line.lost_at_store_quantity)::bigint AS lost_at_store_total,
            COALESCE(progress.cancelled_quantity, line.cancelled_quantity)::bigint AS cancelled_legacy,
            COALESCE(progress.closed_short_quantity, line.closed_short_quantity)::bigint AS closed_short_written
        FROM allotment_line line
        JOIN allotment header ON header.id=line.allotment_id
        LEFT JOIN edge_allotment_line_progress progress ON progress.allotment_line_id=line.id
    ) chosen
) counters;

CREATE VIEW allotment_commitment AS
SELECT
    folded.allotment_id,
    folded.line_count,
    folded.sku_count,
    folded.article_count,
    folded.destination_count,
    folded.original_alloted,
    folded.to_pack_qty,
    folded.at_packed,
    folded.at_shipment,
    folded.at_loaded,
    folded.at_in_transit,
    folded.receiving_gap_qty,
    folded.received,
    folded.closed_short_total,
    folded.to_receive_qty,
    -- Store receipt ends an allotment, or MD's Close Short does. A receiving
    -- gap needs no arm of its own: it is part of what is still to receive, so
    -- a line waiting on Inventory is ACTIVE without being asked.
    CASE
        WHEN folded.to_receive_qty > 0 THEN 'ACTIVE'
        WHEN folded.closed_short_total > 0 THEN 'CLOSED'
        ELSE 'COMPLETED'
    END AS status,
    -- A milestone, never a status: the DC has nothing left to do. Stated over
    -- the places rather than over `in_transit_total`, which a loss pushes past
    -- what was allotted.
    (folded.to_pack_qty = 0 AND folded.at_packed = 0
     AND folded.at_shipment = 0 AND folded.at_loaded = 0
     AND folded.original_alloted > 0) AS dc_fulfilled
FROM (
    SELECT
        header.id AS allotment_id,
        COUNT(commitment.allotment_line_id)::bigint AS line_count,
        COUNT(DISTINCT commitment.sku_id)::bigint AS sku_count,
        COUNT(DISTINCT sku.article_id)::bigint AS article_count,
        COUNT(DISTINCT (commitment.destination_type,commitment.destination_id))
            FILTER (WHERE commitment.allotment_line_id IS NOT NULL)::bigint AS destination_count,
        COALESCE(SUM(commitment.original_alloted),0)::bigint AS original_alloted,
        COALESCE(SUM(commitment.to_pack_qty),0)::bigint AS to_pack_qty,
        COALESCE(SUM(commitment.at_packed),0)::bigint AS at_packed,
        COALESCE(SUM(commitment.at_shipment),0)::bigint AS at_shipment,
        COALESCE(SUM(commitment.at_loaded),0)::bigint AS at_loaded,
        COALESCE(SUM(commitment.at_in_transit),0)::bigint AS at_in_transit,
        COALESCE(SUM(commitment.receiving_gap_qty),0)::bigint AS receiving_gap_qty,
        COALESCE(SUM(commitment.received),0)::bigint AS received,
        COALESCE(SUM(commitment.closed_short_total),0)::bigint AS closed_short_total,
        COALESCE(SUM(commitment.to_receive_qty),0)::bigint AS to_receive_qty
    FROM allotment header
    LEFT JOIN allotment_line_commitment commitment ON commitment.allotment_id=header.id
    LEFT JOIN sku ON sku.id=commitment.sku_id
    GROUP BY header.id
) folded;

COMMENT ON VIEW allotment_line_commitment IS
    'The eight places a promised piece can be, per allotment line. Every screen, balance and sync read reads this or its header fold; a caller that subtracts for itself is the bug this exists to prevent.';
COMMENT ON VIEW allotment_commitment IS
    'The same arithmetic folded to the allotment, with the three statuses derived from it. ACTIVE until the shop has it or MD gives it up.';
COMMENT ON COLUMN allotment_line.handed_over_quantity IS
    'Custody actually passed at the shop door, derived from the koli handed over — never from the manifest.';
COMMENT ON COLUMN allotment_line.received_quantity IS
    'What the shop actually found. Damaged goods count: they arrived, and their condition is recorded in the Store Reject pool, not here.';
COMMENT ON COLUMN allotment_line.lost_at_store_quantity IS
    'A receiving gap Inventory settled as gone. The demand returns to To Pack.';
COMMENT ON COLUMN allotment_line.closed_short_quantity IS
    'Demand MD gave up on. Moves no stock, and only ever comes out of To Pack.';
COMMENT ON COLUMN allotment_line.dispatched_quantity IS
    'The LOADED rung: on a vehicle that has not left. Read as loaded_total; renamed when the ladder is next migrated.';
