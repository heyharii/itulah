-- A tax can be paid before the return goes in.
--
-- 0279 wrote `CHECK ((status = 'OPEN') = (filed_at IS NULL))`, which reads as
-- "only an open period has no filing stamp" and means what it did not intend:
-- a period cannot become SETTLED unless somebody has already recorded a filing
-- reference. That is not how any of these taxes work — a PPh 25 instalment is
-- paid on the fifteenth and the return follows, and a PPh 21 deduction is paid
-- before the monthly return is lodged — and the first settlement written after
-- 0279 died on it:
--
--     new row for relation "tax_period" violates check constraint
--     "tax_period_check"
--
-- The rule that was meant: a period marked FILED has a reference and a filer.
-- Settling says nothing about filing, and filing says nothing about paying.

ALTER TABLE tax_period DROP CONSTRAINT IF EXISTS tax_period_check;
ALTER TABLE tax_period DROP CONSTRAINT IF EXISTS tax_period_check1;

ALTER TABLE tax_period
    ADD CONSTRAINT tax_period_filed_has_a_reference
    CHECK (status <> 'FILED' OR (filed_at IS NOT NULL AND btrim(coalesce(filed_by, '')) <> ''));

ALTER TABLE tax_period
    ADD CONSTRAINT tax_period_filing_stamp_is_whole
    CHECK ((filed_at IS NULL) = (filed_by IS NULL));

COMMENT ON COLUMN tax_period.status IS
    'OPEN while it gathers, FILED once the return is lodged, SETTLED once the
     money has moved. The three are independent of each other except that FILED
     carries who filed it and when.';
