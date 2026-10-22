-- 0082: A reader keeps its receipts when its key changes.
--
-- Rotating a reader's key starts a new sequence epoch: the node sets the
-- device's `last_sequence` back to 0, because a re-enrolled handheld may count
-- again from 1. 0004 also made every receipt reserve its sequence —
-- `UNIQUE(device_id, sequence)` — so the new epoch could not use the numbers
-- the old one had, and the node deleted the device's receipts on every
-- rotation to free them.
--
-- That deletion is what filed evidence twice. A handheld whose answer was lost
-- under the old key sends the same batch again under the new one; with its
-- receipt gone the node took it for new, filed it under a new batch id with
-- new observation ids, and the cloud — which deduplicates by observation id —
-- stored every tag in it twice.
--
-- Nothing needs the reservation. Inside one epoch the claim in `edge::rfid`
-- (`UPDATE edge_rfid_device SET last_sequence=? WHERE last_sequence<?`) already
-- refuses any sequence that is not new; across epochs a reused number is the
-- point of the reset. What a receipt is for is answering its idempotency key,
-- which stays the primary key. So the table is rebuilt without the
-- constraint, the rows carried over, and the node stops deleting them
-- (`edge::sync::apply_auth_policy`). A replay still has to be signed with the
-- device's current key; a receipt answers only the device and the bytes it
-- was written for.
--
-- SQLite cannot drop a UNIQUE constraint, so this is the 0075 pattern: applied
-- once, while the constraint is still in the table (`edge::sqlite` probes
-- `pragma_index_list` for it), in one transaction.

BEGIN IMMEDIATE;

CREATE TABLE edge_rfid_batch_receipt_next (
    idempotency_key TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    request_digest TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

INSERT INTO edge_rfid_batch_receipt_next
    (idempotency_key, device_id, sequence, request_digest, response_json, created_at)
SELECT idempotency_key, device_id, sequence, request_digest, response_json, created_at
  FROM edge_rfid_batch_receipt;

DROP TABLE edge_rfid_batch_receipt;
ALTER TABLE edge_rfid_batch_receipt_next RENAME TO edge_rfid_batch_receipt;

COMMIT;
