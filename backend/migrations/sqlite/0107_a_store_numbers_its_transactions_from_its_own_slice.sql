-- 0107: a store numbers its transactions from its own slice.
--
-- Head office's slices of the fleet's 7-letter numbers (postgres 1010), as the
-- auth policy last sent them, and how many this store has numbered from them.
-- The n-th number is the n-th place across the slices in the order they were
-- granted; its code is that number scrambled (`cloud::domain::receipt_number`).
-- With no slice yet, a sale is numbered the old way, so the till never stops.
--
-- `IF NOT EXISTS`: creates only, runs on every open.

CREATE TABLE IF NOT EXISTS receipt_slice_state (
    start INTEGER PRIMARY KEY CHECK (start >= 0),
    size  INTEGER NOT NULL CHECK (size > 0)
);

CREATE TABLE IF NOT EXISTS receipt_slice_counter (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    used      INTEGER NOT NULL CHECK (used >= 0)
);
