# Backlog prototipe Finance — apa yang perlu ditambahkan

**Tanggal:** 27 Oktober 2026
**Dasar:** `finance-7soft/data-coverage.js` (audit elemen per layar 7Soft), matrix
`docs/finance-coverage-matrix-2026-10-27.md`, dan keputusan 7Soft-first.
**Sifat:** backlog prototipe. Frontend-hub dan backend tidak disentuh.

---

## 0. Status batch pertama (27 Okt 2026)

Sudah dikerjakan di prototipe:

- **Info Kas Bank**: tanggal “Sampai tanggal”, Refresh, kolom Status/Keterangan, catatan akun,
  filter tipe/status/lokasi, pencarian termasuk catatan.
- **Laporan Kas/Bank**: rentang tanggal bebas + Refresh, detail voucher tidak lagi dipotong
  menjadi 5/11 baris.
- **Info Accounting**: Excel nyata dari tabel, refresh, date range, sampai tanggal, sub-ledger.
- **Transaksi Jurnal**: Del All + Print.
- **Info Pembelian**: tombol New purchase / New return; **Faktur Pembelian** Print.
- **Info Penjualan**: tombol New sale / New invoice / New return; **Faktur Penjualan** dan
  **Retur Penjualan** Print.
- **Laporan Pembelian/Penjualan**: Print + Export CSV.
- **BKM/BKK, Pencairan BG, replika**: dibuka di dalam shell, bukan pindah halaman.
- **Save invoice / Save return / Save cash sale / Save sales invoice / Save sales return**: benar-benar menambah atau memperbarui baris di data demo, bukan toast.
- **Laporan Kas/Bank**: account picker per laporan.
- **Faktur Pembelian**: Keterangan header/baris, tab **PO-BPB-INVOICE**, footer Total hutang/Bayar/Sisa, banner READ ONLY saat lunas, **Disc Rp** per baris, Del/Info.
- **Faktur Penjualan**: kolom **HPP**, **Discount %**, Warehouse/No Ref/Keterangan, baris **Sales account**, Del/Info.
- **Laporan Pembelian**: + Supplier list, Item purchase, PO outstanding, PO summary, Item daily/monthly/by supplier, Goods received, Price list/history, Return detail → **19 laporan**; sisa 6.
- **Laporan Penjualan**: + Item sales, SO & delivery notes, PPN summary, Customer list, Monthly sales, Commission, Sales per city, Item per customer, Returns per customer, PPN returns → **22 laporan**; sisa 22.


## 0. Ringkasan

Saat ini dari 25 menu 7Soft:

- **6 layar** dinilai penuh oleh audit elemen: `coa-master`, `coa-opening`, `coa-links`,
  `parties`, `assets`, `history`.
- **19 layar** masih `part` — ada elemen 7Soft yang belum masuk.
- **3 menu** tidak punya layar hub: Faktur Penjualan, Retur Penjualan, Saldo Awal COA
  (Saldo Awal sebenarnya punya layar prototipe, tetapi tidak punya rute hub).

Urutan penambahan mengikuti 7Soft-first:

```
P0 Cash & Bank  → P1 GL/Closing/Reports → P2 Purchasing → P3 Sales → P4 Master → P5 ERP+
```

---

## P0 — Cash & Bank

### 1. Info Kas Bank — `kas-info`

Yang perlu ditambahkan:

- [ ] **Sampai tanggal** bebas di samping periode.
- [ ] **Refresh** yang benar-benar membaca ulang data.
- [ ] Kolom **Aktif** dan **Keterangan** pada akun kas/bank.
- [ ] Akun **Piutang** dan **Giro Masuk** ikut daftar 7Soft (bukan hanya kas/bank).
- [ ] **Record navigator** `1 of 16` (kalau client tidak memilih drop).
- [ ] **Filter** per tipe akun; **Format/Default** boleh drop (technical leftover).
- [ ] Pilihan akun tunggal untuk laporan, bukan hanya lokasi.

Sudah ada: rekonsiliasi, kelola rekening, filter tanggal bebas, uang fisik, transfer,
count, print/export.

### 2. BKM · BKK — `bkm-bkk`

- [ ] **Del All** pada detail voucher.
- [ ] **Record navigation** First/Prior/Next/Last di form Klasik (kalau tidak drop).
- [ ] Pastikan form Klasik tetap memuat semua tipe baris 7Soft: pelunasan, lain-lain,
      down payment, giro.
- [ ] Print slip dari dalam shell (sudah ada `printSheet`).

Catatan: form Klasik di `bkm-bkk-prototype.html` sudah mencakup 7Soft; yang kurang hanya
Del All dan navigasi record di prototipe utama.

### 3. Pencairan BG — `giro-board`

- [ ] Status **DELETE**.
- [ ] Kolom **Tanggal buat**, **Periode**, **Keterangan**.
- [ ] **Clear (Cair)** giro out langsung dari board.
- [ ] **Tolak** hanya dari giro yang sudah cleared.
- [ ] **Undo clearing** untuk giro out.
- [ ] **Search, Filter, Print, record counter**.

### 4. Laporan Kas/Bank — `kas-report`

- [ ] Saldo **giro in bounced** di laporan 1 dan 5.
- [ ] Parameter giro: dokumen, party, tanggal, status.
- [ ] **Free from–to date range** (sudah ada picker, lengkapi).
- [ ] **Single cash/bank account picker** per laporan.
- [ ] Detail version jangan hanya menampilkan beberapa voucher; tampilkan semua.
- [ ] Pastikan 20 laporan 7Soft punya definisi query; yang belum ditandai `later`.

---

## P1 — GL, Closing, Laporan

### 5. Info Accounting — `gl-info`

- [ ] **Refresh**.
- [ ] Date range di **Jurnal** dan **All Jurnal**.
- [ ] **Sampai tanggal** bebas di **Neraca Saldo**.
- [ ] Toolbar paging/Format/Default/XLS — paging & format boleh drop; XLS keep.
- [ ] **Record counter** `4 of 303`.
- [ ] **Period picker** di tab Account.
- [ ] **Sub-ledger per transaction** di grid utama.
- [ ] Kolom dan urutan 7Soft: ACCOUNT, JURNAL, ALL JURNAL, BUKU BESAR PEMBANTU, NERACA SALDO.

### 6. Transaksi Jurnal — `gl-journal`

- [ ] **Del All**.
- [ ] **Record navigation** First/Prior/Next/Last (kalau tidak drop).
- [ ] **Delete a saved journal**.
- [ ] **Filter, Refresh, Undo**.
- [ ] **View / Print / Info**.
- [ ] **Status box** dan counter `1 of 11`.
- [ ] **Time** pada tanggal.
- [ ] Pastikan balance/debit-credit strip dan posting tetap jalan.

### 7. Closing Periode — `gl-closing`

- [ ] Tombol **Close**.
- [ ] Kolom **Tanggal, Tahun, Bulan**.
- [ ] **Proses Saldo Awal Program ke Neraca Awal**.
- [ ] **Progress bar**.
- [ ] Status periode: Open / Closed / Not yet + soft close (ERP+ nanti).

### 8. Laporan Accounting & Keuangan — `report-acc`

- [ ] **Fast Moving Kelompok Item**.
- [ ] Ranking basis **Qty / Nilai / Frek / Laba** + pie chart.
- [ ] **Format Akun** options.
- [ ] **Neraca Ke Kanan** dengan **Bln Lalu**.
- [ ] **Laba Rugi Item** dengan detail customer.
- [ ] **Selection dialog** sebelum menjalankan laporan.
- [ ] Lengkapi laporan yang masih `later`: 2-year, per unit, per dimension, expenses/month.

---

## P2 — Purchasing

### 9. Info Pembelian — `buy-info`

- [ ] Tab **PO** dengan **Close PO**.
- [ ] Daftar supplier dengan **alamat, telepon, kontak**.
- [ ] Tombol **Nota Pembelian Baru** dan **Retur Baru**.
- [ ] **Date range filter**.
- [ ] Tombol **Pencairan Giro**.
- [ ] **Record navigation** dan **XLS** (paging boleh drop).

### 10. Faktur Pembelian — `buy-invoice`

23 elemen belum; yang utama:

- [ ] **Lokasi** dan **alamat**.
- [ ] **Keterangan** header dan per baris.
- [ ] Kolom **Kode item**.
- [ ] **Discount dalam Rp** per baris.
- [ ] Tab **Uang Muka** / Down payment (tipe invoice `UANG MUKA`) dan **Pelunasan**; ini padanan supplier advance di 7Soft, bukan menu baru.
- [ ] Tab **PO · BPB · INVOICE**.
- [ ] Footer pelunasan **Total hutang / bayar / sisa**.
- [ ] **READ ONLY** setelah lunas.
- [ ] Tombol **Del, Filter, Cash, Pay, Print, Info**.
- [ ] Right-click **stock info** dan **price history**.
- [ ] Status pembayaran diturunkan dari alokasi, bukan field “Paid”.

### 11. Invoice Retur Beli — `buy-return`

- [ ] **Lokasi, Gudang, Keterangan**.
- [ ] Invoice type **MATCHING**.
- [ ] Kolom **Account** di grid.
- [ ] **Delete unreturned lines**.
- [ ] Footer pelunasan **total**.
- [ ] Toolbar **Del, Filter, Print, Info**.

### 12. Laporan Pembelian — `buy-reports`

17 laporan belum; prioritas:

- [ ] Item-level purchase: daily, monthly, by supplier.
- [ ] PO reports: summary, detail, outstanding, realisation.
- [ ] **Barang datang value**.
- [ ] **Price list** dan **price history**.
- [ ] Detail **retur pembelian**.
- [ ] **List supplier**.
- [ ] Selection dialog dengan **Jenis item**.

---

## P3 — Sales

### 13. Info Penjualan — `sell-info`

- [ ] Customer list: alamat, telepon, term, limit.
- [ ] Tab **SO** dengan **Close SO**.
- [ ] Tombol **Nota Baru** dan **Retur Baru**.
- [ ] Date range filter.
- [ ] **Pencairan Giro**.
- [ ] Record navigation.
- [ ] Tandai jelas: bukan customer ledger; ini bridge/legacy.

### 14. Penjualan Cash · POS — `sell-cash`

- [ ] **Lokasi, Keterangan, No Ref**.
- [ ] **Discount %**.
- [ ] **Line note**.
- [ ] **POS invoice no** dan **date**.
- [ ] Record navigation dan status.
- [ ] Pastikan cash sale dan till memakai data yang sama.

### 15. Faktur Penjualan — `sell-invoice`

20 elemen; yang utama:

- [ ] **Lokasi, Gudang, No Ref, Keterangan**.
- [ ] Kolom **HPP**.
- [ ] **Discount %**.
- [ ] **Sales account line** di bawah grid.
- [ ] Tombol **Del, Filter, Cash, Pay, Print**.
- [ ] Right-click **stock info** dan **price history**.
- [ ] Tandai `legacy/bridge`; jangan pura-pura punya backend customer AR.

### 16. Retur Penjualan — `sell-return`

- [ ] Status **LUNAS** dan **READ ONLY**.
- [ ] **Lokasi, Sales, No Ref, Keterangan**.
- [ ] **Total discount**.
- [ ] Kolom pelunasan: **No reff, Cek/BG, Potongan**.
- [ ] Tandai `legacy/bridge`.

### 17. Laporan Penjualan — `sell-reports`

32 laporan belum; prioritas:

- [ ] Item-level sales reports.
- [ ] Monthly sales + chart.
- [ ] SO dan Surat Jalan reports.
- [ ] Commission dan omzet per sales.
- [ ] Sales per city.
- [ ] PPN sales summary.
- [ ] List customer.
- [ ] Tandai laporan yang tetap di Sales module, bukan Finance.

---

## P4 — Master

### 18. Account — `coa-master`

- [ ] **7Soft account types** (Aktiva Lancar, Kewajiban, Modal, Pendapatan, Beban, dll).
- [ ] **Del All**.
- [ ] **Delete** akun (ditolak kalau sudah posted).
- [ ] **Info last edit** dari History.
- [ ] Record nav/Refresh/Undo/Print: paging & format boleh drop.

### 19. Saldo Awal COA — `coa-opening`

- [ ] **Full account list** (bukan sample), dengan search/group chips.
- [ ] **Status chip Open/Closed** di samping bulan.
- [ ] **Debit, credit, balance** agar trial balance tetap tie.
- [ ] Periode per baris boleh drop (satu bulan di atas grid).

### 20. Setting COA — `coa-links`

- [ ] **Per-item account picker** (7 akun dengan lookup).
- [ ] Save/Undo boleh drop (save at once), tetapi pastikan History mencatat.

### 21. Set Up — `setup-switches`

- [ ] **Info Perusahaan**: logo, NPWP, faktur pajak, PKP.
- [ ] **Tanggal Mulai Program**.
- [ ] **Purchasing flow** dan **Sales flow** (5 masing-masing).
- [ ] **Decimal places**, **max nota prints**, **form size**.
- [ ] **Empty database / import master / restore default**.
- [ ] **Setting Menu** (79 menu).
- [ ] Note for Today, menu pictures, local folder paths: drop (bukan web).

### 22. Customer · Supplier · Pajak — `parties`

- [ ] **Rayon, Diskon, Keterangan**.
- [ ] **Alamat lengkap**: line, city, province.
- [ ] **Contact, birthday, phone, fax**.
- [ ] **Import form**.
- [ ] **Aktif toggle**.
- [ ] Pajak: credit term + tax section sudah ada; pastikan label dan CRUD.

### 23. Asset — `assets`

- [ ] **Keterangan**.
- [ ] **Delete, Import, Format** (format boleh drop).
- [ ] **READ ONLY** saat periode ditutup.

### 24. User & Group — `users`

- [ ] **Group Keterangan**.
- [ ] **Menu tree semua modul**, bukan finance saja.
- [ ] **Select all / unselect column**.
- [ ] **Copy user**.
- [ ] **Report admin / template / Excel rights**.

### 25. History — `history`

- [ ] **Detik** pada waktu.
- [ ] **Report export** sebagai aksi.

---

## P5 — ERP+ (setelah 7Soft parity)

Ini bukan 7Soft; tambahkan setelah P0–P4 stabil:

- **Overview**: needs attention, cash, AP, inventory, cash flow.
- **Payables**: payment batches, payment instructions/reconciliation. **Supplier advances bukan menu baru**: 7Soft sudah punya **Uang Muka Pembelian** di Faktur Pembelian; lengkapi tab Down payment/Uang Muka di `buy-invoice` (masuk P2), bukan menambah menu.
- **Cash & Bank**: banking readiness, statement intake/sources, month summary.
- **Journal**: journal repeats, corrections.
- **Month End**: tax filings/settlements, prepaid schedules, inventory layers.
- **Assets**: reserve, depreciation schedule, transfer.
- **Setup**: number series, payment terms, head-office policies, banking readiness.
- **Inter-unit**: due from/to, transfer (butuh backend write).
- **Payroll**: finance handover.
- **Opening**: import + cutover report.

---

## Yang jangan ditambahkan dulu

- **Format / Default / DBF**, paging First/Prior/Next/Last, local folder paths,
  Note for Today, menu pictures: technical leftovers; drop atau ganti dengan search/keyboard.
- **Customer ledger / sales invoice / sales return** di Finance: tetap `legacy/bridge`;
  jangan membangun backend AR baru hanya untuk parity.
- **Wiring backend di prototipe**: belum; fokus kelengkapan UI dan perilaku 7Soft.

---

## Definition of done per layar

1. Semua elemen 7Soft yang **keep/improve** ada.
2. Label, urutan tab, kolom, dan tombol 7Soft dipertahankan.
3. Aksi utama tidak lagi `soon()`; kalau belum bisa, tandai jelas `prototype`.
4. Print/export berfungsi.
5. `COVER[screen].proto` berubah dari `part` ke `yes` (atau tetap `part` dengan alasan).
6. `HUB[screen]` dan `api` diperbarui di halaman Coverage.

---

## Urutan sprint yang disarankan

| Sprint | Isi | Hasil |
|---|---|---|
| **1** | Info Kas, BKM/BKK, Pencairan BG, Laporan Kas | Cash & Bank parity |
| **2** | Info Accounting, Jurnal, Closing, Laporan Accounting | GL/Closing parity |
| **3** | Info Pembelian, Faktur Pembelian, Retur Beli, Laporan Pembelian | Purchasing parity |
| **4** | Info Penjualan, POS, Faktur Jual, Retur Jual, Laporan Jual | Sales parity / bridge |
| **5** | Account, Saldo Awal, Setting COA, Set Up, Parties, Asset, Users, History | Master parity |
| **6** | ERP+ native | Lapisan di atas 7Soft |

**Satu kalimat:** yang perlu ditambahkan ke prototipe bukan layar baru, tetapi
**elemen 7Soft yang hilang di 19 layar yang sudah ada** — dimulai dari Cash & Bank,
lalu GL/Closing, Purchasing, Sales, Master; ERP+ menyusul.
