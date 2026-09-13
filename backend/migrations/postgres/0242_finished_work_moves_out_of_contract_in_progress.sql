-- 0242: Finished work moves out of Contract In Progress, and the move is a
--       journal.
--
-- 0215 gave an assessment a third answer — this is work that is not finished —
-- and made the assessment that capitalises it say what family it became. What
-- it deliberately did not do was post anything, and it said why: nothing in
-- this system had put the cost into `1031803` yet, so there was no balance to
-- move and a journal would have driven the client's own account negative.
--
-- That is no longer the whole picture. The client's register carries 664 rows
-- of Contract In Progress worth Rp 5.27 billion sitting against
-- `103180300100`..`113` — one account per unit, not per sub-family — and their
-- own file records the move as 24 rows literally named `REKLAS CIP`, each one
-- filed against the family it BECAME. The move is a thing they do by hand every
-- time a shop opens; it is ours to post once the balance is here.
--
-- # What the entry is
--
--     credit  work_in_progress   at the unit the work was done      (1031803*)
--     debit   fixed_asset        at the family it became            (10215*)
--
-- Cost only. Nothing is depreciated by this entry — the schedule starts from
-- the in-service date the same assessment names.
--
-- # Why it needs a source kind of its own
--
-- Every other entry this module writes says what rule wrote it: DEPRECIATION
-- for the monthly run, ASSET_DISPOSAL and ASSET_TRANSFER for the two ends of a
-- life. A reclass is none of those. Filing it as TRANSFER would put it in the
-- same bucket as an asset moving between shops, which is the report somebody
-- reads to find out where a thing went.
--
-- # What it does not do
--
-- It does not create the balance it moves. An asset whose work in progress was
-- never posted here — every imported row, until the opening balances are
-- carried in — has nothing in `1031803*` to take out, and the handler refuses
-- rather than crediting an account into the negative. The refusal names the
-- account and the figure, because the fix is a cutover entry, not a retry.

ALTER TABLE journal_entry DROP CONSTRAINT journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        'SUPPLIER_INVOICE', 'PAYMENT', 'SALE_DAY', 'STOCK_COUNT',
        'TRANSFER', 'MANUAL', 'REVERSAL', 'DEPRECIATION', 'BANK_STATEMENT',
        'ASSET_DISPOSAL', 'ASSET_TRANSFER', 'CASH_COUNT', 'DEPOSIT',
        'ASSET_CAPITALIZATION'));

COMMENT ON CONSTRAINT journal_entry_source_kind_check ON journal_entry IS
    'ASSET_CAPITALIZATION is finished work leaving Contract In Progress: cost out of 1031803* at the unit, into 10215* at the family it became. The client does this by hand today and calls it REKLAS CIP.';
