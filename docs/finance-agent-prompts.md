# Prompt kerja: hub Finance final (5 agent)

Disusun 28 Oktober 2026 untuk branch `finance-final-menu`. Dokumen ini menggantikan ringkasan lisan sebelumnya; isi per agent di bawah berdiri sendiri, jadi tiap agent hanya perlu membaca bagian pembuka + bagiannya.

## Pembuka untuk semua agent

**Sumber kebenaran tampilan:** `finance-menu-final-prototype.html` (hasil build) dan folder `finance-menu-final/` (sumber aslinya). Yang dibangun adalah layar hub di `frontend-hub`, bukan prototype baru.

**Peta prototype → bagian kerja.** Shell dan menu ada di `base.js` (`GROUPS`: `stores`, `cash`, `pay`, `acc`, `rep`, `setup`). Build-nya di `build.py`, urutannya `scr-stores.js`, `scr-cash.js`, `scr-cash2.js`, `scr-pay.js`, `scr-acc.js`, `scr-rep.js`.

| File prototype | Isi |
|---|---|
| `base.css`, `base.html`, `base.js` | Shell hub, sidebar, tab, sheet, kartu, tabel, format uang dan tanggal |
| `data.js` | Seed data: dokumen, supplier, akun, aset |
| `scr-stores.js` | Stores: hari kas toko, Daily close, Store cash |
| `scr-cash.js`, `scr-cash2.js` | Cash & Bank: kartu rekening, hitung kas, giro, rekonsiliasi |
| `scr-pay.js` | Payables: Bills, Supplier, Purchase invoice, Credit note, Ledger supplier |
| `scr-acc.js` | Accounting: Journal, Buku besar, Aset, tutup periode |
| `scr-rep.js` | Reports **dan** Setup, termasuk Month end (`repME('tax')`, `repME('stock')`) |

**Aturan kerja**

1. Bangun layar hub **persis seperti prototype**: tab, urutan dan nama kolom, KPI, chip, sheet, dan kata-kata yang dipakai (label tombol, judul sheet, kalimat kosong). Kalau ragu antara "lebih rapi" dan "sama dengan prototype", ikuti prototype.
2. Pakai komponen hub yang sudah ada (`frontend-hub/src/components/ui/`: `card`, `data-table`, `kpi`, `filter-chip`, `filter-sheet`, `dialog`, `list-head`, `empty-art`, `button`, dst.) dan API/query yang sudah ada (`src/lib/queries/`). Jangan menulis tabel, sheet, atau format uang baru kalau padanannya sudah ada.
3. Kolom yang datanya belum ada di API **tetap ditampilkan**, isinya `—`, dan dicatat di daftar backend pada laporan akhir agent. Jangan mengarang endpoint, jangan menaruh angka palsu, jangan menyembunyikan kolom.
4. **Hanya sunting file blok sendiri.** Daftar file per agent ada di bawah. Jangan menyentuh file agent lain, jangan merapikan file di luar blok, jangan mengubah `frontend-hub/src/screens/finance/cash-documents.tsx`.
5. Verifikasi hanya **syntax parse + prettier**. Tidak ada `tsc`, tidak ada build, tidak ada tes, tidak ada `npm run typecheck`.
6. **BKK/BKM tidak boleh diubah** dalam bentuk apa pun: `frontend-hub/src/screens/finance/cash-documents.tsx` dan route `/finance/cash-bank/bkk*`, `/finance/cash-bank/bkm*`.
7. **Retur hanya tukar barang, tanpa uang kembali.** Tidak ada refund tunai, tidak ada kredit kas, tidak ada kolom "uang kembali" di layar retur mana pun.
8. Jangan commit, jangan push, jangan hapus file. Laporkan saja di akhir.

**Cara memeriksa satu file**

```bash
cd frontend-hub
./node_modules/.bin/prettier --write src/screens/finance/<file>.tsx   # sekaligus parse; gagal = syntax salah
./node_modules/.bin/prettier --check src/screens/finance/<file>.tsx
```

`prettier` sudah ada di `frontend-hub/node_modules/.bin` dan membaca `frontend-hub/.prettierrc`. Prettier gagal pada file yang tidak bisa di-parse, jadi ini sudah cukup sebagai penjaga syntax.

**Cara melihat hasilnya di browser**

```bash
cd frontend-hub
npm run dev -- --port 5177
```

`vite.config.ts` tidak menyetel port, jadi port harus diberikan lewat argumen seperti di atas. Buka `http://localhost:5177`, login, lalu masuk ke route terkait. Error parse atau import muncul di layar dev server dan di console browser; itu cara cek cepat selain prettier.

**Kondisi kode saat ini (baca sebelum menyunting)**

- Branch `finance-final-menu` sudah sama dengan `origin` (tidak ada commit tertunda), tetapi **working tree belum bersih**: sekitar 212 file modified dan 90 untracked dari pekerjaan lain, sebagian besar berupa reformat. Jangan menganggapnya milikmu, jangan commit, jangan revert.
- Giro, Daily close, dan Store cash sudah ditulis di hub tetapi **belum dicek di browser**. Daily close dan Store cash **belum punya route**.
- Cash & Bank, Bills, Journal, dan Reports **terhenti di tengah edit**. Baca file yang ada dulu sampai paham bentuknya sebelum menambah atau mengganti apa pun; jangan menulis ulang dari nol.
- Route Finance ada di `frontend-hub/src/screens/finance/nav.ts`; peta route → file ada di `frontend-hub/src/screens/finance/index.ts`. Menyentuh dua file itu hanya tugas Agent 5.

**Format daftar backend (dipakai semua agent)**

| Layar | Kolom/elemen | Yang belum ada di API | Perlu apa |
|---|---|---|---|
| mis. Bills | `Sisa` | sisa per dokumen belum dihitung server | field `outstanding_minor` di daftar bill |

---

## Agent 1 — Cash & Bank, dan Bank reconciliation

**Prototype:** `scr-cash.js`, `scr-cash2.js` (grup `cash`).

**File yang boleh disentuh**

- `frontend-hub/src/screens/finance/cash-info.tsx` — sudah ada, 1.513 baris, memuat dua layar: `KasBank` (`/finance/cash-bank/kas-bank`) dan `KartuKasBank` (`/finance/cash-bank/kartu`). Perbaiki yang setengah jadi, jangan diganti nama ekspornya.
- `frontend-hub/src/screens/finance/bank-rec.tsx` — **file baru**.

**Isi pekerjaan**

1. **Kartu rekening**: kartu per rekening seperti prototype — nama bank, nomor, saldo, chip status, dan hitungan kas di atasnya.
2. **Sheet akun**: membuka detail satu rekening, dengan mutasi dan angka yang sama seperti prototype.
3. **Hitung kas**: rekap fisik vs catatan, selisih ditampilkan apa adanya, tanpa angka karangan.
4. **Bank reconciliation** (`bank-rec.tsx`): daftar transaksi bank vs buku, tandai cocok/belum, saldo awal–akhir, sama susunannya dengan prototype `scr-cash2.js`.
5. Giro sudah ada di hub: jangan menulis ulang, cukup jangan dirusak. Kalau layar giro butuh penyesuaian dari sisi Cash & Bank, catat di laporan, jangan sunting file giro.
6. Retur di layar kas (kalau ada) hanya tukar barang, tanpa uang kembali.

**Daftar route yang sudah ada dan tidak kamu ubah:** `/finance/cash-bank/kartu`, `/kas-bank`, `/bank-accounts`, `/cash-transactions`, `/petty-cash`, `/deposits`, `/transfers`, `/giro`, `/bkk*`, `/bkm*`. Route `/finance/cash-bank/bank-reconciliation` sudah ada di `nav.ts` tetapi masih menunjuk layar lama; penyambungan ke `bank-rec.tsx` dikerjakan Agent 5.

---

## Agent 2 — Bills dan Suppliers

**Prototype:** `scr-pay.js` (grup `pay`).

**File yang boleh disentuh** (semua di `frontend-hub/src/screens/finance/`)

- `supplier-bills.tsx` — 3.090 baris, sudah merekam, posting, dan menahan bill. Baca dulu; jangan dipotong.
- `purchase-invoice.tsx` — 841 baris.
- `credit-notes.tsx` — 962 baris.
- `supplier-ledger.tsx` — 613 baris.
- `purchasing-info.tsx` — 1.103 baris.

**Isi pekerjaan**

1. Susun tiap layar seperti prototype: tab, kolom, KPI di atas, chip filter, sheet detail, dan kata-kata yang sama.
2. Kolom yang belum ada di API tetap tampil `—` dan masuk daftar backend.
3. **Retur hanya tukar barang, tanpa uang kembali.** Credit note mengurangi utang barang, bukan mengeluarkan kas; jangan menambah kolom atau tombol refund.
4. Jangan mengubah BKK/BKM walau bill berhubungan dengan pembayaran kas.
5. Jangan menyentuh `nav.ts` dan `index.ts`.

---

## Agent 3 — Journal, Ledger, Assets, Month end

**Prototype:** `scr-acc.js` (grup `acc`), ditambah Month end dari `scr-rep.js` (`repME('tax')`, `repME('stock')`).

**File yang boleh disentuh**

- `frontend-hub/src/screens/finance-final/journals.tsx` — **bukan** di folder `finance/`; route `/finance/accounting/journal-entries` menunjuk ke sini.
- `frontend-hub/src/screens/finance/info-accounting.tsx` — 595 baris.
- `frontend-hub/src/screens/finance/assets.tsx` — 2.451 baris.
- `frontend-hub/src/screens/finance/periods.tsx` — 1.334 baris.
- `frontend-hub/src/screens/finance/month-end.tsx` — **file baru**.

**Isi pekerjaan**

1. **Journal**: daftar dan detail jurnal, kolom debit/kredit, chip status, sheet baris jurnal — sama seperti prototype.
2. **Buku besar** (`info-accounting.tsx`): saldo awal, mutasi, saldo akhir per akun.
3. **Assets**: register aset dan KPI-nya, mengikuti `assets.tsx` yang sudah ada; jangan menulis mesin penyusutan kedua.
4. **Tutup periode** (`periods.tsx`): daftar periode dan statusnya.
5. **Month end** (`month-end.tsx`, baru): PPN/PPh 23 dan stock vs ledger seperti `repME` di prototype.
6. Perhatikan: `scr-rep.js` juga dibaca Agent 4 untuk Reports/Setup. Kamu hanya menulis `month-end.tsx`; jangan menyunting `laporan-accounting.tsx`.

---

## Agent 4 — Reports dan Setup

**Prototype:** `scr-rep.js` (grup `rep` dan `setup`).

**File yang boleh disentuh**

- `frontend-hub/src/screens/finance/laporan-accounting.tsx` — **file baru**.
- `frontend-hub/src/screens/finance/setup-index.tsx` — 336 baris, halaman Setup.
- File master yang dibuka dari Setup dan sudah ada di `finance/`: `account-links.tsx`, `expense-categories.tsx`, `journal-templates.tsx`, `asset-classes.tsx`, `dimensions.tsx`, `payment-methods.tsx`, `giro-print.tsx`, `taxes.tsx`, `finance-settings.tsx`, `chart-of-accounts.tsx`.

**Isi pekerjaan**

1. **Reports**: satu layar laporan bergaya hub seperti prototype — daftar laporan, filter, pratinjau, tanpa membuat renderer laporan baru kalau yang lama sudah ada.
2. **Setup**: satu halaman berisi semua master, tiap baris membuka tabel aslinya, persis seperti `scr-rep.js` bagian Setup.
3. Jangan mengubah angka laporan yang sudah dihitung server. Kalau prototype menampilkan kolom yang belum ada, `—` + daftar backend.
4. Month end milik Agent 3 (`month-end.tsx`); jangan menulis file itu.

---

## Agent 5 — Sambungkan route dan bandingkan dengan prototype

Dikerjakan **setelah Agent 1–4 selesai**.

**File yang boleh disentuh**

- `frontend-hub/src/screens/finance/nav.ts` — label, urutan, dan path.
- `frontend-hub/src/screens/finance/index.ts` — peta route → file.

**Isi pekerjaan**

1. Daftarkan layar baru dan hasil perbaikan: `bank-rec.tsx` untuk `/finance/cash-bank/bank-reconciliation` (sekarang masih menunjuk layar lama di `finance-lab-2`), `month-end.tsx`, `laporan-accounting.tsx`, serta route yang belum ada untuk **Daily close** dan **Store cash**.
2. Untuk setiap file yang disentuh Agent 1–4: jalankan Vite di `:5177`, buka route-nya, pastikan tidak ada error parse/import dan layarnya benar-benar muncul (bukan `Placeholder`).
3. Bandingkan dengan prototype di browser setelah login: tab, urutan kolom, KPI, chip, sheet, dan kata-kata. Catat yang beda, perbaiki yang bisa diperbaiki dari sisi route, dan laporkan sisanya ke agent pemilik blok.
4. Jangan menyunting isi layar milik agent lain; kalau rusak, laporkan, jangan diperbaiki sendiri.
5. BKK/BKM tidak boleh berubah. Cek juga `/finance/cash-bank/bkk` dan `/bkm` sesudah penyambungan route.

---

## Laporan akhir tiap agent

Tulis di balasan terakhir, singkat:

1. File yang disentuh (path + satu baris isinya).
2. Hasil `prettier --check` per file.
3. Route yang sudah dicek di `:5177`, dan hasilnya.
4. Tabel daftar backend (format di pembuka).
5. Yang belum selesai atau sengaja ditinggalkan, beserta alasannya.

---

## Status pelaksanaan, 28 Oktober 2026

Agent 1–5 sudah dijalankan. Ringkasnya:

- **Layar disamakan:** `cash-info.tsx` (+ `bank-rec.tsx` baru), `supplier-bills.tsx`, `purchasing-info.tsx`, `credit-notes.tsx`, `journals.tsx`, `info-accounting.tsx`, `setup-index.tsx` (+ `month-end.tsx` dan `laporan-accounting.tsx` baru).
- **Tanpa perubahan (sudah setara):** `assets.tsx`, `periods.tsx`, `supplier-ledger.tsx`, `purchase-invoice.tsx`, dan layar master Setup.
- **Route:** `nav.ts` tidak lagi meminjam item lain untuk satu baris — kelima belas baris kini membawa path-nya sendiri, jadi "Store cash" tidak lagi hilang dan "Daily close" tidak lagi membuka pintu Stores. New paths: `/finance/stores/daily-close`, `/finance/stores/store-cash`, `/finance/accounting/month-end`; `/finance/cash-bank/bank-reconciliation` now answers with `bank-rec.tsx`, `/finance/reports/laporan-accounting` with the new wrapper. The old sales-by-day and period-close screens keep their routes, off the menu.
- **Retur:** aksi "Record refund" di `credit-notes.tsx` dihapus; credit note hanya mengurangi tagihan berikutnya. Baris lama berstatus `REFUNDED` tetap terbaca. Endpoint `refundCreditNote` masih ada di API, hanya tidak ditawarkan lagi.
- **Belum dicek secara visual:** sesi di `:5177` berhenti di halaman Sign in, jadi perbandingan berdampingan dengan prototype menunggu login. Semua route dan modul yang disebut di atas merespons 200 tanpa error transform Vite.
- **Tidak dijalankan sesuai aturan:** `tsc`, build, tes. Kompilasi hanya dibuktikan lewat transform Vite.

