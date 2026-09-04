-- A conversation is worth keeping.
--
-- The assistant was built to hold no conversation state: the browser carried
-- the transcript and posted the whole of it with every question. That is a
-- clean server and it is the wrong trade for the thing this actually is. A
-- question worth asking about the fleet is worth asking again next week, from
-- a different machine, and a transcript that lives in one tab dies with it —
-- along with the reads it was built on, which is the part somebody would want
-- to show a colleague.
--
-- So the transcript moves here, and with it the sidebar of past chats. Two
-- consequences worth naming, because both are deliberate:
--
--   * The browser now sends a conversation id and one question. The server
--     loads what came before. That is what makes the same chat continue in the
--     ⌘J panel and on the full page without either of them synchronising
--     anything.
--   * Tool results are stored beside the answer. Not so the model can read
--     them — it re-reads on every turn, and stale figures are the one thing
--     this assistant must never do — but so a reopened conversation redraws
--     the table and the chart that were under the answer rather than a gap.
--
-- Owned by a username and not a `app_user` foreign key, like `report` and
-- `created_by` everywhere else in this schema: a conversation outlives the
-- account that held it, and a node running without authentication has a
-- truthful actor that is not a row in that table.

CREATE TABLE assistant_conversation (
    conversation_id uuid PRIMARY KEY,
    owner_username  text NOT NULL,
    -- The first question, trimmed. A title the model composes would cost a
    -- second round trip before the first answer starts, and what somebody
    -- typed is what they will look for in the list.
    title           text NOT NULL,
    -- Where the conversation started, as a path. Only for the list — a chat
    -- opened from Finance and one opened from Inventory read differently at a
    -- glance.
    started_at_page text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- Moved on every turn: the list is ordered by it, so a chat somebody came
    -- back to is at the top rather than a chat somebody started.
    updated_at      timestamptz NOT NULL DEFAULT now(),
    archived_at     timestamptz
);

CREATE INDEX assistant_conversation_by_owner
    ON assistant_conversation (owner_username, updated_at DESC)
    WHERE archived_at IS NULL;

-- One turn. Both halves of an exchange are rows here rather than one row with
-- two columns: a question whose answer failed is still a question that was
-- asked, and it has to survive in the list on its own.
CREATE TABLE assistant_message (
    message_id      uuid PRIMARY KEY,
    conversation_id uuid NOT NULL
        REFERENCES assistant_conversation (conversation_id) ON DELETE CASCADE,
    -- Position in the conversation. Explicit rather than ordering by clock:
    -- a question and the answer to it can land inside the same millisecond,
    -- and a transcript that renders out of order is worse than no transcript.
    seq             integer NOT NULL,
    role            text NOT NULL CHECK (role IN ('user', 'assistant')),
    content         text NOT NULL,
    -- The summarised reasoning, when the model showed any. Kept apart from
    -- `content` because it is not part of the answer and must never be sent
    -- back to the model as if it were.
    thinking        text,
    -- Every read behind this answer: name, arguments, whether it succeeded and
    -- what came back. An array, in the order the model made them.
    runs            jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Set when the turn ended badly, so a reopened conversation shows the
    -- failure instead of silently dropping the question.
    error           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, seq)
);

CREATE INDEX assistant_message_by_conversation
    ON assistant_message (conversation_id, seq);
