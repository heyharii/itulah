# Finance Connect Brief — sambungkan semua domain ke Finance di 267 akun klien

**Tanggal:** 25 Sep 2026 · **Target:** satu sesi kerja (±1 jam untuk tahap 0–4, sisanya menyusul) ·
**Dasar:** audit 25 Sep (posting coverage + COA 267). Bahasa isi: Indonesia; nama kode/komentar mengikuti gaya repo.

## 0. Aturan kerja (baca dulu)

1. **Working tree penuh pekerjaan pemilik yang belum di-commit** (±440 file, termasuk migrasi 0299–0370).
   Jangan revert, jangan format ulang file yang tidak kamu sentuh. Commit **hanya file yang kamu ubah**,
   `git add <path>` per file, satu commit per tahap, **tanpa push**. Pesan commit diakhiri baris
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
2. **Ada agen GA yang bekerja paralel** (lihat `runs/ga-build/`, commit "GA tahap …"). Jangan sentuh file
   GA/frontend GA. **Nomor migrasi:** cek `ls backend/migrations/postgres | tail -3` tepat sebelum membuat
   file migrasi dan lagi sebelum commit; kalau bentrok, naikkan nomormu. Migrasi terakhir saat brief
   ditulis: `0370`.
3. **Bagan akun = 267 akun klien** (0348). Model 43 akun sudah pensiun; jangan menambah referensi ke kode
   43 (1101, 1102, 2101, 4101, 6201, …). Semua peta ke kode 4 digit 267 (mis. 1029, 2002, 4012, 6004).
4. `resolve_account` tidak punya default — itu disengaja. Yang kurang adalah **baris peta**, bukan fallback.
5. Kalau struct Rust yang diserialisasi berubah: `make contract`. Jalankan migrasi ke DB dev
   (`sqlx migrate run` atau cara repo) dan uji yang relevan (`cargo test` suite finance/sales/stock/pay).
6. Setiap keputusan akun ditulis ke `runs/finance-connect/2026-09-25/ACCOUNT-DECISIONS.md`
   (arti → kode/nama akun 267 → alasan → keyakinan TINGGI/SEDANG/RENDAH). Yang RENDAH tetap dipetakan
   supaya posting tidak ditolak, tapi masuk daftar tinjau pemilik.
7. Laporan akhir: `runs/finance-connect/2026-09-25/REPORT.md` — matriks event → jurnal (Dr/Cr kode 267)
   → status (TERSAMBUNG/SEBAGIAN/BELUM) + apa yang sengaja ditunda.

Rujukan: `FINANCE-ARCH-PLAN.md` (P0–P4), `backend/migrations/postgres/0348_*.sql` (daftar 267 leaf,
baris 87–359), `0351`, `0364`, `backend/src/cloud/postgres/ledger.rs` (katalog arti + `resolve_account`
±3583), `poster.rs`, `sales_posting.rs`, `domain/sales_posting.rs`, `acquirer.rs`, `payables_flow.rs`,
`stock_ledger.rs`, `pay.rs`, `advance.rs`, `claims.rs`, `exit.rs`, `store_money.rs`, `deposits.rs`,
`giro.rs`, `financing.rs`, `principal.rs`, `tax.rs`, `assets.rs`, `prepaid.rs`, `payment_allocation.rs`,
`finance_control.rs`, `loyalty.rs`, `vouchers.rs`, `bin/cloud.rs`.

---

## Tahap 0 — Peta akun lengkap (penghambat terbesar)

Temuan audit: hanya 34 dari 87 arti yang punya peta; ±25 arti yang **dipakai penulis** tidak terpetakan
sehingga posting ditolak. Buat satu migrasi yang memetakan setiap arti yang dipakai penulis ke leaf 267
(per site bila akun klien dipecah per unit; qualifier bila perlu), minimal:

`payroll_expense` (dipecah per komponen, lihat Tahap 3), `payroll_payable`, `employee_expense`,
`employee_claim_payable`, `advance` (uang muka karyawan/dinas), `advance_purchase` (uang muka supplier/
kontraktor), `store_manager_receivable`, `other_receivable`, `revenue_other`, `petty_cash`,
`cashier_float`, `cash_in_transit`, `cash_variance`, `cash_shortage`, `time_deposit`,
`giro_outstanding`, `goods_in_transit` (BDP), `loan_principal`, `loan_current_portion`,
`interest_expense`, `interest_payable`/accrued, `capital_contributed`, `owner_drawings`,
`pph21_payable`, `pph23_payable`, `pph25_payable`, `pph29_payable`, `pbb`, `prepaid_expense`,
`accrued_expense`, `amortisation_*`, `intangible`, `work_in_progress` (CIP), `asset_disposal_loss/result`,
`bad_debt_expense`, `other_income_expense`, dan setiap `expense_*` yang dipakai.
Terapkan juga 0361/0366 bila belum (peta prepaid/accrued/contract/repair).

Aturan kategori: untuk arti yang **sudah punya akun klien sendiri**, set `category_family` = tidak ada
(pemeriksaan kategori di `ledger.rs` ±2714–2900, ±3037–3250 menolak baris berkategori pada leaf 267).
Kategori hanya dipertahankan bila klien memang tidak punya akunnya.

**Uji:** query "arti yang dipakai penulis tanpa peta" = 0; setiap `source_kind` punya satu uji posting
yang lolos.

## Aturan akuntan klien (25 Sep) — otoritatif, menggantikan kata-kata transfer/payroll sebelumnya

A. Setiap transaksi yang melintasi buku HO dan unit lewat piutang/hutang afiliasi. Unit ↔ unit **tidak pernah**
   langsung: selalu lewat HO (unit A ↔ HO ↔ unit B; counter-site unit selalu HO). Jurnal tiap site seimbang di
   bukunya sendiri; konsolidasi mengeliminasi pasangan afiliasi.
B. Uang ("transfer ganti" HO → unit): HO Dr 1057 Piutang Affiliasi Pembiayaan (counter = unit) / Cr Cash In Bank;
   unit Dr 1003 Petty Cash / Cr 2028 Hutang Affiliasi Pembiayaan (counter = HO). Konsolidasi: Dr Petty Cash /
   Cr Cash In Bank.
C. Transfer barang — saat SJD (surat jalan) jurnal di **kedua** buku: HO Dr 1031 BDP / Cr 1029; unit Dr 1031 BDP /
   Cr 2029 Hutang Affiliasi Atas Barang (counter = HO). Saat diterima di unit: HO Dr 1058 Piutang Affiliasi Atas
   Barang (counter = unit) / Cr 1031; unit Dr 1029 / Cr 1031. Nilai = biaya provenance unit; kantong 1030/1032
   sama. Unit → unit: unit pengirim ↔ HO, lalu HO ↔ unit penerima. (Menggantikan aturan transfer Tahap 5.)
D. Payroll dua tahap: akhir bulan (bulan berjalan) Dr Biaya Gaji dan Upah, Dr Biaya Lembur, Dr Biaya BPJS (dan
   komponen lain) per kelompok site / Cr 2017 Biaya Gaji dan Upah YMHD — **BPJS perusahaan juga Cr 2017** (ikut
   klien, bukan 2021). Pembayaran tanggal 1 bulan berikut ke karyawan dan setoran BPJS: Dr 2017 / Cr 1003 Petty
   Cash di unit (didanai transfer ganti B); staf HO/DC sama dari kas/bank HO. PPh 21 dipotong: tetap Cr 2011
   untuk sementara — **konfirmasi ke akuntan klien**. Akrual THR bulanan ke 2018 tetap.

**Kind afiliasi (pemilik, final):** setiap lintasan HO↔unit memakai tepat satu dari tiga keluarga, counter unit
selalu HO: (1) PEMBIAYAAN 1057/2028 — uang berpindah atau satu pihak membayar untuk yang lain (transfer ganti,
setoran tunai toko ke rekening HO, settlement kartu/QRIS ke bank HO untuk piutang kartu unit — **beban MDR di buku
unit**, HO hanya memindahkan uang —, HO membayar tagihan milik unit, pendanaan gaji); (2) ATAS BARANG 1058/2029 —
barang dagangan dan kantong berpindah (aturan SJD), retur unit→HO dan unit→unit lewat HO; (3) LAIN-LAIN — aset
tetap pindah site, alokasi biaya/management fee HO, koreksi: klien **hanya** punya 1059 Piutang Affiliasi
Lain-lain, tanpa hutang afiliasi lain-lain dan tidak ditambah → 1059 dua arah di kedua sisi (saldo kredit = hutang);
**jangan pakai 2031 untuk afiliasi**. Kind afiliasi wajib untuk setiap posting lintas site (poster memilih dari
source kind: pemindah uang → PEMBIAYAAN, gerak stok/kantong → BARANG, selain itu LAIN-LAIN) dan masuk guard
keseimbangan per site + uji.

## Tahap 1 — Bug runtime yang pasti gagal

1. `deposits.rs:692,772` memakai `source_kind "DEPOSIT"` yang sudah dikeluarkan dari CHECK (0344/0364).
   Satukan ke `STORE_DEPOSIT` (rencana §6.7) atau kembalikan nilai ke CHECK — pilih yang satu keluarga.
2. `payment_allocation.rs:635-645,665-675`: `voucher_id` (text) dibandingkan dengan `Uuid` → pakai
   `.to_string()` seperti `payables_flow.rs:190`. Uji ALLOCATE + UNMATCH.
3. ~~Voucher loyalti saat terbit~~ — **dibatalkan**, lihat Tahap 2 poin 13 (voucher gratis = potongan saat dipakai).
4. `finance_control.rs:332,350-375`: catatan "payroll posts nothing" basi dan membandingkan GL dengan
   `net_minor` padahal akrual memakai gross → perbaiki setelah Tahap 3.
5. Agen akhir bulan (penyusutan, cadangan, prepaid) hanya jalan bila `INVENTORY_FINANCE_AUTOMATION_ENABLED`
   (default false). Jangan ubah default produksi; tampilkan status flag ini di readiness/overview Finance
   dan aktifkan di `cloud.env.example` dev dengan komentar.

## Tahap 2 — Sales/POS (keputusan pemilik 25 Sep)

**Sumber:** aplikasi **POS Windows** di toko. **Semua transaksi dicatat** di sumber (per struk, per baris,
per tender) — itu subledger penjualan. GL diposting **per toko per hari per tender/acquirer**
(`SALE_DAY`, sudah ada), dan piutang settlement tetap per item di payment ledger.

1. **QRIS melekat ke EDC per bank**, bukan tender sendiri. Tender QRIS wajib membawa bank acquirer
   (dari terminal EDC toko). Posting sama dengan debit bank itu: Dr piutang debit/QR bank ybs
   (qualifier bank) / Cr penjualan debit bank ybs (4003–4006). Tambah master **terminal EDC per toko**
   (terminal id → bank) di setup Finance bila belum ada; POS mengirim terminal/bank. QRIS tanpa bank →
   ditolak dengan alasan yang jelas di antrean sale-day, **tidak** menggagalkan seluruh hari: baris lain
   tetap terposting, baris itu masuk antrean perbaikan (kalau desain transaksi saat ini mengharuskan
   satu hari satu transaksi, laporkan dan pilih: pisahkan baris gagal ke `SALE_DAY_EXCEPTION`).
2. **Tender online/OTHER**: petakan ke akun klien — online sendiri → 4009, marketplace → 4010, piutangnya
   ke leaf piutang lain-lain/online yang sesuai di 0348. Tidak boleh lagi menggagalkan hari.
3. **MDR default dari Finance:** tabel setup `acquirer_fee_rate` (bank × jenis: DEBIT_ON_US, DEBIT_OFF_US,
   CREDIT, QRIS; persen; berlaku sejak) — dikelola Finance, default dipakai otomatis. Saat settlement
   (`acquirer.rs` ACQ_SETTLEMENT): MDR harapan = bruto × tarif; bila kredit bank aktual dalam toleransi
   (setting, default Rp1.000 atau 0,05%), posting MDR aktual ke 6005 Biaya Credit Card; di luar toleransi
   → tandai varian untuk ditinjau (jangan diam-diam diposting). Kalau aturan tarif belum ada untuk bank itu
   → pakai MDR aktual + tandai "tarif belum diset".
4. **Kantong belanja:** harga Rp1.000 dengan potongan otomatis Rp1.000 → **hangus** (pelanggan bayar 0).
   Posting per hari: Cr penjualan (tender ybs) 1.000 × qty, Dr 4012 Discount/Potongan Penjualan 1.000 × qty
   (net nol di pendapatan); sisi persediaan: Dr **6004 Biaya Customer Supplies** / Cr **1030 Persediaan
   Kantong Belanja** × qty × harga pokok kantong (cost layer kantong). Qty kantong tetap tercatat di stok.
5. **Poin member:** belum ada akun (2402 lama hilang). **Jangan posting apa pun**; catat di REPORT sebagai
   keputusan pemilik yang tertunda.

### Keputusan tambahan pemilik (25 Sep, setelah cek `Laporan_Master_Account1.xlsx`)

6. **QRIS harus terlihat terpisah** (MDR-nya beda). COA klien belum punya akun QRIS → tambahkan leaf baru
   di bawah grup penjualan dan piutang yang sama polanya dengan debit: `Penjualan QRIS Bank BCA/Mandiri/BRI/BNI`
   (sebelah 4003–4006) dan satu `Piutang QRIS` (sebelah 1021 Piutang Debit Card, qualifier bank). Kode baru
   mengikuti penomoran 0348 (lanjut dari nomor terakhir grupnya), status `PENDING_CLIENT_CODE`, dicatat di
   ACCOUNT-DECISIONS. Tender QRIS: Dr Piutang QRIS (qualifier bank EDC) / Cr Penjualan QRIS bank ybs.
   MDR QRIS memakai baris tarif jenis QRIS.
7. **Bank baru harus bisa ditambah klien.** Buat alur setup Finance "Tambah bank" (backend + endpoint; layar
   cukup form sederhana di modul `finance` yang hidup): satu aksi membuat leaf yang dibutuhkan bank itu di grup
   yang benar (Cash In Bank Giro/Tabungan bank X, Penjualan Debit Card bank X, Penjualan QRIS bank X bila
   dipilih), baris register `bank_account`, peta `account_map` dengan qualifier bank, dan terminal EDC. Butuh
   peran Finance HO. Bank tanpa akun tetap ditolak dengan alasan jelas.
8. **PPN diabaikan dulu** (jangan ubah perilaku PPN yang ada). **MDR dari bank sudah termasuk PPN** → tarif di
   tabel adalah angka final; jangan pisahkan PPN atas MDR.
9. **Selisih kas tutup shift:** kurang tidak boleh; keputusan akhir di Finance HO. Default sementara: kurang →
   Dr piutang kepala toko (1023, site toko) sebagai kewajiban mengganti; lebih → Cr Pendapatan (Biaya)
   Lain-lain. Petakan `cashier_float` ke **Modal Kasir** (leaf 0348 yang sesuai 1011001003).
10. **Pembulatan kembalian:** ada akunnya → `rounding` ke **8003 Selisih pembulatan**.
11. **Tidak ada refund uang dan tidak ada "tukar barang" sebagai jenis transaksi — namanya RETURN.** Return
    hanya di toko yang sama, boleh di hari lain (batas hari = setting Finance, default 7 hari), merujuk struk asal,
    dan **uang tidak pernah keluar**: pelanggan wajib mengambil barang lain. Posting di hari & toko return:
    Dr 4013 Retur Penjualan (harga barang yang dikembalikan) / Cr penjualan barang pengganti; bila pengganti lebih
    mahal → uang masuk (tender tambahan); bila lebih murah → selisih hangus ke Cr Pendapatan (Biaya) Lain-lain.
    Tidak ada tender refund/uang keluar di POS maupun di posting. Barang yang dikembalikan masuk lagi ke 1029
    dengan biaya asal unit itu (provenance RFID). Periode asal sudah ditutup → posting di periode berjalan.
    Tolak return di toko lain.
12. **Promo tidak dibiayai siapa pun** → semua ke 4012.
13. **Voucher = gratis semua (pilihan paling sederhana).** Voucher tidak dijual; tidak ada liabilitas saat
    terbit dan tidak ada agen kedaluwarsa. Saat dipakai di POS, nilai voucher diposting sebagai **potongan
    penjualan: Dr 4012 Discount/Potongan Penjualan** (bukan tender, bukan 2033). Ubah jalur SALE_DAY yang
    sekarang mendebit `voucher_liability`, dan matikan posting `VOUCHER_ISSUE`/loyalti-issue (Tahap 1.3 dibatalkan:
    jangan tambah jurnal saat terbit). Voucher yang kedaluwarsa cukup tidak bisa dipakai lagi — tanpa jurnal.
14. **Tidak ada penjualan online** (4009/4010 dibiarkan, tender online ditolak jelas) dan **tidak ada belanja
    karyawan potong gaji**. Kantong belanja tetap hangus seperti poin 4.

**Uji:** hari berisi tunai, debit BCA, kredit VISA, QRIS BNI, online marketplace, 3 kantong, 1 retur,
1 diskon → satu SALE_DAY seimbang; QRIS BNI mendarat di akun debit BNI; kantong net 0 di pendapatan dan
6004/1030 bergerak; settlement BCA dengan tarif 0,15% (contoh) → MDR 6005 = harapan; selisih besar → varian.

## Tahap 3 — HR ke Finance

1. **Akrual payroll** (`pay.rs` `hand_over`): baris per komponen per jenis site — karyawan toko ke beban
   penjualan (6012–6024), HO/DC ke beban pegawai (6026–6038): gaji, lembur, uang makan, transport, bonus,
   THR bila ada; iuran BPJS perusahaan ke 6017/6031 dengan Cr hutang BPJS; potongan karyawan: BPJS karyawan
   → hutang BPJS, **PPh 21** → hutang PPh 21, cicilan piutang karyawan → Cr piutang pegawai/kepala toko/
   manajemen sesuai leaf 0348; sisa neto → Cr hutang gaji (`payroll_payable`). Seimbang = bruto + iuran
   perusahaan.
2. **Pembayaran** (`settle_handover`): Dr hutang gaji / Cr bank (atau jalur dana toko yang sudah ada).
3. Uang muka dinas (`advance.rs`), klaim (`claims.rs`), full & final (`exit.rs`) — cukup dengan peta
   Tahap 0; pastikan uji tiap jalur lolos. Potongan gaji untuk sisa uang muka → Cr akun uang muka.
4. Perbaiki readiness `finance_control.rs` (Tahap 1.4).

### Keputusan pemilik HR (25 Sep)

1. **(Koreksi pemilik — menggantikan versi 1023.)** Setiap transaksi HO ↔ toko lewat akun afiliasi. Gaji toko:
   HO mentransfer uang ke petty cash toko → HO: Dr 1057 Piutang Affiliasi Pembiayaan (counter = toko) / Cr bank;
   toko: Dr 1003 Petty Cash (site toko) / Cr 2028 Hutang Affiliasi Pembiayaan (counter = HO). **Klarifikasi
   pemilik:** akun HO tidak pernah dipasangkan langsung dengan akun unit — dua dokumen terkait (kirim tanggal HO,
   terima/konfirmasi tanggal toko), masing-masing seimbang di site-nya sendiri, sehingga uang dalam perjalanan
   terlihat sebagai pasangan belum cocok di rekonsiliasi antar-unit sampai toko mengonfirmasi. Pola sama untuk
   barang (1058/2029) dan lain-lain (1059 / keluarga Hutang Affiliasi lain-lain). Guard/uji: setiap set baris
   jurnal yang site-nya berbeda harus nol per site, hanya lewat akun afiliasi. Toko membayar staf:
   Dr 2017 (site toko) / Cr 1003 (site toko); sisa tetap di petty cash toko. Jalur dana toko tidak lagi memakai
   1023 untuk gaji (1023 hanya untuk kekurangan kas). Staf HO/DC: bayar langsung Dr 2017 / Cr bank.
   **Aturan umum:** setiap posting yang barisnya melintasi HO dan toko wajib membawa kaki afiliasi (Pembiayaan
   untuk uang, Atas Barang untuk barang, Lain-lain 1059/2031 untuk lainnya) sehingga buku tiap site seimbang
   dan afiliasi se-perusahaan bernilai nol; tambahkan uji.
2. DC dan HO satu kelompok: staf DC memakai akun beban HO 6026–6038 (staf toko 6012–6024).
3. Akrual payroll saat HR menyetujui (`hand_over`): Dr beban per komponen per kelompok site (tunjangan → gaji
   6012/6026), BPJS perusahaan Dr 6017/6031; Cr 2021 BPJS YMHD (perusahaan + karyawan), Cr 2011 PPh 21, Cr
   1022/1023/1024 cicilan pinjaman menurut peran, Cr 2017 gaji neto. Setor BPJS/PPh 21 oleh Finance: Dr 2021 /
   Dr 2011 / Cr bank.
4. THR: akrual otomatis tiap bulan (1/12 estimasi THR tahunan per karyawan) Dr 6018/6032 / Cr 2018; saat bayar
   Dr 2018 (selisih ke 6018/6032) / Cr 2017. Bonus KPI bulanan di payroll yang sama langsung 6024/6038 (tanpa
   akrual). Akrual bonus tahunan/sekali hanya bila setting Finance menyatakan (default mati).
5. Klaim medis → 6016/6030, liabilitas 2020 Biaya Pengobatan YMHD. Klaim lain (dinas 6047, transport lokal 6048)
   → liabilitas 2031 Hutang Lain-Lain. Uang muka dinas 1051, diselesaikan dengan klaim; sisa dikembalikan atau
   dipotong gaji (Cr 1051).
6. Pesangon saat exit disetujui / full & final: Dr 6023/6037 / Cr 2018, lalu dibayar. Biaya training dibagi per
   kelompok site peserta (6022 toko / 6036 HO; tanpa daftar peserta → 6036). Seragam/rekreasi/duka per
   kelompok site penerima. Cadangan piutang karyawan 1027 manual oleh Finance.

**Uji:** run payroll 3 karyawan (2 toko, 1 HO) → setelah akrual + bayar, `payroll_payable` = 0; beban
muncul di leaf yang benar per jenis site; hutang BPJS/PPh 21 = jumlah potongan + iuran.

## Tahap 4 — Procurement, GA, Finance native (cukup dengan peta + bug)

Verifikasi dengan uji posting tiap jalur: uang muka supplier + alokasi, PPh 23 potong di pembayaran,
credit note/retur pembelian, tagihan GA (repair/kontrak/prepaid) dari draft → post, penyusutan &
cadangan (jalankan manual), amortisasi pre-opening, disposal aset, petty cash, setoran toko, giro,
pinjaman (pokok + bunga), modal/prive, PPh 21/23/25 settlement, dokumen kas KM/KK. Interunit: tambah
jenis **lain-lain** ke peta afiliasi (1059) di samping PEMBIAYAAN/BARANG.

### Keputusan pemilik 25 Sep (tambahan)

1. **Tidak ada akun baru di bagan.** Menggantikan Tahap 2 poin 6: **jangan** buat leaf QRIS. QRIS diposting ke
   akun debit card bank EDC yang sudah ada (piutang 1021 qualifier bank, penjualan 4003–4006) dan dipisahkan
   sebagai atribut tender (`tender_kind = QRIS` di baris jurnal/detail sale-day dan item settlement) supaya
   laporan dan tabel tarif MDR (jenis QRIS) bisa memisahkannya. Bila leaf QRIS sudah terlanjur dibuat →
   nonaktifkan di migrasi lanjutan. Alur "Tambah bank" (poin 7) tetap — itu klien menambah bank dengan sengaja.
2. Akun **2003 Hutang Supplier Barang Dagang - Suspend tidak dipakai**: nonaktifkan leaf-nya (0364 sudah
   membuang jalur suspend); penerimaan barang tetap Dr 1029 / Cr 2002.
3. **PPh 4(2) tidak punya akun dan tidak akan ditambah**: potongan 4(2) masuk 2012 Hutang PPh 23 dengan atribut
   pasal pajak (4(2) vs 23) di baris supaya laporan pajak bisa memisahkan; tandai di REPORT sebagai item tinjau
   konsultan pajak.
4. Alur yang dikonfirmasi: penerimaan barang diposting otomatis setelah verifikasi lantai (hub Operations →
   Receiving, terima-periksa Accept → receipt → GOODS_RECEIPT per jam pada harga PO neto; diskon PO tingkat order per 0044;
   ongkos angkut dibebankan manual). Uang muka supplier (1052 pembelian / 1053 kontraktor) dicatat manual oleh
   Finance dan dialokasikan ke tagihan. PPh 23 diterapkan Finance saat bayar (`payment_withhold`). Giro dipilih
   Finance saat bayar (di luar PO): pembayaran metode GIRO → Cr `giro_outstanding` per bank (2005–2009
   Outstanding Giro BCA/Mandiri/BRI/BNI/Danamon), dicairkan dari baris mutasi bank → Dr `giro_outstanding` /
   Cr bank; ditolak → dibalik. Yang kurang hanya peta — pastikan setiap jalur giro terposting. Selisih harga
   tagihan vs PO ditangani di bill match (cek toleransi di `payables_flow.rs` bill_match); selisih harga
   menyesuaikan biaya provenance unit bila belum terjual, selain itu 5002.

### Keputusan pemilik GA (25 Sep; bagan dicek ulang dengan `Laporan_Master_Account1.xlsx`, tanpa akun baru)

1. Tagihan perbaikan: akun dari objek yang diperbaiki (0366) → 6066 FFE, 6067 Software maint., 6068 Komputer,
   6069 Bangunan, 6070 Staff house, 6071 Kendaraan, 6072 AC & refrigerator, 6073 Power plant/genset, 6074
   Pengecatan; Cr 2004.
2. Prepaid disebar bulanan (garis lurus selama masa kontrak): 1038 Sewa Toko→7004, 1037 Sewa Tanah→7002,
   1039 Sewa Rumah/Mess→7005, 1036 Asuransi→7029 (properti) / 7033 (kendaraan), 1040 Kontrak Maintenance→akun
   perbaikan objeknya, 1042 Promosi→6006, 1043 Ijin Usaha→6049, 1044 Lain-lain→per baris; 1041 Sewa
   Kendaraan→**6064 Miscellaneous Expences** (klien tidak punya beban sewa kendaraan).
3. Tagihan utilitas berulang: 6045 listrik, 6046 air, 6044 telepon; akrual (YMHD 2022–2026) **manual** Finance.
4. Batas kapitalisasi = setting Finance (bisa diubah; di bawahnya pembelian dibebankan ke akun beban objek).
5. Penyusutan **otomatis**: penyusutan akhir bulan, cadangan penggantian OE (Dr 7024 / Cr 1100), penyebaran
   prepaid dan amortisasi berjalan **default** (tetap ada saklar mati eksplisit untuk ops; jangan dibiarkan di
   belakang `INVENTORY_FINANCE_AUTOMATION_ENABLED=false`). Garis lurus per kelas, umur dari `useful_life_months`
   yang ada; akun 7007–7023 / 1083–1099 per kelas; tanah 1061 tidak disusutkan; HGB 1062 → 7003/1082.
6. Pre-opening: kumpulkan di 1111, amortisasi garis lurus sejak bulan buka toko → Dr 7026 / Cr 1112; masa =
   setting, default 12 bulan.
7. CIP 1113 untuk renovasi/konstruksi; selesai → reklas ke kelas aset dan mulai disusutkan.
8. Pelepasan/penjualan aset: keluarkan harga perolehan + akumulasi; laba/rugi → **8008 Pendapatan (Biaya)
   Lain-Lain**.
9. Uang jaminan sewa → **1054 Advanced - Others**. Hutang leasing kendaraan → **2031 Hutang Lain-Lain** (bunga
   8012). Software baru selain 1104/1105 → beban **6050 Computer Expenses**. 1110 Disposed Inventory tidak
   dipakai (tandai untuk pemilik).

## Tahap 5 — Inventory (keputusan default; pemilik bisa mengubah, pesan akan dikirim bila berubah)

Default yang dipakai sampai ada pesan lain:
- Metode nilai **FIFO cost layer** (yang sudah ada).
- **Penerimaan barang membuat cost layer** (qty × harga PO; `payables_flow.rs:235-244` stub
  `lane_i_cost_layer` diisi). Selisih harga saat bill datang → `cost_layer_correct_price` (bila barang
  sudah terjual, selisih ke HPP 5002).
- **Stok kurang tidak boleh menggagalkan posting penjualan**: bila layer habis, HPP memakai biaya terakhir
  yang diketahui dan ditandai "biaya menunggu"; diluruskan otomatis saat layer masuk.
- **Transfer antar site** (allotment/dispatch DC→toko): kirim Dr 1031 BDP Barang Dagangan / Cr 1029 site
  asal; terima Dr 1029 site tujuan / Cr 1031 (kaki afiliasi otomatis poster bila lintas unit).
- **Stock opname resmi**: selisih minus Dr 8007 / Cr 1029; plus sebaliknya.
- **Rusak/hilang dan disposal**: Dr 6011 Biaya Kerusakan Persediaan / Cr 1029 (langsung, bukan cadangan —
  kecuali pemilik memilih metode cadangan 1033).
- **Retur ke supplier**: Dr 2002 / Cr 1029 + keluarkan layer.
- Kantong belanja memakai 1030/1032/1034 dengan pola yang sama.

**Uji:** terima 10 @ Rp50.000 → layer; jual 3 → HPP 150.000; transfer 2 DC→C007 lewat 1031; opname −1 →
8007 50.000; rusak 1 → 6011; saldo 1029 = Σ layer; jual saat layer habis → hari tetap terposting, ditandai.

### Keputusan pemilik 25 Sep (final; menggantikan default di atas)

1. **Penilaian bukan FIFO dan bukan rata-rata bergerak** → provenance / identifikasi khusus: klien memberi setiap
   barang baru SKU/artikel baru, jadi satu SKU punya satu harga beli. Biaya unit = biaya penerimaan asalnya (cost
   layer SKU+penerimaan), dikonsumsi menurut provenance, bukan urutan FIFO. Bila satu SKU mendapat penerimaan
   kedua dengan biaya berbeda (seharusnya tidak terjadi) → pakai biaya rata-rata tertimbang SKU itu dan tandai
   untuk ditinjau Finance. Pakai mesin `cost_layer` yang ada; ubah aturan konsumsinya.
2. Stok minus/kurang **tidak boleh** memblokir posting hari penjualan: HPP pada biaya terakhir SKU, tandai
   "biaya menunggu", diluruskan saat penerimaan datang.
3. Ongkos angkut/bongkar masuk (6009, 6010) **manual** — Finance mencatat sebagai baris tagihan/beban; tanpa
   alokasi atau kapitalisasi otomatis.
4. Diskon supplier: otomatis dari harga/diskon PO saat terima dan tagihan, boleh juga manual (rabat belakangan
   → 8004 Potongan Pembelian).
5. Retur ke supplier: tanpa akun khusus — lewat credit note supplier: Dr 2002 / Cr 1029 pada biaya provenance
   unit (selisih dengan nilai credit note → 5002), stok keluar bersamanya.
6. Transfer HO/DC → toko lewat BDP 1031 **site tujuan** (kirim Dr 1031 tujuan / Cr 1029 asal; terima Dr 1029
   tujuan / Cr 1031 tujuan); kaki afiliasi barang (Piutang/Hutang Afiliasi Barang) otomatis oleh poster. Terima
   kurang tetap di 1031 sampai diselesaikan.
7. Selisih stock opname resmi → 8007 otomatis (dua arah). Biaya kerja opname (6053) **manual**.
8. Rusak/hilang: dicatat manual oleh tim Inventory sebagai event persediaan; event itu memposting otomatis
   Dr 6011 / Cr 1029.
9. Cadangan kerusakan/usang (1033) **manual** oleh Finance (jurnal manual); tanpa cadangan otomatis.
10. Tukar barang: barang kembali masuk 1029 pada biaya provenance aslinya (HPP dibalik), barang baru HPP biasa
    pada biayanya sendiri.
11. Kantong belanja: beli Dr 1030 / Cr hutang; transfer lewat 1032; dipakai di POS Dr 6004 / Cr 1030 pada biaya
    SKU kantong; kantong rusak manual.
12. Tidak ada konsinyasi; tidak ada barang pemakaian sendiri — jangan dibangun.

## Ditunda (bukan sesi ini)

Satu jalur tutup buku + jurnal penutup (P2), gabung 4 modul frontend Finance ke satu menu 13 (P4),
reklasifikasi pinjaman jangka pendek, akrual otomatis, eliminasi konsolidasi, akun poin member.

## Keputusan tambahan pemilik (25 Sep sore) — wajib diterapkan pada run berikutnya

1. **Kas dalam perjalanan dihapus.** Tidak ada akunnya: hapus peta `cash_in_transit` dan langkahnya. Setoran
   toko: saat slip setoran → unit Dr 1057 / Cr 1002; saat mutasi bank HO → HO Dr bank / Cr 2028. Pasangan
   afiliasi yang belum cocok = uang di perjalanan (rekonsiliasi Interunit).
2. **Semua PPh manual, kecuali yang otomatis dari payroll.** PPh 21 yang dipotong di payroll tetap otomatis
   (Cr 2011). PPh 23, PPh 4(2), PPh 25, PPh 29, pajak atas bunga, dan PBB: **tidak dihitung/diposting otomatis**
   — Finance HO mengisi nominalnya sendiri (di pembayaran atau jurnal/pajak manual). Hapus perhitungan otomatis
   PPh 23 dari tarif jenis jasa bila ada; `payment_withhold` tetap sebagai aksi manual Finance.
3. **2032 Giro Keluar tidak dipakai** (giro memakai Outstanding Giro 2005–2009).
4. **6002 Pendapatan lain-lain disimpan untuk Finance** — tetap aktif, tanpa jalur otomatis; hanya dipakai lewat
   jurnal manual Finance HO. Semua pendapatan/biaya lain yang otomatis tetap ke 8008.
5. **1110 Disposed Inventory tidak dipakai.**
6. **Poin member:** tetap seperti kode sekarang — poin tidak dijurnal saat didapat; ditukar menjadi voucher,
   dan voucher yang dipakai di kasir = potongan penjualan 4012 (keputusan voucher gratis).
7. **Saldo normal 8003 & 8008 = kredit** (atribut akun, bukan akun baru).
8. **PPh 21 karyawan DITANGGUNG perusahaan** (tidak dipotong dari gaji; neto karyawan = bruto − potongan lain).
   COA klien tidak punya akun beban PPh 21, dan tidak boleh tambah akun → PPh 21 yang ditanggung adalah biaya
   pegawai: di akrual payroll Dr **Biaya Gaji** (6012 toko / 6026 HO-DC) / Cr **2011 Hutang PPh 21** (otomatis,
   satu-satunya PPh yang otomatis). Disetor oleh HO: Dr 2011 / Cr bank HO; porsi karyawan toko pindah ke HO lewat
   afiliasi pembiayaan. 1045 Prepaid PPh 21 hanya untuk lebih bayar (manual). Tandai di REPORT: konfirmasi ke
   akuntan klien karena pemilik menyebut "PPh 21 prepaid" — bila praktik klien Dr 1045 / Cr 2011, cukup ubah peta.
9. **BPJS:** menunggu konfirmasi akuntan klien (2017 vs 2021). Jangan ubah dulu.
10. **Review 25 Sep (per keyakinan) — perubahan yang wajib pada akun yang sudah terpasang:** 1002 hapus peta
    `cash_in_transit` · 2012/2014/2015/1045/1046/1047/8015 jadi MANUAL (tanpa jalur otomatis dari pembayaran/pajak;
    kecuali PPh 21 payroll di 2011) · 2022–2026 akrual YMHD hanya MANUAL · 2033 lepas dari voucher · 2011 tambah
    PPh 21 ditanggung (Dr Biaya Gaji) · 2021 tunggu akuntan. Rincian: artifact "Peta Akun Finance".

## Review 25 Sep malam — keputusan & koreksi (wajib)

1. **Pihak luar hanya berhadapan dengan HO** (sejalan 0376). Penerimaan supplier langsung ke toko: toko Dr 1029 /
   Cr 2029 Hutang Afiliasi Atas Barang; HO Dr 1058 / Cr 2002. Tagihan jasa/utilitas milik toko: toko Dr biaya /
   Cr 2028; HO Dr 1057 / Cr 2004; HO bayar Dr 2004 / Cr bank. Pastikan penulis GOODS_RECEIPT dan tagihan
   non-barang melakukan ini (guard 0376 menolak 2002/2004 di buku toko).
2. **Faktur barang dagangan mencocokkan hutang 2002 yang terbentuk saat penerimaan** dan hanya menyesuaikan
   selisih harga/pajak/qty (tidak ada lagi "menggantikan hutang penerimaan").
3. **Kas:** 1003 Petty Cash = dana operasional dari HO; 1004 Modal Kasir hanya lewat kejadian shift/float yang
   disahkan, tidak untuk biaya; 1002 Cash on Hand = hasil penjualan, keluar hanya ke HO/rekening HO atau untuk
   kewajiban HO atas instruksi HO, selalu menghasilkan afiliasi pembiayaan.
4. **Payroll kredit per komponen:** gaji/lembur/makan/transport → 2017; THR/bonus/insentif/pesangon → 2018;
   medis → 2020; BPJS → `bpjs_payable` (peta 2021, TO_CONFIRM vs 2017). Pembayaran mendebit hutang
   komponennya masing-masing (2017/2018/2020/2021).
5. **Barang tidak laku jual (termasuk rusak) = stok retur di 1029, tidak dibebankan.** Akun 6011 Biaya Kerusakan
   Persediaan TIDAK dipakai: cabut peta `inventory_damage`/`merchandise_damage` dari 6011 dan ubah jalur rusak
   menjadi perpindahan status stok (retur), lalu retur ke supplier lewat credit note. Barang hilang lewat selisih
   opname 8007.
6. **Akrual dibuat otomatis:** akhir bulan, untuk setiap templat tagihan rutin (listrik/air/telepon/sewa) yang
   tagihan periodenya belum di-post → Dr biaya / Cr 2022–2026 sebesar perkiraan templat; dibalik otomatis saat
   tagihan asli di-post (selisih ke biaya). Bunga pinjaman bulan berjalan dari jadwal pinjaman → Dr 8011/8012 /
   Cr 2019. Finance bisa mengoreksi sebelum tutup buku.
7. **Biaya bank (Dr 6043 / Cr bank) dan bunga bank (Dr bank / Cr 8002) dua kejadian terpisah.**
8. **Tidak ada posting laba ditahan bulanan**; 3003 = perlakuan akhir tahun, menunggu keputusan.
9. **Belum ada penulis (harus dibuat atau ditandai jujur):** reklasifikasi pinjaman jatuh tempo 2035–2040,
   akrual bunga 2019, akrual YMHD 2022–2026, management fee 4016/7032, kantong belanja hangus di SALE_DAY
   (kunci `bag_inventory`/`customer_supplies` belum dipakai posting harian), PPh 21 ditanggung (Dr biaya gaji).
10. Laporan status akun memakai lima penanda: sumber · mode (Otomatis/Terjadwal/Manual) · implementasi
    (Tersambung/Penulis belum dipanggil/Belum ada penulis/Tidak perlu) · keyakinan · kebijakan. Jangan menyebut
    "otomatis" hanya karena peta akun ada.
11. **Koreksi pemilik (25 Sep malam): rekening bank per unit TETAP dipakai** (COA klien punya Cash In Bank per
    unit). Aturan tetap: pemilik kewajiban mencatat hutangnya, pemilik rekening mencatat uang keluarnya, afiliasi
    pembiayaan di antaranya. Contoh: HO bayar supplier HO dari rekening bank unit → HO Dr 2002/2004 / Cr 2028
    (counter unit); unit Dr 1057 (counter HO) / Cr Cash In Bank unit. Jangan pasang guard yang menolak bank di
    site unit. Hutang ke pihak luar tetap hanya di buku HO.
12. **Koreksi review kedua (25 Sep malam) — JANGAN diterapkan sebelum pemilik memutuskan:** PPN (matikan
    pemecahan atau biarkan perilaku lama), barang hancur (6011 atau 8007), akrual otomatis 2019/2022–2026
    (usulan, belum terkunci), PPh 21 ditanggung (TO_CONFIRM), selisih kas kurang (sementara 1023). Poin 5 di
    atas soal 6011 ditangguhkan sampai keputusan barang hancur. Pendapatan sewa 8005/8006: Dr piutang/kas /
    Cr pendapatan dari tagihan ke penyewa (bukan pembagian prepaid).
13. **Keputusan final pemilik (25 Sep malam) — terapkan:**
    - **PPN diabaikan untuk sekarang:** matikan pemecahan PPN di SALE_DAY (penjualan dicatat penuh, tanpa
      `vat_out`) dan di faktur supplier (tanpa `vat_in`, nilai faktur penuh ke persediaan/biaya/hutang). Buat
      satu setting Finance `vat_enabled = false` supaya bisa dinyalakan lagi tanpa ubah kode.
    - **Barang benar-benar hancur** (pecah, basah, terbakar; tidak bisa diretur) dicatat tim Inventory → Dr 6011
      / Cr 1029. Barang tidak laku jual = stok retur (tanpa biaya). Hilang = selisih opname 8007. Poin 5 di
      "Review 25 Sep malam" (cabut 6011) DIBATALKAN.
    - **Akrual otomatis TERKUNCI:** utilitas & sewa dari templat tagihan rutin (2022–2026), bunga dari jadwal
      pinjaman (2019); dibalik otomatis saat tagihan/angsuran asli di-post; Finance bisa koreksi sebelum tutup.
14. **Keputusan pemilik (25 Sep, dari laporan & master COA klien) — terapkan:**
    - **Gaji pegawai unit ikut klien:** `payroll_expense` per unit ke kelompok Beban Pegawai (6026 Biaya Gaji
      Pegawai, 6027 Lembur, 6031 BPJS, 6032 THR, dst.), bukan 6012–6024 (Biaya Pegawai Operation). Di klien 2025:
      Beban Pegawai Rp 11,74 M vs Operation Rp 1,21 M. Siapa yang masuk Operation: tanya akuntan klien.
    - **Afiliasi boleh bersaldo minus** (mis. Hutang Affiliasi Atas Barang HO Cikupa −13,45 M). Jangan pasang
      guard saldo normal pada 1057–1059 / 2028–2029.
    - **PPh 25 dicatat di buku unit** (klien mengalokasikan PPh 25 per unit: Dr 8015 / Cr 2015 di site unit),
      tetap manual oleh Finance HO.
    - **Outstanding Giro dicatat di buku pemilik rekening** (giro atas rekening bank unit → 2005–2009 di site
      unit). 0376 `external_party_account` harus melepas 2005–2009.
    - **Temuan master COA (Laporan_Master_Account1.xlsx: 7.528 baris = 496 akun makna × 14 buku HO/C001–C013):**
      Hutang Lain-lain Principal (2030) dan Hutang Lain-lain (2031) disusun per lawan unit seperti afiliasi →
      keduanya akun antar-unit dengan lawan unit wajib; 2031 adalah pasangan Piutang Affiliasi Lain-lain (1059).
      MENUNGGU konfirmasi pemilik sebelum diubah (0376 sekarang menganggap 2030 pihak luar HO-only; 2031 dipakai
      menampung klaim non-medis & leasing).
    - **74 subjudul 7 digit klien** (CASH ON HAND, CASH IN BANK GIRO, BIAYA PENJUALAN, BIAYA PEGAWAI OPERATION, …)
      ditambahkan ke pohon sebagai kelompok (`is_group`, tidak bisa diposting). Bukan akun posting baru.
15. **Temuan dari neraca per cabang & laba rugi Pusat klien (25 Sep) — MENUNGGU keputusan, jangan diterapkan dulu:**
    - Setoran penjualan unit → HO di klien tercatat di **Afiliasi Atas Barang** (unit Dr 2029 / HO Cr 1058; itulah
      sebabnya saldonya minus: Cikupa −13,66 M, Wiramode −16,77 M). Kode kita (`store_money.rs`) memakai
      Pembiayaan. Usulan: ikut klien.
    - Biaya Pegawai Operation (6012–6024) di klien 100% dari PUSAT (pegawai gudang/operasional HO). Pegawai unit
      dan kantor HO → Beban Pegawai (6026–6038). Kunci `payroll_salary_operations`/`payroll_salary_office` sudah
      ada; perlu atribut departemen pegawai. Hutang PPh 21 hanya ada di buku PUSAT.
    - "Neraca 2 Tahunan" lama tidak memuat OTHER ASSETS; selisih laba Cikupa 380.808.035 = Disposed Inventory
      (1110) Cikupa. 1110 dipakai di semua unit (±2,73 M) dan belum punya jalur di sistem kita — kandidat untuk
      barang tidak bisa dijual.
    - Antar-unit lama tidak rekonsiliasi (selisih HO vs unit per unit sampai 4,1 M, total 5,6 M; buku PUSAT punya
      baris afiliasi dengan lawan HEAD OFFICE sendiri). Saldo awal afiliasi butuh langkah rekonsiliasi.
    - Pihak ketiga afiliasi lain-lain yang dipakai unit adalah Hutang Lain-lain Principal HEAD OFFICE (2030), bukan
      Hutang Lain-lain (2031, tidak dipakai).
