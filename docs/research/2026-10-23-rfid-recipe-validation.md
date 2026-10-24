# Validasi resep konservatif v1 — 23 Oktober 2026

**Status: kandidat sudah diimplementasikan; konfigurasi C5 terverifikasi pada alat asli. Kelengkapan RF dan R3 pada Windows belum terverifikasi.**

Resep dan petunjuk staf: [RFID konservatif v1](../rfid-conservative-recipe.md).

| Pemeriksaan | Hasil |
|---|---|
| Android unit test | 67 lulus, 0 gagal, 0 dilewati |
| APK debug terpisah | Build berhasil, package `id.itulah.pindai.validation` |
| Kompilasi Kotlin release | Berhasil; ini bukan verifikasi signing/distribusi APK produksi |
| Rust, crate POS asli pada Mac ARM64 | 23 lulus, 0 gagal |
| Typecheck dan build UI POS | Berhasil |
| Format Rust pada file yang disentuh + `git diff --check` | Lulus |
| Build/installer Windows dan DLL runtime | Belum dijalankan; test pada Mac tidak mengompilasi modul Windows |
| Scan barang acuan, barang luar, crash/unplug saat RF | Belum dijalankan pada kandidat ini |

Unit test tambahan meliputi migrasi preferensi radio lama, penolakan perubahan melalui setter produksi, reset override Lab, getter negatif yang tidak boleh dianggap off, nilai Q/Select/session yang tertinggal, normalisasi window kasir 500 → 2000 ms, serta pemeliharaan/validasi floor lokasi.

## C5 asli: read-back tanpa inventory

Menggunakan C5 yang terhubung melalui adb. App uji mempunyai package dan data sendiri, tanpa konfigurasi node/device key; app DC dan toko tidak diperbarui. Tidak ada perintah memulai inventory atau penerbitan evidence stok selama validasi ini.

Tiga pemeriksaan lulus:

1. Membuka APK kandidat final dan memeriksa resep pada modul.
2. Force-stop, memasukkan preferensi lama **ke app uji saja** (`reader_power=30`, `tag_focus=true`, `gen2_session=2`, `rf_link=14`), lalu membuka ulang dan memeriksa resep.
3. Force-stop dan membuka ulang lagi, kemudian memeriksa resep.

Ketiganya membaca balik:

```text
c5-conservative-v1
power=25, link=1, TagFocus=0, FastID=0, FastInventory=0
Select target=4, action=0, truncate=0
Q=dynamic, start=6, min=0, max=15
Query Sel=0, session=0, target=0
region=8 (tidak diubah)
```

Region masih USA/0x08. Karena band perangkat belum dikomisioning untuk penggunaan kita, pengujian berhenti pada konfigurasi/read-back; **hasil ini tidak membuktikan semua barang terbaca, daya pancar aktual benar, atau perangkat siap dipakai produksi di Indonesia**. Angka 25 dBm adalah nilai yang diminta dan dibaca balik, bukan pengukuran RF.

Log tiga run, XML preferensi uji, hash APK, dan manifest validasi berada di `output/rfid-recipe-validation-2026-10-23/`. App uji dibersihkan setelah pemeriksaan; tidak mengganti app operasional. Cache kompilasi Rust debug dibersihkan setelah tes karena disk hampir penuh; file sumber dan APK tidak dihapus.

## Yang tersisa agar bisa dipakai staf

1. Konfirmasikan band/kanal/power yang disetujui untuk unit dan firmware, lalu lakukan uji singkat barang acuan pada band itu.
2. Build kandidat R3 pada Windows dan jalankan tiga pemeriksaan sederhana pada [resep](../rfid-conservative-recipe.md): daftar EPC acuan, barang luar pad, dan pemulihan crash/unplug.
3. Gunakan satu kasir dulu dengan konfirmasi staf. Selesaikan signing/versioning rilis sebelum distribusi armada; tidak ada commit, push, atau deploy dalam pekerjaan ini.
