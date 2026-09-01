-- 0014: The last column that still calls a koli a package.
--
-- Migration 0009 renamed the box and its units; this one is the reference to it
-- left behind on the progress event, which 0013 repaired the target of but not
-- the name.

ALTER TABLE dc_fulfillment_progress_event RENAME COLUMN package_id TO koli_id;
