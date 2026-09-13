-- A record can be talked about, and filed under a word.
--
-- # Comments
--
-- This system could log what people did to a record and could not hold what
-- they said about it. The nearest thing was `discussion_thread`, which is a
-- forum: it has a title, a status, an accepted answer, bookmarks and a view
-- count, and it lives on its own screen. That is right for an argument — "this
-- invoice is 400k over the order, who is paying" — and far too much apparatus
-- for the two lines somebody wants to leave on a bill so that the next person
-- to open it knows why it was posted late.
--
-- So: a comment is a sentence on a record, and a thread is an argument about
-- one. Both hang off the same `(subject_kind, subject_id)` pair, and a screen
-- can show them together because they now speak the same vocabulary.
--
-- # Why comments and the activity log stay separate tables
--
-- ERPNext, which is where the shape of this came from, puts both in one table
-- and tells them apart with a `comment_type` — `Comment` for a person,
-- `Created`/`Submitted`/`Assigned` for the system. One table, one timeline,
-- and no join to read a record's history.
--
-- It is not the trade to take here. `audit_log` is written by a middleware
-- from what the server observed, and nothing may edit it; a comment is written
-- by a person who may edit it and delete it. Putting an editable row and an
-- evidence row in one table means one `UPDATE` away from an audit trail that
-- can be rewritten, and no constraint short of a trigger to stop it.
--
-- They are joined where it is safe to join them: on the way out, by the
-- `info` read, which returns both already ordered. One timeline on screen, two
-- tables underneath, and only one of them writable.
--
-- # Why there are no attachments here
--
-- A file that belongs to a record belongs in the drawer, where it is findable
-- a year later by somebody who only remembers that it mentioned cotton. A file
-- that belongs to a conversation belongs to the thread that carries it, which
-- is what `discussion_post_attachment` is for. A third half-way house — bytes
-- reachable only through a comment on a sheet — would be the thing
-- `0075_documents.sql` was written to stop.

CREATE TABLE comment (
    comment_id   uuid PRIMARY KEY,
    subject_kind text NOT NULL REFERENCES record_kind(code),
    subject_id   text NOT NULL CHECK (btrim(subject_id) <> ''),
    -- The author's username, copied rather than referenced, for the reason
    -- `audit_log` copies it: somebody who leaves is deactivated, and what they
    -- wrote on a purchase order in March still has to say who wrote it.
    author       text NOT NULL CHECK (btrim(author) <> ''),
    display_name text NOT NULL CHECK (btrim(display_name) <> ''),
    body         text NOT NULL CHECK (btrim(body) <> ''),
    created_at   timestamptz NOT NULL DEFAULT now(),
    -- Null until somebody changes their own words. Shown, rather than hidden:
    -- a comment that quietly became a different comment is worse than one
    -- that says it was edited.
    edited_at    timestamptz CHECK (edited_at IS NULL OR edited_at >= created_at)
);

-- The sheet's query: one record's comments, oldest first, because a
-- conversation is read in the order it was had.
CREATE INDEX ix_comment_subject ON comment (subject_kind, subject_id, created_at);
CREATE INDEX ix_comment_author ON comment (author, created_at DESC);

COMMENT ON TABLE comment IS
    'What a person said about a record. Editable and deletable by its author, '
    'which is exactly why it is not in `audit_log`.';

-- ---------------------------------------------------------------------------
-- Tags on any record
-- ---------------------------------------------------------------------------

-- Deliberately NOT a widening of `article_tag`, and this is the load-bearing
-- decision in this file.
--
-- `article_tag` is merchandising data. The pricing engine reads it: a
-- promotion whose scope is `{"on":"TAG","tags":["DENIM"]}` matches articles
-- through that table, and `0175` freezes the SKU set it produced. A tag there
-- is a fact about the product that money depends on.
--
-- A tag HERE is somebody filing a record so they can find it again — "chase
-- this", "Q4 audit", "ask Budi". Same shape, different thing. Put them in one
-- table and a person sticking "urgent" on a purchase order has quietly changed
-- which products a live promotion covers, and nothing in either screen would
-- say so.
--
-- They share the `tag` vocabulary, because two spellings of one word is the
-- split `0027` was written to prevent and that has not changed.
CREATE TABLE record_tag (
    subject_kind text NOT NULL REFERENCES record_kind(code),
    subject_id   text NOT NULL CHECK (btrim(subject_id) <> ''),
    tag_code     text NOT NULL REFERENCES tag(code) ON DELETE RESTRICT,
    tagged_by    text NOT NULL CHECK (btrim(tagged_by) <> ''),
    tagged_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (subject_kind, subject_id, tag_code)
);

-- "What is filed under `chase-this`", which is the question a tag is put on a
-- record to be able to ask.
CREATE INDEX ix_record_tag_code ON record_tag (tag_code, subject_kind, subject_id);

COMMENT ON TABLE record_tag IS
    'Organisational tags on any record. NOT `article_tag`: that one is '
    'merchandising data the pricing engine reads, and the two must not merge.';
