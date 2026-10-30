-- 1001: a store keys in a person's papers, and head office takes them.
--
-- The owner's list of 2026-10-25: the rest of the KTP, the family a PTKP is
-- read from, who to call, a photo, and the scans kept on file — KTP and KK
-- required, SKCK and the signed contract as PDFs. And who does it: "create
-- karyawan profile, approve by HO", "ngedit data bisa toko, approval HO".
--
-- # This reverses 0232's line on personal data, on purpose
--
-- 0232 kept every personal detail off a hire proposal, because a candidate
-- who may be refused has no business leaving a NIK behind (UU 27/2022). The
-- owner now wants the store to key the new hire in whole. So the dossier sits
-- in its own table beside the proposal, not in `hire_proposal_version`, and it
-- is ERASED when the proposal is rejected — scans included. What 0232 feared
-- was a table that keeps a refused stranger's identity; this one does not.
--
-- # Four tables and a rule number
--
--  - `employee_detail` (+ `_revision`): the set the store keys in from the
--    card and the KK, one revisioned jsonb set (`domain::EmployeeDetails`).
--  - `employee_document`: a paper on a file — the employee's, or a hire
--    proposal's until the person exists. PENDING while it waits on head
--    office, ACTIVE once taken, SUPERSEDED when a newer one of its kind is.
--  - `hire_proposal_dossier`: a new hire's personal data, keyed by the store.
--  - `employee_data_update`: a store's change to an existing employee's data,
--    waiting on head office. One waiting per person.
--  - `hr_policy` `roster.min_weekly_hours`: forty hours a week.

CREATE TABLE employee_detail (
    employee_id text PRIMARY KEY REFERENCES employee (id) ON DELETE CASCADE,
    details     jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
    revision    integer NOT NULL CHECK (revision >= 1),
    -- The `Authorization` of the save that made this revision.
    saved       jsonb NOT NULL
);

CREATE TABLE employee_detail_revision (
    employee_id text NOT NULL REFERENCES employee (id) ON DELETE CASCADE,
    revision    integer NOT NULL CHECK (revision >= 1),
    details     jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
    saved       jsonb NOT NULL,
    PRIMARY KEY (employee_id, revision)
);

CREATE TABLE employee_data_update (
    id           text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id  text NOT NULL REFERENCES employee (id) ON DELETE CASCADE,
    -- Only the personal fields that change: `full_name`, `nik`, `birth_date`,
    -- `address`, `phone`, `email`. An empty phone or email clears it.
    personal     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(personal) = 'object'),
    -- The whole new detail set, or none when only personal data or papers move.
    details      jsonb CHECK (details IS NULL OR jsonb_typeof(details) = 'object'),
    -- What the record said when the change was filed, so head office reads
    -- "was → becomes" and a decided change still says what it replaced.
    before_personal jsonb NOT NULL DEFAULT '{}'::jsonb
                 CHECK (jsonb_typeof(before_personal) = 'object'),
    before_details  jsonb CHECK (before_details IS NULL OR jsonb_typeof(before_details) = 'object'),
    reason       text NOT NULL CHECK (btrim(reason) <> ''),
    state        text NOT NULL DEFAULT 'PENDING'
                 CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
    filed        jsonb NOT NULL,
    decided      jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT employee_data_update_decision_is_signed
        CHECK ((state = 'PENDING') = (decided IS NULL))
);

-- Head office would otherwise be choosing between two of the store's minds.
CREATE UNIQUE INDEX ux_employee_data_update_one_waiting
    ON employee_data_update (employee_id) WHERE state = 'PENDING';

CREATE INDEX ix_employee_data_update_waiting
    ON employee_data_update (created_at) WHERE state = 'PENDING';

CREATE TABLE hire_proposal_dossier (
    hire_proposal_id text PRIMARY KEY REFERENCES hire_proposal (id) ON DELETE CASCADE,
    nik         text NOT NULL CHECK (nik ~ '^[0-9]{16}$'),
    birth_date  date NOT NULL,
    address     text NOT NULL CHECK (btrim(address) <> ''),
    phone       text,
    email       text,
    details     jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
    saved       jsonb NOT NULL
);

CREATE TABLE employee_document (
    id               text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id      text REFERENCES employee (id) ON DELETE CASCADE,
    hire_proposal_id text REFERENCES hire_proposal (id) ON DELETE CASCADE,
    data_update_id   text REFERENCES employee_data_update (id) ON DELETE CASCADE,
    kind             text NOT NULL
                     CHECK (kind IN ('PHOTO', 'KTP', 'KK', 'SKCK', 'CONTRACT', 'NPWP', 'BPJS', 'OTHER')),
    file_id          uuid NOT NULL REFERENCES stored_file (file_id),
    state            text NOT NULL
                     CHECK (state IN ('PENDING', 'ACTIVE', 'SUPERSEDED')),
    filed            jsonb NOT NULL,
    taken            jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    -- A paper belongs to somebody: a person, or a proposal for one.
    CONSTRAINT employee_document_has_an_owner
        CHECK (employee_id IS NOT NULL OR hire_proposal_id IS NOT NULL),
    -- A paper on a person's file is in force or replaced; one waiting rides on
    -- the proposal or the change it came with.
    CONSTRAINT employee_document_pending_rides_on_something
        CHECK (state <> 'PENDING' OR hire_proposal_id IS NOT NULL OR data_update_id IS NOT NULL)
);

-- One of each kind in force on a file; only OTHER may pile up.
CREATE UNIQUE INDEX ux_employee_document_one_in_force
    ON employee_document (employee_id, kind)
    WHERE state = 'ACTIVE' AND kind <> 'OTHER';

CREATE INDEX ix_employee_document_employee ON employee_document (employee_id, created_at DESC);
CREATE INDEX ix_employee_document_proposal ON employee_document (hire_proposal_id)
    WHERE hire_proposal_id IS NOT NULL;
CREATE INDEX ix_employee_document_update ON employee_document (data_update_id)
    WHERE data_update_id IS NOT NULL;

INSERT INTO hr_policy (key, group_, label, value, unit, updated) VALUES
    ('roster.min_weekly_hours', 'shift', 'Minimum hours a week', 40, 'HOUR',
     jsonb_build_object('by', 'seed', 'reason', 'owner, 2026-10-25: minimal 40 jam seminggu'))
ON CONFLICT (key) DO NOTHING;
