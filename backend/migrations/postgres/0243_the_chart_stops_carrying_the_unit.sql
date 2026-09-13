-- 0243: The chart stops carrying the unit.
--
-- # What was wrong
--
-- `ledger_account` holds CENTRAL FASHION STORE's own chart, imported verbatim
-- by `scripts/import-coa.py`: 7,528 accounts on a code-length ladder of
-- {1,3,5,7,10,12}, where every twelve-character leaf is one meaning crossed
-- with one of fourteen units. `docs/coa-final.md` took that file apart and
-- found what the shape really is:
--
--     367 ordinary meanings x 14 units          = 5,138
--       9 matrix meanings   x 14 x 14 units     = 1,764
--                                                 -----
--                                                 6,902 leaves, exactly
--     + 6 accounts outside the pattern          = 6,908 posting accounts
--
-- So 382 meanings, written out 6,908 times. 94.5% of the posting accounts in
-- this database exist only because a list of meanings was cross-multiplied by
-- a list of units.
--
-- The unit axis is already here under another name. `journal_line.site_id` is
-- NOT NULL on every posting and has been since 0051. The chart carrying the
-- unit a second time is not redundancy that costs nothing: it is a second
-- authority, and the two disagree the first time an account is opened for one
-- shop and not another.
--
-- # What this migration does
--
-- Writes the 219-account chart derived in `docs/coa-final.md` and frozen in
-- `docs/fixtures/coa-final.json` — 44 groups and 175 posting accounts, one row
-- per MEANING, no unit anywhere. It does not remove anything. 0244 moves every
-- reference across and then retires the old rows; until it has, the accounts
-- the existing journal names have to keep existing.
--
-- # Why the codes are still the client's digits
--
-- `coa-final.json` proposes codes shaped `1-1100`. Those cannot be loaded and
-- switching to them would break live behaviour:
--
--   * `CHECK (account_code ~ '^[0-9]+$')` rejects the hyphen outright;
--   * `CHECK (account_code LIKE parent_code || '%')` — this chart encodes its
--     hierarchy IN the code, and `1-1100` does not start with `1-1000`;
--   * `root_class` and `depth` are GENERATED from `left(code,1)` and
--     `length(code)`;
--   * `ledger.rs` sums a subtree with `WHERE l.account_code LIKE $1 || '%'`
--     and walks ancestors the same way. A non-prefix scheme breaks both
--     SILENTLY — the query still runs and returns a smaller number.
--
-- So the meanings are the fixture's, and the codes are the client's own, with
-- the two-digit unit suffix chopped off. A twelve-digit leaf minus its unit is
-- the ten-digit TEMPLATE, and the templates already ARE the meanings:
--
--     101100100100  Kas di Tangan HEAD OFFICE   ->  1011001001  Kas di Tangan
--     101100100107  Kas di Tangan C007          ->  1011001001  (the same one)
--
-- Groups keep the rungs they already occupy: `1` ASSET, `101` CURRENT ASSET,
-- `10110` KAS & SETARA KAS, `1011002` CASH IN BANK GIRO. 207 of the 219 codes
-- are rows that already exist — the ladder above the leaves. Twelve are new,
-- and each is listed in `0244` with the reason it had to be minted.
--
-- # The five columns
--
-- What the fixture knows and the table could not say. `dimension` is the axis
-- a posting to this account must carry: `unit` for almost everything,
-- `company` for the 28 accounts that belong to the legal entity rather than to
-- a shop (bank accounts, tax, owner's equity). `requires_counterparty` is true
-- on exactly three accounts — goods in transit both ways, and the inter-unit
-- current account — and it is a column rather than a general dimension because
-- it is a property of those three and a mistake anywhere else.
--
-- The two CHECKs that make the point structural are added at the END of 0244,
-- once the imported rows are gone: `site_id IS NULL` on every account, and
-- `dimension IS NULL` exactly on groups.

ALTER TABLE ledger_account
    ADD COLUMN name_en               text,
    ADD COLUMN dimension             text CHECK (dimension IN ('unit', 'company')),
    ADD COLUMN requires_counterparty boolean NOT NULL DEFAULT false,
    ADD COLUMN normal_balance        char(1) CHECK (normal_balance IN ('D', 'C')),
    ADD COLUMN is_contra             boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ledger_account.dimension IS
    'The axis a posting to this account must carry: `unit` (the org_place the line belongs to) or `company` (the legal entity, which posts at head office). NULL on groups.';
COMMENT ON COLUMN ledger_account.requires_counterparty IS
    'True on the three accounts that name a second unit — goods in transit both ways and the inter-unit current account — and forbidden everywhere else.';

-- Everything in the table right now is the imported chart. Retire it as a
-- statement of intent; 0244 deletes it once nothing points at it any more.
-- `assert_expense_line_account` already refuses a bill line against an
-- inactive account, so this alone stops new costs landing on the old chart.
UPDATE ledger_account SET is_active = false;

-- ---------------------------------------------------------------------------
-- The 219
-- ---------------------------------------------------------------------------
--
-- ON CONFLICT rather than a plain INSERT because most of these codes are
-- already rows. 161 of them are today GROUPS — a ten-digit template with
-- fourteen unit leaves hanging off it — and become posting accounts, which is
-- the whole collapse in one column. Their leaves still exist at this point and
-- still name them as parent; that is intended, and 0244 removes them.
--
-- Nothing here sets `site_id`. That is the point of the migration.

INSERT INTO ledger_account
    (account_code, name, name_en, parent_code, is_group,
     dimension, requires_counterparty, normal_balance, is_contra,
     is_active, site_id, counterparty_site_id)
SELECT v.account_code, v.name, v.name_en, v.parent_code, v.is_group,
       v.dimension, v.requires_counterparty, v.normal_balance, v.is_contra,
       true, NULL, NULL
  FROM (VALUES
  ('1', 'ASET', 'Assets', NULL, true, NULL, false, NULL, false),
  ('2', 'KEWAJIBAN', 'Liabilities', NULL, true, NULL, false, NULL, false),
  ('3', 'EKUITAS', 'Equity', NULL, true, NULL, false, NULL, false),
  ('4', 'PENDAPATAN', 'Revenue', NULL, true, NULL, false, NULL, false),
  ('5', 'HARGA POKOK PENJUALAN', 'Cost of goods sold', NULL, true, NULL, false, NULL, false),
  ('6', 'BEBAN USAHA', 'Operating expenses', NULL, true, NULL, false, NULL, false),
  ('7', 'BEBAN USAHA LAINNYA', 'Occupancy and non-cash operating expenses', NULL, true, NULL, false, NULL, false),
  ('8', 'BEBAN NON OPERASIONAL', 'Non-operating expenses', NULL, true, NULL, false, NULL, false),
  ('101', 'ASET LANCAR', 'Current assets', '1', true, NULL, false, NULL, false),
  ('102', 'ASET TIDAK LANCAR', 'Non-current assets', '1', true, NULL, false, NULL, false),
  ('103', 'ASET LAIN-LAIN', 'Other assets', '1', true, NULL, false, NULL, false),
  ('201', 'KEWAJIBAN JANGKA PENDEK', 'Current liabilities', '2', true, NULL, false, NULL, false),
  ('202', 'KEWAJIBAN JANGKA PANJANG', 'Long-term liabilities', '2', true, NULL, false, NULL, false),
  ('401', 'Penjualan', 'Sales', '4', true, NULL, false, NULL, false),
  ('402', 'Pendapatan Lain-lain', 'Other income', '4', true, NULL, false, NULL, false),
  ('10110', 'Kas & Setara Kas', 'Cash and cash equivalents', '101', true, NULL, false, NULL, false),
  ('10111', 'Piutang', 'Receivables', '101', true, NULL, false, NULL, false),
  ('10112', 'Persediaan', 'Inventory', '101', true, NULL, false, NULL, false),
  ('10113', 'Biaya Dibayar Dimuka', 'Prepayments', '101', true, NULL, false, NULL, false),
  ('10214', 'Rekening Antar-Unit', 'Inter-unit accounts', '102', true, NULL, false, NULL, false),
  ('10215', 'Aset Tetap', 'Fixed assets', '102', true, NULL, false, NULL, false),
  ('10216', 'Akumulasi Penyusutan', 'Accumulated depreciation', '102', true, NULL, false, NULL, false),
  ('10217', 'Aset Tak Berwujud', 'Intangible assets', '102', true, NULL, false, NULL, false),
  ('20120', 'Hutang Usaha', 'Trade payables', '201', true, NULL, false, NULL, false),
  ('20121', 'Hutang Pajak', 'Tax payable', '201', true, NULL, false, NULL, false),
  ('20122', 'Biaya Yang Masih Harus Dibayar', 'Accrued expenses', '201', true, NULL, false, NULL, false),
  ('20123', 'Hutang Lain-lain', 'Other payables', '201', true, NULL, false, NULL, false),
  ('20124', 'Uang Muka Pelanggan', 'Customer deposits', '201', true, NULL, false, NULL, false),
  ('20125', 'Pinjaman Jatuh Tempo Dalam Satu Tahun', 'Current portion of long-term debt', '201', true, NULL, false, NULL, false),
  ('60101', 'Beban Penjualan', 'Selling expenses', '6', true, NULL, false, NULL, false),
  ('60102', 'Beban Pegawai', 'Employee costs', '6', true, NULL, false, NULL, false),
  ('60103', 'Beban Administrasi & Umum', 'Administrative and general expenses', '6', true, NULL, false, NULL, false),
  ('60104', 'Beban Perawatan & Pemeliharaan', 'Repairs and maintenance', '6', true, NULL, false, NULL, false),
  ('70101', 'Beban Sewa', 'Rent', '7', true, NULL, false, NULL, false),
  ('70102', 'Beban Penyusutan & Amortisasi', 'Depreciation and amortisation', '7', true, NULL, false, NULL, false),
  ('70103', 'Beban Usaha Lainnya', 'Other operating expenses', '7', true, NULL, false, NULL, false),
  ('80101', 'Beban Lain-lain', 'Other expenses', '8', true, NULL, false, NULL, false),
  ('80201', 'Beban Bunga', 'Interest expense', '8', true, NULL, false, NULL, false),
  ('80301', 'Pajak Penghasilan', 'Income tax', '8', true, NULL, false, NULL, false),
  ('1011002', 'Bank — Giro', 'Bank current accounts', '10110', true, NULL, false, NULL, false),
  ('1011003', 'Bank — Tabungan', 'Bank savings accounts', '10110', true, NULL, false, NULL, false),
  ('1011004', 'Deposito Berjangka', 'Time deposits', '10110', true, NULL, false, NULL, false),
  ('1011302', 'Pajak Dibayar Dimuka', 'Prepaid tax', '10113', true, NULL, false, NULL, false),
  ('1011303', 'Uang Muka', 'Advances', '10113', true, NULL, false, NULL, false),
  ('1011001001', 'Kas di Tangan', 'Cash on hand', '10110', false, 'unit', false, 'D', false),
  ('1011001002', 'Kas Kecil', 'Petty cash', '10110', false, 'unit', false, 'D', false),
  ('1011001003', 'Modal Kasir', 'Till float', '10110', false, 'unit', false, 'D', false),
  ('1011002001', 'Bank BCA — Giro', 'Bank BCA — current account', '1011002', false, 'company', false, 'D', false),
  ('1011002002', 'Bank Mandiri — Giro', 'Bank Mandiri — current account', '1011002', false, 'company', false, 'D', false),
  ('1011002003', 'Bank BRI — Giro', 'Bank BRI — current account', '1011002', false, 'company', false, 'D', false),
  ('1011002004', 'Bank BNI — Giro', 'Bank BNI — current account', '1011002', false, 'company', false, 'D', false),
  ('1011002005', 'Bank Danamon — Giro', 'Bank Danamon — current account', '1011002', false, 'company', false, 'D', false),
  ('1011003001', 'Bank BCA — Tabungan', 'Bank BCA — savings account', '1011003', false, 'company', false, 'D', false),
  ('1011003002', 'Bank Mandiri — Tabungan', 'Bank Mandiri — savings account', '1011003', false, 'company', false, 'D', false),
  ('1011003003', 'Bank BRI — Tabungan', 'Bank BRI — savings account', '1011003', false, 'company', false, 'D', false),
  ('1011003004', 'Bank BNI — Tabungan', 'Bank BNI — savings account', '1011003', false, 'company', false, 'D', false),
  ('1011003005', 'Bank BTN — Tabungan', 'Bank BTN — savings account', '1011003', false, 'company', false, 'D', false),
  ('1011004001', 'Deposito BCA', 'Time deposit — BCA', '1011004', false, 'company', false, 'D', false),
  ('1011004002', 'Deposito Mandiri', 'Time deposit — Mandiri', '1011004', false, 'company', false, 'D', false),
  ('1011004003', 'Deposito BRI', 'Time deposit — BRI', '1011004', false, 'company', false, 'D', false),
  ('1011004004', 'Deposito BNI', 'Time deposit — BNI', '1011004', false, 'company', false, 'D', false),
  ('1011005001', 'Setoran Dalam Perjalanan', 'Deposits in transit', '10110', false, 'unit', false, 'D', false),
  ('1011101001', 'Piutang Kartu Kredit', 'Credit-card settlement receivable', '10111', false, 'unit', false, 'D', false),
  ('1011101002', 'Piutang Kartu Debit', 'Debit-card settlement receivable', '10111', false, 'unit', false, 'D', false),
  ('1011102001', 'Piutang Karyawan', 'Employee receivable', '10111', false, 'unit', false, 'D', false),
  ('1011102002', 'Piutang Kepala Toko', 'Store-manager personal loan', '10111', false, 'unit', false, 'D', false),
  ('1011102003', 'Piutang Manajemen', 'Management receivable', '10111', false, 'unit', false, 'D', false),
  ('1011103001', 'Cadangan Piutang Tak Tertagih', 'Allowance for doubtful receivables', '10111', false, 'unit', false, 'C', true),
  ('1011201001', 'Persediaan Barang Dagangan', 'Merchandise inventory', '10112', false, 'unit', false, 'D', false),
  ('1011202001', 'Persediaan Perlengkapan Toko', 'Store supplies inventory', '10112', false, 'unit', false, 'D', false),
  ('1011203001', 'Barang Dalam Perjalanan — Barang Dagangan', 'Merchandise in transit', '10112', false, 'unit', true, 'D', false),
  ('1011204001', 'Barang Dalam Perjalanan — Perlengkapan', 'Store supplies in transit', '10112', false, 'unit', true, 'D', false),
  ('1011299001', 'Cadangan Kerusakan Persediaan', 'Allowance for inventory damage and loss', '10112', false, 'unit', false, 'C', true),
  ('1011301001', 'Asuransi Dibayar Dimuka', 'Prepaid insurance', '10113', false, 'unit', false, 'D', false),
  ('1011301002', 'Sewa Dibayar Dimuka', 'Prepaid rent', '10113', false, 'unit', false, 'D', false),
  ('1011301005', 'Kontrak Pemeliharaan Dibayar Dimuka', 'Prepaid maintenance contracts', '10113', false, 'unit', false, 'D', false),
  ('1011301007', 'Biaya Promosi Dibayar Dimuka', 'Prepaid promotion', '10113', false, 'unit', false, 'D', false),
  ('1011301008', 'Biaya Perijinan Dibayar Dimuka', 'Prepaid permits and licences', '10113', false, 'unit', false, 'D', false),
  ('1011301009', 'Biaya Dibayar Dimuka Lainnya', 'Other prepayments', '10113', false, 'unit', false, 'D', false),
  ('1011302001', 'PPh Pasal 21 Dibayar Dimuka', 'Prepaid income tax art. 21', '1011302', false, 'unit', false, 'D', false),
  ('1011302002', 'PPh Pasal 25 Dibayar Dimuka', 'Prepaid income tax art. 25', '1011302', false, 'unit', false, 'D', false),
  ('1011302003', 'PPh Pasal 29 Dibayar Dimuka', 'Prepaid income tax art. 29', '1011302', false, 'unit', false, 'D', false),
  ('1011302004', 'PPN Masukan', 'Input VAT', '1011302', false, 'unit', false, 'D', false),
  ('1011302005', 'PBB Dibayar Dimuka', 'Prepaid land and building tax', '1011302', false, 'unit', false, 'D', false),
  ('1011302006', 'Pajak Dibayar Dimuka Lainnya', 'Other prepaid tax', '1011302', false, 'unit', false, 'D', false),
  ('1011303001', 'Uang Muka Perjalanan Dinas', 'Travel advance', '1011303', false, 'unit', false, 'D', false),
  ('1011303002', 'Uang Muka Pembelian', 'Purchase advance', '1011303', false, 'unit', false, 'D', false),
  ('1011303003', 'Uang Muka Kontraktor', 'Contractor advance', '1011303', false, 'unit', false, 'D', false),
  ('1011303004', 'Uang Muka Lainnya', 'Other advances', '1011303', false, 'unit', false, 'D', false),
  ('1021401001', 'Rekening Koran Antar-Unit', 'Inter-unit current account', '10214', false, 'unit', true, 'D', false),
  ('1021501001', 'Tanah Hak Milik', 'Freehold land', '10215', false, 'unit', false, 'D', false),
  ('1021501002', 'Hak Guna Bangunan (HGB)', 'Leasehold land rights', '10215', false, 'unit', false, 'D', false),
  ('1021502001', 'Bangunan', 'Buildings', '10215', false, 'unit', false, 'D', false),
  ('1021503001', 'Instalasi Mekanikal & Elektrikal', 'Mechanical and electrical installations', '10215', false, 'unit', false, 'D', false),
  ('1021504001', 'Mesin & Peralatan', 'Machinery and plant', '10215', false, 'unit', false, 'D', false),
  ('1021505001', 'Kendaraan', 'Vehicles', '10215', false, 'unit', false, 'D', false),
  ('1021506001', 'Furniture, Fixture & Equipment', 'Furniture, fixtures and equipment', '10215', false, 'unit', false, 'D', false),
  ('1021507001', 'Operating Equipment', 'Operating equipment', '10215', false, 'unit', false, 'D', false),
  ('1021508001', 'Aset Dalam Pengerjaan (CIP)', 'Construction in progress', '10215', false, 'unit', false, 'D', false),
  ('1021601002', 'Akm. Penyusutan — HGB', 'Accumulated amortisation — land rights', '10216', false, 'unit', false, 'C', true),
  ('1021602001', 'Akm. Penyusutan — Bangunan', 'Accumulated depreciation — buildings', '10216', false, 'unit', false, 'C', true),
  ('1021603001', 'Akm. Penyusutan — Instalasi', 'Accumulated depreciation — installations', '10216', false, 'unit', false, 'C', true),
  ('1021604001', 'Akm. Penyusutan — Mesin & Peralatan', 'Accumulated depreciation — machinery', '10216', false, 'unit', false, 'C', true),
  ('1021605001', 'Akm. Penyusutan — Kendaraan', 'Accumulated depreciation — vehicles', '10216', false, 'unit', false, 'C', true),
  ('1021606001', 'Akm. Penyusutan — FFE', 'Accumulated depreciation — FFE', '10216', false, 'unit', false, 'C', true),
  ('1021607001', 'Cadangan Penggantian Operating Equipment', 'Operating equipment replacement reserve', '10216', false, 'unit', false, 'C', true),
  ('1021701001', 'Perangkat Lunak', 'Software', '10217', false, 'unit', false, 'D', false),
  ('1021702001', 'Akm. Amortisasi Perangkat Lunak', 'Accumulated amortisation — software', '10217', false, 'unit', false, 'C', true),
  ('1031801001', 'Persediaan Barang Rusak', 'Disposed inventory', '103', false, 'unit', false, 'D', false),
  ('1031802001', 'Biaya Pra-Operasi', 'Pre-opening costs', '103', false, 'unit', false, 'D', false),
  ('1031802002', 'Akm. Amortisasi Biaya Pra-Operasi', 'Accumulated amortisation — pre-opening', '103', false, 'unit', false, 'C', true),
  ('2012001001', 'Hutang Supplier Barang Dagangan', 'Merchandise supplier payable', '20120', false, 'unit', false, 'C', false),
  ('2012001002', 'Hutang Supplier Barang Dagangan — Ditahan', 'Merchandise supplier payable — suspended', '20120', false, 'unit', false, 'C', false),
  ('2012001003', 'Hutang Supplier Non-Barang Dagangan', 'Non-merchandise supplier payable', '20120', false, 'unit', false, 'C', false),
  ('2012002001', 'Giro Keluar Belum Cair', 'Outstanding cheques (giro)', '20120', false, 'company', false, 'C', false),
  ('2012101001', 'Hutang PPh Pasal 21', 'Income tax payable art. 21', '20121', false, 'unit', false, 'C', false),
  ('2012101002', 'Hutang PPh Pasal 23', 'Withholding tax payable art. 23', '20121', false, 'unit', false, 'C', false),
  ('2012101003', 'Hutang PPN Keluaran', 'Output VAT payable', '20121', false, 'unit', false, 'C', false),
  ('2012101004', 'Hutang PBB', 'Land and building tax payable', '20121', false, 'unit', false, 'C', false),
  ('2012101005', 'Hutang PPh Pasal 25', 'Income tax payable art. 25', '20121', false, 'unit', false, 'C', false),
  ('2012201001', 'Beban Pegawai YMHD', 'Accrued employee costs', '20122', false, 'unit', false, 'C', false),
  ('2012201003', 'Beban Bunga YMHD', 'Accrued interest', '20122', false, 'unit', false, 'C', false),
  ('2012201006', 'Beban Utilitas YMHD', 'Accrued utilities', '20122', false, 'unit', false, 'C', false),
  ('2012201009', 'Beban Sewa YMHD', 'Accrued rent', '20122', false, 'unit', false, 'C', false),
  ('2012303001', 'Hutang kepada Pemilik', 'Due to principal (owner)', '20123', false, 'unit', false, 'C', false),
  ('2012401001', 'Uang Muka Penjualan & Voucher', 'Customer deposits and vouchers', '20124', false, 'company', false, 'C', false),
  ('2012501001', 'Pinjaman Jatuh Tempo — Pemilik', 'Current portion — owner loan', '20125', false, 'company', false, 'C', false),
  ('2012502001', 'Pinjaman Jatuh Tempo — Bank', 'Current portion — bank loans', '20125', false, 'company', false, 'C', false),
  ('2022401001', 'Pinjaman Jangka Panjang — Pemilik', 'Long-term owner loan', '202', false, 'company', false, 'C', false),
  ('2022402001', 'Pinjaman Jangka Panjang — Bank', 'Long-term bank loans', '202', false, 'company', false, 'C', false),
  ('3013001001', 'Modal Disetor', 'Paid-in capital', '3', false, 'company', false, 'C', false),
  ('3013001002', 'Laba Ditahan', 'Retained earnings', '3', false, 'company', false, 'C', false),
  ('3013001003', 'Laba (Rugi) Tahun Berjalan', 'Current-year result', '3', false, 'company', false, 'C', false),
  ('3013001004', 'Prive', 'Owner''s drawings', '3', false, 'company', false, 'D', true),
  ('4010110001', 'Penjualan Barang Dagangan', 'Merchandise sales', '401', false, 'unit', false, 'C', false),
  ('4010213001', 'Potongan Penjualan', 'Sales discounts', '401', false, 'unit', false, 'D', true),
  ('4010214001', 'Retur Penjualan', 'Sales returns', '401', false, 'unit', false, 'D', true),
  ('4020110001', 'Management Fee', 'Management fee income', '402', false, 'unit', false, 'C', false),
  ('4020210001', 'Pendapatan Bunga Bank', 'Bank interest income', '402', false, 'company', false, 'C', false),
  ('4020210002', 'Potongan Pembelian', 'Purchase discounts received', '402', false, 'unit', false, 'C', false),
  ('4020210003', 'Pendapatan Sewa', 'Rental income', '402', false, 'unit', false, 'C', false),
  ('4020210009', 'Pendapatan Lain-lain', 'Sundry income', '402', false, 'unit', false, 'C', false),
  ('5010110001', 'Harga Pokok Penjualan', 'Cost of goods sold', '5', false, 'unit', false, 'D', false),
  ('6010110001', 'Perlengkapan Pelanggan', 'Customer supplies', '60101', false, 'unit', false, 'D', false),
  ('6010110002', 'Biaya Kartu Kredit & Debit', 'Card acquiring fees', '60101', false, 'unit', false, 'D', false),
  ('6010110003', 'Biaya Promosi', 'Promotion', '60101', false, 'unit', false, 'D', false),
  ('6010110004', 'Biaya Dekorasi', 'Store decoration', '60101', false, 'unit', false, 'D', false),
  ('6010110005', 'Biaya Iklan', 'Advertising', '60101', false, 'unit', false, 'D', false),
  ('6010110006', 'Biaya Bongkar Muat', 'Loading and unloading', '60101', false, 'unit', false, 'D', false),
  ('6010110007', 'Biaya Pengiriman Barang', 'Freight out', '60101', false, 'unit', false, 'D', false),
  ('6010110008', 'Kerusakan Persediaan', 'Merchandise damage', '60101', false, 'unit', false, 'D', false),
  ('6010210001', 'Gaji & Upah', 'Salaries and wages', '60102', false, 'unit', false, 'D', false),
  ('6010210002', 'Biaya Lembur', 'Overtime', '60102', false, 'unit', false, 'D', false),
  ('6010210003', 'Uang Makan', 'Meal allowance', '60102', false, 'unit', false, 'D', false),
  ('6010210004', 'Uang Transport', 'Transport allowance', '60102', false, 'unit', false, 'D', false),
  ('6010210005', 'Kesehatan & Pengobatan', 'Medical', '60102', false, 'unit', false, 'D', false),
  ('6010210006', 'Asuransi Pegawai & BPJS', 'Employee insurance and BPJS', '60102', false, 'unit', false, 'D', false),
  ('6010210007', 'Tunjangan Hari Raya (THR)', 'Religious holiday allowance', '60102', false, 'unit', false, 'D', false),
  ('6010210008', 'Seragam Kerja', 'Uniforms', '60102', false, 'unit', false, 'D', false),
  ('6010210009', 'Olahraga & Rekreasi', 'Sport and recreation', '60102', false, 'unit', false, 'D', false),
  ('6010210010', 'Sumbangan Duka', 'Funeral contribution', '60102', false, 'unit', false, 'D', false),
  ('6010210011', 'Pengembangan SDM', 'Manpower development', '60102', false, 'unit', false, 'D', false),
  ('6010210012', 'Pesangon', 'Severance', '60102', false, 'unit', false, 'D', false),
  ('6010210013', 'Komisi, Bonus & Insentif', 'Commission, bonus and incentive', '60102', false, 'unit', false, 'D', false),
  ('6010310001', 'Biaya Kebersihan', 'Cleaning', '60103', false, 'unit', false, 'D', false),
  ('6010310002', 'ATK & Barang Cetakan', 'Stationery and printing', '60103', false, 'unit', false, 'D', false),
  ('6010310003', 'Biaya Rumah Tangga Kantor', 'Office housekeeping', '60103', false, 'unit', false, 'D', false),
  ('6010310004', 'Biaya Bank', 'Bank charges', '60103', false, 'unit', false, 'D', false),
  ('6010310005', 'Telepon, Faksimili & Internet', 'Telecommunications', '60103', false, 'unit', false, 'D', false),
  ('6010310006', 'Biaya Listrik', 'Electricity', '60103', false, 'unit', false, 'D', false),
  ('6010310007', 'Biaya Air (PDAM)', 'Water', '60103', false, 'unit', false, 'D', false),
  ('6010310008', 'Biaya Perjalanan Dinas', 'Business travel', '60103', false, 'unit', false, 'D', false),
  ('6010310009', 'Biaya Transport Lokal', 'Local transport', '60103', false, 'unit', false, 'D', false),
  ('6010310010', 'Biaya Perijinan', 'Permits and licences', '60103', false, 'unit', false, 'D', false),
  ('6010310011', 'Beban Komputer', 'Computer expenses', '60103', false, 'unit', false, 'D', false),
  ('6010310012', 'Penyisihan Kerugian Piutang', 'Bad-debt provision', '60103', false, 'unit', false, 'D', false),
  ('6010310013', 'Perlengkapan Toko & Kantor', 'Store and office supplies', '60103', false, 'unit', false, 'D', false),
  ('6010310014', 'Biaya Stock Opname', 'Stock-count costs', '60103', false, 'unit', false, 'D', false),
  ('6010310015', 'Peralatan Listrik', 'Electrical supplies', '60103', false, 'unit', false, 'D', false),
  ('6010310016', 'Ban & Suku Cadang Kendaraan', 'Tyres and vehicle parts', '60103', false, 'unit', false, 'D', false),
  ('6010310017', 'Bahan Bakar & Pelumas', 'Fuel and lubricants', '60103', false, 'unit', false, 'D', false),
  ('6010310018', 'Peralatan Kerja (Tools)', 'Tools', '60103', false, 'unit', false, 'D', false),
  ('6010310021', 'Donasi, CSR & Zakat', 'Donations, CSR and zakat', '60103', false, 'unit', false, 'D', false),
  ('6010310022', 'Biaya Konsultan', 'Professional fees', '60103', false, 'unit', false, 'D', false),
  ('6010310023', 'Lisensi Kendaraan (STNK, KIR)', 'Vehicle licences', '60103', false, 'unit', false, 'D', false),
  ('6010310024', 'Perlengkapan Mess', 'Staff-house supplies', '60103', false, 'unit', false, 'D', false),
  ('6010310099', 'Beban Administrasi Lain-lain', 'Miscellaneous administrative expenses', '60103', false, 'unit', false, 'D', false),
  ('6010410001', 'Perawatan FFE', 'FFE maintenance', '60104', false, 'unit', false, 'D', false),
  ('6010410002', 'Perawatan Perangkat Lunak', 'Software maintenance', '60104', false, 'unit', false, 'D', false),
  ('6010410003', 'Perawatan Komputer', 'Computer maintenance', '60104', false, 'unit', false, 'D', false),
  ('6010410004', 'Perawatan Bangunan', 'Building maintenance', '60104', false, 'unit', false, 'D', false),
  ('6010410005', 'Perawatan Mess', 'Staff-house maintenance', '60104', false, 'unit', false, 'D', false),
  ('6010410006', 'Perawatan Kendaraan', 'Vehicle maintenance', '60104', false, 'unit', false, 'D', false),
  ('6010410007', 'Perawatan AC & Pendingin', 'Air-conditioning and refrigeration', '60104', false, 'unit', false, 'D', false),
  ('6010410008', 'Biaya Power Plant', 'Power plant and genset', '60104', false, 'unit', false, 'D', false),
  ('6010410010', 'Perawatan Lift', 'Lift maintenance', '60104', false, 'unit', false, 'D', false),
  ('7010110001', 'Sewa Tanah', 'Land rent', '70101', false, 'unit', false, 'D', false),
  ('7010110002', 'Amortisasi Hak Guna Bangunan', 'Land-right amortisation', '70101', false, 'unit', false, 'D', false),
  ('7010110003', 'Sewa Bangunan Toko & Gudang', 'Shop and warehouse rent', '70101', false, 'unit', false, 'D', false),
  ('7010110004', 'Sewa Rumah Dinas', 'Staff-house rent', '70101', false, 'unit', false, 'D', false),
  ('7010210001', 'Penyusutan Bangunan', 'Depreciation — buildings', '70102', false, 'unit', false, 'D', false),
  ('7010211001', 'Penyusutan Instalasi', 'Depreciation — installations', '70102', false, 'unit', false, 'D', false),
  ('7010212001', 'Penyusutan Mesin & Peralatan', 'Depreciation — machinery', '70102', false, 'unit', false, 'D', false),
  ('7010213001', 'Penyusutan Kendaraan', 'Depreciation — vehicles', '70102', false, 'unit', false, 'D', false),
  ('7010214001', 'Penyusutan FFE', 'Depreciation — FFE', '70102', false, 'unit', false, 'D', false),
  ('7010215001', 'Beban Penggantian Operating Equipment', 'Operating equipment replacement charge', '70102', false, 'unit', false, 'D', false),
  ('7010216001', 'Amortisasi Perangkat Lunak', 'Amortisation — software', '70102', false, 'unit', false, 'D', false),
  ('7010216002', 'Amortisasi Biaya Pra-Operasi', 'Amortisation — pre-opening costs', '70102', false, 'unit', false, 'D', false),
  ('7010310001', 'Asuransi Properti & Kebakaran', 'Property and fire insurance', '70103', false, 'unit', false, 'D', false),
  ('7010310002', 'Pajak Bumi & Bangunan (PBB)', 'Land and building tax', '70103', false, 'unit', false, 'D', false),
  ('7010310003', 'Pajak Reklame', 'Signage tax', '70103', false, 'unit', false, 'D', false),
  ('7010310004', 'Biaya Management Fee', 'Management fee expense', '70103', false, 'unit', false, 'D', false),
  ('7010310005', 'Asuransi Kendaraan', 'Vehicle insurance', '70103', false, 'unit', false, 'D', false),
  ('8010110002', 'Selisih Pembulatan', 'Rounding difference', '80101', false, 'unit', false, 'D', false),
  ('8010110006', 'Selisih Stock Opname', 'Stock-count loss', '80101', false, 'unit', false, 'D', false),
  ('8010110008', 'Selisih Kas', 'Cash over and short', '80101', false, 'unit', false, 'D', false),
  ('8020111001', 'Bunga Pinjaman Bank', 'Bank loan interest', '80201', false, 'company', false, 'D', false),
  ('8020111002', 'Bunga Leasing', 'Lease interest', '80201', false, 'company', false, 'D', false),
  ('8030112001', 'Beban Pajak Penghasilan', 'Income tax expense', '80301', false, 'company', false, 'D', false)
  ) AS v (account_code, name, name_en, parent_code, is_group,
          dimension, requires_counterparty, normal_balance, is_contra)
    ON CONFLICT (account_code) DO UPDATE SET
        name                  = EXCLUDED.name,
        name_en               = EXCLUDED.name_en,
        parent_code           = EXCLUDED.parent_code,
        is_group              = EXCLUDED.is_group,
        dimension             = EXCLUDED.dimension,
        requires_counterparty = EXCLUDED.requires_counterparty,
        normal_balance        = EXCLUDED.normal_balance,
        is_contra             = EXCLUDED.is_contra,
        is_active             = true,
        site_id               = NULL,
        counterparty_site_id  = NULL;

-- Say so loudly rather than let a short chart through. A bad VALUES list above
-- is a chart that looks plausible and is missing an account.
DO $$
DECLARE n bigint;
BEGIN
    SELECT count(*) INTO n FROM ledger_account WHERE is_active;
    IF n <> 219 THEN
        RAISE EXCEPTION 'the new chart should be 219 accounts, found %', n;
    END IF;
    SELECT count(*) INTO n FROM ledger_account WHERE is_active AND site_id IS NOT NULL;
    IF n <> 0 THEN
        RAISE EXCEPTION '% of the new accounts still carry a site', n;
    END IF;
END $$;

COMMENT ON TABLE ledger_account IS
    'The chart of accounts: one row per meaning, no unit. The unit lives on journal_line.site_id and nowhere else. Derived from the client''s own 7,528-account chart in docs/coa-final.md; the codes are still the client''s digits with the two-digit unit suffix removed.';
