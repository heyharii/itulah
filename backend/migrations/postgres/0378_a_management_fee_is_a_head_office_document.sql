-- 0378: management fee — head office charges a unit.
--
-- Owner decision, 25 Sep (brief, "Management fee: HO Dr 1059 / Cr 4016; unit
-- Dr 7032 / Cr 1059"). The maps already exist (0375: `management_fee_income`
-- → 4016, `management_fee_expense` → 7032); what is missing is a document that
-- posts them, and the `source_kind` the entry carries.

ALTER TABLE journal_entry DROP CONSTRAINT IF EXISTS journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        'ACQ_SETTLEMENT', 'ADJUSTMENT', 'ADVANCE', 'AMORTIZATION_RUN',
        'ASSET_CAPITALIZATION', 'ASSET_DISPOSAL', 'ASSET_RESERVE',
        'ASSET_TRANSFER', 'BANK_STATEMENT', 'CASH_COUNT', 'CASH_DOC',
        'CASH_SHIFT', 'COGS_DAY', 'CREDIT_NOTE', 'DEPRECIATION',
        'EQUITY_MOVEMENT', 'EXPENSE_CLAIM', 'EXPENSE_CLAIM_PAYOUT', 'GIRO',
        'GOODS_RECEIPT', 'INTERUNIT_SETTLE', 'INVENTORY_WRITE_OFF',
        'LANDED_COST', 'MANAGEMENT_FEE', 'MANUAL', 'OPENING', 'PAYMENT',
        'PAYROLL_RUN', 'PETTY_REPLENISH', 'PREPAID_ALLOCATION', 'RECLASS',
        'REMITTANCE', 'RETENDER', 'REVERSAL', 'SALE_DAY', 'STOCK_COUNT',
        'STORE_DEPOSIT', 'STORE_EXPENSE', 'SUPPLIER_ADVANCE',
        'SUPPLIER_INVOICE', 'TAX_SETTLEMENT', 'TRANSFER', 'VOUCHER_ISSUE',
        'WRITE_OFF', 'FULL_AND_FINAL', 'SALE_DAY_EXCEPTION'
    ));
