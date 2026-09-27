-- 0046: A shop knows what is on the lorry, and counts it blind.
--
-- Head office announces every koli that leaves the DC for this shop
-- (`inventory.store_inbound.announce.v1`, issued when the centre applies the
-- koli's IN_TRANSIT fact). Several koli of one surat jalan merge into ONE
-- delivery, keyed deterministically by the DC and the surat-jalan number (or
-- the koli, when there is none), so the same announcement always lands on the
-- same row.
--
-- The manifest is kept here but never shown before the delivery is received:
-- the handheld sweeps, the shop submits what it read, and only then is the
-- comparison — expected, received, missing, extra — written down and shown.
--
-- `store_inbound_unit.outcome` is NULL until the receipt; after it every
-- manifest unit is RECEIVED (booked by this receipt) or MISSING (not booked,
-- still in transit at the centre, which is head office's discrepancy).
-- `late_announcement` marks a unit announced after the delivery was already
-- received: recorded, never counted.
--
-- `store_inbound_extra` is what the shop read that was not on the manifest and
-- booked anyway (its SKU decodes from the EPC).
--
-- All `IF NOT EXISTS`: creates rather than changes, runs on every open.

CREATE TABLE IF NOT EXISTS store_inbound_delivery (
    delivery_id         TEXT PRIMARY KEY,
    source_site_id      TEXT NOT NULL,
    shipment_reference  TEXT,
    departed_at         TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'IN_TRANSIT'
                        CHECK (status IN ('IN_TRANSIT', 'RECEIVED')),
    received_at         TEXT,
    received_by         TEXT,
    -- The receipt that closed it: its idempotency key, the digest of the EPC
    -- set it was received with, and what could not be booked.
    receive_idempotency_key TEXT,
    receive_digest      TEXT,
    skipped_epcs_json   TEXT NOT NULL DEFAULT '[]',
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    CHECK ((status = 'RECEIVED') = (received_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS store_inbound_delivery_by_departure
    ON store_inbound_delivery (departed_at DESC);

CREATE TABLE IF NOT EXISTS store_inbound_unit (
    delivery_id         TEXT NOT NULL REFERENCES store_inbound_delivery(delivery_id),
    koli_id             TEXT NOT NULL,
    epc                 TEXT NOT NULL,
    sku_code            TEXT NOT NULL,
    allotment_line_id   TEXT,
    outcome             TEXT CHECK (outcome IS NULL OR outcome IN ('RECEIVED', 'MISSING')),
    late_announcement   INTEGER NOT NULL DEFAULT 0 CHECK (late_announcement IN (0, 1)),
    command_id          TEXT,
    created_at          TEXT NOT NULL,
    UNIQUE (delivery_id, epc)
);

CREATE INDEX IF NOT EXISTS store_inbound_unit_by_koli
    ON store_inbound_unit (koli_id);

CREATE TABLE IF NOT EXISTS store_inbound_extra (
    delivery_id         TEXT NOT NULL REFERENCES store_inbound_delivery(delivery_id),
    epc                 TEXT NOT NULL,
    sku_code            TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    UNIQUE (delivery_id, epc)
);
