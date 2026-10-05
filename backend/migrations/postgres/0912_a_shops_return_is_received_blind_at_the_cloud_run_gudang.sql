-- A shop's return is received blind at the Gudang the cloud runs
-- (DC-CLOUD-NATIVE.md, src/cloud/dc/returns.rs).
--
-- With a DC server in the warehouse, head office announced every koli a shop
-- sent back (`inventory.store_inbound.announce.v1`) and the server kept the
-- manifest and its receipt in its own SQLite (`store_inbound_delivery`,
-- `store_inbound_unit`, `store_inbound_extra`). The cloud-run Gudang has no
-- node to announce to: the manifest is the shop's own IN_TRANSIT fact, which
-- the cloud already holds (`edge_fulfillment_progress_fact` and its units).
-- What it lacks is the receipt — the one blind count, what it found, what it
-- did not book and why — and that is kept here.

-- 1. The koli on their way to the Gudang, keyed by the delivery a DC server
--    would have filed them under: one per (shop, surat jalan), or per koli
--    when it travels without one. The same digest as
--    `edge::inbound::delivery_id_for`, so a delivery has one id everywhere.
CREATE OR REPLACE VIEW dc_inbound_koli AS
SELECT 'inb-' || substr(encode(sha256(convert_to(
           CASE WHEN NULLIF(btrim(f.shipment_reference), '') IS NOT NULL
                THEN btrim(f.source_site_id) || E'\nSJ\n' || btrim(f.shipment_reference)
                ELSE btrim(f.source_site_id) || E'\nKOLI\n' || f.koli_id::text
           END, 'UTF8')), 'hex'), 1, 32) AS delivery_id,
       f.event_id,
       f.origin_id,
       f.koli_id,
       f.source_site_id,
       f.destination_store_id,
       NULLIF(btrim(f.shipment_reference), '') AS shipment_reference,
       f.occurred_at AS departed_at
  FROM edge_fulfillment_progress_fact f
 WHERE f.stage = 'IN_TRANSIT'
   AND f.destination_store_id = head_office_site_id();

COMMENT ON VIEW dc_inbound_koli IS
    'Koli in transit to the cloud-run Gudang (0912), keyed by delivery as edge::inbound::delivery_id_for keys them.';

-- 2. The receipt: one per delivery, never two.
CREATE TABLE IF NOT EXISTS dc_inbound_receipt (
    delivery_id          text PRIMARY KEY CHECK (btrim(delivery_id) <> ''),
    receipt_id           uuid NOT NULL UNIQUE,
    source_site_id       text NOT NULL,
    -- The Gudang as the shop's fact spells it: the claims pair on it.
    destination_site_id  text NOT NULL,
    shipment_reference   text,
    -- Where the goods landed: the shop's return pool here, else the stockroom.
    landing_pool_id      text NOT NULL REFERENCES operational_pool (id),
    departed_at          timestamptz NOT NULL,
    koli_count           bigint NOT NULL CHECK (koli_count >= 0),
    received_by          text NOT NULL CHECK (btrim(received_by) <> ''),
    received_at          timestamptz NOT NULL,
    idempotency_key      text NOT NULL UNIQUE,
    -- The set of tags read: the same sweep sent again is a resend.
    receive_digest       text NOT NULL,
    -- Tags read and not booked: already on the books, or not one of ours.
    skipped_epcs         jsonb NOT NULL DEFAULT '[]'::jsonb
                         CHECK (jsonb_typeof(skipped_epcs) = 'array'),
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_dc_inbound_receipt_received
    ON dc_inbound_receipt (received_at DESC);

-- 3. Every piece of it: the manifest's, found or not, and the tags read that
--    no koli held.
CREATE TABLE IF NOT EXISTS dc_inbound_unit (
    delivery_id       text NOT NULL REFERENCES dc_inbound_receipt (delivery_id),
    epc               text NOT NULL CHECK (btrim(epc) <> '' AND epc = upper(epc)),
    sku_code          text NOT NULL CHECK (btrim(sku_code) <> ''),
    koli_id           uuid,
    allotment_line_id uuid,
    -- RECEIVED: on the manifest and booked. MISSING: on the manifest, not
    -- booked. EXTRA: read, on no koli, booked.
    outcome           text NOT NULL CHECK (outcome IN ('RECEIVED', 'MISSING', 'EXTRA')),
    subject_id        uuid REFERENCES inventory_subject (id),
    PRIMARY KEY (delivery_id, epc),
    CHECK ((outcome = 'MISSING') = (subject_id IS NULL)),
    CHECK (outcome <> 'EXTRA' OR koli_id IS NULL)
);

COMMENT ON TABLE dc_inbound_receipt IS
    'A shop''s return received blind at the cloud-run Gudang (0912): one receipt per delivery.';
COMMENT ON TABLE dc_inbound_unit IS
    'The pieces of a received return (0912): RECEIVED, MISSING, or EXTRA (read, on no koli).';
