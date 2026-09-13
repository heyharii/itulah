-- 0237: An asset did not start depreciating here, and the register does not say
--       how far it got.
--
-- # What the client's own file does not carry
--
-- `MASTER ASSET.xls` has a column for it — `S/D TAHUN LALU`, depreciation up to
-- last year — and the column is **zero on all 1,342 rows**. Meanwhile 1,129 of
-- those assets were bought in 2021 or earlier. Their register is a schedule of
-- COSTS; how much of each has already been written down lives only in the
-- balances of `10216*` in the system being replaced.
--
-- `run_depreciation` sums what it has charged ITSELF and nothing else. So on
-- the first run every asset would start from zero. What that does is not
-- "charge a bit too much":
--
--   * 273 of the 468 live straight-line assets are already past their useful
--     life, and `period_index` comes from the calendar, so they are skipped —
--     `FullyDepreciated`, correctly, and silently.
--   * The other 195 (Rp 12.26 billion of cost) are mid-life. Each charges its
--     ORIGINAL monthly instalment for the months that remain, and the final
--     instalment sweeps whatever is left over — `Outcome::Post(remaining)` in
--     `domain::depreciation`, which exists so a schedule lands exactly on
--     salvage. With nothing carried in, "whatever is left" is every month that
--     elapsed before this system existed: **about Rp 5.70 billion**, landing in
--     one month per asset.
--
-- The sweep is right and the arithmetic is right. What is missing is the fact
-- that the asset did not start here.
--
-- # Why a figure and a date, and not a count of instalments
--
-- ERPNext carries `opening_accumulated_depreciation` beside
-- `opening_number_of_booked_depreciations`, because its schedule is a list of
-- rows and it has to know how many of them are already spent. Ours is not: the
-- instalment index is months since `in_service_on`, read off the calendar, so
-- the count is already known and storing it again would give two answers to one
-- question.
--
-- The DATE is not the count. It says what the figure covers — "this much, up to
-- and including August 2026" — and it is what lets a run refuse a month the old
-- system already charged. Without it, running July after a cutover in August
-- would post a second charge for a month that is already in the opening
-- balance, and nothing would notice: the entry is for a month this system has
-- no row for.
--
-- They are therefore recorded together or not at all. A carried figure with no
-- date is a number nobody can check twice.
--
-- # Where the number comes from, and where it does not
--
-- Not from the register — the column is empty. It comes from the old system's
-- `10216*` balance per unit per sub-family at cutover, which is the same
-- cutover exercise every other opening balance goes through. Until it is done,
-- leaving this null is the honest state: null here means "nothing was carried
-- in", and for an asset bought after the cutover that is simply true.
--
-- # Appended like everything else
--
-- This is part of the basis, so it lives on `asset_capitalization` and arrives
-- the way the rest of the basis does: as a new assessment. A corrected opening
-- figure is a new row with a reason, and the old one stays readable.

ALTER TABLE asset_capitalization
    ADD COLUMN opening_accumulated_minor bigint,
    ADD COLUMN opening_through date;

-- Only a capitalised asset has a basis to carry anything into.
ALTER TABLE asset_capitalization
    ADD CONSTRAINT asset_capitalization_opening_follows_decision
        CHECK (decision = 'CAPITALIZE'
               OR (opening_accumulated_minor IS NULL AND opening_through IS NULL));

-- Both, or neither.
ALTER TABLE asset_capitalization
    ADD CONSTRAINT asset_capitalization_opening_is_dated
        CHECK ((opening_accumulated_minor IS NULL) = (opening_through IS NULL));

-- It cannot have written down more than there was to write down. Equal is
-- allowed and means the asset arrived here already at salvage — real, and the
-- run will say `FullyDepreciated` rather than charging a negative month.
ALTER TABLE asset_capitalization
    ADD CONSTRAINT asset_capitalization_opening_is_within_basis
        CHECK (opening_accumulated_minor IS NULL
               OR (opening_accumulated_minor >= 0
                   AND opening_accumulated_minor
                       <= capitalized_cost_minor - salvage_value_minor));

-- A month named by its first day, as `asset_depreciation_entry.period_month`
-- is, and never before the asset went into service.
ALTER TABLE asset_capitalization
    ADD CONSTRAINT asset_capitalization_opening_is_a_month
        CHECK (opening_through IS NULL
               OR (EXTRACT(DAY FROM opening_through) = 1
                   AND opening_through >= date_trunc('month', in_service_on)::date));

COMMENT ON COLUMN asset_capitalization.opening_accumulated_minor IS
    'What was already depreciated before this system, from the old ledger''s 10216* balance — never from the client register, whose S/D TAHUN LALU column is empty on all 1,342 rows. Null means nothing was carried in.';
COMMENT ON COLUMN asset_capitalization.opening_through IS
    'The last month the opening figure covers, named by its first day. A run refuses to charge this month or any before it: that period was charged by the system this one replaced.';
