# Review menu Finance Lab dan kecocokan COA

Tanggal: 10 September 2026. Lingkup: prototipe `frontend-hub/src/screens/finance-lab`, navigasi aplikasi, dan `Laporan_Master_Account1.csv` dari pengguna. Review kode dilakukan bersama Luna, reasoning max. CSV diperlakukan sebagai sumber data, bukan instruksi.

## Kesimpulan

Arah pengelompokan berdasarkan pekerjaan sudah tepat. Semua 52 menu memiliki route, dan seluruh kode COA sumber sudah tersedia di aplikasi. Namun belum tepat menyatakan seluruh UI/UX sudah siap: konsistensi filter, status akun, hasil pencarian, dan validasi transaksi perlu dibenahi sebelum merapikan navigasi.

Yang perlu dipertahankan: pembayaran dari detail tagihan, kontrol akrual gabungan di Akuntansi, pemisahan persediaan dalam perjalanan dari saldo afiliasi, dan laporan terpisah dari pekerjaan operasional. Giro outstanding sudah tampil dalam Transactions dengan detail dan aksi pencairan (`transactions.tsx:181`, `transactions.tsx:469`); usulan tab/filter giro meningkatkan kemudahan menemukannya, bukan menambah ulang fungsi yang belum ada.

Review ini tidak mengubah aplikasi atau COA. Pemeriksaan visual pada server prototipe berhenti di halaman login; temuan di bawah berasal dari kode dan perbandingan data, bukan klaim bahwa seluruh layar telah diuji di browser. Server lain yang berjalan di port 5320 adalah frontend-hub-2 dan tidak memiliki route /finance-lab.

## Hasil perbandingan COA

| Pemeriksaan | Hasil |
|---|---|
| Kode unik CSV | 7.528 |
| Kode di aplikasi | 7.528; tidak ada yang hilang atau tambahan |
| Nama | Sama setelah normalisasi spasi berulang |
| Flag Y/N | Seluruhnya sama dengan flag 1/0 aplikasi |
| Akun 12 digit | 6.902; terdiri dari 6.798 Y dan 104 N |
| Unit pada akhiran akun | 14: HO dan C001–C013 |
| Kelompok 7 digit | 75 |
| Kode di luar pola panjang umum | 204001 Giro Keluar; 205001 Uang Muka - Penjualan; 600104 Pendapatan lain-lain |
| Menu dan route | 52 dan 52, cocok seluruhnya |

Jumlah 7.528 mencakup akun induk dan detail. Jangan menamainya 7.528 akun yang boleh diposting. Flag aktif juga perlu dibedakan dari izin posting. Arti kode 6 digit harus dipastikan dalam kebijakan COA; keberadaannya tidak cukup untuk menetapkan aturan posting atau klasifikasi laporan otomatis.

## Perbaikan yang didahulukan

### P1 — Aksi harus sesuai record dan label yang dipilih

Temuan tambahan Luna: “Receive delivery” memproses `outstanding[0]` tanpa mengikuti kelas terpilih (`inventory.tsx:440`). “Settle the oldest” tidak mengurutkan kandidat dan mengambil dari daftar yang sudah memiliki settlement (`interunit.tsx:703`). Payroll “Settle all” memproses semua baris terbuka (`payroll.tsx:359`). Amortisasi pre-opening melintasi seluruh baris, termasuk yang selesai (`capital.tsx:481`). “File the next return” memanggil logika pembayaran (`tax.tsx:182`), sementara tanggal filed ditampilkan sebagai paid (`tax.tsx:401`).

Penyesuaian: aksi per baris membuka dokumen yang eksplisit; aksi massal menggunakan pilihan pengguna dan ringkasan jumlah record, nilai, tanggal serta rekening sebelum diproses. Pisahkan status pelaporan pajak dari pembayarannya. Periksa eligibility setiap record dan tampilkan hasil berhasil/gagal per record. Label tombol harus mencerminkan efek sebenarnya.

### P1 — Tutup buku harus memakai hasil pemeriksaan nyata

Luna menemukan hasil pemeriksaan rekonsiliasi bank dan afiliasi yang hardcoded (`close.tsx:55`), dan aksi tutup masih tersedia ketika pemeriksaan belum selesai (`close.tsx:96`). Kontrol reopen berada pada layar Periods yang tidak didaftarkan sebagai route (`periods.tsx:49`, `index.ts:118`).

Penyesuaian: checklist membaca status aktual, menautkan masalah ke record sumber, dan mencegah tutup selama syarat wajib gagal. Jika bisnis mengizinkan override, batasi pada otoritas yang tepat dengan alasan tercatat. Reopen resmi menjadi bagian alur tutup buku dengan jejak audit. Temuan ini khusus implementasi prototipe yang direview.

### P1 — Konteks unit dan periode harus konsisten

Di `sales.tsx:52`, filter unit berlaku ke hari penjualan, tetapi batch settlement di baris 53 dan agregat TRADE di baris 113 tidak mengikuti unit tersebut. Akibatnya satu layar dapat menampilkan angka dari cakupan berbeda.

Di `payables.tsx:73`, daftar mengikuti filter unit/jenis/status, tetapi KPI mulai baris 83 menggunakan seluruh tagihan. “Paid this month” di baris 148 menjumlahkan seluruh nilai paid tanpa kondisi bulan. Ini bermasalah ketika pengguna mengira ringkasan mengikuti filter yang dipilih.

Penyesuaian: satu konteks unit/buku/periode untuk halaman; seluruh KPI, tabel, detail dan cetak mengikuti konteks yang sama. KPI yang sengaja tetap global wajib diberi label “Semua unit”. Tautan dari ringkasan membawa ID dokumen dan filter tujuan. Periode demo yang tetap harus terlihat sebagai periode simulasi.

Luna menemukan pola serupa pada KPI settlement (`settlements.tsx:68`), penilaian persediaan (`inventory.tsx:204`), dan periode payroll (`payroll.tsx:70`). Konsolidasi saat ini hanya mencakup HO/C004/C006 (`reports.tsx:1001`); tampilkan cakupan tersebut secara eksplisit sampai semua unit tersedia. Ketiadaan data unit tidak boleh disajikan sebagai saldo nol yang sudah terverifikasi.

### P1 — Status akun dan validasi posting

`setup.tsx:55` menghitung seluruh akun 12 digit sebagai “Postable leaves”, termasuk 104 akun N. Tabelnya tidak menampilkan status aktif maupun izin posting. `engine/chart.ts:60` menetapkan postable dari active saja, sehingga akun induk aktif juga mendapat nilai true.

Jalur kode akun langsung dalam `engine/ledger.ts:225` hanya memeriksa keberadaan akun sebelum membentuk baris jurnal. Pemeriksaan aktif, izin unit dan jenis akun tidak terlihat pada cabang tersebut. Ini adalah celah prototipe, bukan kesimpulan tentang backend produksi.

Penyesuaian: pisahkan Aktif, Akun induk/detail, Boleh diposting, dan Batasan unit. Account picker menyaring pilihan sesuai transaksi; validasi yang sama harus berlaku saat posting, termasuk jurnal manual. Tampilkan alasan akun tidak dapat dipilih. Jangan menentukan izin posting semata-mata dari panjang kode karena terdapat kode 6 digit khusus.

### P1 — Input nominal tidak boleh mengubah arti diam-diam

`parts.tsx:646` menghapus semua karakter selain digit lalu mengalikan 100. Input `1.000,50` menjadi 100.050 rupiah, bukan 1.000,50 rupiah. Tanda minus juga hilang. Preview menunjukkan hasil parsing, tetapi tidak menggantikan validasi input.

Penyesuaian: tentukan format nominal yang didukung. Parse format rupiah dengan benar atau tolak pecahan/tanda yang tidak didukung dengan pesan jelas. Gunakan input tanggal sesuai jenis field; generic form saat ini menampilkan ordinary Input untuk field date juga.

### P2 — COA lengkap harus benar-benar dapat dijelajahi

`setup.tsx:46` memotong hasil ke 300 baris tanpa pagination. Cetak di baris 187 menggunakan hasil potongan yang sama. Filter unit di baris 86 hanya menawarkan HO, C004 dan C006, walaupun master memiliki 14 unit.

Penyesuaian: pagination atau virtualisasi, jumlah hasil filter sebenarnya, seluruh unit yang diizinkan pengguna, status aktif/nonaktif dan pilihan induk/detail. Cetak seluruh hasil filter atau beri pilihan eksplisit “Halaman ini”. Detail akun sebaiknya menyediakan induk, unit, status, pemetaan transaksi, saldo dan tautan buku besar.

### P2 — Kurangi pilihan sidebar tanpa menghilangkan fungsi

`nav.ts` berisi 52 tautan dan 12 kelompok bernama, ditambah ringkasan utama. `components/shell/sidebar.tsx:223` menggambar seluruh kelompok terbuka; judul kelompok bukan kontrol expand/collapse. Banyak “Overview”, “Settlements”, dan “Adjustments” berulang.

Penyesuaian: tampilkan kelompok utama lebih dahulu, buka kelompok yang sedang digunakan, dan simpan pintasan tugas yang sering dilakukan. Gunakan label spesifik pada pencarian dan breadcrumb: “Settlement penjualan”, “Penyelesaian antarunit”, “Penyesuaian persediaan”, “Jurnal penyesuaian”. Penamaan Indonesia perlu konsisten; nama asli COA tetap dipertahankan.

Luna juga menemukan dua pintu Finance: modul lama dan “Finance baru” sama-sama didaftarkan (`navigation.ts:186`). Selama pengembangan, beri nama “Finance Lab — Simulasi” secara jelas. Setelah siap menggantikan, pilih satu pintu Finance dan arahkan tautan lama ke tujuan yang sesuai.

### P2 — Sambungan antarhalaman dan hasil daftar

Antrean ringkasan menautkan ke daftar umum tanpa ID record (`overview.tsx:243`, `overview.tsx:506`). Transaksi juga dibatasi 200 baris (`transactions.tsx:307`) dan angsuran 24 (`financing.tsx:386`). Terapkan deep link ke detail record, pertahankan filter saat kembali, dan berikan navigasi lanjutan beserta jumlah hasil sebenarnya.

Beberapa affordance perlu diperjelas: “Find match” dan “Split” bank membuka detail yang sama (`bank.tsx:557`); klik tanggal/rekening pada baris giro tidak mendapat entry jurnal (`transactions.tsx:177`, `transactions.tsx:309`); tombol “Bill” pada vendor membuka detail (`vendors.tsx:279`). Detail giro melalui tombol khusus sudah tersedia, sehingga perbaikannya adalah konsistensi semua target klik dan label, bukan membuat ulang keseluruhan alur.

## Struktur menu yang disarankan

Ini usulan organisasi navigasi. Halaman detail yang sudah ada dapat dipertahankan dengan URL lama dan dibuka melalui tab, daftar atau pintasan konteks.

| Menu utama | Isi utama |
|---|---|
| Ringkasan | Perlu tindakan, jatuh tempo, selisih, tugas saya, pintasan |
| Kas & Bank | Rekening, transaksi, rekonsiliasi; tab giro dan deposito sesuai kebutuhan |
| Tagihan & Pengeluaran | Tagihan, biaya langsung, uang muka, biaya dibayar dimuka, rekanan |
| Penjualan & Piutang | Rekonsiliasi penjualan, piutang, settlement kartu/marketplace, uang muka pelanggan |
| Persediaan | Penilaian, barang dalam perjalanan, penyesuaian dan kehilangan |
| Antarunit | Saldo dua sisi, pendanaan, penyelesaian antarunit |
| Aset & Proyek | Register, CIP/proyek, pre-opening, penyusutan/amortisasi, penggantian OE |
| Kewajiban & Modal | Grup terpisah di dalamnya: penggajian, pajak, pinjaman dan angsuran, modal |
| Akuntansi & Tutup Buku | Jurnal, penyesuaian, akrual/deferral, cadangan, tutup periode |
| Laporan | Laba rugi, neraca, arus kas, neraca saldo, buku besar, konsolidasi |
| Pengaturan Finance | COA, pemetaan akun, aturan posting dan konfigurasi jadwal |

Grup Kewajiban & Modal merupakan opsi untuk meringkas sidebar. Jika payroll atau pajak dikerjakan setiap hari oleh tim khusus, tampilkan keduanya langsung melalui navigasi sesuai peran. Jadwal operasional seperti penyusutan tetap dapat dijalankan dari domainnya; definisi aturan dan pemetaan disimpan di pengaturan.

Suppliers dan Vendors dapat menjadi satu pintu “Rekanan”, dengan tab Supplier barang dan Vendor operasional. Perbedaan akun hutang dan proses kerja tetap dipertahankan. Dua akun hutang tidak dengan sendirinya mengharuskan dua menu utama.

Tombol bayar tetap ada di tagihan. Untuk treasury yang mengelola beberapa tagihan sekaligus, sediakan antrean pembayaran di dalam Tagihan/Kas & Bank dengan satu dokumen pembayaran dan beberapa alokasi. Satu pembayaran tidak perlu tampil sebagai beberapa pembayaran hanya karena memiliki beberapa baris jurnal.

## Penempatan keluarga COA dalam alur kerja

| Akun/keluarga | Tempat kerja dan kontrol yang disarankan |
|---|---|
| 1011001–1011004 kas, bank, deposito | Kas & Bank; jenis rekening sebagai filter |
| 2012002 outstanding giro; 204001 Giro Keluar | Daftar giro dengan nomor, bank, jatuh tempo dan status pencairan; hubungan kedua kode perlu dikonfirmasi |
| 2012001 hutang supplier | Tagihan; barang/nonbarang sebagai kategori; suspend sebagai status dengan alasan dan penanggung jawab |
| 1011301 biaya dibayar dimuka; 1011303 uang muka | Pengeluaran; jadwal pengakuan dan pertanggungjawaban |
| 1011101/1011102 piutang; 205001 uang muka penjualan | Penjualan & Piutang; saldo pelanggan, penerimaan dan alokasi. Uang muka pelanggan harus dibedakan dari uang muka ke pegawai/vendor |
| 4010110–4010113, diskon dan retur | Rekonsiliasi penjualan per kanal, dilanjutkan settlement dan penerimaan bank |
| 1011201–1011204 persediaan/BDP | Persediaan, dengan kelas barang dagangan dan kantong; barang dalam perjalanan bukan hanya hutang antarunit |
| 1021401–1021403 dan 2012301–2012304 | Antarunit; identitas pihak lawan dan pencocokan dua sisi. Nama rinci 2012304 menunjuk unit, walau judulnya Hutang Lain-lain |
| 10215*, 10216*, 10217*, 1031802/1031803 | Aset & Proyek; kebijakan pengakuan dan penyusutan ditentukan terpisah dari navigasi |
| 2012201 akrual | Pemilik sesuai asal biaya: payroll, pengeluaran atau pinjaman; kontrol gabungan di Akuntansi |
| 1011302 dan 2012101 pajak | Pajak; pisahkan pajak dibayar dimuka, hutang, pembayaran dan dokumen |
| 2012501/2012502 dan 2022401/2022402 | Pinjaman; satu kontrak dengan jadwal dan pemisahan bagian jangka pendek/panjang |
| 3013001 modal | Modal untuk setoran/distribusi; laba berjalan dan ditahan ditelusuri ke laporan/tutup buku |
| 1011103, 1011299, 1031801 | Cadangan/penyesuaian dengan sumber piutang atau persediaan dan bukti persetujuan |
| 4020110, 501*, 6*, 7*, 8* | Sumber transaksi di domain asal, hasil di laporan. Management fee membutuhkan asal transaksi yang jelas, bukan hanya tempat di laba rugi |

Penempatan menu bukan keputusan kebijakan akuntansi. Khusus pre-opening, reserve replacement, kode khusus dan klasifikasi pendapatan, perlu pemetaan yang disetujui pemilik COA. Coverage kode tidak membuktikan coverage workflow: setiap keluarga perlu transaksi contoh, hasil posting, laporan tujuan dan penanggung jawab.

## Urutan pengerjaan dan cara menerima hasil

1. Perbaiki pemilihan record, tutup buku, filter, nominal, status akun dan guardrail posting. Uji satu unit dan satu periode sampai tabel, KPI, detail serta cetak konsisten; akun terlarang ditolak dengan alasan; aksi hanya memproses record yang dipilih dan eligible.
2. Sederhanakan navigasi dan label. Pengguna dapat menemukan tagihan, giro, settlement, BDP dan saldo antarunit dari istilah pekerjaan sehari-hari.
3. Lengkapi eksplorasi COA dan pencetakan. Semua akun hasil filter dapat dicapai, termasuk akun nonaktif untuk histori dan kode khusus.
4. Validasi alur lintas menu: penjualan → settlement → bank; tagihan → pembayaran → rekonsiliasi; transfer barang → BDP → saldo antarunit; aset → penyusutan → laporan → tutup periode.
5. Lakukan pemeriksaan visual desktop dan layar kecil setelah sesi Finance Lab tersedia: keterbacaan angka, kolom terpotong, fokus keyboard, drawer, error, empty state dan perpindahan filter.
