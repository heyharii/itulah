# Verifikasi prototype

11 Oktober 2026. Sumber modular, standalone root, dan public HTML berasal dari build yang sama. Tidak ada endpoint inventory yang dipanggil oleh simulator.

## Model

`node --test prototypes/stockroom-floor-research/model.test.mjs`: **8/8 lulus**.

- Scan membuat draft, saldo belum berubah; duplicate dan barcode SKU ditolak.
- Tag salah lokasi ditolak tanpa mengganti arah.
- Route terkunci selama draft; membuka kembali setelah tag terakhir dikeluarkan.
- Offline tidak memindahkan stok; reconnect dan retry memindahkan tepat satu kali.
- Lima tag dengan satu penolakan: empat berhasil, satu tetap di draft; retry memakai key yang sama, total toko tetap 35.
- Posisi berubah antara scan dan konfirmasi: hanya tag yang masih di asal yang berhasil.
- Serialize/restore mempertahankan key dan hasil parsial.
- Reverse movement dan unknown EPC.

`node --check` untuk model/app lulus. Tidak menjalankan suite produksi karena tidak mengubah kode aplikasi/endpoint produksi.

## Browser

Diuji melalui browser bawaan Codex, pada URL public prototype di server toko :5482.

- Audit live /stock dan Move stock berhasil dilakukan read-only; tidak mengirim perpindahan inventory asli.
- Scan lima contoh menghasilkan lima EPC/varian; tag ganda tidak menambah jumlah.
- Konfirmasi membutuhkan checkbox bahwa barang sudah tiba.
- Partial posting menunjukkan 4 berhasil/1 belum pindah; saldo 21 stockroom / 12 floor / 2 return, total 35.
- Offline memblokir konfirmasi dan menampilkan alasan; draft tetap ada.
- Reconnect/retry satu tag menghasilkan 20 stockroom / 13 floor / 2 return; riwayat menunjukkan empat keberhasilan pertama dan satu retry.
- Refresh memulihkan draft lima tag tanpa mengubah saldo.
- Riwayat dan tab riset tampil; console tidak menunjukkan error/warning aplikasi saat pengujian.

| Ukuran | Hasil |
|---|---|
| Default 1280 × 720 | Lebar dokumen 1280, tanpa horizontal overflow. Tombol Tinjau akhir berada pada y 600–641, terlihat di layar meski pesan draft dipulihkan tampil. |
| Tablet 768 × 1024 | Lebar dokumen 768; workspace dan ringkasan berdampingan; navigasi menjadi tabs. |
| Ponsel 390 × 844 | Lebar dokumen 390; scan dan ringkasan ditumpuk; bar bawah berada pada y 775–844. Dialog tinjauan bisa discroll. |
| Ponsel kecil 320 × 740 | Lebar dokumen 320; label Stockroom/Shop floor terbaca setelah perbaikan ruang select; arah/jumlah/Tinjau tetap di bar bawah. |

Tabel stok dan perbandingan ERP pada ponsel memakai scroll horizontal dalam wrapper; halaman utama tidak ikut overflow. Viewport override sudah dikembalikan ke default.

Bukti PNG ada di `evidence/`: desktop-work.png, desktop-work-full.png, mobile-work-320.png, mobile-review-390.png, tablet-work-768.png. Sebagian screenshot diambil sebelum penempatan akhir tombol desktop diperbaiki; desktop-work*.png menunjukkan versi akhir.

## Batas verifikasi

Input CDP browser sesekali timeout walaupun aksi tampak berhasil, atau hanya memindahkan fokus. Setelah itu state diperiksa ulang; aksi dialog dilanjutkan dengan input keyboard yang didukung. Hasil pengujian di atas didasarkan pada state UI yang terlihat, bukan keberhasilan pengiriman input saja.

Belum menguji perangkat RFID/UHF fisik, pembaca kamera, tenant ERP lain, banyak browser/operator bersamaan, kehilangan proses saat request produksi berjalan, atau timeout dengan hasil server unknown. Simulator memakai localStorage dan data posisi lengkap contoh. Pengukuran usability staf belum dilakukan. Sumber Odoo utama hanya terbaca melalui hasil indeks resmi karena fetch halaman penuh timeout; penilaian visual ERP lain dibatasi dokumentasi.
