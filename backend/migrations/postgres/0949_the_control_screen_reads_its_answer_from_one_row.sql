-- The Inventory Control screen asks whether the ledger and what is drawn
-- from it still agree, and the honest answer folds every movement fact
-- against the projection and counts what disagrees: a minute on the load
-- estate's 8.8 million facts, on every open, for numbers that describe the
-- estate's integrity rather than a live second — they change when the
-- ledger or a replay changes, not when the page is opened.
--
-- So the whole-ledger answer is written down: a pass
-- (`refresh_control_state`, every fifteen minutes) recomputes it on a
-- connection of its own with the statement clock off — the fold can outlast
-- the database's two-minute timeout on two vCPUs — and upserts this one
-- row, and the route reads it back in milliseconds with `computed_at`
-- saying how old it is. Asks that narrow, search, sort another way or page
-- past the first page still compute live, exactly as before; the row holds
-- the screen's own answer only.
--
-- The singleton shape is 0931's (`store_stock_refresh`): one row, because
-- there is one estate. No seed row — a database the pass has not visited
-- yet has the route compute once and write the answer itself.

CREATE TABLE inventory_control_state (
    singleton   boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    payload     jsonb NOT NULL,
    computed_at timestamptz NOT NULL DEFAULT now()
);
