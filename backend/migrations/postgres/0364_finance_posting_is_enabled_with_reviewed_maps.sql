-- Finance owner decision: enable source-driven posting globally now that the
-- client chart and the reviewed Sales/Inventory/Procurement routes are ready.
-- Each writer still resolves every account and validates the balanced entry.

-- Keep the inventory event name WRITE_OFF, but give its journal a source kind
-- distinct from Finance's manually-created WRITE_OFF correction.
ALTER TABLE journal_entry DROP CONSTRAINT IF EXISTS journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        'ACQ_SETTLEMENT', 'ADJUSTMENT', 'ADVANCE', 'AMORTIZATION_RUN',
        'ASSET_CAPITALIZATION', 'ASSET_DISPOSAL', 'ASSET_RESERVE',
        'ASSET_TRANSFER', 'BANK_STATEMENT', 'CASH_COUNT', 'CASH_DOC',
        'CASH_SHIFT', 'COGS_DAY', 'CREDIT_NOTE', 'DEPRECIATION',
        'EQUITY_MOVEMENT', 'EXPENSE_CLAIM', 'EXPENSE_CLAIM_PAYOUT', 'GIRO',
        'GOODS_RECEIPT', 'INTERUNIT_SETTLE', 'INVENTORY_WRITE_OFF',
        'LANDED_COST', 'MANUAL', 'OPENING', 'PAYMENT', 'PAYROLL_RUN',
        'PETTY_REPLENISH', 'PREPAID_ALLOCATION', 'RECLASS', 'REMITTANCE',
        'RETENDER', 'REVERSAL', 'SALE_DAY', 'STOCK_COUNT', 'STORE_DEPOSIT',
        'STORE_EXPENSE', 'SUPPLIER_ADVANCE', 'SUPPLIER_INVOICE',
        'TAX_SETTLEMENT', 'TRANSFER', 'VOUCHER_ISSUE', 'WRITE_OFF',
        'FULL_AND_FINAL'
    ));

COMMENT ON COLUMN journal_entry.source_kind IS
    'What caused this entry. INVENTORY_WRITE_OFF distinguishes stock loss/disposal from a Finance WRITE_OFF correction.';

-- The selected client tree has a single debit-card clearing account and no
-- QRIS-specific leaf. QRIS and debit-card tenders use that same debit route.
-- Provider/acquirer qualifiers are preserved so reconciliation can still name
-- who owes the money. Existing historical QRIS keys remain readable.
DELETE FROM account_map WHERE semantic_key = 'supplier_suspend';

WITH unqualified(semantic_key, account_code, note) AS (
    VALUES
        ('card_fee', '6005', 'Acquirer MDR; client Biaya Credit Card'),
        ('bank_admin_fee', '6043', 'Bank charges; client Biaya Bank HO')
), unqualified_per_site AS (
    SELECT meaning.semantic_key, site.id AS site_id, ''::text AS qualifier,
           meaning.account_code, meaning.note
      FROM unqualified meaning
      CROSS JOIN site
), qualified(semantic_key, qualifier, account_code, note) AS (
    VALUES
        ('bank_giro', 'BCA', '1005', 'Cash In Bank Giro Bank BCA'),
        ('bank_giro', 'MANDIRI', '1006', 'Cash In Bank Giro Bank MANDIRI'),
        ('bank_giro', 'BRI', '1007', 'Cash In Bank Giro Bank BRI'),
        ('bank_giro', 'BNI', '1008', 'Cash In Bank Giro Bank BNI'),
        ('bank_giro', 'DANAMON', '1009', 'Cash In Bank Giro Bank DANAMON'),
        ('bank_savings', 'BCA', '1010', 'Cash In Bank Tabungan Bank BCA'),
        ('bank_savings', 'MANDIRI', '1011', 'Cash In Bank Tabungan Bank Mandiri'),
        ('bank_savings', 'BRI', '1012', 'Cash In Bank Tabungan Bank BRI'),
        ('bank_savings', 'BNI', '1013', 'Cash In Bank Tabungan Bank BNI'),
        ('bank_savings', 'BTN', '1014', 'Cash In Bank Tabungan Bank BTN')
), qualified_per_site AS (
    SELECT meaning.semantic_key, site.id AS site_id, meaning.qualifier,
           meaning.account_code, meaning.note
      FROM qualified meaning
      CROSS JOIN site
), affiliate_kind(kind, receivable_code, payable_code) AS (
    VALUES ('PEMBIAYAAN', '1057', '2028'),
           ('BARANG', '1058', '2029')
), affiliate_map AS (
    SELECT 'affiliate_receivable'::text AS semantic_key,
           owner.id AS site_id,
           kind.kind || ':' || counterparty.id AS qualifier,
           kind.receivable_code AS account_code,
           'Client affiliate receivable; named counterparty site'::text AS note
      FROM affiliate_kind kind
      CROSS JOIN site owner
      CROSS JOIN site counterparty
     WHERE owner.id <> counterparty.id
    UNION ALL
    SELECT 'affiliate_payable', owner.id,
           kind.kind || ':' || counterparty.id,
           kind.payable_code,
           'Client affiliate payable; named counterparty site'
      FROM affiliate_kind kind
      CROSS JOIN site owner
      CROSS JOIN site counterparty
     WHERE owner.id <> counterparty.id
), mappings AS (
    SELECT * FROM unqualified_per_site
    UNION ALL
    SELECT * FROM qualified_per_site
    UNION ALL
    SELECT * FROM affiliate_map
)
INSERT INTO account_map
    (semantic_key, site_id, qualifier, account_code, category_code, set_by, note)
SELECT mapping.semantic_key, mapping.site_id, mapping.qualifier,
       mapping.account_code, NULL, 'migration:0364', mapping.note
  FROM mappings mapping
ON CONFLICT (semantic_key, site_id, qualifier) DO UPDATE
    SET account_code = EXCLUDED.account_code,
        category_code = NULL,
        set_by = EXCLUDED.set_by,
        set_at = now(),
        note = EXCLUDED.note;

-- Do not leave Inventory write-offs under the broad Finance correction kind.
UPDATE finance_posting_source_policy
   SET enabled = false,
       set_by = 'migration:0364',
       set_at = now(),
       note = 'Retired for inventory events; use INVENTORY_WRITE_OFF so Finance corrections stay separately classified.'
 WHERE source_kind = 'WRITE_OFF';

INSERT INTO finance_posting_source_policy
    (source_kind, module, enabled, set_by, note)
VALUES
    ('INVENTORY_WRITE_OFF', 'INVENTORY', true, 'migration:0364', 'Inventory damage or disposal; distinct from a Finance WRITE_OFF correction.'),
    ('ACQ_SETTLEMENT', 'SALES', true, 'migration:0364', 'Curated acquirer settlement against the configured debit/credit receivable and bank account.')
ON CONFLICT (source_kind) DO UPDATE
    SET module = EXCLUDED.module,
        enabled = EXCLUDED.enabled,
        set_by = EXCLUDED.set_by,
        set_at = now(),
        note = EXCLUDED.note;

UPDATE finance_posting_control
   SET automatic_posting_enabled = true,
       changed_by = 'finance-owner-request',
       changed_at = now()
 WHERE singleton = true;

COMMENT ON TABLE finance_posting_control IS
    'Global gate for source-driven journal posting. Enabled by Finance owner decision; account resolution, source documents, period checks, and balanced-entry validation still apply.';
COMMENT ON COLUMN finance_posting_control.automatic_posting_enabled IS
    'When true, source-driven writers may post after their document flow and account-map checks succeed.';

DO $$
DECLARE
    bad_map_count bigint;
BEGIN
    SELECT count(*) INTO bad_map_count
      FROM account_map mapping
      JOIN ledger_account account USING (account_code)
     WHERE mapping.set_by = 'migration:0364'
       AND (NOT account.is_active OR account.is_group OR mapping.category_code IS NOT NULL);

    IF bad_map_count <> 0 THEN
        RAISE EXCEPTION '0364 installed % mappings that do not resolve to active leaf accounts', bad_map_count;
    END IF;

    IF NOT COALESCE((SELECT automatic_posting_enabled
                       FROM finance_posting_control
                      WHERE singleton = true), false) THEN
        RAISE EXCEPTION '0364 did not enable the global Finance posting control';
    END IF;
END;
$$;
