-- 0918: a blind count may say that nothing came.
--
-- The owner (2026-10-05): Receiving can report a count of 0 for a line — the
-- supplier did not send it. Until now a count had to be at least one piece, so
-- a line that did not arrive was simply missing from the review and the buyer
-- never saw the shortage. A count of 0 is a statement, not stock: it puts
-- nothing in the Gudang, so accepting it writes no receipt line and no
-- movement, and the order stays owed what it was.
--
--   * `counted_quantity` may be 0.
--   * An ACCEPTED count still names its receipt line — except a count of 0,
--     which has none. A count that is not ACCEPTED never does.

DO $$
DECLARE
    name text;
BEGIN
    FOR name IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'dc_receiving_count'::regclass
           AND contype = 'c'
           AND (pg_get_constraintdef(oid) ILIKE '%counted_quantity > 0%'
                OR pg_get_constraintdef(oid) ILIKE '%status = ''ACCEPTED''%receipt_line_id%')
    LOOP
        EXECUTE format('ALTER TABLE dc_receiving_count DROP CONSTRAINT %I', name);
    END LOOP;
END $$;

ALTER TABLE dc_receiving_count
    ADD CONSTRAINT dc_receiving_count_counted_quantity_check
        CHECK (counted_quantity >= 0),
    ADD CONSTRAINT dc_receiving_count_receipt_line_check
        CHECK ((status <> 'ACCEPTED' AND receipt_line_id IS NULL)
               OR (status = 'ACCEPTED' AND (receipt_line_id IS NOT NULL OR counted_quantity = 0)));
