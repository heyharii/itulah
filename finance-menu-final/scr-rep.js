/* ═════════ Reports · Setup ═════════
   Reports: the statements read from the shared books (closes, accounts, bills, giros, the asset book),
   and an index of 7Soft's numbered reports so the team can type "laporan 7" and land.
   Setup: one page of every master, each opening its real table. */
;(() => {
/* the client's chart of accounts (Laporan_Master_Account): groups of 1/3/5/7 digits, accounts of 10 */
const COA = [["1","ASSET"],["101","CURRENT ASSET"],["10110","KAS & SETARA KAS"],["1011001","CASH ON HAND"],["1011001001","CASH ON HAND"],["1011001002","PETTY CASH"],["1011001003","MODAL KASIR"],["1011002","CASH IN BANK GIRO"],["1011002001","Cash In Bank Giro Bank BCA"],["1011002002","Cash In Bank Giro Bank MANDIRI"],["1011002003","Cash In Bank Giro Bank BRI"],["1011002004","Cash In Bank Giro Bank BNI"],["1011002005","Cash In Bank Giro Bank DANAMON"],["1011003","CASH IN BANK TABUNGAN"],["1011003001","Cash In Bank Tabungan Bank BCA"],["1011003002","Cash In Bank Tabungan Bank Mandiri"],["1011003003","Cash In Bank Tabungan Bank BRI"],["1011003004","Cash In Bank Tabungan Bank BNI"],["1011003005","Cash In Bank Tabungan Bank BTN"],["1011004","TIME DEPOSIT"],["1011004001","TIME DEPOSIT BANK BCA"],["1011004002","TIME DEPOSIT BANK MANDIRI"],["1011004003","TIME DEPOSIT BANK BRI"],["1011004004","TIME DEPOSIT BANK BNI"],["10111","PIUTANG"],["1011101","PIUTANG DAGANG"],["1011101001","Piutang kartu Kredit"],["1011101002","Piutang Debit Card"],["1011102","PIUTANG LAIN-LAIN"],["1011102001","PIUTANG PEGAWAI"],["1011102002","PIUTANG KEPALA TOKO"],["1011102003","PIUTANG MANAJEMEN"],["1011103","CADANGAN PENGHAPUSAN PIUTANG TAK TERTAGIH"],["1011103001","Cad, Penghapusan Piutang Tak Tertagih, Piutang Kartu Kredit"],["1011103002","Cad, Penghapusan Piutang Tak Tertagih, Piutang Debit Card"],["1011103003","Cad, Penghapusan Piutang Tak Tertagih, Piutang Pegawai"],["10112","INVENTORY"],["1011201","Persediaan Barang Dagang"],["1011201001","Persediaan Barang Dagangan"],["1011202","Persediaan Kantong Belanja"],["1011202001","Kantong Belanja  Plastik Ukuran KECIL"],["1011202002","Kantong Belanja  Plastik Ukuran SEDANG"],["1011202003","Kantong Belanja  Plastik Ukuran BESAR"],["1011202004","Kantong Belanja  Plastik Ukuran JUMBO"],["1011202005","Kantong Belanja  Plastik SEPATU"],["1011202006","Kantong Belanja  Kertas Ukuran KECIL"],["1011202007","Kantong Belanja  Kertas Ukuran SEDANG"],["1011202008","Kantong Belanja  Kertas Ukuran BESAR"],["1011202009","Kantong Belanja  Kertas Ukuran JUMBO"],["1011202010","Kantong Belanja  Kertas SEPATU"],["1011203","Barang Dalam Perjalanan Barang Dagangan"],["1011203001","BDP Barang Dagangan HEAD OFFICE"],["1011203002","BDP Barang Dagangan CIKUPA"],["1011203003","BDP Barang Dagangan MUARO BUNGO"],["1011203004","BDP Barang Dagangan PURBALINGGA"],["1011203005","BDP Barang Dagangan BUMIAYU"],["1011203006","BDP Barang Dagangan JAMBI"],["1011203007","BDP Barang Dagangan WIRAMODE"],["1011203008","BDP Barang Dagangan BREBES"],["1011203009","BDP Barang Dagangan PASURUAN"],["1011203010","BDP Barang Dagangan WMJB"],["1011203011","BDP Barang Dagangan WMBA"],["1011203012","BDP Barang Dagangan SIPIN"],["1011203013","BDP Barang Dagangan BANJARAN"],["1011203014","BDP Barang Dagangan WONOSOBO"],["1011204","Barang Dalam Perjalanan Kantong Belanja"],["1011204001","BDP Kantong Belanja HEAD OFFICE"],["1011204002","BDP Kantong Belanja CIKUPA"],["1011204003","BDP Kantong Belanja MUARO BUNGO"],["1011204004","BDP Kantong Belanja PURBALINGGA"],["1011204005","BDP Kantong Belanja BUMIAYU"],["1011204006","BDP Kantong Belanja JAMBI"],["1011204007","BDP Kantong Belanja WIRAMODE"],["1011204008","BDP Kantong Belanja BREBES"],["1011204009","BDP Kantong Belanja PASURUAN"],["1011204010","BDP Kantong Belanja WMJB"],["1011204011","BDP Kantong Belanja WMBA"],["1011204012","BDP Kantong Belanja SIPIN"],["1011204013","BDP Kantong Belanja BANJARAN"],["1011204014","BDP Kantong Belanja WONOSOBO"],["1011299","Cadangan Kerusakan atau kehilangan Barang"],["1011299001","Cadangan Kerusakan atau kehilangan Barang - Barang Dagangan"],["1011299002","Cadangan Kerusakan atau kehilangan Barang - Kantong Belanja"],["10113","PREPAID"],["1011301","BIAYA DIBAYAR DIMUKA"],["1011301001","Asuransi Bayar Dimuka"],["1011301002","Sewa Tanah Bayar Dimuka"],["1011301003","Sewa Toko Bayar Dimuka"],["1011301004","Sewa Rumah Bayar Dimuka"],["1011301005","Kontrak Maintenance Bayar Dimuka"],["1011301006","Sewa Kendaraan Bayar Dimuka"],["1011301007","Biaya Promosi Bayar Dimuka"],["1011301008","Biaya Ijin Usaha Bayar Dimuka"],["1011301009","Biaya Bayar Dimuka Lain Lain"],["1011302","PAJAK BAYAR DIMUKA/PREPAID TAX"],["1011302001","Prepaid - PPh Pasal 21"],["1011302002","Prepaid - PPh Pasal 25"],["1011302003","Prepaid - PPh Pasal 29"],["1011302004","Prepaid - VAT (PPN Masukan)"],["1011302005","Prepaid - Land Tax (PBB)"],["1011302006","Prepaid - Other Tax"],["1011303","UANG MUKA / ADVANCED"],["1011303001","Advanced - Travelling"],["1011303002","Advanced  - Purchase"],["1011303003","Advanced  - To Contractors"],["1011303004","Advanced  - Others"],["102","NON CURRENT ASSET"],["10214","PIUTANG  AFFILIASI ANTAR UNIT"],["1021401","PIUTANG  AFFILIASI PEMBIAYAAN"],["1021401001","Piutang Affiliasi Pembiayaan HEAD OFFICE"],["1021401002","Piutang Affiliasi Pembiayaan CIKUPA"],["1021401003","Piutang Affiliasi Pembiayaan MUARO BUNGO"],["1021401004","Piutang Affiliasi Pembiayaan PURBALINGGA"],["1021401005","Piutang Affiliasi Pembiayaan BUMIAYU"],["1021401006","Piutang Affiliasi Pembiayaan JAMBI"],["1021401007","Piutang Affiliasi Pembiayaan WIRAMODE"],["1021401008","Piutang Affiliasi Pembiayaan BREBES"],["1021401009","Piutang Affiliasi Pembiayaan PASURUAN"],["1021401010","Piutang Affiliasi Pembiayaan WMJB"],["1021401011","Piutang Affiliasi Pembiayaan WMBA"],["1021401012","Piutang Affiliasi Pembiayaan SIPIN"],["1021401013","Piutang Affiliasi Pembiayaan BANJARAN"],["1021401014","Piutang Affiliasi Pembiayaan WONOSOBO"],["1021402","PIUTANG  AFFILIASI ATAS BARANG"],["1021402001","Piutang Affiliasi Atas Barang HEAD OFFICE"],["1021402002","Piutang Affiliasi Atas Barang CIKUPA"],["1021402003","Piutang Affiliasi Atas Barang MUARO BUNGO"],["1021402004","Piutang Affiliasi Atas Barang PURBALINGGA"],["1021402005","Piutang Affiliasi Atas Barang BUMIAYU"],["1021402006","Piutang Affiliasi Atas Barang JAMBI"],["1021402007","Piutang Affiliasi Atas Barang WIRAMODE"],["1021402008","Piutang Affiliasi Atas Barang BREBES"],["1021402009","Piutang Affiliasi Atas Barang PASURUAN"],["1021402010","Piutang Affiliasi Atas Barang WMJB"],["1021402011","Piutang Affiliasi Atas Barang WMBA"],["1021402012","Piutang Affiliasi Atas Barang SIPIN"],["1021402013","Piutang Affiliasi Atas Barang BANJARAN"],["1021402014","Piutang Affiliasi Atas Barang WONOSOBO"],["1021403","PIUTANG AFFILIASI LAIN-LAIN"],["1021403001","Piutang Affiliasi Lain-lain HEAD OFFICE"],["1021403002","Piutang Affiliasi Lain-lain CIKUPA"],["1021403003","Piutang Affiliasi Lain-lain MUARO BUNGO"],["1021403004","Piutang Affiliasi Lain-lain PURBALINGGA"],["1021403005","Piutang Affiliasi Lain-lain BUMIAYU"],["1021403006","Piutang Affiliasi Lain-lain JAMBI"],["1021403007","Piutang Affiliasi Lain-lain WIRAMODE"],["1021403008","Piutang Affiliasi Lain-lain BREBES"],["1021403009","Piutang Affiliasi Lain-lain PASURUAN"],["1021403010","Piutang Affiliasi Lain-lain WMJB"],["1021403011","Piutang Affiliasi Lain-lain WMBA"],["1021403012","Piutang Affiliasi Lain-lain SIPIN"],["1021403013","Piutang Affiliasi Lain-lain BANJARAN"],["1021403014","Piutang Affiliasi Lain-lain WONOSOBO"],["10215","AKTIVA TETAP"],["1021501","Tanah"],["1021501001","Tanah Hak Milik"],["1021501002","Hak Sewa Tanah / HGB"],["1021502","Bangunan"],["1021502001","Bangunan Utama"],["1021502002","Bangunan Tambahan"],["1021502003","Bangunan Staff House / Mess"],["1021503","Instalasi"],["1021503001","Instalasi Mekanikal Elektrikal"],["1021504","Machineries"],["1021504001","Air Conditioner"],["1021504002","Lift"],["1021504003","Eskalator"],["1021504004","Genset"],["1021505","Kendaraan"],["1021505001","Mobil"],["1021505002","Sepeda Motor"],["1021506","Furniture, Fixture  & Equipment"],["1021506001","FFE Office"],["1021506002","FFE Toko dan Gudang"],["1021506003","FFE Komputer"],["1021506004","FFE Music"],["1021506005","FFE Staff House / Mess"],["1021506006","FFE Interior"],["1021506007","FFE Exterior"],["1021507","Operating Equipment"],["1021507001","OE - Rak 1"],["1021507002","OE - Rak 2"],["1021507003","OE - Rak 3"],["1021507004","OE - Rak 4"],["1021507005","OE - Pajangan Gantungan 2"],["1021507006","OE - Pajangan Gantungan 4"],["1021507007","OE - Pajangan Gantungan 6"],["1021507008","OE - Pajangan Gantungan Lain - Lain"],["1021507009","OE - Meja 1"],["1021507010","OE - Meja 2"],["1021507011","OE - Meja 3"],["1021507012","OE - Box OB Kayu"],["1021507013","OE - Box OB Besi"],["1021507014","OE - Holo"],["1021507015","OE - Breket"],["1021507016","OE - Belalai"],["1021507017","OE - Patung Full Bodi Dewasa"],["1021507018","OE - Patung Full Bodi Anak"],["1021507019","OE - Patung  Setengah Badan Pria"],["1021507020","OE - Patung  Setengah Badan  Wanita 1"],["1021507021","OE - Patung  Setengah Badan  Wanita 2"],["1021507022","OE - Patung  Setengah Badan Anak"],["1021507023","OE - Patung  Kepala  Dewasa"],["1021507024","OE - Patung  Kepala  Anak"],["1021507025","OE - Patung  Kaki Dewasa"],["1021507026","OE - Patung  Kaki Anak"],["1021507027","OE - Hanger Wanita / ABG"],["1021507028","OE - Hanger  Pria"],["1021507029","OE - Hanger Jacket"],["1021507030","OE - Hanger Kayu Anak"],["1021507031","OE - Hanger Body / Stelan"],["1021507032","OE - Hanger Jepit Dewasa"],["1021507033","OE - Hanger Jepit Anak"],["1021507034","OE - Hanger Gamis / Ibu"],["1021507035","OE - PIN / Kawat Sensor"],["1021507036","OE - Tas / Keranjang Belanja"],["10216","AKUMULASI PENYUSUTAN AKTIVA TETAP"],["1021601","Akumulasi Penyusu -Tanah"],["1021601002","Akumulasi Penyusu - Hak  Pengelolaan Tanah (Land Right) / HGB"],["1021602","Akum-Penyusu - Bangunan"],["1021602001","Akum Penyusu - Bangunan Utama"],["1021602002","Akum-Penyusu - Bangunan Tambahan"],["1021602003","Akum-Penyusu - Bangunan Staff House / Mess"],["1021603","Akum-Penyusu - Instalasi"],["1021603001","Akum - Penyusu - Instalasi - Mekanikal  Electrical"],["1021604","Akum-Penyusu - Mesin"],["1021604001","Akum-Penyu Mesin - Air Conditioner"],["1021604002","Akum-Penyu Mesin - Lift"],["1021604003","Akum-Penyu Mesin - Esklator"],["1021604004","Akum-Penyu Mesin - Genset"],["1021605","Akum-Penyusu Kendaraan"],["1021605001","Akum Penyusutan - Mobil"],["1021605002","Akum Penyusutan - Sepeda Motor"],["1021606","Akum-Penyusu - FFE"],["1021606001","Akum Penyusu - FFE Office"],["1021606002","Akum Penyusu - FFE Toko dan Gudang"],["1021606003","Akum Penyusu - FFE Komputer"],["1021606004","Akum Penyusu - FFE Music"],["1021606005","Akum Penyusu - FFE Staff House / Mess"],["1021606006","Akum Penyusu - FFE Interior"],["1021606007","Akum Penyusu - FFE Exterior"],["1021607","Reserve Replacement - Operating Equipment"],["1021607001","Reserve Replacement OE- Rak 1"],["1021607002","Reserve Replacement OE- Rak 2"],["1021607003","Reserve Replacement OE- Rak 3"],["1021607004","Reserve Replacement OE- Rak 4"],["1021607005","Reserve Replacement OE- Pajangan Gantungan 2"],["1021607006","Reserve Replacement OE- Pajangan Gantungan 4"],["1021607007","Reserve Replacement OE- Pajangan Gantungan 6"],["1021607008","Reserve Replacement OE- Pajangan Gantungan Lain-lain"],["1021607009","Reserve Replacement OE- Meja 1"],["1021607010","Reserve Replacement OE- Meja 2"],["1021607011","Reserve Replacement OE- Meja 3"],["1021607012","Reserve Replacement OE- Box OB Kayu"],["1021607013","Reserve Replacement OE- Box OB Besi"],["1021607014","Reserve Replacement OE- Holo"],["1021607015","Reserve Replacement OE- Breket"],["1021607016","Reserve Replacement OE- Belalai"],["1021607017","Reserve Replacement OE- Patung Full Body Dewasa"],["1021607018","Reserve Replacement OE- Patung Full Body Anak"],["1021607019","Reserve Replacement OE- Patung Setengah Badan Pria"],["1021607020","Reserve Replacement OE- Patung Setengah Badan Wanita 1"],["1021607021","Reserve Replacement OE- Patung Setengah Badan Wanita 2"],["1021607022","Reserve Replacement OE- Patung Setengah Badan Anak"],["1021607023","Reserve Replacement OE- Patung Kepala Dewasa"],["1021607024","Reserve Replacement OE- Patung Kepala Anak"],["1021607025","Reserve Replacement OE- Patung Kaki Dewasa"],["1021607026","Reserve Replacement OE- Patung Kaki Anak"],["1021607027","Reserve Replacement OE- Hanger Wanita / ABG"],["1021607028","Reserve Replacement OE- Hanger Pria"],["1021607029","Reserve Replacement OE- Hanger Jacket"],["1021607030","Reserve Replacement OE- Hanger Kayu Anak"],["1021607031","Reserve Replacement OE- Hanger Body / Stelan"],["1021607032","Reserve Replacement OE- Hanger Jepit Dewasa"],["1021607033","Reserve Replacement OE- Hanger Jepit Anak"],["1021607034","Reserve Replacement OE- Hanger Gamis / Ibu"],["1021607035","Reserve Replacement OE- PIN / Kawat Sensor"],["1021607036","Reserve Replacement OE- Tas / Keranjang Belanja"],["10217","INTANGIBLE ASSET"],["1021701","Software"],["1021701001","Seventh Soft Application"],["1021701002","Opti Tex System"],["1021702","Acc Amort Software"],["1021702001","Acc Amort Sevent Soft Application"],["1021702002","Acc Amort Opti Tex System"],["103","OTHER ASSETS"],["10318","Other Asset"],["1031801","Disposed Inventory"],["1031801001","Disposed Inventory"],["1031802","Pre Opening"],["1031802001","Pre Opening"],["1031802002","Akumulasi Amortisasi Pre Opening"],["1031803","Contract In Progress (CIP)"],["1031803001","Contract In Progress (CIP)"],["2","LIABILITIES"],["201","HUTANG JANGKA PENDEK"],["20120","HUTANG DAGANG"],["2012001","HUTANG SUPPLIER"],["2012001001","Hutang Suppliers  Barang Dagangan"],["2012001002","Hutang Supplier Barang Dagang - Suspend"],["2012001003","Hutang Supplier  Non Barang Dagang"],["2012002","OUTSTANDING GIRO"],["2012002001","Outstanding Giro Bank BCA"],["2012002002","Outstanding Giro Bank Mandiri"],["2012002003","Outstanding Giro Bank BRI"],["2012002004","Outstanding Giro Bank BNI"],["2012002005","Outstanding Giro Bank DANAMON"],["20121","HUTANG PAJAK"],["2012101","HUTANG PAJAK"],["2012101001","Hutang Pajak PPH Pasal 21"],["2012101002","Hutang Pajak PPH Pasal 23 (withold)"],["2012101003","Hutang  VAT PPN Keluaran"],["2012101004","Hutang Pajak Bumi & Bangunan"],["2012101005","Hutang Pajak PPH Pasal 25"],["20122","ACCRUED EXPENSE (BIAYA YANG MASIH HARUS DIBAYAR)"],["2012201","ACCRUED EXPENSE (BIAYA YANG MASIH HARUS DIBAYAR)"],["2012201001","Biaya Gaji dan Upah YMHD"],["2012201002","THR/Insentif/Bonus/Pesangon YMHD"],["2012201003","Biaya Bunga Pinjaman YMHD"],["2012201004","Biaya Pengobatan  YMHD"],["2012201005","Biaya Asuransi dan BPJS YMHD"],["2012201006","Biaya Telephone, Fax, Modem YMHD"],["2012201007","Biaya Pemakaian Listrik YMHD"],["2012201008","Biaya Pemakaian Air Bersih YMHD"],["2012201009","Biaya Sewa Kantor / Toko YMHD"],["2012201010","Biaya Sewa Rumah / Mess YMHD"],["20123","HUTANG LAIN-LAIN"],["2012301","HUTANG AFFILIASI PEMBIAYAAN"],["2012301001","Hutang Affiliasi Pembiayaan  HEAD OFFICE"],["2012301002","Hutang Affiliasi Pembiayaan CIKUPA"],["2012301003","Hutang Affiliasi Pembiayaan MUARO BUNGO"],["2012301004","Hutang Affiliasi Pembiayaan PURBALINGGA"],["2012301005","Hutang Affiliasi Pembiayaan BUMIAYU"],["2012301006","Hutang Affiliasi Pembiayaan JAMBI"],["2012301007","Hutang Affiliasi Pembiayaan WIRAMODE"],["2012301008","Hutang Affiliasi Pembiayaan BREBES"],["2012301009","Hutang Affiliasi Pembiayaan PASURUAN"],["2012301010","Hutang Affiliasi Pembiayaan WMJB"],["2012301011","Hutang Affiliasi Pembiayaan WMBA"],["2012301012","Hutang Affiliasi Pembiayaan SIPIN"],["2012301013","Hutang Affiliasi Pembiayaan BANJARAN"],["2012301014","Hutang Affiliasi Pembiayaan WONOSOBO"],["2012302","HUTANG AFFILIASI ATAS BARANG"],["2012302001","Hutang Affiliasi Atas Barang HEAD OFFICE"],["2012302002","Hutang Affiliasi Atas Barang CIKUPA"],["2012302003","Hutang Affiliasi Atas Barang MUARO BUNGO"],["2012302004","Hutang Affiliasi Atas Barang PURBALINGGA"],["2012302005","Hutang Affiliasi Atas Barang BUMIAYU"],["2012302006","Hutang Affiliasi Atas Barang JAMBI"],["2012302007","Hutang Affiliasi Atas Barang WIRAMODE"],["2012302008","Hutang Affiliasi Atas Barang BREBES"],["2012302009","Hutang Affiliasi Atas Barang PASURUAN"],["2012302010","Hutang Affiliasi Atas Barang WMJB"],["2012302011","Hutang Affiliasi Atas Barang WMBA"],["2012302012","Hutang Affiliasi Atas Barang SIPIN"],["2012302013","Hutang Affiliasi Atas Barang BANJARAN"],["2012302014","Hutang Affiliasi Atas Barang WONOSOBO"],["2012303","HUTANG LAIN-LAIN PRINCIPAL"],["2012303001","Hutang Lain-lain Principal HEAD OFFICE"],["2012303002","Hutang Lain-lain Principal CIKUPA"],["2012303003","Hutang Lain-lain Principal MUARO BUNGO"],["2012303004","Hutang Lain-lain Principal PURBALINGGA"],["2012303005","Hutang Lain-lain Principal BUMIAYU"],["2012303006","Hutang Lain-lain Principal JAMBI"],["2012303007","Hutang Lain-lain Principal WIRAMODE"],["2012303008","Hutang Lain-lain Principal BREBES"],["2012303009","Hutang Lain-lain Principal PASURUAN"],["2012303010","Hutang Lain-lain Principal WMJB"],["2012303011","Hutang Lain-lain Principal WMBA"],["2012303012","Hutang Lain-lain Principal SIPIN"],["2012303013","Hutang Lain-lain Principal BANJARAN"],["2012303014","Hutang Lain-lain Principal WONOSOBO"],["2012304","HUTANG LAIN - LAIN"],["2012304001","Hutang Lain - Lain  HEAD OFFICE"],["2012304002","Hutang Lain - Lain  CIKUPA"],["2012304003","Hutang Lain - Lain  MUARO BUNGO"],["2012304004","Hutang Lain - Lain  PURBALINGGA"],["2012304005","Hutang Lain - Lain  BUMIAYU"],["2012304006","Hutang Lain - Lain  JAMBI"],["2012304007","Hutang Lain - Lain  WIRAMODE"],["2012304008","Hutang Lain - Lain  BREBES"],["2012304009","Hutang Lain - Lain  PASURUAN"],["2012304010","Hutang Lain - Lain  WMJB"],["2012304011","Hutang Lain - Lain  WMBA"],["2012304012","Hutang Lain - Lain  SIPIN"],["2012304013","Hutang Lain - Lain  BANJARAN"],["2012304014","Hutang Lain - Lain  WONOSOBO"],["20125","PINJAMAN JANGKA PANJANG JATUH TEMPO"],["2012501","PJP JATUH TEMPO - PRINCIPAL"],["2012501001","PJP Jatuh Tempo - Principal"],["2012502","PJP JATUH TEMPO - BANK"],["2012502001","PJP Jatuh Tempo  Bank BCA"],["2012502002","PJP Jatuh Tempo  Bank Mandiri"],["2012502003","PJP Jatuh Tempo  Bank BRI"],["2012502004","PJP Jatuh Tempo  Bank BNI"],["2012502005","PJP Jatuh Tempo  Bank Danamon"],["202","PINJAMAN JANGKA PANJANG"],["20224","PINJAMAN JANGKA PANJANG"],["2022401","Pinjaman Jangka Panjang  Principal"],["2022401001","Pinjaman Jangka Panjang  Principal"],["2022402","Pinjaman Jangka Panjang  Bank"],["2022402001","Pinjaman Jangka Panjang  Bank BCA"],["2022402002","Pinjaman Jangka Panjang  Bank Mandiri"],["2022402003","Pinjaman Jangka Panjang  Bank BRI"],["2022402004","Pinjaman Jangka Panjang  Bank BNI"],["2022402005","Pinjaman Jangka Panjang  Bank Danamon"],["3","MODAL"],["301","MODAL"],["30130","MODAL"],["3013001","MODAL"],["3013001001","Modal Setor"],["3013001002","Laba (Rugi) Ditahan"],["3013001003","Laba (Rugi) bulan berjalan"],["3013001004","Prive"],["4","PENDAPATAN"],["401","PENJUALAN"],["40101","PENJUALAN"],["4010110","Penjualan Tunai"],["4010110001","Penjualan Tunai"],["4010111","Penjualan  Kartu Debit"],["4010111001","Penjualan Debit Card Bank BCA"],["4010111002","Penjualan Debit Card Bank Mandiri"],["4010111003","Penjualan Debit Card Bank BRI"],["4010111004","Penjualan Debit Card Bank BNI"],["4010112","Penjualan  Kartu Kredit"],["4010112001","Penjualan Kartu Kredit VISA Card"],["4010112002","Penjualan Kartu Kredit Master Card"],["4010113","Penjualan  Online"],["4010113001","Penjualan  Online Sendiri"],["4010113002","Penjualan  Online Market Place"],["40102","DISCOUNT / POTONGAN DAN RETURN PENJUALAN"],["4010213","Discount / Potongan Penjualan"],["4010213001","Discount / Potongan Penjualan"],["4010214","Retur Penjualan"],["4010214001","Retur Penjualan"],["402","MANAGEMENT FEE"],["40201","MANAGEMENT FEE"],["4020110","Management  Fee"],["4020110001","Management  Fee"],["5","BIAYA / BEBAN POKOK"],["501","HARGA POKOK PEMBELIAN"],["50101","HARGA POKOK PEMBELIAN"],["5010110","HARGA POKOK PEMBELIAN"],["5010110001","Harga Pokok Pembelian"],["6","BIAYA / BEBAN  USAHA"],["601","BIAYA / BEBAN  USAHA"],["60101","BEBAN PENJUALAN"],["6010110","BIAYA  PENJUALAN"],["6010110001","Biaya Customer Supplies"],["6010110002","Biaya Credit Card"],["6010110003","Biaya Promosi"],["6010110004","Biaya Dekorasi"],["6010110005","Biaya Advertising / Iklan"],["6010110006","Biaya Bongkar Muat Barang"],["6010110007","Biaya Pengiriman Barang/kurir/Ekspedisi"],["6010110008","Biaya  Kerusakan Persediaan Barang Dagangan"],["6010111","BIAYA PEGAWAI OPERATION"],["6010111001","Biaya Gaji Karyawan"],["6010111002","Biaya Lembur"],["6010111003","Uang Makan"],["6010111004","Uang Transport"],["6010111005","Biaya Kesehatan & Pengobatan"],["6010111006","Biaya Asuransi Pegawai / BPJS"],["6010111007","Tunjangan Hari Raya (THR)"],["6010111008","Biaya Uniform / Seragam Kerja"],["6010111009","Biaya Sport & Recreation"],["6010111010","Funeral Contribution"],["6010111011","Biaya Manpower Development"],["6010111012","Biaya Pesangon"],["6010111013","Komisi / Bonus / Insentif"],["60102","BEBAN PEGAWAI"],["6010210","BEBAN PEGAWAI OFFICE"],["6010210001","Biaya Gaji Pegawai"],["6010210002","Biaya Lembur"],["6010210003","Uang Makan"],["6010210004","Uang Transpot"],["6010210005","Biaya Kesehatan & Pengobatan"],["6010210006","Biaya Asuransi Pegawai / BPJS"],["6010210007","Tunjangan Hari Raya (THR)"],["6010210008","Biaya Uniform / Seragam Kerja"],["6010210009","Biaya Sport & Recreation"],["6010210010","Funeral Contribution"],["6010210011","Biaya Manpower Development"],["6010210012","Biaya Pesangon"],["6010210013","Komisi / Bonus / Insentif"],["60103","BEBAN ADMINISTRASI DAN UMUM"],["6010310","BIAYA ADMINISTRASI DAN UMUM"],["6010310001","Biaya Kebersihan (Cleaning)"],["6010310002","Alat Tulis Kantor & Barang Cetakan"],["6010310003","Biaya Rumah Tangga"],["6010310004","Biaya Bank HO"],["6010310005","Biaya Telephone,Facsimile, Modem"],["6010310006","Biaya Pemakaian Listrik"],["6010310007","Biaya Pemakaian Air Bersih (PDAM)"],["6010310008","Biaya Perjalanan Dinas"],["6010310009","Biaya Lokal Transport"],["6010310010","Biaya Perijinan"],["6010310011","Computer Expenses"],["6010310012","Biaya Penyisihan Kerugian Piutang"],["6010310013","Biaya Perlengkapan Toko dan Kantor"],["6010310014","Biaya Stock Opname"],["6010310015","Biaya Peralatan Listrik"],["6010310016","Tire & Tubes  Expences"],["6010310017","F u e l  & O I l  Expences"],["6010310018","T o o l s (Peralatan) Ekspences"],["6010310019","Biaya Lubrication & Grease, Bahan Bakar Genset"],["6010310020","Biaya Telephone Equipment"],["6010310021","Biaya Donasi (CSR, Zakat)"],["6010310022","Biaya Konsultan"],["6010310023","Biaya Lisensi Kendaraan ( STNK, Uji Kir)"],["6010310024","Biaya Perlengkapan Mess atau Rumah Dinas"],["6010310099","Miscellaneous Expences"],["60104","BEBAN PERAWATAN DAN PEMELIHARAAN"],["6010410","BIAYA PERAWATAN DAN PEMELIHARAAN"],["6010410001","BIAYA PERBAIKAN DAN PERAWATAN FFE"],["6010410002","SOFTWARE MAINTENANCE"],["6010410003","BIAYA PERBAIKAN DAN PERAWATAN KOMPUTER"],["6010410004","BIAYA PERBAIKAN DAN PERAWATAN BANGUNAN"],["6010410005","BIAYA PERBAIKAN DAN PERAWATAN STAFF HOUSE"],["6010410006","BIAYA PERBAIKAN DAN PERAWATAN KENDARAAN"],["6010410007","BIAYA PERBAIKAN DAN PERAWATAN AIRCONDITIONER & REFRIGERATOR"],["6010410008","BIAYA POWER PLANT"],["6010410009","P A I N T (BIAYA PENGECATAN)"],["6010410010","BIAYA PERBAIKAN DAN PERAWATAN LIFT"],["7","BEBAN USAHA LAINNYA"],["701","BEBAN USAHA LAINNYA"],["70101","BIAYA SEWA"],["7010110","BIAYA SEWA"],["7010110001","Biaya Sewa Tanah"],["7010110002","Biaya Land Right"],["7010110003","Biaya Sewa Bangunan Toko dan Gudang"],["7010110004","Biaya Sewa Rumah Dinas / Mess"],["70102","BIAYA DEPRESIASI DAN AMORTISASI"],["7010210","BIAYA DEPRESIASI BANGUNAN"],["7010210001","Biaya Depresiasi Bangunan Utama"],["7010210002","Biaya Depresiasi Bangunan Tambahan"],["7010210003","Biaya Depresiasi Bangunan Mess / Staff House"],["7010211","BIAYA DEPRESIASI INSTALASI, MEKANIKAL, ELEKTRIKAL"],["7010211001","Biaya Depresiasi Instalasi Mekanikal, Elektrikal"],["7010212","BIAYA DEPRESIASI  MESIN"],["7010212001","Biaya Depresiasi Mesin -  Air Conditioning"],["7010212002","Biaya Depresiasi Mesin -  Lift"],["7010212003","Biaya Depresiasi Mesin -  Eskalator"],["7010212004","Biaya Depresiasi Mesin -  Genset"],["7010213","BIAYA DEPRESIASI KENDARAAN"],["7010213001","Biaya Depresiasi Kendaraan - Mobil"],["7010213002","Biaya Depresiasi Kendaraan - Sepeda Motor"],["7010214","BIAYA DEPRESIASI FFE"],["7010214001","Biaya Depresiasi FFE Office"],["7010214002","Biaya Depresiasi FFE Toko Dan Gudang"],["7010214003","Biaya Depresiasi FFE Komputer"],["7010214004","Biaya Depresiasi FFE Musik"],["7010214005","Biaya Depresiasi FFE Staff House / Mess"],["7010214006","Biaya Depresiasi FFE Interior"],["7010214007","Biaya Depresiasi FFE Exterior"],["7010215","BIAYA REPLACEMENT OPERATING EQUIPMENT"],["7010215001","Biaya Replacement OE - Rack 1"],["7010215002","Biaya Replacement OE - Rack 2"],["7010215003","Biaya Replacement OE - Rack 3"],["7010215004","Biaya Replacement OE - Rack 4"],["7010215005","Biaya Replacement OE - Pajangan Gantungan 2"],["7010215006","Biaya Replacement OE - Pajangan Gantungan 4"],["7010215007","Biaya Replacement OE - Pajangan Gantungan 6"],["7010215008","Biaya Replacement OE - Pajangan Gantungan Lain-Lain"],["7010215009","Biaya Replacement OE - Meja 1"],["7010215010","Biaya Replacement OE - Meja 2"],["7010215011","Biaya Replacement OE - Meja 3"],["7010215012","Biaya Replacement OE - Box OB kayu"],["7010215013","Biaya Replacement OE - Box OB Besi"],["7010215014","Biaya Replacement OE - Holo"],["7010215015","Biaya Replacement OE - Breket"],["7010215016","Biaya Replacement OE - Belalai"],["7010215017","Biaya Replacement OE - Patung Full Bodi Dewasa"],["7010215018","Biaya Replacement OE - Patung Full Bodi Anak"],["7010215019","Biaya Replacement OE - Patung Setengah Badan Pria"],["7010215020","Biaya Replacement OE - Patung Setengah Badan Wanita 1"],["7010215021","Biaya Replacement OE - Patung Setengah Badan Wanita 2"],["7010215022","Biaya Replacement OE - Patung Setengah Badan Anak"],["7010215023","Biaya Replacement OE - Patung Kepala Dewasa"],["7010215024","Biaya Replacement OE - Patung Kepala Anak"],["7010215025","Biaya Replacement OE - Patung Kaki Dewasa"],["7010215026","Biaya Replacement OE - Patung Kaki Anak"],["7010215027","Biaya Replacement OE - Hanger Wanita / ABG"],["7010215028","Biaya Replacement OE - Hanger Pria"],["7010215029","Biaya Replacement OE - Hanger Jacket"],["7010215030","Biaya Replacement OE - Hanger Kayu Anak"],["7010215031","Biaya Replacement OE - Hanger Body / Stelan"],["7010215032","Biaya Replacement OE - Hanger Jepit Dewasa"],["7010215033","Biaya Replacement OE - Hanger Jepit Anak"],["7010215034","Biaya Replacement OE - Hanger Gamis / Ibu"],["7010215035","Biaya Replacement OE - PIN / Kawat Sensor"],["7010215036","Biaya Replacement OE - Tas / Keranjang Belanja"],["7010216","BIAYA AMORTISASI INTANGIBLE ASSET AND OTHER ASSET"],["7010216001","Biaya Amort SeventSoft Application"],["7010216002","Biaya Amortisasi Biaya Pre Opening"],["7010216003","Biaya Amortisasi Opti Tex System"],["70103","BIAYA USAHA LAINNYA"],["7010310001","Property All Risk & Fire Insurance"],["7010310002","Biaya Pajak Bumi Dan Bangunan  (PBB)"],["7020310","BIAYA USAHA LAINNYA"],["7020310003","Biaya Pajak Reklame"],["7020310004","Biaya Management FEE"],["7020310005","Biaya Asuransi Kendaraan"],["8","BEBAN  NON OPERASIONAL"],["801","PENDAPATAN DAN (BIAYA) LAIN - LAIN"],["80101","PENDAPATAN DAN (BIAYA) LAIN - LAIN"],["8010110","PENDAPATAN DAN (BIAYA) LAIN - LAIN"],["8010110001","Pendapatan Bunga Bank"],["8010110002","Selisih pembulatan"],["8010110003","Potongan Pembelian"],["8010110004","Pendapatan Sewa Gedung"],["8010110005","Pendapatan Sewa Peralatan"],["8010110006","Kehilangan Barang atau Selisih Stock Opname"],["8010110007","Pendapatan (Biaya) Lain-Lain"],["802","BIAYA BUNGA"],["80201","BIAYA BUNGA"],["8020111","BIAYA BUNGA"],["8020111001","Biaya Bunga Pinjaman Bank"],["8020111002","Biaya Bunga Leasing"],["803","PAJAK PENGHASILAN"],["80301","PAJAK PENGHASILAN"],["8030112","PAJAK PENGHASILAN"],["8030112001","Current Tax Inc/Exp PPH Pasal 25"],["204001","Giro Keluar"],["205001","Uang Muka - Penjualan"],["600104","Pendapatan lain-lain"]]
COA.forEach(r => { r[1] = r[1].replace(/\s+/g, ' ').trim() })
const COA_N = window.COA_N = Object.fromEntries(COA)
const LEAF = COA.filter(([c]) => c.length === 10)
const nm = c => COA_N[c] || GL[c] || ''
const pad2 = n => String(n).padStart(2, '0')
const pad4 = n => String(n).padStart(4, '0')
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0)
const now = () => new Date().toTimeString().slice(0, 5)
const pct = (x, base) => base ? (Math.round(x / base * 1000) / 10).toFixed(1).replace('.', ',').replace('-', '−') + '%' : ''
const STAFF_FIN = ['Lestari Handayani', 'Andreas Pratama']
const locName = l => l === '00' ? 'Head office' : STORES[+l - 1] ? `${STORES[+l - 1].code} · ${STORES[+l - 1].name}` : `C0${l} · Temanggung`
const daysOf = (y, n) => Array.from({ length: n }, (_, i) => `${y}-${pad2(i + 1)}`)
const PERI = {
  oct: { y: '2026-10', label: 'October 2026', to: addDays(TODAY, -1), days: daysOf('2026-10', daysBetween('2026-10-01', TODAY)) },
  sep: { y: '2026-09', label: 'September 2026', to: '2026-09-30', days: daysOf('2026-09', 30) },
}
const hist = (menu, action, doc) => window.FIN_HIST.unshift({ date: TODAY, time: now(), user: FIN, menu, action, doc })

/* ═════════ the statements ═════════ */
const SALES = {}
function salesOf(pk) {
  if (SALES[pk]) return SALES[pk]
  const out = {}
  STORES.forEach(s => {
    const r = { cash: 0, deb: 0, cre: 0, qr: 0, fee: 0, gross: 0, tax: 0 }
    PERI[pk].days.forEach(d => { const c = closeOf(d, s.code); r.cash += c.t.cash; r.deb += c.t.debit; r.cre += c.t.credit; r.qr += c.t.qris; r.gross += c.gross; r.tax += c.tax; r.fee += edcOf(d, s.code).fee })
    out[s.loc] = r
  })
  return SALES[pk] = out
}
const GRP = [['sales', 'Penjualan'], ['disc', 'Diskon'], ['hpp', 'HPP'], ['jual', 'Beban Penjualan'], ['adm', 'Beban Adm & Umum'], ['oth', 'Pendapatan/Biaya lain']]
const grpOf = c => /^40101/.test(c) ? 'sales' : /^40102/.test(c) ? 'disc' : c[0] === '5' ? 'hpp' : /^60101/.test(c) ? 'jual' : /^[67]/.test(c) ? 'adm' : 'oth'
const DEBIT_ACC = { BCA: '4010111001', Mandiri: '4010111002', BRI: '4010111003' }
const RENT = i => (25 + (i * 7) % 21) * 1e6
const STAFF = i => 9 + (i % 4)
const HPPR = i => .565 + ((i * 37) % 9) / 300
/* the P&L of a period, per account and location; QRIS posts to Penjualan Tunai until its slot is linked */
function plOf(pk) {
  const sep = pk === 'sep', S0 = salesOf(pk), FC = window.FIN_CLOSE || {}, L = {}
  const add = (c, loc, amt) => { if (!amt) return; (L[c] = L[c] || {})[loc] = (L[c][loc] || 0) + amt }
  const ex = x => Math.round(x * 100 / 111), D = .026
  STORES.forEach((s, i) => {
    const r = S0[s.loc], loc = s.loc
    const net = r.gross - r.tax, db = ex(r.deb), cr = ex(r.cre), tun = net - db - cr
    const dt = Math.round(tun * D), dd = Math.round(db * D), dc = Math.round(cr * D), visa = Math.round((cr + dc) * .62)
    add('4010110001', loc, tun + dt); add(DEBIT_ACC[s.edc], loc, db + dd); add('4010112001', loc, visa); add('4010112002', loc, cr + dc - visa)
    add('4010213001', loc, -(dt + dd + dc))
    add('5010110001', loc, -Math.round(net * HPPR(i)))
    add('6010111001', loc, -STAFF(i) * 3350000)
    add('6010111013', loc, -Math.round(net * .01))
    add('6010110002', loc, -r.fee)
    add('6010110001', loc, -round(net * .002, 1000))
    if (s.code !== 'C011') add('7010110003', loc, -RENT(i))
    else if (sep || FC.prepaid) add('7010110003', loc, -15000000)
    add('6010310006', loc, sep ? -1260000 : -1300000)
  })
  add('6010210001', '00', -286400000); add('6010210006', '00', -41200000)
  add('6010110003', '00', sep ? -52000000 : -65000000); add('6010110007', '00', sep ? -31200000 : -28500000)
  add('6010310001', '00', -4200000); add('6010310002', '00', sep ? -3120000 : -3480000); add('6010310004', '00', -45000); add('6010310005', '00', sep ? -6120000 : -6245000)
  add('7010110003', '00', -25000000); add('6010310006', '00', sep ? -1580000 : -1552300)
  if (sep || (FC.acc && FC.acc[1])) add('6010310007', '00', sep ? -3180000 : -3245000)
  if (sep || (FC.acc && FC.acc[2])) add('6010111002', '00', sep ? -45850000 : -46800000)
  if (!sep && FC.stock) { add('8010110006', '04', -2112000); add('8010110006', '09', -1370500) }
  add('8010110001', '00', sep ? 1196400 : 1284300); add('8010110004', '02', 1200000)
  add('8010110007', '00', sep ? 620000 : 850000); if (!sep) add('8010110007', '07', 10000000)
  const AB = window.ASSET_BOOK, y = PERI[pk].y
  ;[...AB.charges(y), ...AB.extras(y)].forEach(x => add(x.acc, x.loc, -x.amt))
  const lines = Object.keys(L).sort().map(c => ({ c, g: grpOf(c), by: L[c], tot: sum(Object.values(L[c]), x => x) }))
  const at = (g, loc) => sum(lines.filter(l => l.g === g), l => loc == null ? l.tot : (l.by[loc] || 0))
  const res = loc => { const ns = at('sales', loc) + at('disc', loc), hpp = at('hpp', loc), gp = ns + hpp, op = gp + at('jual', loc) + at('adm', loc); return { ns, hpp, gp, op, np: op + at('oth', loc), beban: at('jual', loc) + at('adm', loc) + at('oth', loc) } }
  return { lines, at, res, ...res(null), locs: [...new Set(lines.flatMap(l => Object.keys(l.by)))].sort() }
}

/* the balance sheet at 30 Sep and now; Laba ditahan at 30 Sep and Persediaan now are what balance it */
const INV_SEP = 9214380000
const SNAP = { stock: sum(BILLS.filter(b => !b.nonstock), billLeft), non: sum(BILLS.filter(b => b.nonstock), billLeft), giro: sum(GIROS.filter(g => g.state === 'with' || g.state === 'written'), g => g.amt) }
const HUT_SEP = sum(BILLS.filter(b => b.date < '2026-10-01'), b => b.total)
const GIRO_SEP = sum(GIRO_OPENING, g => g.amt)
const edcRecv = pk => sum(STORES, s => edcOf(PERI[pk].to, s.code).gross)
const cashOf = pk => sum(ACCOUNTS, a => pk === 'sep' ? a.books - a.inM + a.outM : a.books)
const TR_SEP = window.ASSET_BOOK.tranches('2026-09')
const PPN_SEP = (() => { const kel = sum(Object.values(salesOf('sep')), r => r.tax), mas = sum(BILLS.filter(b => b.date.startsWith('2026-09')), b => Math.round(b.total * 11 / 111)) + sum(TR_SEP, t => t.ppn); return { kel, mas, net: kel - mas } })()
const PPH_SEP = sum(TR_SEP, t => t.pph)
let INV_OCT = 0
const RE = { sep: 0, npSep: 0 }
function bsOf(pk) {
  const sep = pk === 'sep', AB = window.ASSET_BOOK.at(sep ? '2026-09' : '2026-10'), FC = window.FIN_CLOSE || {}, tx = sep ? null : window.FIN_TAX()
  const A = [
    ['Aktiva lancar'],
    ['Kas & Bank', '1011001', cashOf(pk)],
    ['Piutang kartu & QRIS', '1011101', edcRecv(pk)],
    ['Piutang pegawai & kepala toko', '1011102', sep ? 2650000 : 4150000],
    ['Persediaan barang dagangan', '1011201', sep ? INV_SEP : INV_OCT - (FC.stock ? 3482500 : 0)],
    ['Barang dalam perjalanan', '1011203', sep ? 31420000 : 48650000],
    ['Sewa toko bayar dimuka', '1011301', sep ? 15000000 : 60000000 - (FC.prepaid ? 15000000 : 0)],
    ['PPN Masukan', '1011302', sep ? 0 : tx.mas],
    ['Uang muka kontraktor', '1011303', AB.adv],
    ['Aktiva tetap'],
    ['Harga perolehan', '10215', AB.fixCost],
    ['Akumulasi penyusutan', '10216', -AB.fixAcc],
    ['Aktiva lain'],
    ['Pre Opening', '1031802', AB.preCost - AB.preAcc],
  ]
  const P = [
    ['Kewajiban'],
    ['Hutang supplier barang dagangan', '2012001001', sep ? HUT_SEP : SNAP.stock],
    ['Hutang supplier non barang dagang', '2012001003', sep ? 0 : SNAP.non],
    ['Outstanding giro', '2012002', sep ? GIRO_SEP : SNAP.giro],
    ['Hutang pajak', '20121', sep ? PPN_SEP.net + PPH_SEP : PPN_SEP.net + tx.kel + tx.pph],
    ['Biaya masih harus dibayar', '20122', sep ? 45850000 : (FC.acc && FC.acc[1] ? 3245000 : 0) + (FC.acc && FC.acc[2] ? 46800000 : 0)],
    ['Poin member', '2012304', sep ? 19525000 : 21640000],
    ['Ekuitas'],
    ['Modal setor', '3013001001', 6e9],
    ['Laba (rugi) ditahan', '3013001002', sep ? RE.sep : RE.sep + RE.npSep],
    ['Laba (rugi) bulan berjalan', '3013001003', plOf(pk).np],
  ]
  const tA = sum(A.filter(r => r.length > 1), r => r[2]), tP = sum(P.filter(r => r.length > 1), r => r[2])
  return { A, P, tA, tP, v: Object.fromEntries([...A, ...P].filter(r => r.length > 1).map(r => [r[1], r[2]])) }
}
RE.npSep = plOf('sep').np
{ const b = bsOf('sep'); RE.sep = b.tA - b.tP }
{ const b = bsOf('oct'); INV_OCT = b.tP - b.tA }
window.FIN_BS = { inv: () => INV_OCT - ((window.FIN_CLOSE || {}).stock ? 3482500 : 0) }

/* indirect cash flow: October from the two balance sheets; September as booked at its close */
function cfOf(pk) {
  if (pk === 'oct') {
    const a = bsOf('sep').v, b = bsOf('oct').v, d = k => b[k] - a[k], pl = plOf('oct')
    const ch = sum(window.ASSET_BOOK.charges('2026-10'), x => x.amt), nbv = v => v['10215'] + v['10216'] + v['1031802']
    return {
      op: [['Laba bersih', pl.np], ['Depresiasi & amortisasi', ch], ['Persediaan & barang dalam perjalanan', -(d('1011201') + d('1011203'))], ['Piutang kartu, QRIS & pegawai', -(d('1011101') + d('1011102'))], ['Dibayar dimuka & PPN Masukan', -(d('1011301') + d('1011302'))], ['Hutang supplier & giro', d('2012001001') + d('2012001003') + d('2012002')], ['Hutang pajak, biaya masih harus dibayar & poin', d('20121') + d('20122') + d('2012304')]],
      inv: [['Aktiva tetap & Pre Opening', -(nbv(b) - nbv(a) + ch)], ['Uang muka kontraktor', -d('1011303')]],
      open: a['1011001'], close: b['1011001'], from: '1 Oct', to: dayS(PERI.oct.to),
    }
  }
  const ch = sum(window.ASSET_BOOK.charges('2026-09'), x => x.amt)
  const op = [['Laba bersih', RE.npSep], ['Depresiasi & amortisasi', ch], ['Persediaan & barang dalam perjalanan', -142600000], ['Piutang kartu, QRIS & pegawai', 3850000], ['Dibayar dimuka & PPN Masukan', 15000000], ['Hutang supplier & giro', -38420000], ['Hutang pajak, biaya masih harus dibayar & poin', 21300000]]
  const inv = [['Aktiva tetap & Pre Opening', 0], ['Uang muka kontraktor', -sum(TR_SEP, t => t.dpp)]]
  const close = cashOf('sep')
  return { op, inv, open: close - sum([...op, ...inv], x => x[1]), close, from: '1 Sep', to: '30 Sep' }
}

/* gross margin by article: the period's net sales and HPP spread over the articles sold */
const ART_W = [9, 7, 12, 8, 5, 4, 6, 4, 5, 6, 9, 10]
const ART_R = [.55, .6, .52, .58, .57, .62, .6, .56, .54, .59, .5, .53]
function gmOf(pk) {
  const pl = plOf(pk), W = sum(ART_W, x => x)
  let left = pl.ns
  const rows = ARTICLES.map((a, i) => { const s = i === ARTICLES.length - 1 ? left : Math.round(pl.ns * ART_W[i] / W); left -= s; return { a, i, s, raw: s * ART_R[i] } })
  const k = -pl.hpp / sum(rows, r => r.raw)
  let hl = -pl.hpp
  rows.forEach((r, i) => { r.h = i === rows.length - 1 ? hl : Math.round(r.raw * k); hl -= r.h; r.pcs = Math.round(r.s / (r.a[2] * 100 / 111 * .974)) })
  return { pl, rows }
}

/* ═════════ Reports ═════════ */
const REPS = [['pl', 'Profit and loss'], ['bs', 'Balance sheet'], ['cf', 'Cash flow'], ['gm', 'Gross margin by article']]
function plRows(pl, loc) {
  const v = l => loc == null ? l.tot : (l.by[loc] || 0)
  const r = pl.res(loc), out = []
  const sub = (label, x) => out.push({ c: { n: `<span class="nm">${label}</span>`, a: `<span class="nm">${money(x)}</span>`, p: `<span class="nm">${pct(x, r.ns)}</span>` } })
  GRP.forEach(([g, label]) => {
    const ls = pl.lines.filter(l => l.g === g && v(l))
    if (!ls.length) return
    out.push({ group: label })
    ls.forEach(l => out.push({ on: "go('ledger','sub')", c: { n: esc(nm(l.c)), k: `<span class="mute">${l.c}${loc || ''}</span>`, a: money(v(l)), p: `<span class="mute">${pct(v(l), r.ns)}</span>` } }))
    if (g === 'disc') sub('Penjualan bersih', r.ns)
    if (g === 'hpp') sub('Laba kotor', r.gp)
    if (g === 'adm') sub('Laba usaha', r.op)
  })
  return { rows: out, r }
}
const plTable = (pl, loc) => { const { rows, r } = plRows(pl, loc); return table({ cols: [{ l: 'Account', k: 'n' }, { l: 'Kode', k: 'k', w: 150 }, { l: 'Amount', k: 'a', num: 1, w: 180 }, { l: 'Of sales', k: 'p', num: 1, w: 110 }], rows, foot: { n: 'Laba bersih', a: money(r.np), p: pct(r.np, r.ns) } }) }
function bsTable(rows, total, label) {
  return table({
    cols: [{ l: label, k: 'n' }, { l: 'Amount', k: 'a', num: 1, w: 180 }],
    rows: rows.map(r => r.length === 1 ? { group: r[0] } : { on: "go('ledger','sub')", c: { n: `${esc(r[0])} <span class="mute">${r[1]}</span>`, a: money(r[2]) } }),
    foot: { n: `Total ${label.toLowerCase()}`, a: money(total) },
  })
}
function cfTable(cf) {
  const op = sum(cf.op, x => x[1]), inv = sum(cf.inv, x => x[1])
  const line = ([n, a]) => ({ c: { n: esc(n), a: a ? money(a) : DASH } })
  const b = (n, a) => ({ c: { n: `<span class="nm">${n}</span>`, a: `<span class="nm">${money(a)}</span>` } })
  return table({
    cols: [{ l: 'Line', k: 'n' }, { l: 'Amount', k: 'a', num: 1, w: 180 }],
    rows: [{ group: 'Operasi' }, ...cf.op.map(line), b('Kas dari operasi', op), { group: 'Investasi' }, ...cf.inv.map(line), b('Kas untuk investasi', inv),
      { group: 'Kas & bank' }, line(['Kenaikan kas & bank', op + inv]), line([`Kas & bank ${cf.from}`, cf.open])],
    foot: { n: `Kas & bank ${cf.to}`, a: money(cf.open + op + inv) },
  })
}
reg({
  id: 'reports', group: 'rep', label: 'Reports',
  s7: [['Laporan Accounting', 'ix-acc'], ['Laporan Keuangan', 'ix-keu'], ['Laporan Manajerial', 'ix-man'], ['Laporan Kas/Bank', 'ix-kas'], ['Laporan Pembelian', 'ix-buy'], ['Laporan Penjualan', 'ix-sell'], ['Neraca', 'bs'], ['Laba Rugi', 'pl'], ['Arus Kas', 'cf']],
  render() {
    const id = 'reports'
    let tab = tabOf(id, 'stmt')
    if (tab.startsWith('ix-')) { S.f[id] = { ...(S.f[id] || {}), grp: tab.slice(3) }; S.q[id] = ''; tab = S.tab[id] = 'index' }
    if (REPS.some(r => r[0] === tab)) { S.f[id] = { ...(S.f[id] || {}), rep: tab }; tab = S.tab[id] = 'stmt' }
    let kpis, body, actions = []
    if (tab === 'stmt') {
      const rep = filt(id, 'rep', 'pl'), pk = filt(id, 'per', 'oct'), view = filt(id, 'view', 'all'), P = PERI[pk]
      const pl = plOf(pk), bs = bsOf(pk)
      kpis = [
        { label: 'Penjualan bersih', value: money(pl.ns) },
        { label: 'Laba kotor', value: money(pl.gp) },
        { label: 'Laba bersih', value: money(pl.np), tone: pl.np < 0 ? 'bad' : '' },
        { label: `Kas & Bank · ${dayS(P.to)}`, value: money(bs.v['1011001']) },
      ]
      const label = REPS.find(r => r[0] === rep)[1]
      actions = [{ label: 'Export XLS', icon: 'download', on: `repXls('${label}','${P.label}')` }]
      let inner
      if (rep === 'pl' && view === 'shop') {
        const locs = pl.locs
        inner = table({
          cols: [{ l: 'Shop', k: 's' }, { l: 'Penjualan bersih', k: 'ns', num: 1, w: 170 }, { l: 'HPP', k: 'h', num: 1, w: 170 }, { l: 'Laba kotor', k: 'gp', num: 1, w: 170 }, { l: 'Beban', k: 'b', num: 1, w: 170 }, { l: 'Laba bersih', k: 'np', num: 1, w: 170 }],
          rows: locs.map(l => { const r = pl.res(l); return { on: `repShop('${pk}','${l}')`, c: { s: `<span class="nm">${locName(l)}</span>`, ns: r.ns ? money(r.ns) : DASH, h: r.hpp ? money(r.hpp) : DASH, gp: r.gp ? money(r.gp) : DASH, b: money(r.beban), np: money(r.np) } } }),
          foot: { s: plural(locs.length, 'place'), ns: money(pl.ns), h: money(pl.hpp), gp: money(pl.gp), b: money(pl.beban), np: money(pl.np) },
        })
      } else if (rep === 'pl') inner = plTable(pl)
      else if (rep === 'bs') inner = `<div class="two">${bsTable(bs.A, bs.tA, 'Aktiva')}${bsTable(bs.P, bs.tP, 'Kewajiban & ekuitas')}</div>`
      else if (rep === 'cf') inner = cfTable(cfOf(pk))
      else {
        const g = gmOf(pk)
        inner = table({
          cols: [{ l: 'Article', k: 'a' }, { l: 'Pieces', k: 'q', num: 1, w: 100 }, { l: 'Penjualan bersih', k: 's', num: 1, w: 170 }, { l: 'HPP', k: 'h', num: 1, w: 170 }, { l: 'Laba kotor', k: 'g', num: 1, w: 170 }, { l: 'Margin', k: 'm', num: 1, w: 100 }],
          rows: g.rows.map(r => ({ on: `repArt('${pk}',${r.i})`, c: { a: `<span class="nm">${esc(r.a[1])}</span> <span class="mute">${r.a[0]}</span>`, q: num(r.pcs), s: money(r.s), h: money(-r.h), g: money(r.s - r.h), m: pct(r.s - r.h, r.s) } })),
          foot: { a: plural(g.rows.length, 'article'), q: num(sum(g.rows, r => r.pcs)), s: money(pl.ns), h: money(pl.hpp), g: money(pl.gp), m: pct(pl.gp, pl.ns) },
        })
      }
      body = bar(chips(id, 'rep', REPS, 'pl'), selectBox([['oct', 'October 2026'], ['sep', 'September 2026']], pk, `setFilt('${id}','per',this.value)`),
        rep === 'pl' ? seg(id, 'view', [['all', 'Combined'], ['shop', 'By shop']], 'all') : '', spacer,
        `<span class="bar-count">${pk === 'oct' ? `1–${+P.to.slice(8)} Oct` : '1–30 Sep · closed'}</span>`, lnk('Print', `soon('Print ${label}, ${P.label}')`, 'printer')) + inner
    } else {
      const grp = filt(id, 'grp', 'all'), toks = (S.q[id] || '').toLowerCase().split(/\s+/).filter(Boolean)
      const match = r => toks.every(t => /^\d+$/.test(t) ? (r.lo <= +t && +t <= r.hi) : r.hay.includes(t))
      const rows = IX.filter(r => (grp === 'all' || r.g === grp) && match(r))
      const n = g => IX.filter(r => r.g === g).length
      body = bar(chips(id, 'grp', [['all', 'All', IX.length], ...Object.entries(IXG).map(([k, l]) => [k, l, n(k)])], 'all'), search(id, 'Type a 7Soft name or number, e.g. laporan 7'), spacer, `<span class="bar-count">${plural(rows.length, 'report')}</span>`)
        + table({
          cols: [{ l: 'Group', k: 'g', w: 140 }, { l: 'No', k: 'n', w: 80 }, { l: '7Soft name', k: 'l' }, { l: 'Opens in', k: 'o', w: 330 }, { l: '', k: 'act', cls: 'act', w: 100 }],
          rows: rows.map(r => ({ on: r.d ? r.d[1] : '', cls: r.d ? '' : 'dim', c: { g: IXG[r.g], n: `<span class="ds-num">${r.no}</span>`, l: `<span class="nm">${esc(r.name)}</span>`, o: r.d ? esc(r.d[0]) : '<span class="mute">Not used — no credit sales</span>', act: r.d ? lnk('Open', r.d[1]) : '' } })),
          empty: 'No 7Soft report by that name or number',
        })
    }
    return page({ title: 'Reports', actions, tabs: [['stmt', 'Statements'], ['index', '7Soft numbers', IX.length]], tab, kpis, body })
  },
})
function repShop(pk, loc) {
  const pl = plOf(pk), r = pl.res(loc)
  openSheet({
    size: 'record', crumb: ['Reports', `Profit and loss · ${PERI[pk].label}`], title: locName(loc),
    body: `${kpisHTML([{ label: 'Penjualan bersih', value: r.ns ? money(r.ns) : '—' }, { label: 'Laba kotor', value: r.ns ? money(r.gp) : '—' }, { label: 'Laba bersih', value: money(r.np), tone: r.np < 0 ? 'bad' : '' }, { label: 'Of sales', value: r.ns ? pct(r.np, r.ns) : '—' }])}${plTable(pl, loc)}`,
    foot: `<div class="foot-left">${lnk('Print', `soon('Print the P&L of ${locName(loc)}')`, 'printer')}</div>${btn('Open Buku Besar Pembantu', "go('ledger','sub')")}`,
  })
}
function repArt(pk, i) {
  const g = gmOf(pk), r = g.rows[i], pl = g.pl
  const locs = pl.locs.filter(l => l !== '00' && pl.res(l).ns)
  let ls = r.s, lh = r.h, lq = r.pcs
  const rows = locs.map((l, j) => { const last = j === locs.length - 1, w = pl.res(l).ns / pl.ns, s = last ? ls : Math.round(r.s * w), h = last ? lh : Math.round(r.h * w), q = last ? lq : Math.round(r.pcs * w); ls -= s; lh -= h; lq -= q; return { l, s, h, q } })
  openSheet({
    size: 'wide', crumb: ['Reports', `Gross margin · ${PERI[pk].label}`], title: esc(r.a[1]), pill: `<span class="code">${r.a[0]}</span>`,
    body: `${kpisHTML([{ label: 'Pieces', value: num(r.pcs) }, { label: 'Penjualan bersih', value: money(r.s) }, { label: 'Laba kotor', value: money(r.s - r.h) }, { label: 'Margin', value: pct(r.s - r.h, r.s) }])}
      ${table({
        cols: [{ l: 'Shop', k: 's' }, { l: 'Pieces', k: 'q', num: 1, w: 100 }, { l: 'Penjualan bersih', k: 'n', num: 1, w: 170 }, { l: 'Laba kotor', k: 'g', num: 1, w: 170 }],
        rows: rows.map(x => ({ c: { s: locName(x.l), q: num(x.q), n: money(x.s), g: money(x.s - x.h) } })),
        foot: { s: plural(rows.length, 'shop'), q: num(r.pcs), n: money(r.s), g: money(r.s - r.h) },
      })}`,
    foot: `<div class="foot-left">${lnk('Print', "soon('Print the article margin')", 'printer')}</div>`,
  })
}
function repXls(label, per) { hist('Reports', 'Exported', `${label} ${per} · XLS`); toast(`${label} · ${per}.xlsx`, 'Prototype: nothing is saved') }
function repGo(rep, view) { S.f.reports = { ...(S.f.reports || {}), rep }; if (view) S.f.reports.view = view; go('reports', 'stmt') }
function repME(k) { go('month-end', 'check'); setTimeout(() => window.mendOpen && window.mendOpen(k), 30) }

/* ═════════ 7Soft's numbered reports and where each lands ═════════ */
const D7 = {
  acc: ['Cash & Bank', "go('accounts')"], kartu: ['Cash & Bank · Kartu', "go('accounts')"], bkk: ['BKK', "go('bkk')"], bkm: ['BKM', "go('bkm')"], giro: ['Giro', "go('giro')"],
  bills: ['Bills', "go('bills')"], sup: ['Suppliers', "go('suppliers')"],
  days: ['Daily close · Days', "go('daily-close','days')"], rec: ['Daily close · Receipts', "go('daily-close','receipts')"], ret: ['Returns — goods swapped, no refund', "go('daily-close','returns')"],
  ju: ['Journal', "go('journal')"], sub: ['Ledger · Buku Besar Pembantu', "go('ledger','sub')"], ns: ['Ledger · Neraca Saldo', "go('ledger')"],
  pl: ['Reports · Profit and loss', "repGo('pl','all')"], shop: ['Reports · Profit and loss by shop', "repGo('pl','shop')"], bs: ['Reports · Balance sheet', "repGo('bs')"], cf: ['Reports · Cash flow', "repGo('cf')"], gm: ['Reports · Gross margin by article', "repGo('gm')"],
  reg: ['Assets · Register', "go('assets','reg')"], depr: ['Assets · Depreciation', "go('assets','depr')"], prj: ['Assets · Projects', "go('assets','prj')"],
  tax: ['Month end · PPN and PPh 23', "repME('tax')"], stock: ['Month end · Stock vs ledger', "repME('stock')"], coa: ['Setup · Account', "suGo('coa')"],
  po: ['Purchasing · PO, outside Finance', "soon('Purchasing opens outside Finance')"], price: ['Catalogue · Prices, outside Finance', "soon('Catalogue opens outside Finance')"],
}
const IXG = { kas: 'Kas/Bank', buy: 'Pembelian', sell: 'Penjualan', acc: 'Accounting', keu: 'Keuangan', man: 'Manajerial' }
const IX = []
const ix = (g, list) => list.forEach(([no, name, d]) => { const [lo, hi] = String(no).split('–').map(Number); IX.push({ g, no: String(no), lo, hi: hi || lo, name, d: d ? D7[d] : null, hay: `laporan ${IXG[g]} ${name} ${d ? D7[d][0] : 'not used'}`.toLowerCase() }) })
const seq = (names, dests, from = 1) => names.map((n, i) => [from + i, n, dests[i]])
ix('kas', seq(['Laporan Harian Kas & Bank', 'Laporan Harian Kas-Bank Detail', 'Laporan Harian Kas-Bank Detail Per Transaksi', 'Laporan Kas-Bank Detail Per Transaksi Periodik', 'Laporan Kas-Bank Per Periode', 'Laporan Kas-Bank Per Periode Detail', 'Summary Pelunasan Piutang', 'Detail Pelunasan Piutang', 'Summary Pelunasan Hutang', 'Detail Pelunasan Hutang', 'Summary Bukti Kas Masuk (BKM)', 'Detail Bukti Kas Masuk (BKM)', 'Summary Bukti Kas Keluar (BKK)', 'Detail Bukti Kas Keluar (BKK)', 'Laporan Giro Masuk', 'Laporan Giro Keluar', 'Laporan Giro Masuk Belum Cair', 'Laporan Giro Keluar Belum Cair', 'Laporan Perincian Tolakan Giro Masuk', 'Laporan Perincian Tolakan Giro Keluar'],
  ['acc', 'kartu', 'kartu', 'kartu', 'acc', 'kartu', '', '', 'bkk', 'bkk', 'bkm', 'bkm', 'bkk', 'bkk', '', 'giro', '', 'giro', '', 'giro']))
ix('buy', [...seq(['Laporan Harian Detail Pembelian Item', 'Laporan Pembelian Bulanan', 'Summary Pembelian', 'Rekap Detail Faktur Pembelian', 'Laporan Barang Datang (Nilai)', 'Laporan Harian Pembelian Item Detail Supplier', 'Laporan Harian Pembelian Per Supplier Detail Item', 'Laporan Bulanan Pembelian Item Detail Supplier', 'Laporan Bulanan Pembelian Per Supplier Detail Item', 'Laporan Daftar Harga', 'Laporan History Harga Pembelian', 'Summary Pembelian PPN'],
  ['bills', 'bills', 'bills', 'bills', 'bills', 'sup', 'sup', 'sup', 'sup', 'price', 'bills', 'tax']),
  ['13–16', 'Uang Muka Pembelian · 4 laporan', 'prj'], ['17–21', 'PO · 5 laporan', 'po'], ['22–23', 'Retur Pembelian · 2 laporan', 'bills'], ['24–33', 'Hutang dagang · 10 laporan', 'sup']])
ix('sell', [...seq(['Laporan Harian Detail Penjualan Item', 'Summary Penjualan', 'Cetak Invoice Penjualan', 'Laporan Nota Penjualan', 'Rekap Detail Faktur Penjualan', 'Laporan Nilai Surat Jalan', 'Laporan Penjualan tiap User', 'Laporan Penjualan Bulanan', 'Summary Penjualan PPN', 'Penjualan Barang dan Jasa'],
  ['rec', 'days', 'rec', 'rec', 'rec', '', 'rec', 'shop', 'tax', 'pl']),
  ['11–14', 'Penjualan per customer · 4 laporan', ''], ['15–20', 'SO dan Surat Jalan · 6 laporan', ''], ['21–27', 'Komisi dan omzet sales · 7 laporan', ''], [28, 'Laporan Omset Penjualan Per Kota', 'shop'], ['29–32', 'Uang Muka Penjualan · 4 laporan', ''],
  [33, 'Laporan Summary Retur Penjualan', 'ret'], [34, 'Laporan Detail Retur Penjualan', 'ret'], ['35–42', 'Piutang dagang · 8 laporan', ''], [43, 'Laporan Detail Pelunasan Nota Penjualan', ''], [44, 'List Customer', '']])
ix('acc', seq(['Perhitungan HPP', 'Laporan Jurnal', 'Laporan Jurnal Pembelian', 'Laporan Jurnal Penjualan', 'Laporan Jurnal Persediaan', 'Laporan Jurnal Pengeluaran Kas (BKK)', 'Laporan Jurnal Penerimaan Kas (BKM)', 'Buku Besar Pembantu', 'Laporan Persediaan Akhir Bulan', 'Laporan Master Account', 'Laporan Aktiva Tetap dan Penyusutan', 'Laporan Aktiva Tetap dan Penyusutan Tahunan'],
  ['gm', 'ju', 'ju', 'ju', 'ju', 'ju', 'ju', 'sub', 'stock', 'coa', 'reg', 'depr']))
ix('keu', seq(['Laba/Rugi Penjualan Per Item', 'Laba Rugi Item / Barang', 'Laba Rugi Customer', 'Laba Rugi Nota', 'Laporan Laba Rugi Per sales', 'Laba Rugi GL', 'Laba Rugi (Barang)', 'Laba Rugi Tahunan', 'Neraca Saldo', 'Laporan Neraca Ke Kanan', 'Laporan Neraca Standard', 'Laporan Neraca Perbandingan 2 Bulan', 'Laporan Neraca (Common Sized)', 'Laporan Neraca Tahunan', 'Laporan Arus Kas'],
  ['gm', 'gm', '', 'rec', '', 'pl', 'gm', 'pl', 'ns', 'bs', 'bs', 'bs', 'bs', 'bs', 'cf']))
ix('man', seq(['Laporan Fast Moving Item', 'Laporan Fast Moving Kelompok Item', 'Laporan Slow Moving Item', 'Laporan 10 Top Customer'], ['gm', 'gm', 'gm', '']))
/* ⌘K finds them too: "Laporan Kas/Bank 7 · Summary Pelunasan Piutang" */
IX.forEach(r => window.PAL_DOCS.push({ doc: 1, t: `Laporan ${IXG[r.g]} ${r.no} · ${r.name}`, g: r.d ? r.d[0] : 'Not used — no credit sales', go: () => { if (r.d) Function(r.d[1])(); else { S.f.reports = { ...(S.f.reports || {}), grp: r.g }; S.q.reports = r.name; go('reports', 'index') } } }))

/* ═════════ Setup ═════════ */
const TIPE = [['1011001', 'Kas/Bank'], ['1011002', 'Kas/Bank'], ['1011003', 'Kas/Bank'], ['1011004', 'Kas/Bank'], ['101', 'Aktiva Lancar'], ['10214', 'Aktiva Lain-lain'], ['10215', 'Aktiva Tetap'], ['10216', 'Aktiva Tetap'], ['10217', 'Aktiva Tak Berwujud'], ['103', 'Aktiva Lain-lain'], ['1', 'Aktiva Lancar'],
  ['20121', 'Hutang Pajak'], ['20122', 'Biaya Masih Harus Dibayar'], ['20125', 'Pinjaman'], ['202', 'Pinjaman'], ['2', 'Hutang'], ['3', 'Modal'], ['4', 'Pendapatan'], ['5', 'HPP'], ['6', 'Biaya'], ['7', 'Biaya'], ['8', 'Lain-lain']].sort((a, b) => b[0].length - a[0].length)
const tipeOf = c => (TIPE.find(([p]) => c.startsWith(p)) || [0, ''])[1]
const OFF = new Set(['1011004004', '1021504002', '1021504003', '1021604002', '1021604003', '7010212002', '7010212003', '1021702002', '1021701002', '7010216003', '1021505002', '1021605002', '7010213002'])
const SLOTS = [
  ['Default Kas Kecil', '1011001002', 'BKK · petty cash'], ['Disc Pembelian', '8010110003', 'Bills'], ['Disc Penjualan', '4010213001', 'Daily close'], ['HPP', '5010110001', 'Daily close'],
  ['Hutang', '2012001001', 'Bills · BKK'], ['Hutang Suspend', '2012001002', 'Bills'], ['Laba', '3013001003', 'Month end'], ['Laba Ditahan', '3013001002', 'Year end'],
  ['Pembelian Jasa', '6010310099', 'Bills · non-stock'], ['Penjualan Tunai', '4010110001', 'Daily close'], ['Penjualan Debit', '4010111001', 'Daily close · by EDC bank'], ['Penjualan Kartu Kredit', '4010112001', 'Daily close'],
  ['Penjualan QRIS', null, 'Daily close'], ['Persediaan Barang', '1011201001', 'Bills · Daily close'], ['Potongan Hutang', '8010110003', 'BKK'], ['Potongan Piutang', null, 'BKM'],
  ['PPN Pembelian', '1011302004', 'Bills'], ['PPN Penjualan', '2012101003', 'Daily close'], ['Retur Pembelian', '1011201001', 'Bills · returns'], ['Retur Penjualan', '4010214001', 'Daily close · Returns'],
  ['Stok Opname', '8010110006', 'Month end · Stock vs ledger'], ['Uang Muka Pembelian', '1011303003', 'Assets · Projects'], ['Selisih Kas', '8010110002', 'Daily close · cash difference'],
]
const TAXES = [['PPN 12%', '12%', '11/12', '11%', '2012101003', '1011302004'], ['PPN 0%', '0%', DASH, '0%', null, null, 1], ['PPh 23', '2%', 'Full', '2%', '2012101002', null], ['PPh 4(2) sewa', '10%', 'Full', '10%', null, null]]
const TERMS = [['T7', 7], ['T14', 14], ['T30', 30], ['T45', 45]]
const GROUPS_U = { head: ['Finance Head', [FIN]], staff: ['Finance Staff', STAFF_FIN], store: ['Kepala Toko', PEOPLE], audit: ['Auditor', ['Lina Marlina']] }
window.FIN_HIST = [
  { date: '2026-10-27', time: '16:42', user: FIN, menu: 'BKK', action: 'Added', doc: 'BKK/HO/2610/0061' },
  { date: '2026-10-27', time: '10:15', user: FIN, menu: 'BKK', action: 'Added', doc: 'BKK/HO/2610/0060' },
  { date: '2026-10-27', time: '08:05', user: STAFF_FIN[0], menu: 'BKM', action: 'Added', doc: 'BKM/HO/2610/0024' },
  { date: '2026-10-26', time: '16:20', user: STAFF_FIN[0], menu: 'Account', action: 'Edited', doc: '6010110002 · Biaya Credit Card' },
  { date: '2026-10-26', time: '14:03', user: FIN, menu: 'BKK', action: 'Added', doc: 'BKK/HO/2610/0059' },
  { date: '2026-10-26', time: '11:12', user: FIN, menu: 'Setting COA', action: 'Edited', doc: 'Penjualan Debit → 4010111001' },
  { date: '2026-10-25', time: '15:30', user: FIN, menu: 'Pajak', action: 'Edited', doc: 'PPN 12% · DPP 11/12' },
  { date: '2026-10-24', time: '09:48', user: FIN, menu: 'User & Group', action: 'Edited', doc: 'Kepala Toko · Store cash' },
  { date: '2026-10-22', time: '10:05', user: STAFF_FIN[1], menu: 'Bills', action: 'Added', doc: 'FB/HO/2610/0144' },
  { date: '2026-10-21', time: '16:02', user: STAFF_FIN[1], menu: 'Giro', action: 'Edited', doc: 'BG 202517 · Bounced' },
  { date: '2026-10-18', time: '17:20', user: STAFF_FIN[0], menu: 'BKM', action: 'Deleted', doc: 'BKM/HO/2610/0018 · draft' },
  { date: '2026-10-12', time: '10:44', user: FIN, menu: 'BKK', action: 'Edited', doc: 'BKK/HO/2610/0048 · Void' },
  { date: '2026-10-10', time: '09:15', user: FIN, menu: 'Reports', action: 'Exported', doc: 'Balance sheet September 2026 · XLS' },
  { date: '2026-10-09', time: '17:40', user: FIN, menu: 'Month end', action: 'Edited', doc: 'Closed September 2026' },
  { date: '2026-10-09', time: '11:02', user: STAFF_FIN[0], menu: 'Month end', action: 'Exported', doc: 'Coretax XML · September 2026' },
  { date: '2026-10-01', time: '08:30', user: FIN, menu: 'Saldo Awal COA', action: 'Edited', doc: 'Saldo awal 1 Oct 2026' },
]
const PERM = {}
const permOf = (g, sid) => {
  const k = g + sid
  if (PERM[k]) return PERM[k]
  const sc = SCREENS.find(s => s.id === sid) || {}
  return PERM[k] = g === 'head' ? [1, 1, 1, 1] : g === 'audit' ? [1, 0, 0, 0] : g === 'staff' ? (sc.group === 'setup' ? [1, 0, 0, 0] : sid === 'month-end' ? [1, 0, 1, 0] : [1, 1, 1, 0]) : (sid === 'daily-close' ? [1, 0, 0, 0] : sid === 'store-cash' ? [1, 1, 0, 0] : [0, 0, 0, 0])
}
/* Saldo Awal COA at 1 Oct 2026: the 30 Sep balance sheet, account by account */
const SA = (() => {
  const v = {}, put = (c, x) => { if (x) v[c] = (v[c] || 0) + x }
  ACCOUNTS.forEach(a => put(a.code.slice(0, 10), a.books - a.inM + a.outM))
  STORES.forEach(s => { const c = closeOf(PERI.sep.to, s.code); put('1011101001', c.t.credit); put('1011101002', c.t.debit + c.t.qris) })
  put('1011102001', 1150000); put('1011102002', 1500000); put('1011201001', INV_SEP); put('1011203004', 18200000); put('1011203011', 13220000); put('1011301003', 15000000)
  const AB = window.ASSET_BOOK.at('2026-09')
  put('1011303003', AB.adv); Object.entries(AB.byAcc).forEach(([c, x]) => put(c, x))
  put('2012001001', -HUT_SEP); GIRO_OPENING.forEach(g => put(g.bank === 'BCA' ? '2012002001' : g.bank === 'Mandiri' ? '2012002002' : '2012002003', -g.amt))
  put('2012101003', -PPN_SEP.net); put('2012101002', -PPH_SEP); put('2012201001', -45850000); put('2012304001', -19525000)
  put('3013001001', -6e9); put('3013001002', -(RE.sep + RE.npSep))
  return v
})()
const SU = { coa: { q: '', open: new Set() }, sa: { f: 'bal', q: '' }, hist: { f: 'all', q: '' }, users: { g: 'head' } }
const chipsSu = (k, key, opts) => `<div class="chips" role="radiogroup">${opts.map(([v, l, n]) => `<button class="chip" type="button" role="radio" aria-checked="${SU[k][key] === v}" onclick="suSet('${k}','${key}','${v}')">${l}${n != null ? ` <span class="n">${n}</span>` : ''}</button>`).join('')}</div>`
const searchSu = (k, ph) => `<label class="ds-search">${ico('search')}<input type="search" placeholder="${ph}" value="${esc(SU[k].q)}" oninput="suQ('${k}',this.value)"></label>`
const yes = on => on ? 'Yes' : '<span class="mute">No</span>'

function suTable(k) {
  if (k === 'coa') {
    const q = SU.coa.q.trim().toLowerCase(), lvl = c => ({ 1: 0, 3: 1, 5: 2, 7: 3, 10: 4 })[c.length]
    const shown = q ? COA.filter(([c, n]) => c.startsWith(q) || n.toLowerCase().includes(q))
      : COA.filter(([c]) => c.length <= 5 || [...SU.coa.open].some(g => c.startsWith(g)))
    return table({
      cols: [{ l: 'Kode', k: 'c', w: 170 }, { l: 'Account', k: 'n' }, { l: '7Soft Tipe', k: 't', w: 230 }, { l: 'Aktif', k: 'a', w: 100 }],
      rows: shown.slice(0, 400).map(([c, n]) => {
        const leaf = c.length === 10, fold = c.length === 5 && !q
        return { on: fold ? `suCoa('${c}')` : leaf ? "go('ledger','sub')" : '', c: { c: `<span class="${leaf ? 'mute' : 'nm'}">${c}</span>`, n: `<span style="padding-left:${lvl(c) * 20}px" class="${leaf ? '' : 'nm'}">${fold ? ico(SU.coa.open.has(c) ? 'chevron-down' : 'chevron-right') + ' ' : ''}${esc(n)}</span>`, t: leaf ? tipeOf(c) : '<span class="mute">Group</span>', a: leaf ? yes(!OFF.has(c)) : '' } }
      }),
      empty: 'No account by that code or name',
    })
  }
  if (k === 'sa') {
    const q = SU.sa.q.trim().toLowerCase()
    const rows = LEAF.filter(([c]) => SU.sa.f === 'all' || SA[c]).filter(([c, n]) => !q || c.startsWith(q) || n.toLowerCase().includes(q))
    const D = sum(Object.values(SA), x => x > 0 ? x : 0), K = sum(Object.values(SA), x => x < 0 ? -x : 0)
    return table({
      cols: [{ l: 'Kode', k: 'c', w: 150 }, { l: 'Account', k: 'n' }, { l: '7Soft Tipe', k: 't', w: 210 }, { l: 'Debet', k: 'd', num: 1, w: 180 }, { l: 'Kredit', k: 'k', num: 1, w: 180 }],
      rows: rows.map(([c, n]) => ({ on: SA[c] ? "go('ledger','sub')" : '', cls: SA[c] ? '' : 'dim', c: { c: `<span class="mute">${c}</span>`, n: esc(n), t: tipeOf(c), d: SA[c] > 0 ? money(SA[c]) : '', k: SA[c] < 0 ? money(-SA[c]) : '' } })),
      foot: { c: '', n: `Total · Selisih ${dots(D - K)}`, d: money(D), k: money(K) },
      empty: 'No account by that code or name',
    })
  }
  if (k === 'hist') {
    const q = SU.hist.q.trim().toLowerCase(), H = window.FIN_HIST
    const rows = H.filter(h => SU.hist.f === 'all' || h.action === SU.hist.f).filter(h => !q || [h.user, h.menu, h.action, h.doc].some(x => x.toLowerCase().includes(q)))
    const onOf = h => { const m = h.doc.match(/^(BKK|BKM)\/HO\/\d{4}\/\d{4}/); if (m && docOf(m[0])) return `openDoc('${m[1].toLowerCase()}','${m[0]}')`; const b = h.doc.match(/^FB\/HO\/\d{4}\/\d{4}/); return b ? `finGoBill('${b[0]}')` : '' }
    return table({
      cols: [{ l: 'Date', k: 'd', w: 130 }, { l: 'User', k: 'u', w: 200 }, { l: 'Menu', k: 'm', w: 170 }, { l: 'Action', k: 'a', w: 120 }, { l: 'Document', k: 'x' }],
      rows: rows.map(h => ({ on: onOf(h), c: { d: `${dayS(h.date)} <span class="mute">${h.time}</span>`, u: esc(h.user), m: esc(h.menu), a: h.action, x: `<span class="one">${esc(h.doc)}</span>` } })),
      empty: 'No change matches',
    })
  }
  if (k === 'users') {
    const g = SU.users.g
    const rows = []
    GROUPS.forEach(([gk, gl]) => {
      const xs = SCREENS.filter(s => s.group === gk)
      if (!xs.length) return
      if (gl) rows.push({ group: gl })
      xs.forEach(s => { const p = permOf(g, s.id); rows.push({ c: { m: `<span class="nm">${esc(s.label)}</span>`, ...Object.fromEntries(['v', 't', 'e', 'h'].map((x, i) => [x, `<input type="checkbox" class="cb" ${p[i] ? 'checked' : ''} aria-label="${esc(s.label)} ${x}" onchange="suPerm('${g}','${s.id}',${i},this.checked)">`])) } }) })
    })
    return `<div class="note-line" style="margin:0 0 14px">${ico('users')}<span>${GROUPS_U[g][1].length > 4 ? `${GROUPS_U[g][1].length} people · one per shop` : GROUPS_U[g][1].map(esc).join(' · ')}</span></div>`
      + table({ cols: [{ l: 'Menu', k: 'm' }, { l: 'View', k: 'v', w: 110, cls: 'ck' }, { l: 'Tambah', k: 't', w: 110, cls: 'ck' }, { l: 'Edit', k: 'e', w: 110, cls: 'ck' }, { l: 'Hapus', k: 'h', w: 110, cls: 'ck' }], rows })
  }
}
function suChips(k) {
  if (k === 'sa') return chipsSu('sa', 'f', [['bal', 'With a balance', Object.keys(SA).length], ['all', 'All', LEAF.length]])
  if (k === 'hist') { const H = window.FIN_HIST; return chipsSu('hist', 'f', [['all', 'All', H.length], ...['Added', 'Edited', 'Deleted', 'Exported'].map(a => [a, a, H.filter(h => h.action === a).length])]) }
  if (k === 'users') return chipsSu('users', 'g', Object.entries(GROUPS_U).map(([v, [l, ms]]) => [v, l, ms.length]))
  return ''
}
const suBody = (k, ph) => `<div class="ds-bar"><span id="su-chips-${k}">${suChips(k)}</span>${ph ? searchSu(k, ph) : ''}</div><div id="su-tbl-${k}">${suTable(k)}</div>`
function suDraw(k, chipsToo) {
  const t = document.getElementById('su-tbl-' + k); if (t) t.innerHTML = suTable(k)
  const c = document.getElementById('su-chips-' + k); if (c && chipsToo) c.innerHTML = suChips(k)
}
const suSet = (k, key, v) => { SU[k][key] = v; suDraw(k, 1) }
const suQ = (k, v) => { SU[k].q = v; suDraw(k) }
const suCoa = c => { SU.coa.open.has(c) ? SU.coa.open.delete(c) : SU.coa.open.add(c); suDraw('coa') }
const suPerm = (g, sid, i, on) => { permOf(g, sid)[i] = on ? 1 : 0 }

function suSheet(k) {
  const pr = what => `<div class="foot-left">${lnk('Print', `soon('Print ${what}')`, 'printer')}</div>`
  const base = { size: 'wide', crumb: ['Setup'] }
  if (k === 'coa') return { ...base, size: 'workspace', title: 'Account', pill: pill(`${LEAF.length} accounts`, ''), body: suBody('coa', 'Code or name'), foot: pr('the chart of accounts') + btn('New account', "soon('New account')") }
  if (k === 'sa') {
    const D = sum(Object.values(SA), x => x > 0 ? x : 0)
    return { ...base, size: 'workspace', title: 'Saldo Awal COA · 1 Oct 2026', pill: pill('Balanced', 'ok'),
      body: `${kpisHTML([{ label: 'Debet', value: money(D) }, { label: 'Kredit', value: money(D) }, { label: 'Selisih', value: '0' }, { label: 'Accounts with a balance', value: String(Object.keys(SA).length) }])}${suBody('sa', 'Code or name')}`,
      foot: pr('Saldo Awal COA') }
  }
  if (k === 'links') {
    const miss = SLOTS.filter(s => !s[1]).length
    return { ...base, title: 'Setting COA', pill: miss ? pill(`${miss} not linked`, 'bad') : pill('All linked', 'ok'),
      body: table({
        cols: [{ l: 'Slot', k: 's', w: 230 }, { l: 'Account', k: 'a' }, { l: 'Used by', k: 'u', w: 250 }],
        rows: SLOTS.map(s => ({ c: { s: `<span class="nm">${s[0]}</span>`, a: s[1] ? `<span class="mute">${s[1]}</span> ${esc(nm(s[1]))}` : '<span class="bad">Not linked</span>', u: `<span class="mute">${s[2]}</span>` } })),
      }),
      foot: pr('Setting COA') + (miss ? btn('Link account', 'suLink()') : '') }
  }
  if (k === 'terms') return { ...base, title: 'Jangka waktu kredit',
    body: table({
      cols: [{ l: 'Term', k: 't' }, { l: 'Days', k: 'd', num: 1, w: 120 }, { l: 'Suppliers on it', k: 's', num: 1, w: 170 }, { l: 'Default', k: 'x', w: 150 }],
      rows: TERMS.map(([t, d]) => ({ c: { t: `<span class="nm">${t}</span>`, d: String(d), s: String(SUPPLIERS.filter(s => s.term === d).length), x: d === 30 ? st('Default', 'info') : '' } })),
    }), foot: pr('the terms') + btn('New term', "soon('New credit term')") }
  if (k === 'tax') return { ...base, title: 'Pajak',
    body: table({
      cols: [{ l: 'Tax', k: 't' }, { l: 'Rate', k: 'r', num: 1, w: 90 }, { l: 'DPP', k: 'b', w: 100 }, { l: 'Effective', k: 'e', num: 1, w: 110 }, { l: 'Payable', k: 'p', w: 170 }, { l: 'Masukan', k: 'm', w: 170 }],
      rows: TAXES.map(x => ({ c: { t: `<span class="nm">${x[0]}</span>`, r: x[1], b: x[2], e: x[3], p: x[4] ? `<span class="mute">${x[4]}</span>` : x[6] ? DASH : '<span class="bad">Not linked</span>', m: x[5] ? `<span class="mute">${x[5]}</span>` : DASH } })),
    }), foot: pr('the tax codes') + btn('New tax', "soon('New tax code')") }
  if (k === 'edc') {
    const rate = x => String(Math.round(x * 10000) / 100).replace('.', ',') + '%'
    return { ...base, size: 'record', title: 'Payment methods & EDC per shop',
      body: `${facts([['Cash', 'No fee'], ['Debit on us', rate(MDR.debitOn)], ['Debit off us', rate(MDR.debitOff)], ['Credit', rate(MDR.credit)], ['QRIS', `${rate(MDR.qris)} above Rp 100.000`], ['Credited', 'H+1, net of the fee'], ['Fee account', `6010110002 · ${esc(nm('6010110002'))}`], ['Sales account', 'Setup › Setting COA']])}
        ${table({
          cols: [{ l: 'Shop', k: 's' }, { l: 'EDC', k: 'e', w: 120 }, { l: 'MID', k: 'm', w: 180 }, { l: 'TID', k: 't', w: 120 }, { l: 'Settles to', k: 'a', w: 280 }],
          rows: STORES.map((s, i) => { const b = ACCOUNTS.find(a => a.kind === 'bank' && a.bank === s.edc && a.name.startsWith('Giro')); return { on: `openAccount('${b.id}')`, c: { s: `<span class="nm">${s.code}</span> <span class="mute">${esc(s.name)}</span>`, e: `EDC ${s.edc}`, m: `<span class="ds-num">${885000 + i * 137}${String(10000 + (i * 7919) % 89999)}</span>`, t: `<span class="ds-num">${String(60000000 + i * 4111)}</span>`, a: `${b.name} · ${b.no}` } } }),
        })}`, foot: pr('the EDC list') + btn('Add machine', "soon('Add an EDC machine')") }
  }
  if (k === 'giro') {
    const next = bank => { const ns = GIROS.filter(g => g.bank === bank).map(g => +g.no); return ns.length ? String(Math.max(...ns) + 1) : '' }
    const B = [['BCA', 'bca', next('BCA'), 19], ['Mandiri', 'mdr', next('Mandiri'), 21], ['BRI', 'bri', next('BRI'), 23], ['BNI', 'bni', '110201', 25], ['Danamon', 'dnm', '300401', 25]]
    return { ...base, title: 'Giro templates',
      body: table({
        cols: [{ l: 'Bank', k: 'b', w: 130 }, { l: 'Account', k: 'a' }, { l: 'Next BG', k: 'n', w: 130 }, { l: 'Left in book', k: 'l', num: 1, w: 130 }, { l: 'Layout', k: 'y', w: 200 }],
        rows: B.map(([b, id, n, l]) => ({ on: `openAccount('${id}')`, c: { b: `<span class="nm">${b}</span>`, a: `${ACC[id].name} · ${ACC[id].no}`, n: `<span class="ds-num">${n}</span>`, l: String(l), y: `<span class="mute">${b} BG · 210 × 99 mm</span>` } })),
      }), foot: pr('a test page') + btn('New book', "soon('Register a new giro book')") }
  }
  if (k === 'num') {
    const M = typeof MODE !== 'undefined' ? MODE : { bkk: { next: 'BKK/HO/2610/0062' }, bkm: { next: 'BKM/HO/2610/0025' } }
    const fb = 'FB/HO/2610/' + pad4(Math.max(...BILLS.map(b => +b.no.slice(-4))) + 1), rb = 'RB/HO/2610/' + pad4(Math.max(...RETURNS.map(r => +r.no.slice(-4))) + 1)
    const R = [['BKK', 'BKK/HO/YYMM/####', 'Monthly', M.bkk.next], ['BKM', 'BKM/HO/YYMM/####', 'Monthly', M.bkm.next], ['Faktur Pembelian', 'FB/HO/YYMM/####', 'Monthly', fb], ['Retur Beli', 'RB/HO/YYMM/####', 'Monthly', rb], ['Jurnal Umum', 'JU/HO/YYMM/####', 'Monthly', `JU/HO/2610/${pad4((window.FIN_JU || { n: 31 }).n)}`], ['Asset', 'AT-KAT-####', 'Never', 'Per category']]
    return { ...base, title: 'Setting Menu',
      body: table({ cols: [{ l: 'Document', k: 'd' }, { l: 'Format', k: 'f', w: 230 }, { l: 'Reset', k: 'r', w: 130 }, { l: 'Next number', k: 'n', w: 220 }], rows: R.map(r => ({ c: { d: `<span class="nm">${r[0]}</span>`, f: `<span class="ds-num">${r[1]}</span>`, r: r[2], n: `<span class="ds-num">${r[3]}</span>` } })) }),
      foot: pr('the numbering') }
  }
  if (k === 'shops') {
    const R = [['00', 'HO', 'Head office', DASH, '001', st('Open', 'ok')], ...STORES.map(s => [s.loc, s.code, s.name, s.edc, String(+s.loc + 1).padStart(3, '0'), st('Open', 'ok')]), ['14', 'C014', 'Temanggung', DASH, '<span class="bad">015 · not in the chart</span>', st('Opening', 'info')]]
    return { ...base, title: 'Shops',
      body: table({ cols: [{ l: 'Location', k: 'l', w: 110 }, { l: 'Code', k: 'c', w: 100 }, { l: 'Shop', k: 's' }, { l: 'EDC bank', k: 'e', w: 130 }, { l: 'Affiliasi account', k: 'a', w: 210 }, { l: 'Status', k: 't', w: 140 }], rows: R.map(r => ({ cls: r[1] === 'C014' ? 'dim' : '', c: { l: `<span class="ds-num">${r[0]}</span>`, c: `<span class="nm">${r[1]}</span>`, s: esc(r[2]), e: r[3], a: r[4], t: r[5] } })) }),
      foot: pr('the shops') }
  }
  if (k === 'users') return { ...base, size: 'record', title: 'User & Group', body: suBody('users'), foot: pr('the group') + btn('Save group', "toast('Group saved', GROUPS_U_LABEL())") }
  if (k === 'hist') return { ...base, size: 'workspace', title: 'History', body: suBody('hist', 'User, menu or document'), foot: pr('the history') }
}
window.GROUPS_U_LABEL = () => GROUPS_U[SU.users.g][0]
const suOpen = k => { if (k === 'sup') { go('suppliers'); return } const s = suSheet(k); if (s) openSheet(s) }
function suGo(k) { go('setup'); setTimeout(() => suOpen(k), 30) }
function suLink() {
  const miss = SLOTS.map((s, i) => [s, i]).filter(([s]) => !s[1])
  openSheet({
    size: 'rail', crumb: ['Setup', 'Setting COA'], title: 'Link account',
    body: `${field('Slot', `<select id="su-slot">${miss.map(([s, i]) => `<option value="${i}">${s[0]}</option>`).join('')}</select>`, { req: 1 })}
      ${field('Account', `<input id="su-acc" list="su-leaf" placeholder="Type a code or name"><datalist id="su-leaf">${LEAF.map(([c, n]) => `<option value="${c} · ${esc(n)}">`).join('')}</datalist>`, { req: 1 })}`,
    foot: btn('Link', 'suLinkDo()'),
  })
}
function suLinkDo() {
  const i = +$('#su-slot').value, c = ($('#su-acc').value.match(/^\d{10}/) || [''])[0]
  if (!COA_N[c] || c.length !== 10) { $('#su-acc').style.borderColor = 'var(--bad-fg)'; $('#su-acc').focus(); return }
  SLOTS[i][1] = c
  hist('Setting COA', 'Edited', `${SLOTS[i][0]} → ${c}`)
  closeSheet()
  setTimeout(() => { refreshSheet(suSheet('links')); render() }, 230)
  toast(`${SLOTS[i][0]} linked`, `${c} · ${nm(c)}`)
}
const lastOf = menus => window.FIN_HIST.find(h => menus.includes(h.menu))
const MASTERS = () => {
  const miss = SLOTS.filter(s => !s[1]).length, H = window.FIN_HIST
  return [
    ['Accounts', [['coa', 'Account', `${LEAF.length} accounts · ${COA.length - LEAF.length} groups`, ['Account']], ['sa', 'Saldo Awal COA', `${Object.keys(SA).length} accounts · balanced`, ['Saldo Awal COA']], ['links', 'Setting COA', `${SLOTS.length} links${miss ? `, <span class="bad">${miss} not linked</span>` : ''}`, ['Setting COA']]]],
    ['Tax', [['tax', 'Pajak', `${TAXES.length} rates, <span class="bad">1 not linked</span>`, ['Pajak']]]],
    ['Payments', [['terms', 'Jangka waktu kredit', `${TERMS.length} terms · default T30`, ['Jangka waktu kredit'], '2026-09-14'], ['edc', 'Payment methods & EDC per shop', `4 methods · ${STORES.length} machines`, ['EDC'], '2026-10-03'], ['giro', 'Giro templates', '5 banks', ['Giro templates'], '2026-10-02'], ['sup', 'Suppliers', plural(SUPPLIERS.length, 'supplier'), ['Suppliers'], '2026-10-20']]],
    ['Numbering', [['num', 'Setting Menu', '6 series · reset monthly', ['Setting Menu'], '2026-09-30']]],
    ['Shops', [['shops', 'Shops', `${STORES.length} shops + HO · 1 opening`, ['Shops'], '2026-10-24']]],
    ['Access', [['users', 'User & Group', `${Object.keys(GROUPS_U).length} groups · ${sum(Object.values(GROUPS_U), g => g[1].length)} users`, ['User & Group']]]],
    ['History', [['hist', 'History', plural(H.filter(h => h.date >= '2026-10-01').length, 'change') + ' in October', []]]],
  ]
}
reg({
  id: 'setup', group: 'setup', label: 'Setup',
  s7: [['Account', 'coa'], ['Saldo Awal COA', 'sa'], ['Setting COA', 'links'], ['Customer · Supplier · Pajak'], ['Jangka Waktu Kredit', 'terms'], ['Pajak', 'tax'], ['User & Group', 'users'], ['Setting Menu', 'num'], ['Persiapan Singkat dan Set Up'], ['History', 'hist'], ['Supplier']],
  render() {
    const t = S.tab.setup
    if (t) { S.tab.setup = null; setTimeout(() => suOpen(t), 0) }
    const body = MASTERS().map(([title, rows]) => sec(title, table({
      cols: [{ l: 'Master', k: 'm' }, { l: 'What it holds', k: 'h', w: 330 }, { l: 'Last changed', k: 'd', w: 140 }, { l: 'By', k: 'b', w: 210 }],
      rows: rows.map(([k, label, holds, menus, fixed]) => { const h = k === 'hist' ? window.FIN_HIST[0] : lastOf(menus); return { on: `suOpen('${k}')`, c: { m: `<span class="nm">${label}</span>`, h: holds, d: h ? dayS(h.date) : fixed ? dayS(fixed) : DASH, b: h ? esc(h.user) : fixed ? esc(STAFF_FIN[0]) : DASH } } }),
    }))).join('')
    return page({ title: 'Setup', body })
  },
})

Object.assign(window, { repShop, repArt, repXls, repGo, repME, suOpen, suGo, suSet, suQ, suCoa, suPerm, suLink, suLinkDo })
})()
