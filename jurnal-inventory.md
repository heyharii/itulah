# Inventaris antarmuka Mekari Jurnal

**Status:** diperbarui 1 Oktober 2026; inventaris UI yang terlihat sudah dicatat secara luas. Kolom yang hanya muncul saat ada baris, tindakan edit/hapus pada record, serta alur yang memerlukan transaksi atau akses khusus tetap ditandai belum terverifikasi.  
**Cakupan:** nama menu, tampilan daftar/laporan, kolom, filter, input, dan aksi yang terlihat. Pemeriksaan ini tidak menyimpan atau menghapus record/transaksi. Nilai transaksi, nama kontak, identitas perusahaan, dan data bisnis tidak dicatat.
**Tujuan prototipe:** gunakan inventaris ini sebagai spesifikasi untuk membangun ulang antarmuka dari nol; data tenant tidak dijadikan contoh.

## Pola shell dan tampilan yang teramati

- Header global: banner trial kuning di paling atas; baris aplikasi dengan logo, tombol utilitas, dan menu profil. Rail navigasi utama memakai ikon vertikal di sisi kiri.
- Area kerja menggunakan latar netral terang, teks abu gelap, garis pembatas tipis, dan tombol utama biru/indigo. Halaman laporan memakai tab kategori horizontal dan kartu dua kolom dengan judul, ringkasan, serta tombol **Lihat laporan**.
- Halaman Produk memakai tab **Barang & jasa / Gudang / Aturan harga**, ringkasan stok berbentuk kartu, tab daftar di bawahnya, lalu pencarian/aksi di atas area tabel. Daftar kosong menampilkan empty state dan CTA ketika tersedia.
- Form panjang dibagi menjadi bagian bernomor/berjudul atau tabel bidang. Aksi formulir seperti Batalkan dan Simpan berada pada baris tombol bawah; beberapa form mengunci aksi bawah ke viewport saat halaman digulir.
- Detail visual ini kualitatif dari halaman yang sempat dibuka; ukuran tepat, font, token warna, hover/focus, dan perilaku responsif belum diukur.

## Navigasi utama yang terlihat

- Beranda
- Dasbor
- Laporan
- Anggaran
- Kas & bank
- Penjualan
- Pembelian
- Biaya
- Mekari Pay
- Kontak
- Produk
- Produksi (ditandai Baru)
- Pemenuhan
- Aset
- Daftar akun
- Konsolidasi
- Aplikasi
- Daftar lainnya
- Integrasi
- Custom solution
- Pengaturan

## Laporan

Tab yang terlihat pada katalog: Sekilas bisnis, Penjualan, Pembelian, Produk, Aset, Bank, Pajak, Produksi. Label Pertukaran kurs dan Jurnal insight muncul di elemen tersembunyi pada DOM tetapi tidak tampil sebagai tab yang dapat dipilih pada pemeriksaan terakhir; belum terverifikasi sebagai menu yang bisa dibuka.

### Sekilas bisnis

Kartu laporan dan aksi **Lihat laporan**:

- Neraca
- Buku besar
- Laba rugi
- Jurnal
- Arus kas
- Neraca saldo
- Perubahan modal
- Ringkasan bisnis
- Anggaran laba rugi
- Manajemen anggaran

Filter tidak terlihat pada halaman katalog ini; parameter pada halaman detail dirangkum di bagian khusus di bawah.

### Penjualan

- Daftar penjualan — daftar kronologis transaksi per tipe; template dapat dicustom.
- Penjualan per pelanggan — transaksi per pelanggan.
- Piutang pelanggan — faktur belum dibayar dan saldo memo kredit pada tanggal tertentu.
- Usia piutang — piutang per pelanggan menurut kelompok umur 30/60/90/>90 hari.
- Pengiriman penjualan — produk yang dikirim untuk transaksi penjualan.
- Penjualan per produk — kuantitas terjual/retur, penjualan bersih, harga jual rata-rata.
- Penyelesaian pesanan penjualan — kemajuan penawaran/pesanan sampai penagihan dan pembayaran.
- Profitabilitas produk — keuntungan produk terjual.
- Daftar faktur proforma — faktur proforma dalam periode.
- Daftar tukar faktur — tukar faktur dalam periode.

### Pembelian

- Daftar pembelian — transaksi kronologis per tipe; template dapat dicustom.
- Pembelian per supplier — transaksi per supplier.
- Utang supplier — faktur belum dibayar dan saldo memo debit pada tanggal tertentu.
- Daftar pengeluaran — transaksi pengeluaran.
- Detail pengeluaran — transaksi pengeluaran per akun.
- Usia utang — saldo utang per supplier menurut kelompok umur 30/60/90/>90 hari.
- Pengiriman pembelian — produk yang dikirim untuk transaksi pembelian.
- Pembelian per produk — kuantitas beli/retur, pembelian bersih, harga beli rata-rata.
- Penyelesaian pesanan pembelian — kemajuan penawaran/pesanan sampai penagihan dan pembayaran.

### Produk

- Tingkat pemenuhan pesanan (Baru) — persentase order yang dapat dipenuhi dari stok.
- Perputaran persediaan barang (Baru) — rasio frekuensi barang terjual dan diisi ulang.
- Konversi produk — daftar konversi, bahan baku, HPP; aksi Ekspor laporan.
- Ringkasan persediaan barang — stok tersedia, harga rata-rata unit, total nilai pada tanggal tertentu.
- Kuantitas stok gudang — kuantitas produk per gudang pada tanggal tertentu.
- Nilai persediaan barang — mutasi stok per produk dan nilainya dalam periode.
- Nilai stok gudang — nilai persediaan per gudang.
- Detail persediaan barang — produk, mutasi, kuantitas akhir.
- Pergerakan barang gudang — pergerakan stok per gudang.
- Kuantitas produk dengan nomor seri (Baru) — kuantitas tersedia dan stok gudang produk berseri.
- Gudang berisi produk bernomor seri (Baru) — gudang, kuantitas tersedia, stok produk berseri.

### Aset, Bank, Pajak, Produksi

- **Aset:** Ringkasan aset tetap (akuisisi, biaya awal, akun penyusutan, nilai buku); Detail aset tetap (nilai buku per periode); Penjualan atau pelepasan aset (aset dijual/dilepas per periode).
- **Bank:** Ringkasan rekonsiliasi bank (saldo terekonsiliasi dan transaksi belum rekonsiliasi); Mutasi rekening koran (rekening koran, status rekonsiliasi, sumber per periode).
- **Pajak:** Pajak pemotongan (DPP, tarif, jumlah pajak pemotongan); Pajak penjualan (DPP, tarif, jumlah PPN).
- **Produksi:** Penyusunan produksi (laporan CSV, bahan baku, HPP); Pemisahan produksi (laporan CSV, bahan baku, HPP); Harga pokok produksi/COGM (laporan CSV, biaya komponen, tenaga kerja, overhead, dll.). Tombol yang terlihat: Ekspor laporan.

Halaman detail laporan dibuka untuk membaca kontrol parameter. Pada beberapa laporan, Filter baca-saja dijalankan agar header hasil terlihat; nilai baris, saldo, dan angka bisnis tidak dicatat. Untuk laporan yang tidak menampilkan header, struktur hasil tetap belum dapat dipastikan.

## Kas & bank

- Aksi tingkat halaman: **Beri masukan**, **Peraturan rekonsiliasi**, **Buat akun/transaksi**.
- Ringkasan: Pemasukan 30 hari mendatang, Pengeluaran 30 hari mendatang, Saldo kas & bank, Saldo kartu kredit.
- Filter/toggle: checkbox **Tampilkan akun yang diarsipkan**.
- Tabel akun menampilkan kolom Kode akun, Nama akun, Saldo bank, Saldo di Jurnal, serta kolom tindakan.
- Aksi per akun yang terlihat: Hubungkan ke bank, Impor rekening koran, dan menu tindakan. Menu tindakan per akun membuka Transfer uang, Terima uang, Kirim uang. Menu utama Buat akun/transaksi memiliki Buat akun baru dan pintasan ke tiga form transaksi tersebut.
- Belum membuka formulir, detail akun, atau transaksi.

## Penjualan

- Aksi halaman: **Impor**; dropdown **Buat penjualan baru** berisi Penagihan Penjualan, Tukar Faktur, Pemesanan Penjualan, Penawaran Penjualan.
- Tab daftar: Penagihan, Pengiriman, Pesanan, Penawaran, Membutuhkan persetujuan, Ditolak.
- Filter/input yang tampak: tipe dokumen, Semua status, Pencarian (sebagian tab hanya menampilkan pencarian). Daftar kosong; kolom tabel tidak muncul pada sesi ini.
- Ringkasan atas halaman: status penagihan belum dibayar/terlambat dan pelunasan diterima 30 hari terakhir.
- Tab Ditolak menampilkan empty state; tidak ada transaksi yang ditolak. Tab lain kosong atau memuat data; tidak ada transaksi dibuka.

### Form Penagihan Penjualan (dibuka, tidak diisi atau disimpan)

- Input utama: Pelanggan (wajib), Email, Alamat penagihan, Tgl. transaksi, Tgl. jatuh tempo, Syarat pembayaran, No Transaksi, No. referensi pelanggan, Gudang, Tag.
- Checkbox **Harga termasuk pajak**.
- Tabel baris produk: Produk, Deskripsi, Kuantitas, Unit, Harga satuan, Diskon, Pajak, Jumlah; input baris produk tersedia.
- Input tambahan: Pesan, Memo, Lampiran (Choose file/drag-drop; dibatasi maksimum 5 file dan 10 MB per file), diskon (angka dan pilihan %), Pemotongan.
- Ringkasan: Subtotal, Diskon per baris, Diskon, Total, Sisa tagihan.
- Aksi: Batalkan, Buat, Buat dan bagikan. Tombol buat/bagikan nonaktif sebelum data wajib dilengkapi.
- Form hanya diperiksa label/struktur; tidak ada pelanggan/produk dipilih, file diunggah, atau data diisi.

## Pembelian

- Aksi: **Impor**; dropdown **Buat pembelian baru** berisi Faktur pembelian, Tukar pembelian, Pemesanan pembelian, Penawaran pembelian, Permintaan pembelian.
- Tab: Faktur, Tukar faktur, Pengiriman, Pesanan, Penawaran, Permintaan, Membutuhkan persetujuan, Ditolak.
- Filter dasar: jenis dokumen, Semua status, Cari transaksi, Filter lanjutan. Dropdown status faktur: Semua status, Menunggu pembayaran, Telat bayar, Dibayar, Dibayar sebagian, Belum dibayar. Pengiriman/pesanan/penawaran/permintaan memiliki status sesuai tahap proses.
- Filter lanjutan Faktur: Kata kunci, Opsi kolom, rentang Tgl. transaksi, rentang Tgl. jatuh tempo, Status; Sisa tagihan dan Total masing-masing punya operator Lebih dari/Di antara/Kurang dari; Tag tambahan dan pilihan Semua tag/Salah satu. Aksi Atur ulang, Batalkan, Terapkan.
- Tidak ada faktur/transaksi yang ditampilkan; kolom tabel belum tersedia.

### Form Faktur Pembelian (dibuka, tidak diisi atau disimpan)

- Input: Supplier (wajib), Email, Alamat penagihan, Tgl. transaksi, Tgl. jatuh tempo, Syarat pembayaran, No Transaksi, Nomor referensi supplier, Gudang, Tag.
- Checkbox Harga termasuk pajak.
- Tabel baris: Produk, Deskripsi, Kuantitas, Unit, Harga satuan, Pajak, Jumlah.
- Input tambahan: Pesan, Memo, Lampiran (pilih/drag-drop; maksimum 5 file, 10 MB per file), Pemotongan.
- Ringkasan: Subtotal, Total, Sisa tagihan.
- Aksi: Batalkan, Buat, Simpan & bayar dengan Mekari Pay. Tombol buat/bayar nonaktif sebelum data diisi.
- Tidak ada supplier/produk dipilih dan tidak ada nilai yang diubah.

## Biaya / Pengeluaran

- Aksi halaman: Buat Biaya Baru, Impor. Ringkasan biaya bulan ini, 30 hari terakhir, dan belum dibayar.
- Tab: Biaya, Membutuhkan Persetujuan. Pencarian.
- Kolom tabel: Tanggal, Nomor, Kategori, Penerima, Status, Sisa Tagihan (dalam IDR), Total (dalam IDR), Tags, Tindakan; ada checkbox pilihan baris. Label umum aksi per baris tidak muncul pada pemeriksaan daftar.

### Form Buat Biaya (dibuka, tidak diisi atau disimpan)

- Input/kontrol: Bayar Dari, checkbox Bayar Nanti, Penerima, Alamat Penagihan, Tgl Transaksi, Cara Pembayaran, No Biaya (otomatis), Tag, Harga termasuk pajak.
- Tabel biaya: Akun Biaya, Deskripsi, Pajak, Jumlah; tambah/hapus baris.
- Ringkasan: SubTotal, Total, Masukan Jumlah Pemotongan, Memo, Lampiran (maksimum 10 MB per file).
- Aksi: Batal, Buat Biaya Baru. Form ditinggalkan tanpa mengubah atau menyimpan data.

## Kontak

- Tab: Pelanggan, Supplier, Karyawan, Lainnya, Semua.
- Aksi daftar: Buat kontak, Atur grup kontak, Impor, Ekspor, Cari kontak, Filter.
- Filter: Kata kunci, Grup, Nomor telepon, Email, Tampilkan kontak yang diarsipkan; Atur ulang/Batal/Terapkan.
- Ringkasan yang disediakan: Piutang belum dibayar, Piutang jatuh tempo, Kredit memo. Tidak ada kontak/kolom tabel saat diperiksa.

### Form Buat Kontak (dibuka, tidak disimpan)

- Info kontak: Nama Tampilan (wajib), Tipe kontak (Pelanggan/Supplier/Karyawan/Lainnya), Grup Kontak (maksimum 3).
- Info umum: Nama lengkap (Panggilan, Nama awal, Nama tengah, Nama akhir), Identitas, Nomor identitas, Email (dapat lebih dari satu), Nama Perusahaan, Nomor handphone, Nomor telepon, Fax, Alamat penagihan, Tambah rincian, Alamat pengiriman, Sama dengan alamat penagihan, Info lainnya.
- Info perpajakan: Warga Negara Indonesia/Warga Negara Asing, NPWP/NIK, NITKU.
- Info bank: Nama bank, Cabang bank, Pemegang akun bank, Nomor rekening, Tambah bank lainnya.
- Pemetaan akun: Akun piutang, Akun hutang, Syarat pembayaran utama.
- Aksi: Batalkan, Simpan. Form kosong tidak disimpan; dialog tinggalkan form muncul saat dibatalkan.

## Produk

- Tab utama: Barang & jasa, Gudang, Aturan harga.
- Barang & jasa: Daftar produk, Daftar penyesuaian stok, Membutuhkan persetujuan. Aksi Atur kategori produk, Impor, Ekspor, Cari produk, Filter.
- Filter produk: Kata kunci, Tipe produk, Kategori produk, Mencakup semua/Salah satu, Tampilkan arsip; Reset filter/Terapkan.
- Tab Gudang: Daftar gudang, Daftar transfer gudang, Membutuhkan persetujuan; Tampilkan gudang tidak aktif, Impor, Cari gudang.
- Aturan harga: Pencarian; daftar aturan harga kosong saat diperiksa.
- Menu Tindakan: Tambah produk baru, Tambah gudang baru, Sesuaikan stok (stock opname), Transfer gudang, Buat aturan harga baru.

### Form Tambah Produk (dibuka, tidak disimpan)

- Input: Nama produk (wajib), Kode produk/SKU, Barcode, Unit (wajib), Kategori produk, Deskripsi, Gambar produk (JPG/PNG maks. 5 MB), Tipe produk (wajib).
- Harga & persediaan: checkbox Saya beli produk ini dan Saya jual produk ini. Tabel pembelian: Harga beli satuan, Akun pembelian, Pajak beli. Tabel penjualan: Harga jual satuan, Akun penjualan, Pajak jual.
- Aksi: Batalkan, Simpan. Tidak ada nilai produk diisi atau disimpan.

### Form Buat Aturan Harga (dibuka, tidak disimpan)

- Informasi aturan: Nama aturan, Periode aturan (rentang tanggal), Tipe aturan, nilai diskon persentase.
- Penerima/produk: Cari kontak, Tambah kontak; Cari produk, Tambah produk. Keduanya kosong saat diperiksa.
- Aksi: Batalkan, Simpan. Tidak ada aturan harga dibuat.

## Aset tetap

- Tab: Aset Tertunda, Aset Aktif, Dijual/Dilepas, Penyusutan.
- Aksi: Impor, Simpan Aset; pencarian.
- Kolom Aset Tertunda: Tanggal Akuisisi, Barang, Faktur #, Biaya Akuisisi, Action.
- Kolom Aset Aktif: Tanggal Akuisisi, Detail Aset, Akun Aset, Biaya Akuisisi, Nilai Buku, Action.
- Kolom Dijual/Dilepas: Tanggal, Detail Aset, No Transaksi, Harga Jual, Untung/(Rugi), Action.
- Kolom Penyusutan: Detail Aset, Periode, Nilai, Metode, Penyusutan, kolom tindakan.
- Semua tab kosong ketika diperiksa.

### Form Penyimpanan Aset Baru (dibuka, tidak disimpan)

- Detail aset: Nama Aset (wajib), Nomor Aset (wajib), Akun Aset Tetap (wajib), Deskripsi, Tanggal Akuisisi, Biaya Akuisisi, Akun Dikreditkan, Tags.
- Penyusutan: checkbox Aset non-depresiasi; Metode, Masa Manfaat, Nilai/Tahun, Akun Penyusutan, Akumulasi Akun Penyusutan, Akumulasi Penyusutan, Pada Tanggal. Beberapa kolom dinonaktifkan pada keadaan awal.
- Aksi: Batal, Buat Aset. Tidak ada aset dibuat.

## Anggaran

- Halaman ringkasan kosong dengan aksi Buat anggaran.
- Form Rincian anggaran: tahun/periode, pilihan rentang 1/2/3/4/6/8/12/24 bulan, periode pembanding 3/6/12 periode sebelumnya, Tampilkan, Anggaran dimulai pada, Anggaran hingga, Memo.
- Tabel input anggaran: Akun, pembanding, kolom bulanan, Total. Aksi Simpan, Batalkan, Simpan perubahan.
- Form tidak diisi; tidak ada anggaran dibuat.

## Daftar akun

- Aksi tingkat halaman: Buat Jurnal Umum, Buat Akun Baru, Tampilkan Arsip Akun (checkbox nonaktif pada keadaan yang terlihat), Tindakan, kontrol tampilan, pencarian/ekspor.
- Kolom: Kunci, Kode Akun, Nama Akun, Kategori Akun, Pengguna, Pajak, Saldo (dalam IDR); ada checkbox pilihan baris.
- Form Akun Baru: Nama akun (wajib), Kode akun, Kategori akun, checkbox Buat akun ini bagian dari akun lain, Pajak, Deskripsi; akses akun dengan pilihan Semua pengguna/Sebagian pengguna/Peran tertentu. Aksi Batalkan/Simpan.
- Form Jurnal Umum: No Transaksi otomatis, Tgl Transaksi, Tag; tabel Akun, Deskripsi, Debit, Kredit; tambah/hapus baris; Total Debit/Kredit, Memo, Lampiran (maks. 10 MB per file). Aksi Batal, Buat Jurnal Umum, dropdown tindakan tambahan.
- Form akun/jurnal umum hanya dilihat; tidak ada akun atau jurnal yang dibuat. Nilai dan isi baris akun tidak dicatat.

## Produksi

- Halaman menyediakan Atur akun biaya & biaya standar, Tindakan, checkbox Tampilkan BOM diarsipkan, pencarian.
- Tab: Daftar bill of material (BOM), Daftar perintah kerja.
- Kolom BOM: Nama BOM, Kode BOM, Kategori, Acuan perhitungan biaya, Produk, Keterangan, kolom tindakan.
- Menu Tindakan: Buat bill of material, Buat perintah kerja.
- Filter perintah kerja: Semua tipe (Penyusunan/Pemisahan), Semua status (Belum dimulai, Sedang berlangsung, Diproduksi sebagian, Selesai sebagian, Selesai, Dibatalkan), Cari. Filter lanjutan: Kata kunci, Tipe perintah kerja, Status perintah kerja, Tanggal mulai, Tanggal akhir; Reset filter/Terapkan.
- Daftar perintah kerja kosong saat diperiksa; kolom belum muncul.

### Form BOM (dibuka, tidak disimpan)

- Informasi dasar: Nama BOM (wajib), Kode BOM otomatis, Kategori (wajib), Acuan perhitungan biaya (wajib), Keterangan, unggah berkas; toggle penyesuaian BOM.
- Mode biaya yang tersedia: Standar/Custom; biaya aktual/biaya standar.
- Bagian/tabel: Komponen produk (Nama produk, Kode produk/SKU, Qty dibutuhkan, Unit, Harga beli satuan, Perkiraan harga); Biaya produksi (tenaga kerja, overhead, lainnya; Pemicu biaya/Jumlah); Perutean (Proses, Keterangan, Pemetaan akun, Biaya perutean); Hasil utama/hasil lainnya (Nama produk, Kode produk/SKU, Qty, Unit, Persentase, Harga); Pemborosan produksi (Pemetaan akun, Metode alokasi, Persentase, Jumlah).
- Aksi: Batalkan, Simpan, Simpan & buat lainnya, Simpan sebagai draf. Form kosong dibatalkan.

### Form Perintah Kerja (dibuka, tidak disimpan)

- Input: No. perintah kerja (wajib), Kategori (wajib), Tipe perintah kerja (wajib), Lacak perutean (Ya/Tidak), Nama BOM (wajib), No. BOM, Tanggal rencana produksi (rentang), Qty diproduksi, Lampiran PDF (maks. 3 file, 10 MB per file), Buat sebagai sub-rakitan (nonaktif pada keadaan awal).
- Bagian tabel: Komponen produk (Nama produk, Nama produk/SKU, Harga beli satuan, Nama gudang, Stok di gudang, Qty dibutuhkan, Unit, Perkiraan harga); Perutean (Proses, Keterangan, Pemetaan akun, Tanggal rencana pengerjaan, Biaya perutean); Hasil utama (Nama produk, Kode produk/SKU, Nama gudang, Qty diproduksi, Unit, Persentase, Perkiraan harga).
- Aksi Batalkan/Simpan; Simpan nonaktif sebelum input wajib tersedia. Tidak ada perintah kerja dibuat.

## Beranda, Dasbor, Mekari Pay, Pemenuhan

- **Beranda:** halaman awal dan kartu pelatihan; tidak ada tabel/form transaksi terlihat.
- **Dasbor:** tab Performa bisnis dan Mekari Insight; tidak ada tabel/form input pada tampilan ringkas yang diperiksa.
- **Mekari Pay:** membuka halaman add-on yang menampilkan pesan sesi berakhir; tidak melakukan login ulang atau pembayaran.
- **Pemenuhan Penjualan:** filter status, rentang tanggal (7/14/30 hari atau semua), muat ulang, cari transaksi; daftar kosong/tanpa header kolom saat diperiksa.
- **Pemenuhan Pembelian:** filter Semua gudang, rentang tanggal, muat ulang, cari; daftar kosong/tanpa header kolom saat diperiksa. Navigasi menyediakan link antara Pemenuhan Penjualan dan Pemenuhan Pembelian.

## Daftar lainnya

Katalog berisi kategori tag, jadwal berulang, daftar transaksi, kunci periode/tutup buku, kategori produk, lampiran, cara pembayaran, pajak, unit, syarat pembayaran, audit, riwayat impor/ekspor, log penghitungan ulang nilai persediaan, dan data migrasi.

### Daftar dan kontrol yang terlihat

- **Kategori Tag:** bagian Kategori default, Belum di-assign, Arsip, dan Kategori custom; pencarian `Cari kategori atau tag...`; aksi Buat tag. Header tabel tidak terlihat.
- **Jadwal Berulang:** filter Jenis Transaksi (Semua atau Sales Invoice, Purchase Invoice, Sales Order, Purchase Order, Expense, Bank Deposit, Bank Transfer, Bank Withdrawal, Journal Entry, Receive Payment, Purchase Payment), rentang tanggal (dua input tanggal), checkbox Tampilkan jadwal yang sudah berakhir, dan Cari. Kolom Nama, Jenis Transaksi, Diulang Setiap, Tanggal Transaksi Berikutnya, Berakhir. Aksi Buat baru membuka langkah Atur Berulang dengan pilihan tipe transaksi yang sama; Next untuk tipe Sales Invoice membuka formulir faktur penjualan kosong. Tidak ada input interval, frekuensi, atau tanggal akhir pada langkah Atur Berulang maupun formulir kosong yang terbuka. Belum dapat dipastikan apakah kontrol itu baru muncul setelah data transaksi dilengkapi. Tidak memilih pelanggan/produk, mengisi form, atau membuat jadwal; formulir dibatalkan dan aplikasi kembali ke daftar penjualan.
- **Daftar Transaksi:** kolom Tanggal, Nomor, Memo, Kontak, Tgl Jatuh Tempo, Status, Sisa Tagihan (dalam IDR), Total (dalam IDR), Tags. Filter status dan jenis transaksi serta Filter lebih lanjut. Status yang terlihat mencakup draf, menunggu/disetujui/ditolak, belum dibayar, terbayar sebagian/lunas/terlambat, terkirim sebagian, tidak digunakan, batal, dan dibatalkan. Jenis mencakup faktur/pesanan/penawaran penjualan dan pembelian, penerimaan/pembayaran, biaya, terima/kirim uang, transfer bank, dan jurnal umum. Daftar tidak dibuka sampai ke detail transaksi.
- **Daftar Pengeluaran (laporan):** tanggal mulai/selesai, Filter sesuai periode, Filter, Filter lebih lanjut, Ekspor (PDF/XLS/CSV). Kolom Tanggal, Nomor, Kategori, Deskripsi, Supplier, Jumlah. Filter lanjutan: rentang tanggal/periode, supplier, Grup dengan Tag, logika Mencakup Semua/Salah Satu, urutkan sesuai kolom (nilai awal Tanggal), Urutan Naik/Turun, Perlihatkan Lebih Detail; aksi Batalkan/Filter. Empty state mengatakan belum ada transaksi biaya; panel ditutup dan ekspor tidak dijalankan.
- **Rincian Pengeluaran (laporan):** Tanggal Mulai, Tanggal Selesai, Filter sesuai periode, Filter, Ekspor PDF/XLS/CSV. Kolom Kategori/Tanggal, Transaksi, Nomor, Keterangan, Jumlah. Empty state menyatakan belum ada transaksi biaya; tidak ada filter lanjutan atau data baris yang muncul.
- **Kunci Periode & Tutup Buku:** halaman daftar tidak menampilkan header. Menu Buat baru menjelaskan kegunaan kunci periode/tutup buku dan menampilkan aksi Kunci periode serta Tutup buku. Petunjuk langkah: pilih periode, cek rekonsiliasi, periksa kertas kerja, tinjau laporan keuangan. Aksi langsung Mulai kunci periode dan Mulai tutup buku juga terlihat pada halaman. Tidak ada wizard dimulai atau periode dikunci/ditutup.
- **Kategori Produk:** aksi Tambah kategori; header tabel tidak tampil.
- **Lampiran:** kolom Nama, Transaksi, Tipe Transaksi, Waktu Pembuatan, Tindakan; pencarian; aksi Tambah Berkas. Form tambah berkas memperlihatkan Upload File (kontrol multi-file), Transaction Type (pilihan: Faktur/Pesanan/Penawaran Penjualan, Terima Bayaran, Pembayaran Pesanan Penjualan, Retur Penjualan, Faktur/Pesanan/Penawaran Pembelian, Pembayaran Pembelian, Pembayaran Pesanan Pembelian, Retur Pembelian, Biaya, Setoran Bank, Transfer Bank, Tarikan Bank, Kredit Memo, Pembayaran Kredit Memo, Refund Credit Memo, Jurnal Umum, Transfer Gudang), tombol + Tambah Berkas, Simpan, dan Batal. Opsi tipe dapat dibuka tanpa memilih. Menu tindakan yang terdeteksi: Ubah Tipe Transaksi, Hubungkan ke Transaksi, Buat Transaksi Baru, dan Hapus Lampiran. Form dibatalkan; tidak ada file diunggah, transaksi dipilih/dihubungkan, atau lampiran dihapus.
- **Cara Pembayaran:** kolom Nama dan Tindakan; pencarian `Ketik untuk mencari...`; aksi Buat Cara Pembayaran Baru. Form kosong yang dibuka hanya memperlihatkan input Nama dan aksi Batalkan/Buat Cara Pembayaran; dibatalkan tanpa simpan.
- **Pajak:** kolom Nama, Persentase Efektif, Akun Pajak Penjualan, Akun Pajak Pembelian; pencarian `Pencarian...`; ada checkbox pilihan baris dan aksi Buat Pajak Baru. Struktur form kosong dirangkum di bawah.
- **Unit:** kolom Unit dan pencarian `Cari unit`; form tambah dibuka, tetapi nama/fungsi dua checkbox dan kontrol teks tambahan tidak tampil sebagai label.
- **Syarat Pembayaran:** kolom Nama, Jangka Waktu, Tindakan; aksi Buat Syarat Pembayaran Baru. Struktur form kosong dirangkum di bawah.
- **Daftar Audit:** kolom Tanggal, Tindakan, Tipe, Nomor, Pengguna, Detil; filter tanggal mulai/akhir (DD/MM/YYYY) dan beberapa filter pilihan. Isi baris audit tidak dibaca.
- **Impor & Ekspor:** tab Impor/Ekspor; filter jenis berkas, status, rentang tanggal, pencarian berkas; aksi Impor, Ekspor, muat ulang halaman, Hubungi tim support, dan Filter. Jenis berkas yang terlihat mencakup akun, aset, biaya, bill of material, faktur pembelian, gudang, jurnal umum, kontak, dan lainnya. Status mencakup antrean, proses, selesai, gagal, sebagian, dan menunggu dihapus. Kedua tab menampilkan empty state “Belum ada file”; ekspor memiliki input tanggal, sedangkan impor memiliki input tanggal dan pencarian file. Tidak ada file impor/ekspor atau proses yang dijalankan; dialog pemilihan/unggah berkas tidak dibuka.
- **Penghitungan ulang nilai persediaan:** tab Log; kolom Tanggal penghitungan, Diperbarui oleh, Transaksi pemicu, Tanggal transaksi pemicu, Status. Tidak ada kalkulasi yang dijalankan.
- **Data Migrasi:** layar awal Migration Center menampilkan bagian Pengaturan Perusahaan, Master Data, dan Transaksi; urutan yang ditawarkan: isi data perusahaan, atur daftar akun dan saldo awal, impor produk, impor kontak, lalu impor penjualan/pembelian/biaya. Tombol Mulai Sekarang dan Lihat Rangkuman (nonaktif sebelum ada data); wizard tidak dimulai dan tidak ada berkas diunggah.

### Pengaturan perusahaan

Halaman Pengaturan memperlihatkan bagian Info perusahaan, Info akun bank, Info lainnya, dan Pengaturan fitur tambahan; tautan ke Pengaturan Pengguna, Format Pengaturan, Aturan Approval, dan Aturan Tagging. Checkbox perusahaan: Tampilkan logo di laporan, Bedakan alamat penagihan dengan alamat pengiriman, Approval, Multipemotongan, Ringkasan kinerja perusahaan (via email), Termasuk pajak, Tag transaksi, Multi-mata uang.

- **Pengaturan Pengguna:** pencarian Cari pengguna serta dua input teks tanpa label yang terlihat; tabel/aksi pengguna tidak tampil dalam pemeriksaan ini. Tidak menyalin nama, alamat email, atau status pengguna.
- **Format Pengaturan / Penjualan:** input Syarat Pembayaran Penjualan Utama; opsi/checkbox Pengiriman, Diskon, Diskon per Baris, Akun diskon per produk, Uang Muka, Tampilkan % Keuntungan di Faktur Penjualan, Tolak Penjualan jika Kekurangan Kuantitas, Harga penjualan mengikuti price rule; area teks Pesan Penjualan Standar dan Pesan Surat Jalan Standar.
- **Format Pengaturan / Pembelian:** input Syarat Pembayaran Pembelian Utama; opsi Aktifkan supplier di Permintaan pembelian, Pengiriman, Diskon, Diskon per Baris, Uang Muka; area teks Pesan Pembelian Standar. Ada aksi Ubah/Batalkan; tidak diaktifkan.
- **Pengingat Faktur:** pilihan Tipe Faktur, Interval, Pengecualian, checkbox Kirim email pengingat faktur dan kontrol checkbox lain; aksi Batalkan/Simpan perubahan. Tidak diubah.
- **Aturan Approval:** filter Tipe transaksi dan Cari nama aturan; kolom Nama aturan, Tipe transaksi, Melebihi nilai tertentu, Melebihi piutang maksimum, Melewati jatuh tempo, Terakhir diubah. Isi baris/aturan tidak disalin.
- **Aturan Tagging:** filter Transaction type dan Cari aturan; kolom Nama aturan, Tipe transaksi, Jenis tagging. Isi aturan tidak disalin.
- **Custom fields:** pencarian Cari custom field; kolom Nama custom field, Tipe custom field, Halaman, Status, Terakhir diubah. Tidak membuka/mengubah field tertentu.
- **Produk, Template Email, Pemetaan Akun:** halaman Barang & jasa memuat subbagian Pengaturan dasar, Pengaturan subfitur, Pengaturan lainnya; Template Email Penjualan menampilkan input teks dan area teks; Daftar Pemetaan menampilkan delapan input teks berlabel Pendapatan Penjualan, Diskon Penjualan, Retur Penjualan, Pengiriman Penjualan, Pembayaran di Muka, Penjualan Belum Ditagih, Piutang Belum Ditagih, Hutang Pajak Penjualan. Nilai pengaturan tidak disalin.

Nilai/identitas perusahaan dan rincian rekening tidak disalin; tidak ada pengaturan, pengguna, atau aturan yang diubah.

### Konsolidasi dan Integrasi

- **Konsolidasi:** halaman onboarding menampilkan tombol **Mulai konsolidasi** dan petunjuk alur tiga langkah. Langkah persiapan meminta nama konsolidasi, periode, mata uang laporan, sumber data (Mekari Jurnal atau spreadsheet), serta unit bisnis (nama, kode, mata uang dasar). Langkah proses menyebut kurs penutup/rata-rata, pemetaan akun unit bisnis, eliminasi intercompany, dan opsi **Jadikan aturan berulang**. Langkah laporan mencakup Laba Rugi, Neraca, Arus Kas, Neraca Saldo, filter unit/eliminasi, kepadatan tabel Standar/Rapat, grup kolom periode/unit, layar penuh, serta ekspor PDF/XLS/CSV. Tombol Mulai konsolidasi tidak ditekan; tidak ada konfigurasi atau aturan yang dibuat.
- **Integrasi/Add Ons:** halaman menampilkan tautan **Kunjungi Jurnal App Store**, bagian **Terpasang**, satu kartu aplikasi Mekari Pay, tautan **Buka**, dan menu tindakan. Menu berisi **Lihat Informasi Aplikasi** dan **Uninstall**. Panel informasi memiliki judul, deskripsi aplikasi, serta bagian Informasi Tambahan dengan label Developer, Telepon, Email, dan Website; nilainya tidak disalin. Tautan Buka membuka area `about:blank` tanpa kontrol aplikasi yang dapat diperiksa. Tidak membuka App Store, tidak meng-uninstall, dan tidak menjalankan pembayaran.
- **Custom solution:** alamat menu dapat dibuka tetapi halaman hanya menampilkan judul browser tanpa konten, filter, input, atau aksi.

## Laporan: contoh halaman detail

Kartu Neraca membuka halaman detail dengan filter Periode (input tanggal) dan Filter sesuai periode (pilihan). Aksi yang terlihat: Filter, Filter lainnya, Ekspor, Lihat contoh, dan Beri masukan. Filter baca-saja dijalankan memakai pilihan awal halaman untuk melihat header hasil; tidak ada nilai yang diedit dan tidak ada laporan diekspor. Nilai baris laporan tidak dicatat.

### Parameter dan kolom laporan lain yang terbaca

Saya menjalankan Filter baca-saja pada beberapa laporan yang headernya belum tampak. Hanya label kolom yang dicatat; isi baris, saldo, dan angka tidak disalin. Laporan lain yang belum dijalankan tetap ditandai belum terverifikasi.

- **Sekilas bisnis:** Neraca memakai Periode dan Filter sesuai periode; daftar periode mencakup Hari ini, Pekan ini, Bulan ini, Kuartal ini, Tahun ini, Kemarin, Pekan lalu, Bulan lalu, Kuartal lalu, Tahun lalu, Per bulan tahun ini, Custom. Filter lainnya menambah Bandingkan Periode (None, Mingguan, Bulanan, Triwulan, Semi-Tahunan, Tahunan) dan kedalaman akun (1 atau 2). Setelah Filter, header hasil Neraca: Nama Akun dan kolom tanggal saldo (dinamis mengikuti periode). Buku besar memakai Tanggal awal, Tanggal akhir, Periode; header hasil Nama Akun/Tanggal, Transaksi, No., Deskripsi, Debit, Kredit, Saldo. Filter lanjutannya mencakup akun, tag, dan pencocokan Mencakup semua/Salah satu. Arus kas memakai Tanggal awal, Tanggal akhir, Periode; sesudah Filter tidak tampak header hasil pada tampilan yang diperiksa. Jurnal memakai Tanggal Mulai, Tanggal Selesai, dan periode; header yang terlihat Akun, Debit, Kredit. Perubahan modal memakai rentang tanggal/periode; header Kode Akun, Nama Akun, Permulaan, Debit, Kredit, Saldo akhir. Laba Rugi memakai Tanggal awal, Tanggal akhir, Periode; header hasil Tanggal dan rentang periode terpilih (dinamis). Filter lanjutannya: Bandingkan dengan, Grup berdasarkan tag, Include all/Either, Kedalaman akun, Tampilkan akun. Neraca Saldo memakai Tanggal awal, Tanggal akhir, Periode; sesudah Filter tidak tampak header hasil pada tampilan yang diperiksa, termasuk setelah rentang tanggal diperluas. Anggaran laba rugi membuka pemilih anggaran (Pilih anggaran), aksi Buat anggaran dan Batalkan; Lanjutkan nonaktif sebelum anggaran dipilih. Tidak ada anggaran dipilih atau dibuat. Ringkasan bisnis tidak memperlihatkan input saat dibuka. Manajemen anggaran membuka halaman Anggaran dengan aksi Buat anggaran; tidak ada tabel/filter laporan pada tampilan awal.
- **Penjualan:** Daftar penjualan, Penjualan per pelanggan, Pengiriman penjualan, Penjualan per produk, dan Penyelesaian Pesanan Penjualan memakai tanggal awal/akhir dan Periode; aksi Filter/Ekspor, sebagian juga Filter lainnya atau Lihat contoh. Filter lanjutan Daftar Penjualan: Tipe transaksi, Tanggal berdasarkan, Pelanggan, Status, Grup dengan tag, dan pilihan Mencakup semua/Salah satu. Filter lanjutan Penjualan per Pelanggan: Tipe transaksi (Faktur penjualan, Pesanan penjualan, Penawaran penjualan), Tag, Pelanggan, Kategori produk, Urutkan berdasarkan (Total penjualan/Pelanggan), pilihan semua/salah satu untuk grup tag/kategori, dan urutan naik/turun. Daftar Penjualan tidak memperlihatkan header setelah filter periode diperiksa; Penjualan per pelanggan juga tidak menampilkan header setelah filter tanggal bawaan maupun rentang tanggal luas. Pengiriman penjualan, Penjualan per produk, Penyelesaian pesanan penjualan, dan Profitabilitas produk tidak menampilkan header setelah Filter pada tampilan yang diperiksa. Piutang pelanggan memakai tanggal “Per” dan Filter sesuai periode; kolom Pelanggan/Tanggal, Transaksi, No., Jatuh Tempo, Deskripsi, Jumlah, Sisa Piutang. Usia piutang memakai Per dan periode; kolom Customer, Total, 1–30, 31–60, 61–90, >90 hari. Daftar faktur proforma memiliki rentang tanggal; kolom Tgl. transaksi, Nomor transaksi, Tgl. jatuh tempo, Pelanggan, Status, Total, Sisa tagihan, Mata uang. Daftar tukar faktur memakai rentang tanggal; kolom Tgl. transaksi, No. transaksi, Pelanggan, Tgl. jatuh tempo, Status, Total, Sisa tagihan, Mata uang.
- **Penjualan per produk — filter lanjutan yang diperiksa:** Tanggal awal/akhir, Periode, Tipe transaksi (Faktur penjualan, Pemesanan penjualan, Penawaran penjualan), Tag dengan Mencakup semua/Salah satu, Pelanggan, Kategori produk dengan Mencakup semua/Salah satu, Produk, checkbox **Lihat versi lebih detail** (deskripsi UI: menampilkan nomor transaksi dan diskon dengan pengelompokan tipe produk), Urutkan berdasarkan (Nama produk, Kode produk, Qty, Qty retur, Nilai penjualan, Nilai penjualan rata-rata), Urutkan naik/turun. Aksi panel: Reset filter, Batalkan, Terapkan. Halaman utama: Tampilkan, Filter, Ekspor, Beri masukan, Lihat contoh. Panel dibatalkan tanpa diterapkan; tombol Tampilkan dengan rentang bawaan tidak menemukan hasil dan tidak menampilkan header.
- **Profitabilitas Produk — filter lanjutan yang diperiksa:** Tanggal awal/akhir, Periode (Hari ini, Pekan ini, Bulan ini, Kuartal ini, Tahun ini, Pekan lalu, Bulan lalu, Kuartal lalu, Tahun lalu), Produk, Urutkan sesuai kolom (Nama produk, Qty terjual, Satuan, Nilai total penjualan, Total HPP, Nilai total profit, Profit margin, Harga jual rata-rata, Harga beli rata-rata), Urutan naik/turun. Aksi panel: Reset filter, Batal, Terapkan; halaman utama: Tampilkan, Filter, Ekspor (PDF, XLSX, CSV). QA filter lokal memilih Bulan ini, menguji Nama produk dan urutan turun, serta memasukkan pencarian produk sintetis yang menghasilkan “No result found”; drawer dibatalkan tanpa menerapkan. Tampilkan dengan tanggal bawaan menunjukkan empty state, tanpa header hasil.
- **Piutang pelanggan — filter lanjutan:** Per (tanggal), Filter sesuai periode, Tanggal Jatuh Tempo Hingga, Grup dengan Tag (Mencakup Semua/Salah Satu), Filter sesuai pelanggan, Urutkan sesuai kolom (default Pelanggan), Urutan Naik/Turun, checkbox Perlihatkan Lebih Detail. Aksi Batalkan/Filter. Header dasar Pelanggan/Tanggal, Transaksi, No., Jatuh Tempo, Deskripsi, Jumlah, Sisa Piutang; empty state menyatakan belum ada transaksi penjualan. Menu Ekspor menawarkan PDF/XLS/CSV; tidak ada file diunduh.
- **Pengiriman penjualan — filter lanjutan:** Tanggal awal/akhir, Periode, Tag dan logika Mencakup semua/Salah satu, Kategori produk dan logika Mencakup semua/Salah satu, Urutkan berdasarkan (Pelanggan, Pengiriman penjualan, Produk). Aksi Reset filter/Batalkan/Terapkan. Halaman utama menampilkan Tampilkan, Filter, Ekspor, Beri masukan; daftar kosong dan header hasil belum muncul. Drawer dibatalkan tanpa menerapkan.
- **Usia piutang — filter lanjutan:** Per (tanggal), Filter sesuai periode, Filter menurut (default Tanggal Transaksi; pilihan lain belum dibuka), Grup dengan Tag (Mencakup Semua/Salah Satu), Urutkan sesuai kolom (default Customer), Urutan Naik/Turun. Aksi Batalkan/Filter. Header Customer, Total, 1–30 Hari, 31–60 Hari, 61–90 Hari, >90 Hari; empty state menyatakan belum ada transaksi penjualan. Menu Ekspor menawarkan PDF/XLS/CSV; tidak ada file diunduh.
- **Daftar penjualan — rincian filter dan tindakan yang diperiksa:** Filter dasar Tanggal awal, Tanggal akhir, Periode, Filter, Filter lainnya; drawer mengulang tanggal/periode lalu menyediakan Tipe transaksi (Faktur Penjualan, Pesanan Penjualan, Penawaran Penjualan, Pembayaran Pesanan Penjualan, Terima Bayaran, Retur Penjualan, Pembayaran Faktur Penjualan), Tanggal berdasarkan (Tgl. transaksi/Tgl. jatuh tempo), Pelanggan (Individual/Group plus pencarian), Status (Belum Dibayar, Terbayar Sebagian, Lewat Jatuh Tempo), Grup dengan tag, dan logika Mencakup semua/Salah satu; Reset filter, Batalkan, Filter. Daftar kosong, tanpa header. Menu Template berisi Sales Invoice, Sales Invoice Detail, Buat template; Ekspor berisi PDF, Excel, CSV. Menu dibuka tanpa memilih template dan tanpa mengekspor file. Drawer ditutup tanpa menerapkan perubahan.
- **Penyelesaian pemesanan penjualan — filter dan aksi:** Tanggal awal/akhir, Periode, Mulai dari (Pemesanan/Penawaran), Pelanggan, Grup dengan tag, dan logika Mencakup semua/Salah satu; aksi Reset filter, Batalkan, Filter. Halaman utama menampilkan Filter, Filter lainnya, Template, Ekspor; daftar kosong tanpa header. Template yang terlihat: Order Completion Summary, Order Completion Detail, Buat template. Ekspor: PDF, Excel, CSV. Opsi Mulai dari diperiksa dengan mengosongkan nilai pada drawer sementara, lalu drawer dibatalkan dan ditutup tanpa menerapkan; template tidak dipilih dan file tidak diekspor.
- **Pembelian:** Daftar pembelian, Pembelian per supplier, Pengiriman pembelian, Pembelian per produk, dan Penyelesaian Pesanan Pembelian memakai tanggal awal/akhir dan Periode. Filter lanjutan Daftar Pembelian: Tipe transaksi, Tanggal berdasarkan, Supplier, Status, Grup dengan tag, dan Mencakup semua/Salah satu. Daftar Pembelian tidak memperlihatkan header setelah filter periode bawaan maupun rentang tanggal luas; Pembelian per supplier, Pengiriman pembelian, Pembelian per produk, dan Penyelesaian pesanan pembelian juga tidak menampilkan header setelah Filter. Utang supplier memakai tanggal “Per” dan periode; kolom Supplier/Tanggal, Transaksi, No., Jatuh Tempo, Keterangan, Jumlah, Saldo. Usia utang memakai Per/periode; kolom Vendor, Total, 1–30, 31–60, 61–90, >90 hari. Daftar pengeluaran memakai tanggal mulai/selesai dan periode; kolom Tanggal, Nomor, Kategori, Deskripsi, Supplier, Jumlah. Detail pengeluaran memakai rentang tanggal/periode; kolom Kategori/Tanggal, Transaksi, Nomor, Keterangan, Jumlah.
- **Pembelian per supplier — rincian filter yang diperiksa:** Tanggal awal/akhir, Periode, Tipe transaksi (default Faktur pembelian), Tag dengan Mencakup semua/Salah satu, Supplier, Kategori produk dengan Mencakup semua/Salah satu, Urutkan berdasarkan (default Supplier), Urutan naik/turun. Aksi panel: Reset filter, Batalkan, Terapkan. Halaman memiliki Tampilkan, Filter, Ekspor, Beri masukan, dan Lihat contoh; layar awal kosong, tanpa header hasil. Drawer dibatalkan tanpa filter diterapkan.
- **Pembelian per produk — filter dan aksi:** Tanggal awal/akhir, Periode, Tipe transaksi (Faktur pembelian, Pemesanan pembelian, Penawaran pembelian), Tag dan logika Mencakup semua/Salah satu, Supplier, Kategori produk dan logika Mencakup semua/Salah satu, Produk, checkbox Lihat versi lebih detail, Urutkan berdasarkan (Nama produk, Kode produk, Qty, Qty retur, Nilai pembelian, Nilai pembelian rata-rata), urutan naik/turun. Aksi panel Reset filter/Batalkan/Terapkan; halaman Tampilkan, Filter, Ekspor (PDF, XLSX, CSV), Beri masukan, Lihat contoh. Daftar kosong tanpa header; filter dibatalkan tanpa diterapkan dan tidak ada file diekspor.
- **Pengiriman pembelian — filter lanjutan:** Tanggal awal/akhir, Periode, Tag dan logika Mencakup semua/Salah satu, Kategori produk dan logika Mencakup semua/Salah satu, Urutkan berdasarkan (Supplier, Pengiriman pembelian, Produk). Aksi Reset filter/Batalkan/Terapkan. Halaman utama Tampilkan, Filter, Ekspor, Beri masukan; daftar kosong tanpa header. Panel ditutup tanpa menerapkan.
- **Penyelesaian pesanan pembelian — filter dan aksi:** Tanggal awal/akhir, Periode, Mulai dari (Pemesanan/Penawaran), Supplier, Grup dengan tag, logika Mencakup semua/Salah satu; aksi Reset filter, Batalkan, Filter. Halaman utama menyediakan Filter, Filter lainnya, Template, Ekspor; daftar kosong tanpa header. Template: Order Completion Summary, Order Completion Detail, Buat template. Ekspor: PDF, Excel, CSV. Panel ditutup tanpa menerapkan dan tidak ada file/template dibuat.
- **Utang supplier — filter/detail lanjutan:** filter Per, Filter sesuai periode, Tanggal Jatuh Tempo Hingga, Filter sesuai supplier, Grup dengan Tag, logika Mencakup Semua/Salah Satu, Urutkan sesuai kolom (default Supplier), Urutan Naik/Turun, dan checkbox Perlihatkan Lebih Detail; aksi Batalkan/Filter. Header dasar Supplier/Tanggal, Transaksi, No., Jatuh Tempo, Keterangan, Jumlah, Saldo. Ketika Perlihatkan Lebih Detail diuji dan Filter diterapkan, header tambahan Pemotongan muncul. Empty state menyatakan belum ada transaksi pembelian; tidak ada isi baris yang dibaca. Ekspor menawarkan PDF, XLS, CSV. Filter detail dikembalikan ke kondisi bawaan setelah pemeriksaan.
- **Produk:** Tingkat pemenuhan pesanan memakai Tanggal dan Periode analisis; Perputaran persediaan memakai Tanggal awal/akhir/Periode; Ringkasan persediaan memakai Tanggal/Periode. Kuantitas stok gudang dan Nilai stok gudang memakai Per, Periode, Gudang. Nilai persediaan barang dan Detail persediaan memakai tanggal awal/akhir/Periode. Pergerakan barang gudang memakai tanggal awal/akhir/Periode/Gudang. Laporan gudang bernomor seri memakai Tanggal/Periode/Gudang. Setelah Filter, Nilai stok gudang menampilkan Kode produk/SKU, Nama produk, Stok di gudang, Batas min., Unit, Harga rata-rata, Nilai stok; Pergerakan barang gudang menampilkan Kode produk/SKU, Nama produk, Stok awal, Stok masuk, Stok keluar, Stok akhir, Unit. Tingkat pemenuhan, Perputaran persediaan, Ringkasan persediaan, Kuantitas stok gudang, Nilai persediaan, Detail persediaan, dan kedua laporan nomor seri tidak menampilkan header pada tampilan yang diperiksa. Aksi umum: Filter, Ekspor, Lihat contoh.
- **Aset:** Ringkasan aset tetap memakai Per dan periode; header tidak tampak setelah Filter pada tampilan yang diperiksa. Detail aset tetap memakai tanggal mulai/selesai/periode, dengan kolom Tanggal, Tindakan, Transaksi, Nomor, Nomor Akun, Nama Akun, Debit, Kredit, Nilai Buku. Penjualan/pelepasan aset memakai tanggal awal/akhir; kolom Aset, Tanggal Akuisisi, Tanggal Pelepasan, Biaya Awal, Ak. Penyusutan, Nilai Buku, Harga Jual, Untung/(Rugi).
- **Bank:** Ringkasan rekonsiliasi memakai tanggal dan akun kas/bank; header UI Tanggal, “Dekripsi”, Jumlah. Mutasi rekening koran memakai tanggal mulai/selesai dan periode; kolom Tanggal, Deskripsi, Tanggal Impor, Terekonsiliasi, Sumber, Terima, Kirim, Saldo.
- **Pajak:** Pajak pemotongan dan pajak penjualan memakai tanggal mulai/selesai dan periode; kolom Tanggal, DPP, Rate Pajak, Total Pajak.
- **Produksi:** tiga kartu yang terlihat adalah Penyusunan produksi, Pemisahan produksi, dan Harga pokok produksi (COGM); hanya aksi Ekspor laporan yang terdeteksi. Tidak diekspor.

## Form tambahan dan filter yang dibuka

### Dokumen penjualan dan pembelian

- **Tukar Faktur Penjualan:** Pelanggan (wajib), Email, Alamat penagihan, Tgl. transaksi, Tgl. jatuh tempo (wajib), No Transaksi, Syarat pembayaran, pencarian faktur, Pesan, Memo. Tabel faktur yang dipilih: Penagihan Penjualan, Deskripsi, Tgl. jatuh tempo, Status, Jumlah tagihan, Sisa tagihan. Aksi Batalkan/Simpan.
- **Pesanan dan penawaran penjualan:** menu membuka formulir penjualan dengan Pelanggan (wajib), Email, Alamat penagihan, Tgl. transaksi, Tgl. jatuh tempo, Syarat pembayaran, No Transaksi, No. referensi pelanggan, Tag, Harga termasuk pajak. Baris produk: Produk, Deskripsi, Kuantitas, Unit, Harga satuan, Diskon, Pajak, Jumlah. Bagian bawah: Pesan, Memo, Lampiran (maks. 5 file/10 MB per file), subtotal, diskon baris, diskon total, total, sisa tagihan; aksi Batalkan/Buat dan menu aksi tambahan. Tidak disimpan.
- **Tukar Faktur Pembelian:** Supplier (wajib), Email, Alamat penagihan, Tgl. transaksi, Tgl. jatuh tempo (wajib), No Transaksi, Syarat pembayaran, pencarian faktur, Pesan, Memo. Tabel: Faktur pembelian, Deskripsi, Tgl. jatuh tempo, Status, Jumlah tagihan, Sisa tagihan. Aksi Batalkan/Simpan.
- **Pesanan dan penawaran pembelian:** Supplier (wajib), Email, Alamat penagihan, Tgl. transaksi, Tgl. jatuh tempo atau Tgl. kedaluwarsa (sesuai jenis), No Transaksi, Nomor referensi supplier, Syarat pembayaran, Gudang, Tag, Harga termasuk pajak. Baris produk: Produk, Deskripsi, Kuantitas, Unit, Harga satuan, Pajak, Jumlah. Bagian bawah: Pesan, Memo, Lampiran (maks. 5 file/10 MB per file), subtotal, total, sisa tagihan; aksi Batalkan/Buat dan menu aksi tambahan. Tidak disimpan.
- **Permintaan pembelian:** Staf penyetuju (wajib), Email penyetuju (wajib), Nama supplier, Email supplier, Alamat supplier, Tanggal transaksi (wajib), No Transaksi, Tanggal jatuh tempo, Tahun anggaran terkait, Urgensi (wajib), Tag, Pilih produk, Pesan, Memo. Tabel Produk, Deskripsi, Kuantitas, Unit; aksi Batalkan/Buat permintaan. Form tetap kosong.

### Produk dan gudang

- **Tambah produk baru:** Nama produk (batas 255 karakter), Kode produk/SKU, Barcode, Unit, Kategori produk, Deskripsi (batas 6.000 karakter), unggah gambar JPG/PNG maksimal 5 MB, dan Tipe produk (wajib; daftar demo kosong dan menampilkan “No result found”). Bagian Harga & persediaan memiliki checkbox “Saya beli produk ini” dan “Saya jual produk ini” yang aktif secara default. Bagian beli: Harga beli satuan, Akun pembelian, Pajak beli; bagian jual: Harga jual satuan, Akun penjualan, Pajak jual. Tautan “Aktifkan sekarang” menuju pengaturan akun diskon. Ada Bantuan dan aksi Batalkan, Simpan, serta menu opsi Simpan. Form kosong ditinggalkan lewat navigasi kembali; tidak ada isian atau record yang disimpan.
- **Buat gudang:** Nama gudang (wajib), Kode gudang, Penanggung jawab (maks. 5), Alamat, Keterangan; aksi Batalkan/Simpan.
- **Siapkan penyesuaian stok:** Tipe penyesuaian, Perhitungan stok, Stok masuk/keluar, Kategori penyesuaian, Akun, Tanggal (placeholder DD/MM/YYYY), Gudang; pilihan radio untuk metode perhitungan; aksi Batalkan/Lanjutkan. Pemeriksaan berhenti di langkah persiapan.
- **Transfer gudang:** No. transaksi (wajib), Tanggal, Dari gudang, Ke gudang, Memo. Tabel: Nama produk, Gudang, Qty sebelum, Qty sesudah, Total transfer. Form ditinggalkan kosong.
- **Daftar gudang — subtab:** Daftar gudang memiliki toggle “Tampilkan gudang tidak aktif”, Impor, pencarian, dan empty state; Daftar transfer gudang dan Membutuhkan persetujuan menampilkan Impor dan pencarian, tetapi tanpa header/empty state yang terdeteksi saat daftar kosong. Ketiga subtab dapat dipilih. Tidak ada impor dijalankan dan toggle tidak diubah.
- **Aturan harga — daftar dan form:** Daftar kosong dengan pencarian; Tindakan berisi Tambah produk baru, Tambah gudang baru, Sesuaikan stok (stock opname), Transfer gudang, dan Buat aturan harga baru. Form aturan harga berurutan: Nama aturan (maks. 250 karakter), Periode aturan, Tipe aturan, Pilih kontak (Cari kontak/Tambah kontak), Pilih produk (Cari produk/Tambah produk); ada Beri masukan, Batalkan, Simpan. Pilihan tipe: Diskon persentase, Diskon nominal harga, Diskon persentase bertingkat, Diskon subtotal penjualan, Diskon harga akhir, Markup persentase, Markup nominal harga. Input dinamis yang tampak: persentase (%) atau nominal harga (Rp); diskon bertingkat memiliki Qty dan Diskon persentase dengan aksi Tambah tingkatan lainnya; diskon subtotal memiliki input dan Tambah subtotal lainnya; diskon harga akhir menampilkan petunjuk untuk mengatur harga akhir pada produk pilihan. Kontak/produk yang terpilih akan muncul di area masing-masing; daftar pilihan tidak dibuka agar data tenant tidak tersalin. QA memasukkan nama sintetis untuk memeriksa penghitung 0/250 menjadi 21/250, mengubah pilihan tipe hanya dalam draft, lalu Batalkan > Tinggalkan; tidak ada aturan yang disimpan.

### Kas dan bank

- **Transfer uang:** Transfer Dari, Setor Ke, Jumlah, Memo, Lampiran, Tag, No Transaksi otomatis, Tgl Transaksi; form kosong ditinggalkan tanpa membuat transfer.
- **Terima uang:** Setor Ke, Yang Membayar, Tgl Transaksi, No Transaksi otomatis, Tag, Harga termasuk pajak, Memo, Lampiran. Tabel: Terima dari, Deskripsi, Pajak, Jumlah. Form kosong ditinggalkan tanpa penerimaan.
- **Kirim uang:** Bayar Dari, Penerima, Tgl Transaksi, No Transaksi otomatis, Tag, Harga termasuk pajak, Total, Memo, Lampiran. Tabel: Pembayaran Untuk Akun/Pengeluaran, Deskripsi, Pajak, Jumlah. Form kosong ditinggalkan tanpa pengiriman.
- **Aturan pencocokan bank:** kolom No, Terapkan ke, Nama Aturan, Kondisi Pencocokan, Catat Sebagai, Catat Otomatis, Tindakan. Form Buat Aturan Baru memiliki nama, tipe transaksi, pencocokan semua/sebagian kondisi, field kondisi/operator/nilai, opsi otomatis, dan Simpan. Tidak ada aturan yang dibuat atau diterapkan.

### Daftar kecil

- **Tag:** Nama tag, Masukkan ke kategori; aksi Buat dan baru, Buat, Batalkan. Tidak ada tag ditambahkan.
- **Kategori produk:** satu input nama kategori; aksi Batalkan/Simpan. Tidak ada kategori ditambahkan.
- **Unit:** form tambah berisi input unit baru, pencarian/pemilihan unit, dua checkbox dan kontrol teks tambahan; nama checkbox/kontrol tambahan tidak tampil sebagai label saat diperiksa. Aksi Batalkan/Simpan.
- **Syarat pembayaran:** Nama, Jangka Waktu, pilihan jenis/perhitungan, angka periode dan checkbox tambahan; aksi Batalkan/Buat Syarat Pembayaran. Form dibatalkan.
- **Pajak:** tipe pajak (radio), Nama, Persentase Efektif, Pengali 11/12 untuk DPP, Pemotongan, Akun Pajak Penjualan, Akun Pajak Pembelian; aksi Batal/Buat Pajak. Form dibatalkan.
- **Cara pembayaran:** form tambah memiliki input Nama; aksi Batalkan/Buat Cara Pembayaran. Form dibatalkan tanpa simpan.

### Daftar transaksi dan filter

Filter dasar Daftar Transaksi: Tanggal Mulai, Tanggal Selesai, Tipe Transaksi, Filter sesuai status, dan Pencarian. Panel Filter lebih lanjut mengulang rentang tanggal/tipe transaksi dan status. Panel ditutup tanpa menerapkan filter.

## Header tambahan dari PDF contoh publik

Pada 1 Oktober 2026, saya membuka tautan **Lihat contoh** yang disediakan pada halaman laporan Jurnal. PDF bertanda **PT SAMPLE DATA** dipakai hanya untuk membaca nama kolom; isi baris dan angka contoh tidak disalin. Ini mengonfirmasi header output laporan yang tidak tampak pada tenant kosong:

- **[Penjualan per pelanggan](https://jurnal-quickbook.jurnal.id/pdf_report/sales_by_customer.pdf):** Pelanggan / Tanggal, Transaksi, No, Produk, Keterangan, Kuantitas, Satuan, Harga Satuan, Jumlah Tagihan, Total.
- **[Penjualan per produk](https://jurnal-quickbook.jurnal.id/pdf_report/sales_by_product.pdf):** Kode Produk, Nama Produk, Kuantitas Terjual, Kuantitas Retur, Satuan, Total Nilai Terjual, Total Nilai Retur, Harga Penjualan Rata-rata.
- **[Pembelian per supplier](https://jurnal-quickbook.jurnal.id/pdf_report/purchases_by_vendor.pdf):** Supplier / Tanggal, Transaksi, No, Produk, Keterangan, Kuantitas, Satuan, Harga Satuan, Jumlah Tagihan, Total.
- **[Pembelian per produk](https://jurnal-quickbook.jurnal.id/pdf_report/purchase_by_product.pdf):** Kode Produk, Nama Produk, Kuantitas Terbeli, Kuantitas Retur, Satuan, Total Nilai Terbeli, Total Nilai Retur, Harga Pembelian Rata-rata.

Contoh PDF memperlihatkan layout laporan dan kolomnya, bukan header tabel transaksi utama pada halaman Penjualan/Pembelian.

## Catatan batas pemeriksaan

- Status belum lengkap. Form Jadwal Berulang sudah diperiksa dari langkah Atur Berulang sampai formulir faktur kosong; pengaturan interval/frekuensi/tanggal akhir masih belum terverifikasi karena kontrol tersebut tidak muncul tanpa melengkapi transaksi. Lampiran diperiksa sampai dialog unggah dan daftar pilihan tipe, tanpa memilih file. Layar awal migrasi dibaca, tetapi wizard lanjut/unggah dan proses impor/ekspor tidak dimulai. Beberapa laporan tidak memperlihatkan header hasil setelah Filter. Pemindaian daftar tidak menemukan label generik edit/hapus yang dapat diakses pada baris; kolom Tindakan/Action yang terlihat pada beberapa tabel belum bisa dipetakan ke menu per baris tanpa memilih record.
- Halaman onboarding Konsolidasi dan panel informasi Integrasi sudah dicatat di atas; halaman operasional add-on tetap kosong dan Custom solution tidak menampilkan konten. Setelah form Cara Pembayaran dibatalkan di tab riset terpisah, aplikasi menampilkan pesan “Sesi Berakhir”; saya tidak mencoba login ulang. Pada pemeriksaan sebelumnya, tab laporan awal masih menampilkan katalog.
- Pada 1 Oktober, tab Jurnal yang digunakan untuk inspeksi berhasil aktif kembali setelah pengguna masuk sendiri. Laporan dan katalog yang dibuka setelahnya dapat diperiksa; tidak ada kredensial yang dimasukkan oleh pemeriksa.
- Nilai yang muncul dalam aplikasi sengaja tidak disalin ke inventaris.
- Belum menguji pengiriman formulir, posting transaksi, impor/ekspor, rekonsiliasi, atau aksi lain yang mengubah data.
