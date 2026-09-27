-- A red store exception rings the bell.
--
-- Two notification kinds for the store exceptions list (0646-0647):
--
--   store.exception.raised     an exception was red when it was first found;
--   store.exception.escalated  one that was found yellow has turned red.
--
-- Each exception is told once (`store_exception.notified_at`), to its unit's
-- PIC and the job roles that own it. Nothing is told when it closes: the item
-- leaving the list is the news.
--
-- The kinds are ADDED to whatever the check holds when this runs rather than
-- written out in full. Other lanes (0641-0645) were adding kinds in the same
-- hours, and a list copied from 0630 would silently take theirs away again.

DO $$
DECLARE
    kinds text[];
BEGIN
    SELECT array_agg(DISTINCT m[1] ORDER BY m[1])
      INTO kinds
      FROM pg_constraint c,
           regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g') AS m
     WHERE c.conrelid = 'notification'::regclass
       AND c.conname = 'notification_kind_check';

    IF kinds IS NULL THEN
        RAISE EXCEPTION '0648: notification_kind_check is not where 0630 left it';
    END IF;

    kinds := ARRAY(
        SELECT DISTINCT k
          FROM unnest(kinds || ARRAY['store.exception.raised', 'store.exception.escalated']) AS k
         ORDER BY k
    );

    ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
    EXECUTE format(
        'ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (kind = ANY (%L::text[]))',
        kinds
    );
END
$$;
