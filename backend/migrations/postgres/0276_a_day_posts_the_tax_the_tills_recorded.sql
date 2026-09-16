-- A day posts the tax the tills recorded, not the tax a rate implies.
--
-- # What was wrong
--
-- `sales_posting` read a day's takings and then EXTRACTED the VAT from them:
-- `vat_within(bucket.receipts_minor, day_vat_rate_bps())`, where the rate is the
-- highest `commercial_tax_rule.rate_bps` on the newest publication, or 11% when
-- a node's commercial module has never been seeded.
--
-- The receipts already carry the answer. `sale.tax_minor` is NOT NULL on every
-- central sale and `edge_sale.tax_total_minor` is written by the till from the
-- pricing engine's own quote, per line, per tax category, at the book that was
-- in force WHEN THE CUSTOMER PAID. Recomputing it at a day-level rate throws
-- that away and replaces a transaction's own figure with an inference.
--
-- Measured on 21,829 real sales (`docs/finance-day-posting-authority.md`):
--
--     recorded                 1,359,033,170
--     recomputed at 11% incl.  1,359,022,320
--     difference                      10,850   (0.0008%)
--
-- Not a wrong rate — rounding. The receipt rounds once per sale; the posting
-- rounded once per tender bucket. Small, and in the direction that under-declares
-- output VAT, and it is somebody else's money either way.
--
-- # What this migration does
--
-- Nothing to any figure already posted. It adds the three columns the document
-- needs so the choice is VISIBLE on the working paper rather than implied by
-- which version of the code ran:
--
--   vat_source          'RECORDED' when every sale and every returned line in
--                       the window carried its own tax, 'RATE' when any of them
--                       did not and the rate had to stand in. Never a blend --
--                       a day is one or the other, and the column says which.
--   vat_recorded_minor  what the sources actually recorded, net of returns.
--                       NULL on a 'RATE' day, because on that day there is no
--                       such figure and nought would claim there was.
--   vat_recomputed_minor what the rate says the same day comes to. Kept on
--                       every day, including a 'RECORDED' one, because that is
--                       what makes the two comparable: the anomaly check is a
--                       column an auditor can query, not a log line.
--
-- # Why existing rows read 'RATE'
--
-- Because that is what they are. Every `sales_posting` row written before this
-- was extracted at a rate, and `vat_recomputed_minor` is backfilled from
-- `vat_minor` for the same reason: on those documents the two ARE the same
-- number, and saying so is how a reader can tell an old day from a new one that
-- happens to agree.
--
-- Idempotent: `ADD COLUMN IF NOT EXISTS`, and the backfill only touches rows
-- whose new column is still null.

ALTER TABLE sales_posting
    ADD COLUMN IF NOT EXISTS vat_source text NOT NULL DEFAULT 'RATE',
    ADD COLUMN IF NOT EXISTS vat_recorded_minor bigint,
    ADD COLUMN IF NOT EXISTS vat_recomputed_minor bigint;

UPDATE sales_posting SET vat_recomputed_minor = vat_minor
 WHERE vat_recomputed_minor IS NULL;

ALTER TABLE sales_posting
    ALTER COLUMN vat_recomputed_minor SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'sales_posting_vat_source_is_one_of_two'
    ) THEN
        ALTER TABLE sales_posting
            ADD CONSTRAINT sales_posting_vat_source_is_one_of_two
            CHECK (vat_source IN ('RECORDED', 'RATE'));
    END IF;

    -- A recorded day has a recorded figure and a rate day does not. Without
    -- this the two columns can drift into a state that reads as "recorded" and
    -- carries nothing, which is the shape a silent fallback would leave behind.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'sales_posting_recorded_day_has_a_recorded_figure'
    ) THEN
        ALTER TABLE sales_posting
            ADD CONSTRAINT sales_posting_recorded_day_has_a_recorded_figure
            CHECK ((vat_source = 'RECORDED') = (vat_recorded_minor IS NOT NULL));
    END IF;
END $$;

COMMENT ON COLUMN sales_posting.vat_source IS
    'RECORDED: posted VAT is the sum of the sources own tax. RATE: no source '
    'carried one and vat_rate_bps stood in.';
COMMENT ON COLUMN sales_posting.vat_recomputed_minor IS
    'What vat_rate_bps says the same day comes to. Validation, never posted on '
    'a RECORDED day.';
