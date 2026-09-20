-- A category is the part of an account code that was never an account.
--
-- The client's chart carries 6,908 posting accounts for what turns out to be
-- 382 meanings, and 382 meanings for about forty lines of a financial
-- statement. `docs/coa-cube.md` pulled the first axis out: every one of the 493
-- ten-digit templates has exactly fourteen children, and the fourteen are the
-- units. 0243/0244 acted on it and the chart came down to 190.
--
-- The 190 that remain still carry identity in the code. `1011002001` is not a
-- different kind of money from `1011002002`; it is the same kind of money at a
-- different bank. `7010215001` through `7010215036` are one expense for
-- thirty-six racks. `6010310006` and `6010310007` are electricity and water.
-- Each of those distinctions is real and each of them has to survive — but a
-- distinction that survives in the account CODE can only be reported on by
-- string-matching digits, cannot be renamed, and forces a new account every
-- time the client buys a thirty-seventh rack.
--
-- So this migration opens the two places identity goes instead:
--
--   `line_category`  one row per distinction that has no home anywhere else —
--                    which bank pot, which tender, which expense, which PPh
--                    article, which pay component. Carried on the journal
--                    line, resolved by `account_map` along with the account.
--
--   `asset_class`    the asset sub-types. These already had a home and were
--                    living in the wrong one: `fixed_asset.category_code`
--                    REFERENCES `ledger_account`, so the asset register has
--                    been using the chart as its class list. That is also a
--                    live bug — `import_client_assets.py` writes ten-character
--                    sub-types (`1021507027`) into it while `seed-finance.py`
--                    maps qualifiers at seven (`1021507`), so an imported asset
--                    has no mapping and the depreciation run refuses it. 0291
--                    re-points the column; this migration builds what it points
--                    at.
--
-- Nothing is invented here. Every name below is the client's own, copied
-- verbatim from `Laporan_Master_Account1.csv`, and every code is a slug of that
-- name so a category can be read back to the leaf it replaced without a lookup.
-- The generator is `outputs/coa_thirty/gen-categories.py` and it is rerunnable.
--
-- 140 categories in 16 families, 59 asset classes. The whole of `docs/coa-40-contract.md`
-- §1 and §5.
--
-- Two families of the client's are deliberately merged, and it is worth saying
-- which: `6010111 BIAYA PEGAWAI OPERATION` and `6010210 BEBAN PEGAWAI OFFICE`
-- are the same thirteen pay components written twice. The difference between
-- them is *office versus store*, which is the unit — and every journal line
-- already carries the unit. Eleven of the thirteen twins have identical names
-- and merge on their own; the other two are named in the generator's `ALIAS`
-- map, because the client wrote a different word for "employee" in one family
-- and mistyped "Transport" in the other, and a merge that happens by accident
-- of spelling is a merge nobody can defend later.

CREATE TABLE line_category (
    category_code TEXT PRIMARY KEY CHECK (category_code ~ '^[A-Z][A-Z0-9_]*$'),
    -- Which question this value answers. An account declares the family it
    -- accepts; a line may only carry a value from that family (0288).
    family        TEXT NOT NULL CHECK (family ~ '^[a-z][a-z0-9_]*$'),
    -- The client's own name, never translated. An accountant looks for
    -- "Biaya Pemakaian Listrik"; anything else is a different thing to them.
    name          TEXT NOT NULL CHECK (btrim(name) <> ''),
    name_en       TEXT,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    -- Retired, not deleted. A category that has been posted to has to keep
    -- reading back for as long as the postings do.
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    -- The client's own ten-digit template this value was taken from, where
    -- there is one. It is how `legacy_account_code()` (0292) prints an
    -- accountant's own numbers back to them, and it is NULL for the values that
    -- never were an account of theirs — a tender, a cash pot, a reason.
    legacy_code   TEXT CHECK (legacy_code ~ '^[0-9]+$'),
    -- Lets a foreign key carry the family alongside the code where one is
    -- wanted. The primary key already makes the code unique on its own.
    UNIQUE (category_code, family)
);

CREATE INDEX ix_line_category_family ON line_category (family, sort_order, category_code);

-- The asset register's own class list, which is what `fixed_asset.category_code`
-- has been reaching into the chart for. `kind` is the four shapes the client's
-- chart actually distinguishes: plant and equipment, the operating equipment
-- that carries a replacement reserve instead of depreciation, intangibles, and
-- deferred cost (pre-opening).
CREATE TABLE asset_class (
    class_code TEXT PRIMARY KEY CHECK (class_code ~ '^[A-Z][A-Z0-9_]*$'),
    name       TEXT NOT NULL CHECK (btrim(name) <> ''),
    name_en    TEXT,
    kind       TEXT NOT NULL CHECK (kind IN ('PPE', 'OE', 'INTANGIBLE', 'DEFERRED')),
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    -- Every class here IS one of the client's asset sub-types, so unlike a
    -- category this is never NULL.
    legacy_code TEXT NOT NULL CHECK (legacy_code ~ '^[0-9]+$')
);

INSERT INTO line_category (category_code, family, name, sort_order, legacy_code) VALUES
    ('ASURANSI_BAYAR_DIMUKA', 'prepaid_kind', 'Asuransi Bayar Dimuka', 0, '1011301001'),
    ('SEWA_TANAH_BAYAR_DIMUKA', 'prepaid_kind', 'Sewa Tanah Bayar Dimuka', 1, '1011301002'),
    ('SEWA_TOKO_BAYAR_DIMUKA', 'prepaid_kind', 'Sewa Toko Bayar Dimuka', 2, '1011301003'),
    ('SEWA_RUMAH_BAYAR_DIMUKA', 'prepaid_kind', 'Sewa Rumah Bayar Dimuka', 3, '1011301004'),
    ('KONTRAK_MAINTENANCE_BAYAR_DIMUKA', 'prepaid_kind', 'Kontrak Maintenance Bayar Dimuka', 4, '1011301005'),
    ('SEWA_KENDARAAN_BAYAR_DIMUKA', 'prepaid_kind', 'Sewa Kendaraan Bayar Dimuka', 5, '1011301006'),
    ('BIAYA_PROMOSI_BAYAR_DIMUKA', 'prepaid_kind', 'Biaya Promosi Bayar Dimuka', 6, '1011301007'),
    ('BIAYA_IJIN_USAHA_BAYAR_DIMUKA', 'prepaid_kind', 'Biaya Ijin Usaha Bayar Dimuka', 7, '1011301008'),
    ('BIAYA_BAYAR_DIMUKA_LAIN_LAIN', 'prepaid_kind', 'Biaya Bayar Dimuka Lain Lain', 8, '1011301009'),
    ('ADVANCED_TRAVELLING', 'advance_purpose', 'Advanced - Travelling', 9, '1011303001'),
    ('ADVANCED_PURCHASE', 'advance_purpose', 'Advanced  - Purchase', 10, '1011303002'),
    ('ADVANCED_TO_CONTRACTORS', 'advance_purpose', 'Advanced  - To Contractors', 11, '1011303003'),
    ('ADVANCED_OTHERS', 'advance_purpose', 'Advanced  - Others', 12, '1011303004'),
    ('BIAYA_GAJI_DAN_UPAH_YMHD', 'accrual_kind', 'Biaya Gaji dan Upah YMHD', 13, '2012201001'),
    ('THR_INSENTIF_BONUS_PESANGON_YMHD', 'accrual_kind', 'THR/Insentif/Bonus/Pesangon YMHD', 14, '2012201002'),
    ('BIAYA_BUNGA_PINJAMAN_YMHD', 'accrual_kind', 'Biaya Bunga Pinjaman YMHD', 15, '2012201003'),
    ('BIAYA_PENGOBATAN_YMHD', 'accrual_kind', 'Biaya Pengobatan  YMHD', 16, '2012201004'),
    ('BIAYA_ASURANSI_DAN_BPJS_YMHD', 'accrual_kind', 'Biaya Asuransi dan BPJS YMHD', 17, '2012201005'),
    ('BIAYA_TELEPHONE_FAX_MODEM_YMHD', 'accrual_kind', 'Biaya Telephone, Fax, Modem YMHD', 18, '2012201006'),
    ('BIAYA_PEMAKAIAN_LISTRIK_YMHD', 'accrual_kind', 'Biaya Pemakaian Listrik YMHD', 19, '2012201007'),
    ('BIAYA_PEMAKAIAN_AIR_BERSIH_YMHD', 'accrual_kind', 'Biaya Pemakaian Air Bersih YMHD', 20, '2012201008'),
    ('BIAYA_SEWA_KANTOR_TOKO_YMHD', 'accrual_kind', 'Biaya Sewa Kantor / Toko YMHD', 21, '2012201009'),
    ('BIAYA_SEWA_RUMAH_MESS_YMHD', 'accrual_kind', 'Biaya Sewa Rumah / Mess YMHD', 22, '2012201010'),
    ('BIAYA_CUSTOMER_SUPPLIES', 'expense_category', 'Biaya Customer Supplies', 23, '6010110001'),
    ('BIAYA_CREDIT_CARD', 'expense_category', 'Biaya Credit Card', 24, '6010110002'),
    ('BIAYA_PROMOSI', 'expense_category', 'Biaya Promosi', 25, '6010110003'),
    ('BIAYA_DEKORASI', 'expense_category', 'Biaya Dekorasi', 26, '6010110004'),
    ('BIAYA_ADVERTISING_IKLAN', 'expense_category', 'Biaya Advertising / Iklan', 27, '6010110005'),
    ('BIAYA_BONGKAR_MUAT_BARANG', 'expense_category', 'Biaya Bongkar Muat Barang', 28, '6010110006'),
    ('BIAYA_PENGIRIMAN_BARANG_KURIR_EKSPEDISI', 'expense_category', 'Biaya Pengiriman Barang/kurir/Ekspedisi', 29, '6010110007'),
    ('BIAYA_GAJI_KARYAWAN', 'pay_component', 'Biaya Gaji Karyawan', 30, '6010111001'),
    ('BIAYA_LEMBUR', 'pay_component', 'Biaya Lembur', 31, '6010111002'),
    ('UANG_MAKAN', 'pay_component', 'Uang Makan', 32, '6010111003'),
    ('UANG_TRANSPORT', 'pay_component', 'Uang Transport', 33, '6010111004'),
    ('BIAYA_KESEHATAN_PENGOBATAN', 'pay_component', 'Biaya Kesehatan & Pengobatan', 34, '6010111005'),
    ('BIAYA_ASURANSI_PEGAWAI_BPJS', 'pay_component', 'Biaya Asuransi Pegawai / BPJS', 35, '6010111006'),
    ('TUNJANGAN_HARI_RAYA', 'pay_component', 'Tunjangan Hari Raya (THR)', 36, '6010111007'),
    ('BIAYA_UNIFORM_SERAGAM_KERJA', 'pay_component', 'Biaya Uniform / Seragam Kerja', 37, '6010111008'),
    ('BIAYA_SPORT_RECREATION', 'pay_component', 'Biaya Sport & Recreation', 38, '6010111009'),
    ('FUNERAL_CONTRIBUTION', 'pay_component', 'Funeral Contribution', 39, '6010111010'),
    ('BIAYA_MANPOWER_DEVELOPMENT', 'pay_component', 'Biaya Manpower Development', 40, '6010111011'),
    ('BIAYA_PESANGON', 'pay_component', 'Biaya Pesangon', 41, '6010111012'),
    ('KOMISI_BONUS_INSENTIF', 'pay_component', 'Komisi / Bonus / Insentif', 42, '6010111013'),
    ('BIAYA_KEBERSIHAN', 'expense_category', 'Biaya Kebersihan (Cleaning)', 43, '6010310001'),
    ('ALAT_TULIS_KANTOR_BARANG_CETAKAN', 'expense_category', 'Alat Tulis Kantor & Barang Cetakan', 44, '6010310002'),
    ('BIAYA_RUMAH_TANGGA', 'expense_category', 'Biaya Rumah Tangga', 45, '6010310003'),
    ('BIAYA_BANK_HO', 'expense_category', 'Biaya Bank HO', 46, '6010310004'),
    ('BIAYA_TELEPHONE_FACSIMILE_MODEM', 'expense_category', 'Biaya Telephone,Facsimile, Modem', 47, '6010310005'),
    ('BIAYA_PEMAKAIAN_LISTRIK', 'expense_category', 'Biaya Pemakaian Listrik', 48, '6010310006'),
    ('BIAYA_PEMAKAIAN_AIR_BERSIH', 'expense_category', 'Biaya Pemakaian Air Bersih (PDAM)', 49, '6010310007'),
    ('BIAYA_PERJALANAN_DINAS', 'expense_category', 'Biaya Perjalanan Dinas', 50, '6010310008'),
    ('BIAYA_LOKAL_TRANSPORT', 'expense_category', 'Biaya Lokal Transport', 51, '6010310009'),
    ('BIAYA_PERIJINAN', 'expense_category', 'Biaya Perijinan', 52, '6010310010'),
    ('COMPUTER_EXPENSES', 'expense_category', 'Computer Expenses', 53, '6010310011'),
    ('BIAYA_PENYISIHAN_KERUGIAN_PIUTANG', 'expense_category', 'Biaya Penyisihan Kerugian Piutang', 54, '6010310012'),
    ('BIAYA_PERLENGKAPAN_TOKO_DAN_KANTOR', 'expense_category', 'Biaya Perlengkapan Toko dan Kantor', 55, '6010310013'),
    ('BIAYA_STOCK_OPNAME', 'expense_category', 'Biaya Stock Opname', 56, '6010310014'),
    ('BIAYA_PERALATAN_LISTRIK', 'expense_category', 'Biaya Peralatan Listrik', 57, '6010310015'),
    ('TIRE_TUBES_EXPENCES', 'expense_category', 'Tire & Tubes  Expences', 58, '6010310016'),
    ('F_U_E_L_O_I_L_EXPENCES', 'expense_category', 'F u e l  & O I l  Expences', 59, '6010310017'),
    ('T_O_O_L_S_EKSPENCES', 'expense_category', 'T o o l s (Peralatan) Ekspences', 60, '6010310018'),
    ('BIAYA_LUBRICATION_GREASE_BAHAN_BAKAR_GENSET', 'expense_category', 'Biaya Lubrication & Grease, Bahan Bakar Genset', 61, '6010310019'),
    ('BIAYA_TELEPHONE_EQUIPMENT', 'expense_category', 'Biaya Telephone Equipment', 62, '6010310020'),
    ('BIAYA_DONASI', 'expense_category', 'Biaya Donasi (CSR, Zakat)', 63, '6010310021'),
    ('BIAYA_KONSULTAN', 'expense_category', 'Biaya Konsultan', 64, '6010310022'),
    ('BIAYA_LISENSI_KENDARAAN', 'expense_category', 'Biaya Lisensi Kendaraan ( STNK, Uji Kir)', 65, '6010310023'),
    ('BIAYA_PERLENGKAPAN_MESS_ATAU_RUMAH_DINAS', 'expense_category', 'Biaya Perlengkapan Mess atau Rumah Dinas', 66, '6010310024'),
    ('MISCELLANEOUS_EXPENCES', 'expense_category', 'Miscellaneous Expences', 67, '6010310099'),
    ('BIAYA_PERBAIKAN_DAN_PERAWATAN_FFE', 'expense_category', 'BIAYA PERBAIKAN DAN PERAWATAN FFE', 68, '6010410001'),
    ('SOFTWARE_MAINTENANCE', 'expense_category', 'SOFTWARE MAINTENANCE', 69, '6010410002'),
    ('BIAYA_PERBAIKAN_DAN_PERAWATAN_KOMPUTER', 'expense_category', 'BIAYA PERBAIKAN DAN PERAWATAN KOMPUTER', 70, '6010410003'),
    ('BIAYA_PERBAIKAN_DAN_PERAWATAN_BANGUNAN', 'expense_category', 'BIAYA PERBAIKAN DAN PERAWATAN BANGUNAN', 71, '6010410004'),
    ('BIAYA_PERBAIKAN_DAN_PERAWATAN_STAFF_HOUSE', 'expense_category', 'BIAYA PERBAIKAN DAN PERAWATAN STAFF HOUSE', 72, '6010410005'),
    ('BIAYA_PERBAIKAN_DAN_PERAWATAN_KENDARAAN', 'expense_category', 'BIAYA PERBAIKAN DAN PERAWATAN KENDARAAN', 73, '6010410006'),
    ('BIAYA_PERBAIKAN_DAN_PERAWATAN_AIRCONDITIONER', 'expense_category', 'BIAYA PERBAIKAN DAN PERAWATAN AIRCONDITIONER & REFRIGERATOR', 74, '6010410007'),
    ('BIAYA_POWER_PLANT', 'expense_category', 'BIAYA POWER PLANT', 75, '6010410008'),
    ('P_A_I_N_T', 'expense_category', 'P A I N T (BIAYA PENGECATAN)', 76, '6010410009'),
    ('BIAYA_PERBAIKAN_DAN_PERAWATAN_LIFT', 'expense_category', 'BIAYA PERBAIKAN DAN PERAWATAN LIFT', 77, '6010410010'),
    ('BIAYA_SEWA_TANAH', 'expense_category', 'Biaya Sewa Tanah', 78, '7010110001'),
    ('BIAYA_LAND_RIGHT', 'expense_category', 'Biaya Land Right', 79, '7010110002'),
    ('BIAYA_SEWA_BANGUNAN_TOKO_DAN_GUDANG', 'expense_category', 'Biaya Sewa Bangunan Toko dan Gudang', 80, '7010110003'),
    ('BIAYA_SEWA_RUMAH_DINAS_MESS', 'expense_category', 'Biaya Sewa Rumah Dinas / Mess', 81, '7010110004'),
    ('PROPERTY_ALL_RISK_FIRE_INSURANCE', 'expense_category', 'Property All Risk & Fire Insurance', 82, '7010310001'),
    ('BIAYA_PAJAK_BUMI_DAN_BANGUNAN', 'expense_category', 'Biaya Pajak Bumi Dan Bangunan  (PBB)', 83, '7010310002'),
    ('BIAYA_PAJAK_REKLAME', 'expense_category', 'Biaya Pajak Reklame', 84, '7020310003'),
    ('BIAYA_MANAGEMENT_FEE', 'expense_category', 'Biaya Management FEE', 85, '7020310004'),
    ('BIAYA_ASURANSI_KENDARAAN', 'expense_category', 'Biaya Asuransi Kendaraan', 86, '7020310005'),
    ('DRAWER', 'pot', 'Kas Laci', 87, NULL),
    ('PETTY', 'pot', 'Kas Kecil', 88, NULL),
    ('FLOAT', 'pot', 'Modal Kasir', 89, NULL),
    ('TRANSIT', 'pot', 'Setoran Dalam Perjalanan', 90, NULL),
    ('CASH', 'tender', 'Tunai', 91, NULL),
    ('DEBIT_BCA', 'tender', 'Debit BCA', 92, NULL),
    ('DEBIT_MANDIRI', 'tender', 'Debit Mandiri', 93, NULL),
    ('DEBIT_BRI', 'tender', 'Debit BRI', 94, NULL),
    ('DEBIT_BNI', 'tender', 'Debit BNI', 95, NULL),
    ('CREDIT_VISA', 'tender', 'Kartu Kredit VISA', 96, NULL),
    ('CREDIT_MASTER', 'tender', 'Kartu Kredit MasterCard', 97, NULL),
    ('QRIS', 'tender', 'QRIS', 98, NULL),
    ('ONLINE_OWN', 'tender', 'Online Sendiri', 99, NULL),
    ('ONLINE_MARKETPLACE', 'tender', 'Online Market Place', 100, NULL),
    ('VOUCHER', 'tender', 'Voucher', 101, NULL),
    ('TENDER_OTHER', 'tender', 'Tender Lain-lain', 102, NULL),
    ('CREDIT_CARD', 'tender', 'Kartu Kredit (tanpa rincian jaringan)', 103, NULL),
    ('DEBIT_CARD', 'tender', 'Kartu Debit (tanpa rincian bank)', 104, NULL),
    ('EMPLOYEE', 'party', 'Pegawai', 105, NULL),
    ('STORE_MANAGER', 'party', 'Kepala Toko', 106, NULL),
    ('MANAGEMENT', 'party', 'Manajemen', 107, NULL),
    ('CARD_CREDIT', 'party', 'Kartu Kredit', 108, NULL),
    ('CARD_DEBIT', 'party', 'Kartu Debit', 109, NULL),
    ('MERCHANDISE', 'item_class', 'Barang Dagangan', 110, NULL),
    ('SUPPLIES', 'item_class', 'Kantong Belanja & Perlengkapan', 111, NULL),
    ('FINANCING', 'interunit_reason', 'Pembiayaan', 112, NULL),
    ('GOODS', 'interunit_reason', 'Atas Barang', 113, NULL),
    ('INTERUNIT_OTHER', 'interunit_reason', 'Lain-lain', 114, NULL),
    ('PPH21', 'tax_kind', 'PPh Pasal 21', 115, NULL),
    ('PPH23', 'tax_kind', 'PPh Pasal 23', 116, NULL),
    ('PPH25', 'tax_kind', 'PPh Pasal 25', 117, NULL),
    ('PPH29', 'tax_kind', 'PPh Pasal 29', 118, NULL),
    ('PPH_FINAL', 'tax_kind', 'PPh Pasal 4(2) Final', 119, NULL),
    ('PPN_IN', 'tax_kind', 'PPN Masukan', 120, NULL),
    ('PPN_OUT', 'tax_kind', 'PPN Keluaran', 121, NULL),
    ('PBB', 'tax_kind', 'Pajak Bumi & Bangunan', 122, NULL),
    ('TAX_OTHER', 'tax_kind', 'Pajak Lainnya', 123, NULL),
    ('VOUCHER_LIABILITY', 'deferred_revenue_kind', 'Hutang Voucher', 124, NULL),
    ('CUSTOMER_DEPOSIT', 'deferred_revenue_kind', 'Uang Muka Penjualan', 125, NULL),
    ('DISCOUNT', 'deduction_kind', 'Discount / Potongan Penjualan', 126, NULL),
    ('RETURN', 'deduction_kind', 'Retur Penjualan', 127, NULL),
    ('INTEREST', 'income_kind', 'Pendapatan Bunga Bank', 128, NULL),
    ('ROUNDING', 'income_kind', 'Selisih Pembulatan', 129, NULL),
    ('RENT_BUILDING', 'income_kind', 'Pendapatan Sewa Gedung', 130, NULL),
    ('RENT_EQUIPMENT', 'income_kind', 'Pendapatan Sewa Peralatan', 131, NULL),
    ('MANAGEMENT_FEE', 'income_kind', 'Management Fee', 132, NULL),
    ('CASH_VARIANCE', 'income_kind', 'Selisih Kas', 133, NULL),
    ('ASSET_DISPOSAL', 'income_kind', 'Laba (Rugi) Pelepasan Aset', 134, NULL),
    ('INCOME_OTHER', 'income_kind', 'Pendapatan (Biaya) Lain-Lain', 135, NULL),
    ('COGS', 'cost_kind', 'Harga Pokok Pembelian', 136, NULL),
    ('PURCHASE_DISCOUNT', 'cost_kind', 'Potongan Pembelian', 137, NULL),
    ('SHRINKAGE', 'loss_kind', 'Kehilangan Barang atau Selisih Stock Opname', 138, NULL),
    ('DAMAGE', 'loss_kind', 'Biaya Kerusakan Persediaan Barang Dagangan', 139, NULL);

INSERT INTO asset_class (class_code, name, kind, legacy_code) VALUES
    ('TANAH_HAK_MILIK', 'Tanah Hak Milik', 'PPE', '1021501001'),
    ('HAK_SEWA_TANAH_HGB', 'Hak Sewa Tanah / HGB', 'PPE', '1021501002'),
    ('BANGUNAN_UTAMA', 'Bangunan Utama', 'PPE', '1021502001'),
    ('BANGUNAN_TAMBAHAN', 'Bangunan Tambahan', 'PPE', '1021502002'),
    ('BANGUNAN_STAFF_HOUSE_MESS', 'Bangunan Staff House / Mess', 'PPE', '1021502003'),
    ('INSTALASI_MEKANIKAL_ELEKTRIKAL', 'Instalasi Mekanikal Elektrikal', 'PPE', '1021503001'),
    ('AIR_CONDITIONER', 'Air Conditioner', 'PPE', '1021504001'),
    ('LIFT', 'Lift', 'PPE', '1021504002'),
    ('ESKALATOR', 'Eskalator', 'PPE', '1021504003'),
    ('GENSET', 'Genset', 'PPE', '1021504004'),
    ('MOBIL', 'Mobil', 'PPE', '1021505001'),
    ('SEPEDA_MOTOR', 'Sepeda Motor', 'PPE', '1021505002'),
    ('FFE_OFFICE', 'FFE Office', 'PPE', '1021506001'),
    ('FFE_TOKO_DAN_GUDANG', 'FFE Toko dan Gudang', 'PPE', '1021506002'),
    ('FFE_KOMPUTER', 'FFE Komputer', 'PPE', '1021506003'),
    ('FFE_MUSIC', 'FFE Music', 'PPE', '1021506004'),
    ('FFE_STAFF_HOUSE_MESS', 'FFE Staff House / Mess', 'PPE', '1021506005'),
    ('FFE_INTERIOR', 'FFE Interior', 'PPE', '1021506006'),
    ('FFE_EXTERIOR', 'FFE Exterior', 'PPE', '1021506007'),
    ('OE_RAK_1', 'OE - Rak 1', 'OE', '1021507001'),
    ('OE_RAK_2', 'OE - Rak 2', 'OE', '1021507002'),
    ('OE_RAK_3', 'OE - Rak 3', 'OE', '1021507003'),
    ('OE_RAK_4', 'OE - Rak 4', 'OE', '1021507004'),
    ('OE_PAJANGAN_GANTUNGAN_2', 'OE - Pajangan Gantungan 2', 'OE', '1021507005'),
    ('OE_PAJANGAN_GANTUNGAN_4', 'OE - Pajangan Gantungan 4', 'OE', '1021507006'),
    ('OE_PAJANGAN_GANTUNGAN_6', 'OE - Pajangan Gantungan 6', 'OE', '1021507007'),
    ('OE_PAJANGAN_GANTUNGAN_LAIN_LAIN', 'OE - Pajangan Gantungan Lain - Lain', 'OE', '1021507008'),
    ('OE_MEJA_1', 'OE - Meja 1', 'OE', '1021507009'),
    ('OE_MEJA_2', 'OE - Meja 2', 'OE', '1021507010'),
    ('OE_MEJA_3', 'OE - Meja 3', 'OE', '1021507011'),
    ('OE_BOX_OB_KAYU', 'OE - Box OB Kayu', 'OE', '1021507012'),
    ('OE_BOX_OB_BESI', 'OE - Box OB Besi', 'OE', '1021507013'),
    ('OE_HOLO', 'OE - Holo', 'OE', '1021507014'),
    ('OE_BREKET', 'OE - Breket', 'OE', '1021507015'),
    ('OE_BELALAI', 'OE - Belalai', 'OE', '1021507016'),
    ('OE_PATUNG_FULL_BODI_DEWASA', 'OE - Patung Full Bodi Dewasa', 'OE', '1021507017'),
    ('OE_PATUNG_FULL_BODI_ANAK', 'OE - Patung Full Bodi Anak', 'OE', '1021507018'),
    ('OE_PATUNG_SETENGAH_BADAN_PRIA', 'OE - Patung  Setengah Badan Pria', 'OE', '1021507019'),
    ('OE_PATUNG_SETENGAH_BADAN_WANITA_1', 'OE - Patung  Setengah Badan  Wanita 1', 'OE', '1021507020'),
    ('OE_PATUNG_SETENGAH_BADAN_WANITA_2', 'OE - Patung  Setengah Badan  Wanita 2', 'OE', '1021507021'),
    ('OE_PATUNG_SETENGAH_BADAN_ANAK', 'OE - Patung  Setengah Badan Anak', 'OE', '1021507022'),
    ('OE_PATUNG_KEPALA_DEWASA', 'OE - Patung  Kepala  Dewasa', 'OE', '1021507023'),
    ('OE_PATUNG_KEPALA_ANAK', 'OE - Patung  Kepala  Anak', 'OE', '1021507024'),
    ('OE_PATUNG_KAKI_DEWASA', 'OE - Patung  Kaki Dewasa', 'OE', '1021507025'),
    ('OE_PATUNG_KAKI_ANAK', 'OE - Patung  Kaki Anak', 'OE', '1021507026'),
    ('OE_HANGER_WANITA_ABG', 'OE - Hanger Wanita / ABG', 'OE', '1021507027'),
    ('OE_HANGER_PRIA', 'OE - Hanger  Pria', 'OE', '1021507028'),
    ('OE_HANGER_JACKET', 'OE - Hanger Jacket', 'OE', '1021507029'),
    ('OE_HANGER_KAYU_ANAK', 'OE - Hanger Kayu Anak', 'OE', '1021507030'),
    ('OE_HANGER_BODY_STELAN', 'OE - Hanger Body / Stelan', 'OE', '1021507031'),
    ('OE_HANGER_JEPIT_DEWASA', 'OE - Hanger Jepit Dewasa', 'OE', '1021507032'),
    ('OE_HANGER_JEPIT_ANAK', 'OE - Hanger Jepit Anak', 'OE', '1021507033'),
    ('OE_HANGER_GAMIS_IBU', 'OE - Hanger Gamis / Ibu', 'OE', '1021507034'),
    ('OE_PIN_KAWAT_SENSOR', 'OE - PIN / Kawat Sensor', 'OE', '1021507035'),
    ('OE_TAS_KERANJANG_BELANJA', 'OE - Tas / Keranjang Belanja', 'OE', '1021507036'),
    ('SEVENTH_SOFT_APPLICATION', 'Seventh Soft Application', 'INTANGIBLE', '1021701001'),
    ('OPTI_TEX_SYSTEM', 'Opti Tex System', 'INTANGIBLE', '1021701002'),
    ('PRE_OPENING', 'Pre Opening', 'DEFERRED', '1031802001'),
    ('CONTRACT_IN_PROGRESS', 'Contract In Progress (CIP)', 'PPE', '1031803001');

DO $$
DECLARE
    categories INTEGER;
    families   INTEGER;
    classes    INTEGER;
BEGIN
    SELECT count(*), count(DISTINCT family) INTO categories, families FROM line_category;
    SELECT count(*) INTO classes FROM asset_class;
    IF categories <> 140 OR families <> 16 THEN
        RAISE EXCEPTION 'expected 140 categories in 16 families, got % in %', categories, families;
    END IF;
    IF classes <> 59 THEN
        RAISE EXCEPTION 'expected 59 asset classes, got %', classes;
    END IF;
END $$;
