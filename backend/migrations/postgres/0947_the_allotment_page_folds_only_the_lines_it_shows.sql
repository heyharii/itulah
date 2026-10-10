-- The allotment list is read newest first: one page of it, ordered by
-- created_at descending, its totals folded per allotment, with a whole-book
-- rollup by destination beside it. Nothing led with created_at on the header,
-- so the newest-first walk sorted the header table every time; and both folds
-- joined the per-line commitment view (0176) from the line side, so the page
-- aggregated all 1.87 million lines on the load estate to answer with two
-- hundred allotments — the page's own fold over every allotment's lines, and
-- the rollup reading line and progress a second time beside the view's own
-- reading of them.
--
-- One index in the page's own order, so the newest-first walk is a seek.
-- No need to spell DESC: Postgres reads an ascending index backwards at the
-- same cost, which is what the page does.
CREATE INDEX IF NOT EXISTS allotment_created_idx
    ON allotment (created_at);

-- What the fold owes the list is three columns it kept to itself. Picked and
-- accepted were spelled at every call site through the caller's own join of
-- line and progress — accepted as a CASE on where activation was targeted —
-- and cancelled_legacy was folded but never exposed. Carried here, the same
-- arithmetic in the one place it lives, the destination rollup reads the line
-- once: line, progress and header a single pass each instead of line and
-- progress twice. A reader that does not name the new columns sees nothing
-- change.
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

COMMENT ON COLUMN allotment_line_commitment.picked_total IS
    'What the bench fetched, the legacy reading: the edge row where the fleet reports the line, the line where it does not. Picking is not one of the eight places.';
COMMENT ON COLUMN allotment_line_commitment.accepted_total IS
    'What the destination has taken of the promise: the edge row where the fleet reports one, and before it reports anything the whole promise where activation was never targeted at an edge — nothing where it was, for the edge has not said yet.';
COMMENT ON COLUMN allotment_line_commitment.cancelled_legacy IS
    'The old spelling of Close Short (0176): MD giving up on demand the DC had not yet packed. Exposed so a rollup can fold the line once.';
