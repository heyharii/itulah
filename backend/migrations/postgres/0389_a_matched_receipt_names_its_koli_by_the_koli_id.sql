-- A shop's receipt that matches a DC's despatch is attributed to the koli and
-- the allotment line it travelled on (0021). The trigger that checks that
-- attribution was written when the column was `package_id`; 0030 renamed it
-- to `koli_id` on every table, but a PL/pgSQL body is text and is not
-- rewritten by a rename. So the first receipt a shop typed its delivery note
-- for failed with `column unit.package_id does not exist`, the apply agent
-- held that shop's stream at the fact, and nothing the shop said afterwards —
-- sales, returns, every later receipt — reached the centre. Found on
-- 2026-09-26 driving PO -> allotment -> store receipt end to end.
--
-- Same checks as 0021, on the columns as they are named now.
CREATE OR REPLACE FUNCTION validate_edge_transfer_allotment_attribution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    receipt edge_transfer_claim%ROWTYPE;
    in_transit edge_transfer_claim%ROWTYPE;
BEGIN
    SELECT * INTO receipt FROM edge_transfer_claim WHERE event_id=NEW.receipt_event_id;
    SELECT * INTO in_transit FROM edge_transfer_claim WHERE event_id=NEW.in_transit_event_id;
    IF receipt.claim_kind IS DISTINCT FROM 'RECEIVED'
       OR in_transit.claim_kind IS DISTINCT FROM 'IN_TRANSIT'
       OR receipt.source_dc_id IS NULL
       OR receipt.shipment_reference IS NULL
       OR receipt.source_dc_id IS DISTINCT FROM in_transit.source_dc_id
       OR receipt.destination_store_id IS DISTINCT FROM in_transit.destination_store_id
       OR receipt.shipment_reference IS DISTINCT FROM in_transit.shipment_reference
       OR receipt.epc IS DISTINCT FROM in_transit.epc
       OR receipt.sku_code IS DISTINCT FROM in_transit.sku_code
       OR NEW.epc IS DISTINCT FROM receipt.epc
       OR NOT EXISTS (
           SELECT 1
           FROM edge_fulfillment_progress_unit unit
           WHERE unit.progress_event_id=in_transit.in_transit_progress_event_id
             AND unit.unit_ordinal=in_transit.in_transit_unit_ordinal
             AND unit.epc=in_transit.epc
             AND unit.sku_code=in_transit.sku_code
             AND unit.koli_id=NEW.koli_id
             AND unit.allotment_id=NEW.allotment_id
             AND unit.allotment_line_id=NEW.allotment_line_id
       ) THEN
        RAISE EXCEPTION 'transfer attribution claims do not form one exact-key, same-SKU pair';
    END IF;
    RETURN NEW;
END
$$;
