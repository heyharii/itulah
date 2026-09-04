-- The three vocabularies nobody could edit.
--
-- `division` and `size_code` arrived in 0022 and `tag` in 0027, all three as
-- controlled lists — precisely so a typo could not silently split a report.
-- What none of them got was a way in: they are readable only as facets and as
-- `catalogue_vocabulary`, and there has never been an endpoint that writes
-- one. Every term in all three tables is a row somebody INSERTed in a
-- migration, which means adding a size has meant shipping a release.
--
-- `colour` (0081) is the one that was done properly, and this brings the other
-- three up to it so one screen can serve all four:
--
--   * `version`, for the If-Match optimistic locking every other master write
--     here uses. Two merchandisers renaming the same term is not hypothetical
--     on a list this small and this shared, and a last-write-wins rename is a
--     rename that vanishes without telling anybody.
--   * `display_order` on `tag`, which the other three already had. Tags are
--     read as families — garment types together, then fits — and alphabetical
--     order shatters that into a list nobody scans. It has been ordered by
--     label alone since 0027 for want of the column.
--
-- No `hex_code` equivalent and no delete: a term with articles behind it
-- cannot be removed without leaving goods filed under nothing, which is why
-- `active` exists and why retiring is the operation people reach for delete
-- to do.

ALTER TABLE division  ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE size_code ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE tag       ADD COLUMN version integer NOT NULL DEFAULT 1;

-- Zero for every existing tag, which puts them all in one band and leaves
-- label as the tie-break — exactly the order they are read in today, so
-- nothing moves on screen until somebody deliberately orders them.
ALTER TABLE tag ADD COLUMN display_order integer NOT NULL DEFAULT 0;
