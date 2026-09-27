-- 0359: People grows its next generation.
--
-- The prototype this serves (prototypes/t-hr-prototype v17, "Itulah People")
-- adds six workloads the People module did not answer yet: swapping a roster
-- day with a colleague, asking head office to change somebody's employment,
-- the checklist a new joiner and a leaver work through, the recruitment
-- pipeline between "the shop asked" and "a record was opened", the monthly
-- performance figure that decides a bonus tier, and training. It also wants
-- the rule numbers in one place a screen can read.
--
-- What is deliberately **not** here: any new money. Statutory pay arithmetic
-- stays refused (0105 says why), the recruitment pipeline ends at the
-- employment kernel rather than minting its own pay, and `hr_policy` holds
-- *guidance numbers* a decider reads — never figures a journal trusts.
--
-- Reference data ships in this migration because it is the company's
-- vocabulary, not its day: templates, grade bands, structure membership and
-- the policy defaults. Employees, rosters, requests and the rest are rows the
-- running system creates, and `scripts/hr_e2e_seed.sh` mints a fresh set
-- through the API for end-to-end runs.

-- ── roster swaps ─────────────────────────────────────────────────────────
--
-- One request: "my 24th goes to you, yours comes to me". The roster itself is
-- untouched until a decision approves the swap — and the swap is then recorded
-- the only way a roster day may change, as another revision with an authority
-- behind it. Two people's plans move together or not at all.
CREATE TABLE roster_swap_request (
    id           text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id  text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    with_employee_id text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    place_id     text NOT NULL REFERENCES org_place(id),
    on_date      date NOT NULL,
    reason       text NOT NULL CHECK (btrim(reason) <> ''),
    state        text NOT NULL CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
    requested    jsonb NOT NULL,
    decision     jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT roster_swap_not_self CHECK (employee_id <> with_employee_id)
);

-- A queue of contradictory pending swaps over one person's one day has no
-- defined meaning; the first one filed is the one that is answered. Partial
-- uniques are indexes, not table constraints — Postgres has no in-table
-- spelling for them.
CREATE UNIQUE INDEX roster_swap_one_pending_per_day
    ON roster_swap_request (employee_id, on_date) WHERE (state = 'PENDING');

CREATE INDEX ix_roster_swap_place_date ON roster_swap_request (place_id, on_date);

-- ── employment change proposals ──────────────────────────────────────────
--
-- The four changes that rewrite who somebody is — promotion, transfer, salary,
-- separation — are decisions head office takes about a person, so they travel
-- as a proposal: the shop files it, head office answers it, and an approved
-- one is *applied* against the kernels that already own the writes
-- (assignments, pay agreements, the exit machinery). Nothing here writes those
-- tables directly; applying is a transaction in the HTTP layer that calls
-- each kernel the way its own routes do.
CREATE TABLE employee_change_proposal (
    id           text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id  text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    place_id     text NOT NULL REFERENCES org_place(id),
    kind         text NOT NULL CHECK (kind IN ('PROMOTION', 'TRANSFER', 'SALARY', 'SEPARATION')),
    -- What changes, as the person filing saw it: [{field, from, to}]. Guidance
    -- for the decider and the audit trail of intent; the applied truth is
    -- whatever the kernel wrote, recorded on the decision.
    props        jsonb NOT NULL,
    effective_on date NOT NULL,
    reason       text NOT NULL CHECK (btrim(reason) <> ''),
    state        text NOT NULL CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
    filed        jsonb NOT NULL,
    decision     jsonb,
    applied_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
    -- One pending proposal per person: two answers to "what happens to them
    -- on the 1st" is how an employment record becomes a rumour. Partial
    -- unique, so the history keeps as many decided rows as it earned.
);

CREATE UNIQUE INDEX employee_change_one_pending
    ON employee_change_proposal (employee_id) WHERE (state = 'PENDING');

-- ── the onboarding and separation checklist ──────────────────────────────
--
-- A template names one task and *who owns it*: head office, the store, IT, or
-- the employee themselves. The instance is per person, one row per template
-- task, so progress is a COUNT and an owner's queue is a WHERE — no JSONB to
-- fold, and the employee app can offer exactly the rows whose owner is the
-- reader.
CREATE TABLE lifecycle_task_template (
    id     text PRIMARY KEY CHECK (btrim(id) <> ''),
    label  text NOT NULL CHECK (btrim(label) <> ''),
    owner  text NOT NULL CHECK (owner IN ('HEAD_OFFICE', 'STORE', 'IT', 'EMPLOYEE')),
    kind   text NOT NULL CHECK (kind IN ('ONBOARDING', 'SEPARATION')),
    position integer NOT NULL CHECK (position BETWEEN 1 AND 99)
);

CREATE TABLE lifecycle_task (
    id          text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    kind        text NOT NULL CHECK (kind IN ('ONBOARDING', 'SEPARATION')),
    template_id text NOT NULL REFERENCES lifecycle_task_template(id),
    state       text NOT NULL CHECK (state IN ('PENDING', 'DONE')),
    done        jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (employee_id, template_id)
);

CREATE INDEX ix_lifecycle_task_employee ON lifecycle_task (employee_id, kind, state);

-- ── recruitment pipeline ─────────────────────────────────────────────────
--
-- The hire proposal (0110) stays the requisition: a shop asks, head office
-- answers. What was missing is everything between an approved requisition and
-- the employment kernel — who applied, who was interviewed, who was offered,
-- who accepted. The plan is the quota the requisition is checked against.
CREATE TABLE staffing_plan (
    id        text PRIMARY KEY CHECK (btrim(id) <> ''),
    place_id  text NOT NULL REFERENCES org_place(id),
    position  text NOT NULL CHECK (btrim(position) <> ''),
    -- e.g. '2026-S2'. A plan is for a span; the span is named, not implied.
    span      text NOT NULL CHECK (btrim(span) <> ''),
    headcount integer NOT NULL CHECK (headcount > 0),
    cost_minor bigint NOT NULL CHECK (cost_minor >= 0),
    defined   jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (place_id, position, span)
);

CREATE TABLE job_applicant (
    id          text PRIMARY KEY CHECK (btrim(id) <> ''),
    proposal_id text NOT NULL REFERENCES hire_proposal(id) ON DELETE CASCADE,
    place_id    text NOT NULL REFERENCES org_place(id),
    name        text NOT NULL CHECK (btrim(name) <> ''),
    phone       text,
    -- WALK_IN, JOB_SITE, REFERRAL, … — the operator's own vocabulary.
    source      text NOT NULL CHECK (btrim(source) <> ''),
    -- Who sent them, when the source is a referral. The referral bonus, if
    -- the operator files one, is a payroll adjustment naming this id.
    referrer_employee_id text REFERENCES employee(id) ON DELETE SET NULL,
    stage       text NOT NULL CHECK (stage IN ('NEW', 'SHORTLIST', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED')),
    stage_note  text,
    applied_on  date NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_job_applicant_proposal ON job_applicant (proposal_id, stage);

-- One scheduled conversation. The result is appended, never rewritten: a
-- second interview is a second row, and the funnel reads the latest.
CREATE TABLE applicant_interview (
    id           text PRIMARY KEY CHECK (btrim(id) <> ''),
    applicant_id text NOT NULL REFERENCES job_applicant(id) ON DELETE CASCADE,
    scheduled_at timestamptz NOT NULL,
    interviewer_employee_id text NOT NULL REFERENCES employee(id),
    result       text NOT NULL CHECK (result IN ('SCHEDULED', 'PASS', 'FAIL')),
    ratings      jsonb NOT NULL DEFAULT '{}'::jsonb,
    note         text,
    recorded     jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- The offer, and only one live offer per applicant — an applicant weighing two
-- offers is a decision somebody is dodging.
CREATE TABLE job_offer (
    id          text PRIMARY KEY CHECK (btrim(id) <> ''),
    applicant_id text NOT NULL UNIQUE REFERENCES job_applicant(id) ON DELETE CASCADE,
    base_minor  bigint NOT NULL CHECK (base_minor > 0),
    grade       text NOT NULL CHECK (btrim(grade) <> ''),
    starts_on   date NOT NULL,
    term        text NOT NULL CHECK (btrim(term) <> ''),
    state       text NOT NULL CHECK (state IN ('WAITING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN')),
    offered     jsonb NOT NULL,
    decided     jsonb,
    hired_employee_id text REFERENCES employee(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── performance ──────────────────────────────────────────────────────────
--
-- The template says which figures a position is measured on and where each
-- comes from; the score is one person's month. The bonus tier is *derived on
-- read* from `hr_policy`, never stored: a stored tier would survive a policy
-- change it should have followed.
CREATE TABLE performance_template (
    position text NOT NULL,
    metric   text NOT NULL CHECK (btrim(metric) <> ''),
    weight   integer NOT NULL CHECK (weight BETWEEN 0 AND 100),
    -- POS, ATTENDANCE, MANAGER, HR — where the figure comes from. Recorded so
    -- a screen can say which numbers are still typed by hand.
    source   text NOT NULL CHECK (btrim(source) <> ''),
    PRIMARY KEY (position, metric)
);

CREATE TABLE performance_score (
    employee_id   text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    -- First day of the month.
    period        date NOT NULL CHECK (extract(day from period) = 1),
    -- Double precision rather than NUMERIC: a KPI figure is a percentage a
    -- screen shows, not money, and no journal reads it.
    kpi_pct       double precision NOT NULL CHECK (kpi_pct >= 0),
    manager_score integer NOT NULL CHECK (manager_score BETWEEN 1 AND 5),
    note          text,
    recorded      jsonb NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (employee_id, period)
);

-- ── the rule numbers, in one place ───────────────────────────────────────
--
-- Every number a store reads and head office sets: allowance rates, bonus
-- tiers and caps, statutory percentage rates, benefit ceilings. They are
-- *guidance* — the amounts a form suggests and a decider may exceed at their
-- name — never inputs a journal computes from. Group is the screen tab; the
-- whole table is readable by anybody signed in, because a rule kept from the
-- people it governs is a trap rather than a rule.
CREATE TABLE hr_policy (
    key    text PRIMARY KEY CHECK (btrim(key) <> ''),
    group_ text NOT NULL CHECK (btrim(group_) <> ''),
    label  text NOT NULL CHECK (btrim(label) <> ''),
    -- Double precision rather than NUMERIC: these are guidance numbers a
    -- screen formats, and 6.24 survives the round trip to a browser number
    -- unchanged. No journal computes from them.
    value  double precision NOT NULL CHECK (value >= 0),
    unit   text NOT NULL CHECK (unit IN ('RUPIAH', 'PERCENT', 'MINUTE', 'HOUR', 'DAY', 'METER', 'TIMES', 'SET', 'MONTH')),
    updated jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ── training ─────────────────────────────────────────────────────────────
CREATE TABLE training_program (
    id        text PRIMARY KEY CHECK (btrim(id) <> ''),
    title     text NOT NULL CHECK (btrim(title) <> ''),
    on_date   date NOT NULL,
    place     text NOT NULL CHECK (btrim(place) <> ''),
    cost_minor bigint NOT NULL CHECK (cost_minor >= 0),
    state     text NOT NULL CHECK (state IN ('SCHEDULED', 'DONE')),
    defined   jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE training_participant (
    program_id  text NOT NULL REFERENCES training_program(id) ON DELETE CASCADE,
    employee_id text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    certificate boolean NOT NULL DEFAULT false,
    nominated   jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (program_id, employee_id)
);

-- ── benefits ─────────────────────────────────────────────────────────────
--
-- Uniform sets handed out. The annual entitlement lives in `hr_policy`
-- (`benefit.uniform_sets`); the count is read from these rows.
CREATE TABLE uniform_issuance (
    id          text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    issued_on   date NOT NULL,
    sets        integer NOT NULL CHECK (sets > 0),
    recorded    jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_uniform_issuance_employee ON uniform_issuance (employee_id, issued_on);

-- ── organisation masters ─────────────────────────────────────────────────
--
-- Grades and positions are head office's vocabulary, and the structure a
-- position belongs to decides which pay components a slip may carry. Read
-- only in this generation: the rows ship seeded and the screens read them;
-- editing waits for a need somebody actually has.
CREATE TABLE org_grade (
    code        text PRIMARY KEY CHECK (btrim(code) <> ''),
    floor_minor bigint NOT NULL CHECK (floor_minor >= 0),
    ceiling_minor bigint NOT NULL CHECK (ceiling_minor >= floor_minor)
);

CREATE TABLE pay_structure (
    code text PRIMARY KEY CHECK (btrim(code) <> ''),
    name text NOT NULL CHECK (btrim(name) <> ''),
    -- Which hr_policy key caps this structure's monthly bonus, if any.
    bonus_cap_policy text REFERENCES hr_policy(key)
);

CREATE TABLE pay_structure_component (
    structure      text NOT NULL REFERENCES pay_structure(code) ON DELETE CASCADE,
    component_code text NOT NULL,
    PRIMARY KEY (structure, component_code)
);

CREATE TABLE org_position (
    name      text PRIMARY KEY CHECK (btrim(name) <> ''),
    grade_floor text NOT NULL REFERENCES org_grade(code),
    grade_ceiling text NOT NULL REFERENCES org_grade(code),
    structure text NOT NULL REFERENCES pay_structure(code)
);

-- ── reference data ───────────────────────────────────────────────────────
--
-- The defaults the prototype ships with. Every row is someone's starting
-- point, not a law: head office edits them and the screens follow.

INSERT INTO hr_policy (key, group_, label, value, unit, updated) VALUES
    ('attendance.late_grace_minutes', 'shift', 'Toleransi terlambat', 10, 'MINUTE', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('attendance.half_day_hours', 'shift', 'Setengah hari bila kerja kurang dari', 4, 'HOUR', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('attendance.absent_hours', 'shift', 'Alpa bila kerja kurang dari', 2, 'HOUR', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('attendance.geofence_meters', 'shift', 'Radius check-in aplikasi', 100, 'METER', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('leave.annual_days', 'leave', 'Cuti tahunan per tahun', 12, 'DAY', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('leave.eligible_after_months', 'leave', 'Berhak cuti tahunan setelah', 12, 'MONTH', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('leave.carry_max_days', 'leave', 'Sisa cuti maks dibawa', 6, 'DAY', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('overtime.hour_divisor', 'overtime', 'Pembagi upah per jam', 173, 'TIMES', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('overtime.workday_first_multiplier', 'overtime', 'Hari kerja: jam pertama', 1.5, 'TIMES', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('overtime.workday_next_multiplier', 'overtime', 'Hari kerja: jam berikutnya', 2, 'TIMES', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('overtime.holiday_hours_1_7_multiplier', 'overtime', 'Hari libur: jam 1–7', 2, 'TIMES', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('overtime.holiday_hour_8_multiplier', 'overtime', 'Hari libur: jam 8', 3, 'TIMES', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('overtime.holiday_hours_9_10_multiplier', 'overtime', 'Hari libur: jam 9–10', 4, 'TIMES', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('overtime.workday_max_hours', 'overtime', 'Maks lembur hari kerja', 4, 'HOUR', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('claim.taxi_max', 'claim', 'Taksi per perjalanan', 150000, 'RUPIAH', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('claim.daily_allowance', 'claim', 'Uang harian dinas per hari', 200000, 'RUPIAH', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('claim.local_transport_max', 'claim', 'Transport lokal per hari', 50000, 'RUPIAH', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('claim.medical_annual_ceiling', 'claim', 'Plafon medis per tahun', 3000000, 'RUPIAH', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('claim.advance_limit', 'claim', 'Batas uang muka', 3000000, 'RUPIAH', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('pay.meal_allowance_daily', 'pay', 'Uang makan per hari hadir', 35000, 'RUPIAH', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('pay.transport_allowance_daily', 'pay', 'Uang transport per hari hadir', 25000, 'RUPIAH', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('pay.bonus_tier1_min_kpi', 'pay', 'Bonus tingkat 1: KPI minimal', 100, 'PERCENT', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('pay.bonus_tier1_rate', 'pay', 'Bonus tingkat 1', 5, 'PERCENT', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('pay.bonus_tier2_min_kpi', 'pay', 'Bonus tingkat 2: KPI minimal', 110, 'PERCENT', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('pay.bonus_tier2_rate', 'pay', 'Bonus tingkat 2', 10, 'PERCENT', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('pay.bonus_cap_staff', 'pay', 'Batas bonus staf toko', 1500000, 'RUPIAH', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('pay.bonus_cap_store_head', 'pay', 'Batas bonus kepala toko', 3000000, 'RUPIAH', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('statutory.bpjs_kesehatan_company', 'statutory', 'BPJS Kesehatan perusahaan', 4, 'PERCENT', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('statutory.bpjs_ketenagakerjaan_company', 'statutory', 'BPJS TK perusahaan', 6.24, 'PERCENT', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('statutory.bpjs_kesehatan_employee', 'statutory', 'BPJS Kesehatan karyawan', 1, 'PERCENT', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('statutory.bpjs_ketenagakerjaan_employee', 'statutory', 'BPJS TK karyawan', 3, 'PERCENT', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('benefit.uniform_sets_annual', 'benefit', 'Seragam per tahun', 2, 'SET', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('benefit.recreation_annual', 'benefit', 'Rekreasi per orang per tahun', 250000, 'RUPIAH', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17')),
    ('benefit.funeral_contribution', 'benefit', 'Santunan duka', 2000000, 'RUPIAH', jsonb_build_object('by', 'seed', 'reason', 'referensi prototype v17'))
ON CONFLICT (key) DO NOTHING;

INSERT INTO org_grade (code, floor_minor, ceiling_minor) VALUES
    ('G1', 5400000, 5800000),
    ('G2', 5800000, 6500000),
    ('G3', 6500000, 8000000),
    ('G4', 9000000, 12000000),
    ('G5', 10000000, 13000000),
    ('G6', 15000000, 22000000)
ON CONFLICT (code) DO NOTHING;

INSERT INTO pay_structure (code, name, bonus_cap_policy) VALUES
    ('ST-TOKO', 'Staf toko', 'pay.bonus_cap_staff'),
    ('ST-KT', 'Kepala toko', 'pay.bonus_cap_store_head'),
    ('ST-HO', 'Staf HO & DC', NULL),
    ('ST-HOM', 'Manajer HO', NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO pay_structure_component (structure, component_code) VALUES
    ('ST-TOKO', 'GP'), ('ST-TOKO', 'LB'), ('ST-TOKO', 'UM'), ('ST-TOKO', 'UT'), ('ST-TOKO', 'BN'),
    ('ST-KT', 'GP'), ('ST-KT', 'UM'), ('ST-KT', 'UT'), ('ST-KT', 'BN'),
    ('ST-HO', 'GP'), ('ST-HO', 'LB'), ('ST-HO', 'UM'), ('ST-HO', 'UT'),
    ('ST-HOM', 'GP'), ('ST-HOM', 'UM'), ('ST-HOM', 'UT')
ON CONFLICT (structure, component_code) DO NOTHING;

INSERT INTO org_position (name, grade_floor, grade_ceiling, structure) VALUES
    ('Sales associate', 'G1', 'G2', 'ST-TOKO'),
    ('Kasir', 'G1', 'G2', 'ST-TOKO'),
    ('Supervisor kasir', 'G3', 'G3', 'ST-TOKO'),
    ('Visual merchandiser', 'G3', 'G3', 'ST-TOKO'),
    ('HR toko', 'G3', 'G3', 'ST-TOKO'),
    ('Staf gudang toko', 'G1', 'G1', 'ST-TOKO'),
    ('Kepala toko', 'G5', 'G5', 'ST-KT'),
    ('Payroll specialist', 'G4', 'G4', 'ST-HO'),
    ('Accountant', 'G4', 'G4', 'ST-HO'),
    ('Kepala gudang DC', 'G5', 'G5', 'ST-HOM'),
    ('HR manager', 'G6', 'G6', 'ST-HOM')
ON CONFLICT (name) DO NOTHING;

INSERT INTO lifecycle_task_template (id, label, owner, kind, position) VALUES
    ('kontrak', 'Kontrak kerja disiapkan', 'HEAD_OFFICE', 'ONBOARDING', 1),
    ('esign', 'Kontrak ditandatangani', 'EMPLOYEE', 'ONBOARDING', 2),
    ('dok', 'KTP, NPWP & buku rekening diunggah', 'EMPLOYEE', 'ONBOARDING', 3),
    ('size', 'Ukuran seragam dipilih', 'EMPLOYEE', 'ONBOARDING', 4),
    ('bpjs', 'BPJS Kesehatan & Ketenagakerjaan didaftarkan', 'STORE', 'ONBOARDING', 5),
    ('seragam', 'Seragam 2 set diberikan', 'STORE', 'ONBOARDING', 6),
    ('akun', 'Akun POS & absen dibuat', 'IT', 'ONBOARDING', 7),
    ('roster', 'Masuk roster minggu pertama', 'STORE', 'ONBOARDING', 8),
    ('training', 'Training service excellence', 'HEAD_OFFICE', 'ONBOARDING', 9),
    ('serah', 'Serah terima pekerjaan & kunci', 'STORE', 'SEPARATION', 1),
    ('seragam-kembali', 'Seragam & ID card dikembalikan', 'STORE', 'SEPARATION', 2),
    ('akun-off', 'Akun POS & absen dinonaktifkan', 'IT', 'SEPARATION', 3),
    ('exit', 'Exit interview', 'HEAD_OFFICE', 'SEPARATION', 4),
    ('fnf', 'Full & final disetujui', 'HEAD_OFFICE', 'SEPARATION', 5)
ON CONFLICT (id) DO NOTHING;

INSERT INTO performance_template (position, metric, weight, source) VALUES
    ('Sales associate', 'Penjualan vs target', 50, 'POS'),
    ('Sales associate', 'Konversi pengunjung', 20, 'POS'),
    ('Sales associate', 'Grooming & SOP', 15, 'MANAGER'),
    ('Sales associate', 'Kehadiran', 15, 'ATTENDANCE'),
    ('Kasir', 'Akurasi kas', 40, 'POS'),
    ('Kasir', 'Kecepatan transaksi', 20, 'POS'),
    ('Kasir', 'Grooming & SOP', 20, 'MANAGER'),
    ('Kasir', 'Kehadiran', 20, 'ATTENDANCE'),
    ('Kepala toko', 'Penjualan toko vs target', 50, 'POS'),
    ('Kepala toko', 'Shrinkage stok', 20, 'STOCK'),
    ('Kepala toko', 'Retensi tim', 15, 'HR'),
    ('Kepala toko', 'Audit SOP', 15, 'MANAGER')
ON CONFLICT (position, metric) DO NOTHING;
