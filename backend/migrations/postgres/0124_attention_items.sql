-- 0124: The queue of things that do not reconcile, one row per thing.
--
-- # Why this is not just a view over integrity_result
--
-- Because a result is per run and an exception is not. The same unmatched bank
-- line is found again every night for six weeks; a screen reading the results
-- table directly would show it forty-two times, or once with a date that keeps
-- moving, and neither reads as "this has been open since the third".
--
-- So the run writes results and UPSERTS attention. `opened_at` is set the first
-- night an exception is seen and never touched again, which is the one number
-- that makes a queue readable: age.
--
-- # The key
--
-- (source_kind, scope, source_id) — the check, the books, and the thing. That
-- triple is what makes the same exception one row across runs, and it is why
-- `suggested_actions` carry a target: an unmatched line's target is the line,
-- so fifty unmatched lines are fifty rows and not one row saying "fifty".
--
-- # Resolving
--
-- Two ways, and they are not the same fact. A later run that no longer raises
-- an item resolves it with `resolved_by = 'system:integrity'` — the books now
-- agree, and nobody had to say so. A person resolving it by hand must give a
-- reason, because "I looked at it and it is fine" is a claim somebody may have
-- to answer for at an audit, and an unexplained one is worthless.

CREATE TABLE attention_item (
    item_id      uuid PRIMARY KEY,

    -- Which control equation raised it. The `integrity_result.key`.
    source_kind  text NOT NULL CHECK (btrim(source_kind) <> ''),

    -- The record it is about: a statement line id, an invoice id, a site id.
    -- Text rather than uuid because the targets are of several kinds and a
    -- typed column would have to be one of them.
    source_id    text NOT NULL CHECK (btrim(source_id) <> ''),

    -- `GROUP` or a site id, exactly as `integrity_result.scope` spells it.
    scope        text NOT NULL CHECK (btrim(scope) <> ''),

    -- The location, when there is one, as a real foreign key — this is what the
    -- store feed filters on, and a store id that does not name a store is a
    -- feed that silently returns nothing.
    site_id      text REFERENCES site(id),

    -- The two columns above say the same thing, and the database proves it
    -- rather than trusting the writer. `scope` is half of a unique key and
    -- cannot be null; `site_id` is a foreign key and must be null for a
    -- group-wide item. Without this check they would drift the first time
    -- somebody inserted a row by hand.
    CHECK (scope = COALESCE(site_id, 'GROUP')),

    -- Who can act on it. A store can settle its own shift, its own remittance,
    -- its own count; it cannot touch the supplier ledger, and putting head
    -- office work in its feed is how a feed stops being read.
    audience     text NOT NULL CHECK (audience IN ('HO', 'STORE', 'BOTH')),

    -- Carried from the check's state. PENDING never reaches this table — an
    -- item that nobody should act on yet is not attention.
    severity     text NOT NULL CHECK (severity IN ('EXCEPTION', 'BLOCKED')),

    title        text NOT NULL CHECK (btrim(title) <> ''),
    -- The sentence as it was written the night it was raised. Stored for the
    -- reason `notification.body` is: what somebody was told should still read
    -- the same after the screen has been redesigned.
    body         text NOT NULL CHECK (btrim(body) <> ''),

    suggested_actions jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- The money at stake, so a queue can be worked worst-first. Signed, and
    -- nullable for an item that is not about an amount at all.
    amount_minor bigint,

    -- The first time this was seen. Never moved by a later run: age is the
    -- whole point of the row.
    opened_at    timestamptz NOT NULL DEFAULT now(),
    -- The most recent run that still found it, so a stale queue is visible as
    -- one rather than looking merely quiet.
    last_seen_at timestamptz NOT NULL DEFAULT now(),

    resolved_at  timestamptz,
    resolved_by  text,
    -- Required from a person, never from the engine — see the header.
    resolved_reason text,

    CHECK ((resolved_at IS NULL) = (resolved_by IS NULL)),
    CHECK (resolved_at IS NULL OR resolved_at >= opened_at)
);

-- One open row per thing. Partial, so a resolved item does not block the same
-- exception being raised again next month — which is a different occurrence and
-- deserves its own age.
CREATE UNIQUE INDEX ux_attention_open
    ON attention_item (source_kind, scope, source_id)
    WHERE resolved_at IS NULL;

-- The two feeds, each with its own index because each is a different question.
CREATE INDEX ix_attention_open_ho
    ON attention_item (severity, opened_at)
    WHERE resolved_at IS NULL AND audience IN ('HO', 'BOTH');
CREATE INDEX ix_attention_open_store
    ON attention_item (site_id, opened_at)
    WHERE resolved_at IS NULL AND audience IN ('STORE', 'BOTH');
CREATE INDEX ix_attention_source ON attention_item (source_kind, opened_at DESC);

COMMENT ON TABLE attention_item IS
    'One open exception, stable across runs. Keyed (source_kind, scope, '
    'source_id) while open, so the same unmatched line is one row however many '
    'nights the engine finds it.';
COMMENT ON COLUMN attention_item.opened_at IS
    'When it was FIRST seen. Never advanced by a later run — age is the number '
    'that makes a queue readable.';
COMMENT ON COLUMN attention_item.resolved_reason IS
    'Required when a person resolves by hand; null when a run resolved it by '
    'finding the books agreed.';
