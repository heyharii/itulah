-- Local authentication and Cloud-owned authorization projection.
--
-- Cloud-projected rows are replaced atomically by auth.policy.replace.  LOCAL
-- rows are break-glass users created from explicit node bootstrap configuration
-- and are never overwritten by synchronization.

CREATE TABLE IF NOT EXISTS edge_user (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('CASHIER','SUPERVISOR','ADMIN')),
    active INTEGER NOT NULL CHECK (active IN (0,1)),
    auth_version INTEGER NOT NULL DEFAULT 1 CHECK (auth_version >= 1),
    source TEXT NOT NULL CHECK (source IN ('CLOUD','LOCAL')),
    policy_version INTEGER,
    valid_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT,
    failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
    failed_login_window_started_at TEXT,
    login_blocked_until TEXT
);
CREATE INDEX IF NOT EXISTS edge_user_active_idx
    ON edge_user(active, role, valid_until);

CREATE TABLE IF NOT EXISTS edge_auth_session (
    session_id TEXT PRIMARY KEY,
    token_sha256 TEXT NOT NULL UNIQUE,
    csrf_token_sha256 TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES edge_user(id) ON DELETE CASCADE,
    auth_version INTEGER NOT NULL CHECK (auth_version >= 1),
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS edge_auth_session_user_idx
    ON edge_auth_session(user_id, expires_at);

CREATE TABLE IF NOT EXISTS edge_rfid_device (
    device_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    auth_key_sha256 TEXT NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0,1)),
    valid_until TEXT NOT NULL,
    last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
    last_request_digest TEXT,
    last_seen_at TEXT,
    policy_version INTEGER NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edge_rfid_device_pool (
    device_id TEXT NOT NULL REFERENCES edge_rfid_device(device_id) ON DELETE CASCADE,
    pool_id TEXT NOT NULL,
    PRIMARY KEY (device_id, pool_id)
);

CREATE TABLE IF NOT EXISTS edge_auth_policy_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    snapshot_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    origin_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    node_role TEXT NOT NULL CHECK (node_role IN ('DC','STORE')),
    issued_at TEXT NOT NULL,
    valid_until TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    activated_at TEXT NOT NULL
);

-- Local RFID evidence. Observations never mutate the movement ledger.
CREATE TABLE IF NOT EXISTS edge_observation_sighting (
    observation_id TEXT PRIMARY KEY,
    epc TEXT NOT NULL,
    site_id TEXT NOT NULL,
    pool_id TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    device_id TEXT NOT NULL,
    reader_session_id TEXT NOT NULL,
    operator_id TEXT,
    read_count INTEGER NOT NULL CHECK (read_count > 0),
    best_rssi REAL,
    antenna TEXT
);
CREATE INDEX IF NOT EXISTS edge_observation_burst_idx
    ON edge_observation_sighting(device_id, reader_session_id, pool_id, epc, last_seen_at);

CREATE TABLE IF NOT EXISTS edge_rfid_batch_receipt (
    idempotency_key TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    request_digest TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(device_id, sequence)
);
