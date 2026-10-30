# Audit cakupan Finance — prototipe 7Soft vs ERP

**Tanggal:** 27 Oktober 2026
**Sumber:** `finance-7soft-prototype.html`, `7soft-ref/manual/`, `frontend-hub/src/screens/finance/nav.ts`,
`docs/finance-navigation.md`, `finance-final-prototype.html`, `docs/finance-menu.md`
**Sifat:** analisis; perubahan prototipe dicatat di §13.
**Ruang lingkup:** cakupan menu, layar, dan alur lintas modul. Ini bukan audit kode backend.

> **Update 27 Oktober 2026, sesi lanjutan.** Rekonsiliasi bank, kelola rekening, filter tanggal
> bebas, ringkasan uang fisik, dan aksi nyata (transfer, setor, hitung kas, BKM/BKK, export CSV,
> print) sudah ditambahkan ke `finance-7soft-prototype.html`. Fitur ERP yang tidak ada di 7Soft
> sekarang punya kelompok sidebar **Di luar 7Soft** (§14). Tabel di §3 adalah temuan audit
> sebelum perubahan; status sesudahnya ada di §13–§14.

---

## 0. Jawaban singkat

1. **Yang dibuka di `#kas-info/accounts` bukan seluruh menu Finance.** Itu satu layar,
   *Info Kas/Bank → Accounts*, dalam mode default **Before → After**. Sidebar di halaman itu
   memakai menu 7Soft (6 grup, 28 baris), bukan menu Finance ERP yang sekarang (9 pintu, 86 rute).
2. **Sebagai peta migrasi 7Soft, cakupannya kuat tetapi belum selesai.** Semua 79 screenshot
   manual yang tersedia dipakai; 28 baris dibuat; 11 baris dinilai “setara”, 12 “sebagian”,
   4 “tidak ada”, 1 referensi. Yang “sebagian” justru yang paling sering dipakai.
3. **Sebagai menu Finance ERP, ini belum menjadi menu final.** Yang hilang bukan hanya beberapa
   tombol, tetapi beberapa pekerjaan utuh: Overview, uang toko harian, tutup buku
   (accrual/persediaan/pajak), dan Setup posting/pembayaran/pajak. Rekonsiliasi bank sudah
   ditambahkan di sesi 27 Oktober.
4. **Gap terbesar ada di luar 7Soft.** 7Soft tidak punya konsep `Sales days`, `Card & EDC
   settlement`, `Deposits`, `Bank reconciliation`, `Accruals`, `Prepaids`, `Inventory
   valuation`, `Tax payables`, `Posting readiness`, `Payment methods`, atau `Accounting
   dimensions` — semuanya ada di ERP sekarang.
5. **Rekomendasi pokok:** pertahankan halaman ini sebagai **peta parity 7Soft**, dan jangan
   memakai sidebar 7Soft-nya sebagai menu Finance. Menu Finance tetap 9 pintu; tambahkan
   penanda “belum ada di desain ini” pada sisi *After* supaya pembaca tidak menyimpulkan
   migrasi sudah selesai.

---

## 1. Apa yang sebenarnya dibuka

URL `http://localhost:5404/finance-7soft-prototype.html#kas-info/accounts` diterjemahkan oleh
`boot()` menjadi:

| Bagian | Nilai |
|---|---|
| Layar | `kas-info` — “Cash & bank info” / “Info Kas Bank” |
| Tab | `accounts` — daftar akun kas & bank |
| Mode | `ba` — “Before → After” (default; tanpa `?v=`) |
| Sisi kiri | 4 screenshot manual 7Soft hal. 174, 175, 177, 178 |
| Sisi kanan | mock desain Central: KPI, filter lokasi, tabel 8 akun, Export |
| Tab layar | Accounts · Ledger card · BKM · BKK |
| Aksi | hanya **Export** (masih `soon()` — toast, belum mengunduh) |

Untuk melihat desain yang bisa diklik, mode harus diganti ke **After · Central**. Untuk melihat
replika 7Soft, ganti ke **Before · 7Soft**. Tanpa itu, yang terlihat adalah perbandingan, bukan
aplikasi.

Sidebar halaman ini berisi 28 baris dalam 6 grup:

```
Kas - Bank, GL · Buku Besar, Pembelian, Penjualan, Master, Not in 7Soft
```

ERP sekarang memakai 9 pintu:

```
Overview · Stores · Payables · Cash & Bank · Journal · Assets · Month End · Reports · Setup
```

Jadi ada dua struktur yang berbeda. Halaman ini menjawab “7Soft punya layar apa dan padanannya
seperti apa”, bukan “menu Finance ERP isinya apa”.

---

## 2. Yang sudah ada dan patut dipertahankan

| Kekuatan | Bukti |
|---|---|
| Semua screenshot manual yang tersedia dipakai | 79 dari 79 file di `7soft-ref/manual/` muncul di `MANUAL` |
| Cakupan 7Soft finance yang ada screenshot-nya: halaman 174–212 | Info Kas/Bank, BKM/BKK, Pencairan BG, Laporan Kas/Bank, Info Accounting, Jurnal, Closing, Laporan Accounting |
| Cakupan purchasing & sales 7Soft | halaman 110–173: Info Pembelian, Faktur, Retur, Laporan; Info Penjualan, POS, Faktur, Retur, Laporan |
| Master 7Soft | halaman 59–88: Customer, Supplier, Pajak, Asset, COA, Saldo Awal, Setting COA, User & Group, History |
| Perbandingan before → after | screenshot 7Soft di kiri, desain Central di kanan, plus status hub |
| Laporan cukup dalam | `report-acc` 24 laporan; `kas-report` 20; `buy-reports` 12; `sell-reports` 12 |
| Uang toko | `Shop cash`: deposit, top-up petty cash, float count, per toko |
| Aset | register + depreciation run + jurnal penyusutan |
| Antar unit | preview jurnal dua sisi untuk transfer barang/pembiayaan/lain-lain |
| Kontrol | user & group, permission matrix, history |

Ini bukan prototipe kosong. Untuk delapan area 7Soft, isinya sudah layak dipakai sebagai bahan
diskusi dengan klien.

---

## 3. Gap di layar `#kas-info/accounts`

Ini gap pada layar yang sedang dibuka, bukan gap seluruh ERP.

| Bagian | Yang ada sekarang | Yang kurang | Dampak |
|---|---|---|---|
| Daftar akun | 8 akun: 3 kas, 3 bank, 2 giro; opening/debit/credit/closing | Tambah/edit/nonaktifkan akun; nama bank & nomor rekening; mata uang; status aktif; akun nol/saldo kecil; time deposit; bank lain (BRI, BNI, BTN, Danamon, Mega) | Layar tidak bisa dipakai untuk mengelola rekening; hanya membaca |
| Rekonsiliasi | — | Status rekonsiliasi, saldo menurut rekening koran, selisih, tanggal statement terakhir, jumlah baris belum cocok, link ke Bank Reconciliation | Ini pekerjaan harian Cash & Bank; absennya membuat layar ini bukan “cash & bank” yang lengkap |
| Uang fisik | — | Cash count terakhir, selisih kas, petty cash, cashier float, deposit terakhir, transfer antar rekening | Semua ada di ERP (`Stores`, `Cash & Bank`) tetapi tidak terlihat dari sini |
| Filter | Periode Sep/Oct 2026; lokasi All/HO/C001–C013; search | Rentang tanggal bebas, “as of”, tipe akun, status, akun favorit, simpan view | Periode hanya dua bulan demo; tidak bisa menjawab “posisi per 31 Des” |
| Aksi | Export (toast) | Print, XLS/CSV, import statement, new account, transfer, count, deposit, reconcile | Semua aksi nyata belum ada; Export bahkan belum mengunduh |
| Tab | Accounts · Ledger card · BKM · BKK | Bank Reconciliation · Deposits · Cash Counts · Advances · Giro (register, bukan hanya saldo) | Empat tab terlalu sempit untuk pekerjaan Cash & Bank |
| Ledger card | Saldo berjalan, voucher, party, debit/kredit | Filter tipe voucher, penanda rekonsiliasi, print statement, rentang tanggal, “unreconciled only” | Bagus sebagai kartu, belum sebagai statement |
| Status layar | Empty state sederhana | Loading, error, no-permission, changed, processing, no-result | Dokumen `finance.md` menuntut delapan keadaan; baru satu yang ada |
| Mobile | `min-width: 1260px` | Layout ponsel untuk kepala toko | Kepala toko tidak bisa memakai layar ini dari HP |
| Cakupan data | 8 akun | 7Soft KAS/BANK menampilkan 16 baris termasuk piutang/utang; COA punya 14 lokasi | Jika tujuannya parity, daftar ini menyempit; jika tujuannya layar kas, perlu link ke COA |
| Keterangan hub | “Partly in the hub — Bank accounts · Cash transactions · Statement lines — three separate screens” | Hub punya Stores (5 tab) + Cash & Bank (5 tab) + Bank (5 view) + Advances | Status ini undercount; pembaca bisa menyimpulkan hub hanya punya 3 layar |

**Catatan penting:** angka “8 akun” bukan salah data. Prototipe memang memilih contoh kecil.
Tetapi untuk review menu, layar ini belum menunjukkan:
- hubungan saldo buku vs saldo bank;
- pekerjaan rekonsiliasi;
- pekerjaan uang fisik toko;
- pengelolaan rekening.

---

## 4. Gap menu vs 9 pintu ERP

Sumber kebenaran menu saat ini: `frontend-hub/src/screens/finance/nav.ts` dan
`docs/finance-navigation.md` (17 Oktober 2026): **9 pintu, 86 rute, 59 tab, 17 Setup**.

| Pintu | Isi di ERP | Di prototipe 7Soft | Gap | Prioritas |
|---|---|---|---|---|
| **Overview** | Cash & bank, payables, cash flow, inventory, needs attention, upcoming/overdue, charts | Tidak ada | Seluruh dashboard; halaman mendarat di Info Kas/Bank | **P0** |
| **Stores** | Sales by day, Sales postings, Card & EDC settlement, Deposits, Cash balances, Cash on hand, Petty cash, Cashier float, Cash positions, Cash movements, Cash counts | `Shop cash` (deposit/top-up/count), `sell-cash` (POS) | Sales days, sales postings, EDC settlement, deposit sebagai dokumen, cash counts laci, cash on hand per toko | **P0** |
| **Payables** | Bills, Recurring bills, Due dates (calendar/aging), Suppliers (summary/ledger), Credit notes, Loans | `buy-info`, `buy-invoice`, `buy-return`, `buy-reports` | Recurring bills, loans, due-date calendar first-class, payment batches, advances/claims | P1 |
| **Cash & Bank** | BKK, BKM, Giro, Bank (reconciliation/accounts/statement lines/month summary/rules), Advances | `kas-info` + tab `Reconciliation` (baru), BKM/BKK external, giro external, `kas-report` | Bank rules, month summary, advances, bank account setup; rekonsiliasi dasar sudah ada | **P0** |
| **Journal** | Entries, Templates | `gl-journal`, `gl-info` | Template/recurring journal, approval/posting, reversal UI | P1 |
| **Assets** | Register, Projects, Disposals | `assets` (register + depreciation) | Projects/CIP, disposals, asset classes, NBV/report | P1 |
| **Month End** | Checklist, Periods, Accruals (unbilled/prepaid/balances), Inventory (stock vs ledger/valuation/in transit/adjustments/COGS), Tax (payables/withholding) | `gl-closing`, `report-acc` | Accruals, prepaids, inventory valuation/COGS, tax payables/withholding, closing voucher | **P0** |
| **Reports** | P&L (standard/by unit/expenses by month/by dimension), Balance sheet (standard/2 years/equity), Cash flow, Ledger (GL/TB), Sales by division | `report-acc` (24 laporan), `gl-info`, `sell-reports` | P&L by unit, by dimension, expenses by month, BS 2 tahun, changes in equity, sales by division | P1 |
| **Setup** | Accounts (COA/settings/dimensions), Posting (links/readiness/policies/permissions), Categories (pay components/expense/line), Payments (methods/shop/EDC/giro templates), Tax (types/withholding), Assets (classes) | `coa-master`, `coa-opening`, `coa-links`, `setup-switches`, `parties`, `users` | Dimensions, posting readiness/policies, payment methods/shop/EDC/MDR, tax types/withholding, asset classes, categories, permissions detail | **P0** |
| **Inter-unit** | Transfers, Due from/to | `interunit` (satu layar) | Due from/to report, settlement/reconciliation, automatic pair posting | P1 |
| **Payroll / Financing / Tax** | Payroll postings, staff loans, loans, tax payables/withholding | Tidak ada | Semua; sebagian rute backend sudah ada | P1 |
| **Opening balances** | Backend `/finance/opening` ada; nav tidak memberi pintu | `coa-opening` ada | Justru prototipe lebih maju daripada nav; perlu diputuskan rumahnya | P1 |

---

## 5. Gap lintas modul (ERP terkait Finance)

| Alur | Yang seharusnya sampai ke Finance | Di prototipe | Gap |
|---|---|---|---|
| **Sales / POS → Finance** | Sales day, tender breakdown, diskon, retur, rounding; card/QRIS settlement; MDR; deposit; cash count | `sell-cash`, `sell-reports`, `Shop cash` | Sales day close, tender recon, EDC settlement, deposit document, cash count laci |
| **Procurement → Finance** | PO → receiving → bill (3-way match), credit note, advance, payment run, due date, aging | `buy-invoice`, `buy-return`, `buy-info`, `buy-reports` | Payment batch/run, advance/claim, recurring bill, loan; due date ada tetapi bukan layar sendiri |
| **Inventory → Finance** | Stock value, COGS, goods in transit, stock adjustment, stock count difference | `report-acc` (inventory report, P&L by item) | Layar stock vs ledger, valuation, in transit, adjustment, COGS |
| **Assets / GA → Finance** | Acquisition, capitalization, depreciation, disposal, transfer, CIP/project | `assets` | Project/CIP, disposal, transfer, asset class, NBV |
| **HR / Payroll → Finance** | Payroll posting, salary accrual, staff loan, reimbursement | Tidak ada | Seluruh alur payroll finance |
| **Tax → Finance** | PPN/PPh, withholding, tax payable, tax report | Tidak ada (hanya label “Pajak” di parties) | Seluruh layar tax |
| **Banking → Finance** | Bank account, statement import, reconciliation, rules, transfer, deposit, giro | `kas-info`, `kas-report`, giro external | Reconciliation, statement line, rules, transfer, deposit |
| **Intercompany → Finance** | Due from/to, transfer, settlement, reconciliation | `interunit` | Due from/to, settlement, rekonsiliasi |
| **Period close → Finance** | Checklist, period lock, closing voucher, accrual, inventory, tax | `gl-closing` | Closing voucher, accrual, inventory, tax, lock/reopen |
| **Security / audit → Finance** | Role, permission per menu/site, approval matrix, before/after audit | `users`, `history` | Approval matrix, segregation of duties, before/after |

---

## 6. Gap non-fitur

| Aspek | Kondisi sekarang | Yang kurang |
|---|---|---|
| Delapan keadaan layar | Hanya empty state sederhana | Loading, empty, no-result, error, no-permission, changed, processing |
| Mobile | Shell minimum 1260px | Layout ponsel; kepala toko tidak bisa memakai |
| Approval | Banyak aksi `soon()` | Submit → approve → post → reverse; siapa boleh apa |
| Print / export | Sebagian besar toast | Preview cetak, XLS/CSV nyata, template dokumen |
| Audit | `History` berupa daftar | Before/after, record-level trail, alasan perubahan |
| Freshness | Data demo statis 2007/2016/2026 | Refresh, cache, tanggal “as of”, penanda data demo |
| Bahasa | Campur Inggris/Indonesia | Istilah konsisten; 7Soft memakai Indonesia, ERP memakai Inggris |
| Deep link | Hash hanya `id/tab` | Link ke route ERP asli, link ke Setup/Bank Account, link dari KPI |
| Status hub | String statis di `HUB` | Dibangkitkan dari `nav.ts`; kalau tidak, cepat basi |
| Testability | Tidak ada state/fixture resmi | Fixture per keadaan, test task, data 14 lokasi |

---

## 7. Yang justru berlebih atau salah tempat

1. **Purchasing & sales di menu Finance.** Di 7Soft, Faktur Pembelian/Penjualan memang satu
   modul. Di ERP, Procurement dan Sales punya modulnya sendiri; Finance hanya memegang bill,
   credit note, settlement, dan pembayaran. Jika sidebar ini dipakai sebagai menu ERP, empat
   baris Pembelian dan lima baris Penjualan akan menduplikasi kepemilikan.
2. **Customer / Supplier / Pajak di Finance.** Keputusan menu final menempatkan vendor di GA
   dan supplier di Procurement; Finance membaca, bukan membuat. Prototipe masih punya
   “New customer” dan “New supplier” di dalam Finance.
3. **`Shop cash` ditaruh di “Not in 7Soft”.** Justru ini layar paling ERP-native (Stores), tetapi
   posisinya di bawah, setelah semua menu 7Soft. Struktur menu jadi terbalik: yang baru
   disembunyikan, yang lama di atas.
4. **`Saldo Awal COA` ada di prototipe, tidak ada di nav ERP.** Backend punya rute opening,
   tetapi nav 9 pintu tidak memberi rumah. Ini gap terbalik: prototipe lebih maju.
5. **`Between units` ada di prototipe, tidak ada pintu di nav.** Rute interunit sudah
   dipindahkan ke Journal; due-from/to belum punya layar.
6. **Status HUB undercount.** Contoh: `kas-info` diringkas “3 layar”, padahal hub punya
   Stores (5 tab) + Cash & Bank (5 tab) + Bank (5 view) + Advances. `report-acc` diringkas
   “7 laporan”, padahal hub punya 13 layar laporan. Ini membuat pembaca menilai hub lebih miskin
   daripada kenyataan.
7. **Sisi After kadang lebih miskin daripada hub.** `kas-info` After tidak punya rekonsiliasi;
   `assets` After tidak punya disposal/project; `report-acc` After tidak punya by-unit/dimension.
   Tanpa penanda, pembaca bisa mengira desain Central = hub saat ini.

---

## 8. Prioritas

### P0 — harus ada sebelum menu Finance disebut lengkap

1. **Overview** — satu layar yang menjawab: kas/bank, utang jatuh tempo, arus kas, nilai
   persediaan, yang perlu perhatian.
2. **Bank reconciliation** — sudah ada di prototipe (statement lines, matching, selisih); tinggal bank rules dan month summary.
3. **Uang toko harian** — sales days, sales postings, card/EDC settlement, deposits, cash counts.
4. **Month End** — accruals, prepaids, inventory valuation/COGS, tax payables/withholding,
   closing voucher.
5. **Setup** — posting readiness/policies, payment methods/shop/EDC, tax types/withholding,
   asset classes.

### P1 — penting, tetapi bisa menyusul

- Payables: due-date calendar, recurring bills, loans, payment batches, advances/claims.
- Journal templates/recurring.
- Assets: projects/CIP, disposals, classes.
- Inter-unit: due from/to, settlement.
- Payroll postings, staff loans.
- Opening balances: beri rumah di Month End atau Setup.
- Report variants: by unit, by dimension, expenses by month, BS 2 years, equity, sales by division.

### P2 — kualitas

- Delapan keadaan layar.
- Mobile/store head.
- Approval matrix & segregation of duties.
- Print/export nyata.
- Audit before/after.
- Deep link & status hub yang dibangkitkan dari nav.
- Konsistensi bahasa.

---

## 9. Rekomendasi konkret

1. **Pisahkan dua artefak.**
   - `finance-7soft-prototype.html` = peta parity 7Soft → Central. Tetap berguna untuk migrasi.
   - `finance-final-prototype.html` / nav 9 pintu = menu Finance final.
   Jangan mencampur sidebar 7Soft ke menu ERP.
2. **Jika halaman ini harus menjadi menu Finance**, ubah sidebar menjadi 9 pintu, lalu letakkan
   baris 7Soft sebagai alias di pencarian. Contoh: “Info Kas Bank” mencari “Cash & Bank”.
3. **Tambahkan penanda “belum ada di desain ini”** pada sisi After untuk fitur yang ada di hub
   tetapi belum digambar. Ini lebih jujur daripada pill “Partly in the hub”.
4. **Buat halaman coverage matrix** di prototipe: 7Soft menu → route ERP → status → pemilik →
   bukti. Ambil otomatis dari `nav.ts` supaya tidak basi.
5. **Tambahkan layar P0 yang belum ada**: Overview, Sales Day, Deposits, Accruals/Inventory/Tax,
   Posting Readiness. Bank Reconciliation sudah ditambahkan.
6. **Beri rumah untuk `Opening balances`, `Inter-unit`, `Payroll postings`** — sekarang ada di
   backend/prototipe tetapi tidak di nav.
7. **Uji dengan volume seperti data klien**: 14 lokasi dan 6.908 daun COA (angka klien);
   prototipe 7Soft sendiri memakai 303 akun dan 30.292 jurnal. Layar 8 akun tidak akan
   menunjukkan masalah ukuran.
8. **Uji keadaan**: kosong, tidak ada hasil, gagal, tidak berizin, berubah, diproses. Dokumen
   `finance.md` sudah menetapkan delapan keadaan; prototipe belum membuktikannya.

---

## 10. Lampiran — status 28 baris prototipe

Status di kolom “HUB” adalah label yang ditulis prototipe sendiri (`HUB` di
`finance-7soft-prototype.html`), bukan hasil audit ini.

| # | Baris 7Soft | HUB | Pintu ERP yang paling dekat | Gap utama |
|---:|---|---|---|---|
| 1 | Info Kas Bank | part | Stores › Cash; Cash & Bank › Bank | rekonsiliasi, statement, deposit, cash count, setup rekening |
| 2 | BKM · BKK | yes | Cash & Bank › BKK/BKM | form eksternal; approval/post/reverse belum terintegrasi |
| 3 | Pencairan BG | yes | Cash & Bank › Giro | print/template; status lifecycle belum terlihat |
| 4 | Laporan Kas/Bank | part | Reports; Stores › Cash | sebagian besar varian laporan belum ada |
| 5 | Info Accounting | part | Reports › Ledger; Setup › COA | by unit/dimension, periode, drill-down |
| 6 | Transaksi Jurnal | yes | Journal › Entries | template/recurring, approval |
| 7 | Closing Periode | part | Month End › Checklist/Periods | accrual, inventory, tax, closing voucher |
| 8 | Laporan Accounting & Keuangan | part | Reports | P&L by unit/dimension, expenses by month, BS 2 tahun, equity, sales by division |
| 9 | Info Pembelian | part | Payables › Bills/Due/Suppliers/Credit notes/Loans | recurring, loans, advances, payment batch |
| 10 | Faktur Pembelian | yes | Payables › Bills | 3-way match/approval belum terlihat |
| 11 | Invoice Retur Beli | yes | Payables › Credit notes | — |
| 12 | Laporan Pembelian | part | Payables › Due dates | 33 laporan 7Soft tidak semua ada; aging/calendar sudah ada |
| 13 | Info Penjualan | no | — (tidak ada debtor book) | by design; card settlement/sales postings belum |
| 14 | Penjualan Cash · POS | yes | Stores › Sales/Sales postings | sales day close, tender recon |
| 15 | Faktur Penjualan | no | — (till) | by design; jangan ditambahkan ke Finance |
| 16 | Retur Penjualan | no | — (till) | by design; jangan ditambahkan ke Finance |
| 17 | Laporan Penjualan | part | Reports › Sales by division | sebagian besar laporan penjualan belum |
| 18 | Account | yes | Setup › COA | — |
| 19 | Saldo Awal COA | no | — (backend opening ada) | tidak ada pintu di nav; perlu rumah |
| 20 | Setting COA | yes | Setup › Account links | — |
| 21 | Set Up | part | Setup | dimensions, posting policies/readiness, payment methods, EDC, tax, asset classes |
| 22 | Customer · Supplier · Pajak | part | Payables › Suppliers; Tax setup | customer master bukan milik Finance; supplier di Procurement/GA |
| 23 | Asset | yes | Assets › Register/Projects/Disposals | projects, disposals, classes, NBV |
| 24 | User & Group | yes | Setup › Permissions; People | — |
| 25 | History | part | Activity/operations log | before/after, record-level |
| 26 | Shop cash | yes | Stores › Cash/Deposits/Petty/Cashier float/Cash counts | sales day, EDC, cash count laci; posisi di “Not in 7Soft” |
| 27 | Between units | part | Journal (interunit dipindah) | due from/to, settlement, rekonsiliasi |
| 28 | 7Soft BKM/BKK replica | ref | — | referensi saja |

---

## 11. Bukti angka

- Prototipe: `40 screens`, 7 grup, 40 baris sidebar (25 7Soft + 14 native + 1 referensi), 5 tab di `kas-info`.
- Manual 7Soft: 79 file screenshot, semuanya dirujuk.
- Status HUB untuk 28 baris 7Soft: 11 `yes`, 12 `part`, 4 `no`, 1 `ref`; 12 baris native tidak punya status HUB.
- ERP: 9 pintu, 86 rute, 59 tab, 17 Setup.
- `finance-final-prototype.html`: 82 baris layar legacy dipetakan ke 9 pintu.
- `report-acc`: 24 laporan; `kas-report`: 20; `buy-reports`: 12; `sell-reports`: 12.
- `kas-info/accounts`: 8 akun (3 kas, 3 bank, 2 giro), 5 tab (Accounts, Reconciliation,
  Ledger card, BKM, BKK), filter 14 lokasi + All + rentang tanggal bebas, dan lima aksi
  (New account, Manage accounts, Transfer, Export, Print) — lihat §13.

---

## 12. Satu kalimat untuk pemilik produk

> Prototipe ini sudah menjawab “7Soft punya apa dan bagaimana tampilannya di Central”, tetapi
> belum menjawab “menu Finance ERP isinya apa”. Sebelum dipakai sebagai menu, ia perlu
> mengambil 9 pintu ERP dan menambahkan pekerjaan yang 7Soft tidak punya — terutama uang toko
> harian, tutup buku, dan setup posting. Rekonsiliasi bank sudah ditambahkan di §13.

---

## 13. Yang sudah ditambahkan (27 Oktober 2026)

Perubahan ada di `finance-7soft/scr-cash.js` dan dibangun ulang ke
`finance-7soft-prototype.html`.

| Tambahan | Di layar | Perilaku |
|---|---|---|
| Tab **Reconciliation** | `kas-info` | Saldo buku vs saldo statement, selisih, baris belum cocok; Match/Unmatch/Ignore; baris bank-only bisa dibuat BKK/BKM; **Finish reconciliation** menutup rekonsiliasi jika selisih 0 dan semua baris cocok |
| **Kelola rekening** | Accounts | **New account** dan **Manage accounts**; field kode, nama, tipe, lokasi, bank, nomor rekening, saldo awal, status; edit dan nonaktifkan/aktifkan |
| **Filter bebas** | Semua tab `kas-info` | Preset Sep/Oct, **Custom** dengan tanggal From/To; di Accounts ada filter lokasi, tipe (Cash/Bank/Giro), status (Active/Inactive), dan search |
| **Uang fisik** | Accounts | Tabel per lokasi: cash on hand, petty cash, cashier float, last count, difference, last deposit; tombol **Count** dan **Deposit** |
| **Aksi nyata** | Accounts, Ledger card, BKM, BKK, Reconciliation | Export CSV, print, transfer/deposit, cash count, New BKM/BKK, posting dari baris rekonsiliasi |
| **Status rekonsiliasi** | Accounts | Kolom Reconciliation per akun: `Reconciled`, `N open · difference`, `Not counted`, `No statement`, `Giro register` |

**Batasnya:** semua perubahan hidup di memori browser. Reload mengembalikan data demo. Tidak ada
backend, autentikasi, atau validasi server. Angka statement rekonsiliasi adalah demo yang dibuat
dari ledger; bukan impor rekening koran sungguhan.

**Cara mencoba:**

1. Buka `#kas-info/accounts`.
2. Ganti ke **After · Central**.
3. Coba **Reconciliation** → **Create BKM** pada baris `Transfer from Toko Maju Jaya`, lalu
   **Create BKK** pada `Bank charges`; setelah kedua baris diposting, **Match** semua baris
   terbuka, lalu **Finish reconciliation**. Selisih harus menjadi Rp 0.
4. Di **Accounts**, coba **New account**, **Transfer**, **Count**, dan **Deposit**.
5. Ubah filter ke **Custom**, atau tipe **Bank**, untuk melihat daftar menyempit.

---

## 14. Sidebar “Di luar 7Soft” (27 Oktober 2026)

Kelompok baru `Di luar 7Soft` berisi layar ERP-native yang tidak ada di 7Soft. Menu 7Soft
tetap di atasnya; kelompok ini tidak mengubah urutan atau nama menu 7Soft.

| Baris | Isi |
|---|---|
| **Overview** | Kas/bank, utang jatuh tempo, persediaan, needs attention, cash flow |
| **Stores** | Sales day · Deposits · Cash counts · Card & EDC |
| **Payables** | Due dates · Recurring · Loans · Batches |
| **Cash & Bank** | Bank rules · Advances · Month summary + link ke Reconciliation |
| **Journal** | Templates · Accruals · Prepaids |
| **Month End** | Inventory vs ledger · Tax payables · Closing checklist |
| **Assets** | Projects · Disposals · Classes |
| **Reports** | P&L by unit · By dimension · Balance sheet 2 years · Equity · Sales by division |
| **Setup** | Posting readiness · Payment methods · Tax types · Asset classes |
| **Inter-unit** | Due from / Due to · Transfers |
| **Payroll** | Postings · Staff loans |
| **Opening** | Cutover batches |

`Shop cash` dan `Between units` yang sudah ada ikut kelompok ini; replika 7Soft dipindah ke
kelompok **Referensi 7Soft** agar tidak tercampur.

**Sifat layar native:** data demo statis; beberapa form (recurring bill, payment batch, bank
rule, journal template, project, payment method, inter-unit transfer, opening batch, payroll)
benar-benar menambah baris di tabel memori. Export/Print memakai tabel yang sedang tampil.
Reload mengembalikan data demo. Belum ada backend.

**Angka sidebar sekarang:** 40 layar · 7 grup · 25 baris 7Soft + 14 baris native + 1 referensi.
