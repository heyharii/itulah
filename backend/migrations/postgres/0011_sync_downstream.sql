-- The downstream lane: cloud -> store commands.
--
-- Mirror image of the upstream fact log, with the authority reversed: the
-- cloud owns the order, the store owns the applied watermark. Same invariant
-- either way — a dense per-target sequence, a contiguous applied prefix, and
-- "resend from the watermark" as the only recovery mechanism.
--
-- Three things this lane does that the reference implementations do not:
--
-- 1. It rides the EXISTING upload cycle. A store's `/sync/ingest` request
--    carries its command watermark; the response carries the next commands.
--    One round trip, one authentication, and commands land within the upload
--    interval (5s) instead of a separate pull loop's cadence.
--
-- 2. The store's applied watermark is reported back on every cycle, so
--    `sync_command_cursor.acked_seq` is a live, fleet-wide convergence view:
--    "has publication X reached all 30 stores" is one query, not 30 acks
--    correlated by hand.
--
-- 3. Commands are revocable. A broadcast that turns out to be wrong is
--    recalled centrally; stores that have not yet applied it skip it and
--    record why. Without this, a bad fleet-wide command needs 30 manual
--    interventions.

-- The command itself, stored ONCE however many stores receive it.
CREATE TABLE sync_command (
    command_id     uuid PRIMARY KEY,
    command_type   text NOT NULL CHECK (btrim(command_type) <> ''),
    payload        jsonb NOT NULL,
    issued_by      text NOT NULL,
    issued_at      timestamptz NOT NULL DEFAULT now(),
    -- A command that could not be delivered before this is skipped rather
    -- than applied late: a price activation that arrives a week stale is not
    -- what the operator asked for.
    expires_at     timestamptz,
    revoked_at     timestamptz,
    revoked_reason text
);

-- One row per (target store, command): the dense per-store ordering. Cheap —
-- the payload lives in sync_command, this is just position. A dense sequence
-- PER STORE is what keeps contiguity intact when broadcast and targeted
-- commands interleave; a single global sequence filtered by store would leave
-- gaps the store cannot distinguish from lost commands.
CREATE TABLE sync_command_delivery (
    origin_id  text NOT NULL,
    seq        bigint NOT NULL CHECK (seq >= 1),
    command_id uuid NOT NULL REFERENCES sync_command(command_id),
    PRIMARY KEY (origin_id, seq)
);
CREATE UNIQUE INDEX ux_command_delivery_once ON sync_command_delivery (origin_id, command_id);

-- Per-store allocator AND convergence view. `next_seq` is the cloud's write
-- position; `acked_seq` is what the store last reported applying.
CREATE TABLE sync_command_cursor (
    origin_id      text PRIMARY KEY,
    next_seq       bigint NOT NULL DEFAULT 0 CHECK (next_seq >= 0),
    acked_seq      bigint NOT NULL DEFAULT 0 CHECK (acked_seq >= 0),
    acked_at       timestamptz,
    blocked_at_seq bigint,
    blocked_reason text,
    blocked_since  timestamptz,
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Store side. The inbox is the durable record of what this store was told and
-- what it did about it — kept after application as the operator's evidence,
-- exactly as the outbox keeps acked facts.
CREATE TABLE sync_command_inbox (
    seq          bigint PRIMARY KEY CHECK (seq >= 1),
    command_id   uuid NOT NULL UNIQUE,
    command_type text NOT NULL,
    payload      jsonb NOT NULL,
    received_at  timestamptz NOT NULL DEFAULT now(),
    settled_at   timestamptz,
    -- APPLIED: the effect committed. SKIPPED_EXPIRED / SKIPPED_REVOKED: the
    -- command was deliberately not applied, and the prefix advanced past it.
    outcome      text CHECK (outcome IN ('APPLIED', 'SKIPPED_EXPIRED', 'SKIPPED_REVOKED')),
    reason       text
);

CREATE TABLE sync_command_watermark (
    singleton      boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    applied_seq    bigint NOT NULL DEFAULT 0 CHECK (applied_seq >= 0),
    blocked_at_seq bigint,
    blocked_reason text,
    blocked_since  timestamptz,
    updated_at     timestamptz NOT NULL DEFAULT now()
);
