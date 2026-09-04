-- A segment is a definition, not a membership.
--
-- `postgres/membership.rs` spends its opening paragraphs arguing that a
-- segment must never be stored: it is a statement about behaviour, behaviour
-- changes without anybody touching the member's row, and so a stored segment
-- is wrong from the day after it is written and wrong *silently* — the
-- campaign still sends. Nothing here weakens that. What these tables hold is
-- the **clauses**; who is in the segment is worked out on every read, by the
-- same `FROM` the directory itself uses.
--
-- It is the same discipline `report` (0089) already applies to a question and
-- `commercial_publication` applies to a price: keep the definition, re-run it,
-- and keep the old versions so last month's list can still be explained.
--
-- The six derived segments in `membership.rs` stay exactly as they are. These
-- are the other kind — "lapsing, and has spent at least five million" — which
-- overlap each other and do not add up to the directory. The two are never
-- mixed on a screen for that reason: the six can be checked by arithmetic and
-- these cannot.

CREATE TABLE segment (
    segment_id      uuid PRIMARY KEY,
    name            text NOT NULL,
    -- What it is for, in the author's own words. A clause list says what a
    -- segment matches and never why it exists, and "why" is the thing the
    -- person who inherits it will actually need.
    purpose         text,
    -- Who may edit it. Text rather than a foreign key to `app_user`, like
    -- `created_by` everywhere else in this schema: a segment outlives the
    -- account that wrote it, and a node running without authentication has a
    -- truthful actor that is not a row in that table.
    --
    -- There is deliberately no `shared` flag beside it, unlike `report`. A
    -- report is somebody's working question; a segment is a marketing list the
    -- shop acts on, and one that only its author can see is one that gets
    -- rebuilt slightly differently by the next person who needs it.
    owner_username  text NOT NULL,
    current_version integer NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    archived_at     timestamptz
);

-- One name, one list. Two segments called "VIP" that match different people is
-- how a campaign goes to the wrong half of them, and the case-insensitive
-- index is because "VIP" and "vip" are the same word to everybody but Postgres.
CREATE UNIQUE INDEX segment_name_is_unique
    ON segment (lower(name)) WHERE archived_at IS NULL;

CREATE INDEX segment_by_owner ON segment (owner_username) WHERE archived_at IS NULL;

-- A version is written once and never updated. Editing appends the next one
-- and moves `segment.current_version`, which is what makes "who was in this
-- list when we sent that message" a question with an answer.
CREATE TABLE segment_version (
    segment_id        uuid NOT NULL REFERENCES segment (segment_id) ON DELETE CASCADE,
    version           integer NOT NULL,
    -- `{ "match": "ALL" | "ANY", "filters": [ { column, op, values } ] }` —
    -- the same clause vocabulary `report_version.spec` holds and the same one
    -- the browser's filter bar writes, so a clause somebody adds by hand and a
    -- clause saved here are the same object.
    definition        jsonb NOT NULL,
    -- The catalogue this definition was validated against. A definition
    -- written for an older catalogue is not automatically wrong, but it is not
    -- automatically right either, and this is what lets the difference be
    -- noticed rather than discovered by a campaign.
    catalogue_version integer NOT NULL,
    authored_by       text NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (segment_id, version)
);

-- The current version must exist. Without this a segment can point at a
-- version that was never written, and the failure surfaces as a list of
-- everybody rather than as the broken write it actually is — which is the
-- worst possible way for this particular bug to appear.
ALTER TABLE segment
    ADD CONSTRAINT segment_current_version_exists
    FOREIGN KEY (segment_id, current_version)
    REFERENCES segment_version (segment_id, version)
    DEFERRABLE INITIALLY DEFERRED;
