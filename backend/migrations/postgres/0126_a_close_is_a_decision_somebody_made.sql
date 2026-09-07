-- A close is a decision somebody made, and a reopen is another one.
--
-- `fiscal_period` as 0050 left it can say a month is closed and who closed it,
-- and that is all it can say. It cannot say a month was closed on the 3rd,
-- reopened on the 5th because a supplier's credit note arrived, and closed
-- again on the 7th — and that sequence is the one an auditor asks about. The
-- row holds the CURRENT state; the history belongs somewhere that cannot be
-- overwritten.
--
-- # Why the checklist is stored, and stored here
--
-- A close that refused until every critical check passed, and then kept no
-- record of what passed, would be a control nobody can re-examine. Six months
-- later "was the bank reconciled when September closed?" has no answer, because
-- the only evidence was a screen. So the verdict is snapshotted into the event
-- as json at the moment of the close: what was checked, what each check found,
-- and which ones were merely advisory. It is deliberately a snapshot and not a
-- foreign key into anything — re-running the checks today answers a different
-- question, and the whole point is what was true then.
--
-- # Why the reopen columns exist as well as the events
--
-- `reopened_at/by/reason` on the row are the LAST reopen, denormalised, because
-- every screen that lists periods wants to badge "reopened" without joining. The
-- event table is the truth; these three are a cache of its most recent REOPEN,
-- written by the same statement that writes the event.

ALTER TABLE fiscal_period
    ADD COLUMN reopened_at   timestamptz,
    ADD COLUMN reopened_by   text,
    ADD COLUMN reopen_reason text;

ALTER TABLE fiscal_period
    -- All three or none. A reopen with no reason recorded is the case this
    -- whole migration exists to make impossible.
    ADD CONSTRAINT fiscal_period_reopen_is_whole
        CHECK (num_nonnulls(reopened_at, reopened_by, reopen_reason) IN (0, 3)),
    ADD CONSTRAINT fiscal_period_reopen_reason_is_said
        CHECK (reopen_reason IS NULL OR btrim(reopen_reason) <> '');

COMMENT ON COLUMN fiscal_period.reopen_reason IS
    'Why the most recent reopen happened. The history is fiscal_period_event; this is a cache of its latest REOPEN so a list screen need not join.';

-- Every close and every reopen, appended.
CREATE TABLE fiscal_period_event (
    event_id  uuid PRIMARY KEY,
    year      smallint NOT NULL,
    month     smallint NOT NULL,

    event     text NOT NULL CHECK (event IN ('CLOSE', 'REOPEN')),

    -- The session's username, never a value from a request body. Same rule the
    -- employment audit keeps: an authority that can be typed is not an
    -- authority.
    actor     text NOT NULL CHECK (btrim(actor) <> ''),

    -- Optional on a close — the checklist below is the record there — and
    -- mandatory on a reopen, where it is the only record of why a sealed month
    -- was unsealed.
    reason    text,

    -- What the checklist said at the moment of the decision. Null on a reopen:
    -- reopening is not a checked act, it is an admitted one.
    checklist jsonb,

    at        timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (year, month) REFERENCES fiscal_period (year, month),
    CHECK (event <> 'REOPEN' OR (reason IS NOT NULL AND btrim(reason) <> '')),
    CHECK (event <> 'CLOSE' OR checklist IS NOT NULL)
);

CREATE INDEX ix_fiscal_period_event ON fiscal_period_event (year DESC, month DESC, at DESC);

-- Append-only, for the reason the journal is: a history somebody can edit is a
-- history that proves nothing. Its own function rather than `protect_journal`,
-- because that one advises writing a reversing entry, which is not advice that
-- means anything here.
CREATE OR REPLACE FUNCTION protect_period_event() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'a period''s history is append-only: close or reopen the month again, do not % the record',
        lower(TG_OP);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fiscal_period_event_append_only
    BEFORE UPDATE OR DELETE ON fiscal_period_event
    FOR EACH ROW EXECUTE FUNCTION protect_period_event();

COMMENT ON TABLE fiscal_period_event IS
    'Every close and reopen of every month, with its actor, its reason and — on a close — the checklist snapshot that permitted it. Append-only.';
COMMENT ON COLUMN fiscal_period_event.checklist IS
    'The CloseVerdict as it stood at the moment of the close. A snapshot on purpose: re-running the checks today answers a different question.';
