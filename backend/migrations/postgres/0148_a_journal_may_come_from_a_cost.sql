-- 0148: The kinds of document a journal entry may come from.
--
-- # Why the whole union and not just the three this lane needs
--
-- Several sessions are adding posting rules to this repository at the same
-- time, and each of them needs `source_kind` widened. A migration that added
-- only its own three values would drop whatever the previous one added, because
-- widening a CHECK means dropping it and writing a new one — and the new one is
-- whatever that session happened to have in front of it.
--
-- So every lane writes the SAME list: the values already in the constraint plus
-- the full union of what all the lanes are adding. Whichever migration runs last
-- leaves the same constraint behind as any other, and the order stops mattering.
--
-- # What this lane actually posts
--
--   COGS_DAY     cost of goods for a day's sales, against the sales posting
--                document. A separate kind from SALE_DAY on purpose: the sales
--                rule deliberately posts no cost, so the two entries have
--                different rules, different lines and different reasons to be
--                reposted, and one kind covering both would make "which rule
--                built this" unanswerable.
--   LANDED_COST  a supplier price correction, split between what is still on
--                hand and what has already been sold.
--   ADJUSTMENT   a stock count difference, to
--                `8010110006 Kehilangan Barang atau Selisih Stock Opname`.
--
-- The other values in the union belong to sister lanes; naming them here costs
-- nothing and is what makes the migrations commutative.

ALTER TABLE journal_entry DROP CONSTRAINT journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        -- Already in the constraint before this migration.
        'SUPPLIER_INVOICE', 'PAYMENT', 'SALE_DAY', 'STOCK_COUNT',
        'TRANSFER', 'MANUAL', 'REVERSAL', 'DEPRECIATION', 'BANK_STATEMENT',
        'ASSET_DISPOSAL', 'ASSET_TRANSFER',
        -- The union every lane in this round writes.
        'RETENDER', 'CASH_SHIFT', 'STORE_DEPOSIT', 'REMITTANCE', 'ADVANCE',
        'STORE_EXPENSE', 'PETTY_REPLENISH', 'CASH_DOC', 'GIRO',
        'INTERUNIT_SETTLE', 'RECLASS', 'ADJUSTMENT', 'WRITE_OFF',
        'ACQ_SETTLEMENT', 'GOODS_RECEIPT', 'CREDIT_NOTE', 'SUPPLIER_ADVANCE',
        'LANDED_COST', 'COGS_DAY', 'ASSET_RESERVE'));

COMMENT ON COLUMN journal_entry.source_kind IS
    'What caused this entry. COGS_DAY is the cost of a day''s sales and is deliberately a different kind from SALE_DAY, which records the revenue and posts no cost.';
