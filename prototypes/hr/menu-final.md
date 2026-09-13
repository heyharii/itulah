# Menu final People / HR

Rancangan 13 September 2026. Untuk 1 Head Office yang mencakup kantor pusat dan DC, serta 13 store.

## Struktur dan cakupan

Satu People workspace dan satu struktur route. Role menentukan tindakan; unit menentukan baris data. HO bukan sekadar pengawas: HR HO juga mengurus pegawai kantor dan DC.

- Unit organisasi: Head Office + Store 01–13 = 14 unit.
- Bagian di Head Office: Kantor HO dan Distribution Center. DC tidak dihitung sebagai store atau unit organisasi ke-15.
- Pemilih HO: Semua unit / Head Office / Store 01–13. Ketika memilih HO, tersedia bagian Kantor & DC / Kantor HO / DC.
- HR Store / Store Manager: scope terkunci ke store yang ditugaskan. Kewenangan diberikan lewat mandat, bukan otomatis karena bekerja di suatu gedung.
- Preview menyediakan satu store contoh dan dua reviewer HO. Pengalih ini hanya alat demo; produksi menggunakan permission server.

## Menu utama

| Menu | Isi | HR HO | HR Store / manager berwenang |
|---|---|---|---|
| Ringkasan | Hari ini; Persetujuan saya; Perlu perhatian | Semua unit atau HO sendiri | Store sendiri |
| Karyawan | Daftar karyawan; Karyawan baru; Perubahan; Kontrak & penempatan; Onboarding; Offboarding; Akun & akses | Mengelola pegawai HO/DC dan memutuskan pengajuan lintas unit | Operasional dan pengajuan store sendiri |
| Jadwal & Kehadiran | Roster; Kehadiran; Koreksi; Tutup periode | Operasional HO/DC; pantau dan buka kembali periode store | Susun roster, kelola pengecualian, tutup periode store |
| Cuti & Lembur | Cuti & izin; Lembur; Hak & saldo | Operasional HO/DC, pengawasan lintas unit | Operasional store sesuai mandat |
| Payroll | Kesepakatan gaji; Payroll runs | Menyusun, memverifikasi, menyetujui, mengunci, menyerahkan ke Finance | Tidak ditampilkan |
| Laporan | Tenaga kerja; Waktu & ketidakhadiran; Beban gaji | Seluruh laporan sesuai scope | Dua laporan operasional, tanpa beban gaji |
| Pengaturan | Unit & penanggung jawab; Kebijakan waktu; Komponen payroll; Kewenangan | Pemilik kebijakan pusat | Tidak ditampilkan |

HR HO memiliki 7 domain menu. HR Store memiliki 5. Tidak ada pohon menu terpisah bagi DC.

Kebijakan waktu mengelompokkan kebijakan presensi, pola shift, jenis cuti, dan kalender libur. Pengaturan komponen payroll memisahkan komponen disahkan, sumber perhitungan, dan usulan yang belum menjadi master.

## Pengajuan gaji oleh store manager

Store manager dapat mengusulkan komponen baru yang menambah atau mengurangi gaji. Aksesnya ada di **Karyawan → Perubahan**, juga melalui **Buat pengajuan → Komponen gaji (+ / −)** dan detail karyawan.

| Field | Aturan rancangan |
|---|---|
| Karyawan, unit, bagian | Sesuai scope dan penempatan |
| Nama komponen | Dapat berupa nama usulan baru, belum otomatis menjadi master |
| Jenis | Penambah (+) atau pengurang (−) |
| Nominal | Angka positif; jenis menentukan arah perhitungan |
| Periode payroll | Periode yang menerima dampak |
| Frekuensi | Sekali pada periode ini; atau usulan berulang yang perlu kesepakatan HO |
| Tanggal berlaku | Eksplisit dan dapat ditelusuri |
| Alasan dan dasar | Wajib; dokumen pendukung ditautkan pada implementasi produksi |
| Pratinjau | Gaji pokok contoh +/− komponen; bukan take-home pay final |

Alur: Draf → diajukan → review HO → disetujui / dikembalikan / ditolak. Pengembalian memerlukan alasan. Revisi menghasilkan versi baru dengan jejak versi sebelumnya. Hanya komponen disetujui yang boleh menjadi sumber payroll. Komponen berulang tidak otomatis disahkan menjadi kebijakan umum organisasi.

**Perubahan gaji tetap** tetap tersedia sebagai pengajuan terpisah, agar perubahan kesepakatan gaji pokok tidak tercampur dengan bonus atau potongan satu periode.

Store mengusulkan komponen dan menutup data waktu. HR HO menyusun payroll, memeriksa kelengkapan dan usulan komponen, lalu mengendalikan approval. Ini memakai batas payroll HO pada Hub; instruksi terbaru pengguna menegaskan store boleh mengajukan komponen positif/negatif, bukan memberikan persetujuan sendiri.

Payroll yang sudah dikunci tidak ditimpa oleh pengajuan baru. Implementasi produksi perlu menautkan penyesuaian ke run/periode berikutnya atau versi pengganti melalui alur koreksi yang disahkan.

## Karyawan baru dan akun

- Pengajuan karyawan baru berada di Karyawan → Karyawan baru; ini usulan penerimaan terarah, tanpa pipeline rekrutmen umum.
- HO memutuskan, lalu proses onboarding menyiapkan kontrak, penempatan, orientasi, dan permintaan akun. Disetujui tidak sama dengan karyawan sudah aktif.
- Akun & akses berada dalam lifecycle karyawan, sehingga pengajuan mudah ditemukan HR. Keputusan HO tidak langsung mengaktifkan akun: System tetap mengeksekusi provisioning dan grants.
- Offboarding memuat checklist pekerjaan, aset, pencabutan akses, serta penyelesaian hak. Pencabutan akses dimiliki System; pembayaran dimiliki Finance.

## Akhir pekerjaan setiap domain

| Pelaku | Hasil |
|---|---|
| HR unit / Store manager | Data operasional benar, periode tertutup, usulan komponen/karyawan/akses diajukan |
| HR HO | Keputusan pengajuan jelas, payroll lengkap, diverifikasi, disetujui, dikunci |
| System | Akun dan hak akses dieksekusi sesuai keputusan |
| Finance | Kewajiban payroll diterima dan dibayar |

Verifikator payroll tidak boleh menjadi approver pada run yang sama. Pengaju tidak memutuskan pengajuannya sendiri. Data waktu yang belum dinilai tidak dianggap nol atau dianggap tidak hadir. Status terkirim ke Finance tidak berarti dibayar.

## Route rancangan

Route preview: `#/people/{domain}/{tab}`. Domain adalah overview, employees, time, leave, payroll, reports, setup. Satu route berlaku untuk semua role, dengan visibility dan scope berbeda.

URL produksi lama seperti `/people/roster`, `/people/periods`, `/people/pay`, dan `/people/payroll` sebaiknya dipetakan atau diarahkan ke domain baru saat implementasi. File production saat ini belum diubah.

## Design system

- Canvas, header, sidebar: #F7F8FA. Surface: #FFFFFF. Border: #E5E8EE.
- Primary: #2563EB; active surface: #EDF3FF; teks utama: #242A34.
- Inter dengan hierarki judul, label, isi, metadata; angka memakai tabular numerals.
- Border memberi pemisah utama; tabel dan filter memakai shadow ringan yang sama.
- Filter menetap di kanan pada layar lebar ≥1440px; menjadi panel overlay pada laptop. Dropdown filter dan unit memiliki pencarian.
- Detail memakai sheet hingga 940px, konten dapat digulir, aksi keputusan tetap terlihat di bawah.
- Form memiliki validasi, konfirmasi meninggalkan isian, draf, pengembalian, revisi dan riwayat.
