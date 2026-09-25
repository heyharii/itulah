-- 0371: every meaning a posting writer names resolves to a client leaf.
--
-- Finance Connect, stage 0 (runs/finance-connect/2026-09-25/ACCOUNT-DECISIONS.md).
-- 0351 and 0364 mapped the sales, stock and procurement routes to the 267
-- client leaves of 0348 and deliberately left every meaning without an exact
-- account unset. The audit of 25 Sep found the writers still name about
-- twenty-five of those, so payroll, claims, advances, cash shifts, deposits,
-- giro, loans, equity, tax settlements and assets refused at posting time.
--
-- This migration only writes `account_map`. No account is created (the QRIS
-- leaves arrive with stage 2), no journal is rewritten, and every row points at
-- an active, non-group leaf with `category_code` NULL: 267 leaves declare no
-- category family, so a categorised row would be refused by 0288's trigger.
--
-- Where the client has no exact account the nearest leaf is chosen and the
-- decision is marked RENDAH in ACCOUNT-DECISIONS for owner review, so that a
-- posting lands instead of being refused.

-- ── 1. meanings that are the same account at every site ─────────────────────
WITH unqualified(semantic_key, account_code, note) AS (
    VALUES
        ('petty_cash',             '1003', 'PETTY CASH'),
        ('cashier_float',          '1004', 'MODAL KASIR (owner decision 9)'),
        ('cash_in_transit',        '1002', 'RENDAH: no Kas dalam perjalanan leaf; setoran stays in Cash on Hand until banked'),
        ('cash_variance',          '8008', 'Kelebihan kas -> Pendapatan (Biaya) Lain-Lain (owner decision 9)'),
        ('store_manager_receivable','1023', 'PIUTANG KEPALA TOKO'),
        ('employee_receivable',    '1022', 'PIUTANG PEGAWAI'),
        ('management_receivable',  '1024', 'PIUTANG MANAJEMEN'),
        ('employee_claim_payable', '2031', 'SEDANG: no klaim YMHD leaf; Hutang Lain - Lain'),
        ('advance_purchase',       '1052', 'Advanced - Purchase'),
        ('capital_contributed',    '3002', 'Modal Setor'),
        ('owner_drawings',         '3004', 'Prive'),
        ('retained_earnings',      '3003', 'Laba (Rugi) Ditahan'),
        ('pph21_payable',          '2011', 'Hutang Pajak PPH Pasal 21'),
        ('pph23_payable',          '2012', 'Hutang Pajak PPH Pasal 23 (withold)'),
        ('pph25_payable',          '2015', 'Hutang Pajak PPH Pasal 25'),
        ('pph29_payable',          '2015', 'RENDAH: no PPh 29 payable leaf; Hutang PPh 25'),
        ('pph_final_payable',      '2012', 'Owner decision: PPh 4(2) has no leaf; Hutang PPh 23, told apart by the withholding key on the payment'),
        ('pbb_payable',            '2014', 'Hutang Pajak Bumi & Bangunan'),
        ('pph21_credit',           '1045', 'Prepaid - PPh Pasal 21'),
        ('pph25_credit',           '1046', 'Prepaid - PPh Pasal 25'),
        ('pph29_credit',           '1047', 'Prepaid - PPh Pasal 29'),
        ('interest_income',        '8002', 'Pendapatan Bunga Bank'),
        ('tax_on_interest',        '8015', 'RENDAH: client catalogue points it at Current Tax PPh 25'),
        ('interest_payable',       '2019', 'Biaya Bunga Pinjaman YMHD'),
        ('bad_debt_expense',       '6051', 'Biaya Penyisihan Kerugian Piutang'),
        ('other_income_expense',   '8008', 'Pendapatan (Biaya) Lain-Lain'),
        ('other_expense',          '8008', 'Pendapatan (Biaya) Lain-Lain; signed result'),
        ('asset_disposal_result',  '8008', 'Laba pelepasan aset -> Pendapatan (Biaya) Lain-Lain'),
        ('asset_disposal_loss',    '8008', 'Rugi pelepasan aset -> Pendapatan (Biaya) Lain-Lain'),
        ('customer_supplies',      '6004', 'Biaya Customer Supplies (kantong belanja)'),
        ('bag_inventory',          '1030', 'Persediaan Kantong Belanja'),
        ('inventory_damage',       '6011', 'Biaya Kerusakan Persediaan Barang Dagangan'),
        ('expense_electricity',    '6045', 'Biaya Pemakaian Listrik'),
        ('expense_water',          '6046', 'Biaya Pemakaian Air Bersih (PDAM)'),
        ('expense_telephone',      '6044', 'Biaya Telephone, Facsimile, Modem'),
        ('expense_household',      '6042', 'Biaya Rumah Tangga'),
        ('expense_stationery',     '6041', 'Alat Tulis Kantor & Barang Cetakan'),
        ('expense_repairs',        '6069', 'Biaya Perbaikan dan Perawatan Bangunan'),
        ('expense_transport',      '6048', 'Biaya Lokal Transport'),
        ('expense_cleaning',       '6040', 'Biaya Kebersihan (Cleaning)'),
        ('expense_misc',           '6064', 'Miscellaneous Expences'),
        ('prepaid_expense',        '1044', 'Biaya Bayar Dimuka Lain Lain; unnamed prepaid kind'),
        ('interest_expense',       '8011', 'Biaya Bunga Pinjaman Bank'),
        ('loan_principal',         '2043', 'SEDANG: unnamed lender -> Pinjaman Jangka Panjang Principal'),
        ('loan_current_portion',   '2035', 'SEDANG: unnamed lender -> PJP Jatuh Tempo Principal'),
        ('goods_in_transit',       '1031', 'BDP Barang Dagangan'),
        ('work_in_progress',       '1113', 'Contract In Progress (CIP)'),
        ('advance',                '1051', 'SEDANG: unnamed purpose is an employee/dinas advance -> Advanced - Travelling')
),
-- ── 2. meanings narrowed by a qualifier, the same at every site ────────────
qualified(semantic_key, qualifier, account_code, note) AS (
    VALUES
        ('advance', 'PERJALANAN',  '1051', 'Advanced - Travelling'),
        ('advance', 'TRAVEL',      '1051', 'Advanced - Travelling'),
        ('advance', 'PURCHASE',    '1052', 'Advanced - Purchase'),
        ('advance', 'CONTRACTORS', '1053', 'Advanced - To Contractors'),
        ('advance', 'CONTRACTOR',  '1053', 'Advanced - To Contractors'),
        ('advance', 'OTHERS',      '1054', 'Advanced - Others'),
        ('time_deposit', 'BCA',     '1015', 'TIME DEPOSIT BANK BCA'),
        ('time_deposit', 'MANDIRI', '1016', 'TIME DEPOSIT BANK MANDIRI'),
        ('time_deposit', 'BRI',     '1017', 'TIME DEPOSIT BANK BRI'),
        ('time_deposit', 'BNI',     '1018', 'TIME DEPOSIT BANK BNI'),
        ('giro_outstanding', 'BCA',     '2005', 'Outstanding Giro Bank BCA'),
        ('giro_outstanding', 'MANDIRI', '2006', 'Outstanding Giro Bank Mandiri'),
        ('giro_outstanding', 'BRI',     '2007', 'Outstanding Giro Bank BRI'),
        ('giro_outstanding', 'BNI',     '2008', 'Outstanding Giro Bank BNI'),
        ('giro_outstanding', 'DANAMON', '2009', 'Outstanding Giro Bank DANAMON'),
        ('loan_principal', 'PRINCIPAL', '2043', 'Pinjaman Jangka Panjang Principal'),
        ('loan_principal', 'BCA',       '2044', 'Pinjaman Jangka Panjang Bank BCA'),
        ('loan_principal', 'MANDIRI',   '2045', 'Pinjaman Jangka Panjang Bank Mandiri'),
        ('loan_principal', 'BRI',       '2046', 'Pinjaman Jangka Panjang Bank BRI'),
        ('loan_principal', 'BNI',       '2047', 'Pinjaman Jangka Panjang Bank BNI'),
        ('loan_principal', 'DANAMON',   '2048', 'Pinjaman Jangka Panjang Bank Danamon'),
        ('loan_current_portion', 'PRINCIPAL', '2035', 'PJP Jatuh Tempo - Principal'),
        ('loan_current_portion', 'BCA',       '2036', 'PJP Jatuh Tempo Bank BCA'),
        ('loan_current_portion', 'MANDIRI',   '2037', 'PJP Jatuh Tempo Bank Mandiri'),
        ('loan_current_portion', 'BRI',       '2038', 'PJP Jatuh Tempo Bank BRI'),
        ('loan_current_portion', 'BNI',       '2039', 'PJP Jatuh Tempo Bank BNI'),
        ('loan_current_portion', 'DANAMON',   '2040', 'PJP Jatuh Tempo Bank Danamon'),
        ('interest_expense', 'LEASING', '8012', 'Biaya Bunga Leasing'),
        ('interest_expense', 'BANK',    '8011', 'Biaya Bunga Pinjaman Bank'),
        ('prepaid_expense', 'PROMOSI', '1042', 'Biaya Promosi Bayar Dimuka'),
        ('prepaid_expense', 'SEWA_KENDARAAN', '1041', 'Sewa Kendaraan Bayar Dimuka'),
        ('goods_in_transit', 'MERCHANDISE', '1031', 'BDP Barang Dagangan'),
        ('goods_in_transit', 'BAG',         '1032', 'BDP Kantong Belanja'),
        -- The acquirer settlement books a fee or dispute difference qualified
        -- by acquirer (acquirer.rs). One client account each, whatever bank.
        ('card_fee', 'BCA',        '6005', 'Biaya Credit Card'),
        ('card_fee', 'MANDIRI',    '6005', 'Biaya Credit Card'),
        ('card_fee', 'BRI',        '6005', 'Biaya Credit Card'),
        ('card_fee', 'BNI',        '6005', 'Biaya Credit Card'),
        ('card_fee', 'VISA',       '6005', 'Biaya Credit Card'),
        ('card_fee', 'MASTER',     '6005', 'Biaya Credit Card'),
        ('card_fee', 'MASTERCARD', '6005', 'Biaya Credit Card'),
        ('sales_return', 'BCA',        '4013', 'Retur Penjualan'),
        ('sales_return', 'MANDIRI',    '4013', 'Retur Penjualan'),
        ('sales_return', 'BRI',        '4013', 'Retur Penjualan'),
        ('sales_return', 'BNI',        '4013', 'Retur Penjualan'),
        ('sales_return', 'VISA',       '4013', 'Retur Penjualan'),
        ('sales_return', 'MASTER',     '4013', 'Retur Penjualan'),
        ('sales_return', 'MASTERCARD', '4013', 'Retur Penjualan')
),
-- ── 3. meanings whose account depends on the KIND of site ──────────────────
-- Store staff are selling expense (6012–6024); head office and DC staff are
-- employee expense (6026–6038). The same split for medical claims and the
-- shortage a cash shift leaves.
by_kind(semantic_key, qualifier, store_code, ho_code, note) AS (
    VALUES
        ('payroll_expense', '',          '6012', '6026', 'Gaji; an unclassified component is salary'),
        ('payroll_expense', 'SALARY',    '6012', '6026', 'Biaya Gaji Karyawan / Pegawai'),
        ('payroll_expense', 'ALLOWANCE', '6012', '6026', 'SEDANG: tunjangan tetap ikut gaji'),
        ('payroll_expense', 'OVERTIME',  '6013', '6027', 'Biaya Lembur'),
        ('payroll_expense', 'MEAL',      '6014', '6028', 'Uang Makan'),
        ('payroll_expense', 'TRANSPORT', '6015', '6029', 'Uang Transport'),
        ('payroll_expense', 'MEDICAL',   '6016', '6030', 'Biaya Kesehatan & Pengobatan'),
        ('payroll_expense', 'BPJS',      '6017', '6031', 'Biaya Asuransi Pegawai / BPJS (iuran perusahaan)'),
        ('payroll_expense', 'THR',       '6018', '6032', 'Tunjangan Hari Raya'),
        ('payroll_expense', 'UNIFORM',   '6019', '6033', 'Biaya Uniform / Seragam Kerja'),
        ('payroll_expense', 'SEVERANCE', '6023', '6037', 'Biaya Pesangon'),
        ('payroll_expense', 'BONUS',     '6024', '6038', 'Komisi / Bonus / Insentif'),
        ('cash_shortage',   '',          '1023', '1022', 'Kurang kas -> piutang kepala toko (decision 9); HO -> piutang pegawai')
),
per_site AS (
    SELECT meaning.semantic_key, site.id AS site_id, ''::text AS qualifier,
           meaning.account_code, meaning.note
      FROM unqualified meaning CROSS JOIN site
    UNION ALL
    SELECT meaning.semantic_key, site.id, meaning.qualifier,
           meaning.account_code, meaning.note
      FROM qualified meaning CROSS JOIN site
    UNION ALL
    SELECT meaning.semantic_key, site.id, meaning.qualifier,
           CASE WHEN site.kind = 'STORE' THEN meaning.store_code ELSE meaning.ho_code END,
           meaning.note
      FROM by_kind meaning CROSS JOIN site
    -- Payroll deductions settle into these (stage 3): BPJS withheld from the
    -- employee and the company share are one accrued liability, since the
    -- client keeps no Hutang BPJS leaf.
    UNION ALL
    SELECT 'bpjs_payable', site.id, '', '2021', 'SEDANG: Biaya Asuransi dan BPJS YMHD'
      FROM site
    -- Inter-unit LAIN-LAIN (neither money nor goods). The client keeps only
    -- 1059 Piutang Affiliasi Lain-lain and will add no payable (owner decision
    -- 25 Sep), so 1059 is used two-way on both sides: a credit balance at a
    -- unit is what it owes head office.
    UNION ALL
    SELECT 'affiliate_receivable', owner.id, 'LAIN:' || counterparty.id, '1059',
           'Piutang Affiliasi Lain-lain; named counterparty site'
      FROM site owner CROSS JOIN site counterparty WHERE owner.id <> counterparty.id
    UNION ALL
    SELECT 'affiliate_payable', owner.id, 'LAIN:' || counterparty.id, '1059',
           'Piutang Affiliasi Lain-lain used two-way: no payable leaf (owner decision)'
      FROM site owner CROSS JOIN site counterparty WHERE owner.id <> counterparty.id
),
-- ── 4. amortisation: the intangible and deferred classes ───────────────────
asset_classes(class_code, cost_code, contra_code, expense_code) AS (
    VALUES
        ('SEVENTH_SOFT_APPLICATION', '1104', '1106', '7025'),
        ('OPTI_TEX_SYSTEM',          '1105', '1107', '7027'),
        ('PRE_OPENING',              '1111', '1112', '7026')
),
amortisation AS (
    SELECT 'intangible_asset'::text AS semantic_key, site.id AS site_id,
           class.class_code AS qualifier, class.cost_code AS account_code,
           'Intangible / deferred cost by class'::text AS note
      FROM asset_classes class CROSS JOIN site
    UNION ALL
    SELECT 'accumulated_amortisation', site.id, class.class_code, class.contra_code,
           'Accumulated amortisation by class'
      FROM asset_classes class CROSS JOIN site
    UNION ALL
    SELECT 'amortisation_expense', site.id, class.class_code, class.expense_code,
           'Amortisation expense by class'
      FROM asset_classes class CROSS JOIN site
    -- Capitalising from CIP credits `work_in_progress` under the class the
    -- asset was filed under while it was being built.
    UNION ALL
    SELECT 'work_in_progress', site.id, ac.class_code, '1113',
           'Contract In Progress (CIP), whatever class it becomes'
      FROM asset_class ac CROSS JOIN site
),
mappings AS (
    SELECT * FROM per_site
    UNION ALL
    SELECT * FROM amortisation
)
INSERT INTO account_map
    (semantic_key, site_id, qualifier, account_code, category_code, set_by, note)
SELECT mapping.semantic_key, mapping.site_id, mapping.qualifier,
       mapping.account_code, NULL, 'migration:0371', mapping.note
  FROM mappings mapping
ON CONFLICT (semantic_key, site_id, qualifier) DO UPDATE
    SET account_code = EXCLUDED.account_code,
        category_code = NULL,
        set_by = EXCLUDED.set_by,
        set_at = now(),
        note = EXCLUDED.note;

-- ── 5. expense-claim types already defined ─────────────────────────────────
-- `define_claim_type` minted rows at the retired `6010210014`. Re-point every
-- existing type by what its code says; claims.rs uses the same rule for new
-- types from now on.
UPDATE account_map mapping
   SET account_code = CASE
           WHEN mapping.qualifier ~* '(MEDIS|MEDIC|KESEHATAN|PENGOBATAN|OBAT|DOKTER)'
               THEN CASE WHEN site.kind = 'STORE' THEN '6016' ELSE '6030' END
           WHEN mapping.qualifier ~* '(DINAS|PERJALANAN|TRAVEL|HOTEL|TIKET)' THEN '6047'
           WHEN mapping.qualifier ~* '(TRANSPORT|BENSIN|BBM|TOL|PARKIR|OJEK)' THEN '6048'
           WHEN mapping.qualifier ~* '(ATK|ALAT_TULIS|STATIONERY)' THEN '6041'
           WHEN mapping.qualifier ~* '(PULSA|TELEPON|TELEPHONE|INTERNET)' THEN '6044'
           WHEN mapping.qualifier ~* '(MAKAN|MEAL|KONSUMSI)'
               THEN CASE WHEN site.kind = 'STORE' THEN '6014' ELSE '6028' END
           ELSE '6064'
       END,
       category_code = NULL,
       set_by = 'migration:0371',
       set_at = now(),
       note = 'Expense claim type re-pointed from the retired claim leaf by what its code names'
  FROM site
 WHERE site.id = mapping.site_id
   AND mapping.semantic_key = 'employee_expense';

-- ── 6. the bank-statement catalogue's own meanings ─────────────────────────
-- `transaction_category` (0303) names a client account for each category a
-- bank line can be given. Where the meaning has no row yet at a site, bind it
-- to the 267 leaf that client account was folded into by 0348. Bank-held
-- money, tender, affiliate and per-class asset meanings are excluded: those
-- are always qualified and were bound explicitly above or in 0351/0364.
INSERT INTO account_map
    (semantic_key, site_id, qualifier, account_code, category_code, set_by, note)
SELECT DISTINCT ON (category.semantic_key, site.id, category.qualifier)
       category.semantic_key, site.id, COALESCE(category.qualifier, ''),
       source.account_code, NULL, 'migration:0371',
       'From the bank-statement catalogue: ' || category.expects_account_name
  FROM transaction_category category
  JOIN ledger_account_source_code source
    ON left(source.client_account_code, 10) = category.expects_account_code
  JOIN ledger_account account
    ON account.account_code = source.account_code
   AND account.is_active AND NOT account.is_group
 CROSS JOIN site
 WHERE category.active
   AND category.semantic_key NOT IN (
       'bank_giro', 'bank_savings', 'time_deposit', 'giro_outstanding',
       'card_receivable_credit', 'card_receivable_debit', 'card_fee',
       'affiliate_receivable', 'affiliate_payable',
       'accumulated_depreciation', 'depreciation_expense',
       'sales_debit_card', 'sales_credit_card', 'sales_online', 'loan_principal')
 ORDER BY category.semantic_key, site.id, category.qualifier, source.account_code
ON CONFLICT (semantic_key, site_id, qualifier) DO NOTHING;

-- ── 7. guards ──────────────────────────────────────────────────────────────
DO $$
DECLARE
    bad bigint;
BEGIN
    SELECT count(*) INTO bad
      FROM account_map mapping
      JOIN ledger_account account USING (account_code)
     WHERE mapping.set_by = 'migration:0371'
       AND (NOT account.is_active OR account.is_group OR mapping.category_code IS NOT NULL);
    IF bad <> 0 THEN
        RAISE EXCEPTION '0371 installed % mappings that do not resolve to active leaf accounts', bad;
    END IF;

    -- The meanings the writers name unqualified must now resolve at every site.
    SELECT count(*) INTO bad
      FROM (VALUES ('payroll_expense'), ('payroll_payable'), ('employee_claim_payable'),
                   ('advance'), ('advance_purchase'), ('store_manager_receivable'),
                   ('petty_cash'), ('cashier_float'), ('cash_in_transit'),
                   ('cash_variance'), ('cash_shortage'), ('capital_contributed'),
                   ('owner_drawings'), ('pph21_payable'), ('pph23_payable'),
                   ('pph25_credit'), ('pph29_payable'), ('pph_final_payable'),
                   ('pbb_payable'), ('interest_expense'), ('interest_income'),
                   ('tax_on_interest'), ('bad_debt_expense'), ('other_income_expense'),
                   ('asset_disposal_result'), ('asset_disposal_loss'),
                   ('expense_electricity'), ('expense_water'), ('expense_telephone'),
                   ('expense_household'), ('expense_stationery'), ('expense_repairs'),
                   ('expense_transport'), ('expense_cleaning'), ('expense_misc'),
                   ('loan_principal'), ('work_in_progress')) needed(semantic_key)
     CROSS JOIN site
     WHERE NOT EXISTS (
         SELECT 1 FROM account_map mapping
          WHERE mapping.semantic_key = needed.semantic_key
            AND mapping.site_id = site.id AND mapping.qualifier = '');
    IF bad <> 0 THEN
        RAISE EXCEPTION '0371 left % (meaning, site) pairs a writer names without an account', bad;
    END IF;
END;
$$;
