-- A piece MD accepted as delivered at another shop of the trip than the one
-- it was sent to pairs across keys (owner, 18 Oct 2026; 0977
-- `edge_transfer_redirect`).
--
-- The attribution trigger (0021, 0389) holds a receipt and its in-transit
-- claim to one exact key — source, destination, surat jalan, EPC. Shop A's
-- receipt of shop B's piece carries A's key, B's in-transit claim B's, so the
-- first such receipt held A's whole sync stream at the fact ("transfer
-- attribution claims do not form one exact-key, same-SKU pair"). The two keys
-- may now differ in destination and surat jalan only where MD's answer says
-- so: a redirect row from the receipt's key to the in-transit claim's.
-- Everything else is checked as before.
CREATE OR REPLACE FUNCTION validate_edge_transfer_allotment_attribution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    receipt edge_transfer_claim%ROWTYPE;
    in_transit edge_transfer_claim%ROWTYPE;
    same_key boolean;
    redirected boolean;
BEGIN
    SELECT * INTO receipt FROM edge_transfer_claim WHERE event_id=NEW.receipt_event_id;
    SELECT * INTO in_transit FROM edge_transfer_claim WHERE event_id=NEW.in_transit_event_id;
    same_key := receipt.destination_store_id IS NOT DISTINCT FROM in_transit.destination_store_id
        AND receipt.shipment_reference IS NOT DISTINCT FROM in_transit.shipment_reference;
    redirected := EXISTS (
        SELECT 1 FROM edge_transfer_redirect redirect
         WHERE redirect.source_dc_id=receipt.source_dc_id
           AND redirect.destination_store_id=receipt.destination_store_id
           AND redirect.shipment_reference=receipt.shipment_reference
           AND redirect.epc=receipt.epc
           AND redirect.meant_destination_id=in_transit.destination_store_id
           AND redirect.meant_shipment_reference=in_transit.shipment_reference
    );
    IF receipt.claim_kind IS DISTINCT FROM 'RECEIVED'
       OR in_transit.claim_kind IS DISTINCT FROM 'IN_TRANSIT'
       OR receipt.source_dc_id IS NULL
       OR receipt.shipment_reference IS NULL
       OR receipt.source_dc_id IS DISTINCT FROM in_transit.source_dc_id
       OR NOT (same_key OR redirected)
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
