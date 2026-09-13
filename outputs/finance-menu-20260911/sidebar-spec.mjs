// Target UI specification. No application mutations or financial postings.
const field=s=>s.split('|');
const base=[
'Nomor dokumen|Baca saja|Otomatis|Sistem|Tetap satu ID; versi berubah jika revisi',
'Unit|Dropdown|Ya|Unit yang boleh diakses|Akun, pihak dan transaksi sesuai unit',
'Tanggal transaksi|Tanggal|Ya|Pengguna|Periode harus terbuka untuk posting baru',
'Keterangan|Teks|Sesuai konteks|Pengguna|Alasan wajib untuk koreksi atau pengecualian',
'Lampiran|Upload dokumen|Sesuai jenis|Pengguna|Jenis/ukuran sesuai konfigurasi; status unggah terlihat'
];
const F=(id,name,owner,grid,rows,opts={})=>({id,name,owner,grid,fields:[...(opts.noBase?[]:base),...rows].map(field),mode:opts.mode||'Draf atau dikembalikan; sesudah diajukan baca saja. Revisi setelah posted melalui prosedur koreksi.',buttons:opts.buttons||'Simpan draf; Ajukan; Batal',result:opts.result||'Membentuk atau merevisi dokumen sumber; simpan draf belum posting.'});
export const forms=[
F('F01','Keputusan / pembatalan / pembalikan','Reviewer sesuai mandat','S01; S02',[
'Dokumen dan versi|Baca saja|Ya|Dokumen asal|Versi terkini; pemutus bukan pengaju jika kebijakan mensyaratkan',
'Tindakan|Pilihan|Ya|Aksi yang sah pada status ini|Setujui, kembalikan, tolak, batalkan atau balik dibedakan',
'Alasan|Teks|Wajib untuk kembali/tolak/batal/balik|Reviewer|Tersimpan bersama keputusan',
'Tanggal pembalikan|Tanggal|Jika membalik jurnal|Pengguna berwenang|Periode tujuan terbuka; tidak menghapus jurnal asal',
'Dampak|Baca saja|Otomatis|Dokumen, saldo, pembayaran dan jurnal terkait|Periksa pembayaran/penyelesaian sebelum membalik',
'Pemutus dan waktu|Baca saja|Otomatis|Sesi dan sistem|Tidak dapat diisi manual'
],{noBase:true,mode:'Saat aksi memang tersedia menurut status dan izin',buttons:'Konfirmasi tindakan; Batal',result:'Keputusan atau dokumen koreksi tertaut ke sumber; versi/riwayat tetap ada.'}),
F('F02','Pembayaran','Treasury; sumber kewajiban dari domain','S03',[
'Penerima|Referensi|Ya|Vendor/pegawai/pihak pada sumber|Alokasi harus kompatibel dengan penerima',
'Rekening sumber|Dropdown|Ya|Kas/bank aktif yang diizinkan|Pemetaan rekening, unit dan mata uang tersedia',
'Metode pembayaran|Dropdown|Ya|Transfer; tunai; giro sesuai konfigurasi|Giro membuka F05 dan menyimpan bank/instrumen yang sama',
'Nominal pembayaran Rp|Nominal|Ya|Pengguna atau alokasi|Positif; sesuai jumlah alokasi; uang muka memakai sumber yang sah',
'Alokasi kewajiban|Tabel anak|Ya untuk pembayaran kewajiban|Tagihan/payroll/pajak/pinjaman|Tidak melebihi sisa sumber; satu payment ID lintas menu',
'Tanggal rencana bayar|Tanggal|Jika terjadwal|Pengguna|Terpisah dari tanggal eksekusi aktual',
'Referensi bank|Teks|Saat eksekusi jika ada|Hasil bank|Tidak menganggap rencana sebagai pembayaran selesai',
'Bukti bayar|Dokumen|Saat konfirmasi sesuai metode|Hasil eksekusi|Dikaitkan ke payment, bukan lampiran terpisah tiap tagihan'
],{buttons:'Simpan draf; Ajukan pembayaran; Batal',result:'Satu payment dengan alokasi. Eksekusi kemudian memperbarui register, kewajiban dan jurnal terkait.'}),
F('F03','Penerimaan dan alokasi','Treasury / AR','S03',[
'Pihak pengirim|Referensi|Ya atau belum dikenali dengan alasan|Master pihak / hasil bank|Penerimaan belum dikenal masuk antrean alokasi, bukan pendapatan otomatis',
'Rekening tujuan|Dropdown|Ya|Kas/bank berizin|Unit dan mata uang konsisten',
'Nominal diterima Rp|Nominal|Ya|Mutasi bank/bukti kas|Positif; referensi bank tidak dipakai ganda',
'Sumber penerimaan|Pilihan|Ya|Invoice; settlement; modal; lainnya yang disahkan|Jenis sumber menentukan alokasi dan akun',
'Alokasi penerimaan|Tabel anak|Jika sumber diketahui|Dokumen sumber|Jumlah dialokasi tidak melebihi penerimaan dan sisa sumber',
'Referensi bank/kas|Teks / referensi|Sesuai metode|Bukti aktual|Tidak membuat ulang penerimaan saat rekonsiliasi'
]),
F('F04','Transfer dan pengisian kas','Treasury / kasir','S03',[
'Rekening asal|Dropdown|Ya|Kas/bank berizin|Berbeda dari tujuan',
'Rekening tujuan|Dropdown|Ya|Kas/bank berizin|Beda unit diarahkan ke Antarunit, bukan transfer satu unit',
'Nominal Rp|Nominal|Ya|Pengguna|Positif; mata uang sesuai dukungan',
'Biaya transfer Rp|Nominal|Jika ada|Bukti bank|Baris biaya sendiri dengan sumber transaksi sama',
'Penanggung jawab penerima|Referensi|Untuk penyerahan kas|Pihak berwenang|Konfirmasi serah terima sebelum label diterima',
'Bukti kirim/terima|Dokumen|Sesuai metode|Pemilik proses|Dua sisi uang tertaut ke satu transfer'
]),
F('F05','Giro','Treasury','S03; S04',[
'Pembayaran sumber|Referensi|Ya|Payment yang disiapkan|Satu alokasi kewajiban; tidak membuat payment ganda',
'Bank dan rekening|Dropdown|Ya|Rekening aktif berizin|Bank menentukan akun outstanding giro, bukan default BCA',
'Nomor giro|Teks identitas|Ya|Instrumen|Tidak duplikat pada bank/rekening yang sama',
'Penerima|Baca saja / referensi|Ya|Payment|Konsisten dengan alokasi',
'Nominal Rp|Baca saja|Ya|Payment/alokasi|Jumlah giro sesuai payment',
'Tanggal terbit|Tanggal|Ya|Pengguna|Periode terbuka',
'Tanggal jatuh tempo|Tanggal|Ya|Instrumen|Tidak sebelum terbit',
'Tanggal cair/ditolak|Tanggal|Saat kejadian aktual|Bank|Terpisah dari jatuh tempo',
'Bukti instrumen/kejadian|Dokumen|Sesuai tahap|Bank/Treasury|Pencairan, penolakan dan pembatalan punya jejak'
],{buttons:'Simpan draf; Ajukan penerbitan; Batal'}),
F('F06','Rekonsiliasi bank','Treasury','S05',[
'Rekening|Dropdown|Ya|Rekening berizin|Satu rekening per sesi impor/cocokkan',
'Periode mutasi|Rentang tanggal|Ya|Statement bank|Tampilkan cakupan yang diimpor',
'File/asal statement|File / referensi|Saat impor|Bank|Pratinjau; cek baris duplikat sebelum simpan',
'Baris bank|Baca saja|Ya|Statement|Nilai asli tidak diedit agar cocok',
'Pasangan buku|Pilihan jamak|Saat cocokkan|Payment/receipt/jurnal|Arah, rekening, nominal dan alokasi kompatibel',
'Nominal dicocokkan Rp|Nominal alokasi|Jika parsial|Sisa bank dan buku|Tidak melebihi sisa salah satu sisi',
'Penanganan selisih|Pilihan + alasan|Jika ada selisih|Biaya/pendapatan/koreksi sumber sesuai mandat|Bukan jurnal selisih otomatis tanpa dasar'
],{noBase:true,buttons:'Pratinjau impor / Cocokkan; Batal',result:'Pasangan bank–buku tersimpan; jika perlu transaksi baru, dibuat dengan ID baris bank sebagai sumber.'}),
F('F07','Tagihan vendor','AP','S06; S07',[
'Vendor|Dropdown|Ya|Master pihak|Aktif dan rekening pembayaran diverifikasi sesuai kebijakan',
'Nomor invoice vendor|Teks|Ya|Invoice|Peringatan/cek duplikat vendor + nomor + konteks',
'Tanggal invoice|Tanggal|Ya|Invoice|Terpisah dari tanggal pencatatan bila diperlukan',
'Jatuh tempo|Tanggal|Ya atau dihitung dari termin|Termin/vendor|Terlihat sebelum ajukan pembayaran',
'Jenis tagihan|Dropdown|Ya|Barang; jasa; aset; proyek; lainnya sah|Tidak memetakan semua biaya ke listrik',
'PO / penerimaan|Referensi|Jika berbasis pembelian barang|Dokumen operasi|Cocokkan hanya ketika proses membutuhkan, bukan wajib untuk semua jasa',
'Rincian biaya/barang|Tabel anak|Ya|Invoice dan kategori|Qty/harga/jenis/unit biaya/pajak per baris; S06',
'Pajak dan potongan|Tabel anak|Jika relevan|Aturan/dokumen yang disahkan|Tidak menetapkan tarif baru di UI',
'Total dan sisa Rp|Baca saja|Otomatis|Baris dan alokasi pembayaran|Tidak diedit manual'
]),
F('F08','Klaim pengeluaran','Pengaju / AP','S06; S01',[
'Pengaju/penerima penggantian|Referensi|Ya|Pegawai/pihak berizin|Sesuai unit dan hak',
'Keperluan|Teks|Ya|Pengaju|Dasar pengeluaran dapat ditinjau',
'Rincian bukti|Tabel anak|Ya|Nota/kuitansi|Setiap baris punya tanggal, kategori, nilai dan bukti',
'Sumber uang muka|Referensi|Jika menggunakan uang muka|ADV|Arahkan ke pertanggungjawaban; jangan klaim biaya sama dua kali',
'Total klaim Rp|Baca saja|Otomatis|Rincian|Sesuai bukti dan potongan terkait'
]),
F('F09','Uang muka operasional','Pengaju / AP','S03; S08',[
'Pemegang uang muka|Referensi|Ya|Pegawai/pihak berizin|Berbeda dari pinjaman pegawai jika tujuan operasional',
'Tujuan|Teks|Ya|Pengaju|Menjadi dasar persetujuan',
'Nominal diminta Rp|Nominal|Ya|Pengaju|Positif',
'Batas pertanggungjawaban|Tanggal|Sesuai kebijakan|Pemilik proses|Tenggat terlihat di antrean',
'Sumber pembayaran|Referensi|Sesudah disiapkan|F02|Satu payment untuk pencairan; tidak input status dibayar manual'
]),
F('F10','Pertanggungjawaban uang muka','Pemegang / AP','S08; S06',[
'Uang muka sumber|Referensi|Ya|ADV terbuka|Pemegang/unit sesuai',
'Biaya aktual|Tabel anak|Jika ada|Bukti biaya|Kategori tiap baris menentukan pencatatan, bukan default housekeeping',
'Pengembalian Rp|Nominal|Jika ada sisa dikembalikan|Bukti penerimaan|Tertaut F03; tidak hanya mengurangi saldo register',
'Tambahan penggantian Rp|Baca saja / usulan|Jika biaya disetujui melebihi uang muka|Perhitungan|Tertaut kewajiban dan F02 baru setelah keputusan',
'Sisa yang belum selesai Rp|Baca saja|Otomatis|ADV, biaya disetujui, pengembalian|Tidak dipaksa nol'
]),
F('F11','Biaya dibayar di muka','AP / Akuntansi','S09',[
'Tagihan sumber|Referensi|Ya|BILL disetujui/tercatat|Tidak membentuk biaya awal kedua',
'Jenis manfaat|Dropdown|Ya|Sewa; asuransi; lainnya disahkan|Kelas/jadwal tidak selalu sewa',
'Mulai manfaat|Tanggal|Ya|Kontrak|Tidak ambigu dengan tanggal bayar',
'Akhir manfaat|Tanggal|Ya|Kontrak|Sesudah/sama mulai sesuai kebijakan',
'Dasar yang dialokasikan Rp|Nominal sumber|Ya|Baris tagihan|Tidak melebihi nilai belum dialokasikan',
'Metode/jadwal|Dropdown + pratinjau|Ya|Kebijakan berlaku|Total alokasi tidak melebihi dasar; sisa terjelaskan'
]),
F('F12','Tagihan pelanggan / nota kredit','AR','S06; S07',[
'Pelanggan|Dropdown|Ya|Master pihak|Sesuai unit/sumber pendapatan',
'Jenis dokumen|Pilihan|Ya|Invoice; nota kredit|Nota kredit harus merujuk sumber sesuai proses',
'Sumber jasa/penjualan|Referensi|Ya|Dokumen bisnis|Tidak mengakui penjualan yang sama dua kali',
'Rincian tagihan|Tabel anak|Ya|Barang/jasa, kuantitas, harga|Akun pendapatan sesuai jenis; pajak sesuai aturan sah',
'Jatuh tempo|Tanggal|Untuk invoice|Termin|Terlihat di umur piutang',
'Dokumen asal kredit|Referensi|Untuk nota kredit|Invoice/retur|Tidak melebihi bagian yang dapat dikreditkan',
'Total Rp|Baca saja|Otomatis|Rincian|Terpisah dari jumlah diterima'
]),
F('F13','Settlement kanal','AR / Treasury','S10; S03',[
'Kanal/acquirer|Dropdown|Ya|Master kanal|Pemetaan unit dan rekening tersedia',
'Batch/periode statement|Referensi / tanggal|Ya|Statement kanal|Cegah statement/batch ganda',
'Transaksi penjualan|Tabel pasangan|Ya|SALE sumber|Transaksi tidak dialokasikan melebihi sisa',
'Bruto Rp|Baca saja|Ya|Transaksi sumber|Rekonsiliasi ke statement',
'Biaya dan potongan Rp|Baris nominal|Sesuai statement|Statement|Biaya kartu melekat pada settlement; tidak ditagihkan ulang',
'Neto seharusnya Rp|Baca saja|Otomatis|Bruto dikurangi potongan|Selisih harus dijelaskan',
'Penerimaan terkait|Referensi|Saat dana diterima|RCPT|Satu penerimaan yang sama di Kas & Bank'
]),
F('F14','Uang muka pelanggan / refund','AR / Treasury','S03; S06',[
'Pelanggan|Referensi|Ya|Master pelanggan|Sesuai sumber',
'Jenis tindakan|Pilihan|Ya|Catat uang muka; alokasikan; ajukan refund|Field berubah sesuai tindakan',
'Pesanan/invoice/retur sumber|Referensi|Ya sesuai tindakan|Dokumen bisnis|Satu sumber dan sisa yang sah',
'Nominal Rp|Nominal|Ya|Sisa uang muka/refund disetujui|Tidak melebihi hak/saldo sumber',
'Penerimaan/pembayaran|Referensi|Saat eksekusi|F03/F02|Refund tidak dianggap selesai sebelum payment hasil aktual'
]),
F('F15','Penilaian penerimaan / pemakaian','Finance persediaan','S11',[
'Dokumen barang sumber|Referensi|Ya|Operasi gudang/toko|Tidak membuat penerimaan fisik kedua',
'Jenis pergerakan|Baca saja|Ya|Dokumen sumber|Penerimaan/pemakaian/retur sesuai fakta',
'Rincian barang|Tabel anak|Ya|Sumber operasi|Qty sumber baca saja; nilai menurut harga/metode sah',
'Nilai yang perlu ditinjau Rp|Nominal terbatas|Jika metode mengizinkan|Invoice/metode penilaian|Perubahan nilai memiliki dasar dan keputusan',
'Tagihan terkait|Referensi|Jika dari vendor|BILL|Jumlah/harga dapat ditelusuri'
]),
F('F16','Pengiriman / penerimaan antarunit','Operasi dan finance persediaan','S11; S12',[
'Pengiriman sumber|Referensi|Ya|Operasi|Satu ID pengiriman',
'Unit asal|Baca saja|Ya|Pengiriman|Berbeda dari tujuan',
'Unit tujuan|Baca saja|Ya|Pengiriman|Unit penerima sesuai izin',
'Rincian kirim/terima|Tabel anak|Ya|Bukti operasi|Boleh parsial; tidak menerima dua kali bagian sama',
'Tanggal dan bukti terima|Tanggal + dokumen|Saat konfirmasi terima|Penerima|Selisih kuantitas/nilai masuk penanganan, bukan diabaikan',
'Pasangan antarunit|Baca saja|Otomatis|Dokumen sumber|Keluarga barang; bukan pembiayaan'
]),
F('F17','Opname / penyesuaian persediaan','Finance persediaan / reviewer','S11',[
'Opname sumber|Referensi|Ya|Hasil hitung operasi|Tanggal dan cakupan hitung jelas',
'Barang/lokasi|Referensi|Ya|Master dan sumber hitung|Unit/lokasi sesuai izin',
'Qty buku|Baca saja|Otomatis|Snapshot pada waktu hitung|Tidak memakai saldo hari ini untuk hitung masa lalu tanpa penjelasan',
'Qty fisik|Angka|Ya|Hasil hitung|Satuan valid dan bukti hitung',
'Selisih/dampak Rp|Baca saja|Otomatis|Qty dan penilaian|Tidak diedit langsung untuk memaksa cocok',
'Alasan penyesuaian|Pilihan + teks|Ya|Reviewer/sumber hitung|Keputusan sebelum posting'
]),
F('F18','Transaksi / penyelesaian antarunit','Finance unit / HO','S12; S03',[
'Jenis hubungan|Dropdown|Ya|Barang; pendanaan; jenis lain yang disahkan|Tidak selalu memakai keluarga utang barang',
'Unit lawan|Dropdown|Ya|Unit/pihak afiliasi sah|Berbeda dari unit sendiri',
'Jenis tindakan|Pilihan|Ya|Bentuk saldo; alokasi biaya; penyelesaian|Field dan rule mengikuti jenis hubungan',
'Dokumen sumber|Referensi|Ya|Shipment/keputusan pembiayaan/alokasi|Barang membaca sumber operasi, bukan dibuat ulang',
'Nominal Rp|Nominal|Ya|Sumber/sisa saldo|Penyelesaian tidak melebihi bagian yang dipilih',
'Pembayaran dan alokasi|Referensi/tabel|Untuk pelunasan|F02/F03|Mengurangi keluarga yang sama; kedua pihak tertaut',
'Dasar/konfirmasi lawan|Dokumen/referensi|Sesuai jenis|Pihak terkait|Saldo dua pihak dapat direkonsiliasi'
]),
F('F19','Rekonsiliasi saldo / kasus selisih','Pemilik register / Akuntansi','S13',[
'Unit/periode/kelompok|Referensi|Ya|Konteks rekonsiliasi|Cakupan jelas',
'Saldo GL / pihak pertama Rp|Baca saja|Otomatis|Buku/sumber|Tanggal posisi sama',
'Saldo rincian / pihak kedua Rp|Baca saja|Otomatis|Register/pihak lawan|Tidak diedit agar cocok',
'Kasus selisih|Tabel anak|Jika ada|Perbandingan sumber|Nominal, penyebab, owner dan sumber koreksi',
'Bukti dan kesimpulan|Dokumen + teks|Saat review|Pemilik rekonsiliasi|Selisih diselesaikan pada sumber atau pengecualian sah'
],{noBase:true,buttons:'Simpan hasil; Ajukan review; Batal',result:'Bukti rekonsiliasi; koreksi dilakukan pada sumber yang salah, bukan jurnal otomatis tanpa dasar.'}),
F('F20','Proyek / kapitalisasi aset','Akuntan aset','S14; S15',[
'Jenis tindakan|Pilihan|Ya|Buat proyek; tautkan biaya; kapitalisasi|Form mengikuti tindakan',
'Proyek|Referensi|Jika terkait proyek|Register proyek|Unit dan owner jelas',
'Biaya sumber|Tabel anak|Ya untuk kapitalisasi|Baris tagihan/proyek|Tidak dialokasikan dua kali atau melebihi sisa',
'Komponen aset/kelas|Tabel anak|Ya untuk kapitalisasi|Master aset/kebijakan|Kelas tidak default satu jenis untuk semua aset',
'Tanggal siap pakai|Tanggal|Saat kapitalisasi|Bukti operasional|Dasar awal penyusutan menurut kebijakan',
'Umur manfaat/metode|Pilihan/angka|Sesuai kelas|Kebijakan disahkan|Tidak mengarang kebijakan umur manfaat',
'Nilai kapitalisasi Rp|Baca saja|Otomatis|Biaya disetujui|Sisa biaya dibebankan/ditahan dengan dasar'
]),
F('F21','Transfer / pelepasan aset','Akuntan aset / reviewer','S14; S03',[
'Aset|Referensi|Ya|Register aset|Status memungkinkan tindakan',
'Jenis tindakan|Dropdown|Ya|Transfer; jual; hapus sesuai mandat|Field sumber/penerima mengikuti jenis',
'Tujuan/pihak|Referensi|Sesuai tindakan|Unit/pembeli|Transfer beda unit memicu pasangan yang sesuai',
'Nilai buku Rp|Baca saja|Otomatis|Register + GL tanggal efektif|Tidak diketik manual',
'Nilai pelepasan Rp|Nominal|Jika dijual|Keputusan/dokumen penjualan|Penerimaan ditautkan melalui F03',
'Bukti serah terima/keputusan|Dokumen|Ya|Owner aset/reviewer|Tidak menyatakan selesai tanpa hasil pelaksanaan'
]),
F('F22','Jadwal pengakuan / posting periodik','Akuntansi','S09',[
'Jadwal sumber|Referensi|Ya|Prepaid/aset/akrual sah|Satu jadwal dan sumber',
'Jenis pengakuan|Baca saja/pilihan|Ya|Jadwal/kebijakan|Sewa, aset, akrual dan lainnya dipisahkan',
'Periode tujuan|Periode|Ya|Periode terbuka|Tidak posting periode tertutup',
'Baris pengakuan|Tabel anak|Ya|Jadwal|Jumlah, unit dan akun sesuai sumber; periode tidak diposting dua kali',
'Nominal periode Rp|Baca saja|Otomatis|Jadwal dan perubahan disetujui|Perubahan dasar dilakukan lewat jadwal/sumber',
'Tanggal pembalikan|Tanggal|Jika rule membutuhkan|Kebijakan|Tertaut pada jurnal asal'
],{buttons:'Tinjau; Ajukan posting; Batal'}),
F('F23','Penerimaan batch payroll HR','Finance payroll','S16; S17',[
'Run dan versi HR|Referensi|Ya|HR approved, lengkap dan dikunci|Tidak menerima draft/incomplete/sealed versi lama yang digantikan',
'Unit dan periode batch|Baca saja|Ya|Snapshot HR|Sesuai izin; bukan ditentukan ulang Finance',
'Pegawai dan komponen|Tabel baca saja|Ya|Snapshot HR|Finance tidak menghitung ulang atau mengedit gaji',
'Pemetaan pencatatan|Referensi/validasi|Ya|Pengaturan Finance|Komponen dan unit harus terpetakan',
'Selisih/penolakan|Teks + referensi|Jika tidak cocok|Finance|Dikembalikan ke sumber HR untuk versi revisi',
'ID penerimaan|Baca saja|Otomatis|Sistem|Pengiriman ulang versi sama tidak menggandakan kewajiban'
],{noBase:true,buttons:'Terima batch / Kembalikan ke HR; Batal',result:'Kewajiban dan referensi batch versi yang sama; pembayaran melalui F02, bukan status dibayar manual.'}),
F('F24','Pinjaman pegawai / pelunasan','Finance payroll','S03; S17',[
'Pegawai|Referensi|Ya|HR/master berizin|Hak nominal dan unit sesuai',
'Pokok pinjaman Rp|Nominal|Saat pencairan|Keputusan pinjaman|Positif dan dasar disetujui',
'Cara pelunasan|Dropdown|Ya|Potongan payroll; penerimaan kas/bank|Keduanya menghasilkan referensi jurnal/alokasi',
'Jadwal/nominal potongan|Tabel jadwal|Jika payroll|Keputusan dan batch HR|Tidak memotong lebih dari sisa; diselaraskan dengan HR',
'Pembayaran awal / batch / penerimaan|Referensi|Sesuai tahap|PAY; HR run; RCPT|Mengubah register hanya dengan sumber posting terkait',
'Sisa piutang Rp|Baca saja|Otomatis|Pokok dan pelunasan tercatat|Tidak ada tombol kurangi saldo tanpa jurnal'
]),
F('F25','Dokumen / kewajiban pajak','Tim pajak','S07; S03',[
'Jenis pajak|Dropdown|Ya|Master yang divalidasi tim pajak|Tidak diturunkan hanya dari digit akun',
'Masa pajak|Periode|Ya|Dokumen sumber|Berbeda dari tanggal bayar/lapor',
'Dokumen sumber|Referensi|Ya|Tagihan/penjualan/payroll|Tidak membuat kewajiban sama dua kali',
'Nomor dokumen pajak|Teks|Sesuai jenis|Dokumen resmi|Cek duplikat sesuai konteks',
'Dasar dan nilai pajak Rp|Baca saja / input terkontrol|Sesuai sumber|Dokumen dan aturan sah|Tarif/aturan tidak dikarang oleh desain UI',
'Tenggat bayar/lapor|Tanggal terpisah|Sesuai jenis|Kalender disahkan|Status bayar dan lapor terpisah',
'Koreksi sumber|Referensi + alasan|Jika berubah|Dokumen pembetulan|Versi dan dampak terjaga'
]),
F('F26','Pelaporan pajak','Tim pajak','S01; S07',[
'Jenis dan masa|Referensi|Ya|Kewajiban/dokumen pajak|Cakupan unit jelas',
'Dokumen yang dilaporkan|Tabel referensi|Ya|Dokumen pajak|Tidak menyatakan dibayar hanya karena dilaporkan',
'Versi laporan|Baca saja/pilihan|Ya|Awal; pembetulan|Pembetulan tertaut ke versi sebelumnya',
'Tanggal lapor aktual|Tanggal|Saat dilaporkan|Hasil pelaporan|Bukan rencana tanggal',
'Nomor tanda terima|Teks|Sesuai pelaporan|Hasil pelaporan|Tertaut pada masa dan versi',
'Bukti pelaporan|Dokumen|Saat selesai|Hasil pelaporan|Label dilaporkan memerlukan bukti sesuai proses'
]),
F('F27','Kontrak pinjaman dan angsuran','Treasury','S18; S03',[
'Pemberi dana|Referensi|Ya|Bank/pihak sah|Tidak selalu satu bank default',
'Nomor kontrak|Teks|Ya|Kontrak|Identitas dan versi',
'Pokok disepakati Rp|Nominal|Ya|Kontrak|Terpisah dari pencairan aktual',
'Tanggal mulai dan jatuh tempo|Tanggal terpisah|Ya|Kontrak|Urutan valid',
'Jadwal pokok/bunga/biaya|Tabel anak|Ya jika angsuran|Kontrak disahkan|Total pokok dan sisa dapat dijelaskan; bunga tidak dikarang',
'Rekening pencairan|Referensi|Saat pencairan|Kas & Bank|Tautkan F03',
'Pembayaran angsuran|Referensi|Saat bayar|F02|Alokasi pokok, bunga dan biaya terpisah'
]),
F('F28','Transaksi modal / distribusi','Akuntan / pemutus berwenang','S19; S03',[
'Pemilik|Referensi|Ya|Master pemilik|Sesuai dasar keputusan',
'Jenis perubahan|Dropdown|Ya|Setoran; distribusi; perubahan lain sah|Tidak memasukkan utang operasional sebagai modal',
'Dasar keputusan|Dokumen/referensi|Ya|Keputusan pemilik/organisasi|Tanggal dan mandat jelas',
'Nominal Rp|Nominal|Ya|Keputusan|Kategori menentukan pencatatan',
'Rekening/uang terkait|Referensi|Jika ada kas|F02/F03|Satu receipt/payment',
'Hasil periode|Baca saja|Jika ditampilkan|GL/laporan/periode|Bukan field input laba manual'
]),
F('F29','Jurnal manual','Akuntansi','S20',[
'Jenis jurnal|Dropdown|Ya|Jenis yang disahkan|Jurnal otomatis dikoreksi dari sumber',
'Rincian akun/unit|Tabel anak|Ya|COA dan dimensi berizin|Aktif, postable, unit dan izin sesuai',
'Debit/kredit Rp|Nominal per baris|Ya|Akuntan|Tepat satu sisi per baris; jumlah debit = kredit',
'Referensi sumber|Referensi|Jika ada|Dokumen terkait|Cegah pencatatan ganda kejadian yang sudah punya dokumen',
'Alasan jurnal|Teks|Ya|Akuntan|Dapat ditinjau reviewer',
'Pembalikan terjadwal|Tanggal/pilihan|Jika diperlukan|Kebijakan|Tertaut jurnal asal; periode valid'
],{buttons:'Simpan draf; Ajukan review; Batal'}),
F('F30','Tutup / buka kembali periode','Controller / Akuntansi','S21; S13',[
'Unit dan periode|Referensi|Ya|Konteks yang diizinkan|Cakupan jelas',
'Checklist dan masalah terbuka|Baca saja + referensi|Ya|Domain dan rekonsiliasi|Tidak mengubah kesiapan dengan centang manual',
'Hasil laporan/ekuitas|Baca saja|Ya saat final|GL dan rekonsiliasi|Laba dapat ditelusuri; bukan fixture angka tetap',
'Alasan penutupan/pembukaan|Teks|Ya|Pemutus berwenang|Pembukaan menyebut dampak dan pekerjaan ulang',
'Keputusan|Aksi berizin|Ya|Mandat|Pisahkan persiapan, review dan tutup',
'Riwayat periode|Baca saja|Otomatis|Sistem|Siapa/kapan/versi tetap tersimpan'
],{noBase:true,buttons:'Ajukan review / Tutup / Ajukan buka ulang; Batal',result:'Status periode dan bukti terkait berubah melalui keputusan sah; bukan mengarang jurnal penutup otomatis.'}),
F('F31','COA','Admin Finance / reviewer','S22',[
'Kode akun|Teks identitas|Ya|COA disahkan|Simpan utuh; unik; bukan scientific notation',
'Nama akun|Teks|Ya|Kebijakan COA|Perubahan punya versi/riwayat',
'Induk/level|Referensi|Ya sesuai hierarki|Master COA|Hierarki sah; tidak membuat akun turunan fiktif',
'Unit|Referensi|Sesuai akun|Master unit|Dimensi sesuai struktur',
'Aktif|Pilihan|Ya|Keputusan master|Aktif berbeda dari izin posting',
'Izin posting|Pilihan|Ya setelah kebijakan jelas|Aturan postable|Induk/akun khusus tidak dianggap boleh otomatis',
'Kelompok laporan|Referensi|Ya|Pemetaan laporan|Kode khusus memerlukan keputusan, bukan digit pertama saja',
'Mulai berlaku/alasan|Tanggal + teks|Ya untuk perubahan|Keputusan|Histori transaksi tidak rusak'
],{noBase:true}),
F('F32','Pemetaan transaksi','Admin Finance / reviewer','S22; S20',[
'Kejadian dan peran akun|Referensi|Ya|Katalog rule|Kejadian berbeda tidak disatukan karena kebetulan akun sama',
'Unit|Dropdown|Ya|Unit berizin|Cakupan pemetaan eksplisit',
'Bank/kelas/jenis hubungan|Dimensi dinamis|Jika rule membutuhkan|Master dimensi|Giro memakai bank; antarunit memakai keluarga; aset memakai kelas',
'Akun tujuan|Dropdown|Ya|COA sah|Aktif, postable, unit dan kebijakan cocok',
'Prioritas/masa berlaku|Angka/tanggal|Jika beberapa pemetaan|Kebijakan resolusi|Tidak ada kecocokan ambigu',
'Sampel simulasi|Input uji + baca hasil|Sebelum aktivasi|Konteks rule|Tampilkan akun dan debit/kredit hasil, termasuk kasus salah',
'Aktivasi/alasan|Pilihan + teks|Ya|Keputusan reviewer|Rule sengaja nonaktif tidak diaktifkan hanya karena akun ada'
],{noBase:true,buttons:'Simpan draf; Simulasikan; Ajukan; Batal'}),
F('F33','Master rekening / pihak','Admin Finance / reviewer','S22',[
'Jenis master|Dropdown|Ya|Rekening; kas; vendor; pelanggan; pemilik; pihak lain|Form berubah mengikuti jenis',
'Kode dan nama|Teks terpisah|Ya|Pemilik master|Satu ID dipakai lintas menu',
'Unit/cakupan|Referensi|Ya sesuai jenis|Master unit|Tidak memberi hak lintas unit dari lokasi saja',
'Bank/nomor rekening|Referensi/teks sensitif|Untuk rekening|Bukti rekening|Nomor dimasking di daftar; akses penuh hanya yang perlu',
'Mata uang|Dropdown|Untuk rekening/transaksi terkait|Master yang didukung|Tidak mengasumsikan konversi tersedia',
'Identitas/kontak pihak|Field sesuai jenis|Sesuai jenis|Bukti pihak|Data sensitif sesuai hak',
'Status aktif dan masa berlaku|Pilihan/tanggal|Ya|Keputusan|Nonaktif tidak menghapus histori',
'Pemetaan terkait|Referensi|Jika diperlukan|F32|Terdaftar belum berarti siap digunakan'
],{noBase:true}),
F('F34','Kebijakan / akses Finance','Pemilik kebijakan / reviewer','S22',[
'Jenis konfigurasi|Dropdown|Ya|Kebijakan; jadwal; peran; persetujuan|Editor sesuai kategori',
'Lingkup|Referensi|Ya|Unit/kelas/jenis transaksi|Cakupan eksplisit',
'Parameter/peran/tindakan|Tabel input terkontrol|Ya|Master/mandat disahkan|Tipe sesuai parameter; akses tidak berupa teks bebas',
'Batas mandat|Nilai/kondisi|Sesuai kebijakan|Keputusan organisasi|Tidak mengarang batas nominal standar',
'Mulai/akhir berlaku|Tanggal terpisah|Mulai wajib|Keputusan|Versi tidak tumpang tindih ambigu',
'Dasar/alasan|Dokumen + teks|Ya|Pemilik kebijakan|Efek pada objek aktif harus ditinjau',
'Reviewer dan hasil|Baca saja|Otomatis|Keputusan|Tidak self-grant hak tanpa mandat'
],{noBase:true}),
F('F35','Impor / ekspor dan laporan','Pembaca/pengimpor berizin','S23',[
'Jenis pekerjaan|Pilihan|Ya|Impor penjualan/statement; laporan/ekspor|Tidak memperlakukan semua impor sebagai posting',
'Unit/periode/filter|Referensi|Ya|Konteks layar|Hak akses dan seluruh filter ikut hasil',
'File sumber|Upload|Jika impor|Sumber bisnis|Pratinjau, validasi kolom, deteksi duplikat dan hasil per baris',
'Pemetaan kolom|Pilihan|Jika diperlukan|Header sumber|Identitas/tanggal/nominal terinterpretasi benar',
'Cakupan laporan|Pilihan unit dan versi|Jika laporan|Data yang diizinkan|Konsolidasi mencakup semua unit terpilih dan status kesiapan',
'Format/kolom ekspor|Pilihan|Jika ekspor|Kolom yang boleh dilihat|Data sensitif tidak bocor lewat ekspor'
],{noBase:true,buttons:'Pratinjau; Konfirmasi impor / Ekspor; Batal',result:'Hasil sesuai konteks; impor memberi hasil per baris, laporan tetap baca saja.'})
];

// Button: label, actor, state, guard, form/destination, result.
const A=(label,actor,state,guard,form,result)=>[label,actor,state,guard,form,result];
const view=(label,dest)=>A(label,'Pembaca berizin','Sumber tersedia','Hak objek tujuan dan unit diperiksa',dest,'Membuka dokumen yang sama; tidak mengubah data');
const edit=(form,actor='Pemilik dokumen')=>A('Ubah draf',actor,'Draf / dikembalikan','Versi terbaru dan dalam cakupan',form,'Masuk form; sumber final belum berubah');
const submit=form=>A('Ajukan','Pengaju berizin','Draf / dikembalikan','Field/bukti lengkap; rincian valid; belum duplikat',form,'Dokumen terkunci untuk review');
const approve=()=>A('Setujui','Reviewer sesuai mandat','Menunggu review','Versi terbaru; mandat/nominal/unit sah; pemisahan orang sesuai kebijakan','F01','Keputusan disimpan; tidak berarti sudah dibayar');
const back=()=>A('Kembalikan','Reviewer sesuai mandat','Menunggu review','Alasan dan bagian yang harus diperbaiki wajib','F01','Pemohon dapat merevisi versi pengajuan');
const reverse=()=>A('Ajukan koreksi / pembalikan','Pemilik / Akuntansi','Sudah tercatat','Periksa pembayaran, periode dan dokumen turunan; alasan wajib','F01','Dokumen koreksi tertaut; jurnal lama tidak dihapus');
const work=form=>[edit(form),submit(form),approve(),back(),reverse()];
const pay=()=>A('Siapkan pembayaran','Pemilik kewajiban / Treasury','Disetujui dan masih bersisa','Sisa sumber benar; tidak sudah dibayar/diproses; bank/unit sah','F02','Satu payment beralokasi; terlihat di Kas & Bank dan sumber');
const S=(forms,grids,sections,actions,layout='Sidebar detail; form sebagai mode terpisah')=>({forms,grids,sections,actions,layout});
export const configs=[
[
S('—','S02','Ringkasan pekerjaan; tenggat; pemilik; sumber',[view('Buka pekerjaan','Menu pemilik sumber')]),
S('F01','S01; S02','Ringkasan dampak; rincian sumber; perubahan; bukti; keputusan',[view('Buka sumber','Dokumen sumber'),approve(),back(),A('Tolak','Reviewer','Menunggu review','Alasan wajib; mandat sesuai','F01','Pengajuan ditolak tanpa eksekusi')]),
S('F19','S13; S02','Penyebab; dampak; owner; tindak lanjut; bukti',[view('Buka sumber masalah','Domain sumber'),A('Tugaskan','Koordinator','Terbuka','Owner tujuan berwenang','F19','Owner dan tenggat tercatat'),A('Selesaikan kasus','Reviewer/owner','Ditangani','Bukti sumber teratasi; bukan hanya centang','F19','Kasus ditutup dengan jejak')])
],
[
S('F33; F04','S04','Identitas rekening; saldo buku/bank; mutasi; rekonsiliasi',[view('Lihat mutasi','Mutasi rekening'),A('Transfer / isi kas','Treasury','Rekening aktif','Rekening siap dan unit sama; beda unit ke Antarunit','F04','Draf transfer'),view('Ajukan perubahan master','F33')]),
S('F02; F03; F01','S03; S04; S20; S02','Pihak/rekening/metode; alokasi; bukti; jurnal; riwayat',[edit('F02 / F03'),submit('F02 / F03'),approve(),A('Eksekusi pembayaran','Treasury','Disetujui','Jumlah/alokasi/rekening benar; belum diproses; ringkasan konsekuensi','F02','Status proses/hasil aktual dan jurnal terkait'),A('Alokasikan penerimaan','Treasury/AR','Penerimaan masih bersisa','Sisa penerimaan dan sumber cukup','F03','Alokasi tersimpan pada receipt yang sama'),reverse()]),
S('F04','S03; S04; S20','Asal/tujuan; nominal/biaya; bukti kirim-terima; mutasi',[...work('F04'),A('Konfirmasi transfer','Treasury / penerima kas','Disetujui / dikirim','Bukti eksekusi dan terima sesuai metode','F04','Kedua sisi transfer tertaut')]),
S('F05; F01','S03; S04; S20; S02','Instrumen/bank; alokasi; jatuh tempo; kejadian cair/ditolak; jurnal',[edit('F05'),submit('F05'),approve(),A('Terbitkan giro','Treasury','Disetujui','Nomor/bank/alokasi valid; akun outstanding sesuai bank','F05','Giro outstanding tertaut payment'),A('Catat pencairan','Treasury','Diterbitkan dan belum cair','Bukti aktual; bank sama; tidak dicatat dua kali','F05','Giro cair, bank dan outstanding diperbarui'),A('Catat ditolak / batalkan','Treasury / reviewer','Diterbitkan','Alasan/bukti; periksa belum cair; pembalikan yang sah','F01 / F05','Kejadian dan koreksi sumber tertaut')]),
S('F06','S05; S04','Baris bank; kandidat buku; alokasi; selisih; riwayat',[A('Cocokkan','Treasury','Belum / sebagian cocok','Sisa dua sisi, arah dan rekening kompatibel','F06','Pasangan tersimpan'),A('Lepas pasangan','Treasury berwenang','Cocok','Alasan wajib; periode rekonsiliasi memungkinkan','F06','Pasangan dilepas; jurnal tidak dihapus'),A('Buat biaya dari mutasi','Treasury berwenang','Belum cocok','Mutasi belum dipakai; kategori sah; review sesuai mandat','F06','Satu transaksi bersumber baris bank'),view('Buka transaksi buku','Payment/receipt/jurnal sumber')],'Halaman rekonsiliasi dua panel; detail baris bank di samping')
],
[
S('F07; F02','S06; S07; S03; S20; S02','Header vendor/nomor/tempo; rincian; sumber pembelian; pajak; pembayaran; jurnal',[...work('F07'),pay(),view('Buka pembayaran','PAY sumber')]),
S('F08; F02','S06; S01; S03; S20','Pengaju/keperluan; bukti per baris; keputusan; pembayaran',[...work('F08'),pay()]),
S('F09; F10; F02; F03','S08; S03; S20','Pemegang/tujuan; pencairan; biaya aktual; pengembalian; sisa',[...work('F09'),pay(),A('Pertanggungjawabkan','Pemegang/AP','Sudah dicairkan, masih terbuka','Bukti dan kategori biaya; tidak duplikat klaim','F10','Likuidasi dan sisa tertelusur'),A('Catat pengembalian','Treasury/AP','Ada sisa dikembalikan','Bukti kas/bank aktual; alokasi ADV benar','F03','Receipt terkait mengurangi sisa sesuai posting')]),
S('F11; F22','S09; S06; S20','Sumber tagihan; masa manfaat; jadwal; pengakuan; saldo',[...work('F11'),view('Tinjau pengakuan periode','F22'),view('Buka tagihan','BILL sumber')])
],
[
S('F35','S10; S07; S20','Penjualan sumber; tender/kanal; potongan; retur; jurnal',[view('Buka sumber penjualan','Sistem penjualan'),A('Validasi impor','AR','Diterima / perlu tinjau','Cek identitas, duplikat, unit, tanggal dan nominal','F35','Data tervalidasi atau baris ditolak dengan alasan'),view('Buka settlement','SET sumber')]),
S('F12; F03','S06; S07; S03; S20','Pelanggan/tempo; jasa/barang; kredit; penerimaan; sisa',[...work('F12'),A('Terbitkan invoice','AR berwenang','Disetujui','Sumber pendapatan dan versi sah','F12','Invoice terbit/tercatat sesuai proses'),A('Alokasikan penerimaan','AR/Treasury','Masih ada piutang','Receipt dan sisa invoice kompatibel','F03','Piutang teralokasi dengan receipt yang sama')]),
S('F13; F03','S10; S03; S05; S20','Kanal/batch; penjualan; biaya; neto; penerimaan; selisih',[edit('F13'),A('Cocokkan penjualan','AR','Belum selesai','Sumber penjualan dan statement tidak ganda','F13','Alokasi batch tertelusur'),A('Tautkan penerimaan','AR/Treasury','Dana diterima','Pakai RCPT yang sama; neto/selisih dijelaskan','F03 / F13','Settlement dan kas terhubung'),A('Selesaikan settlement','AR reviewer','Cocok lengkap','Bruto, biaya, neto dan penerimaan rekonsiliasi','F13','Settlement selesai'),reverse()]),
S('F14; F02; F03','S03; S06; S20','Pelanggan/sumber; uang muka/retur; alokasi; refund',[...work('F14'),A('Alokasikan uang muka','AR','Uang muka bersisa','Invoice dan pelanggan cocok; tidak melebihi sisa','F14','Saldo uang muka dialokasi'),pay()])
],
[
S('—','S11; S20','Barang/unit/tanggal posisi; kuantitas/nilai; mutasi; sumber',[view('Buka kartu stok','Mutasi persediaan'),view('Buka pergerakan','Dokumen barang')]),
S('F15','S11; S06; S20','Dokumen operasi; rincian kuantitas/nilai; invoice; jurnal',[view('Buka penerimaan / pemakaian','Operasi sumber'),A('Tinjau penilaian','Finance persediaan','Perlu validasi','Qty sumber tetap; metode/nilai punya dasar','F15','Validasi penilaian tertelusur'),view('Cocokkan tagihan','F07'),reverse()]),
S('F16','S11; S12; S20','Asal/tujuan; barang kirim/terima; bukti; nilai transit; pasangan',[view('Buka pengiriman','Operasi sumber'),A('Konfirmasi penerimaan','Penerima berwenang','Dikirim / sebagian diterima','Bukti aktual; qty belum diterima; rule sudah sah/aktif','F16','Penerimaan dan transit diperbarui satu sumber'),A('Tinjau selisih','Finance persediaan','Ada selisih','Penyebab/bukti dan owner jelas','F16 / F19','Kasus selisih terkait'),view('Buka pasangan antarunit','IC sumber')]),
S('F17','S11; S01; S20','Snapshot buku; hitung fisik; selisih; alasan; keputusan; jurnal',[...work('F17'),A('Posting penyesuaian','Akuntansi berwenang','Disetujui','Periode terbuka; belum diposting; sumber sah','F17','Jurnal penyesuaian tertaut opname')])
],
[
S('F19','S12; S13','Pasangan unit; jenis hubungan; dua sisi saldo; selisih',[view('Buka rincian pihak','Transaksi IC'),A('Rekonsiliasi','Finance antarunit','Data tersedia','Periode/kategori/pihak sama','F19','Bukti rekonsiliasi')]),
S('F18','S12; S20','Jenis hubungan; sumber; kedua pihak; nominal; pasangan jurnal',[...work('F18'),view('Buka dokumen sumber','Shipment/pendanaan/alokasi sumber')]),
S('F18; F02; F03','S12; S03; S20','Saldo dipilih; keluarga; nominal; payment; alokasi dua pihak',[edit('F18'),submit('F18'),approve(),pay(),A('Alokasikan penyelesaian','Finance antarunit','Payment aktual tersedia','Jenis pendanaan/barang tepat; sisa cukup; kedua pihak tertaut','F18','Mengurangi keluarga saldo yang sama'),reverse()]),
S('F19','S13; S12','Selisih dua pihak; bukti; sebab; koreksi sumber; kesimpulan',[edit('F19'),A('Tugaskan koreksi','Owner rekonsiliasi','Selisih terbuka','Pilih sumber yang salah dan owner','F19','Tindak lanjut pada sumber'),A('Selesaikan rekonsiliasi','Reviewer','Bukti lengkap','Selisih nol atau penanganan sah; jangan jurnal otomatis','F19','Hasil review tersimpan')])
],
[
S('F20; F21','S14; S09; S20','Identitas aset; biaya sumber; siap pakai; penyusutan; pergerakan',[view('Buka biaya sumber','BILL/PRJ'),A('Ajukan perubahan / pergerakan','Akuntan aset','Status aset memungkinkan','Dasar/kelas/tanggal sah','F20 / F21','Dokumen perubahan tertaut'),view('Buka jadwal','Jadwal aset')]),
S('F20','S15; S14; S06','Proyek/owner; biaya; alokasi; kesiapan kapitalisasi; sisa',[...work('F20'),A('Tautkan biaya','Akuntan aset','Proyek berjalan','Sisa biaya sumber tersedia; tidak duplikat','F20','Alokasi biaya proyek'),A('Kapitalisasi','Akuntan berwenang','Disetujui dan siap pakai','Bukti siap pakai; kelas dan sisa biaya tepat','F20','Aset terbentuk dari biaya yang sama')]),
S('F22','S09; S20','Dasar aset; metode; jadwal; periode; jurnal',[view('Buka aset / dasar','AST sumber'),A('Tinjau pengakuan','Akuntansi','Usulan periode','Jadwal sah; belum posted; periode terbuka','F22','Usulan siap review'),A('Posting periode','Akuntansi berwenang','Disetujui','Satu posting per jadwal/periode','F22','Jurnal penyusutan/amortisasi terkait')]),
S('F21; F03','S14; S03; S12; S20','Aset/saldo; tindakan; tujuan; dasar; serah terima; uang',[...work('F21'),A('Konfirmasi pelaksanaan','Pemilik proses','Disetujui','Bukti serah terima/penjualan; nilai buku benar','F21','Pergerakan aset dan jurnal tertaut'),view('Buka penerimaan penjualan','RCPT sumber')])
],
[
S('F23','S16; S17; S20','Run HR/unit/periode/versi; kelengkapan; komponen; mapping; kewajiban',[view('Buka batch HR','HR sumber'),A('Terima batch HR','Finance payroll','HR approved, lengkap, sealed','Versi/mapping sah; kirim ulang tidak ganda','F23','Kewajiban batch sumber tercatat sesuai proses'),A('Kembalikan ke HR','Finance payroll','Perlu perbaikan','Alasan dan komponen bermasalah jelas','F23','Permintaan revisi ke sumber, bukan edit gaji di Finance'),pay()]),
S('F02','S17; S03; S20','Batch; penerima; komponen; sisa; pembayaran/transfer gagal',[view('Buka batch','HR/Finance payroll sumber'),pay(),view('Buka pembayaran','PAY sumber'),A('Tinjau transfer gagal','Treasury','Ada kegagalan','Periksa hasil bank sebelum kirim ulang; tidak double pay','F02','Penanganan payment yang sama')]),
S('F24; F02; F03','S17; S03; S20','Pegawai; pokok; jadwal; pencairan; pelunasan; sisa',[...work('F24'),pay(),A('Tautkan potongan payroll','Finance payroll','Batch/komponen potongan sah','Potongan memiliki batch dan jurnal; tidak kurangi register saja','F24','Pelunasan tertaut sumber payroll'),A('Alokasikan penerimaan','Treasury','Dana pelunasan diterima','Receipt dan sisa piutang sesuai','F03 / F24','Pelunasan tertaut kas dan jurnal')]),
S('F19','S13; S16; S17','Batch; kewajiban; potongan; pembayaran; selisih',[view('Buka batch','PAYROLL sumber'),view('Buka pembayaran','PAY sumber'),A('Simpan hasil rekonsiliasi','Finance payroll / reviewer','Bukti tersedia','Bandingkan versi/unit/periode yang sama','F19','Kesimpulan tertelusur')])
],
[
S('F25; F02','S07; S03; S20','Jenis/masa; sumber; terutang; pembayaran; status lapor terpisah',[view('Buka dokumen dasar','TD sumber'),edit('F25'),submit('F25'),approve(),pay(),view('Buka pelaporan','TF sumber')]),
S('F25','S07; S01','Nomor/jenis/masa; pihak; sumber; nilai; bukti; pembetulan',[...work('F25'),A('Cocokkan dokumen','Tim pajak','Perlu cocokkan','Sumber dan nomor/masa/nilai sesuai','F25','Hasil cocok atau kasus selisih')]),
S('F02; F25','S03; S07; S20','Kewajiban; payment; referensi billing; bukti; alokasi',[pay(),view('Buka payment','PAY Kas & Bank'),A('Tautkan bukti bayar','Tim pajak/Treasury','Pembayaran aktual tersedia','Bukti cocok payment/masa; tidak mengubah status lapor','F02 / F25','Bukti dan alokasi tercatat')]),
S('F26','S07; S01; S02','Jenis/masa/versi; dokumen; pembayaran terkait; tanda terima',[edit('F26'),submit('F26'),approve(),A('Catat pelaporan','Tim pajak','Sudah dilaporkan aktual','Tanggal dan tanda terima sesuai; status bayar tetap terpisah','F26','Status dilaporkan dengan bukti'),A('Buat pembetulan','Tim pajak','Laporan sudah ada','Referensi versi sebelumnya dan alasan','F26','Versi pembetulan, tidak menimpa histori')])
],
[
S('F27; F03','S18; S03; S20','Kontrak/pemberi dana; pokok; pencairan; jadwal; perubahan',[...work('F27'),view('Buka pencairan','RCPT sumber'),view('Buka jadwal','Angsuran')]),
S('F27; F02','S18; S03; S20','Kontrak; pokok/bunga/biaya; jatuh tempo; payment; sisa',[view('Buka kontrak','LOAN sumber'),pay(),A('Alokasikan angsuran','Treasury','Pembayaran aktual tersedia','Pisahkan pokok/bunga/biaya; bank dan sisa benar','F27','Saldo kontrak dan pencatatan sesuai')]),
S('F28; F02; F03','S19; S03; S20','Pemilik; dasar keputusan; jenis; nominal; kas; jurnal',[...work('F28'),view('Buka kas terkait','PAY/RCPT sumber')]),
S('F35','S19; S20','Unit/periode; saldo awal; transaksi pemilik; hasil periode; saldo akhir',[view('Buka transaksi modal','EQ sumber'),view('Buka hasil periode','Laporan/GL'),view('Buka penutupan','Periode sumber')])
],
[
S('F29; F01','S20; S01; S02','Header sumber; baris akun/dimensi; debit/kredit; bukti; riwayat',[edit('F29'),submit('F29'),approve(),A('Posting jurnal','Akuntansi berwenang','Disetujui','Seimbang; akun aktif/postable/unit sah; periode terbuka; belum posted','F29','Jurnal posted satu kali'),reverse(),view('Buka sumber','Dokumen otomatis asal')]),
S('F22','S09; S20','Jenis/jadwal/sumber; periode; baris usulan; posting/pembalikan',[view('Buka jadwal sumber','PRE/AST/akrual sumber'),A('Tinjau usulan','Akuntansi','Siap review','Dasar sah dan belum diposting','F22','Usulan tervalidasi'),approve(),A('Posting pengakuan','Akuntansi berwenang','Disetujui','Unit/akun/periode benar; cegah jadwal-periode duplikat','F22','Jurnal tertaut jadwal'),reverse()]),
S('F19','S13; S20','Kelompok/unit/periode; GL; register; selisih; bukti; review',[edit('F19'),submit('F19'),approve(),view('Buka sumber selisih','Register/jurnal sumber')]),
S('F30; F01','S21; S13; S19','Unit/periode; checklist; rekonsiliasi; hasil periode; keputusan; riwayat',[A('Ajukan review penutupan','Akuntansi','Persiapan lengkap','Checklist sumber lengkap','F30','Menunggu review'),A('Tutup periode','Controller berwenang','Direview dan siap','Bukti nyata; kelengkapan unit; alasan/mandat','F30','Periode terkunci dengan jejak'),A('Ajukan buka kembali','Akuntansi berwenang','Ditutup','Alasan dan dampak; pemutus sesuai mandat','F30 / F01','Pembukaan terkendali, bukan edit diam-diam')])
],
[
S('F35','S24','Periode/unit/versi; hierarki pos; pembanding; selisih; sumber',[view('Telusuri pos','Akun → jurnal → sumber'),A('Ekspor','Pembaca berizin','Data tersedia','Unit/versi/filter dan izin nominal sesuai','F35','Laporan hasil sesuai konteks')],'Halaman laporan penuh; sidebar rincian pos'),
S('F35','S20; S24','Akun/unit/periode; saldo awal; mutasi; saldo akhir; sumber',[view('Buka jurnal','JRN sumber'),A('Ekspor mutasi','Pembaca berizin','Data tersedia','Akun/unit/filter sesuai izin','F35','Mutasi sesuai cakupan')],'Halaman laporan; sidebar jurnal sumber'),
S('F35','S03; S24','Definisi laporan; tanggal posisi; pihak; bucket umur; sumber',[view('Buka rincian','Register domain sumber'),A('Ekspor','Pembaca berizin','Data tersedia','Cakupan/kolom sensitif sesuai hak','F35','Laporan tanpa transaksi baru')],'Halaman laporan; sidebar dokumen sumber'),
S('F35; F19','S25; S24','Unit terpilih; kesiapan; eliminasi; sebelum/sesudah; versi',[A('Ubah cakupan','Pembaca berizin','Laporan terbuka','Hanya unit berizin; seluruh unit terpilih dihitung','F35','Laporan dihitung sesuai konteks'),view('Tinjau eliminasi','Rekonsiliasi/pencatatan eliminasi sumber'),A('Ekspor','Pembaca berizin','Data sesuai versi','Kesiapan dan cakupan unit tampak','F35','Laporan gabungan sesuai filter')],'Halaman konsolidasi penuh; sidebar unit/eliminasi')
],
[
S('F31','S22','Kode/nama/hierarki; aktif; postable; unit; laporan; penggunaan',[edit('F31','Admin Finance'),submit('F31'),approve(),A('Terapkan perubahan','Admin berwenang','Disetujui','Validasi penggunaan/histori; tidak merusak jurnal lama','F31','Master versi baru'),view('Lihat penggunaan','Rule dan jurnal terkait')]),
S('F32','S22; S20','Kejadian/role; dimensi; akun; prioritas; simulasi; aktivasi',[edit('F32','Admin Finance'),A('Simulasikan','Admin/reviewer','Draf valid','Hanya uji; tidak memposting transaksi bisnis','F32','Hasil akun dan jurnal contoh'),submit('F32'),approve(),A('Aktifkan','Admin berwenang','Disetujui dan uji memadai','Alasan nonaktif/bukti bisnis diperiksa','F32','Pemetaan aktif berversi')]),
S('F33','S22','Identitas; jenis; unit; data pembayaran terbatas; status; penggunaan',[edit('F33','Admin Finance'),submit('F33'),approve(),A('Terapkan / nonaktifkan','Admin berwenang','Disetujui','Periksa transaksi terbuka dan histori; jangan hapus sumber','F33','Status/master berubah dengan riwayat')]),
S('F34','S22; S09','Jenis/lingkup; parameter; tanggal berlaku; dampak; keputusan',[edit('F34','Pemilik kebijakan'),submit('F34'),approve(),A('Publikasikan','Admin berwenang','Disetujui','Versi berlaku tidak ambigu; dampak jadwal ditinjau','F34','Kebijakan berlaku')]),
S('F34','S22','Peran/tindakan; unit; batas mandat; keputusan; masa berlaku',[edit('F34','Pemilik mandat'),submit('F34'),approve(),A('Aktifkan akses','Admin berwenang','Disetujui','Pemberi hak punya mandat; bukan self-grant; server menegakkan','F34','Akses berlaku dengan audit')]),
S('—','S02; S22','Objek; pelaku/waktu; sebelum/sesudah; dasar; keputusan; dampak',[view('Buka objek','Master/rule sumber'),view('Buka keputusan','Keputusan perubahan')])
]
];
