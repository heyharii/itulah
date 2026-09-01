-- The hang tag learns the two words a shopper reads it for.
--
-- `print_item` snapshots what goes on a label so a reprint six weeks later
-- reproduces the label that was printed. It was snapshotting the article name
-- and the price but not the colourway or the size, so the tag could name the
-- garment and its price without saying whether it would fit — the one field a
-- rail is actually shopped by.
--
-- Nullable, and deliberately not backfilled: rows queued before this migration
-- belong to runs whose job lines may since have been edited, and inventing
-- their colour from today's master data would print a label that never existed.
-- Those labels render without the line, which is what they did when they were
-- queued.
ALTER TABLE print_item ADD COLUMN colour_label TEXT;
ALTER TABLE print_item ADD COLUMN size_label TEXT;
