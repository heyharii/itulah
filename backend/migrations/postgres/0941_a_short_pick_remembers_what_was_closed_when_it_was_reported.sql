-- A short pick's status is read, never stored (`cloud/dc/short_pick.rs`):
-- still short, found or lost by the count it raised, picked after all, or
-- closed by MD. The last two look the same from the line's counters alone —
-- nothing of the report is left to pick — so the report remembers how much
-- of its allotment × shop × SKU was already closed short when it was made
-- (`allotment_line_commitment.closed_short_total`, summed). Anything closed
-- after that is MD giving the remainder up, not the picker fetching it.

ALTER TABLE dc_short_pick
    ADD COLUMN IF NOT EXISTS closed_short_at_report bigint NOT NULL DEFAULT 0
        CHECK (closed_short_at_report >= 0);
