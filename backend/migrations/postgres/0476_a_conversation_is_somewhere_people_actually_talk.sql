-- A conversation is somewhere people actually talk.
--
-- `0040_collaboration.sql` made a conversation ordered, resumable and
-- idempotent on send. What it did not make it is a place anybody would choose
-- to talk in: a word typed wrong stayed wrong forever, a message sent to the
-- wrong room could not be taken back, nobody could answer one line in
-- particular, and a group was fixed at the moment it was made. Every open
-- team chat (Mattermost, Rocket.Chat, Zulip) settled these the same way, and
-- this migration takes their answers where they fit this schema.
--
-- Three rules carried over from 0040 and kept on purpose:
--
--   * `seq` is still minted in exactly one place — sending — and a message is
--     never removed, only emptied. Deleting a row would leave a hole in the
--     numbering that a reader catching up from `after` cannot tell from a
--     message it has not been sent yet.
--   * Unread is still a position. Nothing here turns it into a count.
--   * Every change is announced on `collaboration_event`, in the transaction
--     that makes it, so a browser catching up never misses an edit.

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------

ALTER TABLE chat_message
    -- `SYSTEM` is a line the room writes about itself — "sari added budi".
    -- It takes a `seq` like any message, so it lands in the thread in the order
    -- it happened and the unread line counts it, but it has no author to edit
    -- or delete it.
    ADD COLUMN kind text NOT NULL DEFAULT 'TEXT' CHECK (kind IN ('TEXT', 'SYSTEM')),
    -- Set on every edit, so the thread can say "edited" rather than letting a
    -- quoted line silently change under the reply that quoted it.
    ADD COLUMN edited_at timestamptz,
    -- A deleted message keeps its row and its `seq`; its words and files go.
    ADD COLUMN deleted_at timestamptz,
    -- Pinned for the whole room, by whoever pinned it.
    ADD COLUMN pinned_at timestamptz,
    ADD COLUMN pinned_by text,
    -- Who this message names with `@username`, resolved against the room's
    -- members when it was written. Stored rather than re-parsed so an unread
    -- mention is one index lookup and a rename of the text cannot move it.
    ADD COLUMN mentions text[] NOT NULL DEFAULT '{}',
    ADD CONSTRAINT chat_message_pin_has_pinner
        CHECK ((pinned_at IS NULL) = (pinned_by IS NULL)),
    ADD CONSTRAINT chat_message_deleted_is_empty
        CHECK (deleted_at IS NULL OR (body = '' AND pinned_at IS NULL));

-- Replies point at a message in the same room. The foreign key is added now
-- that there is a screen that follows it; `reply_to_seq` was free text until
-- today and nothing wrote a dangling one, but it is cleared first rather than
-- assumed.
UPDATE chat_message m
   SET reply_to_seq = NULL
 WHERE reply_to_seq IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM chat_message r
                    WHERE r.conversation_id = m.conversation_id
                      AND r.seq = m.reply_to_seq);

ALTER TABLE chat_message
    ADD CONSTRAINT chat_message_reply_in_room
        FOREIGN KEY (conversation_id, reply_to_seq)
        REFERENCES chat_message (conversation_id, seq);

-- What the foreign key above checks on every delete of a message it could
-- point at — a whole room's worth when a room is removed. Without it each of
-- those checks reads the room's thread from the top.
CREATE INDEX ix_chat_message_reply
    ON chat_message (conversation_id, reply_to_seq)
    WHERE reply_to_seq IS NOT NULL;

CREATE INDEX ix_chat_message_pinned
    ON chat_message (conversation_id, pinned_at DESC)
    WHERE pinned_at IS NOT NULL;

CREATE INDEX ix_chat_message_mentions
    ON chat_message USING gin (mentions);

-- One reaction per person per emoji per message. Toggling is insert-or-delete.
CREATE TABLE chat_reaction (
    conversation_id uuid NOT NULL,
    seq             bigint NOT NULL,
    username        text NOT NULL CHECK (btrim(username) <> ''),
    emoji           text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
    reacted_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, seq, emoji, username),
    FOREIGN KEY (conversation_id, seq)
        REFERENCES chat_message (conversation_id, seq) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Participants
-- ---------------------------------------------------------------------------

ALTER TABLE chat_participant
    -- May rename the room, add and remove people, and make others admins.
    -- The creator starts as one; the room is never left without one.
    ADD COLUMN is_admin    boolean NOT NULL DEFAULT false,
    -- Per person, never shown to anybody else: muted still counts unread but
    -- does not ask for attention; pinned sorts first; archived is off the
    -- main list until it is brought back.
    ADD COLUMN muted_at    timestamptz,
    ADD COLUMN pinned_at   timestamptz,
    ADD COLUMN archived_at timestamptz;

-- Every room that exists already gets the person who made it as its admin.
UPDATE chat_participant p
   SET is_admin = true
  FROM chat_conversation c
 WHERE c.conversation_id = p.conversation_id
   AND c.created_by = p.username;

-- A room whose creator is no longer in it would have nobody who can manage
-- it; the longest-standing member takes over.
UPDATE chat_participant p
   SET is_admin = true
 WHERE NOT EXISTS (SELECT 1 FROM chat_participant a
                    WHERE a.conversation_id = p.conversation_id AND a.is_admin)
   AND p.username = (SELECT q.username FROM chat_participant q
                      WHERE q.conversation_id = p.conversation_id
                      ORDER BY q.joined_at, q.username
                      LIMIT 1);

-- ---------------------------------------------------------------------------
-- The stream learns two more words
-- ---------------------------------------------------------------------------

-- `chat.update` — a message changed in place (edited, deleted, reacted to,
-- pinned). `chat.room` — the room itself changed (renamed, somebody joined or
-- left). Separate from `chat.message` because neither moves anybody's unread
-- count, and a reader that treated them as new messages would light a badge
-- for a thumbs-up.
ALTER TABLE collaboration_event
    DROP CONSTRAINT collaboration_event_kind_check;
ALTER TABLE collaboration_event
    ADD CONSTRAINT collaboration_event_kind_check CHECK (kind IN (
        'chat.message', 'chat.read', 'chat.update', 'chat.room',
        'discussion.thread', 'discussion.post',
        'notification', 'activity'
    ));

-- ---------------------------------------------------------------------------
-- A direct message, or your name, reaches the phone
-- ---------------------------------------------------------------------------

-- The push outbox from 0462 learns a second kind of delivery: a chat message.
--
-- Not by raising a `notification` for it. That table is for what a person
-- must decide or do (0046), and a list with every "ok, thanks" in it is the
-- list people stop reading. So a delivery names EITHER a notification OR a
-- message — never both — and the same worker, the same retries, the same
-- device bookkeeping carry both.
--
-- Queued only for what a person would want their phone to buzz for: a direct
-- message in a room they have not muted, and any message that names them
-- with `@` — the same rule the chat screen uses for its own alerts.
ALTER TABLE push_delivery
    ALTER COLUMN notification_id DROP NOT NULL,
    ADD COLUMN conversation_id uuid,
    ADD COLUMN message_seq bigint,
    ADD CONSTRAINT push_delivery_message
        FOREIGN KEY (conversation_id, message_seq)
        REFERENCES chat_message (conversation_id, seq) ON DELETE CASCADE,
    ADD CONSTRAINT push_delivery_names_one_thing CHECK (
        (notification_id IS NOT NULL AND conversation_id IS NULL AND message_seq IS NULL) OR
        (notification_id IS NULL AND conversation_id IS NOT NULL AND message_seq IS NOT NULL)
    );

-- One delivery per message per device, the way (notification_id,
-- subscription_id) is unique for the other kind.
CREATE UNIQUE INDEX ux_push_delivery_message
    ON push_delivery (conversation_id, message_seq, subscription_id)
    WHERE conversation_id IS NOT NULL;
