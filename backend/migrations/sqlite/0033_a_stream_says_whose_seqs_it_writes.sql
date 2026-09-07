-- A node has to agree whose seqs it is writing before it writes any.
--
-- `sync_origin` has always held a generation, and the number was decided
-- locally: provisioning writes 1 and nothing ever asked the cloud whether 1
-- was still free. That is fine exactly once. Restore this database from a
-- backup, or replace it and re-provision under the same node id, and it starts
-- allocating seq 1, 2, 3 into a stream the cloud is already durable through
-- 5,000 of. Every one of those sales is discarded as a duplicate, the cloud
-- answers "durable through 5,000", the sender takes that as acknowledgement,
-- advances and purges. Nothing fails. The evening's takings exist nowhere.
--
-- These three columns are the record of the conversation that prevents it.
--
-- `handshake_settled` is the gate: 0 means this node has not agreed a
-- generation with the receiver and may not upload. It keeps capturing —
-- `enqueue_fact` reads none of this — so a shop whose cloud is unreachable
-- queues durably instead of pushing a day of sales into seqs that will be
-- discarded.
--
-- The gate is deliberately cleared by the SENDER at every start-up, not only
-- when this column is new. A restored backup carries whatever value it was
-- saved with, so a column that were trusted across a restore would be trusted
-- in precisely the case it exists to catch. What is durable here is the RECORD
-- of the last agreement — which generation, when, and on what grounds — and a
-- record is worth keeping even though the decision is retaken each boot.
-- Renegotiating costs one request, and for a healthy node the answer is "keep
-- the stream you have".

ALTER TABLE sync_origin ADD COLUMN handshake_settled INTEGER NOT NULL DEFAULT 0
    CHECK (handshake_settled IN (0, 1));

-- When the agreement was reached, and what the receiver said about it. Kept
-- because "which generation am I on" is answerable from the generation column
-- and "why am I on it" is not, and the second question is the one asked at
-- eleven at night about a shop whose numbers moved.
ALTER TABLE sync_origin ADD COLUMN handshake_at TEXT;
ALTER TABLE sync_origin ADD COLUMN handshake_note TEXT;
