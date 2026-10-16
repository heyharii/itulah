# Stok toko: dua alur sederhana

Hasil siap dibuka: `../../store-stock-simple-prototype.html`.
Kedua tab berbagi data dalam halaman yang sama. Data contoh disimpan di browser; bukan integrasi backend atau RFID.

- **Pindahkan barang:** pilih tujuan, isi jumlah pindahan per varian, periksa ringkasan, simpan setelah barang dipindahkan. Jumlah dibatasi stok asal. Perpindahan bisa dibatalkan.
- **Cek stok fisik:** pilih lokasi, lihat jumlah/waktu/petugas pengecekan terakhir, lalu masukkan hasil hitung baru. Kosong berarti belum dihitung; angka 0 adalah hasil hitung yang sah. Menyimpan hasil hitung tidak mengubah stok tercatat.
- **Perlu cek ulang:** barang pernah dicek, tetapi ada perpindahan pada barang dan lokasi tersebut setelah pengecekan. Angka hasil hitung lama tetap terlihat, tanpa dianggap sebagai kondisi terbaru.
- **Riwayat:** menyimpan aktivitas baru dalam demo. Contoh hasil hitung awal tetap terlihat pada kartu barang.

Tombol **Ulangi demo** mengembalikan data awal. Tersedia 12 varian dari 4 barang.

Ubah file sumber dalam folder ini lalu jalankan `python3 prototypes/stock-simple/build.py` dari root repositori untuk memperbarui HTML mandiri.

Untuk pratinjau HTTP, jalankan `python3 -m http.server 8833 --bind 127.0.0.1 --directory prototypes/stock-simple`, lalu buka `/movement.html` atau `/check.html`.
