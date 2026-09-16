-- A month closed over its own blockers says so, in a column of its own.
--
-- `finance_close_month` refuses a month whose checks report blockers unless
-- somebody names a reason. The first version kept that reason in
-- `reopen_reason`, which already means something else — and the database said
-- so immediately:
--
--     new row for relation "fiscal_period" violates check constraint
--     "fiscal_period_reopen_is_whole"
--
-- Right refusal. A reopening is a reason, a date and a person together; a
-- forced close is a different fact and borrowing the column would have left a
-- period that reads as reopened and never was.
--
-- Two columns, because the count matters as much as the words: "closed over 1
-- blocker" and "closed over 9" are different decisions, and a reader six months
-- later should not have to reconstruct it from a sentence.

ALTER TABLE fiscal_period
    ADD COLUMN IF NOT EXISTS closed_over_reason text,
    ADD COLUMN IF NOT EXISTS closed_over_blockers integer;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_period_forced_close_is_whole'
    ) THEN
        ALTER TABLE fiscal_period
            ADD CONSTRAINT fiscal_period_forced_close_is_whole
            CHECK ((closed_over_reason IS NULL) = (closed_over_blockers IS NULL));
    END IF;
END $$;

COMMENT ON COLUMN fiscal_period.closed_over_reason IS
    'Why this month was closed while its own checks still reported blockers.
     Null on a clean close, which is what most of them should be.';
