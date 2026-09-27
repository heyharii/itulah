-- A discussion can be followed, corrected, and answered properly.
--
-- The board was modelled on Discourse (the owner pointed at discuss.frappe.io)
-- and had the shape of one — a list of topics, a page per topic, an accepted
-- answer — without the parts that make a forum usable the second week:
--
--   * a post, once written, could never be corrected, and a typo in a
--     quantity stayed a wrong quantity forever;
--   * nothing said which replies arrived since you last looked, so a busy
--     thread had to be re-read from the top to find the new part;
--   * a reply could not say WHICH earlier post it answered;
--   * nobody could be called into an argument by name;
--   * the only way to hear about a thread was to have written in it.
--
-- Each block below is one of those, and each keeps the rules 0040 set down:
-- a thread hangs on a record, `people` counts people, bookmarks stay private.

-- ---------------------------------------------------------------------------
-- Posts: corrected, withdrawn, and pointed at an earlier one
-- ---------------------------------------------------------------------------

ALTER TABLE discussion_post
    -- Shown, not hidden — the rule `comment.edited_at` already follows: a post
    -- that quietly became a different post is worse than one that says so.
    ADD COLUMN edited_at timestamptz,
    -- Withdrawn rather than deleted. The row stays because its `seq` is a
    -- position other posts quote, and a hole in the numbering would move every
    -- "in reply to #4" onto the wrong post. The body stays in the row for the
    -- same reason `audit_log` is never edited; the API stops serving it.
    ADD COLUMN withdrawn_at timestamptz,
    ADD COLUMN withdrawn_by text,
    -- The earlier post this one answers, by position in the thread.
    ADD COLUMN reply_to_seq bigint,
    -- Minted by the browser before the first attempt, as `chat_message` does,
    -- so a reply resent after a dropped connection lands once.
    ADD COLUMN idempotency_key text;

ALTER TABLE discussion_post
    ADD CONSTRAINT discussion_post_edited_after_written
        CHECK (edited_at IS NULL OR edited_at >= created_at),
    ADD CONSTRAINT discussion_post_withdrawn_by_somebody
        CHECK ((withdrawn_at IS NULL) = (withdrawn_by IS NULL)),
    ADD CONSTRAINT discussion_post_withdrawn_by_named
        CHECK (withdrawn_by IS NULL OR btrim(withdrawn_by) <> ''),
    -- A reply can only answer something already said.
    ADD CONSTRAINT discussion_post_replies_to_earlier
        CHECK (reply_to_seq IS NULL OR (reply_to_seq > 0 AND reply_to_seq < seq)),
    -- A post nobody can read any more cannot be what answered the question.
    ADD CONSTRAINT discussion_post_withdrawn_is_no_answer
        CHECK (NOT (is_solution AND withdrawn_at IS NOT NULL)),
    ADD CONSTRAINT discussion_post_idempotency_key_named
        CHECK (idempotency_key IS NULL OR btrim(idempotency_key) <> '');

CREATE UNIQUE INDEX ux_discussion_post_idempotency
    ON discussion_post (thread_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- "Everything this person has said", for the Mine feed and for search.
CREATE INDEX ix_discussion_post_author ON discussion_post (author_username, thread_id);

-- What a post said before each correction. Revision N is the body as it stood
-- before the Nth edit; the current body is on the post. Kept because an edit
-- to "40 pieces" that makes it "4 pieces" is exactly the edit somebody will
-- later need to see was made.
CREATE TABLE discussion_post_revision (
    post_id     uuid NOT NULL REFERENCES discussion_post(post_id) ON DELETE CASCADE,
    revision    integer NOT NULL CHECK (revision > 0),
    body        text NOT NULL,
    replaced_by text NOT NULL CHECK (btrim(replaced_by) <> ''),
    replaced_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, revision)
);

-- ---------------------------------------------------------------------------
-- Reactions
-- ---------------------------------------------------------------------------

-- A short, closed set. "+1" on a proposal is an answer somebody would
-- otherwise write as a whole reply, and six of those in a row bury the post
-- that mattered. Closed, because an open emoji picker on a business record is
-- a place for jokes to accumulate.
CREATE TABLE discussion_post_reaction (
    post_id    uuid NOT NULL REFERENCES discussion_post(post_id) ON DELETE CASCADE,
    username   text NOT NULL CHECK (btrim(username) <> ''),
    reaction   text NOT NULL CHECK (reaction IN (
                   'thumbs_up', 'heart', 'tada', 'laugh', 'eyes', 'check')),
    reacted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, username, reaction)
);

-- ---------------------------------------------------------------------------
-- Threads: pinned, and corrected
-- ---------------------------------------------------------------------------

ALTER TABLE discussion_thread
    -- Pinned threads sit above the rest of the board. Head office's to set —
    -- "how to report a broken printer" belongs at the top for everybody.
    ADD COLUMN pinned_at timestamptz,
    ADD COLUMN pinned_by text,
    -- When the title, note or tags were last changed after opening.
    ADD COLUMN edited_at timestamptz;

ALTER TABLE discussion_thread
    ADD CONSTRAINT discussion_thread_pinned_by_somebody
        CHECK ((pinned_at IS NULL) = (pinned_by IS NULL)),
    ADD CONSTRAINT discussion_thread_edited_after_opened
        CHECK (edited_at IS NULL OR edited_at >= created_at);

CREATE INDEX ix_discussion_thread_pinned
    ON discussion_thread (pinned_at DESC) WHERE pinned_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Reading position
-- ---------------------------------------------------------------------------

-- Unread is a POSITION, the same decision `chat_participant.last_read_seq`
-- made: it is what lets the thread draw "new since your last visit" above the
-- right post, which a count or a flag would throw away.
ALTER TABLE discussion_thread_view
    ADD COLUMN last_read_seq bigint NOT NULL DEFAULT 0 CHECK (last_read_seq >= 0);

-- Whoever had opened a thread before today had read it as it then stood, and
-- that is the best this table knows. Starting everybody at zero would turn
-- every thread on the board "unread" on the morning this ships.
UPDATE discussion_thread_view v
   SET last_read_seq = COALESCE(
           (SELECT max(p.seq) FROM discussion_post p
             WHERE p.thread_id = v.thread_id
               AND p.created_at <= v.last_seen_at),
           0);

-- ---------------------------------------------------------------------------
-- Following
-- ---------------------------------------------------------------------------

-- Absent is the ordinary level: told about replies to a thread you opened or
-- have written in, and whenever somebody names you. `watching` is told about
-- every reply without having said anything; `muted` is told nothing at all,
-- names included — muting a thread that can still reach you is not muting it.
CREATE TABLE discussion_subscription (
    thread_id uuid NOT NULL REFERENCES discussion_thread(thread_id) ON DELETE CASCADE,
    username  text NOT NULL CHECK (btrim(username) <> ''),
    level     text NOT NULL CHECK (level IN ('watching', 'muted')),
    set_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (thread_id, username)
);

CREATE INDEX ix_discussion_subscription_username ON discussion_subscription (username);

-- ---------------------------------------------------------------------------
-- Notification kinds
-- ---------------------------------------------------------------------------

-- Two: somebody named you in a thread, and a reply you wrote was accepted as
-- the answer. The list is 0463's, unchanged, plus these two.
ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check
    CHECK (kind IN (
        'activity',
        'purchase.price_amendment.requested',
        'purchase.delivery.due_soon',
        'receipt.awaiting_identity',
        'receipt.excess_awaiting_decision',
        'finance.integrity.exception',
        'discussion.thread.opened',
        'discussion.thread.replied',
        'discussion.mentioned',
        'discussion.solution.accepted',
        'asset.assessment.overdue',
        'people.contract.expiring',
        'people.period.month_open',
        'people.roster.gap',
        'ga.contract.expiring',
        'ga.document.expiring',
        'finance.bill.due_soon',
        'finance.tax.deadline',
        'commercial.cap.near',
        'commercial.cap.reached',
        'commercial.rollout.failed',
        'commercial.rollout.stalled',
        'commercial.usage.stale',
        'commercial.guardrail.breached',
        'commercial.promotion.starting',
        'commercial.promotion.ending',
        'node.attention',
        'node.recovered'
    ));
