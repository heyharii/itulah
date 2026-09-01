-- Talking: conversations, discussions, and the files both of them carry.
--
-- Three screens were prototyped against this shape (`dasbor/21-chat.html`,
-- `dasbor/13-discuss.html`) and every decision below is one of theirs made
-- durable. The two are not one feature with two skins:
--
--   A CONVERSATION is between people. It is ordered, it is unread-or-read
--   against a position, and it is private to its participants.
--
--   A DISCUSSION hangs off a RECORD — a purchase order, a supplier, one
--   receipt. `subject_kind` has nine values and all nine are things this
--   business does, not categories somebody invented for a forum. That is why
--   there is no `category` column here and never will be: a thread that is
--   not about a record is a conversation, and it has a table already.

-- ---------------------------------------------------------------------------
-- Files
-- ---------------------------------------------------------------------------

-- The bytes somebody attached, wherever they physically live.
--
-- Two storages, one row shape. When object storage is configured the bytes go
-- to the bucket and `object_key` names them; when it is not — which is every
-- developer's laptop and any node deployed without R2 — they go in `bytes`.
-- The alternative was a file feature that only exists in production, which is
-- a file feature nobody can test.
--
-- There is deliberately NO url column. The prototype's rule, kept: a file is
-- reached through the conversation or the thread that carries it, so a link
-- cannot be forwarded to somebody who was never in the room. Handing out an
-- object-storage URL here would undo that with one copy-paste.
CREATE TABLE stored_file (
    file_id      uuid PRIMARY KEY,
    file_name    text NOT NULL CHECK (btrim(file_name) <> ''),
    content_type text NOT NULL DEFAULT 'application/octet-stream',
    byte_size    bigint NOT NULL CHECK (byte_size >= 0),
    -- Content hash, shown beside the name. Two people uploading the same
    -- invoice get two rows and one hash, and the screen can say so.
    sha256       text NOT NULL CHECK (char_length(sha256) = 64),
    storage      text NOT NULL CHECK (storage IN ('OBJECT', 'DATABASE')),
    object_key   text,
    bytes        bytea,
    uploaded_by  text NOT NULL CHECK (btrim(uploaded_by) <> ''),
    uploaded_at  timestamptz NOT NULL DEFAULT now(),
    -- `available` is a real state, not a formality: the row survives the
    -- bucket losing the object, and the screens are built to say "attached,
    -- but not retrievable" rather than to show a link that 404s.
    available    boolean NOT NULL DEFAULT true,
    CHECK (
        (storage = 'OBJECT'   AND object_key IS NOT NULL AND bytes IS NULL) OR
        (storage = 'DATABASE' AND bytes IS NOT NULL AND object_key IS NULL)
    )
);

CREATE INDEX ix_stored_file_uploader ON stored_file (uploaded_by, uploaded_at DESC);

COMMENT ON TABLE stored_file IS
    'Bytes attached to a conversation message or a discussion post. Reached '
    'only through the thing that carries them; there is no shareable URL.';

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

CREATE TABLE chat_conversation (
    conversation_id uuid PRIMARY KEY,
    kind            text NOT NULL CHECK (kind IN ('DIRECT', 'GROUP')),
    -- A DIRECT conversation has no title of its own: it is named by whoever
    -- else is in it, which depends on who is looking. Stored NULL and resolved
    -- per reader.
    title           text,
    created_by      text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- The high-water mark. Message order is THIS number, never the sender's
    -- clock: a till whose time is wrong must not be able to insert itself into
    -- the middle of a conversation.
    latest_seq      bigint NOT NULL DEFAULT 0 CHECK (latest_seq >= 0),
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    CHECK (kind = 'DIRECT' OR btrim(coalesce(title, '')) <> '')
);

CREATE TABLE chat_participant (
    conversation_id uuid NOT NULL
                    REFERENCES chat_conversation(conversation_id) ON DELETE CASCADE,
    username        text NOT NULL CHECK (btrim(username) <> ''),
    -- Unread is a POSITION, not a count and not a flag. `latest_seq -
    -- last_read_seq` is the count when a screen wants one, but the position is
    -- what lets the thread draw the "unread from here" line in the right
    -- place. A boolean would throw that away.
    last_read_seq   bigint NOT NULL DEFAULT 0 CHECK (last_read_seq >= 0),
    joined_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, username)
);

CREATE INDEX ix_chat_participant_username ON chat_participant (username);

CREATE TABLE chat_message (
    conversation_id uuid NOT NULL
                    REFERENCES chat_conversation(conversation_id) ON DELETE CASCADE,
    -- Per conversation, from 1. Not global, not a timestamp.
    seq             bigint NOT NULL CHECK (seq > 0),
    message_id      uuid NOT NULL UNIQUE,
    author_username text NOT NULL CHECK (btrim(author_username) <> ''),
    body            text NOT NULL,
    reply_to_seq    bigint,
    sent_at         timestamptz NOT NULL DEFAULT now(),
    -- The client mints this BEFORE the first attempt, so a resend after a
    -- dropped connection carries the same key and lands once. Optimistic
    -- rendering is only safe because of this column.
    idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
    PRIMARY KEY (conversation_id, seq),
    UNIQUE (conversation_id, idempotency_key)
    -- "Empty body" is legal here on purpose: a message that is only a
    -- photograph has nothing to say in words. That a message must carry
    -- either words or a file spans two tables, so the application enforces it
    -- before the insert rather than a constraint pretending to.
);

CREATE TABLE chat_message_attachment (
    conversation_id uuid NOT NULL,
    seq             bigint NOT NULL,
    file_id         uuid NOT NULL REFERENCES stored_file(file_id) ON DELETE RESTRICT,
    PRIMARY KEY (conversation_id, seq, file_id),
    FOREIGN KEY (conversation_id, seq)
        REFERENCES chat_message(conversation_id, seq) ON DELETE CASCADE
);

CREATE INDEX ix_chat_message_attachment_conversation
    ON chat_message_attachment (conversation_id);

-- ---------------------------------------------------------------------------
-- Discussions
-- ---------------------------------------------------------------------------

CREATE TABLE discussion_thread (
    thread_id        uuid PRIMARY KEY,
    -- Nine values, all of them work. Enforced here rather than in the
    -- application because the whole design rests on it: the day a tenth
    -- "general" kind is added by a hand-written INSERT, this is a forum.
    subject_kind     text NOT NULL CHECK (subject_kind IN (
                        'purchase_order', 'purchase_order_line', 'supplier',
                        'receipt', 'purchase_exception', 'commercial_verification',
                        'packaging_item', 'supply_item', 'article')),
    -- The record's own identifier as a person reads it: PO-2607-0108, SUP-0311.
    -- Text, not a uuid and not nine nullable foreign keys, because the nine
    -- subjects live in nine tables with different key types and a thread must
    -- survive its subject being archived.
    subject_id       text NOT NULL CHECK (btrim(subject_id) <> ''),
    subject_note     text,
    title            text NOT NULL CHECK (btrim(title) <> ''),
    status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'resolved', 'locked')),
    created_by       text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at       timestamptz NOT NULL DEFAULT now(),
    last_activity_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_discussion_thread_activity ON discussion_thread (last_activity_at DESC);
CREATE INDEX ix_discussion_thread_subject ON discussion_thread (subject_kind, subject_id);

CREATE TABLE discussion_post (
    post_id     uuid PRIMARY KEY,
    thread_id   uuid NOT NULL REFERENCES discussion_thread(thread_id) ON DELETE CASCADE,
    seq         bigint NOT NULL CHECK (seq > 0),
    author_username text NOT NULL CHECK (btrim(author_username) <> ''),
    body        text NOT NULL CHECK (btrim(body) <> ''),
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- The answer that settled it. At most one per thread, which is what makes
    -- it worth marking at all.
    is_solution boolean NOT NULL DEFAULT false,
    UNIQUE (thread_id, seq)
);

CREATE UNIQUE INDEX ux_discussion_one_solution
    ON discussion_post (thread_id) WHERE is_solution;

CREATE TABLE discussion_post_attachment (
    post_id uuid NOT NULL REFERENCES discussion_post(post_id) ON DELETE CASCADE,
    file_id uuid NOT NULL REFERENCES stored_file(file_id) ON DELETE RESTRICT,
    PRIMARY KEY (post_id, file_id)
);

CREATE TABLE discussion_thread_tag (
    thread_id uuid NOT NULL REFERENCES discussion_thread(thread_id) ON DELETE CASCADE,
    tag       text NOT NULL CHECK (btrim(tag) <> ''),
    PRIMARY KEY (thread_id, tag)
);

-- Who has opened this thread — one row per person, ever.
--
-- The count this yields is PEOPLE, not page loads, and the screens say
-- "orang" because of it. A hit counter would be a different number wearing
-- the same label.
CREATE TABLE discussion_thread_view (
    thread_id  uuid NOT NULL REFERENCES discussion_thread(thread_id) ON DELETE CASCADE,
    username   text NOT NULL CHECK (btrim(username) <> ''),
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (thread_id, username)
);

-- Private to the person who set it. Nobody is ever shown anyone else's, and
-- there is no aggregate read of this table anywhere.
CREATE TABLE discussion_bookmark (
    thread_id uuid NOT NULL REFERENCES discussion_thread(thread_id) ON DELETE CASCADE,
    username  text NOT NULL CHECK (btrim(username) <> ''),
    marked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (thread_id, username)
);

COMMENT ON TABLE discussion_bookmark IS
    'Private to the caller. No screen and no query totals these or shows one '
    'person another person''s bookmarks.';

-- ---------------------------------------------------------------------------
-- The event stream
-- ---------------------------------------------------------------------------

-- What the browser catches up on after a dropped connection.
--
-- The SSE endpoint takes `after=<event_id>` and replays from there, so a
-- reconnect resumes instead of restarting. That is only possible because the
-- events are NUMBERED AND KEPT — a pure fan-out over a channel would have
-- nothing to resume from, and the screen would silently miss whatever arrived
-- while the tunnel was down.
CREATE TABLE collaboration_event (
    event_id        bigserial PRIMARY KEY,
    kind            text NOT NULL CHECK (kind IN (
                        'chat.message', 'chat.read', 'discussion.thread',
                        'discussion.post')),
    conversation_id uuid REFERENCES chat_conversation(conversation_id) ON DELETE CASCADE,
    thread_id       uuid REFERENCES discussion_thread(thread_id) ON DELETE CASCADE,
    -- Who may be told. Empty means everybody signed in — a discussion is
    -- readable by the whole business; a conversation is not.
    audience        text[] NOT NULL DEFAULT '{}',
    payload         jsonb NOT NULL,
    occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_collaboration_event_occurred ON collaboration_event (occurred_at);

COMMENT ON COLUMN collaboration_event.audience IS
    'Usernames allowed to receive this event. Empty array means every '
    'authenticated reader, which is correct for discussions and never for '
    'conversations.';
