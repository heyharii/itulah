-- 0612: a claim belongs to the site it is about, not to a role.
--
-- 0013 tied the two transfer claims to node roles: IN_TRANSIT could only be
-- published by a DC node, RECEIVED only by a STORE node. That is "Gudang →
-- store" written into a CHECK. Since 0611 a shop sends too (a return to the
-- Gudang, a transfer to another shop) and the Gudang receives too (a shop's
-- return), so the rule is what it always meant: the IN_TRANSIT claim is the
-- ORIGIN's (`source_dc_id = owner_site_id`), the RECEIVED claim is the
-- DESTINATION's (`destination_store_id = owner_site_id`). The column names are
-- the wire's and stay; they have named a site of any kind since 0611.

-- ---------------------------------------------------------------------------
-- Claims by site, not by role
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    constraint_row record;
BEGIN
    FOR constraint_row IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'edge_transfer_claim'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%owner_node_role%'
           AND pg_get_constraintdef(oid) LIKE '%claim_kind%'
    LOOP
        EXECUTE format('ALTER TABLE edge_transfer_claim DROP CONSTRAINT %I', constraint_row.conname);
    END LOOP;
END
$$;

ALTER TABLE edge_transfer_claim
    ADD CONSTRAINT edge_transfer_claim_owned_by_its_site CHECK (
        (claim_kind = 'IN_TRANSIT' AND source_dc_id = owner_site_id
            AND receipt_id IS NULL AND in_transit_progress_event_id IS NOT NULL
            AND in_transit_unit_ordinal >= 1)
        OR
        (claim_kind = 'RECEIVED' AND destination_store_id = owner_site_id
            AND receipt_id IS NOT NULL AND in_transit_progress_event_id IS NULL
            AND in_transit_unit_ordinal IS NULL)
    );

COMMENT ON COLUMN edge_transfer_claim.source_dc_id IS
    'The site the goods left — any kind since 0611/0612. Named for the wire.';
COMMENT ON COLUMN edge_transfer_claim.destination_store_id IS
    'The site the goods went to — any kind since 0611/0612. Named for the wire.';
