-- What "late" means, and since when.
--
-- Ported from the reference HR backend's `046_attendance_policy_v1.sql`. See
-- `docs/hr-port-provenance.md`.
--
-- # Why this is a table and not configuration
--
-- The implementation this replaces read the lateness grace from the database
-- with a silent thirty-minute fallback when the row or the connection was
-- missing. The same arrival was on time or late depending on whether a query
-- succeeded, and nothing anywhere said which had happened.
--
-- Making it a table does not by itself fix that — what fixes it is that there
-- is no default anywhere else either. `AttendancePolicy` has no `Default`, and
-- a date no row covers yields `NoPolicyEffective` rather than a borrowed rule.
-- The row is where the answer is kept, never where a missing answer is
-- invented.
--
-- # Operator-wide, not per place
--
-- One schedule for the whole company. What counts as late is head office's to
-- decide, and a store that could set its own tolerance is a store that can
-- quietly stop having late arrivals. If a genuine per-place exception ever
-- arrives it will be an explicit override with its own authority trail, not a
-- second row here that silently wins.

CREATE TABLE attendance_policy (
    -- Every derived outcome records the version it was produced under, so a
    -- later reader can tell which generation of the rules applied without
    -- inferring it from dates. Zero is refused: zero would mean "unversioned",
    -- and no recorded decision may be that.
    version                     integer PRIMARY KEY CHECK (version > 0),
    -- The policy's identity, stable across its versions.
    policy_id                   text NOT NULL CHECK (btrim(policy_id) <> ''),
    effective_from              date NOT NULL UNIQUE,
    -- NULL means open-ended. The domain refuses overlapping spans and refuses
    -- anything following an open one; the unique key above catches the
    -- commonest way to write an overlap by hand.
    effective_to                date,
    -- Minutes throughout. Attendance is never measured in fractional hours:
    -- the implementation this replaces carried `overtime_hours` as a float,
    -- which cannot round-trip through storage and cannot be compared for
    -- equality — two timesheets that agree could disagree, and neither was
    -- wrong.
    --
    -- The two ceilings are the domain's, restated here because a constraint
    -- added later cannot fix rows written before it. A lateness grace of eight
    -- hours covers a whole shift, at which point the "grace" is the plan; two
    -- same-direction punches an hour apart are two events, not one double-tap.
    late_grace_minutes          integer NOT NULL CHECK (late_grace_minutes BETWEEN 0 AND 480),
    early_leave_grace_minutes   integer NOT NULL CHECK (early_leave_grace_minutes >= 0),
    overtime_minimum_minutes    integer NOT NULL CHECK (overtime_minimum_minutes >= 0),
    duplicate_punch_window_mins integer NOT NULL CHECK (duplicate_punch_window_mins BETWEEN 0 AND 60),
    -- Who decided this, under what authority, and why. Same shape as
    -- `employee_contract.authorized`, and NOT named `authorization` for the
    -- same reason: that is a reserved word in PostgreSQL.
    authorized                  jsonb NOT NULL,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT attendance_policy_ends_after_it_starts CHECK (
        effective_to IS NULL OR effective_to >= effective_from
    )
);

-- "Which rules apply on this date" is the only question anything asks of this
-- table, and it is asked once per timesheet per person.
CREATE INDEX ix_attendance_policy_span ON attendance_policy (effective_from, effective_to);

-- At most one open-ended version. A second would make "the current rules"
-- ambiguous, and the domain would refuse to load the pair — better to refuse
-- the write than to store something that cannot be read back.
CREATE UNIQUE INDEX ix_attendance_policy_one_open
    ON attendance_policy ((true)) WHERE effective_to IS NULL;

COMMENT ON TABLE attendance_policy IS
    'Effective-dated tolerances deciding what counts as late. No default '
    'anywhere: a date no version covers has no policy, and derivation fails.';
COMMENT ON COLUMN attendance_policy.version IS
    'Stamped onto every outcome derived under it, so which rules applied is '
    'recorded rather than inferred from dates.';
