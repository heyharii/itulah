-- An RFID key says whether its reader is carried or fixed.
--
-- `rfid_device` (0015) holds one key per physical reader and never said what
-- kind of reader it is: a handheld somebody walks the floor with and a fixed
-- reader over a door or a bench were the same row. The device register (0604)
-- has a word for each, HANDHELD and RFID_READER, and every one of them arrived
-- there as RFID_READER, because nothing anywhere knew better.
--
-- Head office registers the key, so head office says which it is. The word
-- travels to the node in the auth policy (`device_kinds`, kept outside the
-- policy's content hash for the reason `site` is: an older node recomputes the
-- hash from the fields it knows). The node files it on `edge_rfid_device`
-- (sqlite 0056) and reports the device under it; the register takes this
-- column's word over what a node older than that reports
-- (`cloud/postgres/devices.rs`).
--
-- Every key registered before this was registered without being asked, so it
-- is a fixed reader until an Admin says otherwise (System → Access). Nothing
-- reads the kind off a device id or a label.

ALTER TABLE rfid_device
    ADD COLUMN kind text NOT NULL DEFAULT 'RFID_READER'
        CHECK (kind IN ('RFID_READER', 'HANDHELD'));

COMMENT ON COLUMN rfid_device.kind IS
    'HANDHELD (carried) or RFID_READER (fixed), as head office registered the key. Sent to the node in the auth policy''s device_kinds; the node reports the device under it.';
