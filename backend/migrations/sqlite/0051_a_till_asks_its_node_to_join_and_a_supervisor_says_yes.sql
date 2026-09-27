-- A till asks its node to join, and a supervisor at the shop says yes.
--
-- Until now a till was paired by an Admin signed in at the node, who typed a
-- label and was handed the till's secret in the response (`POST
-- /api/v1/auth/terminals`, `edge/fingerprint.rs::pair_terminal`). The secret
-- was born on the node and crossed the counter in the clear; a new till needed
-- whoever held the Admin password; and head office never learnt the till
-- existed.
--
-- This is node enrolment (postgres `0397`) one level down:
--
--   ISSUED + CLAIMED — the till mints its own secret, sends only its SHA-256
--                      and what it says about itself, and gets back a short
--                      code and the six-digit verification number derived from
--                      the code and the digest. The code is born bound to one
--                      machine, so issue and claim are one step here.
--   decided          — a supervisor at the shop approves (or refuses) the
--                      request whose code and number match the till in front
--                      of them. Approval writes the `edge_terminal` row with
--                      the claimed digest; the node never sees the secret.
--
-- The code is kept in the clear because it is not a credential here: it is the
-- handle both screens print so the right request is picked from the list. The
-- verification number is what a request from some other machine on the shop's
-- wifi cannot fake. See `backend/src/sync/device.rs` and `edge/devices.rs`.
--
-- Every statement is `IF NOT EXISTS`, so this runs on every open without a
-- probe, like the petty-cash and attendance schemas.

CREATE TABLE IF NOT EXISTS edge_device_join (
    join_id        TEXT PRIMARY KEY,
    -- Only a till joins this way today. A handheld still takes its credential
    -- from head office's RFID policy.
    kind           TEXT NOT NULL DEFAULT 'TILL' CHECK (kind IN ('TILL')),
    code           TEXT NOT NULL,
    key_sha256     TEXT NOT NULL CHECK (length(key_sha256) = 64),
    verification   TEXT NOT NULL,
    -- What the till says about itself: hostname, OS, version. Shown to the
    -- supervisor so they can tell the new till from somebody's laptop; never
    -- trusted for anything else.
    machine_json   TEXT NOT NULL DEFAULT '{}',
    issued_at      TEXT NOT NULL,
    expires_at     TEXT NOT NULL,

    outcome        TEXT CHECK (outcome IN ('APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED')),
    decided_by     TEXT,
    -- How the approver proved who they were: a supervisor's finger or PIN
    -- pressed at a till already joined (`GRANT`, spent from
    -- `edge_supervisor_grant`), or a signed-in supervisor session (`SESSION`),
    -- which is how a shop's first till is approved — there is no till yet to
    -- press a finger on.
    decided_via    TEXT CHECK (decided_via IS NULL OR decided_via IN ('GRANT', 'SESSION', 'SYSTEM')),
    decided_at     TEXT,
    -- The till the approval created, and the one it replaced, if any.
    terminal_id    TEXT,
    replaces_terminal_id TEXT,
    -- When the till first read its approval. An approval the till never picked
    -- up is a machine that is still waiting, not a till.
    delivered_at   TEXT,

    CHECK ((outcome IS NULL) = (decided_at IS NULL)),
    CHECK ((outcome IS NULL) = (decided_by IS NULL)),
    CHECK (outcome IS NOT 'APPROVED' OR terminal_id IS NOT NULL),
    CHECK (delivered_at IS NULL OR outcome = 'APPROVED')
);

-- Two undecided requests never show the same code: the supervisor picks by it.
CREATE UNIQUE INDEX IF NOT EXISTS ux_edge_device_join_open_code
    ON edge_device_join (code) WHERE outcome IS NULL;

CREATE INDEX IF NOT EXISTS ix_edge_device_join_issued
    ON edge_device_join (issued_at);

-- What happened to each device at this node, oldest first, append-only.
--
-- A till's row says what it is now; this says how it got there — joined,
-- suspended at nine in the evening by whom, revoked when it was replaced. The
-- same record `attendance_terminal.history` keeps at head office, as rows,
-- because a SQLite trigger can refuse an UPDATE and cannot police a JSON array.
CREATE TABLE IF NOT EXISTS edge_device_event (
    event_id   TEXT PRIMARY KEY,
    device_id  TEXT NOT NULL,
    kind       TEXT NOT NULL,
    event      TEXT NOT NULL CHECK (event IN (
                   'JOINED', 'RECORDED', 'CHANGED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REPLACED'
               )),
    actor      TEXT NOT NULL,
    reason     TEXT,
    at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_edge_device_event_device
    ON edge_device_event (device_id, at);

CREATE TRIGGER IF NOT EXISTS edge_device_event_reject_update
BEFORE UPDATE ON edge_device_event
BEGIN
    SELECT RAISE(ABORT, 'edge_device_event is append-only');
END;

CREATE TRIGGER IF NOT EXISTS edge_device_event_reject_delete
BEFORE DELETE ON edge_device_event
BEGIN
    SELECT RAISE(ABORT, 'edge_device_event is append-only');
END;
