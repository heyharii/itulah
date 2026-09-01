-- Ordered edge->cloud sync (outbox engine).
--
-- Design: facts are appended to an ORDERED log inside the same transaction as
-- the movement/sale that produced them, keyed (origin_id, generation, seq).
-- The sender uploads contiguous ranges starting after a durable watermark; the
-- receiving node answers with `durable_through` (a prefix acknowledgement) plus
-- per-seq permanent rejections. There are no per-row claims, no stale-claim
-- sweeps and no settlement journal: contiguity is guaranteed by construction,
-- crash recovery is "resend from the watermark", and the receiver deduplicates
-- on the primary key. A permanently rejected fact becomes a tombstone at its
-- seq on the receiver and a copied dead-letter row here, so the watermark can
-- pass it without losing the evidence.

-- One row: this node's sync identity. Seq allocation is an ordinary row
-- update so it commits and rolls back with the domain transaction that
-- produced the fact (a rolled-back sale must release its seq).
CREATE TABLE sync_origin (
    singleton        boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    origin_id        text NOT NULL,
    generation       bigint NOT NULL CHECK (generation >= 1),
    next_seq         bigint NOT NULL DEFAULT 0 CHECK (next_seq >= 0),
    enqueue_enabled  boolean NOT NULL DEFAULT false,
    provisioned_at   timestamptz NOT NULL DEFAULT now()
);

-- The ordered fact log (edge side). `event_id` is the fact's stable identity
-- (the movement group id); the unique index IS the dedup — no scan, no
-- separate recovery journal.
CREATE TABLE sync_fact_log (
    origin_id   text NOT NULL,
    generation  bigint NOT NULL,
    seq         bigint NOT NULL CHECK (seq >= 1),
    event_id    uuid NOT NULL,
    event_type  text NOT NULL,
    payload     jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (origin_id, generation, seq)
);
CREATE UNIQUE INDEX ux_sync_fact_event_id ON sync_fact_log (event_id);

-- How far the receiving node durably holds this origin's stream.
-- durable_seq only ever advances; facts at or below it may be purged after the
-- retention window.
CREATE TABLE sync_watermark (
    origin_id   text NOT NULL,
    generation  bigint NOT NULL,
    durable_seq bigint NOT NULL DEFAULT 0 CHECK (durable_seq >= 0),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (origin_id, generation)
);

-- Permanently rejected facts, copied out of the log with their reason before
-- the watermark passes them. Never deleted automatically: this is the
-- operator's evidence that a business event was refused upstream.
CREATE TABLE sync_dead_letter (
    origin_id   text NOT NULL,
    generation  bigint NOT NULL,
    seq         bigint NOT NULL,
    event_id    uuid NOT NULL,
    event_type  text NOT NULL,
    payload     jsonb NOT NULL,
    reason      text NOT NULL,
    rejected_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (origin_id, generation, seq)
);

-- Durable sender state: the circuit breaker must survive a restart, otherwise
-- a crash-looping node turns a cloud incident into a retry storm.
CREATE TABLE sync_sender_state (
    singleton            boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    breaker_open_until   timestamptz,
    last_success_at      timestamptz,
    last_error           text,
    last_error_at        timestamptz,
    last_cycle_at        timestamptz,
    updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Receiver side (any node can ingest; in V1 the CLOUD role does).
-- The receipt log records every accepted fact and every rejection tombstone at
-- its seq; the ingest watermark is the contiguous prefix durably held.
CREATE TABLE sync_ingest_fact (
    origin_id   text NOT NULL,
    generation  bigint NOT NULL,
    seq         bigint NOT NULL CHECK (seq >= 1),
    event_id    uuid NOT NULL,
    event_type  text NOT NULL,
    payload     jsonb NOT NULL,
    status      text NOT NULL CHECK (status IN ('ACCEPTED', 'REJECTED')),
    reason      text,
    received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (origin_id, generation, seq)
);
CREATE UNIQUE INDEX ux_sync_ingest_event_id ON sync_ingest_fact (event_id);

CREATE TABLE sync_ingest_watermark (
    origin_id        text NOT NULL,
    generation       bigint NOT NULL,
    durable_seq      bigint NOT NULL DEFAULT 0 CHECK (durable_seq >= 0),
    last_received_at timestamptz,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (origin_id, generation)
);
