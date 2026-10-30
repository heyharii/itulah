-- 1010: every store numbers its transactions from its own slice.
--
-- The 7-letter transaction number (Hari, 30 Oct 2026) is one run of numbers
-- 0 … 26⁷−1 for the whole fleet, scrambled into letters by a fixed
-- permutation (`cloud::domain::receipt_number`). Head office hands each store
-- server slices of the run that no other store holds, so a store offline for
-- weeks still numbers nothing another store numbers. A slice belongs to one
-- install of a store (`origin_id`, `generation`): a store set up again starts
-- from a fresh slice, never from the numbers its old database already used.
-- A store is given its next slice when its synced sales reach 80% of what it
-- holds.

CREATE TABLE IF NOT EXISTS receipt_slice (
    start      BIGINT PRIMARY KEY CHECK (start >= 0),
    size       BIGINT NOT NULL CHECK (size > 0),
    origin_id  TEXT NOT NULL,
    generation BIGINT NOT NULL,
    issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (start + size <= 8031810176)
);

CREATE INDEX IF NOT EXISTS receipt_slice_origin ON receipt_slice (origin_id, generation, start);
