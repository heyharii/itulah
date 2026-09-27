# Audit modul HR — 24 September 2026

## Ruang lingkup dan pendekatan

Audit membaca working tree saat ini, mencocokkan route backend ↔ query/form UI ↔ tipe payload, memeriksa koneksi data dan proses latar, membandingkan fitur inti dengan Frappe HRMS `develop` (commit lokal `aa1ec5a249075773f904b1c416e6a739140c830c`), lalu menjalankan integration target HR dan pemeriksaan frontend yang tersedia. Training, Recruitment, dan Performance dikecualikan dari perbandingan fungsi. Hire proposal tidak dinilai sebagai fitur rekrutmen; transisi status karyawan setelah direkrut tetap masuk lifecycle.

Working tree sudah berisi banyak perubahan lokal sebelum audit. Tidak ada source code, migration, atau test yang diubah oleh audit ini. Temuan menggambarkan kode yang ada pada working tree, bukan hanya commit terakhir.

## Ringkasan

Backend People/HR sudah mencakup employee lifecycle, cuti, kalender libur, jadwal dan kehadiran, overtime, payroll manual, klaim biaya, grievance, exit interview, serta full-and-final. Ada pembatasan cakupan per tempat dan pemisahan wewenang yang baik; data pribadi dipisahkan dari profil kerja, nomor rekening dimasking, data fingerprint tidak dikirim kembali, dan banyak perubahan meminta alasan serta menyimpan jejak audit.

Temuan yang paling memengaruhi operasi:

1. Alur klaim biaya di portal gagal pada saat membuat dan mengirim klaim: dua payload tidak mengisi `reason` yang diwajibkan backend.
2. Panel kontrak pada aplikasi karyawan menganggap object respons sebagai array; respons live API membuat panel melempar error.
3. Pengajuan koreksi absensi di aplikasi karyawan memakai URL dan skema body lama; klaim koreksi hanya menjadi data demo dan tidak tersimpan.
4. `frontend-hub-2` belum menjadi pengganti yang lengkap. Halaman Absensi, Koreksi, dan Klaim masih placeholder; beberapa teksnya menyatakan backend tidak punya fitur yang sebenarnya sudah ada.
5. Tidak ditemukan scheduler HR di proses backend. Akru cuti, pengingat masa kontrak, proses absensi otomatis, pengiriman roster ke terminal, dan reminder HR memerlukan tindakan manual atau proses eksternal.
6. Payroll belum menghitung PPh 21/BPJS secara otomatis. Payroll memiliki komponen dan potongan yang dapat dikonfigurasi, tetapi tidak membuat hasil statutory Indonesia.

## Temuan yang perlu ditangani

### P1 — Klaim biaya selalu gagal dibuat/dikirim dari portal lama

Backend `FileBody` mewajibkan `reason` dan menolak field asing. `fileClaim()` hanya mengirim `employee_id` dan `lines`; form hanya meminta jenis biaya, tanggal, nominal, dan deskripsi. Jadi POST pembuatan ditolak sebagai field wajib yang hilang. Jika request pertama diperbaiki, langkah submit tetap mengirim `{}`, sementara endpoint submit juga mewajibkan `{ reason }`. Lihat [claims.rs](../backend/src/cloud/http/claims.rs#L147) dan [people.ts](../frontend-hub/src/lib/queries/people.ts#L1957); field form ada di [claims.tsx](../frontend-hub/src/screens/people/claims.tsx#L470).

### P1 — Panel kontrak aplikasi karyawan memakai bentuk respons yang salah

Client mengetik `/employees/me/contracts` sebagai `EmploymentContract[]`; backend mengirim `ContractsView` object yang memiliki `{ employee_id, contracts, pkwt_run }`. Screen langsung menjalankan `list.map()` dan membaca field kontrak yang tidak ada (`contract_id`, `started_on`, `weekly_hours`, `place_name`). Karena endpoint hidup dan menjawab 200, fallback demo tidak bekerja. Panel Kontrak dapat merusak render layar Me. Lihat [api.ts](../frontend-employee/src/lib/hr/api.ts#L150), [me.tsx](../frontend-employee/src/screens/me.tsx#L75), [employment.rs](../backend/src/cloud/http/employment.rs#L316).

### P1 — Koreksi absensi aplikasi karyawan tidak terhubung ke API

Client membaca dan menulis `/employees/me/attendance/corrections` dengan field `date`, `claimed_in`, dan `claimed_out`. Backend menyediakan GET antrean di `/attendance-corrections`, POST untuk karyawan di `/employees/{id}/attendance-corrections`, dan body `business_date`, `effect`, `arrival`/`departure`, day offsets, dan `reason`. Path GET milik karyawan tidak ada. Body server memakai `deny_unknown_fields`, sehingga format lama juga ditolak. Wrapper fallback membuat contoh lokal; koreksi tidak tersimpan di server. Lihat [api.ts](../frontend-employee/src/lib/hr/api.ts#L391), [mod.rs](../backend/src/cloud/http/mod.rs#L1677), [punch.rs](../backend/src/cloud/http/punch.rs#L651).

### P1 untuk rilis pengganti — Payroll `frontend-hub-2` tidak lolos typecheck

Screen payroll membaca `verified_by`, yang sudah diganti backend/contract dengan `submitted_by` dan `approved_by`. TypeScript memberi empat error di `modules/people/payroll.tsx`; ini memblokir build/typecheck hub baru. Lihat [payroll.tsx](../frontend-hub-2/src/modules/people/payroll.tsx#L155) dan [PayrollRunView.ts](../frontend-contract/src/contract/PayrollRunView.ts#L25).

### P2 — Hub baru menyembunyikan fungsi People yang sudah tersedia

`frontend-hub-2` menampilkan placeholder untuk `/people/attendance`, `/people/corrections`, dan `/people/claims`. Keterangan placeholder juga menyatakan backend tidak punya sumber punch atau klaim. Namun backend memiliki route terminal/punch/correction dan expense-claim, sementara `frontend-hub` lama memiliki layar People terkait. README menyatakan hub lama tetap berjalan sampai penggantian dilakukan per layar. Jadi kondisi saat ini adalah gap porting dan teks yang kadaluarsa, bukan fitur backend yang belum dibuat. Lihat [README.md](../frontend-hub-2/README.md#L1), [nav.tsx](../frontend-hub-2/src/modules/people/nav.tsx#L211), serta route [mod.rs](../backend/src/cloud/http/mod.rs#L1597) dan [mod.rs](../backend/src/cloud/http/mod.rs#L1841).

### P2 — Kebijakan cuti dan sejumlah operasi payroll hanya dapat diakses lewat API

People UI bisa membaca dan mendefinisikan jenis cuti, tetapi tidak memanggil POST `/leave-policy` untuk memasang versi kebijakan, atau POST `/employees/{id}/leave-balances` untuk alokasi/koreksi ledger. Payroll UI tidak memakai `/payroll/components`, `/rates`, atau `/adjustments`; endpoint pensiun komponen juga tidak memiliki UI. Operasi-operasi ini ada di backend, tetapi HR tidak dapat menyelesaikan setup dan pemeliharaan dari antarmuka People. Lihat [leave-types.tsx](../frontend-hub/src/screens/people/leave-types.tsx#L79), [queries people.ts](../frontend-hub/src/lib/queries/people.ts#L782), [leave.rs](../backend/src/cloud/http/leave.rs#L709), [mod.rs](../backend/src/cloud/http/mod.rs#L1752).

### P2 — Tidak ada scheduler HR otomatis di backend lokal

`cloud.rs` memulai worker auth, katalog, ageing, Finance, sale-day, template bill, integrity, dan sync; tidak ada worker attendance, leave, payroll, atau employee-reminder. Backend menyediakan query kontrak segera berakhir dan route manual untuk menerbitkan employee-book ke terminal, tetapi tidak ada job untuk mengirim pengingat kontrak, memproses auto-attendance/auto-shift, mengirim roster terjadwal, menambah accrual bulanan, menghabiskan alokasi cuti kedaluwarsa, atau menghasilkan encashment. Bandingkan [cloud.rs](../backend/src/bin/cloud.rs#L51) dan catatan manual pada [terminal.rs](../backend/src/cloud/http/terminal.rs#L420).

Frappe HRMS memasang scheduler `all`, `hourly`, `hourly_long`, `daily`, `daily_long`, `weekly`, dan `monthly`; job-nya mencakup auto-attendance dan auto-shift, birthday/anniversary reminders, expired leave allocation, leave encashment, dan earned-leave allocation. Ini selisih operasi yang nyata, bukan perbedaan UI.

### P2 — Payroll tidak menghasilkan pajak/potongan statutory Indonesia

Payroll lokal mendukung komponen earning/deduction dan penyesuaian manual; hasil deduction/net bisa kosong bila potongan tidak dinilai. Tetapi PPh 21 dan BPJS tidak dihitung otomatis. Frappe HRMS menawarkan salary structures, income-tax slabs, salary slips dan payroll tambahan/off-cycle. Karena itu hasil gross lokal tidak setara slip bersih siap bayar/pelaporan. Lihat [pay.rs](../backend/src/cloud/postgres/pay.rs#L555) dan penjelasan di [payroll.tsx](../frontend-hub/src/screens/people/payroll.tsx#L69). Jangan menafsirkan kolom deduction/net nullable sebagai angka nol.

### P2 — Satu test settlement payroll belum mengikuti kontrol Finance yang sekarang

Settlement backend menolak status PAID sampai accrual journal payroll disubmit Finance. Test `an_approved_run_crosses_to_finance_once_and_answers_back` langsung melakukan settlement setelah handover dan mendapat 409. Alur produk mensyaratkan Finance menyubmit draft jurnal dahulu, jadi test belum memodelkan langkah itu. Lihat [pay.rs](../backend/src/cloud/postgres/pay.rs#L1227) dan [payroll_integration.rs](../backend/tests/payroll_integration.rs#L1352).

### P3 — Cakupan integration test untuk beberapa modul HR belum ada

Ada target khusus employment, leave, overtime, roster, punch, attendance policy, payroll, payroll components, dan hire proposal. Tidak ditemukan target integration khusus untuk expense claims, grievances, atau exits/full-and-final. Bug payload klaim tidak terdeteksi suite. Tambahkan cakupan route/body dan koneksi Finance bila modul ini akan dirilis.

## Inventaris fungsi dan input utama

Sebagian besar request body Rust memakai tanggal/nilai bertipe dan `deny_unknown_fields`; tindakan penting membawa `reason`. Pengecualian konkret yang terdeteksi ada pada wire contract klaim dan koreksi karyawan di atas.

| Bagian | Fungsi yang ada | Input utama yang diterima |
|---|---|---|
| Employee lifecycle | Daftar/baca karyawan; hire, suspend, reinstate, terminate; koreksi kode; assignment tempat; link/provision/release akun; profil; data pribadi; kontrak; daftar kontrak kedaluwarsa | `employee_code`; transisi + tanggal efektif + alasan; tempat + rentang tanggal + alasan; username/role/password/edge; nama, NIK, tanggal lahir, alamat; perubahan satu field + alasan; PKWT/PKWTT, tanggal mulai/akhir, posisi, grade |
| Cuti dan libur | Jenis cuti, versi kebijakan, request/approval/withdrawal, balance ledger, publish/amend kalender nasional/bersama/regional | kode/nama/backing/maksimum hari/payment/evidence; tanggal berlaku, annual days, accrual, carry-forward + expiry, encashment + approver, protected leave; tipe cuti, from/to, rest days, evidence, alasan; hari libur + tempat regional |
| Jadwal dan kehadiran | Shift, roster per karyawan/hari, close/reopen periode, terminal, enrollment/withdrawal fingerprint, sinkronisasi template, punch node dan aplikasi, hasil attendance turunan, readiness, koreksi/keputusan | jam shift, lintas tengah malam, istirahat; tanggal, jenis jadwal, shift, alasan; terminal dan status; jari, template vendor hex, quality, alasan; origin + punch batch; business date/effect/jam/day offset/reason |
| Overtime | Versi policy batas harian/mingguan; order, persetujuan atau penolakan karyawan, withdrawal | tanggal, jenis hari, menit, alasan; jawaban boolean + alasan; maksimum menit per hari/minggu |
| Payroll dan Finance | Pay agreement; identitas bank/tax; payroll run submit/approve/reopen; slip dan rekonsiliasi; handover dan settlement; catalogue/rate/adjustment komponen | tanggal efektif, base, fixed allowances, alasan; satu field identitas bank + tanggal efektif + alasan; tempat + `YYYY-MM` + alasan; earning/deduction, basis/rate efektif, adjustment karyawan/komponen/nominal/alasan |
| Klaim dan advances | Jenis klaim; filing, submit, withdraw, decide per baris, return, payout; pembacaan advance karyawan | baris tipe/deskripsi/tanggal belanja/nominal; alasan klaim dan alasan submit wajib; persetujuan + sanctioned amount per line + alasan; alasan return/withdraw. Form saat ini belum mengirim dua alasan wajib tersebut. Advances dikelola Finance, People hanya membaca. |
| Grievance dan exit | Jenis grievance, file/investigate/resolve/withdraw; exit interview; full-and-final draft/settlement/cancellation | jenis/subjek/deskripsi/karyawan terkait/cause; catatan investigasi; valid + detail keputusan; stance + summary; tanggal transaksi, final pay, daftar aset dan nilai recovery, alasan pembatalan |

## Koneksi antarsistem dan proses operasional

- **Identitas dan akses:** `/employees/me` di-resolve dari session. Batas baca mengikuti tempat penugasan; data personal memiliki route/izin terpisah dari profil kerja.
- **Terminal absensi:** terminal didaftarkan di HR; fingerprint dienkripsi saat disimpan dan template tidak dikembalikan pada read API. Node memakai `x-sync-key` untuk sinkronisasi template dan ingest punch. Employee-book dikirim dengan aksi manual; komentar route menyebut scheduler belum dibuat.
- **Payroll → Finance:** handover membuat record beserta baris karyawan dan draft jurnal payroll (debit expense, kredit payable) dalam transaksi. Handover idempotent. Finance mesti submit accrual sebelum settlement dapat menjadi PAID.
- **Claims/advances/exits:** advance bersumber dari lane Finance dan dibaca oleh People. Full-and-final mengambil outstanding advance, payable klaim yang disetujui tetapi belum dibayar, final pay, dan asset recovery; settlement memeriksa perubahan sumber dan mem-post jurnal.
- **Aplikasi karyawan:** live untuk profil, pay identity/slips, cuti, overtime, kalender, attendance dan punch; corrections memakai kontrak lama; sesi `/api/v1/me/sessions` tidak punya route backend dan jatuh ke demo stand-in. Tidak ada screen klaim atau grievance di employee app.
- **Laporan HR:** UI menyediakan workforce, attendance/absence dan cost report; angka mengikuti reach pemanggil. Report tidak menggantikan workflow input setup yang belum ada.

## Perbandingan dengan Frappe HRMS (fitur yang diminta saja)

| Area | Lokal | Frappe HRMS | Hasil |
|---|---|---|---|
| Employee lifecycle | Employee/event history, penempatan, jenis kontrak, login dan data pribadi terpisah; ada grievance dan F&F yang terkoneksi ledger | Siklus karyawan termasuk onboarding, transfer/promosi, exit interview; modul HRMS lebih luas | Lokal kuat di event/audit dan koneksi retail; onboarding/struktur jabatan dan layanan pegawai lebih tipis |
| Leave | Jenis, kebijakan berversi, balance dari ledger, request dan kalender regional per tempat; alokasi/correction perlu endpoint langsung | Leave policies, regional holiday import, allocation/expiry/earned leave dan encashment dengan scheduler | Perhitungan lokal ada, tetapi administrasi serta accrual/expiry belum otomatis |
| Attendance/shift | Roster manual, policy, biometric terminal/node sync, employee punch, derivasi harian, correction dan close period | Check-in/out dengan geolocation, auto-attendance dan auto-shift terjadwal, laporan | Model lokal tersambung ke node terminal dan workforce berbasis tempat; tidak ada geolocation dan otomasi terjadwal |
| Payroll/tax | Base + allowance, komponen/rate, overtime dan one-off, workflow submit/approve, ledger handover ke Finance | Salary structures, tax slabs, payroll/taxation, additional/off-cycle pay dan income breakup | Lokal punya jejak Finance yang eksplisit, tetapi belum menghitung PPh 21/BPJS |
| Expense claims/advances | Workflow tipe, klaim, keputusan per baris, payout; advances terbaca dari Finance | Klaim/advances, multi-level approvals dan ERPNext accounting | Kemampuan backend lokal ada, tetapi form klaim saat ini rusak; UI employee self-service dan multilevel setara perlu ditutup |
| Scheduler | Tidak ada scheduler HR | Reminder, auto-attendance/shift, alokasi/accrual cuti, expiry dan encashment terjadwal | Gap paling jelas pada operasi rutin |

Frappe README menyebut lifecycle, leave/attendance, expenses/advances, payroll/taxation, dan mobile app. Daftar job scheduler di `hrms/hooks.py` mencakup task HR berkala seperti yang dirangkum di atas. [README Frappe HRMS](https://github.com/frappe/hrms/blob/develop/README.md) · [scheduler_events](https://github.com/frappe/hrms/blob/aa1ec5a249075773f904b1c416e6a739140c830c/hrms/hooks.py#L256-L284)

## Hasil pemeriksaan yang dijalankan

- Backend integration targets: attendance policy **5/5 lulus**; leave **10/10 lulus**; overtime **7/7 lulus**; payroll components **5/5 lulus**; punch **4/4 lulus**; roster **6/6 lulus**. Employment **11/12** dan hire proposal (fitur rekrutmen yang dikecualikan) **4/5**; kedua kegagalan mengharapkan `place_name = C001`, sementara fixture/API memberi nama tampilan `Store 01` (indikasi ekspektasi test usang). Payroll **8/9**; kegagalan settlement diuraikan di temuan P2.
- App karyawan: `npm run typecheck` dan `npm run lint` lulus setelah dependensi dikunci dari `package-lock.json`.
- Hub lama: `npm run typecheck` gagal pada error UI umum/Finance/master/operations; tidak ada error file People di output. Endpoint audit menghasilkan **272/307** path; dua path People yang tidak dipanggil browser ialah punch ingest node-to-server (sesuai boundary) dan retirement komponen payroll (belum ada UI). Audit script membandingkan path, bukan bentuk/method payload.
- Hub baru: `npm run check` berhenti pada typecheck. Selain mismatch Payroll `verified_by`, ada error common mutation dan file Procurement hilang; lint/design-lint/stack-lint/test tidak berjalan setelah typecheck gagal.
- Cargo menampilkan warning ambiguitas glob re-export dan catch-all unreachable pada error mapping exit/grievance. Tidak ada migration atau file sumber yang diubah oleh proses audit.
