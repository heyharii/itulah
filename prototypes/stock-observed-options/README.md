# Stok Toko: Terlihat / Sistem, tiga opsi

Prototype lokal untuk membandingkan tiga cara menyampaikan satu tabel inventory. Tidak memanggil API, tidak mengubah stok produksi, dan tidak membutuhkan scan. Dataset di memori; reload atau **Ulangi demo** mengembalikan contoh awal.

- [A — Ringkas](http://store.localhost:5482/prototypes/stock-observed-options.html?option=a): toggle global, waktu dan cakupan dekat toggle, ikon status membuka detail.
- [B — Per lokasi](http://store.localhost:5482/prototypes/stock-observed-options.html?option=b): waktu pengecekan terbaru dan jumlah varian diperiksa ada di kepala kolom masing-masing lokasi.
- [C — Status jelas](http://store.localhost:5482/prototypes/stock-observed-options.html?option=c): konteks dalam kalimat pendek, ikon disertai teks status.

Semua opsi: Terlihat default, satu angka per lokasi, satu total, pencarian produk/warna/SKU, filter perlu diperhatikan, detail per baris, waktu/area/petugas pengecekan, pindahan manual pilih arah → isi jumlah → konfirmasi barang tiba.

Aturan angka:

- Terlihat adalah hasil pengecekan terakhir. Contoh memakai hitung manual, bukan input scanner.
- Sistem adalah saldo transaksi saat ini. Perpindahan hanya memperbarui Sistem.
- `—` belum diperiksa, `0` hasil pemeriksaan sah. Jika salah satu lokasi belum diperiksa, Total Terlihat tetap `—`, bukan penjumlahan sebagian yang terlihat seperti total lengkap.
- Pengecekan sebagian ditandai status dan garis titik pada angka. Detail menyebut area; tidak menyimpulkan kekurangan seluruh lokasi.
- Selisih dibandingkan dengan Sistem **pada saat pengecekan**, bukan otomatis dengan saldo sekarang. Jika ada pergerakan sejak pengecekan, status berubah walaupun barang dipindah kembali dan saldo akhirnya sama.
- Waktu ringkasan/header adalah pengecekan terbaru di lokasi; waktu per varian di detail. Cakupan `5/6 varian` menunjukkan varian pernah diperiksa, bukan persentase kelengkapan stok fisik.

Walkthrough: buka detail Basic Tee (selisih), Slim Jeans (berubah), Oxford (belum dicek), Cargo (sebagian). Pindahkan Hoodie 3 dari Gudang ke Floor: Sistem menjadi 6/8, Terlihat tetap 9/5. Isi 99 untuk melihat validasi batas stok asal. Coba arah balik dan konfirmasi.

Rebuild dan verifikasi:

```sh
python3 prototypes/stock-observed-options/build.py
node --check prototypes/stock-observed-options/app.mjs
node --test prototypes/stock-observed-options/model.test.mjs
```

Build membuat `../../stock-observed-options.html` yang bisa dibuka langsung dan salinan identik di `frontend-store-new/public/prototypes/stock-observed-options.html`.

Pilihan A adalah rekomendasi desain awal, belum hasil uji usability dengan staf. Pertimbangkan status tertulis C bila simbol belum dikenal. Lihat `QA.md` untuk verifikasi dan batas implementasi.
