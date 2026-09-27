-- A DC counts in any unit and keeps pieces.
--
-- A line carries the unit it was ordered in ("10 KODI", factor 20) and every
-- unit it may be counted in, with the factor to pieces the centre worked out
-- (the item's own pack size, else the global conversion). A count may be
-- typed in any of them — "9.5 KODI" — and is stored in pieces (190) beside
-- what was typed, so the verifier sees both. Owner, 2026-09-26.
--
-- Applied only when `count_units` is absent; see `edge::sqlite`.
ALTER TABLE purchase_order_line ADD COLUMN order_unit_code TEXT;
ALTER TABLE purchase_order_line ADD COLUMN order_unit_quantity TEXT;
ALTER TABLE purchase_order_line ADD COLUMN unit_factor TEXT;
ALTER TABLE purchase_order_line ADD COLUMN count_units TEXT;
ALTER TABLE receiving_count ADD COLUMN counted_unit_code TEXT;
ALTER TABLE receiving_count ADD COLUMN counted_unit_quantity TEXT;
