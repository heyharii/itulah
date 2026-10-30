-- 0099: MD raises, edits and cancels an allotment on the Gudang server, and
-- the Gudang sees what she changed.
--
-- GUDANG-SERVER-PLAN.md step 4 (`edge::dc_allotment`). Once the pen has moved
-- the server is the only writer of the Gudang's allotments: MD at head office
-- changes them here over the LAN, MD elsewhere through Central, which forwards
-- `inventory.allotment.amend.v1`. The books are the cloud-run Gudang's
-- (postgres 0938, 0964), kept beside `dc_allotment_work_line` rather than as
-- columns on it, because SQLite cannot add a column only when it is missing:
--
-- * every change MD made, one row per line — the history behind "300 → 250",
--   and what the board's "Changes" strip lists until somebody taps Got it;
-- * the acknowledgements of those changes (and of a cancellation Central
--   sent as `inventory.allotment.cancel.v1`, by its cancellation id);
-- * the pieces MD took out of cartons that have not left. They stay packed
--   until the Gudang opens the carton (`move_back`), which writes them off
--   the line's demand then — as the cloud's `takeout_pending_quantity`;
-- * MD's cancel of a whole allotment, for the board's CANCELLED stamp;
-- * the server's own allotment numbers, `ALT-G…`, so one raised while the
--   line is down never collides with Central's `ALT-…`;
-- * the answers already given, by idempotency key, so a retried press does
--   the change once.
--
-- `IF NOT EXISTS`: creates only, runs on every open.

CREATE TABLE IF NOT EXISTS dc_allotment_amendment (
    amendment_id      TEXT PRIMARY KEY,
    allotment_id      TEXT NOT NULL REFERENCES dc_allotment_work(allotment_id),
    allotment_line_id TEXT NOT NULL REFERENCES dc_allotment_work_line(allotment_line_id),
    kind              TEXT NOT NULL CHECK (kind IN ('REDUCE', 'ADD', 'CANCEL')),
    target_before     INTEGER NOT NULL CHECK (target_before >= 0),
    target_after      INTEGER NOT NULL CHECK (target_after >= 0),
    released          INTEGER NOT NULL DEFAULT 0 CHECK (released >= 0),
    owed              INTEGER NOT NULL DEFAULT 0 CHECK (owed >= 0),
    cancelled_now     INTEGER NOT NULL DEFAULT 0 CHECK (cancelled_now >= 0),
    reason            TEXT,
    actor_id          TEXT NOT NULL CHECK (trim(actor_id) <> ''),
    created_at        TEXT NOT NULL,
    -- Central's request, when the change came by the outside road.
    request_id        TEXT
);
CREATE INDEX IF NOT EXISTS ix_dc_allotment_amendment_allotment
    ON dc_allotment_amendment (allotment_id, created_at);
CREATE INDEX IF NOT EXISTS ix_dc_allotment_amendment_line
    ON dc_allotment_amendment (allotment_line_id);

CREATE TABLE IF NOT EXISTS dc_allotment_change_ack (
    -- An amendment id, or a cancellation id from `dc_allotment_cancellation`.
    change_id       TEXT PRIMARY KEY,
    actor_id        TEXT NOT NULL CHECK (trim(actor_id) <> ''),
    acknowledged_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dc_allotment_takeout (
    allotment_line_id TEXT PRIMARY KEY REFERENCES dc_allotment_work_line(allotment_line_id),
    pending           INTEGER NOT NULL CHECK (pending >= 0),
    updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dc_allotment_md_cancel (
    allotment_id TEXT PRIMARY KEY REFERENCES dc_allotment_work(allotment_id),
    reason       TEXT,
    actor_id     TEXT NOT NULL CHECK (trim(actor_id) <> ''),
    cancelled_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dc_allotment_number (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    last      INTEGER NOT NULL CHECK (last >= 0)
);

CREATE TABLE IF NOT EXISTS dc_allotment_request (
    idempotency_key TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    request_json    TEXT NOT NULL,
    response_json   TEXT NOT NULL,
    created_at      TEXT NOT NULL
);
