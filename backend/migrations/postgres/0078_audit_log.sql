-- The activity log: who did what, to which record, and when.
--
-- This is NOT a second notification table, and the distinction is the whole
-- point. `notification` names something a person MUST DECIDE OR DO, and its
-- own migration warns that raising one for everything that merely happens
-- trains people to dismiss all of them. This table is the opposite half: it
-- records everything and calls nobody. A record's sheet reads it to show its
-- own history; nothing here interrupts anyone.
--
-- It is also not the ledger. `movement` and the journal are the authority on
-- what a number means; this is the authority on who touched it. A correction
-- and the person who made it are two different facts and the second one is the
-- one nobody can reconstruct afterwards.

CREATE TABLE audit_log (
    audit_id     bigserial PRIMARY KEY,
    at           timestamptz NOT NULL DEFAULT now(),

    -- The actor as the server knew them, not as the request claimed. Copied
    -- rather than referenced: an operator who leaves is deactivated, and the
    -- log still has to say who did this a year ago.
    username     text NOT NULL,
    display_name text NOT NULL,
    role         text NOT NULL,

    -- What was asked for. The path is stored with its parameters intact —
    -- `/api/v1/suppliers/{id}/activate` is the shape, and the id is what makes
    -- the row worth having.
    method       text NOT NULL,
    path         text NOT NULL,
    -- What the server answered. A refused action is exactly as interesting as
    -- a successful one: "who kept trying to publish a book they may not
    -- publish" is a question this table should be able to answer.
    status       smallint NOT NULL,

    -- The record this touched, as a (kind, id) pair rather than a URL — routes
    -- get renamed, records do not. Derived from the path, so it is best-effort:
    -- an action that does not name a record leaves both null and the row is
    -- still a true statement about the actor.
    subject_kind text,
    subject_id   text,

    -- Room for what the shape of the path cannot say. Deliberately not the
    -- request body: bodies carry passwords, keys and personal data, and an
    -- audit table is the last place any of them should be durably written.
    payload      jsonb NOT NULL DEFAULT '{}'::jsonb,

    CHECK ((subject_kind IS NULL) = (subject_id IS NULL))
);

-- The sheet's query: one record's history, newest first.
CREATE INDEX ix_audit_subject
    ON audit_log (subject_kind, subject_id, at DESC)
    WHERE subject_kind IS NOT NULL;

-- The global activity feed, and "what did this person do today".
CREATE INDEX ix_audit_at ON audit_log (at DESC);
CREATE INDEX ix_audit_actor ON audit_log (username, at DESC);

COMMENT ON TABLE audit_log IS
    'Who did what, to which record. Records everything and calls nobody — the '
    'opposite half of `notification`, which calls people and records little.';
COMMENT ON COLUMN audit_log.payload IS
    'Never the request body: bodies carry passwords, keys and personal data.';

-- The stream learns one more word, so a browser already holding the SSE
-- connection open is told about activity without a second connection.
ALTER TABLE collaboration_event
    DROP CONSTRAINT collaboration_event_kind_check;
ALTER TABLE collaboration_event
    ADD CONSTRAINT collaboration_event_kind_check CHECK (kind IN (
        'chat.message', 'chat.read', 'discussion.thread', 'discussion.post',
        'notification', 'activity'
    ));

-- And notifications learn the broadcast kind.
--
-- `activity` is the announce-everything kind the console asked for: every
-- completed action, to everybody. It is deliberately a SEPARATE kind from the
-- two that name work, so a reader — and a future migration — can tell the
-- difference between "somebody must decide this" and "this happened", and can
-- narrow or drop the second without touching the first.
ALTER TABLE notification
    DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification
    ADD CONSTRAINT notification_kind_check CHECK (kind IN (
        'purchase.price_amendment.requested',
        'receipt.awaiting_identity',
        'activity'
    ));
