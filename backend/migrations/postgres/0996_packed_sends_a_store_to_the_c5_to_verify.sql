-- Packed sends a store to the C5 to verify (owner, 25 Oct 2026: "di packed
-- pilih toko untuk verify rfid, lalu muncul di c5 toko yg mau di verify rfid,
-- lalu scan lah di c5 … kalo sama baru button verify … tetap bisa dari packed
-- ke dispatch tanpa verify").
--
-- One row per store waiting for the handheld. Its koli are not listed here:
-- they are whatever of that store is packed when the C5 reads them, so a koli
-- sealed after the request is read with the rest. A verify that matches ends
-- the row; a store with no packed koli left drops off the next listing.
-- Nothing gates a dispatch on it. A new table, nothing else changes: the
-- binary before this one never reads it.
CREATE TABLE IF NOT EXISTS dc_koli_rfid_request (
    destination_store_id text PRIMARY KEY CHECK (btrim(destination_store_id) <> ''),
    requested_by         text NOT NULL CHECK (btrim(requested_by) <> ''),
    requested_at         timestamptz NOT NULL DEFAULT now()
);
