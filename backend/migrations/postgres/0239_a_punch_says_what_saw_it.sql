-- A punch says what saw it, because from today two different things can.
--
-- # Why there is a second source, and why it is named rather than blurred
--
-- The owner's decision of 2026-09-13 is a fingerprint station per unit, no PIN
-- and no card, and he reaffirmed it twice. `0234` was written under that
-- decision: `terminal_id` is NOT NULL because a punch's provenance *is* the
-- device that took it, and `method` is `FINGERPRINT` because that is the only
-- way in.
--
-- Nothing has been bought yet. So today nobody can clock in anywhere, and the
-- whole HR month — roster, derivation, corrections, period close, payroll — has
-- no input to be exercised against. The owner asked for attendance in the
-- employee app so the flow can be walked end to end before the readers arrive.
--
-- That is a **second punch source**, and the fingerprint decision did not
-- contemplate one. The dangerous version of this change is the one that widens
-- the existing columns: a `method` vocabulary that grows a `SELF_SERVICE` value,
-- or a `terminal_id` pointing at a station nobody installed, would leave the
-- estate unable to answer "did a finger produce this, or a phone?" — which is
-- exactly the question the readers' arrival makes urgent, and exactly the defect
-- the implementation this schema replaced had (its punch endpoint took `source`
-- as free text and *defaulted it to* `fingerprint`).
--
-- So the source is its own column, with its own closed vocabulary, spelled out
-- here the way every other vocabulary in this schema is spelled out. Two values:
--
--   TERMINAL      a registered, active station at the unit identified a finger.
--   EMPLOYEE_APP  the person themselves, signed in, tapped their own phone.
--                 Nothing saw them arrive, and the row says so for ever.
--
-- The owner can retire the second source later by refusing new rows of it, and
-- the history stays readable without anybody unpicking it: which readings were
-- taken on trust and which were witnessed remains a property of each row.
--
-- # `terminal_id` is nullable exactly when the source is not a terminal
--
-- Not "nullable". A phone punch with a station named on it, and a terminal
-- punch with none, are both nonsense, and the halfway row is what a later
-- reader would have to guess about. `punch_provenance_matches_source` below
-- makes both unstorable, in both directions — the same shape as `0234`'s
-- constraint on a correction whose `state` says APPROVED with no decision
-- beside it, and `cloud::domain::attendance::punch` re-states it as an enum
-- whose halves travel together, so the row cannot hydrate either.
--
-- `method` goes with the terminal rather than with the punch, because that is
-- what it always described: `0234` calls it how the identification was
-- performed *at the station*. A phone punch has no identification to describe,
-- so the honest value is the absence of one, not a widened vocabulary.
--
-- # No default, and the back-fill is a statement rather than an assumption
--
-- Every row that exists today came through `POST /api/v1/attendance/punches`
-- from a unit's node, which requires a terminal, so TERMINAL is what they are
-- — a fact, not a guess. It is written before the column is made NOT NULL,
-- deliberately in that order: a DEFAULT would let a later INSERT that names no
-- source acquire one silently, and an unattributed punch quietly filed as a
-- fingerprint reading is the defect at the top of this file.

ALTER TABLE attendance_punch
    ADD COLUMN source text;

UPDATE attendance_punch SET source = 'TERMINAL' WHERE source IS NULL;

ALTER TABLE attendance_punch
    ALTER COLUMN source SET NOT NULL,
    ADD CONSTRAINT attendance_punch_source_known
        CHECK (source IN ('TERMINAL', 'EMPLOYEE_APP')),
    ALTER COLUMN terminal_id DROP NOT NULL,
    ALTER COLUMN method DROP NOT NULL,
    -- The halfway row, refused from both sides.
    ADD CONSTRAINT punch_provenance_matches_source CHECK (
        (source = 'TERMINAL'
            AND terminal_id IS NOT NULL
            AND method IS NOT NULL)
        OR
        (source <> 'TERMINAL'
            AND terminal_id IS NULL
            AND method IS NULL)
    );

-- No new index, deliberately.
--
-- The second source adds no query shape. The employee app reads one person's
-- own fortnight, which `ix_attendance_punch_employee_date` already answers, and
-- the unit's day goes through `ix_attendance_punch_place_date`. An index on
-- `source` would be a write cost with no reader — and the day somebody asks
-- "how much of this month came from phones rather than readers" is the day to
-- add it, with the query that asks.
