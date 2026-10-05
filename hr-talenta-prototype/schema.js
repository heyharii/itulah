window.PAGES = [
  {
    "id": "employees-employee-list",
    "group": "Employees",
    "name": "Employee list",
    "columns": [
      "Employee name",
      "Employee ID",
      "NIK",
      "Branch",
      "Organization",
      "Job position",
      "Job level",
      "Employment status",
      "Grade",
      "Class",
      "Join date",
      "End date",
      "Sign date",
      "Resign date",
      "Barcode",
      "Email",
      "Birth date",
      "Birth place",
      "Address",
      "Phone number",
      "Religion",
      "Gender",
      "Marital status"
    ],
    "fields": [
      "Full name!",
      "Email!",
      "Join date",
      "Employment status",
      "Branch",
      "Organization",
      "Job position"
    ],
    "filters": [
      "Status",
      "Employment status",
      "Branch",
      "Organization",
      "Job position",
      "Job level",
      "SBU"
    ],
    "tabs": [
      "Directory",
      "Org chart"
    ],
    "action": "Add employee",
    "notes": "### Employee list",
    "verified": true
  },
  {
    "id": "employees-employee-transfer",
    "group": "Employees",
    "name": "Employee transfer",
    "columns": [
      "Transaction ID",
      "Employee name",
      "Employee ID",
      "Transfer type",
      "Created date",
      "Effective date",
      "Status",
      "Attachment"
    ],
    "fields": [
      "Employees!",
      "Effective date!",
      "Transfer type!",
      "Group structure",
      "Employment status",
      "Branch",
      "Organization",
      "Job position",
      "Job level",
      "Grade",
      "Class",
      "Cost Center",
      "Cost Center Category",
      "Approval line",
      "Manager",
      "Custom field",
      "Field option",
      "SBU Group",
      "SBU",
      "Attachment",
      "Document template",
      "Reason",
      "Email manager?",
      "Email employee?"
    ],
    "filters": [
      "Status",
      "Effective date",
      "Transfer type",
      "Branch from",
      "Branch to",
      "Organization from",
      "Organization to",
      "Job position from",
      "Job position to",
      "Job level from",
      "Job level to",
      "Employment status from",
      "Employment status to",
      "SBU from",
      "SBU to"
    ],
    "tabs": [],
    "action": "Create transfer",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "employees-mass-resignation",
    "group": "Employees",
    "name": "Mass resignation",
    "columns": [
      "Employee name",
      "Resign date",
      "Resign reason",
      "Merit pay",
      "Severance",
      "Compensation pay",
      "Timeoff balance",
      "Amount per day",
      "Timeoff compensation",
      "Payroll period",
      "New approval line",
      "Document template",
      "Enable offboarding",
      "Restrict employee",
      "Notes",
      "Assets",
      "Loan"
    ],
    "fields": [
      "Employees!",
      "Resign date!",
      "Resign reason!",
      "Payroll period",
      "Enable offboarding?",
      "Restrict employee?",
      "Notes"
    ],
    "filters": [],
    "tabs": [],
    "action": "Select employee",
    "notes": "Halaman **Mass resignation** menampilkan Select employee, Import, Batch fill (nonaktif), input, tabel pengaturan resign (Resign date, Resign reason, Merit pay, Severance, Compensation pay, Timeoff balance, Amount per day, Timeoff compensation, Payroll period, New approval line, Document template, Enable offboarding, Restrict employee, Notes, Assets, Loan), serta Cancel/Submit. Tidak ada karyawan yang dipilih; Submit nonaktif.",
    "verified": true
  },
  {
    "id": "employees-import-export-prorate",
    "group": "Employees",
    "name": "Import/export prorate",
    "columns": [
      "Employee ID",
      "Employee name"
    ],
    "fields": [
      "Employees!",
      "Select all employees?",
      "Attachment!"
    ],
    "filters": [],
    "tabs": [],
    "action": "Import prorate",
    "notes": "Halaman **Import/export prorate** meminta pemilihan karyawan, menyediakan Select all employees, template spreadsheet, upload, Submit (nonaktif sebelum file diunggah), dan Cancel.",
    "verified": true
  },
  {
    "id": "employees-ptkp-status-adjustment",
    "group": "Employees",
    "name": "PTKP status adjustment",
    "columns": [
      "Period",
      "Employee Adjusted"
    ],
    "fields": [
      "Period!",
      "Employees!",
      "Current PTKP Status",
      "New PTKP Status",
      "Attachment"
    ],
    "filters": [],
    "tabs": [],
    "action": "Create adjustment",
    "notes": "Halaman **PTKP status adjustment** menampilkan tabel Period dan Employee Adjusted. Form Create adjustment menyediakan Period, Add, Choose Files, Import, Export, pencarian karyawan, tabel Emp ID, Full Name, Job Position, Current PTKP Status, New PTKP Status, dan Submit (nonaktif tanpa karyawan). Form dibatalkan tanpa submit.",
    "verified": true
  },
  {
    "id": "employees-manpower-planning",
    "group": "Employees",
    "name": "Manpower planning",
    "columns": [
      "Job position",
      "Employment status",
      "Period",
      "Status"
    ],
    "fields": [
      "Period!",
      "Notes",
      "Job position!",
      "Employment status!"
    ],
    "filters": [
      "Period",
      "Status",
      "Job position"
    ],
    "tabs": [
      "Overview",
      "Planning history",
      "Requisition"
    ],
    "action": "Manage planning",
    "notes": "### Manpower planning",
    "verified": true
  },
  {
    "id": "employees-new-joiner-submission",
    "group": "Employees",
    "name": "New joiner submission",
    "columns": [
      "Submission ID",
      "Delivery date",
      "Expiry date",
      "Email",
      "Status",
      "Sent by"
    ],
    "fields": [
      "Employee name!",
      "Email!",
      "Phone number",
      "Additional phone number",
      "Place of birth",
      "Birthdate",
      "Gender",
      "Marital status",
      "Blood type",
      "Religion",
      "NIK",
      "Passport number",
      "Passport expiry date",
      "Postal code",
      "Citizen ID address",
      "Residential address",
      "Bank name",
      "Account number",
      "Account holder name",
      "PTKP status",
      "Formal education",
      "Informal education",
      "Work experience",
      "Additional document"
    ],
    "filters": [
      "Status"
    ],
    "tabs": [],
    "action": "Send form link",
    "notes": "### New joiner submission",
    "verified": true
  },
  {
    "id": "employees-onboarding",
    "group": "Employees",
    "name": "Onboarding",
    "columns": [
      "Employee name",
      "Job position",
      "Status"
    ],
    "fields": [
      "Name",
      "Job position",
      "Work location",
      "Instruction"
    ],
    "filters": [
      "Month",
      "Year"
    ],
    "tabs": [
      "On Progress",
      "Completed"
    ],
    "action": "",
    "notes": "### Onboarding, Offboarding, Reprimand\n\n- **Onboarding:** tab On Progress/Completed, filter Select Month Period dan Select Year Period, serta kontrol jumlah baris; tidak ada karyawan menunggu.\n- **Offboarding:** kolom Employee name, Resign Date, Status, Last updated, Task progress; Filter, pencarian, Settings, Guidebook. Tabel kosong.\n- **Reprimand:** aksi View report, Create (Reprimand/Reprimand type), Filter, Guidebook, Import, search, pagination. Filter: Assigned to, Status, Reprimand type, Organization, Period. Form reprimand: Assign to/Select employee, Reprimand type, Effective date, End date, Notes, Watchers, Attachment, Document template (optional), Cancel/Create. Form kosong dibatalkan.\n\n- **Assets list:** filter kategori, kontrol kolom, export, clipboard/report control, Search asset/employee, Import assets, Add asset; KPI Total/Assigned/Unassigned assets; kolom Asset name, Category name, Asset number, Assigned employee, Last modified. Kosong. Form Add asset: Asset name dan Asset number (maks.60), Description (maks.200), Asset category wajib/Create asset category, Attachment (PDF/JPG/PNG/JPEG/DOCX/DOC/ZIP maks.10 MB), Purchase date/price, opsi Assign asset to employee dengan Employee dan Assigned date. Draft dibatalkan.\n- **Assigned assets:** Import, Assign asset, filter kategori, export, search; tabel Asset name, Assigned employee, Asset category, Asset number, Assigned date. Kosong.\n- **Asset category:** Import, Add category, export, Search; tabel Asset category, Total asset, Total assigned asset, Total unassigned asset. Kosong. Add category meminta Category name; modal dibatalkan.\n- **Announcements:** filter kategori, Search, Help, Create announcement; daftar kosong. Form meminta title, rich-text body, publish ke semua karyawan atau berdasarkan criteria, Category, Forms, Attachment (format office/PDF/gambar, maks.10 MB), opsi email, Cancel/Save & publish. Draft kosong dibatalkan; tidak ada pengumuman dikirim.\n- **User Activity Log:** date range, All email, All type, Apply filter, Export, Search; kolom Date, Email, Activity, Type. Satu baris ada; nilai record tidak disalin dan ekspor tidak dijalankan.\n- **Queue activity:** Search, Refresh, Help/Learn more; kolom Queue ID, Activity, Executed by, Submitted time, Started time, Status. Kosong.\n- **Notification:** Start/End date, Status (Cancel/Completed/Need Action/Skipped), Type (Bank Account Invalid/Employee Transfer/Reminder/Resign), Apply, Export, Search, pagination; kolom Type, Description, Effective Date, Payroll Name, Payroll Month, Created By, Created Date, Status, Action. Kosong; bulk Skip all tidak dijalankan.\n- **Company files:** tabs Company files/Employee files/Other files. Company files: New company files/Search, kolom Folder name, Shared to, Accessible from, Last modified by; Add folder mencakup Name (maks.60), Description (maks.200), Accessible on date, criteria semua/selected (Branch, Organization, Job position, Job level, Employment status, SBU, Employees), upload files, email/reminder. Employee files: categories All/Identity/Other, filters All employees/All job positions, Search, Employee files report, Add file/Add employee files; kategori berisi satu input, file meminta employee+attachment, bulk upload mendukung folder per karyawan. File types termasuk PDF/gambar/Office/CSV/TXT/ZIP/RAR, batas 10 MB per file dan 100 file/1 GB per aksi upload. Other files: Search, Delete, tabel File Name, Type File, Uploader, Date Created. Semua daftar kosong; draft nama/description/kategori dibatalkan; tidak ada file diunggah/dihapus.\n- **Onboarding:** tab On Progress/Completed; Select Month Period, Select Year Period, jumlah baris; tidak ada hasil.\n- **Report Builder:** dashboard Create report/Guidebook/Insight. Draft laporan meminta Name (maks.28), Description (maks.120), type Latest update/Daily/Monthly; kategori field berbeda tiap tipe (Latest update: Personal, Payroll Information, Employment, Education; Daily menambah Attendance dan request; Monthly menambah Payroll Transaction, Tax Detail, Monthly Attendance). Search/Select all/Clear all/pilihan fields/Add filter to selected, format XLSX/CSV, schedule (Latest update: Not scheduled/Daily). Draft filter/report dibatalkan; tidak ada data diekspor.\n- **Document Template:** Generated documents dan Create template (New/Upload), Search. New template mencakup Template name/description/category (General, Employee Transfer, Overtime Request, Onboarding, Offboarding, Reprimand, Resignation), layout dokumen, pilihan shortcode, auto employee-file sync dan sync saat signature, document number, header/footer, rich-text/shortcode/import document. Upload template meminta name (maks.30), description, category, numbering manual atau auto-generated, stamp metadata, file .doc/.docx maks.5 MB, shortcode dan sync. Draft dibatalkan tanpa upload.\n- **Generated documents:** filter month/template/employee, status employee-file (All/Not synced/Synced/File deleted), status dokumen (Active/Revoked), status Mekari Sign; KPI total/not sent/awaiting/partial/signed; export/search; kolom Transaction ID, Exported date, Employee name, Template name, Document number, Exported by, Employee files, Mekari Sign, Document status, Source. Tidak ada record; ekspor tidak dilakukan.",
    "verified": true
  },
  {
    "id": "employees-offboarding",
    "group": "Employees",
    "name": "Offboarding",
    "columns": [
      "Employee name",
      "Resign Date",
      "Status",
      "Last updated",
      "Task progress"
    ],
    "fields": [],
    "filters": [
      "Status",
      "Branch"
    ],
    "tabs": [],
    "action": "Settings",
    "notes": "- **Onboarding:** tab On Progress/Completed, filter Select Month Period dan Select Year Period, serta kontrol jumlah baris; tidak ada karyawan menunggu.\n- **Offboarding:** kolom Employee name, Resign Date, Status, Last updated, Task progress; Filter, pencarian, Settings, Guidebook. Tabel kosong.\n- **Reprimand:** aksi View report, Create (Reprimand/Reprimand type), Filter, Guidebook, Import, search, pagination. Filter: Assigned to, Status, Reprimand type, Organization, Period. Form reprimand: Assign to/Select employee, Reprimand type, Effective date, End date, Notes, Watchers, Attachment, Document template (optional), Cancel/Create. Form kosong dibatalkan.\n\n- **Users:** pencarian, rows-per-page/pagination, Invite Employee dan Export; kolom Photo, Employee ID, Fullname, Role, Last Action, Action. Tidak ada user ditambahkan.\n- **Invitation to Talenta:** filter/pencarian dan Export; tabel Employee name, Employee ID, Email, Job position, Organization, Branch, Job level, Join date. Daftar kosong; tidak ada invitation dikirim.\n- **Access role:** Search, pagination, New; tabel Role Name dan kolom actions. Form role baru meminta Role Name, Role (Super Admin/Admin/Employee/Finance), cakupan Organization/Job Position/Job Level/Branch/SBU, Role Type (Default/Custom), permission groups Time Management, Employee, Payroll, Approval List, Manpower Planning, General Ledger Mapper, Subordinate Time Off Request, Subordinate Overtime Request. Form ditutup tanpa membuat role atau mengubah hak akses.\n- **Onboarding Setting:** Create New Set; tabel Description/Job. Form: Name, Job Position, Work Location, Instruction, lokasi peta, Task for inviter, Task for new employee, Organization, Close/Save. Teks sintetis QA TEST ONLY diisi lalu dibatalkan.\n- **Task Setting:** dua tabel Task for inviter dan Task for new employee; masing-masing search, pagination, kolom Description, Type, Action, Add New Task. Form task: Task Type (Text Only/Upload/Download), Task Description, Close/Save. Teks uji dibatalkan.\n- **Offboarding** tersedia dalam navigasi Users; belum dibuka dari bagian Settings.",
    "verified": true
  },
  {
    "id": "employees-reprimand",
    "group": "Employees",
    "name": "Reprimand",
    "columns": [
      "Employee name",
      "Reprimand type",
      "Effective date",
      "End date",
      "Status"
    ],
    "fields": [
      "Assign to!",
      "Reprimand type!",
      "Effective date!",
      "End date",
      "Notes",
      "Watchers",
      "Attachment",
      "Document template"
    ],
    "filters": [
      "Assigned to",
      "Status",
      "Reprimand type",
      "Organization",
      "Period"
    ],
    "tabs": [],
    "action": "Create reprimand",
    "notes": "- **Onboarding:** tab On Progress/Completed, filter Select Month Period dan Select Year Period, serta kontrol jumlah baris; tidak ada karyawan menunggu.\n- **Offboarding:** kolom Employee name, Resign Date, Status, Last updated, Task progress; Filter, pencarian, Settings, Guidebook. Tabel kosong.\n- **Reprimand:** aksi View report, Create (Reprimand/Reprimand type), Filter, Guidebook, Import, search, pagination. Filter: Assigned to, Status, Reprimand type, Organization, Period. Form reprimand: Assign to/Select employee, Reprimand type, Effective date, End date, Notes, Watchers, Attachment, Document template (optional), Cancel/Create. Form kosong dibatalkan.",
    "verified": true
  },
  {
    "id": "recruitment-overview",
    "group": "Recruitment",
    "name": "Overview",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "recruitment-job-listings",
    "group": "Recruitment",
    "name": "Job listings",
    "columns": [
      "Job listing title",
      "Job position",
      "Organization",
      "Candidates",
      "Publication status",
      "Platform",
      "Publication date",
      "Duration",
      "Created date",
      "Hiring team"
    ],
    "fields": [
      "Job position!",
      "Job listing title!",
      "Branch!",
      "Province",
      "City",
      "Organization",
      "Team",
      "Employment type",
      "Workplace type",
      "Headcount",
      "Salary range",
      "Salary description",
      "Description",
      "Requirements",
      "Benefits",
      "Job summary",
      "Education",
      "Experience level",
      "Minimum experience",
      "Gender",
      "Age range",
      "Application form",
      "Hiring stage",
      "Hiring team",
      "Publication setting"
    ],
    "filters": [
      "Branch",
      "Organization",
      "Employment status",
      "Workplace type",
      "Publication date",
      "Closing date",
      "Platform",
      "Creator",
      "Hiring team"
    ],
    "tabs": [
      "Published",
      "Draft",
      "Unpublished",
      "Closed"
    ],
    "action": "Create job listing",
    "notes": "- **Candidates:** status New candidates/Screening/Assessments/Interviews/Job offer/Hired/Rejected/Archived/Spam/Blocked; filter Applications (Job positions, Branch, Organization, Team, Applied date), Experience (Education, Latest job position), Others (Age, Gender, Restriction status, Hiring Team, Source); tabel Candidate name, Applied position/date, Last updated, Candidate score AI, Source, MBTI assessment status, Email address, Phone number, Education, Hiring team; All filters/reset/apply, columns/search, Bulk add/update/export/view import-export logs, Add candidate. Kosong; Add candidate meminta applied job position yang tidak tersedia dan modal dibatalkan. Tidak membuka record orang.\n- **Job listings:** status Published/Draft/Unpublished/Closed; filter Branch/Organization/Employment status/Workplace type, publication/closing date, platform, creator, hiring team; Search/column controls, Import job listing/Import logs, Create job listing. Kolom Job listing title, Job position, Organization, jumlah candidate per stage, Publication status/platform/date/duration, Created date, Hiring team. Kosong. Wizard draft: Job position/title, Branch/Province/City, Organization/Team, Employment type, Workplace type, Headcount, salary range/description, Description, Requirements, Benefits, Job summary, Education, Experience level/minimum experience, Gender, Age range, lalu Application form/Hiring stage/Hiring team/Publication setting. Validasi tampil ketika Next dicoba; form ditinggalkan tanpa draft disimpan.\n- **Other Recruitment:** Home overview memperlihatkan interview/candidate/opening status tanpa data. Calendar weekly with Today/prev-next dan filters My interviews, All interview schedules, Expired offers, New joiners; tidak ada interview dibuka. Activity log: date range, Filter by User/Page, Search; kolom Date/User/Activity/Page. Time to hire report: filter Job position/Posting period, column control, export icon/search/last update; kolom job/position/ID/recruiter/org/team/branch, publication, hiring stages, time to hire/fill, acceptance rate, headcount, end date, candidate total, last hired; kosong.\n- **Talent pool/Assessments:** halaman first-run fitur/upgrade tanpa database; Assessments dan Library/Custom assessments mengarah ke landing upgrade, tidak ada assessment dibuat/dikirim.\n- **Recruitment Settings:** Users tabel Name/Role/Restrictions/Status, role/status filter, Search, Invite user; tidak mengundang. Roles & permissions menyediakan matriks Admin/Recruiter/User dan Edit permission, kategori izin job listing/candidate/reports/settings; tidak diubah. Hiring stages default Screening, In process (Assessment/Interview), Job offer, Final Status; Edit stage memiliki toggles dan add assessment/interview, dibatalkan. Email templates: scenario/status filter, Search, Create template; kosong; Create template berhenti di informasi paket berbayar. Restricted candidates: date range/Search/Add restricted candidate; form memerlukan NIK, tidak dibuka/diisi. Integrations menyediakan LinkedIn Publish/Jobstreet/Mekari Sign, company-ID/connect controls; tidak diisi/ditautkan. Career page: Preview, Edit career page, View career page, Get embed code; tidak diubah/dipublikasikan. Subscription: ringkasan paket dan penggunaan published jobs/reviewed candidates/admin, upgrade CTA, add-ons, FAQ/Add to plan; detail nilai paket/kuota tidak dicatat.",
    "verified": true
  },
  {
    "id": "recruitment-candidates",
    "group": "Recruitment",
    "name": "Candidates",
    "columns": [
      "Candidate name",
      "Applied position",
      "Applied date",
      "Last updated",
      "Candidate score AI",
      "Source",
      "MBTI assessment status",
      "Email address",
      "Phone number",
      "Education",
      "Hiring team"
    ],
    "fields": [
      "Applied job position!",
      "Candidate name!",
      "Email address"
    ],
    "filters": [
      "Job positions",
      "Branch",
      "Organization",
      "Team",
      "Applied date",
      "Education",
      "Latest job position",
      "Age",
      "Gender",
      "Restriction status",
      "Hiring team",
      "Source"
    ],
    "tabs": [
      "New candidates",
      "Screening",
      "Assessments",
      "Interviews",
      "Job offer",
      "Hired",
      "Rejected",
      "Archived",
      "Spam",
      "Blocked"
    ],
    "action": "Add candidate",
    "notes": "- **Candidates:** status New candidates/Screening/Assessments/Interviews/Job offer/Hired/Rejected/Archived/Spam/Blocked; filter Applications (Job positions, Branch, Organization, Team, Applied date), Experience (Education, Latest job position), Others (Age, Gender, Restriction status, Hiring Team, Source); tabel Candidate name, Applied position/date, Last updated, Candidate score AI, Source, MBTI assessment status, Email address, Phone number, Education, Hiring team; All filters/reset/apply, columns/search, Bulk add/update/export/view import-export logs, Add candidate. Kosong; Add candidate meminta applied job position yang tidak tersedia dan modal dibatalkan. Tidak membuka record orang.\n- **Job listings:** status Published/Draft/Unpublished/Closed; filter Branch/Organization/Employment status/Workplace type, publication/closing date, platform, creator, hiring team; Search/column controls, Import job listing/Import logs, Create job listing. Kolom Job listing title, Job position, Organization, jumlah candidate per stage, Publication status/platform/date/duration, Created date, Hiring team. Kosong. Wizard draft: Job position/title, Branch/Province/City, Organization/Team, Employment type, Workplace type, Headcount, salary range/description, Description, Requirements, Benefits, Job summary, Education, Experience level/minimum experience, Gender, Age range, lalu Application form/Hiring stage/Hiring team/Publication setting. Validasi tampil ketika Next dicoba; form ditinggalkan tanpa draft disimpan.\n- **Other Recruitment:** Home overview memperlihatkan interview/candidate/opening status tanpa data. Calendar weekly with Today/prev-next dan filters My interviews, All interview schedules, Expired offers, New joiners; tidak ada interview dibuka. Activity log: date range, Filter by User/Page, Search; kolom Date/User/Activity/Page. Time to hire report: filter Job position/Posting period, column control, export icon/search/last update; kolom job/position/ID/recruiter/org/team/branch, publication, hiring stages, time to hire/fill, acceptance rate, headcount, end date, candidate total, last hired; kosong.\n- **Talent pool/Assessments:** halaman first-run fitur/upgrade tanpa database; Assessments dan Library/Custom assessments mengarah ke landing upgrade, tidak ada assessment dibuat/dikirim.\n- **Recruitment Settings:** Users tabel Name/Role/Restrictions/Status, role/status filter, Search, Invite user; tidak mengundang. Roles & permissions menyediakan matriks Admin/Recruiter/User dan Edit permission, kategori izin job listing/candidate/reports/settings; tidak diubah. Hiring stages default Screening, In process (Assessment/Interview), Job offer, Final Status; Edit stage memiliki toggles dan add assessment/interview, dibatalkan. Email templates: scenario/status filter, Search, Create template; kosong; Create template berhenti di informasi paket berbayar. Restricted candidates: date range/Search/Add restricted candidate; form memerlukan NIK, tidak dibuka/diisi. Integrations menyediakan LinkedIn Publish/Jobstreet/Mekari Sign, company-ID/connect controls; tidak diisi/ditautkan. Career page: Preview, Edit career page, View career page, Get embed code; tidak diubah/dipublikasikan. Subscription: ringkasan paket dan penggunaan published jobs/reviewed candidates/admin, upgrade CTA, add-ons, FAQ/Add to plan; detail nilai paket/kuota tidak dicatat.",
    "verified": true
  },
  {
    "id": "recruitment-calendar",
    "group": "Recruitment",
    "name": "Calendar",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [
      "My interviews",
      "All interview schedules",
      "Expired offers",
      "New joiners"
    ],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "recruitment-activity-log",
    "group": "Recruitment",
    "name": "Activity log",
    "columns": [
      "Date",
      "User",
      "Activity",
      "Page"
    ],
    "fields": [],
    "filters": [
      "Date range",
      "User",
      "Page"
    ],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "recruitment-time-to-hire-report",
    "group": "Recruitment",
    "name": "Time to hire report",
    "columns": [
      "Job listing",
      "Job position",
      "ID",
      "Recruiter",
      "Organization",
      "Team",
      "Branch",
      "Publication",
      "Hiring stages",
      "Time to hire",
      "Time to fill",
      "Acceptance rate",
      "Headcount",
      "End date",
      "Candidate total",
      "Last hired"
    ],
    "fields": [],
    "filters": [
      "Job position",
      "Posting period"
    ],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "recruitment-talent-pool",
    "group": "Recruitment",
    "name": "Talent pool",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "recruitment-assessments",
    "group": "Recruitment",
    "name": "Assessments",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "Library,Custom assessments",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "recruitment-settings-users",
    "group": "Recruitment settings",
    "name": "Users",
    "columns": [
      "Name",
      "Role",
      "Restrictions",
      "Status"
    ],
    "fields": [
      "Name!",
      "Email!",
      "Role",
      "Restrictions"
    ],
    "filters": [
      "Role",
      "Status"
    ],
    "tabs": [],
    "action": "Invite user",
    "notes": "- **Users:** pencarian, rows-per-page/pagination, Invite Employee dan Export; kolom Photo, Employee ID, Fullname, Role, Last Action, Action. Tidak ada user ditambahkan.\n- **Invitation to Talenta:** filter/pencarian dan Export; tabel Employee name, Employee ID, Email, Job position, Organization, Branch, Job level, Join date. Daftar kosong; tidak ada invitation dikirim.\n- **Access role:** Search, pagination, New; tabel Role Name dan kolom actions. Form role baru meminta Role Name, Role (Super Admin/Admin/Employee/Finance), cakupan Organization/Job Position/Job Level/Branch/SBU, Role Type (Default/Custom), permission groups Time Management, Employee, Payroll, Approval List, Manpower Planning, General Ledger Mapper, Subordinate Time Off Request, Subordinate Overtime Request. Form ditutup tanpa membuat role atau mengubah hak akses.\n- **Onboarding Setting:** Create New Set; tabel Description/Job. Form: Name, Job Position, Work Location, Instruction, lokasi peta, Task for inviter, Task for new employee, Organization, Close/Save. Teks sintetis QA TEST ONLY diisi lalu dibatalkan.\n- **Task Setting:** dua tabel Task for inviter dan Task for new employee; masing-masing search, pagination, kolom Description, Type, Action, Add New Task. Form task: Task Type (Text Only/Upload/Download), Task Description, Close/Save. Teks uji dibatalkan.\n- **Offboarding** tersedia dalam navigasi Users; belum dibuka dari bagian Settings.",
    "verified": true
  },
  {
    "id": "recruitment-settings-roles-permissions",
    "group": "Recruitment settings",
    "name": "Roles & permissions",
    "columns": [
      "Permission",
      "Admin",
      "Recruiter",
      "User"
    ],
    "fields": [
      "Job listing?",
      "Candidate?",
      "Reports?",
      "Settings?"
    ],
    "filters": [],
    "tabs": [],
    "action": "Edit permission",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "recruitment-settings-hiring-stages",
    "group": "Recruitment settings",
    "name": "Hiring stages",
    "columns": [
      "Stage",
      "Status"
    ],
    "fields": [
      "Screening?",
      "Assessment?",
      "Interview?",
      "Job offer?",
      "Final status?"
    ],
    "filters": [],
    "tabs": [],
    "action": "Edit stage",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "recruitment-settings-email-templates",
    "group": "Recruitment settings",
    "name": "Email templates",
    "columns": [
      "Scenario",
      "Status"
    ],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "Create template",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "recruitment-settings-restricted-candidates",
    "group": "Recruitment settings",
    "name": "Restricted candidates",
    "columns": [
      "Candidate",
      "Reason",
      "Period"
    ],
    "fields": [
      "NIK!",
      "Reason",
      "Period"
    ],
    "filters": [
      "Date range"
    ],
    "tabs": [],
    "action": "Add restricted candidate",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "recruitment-settings-integrations",
    "group": "Recruitment settings",
    "name": "Integrations",
    "columns": [
      "Integration",
      "Status"
    ],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "Connect",
    "notes": "### Integrations yang diperiksa",
    "verified": true
  },
  {
    "id": "recruitment-settings-career-page",
    "group": "Recruitment settings",
    "name": "Career page",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "Edit career page",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "recruitment-settings-subscription",
    "group": "Recruitment settings",
    "name": "Subscription",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "time-time-off-requests",
    "group": "Time",
    "name": "Time off requests",
    "columns": [
      "Employee name",
      "Request ID",
      "Requested date",
      "Policy",
      "Time off date",
      "Status",
      "Branch",
      "Organization",
      "Job level",
      "Employment status",
      "SBU"
    ],
    "fields": [
      "Employee name!",
      "Time off policy!",
      "Time off date!",
      "Request type",
      "Delegate approval during absence to",
      "Reason",
      "Attachment"
    ],
    "filters": [
      "Year",
      "Status",
      "Request date",
      "Branch",
      "Organization"
    ],
    "tabs": [],
    "action": "Request time off",
    "notes": "### Time off requests",
    "verified": true
  },
  {
    "id": "time-time-off-transaction",
    "group": "Time",
    "name": "Time off transaction",
    "columns": [
      "Transaction ID",
      "Policy name",
      "Type",
      "Assign to",
      "Last modified"
    ],
    "fields": [
      "Policy name!",
      "Description",
      "Employee selection!",
      "Effective date",
      "Expiration date"
    ],
    "filters": [
      "Policy",
      "Type"
    ],
    "tabs": [],
    "action": "Assign employees",
    "notes": "### Time off transaction",
    "verified": true
  },
  {
    "id": "time-balance-history",
    "group": "Time",
    "name": "Balance history",
    "columns": [
      "Employee",
      "Job Position",
      "Branch",
      "Beginning balance",
      "Time off taken",
      "Adjustment",
      "Expired",
      "Carry forward",
      "Ending balance"
    ],
    "fields": [],
    "filters": [
      "Date range",
      "Policy",
      "Status",
      "Branch",
      "Organization",
      "Job position",
      "Job level"
    ],
    "tabs": [
      "Overview balance",
      "Log balance",
      "Block leave"
    ],
    "action": "Add policy",
    "notes": "### Balance history dan Roster leave",
    "verified": true
  },
  {
    "id": "time-roster-leave",
    "group": "Time",
    "name": "Roster leave",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "time-attendance-data",
    "group": "Time",
    "name": "Attendance data",
    "columns": [
      "Employee name",
      "Date",
      "Shift",
      "Schedule in",
      "Schedule out",
      "Clock in",
      "Clock out",
      "Attendance code",
      "Time off code",
      "Total overtime duration",
      "Branch",
      "Organization",
      "Job level",
      "Employment status",
      "Shift code",
      "Late in",
      "Early out",
      "Overtime before schedule in",
      "Overtime after schedule out",
      "Schedule working hours",
      "Actual working hours",
      "Real working hours",
      "Hourly time off taken"
    ],
    "fields": [
      "Date!",
      "Shift",
      "Clock in",
      "Clock out",
      "Time off policy",
      "Overtime duration before shift",
      "Break duration before shift",
      "Overtime duration after shift",
      "Break duration after shift"
    ],
    "filters": [
      "Date",
      "Clock in",
      "Clock out",
      "Overtime",
      "Time off",
      "Shift labels",
      "Shift",
      "Organization",
      "Job position",
      "Employment status",
      "Job level",
      "Branch"
    ],
    "tabs": [],
    "action": "Import attendance",
    "notes": "### Attendance data",
    "verified": true
  },
  {
    "id": "time-attendance-activity",
    "group": "Time",
    "name": "Attendance activity",
    "columns": [
      "Employee name",
      "Employee ID",
      "Date",
      "Time",
      "Type",
      "Job position",
      "Photo",
      "Face recognition",
      "Liveness validation",
      "Shift",
      "Shift code",
      "Location setting name",
      "Location GPS name",
      "Location address",
      "Coordinate",
      "Description",
      "Source",
      "Status"
    ],
    "fields": [],
    "filters": [
      "Date range",
      "Status",
      "Branch",
      "Organization",
      "Job position",
      "Job level",
      "Employment status"
    ],
    "tabs": [
      "Overview",
      "Approval Request"
    ],
    "action": "",
    "notes": "### Attendance activity, absence deduction, Time Reports\n\n- **Attendance activity:** tab Overview/Approval Request. Overview memiliki date range, status, All filters (Attendance date, Status; filter tambahan Shift Labels, Branch, Organization, Job position, Job level, Resignation status, Employment status), search, Show location name (nonaktif), dan kolom Employee name, Employee ID, Date, Time, Type, Job position, Photo, Face recognition, Liveness validation, Shift, Shift code, Location setting name, Location GPS name, Location address, Coordinate, Description, Source, Status. Halaman menampilkan error pengambilan activity. Approval Request menyebut data gagal divalidasi dari portal; filter Status, Branch, Organization, Job position, Job level, Employment status; tabel tanpa record dengan kolom Employee name, Employee ID, Date, Time, Type, Job position, Photo, Face recognition, Liveness validation, Location address, Coordinate, Reason.\n- **Absence deduction:** kontrol Month/Year, pencarian, Back to attendance, Mark as Time-off; kolom Employee ID, Name, Branch, Organization, Absence, dan kolom aksi. Tabel kosong; Mark as Time-off tidak ditekan.\n- **Time Reports (NEW):** guide menyebut Attendance report, Overtime report, batas rentang 31 hari, pemilihan atribut/karyawan, dan hasil XLS diproses di background lalu tersedia di inbox. Halaman report menampilkan Attendance report, Overtime report, Summary attendance report dengan tombol Download report in XLS. Tidak ada laporan yang dibuat/diunduh.",
    "verified": true
  },
  {
    "id": "time-absence-deduction",
    "group": "Time",
    "name": "Absence deduction",
    "columns": [
      "Employee ID",
      "Name",
      "Branch",
      "Organization",
      "Absence"
    ],
    "fields": [
      "Employee name!",
      "Time off policy!"
    ],
    "filters": [
      "Month",
      "Year"
    ],
    "tabs": [],
    "action": "Mark as Time-off",
    "notes": "- **Attendance activity:** tab Overview/Approval Request. Overview memiliki date range, status, All filters (Attendance date, Status; filter tambahan Shift Labels, Branch, Organization, Job position, Job level, Resignation status, Employment status), search, Show location name (nonaktif), dan kolom Employee name, Employee ID, Date, Time, Type, Job position, Photo, Face recognition, Liveness validation, Shift, Shift code, Location setting name, Location GPS name, Location address, Coordinate, Description, Source, Status. Halaman menampilkan error pengambilan activity. Approval Request menyebut data gagal divalidasi dari portal; filter Status, Branch, Organization, Job position, Job level, Employment status; tabel tanpa record dengan kolom Employee name, Employee ID, Date, Time, Type, Job position, Photo, Face recognition, Liveness validation, Location address, Coordinate, Reason.\n- **Absence deduction:** kontrol Month/Year, pencarian, Back to attendance, Mark as Time-off; kolom Employee ID, Name, Branch, Organization, Absence, dan kolom aksi. Tabel kosong; Mark as Time-off tidak ditekan.\n- **Time Reports (NEW):** guide menyebut Attendance report, Overtime report, batas rentang 31 hari, pemilihan atribut/karyawan, dan hasil XLS diproses di background lalu tersedia di inbox. Halaman report menampilkan Attendance report, Overtime report, Summary attendance report dengan tombol Download report in XLS. Tidak ada laporan yang dibuat/diunduh.",
    "verified": true
  },
  {
    "id": "time-overtime-requests",
    "group": "Time",
    "name": "Overtime requests",
    "columns": [
      "Employee name",
      "Requested date",
      "Overtime date",
      "Duration",
      "Compensation",
      "Status"
    ],
    "fields": [
      "Employee name!",
      "Overtime date!",
      "Compensation",
      "Reason",
      "Overtime duration before shift",
      "Break duration before shift",
      "Overtime duration after shift",
      "Break duration after shift",
      "Attachment"
    ],
    "filters": [
      "Year",
      "Status",
      "Overtime date",
      "My subordinate",
      "Compensation",
      "Branch",
      "Organization",
      "Job position",
      "Job level",
      "Employment status"
    ],
    "tabs": [],
    "action": "Request overtime",
    "notes": "### Overtime requests",
    "verified": true
  },
  {
    "id": "time-calendar",
    "group": "Time",
    "name": "Calendar",
    "columns": [],
    "fields": [
      "Name of Event!",
      "Date!",
      "Number of days",
      "Company holiday?",
      "Start time",
      "End time",
      "Branch",
      "Everyone can view?",
      "Send Email?",
      "Note"
    ],
    "filters": [],
    "tabs": [
      "All Events",
      "Birthday",
      "Time off"
    ],
    "action": "Add Event",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "time-scheduler",
    "group": "Time",
    "name": "Scheduler",
    "columns": [
      "Employee name",
      "Branch",
      "Organization",
      "Current schedule"
    ],
    "fields": [
      "Employee!",
      "Work Schedule!",
      "Start Date!"
    ],
    "filters": [
      "Resignation status",
      "Branch",
      "Organization",
      "Job position",
      "Job level",
      "Employment status",
      "Schedule"
    ],
    "tabs": [
      "Employees",
      "Schedule"
    ],
    "action": "Assign schedule",
    "notes": "### Scheduler",
    "verified": true
  },
  {
    "id": "time-time-reports",
    "group": "Time",
    "name": "Time Reports",
    "columns": [
      "Report name",
      "Format"
    ],
    "fields": [
      "Date range!",
      "Employee",
      "Attributes"
    ],
    "filters": [],
    "tabs": [
      "Attendance report",
      "Overtime report",
      "Summary attendance report"
    ],
    "action": "Download report in XLS",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "time-on-call-schedule",
    "group": "Time",
    "name": "On-call schedule",
    "columns": [
      "Employee name",
      "On-call date",
      "On-call status",
      "On-call shift",
      "Created on"
    ],
    "fields": [
      "Date!",
      "Description",
      "Employee!",
      "On-call shift"
    ],
    "filters": [
      "Month",
      "Branch",
      "Organization"
    ],
    "tabs": [],
    "action": "Create on-call",
    "notes": "- **On-call schedule:** filter bulan, All filters, Search by name/ID, kontrol kolom, Import on-call, Help, Create on-call (Schedule/Shift); tabel Employee name, On-call date, On-call status, On-call shift, Created on. Daftar kosong. Schedule form: Date, Description, Assign employee/Select employee, Save/Cancel. Shift drawer: Employee, Date, On-call shift list, Add on-call shift, Save & create new/Save/Cancel; shift list kosong. Draft dibatalkan.\n- **On-call activity:** date, All filters, kontrol kolom, export, search, Import on-call activity; kolom Employee name, Employee ID, Category, Date, Schedule start/end, Clock in/out. Kosong.\n- **On-call category:** All status, Search by name/code, Create on-call category; kolom Category name, Category code, Status. Kosong. Form: Category name (maks.25), Category code (maks.15; tanpa spasi/karakter khusus), Description (maks.60); dibatalkan tanpa dibuat.\n- **Liveness** tampil sebagai add-on bertaut eksternal pada menu Time dan memiliki ikon penanda; link tidak dibuka.",
    "verified": true
  },
  {
    "id": "time-on-call-activity",
    "group": "Time",
    "name": "On-call activity",
    "columns": [
      "Employee name",
      "Employee ID",
      "Category",
      "Date",
      "Schedule start",
      "Schedule end",
      "Clock in",
      "Clock out"
    ],
    "fields": [
      "Employee!",
      "Date!",
      "Category"
    ],
    "filters": [
      "Date",
      "Branch",
      "Organization"
    ],
    "tabs": [],
    "action": "Import on-call activity",
    "notes": "- **On-call schedule:** filter bulan, All filters, Search by name/ID, kontrol kolom, Import on-call, Help, Create on-call (Schedule/Shift); tabel Employee name, On-call date, On-call status, On-call shift, Created on. Daftar kosong. Schedule form: Date, Description, Assign employee/Select employee, Save/Cancel. Shift drawer: Employee, Date, On-call shift list, Add on-call shift, Save & create new/Save/Cancel; shift list kosong. Draft dibatalkan.\n- **On-call activity:** date, All filters, kontrol kolom, export, search, Import on-call activity; kolom Employee name, Employee ID, Category, Date, Schedule start/end, Clock in/out. Kosong.\n- **On-call category:** All status, Search by name/code, Create on-call category; kolom Category name, Category code, Status. Kosong. Form: Category name (maks.25), Category code (maks.15; tanpa spasi/karakter khusus), Description (maks.60); dibatalkan tanpa dibuat.\n- **Liveness** tampil sebagai add-on bertaut eksternal pada menu Time dan memiliki ikon penanda; link tidak dibuka.",
    "verified": true
  },
  {
    "id": "time-on-call-category",
    "group": "Time",
    "name": "On-call category",
    "columns": [
      "Category name",
      "Category code",
      "Status"
    ],
    "fields": [
      "Category name!",
      "Category code!",
      "Description"
    ],
    "filters": [
      "Status"
    ],
    "tabs": [],
    "action": "Create on-call category",
    "notes": "- **On-call schedule:** filter bulan, All filters, Search by name/ID, kontrol kolom, Import on-call, Help, Create on-call (Schedule/Shift); tabel Employee name, On-call date, On-call status, On-call shift, Created on. Daftar kosong. Schedule form: Date, Description, Assign employee/Select employee, Save/Cancel. Shift drawer: Employee, Date, On-call shift list, Add on-call shift, Save & create new/Save/Cancel; shift list kosong. Draft dibatalkan.\n- **On-call activity:** date, All filters, kontrol kolom, export, search, Import on-call activity; kolom Employee name, Employee ID, Category, Date, Schedule start/end, Clock in/out. Kosong.\n- **On-call category:** All status, Search by name/code, Create on-call category; kolom Category name, Category code, Status. Kosong. Form: Category name (maks.25), Category code (maks.15; tanpa spasi/karakter khusus), Description (maks.60); dibatalkan tanpa dibuat.\n- **Liveness** tampil sebagai add-on bertaut eksternal pada menu Time dan memiliki ikon penanda; link tidak dibuka.",
    "verified": true
  },
  {
    "id": "time-liveness",
    "group": "Time",
    "name": "Liveness",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "- **On-call schedule:** filter bulan, All filters, Search by name/ID, kontrol kolom, Import on-call, Help, Create on-call (Schedule/Shift); tabel Employee name, On-call date, On-call status, On-call shift, Created on. Daftar kosong. Schedule form: Date, Description, Assign employee/Select employee, Save/Cancel. Shift drawer: Employee, Date, On-call shift list, Add on-call shift, Save & create new/Save/Cancel; shift list kosong. Draft dibatalkan.\n- **On-call activity:** date, All filters, kontrol kolom, export, search, Import on-call activity; kolom Employee name, Employee ID, Category, Date, Schedule start/end, Clock in/out. Kosong.\n- **On-call category:** All status, Search by name/code, Create on-call category; kolom Category name, Category code, Status. Kosong. Form: Category name (maks.25), Category code (maks.15; tanpa spasi/karakter khusus), Description (maks.60); dibatalkan tanpa dibuat.\n- **Liveness** tampil sebagai add-on bertaut eksternal pada menu Time dan memiliki ikon penanda; link tidak dibuka.",
    "verified": false
  },
  {
    "id": "finance-all-requests",
    "group": "Finance",
    "name": "All requests",
    "columns": [
      "Transaction ID",
      "Request date",
      "Employee name",
      "Reimbursement name",
      "Request amount",
      "Description",
      "Status"
    ],
    "fields": [
      "Request date!",
      "Reimbursement name!",
      "Employee name!",
      "Attachment",
      "Description",
      "Benefit component",
      "Total remaining balance",
      "Total paid",
      "Benefit name",
      "Beneficiary",
      "Request amount"
    ],
    "filters": [
      "Year",
      "Status",
      "Branch"
    ],
    "tabs": [],
    "action": "Request reimbursement",
    "notes": "- **All requests:** year, Select status, All filters, search, Import, Request reimbursement; kolom Transaction ID, Request date, Employee name, Reimbursement name, Request amount, Description, Status. Daftar kosong. Form request menampilkan Request date, Reimbursement name dan Employee name (keduanya nonaktif karena belum ada konfigurasi/pilihan), Attachment (PDF/JPG/PNG/JPEG, maks. 10 MB), Description (nonaktif), Benefit component, Total remaining balance, Total paid, Add benefit, search, tabel Benefit name/Beneficiary/Request amount/Paid amount, Cancel/Submit. Submit nonaktif; form dibatalkan.\n- **Assign or update:** tab Balance overview/Transaction history, Simulate balance, Actions, filter reimbursement (nonaktif), All Filter, search; kolom Reimbursement name, Employee name, Total balance limit, Used balance, Remaining balance, Status. Daftar kosong. Actions: Assign reimbursement, Update balance, Assign & update balance, Set expiration. Form assign berisi Reimbursement name (nonaktif), Description (maks. 60), Employee selection/Select employee (nonaktif), Import, Export, search, tabel Employee name, Cancel/Save. Form update/assign & update berisi Reimbursement name (nonaktif), Effective date, Expiration date (wajib), checkbox Set effective and expiration date for all employee (aktif), Description (maks. 60), Employee selection/Select employee (nonaktif), Import/Export, search, tabel Employee name/Beginning balance/Current balance/Effective date/Expiration date, Cancel/Save. Form Set expiration berisi Reimbursement name (nonaktif), Expiration date (wajib), Description (maks. 60), Employee selection/Select employee (nonaktif), Import/Export, search, tabel Employee name, Cancel/Save. Semua form dibatalkan; tidak ada saldo diubah.\n- **Disbursement:** membuka landing page Mekari Expense, bukan tabel klaim; halaman bersifat pengenalan dengan Book consultation. Tidak ada konsultasi yang dijadwalkan.",
    "verified": true
  },
  {
    "id": "finance-assign-or-update",
    "group": "Finance",
    "name": "Assign or update",
    "columns": [
      "Reimbursement name",
      "Employee name",
      "Total balance limit",
      "Used balance",
      "Remaining balance",
      "Status"
    ],
    "fields": [
      "Reimbursement name!",
      "Description",
      "Employee selection!",
      "Effective date",
      "Expiration date!"
    ],
    "filters": [
      "Reimbursement",
      "Status"
    ],
    "tabs": [
      "Balance overview",
      "Transaction history"
    ],
    "action": "Assign reimbursement",
    "notes": "- **All requests:** year, Select status, All filters, search, Import, Request reimbursement; kolom Transaction ID, Request date, Employee name, Reimbursement name, Request amount, Description, Status. Daftar kosong. Form request menampilkan Request date, Reimbursement name dan Employee name (keduanya nonaktif karena belum ada konfigurasi/pilihan), Attachment (PDF/JPG/PNG/JPEG, maks. 10 MB), Description (nonaktif), Benefit component, Total remaining balance, Total paid, Add benefit, search, tabel Benefit name/Beneficiary/Request amount/Paid amount, Cancel/Submit. Submit nonaktif; form dibatalkan.\n- **Assign or update:** tab Balance overview/Transaction history, Simulate balance, Actions, filter reimbursement (nonaktif), All Filter, search; kolom Reimbursement name, Employee name, Total balance limit, Used balance, Remaining balance, Status. Daftar kosong. Actions: Assign reimbursement, Update balance, Assign & update balance, Set expiration. Form assign berisi Reimbursement name (nonaktif), Description (maks. 60), Employee selection/Select employee (nonaktif), Import, Export, search, tabel Employee name, Cancel/Save. Form update/assign & update berisi Reimbursement name (nonaktif), Effective date, Expiration date (wajib), checkbox Set effective and expiration date for all employee (aktif), Description (maks. 60), Employee selection/Select employee (nonaktif), Import/Export, search, tabel Employee name/Beginning balance/Current balance/Effective date/Expiration date, Cancel/Save. Form Set expiration berisi Reimbursement name (nonaktif), Expiration date (wajib), Description (maks. 60), Employee selection/Select employee (nonaktif), Import/Export, search, tabel Employee name, Cancel/Save. Semua form dibatalkan; tidak ada saldo diubah.\n- **Disbursement:** membuka landing page Mekari Expense, bukan tabel klaim; halaman bersifat pengenalan dengan Book consultation. Tidak ada konsultasi yang dijadwalkan.",
    "verified": true
  },
  {
    "id": "finance-disbursement",
    "group": "Finance",
    "name": "Disbursement",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "- **All requests:** year, Select status, All filters, search, Import, Request reimbursement; kolom Transaction ID, Request date, Employee name, Reimbursement name, Request amount, Description, Status. Daftar kosong. Form request menampilkan Request date, Reimbursement name dan Employee name (keduanya nonaktif karena belum ada konfigurasi/pilihan), Attachment (PDF/JPG/PNG/JPEG, maks. 10 MB), Description (nonaktif), Benefit component, Total remaining balance, Total paid, Add benefit, search, tabel Benefit name/Beneficiary/Request amount/Paid amount, Cancel/Submit. Submit nonaktif; form dibatalkan.\n- **Assign or update:** tab Balance overview/Transaction history, Simulate balance, Actions, filter reimbursement (nonaktif), All Filter, search; kolom Reimbursement name, Employee name, Total balance limit, Used balance, Remaining balance, Status. Daftar kosong. Actions: Assign reimbursement, Update balance, Assign & update balance, Set expiration. Form assign berisi Reimbursement name (nonaktif), Description (maks. 60), Employee selection/Select employee (nonaktif), Import, Export, search, tabel Employee name, Cancel/Save. Form update/assign & update berisi Reimbursement name (nonaktif), Effective date, Expiration date (wajib), checkbox Set effective and expiration date for all employee (aktif), Description (maks. 60), Employee selection/Select employee (nonaktif), Import/Export, search, tabel Employee name/Beginning balance/Current balance/Effective date/Expiration date, Cancel/Save. Form Set expiration berisi Reimbursement name (nonaktif), Expiration date (wajib), Description (maks. 60), Employee selection/Select employee (nonaktif), Import/Export, search, tabel Employee name, Cancel/Save. Semua form dibatalkan; tidak ada saldo diubah.\n- **Disbursement:** membuka landing page Mekari Expense, bukan tabel klaim; halaman bersifat pengenalan dengan Book consultation. Tidak ada konsultasi yang dijadwalkan.",
    "verified": false
  },
  {
    "id": "finance-loan",
    "group": "Finance",
    "name": "Loan",
    "columns": [
      "No",
      "Transaction ID",
      "Loan Name",
      "Employee ID",
      "Employee",
      "Loan Amount",
      "Installment",
      "Interest",
      "Effective Date"
    ],
    "fields": [
      "Effective Date!",
      "Employee!",
      "Loan Name!",
      "Amount!",
      "Installment",
      "Interest Type",
      "Interest",
      "Description",
      "Attachment"
    ],
    "filters": [],
    "tabs": [],
    "action": "New loan",
    "notes": "### Loan\n\nSubmenu **Loan** tercantum di menu Finance; ketika dibuka dari Settings, aplikasi kembali ke Dashboard sehingga halaman Settings Loan tidak berhasil diperiksa pada sesi ini. Modul Loan Finance utama yang tersedia tetap tercatat pada bagian Finance di atas.",
    "verified": true
  },
  {
    "id": "payroll-payroll-processing",
    "group": "Payroll",
    "name": "Payroll processing",
    "columns": [
      "Period",
      "Payment schedule",
      "Status"
    ],
    "fields": [
      "Payroll period!",
      "Payment schedule!",
      "Custom BPJS date",
      "Select all employees?",
      "Employees!"
    ],
    "filters": [],
    "tabs": [],
    "action": "Run payroll",
    "notes": "### Payroll processing, history, dan import",
    "verified": true
  },
  {
    "id": "payroll-payroll-history",
    "group": "Payroll",
    "name": "Payroll history",
    "columns": [
      "Period",
      "Last updated by",
      "Total employee",
      "Report",
      "Payroll Status"
    ],
    "fields": [],
    "filters": [
      "Year",
      "Status"
    ],
    "tabs": [],
    "action": "Request data",
    "notes": "- **Run payroll:** wizard bertahap Set up/Review/Summary. Set up menampilkan Payroll period, Payment schedule (default), opsi tanggal khusus BPJS Kesehatan, pemilihan karyawan/Select all employees, Cancel, dan Next. Checklist sebelum proses menautkan inbox, employee transfer, payroll component, custom rates/currency, attendance, dan employee data. Tombol Run payroll memulai pemrosesan pembayaran; wizard ditinggalkan tanpa menjalankannya.\n- **Payroll history:** filter tahun, Disbursement, Request data, pencarian; kolom Period, Last updated by, Total employee, Report, Payroll Status. Daftar kosong. Disbursement dan laporan tidak dibuka.\n- **Import Payroll:** tautan template `Template_Salary_History.xlsx`, upload spreadsheet, petunjuk Employee ID harus benar, Cancel, Submit (nonaktif tanpa file). Tidak ada file/template yang dipilih.",
    "verified": true
  },
  {
    "id": "payroll-import-payroll",
    "group": "Payroll",
    "name": "Import Payroll",
    "columns": [],
    "fields": [
      "Attachment!"
    ],
    "filters": [],
    "tabs": [],
    "action": "Import Payroll",
    "notes": "- **Run payroll:** wizard bertahap Set up/Review/Summary. Set up menampilkan Payroll period, Payment schedule (default), opsi tanggal khusus BPJS Kesehatan, pemilihan karyawan/Select all employees, Cancel, dan Next. Checklist sebelum proses menautkan inbox, employee transfer, payroll component, custom rates/currency, attendance, dan employee data. Tombol Run payroll memulai pemrosesan pembayaran; wizard ditinggalkan tanpa menjalankannya.\n- **Payroll history:** filter tahun, Disbursement, Request data, pencarian; kolom Period, Last updated by, Total employee, Report, Payroll Status. Daftar kosong. Disbursement dan laporan tidak dibuka.\n- **Import Payroll:** tautan template `Template_Salary_History.xlsx`, upload spreadsheet, petunjuk Employee ID harus benar, Cancel, Submit (nonaktif tanpa file). Tidak ada file/template yang dipilih.",
    "verified": true
  },
  {
    "id": "payroll-payroll-component-adjustment",
    "group": "Payroll",
    "name": "Payroll component adjustment",
    "columns": [
      "Transaction ID",
      "Type",
      "Effective date",
      "End date",
      "Created by",
      "Description",
      "Employees",
      "Components name",
      "Status"
    ],
    "fields": [
      "Type!",
      "Effective date!",
      "End date",
      "Backpay?",
      "Attachment",
      "Description",
      "Employees!",
      "Component!",
      "Amount"
    ],
    "filters": [
      "Date range",
      "Component"
    ],
    "tabs": [
      "Update history",
      "Employee history"
    ],
    "action": "Update component",
    "notes": "### Payroll component adjustment",
    "verified": true
  },
  {
    "id": "payroll-salary-tax-calculator",
    "group": "Payroll",
    "name": "Salary Tax Calculator",
    "columns": [],
    "fields": [
      "PTKP!",
      "Tax Configuration!",
      "Has NPWP?",
      "Basic Salary",
      "Total Allowance Taxable",
      "Total Deduction Taxable",
      "Total Allowance Non Taxable",
      "Total Deduction Non Taxable",
      "THR",
      "Bonus",
      "Has BPJS TK?",
      "Has BPJS Kesehatan?"
    ],
    "filters": [],
    "tabs": [
      "TER",
      "Non TER"
    ],
    "action": "Calculate",
    "notes": "- **Salary Tax Calculator:** mode TER/Non TER; PTKP (TK/0 hingga K/3); Tax Configuration (Default/Gross/Gross Up/Netto); Has NPWP; Basic Salary; Total Allowance Taxable; Total Deduction Taxable; Total Allowance Non Taxable; Total Deduction Non Taxable; THR; Bonus; Has BPJS TK; Has BPJS Kesehatan; Reset; Calculate. Uji sintetis terbatas memakai PTKP TK/0, konfigurasi Default, dan Basic Salary Rp10.000.000. Calculate hanya memunculkan validasi “Tax Configuration must be no less than 1”; kemudian Reset ditekan dan seluruh nilai uji dibersihkan. Tidak ada data yang disimpan.\n- **Payroll Reports:** filter tahun, bulan, branch; tab Salary Report, Tax Report, BPJS Report, Human Resources Report, Attendance Report, Reimbursement Report, Overtime Report, Loan Report. Bagian salary menyediakan Salary Detail, Summary Report, THR Report, Payslip, THR Slip, Salary Detail Yearly.xlsx, Salary Detail Compare, Salary Recapitulation, Daily Allowance & Deduction Report, dan tautan Report Builder. Tidak ada laporan gaji/pajak yang dibuka atau diunduh.\n- Dashboard Payroll juga memuat tautan New Payroll History, Update Payroll Component, Run Payroll, View Reports, New Settings, Import Payroll, Run THR, Ex Employee Allowance, Salary Tax Calculator, NPP Transaction History, Tax/Recalculate, Cost Center, New General Ledger Mapper, PPh21 DTP, BPJS New Rate, dan PKWT Compensation.",
    "verified": true
  },
  {
    "id": "payroll-reports",
    "group": "Payroll",
    "name": "Reports",
    "columns": [
      "Report name",
      "Format"
    ],
    "fields": [],
    "filters": [
      "Year",
      "Month",
      "Branch"
    ],
    "tabs": [
      "Salary Report",
      "Tax Report",
      "BPJS Report",
      "Human Resources Report",
      "Attendance Report",
      "Reimbursement Report",
      "Overtime Report",
      "Loan Report"
    ],
    "action": "Export",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "payroll-ex-employee-allowance",
    "group": "Payroll",
    "name": "Ex Employee Allowance",
    "columns": [
      "No",
      "Transaction ID",
      "Month",
      "Year",
      "Number of Employees",
      "Taxable"
    ],
    "fields": [
      "Year!",
      "Month!",
      "Taxable?",
      "Description",
      "Employee!",
      "Amount"
    ],
    "filters": [],
    "tabs": [],
    "action": "New allowance",
    "notes": "### Ex Employee Allowance dan NPP transaction\n\n- **Ex Employee Allowance:** tabel berkolom No, Transaction ID, Month, Year, Number of Employees, Taxable, Action; Search, pilihan jumlah baris, NEW. Form baru berisi Select Year Period, Select Month Period, Taxable, Description, Add, Choose File/IMPORT, EXPORT, DELETE, Search, tabel No/Employee ID/Full Name/Resign Date/Amount/Action, SAVE. Tidak ada data yang dimasukkan atau dihapus.\n- **NPP Transaction History:** tabel kosong dengan Transaction ID, Total Employee, Created Date, Action; Search dan NEW. Detail form berisi Description, ADD, Choose File/IMPORT, EXPORT, DELETE, Search, tabel Employee ID, Full Name, Branch, Effective Date, Old Npp, New Npp, Action, serta SAVE. Tidak ada perubahan yang disimpan/dihapus dan tidak ada berkas yang dipilih.",
    "verified": true
  },
  {
    "id": "payroll-npp-transaction-history",
    "group": "Payroll",
    "name": "NPP Transaction History",
    "columns": [
      "Transaction ID",
      "Total Employee",
      "Created Date",
      "Action"
    ],
    "fields": [
      "Description",
      "Employee!",
      "Branch",
      "Effective Date!",
      "Old Npp",
      "New Npp!"
    ],
    "filters": [],
    "tabs": [],
    "action": "New transaction",
    "notes": "- **Ex Employee Allowance:** tabel berkolom No, Transaction ID, Month, Year, Number of Employees, Taxable, Action; Search, pilihan jumlah baris, NEW. Form baru berisi Select Year Period, Select Month Period, Taxable, Description, Add, Choose File/IMPORT, EXPORT, DELETE, Search, tabel No/Employee ID/Full Name/Resign Date/Amount/Action, SAVE. Tidak ada data yang dimasukkan atau dihapus.\n- **NPP Transaction History:** tabel kosong dengan Transaction ID, Total Employee, Created Date, Action; Search dan NEW. Detail form berisi Description, ADD, Choose File/IMPORT, EXPORT, DELETE, Search, tabel Employee ID, Full Name, Branch, Effective Date, Old Npp, New Npp, Action, serta SAVE. Tidak ada perubahan yang disimpan/dihapus dan tidak ada berkas yang dipilih.",
    "verified": true
  },
  {
    "id": "payroll-cost-center",
    "group": "Payroll",
    "name": "Cost Center",
    "columns": [
      "Employee name",
      "Branch",
      "Organization",
      "Cost Center",
      "Cost Center Category"
    ],
    "fields": [
      "Employee!",
      "Cost Center",
      "Cost Center Category"
    ],
    "filters": [
      "Category",
      "Branch",
      "Organization"
    ],
    "tabs": [],
    "action": "Edit allocation",
    "notes": "- **Cost Center:** kategori All category/Direct/In-direct, All filter, pencarian, tautan mass update dan help; kolom Employee name, Branch, Organization, Cost Center, Cost Center Category, Edit. Form Edit inline mengubah dua field Cost Center dan Cost Center Category, dengan Cancel/Save changes. Edit dibuka pada nilai existing lalu langsung dibatalkan; tidak ada nilai orang yang disalin.\n- **General Ledger Mapper:** layar awal menyediakan Start mapping dan panduan pembuatan mapping, input akun, kriteria filter, dan unduh report. Create GL mapping berisi Code, Account name, Description, JSON metadata (Optional), Export, Import, Search, tabel Account number, Account name, Type, Transaction value, Component, Add account, Cancel, Save. Pilihan Type: Request, Aggregate, Individual, Cost center; Transaction value: Debit, Credit, Not using. Dua baris kosong dibuat hanya di form lalu form dibatalkan; tidak disimpan/import/export.\n- **PKWT Compensation:** Filter, periode, export, Search, Guidebook, Create new; tabel Employee, Start contract date, End contract date, Work duration (month), Amount, Payroll period. Form transaksi berisi Paid compensation on, Add/delete employee, Import, Export, search, tabel Employee, Employment status, Start contract date, End contract date, Work duration, Amount, serta Back/Submit. Daftar kosong dan form baru dibatalkan.\n- **PPh21 DTP:** dialog menyediakan DTP Recalculate, Export template, Choose File, Import Tax DTP. Tidak ada penghitungan ulang atau import/export yang dijalankan.",
    "verified": true
  },
  {
    "id": "payroll-general-ledger-mapper",
    "group": "Payroll",
    "name": "General Ledger Mapper",
    "columns": [
      "Account number",
      "Account name",
      "Type",
      "Transaction value",
      "Component"
    ],
    "fields": [
      "Code!",
      "Account name!",
      "Description",
      "JSON metadata",
      "Account number",
      "Type",
      "Transaction value",
      "Component"
    ],
    "filters": [],
    "tabs": [],
    "action": "Start mapping",
    "notes": "- **Cost Center:** kategori All category/Direct/In-direct, All filter, pencarian, tautan mass update dan help; kolom Employee name, Branch, Organization, Cost Center, Cost Center Category, Edit. Form Edit inline mengubah dua field Cost Center dan Cost Center Category, dengan Cancel/Save changes. Edit dibuka pada nilai existing lalu langsung dibatalkan; tidak ada nilai orang yang disalin.\n- **General Ledger Mapper:** layar awal menyediakan Start mapping dan panduan pembuatan mapping, input akun, kriteria filter, dan unduh report. Create GL mapping berisi Code, Account name, Description, JSON metadata (Optional), Export, Import, Search, tabel Account number, Account name, Type, Transaction value, Component, Add account, Cancel, Save. Pilihan Type: Request, Aggregate, Individual, Cost center; Transaction value: Debit, Credit, Not using. Dua baris kosong dibuat hanya di form lalu form dibatalkan; tidak disimpan/import/export.\n- **PKWT Compensation:** Filter, periode, export, Search, Guidebook, Create new; tabel Employee, Start contract date, End contract date, Work duration (month), Amount, Payroll period. Form transaksi berisi Paid compensation on, Add/delete employee, Import, Export, search, tabel Employee, Employment status, Start contract date, End contract date, Work duration, Amount, serta Back/Submit. Daftar kosong dan form baru dibatalkan.\n- **PPh21 DTP:** dialog menyediakan DTP Recalculate, Export template, Choose File, Import Tax DTP. Tidak ada penghitungan ulang atau import/export yang dijalankan.",
    "verified": true
  },
  {
    "id": "payroll-pkwt-compensation",
    "group": "Payroll",
    "name": "PKWT Compensation",
    "columns": [
      "Employee",
      "Start contract date",
      "End contract date",
      "Work duration (month)",
      "Amount",
      "Payroll period"
    ],
    "fields": [
      "Paid compensation on!",
      "Employee!",
      "Employment status",
      "Start contract date",
      "End contract date",
      "Work duration",
      "Amount"
    ],
    "filters": [
      "Period",
      "Branch"
    ],
    "tabs": [],
    "action": "Create new",
    "notes": "- **Cost Center:** kategori All category/Direct/In-direct, All filter, pencarian, tautan mass update dan help; kolom Employee name, Branch, Organization, Cost Center, Cost Center Category, Edit. Form Edit inline mengubah dua field Cost Center dan Cost Center Category, dengan Cancel/Save changes. Edit dibuka pada nilai existing lalu langsung dibatalkan; tidak ada nilai orang yang disalin.\n- **General Ledger Mapper:** layar awal menyediakan Start mapping dan panduan pembuatan mapping, input akun, kriteria filter, dan unduh report. Create GL mapping berisi Code, Account name, Description, JSON metadata (Optional), Export, Import, Search, tabel Account number, Account name, Type, Transaction value, Component, Add account, Cancel, Save. Pilihan Type: Request, Aggregate, Individual, Cost center; Transaction value: Debit, Credit, Not using. Dua baris kosong dibuat hanya di form lalu form dibatalkan; tidak disimpan/import/export.\n- **PKWT Compensation:** Filter, periode, export, Search, Guidebook, Create new; tabel Employee, Start contract date, End contract date, Work duration (month), Amount, Payroll period. Form transaksi berisi Paid compensation on, Add/delete employee, Import, Export, search, tabel Employee, Employment status, Start contract date, End contract date, Work duration, Amount, serta Back/Submit. Daftar kosong dan form baru dibatalkan.\n- **PPh21 DTP:** dialog menyediakan DTP Recalculate, Export template, Choose File, Import Tax DTP. Tidak ada penghitungan ulang atau import/export yang dijalankan.",
    "verified": true
  },
  {
    "id": "payroll-pph21-dtp",
    "group": "Payroll",
    "name": "PPh21 DTP",
    "columns": [],
    "fields": [
      "Attachment"
    ],
    "filters": [],
    "tabs": [],
    "action": "DTP Recalculate",
    "notes": "- **Cost Center:** kategori All category/Direct/In-direct, All filter, pencarian, tautan mass update dan help; kolom Employee name, Branch, Organization, Cost Center, Cost Center Category, Edit. Form Edit inline mengubah dua field Cost Center dan Cost Center Category, dengan Cancel/Save changes. Edit dibuka pada nilai existing lalu langsung dibatalkan; tidak ada nilai orang yang disalin.\n- **General Ledger Mapper:** layar awal menyediakan Start mapping dan panduan pembuatan mapping, input akun, kriteria filter, dan unduh report. Create GL mapping berisi Code, Account name, Description, JSON metadata (Optional), Export, Import, Search, tabel Account number, Account name, Type, Transaction value, Component, Add account, Cancel, Save. Pilihan Type: Request, Aggregate, Individual, Cost center; Transaction value: Debit, Credit, Not using. Dua baris kosong dibuat hanya di form lalu form dibatalkan; tidak disimpan/import/export.\n- **PKWT Compensation:** Filter, periode, export, Search, Guidebook, Create new; tabel Employee, Start contract date, End contract date, Work duration (month), Amount, Payroll period. Form transaksi berisi Paid compensation on, Add/delete employee, Import, Export, search, tabel Employee, Employment status, Start contract date, End contract date, Work duration, Amount, serta Back/Submit. Daftar kosong dan form baru dibatalkan.\n- **PPh21 DTP:** dialog menyediakan DTP Recalculate, Export template, Choose File, Import Tax DTP. Tidak ada penghitungan ulang atau import/export yang dijalankan.",
    "verified": true
  },
  {
    "id": "payroll-run-thr",
    "group": "Payroll",
    "name": "Run THR",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "payroll-tax-recalculate",
    "group": "Payroll",
    "name": "Tax/Recalculate",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "payroll-bpjs-new-rate",
    "group": "Payroll",
    "name": "BPJS New Rate",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "productivity-projects",
    "group": "Productivity",
    "name": "Projects",
    "columns": [
      "Name",
      "Members",
      "Tasks"
    ],
    "fields": [
      "Name!",
      "Color"
    ],
    "filters": [
      "Member"
    ],
    "tabs": [
      "Active",
      "Archive"
    ],
    "action": "Create project",
    "notes": "- **Projects:** tab Active/Archive, filter All member, search; tabel Name, Members, Tasks; Create project. Draft Create project hanya meminta Name (wajib) dan Color (8 pilihan); dibatalkan tanpa membuat project.\n- **Tasks:** Filter (Assignees, Task status, Projects; status To do/In progress/In review/Done), Due date, Search, export dan Create task. Tabel tidak memiliki task. Form Create task: Task name (wajib, maks.60), Project, Assignee (wajib), opsi mengirim email, output/izin update progress, payroll calculation, approval task/timetracking, Due date atau No due date, Description, Attachment (PDF, gambar, Office/CSV/TXT, maks.10 MB), Cancel/Save. Assignee/payroll/approval tidak tersedia di tenant; form dibatalkan.\n- **Group for payroll:** Task list menampilkan filter, bulan, search, export; kosong dan menampilkan pesan tidak ada tugas yang sudah disetujui. Terlihat toast gagal memuat opsi nama group. Group list: search dan tabel Group name, Total task, Payroll period; kosong.\n- **Time Tracker:** input aktivitas, Select task, timer, Start timer, Manual time entry. Form manual berisi What are you working on?, Task, Start time, End time, Submit/Cancel. Timer tidak dijalankan dan form manual dibatalkan.\n- **Activities:** pilih employee, rentang minggu, navigasi minggu, Export XLS; grid Senin–Minggu dan total waktu. Tidak ada entri.\n- **Summary:** Group by project, rentang tanggal, Export XLS; tabel Project/Duration. Tidak ada ringkasan.\n- **Tracker Report:** filter Employee, Branch, Organization, Job level, Project, Task, Approval status; periode, Export, Search dan tautan Timesheet setting. Tidak ada report.\n- **Settings → Timesheet:** tab Employees/Setting, filter, Search, Help, Create Setting; daftar tanpa employee/setting. Form Create setting: Setting name (maks.30), Set reminder time track (toggle dengan Time dan Repeat every), Enable time tracker on live attendance, Enable shift selection, Enable location selection, Add employee to policy, Cancel/Save. Toggle, reminder, dan assignment tidak diaktifkan.",
    "verified": true
  },
  {
    "id": "productivity-tasks",
    "group": "Productivity",
    "name": "Tasks",
    "columns": [
      "Task name",
      "Project",
      "Assignee",
      "Due date",
      "Task status"
    ],
    "fields": [
      "Task name!",
      "Project",
      "Assignee!",
      "Send email?",
      "Output",
      "Allow update progress?",
      "Payroll calculation?",
      "Approval task?",
      "Approval timetracking?",
      "Due date",
      "No due date?",
      "Description",
      "Attachment"
    ],
    "filters": [
      "Assignees",
      "Task status",
      "Projects",
      "Due date"
    ],
    "tabs": [],
    "action": "Create task",
    "notes": "- **Projects:** tab Active/Archive, filter All member, search; tabel Name, Members, Tasks; Create project. Draft Create project hanya meminta Name (wajib) dan Color (8 pilihan); dibatalkan tanpa membuat project.\n- **Tasks:** Filter (Assignees, Task status, Projects; status To do/In progress/In review/Done), Due date, Search, export dan Create task. Tabel tidak memiliki task. Form Create task: Task name (wajib, maks.60), Project, Assignee (wajib), opsi mengirim email, output/izin update progress, payroll calculation, approval task/timetracking, Due date atau No due date, Description, Attachment (PDF, gambar, Office/CSV/TXT, maks.10 MB), Cancel/Save. Assignee/payroll/approval tidak tersedia di tenant; form dibatalkan.\n- **Group for payroll:** Task list menampilkan filter, bulan, search, export; kosong dan menampilkan pesan tidak ada tugas yang sudah disetujui. Terlihat toast gagal memuat opsi nama group. Group list: search dan tabel Group name, Total task, Payroll period; kosong.\n- **Time Tracker:** input aktivitas, Select task, timer, Start timer, Manual time entry. Form manual berisi What are you working on?, Task, Start time, End time, Submit/Cancel. Timer tidak dijalankan dan form manual dibatalkan.\n- **Activities:** pilih employee, rentang minggu, navigasi minggu, Export XLS; grid Senin–Minggu dan total waktu. Tidak ada entri.\n- **Summary:** Group by project, rentang tanggal, Export XLS; tabel Project/Duration. Tidak ada ringkasan.\n- **Tracker Report:** filter Employee, Branch, Organization, Job level, Project, Task, Approval status; periode, Export, Search dan tautan Timesheet setting. Tidak ada report.\n- **Settings → Timesheet:** tab Employees/Setting, filter, Search, Help, Create Setting; daftar tanpa employee/setting. Form Create setting: Setting name (maks.30), Set reminder time track (toggle dengan Time dan Repeat every), Enable time tracker on live attendance, Enable shift selection, Enable location selection, Add employee to policy, Cancel/Save. Toggle, reminder, dan assignment tidak diaktifkan.",
    "verified": true
  },
  {
    "id": "productivity-group-for-payroll",
    "group": "Productivity",
    "name": "Group for payroll",
    "columns": [
      "Group name",
      "Total task",
      "Payroll period"
    ],
    "fields": [],
    "filters": [
      "Month",
      "Group"
    ],
    "tabs": [
      "Task list",
      "Group list"
    ],
    "action": "",
    "notes": "- **Projects:** tab Active/Archive, filter All member, search; tabel Name, Members, Tasks; Create project. Draft Create project hanya meminta Name (wajib) dan Color (8 pilihan); dibatalkan tanpa membuat project.\n- **Tasks:** Filter (Assignees, Task status, Projects; status To do/In progress/In review/Done), Due date, Search, export dan Create task. Tabel tidak memiliki task. Form Create task: Task name (wajib, maks.60), Project, Assignee (wajib), opsi mengirim email, output/izin update progress, payroll calculation, approval task/timetracking, Due date atau No due date, Description, Attachment (PDF, gambar, Office/CSV/TXT, maks.10 MB), Cancel/Save. Assignee/payroll/approval tidak tersedia di tenant; form dibatalkan.\n- **Group for payroll:** Task list menampilkan filter, bulan, search, export; kosong dan menampilkan pesan tidak ada tugas yang sudah disetujui. Terlihat toast gagal memuat opsi nama group. Group list: search dan tabel Group name, Total task, Payroll period; kosong.\n- **Time Tracker:** input aktivitas, Select task, timer, Start timer, Manual time entry. Form manual berisi What are you working on?, Task, Start time, End time, Submit/Cancel. Timer tidak dijalankan dan form manual dibatalkan.\n- **Activities:** pilih employee, rentang minggu, navigasi minggu, Export XLS; grid Senin–Minggu dan total waktu. Tidak ada entri.\n- **Summary:** Group by project, rentang tanggal, Export XLS; tabel Project/Duration. Tidak ada ringkasan.\n- **Tracker Report:** filter Employee, Branch, Organization, Job level, Project, Task, Approval status; periode, Export, Search dan tautan Timesheet setting. Tidak ada report.\n- **Settings → Timesheet:** tab Employees/Setting, filter, Search, Help, Create Setting; daftar tanpa employee/setting. Form Create setting: Setting name (maks.30), Set reminder time track (toggle dengan Time dan Repeat every), Enable time tracker on live attendance, Enable shift selection, Enable location selection, Add employee to policy, Cancel/Save. Toggle, reminder, dan assignment tidak diaktifkan.",
    "verified": true
  },
  {
    "id": "productivity-time-tracker",
    "group": "Productivity",
    "name": "Time Tracker",
    "columns": [
      "Activity",
      "Task",
      "Start time",
      "End time",
      "Duration"
    ],
    "fields": [
      "What are you working on?!",
      "Task",
      "Start time!",
      "End time!"
    ],
    "filters": [],
    "tabs": [],
    "action": "Manual time entry",
    "notes": "- **Projects:** tab Active/Archive, filter All member, search; tabel Name, Members, Tasks; Create project. Draft Create project hanya meminta Name (wajib) dan Color (8 pilihan); dibatalkan tanpa membuat project.\n- **Tasks:** Filter (Assignees, Task status, Projects; status To do/In progress/In review/Done), Due date, Search, export dan Create task. Tabel tidak memiliki task. Form Create task: Task name (wajib, maks.60), Project, Assignee (wajib), opsi mengirim email, output/izin update progress, payroll calculation, approval task/timetracking, Due date atau No due date, Description, Attachment (PDF, gambar, Office/CSV/TXT, maks.10 MB), Cancel/Save. Assignee/payroll/approval tidak tersedia di tenant; form dibatalkan.\n- **Group for payroll:** Task list menampilkan filter, bulan, search, export; kosong dan menampilkan pesan tidak ada tugas yang sudah disetujui. Terlihat toast gagal memuat opsi nama group. Group list: search dan tabel Group name, Total task, Payroll period; kosong.\n- **Time Tracker:** input aktivitas, Select task, timer, Start timer, Manual time entry. Form manual berisi What are you working on?, Task, Start time, End time, Submit/Cancel. Timer tidak dijalankan dan form manual dibatalkan.\n- **Activities:** pilih employee, rentang minggu, navigasi minggu, Export XLS; grid Senin–Minggu dan total waktu. Tidak ada entri.\n- **Summary:** Group by project, rentang tanggal, Export XLS; tabel Project/Duration. Tidak ada ringkasan.\n- **Tracker Report:** filter Employee, Branch, Organization, Job level, Project, Task, Approval status; periode, Export, Search dan tautan Timesheet setting. Tidak ada report.\n- **Settings → Timesheet:** tab Employees/Setting, filter, Search, Help, Create Setting; daftar tanpa employee/setting. Form Create setting: Setting name (maks.30), Set reminder time track (toggle dengan Time dan Repeat every), Enable time tracker on live attendance, Enable shift selection, Enable location selection, Add employee to policy, Cancel/Save. Toggle, reminder, dan assignment tidak diaktifkan.",
    "verified": true
  },
  {
    "id": "productivity-activities",
    "group": "Productivity",
    "name": "Activities",
    "columns": [
      "Employee",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
      "Total time"
    ],
    "fields": [],
    "filters": [
      "Employee",
      "Date range"
    ],
    "tabs": [],
    "action": "Export XLS",
    "notes": "- **Projects:** tab Active/Archive, filter All member, search; tabel Name, Members, Tasks; Create project. Draft Create project hanya meminta Name (wajib) dan Color (8 pilihan); dibatalkan tanpa membuat project.\n- **Tasks:** Filter (Assignees, Task status, Projects; status To do/In progress/In review/Done), Due date, Search, export dan Create task. Tabel tidak memiliki task. Form Create task: Task name (wajib, maks.60), Project, Assignee (wajib), opsi mengirim email, output/izin update progress, payroll calculation, approval task/timetracking, Due date atau No due date, Description, Attachment (PDF, gambar, Office/CSV/TXT, maks.10 MB), Cancel/Save. Assignee/payroll/approval tidak tersedia di tenant; form dibatalkan.\n- **Group for payroll:** Task list menampilkan filter, bulan, search, export; kosong dan menampilkan pesan tidak ada tugas yang sudah disetujui. Terlihat toast gagal memuat opsi nama group. Group list: search dan tabel Group name, Total task, Payroll period; kosong.\n- **Time Tracker:** input aktivitas, Select task, timer, Start timer, Manual time entry. Form manual berisi What are you working on?, Task, Start time, End time, Submit/Cancel. Timer tidak dijalankan dan form manual dibatalkan.\n- **Activities:** pilih employee, rentang minggu, navigasi minggu, Export XLS; grid Senin–Minggu dan total waktu. Tidak ada entri.\n- **Summary:** Group by project, rentang tanggal, Export XLS; tabel Project/Duration. Tidak ada ringkasan.\n- **Tracker Report:** filter Employee, Branch, Organization, Job level, Project, Task, Approval status; periode, Export, Search dan tautan Timesheet setting. Tidak ada report.\n- **Settings → Timesheet:** tab Employees/Setting, filter, Search, Help, Create Setting; daftar tanpa employee/setting. Form Create setting: Setting name (maks.30), Set reminder time track (toggle dengan Time dan Repeat every), Enable time tracker on live attendance, Enable shift selection, Enable location selection, Add employee to policy, Cancel/Save. Toggle, reminder, dan assignment tidak diaktifkan.",
    "verified": true
  },
  {
    "id": "productivity-summary",
    "group": "Productivity",
    "name": "Summary",
    "columns": [
      "Project",
      "Duration"
    ],
    "fields": [],
    "filters": [
      "Project",
      "Date range"
    ],
    "tabs": [],
    "action": "Export XLS",
    "notes": "- **Projects:** tab Active/Archive, filter All member, search; tabel Name, Members, Tasks; Create project. Draft Create project hanya meminta Name (wajib) dan Color (8 pilihan); dibatalkan tanpa membuat project.\n- **Tasks:** Filter (Assignees, Task status, Projects; status To do/In progress/In review/Done), Due date, Search, export dan Create task. Tabel tidak memiliki task. Form Create task: Task name (wajib, maks.60), Project, Assignee (wajib), opsi mengirim email, output/izin update progress, payroll calculation, approval task/timetracking, Due date atau No due date, Description, Attachment (PDF, gambar, Office/CSV/TXT, maks.10 MB), Cancel/Save. Assignee/payroll/approval tidak tersedia di tenant; form dibatalkan.\n- **Group for payroll:** Task list menampilkan filter, bulan, search, export; kosong dan menampilkan pesan tidak ada tugas yang sudah disetujui. Terlihat toast gagal memuat opsi nama group. Group list: search dan tabel Group name, Total task, Payroll period; kosong.\n- **Time Tracker:** input aktivitas, Select task, timer, Start timer, Manual time entry. Form manual berisi What are you working on?, Task, Start time, End time, Submit/Cancel. Timer tidak dijalankan dan form manual dibatalkan.\n- **Activities:** pilih employee, rentang minggu, navigasi minggu, Export XLS; grid Senin–Minggu dan total waktu. Tidak ada entri.\n- **Summary:** Group by project, rentang tanggal, Export XLS; tabel Project/Duration. Tidak ada ringkasan.\n- **Tracker Report:** filter Employee, Branch, Organization, Job level, Project, Task, Approval status; periode, Export, Search dan tautan Timesheet setting. Tidak ada report.\n- **Settings → Timesheet:** tab Employees/Setting, filter, Search, Help, Create Setting; daftar tanpa employee/setting. Form Create setting: Setting name (maks.30), Set reminder time track (toggle dengan Time dan Repeat every), Enable time tracker on live attendance, Enable shift selection, Enable location selection, Add employee to policy, Cancel/Save. Toggle, reminder, dan assignment tidak diaktifkan.",
    "verified": true
  },
  {
    "id": "productivity-tracker-report",
    "group": "Productivity",
    "name": "Tracker Report",
    "columns": [
      "Employee",
      "Project",
      "Task",
      "Duration",
      "Approval status"
    ],
    "fields": [],
    "filters": [
      "Employee",
      "Branch",
      "Organization",
      "Job level",
      "Project",
      "Task",
      "Approval status",
      "Period"
    ],
    "tabs": [],
    "action": "Export",
    "notes": "- **Projects:** tab Active/Archive, filter All member, search; tabel Name, Members, Tasks; Create project. Draft Create project hanya meminta Name (wajib) dan Color (8 pilihan); dibatalkan tanpa membuat project.\n- **Tasks:** Filter (Assignees, Task status, Projects; status To do/In progress/In review/Done), Due date, Search, export dan Create task. Tabel tidak memiliki task. Form Create task: Task name (wajib, maks.60), Project, Assignee (wajib), opsi mengirim email, output/izin update progress, payroll calculation, approval task/timetracking, Due date atau No due date, Description, Attachment (PDF, gambar, Office/CSV/TXT, maks.10 MB), Cancel/Save. Assignee/payroll/approval tidak tersedia di tenant; form dibatalkan.\n- **Group for payroll:** Task list menampilkan filter, bulan, search, export; kosong dan menampilkan pesan tidak ada tugas yang sudah disetujui. Terlihat toast gagal memuat opsi nama group. Group list: search dan tabel Group name, Total task, Payroll period; kosong.\n- **Time Tracker:** input aktivitas, Select task, timer, Start timer, Manual time entry. Form manual berisi What are you working on?, Task, Start time, End time, Submit/Cancel. Timer tidak dijalankan dan form manual dibatalkan.\n- **Activities:** pilih employee, rentang minggu, navigasi minggu, Export XLS; grid Senin–Minggu dan total waktu. Tidak ada entri.\n- **Summary:** Group by project, rentang tanggal, Export XLS; tabel Project/Duration. Tidak ada ringkasan.\n- **Tracker Report:** filter Employee, Branch, Organization, Job level, Project, Task, Approval status; periode, Export, Search dan tautan Timesheet setting. Tidak ada report.\n- **Settings → Timesheet:** tab Employees/Setting, filter, Search, Help, Create Setting; daftar tanpa employee/setting. Form Create setting: Setting name (maks.30), Set reminder time track (toggle dengan Time dan Repeat every), Enable time tracker on live attendance, Enable shift selection, Enable location selection, Add employee to policy, Cancel/Save. Toggle, reminder, dan assignment tidak diaktifkan.",
    "verified": true
  },
  {
    "id": "productivity-forms-surveys",
    "group": "Productivity",
    "name": "Forms & surveys",
    "columns": [
      "Form name",
      "Status",
      "Submissions",
      "Close date"
    ],
    "fields": [
      "Form name!",
      "Description",
      "Submission need approval?",
      "Select all employees?",
      "Reminder date",
      "Remind before",
      "Schedule close form",
      "Daily summary?",
      "Instant email?",
      "Auto assign new employee?",
      "Auto assign transfer?",
      "Only allow 1 submission?"
    ],
    "filters": [
      "Status"
    ],
    "tabs": [],
    "action": "Create form",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "productivity-my-submissions",
    "group": "Productivity",
    "name": "My submissions",
    "columns": [
      "Date",
      "Form name",
      "Status"
    ],
    "fields": [],
    "filters": [
      "Status",
      "Date"
    ],
    "tabs": [],
    "action": "",
    "notes": "- **My submissions:** filter status (All status, Pending, Submitted, Approved, Rejected, Draft), date, search; kolom Date, Form name, Status; rows-per-page/pagination. Tidak ada submission.\n- **Create form builder:** Basic information (Form name, Description maks.250; Submission need approval hanya tersedia di Form+); Customize form (label, deskripsi opsional, Required, tambah/duplikasi/hapus field); jenis input Text, Number, Email, Amount, Option, Checkboxes, Linear scale, Date, Phone number, Long text, File upload, Employee. Option/Checkbox dapat menambah pilihan dan Others; Linear scale memakai rentang serta label. File upload dan approval menampilkan batasan paket.\n- **Set employee:** Select employee/Select all employees; Set reminder (Date, Remind before/day); Schedule close form (Date); notifikasi email (Daily summary/Instant); auto-assign ke employee baru/transfer/keduanya; Only allow 1 submission per employee. Draft QA dengan teks sintetis dibatalkan dan toggle dikembalikan; tidak ada form atau email tersimpan.",
    "verified": true
  },
  {
    "id": "productivity-document-template",
    "group": "Productivity",
    "name": "Document Template",
    "columns": [
      "Template name",
      "Description",
      "Category"
    ],
    "fields": [
      "Template name!",
      "Description",
      "Category",
      "Document number",
      "Header",
      "Body",
      "Footer",
      "Shortcode",
      "Auto employee-file sync?",
      "Sync on signature?",
      "Attachment"
    ],
    "filters": [],
    "tabs": [
      "New",
      "Upload"
    ],
    "action": "Create template",
    "notes": "- **Assets list:** filter kategori, kontrol kolom, export, clipboard/report control, Search asset/employee, Import assets, Add asset; KPI Total/Assigned/Unassigned assets; kolom Asset name, Category name, Asset number, Assigned employee, Last modified. Kosong. Form Add asset: Asset name dan Asset number (maks.60), Description (maks.200), Asset category wajib/Create asset category, Attachment (PDF/JPG/PNG/JPEG/DOCX/DOC/ZIP maks.10 MB), Purchase date/price, opsi Assign asset to employee dengan Employee dan Assigned date. Draft dibatalkan.\n- **Assigned assets:** Import, Assign asset, filter kategori, export, search; tabel Asset name, Assigned employee, Asset category, Asset number, Assigned date. Kosong.\n- **Asset category:** Import, Add category, export, Search; tabel Asset category, Total asset, Total assigned asset, Total unassigned asset. Kosong. Add category meminta Category name; modal dibatalkan.\n- **Announcements:** filter kategori, Search, Help, Create announcement; daftar kosong. Form meminta title, rich-text body, publish ke semua karyawan atau berdasarkan criteria, Category, Forms, Attachment (format office/PDF/gambar, maks.10 MB), opsi email, Cancel/Save & publish. Draft kosong dibatalkan; tidak ada pengumuman dikirim.\n- **User Activity Log:** date range, All email, All type, Apply filter, Export, Search; kolom Date, Email, Activity, Type. Satu baris ada; nilai record tidak disalin dan ekspor tidak dijalankan.\n- **Queue activity:** Search, Refresh, Help/Learn more; kolom Queue ID, Activity, Executed by, Submitted time, Started time, Status. Kosong.\n- **Notification:** Start/End date, Status (Cancel/Completed/Need Action/Skipped), Type (Bank Account Invalid/Employee Transfer/Reminder/Resign), Apply, Export, Search, pagination; kolom Type, Description, Effective Date, Payroll Name, Payroll Month, Created By, Created Date, Status, Action. Kosong; bulk Skip all tidak dijalankan.\n- **Company files:** tabs Company files/Employee files/Other files. Company files: New company files/Search, kolom Folder name, Shared to, Accessible from, Last modified by; Add folder mencakup Name (maks.60), Description (maks.200), Accessible on date, criteria semua/selected (Branch, Organization, Job position, Job level, Employment status, SBU, Employees), upload files, email/reminder. Employee files: categories All/Identity/Other, filters All employees/All job positions, Search, Employee files report, Add file/Add employee files; kategori berisi satu input, file meminta employee+attachment, bulk upload mendukung folder per karyawan. File types termasuk PDF/gambar/Office/CSV/TXT/ZIP/RAR, batas 10 MB per file dan 100 file/1 GB per aksi upload. Other files: Search, Delete, tabel File Name, Type File, Uploader, Date Created. Semua daftar kosong; draft nama/description/kategori dibatalkan; tidak ada file diunggah/dihapus.\n- **Onboarding:** tab On Progress/Completed; Select Month Period, Select Year Period, jumlah baris; tidak ada hasil.\n- **Report Builder:** dashboard Create report/Guidebook/Insight. Draft laporan meminta Name (maks.28), Description (maks.120), type Latest update/Daily/Monthly; kategori field berbeda tiap tipe (Latest update: Personal, Payroll Information, Employment, Education; Daily menambah Attendance dan request; Monthly menambah Payroll Transaction, Tax Detail, Monthly Attendance). Search/Select all/Clear all/pilihan fields/Add filter to selected, format XLSX/CSV, schedule (Latest update: Not scheduled/Daily). Draft filter/report dibatalkan; tidak ada data diekspor.\n- **Document Template:** Generated documents dan Create template (New/Upload), Search. New template mencakup Template name/description/category (General, Employee Transfer, Overtime Request, Onboarding, Offboarding, Reprimand, Resignation), layout dokumen, pilihan shortcode, auto employee-file sync dan sync saat signature, document number, header/footer, rich-text/shortcode/import document. Upload template meminta name (maks.30), description, category, numbering manual atau auto-generated, stamp metadata, file .doc/.docx maks.5 MB, shortcode dan sync. Draft dibatalkan tanpa upload.\n- **Generated documents:** filter month/template/employee, status employee-file (All/Not synced/Synced/File deleted), status dokumen (Active/Revoked), status Mekari Sign; KPI total/not sent/awaiting/partial/signed; export/search; kolom Transaction ID, Exported date, Employee name, Template name, Document number, Exported by, Employee files, Mekari Sign, Document status, Source. Tidak ada record; ekspor tidak dilakukan.",
    "verified": true
  },
  {
    "id": "productivity-generated-documents",
    "group": "Productivity",
    "name": "Generated documents",
    "columns": [
      "Transaction ID",
      "Exported date",
      "Employee name",
      "Template name",
      "Document number",
      "Exported by",
      "Employee files",
      "Mekari Sign",
      "Document status",
      "Source"
    ],
    "fields": [],
    "filters": [
      "Month",
      "Template",
      "Employee",
      "Employee-file status",
      "Document status",
      "Mekari Sign"
    ],
    "tabs": [],
    "action": "Export",
    "notes": "- **Assets list:** filter kategori, kontrol kolom, export, clipboard/report control, Search asset/employee, Import assets, Add asset; KPI Total/Assigned/Unassigned assets; kolom Asset name, Category name, Asset number, Assigned employee, Last modified. Kosong. Form Add asset: Asset name dan Asset number (maks.60), Description (maks.200), Asset category wajib/Create asset category, Attachment (PDF/JPG/PNG/JPEG/DOCX/DOC/ZIP maks.10 MB), Purchase date/price, opsi Assign asset to employee dengan Employee dan Assigned date. Draft dibatalkan.\n- **Assigned assets:** Import, Assign asset, filter kategori, export, search; tabel Asset name, Assigned employee, Asset category, Asset number, Assigned date. Kosong.\n- **Asset category:** Import, Add category, export, Search; tabel Asset category, Total asset, Total assigned asset, Total unassigned asset. Kosong. Add category meminta Category name; modal dibatalkan.\n- **Announcements:** filter kategori, Search, Help, Create announcement; daftar kosong. Form meminta title, rich-text body, publish ke semua karyawan atau berdasarkan criteria, Category, Forms, Attachment (format office/PDF/gambar, maks.10 MB), opsi email, Cancel/Save & publish. Draft kosong dibatalkan; tidak ada pengumuman dikirim.\n- **User Activity Log:** date range, All email, All type, Apply filter, Export, Search; kolom Date, Email, Activity, Type. Satu baris ada; nilai record tidak disalin dan ekspor tidak dijalankan.\n- **Queue activity:** Search, Refresh, Help/Learn more; kolom Queue ID, Activity, Executed by, Submitted time, Started time, Status. Kosong.\n- **Notification:** Start/End date, Status (Cancel/Completed/Need Action/Skipped), Type (Bank Account Invalid/Employee Transfer/Reminder/Resign), Apply, Export, Search, pagination; kolom Type, Description, Effective Date, Payroll Name, Payroll Month, Created By, Created Date, Status, Action. Kosong; bulk Skip all tidak dijalankan.\n- **Company files:** tabs Company files/Employee files/Other files. Company files: New company files/Search, kolom Folder name, Shared to, Accessible from, Last modified by; Add folder mencakup Name (maks.60), Description (maks.200), Accessible on date, criteria semua/selected (Branch, Organization, Job position, Job level, Employment status, SBU, Employees), upload files, email/reminder. Employee files: categories All/Identity/Other, filters All employees/All job positions, Search, Employee files report, Add file/Add employee files; kategori berisi satu input, file meminta employee+attachment, bulk upload mendukung folder per karyawan. File types termasuk PDF/gambar/Office/CSV/TXT/ZIP/RAR, batas 10 MB per file dan 100 file/1 GB per aksi upload. Other files: Search, Delete, tabel File Name, Type File, Uploader, Date Created. Semua daftar kosong; draft nama/description/kategori dibatalkan; tidak ada file diunggah/dihapus.\n- **Onboarding:** tab On Progress/Completed; Select Month Period, Select Year Period, jumlah baris; tidak ada hasil.\n- **Report Builder:** dashboard Create report/Guidebook/Insight. Draft laporan meminta Name (maks.28), Description (maks.120), type Latest update/Daily/Monthly; kategori field berbeda tiap tipe (Latest update: Personal, Payroll Information, Employment, Education; Daily menambah Attendance dan request; Monthly menambah Payroll Transaction, Tax Detail, Monthly Attendance). Search/Select all/Clear all/pilihan fields/Add filter to selected, format XLSX/CSV, schedule (Latest update: Not scheduled/Daily). Draft filter/report dibatalkan; tidak ada data diekspor.\n- **Document Template:** Generated documents dan Create template (New/Upload), Search. New template mencakup Template name/description/category (General, Employee Transfer, Overtime Request, Onboarding, Offboarding, Reprimand, Resignation), layout dokumen, pilihan shortcode, auto employee-file sync dan sync saat signature, document number, header/footer, rich-text/shortcode/import document. Upload template meminta name (maks.30), description, category, numbering manual atau auto-generated, stamp metadata, file .doc/.docx maks.5 MB, shortcode dan sync. Draft dibatalkan tanpa upload.\n- **Generated documents:** filter month/template/employee, status employee-file (All/Not synced/Synced/File deleted), status dokumen (Active/Revoked), status Mekari Sign; KPI total/not sent/awaiting/partial/signed; export/search; kolom Transaction ID, Exported date, Employee name, Template name, Document number, Exported by, Employee files, Mekari Sign, Document status, Source. Tidak ada record; ekspor tidak dilakukan.",
    "verified": true
  },
  {
    "id": "company-assets-list",
    "group": "Company",
    "name": "Assets list",
    "columns": [
      "Asset name",
      "Category name",
      "Asset number",
      "Assigned employee",
      "Last modified"
    ],
    "fields": [
      "Asset name!",
      "Asset number!",
      "Description",
      "Asset category!",
      "Attachment",
      "Purchase date",
      "Purchase price",
      "Assign asset to employee?",
      "Employee",
      "Assigned date"
    ],
    "filters": [
      "Category"
    ],
    "tabs": [],
    "action": "Add asset",
    "notes": "- **Assets list:** filter kategori, kontrol kolom, export, clipboard/report control, Search asset/employee, Import assets, Add asset; KPI Total/Assigned/Unassigned assets; kolom Asset name, Category name, Asset number, Assigned employee, Last modified. Kosong. Form Add asset: Asset name dan Asset number (maks.60), Description (maks.200), Asset category wajib/Create asset category, Attachment (PDF/JPG/PNG/JPEG/DOCX/DOC/ZIP maks.10 MB), Purchase date/price, opsi Assign asset to employee dengan Employee dan Assigned date. Draft dibatalkan.\n- **Assigned assets:** Import, Assign asset, filter kategori, export, search; tabel Asset name, Assigned employee, Asset category, Asset number, Assigned date. Kosong.\n- **Asset category:** Import, Add category, export, Search; tabel Asset category, Total asset, Total assigned asset, Total unassigned asset. Kosong. Add category meminta Category name; modal dibatalkan.\n- **Announcements:** filter kategori, Search, Help, Create announcement; daftar kosong. Form meminta title, rich-text body, publish ke semua karyawan atau berdasarkan criteria, Category, Forms, Attachment (format office/PDF/gambar, maks.10 MB), opsi email, Cancel/Save & publish. Draft kosong dibatalkan; tidak ada pengumuman dikirim.\n- **User Activity Log:** date range, All email, All type, Apply filter, Export, Search; kolom Date, Email, Activity, Type. Satu baris ada; nilai record tidak disalin dan ekspor tidak dijalankan.\n- **Queue activity:** Search, Refresh, Help/Learn more; kolom Queue ID, Activity, Executed by, Submitted time, Started time, Status. Kosong.\n- **Notification:** Start/End date, Status (Cancel/Completed/Need Action/Skipped), Type (Bank Account Invalid/Employee Transfer/Reminder/Resign), Apply, Export, Search, pagination; kolom Type, Description, Effective Date, Payroll Name, Payroll Month, Created By, Created Date, Status, Action. Kosong; bulk Skip all tidak dijalankan.\n- **Company files:** tabs Company files/Employee files/Other files. Company files: New company files/Search, kolom Folder name, Shared to, Accessible from, Last modified by; Add folder mencakup Name (maks.60), Description (maks.200), Accessible on date, criteria semua/selected (Branch, Organization, Job position, Job level, Employment status, SBU, Employees), upload files, email/reminder. Employee files: categories All/Identity/Other, filters All employees/All job positions, Search, Employee files report, Add file/Add employee files; kategori berisi satu input, file meminta employee+attachment, bulk upload mendukung folder per karyawan. File types termasuk PDF/gambar/Office/CSV/TXT/ZIP/RAR, batas 10 MB per file dan 100 file/1 GB per aksi upload. Other files: Search, Delete, tabel File Name, Type File, Uploader, Date Created. Semua daftar kosong; draft nama/description/kategori dibatalkan; tidak ada file diunggah/dihapus.\n- **Onboarding:** tab On Progress/Completed; Select Month Period, Select Year Period, jumlah baris; tidak ada hasil.\n- **Report Builder:** dashboard Create report/Guidebook/Insight. Draft laporan meminta Name (maks.28), Description (maks.120), type Latest update/Daily/Monthly; kategori field berbeda tiap tipe (Latest update: Personal, Payroll Information, Employment, Education; Daily menambah Attendance dan request; Monthly menambah Payroll Transaction, Tax Detail, Monthly Attendance). Search/Select all/Clear all/pilihan fields/Add filter to selected, format XLSX/CSV, schedule (Latest update: Not scheduled/Daily). Draft filter/report dibatalkan; tidak ada data diekspor.\n- **Document Template:** Generated documents dan Create template (New/Upload), Search. New template mencakup Template name/description/category (General, Employee Transfer, Overtime Request, Onboarding, Offboarding, Reprimand, Resignation), layout dokumen, pilihan shortcode, auto employee-file sync dan sync saat signature, document number, header/footer, rich-text/shortcode/import document. Upload template meminta name (maks.30), description, category, numbering manual atau auto-generated, stamp metadata, file .doc/.docx maks.5 MB, shortcode dan sync. Draft dibatalkan tanpa upload.\n- **Generated documents:** filter month/template/employee, status employee-file (All/Not synced/Synced/File deleted), status dokumen (Active/Revoked), status Mekari Sign; KPI total/not sent/awaiting/partial/signed; export/search; kolom Transaction ID, Exported date, Employee name, Template name, Document number, Exported by, Employee files, Mekari Sign, Document status, Source. Tidak ada record; ekspor tidak dilakukan.",
    "verified": true
  },
  {
    "id": "company-assigned-assets",
    "group": "Company",
    "name": "Assigned assets",
    "columns": [
      "Asset name",
      "Assigned employee",
      "Asset category",
      "Asset number",
      "Assigned date"
    ],
    "fields": [
      "Asset name!",
      "Employee!",
      "Assigned date!"
    ],
    "filters": [
      "Category"
    ],
    "tabs": [],
    "action": "Assign asset",
    "notes": "- **Assets list:** filter kategori, kontrol kolom, export, clipboard/report control, Search asset/employee, Import assets, Add asset; KPI Total/Assigned/Unassigned assets; kolom Asset name, Category name, Asset number, Assigned employee, Last modified. Kosong. Form Add asset: Asset name dan Asset number (maks.60), Description (maks.200), Asset category wajib/Create asset category, Attachment (PDF/JPG/PNG/JPEG/DOCX/DOC/ZIP maks.10 MB), Purchase date/price, opsi Assign asset to employee dengan Employee dan Assigned date. Draft dibatalkan.\n- **Assigned assets:** Import, Assign asset, filter kategori, export, search; tabel Asset name, Assigned employee, Asset category, Asset number, Assigned date. Kosong.\n- **Asset category:** Import, Add category, export, Search; tabel Asset category, Total asset, Total assigned asset, Total unassigned asset. Kosong. Add category meminta Category name; modal dibatalkan.\n- **Announcements:** filter kategori, Search, Help, Create announcement; daftar kosong. Form meminta title, rich-text body, publish ke semua karyawan atau berdasarkan criteria, Category, Forms, Attachment (format office/PDF/gambar, maks.10 MB), opsi email, Cancel/Save & publish. Draft kosong dibatalkan; tidak ada pengumuman dikirim.\n- **User Activity Log:** date range, All email, All type, Apply filter, Export, Search; kolom Date, Email, Activity, Type. Satu baris ada; nilai record tidak disalin dan ekspor tidak dijalankan.\n- **Queue activity:** Search, Refresh, Help/Learn more; kolom Queue ID, Activity, Executed by, Submitted time, Started time, Status. Kosong.\n- **Notification:** Start/End date, Status (Cancel/Completed/Need Action/Skipped), Type (Bank Account Invalid/Employee Transfer/Reminder/Resign), Apply, Export, Search, pagination; kolom Type, Description, Effective Date, Payroll Name, Payroll Month, Created By, Created Date, Status, Action. Kosong; bulk Skip all tidak dijalankan.\n- **Company files:** tabs Company files/Employee files/Other files. Company files: New company files/Search, kolom Folder name, Shared to, Accessible from, Last modified by; Add folder mencakup Name (maks.60), Description (maks.200), Accessible on date, criteria semua/selected (Branch, Organization, Job position, Job level, Employment status, SBU, Employees), upload files, email/reminder. Employee files: categories All/Identity/Other, filters All employees/All job positions, Search, Employee files report, Add file/Add employee files; kategori berisi satu input, file meminta employee+attachment, bulk upload mendukung folder per karyawan. File types termasuk PDF/gambar/Office/CSV/TXT/ZIP/RAR, batas 10 MB per file dan 100 file/1 GB per aksi upload. Other files: Search, Delete, tabel File Name, Type File, Uploader, Date Created. Semua daftar kosong; draft nama/description/kategori dibatalkan; tidak ada file diunggah/dihapus.\n- **Onboarding:** tab On Progress/Completed; Select Month Period, Select Year Period, jumlah baris; tidak ada hasil.\n- **Report Builder:** dashboard Create report/Guidebook/Insight. Draft laporan meminta Name (maks.28), Description (maks.120), type Latest update/Daily/Monthly; kategori field berbeda tiap tipe (Latest update: Personal, Payroll Information, Employment, Education; Daily menambah Attendance dan request; Monthly menambah Payroll Transaction, Tax Detail, Monthly Attendance). Search/Select all/Clear all/pilihan fields/Add filter to selected, format XLSX/CSV, schedule (Latest update: Not scheduled/Daily). Draft filter/report dibatalkan; tidak ada data diekspor.\n- **Document Template:** Generated documents dan Create template (New/Upload), Search. New template mencakup Template name/description/category (General, Employee Transfer, Overtime Request, Onboarding, Offboarding, Reprimand, Resignation), layout dokumen, pilihan shortcode, auto employee-file sync dan sync saat signature, document number, header/footer, rich-text/shortcode/import document. Upload template meminta name (maks.30), description, category, numbering manual atau auto-generated, stamp metadata, file .doc/.docx maks.5 MB, shortcode dan sync. Draft dibatalkan tanpa upload.\n- **Generated documents:** filter month/template/employee, status employee-file (All/Not synced/Synced/File deleted), status dokumen (Active/Revoked), status Mekari Sign; KPI total/not sent/awaiting/partial/signed; export/search; kolom Transaction ID, Exported date, Employee name, Template name, Document number, Exported by, Employee files, Mekari Sign, Document status, Source. Tidak ada record; ekspor tidak dilakukan.",
    "verified": true
  },
  {
    "id": "company-asset-category",
    "group": "Company",
    "name": "Asset category",
    "columns": [
      "Asset category",
      "Total asset",
      "Total assigned asset",
      "Total unassigned asset"
    ],
    "fields": [
      "Category name!"
    ],
    "filters": [],
    "tabs": [],
    "action": "Add category",
    "notes": "- **Assets list:** filter kategori, kontrol kolom, export, clipboard/report control, Search asset/employee, Import assets, Add asset; KPI Total/Assigned/Unassigned assets; kolom Asset name, Category name, Asset number, Assigned employee, Last modified. Kosong. Form Add asset: Asset name dan Asset number (maks.60), Description (maks.200), Asset category wajib/Create asset category, Attachment (PDF/JPG/PNG/JPEG/DOCX/DOC/ZIP maks.10 MB), Purchase date/price, opsi Assign asset to employee dengan Employee dan Assigned date. Draft dibatalkan.\n- **Assigned assets:** Import, Assign asset, filter kategori, export, search; tabel Asset name, Assigned employee, Asset category, Asset number, Assigned date. Kosong.\n- **Asset category:** Import, Add category, export, Search; tabel Asset category, Total asset, Total assigned asset, Total unassigned asset. Kosong. Add category meminta Category name; modal dibatalkan.\n- **Announcements:** filter kategori, Search, Help, Create announcement; daftar kosong. Form meminta title, rich-text body, publish ke semua karyawan atau berdasarkan criteria, Category, Forms, Attachment (format office/PDF/gambar, maks.10 MB), opsi email, Cancel/Save & publish. Draft kosong dibatalkan; tidak ada pengumuman dikirim.\n- **User Activity Log:** date range, All email, All type, Apply filter, Export, Search; kolom Date, Email, Activity, Type. Satu baris ada; nilai record tidak disalin dan ekspor tidak dijalankan.\n- **Queue activity:** Search, Refresh, Help/Learn more; kolom Queue ID, Activity, Executed by, Submitted time, Started time, Status. Kosong.\n- **Notification:** Start/End date, Status (Cancel/Completed/Need Action/Skipped), Type (Bank Account Invalid/Employee Transfer/Reminder/Resign), Apply, Export, Search, pagination; kolom Type, Description, Effective Date, Payroll Name, Payroll Month, Created By, Created Date, Status, Action. Kosong; bulk Skip all tidak dijalankan.\n- **Company files:** tabs Company files/Employee files/Other files. Company files: New company files/Search, kolom Folder name, Shared to, Accessible from, Last modified by; Add folder mencakup Name (maks.60), Description (maks.200), Accessible on date, criteria semua/selected (Branch, Organization, Job position, Job level, Employment status, SBU, Employees), upload files, email/reminder. Employee files: categories All/Identity/Other, filters All employees/All job positions, Search, Employee files report, Add file/Add employee files; kategori berisi satu input, file meminta employee+attachment, bulk upload mendukung folder per karyawan. File types termasuk PDF/gambar/Office/CSV/TXT/ZIP/RAR, batas 10 MB per file dan 100 file/1 GB per aksi upload. Other files: Search, Delete, tabel File Name, Type File, Uploader, Date Created. Semua daftar kosong; draft nama/description/kategori dibatalkan; tidak ada file diunggah/dihapus.\n- **Onboarding:** tab On Progress/Completed; Select Month Period, Select Year Period, jumlah baris; tidak ada hasil.\n- **Report Builder:** dashboard Create report/Guidebook/Insight. Draft laporan meminta Name (maks.28), Description (maks.120), type Latest update/Daily/Monthly; kategori field berbeda tiap tipe (Latest update: Personal, Payroll Information, Employment, Education; Daily menambah Attendance dan request; Monthly menambah Payroll Transaction, Tax Detail, Monthly Attendance). Search/Select all/Clear all/pilihan fields/Add filter to selected, format XLSX/CSV, schedule (Latest update: Not scheduled/Daily). Draft filter/report dibatalkan; tidak ada data diekspor.\n- **Document Template:** Generated documents dan Create template (New/Upload), Search. New template mencakup Template name/description/category (General, Employee Transfer, Overtime Request, Onboarding, Offboarding, Reprimand, Resignation), layout dokumen, pilihan shortcode, auto employee-file sync dan sync saat signature, document number, header/footer, rich-text/shortcode/import document. Upload template meminta name (maks.30), description, category, numbering manual atau auto-generated, stamp metadata, file .doc/.docx maks.5 MB, shortcode dan sync. Draft dibatalkan tanpa upload.\n- **Generated documents:** filter month/template/employee, status employee-file (All/Not synced/Synced/File deleted), status dokumen (Active/Revoked), status Mekari Sign; KPI total/not sent/awaiting/partial/signed; export/search; kolom Transaction ID, Exported date, Employee name, Template name, Document number, Exported by, Employee files, Mekari Sign, Document status, Source. Tidak ada record; ekspor tidak dilakukan.",
    "verified": true
  },
  {
    "id": "company-announcements",
    "group": "Company",
    "name": "Announcements",
    "columns": [
      "Title",
      "Category",
      "Publish date",
      "Status"
    ],
    "fields": [
      "Title!",
      "Body!",
      "All employees?",
      "Criteria",
      "Category",
      "Forms",
      "Attachment",
      "Send email?"
    ],
    "filters": [
      "Category"
    ],
    "tabs": [],
    "action": "Create announcement",
    "notes": "- **Assets list:** filter kategori, kontrol kolom, export, clipboard/report control, Search asset/employee, Import assets, Add asset; KPI Total/Assigned/Unassigned assets; kolom Asset name, Category name, Asset number, Assigned employee, Last modified. Kosong. Form Add asset: Asset name dan Asset number (maks.60), Description (maks.200), Asset category wajib/Create asset category, Attachment (PDF/JPG/PNG/JPEG/DOCX/DOC/ZIP maks.10 MB), Purchase date/price, opsi Assign asset to employee dengan Employee dan Assigned date. Draft dibatalkan.\n- **Assigned assets:** Import, Assign asset, filter kategori, export, search; tabel Asset name, Assigned employee, Asset category, Asset number, Assigned date. Kosong.\n- **Asset category:** Import, Add category, export, Search; tabel Asset category, Total asset, Total assigned asset, Total unassigned asset. Kosong. Add category meminta Category name; modal dibatalkan.\n- **Announcements:** filter kategori, Search, Help, Create announcement; daftar kosong. Form meminta title, rich-text body, publish ke semua karyawan atau berdasarkan criteria, Category, Forms, Attachment (format office/PDF/gambar, maks.10 MB), opsi email, Cancel/Save & publish. Draft kosong dibatalkan; tidak ada pengumuman dikirim.\n- **User Activity Log:** date range, All email, All type, Apply filter, Export, Search; kolom Date, Email, Activity, Type. Satu baris ada; nilai record tidak disalin dan ekspor tidak dijalankan.\n- **Queue activity:** Search, Refresh, Help/Learn more; kolom Queue ID, Activity, Executed by, Submitted time, Started time, Status. Kosong.\n- **Notification:** Start/End date, Status (Cancel/Completed/Need Action/Skipped), Type (Bank Account Invalid/Employee Transfer/Reminder/Resign), Apply, Export, Search, pagination; kolom Type, Description, Effective Date, Payroll Name, Payroll Month, Created By, Created Date, Status, Action. Kosong; bulk Skip all tidak dijalankan.\n- **Company files:** tabs Company files/Employee files/Other files. Company files: New company files/Search, kolom Folder name, Shared to, Accessible from, Last modified by; Add folder mencakup Name (maks.60), Description (maks.200), Accessible on date, criteria semua/selected (Branch, Organization, Job position, Job level, Employment status, SBU, Employees), upload files, email/reminder. Employee files: categories All/Identity/Other, filters All employees/All job positions, Search, Employee files report, Add file/Add employee files; kategori berisi satu input, file meminta employee+attachment, bulk upload mendukung folder per karyawan. File types termasuk PDF/gambar/Office/CSV/TXT/ZIP/RAR, batas 10 MB per file dan 100 file/1 GB per aksi upload. Other files: Search, Delete, tabel File Name, Type File, Uploader, Date Created. Semua daftar kosong; draft nama/description/kategori dibatalkan; tidak ada file diunggah/dihapus.\n- **Onboarding:** tab On Progress/Completed; Select Month Period, Select Year Period, jumlah baris; tidak ada hasil.\n- **Report Builder:** dashboard Create report/Guidebook/Insight. Draft laporan meminta Name (maks.28), Description (maks.120), type Latest update/Daily/Monthly; kategori field berbeda tiap tipe (Latest update: Personal, Payroll Information, Employment, Education; Daily menambah Attendance dan request; Monthly menambah Payroll Transaction, Tax Detail, Monthly Attendance). Search/Select all/Clear all/pilihan fields/Add filter to selected, format XLSX/CSV, schedule (Latest update: Not scheduled/Daily). Draft filter/report dibatalkan; tidak ada data diekspor.\n- **Document Template:** Generated documents dan Create template (New/Upload), Search. New template mencakup Template name/description/category (General, Employee Transfer, Overtime Request, Onboarding, Offboarding, Reprimand, Resignation), layout dokumen, pilihan shortcode, auto employee-file sync dan sync saat signature, document number, header/footer, rich-text/shortcode/import document. Upload template meminta name (maks.30), description, category, numbering manual atau auto-generated, stamp metadata, file .doc/.docx maks.5 MB, shortcode dan sync. Draft dibatalkan tanpa upload.\n- **Generated documents:** filter month/template/employee, status employee-file (All/Not synced/Synced/File deleted), status dokumen (Active/Revoked), status Mekari Sign; KPI total/not sent/awaiting/partial/signed; export/search; kolom Transaction ID, Exported date, Employee name, Template name, Document number, Exported by, Employee files, Mekari Sign, Document status, Source. Tidak ada record; ekspor tidak dilakukan.",
    "verified": true
  },
  {
    "id": "company-user-activity-log",
    "group": "Company",
    "name": "User Activity Log",
    "columns": [
      "Date",
      "Email",
      "Activity",
      "Type"
    ],
    "fields": [],
    "filters": [
      "Date range",
      "Email",
      "Type"
    ],
    "tabs": [],
    "action": "Export",
    "notes": "- **Assets list:** filter kategori, kontrol kolom, export, clipboard/report control, Search asset/employee, Import assets, Add asset; KPI Total/Assigned/Unassigned assets; kolom Asset name, Category name, Asset number, Assigned employee, Last modified. Kosong. Form Add asset: Asset name dan Asset number (maks.60), Description (maks.200), Asset category wajib/Create asset category, Attachment (PDF/JPG/PNG/JPEG/DOCX/DOC/ZIP maks.10 MB), Purchase date/price, opsi Assign asset to employee dengan Employee dan Assigned date. Draft dibatalkan.\n- **Assigned assets:** Import, Assign asset, filter kategori, export, search; tabel Asset name, Assigned employee, Asset category, Asset number, Assigned date. Kosong.\n- **Asset category:** Import, Add category, export, Search; tabel Asset category, Total asset, Total assigned asset, Total unassigned asset. Kosong. Add category meminta Category name; modal dibatalkan.\n- **Announcements:** filter kategori, Search, Help, Create announcement; daftar kosong. Form meminta title, rich-text body, publish ke semua karyawan atau berdasarkan criteria, Category, Forms, Attachment (format office/PDF/gambar, maks.10 MB), opsi email, Cancel/Save & publish. Draft kosong dibatalkan; tidak ada pengumuman dikirim.\n- **User Activity Log:** date range, All email, All type, Apply filter, Export, Search; kolom Date, Email, Activity, Type. Satu baris ada; nilai record tidak disalin dan ekspor tidak dijalankan.\n- **Queue activity:** Search, Refresh, Help/Learn more; kolom Queue ID, Activity, Executed by, Submitted time, Started time, Status. Kosong.\n- **Notification:** Start/End date, Status (Cancel/Completed/Need Action/Skipped), Type (Bank Account Invalid/Employee Transfer/Reminder/Resign), Apply, Export, Search, pagination; kolom Type, Description, Effective Date, Payroll Name, Payroll Month, Created By, Created Date, Status, Action. Kosong; bulk Skip all tidak dijalankan.\n- **Company files:** tabs Company files/Employee files/Other files. Company files: New company files/Search, kolom Folder name, Shared to, Accessible from, Last modified by; Add folder mencakup Name (maks.60), Description (maks.200), Accessible on date, criteria semua/selected (Branch, Organization, Job position, Job level, Employment status, SBU, Employees), upload files, email/reminder. Employee files: categories All/Identity/Other, filters All employees/All job positions, Search, Employee files report, Add file/Add employee files; kategori berisi satu input, file meminta employee+attachment, bulk upload mendukung folder per karyawan. File types termasuk PDF/gambar/Office/CSV/TXT/ZIP/RAR, batas 10 MB per file dan 100 file/1 GB per aksi upload. Other files: Search, Delete, tabel File Name, Type File, Uploader, Date Created. Semua daftar kosong; draft nama/description/kategori dibatalkan; tidak ada file diunggah/dihapus.\n- **Onboarding:** tab On Progress/Completed; Select Month Period, Select Year Period, jumlah baris; tidak ada hasil.\n- **Report Builder:** dashboard Create report/Guidebook/Insight. Draft laporan meminta Name (maks.28), Description (maks.120), type Latest update/Daily/Monthly; kategori field berbeda tiap tipe (Latest update: Personal, Payroll Information, Employment, Education; Daily menambah Attendance dan request; Monthly menambah Payroll Transaction, Tax Detail, Monthly Attendance). Search/Select all/Clear all/pilihan fields/Add filter to selected, format XLSX/CSV, schedule (Latest update: Not scheduled/Daily). Draft filter/report dibatalkan; tidak ada data diekspor.\n- **Document Template:** Generated documents dan Create template (New/Upload), Search. New template mencakup Template name/description/category (General, Employee Transfer, Overtime Request, Onboarding, Offboarding, Reprimand, Resignation), layout dokumen, pilihan shortcode, auto employee-file sync dan sync saat signature, document number, header/footer, rich-text/shortcode/import document. Upload template meminta name (maks.30), description, category, numbering manual atau auto-generated, stamp metadata, file .doc/.docx maks.5 MB, shortcode dan sync. Draft dibatalkan tanpa upload.\n- **Generated documents:** filter month/template/employee, status employee-file (All/Not synced/Synced/File deleted), status dokumen (Active/Revoked), status Mekari Sign; KPI total/not sent/awaiting/partial/signed; export/search; kolom Transaction ID, Exported date, Employee name, Template name, Document number, Exported by, Employee files, Mekari Sign, Document status, Source. Tidak ada record; ekspor tidak dilakukan.",
    "verified": true
  },
  {
    "id": "company-queue-activity",
    "group": "Company",
    "name": "Queue activity",
    "columns": [
      "Queue ID",
      "Activity",
      "Executed by",
      "Submitted time",
      "Started time",
      "Status"
    ],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "Refresh",
    "notes": "- **Assets list:** filter kategori, kontrol kolom, export, clipboard/report control, Search asset/employee, Import assets, Add asset; KPI Total/Assigned/Unassigned assets; kolom Asset name, Category name, Asset number, Assigned employee, Last modified. Kosong. Form Add asset: Asset name dan Asset number (maks.60), Description (maks.200), Asset category wajib/Create asset category, Attachment (PDF/JPG/PNG/JPEG/DOCX/DOC/ZIP maks.10 MB), Purchase date/price, opsi Assign asset to employee dengan Employee dan Assigned date. Draft dibatalkan.\n- **Assigned assets:** Import, Assign asset, filter kategori, export, search; tabel Asset name, Assigned employee, Asset category, Asset number, Assigned date. Kosong.\n- **Asset category:** Import, Add category, export, Search; tabel Asset category, Total asset, Total assigned asset, Total unassigned asset. Kosong. Add category meminta Category name; modal dibatalkan.\n- **Announcements:** filter kategori, Search, Help, Create announcement; daftar kosong. Form meminta title, rich-text body, publish ke semua karyawan atau berdasarkan criteria, Category, Forms, Attachment (format office/PDF/gambar, maks.10 MB), opsi email, Cancel/Save & publish. Draft kosong dibatalkan; tidak ada pengumuman dikirim.\n- **User Activity Log:** date range, All email, All type, Apply filter, Export, Search; kolom Date, Email, Activity, Type. Satu baris ada; nilai record tidak disalin dan ekspor tidak dijalankan.\n- **Queue activity:** Search, Refresh, Help/Learn more; kolom Queue ID, Activity, Executed by, Submitted time, Started time, Status. Kosong.\n- **Notification:** Start/End date, Status (Cancel/Completed/Need Action/Skipped), Type (Bank Account Invalid/Employee Transfer/Reminder/Resign), Apply, Export, Search, pagination; kolom Type, Description, Effective Date, Payroll Name, Payroll Month, Created By, Created Date, Status, Action. Kosong; bulk Skip all tidak dijalankan.\n- **Company files:** tabs Company files/Employee files/Other files. Company files: New company files/Search, kolom Folder name, Shared to, Accessible from, Last modified by; Add folder mencakup Name (maks.60), Description (maks.200), Accessible on date, criteria semua/selected (Branch, Organization, Job position, Job level, Employment status, SBU, Employees), upload files, email/reminder. Employee files: categories All/Identity/Other, filters All employees/All job positions, Search, Employee files report, Add file/Add employee files; kategori berisi satu input, file meminta employee+attachment, bulk upload mendukung folder per karyawan. File types termasuk PDF/gambar/Office/CSV/TXT/ZIP/RAR, batas 10 MB per file dan 100 file/1 GB per aksi upload. Other files: Search, Delete, tabel File Name, Type File, Uploader, Date Created. Semua daftar kosong; draft nama/description/kategori dibatalkan; tidak ada file diunggah/dihapus.\n- **Onboarding:** tab On Progress/Completed; Select Month Period, Select Year Period, jumlah baris; tidak ada hasil.\n- **Report Builder:** dashboard Create report/Guidebook/Insight. Draft laporan meminta Name (maks.28), Description (maks.120), type Latest update/Daily/Monthly; kategori field berbeda tiap tipe (Latest update: Personal, Payroll Information, Employment, Education; Daily menambah Attendance dan request; Monthly menambah Payroll Transaction, Tax Detail, Monthly Attendance). Search/Select all/Clear all/pilihan fields/Add filter to selected, format XLSX/CSV, schedule (Latest update: Not scheduled/Daily). Draft filter/report dibatalkan; tidak ada data diekspor.\n- **Document Template:** Generated documents dan Create template (New/Upload), Search. New template mencakup Template name/description/category (General, Employee Transfer, Overtime Request, Onboarding, Offboarding, Reprimand, Resignation), layout dokumen, pilihan shortcode, auto employee-file sync dan sync saat signature, document number, header/footer, rich-text/shortcode/import document. Upload template meminta name (maks.30), description, category, numbering manual atau auto-generated, stamp metadata, file .doc/.docx maks.5 MB, shortcode dan sync. Draft dibatalkan tanpa upload.\n- **Generated documents:** filter month/template/employee, status employee-file (All/Not synced/Synced/File deleted), status dokumen (Active/Revoked), status Mekari Sign; KPI total/not sent/awaiting/partial/signed; export/search; kolom Transaction ID, Exported date, Employee name, Template name, Document number, Exported by, Employee files, Mekari Sign, Document status, Source. Tidak ada record; ekspor tidak dilakukan.",
    "verified": true
  },
  {
    "id": "company-notification",
    "group": "Company",
    "name": "Notification",
    "columns": [
      "Type",
      "Description",
      "Effective Date",
      "Payroll Name",
      "Payroll Month",
      "Created By",
      "Created Date",
      "Status",
      "Action"
    ],
    "fields": [],
    "filters": [
      "Start date",
      "End date",
      "Status",
      "Type"
    ],
    "tabs": [],
    "action": "Skip all",
    "notes": "- **Job position:** Chart/Table view; tabel Table memiliki Job position code, Name, Parent job position, Employees, pencarian/filter, export, bulk update, Add/Import. Actions record yang terlihat: View details, Edit, Set inactive, Permanently delete. Form tambah: Job position code (maks. 25), Job position name, Parent job position, Job description; Save, Save and add other, Cancel. Form contoh QA TEST ONLY diisi lalu dibatalkan.\n- **Grade & class:** tabel Grade memakai Grade Name; tabel Class memakai Class Name, Parent, From, To. Keduanya menampilkan Export Data, Import, Bulk Update, New, pencarian dan pagination. Form Grade berisi Grade Name; Class berisi Class Name, From, To, Grade; Close/Save. Isian uji dibatalkan.\n- **Auto Generate Format:** halaman awal memiliki Guidebook/Create format. Form: Form Type, kondisi Employment status, Add component dengan tipe Text, Increment number, Join date, Branch code, Organization code, Job position code, Job level code, Generated Date; input Text/Start number, Advance option, preview, Auto ID reset dan Auto ID sequencing, Cancel/Save. Tidak disimpan.\n- **Files:** ada toggle “Allow employees to edit or delete files” dan tautan Manage files. Toggle dibiarkan.\n- **Custom Field:** tab Employee info dan Include on feature; pencarian/filter; tabel employee field berkolom Field name, Field type, Editing method, Created date, Show on, sedangkan feature field berkolom Custom field name, Custom field type, Feature page, Created date, Last modified, Status. Form employee field: Field name (maks. 120), Editing method (admin only/self-edit/transfer only/API only), Show on, Field type (Text input, Text area, Dropdown list, Date picker), Cancel/Create. Form berisi nama uji dan dibatalkan.\n- **NPP:** tabel memiliki Npp Name, Npp Number, Branch, JKK, Action. Form tambah berisi NPP Name, NPP Number, JKK, Branch, Close/Save. Tidak ada identifier atau tarif existing yang dicatat.\n- **Employment Status:** tabel Employment status name, Sign date, End date; search, Edit, pagination dan Add employment status. Form: Employment status name (maks. 60), This status has sign date, This status has end date, Set specific duration for end date, Cancel/Save. Draft uji dibatalkan.\n- **Notification:** tab General dan Time management; tiap tipe notifikasi dapat diatur untuk Email, Inbox Talenta, Push notification. Kategori General: Change Data, Reminder, Delegation. Kategori Time management: Change Shift, Live Attendance, Time Off, Attendance, Overtime, Overtime Plan. Tidak ada toggle yang diubah.\n- **Settings → Company Info** juga menampilkan Company Info, Tax Info, Other Info serta tautan edit; halaman dibaca tanpa menyalin nilai identitas, kontak, pajak, atau perusahaan.\n\n- **Assets list:** filter kategori, kontrol kolom, export, clipboard/report control, Search asset/employee, Import assets, Add asset; KPI Total/Assigned/Unassigned assets; kolom Asset name, Category name, Asset number, Assigned employee, Last modified. Kosong. Form Add asset: Asset name dan Asset number (maks.60), Description (maks.200), Asset category wajib/Create asset category, Attachment (PDF/JPG/PNG/JPEG/DOCX/DOC/ZIP maks.10 MB), Purchase date/price, opsi Assign asset to employee dengan Employee dan Assigned date. Draft dibatalkan.\n- **Assigned assets:** Import, Assign asset, filter kategori, export, search; tabel Asset name, Assigned employee, Asset category, Asset number, Assigned date. Kosong.\n- **Asset category:** Import, Add category, export, Search; tabel Asset category, Total asset, Total assigned asset, Total unassigned asset. Kosong. Add category meminta Category name; modal dibatalkan.\n- **Announcements:** filter kategori, Search, Help, Create announcement; daftar kosong. Form meminta title, rich-text body, publish ke semua karyawan atau berdasarkan criteria, Category, Forms, Attachment (format office/PDF/gambar, maks.10 MB), opsi email, Cancel/Save & publish. Draft kosong dibatalkan; tidak ada pengumuman dikirim.\n- **User Activity Log:** date range, All email, All type, Apply filter, Export, Search; kolom Date, Email, Activity, Type. Satu baris ada; nilai record tidak disalin dan ekspor tidak dijalankan.\n- **Queue activity:** Search, Refresh, Help/Learn more; kolom Queue ID, Activity, Executed by, Submitted time, Started time, Status. Kosong.\n- **Notification:** Start/End date, Status (Cancel/Completed/Need Action/Skipped), Type (Bank Account Invalid/Employee Transfer/Reminder/Resign), Apply, Export, Search, pagination; kolom Type, Description, Effective Date, Payroll Name, Payroll Month, Created By, Created Date, Status, Action. Kosong; bulk Skip all tidak dijalankan.\n- **Company files:** tabs Company files/Employee files/Other files. Company files: New company files/Search, kolom Folder name, Shared to, Accessible from, Last modified by; Add folder mencakup Name (maks.60), Description (maks.200), Accessible on date, criteria semua/selected (Branch, Organization, Job position, Job level, Employment status, SBU, Employees), upload files, email/reminder. Employee files: categories All/Identity/Other, filters All employees/All job positions, Search, Employee files report, Add file/Add employee files; kategori berisi satu input, file meminta employee+attachment, bulk upload mendukung folder per karyawan. File types termasuk PDF/gambar/Office/CSV/TXT/ZIP/RAR, batas 10 MB per file dan 100 file/1 GB per aksi upload. Other files: Search, Delete, tabel File Name, Type File, Uploader, Date Created. Semua daftar kosong; draft nama/description/kategori dibatalkan; tidak ada file diunggah/dihapus.\n- **Onboarding:** tab On Progress/Completed; Select Month Period, Select Year Period, jumlah baris; tidak ada hasil.\n- **Report Builder:** dashboard Create report/Guidebook/Insight. Draft laporan meminta Name (maks.28), Description (maks.120), type Latest update/Daily/Monthly; kategori field berbeda tiap tipe (Latest update: Personal, Payroll Information, Employment, Education; Daily menambah Attendance dan request; Monthly menambah Payroll Transaction, Tax Detail, Monthly Attendance). Search/Select all/Clear all/pilihan fields/Add filter to selected, format XLSX/CSV, schedule (Latest update: Not scheduled/Daily). Draft filter/report dibatalkan; tidak ada data diekspor.\n- **Document Template:** Generated documents dan Create template (New/Upload), Search. New template mencakup Template name/description/category (General, Employee Transfer, Overtime Request, Onboarding, Offboarding, Reprimand, Resignation), layout dokumen, pilihan shortcode, auto employee-file sync dan sync saat signature, document number, header/footer, rich-text/shortcode/import document. Upload template meminta name (maks.30), description, category, numbering manual atau auto-generated, stamp metadata, file .doc/.docx maks.5 MB, shortcode dan sync. Draft dibatalkan tanpa upload.\n- **Generated documents:** filter month/template/employee, status employee-file (All/Not synced/Synced/File deleted), status dokumen (Active/Revoked), status Mekari Sign; KPI total/not sent/awaiting/partial/signed; export/search; kolom Transaction ID, Exported date, Employee name, Template name, Document number, Exported by, Employee files, Mekari Sign, Document status, Source. Tidak ada record; ekspor tidak dilakukan.",
    "verified": true
  },
  {
    "id": "company-company-files",
    "group": "Company",
    "name": "Company files",
    "columns": [
      "Folder name",
      "Shared to",
      "Accessible from",
      "Last modified by"
    ],
    "fields": [
      "Name!",
      "Description",
      "Accessible on date",
      "All employees?",
      "Branch",
      "Organization",
      "Job position",
      "Job level",
      "Employment status",
      "SBU",
      "Employees",
      "Attachment",
      "Email reminder?"
    ],
    "filters": [
      "Employee",
      "Job position"
    ],
    "tabs": [
      "Company files",
      "Employee files",
      "Other files"
    ],
    "action": "Add folder",
    "notes": "- **Assets list:** filter kategori, kontrol kolom, export, clipboard/report control, Search asset/employee, Import assets, Add asset; KPI Total/Assigned/Unassigned assets; kolom Asset name, Category name, Asset number, Assigned employee, Last modified. Kosong. Form Add asset: Asset name dan Asset number (maks.60), Description (maks.200), Asset category wajib/Create asset category, Attachment (PDF/JPG/PNG/JPEG/DOCX/DOC/ZIP maks.10 MB), Purchase date/price, opsi Assign asset to employee dengan Employee dan Assigned date. Draft dibatalkan.\n- **Assigned assets:** Import, Assign asset, filter kategori, export, search; tabel Asset name, Assigned employee, Asset category, Asset number, Assigned date. Kosong.\n- **Asset category:** Import, Add category, export, Search; tabel Asset category, Total asset, Total assigned asset, Total unassigned asset. Kosong. Add category meminta Category name; modal dibatalkan.\n- **Announcements:** filter kategori, Search, Help, Create announcement; daftar kosong. Form meminta title, rich-text body, publish ke semua karyawan atau berdasarkan criteria, Category, Forms, Attachment (format office/PDF/gambar, maks.10 MB), opsi email, Cancel/Save & publish. Draft kosong dibatalkan; tidak ada pengumuman dikirim.\n- **User Activity Log:** date range, All email, All type, Apply filter, Export, Search; kolom Date, Email, Activity, Type. Satu baris ada; nilai record tidak disalin dan ekspor tidak dijalankan.\n- **Queue activity:** Search, Refresh, Help/Learn more; kolom Queue ID, Activity, Executed by, Submitted time, Started time, Status. Kosong.\n- **Notification:** Start/End date, Status (Cancel/Completed/Need Action/Skipped), Type (Bank Account Invalid/Employee Transfer/Reminder/Resign), Apply, Export, Search, pagination; kolom Type, Description, Effective Date, Payroll Name, Payroll Month, Created By, Created Date, Status, Action. Kosong; bulk Skip all tidak dijalankan.\n- **Company files:** tabs Company files/Employee files/Other files. Company files: New company files/Search, kolom Folder name, Shared to, Accessible from, Last modified by; Add folder mencakup Name (maks.60), Description (maks.200), Accessible on date, criteria semua/selected (Branch, Organization, Job position, Job level, Employment status, SBU, Employees), upload files, email/reminder. Employee files: categories All/Identity/Other, filters All employees/All job positions, Search, Employee files report, Add file/Add employee files; kategori berisi satu input, file meminta employee+attachment, bulk upload mendukung folder per karyawan. File types termasuk PDF/gambar/Office/CSV/TXT/ZIP/RAR, batas 10 MB per file dan 100 file/1 GB per aksi upload. Other files: Search, Delete, tabel File Name, Type File, Uploader, Date Created. Semua daftar kosong; draft nama/description/kategori dibatalkan; tidak ada file diunggah/dihapus.\n- **Onboarding:** tab On Progress/Completed; Select Month Period, Select Year Period, jumlah baris; tidak ada hasil.\n- **Report Builder:** dashboard Create report/Guidebook/Insight. Draft laporan meminta Name (maks.28), Description (maks.120), type Latest update/Daily/Monthly; kategori field berbeda tiap tipe (Latest update: Personal, Payroll Information, Employment, Education; Daily menambah Attendance dan request; Monthly menambah Payroll Transaction, Tax Detail, Monthly Attendance). Search/Select all/Clear all/pilihan fields/Add filter to selected, format XLSX/CSV, schedule (Latest update: Not scheduled/Daily). Draft filter/report dibatalkan; tidak ada data diekspor.\n- **Document Template:** Generated documents dan Create template (New/Upload), Search. New template mencakup Template name/description/category (General, Employee Transfer, Overtime Request, Onboarding, Offboarding, Reprimand, Resignation), layout dokumen, pilihan shortcode, auto employee-file sync dan sync saat signature, document number, header/footer, rich-text/shortcode/import document. Upload template meminta name (maks.30), description, category, numbering manual atau auto-generated, stamp metadata, file .doc/.docx maks.5 MB, shortcode dan sync. Draft dibatalkan tanpa upload.\n- **Generated documents:** filter month/template/employee, status employee-file (All/Not synced/Synced/File deleted), status dokumen (Active/Revoked), status Mekari Sign; KPI total/not sent/awaiting/partial/signed; export/search; kolom Transaction ID, Exported date, Employee name, Template name, Document number, Exported by, Employee files, Mekari Sign, Document status, Source. Tidak ada record; ekspor tidak dilakukan.",
    "verified": true
  },
  {
    "id": "company-report-builder",
    "group": "Company",
    "name": "Report Builder",
    "columns": [
      "Name",
      "Description",
      "Type",
      "Format"
    ],
    "fields": [
      "Name!",
      "Description",
      "Type",
      "Fields",
      "Filter",
      "Format",
      "Schedule"
    ],
    "filters": [],
    "tabs": [],
    "action": "Create report",
    "notes": "- **Assets list:** filter kategori, kontrol kolom, export, clipboard/report control, Search asset/employee, Import assets, Add asset; KPI Total/Assigned/Unassigned assets; kolom Asset name, Category name, Asset number, Assigned employee, Last modified. Kosong. Form Add asset: Asset name dan Asset number (maks.60), Description (maks.200), Asset category wajib/Create asset category, Attachment (PDF/JPG/PNG/JPEG/DOCX/DOC/ZIP maks.10 MB), Purchase date/price, opsi Assign asset to employee dengan Employee dan Assigned date. Draft dibatalkan.\n- **Assigned assets:** Import, Assign asset, filter kategori, export, search; tabel Asset name, Assigned employee, Asset category, Asset number, Assigned date. Kosong.\n- **Asset category:** Import, Add category, export, Search; tabel Asset category, Total asset, Total assigned asset, Total unassigned asset. Kosong. Add category meminta Category name; modal dibatalkan.\n- **Announcements:** filter kategori, Search, Help, Create announcement; daftar kosong. Form meminta title, rich-text body, publish ke semua karyawan atau berdasarkan criteria, Category, Forms, Attachment (format office/PDF/gambar, maks.10 MB), opsi email, Cancel/Save & publish. Draft kosong dibatalkan; tidak ada pengumuman dikirim.\n- **User Activity Log:** date range, All email, All type, Apply filter, Export, Search; kolom Date, Email, Activity, Type. Satu baris ada; nilai record tidak disalin dan ekspor tidak dijalankan.\n- **Queue activity:** Search, Refresh, Help/Learn more; kolom Queue ID, Activity, Executed by, Submitted time, Started time, Status. Kosong.\n- **Notification:** Start/End date, Status (Cancel/Completed/Need Action/Skipped), Type (Bank Account Invalid/Employee Transfer/Reminder/Resign), Apply, Export, Search, pagination; kolom Type, Description, Effective Date, Payroll Name, Payroll Month, Created By, Created Date, Status, Action. Kosong; bulk Skip all tidak dijalankan.\n- **Company files:** tabs Company files/Employee files/Other files. Company files: New company files/Search, kolom Folder name, Shared to, Accessible from, Last modified by; Add folder mencakup Name (maks.60), Description (maks.200), Accessible on date, criteria semua/selected (Branch, Organization, Job position, Job level, Employment status, SBU, Employees), upload files, email/reminder. Employee files: categories All/Identity/Other, filters All employees/All job positions, Search, Employee files report, Add file/Add employee files; kategori berisi satu input, file meminta employee+attachment, bulk upload mendukung folder per karyawan. File types termasuk PDF/gambar/Office/CSV/TXT/ZIP/RAR, batas 10 MB per file dan 100 file/1 GB per aksi upload. Other files: Search, Delete, tabel File Name, Type File, Uploader, Date Created. Semua daftar kosong; draft nama/description/kategori dibatalkan; tidak ada file diunggah/dihapus.\n- **Onboarding:** tab On Progress/Completed; Select Month Period, Select Year Period, jumlah baris; tidak ada hasil.\n- **Report Builder:** dashboard Create report/Guidebook/Insight. Draft laporan meminta Name (maks.28), Description (maks.120), type Latest update/Daily/Monthly; kategori field berbeda tiap tipe (Latest update: Personal, Payroll Information, Employment, Education; Daily menambah Attendance dan request; Monthly menambah Payroll Transaction, Tax Detail, Monthly Attendance). Search/Select all/Clear all/pilihan fields/Add filter to selected, format XLSX/CSV, schedule (Latest update: Not scheduled/Daily). Draft filter/report dibatalkan; tidak ada data diekspor.\n- **Document Template:** Generated documents dan Create template (New/Upload), Search. New template mencakup Template name/description/category (General, Employee Transfer, Overtime Request, Onboarding, Offboarding, Reprimand, Resignation), layout dokumen, pilihan shortcode, auto employee-file sync dan sync saat signature, document number, header/footer, rich-text/shortcode/import document. Upload template meminta name (maks.30), description, category, numbering manual atau auto-generated, stamp metadata, file .doc/.docx maks.5 MB, shortcode dan sync. Draft dibatalkan tanpa upload.\n- **Generated documents:** filter month/template/employee, status employee-file (All/Not synced/Synced/File deleted), status dokumen (Active/Revoked), status Mekari Sign; KPI total/not sent/awaiting/partial/signed; export/search; kolom Transaction ID, Exported date, Employee name, Template name, Document number, Exported by, Employee files, Mekari Sign, Document status, Source. Tidak ada record; ekspor tidak dilakukan.",
    "verified": true
  },
  {
    "id": "settings-account-profile-picture",
    "group": "Settings · Account",
    "name": "Profile picture",
    "columns": [],
    "fields": [
      "Attachment"
    ],
    "filters": [],
    "tabs": [],
    "action": "Save changes",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "settings-account-password-payslip",
    "group": "Settings · Account",
    "name": "Password payslip",
    "columns": [],
    "fields": [
      "Password!"
    ],
    "filters": [],
    "tabs": [],
    "action": "Save changes",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "settings-account-change-password",
    "group": "Settings · Account",
    "name": "Change password",
    "columns": [],
    "fields": [
      "Current password!",
      "New password!",
      "Confirm password!"
    ],
    "filters": [],
    "tabs": [],
    "action": "Save changes",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "settings-account-talenta-labs",
    "group": "Settings · Account",
    "name": "Talenta labs",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "settings-company-company-info",
    "group": "Settings · Company",
    "name": "Company info",
    "columns": [],
    "fields": [
      "Company name!",
      "Company phone number",
      "Email",
      "Address",
      "Province",
      "City",
      "Industry",
      "Company size",
      "NPWP 15 digit",
      "NPWP 16 digit",
      "NITKU",
      "Company taxable date",
      "Tax person name",
      "Tax person NPWP",
      "HQ initial",
      "HQ code",
      "Show branch name?",
      "UMR",
      "UMR province",
      "UMR city",
      "BPJS Ketenagakerjaan",
      "JKK",
      "Kode KLU",
      "Signature",
      "Attendance on mobile"
    ],
    "filters": [],
    "tabs": [
      "Company Info",
      "Tax Info",
      "Other Info"
    ],
    "action": "Edit company info",
    "notes": "### Company Info",
    "verified": true
  },
  {
    "id": "settings-company-group-structure",
    "group": "Settings · Company",
    "name": "Group structure",
    "columns": [
      "Group ID",
      "Employment status",
      "Branch",
      "Organization",
      "Job level"
    ],
    "fields": [
      "Group ID!",
      "Employment status",
      "Branch",
      "Organization",
      "Job level",
      "Job position",
      "Grade",
      "Class",
      "Cost Center",
      "Cost center category",
      "Approval line",
      "Manager",
      "Custom field",
      "SBU"
    ],
    "filters": [
      "Status"
    ],
    "tabs": [],
    "action": "Create group",
    "notes": "- **Group structure:** Filter, import, help, Create group; tabel kosong. Form Create group: Group ID (maks. 20), Employment status, Branch, Organization, Job level, Job position, Grade, Class, Cost Center, Cost center category, Approval line, Manager, Custom field/Add, SBU/Add, Cancel/Create. Field berjenjang Organization–Cost Center nonaktif sampai prasyarat dipilih; form dibatalkan.\n- **Branch:** filter All province, search, Export, Bulk update, Add branch/Import branch; kolom Branch code, Branch name, Parent branch, Employees, Province, City. Add branch berisi upload logo (JPG/JPEG/PNG, maks. 5 MB), Branch name (maks. 60), Branch code (maks. 25), Address, Postal code, Fax, Phone number, Province, City, Minimum wage (UMR), Matching the NPWP with the parent branch, Branch tax name, Branch NITKU, NPWP lama/baru, Tax holder name dan NPWP lama/baru, KLU code, Signature for 1721 A1, JHT payment source, BPJS payment source, Attendance on mobile (Not use/Use with flexible location/Use with GPS), Help, Cancel, Save. Form kosong dibatalkan.\n- **Organization:** tab Chart view/Table view; Export, Bulk update, Add organization/Import organization, status filter, search, pagination. Table view: Organization code, Name, Parent organization, Employees, Actions. Form Create organization: Organization code (maks. 25), Organization name, Parent organization, Cancel, Save and add other, Save. Daftar hanya diperiksa; tidak ada data baris yang disalin atau diubah.\n- **Strategic business unit:** Search, Guidebook, Create SBU group; kolom Group name, Description, Total SBU, Created date, Last updated, Status. Form Create SBU group: Group name (maks. 60), Description (maks. 200), Cancel, Save. Form dibatalkan.\n- **Job level:** All status, search, Export, Bulk update, Add job level, pagination; kolom Job level code, Job level name, Employees, Status, Actions. Menu Actions pada record terlihat berisi Edit, Set inactive, Permanently delete; tidak dipilih. Detail form add/edit belum dibuka.\n- Company Info membuka Company Info, Tax Info, Other Info, logo dan tautan edit; label field telah dicatat pada bagian Company Info di atas. Nilai perusahaan/pajak yang tampil tidak disalin.\n\n- **Group structure:** daftar kosong dengan Filter, Search, Create group, dan Import. Form berisi Group ID (maks. 20), Employment status, Branch, Organization, Job level, Job position, Grade, Class, Cost Center, Cost center category, Approval line, Manager, Custom field, dan SBU. Grade/Class/Cost Center tampak bergantung pada pilihan struktur sebelumnya. Group ID sintetis `QA TEST ONLY` sempat diisi lalu form dibatalkan; tidak ada grup tersimpan.\n- **Branch:** daftar kosong dengan filter All province, Search, Export, Bulk update, serta menu Add branch/Import branch. Kolom: Branch code, Branch name, Parent branch, Employees, Province, City. Form tambah memiliki unggah logo (JPG/JPEG/PNG, 100×50 px, maks. 5 MB); Branch name wajib (maks. 60), Branch code (maks. 25), Address wajib, Postal code, Fax, Phone number; Province wajib, City, UMR non-editable, opsi mencocokkan NPWP dengan parent, Branch tax name wajib, Branch NITKU, NPWP 15/16 digit, Tax holder name dan NPWP 15/16 digit, KLU code, signature upload/preview/reset, pilihan sumber pembayaran JHT dan BPJS, serta tiga opsi Attendance on mobile. Karena form meminta data pajak/identitas yang sensitif, tidak diisi; form ditinggalkan tanpa Save. Halaman Import branch meminta template XLSX, unggahan XLSX maks. 5 MB, Cancel, dan Upload (nonaktif sebelum file dipilih); tidak ada file diunggah.\n- **Organization:** Chart view dan Table view; tersedia Export, Bulk update, status filter, Search, Add organization/Import organization, dan Expand all pada chart. Tabel: Organization code, Name, Parent organization, Employees, Actions; contoh menu aksi record berisi Edit, Set inactive, Permanently delete. Form Create organization meminta Organization code (maks. 25), Organization name, Parent organization, dengan Cancel, Save and add other, dan Save. Form dibuka kosong lalu ditinggalkan tanpa menyimpan; isi record existing tidak disalin.",
    "verified": true
  },
  {
    "id": "settings-company-branch",
    "group": "Settings · Company",
    "name": "Branch",
    "columns": [
      "Branch code",
      "Branch name",
      "Parent branch",
      "Employees",
      "Province",
      "City"
    ],
    "fields": [
      "Branch name!",
      "Branch code!",
      "Address",
      "Postal code",
      "Fax",
      "Phone number",
      "Province",
      "City",
      "Minimum wage",
      "Matching NPWP?",
      "Branch tax name",
      "Branch NITKU",
      "NPWP old",
      "NPWP new",
      "Tax holder name",
      "Tax holder NPWP",
      "KLU code",
      "Signature",
      "JHT payment source",
      "BPJS payment source",
      "Attendance on mobile"
    ],
    "filters": [
      "Province"
    ],
    "tabs": [],
    "action": "Add branch",
    "notes": "- **Group structure:** Filter, import, help, Create group; tabel kosong. Form Create group: Group ID (maks. 20), Employment status, Branch, Organization, Job level, Job position, Grade, Class, Cost Center, Cost center category, Approval line, Manager, Custom field/Add, SBU/Add, Cancel/Create. Field berjenjang Organization–Cost Center nonaktif sampai prasyarat dipilih; form dibatalkan.\n- **Branch:** filter All province, search, Export, Bulk update, Add branch/Import branch; kolom Branch code, Branch name, Parent branch, Employees, Province, City. Add branch berisi upload logo (JPG/JPEG/PNG, maks. 5 MB), Branch name (maks. 60), Branch code (maks. 25), Address, Postal code, Fax, Phone number, Province, City, Minimum wage (UMR), Matching the NPWP with the parent branch, Branch tax name, Branch NITKU, NPWP lama/baru, Tax holder name dan NPWP lama/baru, KLU code, Signature for 1721 A1, JHT payment source, BPJS payment source, Attendance on mobile (Not use/Use with flexible location/Use with GPS), Help, Cancel, Save. Form kosong dibatalkan.\n- **Organization:** tab Chart view/Table view; Export, Bulk update, Add organization/Import organization, status filter, search, pagination. Table view: Organization code, Name, Parent organization, Employees, Actions. Form Create organization: Organization code (maks. 25), Organization name, Parent organization, Cancel, Save and add other, Save. Daftar hanya diperiksa; tidak ada data baris yang disalin atau diubah.\n- **Strategic business unit:** Search, Guidebook, Create SBU group; kolom Group name, Description, Total SBU, Created date, Last updated, Status. Form Create SBU group: Group name (maks. 60), Description (maks. 200), Cancel, Save. Form dibatalkan.\n- **Job level:** All status, search, Export, Bulk update, Add job level, pagination; kolom Job level code, Job level name, Employees, Status, Actions. Menu Actions pada record terlihat berisi Edit, Set inactive, Permanently delete; tidak dipilih. Detail form add/edit belum dibuka.\n- Company Info membuka Company Info, Tax Info, Other Info, logo dan tautan edit; label field telah dicatat pada bagian Company Info di atas. Nilai perusahaan/pajak yang tampil tidak disalin.\n\n- **Group structure:** daftar kosong dengan Filter, Search, Create group, dan Import. Form berisi Group ID (maks. 20), Employment status, Branch, Organization, Job level, Job position, Grade, Class, Cost Center, Cost center category, Approval line, Manager, Custom field, dan SBU. Grade/Class/Cost Center tampak bergantung pada pilihan struktur sebelumnya. Group ID sintetis `QA TEST ONLY` sempat diisi lalu form dibatalkan; tidak ada grup tersimpan.\n- **Branch:** daftar kosong dengan filter All province, Search, Export, Bulk update, serta menu Add branch/Import branch. Kolom: Branch code, Branch name, Parent branch, Employees, Province, City. Form tambah memiliki unggah logo (JPG/JPEG/PNG, 100×50 px, maks. 5 MB); Branch name wajib (maks. 60), Branch code (maks. 25), Address wajib, Postal code, Fax, Phone number; Province wajib, City, UMR non-editable, opsi mencocokkan NPWP dengan parent, Branch tax name wajib, Branch NITKU, NPWP 15/16 digit, Tax holder name dan NPWP 15/16 digit, KLU code, signature upload/preview/reset, pilihan sumber pembayaran JHT dan BPJS, serta tiga opsi Attendance on mobile. Karena form meminta data pajak/identitas yang sensitif, tidak diisi; form ditinggalkan tanpa Save. Halaman Import branch meminta template XLSX, unggahan XLSX maks. 5 MB, Cancel, dan Upload (nonaktif sebelum file dipilih); tidak ada file diunggah.\n- **Organization:** Chart view dan Table view; tersedia Export, Bulk update, status filter, Search, Add organization/Import organization, dan Expand all pada chart. Tabel: Organization code, Name, Parent organization, Employees, Actions; contoh menu aksi record berisi Edit, Set inactive, Permanently delete. Form Create organization meminta Organization code (maks. 25), Organization name, Parent organization, dengan Cancel, Save and add other, dan Save. Form dibuka kosong lalu ditinggalkan tanpa menyimpan; isi record existing tidak disalin.",
    "verified": true
  },
  {
    "id": "settings-company-organization",
    "group": "Settings · Company",
    "name": "Organization",
    "columns": [
      "Organization code",
      "Name",
      "Parent organization",
      "Employees",
      "Actions"
    ],
    "fields": [
      "Organization code!",
      "Organization name!",
      "Parent organization"
    ],
    "filters": [
      "Status"
    ],
    "tabs": [
      "Chart view",
      "Table view"
    ],
    "action": "Add organization",
    "notes": "- **Group structure:** Filter, import, help, Create group; tabel kosong. Form Create group: Group ID (maks. 20), Employment status, Branch, Organization, Job level, Job position, Grade, Class, Cost Center, Cost center category, Approval line, Manager, Custom field/Add, SBU/Add, Cancel/Create. Field berjenjang Organization–Cost Center nonaktif sampai prasyarat dipilih; form dibatalkan.\n- **Branch:** filter All province, search, Export, Bulk update, Add branch/Import branch; kolom Branch code, Branch name, Parent branch, Employees, Province, City. Add branch berisi upload logo (JPG/JPEG/PNG, maks. 5 MB), Branch name (maks. 60), Branch code (maks. 25), Address, Postal code, Fax, Phone number, Province, City, Minimum wage (UMR), Matching the NPWP with the parent branch, Branch tax name, Branch NITKU, NPWP lama/baru, Tax holder name dan NPWP lama/baru, KLU code, Signature for 1721 A1, JHT payment source, BPJS payment source, Attendance on mobile (Not use/Use with flexible location/Use with GPS), Help, Cancel, Save. Form kosong dibatalkan.\n- **Organization:** tab Chart view/Table view; Export, Bulk update, Add organization/Import organization, status filter, search, pagination. Table view: Organization code, Name, Parent organization, Employees, Actions. Form Create organization: Organization code (maks. 25), Organization name, Parent organization, Cancel, Save and add other, Save. Daftar hanya diperiksa; tidak ada data baris yang disalin atau diubah.\n- **Strategic business unit:** Search, Guidebook, Create SBU group; kolom Group name, Description, Total SBU, Created date, Last updated, Status. Form Create SBU group: Group name (maks. 60), Description (maks. 200), Cancel, Save. Form dibatalkan.\n- **Job level:** All status, search, Export, Bulk update, Add job level, pagination; kolom Job level code, Job level name, Employees, Status, Actions. Menu Actions pada record terlihat berisi Edit, Set inactive, Permanently delete; tidak dipilih. Detail form add/edit belum dibuka.\n- Company Info membuka Company Info, Tax Info, Other Info, logo dan tautan edit; label field telah dicatat pada bagian Company Info di atas. Nilai perusahaan/pajak yang tampil tidak disalin.\n\n- **Group structure:** daftar kosong dengan Filter, Search, Create group, dan Import. Form berisi Group ID (maks. 20), Employment status, Branch, Organization, Job level, Job position, Grade, Class, Cost Center, Cost center category, Approval line, Manager, Custom field, dan SBU. Grade/Class/Cost Center tampak bergantung pada pilihan struktur sebelumnya. Group ID sintetis `QA TEST ONLY` sempat diisi lalu form dibatalkan; tidak ada grup tersimpan.\n- **Branch:** daftar kosong dengan filter All province, Search, Export, Bulk update, serta menu Add branch/Import branch. Kolom: Branch code, Branch name, Parent branch, Employees, Province, City. Form tambah memiliki unggah logo (JPG/JPEG/PNG, 100×50 px, maks. 5 MB); Branch name wajib (maks. 60), Branch code (maks. 25), Address wajib, Postal code, Fax, Phone number; Province wajib, City, UMR non-editable, opsi mencocokkan NPWP dengan parent, Branch tax name wajib, Branch NITKU, NPWP 15/16 digit, Tax holder name dan NPWP 15/16 digit, KLU code, signature upload/preview/reset, pilihan sumber pembayaran JHT dan BPJS, serta tiga opsi Attendance on mobile. Karena form meminta data pajak/identitas yang sensitif, tidak diisi; form ditinggalkan tanpa Save. Halaman Import branch meminta template XLSX, unggahan XLSX maks. 5 MB, Cancel, dan Upload (nonaktif sebelum file dipilih); tidak ada file diunggah.\n- **Organization:** Chart view dan Table view; tersedia Export, Bulk update, status filter, Search, Add organization/Import organization, dan Expand all pada chart. Tabel: Organization code, Name, Parent organization, Employees, Actions; contoh menu aksi record berisi Edit, Set inactive, Permanently delete. Form Create organization meminta Organization code (maks. 25), Organization name, Parent organization, dengan Cancel, Save and add other, dan Save. Form dibuka kosong lalu ditinggalkan tanpa menyimpan; isi record existing tidak disalin.",
    "verified": true
  },
  {
    "id": "settings-company-strategic-business-unit",
    "group": "Settings · Company",
    "name": "Strategic business unit",
    "columns": [
      "Group name",
      "Description",
      "Total SBU",
      "Created date",
      "Last updated",
      "Status"
    ],
    "fields": [
      "Group name!",
      "Description"
    ],
    "filters": [
      "Status"
    ],
    "tabs": [],
    "action": "Create SBU group",
    "notes": "- **Group structure:** Filter, import, help, Create group; tabel kosong. Form Create group: Group ID (maks. 20), Employment status, Branch, Organization, Job level, Job position, Grade, Class, Cost Center, Cost center category, Approval line, Manager, Custom field/Add, SBU/Add, Cancel/Create. Field berjenjang Organization–Cost Center nonaktif sampai prasyarat dipilih; form dibatalkan.\n- **Branch:** filter All province, search, Export, Bulk update, Add branch/Import branch; kolom Branch code, Branch name, Parent branch, Employees, Province, City. Add branch berisi upload logo (JPG/JPEG/PNG, maks. 5 MB), Branch name (maks. 60), Branch code (maks. 25), Address, Postal code, Fax, Phone number, Province, City, Minimum wage (UMR), Matching the NPWP with the parent branch, Branch tax name, Branch NITKU, NPWP lama/baru, Tax holder name dan NPWP lama/baru, KLU code, Signature for 1721 A1, JHT payment source, BPJS payment source, Attendance on mobile (Not use/Use with flexible location/Use with GPS), Help, Cancel, Save. Form kosong dibatalkan.\n- **Organization:** tab Chart view/Table view; Export, Bulk update, Add organization/Import organization, status filter, search, pagination. Table view: Organization code, Name, Parent organization, Employees, Actions. Form Create organization: Organization code (maks. 25), Organization name, Parent organization, Cancel, Save and add other, Save. Daftar hanya diperiksa; tidak ada data baris yang disalin atau diubah.\n- **Strategic business unit:** Search, Guidebook, Create SBU group; kolom Group name, Description, Total SBU, Created date, Last updated, Status. Form Create SBU group: Group name (maks. 60), Description (maks. 200), Cancel, Save. Form dibatalkan.\n- **Job level:** All status, search, Export, Bulk update, Add job level, pagination; kolom Job level code, Job level name, Employees, Status, Actions. Menu Actions pada record terlihat berisi Edit, Set inactive, Permanently delete; tidak dipilih. Detail form add/edit belum dibuka.\n- Company Info membuka Company Info, Tax Info, Other Info, logo dan tautan edit; label field telah dicatat pada bagian Company Info di atas. Nilai perusahaan/pajak yang tampil tidak disalin.",
    "verified": true
  },
  {
    "id": "settings-company-job-level",
    "group": "Settings · Company",
    "name": "Job level",
    "columns": [
      "Job level code",
      "Job level name",
      "Employees",
      "Status",
      "Actions"
    ],
    "fields": [],
    "filters": [
      "Status"
    ],
    "tabs": [],
    "action": "Add job level",
    "notes": "- **Group structure:** Filter, import, help, Create group; tabel kosong. Form Create group: Group ID (maks. 20), Employment status, Branch, Organization, Job level, Job position, Grade, Class, Cost Center, Cost center category, Approval line, Manager, Custom field/Add, SBU/Add, Cancel/Create. Field berjenjang Organization–Cost Center nonaktif sampai prasyarat dipilih; form dibatalkan.\n- **Branch:** filter All province, search, Export, Bulk update, Add branch/Import branch; kolom Branch code, Branch name, Parent branch, Employees, Province, City. Add branch berisi upload logo (JPG/JPEG/PNG, maks. 5 MB), Branch name (maks. 60), Branch code (maks. 25), Address, Postal code, Fax, Phone number, Province, City, Minimum wage (UMR), Matching the NPWP with the parent branch, Branch tax name, Branch NITKU, NPWP lama/baru, Tax holder name dan NPWP lama/baru, KLU code, Signature for 1721 A1, JHT payment source, BPJS payment source, Attendance on mobile (Not use/Use with flexible location/Use with GPS), Help, Cancel, Save. Form kosong dibatalkan.\n- **Organization:** tab Chart view/Table view; Export, Bulk update, Add organization/Import organization, status filter, search, pagination. Table view: Organization code, Name, Parent organization, Employees, Actions. Form Create organization: Organization code (maks. 25), Organization name, Parent organization, Cancel, Save and add other, Save. Daftar hanya diperiksa; tidak ada data baris yang disalin atau diubah.\n- **Strategic business unit:** Search, Guidebook, Create SBU group; kolom Group name, Description, Total SBU, Created date, Last updated, Status. Form Create SBU group: Group name (maks. 60), Description (maks. 200), Cancel, Save. Form dibatalkan.\n- **Job level:** All status, search, Export, Bulk update, Add job level, pagination; kolom Job level code, Job level name, Employees, Status, Actions. Menu Actions pada record terlihat berisi Edit, Set inactive, Permanently delete; tidak dipilih. Detail form add/edit belum dibuka.\n- Company Info membuka Company Info, Tax Info, Other Info, logo dan tautan edit; label field telah dicatat pada bagian Company Info di atas. Nilai perusahaan/pajak yang tampil tidak disalin.",
    "verified": true
  },
  {
    "id": "settings-company-job-position",
    "group": "Settings · Company",
    "name": "Job position",
    "columns": [
      "Job position code",
      "Name",
      "Parent job position",
      "Employees"
    ],
    "fields": [
      "Job position code!",
      "Job position name!",
      "Parent job position",
      "Job description"
    ],
    "filters": [
      "Status"
    ],
    "tabs": [
      "Chart view",
      "Table view"
    ],
    "action": "Add job position",
    "notes": "- **Job position:** Chart/Table view; tabel Table memiliki Job position code, Name, Parent job position, Employees, pencarian/filter, export, bulk update, Add/Import. Actions record yang terlihat: View details, Edit, Set inactive, Permanently delete. Form tambah: Job position code (maks. 25), Job position name, Parent job position, Job description; Save, Save and add other, Cancel. Form contoh QA TEST ONLY diisi lalu dibatalkan.\n- **Grade & class:** tabel Grade memakai Grade Name; tabel Class memakai Class Name, Parent, From, To. Keduanya menampilkan Export Data, Import, Bulk Update, New, pencarian dan pagination. Form Grade berisi Grade Name; Class berisi Class Name, From, To, Grade; Close/Save. Isian uji dibatalkan.\n- **Auto Generate Format:** halaman awal memiliki Guidebook/Create format. Form: Form Type, kondisi Employment status, Add component dengan tipe Text, Increment number, Join date, Branch code, Organization code, Job position code, Job level code, Generated Date; input Text/Start number, Advance option, preview, Auto ID reset dan Auto ID sequencing, Cancel/Save. Tidak disimpan.\n- **Files:** ada toggle “Allow employees to edit or delete files” dan tautan Manage files. Toggle dibiarkan.\n- **Custom Field:** tab Employee info dan Include on feature; pencarian/filter; tabel employee field berkolom Field name, Field type, Editing method, Created date, Show on, sedangkan feature field berkolom Custom field name, Custom field type, Feature page, Created date, Last modified, Status. Form employee field: Field name (maks. 120), Editing method (admin only/self-edit/transfer only/API only), Show on, Field type (Text input, Text area, Dropdown list, Date picker), Cancel/Create. Form berisi nama uji dan dibatalkan.\n- **NPP:** tabel memiliki Npp Name, Npp Number, Branch, JKK, Action. Form tambah berisi NPP Name, NPP Number, JKK, Branch, Close/Save. Tidak ada identifier atau tarif existing yang dicatat.\n- **Employment Status:** tabel Employment status name, Sign date, End date; search, Edit, pagination dan Add employment status. Form: Employment status name (maks. 60), This status has sign date, This status has end date, Set specific duration for end date, Cancel/Save. Draft uji dibatalkan.\n- **Notification:** tab General dan Time management; tiap tipe notifikasi dapat diatur untuk Email, Inbox Talenta, Push notification. Kategori General: Change Data, Reminder, Delegation. Kategori Time management: Change Shift, Live Attendance, Time Off, Attendance, Overtime, Overtime Plan. Tidak ada toggle yang diubah.\n- **Settings → Company Info** juga menampilkan Company Info, Tax Info, Other Info serta tautan edit; halaman dibaca tanpa menyalin nilai identitas, kontak, pajak, atau perusahaan.",
    "verified": true
  },
  {
    "id": "settings-company-grade-class",
    "group": "Settings · Company",
    "name": "Grade & class",
    "columns": [
      "Grade Name"
    ],
    "fields": [
      "Grade Name!",
      "Class Name",
      "From",
      "To",
      "Grade"
    ],
    "filters": [],
    "tabs": [
      "Grade",
      "Class"
    ],
    "action": "New",
    "notes": "- **Job position:** Chart/Table view; tabel Table memiliki Job position code, Name, Parent job position, Employees, pencarian/filter, export, bulk update, Add/Import. Actions record yang terlihat: View details, Edit, Set inactive, Permanently delete. Form tambah: Job position code (maks. 25), Job position name, Parent job position, Job description; Save, Save and add other, Cancel. Form contoh QA TEST ONLY diisi lalu dibatalkan.\n- **Grade & class:** tabel Grade memakai Grade Name; tabel Class memakai Class Name, Parent, From, To. Keduanya menampilkan Export Data, Import, Bulk Update, New, pencarian dan pagination. Form Grade berisi Grade Name; Class berisi Class Name, From, To, Grade; Close/Save. Isian uji dibatalkan.\n- **Auto Generate Format:** halaman awal memiliki Guidebook/Create format. Form: Form Type, kondisi Employment status, Add component dengan tipe Text, Increment number, Join date, Branch code, Organization code, Job position code, Job level code, Generated Date; input Text/Start number, Advance option, preview, Auto ID reset dan Auto ID sequencing, Cancel/Save. Tidak disimpan.\n- **Files:** ada toggle “Allow employees to edit or delete files” dan tautan Manage files. Toggle dibiarkan.\n- **Custom Field:** tab Employee info dan Include on feature; pencarian/filter; tabel employee field berkolom Field name, Field type, Editing method, Created date, Show on, sedangkan feature field berkolom Custom field name, Custom field type, Feature page, Created date, Last modified, Status. Form employee field: Field name (maks. 120), Editing method (admin only/self-edit/transfer only/API only), Show on, Field type (Text input, Text area, Dropdown list, Date picker), Cancel/Create. Form berisi nama uji dan dibatalkan.\n- **NPP:** tabel memiliki Npp Name, Npp Number, Branch, JKK, Action. Form tambah berisi NPP Name, NPP Number, JKK, Branch, Close/Save. Tidak ada identifier atau tarif existing yang dicatat.\n- **Employment Status:** tabel Employment status name, Sign date, End date; search, Edit, pagination dan Add employment status. Form: Employment status name (maks. 60), This status has sign date, This status has end date, Set specific duration for end date, Cancel/Save. Draft uji dibatalkan.\n- **Notification:** tab General dan Time management; tiap tipe notifikasi dapat diatur untuk Email, Inbox Talenta, Push notification. Kategori General: Change Data, Reminder, Delegation. Kategori Time management: Change Shift, Live Attendance, Time Off, Attendance, Overtime, Overtime Plan. Tidak ada toggle yang diubah.\n- **Settings → Company Info** juga menampilkan Company Info, Tax Info, Other Info serta tautan edit; halaman dibaca tanpa menyalin nilai identitas, kontak, pajak, atau perusahaan.",
    "verified": true
  },
  {
    "id": "settings-company-auto-generate-format",
    "group": "Settings · Company",
    "name": "Auto generate format",
    "columns": [],
    "fields": [
      "Form Type!",
      "Employment status",
      "Component type",
      "Text",
      "Start number",
      "Auto ID reset?",
      "Auto ID sequencing?"
    ],
    "filters": [],
    "tabs": [],
    "action": "Create format",
    "notes": "- **Job position:** Chart/Table view; tabel Table memiliki Job position code, Name, Parent job position, Employees, pencarian/filter, export, bulk update, Add/Import. Actions record yang terlihat: View details, Edit, Set inactive, Permanently delete. Form tambah: Job position code (maks. 25), Job position name, Parent job position, Job description; Save, Save and add other, Cancel. Form contoh QA TEST ONLY diisi lalu dibatalkan.\n- **Grade & class:** tabel Grade memakai Grade Name; tabel Class memakai Class Name, Parent, From, To. Keduanya menampilkan Export Data, Import, Bulk Update, New, pencarian dan pagination. Form Grade berisi Grade Name; Class berisi Class Name, From, To, Grade; Close/Save. Isian uji dibatalkan.\n- **Auto Generate Format:** halaman awal memiliki Guidebook/Create format. Form: Form Type, kondisi Employment status, Add component dengan tipe Text, Increment number, Join date, Branch code, Organization code, Job position code, Job level code, Generated Date; input Text/Start number, Advance option, preview, Auto ID reset dan Auto ID sequencing, Cancel/Save. Tidak disimpan.\n- **Files:** ada toggle “Allow employees to edit or delete files” dan tautan Manage files. Toggle dibiarkan.\n- **Custom Field:** tab Employee info dan Include on feature; pencarian/filter; tabel employee field berkolom Field name, Field type, Editing method, Created date, Show on, sedangkan feature field berkolom Custom field name, Custom field type, Feature page, Created date, Last modified, Status. Form employee field: Field name (maks. 120), Editing method (admin only/self-edit/transfer only/API only), Show on, Field type (Text input, Text area, Dropdown list, Date picker), Cancel/Create. Form berisi nama uji dan dibatalkan.\n- **NPP:** tabel memiliki Npp Name, Npp Number, Branch, JKK, Action. Form tambah berisi NPP Name, NPP Number, JKK, Branch, Close/Save. Tidak ada identifier atau tarif existing yang dicatat.\n- **Employment Status:** tabel Employment status name, Sign date, End date; search, Edit, pagination dan Add employment status. Form: Employment status name (maks. 60), This status has sign date, This status has end date, Set specific duration for end date, Cancel/Save. Draft uji dibatalkan.\n- **Notification:** tab General dan Time management; tiap tipe notifikasi dapat diatur untuk Email, Inbox Talenta, Push notification. Kategori General: Change Data, Reminder, Delegation. Kategori Time management: Change Shift, Live Attendance, Time Off, Attendance, Overtime, Overtime Plan. Tidak ada toggle yang diubah.\n- **Settings → Company Info** juga menampilkan Company Info, Tax Info, Other Info serta tautan edit; halaman dibaca tanpa menyalin nilai identitas, kontak, pajak, atau perusahaan.",
    "verified": true
  },
  {
    "id": "settings-company-files",
    "group": "Settings · Company",
    "name": "Files",
    "columns": [],
    "fields": [
      "Allow employees to edit or delete files?"
    ],
    "filters": [],
    "tabs": [],
    "action": "Save settings",
    "notes": "- **Job position:** Chart/Table view; tabel Table memiliki Job position code, Name, Parent job position, Employees, pencarian/filter, export, bulk update, Add/Import. Actions record yang terlihat: View details, Edit, Set inactive, Permanently delete. Form tambah: Job position code (maks. 25), Job position name, Parent job position, Job description; Save, Save and add other, Cancel. Form contoh QA TEST ONLY diisi lalu dibatalkan.\n- **Grade & class:** tabel Grade memakai Grade Name; tabel Class memakai Class Name, Parent, From, To. Keduanya menampilkan Export Data, Import, Bulk Update, New, pencarian dan pagination. Form Grade berisi Grade Name; Class berisi Class Name, From, To, Grade; Close/Save. Isian uji dibatalkan.\n- **Auto Generate Format:** halaman awal memiliki Guidebook/Create format. Form: Form Type, kondisi Employment status, Add component dengan tipe Text, Increment number, Join date, Branch code, Organization code, Job position code, Job level code, Generated Date; input Text/Start number, Advance option, preview, Auto ID reset dan Auto ID sequencing, Cancel/Save. Tidak disimpan.\n- **Files:** ada toggle “Allow employees to edit or delete files” dan tautan Manage files. Toggle dibiarkan.\n- **Custom Field:** tab Employee info dan Include on feature; pencarian/filter; tabel employee field berkolom Field name, Field type, Editing method, Created date, Show on, sedangkan feature field berkolom Custom field name, Custom field type, Feature page, Created date, Last modified, Status. Form employee field: Field name (maks. 120), Editing method (admin only/self-edit/transfer only/API only), Show on, Field type (Text input, Text area, Dropdown list, Date picker), Cancel/Create. Form berisi nama uji dan dibatalkan.\n- **NPP:** tabel memiliki Npp Name, Npp Number, Branch, JKK, Action. Form tambah berisi NPP Name, NPP Number, JKK, Branch, Close/Save. Tidak ada identifier atau tarif existing yang dicatat.\n- **Employment Status:** tabel Employment status name, Sign date, End date; search, Edit, pagination dan Add employment status. Form: Employment status name (maks. 60), This status has sign date, This status has end date, Set specific duration for end date, Cancel/Save. Draft uji dibatalkan.\n- **Notification:** tab General dan Time management; tiap tipe notifikasi dapat diatur untuk Email, Inbox Talenta, Push notification. Kategori General: Change Data, Reminder, Delegation. Kategori Time management: Change Shift, Live Attendance, Time Off, Attendance, Overtime, Overtime Plan. Tidak ada toggle yang diubah.\n- **Settings → Company Info** juga menampilkan Company Info, Tax Info, Other Info serta tautan edit; halaman dibaca tanpa menyalin nilai identitas, kontak, pajak, atau perusahaan.",
    "verified": true
  },
  {
    "id": "settings-company-custom-field",
    "group": "Settings · Company",
    "name": "Custom field",
    "columns": [
      "Field name",
      "Field type",
      "Editing method",
      "Created date",
      "Show on"
    ],
    "fields": [
      "Field name!",
      "Editing method",
      "Show on",
      "Field type"
    ],
    "filters": [
      "Status"
    ],
    "tabs": [
      "Employee info",
      "Include on feature"
    ],
    "action": "Create field",
    "notes": "- **Job position:** Chart/Table view; tabel Table memiliki Job position code, Name, Parent job position, Employees, pencarian/filter, export, bulk update, Add/Import. Actions record yang terlihat: View details, Edit, Set inactive, Permanently delete. Form tambah: Job position code (maks. 25), Job position name, Parent job position, Job description; Save, Save and add other, Cancel. Form contoh QA TEST ONLY diisi lalu dibatalkan.\n- **Grade & class:** tabel Grade memakai Grade Name; tabel Class memakai Class Name, Parent, From, To. Keduanya menampilkan Export Data, Import, Bulk Update, New, pencarian dan pagination. Form Grade berisi Grade Name; Class berisi Class Name, From, To, Grade; Close/Save. Isian uji dibatalkan.\n- **Auto Generate Format:** halaman awal memiliki Guidebook/Create format. Form: Form Type, kondisi Employment status, Add component dengan tipe Text, Increment number, Join date, Branch code, Organization code, Job position code, Job level code, Generated Date; input Text/Start number, Advance option, preview, Auto ID reset dan Auto ID sequencing, Cancel/Save. Tidak disimpan.\n- **Files:** ada toggle “Allow employees to edit or delete files” dan tautan Manage files. Toggle dibiarkan.\n- **Custom Field:** tab Employee info dan Include on feature; pencarian/filter; tabel employee field berkolom Field name, Field type, Editing method, Created date, Show on, sedangkan feature field berkolom Custom field name, Custom field type, Feature page, Created date, Last modified, Status. Form employee field: Field name (maks. 120), Editing method (admin only/self-edit/transfer only/API only), Show on, Field type (Text input, Text area, Dropdown list, Date picker), Cancel/Create. Form berisi nama uji dan dibatalkan.\n- **NPP:** tabel memiliki Npp Name, Npp Number, Branch, JKK, Action. Form tambah berisi NPP Name, NPP Number, JKK, Branch, Close/Save. Tidak ada identifier atau tarif existing yang dicatat.\n- **Employment Status:** tabel Employment status name, Sign date, End date; search, Edit, pagination dan Add employment status. Form: Employment status name (maks. 60), This status has sign date, This status has end date, Set specific duration for end date, Cancel/Save. Draft uji dibatalkan.\n- **Notification:** tab General dan Time management; tiap tipe notifikasi dapat diatur untuk Email, Inbox Talenta, Push notification. Kategori General: Change Data, Reminder, Delegation. Kategori Time management: Change Shift, Live Attendance, Time Off, Attendance, Overtime, Overtime Plan. Tidak ada toggle yang diubah.\n- **Settings → Company Info** juga menampilkan Company Info, Tax Info, Other Info serta tautan edit; halaman dibaca tanpa menyalin nilai identitas, kontak, pajak, atau perusahaan.",
    "verified": true
  },
  {
    "id": "settings-company-npp",
    "group": "Settings · Company",
    "name": "NPP",
    "columns": [
      "Npp Name",
      "Npp Number",
      "Branch",
      "JKK",
      "Action"
    ],
    "fields": [
      "NPP Name!",
      "NPP Number!",
      "JKK",
      "Branch"
    ],
    "filters": [],
    "tabs": [],
    "action": "Add NPP",
    "notes": "- **Job position:** Chart/Table view; tabel Table memiliki Job position code, Name, Parent job position, Employees, pencarian/filter, export, bulk update, Add/Import. Actions record yang terlihat: View details, Edit, Set inactive, Permanently delete. Form tambah: Job position code (maks. 25), Job position name, Parent job position, Job description; Save, Save and add other, Cancel. Form contoh QA TEST ONLY diisi lalu dibatalkan.\n- **Grade & class:** tabel Grade memakai Grade Name; tabel Class memakai Class Name, Parent, From, To. Keduanya menampilkan Export Data, Import, Bulk Update, New, pencarian dan pagination. Form Grade berisi Grade Name; Class berisi Class Name, From, To, Grade; Close/Save. Isian uji dibatalkan.\n- **Auto Generate Format:** halaman awal memiliki Guidebook/Create format. Form: Form Type, kondisi Employment status, Add component dengan tipe Text, Increment number, Join date, Branch code, Organization code, Job position code, Job level code, Generated Date; input Text/Start number, Advance option, preview, Auto ID reset dan Auto ID sequencing, Cancel/Save. Tidak disimpan.\n- **Files:** ada toggle “Allow employees to edit or delete files” dan tautan Manage files. Toggle dibiarkan.\n- **Custom Field:** tab Employee info dan Include on feature; pencarian/filter; tabel employee field berkolom Field name, Field type, Editing method, Created date, Show on, sedangkan feature field berkolom Custom field name, Custom field type, Feature page, Created date, Last modified, Status. Form employee field: Field name (maks. 120), Editing method (admin only/self-edit/transfer only/API only), Show on, Field type (Text input, Text area, Dropdown list, Date picker), Cancel/Create. Form berisi nama uji dan dibatalkan.\n- **NPP:** tabel memiliki Npp Name, Npp Number, Branch, JKK, Action. Form tambah berisi NPP Name, NPP Number, JKK, Branch, Close/Save. Tidak ada identifier atau tarif existing yang dicatat.\n- **Employment Status:** tabel Employment status name, Sign date, End date; search, Edit, pagination dan Add employment status. Form: Employment status name (maks. 60), This status has sign date, This status has end date, Set specific duration for end date, Cancel/Save. Draft uji dibatalkan.\n- **Notification:** tab General dan Time management; tiap tipe notifikasi dapat diatur untuk Email, Inbox Talenta, Push notification. Kategori General: Change Data, Reminder, Delegation. Kategori Time management: Change Shift, Live Attendance, Time Off, Attendance, Overtime, Overtime Plan. Tidak ada toggle yang diubah.\n- **Settings → Company Info** juga menampilkan Company Info, Tax Info, Other Info serta tautan edit; halaman dibaca tanpa menyalin nilai identitas, kontak, pajak, atau perusahaan.",
    "verified": true
  },
  {
    "id": "settings-company-employment-status",
    "group": "Settings · Company",
    "name": "Employment status",
    "columns": [
      "Employment status name",
      "Sign date",
      "End date"
    ],
    "fields": [
      "Employment status name!",
      "This status has sign date?",
      "This status has end date?",
      "Set specific duration for end date?"
    ],
    "filters": [],
    "tabs": [],
    "action": "Add employment status",
    "notes": "- **Job position:** Chart/Table view; tabel Table memiliki Job position code, Name, Parent job position, Employees, pencarian/filter, export, bulk update, Add/Import. Actions record yang terlihat: View details, Edit, Set inactive, Permanently delete. Form tambah: Job position code (maks. 25), Job position name, Parent job position, Job description; Save, Save and add other, Cancel. Form contoh QA TEST ONLY diisi lalu dibatalkan.\n- **Grade & class:** tabel Grade memakai Grade Name; tabel Class memakai Class Name, Parent, From, To. Keduanya menampilkan Export Data, Import, Bulk Update, New, pencarian dan pagination. Form Grade berisi Grade Name; Class berisi Class Name, From, To, Grade; Close/Save. Isian uji dibatalkan.\n- **Auto Generate Format:** halaman awal memiliki Guidebook/Create format. Form: Form Type, kondisi Employment status, Add component dengan tipe Text, Increment number, Join date, Branch code, Organization code, Job position code, Job level code, Generated Date; input Text/Start number, Advance option, preview, Auto ID reset dan Auto ID sequencing, Cancel/Save. Tidak disimpan.\n- **Files:** ada toggle “Allow employees to edit or delete files” dan tautan Manage files. Toggle dibiarkan.\n- **Custom Field:** tab Employee info dan Include on feature; pencarian/filter; tabel employee field berkolom Field name, Field type, Editing method, Created date, Show on, sedangkan feature field berkolom Custom field name, Custom field type, Feature page, Created date, Last modified, Status. Form employee field: Field name (maks. 120), Editing method (admin only/self-edit/transfer only/API only), Show on, Field type (Text input, Text area, Dropdown list, Date picker), Cancel/Create. Form berisi nama uji dan dibatalkan.\n- **NPP:** tabel memiliki Npp Name, Npp Number, Branch, JKK, Action. Form tambah berisi NPP Name, NPP Number, JKK, Branch, Close/Save. Tidak ada identifier atau tarif existing yang dicatat.\n- **Employment Status:** tabel Employment status name, Sign date, End date; search, Edit, pagination dan Add employment status. Form: Employment status name (maks. 60), This status has sign date, This status has end date, Set specific duration for end date, Cancel/Save. Draft uji dibatalkan.\n- **Notification:** tab General dan Time management; tiap tipe notifikasi dapat diatur untuk Email, Inbox Talenta, Push notification. Kategori General: Change Data, Reminder, Delegation. Kategori Time management: Change Shift, Live Attendance, Time Off, Attendance, Overtime, Overtime Plan. Tidak ada toggle yang diubah.\n- **Settings → Company Info** juga menampilkan Company Info, Tax Info, Other Info serta tautan edit; halaman dibaca tanpa menyalin nilai identitas, kontak, pajak, atau perusahaan.",
    "verified": true
  },
  {
    "id": "settings-company-notification",
    "group": "Settings · Company",
    "name": "Notification",
    "columns": [
      "Type",
      "Email",
      "Inbox Talenta",
      "Push notification"
    ],
    "fields": [
      "Email?",
      "Inbox Talenta?",
      "Push notification?"
    ],
    "filters": [],
    "tabs": [
      "General",
      "Time management"
    ],
    "action": "Save settings",
    "notes": "- **Job position:** Chart/Table view; tabel Table memiliki Job position code, Name, Parent job position, Employees, pencarian/filter, export, bulk update, Add/Import. Actions record yang terlihat: View details, Edit, Set inactive, Permanently delete. Form tambah: Job position code (maks. 25), Job position name, Parent job position, Job description; Save, Save and add other, Cancel. Form contoh QA TEST ONLY diisi lalu dibatalkan.\n- **Grade & class:** tabel Grade memakai Grade Name; tabel Class memakai Class Name, Parent, From, To. Keduanya menampilkan Export Data, Import, Bulk Update, New, pencarian dan pagination. Form Grade berisi Grade Name; Class berisi Class Name, From, To, Grade; Close/Save. Isian uji dibatalkan.\n- **Auto Generate Format:** halaman awal memiliki Guidebook/Create format. Form: Form Type, kondisi Employment status, Add component dengan tipe Text, Increment number, Join date, Branch code, Organization code, Job position code, Job level code, Generated Date; input Text/Start number, Advance option, preview, Auto ID reset dan Auto ID sequencing, Cancel/Save. Tidak disimpan.\n- **Files:** ada toggle “Allow employees to edit or delete files” dan tautan Manage files. Toggle dibiarkan.\n- **Custom Field:** tab Employee info dan Include on feature; pencarian/filter; tabel employee field berkolom Field name, Field type, Editing method, Created date, Show on, sedangkan feature field berkolom Custom field name, Custom field type, Feature page, Created date, Last modified, Status. Form employee field: Field name (maks. 120), Editing method (admin only/self-edit/transfer only/API only), Show on, Field type (Text input, Text area, Dropdown list, Date picker), Cancel/Create. Form berisi nama uji dan dibatalkan.\n- **NPP:** tabel memiliki Npp Name, Npp Number, Branch, JKK, Action. Form tambah berisi NPP Name, NPP Number, JKK, Branch, Close/Save. Tidak ada identifier atau tarif existing yang dicatat.\n- **Employment Status:** tabel Employment status name, Sign date, End date; search, Edit, pagination dan Add employment status. Form: Employment status name (maks. 60), This status has sign date, This status has end date, Set specific duration for end date, Cancel/Save. Draft uji dibatalkan.\n- **Notification:** tab General dan Time management; tiap tipe notifikasi dapat diatur untuk Email, Inbox Talenta, Push notification. Kategori General: Change Data, Reminder, Delegation. Kategori Time management: Change Shift, Live Attendance, Time Off, Attendance, Overtime, Overtime Plan. Tidak ada toggle yang diubah.\n- **Settings → Company Info** juga menampilkan Company Info, Tax Info, Other Info serta tautan edit; halaman dibaca tanpa menyalin nilai identitas, kontak, pajak, atau perusahaan.\n\n- **Assets list:** filter kategori, kontrol kolom, export, clipboard/report control, Search asset/employee, Import assets, Add asset; KPI Total/Assigned/Unassigned assets; kolom Asset name, Category name, Asset number, Assigned employee, Last modified. Kosong. Form Add asset: Asset name dan Asset number (maks.60), Description (maks.200), Asset category wajib/Create asset category, Attachment (PDF/JPG/PNG/JPEG/DOCX/DOC/ZIP maks.10 MB), Purchase date/price, opsi Assign asset to employee dengan Employee dan Assigned date. Draft dibatalkan.\n- **Assigned assets:** Import, Assign asset, filter kategori, export, search; tabel Asset name, Assigned employee, Asset category, Asset number, Assigned date. Kosong.\n- **Asset category:** Import, Add category, export, Search; tabel Asset category, Total asset, Total assigned asset, Total unassigned asset. Kosong. Add category meminta Category name; modal dibatalkan.\n- **Announcements:** filter kategori, Search, Help, Create announcement; daftar kosong. Form meminta title, rich-text body, publish ke semua karyawan atau berdasarkan criteria, Category, Forms, Attachment (format office/PDF/gambar, maks.10 MB), opsi email, Cancel/Save & publish. Draft kosong dibatalkan; tidak ada pengumuman dikirim.\n- **User Activity Log:** date range, All email, All type, Apply filter, Export, Search; kolom Date, Email, Activity, Type. Satu baris ada; nilai record tidak disalin dan ekspor tidak dijalankan.\n- **Queue activity:** Search, Refresh, Help/Learn more; kolom Queue ID, Activity, Executed by, Submitted time, Started time, Status. Kosong.\n- **Notification:** Start/End date, Status (Cancel/Completed/Need Action/Skipped), Type (Bank Account Invalid/Employee Transfer/Reminder/Resign), Apply, Export, Search, pagination; kolom Type, Description, Effective Date, Payroll Name, Payroll Month, Created By, Created Date, Status, Action. Kosong; bulk Skip all tidak dijalankan.\n- **Company files:** tabs Company files/Employee files/Other files. Company files: New company files/Search, kolom Folder name, Shared to, Accessible from, Last modified by; Add folder mencakup Name (maks.60), Description (maks.200), Accessible on date, criteria semua/selected (Branch, Organization, Job position, Job level, Employment status, SBU, Employees), upload files, email/reminder. Employee files: categories All/Identity/Other, filters All employees/All job positions, Search, Employee files report, Add file/Add employee files; kategori berisi satu input, file meminta employee+attachment, bulk upload mendukung folder per karyawan. File types termasuk PDF/gambar/Office/CSV/TXT/ZIP/RAR, batas 10 MB per file dan 100 file/1 GB per aksi upload. Other files: Search, Delete, tabel File Name, Type File, Uploader, Date Created. Semua daftar kosong; draft nama/description/kategori dibatalkan; tidak ada file diunggah/dihapus.\n- **Onboarding:** tab On Progress/Completed; Select Month Period, Select Year Period, jumlah baris; tidak ada hasil.\n- **Report Builder:** dashboard Create report/Guidebook/Insight. Draft laporan meminta Name (maks.28), Description (maks.120), type Latest update/Daily/Monthly; kategori field berbeda tiap tipe (Latest update: Personal, Payroll Information, Employment, Education; Daily menambah Attendance dan request; Monthly menambah Payroll Transaction, Tax Detail, Monthly Attendance). Search/Select all/Clear all/pilihan fields/Add filter to selected, format XLSX/CSV, schedule (Latest update: Not scheduled/Daily). Draft filter/report dibatalkan; tidak ada data diekspor.\n- **Document Template:** Generated documents dan Create template (New/Upload), Search. New template mencakup Template name/description/category (General, Employee Transfer, Overtime Request, Onboarding, Offboarding, Reprimand, Resignation), layout dokumen, pilihan shortcode, auto employee-file sync dan sync saat signature, document number, header/footer, rich-text/shortcode/import document. Upload template meminta name (maks.30), description, category, numbering manual atau auto-generated, stamp metadata, file .doc/.docx maks.5 MB, shortcode dan sync. Draft dibatalkan tanpa upload.\n- **Generated documents:** filter month/template/employee, status employee-file (All/Not synced/Synced/File deleted), status dokumen (Active/Revoked), status Mekari Sign; KPI total/not sent/awaiting/partial/signed; export/search; kolom Transaction ID, Exported date, Employee name, Template name, Document number, Exported by, Employee files, Mekari Sign, Document status, Source. Tidak ada record; ekspor tidak dilakukan.",
    "verified": true
  },
  {
    "id": "settings-company-restricted-employee",
    "group": "Settings · Company",
    "name": "Restricted employee",
    "columns": [
      "Field type",
      "Restricted data",
      "Reason",
      "Period",
      "Restriction method"
    ],
    "fields": [
      "Field type!",
      "Restricted data!",
      "Reason",
      "Period",
      "Restriction method"
    ],
    "filters": [],
    "tabs": [],
    "action": "Add restriction",
    "notes": "- **Restricted employee:** Import, Add restriction, Help, Search; kolom Field type, Restricted data, Reason, Period, Restriction method. Daftar kosong. Form add tidak diisi karena identitas yang diminta sensitif.\n- **Offboarding → Task template:** list kosong; Create Task form berisi Task name (maks.60), Task for (Resignee/PIC), Due on (hari sebelum resign), Description (maks.200), Attachment, auto-add semua employee/selected organization/selected branch, opsi email ke assignee, Cancel/Create. Draft dibatalkan tanpa attachment, task, atau email.\n- **Offboarding → Forms and docs setting:** form Request resign/Exit interview, Add form, Documents/Add document (maks.10 dokumen), tautan Forms/Document Template. Add form/document mencari item yang dapat dipilih; tidak ada hasil. Toggle tidak diubah, item tidak ditambahkan.",
    "verified": true
  },
  {
    "id": "settings-time-shift",
    "group": "Settings · Time",
    "name": "Shift",
    "columns": [
      "Shift name",
      "Shift code",
      "Working hour",
      "Show in request",
      "Break hour",
      "Shift eligibility",
      "Assign to",
      "Description"
    ],
    "fields": [],
    "filters": [
      "Status"
    ],
    "tabs": [],
    "action": "Create new shift",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "settings-time-break",
    "group": "Settings · Time",
    "name": "Break",
    "columns": [
      "Name",
      "Created date",
      "Break",
      "Assigned to"
    ],
    "fields": [
      "Name!",
      "Schedule break start!",
      "Schedule break end!"
    ],
    "filters": [],
    "tabs": [],
    "action": "Add break",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "settings-time-machine",
    "group": "Settings · Time",
    "name": "Machine",
    "columns": [
      "Name Setting",
      "Edit",
      "Delete",
      "Token"
    ],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "New",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "settings-time-auto-schedule",
    "group": "Settings · Time",
    "name": "Auto schedule",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "- **Attendance → Shift:** tabel berisi Shift name, Shift code, Working hour, Show in request, Break hour, Shift eligibility, Assign to, Description; ada pencarian, pagination, kontrol kolom, import, dan Create new shift. Menu Actions terlihat pada baris tetapi tidak dibuka; tidak ada shift ditambah atau diubah.\n- **Attendance → Break:** tabel Name, Created date, Break, Assigned to; pencarian dan Add break. Form draft: Name wajib, Schedule break start/end, tombol Add break (menambah baris jam), Submit/Cancel. Draft ditutup tanpa isi/simpan.\n- **Attendance → Machine (halaman legacy):** tabel Name Setting, Edit, Delete, Token; tidak ada record. Tombol New tidak dibuka karena dapat menyiapkan kredensial mesin.\n- **Auto schedule:** halaman beta berupa panduan/landing dengan manfaat, Getting started (Learn about auto schedule, Set up work hour, Create a preset), Learn more dan Help. Tidak ada schedule/preset yang ditambah.\n- **Live attendance → Location set up:** dua tampilan Employee/Location. Employee table: Employee, Branch, Organization, Location settings; filter Branch, Employment status, Organization, Job position, Job level, search, kontrol kolom, Assign location, Import, pagination. Tampilan Location table: Location setting name, GPS Location, Assigned to, Break settings, Auto assignment rules; search/export dan Create location setting. Kedua daftar lokasi kosong; tidak membuka record orang atau menugaskan lokasi.\n- **Create location setting:** Location settings name (maks.175), GPS Location (Flexible/Set location); assigned employees table Employee/Branch/Organization dengan Add & edit employee, pencarian/filter kolom; Auto assignment rules toggle. Mode Set location membuka tabel Location name/Address/Radius, search, Add location. Drawer Add Location meminta Name (maks.175), Radius dalam meter (maks.100.000), pencarian tempat di peta, serta menampilkan Address dan Coordinate. Drawer dan seluruh draft dibatalkan tanpa lokasi, alamat, koordinat atau employee dimasukkan.\n- **Live attendance → Mobile set up:** pengaturan Mobile clock in/clock out berupa Selfie required, Note mandatory, dan Live tracking; Save changes. Tidak ada toggle atau perubahan yang disimpan.\n- **Portal:** General settings menyediakan Offline mode; List of devices menyediakan Device Quota, search nama/ID, dan kolom Device name, Device ID, Last login, Device Model, Employee List. Tidak ada device; saat dimuat muncul toast Bad Request. Toggle offline mode tidak diubah dan tidak ada perangkat didaftarkan.",
    "verified": false
  },
  {
    "id": "settings-time-location-set-up",
    "group": "Settings · Time",
    "name": "Location set up",
    "columns": [
      "Employee",
      "Branch",
      "Organization",
      "Location settings"
    ],
    "fields": [
      "Location settings name!",
      "GPS Location",
      "Employee",
      "Auto assignment rules?",
      "Location name",
      "Address",
      "Radius",
      "Coordinate"
    ],
    "filters": [
      "Branch",
      "Employment status",
      "Organization",
      "Job position",
      "Job level"
    ],
    "tabs": [
      "Employee",
      "Location"
    ],
    "action": "Create location setting",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "settings-time-mobile-set-up",
    "group": "Settings · Time",
    "name": "Mobile set up",
    "columns": [],
    "fields": [
      "Selfie required?",
      "Note mandatory?",
      "Live tracking?"
    ],
    "filters": [],
    "tabs": [],
    "action": "Save changes",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "settings-time-portal",
    "group": "Settings · Time",
    "name": "Portal",
    "columns": [
      "Device name",
      "Device ID",
      "Last login",
      "Device Model",
      "Employee List"
    ],
    "fields": [
      "Offline mode?"
    ],
    "filters": [],
    "tabs": [
      "General settings",
      "List of devices"
    ],
    "action": "Save changes",
    "notes": "- **Attendance → Shift:** tabel berisi Shift name, Shift code, Working hour, Show in request, Break hour, Shift eligibility, Assign to, Description; ada pencarian, pagination, kontrol kolom, import, dan Create new shift. Menu Actions terlihat pada baris tetapi tidak dibuka; tidak ada shift ditambah atau diubah.\n- **Attendance → Break:** tabel Name, Created date, Break, Assigned to; pencarian dan Add break. Form draft: Name wajib, Schedule break start/end, tombol Add break (menambah baris jam), Submit/Cancel. Draft ditutup tanpa isi/simpan.\n- **Attendance → Machine (halaman legacy):** tabel Name Setting, Edit, Delete, Token; tidak ada record. Tombol New tidak dibuka karena dapat menyiapkan kredensial mesin.\n- **Auto schedule:** halaman beta berupa panduan/landing dengan manfaat, Getting started (Learn about auto schedule, Set up work hour, Create a preset), Learn more dan Help. Tidak ada schedule/preset yang ditambah.\n- **Live attendance → Location set up:** dua tampilan Employee/Location. Employee table: Employee, Branch, Organization, Location settings; filter Branch, Employment status, Organization, Job position, Job level, search, kontrol kolom, Assign location, Import, pagination. Tampilan Location table: Location setting name, GPS Location, Assigned to, Break settings, Auto assignment rules; search/export dan Create location setting. Kedua daftar lokasi kosong; tidak membuka record orang atau menugaskan lokasi.\n- **Create location setting:** Location settings name (maks.175), GPS Location (Flexible/Set location); assigned employees table Employee/Branch/Organization dengan Add & edit employee, pencarian/filter kolom; Auto assignment rules toggle. Mode Set location membuka tabel Location name/Address/Radius, search, Add location. Drawer Add Location meminta Name (maks.175), Radius dalam meter (maks.100.000), pencarian tempat di peta, serta menampilkan Address dan Coordinate. Drawer dan seluruh draft dibatalkan tanpa lokasi, alamat, koordinat atau employee dimasukkan.\n- **Live attendance → Mobile set up:** pengaturan Mobile clock in/clock out berupa Selfie required, Note mandatory, dan Live tracking; Save changes. Tidak ada toggle atau perubahan yang disimpan.\n- **Portal:** General settings menyediakan Offline mode; List of devices menyediakan Device Quota, search nama/ID, dan kolom Device name, Device ID, Last login, Device Model, Employee List. Tidak ada device; saat dimuat muncul toast Bad Request. Toggle offline mode tidak diubah dan tidak ada perangkat didaftarkan.",
    "verified": true
  },
  {
    "id": "settings-time-time-off",
    "group": "Settings · Time",
    "name": "Time off",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "### Time off requests\n\n### Time off transaction",
    "verified": false
  },
  {
    "id": "settings-time-overtime",
    "group": "Settings · Time",
    "name": "Overtime",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "### Overtime requests",
    "verified": false
  },
  {
    "id": "settings-time-holiday",
    "group": "Settings · Time",
    "name": "Holiday",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "settings-time-timesheet",
    "group": "Settings · Time",
    "name": "Timesheet",
    "columns": [
      "Employee",
      "Setting name"
    ],
    "fields": [
      "Setting name!",
      "Set reminder time track?",
      "Time",
      "Repeat every",
      "Enable time tracker on live attendance?",
      "Enable shift selection?",
      "Enable location selection?",
      "Employee"
    ],
    "filters": [
      "Branch",
      "Organization"
    ],
    "tabs": [
      "Employees",
      "Setting"
    ],
    "action": "Create setting",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "settings-payroll-payroll-schedule",
    "group": "Settings · Payroll",
    "name": "Payroll schedule",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "settings-payroll-cut-off-tax-settings",
    "group": "Settings · Payroll",
    "name": "Cut Off & Tax Settings",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "settings-payroll-payroll-component",
    "group": "Settings · Payroll",
    "name": "Payroll component",
    "columns": [
      "Name",
      "Amount",
      "Type",
      "Tax"
    ],
    "fields": [
      "Name!",
      "Amount",
      "Currency",
      "Payroll Payment Schedule",
      "Type",
      "Tax",
      "Default?",
      "Pro Rate?",
      "Formula",
      "Zakat?"
    ],
    "filters": [],
    "tabs": [
      "Allowance",
      "Deduction",
      "Benefit",
      "Custom Rate",
      "Currency Rate"
    ],
    "action": "Add component",
    "notes": "### Payroll component adjustment",
    "verified": true
  },
  {
    "id": "settings-payroll-payslip-templates",
    "group": "Settings · Payroll",
    "name": "Payslip templates",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "settings-payroll-taxslip",
    "group": "Settings · Payroll",
    "name": "Taxslip",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "settings-payroll-pro-rate",
    "group": "Settings · Payroll",
    "name": "Pro-rate",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "settings-payroll-absence",
    "group": "Settings · Payroll",
    "name": "Absence",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "settings-payroll-thr",
    "group": "Settings · Payroll",
    "name": "THR",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "settings-payroll-time-off-compensation",
    "group": "Settings · Payroll",
    "name": "Time off compensation",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "settings-payroll-payment-schedule",
    "group": "Settings · Payroll",
    "name": "Payment schedule",
    "columns": [
      "Name",
      "Type",
      "Payment Schedule Date",
      "Attendance",
      "Payroll",
      "Attendance Pay Last Month",
      "Weekly Payment"
    ],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "Add",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "settings-payroll-resign-compensation",
    "group": "Settings · Payroll",
    "name": "Resign compensation",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "settings-payroll-custom-compensation",
    "group": "Settings · Payroll",
    "name": "Custom compensation",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "settings-finance-reimbursement",
    "group": "Settings · Finance",
    "name": "Reimbursement",
    "columns": [
      "Reimbursement Name",
      "Effective Date",
      "Status"
    ],
    "fields": [
      "Reimbursement Name!",
      "Effective Date!",
      "Reimbursement Description",
      "Unlimited amount?",
      "Default reimbursement?",
      "Include in Take Home Pay?",
      "Taxable?",
      "Prorate on First Year?",
      "No Expiry Date?",
      "Max Request Per Emerge",
      "Expired In",
      "Emerge",
      "Reimbursement Limit",
      "Emerge Day",
      "First Year",
      "Benefit Name",
      "Max Request",
      "Min Next Claim",
      "Formula"
    ],
    "filters": [],
    "tabs": [],
    "action": "Add policy",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "settings-finance-loan",
    "group": "Settings · Finance",
    "name": "Loan",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "### Loan\n\nSubmenu **Loan** tercantum di menu Finance; ketika dibuka dari Settings, aplikasi kembali ke Dashboard sehingga halaman Settings Loan tidak berhasil diperiksa pada sesi ini. Modul Loan Finance utama yang tersedia tetap tercatat pada bagian Finance di atas.",
    "verified": false
  },
  {
    "id": "settings-ess-approval",
    "group": "Settings · ESS",
    "name": "Approval",
    "columns": [
      "Name Setting",
      "Request",
      "Approval"
    ],
    "fields": [
      "Name Setting!",
      "Request",
      "Approval"
    ],
    "filters": [],
    "tabs": [],
    "action": "New",
    "notes": "- **Approval:** tabel konfigurasi memakai Name Setting, Request, Approval; action yang terlihat mencakup Edit, Copy, New, Export, Import, atau No Approval, bergantung baris. Kategori konfigurasi meliputi overtime/time off/delegation/change-data/change-shift/live-attendance/attendance/reimbursement, add employee, employee transfer, payroll component update, payroll, goals/review, forms, task & timesheet, serta manpower planning. Tidak ada approval flow yang diubah atau diimpor.\n- **New approval (BETA):** kartu Add employee dan Employee transfer memiliki toggle; Change data request, Overtime request dan Manpower Planning memiliki Go to Settings. Halaman detail menampilkan Name, Description, Last updated, Updated by, Actions; action row: Edit, Import from existing. Form Create approval (overtime) berisi Approval name, Description, Total overtime per month (pilihan Greater than or equal to, Greater than, Less than or equal to, Less than, In between) dan jam, Day type (Week days, Day off, Special holiday, National holiday, Company holiday), Set criteria, Add criteria, All filters (Branch, Organization, Job position, Job level, SBU), cakupan karyawan (All employee, Job Position, Organization, Job Level, Employee ID, Branch, SBU), Auto ascend, Set approver, Cancel/Save. Draft memakai QA TEST ONLY dan dibatalkan; kriteria/filter tidak diterapkan.\n- **Delegation:** filter Date range dan modules, search, tabel Start date, End date, From employee, To employee, Delegated modules; Add delegation membuka From employee, To employee, Delegation date, Modules to delegate dan tombol Cancel/Save. Modul yang dapat didelegasikan: Overtime request, Timeoff request, Delegation request, Change shift request, Attendance request, Change data request, Reimbursement request, Request add employee, Live attendance request, Employee transfer request, Form request, Edit review request, Report review, Sync attendance data, Update payroll component approval, Notification review, Task review request. Modal ditutup tanpa memilih employee atau menyimpan.\n- **Module:** section Employee, Employee Organization Chart, My Info, Calendar, Delegation, Email & Reminder, ESS request, Change data, Projects/Tasks/Timesheet. Tabel directory dapat mencari/memilih field dan memakai pagination; schema field directory yang tersedia: Organization Name, Job Position, Job Level, Employment Status, Join Date, Branch, Employee ID, Email, Residential Address, Birth Date, Mobile Phone, Gender, Marital Status, Blood Type, Religion, Phone, Citizen ID Address, Grade, Class. Tabel organization chart mencakup Employee ID/Employee Name, Photo, Organization, Job Position, Branch, Employment Status, SBU.\n- ESS request table: ESS Request, Show Menu, Notes Mandatory, Attachment Mandatory; item: Attendance, Change Data, Change Shift, Delegation, Live Attendance, Overtime, Reimbursement, Timeoff. Change-data request field table memiliki 23 field profil; label mencakup First/Last Name, Email, NIK/NPWP, Passport, Postal/Citizen ID/Residential Address, Birth Date/Place, marital/gender/religion/blood type, mobile phone, BPJS, profile picture, bank account, tax status. Hanya label schema yang dicatat, tanpa nilai. Ada search, rows-per-page/pagination, dan Save settings; tidak ada pengaturan ESS yang disimpan.",
    "verified": true
  },
  {
    "id": "settings-ess-new-approval",
    "group": "Settings · ESS",
    "name": "New approval",
    "columns": [
      "Name",
      "Description",
      "Last updated",
      "Updated by",
      "Actions"
    ],
    "fields": [
      "Approval name!",
      "Description",
      "Total overtime per month",
      "Hours",
      "Day type",
      "Criteria",
      "Branch",
      "Organization",
      "Job position",
      "Job level",
      "SBU",
      "Employee scope",
      "Auto ascend?",
      "Approver!"
    ],
    "filters": [],
    "tabs": [],
    "action": "Create approval",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "settings-ess-delegation",
    "group": "Settings · ESS",
    "name": "Delegation",
    "columns": [
      "Start date",
      "End date",
      "From employee",
      "To employee",
      "Delegated modules"
    ],
    "fields": [
      "From employee!",
      "To employee!",
      "Delegation date!",
      "Modules to delegate!"
    ],
    "filters": [
      "Date range",
      "Module"
    ],
    "tabs": [],
    "action": "Add delegation",
    "notes": "- **Approval:** tabel konfigurasi memakai Name Setting, Request, Approval; action yang terlihat mencakup Edit, Copy, New, Export, Import, atau No Approval, bergantung baris. Kategori konfigurasi meliputi overtime/time off/delegation/change-data/change-shift/live-attendance/attendance/reimbursement, add employee, employee transfer, payroll component update, payroll, goals/review, forms, task & timesheet, serta manpower planning. Tidak ada approval flow yang diubah atau diimpor.\n- **New approval (BETA):** kartu Add employee dan Employee transfer memiliki toggle; Change data request, Overtime request dan Manpower Planning memiliki Go to Settings. Halaman detail menampilkan Name, Description, Last updated, Updated by, Actions; action row: Edit, Import from existing. Form Create approval (overtime) berisi Approval name, Description, Total overtime per month (pilihan Greater than or equal to, Greater than, Less than or equal to, Less than, In between) dan jam, Day type (Week days, Day off, Special holiday, National holiday, Company holiday), Set criteria, Add criteria, All filters (Branch, Organization, Job position, Job level, SBU), cakupan karyawan (All employee, Job Position, Organization, Job Level, Employee ID, Branch, SBU), Auto ascend, Set approver, Cancel/Save. Draft memakai QA TEST ONLY dan dibatalkan; kriteria/filter tidak diterapkan.\n- **Delegation:** filter Date range dan modules, search, tabel Start date, End date, From employee, To employee, Delegated modules; Add delegation membuka From employee, To employee, Delegation date, Modules to delegate dan tombol Cancel/Save. Modul yang dapat didelegasikan: Overtime request, Timeoff request, Delegation request, Change shift request, Attendance request, Change data request, Reimbursement request, Request add employee, Live attendance request, Employee transfer request, Form request, Edit review request, Report review, Sync attendance data, Update payroll component approval, Notification review, Task review request. Modal ditutup tanpa memilih employee atau menyimpan.\n- **Module:** section Employee, Employee Organization Chart, My Info, Calendar, Delegation, Email & Reminder, ESS request, Change data, Projects/Tasks/Timesheet. Tabel directory dapat mencari/memilih field dan memakai pagination; schema field directory yang tersedia: Organization Name, Job Position, Job Level, Employment Status, Join Date, Branch, Employee ID, Email, Residential Address, Birth Date, Mobile Phone, Gender, Marital Status, Blood Type, Religion, Phone, Citizen ID Address, Grade, Class. Tabel organization chart mencakup Employee ID/Employee Name, Photo, Organization, Job Position, Branch, Employment Status, SBU.\n- ESS request table: ESS Request, Show Menu, Notes Mandatory, Attachment Mandatory; item: Attendance, Change Data, Change Shift, Delegation, Live Attendance, Overtime, Reimbursement, Timeoff. Change-data request field table memiliki 23 field profil; label mencakup First/Last Name, Email, NIK/NPWP, Passport, Postal/Citizen ID/Residential Address, Birth Date/Place, marital/gender/religion/blood type, mobile phone, BPJS, profile picture, bank account, tax status. Hanya label schema yang dicatat, tanpa nilai. Ada search, rows-per-page/pagination, dan Save settings; tidak ada pengaturan ESS yang disimpan.",
    "verified": true
  },
  {
    "id": "settings-ess-module",
    "group": "Settings · ESS",
    "name": "Module",
    "columns": [
      "Field",
      "Show Menu",
      "Notes Mandatory",
      "Attachment Mandatory"
    ],
    "fields": [
      "Show Menu?",
      "Notes Mandatory?",
      "Attachment Mandatory?"
    ],
    "filters": [],
    "tabs": [
      "Employee",
      "Employee Organization Chart",
      "My Info",
      "Calendar",
      "Delegation",
      "Email & Reminder",
      "ESS request",
      "Change data",
      "Projects/Tasks/Timesheet"
    ],
    "action": "Save settings",
    "notes": "- **Approval:** tabel konfigurasi memakai Name Setting, Request, Approval; action yang terlihat mencakup Edit, Copy, New, Export, Import, atau No Approval, bergantung baris. Kategori konfigurasi meliputi overtime/time off/delegation/change-data/change-shift/live-attendance/attendance/reimbursement, add employee, employee transfer, payroll component update, payroll, goals/review, forms, task & timesheet, serta manpower planning. Tidak ada approval flow yang diubah atau diimpor.\n- **New approval (BETA):** kartu Add employee dan Employee transfer memiliki toggle; Change data request, Overtime request dan Manpower Planning memiliki Go to Settings. Halaman detail menampilkan Name, Description, Last updated, Updated by, Actions; action row: Edit, Import from existing. Form Create approval (overtime) berisi Approval name, Description, Total overtime per month (pilihan Greater than or equal to, Greater than, Less than or equal to, Less than, In between) dan jam, Day type (Week days, Day off, Special holiday, National holiday, Company holiday), Set criteria, Add criteria, All filters (Branch, Organization, Job position, Job level, SBU), cakupan karyawan (All employee, Job Position, Organization, Job Level, Employee ID, Branch, SBU), Auto ascend, Set approver, Cancel/Save. Draft memakai QA TEST ONLY dan dibatalkan; kriteria/filter tidak diterapkan.\n- **Delegation:** filter Date range dan modules, search, tabel Start date, End date, From employee, To employee, Delegated modules; Add delegation membuka From employee, To employee, Delegation date, Modules to delegate dan tombol Cancel/Save. Modul yang dapat didelegasikan: Overtime request, Timeoff request, Delegation request, Change shift request, Attendance request, Change data request, Reimbursement request, Request add employee, Live attendance request, Employee transfer request, Form request, Edit review request, Report review, Sync attendance data, Update payroll component approval, Notification review, Task review request. Modal ditutup tanpa memilih employee atau menyimpan.\n- **Module:** section Employee, Employee Organization Chart, My Info, Calendar, Delegation, Email & Reminder, ESS request, Change data, Projects/Tasks/Timesheet. Tabel directory dapat mencari/memilih field dan memakai pagination; schema field directory yang tersedia: Organization Name, Job Position, Job Level, Employment Status, Join Date, Branch, Employee ID, Email, Residential Address, Birth Date, Mobile Phone, Gender, Marital Status, Blood Type, Religion, Phone, Citizen ID Address, Grade, Class. Tabel organization chart mencakup Employee ID/Employee Name, Photo, Organization, Job Position, Branch, Employment Status, SBU.\n- ESS request table: ESS Request, Show Menu, Notes Mandatory, Attachment Mandatory; item: Attendance, Change Data, Change Shift, Delegation, Live Attendance, Overtime, Reimbursement, Timeoff. Change-data request field table memiliki 23 field profil; label mencakup First/Last Name, Email, NIK/NPWP, Passport, Postal/Citizen ID/Residential Address, Birth Date/Place, marital/gender/religion/blood type, mobile phone, BPJS, profile picture, bank account, tax status. Hanya label schema yang dicatat, tanpa nilai. Ada search, rows-per-page/pagination, dan Save settings; tidak ada pengaturan ESS yang disimpan.",
    "verified": true
  },
  {
    "id": "settings-users-users",
    "group": "Settings · Users",
    "name": "Users",
    "columns": [
      "Photo",
      "Employee ID",
      "Fullname",
      "Role",
      "Last Action",
      "Action"
    ],
    "fields": [
      "Employee!",
      "Email!",
      "Role"
    ],
    "filters": [],
    "tabs": [],
    "action": "Invite Employee",
    "notes": "- **Users:** pencarian, rows-per-page/pagination, Invite Employee dan Export; kolom Photo, Employee ID, Fullname, Role, Last Action, Action. Tidak ada user ditambahkan.\n- **Invitation to Talenta:** filter/pencarian dan Export; tabel Employee name, Employee ID, Email, Job position, Organization, Branch, Job level, Join date. Daftar kosong; tidak ada invitation dikirim.\n- **Access role:** Search, pagination, New; tabel Role Name dan kolom actions. Form role baru meminta Role Name, Role (Super Admin/Admin/Employee/Finance), cakupan Organization/Job Position/Job Level/Branch/SBU, Role Type (Default/Custom), permission groups Time Management, Employee, Payroll, Approval List, Manpower Planning, General Ledger Mapper, Subordinate Time Off Request, Subordinate Overtime Request. Form ditutup tanpa membuat role atau mengubah hak akses.\n- **Onboarding Setting:** Create New Set; tabel Description/Job. Form: Name, Job Position, Work Location, Instruction, lokasi peta, Task for inviter, Task for new employee, Organization, Close/Save. Teks sintetis QA TEST ONLY diisi lalu dibatalkan.\n- **Task Setting:** dua tabel Task for inviter dan Task for new employee; masing-masing search, pagination, kolom Description, Type, Action, Add New Task. Form task: Task Type (Text Only/Upload/Download), Task Description, Close/Save. Teks uji dibatalkan.\n- **Offboarding** tersedia dalam navigasi Users; belum dibuka dari bagian Settings.",
    "verified": true
  },
  {
    "id": "settings-users-invitation-to-talenta",
    "group": "Settings · Users",
    "name": "Invitation to Talenta",
    "columns": [
      "Employee name",
      "Employee ID",
      "Email",
      "Job position",
      "Organization",
      "Branch",
      "Job level",
      "Join date"
    ],
    "fields": [],
    "filters": [
      "Status"
    ],
    "tabs": [],
    "action": "Export",
    "notes": "- **Users:** pencarian, rows-per-page/pagination, Invite Employee dan Export; kolom Photo, Employee ID, Fullname, Role, Last Action, Action. Tidak ada user ditambahkan.\n- **Invitation to Talenta:** filter/pencarian dan Export; tabel Employee name, Employee ID, Email, Job position, Organization, Branch, Job level, Join date. Daftar kosong; tidak ada invitation dikirim.\n- **Access role:** Search, pagination, New; tabel Role Name dan kolom actions. Form role baru meminta Role Name, Role (Super Admin/Admin/Employee/Finance), cakupan Organization/Job Position/Job Level/Branch/SBU, Role Type (Default/Custom), permission groups Time Management, Employee, Payroll, Approval List, Manpower Planning, General Ledger Mapper, Subordinate Time Off Request, Subordinate Overtime Request. Form ditutup tanpa membuat role atau mengubah hak akses.\n- **Onboarding Setting:** Create New Set; tabel Description/Job. Form: Name, Job Position, Work Location, Instruction, lokasi peta, Task for inviter, Task for new employee, Organization, Close/Save. Teks sintetis QA TEST ONLY diisi lalu dibatalkan.\n- **Task Setting:** dua tabel Task for inviter dan Task for new employee; masing-masing search, pagination, kolom Description, Type, Action, Add New Task. Form task: Task Type (Text Only/Upload/Download), Task Description, Close/Save. Teks uji dibatalkan.\n- **Offboarding** tersedia dalam navigasi Users; belum dibuka dari bagian Settings.",
    "verified": true
  },
  {
    "id": "settings-users-access-role",
    "group": "Settings · Users",
    "name": "Access role",
    "columns": [
      "Role Name",
      "Actions"
    ],
    "fields": [
      "Role Name!",
      "Role!",
      "Organization",
      "Job position",
      "Job level",
      "Branch",
      "SBU",
      "Role Type",
      "Time Management?",
      "Employee?",
      "Payroll?",
      "Approval List?",
      "Manpower Planning?",
      "General Ledger Mapper?",
      "Subordinate Time Off Request?",
      "Subordinate Overtime Request?"
    ],
    "filters": [],
    "tabs": [],
    "action": "New role",
    "notes": "- **Users:** pencarian, rows-per-page/pagination, Invite Employee dan Export; kolom Photo, Employee ID, Fullname, Role, Last Action, Action. Tidak ada user ditambahkan.\n- **Invitation to Talenta:** filter/pencarian dan Export; tabel Employee name, Employee ID, Email, Job position, Organization, Branch, Job level, Join date. Daftar kosong; tidak ada invitation dikirim.\n- **Access role:** Search, pagination, New; tabel Role Name dan kolom actions. Form role baru meminta Role Name, Role (Super Admin/Admin/Employee/Finance), cakupan Organization/Job Position/Job Level/Branch/SBU, Role Type (Default/Custom), permission groups Time Management, Employee, Payroll, Approval List, Manpower Planning, General Ledger Mapper, Subordinate Time Off Request, Subordinate Overtime Request. Form ditutup tanpa membuat role atau mengubah hak akses.\n- **Onboarding Setting:** Create New Set; tabel Description/Job. Form: Name, Job Position, Work Location, Instruction, lokasi peta, Task for inviter, Task for new employee, Organization, Close/Save. Teks sintetis QA TEST ONLY diisi lalu dibatalkan.\n- **Task Setting:** dua tabel Task for inviter dan Task for new employee; masing-masing search, pagination, kolom Description, Type, Action, Add New Task. Form task: Task Type (Text Only/Upload/Download), Task Description, Close/Save. Teks uji dibatalkan.\n- **Offboarding** tersedia dalam navigasi Users; belum dibuka dari bagian Settings.",
    "verified": true
  },
  {
    "id": "settings-users-onboarding-setting",
    "group": "Settings · Users",
    "name": "Onboarding setting",
    "columns": [
      "Description",
      "Job"
    ],
    "fields": [
      "Name!",
      "Job Position",
      "Work Location",
      "Instruction",
      "Task for inviter",
      "Task for new employee",
      "Organization"
    ],
    "filters": [],
    "tabs": [],
    "action": "Create New Set",
    "notes": "- **Users:** pencarian, rows-per-page/pagination, Invite Employee dan Export; kolom Photo, Employee ID, Fullname, Role, Last Action, Action. Tidak ada user ditambahkan.\n- **Invitation to Talenta:** filter/pencarian dan Export; tabel Employee name, Employee ID, Email, Job position, Organization, Branch, Job level, Join date. Daftar kosong; tidak ada invitation dikirim.\n- **Access role:** Search, pagination, New; tabel Role Name dan kolom actions. Form role baru meminta Role Name, Role (Super Admin/Admin/Employee/Finance), cakupan Organization/Job Position/Job Level/Branch/SBU, Role Type (Default/Custom), permission groups Time Management, Employee, Payroll, Approval List, Manpower Planning, General Ledger Mapper, Subordinate Time Off Request, Subordinate Overtime Request. Form ditutup tanpa membuat role atau mengubah hak akses.\n- **Onboarding Setting:** Create New Set; tabel Description/Job. Form: Name, Job Position, Work Location, Instruction, lokasi peta, Task for inviter, Task for new employee, Organization, Close/Save. Teks sintetis QA TEST ONLY diisi lalu dibatalkan.\n- **Task Setting:** dua tabel Task for inviter dan Task for new employee; masing-masing search, pagination, kolom Description, Type, Action, Add New Task. Form task: Task Type (Text Only/Upload/Download), Task Description, Close/Save. Teks uji dibatalkan.\n- **Offboarding** tersedia dalam navigasi Users; belum dibuka dari bagian Settings.",
    "verified": true
  },
  {
    "id": "settings-users-onboarding-task",
    "group": "Settings · Users",
    "name": "Onboarding task",
    "columns": [
      "Description",
      "Type",
      "Action"
    ],
    "fields": [
      "Task Type!",
      "Task Description!"
    ],
    "filters": [],
    "tabs": [
      "Task for inviter",
      "Task for new employee"
    ],
    "action": "Add New Task",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "settings-users-offboarding-task-template",
    "group": "Settings · Users",
    "name": "Offboarding task template",
    "columns": [
      "Task name",
      "Task for",
      "Due on"
    ],
    "fields": [
      "Task name!",
      "Task for",
      "Due on",
      "Description",
      "Attachment",
      "All employees?",
      "Organization",
      "Branch",
      "Email assignee?"
    ],
    "filters": [],
    "tabs": [],
    "action": "Create Task",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "settings-users-offboarding-forms-and-docs",
    "group": "Settings · Users",
    "name": "Offboarding forms and docs",
    "columns": [
      "Name",
      "Type"
    ],
    "fields": [
      "Request resign?",
      "Exit interview?",
      "Form",
      "Document"
    ],
    "filters": [],
    "tabs": [],
    "action": "Add form",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  },
  {
    "id": "applications-mekari-expense",
    "group": "Applications",
    "name": "Mekari Expense",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "applications-mekari-flex",
    "group": "Applications",
    "name": "Mekari Flex",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "applications-insurance",
    "group": "Applications",
    "name": "Insurance",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "applications-lms",
    "group": "Applications",
    "name": "LMS",
    "columns": [],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": false
  },
  {
    "id": "integrations-product",
    "group": "Integrations",
    "name": "Product",
    "columns": [
      "Add-on",
      "Provider",
      "Status"
    ],
    "fields": [],
    "filters": [],
    "tabs": [],
    "action": "Detail add-ons",
    "notes": "### Productivity → Projects, Tasks, Timesheet\n\n### Productivity → Forms & surveys",
    "verified": true
  },
  {
    "id": "integrations-api-data-masking",
    "group": "Integrations",
    "name": "API Data Masking",
    "columns": [
      "Category",
      "Field",
      "Masked"
    ],
    "fields": [
      "Employee identity?",
      "Payroll?",
      "Tax?",
      "Location?"
    ],
    "filters": [],
    "tabs": [],
    "action": "Save settings",
    "notes": "Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.",
    "verified": true
  }
];
