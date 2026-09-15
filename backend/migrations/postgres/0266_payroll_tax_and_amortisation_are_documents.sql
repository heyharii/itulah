-- Payroll, tax and amortisation are documents in their own right.
--
-- Three kinds, and each one closes a group of accounts the source map could not
-- reach. The workbook names 43 `Source Document` phrases across 162 accounts; 26
-- mapped onto the existing vocabulary and 17 did not, because the document they
-- describe had no word here. These are the three that can be answered without a
-- module that does not exist yet.
--
--   PAYROLL_RUN        21 accounts, the largest group in the map. `PAYMENT` is
--                      the disbursement; the expense is recognised before the
--                      money leaves, and the payroll engine (0231, 0250-0251)
--                      already computes the slips with no word for booking them.
--   TAX_SETTLEMENT     8 accounts. `PAYMENT` can pay a tax; it cannot express an
--                      obligation or a credit moving BY TAX PERIOD, which is the
--                      whole point of the subledger this prepares for.
--   AMORTIZATION_RUN   4 accounts. Kept separate from `DEPRECIATION` on purpose:
--                      pre-opening and intangible amortisation is a different
--                      economic event, and a source allow-list that cannot tell
--                      them apart cannot be read by the person maintaining it.
--
-- # What was deliberately NOT added
--
--   PAYROLL_ADJUSTMENT -> `ADJUSTMENT` already means "a correction to a figure",
--                         and `source_id` already names the run.
--   TAX_ADJUSTMENT     -> the same.
--   DEPRECIATION_RUN   -> `DEPRECIATION` is the same word.
--   TIME_DEPOSIT_*     -> a placement moves cash between our own accounts, which
--                         `TRANSFER` says. And NOT `DEPOSIT`: that already means
--                         a shop's takings banked (0241), and reusing it for a
--                         time deposit would collide with a live meaning in the
--                         hardest way to notice later.
--
-- Three in ONE migration and not three, because this constraint is DROP-and-ADD:
-- it restates the whole list, and restating it twice is how 0107 and 0242 came to
-- disagree. See 0257 for what that cost.

ALTER TABLE journal_entry DROP CONSTRAINT IF EXISTS journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        'ACQ_SETTLEMENT', 'ADJUSTMENT', 'ADVANCE', 'AMORTIZATION_RUN',
        'ASSET_CAPITALIZATION', 'ASSET_DISPOSAL', 'ASSET_RESERVE', 'ASSET_TRANSFER',
        'BANK_STATEMENT', 'CASH_COUNT', 'CASH_DOC', 'CASH_SHIFT',
        'COGS_DAY', 'CREDIT_NOTE', 'DEPOSIT', 'DEPRECIATION',
        'GIRO', 'GOODS_RECEIPT', 'INTERUNIT_SETTLE', 'LANDED_COST',
        'MANUAL', 'OPENING', 'PAYMENT', 'PAYROLL_RUN',
        'PETTY_REPLENISH', 'RECLASS', 'REMITTANCE', 'RETENDER',
        'REVERSAL', 'SALE_DAY', 'STOCK_COUNT', 'STORE_DEPOSIT',
        'STORE_EXPENSE', 'SUPPLIER_ADVANCE', 'SUPPLIER_INVOICE', 'TAX_SETTLEMENT',
        'TRANSFER', 'WRITE_OFF'
    ));

COMMENT ON COLUMN journal_entry.source_kind IS
    'What caused this entry. 38 values. Widen it in a NEW migration that restates the whole list, never by editing an applied one — see 0257.';
