-- The map moves; the postings do not.
--
-- 0289 put the forty accounts in the chart. This migration points everything
-- that *chooses* an account at them, writes down what became what, and shuts
-- the hundred and ninety.
--
-- # What is deliberately not touched
--
-- `journal_line`. Not one row. It is append-only and guarded by
-- `protect_journal()`, and that guard is not an obstacle here, it is the
-- reason: a posting says where money went on the day it went there, and a
-- migration that rewrites which account a 2026 entry hit is a migration that
-- rewrites history. So the old accounts stay in the chart, inactive, still
-- carrying their postings and still summing into a balance. What ends is their
-- future, not their past.
--
-- That is also why `ledger_account_remap` matters more than it looks. It is the
-- only record of which of the forty a retired code became, and it is what
-- `legacy_code()` (0292) reads to print an accountant's own numbers back to
-- them.
--
-- # The map, and the two rows where the qualifier holds the answer
--
-- `account_map` is remapped mechanically from `ledger_account_remap` — except
-- for two accounts, and the exception is the interesting part.
--
-- `1011101001 Piutang Kartu Kredit` and `1011101002 Piutang Debit Card` each
-- stood for several things at once. Which card scheme, which bank: that was
-- never in the account code, it was in the map QUALIFIER, which is why these
-- two are the only client accounts that carry more than one of the new
-- categories. So their rows take the category the qualifier names, and a
-- qualifier nobody has named yet stops the migration rather than guessing.
--
-- Everything else in the map is one-for-one: one retired account, one new
-- account, and the category the retired account stood for — or no category at
-- all, when what it stood for is a bank account, an asset, a supplier, a
-- facility or an owner, and the row that says so already exists elsewhere.
--
-- Fourteen of these rows belong to the migrations (0277 mapped `cash_in_transit`
-- at every site); the rest are written by `seed-finance.py`. The UPDATE below
-- covers both, because a database that has been seeded must not be left with a
-- map pointing at accounts that no longer take postings.

-- # The two that become no account at all
--
-- `3013001003 Laba (Rugi) bulan berjalan` is not migrated to anything, because
-- the current year's result is not a thing you post — it is what the profit and
-- loss adds up to. The client's chart keeps an account for it at every one of
-- the fourteen units, and carrying that forward is how a migration ends up
-- counting this year's profit twice: once in the accounts that produced it and
-- once in the balance it was copied into. It is derived from here on.
--
-- `1031801001 Disposed Inventory` is not migrated either. It has not moved in
-- the two years of general ledger the client sent, and in the model the asset
-- register and the inventory ledger actually implement there is nothing for it
-- to mean: stock written off is a loss (`5102`), an asset sold is a disposal
-- result (`4301`). An outside review of the same chart reached the same place
-- from the other direction and left it unresolved, asking whether the balance
-- is inventory, a disposal loss or disposed fixed assets. Nobody can answer
-- that from a chart of accounts. If a balance turns up at cutover it gets
-- classified then, by whoever knows what it is.
--
-- Both are shut below with everything else; neither gets a row in
-- `ledger_account_remap`, because that table answers "what did this become",
-- and the honest answer for these two is "nothing".

INSERT INTO ledger_account_remap (legacy_code, new_code, category_code, note) VALUES
    ('1011001001', '1101', 'DRAWER', 'CASH ON HAND'),
    ('1011001002', '1101', 'PETTY', 'PETTY CASH'),
    ('1011001003', '1101', 'FLOAT', 'Modal Kasir'),
    ('1011002001', '1102', NULL, 'Cash In Bank Giro Bank BCA'),
    ('1011002002', '1102', NULL, 'Cash In Bank Giro Bank MANDIRI'),
    ('1011002003', '1102', NULL, 'Cash In Bank Giro Bank BRI'),
    ('1011002004', '1102', NULL, 'Cash In Bank Giro Bank BNI'),
    ('1011002005', '1102', NULL, 'Cash In Bank Giro Bank DANAMON'),
    ('1011003001', '1102', NULL, 'Cash In Bank Tabungan Bank BCA'),
    ('1011003002', '1102', NULL, 'Cash In Bank Tabungan Bank Mandiri'),
    ('1011003003', '1102', NULL, 'Cash In Bank Tabungan Bank BRI'),
    ('1011003004', '1102', NULL, 'Cash In Bank Tabungan Bank BNI'),
    ('1011003005', '1102', NULL, 'Cash In Bank Tabungan Bank BTN'),
    ('1011004001', '1102', NULL, 'TIME DEPOSIT BANK BCA'),
    ('1011004002', '1102', NULL, 'TIME DEPOSIT BANK MANDIRI'),
    ('1011004003', '1102', NULL, 'TIME DEPOSIT BANK BRI'),
    ('1011004004', '1102', NULL, 'TIME DEPOSIT BANK BNI'),
    ('1011005001', '1101', 'TRANSIT', 'Setoran Dalam Perjalanan'),
    ('1011101001', '1201', NULL, 'Piutang Kartu Kredit'),
    ('1011101002', '1201', NULL, 'Piutang Debit Card'),
    ('1011101003', '1201', 'QRIS', 'Piutang QRIS'),
    ('1011102001', '1202', 'EMPLOYEE', 'PIUTANG PEGAWAI'),
    ('1011102002', '1202', 'STORE_MANAGER', 'Piutang Kepala Toko'),
    ('1011102003', '1202', 'MANAGEMENT', 'Piutang Manajemen'),
    ('1011103001', '1209', 'CARD_CREDIT', 'Cadangan, Penghapusan Piutang Tak Tertagih, Piutang Kartu Kredit'),
    ('1011201001', '1301', 'MERCHANDISE', 'Persediaan Barang Dagangan'),
    ('1011202001', '1301', 'SUPPLIES', 'Kantong Belanja  Plastik Ukuran KECIL'),
    ('1011203001', '1302', 'MERCHANDISE', 'Barang Dalam Perjalanan Barang Dagangan HEAD OFFICE'),
    ('1011204001', '1302', 'SUPPLIES', 'Barang Dalam Perjalanan Kantong Belanja HEAD OFFICE'),
    ('1011299001', '1309', 'MERCHANDISE', 'Cadangan Kerusakan atau kehilangan Barang - Barang Dagangan'),
    ('1011301001', '1401', 'ASURANSI_BAYAR_DIMUKA', 'Asuransi Bayar Dimuka'),
    ('1011301002', '1401', 'SEWA_TANAH_BAYAR_DIMUKA', 'Sewa Tanah Bayar Dimuka'),
    ('1011301005', '1401', 'KONTRAK_MAINTENANCE_BAYAR_DIMUKA', 'Kontrak Maintenance Bayar Dimuka'),
    ('1011301007', '1401', 'BIAYA_PROMOSI_BAYAR_DIMUKA', 'Biaya Promosi Bayar Dimuka'),
    ('1011301008', '1401', 'BIAYA_IJIN_USAHA_BAYAR_DIMUKA', 'Biaya Ijin Usaha Bayar Dimuka'),
    ('1011301009', '1401', 'BIAYA_BAYAR_DIMUKA_LAIN_LAIN', 'Biaya Bayar Dimuka Lain Lain'),
    ('1011302001', '1402', 'PPH21', 'Prepaid - PPh Pasal 21'),
    ('1011302002', '1402', 'PPH25', 'Prepaid - PPh Pasal 25'),
    ('1011302003', '1402', 'PPH29', 'Prepaid - PPh Pasal 29'),
    ('1011302004', '1402', 'PPN_IN', 'Prepaid - VAT (PPN Masukan)'),
    ('1011302005', '1402', 'PBB', 'Prepaid - Land Tax (PBB)'),
    ('1011302006', '1402', 'TAX_OTHER', 'Prepaid - Other Tax'),
    ('1011303001', '1403', 'ADVANCED_TRAVELLING', 'Advanced - Travelling'),
    ('1011303002', '1403', 'ADVANCED_PURCHASE', 'Advanced  - Purchase'),
    ('1011303003', '1403', 'ADVANCED_TO_CONTRACTORS', 'Advanced  - To Contractors'),
    ('1011303004', '1403', 'ADVANCED_OTHERS', 'Advanced  - Others'),
    ('1021401001', '1501', 'FINANCING', 'Piutang Affiliasi Pembiayaan HEAD OFFICE'),
    ('1021402001', '1501', 'GOODS', 'Piutang Affiliasi Atas Barang HEAD OFFICE'),
    ('1021403001', '1501', 'INTERUNIT_OTHER', 'Piutang Affiliasi Lain-lain HEAD OFFICE'),
    ('1021501001', '1601', NULL, 'Tanah Hak Milik'),
    ('1021501002', '1601', NULL, 'Hak Sewa Tanah / HGB'),
    ('1021502001', '1601', NULL, 'Bangunan Utama'),
    ('1021503001', '1601', NULL, 'Instalasi Mekanikal & Elektrikal'),
    ('1021504001', '1601', NULL, 'Air Conditioner'),
    ('1021505001', '1601', NULL, 'Mobil'),
    ('1021506001', '1601', NULL, 'Furniture, Fixture & Equipment Office'),
    ('1021507001', '1601', NULL, 'Operating Equipment - Rak 1'),
    ('1021601002', '1609', NULL, 'Akumulasi Penyusutan - Hak  Pengelolaan Tanah (Land Right) / HGB'),
    ('1021602001', '1609', NULL, 'Akumulasi Penyusutan - Bangunan Utama'),
    ('1021603001', '1609', NULL, 'Akumulasi - Penyusutan - Instalasi - Mekanikal  Electrical'),
    ('1021604001', '1609', NULL, 'Akumulasi-Penyusutan Mesin - Air Conditioner'),
    ('1021605001', '1609', NULL, 'Akumulasi Penyusutan - Mobil'),
    ('1021606001', '1609', NULL, 'Akumulasi Penyusutan - Furniture, Fixture & Equipment Office'),
    ('1021607001', '1610', NULL, 'Reserve Replacement Operating Equipment- Rak 1'),
    ('1021701001', '1602', NULL, 'Seventh Soft Application'),
    ('1021702001', '1619', NULL, 'Akumulasi Amortisasi Seventh Soft Application'),
    ('1031802001', '1602', NULL, 'Pre Opening'),
    ('1031802002', '1619', NULL, 'Akumulasi Amortisasi Pre Opening'),
    ('1031803001', '1601', NULL, 'Contract In Progress (CIP)'),
    ('2012001001', '2101', NULL, 'Hutang Suppliers  Barang Dagangan'),
    ('2012001002', '2102', NULL, 'Hutang Supplier Barang Dagang - Suspend'),
    ('2012001003', '2101', NULL, 'Hutang Supplier  Non Barang Dagang'),
    ('2012002001', '2103', NULL, 'Outstanding Giro Bank BCA'),
    ('2012101001', '2201', 'PPH21', 'Hutang Pajak PPH Pasal 21'),
    ('2012101002', '2201', 'PPH23', 'Hutang Pajak PPH Pasal 23 (withhold)'),
    ('2012101003', '2201', 'PPN_OUT', 'Hutang  VAT PPN Keluaran'),
    ('2012101004', '2201', 'PBB', 'Hutang Pajak Bumi & Bangunan'),
    ('2012101005', '2201', 'PPH25', 'Hutang Pajak PPH Pasal 25'),
    ('2012101006', '2201', 'PPH29', 'Hutang Pajak PPh Pasal 29'),
    ('2012201001', '2301', 'BIAYA_GAJI_DAN_UPAH_YMHD', 'Biaya Gaji dan Upah Yang Masih Harus Dibayar'),
    ('2012201003', '2301', 'BIAYA_BUNGA_PINJAMAN_YMHD', 'Biaya Bunga Pinjaman Yang Masih Harus Dibayar'),
    ('2012201006', '2301', 'BIAYA_TELEPHONE_FAX_MODEM_YMHD', 'Biaya Telephone, Fax, Modem Yang Masih Harus Dibayar'),
    ('2012201009', '2301', 'BIAYA_SEWA_KANTOR_TOKO_YMHD', 'Biaya Sewa Kantor / Toko Yang Masih Harus Dibayar'),
    ('2012301001', '1501', 'FINANCING', 'Hutang Affiliasi Pembiayaan HEAD OFFICE'),
    ('2012302001', '1501', 'GOODS', 'Hutang Affiliasi Atas Barang HEAD OFFICE'),
    ('2012303001', '2502', NULL, 'Hutang Lain-lain Principal HEAD OFFICE'),
    ('2012305001', '2401', 'VOUCHER_LIABILITY', 'Hutang Voucher'),
    ('2012501001', '2502', NULL, 'Pinjaman Jangka Panjang Jatuh Tempo - Principal'),
    ('2012502001', '2501', NULL, 'Pinjaman Jangka Panjang Jatuh Tempo  Bank BCA'),
    ('2022401001', '2502', NULL, 'Pinjaman Jangka Panjang  Principal'),
    ('2022402001', '2501', NULL, 'Pinjaman Jangka Panjang  Bank BCA'),
    ('205001', '2401', 'CUSTOMER_DEPOSIT', 'Uang Muka - Penjualan'),
    ('3013001001', '3101', NULL, 'Modal Setor'),
    ('3013001002', '3201', NULL, 'Laba (Rugi) Ditahan'),
    ('3013001004', '3102', NULL, 'Prive'),
    ('4010110001', '4101', 'CASH', 'Penjualan Tunai'),
    ('4010111001', '4101', 'DEBIT_BCA', 'Penjualan Debit Card Bank BCA'),
    ('4010111002', '4101', 'DEBIT_MANDIRI', 'Penjualan Debit Card Bank Mandiri'),
    ('4010111003', '4101', 'DEBIT_BRI', 'Penjualan Debit Card Bank BRI'),
    ('4010111004', '4101', 'DEBIT_BNI', 'Penjualan Debit Card Bank BNI'),
    ('4010112001', '4101', 'CREDIT_VISA', 'Penjualan Kartu Kredit VISA Card'),
    ('4010112002', '4101', 'CREDIT_MASTER', 'Penjualan Kartu Kredit Master Card'),
    ('4010113001', '4101', 'ONLINE_OWN', 'Penjualan  Online Sendiri'),
    ('4010113002', '4101', 'ONLINE_MARKETPLACE', 'Penjualan  Online Market Place'),
    ('4010114001', '4101', 'QRIS', 'Penjualan QRIS'),
    ('4010213001', '4201', 'DISCOUNT', 'Discount / Potongan Penjualan'),
    ('4010214001', '4201', 'RETURN', 'Retur Penjualan'),
    ('4020110001', '4301', 'MANAGEMENT_FEE', 'Management Fee'),
    ('5010110001', '5101', 'COGS', 'Harga Pokok Pembelian'),
    ('6010110001', '6101', 'BIAYA_CUSTOMER_SUPPLIES', 'Biaya Customer Supplies'),
    ('6010110002', '6101', 'BIAYA_CREDIT_CARD', 'Biaya Credit Card'),
    ('6010110003', '6101', 'BIAYA_PROMOSI', 'Biaya Promosi'),
    ('6010110004', '6101', 'BIAYA_DEKORASI', 'Biaya Dekorasi'),
    ('6010110005', '6101', 'BIAYA_ADVERTISING_IKLAN', 'Biaya Advertising / Iklan'),
    ('6010110006', '6101', 'BIAYA_BONGKAR_MUAT_BARANG', 'Biaya Bongkar Muat Barang'),
    ('6010110007', '6101', 'BIAYA_PENGIRIMAN_BARANG_KURIR_EKSPEDISI', 'Biaya Pengiriman Barang/kurir/Ekspedisi'),
    ('6010110008', '5102', 'DAMAGE', 'Biaya  Kerusakan Persediaan Barang Dagangan'),
    ('6010210001', '6201', 'BIAYA_GAJI_KARYAWAN', 'Biaya Gaji Pegawai'),
    ('6010210002', '6201', 'BIAYA_LEMBUR', 'Biaya Lembur'),
    ('6010210003', '6201', 'UANG_MAKAN', 'Uang Makan'),
    ('6010210004', '6201', 'UANG_TRANSPORT', 'Uang Transport'),
    ('6010210005', '6201', 'BIAYA_KESEHATAN_PENGOBATAN', 'Biaya Kesehatan & Pengobatan'),
    ('6010210006', '6201', 'BIAYA_ASURANSI_PEGAWAI_BPJS', 'Biaya Asuransi Pegawai / BPJS'),
    ('6010210007', '6201', 'TUNJANGAN_HARI_RAYA', 'Tunjangan Hari Raya (THR)'),
    ('6010210008', '6201', 'BIAYA_UNIFORM_SERAGAM_KERJA', 'Biaya Uniform / Seragam Kerja'),
    ('6010210009', '6201', 'BIAYA_SPORT_RECREATION', 'Biaya Sport & Recreation'),
    ('6010210010', '6201', 'FUNERAL_CONTRIBUTION', 'Funeral Contribution'),
    ('6010210011', '6201', 'BIAYA_MANPOWER_DEVELOPMENT', 'Biaya Manpower Development'),
    ('6010210012', '6201', 'BIAYA_PESANGON', 'Biaya Pesangon'),
    ('6010210013', '6201', 'KOMISI_BONUS_INSENTIF', 'Komisi, Bonus & Insentif'),
    ('6010310001', '6301', 'BIAYA_KEBERSIHAN', 'Biaya Kebersihan (Cleaning)'),
    ('6010310002', '6301', 'ALAT_TULIS_KANTOR_BARANG_CETAKAN', 'Alat Tulis Kantor & Barang Cetakan'),
    ('6010310003', '6301', 'BIAYA_RUMAH_TANGGA', 'Biaya Rumah Tangga'),
    ('6010310004', '6301', 'BIAYA_BANK_HO', 'Biaya Bank Head Office'),
    ('6010310005', '6301', 'BIAYA_TELEPHONE_FACSIMILE_MODEM', 'Biaya Telephone,Facsimile, Modem'),
    ('6010310006', '6301', 'BIAYA_PEMAKAIAN_LISTRIK', 'Biaya Pemakaian Listrik'),
    ('6010310007', '6301', 'BIAYA_PEMAKAIAN_AIR_BERSIH', 'Biaya Pemakaian Air Bersih (PDAM)'),
    ('6010310008', '6301', 'BIAYA_PERJALANAN_DINAS', 'Biaya Perjalanan Dinas'),
    ('6010310009', '6301', 'BIAYA_LOKAL_TRANSPORT', 'Biaya Lokal Transport'),
    ('6010310010', '6301', 'BIAYA_PERIJINAN', 'Biaya Perijinan'),
    ('6010310011', '6301', 'COMPUTER_EXPENSES', 'Computer Expenses'),
    ('6010310012', '6301', 'BIAYA_PENYISIHAN_KERUGIAN_PIUTANG', 'Biaya Penyisihan Kerugian Piutang'),
    ('6010310013', '6301', 'BIAYA_PERLENGKAPAN_TOKO_DAN_KANTOR', 'Biaya Perlengkapan Toko dan Kantor'),
    ('6010310014', '6301', 'BIAYA_STOCK_OPNAME', 'Biaya Stock Opname'),
    ('6010310015', '6301', 'BIAYA_PERALATAN_LISTRIK', 'Biaya Peralatan Listrik'),
    ('6010310016', '6301', 'TIRE_TUBES_EXPENCES', 'Tire & Tubes  Expenses'),
    ('6010310017', '6301', 'F_U_E_L_O_I_L_EXPENCES', 'Fuel & Oil Expenses'),
    ('6010310018', '6301', 'T_O_O_L_S_EKSPENCES', 'Tools (Peralatan) Expenses'),
    ('6010310021', '6301', 'BIAYA_DONASI', 'Biaya Donasi (CSR, Zakat)'),
    ('6010310022', '6301', 'BIAYA_KONSULTAN', 'Biaya Konsultan'),
    ('6010310023', '6301', 'BIAYA_LISENSI_KENDARAAN', 'Biaya Lisensi Kendaraan ( STNK, Uji Kir)'),
    ('6010310024', '6301', 'BIAYA_PERLENGKAPAN_MESS_ATAU_RUMAH_DINAS', 'Biaya Perlengkapan Mess atau Rumah Dinas'),
    ('6010310099', '6301', 'MISCELLANEOUS_EXPENCES', 'Miscellaneous Expenses'),
    ('6010410001', '6301', 'BIAYA_PERBAIKAN_DAN_PERAWATAN_FFE', 'BIAYA PERBAIKAN DAN PERAWATAN FURNITURE, FIXTURE & EQUIPMENT'),
    ('6010410002', '6301', 'SOFTWARE_MAINTENANCE', 'SOFTWARE MAINTENANCE'),
    ('6010410003', '6301', 'BIAYA_PERBAIKAN_DAN_PERAWATAN_KOMPUTER', 'BIAYA PERBAIKAN DAN PERAWATAN KOMPUTER'),
    ('6010410004', '6301', 'BIAYA_PERBAIKAN_DAN_PERAWATAN_BANGUNAN', 'BIAYA PERBAIKAN DAN PERAWATAN BANGUNAN'),
    ('6010410005', '6301', 'BIAYA_PERBAIKAN_DAN_PERAWATAN_STAFF_HOUSE', 'BIAYA PERBAIKAN DAN PERAWATAN STAFF HOUSE'),
    ('6010410006', '6301', 'BIAYA_PERBAIKAN_DAN_PERAWATAN_KENDARAAN', 'BIAYA PERBAIKAN DAN PERAWATAN KENDARAAN'),
    ('6010410007', '6301', 'BIAYA_PERBAIKAN_DAN_PERAWATAN_AIRCONDITIONER', 'BIAYA PERBAIKAN DAN PERAWATAN AIRCONDITIONER & REFRIGERATOR'),
    ('6010410008', '6301', 'BIAYA_POWER_PLANT', 'Biaya Power Plant'),
    ('6010410010', '6301', 'BIAYA_PERBAIKAN_DAN_PERAWATAN_LIFT', 'BIAYA PERBAIKAN DAN PERAWATAN LIFT'),
    ('7010110001', '6401', 'BIAYA_SEWA_TANAH', 'Biaya Sewa Tanah'),
    ('7010110002', '6401', 'BIAYA_LAND_RIGHT', 'Biaya Land Right'),
    ('7010110003', '6401', 'BIAYA_SEWA_BANGUNAN_TOKO_DAN_GUDANG', 'Biaya Sewa Bangunan Toko dan Gudang'),
    ('7010110004', '6401', 'BIAYA_SEWA_RUMAH_DINAS_MESS', 'Biaya Sewa Rumah Dinas / Mess'),
    ('7010210001', '7101', NULL, 'Biaya Depresiasi Bangunan Utama'),
    ('7010211001', '7101', NULL, 'Biaya Depresiasi Instalasi Mekanikal, Elektrikal'),
    ('7010212001', '7101', NULL, 'Biaya Depresiasi Mesin -  Air Conditioning'),
    ('7010213001', '7101', NULL, 'Biaya Depresiasi Kendaraan - Mobil'),
    ('7010214001', '7101', NULL, 'Biaya Depresiasi Furniture, Fixture & Equipment Office'),
    ('7010215001', '7101', NULL, 'Biaya Replacement Operating Equipment - Rack 1'),
    ('7010216001', '7101', NULL, 'Biaya Amortisasi Seventh Soft Application'),
    ('7010216002', '7101', NULL, 'Biaya Amortisasi Biaya Pre Opening'),
    ('7010310001', '6301', 'PROPERTY_ALL_RISK_FIRE_INSURANCE', 'Property All Risk & Fire Insurance'),
    ('7010310002', '6301', 'BIAYA_PAJAK_BUMI_DAN_BANGUNAN', 'Biaya Pajak Bumi Dan Bangunan  (PBB)'),
    ('7020310003', '6301', 'BIAYA_PAJAK_REKLAME', 'Biaya Pajak Reklame'),
    ('7020310004', '6301', 'BIAYA_MANAGEMENT_FEE', 'Biaya Management FEE'),
    ('7020310005', '6301', 'BIAYA_ASURANSI_KENDARAAN', 'Biaya Asuransi Kendaraan'),
    ('8010110001', '4301', 'INTEREST', 'Pendapatan Bunga Bank'),
    ('8010110002', '4301', 'ROUNDING', 'Selisih Pembulatan'),
    ('8010110003', '5101', 'PURCHASE_DISCOUNT', 'Potongan Pembelian'),
    ('8010110004', '4301', 'RENT_BUILDING', 'Pendapatan Sewa Gedung'),
    ('8010110006', '5102', 'SHRINKAGE', 'Kehilangan Barang atau Selisih Stock Opname'),
    ('8010110007', '4301', 'INCOME_OTHER', 'Pendapatan (Biaya) Lain-Lain'),
    ('8020111001', '8101', NULL, 'Biaya Bunga Pinjaman Bank'),
    ('8020111002', '8101', NULL, 'Biaya Bunga Leasing'),
    ('8030112001', '8201', 'PPH25', 'Current Tax Income/Expense PPH Pasal 25');

-- The qualifier is the category, for the two accounts that spanned several.
--
-- Resolved into a table and checked BEFORE anything is written, because the
-- trigger 0288 installed would otherwise refuse the UPDATE first and report it
-- as a bad map row — which is true but useless, since the thing to fix is here.
CREATE TEMP TABLE card_tender (semantic_key TEXT, site_id TEXT, qualifier TEXT, category_code TEXT)
    ON COMMIT DROP;

INSERT INTO card_tender (semantic_key, site_id, qualifier, category_code)
SELECT m.semantic_key, m.site_id, m.qualifier,
       CASE upper(m.qualifier)
           WHEN 'VISA'    THEN 'CREDIT_VISA'
           WHEN 'MASTER'  THEN 'CREDIT_MASTER'
           WHEN 'BCA'     THEN 'DEBIT_BCA'
           WHEN 'MANDIRI' THEN 'DEBIT_MANDIRI'
           WHEN 'BRI'     THEN 'DEBIT_BRI'
           WHEN 'BNI'     THEN 'DEBIT_BNI'
           -- The unqualified row is the fallback the poster falls back to when a
           -- settlement names no acquirer. It is a real row and it needs a real
           -- category: the card receivable not broken down.
           WHEN ''        THEN CASE WHEN m.account_code = '1011101001'
                                    THEN 'CREDIT_CARD' ELSE 'DEBIT_CARD' END
       END
  FROM account_map m
 WHERE m.account_code IN ('1011101001', '1011101002');

DO $$
DECLARE
    stranded TEXT;
BEGIN
    SELECT string_agg(DISTINCT coalesce(nullif(qualifier, ''), '(unqualified)'), ', ')
      INTO stranded FROM card_tender WHERE category_code IS NULL;
    IF stranded IS NOT NULL THEN
        RAISE EXCEPTION
            'card receivable is mapped under the qualifier(s) %, and no tender '
            'category is named for them. Add the value in 0287 and the arm '
            'here; do not let the row through without one', stranded;
    END IF;
END $$;

UPDATE account_map m
   SET account_code = '1201', category_code = c.category_code
  FROM card_tender c
 WHERE (m.semantic_key, m.site_id, m.qualifier) = (c.semantic_key, c.site_id, c.qualifier);

-- Everything else, straight off the record of what became what.
UPDATE account_map m
   SET account_code = r.new_code,
       category_code = r.category_code
  FROM ledger_account_remap r
 WHERE m.account_code = r.legacy_code;

-- The asset meanings are qualified by a seven-digit family of the old chart
-- (`fixed_asset` under `1021507`, and so on). Those qualifiers are the asset
-- CLASS, which 0287 gave a table of its own and 0291 points the register at.
-- They are left exactly as they are here: rewriting them is the seed's job and
-- the seed is being rewritten alongside this. What matters for the ledger is
-- that all seven now resolve to one account, which they do.

-- Shut the hundred and ninety. BLOCKED is the one posting mode that admits
-- nothing — not a rule, not a person, not an approved correction (0263) — and
-- it is the honest state for an account whose whole job is now done by another.
-- `posting_policy_configured` stays TRUE, because a decision was made about
-- them; the invariant "every postable account has a policy" therefore still
-- holds over all 230.
UPDATE ledger_account
   SET is_active = FALSE,
       posting_mode = 'BLOCKED',
       manual_je_policy = 'NO'
 WHERE account_code IN (SELECT legacy_code FROM ledger_account_remap)
    OR account_code IN ('3013001003', '1031801001');

DO $$
DECLARE
    retired    INTEGER;
    live       INTEGER;
    unmapped   INTEGER;
    unclear    INTEGER;
    dangling   TEXT;
BEGIN
    SELECT count(*) INTO retired FROM ledger_account_remap;
    IF retired <> 188 THEN RAISE EXCEPTION 'expected 188 remapped accounts, got %', retired; END IF;

    SELECT count(*) INTO retired FROM ledger_account WHERE NOT is_group AND NOT is_active;
    IF retired <> 190 THEN RAISE EXCEPTION 'expected 190 retired accounts, got %', retired; END IF;

    SELECT count(*) INTO live
      FROM ledger_account WHERE NOT is_group AND is_active;
    IF live <> 40 THEN RAISE EXCEPTION 'expected 40 live postable accounts, got %', live; END IF;

    -- The invariant this chart has carried since 0262, restated over both sets.
    SELECT count(*) INTO unclear
      FROM ledger_account WHERE NOT is_group AND NOT posting_policy_configured;
    IF unclear <> 0 THEN RAISE EXCEPTION '% postable accounts have no policy', unclear; END IF;

    -- Nothing may still be choosing an account that takes no postings.
    SELECT string_agg(DISTINCT m.semantic_key, ', ') INTO dangling
      FROM account_map m JOIN ledger_account a USING (account_code)
     WHERE NOT a.is_active;
    IF dangling IS NOT NULL THEN
        RAISE EXCEPTION 'the map still points at retired accounts for: %', dangling;
    END IF;

    SELECT count(*) INTO unmapped
      FROM ledger_account_remap r
     WHERE NOT EXISTS (SELECT 1 FROM ledger_account a WHERE a.account_code = r.new_code AND a.is_active);
    IF unmapped <> 0 THEN RAISE EXCEPTION '% retired accounts point at nothing live', unmapped; END IF;
END $$;
