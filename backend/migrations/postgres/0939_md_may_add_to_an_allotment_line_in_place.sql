-- MD may add to an allotment line in place (owner, 9 Oct 2026;
-- docs/research/2026-10-09-outbound-cancel-edit-build.md §1, "ADD").
--
-- Since 0005 a line's quantity could never change: what MD promised was
-- frozen, and giving part of it up was Close Short (allotment-v1 §7), never an
-- edit of the promise. That second half stands. What changes is that a
-- promise may now GROW: MD edits a line from 300 to 350 instead of raising a
-- second allotment for the 50. The 50 is a promise made later, and it is kept
-- as one: its own `allotment_amendment` row (kind ADD) and its own
-- ALLOTMENT_CREATED event beside the first, so the history still says what
-- was promised when.
--
-- A quantity that falls is still refused. A reduction is closed short (or
-- owed back, `takeout_pending_quantity`, 0938); writing it as a smaller
-- `quantity` would erase the evidence that it was ever promised.

CREATE OR REPLACE FUNCTION protect_allotment_line_identity() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'allotment lines cannot be deleted';
    END IF;
    IF OLD.allotment_id <> NEW.allotment_id
       OR OLD.source_site_id <> NEW.source_site_id
       OR OLD.source_pool_id <> NEW.source_pool_id
       OR OLD.destination_type <> NEW.destination_type
       OR OLD.destination_id <> NEW.destination_id
       OR OLD.sku_id <> NEW.sku_id
       OR OLD.created_at <> NEW.created_at THEN
        RAISE EXCEPTION 'allotment line identity is immutable';
    END IF;
    IF NEW.quantity < OLD.quantity THEN
        RAISE EXCEPTION 'an allotment line''s quantity never falls; close it short instead';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN allotment_line.quantity IS
    'What MD promised the destination. Rises when MD adds to the line in place (0939, allotment_amendment kind ADD); never falls — giving up is closed_short_quantity.';
