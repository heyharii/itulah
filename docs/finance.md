# Finance — buku, pintu posting, dan tiga acuan yang harus jadi satu

**Status:** model target, dengan implementasi sekarang dicatat di sampingnya.
Rujukan kode dibaca dari `feat/handheld-rfid` di `15cd477`. §0 adalah hasil
riset perbandingan tiga acuan yang diminta pemilik pada 12 September 2026, dan
putusannya dibekukan di sini. Dikoreksi hari yang sama: acuan prototipe yang
benar adalah rancangan **11 September** di `demo/share/public/`, bukan artifact
6 September — `demo/` ada di `.gitignore`, jadi ia tidak ikut tersapu pencarian
pertama.

Kosakata: [`../CONTEXT.md`](../CONTEXT.md). Sebelum ini:
[supplier bill](./supplier-bill.md) — pencocokan tagihan pemasok, posting, dan
pembayaran dimiliki dokumen itu dan tidak diulang di sini. Pembanding luar:
[ERPNext](./erpnext-reference.md).

Dokumen ini memiliki: **siapa yang boleh menulis buku, bagaimana satu arti
menjadi kode akun klien, apa yang hari ini benar-benar sampai ke buku, dan
acuan mana yang menang ketika dua acuan berbeda.**

---

## 0. Kenapa finance terasa berputar

Bukan karena keputusannya berubah-ubah. Karena **ada lima badan pekerjaan
finance yang hidup berdampingan**, tidak ada satu pun yang dipensiunkan, dan
tiga di antaranya sama-sama menyebut dirinya "finance".

| | Badan pekerjaan | Di mana | Ukuran | Menulis jurnal? | Terakhir disentuh |
|---|---|---|---|---|---|
| **A** | **Modul Finance hidup** | `frontend-hub/src/screens/finance` + backend | 12 layar · 38 endpoint · 18 tabel · 13.610 baris | **Ya — satu-satunya** | branch ini |
| **B** | **Finance Lab** | `frontend-hub/src/screens/finance-lab` | 52 layar · 34.646 baris · engine 29 rule package | Tidak — simulasi browser, **nol** panggilan jaringan | branch ini |
| **C** | **Prototipe rancangan 11 September** | `demo/share/public/finance.html` (846 KB, **gitignored**) | 13 menu · 67 tab · **8 keadaan layar** · spek sidebar 72 submenu · 35 form · 8 layar rujukan | Tidak | 11 Sep 2026 |
| **D** | **Lane `finance-control`** | branch `feat/finance-control` + `feat/finance-control-ui` | 22 modul Rust · migrasi 0107–0158 · 14 layar hub | Ya, **di branch-nya sendiri** | 7 Sep 2026, belum merge |
| **E** | Sisa-sisa | artifact *Finance Workbench* `980cb97e` · `dasbor/19-finance.html` · `frontend-hub-2/src/modules/finance` · `frontend-cloud/src/components/finance` | 13+10 · 1 · 7 · 15 layar | Tidak | 6 Sep dan sebelumnya |

C punya pasangan HR yang dibangun generator yang sama pada hari yang sama —
`demo/share/public/hr.html`, 14 menu · 41 tab, dari
`Rancangan_HR_Menu_Kewenangan_dan_Form.xlsx`. Kalau salah satunya diubah,
yang lain ikut, karena bentuk layarnya satu keluarga.

**Garis keturunannya bukan tiga rival, melainkan satu rantai:** B (52 layar)
→ review 10 September (`docs/finance-lab-ui-ux-review-2026-09-10.md`, usul 11
menu) → workbook + prototipe 11 September (C, 13 menu). C adalah kesimpulan
review atas B, bukan tandingannya. Yang benar-benar berdiri sendiri adalah
artifact 6 September, dan ia **disalip** — tapi ia membawa satu hal yang C
jatuhkan, lihat putusan di bawah.

Tiga yang diminta dibandingkan adalah **A, B dan C**. Tapi riset ini menemukan
**D**, dan D mengubah jawabannya: 52 migrasi dan 22 modul Rust finance duduk di
dua branch yang tidak pernah di-merge, sejak 7 September 2026, dengan **nomor
migrasi `0106` dipakai dua kali dengan isi berbeda** di kedua sisi
(`a_statement_can_arrive_on_its_own` di sini, `a_tender_says_which_acquirer_took_it`
di sana). Selama D belum diputuskan — merge, ambil sebagian, atau buang —
setiap dokumen finance adalah dokumen sementara, dan itulah sumber putarannya.

### Apa yang hanya dimiliki satu acuan

Ini bagian yang membuat "mana yang lebih baik" bisa dijawab, bukan didebatkan.

| Hal | A hidup | B lab | C prototipe |
|---|---|---|---|
| Benar-benar menulis jurnal | **ya** | tidak | tidak |
| Invarian ditegakkan database (seimbang, periode, append-only) | **ya** | tidak | tidak |
| Tipe dari Rust lewat contract | **ya** | tidak | tidak |
| Bagan akun klien lengkap 7.528 baris | di DB | **di kode** | tidak — hanya baris contoh |
| Setiap kode akun di layar ditarik dari peta arti→akun | ya | **ya** | ya, sebagai tab `Posting Rules` |
| Aturan posting sebagai objek dengan bukti/kesiapan/aktivasi | tidak | **ya (29 package)** | ya, sebagai kolom `Aktivasi` + `Bukti uji` |
| Menolak memposting aturan yang buktinya kurang | tidak | **ya (3)** | tidak |
| Cakupan 76 keluarga COA klien | ~30 arti | **76/76** | 13 menu · 67 tab |
| Afiliasi antar unit (3 keluarga, 1.386 daun) | tidak | ya | **ya, satu menu penuh** |
| Register giro dengan siklus hidup | tidak | sebagian | **ya** |
| Settlement kanal (EDC/QRIS, MDR, selisih) | tidak | sebagian | **ya** |
| **Delapan keadaan layar, bisa dinyalakan satu-satu** | tidak | tidak | **ya** |
| Spek sidebar detail per submenu | tidak | tidak | **ya (72)** |
| Spek form | tidak | tidak | **ya (35)** |
| Katalog pola penyajian + matriks desain per submenu | tidak | tidak | **ya** |
| Dokumen cetak A4 (transaksi · statement · register) | tidak | tidak | **ya** |
| Kamus istilah (Bill ≠ Invoice) | tidak | tidak | **ya** |
| Akun yang belum ada di bagan klien diberi tanda "usulan" | — | — | ada di pendahulunya (5 akun) |
| Perspektif toko sebagai layar sendiri | tidak | tidak | **tidak** — hanya ada di artifact 6 Sep |

### Putusan

1. **Bentuk modul — menu, tab, nama, dan keadaan layar — diambil dari C,
   rancangan 11 September.**
   C yang terbaru, dan ia satu-satunya yang merancang **layar dalam delapan
   keadaan**, bukan cuma dalam keadaan penuh data. Ia juga membawa hal yang
   tidak ada di mana pun: spek sidebar detail untuk 72 submenu, 35 form,
   katalog pola penyajian, matriks desain per submenu, tiga format dokumen
   cetak, dan kamus istilah yang mengunci *Bill* ≠ *Invoice*. Dan ia menyerap
   gagasan terbaik B ke tempat yang benar: `Finance Settings → Posting Rules`
   membawa kolom **Aktivasi** dan **Bukti uji** — aturan posting sebagai
   sesuatu yang dinyalakan dan dibuktikan, bukan yang selalu menyala.

   **Satu hal yang C jatuhkan dan harus dikembalikan:** perspektif toko.
   Artifact 6 September punya 10 layar toko sendiri (shift & laci, pengeluaran
   toko, setoran, rekonsiliasi tender, saldo ke HO, buku toko); C
   menggantikannya dengan *Cakupan unit* sebagai hak akses. Untuk 13 toko itu
   bukan pengganti yang setara — lihat keputusan terbuka §11.8. Pasangan
   HR-nya justru melakukannya: 9 menu HR + 5 menu aplikasi karyawan dalam satu
   berkas.

2. **Kontrak posting — aturan, bukti, aktivasi, binding — diambil dari B,
   sebagai spesifikasi, bukan sebagai kode.**
   B adalah satu-satunya artefak yang memisahkan tiga hal yang selama ini
   dicampur: *buktinya apa* (jurnal klien yang mana), *seberapa jadi
   implementasinya*, dan *boleh jalan atau tidak untuk buku ini*. Tiga aturannya
   sengaja **mati** dengan alasan tertulis, dan itu justru nilainya. Tapi ia
   simulasi browser tanpa satu pun panggilan jaringan, dan **tidak boleh pernah
   menjadi buku kedua**.

3. **Mekanika yang berlaku — pintu posting, resolver, invarian — tetap A.**
   A satu-satunya yang benar-benar menulis. Fondasinya matang dan tidak perlu
   dibangun ulang: satu pintu, jurnal append-only, saldo tidak pernah disimpan,
   arti bukan kode akun. Yang kurang dari A bukan arsitektur, melainkan **isi**.

4. **E bukan acuan, dengan satu pengecualian.** Artifact *Finance Workbench*
   6 September sudah disalip C untuk bentuk menu, tapi **sisi tokonya dan lima
   akun usulannya tetap berlaku** sampai C menjawabnya.
   `dasbor/19-finance.html` adalah satu layar laporan harian yang sengaja
   sebesar satu endpoint dan tidak menyentuh buku sama sekali; nilainya adalah
   disiplinnya ("sebesar yang backend punya, tidak lebih"), bukan bentuknya.
   `frontend-hub-2` dan `frontend-cloud` adalah port sebagian dari A.

5. **D diputuskan lebih dulu, sebelum satu baris finance baru ditulis.**
   Membangun di atas A tanpa memutuskan D akan menghasilkan modul paralel
   ketiga.

### Aturan kalau tiga acuan berbeda

```
soal APA YANG BENAR HARI INI     → A menang  (kode yang berjalan)
soal BENTUK layar dan menu       → C menang  (keputusan pemilik)
soal ATURAN posting              → B menang  (bukti jurnal klien)
soal KODE AKUN                   → bagan klien menang (FINANCE-COA-COVERAGE.md)
```

Tidak ada acuan yang menang di luar kolomnya sendiri.

---

## 1. Satu pintu, dan hanya satu

`backend/src/cloud/postgres/poster.rs:179` adalah satu-satunya tempat sebuah
entri jurnal ditulis. Setiap modul lain memposting lewat sana, di dalam
transaksinya sendiri, supaya sebuah tagihan pemasok dan jurnal yang
mencatatnya ada dua-duanya atau tidak sama sekali.

`post` menerima `&mut Transaction` yang **bukan miliknya**. Itu disengaja:
modul yang mencatat tagihan harus menulis barisnya sendiri, memposting
jurnalnya, dan mengirim perintah sync, dalam satu commit. Poster yang memiliki
transaksinya sendiri membuat komposisi itu mustahil, dan jalan pintas yang
selalu diambil orang adalah penulis kedua.

Penulis kedua berarti dua aturan tentang apa itu entri yang sah, dan keduanya
akan sepakat sampai hari mereka tidak.

---

## 2. Jurnal adalah fakta; setiap saldo adalah projection

Seluruh database ini mengikuti satu aturan: jangan simpan penghitung, turunkan
dia. Buku besar terlihat melanggarnya dan tidak.

* **Entri jurnal adalah fakta**, seperti penjualan atau penerimaan barang.
  Ditulis sekali, tidak pernah di-update. Kesalahan dikoreksi dengan entri
  pembalik — persis cara `sale_return` mengoreksi penjualan tanpa menyuntingnya.
* **Setiap saldo adalah projection.** Neraca saldo, saldo akun, umur utang
  pemasok — semuanya dijumlahkan dari `journal_line` **pada setiap pembacaan**.
  Tidak ada satu pun total berjalan yang disimpan.
* **Entri diturunkan** dari dokumen sumber oleh aturan bernama dan berversi,
  sehingga buku bisa dibangun ulang dari dokumennya, bukan ditambal.

Dua invarian yang penting ditegakkan di database, bukan di Rust
(`0051_journal.sql`), dan Rust menegakkannya lagi:

```
entri seimbang, dan header cocok dengan barisnya
    → deferred constraint trigger, menyala saat COMMIT
      (tidak bisa CHECK: barisnya belum ada saat header di-INSERT)

tidak ada yang boleh diposting ke periode tertutup
    → mengunci periode dengan FOR SHARE
      (sehingga tutup buku dan posting tidak bisa dua-duanya berhasil)
```

Validasi aplikasi adalah tempat sebuah invarian hidup sampai hari seseorang
membuka psql.

---

## 3. Aturan menyebut ARTI, tidak pernah kode akun

Pemanggil menyebut `inventory` dan `trade_payable`; `account_map` mengubah arti
itu **plus sebuah lokasi** menjadi kode klien.

```
semantic_key  ×  site_id  ×  qualifier   →   account_code
"bank_giro"      "C006"      "BCA"            1011002001 06
```

Dua jenis pemanggil, dan keduanya dimodelkan sebagai pilihan, bukan sebagai
kode opsional di sebelah kunci opsional — supaya tidak bisa dibuat baris yang
menyebut dua-duanya atau tidak sama sekali (`poster.rs:47`):

| Pemanggil | Boleh menyebut | Alasan |
|---|---|---|
| Aturan posting | **arti** saja | aturan yang bisa menyebut kode harus dikompilasi ulang setiap Finance memindahkan akun — dan diam-diam salah posting kalau mereka memindahkannya tanpa bilang |
| Orang menulis jurnal manual | **kode akun** | memilih akunnya justru entri yang ia datang untuk buat |

**Arti yang belum dipetakan ditolak, dan penolakannya menyebut kuncinya.**
Tidak pernah di-default. Akun yang dikarang adalah kesalahan yang seimbang, dan
itu jenis yang bertahan setahun.

Katalog artinya ada di `ledger.rs:291` — **34 kunci**, masing-masing membawa
akun klien yang diharapkan, apakah ia butuh qualifier, dan menu mana yang mati
tanpanya. Katalog itu sengaja lebih besar dari yang dipakai hari ini: ia adalah
daftar pekerjaan, bukan daftar fitur.

---

## 4. Bagan akun klien, apa adanya

`ledger_account` (`0050_ledger.sql`) memuat bagan CENTRAL FASHION STORE
verbatim: **7.528 baris** pada tangga enam anak tangga (1, 3, 5, 7, 10, 12
karakter) — **76 keluarga** di anak tangga tujuh karakter, **496 akun** di
sepuluh, **6.902 daun yang boleh diposting** di dua belas.

Dua digit terakhir sebuah daun adalah **unitnya**: `00` untuk HO, `01`–`13`
untuk C001–C013. Jadi lokasi sudah terjawab oleh kode akun — dan tetap
ditegakkan lagi sebagai `site_id NOT NULL` **di setiap baris jurnal**, karena
konvensi penamaan bukan struktur.

Tiga hal yang tidak boleh dibaca dari angka 7.528:

* itu **bukan** 7.528 akun yang boleh diposting — 6.902 daun, dan 104 di
  antaranya bertanda tidak aktif;
* **aktif ≠ boleh diposting**. Akun induk yang aktif tetap heading;
* ada tiga kode di luar pola panjang umum (`204001`, `205001`, `600104`) yang
  artinya harus dipastikan ke pemilik bagan, bukan ditebak dari panjangnya.

---

## 5. Tujuh aturan yang benar-benar memposting hari ini

Setiap entri membawa `rule_version`, sehingga ketika satu aturan dikoreksi ada
yang menyebutkan entri mana yang ditulis aturan lama.

| `source_kind` | `rule_version` | Di mana | Apa yang dibukukan |
|---|---|---|---|
| `SUPPLIER_INVOICE` | `supplier_invoice/*` | `payables.rs:857` | persediaan / biaya, PPN masukan, potongan pembelian, utang pemasok |
| `PAYMENT` | `supplier_payment/1` | `payments.rs:741` | utang pemasok turun, kas/bank keluar |
| `DEPRECIATION` | `depreciation/1` | `assets.rs:1134` | beban penyusutan / akumulasi, per kelas aset sebagai qualifier |
| `ASSET_DISPOSAL` | `asset_disposal/1` | `assets.rs:1497` | aset keluar pada harga perolehan, akumulasi dibalik, hasil jual, laba/rugi pelepasan |
| `ASSET_TRANSFER` | `asset_transfer/1` | `assets.rs:1629` | aset keluar dari satu lokasi dan masuk ke lokasi lain, pada harga perolehan |
| `BANK_STATEMENT` | `bank_line/1` | `banking.rs:985` | baris rekening koran yang tak berpasangan dibukukan langsung |
| `MANUAL` | `manual/1` | `http/finance.rs:529` | entri yang diketik orang, menyebut kode akun sendiri |

Plus `REVERSAL` (`poster.rs:280`), yang **menyalin akun entri aslinya** — bukan
menyelesaikan ulang artinya. Kalau peta berubah di antara keduanya, pembalikan
yang menyelesaikan ulang akan membalik ke akun yang berbeda dari yang ia balik.

Registrasi aset **tidak** memposting apa pun. `fixed_asset` adalah fakta
operasional tanpa kolom uang; keputusan Finance hidup di `asset_capitalization`
yang menunjuk baris jurnal yang sudah ada (`acquired_via_line_id`). Bukti dari
jurnal klien membenarkan bentuk ini: `KK-26-07-00276` mengakui aset **di dalam
dokumen pembayarannya**, tidak ada entri kapitalisasi terpisah.

---

## 6. Tiga sumber yang diizinkan dan tidak pernah ditulis

`journal_entry.source_kind` mengizinkan sebelas nilai. Tujuh dipakai. Tiga
tidak pernah ditulis oleh siapa pun di branch ini:

```
SALE_DAY      penjualan POS               ← lubang terbesar
STOCK_COUNT   selisih stock opname
TRANSFER      perpindahan barang antar unit
```

`SALE_DAY` dideklarasikan sejak `0051` dan **belum pernah punya penulis**.
Akibatnya bukan satu fitur yang kurang:

* Laba Rugi selamanya menampilkan beban tanpa penjualan;
* empat arti menganggur: `card_receivable_credit`, `card_receivable_debit`,
  `card_fee`, `rounding`;
* refund pelanggan tidak punya jalur finance, karena penjualannya juga tidak;
* `cogs` dan `stock_loss` tidak pernah dipanggil, jadi persediaan tidak pernah
  bernilai uang di neraca.

Ini juga satu-satunya keputusan pemilik yang memblokir lima langkah lain (§11).

---

## 7. Periode

`fiscal_period` (`0050`) punya dua status: `OPEN` dan `CLOSED`. Tidak ada yang
bisa diposting ke bulan yang tidak pernah dibuka — bukan ke bulan yang
tertutup, melainkan ke bulan yang **tidak ada**, yang biasanya ditemukan orang
di kasir, bukan di sini.

Layar Period close **sudah** menggambar checklist akhir bulan: ia membaca ulang
`/account-map`, `/bills`, `/bank-statements` dan `/trial-balance` di bawah kunci
yang sudah dimiliki empat layar itu, sehingga menutup bulan tidak lagi berarti
membuka empat layar dan mengingat apa yang dilihat.

Tapi **server tidak membacanya**. `close_period` (`ledger.rs:2241`) menjalankan
`UPDATE fiscal_period SET status='CLOSED'`, gagal hanya kalau bulannya memang
tidak terbuka, lalu menghitung entri. Checklist yang merah tidak menahan apa
pun. Itu gap `G7`.

---

## 8. Yang ada hari ini — layar dan endpoint

**38 endpoint** di bawah `/api/v1/finance`, **12 layar**
(`screens/finance/index.ts`), tiga kelompok yang merupakan **pekerjaan**, bukan
endpoint:

```
Overview

Work        Supplier bills · Payments · Cash & bank ·
            Charges without a sale · Assets · Journal

Books       Reports · Ledger

Setup       Chart of accounts · Account map · Period close
```

Dua hal yang tampak hilang dan tidak hilang: *Position* adalah pembacaan
"per lokasi" dari Reports, dan *Trial balance* adalah yang ditampilkan Ledger
sebelum sebuah akun dipilih. Tidak ada endpoint yang kehilangan rumah.

Bentuk pembacaannya cuma dua (`statements.rs`), dan itu sebabnya endpointnya
tidak lima belas:

* **"keluarga ini bernilai berapa, di tiap lokasi?"** → satu matriks
  sub-akun × lokasi. Kas, bank, piutang kartu, saldo antarunit, persediaan,
  aktiva tetap, pinjaman — semuanya satu pertanyaan.
* **"apa kata buku?"** → neraca dan laba rugi, dibangun dari kelas akar
  **klien sendiri**, bukan dari template.

Keduanya tidak disimpan. Lokasi yang belum ada postingannya adalah **nol**,
bukan lubang: "tidak ada kas di toko 07" dan "kita tidak pernah bertanya soal
toko 07" terlihat sama di map yang jarang dan sangat berbeda bagi akuntan.

---

## 9. Peta target — 13 menu, 67 tab, delapan keadaan

> **Digantikan 13 September 2026.** Menu final (37 baris · 12 seksi · satu pintu) ada di
> [`finance-menu.md`](./finance-menu.md); arsitektur uang (dua pintu, dua tier, Payment
> Ledger sebagai sekat) di [`erpnext-money.md`](./erpnext-money.md). Amandemen §0: bentuk
> **sidebar** diambil dari ERPNext v17, isi **layar** tetap dari rancangan 11 September.
> Bagian di bawah ini dipertahankan sebagai catatan asal, bukan acuan.

Diambil dari C (`demo/share/public/finance.html`, 11 September), yang
dibangkitkan dari `outputs/finance-menu-20260911/Rancangan_Menu_dan_Tab_Finance.xlsx`.
Judul menu tampil dalam bahasa Inggris, `id` internalnya bahasa Indonesia.

| # | Menu | Tab | Isi |
|---|---|---:|---|
| 1 | Overview | 3 | Today · My Approvals · Exceptions |
| 2 | Cash & Banking | 11 | Accounts & Cash · Cash Position · Payment Queue · Payment Run · Money Movements · Transfers & Deposits · **Giro Instruments** · Bank Reconciliation · Cash Planning · Obligation Calendar · Plan vs Actual |
| 3 | Payables & Expenses | 7 | Supplier Bills · Suppliers · Expenses & Claims · Employee Advances · Prepaid Expenses · Aged Payables · Supplier Advances & Credits |
| 4 | Revenue & Receivables | 5 | Sales · Customer Invoices · Customers · **Channel Settlements** · Customer Advances & Refunds |
| 5 | Inventory Accounting | 4 | Valuation & Movements · Receipts & Usage · Goods in Transit · Counts & Adjustments |
| 6 | **Interunit Accounting** | 4 | Balances & Pairs · Interunit Transactions · Settlements · Interunit Reconciliation |
| 7 | Fixed Assets & Projects | 4 | Asset Register · Projects in Progress · Depreciation & Amortisation · Transfers & Disposals |
| 8 | Payroll Accounting | 4 | Payroll Batches · Liabilities & Payments · Employee Loans · Payroll Reconciliation |
| 9 | Tax | 4 | Tax Obligations · Tax Documents · Tax Payments · Tax Filings |
| 10 | Financing & Equity | 3 | Loans · Instalments & Charges · Capital & Distributions |
| 11 | General Ledger & Closing | 5 | Journal Entries · Periodic Recognition · Account Reconciliation · Period Close · Period Closing Pack |
| 12 | Planning & Reports | 6 | Financial Statements · Budget Planning · Budget Performance · General Ledger & Trial Balance · Operational Reports · Consolidation |
| 13 | Finance Settings | 7 | Chart of Accounts · **Posting Rules** · Accounts & Parties · Policies & Schedules · Access & Approvals · Change History · Control Rules |

Yang **baru** dibanding modul hidup (§8) ditebalkan, dan masing-masing menutup
gerakan uang harian yang hari ini tidak punya dokumen sama sekali:

* **Giro Instruments** — hari ini `GIRO` cuma satu dari lima nilai `METHODS`
  (`payments.rs:562`), dan uangnya dianggap keluar hari itu juga. Arti
  `giro_outstanding` sudah ada tanpa penulis.
* **Channel Settlements** — kartu dan QRIS masuk bank belakangan, neto, dan
  tidak selalu benar.
* **Interunit Accounting** — tiga keluarga afiliasi klien (1.386 daun) yang
  bergerak setiap hari. Arti yang ada sekarang hanya menutup satu dari tiga:
  `2012302 Hutang Affiliasi Atas Barang` — yang paling sering bergerak —
  **tidak punya arti sama sekali**.
* **Posting Rules** dengan kolom `Aktivasi` dan `Bukti uji` — tempat kontrak
  dari B (§0 putusan 2) mendarat sebagai layar, bukan sebagai simulasi.

### Delapan keadaan layar

Ini bagian yang paling mudah hilang saat sebuah rancangan dipindah ke kode, dan
sebabnya prototipe ini bisa **menyalakannya satu per satu** alih-alih
menjanjikannya: `KEADAAN_UJI` di `finance.html`.

| Keadaan | Artinya | Bentuknya |
|---|---|---|
| `normal` | data sebagaimana adanya | tabel |
| `memuat` | sedang diambil | **rangka isi** (`.ska`), bukan layar kosong — pengguna melihat bentuk yang sedang datang |
| `kosong` | belum ada data sama sekali | `.kosong` — judul, kalimat penjelas, satu baris kecil apa yang harus dilakukan |
| `takAdaHasil` | ada data, filternya yang tidak menemukan | berbeda dari `kosong`, dan itu disengaja: satu menyuruh membuat, satu menyuruh melonggarkan |
| `gagal` | gagal memuat | |
| `takBerizin` | tidak punya akses | bukan halaman kosong dan bukan nol |
| `berubah` | dokumen berubah sejak dibuka | |
| `diproses` | sedang diproses | |

Aturannya: **keadaan dipasang menggantikan isi daftar, bukan di sampingnya** —
supaya yang terlihat benar-benar keadaan itu, bukan keadaan plus data.

### Delapan layar rujukan yang ikut dirancang

Bukan menu produk, melainkan rancangan yang harus ikut pindah: `Query Builder` ·
`Tombol di detail dokumen` · `UX Standard & Test Tasks` (tujuh kriteria lulus,
delapan tugas uji) · `UX Pattern Catalogue` (26 bentuk penyajian + 4 yang hanya
dipakai bila ada kebutuhan nyata) · `Design Matrix per Submenu` · `Documents &
Printing` (tiga keluaran: dokumen transaksi A4 tegak, statement dengan saldo
berjalan, register A4 mendatar) · `Terminology` · `Contoh layar`.

### Yang belum punya rumah di mana pun

Baru ketahuan saat prototipe dibuat: **setoran kas toko ke bank tidak punya
dokumen.** Begitu juga HO mengisi petty cash toko, dan pindah antar dua
rekening sendiri. `supplier_payment` hanya membawa **satu** `account_key` —
rekening asal — jadi secara struktur ia tidak bisa menyatakan perpindahan.
Untuk estate 14 lokasi dengan 14 Cash on Hand dan 11 Petty Cash, itu bukan hal
kecil. C menjawabnya di `Cash & Banking → Transfers & Deposits`.

---

## 10. As-is — daftar gap

| | Gap | Bukti | Perbaikan |
|---|---|---|---|
| **G1** | Penjualan POS tidak pernah masuk buku | `SALE_DAY` tidak muncul di `backend/src` | aturan posting harian dari fakta POS |
| **G2** | Persediaan tidak bernilai uang | `cogs`, `stock_loss`, `goods_in_transit` tidak pernah dipanggil | lapisan biaya pada ledger stok |
| **G3** | Selisih stock opname tidak dibukukan | `STOCK_COUNT` tanpa penulis | ikut G2 |
| **G4** | Perpindahan barang antar unit tidak dibukukan | `TRANSFER` tanpa penulis | ikut §9 Inter-unit |
| **G5** | Uang hanya bisa keluar | `supplier_payment` satu arah | dokumen penerimaan, bentuk sama, arah terbalik |
| **G6** | Perpindahan antar rekening tidak bisa dinyatakan | satu `account_key` per pembayaran | kolom rekening tujuan |
| **G7** | Checklist tutup buku ada di layar, tidak di server | `ledger.rs:2241` membalik status tanpa membaca satu pun uji | uji yang **menahan** dan menyebut nomor dokumennya |
| **G8** | Giro dianggap cair seketika | `payments.rs:562` — `GIRO` satu dari lima `METHODS` | register giro dengan siklus hidup |
| **G9** | Settlement acquirer tidak ada | — | satu baris per acquirer per hari, kotor − MDR = neto |
| **G10** | Dua dari tiga keluarga afiliasi tidak punya arti | `required_semantic_keys` hanya `affiliate_*` pembiayaan | tambah arti atas barang dan lain-lain |
| **G11** | Binding tidak punya masa berlaku dan versi | `account_map` satu baris per kombinasi | `valid_from`/`valid_to`/`version`; koreksi adalah baris baru |
| **G12** | Tidak ada kebijakan "akun ini dilarang di unit ini" | bagan klien tidak membawanya | policy kita sendiri, terpisah dari flag bagan |
| **G13** | Dua pintu Finance terdaftar bersamaan | `navigation.ts:209` mendaftarkan `finance` dan `finance-lab` berdampingan | satu pintu; lab diberi label Simulasi sampai dipensiunkan |
| **G14** | Delapan keadaan layar dirancang di prototipe, tidak ada di modul hidup | §9; `finance.html` `KEADAAN_UJI` | tiap daftar wajib punya `kosong` ≠ `takAdaHasil`, rangka isi saat memuat, dan `takBerizin` yang bukan nol |

Yang **sudah benar dan tidak perlu disentuh**: satu pintu posting, jurnal
append-only, saldo tidak pernah disimpan, arti bukan kode akun, resolver yang
menolak unmapped/heading/inactive, periode yang mengunci, pembalikan yang
memakai akun asli, `site_id` wajib di setiap baris, bentuk aset (fakta tanpa
uang + kapitalisasi yang menunjuk jurnal), rekonsiliasi bank, dan intake
rekening koran otomatis.

Uji yang sudah ada: **24** uji integrasi (`finance_integration.rs`) dan **8**
uji properti (`finance_properties.rs`).

---

## 11. Keputusan terbuka

1. **Lane `finance-control` (D) — merge, ambil sebagian, atau buang?**
   Memblokir semuanya. 52 migrasi, 22 modul, 14 layar, dan satu tabrakan nomor
   `0106` yang harus diselesaikan lebih dulu. Usul: ambil per modul dengan
   dokumen ini sebagai saringan, bukan merge borongan.
2. **Pendapatan POS: diposting otomatis harian dari fakta POS, atau tidak masuk
   ledger sama sekali?** Terbuka sejak lane finance dimulai. Selama belum
   dijawab, G1 sampai G3 tidak bisa dimulai.
3. **Kapan Finance Lab dipensiunkan?** Usul: saat kontrak aturannya sudah
   dipindah ke dokumen ini dan ke uji Rust — bukan saat layarnya diganti.
4. **Saldo kas negatif: ditolak atau diangkat sebagai eksepsi?** Di instalasi
   klien ia dibiarkan. Usul: biarkan tercatat, naikkan ke papan eksepsi.
5. **Lima akun yang belum ada di bagan klien** (`cash_in_transit`,
   `card_receivable_qris`, `qris_fee`, `voucher_liability`, `cash_variance`)
   perlu disetujui pemilik bagan sebelum dipakai. Sampai itu, layar wajib
   menandainya **usulan**.
6. **Ambang pembulatan** untuk pencocokan tagihan — lihat
   [supplier bill §8](./supplier-bill.md).
7. **Template laporan vs query bebas.** Keputusan 5 September menolak tombol
   Design/Query, tapi rancangan 11 September punya layar Query Builder.
   ERPNext memisahkan keduanya: `Financial Report Template` (bentuk tersimpan
   dan bernama) ≠ query bebas. Usul: ambil pemisahan itu — template boleh,
   query bebas hanya untuk pembacaan, tidak pernah jadi laporan resmi. Lihat
   [ERPNext §8](./erpnext-reference.md).
8. **Toko dapat layarnya sendiri, atau cukup *Cakupan unit* sebagai hak akses?**
   Artifact 6 September memilih yang pertama (10 layar toko); rancangan 11
   September memilih yang kedua. Pasangan HR-nya memilih yang pertama — 5 menu
   aplikasi karyawan berdiri sendiri di samping 9 menu HR. Usul: ikuti HR,
   karena kasir dan kepala toko tidak mengerjakan pekerjaan finance yang sama
   dengan HO, hanya melihat irisannya.

---

## 12. Uji yang dituntut dokumen ini

1. entri yang tidak seimbang ditolak saat COMMIT, bukan saat divalidasi Rust;
2. posting ke bulan yang tidak dibuka ditolak, dan tutup buku serta posting
   tidak bisa dua-duanya berhasil;
3. `UPDATE` dan `DELETE` pada `journal_entry` dan `journal_line` ditolak;
4. arti yang belum dipetakan menolak posting, dan penolakannya menyebut kunci
   dan lokasinya;
5. arti yang menunjuk akun heading atau akun tidak aktif ditolak;
6. pembalikan memakai akun entri aslinya, walau peta sudah berubah sesudahnya;
7. neraca saldo yang dijumlahkan dari `journal_line` sama dengan total tiap
   keluarga di matriks saldo, pada tanggal yang sama;
8. setiap `source_kind` yang diizinkan skema punya penulis, atau tercatat di
   §6 sebagai lubang yang disengaja;
9. setiap entri non-`MANUAL` dan non-`REVERSAL` membawa `source_id`;
10. dua node yang membaca satu keluarga di satu lokasi mendapat angka yang sama
    dengan buku besar akunnya;
11. lokasi tanpa posting muncul sebagai nol, bukan sebagai baris yang hilang;
12. satu pembayaran dengan beberapa alokasi menghasilkan satu dokumen dan satu
    entri, bukan satu entri per alokasi;
13. daftar tanpa data menampilkan `kosong`, dan daftar yang filternya tidak
    menemukan menampilkan `takAdaHasil` — dua kalimat berbeda, tidak pernah
    tertukar;
14. daftar yang ditolak izinnya mengatakan begitu, dan tidak pernah tampil
    sebagai nol.
