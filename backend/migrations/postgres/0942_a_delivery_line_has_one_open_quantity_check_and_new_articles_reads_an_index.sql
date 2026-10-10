-- Two things the quantity check stress test found on a million sales
-- (9 Oct 2026, 2.2 million delivery lines).
--
-- 1. A delivery line has at most ONE open quantity check. `ask` looked for an
--    open check and inserted one if there was none, with nothing to stop two
--    askers doing that at the same moment: 8 simultaneous asks on each of 50
--    lines left 5 lines with two open checks, and the two askers were told
--    different ids. The rule is now the table's own.
--
-- 2. The first page of New articles — the delivered lines nobody has named yet,
--    oldest first — sorted all 2.2 million delivery lines (48 s). An index in
--    that order lets it stop after the page.

-- An older open check is superseded by the newest; the answers already given
-- (COUNTED) are never touched.
DELETE FROM quantity_check q
 USING quantity_check n
 WHERE q.status = 'REQUESTED' AND n.status = 'REQUESTED'
   AND q.receipt_line_id = n.receipt_line_id
   AND (n.requested_at, n.check_id) > (q.requested_at, q.check_id);

CREATE UNIQUE INDEX IF NOT EXISTS quantity_check_one_open_idx
    ON quantity_check (receipt_line_id) WHERE status = 'REQUESTED';

CREATE INDEX IF NOT EXISTS ix_goods_receipt_line_to_name
    ON goods_receipt_line (verified_at, receipt_line_id) WHERE matched_quantity > 0;
