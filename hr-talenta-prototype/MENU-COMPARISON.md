# Perbandingan menu HR: prototipe Talenta · frontend-hub · Frappe HRMS

Ditulis 30 September 2026. Sumber yang dibaca:

- **Prototipe Talenta**: `schema.js` (141 halaman, dari `hr-talenta-inventory.md` 29 Sep 2026).
- **frontend-hub**: `src/screens/people/nav.ts` (modul People = departemen **HR** di sidebar), `src/screens/me/nav.ts`, tab di dalam layar People, `SIDEBAR-BRIEF.md` § "HR dan GA dipangkas (2026-09-27)", `IA-GAP.md`, `PEOPLE-BRIEF.md`.
- **Frappe HRMS**: branch `develop`, commit `b47aef4a7da4` (28 Sep 2026). Menu sekarang ada di fixture **Sidebar** per modul (`hrms/<module>/sidebar/*.json`), bukan lagi kartu link di workspace. `version-16` isinya sama.

## Ringkasan angka

| | Prototipe Talenta | frontend-hub (HR) | Frappe HRMS |
|---|---|---|---|
| Tingkat atas | 10 grup + Home + Employee profile | 1 departemen **HR** | 9 area (dock) |
| Baris menu | **141** | **11** untuk head office, **9** untuk manajer toko/DC | **134** link (termasuk 9 "Home"), 21 section |
| Layar yang ter-route tapi bukan baris | — | 8 (`hidden`: New employees, Recruitment, Training, Performance, Overtime, Period close, Punch stations, Scheduler) | 34 DocType + 6 report tanpa link sidebar |
| Setup | 55 halaman di Settings (7 sub-grup) | 1 baris **Settings** dengan 4 tab | Section "Setup" per area (tertutup default) + 1 link Settings |
| Self-service karyawan | Settings · ESS (4 halaman konfigurasi) | `/me`: Profile, Attendance, Leave, Overtime, Pay, Claims, My details | PWA `/hrms`: Home, Attendance, Leaves, Expenses, Salary |

## Cara masing-masing menyusun menu

**Talenta: satu baris per layar.** Setiap fitur dan setiap tabel master punya baris sendiri. Contohnya cuti: Time off requests, Time off transaction, dan Balance history adalah tiga baris. Settings dipecah lagi menjadi Account, Company, Time, Payroll, Finance, ESS, dan Users.

**frontend-hub: satu baris = tempat yang dibuka minimal tiap minggu** (aturan owner, 27 Sep 2026).

- Urusan satu orang menjadi **tab di lembar karyawan**: Record, Leave, Claims, Contracts, Pay, Uniforms, Exit, Change.
- Pekerjaan bulanan menjadi **tombol** di layar terkait, misalnya Period close dari Attendance dan Overtime dari Roster.
- Setup yang jarang dibuka menjadi **satu baris Settings** dengan tab Attendance, Shifts, Leave types, dan Holidays.
- Satu menu melayani dua peran (`audience`): manajer tempat dan head office.
- Menu mengikuti endpoint yang ada. Baris tanpa endpoint tidak dibuat (`IA-GAP.md`).

**HRMS: sidebar per area.** Transaksi utama ada di atas. Reports, Setup, Planning, dan Travel adalah section yang bisa dilipat dan tertutup secara default. Link Settings ada di bawah. Hampir setiap baris adalah satu DocType.

## Scope final & daftar menu HR (30 Sep 2026)

Keputusan: **56 fitur dipertahankan** (sudah ada di hub), **40 dibangun**, **50 dicoret**.

### Daftar menu (sidebar HR)

10 baris, mengikuti aturan hub "satu baris = tempat yang dibuka tiap minggu". Fitur baru masuk sebagai tab atau tombol, bukan baris baru.

**Pintu depan**

1. **Overview & requests** — Antrean yang menunggu keputusan: cuti, koreksi absen, tukar shift, lembur, klaim, pinjaman, payroll.
2. **Employees** — Daftar + lembar karyawan. Tombol: Add employee (form data karyawan baru, baru), Org chart (baru).
   - Record
   - Change: mutasi, promosi, status kepegawaian, PTKP, data pribadi
   - Contracts (PKWT)
   - Leave: saldo, alokasi, riwayat
   - Pay: gaji, komponen per orang, BPJS/NPP (baru)
   - Claims
   - Loans (baru)
   - Discipline: teguran/SP (baru)
   - Onboarding checklist (baru)
   - Exit: offboarding, exit interview, pesangon
3. **Invitations** — Undangan akun karyawan.
4. **Job roles** — Jabatan dan akses per section.

**Waktu**

5. **Roster** — Jadwal mingguan per orang. Tombol: Overtime, Kalender tim (baru).
6. **Attendance** — Kehadiran harian dari fingerprint, log mesin, koreksi, potongan absen (baru).

**Uang**

7. **Claims** — Reimburse.
   - Queue
   - All
   - Loans: pinjaman karyawan (baru)
   - Balances: plafon per karyawan (baru)
   - Disbursement: pencairan (baru)
   - Types
8. **Payroll** — Toko submit, HO approve. PPh21 dan BPJS dihitung otomatis seperti Talenta (baru). Tombol: Import payroll, Run THR, Tahan gaji, Hitung ulang pajak (semua baru).
   - Runs
   - One-offs
   - Tax: PPh21 otomatis metode TER, hitung ulang Desember, bukti potong 1721-A1 (baru)
   - BPJS: Kesehatan, JHT, JP, JKK, JKM otomatis (baru)

**Laporan & aturan**

9. **Reports** — Workforce, Time & absence, Payroll cost, + Potongan pajak dan Kerja di hari libur (baru).
10. **Settings** — Aturan, HO saja.
   - Company: info, struktur grup, SBU, departemen, level, grade (baru)
   - Attendance: toleransi, geofence, absen mobile, jam istirahat
   - Shifts
   - Overtime rules (baru)
   - Leave types: + blok tanggal, uangkan cuti, cuti roster
   - Holidays
   - Payroll: komponen & struktur, cut-off, prorata, THR, tarif PPh21/TER & BPJS, template & password slip (baru)
   - Approval: delegasi, modul ESS (baru)

Layar tersembunyi (ter-route, bisa dicari ⌘K): Overtime, dibuka dari Roster.

Tanpa layar: **Scheduler** jalan di belakang layar (akrual cuti, carry-forward, roster minggu depan, pengingat). **Punch stations** (fingerprint) fungsinya tetap, layarnya belum ditampilkan.

Self-service karyawan (`/me`): Profile, Attendance, Leave, Overtime, Pay (slip gaji), Claims, **Loans (baru)**, My details.

**Dihapus dari hub:** tab Uniforms, layar Recruitment, New employees (usulan hire; diganti tombol Add employee), Period close, Grievances (+ Speak up di `/me`), Performance, Training programmes, potong kasbon di Payroll › One-offs.

**Perubahan keputusan lama:** hub dulu sengaja tidak menghitung PPh21/BPJS dan membuang master departemen/level/grade. Scope ini membalik keduanya.

### Dibangun (40)

- **Karyawan:** Bagan organisasi, Import/export prorate

- **Struktur organisasi:** Info perusahaan, Struktur grup, Organisasi / departemen, Strategic business unit, Level jabatan, Grade & class, NPP BPJS & riwayatnya

- **On/offboarding:** Form data karyawan baru, Onboarding checklist

- **Kehadiran:** Potongan absen, Lokasi absen (geofence), Setting absen mobile / portal

- **Jadwal & shift:** Jam istirahat

- **Lembur:** Aturan / tipe lembur

- **Cuti & libur:** Cuti untuk pekerja roster, Uangkan cuti, Blok tanggal cuti, Kerja di hari libur, Kalender tim

- **Klaim & pinjaman:** Saldo / benefit per karyawan, Pencairan, Pinjaman karyawan

- **Payroll:** Import payroll, Tahan gaji, Komponen & struktur gaji, Jadwal, cut-off & pembayaran, Template slip gaji, Password slip gaji, Prorata, THR, Kompensasi custom / insentif

- **Pajak & BPJS:** Kalkulator / komputasi pajak, Hitung ulang pajak, Bukti potong / taxslip, Laporan potongan pajak

- **Hubungan industrial:** Teguran / SP

- **User & akses:** Delegasi approval, Modul ESS

### Status pembangunan (1 Okt 2026)

Semua 40 fitur sudah dibangun di worktree `hr-payroll-id` (backend + frontend-hub). Setiap fitur punya integration test. Belum di-commit.

| Fitur | Di mana | Migrasi |
|---|---|---|
| Bagan organisasi | Baris baru **Org chart** + tab **Position** di lembar karyawan | 0805 |
| Import/export prorate | Employees › tombol **Import & export** (export CSV karyawan, import perubahan gaji CSV). Settings › Payroll › schedule: prorata kalender / hari kerja 6 / 5 hari | 0814 |
| Info perusahaan, struktur grup, SBU, departemen, level, grade & class, NPP BPJS + riwayat | Settings › **Organisation** | 0805 |
| Form data karyawan baru | Employees › **Add employee** | — |
| Onboarding checklist | Tab **Checklist** di lembar karyawan. Template di Settings › Organisation. Tugas seragam dipensiunkan | 0806 |
| Potongan absen | Settings › Payroll › Absence deduction. Hari absen tampil di slip | 0807 |
| Lokasi absen (geofence), setting absen mobile | Settings › Attendance. `/me` mengirim lokasi saat punch | 0807 |
| Jam istirahat | Settings › Shifts (jam mulai istirahat) | 0807 |
| Aturan / tipe lembur | Settings › Payroll › Overtime rules. Jam ke-8/9 hari istirahat & libur, preset Kepmen 102/2004 | 0808 |
| Cuti pekerja roster | Otomatis: hanya hari ber-roster kerja yang dipotong | 0809 |
| Uangkan cuti, kerja di hari libur | Tab Leave di lembar karyawan | 0809 |
| Blok tanggal cuti | Settings › Leave types | 0809 |
| Kalender tim | Baris baru **Team calendar** | 0809 |
| Saldo / benefit per karyawan | Claims › **Allowances**, tab Claims karyawan, `/me` Claims | 0810 |
| Pencairan | Sudah ada (payout klaim). Pinjaman dicairkan Finance dari Advances | — |
| Pinjaman karyawan | Tab **Loans** karyawan, Claims › Loans, `/me` Pay. Cicilan otomatis per run | 0804 |
| Import payroll | Payroll › One-offs › Import from a sheet | — |
| Tahan gaji, template & password slip | Run sheet (Hold pay), Settings › Payroll › Payslip, `/me` | 0803 |
| Komponen & struktur, jadwal/cut-off, prorata, THR, kompensasi/insentif | Settings › Payroll, Payroll run | 0800–0802 |
| PPh21 TER, hitung ulang, 1721-A1, laporan potongan | Payroll (Recalculate), Reports › **Tax & BPJS**, `/me` Pay | 0800 |
| Teguran / SP | Tab **Discipline** karyawan, Reports › Workforce, `/me` My details (konfirmasi terima) | 0811 |
| Delegasi approval | Overview (manajer), Settings › **Employee app** (HO) | 0812 |
| Modul ESS | Settings › **Employee app**. Modul yang dimatikan disembunyikan di `/me` | 0813 |

Perubahan dari daftar menu di atas: **Org chart** dan **Team calendar** menjadi baris sendiri, bukan tombol. Settings mendapat tab **Organisation** dan **Employee app**. Lembar karyawan mendapat tab **Position**, **Checklist**, **Discipline**, dan **Loans**.

### Dicoret (50)

- **Karyawan:** Resign massal, Custom field, Seragam, Peta skill

- **Struktur organisasi:** Kelompok karyawan

- **Rekrutmen:** Overview rekrutmen, Permintaan tenaga kerja, Manpower / staffing plan, Lowongan, Kandidat, Tahapan / pipeline, Interview & kalender, Offer & appointment letter, Talent pool, Assessment, Referral, Career page / job portal, Laporan rekrutmen, Log aktivitas rekrutmen, Template email, Kandidat terlarang, User & role rekrutmen, Integrasi job board, Langganan modul

- **Kehadiran:** Tutup periode absensi, Liveness (verifikasi wajah)

- **Jadwal & shift:** On-call (jadwal, aktivitas, kategori)

- **Produktivitas:** Proyek, Task, Timesheet / time tracker, Laporan aktivitas & utilisasi, Grup untuk payroll, Form & survei, Template & generate dokumen

- **Klaim & pinjaman:** Perjalanan dinas, Kendaraan dinas, Laporan klaim belum dibayar

- **Payroll:** Cost center

- **Pajak & BPJS:** PPh21 DTP, Tax slab & exemption (India)

- **Performance & training:** Feedback kinerja

- **User & akses:** Fitur eksperimen

- **Integrasi & add-on:** Integrasi produk (ERP, mesin absen), API data masking, Add-on expense / kartu / asuransi

- **Hubungan industrial:** Keluhan (grievance)

- **Performance:** Goal / KRA, Appraisal
- **Klaim:** Kasbon / advance (kebijakan HR, di luar sistem)
- **Training:** Training programmes

## Matriks per menu

146 baris fitur. Ke-143 halaman Talenta (141 menu + Home + Employee profile), 109 link unik di sidebar HRMS, dan ke-19 menu HR hub (11 baris sidebar + 8 hidden) masing-masing muncul di salah satu baris. Tabel ini diperiksa otomatis terhadap `schema.js` dan inventaris HRMS.

- **✓** = menu sendiri (baris di sidebar/navigasi).
- **◐** = ada, tetapi bukan baris menu: tab, tombol, layar hidden, DocType HRMS tanpa link sidebar, modul lain, atau fitur core Frappe/ERPNext.
- **✗** = tidak ada.

| | ✓ | ◐ | ✗ |
|---|---:|---:|---:|
| Talenta | 113 | 10 | 23 |
| frontend-hub (HR) | 13 | 53 | 80 |
| Frappe HRMS | 71 | 29 | 46 |

Jika ✓ dan ◐ dihitung sebagai "ada": **45** fitur ada di ketiganya, **32** hanya di Talenta, **3** hanya di hub (tutup periode absensi, seragam, otomasi terjadwal), dan **13** hanya di HRMS.

### Beranda

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| Home / dashboard HR | ✓ Home | ✓ Overview & requests | ✓ Home + Dashboard tiap area (6 dashboard) |

### Karyawan

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| Daftar karyawan | ✓ Employee list | ✓ Employees | ✓ Employee |
| Profil / detail karyawan | ✓ Employee profile | ◐ Lembar karyawan (tab Record) | ◐ Form Employee |
| Bagan organisasi | ◐ Tab Org chart di Employee list | ✗ | ✓ Organizational Chart |
| Mutasi / transfer | ✓ Employee transfer | ◐ Tab Change › Where they are posted | ◐ Employee Transfer (tanpa link) |
| Promosi | ◐ Transfer type Promotion | ◐ Tab Change | ✓ Employee Promotion (Performance) |
| Kontrak (PKWT) | ◐ Transfer type Extend Contract | ◐ Tab Contracts | ✗ |
| Resign massal | ✓ Mass resignation | ✗ | ✗ |
| Import/export prorate | ✓ Import/export prorate | ✗ | ✗ |
| Ubah status PTKP | ✓ PTKP status adjustment | ◐ Tab Pay (PTKP) | ✗ |
| Ubah data pribadi | ◐ Edit di Employee profile | ◐ Tab Change › Amend personal data | ◐ Form Employee |
| Format nomor karyawan | ✓ Auto generate format | ◐ Tab Change › Correct the employee number | ✗ |
| Custom field | ✓ Custom field | ✗ | ◐ Customize Form (core Frappe) |
| Batasi akses data karyawan | ✓ Restricted employee | ◐ Scope per posting (audience) | ◐ User Permission (core Frappe) |
| Seragam | ✗ | ◐ Tab Uniforms | ✗ |
| Peta skill | ✗ | ✗ | ✓ Employee Skill Map |

### Struktur organisasi

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| Info perusahaan | ✓ Company info | ✗ | ✓ Company |
| Struktur grup | ✓ Group structure | ✗ | ✗ |
| Cabang / unit kerja | ✓ Branch | ◐ System › Units (toko/DC) | ✓ Branch |
| Organisasi / departemen | ✓ Organization | ✗ Dibuang (cukup org_place) | ✓ Department |
| Strategic business unit | ✓ Strategic business unit | ✗ | ✗ |
| Jabatan | ✓ Job position | ✓ Job roles | ✓ Designation |
| Level jabatan | ✓ Job level | ✗ | ✗ |
| Grade & class | ✓ Grade & class | ✗ Dibuang | ✓ Employee Grade |
| Kelompok karyawan | ✗ | ✗ | ✓ Employee Group |
| Status kepegawaian | ✓ Employment status | ◐ Tab Change › Employment status | ◐ Employment Type (tanpa link) |
| NPP BPJS & riwayatnya | ✓ NPP, NPP Transaction History | ✗ | ✗ |

### Rekrutmen

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| Overview rekrutmen | ✓ Overview | ✗ | ✓ Home + Dashboard Recruitment |
| Permintaan tenaga kerja | ◐ Lewat Manpower planning | ◐ New employees (hidden, usulan hire) | ✓ Job Requisition |
| Manpower / staffing plan | ✓ Manpower planning | ✗ | ✓ Staffing Plan |
| Lowongan | ✓ Job listings | ✗ | ✓ Job Opening, Job Opening Template |
| Kandidat | ✓ Candidates | ◐ Recruitment (hidden) | ✓ Job Applicant |
| Tahapan / pipeline | ✓ Hiring stages | ✗ | ✓ Hiring Pipeline (kanban) |
| Interview & kalender | ✓ Calendar | ◐ Recruitment (hidden) | ✓ Interview, Interview Type |
| Offer & appointment letter | ✗ | ✗ | ✓ Job Offer, Appointment Letter, Job Offer Term Template, Appointment Letter Template |
| Talent pool | ✓ Talent pool | ✗ | ✗ |
| Assessment | ✓ Assessments | ✗ | ✗ |
| Referral | ✗ | ✗ | ✓ Employee Referral |
| Career page / job portal | ✓ Career page | ✗ | ✓ Job Portal (/jobs) |
| Laporan rekrutmen | ✓ Time to hire report | ✗ | ✓ Recruitment Analytics |
| Log aktivitas rekrutmen | ✓ Activity log | ✗ | ✗ |
| Template email | ✓ Email templates | ✗ | ◐ Email Template (core Frappe) |
| Kandidat terlarang | ✓ Restricted candidates | ✗ | ✗ |
| User & role rekrutmen | ✓ Users, Roles & permissions | ✗ | ◐ Role (core Frappe) |
| Integrasi job board | ✓ Integrations | ✗ | ✗ |
| Langganan modul | ✓ Subscription | ✗ | ✗ |

### On/offboarding

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| Form data karyawan baru | ✓ New joiner submission | ✗ | ✗ |
| Onboarding checklist | ✓ Onboarding, Onboarding setting, Onboarding task | ✗ | ✓ Employee Onboarding (+Template tanpa link) |
| Undangan akun karyawan | ✓ Invitation to Talenta | ✓ Invitations | ◐ Undang user (core Frappe) |
| Offboarding checklist | ✓ Offboarding, Offboarding task template | ◐ Tab Exit | ✓ Employee Separation (+Template tanpa link) |
| Exit interview / dokumen keluar | ✓ Offboarding forms and docs | ◐ Tab Exit | ◐ Exit Interview (tanpa link) |
| Pesangon / kompensasi keluar | ✓ Ex Employee Allowance, PKWT Compensation, Resign compensation | ◐ Tab Exit (Full & Final) | ◐ Full and Final Statement, Gratuity (tanpa link) |

### Kehadiran

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| Data kehadiran harian | ✓ Attendance data | ✓ Attendance | ✓ Employee Attendance Tool (+Attendance tanpa link) |
| Log clock-in/out | ✓ Attendance activity | ◐ Di Attendance (What the device saw) | ✓ Employee Checkin |
| Koreksi kehadiran | ✗ | ◐ Antrean di Overview + /me Correct a day | ✓ Attendance Request |
| Potongan absen | ✓ Absence deduction, Absence | ✗ | ✗ |
| Tutup periode absensi | ✗ | ◐ Period close (tombol di Attendance) | ✗ |
| Mesin absen / fingerprint | ✓ Machine | ◐ Punch stations (dari Settings) | ✗ |
| Lokasi absen (geofence) | ✓ Location set up | ✗ | ✓ Shift Location |
| Setting absen mobile / portal | ✓ Mobile set up, Portal | ✗ | ◐ HR Settings (mobile check-in) |
| Liveness (verifikasi wajah) | ✓ Liveness | ✗ | ✗ |
| Toleransi telat / aturan absen | ◐ Di pengaturan Shift | ◐ Settings › Attendance (tab) | ◐ Di Shift Type |

### Jadwal & shift

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| Roster / jadwal kerja | ✓ Scheduler | ✓ Roster | ✓ Roster (/hr/roster) |
| Master shift | ✓ Shift | ◐ Settings › Shifts (tab) | ✓ Shift Type |
| Jam istirahat | ✓ Break | ✗ | ✗ |
| Jadwal otomatis | ✓ Auto schedule | ◐ Scheduler (roster minggu depan) | ✓ Shift Schedule |
| Assign shift | ◐ Aksi Assign shift di Scheduler | ◐ Di Roster | ◐ Shift Assignment (tanpa link) |
| Tukar / request shift | ✗ | ◐ /me Swap a day + antrean Overview | ✓ Shift Request |
| On-call (jadwal, aktivitas, kategori) | ✓ On-call schedule, On-call activity, On-call category | ✗ | ✗ |
| Otomasi terjadwal (akrual, pengingat) | ✗ | ◐ Scheduler (dari Settings) | ✗ |

### Lembur

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| Pengajuan / perintah lembur | ✓ Overtime requests | ◐ Overtime (dari Roster) + konsen di /me | ✓ Overtime Slip |
| Aturan / tipe lembur | ✓ Overtime | ✗ | ✓ Overtime Type |

### Cuti & libur

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| Pengajuan cuti | ✓ Time off requests | ✓ Overview & requests (antrean) | ✓ Leave Application |
| Alokasi / penyesuaian saldo | ✓ Time off transaction | ◐ Tab Leave di lembar karyawan | ✓ Leave Allocation, Leave Control Panel, Leave Policy Assignment |
| Riwayat / laporan saldo | ✓ Balance history | ◐ Tab Leave | ✓ Leave Balance, Leave Balance Summary |
| Jenis & kebijakan cuti | ✓ Time off | ◐ Settings › Leave types (tab) | ✓ Leave Type, Leave Policy, Leave Period |
| Hari libur | ✓ Holiday | ◐ Settings › Holidays (tab) | ✓ Holiday List, Holiday List Assignment |
| Cuti untuk pekerja roster | ✓ Roster leave | ✗ | ✗ |
| Uangkan cuti | ✓ Time off compensation | ✗ | ✓ Leave Encashment |
| Blok tanggal cuti | ✗ | ✗ | ✓ Leave Block List |
| Kerja di hari libur | ✗ | ✗ | ✓ Employees Working on a Holiday (report) |
| Kalender tim | ✓ Calendar | ✗ | ◐ Calendar view Leave Application |

### Produktivitas

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| Proyek | ✓ Projects | ✗ | ◐ Project (ERPNext) |
| Task | ✓ Tasks | ✗ | ◐ Task (ERPNext) |
| Timesheet / time tracker | ✓ Time Tracker, Timesheet | ✗ | ✓ Timesheet, Activity Type |
| Laporan aktivitas & utilisasi | ✓ Activities, Summary, Tracker Report | ✗ | ✓ Employee Hours Utilization, Project Profitability |
| Grup untuk payroll | ✓ Group for payroll | ✗ | ✗ |
| Form & survei | ✓ Forms & surveys, My submissions | ✗ | ✗ |
| Template & generate dokumen | ✓ Document Template, Generated documents | ✗ | ◐ Hanya Appointment Letter Template |

### Klaim & pinjaman

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| Pengajuan reimburse / klaim | ✓ All requests | ✓ Claims | ✓ Expense Claim |
| Saldo / benefit per karyawan | ✓ Assign or update | ✗ | ✓ Benefit Application, Benefit Claim |
| Jenis reimburse | ✓ Reimbursement | ◐ Claims › Types (tab) | ✓ Expense Claim Type |
| Pencairan | ✓ Disbursement | ✗ | ✓ Payment Entry, Journal Entry |
| Kasbon / advance | ✗ | ◐ Payroll › One-offs (potong advance) | ✓ Employee Advance |
| Pinjaman karyawan | ✓ Loan, Loan | ✗ | ✗ App Lending terpisah |
| Perjalanan dinas | ✗ | ✗ | ✓ Travel Request, Purpose of Travel |
| Kendaraan dinas | ✗ | ✗ | ✓ Vehicle Log, Vehicle, Driver, Vehicle Expenses |
| Laporan klaim belum dibayar | ✗ | ✗ | ✓ Unpaid Expense Claim |

### Payroll

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| Proses payroll | ✓ Payroll processing | ✓ Payroll (toko submit, HO approve) | ✓ Payroll Entry |
| Riwayat payroll & slip gaji | ✓ Payroll history | ◐ Di Payroll (Runs) | ✓ Salary Slip |
| Import payroll | ✓ Import Payroll | ✗ | ✗ |
| Penyesuaian komponen / one-off | ✓ Payroll component adjustment | ◐ Payroll › One-offs | ✓ Additional Salary |
| Tahan gaji | ✗ | ✗ | ✓ Salary Withholding |
| Gaji per karyawan | ◐ Tab Payroll di profil | ◐ Tab Pay (pay agreement, HO) | ✓ Salary Structure Assignment |
| Komponen & struktur gaji | ✓ Payroll component | ✗ | ✓ Salary Component, Salary Structure |
| Jadwal, cut-off & pembayaran | ✓ Payroll schedule, Cut Off & Tax Settings, Payment schedule | ✗ | ◐ Payroll Settings, Payroll Period (tanpa link) |
| Template slip gaji | ✓ Payslip templates | ✗ | ✗ |
| Password slip gaji | ✓ Password payslip | ✗ | ◐ Payroll Settings |
| Prorata | ✓ Pro-rate | ✗ | ◐ Payroll Settings |
| THR | ✓ Run THR, THR | ✗ | ✗ |
| Kompensasi custom / insentif | ✓ Custom compensation | ✗ | ◐ Employee Incentive, Retention Bonus (tanpa link) |
| Cost center | ✓ Cost Center | ✗ | ◐ Cost Center (ERPNext) |
| Jurnal / GL payroll | ✓ General Ledger Mapper | ◐ Diserahkan ke Finance (HO) | ✓ General Ledger, Accounts Payable, Accounts Receivable |
| Laporan payroll | ✓ Reports | ◐ Reports › Payroll cost (tab) | ✓ Salary Register, Employee CTC Break-up, Accrued Earnings Report |

### Pajak & BPJS

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| Kalkulator / komputasi pajak | ✓ Salary Tax Calculator | ✗ PPh21 dihitung di luar | ✓ Income Tax Computation |
| PPh21 DTP | ✓ PPh21 DTP | ✗ | ✗ |
| Hitung ulang pajak | ✓ Tax/Recalculate | ✗ | ✗ |
| Bukti potong / taxslip | ✓ Taxslip | ✗ | ✗ |
| Tarif BPJS | ✓ BPJS New Rate | ◐ Data BPJS di tab Pay, nilai diinput manual | ✗ |
| Laporan potongan pajak | ✗ | ✗ | ✓ Income Tax Deductions, Professional Tax Deductions |
| Tax slab & exemption (India) | ✗ | ✗ | ✓ Income Tax Slab, Exemption Declaration, Exemption Submission Proof, Exemption Category |

### Performance & training

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| Goal / KRA | ✗ Produk terpisah | ◐ Performance (hidden) | ✓ Goal, KRA |
| Appraisal | ✗ Produk terpisah | ◐ Performance (hidden, skor bulanan) | ✓ Appraisal Cycle, Appraisal, Appraisal Template, Appraisal Overview |
| Feedback kinerja | ✗ | ✗ | ✓ Employee Performance Feedback, Employee Feedback Criteria |
| Training | ◐ LMS (Add-on LMS) | ◐ Training programmes (hidden) | ✓ Training Program, Training Event, Training Feedback, Training Result |

### Hubungan industrial

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| Teguran / SP | ✓ Reprimand | ✗ | ✗ |
| Keluhan (grievance) | ✗ | ✓ Grievances (HO) + /me Speak up | ✓ Employee Grievance, Grievance Type |

### Perusahaan & laporan

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| Aset | ✓ Assets list, Assigned assets, Asset category | ◐ Modul GA › Assets (bukan HR) | ✗ ERPNext Asset |
| Pengumuman | ✓ Announcements | ◐ Discussions (global) | ✗ |
| Notifikasi | ✓ Notification, Notification, Queue activity | ◐ System › Notifications + bell | ◐ Notifikasi PWA |
| File perusahaan | ✓ Company files, Files | ◐ Files (global) | ✗ |
| Log aktivitas user | ✓ User Activity Log | ◐ System › Activity | ✗ |
| Report builder | ✓ Report Builder | ◐ Reports › Saved (global) | ◐ Report builder core Frappe |
| Laporan HR / kehadiran | ✓ Time Reports | ✓ Reports (Workforce, Time & absence) | ✓ Monthly Attendance Sheet, Shift Attendance |
| Laporan data karyawan | ✗ | ◐ Reports › Workforce (tab) | ✓ Employee Information, Employee Birthday, Employee Exits, Employee Analytics |

### User & akses

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| User | ✓ Users | ◐ System › Users | ✗ Core Frappe |
| Role akses | ✓ Access role | ✓ Job roles (akses per section) | ✗ Core Frappe |
| Alur approval | ✓ Approval, New approval | ◐ Mengikuti posting (audience) | ◐ Approver di Employee/Department |
| Delegasi approval | ✓ Delegation | ✗ | ✗ |
| Modul ESS | ✓ Module | ✗ | ◐ HR Settings |
| Akun sendiri (foto, password) | ✓ Profile picture, Change password | ◐ /me Profile | ◐ PWA Settings |
| Fitur eksperimen | ✓ Talenta labs | ✗ | ✗ |
| Self-service karyawan (app) | ◐ Aplikasi mobile, di luar inventaris | ✓ /me: Profile, Attendance, Leave, Overtime, Pay, Claims, My details | ✓ PWA /hrms: Home, Attendance, Leaves, Expenses, Salary |

### Integrasi & add-on

| Menu / fitur | Talenta | frontend-hub | Frappe HRMS |
|---|---|---|---|
| Integrasi produk (ERP, mesin absen) | ✓ Product | ✗ | ✗ |
| API data masking | ✓ API Data Masking | ✗ | ✗ |
| Add-on expense / kartu / asuransi | ✓ Mekari Expense, Mekari Flex, Insurance | ✗ | ◐ Employee Health Insurance (tanpa link) |

## Temuan

1. **Talenta punya ~13× baris menu hub**, tetapi sebagian besar selisihnya adalah setup. Sebanyak 55 dari 141 halaman ada di Settings. Setup semacam itu di hub menjadi 4 tab, dan di HRMS menjadi section yang tertutup.
2. **Di Talenta dan HRMS, tetapi belum ada di hub:**
   - manpower / staffing plan
   - loan (Talenta)
   - timesheet dan produktivitas
   - pipeline rekrutmen penuh (ditolak owner 4 Sep)
   - appraisal penuh (hub hanya punya skor bulanan yang tersembunyi)

   Hub sengaja memotong semua ini. Kalau mau dihidupkan lagi, cek dulu endpoint-nya (`IA-GAP.md`).
3. **Hanya ada di Talenta:**
   - lokalisasi Indonesia: PTKP, PPh21 DTP, BPJS, THR, NPP, PKWT compensation
   - on-call
   - liveness
   - forms & surveys, document template

   HRMS tidak punya lokalisasi Indonesia (Tax & Benefits-nya berorientasi India). Hub tidak menghitung pajak.
4. **Hanya ada di hub:**
   - satu menu dengan dua peran (manajer tempat dan head office)
   - period close
   - binding sidik jari per stasiun
   - seragam
   - antrean "Overview & requests" yang menggabungkan cuti, koreksi, dan tukar jadwal

   Grievance ada di hub dan HRMS, tetapi Talenta hanya punya Reprimand.
5. **HRMS paling dekat dengan hub** dalam struktur: transaksi di atas dan setup dilipat. Bedanya, HRMS tetap satu baris per DocType, sedangkan hub menggabungkan per tempat kerja (lembar dan tab).

## Kalau prototipe ini mau dijadikan acuan untuk hub

Jangan salin 141 baris. Dengan aturan "satu baris = tempat mingguan", pemetaan yang konsisten adalah:

| Menu Talenta | Tempatnya di hub |
|---|---|
| Employee list, Employee profile, transfer, resign, reprimand | Employees → lembar karyawan (tab Change / Exit) |
| Time off requests + transaction + balance history | Overview & requests + tab Leave |
| Attendance data / activity / absence deduction | Attendance (+ tombol Period close) |
| Scheduler, Overtime requests | Roster (+ tombol Overtime) |
| All requests, Assign or update (reimbursement) | Claims |
| Payroll processing / history / component adjustment | Payroll |
| Report Builder, Time Reports, Payroll Reports | Reports |
| Settings · Time / Payroll / Company (setup jarang) | Settings (tab), atau `hidden` + ⌘K |

Keputusan produk yang terbuka: apakah **loan, manpower planning, dan kalkulasi PPh21/BPJS/THR** masuk ke hub. Ketiganya ada di Talenta, dan tidak satu pun punya endpoint di hub hari ini.
