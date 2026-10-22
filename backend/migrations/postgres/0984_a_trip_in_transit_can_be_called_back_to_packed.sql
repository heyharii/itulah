-- A trip still in transit can be called back to Packed (owner, 21 Oct 2026:
-- "in transit jg masih bisa di cancel ya balik ke packed";
-- src/cloud/dc/cancel_dispatch.rs).
--
-- This overturns the rule of 9 Oct that nothing comes back once the truck has
-- gone. The point of no return is now the store's count: a trip no store has
-- counted yet may be cancelled, and every koli on it comes back to Packed with
-- its number, its seal and its contents as they were. Its surat jalan are
-- void; the koli go out again on a new trip, under new surat jalan.
--
--   allotment_line.recalled_quantity   pieces that were in transit and came
--                                      back to the Gudang: the reversal of
--                                      in_transit_quantity, as unloaded and
--                                      unshipped are of the rungs below it
--   dc_dispatch.cancelled_*            the trip called back, by whom, why, and
--                                      what it did (a retry answers with it)
--   dc_shipment.voided_at              a surat jalan of a cancelled trip
--   dc_koli_guard                      a koli may leave its surat jalan, only
--                                      inside a cancel
--   the cloud-run Gudang's own records a cancel takes back: its IN_TRANSIT
--                                      claims, and the stage records of the
--                                      trip, which it writes in a DC server's
--                                      shape (0908) and nothing else does

ALTER TABLE allotment_line
    ADD COLUMN IF NOT EXISTS recalled_quantity bigint NOT NULL DEFAULT 0
        CHECK (recalled_quantity >= 0);

COMMENT ON COLUMN allotment_line.recalled_quantity IS
    'Pieces that were in transit and came back to the Gudang when their trip was cancelled (0984). The reversal of in_transit_quantity, never a lowering of it; the commitment view reads in transit net of it.';

-- The ladder of 0176, with in transit read net of what came back.
ALTER TABLE allotment_line
    DROP CONSTRAINT IF EXISTS allotment_line_fulfillment_places_check;
ALTER TABLE allotment_line
    ADD CONSTRAINT allotment_line_fulfillment_places_check CHECK (
        quantity + unpacked_quantity
            + lost_packed_quantity + lost_in_transit_quantity + lost_at_store_quantity
            - packed_quantity - cancelled_quantity - closed_short_quantity >= 0
        AND packed_quantity + unshipped_quantity
            - unpacked_quantity - shipment_quantity - lost_packed_quantity >= 0
        AND shipment_quantity + unloaded_quantity
            - unshipped_quantity - dispatched_quantity >= 0
        AND dispatched_quantity - unloaded_quantity
            - (in_transit_quantity - recalled_quantity) >= 0
        AND in_transit_quantity - recalled_quantity
            - handed_over_quantity - lost_in_transit_quantity >= 0
        AND handed_over_quantity - received_quantity - lost_at_store_quantity >= 0
    );

-- The one view everything reads (0947), in transit net of what came back. A
-- cancel adds the same pieces to recalled, unloaded and unshipped: they leave
-- In transit, pass through Loaded and Shipment without stopping, and stand at
-- Packed again. Nothing else in the view changes.
CREATE OR REPLACE VIEW allotment_line_commitment AS
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
        - counters.closed_short_total)::bigint AS to_receive_qty,
    counters.picked_total,
    counters.accepted_total,
    counters.cancelled_legacy
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
            COALESCE(progress.accepted_quantity,
                CASE WHEN header.activation_target_origin_id IS NULL
                THEN line.quantity ELSE 0 END)::bigint AS accepted_total,
            COALESCE(progress.picked_quantity, line.picked_quantity)::bigint AS picked_total,
            COALESCE(progress.packed_quantity, line.packed_quantity)::bigint AS packed_total,
            COALESCE(progress.unpacked_quantity, line.unpacked_quantity)::bigint AS unpacked_total,
            COALESCE(progress.shipment_quantity, line.shipment_quantity)::bigint AS shipment_total,
            COALESCE(progress.unshipped_quantity, line.unshipped_quantity)::bigint AS unshipped_total,
            COALESCE(progress.dispatched_quantity, line.dispatched_quantity)::bigint AS loaded_total,
            COALESCE(progress.unloaded_quantity, line.unloaded_quantity)::bigint AS unloaded_total,
            COALESCE(progress.in_transit_quantity,
                     line.in_transit_quantity - line.recalled_quantity)::bigint AS in_transit_total,
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

-- ---------------------------------------------------------------------------
-- The trip
-- ---------------------------------------------------------------------------

ALTER TABLE dc_dispatch
    ADD COLUMN IF NOT EXISTS cancelled_at    timestamptz,
    ADD COLUMN IF NOT EXISTS cancelled_by    text,
    ADD COLUMN IF NOT EXISTS cancel_reason   text,
    -- The cancel that did it, so a retry answers with what it did instead
    -- of being refused as a second cancel.
    ADD COLUMN IF NOT EXISTS cancel_key      text UNIQUE,
    ADD COLUMN IF NOT EXISTS cancel_request  text,
    ADD COLUMN IF NOT EXISTS cancel_result   jsonb;

ALTER TABLE dc_dispatch
    DROP CONSTRAINT IF EXISTS dc_dispatch_cancel_check;
ALTER TABLE dc_dispatch
    ADD CONSTRAINT dc_dispatch_cancel_check CHECK (
        (cancelled_at IS NULL) = (cancelled_by IS NULL)
        AND (cancelled_at IS NULL) = (cancel_key IS NULL)
        AND (cancel_key IS NULL) = (cancel_request IS NULL)
        AND (cancel_key IS NULL) = (cancel_result IS NULL)
        AND (cancelled_by IS NULL OR btrim(cancelled_by) <> '')
    );

ALTER TABLE dc_shipment
    ADD COLUMN IF NOT EXISTS voided_at timestamptz;

-- A cancelled trip stays cancelled; its surat jalan stay void.
CREATE OR REPLACE FUNCTION dc_dispatch_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.departed_at IS NOT NULL AND NEW.departed_at IS DISTINCT FROM OLD.departed_at THEN
        RAISE EXCEPTION 'that dispatch has already departed';
    END IF;
    IF OLD.cancelled_at IS NOT NULL
       AND (NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
            OR NEW.cancel_key IS DISTINCT FROM OLD.cancel_key
            OR NEW.cancel_result IS DISTINCT FROM OLD.cancel_result) THEN
        RAISE EXCEPTION 'dispatch % was cancelled; that is final', OLD.dispatch_number;
    END IF;
    RETURN NEW;
END
$$;

-- 0908's guard, with one door: inside a cancel (`set_config('dc.cancel_dispatch',
-- 'on', true)`) a sealed koli leaves its surat jalan, and only to none. Its
-- seal and contents stay as they were.
CREATE OR REPLACE FUNCTION dc_koli_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.sealed_at IS NOT NULL
           AND (NEW.sealed_at IS DISTINCT FROM OLD.sealed_at
                OR NEW.sealed_by IS DISTINCT FROM OLD.sealed_by) THEN
            RAISE EXCEPTION 'a sealed koli cannot be unsealed';
        END IF;
        IF OLD.shipment_id IS NOT NULL
           AND NEW.shipment_id IS DISTINCT FROM OLD.shipment_id
           AND NOT (NEW.shipment_id IS NULL
                    AND COALESCE(current_setting('dc.cancel_dispatch', true), '') = 'on') THEN
            RAISE EXCEPTION 'koli % is already on a surat jalan', OLD.koli_number;
        END IF;
    END IF;
    -- An open box cannot be shipped: its paper would describe contents that
    -- can still change while it travels.
    IF NEW.shipment_id IS NOT NULL AND NEW.sealed_at IS NULL THEN
        RAISE EXCEPTION 'a koli must be sealed before it joins a shipment';
    END IF;
    RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- The cloud-run Gudang's own records of the trip
-- ---------------------------------------------------------------------------

-- 0013 made these append-only, and for what a DC server reports they stay so.
-- The cloud-run Gudang writes them itself, in a DC server's shape, under its
-- own origin (0908): a cancel takes back the ones of its trip — the stage
-- records and the IN_TRANSIT claims — so the koli may climb the same rungs
-- again on its next trip (one record per koli and stage), the trip is never
-- announced again to a node enrolled later, and reconciliation does not read
-- its pieces as still on the road. Only DELETE, only of the cloud-run Gudang's
-- records, and only inside a cancel. What happened stays in the ledger
-- (movements in and out of In Transit) and on the cancelled dc_dispatch.
CREATE OR REPLACE FUNCTION cloud_dc_record_called_back() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    origin text;
BEGIN
    IF TG_OP = 'DELETE'
       AND COALESCE(current_setting('dc.cancel_dispatch', true), '') = 'on' THEN
        IF TG_TABLE_NAME = 'edge_fulfillment_progress_unit' THEN
            SELECT f.origin_id INTO origin
              FROM edge_fulfillment_progress_fact f
             WHERE f.event_id = OLD.progress_event_id;
        ELSE
            origin := OLD.origin_id;
        END IF;
        IF origin = 'dc-cloud' THEN
            RETURN OLD;
        END IF;
    END IF;
    RAISE EXCEPTION 'inventory ledger is append-only: % is forbidden', TG_OP;
END
$$;

DROP TRIGGER IF EXISTS edge_fulfillment_progress_fact_append_only ON edge_fulfillment_progress_fact;
CREATE TRIGGER edge_fulfillment_progress_fact_append_only
BEFORE UPDATE OR DELETE ON edge_fulfillment_progress_fact
FOR EACH ROW EXECUTE FUNCTION cloud_dc_record_called_back();

DROP TRIGGER IF EXISTS edge_fulfillment_progress_unit_append_only ON edge_fulfillment_progress_unit;
CREATE TRIGGER edge_fulfillment_progress_unit_append_only
BEFORE UPDATE OR DELETE ON edge_fulfillment_progress_unit
FOR EACH ROW EXECUTE FUNCTION cloud_dc_record_called_back();

DROP TRIGGER IF EXISTS edge_transfer_claim_append_only ON edge_transfer_claim;
CREATE TRIGGER edge_transfer_claim_append_only
BEFORE UPDATE OR DELETE ON edge_transfer_claim
FOR EACH ROW EXECUTE FUNCTION cloud_dc_record_called_back();

COMMENT ON COLUMN dc_dispatch.cancelled_at IS
    'When the trip was called back to Packed (0984). Allowed until a store on it has counted; its koli are Packed again and its surat jalan void.';
COMMENT ON COLUMN dc_shipment.voided_at IS
    'Set when its trip was cancelled (0984): the koli left it for Packed and go out again on a new surat jalan.';
