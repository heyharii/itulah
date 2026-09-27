-- 0043: A till counts what it gave away itself.
--
-- `commercial_usage` (0018) is the centre's count, replaced whole every time
-- the centre sends one. Until this, nothing a till sold touched it: a shop
-- learned that its own sale had used up a promotion only when that sale had
-- travelled to the centre, been applied, been counted, and been sent back. A
-- coupon marked single-use could be presented again at the same counter a
-- minute later and pass, because the counter's figure still said nobody had
-- used it. The brake 0018 describes was a brake that did not feel this shop's
-- own foot.
--
-- # Why a second table and not an increment on the first
--
-- The centre's message replaces `commercial_usage` wholesale, and it will
-- carry this shop's sales too once they have been applied there. Adding into
-- that table would lose every local sale the moment a message arrived that did
-- not yet count them, and double-count every one it did. So the two are kept
-- apart and summed where they are read: the centre's figure, plus what this
-- till has given away that the centre has not counted yet.
--
-- # How a row stops counting
--
-- Each row names the sale fact it came from (`event_id`, which is the key of
-- `sync_fact_log`). The centre's usage message says, per stream, how far it had
-- applied this shop's facts when it counted. A row whose fact the centre had
-- applied is inside the centre's figure and is deleted when that message
-- lands. A row whose fact is no longer in the log was purged after the centre
-- acknowledged it long ago, and is deleted too.
--
-- The fact is looked up by event id rather than by a stored seq on purpose: a
-- generation change re-sequences unacknowledged facts (`seq - acknowledged`,
-- new generation), and a stored copy of the old seq would then point at the
-- wrong fact — or at none.
--
-- # A sale the centre will never hear about
--
-- A node with its stream switched off queues nothing (`enqueue_fact` returns
-- no seq), and the centre can never count that sale. `reported = 0` marks such
-- a row, and it is never deleted by a usage message: it is a real sale that
-- only this till will ever know about.
--
-- Rows are summed per (kind, key), and the key is accumulated rather than
-- replaced, because one sale can reach the same campaign through two of its
-- offers — which the centre counts as two uses of that campaign.

CREATE TABLE IF NOT EXISTS commercial_usage_local (
    event_id    TEXT    NOT NULL CHECK (trim(event_id) <> ''),
    kind        TEXT    NOT NULL CHECK (kind IN ('RULE', 'CAMPAIGN', 'COUPON')),
    key         TEXT    NOT NULL CHECK (trim(key) <> ''),
    uses        INTEGER NOT NULL CHECK (uses >= 0),
    spent_minor INTEGER NOT NULL CHECK (spent_minor >= 0),
    reported    INTEGER NOT NULL CHECK (reported IN (0, 1)),
    recorded_at TEXT    NOT NULL,
    PRIMARY KEY (event_id, kind, key)
);

CREATE INDEX IF NOT EXISTS ix_commercial_usage_local_subject
    ON commercial_usage_local (kind, key);
