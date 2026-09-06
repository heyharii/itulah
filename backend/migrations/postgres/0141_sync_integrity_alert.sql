-- What the receiver noticed about a stream, kept where a person can see it.
--
-- The sync engine's failure vocabulary was, until now, "this cycle achieved
-- nothing, try again" — right for a network that is down, and wrong for the one
-- fault that does not heal by retrying: a node whose database has been replaced
-- while keeping its origin_id. Its facts are refused for a reason that will be
-- true forever, and the only place that knew was a log line on the receiver.
--
-- This is the durable version of that knowledge. One open row per (origin,
-- generation, kind): a store retrying every five seconds must not write twelve
-- rows a minute, so a repeat bumps `occurrences` and `last_seen_at` instead.
-- Acknowledging closes the row and lets the next occurrence open a new one —
-- deliberately, because "it happened again after we fixed it" is the thing an
-- operator most needs to be told.
--
-- Written only by the receiver, from its own observations. There is no writer
-- that takes a store's word for its own health, which is the whole reason a
-- row here can be trusted.

CREATE TABLE sync_integrity_alert (
    id              bigserial PRIMARY KEY,
    origin_id       text NOT NULL,
    generation      bigint NOT NULL,
    -- Free text rather than an enum: the set of things worth alerting about
    -- will grow, and a migration per new observation would mean the observation
    -- goes unrecorded until somebody writes one.
    kind            text NOT NULL,
    detail          text NOT NULL,
    -- The receiver's watermark when it noticed. Carried out of the detail text
    -- as its own column because it is the number an operator sorts by.
    watermark_seq   bigint,
    occurrences     bigint NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    acknowledged_at timestamptz,
    acknowledged_by text,
    CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL))
);

-- The dedupe key, and only while the row is open.
CREATE UNIQUE INDEX ux_sync_integrity_alert_open
    ON sync_integrity_alert (origin_id, generation, kind)
    WHERE acknowledged_at IS NULL;

CREATE INDEX ix_sync_integrity_alert_recent
    ON sync_integrity_alert (origin_id, last_seen_at DESC);
