-- A Surat Jalan Retur has a number of its own (owner, 2026-10-16: "2026-1,
-- 2026-2" above the Tgl): the year it was made in and its place in that year,
-- counting from 1 again each January.
--
-- It is given once, with the note's link (0962) — the first print of a note
-- makes the link and the number together, and every reprint finds both — so a
-- note keeps its number however often it is printed. The year is the
-- business's, Jakarta time. Notes already made are numbered in the order they
-- were made.
--
-- The number is the database's to give, in a trigger, so whatever inserts a
-- note gets one: a binary from before this migration, still serving during a
-- rollout, as much as the new one. Notes are numbered one at a time under a
-- lock held to the end of the transaction, so two printers never take the
-- same place.
ALTER TABLE return_note_link ADD COLUMN number text;

UPDATE return_note_link AS link
   SET number = numbered.number
  FROM (
      SELECT token,
             to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY') || '-' ||
             row_number() OVER (
                 PARTITION BY to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY')
                 ORDER BY created_at, token
             ) AS number
        FROM return_note_link
  ) AS numbered
 WHERE link.token = numbered.token;

ALTER TABLE return_note_link ALTER COLUMN number SET NOT NULL;
ALTER TABLE return_note_link
    ADD CONSTRAINT return_note_link_number_key UNIQUE (number);

CREATE FUNCTION return_note_link_number() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    year text := to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY');
BEGIN
    IF NEW.number IS NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('return_note_link.number'));
        SELECT year || '-' || (COALESCE(max(split_part(number, '-', 2)::int), 0) + 1)
          INTO NEW.number
          FROM return_note_link
         WHERE number LIKE year || '-%';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER return_note_link_number
    BEFORE INSERT ON return_note_link
    FOR EACH ROW EXECUTE FUNCTION return_note_link_number();
