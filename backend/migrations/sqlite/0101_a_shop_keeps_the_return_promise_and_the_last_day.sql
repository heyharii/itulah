-- 0101: a shop keeps the return promise, and the last day of each sale.
--
-- The promise arrives on the auth policy (`AuthPolicySnapshot.return_policy`,
-- postgres 1005) and is stored whole. It is read twice: when a sale completes,
-- to write that sale's own last day, and when paper is printed, to say what
-- the customer must bring back.
--
-- `sale.return_by` is written at the sale and never recomputed. A policy
-- changed in November must not shorten the promise made on a receipt in
-- October — the customer holds the paper, and the paper is the promise. Old
-- sales have NULL here; a reprint of one falls back to the policy in force,
-- which is the best answer available for a sale whose promise nobody recorded.

CREATE TABLE IF NOT EXISTS return_policy_state (
    singleton    INTEGER PRIMARY KEY CHECK (singleton = 1),
    version      INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

ALTER TABLE sale ADD COLUMN return_by TEXT;
