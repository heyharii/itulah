-- 0805: an organisation has departments, job levels, grades and a line of
-- report; the company has its BPJS registration.
--
-- Talenta's Organization settings, kept in scope by the owner on 2026-09-30:
-- company info, the structure (departments within departments), job level,
-- grade, the organisation chart, and the company's BPJS numbers with their
-- history. Units (stores, the warehouse, head office) stay what they are —
-- where somebody works; a department is what they work *in*, across units.
--
-- # A placement is dated
--
-- Somebody's department, level, grade and manager change, and a payslip or a
-- report of last year must read what was true then. So a placement is a row
-- from a date — the latest on or before a day is the one in force — and a
-- change is a new row, never an edit.

CREATE TABLE org_department (
    code         text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{0,31}$'),
    name         text NOT NULL CHECK (btrim(name) <> ''),
    parent_code  text REFERENCES org_department (code),
    defined      jsonb NOT NULL,
    retired_at   timestamptz,
    retired      jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_department_not_its_own_parent CHECK (parent_code IS DISTINCT FROM code),
    CONSTRAINT org_department_retirement_is_signed
        CHECK ((retired_at IS NULL) = (retired IS NULL))
);

CREATE TABLE job_level (
    code         text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{0,31}$'),
    name         text NOT NULL CHECK (btrim(name) <> ''),
    -- 1 is the most senior. Two levels cannot share a rank: an org chart
    -- that cannot say which of two is higher cannot draw them.
    rank         integer NOT NULL UNIQUE CHECK (rank > 0),
    defined      jsonb NOT NULL,
    retired_at   timestamptz,
    retired      jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT job_level_retirement_is_signed
        CHECK ((retired_at IS NULL) = (retired IS NULL))
);

CREATE TABLE job_grade (
    code         text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{0,31}$'),
    name         text NOT NULL CHECK (btrim(name) <> ''),
    level_code   text REFERENCES job_level (code),
    -- The pay band, guidance for whoever agrees somebody's pay; nothing
    -- refuses an agreement outside it.
    min_minor    bigint CHECK (min_minor > 0),
    max_minor    bigint CHECK (max_minor > 0),
    defined      jsonb NOT NULL,
    retired_at   timestamptz,
    retired      jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT job_grade_band_runs_upwards
        CHECK (min_minor IS NULL OR max_minor IS NULL OR min_minor <= max_minor),
    CONSTRAINT job_grade_retirement_is_signed
        CHECK ((retired_at IS NULL) = (retired IS NULL))
);

CREATE TABLE employee_placement (
    employee_id      text NOT NULL REFERENCES employee (id),
    effective_from   date NOT NULL,
    department_code  text REFERENCES org_department (code),
    level_code       text REFERENCES job_level (code),
    grade_code       text REFERENCES job_grade (code),
    reports_to       text REFERENCES employee (id),
    placed           jsonb NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (employee_id, effective_from),
    CONSTRAINT employee_placement_not_own_manager CHECK (reports_to IS DISTINCT FROM employee_id)
);

CREATE INDEX ix_employee_placement_reports_to ON employee_placement (reports_to);

COMMENT ON TABLE employee_placement IS
    'Where somebody sits in the organisation from a date (0805): department, job level, grade and who they report to. The latest effective_from on or before a day is in force.';

CREATE TABLE company_bpjs_registration (
    effective_from       date PRIMARY KEY,
    -- Nomor Pendaftaran Perusahaan, BPJS Ketenagakerjaan.
    npp                  text CHECK (npp IS NULL OR btrim(npp) <> ''),
    -- Kode badan usaha, BPJS Kesehatan.
    kesehatan_code       text CHECK (kesehatan_code IS NULL OR btrim(kesehatan_code) <> ''),
    -- The JKK risk class the NPP was registered under, I to V; the rate it
    -- implies is stated with the BPJS rates.
    jkk_risk_class       text CHECK (jkk_risk_class IN ('I', 'II', 'III', 'IV', 'V')),
    registered           jsonb NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE company_bpjs_registration IS
    'The company''s BPJS numbers from a date (0805), kept as a history: a report for an earlier month names the numbers it was filed under.';

-- ── a grade's class, business units and the group ───────────────────────────
--
-- Talenta's "Grade & class": a class narrows a grade (3A, 3B); one optional
-- column rather than a second master, because nothing hangs off a class but
-- its name.
ALTER TABLE job_grade ADD COLUMN grade_class text CHECK (grade_class IS NULL OR btrim(grade_class) <> '');

-- A strategic business unit groups units by line of business — retail
-- stores, online, wholesale — for reporting across them. A unit belongs to
-- at most one.
CREATE TABLE business_unit (
    code        text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{0,31}$'),
    name        text NOT NULL CHECK (btrim(name) <> ''),
    defined     jsonb NOT NULL,
    retired_at  timestamptz,
    retired     jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT business_unit_retirement_is_signed
        CHECK ((retired_at IS NULL) = (retired IS NULL))
);

CREATE TABLE unit_business_unit (
    unit_id     text PRIMARY KEY REFERENCES unit (id),
    sbu_code    text NOT NULL REFERENCES business_unit (code),
    set_by      jsonb NOT NULL,
    set_at      timestamptz NOT NULL DEFAULT now()
);

-- The group the company belongs to: its holding, its subsidiaries and
-- affiliates, as names and tax ids. Records, not companies this system keeps
-- books for — it keeps one company's.
CREATE TABLE company_group_entity (
    code        text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{0,31}$'),
    name        text NOT NULL CHECK (btrim(name) <> ''),
    relation    text NOT NULL CHECK (relation IN ('HOLDING', 'SUBSIDIARY', 'AFFILIATE')),
    tax_id      text CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{15,16}$'),
    defined     jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
