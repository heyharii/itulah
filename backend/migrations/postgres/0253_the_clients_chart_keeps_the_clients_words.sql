-- 0253: The client's chart keeps the client's words.
--
-- # The rule
--
-- We may not invent accounts CENTRAL FASHION STORE does not have, and we may
-- not rename the ones they do. Their chart is the authority — its SHOUTING,
-- its English-Indonesian mixture, its double spaces and its typos included.
-- The owner ruled it after finding `1021401001 Rekening Koran Antar-Unit` in
-- our chart, a name that exists nowhere in theirs, sitting on a code of theirs
-- that reads `Piutang Affiliasi Pembiayaan HEAD OFFICE`.
--
-- The ruling has two halves, and the second one narrows the first:
--
--   * do not translate, and do not change the WORDS;
--   * case, whitespace and punctuation are free — `LAIN - LAIN` and
--     `Lain-lain` are the same name and neither is worth a migration.
--
-- So the test is mechanical and it is asserted at the bottom of this file
-- rather than eyeballed: strip every non-alphanumeric character from both
-- names, lowercase them, and they must be equal.
--
-- One thing the client's chart does that we do NOT copy: truncate words.
-- `Akum-Penyusu`, `Acc Amort`, `Cad,`, `YMHD`, `PJP`, `OE`, `BDP`, `FFE` and
-- `HO` are spelled out, because completing a shortened word is neither
-- translating it nor changing it. Names that are already whole are untouched,
-- and acronyms that are not shortened words stay: bank names (BCA, Mandiri,
-- BRI, BNI, BTN, Danamon), tax names (PPN, PPh, PBB, VAT), institutions
-- (BPJS, PDAM), STNK, KIR, CSR, HGB and CIP.
--
-- # What this migration does
--
--   177 names get the client's words back. Most are the wholesale translation
--       0243 applied — `ASSET` -> `ASET`, `CASH ON HAND` -> `Kas di Tangan`,
--       `Cash In Bank Giro Bank BCA` -> `Bank BCA — Giro`. Ten of them kept
--       the client's code and changed what it MEANS, which is worse because
--       nothing looks changed:
--
--         4010110001  Penjualan Tunai                        was Penjualan Barang Dagangan
--         5010110001  Harga Pokok Pembelian                  was Harga Pokok Penjualan
--         1021401001  Piutang Affiliasi Pembiayaan HEAD OFFICE  was Rekening Koran Antar-Unit
--         1021507001  Operating Equipment - Rak 1            was Operating Equipment
--         1021504001  Air Conditioner                        was Mesin & Peralatan
--         1021505001  Mobil                                  was Kendaraan
--         1021701001  Seventh Soft Application               was Perangkat Lunak
--         1011202001  Kantong Belanja  Plastik Ukuran KECIL  was Persediaan Perlengkapan Toko
--         402         MANAGEMENT FEE                         was Pendapatan Lain-lain
--         80101       PENDAPATAN DAN (BIAYA) LAIN - LAIN     was Beban Lain-lain
--
--    40 names have a truncation spelled out. Ten of those needed nothing else
--       — `Akum-Penyusu - Mesin` was already the client's words and is now
--       `Akumulasi-Penyusutan - Mesin`.
--
--    99 names are left exactly as they are, because they already pass the
--       test. Restoring `PENDAPATAN DAN (BIAYA) LAIN - LAIN` over
--       `Pendapatan dan (Biaya) Lain-lain` is work the owner has said is
--       unnecessary.
--
--       177 and 40 overlap on 30 accounts, so 187 names change in all: 185 by
--       the UPDATE in step three and two more that take the client's name as
--       they move in step two.
--
--   212 `name_en` values are dropped to NULL on every account whose code is
--       the client's — 209 in place and three carried over as NULL by a
--       relocation — for the reason 0247 gave when it left all 79 of its own
--       rungs untranslated: an English name for a client account is OURS. The
--       seven accounts that are ours keep theirs. Nothing reads the column.
--
-- # Codes the client does not have
--
-- Twenty. Four of them are accounts we minted because the client's chart has
-- no place for the thing, and they stay — marked `"ours": true` in
-- `docs/fixtures/coa-final.json` so that the next reader can tell them from
-- the client's at a glance:
--
--     1011005001  Setoran Dalam Perjalanan   money that has left the drawer and
--                                            not yet landed at the bank
--     8010110008  Selisih Kas                what a physical drawer count finds
--     1011101003  Piutang QRIS               0248; their chart predates QRIS
--     1011101004  Piutang Tender Lain-Lain   0248; an unnamed counter tender
--
-- There is a FIFTH, and it is a group rather than an account: `1011005`, the
-- rung 0247 had to mint to hang `1011005001` off. It is ours for the same
-- reason and by the same authority, and it is named after its only child.
--
-- The other fifteen are the client's own meanings that 0243/0244 filed under a
-- code of our choosing. Three go back:
--
--     1021508001 -> 1031803001   Contract In Progress (CIP), under Other Assets
--                                where the client files it. `backend/tests/
--                                asset_banking_integration.rs` already expects
--                                this code for `work_in_progress`.
--     4020210001 -> 8010110001   Pendapatan Bunga Bank
--     4020210009 -> 8010110007   Pendapatan (Biaya) Lain-Lain
--
-- and six do not. Each refusal is a case of "do not force it", and the reason
-- is written here rather than worked around:
--
--   * `2012401001 Uang Muka Penjualan & Voucher` belongs at the client's
--     `205001`, which is SIX digits. 0247's ladder is 1 -> 3 -> 5 -> 7 -> 10
--     and a posting must hang off a seven-digit family; `205001` would need
--     `205`, `2050` and `20500`, none of which the client has, so putting it
--     back means inventing three codes to undo one. It also now carries
--     voucher liability, which `205001` never did. It stays where it is.
--
--   * `4020210002 Potongan Pembelian` belongs at the client's `8010110003` and
--     the ladder would take it happily. It carries five journal lines and
--     Rp 8,877,350 of credit, and moving it would show up as a changed trial
--     balance per account — the one thing this migration promises not to do.
--     It is the only relocation blocked by money rather than by the chart, and
--     it is the one to ask the owner about.
--
--   * `4020210003 Pendapatan Sewa` is TWO of the client's accounts folded into
--     one: `8010110004 Pendapatan Sewa Gedung` and `8010110005 Pendapatan Sewa
--     Peralatan`. Either code would be the client's code under a meaning the
--     client does not give it, which is the defect this migration exists to
--     undo. It stays, and it stays named `Pendapatan Sewa` — ours, on a code
--     of ours, saying exactly what it holds.
--
--   * `7010310003/4/5` (Pajak Reklame, Management Fee, Asuransi Kendaraan)
--     belong at the client's `7020310003/4/5`. The client's `7020310` family
--     hangs off a `70203` group that does not exist in their chart, and
--     neither does `702`; 0244 moved the three onto `7010310` for exactly that
--     reason. Putting them back means minting two codes the client does not
--     have. They stay — but they take the client's WORDS, since each is a
--     faithful one-to-one carrier of one client account.
--
-- # Nothing moves
--
-- Not one `journal_line` row is written. The three relocations are refused
-- outright, loudly, if the account being moved has any posting against it, so
-- "no money moves" is structural rather than promised. The trial balance per
-- account and per site is snapshotted before and compared after, inside this
-- transaction, exactly as 0247 does it, and all five of 0247's ladder
-- invariants are re-asserted at the end.
--
-- # Re-running it
--
-- Idempotent. The name update is a no-op once the names pass the test, and
-- each relocation is skipped when its source account is already gone.

-- ---------------------------------------------------------------------------
-- Step zero: the trial balance, before
-- ---------------------------------------------------------------------------

CREATE TEMPORARY TABLE coa_words_before ON COMMIT DROP AS
SELECT account_code, site_id,
       sum(debit_minor) AS debit_minor, sum(credit_minor) AS credit_minor
  FROM journal_line
 GROUP BY 1, 2;

-- ---------------------------------------------------------------------------
-- Step one: the client's own names
-- ---------------------------------------------------------------------------
--
-- `client_name` is read out of `~/Downloads/Laporan_Master_Account1.csv`, the
-- same export `scripts/import-coa.py` loaded, with only the export's own
-- column padding taken off the ends — every double space INSIDE a name is the
-- client's and is kept. Where a twelve-digit leaf collapsed onto its
-- ten-digit template, the template's own row is the one read.
--
-- `written_as` is NULL unless a truncated word had to be spelled out, and then
-- it sits beside the client's own spelling so the difference is readable here
-- rather than inferred from the database.

CREATE TEMPORARY TABLE coa_client_name (
    account_code text PRIMARY KEY,
    client_name  text NOT NULL,
    written_as   text
) ON COMMIT DROP;

INSERT INTO coa_client_name (account_code, client_name, written_as) VALUES
  ('1', 'ASSET', NULL),
  ('2', 'LIABILITIES', NULL),
  ('3', 'MODAL', NULL),
  ('4', 'PENDAPATAN', NULL),
  ('5', 'BIAYA / BEBAN POKOK', NULL),
  ('6', 'BIAYA / BEBAN  USAHA', NULL),
  ('7', 'BEBAN USAHA LAINNYA', NULL),
  ('8', 'BEBAN  NON OPERASIONAL', NULL),
  ('101', 'CURRENT ASSET', NULL),
  ('102', 'NON CURRENT ASSET', NULL),
  ('103', 'OTHER ASSETS', NULL),
  ('201', 'HUTANG JANGKA PENDEK', NULL),
  ('202', 'PINJAMAN JANGKA PANJANG', NULL),
  ('301', 'MODAL', NULL),
  ('401', 'PENJUALAN', NULL),
  ('402', 'MANAGEMENT FEE', NULL),
  ('501', 'HARGA POKOK PEMBELIAN', NULL),
  ('601', 'BIAYA / BEBAN  USAHA', NULL),
  ('701', 'BEBAN USAHA LAINNYA', NULL),
  ('801', 'PENDAPATAN DAN (BIAYA) LAIN - LAIN', NULL),
  ('802', 'BIAYA BUNGA', NULL),
  ('803', 'PAJAK PENGHASILAN', NULL),
  ('10110', 'KAS & SETARA KAS', NULL),
  ('10111', 'PIUTANG', NULL),
  ('10112', 'INVENTORY', NULL),
  ('10113', 'PREPAID', NULL),
  ('10214', 'PIUTANG  AFFILIASI ANTAR UNIT', NULL),
  ('10215', 'AKTIVA TETAP', NULL),
  ('10216', 'AKUMULASI PENYUSUTAN AKTIVA TETAP', NULL),
  ('10217', 'INTANGIBLE ASSET', NULL),
  ('10318', 'Other Asset', NULL),
  ('20120', 'HUTANG DAGANG', NULL),
  ('20121', 'HUTANG PAJAK', NULL),
  ('20122', 'ACCRUED EXPENSE (BIAYA YANG MASIH HARUS DIBAYAR)', NULL),
  ('20123', 'HUTANG LAIN-LAIN', NULL),
  ('20125', 'PINJAMAN JANGKA PANJANG JATUH TEMPO', NULL),
  ('20224', 'PINJAMAN JANGKA PANJANG', NULL),
  ('30130', 'MODAL', NULL),
  ('40101', 'PENJUALAN', NULL),
  ('40102', 'DISCOUNT / POTONGAN DAN RETURN PENJUALAN', NULL),
  ('40201', 'MANAGEMENT FEE', NULL),
  ('50101', 'HARGA POKOK PEMBELIAN', NULL),
  ('60101', 'BEBAN PENJUALAN', NULL),
  ('60102', 'BEBAN PEGAWAI', NULL),
  ('60103', 'BEBAN ADMINISTRASI DAN UMUM', NULL),
  ('60104', 'BEBAN PERAWATAN DAN PEMELIHARAAN', NULL),
  ('70101', 'BIAYA SEWA', NULL),
  ('70102', 'BIAYA DEPRESIASI DAN AMORTISASI', NULL),
  ('70103', 'BIAYA USAHA LAINNYA', NULL),
  ('80101', 'PENDAPATAN DAN (BIAYA) LAIN - LAIN', NULL),
  ('80201', 'BIAYA BUNGA', NULL),
  ('80301', 'PAJAK PENGHASILAN', NULL),
  ('1011001', 'CASH ON HAND', NULL),
  ('1011002', 'CASH IN BANK GIRO', NULL),
  ('1011003', 'CASH IN BANK TABUNGAN', NULL),
  ('1011004', 'TIME DEPOSIT', NULL),
  ('1011101', 'PIUTANG DAGANG', NULL),
  ('1011102', 'PIUTANG LAIN-LAIN', NULL),
  ('1011103', 'CADANGAN PENGHAPUSAN PIUTANG TAK TERTAGIH', NULL),
  ('1011201', 'Persediaan Barang Dagang', NULL),
  ('1011202', 'Persediaan Kantong Belanja', NULL),
  ('1011203', 'Barang Dalam Perjalanan Barang Dagangan', NULL),
  ('1011204', 'Barang Dalam Perjalanan Kantong Belanja', NULL),
  ('1011299', 'Cadangan Kerusakan atau kehilangan Barang', NULL),
  ('1011301', 'BIAYA DIBAYAR DIMUKA', NULL),
  ('1011302', 'PAJAK BAYAR DIMUKA/PREPAID TAX', NULL),
  ('1011303', 'UANG MUKA / ADVANCED', NULL),
  ('1021401', 'PIUTANG  AFFILIASI PEMBIAYAAN', NULL),
  ('1021501', 'Tanah', NULL),
  ('1021502', 'Bangunan', NULL),
  ('1021503', 'Instalasi', NULL),
  ('1021504', 'Machineries', NULL),
  ('1021505', 'Kendaraan', NULL),
  ('1021506', 'Furniture, Fixture  & Equipment', NULL),
  ('1021507', 'Operating Equipment', NULL),
  ('1021601', 'Akumulasi Penyusu -Tanah', 'Akumulasi Penyusutan -Tanah'),
  ('1021602', 'Akum-Penyusu - Bangunan', 'Akumulasi-Penyusutan - Bangunan'),
  ('1021603', 'Akum-Penyusu - Instalasi', 'Akumulasi-Penyusutan - Instalasi'),
  ('1021604', 'Akum-Penyusu - Mesin', 'Akumulasi-Penyusutan - Mesin'),
  ('1021605', 'Akum-Penyusu Kendaraan', 'Akumulasi-Penyusutan Kendaraan'),
  ('1021606', 'Akum-Penyusu - FFE', 'Akumulasi-Penyusutan - Furniture, Fixture & Equipment'),
  ('1021607', 'Reserve Replacement - Operating Equipment', NULL),
  ('1021701', 'Software', NULL),
  ('1021702', 'Acc Amort Software', 'Akumulasi Amortisasi Software'),
  ('1031801', 'Disposed Inventory', NULL),
  ('1031802', 'Pre Opening', NULL),
  ('1031803', 'Contract In Progress (CIP)', NULL),
  ('2012001', 'HUTANG SUPPLIER', NULL),
  ('2012002', 'OUTSTANDING GIRO', NULL),
  ('2012101', 'HUTANG PAJAK', NULL),
  ('2012201', 'ACCRUED EXPENSE (BIAYA YANG MASIH HARUS DIBAYAR)', NULL),
  ('2012303', 'HUTANG LAIN-LAIN PRINCIPAL', NULL),
  ('2012501', 'PJP JATUH TEMPO - PRINCIPAL', 'PINJAMAN JANGKA PANJANG JATUH TEMPO - PRINCIPAL'),
  ('2012502', 'PJP JATUH TEMPO - BANK', 'PINJAMAN JANGKA PANJANG JATUH TEMPO - BANK'),
  ('2022401', 'Pinjaman Jangka Panjang  Principal', NULL),
  ('2022402', 'Pinjaman Jangka Panjang  Bank', NULL),
  ('3013001', 'MODAL', NULL),
  ('4010110', 'Penjualan Tunai', NULL),
  ('4010213', 'Discount / Potongan Penjualan', NULL),
  ('4010214', 'Retur Penjualan', NULL),
  ('4020110', 'Management  Fee', NULL),
  ('5010110', 'HARGA POKOK PEMBELIAN', NULL),
  ('6010110', 'BIAYA  PENJUALAN', NULL),
  ('6010210', 'BEBAN PEGAWAI OFFICE', NULL),
  ('6010310', 'BIAYA ADMINISTRASI DAN UMUM', NULL),
  ('6010410', 'BIAYA PERAWATAN DAN PEMELIHARAAN', NULL),
  ('7010110', 'BIAYA SEWA', NULL),
  ('7010210', 'BIAYA DEPRESIASI BANGUNAN', NULL),
  ('7010211', 'BIAYA DEPRESIASI INSTALASI, MEKANIKAL, ELEKTRIKAL', NULL),
  ('7010212', 'BIAYA DEPRESIASI  MESIN', NULL),
  ('7010213', 'BIAYA DEPRESIASI KENDARAAN', NULL),
  ('7010214', 'BIAYA DEPRESIASI FFE', 'BIAYA DEPRESIASI FURNITURE, FIXTURE & EQUIPMENT'),
  ('7010215', 'BIAYA REPLACEMENT OPERATING EQUIPMENT', NULL),
  ('7010216', 'BIAYA AMORTISASI INTANGIBLE ASSET AND OTHER ASSET', NULL),
  ('8010110', 'PENDAPATAN DAN (BIAYA) LAIN - LAIN', NULL),
  ('8020111', 'BIAYA BUNGA', NULL),
  ('8030112', 'PAJAK PENGHASILAN', NULL),
  ('1011001001', 'CASH ON HAND', NULL),
  ('1011001002', 'PETTY CASH', NULL),
  ('1011001003', 'MODAL KASIR', NULL),
  ('1011002001', 'Cash In Bank Giro Bank BCA', NULL),
  ('1011002002', 'Cash In Bank Giro Bank MANDIRI', NULL),
  ('1011002003', 'Cash In Bank Giro Bank BRI', NULL),
  ('1011002004', 'Cash In Bank Giro Bank BNI', NULL),
  ('1011002005', 'Cash In Bank Giro Bank DANAMON', NULL),
  ('1011003001', 'Cash In Bank Tabungan Bank BCA', NULL),
  ('1011003002', 'Cash In Bank Tabungan Bank Mandiri', NULL),
  ('1011003003', 'Cash In Bank Tabungan Bank BRI', NULL),
  ('1011003004', 'Cash In Bank Tabungan Bank BNI', NULL),
  ('1011003005', 'Cash In Bank Tabungan Bank BTN', NULL),
  ('1011004001', 'TIME DEPOSIT BANK BCA', NULL),
  ('1011004002', 'TIME DEPOSIT BANK MANDIRI', NULL),
  ('1011004003', 'TIME DEPOSIT BANK BRI', NULL),
  ('1011004004', 'TIME DEPOSIT BANK BNI', NULL),
  ('1011101001', 'Piutang kartu Kredit', NULL),
  ('1011101002', 'Piutang Debit Card', NULL),
  ('1011102001', 'PIUTANG PEGAWAI', NULL),
  ('1011102002', 'PIUTANG KEPALA TOKO', NULL),
  ('1011102003', 'PIUTANG MANAJEMEN', NULL),
  ('1011103001', 'Cad, Penghapusan Piutang Tak Tertagih, Piutang Kartu Kredit', 'Cadangan, Penghapusan Piutang Tak Tertagih, Piutang Kartu Kredit'),
  ('1011201001', 'Persediaan Barang Dagangan', NULL),
  ('1011202001', 'Kantong Belanja  Plastik Ukuran KECIL', NULL),
  ('1011203001', 'BDP Barang Dagangan HEAD OFFICE', 'Barang Dalam Perjalanan Barang Dagangan HEAD OFFICE'),
  ('1011204001', 'BDP Kantong Belanja HEAD OFFICE', 'Barang Dalam Perjalanan Kantong Belanja HEAD OFFICE'),
  ('1011299001', 'Cadangan Kerusakan atau kehilangan Barang - Barang Dagangan', NULL),
  ('1011301001', 'Asuransi Bayar Dimuka', NULL),
  ('1011301002', 'Sewa Tanah Bayar Dimuka', NULL),
  ('1011301005', 'Kontrak Maintenance Bayar Dimuka', NULL),
  ('1011301007', 'Biaya Promosi Bayar Dimuka', NULL),
  ('1011301008', 'Biaya Ijin Usaha Bayar Dimuka', NULL),
  ('1011301009', 'Biaya Bayar Dimuka Lain Lain', NULL),
  ('1011302001', 'Prepaid - PPh Pasal 21', NULL),
  ('1011302002', 'Prepaid - PPh Pasal 25', NULL),
  ('1011302003', 'Prepaid - PPh Pasal 29', NULL),
  ('1011302004', 'Prepaid - VAT (PPN Masukan)', NULL),
  ('1011302005', 'Prepaid - Land Tax (PBB)', NULL),
  ('1011302006', 'Prepaid - Other Tax', NULL),
  ('1011303001', 'Advanced - Travelling', NULL),
  ('1011303002', 'Advanced  - Purchase', NULL),
  ('1011303003', 'Advanced  - To Contractors', NULL),
  ('1011303004', 'Advanced  - Others', NULL),
  ('1021401001', 'Piutang Affiliasi Pembiayaan HEAD OFFICE', NULL),
  ('1021501001', 'Tanah Hak Milik', NULL),
  ('1021501002', 'Hak Sewa Tanah / HGB', NULL),
  ('1021502001', 'Bangunan Utama', NULL),
  ('1021503001', 'Instalasi Mekanikal Elektrikal', NULL),
  ('1021504001', 'Air Conditioner', NULL),
  ('1021505001', 'Mobil', NULL),
  ('1021506001', 'FFE Office', 'Furniture, Fixture & Equipment Office'),
  ('1021507001', 'OE - Rak 1', 'Operating Equipment - Rak 1'),
  ('1021601002', 'Akumulasi Penyusu - Hak  Pengelolaan Tanah (Land Right) / HGB', 'Akumulasi Penyusutan - Hak  Pengelolaan Tanah (Land Right) / HGB'),
  ('1021602001', 'Akum Penyusu - Bangunan Utama', 'Akumulasi Penyusutan - Bangunan Utama'),
  ('1021603001', 'Akum - Penyusu - Instalasi - Mekanikal  Electrical', 'Akumulasi - Penyusutan - Instalasi - Mekanikal  Electrical'),
  ('1021604001', 'Akum-Penyu Mesin - Air Conditioner', 'Akumulasi-Penyusutan Mesin - Air Conditioner'),
  ('1021605001', 'Akum Penyusutan - Mobil', 'Akumulasi Penyusutan - Mobil'),
  ('1021606001', 'Akum Penyusu - FFE Office', 'Akumulasi Penyusutan - Furniture, Fixture & Equipment Office'),
  ('1021607001', 'Reserve Replacement OE- Rak 1', 'Reserve Replacement Operating Equipment- Rak 1'),
  ('1021701001', 'Seventh Soft Application', NULL),
  ('1021702001', 'Acc Amort Sevent Soft Application', 'Akumulasi Amortisasi Seventh Soft Application'),
  ('1031801001', 'Disposed Inventory', NULL),
  ('1031802001', 'Pre Opening', NULL),
  ('1031802002', 'Akumulasi Amortisasi Pre Opening', NULL),
  ('1031803001', 'Contract In Progress (CIP)', NULL),
  ('2012001001', 'Hutang Suppliers  Barang Dagangan', NULL),
  ('2012001002', 'Hutang Supplier Barang Dagang - Suspend', NULL),
  ('2012001003', 'Hutang Supplier  Non Barang Dagang', NULL),
  ('2012002001', 'Outstanding Giro Bank BCA', NULL),
  ('2012101001', 'Hutang Pajak PPH Pasal 21', NULL),
  ('2012101002', 'Hutang Pajak PPH Pasal 23 (withold)', 'Hutang Pajak PPH Pasal 23 (withhold)'),
  ('2012101003', 'Hutang  VAT PPN Keluaran', NULL),
  ('2012101004', 'Hutang Pajak Bumi & Bangunan', NULL),
  ('2012101005', 'Hutang Pajak PPH Pasal 25', NULL),
  ('2012201001', 'Biaya Gaji dan Upah YMHD', 'Biaya Gaji dan Upah Yang Masih Harus Dibayar'),
  ('2012201003', 'Biaya Bunga Pinjaman YMHD', 'Biaya Bunga Pinjaman Yang Masih Harus Dibayar'),
  ('2012201006', 'Biaya Telephone, Fax, Modem YMHD', 'Biaya Telephone, Fax, Modem Yang Masih Harus Dibayar'),
  ('2012201009', 'Biaya Sewa Kantor / Toko YMHD', 'Biaya Sewa Kantor / Toko Yang Masih Harus Dibayar'),
  ('2012303001', 'Hutang Lain-lain Principal HEAD OFFICE', NULL),
  ('2012501001', 'PJP Jatuh Tempo - Principal', 'Pinjaman Jangka Panjang Jatuh Tempo - Principal'),
  ('2012502001', 'PJP Jatuh Tempo  Bank BCA', 'Pinjaman Jangka Panjang Jatuh Tempo  Bank BCA'),
  ('2022401001', 'Pinjaman Jangka Panjang  Principal', NULL),
  ('2022402001', 'Pinjaman Jangka Panjang  Bank BCA', NULL),
  ('3013001001', 'Modal Setor', NULL),
  ('3013001002', 'Laba (Rugi) Ditahan', NULL),
  ('3013001003', 'Laba (Rugi) bulan berjalan', NULL),
  ('3013001004', 'Prive', NULL),
  ('4010110001', 'Penjualan Tunai', NULL),
  ('4010213001', 'Discount / Potongan Penjualan', NULL),
  ('4010214001', 'Retur Penjualan', NULL),
  ('4020110001', 'Management  Fee', NULL),
  ('5010110001', 'Harga Pokok Pembelian', NULL),
  ('6010110001', 'Biaya Customer Supplies', NULL),
  ('6010110002', 'Biaya Credit Card', NULL),
  ('6010110003', 'Biaya Promosi', NULL),
  ('6010110004', 'Biaya Dekorasi', NULL),
  ('6010110005', 'Biaya Advertising / Iklan', NULL),
  ('6010110006', 'Biaya Bongkar Muat Barang', NULL),
  ('6010110007', 'Biaya Pengiriman Barang/kurir/Ekspedisi', NULL),
  ('6010110008', 'Biaya  Kerusakan Persediaan Barang Dagangan', NULL),
  ('6010210001', 'Biaya Gaji Pegawai', NULL),
  ('6010210002', 'Biaya Lembur', NULL),
  ('6010210003', 'Uang Makan', NULL),
  ('6010210004', 'Uang Transpot', 'Uang Transport'),
  ('6010210005', 'Biaya Kesehatan & Pengobatan', NULL),
  ('6010210006', 'Biaya Asuransi Pegawai / BPJS', NULL),
  ('6010210007', 'Tunjangan Hari Raya (THR)', NULL),
  ('6010210008', 'Biaya Uniform / Seragam Kerja', NULL),
  ('6010210009', 'Biaya Sport & Recreation', NULL),
  ('6010210010', 'Funeral Contribution', NULL),
  ('6010210011', 'Biaya Manpower Development', NULL),
  ('6010210012', 'Biaya Pesangon', NULL),
  ('6010210013', 'Komisi / Bonus / Insentif', NULL),
  ('6010310001', 'Biaya Kebersihan (Cleaning)', NULL),
  ('6010310002', 'Alat Tulis Kantor & Barang Cetakan', NULL),
  ('6010310003', 'Biaya Rumah Tangga', NULL),
  ('6010310004', 'Biaya Bank HO', 'Biaya Bank Head Office'),
  ('6010310005', 'Biaya Telephone,Facsimile, Modem', NULL),
  ('6010310006', 'Biaya Pemakaian Listrik', NULL),
  ('6010310007', 'Biaya Pemakaian Air Bersih (PDAM)', NULL),
  ('6010310008', 'Biaya Perjalanan Dinas', NULL),
  ('6010310009', 'Biaya Lokal Transport', NULL),
  ('6010310010', 'Biaya Perijinan', NULL),
  ('6010310011', 'Computer Expenses', NULL),
  ('6010310012', 'Biaya Penyisihan Kerugian Piutang', NULL),
  ('6010310013', 'Biaya Perlengkapan Toko dan Kantor', NULL),
  ('6010310014', 'Biaya Stock Opname', NULL),
  ('6010310015', 'Biaya Peralatan Listrik', NULL),
  ('6010310016', 'Tire & Tubes  Expences', 'Tire & Tubes  Expenses'),
  ('6010310017', 'F u e l  & O I l  Expences', 'Fuel & Oil Expenses'),
  ('6010310018', 'T o o l s (Peralatan) Ekspences', 'Tools (Peralatan) Expenses'),
  ('6010310021', 'Biaya Donasi (CSR, Zakat)', NULL),
  ('6010310022', 'Biaya Konsultan', NULL),
  ('6010310023', 'Biaya Lisensi Kendaraan ( STNK, Uji Kir)', NULL),
  ('6010310024', 'Biaya Perlengkapan Mess atau Rumah Dinas', NULL),
  ('6010310099', 'Miscellaneous Expences', 'Miscellaneous Expenses'),
  ('6010410001', 'BIAYA PERBAIKAN DAN PERAWATAN FFE', 'BIAYA PERBAIKAN DAN PERAWATAN FURNITURE, FIXTURE & EQUIPMENT'),
  ('6010410002', 'SOFTWARE MAINTENANCE', NULL),
  ('6010410003', 'BIAYA PERBAIKAN DAN PERAWATAN KOMPUTER', NULL),
  ('6010410004', 'BIAYA PERBAIKAN DAN PERAWATAN BANGUNAN', NULL),
  ('6010410005', 'BIAYA PERBAIKAN DAN PERAWATAN STAFF HOUSE', NULL),
  ('6010410006', 'BIAYA PERBAIKAN DAN PERAWATAN KENDARAAN', NULL),
  ('6010410007', 'BIAYA PERBAIKAN DAN PERAWATAN AIRCONDITIONER & REFRIGERATOR', NULL),
  ('6010410008', 'BIAYA POWER PLANT', NULL),
  ('6010410010', 'BIAYA PERBAIKAN DAN PERAWATAN LIFT', NULL),
  ('7010110001', 'Biaya Sewa Tanah', NULL),
  ('7010110002', 'Biaya Land Right', NULL),
  ('7010110003', 'Biaya Sewa Bangunan Toko dan Gudang', NULL),
  ('7010110004', 'Biaya Sewa Rumah Dinas / Mess', NULL),
  ('7010210001', 'Biaya Depresiasi Bangunan Utama', NULL),
  ('7010211001', 'Biaya Depresiasi Instalasi Mekanikal, Elektrikal', NULL),
  ('7010212001', 'Biaya Depresiasi Mesin -  Air Conditioning', NULL),
  ('7010213001', 'Biaya Depresiasi Kendaraan - Mobil', NULL),
  ('7010214001', 'Biaya Depresiasi FFE Office', 'Biaya Depresiasi Furniture, Fixture & Equipment Office'),
  ('7010215001', 'Biaya Replacement OE - Rack 1', 'Biaya Replacement Operating Equipment - Rack 1'),
  ('7010216001', 'Biaya Amort SeventSoft Application', 'Biaya Amortisasi Seventh Soft Application'),
  ('7010216002', 'Biaya Amortisasi Biaya Pre Opening', NULL),
  ('7010310001', 'Property All Risk & Fire Insurance', NULL),
  ('7010310002', 'Biaya Pajak Bumi Dan Bangunan  (PBB)', NULL),
  ('7010310003', 'Biaya Pajak Reklame', NULL),   -- the client files this meaning at 7020310003
  ('7010310005', 'Biaya Asuransi Kendaraan', NULL),   -- the client files this meaning at 7020310005
  ('8010110001', 'Pendapatan Bunga Bank', NULL),
  ('8010110002', 'Selisih pembulatan', NULL),
  ('8010110006', 'Kehilangan Barang atau Selisih Stock Opname', NULL),
  ('8010110007', 'Pendapatan (Biaya) Lain-Lain', NULL),
  ('8020111001', 'Biaya Bunga Pinjaman Bank', NULL),
  ('8020111002', 'Biaya Bunga Leasing', NULL),
  ('8030112001', 'Current Tax Inc/Exp PPH Pasal 25', 'Current Tax Income/Expense PPH Pasal 25');

-- ---------------------------------------------------------------------------
-- Step two: three meanings go back onto the client's own codes
-- ---------------------------------------------------------------------------
--
-- Only three, and only these three; the six refusals and their reasons are in
-- the header. The guard is the point of the block: a relocation of an account
-- that has ever been posted to would change the trial balance per account, so
-- it stops the migration instead of doing it quietly.
--
-- `store_deposit`, `bank_statement`, `cash_count` and `company_bank_account`
-- are not repointed here because none of these three codes is a cash or bank
-- account. That is an assumption, and it is enforced: the DELETE at the end of
-- the loop meets their foreign keys if it is ever wrong.

CREATE TEMPORARY TABLE coa_relocation (
    from_code text PRIMARY KEY,
    to_code   text NOT NULL,
    rung_code text
) ON COMMIT DROP;

INSERT INTO coa_relocation (from_code, to_code, rung_code) VALUES
  ('1021508001', '1031803001', '1031803'),   -- the client files CIP under Other Assets
  ('4020210001', '8010110001', NULL),
  ('4020210009', '8010110007', NULL);

DO $$
DECLARE r record; t record; rung_parent text; left_behind text;
BEGIN
    FOR r IN SELECT * FROM coa_relocation ORDER BY from_code LOOP
        CONTINUE WHEN NOT EXISTS (
            SELECT 1 FROM ledger_account
             WHERE account_code = r.from_code AND NOT is_group);

        IF EXISTS (SELECT 1 FROM journal_line WHERE account_code = r.from_code) THEN
            RAISE EXCEPTION
                'account % carries postings, so moving it to the client''s % would move the trial balance. Ask the owner before relocating a posted account; do not do it from here.',
                r.from_code, r.to_code;
        END IF;
        IF EXISTS (SELECT 1 FROM ledger_account WHERE account_code = r.to_code) THEN
            RAISE EXCEPTION
                'the client''s code % is already in the chart, so % has nowhere to go', r.to_code, r.from_code;
        END IF;

        IF r.rung_code IS NOT NULL THEN
            rung_parent := left(r.rung_code, 5);
            INSERT INTO ledger_account
                (account_code, name, name_en, parent_code, is_group,
                 dimension, requires_counterparty, normal_balance, is_contra, is_active)
            SELECT r.rung_code, coalesce(n.written_as, n.client_name), NULL, rung_parent, true,
                   NULL, false, NULL, false, true
              FROM coa_client_name n
             WHERE n.account_code = r.rung_code
                ON CONFLICT (account_code) DO NOTHING;
        END IF;

        -- Everything but the code and the name is carried over unchanged: the
        -- dimension, the normal balance and the contra flag are properties of
        -- the meaning, and the meaning is what is moving.
        INSERT INTO ledger_account
            (account_code, name, name_en, parent_code, is_group,
             dimension, requires_counterparty, normal_balance, is_contra, is_active)
        SELECT r.to_code, coalesce(n.written_as, n.client_name), NULL, left(r.to_code, 7), false,
               a.dimension, a.requires_counterparty, a.normal_balance, a.is_contra, a.is_active
          FROM ledger_account a
          JOIN coa_client_name n ON n.account_code = r.to_code
         WHERE a.account_code = r.from_code;

        -- Every column that names an account and is not `journal_line` — which
        -- the guard above has already proved empty for this code. Skipped by
        -- name where the table is not there: `asset_class_reserve` and
        -- `supplier_credit_note` exist in some databases and in no migration
        -- in this repository, and a migration that only applies to the
        -- database it was written against is not a migration.
        FOR t IN SELECT * FROM (VALUES
                    ('account_map',                   'account_code'),
                    ('fixed_asset',                   'category_code'),
                    ('asset_class_reserve',           'class_code'),
                    ('supplier_invoice_expense_line', 'account_code'),
                    ('supplier_invoice_expense_line', 'asset_class_code'),
                    ('supplier_credit_note',          'credit_account_code')
                 ) AS v(tbl, col) LOOP
            CONTINUE WHEN to_regclass(t.tbl) IS NULL;
            CONTINUE WHEN NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = t.tbl AND column_name = t.col);
            EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', t.tbl, t.col, t.col)
              USING r.to_code, r.from_code;
        END LOOP;

        -- The twelve-digit leaves really did move and keep their remap row.
        -- The ten-digit template did not: it is back on its own code, and
        -- 0244's convention gives no remap row to an account that kept it.
        UPDATE ledger_account_remap SET new_code = r.to_code WHERE new_code = r.from_code;
        DELETE FROM ledger_account_remap WHERE legacy_code = r.to_code AND new_code = r.to_code;

        SELECT parent_code INTO left_behind FROM ledger_account WHERE account_code = r.from_code;
        DELETE FROM ledger_account WHERE account_code = r.from_code;

        -- A rung that existed only to hold what just left is not a chart, it
        -- is a leftover. Invariant 4 below would refuse it anyway.
        DELETE FROM ledger_account g
         WHERE g.account_code = left_behind
           AND g.is_group
           AND NOT EXISTS (SELECT 1 FROM ledger_account c WHERE c.parent_code = g.account_code);

        RAISE NOTICE 'moved % onto the client''s own %', r.from_code, r.to_code;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Step three: the client's words, where the words differ
-- ---------------------------------------------------------------------------
--
-- The WHERE clause is the owner's test, not `<>`. A name that differs only in
-- case, spacing or punctuation is already the client's name and is left alone.

UPDATE ledger_account a
   SET name = coalesce(n.written_as, n.client_name)
  FROM coa_client_name n
 WHERE n.account_code = a.account_code
   AND lower(regexp_replace(a.name, '[^0-9A-Za-z]', '', 'g'))
       IS DISTINCT FROM
       lower(regexp_replace(coalesce(n.written_as, n.client_name), '[^0-9A-Za-z]', '', 'g'));

-- An English name on an account of the client's is a translation of theirs,
-- which is the same invention under a different column. 0247 left `name_en`
-- NULL on all 79 rungs it created for this reason; the rest of the chart
-- catches up here. Accounts that are ours keep whatever English they have.
UPDATE ledger_account a
   SET name_en = NULL
  FROM coa_client_name n
 WHERE n.account_code = a.account_code
   AND a.name_en IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Step four: the invariants, asserted
-- ---------------------------------------------------------------------------
--
-- The five from 0247, unchanged, because a chart that drifts off the client's
-- ladder should not be able to commit — plus the name test and the trial
-- balance.

DO $$
DECLARE n bigint; bad text;
BEGIN
    -- 1. Every account on a code of the client's bears the client's words.
    SELECT string_agg(a.account_code || ': ' || a.name || ' (client: '
                      || coalesce(nm.written_as, nm.client_name) || ')', '; '
                      ORDER BY a.account_code) INTO bad
      FROM ledger_account a
      JOIN coa_client_name nm ON nm.account_code = a.account_code
     WHERE lower(regexp_replace(a.name, '[^0-9A-Za-z]', '', 'g'))
           IS DISTINCT FROM
           lower(regexp_replace(coalesce(nm.written_as, nm.client_name), '[^0-9A-Za-z]', '', 'g'));
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'these accounts do not carry the client''s words: %', bad;
    END IF;

    -- 2. No account of the client's carries an English name of ours.
    SELECT string_agg(a.account_code, ', ' ORDER BY a.account_code) INTO bad
      FROM ledger_account a
      JOIN coa_client_name nm ON nm.account_code = a.account_code
     WHERE a.name_en IS NOT NULL;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'these client accounts carry a translation: %', bad;
    END IF;

    -- 3. Every posting hangs off a seven-digit family.  [0247, invariant 1]
    SELECT string_agg(account_code || ' -> ' || coalesce(parent_code, 'nothing'), ', '
                      ORDER BY account_code) INTO bad
      FROM ledger_account
     WHERE NOT is_group AND (parent_code IS NULL OR length(parent_code) <> 7);
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'these postings do not hang off a seven-digit family: %', bad;
    END IF;

    -- 4. No rung is skipped, anywhere.  [0247, invariant 2]
    SELECT string_agg(account_code || ' -> ' || coalesce(parent_code, 'nothing'), ', '
                      ORDER BY account_code) INTO bad
      FROM ledger_account
     WHERE is_group
       AND CASE length(account_code)
               WHEN 1 THEN parent_code IS NOT NULL
               WHEN 3 THEN parent_code IS NULL OR length(parent_code) <> 1
               WHEN 5 THEN parent_code IS NULL OR length(parent_code) <> 3
               WHEN 7 THEN parent_code IS NULL OR length(parent_code) <> 5
               ELSE true
           END;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'these groups skip a rung of the ladder: %', bad;
    END IF;

    -- 5. No parent holds both groups and postings.  [0247, invariant 3]
    SELECT string_agg(parent_code, ', ' ORDER BY parent_code) INTO bad
      FROM ledger_account
     WHERE parent_code IS NOT NULL
     GROUP BY parent_code
    HAVING count(*) FILTER (WHERE is_group) > 0
       AND count(*) FILTER (WHERE NOT is_group) > 0;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'these parents hold both groups and postings: %', bad;
    END IF;

    -- 6. No group was left empty.  [0247, invariant 4]
    SELECT string_agg(g.account_code, ', ' ORDER BY g.account_code) INTO bad
      FROM ledger_account g
     WHERE g.is_group
       AND NOT EXISTS (SELECT 1 FROM ledger_account c WHERE c.parent_code = g.account_code);
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'these groups have no children: %', bad;
    END IF;

    -- 7. Not one rupiah moved.  [0247, invariant 5]
    -- Parenthesised: EXCEPT and UNION bind equally and left to right, so
    -- without them this would ask a different and much weaker question.
    SELECT count(*) INTO n FROM (
        (SELECT account_code, site_id, sum(debit_minor), sum(credit_minor)
           FROM journal_line GROUP BY 1, 2
         EXCEPT ALL
         SELECT account_code, site_id, debit_minor, credit_minor
           FROM coa_words_before)
        UNION ALL
        (SELECT account_code, site_id, debit_minor, credit_minor
           FROM coa_words_before
         EXCEPT ALL
         SELECT account_code, site_id, sum(debit_minor), sum(credit_minor)
           FROM journal_line GROUP BY 1, 2)) drift;
    IF n <> 0 THEN
        RAISE EXCEPTION 'the trial balance moved on % account/site pairs', n;
    END IF;

    -- 8. Everything left is ours, and it is said out loud rather than
    --    asserted, because another lane mints posting accounts in 0248 and
    --    0249 and a fixed list here would either fight them or go stale.
    SELECT string_agg(a.account_code || ' ' || a.name, '; ' ORDER BY a.account_code) INTO bad
      FROM ledger_account a
     WHERE NOT EXISTS (SELECT 1 FROM coa_client_name n WHERE n.account_code = a.account_code);
    RAISE NOTICE 'codes that are ours rather than the client''s: %', coalesce(bad, 'none');
END $$;

COMMENT ON COLUMN ledger_account.name IS
    'The client''s own name for this code, word for word, from their export. Case, whitespace and punctuation are ours to tidy; the WORDS are not, and neither is the meaning. A truncated word may be spelled out (Akum-Penyusu -> Akumulasi-Penyusutan) because completing a word is not changing it. An account the client does not have is ours to name, and docs/fixtures/coa-final.json marks which those are. 0253 put this back after 0243 translated 177 of them.';

COMMENT ON COLUMN ledger_account.name_en IS
    'An English name, and therefore ours. NULL on every account whose code is the client''s: translating one of their accounts invents a second authority for what it means. Nothing reads this column.';
