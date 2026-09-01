-- Receipt attribution is a disposable Cloud projection over two immutable
-- owner-authored claims. It identifies both facts and is constrained to the
-- immutable DC package unit that supplies the Allotment identity.
ALTER TABLE edge_fulfillment_package_unit
    ADD CONSTRAINT edge_fulfillment_package_unit_attribution_identity
    UNIQUE (package_id,epc,allotment_id,allotment_line_id);

ALTER TABLE edge_transfer_allotment_attribution
    ADD COLUMN in_transit_event_id uuid REFERENCES edge_transfer_claim(event_id);

-- Backfill a legacy projection row only when its receipt has one unambiguous
-- exact-key DC counterpart. The table had no production writer before this
-- migration, but this keeps upgrades deterministic if rows were repaired by
-- operators.
UPDATE edge_transfer_allotment_attribution attribution
SET in_transit_event_id=candidate.in_transit_event_id,
    package_id=candidate.package_id,
    allotment_id=candidate.allotment_id,
    allotment_line_id=candidate.allotment_line_id,
    epc=candidate.epc
FROM (
    SELECT attribution.receipt_event_id,
           min(in_transit.event_id::text)::uuid AS in_transit_event_id,
           min(unit.package_id::text)::uuid AS package_id,
           min(unit.allotment_id::text)::uuid AS allotment_id,
           min(unit.allotment_line_id::text)::uuid AS allotment_line_id,
           min(unit.epc) AS epc
    FROM edge_transfer_allotment_attribution attribution
    JOIN edge_transfer_claim receipt
      ON receipt.event_id=attribution.receipt_event_id
     AND receipt.claim_kind='RECEIVED'
    JOIN edge_transfer_claim in_transit
      ON in_transit.claim_kind='IN_TRANSIT'
     AND in_transit.source_dc_id=receipt.source_dc_id
     AND in_transit.destination_store_id=receipt.destination_store_id
     AND in_transit.shipment_reference=receipt.shipment_reference
     AND in_transit.epc=receipt.epc
     AND in_transit.sku_code=receipt.sku_code
    JOIN edge_fulfillment_progress_unit unit
      ON unit.progress_event_id=in_transit.in_transit_progress_event_id
     AND unit.unit_ordinal=in_transit.in_transit_unit_ordinal
     AND unit.epc=in_transit.epc
     AND unit.sku_code=in_transit.sku_code
    WHERE receipt.source_dc_id IS NOT NULL
      AND receipt.shipment_reference IS NOT NULL
    GROUP BY attribution.receipt_event_id
    HAVING count(*)=1
) candidate
WHERE attribution.receipt_event_id=candidate.receipt_event_id;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM edge_transfer_allotment_attribution
        WHERE in_transit_event_id IS NULL
    ) THEN
        RAISE EXCEPTION 'legacy transfer attribution has no unique exact-key In-Transit claim';
    END IF;
END $$;

ALTER TABLE edge_transfer_allotment_attribution
    ALTER COLUMN in_transit_event_id SET NOT NULL,
    ADD CONSTRAINT edge_transfer_attribution_in_transit_unique
        UNIQUE (in_transit_event_id),
    ADD CONSTRAINT edge_transfer_attribution_package_epc_unique
        UNIQUE (package_id,epc),
    ADD CONSTRAINT edge_transfer_attribution_epc_canonical
        CHECK (btrim(epc) <> '' AND epc=upper(epc)),
    ADD CONSTRAINT edge_transfer_attribution_package_unit_fk
        FOREIGN KEY (package_id,epc,allotment_id,allotment_line_id)
        REFERENCES edge_fulfillment_package_unit
            (package_id,epc,allotment_id,allotment_line_id);

CREATE INDEX edge_transfer_attribution_allotment_line
    ON edge_transfer_allotment_attribution(allotment_line_id,matched_at,epc);

CREATE OR REPLACE FUNCTION validate_edge_transfer_allotment_attribution()
RETURNS trigger LANGUAGE plpgsql AS $$
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
             AND unit.package_id=NEW.package_id
             AND unit.allotment_id=NEW.allotment_id
             AND unit.allotment_line_id=NEW.allotment_line_id
       ) THEN
        RAISE EXCEPTION 'transfer attribution claims do not form one exact-key, same-SKU pair';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER edge_transfer_allotment_attribution_validate
BEFORE INSERT OR UPDATE ON edge_transfer_allotment_attribution
FOR EACH ROW EXECUTE FUNCTION validate_edge_transfer_allotment_attribution();

-- Materialize already-applied unique pairs. Runtime application uses the same
-- exact identity and remains idempotent for either owner arrival order.
WITH exact_pair AS (
    SELECT source_dc_id,destination_store_id,shipment_reference,epc,
           min(event_id::text) FILTER (WHERE claim_kind='IN_TRANSIT')::uuid
               AS in_transit_event_id,
           min(event_id::text) FILTER (WHERE claim_kind='RECEIVED')::uuid
               AS receipt_event_id
    FROM edge_transfer_claim
    WHERE source_dc_id IS NOT NULL AND shipment_reference IS NOT NULL
    GROUP BY source_dc_id,destination_store_id,shipment_reference,epc
    HAVING count(*) FILTER (WHERE claim_kind='IN_TRANSIT')=1
       AND count(*) FILTER (WHERE claim_kind='RECEIVED')=1
       AND count(DISTINCT sku_code)=1
), desired AS (
    SELECT pair.receipt_event_id,pair.in_transit_event_id,unit.package_id,
           unit.allotment_id,unit.allotment_line_id,unit.epc
    FROM exact_pair pair
    JOIN edge_transfer_claim in_transit
      ON in_transit.event_id=pair.in_transit_event_id
    JOIN edge_fulfillment_progress_unit unit
      ON unit.progress_event_id=in_transit.in_transit_progress_event_id
     AND unit.unit_ordinal=in_transit.in_transit_unit_ordinal
     AND unit.epc=in_transit.epc
     AND unit.sku_code=in_transit.sku_code
)
INSERT INTO edge_transfer_allotment_attribution
    (receipt_event_id,in_transit_event_id,package_id,allotment_id,
     allotment_line_id,epc)
SELECT receipt_event_id,in_transit_event_id,package_id,allotment_id,
       allotment_line_id,epc
FROM desired
ON CONFLICT (receipt_event_id) DO NOTHING;

UPDATE edge_allotment_line_progress progress
SET received_quantity=(
        SELECT count(*)::bigint
        FROM edge_transfer_allotment_attribution attribution
        WHERE attribution.allotment_line_id=progress.allotment_line_id
    ),
    updated_at=now();

WITH lifecycle AS (
    SELECT progress.allotment_id,
           COALESCE(sum(accepted_quantity),0)::bigint AS accepted,
           COALESCE(sum(dispatched_quantity),0)::bigint AS dispatched,
           COALESCE(sum(received_quantity),0)::bigint AS received,
           COALESCE(sum(cancelled_quantity),0)::bigint AS cancelled
    FROM edge_allotment_line_progress progress
    JOIN (
        SELECT DISTINCT allotment_id
        FROM edge_transfer_allotment_attribution
    ) attributed ON attributed.allotment_id=progress.allotment_id
    GROUP BY progress.allotment_id
)
UPDATE allotment header
SET status=CASE
        WHEN lifecycle.accepted > 0
         AND lifecycle.received+lifecycle.cancelled=lifecycle.accepted
            THEN 'COMPLETED'
        WHEN lifecycle.accepted > 0
         AND lifecycle.dispatched+lifecycle.cancelled=lifecycle.accepted
            THEN 'DC_COMPLETED'
        ELSE 'IN_PROGRESS'
    END,
    updated_at=now()
FROM lifecycle
WHERE header.id=lifecycle.allotment_id
  AND header.edge_application_status='ACCEPTED'
  AND header.status IN ('ACTIVE','IN_PROGRESS','DC_COMPLETED','COMPLETED');
