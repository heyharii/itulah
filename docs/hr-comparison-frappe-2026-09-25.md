# Perbandingan Frappe HRMS dengan backend dan `frontend-hub` HR

**Tanggal audit:** 25 September 2026  
**Frappe HRMS:** `develop` pada commit `aa1ec5a249075773f904b1c416e6a739140c830c` (23 September 2026)  
**Pembanding lokal:** working tree `/Users/hari/Documents/itulah` pada saat audit

## Ruang lingkup

Perbandingan ini membaca implementasi, bukan hanya README. Untuk Frappe, checkout sumber dikunci pada commit di atas dan mencakup modul native, object yang diwarisi dari Frappe/ERPNext, scheduler, PWA, dan integrasi akuntansi. Untuk sistem lokal, pemeriksaan mencakup:

- domain, HTTP, PostgreSQL, migration, dan test di `backend/`;
- 16 screen People beserta query/mutasi di `frontend-hub/`;
- `frontend-employee` hanya pada batas integrasi yang relevan bagi self-service.

Hasil ini membandingkan kemampuan yang benar-benar ada. Fitur yang hanya disebut README, mengandalkan app lain, atau belum mempunyai alur end-to-end tidak dihitung sebagai parity.

## Kesimpulan eksekutif

Sistem lokal **bukan hasil clone Frappe HRMS**. Ia adalah kernel HR operasional yang lebih fokus, dengan aturan lokal yang lebih kuat pada beberapa titik:

- effective-dated employment, pay, contract, assignment, leave, holiday, dan policy;
- pembatasan akses berdasarkan `Reach` per tempat;
- pemisahan profil kerja dari data pribadi;
- pemisahan instruksi lembur dan persetujuan pekerja;
- pemisahan submitter dan approver payroll;
- template biometrik terenkripsi dan tidak pernah dikembalikan ke browser;
- handoff payroll dan settlement yang selalu melewati Finance.

Sebaliknya, Frappe jauh lebih luas sebagai produk: ia memiliki recruitment pipeline, onboarding/separation, organisasi dan staffing plan, training, performance, geofencing, auto-attendance/auto-shift, leave accrual/expiry/encashment, salary structure, tax engine, benefits, gratuity, employee self-service yang lebih lengkap, banyak report, dan scheduler otomatis.

Perbedaan paling penting bukan sekadar features, melainkan **operational completeness**. Lokal belum memiliki scheduler HR, dan beberapa alur yang sudah ada belum aman atau benar untuk produksi. Klaim dari hub, payroll adjustment, koreksi absensi, dan F&F mempunyai blocker nyata. Jadi status yang jujur adalah:

> **Fondasi dan beberapa domain inti sudah kuat; cakupan produk masih di belakang Frappe, dan correctness blockers prevent belum boleh dianggap production-ready.**

## Peta parity

| Area | Frappe HRMS | Backend lokal | `frontend-hub` | Penilaian |
|---|---|---|---|---|
| Employee master dan lifecycle | Employee, transfer, promotion, work history, user/approver links | Register, status append-only, assignment, contract PKWT/PKWTT, account, personal-data amendments, expiring-contract query | Directory dan drawer employee | **Sebagian; lokal kuat di audit/reach, tipis di workflow transfer/promotion/onboarding** |
| Struktur organisasi | Company, Department, Designation, Branch, reports-to, Employee Grade, organizational chart | `org_place`; position/grade masih free text; tidak ada hierarchy/cost center HR | Directory menampilkan unit, bukan org design | **Belum parity** |
| Workforce planning | Staffing Plan, vacancy, estimated cost, Job Requisition | Tidak ada headcount plan/vacancy budget | Tidak ada | **Belum ada** |
| Recruitment | Job Opening, public application, Applicant, Interview/Feedback, Job Offer, Appointment Letter | Hanya `hire-proposal` internal; bukan ATS, CV, interview, atau offer pipeline | New Employees | **Sengaja lebih sempit; besar bila ATS dibutuhkan** |
| Onboarding/separation | Checklist/Project/Task-based onboarding dan separation; mandatory tasks dapat menahan pembuatan employee | Candidate → manual contract/assignment/profile/account; exit interview dan F&F; tidak ada checklist | New Employees, Exits | **Sebagian; lifecycle steps belum orchestrated** |
| Training | Program, Event, participant, result, feedback, skill map | Tidak ditemukan modul training | Tidak ada | **Belum ada** |
| Performance | Goal, KRA, appraisal cycle, appraisal, self/peer feedback | Tidak ada; `performance.rs` adalah commercial campaign performance | Tidak ada | **Belum ada** |
| Leave | Type, policy, assignment, allocation, ledger, control panel, block list, encashment, compensatory leave | Type, effective-dated policy, ledger, request/decision, balance, national/regional/shared holiday | Leave Types dan Requests | **Core cukup dekat, tetapi setup dan automation belum** |
| Leave operations | Earned/accrual, expiry, encashment, payroll/attendance side effects, bulk allocation | Policy dan ledger bisa menghitung; allocation/expiry/encashment belum menjadi worker | Hanya read policy; belum ada policy install/balance movement | **Parsial** |
| Attendance/shift | Check-in/out, geolocation + geofence, auto-attendance, recurring/auto shift, overtime slip, WFH/on-duty | Roster manual, shift, period close, fingerprint terminal, employee-app punch, correction | Attendance Days, Roster, Periods, terminals | **Lebih kuat di node/provenance, kurang di automation** |
| Attendance correctness | Attendance dan approval dikaitkan oleh controller | `DayApprovals::none()` masih dipakai; cuti approved dan overtime agreed belum masuk derivasi | Screen menampilkan hasil, tetapi readiness masih terminal-only | **Gap correctness/operational** |
| Overtime | Attendance-derived dan manual overtime slip; policy/configuration | Order oleh employer + consent worker + daily/weekly caps; withdrawal sebelum answered | Overtime queue/order; policy ratification dan history UI belum | **Model consent lokal baik, enforcement belum lengkap** |
| Payroll | Salary structure/assignment, component formulas, earnings/deduction/contribution, additional/off-cycle, slip, bank entry, withholding | Pay agreement, component/rate shapes, one-off, run, slip, Finance handover | Payroll Runs, Pay Agreements, adjustment UI | **Ada core, belum equivalent dan ada blocker** |
| Payroll execution | Multi-frequency, background queue, error state, cost center, employer contribution | Monthly run, submit/place → approve/HO, explicit Finance crossing | Submit/approve/reopen/handover | **Good workflow shape, belum payroll-complete** |
| Tax/statutory | Generic income-tax slab dan regional India hooks | NPWP/PTKP/BPJS identity fields; tidak ada PPh 21 engine | Menampilkan identitas, tidak menghitung statutory | **Kedua sistem belum turnkey untuk Indonesia** |
| Expense claims | Expense Claim, taxes/charges, multi-level workflow, ERPNext integration | Type, filing, submission, return, per-line sanction, payout | Claims | **Backend cukup dekat; hub payload rusak** |
| Advances/recovery | Employee Advance, claim/payment/return/payroll recovery | Finance advance read; payroll adjustment dapat recover; F&F reads outstanding | Directory/claim/payroll reads | **Parsial; source closure dan decoding punya gap** |
| Benefits/gratuity | Gratuity rules, flexible benefits, benefit application/claim/ledger | Tidak ada benefit engine/gratuity; BPJS baru field identity | Tidak ada | **Belum ada** |
| Grievance | Employee Grievance dan type | Confidential queue, file/investigate/resolve/withdraw dengan actor checks | Grievances | **Salah satu yang paling dekat** |
| Exit/F&F | Aggregate salary, gratuity, claims, advances, optional loans, assets; GL settlement | Exit interview + F&F untuk claims/advances/assets/final pay | Exits | **Mirip di permukaan, belum closing end-to-end** |
| Employee self-service | PWA leave, check-in, profile, claims, advances, slips, tax, training, grievance, travel | `frontend-employee` punya profile, leave, overtime, attendance, correction, payslip; tidak ada claims/grievance | Bukan screen hub; boundary ke employee app | **Core self-service ada, cakupannya lebih kecil** |
| Approval/workflow | Frappe Workflow, docstatus, user permissions, approver assignments | Custom action keys, 3-role ladder, `Reach`, explicit state machine | Menu visibility + server enforcement | **Local lebih typed; permission grant belum independen** |
| Reports | 28 report definitions plus dashboards/charts | Tiga report UI dan beberapa operational reads; tidak ada HR report catalogue | Workforce, Time & absence, Payroll cost | **Jauh lebih tipis** |
| Scheduler | Auto attendance/shift, leave expiry/encashment/earned leave, reminders, interview reminders | Sudah ada worker HR (`0363`, `bin/cloud.rs`): akrual cuti, expiry carry-forward, roster minggu depan, nudges kontrak/periode/roster. Belum ada auto-attendance/auto-shift. | Scheduler screen di People · Setup | **Core scheduler selesai; auto attendance/shift masih gap** |
| Employee privacy | Frappe permissions/track changes; PII storage mengikuti framework | NIK/pay identity dipisah di API; bank masked; biometric encrypted; PII biasa belum field-encrypted | Tidak meminta NIK di directory | **Kekuatan lokal, tetap ada route/scope leaks** |

## Apa yang sudah kuat di backend lokal

### 1. Sejarah dan aturan lebih tegas

Employee, profile amendments, contracts, assignments, leave, holiday amendments, payroll run, grievance, dan F&F memakai append-only state/history. Perubahan penting umumnya menyimpan actor, alasan, waktu, dan effective date. Ini lebih mudah dijelaskan daripada sekadar mengubah kolom.

### 2. `Reach` dan ownership

`Reach` membatasi unit tempat pada banyak handler; `me` resolve dari session; `personal-data` dan `payroll-identity` dipisahkan dari employment profile. Ini mencegah satu layar admin dari otomatis memperoleh NIK atau rekening.

### 3. Consent dan maker/checker

Overtime memiliki order dan worker consent terpisah; payroll memiliki submitter dan approver yang harus berbeda; claim memakai actor yang berbeda dari filer untuk sanction. Beberapa aturan tersebut lebih eksplisit daripada workflow status umum.

### 4. Biometrik dan sync boundary

Fingerprint template dienkripsi di storage, dikirim melalui node-authenticated sync, tidak memiliki serialisasi browser, dan dihapus saat employment terminated. Ini boundary yang jelas antara hardware/node dan aplikasi.

### 5. Finance crossing

Payroll handover menyimpan gross liability dan breakdown; F&F serta claim memiliki posting yang memakai Finance poster. Sistem lokal tidak menyamarkan payroll sebagai “selesai” hanya karena slip sudah dibuat.

## Blocker sebelum rilis

### B-01 — Expense claim dari hub tidak dapat dibuat/dikirim

Backend mewajibkan `reason` saat file dan submit:

- `backend/src/cloud/http/claims.rs:154-165`;
- `backend/src/cloud/http/claims.rs:386-404`.

`fileClaim()` hanya mengirim `employee_id` dan `lines`; `submitClaim()` mengirim `{}`:

- `frontend-hub/src/lib/queries/people.ts:2071-2093`.

Form juga tidak meminta alasan (`frontend-hub/src/screens/people/claims.tsx:417-541`). Akibatnya jalur “File and send it” berhenti di server.

### B-02 — Payroll dapat menghitung population/facts yang salah

`build_slips()` memilih karyawan aktif yang assignment-nya masih terbuka pada saat run dibuat, bukan intersect history dan payroll period:

- `backend/src/cloud/postgres/pay.rs:569-577`.

Pay agreement selalu diambil dari hari pertama, tanpa segmentasi perubahan midstage-month; leave, overtime, dan roster juga tidak selalu dipotong/dibatasi oleh place dan period secara ketat:

- `backend/src/cloud/postgres/pay.rs:583-632`.

Akibatnya transfer/termination,jumlah hari cuti overlap, dan perubahan gaji di tengah bulan dapat menghasilkan slip yang bukan representasi bulan itu.

### B-03 — Slip draft tidak dibangun ulang

`build_slips()` dipanggil ketika run dibuka saja (`backend/src/cloud/postgres/pay.rs:693-726`). Adjustment masih dapat ditambah/di-withdraw saat draft dan reopen tidak membangun ulang slip (`backend/src/cloud/http/components.rs:516-578`; `backend/src/cloud/postgres/pay.rs:776-798`).

Reconciliation memang menghitung `unpayable`, komponen incomplete, dan negative net (`backend/src/cloud/postgres/pay.rs:969-1072`), tetapi approval tidak membaca hasil itu; `PayrollRun::approve` hanya memeriksa authority, actor berbeda, dan state (`backend/src/cloud/domain/pay/run.rs:369-391`).

### B-04 — Adjustment hub mengalikan nominal dengan 100

Backend dan schema memakai rupiah penuh sebagai integer minor unit. Form nevertheless mengubah input `300000` menjadi `30000000`:

- `frontend-hub/src/screens/people/payroll.tsx:645-658`;
- `backend/migrations/postgres/0105_a_salary_is_a_history_not_a_number.sql:29-35`.

Adjustment juga tidak memverifikasi bahwa employee yang dipilih benar-benar diposting di place yang dipilih; handler hanya memeriksa caller dapat mencapai `body.place_id` (`backend/src/cloud/http/components.rs:527-568`).

### B-05 — F&F belum menutup source obligations

`settle_full_and_final()` membandingkan totals dan mem-post satu journal, tetapi tidak mengubah `expense_claim` menjadi paid/settled, tidak menutup advance outstanding, dan tidak menandai asset recovery sebagai selesai:

- `backend/src/cloud/postgres/exit.rs:666-760`.

Klaim approved masih dapat dipayout dan asset dapat masuk F&F lain. Selain itu `load_full_and_final()` mengirim `assets: Vec::new()` ke domain fold (`backend/src/cloud/postgres/exit.rs:594-611`), sementara domain menolak recovery total yang tidak sama dengan jumlah rows (`backend/src/cloud/domain/exit.rs:621-631`); F&F dengan asset nonzero dapat gagal saat read-back.

UI juga mengatakan final pay kosong akan diambil dari run terakhir, tetapi backend memakai `unwrap_or(0)` (`frontend-hub/src/screens/people/exits.tsx:639-648`; `backend/src/cloud/http/exit.rs:282-344`).

### B-06 — Scope/privacy belum menutup semua generic surface

`/api/v1/records/{kind}/{id}/info` dan mutasi komentar/tag_map membaca lewat daftar generic, tetapi handler tidak resolve object, check `Reach`, atau check existence (`backend/src/cloud/http/records.rs:64-156`; `backend/src/cloud/domain/record.rs:455-458`). Employee, leave, overtime, attendance period, dan payroll run dapat melewati batas tempat melalui generic record surface. Global audit juga route-nya `GET` dengan default role Cashier dan tidak melakukan HR scope check (`backend/src/cloud/http/mod.rs:1220`; `backend/src/cloud/http/audit.rs`).

### B-07 — Attendance, leave, dan overtime belum saling lock

- Attendance derivation masih `DayApprovals::none()` (`backend/src/cloud/http/punch.rs:285-300`).
- Leave mempercayai `rest_days` dari caller dan tidak melakukan overlap/closed-period validation (`backend/src/cloud/http/leave.rs:181-188`; domain leave request).
- Overtime policy checked saat issue, tetapi belum menjadi aggregate hard gate pada consent; sequential orders dapat melewati cap (`backend/src/cloud/http/overtime.rs:311-348`, `359-402`).
- Period readiness hanya dijadikan angka bila ada terminal, walaupun employee-app punch sudah menjadi source (`backend/src/cloud/postgres/roster.rs:309-320`).

Ini membuat fakta yang sudah disetujui tidak selalu masuk payroll/attendance, dan manager dapat membuat workflow yang tidak dapat diselesaikan.

### B-08 — Termination belum atomik dengan access closure

Status transition committed lebih dulu; account/Fingerprint closure dilakukan sesudahnya dan kegagalan setelahnya memungkinkan state `TERMINATED` dengan credential masih aktif (`backend/src/cloud/http/employment.rs:821-852`, `861-907`). Termination juga tidak menutup assignment secara eksplisit.

## Gap backend vs Frappe

### Prioritas tinggi untuk parity operasional

1. **HR scheduler/worker**: sudah ada untuk leave accrual/expiry, roster carry, contract/period/roster nudges. Yang belum: auto attendance/shift generation, leave encashment, employee-book dispatch, daily work summary.
2. **Payroll snapshot/rebuild**: period-and-place effective facts, immutable snapshot/version, transactional rebuild, hard approval gates, source version/staleness.
3. **Finance payment evidence**: handover harus terikat pada canonical amount/hash dan actual disbursement, bukan hanya journal draft yang dapat diedit.
4. **Workflow controls**: independent grants atau actor inequality untuk leave, overtime, claim, grievance, payroll, F&F, and period close/reopen.
5. **Employee self-service**: claim filing/status, grievance filing/status, tax/benefit/training, attachment/evidence, payslip net breakdown.
6. **Leave/attendance automation**: server-authoritative rest days, overlap prevention, auto-shift, geofence option, daily work summaries.

### cakupan produk yang belum ada

- recruitment pipeline dan public careers;
- onboarding/separation checklist;
- training dan skills;
- goals/appraisal/feedback;
- organization hierarchy, staffing plan, grades/departments;
- benefits, gratuity, leave encashment workflow;
- auto-attendance dan auto-shift (scheduler-nya ada; generator jadwal dan processing punch belum);
- comprehensive HR reports and export.

Frappe memiliki loan payroll integration, tetapi modul native-nya berasal dari app `lending`; jangan menghitungnya sebagai HRMS core.

### Indonesia-specific gap

Tidak ditemukan native PPh 21, BPJS payroll engine, THR, JHT/JKK/JKM, atau Indonesian statutory filing di commit Frappe yang diaudit. Regional override yang didokumentasikan adalah India (`hrms/hooks.py:315-320`). Sistem lokal juga belum menghitung statutory; NPWP/PTKP/BPJS fields are identities, bukan calculations.

Ini berarti menyalin Frappe tidak menyelesaikan target Indonesia. Perlu regional payroll adapter yang eksplisit, dengan aturan dan sumber resmi yang disetujui accountant/legal owner.

## Hasil audit `frontend-hub`

### Yang sudah ada

`frontend-hub/src/screens/people/index.ts` mendaftarkan 16 screen: Overview, Directory, New Employees, Requests, Claims, Grievances, Exits, Overtime, Roster, Attendance Days, Period Close, Pay, Payroll, Reports, Time Policy, dan Terminals.

UI sudah memakai query wrappers dan audience/reach; menu bukan security boundary. Beberapa layar punya design yang baik: explicit empty/error states, source/provenance copy, and separation between plan, actual, and settlement.

### UI/backend mismatch dan gap

- **Claims P1**: reason tidak ada; file/submit payload rusak.
- **Correction workflow**: Requests hanya menampilkan banner/count; tidak ada decision UI yang lengkap; queue read juga perlu dipisahkan dari employee own queue.
- **Setup**: leave policy install dan balance movement tidak tersedia di hub; overtime policy ratification tidak tersedia; payroll component/rate management belum tersedia.
- **Pay agreement**: form selalu mengirim `allowances: []`; fixed allowance tidak dapat dikelola dari UI (`frontend-hub/src/screens/people/pay.tsx:168-182`).
- **Bounded manager**: `usePlaces()` bergantung pada `facets.places`, yang sengaja kosong untuk caller satu tempat. Open run, one-off, dan reports karena itu bisa tidak memiliki unit default (`frontend-hub/src/lib/queries/people.ts:589-601`; payroll/report callers).
- **Payroll copy**: comment masih mengatakan “No net, anywhere”, sementara backend sekarang memiliki earnings, deductions, gross, nullable deduction/net (`frontend-hub/src/screens/people/payroll.tsx:75-79`). Copy harus membedakan “belum terkonfigurasi” dari “tidak ada”.
- **Reports**: hanya tiga laporan browser-side; bounded workforce report bisa kosong, time report hanya satu unit, dan belum ada server-side export/report artifact.
- **F&F**: final pay blank dan asset recovery belum aman.
- **Policy form**: `NewVersion` menginisialisasi default saat `current` masih null; tidak ada reset terhadap current policy ketika query selesai.
- **Date defaults**: beberapa form memakai `toISOString()` dan dapat bergeser satu hari/bulan pada boundary WIB.

## Hasil pemeriksaan yang dijalankan

- `git ls-remote https://github.com/frappe/hrms.git`: commit `develop` yang diaudit `aa1ec5a249075773f904b1c416e6a739140c830c`.
- `npm run typecheck` di `frontend-hub`: 68 error, semuanya drift kontrak GA yang sudah ada; `grep` untuk `scheduler`, `people/index`, dan `people/nav` tidak menemukan error. Build hub belum hijau karena GA, bukan karena People.
- `npm run endpoint-audit`: `274/310` path ditemukan dari `src/`; script keluar non-zero karena path yang belum dipanggil. Di antara HR path yang belum dipanggil ada payroll component retirement dan terminal punch ingest; yang terakhir memang boundary machine-to-server. Audit path tidak membuktikan payload atau method sudah benar.
- `cargo check --bins`: lulus. `cargo test --lib schedule`: 10 lulus.
- `backend/tests/schedule_integration.rs`: lulus saat pertama dijalankan; setelah migration `0365` dari lane GA masuk dengan probe-nya sendiri yang gagal, test ini di-`ignore` dengan alasan itu. Arithmetic murni tetap diuji di `domain::schedule`.
- `cargo test --test migration_hygiene`: dua kegagalan pre-existing (gap `0321–0339` dan `record_kind` yang tidak sinkron dengan lane GA); `no_two_cloud_migrations_claim_the_same_number` lulus setelah `0363`.
- Tidak menjalankan ulang seluruh backend integration suite pada audit ini. Klaim test coverage tetap perlu ditambah untuk claims, grievance, exit/F&F, role/Reach, stale payroll, dan correction workflow.

## Rekomendasi urutan kerja

### R-1 — Containment

1. Nonaktifkan sementara form claim dan adjustment one-off dari UI.
2. Jangan approve payroll tanpa manual reconciliation dan sumber facts yang sudah diaudit.
3. Jangan buat/settle F&F dengan final pay kosong atau asset recovery nonzero.
4. Jangan anggap phone punch sudah termasuk payroll/readiness.

### R-2 — Correctness dan privacy

1. Tambahkan `reason` pada claim file/submit dan test HTTP end-to-end.
2. Rebuild payroll slips secara transaksional pada adjustment/reopen; enforce reconciliation blockers di server.
3. Perbaiki unit adjustment dan employee-place validation.
4. Buat F&F settlement menutup claim, advance, asset, dan source status secara atomik; fix hydration assets.
5. Tutup generic record/audit scope serta self-approval leave/overtime.
6. Gabungkan employee-app punch ke attendance derivation/readiness dan validasi leave/roster facts.

### R-3 — Operational parity

1. Worker HR core sudah ada (`0363`): accrual, expiry, roster carry, nudges. Selanjutnya auto-attendance/auto-shift dan encashment.
2. Tambahkan leave policy, allocation, encashment, dan holiday import.
3. Tutup UI setup: policy, balance, component/rate, identity, future holiday, terminal book.
4. Tambah HR self-service claims/grievance/evidence dan payslip breakdown.

### R-4 — Product breadth

1. Putuskan apakah recruitment, training, performance, benefits, dan gratuity masuk scope.
2. Jika ya, port workflow objects—not merely menus—from Frappe as reference, lalu adapt to local `Reach`, state machine, privacy, and Finance contracts.
3. Jika tidak, dokumentasikan explicit non-goals agar tidak dianggap parity dengan Frappe.

## Perbaikan sesudah audit (25 September 2026)

P0 dan sebagian P1 dari temuan sudah diperbaiki:

- **Claim `reason`**: form hub mengirim alasan pada file dan submit; kedua route
  server yang mewajibkannya sekarang cocok.
- **Adjustment ×100**: UI payroll mengirim rupiah penuh, bukan dikali 100 lagi.
- **F&F final pay kosong**: backend mengambil gross dari approved payroll run
  terakhir; bila tidak ada, request ditolak daripada menjadi nol.
- **Generic record scope**: `Employee`, `LeaveRequest`, `OvertimeOrder`,
  `PayrollRun`, dan `HireProposal` diselesaikan lewat record-nya lalu dibatasi
  `Reach`; comment/tag pada record yang tidak ada ditolak.
- **Global audit**: route `/api/v1/audit` sekarang Admin-only.
- **Payroll rebuild**: slip run `DRAFT` dibangun ulang setelah adjustment
  filed/withdrawn, dan saat reopen.
- **Approval gate**: run dengan `unpayable` atau net negatif ditolak sebelum
  approval.
- **Population/facts**: employee yang posting-nya overlap bulan ini ikut
  dihitung; leave/overtime/roster difilter ke tempat run, dan leave dihitung
  hanya untuk hari di dalam bulan.

Masih terbuka: proration gaji mid-month, F&F yang menutup claim/advance/asset,
termination atomik, leave/attendance/overtime join, benefits/gratuity/encashment,
dan PPh 21/BPJS/THR.

## Kesimpulan satu kalimat

**Frappe HRMS adalah baseline cakupan dan operational reference; backend lokal adalah kernel yang lebih ketat pada invariants tertentu tetapi belum complete atau safe untuk mengakui dirinya sebagai HRMS parity.**
