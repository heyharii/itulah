# Prinsip dan rancangan HR

11 September 2026. Rancangan untuk 13 toko dan satu HO. Eksplorasi kode dilakukan oleh dua agen Luna max; layar People dan aplikasi karyawan juga diperiksa langsung. Ini rancangan target, bukan perubahan aplikasi atau pengesahan kebijakan ketenagakerjaan.

## Keputusan desain

**Pekerjaan rutin dituntaskan di unit, keputusan penting dipusatkan, dan seluruh pihak mengikuti satu dokumen serta riwayat yang sama.** Menu mengikuti pekerjaan, sedangkan hak pengguna menentukan data dan tindakan yang tersedia.

HO memiliki dua konteks yang berbeda:

| Konteks | Tanggung jawab | Cakupan |
|---|---|---|
| HR Unit Toko | Mengurus pegawai dan fakta operasional unit | Toko yang ditugaskan |
| HR Unit HO | Mengurus pegawai HO | Unit HO |
| Pengawasan Pusat | Keputusan penting, kebijakan dan pengecualian | HO dan 13 toko sesuai mandat |

Seseorang dapat diberi lebih dari satu penugasan, tetapi pilihan unit HO tidak otomatis memberikan hak pusat. Pengajuan unit HO juga memerlukan reviewer berbeda dari pengaju. Jika jumlah petugas terbatas, alihkan keputusan kepada pejabat pusat lain yang berwenang; jangan menyamakan pergantian mode dengan pergantian orang.

## Filosofi yang mengikat semua menu

1. **Menu memiliki objek pekerjaan.** Karyawan memiliki riwayat hubungan kerja; waktu memiliki jadwal dan bukti aktual; payroll memiliki komponen dan versi batch; akses memiliki permintaan dan hasil pemberian hak.
2. **Antrean bukan register baru.** Persetujuan saya membuka pengajuan sumber yang sama. Unit, pusat dan karyawan tidak mempunyai salinan pengajuan terpisah.
3. **Status menjadi filter.** Draf, menunggu, disetujui dan ditolak bukan empat menu. Tab baru dipakai bila objek atau tahap kerjanya memang berbeda, misalnya usulan penerimaan dan onboarding.
4. **Keputusan berbeda dari eksekusi.** Diterima bekerja belum berarti akun sudah aktif. Payroll disetujui belum berarti sudah dibayar. Keputusan akhir kerja belum berarti semua tugas offboarding selesai.
5. **Rencana berbeda dari aktual.** Roster bukan bukti presensi. Rencana lembur bukan jam aktual yang dibayar. Data kosong atau contoh tidak boleh menghasilkan klaim kehadiran nyata.
6. **Perubahan bertanggal dan berversi.** Kontrak, penempatan, gaji dan kebijakan tidak ditimpa tanpa riwayat. Revisi material setelah approval perlu keputusan ulang.
7. **Hak lihat berbeda dari hak memutuskan.** Nominal, data pribadi, unit, tindakan dan ekspor mempunyai izin masing-masing. Server tetap menegakkan pembatasan tersebut.
8. **Satu sumber payroll.** HR menetapkan hak/komponen dan mengesahkan versi lengkap. Finance mengontrol pencatatan serta pembayaran dari versi itu, bukan membuat kalkulasi gaji kedua.

## Menu HR yang diusulkan

| Menu | Tujuan | Tab |
|---|---|---|
| Ringkasan | Memilih pekerjaan dan keputusan berikutnya | Hari ini; Persetujuan saya; Pengecualian |
| Karyawan | Satu register dan riwayat hubungan kerja | Daftar karyawan; Kontrak & penempatan; Perubahan status; Offboarding |
| Penerimaan & Onboarding | Usulan penerimaan unit sampai siap bekerja | Usulan penerimaan; Onboarding |
| Jadwal & Kehadiran | Rencana, bukti aktual, koreksi dan fakta periode | Roster; Kehadiran; Koreksi; Tutup periode |
| Cuti & Lembur | Pengecualian waktu kerja dan hak terkait | Cuti & izin; Lembur; Hak & saldo cuti |
| Kompensasi & Payroll | Kesepakatan gaji, beban unit dan serah terima | Kesepakatan gaji; Payroll per unit; Serah terima Finance |
| Akun & Akses | Kebutuhan akses, keputusan dan hasil eksekusi | Permintaan akses; Daftar akun; Riwayat akses |
| Laporan & Pengawasan | Perbandingan posisi dan penyelesaian proses | Tenaga kerja; Waktu & ketidakhadiran; Beban gaji |
| Pengaturan HR | Struktur, kebijakan, komponen dan mandat | Unit & penanggung jawab; Kebijakan waktu; Komponen payroll; Kewenangan & persetujuan |

Ini sembilan domain dengan 29 tab. Pengguna hanya melihat yang relevan dengan haknya. HR toko dapat membaca kebijakan yang berlaku tanpa memperoleh tombol mengubah kebijakan pusat.

**Penerimaan bukan ATS lengkap.** Kebutuhan yang dinyatakan adalah usulan penerimaan dari HR toko kepada HO. Iklan lowongan, portal pelamar, wawancara bertahap dan talent pool tidak ditambahkan tanpa kebutuhan bisnis tersendiri. Calon yang belum disetujui tetap berada di usulan, bukan dicampur sebagai pegawai aktif.

**Akun & Akses bukan panel administrator teknis.** HR menentukan siapa membutuhkan peran dan unit apa. Administrator yang berwenang menjalankan pemberian atau pencabutan. Detail pegawai boleh menampilkan status akun dan tautan ke permintaan yang sama.

**Laporan tidak menyalin proses persetujuan.** Laporan beban gaji menampilkan perbandingan; tombol review membuka batch sumber. Ringkasan menyajikan pekerjaan hari ini; Laporan menyajikan posisi dan tren lintas periode.

## Batas kewenangan

Tiga keputusan berikut wajib HR HO karena dinyatakan langsung oleh pengguna:

| Kejadian | HR unit | HR pusat | Pelaksanaan |
|---|---|---|---|
| Penerimaan karyawan | Membuat usulan dan memverifikasi kebutuhan/dokumen | Menerima, menolak atau mengembalikan | HR unit menjalankan onboarding |
| Pemberian akun | Mengusulkan identitas, peran dan cakupan | Memutuskan pemberian akun | Administrator mengeksekusi dan mengembalikan status |
| Beban gaji toko | Menyiapkan fakta, komponen dan paket yang sudah diverifikasi | Menyetujui beban gaji versi tertentu | Finance mencatat kewajiban dan membayar |

Rancangan mengusulkan perubahan gaji, mutasi antarunit, perubahan kontrak penting dan akhir hubungan kerja juga melalui pusat. Detailnya masih perlu menjadi mandat organisasi, bukan diasumsikan sebagai kebijakan yang sudah ada.

Untuk pekerjaan rutin, usulannya: atasan operasional memastikan kebutuhan tim, HR unit memverifikasi fakta/hak, dan pejabat unit yang mendapat delegasi memutuskan. Cuti, roster dan koreksi tidak otomatis memerlukan pusat. Lembur di luar mandat, pengecualian hak, dan pembukaan periode yang memengaruhi payroll final naik ke pusat. Batas nominal/jam tidak dikarang dalam rancangan ini.

## Alur penting

**Penerimaan:** HR unit membuat usulan → HO memutuskan versi usulan → proses pegawai/kontrak dan onboarding terbentuk → permintaan akun diputuskan → administrator memberi akses → unit menyelesaikan kesiapan kerja. Persetujuan hire dan keputusan akses bisa ditinjau dalam satu rangkaian, tetapi hasil keputusannya tetap eksplisit.

**Payroll:** fakta waktu unit lengkap dan ditutup → komponen gaji serta penyesuaian memiliki sumber → unit memverifikasi paket beban gaji → HO memutuskan → versi lengkap dikunci → Finance menerima snapshot → Finance mencatat kewajiban dan menjalankan pembayaran → status pembayaran kembali ke HR dan tampilan karyawan.

Paket beban gaji unit adalah kebutuhan baru yang berbeda dari tanda tangan kedua pada payroll run yang ada. Paket tersebut harus terikat ke versi perhitungan yang sama, bukan menjadi kalkulasi paralel. Bedakan beban perusahaan, penghasilan pegawai, potongan dan neto. Kewajiban komponen yang belum dihitung tidak boleh diisi nol agar terlihat siap.

Handoff membawa identitas run, unit, periode, versi, tanda tangan, komponen per pegawai dan sumber fakta. Pengiriman ulang versi yang sama tidak boleh menggandakan kewajiban. Setelah dibayar, koreksi memakai versi penyesuaian/pembalikan yang disetujui, bukan menimpa angka sebelumnya. Slip yang dirilis dan status uang diterima ditampilkan sebagai dua hal berbeda.

**Cuti:** karyawan mengajukan → unit memverifikasi hak dan kebutuhan tim → pemutus sesuai delegasi memutuskan → fakta ketidakhadiran dan hak diperbarui → pengajuan yang sama terlihat di aplikasi karyawan. Pengecualian naik ke pusat.

**Mutasi:** unit asal mengajukan → unit tujuan mengonfirmasi → pusat memutuskan → penempatan berubah pada tanggal efektif → akses dan komponen/alokasi payroll ditinjau → riwayat tetap memakai identitas pegawai yang sama.

**Offboarding:** pengajuan dan dasar keputusan → keputusan pusat sesuai mandat → tugas serah terima, akses dan Finance berjalan pada masing-masing owner → kasus selesai setelah tugas wajib selesai. Aktivitas teknis tidak dianggap selesai hanya karena status kerja sudah berubah.

## Aplikasi karyawan

| Menu | Isi |
|---|---|
| Beranda | Jadwal hari ini, pekerjaan pribadi yang perlu tindakan, status pengajuan dan slip yang dirilis |
| Jadwal & Kehadiran | Jadwal saya dan catatan aktual saya; sumber data terlihat |
| Pengajuan | Cuti/izin, koreksi, kesediaan lembur dan pelacakan status pribadi |
| Gaji & Dokumen | Slip yang dirilis, status pembayaran dan dokumen kerja sendiri |
| Profil | Identitas, penempatan, data pribadi sesuai hak dan permintaan perubahan |

Notifikasi tetap menjadi utilitas. Karyawan tidak mendapatkan versi kecil antrean keputusan HR. Permintaan dibuat atau dijawab pada sumber yang sama, lalu dapat dilacak tanpa mengirim ulang ke HO. Perubahan kontrak, jabatan, gaji dan akses tidak menjadi field yang bisa diedit langsung oleh pegawai.

## Detail dan form

Panel detail menampilkan header dokumen/unit/versi, ringkasan, rincian, dokumen terkait, persetujuan dan riwayat. Tab/section yang tidak relevan tidak perlu ditampilkan. Data sensitif dibatasi sampai level field.

Form memiliki mode yang jelas: simpan draf, ajukan, revisi setelah dikembalikan, atau keputusan. Reviewer melihat versi dan perubahan sebelum mengambil keputusan. Tutup form dengan perubahan belum tersimpan memberi pilihan simpan atau buang. Konflik versi meminta pengguna meninjau versi terbaru; bukan menimpa perubahan orang lain.

Roster dan payroll memerlukan ruang untuk grid dan perbandingan. Gunakan halaman kerja penuh dengan panel detail pegawai di samping jika sidebar sempit menghambat pembacaan.

Workbook pendamping berisi contoh tabel untuk semua tab, batas HR unit/pusat, 17 jenis form dan 97 definisi field. Kolom form meliputi tipe input, kewajiban, sumber/pilihan, validasi dan kondisi edit. Ini lebih rinci dari workbook Finance sebelumnya, yang baru menjelaskan isi panel detail dan belum memiliki spesifikasi form per field lengkap.

## Temuan eksplorasi dan konsekuensinya

| Temuan saat ini | Konsekuensi |
|---|---|
| People memiliki 11 pintu navigasi dan drawer pegawai Record/Leave/Contracts/Change | Bisa dikelompokkan menjadi domain di atas tanpa membuat profil pegawai kedua |
| Pembatasan server sudah membatasi non-Admin menurut posting; Supervisor HO hanya menjangkau HO, Admin menjangkau seluruh tempat | Pertahankan kontrol yang ada; tambah kewenangan HR pusat yang lebih spesifik dari Admin umum |
| Usulan penerimaan toko belum ada; pembuatan candidate dan HIRE merupakan tindakan langsung | Tambah dokumen usulan dan keputusan, mengikuti kebutuhan terbaru pengguna |
| HR unit sekarang menutup fakta kehadiran; pay/payroll merupakan pekerjaan HO/Admin | Pengajuan dan persetujuan beban gaji toko memerlukan alur/data baru |
| Tidak ada sumber punch; koreksi presensi employee masih stand-in; status contoh global dapat tertimpa hasil request lain | Tampilkan sumber per data/kartu, jangan tampilkan demo sebagai bukti aktual |
| Payroll belum memiliki perhitungan komponen statutory/neto; hanya SEALED yang immutable | Approved saja belum cukup untuk handoff final; wajib lengkap dan dikunci |
| Belum ditemukan sambungan payroll run ke Finance | Tambah kontrak handoff, penerimaan, penolakan dan hasil pembayaran |
| Sampel memiliki HO, 13 toko dan DC | Desain ini mengikuti 14 unit yang diminta; DC diputuskan terpisah |

Rujukan utama kode yang diperiksa Luna:

- [Navigasi People](/Users/hari/itulah/frontend-hub/src/screens/people/nav.ts:54), [drawer pegawai](/Users/hari/itulah/frontend-hub/src/screens/people/directory.tsx:355).
- [Cakupan unit](/Users/hari/itulah/backend/src/cloud/domain/employment/reach.rs:152), [pemetaan tindakan](/Users/hari/itulah/backend/src/cloud/domain/employment/audit.rs:252).
- [Batas payroll HO](/Users/hari/itulah/backend/src/cloud/http/pay.rs:1), [penguncian run](/Users/hari/itulah/backend/src/cloud/domain/pay/run.rs:349).
- [API employee dan fallback](/Users/hari/itulah/frontend-employee/src/lib/hr/api.ts:25), [indikator stand-in](/Users/hari/itulah/frontend-employee/src/components/app-shell.tsx:94), [contoh presensi](/Users/hari/itulah/frontend-employee/src/lib/hr/demo.ts:80).

Pemeriksaan UI dilakukan pada node development dengan data seed dan akses development yang luas. Ini bukan bukti bahwa seluruh hak pengguna telah diuji dengan autentikasi aktif. Tidak ada akun, data pegawai, kebijakan atau kode aplikasi yang diubah dalam pekerjaan ini.

## Pembuktian sebelum diterapkan

1. HR Toko 01 tidak dapat membaca atau mengubah Toko 02 lewat daftar maupun ID langsung. Pegawai hanya mengakses dirinya sendiri. Supervisor HO tidak otomatis menjadi pemutus pusat.
2. HR unit dapat menyelesaikan tugas rutin sesuai mandat, tetapi tidak dapat memutuskan hire, akses atau beban gaji yang wajib HO. Pengaju tidak menyetujui pengajuannya sendiri, termasuk pegawai HO.
3. Pengajuan yang dikembalikan dan direvisi tetap satu ID dengan versi baru. Persetujuan lama tidak berlaku diam-diam untuk isi yang berubah.
4. Data presensi belum tersedia atau contoh tidak berubah menjadi fakta payroll. Kelengkapan periode dan komponen final diperiksa secara eksplisit.
5. Handoff hanya menerima batch lengkap, disetujui dan dikunci. Kirim ulang tidak menggandakan kewajiban; pembayaran dan revisi dapat ditelusuri ke versi sumber.
6. Mutasi/offboarding menjaga tanggal efektif, akses, komponen gaji dan checklist tanpa membuat pegawai atau pembayaran ganda.

Keputusan yang masih perlu ditetapkan saat implementasi: sumber presensi, batas delegasi rutin, pemutus pengganti untuk pengajuan HO, kebijakan komponen serta rilis slip, dan apakah DC termasuk cakupan HR yang sama. Rancangan menu tidak bergantung pada mengarang nilai-nilai kebijakan tersebut.
