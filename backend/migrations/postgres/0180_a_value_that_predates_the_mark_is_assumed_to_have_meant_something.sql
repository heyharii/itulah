-- 0180: A value that predates the mark is assumed to have meant something.
--
-- `0167` gave the four master lists an `ever_used` flag and backfilled it from
-- what was referenced at that moment. That backfill was too generous, and the
-- header of that migration said so plainly: a tag that clothed eighty articles
-- in 2025 and was unpicked from the last of them in June has no live reference,
-- was therefore marked `false`, and became deletable — taking with it the word
-- that a printed label, a report and an audit line still read.
--
-- The owner's instruction of 2026-09-12 closes that hole the only way it can be
-- closed, since the evidence needed to distinguish "never used" from "used and
-- unpicked" was never recorded: **assume the worst about everything that
-- already exists.**
--
--     a row that predates the mark  → ever_used = true → retire only
--     a row created after the mark  → ever_used = false → deletable while unused
--
-- The cost is that a typo made before today can only be retired, which leaves a
-- misspelling in a list. The alternative cost is deleting a division that names
-- twelve thousand transactions in last year's report. Those are not comparable,
-- and this is the safe side of them.
--
-- From here the flag means what it says for every row that will ever be
-- created: false until first durable use, true from then on, never back.

UPDATE division  SET ever_used = true WHERE NOT ever_used;
UPDATE size_code SET ever_used = true WHERE NOT ever_used;
UPDATE tag       SET ever_used = true WHERE NOT ever_used;
UPDATE colour    SET ever_used = true WHERE NOT ever_used;

COMMENT ON COLUMN division.ever_used IS
    'Whether anything has ever pointed at this value. Set by the triggers in '
    '0167 and never cleared. Every row that existed at 0180 carries true '
    'regardless of its references, because "used and later unpicked" was not '
    'recorded before the mark existed.';
COMMENT ON COLUMN size_code.ever_used IS
    'See division.ever_used. True for everything that predates 0180.';
COMMENT ON COLUMN tag.ever_used IS
    'See division.ever_used. True for everything that predates 0180.';
COMMENT ON COLUMN colour.ever_used IS
    'See division.ever_used. True for everything that predates 0180.';
