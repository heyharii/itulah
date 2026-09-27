-- Point the operational posting meanings at the active four-digit client chart.
-- No journal entries are rewritten here: this only changes future account
-- resolution. The global automatic-posting switch deliberately remains off.

-- The output VAT line is company-scoped by the sales-day rule and resolves at
-- head office. Remove the old store-only row before installing that binding.
DELETE FROM account_map
 WHERE semantic_key = 'vat_out'
   AND site_id <> 'dc';

-- These are exact client-account matches for the posting flows that can be
-- routed safely today. Meanings that lack an exact account (QRIS, other tender,
-- cash in transit, employee claim payable, and goods in transit) are not
-- guessed into a nearby account.
WITH unqualified(semantic_key, account_code, note) AS (
    VALUES
        ('cash', '1002', 'Cash on hand'),
        ('revenue_cash', '4002', 'Cash sales; voucher redemption uses the same sales account'),
        ('sales_discount', '4012', 'Discount / Potongan Penjualan'),
        ('sales_return', '4013', 'Retur Penjualan'),
        ('rounding', '8003', 'Selisih pembulatan; signed result'),
        ('rounding_loss', '8003', 'Selisih pembulatan; signed result'),
        ('voucher_liability', '2033', 'Uang Muka - Penjualan'),
        ('marketing_expense', '6006', 'Biaya Promosi'),
        ('advertising_expense', '6008', 'Biaya Advertising / Iklan'),
        ('inventory', '1029', 'Persediaan Barang Dagangan'),
        ('trade_payable', '2002', 'Hutang Suppliers Barang Dagangan'),
        ('supplier_suspend', '2003', 'Hutang Supplier Barang Dagang - Suspend'),
        ('non_merchandise_payable', '2004', 'Hutang Supplier Non Barang Dagang'),
        ('vat_in', '1048', 'Prepaid - VAT (PPN Masukan)'),
        ('purchase_discount', '8004', 'Potongan Pembelian'),
        ('purchase_price_variance', '8004', 'Potongan Pembelian; client uses the same signed leaf'),
        ('cogs', '5002', 'Harga Pokok Pembelian; client HPP leaf'),
        ('stock_loss', '8007', 'Kehilangan Barang atau Selisih Stock Opname'),
        ('payroll_payable', '2017', 'Biaya Gaji dan Upah YMHD')
), per_site AS (
    SELECT meaning.semantic_key, site.id AS site_id, ''::text AS qualifier,
           meaning.account_code, meaning.note
      FROM unqualified meaning
      CROSS JOIN site
    UNION ALL
    SELECT 'vat_out', 'dc', ''::text, '2013', 'Hutang VAT PPN Keluaran'
), qualified(semantic_key, qualifier, account_code, note) AS (
    VALUES
        ('card_receivable_debit', 'BCA', '1021', 'Piutang Debit Card'),
        ('card_receivable_debit', 'MANDIRI', '1021', 'Piutang Debit Card'),
        ('card_receivable_debit', 'BRI', '1021', 'Piutang Debit Card'),
        ('card_receivable_debit', 'BNI', '1021', 'Piutang Debit Card'),
        ('revenue_debit', 'BCA', '4003', 'Penjualan Debit Card Bank BCA'),
        ('revenue_debit', 'MANDIRI', '4004', 'Penjualan Debit Card Bank Mandiri'),
        ('revenue_debit', 'BRI', '4005', 'Penjualan Debit Card Bank BRI'),
        ('revenue_debit', 'BNI', '4006', 'Penjualan Debit Card Bank BNI'),
        ('card_receivable_credit', 'VISA', '1020', 'Piutang kartu Kredit'),
        ('card_receivable_credit', 'MASTER', '1020', 'Piutang kartu Kredit'),
        ('card_receivable_credit', 'MASTERCARD', '1020', 'Piutang kartu Kredit'),
        ('revenue_credit', 'VISA', '4007', 'Penjualan Kartu Kredit VISA Card'),
        ('revenue_credit', 'MASTER', '4008', 'Penjualan Kartu Kredit Master Card'),
        ('revenue_credit', 'MASTERCARD', '4008', 'Penjualan Kartu Kredit Master Card')
), qualified_per_site AS (
    SELECT meaning.semantic_key, site.id AS site_id, meaning.qualifier,
           meaning.account_code, meaning.note
      FROM qualified meaning
      CROSS JOIN site
), mappings AS (
    SELECT * FROM per_site
    UNION ALL
    SELECT * FROM qualified_per_site
)
INSERT INTO account_map
    (semantic_key, site_id, qualifier, account_code, category_code, set_by, note)
SELECT mapping.semantic_key, mapping.site_id, mapping.qualifier,
       mapping.account_code, NULL, 'migration:0351', mapping.note
  FROM mappings mapping
ON CONFLICT (semantic_key, site_id, qualifier) DO UPDATE
    SET account_code = EXCLUDED.account_code,
        category_code = NULL,
        set_by = EXCLUDED.set_by,
        set_at = now(),
        note = EXCLUDED.note;

-- Do not leave visible-but-retired mappings in the map. They satisfy a simple
-- "is there a row?" check while every real posting correctly refuses them.
-- Keeping unsupported meanings absent makes the missing-account status honest.
DELETE FROM account_map mapping
 USING ledger_account account
 WHERE account.account_code = mapping.account_code
   AND NOT account.is_active;

DO $$
DECLARE
    invalid_count bigint;
BEGIN
    SELECT count(*) INTO invalid_count
      FROM account_map mapping
      JOIN ledger_account account USING (account_code)
     WHERE mapping.set_by = 'migration:0351'
       AND (NOT account.is_active OR account.is_group OR mapping.category_code IS NOT NULL);

    IF invalid_count <> 0 THEN
        RAISE EXCEPTION '0351 installed % mappings that do not resolve to active leaf accounts', invalid_count;
    END IF;

    IF EXISTS (
        SELECT 1 FROM finance_posting_control
         WHERE singleton = true AND automatic_posting_enabled
    ) THEN
        RAISE EXCEPTION '0351 expected automatic posting to remain paused during account-map review';
    END IF;
END;
$$;
