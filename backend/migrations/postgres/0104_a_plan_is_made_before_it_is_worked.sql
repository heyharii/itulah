-- 0104: A plan is made before it is worked, and it is frozen when the month is.
--
-- Ported from the reference HR backend's `044_attendance_v1.sql`, roster half
-- only. `docs/hr-port-provenance.md` records what changed and what was left.
--
-- # Why the roster is here before the punches
--
-- Because "absent" only means something against a plan. A punch on an unplanned
-- day is an exception, not a silent extra workday, and a day nobody was
-- scheduled for cannot be an absence. The plan is therefore upstream of money,
-- and everything below follows from treating it that way.
--
-- What is deliberately **not** here: punches, corrections and kiosks. There is
-- no punch source in this system — the product question of where a clock-in
-- comes from is open — and inventing one would be worse than the gap.
-- `frontend-hub/PEOPLE-BRIEF.md` states the three options.

-- A shift template: when it starts, when it ends, and how much of it is unpaid
-- break.
--
-- Clock positions are minutes since local midnight on a 0..2879 timeline
-- anchored at the roster date, so an overnight shift (22:00 → 06:00) is
-- representable without any timezone machinery: it is `start 1320`,
-- `end 360`, `end_day_offset 1`.
CREATE TABLE attendance_shift (
    id               text PRIMARY KEY CHECK (btrim(id) <> ''),
    name             text NOT NULL CHECK (btrim(name) <> ''),
    -- Minutes since midnight, 0..1439.
    start_minute     integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
    end_minute       integer NOT NULL CHECK (end_minute BETWEEN 0 AND 1439),
    -- 0 for a shift ending the same day, 1 for one ending the next.
    end_day_offset   integer NOT NULL CHECK (end_day_offset IN (0, 1)),
    -- Unpaid break inside the shift. Must be shorter than the span, or the
    -- shift is paid time somebody is not being paid for.
    unpaid_break_min integer NOT NULL DEFAULT 0 CHECK (unpaid_break_min >= 0),
    retired_at       timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    -- The span must be positive. `end + offset*1440 > start` is the whole rule,
    -- and it is expressible here rather than left to the loader.
    CONSTRAINT attendance_shift_ends_after_it_starts CHECK (
        end_minute + end_day_offset * 1440 > start_minute
    ),
    CONSTRAINT attendance_shift_break_fits CHECK (
        unpaid_break_min < end_minute + end_day_offset * 1440 - start_minute
    )
);

-- Retire, never delete: a shift a roster day already names cannot be removed
-- without leaving that day pointing at nothing.
CREATE INDEX ix_attendance_shift_live
    ON attendance_shift (id) WHERE retired_at IS NULL;

-- The close state of one (place, month).
--
-- Its own table rather than a column somewhere, because the history is the
-- point: every close and reopen is appended with the authority behind it and
-- the readiness it was taken under, and the status is folded back from that
-- history on the way in. A stored row claiming OPEN whose last event is a close
-- fails to load.
CREATE TABLE attendance_period (
    place_id   text NOT NULL REFERENCES org_place(id),
    -- The first day of the month it covers. A date rather than a
    -- `YYYY-MM` string so ordering and containment are the database's own
    -- arithmetic rather than a parse.
    period     date NOT NULL CHECK (extract(day from period) = 1),
    status     text NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
    -- Append-only. Each event names its kind, its authority, and — for a close
    -- — the blocker counts it was taken under.
    history    jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (place_id, period)
);

-- One dated roster entry for one person at one place.
--
-- At most one plan per person per date, which the primary key states. Split
-- shifts and two assignments on one day are deliberately not representable:
-- admitting them silently would make "which shift was this for?" ambiguous, and
-- an ambiguous attendance record is worse than a refused one.
CREATE TABLE roster_day (
    employee_id text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    on_date     date NOT NULL,
    place_id    text NOT NULL REFERENCES org_place(id),
    -- The first authorized statement of what this day is. Never overwritten.
    planned     jsonb NOT NULL,
    -- Every later statement, oldest first, each with its own authority. A day
    -- is not a field that gets edited: it is a list, and the plan in force is
    -- the last item.
    --
    -- The dangerous edit is not tomorrow's plan — it is quietly adding a
    -- SCHEDULED day to a month already counted, which turns a day nobody worked
    -- into an absence, and an absence into a deduction basis. That is why the
    -- earlier plans survive and why a closed period refuses a revision at all.
    amendments  jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (employee_id, on_date)
);

-- The week a manager is building, and the month payroll will read.
CREATE INDEX ix_roster_day_place_date ON roster_day (place_id, on_date);

COMMENT ON TABLE attendance_shift IS
    'Shift templates. Clock positions are minutes since local midnight on a '
    '0..2879 timeline, so an overnight shift needs no timezone machinery.';
COMMENT ON TABLE roster_day IS
    'What each dated day is planned to be, as an append-only list of authorized '
    'statements. The plan in force is the last one; the earlier ones are what '
    'makes a settled month reproducible.';
COMMENT ON TABLE attendance_period IS
    'The close boundary for one place and month. Status is folded from the '
    'history, so a row cannot claim a state its own evidence contradicts.';
