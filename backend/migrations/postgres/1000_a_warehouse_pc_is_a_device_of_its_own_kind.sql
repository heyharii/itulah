-- A warehouse PC is a device of its own kind.
--
-- Central Gudang (client, 25 Oct 2026) is the POS app in a second edition, on
-- a PC in the store's back room: it receives the DC's deliveries, moves stock
-- between Gudang, Toko and Reject, and sends goods back to head office. It
-- joins its store's server the way a till does and head office approves it on
-- the store's POS tab (0994), but it is not a till: it is labelled "Gudang N",
-- it takes none of the store's POS seats (`site.till_count`), and its server
-- refuses it every selling call. The server reports it in its heartbeat as
-- `WAREHOUSE` (`sync/device.rs`), and head office stops or removes it as it
-- does a till (`device.status.set.v1`).
--
-- 0604 named the kinds the register admits in a column CHECK; this adds the
-- one word.

ALTER TABLE device DROP CONSTRAINT device_kind_check;

ALTER TABLE device ADD CONSTRAINT device_kind_check CHECK (kind IN (
    'TILL', 'WAREHOUSE', 'HANDHELD', 'RFID_READER', 'PRINTER', 'EDC', 'ATTENDANCE_TERMINAL'
));
