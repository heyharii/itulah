# Hasil pembuktian cakupan Finance

Tanggal pemeriksaan: 10 September 2026. Sumber: CSV COA pengguna dan implementasi Finance Lab di `frontend-hub`. Semua pengujian dijalankan pada salinan engine dalam direktori sementara. Tidak ada perubahan kode aplikasi, posting ke backend, perubahan CSV, atau transaksi produksi.

## Keputusan

**Inventaris COA lengkap. Cakupan transaksi, konsistensi register, dan pemisahan tanggung jawab antarmenu belum lengkap.** Struktur menu dapat dipakai sebagai rancangan ownership, tetapi belum dapat disahkan sebagai implementasi tanpa tumpang tindih.

Audit mencakup seluruh 7.528 kode, 75 baris induk tujuh digit ditambah satu kelompok turunan tanpa baris induk, 496 perilaku sepuluh digit, dan tiga kode khusus enam digit. Pemilik yang tercantum dalam matriks adalah usulan desain, bukan klaim bahwa kebijakan bisnis atau setiap alur sudah dikonfirmasi. Luna dengan reasoning max melakukan pemeriksaan silang bukti dan pembagian owner.

## Apa yang diuji

1. Kode, nama, dan status aktif CSV dibandingkan dengan master aplikasi.
2. Seluruh binding runtime diperiksa keberadaan akun, status aktif, kesesuaian unit, dan hasil resolusinya.
3. Deklarasi 29 paket posting dicocokkan dengan peran akun dan pemanggilan dari metode/halaman.
4. Delapan skenario bawaan dijalankan: 58 pemeriksaan lulus.
5. Sebanyak 56 pemeriksaan tambahan dijalankan, termasuk satu sampel untuk setiap paket rule, variasi unit/bank, guardrail jurnal manual, serta konsistensi register antarmenu.
6. Setiap akun diberi jejak CSV, peran yang terikat, rule terkait, hasil sampel, tujuan laporan menurut implementasi, dan owner usulan.

## Hasil kuantitatif

| Pemeriksaan | Hasil | Makna |
|---|---:|---|
| Kode sumber tersedia di aplikasi | 7.528 / 7.528 | Tidak ada kode hilang atau tambahan |
| Nama dan flag aktif | Cocok seluruhnya | Nama dibandingkan setelah normalisasi spasi |
| Akun detail 12 digit | 6.902 | 6.798 aktif, 104 nonaktif |
| Kode level 1/3/5/7/10 digit | 623 | Umumnya agregasi; tiga kode 10 digit tanpa rincian perlu konfirmasi |
| Kode khusus | 3 | 204001, 205001, 600104 |
| Binding runtime | 997 | Menunjuk 969 akun detail unik; satu akun dapat memiliki beberapa role |
| Akun detail aktif tanpa binding role | 5.829 | Belum tercakup jalur pemetaan role; bukan otomatis 5.829 fitur hilang |
| Akun dengan binding tetapi tanpa rule aktif yang mendeklarasikan rolenya | 184 | Pemetaan belum terhubung ke paket posting aktif |
| Akun dengan binding dan deklarasi rule aktif, belum dijalankan dalam sampel standar audit | 750 | Bukti statis, belum bukti setiap akun dapat dipakai dalam seluruh konteks |
| Akun disentuh sampel standar rule audit | 35 | Dari 26 posting contoh; tidak menghitung uji invalid yang sengaja diterima salah |
| Paket posting | 29 | 26 aktif; 3 sengaja nonaktif |
| Sampel paket aktif berhasil posting | 26 / 26 | Satu konteks pilihan per rule; bukan seluruh unit, kelas, kanal atau pihak lawan |
| Pemeriksaan bawaan | 58 / 58 lulus | Skenario dari repository |
| Pemeriksaan tambahan | 36 / 56 terpenuhi | 20 belum memenuhi harapan cakupan atau konsistensi |

Rekonsiliasi akun aktif: **35 + 750 + 184 + 5.829 = 6.798**. Seluruh 969 binding akun berada pada akun aktif. Angka ini tidak boleh disebut persentase kesiapan aplikasi.

Tiga akun 10 digit tidak memiliki rincian 12 digit di CSV: `1011004002` deposito Mandiri, `1011004003` deposito BRI, dan `1011004004` deposito BNI. Statusnya dibedakan di matriks. Audit tidak mengasumsikan apakah mereka akun posting atau master agregasi yang belum lengkap, dan tidak membuat kode unit baru.

Dari 75 keluarga COA, **32 belum memiliki binding**, **34 baru sebagian**, dan **9 memiliki binding untuk seluruh akun detailnya**. Sembilan keluarga tersebut tetap belum otomatis memiliki seluruh lifecycle bisnis yang lengkap.

Pemeriksaan silang Luna menemukan awalan `7010310` pada 28 akun asuransi properti dan biaya PBB, tetapi tidak ada baris induk tujuh digit tersebut dalam CSV. Matriks memasukkannya sebagai **kelompok analisis turunan**, bukan akun baru. Usulan owner: asuransi di Tagihan & Pengeluaran, PBB di Pajak; sumber dokumen tetap perlu dikonfirmasi. Dengan tambahan ini terdapat 76 kelompok awalan, dan total rincian kelompok telah direkonsiliasi tepat **6.902**, masing-masing masuk tepat satu kelompok. Tidak ada akun detail yang jatuh ke owner fallback Pengaturan/Laporan.

## Temuan yang direproduksi

### 1. Dimensi bank giro salah

Uji `giro-bank-dimension` membuat tagihan barang di HO lalu menerbitkan giro **Mandiri**. Jurnal mengkredit `201200200100`, yaitu **Outstanding Giro Bank BCA HO**, bukan `201200200200` milik Mandiri.

Penyebab: role OUTSTANDING_GIRO dipersempit hanya oleh unit. Identitas bank disimpan pada giro tetapi tidak dipakai saat memilih akun kewajiban giro.

Rujukan: `engine/rules.ts:1106`, `engine/bindings.ts:unitBindings`, `engine/book.ts:1852`. Perbaikan: satu identitas giro/bank yang digunakan konsisten saat penerbitan, pencairan, pembatalan, dan rekonsiliasi.

### 2. Penyelesaian pendanaan mengurangi hutang barang

Uji `interunit-family` menyelesaikan record berjenis FINANCING. Jurnal justru mengurangi `201230200104` (**hutang afiliasi atas barang C004**) alih-alih keluarga `2012301` untuk pembiayaan.

Penyebab: `settleInterunit` selalu memanggil rule DEPOSIT tanpa memilih berdasarkan keluarga record. Rujukan: `engine/book.ts:2023`.

Perbaikan: event settlement harus membawa jenis hubungan dan pihak lawan; jangan memilih satu rule untuk seluruh jenis saldo antarunit. Ini masalah pemilihan transaksi, bukan kebutuhan menambah menu.

### 3. Register pembayaran belum tunggal

Uji `bill-payment-register`: pengakuan tagihan dan pembayaran berhasil, jurnal terbentuk, tagihan berubah menjadi lunas, tetapi jumlah objek pada `Payments.all()` bertambah **0**. Uji pembayaran kedua pada tagihan yang sama ditolak dengan ALREADY_PAID; guardrail lokal tagihan ini sudah bekerja.

Rujukan: `engine/book.ts:1390`, `engine/payments.ts:296`.

Artinya pembayaran masih terlihat melalui jurnal, tetapi tidak masuk registry Payment yang sama dengan alur pembayaran lain. Perbaikan: tentukan kontrak tunggal payment_id dan allocation; invoice, treasury dan rekonsiliasi menautkan identitas yang sama. Jangan menyimpulkan pembayaran hilang dari seluruh tampilan kas.

### 4. Piutang pegawai berubah tanpa posting terkait

Uji `staff-loan-ledger`: `deductStaffLoan` berhasil menaikkan nilai repaid sebesar 500.000.000 minor units, tetapi jumlah jurnal bertambah **0**. Implementasi aksi ini tidak membuat tautan ke posting payroll yang membuktikan pengurangan piutang tersebut.

Rujukan: `engine/book.ts:2046`. Perbaikan: potongan memiliki referensi ke kejadian payroll/penerimaan dan jurnal yang sama; register tidak boleh berubah hanya karena tombol ditekan.

### 5. Cakupan unit dan rekening belum lengkap

Uji dispatch C006 berhasil. Payload setara untuk C004 dan C013 ditolak ACCOUNT_UNRESOLVED karena role GOODS_IN_TRANSIT tidak memiliki binding unit tersebut, meskipun paket rule aktif untuk seluruh unit.

Di C006, tiga dari sebelas identitas rekening yang diperiksa memiliki binding BANK yang dapat di-resolve; delapan lainnya tidak. Tidak semua rekening harus diaktifkan untuk transaksi, tetapi UI perlu membedakan rekening terdaftar, aktif, dan sudah siap dipakai rule.

Rujukan: `engine/bindings.ts:313`, `engine/rules.ts:366`. Penerimaan barang sendiri dinonaktifkan dengan RULE_NOT_ACTIVE, menunggu bukti jurnal sisi penerimaan. Jangan mengaktifkannya dengan menebak aturan.

### 6. Jurnal manual melampaui guardrail akun

Empat uji terhadap target guardrail aktif/jenis akun/izin unit mengharapkan penolakan tetapi justru berhasil: akun nonaktif `401011300106`, akun induk `1`, akun C004 dalam jurnal C006 `101100100104`, dan akun hutang supplier barang C006 yang dibatasi kebijakan `201200100106`.

Rujukan: `engine/ledger.ts:225`, `engine/chart.ts:56`. Seluruhnya dibuktikan dalam engine prototipe, bukan backend produksi. Perbaikan: jalur kode langsung dan jalur role melewati validasi izin akun yang sama.

Pemilihan kode langsung untuk jurnal manual memang disengaja dalam desain kode. Temuan ini adalah ketidaksesuaian terhadap target validasi aktif/jenis akun/izin unit, bukan tuntutan bahwa jurnal manual harus selalu memakai role otomatis.

### 7. Klaim laba sistem dari close belum terbukti

Uji `close-generates-result`: menutup periode tidak menambah jurnal dan tidak mengubah equityMoves. Baris laba berjalan/ditahan yang berlabel SYSTEM berasal dari fixture; close hanya mengubah status periode.

Rujukan: `engine/book.ts:903`, `engine/ledger.ts:114`, `engine/subledgers.ts:352`. Ini tidak menyatakan setiap aplikasi wajib membuat jurnal penutup otomatis. Yang belum terbukti adalah hubungan angka laba sistem di layar dengan hasil periode yang benar-benar dihitung/difinalkan.

### 8. Dua referensi akun fixture tidak ada di COA

- Provision piutang menggunakan `101110900106`.
- Salah satu other revenue menggunakan `402010100106`.

Keduanya tidak ditemukan di 7.528 kode sumber. Rujukan: `engine/subledgers.ts`, koleksi PROVISIONS dan OTHER_REVENUE. Akun pengganti harus dipilih dari pemetaan yang benar; audit tidak mengarang penggantinya.

## Cakupan bisnis yang belum dapat disahkan

| Area | Bukti saat ini | Pekerjaan yang belum terbukti |
|---|---|---|
| Kas, bank, deposito | Seluruh master; sebagian binding bank dan contoh transfer | Identitas rekening seluruh bank, lifecycle deposito, batas akun aktif |
| Tagihan operasional | Rule invoice EXPENSE dan pembayaran ada | Variasi biaya: EXPENSE selalu menuju akun listrik, bukan kategori lengkap |
| Uang muka keluar | Pemberian/pertanggungjawaban contoh ada | Jenis perjalanan/pembelian/kontraktor; biaya liquidation selalu rumah tangga |
| Uang muka pelanggan | Kode 205001 ada | Pengakuan penerimaan, alokasi ke penjualan, refund, dan laporan saldo pelanggan |
| Kartu/online | Contoh tunai/BCA debit dan settlement | Semua bank, kartu kredit, marketplace, serta kebijakan neto/gross per kanal |
| Diskon | SALE mengakui penjualan neto | Keputusan apakah akun diskon terpisah diperlukan; jangan memposting dua kali |
| Retur | Role dan cabang return pada SALE tersedia | Refund sebagai dokumen terpisah dan seluruh lifecycle belum diuji audit ini |
| Kantong dan BDP kantong | Keluarga COA tersedia | Binding kelas dan flow penerimaan/pemakaian/transit belum ada |
| Antarunit | Sebagian binding dan contoh sisi toko | Pemilihan keluarga, semua counterpart, pasangan jurnal HO dan rekonsiliasi dua sisi |
| Aset | Lima kelas FFE dan satu kelas OE di binding | Tanah, bangunan, mesin, kendaraan, software; seluruh lifecycle bukan sekadar daftar |
| Payroll | Rule akrual/pembayaran contoh ada | Biaya operation vs office, potongan, THR, serta register kewajiban yang konsisten |
| Pajak | Rule pembayaran dan posisi tersedia | Pemisahan filed/paid, pengakuan/netting, pelacakan satu kewajiban lintas Payroll/Pajak |
| Pinjaman | Angsuran bank BCA jangka panjang | Principal, bank lain, pencairan dan reklasifikasi bagian jatuh tempo |
| Modal | Setoran/prive contoh tersedia | Hasil periode dan laba ditahan yang diturunkan dari buku, bukan fixture |
| Management fee/pendapatan lain | COA dan sebagian data fixture | Dokumen tagihan pendapatan, pengakuan piutang, penerimaan dan alokasi |
| Kode khusus | 204001, 205001, 600104 terlihat dalam master | Hubungan dengan akun standar dan kebijakan klasifikasi |
| Asuransi dan biaya PBB | 28 detail di bawah awalan 7010310 tanpa baris induk | Invoice/prepaid/release asuransi serta pengakuan/pembayaran PBB; seluruhnya belum mempunyai binding |

Tiga rule yang dinonaktifkan adalah **card_clearing_at_checkout**, **interunit_receipt**, dan **oe_reserve_accrual**. Penonaktifan memiliki alasan di kode dan tidak dihitung sebagai bug. Metadata ACTUAL_JOURNAL/CLIENT_STATEMENT adalah klaim evidence dalam implementasi; dokumen jurnal asal tidak diperiksa ulang dalam audit ini.

## Implikasi untuk menu

Menu utama tidak perlu ditambah untuk setiap akun tanpa binding. Yang diperlukan adalah memperbaiki model transaksi dan memperjelas batas kerja:

**Owner kontrol akun berbeda dari menu yang memicu jurnal.** Biaya kartu `6010110002` berasal dari Settlement Penjualan meskipun klasifikasinya beban; owner usulannya diperjelas menjadi Penjualan & Piutang. Biaya Rumah Tangga `6010310003` juga dapat muncul dari payroll outside-help/rounding. Biaya bank `6010310004` dapat terbentuk sebagai bagian satu dokumen perolehan aset. Kejadian sumber tetap memiliki satu pemilik; akun yang dipakai beberapa kejadian tidak dengan sendirinya berarti input ganda. Matriks owner adalah usulan kontrol, sedangkan rule/route menunjukkan pintu pemicu yang ditemukan.

1. Kas & Bank memiliki rekening, instrumen dan realisasi dana; Tagihan memiliki hutang serta alokasi ke dokumen yang sama.
2. Antarunit memilih rule sesuai barang, pembiayaan atau kategori hubungan lain, dengan satu pasangan pihak lawan yang jelas.
3. Piutang pegawai tetap berada di Piutang; Payroll menjadi pintu potongan yang menautkan transaksi yang sama.
4. Pendanaan & Modal hanya mengurus sumber dana eksternal dan transaksi pemilik. Hutang operasional, payroll dan pajak tetap di domainnya.
5. Penjualan & Piutang memerlukan tempat untuk tagihan pendapatan nonretail jika management fee/sewa ditagihkan; cukup subalur, tidak harus menu utama baru.
6. Akuntansi mengontrol penyesuaian, laporan dan periode; jangan menutupi gap domain dengan jurnal manual yang tidak memiliki guardrail.

## Urutan penyesuaian

**Pertama: integritas kejadian dan akun.** Perbaiki giro per bank, settlement antarunit per keluarga, dan validasi jurnal manual. Kriteria selesai: uji reproduksi menolak akun tidak valid serta memilih akun yang sesuai instrumen/hubungan.

**Kedua: satu dokumen lintas menu.** Hubungkan pembayaran tagihan dan potongan pegawai ke register dan jurnal yang sama. Kriteria selesai: satu aksi mengubah seluruh tampilan terkait secara konsisten, memiliki ID sumber dan tidak dapat dibayar/dipotong ganda.

**Ketiga: cakupan bisnis yang disetujui.** Tentukan unit/bank/kelas/kategori yang memang boleh digunakan; lengkapi binding dan rule sesuai bukti. Aturan receipt, reserve dan kode khusus tetap menunggu keputusan sumbernya.

**Keempat: close dan laporan.** Turunkan hasil periode dari ledger, tunjukkan cakupan unit laporan yang sebenarnya, dan pisahkan bukti rekonsiliasi yang nyata dari status fixture.

**Terakhir: navigasi dan uji pengguna.** Terapkan ownership menu setelah kontrak objek di atas jelas. Uji seluruh alur dari dokumen asal, detail, pembayaran, bank, sampai laporan; pengujian browser dan integrasi produksi belum termasuk hasil ini.

## Berkas bukti

- `Pembuktian_Finance_COA.xlsx`: ringkasan, 79 kelompok/kode khusus (75 induk sumber + 1 kelompok turunan + 3 khusus), 496 perilaku, seluruh 7.528 akun, 29 rule, 114 pemeriksaan, dan batas antarmenu.
- `coverage-proof.json`: matriks lengkap, termasuk rule dan route per akun.
- `runtime-evidence.json`: payload hasil uji, jurnal contoh, binding, call graph, dan hash sumber engine.
- Skrip reproduksi: `scripts/audit-finance-coverage.cjs` lalu `scripts/build-finance-proof.py`.

Keterbatasan: pencarian call graph adalah analisis statis fungsi lokal; route kosong tidak membuktikan ketiadaan integrasi eksternal. Tujuan laporan diperoleh dari prefix kode yang dipakai aplikasi, bukan pengesahan kebijakan akuntansi. Workbook adalah snapshot, bukan koneksi langsung ke repository atau backend.
