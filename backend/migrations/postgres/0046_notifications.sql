-- Notifications: work that found a person, rather than a person finding it.
--
-- This is deliberately NOT a second event log. `collaboration_event` already
-- exists, is numbered, is resumable and carries an audience, and it stays the
-- transport — a notification is announced on it like a chat message is. What
-- that table cannot do is remember whether one named person has dealt with
-- one thing, because an event is fan-out and read state is per reader. That
-- is the whole reason these two tables exist.
--
-- The rule for what belongs here: a notification names something A PERSON
-- MUST DECIDE OR DO. A price the supplier disagreed with, goods sitting
-- unidentified. Things that merely happened belong in the ledger, and a
-- notification for each of those trains people to dismiss all of them.

CREATE TABLE notification (
    notification_id uuid PRIMARY KEY,
    -- Constrained rather than free text: every value here is a thing this
    -- business does, and the browser routes on it. A new kind is a migration
    -- and a deliberate act, not a typo somebody shipped.
    kind         text NOT NULL CHECK (kind IN (
                     'purchase.price_amendment.requested',
                     'receipt.awaiting_identity'
                 )),
    -- Written at the moment it happens, by the code that knows why. Not
    -- assembled in the browser from ids: the sentence is part of the record,
    -- so what a person was told is still legible a year later even if the
    -- wording of the screen has changed since.
    title        text NOT NULL CHECK (btrim(title) <> ''),
    body         text NOT NULL CHECK (btrim(body) <> ''),
    -- Where clicking it should land. Kept as a (kind, id) pair rather than a
    -- URL so a route rename does not strand every notification ever written.
    subject_kind text,
    subject_id   text,
    -- The node this came from, when it came from one. A buyer reading three
    -- price queries wants to know which warehouse is asking.
    origin_id    text,
    payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CHECK ((subject_kind IS NULL) = (subject_id IS NULL))
);

CREATE INDEX ix_notification_created ON notification (created_at DESC);

-- One row per person told, because being told is per person.
--
-- Recipients are resolved and written at the moment the notification is
-- raised, not computed at read time from whoever holds a role today. Somebody
-- promoted next week should not inherit last week's unread work, and somebody
-- who has left should not have their queue silently emptied.
CREATE TABLE notification_recipient (
    notification_id uuid NOT NULL REFERENCES notification(notification_id) ON DELETE CASCADE,
    username        text NOT NULL,
    read_at         timestamptz,
    PRIMARY KEY (notification_id, username)
);

-- The badge's query: what is unread for one person. Partial, because a read
-- notification is never counted and there will be far more of those.
CREATE INDEX ix_notification_recipient_unread
    ON notification_recipient (username)
    WHERE read_at IS NULL;

CREATE INDEX ix_notification_recipient_username
    ON notification_recipient (username);

COMMENT ON TABLE notification IS
    'Something one or more named people must decide or do. Announced on '
    'collaboration_event; read state lives in notification_recipient.';
COMMENT ON COLUMN notification.subject_kind IS
    'Deep-link target as (kind, id), never a URL: routes get renamed, records do not.';

-- The stream learns one more word.
--
-- Same channel as chat and discussions on purpose: a browser already holding
-- one SSE connection open should not need a second one to be told that work
-- arrived, and `after=<event_id>` then resumes both at once.
ALTER TABLE collaboration_event
    DROP CONSTRAINT collaboration_event_kind_check;
ALTER TABLE collaboration_event
    ADD CONSTRAINT collaboration_event_kind_check CHECK (kind IN (
        'chat.message', 'chat.read', 'discussion.thread', 'discussion.post',
        'notification'
    ));
