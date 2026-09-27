-- A grievance is filed in confidence and answered at head office.
--
-- # Why the queue is HO's, and why that is the whole point
--
-- A grievance against a store manager cannot be investigated by that store
-- manager, and in a thirteen-store estate the only place that is nobody's
-- posting is head office. So the queue lands at HO no matter where it was
-- raised: any employee may file (the `people.grievance.request_own` key exists
-- precisely so the complaint about their own supervisor does not have to pass
-- through that supervisor), a manager may file on their staff's behalf under
-- `people.grievance.file`, and investigating and resolving are two DISJOINT
-- ADMIN keys — `people.grievance.investigate` and `people.grievance.decide` —
-- because investigating and resolving are two signatures, the payroll lesson.
-- Reading the queue is `people.grievance.read`, mapped ADMIN: the accused
-- supervisor holds `people.employee.read` and must not therefore read the
-- queue, which is exactly what the one key space is for.
--
-- # The write-once halves
--
-- Investigated exactly once, resolved exactly once, withdrawn exactly once —
-- each half is nullable together with its state, and every pairing is a CHECK
-- below, so a halfway row (INVESTIGATED with no investigator, RESOLVED with no
-- decision) fails the INSERT outright rather than waiting for a reader to
-- notice. The two-actor rule is stated on the actors in `domain::grievance`
-- and re-run on the way in from storage; the schema's own CHECKs hold the
-- state-to-column pairings, which are the part a CHECK can compare.
--
-- `resolved_on` is a DATE beside the decision's instant: the resolution is an
-- act of a day, the thing a report counts, where `resolved_at` is the act of
-- a moment. Only RESOLVED needs it — INVALID is a decision that the complaint
-- was never a grievance at all, and a date adds nothing to that refusal.
--
-- # History
--
-- `history` is the append-only jsonb trail (FILED, INVESTIGATED, RESOLVED,
-- INVALID, WITHDRAWN) in the 0341 voice. WITHDRAWN is a state, so the trail
-- repeats it; the point of the trail is the reason and the actor, which no
-- column pair carries.

CREATE TABLE grievance_type (
    code       text PRIMARY KEY CHECK (btrim(code) <> ''),
    name       text NOT NULL CHECK (btrim(name) <> ''),
    retired_at timestamptz,
    -- A retirement without a reason is a decision without an author; the
    -- route asks for one and the column keeps it. The same pairing 0341 put
    -- on `expense_claim_type`.
    retired_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((retired_at IS NULL) = (retired_reason IS NULL))
);

COMMENT ON TABLE grievance_type IS
    'The company catalogue of grievance kinds (HARASSMENT, PAY, SAFETY, ...).
     Head office defines it; entries are retired, never deleted, so every
     grievance ever filed keeps naming a kind that exists.';

CREATE TABLE employee_grievance (
    grievance_id      uuid PRIMARY KEY,
    place_id          text NOT NULL REFERENCES org_place(id),
    type_code         text NOT NULL REFERENCES grievance_type(code),
    raised_by         text NOT NULL REFERENCES employee(id),
    -- The app_user.username that filed it: the employee, or a manager filing
    -- on their behalf. The two-actor rule is stated against this name.
    filed_by          text NOT NULL,
    -- Optional: a policy, a practice, a place — not every complaint names a
    -- person, and a column that forced one would manufacture an accused.
    against_employee  text REFERENCES employee(id),
    subject           text NOT NULL CHECK (btrim(subject) <> ''),
    description       text NOT NULL CHECK (btrim(description) <> ''),
    cause             text,
    state             text NOT NULL DEFAULT 'OPEN'
                        CHECK (state IN ('OPEN','INVESTIGATED','RESOLVED','INVALID','WITHDRAWN')),
    investigated_by   text, investigated_at timestamptz, investigation_note text,
    resolved_by       text, resolved_at timestamptz, resolution_detail text, resolved_on date,
    -- The withdrawal is the filer's act and carries their name and reason,
    -- like every other signature on the row: a state pair with the actor
    -- stripped out would be a taking-back nobody can account for.
    withdrawn_by      text, withdrawn_reason text, withdrawn_at timestamptz,
    -- The append-only trail: FILED, INVESTIGATED, RESOLVED, INVALID,
    -- WITHDRAWN — each with who, when, and why.
    history           jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    -- The write-once halves: decided exactly once, investigated exactly
    -- once, withdrawn exactly once.
    CHECK ((state IN ('RESOLVED','INVALID')) = (resolved_by IS NOT NULL)),
    CHECK ((state = 'INVESTIGATED') = (investigated_by IS NOT NULL)),
    CHECK ((state = 'WITHDRAWN') = (withdrawn_by IS NOT NULL)),
    CHECK ((withdrawn_by IS NULL) = (withdrawn_reason IS NULL)),
    CHECK (state <> 'RESOLVED' OR resolved_on IS NOT NULL),
    -- A note travels with the act that carried it.
    CHECK ((investigated_by IS NULL) = (investigation_note IS NULL)),
    CHECK ((resolved_by IS NULL) = (resolution_detail IS NULL))
);

COMMENT ON COLUMN employee_grievance.filed_by IS
    'The app_user.username that filed the grievance — the employee under
     people.grievance.request_own, or a manager on their behalf under
     people.grievance.file. The two-actor rule is stated against this name:
     the same username may not investigate or resolve.';

COMMENT ON COLUMN employee_grievance.raised_by IS
    'The employment record the grievance is about — an employee id, while
     filed_by is a username. One actor has two names here the way the profile
     split gave them two: the person is the employee row, the signature on
     the filing is the login.';

COMMENT ON COLUMN employee_grievance.history IS
    'Append-only jsonb events (actor, action, reason, at, detail?): the
     audit view folds this.';

CREATE INDEX ix_grievance_open ON employee_grievance (created_at DESC) WHERE state IN ('OPEN','INVESTIGATED');
CREATE INDEX ix_grievance_employee ON employee_grievance (raised_by, created_at DESC);

-- ---------------------------------------------------------------------------
-- The exit interview: one per person, at the end.
--
-- Created automatically as PENDING by the TERMINATE path
-- (`postgres::employment::save_employee`, in the same transaction as the
-- event, ON CONFLICT DO NOTHING) and completed at head office under
-- `people.exit_interview.file` — the store is a party to the exit, so the
-- interview is not the store's to hold.
--
-- # One per person, and not per termination span
--
-- The rehire question the phase spec left open, answered against the machine:
-- `domain::employment` has no transition out of TERMINATED. A terminated
-- record is terminal, a rehired person is a new record, so at most one
-- termination can ever sit in a history and the UNIQUE is `employee_id`
-- alone. A `(employee_id, span)` key would guard a shape the machine cannot
-- produce; the ON CONFLICT guard stays anyway, because the fold's guarantee
-- is the fold's, and this table does not have to trust it.
--
-- # A stance the row does not have yet
--
-- The phase spec's draft carried `employee_stance NOT NULL`; this migration
-- makes it nullable and pairs it with COMPLETED. A PENDING interview with a
-- stance would be an answer recorded before the question was asked — exactly
-- the halfway shape the write-once halves above refuse. Recorded deviation,
-- in the estate's direction.
--
-- CANCELLED is the honest answer to "the person left and the interview never
-- happened": cancelled_by and a reason, never silence.

CREATE TABLE exit_interview (
    exit_id        uuid PRIMARY KEY,
    employee_id    text NOT NULL UNIQUE REFERENCES employee(id),
    place_id       text NOT NULL REFERENCES org_place(id),
    state          text NOT NULL DEFAULT 'PENDING'
                     CHECK (state IN ('PENDING','COMPLETED','CANCELLED')),
    employee_stance text CHECK (employee_stance IN ('RETAINED','EXIT_CONFIRMED')),
    interview_summary text,
    conducted_by   text, completed_at timestamptz,
    cancelled_by   text, cancel_reason text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CHECK ((state = 'COMPLETED') = (completed_at IS NOT NULL)),
    CHECK ((state = 'COMPLETED') = (employee_stance IS NOT NULL)),
    CHECK ((state = 'COMPLETED') = (conducted_by IS NOT NULL)),
    CHECK ((state = 'CANCELLED') = (cancelled_by IS NOT NULL)),
    CHECK (cancelled_by IS NULL OR cancel_reason IS NOT NULL)
);

COMMENT ON TABLE exit_interview IS
    'What the person said when they went. PENDING the moment employment
     ends, COMPLETED at head office with the stance and the summary,
     CANCELLED when it never happened. The UNIQUE on employee_id is the
     no-rehire fact of the employment machine stated a second time.';

COMMENT ON COLUMN exit_interview.employee_stance IS
    'RETAINED (asked to stay and took it) or EXIT_CONFIRMED (going anyway),
     recorded at completion — NULL before, because a PENDING interview has
     not heard from anybody yet.';

CREATE INDEX ix_exit_interview_place ON exit_interview (place_id, state);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'employee_grievance_state_check') THEN
        RAISE EXCEPTION 'employee_grievance installed without its state vocabulary';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'exit_interview_employee_id_key') THEN
        RAISE EXCEPTION 'exit_interview installed without its one-per-person UNIQUE';
    END IF;
END $$;
