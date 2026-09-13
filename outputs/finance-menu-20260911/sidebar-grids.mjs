const G=(id,name,cols,rows,edit,actions,validation,after)=>({id,name,cols:cols.split('|'),rows,edit,actions,validation,after});
export const grids=[
G('S01','Dokumen pendukung','Nama|Jenis|Versi|Tanggal|Pengunggah|Akses|Status|Aksi',[
['Invoice contoh','Invoice','v1','Tanggal sumber','Petugas AP','Reviewer terkait','Tersedia','Pratinjau'],['Bukti bayar','Pembayaran',null,null,null,'Treasury','Belum ada','Buka payment']],
'Unggah/ganti/hapus hanya lampiran draf berizin. Bukti pembayaran berasal dari payment yang sama.','Unggah; pratinjau; unduh sesuai hak; tambah versi.','Jenis/ukuran menurut konfigurasi; tampilkan progres/gagal unggah; dokumen wajib sesuai transaksi.','Lampiran versi submitted/posted tidak dihapus diam-diam; revisi menambah versi.'),
G('S02','Keputusan dan riwayat','Tahap|Versi|Pelaku|Keputusan|Waktu|Alasan|Sumber|Aksi',[
['Review','v1','Reviewer','Dikembalikan','Waktu keputusan','Perbaiki kategori','BILL-001','Buka versi'],['Review ulang','v2','Reviewer','Menunggu',null,null,'BILL-001','Bandingkan']],
'Baca saja. Keputusan hanya melalui tombol/F01 berizin.','Buka versi; bandingkan; buka keputusan.','Versi, orang, waktu dan hasil tidak dapat diedit sebagai sel.','Riwayat dipertahankan; keputusan versi lama tidak otomatis berlaku untuk revisi material.'),
G('S03','Alokasi pembayaran / penerimaan','Dokumen|Pihak|Jenis saldo|Nilai sumber Rp|Sisa Rp|Alokasi Rp|Sisa sesudah Rp|Aksi',[
['BILL-101','Vendor A','Utang vendor',3000000,3000000,2000000,1000000,'Ubah alokasi'],['BILL-102','Vendor A','Utang vendor',2000000,2000000,1000000,1000000,'Hapus draf']],
'Pilih dokumen dan nominal alokasi saat draf; nominal sumber/sisa baca saja.','Tambah sumber; ubah alokasi; hapus baris draf.','Alokasi tidak melebihi sisa; total alokasi sesuai payment/receipt; pihak, unit, mata uang dan jenis kompatibel.','Alokasi dieksekusi tidak diubah langsung; koreksi mengikuti payment dan dokumen asal.'),
G('S04','Mutasi rekening / instrumen','Tanggal|Referensi|Jenis|Masuk Rp|Keluar Rp|Saldo Rp|Status|Aksi',[
['Tanggal transaksi','PAY-001','Bayar tagihan',0,5000000,25000000,'Tercatat','Buka payment']],
'Baca saja. Saldo dan mutasi berasal dari ledger/payment.','Buka sumber; filter; telusuri giro/bank.','Tanggal posisi, rekening dan unit harus jelas. Tidak menampilkan registered bank sebagai siap pakai tanpa pemetaan.','Koreksi dari sumber; tidak edit saldo bank/kas manual untuk membuat cocok.'),
G('S05','Pasangan rekonsiliasi bank','Baris bank|Nilai bank Rp|Dokumen buku|Nilai buku Rp|Alokasi Rp|Sisa bank Rp|Status|Aksi',[
['BNK-001',-5000000,'PAY-001',-5000000,5000000,0,'Cocok','Buka pasangan'],['BNK-002',-15000,null,null,0,15000,'Belum cocok','Tinjau']],
'Pilih pasangan dan alokasi dari sisa; mutasi asli dan nilai buku baca saja.','Cocokkan; lepas pasangan dengan alasan; buat transaksi sah dari baris bank.','Arah/rekening benar; tanda nilai bank tetap; alokasi absolut tidak melampaui sisa; satu baris tidak digunakan ganda.','Pasangan boleh dikoreksi sesuai mandat; jurnal tidak dihapus ketika pasangan dilepas.'),
G('S06','Rincian tagihan / biaya / invoice','Uraian|Kategori|Qty|Harga Rp|Potongan Rp|Neto Rp|Unit biaya|Aksi',[
['Jasa pemeliharaan','Pemeliharaan',2,1000000,0,2000000,'HO','Ubah'],['Bahan operasional','Biaya operasional',1,500000,0,500000,'HO','Hapus draf']],
'Uraian, kategori, qty, harga, potongan dan unit biaya hanya draf/dikembalikan; pajak di S07.','Tambah; ubah; hapus baris draf; salin baris dengan review sumber.','Kategori menentukan akun; qty/harga valid; potongan tidak melebihi bruto kecuali dokumen koreksi yang sah; sumber tidak ganda.','Neto/total terhitung. Setelah diajukan terkunci; sesudah posted pakai koreksi sumber.'),
G('S07','Rincian pajak / dokumen pajak','Sumber|Jenis pajak|Masa|Dasar Rp|Nilai pajak Rp|Nomor dokumen|Status|Aksi',[
['BILL-001','Jenis sesuai aturan','2026-09',2500000,null,'Belum tersedia','Perlu validasi','Buka dokumen']],
'Jenis, referensi dan data dokumen sesuai mandat; tarif/nilai dari aturan/dokumen sah.','Tautkan; cocokkan; buka sumber; usulkan pembetulan.','Jangan mengarang tarif atau mengisi komponen belum dihitung dengan nol; cek nomor/masa/sumber duplikat.','Kewajiban, bayar dan lapor terpisah; pembetulan tertaut versi lama.'),
G('S08','Pertanggungjawaban uang muka','Sumber|Jenis|Nilai Rp|Disetujui Rp|Pembayaran/penerimaan|Bukti|Status|Aksi',[
['LIQ-001','Biaya aktual',1500000,1500000,null,'Nota','Disetujui','Buka biaya'],['RCPT-ADV-001','Pengembalian',500000,500000,'RCPT-ADV-001','Bukti bank','Tercatat','Buka penerimaan']],
'Biaya dan bukti di draf LIQ; pengembalian aktual membaca receipt.','Tambah biaya; ajukan; tautkan pengembalian; buka sumber.','Biaya aktual sesuai kategori; jangan hitung klaim yang sama dua kali; sisa ADV direkonsiliasi.','Perubahan saldo berasal dari posting/alokasi; tidak tersedia tombol paksa lunas.'),
G('S09','Jadwal pengakuan / amortisasi','Periode|Dasar Rp|Pengakuan Rp|Sisa Rp|Versi|Jurnal|Status|Aksi',[
['2026-09',12000000,1000000,11000000,'v1',null,'Usulan','Tinjau'],['2026-10',11000000,1000000,10000000,'v1',null,'Belum jatuh periode','Buka dasar']],
'Dasar/metode di form jadwal yang sah; baris terhitung tidak diedit bebas.','Pratinjau; review; posting periode; buka jurnal.','Total tidak melebihi dasar; masa manfaat jelas; satu jadwal/periode tidak diposting dua kali.','Posted terkunci; revisi dasar menghasilkan jadwal versi baru dan koreksi yang sah.'),
G('S10','Penjualan dan settlement kanal','Transaksi|Kanal|Bruto Rp|Biaya Rp|Neto Rp|Diterima Rp|Selisih Rp|Aksi',[
['SALE-001','Acquirer A',1000000,30000,970000,970000,0,'Buka sumber']],
'Pilih sumber dan biaya statement pada draf settlement; bruto penjualan dan receipt aktual baca saja.','Pasangkan transaksi; tinjau biaya; tautkan penerimaan.','Bruto − biaya/potongan = neto; jumlah penerimaan harus direkonsiliasi; biaya tidak dibuat ulang sebagai tagihan.','Settlement selesai tidak diubah langsung; koreksi mempertahankan hubungan sumber.'),
G('S11','Rincian barang / opname','Barang|Satuan|Qty sumber|Qty aktual|Selisih qty|Nilai Rp|Alasan|Aksi',[
['Bahan A','kg',100,98,-2,-100000,'Selisih hitung','Buka sumber']],
'Qty aktual dari bukti operasi atau form opname berizin; qty buku/sumber dan selisih terhitung.','Buka sumber; verifikasi; ajukan penyesuaian.','Tanggal snapshot dan satuan konsisten; penerimaan parsial tidak melebihi sisa; metode penilaian sah.','Posting hanya dari dokumen disetujui; tidak mengedit saldo stok langsung.'),
G('S12','Pasangan dan saldo antarunit','Sumber|Unit|Lawan|Jenis hubungan|Saldo unit Rp|Saldo lawan Rp|Selisih Rp|Aksi',[
['FUND-001','C006','HO','Pendanaan',1000000,-1000000,0,'Buka pasangan']],
'Jenis/sumber pada draf transaksi; saldo dua pihak hasil posting baca saja.','Buka sumber; pilih saldo untuk pelunasan; rekonsiliasi.','Pendanaan memakai keluarga pendanaan, barang memakai barang; unit dan pihak lawan benar.','Pelunasan mempertahankan jenis hubungan; tidak mengalihkan ke akun utang barang default.'),
G('S13','Selisih rekonsiliasi','Kelompok|GL Rp|Rincian Rp|Selisih Rp|Penyebab|Owner|Bukti|Aksi',[
['Piutang pegawai',1500000,1500000,0,'Cocok','Finance payroll','Bukti rekonsiliasi','Buka sumber']],
'Penyebab, owner dan bukti; angka saldo/selisih baca saja.','Tugaskan; buka sumber; ajukan review; selesaikan jika bukti sah.','Tanggal/unit/versi sama; selisih dihitung, bukan diedit nol.','Hasil review tersimpan dengan sumber; koreksi di dokumen yang salah.'),
G('S14','Komponen dan pergerakan aset','Aset|Kelas|Sumber biaya|Perolehan Rp|Akumulasi Rp|Nilai buku Rp|Status|Aksi',[
['AST-001','Peralatan','BILL-AST-001',24000000,500000,23500000,'Aktif','Buka aset']],
'Kelas/metode dan alokasi hanya draf kapitalisasi/perubahan berizin; nilai buku baca saja.','Buka biaya; ajukan transfer; ajukan pelepasan.','Biaya tidak dialokasikan dua kali; tanggal siap pakai dan kebijakan kelas jelas.','Pelepasan/transfer membuat pergerakan tertaut; tidak mengganti saldo historis.'),
G('S15','Alokasi biaya proyek','Biaya sumber|Uraian|Nilai sumber Rp|Sudah dialokasi Rp|Alokasi usulan Rp|Sisa Rp|Tujuan|Aksi',[
['BILL-PRJ-001','Pembangunan',30000000,0,24000000,6000000,'AST-001','Ubah draf']],
'Pilih sumber, nilai alokasi dan tujuan pada draf.','Tambah sumber; ubah; hapus draf; buka tagihan.','Alokasi tidak melebihi sisa; biaya bank/biaya akuisisi mengikuti sumber yang sama bila relevan.','Kapitalisasi posted terkunci; sisa biaya tetap terlihat dan perlu keputusan.'),
G('S16','Batch payroll HR','Pegawai|Versi HR|Penghasilan Rp|Potongan Rp|Neto Rp|Kewajiban|Kelengkapan|Aksi',[
['Pegawai A','v2',5000000,500000,4500000,'PRP-001','Snapshot ilustrasi','Buka sumber HR']],
'Baca saja di Finance. Komponen HR tidak diedit di grid ini.','Buka sumber; tinjau mapping; terima/kembalikan batch.','Harus lengkap, approved, sealed; versi dan unit sama; tidak menggandakan kewajiban saat retry.','Pembayaran melalui F02; revisi nominal kembali ke HR dengan versi yang disetujui.'),
G('S17','Pelunasan payroll / pinjaman pegawai','Sumber|Pegawai|Jenis|Nilai Rp|Alokasi Rp|Sisa Rp|Jurnal|Aksi',[
['EMP-LOAN-001','Pegawai A','Piutang pegawai',2000000,500000,1500000,'JRN-PR-001','Buka potongan']],
'Alokasi hanya bila sumber payroll/receipt aktual sah; jumlah batch sumber tidak diedit.','Buka batch; tautkan potongan; alokasikan penerimaan.','Potongan memiliki run/payment/jurnal; tidak melebihi sisa.','Register dan GL berubah bersama sumber; tidak ada edit saldo lunas langsung.'),
G('S18','Jadwal pinjaman / angsuran','Jatuh tempo|Pokok Rp|Bunga Rp|Biaya Rp|Total Rp|Dibayar Rp|Sisa Rp|Aksi',[
['Tanggal angsuran',10000000,500000,0,10500000,0,10500000,'Siapkan pembayaran']],
'Jadwal draf mengikuti kontrak; nilai sudah dibayar baca saja.','Pratinjau; review perubahan kontrak; pilih angsuran untuk bayar.','Pisahkan pokok/bunga/biaya; jumlah pokok tersisa masuk akal; bank/pemberi dana bukan default satu jenis.','Perubahan kontrak berversi; payment tidak diubah dari tabel jadwal.'),
G('S19','Perubahan ekuitas','Sumber|Jenis|Saldo awal Rp|Setoran Rp|Distribusi Rp|Hasil periode Rp|Saldo akhir Rp|Aksi',[
['2026-09 HO','Ringkasan',100000000,50000000,0,20000000,170000000,'Telusuri']],
'Ringkasan baca saja; setoran/distribusi dibuat pada F28 berdasarkan keputusan.','Buka transaksi pemilik; buka laporan hasil; buka periode.','Hasil periode berasal dari GL/laporan, bukan input laba manual.','Perubahan periode dan transaksi tetap mempunyai sumber yang dapat ditelusuri.'),
G('S20','Baris jurnal','Akun|Nama|Unit|Debit Rp|Kredit Rp|Uraian|Sumber|Aksi',[
['AKUN-BEBAN','Beban contoh','HO',2500000,0,'Biaya disetujui','MANUAL-001','Ubah draf'],['AKUN-UTANG','Utang contoh','HO',0,2500000,'Kewajiban','MANUAL-001','Ubah draf']],
'Hanya jurnal manual draf: akun, dimensi, debit/kredit, uraian. Jurnal otomatis baca saja dan dibuka ke sumber.',
'Tambah baris; ubah; hapus draf; buka COA; pratinjau validasi.',
'Tepat satu sisi positif per baris; debit = kredit; akun aktif/postable/unit sah; periode terbuka. Kode pada contoh adalah placeholder, bukan COA baru.',
'Posted tidak diedit/hapus; pembalikan/koreksi tertaut. Semua jalur memakai guardrail ledger yang sama.'),
G('S21','Checklist tutup buku','Pemeriksaan|Owner|Sumber|Kesiapan|Masalah terbuka|Bukti|Reviewer|Aksi',[
['Rekonsiliasi bank','Treasury','REC-BANK-001','Belum selesai',1,null,'Controller','Buka masalah'],['Hasil periode','Akuntansi','Laporan','Perlu review',null,null,'Controller','Buka laporan']],
'Owner dan bukti sesuai tugas; kesiapan dan jumlah masalah dibaca dari sumber.','Buka masalah; ajukan review; konfirmasi tahap berizin.','Tidak menandai selesai jika sumber belum lengkap; cakupan unit dan periode jelas.','Saat tutup simpan jejak keputusan/bukti; buka ulang memerlukan alasan dan mandat.'),
G('S22','Master, pemetaan dan versi','Field/dimensi|Nilai kini|Nilai usulan|Berlaku mulai|Dasar|Status|Hasil uji|Aksi',[
['Bank giro','BCA default','Mandiri sesuai rekening','Tanggal berlaku','Koreksi dimensi','Usulan','Perlu uji','Review'],['Akun tujuan','Akun tidak sesuai','201200200200','Tanggal berlaku','COA sumber','Usulan','Perlu uji','Simulasikan']],
'Nilai usulan draf dengan tipe sesuai master. Nilai kini dan riwayat baca saja.','Ubah draf; lihat penggunaan; simulasikan jika rule; ajukan.','Identitas kode sebagai teks; dimensi/unit/aktif/postable sah; masa berlaku tidak ambigu.','Reviewer menyetujui; aktivasi/publikasi terpisah; histori tetap dipertahankan.'),
G('S23','Pratinjau impor','Baris|Referensi sumber|Unit|Tanggal|Nominal Rp|Validasi|Alasan|Aksi',[
[1,'EXT-001','HO','Tanggal sumber',1000000,'Valid',null,'Sertakan'],[2,'EXT-001','HO','Tanggal sumber',1000000,'Duplikat','Referensi sama','Perbaiki sumber']],
'Pemetaan kolom/pengecualian sesuai prosedur; data sumber tidak diubah diam-diam.','Pratinjau; sertakan valid; unduh kesalahan; batalkan.','Duplikat/format/unit/dimensi diperiksa; hasil parsial jelas per baris.','Konfirmasi hanya baris yang sah; retry tidak menduplikasi transaksi sebelumnya.'),
G('S24','Rincian laporan / buku besar','Pos/akun|Periode|Nilai Rp|Pembanding Rp|Selisih Rp|Unit|Sumber|Aksi',[
['Pendapatan','2026-09',100000000,90000000,10000000,'HO','GL','Telusuri']],
'Baca saja. Filter/periode/unit dan kolom tampilan dapat dipilih.','Telusuri pos → akun → jurnal → dokumen; ekspor sesuai izin.','Angka mencakup seluruh filter, bukan hanya halaman terlihat; sumber dan versi jelas.','Koreksi di dokumen sumber; laporan tidak membuat transaksi baru.'),
G('S25','Cakupan konsolidasi / eliminasi','Unit|Periode|Data tersedia|Periode ditutup|Saldo antarunit|Eliminasi|Status|Aksi',[
['HO','2026-09','Ya','Belum','Perlu review','Belum final','Disiapkan','Buka unit'],['C006','2026-09','Ya','Belum','Perlu review','Belum final','Disiapkan','Buka unit']],
'Cakupan unit sebagai filter berizin; nilai eliminasi bukan edit bebas laporan.','Pilih unit; buka pasangan; tinjau sumber eliminasi.','Semua unit terpilih dihitung; kesiapan eksplisit; eliminasi punya dasar pencatatan sah.','Hasil terbit menyimpan cakupan/versi; tidak hardcode hanya tiga unit.')
];
