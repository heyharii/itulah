-- Destination-scoped trust and one-time ticket replay protection for
-- Cloud-to-DC session exchange. The verifier is delivered in the signed
-- auth-policy command; the private signing seed never leaves Cloud.

CREATE TABLE IF NOT EXISTS edge_sso_trust (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    origin_id TEXT NOT NULL,
    node_role TEXT NOT NULL CHECK (node_role IN ('DC','STORE')),
    policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
    public_key_hex TEXT CHECK (public_key_hex IS NULL OR length(public_key_hex) = 64),
    valid_until TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edge_sso_ticket_replay (
    jti TEXT PRIMARY KEY,
    expires_at_epoch INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS edge_sso_ticket_replay_expiry_idx
    ON edge_sso_ticket_replay(expires_at_epoch);
