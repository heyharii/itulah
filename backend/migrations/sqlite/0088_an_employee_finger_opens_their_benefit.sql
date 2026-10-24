-- An employee's finger opens their benefit balance (client, 24 Oct 2026).
--
-- The employee discount is a rupiah balance kept at head office (cloud 0818).
-- It used to be opened by a six-digit code from the employee's phone; the
-- client wants the employee's own finger on the till's scanner instead, and
-- no code.
--
-- The matching happens on the till, exactly as for a sign-in or a supervisor's
-- yes (`0039`): the till says which enrolment matched, signed with its pairing
-- secret, and this node decides what that is worth. Here it is worth one
-- grant: a token the till puts on the benefit lookup and the spend instead of
-- a code. The node relays the grant's person to head office; the till never
-- names a person itself.
--
-- # Why not `edge_supervisor_grant`
--
-- Any active person's finger earns this grant, a cashier's included. A grant
-- in the supervisor table is spent on a void or a return, and the people who
-- spend those do not ask whose finger bought it — they ask whether it is a
-- supervisor's grant. A cashier's finger must never be one. So it lives apart.
--
-- # Why the claim is written down here, not in `edge_fingerprint_claim`
--
-- That table's `purpose` CHECK names SESSION and SUPERVISOR only, and widening
-- a CHECK in SQLite is a table rebuild of the shop's whole claim history. A
-- benefit claim is written here instead, accepted or refused, with the same
-- columns that matter: which terminal, which finger, whose, why not.
--
-- Creates only, IF NOT EXISTS: applied every boot, no probe.

CREATE TABLE IF NOT EXISTS edge_benefit_finger (
    claim_id TEXT PRIMARY KEY,
    -- The paired terminal that made the claim (`edge_terminal`).
    terminal_id TEXT NOT NULL,
    -- Null when the till matched nothing — an answer, kept as one.
    finger_id TEXT,
    username TEXT,
    accepted INTEGER NOT NULL CHECK (accepted IN (0,1)),
    refusal TEXT,
    score INTEGER,
    claimed_at TEXT NOT NULL,
    -- Only on an accepted claim. The hash, never the token: a token readable
    -- out of this table would be a balance anybody with the file can spend.
    grant_token_sha256 TEXT UNIQUE,
    expires_at TEXT,
    -- Set when a spend used it, with the till's basket it paid. Kept rather
    -- than deleted, so "whose finger paid this sale" survives the sale.
    spent_at TEXT,
    sale_ref TEXT,
    CHECK (accepted = 0 OR (grant_token_sha256 IS NOT NULL AND expires_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS edge_benefit_finger_at
    ON edge_benefit_finger(claimed_at);
