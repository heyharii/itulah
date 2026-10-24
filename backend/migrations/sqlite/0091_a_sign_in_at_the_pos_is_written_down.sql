-- Who signed in at the store's POS, when, where and how (24 Oct 2026): head
-- office's view of each person's activity, carried in the heartbeat
-- (`NodeStatus::sign_ins`). Kept thirty days; the heartbeat carries two.
-- Creates only.
CREATE TABLE IF NOT EXISTS edge_sign_in (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL,
    at          TEXT NOT NULL,
    method      TEXT NOT NULL CHECK (method IN ('PASSWORD', 'FINGER', 'PIN', 'ON_BEHALF')),
    -- The POS seat it happened at (`KASIR-1`), when the POS said.
    terminal    TEXT,
    -- For ON_BEHALF, the store head who opened the POS.
    by_username TEXT
);

CREATE INDEX IF NOT EXISTS ix_edge_sign_in_at ON edge_sign_in (at);
