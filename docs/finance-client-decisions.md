# Pertanyaan yang menunggu jawaban klien

Satu berkas, satu bentuk. Untuk tiap butir: **pertanyaannya**, **kenapa penting**,
**apa yang aman dilakukan sekarang**, dan **apa yang terbuka setelah dijawab**.

Aturannya: ketidakpastian **kode akun** tidak boleh menjadi ketidakpastian
**arti akuntansi**. Semua butir di bawah punya perilaku aman yang sudah jalan,
jadi tidak ada yang menahan pekerjaan lain.

Sejak bagan 40 akun (0287–0292) kode akun adalah **milik kita** dan nama-namanya
milik klien; kode mereka dicetak kembali lewat `ledger_account_remap` — lihat
[`finance-legacy-codes.md`](./finance-legacy-codes.md). Beberapa pertanyaan di
bawah karenanya berubah bentuk: yang dulu "akun mana" sekarang "kategori mana",
dan dua di antaranya hilang sama sekali.

---

## 1. Kode resmi untuk empat puluh akun yang kita cetak sendiri

**Pertanyaan.** Bagan yang diposting sekarang adalah 40 akun berkode 4 digit,
dan keempat puluh kode itu kita yang memilih. Nama-namanya milik klien. Apakah
klien mengeluarkan kode resmi mereka sendiri untuk keempat puluhnya, atau
menerima kode kita dan memakai cetakan kode lama untuk pembanding?

**Kenapa penting.** Kalau klien punya kode sendiri, laporan mereka dan laporan
kita akan menyebut baris yang sama dengan dua nomor.

**Aman sekarang.** Keempat puluh baris ditandai
`ledger_account.code_provenance = 'PENDING_CLIENT_CODE'` (0289). Audit
`scripts/audit-chart-against-client.py` membacanya sebagai pengecualian yang
dideklarasikan, dan 190 akun lama tetap diperiksa nama demi nama terhadap
ekspor klien. Yang perlu dikatakan terus terang: nama keempat puluh akun baru
**tidak** diperiksa audit itu, karena masing-masing berdiri untuk beberapa akun
klien sekaligus dan tidak ada satu nama klien untuk dibandingkan.

**Yang hilang dari daftar ini.** Lima kode yang dulu kita cetak sendiri —
Setoran Dalam Perjalanan, Piutang QRIS, Penjualan QRIS, Hutang Voucher, Hutang
Pajak PPh Pasal 29 — bukan lagi akun. Masing-masing adalah kategori pada akun
yang sudah ada: `1101 × TRANSIT`, `1201 × QRIS`, `4101 × QRIS`,
`2401 × VOUCHER_LIABILITY`, `2201 × PPH29`. Sebuah bagan 40 akun plus kategori
tidak bisa kehabisan daun, jadi tidak ada lagi alasan untuk mengarang kode.

**Setelah dijawab.** Satu `UPDATE` per akun + satu baris `ledger_account_remap`.
Tidak ada jurnal yang bergerak.

---

## 2. PPh 29 — sebelum Tax

**Pertanyaan.** Untuk tahun berjalan: berapa PPh 29 terutang, dan apakah ada
saldo PPh 29 dibayar dimuka dari tahun lalu yang masih hidup?

**Kenapa penting.** `2201 × PPH29` (kewajiban) dan `1402 × PPH29` (aset) adalah
dua hal berbeda. Menjaringkan keduanya karena namanya mirip akan menyembunyikan
salah satunya — dan sekarang keduanya membawa **kode kategori yang sama** pada
akun yang berbeda, jadi yang membedakannya adalah sisi neraca, bukan namanya.
Kolom `tax_type.nature` (`PAYABLE` vs `CREDIT`) adalah yang menegakkannya.

**Aman sekarang.** Keduanya ada, terpisah, dan tidak ada aturan yang menjaring
otomatis.

**Setelah dijawab.** Perhitungan dan penyelesaian PPh 29 di modul Tax.

---

## 3. Empat bank selain BCA

**Pertanyaan.** Rekening giro/tabungan mana yang nyata di Mandiri, BRI, BNI,
Danamon — nomor, pemegang, cabang?

**Kenapa penting.** Ini **bukan lagi** pertanyaan tentang bagan. Semua rekening
memposting ke `1102` (dan giro keluar ke `2103`); yang hilang adalah barisnya di
`company_bank_account`, dan FK
`journal_line_bank_account_agrees_with_the_account_posted` yang memaksa akun dan
rekening sepakat tidak punya rekening untuk disepakati. Giro yang ditulis di
bank yang belum punya baris tidak bisa dikliringkan.

**Aman sekarang.** Posting menolak dengan menyebut bank yang belum dipetakan,
bukan menebak. Peta sudah menyebut kelima bank (BCA, Mandiri, BRI, BNI,
Danamon), jadi yang tersisa murni data rekening.

**Setelah dijawab.** Impor lewat `docs/templates/company-bank-accounts.csv`.

---

## 4. Rak: 36 baris atau satu — **TERJAWAB oleh bentuk bagan**

**Pertanyaan.** Bagan klien punya `Rak 1`…`Rak 36` di tiga famili (aset,
cadangan penggantian, beban penggantian). Apakah mereka benar-benar ingin 36
akun terpisah, atau satu akun dengan register aset di belakangnya?

**Jawabannya sekarang: keduanya, dan tanpa memilih.** Ketiga puluh enam kelas
ada semuanya — `OE_RAK_1` … `OE_TAS_KERANJANG_BELANJA`, 36 baris di
`asset_class` dengan nama klien apa adanya — dan ketiganya memposting ke `1601`,
`1610` dan `7101`. Laporan per kelas dibaca dari register aset, bukan dari
bagan. 980 pasangan pemetaan yang dulu menunggu jawaban ini sekarang 108 baris
peta yang ditulis seed dari daftar kelas itu sendiri.

Yang **masih** pertanyaan klien: apakah laporan cadangan penggantian mereka
ingin dibaca per kelas (36 baris) atau per kelompok. Itu pertanyaan laporan,
bukan pertanyaan bagan, dan tidak menahan apa pun.

---

## 5. Pembentukan cadangan penggantian (RR)

**Pertanyaan.** Apakah cadangan penggantian operating equipment masih dibentuk
tiap bulan, atau hanya dipakai saat rak diganti?

**Kenapa penting.** `1610 Cadangan penggantian operating equipment` menolak
posting `ASSET_RESERVE` hari ini — sengaja (0263): jalurnya "ditahan menunggu
kebijakan".

**Aman sekarang.** Penarikan boleh, pembentukan ditolak dengan alasan jelas.

---

## 6. Apakah ada kontrak leasing aktif

**Pertanyaan.** Klien punya akun `Biaya Bunga Leasing` di bagan lamanya (kini
`8101` dengan fasilitas ber-tipe `LEASE`). Apakah ada kontrak leasing yang
berjalan sekarang?

**Kenapa penting.** Menentukan apakah Financing perlu tipe `LEASE` sekarang atau
tidak sama sekali.

**Aman sekarang.** Kapabilitas lease dibiarkan dorman; bunga leasing tetap bisa
dicatat sebagai beban bunga biasa.

---

## 7. Dua penulis untuk satu setoran toko *(keputusan teknik, bukan klien)*

**Temuan.** Dua modul menulis setoran toko ke buku besar:

| | `deposits.rs` | `store_money.rs` |
|---|---|---|
| rute | `/api/v1/finance/deposits/{id}/bank` · `/land` | `/api/v1/store/…/deposits/{id}/hand-over` · `/confirm` |
| status | `banked_on` / `landed_on` | `PREPARED` → `DEPOSITED` → `CONFIRMED` |
| kaki bank | di **toko** | di **kantor pusat** (benar) |

**Kenapa penting.** Ini bentuk yang sama dengan dua penulis hari dagang yang
0273 tutup. Lebih jauh, kaki bank `deposits.rs` melanggar aturan dimensi
`company` yang kernel tegakkan sejak 0262 — akun bank memposting di `dc`, bukan
di toko — jadi `/land` menolak dengan *"belongs to the company and not to a
shop"* dan empat tes di `store_documents_integration` merah karenanya.

**Aman sekarang.** Jalur `store_money.rs` benar dan dipakai UI toko. Jalur
`deposits.rs` gagal dengan penolakan yang jelas, bukan dengan angka salah.

**Perlu keputusan.** Satu otoritas dipilih dan yang lain dihapus, seperti 0273 —
atau `deposits.rs` diperbaiki kaki banknya dan keduanya tetap hidup. Ini
menyentuh dua modul dan dicatat di sini alih-alih diputuskan sepihak.

---

## 8. Uang muka: empat keperluan, mana untuk apa?

**Pertanyaan.** Klien membedakan empat keperluan uang muka — *Travelling*,
*Purchase*, *To Contractors*, *Others*. Keperluan apa yang masuk ke
masing-masing?

**Kenapa penting.** Setiap uang muka menyebut satu qualifier (`PERJALANAN`,
`PURCHASE`, `CONTRACTORS`, `OTHERS`) dan itulah yang memilih **kategorinya**
(`ADVANCED_TRAVELLING`, `ADVANCED_PURCHASE`, `ADVANCED_TO_CONTRACTORS`,
`ADVANCED_OTHERS`). Akunnya satu — `1403` — untuk keempatnya.

**Aman sekarang.** Qualifier diisi oleh yang membuat dokumen; yang belum
dipetakan ditolak dengan menyebut namanya, bukan ditebak.

**Blocking?** TIDAK.

---

## 9. Siapa pemiliknya

**Pertanyaan.** Nama dan kode pemilik/investor, dan siapa yang pernah menyetor
modal, mengambil prive, atau meminjamkan uang ke perusahaan.

**Kenapa penting.** `3101 Modal disetor`, `3102 Prive` dan `2502 Pinjaman
pemilik` adalah akun perusahaan dan **tidak membawa kategori sama sekali**:
siapa pemiliknya adalah baris di register `principal`, bukan sebuah kode. Tanpa
identitas, tidak ada yang bisa menjawab "berapa punya siapa".

**Aman sekarang.** Tabel `principal` kosong. Tidak ada gerakan pemilik yang bisa
dicatat sampai ada namanya — dan itu benar: mencatatnya atas nama "pemilik"
tanpa identitas adalah menebak.

**Blocking?** YA untuk modul pemilik; TIDAK untuk yang lain.

---

## 10. Fasilitas pembiayaan yang berjalan

**Pertanyaan.** Pinjaman bank atau pinjaman pemilik yang masih berjalan: pemberi,
pokok, tanggal, bunga, dan jadwal angsurannya.

**Kenapa penting.** Jadwal diambil dari kontrak, bukan dari rumus. Tanpa jadwal,
tidak ada angsuran yang bisa diposting dan bagian lancar tidak bisa dihitung.

**Aman sekarang.** `financing_facility` kosong; bunga pinjaman tetap bisa dicatat
sebagai beban biasa.

**Blocking?** YA untuk modul pembiayaan; TIDAK untuk yang lain.

---

## 11. Leasing: ada kontrak aktif?

**Pertanyaan.** Bunga leasing punya tempatnya sendiri di bagan lama klien dan
sekarang jatuh di `8101` dengan `financing_facility.kind = 'LEASE'`. Ada kontrak
leasing berjalan?

**Aman sekarang.** Tipe `LEASE` ada di `financing_facility` dan **dorman**: sisi
asetnya (right-of-use dan penyusutannya) tidak dibangun, karena membangunnya di
atas sebuah akun bunga berarti mengarang fakta bisnis.

**Blocking?** TIDAK.

---

## 12. Prepaid dan pajak yang berjalan saat cutover

**Pertanyaan.** Saat pindah sistem: prepayment apa yang masih berjalan (asuransi,
sewa, maintenance) dengan sisa dan periodenya; dan untuk pajak — saldo PPh 29,
angsuran PPh 25 yang sudah disetor tahun ini, masa PPN yang belum dilaporkan.

**Kenapa penting.** Saldo awal akun kontrol harus cocok dengan jadwal
pendukungnya. Tanpa jadwal, `1401` akan punya saldo yang tidak ada yang
mengamortisasi, dan panel kontrol akan menampilkannya sebagai selisih — yang
memang benar, dan bukan sesuatu yang boleh ditutup dengan akun penyeimbang.
Sekarang saldonya juga harus dibawa per `prepaid_kind`, karena baris pada `1401`
tanpa kategori ditolak: sheet saldo awal harus menyebut asuransi, sewa toko atau
kontrak maintenance, bukan "biaya dibayar dimuka".

**Aman sekarang.** Selisih ditampilkan, tidak ditambal.

**Blocking?** TIDAK untuk kode; YA untuk cutover.

---

## 13. Metode penilaian persediaan

**Pertanyaan.** Persediaan dinilai dengan metode apa — FIFO, rata-rata bergerak,
atau harga beli terakhir?

**Kenapa penting.** Ini satu-satunya kontrol yang tidak bisa dijawab sama sekali:
stok punya jumlah dan tidak punya nilai, jadi `1301 Persediaan` tidak bisa
direkonsiliasi ke gudang, dan HPP tidak bisa dihitung.

**Aman sekarang.** Panel kontrol menampilkan persediaan sebagai `covered = false`
dengan alasannya; tutup bulan melaporkannya UNKNOWN, bukan OK.

**Blocking?** YA untuk penilaian persediaan dan HPP; TIDAK untuk yang lain.

---

## 14. Potongan pembelian: kontra-HPP atau pendapatan lain?

**Pertanyaan untuk akuntan mereka, bukan untuk pemilik.** Bagan 40 akun
memindahkan potongan pembelian dari pendapatan lain-lain ke **kontra-HPP**:
`5101 × PURCHASE_DISCOUNT`, bukan akun di akar 8. Apakah akuntan menerimanya?

**Kenapa penting.** Ini satu-satunya perubahan di seluruh peleburan yang
**mengubah angka laba kotor**, bukan hanya tempat angka itu dibaca. Semua
peleburan lain memindahkan rincian dari kode akun ke kategori dan meninggalkan
tiap total di baris laporan yang sama. Yang ini memindahkan sebuah angka dari
bawah garis ke atas garis: laba kotor 2026 akan lebih tinggi daripada laba kotor
2024–2025 dengan penjualan dan pembelian yang persis sama, dan siapa pun yang
membandingkan dua tahun itu berdampingan akan melihat lompatan yang bukan
kinerja.

**Kenapa kita mengusulkannya.** PSAK 14: diskon dagang mengurangi biaya
perolehan persediaan. Klien memfilekannya di akar 8 (*Potongan Pembelian* di
bawah *Pendapatan & Biaya Lain-lain*) — itu kebiasaan, bukan prinsip. Tinjauan
pihak ketiga atas bagan yang sama (18 September 2026) sampai ke tempat yang sama
dari arah lain.

**Aman sekarang.** Dua kunci — `purchase_discount` dan
`purchase_price_variance` — sama-sama menunjuk `5101 × PURCHASE_DISCOUNT`, dan
keduanya adalah satu baris di `scripts/seed-finance.py` dan satu baris di
`ledger_account_remap`. Membalikkannya ke akun pendapatan lain (`4301` dengan
kategorinya sendiri) adalah perubahan peta, bukan perubahan skema; tidak ada
jurnal yang perlu dipindahkan selama ini diputuskan sebelum saldo awal dimuat.

**Yang tetap benar apa pun jawabannya.** Cetakan kode lama tetap
menempatkannya di tempat lamanya — `legacy_code()` membaca
`ledger_account_remap`, dan baris untuk `8010110003` tetap ada — jadi pembanding
2024–2025 dalam kode mereka sendiri tidak ikut berpindah.

**Blocking?** TIDAK untuk kode. **YA untuk laporan pembanding** — dan lebih
murah dijawab sebelum cutover daripada sesudah.

---

## 15. Kapan beban gaji diakui — dan siapa yang memposting jurnalnya

**Pertanyaan untuk pemilik dan akuntan bersama, dan yang paling besar di daftar
ini.**

**Keadaannya sekarang.** Run payroll **tidak memposting jurnal apa pun**.
`backend/src/cloud/postgres/pay.rs` menyusun slip, menghitung komponen, dan
mengesahkan run — tanpa satu pun `PostingIntent`. Akibatnya:

- **Tidak ada beban gaji di buku besar.** Nol, bukan salah tempat.
- `payroll_payable` hanya pernah **didebit**, oleh toko yang membayar kasbon
  pegawai (`store_money.rs`). Kredit yang seharusnya menaikkan utangnya tidak
  pernah ada, jadi saldonya bergerak ke arah yang salah.
- Panel kontrol memuat baris PAYROLL yang selisihnya selalu sama dengan seluruh
  subledger. Sampai 18 September 2026 baris itu menyatakan dirinya `covered`;
  sekarang tidak, dan menyebutkan alasannya.

**Ukurannya.** Buku besar klien sendiri untuk 2025 mencatat gaji pegawai kantor
pusat saja **Rp 2,87 miliar** — pos terbesar dari tiga yang memakan 73% belanja
PUSAT (`docs/finance-coa-usage-2024-2025.md`). Ini bukan celah kecil.

**Bukan disebabkan bagan 40 akun.** Lubang ini mendahuluinya. Yang berubah
hanyalah bahwa lubang itu sekarang **kelihatan**: bebannya punya satu rumah
bernama `6201 Beban karyawan` dengan `pay_component`, alih-alih tersebar di 26
daun klien yang tak satu pun pernah dipetakan. Sebuah akun yang tak terjangkau
aturan apa pun lebih mudah dilihat daripada enam puluh daun di daftar yang tak
pernah dibaca.

**Yang harus diputuskan sebelum kodenya ditulis**, karena ini kebijakan
akuntansi dan bukan cacat yang bisa ditambal:

1. **Kapan beban diakui** — saat run disahkan (akrual, dengan
   `2301 × BIAYA_GAJI_DAN_UPAH_YMHD` sebagai lawannya), atau saat dibayar
   (kas basis)? Akrual adalah jawaban yang benar secara standar dan berarti
   utang gaji punya saldo di antara keduanya.
2. **Per komponen atau satu baris** — `6201` membawa 13 `pay_component`
   (gaji, lembur, uang makan, BPJS, THR…). Memposting per komponen memberi
   laporan yang klien sudah punya kebiasaan membacanya; memposting satu baris
   neto tidak bisa dipecah kemudian.
3. **Potongan pegawai** — PPh 21 dan BPJS yang dipotong dari gaji adalah
   kewajiban ke pihak ketiga (`2201 × PPH21`), bukan pengurang beban.

**Blocking?** **YA untuk go-live.** Sebuah sistem finance yang tidak mengenal
beban terbesar kliennya tidak bisa menutup bulan dengan jujur.

---

## 16. Amortisasi pra-pembukaan: apakah larangannya berlaku untuk software juga?

**Pertanyaan kecil, tetapi menyangkut putusan yang sudah pernah diambil.**

0267 menulis dua aturan pada `7010216002 Biaya Amortisasi Biaya Pre Opening`:
hanya `AMORTIZATION_RUN` dan `OPENING` yang boleh menyentuhnya. 0294
memindahkannya ke `7101 × AMORTISATION` — satu-satunya grain yang tersedia,
karena memindahkannya ke `7101` saja akan membekukan **setiap** proses
penyusutan.

Akibatnya daftar izinnya kini juga menutupi `7010216001 Biaya Amortisasi
Seventh Soft Application`, yang berbagi kategori `AMORTISATION`. Kalau larangan
itu memang dimaksudkan hanya untuk biaya pra-pembukaan, `depreciation_kind`
perlu nilai keempat (`AMORTISATION_PRE_OPENING`) supaya keduanya bisa dibedakan
lagi. Kalau memang berlaku untuk semua amortisasi, tidak ada yang perlu
dikerjakan.

**Blocking?** TIDAK. Efeknya hanya menyempitkan pintu untuk satu akun yang
sebelumnya lebih longgar, bukan melonggarkan.

---

## 17. Setoran toko: kaki banknya dibukukan di toko atau di kantor pusat?

**Sudah setengah terjawab oleh pemilik, dan perlu satu kalimat lagi.**

Pemilik menetapkan (18 September 2026) bahwa **toko tidak memegang rekening bank
apa pun**. Bagan mengikutinya: `1102 Bank` ber-`dimension: company`, jadi
kaki bank selalu jatuh di kantor pusat.

Dua modul masih tidak sepakat soal ini, dan ini persis keputusan yang tertunda
di §7:

- `store_money.rs` membukukan kaki banknya di `HEAD_OFFICE_SITE` — **sesuai
  kebijakan**.
- `deposits.rs` membukukan kaki banknya di `site_id` toko — **tidak bisa
  jalan**: `company_bank_account` ber-baris per tempat, dan foreign key
  `journal_line (bank_account_id, account_code, site_id)` mengikat ketiganya,
  jadi rekening bank di toko tidak akan pernah bisa membawa satu baris jurnal
  pun.

Jadi kebijakan pemilik sudah memilih pemenangnya; yang tersisa hanyalah
menghapus penulis yang satunya, dan itu **keputusan teknik**, bukan keputusan
klien. Dicatat di sini supaya alasannya tidak hilang: bukan karena satu modul
lebih rapi, melainkan karena hanya satu dari keduanya yang bisa memposting sama
sekali.

**Blocking?** YA untuk go-live, tetapi tidak menunggu klien.

---

## 18. Poin member: nilai satu poin, dan berapa yang diperkirakan hangus

**Dua angka dari klien, dan keduanya menentukan sebuah kewajiban.**

Poin member hari ini hanya bertambah; penukaran belum dibangun, dan belum ada
satu jurnal pun untuk poin. Itu benar untuk sekarang — belum ada peristiwa uang.

Begitu penukaran ada, perlakuannya sudah ditetapkan (0297): **PSAK 72**. Poin
adalah kewajiban kinerja terpisah. Sebagian pendapatan dari penjualan yang
menghasilkan poin **ditangguhkan** saat poin diberikan, dan diakui saat poin
ditukar atau hangus:

```
saat jual (dapat poin)  Dr Kas 100.000 / Cr Penjualan 98.000 / Cr 2402 Kewajiban Poin 2.000
saat tukar              Dr 2402 / Cr Penjualan
saat hangus             Dr 2402 / Cr Pendapatan Lain-lain
```

Akun `2402 Kewajiban Poin Member` sudah ada dan **BLOCKED** — tidak ada yang
boleh menggerakkannya sampai dua angka ini ada:

1. **Nilai satu poin dalam rupiah** — berapa pendapatan yang ditangguhkan per
   poin. Tanpa ini tidak ada angka untuk ditangguhkan.
2. **Tingkat hangus yang diperkirakan** (*breakage*) — persentase poin yang
   diperkirakan tidak akan pernah ditukar. PSAK 72 membolehkan mengakui bagian
   ini lebih awal secara proporsional; tanpa perkiraan, seluruh poin dianggap
   akan ditukar dan kewajibannya dilebih-lebihkan.

**Alternatif yang ditolak**: membebankan saat ditukar (`Dr Biaya Promosi / Cr
Penjualan`), tanpa jurnal saat poin diberikan. Lazim di ritel kecil, lebih
sederhana, tetapi tidak sesuai PSAK 72 dan membuat laba tahun berjalan tampak
lebih tinggi selama poin menumpuk. Kalau klien tetap memilih ini, `2402` tidak
dipakai dan tetap BLOCKED — tidak ada yang rusak.

**Blocking?** TIDAK sampai fitur penukaran dibangun. Saat itu, YA.

---

# Sudah dijawab

Butir yang pernah ada di daftar atas dan sekarang punya jawaban. Ditinggalkan di
sini, bukan dihapus: jawaban yang tidak tercatat akan ditanyakan lagi enam bulan
lagi, dan kode yang berdiri di atasnya tidak akan bisa menjelaskan diri.

## A. Berapa badan hukum — **SATU** (pemilik, 18 September 2026)

**Jawabannya.** Satu badan hukum: satu kantor pusat dan 13 toko fashion di
dalamnya. Bukan 14 perusahaan, bukan grup.

**Apa yang berubah karenanya.**

- **Ekuitas milik perusahaan, bukan per unit.** `3101`, `3102` dan `3201`
  berdimensi `company` dan hanya memposting di kantor pusat.
- **Antar-unit menjadi kliring internal semata.** Di dalam satu entitas, saldo
  antar-unit bukan aset dan bukan kewajiban — ia tereliminasi. Satu akun
  bertanda, `1501`, dan **jumlahnya untuk seluruh perusahaan wajib nol setiap
  saat**; lawannya tetap terbaca di `counter_site_id`, jadi *gross* per pasangan
  tidak hilang. Ini menggantikan empat akun afiliasi yang invariannya tersebar
  dan tidak pernah diuji.
- **Tidak ada tabel `legal_entity`**, dan tidak akan dibuat sampai ada badan
  hukum kedua.

**Yang masih terbuka di sekitarnya.** Nama 14 unit dan urutannya
(`docs/coa-cube.md` §8): pemetaan nama toko ke akhiran `00`–`13` masih asumsi
offset ordinal. Itu hanya memengaruhi *cetakan kode lama*, bukan bagan baru —
lihat [`finance-legacy-codes.md`](./finance-legacy-codes.md).

## B. Siapa menyentuh akun unit — **HANYA KANTOR PUSAT** (pemilik, 18 September 2026)

**Jawabannya.** Toko melihat tiga pot kasnya sendiri — laci, kas kecil, modal
kasir — dan tidak ada yang lain. Semua akun ber-`unit` lainnya diisi oleh kantor
pusat atas nama toko.

**Apa yang berubah karenanya.**

- Sumbu `unit` adalah **label yang dipilih HO**, bukan hak akses toko. Sebuah
  akun berdimensi `unit` tidak berarti toko itu boleh mempostingnya.
- Tiga pot itu adalah tiga kategori pada satu akun (`1101 × DRAWER · PETTY ·
  FLOAT`), ditambah `TRANSIT` untuk uang yang sudah keluar laci dan belum sampai
  bank — yang dipegang jalur setoran, bukan oleh kasir.
- **Toko tidak pernah memegang rekening bank.** `1102` berdimensi `company`.
  Yang dipegang toko adalah *tujuan* setoran (`store_bank_destination`), dan
  sejak 0271 sebuah rekening koran harus menyebut rekening perusahaan yang nyata
  — jadi "Rekening koran store-01" ditolak, bukan dibuat.
- Layar toko karenanya menampilkan tiga saldo dan satu daftar setoran, dan
  bukan neraca.
