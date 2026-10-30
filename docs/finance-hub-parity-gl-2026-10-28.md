# Parity 7Soft → hub: Closing Periode, Laporan Accounting, Info Accounting (sisi buku besar)

**Tanggal:** 28 Oktober 2026
**Aturan owner:** informasi di tiap menu sama dengan 7Soft; menyimpang hanya bila hub pasti lebih baik, dan
dikatakan. Ekstra hub yang 7Soft tidak punya tetap ada.
**Sumber 7Soft:** `finance-7soft/manual-7soft.txt` hal. 206–218 dan 261–270, screenshot `7soft-ref/manual/p206…p217`,
prototipe `finance-7soft/scr7-gl.js` + `scr-gl.js` (`gl-info`, `gl-closing`, `report-acc`).
**Keputusan:** KEEP = pertahankan apa adanya · IMPROVE = ikuti 7Soft, hub menambah · DROP = sisa teknis 7Soft.
**Status:** ada / diganti nama / belum ada (di hub). "Dikerjakan" = ditulis 28 Okt, belum dijalankan di browser
(tidak bisa login; hanya `prettier` + `eslint`, tanpa `tsc`).

---

## 1. Closing Periode (7Soft 7.3) — `/finance/period-close`, tab Periods

Layar hub: tab **Checklist** (`finance-final/controls.tsx`: kesiapan tutup bulan + kontrol buku besar vs sub-buku, tutup
"untuk toko") dan tab **Periods** (`finance/periods.tsx`: kalender periode, sheet tutup/buka kembali).

| Elemen 7Soft | Di hub | Keputusan | Dikerjakan |
|---|---|---|---|
| Grid: **Periode** | ada ("Month") → diganti nama **Periode** | KEEP | kolom diberi nama 7Soft |
| **Tanggal** (tanggal periode dibuat) | belum ada: cloud tidak menyimpan tanggal buat | tidak bisa | dicatat; tidak diisi angka palsu |
| **Tahun**, **Bulan** | belum ada (hanya nama bulan) | IMPROVE | kolom Tahun, Bulan |
| **Tanggal Mulai / Akhir** | belum ada | IMPROVE | kolom Mulai, Akhir (hari pertama/terakhir bulan) |
| **Status** (centang = terbuka) | ada (pill Open/Closed) | KEEP | pill dipertahankan; kata 7Soft Open/Closed sama dengan plan §4.3 |
| Hub-only: Entries, Closed by, Closed at, filter, sheet riwayat close/reopen | ada | KEEP (ekstra) | tetap |
| Tombol **Create Period** | ada ("Open {bulan}") | IMPROVE | diberi nama **Create Period**; bulan yang ditawarkan = bulan sesudah yang terbaru |
| Create Period hanya setelah periode sebelumnya di-closing | hub boleh buka bulan baru sebelum bulan lama ditutup | **DROP kopling ini** — hub lebih baik: kasir toko tetap bisa posting ke bulan baru selagi pembukuan bulan lama dirapikan (badge "Month End" mengingatkan). Pasti, karena trigger DB sudah menjaga tanggal posting | tidak ditiru |
| Tombol **Closing** (setelah pilih periode) | ada di sheet periode ("Close this month") | IMPROVE | tombol **Closing** di kepala halaman + sheet; bekerja pada bulan terbuka **tertua** |
| **Closing berurutan** | server hanya menolak urutan terbalik pada undo | IMPROVE | UI menolak Closing bila ada bulan lebih lama yang masih terbuka ("close X first") |
| Tombol **Undo Closing** | ada di sheet ("Undo closing") + alasan wajib | IMPROVE | **Undo Closing** di kepala halaman + sheet; bekerja pada bulan tertutup **terbaru**; UI menolak bila ada bulan lebih baru yang tertutup (server sama) |
| Tombol **Close** (keluar modul, kembali ke menu) | — | **DROP** (sisa teknis, jendela MDI) | — |
| Baris **Proses Saldo Awal Program ke Neraca Awal** + Proses | tidak ada | **DROP**: saldo akhir dibawa otomatis karena buku dihitung dari jurnal, tidak ada proses untuk dijalankan | dijelaskan di komentar `book-check.tsx` |
| **Test Validasi Transaksi** + View Problem | tidak ada (checklist tutup bulan ada tapi tidak bisa dicoba sendiri) | IMPROVE → satu tombol | **Cek pembukuan** |
| **Test Validasi Accounting** + View Problem | idem | IMPROVE → satu tombol | **Cek pembukuan**: `POST /finance/integrity/run` (10 persamaan kontrol, sama dengan engine checklist) + `GET /finance/ledger-health`; temuan terurut terburuk dulu, dengan selisih dan baris rinci. Ada di tab Checklist dan di sheet tiap bulan terbuka |
| Centang **Setuju abaikan validasi** (tutup walau ada masalah) | tidak ada | **DROP** — hub lebih ketat dan itu disengaja: checklist menolak tutup bila gagal kritis, tidak ada jalan pintas. Tidak pasti operator setuju, jadi dicatat sebagai keputusan owner | tidak ditiru |
| Progress bar | tidak ada | DROP (sisa teknis) | — |
| Peringatan "pastikan tidak ada user lain" | tidak perlu: close dan posting diserialkan oleh DB (`FOR SHARE`) | DROP | — |
| **Reproses** (menu Fasilitas: stok, HPP, accounting) | tidak ada | DROP: tidak ada yang diproses ulang; jurnal diposting saat dokumen diposting | — |
| Yang dikunci periode tertutup | trigger `journal_entry`: posting bertanggal di bulan tertutup/tak terbuka ditolak | KEEP (sudah di hub, tertulis di sheet) | — |
| Special case 2.1 "undo closing → input saldo awal → reproses" | undo ada; reproses tidak perlu | KEEP undo | — |

Belum bisa: kolom **Tanggal** (tak ada data), dan Closing/Undo Closing di header **tidak tampil di HP** (header
desktop-only di halaman ini; di HP keduanya lewat sheet baris + Fab "Create Period") — dicatat.

## 2. Info Accounting (7Soft 7.1), sisi buku besar — tab Ledger

Tab Account / Jurnal / All Jurnal bukan bagian ini (Account = Chart of Accounts; Jurnal & All Jurnal = Transaksi Jurnal,
agen lain). Hub: tab **Ledger** punya General Ledger dan Trial Balance.

| Elemen 7Soft | Di hub | Keputusan | Dikerjakan |
|---|---|---|---|
| **Buku Besar Pembantu**: Account … s.d. …, Periode, Sampai tanggal, Refresh | GL hanya satu akun/heading | IMPROVE | mode di Trial Balance: rentang kode akun (dari / s.d. mencocokkan awalan), Periode dari–sampai (sampai = "Sampai tanggal"); hasil otomatis, tanpa Refresh |
| Kolom **Awal, Debet, Kredit, Saldo** per akun | Trial Balance: Opening/Debit/Credit/Closing dua sisi | IMPROVE | satu baris per akun, nilai wajar bawaan akun (utang positif seperti 7Soft), total Debet/Kredit; total Awal/Saldo hanya bila satu jenis akun |
| Baris per **transaksi** (Tanggal, Keterangan, No Jurnal, No Reff, Kode, Nama, Uraian) | GL punya tanggal, voucher, memo, tipe, unit, lawan, debit/kredit, saldo berjalan | IMPROVE | baris akun dibuka dalam layer (Tanggal, No Jurnal + keterangan, Debet, Kredit, Saldo) untuk periode yang sama + Awal/Debet/Kredit/Saldo Akhir; tautan ke General Ledger. Beda dari 7Soft: tidak semua transaksi semua akun dalam satu grid (ratusan akun × transaksi tidak terbaca); ringkasan per akun lebih baik dan tiap baris tetap bisa dibuka |
| **No Reff** | tidak ada di data GL | belum ada | dicatat |
| Footer **Awal / Debet / Kredit / Saldo Akhir** | ada di GL (opening, window, closing) | KEEP | juga di layer |
| **Neraca Saldo**: Sampai tanggal, Kode, Nama, Debet, Kredit | Trial Balance dua tanggal, enam kolom | IMPROVE | mode **Neraca Saldo** (default): satu tanggal "Sampai tanggal", Kode, Nama, Debet, Kredit (saldo bersih per sisi), **Total Debet, Total Kredit, Selisih**; spanduk merah bila server bilang tidak seimbang |
| Hub-only: dua pembacaan lama (Opening/Closing enam kolom, pecah per unit), unit, Excel | ada | KEEP | mode ketiga "Opening and closing" |
| Kolom **Total** per baris | — (7Soft: total satu sisi) | = Total Debet/Kredit di bawah | — |
| Refresh | tidak perlu: angka dibaca ulang saat input berubah | DROP | — |
| First/Prior/Next/Last, "4 of 303", Search, Filter, Format, Default | — | **DROP** (paging record, sisa DBF) | — |
| **XLS** | Export Excel | KEEP | tiap mode punya Excel |
| Tombol **Account Baru** (tab Account) / **Jurnal Baru** | di Chart of Accounts / Transaksi Jurnal | di luar bagian ini | — |

## 3. Laporan Accounting (7.4) + Laporan Keuangan (8.1) + Manajerial (8.2)

Hub: pintu **Reports** dengan tab Profit and loss, Balance sheet, Cash flow, Ledger, Sales by division. Tidak ada daftar
laporan seperti 7Soft. Dikerjakan: **satu view baru "Laporan Accounting"** (`/finance/reports/laporan-accounting`) berisi
daftar 7Soft dengan nama dan urutannya (12 + 15 + 3), tiap baris menunjuk layar yang menjawab atau ditandai **Later**
berikut alasannya. Satu grup tambahan **Only in the hub** menunjuk laporan ekstra hub supaya tidak yatim dari daftar.

Pemetaan (In the hub = angkanya ada; Partly = ada, yang kurang disebut di baris):

| # | Laporan 7Soft | Status | Layar hub | Yang kurang / alasan |
|---:|---|---|---|---|
| 7.4-1 | Perhitungan HPP | Later | — | HPP per item = buku stok, milik Merchandise |
| 2 | Laporan Jurnal | In the hub | All Jurnal | — |
| 3 | Laporan Jurnal Pembelian | Partly | All Jurnal, Source Faktur Pembelian | tampil per baris, bukan ayat silang |
| 4 | Laporan Jurnal Penjualan | Partly | All Jurnal, Source Penjualan Cash | idem |
| 5 | Laporan Jurnal Persediaan | Partly | All Jurnal, Source Stock Opname/Transfer | idem |
| 6 | Jurnal Pengeluaran Kas (BKK) | Partly | All Jurnal, Source Cash document | BKK dan BKM tidak dibedakan sumbernya; awalan nomor yang membedakan |
| 7 | Jurnal Penerimaan Kas (BKM) | Partly | idem | idem |
| 8 | Buku Besar Pembantu | In the hub | Trial Balance › Buku Besar Pembantu | §2 |
| 9 | Persediaan Akhir Bulan | Partly | Inventory › Valuation | stok akhir hari ini, tanpa roll-forward bulan lalu |
| 10 | Master Account | In the hub | Chart of Accounts | — |
| 11 | Aktiva Tetap dan Penyusutan | Partly | Assets › By category | posisi hari ini, bukan akhir periode lampau |
| 12 | … Tahunan | Partly | idem | jadwal per bulan ada per aset, bukan satu tabel tahunan |
| 8.1-1…5 | Laba/Rugi Per Item, Item/Barang, Customer, Nota, per Sales | Later | — | per item/customer/nota/sales = milik Merchandise/Sales; tidak ada buku customer atau faktur penjualan |
| 6 | Laba Rugi GL | In the hub | Profit and loss › Standard | — |
| 7 | Laba Rugi (Barang) | Later | — | butuh persediaan awal/akhir per periode (Merchandise) |
| 8 | Laba Rugi Tahunan | In the hub | Profit and loss, Periodicity Monthly | — |
| 9 | Neraca Saldo | In the hub | Trial Balance › Neraca Saldo | §2 |
| 10 | Neraca Ke Kanan | Later | — | tata letak Aktiva\|Passiva berdampingan; neraca hub menurun |
| 11 | Neraca Standard | In the hub | Balance sheet › Standard | — |
| 12 | Neraca Perbandingan 2 Bulan | Partly | Balance sheet, Monthly | dua bulan berdampingan; kolom selisih hanya di "2 years" |
| 13 | Neraca (Common Sized) | Later | — | persen terhadap total aktiva |
| 14 | Neraca Tahunan | In the hub | Balance sheet, Monthly | — |
| 15 | Arus Kas | In the hub | Cash flow | — |
| 8.2-1…3 | Fast Moving, Slow Moving, 10 Top Customer | Later | — | peringkat item/customer = Merchandise/Sales; grafik pie tidak dibawa (tabel peringkat sama isinya) |

Elemen lain 7Soft: kolom **Keterangan** dibawa ("Detil Customer", "FAKTUR", "Format Akun Fleksibel" …) · dialog **pilih
parameter sebelum laporan** → DROP, filter hub ada di layar laporan (periode, unit, Periodicity) · **Format Akun**
(tidak berubah/fleksibel) → belum ada; chart hub satu · **Print** → Export Excel/cetak browser, sama seperti
sebelumnya · **Common Sized, Ke Kanan** → Later.

Keputusan menyimpang yang dikatakan: tidak membuat halaman laporan baru untuk Jurnal Pembelian/Penjualan/Persediaan/BKK/BKM
— All Jurnal (agen lain) sudah punya filter Source; satu daftar yang menunjuk ke sana lebih jujur daripada lima salinan.

## 4. Perubahan kode

| File | Isi |
|---|---|
| `screens/finance/book-check.tsx` (baru) | **Cek pembukuan** |
| `screens/finance/periods.tsx` | kolom 7Soft, Create Period / Closing / Undo Closing, urutan, Cek pembukuan di sheet |
| `screens/finance-final/controls.tsx` | seksi Cek pembukuan di tab Checklist |
| `screens/finance-final/reports/trial-balance.tsx`, `trial-balance-7soft.tsx` (baru) | Neraca Saldo, Buku Besar Pembantu, pembacaan lama |
| `screens/finance-final/reports/laporan-accounting.tsx` (baru) | daftar laporan 7Soft |
| `screens/finance/nav.ts`, `index.ts` | **satu view + satu item tersembunyi + satu route** untuk daftar Laporan Accounting (tak terhindarkan: daftar butuh route sendiri). Tab Reports tetap lima |

Tidak diverifikasi: tampilan di browser; tipe (`tsc` tidak dijalankan); bentuk JSON `/integrity/run` dan
`/ledger-health` dibaca dari Rust (`IntegrityRunSummary`, `LedgerHealthRow`), belum dari respons nyata; tipe kontrak untuk
keduanya belum di-generate sehingga ditulis tangan di `book-check.tsx`.
