# Standar produksi RFID C5 dan R3/R3S — rancangan 23 Oktober 2026

Status: **rancangan untuk implementasi dan penerimaan**, bukan pernyataan bahwa perangkat sudah lulus produksi. Disusun dari empat lampiran Hari, dua dokumen riset SDK di direktori ini, pemeriksaan kode lokal, dan sumber publik yang ditelusuri 23 Oktober 2026. Tidak mengubah kode produk atau setelan perangkat.

**Keputusan lanjutan Hari:** memilih resep konservatif dan menerima scan lebih lama. Implementasi kandidat serta petunjuk staf yang menggantikan pilihan awal S1/TagFocus dan window R3 1000 ms ada di [resep konservatif v1](../rfid-conservative-recipe.md). Temuan kode di bawah adalah snapshot audit sebelum implementasi tersebut.

## Jalur awal yang sederhana

Arahan Hari setelah membaca cakupan pengujian: hindari beban kualifikasi besar sebelum penggunaan terbatas. Daftar lengkap di bawah merupakan referensi untuk perluasan dan diagnosis; tidak semuanya harus dijalankan sekaligus.

Mulai dari **satu R3, satu firmware, satu profil tetap, di satu kasir dengan konfirmasi staf**. Gunakan kandidat yang sudah memiliki bukti lokal: S0/target A, TagFocus dan FastID off, EPC-only, jendela 1000 ms, gap 1000 ms. Band serta power harus berasal dari konfigurasi perangkat yang telah disetujui. Pertahankan Fast Inventory pada baseline R3 saat ini; jangan memasukkan eksperimen C5 ke rilis awal.

Validasi awal yang kecil:

1. Siapkan 10–20 barang dengan EPC unik dan daftar acuan. Baca 10 kali, ubah susunan/orientasi di antara pembacaan. Cocokkan EPC, bukan total saja.
2. Taruh beberapa barang bertag di luar pad, termasuk dekat kasir sebelah. Pastikan tidak ikut diterima; pastikan barang di sudut pad tetap masuk. Jika gagal, perbaiki area penempatan atau gunakan fallback, bukan menganggap floor bisa menyelesaikan semua kondisi.
3. Uji cabut USB dan kill aplikasi di tengah baca, masing-masing tiga kali. Tidak boleh ada hasil parsial dianggap sukses, tag lama masuk Sale berikutnya, atau kebutuhan restart OS.

Ini smoke test untuk **pilot terbatas yang diawasi**, bukan bukti ketepatan 99,9%. Staf memeriksa daftar/jumlah barang fisik; gunakan barcode/manual bila ada keraguan. Barang yang sama tidak boleh ditambahkan dua kali melalui RFID dan barcode. Audit selisih dan retry selama penggunaan nyata; perluas berdasarkan hasil tersebut. Sebelum auto-checkout tanpa pemeriksaan staf, lakukan kualifikasi yang lebih kuat.

Pada C5, langkah awal cukup memastikan profil pekerjaan tetap dan hasil tetap tersimpan saat terputus. Jangan memasukkan auto-finish, canary gating, penggantian Select, atau Fast Inventory baru sekaligus. S1 + TagFocus tetap kandidat sapuan berjalan yang sudah dipakai; S0/off diuji untuk baca ulang/verifikasi. Nilai yang dipilih harus diterapkan konsisten, bukan dikembalikan ke pilihan per HP.

Bagian statistik 300/3.000 percobaan di bawah menjelaskan kebutuhan bukti jika hendak mengklaim tingkat kegagalan tertentu atau memperluas otomasi. Angka tersebut **bukan pekerjaan rutin tiap toko atau tiap perubahan kecil**. Uji ulang difokuskan pada perilaku yang berubah; model/firmware, radio profile, tag/penempatan, atau area baca yang berubah membutuhkan cakupan terkait.

## Keputusan yang disarankan

Staf memilih pekerjaan. Aplikasi menerapkan profil yang disetujui untuk pekerjaan itu, memeriksa keadaan modul, dan menyimpan identitas profil bersama hasilnya. Konsistensi harus mencakup identitas barang, pemasangan label, area baca, prosedur operator, radio, transport SDK, dan pencatatan ke backend.

Profil yang seragam berarti **kebijakan dan hasil terverifikasi yang seragam untuk kelas perangkat yang sama**. C5, R3, dan R3S tidak harus memakai angka radio yang sama. R3S perlu kualifikasi sendiri.

Lima aturan utama:

1. Satu barang fisik mempunyai satu EPC unik. Dua barang dengan EPC sama tidak dapat dibedakan oleh hitungan EPC unik.
2. Tidak ada setelan radio bebas yang bertahan per HP di jalur produksi. Profil pekerjaan dan kalibrasi perangkat mempunyai versi serta pemilik perubahan.
3. Perintah diterima SDK belum membuktikan keadaan radio benar. Read-back dan uji barang acuan diperlukan.
4. Radio sehat, hasil lengkap, dan hasil tersimpan adalah tiga hal berbeda. Masing-masing mempunyai status sendiri.
5. Hasil yang terputus disimpan sebagai bukti parsial; tidak berubah menjadi hitungan lengkap atau pengurangan stok otomatis.

## Apa yang bisa diambil dari retailer lain

| Sumber primer | Praktik yang dipublikasikan | Penerapan yang disarankan untuk kita |
|---|---|---|
| [Fast Retailing, presentasi rantai pasok 2018](https://www.fastretailing.com/eng/ir/library/pdf/20181011_jimbo_en.pdf) | Tag dipasang sejak manufaktur dan dipakai untuk visibilitas barang di produksi, distribusi, serta toko. | Identitas barang dibentuk dan diperiksa sejak penerbitan label, lalu dipakai terus di penerimaan, hitung, dan penjualan. |
| [Impinj, studi Uniqlo pada white paper checkout 2025, halaman 4](https://www.impinj.com/getmedia/309bc702-7f7b-416c-acff-f1ce7b441f0d/Impinj-Automated-Checkout-White-Paper-041125.pdf) | Barang bertag dilacak di DC/toko; keranjang ditempatkan pada kiosk yang membaca tag dan menampilkan pembelian. | Rancang satu area penempatan barang yang jelas dan prosedur konfirmasi hasil. Konstruksi area baca harus diuji tersendiri. |
| [Decathlon RFID Services](https://www.decathlonrfidservices.com/rfid-a-decathlon-en-version) | Identitas unik per barang dipakai dalam inventaris dan checkout dengan wadah penempatan barang. | Standarkan label dan operasi menyeluruh, termasuk alur untuk barang yang gagal terbaca. |
| [GS1 TIPP, metodologi 1.2, Mei 2024](https://ref.gs1.org/guidelines/tipp/testing-methodology/1.2.0) | Pengujian dilakukan pada barang yang telah dipasangi tag; tiap EPC harus unik. Metode dirancang agar hasil antar operator/lab dapat diulang. | Uji pakaian nyata, label pada posisi akhir, orientasi dan kemasan nyata; simpan daftar acuan EPC. Pengujian internal kita tidak otomatis menjadi sertifikasi TIPP. |
| [Auburn RFID Lab, ARC](https://rfid.auburn.edu/arc/about.php) | Persyaratan inlay ditetapkan dari pekerjaan, produk/kemasan, lingkungan, dan infrastruktur, kemudian dikomunikasikan ke pemasok. | Buat spesifikasi label dan pemasangan per kategori barang. Chip yang sama belum tentu berarti performa label yang sama. |

Sumber tersebut **tidak mengungkap resep session, dBm, TagFocus, RSSI floor, timeout, atau algoritma kelengkapan produksi Uniqlo**. Jangan menyebut nilai kita sebagai “setting Uniqlo”. Rekomendasi di bawah adalah rancangan kita berdasarkan bukti lokal dan prinsip pengujian tersebut. Klaim performa pemasaran retailer juga bukan target terukur untuk perangkat kita.

## Koreksi terhadap kesimpulan riset awal

| Temuan | Kesimpulan yang layak dipakai |
|---|---|
| R3 menemukan 14/14 EPC dalam 8/8 percobaan pada 1000 ms | Kandidat baseline yang baik pada rig itu. Belum membuktikan ketepatan semua keranjang, toko, atau R3S. Ada 16 tag fisik tetapi hanya 14 EPC unik. |
| Power 5–25 tidak mengubah jangkauan pada R3 bench | Efek power belum terbukti pada unit/firmware itu. Read-back register saja belum membuktikan daya pancar berubah. Jangan menjadikannya sifat semua R3. |
| Floor −70 menolak tag jauh pada bench | Kandidat kalibrasi, bukan batas geometris pad. Tag di luar pad bisa lebih kuat daripada tag di dalam yang tertutup pakaian/tubuh. Ukur salah masuk dan salah tolak. |
| USB thread DLL dapat hidup melewati close | Risiko lifecycle yang kuat dari pembacaan DLL. Jeda 1,2 s adalah mitigasi yang harus diuji; timeout bulk read 1 s bukan bukti thread selalu sudah selesai dalam 1,2 s pada Windows sibuk. |
| Fast Inventory byte pertama 1 menghasilkan sekitar 7× bacaan | Terukur pada C5 dan kondisi saat itu. Bukan 7× barang ditemukan, bukan bukti pulih di seluruh periode derau, dan belum membuktikan efek pada R3. |
| S0 lebih stabil pada rangkaian awal | Bukti lokal, bukan keputusan semua pekerjaan. Rangkaian lanjutan juga menemukan dropout di S0. |
| S1 + TagFocus mengurangi pembacaan berulang | Kandidat untuk sapuan sekali lewat. Harus diuji untuk hitung ulang cepat, populasi campuran, dan dua handheld berdekatan. |
| RSSI rata dari frame yang berhasil relatif datar antar kanal | Mendukung hipotesis interferensi bersama pola dropout; belum mengukur noise floor atau sepenuhnya menyingkirkan respons antena/filter. Frame yang gagal decode tidak masuk rata-rata tersebut. Sumber gangguan masih terbuka. |
| Preset bernama Indonesia atau command berhasil | Belum membuktikan kanal pancaran sesuai. Bench C5 justru menemukan ketidakcocokan label dengan kanal yang teramati. |

## Profil pekerjaan dan pengelolaannya

| Kelompok | Kebijakan |
|---|---|
| Dikunci per pekerjaan | Session, target, TagFocus, FastID, RF link, data mode, Select, serta power yang sudah dikualifikasi. Diterapkan pada open, perpindahan pekerjaan, dan pemulihan modul. |
| Diatur pusat | Penugasan versi profil, band/kanal yang disetujui, kalibrasi per kelas perangkat/lokasi, dan kelompok A/B Fast Inventory. Aplikasi hanya menerima nilai dalam daftar yang diizinkan. |
| Otomatis | Pemantauan kesehatan, petunjuk ulang baca, dan penghentian terkontrol untuk pekerjaan yang memang cocok. |
| Lab | Build/package terpisah, akses terbatas, override di memori dan penulisan volatile yang telah dibuktikan. Tidak memakai preferensi produksi atau menerbitkan hasil uji ke stok produksi. |

### Kandidat resep yang akan dibandingkan

| Pekerjaan | Kandidat awal | Syarat sebelum disetujui |
|---|---|---|
| Hitung dengan berjalan menyapu area | S1, target A, TagFocus on; pembanding S0/TagFocus off dan S1/TagFocus off | Nilai kelengkapan EPC, waktu, pengaruh sweep sebelumnya, dan kerja bersamaan. Pertahankan baseline saat ini sampai kandidat pengganti terbukti. |
| Hitung ulang / verifikasi koli | S0, TagFocus off, EPC-only | Barang yang baru dibaca harus segera bisa terbaca lagi; peralihan dari S1 harus dibuktikan. Cocokkan terhadap daftar acuan bila tersedia. |
| Cari barang | Profil pencarian dengan filter EPC dan pelaporan berulang; kandidat S0/TagFocus off | Tag target terus dilaporkan ketika didekati; keluar dari pencarian mengembalikan profil hitung termasuk membersihkan Select. |
| Kasir R3 | S0, target A, TagFocus/FastID off, Gen2 biasa, EPC-only; window 1000 ms dan gap 1000 ms sebagai kandidat | Uji keranjang lengkap dan barang di luar pad, siklus ulang cepat, crash/unplug/reopen, dan versi installer yang akan dikirim. |
| Kasir R3S | Profil terpisah | Ulangi kualifikasi fisik dan radio; angka R3 tidak diwariskan sebagai nilai teruji. |

RF link 1 merupakan kandidat C5 dari bukti lokal. Nilai Q, link, dan duty cycle final harus cocok dengan model/firmware; jangan menyalin seluruh blok radio lintas hardware tanpa validasi. FastID dan mode RF Gen2X tidak menjadi baseline hitung dengan populasi chip campuran. Fast Inventory pada firmware C5 ini harus diperlakukan sebagai eksperimen tersendiri, bukan diasumsikan identik dengan beralih ke mode RF Gen2X.

Opsi “Dekat / Normal / Jauh” hanya layak jika manfaatnya terbukti di toko. Namai sebagai cakupan bantuan, bukan janji jarak tepat. Peta power serta floor merupakan versi profil yang diuji, bukan slider dBm untuk staf. Jangan menyediakan opsi ini pada R3 sebelum efek power-nya benar-benar terbukti.

### Kontrak profil

Minimal mempunyai `profile_id`, versi/revisi, hash isi, pekerjaan, model/modul/firmware yang didukung, band yang disetujui, setelan radio, batas operasional, serta referensi hasil kualifikasi. Server menugaskan profil; aplikasi hanya menjalankan profil yang kompatibel. Parameter pusat tidak boleh berupa opcode mentah yang bebas diisi admin.

Simpan tiga keadaan berbeda: **diminta → diterapkan → dibaca balik**, termasuk nilai yang tidak dapat dibaca. “Tidak didukung”, “timeout”, dan “nilai berbeda” tidak disamakan. Untuk kombinasi firmware yang sudah dikualifikasi, kemampuan yang tidak didukung dicatat sekali per generasi koneksi dan tidak dipanggil berulang pada setiap open. Keadaan kritis yang tidak dapat dipastikan membuat pembacaan berstatus belum terverifikasi.

Perubahan profil hanya di batas pekerjaan, setelah stop/drain; jangan mengganti profil di tengah satu sweep. Saat offline gunakan versi terakhir yang masih disetujui dan kompatibel. Bila belum ada, jangan mewarisi setelan modul. Jika profil dicabut/dilarang dan pencabutan sudah diterima, jangan kembali memakainya karena offline. Siapkan rollback aplikasi dan profil bersama-sama, tanpa kembali ke band yang belum disetujui.

Untuk tahap awal, profil dapat dibundel dalam APK. Distribusi pusat merupakan tahap berikutnya; tidak perlu membangun editor semua knob untuk memulai. Inventaris perangkat sudah ada di backend, tetapi pemeriksaan ini belum membuktikan adanya jalur unduh kebijakan radio handheld. `config.peripherals` kasir adalah pelaporan konfigurasi terminal, bukan otomatis mekanisme kebijakan dari pusat.

### Lab tidak boleh meninggalkan keadaan radio

`save=0` harus dibuktikan per command/firmware; beberapa API C5 memaksa save. Override tidak dimasukkan ke SharedPreferences. Terapkan ulang baseline pada awal sesi produksi, termasuk setelah proses Lab mati sebelum cleanup. Bila baseline belum dapat dipastikan, perangkat perlu dipulihkan sebelum digunakan.

Menghilangkan tombol saja tidak cukup. Jalur command file, intent/deep link, dan fungsi mutasi juga harus menolak akses dalam build produksi. Perintah yang mengubah memori tag atau belum jelas semantiknya—Protected Mode, Short Range, kill, lock/permalock, QT/Margin Read opcode 97—tidak tersedia pada alur baca produksi.

## Kesehatan pembacaan dan aturan selesai

Pisahkan:

- **Koneksi/profil:** modul masih terhubung, profil benar, tidak ada timeout stop atau kehilangan link.
- **Kualitas RF:** indikasi keterjangkauan dan gangguan, sesuai profil dan lokasi.
- **Kelengkapan pekerjaan:** daftar barang/area yang benar-benar sudah diperiksa.
- **Penyimpanan:** bukti tersimpan lokal, menunggu kirim, atau telah diakui backend.

Pakai status kualitas **normal / terganggu / belum dapat dinilai**. Jangan memberi label normal hanya karena getter menjawab atau satu tag dekat masih terbaca. RF bermasalah tidak berarti data yang sudah didapat harus dibuang; tandai interval gangguan dan simpan hasil parsial.

Dasar pemisahan profil ini juga dijelaskan dalam [panduan resmi Impinj tentang search mode dan session](https://support.impinj.com/article/202756158): single target mengurangi pelaporan ulang, TagFocus menekan tag yang telah dibaca, sedangkan pembacaan ulang S0 dipengaruhi channel hopping dan kontinuitas daya RF. Dukungan fitur reader Impinj tidak otomatis membuktikan command yang sama tersedia pada firmware Chainway kita.

Tiga batas rancangan indikator:

1. TagFocus memang membuat tag Impinj yang sudah dibaca diam. Hilangnya pembacaan ulang bukan indikator dropout yang sah pada profil itu. Canary non-Impinj dalam S1 pun masih punya jeda persistensi; timeout-nya harus diukur.
2. Sebaran kanal dengan pembacaan adalah data dari tag yang berhasil didengar, bukan pengukuran noise langsung. Ambang “17–36 sehat” dari region USA tidak boleh dibawa ke band lebih sempit. Setelah semua tag ditekan TagFocus, tidak adanya data kanal juga tidak membuktikan gangguan.
3. Canary sangat kuat dapat tetap hidup sementara barang lemah tidak terbaca. Gunakan fixture acuan pada jarak/posisi representatif untuk pemeriksaan shift dan kalibrasi. Penggunaan canary saat bekerja perlu memastikan ia tidak tertekan profil/Select dan dikecualikan dari stok. Jangan menganggap satu canary menjamin seluruh area.

Pemeriksaan diagnostik dalam S0 atau perubahan Select untuk membedakan “tag diam” dari “RF tuli” adalah kandidat Lab, karena perubahan itu sendiri dapat memengaruhi pekerjaan. Sampai tervalidasi, sinyal yang tidak cukup berarti **belum dapat dinilai**.

**Sapuan berjalan:** operator mengakhiri area atau melepas trigger. Tidak ada auto-finish hanya karena dua detik tanpa EPC baru; staf mungkin sedang melangkah ke bagian berikutnya. Angka “tidak bertambah” hanya petunjuk. Penyelesaian area memerlukan prosedur cakupan fisik; jumlah stok sebelumnya bukan ground truth yang menggantikan blind count.

**Verifikasi tumpukan/area terbatas:** minimum 2 s, 2 s tanpa EPC baru ketika kualitas dapat dinilai baik, dan cap 15–20 s dapat diuji sebagai kandidat. Timer tenang dimulai ulang setelah gangguan. Mencapai cap berarti perlu ulang/ubah posisi, bukan otomatis lengkap. Untuk koli dengan manifest EPC, lengkap berarti set yang diharapkan cocok dan tidak ada EPC di luar manifest yang belum dijelaskan.

**Kasir:** gunakan window yang dikualifikasi. Kesalahan transport/profil tidak boleh mengubah hasil parsial menjadi sale lengkap. Barcode/konfirmasi manual tetap tersedia sebagai alur pengecualian yang tercatat. Barang yang sudah ditambahkan manual tidak boleh ditambahkan lagi ketika RFID kemudian menemukannya. Membaca ulang pad harus mempunyai aturan perubahan daftar Sale yang jelas.

## Pekerjaan kode yang konkret

| Prioritas | Perubahan | Bukti selesai |
|---|---|---|
| P0 | Buat resolver profil pekerjaan untuk C5; hentikan pengaruh preferensi radio lama pada produksi | Dua HP dengan preferensi berbeda menghasilkan profil efektif yang sama untuk pekerjaan sama; uji upgrade dari konfigurasi lama. |
| P0 | Lengkapi definisi profil R3 pada field yang memengaruhi populasi dan konsistensi | Q, Query Sel/Select, dan RF link yang disetujui tidak berubah karena setelan aplikasi sebelumnya; uji dari beberapa keadaan awal, dengan nilai final ditentukan lewat bench. |
| P0 | Pisahkan penyimpanan Lab dari produksi dan pulihkan baseline saat mulai | Override session/link/power tidak bertahan ke sesi produksi, termasuk setelah force-stop atau baterai habis. |
| P0 | Tambah snapshot profil efektif serta status kualitas/parsial pada bukti sweep | Backend dapat membedakan hasil lengkap, terputus, belum dinilai, dan pending sync tanpa menebak dari jumlah tag. |
| P0 | Selesaikan validasi lifecycle R3 yang sudah ditulis | Installer Windows asli lulus open/stop/drain/reopen dan stres recovery; tidak ada tag lama masuk Sale baru. |
| P0 | Perketat jalur rilis dan identitas artefak | Test crate asli dan build installer lulus; APK ditandatangani release key yang benar, versi naik, BENCH false; hash SDK dan paket tercatat. |
| P0 | Tetapkan band/kanal/power yang disetujui untuk model/firmware | Konfirmasi vendor + sertifikat/aturan berlaku + verifikasi teknis aktual, bukan nama preset. |
| P1 | Terapkan filter SL-based setelah A/B | Filter hanya memilih target yang dimaksud; clear mengembalikan semua tag tanpa kehilangan atau reopen yang tidak perlu. |
| P1 | Terapkan penulisan volatile yang terbukti, hindari cold open yang tidak perlu | Efek power/link benar pada alat, profil pulih setelah restart, tidak ada write flash rutin yang tidak diperlukan. |
| P1 | Distribusi profil pusat dengan versi, kompatibilitas, offline dan rollback | Update parsial/gagal, perangkat offline, serta rollback diuji; tidak ada perubahan di tengah sweep. |

Temuan kode lokal yang mendasari daftar tersebut:

- `Config.kt` masih memuat `readerPower`, `tagFocus`, `gen2Session`, dan `rfLink` dari preferensi. `Sweep.warmReader()` memakai nilai itu; jalur awal di `MainActivity.kt` juga memakai preferensi. Sejumlah mutator sudah memiliki guard `BuildConfig.BENCH`, sehingga pekerjaan berikutnya adalah memastikan sumber profil produksi serta migrasinya, bukan sekadar memindahkan tombol.
- Profil R3 belum berarti seluruh radio identik: `Gen2::pinned()` hanya mengganti session dan target, mempertahankan field lain termasuk Q dan Query Sel. `off_gen2x()` mengubah mode Gen2X ke pasangan Gen2-nya dan mempertahankan mode lain. Kunci/pastikan field penting setelah nilainya dikualifikasi, sambil mencatat field yang sengaja diwarisi beserta alasannya. C5 `restoreGen2()` juga mempertahankan sebagian blok awal dan menelan beberapa kegagalan command; status siap perlu bergantung pada pemeriksaan profil efektif.
- `rfid.rs` sudah memiliki `LinkGetSelected`, pembukuan loss per link, raw stop, drain, dan jeda reopen 1200 ms. Stop callback masih menghitung event global dan mengabaikan argumen link. Tambahkan pengujian ACK terlambat/asal link lama; id sendiri dapat digunakan ulang sehingga korelasi generasi dan batas drain tetap perlu dinilai. Jangan mengklaim race terbukti hilang hanya karena unit test loss lolos.
- Jika stres masih menunjukkan callback/queue dari generasi lama, minta perbaikan SDK atau evaluasi helper process yang memuat DLL dan dapat diakhiri sebelum generasi baru dibuat. Itu pilihan eskalasi, bukan syarat mengganti arsitektur sekarang.
- `ScanEngine.kt` sudah memakai `Knobs.rssiOf` pada jalur evidence. Tes 58/58 dan scratch Rust 19/19 berasal dari laporan sesi terdahulu; tidak dijalankan ulang dalam riset ini. Scratch harness bukan pengganti kompilasi crate Windows sebenarnya.
- `.github/workflows/pos-windows.yml` sudah memverifikasi hash SDK dan membangun installer; hasil untuk perubahan lokal ini belum diverifikasi di sini. Nilai 500 ms yang pernah tersimpan juga tidak otomatis berubah saat default menjadi 1000 ms: diperlukan migrasi/commissioning eksplisit.
- `handheld/app/build.gradle.kts` mempunyai fallback signing release ke debug key pada baris 83–84, bertentangan dengan komentar di atasnya. Hilangkan fallback untuk distribusi produksi dan verifikasi sertifikat artefak. `versionCode` saat pemeriksaan masih 1; perlu strategi peningkatan versi agar upgrade dapat ditelusuri.

## Protokol pengujian produksi

Angka di bawah adalah **usulan gate internal**, bukan standar GS1 atau hasil yang sudah dicapai. Batas akhir harus mempertimbangkan risiko salah tagih, kehilangan stok, dan waktu staf.

### 1. Daftar acuan dan skenario fisik

Siapkan 100–300 barang nyata yang mewakili jenis pakaian dan label yang digunakan, termasuk tag NXP dan Impinj bila keduanya masih digunakan. Catat EPC per barang, jenis inlay/lot, lokasi pemasangan label, kategori pakaian, dan TID bila tersedia untuk diagnosis. Verifikasi EPC satu per satu dengan barcode/manual dan pembacaan terisolasi yang independen dari sapuan massal yang akan diuji.

Daftar acuan berisi **himpunan EPC**, bukan hanya total. Dua hasil 14 barang bisa mempunyai satu barang hilang dan satu barang luar yang ikut terbaca.

Variasikan 1, 5, 10, 20 barang dan kapasitas maksimum operasional yang akan disetujui; rak gantung, lipatan padat, kantong/koli, tag saling bertumpuk, label menempel tubuh/metal, dan semua posisi yang diperbolehkan prosedur. Item yang dilarang diletakkan dengan cara tertentu dicatat dalam SOP, bukan dihapus diam-diam dari statistik kegagalan.

Tempatkan barang pengganggu di luar area: sebelah pad, bawah meja, rak belakang, kantong staf/pelanggan, serta kasir sebelah. Tandai batas dan jarak nyata, foto rig, dan ubah orientasi. Jika distribusi RSSI barang dalam/luar tumpang tindih, cari perbaikan fisik seperti penempatan, jarak antar station, atau enclosure/shielding yang diuji ulang. Jangan terus memindahkan floor sampai barang dalam ikut hilang.

### 2. Tes otomatis sebelum alat

| Lapisan | Kasus yang wajib |
|---|---|
| Profil | Migrasi preferensi lama, pergantian pekerjaan, restore setelah open/recovery, profil tidak kompatibel, offline, update gagal, rollback. |
| Lifecycle SDK | Start/stop timeout, ACK terlambat, disconnect link lama/aktif, slot id digunakan ulang, tag tail, record invalid di tengah drain, queue tidak pernah tenang. |
| Evidence | RSSI titik/koma/N/A, timestamp, EPC duplikat, kehilangan link di tengah sapuan, hasil parsial tetap tersimpan. |
| Backend | Retry batch yang sama tidak menggandakan efek; restart saat kirim, respons hilang setelah server menerima, jam mundur, beberapa handheld pada pekerjaan yang sama. |
| Sale | Ulang baca tidak menggandakan unit, barcode kemudian RFID tidak menggandakan barang, barang pindah dari/ke pad diperlakukan sesuai alur yang ditetapkan. |
| Artefak | Test native Windows pada crate asli, typecheck/build UI, unit test Android, build dan instal APK/MSI release yang benar-benar akan dikirim. |

Gunakan test double untuk fault injection pada batas adapter SDK; perangkat asli tetap diperlukan untuk race DLL dan RF. Tidak perlu membuktikan semua ini lewat UI klik berulang.

### 3. Bench alat asli dan A/B

Mulai dengan minimal dua unit per model bila tersedia, dua operator, dan dua lokasi berbeda. Jika hanya satu unit/lokasi tersedia, catat cakupan itu dan tahan kesimpulan lintas armada. R3 dan R3S mendapat laporan terpisah.

Untuk C5, bandingkan profil S0/off, S1/off, dan S1/TagFocus; lalu bandingkan Fast Inventory off/on dengan profil pemenang. Gunakan urutan interleaved yang diacak/seimbang, misalnya ABBA lalu BAAB, bukan semua A pagi dan semua B siang. Catat interval tanpa RF dan ukur carry-over session antar run; jeda tidak dianggap menghapus flag tanpa bukti. Barang dan posisi tetap dalam satu pasangan, baru diacak ulang untuk pasangan berikutnya.

Ukur Fast Inventory pada band/kanal yang disetujui, dengan chip serta kemasan nyata; jangan memilih band USA hanya karena hasil apartemen lebih baik. Ukur jumlah EPC yang benar, waktu mencapai daftar lengkap, interval gagal baca, energi per pekerjaan, temperatur, dan ketahanan satu shift. Mengurangi duplikat atau menaikkan reads/s bukan kriteria kemenangan utama.

Uji interaksi: dua C5 pada area sama, C5 dengan kasir R3 aktif membaca, serta dua kasir aktif. Session adalah keadaan pada tag yang dapat dipengaruhi reader lain; pembagian session atau jadwal harus dibuktikan, bukan dipilih bebas staf. Pada S0, pemulihan tag juga bergantung pada hilangnya daya RF; satu reader berhenti belum tentu cukup ketika reader lain masih menyalakan field.

### 4. Gangguan dan pemulihan

Pada C5: screen off/on, pindah aplikasi, app UHF lain membuka modul, trigger cepat, filter on/off, ganti pekerjaan, force-stop, baterai rendah, Wi-Fi putus, proses mati setelah menyimpan sebelum kirim.

Pada Windows: tidak ada reader saat startup, cabut USB saat inventory/stop/drain/open, hub USB, suspend/resume, kill aplikasi tengah baca, close/reopen berulang di bawah beban CPU dan I/O. Jalankan minimal 500 siklus normal baca dan 100 siklus gangguan/pemulihan per kombinasi yang akan disetujui. Pisahkan metrik transport dari ketepatan keranjang.

Lulus gangguan berarti proses memberi status yang benar, tidak menagih hasil salah, bukti parsial tidak hilang, dan pulih dalam batas yang disetujui. Percobaan yang ditolak aplikasi tetap masuk denominator sebagai kegagalan baca pertama; jangan menyembunyikannya dengan retry sampai sukses.

### 5. Metrik dan gate yang diusulkan

Misalkan `E` adalah himpunan EPC yang memang harus dihitung dan `O` hasil yang diterima:

- `missing = E − O`; `extra = O − E`.
- Ketepatan penuh satu percobaan: `O = E`, tanpa EPC salah dan tanpa EPC hilang.
- First-pass success: percobaan tepat penuh tanpa bantuan / semua percobaan terjadwal, termasuk timeout dan hasil parsial.
- Laporkan first-pass, keberhasilan setelah bantuan, retry, fallback manual, waktu p50/p95/p99, dan kegagalan per model/firmware/lot label/lokasi. Jangan hanya menggabungkan semua ke satu persentase.

| Area | Gate usulan |
|---|---|
| Label | Tidak ada EPC ganda pada penerbitan; write-read-verify dan kontrol serial/penerbitan ulang. Duplikat dikarantina sebelum dijual. |
| Kasir, bench | 300 percobaan independen yang bervariasi per kombinasi hardware/firmware/profil yang akan dirilis: 300 tepat penuh, tidak ada extra, silent partial, atau unit yang ditambahkan ganda. Jika gagal, perbaiki dan ulangi kualifikasi versi final; kegagalan sebelumnya tetap disimpan. |
| Verifikasi koli berm manifest | Himpunan EPC tepat; selisih ditampilkan untuk penyelesaian eksplisit. Tidak ada status lengkap dengan missing/extra yang belum ditangani. |
| Hitung rak | Kandidat target first-pass recall minimal 99,5% dan extra 0 pada area uji yang dikendalikan, dilaporkan juga per kondisi sulit. Semua selisih harus diselesaikan sebelum penetapan hasil final. Ambang ini bukan izin menghapus 0,5% stok secara otomatis. |
| Latensi kasir | Kandidat p95 maksimal 3 s pada kondisi warm, dari permintaan baca sampai hasil termasuk gap yang harus ditunggu. Startup/cold open dilaporkan terpisah. Tinjau target setelah pengukuran, tanpa mengorbankan ketepatan. |
| Gangguan | Tidak ada hasil salah yang dianggap lengkap, tidak ada kehilangan bukti, tidak ada efek transaksi ganda, dan tidak perlu restart OS. Waktu recovery diukur dan diberi target operasional sebelum pilot. |
| Soak | Satu shift pola kerja nyata; tidak ada crash, degradasi yang terus naik, atau suhu melewati batas vendor. Baterai harus cukup untuk shift yang ditetapkan; bandingkan energi per pekerjaan selesai. |

Konteks statistik: jika ada nol kegagalan pada `n` percobaan independen, batas atas satu sisi 95% untuk peluang gagal adalah `1 − 0,05^(1/n)`. Nol dari 300 hanya mendukung batas sekitar 1%; nol dari 3.000 sekitar 0,1%. Mengulang tumpukan yang sama pada posisi sama tidak memberi cakupan independen yang memadai. Hasil 8/8 belum mendukung klaim kegagalan langka.

### 6. Pilot dan peluncuran

1. Bekukan candidate: commit, hash APK/MSI, SDK, firmware, profil, lot label, dan kondisi rig yang dipakai. Kompilasi lulus adalah gate awal.
2. Pilot di satu toko, satu shift dengan verifikasi independen terhadap seluruh pekerjaan uji; kemudian toko kedua dengan tata letak berbeda. Observasi tanpa efek stok/keuangan bila belum disetujui.
3. Untuk target bukti peluang gagal sekitar 0,1% pada keyakinan satu sisi 95%, rencanakan 3.000 trial kasir independen yang hasilnya benar-benar diaudit pada kombinasi yang akan didukung, dengan nol kesalahan item yang lolos sebagai hasil lengkap. Ini pilihan tingkat pembuktian untuk perluasan otomasi, bukan syarat smoke test pilot yang diawasi. Data tanpa daftar pembanding tidak menghitung sebagai trial ketepatan.
4. Rollout bertahap sesuai kelas perangkat dan lokasi yang lulus, dengan pemantauan retry/fallback, profile mismatch, disconnect, partial rate, dan waktu selesai. Model/firmware baru dikualifikasi ulang.
5. Satu wrong-item charge, silent partial yang disahkan, duplicate transaction, penggunaan profil/band tak disetujui, atau kehilangan bukti menghentikan perluasan dan memicu investigasi/rollback. Hasil gangguan yang terdeteksi tidak disamakan dengan salah tagih, tetapi first-pass/retry rate tetap harus memenuhi target yang disepakati.

### Catatan per trial

Catat ID trial, waktu dan durasi monotonic, lokasi/operator, perangkat dan firmware, hash aplikasi/SDK, versi profil diminta/dibaca balik, band/kanal, bentuk tumpukan dan foto rig, daftar `E`, daftar raw/diterima/ditolak serta alasan, `missing/extra`, kejadian stop/disconnect, interval kualitas, bantuan/retry, dan hasil final. Simpan fixture/version manifest bersama log; jangan memasukkan credential/device key ke berkas QA.

## Band Indonesia dan pertanyaan untuk Chainway

Keputusan region bukan sekadar memilih China2 atau 0x3F. Minta profil band, tabel kanal, dan batas power yang benar untuk modul, firmware, antena, serta sertifikat perangkat yang dipakai. Cek aturan yang berlaku; [Permen Komdigi 2/2025](https://jdih.komdigi.go.id/produk_hukum/view/id/949/t/peraturan%2Bmenteri%2Bkomunikasi%2Bdan%2Bdigital%2Bnomor%2B2%2Btahun%2B2025) mengubah Permen 2/2023 termasuk lampiran spektrum dan ditandai berlaku oleh JDIH. Karena itu rujukan tahun 2007/2019 saja tidak cukup untuk keputusan rilis. Pemeriksaan ini belum menetapkan konfigurasi legal spesifik unit kita.

Pertanyaan yang perlu jawaban tertulis dan kemudian diverifikasi:

1. Mengapa C5 `E710_V7.10.1` pada 0x3F teramati memakai sekitar 923,25–924,75 MHz? Profil/tabel mana yang sesuai sertifikat unit Indonesia, dan bagaimana memverifikasinya?
2. Apakah raw custom hopping mendukung beberapa kanal pada firmware ini? Mengapa bench hanya menggunakan kanal pertama walau ACK berhasil?
3. Apa arti byte pertama Fast Inventory/LBT pada firmware C5 dan R3; efek pada duty cycle, ketentuan band, panas, serta baterai?
4. Mengapa power R3 5–25 dBm tidak mengubah RSSI/jangkauan pada unit bench? Apa urutan penerapan dan cara verifikasi daya pancarnya?
5. Apakah tersedia SDK R3 dengan join/penyelesaian thread USB sebelum `UsbClose` kembali? Minta kontrak lifecycle dan versi perbaikan untuk race reuse link.
6. Bagaimana perubahan power/link/region C5 tanpa write flash dan tanpa cold boot yang tidak perlu? Minta cara, acknowledgement, serta read-back yang benar.
7. Apakah jalur phase/frequency aman untuk menghindari filter −25 dBm, dan apakah 6A/6C didukung? Minta capability per firmware; jangan terus probing command unsupported.
8. Command 97 pada firmware kita menjalankan QT-set atau Margin Read? Tetap dikeluarkan dari produksi selama belum jelas.

Urutan kerja yang disarankan: rapikan dan validasi perubahan yang sudah ada → tetapkan identitas label serta profil pekerjaan → selesaikan band/perangkat yang disetujui → kualifikasi bench → pilot toko → perluasan bertahap. Perbaikan pengelolaan profil dan bukti parsial dapat dimulai sambil menunggu jawaban vendor; pengujian RF harus memakai konfigurasi yang telah disetujui.
