-- 0056: A node knows which of its RFID readers are carried.
--
-- `edge_rfid_device` (0004) is head office's list of the keys this node
-- trusts, and it said nothing about the machine holding each key. So the node
-- reported every one of them to the device register as a fixed RFID_READER,
-- the handhelds on the floor included.
--
-- Head office now says which each key is (postgres 0623, `rfid_device.kind`)
-- in the auth policy's `device_kinds`, and this column keeps the latest word:
-- HANDHELD or RFID_READER. A key head office has not described — a policy
-- from an older centre — is a fixed reader, which is what it was reported as
-- before.
--
-- An ALTER: applied once, probed by the column it adds.

ALTER TABLE edge_rfid_device ADD COLUMN kind TEXT NOT NULL DEFAULT 'RFID_READER'
    CHECK (kind IN ('RFID_READER', 'HANDHELD'));
