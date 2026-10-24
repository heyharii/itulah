-- 0083: A shop reads the koli label.
--
-- The delivery is no longer counted blind (owner, 23 Oct 2026): the shop sees
-- what was packed, and scanning a koli's label (`KL-…`, or its `K1:` QR) or the
-- surat jalan opens what is in it. The label's number travels with the
-- announcement; one row per koli, kept from the first announcement that names
-- it.
--
-- `IF NOT EXISTS`: creates only, runs on every open.

CREATE TABLE IF NOT EXISTS store_inbound_koli (
    koli_id      TEXT PRIMARY KEY,
    delivery_id  TEXT NOT NULL REFERENCES store_inbound_delivery(delivery_id),
    koli_number  TEXT
);

CREATE INDEX IF NOT EXISTS store_inbound_koli_by_number
    ON store_inbound_koli (upper(koli_number));
