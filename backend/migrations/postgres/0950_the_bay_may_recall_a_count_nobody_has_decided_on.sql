-- 0950: the bay may recall its own count while nobody has decided on it.
--
-- The owner (2026-10-09): a checker who sees they counted wrong — a carton
-- missed, a size read as another — takes the count back before the buyer
-- reviews it, and counts the same arrival again. Until now the only way back
-- was to tell the buyer, who sent it back from Review Count
-- (`RECOUNT_REQUESTED`); meanwhile the wrong number sat in front of them and
-- could be accepted.
--
--   * `RECALLED` is a fourth status. A recalled count is never deleted: it
--     stays in the order's history beside the count that replaced it.
--   * Only a count still `AWAITING_VERIFICATION` may be recalled. Once it is
--     accepted the goods exist and the receipt stays; once the buyer sent it
--     back it is already the bay's to count again.
--   * Who recalled it, when, and why (optional) are kept on the row.

ALTER TABLE dc_receiving_count
    ADD COLUMN IF NOT EXISTS recalled_by   text,
    ADD COLUMN IF NOT EXISTS recalled_at   timestamptz,
    ADD COLUMN IF NOT EXISTS recall_reason text;

-- 0900's status CHECK was unnamed; drop it by what it says.
DO $$
DECLARE
    name text;
BEGIN
    FOR name IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'dc_receiving_count'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%AWAITING_VERIFICATION%'
           AND pg_get_constraintdef(oid) ILIKE '%RECOUNT_REQUESTED%'
    LOOP
        EXECUTE format('ALTER TABLE dc_receiving_count DROP CONSTRAINT %I', name);
    END LOOP;
END $$;

ALTER TABLE dc_receiving_count
    ADD CONSTRAINT dc_receiving_count_status_check
        CHECK (status IN ('AWAITING_VERIFICATION', 'RECOUNT_REQUESTED', 'ACCEPTED', 'RECALLED')),
    ADD CONSTRAINT dc_receiving_count_recalled_check
        CHECK ((status = 'RECALLED') = (recalled_at IS NOT NULL AND recalled_by IS NOT NULL));

COMMENT ON COLUMN dc_receiving_count.recalled_at IS
    'Set when the bay took the count back before review (0950); the count stays, status RECALLED.';
