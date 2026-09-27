-- 0061: A node knows whether its store is open, and a device prints a test
-- page when head office asks.
--
-- Two things head office now says to a node, both on the way to a store's
-- first sale (`store-opening-flow.html`):
--
-- * **Whether the store is open.** Head office opens a store from the hub
--   once its server, tills, team, payments and first stock are ready (postgres
--   0630). Until then the store's tills open no shift. The auth policy's site
--   directory (0049) carries it per site, as `opened`; NULL is a centre that
--   has not said — an older one, or a node that has not heard yet — and is
--   read as open, because every store such a centre knew was already trading.
--
-- * **A test page.** Head office asks for one from a device's row in the hub
--   (`device.test_print.v1`, `sync::device`). The ask waits here, in
--   `edge_device_request`, until it is done: a network printer is printed to
--   by this node, a till picks its asks up with its signed poll
--   (`GET /api/v1/devices/self/requests`) and reports how the page came out.
--   The outcome is kept on the device's own row — the till's
--   (`edge_terminal`) or the printer's (`edge_printer`) — and travels to head
--   office in the heartbeat's device list. An ask nobody carried out in an
--   hour is closed as EXPIRED, so a till switched off for the night does not
--   print last week's pages when it wakes.
--
-- SQLite has no `ADD COLUMN IF NOT EXISTS`, so this file is applied once,
-- guarded in `edge/sqlite.rs` by the presence of `site_directory.opened`, and
-- inside one transaction so a run that dies half way leaves nothing
-- half-added.

BEGIN;

ALTER TABLE site_directory ADD COLUMN opened INTEGER
    CHECK (opened IS NULL OR opened IN (0, 1));

ALTER TABLE edge_terminal ADD COLUMN last_test_print_at TEXT;
ALTER TABLE edge_terminal ADD COLUMN last_test_print_ok INTEGER
    CHECK (last_test_print_ok IS NULL OR last_test_print_ok IN (0, 1));
ALTER TABLE edge_terminal ADD COLUMN last_test_print_error TEXT;

ALTER TABLE edge_printer ADD COLUMN last_test_print_at TEXT;
ALTER TABLE edge_printer ADD COLUMN last_test_print_ok INTEGER
    CHECK (last_test_print_ok IS NULL OR last_test_print_ok IN (0, 1));
ALTER TABLE edge_printer ADD COLUMN last_test_print_error TEXT;

CREATE TABLE IF NOT EXISTS edge_device_request (
    -- Head office's id for the ask: the command's.
    request_id   TEXT PRIMARY KEY,
    device_id    TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('TILL', 'PRINTER')),
    request      TEXT NOT NULL CHECK (request IN ('TEST_PRINT')),
    requested_by TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    received_at  TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING', 'DONE', 'EXPIRED')),
    completed_at TEXT,
    ok           INTEGER CHECK (ok IS NULL OR ok IN (0, 1)),
    error        TEXT,
    CHECK ((status = 'PENDING') = (completed_at IS NULL)),
    CHECK ((status = 'DONE') = (ok IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS edge_device_request_waiting
    ON edge_device_request (device_id, requested_at) WHERE status = 'PENDING';

COMMIT;
