-- Offline-first authentication hardening.
--
-- Browser/API sessions are opaque, revocable records rather than self-contained
-- bearer JWTs.  The same migration also adds the Cloud-owned projections that
-- are published to an Edge over the existing signed downstream command lane.

ALTER TABLE app_user
    ADD COLUMN IF NOT EXISTS auth_version BIGINT NOT NULL DEFAULT 1
        CHECK (auth_version >= 1),
    ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0
        CHECK (failed_login_count >= 0),
    ADD COLUMN IF NOT EXISTS failed_login_window_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS login_blocked_until TIMESTAMPTZ;

CREATE TABLE auth_session (
    session_id UUID PRIMARY KEY,
    token_sha256 TEXT NOT NULL UNIQUE
        CHECK (length(token_sha256) = 64),
    csrf_token_sha256 TEXT NOT NULL
        CHECK (length(csrf_token_sha256) = 64),
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    auth_version BIGINT NOT NULL CHECK (auth_version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CHECK (expires_at > created_at)
);
CREATE INDEX auth_session_user_active_idx
    ON auth_session(user_id, expires_at)
    WHERE revoked_at IS NULL;

-- A Cloud password is never copied to an Edge.  Each assignment carries its
-- own Edge-only PIN/password verifier and is limited to one registered origin.
CREATE TABLE edge_identity_assignment (
    origin_id TEXT NOT NULL
        REFERENCES sync_origin_credential(origin_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    edge_role TEXT NOT NULL
        CHECK (edge_role IN ('CASHIER', 'SUPERVISOR', 'ADMIN')),
    credential_hash TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    auth_version BIGINT NOT NULL DEFAULT 1 CHECK (auth_version >= 1),
    offline_ttl_seconds INTEGER NOT NULL DEFAULT 604800
        CHECK (offline_ttl_seconds BETWEEN 900 AND 2592000),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (origin_id, user_id)
);
CREATE INDEX edge_identity_assignment_user_idx
    ON edge_identity_assignment(user_id, origin_id);

-- RFID credentials are per physical device and per Edge.  Cloud stores only a
-- digest of the one-time key.  The digest is the HMAC verification key sent in
-- the Edge policy projection; the plaintext is shown once at enrolment.
CREATE TABLE rfid_device (
    device_id TEXT PRIMARY KEY
        CHECK (length(device_id) BETWEEN 3 AND 96),
    origin_id TEXT NOT NULL
        REFERENCES sync_origin_credential(origin_id) ON DELETE CASCADE,
    label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 128),
    auth_key_sha256 TEXT NOT NULL
        CHECK (length(auth_key_sha256) = 64),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    offline_ttl_seconds INTEGER NOT NULL DEFAULT 604800
        CHECK (offline_ttl_seconds BETWEEN 900 AND 2592000),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ
);
CREATE INDEX rfid_device_origin_active_idx
    ON rfid_device(origin_id, active);

CREATE TABLE rfid_device_pool (
    device_id TEXT NOT NULL REFERENCES rfid_device(device_id) ON DELETE CASCADE,
    pool_id TEXT NOT NULL,
    PRIMARY KEY (device_id, pool_id)
);

-- Monotonic anti-rollback version for each Edge's complete auth projection.
CREATE TABLE edge_auth_snapshot_state (
    origin_id TEXT PRIMARY KEY
        REFERENCES sync_origin_credential(origin_id) ON DELETE CASCADE,
    next_version BIGINT NOT NULL DEFAULT 0 CHECK (next_version >= 0),
    last_issued_at TIMESTAMPTZ,
    last_command_id UUID
);

-- Edge-originated observations retain their authentication and sync
-- provenance. Cloud-direct observations leave these columns NULL.
ALTER TABLE observation_sighting
    ADD COLUMN IF NOT EXISTS operator_id TEXT,
    ADD COLUMN IF NOT EXISTS edge_origin_id TEXT,
    ADD COLUMN IF NOT EXISTS edge_batch_id UUID,
    ADD COLUMN IF NOT EXISTS device_sequence BIGINT
        CHECK (device_sequence IS NULL OR device_sequence >= 1);
CREATE INDEX IF NOT EXISTS observation_edge_batch_idx
    ON observation_sighting(edge_origin_id, edge_batch_id)
    WHERE edge_origin_id IS NOT NULL;
