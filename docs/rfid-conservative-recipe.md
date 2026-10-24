# Resep RFID konservatif v1

Dipilih 23 Oktober 2026: utamakan hasil yang dapat dibaca ulang dan periksa hasilnya; kecepatan serta eksperimen ditunda. Ini kandidat produksi, dengan hasil validasi dan batasnya dicatat terpisah.

| Setelan | C5 — `c5-conservative-v1` | Kasir R3 — `r3-conservative-v1` |
|---|---|---|
| Session / target | S0 / A | S0 / A |
| TagFocus / FastID | Mati / mati | Mati / mati |
| RF link | 1, Gen2 biasa, Miller 4 / 250 kHz | 1, Gen2 biasa, Miller 4 / 250 kHz |
| Inventory | EPC-only, polling | EPC-only, polling |
| Q | Dynamic, mulai 6, min 0, max 15 | Dynamic, mulai 6, min 0, max 15 |
| Select | Target SL, action 0, Query Sel 0 (SL diabaikan) | Sama; mask juga dibersihkan pada open |
| Power yang diminta | 25 dBm, read-back harus cocok | 15 dBm, read-back harus cocok |
| Fast Inventory | Harus terbaca mati; nilai lain ditolak | Diset mati pada open |
| Jendela baca | Staf mengakhiri setelah menyapu seluruh bagian | 2.000 ms tetap |
| Jeda baca | Radio dihentikan ketika sapuan berakhir; tidak menganggap tag otomatis reset bila reader lain masih aktif | Minimal 1.000 ms dari akhir baca sebelumnya |
| RSSI floor | Tidak ditambahkan filter baru di aplikasi | Kalibrasi lokasi yang tersimpan dipertahankan; default −70 dBm adalah kandidat, bukan jaminan batas pad |
| Region | Tidak ditulis oleh resep | Tidak ditulis oleh resep |

Timing/encoding Gen2 tingkat rendah DR, M, TRext, LF tetap berasal dari blok modul setelah pemilihan link. Resep mengunci kontrol inventaris di atas; kualifikasi lintas firmware belum selesai. Kemampuan setelan diterapkan tidak membuktikan daya pancar atau kelengkapan RF di lapangan.

## Cara staf memakainya

**Handheld:** bagi rak/koli menjadi bagian yang dapat disapu menyeluruh. Sapukan perlahan dari dua sisi. Sebagai panduan awal, luangkan sekitar 10–20 detik untuk bagian kecil; bagian padat perlu lebih lama. Waktu ini panduan kerja, bukan timer kelengkapan dan tidak dipaksakan aplikasi. Dekatkan reader dan ubah sudut bila ada yang terlewat. Jangan menempelkan tag ke antena karena filter SDK C5 dapat membuang tag yang terlalu kuat. Akhiri sapuan sendiri dan periksa hasil. Angka diam tidak berarti lengkap.

**Kasir:** semua barang berada pada area pad yang ditetapkan, barang lain dijauhkan. Mulai baca, tunggu hasil, cocokkan barang dan jumlahnya sebelum melanjutkan. Jika ada selisih, susun ulang dan ulangi atau gunakan barcode sesuai alur yang ada. Baca lebih lama juga bisa menangkap barang luar; jangan mengandalkan power atau floor sebagai pagar pasti.

Tidak ada auto-finish berdasarkan dua detik tanpa tag baru, canary gating, mode Gen2X, atau penambahan Fast Inventory eksperimental. Duplikat disatukan menurut EPC; EPC harus unik per barang.

## Perilaku aplikasi

- C5 mengabaikan preferensi radio lama per HP. Override Lab berada dalam memori dan kembali ke resep pada app launch berikutnya.
- C5 memasang dan membaca balik kontrol radio; nilai tidak terbaca tidak dianggap off. Sebelum inventory, profil diperiksa lagi. Penolakan konfigurasi EPC benar-benar menggagalkan start.
- Power/link/window tidak bebas dipilih staf produksi. C5 menampilkan petunjuk menyapu; pengaturan kasir menampilkan power dan window tetap. Floor kasir tetap kalibrasi pemasangan.
- Kasir menormalkan power/window lama ke resep, menjaga floor lokasi, memasang kontrol Q/Select/session dan link, lalu memeriksa profil sebelum tiap baca. Profil yang gagal diverifikasi membatalkan permintaan dan generasi koneksi itu; permintaan berikutnya membuka ulang.
- Belum ada pernyataan bahwa band perangkat disetujui. Preset region harus dikomisioning terpisah untuk hardware/firmware yang dipakai.

## Validasi minimum sebelum dipakai staf

1. Sepuluh pembacaan terhadap 10–20 barang ber-EPC unik, susunan berbeda, cocokkan himpunan EPC.
2. Uji barang luar pad/rak sebelah dan barang di sudut area yang seharusnya masuk.
3. Cabut USB serta kill aplikasi di tengah baca, masing-masing tiga kali. Hasil salah/parsial tidak boleh diteruskan sebagai pembacaan sukses.

Ketiganya tetap perlu alat serta barang acuan. Unit test, build, dan read-back konfigurasi menguji bagian yang berbeda. R3S harus dikualifikasi terpisah sebelum disamakan dengan R3.

Rujukan: [standar dan riset produksi](research/2026-10-23-rfid-production-standard.md).
