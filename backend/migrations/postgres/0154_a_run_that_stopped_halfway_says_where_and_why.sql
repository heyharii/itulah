-- 0154: A run that stopped halfway says where it stopped and why.
--
-- # Why the statuses are not enough
--
-- 0153 gives every item a status, so a screen can show which rows were paid.
-- What it cannot show is the shape of the afternoon: that the run was started
-- at 14:02 and got to line nine; that line ten was skipped because nobody had
-- verified the account; that somebody changed the policy from SKIP to HOLD and
-- restarted; that lines eleven to twenty went out at 16:40 under a different
-- person's login.
--
-- Every one of those is the question asked afterwards, and none of them can be
-- answered by a column that only holds the latest value. `skip_reason` on the
-- item is overwritten by the retry that succeeds; `status` on the batch is a
-- single word for a thing that happened in four sittings.
--
-- # Why it is an event log and not an audit table
--
-- `audit_log` (0078) records who changed what, which is a different question.
-- This records what a RUN did — including the things that changed nothing,
-- which are the interesting ones. A row skipped by policy leaves no diff for an
-- audit trail to catch; it is precisely the payment that did not happen, and
-- the reason it did not is the record somebody needs.
--
-- Append-only, and small: one row per attempt per item, plus one per run
-- started, held, resumed or cancelled. A twenty-line batch executed in two
-- sittings is about twenty-five rows.

CREATE TABLE payment_batch_event (
    event_id        uuid PRIMARY KEY,
    -- No cascade on either reference, deliberately. The trigger below refuses
    -- every DELETE, so a cascade would only turn "you cannot delete this" into
    -- an error from a table nobody was looking at. Refusing here instead says
    -- the true thing: a batch or an item a run has already touched cannot be
    -- deleted, only cancelled.
    batch_id        uuid NOT NULL REFERENCES payment_batch(batch_id),
    -- NULL for an event about the whole run.
    item_id         uuid REFERENCES payment_batch_item(item_id),

    -- AUTHORISED     the run was signed off
    -- RUN_STARTED    somebody began executing, or resumed
    -- ITEM_EXECUTED  one PAY went out
    -- ITEM_SKIPPED   passed over by policy
    -- ITEM_FAILED    tried and refused
    -- POLICY_APPLIED the unverified-destination policy decided something
    -- HELD           the run stopped
    -- CANCELLED      the run was abandoned
    kind            text NOT NULL CHECK (kind IN (
                        'AUTHORISED', 'RUN_STARTED', 'ITEM_EXECUTED', 'ITEM_SKIPPED',
                        'ITEM_FAILED', 'POLICY_APPLIED', 'HELD', 'CANCELLED')),

    -- The sentence a person reads. Written in the same voice as the refusals
    -- everywhere else in this schema, because it is read in the same
    -- circumstances: after something did not go the way somebody expected.
    detail          text NOT NULL CHECK (btrim(detail) <> ''),

    -- Which policy was in force when this happened. Carried on the event and
    -- not only on the batch, so that a run executed under SKIP and resumed
    -- under HOLD can be read honestly afterwards. This is "record which was
    -- chosen and why" made durable against somebody changing their mind
    -- halfway.
    policy_in_force text CHECK (policy_in_force IS NULL
                                OR policy_in_force IN ('SKIP', 'HOLD')),

    -- The document, when the event produced one. Copied rather than joined, so
    -- the log still reads after an item is deleted from a draft.
    cash_document_id uuid,
    amount_minor    bigint CHECK (amount_minor IS NULL OR amount_minor > 0),

    occurred_at     timestamptz NOT NULL DEFAULT now(),
    actor           text NOT NULL CHECK (btrim(actor) <> ''),

    -- An event about an item names the item.
    CHECK (kind NOT IN ('ITEM_EXECUTED', 'ITEM_SKIPPED', 'ITEM_FAILED')
           OR item_id IS NOT NULL)
);

CREATE INDEX ix_payment_batch_event_batch
    ON payment_batch_event (batch_id, occurred_at);
CREATE INDEX ix_payment_batch_event_item
    ON payment_batch_event (item_id, occurred_at) WHERE item_id IS NOT NULL;

-- Append-only, enforced. A log that could be edited is a log nobody has to
-- believe, and the whole value of this table is that the afternoon it describes
-- is the afternoon that happened.
CREATE OR REPLACE FUNCTION payment_batch_event_is_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'the record of what a payment run did is append-only; add an event saying what was corrected rather than editing what was written';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_batch_event_append_only
    BEFORE UPDATE OR DELETE ON payment_batch_event
    FOR EACH ROW EXECUTE FUNCTION payment_batch_event_is_append_only();

COMMENT ON TABLE payment_batch_event IS
    'What a payment run actually did, in order: started, resumed, each item paid, skipped or refused, and under which unverified-destination policy. Append-only. The statuses in 0153 hold the latest value; this holds the afternoon.';
COMMENT ON COLUMN payment_batch_event.policy_in_force IS
    'The policy at the moment of the event, not the batch''s policy today. A run begun under SKIP and resumed under HOLD reads honestly because of this column.';
