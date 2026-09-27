# Prototype Executive Report

Prototype HTML/CSS dengan JavaScript ringan, mengikuti desain frontend-hub yang diperiksa pada 25 September 2026. Tidak memerlukan build/npm, tidak terhubung live ke database, dan tidak mengubah workbook sumber.

## Membuka

Dari root repository:

```sh
python3 -m http.server 5408 --bind 127.0.0.1 --directory prototypes/executive-report
```

- `http://127.0.0.1:5408/#reference` — Finance 2025 dari dokumen asli.
- `http://127.0.0.1:5408/#overview` — rancangan executive report operasional, angka simulasi.
- `http://127.0.0.1:5408/#coverage` — inventaris database lokal yang benar-benar diperiksa.

`index.html` juga dapat dibuka langsung. Semua font dan data tersimpan lokal. Preview berisi angka keuangan dari dokumen pengguna; server lokal diikat ke loopback.

## Susunan menu

Reports tetap menjadi utility di rail frontend-hub. Sidebar memuat Ringkasan, Kinerja toko, Barang & pembelian, Kas & laba, Pelanggan & promosi, serta Tim & aset. Pustaka menampung referensi tahunan, cakupan data, dan contoh laporan tersimpan.

Ringkasan dimulai dari perubahan bisnis dan agenda pembahasan, dilanjutkan KPI, tren, serta penelusuran toko. Setiap angka menyediakan definisi dan batas sumber. Finance tahunan dipisahkan dari filter simulasi 2026 karena workbook tidak memiliki rentang harian atau seluruh cabang yang dibutuhkan filter tersebut.

Rail 80 px, sidebar 248 px, topbar 52 px, Inter, warna biru #2563eb, radius kartu 12 px, dan white veil mengikuti `frontend-hub/src/styles/index.css`. Domain rail dan utility topbar mengikuti source navigasi terbaru yang diperiksa. Desktop, sidebar yang dilipat, tablet, dan ponsel didukung; tabel bisnis berubah menjadi kartu berlabel di layar sempit.

## Tiga jenis sumber

1. **Dokumen asli:** `finance-reference.js` memuat cuplikan nilai tersimpan dari lima XLS beserta workbook/sheet/range. `FINANCE-REFERENCE.md` menjelaskan validasi dan batas penggunaannya. Angka ini tidak menjadi fixture tren, headcount, kas konsolidasi, atau ranking toko.
2. **Simulasi desain:** semua halaman operasional September/Agustus 2026 memakai fixture deterministik di `app.js`. Filter, perbandingan, pencarian, pengurutan, detail toko, dan definisi metrik bekerja. Diagram harian menjumlah ke total KPI. Alokasi stok per sembilan divisi merupakan simulasi, bukan posisi stok dari XLS.
3. **Inventaris lokal:** `audit-data.js` / `database-inventory.json` memuat metadata seluruh skema public dan exact row counts, bukan payload bisnis/PII. Database `inventory_marketing_dogfood`: 380 relasi (371 tabel, 9 view), 4.070 kolom, 639 foreign key; 118 relasi terisi dan 262 kosong. Pemeriksaan read-only berurutan, bukan satu snapshot keuangan yang dibekukan.

## Temuan implementasi

- Database aktif lebih lengkap daripada database `inventory` yang masih tertulis pada sebagian konfigurasi lokal. Pemeriksaan mencakup seluruh metadata public, bukan klaim membaca seluruh isi transaksi/PII.
- Database audit sampai migrasi 0378; source sudah memiliki perubahan lebih baru, termasuk lapisan P&L 0379 dan sembilan divisi 0382. Sebelum menyambungkan report, versi skema harus sama.
- Dataset belum mewakili operasi penuh: edge_sale 26, sale 0, journal_entry 7, cost_layer 0, stock_ledger_entry 0, supplier_invoice 0, employee 0, fixed_asset 5. HPP yang belum tersedia tidak boleh dianggap nol.
- Penjualan operasional perlu normalisasi native/edge: hanya transaksi selesai, retur, pajak, fee, dan identitas sumber. Jangan langsung menjumlahkan `total_minor` atau jalur posting lama dan baru.
- IDR minor unit pada proyek adalah rupiah penuh, bukan sen. Margin gabungan merupakan rasio total, bukan rata-rata persentase toko.
- P&L mengikuti `ledger_account.statement_section`, reversal dan cutoff jurnal, serta lapisan gross/net operating profit. Head-office dan eliminasi antarunit diperlukan sebelum menyebut laba konsolidasi.
- Stok mengikuti authority tiap node, tidak menjumlah native dan edge untuk posisi yang sama. Snapshot adalah checkpoint; valuasi dan umur memerlukan lapisan biaya yang cukup.
- Saved Reports menyimpan definisi query dinamis. Report final membutuhkan snapshot angka, versi definisi, cutoff, coverage, rekonsiliasi, dan status pemeriksaan; backend tersebut belum diimplementasikan oleh prototype.

## Pemeriksaan

Sintaks JavaScript diperiksa. Browser diuji pada desktop dan ponsel: navigasi, filter periode/scope, sorting dan pencarian toko, detail toko, metadata database, dialog sumber Finance, sembilan divisi, dan overflow. Subtotal GL kedua tahun serta agregat divisi diperiksa terpisah dari UI. Cetak memakai stylesheet untuk bagian aktif; tidak ada PDF final yang diterbitkan.

## Berkas

- `index.html`, `styles.css`, `app.js`: shell, visual, interaksi, dan fixture.
- `finance-reference.js`: nilai Finance terpilih dengan provenance.
- `audit-data.js`, `database-inventory.json`: hasil inventaris skema dan jumlah baris lokal.
- `assets/`: font lokal dari frontend-hub.
- `FINANCE-REFERENCE.md`: memo pembacaan Finance dan sumber sel.
