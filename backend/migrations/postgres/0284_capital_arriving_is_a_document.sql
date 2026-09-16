-- Capital arriving is a document, not somebody's hand-written journal.
--
-- 0281 gave owners an identity and four movements. It posted them as `MANUAL`,
-- and the posting kernel refused every one of them:
--
--     1011002001 Cash In Bank Giro Bank BCA may be corrected but not
--     journalled: raise an adjustment, a reclass or a write-off, and have it
--     approved.
--
-- That refusal is right. Cash and bank accounts carry `manual_je_policy =
-- 'OVERRIDE'` precisely so a person cannot move money by typing a journal, and
-- widening that policy to let capital in would open the same door to everything
-- else. The answer is the one 0266 gave for payroll, tax and amortisation: the
-- event is a document in its own right, and it gets a word of its own.
--
-- `EQUITY_MOVEMENT` covers all four: capital in, drawings out, a loan from an
-- owner, and its repayment. One kind and not four, because `principal_transaction`
-- already says which of them it was, and a source kind per direction would be
-- four words for one document.
--
-- Restated in full, for the reason 0257 had to learn twice.

ALTER TABLE journal_entry DROP CONSTRAINT IF EXISTS journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        'ACQ_SETTLEMENT', 'ADJUSTMENT', 'ADVANCE', 'AMORTIZATION_RUN',
        'ASSET_CAPITALIZATION', 'ASSET_DISPOSAL', 'ASSET_RESERVE',
        'ASSET_TRANSFER', 'BANK_STATEMENT', 'CASH_COUNT', 'CASH_DOC',
        'CASH_SHIFT', 'COGS_DAY', 'CREDIT_NOTE', 'DEPOSIT', 'DEPRECIATION',
        'EQUITY_MOVEMENT', 'GIRO', 'GOODS_RECEIPT', 'INTERUNIT_SETTLE',
        'LANDED_COST', 'MANUAL', 'OPENING', 'PAYMENT', 'PAYROLL_RUN',
        'PETTY_REPLENISH', 'PREPAID_ALLOCATION', 'RECLASS', 'REMITTANCE',
        'RETENDER', 'REVERSAL', 'SALE_DAY', 'STOCK_COUNT', 'STORE_DEPOSIT',
        'STORE_EXPENSE', 'SUPPLIER_ADVANCE', 'SUPPLIER_INVOICE',
        'TAX_SETTLEMENT', 'TRANSFER', 'WRITE_OFF'
    ));

-- The equity accounts the movements reach. They were left `MANUAL`/`OVERRIDE`
-- by the workbook, which is what an account nobody had a document for looks
-- like. Now there is one: a rule writes them, and a person still may not.
UPDATE ledger_account
   SET posting_mode = 'AUTO_ONLY', manual_je_policy = 'OVERRIDE',
       posting_policy_configured = true
 WHERE account_code IN ('3013001001', '3013001004')
   AND posting_mode = 'MANUAL';

COMMENT ON COLUMN journal_entry.source_kind IS
    'What caused this entry. EQUITY_MOVEMENT is an owner putting capital in,
     taking drawings out, lending to the company or being repaid — see 0284.';
