-- MD reviews what the stores of a trip counted (owner, 17–18 Oct 2026).
--
-- A store counts a delivery blind. A count that matches what was sent is
-- booked into its stock at once and its allotment lines complete; one that
-- differs books nothing — the goods are the store's only once MD has answered
-- (owner, 18 Oct 2026). When a store of a truck run counts
-- something else than its surat jalan says — a piece meant for another store
-- of the same trip, a piece short, a piece extra, an article nobody sent —
-- the trip is in MD's review (`postgres::allotment_store_review`), read from
-- the trip's koli (`dc_koli_unit`) and the stores' receipts
-- (`edge_goods_step`, whose payload carries what each store counted, store
-- node 0080).
--
-- MD answers once per trip: Accept as delivered (the allotment follows the
-- pieces) or Return & reallot (what is wrong goes back to HO, what is missing
-- HO sends again on a new allotment). The answer is written here; a trip with
-- an answer is no longer in the review. The decisions themselves are worked
-- out by the code that writes this row.

CREATE TABLE IF NOT EXISTS allotment_store_review (
    dispatch_id     uuid PRIMARY KEY REFERENCES dc_dispatch (dispatch_id),
    decision        text NOT NULL CHECK (decision IN ('AS_DELIVERED', 'RETURN_REALLOT')),
    decided_by      text NOT NULL CHECK (btrim(decided_by) <> ''),
    decided_at      timestamptz NOT NULL,
    idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
    -- What the decision made: returns, a new allotment, lines closed short —
    -- their numbers, so the review reads back what was done.
    result          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object')
);

-- A piece MD accepted as delivered at another store of the trip than the one
-- it was sent to (owner, 18 Oct 2026). The Gudang put it in transit to store
-- B on B's surat jalan; store A books it under A's own. The centre pairs a
-- receipt with its in-transit claim by source, destination, surat jalan and
-- EPC, so the two would never meet: the piece would stand in the Gudang's In
-- Transit pool for ever while A sells it, B's allotment line would never
-- complete, and reconciliation would read DC_ONLY at B and STORE_ONLY at A.
-- This row is MD's answer in the centre's terms: A's receipt of the EPC on
-- A's surat jalan settles B's in-transit claim
-- (`sync::reconcile_transfer_allotment_attribution`, cloud-run Gudang only).
CREATE TABLE IF NOT EXISTS edge_transfer_redirect (
    source_dc_id             text NOT NULL,
    -- Where it arrived: the receipt's key.
    destination_store_id     text NOT NULL,
    shipment_reference       text NOT NULL,
    epc                      text NOT NULL,
    -- Where it was sent: the in-transit claim's key.
    meant_destination_id     text NOT NULL,
    meant_shipment_reference text NOT NULL,
    dispatch_id              uuid NOT NULL REFERENCES dc_dispatch (dispatch_id),
    created_at               timestamptz NOT NULL,
    PRIMARY KEY (source_dc_id, destination_store_id, shipment_reference, epc),
    UNIQUE (source_dc_id, meant_destination_id, meant_shipment_reference, epc),
    CHECK (destination_store_id <> meant_destination_id)
);
