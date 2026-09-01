-- The edge half of the sync engine, on SQLite.
--
-- Same tables, same invariants, same protocol as the Postgres side — only the
-- types and the concurrency primitive differ. SQLite has one writer, so the
-- seq allocator needs no row lock: `BEGIN IMMEDIATE` takes the write lock for
-- the whole transaction, which is exactly the serialization `FOR UPDATE`
-- buys on Postgres.
--
-- Type mapping, stated once: uuid -> TEXT (hyphenated, lowercase),
-- timestamptz -> TEXT (RFC3339 UTC), jsonb -> TEXT (compact JSON), boolean ->
-- INTEGER 0/1. The wire shape is unchanged, so a store on SQLite and a DC on
-- SQLite talk to the same cloud with the same bytes.

CREATE TABLE IF NOT EXISTS sync_origin (
    singleton       INTEGER PRIMARY KEY CHECK (singleton = 1),
    origin_id       TEXT NOT NULL,
    generation      INTEGER NOT NULL CHECK (generation >= 1),
    next_seq        INTEGER NOT NULL DEFAULT 0 CHECK (next_seq >= 0),
    enqueue_enabled INTEGER NOT NULL DEFAULT 1 CHECK (enqueue_enabled IN (0, 1)),
    provisioned_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_generation_bootstrap (
    origin_id    TEXT NOT NULL,
    generation   INTEGER NOT NULL CHECK (generation >= 1),
    snapshot_seq INTEGER NOT NULL CHECK (snapshot_seq >= 1),
    captured_at  TEXT NOT NULL,
    PRIMARY KEY (origin_id, generation)
);

CREATE TABLE IF NOT EXISTS sync_fact_log (
    origin_id  TEXT NOT NULL,
    generation INTEGER NOT NULL,
    seq        INTEGER NOT NULL CHECK (seq >= 1),
    event_id   TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (origin_id, generation, seq)
);
-- Dedup by identity, as on Postgres: no scan, no recovery journal.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sync_fact_event_id ON sync_fact_log(event_id);

CREATE TABLE IF NOT EXISTS sync_watermark (
    origin_id   TEXT NOT NULL,
    generation  INTEGER NOT NULL,
    durable_seq INTEGER NOT NULL DEFAULT 0 CHECK (durable_seq >= 0),
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (origin_id, generation)
);

CREATE TABLE IF NOT EXISTS sync_dead_letter (
    origin_id   TEXT NOT NULL,
    generation  INTEGER NOT NULL,
    seq         INTEGER NOT NULL,
    event_id    TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    payload     TEXT NOT NULL,
    reason      TEXT NOT NULL,
    rejected_at TEXT NOT NULL,
    PRIMARY KEY (origin_id, generation, seq)
);

CREATE TABLE IF NOT EXISTS sync_sender_state (
    singleton            INTEGER PRIMARY KEY CHECK (singleton = 1),
    consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    breaker_open_until   TEXT,
    last_success_at      TEXT,
    last_error           TEXT,
    last_error_at        TEXT,
    last_cycle_at        TEXT,
    updated_at           TEXT NOT NULL
);

-- Downstream: what the cloud told this edge to do, and what it did about it.
CREATE TABLE IF NOT EXISTS sync_command_inbox (
    seq          INTEGER PRIMARY KEY CHECK (seq >= 1),
    command_id   TEXT NOT NULL UNIQUE,
    command_type TEXT NOT NULL,
    payload      TEXT NOT NULL,
    received_at  TEXT NOT NULL,
    settled_at   TEXT,
    outcome      TEXT CHECK (outcome IN ('APPLIED', 'SKIPPED_EXPIRED', 'SKIPPED_REVOKED')),
    reason       TEXT
);

CREATE TABLE IF NOT EXISTS sync_command_watermark (
    singleton      INTEGER PRIMARY KEY CHECK (singleton = 1),
    applied_seq    INTEGER NOT NULL DEFAULT 0 CHECK (applied_seq >= 0),
    blocked_at_seq INTEGER,
    blocked_reason TEXT,
    blocked_since  TEXT,
    updated_at     TEXT NOT NULL
);

-- The commercial version an edge is currently honouring, delivered by the
-- `commercial.publication.activate` command. An edge prices a basket from
-- this and needs no round trip to do it.
CREATE TABLE IF NOT EXISTS commercial_publication (
    id             TEXT PRIMARY KEY,
    version        INTEGER NOT NULL UNIQUE CHECK (version > 0),
    name           TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to   TEXT,
    activated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commercial_price_rule (
    publication_id   TEXT NOT NULL REFERENCES commercial_publication(id),
    sku_id           TEXT NOT NULL,
    site_id          TEXT,
    channel          TEXT NOT NULL,
    sellable         INTEGER NOT NULL CHECK (sellable IN (0, 1)),
    currency         TEXT NOT NULL,
    unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
    tax_category     TEXT NOT NULL
);
-- SQLite forbids an expression in a PRIMARY KEY, so the scope uniqueness the
-- cloud states as a constraint is an expression index here. Same rule: one
-- price per (publication, sku, channel, site), with a NULL site meaning "all".
CREATE UNIQUE INDEX IF NOT EXISTS ux_edge_price_scope
ON commercial_price_rule(publication_id, sku_id, channel, COALESCE(site_id, '*'));

CREATE TABLE IF NOT EXISTS commercial_tax_rule (
    publication_id TEXT NOT NULL REFERENCES commercial_publication(id),
    tax_category   TEXT NOT NULL,
    rate_bps       INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 100000),
    tax_inclusive  INTEGER NOT NULL CHECK (tax_inclusive IN (0, 1)),
    PRIMARY KEY (publication_id, tax_category)
);
