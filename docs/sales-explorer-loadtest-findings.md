# Sales Explorer — hasil load test 1 juta transaksi (9 Okt 2026)

Untuk agen implementasi Explorer. Isi: apa yang diuji, apa yang rusak, apa yang lambat, dan pertanyaan desain yang perlu kamu pikirkan.
Tidak ada yang di-commit atau di-push dari sisi pengujian. Satu perubahan satu karakter kuberikan di `sales_explorer.rs` (lihat 2).

## 0. Lingkungan uji
- VM `itulah-loadtest` (GCP, Jakarta), awalnya e2-standard-2 (2 vCPU, 8 GB). Postgres 17, `shared_buffers=2GB`, query paralel dimatikan oleh kami (`max_parallel_workers_per_gather=0`; kodemu menyalakan 2 untuk jendela > 62 hari lewat `set_config`).
- Data: `scripts/seed-load-year.py` skala 1,0: 1.000.000 transaksi (975.000 selesai, 25.000 void), 1.950.000 baris penjualan, 13 toko, tahun 2025, 12.000 artikel, 192.000 SKU, 150 supplier.
- Penjumlahan pertama (job `sales_rollup_drain`): 4.680 hari-toko, sekitar 2 hari-toko/detik, ±40 menit murni. Hasil: `sales_sku_day` 1.950.000 baris, `sales_article_month` 628.771 baris.
- Stok: seed menaruh SEMUA 2,2 juta potong di gudang (HO), jadi stok toko = 0 di setiap baris. Untuk menguji jalur stok kami memindahkan 1,1 juta potong ke rak 13 toko (`inventory_projection`): `store_stock_sku` 903.148 baris, `store_stock_article` (0936) 155.892 baris.
- Dua backend pada data yang persis sama (salinan database): versi pertama `explorer-202610090823` (sebelum perubahan stok-hanya-halaman) dan versi terbaru `explorer-202610091142` (dengan 0936/0937).

## 1. Kecocokan angka: LOLOS
Dicek terhadap data mentah setelah penjumlahan selesai:
- `sales_rollup_drift` dan `sales_month_drift` (setahun): 0 baris.
- Struk per hari-toko, mentah vs `sales_store_day`: 0 hari berbeda; 975.000 selesai = 975.000.
- Potong terjual: 1.950.000 = 1.950.000. Bulan = jumlah harinya: 0 selisih.
- Uang per cara bayar: `sales_payment_day` = tender − kembalian, persis (570.614.400.000). Pembanding awal `paid_minor − change_minor` salah karena di seed `paid_minor = total_minor`.

## 2. BUG di working tree (sudah kuberi satu karakter)
Setiap pertanyaan Explorer = HTTP 500 `syntax error at or near ","` pada kode sejak perubahan "stok hanya untuk baris yang tampil": CTE `ranked` tidak ditutup sebelum `, page AS (`.
Aslinya `b.push(format!("), page AS (...` ; setelah perubahan menjadi `b.push(", page AS (...")`.
Kuubah menjadi `"), page AS ("` di `backend/src/cloud/postgres/sales_explorer.rs` (±baris 1341). Mohon periksa ulang dan masukkan ke versimu.
Catatan proses: tidak ada tes yang menjalankan SQL dari builder ini dengan stok/tanpa stok — satu tes integrasi yang menembak /explorer dengan `group` ≠ default akan menangkapnya.

## 3. Migration 0937 pada data 1 juta
`sales_sku_month` diisi di dalam migration: **260 detik** pada e2-standard-2 (2 vCPU) dengan 1,95 juta baris hari-SKU. Backend tidak melayani selama itu. (`statement_timeout` 120 detik kami sempat membuatnya gagal; perlu ditangani di rencana deploy: migration panjang tidak boleh kena timeout, dan idealnya data lama diisi oleh job di latar belakang, bukan oleh migration.)
Pada data seed ini `sales_sku_month` = 1.950.000 baris = sama dengan `sales_sku_day`: seed membuat hampir setiap (hari, toko, SKU) unik, jadi rekap bulanan TIDAK mengecilkan apa pun di sini. Di data klien nyata (SKU yang sama laku berulang) seharusnya mengecil banyak. Jadi data uji lebih berat dari yang nyata untuk jalur SKU.

## 4. Kecepatan: versi lama vs terbaru (detik, dingin / hangat, 50 baris, stok bertoko)
06:18:42
31
| question | old cold/warm | new cold/warm |
|---|---|---|
| article/month | 1.0 / 0.6 s | 0.9 / 0.9 s |
| article/year | 9.3 / 3.3 s | 6.8 / 3.7 s |
| article/quarter+stock | 24.4 / 22.6 s | 2.1 / 2.2 s |
| article/year+stock | 22.7 / 25.1 s | 4.5 / 5.2 s |
| sku/month | 5.1 / 6.0 s | 14.8 / 9.0 s |
| sku/year | 34.5 / 32.0 s | 40.9 / 30.2 s |
| sku/quarter+stock | 43.3 / 42.9 s | 17.9 / 15.3 s |
| sku/year+stock | 63.0 / 62.7 s | 27.8 / 29.3 s |
| division/month | 0.4 / 0.3 s | 0.7 / 0.3 s |
| division/year | 4.2 / 1.8 s | 11.0 / 5.8 s |
| division/quarter+stock | 30.4 / 27.4 s | 2.6 / 2.4 s |
| division/year+stock | 39.6 / 42.1 s | 4.0 / 2.6 s |
| tag/month | 0.7 / 0.3 s | 0.1 / 0.4 s |
| tag/year | 7.3 / 4.7 s | 2.9 / 2.1 s |
| tag/quarter+stock | 30.9 / 28.8 s | 1.4 / 1.0 s |
| tag/year+stock | 43.0 / 40.1 s | 2.9 / 2.1 s |
| supplier/month | 1.9 / 0.7 s | 1.2 / 0.6 s |
| supplier/year | 12.2 / 6.2 s | 4.2 / 4.7 s |
| supplier/quarter+stock | 23.8 / 25.5 s | 3.8 / 2.3 s |
| supplier/year+stock | 31.6 / 28.4 s | 6.2 / 5.1 s |
| po/month | 1.2 / 0.8 s | 0.7 / 0.7 s |
| po/year | 3.7 / 3.8 s | 6.3 / 4.6 s |
| po/quarter+stock | 27.0 / 21.4 s | 2.4 / 2.3 s |
| po/year+stock | 28.8 / 30.4 s | 5.8 / 4.7 s |
| colour/month | 1.9 / 1.6 s | 7.2 / 2.2 s |
| colour/year | 19.7 / 16.6 s | 25.7 / 18.0 s |
| colour/quarter+stock | 34.4 / 30.9 s | 68.1 / 120.0 s |
| colour/year+stock | 49.7 / 43.6 s | 120.1 / 120.0 s (500) |
| size/month | 3.4 / 2.2 s | 8.9 / 1.8 s |
| size/year | 13.7 / 10.9 s | 18.4 / 15.4 s |

Data uji tidak punya diskon dan tidak punya HPP (`cost_layer` kosong), jadi kolom diskon/laba/margin selalu kosong; sort `profit`, `margin`, `discount_rate` tidak diuji bermakna.

## 5. Pola yang terbaca
1. Pengelompokan yang kuncinya artikel (article, division, tag, supplier, PO) + stok: sudah jauh lebih cepat (rata-rata 5–15×) berkat 0936 dan "stok hanya untuk halaman".
2. Pengelompokan **colour, size, sku** + stok: tidak tertolong; colour+stok kuartal bahkan lebih lambat (68 dtk dingin, 120 dtk hangat) daripada versi lama (34 dtk). Jalur ini membaca `store_stock_sku` (903 ribu baris) dan join ke `sku`/`article_colour`.
3. Colour/size/sku TANPA stok pun lambat untuk setahun (colour 20–26 dtk, size 14 dtk, sku 35–41 dtk): tabel hari 1,95 juta baris di-join ke `sku` untuk mencari warna/ukuran.
4. Dingin ≈ hangat pada hampir semua pertanyaan lambat → tidak ada cache hasil sama sekali; tiap pembukaan layar membayar penuh.
5. Beban: dua backend + Postgres pada 2 vCPU mengganggu satu sama lain; angka kecil (selisih < 2×) belum bisa dipercaya sebagai selisih kode.

## 6. Ide solusi (untuk kamu pikirkan, bukan perintah)
a. Stok per (toko, warna) dan (toko, ukuran) dirangkum seperti 0936: tabel kecil (±13×24, 13×14 baris) dirawat oleh `store_stock_refresh`. Per SKU: stok hanya untuk 50 SKU halaman lewat `ix_store_stock_sku_sku`.
b. `colour_code`/`size_code` ditulis langsung di `sales_sku_day`/`sales_sku_month` (tidak berubah pada satu SKU) supaya pengelompokan warna/ukuran tidak perlu join `sku`.
c. Stok jadi permintaan kedua di layar: penjualan muncul dulu (1–2 dtk), kolom stok menyusul. Menghilangkan rasa lambat tanpa mengubah rumus.
d. Cache hasil singkat (30–60 dtk) per (parameter, hak akses), terutama untuk tampilan awal.
e. Pertimbangkan batas keras: tolak/arahkan kombinasi yang selalu mahal (sku + stok + setahun + matriks) atau paksa jendela lebih sempit.
f. Rencana pemasangan pertama: isi `sales_sku_day`, `sales_article_month`, `sales_sku_month`, `store_stock_article` lewat job latar belakang bertahap, bukan di migration.

## 7. Cara mengulang
Skrip di VM (`~/matrix.py`, `~/speed.py`, `~/compare.py`) — sumbernya di folder kerja sesi pengujian; matriks 104 pertanyaan: 14 pengelompokan × jendela × stok × matrix × compare × 9 urutan × filter × halaman; tiap pertanyaan dijalankan 2×; jawabannya disimpan JSON untuk dibandingkan angka demi angka antar versi.

## 8. Ulang di mesin besar (e2-standard-8, 8 vCPU, 32 GB; Postgres shared_buffers=8GB, paralel sampai 4) — 104 pertanyaan, dua versi, data sama
- Jawaban versi lama dan terbaru **identik pada 104 dari 104** pertanyaan (urutan sel toko dalam satu baris diabaikan, itu bukan bagian jawaban). Tidak ada 500 dan tidak ada timeout di kedua versi.
- Waktu hangat: lama median 0,60 dtk / p90 4,07 dtk / maks 20,4 dtk / 31 pertanyaan > 3 dtk. Terbaru median 0,32 dtk / p90 2,07 dtk / maks 19,3 dtk / 6 pertanyaan > 3 dtk.
- Terbaik: per pembayaran, sesi, tag, toko, divisi + stok: 9–18× lebih cepat (2,2–3,0 dtk → 0,1–0,3 dtk). Per artikel/supplier matrix + stok: 2,1 dtk dari 5,8–6,1 dtk.
- **Kemunduran nyata: colour dan size dengan stok**: colour/year+stock 4,7 → 11,8 dtk; colour/quarter+stock 3,8 → 11,4 dtk; size/year+stock 4,0 → 10,7 dtk; size/quarter+stock 3,5 → 10,6 dtk (±3× lebih lambat). Jalur ini jatuh ke rak per SKU (`reads_article_stock` false) dan sekarang melewati `MATERIALIZED` stk_keyed yang lebih berat. Perlu dilihat dengan EXPLAIN.
- Masih lambat di keduanya: `article/year filter one size+stock` 19–20 dtk (filter ukuran memaksa `shelves_only`).
- Di mesin kecil (2 vCPU) versi lama sampai 24–75 dtk untuk pertanyaan yang sama dan satu timeout 140 dtk: mesin 4× lebih besar saja membuat banyak pertanyaan 5–7× lebih cepat. Target 7 dtk di mesin besar: terbaru 5 pertanyaan melampaui (4 colour/size + stok, 1 filter ukuran), lama 1.

## 9. Retest on the 14:25 build (`explorer-202610090757`, e2-standard-8, same 1M database)

Built from the working tree at 14:56 WIB (all sessions' uncommitted work, so it also carries migrations 0938-0942); migrations applied cleanly, health 200. Same 104 questions as before.

- Answers: identical to the first Explorer on all 104 (0 different).
- Speed over the 104 questions: total 198 s (v1) → 127 s (13:00 build) → **105 s**; median 0.76 → 0.33 → 0.32 s; slowest 21.0 → 20.9 → **14.7 s**.
- Fixed: colour/size + stock, whole year 11.5 → 3.8 s (v1 was 4.7); size/year+stock 10.7 → 3.7 s.
- Still slower than the first Explorer, or slow outright:
  - `article / year / filter one size + stock` 14.7 s (v1 21.0)
  - `division / year / filter one colour + stock` 9.8 s (v1 2.2, 13:00 build 2.0) - got worse
  - `colour / quarter + stock` 8.1 s (v1 4.0)
  - `sku / month` 7.0 s (v1 1.4)
  - `store / year / filter one colour + stock` 4.4 s (v1 1.7)
- Not Explorer: the same VM's list screens did not move - inventory control 69 s, allotments 33 s, movements 19.6 s, observations 6.0 s, members 3.6 s, missing 2.4 s (control.rs, the allotments list, the movements list and the members list have no change in the working tree).
