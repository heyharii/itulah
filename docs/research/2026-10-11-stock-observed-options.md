# Inventory sederhana untuk staf gudang

11 Oktober 2026. Lanjutan proposal perpindahan stockroom → shop floor, disesuaikan permintaan tanpa scan dan satu angka per lokasi. Prototype terpisah dari `/stock` produksi.

## Opsi yang bisa dibandingkan

| Opsi | Cara membaca | Tradeoff |
| --- | --- | --- |
| [A: Ringkas](http://store.localhost:5482/prototypes/stock-observed-options.html?option=a) | Terlihat / Sistem di atas tabel, waktu dan cakupan dekat toggle, detail melalui baris/ikon | Tenang dan cepat dibaca, tetapi staf perlu mengenal ikon |
| [B: Per lokasi](http://store.localhost:5482/prototypes/stock-observed-options.html?option=b) | Waktu terbaru dan jumlah varian diperiksa di header Gudang/Floor | Konteks dekat angka; header lebih tinggi pada HP |
| [C: Status jelas](http://store.localhost:5482/prototypes/stock-observed-options.html?option=c) | Arti tampilan diterangkan, status memakai ikon dan teks | Lebih mudah bagi staf baru; perlu ruang untuk status |

Rekomendasi awal A untuk daftar sehari-hari. Jika staf belum memahami ikon, gunakan status tertulis C pada struktur A. Ini penilaian desain, bukan kesimpulan penelitian usability terukur.

## Kontrak makna

Terlihat = hasil pengecekan terakhir, bisa dari hitung manual. Sistem = saldo transaksi saat ini. Keduanya tidak boleh sama-sama disebut “stok sekarang”. Semua opsi default Terlihat sesuai permintaan, dengan waktu dan cakupan terlihat. Pindahan tidak mengisi angka Terlihat secara otomatis.

Belum diperiksa menjadi `—`, hasil cek nol menjadi `0`. Total Terlihat hanya dijumlahkan jika kedua lokasi memiliki hasil; satu lokasi unknown menghasilkan total unknown. Jika area baru diperiksa sebagian, beri status cakupan, tidak menyimpulkan selisih seluruh lokasi.

Status **Berbeda saat dicek** membandingkan Terlihat terhadap snapshot Sistem pada waktu pengecekan. **Berubah sejak dicek** menandai aktivitas sesudah pengecekan. Keduanya berbeda: stok bisa berubah karena perpindahan yang sah, tanpa pernah berbeda saat dihitung. Snapshot lama tetap perlu ditandai meski pindahan keluar lalu kembali membuat saldo sekarang sama dengan saldo lama.

Detail per produk menampilkan Terlihat saat dicek, Sistem saat dicek, Sistem sekarang, waktu, lokasi, area, dan petugas. Banyak angka hanya ada pada detail ini. Tabel utama tetap Produk, Gudang, Floor, Total, Status.

Cakupan varian yang diperiksa tidak sama dengan cakupan fisik. Contoh Cargo 4 di Gudang berasal dari Rak B saja pukul 14:10; pengecekan terakhir Gudang secara umum pukul 14:23. Timestamp per varian perlu disimpan; satu timestamp toko tidak cukup.

## Pindahan tanpa scan

Tombol Pindahkan Stok terpisah: pilih Gudang → Floor / Floor → Gudang, pilih produk dengan mengisi jumlah, periksa perubahan saldo, pastikan barang sudah dipindahkan, catat. Batas jumlah mengikuti Sistem lokasi asal; nilai Terlihat lama bukan saldo yang dipakai untuk posting. Prototype memvalidasi seluruh pilihan sebelum mengubah saldo contoh.

Dasar riset ERP sebelumnya: [ERPNext Stock Entry](https://docs.frappe.io/erpnext/stock-entry) mendukung pemilihan item, quantity, source warehouse, dan target warehouse sehingga sesuai untuk alur manual. [Dynamics 365 replenishment](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/replenishment) membantu memberi konteks replenishment antar lokasi. Toggle Terlihat/Sistem dan tiga layout di sini adalah usulan untuk kebutuhan toko ini; tidak diklaim sebagai fitur yang sama pada ERP tersebut.

## Batas implementasi

Prototype lokal dengan data simulasi di memori, tanpa API dan tanpa perubahan pada halaman stock produksi. Backend saat ini memakai identitas EPC pada perpindahan. Implementasi quantity-only membutuhkan kontrak transaksi/identitas yang jelas, bukan memilih EPC sembarang. Tampilan Observed membutuhkan penyimpanan observation per SKU/lokasi, scope, timestamp, pemeriksa, snapshot Sistem waktu cek, dan informasi pergerakan sejak cek. Jangan mengarang snapshot historis bila backend belum memilikinya: tampilkan tidak tersedia dan hindari menyimpulkan selisih historis.

Validasi teknis tercatat di `prototypes/stock-observed-options/QA.md`. Belum ada uji staf gudang atau integrasi data produksi.
